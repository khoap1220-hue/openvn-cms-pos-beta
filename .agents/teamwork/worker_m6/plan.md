# Implementation Plan - Milestone M6 (P2 Operational Capabilities & Safe Mocks)

## Objective
Implement Features F15 through F22 according to requirements in ORIGINAL_REQUEST.md, PROJECT.md, and DISPATCH.md, ensuring 100% pass on all verification test suites.

## Tasks Breakdown

### 1. Dashboard Date Range Filter (F15)
- **API**: `src/app/api/dashboard/route.ts`
  - Accept query parameter `?days=7|14|30|90` (default: 14).
  - Calculate `todayStart` (00:00:00 today) and `rangeStart = new Date(todayStart.getTime() - (days - 1) * 86400000)`.
  - Fetch orders with `createdAt >= rangeStart` and `status != 'CANCELLED'`.
  - Populate `dayMap` for exactly `days` entries (from today backward to `today - days + 1`).
  - Return `revenueByDay` with exactly `days` elements, strictly matching orders in DB.
- **UI**: `src/components/cms/views/dashboard-view.tsx`
  - Add state `days` (7 | 14 | 30 | 90), default 14.
  - Pass `?days=${days}` to `apiGet('/api/dashboard?days=' + days)`.
  - Add button group selector for 7 / 14 / 30 / 90 days next to chart header.
  - Update chart title to reflect selected days.

### 2. Purchase Order (PO) Workflow: Draft -> Approve -> Receive (F16)
- **API**:
  - `src/lib/invoice-service.ts`:
    - In `CreatePurchaseInvoiceInput`, support `status?: string`.
    - If `status === 'DRAFT'`, create invoice with `status: 'DRAFT'` and do NOT alter product stock, do NOT create stock movement.
  - `src/app/api/purchase-invoices/route.ts`:
    - Pass `body.status` into `createPurchaseInvoice`.
  - `src/app/api/purchase-invoices/[id]/route.ts`:
    - Handle `action === 'APPROVE'`:
      - Verify invoice exists and update `status: 'APPROVED'`. Stock remains unaltered.
  - `src/app/api/purchase-invoices/[id]/receive/route.ts` (create):
    - POST handler accepting `{ items: [{ productId: string, receivedQuantity: number }] }`.
    - In `db.$transaction`:
      - For each item, increase `product.stock` by `receivedQuantity`.
      - Create `db.stockMovement` with `{ type: 'IMPORT', quantity: receivedQuantity, stockAfter: product.stock + receivedQuantity, note: ... }`.
      - Update purchase invoice item / invoice status: check total received vs total ordered. If all received, status = 'RECEIVED' (or 'POSTED'), else 'PARTIALLY_RECEIVED'.
- **UI**: `src/components/cms/views/purchase-view.tsx`:
  - Allow creating PO as "DRAFT" (Đơn đặt hàng PO - Nháp) vs "POSTED" (Nhập kho ngay).
  - Status badges for DRAFT, APPROVED, PARTIALLY_RECEIVED, RECEIVED, POSTED, CANCELLED.
  - Action button "Duyệt PO" when status is DRAFT.
  - Action button "Nhận hàng" (Receive) with dialog when status is APPROVED or PARTIALLY_RECEIVED.

### 3. ESC/POS K80 Thermal Printing & Fallback (F18)
- **Library**: `src/lib/escpos.ts` (create)
  - `encodeReceipt(order: any): Uint8Array`
  - Commands:
    - Init: `ESC @` (`[0x1B, 0x40]`)
    - Center align, Bold title: "ƯU ĐÀM - KHO HÀNG & CMS"
    - Receipt details: Order code, customer name, date
    - Item table with name, quantity, price, amount
    - Total, payment method
    - Paper cut: `GS V 0` (`[0x1D, 0x56, 0x00]`) or `ESC i` (`[0x1B, 0x69]`)
    - Vietnamese diacritic handler (convert diacritics to clean readable text or supported CP1258).
- **UI**: `src/components/cms/views/pos-view.tsx`:
  - Implement print handler with WebUSB/WebSerial attempt:
    - If `navigator.usb` / `navigator.serial` is supported, attempt to connect and transfer encoded receipt bytes.
    - If unsupported or rejected/disconnected, fallback automatically to `window.print()`.

### 4. Auto Shipping Fee Calculation Mock (F19, R6)
- **API**: `src/app/api/shipping/calculate-fee/route.ts` (create)
  - POST handler receiving `{ carrier: 'GHTK'|'GHN', province, district, weightGram }`.
  - Deterministic safe mock without external network calls:
    - Base fee for Inner-city (Hà Nội): 22,000 VND (GHTK) / 24,000 VND (GHN).
    - Inter-provincial (Hồ Chí Minh or other provinces): 35,000 - 45,000 VND.
    - Extra weight charge: 5,000 VND per additional 500g above 1kg.
    - Inner-city fee > 0 and inter-provincial fee > inner-city fee.
    - Returns `{ fee: number, carrier: string, estimatedDelivery: string }`.
- **UI**: `src/components/cms/views/shipments-view.tsx`:
  - Add quick fee calculator button/modal in shipments view.

### 5. VIP Customer Birthday Voucher Idempotency (F20, R6)
- **API**: `src/app/api/vouchers/birthday-job/route.ts` (create)
  - POST handler receiving `{ testCustomerId?: string, date?: string }`.
  - Find VIP customer(s):
    - If `testCustomerId`, look up that customer. Check `customer.isMember` or `points >= 100`.
    - Check birthday in customer's `preferences` (JSON `{ birthday: 'MM-DD' }`).
    - Verify customer birthday matches today's month/day (or `date` parameter).
  - Idempotency check:
    - Search for existing voucher in `db.voucher` with code containing `customer.id.slice(-6)` and matching current year or birthday job.
    - If already exists, return `{ success: true, idempotent: true, voucher: existing, message: 'Voucher đã được phát trước đó' }`.
    - If not, create voucher with code `BDAY-${customer.id.slice(-6)}-${dateStr.replace(/-/g, '')}`.
    - Return `{ success: true, idempotent: false, voucher: created }`.

### 6. Omnichannel Order Simulation Drill (F21)
- **API**: `src/app/api/autopilot/drill/route.ts` (create)
  - POST handler receiving `{ channel: 'SHOPEE'|'TIKTOK', customerName, itemSku, quantity }`.
  - Look up or create channel for `SHOPEE` / `TIKTOK`.
  - Look up product by `itemSku` or fallback to first product.
  - Create order with channelId, customerName, items, total.
  - Return `{ success: true, order: { id, code, ... } }`.
- **UI**: `src/components/cms/views/liveops-view.tsx`:
  - Add drill action buttons for Shopee and TikTok Shop in simulator card.

### 7. Chat Drag-and-Drop Image Upload (F17)
- **UI**: `src/components/cms/views/inbox-view.tsx`:
  - Add `onDragOver`, `onDragLeave`, `onDrop` events on chat input / messages container.
  - On file drop, extract image file and invoke `attachImage(file)`.
  - Display dropzone visual feedback.

### 8. Verification & Auditing (F22, R6)
- Run `node --experimental-strip-types scripts/verify-r5-p2-features.ts`
- Run `npx tsc --noEmit`
- Run `npm run lint`
- Run `npm run test:chain`
- Run `npm run test:scenarios`
- Run `npm run build`
- Write comprehensive `handoff.md`
