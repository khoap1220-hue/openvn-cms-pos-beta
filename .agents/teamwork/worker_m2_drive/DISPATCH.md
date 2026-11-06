## 2026-10-26T14:20:27Z
You are Worker Subagent for Milestone 2 (M2: Google Drive Content Source Engine) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m2_drive`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Survey analysis: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_survey_integrations\analysis.md`
4. Prisma schema (`ContentSource` and `ContentSourceItem` models in `prisma/schema.prisma` lines 500-540)
5. `AGENTS.md` regarding Next.js 16 conventions (`await params`, `export const dynamic = 'force-dynamic'`)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership (Exclusively Owned Files)
You own and may create or modify ONLY these files:
- `src/lib/drive-parser.ts`
- `src/app/api/social/drive/route.ts`
- `src/app/api/social/drive/[id]/route.ts`
- `scripts/verify-m2-drive.ts`

## Tasks to Implement (FEAT-DRV-01 to FEAT-DRV-05)
1. **Public Google Drive Parser (`src/lib/drive-parser.ts`)**:
   - `parseDriveUrl(url: string)`: parse standard folder URLs (`drive.google.com/drive/folders/{id}`), short URLs, and file URLs.
   - `fetchPublicDriveFolder(folderId: string, options)`: Hybrid 2-tier engine:
     * Tier 1 (when Google API key configured in IntegrationCredential/env): call Google Drive API v3 REST endpoint.
     * Tier 2 (zero-key mode for public folders): fetch public folder HTML, decode hex `window['_DRIVE_ivd']` array, extract file IDs, names, MIME types, and hierarchical folder structure up to 3 levels deep.
   - Text & Document Extraction:
     * Google Docs: fetch plain text via `https://docs.google.com/document/d/{id}/export?format=txt`.
     * Google Sheets: fetch tabular CSV via `https://docs.google.com/spreadsheets/d/{id}/export?format=csv`.
     * Images & Videos: build direct web view / thumbnail URLs (`lh3.googleusercontent.com/d/{id}`).
   - Error Handling:
     * Invalid URL format -> 400 Bad Request with descriptive message.
     * Non-existent / 404 folder -> clear error "Thư mục không tồn tại".
     * Private / restricted folder (302 redirect to Google sign-in) -> clear error "Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')".
   - Database Synchronization:
     * Save/update `ContentSource` and child `ContentSourceItem` records in SQLite.
     * Non-destructive re-sync: if user manually linked a `ContentSourceItem` to a `Product` or `Campaign`, updating/re-syncing the folder MUST preserve existing foreign key associations (`productId`, `campaignId`).
2. **Next.js 16 Route Handlers**:
   - `src/app/api/social/drive/route.ts`:
     * POST: accept `{ folderUrl: string, name?: string, campaignId?: string }`, validate, crawl folder, save to DB, return synced source and items.
     * GET: list all content sources with item counts and sync status.
   - `src/app/api/social/drive/[id]/route.ts`:
     * GET: get details of content source with nested items and tree structure.
     * POST / PUT: re-sync existing source.
     * DELETE: delete content source and cascade clean items.
     * Next.js 16 compliance: `export const dynamic = 'force-dynamic'`, `const { id } = await params`.
3. **Automated Verification Suite (`scripts/verify-m2-drive.ts`)**:
   - Verify URL parsing across multiple Google Drive link formats.
   - Verify real public test folder ingestion (use the verified real test folder `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`).
   - Verify text extraction from Google Docs and Google Sheets.
   - Verify error responses for invalid, private, and 404 links.
   - Verify non-destructive re-sync preserving manual associations.
   - Verify baseline 24 tables maintain Delta = 0, clean up test records.
4. **Regression Check**: Run `npm run verify` to verify 0 errors / 0 warnings.

## Deliverables
Record all implementation steps, test commands, and execution results in `handoff.md`. Send completion message back to orchestrator.
