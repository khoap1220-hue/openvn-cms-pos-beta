## 2026-10-26T07:40:12Z
You are test_writer_e2e, the E2E Test Writer for OPENVN · Ưu Đàm Suite.
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\test_writer_e2e
Your parent conversation ID is: 7124d145-f8bf-4670-a0d0-13114c2b24e3

MANDATORY FIRST STEPS:
Read these files:
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\TEST_INFRA.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_survey_3\handoff.md

FILE OWNERSHIP:
You exclusively own:
- scripts/verify-r1-regressions.ts
- scripts/verify-r2-bulk-orders.ts
- scripts/verify-r3-einvoice-xml.ts
- scripts/verify-r4-catalog-csv-excel.ts
- scripts/verify-r5-p2-features.ts
- scripts/verify-e2e-suite.ts
- TEST_READY.md (at project root)
You must NOT modify any application source code in src/, prisma/, or db/custom.db.

YOUR MISSION:
Design and implement the comprehensive requirement-driven, opaque-box E2E test suites (Tiers 1-4) matching all acceptance criteria in ORIGINAL_REQUEST.md and TEST_INFRA.md:
1. scripts/verify-r1-regressions.ts:
   - Test transaction atomicity on order cancellation (status, stock, combo sync).
   - Test transaction atomicity on shipment RETURNED.
   - Test duplicate phone prevention when creating customer.
   - Assert all regression guards pass cleanly.
2. scripts/verify-r2-bulk-orders.ts:
   - Test POST /api/orders/bulk-confirm on a mixed batch (valid orders, cancelled orders, insufficient stock).
   - Assert only valid orders are confirmed.
   - Assert detailed rejection reasons are returned for every rejected order.
   - Assert stock ledger chain integrity (test:chain) remains 100% valid.
3. scripts/verify-r3-einvoice-xml.ts:
   - Test GET /api/sales-invoices/[id]/xml against NĐ 123/2020, TT 78/2021, QĐ 1450/QĐ-TCT.
   - Assert mandatory XML elements (<HDon>, <DLHDon>, <TTChung>, <NBan>, <NMua>, <DSHangHoa>, <TToan>).
   - Assert total amount in XML matches invoice amount and total in words.
   - Assert cancelled invoice returns HTTP 400 error and cannot produce valid XML.
   - Test mock digital signing adapter.
4. scripts/verify-r4-catalog-csv-excel.ts:
   - Test export -> re-import round-trip: data and prices remain identical.
   - Test import file with N invalid rows: returns exactly N line-numbered errors and does NOT write corrupted data to DB.
5. scripts/verify-r5-p2-features.ts:
   - Test dashboard revenue daily aggregation for 7, 14, 30, 90 day ranges matching direct DB aggregation.
   - Test PO workflow: draft -> approve does not alter stock; receiving (full and partial) increases stock by exact received quantity; StockMovement records are created.
   - Test ESC/POS K80 byte sequence encoder (paper cut command GS V, Vietnamese encoding), and fallback to window.print.
   - Test GHN/GHTK auto shipping fee calculation mock.
   - Test VIP customer birthday voucher idempotency: running twice on the same day sends only once per customer.
   - Test Shopee / TikTok Shop order simulation drill.
6. scripts/verify-e2e-suite.ts:
   - Runner that executes all verification scripts and outputs aggregate results.
7. Publish TEST_READY.md at project root:
   - Complete coverage table across Tiers 1-4, test runner command, pass criteria.
8. Run the scripts using node --experimental-strip-types to verify their syntax and behavior.
9. Write a comprehensive handoff.md in your working directory and notify parent (7124d145-f8bf-4670-a0d0-13114c2b24e3).
