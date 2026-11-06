# Handoff Report — Reviewer 2: Milestone 5 Operational Safety & Platform Invariants (R5, R6)

## 1. Observation

- **Reviewed Source Files**:
  - `src/lib/publishing-gateway.ts` (Lines 1–1018):
    - `shouldUseSafeMock` (lines 105–144): Evaluates multi-tier guardrails. Directly checks `process.env.NODE_ENV === 'test'` (line 110), `options?.forceMock === true` (line 115), `process.env.ALLOW_REAL_SOCIAL_PUBLISHING !== 'true'` (line 120), `channelConfig.isMock !== false` (line 125), and credentials parsing inside `try...catch` (lines 134–141).
    - `InstagramAdapter.validate` (lines 566–574):
      ```typescript
      if (!request.mediaUrls || request.mediaUrls.length === 0) {
        throw new Error('Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video')
      }
      ```
    - `TikTokAdapter.validate` (lines 682–692):
      ```typescript
      const isVideo = request.mediaType === 'VIDEO'
      const hasVideo = request.mediaUrls && request.mediaUrls.length > 0
      if (!isVideo || !hasVideo) {
        throw new Error('TikTok bắt buộc phải có tài nguyên video')
      }
      ```
    - `ThreadsAdapter.validate` (lines 796–805):
      ```typescript
      const len = request.content.length
      if (len > 500) {
        throw new Error(`Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: ${len})`)
      }
      ```
    - `publishPost` (lines 950–1010): Dynamic adapter selection via `getAdapter`, DB post lookup, media/field population, and automatic registration with social scheduler via `setPublisher(publishPost)` (line 1014).
  - `src/app/api/social/publish/route.ts` (Lines 1–84):
    - `POST /api/social/publish` enforces non-empty `postId`, invokes `publishPostItem` with Three Iron Gates, returning HTTP 400 for bad requests, HTTP 422 for unapproved posts, HTTP 409 for concurrency conflicts, and HTTP 200 on success.
  - `scripts/verify-m5-publishing.ts` (Lines 1–659):
    - Network spy interceptor (lines 58–80): Replaces `global.fetch` with a host filter `/(facebook|zalo|tiktok|threads|instagram|external-store)/i` that increments `outboundHttpAttempts` and triggers `[SECURITY VETO]`.
    - 10-stage test suite covering baseline audit, 7 adapters, mandatory validation invariants, Vietnamese slugification, dual-mode isolation, E2E scheduler integration, Next.js 16 public blog rendering, route handler direct execution, and database teardown parity.

- **Independent Tool Command Executions & Results**:
  1. `npx tsx scripts/verify-m5-publishing.ts`:
     - Result: Exited with code 0.
     - Verbatim log output:
       `✅ [PASS] Bảo đảm An Toàn Mạng (R6): Số lượng outbound HTTP requests đến nền tảng ngoài = 0`
       `✅ [PASS] BẢO ĐẢM TUYỆT ĐỐI (R6): Không có bất kỳ kết nối mạng nào tới máy chủ MXH bên ngoài`
       `✅ [PASS] InstagramAdapter: Chặn nghiêm ngặt bài viết không có hình ảnh/video`
       `✅ [PASS] TikTokAdapter: Chặn bài viết có mediaType khác VIDEO`
       `✅ [PASS] TikTokAdapter: Chặn bài viết VIDEO nhưng thiếu video URL`
       `✅ [PASS] ThreadsAdapter: Chặn nghiêm ngặt nội dung vượt quá 500 ký tự`
       `🎉 HOÀN THÀNH KIỂM THỬ MILESTONE 5: 53 passed, 0 failed 🎉`
  2. `node scripts/check-counts.mjs`:
     - Result: Exited with code 0.
     - Verbatim summary: `Core Business Tables Checked : 24 / 24`, `Core Parity Status : 100% MATCH (PASS)`.
  3. `npx tsc --noEmit`:
     - Result: Exited with code 0 (0 type errors).
  4. `npm run lint`:
     - Result: Exited with code 0 (0 errors, 0 warnings).

- **Adversarial Integrity Inspection**:
  - Searched for hardcoded mock values or test identifiers (`test_`) in implementation code (`src/lib/publishing-gateway.ts` and `src/app/api/social/publish/route.ts`): None found.
  - Inspected for dummy/facade implementations: All 7 adapters contain full payload formatters and legitimate real-mode API clients (Meta Graph API for Facebook/Instagram/Threads, Zalo OA OpenAPI for Zalo, WordPress/Haravan REST for external CMS, Video Pull for TikTok, and DB slug routing for internal website blog).
  - Inspected for hardcoded secrets/API keys: All credentials and tokens are retrieved dynamically from `db.socialChannelConfig` or environment variables; no static secrets exist in the source code.

## 2. Logic Chain

1. **R6 Test Safety Invariant**:
   - As observed in `src/lib/publishing-gateway.ts` (lines 109–122), `shouldUseSafeMock` is called at the beginning of each adapter's `publish()` method.
   - When running under test conditions (`NODE_ENV === 'test'`), `shouldUseSafeMock` immediately returns `true`. Even outside tests, `ALLOW_REAL_SOCIAL_PUBLISHING !== 'true'` forces `shouldUseSafeMock` to return `true`.
   - Each adapter explicitly branches on `if (isMock)` before reaching any network call, returning a simulated snapshot without establishing socket connections or invoking `global.fetch`.
   - `scripts/verify-m5-publishing.ts` verified that during the entire 53-test execution, `outboundHttpAttempts` remained strictly 0, satisfying R6 test safety invariants.

2. **Platform Invariant Enforcements**:
   - **Instagram Media Requirement**: `InstagramAdapter.validate` checks `!request.mediaUrls || request.mediaUrls.length === 0`. If triggered, it throws an informative error before payload formatting or dispatching.
   - **TikTok Video Asset Requirement**: `TikTokAdapter.validate` checks `request.mediaType !== 'VIDEO'` or empty `mediaUrls`. Both conditions throw an error, preventing non-video or asset-less content from reaching TikTok.
   - **Threads 500-Character Constraint**: `ThreadsAdapter.validate` checks `request.content.length > 500`. Exceeding 500 characters throws immediately with current character count in the error message.
   - In all adapters, `this.validate(request)` is executed as the first line of `publish()`, ensuring that neither Safe Mock nor Real API mode can bypass platform validation rules.

3. **Dual-Mode Switching Logic**:
   - Mode switching is governed by `shouldUseSafeMock`, which uses a strict defensive hierarchy:
     1) `NODE_ENV === 'test'` -> Safe Mock
     2) `forceMock === true` -> Safe Mock
     3) `ALLOW_REAL_SOCIAL_PUBLISHING !== 'true'` -> Safe Mock
     4) `!channelConfig || channelConfig.isMock !== false` -> Safe Mock
     5) `!channelConfig.credentials` or unparseable/empty JSON -> Safe Mock
     6) Only when valid credentials exist and live publishing is explicitly enabled does Real Mode activate.
   - Real-mode calls are wrapped in `try...catch` blocks that format error strings into structured responses (`{ success: false, error: ... }`) without unhandled crashes, satisfying R6 resilience requirements.

4. **Database Non-Regression & E2E Integration**:
   - `scripts/verify-m5-publishing.ts` creates and publishes posts across multiple platforms via `social-scheduler`'s Three Iron Gates, tests route handler `POST /api/social/publish`, and tears down all test entities in `finally {}`.
   - Independent verification via `node scripts/check-counts.mjs` confirmed 24/24 core tables maintained 100% parity with zero delta.

## 3. Caveats

- **No Caveats**. Real-mode live publishing to production Meta/TikTok/Zalo endpoints was not executed, which is by design and strictly required by Acceptance Criterion R6 to prevent live social postings during agent testing.

## 4. Conclusion

- **Verdict**: **APPROVE**
- **Assessment**:
  - The implementation in `src/lib/publishing-gateway.ts` and `src/app/api/social/publish/route.ts` strictly satisfies all operational safety requirements (R5, R6) and platform invariants.
  - Zero outbound HTTP requests are made during testing.
  - All 3 platform constraints (Instagram media, TikTok video, Threads 500 chars) are enforced via strict validation exceptions.
  - No integrity violations, dummy facades, or hardcoded shortcuts were detected.
  - All 53 automated tests pass, database parity is 100% preserved, and TypeScript/ESLint checks pass with 0 errors.

## 5. Verification Method

To independently reproduce and verify this review:

1. **Verify M5 Publishing Test Suite & Network Spy Invariant**:
   ```powershell
   npx tsx scripts/verify-m5-publishing.ts
   ```
   *Expected*: Code 0, `53 passed, 0 failed`, 0 outbound HTTP socket attempts.

2. **Verify 24-Table Baseline Database Parity**:
   ```powershell
   node scripts/check-counts.mjs
   ```
   *Expected*: Code 0, `Core Parity Status : 100% MATCH (PASS)`.

3. **Verify Type Safety & Linting**:
   ```powershell
   npx tsc --noEmit
   npm run lint
   ```
   *Expected*: Code 0, 0 errors, 0 warnings.
