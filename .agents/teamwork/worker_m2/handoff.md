# BÁO CÁO BÀN GIAO MILESTONE M2 (R1) — SYSTEM HARDENING & DEFECT RECTIFICATION

**Dự án**: OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)  
**Tác nhân thực hiện**: `worker_m2` (System Hardening & Defect Fixer)  
**Parent Agent ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Thời gian hoàn thành**: 2026-10-26T08:11:30Z  

---

## 1. OBSERVATION (QUAN SÁT THỰC TẾ & BÁO CÁO LỖI CHI TIẾT)

### 1.1. Bảng đối soát lỗi phát hiện & xử lý (Defect Report)

| STT | Tệp tin & Dòng gốc | Cơ chế lỗi (Error Mechanism) | Cách thức sửa đổi (Fix Implemented) | Tên kiểm thử hồi quy (Regression Test) |
|:---:|:-------------------|:-----------------------------|:------------------------------------|:---------------------------------------|
| **1** | `src/app/api/orders/[id]/route.ts`: dòng 74–118 | **Thiếu tính nguyên tử khi Hủy đơn (Non-atomic order cancellation)**:<br>Khi chuyển `status === 'CANCELLED'`, thao tác cập nhật đơn hàng, hoàn trả tồn kho từng sản phẩm/thành phần Combo và tạo `StockMovement` chạy ngoài transaction. Nếu một bước thất bại giữa chừng, trạng thái kho bị phân rã.<br>Đồng thời thiếu chốt chặn hủy đơn đã `COMPLETED`. | Bọc toàn bộ quy trình cập nhật đơn hàng sang `CANCELLED`, hoàn tồn kho (sản phẩm đơn và thành phần định mức Combo), tạo `StockMovement` và đồng bộ tồn kho hiển thị của Combo (`syncComboStock`, `syncCombosUsingComponents`) vào trong `db.$transaction(async (tx) => ...)`.<br>Bổ sung kiểm tra chặn hủy đơn đã `COMPLETED` hoặc đã `CANCELLED` (trả về HTTP 400). | `F02-Tier1-SimpleOrderCancel`<br>`F02-Tier1-ComboOrderCancelSync`<br>`F02-Tier2-DoubleCancelRejection`<br>`F02-Tier2-ReopenCancelledOrderBlocked`<br>`F02-Tier2-CancelCompletedOrderBlocked` |
| **2** | `src/app/api/shipments/[id]/route.ts`: dòng 80–153 | **Thiếu tính nguyên tử khi Vận đơn hoàn hàng (Non-atomic RETURNED shipment)**:<br>Khi vận đơn chuyển sang `RETURNED`, cập nhật vận đơn được thực hiện trước, sau đó đơn hàng được hủy và kho được hoàn trả bằng các truy vấn độc lập ngoài transaction. | Bọc toàn bộ cập nhật vận đơn sang `RETURNED`, hủy đơn hàng cha, truy vấn chi tiết đơn hàng, hoàn trả tồn kho sản phẩm đơn / thành phần Combo, tạo bản ghi `StockMovement` và đồng bộ Combo vào trong một khối `db.$transaction(async (tx) => ...)`. Duy trì tính idempotent khi gọi lại `RETURNED` trên vận đơn đã hoàn. | `F03-Tier1-ShipmentReturnedAtomicRestock`<br>`F03-Tier2-ShipmentReturnedIdempotency` |
| **3** | `src/app/api/customers/route.ts`: dòng 91–102 | **Thiếu kiểm tra trùng lặp số điện thoại khách hàng (Duplicate Phone Vulnerability)**:<br>Phương thức `POST` nhận SĐT và tạo trực tiếp khách hàng mới mà không kiểm tra số điện thoại đã tồn tại trong CSDL hay chưa, dẫn đến tình trạng phân mảnh hồ sơ khách hàng. | Kiểm tra `trimmedPhone = phone?.trim() || null`. Nếu SĐT không rỗng, thực hiện `db.customer.findFirst({ where: { phone: trimmedPhone } })`. Nếu đã tồn tại, từ chối với HTTP 400 và JSON `{ error: "Số điện thoại này đã được đăng ký cho khách hàng khác" }`. Nếu SĐT rỗng (khách vãng lai), cho phép tạo thành công. | `F04-Tier1-CustomerCreationSuccess`<br>`F04-Tier2-CustomerDuplicatePhonePrevented`<br>`F04-Tier2-CustomerNoPhoneAllowed` |
| **4** | `src/app/api/system/backup/route.ts`: dòng 15, 26, 30 | **Cảnh báo truy cập hệ thống tệp động trong Turbopack (Turbopack Dynamic Filesystem Tracing Warning)**:<br>Các hàm `fs.existsSync` và `fs.readFileSync` đọc đường dẫn động khiến Turbopack quét toàn bộ thư mục dự án vào danh sách asset, xuất hiện 3 cảnh báo khi build. | Áp dụng chú thích `/*turbopackIgnore: true*/` cho tất cả các lệnh gọi `fs.existsSync` và `fs.readFileSync`, đồng thời chuẩn hóa đường dẫn tĩnh thông qua `path.join(process.cwd(), 'db', 'custom.db')`. | `F05-Tier1-DatabaseBackupIntegrity`<br>`npm run build` (0 warnings) |

### 1.2. Nhật ký thực thi các lệnh kiểm định thực tế

1. **Kiểm tra bộ test hồi quy R1**:
   - Lệnh: `node --experimental-strip-types scripts/verify-r1-regressions.ts`
   - Kết quả:
     ```text
     ================================================================================
     SUITE R1: REGRESSION GUARDS & TRANSACTION ATOMICITY (TIERS 1-3)
     ================================================================================
     --- Test 1.1: Cancel đơn hàng hoàn tồn kho sản phẩm đơn lẻ (Happy path) ---
       ✅ [PASS] F02-Tier1-SimpleOrderCancel: Hủy đơn thành công: status=CANCELLED, tồn kho hoàn lại đúng 20
     --- Test 1.2: Cancel đơn hàng combo hoàn tồn từng thành phần và đồng bộ combo (Happy path) ---
       ✅ [PASS] F02-Tier1-ComboOrderCancelSync: Hủy đơn Combo: Thành phần A=15, Thành phần B=30, Combo tồn tự động sync về 15
     --- Test 1.3: Chặn hủy lại đơn đã hủy & Chặn mở lại đơn đã hủy (Boundary & Adversarial) ---
       ✅ [PASS] F02-Tier2-DoubleCancelRejection: Chặn hủy lại đơn đã hủy (HTTP 400), tồn kho không bị cộng lặp (vẫn là 20)
       ✅ [PASS] F02-Tier2-ReopenCancelledOrderBlocked: Chặn mở lại đơn đã hủy sang PENDING/CONFIRMED (HTTP 400)
       ✅ [PASS] F02-Tier2-CancelCompletedOrderBlocked: Chặn hủy đơn hàng đã hoàn tất (HTTP 400)
     --- Test 2.1: Vận đơn hoàn hàng RETURNED tự động hủy đơn & hoàn kho (Happy path) ---
       ✅ [PASS] F03-Tier1-ShipmentReturnedAtomicRestock: Vận đơn RETURNED: đơn hàng tự động CANCELLED, tồn kho hoàn lại đúng 10
     --- Test 2.2: Idempotency khi gọi lại RETURNED trên vận đơn đã hoàn (Boundary) ---
       ✅ [PASS] F03-Tier2-ShipmentReturnedIdempotency: Gọi lại RETURNED trên vận đơn đã hoàn không làm sai lệch tồn kho
     --- Test 3.1: Chặn tạo trùng lặp số điện thoại khách hàng (F04 Guard) ---
       ✅ [PASS] F04-Tier1-CustomerCreationSuccess: Tạo khách hàng thứ nhất thành công với SĐT 0979998029
       ✅ [PASS] F04-Tier2-CustomerDuplicatePhonePrevented: Chặn tạo khách hàng trùng SĐT (HTTP 400, số bản ghi trong DB = 1)
       ✅ [PASS] F04-Tier2-CustomerNoPhoneAllowed: Cho phép tạo khách hàng vãng lai không có SĐT (HTTP 201)
     --- Test 4.1: API Sao lưu DB trả về file SQLite hợp lệ (F05) ---
       ✅ [PASS] F05-Tier1-DatabaseBackupIntegrity: Tải bản sao lưu CSDL thành công: HTTP 200, header='SQLite format 3 '
     ================================================================================
     KẾT QUẢ SUITE R1: 11 PASS, 0 FAIL
     ================================================================================
     ```
   - Mã thoát: `0`.

2. **Kiểm tra biên dịch sản xuất Turbopack (`npm run build`)**:
   - Lệnh: `npm run build`
   - Kết quả:
     ```text
     ▲ Next.js 16.4.3 (Turbopack)
     ✓ Compiled successfully in 3.1s
       Running TypeScript ...
       Finished TypeScript in 9.1s ...
       Collecting page data using 55 workers ...
     ✓ Generating static pages using 55 workers (6/6) in 748ms
       Finalizing page optimization ...
     ```
   - Hoàn toàn **KHÔNG còn 3 cảnh báo Dynamic filesystem access** từ `src/app/api/system/backup/route.ts`.
   - Mã thoát: `0`.

3. **Kiểm tra TypeScript Typecheck (`npx tsc --noEmit`)**:
   - Lệnh: `npx tsc --noEmit`
   - Kết quả: `0 errors`, mã thoát `0`.

4. **Kiểm tra Linter (`npm run lint`)**:
   - Lệnh: `npm run lint` (`eslint src`)
   - Kết quả: `0 errors, 0 warnings`, mã thoát `0`.

5. **Kiểm định tính đơn điệu sổ kho (`npm run test:chain`)**:
   - Lệnh: `npm run test:chain`
   - Kết quả: Chuỗi biến động kho của `UD-QT-002` và `UD-VL-001` khớp 100% với tồn kho thực tế hiện hành (`bal === stockAfter` và `bal === stock`), mã thoát `0`.

6. **Kiểm định 21 kịch bản nghiệp vụ thực tế (`npm run test:scenarios`)**:
   - Lệnh: `npm run test:scenarios`
   - Kết quả: `21 ĐẠT / 21 TỔNG CỘNG (FAILED: 0)`, mã thoát `0`.

---

## 2. LOGIC CHAIN (CHUỖI LẬP LUẬN TỪ QUAN SÁT ĐẾN KẾT LUẬN)

1. **Về tính nguyên tử của giao dịch (Transactions F02 & F03)**:
   - *Quan sát*: Trước khi sửa, nếu quá trình hoàn kho bị gián đoạn giữa chừng, trạng thái đơn hàng và kho thành phần bị lệch (đơn đã CANCELLED nhưng kho chưa hoàn đủ).
   - *Lập luận*: Việc bọc toàn bộ chuỗi tác vụ ghi (`tx.order.update`, `tx.product.update`, `tx.stockMovement.create`, `syncComboStock(tx)`, `syncCombosUsingComponents(tx)`) trong `db.$transaction(async (tx) => ...)` đảm bảo hoặc tất cả các thay đổi đều được ghi nhận (commit), hoặc toàn bộ bị phục hồi (rollback) khi có lỗi.
   - *Kết luận*: Tính toàn vẹn dữ liệu đơn hàng và tồn kho được bảo vệ tuyệt đối trước sự cố ngắt quãng hoặc xung đột ghi đồng thời trên SQLite.

2. **Về chống trùng lặp khách hàng (F04)**:
   - *Quan sát*: `scripts/verify-r1-regressions.ts` trước đây báo lỗi `[FAIL] F04-Tier2-CustomerDuplicatePhonePrevented` do tạo trùng SĐT trả về HTTP 201 với 2 bản ghi trong DB.
   - *Lập luận*: Thêm kiểm tra `db.customer.findFirst({ where: { phone: trimmedPhone } })` trước khi tạo giúp ngăn chặn triệt để bản ghi trùng, đồng thời trả về thông điệp lỗi rõ ràng bằng tiếng Việt cho người dùng; khách hàng vãng lai không có SĐT vẫn được tạo bình thường.
   - *Kết luận*: Cổng `verify-r1-regressions` đã chuyển sang PASS 11/11.

3. **Về cảnh báo Turbopack (F05)**:
   - *Quan sát*: `next build` ban đầu xuất hiện 3 cảnh báo `Dynamic filesystem access causes tracing of the whole project into the asset list`.
   - *Lập luận*: Thêm chú thích `/*turbopackIgnore: true*/` và cấu trúc đường dẫn tĩnh bằng `path.join` giải phóng Turbopack khỏi việc quét đệ quy toàn bộ thư mục dự án khi biên dịch route tải bản sao lưu CSDL.
   - *Kết luận*: Quá trình `next build` hoàn toàn sạch sẽ, không còn cảnh báo về filesystem tracing, tệp sao lưu `.db` vẫn được tải về nguyên vẹn với header `SQLite format 3`.

4. **Về độ an toàn và hồi quy hệ thống**:
   - *Quan sát*: Cả `npm run test:chain` và `npm run test:scenarios` tiếp tục đạt 100% (21/21 scenarios PASS).
   - *Lập luận*: Các sửa đổi tuân thủ nghiêm ngặt nguyên tắc thay đổi tối thiểu (minimal-change principle), chỉ can thiệp vào các tệp thuộc quyền sở hữu được giao, không làm thay đổi các quy tắc kế toán, khấu trừ Combo BOM hay tính điểm thành viên đã có.
   - *Kết luận*: Milestone M2 đã hoàn thành trọn vẹn và sẵn sàng bàn giao cho các giai đoạn tiếp theo (M3 Bulk Orders, M4 VAT XML E-Invoice).

---

## 3. CAVEATS (CÁC ĐIỂM CHƯA KHẢO SÁT & GIẢ ĐỊNH)

- **Cấu hình bảng SQLite**: Cột `phone` trong bảng `Customer` chưa gắn chỉ mục `@unique` trực tiếp ở mức schema Prisma để duy trì tính tương thích với các bản ghi khách hàng lịch sử có thể có SĐT rỗng (`null`). Việc kiểm soát trùng lặp được thực thi nghiêm ngặt tại tầng logic API (`src/app/api/customers/route.ts`).
- **Phạm vi sở hữu**: Tác nhân `worker_m2` tuân thủ nguyên tắc không chỉnh sửa bất kỳ tệp nào ngoài 4 tệp được phân công (`orders/[id]/route.ts`, `shipments/[id]/route.ts`, `customers/route.ts`, `system/backup/route.ts`) và tệp kiểm thử `scripts/verify-r1-regressions.ts`. Không có tác động ngoài ý muốn tới các tính năng của M3–M6.

---

## 4. CONCLUSION (KẾT LUẬN)

1. Toàn bộ 4 nhiệm vụ trọng tâm của Milestone M2 (R1) đã được giải quyết hoàn toàn và triệt để:
   - Bọc `db.$transaction` cho Hủy đơn hàng và chặn trạng thái hủy không hợp lệ.
   - Bọc `db.$transaction` cho Vận đơn RETURNED và bảo toàn tính idempotent.
   - Thiết lập chốt chặn chống tạo trùng khách hàng theo số điện thoại (HTTP 400).
   - Khử sạch cảnh báo Turbopack filesystem tracing trong route sao lưu CSDL.
2. Tất cả các cổng kiểm định chất lượng (`verify-r1-regressions`, `npx tsc --noEmit`, `npm run lint`, `npm run test:chain`, `npm run test:scenarios`, `npm run build`) đều đạt **PASS 100%** với **0 lỗi và 0 cảnh báo**.
3. Hệ thống sẵn sàng 100% để chuyển sang Milestone M3 (Đơn hàng hàng loạt & Phiếu in vận đơn A6).

---

## 5. VERIFICATION METHOD (PHƯƠNG PHÁP KIỂM CHỨNG ĐỘC LẬP)

Để kiểm chứng độc lập kết quả bàn giao của `worker_m2`, người nhận thực thi lần lượt các lệnh sau từ thư mục gốc của dự án:

```powershell
# 1. Chạy bộ kiểm thử hồi quy Milestone M2 (Kỳ vọng: 11 PASS, 0 FAIL)
node --experimental-strip-types scripts/verify-r1-regressions.ts

# 2. Kiểm tra tính toàn vẹn kiểu dữ liệu TypeScript (Kỳ vọng: 0 errors)
npx tsc --noEmit

# 3. Kiểm tra quy chuẩn linter ESLint (Kỳ vọng: 0 errors, 0 warnings)
npm run lint

# 4. Kiểm tra tính đơn điệu sổ kho (Kỳ vọng: chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓)
npm run test:chain

# 5. Kiểm tra 21 kịch bản nghiệp vụ thực tế (Kỳ vọng: 21 ĐẠT / 21 TỔNG CỘNG)
npm run test:scenarios

# 6. Kiểm tra biên dịch sản xuất Turbopack (Kỳ vọng: 0 Turbopack dynamic filesystem warnings)
npm run build
```

**Điều kiện vô hiệu hóa bàn giao (Invalidation Conditions)**:
- Nếu bất kỳ lệnh nào trong 6 lệnh trên trả về mã thoát khác 0 hoặc có kịch bản FAIL.
- Nếu xuất hiện lỗi duplicate phone lọt qua API `POST /api/customers`.
- Nếu quá trình hủy đơn hoặc hoàn vận đơn để lại tình trạng dở dang trong CSDL khi xảy ra lỗi.
