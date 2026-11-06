## 2026-10-26T13:10:00Z
You are a Specification Miner subagent for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_requirements`
Create your working directory and maintain your `progress.md` and `spec_analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `MATRIX_HANDOFF.md`
3. `docs/FEATURE_EXPERIENCE_MATRIX.md`
4. `docs/UX_UI_FLOW.md`
5. `docs/OPERATIONS_RUNBOOK.md`
6. `docs/RELEASE_CHECKLIST.md`
7. `AGENTS.md`

## Objective
Extract, document, and formalize all requirements for the AUTO SOCIAL module:
1. Enumerate R1 to R7 in detail:
   - R1: CRM Campaigns (fields, validation, state machine, product/voucher associations).
   - R2: Public Google Drive Content Source (URL parsing, file enumeration, caching, error modes).
   - R3: AI Planning & Copywriting (calendar, platform limits, tone of Ưu Đàm, rubric evaluation 8/10+).
   - R4: Post Review & Scheduling (owner approval lifecycle, scheduling execution, retry policy).
   - R5: 7-Platform Publishing (FB, Zalo OA, Website Blog, WP/Haravan/Sapo, IG, TikTok, Threads, mock vs real credentials).
   - R6: Test & Operational Safety (zero real API calls in tests, mock payload validation, no secrets leaked).
   - R7: Zero Regression & DB Safety (backup `db/custom.db`, build/verify 0 errors/0 warnings, responsive UI desktop + 390px mobile).
2. Construct a comprehensive Feature Inventory table mapping every requirement to acceptance criteria, boundary conditions, and test tiers.

## Deliverables
Write your full specification analysis to `spec_analysis.md` and provide a concise summary in `handoff.md` in your working directory.
Send a completion message back to the orchestrator when finished.
