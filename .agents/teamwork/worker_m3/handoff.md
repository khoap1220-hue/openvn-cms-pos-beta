# HANDOFF REPORT — MILESTONE M3 (BULK ORDERS & BATCH LOGISTICS — R2)

**Work Product**: Milestone M3 (Bulk Orders Processing & Batch Slips — R2)  
**Worker**: `worker_m3` (Bulk Orders & Batch Logistics Worker)  
**Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Timestamp**: 2026-10-26T08:40:00Z  
**Verdict**: **COMPLETE & VERIFIED 100%**  

---

## 1. OBSERVATION

1. **Mã nguồn API Xác nhận hàng loạt (`src/app/api/orders/bulk-confirm/route.ts`)**:
   - Dòng 18–26: Kiểm tra payload đầu vào `body.orderIds`: nếu rỗng hoặc không phải mảng, trả về HTTP 400 `{ error: "Danh sách mã đơn hàng không hợp lệ" }`.
   - Dòng 39–68: Bọc xử lý từng đơn hàng trong `db.$transaction(async (tx) => ...)`.
   - Dòng 57–67: Kiểm tra đơn hàng tồn tại; nếu không có trả về `status: "REJECTED"`, `reason: "Đơn hàng không tồn tại"`.
   - Dòng 70–80: Kiểm tra trạng thái `order.status === 'PENDING'`; nếu đơn ở trạng thái khác (CONFIRMED, CANCELLED, COMPLETED), từ chối với lý do rõ ràng `status: "REJECTED"`, `reason: \`Đơn hàng đang ở trạng thái \${order.status}, chỉ đơn PENDING mới được xác nhận\``.
   - Dòng 82–195: Kiểm tra tồn kho cho tất cả sản phẩm trong đơn:
     - Đối với sản phẩm đơn: kiểm tra `freshProd.stock >= totalRequired`. Nếu không đủ, trả về `status: "REJECTED"`, `reason: \`Không đủ tồn kho (Sản phẩm \${freshProd.sku}: tồn \${freshProd.stock}, yêu cầu \${totalRequired})\``.
     - Đối với sản phẩm Combo (BOM): duyệt qua toàn bộ `bomComponent`, tính toán số lượng thành phần cần xuất `Math.round(bom.quantity * item.quantity)`, kiểm tra tồn kho thành phần `freshComp.stock >= demand.quantity`. Nếu thiếu, trả về `status: "REJECTED"`, `reason: \`Không đủ tồn kho (Sản phẩm \${freshComp.sku}: tồn \${freshComp.stock}, yêu cầu \${demand.quantity})\``.
   - Dòng 198–275: Khi hợp lệ, trong cùng khối giao dịch nguyên tử:
     - Giảm tồn kho sản phẩm đơn và tạo bản ghi `StockMovement` với `type: 'EXPORT'`, `quantity: -demand.quantity`, `stockAfter`.
     - Giảm tồn kho thành phần Combo và tạo bản ghi `StockMovement` với `type: 'COMBO_ISSUE'`, `quantity: -demand.quantity`, `stockAfter`.
     - Gọi `syncComboStock(tx, comboId)` và `syncCombosUsingComponents(tx, touchedIds)` để đồng bộ số lượng bộ combo có thể đóng.
     - Cập nhật trạng thái đơn hàng sang `CONFIRMED`.
   - Dòng 280–320: Ngoài transaction, ghi nhận timeline (`logEvent`), broadcast Socket.IO (`broadcast`), ghi lineage (`recordLineageChange`), và gửi webhook outbound (`dispatchWebhook('order.confirmed')`).
   - Dòng 338–344: Trả về HTTP 200 JSON `{ success: true, processedCount, rejectedCount, results: [...] }`.

2. **Mã nguồn API Phiếu in giao hàng hàng loạt (`src/app/api/orders/batch-slips/route.ts`)**:
   - Dòng 10–25: Nhận danh sách `orderIds`, truy vấn đơn hàng kèm quan hệ `customer`, `channel`, `items.product` (với thuộc tính `fragile`), và `shipments`.
   - Dòng 40–80: Kiểm tra `hasFragile = order.items.some(it => it.product?.fragile === true)`, trích xuất đơn vị vận chuyển (`carrier`), mã vận đơn (`trackingCode`), tiền thu hộ `codAmount` (chỉ thu nếu `paymentMethod === 'COD'` và chưa thanh toán).
   - Dòng 85–90: Trả về HTTP 200 `{ success: true, slips: [...], count: slips.length }`.

3. **Giao diện thao tác hàng loạt (`src/components/cms/views/orders-view.tsx`)**:
   - Dòng 257–328: State quản lý chọn đa đơn hàng `selectedOrderIds`, toggle Chọn tất cả `handleToggleSelectAll`, toggle từng dòng `handleToggleSelectOrder`, và thực thi `handleBulkConfirm`.
   - Dòng 1033–1076: Thanh tác vụ hàng loạt nổi (Bulk Action Bar) hiển thị khi `selectedOrderIds.length > 0`:
     - Badge "Đã chọn X đơn hàng".
     - Nút "Xác nhận hàng loạt" gọi API `POST /api/orders/bulk-confirm`.
     - Nút "In phiếu giao hàng (A6)" mở modal xem trước và in ấn tem vận đơn.
     - Nút "Bỏ chọn".
   - Dòng 1083–1100: Checkbox tại cột tiêu đề bảng (Select-All) và Checkbox tại từng dòng đơn hàng.
   - Dòng 2140–2219: Dialog hiển thị kết quả xác nhận hàng loạt chi tiết: tổng số đơn thành công, tổng số đơn bị từ chối kèm lý do chi tiết từng đơn (vượt tồn kho, đã hủy, v.v.).

4. **Component in ấn phiếu giao hàng A6 (`src/components/cms/shipping-slip-batch-print.tsx`)**:
   - Khổ in chuẩn A6: `width: 105mm`, `height: 148mm`.
   - CSS in ấn `@media print`:
     ```css
     @page { size: 105mm 148mm; margin: 0; }
     .a6-slip-page {
       width: 105mm !important;
       min-height: 148mm !important;
       max-height: 148mm !important;
       page-break-after: always !important;
       break-after: page !important;
     }
     ```
   - Hiển thị đầy đủ: thông tin người gửi (Kho Ưu Đàm), thông tin người nhận, mã vận đơn, mã vạch tra cứu, danh sách sản phẩm, banner cảnh báo `⚠️ HÀNG DỄ VỠ` khi đơn chứa hàng gốm/nến/thủy tinh, tiền thu hộ COD hoặc "ĐÃ THANH TOÁN", và khung chữ ký.
   - Cơ chế in chuẩn: render portal ra `document.body` khi in để cách ly tuyệt đối với giao diện ứng dụng.

5. **Kết quả kiểm chứng kỹ thuật**:
   - `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts`:
     ```
     KẾT QUẢ SUITE R2: 13 PASS, 0 FAIL (100%)
       ✅ [PASS] F06-Tier2-EmptyPayloadHandling: Body rỗng hoặc thiếu orderIds trả về mã lỗi hoặc 0 processed (HTTP 400)
       ✅ [PASS] F06-Tier2-InvalidTypeHandling: orderIds dạng string sai kiểu trả về HTTP 400 (HTTP 400)
       ✅ [PASS] F06-Tier1-BulkConfirmResponseStatus: POST /api/orders/bulk-confirm phản hồi HTTP 200 (nhận 200)
       ✅ [PASS] F06-Tier1-AccurateCounts: Chỉ xác nhận đơn hợp lệ: processedCount = 2 (nhận 2), rejectedCount = 4 (nhận 4)
       ✅ [PASS] F06-Tier1-ValidOrdersConfirmed: Đơn 1 và 2 hợp lệ được xác nhận sang CONFIRMED
       ✅ [PASS] F06-Tier1-CancelledOrderRejectedWithReason: Đơn đã hủy bị từ chối với lý do rõ ràng: "Đơn hàng đang ở trạng thái CANCELLED, chỉ đơn PENDING mới được xác nhận"
       ✅ [PASS] F06-Tier1-AlreadyConfirmedRejectedWithReason: Đơn đã CONFIRMED từ trước bị từ chối với lý do rõ ràng: "Đơn hàng đang ở trạng thái CONFIRMED, chỉ đơn PENDING mới được xác nhận"
       ✅ [PASS] F06-Tier1-OutOfStockRejectedWithReason: Đơn vượt tồn kho bị từ chối với lý do rõ ràng: "Không đủ tồn kho (Sản phẩm R2-...: tồn 0, yêu cầu 5)"
       ✅ [PASS] F06-Tier1-NonExistentOrderRejectedWithReason: Đơn không tồn tại bị từ chối với lý do rõ ràng: "Đơn hàng không tồn tại"
       ✅ [PASS] F06-Tier1-DatabaseStateMatches: DB phản ánh đúng: Đơn hợp lệ -> CONFIRMED, Đơn đã hủy giữ CANCELLED, Đơn thiếu tồn giữ PENDING
       ✅ [PASS] F06-Tier1-BatchShippingSlipsCount: Xuất thành công dữ liệu in phiếu giao hàng cho cả 2 đơn
       ✅ [PASS] F08-Tier1-FragileWarningInSlip: Phiếu in của đơn chứa sản phẩm dễ vỡ hiển thị cảnh báo HÀNG DỄ VỠ
       ✅ [PASS] F06-Tier3-StockLedgerChainIntegrity: Chuỗi biến động kho (StockMovement) cho toàn bộ sản phẩm test khớp 100% với tồn thực tế
     ```
   - `npx tsc --noEmit`: 0 errors.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm run test:chain`: Chuỗi biến động kho của `UD-QT-002` và `UD-VL-001` khớp 100% với tồn thực tế.
   - `npm run test:scenarios`: 21/21 KỊCH BẢN ĐẠT (0 failures).
   - `npm run build`: Compiled successfully in 7.6s, static pages generated.
   - Kiểm tra CSDL so với `db/baseline-counts.json`: 20/20 bảng cốt lõi khớp 100% baseline (Zero residue).

---

## 2. LOGIC CHAIN

1. *Quan sát*: Yêu cầu R2 trong `ORIGINAL_REQUEST.md` và `PROJECT.md` đòi hỏi: khi người dùng chọn nhiều đơn để xác nhận hàng loạt, hệ thống phải xác nhận các đơn hợp lệ, từ chối các đơn không hợp lệ và báo rõ lý do từng đơn bị từ chối, không được bỏ qua im lặng.
2. *Lập luận*: Trong `POST /api/orders/bulk-confirm`, bằng cách duyệt qua từng đơn hàng trong một khối `db.$transaction` riêng, mỗi đơn được kiểm tra độc lập và ghi nhận kết quả chi tiết. Nếu một đơn không đủ tồn kho hoặc không ở trạng thái PENDING, chỉ riêng đơn đó bị rollback/rejected kèm lý do cụ thể, các đơn hợp lệ khác vẫn được xác nhận và trừ kho thành công.
3. *Quan sát*: Yêu cầu tính toàn vẹn chuỗi sổ kho `test:chain` đòi hỏi mỗi lần trừ kho phải sinh ra một bản ghi `StockMovement` với `bal === stockAfter` và `bal === stock`.
4. *Lập luận*: Khi đơn hàng được xác nhận trong `bulk-confirm`, hệ thống tính toán tồn kho mới (`stockAfter = currentStock - quantity`), cập nhật `Product.stock` và tạo bản ghi `StockMovement` với `quantity: -quantity`, `stockAfter`. Đối với combo, hệ thống trừ kho từng thành phần định mức và gọi `syncComboStock` để cập nhật tồn hiển thị combo. Do đó, chuỗi số dư lũy kế bảo toàn tính đơn điệu 100%.
5. *Quan sát*: Yêu cầu in phiếu giao hàng A6 đòi hỏi hỗ trợ ngắt trang `page-break-after: always`, hiển thị cảnh báo hàng dễ vỡ, mã vạch, tiền thu hộ COD.
6. *Lập luận*: Bằng cách xây dựng `ShippingSlipBatchPrint` với CSS `@page { size: 105mm 148mm; margin: 0; }` và `.a6-slip-page { page-break-after: always; break-after: page; }`, trình duyệt sẽ tách mỗi đơn hàng thành đúng một trang A6 khi in qua `window.print()`, đáp ứng hoàn hảo tiêu chuẩn vận hành kho Ưu Đàm.

---

## 3. CAVEATS

- No caveats. Toàn bộ tính năng xác nhận hàng loạt, báo cáo từ chối chi tiết, thanh tác vụ giao diện và in ấn tem vận đơn A6 đã được triển khai hoàn chỉnh, kiểm thử thực tế và vượt qua 100% các cổng chất lượng.

---

## 4. CONCLUSION

- **Milestone M3 (Bulk Orders Processing & Batch Slips — R2) đã HOÀN THÀNH TOÀN DIỆN.**
- Cả 3 tính năng F06 (Bulk Confirm API), F07 (Bulk Selection UI), và F08 (Batch Shipping Slips A6) đều hoạt động chính xác, bảo toàn nguyên vẹn CSDL và chuỗi sổ kho.
- Sẵn sàng bàn giao cho `auditor` kiểm toán độc lập và Orchestrator tiếp tục kích hoạt Milestone M4 (VAT E-Invoice XML & Mock Signer).

---

## 5. VERIFICATION METHOD

Để kiểm chứng độc lập kết quả bàn giao này, thực thi lần lượt các lệnh sau:

```powershell
# 1. Chạy bộ kiểm thử chuyên biệt Milestone M3 (Kỳ vọng: 13 PASS, 0 FAIL)
node --experimental-strip-types scripts/verify-r2-bulk-orders.ts

# 2. Kiểm tra typecheck TypeScript (Kỳ vọng: 0 errors)
npx tsc --noEmit

# 3. Kiểm tra ESLint (Kỳ vọng: 0 errors, 0 warnings)
npm run lint

# 4. Kiểm tra tính toàn vẹn chuỗi sổ kho (Kỳ vọng: PASS, kết thúc đúng tồn thực tế)
npm run test:chain

# 5. Kiểm tra 21 kịch bản nghiệp vụ thực tế (Kỳ vọng: 21/21 KỊCH BẢN ĐẠT)
npm run test:scenarios

# 6. Kiểm tra build sản xuất Next.js Turbopack (Kỳ vọng: Compiled successfully)
npm run build
```

**Điều kiện vô hiệu hóa kết luận**:
- Có bất kỳ lỗi nào xuất hiện trong các lệnh trên.
- Số lượng bản ghi CSDL cốt lõi bị lệch khỏi `db/baseline-counts.json`.
- Phát hiện mã giả lập/hardcode trong các route thuộc phạm vi kiểm toán.
