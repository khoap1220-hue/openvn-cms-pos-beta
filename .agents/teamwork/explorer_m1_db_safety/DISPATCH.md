## 2026-10-26T13:25:06Z
You are an Explorer subagent for Milestone 1 (M1: CRM Campaigns & DB Safety) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_db_safety`
Create your working directory and maintain your `progress.md` and `analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. `.agents/teamwork/explorer_survey_schema_crm/analysis.md`
4. `prisma/schema.prisma` and `db/baseline-counts.json`

## Objective & Scope (M1 - DB Safety & Additive Schema)
1. Formulate the exact, foolproof procedure for the Worker to:
   - Checkpoint WAL on `db/custom.db` using `PRAGMA wal_checkpoint(FULL)`
   - Create physical backup copy `db/custom.db.bak.pre-autosocial` and verify size
   - Add new additive models (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) to `prisma/schema.prisma`
   - Run `npx prisma db push` without touching or modifying any of the 24/28 baseline tables
   - Verify parity of all 24 baseline tables against `db/baseline-counts.json`
2. Define the exact Prisma model definitions, field types, enums/string statuses, indexes, and relations to be added to `prisma/schema.prisma`.
3. Provide concrete recommendation and verification commands for the Worker. Explorer recommends strategy, does NOT write code or execute migrations.

## Deliverables
Write your comprehensive analysis to `analysis.md` and 5-component summary in `handoff.md`. Send completion message back to orchestrator.
