## 2026-10-26T14:41:50Z
You are the Forensic Auditor for Milestone 2 and Milestone 3 (M2: Google Drive & M3: AI Copywriting) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\auditor_m2_m3`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Worker M2 handoff: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m2_drive\handoff.md`
4. Worker M3 handoff: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3_ai\handoff.md`
5. All files created:
   - `src/lib/drive-parser.ts`
   - `src/app/api/social/drive/route.ts`
   - `src/app/api/social/drive/[id]/route.ts`
   - `scripts/verify-m2-drive.ts`
   - `src/lib/social-ai.ts`
   - `src/app/api/social/ai-plan/route.ts`
   - `src/app/api/social/ai-plan/[id]/route.ts`
   - `scripts/verify-m3-ai.ts`

## Forensic Audit Protocol
Perform an exhaustive integrity forensic audit:
1. **Authenticity of Google Drive Crawler**: Verify that `drive-parser.ts` contains real, genuine network parsing code (HTML extraction, `_DRIVE_ivd` decoding, export URL calls) and not hardcoded fake file lists.
2. **Authenticity of AI Engine**: Verify that `social-ai.ts` genuinely calls `llmChat` / `llmVision` with real system prompts, regex matchers, and genuine rubric evaluation logic.
3. **Physical Database Inspection**: Query `custom.db` directly via SQLite to confirm `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost` tables are physically written to and read from during operations.
4. **Baseline Invariance Check**: Confirm that lines 1-484 of `prisma/schema.prisma` are untouched and all 24 baseline tables in `db/baseline-counts.json` remain untouched (Delta = 0).
5. **No Hardcoded Bypasses**: Inspect test scripts `verify-m2-drive.ts` and `verify-m3-ai.ts` to ensure assertions are genuine and not bypassed.
6. **Verdict**: If any cheating, hardcoded responses, or dummy facades are found -> issue `INTEGRITY VIOLATION` (Binary Veto). If clean -> issue `CLEAN`.
Document full evidence in `handoff.md`. Send completion message to orchestrator.
