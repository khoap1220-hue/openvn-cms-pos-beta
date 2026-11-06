## 2026-10-26T08:26:35Z
You are worker_m3, the Bulk Orders & Batch Logistics Worker for OPENVN · Ưu Đàm Suite.
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3
Your parent conversation ID is: 7124d145-f8bf-4670-a0d0-13114c2b24e3

MANDATORY FIRST STEPS:
Read these files:
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\TEST_READY.md
- scripts/verify-r2-bulk-orders.ts

FILE OWNERSHIP:
You exclusively own and may create/edit:
- src/app/api/orders/bulk-confirm/route.ts
- src/components/cms/views/orders-view.tsx
- src/components/cms/shipping-slip-batch-print.tsx (if created)

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

YOUR MISSION (Milestone M3 - Bulk Orders Processing & Batch Slips - R2):
1. Create src/app/api/orders/bulk-confirm/route.ts:
   - Handle POST request with body { orderIds: string[] }.
   - Validate orderIds: reject invalid/empty array with HTTP 400 { error: "Danh sách mã đơn hàng không hợp lệ" }.
   - Process each order:
     - Check existence. If not found: status "REJECTED", reason: "Đơn hàng không tồn tại".
     - Check status === 'PENDING'. If already CONFIRMED/CANCELLED/COMPLETED: status "REJECTED", reason: `Đơn hàng đang ở trạng thái ${order.status}, chỉ đơn PENDING mới được xác nhận`.
     - Check stock for all items: for simple product check stock >= quantity; for combo BOM check all bomComponents stock >= quantity * ratio. If insufficient: status "REJECTED", reason: `Không đủ tồn kho (Sản phẩm ${sku}: tồn ${currentStock}, yêu cầu ${requiredQuantity})`.
     - If valid: atomically within db.$transaction, update status to 'CONFIRMED', decrement stock, create StockMovement records, sync combo stock.
   - Return HTTP 200 with JSON: { success: true, processedCount, rejectedCount, results: [...] }.
2. Update src/components/cms/views/orders-view.tsx:
   - Add row checkboxes and header Select-All checkbox.
   - Add floating or top Bulk Action Bar when selectedOrders.length > 0:
     - "Đã chọn X đơn hàng"
     - "Xác nhận hàng loạt" button -> calls API, shows result dialog with confirmed list and detailed rejection reasons.
     - "In phiếu giao hàng (A6)" button -> opens Batch Shipping Slip Print preview modal.
   - Implement A6 Batch Shipping Slip format:
     - Print CSS page-break-after: always (105mm x 148mm A6 format).
     - Sender info, recipient info, barcode/orderCode, order items, COD amount, shipping carrier, fragile warning.
3. Verification:
   - Run `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts` -> MUST PASS 100%.
   - Run `npx tsc --noEmit` -> 0 errors.
   - Run `npm run lint` -> 0 errors, 0 warnings.
   - Run `npm run test:chain` -> Monotonic stock ledger MUST PASS 100%.
   - Run `npm run test:scenarios` -> 21/21 scenarios MUST PASS.
   - Run `npm run build` -> build succeeds with 0 errors.
4. Write handoff.md in your working directory and notify parent (7124d145-f8bf-4670-a0d0-13114c2b24e3).
