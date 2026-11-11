# Sổ Tay Bảo Trì & Nâng Cấp An Toàn Trên Nhánh Chính (Safe Maintenance & Upgrade Runbook)
**Dự Án**: OPENVN · Ưu Đàm Suite (Multi-Channel Omnisales & Zero-Storage CDN)  
**Phiên Bản Hệ Thống**: v2.6.0  
**Tài Liệu Chuẩn**: `docs/MAINTENANCE_RUNBOOK.md`  
**Nhánh Áp Dụng**: `main` (Production Branch)  
**Mục Tiêu RTO**: < 5 phút | **Mục Tiêu RPO**: 0 giây (Zero Data Loss) | **Shop Bất Biến**: `thaimy1605` (Delta = 0)

---

## 1. Tổng Quan Kiến Trúc 3 Phân Hệ Vận Hành Production (Architectural Overview)

Hệ thống OPENVN · Ưu Đàm Suite vận hành dựa trên sự kết hợp của 3 phân hệ dịch vụ độc lập, phối hợp đồng bộ qua mạng nội bộ nhằm tối ưu tốc độ lưu dữ liệu và kiến trúc Zero-Storage CDN Pointer:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENT BROWSERS & POS                                │
└───────────────────────┬────────────────────────────────────────┬───────────────────────┘
                        │ HTTP / JSON / SSE                      │ Socket.io (Port 3013)
                        ▼                                        ▼
┌────────────────────────────────────────────────┐     ┌─────────────────────────────────┐
│ [PHÂN HỆ 1] NEXT.JS STANDALONE (:3010)         │     │ [PHÂN HỆ 2] REALTIME BUS (:3013)│
│ - Server: Node.js 22 / .next/standalone        │     │ - Service: mini-services/       │
│ - App Router + API Routes + L1 RAM Cache       │◄───►│   realtime/index.ts             │
│ - CSDL Kép: SQLite WAL + Supabase PostgreSQL   │     │ - Sự kiện: ledger.new,          │
│ - Zero-Storage Image Pointer API (:3010/api)   │     │   inventory.updated, order.new  │
└───────────────────────┬────────────────────────┘     └─────────────────────────────────┘
                        │
                        │ HTTP Bridge (Port 51898)
                        ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [PHÂN HỆ 3] SHOPEE SELLER SYNC DAEMON 24/7 (:51898)                                    │
│ - Script: scripts/shopee_seller_sync.py (ThreadingHTTPServer)                          │
│ - Quản lý phiên Shopee Seller: Keep-Alive Heartbeat + CDP Port 9222 (Google Chrome)   │
│ - Zero-Storage CDN Gateway: POST /shopee/upload-image -> Shopee Media Space CDN (~74B) │
│ - Đệm 2 Chiều:                                                                         │
│   * Inbound: Shopee -> Spool Queue (.shopee_inbound_queue.json) -> CMS Webhook (:3010) │
│   * Outbound: CMS Outbox Table -> Shopee Stock API v3 -> ACK Confirmation              │
│ - Dead Letter Queue: scripts/.shopee_dlq.json (tự cách ly lỗi mạng)                    │
│ - Cổng Điều Phối Nâng Cấp: POST /shopee/pause & POST /shopee/resume                    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Chi Tiết Cấu Hình Cổng & Biến Môi Trường
| Phân Hệ | Cổng Cục Bộ | Cổng Container | Biến Môi Trường Cấu Hình | Điểm Kiểm Tra Sức Khỏe (Health Probe) |
| :--- | :--- | :--- | :--- | :--- |
| **Next.js Standalone** | `3010` | `3000` | `PORT=3010` | `GET http://127.0.0.1:3010/api` |
| **Realtime Event Bus** | `3013` | `3003` | `REALTIME_PORT=3013`, `REALTIME_URL` | `GET http://127.0.0.1:3013/health` |
| **Shopee Sync Daemon** | `51898` | `51898` | `SHOPEE_SYNC_PORT=51898` | `GET http://127.0.0.1:51898/shopee/status` |
| **Chrome Debugger CDP**| `9222` | N/A | `--remote-debugging-port=9222` | `GET http://127.0.0.1:9222/json/version` |

---

## 2. Nguyên Tắc Vàng Khi Nâng Cấp Schema CSDL (Golden Rules of Schema Migration)

### 2.1 Lệnh Cấm Tuyệt Đối (Zero Tolerance Directives)
1. **CẤM TUYỆT ĐỐI**: Thực thi `prisma db push --accept-data-loss` hoặc `prisma migrate reset` trên môi trường Production và nhánh `main`. Mọi vi phạm sẽ làm mất toàn bộ lịch sử kế toán, hóa đơn và tồn kho thực tế.
2. **CẤM ĐỔI TÊN CỘT TRỰC TIẾP (No Direct Rename)**: Không bao giờ được đổi tên cột trong một bước duy nhất (ví dụ: `ALTER TABLE ... RENAME COLUMN old_col TO new_col`), vì trong giai đoạn chuyển tiếp, mã nguồn phiên bản cũ đang chạy sẽ ném lỗi `500 Internal Server Error` ngay lập tức.
3. **CẤM THÊM CỘT `NOT NULL` KHÔNG CÓ MẶC ĐỊNH**: Không thêm cột mới có ràng buộc `NOT NULL` mà không có giá trị `@default(...)`.

### 2.2 Quy Trình Di Trú 3 Giai Đoạn (Expand-and-Contract Migration Pattern)

Mọi nâng cấp cấu trúc bảng trên CSDL sản xuất bắt buộc phải chia làm 3 bước tương thích ngược:

```
[BƯỚC 1: EXPAND]              [BƯỚC 2: BACKFILL]             [BƯỚC 3: CONTRACT]
Thêm trường mới dạng          Chạy script nền nạp            Xóa trường cũ hoặc thêm
nullable hoặc có @default.    dữ liệu cũ sang mới            NOT NULL sau khi code mới
Mã cũ & mới chạy song song.   theo batch nhỏ (500).          đã ổn định >= 7 ngày.
       │                              │                              │
       ▼                              ▼                              ▼
Prisma: new_field String?     Script: UPDATE ...             Prisma: DROP old_field
Code: fallback reading        Code: Ghi đồng thời 2 trường   Code: Chỉ đọc trường mới
```

- **Bước 1 — Mở Rộng (Expand)**:
  - Tạo trường mới trong `prisma/schema.prisma` ở trạng thái tùy chọn (`nullable`) hoặc có giá trị mặc định `@default(...)`.
  - Sinh migration: `npx prisma migrate dev --create-only --name expand_<field_name>`.
  - Kiểm tra tệp SQL sinh ra trong thư mục `prisma/migrations/`.
  - Áp dụng an toàn: `npx prisma migrate deploy`.
- **Bước 2 — Chuyển Tiếp & Ghi Kép (Backfill & Dual-Write)**:
  - Cập nhật tầng Service/Repository để ghi đồng thời vào cả trường cũ và trường mới.
  - Chạy script chuyển tiếp dữ liệu quá khứ theo từng khối nhỏ 500 bản ghi (`batching`) qua raw SQL để không gây khóa bảng (Lock table timeout).
- **Bước 3 — Thu Hẹp (Contract)**:
  - Chỉ thực hiện sau khi phiên bản mới đã hoạt động ổn định trên nhánh `main` tối thiểu 7 ngày và 100% dữ liệu đã ở trường mới.
  - Tạo migration thứ hai để xóa bỏ trường cũ hoặc thêm ràng buộc `NOT NULL`.

### 2.3 Quy Chuẩn PostgreSQL & Supabase Pooler
- Khi tạo Index mới trên các bảng giao dịch lớn (`Order`, `StockMovement`, `LedgerEntry`), bắt buộc sử dụng `CREATE INDEX CONCURRENTLY` trong file SQL tùy biến để tránh chặn luồng ghi từ quầy POS và sàn Shopee.
- Luôn sử dụng `DIRECT_URL` (Cổng `5432` Session Pooler) cho các lệnh `prisma migrate deploy` và `DATABASE_URL` (Cổng `6543` Transaction Pooler kèm `pgbouncer=true`) cho tiến trình Next.js ứng dụng.

---

## 3. Cơ Chế Tự Động Sao Lưu Trước Khi Nâng Cấp (Automated Pre-Upgrade Backup Hook)

Trước khi thực hiện `git pull`, `npx prisma migrate deploy`, hoặc `npm run build`, người vận hành hoặc kịch bản CI/CD bắt buộc phải kích hoạt 2 tầng sao lưu:

### 3.1 Sao Lưu CSDL SQLite Cục Bộ (`db/custom.db`)
Kích hoạt quy trình 4 bước đóng băng nhị phân qua kịch bản `scripts/backup-pre-autosocial.mjs`:
1. **Ép xả toàn bộ WAL Frames**:
   ```sql
   PRAGMA wal_checkpoint(FULL);
   ```
   Kiểm tra kết quả: `busy === 0`. Nếu `busy !== 0`, dừng quy trình ngay lập tức để tránh sao lưu tệp CSDL đang bị khóa bận.
2. **Ngắt kết nối Prisma**: Đóng toàn bộ handle để nhả lock Windows SQLite.
3. **Sao chép nhị phân tệp vật lý**:
   - Sao chép `db/custom.db` sang `db/custom.db.bak.<TIMESTAMP>` (hoặc `.bak.pre-upgrade`).
4. **Kiểm tra tính toàn vẹn 3 lớp**:
   - **Lớp 1 (Dung lượng)**: Dung lượng tệp sao lưu phải `> 0` và bằng chính xác `100%` dung lượng tệp gốc.
   - **Lớp 2 (Header Signature)**: Đọc 16 bytes đầu tiên, xác nhận đúng chuỗi `SQLite format 3\0`.
   - **Lớp 3 (Mã băm SHA-256)**: Tính toán mã băm SHA-256 giữa tệp gốc và tệp sao lưu; hai mã băm phải khớp nhau tuyệt đối (`Identical 100%`).

*Lệnh thực thi độc lập:*
```bash
node scripts/backup-pre-autosocial.mjs
```

### 3.2 Sao Lưu CSDL Supabase PostgreSQL
1. **Tạo Bản Dump CSDL Qua Supabase CLI**:
   ```bash
   npx supabase db dump -f db/supabase_backup_pre_upgrade.sql --data-only
   ```
2. **Kích Hoạt Test-Guard Snapshot Đóng Băng Tồn Kho**:
   - Gửi yêu cầu HTTP POST tới điểm cuối bảo vệ dữ liệu:
   ```bash
   curl -X POST http://127.0.0.1:3010/api/ledger/test-guard -H "Content-Type: application/json" -d "{\"action\":\"SNAPSHOT\"}"
   ```
   - Xác nhận phản hồi: `{"ok": true, "session": "beta_test_snapshot_v1"}`. Tồn kho 17 sản phẩm thật của shop `thaimy1605` được đóng băng thành chuẩn bất biến.

---

## 4. Chế Độ Vận Hành Chuyển Tiếp: Tạm Dừng & Xả Đệm (Drain & Maintenance Mode)

Để cập nhật mã nguồn hoặc khởi động lại dịch vụ mà không làm gián đoạn đơn hàng từ Shopee hay gây lỗi kết nối cho khách hàng:

```
[BẮT ĐẦU BẢO TRÌ]
       │
       ▼
1. Tạm dừng Shopee Daemon: POST :51898/shopee/pause
   (Daemon ngừng truy vấn DB, tiếp tục nhận webhook vào Spool Queue .shopee_inbound_queue.json)
       │
       ▼
2. Bật cờ Maintenance Mode trên CMS: AppSetting.maintenance_mode = true
   (CMS chuyển giao diện sang Read-Only, trả về Retry-After: 120 cho thao tác ghi)
       │
       ▼
3. Nâng cấp mã nguồn & Chạy Migration:
   - git pull origin main
   - npx prisma migrate deploy
   - npm run build (hoặc cập nhật .next/standalone)
       │
       ▼
4. Khởi động lại dịch vụ & Chạy Health Probe 4 Tầng:
   - node scripts/ops-healthcheck.mjs
       │
       ▼
5. Khôi phục vận hành:
   - Tắt cờ Maintenance Mode
   - POST :51898/shopee/resume (Daemon tự động xả sạch Spool Queue vào CMS)
       │
       ▼
[HOÀN TẤT NÂNG CẤP AN TOÀN]
```

### Lệnh Điều Khiển Chi Tiết:
- **Thực thi tự động toàn bộ quy trình 6 bước Nâng cấp An toàn trên nhánh `main`**:
  ```bash
  # Diễn tập không tác động dữ liệu:
  npm run ops:upgrade:dry

  # Nâng cấp thực tế kèm Auto-Rollback nếu bất kỳ bước nào lỗi:
  npm run ops:upgrade
  ```
- **Bật / Tắt Chế độ Bảo trì Read-Only trên CMS (`POST /api/system/maintenance`)**:
  ```bash
  curl -s -X POST http://127.0.0.1:3010/api/system/maintenance -H "Content-Type: application/json" -d "{\"enabled\":true,\"retryAfterSec\":120}"
  # Kỳ vọng phản hồi: {"ok": true, "enabled": true, "retryAfterSec": 120, ...}
  ```
- **Tạm dừng Shopee Sync Daemon (Drain Mode)**:
  ```bash
  curl -s -X POST http://127.0.0.1:51898/shopee/pause
  # Kỳ vọng phản hồi: {"ok": true, "paused": true}
  ```
- **Kiểm tra số lượng đơn đệm trong Spool Queue**:
  ```bash
  curl -s http://127.0.0.1:51898/shopee/queue
  ```
- **Tiếp tục và Xả Đệm (Resume & Flush)**:
  ```bash
  curl -s -X POST http://127.0.0.1:51898/shopee/resume
  # Kỳ vọng phản hồi: {"ok": true, "paused": false}
  ```

---

## 5. Kiểm Tra Sức Khỏe 4 Tầng Hệ Thống (4-Tier Healthcheck Probes)

Hệ thống cung cấp kịch bản kiểm tra sức khỏe tự động 4 tầng tập trung tại `scripts/ops-healthcheck.mjs` (`npm run ops:health`):

```bash
node scripts/ops-healthcheck.mjs
```

### Các Tiêu Chí Kiểm Tra (Health Criteria):
1. **Tầng 1 — SQLite Database (`db/custom.db`)**:
   - File tồn tại vật lý trên đĩa.
   - Header 15 bytes chuẩn `SQLite format 3`.
   - File size > 0.
2. **Tầng 2 — Realtime WebSocket Event Bus (`GET :3013/health`)**:
   - HTTP Status: `200 OK`.
   - Phản hồi: `{"ok": true, "uptime": ..., "clients": ...}`.
   - Độ trễ phản hồi (Latency) < 50ms.
3. **Tầng 3 — Shopee Seller Sync Daemon (`GET :51898/shopee/status`)**:
   - HTTP Status: `200 OK`.
   - Phản hồi chứa: `status: "ok"` hoặc `alive: true`, `shopId: "288333857"`, `username: "thaimy1605"`.
   - Hàng đợi lỗi Dead Letter Queue (`dlqCount`): `0`.
4. **Tầng 4 — CMS Standalone & API Gateway (`GET :3010/api`)**:
   - HTTP Status: `200 OK`.
   - Phản hồi: `status: "healthy"`, `version: "2.6.0"`.
   - Số liệu metric hoạt động đầy đủ (`activeProducts >= 17`, `activeWarehouses >= 1`).

---

## 6. Sổ Tay Khôi Phục Sự Cố Khẩn Cấp (Emergency Rollback Runbook)

Nếu sau khi triển khai bản cập nhật trên nhánh `main` phát hiện lỗi nghiêm trọng (API trả về HTTP 500, dữ liệu tính toán sai lệch, giao diện bị treo), đội ngũ vận hành thực thi ngay lập tức quy trình 7 bước sau với **thời gian khôi phục mục tiêu (RTO) < 5 phút**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          QUY TRÌNH 7 BƯỚC KHÔI PHỤC KHẨN CẤP (RTO < 5 PHÚT)            │
├──────┬────────────────────────────────────────────┬────────────────────────┬───────────┤
│ BƯỚC │ HÀNH ĐỘNG                                  │ LỆNH THỰC THI          │ RTO SLA   │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B1   │ Tạm dừng tức thì luồng đồng bộ Shopee      │ curl -X POST           │ < 5 giây  │
│      │ để chống lan truyền dữ liệu lỗi lên sàn    │ :51898/shopee/pause    │           │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B2   │ Rollback mã nguồn về Commit ổn định        │ git reset --hard <TAG> │ < 30 giây │
│      │ đã được gắn thẻ (tagged release)           │                        │           │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B3   │ Phục hồi CSDL SQLite từ tệp sao lưu        │ copy /y db\custom.db.  │ < 30 giây │
│      │ đóng băng trước nâng cấp                   │ bak.* db\custom.db     │           │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B4   │ Phục hồi CSDL Supabase PostgreSQL qua      │ curl -X POST :3010/    │ < 90 giây │
│      │ Test-Guard RESTORE_AND_CLEAN hoặc SQL dump │ api/ledger/test-guard  │           │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B5   │ Khởi động lại CMS Standalone               │ .\run-production.bat   │ < 45 giây │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B6   │ Kiểm chứng bất biến shop thaimy1605        │ node scripts/          │ < 30 giây │
│      │ và độ sạch 24 bảng cốt lõi (Delta = 0)     │ check-counts.mjs       │           │
├──────┼────────────────────────────────────────────┼────────────────────────┼───────────┤
│ B7   │ Mở lại luồng đồng bộ Shopee Daemon         │ curl -X POST           │ < 5 giây  │
│      │ để xả đơn hàng từ Spool Queue              │ :51898/shopee/resume   │           │
├──────┴────────────────────────────────────────────┴────────────────────────┴───────────┤
│ TỔNG THỜI GIAN KHÔI PHỤC (ACTUAL RTO BUDGET): 235 GIÂY (~3.9 PHÚT) < 5 PHÚT            │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Hướng Dẫn Chi Tiết Từng Bước Khôi Phục:

#### Bước 1: Ngắt Tức Thì Luồng Ghi Shopee
Ngăn chặn mọi thay đổi từ hệ thống đang lỗi bắn lên sàn Shopee thật:
```bash
curl -s -X POST http://127.0.0.1:51898/shopee/pause
```

#### Bước 2: Rollback Mã Nguồn Git
Đưa mã nguồn tại thư mục làm việc về commit tag gần nhất hoạt động tốt (ví dụ: `v2.6.0-stable`):
```bash
git fetch origin main
git reset --hard HEAD~1
# Hoặc: git checkout tags/v2.6.0-stable
```

#### Bước 3: Phục Hồi CSDL SQLite Cục Bộ
Ghi đè file `.db` bằng bản sao lưu có mã băm SHA-256 đã kiểm chứng ở Mục 3.1:
```powershell
Copy-Item "db\custom.db.bak.pre-autosocial" -Destination "db\custom.db" -Force
```

#### Bước 4: Phục Hồi Dữ Liệu Supabase PostgreSQL
Gọi điểm cuối Test-Guard với hành động phục hồi vô điều kiện:
```bash
curl -s -X POST http://127.0.0.1:3010/api/ledger/test-guard -H "Content-Type: application/json" -d "{\"action\":\"RESTORE_AND_CLEAN\"}"
```
*Ghi chú*: Điểm cuối này kích hoạt cơ chế 5-Group Topological Cascade Teardown, dọn sạch 100% bản ghi rác và phục hồi nguyên vẹn thuộc tính tồn kho (`307/307`) và giá bán của 17 sản phẩm thật của shop `thaimy1605`.

#### Bước 5: Khởi Động Lại Hệ Thống Standalone
Kích hoạt bộ khởi chạy 1-Click:
```powershell
powershell -ExecutionPolicy Bypass -File .\start-cms.ps1 -Production
```

#### Bước 6: Kiểm Chứng Nghiệm Thu Bất Biến (Delta = 0)
Chạy kiểm tra đối soát 24 bảng CSDL cốt lõi:
```bash
node scripts/check-counts.mjs
```
*Yêu cầu bắt buộc*: Phải in ra `Core Parity Status: 100% MATCH (PASS)`.

Kiểm tra bất biến chi tiết SKU:
```bash
npx tsx -e "import { assert13RealProductsInvariant } from './scripts/test_guard_helper'; assert13RealProductsInvariant().then(r => console.log('PASS:', r.summary));"
```
*Yêu cầu bắt buộc*: In ra `🛡️ [INVARIANT AUDIT] Kiểm toán 13 sản phẩm shop thaimy1605: ĐẠT 100% (DELTA = 0)`.

#### Bước 7: Mở Lại Luồng Đồng Bộ Shopee
Sau khi toàn bộ dịch vụ đã xanh (All Green):
```bash
curl -s -X POST http://127.0.0.1:51898/shopee/resume
```
Daemon sẽ tự động quét và xả toàn bộ đơn hàng tích lũy trong tệp `.shopee_inbound_queue.json` vào CMS.

---

## 7. Các Quy Trình Vận Hành Định Kỳ (Routine Maintenance SOP)

### 7.1 Kiểm Soát Tệp WAL SQLite Định Kỳ (Mỗi 6 Giờ)
Để tệp `custom.db-wal` không phình to trên ổ cứng Windows, daemon ngầm hoặc cron định kỳ chạy:
```sql
PRAGMA wal_checkpoint(PASSIVE);
```

### 7.2 Xử Lý Hàng Đợi Lỗi Dead Letter Queue (`.shopee_dlq.json`)
Nếu có webhook từ Shopee bị lỗi cú pháp hoặc mạng chập chờn quá 5 lần retry, daemon sẽ ghi vào `scripts/.shopee_dlq.json`.
1. Kiểm tra danh sách DLQ: `curl -s http://127.0.0.1:51898/shopee/queue`.
2. Kiểm tra log chi tiết: `scripts/.shopee_sync.log`.
3. Sau khi khắc phục nguyên nhân, kích hoạt re-drive qua endpoint `/shopee/trigger-sync`.

### 7.3 Gia Hạn Phiên Đăng Nhập Shopee Qua Chrome CDP (Port 9222)
Khi Cookie Shopee hết hạn:
1. Nhấp đúp kịch bản `launch-chrome-shopee.bat`.
2. Đăng nhập tài khoản shop `thaimy1605` tại `https://banhang.shopee.vn`.
3. Daemon Shopee sẽ tự động bắt Cookie mới qua Chrome DevTools Protocol (CDP port 9222) trong vòng 20 giây và cập nhật lại phiên làm việc mà không cần khởi động lại dịch vụ.
