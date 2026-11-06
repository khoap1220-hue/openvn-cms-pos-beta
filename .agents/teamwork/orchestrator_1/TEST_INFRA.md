# E2E Test Infra: OPENVN · Ưu Đàm Suite

## Test Philosophy
- Opaque-box, requirement-driven. No dependency on internal implementation design.
- Methodology: Category-Partition + Boundary Value Analysis (BVA) + Pairwise Combinatorial + Real-World Workload Testing.
- Execution Environment: Node.js 22+ native `--experimental-strip-types` executing standalone test runner scripts against `http://localhost:3010`.

## Feature Inventory & Test Coverage Goals
| # | Feature | Source | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Pairwise) |
|---|---------|--------|:-----------------:|:-----------------:|:-----------------:|
| 1 | Database Integrity & Record Preservation | ORIGINAL_REQUEST §R7 | 5 | 5 | ✓ |
| 2 | SQLite Transaction & Order Cancellation | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 3 | Shipment Returned Stock Restoration | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 4 | Customer Phone Dedup Guard | ORIGINAL_REQUEST §R1 | 5 | 5 | ✓ |
| 5 | Bulk Order Confirmation (`/bulk-confirm`) | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 6 | Bulk Rejection Reporting | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 7 | Batch Shipping Slips Print Format | ORIGINAL_REQUEST §R2 | 5 | 5 | ✓ |
| 8 | VAT XML Generation (QĐ 1450/QĐ-TCT) | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 9 | VAT XML Cancellation Guard | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 10 | E-Invoice Mock Signing Adapter | ORIGINAL_REQUEST §R3 | 5 | 5 | ✓ |
| 11 | Product Catalog Export CSV | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 12 | Product Catalog Import CSV Validation | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 13 | Product CSV Round-trip Preservation | ORIGINAL_REQUEST §R4 | 5 | 5 | ✓ |
| 14 | Dashboard Date Range (7/14/30/90 days) | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 15 | Purchase Order Draft -> Approve -> Receive | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 16 | Chat Image Drag-and-Drop Upload | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 17 | POS K80 ESC/POS Print & Fallback | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 18 | Auto-shipping Fee GHN/GHTK Mock | ORIGINAL_REQUEST §R5, R6 | 5 | 5 | ✓ |
| 19 | VIP Birthday Voucher Idempotency | ORIGINAL_REQUEST §R5, R6 | 5 | 5 | ✓ |
| 20 | Shopee/TikTok Omnichannel Drill | ORIGINAL_REQUEST §R5 | 5 | 5 | ✓ |
| 21 | Safe Mock Isolation (0 external net/keys) | ORIGINAL_REQUEST §R6 | 5 | 5 | ✓ |

## Test Architecture
- **Static Check Gate**: `npx tsc --noEmit` + `npm run lint`
- **Ledger Invariant Gate**: `npm run test:chain` (monotonic cumulative stock movements for all tracked items)
- **Scenario Gate**: `scripts/verify-realworld-scenarios.ts` (existing 21 scenarios)
- **New Feature Verification Scripts**:
  - `scripts/verify-r1-regressions.ts` (R1 Transaction safety & phone dedup)
  - `scripts/verify-r2-bulk-orders.ts` (R2 Bulk order confirm, mixed valid/invalid, rejection reasons)
  - `scripts/verify-r3-einvoice-xml.ts` (R3 VAT XML structure, fields, cancelled guard, mock signer)
  - `scripts/verify-r4-catalog-csv-excel.ts` (R4 CSV export, import, line errors, round-trip)
  - `scripts/verify-r5-p2-features.ts` (R5 Dashboard, PO, ESC/POS, GHN/GHTK, Birthday, Drills)
- **Aggregate Verification Runner**:
  - `scripts/verify-e2e-suite.ts`: Executes all above suites sequentially and asserts 100% pass.

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Expected Outcome |
|---|----------|--------------------|------------------|
| 1 | Bulk Flash Sale Fulfillment | F06, F07, F08, F18 | 50 mixed orders confirmed, slips printed, out-of-stock rejected cleanly |
| 2 | End-of-Day VAT E-Invoicing | F09, F10, F11 | XMLs exported for all valid completed orders, signed with mock, cancelled skipped |
| 3 | Mass Price & Catalog Adjustment | F12, F13, F14 | Export entire catalog, adjust prices, re-import with 0 data corruption |
| 4 | Store Restocking PO Lifecycle | F16, F01 | Draft PO created, approved, partial shipment received, stock and ledger accurate |
| 5 | VIP Loyalty Birthday Automation | F20, F22 | Customer with today birthday receives single voucher, duplicate cron run is idempotent |

## Coverage Thresholds
- Tier 1: >= 5 test cases per feature
- Tier 2: >= 5 boundary / edge test cases per feature
- Tier 3: Pairwise combinations across major features
- Tier 4: >= 5 realistic end-to-end workload scenarios
- Verification: Exit code 0, 0 unhandled promise rejections, 0 data residue in core tables.
