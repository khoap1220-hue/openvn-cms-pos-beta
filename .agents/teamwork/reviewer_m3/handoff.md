# HANDOFF REPORT — REVIEW & ADVERSARIAL CRITIQUE: MILESTONE M3

**Target**: Milestone M3 (Bulk Orders Processing & Batch Slips — R2)  
**Reviewer & Adversarial Critic**: `reviewer_m3`  
**Parent Conversation ID**: `7124d145-f8bf-4670-a0d0-13114c2b24e3`  
**Timestamp**: 2026-10-26T08:53:00Z  
**Verdict**: **REQUEST_CHANGES**  

---

## 1. OBSERVATION

1. **Kết quả chạy các lệnh kiểm thử độc lập**:
   - `node --experimental-strip-types scripts/verify-r2-bulk-orders.ts`:
     - Kết quả: **13 PASS, 0 FAIL (100%)**.
     - Đã xác nhận: xử lý tập hỗn hợp 6 đơn (2 hợp lệ, 1 hủy, 1 đã xác nhận, 1 vượt tồn, 1 không tồn tại). Phản hồi đúng `processedCount: 2, rejectedCount: 4`, liệt kê lý do cụ thể từng đơn.
   - `npx tsc --noEmit`:
     - Kết quả: **0 errors** (exit code 0).
   - `npm run lint`:
     - Kết quả: **0 errors, 0 warnings** (exit code 0).
   - `npm run test:chain`:
     - Kết quả: **PASS**. Chuỗi biến động kho của `UD-QT-002` (14 records) và `UD-VL-001` (24 records) khớp 100% với tồn thực tế.
   - `npm run test:scenarios`:
     - Kết quả: **21/21 KỊCH BẢN ĐẠT (0 failures)**.
   - `npm run build`:
     - Kết quả: **Compiled successfully in 4.1s** (Next.js 16 Turbopack).
   - Đối chiếu số lượng CSDL với `db/baseline-counts.json`:
     - Kết quả: **22/22 bảng cốt lõi khớp 100% baseline count** (Product=12, Order=173, Customer=34, StockMovement=246, v.v.), không để lại dữ liệu rác.

2. **Khảo sát mã nguồn thực tế & Phát hiện cơ chế trừ kho**:
   - Tại `src/lib/order-service.ts` (dòng 231–270):
     Khi bất kỳ đơn hàng nào được tạo qua luồng chuẩn (`createOrder` gọi từ `POST /api/orders`, Storefront, POS, Inbound Webhook, hoặc Simulation), hệ thống **đã trừ kho ngay lập tức** và ghi bản ghi `StockMovement` loại `EXPORT` (sản phẩm đơn) hoặc `COMBO_ISSUE` (thành phần combo) với ghi chú `Xuất kho cho đơn ${code}`. Đơn hàng sau đó lưu với trạng thái ban đầu là `PENDING`.
   - Tại `src/app/api/orders/[id]/route.ts` (dòng 86–143):
     Khi xác nhận đơn hàng đơn lẻ (`PATCH /api/orders/[id]` với `{ status: 'CONFIRMED' }`), hệ thống **chỉ cập nhật** trạng thái đơn hàng sang `CONFIRMED` mà **không trừ kho thêm lần nào nữa**, vì tồn kho đã được giữ/trừ lúc tạo đơn. Nếu đơn bị hủy (`CANCELLED`), hệ thống mới hoàn kho (`IMPORT`).
   - Tại `src/app/api/orders/bulk-confirm/route.ts` (dòng 214–260):
     Khi xác nhận hàng loạt, route này kiểm tra `freshProd.stock < totalRequired` rồi **tiến hành trừ kho một lần nữa** (`tx.product.update` giảm tiếp `demand.quantity`) và tạo thêm một bản ghi `StockMovement` mới loại `EXPORT`/`COMBO_ISSUE`.
   - Tại `scripts/verify-r2-bulk-orders.ts` (dòng 172–184):
     Script test tạo các đơn hàng thử nghiệm bằng `db.order.create` trực tiếp (bỏ qua `createOrder`), nên các đơn test này chưa hề bị trừ kho trước đó. Do đó, khi `bulk-confirm` trừ kho, script test báo PASS mà không phát hiện ra lỗi trừ kho 2 lần trên đơn hàng thật.

---

## 2. LOGIC CHAIN

1. *Quan sát 1*: Toàn bộ đơn hàng phát sinh trong vận hành thực tế (POS tại quầy, web storefront, inbound webhook Shopee/TikTok) đều được tạo thông qua hàm `createOrder` trong `src/lib/order-service.ts`.
2. *Quan sát 2*: Trong `createOrder`, ngay khi đơn được tạo ở trạng thái `PENDING`, tồn kho của sản phẩm (hoặc thành phần combo) đã bị trừ và đã ghi nhận `StockMovement` âm.
3. *Quan sát 3*: Trong `src/app/api/orders/bulk-confirm/route.ts`, hàm duyệt qua từng đơn hàng và thực hiện:
   `const stockAfter = freshProd.stock - demand.quantity; await tx.product.update(...)` và `await tx.stockMovement.create(...)`.
4. *Lập luận (Suy luận cơ chế lỗi)*:
   - Khi chủ cửa hàng/nhân viên thu ngân vào giao diện Quản lý đơn hàng (`/cms/orders`), chọn các đơn hàng `PENDING` phát sinh từ hệ thống và bấm **"Xác nhận hàng loạt"**:
     - **Trường hợp tồn kho hiện tại < số lượng đơn**: Đơn hàng hợp lệ đã đặt trước đó sẽ bị `bulk-confirm` từ chối vô lý với lý do `Không đủ tồn kho (Sản phẩm ...: tồn X, yêu cầu Y)` vì kho đã bị trừ từ lúc tạo đơn!
     - **Trường hợp tồn kho hiện tại >= số lượng đơn**: Đơn hàng được xác nhận nhưng tồn kho bị trừ **2 lần** (Double Deduction), tạo ra 2 bản ghi `StockMovement` xuất kho cho cùng 1 đơn hàng!
     - **Hậu quả khi hủy đơn**: Khi đơn bị hủy qua `PATCH /api/orders/[id]`, hệ thống chỉ hoàn kho lại 1 lần (theo số lượng `item.quantity`). Như vậy 1 lần trừ kho dư thừa sẽ bị thất thoát vĩnh viễn trên sổ kho, làm sai lệch báo cáo tồn kho thực tế.
5. *Kết luận chuỗi suy luận*: Đây là một lỗi nghiêm trọng (Critical Defect) về tính toàn vẹn kho vận trong môi trường vận hành thực tế, cần phải được khắc phục dứt điểm trước khi bàn giao.

---

## 3. CAVEATS

- Các tính năng F07 (Giao diện chọn nhiều đơn, thanh công cụ Bulk Action Bar, dialog báo cáo chi tiết lý do từ chối) và F08 (Phiếu in A6 chuẩn 105x148mm, CSS print `@page`, cảnh báo hàng dễ vỡ, mã vạch CODE128) đã được xây dựng rất bài bản, đẹp mắt và không có lỗi cú pháp hay hiển thị.
- Các bài kiểm thử hiện có (`tsc`, `lint`, `test:chain`, `test:scenarios`, `verify-r2-bulk-orders.ts`) đều pass 100%. Tuy nhiên, bài test `verify-r2-bulk-orders.ts` chưa bao quát trường hợp đơn hàng được tạo qua `createOrder` chuẩn của hệ thống.

---

## 4. CONCLUSION & FINDINGS

### Review Summary
**Verdict**: **REQUEST_CHANGES**

### Findings

#### [Critical] Finding 1: Lỗ hổng trừ kho 2 lần (Double Stock Deduction) trong API Xác nhận hàng loạt
- **Vị trí**: `src/app/api/orders/bulk-confirm/route.ts` (dòng 88–265)
- **Cơ chế lỗi**: Đơn hàng tạo qua `createOrder` đã bị trừ kho tại thời điểm tạo đơn. `bulk-confirm` không kiểm tra xem đơn hàng đã được trừ kho từ trước hay chưa mà trừ kho thêm một lần nữa.
- **Rủi ro vận hành**: Thất thoát dữ liệu tồn kho, từ chối nhầm các đơn hàng hợp lệ khi tồn kho hiển thị < nhu cầu (dù hàng đã được giữ cho đơn đó), và lệch sổ kho vĩnh viễn khi đơn bị hủy.
- **Giải pháp đề xuất (Actionable Fix)**:
  Trong `src/app/api/orders/bulk-confirm/route.ts`, trước khi kiểm tra tồn kho và trừ kho, hãy kiểm tra xem đơn hàng này đã có biến động xuất kho từ trước hay chưa:
  ```typescript
  // Kiểm tra xem đơn hàng đã được trừ kho lúc tạo đơn hay chưa
  const existingMovement = await tx.stockMovement.findFirst({
    where: {
      note: { contains: order.code },
      type: { in: ['EXPORT', 'COMBO_ISSUE'] },
    },
  })
  const alreadyDeducted = Boolean(existingMovement)
  ```
  - Nếu `alreadyDeducted === true`: Không trừ kho lại, không kiểm tra `freshProd.stock < totalRequired` (vì tồn đã được trừ/giữ sẵn cho đơn này). Chỉ cập nhật `order.status = 'CONFIRMED'`, ghi timeline, lineage, broadcast và webhook.
  - Nếu `alreadyDeducted === false` (ví dụ: đơn hàng đồng bộ từ nguồn ngoài chưa trừ kho, hoặc đơn hàng test): Giữ nguyên logic kiểm tra tồn kho, trừ kho và ghi `StockMovement` như hiện tại.
  - Bổ sung kịch bản kiểm thử trong `scripts/verify-r2-bulk-orders.ts` kiểm tra việc xác nhận hàng loạt trên đơn hàng được tạo bởi `createOrder` để chứng minh không bị trừ kho 2 lần.

---

## 5. VERIFICATION METHOD

Sau khi worker cập nhật bản sửa lỗi, thực hiện kiểm chứng độc lập theo các bước sau:

1. **Chạy bộ kiểm thử Milestone M3**:
   ```powershell
   node --experimental-strip-types scripts/verify-r2-bulk-orders.ts
   ```
2. **Kiểm tra hồi quy đơn hàng tạo qua createOrder**:
   Tạo một đơn hàng bằng `createOrder` (tồn giảm từ N xuống N-x). Gọi `POST /api/orders/bulk-confirm` với đơn hàng này. Xác nhận tồn kho vẫn giữ nguyên N-x (không bị giảm thành N-2x).
3. **Chạy toàn bộ cổng chất lượng**:
   ```powershell
   npx tsc --noEmit
   npm run lint
   npm run test:chain
   npm run test:scenarios
   npm run build
   ```
4. **Điều kiện vô hiệu hóa kết luận (Invalidation Conditions)**:
   - Đơn hàng tạo qua `createOrder` khi xác nhận qua `bulk-confirm` không bị trừ kho lần thứ hai.
   - Các đơn hàng chưa trừ kho vẫn được kiểm tra tồn và trừ kho đúng chuẩn.
   - Toàn bộ các bài kiểm thử tự động pass với 0 lỗi.
