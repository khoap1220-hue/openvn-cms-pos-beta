## 2026-10-26T11:50:27Z

You are worker_m7_r2 (Teamwork Worker).
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_r2
Read ORIGINAL_REQUEST.md at: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
Also read reviewer_m7's feedback at: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_m7\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A forensic auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

TASK OBJECTIVE (Milestone M7 Remediation):
Reviewer reviewer_m7 identified a UI integration gap in `src/app/page.tsx`:
Currently lines 45 & 382 import and render legacy `SalesView` (`@/components/cms/views/sales-view`) instead of `SalesInvoicesView` (`@/components/cms/views/sales-invoices-view`).
As a result, the live CMS user interface at `activeView === 'sales'` lacks the VAT XML download button and digital signature status badge implemented in Milestone M4.

STEPS TO EXECUTE:
1. In `src/app/page.tsx`:
   Replace:
   `import { SalesView } from '@/components/cms/views/sales-view'`
   With:
   `import { SalesInvoicesView as SalesView } from '@/components/cms/views/sales-invoices-view'`
   (Or import `SalesInvoicesView` and render `{activeView === 'sales' && <SalesInvoicesView />}`).
2. Verify quality gates:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts`
   - `node --experimental-strip-types scripts/verify-e2e-suite.ts`
3. Verify that database table counts remain 100% matched to baseline (`check-counts.mjs`), with Voucher = 4 and Order = 173.

Write your report to:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_r2\handoff.md`

When done, message back with your report path and summary.
