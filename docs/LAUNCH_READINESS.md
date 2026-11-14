# Hồ Sơ Sẵn Sàng Đưa Vào Vận Hành (`docs/LAUNCH_READINESS.md`)

> Chuẩn hóa theo kỹ năng **`matrix-san-sang-phat-hanh`** & **`matrix-san-sang-thuong-mai-ra-mat`** cho hệ thống **OPENVN · Ưu Đàm Suite (v2.6.0)**.

## 1. Tóm Tắt Trạng Thái Kỹ Thuật & Vận Hành

| Hạng mục Kiểm định | Cổng Kiểm chứng | Kết quả | Ghi chú Vận hành |
| :--- | :--- | :---: | :--- |
| **Kiểu tĩnh TypeScript** | `npx tsc --noEmit` | 🟢 **PASS** (`0 errors`) | Tương thích hoàn toàn Next.js 16.4.3 & React 19 |
| **Chuẩn mã nguồn ESLint** | `npm run lint` | 🟢 **PASS** (`0 errors, 0 warnings`) | Toàn bộ `src/` sạch 100% cảnh báo |
| **Chuẩn Next.js 16 Proxy** | `src/proxy.ts` | 🟢 **PASS** | Đã nâng cấp từ `middleware.ts` sang `proxy.ts`, mở luồng tài nguyên tĩnh & trang công khai |
| **Đóng gói Production** | `npm run build` | 🟢 **PASS** | Standalone bundle `.next/standalone` đồng bộ sang `.runtime/standalone/server.js` |
| **Toàn vẹn Sổ kho (`StockMovement`)** | `npm run test:chain` | 🟢 **PASS** | Chuỗi biến động kho khớp 100% tồn kho thực tế |
| **Master Production Suite** | `npm run test:master` | 🟢 **PASS** (`139/139`) | Bao phủ Fast Write L1 Cache, Zero-Storage CDN, 24 bảng CSDL & Test-Guard `thaimy1605` |
| **Master E2E Suite (8 Bộ)** | `npm run test:e2e` | 🟢 **PASS** (`8/8 Suites`) | Bao phủ R1–R7, 21 kịch bản thực tế & 113 kiểm định Auto Social |
| **Hội viên & Chiến dịch CRM** | `npm run test:loyalty` | 🟢 **PASS** (`11/11`) | Tích/tiêu điểm, 4 hạng thẻ, sóng ưu đãi theo sản phẩm |
| **Kiểm tra Sức khỏe Trực tuyến** | `npm run ops:health` | 🟢 **PASS** (`4/4 Green`) | Kiểm tra SQLite header + Realtime `:3013` + Shopee Sync `:51898` + API Gateway `:3010` |

---

## 2. Cấu Hình Triển Khai & Biến Môi Trường Chuẩn

Tệp `.env` mẫu (tuyệt đối không lưu khóa bí mật thật vào Git):
```env
DATABASE_URL="file:../db/custom.db"
PORT="3010"
REALTIME_PORT="3013"
REALTIME_URL="http://localhost:3013"
NEXT_PUBLIC_REALTIME_PORT="3013"
CMS_ADMIN_PASSWORD="<ĐỔI_MẬT_KHẨU_MẠNH_KHI_GO_LIVE>"
CMS_REQUIRE_AUTH="true"
```

### Quy tắc Mạng & Cổng Dịch vụ
- **Cổng `3010`**: Phục vụ giao diện Quản trị CMS (`/`), Quầy POS độc lập (`/pos`, `/store`), Blog công khai (`/blog`), và Cổng API/Webhook (`/api/*`).
- **Cổng `3013`**: Phục vụ Socket.io Realtime Bus (`/health`, `/emit`, `/?EIO=4&transport=websocket`).
- **Truy cập từ xa qua Cloudflare Tunnel / Reverse Proxy**: Next.js `rewrites()` trong `next.config.ts` tự động chuyển tiếp lưu lượng `?EIO=*` về cổng `REALTIME_PORT` nội bộ mà không cần mở thêm cổng phụ ra Internet.

---

## 3. Kế Hoạch Sao Lưu, Khôi Phục & Rollback Khẩn Cấp

### A. Sao lưu Định kỳ (Backup)
1. **Trên giao diện CMS**: Vào **Hệ thống → Sao lưu & Đưa vào Vận hành Thực tế → Tải bản sao lưu Database (`.db`)** (`GET /api/system/backup`). Hệ thống tự động thực hiện `PRAGMA wal_checkpoint(PASSIVE)` trước khi xuất tệp để đảm bảo toàn vẹn 100% giao dịch đang mở.
2. **Tệp gốc trên máy chủ**: `db/custom.db` (kèm bản sao an toàn `db/custom.db.bak`).

### B. Quy trình Khôi phục / Rollback trong 2 Phút
1. Dừng tiến trình Next.js (`:3010`) và Realtime (`:3013`).
2. Sao lưu tệp hiện tại sang `db/custom.db.incident-<timestamp>`.
3. Chép tệp sao lưu chuẩn (`uudam-cms-backup-*.db` hoặc `db/custom.db.bak`) đè vào `db/custom.db` (xóa `db/custom.db-wal` và `db/custom.db-shm` cũ nếu có).
4. Chạy `npm run test:chain` để xác nhận tính toàn vẹn sổ kho.
5. Khởi động lại hệ thống bằng `run-production.bat` và xác nhận bằng `npm run ops:health`.

---

## 4. Các Cổng Phê Duyệt Của Chủ Tiệm Trước Giờ G (`Human-Review Gates`)

> [!IMPORTANT]
> Các hạng mục dưới đây thuộc thẩm quyền pháp lý và tài chính của chủ doanh nghiệp — cần chủ tiệm trực tiếp điền và kiểm tra trước khi mở bán chính thức:

- [ ] **Bảo mật quản trị**: Đổi mật khẩu quản trị tại **Hệ thống → Bảo mật & Đăng nhập Quản trị** và bật **Yêu cầu đăng nhập khi mở CMS**.
- [ ] **Thông tin pháp lý & Thuế GTGT**: Kiểm tra chính xác Mã số thuế, Tên pháp nhân, Địa chỉ, Mẫu số (`01GTKT0/001`), Ký hiệu hóa đơn (`AA/26E`) và thuế suất VAT mặc định (`8%` hoặc `10%`).
- [ ] **Tài khoản Ngân hàng nhận tiền VietQR & SePay**: Đối chiếu Số tài khoản, Mã ngân hàng VietQR, quét thử mã QR mẫu `100.000đ` trên `SystemView`, và dán `Webhook Secret / API Key` từ `my.sepay.vn` vào `IntegrationsView` (trỏ webhook SePay về `https://<ten-mien-cua-ban>/api/webhooks/inbound`).
- [ ] **Token Đối tác Vận chuyển & Kênh Mạng xã hội**: Chuyển các kênh sử dụng thật (`GHN`, `GHTK`, `Zalo OA`, `Facebook Fanpage`, `Gemini AI`) từ chế độ `Safe Mock` sang Token thật và bấm nút **Test kết nối / Đăng bài Test lên Fanpage**.
- [ ] **Chốt Tồn kho Đầu kỳ**: Kiểm kê thực tế tại kho, sau đó thực hiện **Go-Live Reset** (nếu muốn xóa toàn bộ đơn mẫu) hoặc điều chỉnh tồn đầu kỳ tại `InventoryView`.
