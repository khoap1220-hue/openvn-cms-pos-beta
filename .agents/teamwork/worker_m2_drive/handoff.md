# Handoff Report — Milestone 2: Google Drive Content Source Engine

**Author**: Worker Subagent M2 (`worker_m2_drive`)  
**Date**: 2026-10-26  
**Status**: COMPLETE (100% PASS, Zero Regression)  
**Assigned Milestone**: M2 (Google Drive Content Source Engine, FEAT-DRV-01 to FEAT-DRV-05)

---

## 1. Observation

1. **Exclusively Owned Files Created**:
   - `src/lib/drive-parser.ts` (926 lines): Core engine implementing public Drive URL parsing, Tier 1 (Drive API v3) + Tier 2 (Zero-Key Web Scraper decoding `window['_DRIVE_ivd']`), Docs/Sheets text extraction, CDN link builder, and non-destructive database synchronization.
   - `src/app/api/social/drive/route.ts` (93 lines): Next.js 16 Route Handler supporting GET (list with item counts and campaign info) and POST (folder crawler and ingestion).
   - `src/app/api/social/drive/[id]/route.ts` (144 lines): Next.js 16 Route Handler supporting GET (detail with hierarchical tree and items), PUT/POST (non-destructive re-sync), and DELETE (cascade deletion).
   - `scripts/verify-m2-drive.ts` (368 lines): 10-stage automated verification suite with 98 assertions.

2. **Real Public Test Folder Ingestion**:
   - Tested against verified live public folder: `https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY`
   - Retrieved HTTP 200 OK without OAuth credentials.
   - Decoded `window['_DRIVE_ivd']` hex array successfully:
     * Root folder name extracted from `<title>`: `"testpublic"`
     * Total items crawled: 3 files
     * Item 0: ID `1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV` — `"Generated document.pdf"`, MIME `application/pdf`, size 710,949 bytes
     * Item 1: ID `1txUBoKtwBEjDm-icR2cpAV-OLK5j7jf_` — `"How_to_migrate_from_Lunr_to_Algolia_-_a_technical_guide.pdf"`, MIME `application/pdf`, size 852,678 bytes
     * Item 2: ID `1WmLXx1WarTzyZA0urWkD8ABzz9wfwe3d` — `"urltopdf.pdf"`, MIME `application/pdf`, size 373,682 bytes
     * High-speed CDN thumbnail URL generated: `https://lh3.googleusercontent.com/d/1rCuD8MxDwX-7o0eNXQTjd7XaWVe1IACV` (verified HTTP 200, image/png)

3. **Text & Document Extraction (FEAT-DRV-03)**:
   - Live Google Sheet export tested via `https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/export?format=csv`
   - Returned HTTP 200 OK `text/csv; charset=utf-8` containing authentic tabular data columns (`Student Name`, `Gender`, `Class Level`, `Home State`, `Major`, `Extracurricular Activity`).
   - Plain text export for Google Docs implemented via `https://docs.google.com/document/d/{id}/export?format=txt`.
   - Error tolerance verified: non-existent document IDs return `null` safely without crashing the crawler or server.

4. **Error Handling & Adversarial Scenarios (FEAT-DRV-05)**:
   - Non-existent folder (`100000000000000000000000000000000`) returns HTTP 404, throwing verbatim error: `"Thư mục không tồn tại"`.
   - Private / restricted links redirecting to `accounts.google.com/v3/signin` throw verbatim error: `"Thư mục chưa được mở quyền công khai ('Bất kỳ ai có đường liên kết đều có thể xem')"`.
   - Malformed links throw verbatim error: `"Định dạng URL Google Drive không hợp lệ. Vui lòng cung cấp liên kết chia sẻ dạng: https://drive.google.com/drive/folders/{id}"`.
   - Under all error conditions, existing `ContentSource` and `ContentSourceItem` records are strictly preserved without data corruption.

5. **Non-Destructive Re-Sync (FEAT-DRV-04)**:
   - Manually attached `productId` and `campaignId` to a `ContentSourceItem` via `metadata`: `{"productId": "...", "campaignId": "...", "customTag": "UUDAM_SPECIAL_ASSET", "photographer": "Minh Trí Ưu Đàm"}`.
   - Linked `ContentSource` to `campaignId` and `productId`.
   - Re-synced the folder via `syncDriveFolderToDb`.
   - Verified that all foreign key associations and custom metadata properties remained intact with 0 data loss.

6. **Next.js 16 Compliance**:
   - `export const dynamic = 'force-dynamic'` present in all route files.
   - Dynamic route parameters unwrapped asynchronously via `const { id } = await params` with `{ params: Promise<{ id: string }> }`.
   - Tested route handlers with NextRequest/NextResponse directly in test suite:
     * `GET /api/social/drive`: 200 OK
     * `GET /api/social/drive/[id]`: 200 OK
     * `PUT /api/social/drive/[id]`: 200 OK
     * `DELETE /api/social/drive/[id]`: 200 OK with cascade deletion of child items.

7. **Verification & Regression Results**:
   - `npx tsx scripts/verify-m2-drive.ts`:
     ```
     ======================================================================
     🎉 TOÀN BỘ 98 KIỂM THỬ ĐẠT CHUẨN! (FAILED: 0) 🎉
     >>> MILESTONE 2 (GOOGLE DRIVE CONTENT SOURCE) HOÀN TẤT XUẤT SẮC <<<
     ======================================================================
     ```
   - `npm run verify` (tsc --noEmit && eslint src && test:chain && test:scenarios):
     * `tsc --noEmit`: 0 errors
     * `eslint src`: 0 warnings, 0 errors
     * `test:chain`: Movement lineage audit verified 100%
     * `test:scenarios`: 21/21 real-world and adversarial scenarios PASS
   - `npm run build`:
     * Compiled successfully in 10.0s
     * TypeScript type check finished with 0 errors in 25.7s
     * Dynamic routes `/api/social/drive` and `/api/social/drive/[id]` generated cleanly.
   - Baseline 24 tables audit:
     * All 24 core tables matched baseline counts in `db/baseline-counts.json` (Delta = 0).

---

## 2. Logic Chain

1. **Step 1: Ingestion Mechanism Selection (Observation 2)**
   - Because users provide public share links without OAuth configuration, OAuth 2.0 flow is unsuitable.
   - Tier 1 checks Google Cloud API Key from `AppSetting`, `IntegrationCredential`, or `process.env`.
   - Tier 2 provides zero-key web extraction by retrieving the public folder HTML and decoding Google's pre-rendered `window['_DRIVE_ivd']` array.
   - This ensures 100% operational readiness out-of-the-box even before the shop owner configures any Google Cloud credentials.

2. **Step 2: Resilient URL Resolution (Observation 2, 4)**
   - Multiple Google Drive link formats exist (`/folders/`, `/u/0/folders/`, `/open?id=`, `/file/d/`, `/document/d/`, `/spreadsheets/d/`, bare IDs).
   - Regex patterns in `parseDriveUrl` normalize these into a canonical `ParsedDriveUrl` or reject non-Drive URLs immediately with clear Vietnamese error messages before making any network requests.

3. **Step 3: Document Content Enrichment (Observation 3)**
   - Text extracted from Google Docs (`/export?format=txt`) and Sheets (`/export?format=csv`) is stored in `ContentSourceItem.textContent`.
   - This satisfies the M2 ↔ M3 interface contract (`DriveAssetContext.textContent`), providing rich context for AI copywriting in Milestone 3.

4. **Step 4: Non-Destructive Invariant (Observation 5)**
   - Shop owners may manually link Drive items to specific CRM products (`productId`) or campaigns (`campaignId`).
   - During folder re-sync, existing records are matched by `driveFileId`, and existing `metadata` properties are merged rather than overwritten.
   - `ContentSource.productId` and `ContentSource.campaignId` are preserved unless explicitly overridden.

5. **Step 5: Database Safety & Baseline Parity (Observation 7)**
   - All tests create temporary test sources, perform full teardown, and execute `PRAGMA wal_checkpoint(FULL)`.
   - Both pre-test and post-test audits confirm that the 24 baseline tables maintain exact parity with `db/baseline-counts.json` (Delta = 0).

---

## 3. Caveats

- **Network Availability**: Tier 2 zero-key scraping and Docs/Sheets export require internet access to Google's public endpoints (`drive.google.com`, `docs.google.com`, `lh3.googleusercontent.com`). If running in an offline sandbox, network timeouts are handled gracefully via `AbortSignal.timeout`, returning null or structured error messages without crashing the application.
- **Folder Depth**: Recursive traversal is capped at `maxDepth = 3` to prevent infinite loops or excessive memory consumption on deeply nested Google Drive hierarchies.
- **Private Folders**: Private folders requiring Google sign-in cannot be scraped in zero-key mode and will prompt the user to change sharing permissions to "Anyone with the link can view".

---

## 4. Conclusion

Milestone 2 (Google Drive Content Source Engine, FEAT-DRV-01 to FEAT-DRV-05) is completely implemented and verified:
- Genuine public Google Drive crawler operating in both Tier 1 (API key) and Tier 2 (Zero-Key HTML) modes.
- Direct extraction of plain text from Google Docs and tabular CSV from Google Sheets.
- Non-destructive re-sync preserving existing manual associations (`productId`, `campaignId`, custom metadata).
- Next.js 16 compliant Route Handlers at `/api/social/drive` and `/api/social/drive/[id]`.
- 10-stage automated test suite (`scripts/verify-m2-drive.ts`) passes 98/98 assertions.
- `npm run verify` and `npm run build` pass with 0 errors and 0 warnings.
- Baseline 24 tables maintain Delta = 0.

---

## 5. Verification Method

To independently reproduce and verify this work:

1. **Run the Milestone 2 Verification Suite**:
   ```bash
   npx tsx scripts/verify-m2-drive.ts
   ```
   *Expected Output*: `🎉 TOÀN BỘ 98 KIỂM THỬ ĐẠT CHUẨN! (FAILED: 0) 🎉` with Delta = 0 on all 24 baseline tables.

2. **Run TypeScript Check & ESLint**:
   ```bash
   npx tsc --noEmit
   npm run lint
   ```
   *Expected Output*: 0 errors, 0 warnings.

3. **Run Project Quality Gate**:
   ```bash
   npm run verify
   ```
   *Expected Output*: All chain movements, 21 real-world scenarios pass with code 0.

4. **Run Production Build**:
   ```bash
   npm run build
   ```
   *Expected Output*: Successful compilation with route handlers `/api/social/drive` and `/api/social/drive/[id]`.
