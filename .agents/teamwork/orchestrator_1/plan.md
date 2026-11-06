# Master Execution Plan: OPENVN · Ưu Đàm Suite

## Objectives
Deliver a production-ready system meeting all requirements (R1-R7) specified in ORIGINAL_REQUEST.md with zero defects, full regression safety, mocked external integrations, and comprehensive E2E verification.

## Phase 0: Survey & Scope Mapping (Current)
- Launch 3 Explorers in parallel:
  1. `explorer_survey_codebase`: Explore repository structure, Prisma schema, API routes, Next.js 16 setup, and current implementations.
  2. `explorer_survey_docs`: Analyze docs/FEATURE_EXPERIENCE_MATRIX.md, UX_UI_FLOW.md, OPERATIONS_RUNBOOK.md, RELEASE_CHECKLIST.md, MATRIX_HANDOFF.md, worklog.md.
  3. `explorer_survey_tests`: Inspect existing test suite, `npm run verify` scripts, `test:scenarios`, `test:chain`, database state.
- Output: Synthesize into root `PROJECT.md` and `TEST_INFRA.md`.

## Phase 1: Dual Track Execution
### Track A: E2E Testing Track
- Test infrastructure runner, opaque-box test suites for Tiers 1-4 (>=11*N tests).
- Publishes `TEST_READY.md`.

### Track B: Implementation Milestones
- **M1: Data Safety & Backup (R7)**
  - Safe backup of `db/custom.db`.
  - Record record counts for all core tables.
- **M2: System Audit & Defect Rectification (R1)**
  - File:line audit of views, APIs, business logic (orders, BOM, POS, VAT, ship/COD, loyalty, accounting).
  - Regression tests for all fixes.
- **M3: Bulk Orders & Delivery Note Batch Print (R2)**
  - Multi-select batch confirmation with granular rejection reasons.
  - Batch shipping note generation.
- **M4: VAT Electronic Invoicing XML & Signing Adapter (R3)**
  - Standard XML format (NĐ 123/2020, TT 78/2021, QĐ 1450/QĐ-TCT).
  - Configurable mock adapter / webhook for e-signing.
- **M5: Product Catalog & Price CSV/Excel Import/Export (R4)**
  - Bi-directional import/export with line-by-line validation and atomic safety.
- **M6: P2 Operational Features & Mock Integrations (R5 + R6)**
  - Revenue chart date ranges (7/14/30/90 days).
  - PO draft -> approve -> receive workflow.
  - Drag-and-drop chat image upload.
  - ESC/POS K80 WebUSB/WebSerial + fallback window.print.
  - Auto-shipping fee calculation (GHN/GHTK mock).
  - Auto-birthday VIP Zalo voucher.
  - Shopee / TikTok Shop order simulation drill.
- **M7: Final E2E Pass, UI Visual Verification, Regression & Doc Updates (R7)**
  - Pass 100% E2E test suite (Tiers 1-4).
  - Adversarial hardening (Tier 5).
  - Independent browser UI verification (desktop + 390px mobile screenshots).
  - Clean test data, update documentation.

## Phase 2: Victory Claim & Audit
- Submit formal completion and victory claim to Sentinel for Victory Audit.
