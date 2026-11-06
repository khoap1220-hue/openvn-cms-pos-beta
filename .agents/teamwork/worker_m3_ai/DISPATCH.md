## 2026-10-26T14:20:27Z
You are Worker Subagent for Milestone 3 (M3: AI Planning & Copywriting Engine) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3_ai`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. `src/lib/campaign-service.ts` (M1 ↔ M3 contract, `enrichCampaignData`)
4. `src/lib/llm.ts` and `src/lib/agent-voice.ts` (`BANNED_PHRASES`, tone rules)
5. `prisma/schema.prisma` (`SocialPlan`, `SocialPost` models lines 540-600)
6. `AGENTS.md` regarding Next.js 16 conventions (`await params`, `export const dynamic = 'force-dynamic'`)

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership (Exclusively Owned Files)
You own and may create or modify ONLY these files:
- `src/lib/social-ai.ts`
- `src/app/api/social/ai-plan/route.ts`
- `src/app/api/social/ai-plan/[id]/route.ts`
- `scripts/verify-m3-ai.ts`

## Tasks to Implement (FEAT-AI-01 to FEAT-AI-05)
1. **AI Planning & Copywriting Engine (`src/lib/social-ai.ts`)**:
   - `generateSocialPlan(campaignId: string, options)`: fetches enriched campaign data via `getCampaign(campaignId)` and `enrichCampaignData`, designs a multi-post content calendar spread across the campaign's `startDate` to `endDate`, assigning target platforms and posting dates.
   - `generatePlatformDraft(params)`: generates draft copy adapted to the target platform:
     * Facebook: engaging storytelling, mindful tone, product benefits, clear promotional offer.
     * Zalo OA: respectful, concise, broadcast-ready notification style.
     * Website Blog: title + slug + contemplative markdown blog post (800+ words).
     * External CMS (WordPress/Haravan/Sapo): promotional ecommerce style with price and discount highlight.
     * Instagram: aesthetic lifestyle copy, visual-first, curated hashtags (`#uudam #nenthom #chualanh #binhyen`).
     * TikTok: short video script format (0.1s Hook -> Empathy -> Product spotlight -> CTA).
     * Threads: concise, conversational, strictly $\le 500$ characters limit.
   - **Ưu Đàm Brand Voice & Anti-AI Filter**:
     * Strict elimination of `BANNED_PHRASES` from `src/lib/agent-voice.ts` ("kính chào", "quý khách", "hân hạnh", "trải nghiệm tuyệt vời"...).
     * Serene, mindful, authentic tone (xưng "tụi em", "Ưu Đàm").
   - **Deterministic CRM Invariant Matcher**:
     * Code-level regex validator ensuring generated copy contains exact campaign values: discount %, voucher code (if applied), and product price.
     * If AI hallucinated a wrong price or code, the deterministic matcher corrects it or regenerates.
   - **Rubric Evaluator (Gate $\ge 8.0/10$)**:
     * 4-criterion automated rubric:
       1. CRM Data Accuracy (weight 30%): exact prices, discount %, vouchers.
       2. Ưu Đàm Brand Voice (weight 30%): zero banned phrases, peaceful contemplative tone.
       3. Platform Formatting (weight 20%): character limits, platform conventions.
       4. Call to Action (weight 20%): natural, non-pushy invitation.
     * Pass threshold: total score $\ge 8.0/10$.
2. **Next.js 16 Route Handlers**:
   - `src/app/api/social/ai-plan/route.ts`:
     * POST: accept `{ campaignId: string, platforms?: string[], postsCount?: number, contentSourceId?: string }`, generate plan & drafts, save `SocialPlan` and draft `SocialPost` records, return plan with rubric scores.
     * GET: list generated social plans.
   - `src/app/api/social/ai-plan/[id]/route.ts`:
     * GET: get plan details with child posts and rubric evaluation results.
     * Next.js 16 compliance: `export const dynamic = 'force-dynamic'`, `const { id } = await params`.
3. **Automated Verification Suite (`scripts/verify-m3-ai.ts`)**:
   - Verify calendar generation within campaign time boundaries.
   - Verify platform draft generation across all 7 platforms (Threads <= 500 chars, TikTok script structure, Blog markdown).
   - Verify brand voice filter (0 banned phrases across all drafts).
   - Verify deterministic CRM matcher (exact match on prices, discounts, vouchers).
   - Verify rubric scoring engine evaluating 10 sample drafts with all scores $\ge 8.0/10$.
   - Verify database clean teardown and baseline table invariance ($\Delta = 0$).
4. **Regression Check**: Run `npm run verify` to verify 0 errors / 0 warnings.
