# BẢO CÁO ĐẶC TẢ YÊU CẦU & MA TRẬN TÍNH NĂNG TOÀN DIỆN
## DỰ ÁN: OPENVN · ƯU ĐÀM SUITE (VẬN HÀNH THỰC TẾ)

- **Người thực hiện**: `spec_miner_survey_2` (Specification & Requirements Miner)
- **Thời gian lập**: 2026-10-26T07:35:00Z
- **Không gian làm việc**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)`
- **Tài liệu nguồn có thẩm quyền**:
  1. `.agents/teamwork/ORIGINAL_REQUEST.md` (Chỉ thị tối cao & Tiêu chí nghiệm thu R1–R7)
  2. `MATRIX_HANDOFF.md` (Hồ sơ bàn giao vận hành hiện tại)
  3. `docs/FEATURE_EXPERIENCE_MATRIX.md` (Bảng tổng hợp trải nghiệm 19 phân hệ)
  4. `docs/UX_UI_FLOW.md` (Hệ thống thiết kế OPENVN Design System & Hành trình người dùng)
  5. `docs/OPERATIONS_RUNBOOK.md` (Sổ tay vận hành theo ca & Lệnh kiểm chứng)
  6. `docs/RELEASE_CHECKLIST.md` (Danh sách kiểm tra phát hành)
  7. `worklog.md` (Nhật ký kỹ thuật Task 20–31)
  8. Codebase hiện hành: `prisma/schema.prisma`, `src/app/`, `src/lib/`, `scripts/`

---

## 1. TỔNG QUAN HỆ THỐNG & NGUYÊN TẮC BẢO VỆ DỮ LIỆU

### 1.1. Bối cảnh Vận hành Thực tế
- **Hệ thống**: OPENVN · Ưu Đàm Suite là bộ giải pháp CMS Quản lý Bán hàng Đa kênh + Quầy POS Bán tại kho + Trợ lý AI Điều phối tự động dành cho Hộ kinh doanh Ưu Đàm (`uudam.vn`), kinh doanh nến thơm, trà thảo mộc, trầm hương, gốm sứ tâm linh và set quà tặng thiền.
- **Môi trường công nghệ**: Next.js 16 (App Router), React 19, Tailwind CSS v4, Prisma ORM 6.11, SQLite database tại `db/custom.db`, Socket.io Realtime Event Bus (`port 3013`), Web server (`port 3010`), Gateway nội bộ (`port 81`).
- **Nguyên tắc vàng**: Vận hành thật tại cửa hàng — **độ chắc chắn và an toàn dữ liệu được ưu tiên tuyệt đối hơn tốc độ**. Không làm gián đoạn chuỗi tồn kho, không xóa mất dữ liệu hiện hữu.

### 1.2. Hiện trạng Cơ sở Dữ liệu Gốc (`db/custom.db`)
Qua khảo sát trực tiếp trên SQLite production database tại thời điểm bắt đầu khảo sát:
- **Sản phẩm (Product)**: 15 bản ghi (100% ngữ cảnh Ưu Đàm, gồm 11 sản phẩm đơn lẻ, 1 bộ Combo quà tặng `UD-COMBO-001`, và 3 mã test/liên kết).
- **Đơn hàng (Order)**: 175 bản ghi (đầy đủ các kênh SHOPEE, LAZADA, TIKTOK, TIKI, POS, ZALO_OA, WEBSITE, FACEBOOK).
- **Biến động kho (StockMovement)**: 260 bản ghi (chuỗi đơn điệu `stockAfter = stockBefore + qty` khớp 100% với tồn kho thực tế; kiểm toán `npm run test:chain` đạt 0 lỗi).
- **Khách hàng (Customer)**: 36 bản ghi (trong đó có 3 Thành viên VIP sống: TV0001 Lê Thị Hồng Nhung, TV0002 Vũ Ngọc Linh, TV0003...).
- **Hóa đơn bán (SalesInvoice)**: 12 bản ghi (mã `PXK...` có đầy đủ QR VietQR, liên kết đơn hàng và khách lẻ).
- **Hóa đơn mua (PurchaseInvoice)**: 4 bản ghi (`PMM...` từ NCC).
- **Vận đơn (Shipment)**: 86 bản ghi (GHN, GHTK, Viettel Post, J&T, Ninja Van; hỗ trợ in tem A6 và theo dõi COD).
- **Kho hàng (Warehouse)**: 4 kho (`KHO-TRUNG-TAM`, `KHO-CN-Q1`, `SHOP-GOM-ZEN`, `SHOP-TRAM-AN-LAC`).
- **Mã giảm giá (Voucher)**: 4 voucher đang hoạt động (`UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D`).

---

## 2. MA TRẬN TÍNH NĂNG TOÀN DIỆN (FEATURE INVENTORY R1–R7)

Bảng tổng hợp toàn bộ tính năng đối chiếu giữa 19 phân hệ nghiệp vụ và 7 nhóm yêu cầu R1–R7 của người dùng:

| STT | Phân Hệ / Nhóm Tính Năng | Tính Năng Cụ Thể | Trạng Thái Hiện Tại | Mức Ưu Tiên | Yêu Cầu Gốc | Mô Tả Nghiệp Vụ & Điểm Chạm | Hạn Chế / Phần Cần Hoàn Thiện |
| :---: | :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **1** | **R1. Gia cố Hệ thống** | Tồn kho Combo BOM tự động | 🟢 Đã hoàn thành | Core | R1 | Tồn kho bộ Combo tự suy ra từ min(thành phần / định mức). Bán lẻ hoặc bán Combo đều trừ thành phần. | Duy trì ổn định, có kiểm thử hồi quy trong `test:scenarios`. |
| **2** | **R1. Gia cố Hệ thống** | Chặn bán SP `INACTIVE` & Chặn sửa đơn đã hủy | 🟢 Đã hoàn thành | Core | R1 | Chặn đặt hàng SP ngừng bán (`400`). Đơn đã `CANCELLED` thì cấm chuyển sang trạng thái khác (`400`). | Duy trì ổn định. |
| **3** | **R1. Gia cố Hệ thống** | Chặn xuất trùng HĐ bán & Khóa sổ kế toán | 🟢 Đã hoàn thành | Core | R1 | 1 đơn chỉ xuất 1 HĐ bán (`400`). Kỳ kế toán đã đóng (`CLOSED`) thì chặn mọi ghi nhận/hủy chứng từ (`409`). | Duy trì ổn định. |
| **4** | **R1. Gia cố Hệ thống** | Tự động hoàn kho khi vận đơn `RETURNED` | 🟢 Đã hoàn thành | Core | R1 | Vận đơn chuyển sang `RETURNED` tự động hủy đơn gốc và hoàn kho đủ cả SP lẻ lẫn thành phần Combo BOM. | Duy trì ổn định. |
| **5** | **R1. Gia cố Hệ thống** | Tích điểm Hội viên Idempotent | 🟢 Đã hoàn thành | Core | R1 | Đơn `COMPLETED` cộng 1đ/10k. Gọi lại nhiều lần không bị cộng trùng nhờ đối chiếu Sổ Data. | Duy trì ổn định. |
| **6** | **R1. Gia cố Hệ thống** | Bảo vệ khóa ngoại khi xóa SP | 🟢 Đã hoàn thành | Core | R1 | Xóa SP đã có đơn hàng/hóa đơn trả về `409 Conflict` (không sập `500`). | Duy trì ổn định. |
| **7** | **R1. Gia cố Hệ thống** | Bảo mật Webhook HMAC-SHA256 | 🟢 Đã hoàn thành | Core | R1 | Chữ ký HMAC sai bị chặn `401`. Chặn cập nhật tồn Combo trực tiếp qua Webhook (`400`). | Duy trì ổn định. |
| **8** | **R2. Đơn Hàng Hàng Loạt** | Chọn nhiều đơn trên bảng (`orders-view`) | 🔴 Chưa có | ⚡ P1 | R2 | Checkbox từng dòng + Checkbox chọn tất cả trên trang. Hiển thị thanh tác vụ hàng loạt khi số lượng chọn > 0. | Cần bổ sung UI checkbox, thanh tác vụ nổi (Floating action bar). |
| **9** | **R2. Đơn Hàng Hàng Loạt** | Xác nhận hàng loạt (Bulk Confirm) | 🔴 Chưa có | ⚡ P1 | R2 | Duyệt đồng thời N đơn `PENDING → CONFIRMED`. Đơn hợp lệ được duyệt; đơn lỗi (đã hủy, vượt kho) bị từ chối kèm lý do chi tiết. | Cần tạo API `POST /api/orders/bulk-confirm` và modal báo kết quả từng đơn. |
| **10** | **R2. Đơn Hàng Hàng Loạt** | In phiếu giao hàng hàng loạt (Batch Print) | 🔴 Chưa có | ⚡ P1 | R2 | In hàng loạt tem A6 cho các đơn được chọn. Tự động sinh trang in nhiều tem (CSS page-break khổ A6 105×148mm). | Cần tạo modal xem trước và in gộp tem vận đơn A6. |
| **11** | **R3. Hóa Đơn VAT Điện Tử** | Xuất file XML chuẩn Tổng cục Thuế | 🔴 Chưa có | ⚡ P1 | R3 | Xuất hóa đơn bán ra XML theo Nghị định 123/2020, Thông tư 78/2021 và Quyết định 1450/QĐ-TCT. | Cần tạo hàm dựng XML chuẩn TCT + API `GET /api/sales-invoices/[id]/xml`. |
| **12** | **R3. Hóa Đơn VAT Điện Tử** | Kiểm tra trường bắt buộc & Chặn HĐ đã hủy | 🔴 Chưa có | ⚡ P1 | R3 | Kiểm tra MST người bán, người mua, dòng hàng, thuế suất, tổng tiền. HĐ đã hủy (`CANCELLED`) cấm xuất XML. | Cần validate chặt chẽ trước khi trả về XML. |
| **13** | **R3. Hóa Đơn VAT Điện Tử** | Điểm kết nối ký số (Adapter / Webhook) | 🔴 Chưa có | ⚡ P1 | R3 | Adapter cấu hình gửi hóa đơn sang nhà mạng ký số (VNPT, Viettel SInvoice…), có chế độ giả lập (Mock). | Cần xây dựng `lib/einvoice-service.ts` và provider cấu hình trong Kết nối API. |
| **14** | **R4. Danh Mục Sản Phẩm** | Xuất danh mục & bảng giá CSV/Excel | 🔴 Chưa có | 💡 P2 | R4 | Xuất toàn bộ sản phẩm, giá vốn, giá bán chung, tồn kho và giá bán riêng theo kênh ra file CSV chuẩn UTF-8. | Cần tạo API `GET /api/products/export` và nút "Xuất CSV" trên UI. |
| **15** | **R4. Danh Mục Sản Phẩm** | Nhập danh mục CSV & Kiểm tra từng dòng | 🔴 Chưa có | 💡 P2 | R4 | Tải file CSV lên, kiểm tra từng dòng, báo lỗi chi tiết (dòng số mấy, lỗi gì). Có lỗi thì không ghi đè dữ liệu hỏng. | Cần tạo API `POST /api/products/import`, dialog tải file và bảng báo lỗi theo dòng. |
| **16** | **R4. Danh Mục Sản Phẩm** | Đảm bảo tính toàn vẹn Xuất ➔ Nhập lại (Round-trip) | 🔴 Chưa có | 💡 P2 | R4 | File xuất ra khi nhập lại phải giữ nguyên vẹn 100% dữ liệu sản phẩm và bảng giá không sai lệch. | Kiểm thử tự động chu trình Export ➔ Import. |
| **17** | **R5. Dashboard Kinh Doanh** | Chọn khoảng ngày biểu đồ doanh thu | 🟡 Đang cố định 14 ngày | 💡 P2 | R5 | Bổ sung nút chọn 4 khoảng ngày: `7 ngày`, `14 ngày`, `30 ngày`, `90 ngày`. | Sửa `GET /api/dashboard?days=` và thêm Toggle Group trên biểu đồ `dashboard-view`. |
| **18** | **R5. Nhập Hàng NCC** | Quy trình PO: Nháp ➔ Duyệt ➔ Nhận hàng | 🟡 Đang nhập thẳng | 💡 P2 | R5 | Lập Đơn mua hàng (PO) ở trạng thái `DRAFT` ➔ `APPROVED` (chưa tăng kho) ➔ `RECEIVE` (chỉ tăng kho khi thực nhận). | Thêm trạng thái và luồng nhận hàng đủ/một phần trên `PurchaseInvoice`/`PurchaseOrder`. |
| **19** | **R5. Chat Hộp Thư Zalo** | Kéo-thả tải ảnh từ máy tính lên chat | 🟡 Chỉ có nút chọn file | 💡 P2 | R5 | Kéo và thả file ảnh từ máy tính trực tiếp vào khung chat `inbox-view` để gửi cho khách hoặc mô phỏng. | Thêm sự kiện HTML5 Drag & Drop (`dragover`, `drop`) trên khung chat. |
| **20** | **R5. Quầy POS Bán Tại Kho** | In nhiệt K80 trực tiếp qua WebUSB/WebSerial | 🟡 Đang dùng window.print | 💡 P2 | R5 | Sinh chuỗi byte ESC/POS (hỗ trợ lệnh cắt giấy, tiếng Việt có dấu), gửi trực tiếp máy in nhiệt; fallback về `window.print`. | Xây dựng bộ mã hóa ESC/POS chuẩn và adapter kết nối USB/Serial. |
| **21** | **R5. Vận Chuyển & COD** | Tính phí ship tự động GHN/GHTK theo địa chỉ | 🟡 Đang ước tính cố định | 💡 P2 | R5 | Tính phí ship theo địa chỉ quận/huyện và trọng lượng qua GHN/GHTK. Chế độ Mock an toàn khi chưa có key. | Cần xây dựng service tính cước vận chuyển chuẩn GHN/GHTK. |
| **22** | **R5. Hội Viên & Khách Hàng** | Tự động gửi Voucher Zalo dịp Sinh nhật VIP | 🔴 Chưa có | 💡 P2 | R5 | Định kỳ quét hội viên hạng VIP (Bạc, Vàng, Kim Cương) có sinh nhật trong ngày để gửi Voucher Zalo. Chạy 2 lần chỉ gửi 1 lần. | Bổ sung trường ngày sinh, hàm quét sinh nhật và chốt chặn chống gửi trùng. |
| **23** | **R5. Buồng Lái AI** | Nút diễn tập đơn hàng Shopee / TikTok Shop | 🟡 Chỉ có diễn tập Zalo | 💡 P2 | R5 | Nút diễn tập đơn hàng Shopee và TikTok Shop ngay trên Buồng lái AI với snapshot phí sàn đầy đủ. | Bổ sung API mô phỏng đơn sàn và 2 nút diễn tập trên `liveops-view`. |
| **24** | **R6. Tích Hợp An Toàn** | Chế độ Giả lập (Mock) toàn bộ kết nối bên ngoài | 🟡 Hoàn thành một phần | Core | R6 | Không gọi mạng/thiết bị thật trong test. Tự dùng mock khi chưa có key, tự chuyển gọi thật khi điền key. Không lộ secret. | Bổ sung mock cho E-Invoice ký số, GHN/GHTK cước, máy in USB. |
| **25** | **R7. An Toàn Dữ Liệu** | Sao lưu CSDL & Bảo tồn `db/custom.db` | 🟡 Cần thực thi sao lưu | Core | R7 | Sao lưu file `db/custom.db` trước mọi can thiệp. Giữ nguyên số lượng bản ghi gốc. Dọn sạch dữ liệu test. | Tạo script backup tự động và cơ chế cô lập dữ liệu test. |

---

## 3. ĐẶC TẢ CHI TIẾT CÁC YÊU CẦU TRỌNG YẾU (R2, R3, R4, R5, R6, R7)

### 3.1. R2: Đơn Hàng Hàng Loạt (Bulk Orders & Batch Shipping Slips)

#### A. Yêu cầu Nghiệp vụ
1. **Chọn nhiều đơn hàng**:
   - Giao diện `orders-view.tsx` bổ sung cột Checkbox đầu bảng.
   - Header có checkbox "Chọn tất cả" trên trang hiện tại.
   - Khi có ít nhất 1 đơn được chọn, hiển thị thanh tác vụ hàng loạt: `[Đã chọn N đơn]` + nút `Xác nhận hàng loạt` + nút `In phiếu giao hàng hàng loạt` + nút `Bỏ chọn`.
2. **Xác nhận hàng loạt (Bulk Confirm)**:
   - Endpoint: `POST /api/orders/bulk-confirm`
   - Payload: `{ orderIds: string[] }`
   - Logic kiểm tra từng đơn:
     - Đơn phải tồn tại và đang ở trạng thái `PENDING`.
     - Nếu đơn ở trạng thái `CANCELLED`: từ chối với lý do *"Đơn hàng đã bị hủy, không thể xác nhận"*.
     - Nếu đơn đã ở trạng thái `CONFIRMED`, `PACKING`, `SHIPPING`, `COMPLETED`: từ chối với lý do *"Đơn hàng đã được duyệt trước đó"*.
     - Kiểm tra tồn kho thực tế của các mặt hàng trong đơn:
       - Đối với sản phẩm thường (`SIMPLE`): `product.stock >= item.quantity`.
       - Đối với Combo (`COMBO`): kiểm tra từng thành phần cấu thành theo định mức BOM: `componentProduct.stock >= componentQuantity * item.quantity`.
       - Nếu không đủ tồn: từ chối với lý do *"Sản phẩm [Tên SP] không đủ tồn kho (còn X, cần Y)"*.
     - Xử lý các đơn hợp lệ: cập nhật trạng thái `CONFIRMED`, ghi sự kiện `OrderEvent`, ghi Sổ Data (`LedgerEntry`), phát sóng realtime WebSocket và webhook `order.confirmed`.
     - **Phản hồi chi tiết**: Trả về danh sách kết quả cho từng đơn gồm `{ id, code, success: boolean, reason?: string }`, số lượng thành công `successCount`, số lượng thất bại `failureCount`. Tuyệt đối không bỏ qua lỗi im lặng!
3. **In phiếu giao hàng hàng loạt (Batch Print A6)**:
   - Mở modal xem trước gộp tất cả các đơn hợp lệ đã chọn.
   - Định dạng in: khổ giấy A6 chuẩn (105×148mm), sử dụng CSS `@media print` với `page-break-after: always` sau mỗi tem vận đơn.
   - Nội dung mỗi tem: Mã vạch vận đơn / mã đơn, thông tin người nhận (Tên, SĐT, Địa chỉ), tiền thu hộ COD nổi bật, cảnh báo hàng dễ vỡ (tự động nhận diện từ `product.fragile`).

---

### 3.2. R3: Hóa Đơn VAT Điện Tử Chuẩn Việt Nam & Mock Ký Số

#### A. Khung Pháp Lý Bắt Buộc
Hệ thống xuất hóa đơn VAT điện tử phải tuân thủ nghiêm ngặt 3 văn bản pháp lý hiện hành:
1. **Nghị định 123/2020/NĐ-CP** ngày 19/10/2020 của Chính phủ quy định về hóa đơn, chứng từ.
2. **Thông tư 78/2021/TT-BTC** ngày 17/09/2021 của Bộ Tài chính hướng dẫn thực hiện Luật Quản lý thuế và Nghị định 123/2020/NĐ-CP.
3. **Quyết định 1450/QĐ-TCT** ngày 07/10/2021 của Tổng cục Thuế quy định thành phần chứa dữ liệu nghiệp vụ hóa đơn điện tử và phương thức truyền nhận với cơ quan thuế.

#### B. Cấu Trúc File XML Chuẩn Tổng Cục Thuế (Quyết định 1450/QĐ-TCT)
Tài liệu XML xuất ra phải có cấu trúc cây chuẩn như sau:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<HDon xmlns="http://hoadondientu.gdt.gov.vn/2021/08/data">
  <DLHDon Id="HDon_PXK261026-0001">
    <TTChung>
      <PBan>2.0.0</PBan>
      <THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon>
      <KHMSHDon>1</KHMSHDon>
      <KHHDon>C26TAA</KHHDon>
      <SHDon>00000001</SHDon>
      <NLap>2026-10-26</NLap>
      <DVTTe>VND</DVTTe>
      <TGia>1.0</TGia>
      <HTTToan>TM/CK</HTTToan>
      <MSTTCThue>0312345678</MSTTCThue>
    </TTChung>
    <NDHDon>
      <NBan>
        <Ten>HỘ KINH DOANH ƯU ĐÀM</Ten>
        <MST>0312345678</MST>
        <DChi>Số 108 Điện Biên Phủ, Phường Đa Kao, Quận 1, TP. Hồ Chí Minh</DChi>
        <SDThoai>0901234567</SDThoai>
        <DCTDTu>contact@uudam.vn</DCTDTu>
        <STKNHang>0071000123456</STKNHang>
        <TNHang>Ngân hàng TMCP Ngoại thương Việt Nam (Vietcombank)</TNHang>
      </NBan>
      <NMua>
        <Ten>Công ty TNHH Thiền Trà Việt Nam</Ten>
        <MST>0109876543</MST>
        <DChi>Số 25 Lý Thường Kiệt, Hoàn Kiếm, Hà Nội</DChi>
        <SDThoai>0988776655</SDThoai>
        <HVTNMHang>Nguyễn Văn An</HVTNMHang>
      </NMua>
      <DSHangHoa>
        <HHDVu>
          <TChat>1</TChat>
          <STT>1</STT>
          <MHHDVu>UD-NEN-001</MHHDVu>
          <THHDVu>Nến thơm hoa sen Ưu Đàm (tinh dầu tự nhiên)</THHDVu>
          <DVTinh>hũ</DVTinh>
          <SLuong>2</SLuong>
          <DGia>180000</DGia>
          <Tien>360000</Tien>
          <TSuat>8%</TSuat>
          <ThTien>388800</ThTien>
        </HHDVu>
      </DSHangHoa>
      <TToan>
        <THTTLTSuat>
          <LTSuat>
            <TSuat>8%</TSuat>
            <ThTien>360000</ThTien>
            <TThue>28800</TThue>
          </LTSuat>
        </THTTLTSuat>
        <TgTCThue>360000</TgTCThue>
        <TgTThue>28800</TgTThue>
        <TgTTTBSo>388800</TgTTTBSo>
        <TgTTTBChu>Ba trăm tám mươi tám nghìn tám trăm đồng chẵn.</TgTTTBChu>
      </TToan>
    </NDHDon>
  </DLHDon>
  <DSCKS>
    <NBan>
      <Signature xmlns="http://www.w3.org/2000/09/xmldsig#">
        <SignedInfo>
          <CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>
          <SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha256"/>
          <Reference URI="#HDon_PXK261026-0001">
            <DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
            <DigestValue>MOCK_DIGEST_UUDAM_E_INVOICE_HASH==</DigestValue>
          </Reference>
        </SignedInfo>
        <SignatureValue>MOCK_SIGNATURE_VALUE_RSA_2048==</SignatureValue>
        <KeyInfo>
          <X509Data>
            <X509SubjectName>CN=HỘ KINH DOANH ƯU ĐÀM, OID.2.5.4.97=MST:0312345678, C=VN</X509SubjectName>
            <X509Certificate>MOCK_CERT_BASE64==</X509Certificate>
          </X509Data>
        </KeyInfo>
      </Signature>
    </NBan>
  </DSCKS>
</HDon>
```

#### C. Quy tắc Kiểm tra & Điểm Chặn Nghiệp Vụ
1. **Kiểm tra tính toàn vẹn (Validation)**:
   - Các trường bắt buộc không được để trống: MST người bán (`MST`), Tên người bán (`Ten`), Ngày lập (`NLap`), Danh sách hàng hóa (`DSHangHoa`), Thuế suất (`TSuat`), Tổng tiền bằng số (`TgTTTBSo`) và bằng chữ (`TgTTTBChu`).
   - Đẳng thức số học bắt buộc: `TgTTTBSo = TgTCThue + TgTThue` (khớp chính xác đến từng đồng).
   - Thuật toán đọc số thành chữ tiếng Việt: chuyển đổi số tiền tự động (ví dụ: `388800` ➔ *"Ba trăm tám mươi tám nghìn tám trăm đồng"*).
2. **Chặn hóa đơn đã hủy**:
   - Nếu `invoice.status === 'CANCELLED'`, gọi API xuất XML phải trả về `HTTP 400 Bad Request` với thông báo: *"Hóa đơn đã bị hủy, không thể xuất XML hợp lệ theo quy định Tổng cục Thuế"*.
3. **Adapter Ký Số & Chế độ Giả Lập (Mock E-Signing)**:
   - Hỗ trợ các provider: `VNPT`, `VIETTEL_SINVOICE`, `MISA_MEINVOICE`, `MOCK`.
   - Khi ở chế độ Mock: tự động ký với chứng thư số giả lập, trả về XML ký số đầy đủ cấu trúc `<DSCKS>` kèm mã tra cứu hóa đơn và mã CQT giả lập (`00...`).
   - Khi cấu hình key thật trong bảng `IntegrationCredential`: tự động chuyển sang gọi Webhook/REST API của nhà mạng.

---

### 3.3. R4: Nhập/Xuất Danh Mục Sản Phẩm (CSV/Excel Import/Export)

#### A. Xuất Danh Mục Sản Phẩm (Export CSV)
- **Endpoint**: `GET /api/products/export?format=csv`
- **Định dạng file**: CSV với mã hóa UTF-8 BOM (`\uFEFF`) để Excel tiếng Việt trên Windows mở không bị lỗi font.
- **Các cột dữ liệu tiêu chuẩn**:
  `Mã SKU`, `Mã vạch (Barcode)`, `Tên sản phẩm`, `Loại (SIMPLE/COMBO)`, `Danh mục`, `Đơn vị tính`, `Giá vốn`, `Giá bán chung`, `Tồn kho`, `Ngưỡng tồn thấp`, `Hàng dễ vỡ (CÓ/KHÔNG)`, `Trạng thái (ACTIVE/INACTIVE)`, `Giá Shopee`, `Giá TikTok Shop`, `Giá Lazada`, `Giá Tiki`, `Mô tả`.
- **Độ chính xác**: Dữ liệu xuất ra phản ánh chính xác 100% snapshot cơ sở dữ liệu hiện tại.

#### B. Nhập Danh Mục Sản Phẩm (Import CSV) & Báo Lỗi Từng Dòng
- **Endpoint**: `POST /api/products/import`
- **Quy trình kiểm tra dòng-theo-dòng (Line-by-line Validation)**:
  1. Đọc và phân tích file CSV (hỗ trợ dấu phẩy `,` hoặc chấm phẩy `;`).
  2. Với từng dòng (tính từ dòng 2 sau tiêu đề):
     - Dòng trống: bỏ qua.
     - `Mã SKU`: bắt buộc, không chứa ký tự đặc biệt nguy hiểm, kiểm tra trùng lặp ngay trong chính file tải lên.
     - `Tên sản phẩm`: bắt buộc, độ dài 2–200 ký tự.
     - `Giá vốn`, `Giá bán`: phải là số hợp lệ $\ge 0$.
     - `Tồn kho`: phải là số nguyên $\ge 0$.
     - `Loại sản phẩm`: chỉ nhận `SIMPLE` hoặc `COMBO`.
     - `Hàng dễ vỡ`: nhận dạng `CÓ`/`KHÔNG` hoặc `true`/`false`.
  3. **Nguyên tắc an toàn dữ liệu (Atomic Rollback)**:
     - Nếu có bất kỳ dòng nào bị lỗi: gom toàn bộ $N$ lỗi và trả về danh sách chi tiết:
       `{ line: number, sku: string, field: string, message: string }`.
     - **Không ghi đè hoặc tạo mới bất kỳ bản ghi nào vào CSDL khi có lỗi tồn tại** (bảo toàn 100% dữ liệu cũ).
  4. **Tính tương thích hai chiều (Round-trip Fidelity)**:
     - Xuất dữ liệu ra file CSV ➔ Nhập lại file vừa xuất: hệ thống báo hợp lệ 100% và dữ liệu trong CSDL giữ nguyên không sai lệch 1 chữ số.

---

### 3.4. R5: Các Tính Năng P2 Còn Lại

#### 1. Dashboard: Bộ Lọc Khoảng Ngày Cho Biểu Đồ Doanh Thu
- **Phân hệ**: `dashboard-view.tsx` & `src/app/api/dashboard/route.ts`
- **Quy cách**:
  - API `GET /api/dashboard?days=7|14|30|90` (mặc định 14).
  - Giao diện: thanh nút chọn 4 mức (`7 ngày`, `14 ngày`, `30 ngày`, `90 ngày`) đặt ngay phía trên bên phải biểu đồ doanh thu Recharts.
  - Số liệu từng ngày trong mảng `revenueByDay` phải khớp chính xác tuyệt đối với câu lệnh SQL tổng hợp trực tiếp từ bảng `Order` trong CSDL (`where: { createdAt >= startDate, status != 'CANCELLED' }`).

#### 2. Nhập Hàng: Quy Trình Đơn Mua Hàng (PO) Nháp ➔ Duyệt ➔ Nhận Hàng
- **Phân hệ**: `purchase-view.tsx` & `src/app/api/purchase-invoices/` (hoặc `purchase-orders`)
- **Vòng đời trạng thái**:
  - `DRAFT` (PO Nháp): Lập kế hoạch nhập hàng từ nhà cung cấp. **Tồn kho giữ nguyên 100% (không phát sinh StockMovement)**.
  - `APPROVED` (Đã duyệt PO): Quản lý duyệt đơn đặt hàng mua. **Tồn kho vẫn giữ nguyên 100%**.
  - `RECEIVING` / `COMPLETED` (Nhận hàng): Hàng về tới kho thực tế. Nhân viên kho kiểm đếm và bấm "Nhận hàng" (hỗ trợ nhận đủ hoặc nhận một phần `partial receive`):
    - **Tồn kho chỉ tăng đúng bằng số lượng thực nhận** (`receivedQuantity`).
    - Ghi nhận `StockMovement` loại `IMPORT` với số lượng dương, cập nhật `stockAfter` chính xác.
    - Chuỗi biến động kho toán học khớp 100% khi chạy `npm run test:chain`.

#### 3. Chat Đa Kênh: Kéo-Thả Tải Ảnh Máy Tính Vào Khung Chat
- **Phân hệ**: `inbox-view.tsx`
- **Quy cách**:
  - Bổ sung vùng lắng nghe sự kiện HTML5 Drag & Drop trên khung hội thoại: `onDragEnter`, `onDragOver`, `onDragLeave`, `onDrop`.
  - Hiệu ứng thị giác: khi kéo ảnh vào, khung chat viền nét đứt màu xanh Royal Blue (`#0066CC`) kèm thông báo *"Thả ảnh vào đây để tải lên khung chat"*.
  - Xử lý file: kiểm tra định dạng ảnh (`image/*`), tự động nén kích thước qua Canvas HTML5 ($\le 350\text{ KB}$), nạp vào `pendingImage` sẵn sàng gửi qua Vision AI.

#### 4. Quầy POS: In Trực Tiếp Máy In Nhiệt K80 Qua WebUSB/WebSerial
- **Phân hệ**: `pos-view.tsx` & module mới `src/lib/escpos.ts`
- **Bộ mã hóa lệnh ESC/POS**:
  - Khởi tạo máy in: `ESC @` (`0x1B, 0x40`).
  - Căn lề: Trái (`0x1B, 0x61, 0x00`), Giữa (`0x1B, 0x61, 0x01`), Phải (`0x1B, 0x61, 0x02`).
  - Chữ đậm: Bật (`0x1B, 0x45, 0x01`), Tắt (`0x1B, 0x45, 0x00`).
  - Lệnh cắt giấy tự động: `GS V 66 0` (`0x1D, 0x56, 0x42, 0x00`) hoặc `GS V 0` (`0x1D, 0x56, 0x00`).
  - Xử lý tiếng Việt: chuyển đổi chuỗi tiếng Việt có dấu sang bảng mã máy in nhiệt hoặc chuyển sang tiếng Việt không dấu chuẩn hóa để tránh in ra ký tự rác trên các dòng máy in K80 đời cũ.
- **Cơ chế Fallback An Toàn**:
  - Kiểm tra hỗ trợ WebUSB (`navigator.usb`) hoặc WebSerial (`navigator.serial`).
  - Nếu trình duyệt không hỗ trợ, hoặc người dùng hủy chọn thiết bị, hoặc mất kết nối USB: **tự động chuyển tiếp mượt mà sang hộp thoại `window.print()` khổ K80** (không throw uncaught exception).

#### 5. Vận Chuyển: Tính Phí Ship Tự Động GHN/GHTK Theo Địa Chỉ
- **Phân hệ**: `shipments-view.tsx` & `src/lib/shipping-service.ts`
- **Quy cách tính cước**:
  - Phân tích địa chỉ nhận hàng (Tỉnh/Thành phố, Quận/Huyện).
  - Thuật toán định giá cước:
    - Nội thành TP.HCM (Quận 1, 3, 5, Bình Thạnh...): 16.500đ – 22.000đ (GHN), 18.000đ – 20.000đ (GHTK).
    - Ngoại thành TP.HCM (Thủ Đức, Hóc Môn, Củ Chi, Bình Chánh): 25.000đ – 30.000đ.
    - Liên tỉnh miền Nam: 28.000đ – 35.000đ.
    - Liên tỉnh miền Trung/Bắc: 35.000đ – 45.000đ.
    - Trọng lượng vượt mức: cộng thêm 5.000đ/kg tiếp theo.
  - Tự động áp dụng chính sách Freeship đơn $\ge 500.000đ$ (phí ship về 0đ cho khách, hiển thị cước thực trả ĐVVC trong báo cáo P&L).

#### 6. Hội Viên: Tự Động Gửi Voucher Zalo Dịp Sinh Nhật Khách VIP Theo Lịch
- **Phân hệ**: `customers-view.tsx`, `src/lib/member.ts` & `src/app/api/crm/birthday-vouchers`
- **Quy cách**:
  - Thêm trường `birthday` (ngày sinh) trong hồ sơ khách hàng.
  - Định nghĩa khách VIP: thành viên có hạng `SILVER` (tổng chi tiêu $\ge 1\text{ tr}$), `GOLD` ($\ge 3\text{ tr}$), hoặc `DIAMOND` ($\ge 6\text{ tr}$).
  - Tác vụ định kỳ (Cron / Scheduled Task):
    1. Quét danh sách khách VIP có ngày và tháng sinh nhật trùng với ngày hôm nay.
    2. Kiểm tra chốt chặn chống gửi trùng: tra cứu `LedgerEntry` hôm nay xem đã gửi voucher sinh nhật cho khách này chưa.
    3. Nếu chưa gửi: tự sinh mã Voucher sinh nhật riêng (hoặc gán voucher VIP giảm 20% / 100k), gửi tin nhắn Zalo chúc mừng sinh nhật kèm mã quà tặng.
    4. Ghi nhận Sổ Data `BIRTHDAY_VOUCHER_SENT`.
    5. **Chạy 2 lần trong cùng 1 ngày đảm bảo chỉ gửi duy nhất 1 lần cho mỗi khách (Idempotency 100%)**.

#### 7. Buồng Lái AI: Nút Diễn Tập Đơn Hàng Shopee / TikTok Shop
- **Phân hệ**: `liveops-view.tsx` & `src/app/api/simulate/route.ts`
- **Quy cách**:
  - Bổ sung 2 nút diễn tập trên thanh công cụ Buồng lái AI: `[Diễn tập đơn Shopee]` (màu cam đặc trưng `#EE4D2D`) và `[Diễn tập đơn TikTok Shop]` (màu đen `#000000`).
  - Khi bấm: sinh đơn hàng giả lập với sản phẩm Ưu Đàm thật, snapshot phí sàn tương ứng (Shopee: 8.5%, TikTok Shop: 6.0%), trừ kho đúng chuẩn, và đưa đơn vào hàng đợi xử lý của Buồng lái AI.

---

### 3.5. R6: Tích Hợp Bên Ngoài — Không Gọi Mạng Thật (Safe Mocking)

- **Nguyên tắc an toàn**: Trong suốt quá trình phát triển, kiểm thử tự động và chạy `npm run verify`, **tuyệt đối không thực hiện bất kỳ kết nối mạng nào ra bên ngoài** (không gọi API GHN/GHTK thật, không gọi Zalo OA thật, không gọi VNPT/Viettel thật).
- **Cơ chế Adapter Hai Chế Độ (Dual-Mode Mock Adapter)**:
  - Khi chưa cấu hình key (hoặc ở chế độ test): toàn bộ adapter tự động sử dụng hàm Mock nội bộ. Mock trả về phản hồi hợp lệ, đúng schema, tính toán logic đúng chuẩn và mô phỏng độ trễ tự nhiên (10–50ms).
  - Khi chủ tiệm điền key thật trên màn hình **Kết nối API (`integrations-view`)**: adapter tự động chuyển sang gọi endpoint thật của đối tác.
- **Bảo mật tuyệt đối**:
  - Không hard-code API key, secret token hay mật khẩu trong mã nguồn.
  - Quét toàn bộ codebase không phát hiện secret bị lộ.

---

### 3.6. R7: An Toàn Dữ Liệu & Bảo Tồn CSDL

- **Bảo toàn CSDL**: Dữ liệu hiện có trong `db/custom.db` phải được giữ nguyên vẹn 100%.
- **Quy trình thay đổi Schema**:
  1. Tạo bản sao lưu dự phòng: `copy db/custom.db db/custom.db.bak` trước khi thực hiện bất kỳ lệnh `prisma db push` hoặc thay đổi schema nào.
  2. Mọi trường mới thêm vào `schema.prisma` phải là `optional` (`?`) hoặc có giá trị mặc định (`@default(...)`) để tương thích ngược hoàn toàn với dữ liệu cũ.
- **Dọn dẹp kiểm thử**: Mọi dữ liệu tạm thời sinh ra trong quá trình chạy test (`T-COMPA-...`, `T-COMBO-...`, đơn test) phải được dọn dẹp sạch sẽ trong khối `finally`, hoàn trả nguyên vẹn số lượng bản ghi gốc của các bảng cốt lõi.
- **Cập nhật tài liệu**: Đồng bộ trạng thái mới vào `docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md` và `MATRIX_HANDOFF.md`.

---

## 4. MA TRẬN TÌNH HUỐNG BIÊN & HÀNH VI QUAN SÁT (EDGE CASES)

| # | Phân Hệ / Tính Năng | Đầu Vào / Tình Huống Biên | Hành Vi Quan Sát & Kết Quả Chuẩn |
| :-: | :--- | :--- | :--- |
| 1 | **Bulk Confirm** | Chọn tập hỗn hợp: 2 đơn `PENDING` đủ kho + 1 đơn `CANCELLED` + 1 đơn `PENDING` thiếu tồn kho | 2 đơn hợp lệ được duyệt sang `CONFIRMED`. Đơn hủy bị từ chối báo rõ *"Đơn hàng đã bị hủy"*. Đơn thiếu kho bị từ chối báo rõ *"Sản phẩm X chỉ còn Y trong kho (cần Z)"*. Trả về đủ 4 kết quả trong JSON response. |
| 2 | **Bulk Confirm** | Xác nhận hàng loạt khi kho thành phần Combo vừa chạm 0 bởi đơn trước đó | Đơn Combo đầu tiên hợp lệ trừ hết kho thành phần; đơn Combo kế tiếp trong cùng mẻ lập tức bị từ chối do thiếu thành phần BOM. Chuỗi `StockMovement` không bị âm. |
| 3 | **Batch Print A6** | In gộp 5 đơn trong đó có 2 đơn COD, 1 đơn Freeship, 2 đơn có hàng dễ vỡ | Sinh 5 trang A6 riêng biệt; tem hàng dễ vỡ có khối đỏ cảnh báo nổi bật; tem COD ghi rõ số tiền thu hộ; đơn Freeship ghi *"Đã thanh toán — Không thu hộ"*. |
| 4 | **E-Invoice VAT XML** | Xuất XML từ hóa đơn bán có trạng thái `CANCELLED` | API chặn `HTTP 400 Bad Request`, thông báo *"Hóa đơn đã bị hủy, không thể xuất XML"*. Không sinh file XML. |
| 5 | **E-Invoice VAT XML** | Hóa đơn bán lẻ trực tiếp không có thông tin người mua (khách lẻ không lấy MST) | XML xuất thẻ `<NMua>` với `<Ten>Khách lẻ</Ten>`, thẻ `<MST>` để rỗng theo đúng quy định QĐ 1450 cho khách lẻ. Tổng tiền và thuế suất vẫn khớp 100%. |
| 6 | **E-Invoice Ký số Mock** | Gửi hóa đơn sang adapter ký số khi chưa điền token VNPT/Viettel | Adapter Mock tự động ký bằng chữ ký số mô phỏng chuẩn XML-DSig, sinh mã CQT giả lập `00...`, trạng thái hóa đơn đổi sang đã ký. |
| 7 | **CSV Export/Import** | File CSV nhập vào có dòng bị sai định dạng giá bán (`"abc"`), dòng tồn kho âm (`-5`), và dòng SKU bị trùng | API trả về lỗi liệt kê đúng dòng số mấy, trường nào sai, lý do sai. Toàn bộ transaction bị hủy, CSDL không bị lọt dữ liệu hỏng. |
| 8 | **CSV Round-trip** | Xuất CSV sản phẩm ➔ Nhập lại ngay file vừa xuất không sửa đổi | Toàn bộ 15 sản phẩm và bảng giá 10 kênh được cập nhật/giữ nguyên trọn vẹn, không phát sinh lỗi. |
| 9 | **Dashboard Date Filter** | Chuyển đổi giữa 4 mốc: 7 ngày, 14 ngày, 30 ngày, 90 ngày | Biểu đồ Recharts cập nhật lại số lượng cột tương ứng (7/14/30/90 điểm). Tổng doanh thu từng ngày khớp chính xác với `db.order.aggregate`. |
| 10 | **PO Nhập Hàng** | Tạo đơn mua PO nháp 10 sản phẩm ➔ Duyệt PO | Tồn kho sản phẩm trước và sau khi tạo/duyệt PO không đổi (vẫn giữ nguyên). `StockMovement` không sinh thêm bản ghi nào. |
| 11 | **PO Nhận Hàng Một Phần** | PO đặt mua 10 sản phẩm ➔ Thực nhận đợt 1 là 4 sản phẩm | Tồn kho chỉ tăng đúng 4 đơn vị; trạng thái PO chuyển sang `PARTIALLY_RECEIVED`; ghi 1 `StockMovement` với `quantity = 4`. |
| 12 | **Chat Drag-and-Drop** | Kéo-thả file ảnh dung lượng lớn (5MB) vào khung chat | Hệ thống bắt sự kiện `drop`, nén ảnh qua Canvas về $\le 350\text{ KB}$ và hiển thị preview trong ô nhập tin nhắn sẵn sàng gửi. |
| 13 | **In Nhiệt K80** | Máy tính không kết nối máy in WebUSB hoặc trình duyệt chặn quyền USB | Hàm in bắt ngoại lệ, tự động chuyển tiếp sang gọi `window.print()` hộp thoại in của trình duyệt khổ 80mm. Không vỡ giao diện. |
| 14 | **In Nhiệt ESC/POS** | Đơn hàng có tên sản phẩm tiếng Việt đầy đủ dấu (*"Trầm Hương Thượng Hạng"*) | Bộ mã hóa sinh chuỗi byte chuẩn kèm lệnh cắt giấy `0x1D 0x56 0x42 0x00`, hiển thị rõ ràng không bị lỗi font rác. |
| 15 | **Voucher Sinh Nhật VIP** | Chạy tác vụ quét sinh nhật 2 lần liên tiếp trong cùng 1 ngày | Lần 1: Khách VIP sinh nhật nhận voucher và tin nhắn Zalo. Lần 2: Hệ thống phát hiện đã gửi hôm nay qua Sổ Data, bỏ qua và không gửi thêm. |
| 16 | **Buồng Lái Diễn Tập** | Bấm nút "Diễn tập đơn Shopee" và "Diễn tập đơn TikTok" trên Buồng lái AI | Tạo đơn hàng mới với mã kênh tương ứng, snapshot phí sàn chuẩn (8.5% và 6%), tự sinh thông báo đơn mới trên màn hình. |

---

## 5. BỘ TIÊU CHÍ NGHIỆM THU & CỔNG CHẤT LƯỢNG MÃ NGUỒN

Để hoàn thành nhiệm vụ và sẵn sàng Go-Live, toàn bộ các cổng chất lượng sau phải đạt `PASS 100%`:

1. **Cổng kiểm tra kiểu tĩnh & chuẩn mã**:
   - `tsc --noEmit` đạt `0 errors`.
   - `npm run lint` (`eslint src`) đạt `0 errors, 0 warnings`.
2. **Cổng kiểm thử chuỗi tồn kho**:
   - `npm run test:chain` (`scripts/verify-chain.ts`) khớp 100% biến động kho.
3. **Cổng kiểm thử kịch bản thực tế & đối kháng**:
   - `npm run test:scenarios` (`scripts/verify-realworld-scenarios.ts`) vượt qua tất cả các kịch bản có sẵn và các kịch bản đối kháng mới bổ sung cho R2–R5.
4. **Cổng kiểm chứng tổng hợp**:
   - `npm run verify` chạy thông suốt cả 4 bước với mã thoát `0`.
   - `npm run build` thành công.
5. **Cổng an toàn dữ liệu**:
   - Số lượng bản ghi cốt lõi trong `db/custom.db` trước và sau đợt nâng cấp khớp nhau (hoặc chỉ có dữ liệu demo có chủ đích được ghi nhận rõ).

---
*Báo cáo được biên soạn độc lập bởi Specification Miner. Không can thiệp mã nguồn.*
