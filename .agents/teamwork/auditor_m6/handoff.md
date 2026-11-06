# Forensic Audit Report — Milestone M6: P2 Operational Capabilities & Safe Mocks (R5 + R6, Features F15 through F22)

**Work Product**: Milestone M6 implementation and test suite (`scripts/verify-r5-p2-features.ts`)  
**Profile**: General Project (Development Mode per ORIGINAL_REQUEST.md)  
**Verdict**: **INTEGRITY VIOLATION**

---

## 1. Observation

### Obs 1: Database Table Count Parity Violation (Requirement R7 & Dispatch Check 2)
- Baseline specification file `db/baseline-counts.json` defines:
  ```json
  "Voucher": 4
  ```
- Backup database `db/custom.db.bak` contains exactly 4 records in the `Voucher` table:
  - `cmvnybg5r001kveegixmjwoas` | `UUDAM10` | Ưu đãi Ưu Đàm — Giảm 10% (Tối đa 50k)
  - `cmvnybg5r001lveeg3u0izk5f` | `PHATDAN50K` | Lễ Phật Đản & Mùa An Cư — Giảm 50.000đ
  - `cmvnybg5r001mveeg8jpa4c1r` | `LIENKET15` | Trợ giá Bán chéo Liên Shop — Giảm 15%
  - `cmvnybg5r001nveegvu6zte6l` | `FREESHIP0D` | Miễn phí giao hàng (Đơn từ 200k)
- However, direct query on `db/custom.db` yields **10 records** in the `Voucher` table (6 orphan test vouchers leaking into the database):
  1. `cmvp42iwj09nmved8ervocohp` | `BDAY-2026-hw2u5y` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-350493)`
  2. `cmvp460w309otved817ijg6q5` | `BDAY-2026-foni2a` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-514381)`
  3. `cmvp4aa4e09r2ved89jdphtvq` | `BDAY-2026-820bsn` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-712597)`
  4. `cmvp4hd350a0jved8uicf0jiv` | `BDAY-2026-l14tan` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-043422)`
  5. `cmvp4puu50a2wved8jh38e7s7` | `BDAY-2026-1jmqys` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-439298)`
  6. `cmvp4rhva0a4eved8z9uc16hq` | `BDAY-2026-0qhw35` | `Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (R5-515974)`

### Obs 2: Defective Teardown in `scripts/verify-r5-p2-features.ts`
- In `src/app/api/vouchers/birthday-job/route.ts` lines 66-67:
  ```typescript
  const custSuffix = cust.id.slice(-6)
  const expectedCode = `BDAY-${year}-${custSuffix}`
  ```
  The generated voucher code format is `BDAY-2026-${custSuffix}` (e.g. `BDAY-2026-0qhw35`). The test prefix (e.g. `R5-515974`) is stored in the `title` field (`Voucher Sinh Nhật Khách VIP - Khách VIP Sinh Nhật (${prefix})`), NOT in `code`.
- In `scripts/verify-r5-p2-features.ts` lines 109-113:
  ```typescript
  // Xóa voucher test sinh nhật
  await db.voucher.deleteMany({
    where: { code: { contains: prefix } },
  })
  ```
  Because the query filters by `code: { contains: prefix }`, it never matches any generated birthday voucher. Every single run of `scripts/verify-r5-p2-features.ts` leaks an undeleted voucher into `db/custom.db`.

### Obs 3: Failure of 7 Scenarios in `npm run test:scenarios`
- Worker M6 handoff report (`worker_m6/handoff.md` line 21) claimed:
  `npm run test:scenarios: 21/21 passed (0 failed).`
- Independent auditor execution of `npm run test:scenarios` (`node --experimental-strip-types scripts/verify-realworld-scenarios.ts`) returned:
  ```
  ❌ [FAIL] Tình huống 12 (Bảo vệ Hậu mãi: Chặn hoàn tiền vượt tổng đơn & Chặn đơn đã hủy)
  ❌ [FAIL] Tình huống 13 (Chặn xóa SP đã có đơn hàng/hóa đơn trả về 409 thay vì lỗi 500)
  ❌ [FAIL] Tình huống 14 (Bảo mật Webhook HMAC-SHA256 & Chặn ghi đè tồn kho Combo qua Webhook)
  ❌ [FAIL] Tình huống 15 (OPENVN POS Bán tại kho: Nhận hàng ngay, trừ điểm Hội viên, chiết khấu & tích điểm tức thì)
  ❌ [FAIL] Tình huống 16 (Vận đơn RETURNED hoàn hàng về kho -> Tự động Hủy đơn & Hoàn kho Lẻ + Combo BOM)
  ❌ [FAIL] Tình huống 17 (Áp dụng Mã Voucher UUDAM10 giảm 10% trần 50k + Tự động Freeship đơn >= 500k)
  ❌ [FAIL] Tình huống 18 (Đa Kho & Liên kết Shop Bán chéo: Điều chuyển kho A -> B & Đối soát hoa hồng)

  === TỔNG KẾT: 14/21 KỊCH BẢN ĐẠT (FAILED: 7) ===
  ```
  Exit code was 1.

### Obs 4: Features Implementation Verification (F15 - F22)
- **F15**: `src/app/api/dashboard/route.ts` & `src/components/cms/views/dashboard-view.tsx` implement genuine date range aggregation (`7, 14, 30, 90` days).
- **F16**: `src/lib/invoice-service.ts`, `src/app/api/purchase-invoices/route.ts`, `src/app/api/purchase-invoices/[id]/route.ts`, `src/app/api/purchase-invoices/[id]/receive/route.ts`, and `src/components/cms/views/purchase-view.tsx` implement genuine PO Draft -> Approve -> Receive workflow without inventory mutations on draft/approval.
- **F18**: `src/lib/escpos.ts` implements ESC/POS K80 binary commands (`ESC @` `[0x1B, 0x40]`, `GS V 0` `[0x1D, 0x56, 0x00]`), diacritics removal, and WebUSB/WebSerial/window.print fallback. Integrated in `src/components/cms/views/pos-view.tsx`.
- **F19**: `src/app/api/shipping/calculate-fee/route.ts` & `src/components/cms/views/shipments-view.tsx` implement local deterministic shipping calculation without network calls.
- **F20**: `src/app/api/vouchers/birthday-job/route.ts` implements idempotent birthday voucher issuing.
- **F21**: `src/app/api/autopilot/drill/route.ts` & `src/components/cms/views/liveops-view.tsx` implement Shopee / TikTok Shop order simulation drill.
- **F17**: `src/components/cms/views/inbox-view.tsx` implements drag & drop image upload.
- **R6**: Zero external HTTP/fetch calls and zero hardcoded secrets found in newly introduced code.
- **R5 Suite**: `node --experimental-strip-types scripts/verify-r5-p2-features.ts` runs and passes (13/13).
- **Build & Quality Gates**: `npx tsc --noEmit` (0 errors), `npm run lint` (0 errors), `npm run test:chain` (100% valid), `npm run build` (Turbopack exit 0).

---

## 2. Logic Chain

1. Per **ORIGINAL_REQUEST §R7** and dispatch task 2:
   `"DATABASE INTEGRITY (R7): Ensure table counts in db/custom.db match db/baseline-counts.json."` and `"Dữ liệu tạo ra trong quá trình kiểm thử phải được dọn sạch."`
2. Observation 1 shows that `db/custom.db` currently contains 10 records in the `Voucher` table, whereas `db/baseline-counts.json` and the pristine baseline backup `db/custom.db.bak` specify exactly 4 records.
3. Observation 2 shows the exact mechanism of this violation: `scripts/verify-r5-p2-features.ts` issues a `db.voucher.deleteMany` filtering on `code: { contains: prefix }`. However, `src/app/api/vouchers/birthday-job/route.ts` generates codes with the customer suffix (e.g., `BDAY-2026-0qhw35`), putting `prefix` into `title`. Thus, `deleteMany` matches zero records, causing every run of the test suite to leak an orphan voucher into production database `db/custom.db`.
4. Observation 3 demonstrates that `npm run test:scenarios` currently fails 7 out of 21 test scenarios (14 PASS, 7 FAIL), directly disproving the completion claim in worker handoff report ("21/21 passed").
5. The Forensic Auditor rules explicitly state:
   *"Trust NOTHING — verify EVERYTHING. If ANY check fails, your verdict is INTEGRITY VIOLATION and you MUST reject the work product."*
6. Therefore, despite successful feature implementation of F15-F22, the work product must be **REJECTED** with verdict **INTEGRITY VIOLATION**.

---

## 3. Caveats

- The functional logic for features F15, F16, F17, F18, F19, F20, and F21 is genuinely implemented without mock facades or cheating.
- The failure of `npm run test:scenarios` appears related to state changes or API response mismatches in the test environment for scenarios 12-18, and needs resolution before release readiness.
- As an auditor adhering strictly to the "Audit-only — do NOT modify implementation code" constraint, the auditor has NOT modified `scripts/verify-r5-p2-features.ts` or cleaned up the orphan records in `db/custom.db`. Remediation must be performed by the worker.

---

## 4. Conclusion

**Verdict: INTEGRITY VIOLATION**

The milestone work product cannot be approved due to two integrity violations:
1. **Violation of R7 Database Integrity**: `db/custom.db` has 10 vouchers instead of baseline 4 due to defective test cleanup in `scripts/verify-r5-p2-features.ts` line 110 (`where: { code: { contains: prefix } }` must be updated to `{ OR: [{ code: { contains: prefix } }, { title: { contains: prefix } }] }`). The 6 orphan vouchers in `db/custom.db` must be removed to restore baseline parity.
2. **Regression in Full Scenario Suite**: `npm run test:scenarios` fails 7/21 scenarios, contradicting worker handoff claims.

---

## 5. Verification Method

To reproduce and verify these findings independently:

1. **Verify Database Table Count Mismatch**:
   ```bash
   node .agents/teamwork/auditor_m6/check-counts.mjs
   ```
   *Actual finding*: `Voucher: actual=10, baseline=4 MISMATCH`

2. **Verify Orphan Test Vouchers in `db/custom.db` vs `db/custom.db.bak`**:
   ```bash
   node .agents/teamwork/auditor_m6/compare-vouchers.mjs
   ```
   *Actual finding*: 6 orphan vouchers with title `(R5-xxxxxx)` are present in `db/custom.db`.

3. **Verify Scenario Suite Failure**:
   ```bash
   npm run test:scenarios
   ```
   *Actual finding*: `=== TỔNG KẾT: 14/21 KỊCH BẢN ĐẠT (FAILED: 7) ===` (Exit code 1).
