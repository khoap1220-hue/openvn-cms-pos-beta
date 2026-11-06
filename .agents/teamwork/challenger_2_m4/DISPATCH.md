## 2026-10-26T15:58:38Z
You are Challenger 2 for Milestone 4 (Boundary & Campaign Lifecycle Challenger).

Read:
- `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4_scheduler\handoff.md`
- `src/lib/social-scheduler.ts`
- `src/lib/campaign-service.ts`

Your task:
1. Adversarially challenge the Campaign Status Gate:
   - What happens if a campaign was active when the post was scheduled, but by the time publishing runs, the campaign has expired (`endDate` in the past) or was cancelled?
   - Write and run an adversarial test verifying that the post is immediately rejected, transitioned to `REJECTED`, `approvalNote` contains explanation, `AuditLog` records rejection, and 0 external publish calls are made.
2. Adversarially test corrupted state recovery:
   - A post marked `APPROVED` but with `approvedAt: null`.
   - A post marked `SCHEDULED` but with `scheduledAt: null`.
   - A post that crashed mid-publish (simulated hung `isPublishing: true`) and verify retry behavior.
3. Clean up all test data and verify `node scripts/check-counts.mjs` returns 100% MATCH (Delta = 0).
4. Issue verdict: APPROVE or REQUEST_CHANGES.

Write your report to:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\challenger_2_m4\handoff.md`
and send a message with your findings.
