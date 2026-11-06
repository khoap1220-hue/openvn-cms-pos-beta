# BRIEFING — 2026-10-26T09:55:00Z

## Mission
Milestone M5: Product & Price Catalog CSV/Excel Import/Export - R4 (F12, F13, F14)

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5
- Original parent: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Milestone: M5 (Product & Price Catalog CSV/Excel Import/Export - R4)

## 🔒 Key Constraints
- EXCLUSIVE WRITE OWNERSHIP:
  * src/app/api/products/export/route.ts
  * src/app/api/products/import/route.ts
  * src/components/cms/views/products-view.tsx
  * src/lib/csv-helper.ts
- Integrity Mandate: Genuine logic, no hardcoded responses, atomic rollback, strict error reporting.
- Quality Gates: node --experimental-strip-types scripts/verify-r4-catalog-csv-excel.ts (100% PASS), npx tsc --noEmit, npm run lint, npm run test:chain, npm run test:scenarios, npm run build.

## Current Parent
- Conversation ID: 7124d145-f8bf-4670-a0d0-13114c2b24e3
- Updated: 2026-10-26T09:55:00Z

## Task Summary
- **What to build**:
  1. GET /api/products/export: DB export with \uFEFF UTF-8 BOM, required headers, quoted CSV values, headers Content-Type text/csv; charset=utf-8, Content-Disposition attachment; filename="danh-muc-san-pham.csv".
  2. POST /api/products/import: Multipart/form-data or JSON { csv }, BOM stripping, row-by-row validation, atomic rollback (HTTP 422 if errors, 0 records written), db.$transaction upsert by SKU if valid (HTTP 200).
  3. UI in products-view.tsx: Export CSV button, Import CSV button, Import dialog with file upload & error table preview.
- **Success criteria**: 100% pass on verify-r4 script, zero regressions on existing tests, clean lint and build.
- **Interface contracts**: PROJECT.md § Interface Contracts
- **Code layout**: PROJECT.md § Code Layout

## Change Tracker
- **Files modified**:
  * `src/lib/csv-helper.ts` (created): RFC 4180 CSV parser & generator, product validation, BOM preservation.
  * `src/app/api/products/export/route.ts` (created): Export endpoint with UTF-8 BOM, standard headers, and Content-Disposition.
  * `src/app/api/products/import/route.ts` (created): Import endpoint with multipart/JSON support, atomic line-by-line validation (HTTP 422), and db.$transaction upsert (HTTP 200).
  * `src/components/cms/views/products-view.tsx` (updated): Added "Xuất CSV" & "Nhập CSV" buttons to PageHeader, and import dialog with error table preview [Dòng, Mã SKU, Trường lỗi, Chi tiết lỗi].
- **Build status**: Pass (Turbopack build successful, tsc 0 errors, lint 0 errors)
- **Pending issues**: None

## Quality Status
- **Build/test result**: Pass (scripts/verify-r4-catalog-csv-excel.ts 10/10 PASS, test:chain 100% PASS, test:scenarios 21/21 PASS)
- **Lint status**: 0 errors, 0 warnings
- **Tests added/modified**: None (verified against existing verification suites)

## Loaded Skills
- None

## Key Decisions Made
- Implemented standard RFC 4180 CSV parser and serializer in `src/lib/csv-helper.ts` supporting quoted cells with commas, quotes, newlines, and BOM handling.
- Guaranteed atomic rollback in import: any validation failure immediately returns HTTP 422 with line numbers, field names, and SKU without executing any DB writes.
- Enhanced UX in `products-view.tsx` with dialog states: file upload, loading spinner, error table listing each invalid row, and success alerts.

## Artifact Index
- .agents/teamwork/worker_m5/DISPATCH.md
- .agents/teamwork/worker_m5/BRIEFING.md
- .agents/teamwork/worker_m5/progress.md
- .agents/teamwork/worker_m5/handoff.md
