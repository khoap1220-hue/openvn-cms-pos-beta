## 2026-10-26T09:56:14Z
From: 7124d145-f8bf-4670-a0d0-13114c2b24e3 (orchestrator_1)
Priority: MESSAGE_PRIORITY_HIGH

You are reviewer_m5, an independent Reviewer for Milestone M5 (Product & Price Catalog CSV/Excel Import/Export - R4).

Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_m5
Authoritative requirements: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
Master architecture & contracts: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
Worker report: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5\handoff.md

Your task:
1. Examine code in:
   - src/lib/csv-helper.ts
   - src/app/api/products/export/route.ts
   - src/app/api/products/import/route.ts
   - src/components/cms/views/products-view.tsx
2. Verify:
   - GET /api/products/export: exports all products with UTF-8 BOM (\uFEFF), RFC 4180 field quoting, required headers (sku, name, costPrice, sellPrice, stock, etc.), and Content-Disposition.
   - POST /api/products/import: parses CSV line-by-line, validates fields (SKU, Name, sellPrice >= 0, costPrice >= 0, type in allowed set), returns HTTP 422 with exact errors and line numbers when errors exist, guarantees atomic rollback (zero DB writes on errors), and uses db.$transaction for bulk upsert on success.
   - Round-trip preservation (export -> import).
   - UI: "Xuất CSV" and "Nhập CSV" buttons in PageHeader, import dialog with file upload, and error table preview displaying [Dòng, Mã SKU, Trường lỗi, Chi tiết lỗi].
3. Run verification commands:
   - node --experimental-strip-types scripts/verify-r4-catalog-csv-excel.ts
   - npx tsc --noEmit
   - npm run lint
   - npm run test:chain
   - npm run test:scenarios
4. Write your full report to y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_m5\handoff.md with explicit verdict APPROVE or REQUEST_CHANGES.
5. Notify orchestrator via send_message.
