# BRIEFING — 2026-10-26T14:32:00Z

## Mission
Implement Milestone 3 (M3: AI Planning & Copywriting Engine) of the AUTO SOCIAL module: AI calendar generator, platform copywriter (7 channels), anti-AI brand voice filter, deterministic CRM invariant matcher, automated rubric evaluator, Next.js 16 route handlers, and verification test suite.

## 🔒 My Identity
- Archetype: worker
- Roles: implementer, qa, specialist
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3_ai
- Original parent: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Milestone: M3 (AI Planning & Copywriting Engine)

## 🔒 Key Constraints
- Exclusively owned files:
  * `src/lib/social-ai.ts`
  * `src/app/api/social/ai-plan/route.ts`
  * `src/app/api/social/ai-plan/[id]/route.ts`
  * `scripts/verify-m3-ai.ts`
- DO NOT CHEAT: Genuine logic, real state maintenance, zero hardcoding.
- Strict brand voice adherence: eliminate BANNED_PHRASES from `agent-voice.ts`.
- Deterministic CRM matcher: exact match on prices, discounts, and vouchers.
- Rubric evaluator: 4 criteria (CRM Accuracy 30%, Voice 30%, Formatting 20%, CTA 20%) with pass >= 8.0/10.
- Next.js 16 conventions: `await params`, `export const dynamic = 'force-dynamic'`.
- Database safety: zero alteration to 24 baseline tables ($\Delta = 0$).

## Current Parent
- Conversation ID: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Updated: 2026-10-26T14:32:00Z

## Task Summary
- **What to build**:
  1. `src/lib/social-ai.ts`: Multi-platform content calendar generator, copywriter for 7 channels (Facebook, Zalo OA, Website Blog, External CMS, Instagram, TikTok, Threads), Ưu Đàm Anti-AI voice filter, deterministic CRM invariant matcher, and rubric evaluator (>= 8.0/10).
  2. `src/app/api/social/ai-plan/route.ts`: POST (plan generation & post saving) and GET (list plans).
  3. `src/app/api/social/ai-plan/[id]/route.ts`: GET plan with posts & rubric score, DELETE plan.
  4. `scripts/verify-m3-ai.ts`: Automated verification test suite.
- **Success criteria**: All automated tests pass (160/160 assertions), zero baseline table drift (Delta = 0), `npm run verify` passes with 0 errors / 0 warnings.
- **Interface contracts**: `PROJECT.md` M1 ↔ M3 and M2 ↔ M3 contracts.

## Change Tracker
- **Files modified**:
  * `src/lib/social-ai.ts` (created) — AI calendar & platform copywriting engine, anti-AI voice filter, CRM invariant matcher, rubric evaluator.
  * `src/app/api/social/ai-plan/route.ts` (created) — POST plan generator & child posts persistence, GET list.
  * `src/app/api/social/ai-plan/[id]/route.ts` (created) — GET plan details with decoded rubric, DELETE plan with cascade.
  * `scripts/verify-m3-ai.ts` (created) — 9-phase verification suite with 160 assertions.
- **Build status**: PASS (`tsc --noEmit`, `eslint src`, `npm run verify` 0 errors / 0 warnings).
- **Pending issues**: None.

## Quality Status
- **Build/test result**: PASS. `npm run verify` (tsc, eslint, test:chain, test:scenarios 21/21 passed).
- **Lint status**: 0 violations.
- **Tests added/modified**: `scripts/verify-m3-ai.ts` (160 assertions, 0 failed, 100% 24 tables match baseline Delta = 0).

## Loaded Skills
- None specified for this task.

## Artifact Index
- `.agents/teamwork/worker_m3_ai/DISPATCH.md` — assignment
- `.agents/teamwork/worker_m3_ai/BRIEFING.md` — persistent memory
- `.agents/teamwork/worker_m3_ai/progress.md` — heartbeat & progress
- `.agents/teamwork/worker_m3_ai/handoff.md` — handoff report
