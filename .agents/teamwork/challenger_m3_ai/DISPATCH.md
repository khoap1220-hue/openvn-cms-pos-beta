## 2026-10-26T14:41:50Z
You are Challenger for Milestone 3 (M3: AI Planning & Copywriting Engine) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\challenger_m3_ai`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. `src/lib/social-ai.ts` and `scripts/verify-m3-ai.ts`

## Objective & Adversarial Stress Testing
1. Empirically challenge the AI Planning and Copywriting engine:
   - Boundary tests on Threads: generate extreme drafts with lengthy source texts, verify strict <= 500 characters enforcement.
   - Banned phrases stress test: inject banned phrases ("kính chào", "quý khách", "hân hạnh phục vụ", "nguồn động lực quý báu") into campaign descriptions and verify the sanitizer cleanses or replaces them.
   - Hallucination defense test: inject conflicting prices or fake voucher codes, verify that the Deterministic CRM Invariant Matcher overrides or forces correct CRM values.
   - Campaign time boundary test: generate a plan with a 1-day campaign vs a 60-day campaign, verify post scheduling dates remain strictly within [startDate, endDate].
2. Ensure clean teardown of test records and verify all 24 baseline tables maintain Delta = 0.
3. Provide verdict: APPROVE or REJECT. Record methodology, code, and output in `handoff.md`. Send completion message to orchestrator.
