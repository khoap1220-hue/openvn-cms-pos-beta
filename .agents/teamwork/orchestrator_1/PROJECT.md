# Project: OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite)

## Architecture
- **Framework**: Next.js 16 (Turbopack, App Router, React Server Components & Client Views).
- **Database & ORM**: SQLite (`db/custom.db`) with Prisma ORM (`prisma/schema.prisma`).
- **Network Ports**:
  - `3010`: Web Application Server & CMS Dashboard.
  - `3013`: Realtime Event Bus (Socket.IO).
- **Core Modules**:
  1. POS Counter & K80 Thermal Printing (`src/components/cms/views/pos-view.tsx`).
  2. Orders & Bulk Fulfillment (`src/components/cms/views/orders-view.tsx`, `src/app/api/orders/*`).
  3. Invoicing & VAT E-Invoice XML (`src/components/cms/views/sales-invoices-view.tsx`, `src/lib/einvoice.ts`).
  4. Inventory, Multi-warehouse & Combo BOM (`src/lib/inventory-service.ts`, `src/lib/bom-service.ts`).
  5. Purchasing & PO Receiving (`src/components/cms/views/purchase-view.tsx`, `src/lib/invoice-service.ts`).
  6. Product Catalog & Price Management (`src/components/cms/views/products-view.tsx`, `src/app/api/products/*`).
  7. Shipping, COD & Courier Fee (`src/components/cms/views/shipments-view.tsx`, `src/lib/shipping-service.ts`).
  8. Loyalty, VIP Tiers & Zalo Vouchers (`src/lib/loyalty-service.ts`, `src/lib/voucher-service.ts`).
  9. Omnichannel Chat & Vision Image Upload (`src/components/cms/views/inbox-view.tsx`).
  10. AI Cockpit & Omnichannel Drill (`src/components/cms/views/liveops-view.tsx`, `src/lib/agent-engine.ts`).
  11. Accounting & Financial Integrity (`src/lib/accounting-service.ts`, `src/lib/pnl-service.ts`).
  12. External Integrations (Mock Mode) (`src/lib/integrations/*`).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | DB Backup & Baseline | Backup `db/custom.db` to `db/custom.db.bak`, record table baseline counts | M1 | ORIGINAL_REQUEST §R7 |
| F02 | Order Cancel Transaction | Wrap order cancellation in `db.$transaction` to guarantee atomicity of status, stock restore, and combo sync | M2 | ORIGINAL_REQUEST §R1 |
| F03 | Shipment Return Transaction | Wrap shipment RETURNED processing in `db.$transaction` for atomic stock return | M2 | ORIGINAL_REQUEST §R1 |
| F04 | Customer Phone Dedup Guard | Prevent duplicate customer records by phone number in `POST /api/customers` | M2 | ORIGINAL_REQUEST §R1 |
| F05 | Backup Route Turbopack Fix | Fix Turbopack dynamic filesystem tracing warning in `api/system/backup/route.ts` | M2 | Codebase Survey (R1) |
| F06 | Bulk Confirm API | Implement `POST /api/orders/bulk-confirm` with atomic validation and per-order rejection reasons | M3 | ORIGINAL_REQUEST §R2 |
| F07 | Bulk Order Selection UI | Add row checkboxes, select all, and bulk action toolbar in `orders-view.tsx` | M3 | ORIGINAL_REQUEST §R2 |
| F08 | Batch Shipping Slips A6 | Implement multi-order A6 shipping note print preview with page-break CSS | M3 | ORIGINAL_REQUEST §R2 |
| F09 | VAT E-Invoice XML Standard | Generate XML according to NĐ 123/2020, TT 78/2021, QĐ 1450/QĐ-TCT (`<HDon><DLHDon>...`) | M4 | ORIGINAL_REQUEST §R3 |
| F10 | E-Invoice Signing Mock Adapter | Adapter/webhook to send invoice to e-sign providers (VNPT, Viettel SInvoice) with mock mode | M4 | ORIGINAL_REQUEST §R3 |
| F11 | E-Invoice UI Download & Status | Add XML download button and digital signature status badge in invoice views | M4 | ORIGINAL_REQUEST §R3 |
| F12 | Product Catalog Export CSV | Implement `GET /api/products/export` (UTF-8 with BOM, pricing, stock, channels) | M5 | ORIGINAL_REQUEST §R4 |
| F13 | Product Catalog Import CSV | Implement `POST /api/products/import` with line-by-line validation and error reporting | M5 | ORIGINAL_REQUEST §R4 |
| F14 | Product Import/Export UI Modal | Add Export/Import buttons, file upload, error table preview in `products-view.tsx` | M5 | ORIGINAL_REQUEST §R4 |
| F15 | Dashboard Date Range Filter | Support 7/14/30/90 days query in `api/dashboard` and button selector in `dashboard-view.tsx` | M6 | ORIGINAL_REQUEST §R5 |
| F16 | Purchase Order Workflow | Implement PO Draft -> Approve -> Receive workflow; stock increases only on actual receipt | M6 | ORIGINAL_REQUEST §R5 |
| F17 | Chat Drag & Drop Image Upload | Support drag-and-drop image upload onto chat input with compression in `inbox-view.tsx` | M6 | ORIGINAL_REQUEST §R5 |
| F18 | ESC/POS K80 Thermal Printing | WebUSB/WebSerial direct print with paper cut & Vietnamese encoding, fallback `window.print` | M6 | ORIGINAL_REQUEST §R5 |
| F19 | Auto Shipping Fee Calculation | Calculate shipping fee automatically via GHN/GHTK mock adapter based on address | M6 | ORIGINAL_REQUEST §R5, R6 |
| F20 | Birthday VIP Voucher Scheduler | Auto-send birthday voucher via Zalo to VIP members with idempotent daily guard | M6 | ORIGINAL_REQUEST §R5, R6 |
| F21 | Shopee / TikTok Shop Order Drill | Add simulation drill buttons for Shopee / TikTok Shop orders in AI Cockpit | M6 | ORIGINAL_REQUEST §R5 |
| F22 | Safe External Mocking | Ensure zero live external network/hardware calls when credentials absent; no secret leaks | M6 | ORIGINAL_REQUEST §R6 |
| F23 | E2E Regression Test Suite | Comprehensive tests covering Tiers 1-4, verifying all R1-R6 features and zero regression | M7 | Acceptance Criteria |
| F24 | Independent UI Browser Audit | Automated independent browser check (desktop + 390px mobile, 0 console errors, screenshots) | M7 | Acceptance Criteria |
| F25 | Release & Documentation Audit | Update `FEATURE_EXPERIENCE_MATRIX.md`, `RELEASE_CHECKLIST.md`, `MATRIX_HANDOFF.md` | M7 | ORIGINAL_REQUEST §R7 |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Database Backup & Baseline | F01: Backup `db/custom.db` to `db/custom.db.bak`, record verified counts | none | DONE |
| M2 | System Hardening & Defect Rectification | F02, F03, F04, F05: Transaction safety, phone dedup, Turbopack fix, regression tests | M1 | DONE |
| M3 | Bulk Orders Processing & Batch Slips | F06, F07, F08: Bulk confirm API, rejection reporting, UI selection, A6 batch print | M2 | DONE |
| M4 | VAT E-Invoice XML & Mock Signer | F09, F10, F11: QĐ 1450 XML generation, VNPT/Viettel mock adapter, UI download/status | M2 | DONE |
| M5 | Product Catalog CSV Import/Export | F12, F13, F14: Bi-directional CSV export/import, line-by-line validation, UI modal | M2 | DONE |
| M6 | P2 Operational Features & Mocks | F15..F22: Dashboard filter, PO workflow, Chat drag-drop, K80 ESC/POS, GHN/GHTK, Birthday VIP, Drill | M2 | DONE |
| M7 | E2E Quality Gate, UI Audit & Release Docs | F23, F24, F25: Pass 100% E2E tests, browser UI audit desktop+mobile, update release docs | M3, M4, M5, M6 | DONE |

---

## Interface Contracts

### 1. Bulk Order Confirmation (`POST /api/orders/bulk-confirm`)
- **Request Body**:
  ```json
  {
    "orderIds": ["uuid-1", "uuid-2"]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "processedCount": 1,
    "rejectedCount": 1,
    "results": [
      { "orderId": "uuid-1", "orderCode": "ORD-001", "status": "CONFIRMED" },
      { "orderId": "uuid-2", "orderCode": "ORD-002", "status": "REJECTED", "reason": "Đơn hàng đã bị hủy hoặc không ở trạng thái PENDING" }
    ]
  }
  ```

### 2. VAT E-Invoice XML Export (`GET /api/sales-invoices/[id]/xml`)
- **Response**:
  - `Content-Type`: `application/xml; charset=utf-8`
  - XML Root: `<HDon><DLHDon><TTChung>...</TTChung><NDHDon><NBan>...</NBan><NMua>...</NMua><DSHangHoa>...</DSHangHoa><TToan>...</TToan></NDHDon></DLHDon><DSCKS><KSCKS/></DSCKS></HDon>`
  - Rejection: If invoice status is `CANCELLED`, returns HTTP 400 with `error: "Hóa đơn đã hủy, không thể xuất XML"`.

### 3. Product Catalog CSV Import (`POST /api/products/import`)
- **Request Body**: Multipart form data with file or JSON lines.
- **Validation Rules**:
  - Row-by-row validation of SKU, name, costPrice >= 0, retailPrice >= 0.
  - If any row has errors, abort transaction and return HTTP 422:
    ```json
    {
      "success": false,
      "totalErrors": 2,
      "errors": [
        { "row": 3, "sku": "UD-ERR-1", "field": "retailPrice", "message": "Giá bán không được nhỏ hơn 0" },
        { "row": 5, "sku": "", "field": "sku", "message": "Mã SKU không được để trống" }
      ]
    }
    ```

### 4. Dashboard Date Filter (`GET /api/dashboard?days=7|14|30|90`)
- **Query Parameter**: `days` (integer: 7, 14, 30, 90). Default: 14.
- **Response**:
  ```json
  {
    "timeRangeDays": 30,
    "revenueChart": [{ "date": "2026-10-01", "revenue": 1500000 }, ...],
    "kpis": { ... }
  }
  ```

---

## Code Layout
- `src/app/api/`: Next.js 16 Route Handlers (REST endpoints).
- `src/components/cms/views/`: Primary UI Views for each module.
- `src/lib/`: Core Domain Services & Business Logic.
  - `src/lib/einvoice.ts`: Standard XML Generator and parser.
  - `src/lib/integrations/`: Safe mock adapters for external services (GHN, GHTK, Zalo, e-sign).
- `scripts/`: Verification, ledger chain integrity, and scenario scripts.
- `db/custom.db`: SQLite database file.
- `docs/`: Operations, Feature matrix, and release checklists.
