# BÁO CÁO BÀN GIAO KHẢO SÁT KIẾN TRÚC MÃ NGUỒN (HANDOFF REPORT)
**Dự án**: OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)
**Người thực hiện**: `explorer_survey_1` (Teamwork Explorer)
**Thời điểm bàn giao**: 2026-10-26T14:38:00+07:00
**Đối tượng nhận**: Parent Agent / Orchestrator (`7124d145-f8bf-4670-a0d0-13114c2b24e3`) & Đội ngũ Kỹ sư Thực thi (Fixer / Builder)

---

## 1. OBSERVATION (QUAN SÁT THỰC TẾ)

Tất cả các quan sát dưới đây được trích xuất trực tiếp từ các tệp mã nguồn, lệnh shell và nhật ký thực thi trên hệ thống thực tế tại thư mục gốc `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)`:

### 1.1. Kết quả thực thi các cổng kiểm định (Quality Gates)
- **TypeScript Typecheck (`npx tsc --noEmit`)**:
  - Lệnh: `npx tsc --noEmit`
  - Kết quả: Mã thoát `0`. Hoàn toàn không có lỗi kiểu dữ liệu (`0 errors`).
- **Linter (`npm run lint`)**:
  - Lệnh: `npm run lint` (chạy `eslint src`)
  - Kết quả: Mã thoát `0`. Hoàn toàn không có lỗi và không có cảnh báo (`0 errors, 0 warnings`).
- **Kiểm định tính đơn điệu sổ kho (`npm run test:chain`)**:
  - Lệnh: `npm run test:chain` (chạy `node --experimental-strip-types scripts/verify-chain.ts`)
  - Kết quả:
    ```text
    ✓ Product UD-QT-002: 4 movements, stock 96 == last stockAfter 96
    ✓ Product UD-VL-001: 5 movements, stock 45 == last stockAfter 45
    ✓ Stock chain verification passed
    ```
    Mã thoát `0`.
- **Kiểm định 21 kịch bản nghiệp vụ thực tế (`npm run test:scenarios`)**:
  - Lệnh: `npm run test:scenarios` (chạy `node --experimental-strip-types scripts/verify-realworld-scenarios.ts`)
  - Kết quả:
    ```text
    ============================================================
    KẾT QUẢ KIỂM THỬ: 21 ĐẠT / 21 TỔNG CỘNG
    ============================================================
    ```
    Toàn bộ 21/21 kịch bản đạt chuẩn nghiệp vụ (bao gồm: bán lẻ POS, Combo BOM trừ kho thành phần, hoàn hủy đơn, bán chéo kho A xuất kho B, đối soát COD, khóa kỳ kế toán, Sổ cái Lineage Audit Trail, API Integration test).
- **Biên dịch sản xuất (`npm run build`)**:
  - Lệnh: `npm run build` (chạy `next build` với Turbopack)
  - Kết quả: Biên dịch thành công sau 6.0 giây, tạo 6/6 route tĩnh, mã thoát `0`.
  - Cảnh báo xuất hiện trong quá trình build:
    1. `src/middleware.ts`: `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.`
    2. `src/app/api/system/backup/route.ts` (dòng 15, 26, 30): `Dynamic filesystem access causes tracing of the whole project into the asset list.`

### 1.2. Trạng thái cổng mạng và tiến trình (Ports & Daemons)
- Lệnh: `Get-NetTCPConnection -LocalPort 3010,3013 -State Listen`
- Kết quả:
  - Cổng `3010` (Web Server & CMS Quản trị): Trạng thái `Listen`, PID `48364` và `22288`.
  - Cổng `3013` (Realtime Event Bus Socket.IO): Trạng thái `Listen`, PID `48432`.
- Kiểm tra phản hồi HTTP cục bộ:
  - `Invoke-RestMethod http://localhost:3013/health`: Trả về `{"status":"ok","clients":0,"timestamp":"2026-10-26T07:29:43.045Z"}`.
  - `Invoke-RestMethod http://localhost:3010/api/dashboard`: Trả về JSON tổng quan doanh thu, đơn hàng, KPI hợp lệ trong dưới 1 giây.

### 1.3. Cơ sở dữ liệu và Lược đồ Prisma
- Đường dẫn: `prisma/schema.prisma` và `db/custom.db` (kích thước `2,392,064` bytes ~ 2.28 MB).
- Tổng cộng 20 models: `Product`, `Category`, `Channel`, `ChannelListing`, `Customer`, `Order`, `OrderItem`, `StockMovement`, `Shipment`, `BomComponent`, `PurchaseInvoice`, `PurchaseInvoiceItem`, `SalesInvoice`, `SalesInvoiceItem`, `AccountingPeriod`, `LedgerEntry`, `Warehouse`, `WarehouseStock`, `Voucher`, `ApiKey`, `WebhookEndpoint`, `WebhookDelivery`, `IntegrationCredential`, `AgentActivity`, `OrderEvent`, `DirectMessage`, `AutomationSetting`, `AfterSalesCase`, `AppSetting`.

### 1.4. Quan sát chi tiết về các lỗ hổng và khoảng trống tính năng (Gaps)
1. **Thiếu Transaction tại API Hủy đơn**:
   - Tệp: `src/app/api/orders/[id]/route.ts`, dòng 80–118:
     Khi trạng thái chuyển thành `CANCELLED`, hệ thống thực hiện vòng lặp `for (const item of order.items)` để gọi `db.product.update(...)`, `db.stockMovement.create(...)` và `syncComboStock(...)` bằng các lời gọi async tuần tự độc lập, không nằm trong khối `db.$transaction`.
2. **Thiếu Transaction tại API Cập nhật vận đơn hoàn trả**:
   - Tệp: `src/app/api/shipments/[id]/route.ts`, dòng 103–153:
     Khi `status === 'RETURNED'`, hệ thống cập nhật `shipment.update`, sau đó hoàn kho từng mặt hàng của đơn hàng ngoài transaction.
3. **Nguy cơ tạo trùng khách hàng theo số điện thoại**:
   - Tệp: `src/app/api/customers/route.ts`, dòng 95–120:
     Phương thức `POST` nhận `name`, `phone`, `email`, `address` và gọi trực tiếp `db.customer.create({ data: ... })` mà không có bước kiểm tra `findFirst({ where: { phone } })`. Bảng `Customer` trong `schema.prisma` dòng 104–131 không có ràng buộc `@unique` trên cột `phone`.
4. **Tính năng R2 (Đơn hàng hàng loạt) chưa tồn tại**:
   - Tệp: `src/components/cms/views/orders-view.tsx`: Không có ô checkbox chọn đơn trên từng dòng, không có thanh tác vụ hàng loạt.
   - Thư mục: `src/app/api/orders/`: Không có endpoint `bulk-confirm/route.ts`.
5. **Tính năng R3 (Hóa đơn VAT XML chuẩn QĐ 1450/QĐ-TCT) chưa tồn tại**:
   - Thư mục `src/lib/`: Không có bộ sinh XML chuẩn QĐ 1450 (`einvoice.ts`).
   - Thư mục `src/app/api/sales-invoices/`: Không có route xuất XML hoặc adapter ký số điện tử.
6. **Tính năng R4 (Nhập/xuất CSV sản phẩm & bảng giá) chưa tồn tại**:
   - Tệp: `src/components/cms/views/products-view.tsx`: Không có nút Import/Export CSV.
   - Thư mục `src/app/api/products/`: Không có endpoint `/export` và `/import`.
7. **Các tính năng P2 (R5) còn thiếu**:
   - `src/app/api/dashboard/route.ts` (dòng 15): Cố định lấy `startDate = subDays(now, 14)`, không hỗ trợ tham số 7/14/30/90 ngày.
   - `src/components/cms/views/purchase-view.tsx` & `src/lib/invoice-service.ts`: Thiếu quy trình Đơn đặt mua PO (Nháp ➔ Duyệt ➔ Nhập kho thực tế). Hiện tại khi tạo `PurchaseInvoice` là tăng kho ngay lập tức.
   - `src/components/cms/views/inbox-view.tsx`: Chỉ có nút `<input type="file">` ẩn khi bấm icon camera/kẹp ghim, chưa có xử lý `onDragOver` và `onDrop` để kéo thả ảnh vào khung chat.
   - `src/components/cms/views/pos-view.tsx` (dòng 348–353): Nút In bill chỉ gọi hàm `window.print()`, chưa tích hợp ESC/POS qua WebUSB/WebSerial.
   - `src/components/cms/views/shipments-view.tsx`: Chưa có chức năng tính phí ship tự động GHN/GHTK theo địa chỉ giao hàng.
   - `src/lib/agent-engine.ts`: Chưa có tiến trình tự động quét sinh nhật và gửi voucher Zalo cho khách VIP.
   - `src/app/api/simulate/route.ts` (dòng 23–85): Chỉ có logic sinh `order` (Zalo) và `message` (Zalo), chưa có nút diễn tập đơn Shopee và TikTok Shop.

---

## 2. LOGIC CHAIN (CHUỖI LẬP LUẬN TỪ QUAN SÁT ĐẾN KẾT LUẬN)

1. **Từ Quan sát 1.1 và 1.2**:
   - Các lệnh kiểm tra `tsc --noEmit`, `eslint`, `test:chain`, và `test:scenarios` đều vượt qua 100% với 0 lỗi.
   - Cả hai tiến trình máy chủ (cổng 3010 và 3013) đang chạy ngầm và phản hồi API với độ trễ < 1s.
   - *Suy luận*: Nền tảng hiện tại của hệ thống cực kỳ ổn định, không bị vỡ logic cốt lõi. Bất kỳ sự phát triển hoặc sửa đổi nào tiếp theo bắt buộc phải duy trì 4 cổng kiểm định này ở trạng thái PASS 100%.

2. **Từ Quan sát 1.4 (Mục 1, 2, 3) đến Đánh giá R1 (Hardening)**:
   - SQLite có đặc tính khoá bảng khi ghi. Khi một chuỗi các thao tác ghi (hủy đơn, hoàn kho, tạo biến động kho, đồng bộ tồn kho Combo) chạy rời rạc mà không có `db.$transaction`, nếu xảy ra lỗi ngoại lệ tại bất kỳ bước trung gian nào (ví dụ: sản phẩm bị khóa hoặc lỗi tham chiếu), trạng thái dữ liệu sẽ bị dở dang (đơn hàng đã đổi trạng thái `CANCELLED` nhưng kho không được hoàn, hoặc chỉ hoàn một nửa số mặt hàng).
   - Khi `Customer.phone` không có unique constraint và API `POST /api/customers` không kiểm tra trùng lặp trước khi thêm, khách hàng mua nhiều lần có thể bị tạo thành nhiều bản ghi độc lập, làm sai lệch điểm hội viên và hồ sơ trí nhớ AI.
   - *Suy luận*: Đây là các lỗi tiềm ẩn (silent failure risks) cần được xử lý ngay trong R1 để bảo vệ tính toàn vẹn dữ liệu trước khi thêm tính năng mới.

3. **Từ Quan sát 1.4 (Mục 4) đến Đánh giá R2 (Bulk Orders)**:
   - Không có API `POST /api/orders/bulk-confirm` và giao diện `orders-view.tsx` không có cơ chế đa chọn.
   - *Suy luận*: R2 là tính năng P1 chưa được triển khai (0%). Cần xây dựng mới API bọc kiểm tra kho gộp và giao diện hộp thoại xác nhận / in phiếu giao hàng hàng loạt.

4. **Từ Quan sát 1.4 (Mục 5) đến Đánh giá R3 (VAT XML E-Invoice)**:
   - Hệ thống mới chỉ có bản in HTML/PDF hóa đơn (`src/components/cms/invoice-print.tsx`) kèm mã VietQR, hoàn toàn chưa có cấu trúc XML theo tiêu chuẩn QĐ 1450/QĐ-TCT và adapter ký số VNPT/Viettel.
   - *Suy luận*: R3 là tính năng P1 chưa được triển khai (0%). Cần viết mô-đun sinh XML tuân thủ cấu trúc `<HDon><DLHDon>...`, kiểm tra chặn xuất XML với đơn đã hủy, và tạo endpoint mock ký số.

5. **Từ Quan sát 1.4 (Mục 6) đến Đánh giá R4 (Product CSV/Excel)**:
   - Chưa có endpoint import/export CSV cho sản phẩm và bảng giá.
   - *Suy luận*: R4 là tính năng P2 cần triển khai đầy đủ cả phía backend (kiểm tra dòng lỗi chi tiết, không lưu dữ liệu sai) và giao diện upload preview.

6. **Từ Quan sát 1.4 (Mục 7) đến Đánh giá R5 (P2 Features)**:
   - 7 mục nhỏ của R5 đều đã được định vị chính xác vị trí thiếu hụt trong mã nguồn và giao diện.
   - *Suy luận*: Mỗi mục nhỏ có phạm vi can thiệp rất rõ ràng và độc lập, có thể giao việc song song hoặc tuần tự cho đội ngũ lập trình mà không gây xung đột chéo.

---

## 3. CAVEATS (CÁC ĐIỂM CHƯA KHẢO SÁT & GIẢ ĐỊNH)

1. **Kết nối mạng và thiết bị phần cứng thật**:
   - Khảo sát không kích hoạt kết nối tới các dịch vụ thật bên ngoài (như tài khoản VNPT/Viettel SInvoice thật, máy in nhiệt K80 cắm cổng USB/COM thật, hoặc máy chủ sandbox của GHN/GHTK) mà tuân thủ nguyên tắc chạy trên môi trường Giả lập (Mock Mode).
2. **Giới hạn SQLite Concurrency**:
   - Cơ sở dữ liệu sử dụng SQLite file-based (`db/custom.db`). Tất cả các thao tác ghi đồng thời cao cần được gom cụm trong `db.$transaction` với timeout hợp lý để tránh lỗi `database is locked`.
3. **Các tệp metadata của Agent**:
   - Mọi báo cáo và kế hoạch đều được đặt tại thư mục `.agents/teamwork/explorer_survey_1/`. Không có bất kỳ tệp code ứng dụng nào bị ghi đè trong phiên khảo sát này.

---

## 4. CONCLUSION (KẾT LUẬN & ĐỀ XUẤT HÀNH ĐỘNG)

1. **Đánh giá tổng thể**:
   - Hệ thống **OPENVN · Ưu Đàm Suite** có cấu trúc mã nguồn chất lượng cao, phân chia tầng rõ ràng giữa UI (Next.js App Router, Shadcn UI), Service Logic (`src/lib/*`), Database (`Prisma ORM`), và Realtime Bus (`Socket.IO`).
   - Bộ kiểm thử tự động 21 kịch bản (`verify-realworld-scenarios.ts`) là "tấm lưới bảo vệ" tuyệt đối cho toàn bộ các nghiệp vụ phức tạp nhất (Combo BOM, tính kho monotonic, bán chéo đa kho, tích điểm hội viên, sổ cái kế toán).

2. **Kế hoạch hành động chi tiết đề xuất cho Điều phối viên (Orchestrator)**:
   - **Giai đoạn 1 (R1 - Hardening & An toàn dữ liệu)**:
     - Bọc `db.$transaction` cho `src/app/api/orders/[id]/route.ts` (luồng Hủy đơn).
     - Bọc `db.$transaction` cho `src/app/api/shipments/[id]/route.ts` (luồng Vận đơn RETURNED).
     - Bổ sung kiểm tra trùng lặp SĐT trong `src/app/api/customers/route.ts`.
     - Thêm `/*turbopackIgnore: true*/` và cố định đường dẫn trong `src/app/api/system/backup/route.ts`.
   - **Giai đoạn 2 (R2 & R3 - Triển khai tính năng P1)**:
     - Tạo `POST /api/orders/bulk-confirm` + giao diện đa chọn và in phiếu hàng loạt trong `orders-view.tsx`.
     - Tạo bộ sinh XML hóa đơn điện tử `src/lib/einvoice.ts` chuẩn QĐ 1450/QĐ-TCT + API tải XML + Mock ký số.
   - **Giai đoạn 3 (R4 & R5 - Triển khai tính năng P2)**:
     - Nhập/xuất CSV sản phẩm và bảng giá (`/api/products/export`, `/api/products/import`, UI preview).
     - Thêm bộ chọn khoảng ngày 7/14/30/90 trên Dashboard.
     - Quy trình Đơn đặt mua PO (Nháp ➔ Duyệt ➔ Nhận kho thực tế).
     - Chat kéo-thả ảnh (`inbox-view.tsx`).
     - POS in nhiệt K80 trực tiếp qua WebUSB/WebSerial ESC/POS (fallback `window.print`).
     - Tự động tính phí ship GHN/GHTK theo địa chỉ.
     - Tự động gửi voucher sinh nhật Zalo cho khách VIP.
     - Bổ sung nút diễn tập đơn Shopee và TikTok Shop trên Buồng lái AI.
   - **Giai đoạn 4 (R6 & R7 - Kiểm định tổng thể & Bàn giao)**:
     - Chạy lại toàn bộ `npm run verify` (`tsc`, `lint`, `test:chain`, `test:scenarios`).
     - Kiểm thử giao diện trên trình duyệt (Desktop 1440px và Mobile 390px).
     - Cập nhật hồ sơ tài liệu vận hành (`FEATURE_EXPERIENCE_MATRIX.md`, `RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md`).

---

## 5. VERIFICATION METHOD (PHƯƠNG PHÁP KIỂM CHỨNG ĐỘC LẬP)

Bất kỳ kỹ sư hoặc agent nào cũng có thể kiểm chứng độc lập báo cáo này bằng cách chạy tuần tự các lệnh sau từ thư mục gốc của dự án:

```powershell
# 1. Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (Kỳ vọng: 0 errors)
npx tsc --noEmit

# 2. Kiểm tra quy chuẩn mã nguồn ESLint (Kỳ vọng: 0 errors, 0 warnings)
npm run lint

# 3. Kiểm tra tính đơn điệu của chuỗi biến động kho (Kỳ vọng: PASS 100%)
npm run test:chain

# 4. Kiểm tra 21 kịch bản nghiệp vụ thực tế (Kỳ vọng: 21 ĐẠT / 21 TỔNG CỘNG)
npm run test:scenarios

# 5. Kiểm tra khả năng biên dịch sản xuất bằng Turbopack (Kỳ vọng: Compiled successfully, exit code 0)
npm run build

# 6. Kiểm tra trạng thái hoạt động của 2 cổng dịch vụ
Get-NetTCPConnection -LocalPort 3010,3013 -State Listen
Invoke-RestMethod http://localhost:3013/health
Invoke-RestMethod http://localhost:3010/api/dashboard
```

**Điều kiện vô hiệu hóa báo cáo (Invalidation Conditions)**:
- Nếu một trong các lệnh trên trả về lỗi không bằng 0, hoặc có kịch bản kiểm thử bị thất bại.
- Nếu tệp `db/custom.db` bị sửa đổi trái phép dẫn đến mất số liệu baseline đơn hàng hoặc sản phẩm.
- Nếu xuất hiện sự mâu thuẫn giữa mô tả vị trí mã nguồn trong báo cáo và nội dung tệp thực tế.

---
*Tài liệu tham chiếu chi tiết kèm bảng đối soát từng API và màn hình giao diện: `.agents/teamwork/explorer_survey_1/survey_codebase.md`*
