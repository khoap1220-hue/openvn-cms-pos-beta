# Tiện Ích Đồng Bộ Cookie Shopee Liên Kết Riêng — thaimy1605 (#197195817)

Gói Chrome Extension này đã được cấu hình sẵn thông tin liên kết riêng cho gian hàng **OPENVN · Ưu Đàm (thaimy1605)** (Shop ID: `197195817`) kèm kết nối trực tiếp tới **Kho Phiên Mã Hóa Cloud 24/7 (Supabase AES-256-GCM + Render Singapore)**.

## Hướng dẫn cài đặt (30 giây)
1. Giải nén file `.zip` vừa tải về ra một thư mục cố định trên máy tính.
2. Mở trình duyệt Chrome / Edge / Cốc Cốc (nơi bạn đăng nhập **banhang.shopee.vn**), truy cập địa chỉ:
   `chrome://extensions` (hoặc `edge://extensions`).
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục vừa giải nén ở Bước 1.
5. Mở trang `https://banhang.shopee.vn` — Extension sẽ tự động nhận diện phiên Cookie của shop `thaimy1605` và đồng bộ song song về **OPENVN CMS cục bộ** lẫn **Trạm Cloud 24/7 (`https://openvn-cms-pos-backend.onrender.com`)**.

## Cơ chế bảo vệ an toàn
- **Khóa cứng Shop ID (`197195817`)**: Ngăn đồng bộ nhầm nếu trình duyệt đăng nhập tài khoản Shopee khác.
- **Kho Phiên Mã Hóa `AES-256-GCM` + `Leader Lease`**: Máy bán hàng tại tiệm giữ quyền ưu tiên khi bật máy; khi tắt máy, Cloud Render Singapore tự động tiếp quản nuôi phiên 24/7 không xung đột.
