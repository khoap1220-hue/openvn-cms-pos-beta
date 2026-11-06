# Hồ Sơ Sẵn Sàng Thương Mại & Khai Thác Kinh Doanh (`docs/COMMERCIAL_READINESS.md`)

> Chuẩn hóa theo kỹ năng **`matrix-san-sang-thuong-mai-ra-mat`** cho hệ thống **OPENVN · Ưu Đàm Suite & Showroom An Nhiên Thạch (v2.6.0)**.

## 1. Năng Lực Thương Mại Đã Sẵn Sàng Khai Thác

1. **Bán Hàng Đa Kênh & Quầy POS Tại Kho (`/pos`, `/store`, `OrdersView`)**:
   - Đầy đủ danh mục **22 sản phẩm & bộ quà tặng** (Nến bấc gỗ, Trầm hương, Thạch cao vi khoáng *An Nhiên Thạch*, Combo quà tặng kèm định mức BOM tự động trừ kho thành phần).
   - Xử lý đơn hàng đa sàn (*Shopee, TikTok Shop, Lazada, Tiki, Zalo OA, Facebook, Website, POS tại kho*) với hạch toán phí sàn tự động (`platformFeePct` / `platformFee`).
   - Hỗ trợ quét mã vạch `CODE128`, in tem nhãn sản phẩm, in phiếu gửi hàng khổ `A6` hàng loạt và in hóa đơn nhiệt `K80` (ESC/POS).

2. **Thanh Toán Tự Động VietQR & Đối Soát Ngân Hàng SePay**:
   - Tự động sinh mã QR chuyển khoản chuẩn `VietQR` trên từng hóa đơn bán và màn hình thu ngân POS.
   - Tích hợp sẵn cổng nhận biến động số dư **SePay (`INBOUND_SEPAY_TRANSACTION`)**: tự nhận diện mã đơn `DH...` ngay cả khi ngân hàng xóa dấu gạch ngang, tự động gạch nợ đơn hàng sang `PAID` và ghi nhật ký kiểm toán bất biến.

3. **Chăm Sóc Khách Hàng, Hội Viên 4 Hạng Thẻ & Chiến Dịch Khuyến Mãi CRM**:
   - Chương trình khách hàng thân thiết 4 hạng (`Đồng`, `Bạc`, `Vàng`, `Bạch Kim`) tùy chỉnh linh hoạt tỷ lệ tích điểm, quy đổi điểm và ưu đãi hạng thẻ.
   - Quản lý chiến dịch khuyến mãi (`CampaignsView`) hỗ trợ sóng giảm giá riêng cho từng sản phẩm (`productOverrides`) và tự động phát Voucher sinh nhật khách VIP.

4. **Tiếp Thị Đa Nền Tảng Tự Động (`Auto Social` + `Fanpage Test Studio`)**:
   - Kết nối tư liệu từ thư mục Google Drive công khai, AI Copywriter viết bài đúng giọng văn thương hiệu và kiểm soát chặt chẽ qua **Ba Cổng Thép** (Chủ tiệm duyệt → Chiến dịch còn hiệu lực → Đúng giờ hẹn).
   - Tích hợp **Studio Đăng Bài Test lên Fanpage** (3 chế độ: *Sandbox*, *Facebook Graph API v20.0*, *Webhook Bridge Make/n8n/Zapier*) và xuất bản bài viết SEO trực tiếp ra chuyên trang `/blog`.

5. **Kế Toán Nội Bộ, Thuế GTGT & Đối Soát Bán Chéo Liên Shop**:
   - Báo cáo P&L 5 tầng bóc tách chính xác Lợi nhuận ròng sau giá vốn BOM, phí sàn, trợ giá ship và điểm thưởng.
   - Xuất tệp **XML Hóa đơn Điện tử** theo chuẩn Tổng cục Thuế (NĐ 123/2020, TT 78/2021, QĐ 1450/QĐ-TCT), chốt khóa kỳ kế toán theo Quý (`Q1..Q4`), và quyết toán công nợ bán chéo với các Shop liên kết.

---

## 2. Ma Trận Kiểm Soát Rủi Ro Thương Mại & Vận Hành

| Rủi ro Vận hành Thực tế | Cơ chế Phòng vệ Đã Tích hợp trong Hệ thống | Quy trình Xử lý của Nhân viên |
| :--- | :--- | :--- |
| **Bán vượt tồn kho khi nổ đơn đồng thời (Overselling)** | Giao dịch nguyên tử `db.$transaction` kiểm tra tồn kho gộp cả hàng lẻ và thành phần Combo BOM trước khi xác nhận đơn. | Khi hệ thống cảnh báo thiếu tồn thành phần, lập phiếu nhập hàng tại `PurchaseView` hoặc điều chuyển kho `A ➔ B`. |
| **Khách chuyển khoản nhưng ngân hàng xóa dấu `-` trong mã đơn** | Bộ chuẩn hóa regex `DH(\d{6})[-\s]?(\d{3,6})` tự động khôi phục mã `DHYYMMDD-XXXX` để khớp đơn và gạch nợ `PAID`. | Trường hợp khách ghi sai hẳn nội dung CK, mở Chi tiết Đơn hàng Widescreen và bấm **Đánh dấu đã thanh toán** trên thanh tác vụ nhanh. |
| **Khách bom hàng / Hoàn hàng từ ĐVVC** | Cập nhật vận đơn sang `RETURNED` tự động hủy đơn gốc (`CANCELLED`) và hoàn trả nguyên tử 100% tồn kho thực tế (kể cả BOM) + chống hoàn kho trùng lặp (Idempotent). | Kiểm tra tình trạng hàng hoàn vật lý; nếu hư hỏng/vỡ, lập phiếu điều chỉnh giảm kho (`ADJUST`) tại `InventoryView`. |
| **AI đăng nhầm giá hoặc tự ý đăng bài lên MXH** | Bộ kiểm định bất biến đối chiếu giá/% giảm/mã voucher khớp 100% CRM + **Ba Cổng Thép** bắt buộc chủ tiệm bấm `Duyệt` + chế độ `Safe Mock` mặc định khi chưa gắn token thật. | Luôn dùng **Đăng bài Test lên Fanpage (Chế độ Sandbox)** để xem trước giao diện bài đăng trước khi chuyển sang chế độ Live. |
| **Sửa nhầm chứng từ kế toán kỳ trước sau khi báo cáo thuế** | Tính năng **Chốt sổ kế toán Quý (`CLOSED`)** chặn cứng (`409 Conflict`) mọi thao tác thêm/sửa/hủy hóa đơn và biến động kho thuộc quý đã khóa. | Chỉ Quản trị viên mới được phép mở khóa tạm thời và mọi thao tác mở/khóa đều lưu vết bất biến trong **Sổ Data (`LedgerView`)**. |
| **Mất mạng Internet tại cửa hàng / quầy thu ngân** | Kiến trúc SQLite cục bộ tốc độ cao + Service Worker / bộ đệm danh mục Offline-first giúp tra cứu sản phẩm, khách hàng và bán tại quầy LAN không gián đoạn. | Tiếp tục bán hàng trên mạng LAN nội bộ (`http://<IP-may-chu>:3010/pos`); các webhook bên ngoài sẽ đồng bộ bổ sung khi có mạng lại. |

---

## 3. Phân Quyền Trách Nhiệm Vận Hành Gợi Ý

- **Chủ tiệm / Quản trị viên**: Quản lý mật khẩu CMS, cấu hình Key đối tác & SePay, phê duyệt bài đăng Auto Social, quyết toán hoa hồng bán chéo liên shop, sao lưu `.db` hàng tuần và chốt sổ kế toán cuối quý.
- **Thu ngân Quầy POS (`/pos`)**: Quét mã bán hàng tại kho, áp dụng Voucher/Điểm hội viên, kiểm tra trạng thái gạch nợ VietQR/SePay và in hóa đơn K80.
- **Nhân viên Kho & Đóng gói**: Theo dõi hàng đợi `PACKING` trên Buồng lái AI / Đơn hàng, quét mã vạch kiểm đếm sản phẩm dễ vỡ, in phiếu giao hàng A6 hàng loạt và bấm `Báo ĐVVC`.
