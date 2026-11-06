# Adversarial Review & Handoff Report — Milestone 4: Three Iron Publishing Gates & Concurrency Lock (R4)

**Reviewer**: `reviewer_2_m4` (Reviewer 2 & Adversarial Critic)  
**Milestone**: M4 (The Three Iron Publishing Gates & Concurrency Idempotency Lock - R4, R7)  
**Caller / Parent Conversation ID**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Date**: 2026-10-26T16:06:00Z  

---

## Review Summary

**Verdict**: **REQUEST_CHANGES**

**Reasoning**:
While the core implementations of Gate 1, Gate 2, Gate 3, and the Concurrency Idempotency Lock operate cleanly during standard workflows, an adversarial attack test identified a **CRITICAL INVARIANT BYPASS VULNERABILITY** in `retryPublishPost` (`src/lib/social-scheduler.ts:894-935`). 

Specifically, `retryPublishPost` does not validate whether a post is in `FAILED` status and unconditionally synthesizes a fake approval timestamp (`approvedAt: post.approvedAt || new Date()`). Consequently, calling `retryPublishPost` (or `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }`) on a post that was explicitly **REJECTED** by the store owner or currently in **DRAFT** bypasses the Owner Approval Gate (Gate 1), bypasses the Scheduled Time Gate (Gate 3), and immediately publishes the unapproved/rejected content to social media platforms. This directly breaks the non-negotiable core contract of R4: *"Chỉ bài đã được chủ tiệm duyệt mới được đăng. Bài chưa duyệt / bị từ chối / thuộc chương trình đã kết thúc không bao giờ được gửi tới adapter đăng."*

---

## 1. Observation

Direct observations and execution results from the codebase, test executions, and live adversarial exploits:

1. **Test Suite & Baseline Execution**:
   - `npx tsx scripts/verify-m4-scheduler.ts`:
     ```
     ✅ [PASS] Đối soát bảo toàn 24 bảng baseline cốt lõi [POST-TEST TEARDOWN] (Delta = 0)
     ================================================================================
     🎉 HOÀN TẤT KIỂM THỬ: 88 TEST PASS, 0 FAIL! 🎉
     >>> TOÀN BỘ CÁC CỔNG THÉP R4 & KHÓA CONCURRENCY ĐẠT CHUẨN TUYỆT ĐỐI <<<
     ================================================================================
     ```
   - `node scripts/check-counts.mjs`:
     ```
     Core Business Tables Checked : 24 / 24
     Core Parity Status           : 100% MATCH (PASS)
     ```
   - `npx tsc --noEmit`: Exited with code 0 (0 TypeScript errors).
   - `npm run lint`: Exited with code 0 (0 ESLint errors/warnings).
   - `npm run test:chain`: Monotonic stock ledger 100% pass.
   - `npm run test:scenarios`: 21/21 real-world scenarios pass.

2. **Code Observation in `src/lib/social-scheduler.ts` (lines 894–935)**:
   ```typescript
   export async function retryPublishPost(
     postId: string,
     options?: PublishOptions
   ): Promise<PublishItemResult> {
     const post = await db.socialPost.findUnique({ where: { id: postId } })
     if (!post) {
       throw new Error(`Không tìm thấy bài viết ID "${postId}"`)
     }

     if (post.status === 'PUBLISHED') {
       throw new Error('Bài viết đã xuất bản thành công, không thể thử lại')
     }

     // Khôi phục trạng thái về APPROVED để vượt qua Cổng 1
     await db.socialPost.update({
       where: { id: postId },
       data: {
         status: 'APPROVED',
         isPublishing: false,
         publishError: null,
         approvedAt: post.approvedAt || new Date(),
       },
     })

     await logPostAudit({
       postId,
       action: 'RETRY',
       actor: options?.actor || 'OPERATOR',
       actorName: options?.actorName,
       status: 'SUCCESS',
       details: {
         previousStatus: post.status,
         retryCount: post.retryCount,
       },
     })

     // Gọi lại xuất bản (bỏ qua cổng thời gian khi chủ động retry thủ công)
     return publishPostItem(postId, {
       ...options,
       skipTimeGate: options?.skipTimeGate !== false,
     })
   }
   ```

3. **Live Adversarial Exploit Execution Output**:
   When creating a post, rejecting it via `rejectPost(post.id, 'Chủ tiệm Ưu Đàm', 'Nội dung phản cảm cấm đăng')`, and calling `retryPublishPost(post.id)`:
   ```
   1. Created post: cmvpg56gn0001ve8k3v6aq6p5 status: DRAFT
   2. Post rejected: cmvpg56gn0001ve8k3v6aq6p5 status: REJECTED approvedAt: null
   3. Attempting retryPublishPost on REJECTED post...
   4. Retry result: {
     success: true,
     postId: 'cmvpg56gn0001ve8k3v6aq6p5',
     externalPostId: 'mock_facebook_1793030632537',
     externalPostUrl: 'https://facebook.mock-social.local/p/1793030632537',
     publishedAt: 2026-10-26T16:03:52.537Z,
     isMockResult: true
   }
   5. Final post in DB: {
     id: 'cmvpg56gn0001ve8k3v6aq6p5',
     status: 'PUBLISHED',
     approvedAt: 2026-10-26T16:03:52.496Z,
     externalPostId: 'mock_facebook_1793030632537'
   }
   ```

---

## 2. Findings

### [Critical] Finding 1: Gate 1 Bypass via `retryPublishPost` Fabricating Approval Timestamp

- **What**: `retryPublishPost` allows retrying posts that are in `REJECTED`, `DRAFT`, or `PENDING_APPROVAL` status because it only checks `if (post.status === 'PUBLISHED')`. When called, line 914 executes `approvedAt: post.approvedAt || new Date()`. Since a rejected or draft post has `approvedAt: null`, the code fabricates a brand new approval timestamp (`new Date()`) and sets `status: 'APPROVED'`. It then calls `publishPostItem` with `skipTimeGate: true`, successfully passing Gate 1 and publishing forbidden/rejected content.
- **Where**: `src/lib/social-scheduler.ts:894-935` and `src/app/api/social/posts/[id]/route.ts:93-96`.
- **Why**: In production, if an operator or malicious user submits `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }` on a post that the store owner explicitly rejected (e.g. for offensive language, misleading promotions, or brand violation), the system bypasses the store owner's rejection and publishes the post immediately to Facebook, Zalo, Website, TikTok, Instagram, etc.
- **Suggested Fix**:
  1. Enforce that only posts in `FAILED` status can be retried:
     ```typescript
     if (post.status !== 'FAILED') {
       const err = new Error(`Chỉ có thể thử lại các bài viết ở trạng thái thất bại (FAILED). Trạng thái hiện tại: "${post.status}"`)
       ;(err as unknown as { statusCode: number }).statusCode = 400
       throw err
     }
     if (!post.approvedAt) {
       const err = new Error('Không thể thử lại bài viết chưa từng được chủ tiệm phê duyệt hợp lệ')
       ;(err as unknown as { statusCode: number }).statusCode = 400
       throw err
     }
     ```
  2. In the DB update, never synthesize a fake timestamp:
     ```typescript
     data: {
       status: 'APPROVED',
       isPublishing: false,
       publishError: null,
       approvedAt: post.approvedAt, // Retain original approval timestamp
     }
     ```
  3. Add test cases in `scripts/verify-m4-scheduler.ts` asserting that calling `retryPublishPost` or API `action: 'RETRY'` on `DRAFT`, `PENDING_APPROVAL`, and `REJECTED` posts throws an error and is strictly blocked.

### [Major] Finding 2: Missing Concurrency In-Flight Check in `retryPublishPost`

- **What**: `retryPublishPost` does not verify `post.isPublishing`. If a post is currently in-flight (`isPublishing: true`) being published by a background runner or concurrent request, calling `retryPublishPost` unconditionally overwrites `isPublishing: false` and sets `status: 'APPROVED'`.
- **Where**: `src/lib/social-scheduler.ts:908-916`.
- **Why**: This breaks the concurrency lock invariant, allowing a second concurrent publisher to be triggered while the first one is still waiting for network I/O, risking duplicate external posts.
- **Suggested Fix**:
  Check `if (post.isPublishing) throw new Error('Bài viết đang trong tiến trình xuất bản, không thể thực hiện thử lại lúc này')`.

### [Minor] Finding 3: Orphaned Campaign Reference in Gate 2

- **What**: In `publishPostItem` (`src/lib/social-scheduler.ts:681-722`), if `post.campaignId` is non-null but `campaign` is not found in the DB (`db.campaign.findUnique` returns `null`), Gate 2 silently ignores it and allows the post to proceed to Gate 3 and publish.
- **Where**: `src/lib/social-scheduler.ts:687-721`.
- **Why**: If a campaign was deleted or corrupted, publishing a post linked to an unknown campaign might publish stale or orphaned campaign promises.
- **Suggested Fix**:
  If `post.campaignId` is set but `campaign` is `null`, log a warning or treat as `ENDED` / veto.

---

## 3. Verified Claims

| Feature / Claim | Verification Method | Result | Details |
|---|---|---|---|
| Gate 1: Owner Approval Gate (Normal Flow) | `publishPostItem` across DRAFT, PENDING, REJECTED, and corrupted post | **PASS** | Blocked with `POST_NOT_APPROVED` when invoked directly via `publishPostItem`. |
| Gate 2: Campaign Status Gate | `publishPostItem` on ENDED and CANCELLED campaigns | **PASS** | Blocked with `CAMPAIGN_ENDED_OR_CANCELLED`, post auto-transitions to `REJECTED`, approvedAt cleared, AuditLog REJECT recorded. |
| Gate 3: Scheduled Time Gate | `publishPostItem` & `processScheduledPosts` with now + 10m, now + 30s, now - 5m | **PASS** | > 60s future skipped; <= 60s published; past published. |
| Concurrency Idempotency Lock | Parallel `Promise.all` publishing same post in same millisecond | **PASS** | SQLite atomic `updateMany` succeeds exactly once (1 PUBLISHED, 1 `CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS`, 1 AuditLog). |
| Retry & Failure Logging | Failing publisher returns HTTP 429 quota failure | **PASS** | Post marked `FAILED`, `publishError` saved, `retryCount` incremented to 1, AuditLog ERROR saved. |
| Next.js 16 Route Handlers | NextRequest direct execution on GET, POST, PUT, DELETE, /api/social/schedule | **PASS** | Route handlers conform to Next.js 16 (`const { id } = await params`, `export const dynamic = 'force-dynamic'`). |
| Database Baseline Invariance | `node scripts/check-counts.mjs` | **PASS** | 24 / 24 core business tables match `db/baseline-counts.json` (Delta = 0). |
| Regression Test Suites | `tsc`, `lint`, `test:chain`, `test:scenarios` | **PASS** | All zero errors. |

---

## 4. Adversarial Attack Surface & Challenge Report

### Challenge: Bypassing Owner Approval Gate via Action Discrepancy
- **Assumption Challenged**: The system assumes that because `publishPostItem` has Gate 1, unapproved or rejected posts can never be published.
- **Attack Scenario**:
  1. An author creates a controversial or discount-heavy post.
  2. The store owner reviews the post and explicitly REJECTS it with reason: "Nội dung phản cảm cấm đăng" (`status: 'REJECTED'`, `approvedAt: null`).
  3. The author or client calls `PUT /api/social/posts/[id]` with body `{ action: 'RETRY' }`.
  4. `retryPublishPost` runs without verifying `post.status === 'FAILED'`.
  5. It writes `status: 'APPROVED'` and fabricates `approvedAt: new Date()`.
  6. It calls `publishPostItem` with `skipTimeGate: true`.
  7. The rejected post is published immediately to the external network!
- **Blast Radius**: Critical. Unapproved or rejected content goes live to real social media accounts, violating the owner's authority and business integrity.
- **Mitigation**: Add status check `post.status === 'FAILED'` and retain `approvedAt: post.approvedAt` in `retryPublishPost`.

---

## 5. Logic Chain

1. **Observation 1 & 2**: `retryPublishPost` in `src/lib/social-scheduler.ts` only checks `post.status === 'PUBLISHED'`. It allows any other status (`DRAFT`, `PENDING_APPROVAL`, `REJECTED`, `PUBLISHING`) to proceed.
2. **Observation 2**: Line 914 specifies `approvedAt: post.approvedAt || new Date()`. For any post that has `approvedAt: null` (such as a REJECTED post), this generates a new approval timestamp.
3. **Observation 2**: Line 911 sets `status: 'APPROVED'`.
4. **Observation 2**: Line 931 calls `publishPostItem(postId, { skipTimeGate: true })`.
5. **Observation 3**: In live execution, a post created, rejected by the owner, and then submitted to `retryPublishPost` transitioned from `REJECTED` -> `APPROVED` -> `PUBLISHED` (`externalPostId: 'mock_facebook_1793030632537'`) with zero owner approval.
6. **Requirement R4**: *"Chỉ bài đã được chủ tiệm duyệt mới được đăng. Bài chưa duyệt / bị từ chối / thuộc chương trình đã kết thúc không bao giờ được gửi tới adapter đăng."*
7. **Conclusion**: The implementation violates the R4 invariant under the retry flow. Therefore, changes must be requested and resolved before Milestone 4 can be approved.

---

## 6. Caveats

- No caveats regarding testing environment: tests were executed directly against the local SQLite database with real Prisma client, and all temporary test records were cleanly rolled back with full WAL checkpointing.
- The Concurrency Lock (`updateMany` with `isPublishing: false`) is completely sound and verified under concurrent load. The required changes are strictly confined to input validation and state transitions in `retryPublishPost`.

---

## 7. Conclusion & Recommended Action

**Verdict**: **REQUEST_CHANGES**

**Action Items for Worker M4**:
1. In `src/lib/social-scheduler.ts:retryPublishPost`:
   - Add precondition check: `if (post.status !== 'FAILED') throw new Error(...)`.
   - Add precondition check: `if (post.isPublishing) throw new Error(...)`.
   - Add precondition check: `if (!post.approvedAt) throw new Error(...)`.
   - In `db.socialPost.update`, keep `approvedAt: post.approvedAt` (do not fabricate `new Date()`).
2. In `scripts/verify-m4-scheduler.ts`:
   - Add test cases verifying that calling `retryPublishPost` on `DRAFT`, `PENDING_APPROVAL`, and `REJECTED` posts throws an error and fails to publish.
3. Re-run `npx tsx scripts/verify-m4-scheduler.ts` and `node scripts/check-counts.mjs`.

---

## 8. Verification Method for Orchestrator / Caller

To independently verify this finding:
1. Review lines 894–935 of `src/lib/social-scheduler.ts`.
2. Observe that `retryPublishPost` does not assert `post.status === 'FAILED'` and synthesizes `approvedAt: post.approvedAt || new Date()`.
3. Check that after the worker applies the proposed fix, calling `retryPublishPost` on a `REJECTED` or `DRAFT` post throws a descriptive error and prevents publication.
4. Run `npx tsx scripts/verify-m4-scheduler.ts` and `node scripts/check-counts.mjs` to ensure 100% test pass and zero baseline delta.
