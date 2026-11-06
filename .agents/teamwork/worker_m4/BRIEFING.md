# BRIEFING — 2026-10-26T09:25:00Z

## Mission
Implement VAT E-Invoice XML export (QĐ 1450/TT 78/NĐ 123) and Digital Mock Signer (Milestone M4 / R3) for Ưu Đàm Suite.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4
- Original parent: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Milestone: M4 - VAT E-Invoice XML & Mock Signer (R3)

## 🔒 Key Constraints
- File ownership:
  - src/lib/einvoice.ts
  - src/lib/integrations/einvoice-signer.ts
  - src/app/api/sales-invoices/[id]/xml/route.ts
  - src/app/api/sales-invoices/[id]/sign/route.ts
  - src/components/cms/views/sales-invoices-view.tsx
- Conformance to QĐ 1450/QĐ-TCT (NĐ 123/2020, TT 78/2021).
- Escaping special chars (&, <, >, ", ').
- Refuse XML export if CANCELLED (HTTP 400).
- Mock signing adapter supporting mock, vnpt, viettel (default mock, zero real network calls, zero key leaks).
- Real logic only, no hardcoding, no cheating.
- Verification commands must all pass:
  - node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts
  - npx tsc --noEmit
  - npm run lint
  - npm run test:chain
  - npm run test:scenarios
  - npm run build

## Current Parent
- Conversation ID: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Updated: 2026-10-26T09:10:26Z

## Task Summary
- **What to build**: Vietnamese numberToWords, XML generator for VAT invoices, signer adapter, XML & sign API endpoints, CMS UI buttons & badges.
- **Success criteria**: All verify scripts, tsc, lint, tests, build pass 100%.
- **Interface contracts**: PROJECT.md, scripts/verify-r3-einvoice-xml.ts, TEST_READY.md
- **Code layout**: Next.js App Router, src/lib, src/app/api, src/components/cms

## Key Decisions Made
- Implemented `numberToWordsVietnamese` in `src/lib/einvoice.ts` producing grammatical, natural Vietnamese reading of currency (e.g. 150,000 -> "Một trăm năm mươi nghìn đồng chẵn").
- Built `generateInvoiceXml` conforming to QĐ 1450/QĐ-TCT with 7 required root elements (<HDon>, <DLHDon>, <TTChung>, <NBan>, <NMua>, <DSHangHoa>, <TToan>, <DSCKS>).
- Implemented XML escaping preserving buyer/product special chars safely (&amp;, &lt;, &gt;, &quot;, &apos;).
- Built mock digital signer in `src/lib/integrations/einvoice-signer.ts` with SHA-256 hash digests, mock cert metadata, serial number, and lookup code with zero external network traffic.
- Built XML endpoint `src/app/api/sales-invoices/[id]/xml/route.ts` with Content-Type `application/xml; charset=utf-8` and CANCELLED guard returning HTTP 400.
- Built signing endpoint `src/app/api/sales-invoices/[id]/sign/route.ts` updating note metadata and logging to LedgerEntry.
- Built `src/components/cms/views/sales-invoices-view.tsx` featuring row/detail XML download, digital signature status badge, and 1-click signing action.

## Artifact Index
- .agents/teamwork/worker_m4/DISPATCH.md — Assignment
- .agents/teamwork/worker_m4/BRIEFING.md — Memory index
- .agents/teamwork/worker_m4/progress.md — Liveness tracker
- .agents/teamwork/worker_m4/handoff.md — 5-Component handoff report

## Change Tracker
- **Files modified**:
  - `src/lib/einvoice.ts`: New file. QĐ 1450 XML generator, XML escaping, Vietnamese amount in words.
  - `src/lib/integrations/einvoice-signer.ts`: New file. Digital signing adapter (VNPT, Viettel, Mock).
  - `src/app/api/sales-invoices/[id]/xml/route.ts`: New file. GET handler returning XML with CANCELLED guard.
  - `src/app/api/sales-invoices/[id]/sign/route.ts`: New file. POST handler signing invoice and logging to ledger.
  - `src/components/cms/views/sales-invoices-view.tsx`: New file. CMS view with XML download, digital signature badge, and signing.
- **Build status**: PASS (build, verify, test:chain, test:scenarios, tsc, lint all 100% pass)
- **Pending issues**: None

## Quality Status
- **Build/test result**: All 6 verification commands PASS 100%.
- **Lint status**: 0 errors, 0 warnings.
- **Tests added/modified**: `scripts/verify-r3-einvoice-xml.ts` verified with 11/11 tests passing.

## Loaded Skills
- None
