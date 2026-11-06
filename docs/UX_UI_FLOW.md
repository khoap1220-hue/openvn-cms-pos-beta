# Luồng UX/UI Chuẩn OPENVN (`docs/UX_UI_FLOW.md`)

## 1. Triết lý & Hệ thống Thiết kế (OPENVN Design System)
- **Bảng màu thương hiệu**:
  - **Sidebar Điều hướng**: Deep Navy (`#182537` / `oklch(0.22 0.035 252)`) — chống mỏi mắt cho nhân sự vận hành ca trực dài.
  - **Màu chủ đạo (Primary Accent)**: OPENVN Royal Blue (`#0066CC` / `oklch(0.51 0.19 252)`) — đạt chuẩn tương phản WCAG AA (`5.75:1` trên nền trắng).
  - **Nền không gian làm việc (Canvas)**: Cool Light Gray (`#F3F5F8` / `oklch(0.968 0.004 250)`) — giúp các thẻ trắng (`#FFFFFF`) nổi khối rõ ràng.
- **Nguyên tắc điều hướng 1 chạm**:
  - Thanh tìm kiếm toàn cục `Ctrl+K` (`src/components/cms/quick-search-dialog.tsx`) tra cứu tức thì Đơn hàng (`DH...`), Sản phẩm (`SKU`), Khách hàng (`SĐT`) và chuyển nhanh giữa 19 phân hệ.
  - Thanh công cụ đầu trang (`src/app/page.tsx`) luôn hiển thị định vị phân hệ, cảnh báo tồn kho thấp, tin nhắn Zalo chưa đọc, trạng thái AI Autopilot & Realtime WebSocket.

## 2. Bản đồ Phân hệ & Hành trình Người dùng
| Nhóm phân hệ | Màn hình (`ViewId`) | Component chính | Tác vụ cốt lõi & Trạng thái UI |
| :--- | :--- | :--- | :--- |
| **Tổng quan & AI** | `dashboard` | `src/components/cms/views/dashboard-view.tsx` | Dải 6 ô **Việc cần xử lý trong ngày**, 4 thẻ KPI doanh thu/tồn kho, biểu đồ doanh thu 14 ngày và phím tắt tạo đơn/nhập kho. |
| **Tổng quan & AI** | `liveops`, `autopilot` | `liveops-view.tsx`, `autopilot-view.tsx` | Buồng lái AI điều phối đa sàn, luồng sự kiện thời gian thực và bật/tắt 6 Agent tự động. |
| **Đơn hàng & Bán hàng** | `orders` | `src/components/cms/views/orders-view.tsx` | Thanh Tab trạng thái ngang (`Tất cả`, `Chờ xác nhận`, `Đã xác nhận`, `Đang đóng gói`, `Đang giao hàng`, `Hoàn thành`, `Đã hủy`), đối chiếu kỳ và nút thao tác nhanh 1-click trên từng dòng (`Duyệt đơn`, `Đóng gói`, `Quét đóng gói`, `Hoàn tất`). |
| **Đơn hàng & Bán hàng** | `sales`, `shipments`, `inbox`, `aftersales` | `sales-view.tsx`, `shipments-view.tsx`, `inbox-view.tsx`, `aftersales-view.tsx` | Xuất hóa đơn bán VAT, theo dõi hành trình vận đơn & đối soát COD 1-click, trả lời chat Zalo OA/Cá nhân, xử lý đổi trả/bảo hành. |
| **Hàng hóa & Kho** | `products`, `inventory`, `bom`, `purchase` | `products-view.tsx`, `inventory-view.tsx`, `bom-view.tsx`, `purchase-view.tsx` | Quản lý danh mục hàng hóa kèm Tab lọc nhanh OPENVN (`Đang giao dịch`, `Sắp hết hàng`, `Combo / Bộ quà tặng`), kiểm kê mã vạch, định mức BOM tự động tính tồn Combo, hóa đơn nhập NCC. |
| **Khách hàng & Kênh** | `customers`, `partners`, `channels`, `reviews` | `customers-view.tsx`, `partners-view.tsx`, `channels-view.tsx`, `reviews-view.tsx` | Hồ sơ khách hàng & tích điểm Hội viên tự động, quản lý đối tác/NCC, kết nối 10 kênh bán (Shopee, TikTok, Lazada, Tiki, POS, Website, Zalo...), đánh giá & CSAT. |
| **Sổ quỹ & Hệ thống** | `accounting`, `reports`, `ledger`, `system` | `invoice-dashboard-view.tsx`, `reports-view.tsx`, `ledger-view.tsx`, `system-view.tsx` | Tổng hợp thuế & chốt sổ kỳ kế toán, báo cáo phân tích đa chiều, Sổ cái dữ liệu (Data Provenance & Lineage Diff), cấu hình hệ thống & Webhook HMAC. |
