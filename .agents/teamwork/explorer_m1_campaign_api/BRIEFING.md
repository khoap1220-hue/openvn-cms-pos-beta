# BRIEFING — 2026-10-26T13:32:00Z

## Mission
Investigate and design Campaign Service (`src/lib/campaign-service.ts`) and Next.js 16 API routes (`/api/campaigns`, `/api/campaigns/[id]`) with dynamic boundary state computation and validation for M1.

## 🔒 My Identity
- Archetype: explorer
- Roles: investigation, synthesis
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m1_campaign_api
- Original parent: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Milestone: M1 (Campaign Service & API Handlers)

## 🔒 Key Constraints
- Read-only investigation — do NOT implement in `src/`, output in working directory
- Adhere strictly to Next.js 16 requirements: dynamic params must be awaited (`const { id } = await params`), `export const dynamic = 'force-dynamic'`
- Dynamic boundary state computation: `UPCOMING` (now < startDate), `RUNNING` (startDate <= now <= endDate), `ENDED` (now > endDate), `CANCELLED`
- Validation rules: reject if endDate <= startDate with 400, require name/title, ensure code uniqueness (409)
- Next.js breaking changes guide in `node_modules/next/dist/docs/`

## Current Parent
- Conversation ID: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Updated: 2026-10-26T13:32:00Z

## Investigation State
- **Explored paths**:
  - `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
  - `src/app/api/products/route.ts` & `src/app/api/products/[id]/route.ts`
  - `src/app/api/orders/route.ts` & `src/app/api/orders/[id]/route.ts`
  - `src/lib/order-service.ts`, `src/lib/warehouse-service.ts`, `src/lib/ledger.ts`, `src/lib/realtime.ts`
  - `prisma/schema.prisma` & `db/baseline-counts.json`
- **Key findings**:
  - Next.js 16 requires awaiting params in dynamic route handlers: `const { id } = await params`
  - Zero-drift boundary computation function `computeCampaignStatus` accurately evaluates `UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED` with millisecond precision
  - Complete TypeScript signatures and full code blueprint drafted in `analysis.md`
- **Unexplored areas**: None for M1 Campaign API scope.

## Key Decisions Made
- `CampaignData` interface satisfies M1 ↔ M3 interface contract from `orchestrator_2/PROJECT.md`
- Store `appliedProductIds` and `appliedVoucherIds` as JSON arrays to guarantee 0 regressions and 0 schema modifications to existing `Product` and `Voucher` tables
- Safe deletion policy: chuyển `CANCELLED` nếu chiến dịch đang chạy hoặc có liên kết, tránh mồ côi dữ liệu lịch sử
- Documented full implementation ready for Worker M1

## Artifact Index
- DISPATCH.md — incoming task dispatch
- BRIEFING.md — persistent state memory
- progress.md — liveness heartbeat
- analysis.md — complete technical design & recommendations
- handoff.md — 5-component handoff report
