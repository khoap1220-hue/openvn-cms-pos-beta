# Handoff Report — Milestone 4: Remediation of Invariant Bypass in `retryPublishPost` (R4 Hardening)

**Worker**: `worker_m4_fix` (Implementer, QA, Specialist)  
**Milestone**: Milestone 4 — AUTO SOCIAL Post Review, Approval Workflow & Scheduling Engine (R4)  
**Target Recipient / Parent**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Date**: 2026-10-26T16:23:00Z  

---

## 1. Observation

Direct observations and execution outputs from codebase inspection, remediation, and verification runs:

1. **Vulnerability Point in `src/lib/social-scheduler.ts` (lines 894–935 prior to fix)**:
   - `retryPublishPost` only validated `if (post.status === 'PUBLISHED')`.
   - Line 914 fabricated synthetic approval: `approvedAt: post.approvedAt || new Date()`.
   - When called on `REJECTED`, `DRAFT`, or `PENDING_APPROVAL` posts, it force-approved the post and immediately published it to external platforms, bypassing Gate 1 (Owner Approval).
   - In addition, it lacked an in-flight guard `if (post.isPublishing)`, which could collide with concurrent publishing workers.

2. **Remediated Implementation in `src/lib/social-scheduler.ts` (lines 903–926)**:
   ```typescript
   if (post.status !== 'FAILED') {
     throw new Error(
       `Chỉ có thể thử lại bài viết ở trạng thái FAILED (trạng thái hiện tại: "${post.status}"). Bài viết chưa duyệt, đang chờ duyệt hoặc đã bị từ chối không thể thử lại.`
     )
   }

   if (post.isPublishing) {
     throw new Error('Bài viết đang trong tiến trình xuất bản, không thể thử lại.')
   }

   if (!post.approvedAt) {
     throw new Error('Bài viết chưa có sự phê duyệt hợp lệ của chủ tiệm, không thể thử lại.')
   }

   // Khôi phục trạng thái về APPROVED để vượt qua Cổng 1 (bảo tồn approvedAt gốc của chủ tiệm)
   await db.socialPost.update({
     where: { id: postId },
     data: {
       status: 'APPROVED',
       isPublishing: false,
       publishError: null,
       approvedAt: post.approvedAt,
     },
   })
   ```

3. **Remediated Implementation in `src/app/api/social/posts/[id]/route.ts` (lines 93–101)**:
   ```typescript
   if (body.action === 'RETRY') {
     try {
       const result = await retryPublishPost(id)
       return NextResponse.json(result, { status: 200 })
     } catch (err: unknown) {
       const message = err instanceof Error ? err.message : 'Không thể thử lại xuất bản bài viết'
       return NextResponse.json({ error: message }, { status: 400 })
     }
   }
   ```

4. **Regression Suite Added in `scripts/verify-m4-scheduler.ts` (Phase 7.2)**:
   - `7.2.1`: `retryPublishPost` throws descriptive error when called on `REJECTED` post (`pass`).
   - `7.2.2`: `retryPublishPost` throws descriptive error when called on `DRAFT` post (`pass`).
   - `7.2.3`: `retryPublishPost` throws descriptive error when called on `PENDING_APPROVAL` post (`pass`).
   - `7.2.4`: `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }` returns HTTP 400 Bad Request when post is `REJECTED` (`pass`).
   - `7.2.5`: `retryPublishPost` succeeds on genuine `FAILED` post and strictly preserves the original `approvedAt` timestamp (`pass`).

5. **Updated Empirical Adversarial Suite `scripts/verify-challenger-2-m4.ts`**:
   - `1.3`: Verified that calling `retryPublishPost` on a post with a cancelled campaign (`status: 'REJECTED'`) is strictly blocked with a descriptive `FAILED` invariant error.
   - `2.3`: Verified that calling `retryPublishPost` on an in-flight hung post (`isPublishing: true`) is strictly blocked; once transitioned to `FAILED` by supervisor recovery, `retryPublishPost` recovers and publishes cleanly.

6. **Full Test Execution Results**:
   - `npx tsx scripts/verify-m4-scheduler.ts`: **103 PASS, 0 FAIL** (increased from 88 to 103).
   - `npx tsx scripts/verify-challenger-2-m4.ts`: **58 PASS, 0 FAIL** (increased from 56 to 58).
   - `npx tsx scripts/stress-m4-concurrency.ts`: **46 PASS, 0 FAIL**.
   - `node scripts/check-counts.mjs`: **24/24 Core Tables 100% MATCH (Delta = 0)**.
   - `npx tsc --noEmit`: Exited with code 0 (0 errors).
   - `npm run lint`: Exited with code 0 (0 warnings/errors).

---

## 2. Logic Chain

1. **Pre-condition Validation**: By adding `if (post.status !== 'FAILED')`, any attempt to retry a post in `DRAFT`, `PENDING_APPROVAL`, `REJECTED`, `APPROVED`, `SCHEDULED`, or `PUBLISHING` state is rejected before any DB mutation can occur.
2. **Concurrency Integrity**: The guard `if (post.isPublishing)` prevents race conditions where an operator or job tries to retry a post that is actively being dispatched across network sockets by another worker.
3. **Gate 1 Invariant Preservation**: The check `if (!post.approvedAt)` ensures that an unapproved or corrupt record cannot be forced into publication.
4. **Preservation of Authentic State**: In `db.socialPost.update`, replacing `post.approvedAt || new Date()` with `post.approvedAt` guarantees that the system never fabricates synthetic timestamps. The genuine store owner's approval timestamp remains intact through multiple retry iterations.
5. **API Layer Compliance**: Catching `retryPublishPost` exceptions inside `PUT /api/social/posts/[id]` with `action === 'RETRY'` ensures that invariant violations return client-friendly HTTP 400 Bad Request responses with `{ error: error.message }` rather than unhandled 500 crashes.
6. **Regression Proof**: The automated tests in `scripts/verify-m4-scheduler.ts` Phase 7.2 independently execute and assert every forbidden state transition, validating that bypass is impossible.

---

## 3. Caveats

- **No Caveats**: All test runs execute full cleanup routines with explicit WAL checkpoints (`PRAGMA wal_checkpoint(FULL)`).
- The 24 core business tables were audited before and after execution, confirming 100% parity with zero delta across all core tables.

---

## 4. Conclusion

The Critical Invariant Bypass Vulnerability identified by Reviewer 2 in `retryPublishPost` has been completely remediated. Milestone 4 is fully hardened:
- Unapproved and rejected posts can never be published via retry.
- In-flight posts cannot be clobbered concurrently.
- Store owner approval timestamps are preserved genuinely.
- Route handlers return HTTP 400 with descriptive error details.
- All 103 baseline scheduler assertions, 58 adversarial challenger assertions, and 46 concurrency stress assertions pass cleanly.

---

## 5. Verification Method

To independently verify this remediation, run the following commands in order:

```bash
# 1. Verify scheduler engine & new regression suite (103 assertions)
npx tsx scripts/verify-m4-scheduler.ts

# 2. Verify empirical adversarial boundary & lifecycle challenger (58 assertions)
npx tsx scripts/verify-challenger-2-m4.ts

# 3. Verify concurrency idempotency & time tolerances (46 assertions)
npx tsx scripts/stress-m4-concurrency.ts

# 4. Confirm zero database drift across 24 core business tables
node scripts/check-counts.mjs

# 5. Typecheck & Linting
npx tsc --noEmit
npm run lint
```
