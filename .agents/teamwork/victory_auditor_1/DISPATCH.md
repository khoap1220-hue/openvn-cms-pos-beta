# Dispatch Instructions — victory_auditor_1

## Identity & Role
- **Agent Name**: `victory_auditor_1`
- **Archetype**: `teamwork_preview_victory_auditor`
- **Working Directory**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\victory_auditor_1`
- **Parent**: Project Sentinel (`b36dc7b8-ca96-43c2-87d5-ebb7b2b82100`)

## Authoritative User Request
- **ORIGINAL_REQUEST.md**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md`

## Mission
Conduct an independent, adversarial 3-phase post-victory audit (timeline audit, anti-cheating/facade detection, independent test execution) on the OPENVN · Ưu Đàm Suite project.
Zero shared context with the implementation swarm. Your verdict is BLOCKING.
Deliver a structured final verdict: **VICTORY CONFIRMED** or **VICTORY REJECTED**.

## 2026-10-26T12:34:18Z
You are victory_auditor_1 (Post-Victory Auditor).
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\victory_auditor_1

Read ORIGINAL_REQUEST.md at:
y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md

The team has claimed victory on OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite).
You must conduct an independent, adversarial 3-phase post-victory audit:
1. Timeline verification: inspect project git commit history, timestamps, gate approvals across M1-M7.
2. Anti-cheating & facade detection: audit code for hardcoded outputs, fake mocks, dummy test returns, unintegrated views. Check that src/components/cms/views/sales-view.tsx retains full barcode, multi-row, partner, print A4/VietQR, cancel, and lineage capabilities alongside VAT XML download and digital signing.
3. Independent test execution:
   - Run `node --experimental-strip-types scripts/verify-e2e-suite.ts` (all 7 suites must pass).
   - Run `npx tsc --noEmit` (0 errors).
   - Run `npm run lint` (0 errors, 0 warnings).
   - Run `npm run test:chain` (ledger monotonicity 100% valid).
   - Run `npm run test:scenarios` (21/21 scenarios pass).
   - Run `npm run build` (Turbopack build must succeed code 0).
   - Verify CSDL baseline counts against `db/baseline-counts.json` (Voucher must be strictly 4, Order strictly 173, zero residue).
   - Verify UI inspection screenshots in `.agents/teamwork/ui-audit/` (0 console error, 0 overflow at 390px).
   - Verify the 3 Sentinel topics: (1) 6 vs 7 deleted test vouchers, (2) ESC/POS Vietnamese ASCII stripping vs UTF-8 window.print, (3) 171 vs 173 baseline orders.
   - Verify that all release documentation (`docs/FEATURE_EXPERIENCE_MATRIX.md`, `docs/RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md`, R1 defect audit table) is fully updated.

Deliver your structured final verdict:
VICTORY CONFIRMED or VICTORY REJECTED.
Send your verdict and full audit report back to Sentinel via send_message.
