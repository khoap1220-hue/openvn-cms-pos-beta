# Handoff Report — Milestone M4 (VAT E-Invoice XML & Mock Signer - R3)

## 1. Observation
- **Baseline Run (`scripts/verify-r3-einvoice-xml.ts`)**:
  Executing `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts` before implementation failed with 9 errors:
  ```
  ❌ [FAIL] F09-Tier1-XmlEndpointStatus: GET /api/sales-invoices/[id]/xml trả về HTTP 200 (nhận 404)
  ❌ [FAIL] F09-Tier1-XmlContentType: Header Content-Type là XML: "text/html; charset=utf-8"
  ❌ [FAIL] F09-Tier1-MandatoryXmlElements: Đầy đủ 7 thẻ cấu trúc gốc bắt buộc (<HDon>, <DLHDon>, <TTChung>, <NBan>, <NMua>, <DSHangHoa>, <TToan>)
  ❌ [FAIL] F09-Tier1-InvoiceMetadataElements: Có đầy đủ Ký hiệu mẫu số (<KHMSHDon>), Ký hiệu (<KHHDon>), Số hóa đơn (<SHDon>), Ngày lập (<NLap>)
  ❌ [FAIL] F09-Tier1-BuyerTaxCodePreserved: Mã số thuế người mua (0109998888) được ghi nhận chính xác trong thẻ <NMua>
  ❌ [FAIL] F09-Tier1-XmlTotalAmountMatches: Tổng tiền bằng số <TgTTTBSo> khớp đúng hóa đơn: -1 === 756000
  ❌ [FAIL] F09-Tier1-XmlTotalAmountInWords: Tổng tiền bằng chữ <TgTTTBChu> hợp lệ: ""
  ❌ [FAIL] F09-Tier2-XmlSpecialCharsEscaping: Ký tự đặc biệt (&, <, >) trong tên sản phẩm/khách hàng được escape hợp lệ
  ❌ [FAIL] F09-Tier2-CancelledInvoiceXmlForbidden: Hóa đơn đã hủy bị chặn xuất XML với mã lỗi HTTP 400 (nhận 404)
  KẾT QUẢ SUITE R3: 2 PASS, 9 FAIL
  ```
- **Files Owned & Created**:
  1. `src/lib/einvoice.ts`:
     - `numberToWordsVietnamese(inputNum: number): string` generating natural Vietnamese currency reading (e.g. 150000 -> "Một trăm năm mươi nghìn đồng chẵn", 756000 -> "Bảy trăm năm mươi sáu nghìn đồng chẵn", 0 -> "Không đồng").
     - `escapeXml(unsafe: string | null | undefined): string` safely converting `&`, `<`, `>`, `"`, `'`.
     - `generateInvoiceXml(invoice: EInvoiceData, seller?: SellerInfo): string` strictly adhering to QĐ 1450/QĐ-TCT (NĐ 123/2020, TT 78/2021) with root structure `<HDon><DLHDon id="...">...<NDHDon><NBan>...<NMua>...<DSHangHoa>...<TToan>...</NDHDon></DLHDon><DSCKS>...</DSCKS></HDon>`.
     - Guards against exporting cancelled invoices by throwing `Error('Hóa đơn đã bị hủy, không thể xuất XML')`.
  2. `src/lib/integrations/einvoice-signer.ts`:
     - Digital signing adapter supporting `'mock'`, `'vnpt'`, `'viettel'`, `'MOCK_VNPT'`, `'MOCK_VIETTEL'`.
     - Generates deterministic SHA-256 digital signature hashes, provider certificates (Subject, Issuer, Serial), lookup code, and signedAt timestamp with zero external network dependencies and zero key leakage.
  3. `src/app/api/sales-invoices/[id]/xml/route.ts`:
     - GET handler returning XML with `Content-Type: application/xml; charset=utf-8`.
     - Returns HTTP 404 when invoice does not exist.
     - Returns HTTP 400 when invoice status is `CANCELLED` (`{ error: "Hóa đơn đã bị hủy, không thể xuất XML" }`).
  4. `src/app/api/sales-invoices/[id]/sign/route.ts`:
     - POST handler executing signing adapter, updating invoice note metadata (`[KÝ SỐ: ... | Tra cứu: ... | Ký: ...]`), and writing audit trail to `db.ledgerEntry`.
     - Returns HTTP 400 if invoice is cancelled.
  5. `src/components/cms/views/sales-invoices-view.tsx`:
     - "Tải XML" button on each invoice row and inside detail drawer (downloads `.xml` file; displays warning if cancelled).
     - Digital signature badge: green "Đã ký số" with lookup code if signed; amber "Chưa ký số" if unsigned.
     - "Ký số" action button on rows and inside drawer calling `/api/sales-invoices/[id]/sign`.
- **Final Verification Commands Output**:
  - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts`:
    `KẾT QUẢ SUITE R3: 11 PASS, 0 FAIL` (100% pass)
  - `npx tsc --noEmit`: 0 errors
  - `npm run lint`: 0 errors, 0 warnings
  - `npm run test:chain`: Monotonic stock ledger 100% pass
  - `npm run test:scenarios`: 21/21 scenarios pass
  - `npm run build`: Compiles successfully with Turbopack, standalone assets copied cleanly

## 2. Logic Chain
1. In `scripts/verify-r3-einvoice-xml.ts`, line 161, a GET request is issued to `/api/sales-invoices/${salesInvoice.id}/xml`. With `src/app/api/sales-invoices/[id]/xml/route.ts` implemented, it resolves the invoice with its partner and items, applies seller settings from AppSetting, invokes `generateInvoiceXml()`, and streams back XML with `Content-Type: application/xml; charset=utf-8`, satisfying `F09-Tier1-XmlEndpointStatus` and `F09-Tier1-XmlContentType`.
2. The generated XML structure contains all 7 mandatory QĐ 1450 tags (`<HDon>`, `<DLHDon>`, `<TTChung>`, `<NBan>`, `<NMua>`, `<DSHangHoa>`, `<TToan>`) alongside `<KHMSHDon>`, `<KHHDon>`, `<SHDon>`, `<NLap>`. All special characters (such as `&` in product names and `<HN>` in company names) are converted to XML entities (`&amp;`, `&lt;HN&gt;`), fulfilling assertions `F09-Tier1-MandatoryXmlElements`, `F09-Tier1-InvoiceMetadataElements`, and `F09-Tier2-XmlSpecialCharsEscaping`.
3. In `src/lib/einvoice.ts`, `numberToWordsVietnamese` converts `invoice.total` (e.g. 756000) into "Bảy trăm năm mươi sáu nghìn đồng chẵn", matching the regex `/<TgTTTBChu>([^<]+)<\/TgTTTBChu>/i` and preserving `salesInvoice.total` in `<TgTTTBSo>`, fulfilling `F09-Tier1-XmlTotalAmountMatches` and `F09-Tier1-XmlTotalAmountInWords`.
4. In `src/app/api/sales-invoices/[id]/xml/route.ts`, if `invoice.status === 'CANCELLED'`, the route responds with HTTP 400. In `scripts/verify-r3-einvoice-xml.ts` line 258, when the invoice is cancelled and re-requested, the server returns 400, fulfilling `F09-Tier2-CancelledInvoiceXmlForbidden`.
5. In `src/lib/integrations/einvoice-signer.ts` and `src/app/api/sales-invoices/[id]/sign/route.ts`, the mock adapter signs the invoice with cryptographic hash digests and certificate metadata without any outbound network calls. Line 288 of `verify-r3-einvoice-xml.ts` confirms HTTP 200 with `success: true` and `signature`, fulfilling `F10-Tier1-MockSigningSuccess`.
6. Running `npm run verify` and `npm run build` confirms full end-to-end compatibility with zero regressions across `test:chain` and `test:scenarios`.

## 3. Caveats
- No caveats. The mock signing provider operates 100% locally in isolated mock mode when external credentials are absent, complying strictly with R6.

## 4. Conclusion
Milestone M4 (VAT E-Invoice XML QĐ 1450 & Mock Digital Signer - R3) is fully implemented, verified, and complete. All 11 checks in `verify-r3-einvoice-xml.ts` pass, `tsc` and `lint` report 0 errors, `test:chain` and `test:scenarios` pass with 0 regressions, and `npm run build` completes cleanly.

## 5. Verification Method
To independently verify this milestone, run:
1. `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts` (Asserts 11/11 PASS)
2. `npx tsc --noEmit` (Asserts 0 errors)
3. `npm run lint` (Asserts 0 errors, 0 warnings)
4. `npm run test:chain` (Asserts monotonic ledger chain consistency)
5. `npm run test:scenarios` (Asserts 21/21 scenarios pass)
6. `npm run build` (Asserts clean Next.js 16 production build)
