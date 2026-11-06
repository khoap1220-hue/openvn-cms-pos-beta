# Handoff Report — Reviewer M4 (VAT E-Invoice XML & Mock Signer - R3)

## 1. Observation

Direct observations from independent code inspection, verification test executions, and adversarial stress tests:

1. **Automated Test Suites Execution**:
   - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts`:
     Output: `KẾT QUẢ SUITE R3: 11 PASS, 0 FAIL` (100% pass across all 4 tiers).
   - `npx tsc --noEmit`: Exited 0 with 0 errors.
   - `npm run lint`: Exited 0 with 0 warnings, 0 errors.
   - `npm run test:chain`: Monotonic stock ledger 100% valid.
   - `npm run test:scenarios`: All 21/21 real-world and adversarial scenarios pass.
   - `npm run build`: Compiled successfully with Turbopack, standalone assets copied cleanly, all dynamic route handlers registered (`/api/sales-invoices/[id]/xml` and `/api/sales-invoices/[id]/sign`).

2. **Database Baseline Invariant**:
   - Verified record counts against `db/baseline-counts.json`:
     `Product: 12`, `Order: 173`, `Customer: 34`, `SalesInvoice: 10`, `PurchaseInvoice: 4`, `StockMovement: 246`, `Partner: 1`.
     100% identical to baseline, proving that automated tests cleaned up all temporary test entities cleanly.

3. **Code Inspection — `src/lib/einvoice.ts`**:
   - Regulatory structure: Adheres strictly to QĐ 1450/QĐ-TCT (NĐ 123/2020, TT 78/2021) with root `<HDon xmlns="http://hoadondientu.gdt.gov.vn/2021">`, `<DLHDon id="...">`, and mandatory child nodes `<TTChung>`, `<NDHDon>` (`<NBan>`, `<NMua>`, `<DSHangHoa>`, `<TToan>`), and `<DSCKS>`.
   - XML Escaping: `escapeXml()` safely converts `&` to `&amp;` first, followed by `<`, `>`, `"`, `'` to prevent double-escaping and XML injection attacks.
   - Vietnamese words conversion: `numberToWordsVietnamese()` implements real mathematical 3-digit triple decomposition with correct grammatical nuances (`mười`, `mươi`, `mốt`, `lăm`, `lẻ`, `không trăm`) and scales up to `triệu tỷ`. Verified across inputs 0, 5, 10, 15, 21, 25, 100, 105, 115, 1000, 1005, 756000, 1000000, 1500000000, and negative numbers with 100% accuracy.
   - Cancelled Invoice Invariant: Lines 159-161 throw `Error('Hóa đơn đã bị hủy, không thể xuất XML')` when `invoice.status === 'CANCELLED'`.

4. **Code Inspection — `src/lib/integrations/einvoice-signer.ts`**:
   - Zero external network dependencies: Uses only Node.js native `crypto`.
   - Generates deterministic SHA-256 payload digests, base64 digital signatures, and standard lookup codes (`UD-YYYY-XXXXXXX`).
   - Supports provider routing (`MOCK_VNPT`, `MOCK_VIETTEL`, `mock`) with appropriate Root CA certificate issuer metadata.
   - Rejects unsupported providers with explicit HTTP 400 error.
   - Zero hardcoded secrets or API key leakage.

5. **Code Inspection — Endpoints**:
   - `GET /api/sales-invoices/[id]/xml`:
     - Checks `invoice.status === 'CANCELLED'`, returning HTTP 400 (`{ error: "Hóa đơn đã bị hủy, không thể xuất XML" }`).
     - Returns HTTP 404 for non-existent IDs.
     - Reads seller settings dynamically from `AppSetting` via `getSettings()`.
     - Injects existing digital signature from `db.ledgerEntry` into `<DSCKS><NBan><KSCKS>` if previously signed.
     - Sets headers: `Content-Type: application/xml; charset=utf-8`, `Content-Disposition: attachment; filename="${invoice.code}.xml"`, `Cache-Control: no-store`.
   - `POST /api/sales-invoices/[id]/sign`:
     - Rejects cancelled invoices with HTTP 400 (`{ error: "Không thể ký số hóa đơn đã bị hủy" }`).
     - Signs via mock adapter, appends lookup tag to `invoice.note`, and logs audit trail to `db.ledgerEntry` with realtime event dispatch.

6. **Code Inspection — UI `src/components/cms/views/sales-invoices-view.tsx`**:
   - Table rows display:
     - Digital signature badge: green `<ShieldCheck /> Đã ký số` with lookup code, or amber `Chưa ký số`, or muted `Không áp dụng` if cancelled.
     - Action buttons: "Tải XML" (downloads `.xml` file; disabled with warning if cancelled) and "Ký số" (with loader spinner while signing).
   - Detail Dialog/Drawer includes XML download, signature status, lookup code, and signing trigger.

7. **Integrity Audit**:
   - No hardcoded test results detected in source code.
   - No dummy/facade implementations.
   - Genuine number-to-words mathematical parser and standard XML generation.

---

## 2. Logic Chain

1. **Compliance with Regulatory Standards**:
   `ORIGINAL_REQUEST.md` requirement R3 specifies that VAT invoices must be exportable to XML compliant with QĐ 1450/QĐ-TCT, NĐ 123/2020, and TT 78/2021. Verification of the generated XML confirms the exact presence of all 7 mandatory root structure tags (`<HDon>`, `<DLHDon>`, `<TTChung>`, `<NBan>`, `<NMua>`, `<DSHangHoa>`, `<TToan>`) alongside correct namespace and metadata (`<KHMSHDon>`, `<KHHDon>`, `<SHDon>`, `<NLap>`).

2. **Security & Data Integrity**:
   Direct stress-testing confirms that XML injection payloads (e.g. `<script>`, quotes, and ampersands) in customer names or product titles are cleanly neutralized via `escapeXml()`. Furthermore, cancelled invoices are strictly blocked from both XML export and digital signing, satisfying all business integrity requirements.

3. **External Mocking & Isolation (R6)**:
   The digital signing adapter `einvoice-signer.ts` relies exclusively on `node:crypto` to generate SHA-256 signatures, lookup codes, and simulated CA certificate metadata. No external network requests occur, fulfilling R6 and ensuring safe local operation in dev and test environments.

4. **Zero Regressions**:
   Running the full regression suite (`test:chain` and `test:scenarios`) verifies that the ledger chain remains monotonic and all 21 system workflows continue to pass without regression.

---

## 3. Caveats

1. The default seller information (`DEFAULT_SELLER` in `src/lib/einvoice.ts`) serves as a robust fallback if store credentials are not configured in `AppSetting`. For live production operations, the merchant should ensure their official business name and Tax Code are entered in Settings.
2. In mock mode, the digital signature is cryptographically simulated. When live certificates from VNPT/Viettel CA are configured, the adapter's clean abstraction structure allows immediate insertion of production HTTP endpoints without UI or database schema changes.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone M4 (VAT E-Invoice XML & Mock Signer - R3) is implemented with high quality, rigorous mathematical parsing, strict regulatory compliance, complete UI integration, zero integrity violations, and 100% test pass rates across all quality gates.

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. Run the R3 verification test suite:
   ```powershell
   node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts
   ```
   *Expected*: `KẾT QUẢ SUITE R3: 11 PASS, 0 FAIL`.

2. Run TypeScript and ESLint checks:
   ```powershell
   npx tsc --noEmit
   npm run lint
   ```
   *Expected*: 0 errors, 0 warnings.

3. Run ledger chain and end-to-end scenario regressions:
   ```powershell
   npm run test:chain
   npm run test:scenarios
   ```
   *Expected*: Stock ledger chain valid; 21/21 scenarios pass.

4. Run production build:
   ```powershell
   npm run build
   ```
   *Expected*: Clean Turbopack compilation with static page optimization.
