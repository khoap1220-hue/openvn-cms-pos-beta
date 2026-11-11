# Sổ Tay Bàn Giao Vận Hành & Khung Bảo Trì Tự Chủ (Operational Handover & Autonomous Maintenance)
**Dự Án**: OPENVN · Ưu Đàm Suite (Multi-Channel Omnisales & Zero-Storage CDN)  
**Tệp Tài Liệu**: `HANDOVER_MAINTENANCE.md`  
**Phiên Bản**: v2.6.0 Production  
**Gian Hàng Trọng Tâm**: Shop Shopee `thaimy1605` (Shop ID: `288333857`, 17 SKU Bất Biến)  
**Tiêu Chuẩn Tuân Thủ**: Quy tắc Bắt buộc Triển khai Free Beta & Chuẩn Kỹ sư Senior Human Engineer (TIER 5)

---

## 1. Thông Tin Bàn Giao & Kiến Trúc Vận Hành Độc Lập (System Handover Overview)

Hệ thống OPENVN · Ưu Đàm Suite đã được đóng gói thành cụm 3 phân hệ tự chủ, hỗ trợ vận hành 24/7 cả trên máy chủ cục bộ Windows/Linux lẫn nền tảng điện toán đám mây Docker / Render / GitHub Pages Free Beta:

- **Phân Hệ 1 (Fullstack CMS & POS)**: Next.js 16.1.1 Standalone Server (Node.js 22), cổng mặc định `3010` (hoặc `PORT=3000` trong container). Tích hợp L1 RAM Cache, hỗ trợ CSDL kép SQLite WAL (`db/custom.db`) và Supabase PostgreSQL (`DATABASE_URL`).
- **Phân Hệ 2 (Realtime WebSocket Event Bus)**: Socket.io Standalone Service (`mini-services/realtime`), cổng mặc định `3013` (hoặc `REALTIME_PORT=3003`). Phát sóng thời gian thực cho các sự kiện đơn hàng, vận đơn, tồn kho và thay đổi danh mục sản phẩm.
- **Phân Hệ 3 (Shopee Seller Sync Daemon 24/7)**: Kịch bản Python 3 (`scripts/shopee_seller_sync.py`), cổng HTTP Bridge `51898` kết nối Chrome DevTools Protocol cổng `9222` (`launch-chrome-shopee.bat`). Quản lý hàng đợi đệm Spool Queue 2 chiều (`.shopee_inbound_queue.json`) và cổng upload ảnh Zero-Storage Media CDN Pointer (`/shopee/upload-image`).
- **Bản Demo Live 24/7 (GitHub Pages CDN `$0`)**: `https://khoap1220-hue.github.io/openvn-cms-pos-beta/`
- **Kênh Đồng Bộ 2 Chiều Cloud 24/7**: `https://ntfy.sh/openvn_sync2way_openvn_cms_pos_beta_v1`

---

## 2. Bộ Lệnh Khởi Chạy & Triển Khai Độc Lập (Independent Deployment Commands)

Dự án cung cấp đầy đủ các kịch bản khởi chạy 1-Click độc lập, không phụ thuộc vào công cụ ngoài:

### 2.1 Khởi Chạy Trên Môi Trường Windows & POSIX (1-Click Launchers)
1. **Chế độ Vận hành Thực tế (Production Standalone — Khuyên dùng)**:
   ```cmd
   run.bat
   :: hoặc: run-production.bat
   :: trên Linux/macOS: ./start.sh
   ```
   *Cơ chế ngầm*: Gọi `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-cms.ps1 -Production` (hoặc `./start.sh` trên POSIX). Tự động kiểm tra `node_modules`, sinh Prisma client, khởi động ngầm Realtime Bus (:3013) và Shopee Daemon (:51898), biên dịch standalone nếu chưa có và khởi chạy `node .next/standalone/server.js` tại cổng `3010`.
2. **Nâng Cấp Không Gián Đoạn Trên Nhánh Chính (`Safe Upgrade on Main`)**:
   ```bash
   # Diễn tập kiểm tra an toàn (Dry-Run — không ghi DB):
   npm run ops:upgrade:dry

   # Thực thi nâng cấp chuẩn (Drain -> Read-Only 503 -> WAL Backup SHA-256 -> Build -> Verify -> Resume):
   npm run ops:upgrade
   ```
3. **Khởi chạy Điều phối PowerShell Trực tiếp**:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-cms.ps1 -Production
   ```
4. **Quản lý Vòng đời Shopee Seller Sync Daemon (`run-shopee-sync.bat`)**:
   - Khởi động daemon:
     ```cmd
     run-shopee-sync.bat start
     ```
   - Dừng daemon (tự tìm PID chiếm cổng 51898 và hủy an toàn):
     ```cmd
     run-shopee-sync.bat stop
     ```
   - Khởi động lại:
     ```cmd
     run-shopee-sync.bat restart
     ```
   - Kiểm tra trạng thái HTTP Bridge:
     ```cmd
     run-shopee-sync.bat status
     ```
   - Chạy chế độ Thử nghiệm An toàn (Isolated Test Mode — Bật cờ `SHOPEE_OUTBOX_DRY_RUN=1` và `SHOPEE_INBOUND_DISABLE=1` để bảo vệ 100% dữ liệu gian hàng thật):
     ```cmd
     run-shopee-sync.bat test
     ```
5. **Mở Trình duyệt Chrome Kết nối Phiên Shopee (`launch-chrome-shopee.bat`)**:
   ```cmd
   launch-chrome-shopee.bat
   ```
   *Cơ chế*: Mở Google Chrome với cờ `--remote-debugging-port=9222 --remote-allow-origins=* "https://banhang.shopee.vn"`, cho phép Shopee Daemon tự động bắt Cookie và gia hạn phiên qua CDP.

### 2.2 Khởi Chạy Qua Docker & Container Compose
1. **Khởi động Container Cụm (Multi-Process Container)**:
   ```bash
   docker compose up -d --build
   ```
2. **Cấu Trúc Multi-Stage Dockerfile**:
   - Sử dụng nền tảng `node:22-alpine` kết hợp `python3 py3-pip py3-websockets ca-certificates`.
   - Tiến trình khởi động trung tâm: `docker-entrypoint.sh` khởi chạy đồng thời Realtime Service, Shopee Daemon ngầm, và Next.js server tại cổng `3000`.
   - Tích hợp `HEALTHCHECK` thăm dò định kỳ `http://127.0.0.1:3000/api/health`.

### 2.3 Triển Khai Cloud Blueprint (Render Free Tier)
- Cấu hình qua tệp `render.yaml`:
  - Dịch vụ Web Service kiểu `docker`, gắn với nhánh `main`.
  - Tự động kiểm tra sức khỏe tại đường dẫn `/api/health`.
  - Không rò rỉ bí mật (`Zero-Secret Leak`): Mọi biến môi trường nhạy cảm (`DATABASE_URL`, `CMS_ADMIN_PASSWORD`) được nạp qua Render Dashboard Secret Management.

### 2.4 Cập Nhật & Đồng Bộ Bản Live Free Beta
- Nhấp đúp `deploy-beta.bat` để tự động kéo phản hồi mới nhất, chụp dữ liệu SQLite và phát hành bản cập nhật tĩnh lên GitHub Pages `$0`.
- Chạy nền daemon đồng bộ 2 chiều:
  ```bash
  python deploy_beta.py --watch
  ```

---

## 3. Quy Trình Tiếp Nhận Báo Lỗi & Bảo Trì Tự Chủ (Maintenance & Bug Reception Instructions)

Tuân thủ nghiêm ngặt Quy tắc Bắt buộc Khi Triển Khai Sản Phẩm Free Beta:

### 3.1 Cấu Trúc Thư Mục Tiếp Nhận Lỗi (`beta-feedback/`)
Mọi phản hồi và dữ liệu nghiệm thu được lưu trữ tập trung tại thư mục `beta-feedback/`:
- `beta-feedback/FEEDBACK_LIST.md`: Bảng tổng hợp danh sách lỗi và ý kiến đóng góp từ người dùng/tester.
- `beta-feedback/feedback_inbox.json`: Tệp lưu trữ dữ liệu JSON cấu trúc của các báo lỗi.
- `beta-feedback/screenshots/`: Kho lưu trữ ảnh chụp màn hình bằng chứng sự cố.
- Đồng bộ phản hồi về máy cục bộ:
  ```bash
  python deploy_beta.py --sync-feedback
  ```

### 3.2 Chuẩn Giao Diện Widget Báo Lỗi Mobile-First
- **Hình thức nút báo lỗi**: Bắt buộc sử dụng dạng **Icon Máy Ảnh mờ (`34×34px`, `opacity: 0.28`, trượt dọc mép phải màn hình)**.
- **Tự động chụp màn hình**: Khi người dùng chạm/bấm vào icon, widget tự động chụp màn hình hiện tại kèm đánh dấu DOM.
- **Tuyệt đối cấm**: Gắn thanh chữ hoặc banner lớn ở đáy màn hình gây che khuất thanh điều hướng Mobile (Bottom Navigation Bar) của POS/CMS.

### 3.3 Hiển Thị Trực Tuyến & Cho Phép Điều Chỉnh / Rút Lại
- Widget báo lỗi luôn hiển thị danh sách các phản hồi đã gửi trực tuyến.
- Người dùng có thể xem lại nội dung đã báo cáo và bấm **✏️ Điều chỉnh** hoặc **🗑️ Rút lại** trực tiếp trên giao diện để tránh báo nhầm.

### 3.4 Nguyên Tắc Cốt Lõi: Phản Hồi Beta Chỉ Mang Tính Tham Khảo (Advisory-Only Feedback)
- **TÍNH CHẤT BẮT BUỘC**: Mọi phản hồi từ người dùng test Beta mặc định chỉ mang tính chất **Ghi nhận tham khảo về hệ thống (`Advisory / Reference Only`)**, **KHÔNG PHẢI** yêu cầu bắt buộc phải sửa code ngay.
- **BẢO VỆ KIẾN TRÚC**: Nhằm tránh tình trạng người test mô tả cảm tính hoặc hiểu sai nghiệp vụ gây hỏng cấu trúc dự án:
  - Agent và kỹ sư **TUYỆT ĐỐI KHÔNG TỰ Ý THAY ĐỔI** kiến trúc cốt lõi (Database Schema, API Contract, Router, State Machine) chỉ dựa trên mô tả chủ quan của tester.
  - Bắt buộc phải đối chiếu ảnh chụp màn hình, kiểm tra DOM thực tế và có sự phê duyệt của chủ dự án trước khi thực hiện bất kỳ thay đổi nào liên quan đến cấu trúc.

---

## 4. Bảo Toàn Dữ Liệu Shop thaimy1605 & Cơ Chế Test-Guard (Delta = 0)

Để đảm bảo hệ thống vừa có thể kiểm thử tự động toàn diện vừa bảo vệ tuyệt đối dữ liệu vận hành thực tế của shop `thaimy1605`:

### 4.1 Điểm Cuối Test Isolation Guard (`/api/ledger/test-guard`)
1. **Hành Động `SNAPSHOT` (Trước khi chạy test)**:
   - Gửi yêu cầu: `POST /api/ledger/test-guard` `{ "action": "SNAPSHOT" }`.
   - Hệ thống lưu trạng thái hiện tại vào khóa `beta_test_snapshot_v1`.
   - **Khóa Chuẩn Bất Biến (Canonical Locking)**: 17 sản phẩm thật của shop `thaimy1605` được neo cứng thông số tồn kho (`307/307`) và giá bán, không bao giờ bị đóng băng dữ liệu lỗi.
2. **Hành Động `RESTORE_AND_CLEAN` (Ngay sau khi test xong)**:
   - Gửi yêu cầu: `POST /api/ledger/test-guard` `{ "action": "RESTORE_AND_CLEAN" }`.
   - Kích hoạt **Quy trình dọn dẹp 5 nhóm Topo (5-Group Topological Cascade Teardown)**:
     - Nhóm 1 (Lá/Nhật ký): `WebhookDelivery` -> `DirectMessage` -> `BehaviorLog` -> `AgentActivity` -> `AuditLog` -> `LedgerEntry`.
     - Nhóm 2 (Hóa đơn/Vận đơn): `SalesInvoiceItem` -> `SalesInvoice` -> `PurchaseInvoiceItem` -> `PurchaseInvoice` -> `AfterSalesCase` -> `Shipment` -> `OrderEvent`.
     - Nhóm 3 (Đơn hàng/Thẻ kho): `OrderItem` -> `Order` -> `StockMovement`.
     - Nhóm 4 (BOM/Tồn kho): `BomComponent` -> `ChannelListing` -> `WarehouseStock` -> `Product` (bảo vệ danh sách trắng `PROTECTED_REAL_SKUS`).
     - Nhóm 5 (Gốc/Tiếp thị): `Customer` -> `Partner` -> `Campaign` -> `Voucher`.
   - Tự động dọn sạch Spool Queue (`.shopee_inbound_queue.json`, `.shopee_dlq.json`).
   - Phục hồi 100% thuộc tính của 17 sản phẩm shop `thaimy1605` trên cả Supabase PostgreSQL và SQLite cục bộ (`db/custom.db`).

### 4.2 Bộ Hook Bảo Vệ Tiến Trình Chống Crash (`registerProcessGuard`)
Module `scripts/test_guard_helper.ts` tích hợp hook chặn mọi sự kiện ngắt đột ngột (`SIGINT`, `SIGTERM`, `uncaughtException`, `unhandledRejection`, `process.exit`). Kể cả khi tiến trình test bị tắt cưỡng bức, lệnh dọn dẹp `RESTORE_AND_CLEAN` vẫn luôn được kích hoạt để đảm bảo dữ liệu không bao giờ bị ô nhiễm.

### 4.3 Chuẩn Đối Soát Baseline 24 Bảng CSDL Cốt Lõi (`db/baseline-counts.json`)
Tệp `db/baseline-counts.json` lưu trữ định lượng chuẩn xác của CSDL sản xuất sạch (Clean Operational Baseline):
- `Product`: 17 (17 SKU chuẩn của shop `thaimy1605`)
- `Category`: 1
- `Order`: 3 | `OrderItem`: 2 | `Customer`: 3 | `SalesInvoice`: 3
- `Warehouse`: 1 | `WarehouseStock`: 17
- `StockMovement`: 4 | `AccountingPeriod`: 5 | `Channel`: 10 | `ChannelListing`: 40
- `IntegrationCredential`: 14 | `ApiKey`: 1 | `WebhookEndpoint`: 2 | `AutomationSetting`: 7 | `OrderEvent`: 12
- Các bảng không phát sinh rác: `PurchaseInvoice` (0), `Voucher` (0), `BomComponent` (0), `Partner` (0), `Shipment` (0), `AfterSalesCase` (0).

Lệnh kiểm toán đối soát:
```bash
node scripts/check-counts.mjs
```
*Kết quả bắt buộc nghiệm thu*: `Core Parity Status: 100% MATCH (PASS)`.

---

## 5. Danh Mục Kiểm Tra Nghiệm Thu Vận Hành (Operational Verification Checklist)

Mọi kỹ sư hoặc hệ thống CI/CD trước khi bàn giao và đưa phiên bản mới vào phục vụ đều phải kiểm tra đạt 100% các tiêu chí sau:

- [ ] **Kiểm tra biên dịch TypeScript không lỗi**:
  ```bash
  npx tsc --noEmit
  ```
  *(Kỳ vọng: Thoát mã 0, 0 lỗi cú pháp/kiểu dữ liệu).*
- [ ] **Kiểm tra độ toàn vẹn 24 bảng CSDL cốt lõi**:
  ```bash
  node scripts/check-counts.mjs
  ```
  *(Kỳ vọng: 24/24 bảng MATCH, Core Parity Status: 100% MATCH (PASS)).*
- [ ] **Kiểm tra sức khỏe 4 tầng dịch vụ**:
  ```bash
  node scripts/ops-healthcheck.mjs
  ```
  *(Kỳ vọng: Cả 4 dịch vụ SQLite, Realtime Bus, Shopee Daemon, CMS Gateway đều báo OK).*
- [ ] **Kiểm toán bất biến 17 sản phẩm shop thaimy1605 (Delta = 0)**:
  ```bash
  npx tsx -e "import { assert13RealProductsInvariant } from './scripts/test_guard_helper'; assert13RealProductsInvariant().then(r => console.log('PASS:', r.summary));"
  ```
  *(Kỳ vọng: stockDelta === 0 && priceDelta === 0).*
- [ ] **Xác nhận trạng thái Test-Guard sạch hoàn toàn**:
  ```bash
  curl -s http://127.0.0.1:3010/api/ledger/test-guard
  ```
  *(Kỳ vọng: `{"ok": true, "clean": true, "leftoverCount": 0}`).*
