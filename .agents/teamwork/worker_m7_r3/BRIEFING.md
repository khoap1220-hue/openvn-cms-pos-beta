# BRIEFING — 2026-10-26T12:00:00Z

## Mission
Integrate VAT XML Export button and Digital Signature badge/signing actions into `sales-view.tsx`, restore `SalesView` mount in `src/app/page.tsx`, and verify zero functional regressions across tsc, lint, e-invoice xml test, e2e suite, and baseline database check.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_r3
- Original parent: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Milestone: M7-R3 (Zero Regression Sales View Integration)

## 🔒 Key Constraints
- Zero functional regression: keep all sales-view.tsx features (barcode scan, multi-row drafting, partner selection, A4/VietQR print dialog, atomic cancellation restock, lineage inspector).
- Integrate VAT XML download and Digital Signature signing/badges cleanly.
- Keep DB counts baseline untouched.
- Comply with all lint and typescript strict checks.

## Current Parent
- Conversation ID: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Updated: 2026-10-26T12:00:00Z

## Task Summary
- **What to build**: Integrate VAT E-Invoice XML export + Digital Signature into `src/components/cms/views/sales-view.tsx`, rewire `src/app/page.tsx` to mount `SalesView`.
- **Success criteria**:
  - `npx tsc --noEmit` pass (0 errors)
  - `npm run lint` pass (0 errors, 0 warnings)
  - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts` pass (11/11)
  - `node --experimental-strip-types scripts/verify-e2e-suite.ts` pass (7/7)
  - `node .agents/teamwork/auditor_m6/check-counts.mjs` pass (24/24 core tables match, Voucher = 4, Order = 173)
- **Interface contracts**: API routes `/api/sales-invoices/[id]/xml` and `/api/sales-invoices/[id]/sign`.

## Change Tracker
- **Files modified**:
  - `src/components/cms/views/sales-view.tsx`: Added `isInvoiceSigned`, `getInvoiceLookupCode`, `downloadXml`, `handleSign`, digital signature badge, Tải XML button, Ký số button (table & modal), and re-exports.
  - `src/app/page.tsx`: Rewired lines 45 & 382 to mount `SalesView`.
  - `docs/FEATURE_EXPERIENCE_MATRIX.md`: Aligned reference for sales view.
- **Build status**: `npx tsc --noEmit` PASS (0 errors), `npm run lint` PASS (0 errors, 0 warnings).
- **Pending issues**: None. All acceptance tests passing.

## Quality Status
- **Build/test result**:
  - `npx tsc --noEmit`: PASS (0 errors)
  - `npm run lint`: PASS (0 errors, 0 warnings)
  - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts`: PASS (11/11)
  - `node --experimental-strip-types scripts/verify-e2e-suite.ts`: PASS (7/7)
  - `node .agents/teamwork/auditor_m6/check-counts.mjs`: PASS (24/24 core tables match, Voucher = 4, Order = 173)
- **Lint status**: 0 errors, 0 warnings
- **Tests added/modified**: Existing suites re-executed and 100% passing.

## Loaded Skills
- None required directly for this specific view integration.

## Key Decisions Made
- Enhanced `sales-view.tsx` with VAT XML and digital signing capabilities while maintaining 100% of rich sales features (barcode scanning, multi-row drafting, partner selection, A4/VietQR print dialog, atomic cancellation restock, and lineage inspector).
- Restored `SalesView` mount in `src/app/page.tsx`.

## Artifact Index
- `.agents/teamwork/worker_m7_r3/DISPATCH.md` — assignment
- `.agents/teamwork/worker_m7_r3/BRIEFING.md` — persistent memory
- `.agents/teamwork/worker_m7_r3/progress.md` — heartbeat and progress
- `.agents/teamwork/worker_m7_r3/handoff.md` — final handoff report
