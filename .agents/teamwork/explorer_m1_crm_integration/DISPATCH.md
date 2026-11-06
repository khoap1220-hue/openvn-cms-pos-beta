## 2026-10-26T13:25:06Z
You are an Explorer subagent for Milestone 1 (M1: CRM Campaigns & DB Safety) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_crm_integration`
Create your working directory and maintain your `progress.md` and `analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Current `Product` and `Voucher` models in `prisma/schema.prisma`
4. Existing products and vouchers in `db/custom.db` (12 products, 4 vouchers)

## Objective & Scope (M1 - Product & Voucher Linkage & Pricing Logic)
1. Detail how campaigns associate with products and vouchers:
   - Handling selection of multiple product IDs and voucher IDs (JSON field vs relation table, ensuring zero regression to existing models)
   - Pricing calculations: fetching regular product prices, applying campaign discount % or campaign special price, calculating voucher discount (percentage or fixed amount, min order value)
   - How `campaign-service.ts` enriches campaign details with live product/voucher data
2. Design a standalone verification script `scripts/verify-m1-campaigns.ts` that will verify:
   - DB backup existence and integrity
   - Campaign creation with products and vouchers
   - Real-time boundary state transitions (past, present, future dates)
   - Edge case validation ($endDate \le startDate$ rejection)
   - Zero regression check on 24 baseline tables
   - Teardown of test campaign records
3. Explorer recommends strategy, does NOT write code.

## Deliverables
Write your comprehensive analysis to `analysis.md` and 5-component summary in `handoff.md`. Send completion message back to orchestrator.
