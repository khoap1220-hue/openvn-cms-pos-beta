## 2026-10-26T09:39:31Z
You are worker_m5, responsible for Milestone M5 (Product & Price Catalog CSV/Excel Import/Export - R4).

Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5
Authoritative requirements: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
Master architecture & contracts: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
Verification test script: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\scripts\verify-r4-catalog-csv-excel.ts

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
- src/app/api/products/export/route.ts (create)
- src/app/api/products/import/route.ts (create)
- src/components/cms/views/products-view.tsx (update)
- src/lib/csv-helper.ts (create if helpful for shared CSV parsing and formatting)

DETAILED REQUIREMENTS (R4, F12, F13, F14):
1. GET /api/products/export:
   - Fetches all products from database.
   - Formats to CSV string with \uFEFF UTF-8 BOM prefix (for Vietnamese Excel compatibility).
   - Headers must contain: sku, name, costPrice, sellPrice, stock, unit, type, barcode, category, status.
   - Values with commas, quotes, or newlines must be properly quoted ("...").
   - Responds with Content-Type: text/csv; charset=utf-8 and Content-Disposition: attachment; filename="danh-muc-san-pham.csv".
2. POST /api/products/import:
   - Accepts either JSON { csv: string } or multipart/form-data with a CSV file.
   - Strips BOM if present. Parses line-by-line.
   - Line-by-line validation rules:
     * Line 1 is header. Data rows start at line 2.
     * sku: must not be empty (error: "Mã SKU không được để trống").
     * name: must not be empty (error: "Tên sản phẩm không được để trống").
     * sellPrice: must be a valid number >= 0 (error: "Giá bán không được nhỏ hơn 0").
     * costPrice: must be a valid number >= 0 (error: "Giá vốn không được nhỏ hơn 0").
     * type: must be one of 'SIMPLE', 'COMBO', 'SERVICE', 'MANUFACTURED' (error: "Loại sản phẩm không hợp lệ").
   - Atomic Rollback Guarantee:
     * If there are ANY errors (errors.length > 0):
       Return HTTP 422 with JSON: { success: false, totalErrors: errors.length, errors: [{ row, sku, field, message }, ...] }.
       DO NOT insert or update ANY row into the database (even the valid rows in that file).
   - If ALL rows are valid:
     * Run in db.$transaction: upsert each product by sku into db.product.
     * Return HTTP 200 with { success: true, processedCount: N, message: "Nhập danh mục sản phẩm thành công" }.
3. UI Integration in src/components/cms/views/products-view.tsx:
   - Add "Xuất CSV" button triggering GET /api/products/export.
   - Add "Nhập CSV" button opening an import modal/dialog.
   - In the import modal: file input, upload action calling POST /api/products/import, and if 422 errors returned, show an error preview table listing [Dòng, Mã SKU, Trường lỗi, Chi tiết lỗi].
4. Verification & Quality Gates:
   - Run: node --experimental-strip-types scripts/verify-r4-catalog-csv-excel.ts (MUST pass 100%).
   - Run: npx tsc --noEmit (0 errors).
   - Run: npm run lint (0 errors, 0 warnings).
   - Run: npm run test:chain (100% valid).
   - Run: npm run test:scenarios (21/21 PASS).
   - Run: npm run build (successful Turbopack build).
5. Document results in y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5\handoff.md.
6. Notify orchestrator via send_message when done.
