# Sổ Tay Vận Hành & Khai Thác Hệ Thống (`docs/OPERATIONS_RUNBOOK.md`)

## 1. Kiến trúc Dịch vụ khi Vận hành
Hệ thống **OPENVN · Ưu Đàm Suite (v2.6.0)** vận hành gồm 3 tiến trình song song:
1. **CMS, POS & Public Blog Server (Next.js 16.4.3 Standalone / App Router)**: chạy tại cổng `3010`:
   - `http://localhost:3010/` — Trung tâm Quản trị CMS & Hạch toán Nội bộ
   - `http://localhost:3010/pos` (và `/store`) — Quầy POS Bán tại kho toàn màn hình (hỗ trợ cả máy tính bảng / thiết bị trong cùng mạng LAN `0.0.0.0:3010`)
   - `http://localhost:3010/blog` — Chuyên trang Blog & Tin tức công khai (*Ưu Đàm Tạp Bút*)
   - `http://localhost:3010/login` — Cổng Đăng nhập Quản trị viên (tự động điều hướng về trang đích `?next=...`)
2. **Realtime Event Bus (Socket.io Server)**: chạy tại cổng `3013` (`http://localhost:3013`), phát sóng tức thì các sự kiện đơn hàng, vận đơn, biến động số dư SePay, tồn kho và tin nhắn Zalo; tự động fallback sang polling 10 giây nếu mất kết nối WebSocket.
3. **Shopee Seller Sync Daemon (Python HTTP Bridge)**: chạy tại cổng `51898` (`http://localhost:51898/shopee/status`), đồng bộ danh mục/hàng đợi 2 chiều với shop `thaimy1605` (`197195817`) và gia hạn phiên qua Chrome CDP cổng `9222`.

---

## 2. Lệnh Khởi động 1-Click & Kiểm tra Sức khỏe (`ops:health`)

### A. Khởi động 1-Click trên Windows
- **Chế độ Vận hành Thực tế (Production Standalone — Khuyên dùng tại cửa hàng)**:
  - Nhấp đúp `run-production.bat` (hoặc chạy `powershell -ExecutionPolicy Bypass -File .\start-cms.ps1 -Production`).
  - Tự động ánh xạ đường dẫn tuyệt đối tới `db/custom.db`, khởi động Realtime Service (`:3013`) và Shopee Daemon (`:51898`), đóng gói bản build nếu chưa có, đồng bộ sang `.runtime/standalone` và chạy `node .runtime/standalone/server.js` tốc độ cao.
- **Chế độ Phát triển / Tinh chỉnh giao diện (Development)**:
  - Nhấp đúp `run-cms.bat` (hoặc chạy `powershell -ExecutionPolicy Bypass -File .\start-cms.ps1`).

### B. Khởi động trên Linux Server / Docker
```bash
docker compose up -d --build
```
Container tự động kích hoạt `HEALTHCHECK` định kỳ 30 giây kiểm tra đồng thời cả API Gateway (`:3000/api`) và Realtime Bus (`:3003/health`).

### C. Kiểm tra Sức khỏe Hệ thống Tức thì (1 Lệnh)
```bash
npm run ops:health
```
Lệnh `scripts/ops-healthcheck.mjs` kiểm định 4 tầng:
1. **SQLite Database (`db/custom.db`)**: Tồn tại, đọc được và đúng chuẩn binary header `SQLite format 3`.
2. **Realtime Event Bus (`GET :3013/health`)**: Phản hồi `200 OK`, báo cáo uptime và số kết nối trực tuyến.
3. **Shopee Sync Daemon (`GET :51898/shopee/status`)**: Phản hồi `200 OK`, báo cáo `shop=thaimy1605 [197195817]` và `dlq=0`.
4. **CMS & API Gateway (`GET :3010/api`)**: Phản hồi `200 OK` (`status: 'healthy'`, `version: '2.6.0'`) kèm số liệu sản phẩm, đơn hàng, kho và kênh bán trực tiếp.

---

## 3. Quy Trình Đưa Vào Vận Hành Ngày Đầu Tiên (Day-1 Go-Live Checklist)

1. **Sao lưu an toàn dữ liệu hiện tại**:
   - Vào **Hệ thống (`SystemView`) → Sao lưu & Đưa vào Vận hành Thực tế** → bấm **Tải bản sao lưu Database (`.db`)** để lưu tệp `uudam-cms-backup-YYYYMMDD-HHMM.db` về máy.
2. **Đổi mật khẩu Quản trị viên & Bật khóa bảo vệ**:
   - Tại mục **Bảo mật & Đăng nhập Quản trị**, đặt mật khẩu mới (thay cho mật khẩu mặc định) và bật công tắc **Yêu cầu đăng nhập khi mở CMS**.
   - Các trang công khai (`/blog`, tài nguyên hình ảnh, `/api/webhooks/inbound`, health probe `GET /api`) vẫn hoạt động bình thường cho khách hàng và đối tác webhook.
3. **Cập nhật Thông tin Đơn vị & Mẫu Hóa đơn VietQR**:
   - Điền Tên đơn vị, Mã số thuế, Địa chỉ, SĐT, chọn **Mã ngân hàng VietQR** + Số tài khoản + Chủ tài khoản và kiểm tra ảnh QR xem trước ngay trên màn hình.
4. **Cấu hình Key Đối tác & Ngân hàng SePay (`IntegrationsView`)**:
   - Vào **Kết nối API & Webhook**: cấu hình **SePay (`Biến động số dư Ngân hàng & VietQR`)**, ĐVVC (`GHN`, `GHTK`, `Viettel Post`), `Zalo OA`, Sàn TMĐT hoặc `Facebook Fanpage` / `Social Webhook Hub (Make/n8n/Zapier)`.
   - Khi chưa nhập token thật, hệ thống vận hành ở chế độ **Safe Mock / Sandbox cô lập 100%** để nhân viên diễn tập an toàn.
5. **Làm sạch dữ liệu giao dịch mẫu (`Go-Live Reset`)**:
   - Tại **Hệ thống → Làm sạch dữ liệu mẫu (Go-Live)**, nhập mã xác nhận `GO-LIVE`:
   - Hệ thống xóa toàn bộ đơn hàng/vận đơn/hóa đơn mẫu, tắt chế độ giả lập 30s (`simulation_mode = false`), đồng bộ tồn kho đầu kỳ cả `Product.stock` và `WarehouseStock`, giữ nguyên 100% danh mục sản phẩm, BOM, kho, kênh bán và mẫu hóa đơn.

---

## 4. Quy Trình Vận Hành Chuẩn Theo Ca (Shift-by-Shift SOP)

### A. Đầu Ca Trực (5 phút)
1. Mở **Tổng quan kinh doanh** (`http://localhost:3010/`) và kiểm tra huy hiệu **● Realtime** màu xanh trên góc phải thanh công cụ.
2. Quan sát dải **Việc cần xử lý trong ngày**:
   - Kiểm tra **Sắp hết hàng** → nếu `> 0`, bấm vào để lập **Đơn mua hàng / Nhập kho NCC (`PurchaseView`)**.
   - Kiểm tra **Tin nhắn Zalo chưa đọc** → theo dõi phản hồi của Agent tại **Chat đa kênh (`InboxView`)**.

### B. Trong Ca — Bán Hàng Tại Kho (`OPENVN POS` — `/pos`)
1. Mở phân hệ **Bán tại kho (POS)** hoặc tab độc lập `http://localhost:3010/pos` và chọn **Kho xuất bán**.
2. Quét mã vạch sản phẩm (`F2`) hoặc tìm theo tên/SKU (`F3`); kiểm tra tồn kho tại chỗ và nhãn **`Bán chéo · HH X%`** cho hàng đối tác liên kết.
3. Tra cứu SĐT **Hội viên (`TV0001`)**, áp dụng 1 chạm **Mã Voucher**, chiết khấu nhanh hoặc đổi điểm thưởng (`1 điểm = 1.000đ`).
4. Bấm `F9 (Thanh toán & Xuất kho ngay)` để hoàn tất đơn, trừ kho nguyên tử, cộng điểm hội viên, phát hành hóa đơn bán và in phiếu nhiệt **K80** (hỗ trợ ESC/POS WebUSB/WebSerial hoặc `window.print`).
5. Nếu khách chuyển khoản ngân hàng qua mã **VietQR + SePay**, webhook `/api/webhooks/inbound` (`INBOUND_SEPAY_TRANSACTION`) tự động nhận diện mã đơn `DH...` (kể cả khi ngân hàng lược bỏ dấu gạch ngang `-`), chuyển trạng thái thanh toán sang **`PAID`** và phát sóng realtime lên màn hình thu ngân.

### C. Trong Ca — Thao Tác Bảng Dữ Liệu Tùy Biến & Chi Tiết Màn Hình Rộng
1. **Tùy chỉnh Cột Dữ liệu động** (trên *Sản phẩm*, *Đơn hàng*, *Khách hàng*, *Tồn kho*):
   - Bấm các pill `+ Mã SKU`, `+ Giá vốn`, `+ Lợi nhuận gộp`, `+ SĐT Khách`, `+ Phí sàn TMĐT`... để bật/tắt nhanh cột dữ liệu theo nhu cầu kiểm soát.
   - Bấm **`+ Thêm cột mới`** để tạo trường ghi chú/nhãn/số liệu/checkbox vận hành nội bộ, sắp xếp thứ tự cột `← / →`, chọn mật độ dòng (`Gọn` / `Chuẩn` / `Thoáng`) và xuất CSV đúng các cột đang hiển thị.
2. **Buồng lái Xem Chi tiết Widescreen (`⛶ Mở rộng / Thu chuẩn`)**:
   - Mở chi tiết Đơn hàng hoặc Khách hàng trên màn hình lớn để xem bố cục 2 cột trực quan và xử lý chuyển trạng thái / xác nhận thanh toán ngay trên thanh tác vụ nhanh đầu hộp thoại.

### D. Trong Ca — Tiếp Thị Auto Social & Đăng Bài Test Fanpage
1. Tại **Auto Social & Lịch AI (`AutoSocialView`)** hoặc **Kết nối API (`IntegrationsView`)**, bấm **`Đăng bài Test lên Fanpage`** để mở Studio kiểm thử 3 chế độ:
   - **Chế độ 1 (Sandbox an toàn)**: Kiểm tra bố cục bài đăng, ảnh *An Nhiên Thạch* và hashtag ngay trên bản xem trước Facebook Feed.
   - **Chế độ 2 (Facebook Graph API v20.0 Live)**: Đăng thật lên Fanpage khi đã cấp `Page ID` và `Page Access Token (EAA...)`.
   - **Chế độ 3 (Webhook Make.com / n8n / Zapier)**: Bắn JSON chuẩn sang kịch bản tự động hóa đa kênh mà không cần duyệt Facebook App.

### E. Cuối Ca & Cuối Quý (10 phút)
1. **Đối soát COD & Bán chéo**: Kiểm tra mục **COD chờ đối soát** tại `ShipmentsView` và bảng **Quyết toán Bán chéo Liên Shop** tại `InventoryView`.
2. **Sao lưu & Chốt sổ kế toán cuối quý**: Tại `SystemView`, tải bản sao lưu `.db` định kỳ và bấm **Chốt sổ Quý (`Q1..Q4`)** để khóa dữ liệu chứng từ kế toán bất biến.

---

## 5. Cổng Kiểm Toán Chất Lượng & Toàn Vẹn Dữ Liệu Tự Động
Trước và sau mỗi đợt cập nhật cấu hình lớn hoặc chốt kỳ kế toán, chạy:
```bash
npm run verify
npm run test:e2e
node scripts/check-counts.mjs
```
Bao gồm kiểm tra kiểu tĩnh TypeScript (`tsc --noEmit`), quy chuẩn `eslint src` (`0 warnings / 0 errors`), chuỗi sổ kho đơn điệu (`test:chain`), 21 kịch bản nghiệp vụ thực tế (`test:scenarios`), 113 kiểm định Auto Social (`test:autosocial`), 11 kịch bản Hội viên & Chiến dịch (`test:loyalty`), và toàn bộ 8 bộ Master E2E Suite (`test:e2e`).
