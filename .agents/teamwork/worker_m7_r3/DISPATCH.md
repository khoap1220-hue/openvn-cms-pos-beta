## 2026-10-26T11:58:27Z
You are worker_m7_r3 (Teamwork Worker).
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_r3
Read ORIGINAL_REQUEST.md at: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

URGENT TASK DIRECTIVE FROM SENTINEL:
We must ensure 100% zero functional regression on the Sales Invoices view in `src/app/page.tsx`:
1. `src/components/cms/views/sales-view.tsx` already contains complete, rich sales features:
   - Barcode scanning (`handleBarcodeScan`, 6 barcode references)
   - Multi-row invoice drafting (`addRow`, `removeRow`, `updateRow`, `selectProduct`)
   - Partner selection
   - A4 / VietQR print dialog (`InvoicePrintDialog`)
   - Cancellation with atomic restock
   - Data lineage inspector (`LineageInspectorDialog`)
2. `src/components/cms/views/sales-invoices-view.tsx` contains the R3 VAT E-Invoice XML export button and digital signature badge/signing actions.
3. YOUR MISSION:
   a) Integrate the VAT XML Export button and Digital Signature badge/signing action directly into `src/components/cms/views/sales-view.tsx`:
      - Add `isInvoiceSigned(invoice)` and `getInvoiceLookupCode(invoice)` helper functions.
      - Add `downloadXml(inv)` handler calling `GET /api/sales-invoices/[id]/xml`.
      - Add `handleSign(inv)` handler calling `POST /api/sales-invoices/[id]/sign`.
      - In the invoices table (and in the invoice details modal), add:
        * Digital signature badge: `<Badge variant="outline" className="border-emerald-500 text-emerald-700 bg-emerald-50">Đã ký số</Badge>` when signed, or `<Badge variant="outline" className="text-amber-700 bg-amber-50">Chưa ký số</Badge>` when unsigned.
        * "Tải XML" button: `<Button variant="outline" size="sm" onClick={() => downloadXml(inv)} disabled={inv.status === 'CANCELLED'}>Tải XML</Button>`
        * "Ký số hóa đơn" button in detail modal when unsigned: `<Button onClick={() => void handleSign(detail)}>Ký số (Mock)</Button>`.
      - Make sure all imports (`FileCode`, `ShieldCheck`, etc.) are cleanly imported.
   b) In `src/app/page.tsx`:
      Restore the mount:
      Line 45: `import { SalesView } from '@/components/cms/views/sales-view'`
      Line 382: `{activeView === 'sales' && <SalesView />}`
   c) Run and verify:
      - `npx tsc --noEmit` (0 errors)
      - `npm run lint` (0 errors, 0 warnings)
      - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts` (11/11 pass)
      - `node --experimental-strip-types scripts/verify-e2e-suite.ts` (7/7 pass)
      - `node .agents/teamwork/auditor_m6/check-counts.mjs` (24/24 core tables match, Voucher = 4, Order = 173).
