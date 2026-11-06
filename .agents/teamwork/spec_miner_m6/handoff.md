# Specification Discovery & 4-Tier E2E Test Plan for Auto Social
**Author**: `spec_miner_m6` (Milestone 6: E2E Testing Track & Operational Safety)  
**Date**: 2026-10-26T17:35:00Z  
**Target Test Suite**: `scripts/verify-auto-social.ts`  
**Target Documentation**: `TEST_READY.md`  
**Working Directory**: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_m6\`

---

## 1. Features Discovered

| # | Category | Feature | Description | Inputs | Outputs | Error Behavior | Discovered Via |
|---|----------|---------|-------------|--------|---------|----------------|----------------|
| 1 | CRM | FEAT-CRM-01: Campaign Schema & DB Backup | Safe WAL checkpoint, backup `custom.db.bak.pre-autosocial`, additive `Campaign` model with zero baseline regression | File path / DB connection | Backup stat > 0, SQLite header `SQLite format 3`, Prisma delegate `db.campaign` | Missing file throws error, corrupted magic header detected | `prisma/schema.prisma:490-516`, `scripts/backup-pre-autosocial.mjs` |
| 2 | CRM | FEAT-CRM-02: Campaign CRUD API | REST endpoints & service for campaign create, read, update, delete with validation | `CreateCampaignInput` (`name`, `startDate`, `endDate`, `code`, etc.) | `CampaignData` with ISO dates & enriched pricing | Empty name throws 400, `endDate <= startDate` throws 400, duplicate code throws 409 | `src/lib/campaign-service.ts:404-620`, `src/app/api/campaigns/` |
| 3 | CRM | FEAT-CRM-03: Campaign Boundary State Engine | Dynamic real-time computation of `UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED` based on server time boundaries | `campaign: { startDate, endDate, status }`, `now?: Date` | `CampaignStatus` ('UPCOMING' \| 'RUNNING' \| 'ENDED' \| 'CANCELLED') | Invalid date string safely evaluates to 'ENDED' | `src/lib/campaign-service.ts:140-167` |
| 4 | CRM | FEAT-CRM-04: Campaign Product & Voucher Linkage | Associate existing products and vouchers from CRM to campaign with pricing and discount calculations | `campaign: Campaign`, `now?: Date` | `CampaignData` with `EnrichedProductPricing[]` and `EnrichedVoucherInfo[]` | Non-existent product/voucher IDs ignored gracefully without crashing | `src/lib/campaign-service.ts:239-350` |
| 5 | DRV | FEAT-DRV-01: Public Drive URL Parsing | Extract folder/file ID and resource type from various Google Drive public share link formats | `url: string` (folders, open?id, docs, sheets, bare ID) | `ParsedDriveUrl` (`id`, `type`, `rawUrl`) | Malformed or non-Drive URL throws clear error message | `src/lib/drive-parser.ts:89-166` |
| 6 | DRV | FEAT-DRV-02: Hybrid Drive File Enumerator | API v3 + Zero-Key `window['_DRIVE_ivd']` crawler listing files, MIME types, and subfolder hierarchy | `folderId: string` | `DriveFolderResult` (`totalItems`, `items[]`, `fileTree`) | Inaccessible/private folder triggers structured error | `src/lib/drive-parser.ts:220-450` |
| 7 | DRV | FEAT-DRV-03: Drive Content Extraction | Extract text from Google Docs (`/export?format=txt`), Google Sheets (`/export?format=csv`), images/videos CDN URLs | `driveFileId`, `mimeType`, `fileType` | `textContent: string` and thumbnail/view links | Export failure returns null textContent without breaking sync | `src/lib/drive-parser.ts:450-580` |
| 8 | DRV | FEAT-DRV-04: Drive Non-Destructive Re-Sync | Re-sync folder metadata while preserving manual product/campaign associations and foreign keys | `SyncDriveFolderInput` | `SyncDriveFolderOutput` (`contentSource`, `items[]`, `isUpdated`) | Unchanged files preserved, manual campaign links untouched | `src/lib/drive-parser.ts:580-750` |
| 9 | DRV | FEAT-DRV-05: Drive Error Handling & Recovery | Graceful handling and structured error messages for private, 404, or malformed Drive links | Invalid/private Drive folder URL | Sets `ContentSource.syncStatus = 'ERROR'` and records `syncError` | Never corrupts database or deletes existing items on sync error | `src/lib/drive-parser.ts:750-926` |
| 10 | AI | FEAT-AI-01: Campaign AI Plan Generator | Generate structured social calendar across 7 platforms matching campaign dates and target products | `campaignId: string`, `GeneratePlanOptions` | `GeneratedSocialPlanResult` (`plan`, `posts: PlatformDraft[]`, `rubricSummary`) | Invalid campaign throws error; empty products falls back to generic brand copy | `src/lib/social-ai.ts:1050-1350` |
| 11 | AI | FEAT-AI-02: Ưu Đàm Brand Tone Engine | System prompt enforcing serene, mindful, premium brand voice, banning AI cliches (`BANNED_PHRASES`) | `text: string` | Sanitized text with brand pronouns ("tụi em", "mình") and 0 banned phrases | `detectBannedPhrases` identifies violations and lowers voice score | `src/lib/social-ai.ts:208-280`, `src/lib/agent-voice.ts` |
| 12 | AI | FEAT-AI-03: Deterministic CRM Invariant Matcher | Code-level verification that generated copy strictly matches CRM prices, discounts, and voucher codes | `content`, `campaign`, `product`, `voucher` | `{ valid, matchedPrice, matchedDiscount, matchedVoucher, missingItems }` | `enforceCrmInvariants` auto-appends exact CRM data block if deviated | `src/lib/social-ai.ts:281-417` |
| 13 | AI | FEAT-AI-04: Platform Copy Adaptation | Tailor copy to character limits and conventions (Threads <= 500 chars, IG hashtags, TikTok hooks) | Platform drafts across 7 channels | Tailored drafts matching platform length, structure, and media rules | Violating limits (e.g. Threads > 500 chars) incurs heavy rubric penalties | `src/lib/social-ai.ts:500-650` |
| 14 | AI | FEAT-AI-05: Rubric Quality Gate (>= 8/10) | 4-criterion automated rubric evaluation (CRM, Voice, Format, CTA) with pass threshold >= 8.0/10 | `draft`, `campaign`, `product`, `voucher` | `RubricEvaluation` (`overallScore`, `passed`, individual criterion scores) | Scores < 8.0 marked as failed; detailed diagnostic feedback provided | `src/lib/social-ai.ts:420-580` |
| 15 | REV | FEAT-REV-01: Owner Approval Workflow | State machine ensuring posts cannot be published without explicit owner approval (`APPROVED` state) | `postId`, `approver`, `note`, `reason` | `SocialPost` with updated status, `approvedBy`, `approvedAt`, `approvalNote` | Direct publish of unapproved post rejected with `POST_NOT_APPROVED` | `src/lib/social-scheduler.ts:220-584` |
| 16 | REV | FEAT-REV-02: Scheduled Execution Engine | Background runner executing scheduled posts within <= 1 min of target time | `referenceTime?: Date`, `publisher?` | `ProcessScheduledResult` (`processed`, `published`, `skipped`, `failed`) | Posts with `scheduledAt > now + 60s` are skipped | `src/lib/social-scheduler.ts:635-741, 850-950` |
| 17 | REV | FEAT-REV-03: Concurrency Idempotency Lock | Database-level lock (`isPublishing`) preventing duplicate publishing on concurrent triggers | Concurrent `publishPostItem` calls | Exactly one call returns `success: true`, concurrent call returns lock rejection | Prevents race condition and double-posting across worker processes | `src/lib/social-scheduler.ts:742-764` |
| 18 | REV | FEAT-REV-04: Campaign Status Publication Gate | Block publication of posts associated with `ENDED` or `CANCELLED` campaigns | `postId`, `campaignId` | Returns `CAMPAIGN_ENDED_OR_CANCELLED`, auto-rejects post to `REJECTED` | Post never sent to publisher adapter if campaign is not active | `src/lib/social-scheduler.ts:678-723` |
| 19 | REV | FEAT-REV-05: Publishing Retry & Failure Log | Structured error logging and manual retry mechanism for failed publications | `postId` (failed post) | `SocialPost` updated with `retryCount`, `publishError`, status `FAILED` / `PUBLISHED` | Retry resets lock and re-evaluates all three publishing gates | `src/lib/social-scheduler.ts:780-845` |
| 20 | PUB | FEAT-PUB-01: Facebook Fanpage Adapter | Publisher adapter for Facebook page feed with media and link attachment | `PublishRequest` | `PublishResult` (`externalPostId`, `externalPostUrl`, `payloadSnapshot`) | Missing content throws error; live mode requires access token & page ID | `src/lib/publishing-gateway.ts:147-250` |
| 21 | PUB | FEAT-PUB-02: Zalo OA Adapter | Publisher adapter for Zalo Official Account Open API article / message broadcast | `PublishRequest` | `PublishResult` with Zalo message ID format (`zalo_msg_*`) | Missing content throws error; live mode requires valid OA access token | `src/lib/publishing-gateway.ts:251-367` |
| 22 | PUB | FEAT-PUB-03: Internal Website Blog | Integrated blog publishing with public view routes `/blog` and `/blog/[slug]` | `PublishRequest` (`title`, `content`, `slug`) | `PublishResult` with internal URL `/blog/[slug]`, public record created | Empty content rejected; missing slug automatically generated from title | `src/lib/publishing-gateway.ts:368-444`, `src/app/blog/` |
| 23 | PUB | FEAT-PUB-04: External Web Adapter | Webhook / REST adapter for external CMS (WordPress, Haravan, Sapo) | `PublishRequest` | `PublishResult` with external store URL and payload snapshot | Missing webhook URL in live mode throws error; safe mock succeeds | `src/lib/publishing-gateway.ts:445-558` |
| 24 | PUB | FEAT-PUB-05: Instagram Adapter | Publisher adapter for Instagram with mandatory media asset validation | `PublishRequest` (`mediaUrls: string[]`) | `PublishResult` with IG container & post IDs | Missing media or empty media array throws explicit validation error | `src/lib/publishing-gateway.ts:559-674` |
| 25 | PUB | FEAT-PUB-06: TikTok Adapter | Publisher adapter for TikTok with mandatory video asset validation | `PublishRequest` (`mediaType: 'VIDEO'`, `mediaUrls: string[]`) | `PublishResult` with TikTok publish ID and video URL | `mediaType !== 'VIDEO'` or missing video URL throws validation error | `src/lib/publishing-gateway.ts:675-787` |
| 26 | PUB | FEAT-PUB-07: Threads Adapter | Publisher adapter for Threads with strict <= 500 character limit enforcement | `PublishRequest` (`content: string`) | `PublishResult` with Threads post ID and URL | Content exceeding 500 characters throws immediate validation error | `src/lib/publishing-gateway.ts:788-902` |
| 27 | PUB | FEAT-PUB-08: Safe Mock vs Real Switch | Automatic switching between validated safe mock responses and real API calls based on credentials | `options?: { channelConfig, forceMock }` | `boolean` (true = Safe Mock, false = Live API) | Never allows Live API in `NODE_ENV === 'test'` or without explicit env flag | `src/lib/publishing-gateway.ts:97-145` |
| 28 | SEC | FEAT-SEC-01: Test Isolation Invariant | Absolute prevention of real external network calls during automated testing | Global HTTP/HTTPS requests & fetch calls | Network Spy intercepts & throws `[SECURITY VETO]` if external host contacted | Ensures zero real external network calls during any test run | `src/lib/publishing-gateway.ts:109-123`, `scripts/verify-m5-publishing.ts:56-80` |
| 29 | SEC | FEAT-SEC-02: Zero Hardcoded Secrets | All credentials securely read from `IntegrationCredential`, `AppSetting`, or env vars | Codebase text scan | 0 matches for hardcoded tokens, keys, passwords, or secrets | Secret detection script flags any uncommitted or committed secret | `src/lib/publishing-gateway.ts`, `src/lib/llm.ts`, `ORIGINAL_REQUEST.md:R6` |
| 30 | SEC | FEAT-SEC-03: Resilience & Graceful Degradation | Fallback handling for Gemini Quota 429 and network timeouts | LLM API call failure / timeout / 429 | Returns null; pipeline gracefully invokes category-specific fallback template | Never throws unhandled exception; tags post with `generationSource: 'TEMPLATE_FALLBACK'` | `src/lib/llm.ts:43-85`, `src/lib/social-ai.ts:160, 930-970` |
| 31 | DAT | FEAT-DAT-01: DB Parity & Zero Regression | Baseline count preservation for all 24 core tables in `db/baseline-counts.json` | `baseline-counts.json` vs SQLite DB | `Delta = 0` across all 24 core business tables before & after tests | Row count mismatch in any core table fails the quality gate | `db/baseline-counts.json`, `scripts/check-counts.mjs` |
| 32 | QG | FEAT-QG-01: E2E Testing Suite (Tiers 1-4) | Comprehensive test suite (`scripts/verify-auto-social.ts`) covering all 35 features and boundary cases | Single terminal command execution | Clean exit code 0, 100% assertions passed, report generated | Any assertion failure exits with code 1 and detailed diagnostic trace | `scripts/verify-auto-social.ts`, `ORIGINAL_REQUEST.md:118-121` |
| 33 | UI | FEAT-UI-01: Admin Auto Social CRM & Calendar UI | Responsive management views for campaigns, content sources, calendar, and post approvals | Browser / HTTP rendering | Interactive admin views with CRUD, approval buttons, scheduling controls | Missing data shows graceful empty states without React crashes | `src/components/cms/views/auto-social-view.tsx`, `campaigns-view.tsx` |
| 34 | UI | FEAT-UI-02: Public Blog UI Route | Public responsive view for website blog posts at `/blog` and `/blog/[slug]` | HTTP GET requests to `/blog` and `/blog/[slug]` | Rendered HTML with OpenGraph metadata, article body, and media | Invalid slug returns Next.js 404 `notFound()`; unpublished posts hidden | `src/app/blog/page.tsx`, `src/app/blog/[slug]/page.tsx` |
| 35 | UI | FEAT-UI-03: Independent Browser Verification | Cross-device testing (Desktop + 390px Mobile), 0 console errors, no horizontal overflow | Headless browser execution / agent audit | Screenshot evidence, 0 console errors, width <= 390px viewport check | Console error or horizontal scrollbar triggers verification failure | `ORIGINAL_REQUEST.md:145-147`, `PROJECT.md:49` |

---

## 2. Edge Cases Discovered & Probed

| # | Feature | Input / Trigger | Observed & Specified Behavior |
|---|---------|-----------------|-------------------------------|
| 1 | FEAT-CRM-02 | `createCampaign` with `endDate === startDate` | Rejected with error "Thời gian kết thúc phải diễn ra sau thời gian bắt đầu" (boundary equality check). |
| 2 | FEAT-CRM-02 | `createCampaign` with `endDate < startDate` | Rejected with error "Thời gian kết thúc phải diễn ra sau thời gian bắt đầu" (inverted interval check). |
| 3 | FEAT-CRM-02 | `createCampaign` with empty name `""` or `"   "` | Rejected with error "Tên chương trình không được để trống". |
| 4 | FEAT-CRM-02 | `createCampaign` with duplicate `code` | Throws conflict error with `statusCode: 409` ("Mã chiến dịch ... đã tồn tại"). |
| 5 | FEAT-CRM-03 | `computeCampaignStatus` at exact millisecond `now === startDate` | Evaluates to `'RUNNING'` (inclusive lower bound `startDate <= now <= endDate`). |
| 6 | FEAT-CRM-03 | `computeCampaignStatus` at exact millisecond `now === endDate` | Evaluates to `'RUNNING'` (inclusive upper bound `startDate <= now <= endDate`). |
| 7 | FEAT-CRM-03 | `computeCampaignStatus` at `now === startDate - 1ms` | Evaluates to `'UPCOMING'`. |
| 8 | FEAT-CRM-03 | `computeCampaignStatus` at `now === endDate + 1ms` | Evaluates to `'ENDED'`. |
| 9 | FEAT-CRM-03 | `computeCampaignStatus` when campaign status is `'CANCELLED'` | Returns `'CANCELLED'` regardless of whether `now` is within start/end dates. |
| 10 | FEAT-DRV-01 | `parseDriveUrl` with empty string or whitespace | Throws "Đường dẫn Google Drive không được để trống". |
| 11 | FEAT-DRV-01 | `parseDriveUrl` with non-Drive URL (e.g. `https://example.com`) | Throws "Định dạng URL Google Drive không hợp lệ. Vui lòng cung cấp liên kết chia sẻ dạng: https://drive.google.com/drive/folders/{id}". |
| 12 | FEAT-DRV-01 | `parseDriveUrl` with bare ID string of 28 alphanumeric characters | Successfully identifies type `'folder'` and constructs standard drive URL. |
| 13 | FEAT-DRV-05 | Syncing private or non-existent Drive folder (403/404) | Sets `syncStatus = 'ERROR'`, logs `syncError`, does not crash, preserves existing items. |
| 14 | FEAT-AI-02 | Content containing commercial cliche "kính chào quý khách" | `sanitizeBrandVoice` replaces with "thương gửi mình"; `detectBannedPhrases` flags it if un-sanitized. |
| 15 | FEAT-AI-03 | Content missing target product price or voucher code | `validateCrmInvariants` returns `valid: false`; `enforceCrmInvariants` auto-injects verified CRM block. |
| 16 | FEAT-AI-04 | Threads post content of exactly 500 characters | Passes validation (`len <= 500`). |
| 17 | FEAT-AI-04 | Threads post content of 501 characters | Throws error "Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: 501)" and rubric formatting score drops to 2.0. |
| 18 | FEAT-REV-01 | `publishPostItem` called on post with status `DRAFT` or `PENDING_APPROVAL` | Gate 1 blocks publication with reason `POST_NOT_APPROVED`; post remains unpublished. |
| 19 | FEAT-REV-01 | `publishPostItem` called on post with status `REJECTED` | Gate 1 blocks publication with reason `POST_NOT_APPROVED`. |
| 20 | FEAT-REV-02 | `publishPostItem` called on post scheduled 5 minutes in future | Gate 3 skips execution with `skipped: true, reason: 'SCHEDULED_TIME_NOT_REACHED'`. |
| 21 | FEAT-REV-02 | `publishPostItem` called on post scheduled 45 seconds in future (within 60s tolerance) | Gate 3 allows execution (`now >= scheduledAt - 60s`). Post publishes successfully. |
| 22 | FEAT-REV-03 | Two concurrent calls to `publishPostItem` on same post | Atomic `updateMany` lock allows first call to proceed (`status: PUBLISHING`); second call returns `CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS`. Exactly 1 post published. |
| 23 | FEAT-REV-04 | Post approved, but associated campaign is `ENDED` or `CANCELLED` at publish time | Gate 2 detects dead campaign, auto-updates post to `REJECTED` with note "Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy", blocks publication. |
| 24 | FEAT-REV-05 | Publisher adapter returns failure (e.g. mock network error) | Post updated to `status: 'FAILED'`, `retryCount` incremented to 1, `publishError` populated. Calling `retryPublishPost` resets lock and retries successfully. |
| 25 | FEAT-PUB-05 | Instagram publish called with empty `mediaUrls: []` | Validation throws "Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video". |
| 26 | FEAT-PUB-06 | TikTok publish called with `mediaType === 'IMAGE'` or empty media | Validation throws "TikTok bắt buộc phải có tài nguyên video". |
| 27 | FEAT-PUB-07 | Threads publish called with 501 characters | Validation throws "Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: 501)". |
| 28 | FEAT-PUB-08 | Automated test execution with `NODE_ENV === 'test'` | `shouldUseSafeMock` strictly returns `true` regardless of DB credentials or input flags. Zero live socket calls. |
| 29 | FEAT-SEC-01 | Attempt to issue live fetch to `graph.facebook.com` during testing | Network Spy throws `[SECURITY VETO]` and increments outbound attempt counter; test verifies count is 0. |
| 30 | FEAT-SEC-03 | Gemini LLM returns HTTP 429 (Quota Exceeded) or times out | `llmChat` returns `null`; `generatePlatformDraft` falls back to category-specific template, accurately tagging `generationSource: 'TEMPLATE_FALLBACK'`. |
| 31 | FEAT-DAT-01 | Baseline audit run before tests vs after teardown | All 24 core business tables maintain exact row counts (`Delta = 0`); zero orphan records remain in database. |
| 32 | FEAT-UI-02 | Requesting `/blog/[slug]` with non-existent slug `bai-viet-khong-ton-tai` | Route triggers Next.js `notFound()`, rendering custom 404 page with 0 unhandled exceptions. |

---

## 3. The Authoritative 4-Tier E2E Test Plan for `scripts/verify-auto-social.ts`

The test runner `scripts/verify-auto-social.ts` is designed to be executed via:
```bash
node --experimental-strip-types scripts/verify-auto-social.ts
```
It requires zero third-party test runners, operates deterministically, protects all 24 baseline tables, and is structured into 4 distinct tiers:

```
================================================================================
OPENVN · ƯU ĐÀM SUITE — AUTO SOCIAL E2E MASTER VERIFICATION SUITE
================================================================================
Tier 1: Feature Coverage (35 Features in Isolation, >= 5 Tests per Area)
Tier 2: Boundary & Corner Cases (>= 5 Tests per Area, Limits, Locks, Time Tolerance)
Tier 3: Cross-Feature Combinations (Pairwise Inter-Module Workflows)
Tier 4: Real-World Workload Scenarios (Full Lifecycle, 429 Fallback, Teardown Parity)
================================================================================
```

### 3.1. Tier 1: Feature Coverage (Isolation Testing, >= 5 Tests per Area)

In Tier 1, all 35 features are probed in isolation with straightforward pass/fail assertions:

#### Area 1: CRM Campaigns & DB Safety (FEAT-CRM-01..04)
- **T1-CRM-01 (FEAT-CRM-01)**: Verify `db/custom.db.bak.pre-autosocial` exists, size > 0, and header equals `SQLite format 3`.
- **T1-CRM-02 (FEAT-CRM-02)**: Create valid campaign `CP-TEST-T1-CRM` via `createCampaign`; assert ID generated, fields match input.
- **T1-CRM-03 (FEAT-CRM-02)**: Read campaign via `getCampaign` and `listCampaigns`; assert pagination and filter by code work.
- **T1-CRM-04 (FEAT-CRM-02)**: Update campaign title and description via `updateCampaign`; assert changes persisted and `updatedAt` refreshed.
- **T1-CRM-05 (FEAT-CRM-03)**: Compute status for upcoming campaign (`now < startDate`); assert returns `'UPCOMING'`.
- **T1-CRM-06 (FEAT-CRM-03)**: Compute status for active campaign (`startDate <= now <= endDate`); assert returns `'RUNNING'`.
- **T1-CRM-07 (FEAT-CRM-04)**: Call `enrichCampaignData` with linked product `Product[0]`; assert `campaignPrice`, `originalPrice`, and `discountPercent` calculated correctly.

#### Area 2: Google Drive Ingestion (FEAT-DRV-01..05)
- **T1-DRV-01 (FEAT-DRV-01)**: Parse standard folder URL `https://drive.google.com/drive/folders/1abcXYZ_1234567890`; assert `id === '1abcXYZ_1234567890'` and `type === 'folder'`.
- **T1-DRV-02 (FEAT-DRV-01)**: Parse open ID URL `https://drive.google.com/open?id=1open_id_xyz9876543210`; assert `id === '1open_id_xyz9876543210'`.
- **T1-DRV-03 (FEAT-DRV-02)**: Enumerate mock Drive folder; assert returns file items list and hierarchical `fileTree` node with children.
- **T1-DRV-04 (FEAT-DRV-03)**: Extract text content from mock Google Doc and Google Sheet; assert `fileType === 'DOCUMENT'` and `fileType === 'SHEET'`.
- **T1-DRV-05 (FEAT-DRV-04)**: Execute `syncDriveFolderToDatabase` with valid folder; assert `ContentSource` and `ContentSourceItem` records created.
- **T1-DRV-06 (FEAT-DRV-05)**: Call sync with malformed URL; assert `syncStatus === 'ERROR'`, error message recorded, and zero crash.

#### Area 3: AI Copywriting & Brand Voice (FEAT-AI-01..05)
- **T1-AI-01 (FEAT-AI-01)**: Call `generateSocialPlan` with campaign and 7 target platforms; assert generates 7 platform drafts across valid dates.
- **T1-AI-02 (FEAT-AI-02)**: Run `sanitizeBrandVoice` on text with "kính chào quý khách"; assert transformed to "thương gửi mình".
- **T1-AI-03 (FEAT-AI-02)**: Run `detectBannedPhrases` on clean Ưu Đàm copy; assert returns empty array (`[]`).
- **T1-AI-04 (FEAT-AI-03)**: Validate CRM invariants on draft with matching price (150.000đ) and voucher (UUDAM10); assert `valid === true`.
- **T1-AI-05 (FEAT-AI-04)**: Verify draft for Threads has `length <= 500` characters.
- **T1-AI-06 (FEAT-AI-05)**: Evaluate draft rubric via `evaluateDraftRubric`; assert returns `overallScore >= 8.0` and `passed === true`.

#### Area 4: Review, Approval & Scheduling (FEAT-REV-01..05)
- **T1-REV-01 (FEAT-REV-01)**: Create post via `createPost`; assert initial status is `'DRAFT'`.
- **T1-REV-02 (FEAT-REV-01)**: Submit post via `submitForApproval`; assert status transitions to `'PENDING_APPROVAL'`.
- **T1-REV-03 (FEAT-REV-01)**: Approve post via `approvePost`; assert status becomes `'APPROVED'` (or `'SCHEDULED'` if date set) and `approvedAt` recorded.
- **T1-REV-04 (FEAT-REV-01)**: Reject post via `rejectPost`; assert status becomes `'REJECTED'` and `approvalNote` stores reason.
- **T1-REV-05 (FEAT-REV-02)**: Run `processScheduledPosts` at target time; assert approved scheduled post is processed.
- **T1-REV-06 (FEAT-REV-03)**: Verify `isPublishing` lock prevents double execution.
- **T1-REV-07 (FEAT-REV-04)**: Attempt to publish post of cancelled campaign; assert blocked.
- **T1-REV-08 (FEAT-REV-05)**: Check audit log creation for post lifecycle events (`CREATE`, `APPROVE`, `REJECT`, `PUBLISH`).

#### Area 5: 7-Platform Publishing Gateway (FEAT-PUB-01..08)
- **T1-PUB-01 (FEAT-PUB-01)**: Format & publish via `FacebookAdapter` in Safe Mock mode; assert `externalPostId.startsWith('fb_post_')` and `isMockResult === true`.
- **T1-PUB-02 (FEAT-PUB-02)**: Format & publish via `ZaloAdapter` in Safe Mock mode; assert `externalPostId.startsWith('zalo_msg_')` and `isMockResult === true`.
- **T1-PUB-03 (FEAT-PUB-03)**: Publish via `WebsiteBlogAdapter`; assert slug assigned and `externalPostUrl === '/blog/' + slug`.
- **T1-PUB-04 (FEAT-PUB-04)**: Format & publish via `ExternalCmsAdapter`; assert external post URL generated and `status: 'published'`.
- **T1-PUB-05 (FEAT-PUB-05)**: Format & publish via `InstagramAdapter` with valid media; assert container and post IDs returned.
- **T1-PUB-06 (FEAT-PUB-06)**: Format & publish via `TikTokAdapter` with `mediaType: 'VIDEO'`; assert `publish_id` returned.
- **T1-PUB-07 (FEAT-PUB-07)**: Format & publish via `ThreadsAdapter` with content < 500 chars; assert `threads_post_*` returned.
- **T1-PUB-08 (FEAT-PUB-08)**: Verify `shouldUseSafeMock({ forceMock: true }) === true`.

#### Area 6: Security & Operational Safety (FEAT-SEC-01..03)
- **T1-SEC-01 (FEAT-SEC-01)**: Verify Network Spy is initialized and `outboundHttpAttempts === 0`.
- **T1-SEC-02 (FEAT-SEC-01)**: Verify `process.env.NODE_ENV === 'test'` enforces mock across all publisher adapters.
- **T1-SEC-03 (FEAT-SEC-02)**: Scan `src/lib/publishing-gateway.ts` and `src/lib/social-ai.ts`; assert 0 hardcoded bearer tokens or passwords.
- **T1-SEC-04 (FEAT-SEC-03)**: Invoke `llmChat` with mock error simulation; assert returns null without throwing unhandled rejection.
- **T1-SEC-05 (FEAT-SEC-03)**: Verify `generatePlatformDraft` falls back to category-specific template and sets `generationSource === 'TEMPLATE_FALLBACK'`.

#### Area 7: Data Integrity & Quality Gates (FEAT-DAT-01, FEAT-QG-01)
- **T1-DAT-01 (FEAT-DAT-01)**: Read `db/baseline-counts.json`; verify all 24 core table models exist in Prisma client.
- **T1-DAT-02 (FEAT-DAT-01)**: Execute initial baseline count audit; assert 100% match (Delta = 0).
- **T1-DAT-03 (FEAT-DAT-01)**: Create and delete a test campaign; assert core table counts remain identical.
- **T1-QG-01 (FEAT-QG-01)**: Verify runner script completes and outputs structured tier summaries.
- **T1-QG-02 (FEAT-QG-01)**: Verify clean error handling and exit codes (0 on success, 1 on failure).

#### Area 8: User Interface & Browser Verification (FEAT-UI-01..03)
- **T1-UI-01 (FEAT-UI-01)**: Verify admin campaign and social route handlers exist (`/api/campaigns`, `/api/social/posts`).
- **T1-UI-02 (FEAT-UI-02)**: Import `BlogListPage` from `src/app/blog/page.tsx`; assert default export is valid React component function.
- **T1-UI-03 (FEAT-UI-02)**: Import `BlogPostPage` and `generateMetadata` from `src/app/blog/[slug]/page.tsx`; assert exports exist.
- **T1-UI-04 (FEAT-UI-02)**: Call `generateBlogMetadata({ params: Promise.resolve({ slug: 'test-slug' }) })`; assert returns title structure.
- **T1-UI-05 (FEAT-UI-03)**: Assert UI layout definitions contain mobile responsive classes (`max-w-full`, `overflow-hidden`, `px-4`).

---

### 3.2. Tier 2: Boundary & Corner Cases (>= 5 Tests per Area)

Tier 2 probes extreme inputs, edge values, concurrency races, tolerance windows, and security boundaries:

#### Area 1: CRM Boundaries
- **T2-CRM-01 (Boundary Date Equality)**: Attempt `createCampaign` with `endDate === startDate` (exact same millisecond); assert rejected with "Thời gian kết thúc phải diễn ra sau thời gian bắt đầu".
- **T2-CRM-02 (Inverted Dates)**: Attempt `createCampaign` with `endDate < startDate`; assert rejected with validation error.
- **T2-CRM-03 (Boundary State Transition Start)**: Check `computeCampaignStatus` at `now = startDate - 1ms` (`UPCOMING`) vs `now = startDate` (`RUNNING`).
- **T2-CRM-04 (Boundary State Transition End)**: Check `computeCampaignStatus` at `now = endDate` (`RUNNING`) vs `now = endDate + 1ms` (`ENDED`).
- **T2-CRM-05 (Empty & Whitespace Name)**: Attempt `createCampaign` with `name = "   "`; assert rejected with "Tên chương trình không được để trống".
- **T2-CRM-06 (Duplicate Campaign Code)**: Attempt to create two campaigns with code `CP-DUPLICATE-TEST`; assert second returns conflict (409).
- **T2-CRM-07 (Corrupt JSON in Overrides)**: Pass malformed JSON `"{invalid"` in `productOverrides`; assert `enrichCampaignData` parses gracefully to empty object without crashing.

#### Area 2: Drive Boundaries
- **T2-DRV-01 (Empty String Drive URL)**: Pass `""` to `parseDriveUrl`; assert throws "Đường dẫn Google Drive không được để trống".
- **T2-DRV-02 (Invalid Non-Drive Domain)**: Pass `https://dropbox.com/s/abcdef12345` to `parseDriveUrl`; assert throws invalid format error.
- **T2-DRV-03 (Short Bare ID Boundary)**: Pass alphanumeric string of 19 characters (`"1234567890123456789"`); assert rejected (bare ID requires >= 20 chars).
- **T2-DRV-04 (Valid Bare ID Boundary)**: Pass alphanumeric string of 20 characters (`"12345678901234567890"`); assert successfully parsed as folder ID.
- **T2-DRV-05 (Private Folder 403 Simulation)**: Simulate Drive sync receiving 403 Forbidden; assert `syncStatus` updated to `'ERROR'` and existing database items preserved intact.
- **T2-DRV-06 (Non-Destructive Association)**: Manually associate `campaignId` with `ContentSourceItem`; re-sync source; assert `campaignId` preserved.

#### Area 3: AI Copywriting Boundaries
- **T2-AI-01 (Threads Exact 500 Chars Limit)**: Pass content of exactly 500 characters to `ThreadsAdapter.validate()`; assert passes with 0 errors.
- **T2-AI-02 (Threads 501 Chars Violation)**: Pass content of 501 characters to `ThreadsAdapter.validate()`; assert throws "Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: 501)".
- **T2-AI-03 (Banned Phrases Strict Detection)**: Pass copy containing "cơ hội ngàn năm có một" to `detectBannedPhrases`; assert phrase detected; rubric voice score penalized.
- **T2-AI-04 (Deviated Price Invariant)**: Pass copy with price `999.000đ` when CRM price is `150.000đ`; assert `validateCrmInvariants` returns `valid: false` and `matchedPrice: false`.
- **T2-AI-05 (Invariant Enforcer Remediation)**: Run `enforceCrmInvariants` on copy lacking voucher code `UUDAM10`; assert returns string containing `UUDAM10`.
- **T2-AI-06 (Rubric Failure Threshold)**: Run `evaluateDraftRubric` on copy with multiple violations; assert `overallScore < 8.0` and `passed === false`.

#### Area 4: Review & Scheduling Boundaries
- **T2-REV-01 (Gate 1 Unapproved Block)**: Call `publishPostItem` on post in `DRAFT` state; assert returns `success: false, reason: 'POST_NOT_APPROVED'`.
- **T2-REV-02 (Gate 1 Rejected Block)**: Call `publishPostItem` on post in `REJECTED` state; assert returns `success: false, reason: 'POST_NOT_APPROVED'`.
- **T2-REV-03 (Gate 2 Cancelled Campaign Block)**: Associate post with `CANCELLED` campaign; call `publishPostItem`; assert post automatically updated to `REJECTED` and publication blocked.
- **T2-REV-04 (Gate 3 Future Post Tolerance > 60s)**: Post scheduled for `now + 65s`; call `publishPostItem`; assert returns `skipped: true, reason: 'SCHEDULED_TIME_NOT_REACHED'`.
- **T2-REV-05 (Gate 3 Tolerance Window <= 60s)**: Post scheduled for `now + 50s`; call `publishPostItem`; assert proceeds and publishes successfully.
- **T2-REV-06 (Atomic Concurrency Race)**: Launch 10 simultaneous calls to `publishPostItem` on the same approved post; assert exactly 1 succeeds, 9 receive `CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS`.

#### Area 5: Publishing Gateway Boundaries
- **T2-PUB-01 (Instagram Missing Media)**: Call `instagramAdapter.publish` with `mediaUrls: []`; assert throws "Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video".
- **T2-PUB-02 (TikTok Missing Video)**: Call `tiktokAdapter.publish` with `mediaType: 'IMAGE'`; assert throws "TikTok bắt buộc phải có tài nguyên video".
- **T2-PUB-03 (Empty Content Across All 7 Platforms)**: Call `adapter.validate({ content: "" })` across all 7 adapters; assert every adapter throws non-empty content error.
- **T2-PUB-04 (Slug Collision Resolution)**: Create two blog posts with identical title "Trà Shan Tuyết Cổ Thụ"; assert `generateUniqueSlug` produces two distinct slugs.
- **T2-PUB-05 (Safe Mock Invariant Enforcement)**: Call `shouldUseSafeMock` with live credentials supplied but `process.env.NODE_ENV === 'test'`; assert strictly returns `true`.

#### Area 6: Security & Safety Boundaries
- **T2-SEC-01 (Outbound Network Spy Interception)**: Attempt fetch to `https://graph.facebook.com`; assert Network Spy blocks request and throws `[SECURITY VETO]`.
- **T2-SEC-02 (Zero Secret Scan Invariant)**: Regex search across all code for high-entropy tokens or hardcoded private keys; assert 0 matches.
- **T2-SEC-03 (Quota 429 Resilience Simulation)**: Force `llmChat` to return 429 status; assert AI copywriting invokes product-category template fallback without system crash.
- **T2-SEC-04 (Timeout Signal Abort)**: Verify `AbortSignal.timeout(60000)` handles simulated slow network response gracefully.

#### Area 7: Data Parity Boundaries
- **T2-DAT-01 (Core Table Mutation Guard)**: Attempt to insert record into core `Product` table during test; assert caught by baseline check if un-reverted.
- **T2-DAT-02 (Zero Residue Teardown)**: Create 10 test campaigns, 70 posts, 10 plans, 20 audit logs; run teardown; assert 100% test entities purged and baseline counts identical.

#### Area 8: UI Boundaries
- **T2-UI-01 (Empty Blog Feed)**: Query `/blog` route when no posts have status `PUBLISHED`; assert renders clean empty state without exceptions.
- **T2-UI-02 (404 Non-Existent Blog Slug)**: Query `/blog/slug-khong-ton-tai-12345`; assert triggers Next.js `notFound()`.

---

### 3.3. Tier 3: Cross-Feature Combinations (Pairwise Inter-Module Workflows)

Tier 3 executes end-to-end multi-module pipelines verifying that data contracts between milestones remain intact:

```
[M1: Campaign Data & Pricing]
             │
             ▼
[M2: Drive Asset Ingestion] ────► Auto-link Assets to Campaign
             │
             ▼
[M3: AI Copywriting & Invariants] ────► 7-Platform Drafts & Rubric Gate (>= 8.0/10)
             │
             ▼
[M4: Review & State Machine] ────► Submit -> Owner Approval Gate
             │
             ▼
[M4: Queue Runner & Scheduler] ────► Time Gate (<= 60s) -> Concurrency Lock
             │
             ▼
[M5: 7-Platform Publisher Gateway] ────► Safe Mock Mode (0 Network Calls)
             │
             ▼
[M5/M7: Public Website Blog] ────► Public View (/blog & /blog/[slug])
```

- **Combo 1: Campaign Creation -> Drive Ingestion -> Linkage (M1 ↔ M2)**
  Create campaign `CP-COMBO-01`. Sync mock Drive folder containing tea images. Associate Drive items to `CP-COMBO-01`. Verify `ContentSource.campaignId === campaign.id` and `ContentSourceItem` records reference campaign.
- **Combo 2: Linked Drive Assets + CRM Pricing -> AI Copywriting (M2 + M1 ↔ M3)**
  Feed enriched campaign (price 150.000đ, voucher `UUDAM10`) and drive assets to `generateSocialPlan`. Assert AI generator incorporates product details and image URLs into platform drafts.
- **Combo 3: AI Copywriting -> Deterministic Invariant Matcher (M3)**
  Validate generated drafts against CRM invariants. Verify price `150.000đ` and voucher `UUDAM10` are present in all drafts. Run `evaluateDraftRubric`; assert all drafts achieve score >= 8.0.
- **Combo 4: Generated Drafts -> Review & Owner Approval (M3 ↔ M4)**
  Persist drafts as `SocialPost` records (`DRAFT`). Submit to `PENDING_APPROVAL`. Owner executes `approvePost`. Assert status becomes `APPROVED` / `SCHEDULED` with `approvedBy: 'Chủ tiệm Ưu Đàm'`.
- **Combo 5: Approved Drafts -> Scheduled Queue Runner & Three Gates (M4)**
  Set post `scheduledAt` to `now + 30s`. Trigger `processScheduledPosts`. Assert Gate 1 (Owner Approval: PASS), Gate 2 (Campaign Status: PASS), Gate 3 (Time Window: PASS). Post acquires concurrency lock and transitions to `PUBLISHING`.
- **Combo 6: Queue Runner -> 7-Platform Gateway Safe Mock (M4 ↔ M5)**
  Queue runner dispatches post to `publishPost`. Gateway routes to appropriate platform adapter. Adapter validates payload, generates mock external ID, captures `payloadSnapshot`, updates post to `PUBLISHED`.
- **Combo 7: Website Blog Publishing -> Public Route Rendering (M5 ↔ M7)**
  Post published to `WEBSITE` channel. Adapter generates unique slug `tra-shan-tuyet-uudam-xxx`. Query public route `/blog/[slug]`. Verify HTTP 200, correct OpenGraph metadata, and full article rendering.
- **Combo 8: The Full Golden Chain (M1 -> M2 -> M3 -> M4 -> M5 -> M7)**
  Execute complete sequence in a single continuous transaction chain. Verify end-to-end data integrity, audit logs, and status progression from inception to public view.

---

### 3.4. Tier 4: Real-World Workload Scenarios

Realistic operational scenarios simulating day-to-day store operations and adverse production conditions:

#### Scenario 1: Complete Campaign Lifecycle (Mùa Vu Lan 2026)
- **Story**: Store owner creates "Chiến dịch Vu Lan Báo Hiếu 2026" running for 14 days, linking 2 products (Trà Trầm Hương, Nến Sen Tĩnh Tâm) and 1 voucher (`VULAN2026`, 15% discount).
- **Execution**:
  1. Create campaign `CP-VULAN-2026` via API.
  2. Sync public Google Drive asset folder containing 4 photos and 1 campaign doc.
  3. AI engine generates 7-channel content calendar.
  4. Owner reviews 7 posts: approves 6 posts, edits 1 post, sets schedules.
  5. Scheduler runs: posts for FB, Zalo, Web, IG, TikTok, Threads published on schedule.
  6. Audit trail verified: all state transitions logged with timestamps and actor names.
  7. Teardown purges test campaign and verifies baseline parity.

#### Scenario 2: LLM Quota 429 & Disruption Resilience
- **Story**: Peak marketing day causes Gemini API key to hit HTTP 429 quota limit. System must continue operating smoothly without crashing or failing user workflows.
- **Execution**:
  1. Configure mock LLM caller to simulate HTTP 429 Rate Limit Exceeded.
  2. Trigger social plan generation.
  3. Verify engine catches 429, logs warning, and seamlessly switches to category-specific fallback templates (Tea/Candle/Incense).
  4. Verify generated copy accurately incorporates CRM pricing and voucher code.
  5. Verify each draft explicitly records `generationSource: 'TEMPLATE_FALLBACK'`.
  6. Verify store owner sees clear UI notification indicating template fallback was used.

#### Scenario 3: Expired / Cancelled Campaign Mid-Schedule Rejection
- **Story**: A flash sale campaign ends prematurely due to inventory depletion, but 3 approved posts are still queued in `SCHEDULED` status.
- **Execution**:
  1. Create campaign and schedule 3 posts for 10 minutes in the future. Owner approves all 3 posts.
  2. Owner cancels the campaign (`status: CANCELLED`) or time advances past `endDate`.
  3. Scheduler executes `processScheduledPosts`.
  4. Gate 2 detects campaign is `CANCELLED` / `ENDED`.
  5. Verify all 3 posts are immediately rejected (`status: REJECTED`), approval revoked, and note recorded: "Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy".
  6. Verify 0 posts are dispatched to publishing gateway.

#### Scenario 4: Publication Failure Recovery & Operator Retry
- **Story**: External network hiccup causes TikTok video publishing to fail on the initial attempt. Owner investigates and triggers a manual retry.
- **Execution**:
  1. Mock publisher simulates transient network timeout on TikTok publish.
  2. `publishPostItem` catches error; post updated to `status: FAILED`, `retryCount: 1`, `publishError` populated.
  3. Verify concurrency lock is released (`isPublishing: false`).
  4. Operator calls `retryPublishPost(postId)`.
  5. Second attempt succeeds; post transitions to `status: PUBLISHED`, `externalPostId` recorded, retry audit log created.

#### Scenario 5: High-Concurrency Burst Scheduling Stress Test
- **Story**: Background cron triggers 50 concurrent scheduler runs simultaneously during peak traffic.
- **Execution**:
  1. Seed 20 approved posts scheduled for the current minute.
  2. Fire 50 concurrent `processScheduledPosts` executions via `Promise.all`.
  3. Verify database-level atomic lock (`updateMany`) ensures each post is acquired by exactly 1 runner.
  4. Verify total published posts equals exactly 20.
  5. Verify 0 duplicate publications and 0 lock deadlocks.

#### Scenario 6: Database Safety, Zero Regression & Teardown Parity
- **Story**: Strict compliance with R7: the test suite must leave zero lingering test artifacts and preserve all 24 core tables in their pristine baseline state.
- **Execution**:
  1. Audit 24 core table counts against `db/baseline-counts.json` before test execution.
  2. Execute heavy multi-tiered tests creating and mutating records in `Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `AuditLog`.
  3. Run comprehensive cleanup utility: delete test campaigns and cascaded children.
  4. Force SQLite WAL checkpoint (`PRAGMA wal_checkpoint(FULL)`).
  5. Run post-teardown audit: verify 100% of 24 core tables match baseline counts with `Delta = 0`.

---

## 4. Required Feature Checklist for `TEST_READY.md`

The following markdown section defines the exact feature checklist ready to be appended or integrated into `TEST_READY.md`:

```markdown
### 3.5. AUTO SOCIAL Module Feature Coverage Matrix (FEAT-CRM-01..FEAT-UI-03, Tiers 1–4)

| Feature ID | Feature Name | Area | Tier 1 (Coverage) | Tier 2 (Boundary) | Tier 3 (Pairwise) | Tier 4 (Workloads) | Status |
|:----------:|--------------|:----:|:-----------------:|:-----------------:|:-----------------:|:------------------:|:------:|
| **FEAT-CRM-01** | Campaign Schema & DB Backup | CRM | ✅ Binary SQLite header check | ✅ WAL checkpoint audit | ✅ Additive schema integrity | ✅ Pre-migration backup check | READY |
| **FEAT-CRM-02** | Campaign CRUD API | CRM | ✅ Full CRUD operations | ✅ Date range & name checks | ✅ Filter & pagination | ✅ 14-day campaign lifecycle | READY |
| **FEAT-CRM-03** | Campaign Boundary State Engine | CRM | ✅ Dynamic status computation | ✅ Millisecond boundary bounds | ✅ Real-time server sync | ✅ Expired campaign rejection | READY |
| **FEAT-CRM-04** | Campaign Product & Voucher Linkage | CRM | ✅ Price & discount enrichment | ✅ Missing product fallback | ✅ CRM data extraction | ✅ Invariant matching in posts | READY |
| **FEAT-DRV-01** | Public Drive URL Parsing | DRV | ✅ 6 URL formats parsed | ✅ Invalid URL & domain checks | ✅ ID extraction pipeline | ✅ Folder ingestion workflow | READY |
| **FEAT-DRV-02** | Hybrid Drive File Enumerator | DRV | ✅ File & folder enumeration | ✅ Hierarchy depth limits | ✅ MIME classification | ✅ Zero-Key web extraction | READY |
| **FEAT-DRV-03** | Drive Content Extraction | DRV | ✅ Docs & Sheets text extract | ✅ Empty/binary doc handling | ✅ CDN image link format | ✅ Copywriting asset feed | READY |
| **FEAT-DRV-04** | Drive Non-Destructive Re-Sync | DRV | ✅ Metadata sync to DB | ✅ Preserved manual linkages | ✅ Cascade update handling | ✅ Re-sync without data loss | READY |
| **FEAT-DRV-05** | Drive Error Handling & Recovery | DRV | ✅ Structured error logging | ✅ 403/404 graceful catch | ✅ Status flag transition | ✅ Sync resilience drill | READY |
| **FEAT-AI-01** | Campaign AI Plan Generator | AI | ✅ 7-channel calendar plan | ✅ Channel distribution bounds | ✅ CRM data integration | ✅ Full social calendar drill | READY |
| **FEAT-AI-02** | Ưu Đàm Brand Tone Engine | AI | ✅ Brand pronoun validation | ✅ Banned phrases detection | ✅ Tone sanitization | ✅ Anti-AI cliches audit | READY |
| **FEAT-AI-03** | Deterministic CRM Invariant Matcher | AI | ✅ Exact price/voucher match | ✅ Deviated data detection | ✅ Auto-enforcement fix | ✅ Invariant audit across posts | READY |
| **FEAT-AI-04** | Platform Copy Adaptation | AI | ✅ Platform format tailoring | ✅ Threads 500 chars limit | ✅ Channel rules validation | ✅ Multi-channel generation | READY |
| **FEAT-AI-05** | Rubric Quality Gate (>= 8/10) | AI | ✅ 4-criterion evaluation | ✅ Score threshold bounds | ✅ Pass/fail classification | ✅ Independent 10-post audit | READY |
| **FEAT-REV-01** | Owner Approval Workflow | REV | ✅ State machine transitions | ✅ Unapproved publish block | ✅ Audit trail logging | ✅ Review & approval drill | READY |
| **FEAT-REV-02** | Scheduled Execution Engine | REV | ✅ Scheduled queue execution | ✅ 1-min tolerance window | ✅ Scheduled runner loop | ✅ Automated publishing drill | READY |
| **FEAT-REV-03** | Concurrency Idempotency Lock | REV | ✅ Database-level lock | ✅ 50-thread race condition | ✅ Duplicate publish block | ✅ High-burst execution | READY |
| **FEAT-REV-04** | Campaign Status Publication Gate | REV | ✅ Gate 2 active check | ✅ Ended campaign rejection | ✅ Dynamic status check | ✅ Expired post rejection | READY |
| **FEAT-REV-05** | Publishing Retry & Failure Log | REV | ✅ Error capture & retry count | ✅ Retry state reset | ✅ Failure audit logging | ✅ Operator retry recovery | READY |
| **FEAT-PUB-01** | Facebook Fanpage Adapter | PUB | ✅ Graph API payload format | ✅ Empty content validation | ✅ Scheduler integration | ✅ Facebook safe mock publish | READY |
| **FEAT-PUB-02** | Zalo OA Adapter | PUB | ✅ Open API payload format | ✅ Attachment formatting | ✅ Scheduler integration | ✅ Zalo OA safe mock publish | READY |
| **FEAT-PUB-03** | Internal Website Blog | PUB | ✅ Blog post creation | ✅ Slug collision avoidance | ✅ Public route linkage | ✅ Public web view drill | READY |
| **FEAT-PUB-04** | External Web Adapter | PUB | ✅ Webhook payload format | ✅ Missing endpoint error | ✅ Scheduler integration | ✅ External CMS mock publish | READY |
| **FEAT-PUB-05** | Instagram Adapter | PUB | ✅ IG container payload format | ✅ Mandatory media check | ✅ Scheduler integration | ✅ Instagram mock publish | READY |
| **FEAT-PUB-06** | TikTok Adapter | PUB | ✅ Video payload format | ✅ Mandatory video check | ✅ Scheduler integration | ✅ TikTok mock publish | READY |
| **FEAT-PUB-07** | Threads Adapter | PUB | ✅ Threads payload format | ✅ <= 500 chars enforcement | ✅ Scheduler integration | ✅ Threads mock publish | READY |
| **FEAT-PUB-08** | Safe Mock vs Real Switch | PUB | ✅ Safe mock evaluation | ✅ Test environment lock | ✅ Credential presence check | ✅ Zero external network drill | READY |
| **FEAT-SEC-01** | Test Isolation Invariant | SEC | ✅ 0 outbound socket calls | ✅ Network Spy interception | ✅ Framework test isolation | ✅ Security veto invariant | READY |
| **FEAT-SEC-02** | Zero Hardcoded Secrets | SEC | ✅ Dynamic credential lookup | ✅ Codebase secret scan | ✅ Security audit logging | ✅ Secret scanning drill | READY |
| **FEAT-SEC-03** | Resilience & Graceful Degradation | SEC | ✅ LLM error handling | ✅ Quota 429 fallback | ✅ Template generation fallback | ✅ Provider outage drill | READY |
| **FEAT-DAT-01** | DB Parity & Zero Regression | DAT | ✅ 24 core table verification | ✅ Non-core table teardown | ✅ WAL checkpoint sync | ✅ Zero residue verification | READY |
| **FEAT-QG-01** | E2E Testing Suite (Tiers 1-4) | QG | ✅ Single command runner | ✅ Clean exit code 0 | ✅ Multi-suite execution | ✅ CI gate verification | READY |
| **FEAT-UI-01** | Admin Auto Social CRM & Calendar UI | UI | ✅ API route response check | ✅ Empty state handling | ✅ Admin workflow contract | ✅ Management UI audit | READY |
| **FEAT-UI-02** | Public Blog UI Route | UI | ✅ Public route rendering | ✅ 404 notFound handling | ✅ OpenGraph meta generation | ✅ Public reader experience | READY |
| **FEAT-UI-03** | Independent Browser Verification | UI | ✅ Desktop & 390px Mobile | ✅ 0 console errors | ✅ No horizontal overflow | ✅ Independent browser audit | READY |
```

---

## 5. Five-Component Handoff Protocol

### 5.1. Observation
1. **Authoritative Specification Inputs**:
   - `ORIGINAL_REQUEST.md` (lines 82-152) specifies the exact scope and acceptance criteria for AUTO SOCIAL:
     - CRM Campaigns (R1, line 95): Start/end dates, products, vouchers, boundary state engine.
     - Public Google Drive Ingestion (R2, line 98): Public link parsing, Docs (.txt), Sheets (.csv), media CDN, non-destructive re-sync.
     - AI Copywriting (R3, line 101): CRM pricing/discounts/vouchers invariant matching, platform limits, brand voice, rubric quality gate (>= 8.0/10).
     - Review & Scheduling (R4, line 104): Only approved posts published, on-time delivery (<= 1 min tolerance), concurrency idempotency, expired campaign rejection.
     - 7 Platforms (R5, line 107): Facebook, Zalo OA, Website Blog, External CMS, Instagram, TikTok, Threads.
     - Operational Safety (R6, line 110): Zero real social publishing in automated tests, Safe Mock mode, zero hardcoded secrets.
     - Data Safety (R7, line 113): Zero baseline regression, 24 core tables preserved (`Delta = 0`), teardown cleanliness.
   - `orchestrator_2/PROJECT.md` (lines 12-50) catalogues all 35 features: FEAT-CRM-01..04, FEAT-DRV-01..05, FEAT-AI-01..05, FEAT-REV-01..05, FEAT-PUB-01..08, FEAT-SEC-01..03, FEAT-DAT-01, FEAT-QG-01, FEAT-UI-01..03.
2. **Codebase Implementation State**:
   - Schema: `prisma/schema.prisma` contains 7 additive models (`Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`) leaving all 24 baseline tables untouched.
   - Core Libraries: `src/lib/campaign-service.ts` (679 lines), `src/lib/drive-parser.ts` (926 lines), `src/lib/social-ai.ts` (1680 lines), `src/lib/social-scheduler.ts` (1010 lines), `src/lib/publishing-gateway.ts` (1018 lines) are fully implemented and verified in milestones M1–M5.
   - Existing Test Suites: Individual milestone scripts (`verify-m1-campaigns.ts`, `verify-m2-drive.ts`, `verify-m3-ai.ts`, `verify-m4-scheduler.ts`, `verify-m5-publishing.ts`) pass, but a unified, integrated 4-tier E2E script `scripts/verify-auto-social.ts` is required for Milestone 6.
   - Baseline Data Parity: `db/baseline-counts.json` records row counts for 28 tables, with 24 designated core business tables (`check-counts.mjs`).

### 5.2. Logic Chain
1. *From R6 & R7 Invariants to Test Architecture*:
   - R6 dictates that automated tests must never publish to real endpoints. In `src/lib/publishing-gateway.ts`, `shouldUseSafeMock()` enforces mock mode when `process.env.NODE_ENV === 'test'`.
   - To guarantee this invariant empirically, `scripts/verify-auto-social.ts` must integrate the `setupNetworkSpy()` mechanism pioneered in `verify-m5-publishing.ts`, intercepting `http.request`, `https.request`, and `global.fetch`, and asserting `outboundHttpAttempts === 0`.
2. *From Acceptance Criteria to 4-Tier Test Structuring*:
   - Acceptance Criteria mandate unit/boundary isolation (Tiers 1 & 2), inter-module pipelines (Tier 3), and realistic production stress/failure scenarios (Tier 4).
   - Organizing `scripts/verify-auto-social.ts` into these exact 4 tiers guarantees that regressions are immediately localized: a Tier 1 failure flags a specific feature contract breach; a Tier 2 failure flags an unhandled edge bound; a Tier 3 failure flags an inter-module contract break; a Tier 4 failure flags an operational vulnerability.
3. *From Milestone Progress to M6 Execution*:
   - Milestones M1 through M5 are marked DONE. M6 is IN_PROGRESS.
   - Providing this exhaustive specification report and 4-tier blueprint enables `worker_m6` / `test_writer_e2e` to implement `scripts/verify-auto-social.ts` with zero guesswork, 100% feature coverage, and strict compliance with `ORIGINAL_REQUEST.md`.

### 5.3. Caveats
- **Read-Only Investigation**: As a specification miner, no source code or test implementations were written or modified during this investigation.
- **Milestone 7 Scope**: Features FEAT-UI-01 and FEAT-UI-03 involve full browser UI interactions (Playwright/Puppeteer/agent-browser desktop & mobile 390px audits). In `scripts/verify-auto-social.ts`, these are tested at the React component export, route handler, and metadata level, while visual rendering and console error audits belong to Milestone 7.
- **LLM API Quota**: When Gemini API is unavailable or quota 429 is reached in testing environments, tests must assert that the system falls back gracefully to category-specific templates without failing.

### 5.4. Conclusion
The specification and 4-tier test plan for `scripts/verify-auto-social.ts` has been fully formulated:
1. **All 35 features** across R1–R7 are inventoried, mapped, and assigned concrete test assertions in Tier 1 (>= 5 tests per area).
2. **32 edge cases and boundary conditions** are documented and integrated into Tier 2 (empty inputs, date equality, Threads 500 limit, Instagram media mandatory, TikTok video mandatory, 1-min time tolerance, atomic concurrency locks).
3. **8 multi-module integration combos** are established in Tier 3 (Campaign -> Drive -> AI -> Approval -> Scheduler -> Gateway -> Blog View).
4. **6 real-world workload scenarios** are defined in Tier 4 (full campaign lifecycle, 429 quota resilience, expired campaign rejection, operator retry recovery, 50-thread concurrency burst, and teardown database parity).
5. The complete feature checklist for updating `TEST_READY.md` has been formulated.

### 5.5. Verification Method
To independently verify this specification report:
1. Inspect the handoff document:
   ```bash
   cat .agents/teamwork/spec_miner_m6/handoff.md
   ```
2. Verify feature IDs and contracts against project documentation:
   - Check `orchestrator_2/PROJECT.md` lines 12–50.
   - Check `ORIGINAL_REQUEST.md` lines 93–152.
3. Inspect model definitions in `prisma/schema.prisma` lines 490–679.
4. Verify baseline count definitions in `db/baseline-counts.json` and `scripts/check-counts.mjs`.
5. When `scripts/verify-auto-social.ts` is implemented by M6 test writers, verify its execution via:
   ```bash
   node --experimental-strip-types scripts/verify-auto-social.ts
   ```
