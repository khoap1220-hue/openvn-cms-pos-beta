# Review Report — Milestone 5 (7-Platform Publishing Gateway & Integrations - R5, R6)

**Reviewer**: Reviewer 1 (Quality Reviewer & Adversarial Critic)  
**Target Milestone**: Milestone 5 (`src/lib/publishing-gateway.ts`, `src/app/api/social/publish/route.ts`, `src/app/blog/page.tsx`, `src/app/blog/[slug]/page.tsx`, `scripts/verify-m5-publishing.ts`)  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### A. Verification Commands Executed & Outputs

1. **Milestone 5 Master Verification Suite**:
   ```bash
   npx tsx scripts/verify-m5-publishing.ts
   ```
   **Output**: Exit code 0
   ```
   ================================================================================
   🎉 HOÀN THÀNH KIỂM THỬ MILESTONE 5: 53 passed, 0 failed 🎉
   ================================================================================
   ```

2. **Database Core Table Parity**:
   ```bash
   node scripts/check-counts.mjs
   ```
   **Output**: Exit code 0
   ```
   ======================================================
   Core Business Tables Checked : 24 / 24
   Core Parity Status           : 100% MATCH (PASS)
   ======================================================
   ```
   Delta = 0 across all 24 baseline tables.

3. **Code Quality & Linting**:
   ```bash
   npm run lint
   ```
   **Output**: Exit code 0 (0 errors, 0 warnings across all files).

4. **TypeScript Strict Type Checking**:
   ```bash
   npx tsc --noEmit
   ```
   **Output**: Exit code 1
   ```
   scripts/stress-m5-platforms.ts(876,52): error TS2345: Argument of type '{ channel: string; title: string; content: string; isMock: true; }' is not assignable to parameter of type 'PublishRequest'.
     Property 'postId' is missing in type '{ channel: string; title: string; content: string; isMock: true; }' but required in type 'PublishRequest'.
   ```

5. **Next.js Production Build**:
   ```bash
   npm run build
   ```
   **Output**: Exit code 1
   ```
   ▲ Next.js 16.4.3 (Turbopack)
     Creating an optimized production build ...
   ✓ Compiled successfully in 4.5s
     Running TypeScript ...
   scripts/stress-m5-platforms.ts(876,52): error TS2345: Argument of type '{ channel: string; title: string; content: string; isMock: true; }' is not assignable to parameter of type 'PublishRequest'.
     Property 'postId' is missing in type '{ channel: string; title: string; content: string; isMock: true; }' but required in type 'PublishRequest'.
   Failed to type check.
   ```

6. **Network Spy Safety Invariant (R6)**:
   - Verified that `global.fetch` and `http/https.request` interceptors tracked 0 outbound network socket calls to external platform domains (`facebook.com`, `zalo.me`, `tiktok.com`, `threads.net`, `instagram.com`, `external-store.vn`) during test executions (`outboundHttpAttempts === 0`).

---

### B. Code Inspections & Findings

#### Finding 1 [Critical — Build & Type System Invariant Failure]:
- **Location**: `src/lib/publishing-gateway.ts` line 33 vs `scripts/stress-m5-platforms.ts` line 876
- **Verbatim Code**:
  - `src/lib/publishing-gateway.ts:32-34`:
    ```ts
    export interface PublishRequest {
      postId: string
      channel: SocialPlatform | string
    ```
  - `scripts/stress-m5-platforms.ts:876-881`:
    ```ts
    const res = await websiteBlogAdapter.publish({
      channel: 'WEBSITE',
      title: 'Khám Phá Trà Sen',
      content: 'Nội dung bài viết về nghệ thuật ướp trà sen Phủ Tây Hồ.',
      isMock: true,
    })
    ```
- **Analysis**:
  In `src/lib/publishing-gateway.ts`, every adapter and utility handles `request.postId` as optional:
  - Line 408: `if (request.postId) { await db.socialPost.update(...) }`
  - Line 423: `const externalPostId = request.postId || \`web_\${Date.now()}\``
  - Line 956: `if (request.postId) { const dbPost = await db.socialPost.findUnique(...) }`
  - Line 996: `if (request.postId && result.payloadSnapshot) { ... }`
  Because `postId: string` is declared as strictly required instead of optional `postId?: string`, direct invocations of adapter methods without an existing database post fail type-checking. Because `tsconfig.json` includes `**/*.ts`, `npm run build` and `npx tsc --noEmit` fail with exit code 1.
- **Remediation**:
  In `src/lib/publishing-gateway.ts`, change `postId: string` to `postId?: string` in `interface PublishRequest`, and/or ensure `scripts/stress-m5-platforms.ts` supplies `postId: 'test_stress_web'`.

#### Finding 2 [Major — Architectural Gap: Background Queue Runner Bypasses 7-Platform Gateway]:
- **Location**: `src/app/api/social/schedule/route.ts:1-3` and `src/lib/social-scheduler.ts:168-175`
- **Verbatim Code**:
  - `src/app/api/social/schedule/route.ts:1-3`:
    ```ts
    import { NextRequest, NextResponse } from 'next/server'
    import { processScheduledPosts } from '@/lib/social-scheduler'
    ```
  - `src/lib/social-scheduler.ts:168`:
    ```ts
    let activePublisher: PublisherFunction = defaultMockPublisher
    ```
  - `src/lib/publishing-gateway.ts:1013-1017`:
    ```ts
    try {
      setPublisher(publishPost)
    } catch (err) {
      console.warn('[publishing-gateway] Không thể tự động liên kết với social-scheduler:', err)
    }
    ```
- **Analysis**:
  `publishing-gateway.ts` attempts to register itself with `social-scheduler.ts` via an import-time top-level side effect (`setPublisher(publishPost)`).
  However, `src/app/api/social/schedule/route.ts` (the endpoint invoked by cron/queue runners to publish scheduled posts) ONLY imports `processScheduledPosts` from `@/lib/social-scheduler`. It NEVER imports `@/lib/publishing-gateway`.
  Consequently, in the runtime context of `/api/social/schedule`, `activePublisher` remains `defaultMockPublisher` (the M4 fallback dummy publisher returning `mock_website_...`, `https://website.mock-social.local/p/...`).
  When scheduled posts are published by the background runner in production, they completely bypass the 7-platform publishing gateway: no Facebook, Zalo, Instagram, TikTok, Threads, External CMS, or Website Blog adapter will run, and no website slugs will ever be generated.
- **Remediation**:
  1. In `src/app/api/social/schedule/route.ts`, add `import '@/lib/publishing-gateway'` to ensure gateway registration.
  2. For true architectural robustness: in `src/lib/social-scheduler.ts`, dynamically import `@/lib/publishing-gateway` or directly resolve `publishPost` when `activePublisher === defaultMockPublisher`.

#### Finding 3 [Major — Public Blog Route Interception under Authentication Lock]:
- **Location**: `src/middleware.ts:9-19`
- **Verbatim Code**:
  ```ts
  const PUBLIC_PREFIXES = [
    '/login',
    '/api/auth',
    '/api/webhooks/inbound',
    '/api/barcode',
    '/_next',
    '/sw.js',
    '/logo.svg',
    '/robots.txt',
    '/favicon.ico',
  ]
  ```
- **Analysis**:
  When `CMS_REQUIRE_AUTH === 'true'` or when an operator locks the admin session (`lockCookie === 'true'`), lines 50-70 of `src/middleware.ts` intercept any request not matching `PUBLIC_PREFIXES` and redirect it to `/login`.
  Because `'/blog'` is missing from `PUBLIC_PREFIXES`, enabling CMS admin authentication lock inadvertently makes the public-facing blog inaccessible to store visitors and shoppers, redirecting them to the CMS admin login screen.
- **Remediation**:
  Add `'/blog'` to `PUBLIC_PREFIXES` in `src/middleware.ts`.

#### Finding 4 [Minor / Boundary — Empty String in Media URLs Array]:
- **Location**: `src/lib/publishing-gateway.ts:571` (`InstagramAdapter.validate`) and `src/lib/publishing-gateway.ts:689` (`TikTokAdapter.validate`)
- **Analysis**:
  Both adapters check `!request.mediaUrls || request.mediaUrls.length === 0`.
  If a caller passes an array containing an empty string `['']` or whitespace `['   ']`, `mediaUrls.length` is 1, passing validation. In real API mode, Meta Graph API or TikTok Video API will fail with HTTP 400 bad image/video URL.
- **Remediation**:
  Strengthen validation to:
  ```ts
  const validMedia = (request.mediaUrls || []).filter((u) => u && u.trim().length > 0)
  if (validMedia.length === 0) { ... }
  ```

---

### C. Commendations & Good Practices Observed

1. **Zero Integrity Violations**:
   - Absolutely no dummy stubs, facade shortcuts, or hardcoded test expectations embedded in production code.
   - Genuine platform-specific payload formatting: Meta Graph API v19.0 (attached media, page ID), Zalo OA OpenAPI v2.0 broadcast payload, WordPress/Haravan REST standard, Instagram Graph API 2-step media container + publish, TikTok Video API v2 PULL_FROM_URL structure, and Meta Threads v1.0.
2. **Strict R6 Safety Invariant**:
   - `shouldUseSafeMock` provides multi-layer protection (`NODE_ENV === 'test'`, `ALLOW_REAL_SOCIAL_PUBLISHING !== 'true'`, `forceMock`, `isMock !== false`, valid non-empty credentials).
   - Zero hardcoded secrets, tokens, or credentials in source code.
3. **Next.js 16 App Router Compliance**:
   - `export const dynamic = 'force-dynamic'` verified in `src/app/api/social/publish/route.ts`, `src/app/blog/page.tsx`, and `src/app/blog/[slug]/page.tsx`.
   - Next.js 16 async params (`const { slug } = await params;`) correctly implemented in both `generateMetadata` and `BlogPostPage`.
   - Public blog views feature serene Ưu Đàm brand styling, dynamic OpenGraph metadata, Vietnamese date formatting, and SEO slugification.

---

## 2. Logic Chain

1. **Premise 1**: Acceptance Criteria explicitly demands:
   - "`npm run verify pass 0 lỗi/0 cảnh báo; npm run build thành công; scripts/verify-e2e-suite.ts cũ vẫn pass toàn bộ.`"
   - "`npx tsc --noEmit` pass 0 errors."
2. **Premise 2**: Direct execution of `npm run build` and `npx tsc --noEmit` failed with error `TS2345: Property 'postId' is missing in type ... but required in type 'PublishRequest'` on `scripts/stress-m5-platforms.ts(876,52)`.
3. **Premise 3**: In `src/app/api/social/schedule/route.ts`, the scheduled queue runner for automated publishing does not import `publishing-gateway.ts`. As verified empirically in runtime tests, `activePublisher` remains `defaultMockPublisher`. Scheduled posts published via background cron bypass the 7-platform gateway entirely.
4. **Premise 4**: In `src/middleware.ts`, `'/blog'` is omitted from `PUBLIC_PREFIXES`, causing public article access to be redirected to `/login` if CMS authentication lock is enabled.
5. **Conclusion**: While the core logic of the 7 adapters and public blog pages is well-crafted, the type failure blocking `npm run build`, the decoupled schedule route bypassing the gateway, and the middleware omission violate core acceptance criteria. Therefore, the verdict is **REQUEST_CHANGES**.

---

## 3. Caveats

- Tests executed in development mode on Windows PowerShell environment.
- Live API calls to real social media endpoints were not made (and must not be made per R6).
- Database baseline was verified before and after all test runs; 24/24 core tables matched baseline counts with Delta = 0.

---

## 4. Conclusion

**Verdict**: **REQUEST_CHANGES**

Required actions for approval:
1. Fix type definition in `src/lib/publishing-gateway.ts`: make `postId?: string` optional in `interface PublishRequest`, and/or ensure `scripts/stress-m5-platforms.ts` line 876 passes `postId`. Verify that `npx tsc --noEmit` and `npm run build` pass with 0 errors.
2. In `src/app/api/social/schedule/route.ts`, import `@/lib/publishing-gateway` (or bind `publishPost` directly in `social-scheduler.ts`) so scheduled background runs route through the 7-platform gateway.
3. In `src/middleware.ts`, add `'/blog'` to `PUBLIC_PREFIXES` to ensure public shoppers are never redirected to login when CMS auth is locked.
4. Strengthen Instagram and TikTok media URL validation against empty strings `['']`.

---

## 5. Verification Method

To verify the remediations independently:
```bash
# 1. Master Milestone 5 test suite
npx tsx scripts/verify-m5-publishing.ts

# 2. Adversarial stress suites
npx tsx scripts/stress-m5-platforms.ts
npx tsx scripts/verify-challenger-2-m5.ts

# 3. TypeScript type check (must pass with 0 errors)
npx tsc --noEmit

# 4. ESLint check (must pass with 0 errors, 0 warnings)
npm run lint

# 5. Production build (must succeed)
npm run build

# 6. Database baseline check (must report 100% MATCH, Delta = 0)
node scripts/check-counts.mjs
```
