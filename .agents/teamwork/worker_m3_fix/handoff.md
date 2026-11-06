# Handoff Report — Milestone 3 Remediation (M3 Fix)

## 1. Observation
- **Original Silent Fallback**: In `src/lib/social-ai.ts`, when Gemini/LLM timed out or failed (due to invalid API key in DB or slow network), the system silently fell back to `generateAlgorithmicDraft` without recording whether the output originated from LLM or template, and without metadata on model name, latency, or errors.
- **Timeout Limitation**: The timeout in `generatePlatformDraft` was set to 6,000ms (`signal: AbortSignal.timeout(6000)`), causing any normal LLM inference exceeding 6s to abort and fall back silently.
- **Category Inaccuracies in Fallback Copy**: The algorithmic fallback in `generateAlgorithmicDraft` previously used generic candle-centric descriptions (`sáp nến đậu nành`, `đốm sáng nhỏ`, `ánh nến lung linh`, `hương thơm tinh dầu`) regardless of product category, resulting in tea products (`Hộp quà tặng trà sơn thủy`), ceramics (`Tranh gốm hoa mẫu đơn`), or agarwood incense talking about flickering candles and soy wax.
- **Threads Truncation Bug (Challenger M3 Finding)**: In `src/lib/social-ai.ts`, the Threads branch computed `content = content.slice(0, 500 - 25) + suffix`. Due to Unicode characters and emoji length in `suffix`, the final character length reached 506 characters (> 500 character limit), failing the hard constraint.
- **Verification Commands & Results**:
  1. `npx tsx scripts/verify-m3-ai.ts`:
     ```
     🏆 KẾT THÚC KIỂM THỬ M3 FIX THÀNH CÔNG! ĐẠT: 194, LỖI: 0 🏆
     ✅ [PASS] Đối soát CSDL: 100% 24 bảng baseline ban đầu nguyên vẹn tuyệt đối (Delta = 0)
     ```
  2. `npm run verify`:
     ```
     tsc --noEmit -> 0 errors
     npm run lint -> 0 errors / 0 warnings
     npm run test:chain -> passed
     npm run test:scenarios -> 21/21 scenarios passed (failed: 0)
     Exit code 0
     ```
  3. `npx tsx scripts/cleanup-test-campaigns.ts`:
     ```
     Đã thực hiện WAL checkpoint FULL
     ✅ 100% 24 bảng cốt lõi khớp chuẩn xác tuyệt đối với baseline-counts.json (Delta = 0)!
     ```

## 2. Logic Chain
1. **Explicit Source & Meta Tracking**:
   - In `src/lib/social-ai.ts`, added `GenerationMeta` and updated `PlatformDraft` to include `generationSource: 'LLM' | 'TEMPLATE_FALLBACK'` and `generationMeta: { model: string, latencyMs: number, error?: string }`.
   - In `generatePlatformDraft`, wrapped LLM calls with performance timing (`performance.now()`), 35,000ms timeout (`AbortSignal.timeout(35000)`), and an explicit console error logger if LLM fails.
   - When LLM succeeds, `generationSource = 'LLM'` with actual latency and model name. When LLM fails, `generationSource = 'TEMPLATE_FALLBACK'` with captured error message and fallback model `template-algorithmic-v2`.
   - In `createAndPersistSocialPlan`, `generationSource` and `generationMeta` are serialized into `payloadSnapshot` and attached to `SocialPost` returned records.
   - In Route Handlers (`src/app/api/social/ai-plan/route.ts` and `src/app/api/social/ai-plan/[id]/route.ts`), `generationSource` and `generationMeta` are exposed in API responses and persisted plans.
2. **Category-Truthful Algorithmic Copywriting**:
   - Implemented `detectProductCategory(product)` with rigorous boundary and keyword matching:
     - `INCENSE`: Checked first with `ud-tram-` and `tram` to avoid prefix conflicts with `ud-tra`.
     - `CERAMIC`: Checked with `gom`, `tranh gom`, `tranh` to avoid substring collision with `tra`.
     - `TEA`: Checked with word boundary `/\btra\b/` and `ud-tra-`.
     - `CANDLE`: Checked with `nen`, `sap`.
   - Updated copy generation across all 7 channels (`FACEBOOK`, `ZALO_OA`, `WEBSITE`, `EXTERNAL_CMS`, `INSTAGRAM`, `TIKTOK`, `THREADS`):
     - Tea copy focuses exclusively on calm aroma, warm teaware, and mindfulness. Zero candle wax, flame, or light.
     - Candle copy focuses on soy wax, natural cotton wick, and gentle ambient flame.
     - Incense copy focuses on sacred wood, tranquility, and natural forest scent.
     - Ceramic copy focuses on handmade artisan craftsmanship, earth & water, and men lam glaze. Zero wax or flame.
   - Updated `evaluateDraftRubric` so category-appropriate hashtags (`#uudamtra`, `#tramhuong`, `#gomuudam`) are accepted without forcing candle-specific hashtags.
3. **Threads Boundary Invariant Protection**:
   - In `src/lib/social-ai.ts`, replaced static subtrahends with dynamic length calculation: `const maxContentLen = 500 - suffix.length;`.
   - Added an absolute invariant clamp: `if (content.length > 500) content = content.slice(0, 500);`.
   - Tested under extreme stress test inputs (product titles > 150 chars, extreme vouchers, high prices): character length is verified <= 500 chars across all iterations.
4. **Deterministic Unit Testing & DB Safety**:
   - Added `llmCaller` injection option to `generatePlatformDraft` to allow genuine testing of both real LLM execution paths and template fallback paths.
   - Integrated full cleanup in `scripts/verify-m3-ai.ts` and `scripts/cleanup-test-campaigns.ts` with SQLite `PRAGMA wal_checkpoint(FULL)` to guarantee all 24 baseline tables maintain exact record counts (Delta = 0).

## 3. Caveats
- No external Gemini API keys are hardcoded in source code; if DB integration credentials for Gemini are invalid or unconfigured, the system gracefully and transparently marks `generationSource: 'TEMPLATE_FALLBACK'` with the exact error details in `generationMeta`.
- No caveats regarding code functionality or database integrity.

## 4. Conclusion
- All M3 remediation requirements dispatched by the Sentinel and Orchestrator have been implemented, tested, and verified:
  1. Silent template fallback eliminated: `generationSource` and `generationMeta` are recorded on all drafts and persisted in database records.
  2. LLM timeout increased to 35,000ms with explicit error logging.
  3. Category-truthful copy enforced across Tea, Candle, Incense, and Ceramic products.
  4. Threads length bug resolved with guaranteed <= 500 character invariant.
  5. Full project verification `npm run verify` passed with 0 errors and 0 warnings.
  6. Database state verified: 100% of 24 baseline tables maintain Delta = 0.

## 5. Verification Method
To independently verify this implementation:
1. Run M3 AI Verification Suite:
   `npx tsx scripts/verify-m3-ai.ts`
   Expected: 194 assertions pass, 0 errors, DB delta = 0 across 24 tables.
2. Run Database Baseline Audit:
   `npx tsx scripts/cleanup-test-campaigns.ts`
   Expected: "100% 24 bảng cốt lõi khớp chuẩn xác tuyệt đối với baseline-counts.json (Delta = 0)!"
3. Run Full Project Verification Suite:
   `npm run verify`
   Expected: `tsc --noEmit`, `eslint`, `test:chain`, and `test:scenarios` all pass with exit code 0.
