## 2026-10-26T14:58:19Z
You are Worker Subagent for Milestone 3 Remediation (M3 Fix) of the AUTO SOCIAL module in OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3_fix`
Create your working directory and maintain your `progress.md` and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. Dispatch directive from Sentinel:
   - Silent template fallback must be eliminated: each draft must store `generationSource: 'LLM' | 'TEMPLATE_FALLBACK'` and `generationMeta: { model: string, latencyMs: number, error?: string }`.
   - Timeout for LLM must be increased to 35-45 seconds (was 6s, causing silent timeout fallback).
   - Template fallback (as safety backup) MUST branch accurately by product category (tea/trà must NOT talk about candle light/wax; ceramics/gốm must NOT talk about aroma/wax; candles talk about wax/light; agarwood talks about sacred scent).
   - Fix Threads copy truncation bug reported by Challenger M3 (`src/lib/social-ai.ts:840`): subtrahend was 25 instead of 31, causing length 506 > 500 limit. Must be strictly <= 500 characters.
   - Clean up any lingering demo campaign records from DB so all 24 baseline tables maintain Delta = 0.
4. `src/lib/social-ai.ts` and `scripts/verify-m3-ai.ts`

## MANDATORY INTEGRITY WARNING
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Write Ownership
You exclusively own and modify:
- `src/lib/social-ai.ts`
- `src/app/api/social/ai-plan/route.ts`
- `src/app/api/social/ai-plan/[id]/route.ts`
- `scripts/verify-m3-ai.ts`
- `scripts/cleanup-test-campaigns.ts` (if needed to clean DB)

## Concrete Fix Tasks
1. Update `src/lib/social-ai.ts`:
   - Increase LLM call timeout to 35,000ms.
   - In `generatePlatformDraft`, record `generationSource: 'LLM' | 'TEMPLATE_FALLBACK'`, `model: string`, `latencyMs: number`, and log any LLM error explicitly.
   - Fix fallback generator `generateFallbackCopy`: detect product category/name and apply category-truthful copy:
     * Tea (`tra`, `trasonthuy`, `hopqua`): calming tea aroma, mindful brewing, warmth.
     * Candle (`nenthom`, `nen`): natural soy wax, warm gentle light.
     * Incense/Agarwood (`tram`, `vong`): sacred wood, tranquility.
     * Pottery/Decor (`gom`, `tranh`): handmade ceramic artisan craft, mindful living space.
   - Fix Threads truncation: ensure length is strictly <= 500 characters.
2. In Route Handlers (`src/app/api/social/ai-plan`):
   - Expose `generationSource` and `generationMeta` in response.
3. In `scripts/verify-m3-ai.ts`:
   - Verify category-truthful fallback and real LLM generation.
   - Verify Threads length <= 500 characters under extreme input.
   - Ensure complete teardown: verify 24 baseline tables maintain Delta = 0.
4. Run `npm run verify` to ensure 0 errors / 0 warnings.

## Deliverables
Document all changes and test outputs in `handoff.md`. Send completion message back to orchestrator.
