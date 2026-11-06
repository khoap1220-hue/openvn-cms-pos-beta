## 2026-10-26T13:25:06Z
You are an Explorer subagent for Milestone 1 (M1: CRM Campaigns & DB Safety) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_campaign_api`
Create your working directory and maintain your `progress.md` and `analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Existing API routes in `src/app/api/products/` and `src/app/api/orders/`
4. `AGENTS.md` regarding Next.js 16 breaking changes (`await params`, `force-dynamic`)

## Objective & Scope (M1 - Campaign Service & API Handlers)
1. Design `src/lib/campaign-service.ts`:
   - CRUD functions for Campaign
   - Dynamic boundary state computation function: returns `UPCOMING` if $now < startDate$, `RUNNING` if $startDate \le now \le endDate$, `ENDED` if $now > endDate$, or `CANCELLED`
   - Validation rules: reject if $endDate \le startDate$ with clear 400 error; required name/title, code uniqueness
2. Design Next.js 16 API routes:
   - `src/app/api/campaigns/route.ts` (GET list, POST create)
   - `src/app/api/campaigns/[id]/route.ts` (GET by id, PUT update, DELETE/cancel)
   - Adhere strictly to Next.js 16 requirements: dynamic params must be awaited (`const { id } = await params`), `export const dynamic = 'force-dynamic'`
3. Provide concrete recommendations, request/response JSON schemas, and test scenarios. Explorer recommends strategy, does NOT write code.

## Deliverables
Write your comprehensive analysis to `analysis.md` and 5-component summary in `handoff.md`. Send completion message back to orchestrator.
