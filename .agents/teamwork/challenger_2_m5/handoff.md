# Handoff Report — Milestone 5 Challenger 2
**Agent**: Challenger 2 (End-to-End Scheduling & Blog Rendering Challenger)  
**Role**: critic, specialist  
**Scope**: `src/lib/publishing-gateway.ts`, `src/lib/social-scheduler.ts`, `src/app/blog/page.tsx`, `src/app/blog/[slug]/page.tsx`  
**Verdict**: **APPROVE**  

---

## 1. Observation

### Empirical Test Execution
We implemented and executed an empirical stress harness in `scripts/verify-challenger-2-m5.ts`. The script executed 46 test assertions across 6 adversarial phases:

```
================================================================================
🏁 KẾT QUẢ KIỂM THỬ: 46 / 46 ĐẠT (PASS)
❌ THẤT BẠI: 0
================================================================================
```

### Direct Tool Outputs & Data Evidence
1. **End-to-End Website Publishing & Slug Generation**:
   - `createPost` with `channel: 'WEBSITE'`, `title: 'Ưu Đàm — Nét Đẹp Thiền Trà & Trầm Hương Tĩnh Tại 2026'`.
   - Post approved via `approvePost(post1.id)`.
   - Published via `publishPostItem(post1.id)`:
     ```json
     {
       "success": true,
       "postId": "cmvpi2nnq0001ve58m5p3w435",
       "externalPostId": "cmvpi2nnq0001ve58m5p3w435",
       "externalPostUrl": "/blog/uu-dam-net-dep-thien-tra-tram-huong-tinh-tai-2026-cmvpi2nn",
       "publishedAt": "2026-10-26T16:57:48.337Z",
       "isMockResult": true
     }
     ```
   - Database record inspection (`SocialPost` table):
     - `status === 'PUBLISHED'`
     - `slug === 'uu-dam-net-dep-thien-tra-tram-huong-tinh-tai-2026-cmvpi2nn'` (accent-stripped and URL-safe)
     - `externalPostUrl === '/blog/uu-dam-net-dep-thien-tra-tram-huong-tinh-tai-2026-cmvpi2nn'`
     - `isPublishing === false`
     - `payloadSnapshot` and `responseSnapshot` populated.
   - `AuditLog` inspection: Exactly 1 record with `entityType: 'SocialPost'`, `action: 'PUBLISH'`, `status: 'SUCCESS'`.

2. **Custom Slug Preservation**:
   - Post created with explicit `slug: 'cau-chuyen-tra-tram-ha-noi'`.
   - Published via `publishPostItem`: `dbPost.slug === 'cau-chuyen-tra-tram-ha-noi'` and `externalPostUrl === '/blog/cau-chuyen-tra-tram-ha-noi'`.

3. **Scheduled Queue Runner Execution**:
   - Post scheduled in the past (`scheduledAt: new Date(Date.now() - 5000)`).
   - `processScheduledPosts(new Date())` scanned and published the post: `queueResult.processed >= 1`, status became `PUBLISHED`, slug generated, `externalPostUrl: '/blog/${slug}'`.

4. **Blog Rendering & 404 Security Guard**:
   - `generateMetadata`:
     - Published post: Title contained the post title, description matched excerpt, OpenGraph `type: 'article'`, images included media URLs.
     - Non-existent slug: Returned fallback title `"Bài viết không tìm thấy | Ưu Đàm"`.
   - `BlogPostPage`:
     - Published post: Successfully returned JSX React element tree without errors.
     - Non-existent slug: Strictly called `notFound()`, throwing `Error: NEXT_HTTP_ERROR_FALLBACK;404`.
     - `DRAFT` post: Strictly triggered `notFound()` (`NEXT_HTTP_ERROR_FALLBACK;404`).
     - `REJECTED` post: Strictly triggered `notFound()` (`NEXT_HTTP_ERROR_FALLBACK;404`).
     - Published post on non-website channel (e.g. `channel: 'FACEBOOK'`): Strictly triggered `notFound()`, proving channel boundary isolation.
   - `BlogListPage`:
     - Successfully rendered the public blog feed JSX element tree.

5. **Concurrency Stress Testing**:
   - **Multi-Platform Burst (14 concurrent publishes)**: 14 simultaneous publishes across 7 platforms (2x FACEBOOK, 2x ZALO_OA, 2x WEBSITE, 2x EXTERNAL_CMS, 2x INSTAGRAM, 2x TIKTOK, 2x THREADS) executed via `Promise.allSettled()`. Result: 14/14 fulfilled with `success: true`, 0 errors, 0 socket leaks.
   - **Atomic Concurrency Idempotency Lock on Single Post (10 simultaneous calls)**: 10 parallel calls to `publishPostItem(postId)` using `Promise.all()`. Result: Exactly 1 call succeeded (`success: true`), 9 calls failed with `reason: 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS'`. Database record remained `PUBLISHED` with `isPublishing: false`. Exactly 1 `PUBLISH` AuditLog was generated.
   - **Queue Runner Race Condition (2 concurrent runners on 3 posts)**: 2 parallel executions of `processScheduledPosts()`. Total published posts across runners equaled 3 (runner A published 3, runner B published 0, or vice versa). Exactly 1 `PUBLISH` AuditLog created per post. 0 duplicate publishes.

6. **Network Spy & Security Invariant (FEAT-PUB-08, R6)**:
   - A global network spy intercepted all outbound HTTP/HTTPS requests to social network domains. Total disallowed outbound requests: 0.

7. **Database Parity Audit (Zero Invariance)**:
   - Post-test run of `node scripts/check-counts.mjs`:
     ```
     ======================================================
     Core Business Tables Checked : 24 / 24
     Core Parity Status           : 100% MATCH (PASS)
     ======================================================
     ```

---

## 2. Logic Chain

1. **Premise 1 (Publishing Pipeline Integrity)**: In `src/lib/publishing-gateway.ts` (`WebsiteBlogAdapter.publish`), when a post is published, it checks for an existing slug or generates one via `generateUniqueSlug(request.title, request.postId)`. It then updates the post in SQLite and formats `externalPostUrl = '/blog/' + slug`. In `src/lib/social-scheduler.ts` (`publishPostItem`), it updates status to `PUBLISHED`, clears `isPublishing`, sets `externalPostUrl`, and writes an `AuditLog` entry.
   - *Evidence*: Observed in Test 2.1, 2.2, and 2.3 where `dbPost1.slug` and `dbPost1.externalPostUrl` were verified directly from the database and AuditLog was verified.

2. **Premise 2 (Public Blog Routing & Security Boundary)**: In `src/app/blog/[slug]/page.tsx`, both `generateMetadata` and `BlogPostPage` query `db.socialPost.findFirst` with `{ where: { channel: 'WEBSITE', status: 'PUBLISHED', slug } }`.
   - *Evidence*: Non-existent slugs, drafts, rejected posts, and Facebook posts all returned `null` from this query and correctly invoked `notFound()`, which threw `NEXT_HTTP_ERROR_FALLBACK;404`. Valid published website posts rendered properly with full JSX metadata and article body.

3. **Premise 3 (High Concurrency & Idempotency)**: In `src/lib/social-scheduler.ts` (lines 744-755), an atomic `db.socialPost.updateMany` lock checks `isPublishing: false` and `status in ['APPROVED', 'SCHEDULED']` before any publishing adapter is invoked.
   - *Evidence*: In the 10-thread parallel race test, exactly 1 thread updated 1 row and acquired the lock, while the remaining 9 threads received `lockResult.count === 0` and returned `CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS`. In the 14-thread multi-platform burst test, all 14 independent posts were published simultaneously without lock contention or platform adapter crosstalk.

4. **Premise 4 (Zero Outbound Network Leakage & Clean Teardown)**: In safe mock mode (test mode), all platform adapters return mock payloads without opening network sockets. All created test posts and audit logs were deleted in the `finally` block of the test harness.
   - *Evidence*: Network spy logged 0 outbound socket attempts; `node scripts/check-counts.mjs` confirmed 24/24 core tables matched baseline counts with Delta = 0.

5. **Conclusion**: Milestone 5's end-to-end publishing, slug generation, public blog rendering, 404 security enforcement, and concurrency locking mechanisms operate robustly and satisfy all design invariants.

---

## 3. Caveats

1. **Module Bundling / Tree-Shaking Discipline**: `src/lib/publishing-gateway.ts` registers itself with `social-scheduler` at top-level via `setPublisher(publishPost)`. If an external script imports `social-scheduler` without referencing `publishing-gateway` or importing it for side-effects (`import '@/lib/publishing-gateway'`), bundlers that eliminate unused imports might not execute that registration, causing `social-scheduler` to fallback to `defaultMockPublisher`. In application entry points (`src/app/api/social/publish/route.ts`), this is explicitly handled by passing `publisher: publishPost`.
2. **SQLite In-Memory vs Production WAL**: Testing was conducted on the SQLite database in WAL mode. Under SQLite, single-writer serialization protects concurrent writes; in a multi-instance PostgreSQL environment, row-level locks or advisory locks would behave similarly via `updateMany`.

---

## 4. Conclusion

**VERDICT: APPROVE**

Milestone 5 satisfies all empirical challenge criteria:
- Website posts transition from `APPROVED` / `SCHEDULED` to `PUBLISHED` with automated SEO slug generation and `/blog/${slug}` URL linkage.
- Blog page and metadata generation correctly render articles and enforce 404 errors on drafts, rejected posts, non-website channels, and nonexistent slugs.
- Concurrency locks prevent race conditions and duplicate publishing across single-post races, multi-platform bursts, and queue runners.
- Zero outbound network requests were leaked.
- The 24 core business tables maintain 100% baseline parity (Delta = 0).

---

## 5. Verification Method

To independently reproduce and verify this assessment:

1. Run the empirical challenger test harness:
   ```powershell
   npx tsx scripts/verify-challenger-2-m5.ts
   ```
   *Expected outcome*: 46 / 46 assertions PASS with 0 failures.

2. Run the existing milestone verification suite:
   ```powershell
   npx tsx scripts/verify-m5-publishing.ts
   ```
   *Expected outcome*: 53 / 53 assertions PASS with 0 failures.

3. Verify zero database baseline drift:
   ```powershell
   node scripts/check-counts.mjs
   ```
   *Expected outcome*: 24 / 24 core business tables match `db/baseline-counts.json` (100% MATCH, PASS).
