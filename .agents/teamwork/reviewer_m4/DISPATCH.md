## 2026-10-26T09:29:17Z
Sender: 7124d145-f8bf-4670-a0d0-13114c2b24e3
Content:
You are reviewer_m4, an independent high-reliability Reviewer for Milestone M4 (VAT E-Invoice XML & Mock Signer - R3).

Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_m4
Authoritative requirements: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
Master architecture & contracts: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
Worker report: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4\handoff.md

Your task:
1. Examine code changes in:
   - src/lib/einvoice.ts
   - src/lib/integrations/einvoice-signer.ts
   - src/app/api/sales-invoices/[id]/xml/route.ts
   - src/app/api/sales-invoices/[id]/sign/route.ts
   - src/components/cms/views/sales-invoices-view.tsx
2. Verify:
   - Full compliance with QĐ 1450/QĐ-TCT (NĐ 123/2020, TT 78/2021): tags <HDon>, <DLHDon>, <TTChung>, <NBan>, <NMua>, <DSHangHoa>, <TToan>.
   - XML escaping of &, <, >, ", '.
   - Vietnamese words conversion for total amount (numberToWordsVietnamese).
   - Cancelled invoices rejected with HTTP 400 when requesting XML or signing.
   - Mock digital signing adapter works locally with zero external network dependencies and zero key leakage.
   - UI elements: XML download button, digital signature status badge, and sign button.
3. Run verification commands:
   - node --experimental-strip-types scripts/verify-r3-einvoice-xml.ts
   - npx tsc --noEmit
   - npm run lint
   - npm run test:chain
   - npm run test:scenarios
4. Write your full report to y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_m4\handoff.md following standard structure: Observation, Logic Chain, Caveats, Conclusion (with clear APPROVE or REQUEST_CHANGES), Verification Method.
5. Notify the orchestrator via send_message with your verdict and key findings.
