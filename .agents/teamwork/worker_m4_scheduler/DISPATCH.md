## 2026-10-26T15:44:56Z
You are Worker M4 for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma 6.11.1 + SQLite).

## Your Mission
Implement Milestone 4: Post Review, Approval Workflow & Scheduling Engine (R4) covering features FEAT-REV-01 through FEAT-REV-05.

## Exclusively Owned Files
You have EXCLUSIVE write ownership of the following files. Do NOT touch any other source files:
- `src/lib/social-scheduler.ts`
- `src/app/api/social/posts/route.ts`
- `src/app/api/social/posts/[id]/route.ts`
- `src/app/api/social/schedule/route.ts`
- `scripts/verify-m4-scheduler.ts`

Working Directory: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m4_scheduler\`

Read the following project documentation before writing code:
- `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (specifically R4 and Acceptance Criteria lines 104-106, 134-138)
- `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md` (Architecture, Features FEAT-REV-01..05, Interface Contracts)
- `prisma/schema.prisma` (lines 485-679: Campaign, SocialPlan, SocialPost, SocialChannelConfig, AuditLog models)
- `src/lib/campaign-service.ts` (`computeCampaignStatus`, `CampaignStatus`)

## Mandatory Integrity Warning
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

## Technical Requirements for `src/lib/social-scheduler.ts`
1. **Post Lifecycle State Machine (FEAT-REV-01)**:
   - Statuses: `DRAFT` | `PENDING_APPROVAL` | `APPROVED` | `SCHEDULED` | `PUBLISHING` | `PUBLISHED` | `FAILED` | `REJECTED`.
   - Transitions:
     - `DRAFT` -> `PENDING_APPROVAL` -> `APPROVED` or `REJECTED`.
     - `APPROVED` can transition to `SCHEDULED` (if `scheduledAt` set) or published immediately.
     - `REJECTED` can be edited back to `DRAFT` or `PENDING_APPROVAL`.
   - Action functions:
     - `submitForApproval(postId: string)`: transitions DRAFT -> PENDING_APPROVAL.
     - `approvePost(postId: string, approver: string, note?: string)`: transitions to APPROVED, records `approvedBy`, `approvedAt: new Date()`, `approvalNote`, writes AuditLog.
     - `rejectPost(postId: string, approver: string, reason: string)`: transitions to REJECTED, records `approvalNote: reason`, writes AuditLog.
     - `reschedulePost(postId: string, scheduledAt: Date)`: updates `scheduledAt`, sets status to `SCHEDULED` if previously `APPROVED`.
     - `createPost(...)`, `updatePost(...)`, `getPost(...)`, `listPosts(...)`, `deletePost(...)`.

2. **The Three Iron Publishing Gates (CRITICAL R4 INVARIANT)**:
   When `publishPostItem(postId: string, options?: PublishOptions)` or `processScheduledPosts()` runs:
   - **Gate 1: Owner Approval Gate**:
     - Check: Post MUST have `status === 'APPROVED'` or `status === 'SCHEDULED'`, and `approvedAt != null`.
     - If post is in `DRAFT`, `PENDING_APPROVAL`, or `REJECTED`, reject immediately with error `POST_NOT_APPROVED`. NEVER publish.
   - **Gate 2: Campaign Status Gate**:
     - If post is linked to a `campaignId`:
       - Fetch Campaign and evaluate dynamic status via `computeCampaignStatus(campaign)`.
       - If status is `ENDED` or `CANCELLED`:
         - Transition post to `REJECTED`.
         - Set `approvalNote = 'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy'`.
         - Write `AuditLog` entry with `action: 'REJECT'`, `details: JSON.stringify({ reason: 'CAMPAIGN_ENDED_OR_CANCELLED', campaignStatus })`.
         - Reject publication immediately. NEVER publish.
   - **Gate 3: Scheduled Time Gate**:
     - If post is scheduled (`scheduledAt != null`):
       - Tolerable publishing window: current time `now` must be `>= scheduledAt.getTime() - 60_000ms` (within 1 minute tolerance).
       - If `now < scheduledAt.getTime() - 60_000ms`, skip publishing (post remains `SCHEDULED`).

3. **Concurrency Idempotency Lock (FEAT-REV-03)**:
   - Prevent double-publishing when multiple triggers (e.g. cron and manual trigger) run at the exact same millisecond:
   - Execute an atomic SQLite update via Prisma:
     ```typescript
     const updateResult = await prisma.socialPost.updateMany({
       where: {
         id: postId,
         isPublishing: false,
         status: { in: ['APPROVED', 'SCHEDULED'] }
       },
       data: {
         isPublishing: true,
         status: 'PUBLISHING'
       }
     });
     if (updateResult.count === 0) {
       // Lock acquisition failed or post not in publishable state
       return { success: false, reason: 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS' };
     }
     ```
   - Running publishing twice in parallel MUST only execute publishing once. The second call must detect the lock and return false/skip.

4. **Publish Execution & Fallback Integration**:
   - Provide interface:
     ```typescript
     export interface PublishRequest {
       postId: string;
       channel: string;
       content: string;
       title?: string | null;
       mediaUrls?: string[];
       scheduledAt?: Date | null;
       isMock: boolean;
     }
     export interface PublishResult {
       success: boolean;
       externalPostId?: string;
       externalPostUrl?: string;
       publishedAt?: Date;
       error?: string;
       isMockResult?: boolean;
     }
     ```
   - Support a pluggable publisher function or import from `@/lib/publishing-gateway` if it exists. If `@/lib/publishing-gateway` does not exist yet, provide a built-in safe mock publisher that validates payload and returns a simulated response: `{ success: true, externalPostId: `mock_${channel}_${Date.now()}`, externalPostUrl: `https://${channel.toLowerCase()}.com/p/mock_${Date.now()}`, publishedAt: new Date(), isMockResult: true }`.

5. **Publishing Retry & Failure Handling (FEAT-REV-05)**:
   - If publisher throws an error or returns `{ success: false }`:
     - Update post: `isPublishing: false`, `status: 'FAILED'`, `publishError: error.message`, `retryCount: { increment: 1 }`.
     - Write `AuditLog` entry with `action: 'ERROR'`, `status: 'FAILED'`.
   - Provide `retryPublishPost(postId: string)`:
     - Resets `status = 'APPROVED'` and re-triggers execution.
   - On publish success:
     - Update post: `isPublishing: false`, `status: 'PUBLISHED'`, `publishedAt: new Date()`, `externalPostId`, `externalPostUrl`, `isMock: true`.
     - Write `AuditLog` entry with `action: 'PUBLISH'`, `status: 'SUCCESS'`.

6. **Scheduled Queue Runner (FEAT-REV-02)**:
   - `processScheduledPosts(referenceTime?: Date)`:
     - Finds all posts where `status in ['APPROVED', 'SCHEDULED']`, `isPublishing: false`, and `scheduledAt <= referenceTime + 60s`.
     - Runs each through the Three Iron Gates and concurrency lock.
     - Returns summary `{ processed: number, published: number, skipped: number, failed: number }`.

## Technical Requirements for Next.js 16 Route Handlers
- All route handlers must specify `export const dynamic = 'force-dynamic'`.
- Dynamic parameters in `[id]/route.ts`: `const { id } = await params;` (`params` is a Promise in Next.js 16!).
- `src/app/api/social/posts/route.ts`:
  - `GET`: query posts with search/filter params (`campaignId`, `status`, `channel`, `planId`).
  - `POST`: create post draft.
- `src/app/api/social/posts/[id]/route.ts`:
  - `GET`: return post with campaign and audit logs.
  - `PUT`: update post, or dispatch actions based on body:
    - `{ action: 'APPROVE', approver: string, note?: string }`
    - `{ action: 'REJECT', approver: string, reason: string }`
    - `{ action: 'RESCHEDULE', scheduledAt: string }`
    - `{ action: 'RETRY' }`
  - `DELETE`: delete post (allowed only for non-published posts).
- `src/app/api/social/schedule/route.ts`:
  - `POST`: invoke `processScheduledPosts()`, return summary.

## Verification Script: `scripts/verify-m4-scheduler.ts`
Create a rigorous test script verifying:
1. Owner Approval Gate: DRAFT, PENDING_APPROVAL, and REJECTED posts cannot be published.
2. Campaign Status Gate: Posts linked to ENDED or CANCELLED campaigns are blocked, transitioned to REJECTED with AuditLog.
3. Scheduled Time Gate: Posts scheduled in future (> 60s) are not published; posts scheduled in past or within 60s tolerance are published.
4. Concurrency Idempotency: 2 concurrent publishing calls on the same post publish exactly once.
5. Failure & Retry: Failed publish marks FAILED, increments retryCount, writes AuditLog; retryPublishPost succeeds.
6. API Handlers: Test Next.js 16 route handlers directly (POST, GET, PUT approve/reject/reschedule/retry, DELETE).
7. Clean Teardown: Delete all created test data (posts, campaigns, audit logs).
8. Parity Check: Verify `node scripts/check-counts.mjs` returns 100% MATCH (Delta = 0).
9. Typecheck: Run `npx tsc --noEmit` to ensure 0 TypeScript errors.

When done, write a detailed handoff report in `.agents/teamwork/worker_m4_scheduler/handoff.md` and send a message back.
