## 2026-10-26T16:10:10Z

You are Worker M4 Fix (`worker_m4_fix`) for Milestone 4 of the AUTO SOCIAL module in OPENVN · Ưu Đàm Suite.

## Mission
Remediate the Critical Invariant Bypass Vulnerability in `retryPublishPost` identified by Reviewer 2 (`reviewer_2_m4`) and harden Milestone 4.

## Reviewer 2 Defect Report
Read the full report from Reviewer 2 at:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_2_m4\handoff.md`

Summary of vulnerability:
In `src/lib/social-scheduler.ts:894-935`, `retryPublishPost` does not validate whether `post.status === 'FAILED'` and fabricates a synthetic approval timestamp (`approvedAt: post.approvedAt || new Date()`). Calling `retryPublishPost` (or `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }`) on a post that was explicitly **REJECTED** by the store owner or in **DRAFT** force-approves the post, bypasses Gate 1 (Owner Approval), and immediately publishes the unapproved/rejected content to social media platforms.

## Mandatory Fix Instructions
1. **Patch `src/lib/social-scheduler.ts` (`retryPublishPost`)**:
   - Check status: ONLY posts with `post.status === 'FAILED'` can be retried!
     ```typescript
     if (post.status !== 'FAILED') {
       throw new Error(`Chỉ có thể thử lại bài viết ở trạng thái FAILED (trạng thái hiện tại: "${post.status}"). Bài viết chưa duyệt, đang chờ duyệt hoặc đã bị từ chối không thể thử lại.`);
     }
     if (post.isPublishing) {
       throw new Error('Bài viết đang trong tiến trình xuất bản, không thể thử lại.');
     }
     if (!post.approvedAt) {
       throw new Error('Bài viết chưa có sự phê duyệt hợp lệ của chủ tiệm, không thể thử lại.');
     }
     ```
   - In `db.socialPost.update`:
     - DO NOT fabricate a new approval date!
     - Keep `approvedAt: post.approvedAt` (preserve genuine original approval timestamp).
     - Restore `status: 'APPROVED'`, `publishError: null`.
2. **Patch `src/app/api/social/posts/[id]/route.ts`**:
   - When `body.action === 'RETRY'`, ensure errors thrown by `retryPublishPost` (e.g. attempting to retry a REJECTED, DRAFT, or PENDING post) are caught and returned as HTTP 400 with `{ error: error.message }`.
3. **Add Regression Tests in `scripts/verify-m4-scheduler.ts`**:
   - Add explicit test assertions verifying:
     - `retryPublishPost` throws when called on a `REJECTED` post.
     - `retryPublishPost` throws when called on a `DRAFT` post.
     - `retryPublishPost` throws when called on a `PENDING_APPROVAL` post.
     - `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }` returns HTTP 400 when post is `REJECTED`.
     - `retryPublishPost` successfully retries and publishes when post is genuinely `FAILED` (with original `approvedAt`).
4. **Run Verification Commands**:
   - `npx tsx scripts/verify-m4-scheduler.ts` (all assertions PASS).
   - `npx tsx scripts/verify-challenger-2-m4.ts` (PASS).
   - `npx tsx scripts/stress-m4-concurrency.ts` (PASS).
   - `node scripts/check-counts.mjs` (confirm 100% MATCH, Delta = 0).
   - `npx tsc --noEmit` & `npm run lint` (0 errors).

Working Directory: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4_fix\`
When complete, write your handoff report to `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4_fix\handoff.md` and send a message.
