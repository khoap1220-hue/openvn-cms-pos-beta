# BRIEFING — 2026-10-26T14:40:00Z

## Mission
Implement Milestone 2: Google Drive Content Source Engine for AUTO SOCIAL module in OPENVN · Ưu Đàm Suite.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m2_drive
- Original parent: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Milestone: M2: Google Drive Content Source Engine

## 🔒 Key Constraints
- Exclusively owned files:
  * `src/lib/drive-parser.ts`
  * `src/app/api/social/drive/route.ts`
  * `src/app/api/social/drive/[id]/route.ts`
  * `scripts/verify-m2-drive.ts`
  * Local files in `.agents/teamwork/worker_m2_drive/`
- DO NOT CHEAT: Genuine implementation, real network calls, real DB ops, zero fake/hardcoded mocks in source.
- Preserve manual associations (productId, campaignId) on non-destructive re-sync.
- Next.js 16 conventions: `await params`, `export const dynamic = 'force-dynamic'`.
- Baseline 24 tables must maintain Delta = 0, clean up test records.
- `npm run verify` must pass with 0 errors / 0 warnings.

## Current Parent
- Conversation ID: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Updated: 2026-10-26T14:40:00Z

## Task Summary
- **What to build**:
  1. `src/lib/drive-parser.ts`: Public Google Drive Parser (hybrid 2-tier: Tier 1 API key, Tier 2 zero-key HTML parsing of `_DRIVE_ivd`, Docs txt export, Sheets csv export, thumbnail/view URLs, non-destructive re-sync).
  2. `src/app/api/social/drive/route.ts`: GET (list sources), POST (crawl folder & ingest).
  3. `src/app/api/social/drive/[id]/route.ts`: GET (source details & items tree), POST/PUT (re-sync), DELETE (delete & cascade).
  4. `scripts/verify-m2-drive.ts`: Automated verification suite covering parsing, real public folder ingestion, doc/sheet extraction, error handling, non-destructive re-sync, cleanup.
- **Success criteria**:
  * Real public test folder `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY` crawled & stored.
  * Google Docs plain text & Sheets CSV extracted.
  * Clear errors on invalid format, 404, or private folder.
  * Re-sync preserves manual productId/campaignId links.
  * Next.js 16 route handlers comply with async params & dynamic export.
  * `npx tsx scripts/verify-m2-drive.ts` passes 100% (98/98 tests).
  * `npm run verify` passes with 0 errors / 0 warnings.
  * `npm run build` succeeds cleanly.

## Change Tracker
- **Files modified**:
  * `src/lib/drive-parser.ts`: Hybrid 2-tier engine, parser, URL builder, document extractor, DB sync.
  * `src/app/api/social/drive/route.ts`: Next.js 16 GET and POST route handlers.
  * `src/app/api/social/drive/[id]/route.ts`: Next.js 16 GET, PUT, POST, DELETE route handlers.
  * `scripts/verify-m2-drive.ts`: Comprehensive 10-stage automated test suite (98 tests).
- **Build status**: Pass (`npm run build` succeeded, `npm run verify` passed 0 errors / 0 warnings, `verify-m2-drive.ts` 98/98 PASS)
- **Pending issues**: None

## Quality Status
- **Build/test result**: Pass (98/98 unit/integration tests in `verify-m2-drive.ts`, 21/21 real-world scenarios in `npm run verify`)
- **Lint status**: 0 violations (`npm run lint` clean)
- **Tests added/modified**: `scripts/verify-m2-drive.ts` (10 stages, 98 assertions)

## Loaded Skills
- None specified in dispatch

## Artifact Index
- `.agents/teamwork/worker_m2_drive/DISPATCH.md` — Assigned task specification
- `.agents/teamwork/worker_m2_drive/BRIEFING.md` — Persistent state and constraints
- `.agents/teamwork/worker_m2_drive/progress.md` — Liveness and step tracking
- `.agents/teamwork/worker_m2_drive/handoff.md` — Final completion report
