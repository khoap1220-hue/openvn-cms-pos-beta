# HANDOFF REPORT — FORENSIC INTEGRITY AUDIT: MILESTONE M3

**Work Product**: Milestone M3 (Bulk Orders Processing & Batch Slips - R2)  
**Profile**: General Project (Development Mode per `ORIGINAL_REQUEST.md`)  
**Auditor**: `auditor_m3`  
**Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Timestamp**: 2026-10-26T08:48:00Z  
**Verdict**: **CLEAN**

---

## Forensic Audit Report

**Work Product**: Milestone M3 (F06 Bulk Confirm API, F07 Bulk Order Selection UI, F08 Batch Shipping Slips A6)  
**Profile**: General Project (Mode: Development)  
**Verdict**: **CLEAN**

### Phase Results
- [Phase 1: Hardcoded Output Detection]: **PASS** — Không phát hiện chuỗi kết quả kiểm thử cố định hoặc phản hồi giả lập trong `src/app/api/orders/bulk-confirm/route.ts` hay `src/app/api/orders/batch-slips/route.ts`.
- [Phase 1: Facade Detection]: **PASS** — Tất cả logic nghiệp vụ (kiểm tra trạng thái PENDING, bóc tách định mức BOM combo, trừ tồn kho nguyên tử, ghi chuỗi `StockMovement`, đồng bộ kho và lineage) đều được cài đặt thực tế qua Prisma transaction.
- [Phase 1: Pre-populated Artifact Detection]: **PASS** — Không có file log, kết quả dựng sẵn hay attestation tồn tại trước.
- [Phase 2: Source Build]: **PASS** — Next.js 16.4.3 (Turbopack) build thành công (`Compiled successfully in 4.9s`, 0 error).
- [Phase 2: TypeScript & Linter Verification]: **PASS** — `npx tsc --noEmit` hoàn tất 0 lỗi; `npm run lint` hoàn tất 0 lỗi, 0 cảnh báo.
- [Phase 2: Dedicated R2 Test Suite Execution]: **PASS** — `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts` đạt 13/13 PASS (100%), gửi HTTP request thực tế đến cổng 3010.
- [Phase 2: Stock Ledger Monotonic Chain]: **PASS** — `npm run test:chain` xác nhận chuỗi biến động kho của `UD-QT-002` và `UD-VL-001` khớp 100% với tồn thực tế.
- [Phase 2: Regression & Adversarial Scenarios]: **PASS** — `npm run test:scenarios` đạt 21/21 kịch bản (0 failures).
- [Phase 2: Database Residue & Baseline Audit]: **PASS** — Đối chiếu 18 bảng cốt lõi với `db/baseline-counts.json` ghi nhận 0 sai lệch (0 residue).
- [Phase 2: Independent Adversarial Probing]: **PASS** — Kiểm thử độc lập payload rỗng trả về HTTP 400; UUID không tồn tại và chuỗi rỗng trả về HTTP 200 với lý do từ chối rõ ràng từng đơn.

---

## 1. OBSERVATION

1. **Mã nguồn API Xác nhận hàng loạt (`src/app/api/orders/bulk-confirm/route.ts`)**:
   - Dòng 28–30: Kiểm tra payload đầu vào: `if (!body || !Array.isArray(body.orderIds) || body.orderIds.length === 0) return NextResponse.json({ error: 'Danh sách mã đơn hàng không hợp lệ' }, { status: 400 })`.
   - Dòng 50–286: Bọc xử lý từng đơn hàng trong giao dịch độc lập `db.$transaction(async (tx) => ...)`.
   - Dòng 75–84: Kiểm tra trạng thái đơn: `if (order.status !== 'PENDING') return { result: { orderId: order.id, orderCode: order.code, status: 'REJECTED', reason: \`Đơn hàng đang ở trạng thái \${order.status}, chỉ đơn PENDING mới được xác nhận\` }, confirmedOrder: null }`.
   - Dòng 106–136: Bóc tách BOM cho sản phẩm loại `COMBO`: truy vấn `bomComponent`, tính toán nhu cầu thành phần `Math.round(bom.quantity * item.quantity)`, gộp nhu cầu `comboDemands`.
   - Dòng 167–177 & 196–205: Kiểm tra tồn kho thực tế cho sản phẩm đơn lẻ và thành phần Combo; nếu thiếu trả về `status: 'REJECTED'`, `reason: \`Không đủ tồn kho (Sản phẩm ...: tồn X, yêu cầu Y)\``.
   - Dòng 214–259: Trừ tồn kho nguyên tử, tạo bản ghi `StockMovement` với `type: 'EXPORT'` cho hàng lẻ và `type: 'COMBO_ISSUE'` cho thành phần combo, tính toán chính xác `stockAfter`.
   - Dòng 262–270: Gọi `syncComboStock(tx, comboId)` và `syncCombosUsingComponents(tx, touchedIds)` bảo toàn số lượng combo có thể đóng.
   - Dòng 294–325: Ghi timeline `logEvent`, activity `logActivity`, broadcast `order.updated` Socket.IO, ghi nhật ký `recordLineageChange` và kích hoạt webhook `order.confirmed`.

2. **Mã nguồn API Dữ liệu phiếu in hàng loạt (`src/app/api/orders/batch-slips/route.ts`)**:
   - Dòng 22–45: Truy vấn quan hệ đầy đủ (`customer`, `channel`, `items.product`, `shipments`).
   - Dòng 54: Tính toán chính xác cờ hàng dễ vỡ: `const hasFragile = order.items.some((it) => it.product?.fragile === true)`.
   - Dòng 58: Tiền thu hộ COD được trích xuất an toàn: `const codAmount = order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID' ? order.total : 0`.

3. **Giao diện người dùng (`src/components/cms/views/orders-view.tsx` & `shipping-slip-batch-print.tsx`)**:
   - `orders-view.tsx` (dòng 257–328, 1033–1076, 2140–2225): Checkbox tiêu đề "Chọn tất cả" và Checkbox từng dòng; Thanh tác vụ hàng loạt hiển thị số lượng đơn đã chọn; Nút "Xác nhận hàng loạt" gọi API và mở Dialog kết quả chi tiết từng đơn; Nút "In phiếu giao hàng (A6)" mở modal xem trước và in ấn.
   - `shipping-slip-batch-print.tsx`: Định nghĩa CSS `@media print` với `@page { size: 105mm 148mm; margin: 0; }` và `.a6-slip-page { width: 105mm !important; min-height: 148mm !important; max-height: 148mm !important; page-break-after: always !important; break-after: page !important; }`. Hiển thị banner `⚠️ HÀNG DỄ VỠ` nổi bật khi `hasFragile === true`. Render portal ra `document.body` khi in ấn.

4. **Kết quả chạy kiểm thử thực tế độc lập (Empirical Execution Results)**:
   - `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts`:
     ```
     KẾT QUẢ SUITE R2: 13 PASS, 0 FAIL
       ✅ [PASS] F06-Tier2-EmptyPayloadHandling
       ✅ [PASS] F06-Tier2-InvalidTypeHandling
       ✅ [PASS] F06-Tier1-BulkConfirmResponseStatus
       ✅ [PASS] F06-Tier1-AccurateCounts
       ✅ [PASS] F06-Tier1-ValidOrdersConfirmed
       ✅ [PASS] F06-Tier1-CancelledOrderRejectedWithReason
       ✅ [PASS] F06-Tier1-AlreadyConfirmedRejectedWithReason
       ✅ [PASS] F06-Tier1-OutOfStockRejectedWithReason
       ✅ [PASS] F06-Tier1-NonExistentOrderRejectedWithReason
       ✅ [PASS] F06-Tier1-DatabaseStateMatches
       ✅ [PASS] F08-Tier1-BatchShippingSlipsCount
       ✅ [PASS] F08-Tier1-FragileWarningInSlip
       ✅ [PASS] F06-Tier3-StockLedgerChainIntegrity
     ```
   - `npm run test:scenarios`:
     ```
     === TỔNG KẾT: 21/21 KỊCH BẢN ĐẠT (FAILED: 0) ===
     ```
   - `npm run test:chain`:
     ```
     === UD-QT-002 (tồn hiện tại 4) — 14 biến động ===
     => chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓
     === UD-VL-001 (tồn hiện tại 149) — 24 biến động ===
     => chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓
     ```
   - `npx tsc --noEmit`: 0 errors.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm run build`: Compiled successfully in 4.9s.
   - Kiểm tra CSDL so với `db/baseline-counts.json`:
     ```
     Product: 12 (base: 12) OK
     Category: 3 (base: 3) OK
     Order: 173 (base: 173) OK
     OrderItem: 226 (base: 226) OK
     Customer: 34 (base: 34) OK
     SalesInvoice: 10 (base: 10) OK
     PurchaseInvoice: 4 (base: 4) OK
     StockMovement: 246 (base: 246) OK
     Warehouse: 4 (base: 4) OK
     WarehouseStock: 22 (base: 22) OK
     Voucher: 4 (base: 4) OK
     BomComponent: 5 (base: 5) OK
     AccountingPeriod: 5 (base: 5) OK
     Partner: 1 (base: 1) OK
     Channel: 10 (base: 10) OK
     ChannelListing: 110 (base: 110) OK
     Shipment: 85 (base: 85) OK
     AfterSalesCase: 2 (base: 2) OK
     Total core table mismatches: 0
     ```

---

## 2. LOGIC CHAIN

1. *Quan sát*: Yêu cầu R2 trong `ORIGINAL_REQUEST.md` quy định: "Chọn nhiều đơn cùng lúc để xác nhận hàng loạt và in phiếu giao hàng hàng loạt. Khi một số đơn không hợp lệ, hệ thống xử lý các đơn hợp lệ và báo rõ lý do từng đơn bị từ chối (không được bỏ qua im lặng)."
2. *Lập luận*: Trong `POST /api/orders/bulk-confirm`, mã nguồn áp dụng transaction độc lập cho từng đơn hàng (`db.$transaction`). Mỗi đơn được đối soát tồn kho (bao gồm định mức BOM cho combo) và kiểm tra trạng thái `PENDING`. Khi một đơn không đủ điều kiện, giao dịch của đơn đó không thực hiện trừ kho và trả về lý do chi tiết; các đơn hợp lệ khác vẫn hoàn tất bình thường và ghi nhận đầy đủ `StockMovement`.
3. *Quan sát*: Bộ test `scripts/verify-r2-bulk-orders.ts` gửi request trực tiếp qua HTTP `fetch('http://localhost:3010/api/orders/bulk-confirm', ...)` trên tập 6 đơn hỗn hợp (hợp lệ, đã hủy, đã duyệt, thiếu tồn, ID giả định).
4. *Lập luận*: Kết quả chạy thực tế cho thấy API phản hồi HTTP 200, xác nhận đúng 2 đơn hợp lệ, từ chối đúng 4 đơn không hợp lệ với thông báo nguyên nhân cụ thể (không bỏ qua im lặng), và cập nhật chính xác trạng thái trong SQLite.
5. *Quan sát*: Yêu cầu in ấn phiếu giao hàng A6 yêu cầu hỗ trợ ngắt trang tiêu chuẩn và cảnh báo hàng dễ vỡ.
6. *Lập luận*: Component `ShippingSlipBatchPrint` cùng endpoint `/api/orders/batch-slips` triển khai đúng kích thước `105mm x 148mm`, `page-break-after: always`, gắn banner `⚠️ HÀNG DỄ VỠ` và tích hợp mã vạch vận đơn, hoàn toàn đáp ứng nghiệp vụ đóng gói tại kho.
7. *Quan sát*: Sau khi hoàn tất toàn bộ các bài kiểm thử thực tế và kiểm thử đối kháng độc lập, tất cả 18 bảng CSDL cốt lõi được so khớp với `db/baseline-counts.json` và đạt tỉ lệ khớp 100% (0 bản ghi rác).
8. *Lập luận*: Toàn bộ tiêu chí an toàn dữ liệu, chống gian lận và chất lượng mã nguồn đều được thỏa mãn.

---

## 3. CAVEATS

- No caveats. Toàn bộ các yêu cầu của Milestone M3 (R2) đã được kiểm chứng độc lập từ mã nguồn, giao diện, API, chuỗi biến động kho và không có bất kỳ tồn đọng hay sai lệch nào.

---

## 4. CONCLUSION

- **Milestone M3 (Bulk Orders Processing & Batch Slips - R2) ĐẠT TIÊU CHUẨN TOÀN DIỆN.**
- **BẢN ÁN CUỐI CÙNG: CLEAN (Không có vi phạm tính toàn vẹn).**
- Công việc của `worker_m3` được nghiệm thu 100%. Đề xuất Orchestrator kích hoạt Milestone M4 (VAT E-Invoice XML & Mock Signer).

---

## 5. VERIFICATION METHOD

Các lệnh đã được thực thi độc lập để xác minh:

```powershell
# 1. Chạy bộ kiểm thử chuyên biệt R2 (13 PASS, 0 FAIL)
node --experimental-strip-types scripts/verify-r2-bulk-orders.ts

# 2. Kiểm tra typecheck TypeScript (0 errors)
npx tsc --noEmit

# 3. Kiểm tra ESLint (0 errors, 0 warnings)
npm run lint

# 4. Kiểm tra chuỗi sổ kho (100% match)
npm run test:chain

# 5. Kiểm tra 21 kịch bản nghiệp vụ (21/21 PASS)
npm run test:scenarios

# 6. Kiểm tra build sản xuất Next.js Turbopack (Compiled successfully)
npm run build

# 7. Đối chiếu số lượng bản ghi CSDL với baseline (0 mismatches)
node -e "const { PrismaClient } = require('@prisma/client'); const fs = require('fs'); const db = new PrismaClient(); async function run() { const b = JSON.parse(fs.readFileSync('db/baseline-counts.json')); const tables = ['Product','Category','Order','OrderItem','Customer','SalesInvoice','PurchaseInvoice','StockMovement','Warehouse','WarehouseStock','Voucher','BomComponent','AccountingPeriod','Partner','Channel','ChannelListing','Shipment','AfterSalesCase']; let mismatches = 0; for (const t of tables) { const m = t[0].toLowerCase() + t.slice(1); const c = await db[m].count(); if (c !== b[t]) mismatches++; } await db.`$disconnect(); console.log('Mismatches: ' + mismatches); } run();"
```

**Điều kiện vô hiệu hóa kết luận**:
- Bất kỳ lệnh kiểm thử nào ở trên thất bại.
- Số lượng bản ghi trong các bảng CSDL cốt lõi bị lệch khỏi `db/baseline-counts.json`.
