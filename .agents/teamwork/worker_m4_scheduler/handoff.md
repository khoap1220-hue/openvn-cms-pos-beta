# Handoff Report — Milestone 4: Post Review, Approval Workflow & Scheduling Engine (R4)

**Worker**: `worker_m4_scheduler`  
**Milestone**: M4 (Features FEAT-REV-01 through FEAT-REV-05)  
**Parent Conversation ID**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Date**: 2026-10-26T15:58:00Z  

---

## 1. Observation

Direct observations and execution results from the codebase and tools:

1. **Schema & Model Structure** (`prisma/schema.prisma` lines 489–679):
   - `SocialPost` model contains status fields: `status` (`DRAFT | PENDING_APPROVAL | APPROVED | SCHEDULED | PUBLISHING | PUBLISHED | FAILED | REJECTED`), `approvalNote`, `approvedBy`, `approvedAt`, `isPublishing`, `retryCount`, `publishError`, `scheduledAt`, `publishedAt`, `externalPostId`, `externalPostUrl`, `isMock`.
   - `AuditLog` model supports actions: `CREATE`, `UPDATE`, `DELETE`, `APPROVE`, `REJECT`, `RESCHEDULE`, `PUBLISH`, `RETRY`, `ERROR`.
   - `Campaign` dynamic status computed via `computeCampaignStatus(campaign, now)` returning `'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'`.

2. **Implemented Files** (Strictly within exclusively owned list):
   - `src/lib/social-scheduler.ts` (610 lines): Core state machine, Three Iron Publishing Gates, atomic concurrency lock, pluggable publisher with default mock fallback, retry handler, and scheduled queue runner.
   - `src/app/api/social/posts/route.ts` (88 lines): Next.js 16 route handler (`export const dynamic = 'force-dynamic'`) for listing posts with search/filter and creating draft posts.
   - `src/app/api/social/posts/[id]/route.ts` (145 lines): Next.js 16 route handler (`const { id } = await params`) for retrieving post details with audit logs, dispatching actions (`APPROVE`, `REJECT`, `RESCHEDULE`, `RETRY`, `PUBLISH`, `SUBMIT_FOR_APPROVAL`), editing, and deleting non-published posts.
   - `src/app/api/social/schedule/route.ts` (36 lines): Next.js 16 route handler (`export const dynamic = 'force-dynamic'`) invoking `processScheduledPosts()`.
   - `scripts/verify-m4-scheduler.ts` (648 lines): 88 automated assertions verifying all 5 features and 3 Iron Gates.

3. **Verbatim Test Execution Outputs**:
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

---

## 2. Logic Chain

Step-by-step reasoning linking requirements, architecture, and verification:

1. **FEAT-REV-01 (Post Lifecycle State Machine)**:
   - *Requirement*: Support full approval lifecycle transitions: `DRAFT` -> `PENDING_APPROVAL` -> `APPROVED` / `REJECTED`, with `APPROVED` upgrading to `SCHEDULED` if `scheduledAt` is set.
   - *Implementation*: `submitForApproval`, `approvePost`, `rejectPost`, `reschedulePost`, `createPost`, `updatePost`, `getPost`, `listPosts`, `deletePost` in `src/lib/social-scheduler.ts`. All state transitions write structured entries to `AuditLog`.
   - *Evidence*: Stage 2 in `scripts/verify-m4-scheduler.ts` exercises each transition, verifying that `approvalNote`, `approvedBy`, `approvedAt`, and AuditLog are correctly persisted.

2. **CRITICAL R4 INVARIANT (The Three Iron Publishing Gates)**:
   - *Gate 1 (Owner Approval Gate)*:
     - In `publishPostItem`, the code validates `post.status in ['APPROVED', 'SCHEDULED']` AND `post.approvedAt != null`. If post is in `DRAFT`, `PENDING_APPROVAL`, or `REJECTED`, it immediately rejects publication with `{ success: false, reason: 'POST_NOT_APPROVED' }`.
     - *Evidence*: Verified in Stage 3 across DRAFT, PENDING_APPROVAL, REJECTED, and corrupted APPROVED posts without timestamp.
   - *Gate 2 (Campaign Status Gate)*:
     - If post has `campaignId`, `computeCampaignStatus(campaign, now)` dynamically evaluates status. If `ENDED` or `CANCELLED`, post is immediately updated to `status: 'REJECTED'`, `approvalNote: 'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy'`, `approvedAt: null`, and `AuditLog` entry is recorded with action `'REJECT'`.
     - *Evidence*: Verified in Stage 4 for campaigns with expired dates (`ENDED`) and manually cancelled campaigns (`CANCELLED`).
   - *Gate 3 (Scheduled Time Gate)*:
     - For posts with `scheduledAt`, publication requires `now >= scheduledAt - 60_000ms` (tolerance <= 1 minute). Future posts (> 60s) are skipped with `{ success: false, skipped: true, reason: 'SCHEDULED_TIME_NOT_REACHED' }`.
     - *Evidence*: Verified in Stage 5 for `now + 10m` (skipped), `now + 30s` (published), and `now - 5m` (published).

3. **FEAT-REV-03 (Concurrency Idempotency Lock)**:
   - *Requirement*: Prevent double-publishing when cron and manual triggers run at the exact same millisecond.
   - *Implementation*: Atomic SQLite update via Prisma `db.socialPost.updateMany({ where: { id: postId, isPublishing: false, status: { in: ['APPROVED', 'SCHEDULED'] } }, data: { isPublishing: true, status: 'PUBLISHING' } })`. If `updateMany.count === 0`, lock was not acquired, returning `{ success: false, reason: 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS' }`.
   - *Evidence*: Stage 6 fires `Promise.all([publishPostItem(id), publishPostItem(id)])`. Exactly one call succeeds (`successCount === 1`), exactly one call is blocked (`lockBlockedCount === 1`), and the database reflects exactly 1 publication and 1 PUBLISH audit log entry.

4. **FEAT-REV-05 (Publishing Retry & Failure Handling)**:
   - *Requirement*: Handle publisher errors, increment retry count, record error, and provide retry mechanism.
   - *Implementation*: Failing publisher marks post `status: 'FAILED'`, `publishError: errorMsg`, `retryCount: { increment: 1 }`, and records AuditLog `action: 'ERROR'`, `status: 'FAILED'`. `retryPublishPost(postId)` resets `status: 'APPROVED'`, `publishError: null`, and re-triggers execution.
   - *Evidence*: Verified in Stage 7 with simulated HTTP 429 quota failure followed by successful retry.

5. **FEAT-REV-02 (Scheduled Queue Runner)**:
   - *Requirement*: Periodic runner scanning approved/scheduled posts within time window.
   - *Implementation*: `processScheduledPosts(referenceTime)` queries candidate posts with `scheduledAt <= referenceTime + 60s`, processing each through the Three Iron Gates and concurrency lock, returning `{ processed, published, skipped, failed, results }`.
   - *Evidence*: Verified in Stage 5 and Stage 8.

6. **Next.js 16 Route Handlers**:
   - *Requirement*: `export const dynamic = 'force-dynamic'`, `const { id } = await params`.
   - *Implementation*: Implemented in `src/app/api/social/posts/route.ts`, `src/app/api/social/posts/[id]/route.ts`, and `src/app/api/social/schedule/route.ts`.
   - *Evidence*: Tested in Stage 8 directly using `NextRequest` for GET, POST, PUT (approve, reschedule, reject), DELETE, and schedule trigger.

---

## 3. Caveats

- **External Publishing Adapter (M5 Handshake)**:
  `src/lib/social-scheduler.ts` provides a pluggable publisher pattern (`setPublisher(publisher)`) and includes a built-in `defaultMockPublisher`. When Worker M5 completes `src/lib/publishing-gateway.ts`, M5 can register its unified adapter via `setPublisher` or pass it into `PublishOptions.publisher`.
- **Database Parity**:
  All test data created during test runs is completely torn down in Stage 9 (SocialPost, Campaign, and AuditLog records), followed by `PRAGMA wal_checkpoint(FULL)`, guaranteeing `node scripts/check-counts.mjs` remains at 100% MATCH (Delta = 0).

---

## 4. Conclusion

Milestone 4 (Post Review, Approval Workflow & Scheduling Engine - R4) is **100% complete, fully verified, and zero-regression compliant**.
All requirements FEAT-REV-01 through FEAT-REV-05 and the Three Iron Publishing Gates are genuinely implemented with real SQLite/Prisma state management and atomic concurrency locking.

---

## 5. Verification Method

To independently verify the implementation, run the following commands from the repository root:

1. **Verify Milestone 4 Scheduler & All Gates (88 tests)**:
   ```powershell
   npx tsx scripts/verify-m4-scheduler.ts
   ```
   *Expected Result*: 88/88 tests PASS, 0 FAIL.

2. **Verify Database Baseline Parity (24 Core Tables)**:
   ```powershell
   node scripts/check-counts.mjs
   ```
   *Expected Result*: Core Parity Status: 100% MATCH (PASS), Delta = 0 across 24 tables.

3. **Verify TypeScript Compilation**:
   ```powershell
   npx tsc --noEmit
   ```
   *Expected Result*: Exit code 0, 0 errors.

4. **Verify ESLint**:
   ```powershell
   npm run lint
   ```
   *Expected Result*: Exit code 0, 0 warnings/errors.

5. **Verify Zero Baseline Regression**:
   ```powershell
   npm run test:chain
   npm run test:scenarios
   ```
   *Expected Result*: All 21 real-world scenarios and stock ledger chain pass.
