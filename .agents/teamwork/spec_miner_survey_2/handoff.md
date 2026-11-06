# BÁO CÁO BÀN GIAO ĐẶC TẢ YÊU CẦU (HANDOFF REPORT)
## Phân Tích & Tổng Hợp Yêu Cầu Kỹ Thuật OPENVN · Ưu Đàm Suite (R1–R7)

- **Agent thực hiện**: `spec_miner_survey_2` (Specification & Requirements Miner)
- **Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`
- **Thời gian lập**: 2026-10-26T07:35:00Z
- **Thư mục làm việc**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_survey_2`
- **File tài liệu chính**: `survey_specs.md`

---

### 1. OBSERVATION (Quan sát Thực tế)

1. **Tài liệu nguồn đã khảo sát**:
   - `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md`: Đặt ra 7 yêu cầu cốt lõi (R1–R7) và các tiêu chí nghiệm thu nghiêm ngặt về chất lượng code (`verify`), an toàn dữ liệu (`db/custom.db`), xác nhận hàng loạt (R2), hóa đơn VAT điện tử (R3), CSV/Excel sản phẩm (R4), các tính năng P2 (R5), mock tích hợp bên ngoài (R6) và cập nhật tài liệu (R7).
   - `MATRIX_HANDOFF.md`: Trạng thái bàn giao hiện tại của hệ thống OPENVN · Ưu Đàm Suite, kiến trúc Next.js 16 (`:3010`), Socket.io Realtime Bus (`:3013`), 12 chốt chặn nghiệp vụ backend khép kín, bộ test kịch bản 17/17 pass và chuỗi biến động kho.
   - `docs/FEATURE_EXPERIENCE_MATRIX.md`: Liệt kê chi tiết 19 phân hệ. Đã chỉ rõ các hạn chế và đề xuất P1, P2 còn thiếu:
     - Phân hệ 1 (POS): Chưa kết nối trực tiếp máy in nhiệt USB qua WebUSB/ESC-POS (P2).
     - Phân hệ 2 (Dashboard): Biểu đồ doanh thu cố định 14 ngày, thiếu bộ lọc 7/14/30/90 ngày (P2).
     - Phân hệ 3 (Buồng lái AI): Thiếu nút diễn tập đơn Shopee / TikTok Shop (P2).
     - Phân hệ 4 (Đơn hàng): Chưa hỗ trợ chọn hàng loạt để duyệt và in phiếu giao hàng (P1).
     - Phân hệ 5 (Hóa đơn VAT): Chưa xuất XML chuẩn Tổng cục Thuế & mock ký số (P1).
     - Phân hệ 6 (Vận chuyển): Phí vận chuyển ĐVVC chưa tự động tính theo GHN/GHTK (P2).
     - Phân hệ 7 (Chat đa kênh): Thiếu kéo-thả tải ảnh từ máy tính (P2).
     - Phân hệ 8 (Sản phẩm): Thiếu nút Import/Export CSV danh mục & bảng giá (P2).
     - Phân hệ 11 (Nhập hàng): Thiếu bước PO nháp ➔ duyệt ➔ nhận hàng (P2).
     - Phân hệ 12 (Khách hàng): Thiếu tự động gửi voucher Zalo sinh nhật VIP (P2).
   - `docs/UX_UI_FLOW.md`, `docs/OPERATIONS_RUNBOOK.md`, `docs/RELEASE_CHECKLIST.md`: Định hình chuẩn thiết kế OPENVN, quy trình vận hành ca trực và checklist kiểm định phát hành.
   - `worklog.md` (lines 500–906): Ghi nhận toàn bộ tiến trình lịch sử từ Task 20 đến Task 31 (chuẩn hóa dữ liệu Ưu Đàm, tích điểm hội viên, Sổ Data Lineage Diff Trước/Sau, VietQR trên bản in HĐ bán, Báo cáo P&L 5 tầng, Realtime polling fallback 10s, đồng bộ giá riêng và mô tả đa kênh).

2. **Khảo sát Cơ sở Dữ liệu Thực tế (`db/custom.db`)**:
   - Lệnh kiểm tra: `node -e "const { PrismaClient } = require('@prisma/client'); ..."`
   - Kết quả số lượng bản ghi cơ sở dữ liệu hiện tại:
     - `Product`: **15** (11 SP đơn lẻ, 1 Combo BOM `UD-COMBO-001`, 3 mã test/liên kết)
     - `Order`: **175** (bao gồm đơn từ các kênh TMĐT, POS, Zalo OA, Website)
     - `StockMovement`: **260**
     - `Customer`: **36** (trong đó có 3 thành viên VIP)
     - `SalesInvoice`: **12**
     - `PurchaseInvoice`: **4**
     - `Shipment`: **86**
     - `Voucher`: **4**
     - `Warehouse`: **4**

3. **Khảo sát Cổng Kiểm Định Chất Lượng Hiện Tại**:
   - `npm run test:chain`: **PASS** (kiểm tra chuỗi biến động kho của `UD-QT-002` [14 biến động, tồn 4] và `UD-VL-001` [24 biến động, tồn 149] đều khớp 100% với tồn thực tế, mã thoát `0`).
   - `npm run lint`: **PASS** (`eslint src` đạt 0 lỗi, 0 cảnh báo, mã thoát `0`).
   - `npx tsc --noEmit`: **PASS** (0 lỗi TypeScript, mã thoát `0`).
   - `scripts/verify-realworld-scenarios.ts`: Chứa 21 kịch bản kiểm thử nghiệp vụ thực tế và đối kháng.

---

### 2. LOGIC CHAIN (Chuỗi Suy Luận Kỹ Thuật)

1. **Từ Yêu cầu R1 (Gia cố Hệ thống)**:
   - Các chốt chặn nghiệp vụ cốt lõi (tồn kho Combo BOM tự suy ra từ thành phần, chặn bán SP `INACTIVE`, chặn sửa/mở lại đơn `CANCELLED`, chặn xuất trùng hóa đơn bán, chặn ghi chứng từ vào kỳ kế toán đã `CLOSED`, hoàn kho khi đơn/hóa đơn hủy hoặc vận đơn `RETURNED`, tích điểm hội viên idempotent) đã được hoàn thiện và bảo vệ bằng 21 kịch bản kiểm thử trong `scripts/verify-realworld-scenarios.ts`.
   - Cần tiếp tục duy trì tính bất biến của các chốt chặn này khi mở rộng tính năng mới.

2. **Từ Yêu cầu R2 (Đơn hàng Hàng loạt)**:
   - Hiện tại `orders-view.tsx` chỉ có thao tác duyệt đơn đơn lẻ trên từng dòng.
   - Để thực hiện R2:
     - Giao diện: Cần bổ sung cột checkbox từng dòng, checkbox "Chọn tất cả", và thanh công cụ tác vụ hàng loạt.
     - Backend: Cần API `POST /api/orders/bulk-confirm` nhận danh sách `orderIds`.
     - Chốt chặn: Phải kiểm tra trạng thái (`PENDING` mới được duyệt, `CANCELLED` thì báo lỗi từ chối rõ ràng) và kiểm tra tồn kho gộp cả SP lẻ lẫn thành phần Combo BOM. Nếu thiếu kho, trả về lý do cụ thể từng đơn bị từ chối; chỉ duyệt các đơn hợp lệ.
     - In ấn hàng loạt: Bổ sung modal xem trước in gộp các tem vận đơn A6 (CSS `page-break-after: always`).

3. **Từ Yêu cầu R3 (Hóa đơn VAT Điện tử & Mock Ký số)**:
   - Hiện tại hệ thống mới in hóa đơn A4 qua `window.print()` có mã VietQR, chưa có tính năng xuất file XML chuẩn Tổng cục Thuế.
   - Theo **Nghị định 123/2020**, **Thông tư 78/2021** và **Quyết định 1450/QĐ-TCT**, file XML phải có cấu trúc `<HDon><DLHDon>...<DSCKS>` với các trường định danh bắt buộc (`TTChung`, `NBan`, `NMua`, `DSHangHoa`, `TToan` với tổng tiền bằng chữ).
   - Hóa đơn đã hủy (`CANCELLED`) tuyệt đối không được xuất XML hợp lệ (trả về HTTP 400).
   - Cần bổ sung adapter ký số với chế độ Mock (tự động ký giả lập chuẩn XML-DSig khi chưa cấu hình token VNPT/Viettel).

4. **Từ Yêu cầu R4 (Nhập/Xuất Danh mục Sản phẩm CSV)**:
   - Hiện tại `products-view.tsx` chưa có nút Import/Export CSV.
   - Xuất CSV: Cần API `GET /api/products/export` trả về CSV UTF-8 có BOM (tương thích Excel Windows), bao gồm SKU, tên, giá vốn, giá bán chung, tồn kho, loại SP, hàng dễ vỡ và bảng giá riêng theo kênh.
   - Nhập CSV: Cần API `POST /api/products/import` kiểm tra dữ liệu từng dòng. Nếu có bất kỳ dòng nào sai (giá âm, SKU trùng, thiếu tên...), phải trả về toàn bộ $N$ lỗi theo đúng số dòng và hủy bỏ transaction (không ghi đè dữ liệu hỏng vào DB).
   - Round-trip guarantee: Xuất ra rồi nhập lại ngay phải bảo toàn 100% dữ liệu.

5. **Từ Yêu cầu R5 (Các Tính Năng P2 Còn Lại)**:
   - **Dashboard Date Filter**: API `GET /api/dashboard?days=` (7/14/30/90) và nút chuyển trên UI.
   - **PO Nhập hàng**: Bổ sung trạng thái `DRAFT` ➔ `APPROVED` ➔ `RECEIVE` (nhận đủ/một phần). Tồn kho chỉ được tăng khi thực nhận hàng.
   - **Chat Drag & Drop**: Bổ sung sự kiện HTML5 Drag & Drop trên khung chat `inbox-view.tsx`, nén ảnh qua Canvas ($\le 350\text{ KB}$) và nạp vào Vision AI.
   - **In nhiệt K80 ESC/POS**: Xây dựng bộ mã hóa lệnh ESC/POS (`ESC @`, `GS V`, xử lý ký tự tiếng Việt) gửi qua WebUSB/WebSerial, tự động fallback về `window.print()` khi không hỗ trợ thiết bị.
   - **Tính phí ship GHN/GHTK**: Adapter tính cước theo địa chỉ và trọng lượng với chế độ Mock an toàn.
   - **Voucher sinh nhật VIP**: Bổ sung trường ngày sinh trong `Customer`, tác vụ quét định kỳ cho khách hạng `SILVER`/`GOLD`/`DIAMOND`, đảm bảo tính idempotent (chạy 2 lần trong ngày chỉ gửi 1 lần).
   - **Diễn tập Shopee / TikTok Shop**: Thêm nút diễn tập trên Buồng lái AI, sinh đơn hàng giả lập với snapshot phí sàn chính xác.

6. **Từ Yêu cầu R6 & R7 (An toàn Tích hợp & CSDL)**:
   - Tuyệt đối không gọi mạng thật trong quá trình kiểm thử.
   - Sao lưu `db/custom.db` trước mọi thay đổi schema. Đảm bảo số lượng bản ghi cốt lõi trước và sau đợt làm việc được giữ nguyên.

---

### 3. CAVEATS (Lưu Ý & Ranh Giới Nghiên Cứu)

1. **Ranh giới công việc**: Với vai trò là **Specification Miner**, tôi tuân thủ nghiêm ngặt nguyên tắc **READ-ONLY**, không can thiệp sửa đổi mã nguồn ứng dụng hay ghi đè CSDL sản xuất. Mọi phân tích và đề xuất được ghi vào `survey_specs.md` và `handoff.md`.
2. **Phiên bản Next.js 16**: Tuân thủ cảnh báo trong `AGENTS.md` về sự khác biệt API của Next.js 16 App Router (các tham số `params` trong route handler là `Promise<{ id: string }>`).
3. **Mã hóa tiếng Việt ESC/POS**: Các dòng máy in nhiệt K80 Trung Quốc giá rẻ thường không hỗ trợ đầy đủ font Unicode tiếng Việt. Khuyến nghị giải pháp kỹ thuật: hỗ trợ cả 2 chế độ (chuyển đổi sang bảng mã TCVN-3 / UTF-8 hoặc chuyển sang tiếng Việt không dấu chuẩn hóa) để đảm bảo không bị lỗi in rác.

---

### 4. CONCLUSION (Kết Luận & Khuyến Nghị Thực Thi)

1. **Hiện trạng hệ thống**: OPENVN · Ưu Đàm Suite đang có nền tảng kiến trúc vững chắc, toàn bộ 12 chốt chặn backend khép kín, 21 kịch bản kiểm thử thực tế và chuỗi biến động kho toán học đạt trạng thái chuẩn xác 100%. Các công cụ kiểm định (`npm run lint`, `tsc --noEmit`, `npm run test:chain`) đều đang vượt qua với 0 lỗi.
2. **Kế hoạch thực thi đề xuất cho các Agent tiếp theo**:
   - **Giai đoạn 1 (An toàn dữ liệu & Nền tảng)**: Sao lưu `copy db/custom.db db/custom.db.bak`; cập nhật `prisma/schema.prisma` (thêm trường `birthday` cho Customer, trạng thái PO nếu cần) với các trường optional/default an toàn; chạy `npm run db:push`.
   - **Giai đoạn 2 (Hoàn thiện P1)**: Triển khai R2 (Bulk Confirm + Batch Shipping Slips A6) và R3 (Xuất XML hóa đơn VAT theo QĐ 1450 + Mock e-signing adapter).
   - **Giai đoạn 3 (Hoàn thiện P2)**: Triển khai R4 (Import/Export CSV sản phẩm), R5 (Dashboard date filter, PO workflow, Chat drag-drop, ESC/POS WebUSB print + fallback, Mock shipping fee GHN/GHTK, Zalo birthday VIP voucher, Shopee/TikTok drill).
   - **Giai đoạn 4 (Kiểm thử toàn diện & Bàn giao)**: Viết kịch bản kiểm thử đường chuẩn và đối kháng cho từng tính năng mới, chạy `npm run verify`, cập nhật tài liệu `docs/` và `MATRIX_HANDOFF.md`.

---

### 5. VERIFICATION METHOD (Phương Pháp Kiểm Chứng Độc Lập)

Người nhận bàn giao có thể kiểm chứng độc lập báo cáo này thông qua các bước sau:

1. **Kiểm tra tài liệu đặc tả chi tiết**:
   - Mở và đọc file: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_survey_2\survey_specs.md`.
2. **Kiểm tra trạng thái CSDL thực tế**:
   ```bash
   node -e "const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient(); async function count() { console.log({ products: await db.product.count(), orders: await db.order.count(), stockMovements: await db.stockMovement.count(), customers: await db.customer.count() }); } count();"
   ```
   Xác nhận: `products: 15`, `orders: 175`, `stockMovements: 260`, `customers: 36`.
3. **Kiểm tra chuỗi biến động kho toán học**:
   ```bash
   npm run test:chain
   ```
   Xác nhận: Thoát với mã `0`, in ra thông báo `chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓`.
4. **Kiểm tra chuẩn mã nguồn & kiểu tĩnh**:
   ```bash
   npm run lint
   npx tsc --noEmit
   ```
   Xác nhận: Cả 2 lệnh đều thoát với mã `0` (0 errors, 0 warnings).
