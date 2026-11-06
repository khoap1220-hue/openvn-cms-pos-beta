# Handoff Report — Milestone 4 (R4): Reviewer 2 Re-evaluation & Adversarial Verification

**Reviewer / Evaluator**: `reviewer_2_m4_r2` (Reviewer, Adversarial Critic)  
**Milestone**: Milestone 4 — AUTO SOCIAL Post Review, Approval Workflow & Scheduling Engine (R4)  
**Target Recipient / Parent**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Date**: 2026-10-26T16:29:00Z  
**Verdict**: **APPROVE**  

---

## 1. Observation

Direct observations and execution outputs from codebase inspection, adversarial probe execution, and full test suite verification:

1. **Inspection of `src/lib/social-scheduler.ts` (lines 903–926)**:
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
   - Pre-condition strictly checks `post.status !== 'FAILED'`.
   - In-flight concurrency lock strictly checks `post.isPublishing`.
   - Gate 1 invariant strictly enforces `!post.approvedAt`.
   - Database update strictly sets `approvedAt: post.approvedAt` (retaining authentic approval date; zero timestamp fabrication).

2. **Inspection of `src/app/api/social/posts/[id]/route.ts` (lines 93–101)**:
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
   - Invariant exceptions thrown by `retryPublishPost` are caught and mapped directly to HTTP 400 Bad Request with descriptive JSON error payload `{ error: message }`.

3. **Independent Adversarial Probe Execution**:
   - `retryPublishPost` on `REJECTED` post: strictly threw `Error: Chỉ có thể thử lại bài viết ở trạng thái FAILED...`. Post status remained `REJECTED`, and exactly 0 publisher calls were made.
   - `retryPublishPost` on `DRAFT` post: strictly threw `Error: Chỉ có thể thử lại bài viết ở trạng thái FAILED...`. Post status remained `DRAFT`, 0 publisher calls.
   - `retryPublishPost` on `PENDING_APPROVAL` post: strictly threw `Error: Chỉ có thể thử lại bài viết ở trạng thái FAILED...`. Post status remained `PENDING_APPROVAL`, 0 publisher calls.
   - `PUT /api/social/posts/[id]` with `{ action: 'RETRY' }` on `REJECTED` post: returned HTTP 400 Bad Request with body `{"error":"Chỉ có thể thử lại bài viết ở trạng thái FAILED..."}`.
   - `retryPublishPost` on genuine `FAILED` post: succeeded (`success: true`), transitioned to `PUBLISHED`, released lock (`isPublishing: false`), cleared `publishError: null`, and preserved the original store owner's `approvedAt` timestamp identically down to the millisecond (`dbPost.approvedAt.getTime() === originalApprovedAt.getTime()`).
   - Edge cases tested: Corrupted post (`status: 'FAILED', approvedAt: null`) was strictly rejected with `'Bài viết chưa có sự phê duyệt hợp lệ'`; in-flight post (`isPublishing: true`) was strictly rejected with `'Bài viết đang trong tiến trình xuất bản'`.

4. **Test Suite Verification Runs**:
   - `npx tsx scripts/verify-m4-scheduler.ts`: **103 PASS, 0 FAIL** (100% passing including Phase 7.2 assertions).
   - `npx tsx scripts/verify-challenger-2-m4.ts`: **58 PASS, 0 FAIL** (100% passing including 1.3 & 2.3).
   - `npx tsx scripts/stress-m4-concurrency.ts`: **46 PASS, 0 FAIL** (100% passing concurrency locks & boundary tolerances).
   - `node scripts/check-counts.mjs`: **24 / 24 Core Business Tables 100% MATCH (Delta = 0)**.
   - `npx tsc --noEmit`: Exited with code 0 (0 type errors).
   - `npm run lint`: Exited with code 0 (0 ESLint errors/warnings).

5. **Code Integrity Audit**:
   - No hardcoded test outputs or dummy facades found in implementation code.
   - Genuine SQLite transactions via Prisma ORM.
   - No mock bypasses in production route handlers.

---

## 2. Logic Chain

1. **Vulnerability Remediation**: The initial vulnerability stemmed from `retryPublishPost` only filtering out `PUBLISHED` posts, allowing `REJECTED`, `DRAFT`, or `PENDING_APPROVAL` items to be pushed through with a synthetic `new Date()` timestamp. With the addition of `if (post.status !== 'FAILED')`, any non-FAILED post is rejected immediately before reaching the database mutation.
2. **Preservation of Authentic Approvals**: Setting `approvedAt: post.approvedAt` instead of `post.approvedAt || new Date()` guarantees that only posts that were genuinely approved by the store owner can be republished, and their historical approval timestamp is preserved intact without fabrication.
3. **In-Flight Concurrency Protection**: The check `if (post.isPublishing)` prevents race conditions where an operator manual retry collides with an active background runner or network dispatch.
4. **API Stability**: The dedicated `try...catch` block in `PUT /api/social/posts/[id]` maps domain errors from invalid retry attempts directly into HTTP 400 Bad Request with informative messages, satisfying REST API contracts.
5. **Empirical Evidence**: The combined execution of all 4 test suites (103 + 58 + 46 = 207 automated assertions), our independent adversarial probes, zero type/lint errors, and 100% database baseline parity confirms that Milestone 4 (R4) is completely robust and free of regressions.

---

## 3. Caveats

- **No Caveats**: The database baseline check confirmed zero unintended schema or data drift across all 24 core tables. All temporary test records and audit entries were cleanly deleted.

---

## 4. Conclusion

**Verdict: APPROVE**

The Critical Invariant Bypass Vulnerability in `retryPublishPost` has been 100% resolved:
- Invariant gates are strictly enforced (only `FAILED`, not currently `isPublishing`, non-null `approvedAt`).
- Authentic approval timestamps are preserved with zero synthetic fabrication.
- API endpoints handle errors gracefully with HTTP 400.
- All regression and stress test suites pass with 100% clean results.
- Zero integrity violations were detected.

Milestone 4 (AUTO SOCIAL Post Review, Approval Workflow & Scheduling Engine) is verified and production-ready.

---

## 5. Verification Method

To reproduce and verify these findings independently, execute the following commands in the workspace root:

```bash
# 1. Main scheduler & Phase 7.2 invariant regression suite (103 assertions)
npx tsx scripts/verify-m4-scheduler.ts

# 2. Adversarial lifecycle & recovery challenger suite (58 assertions)
npx tsx scripts/verify-challenger-2-m4.ts

# 3. Concurrency lock & scheduling boundary stress suite (46 assertions)
npx tsx scripts/stress-m4-concurrency.ts

# 4. Database baseline audit (24 core business tables parity check)
node scripts/check-counts.mjs

# 5. Static analysis
npx tsc --noEmit
npm run lint
```
