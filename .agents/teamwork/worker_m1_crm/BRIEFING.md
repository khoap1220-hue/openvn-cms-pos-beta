# BRIEFING — 2026-10-26T14:05:00Z

## Mission
Implement Milestone 1 (M1: CRM Campaigns & DB Safety) for the AUTO SOCIAL module in OPENVN · Ưu Đàm Suite: WAL checkpoint backup, additive Prisma models (7 models), dynamic campaign boundary state calculation, CRUD & enrichment service layer, Next.js 16 route handlers, and automated verification harness with zero baseline regression.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m1_crm
- Original parent: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Milestone: M1: CRM Campaigns & DB Safety

## 🔒 Key Constraints
- DB Safety First: checkpoint SQLite WAL (`PRAGMA wal_checkpoint(FULL)` with BigInt-safe handling), duplicate `db/custom.db` to `db/custom.db.bak.pre-autosocial`, verify SQLite header and file size.
- Strictly additive Prisma schema: modify only lines 486+ for 7 additive models (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`). DO NOT touch the existing 28 models.
- Next.js 16 conventions: `export const dynamic = 'force-dynamic'`, `params` must be awaited (`const { id } = await params`).
- Dynamic campaign status: `computeCampaignStatus(campaign, now)` returning `UPCOMING` ($now < startDate$), `RUNNING` ($startDate \le now \le endDate$), `ENDED` ($now > endDate$), or `CANCELLED`.
- Pricing & Voucher enrichment: `enrichCampaignData(campaign)` implementing M1 ↔ M3 contract.
- Zero regression: All 24 baseline tables must maintain $\Delta = 0$ records against `db/baseline-counts.json`.
- `npm run verify` must pass with 0 errors / 0 warnings.
- Exclusively owned files:
  - `scripts/backup-pre-autosocial.mjs`
  - `prisma/schema.prisma` (lines 486+ only)
  - `src/lib/campaign-service.ts`
  - `src/app/api/campaigns/route.ts`
  - `src/app/api/campaigns/[id]/route.ts`
  - `scripts/verify-m1-campaigns.ts`

## Current Parent
- Conversation ID: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Updated: 2026-10-26T14:00:18Z

## Task Summary
- **What to build**:
  1. WAL checkpoint & pre-autosocial backup script `scripts/backup-pre-autosocial.mjs` (executed and verified).
  2. Prisma additive schema (7 models appended to `prisma/schema.prisma` at line 486+).
  3. Run `npx prisma db push --accept-data-loss` and `npx prisma generate` (completed, 7 tables created).
  4. Campaign service layer `src/lib/campaign-service.ts` with boundary state logic, CRUD, validation ($endDate > startDate$), and M1 ↔ M3 pricing/voucher enrichment.
  5. Next.js 16 Route handlers `src/app/api/campaigns/route.ts` and `src/app/api/campaigns/[id]/route.ts` (GET, POST, PUT, DELETE with async params).
  6. Automated verification harness `scripts/verify-m1-campaigns.ts` (95/95 test assertions passed).
  7. Full project verification (`npm run verify` and `npm run build` both exit code 0).
- **Success criteria**:
  - Backup file verified with SQLite header (`SQLite format 3\0`), size match, and SHA-256 match.
  - 7 models deployed to SQLite without disturbing existing tables.
  - Boundary states tested at exact boundaries ($t - 1\text{ms}$, $t$, $t + 1\text{ms}$, $t \pm 60\text{s}$, CANCELLED).
  - Pricing & voucher math exact.
  - Baseline table counts unchanged ($\Delta = 0$ on all 24 core tables).
  - Clean test data teardown.
  - `npm run verify` and `npm run build` pass with 0 errors / 0 warnings.
- **Interface contracts**: `.agents/teamwork/orchestrator_2/PROJECT.md` & explorer analysis files.
- **Code layout**: Existing Next.js 16 App Router repository.

## Key Decisions Made
- Used structured JSON fields (`appliedProductIds`, `appliedVoucherIds`, `productOverrides`) on `Campaign` model rather than junction tables, guaranteeing 0 modifications to `Product` and `Voucher` models in Prisma schema.
- Used BigInt-safe handling `Number(raw[0]?.busy ?? BigInt(0))` for WAL checkpoint queries.
- Ensured Next.js 16 dynamic route handler params are awaited as Promises: `const { id } = await params`.
- Provided contract aliases (`price` mapping to `campaignPrice`, `title` defaulting to `name`) in `enrichCampaignData` to seamlessly satisfy M1 ↔ M3 interface contract.

## Artifact Index
- `scripts/backup-pre-autosocial.mjs` — DB checkpoint and backup script
- `prisma/schema.prisma` — Prisma schema with additive models at end of file
- `src/lib/campaign-service.ts` — Campaign domain service, boundary logic, CRUD, pricing enrichment
- `src/app/api/campaigns/route.ts` — Next.js 16 GET/POST API route
- `src/app/api/campaigns/[id]/route.ts` — Next.js 16 GET/PUT/DELETE API route
- `scripts/verify-m1-campaigns.ts` — Verification test suite (95 tests)

## Change Tracker
- **Files modified**:
  - `scripts/backup-pre-autosocial.mjs`: WAL flush, copy to `db/custom.db.bak.pre-autosocial`, verify size & header.
  - `prisma/schema.prisma`: Appended lines 486-680 with 7 new models. Existing 28 models untouched.
  - `src/lib/campaign-service.ts`: Created campaign domain service, pure boundary function, pricing enrichment, CRUD.
  - `src/app/api/campaigns/route.ts`: Created Next.js 16 GET & POST route handler.
  - `src/app/api/campaigns/[id]/route.ts`: Created Next.js 16 GET, PUT, DELETE dynamic route handler with `await params`.
  - `scripts/verify-m1-campaigns.ts`: Created 8-stage automated test suite covering all M1 requirements.
- **Build status**: `npm run verify` PASS (0 errors, 0 warnings); `npm run build` PASS (code 0).
- **Pending issues**: None. Milestone 1 is 100% complete.

## Quality Status
- **Build/test result**: `npm run verify` PASS (tsc + lint + test:chain + test:scenarios); `scripts/verify-m1-campaigns.ts` 95/95 PASS.
- **Lint status**: 0 errors / 0 warnings (`eslint src` clean).
- **Tests added/modified**: 95 test assertions in `scripts/verify-m1-campaigns.ts`.

## Loaded Skills
- None requested specifically in dispatch.
