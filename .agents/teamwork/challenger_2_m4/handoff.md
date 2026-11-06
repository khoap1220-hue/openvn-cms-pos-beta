# Empirical Adversarial Challenge Report — Milestone 4: Boundary & Campaign Lifecycle

**Challenger**: `challenger_2_m4` (Boundary & Campaign Lifecycle Challenger)  
**Roles**: `critic`, `specialist`  
**Parent Conversation ID**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Milestone**: M4 (Post Review, Approval Workflow & Scheduling Engine - R4)  
**Date**: 2026-10-26T16:05:00Z  
**Verdict**: **APPROVE**

---

## 1. Observation

Direct observations, tool outputs, verbatim lines, and empirical execution results:

1. **Source Code Inspection**:
   - `src/lib/social-scheduler.ts` lines 678–722:
     ```typescript
     // --- CỔNG 2: CỔNG TRẠNG THÁI CHIẾN DỊCH CRM (Campaign Status Gate) ---
     // Nếu bài viết gắn với chiến dịch: kiểm tra trạng thái biên động
     // Nếu chiến dịch đã ENDED hoặc CANCELLED: tự động chuyển REJECTED và chặn vĩnh viễn
     if (post.campaignId) {
       let campaign: Campaign | null = post.campaign
       if (!campaign) {
         campaign = await db.campaign.findUnique({ where: { id: post.campaignId } })
       }

       if (campaign) {
         const dynamicStatus = computeCampaignStatus(campaign, now)
         if (dynamicStatus === 'ENDED' || dynamicStatus === 'CANCELLED') {
           const rejectionNote = 'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy'

           await db.socialPost.update({
             where: { id: postId },
             data: {
               status: 'REJECTED',
               approvalNote: rejectionNote,
               approvedAt: null,
               isPublishing: false,
             },
           })

           await logPostAudit({
             postId,
             action: 'REJECT',
             actor: 'SYSTEM',
             status: 'SUCCESS',
             details: {
               reason: 'CAMPAIGN_ENDED_OR_CANCELLED',
               campaignStatus: dynamicStatus,
               campaignId: campaign.id,
             },
           })

           return {
             success: false,
             postId,
             error: 'CAMPAIGN_ENDED_OR_CANCELLED',
             reason: 'CAMPAIGN_ENDED_OR_CANCELLED',
           }
         }
       }
     }
     ```
   - `src/lib/social-scheduler.ts` lines 667–676 (Gate 1 - Owner Approval Gate):
     ```typescript
     const isApprovedState = post.status === 'APPROVED' || post.status === 'SCHEDULED'
     if (!isApprovedState || !post.approvedAt) {
       return {
         success: false,
         postId,
         error: 'POST_NOT_APPROVED',
         reason: 'POST_NOT_APPROVED',
       }
     }
     ```
   - `src/lib/social-scheduler.ts` lines 744–763 (Concurrency Idempotency Lock):
     ```typescript
     const lockResult = await db.socialPost.updateMany({
       where: {
         id: postId,
         isPublishing: false,
         status: { in: ['APPROVED', 'SCHEDULED'] },
       },
       data: {
         isPublishing: true,
         status: 'PUBLISHING',
       },
     })

     if (lockResult.count === 0) {
       return {
         success: false,
         postId,
         reason: 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS',
       }
     }
     ```
   - `src/lib/social-scheduler.ts` lines 908–916 (Self-Healing in Retry):
     ```typescript
     await db.socialPost.update({
       where: { id: postId },
       data: {
         status: 'APPROVED',
         isPublishing: false,
         publishError: null,
         approvedAt: post.approvedAt || new Date(),
       },
     })
     ```
   - `src/lib/social-scheduler.ts` lines 954–964 (Candidate Filter in Queue Runner):
     ```typescript
     const candidates = await db.socialPost.findMany({
       where: {
         status: { in: ['APPROVED', 'SCHEDULED'] },
         isPublishing: false,
         scheduledAt: {
           not: null,
           lte: toleranceDate,
         },
       },
       orderBy: { scheduledAt: 'asc' },
     })
     ```

2. **Empirical Adversarial Test Execution (`scripts/verify-challenger-2-m4.ts`)**:
   - Total Assertions: 56/56 PASS (0 FAIL).
   - Verbatim Output:
     ```
     🔥 EMPIRICAL CHALLENGER 2 — MILESTONE 4 ADVERSARIAL STRESS SUITE 🔥
     🎯 Scope: Campaign Status Gate, Boundary Lifecycle & Corrupted State Recovery
     ================================================================================

     ▶ [PHASE 0] Pre-test 24-table database baseline audit
       ✅ [PASS] Đối soát bảo toàn 24 bảng baseline cốt lõi [PRE-TEST] (Delta = 0)

     ▶ [SUITE 1] Adversarial Challenge: Campaign Status Gate (Gate 2)

       --- [1.1] Campaign Expired at Publish Time ---
       ✅ [PASS] 1.1.1 Post is initially SCHEDULED with approvedAt populated
       ✅ [PASS] 1.1.2 approvedAt is non-null after approval
       ✅ [PASS] 1.1.3 publishPostItem returns success: false
       ✅ [PASS] 1.1.4 reason is CAMPAIGN_ENDED_OR_CANCELLED
       ✅ [PASS] 1.1.5 error is CAMPAIGN_ENDED_OR_CANCELLED
       ✅ [PASS] 1.1.6 STRICT 0 external publisher calls made for expired campaign post
       ✅ [PASS] 1.1.7 Post state transitioned immediately to REJECTED in database
       ✅ [PASS] 1.1.8 approvalNote contains explanation of campaign expiration rejection
       ✅ [PASS] 1.1.9 approvedAt cleared to null
       ✅ [PASS] 1.1.10 isPublishing lock is false
       ✅ [PASS] 1.1.11 AuditLog record created for rejection
       ✅ [PASS] 1.1.12 AuditLog actor is SYSTEM
       ✅ [PASS] 1.1.13 AuditLog status is SUCCESS
       ✅ [PASS] 1.1.14 AuditLog details records CAMPAIGN_ENDED_OR_CANCELLED
       ✅ [PASS] 1.1.15 AuditLog details identifies dynamic campaignStatus as ENDED

       --- [1.2] Campaign CANCELLED at Publish Time via Queue Runner ---
       ✅ [PASS] 1.2.1 Post 2 is SCHEDULED
       ✅ [PASS] 1.2.2 STRICT 0 publisher calls made by queue runner on cancelled campaign post
       ✅ [PASS] 1.2.3 Queue runner records failed/rejected item
       ✅ [PASS] 1.2.4 Post 2 transitioned to REJECTED via Queue Runner
       ✅ [PASS] 1.2.5 Post 2 approvalNote contains explanation
       ✅ [PASS] 1.2.6 Post 2 approvedAt is null
       ✅ [PASS] 1.2.7 AuditLog records rejection for cancelled campaign
       ✅ [PASS] 1.2.8 AuditLog details confirms campaignStatus is CANCELLED
       ✅ [PASS] 1.2.9 REJECTED post is permanently ignored by future scheduled queue runs

       --- [1.3] Adversarial Attempt: Retry on Cancelled Campaign ---
       ✅ [PASS] 1.3.1 retryPublishPost fails because Gate 2 catches cancelled campaign
       ✅ [PASS] 1.3.2 reason remains CAMPAIGN_ENDED_OR_CANCELLED
       ✅ [PASS] 1.3.3 STRICT 0 publisher calls made during invalid retry
       ✅ [PASS] 1.3.4 Post remains in REJECTED state after failed bypass attempt

     ▶ [SUITE 2] Adversarial Challenge: Corrupted State Recovery

       --- [2.1] Corrupted State: APPROVED with approvedAt = null ---
       ✅ [PASS] 2.1.1 Gate 1 blocks publishing when approvedAt is null
       ✅ [PASS] 2.1.2 reason is POST_NOT_APPROVED
       ✅ [PASS] 2.1.3 STRICT 0 publisher calls made for unverified approval
       ✅ [PASS] 2.1.4 Post re-approved to APPROVED
       ✅ [PASS] 2.1.5 approvedAt properly healed with valid Date
       ✅ [PASS] 2.1.6 Publishing succeeds after approval healing
       ✅ [PASS] 2.1.7 Exactly 1 external publish call executed after heal

       --- [2.2] Corrupted State: SCHEDULED with scheduledAt = null ---
       ✅ [PASS] 2.2.1 Queue runner safely excludes SCHEDULED post with scheduledAt = null
       ✅ [PASS] 2.2.2 0 publisher calls made by queue runner on corrupted scheduled post
       ✅ [PASS] 2.2.3 Status maintained as SCHEDULED
       ✅ [PASS] 2.2.4 scheduledAt successfully healed
       ✅ [PASS] 2.2.5 Healed scheduled post processed and published successfully by runner
       ✅ [PASS] 2.2.6 Exactly 1 publish call executed by runner

       --- [2.3] Crashed Mid-Publish: Simulated Hung isPublishing = true ---
       ✅ [PASS] 2.3.1 publishPostItem blocked while post is stuck in PUBLISHING
       ✅ [PASS] 2.3.2 0 publisher calls made while lock is hung
       ✅ [PASS] 2.3.3 Queue runner skips posts with isPublishing = true
       ✅ [PASS] 2.3.4 0 publisher calls made by queue runner on hung lock
         Testing Recovery via retryPublishPost...
       ✅ [PASS] 2.3.5 retryPublishPost successfully clears hung lock and publishes
       ✅ [PASS] 2.3.6 Exactly 1 publisher call executed after retry recovery
       ✅ [PASS] 2.3.7 Post reached PUBLISHED status after retry recovery
       ✅ [PASS] 2.3.8 isPublishing is false (lock properly released)
       ✅ [PASS] 2.3.9 publishedAt is populated
       ✅ [PASS] 2.3.10 RETRY action logged in AuditLog
         Testing Recovery via rejectPost on Hung Post...
       ✅ [PASS] 2.3.11 rejectPost successfully transitions hung post to REJECTED
       ✅ [PASS] 2.3.12 rejectPost clears isPublishing to false
       ✅ [PASS] 2.3.13 approvalNote contains operator cancel reason

     ▶ [PHASE 3] Absolute Cleanup of all Test Artifacts & Invariance Verification
       Cleaning up 6 test SocialPost records & their AuditLogs...
       Cleaning up 2 test Campaign records & their AuditLogs...
       ✅ [PASS] Đối soát bảo toàn 24 bảng baseline cốt lõi [POST-TEST TEARDOWN] (Delta = 0)

     ================================================================================
     🎉 HOÀN TẤT KIỂM THỬ ĐỐI KHÁNG: 56 TEST PASS, 0 FAIL! 🎉
     >>> TOÀN BỘ CỔNG CHIẾN DỊCH, BIÊN VÒNG ĐỜI & KHÔI PHỤC LỖI ĐẠT CHUẨN TUYỆT ĐỐI <<<
     ================================================================================
     ```

3. **Core Database Parity (`node scripts/check-counts.mjs`)**:
   ```
   Core Business Tables Checked : 24 / 24
   Core Parity Status           : 100% MATCH (PASS)
   ```
4. **Worker Verification Test Suite (`npx tsx scripts/verify-m4-scheduler.ts`)**:
   - 88/88 tests PASS, 0 FAIL.
5. **TypeScript Compilation (`npx tsc --noEmit`)**:
   - Exited with code 0 (0 errors).

---

## 2. Logic Chain

Step-by-step reasoning from observations to conclusion:

1. **Adversarial Challenge 1: Campaign Status Gate (Gate 2) Enforcement**:
   - *Observation*: Lines 678–722 in `social-scheduler.ts` dynamically evaluate campaign status via `computeCampaignStatus(campaign, now)` on every publish attempt (both direct `publishPostItem` and scheduled `processScheduledPosts`).
   - *Attack Scenario A (Expired Campaign)*: Campaign was created with future `endDate`, post was scheduled and approved. Later, `endDate` lapsed into the past without updating the DB campaign status.
     *Result*: `computeCampaignStatus` evaluated `now > endDate` -> `'ENDED'`. Post was immediately transitioned to `status: 'REJECTED'`, `approvalNote` was populated with `'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy'`, `approvedAt` set to `null`, `AuditLog` recorded action `'REJECT'` with `actor: 'SYSTEM'` and `campaignStatus: 'ENDED'`. Exactly 0 external publish calls were made (`spyPublishCalls.length === 0`).
   - *Attack Scenario B (Cancelled Campaign via Queue Runner)*: Campaign was cancelled by operator while post was pending in queue. Queue runner triggered at scheduled time.
     *Result*: Queue runner invoked `publishPostItem`, Gate 2 intercepted cancelled status, transitioned post to `REJECTED`, and made 0 external publish calls. Furthermore, subsequent queue runner iterations completely excluded the post because status was no longer `SCHEDULED` or `APPROVED`.
   - *Attack Scenario C (Bypass Gate 2 via Retry)*: An operator attempts to force publication via `retryPublishPost(postId)`.
     *Result*: `retryPublishPost` resets post to `APPROVED` and invokes `publishPostItem`. Gate 2 immediately re-checks campaign status, catches that it remains cancelled/expired, re-rejects the post, and prevents any external call (0 publisher calls).

2. **Adversarial Challenge 2: Corrupted State Recovery**:
   - *Attack Scenario A (Corrupted `APPROVED` post with `approvedAt: null`)*:
     *Observation*: Gate 1 enforces `post.approvedAt != null` (lines 667–676).
     *Result*: Direct publishing is strictly rejected with `reason: 'POST_NOT_APPROVED'`, making 0 publisher calls.
     *Recovery*: Calling `approvePost(postId)` properly heals the record by writing a valid `approvedAt` timestamp, after which publication succeeds normally. Alternatively, `retryPublishPost` exhibits self-healing by assigning `approvedAt: post.approvedAt || new Date()`.
   - *Attack Scenario B (Corrupted `SCHEDULED` post with `scheduledAt: null`)*:
     *Observation*: Line 958 specifies `scheduledAt: { not: null, lte: toleranceDate }`.
     *Result*: Queue runner safely excludes this post, preventing erroneous publishing.
     *Recovery*: Calling `reschedulePost(postId, date)` heals the timestamp, allowing the queue runner to pick it up and successfully publish it.
   - *Attack Scenario C (Simulated Hung Crash Mid-Publish `isPublishing: true`)*:
     *Observation*: Concurrency lock at lines 744–763 requires `isPublishing: false`.
     *Result*: Both direct publish and queue runner refuse to touch the hung post, preventing duplicate execution.
     *Recovery via `retryPublishPost`*: Line 912 explicitly resets `isPublishing: false`, `status: 'APPROVED'`, `publishError: null`, logs `AuditLog` action `'RETRY'`, and triggers re-publishing, reaching `status: 'PUBLISHED'` cleanly.
     *Recovery via `rejectPost`*: Line 566 explicitly resets `isPublishing: false` and transitions post to `REJECTED`, safely freeing the lock if the operator chooses to cancel rather than retry.

3. **Database Integrity & Teardown Verification**:
   - *Observation*: `scripts/verify-challenger-2-m4.ts` executes explicit teardown of all test `SocialPost`, `Campaign`, and `AuditLog` records, followed by `PRAGMA wal_checkpoint(FULL);`.
   - *Result*: `node scripts/check-counts.mjs` confirms 24 / 24 core business tables remain in 100% parity (Delta = 0).

---

## 3. Caveats

- **External Social Networks**:
  Tests were conducted using a spy publisher interceptor (`PublisherFunction`) to verify external call count invariants without incurring third-party network egress or external platform rate limits.
- **SQLite Concurrency Invariant**:
  Concurrency locking relies on atomic `updateMany` queries inside SQLite with WAL mode. In distributed multi-node environments, distributed locks (e.g. Redis Redlock or PG advisory locks) would be required, but for the single-instance SQLite architecture of Ưu Đàm Suite, SQLite `updateMany` provides ironclad atomicity.
- **No other caveats**: All requested challenge vectors were empirically tested and confirmed.

---

## 4. Conclusion

**Verdict: APPROVE**

Milestone 4's Review, Approval Workflow & Scheduling Engine (R4) satisfies all adversarial requirements:
1. **Gate 2 (Campaign Status Gate)** reliably prevents publishing expired or cancelled campaigns, instantly marks them `REJECTED`, records detailed `AuditLog` entries, and strictly makes 0 external calls.
2. **Corrupted State Recovery** is robust: unapproved or null-timestamped posts are intercepted by Gate 1, null-scheduled posts are safely ignored by queue runners, and hung publishing locks can be cleanly recovered via both `retryPublishPost` and `rejectPost`.
3. **Database Parity**: Zero regression across all 24 baseline tables.

---

## 5. Verification Method

To independently reproduce and verify this challenge report:

1. **Run Challenger 2 Empirical Adversarial Suite (56 assertions)**:
   ```powershell
   npx tsx scripts/verify-challenger-2-m4.ts
   ```
   *Expected Result*: 56/56 PASS, 0 FAIL.

2. **Verify Database Baseline Parity**:
   ```powershell
   node scripts/check-counts.mjs
   ```
   *Expected Result*: 24 / 24 Core Business Tables Checked, 100% MATCH (PASS).

3. **Run Worker M4 Verification Suite (88 assertions)**:
   ```powershell
   npx tsx scripts/verify-m4-scheduler.ts
   ```
   *Expected Result*: 88/88 PASS, 0 FAIL.
