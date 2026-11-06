# HANDOFF REPORT — REMEDIATION OF MILESTONE M3: BULK ORDERS

**Worker**: `worker_m3_r2` (Bulk Orders Remediation Worker)  
**Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Timestamp**: 2026-10-26T09:04:00Z  
**Status**: **COMPLETED** (Hard Handoff)  

---

## 1. OBSERVATION

1. **Các file đã được cập nhật**:
   - `src/app/api/orders/bulk-confirm/route.ts`:
     - Bổ sung logic kiểm tra biến động kho đã tồn tại (`alreadyDeducted`) trước khi kiểm tra tồn kho và xuất kho.
     - Trích đoạn code đã thêm:
       ```typescript
       // Kiểm tra xem đơn hàng đã được trừ kho lúc tạo đơn hay chưa (qua createOrder)
       const existingMovement = await tx.stockMovement.findFirst({
         where: {
           note: { contains: order.code },
           type: { in: ['EXPORT', 'COMBO_ISSUE'] },
         },
       })
       const alreadyDeducted = Boolean(existingMovement)

       if (alreadyDeducted) {
         // Tồn kho đã được trừ/giữ sẵn tại thời điểm tạo đơn (createOrder)
         // Không trừ kho lại, không kiểm tra tồn kho, không tạo StockMovement trùng lặp
         const updatedOrder = await tx.order.update({
           where: { id: order.id },
           data: { status: 'CONFIRMED' },
         })

         return {
           result: {
             orderId: order.id,
             orderCode: order.code,
             status: 'CONFIRMED' as const,
           },
           confirmedOrder: updatedOrder,
         }
       }
       ```
   - `scripts/verify-r2-bulk-orders.ts`:
     - Bổ sung `SECTION 4.5: REMEDIATION VERIFICATION — PRE-DEDUCTED ORDERS (NO DOUBLE DEDUCTION)` với 7 assertions mới:
       1. `F06-Tier1-CreateOrderPreDeductionSetup`: Tạo đơn hàng chuẩn thành công qua `POST /api/orders` (gọi `createOrder`).
       2. `F06-Tier1-CreateOrderDeductedAtCreation`: Kiểm tra tồn kho đã bị trừ từ 10 xuống 8 lúc tạo đơn và có 2 `StockMovement`.
       3. `F06-Tier1-BulkConfirmPreDeductedSuccess`: Xác nhận hàng loạt thành công đơn đã trừ kho (`processedCount: 1`).
       4. `F06-Tier1-NoDoubleStockDeduction`: Tồn kho sau bulk-confirm vẫn là 8 (không bị trừ lần 2 thành 6).
       5. `F06-Tier1-NoDuplicateStockMovement`: Tổng số bản ghi `StockMovement` vẫn là 2 (không ghi nhận trùng lặp).
       6. `F06-Tier1-StockReducedToZeroAtCreation`: Tồn kho giảm về 0 sau khi đặt đơn với sản phẩm tồn hữu hạn (2 cái).
       7. `F06-Tier1-PreDeductedOrderNotFalselyRejectedWhenZeroStock`: Đơn hàng có tồn hiện tại = 0 vẫn được xác nhận thành công sang `CONFIRMED` (không bị từ chối oan vì kho đã được giữ trước).
     - Gia cố hàm `cleanupR2TestData`: Dọn sạch các bản ghi liên đới (`salesInvoice`, `shipment`, `orderEvent`, `afterSalesCase`, `orderItem`, `agentActivity`, `ledgerEntry`, `bomComponent`, `stockMovement`, `channelListing`, `warehouseStock`, `product`, `order`).

2. **Kết quả kiểm thử thực tế**:
   - `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts`:
     - **20 PASS, 0 FAIL (100%)**.
   - `npx tsc --noEmit`:
     - **0 errors** (exit code 0).
   - `npm run lint`:
     - **0 errors, 0 warnings** (exit code 0).
   - `npm run test:chain`:
     - **100% PASS** cho toàn bộ chuỗi biến động kho (`UD-QT-002` 14 records, `UD-VL-001` 24 records).
   - `npm run test:scenarios`:
     - **21/21 KỊCH BẢN ĐẠT (0 failures)**.
   - `npm run build`:
     - **Compiled successfully in 3.1s** (Next.js 16 Turbopack).

---

## 2. LOGIC CHAIN

1. *Quan sát 1*: `reviewer_m3` phát hiện lỗ hổng "Double Stock Deduction": các đơn hàng phát sinh từ luồng vận hành chuẩn (`createOrder`) đã bị trừ kho tại thời điểm tạo đơn (`PENDING`). Khi nhân viên chọn các đơn này trên giao diện Quản lý đơn hàng và bấm "Xác nhận hàng loạt", `POST /api/orders/bulk-confirm` trước đây đã trừ kho thêm một lần nữa.
2. *Quan sát 2*: Kiểm tra cơ chế ghi sổ kho trong `createOrder` (`src/lib/order-service.ts`), mọi lần trừ kho đều lưu bản ghi `StockMovement` với `type: 'EXPORT'` (sản phẩm đơn) hoặc `'COMBO_ISSUE'` (thành phần combo) và trường `note` luôn chứa mã đơn hàng `order.code` (`Xuất kho cho đơn ${code}` hoặc `Trừ thành phần combo ... cho đơn ${code}`).
3. *Suy luận giải pháp*:
   - Trong `src/app/api/orders/bulk-confirm/route.ts`, trước khi kiểm tra tồn kho và thực hiện xuất kho, ta thực hiện truy vấn:
     `const existingMovement = await tx.stockMovement.findFirst({ where: { note: { contains: order.code }, type: { in: ['EXPORT', 'COMBO_ISSUE'] } } })`.
   - Nếu `alreadyDeducted` là `true`:
     - Hàng đã được trừ/giữ sẵn cho đơn này lúc tạo.
     - Không kiểm tra điều kiện `freshProd.stock < totalRequired` (tránh từ chối oan khi tồn hiện tại hiển thị 0 do chính đơn này đã giữ chỗ).
     - Không thực hiện decrement trường `stock` của sản phẩm hoặc linh kiện combo.
     - Không tạo thêm bản ghi `StockMovement` trùng lặp.
     - Cập nhật trực tiếp `order.status = 'CONFIRMED'`.
   - Nếu `alreadyDeducted` là `false` (các đơn hàng nhập từ file CSV/Excel hoặc kịch bản mock chưa trừ kho):
     - Giữ nguyên toàn bộ logic kiểm tra tồn kho gộp, trừ kho, ghi nhận `StockMovement`, và đồng bộ tồn combo BOM.
4. *Chứng minh bằng kiểm thử*:
   - Script `verify-r2-bulk-orders.ts` được bổ sung kịch bản tạo đơn qua `createOrder` (tồn giảm 10 -> 8). Khi gọi `bulk-confirm`, xác nhận tồn kho vẫn giữ nguyên 8 và số bản ghi `StockMovement` không tăng. Kịch bản tồn giảm về 0 lúc tạo đơn cũng xác nhận đơn thành công không bị báo lỗi thiếu hàng.

---

## 3. CAVEATS

- Không có caveat. Bản sửa lỗi tương thích hoàn toàn 100% với cả hai loại đơn: đơn hàng chuẩn tạo qua `createOrder` (đã trừ kho) và đơn hàng ngoại lai chưa trừ kho.
- Dữ liệu thử nghiệm tạo ra trong quá trình chạy `verify-r2-bulk-orders.ts` được dọn dẹp triệt để trong khối `finally`, không để lại rác trên CSDL.

---

## 4. CONCLUSION

- Lỗ hổng Trừ kho 2 lần (Double Stock Deduction) trong API Xác nhận hàng loạt đã được khắc phục triệt để và an toàn.
- Bộ kiểm thử `verify-r2-bulk-orders.ts` đã được mở rộng từ 13 lên 20 bài kiểm tra độc lập và pass 100%.
- Toàn bộ 5 cổng chất lượng của dự án (`tsc`, `lint`, `test:chain`, `test:scenarios`, `build`) đều pass với 0 lỗi, 0 cảnh báo.
- Sẵn sàng bàn giao cho reviewer và orchestrator.

---

## 5. VERIFICATION METHOD

Để kiểm chứng độc lập kết quả:

1. **Chạy bộ kiểm thử Milestone M3 (Suite R2)**:
   ```powershell
   node --experimental-strip-types scripts/verify-r2-bulk-orders.ts
   ```
   *Kết quả mong đợi*: 20 PASS, 0 FAIL (bao gồm các assert `F06-Tier1-NoDoubleStockDeduction` và `F06-Tier1-PreDeductedOrderNotFalselyRejectedWhenZeroStock`).

2. **Chạy kiểm tra kiểu TypeScript**:
   ```powershell
   npx tsc --noEmit
   ```
   *Kết quả mong đợi*: 0 errors.

3. **Chạy kiểm tra chuẩn mã nguồn (ESLint)**:
   ```powershell
   npm run lint
   ```
   *Kết quả mong đợi*: 0 errors, 0 warnings.

4. **Chạy kiểm tra chuỗi biến động kho (StockMovement Ledger Chain)**:
   ```powershell
   npm run test:chain
   ```
   *Kết quả mong đợi*: 100% khớp, không đứt gãy số dư lũy kế.

5. **Chạy bộ kiểm thử 21 kịch bản đối kháng**:
   ```powershell
   npm run test:scenarios
   ```
   *Kết quả mong đợi*: 21/21 KỊCH BẢN ĐẠT (0 failures).

6. **Chạy build production Next.js**:
   ```powershell
   npm run build
   ```
   *Kết quả mong đợi*: Biên dịch thành công (0 errors).
