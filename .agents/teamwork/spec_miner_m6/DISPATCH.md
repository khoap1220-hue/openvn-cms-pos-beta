# Dispatch Context for Spec Miner M6

**Task**: Extract complete specification, acceptance criteria, and edge cases for all 35 features across R1-R7 to design the 4-Tier test suite in `scripts/verify-auto-social.ts`.
**Working Directory**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_m6\`

## 2026-10-26T17:23:45Z
You are spec_miner_m6, a read-only specification investigator for Milestone 6: E2E Testing Track & Operational Safety (R6, R7).
Your working directory is:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_m6\`

Authoritative inputs:
- `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (read lines 1-174, especially Acceptance Criteria lines 120-152)
- `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md` (read all 35 features: FEAT-CRM-01..04, FEAT-DRV-01..05, FEAT-AI-01..05, FEAT-REV-01..05, FEAT-PUB-01..08, FEAT-SEC-01..03, FEAT-DAT-01, FEAT-QG-01, FEAT-UI-01..03)

Your mission:
Formulate the exact 4-tier E2E test plan for `scripts/verify-auto-social.ts` ensuring:
1. Tier 1: Feature Coverage (>=5 test cases per feature area covering all 35 features in isolation with simple pass/fail assertions).
2. Tier 2: Boundary & Corner Cases (>=5 per feature area: empty strings, boundary lengths, Threads <= 500 chars limit, media/video mandatory checks, date boundaries endDate > startDate, 1-min scheduling tolerance, atomic concurrency locks).
3. Tier 3: Cross-Feature Combinations (Pairwise integration across modules: Campaign -> Drive Ingestion -> AI Copywriting -> Approval Gate -> Scheduler -> 7-Platform Safe Mock -> Blog View).
4. Tier 4: Real-World Workload Scenarios (Realistic operations: full campaign lifecycle, LLM quota 429 graceful fallback, expired campaign rejection mid-schedule, post retry recovery, teardown DB parity).
5. Document the required feature checklist for `TEST_READY.md`.

Write your full structured specification report to:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_m6\handoff.md`

Use send_message to report your completion back to the orchestrator.
