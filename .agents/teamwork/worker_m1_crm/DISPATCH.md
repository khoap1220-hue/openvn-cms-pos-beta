## 2026-10-26T13:34:55Z
You are a Worker subagent for Milestone 1 (M1: CRM Campaigns & DB Safety) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m1_crm`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read Before Starting
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Explorer findings:
   - `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_db_safety\analysis.md`
   - `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_campaign_api\analysis.md`
   - `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_crm_integration\analysis.md`
4. `AGENTS.md` (Crucial: Next.js 16 breaking changes; check `node_modules/next/dist/docs/` before writing any Next.js code)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership (Exclusively Owned Files)
You own and may create or modify ONLY these files:
- `scripts/backup-pre-autosocial.mjs`
- `prisma/schema.prisma` (lines 486+ for additive models ONLY; DO NOT modify any existing 28 models)
- `src/lib/campaign-service.ts`
- `src/app/api/campaigns/route.ts`
- `src/app/api/campaigns/[id]/route.ts`
- `scripts/verify-m1-campaigns.ts`

## Tasks to Implement
1. **DB Safety Backup**: Create and run `scripts/backup-pre-autosocial.mjs` to checkpoint SQLite WAL (`PRAGMA wal_checkpoint(FULL)`, handling BigInt safely), copy `db/custom.db` to `db/custom.db.bak.pre-autosocial`, and verify file size and SQLite header.
2. **Prisma Additive Schema**: Append the 7 models (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) to `prisma/schema.prisma` exactly as designed in `explorer_m1_db_safety/analysis.md`.
3. **Database Push & Client Generation**: Run `npx prisma db push --accept-data-loss` and `npx prisma generate`.
4. **Campaign Service Layer**: Implement `src/lib/campaign-service.ts` with:
   - Dynamic boundary state computation `computeCampaignStatus(campaign, now)` returning `UPCOMING` ($now < startDate$), `RUNNING` ($startDate \le now \le endDate$), `ENDED` ($now > endDate$), or `CANCELLED`.
   - CRUD functions (`createCampaign`, `getCampaign`, `listCampaigns`, `updateCampaign`, `deleteCampaign`).
   - Validation: reject $endDate \le startDate$ with clear error.
   - Pricing & Voucher enrichment: `enrichCampaignData(campaign)` implementing interface contract M1 ↔ M3.
5. **Next.js 16 Route Handlers**:
   - `src/app/api/campaigns/route.ts` (GET, POST)
   - `src/app/api/campaigns/[id]/route.ts` (GET, PUT, DELETE)
   - Strict Next.js 16 conventions: `export const dynamic = 'force-dynamic'`, `const { id } = await params`.
6. **Automated Verification Harness**: Create and run `scripts/verify-m1-campaigns.ts` verifying:
   - Backup file exists and is intact
   - Campaign boundary state transitions with microsecond/minute boundary tests
   - Validation rejection ($endDate \le startDate$)
   - Multi-product & voucher pricing calculations
   - Zero regression check on 24 baseline tables ($\Delta = 0$ against `db/baseline-counts.json`)
   - Test data teardown
7. **Regression Check**: Run `npm run verify` to verify 0 errors / 0 warnings.

## Deliverables
Record all implementation steps, test commands, and execution results in `handoff.md` in your working directory. Send a completion message to the orchestrator when done.


## 2026-10-26T14:00:18Z
**Context**: Milestone 1 (M1: CRM Campaigns & DB Safety) Status Check
**Content**: Orchestrator checking in on Worker M1 status. What step are you currently executing? Have `verify-m1-campaigns.ts` and `npm run verify` finished?
**Action**: Please reply with your current progress, any blockers, or submit your handoff.md if complete.
