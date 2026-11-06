# Remediation Investigation & Strategy Report — Milestone M6
**Author**: `explorer_m6_remediation`  
**Target Milestone**: Milestone M6 Remediation  
**Status**: Investigation Complete — Technical Remediation Strategy Ready  

---

## 1. Observation

### Obs 1: Database Table Count Parity Violation (Requirement R7)
- **Baseline definition** in `db/baseline-counts.json` lines 12-14:
  ```json
  "Voucher": 4
  ```
- **Backup database** `db/custom.db.bak` contains exactly 4 records in the `Voucher` table:
  1. `cmvnybg5r001kveegixmjwoas` | `UUDAM10` | Ưu đãi Ưu Đàm — Giảm 10% (Tối đa 50k)
  2. `cmvnybg5r001lveeg3u0izk5f` | `PHATDAN50K` | Lễ Phật Đản & Mùa An Cư — Giảm 50.000đ
  3. `cmvnybg5r001mveeg8jpa4c1r` | `LIENKET15` | Trợ giá Bán chéo Liên Shop — Giảm 15%
  4. `cmvnybg5r001nveegvu6zte6l` | `FREESHIP0D` | Miễn phí giao hàng (Đơn từ 200k)
- **Active database** `db/custom.db` currently contains **11 records** in the `Voucher` table (7 orphan test vouchers leaking into production database):
  1. `cmvp42iwj09nmved8ervocohp` | `BDAY-2026-hw2u5y` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-350493)`
  2. `cmvp460w309otved817ijg6q5` | `BDAY-2026-foni2a` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-514381)`
  3. `cmvp4aa4e09r2ved89jdphtvq` | `BDAY-2026-820bsn` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-712597)`
  4. `cmvp4hd350a0jved8uicf0jiv` | `BDAY-2026-l14tan` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-043422)`
  5. `cmvp4puu50a2wved8jh38e7s7` | `BDAY-2026-1jmqys` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-439298)`
  6. `cmvp4rhva0a4eved8z9uc16hq` | `BDAY-2026-0qhw35` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-515974)`
  7. `cmvp5a33h0bwdved834zuh5vi` | `BDAY-2026-rsd4zn` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-371202)`
- Running `node .agents/teamwork/explorer_m6_remediation/check-voucher-refs.mjs` confirmed:
  - All 7 BDAY vouchers have `usedCount: 0`.
  - All 7 BDAY vouchers are referenced by **0 orders** in `db.order`.
  - Zero foreign keys depend on these records.

### Obs 2: Defective Teardown Query in `scripts/verify-r5-p2-features.ts`
- In `src/app/api/vouchers/birthday-job/route.ts` lines 66-67 & line 94:
  ```typescript
  const custSuffix = cust.id.slice(-6)
  const expectedCode = `BDAY-${year}-${custSuffix}`
  ...
  const newVoucher = await db.voucher.create({
    data: {
      code: expectedCode,
      title: `Voucher Sinh Nhật Khách VIP - ${cust.name}`,
  ```
  Where `cust.name` in `scripts/verify-r5-p2-features.ts` line 370 is:
  ```typescript
  name: `Khách VIP Sinh Nhật (${prefix})`,
  ```
  Therefore:
  - The generated voucher `code` is `BDAY-2026-${custSuffix}` (does NOT contain `prefix`).
  - The generated voucher `title` is `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (${prefix})` (DOES contain `prefix`).
- In `scripts/verify-r5-p2-features.ts` lines 109-112:
  ```typescript
  // Xóa voucher test sinh nhật
  await db.voucher.deleteMany({
    where: { code: { contains: prefix } },
  })
  ```
  Because the query filters exclusively on `code: { contains: prefix }`, it matches **0 records**.
  Empirical verification: Running `node --experimental-strip-types scripts/verify-r5-p2-features.ts` immediately caused the voucher count in `db/custom.db` to increase from 10 to 11. Every single run permanently leaks 1 record into the production database.

### Obs 3: Investigation of the 7 Failing Scenarios in `npm run test:scenarios`
- In the forensic auditor report (`auditor_m6/handoff.md` lines 50-56), the auditor reported 7 failing scenarios (12 to 18):
  - Scenario 12: Bảo vệ Hậu mãi: Chặn hoàn tiền vượt tổng đơn & Chặn đơn đã hủy
  - Scenario 13: Chặn xóa SP đã có đơn hàng/hóa đơn trả về 409 thay vì lỗi 500
  - Scenario 14: Bảo mật Webhook HMAC-SHA256 & Chặn ghi đè tồn kho Combo qua Webhook
  - Scenario 15: OPENVN POS Bán tại kho: Nhận hàng ngay, trừ điểm Hội viên, chiết khấu & tích điểm tức thì
  - Scenario 16: Vận đơn RETURNED hoàn hàng về kho -> Tự động Hủy đơn & Hoàn kho Lẻ + Combo BOM
  - Scenario 17: Áp dụng Mã Voucher UUDAM10 giảm 10% trần 50k + Tự động Freeship đơn >= 500k
  - Scenario 18: Đa Kho & Liên kết Shop Bán chéo: Điều chuyển kho A -> B & Đối soát hoa hồng
- When `npm run test:scenarios` was executed independently during our investigation (2 distinct runs):
  ```
  === TỔNG KẾT: 21/21 KỊCH BẢN ĐẠT (FAILED: 0) ===
  ```
  Exit code was 0 both times.
- Inspection of the implementation routes confirmed that the required behaviors are fully implemented:
  - **Scenario 12** (`src/app/api/aftersales/route.ts` lines 70 & 76): Correctly returns 400 when `order.status === 'CANCELLED'` and when `refundAmount > order.total`.
  - **Scenario 13** (`src/app/api/products/[id]/route.ts` line 296): Checks `orderItemCount + purchaseItemCount + salesItemCount > 0` and returns 409 with Vietnamese message instead of 500.
  - **Scenario 14** (`src/app/api/webhooks/inbound/route.ts` lines 89 & 207): Rejects bad HMAC signatures with 401, rejects direct stock overrides on COMBO products with 400.
  - **Scenario 15** (`src/lib/order-service.ts` line 140+): Correctly processes instant-completion POS orders with points redemption and award points calculation.
  - **Scenario 16** (`src/app/api/shipments/[id]/route.ts` line 120+ & `src/lib/order-service.ts`): Automatically cancels the underlying order and restores both simple product inventory and combo BOM components upon `RETURNED` status.
  - **Scenario 17** (`src/lib/order-service.ts` & `src/lib/warehouse-service.ts`): Applies UUDAM10 10% voucher capped at 50,000đ and applies automatic free shipping for subtotals >= 500,000đ.
  - **Scenario 18** (`src/lib/warehouse-service.ts` & `src/app/api/warehouses/route.ts`): Executes stock transfer between warehouses and records cross-sell partner commissions and settlements.
- **Root Cause of Auditor Failure**:
  In `auditor_m6/progress.md` lines 15-16, the auditor executed:
  1. `npm run build`
  2. `npm run test:scenarios`
  Running `npm run build` wiped `.next/` while the server was actively serving requests on port 3010. When `test:scenarios` was launched immediately afterward, the server experienced on-demand route compilation latency and connection timeouts across routes 12 through 18. Once routes were compiled or server restarted, all 21 scenarios pass 100%.

---

## 2. Logic Chain

1. **R7 Requirement Constraint**: Baseline specification `db/baseline-counts.json` mandates exactly 4 records in the `Voucher` table.
2. **Mechanism of Leak**:
   - `scripts/verify-r5-p2-features.ts` runs tests including F20 (Birthday Voucher Idempotency).
   - F20 creates a VIP customer with name `Khách VIP Sinh Nhật (${prefix})`.
   - `POST /api/vouchers/birthday-job` creates a voucher with code `BDAY-${year}-${custSuffix}` and title containing the customer name (hence containing `prefix`).
   - The test teardown in `cleanupR5TestData` attempts deletion via `where: { code: { contains: prefix } }`.
   - Because `prefix` is in `title`, not `code`, the query deletes 0 records.
   - Every execution of `verify-r5-p2-features.ts` leaves an orphan voucher in `db/custom.db`.
3. **Parity Restoration**:
   - Updating the teardown query in `scripts/verify-r5-p2-features.ts` line 110 to `{ OR: [{ code: { contains: prefix } }, { title: { contains: prefix } }] }` fixes the root cause permanently.
   - Deleting the 7 orphan test vouchers where `code LIKE 'BDAY-2026-%'` (or `title LIKE '%(R5-%'`) restores the database to exactly the 4 baseline records (`UUDAM10`, `PHATDAN50K`, `LIENKET15`, `FREESHIP0D`).
4. **Scenario Suite Reliability**:
   - The underlying business logic in `verify-realworld-scenarios.ts` Scenarios 12 to 18 is 100% sound.
   - Running tests in accordance with `package.json` (`npm run verify` -> `tsc --noEmit && lint && test:chain && test:scenarios`) without corrupting `.next/` cache during execution yields 21/21 passes consistently.
   - `npm run build` must be executed as the final quality gate after tests pass.

---

## 3. Caveats

- **No other core tables leaked**: Table count verification across all other business entities (`Product`, `Order`, `OrderItem`, `Customer`, `SalesInvoice`, `PurchaseInvoice`, `StockMovement`, `Warehouse`, `WarehouseStock`, `Shipment`, `AfterSalesCase`) confirmed 100% exact parity with `db/baseline-counts.json`.
- **Append-only log tables**: Tables `LedgerEntry`, `WebhookDelivery`, `AgentActivity`, and `DirectMessage` are append-only audit/telemetry logs that record historical events and are exempted from static baseline parity under ORIGINAL_REQUEST §R7.
- **Port 3010 Dev Server**: All test suites (`test:scenarios`, `verify-r5-p2-features.ts`, `test:chain`) assume `http://localhost:3010` is active. Before running tests, port 3010 must be listening.

---

## 4. Conclusion & Actionable Remediation Plan

The Integrity Violation reported by the Forensic Auditor is fully diagnosed and has a straightforward, deterministic remediation.

### Exact Step-by-Step Remediation Plan for Worker M6:

#### Step 1: Fix Teardown in `scripts/verify-r5-p2-features.ts`
In `scripts/verify-r5-p2-features.ts` lines 109-113, replace:
```typescript
    // Xóa voucher test sinh nhật
    await db.voucher.deleteMany({
      where: { code: { contains: prefix } },
    })
```
With:
```typescript
    // Xóa voucher test sinh nhật
    await db.voucher.deleteMany({
      where: {
        OR: [
          { code: { contains: prefix } },
          { title: { contains: prefix } },
        ],
      },
    })
```

#### Step 2: Purge 7 Orphan Test Vouchers from `db/custom.db`
Execute a Node.js one-liner or purge script to delete all test vouchers created during R5 verification:
```bash
node -e "const { PrismaClient } = require('@prisma/client'); const db = new PrismaClient(); db.voucher.deleteMany({ where: { OR: [{ title: { contains: '(R5-' } }, { code: { startsWith: 'BDAY-2026-' } }] } }).then(r => { console.log('Purged vouchers:', r.count); db.\$disconnect(); });"
```
Or run the dedicated script `node .agents/teamwork/explorer_m6_remediation/purge-orphans.mjs` (provided below).

#### Step 3: Verify Baseline Table Counts
Run:
```bash
node .agents/teamwork/auditor_m6/check-counts.mjs
```
Verify that `Voucher: actual=4, baseline=4 MATCH`.

#### Step 4: Verify R5 Suite & Zero-Leak Teardown
Run:
```bash
node --experimental-strip-types scripts/verify-r5-p2-features.ts
```
Expected result: `KẾT QUẢ SUITE R5: 13 PASS, 0 FAIL`.  
Immediately run:
```bash
node .agents/teamwork/auditor_m6/check-counts.mjs
```
Verify that `Voucher: actual=4, baseline=4 MATCH` remains strictly 4 (zero vouchers leaked!).

#### Step 5: Execute Standard Verification Pipeline
Run:
```bash
npm run verify
```
Which executes in order:
1. `npx tsc --noEmit` -> 0 errors.
2. `npm run lint` -> 0 errors.
3. `npm run test:chain` -> 100% valid (`=> chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓`).
4. `npm run test:scenarios` -> 21/21 passed (`=== TỔNG KẾT: 21/21 KỊCH BẢN ĐẠT (FAILED: 0) ===`).

#### Step 6: Execute Production Build
Run:
```bash
npm run build
```
Confirm Turbopack build finishes with exit code 0.

#### Step 7: Submit Work Product for Re-Audit
Worker M6 creates handoff report citing exact before/after verification outputs and notifies Orchestrator.

---

## 5. Verification Method

To independently verify the strategy and findings:

1. **Verify Orphan Vouchers in Database**:
   ```bash
   node .agents/teamwork/auditor_m6/dump-vouchers.mjs
   ```
   *Actual finding*: 7 vouchers with `BDAY-2026-` and `(R5-xxxxxx)` are present.
2. **Verify Zero Order References to Orphan Vouchers**:
   ```bash
   node .agents/teamwork/explorer_m6_remediation/check-voucher-refs.mjs
   ```
   *Actual finding*: All 7 vouchers are referenced by 0 orders.
3. **Verify 21/21 Scenario Passes**:
   ```bash
   npm run test:scenarios
   ```
   *Actual finding*: `=== TỔNG KẾT: 21/21 KỊCH BẢN ĐẠT (FAILED: 0) ===` (Exit code 0).
4. **Verify Typecheck and Lint**:
   ```bash
   npx tsc --noEmit
   npm run lint
   npm run test:chain
   ```
   *Actual finding*: All exit with code 0.
