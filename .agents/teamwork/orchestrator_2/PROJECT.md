# Project: AUTO SOCIAL Module Addition for OPENVN · Ưu Đàm Suite

## Architecture
- **Stack**: Next.js 16.1.1 (App Router), Prisma 6.11.1, SQLite (`db/custom.db`), Tailwind CSS, Radix UI.
- **Data Layer**: Non-destructive additive extension to SQLite via Prisma. 7 new models: `Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`. Zero modifications to existing 24/28 baseline tables.
- **Drive Ingestion Layer**: Hybrid 2-tier parser (`src/lib/drive-parser.ts`): Google Drive API v3 (when key available) + Zero-Key Web Extraction via `window['_DRIVE_ivd']` hex decoding for public folders. Support for Docs, Sheets, images, videos, recursive subfolders up to 3 levels.
- **AI Copywriting & Planning Engine**: `src/lib/social-ai.ts` utilizing `src/lib/llm.ts` with brand voice rules from `src/lib/agent-voice.ts` (anti-AI cliches `BANNED_PHRASES`, Ưu Đàm calming/mindful tone, deterministic CRM invariant matcher for prices, discounts, and vouchers; rubric evaluation scoring >= 8/10).
- **Review & Scheduling Engine**: `src/lib/social-scheduler.ts` with state machine (`DRAFT` -> `PENDING_APPROVAL` -> `APPROVED` -> `SCHEDULED` -> `PUBLISHING` -> `PUBLISHED` / `FAILED`), concurrency idempotency lock, scheduled execution within <= 1 min tolerance, and Three Iron Publishing Gates (Owner Approval, Campaign Status, Scheduled Time).
- **7-Platform Publishing Gateway**: Unified `IPublisherAdapter` in `src/lib/publishing-gateway.ts` supporting Facebook, Zalo OA, Website Blog (`/blog/[slug]`), External CMS (WP/Haravan/Sapo), Instagram, TikTok, Threads. Dual-mode switching: Safe Mock Mode (0 external calls, schema validation) vs Real Mode (when credentials configured).
- **Operational Safety Invariant**: Automated test runner strictly sets `process.env.NODE_ENV === 'test'` and `ALLOW_REAL_SOCIAL_PUBLISHING = 'false'` guaranteeing zero real outbound HTTP requests to social networks.

## Feature Inventory
| # | Feature ID | Name | Description | Milestone | Source |
|---|------------|------|-------------|-----------|--------|
| 1 | FEAT-CRM-01 | Campaign Schema & DB Backup | Safe WAL checkpoint, backup `custom.db.bak.pre-autosocial`, create `Campaign` model with zero baseline regression | M1 | R1, R7 |
| 2 | FEAT-CRM-02 | Campaign CRUD API | REST endpoints for campaign create, read, update, delete with validation (`endDate > startDate`) | M1 | R1 |
| 3 | FEAT-CRM-03 | Campaign Boundary State Engine | Dynamic real-time computation of `UPCOMING`, `RUNNING`, `ENDED`, `CANCELLED` based on server time boundaries | M1 | R1 |
| 4 | FEAT-CRM-04 | Campaign Product & Voucher Linkage | Associate existing products and vouchers from CRM to campaign with pricing and discount calculations | M1 | R1 |
| 5 | FEAT-DRV-01 | Public Drive URL Parsing | Extract folder ID from various Google Drive public share link formats, handling errors gracefully | M2 | R2 |
| 6 | FEAT-DRV-02 | Hybrid Drive File Enumerator | API v3 + Zero-Key `window['_DRIVE_ivd']` crawler listing files, MIME types, and subfolder hierarchy | M2 | R2 |
| 7 | FEAT-DRV-03 | Drive Content Extraction | Extract text from Google Docs (`/export?format=txt`), Google Sheets (`/export?format=csv`), images/videos CDN URLs | M2 | R2 |
| 8 | FEAT-DRV-04 | Drive Non-Destructive Re-Sync | Re-sync folder metadata while preserving manual product/campaign associations and foreign keys | M2 | R2 |
| 9 | FEAT-DRV-05 | Drive Error Handling & Recovery | Graceful handling and structured error messages for private, 404, or malformed Drive links | M2 | R2 |
| 10 | FEAT-AI-01 | Campaign AI Plan Generator | Generate structured social calendar across 7 platforms matching campaign dates and target products | M3 | R3 |
| 11 | FEAT-AI-02 | Ưu Đàm Brand Tone Engine | System prompt enforcing serene, mindful, premium brand voice, banning AI cliches (`BANNED_PHRASES`) | M3 | R3 |
| 12 | FEAT-AI-03 | Deterministic CRM Invariant Matcher | Code-level verification that generated copy strictly matches CRM prices, discounts, and voucher codes | M3 | R3 |
| 13 | FEAT-AI-04 | Platform Copy Adaptation | Tailor copy to character limits and conventions (Threads <= 500 chars, IG hashtags, TikTok hooks) | M3 | R3 |
| 14 | FEAT-AI-05 | Rubric Quality Gate (>= 8/10) | 4-criterion automated rubric evaluation with pass threshold >= 8.0/10 | M3 | R3 |
| 15 | FEAT-REV-01 | Owner Approval Workflow | State machine ensuring posts cannot be published without explicit owner approval (`APPROVED` state) | M4 | R4 |
| 16 | FEAT-REV-02 | Scheduled Execution Engine | Background runner executing scheduled posts within <= 1 min of target time | M4 | R4 |
| 17 | FEAT-REV-03 | Concurrency Idempotency Lock | Database-level lock (`isPublishing`) preventing duplicate publishing on concurrent triggers | M4 | R4 |
| 18 | FEAT-REV-04 | Campaign Status Publication Gate | Block publication of posts associated with `ENDED` or `CANCELLED` campaigns | M4 | R4 |
| 19 | FEAT-REV-05 | Publishing Retry & Failure Log | Structured error logging and manual retry mechanism for failed publications | M4 | R4 |
| 20 | FEAT-PUB-01 | Facebook Fanpage Adapter | Publisher adapter for Facebook page feed with media and link attachment | M5 | R5 |
| 21 | FEAT-PUB-02 | Zalo OA Adapter | Publisher adapter for Zalo Official Account Open API article / message broadcast | M5 | R5 |
| 22 | FEAT-PUB-03 | Internal Website Blog | Integrated blog publishing with public view routes `/blog` and `/blog/[slug]` | M5 | R5 |
| 23 | FEAT-PUB-04 | External Web Adapter | Webhook / REST adapter for external CMS (WordPress, Haravan, Sapo) | M5 | R5 |
| 24 | FEAT-PUB-05 | Instagram Adapter | Publisher adapter for Instagram with mandatory media asset validation | M5 | R5 |
| 25 | FEAT-PUB-06 | TikTok Adapter | Publisher adapter for TikTok with mandatory video asset validation | M5 | R5 |
| 26 | FEAT-PUB-07 | Threads Adapter | Publisher adapter for Threads with strict <= 500 character limit enforcement | M5 | R5 |
| 27 | FEAT-PUB-08 | Safe Mock vs Real Switch | Automatic switching between validated safe mock responses and real API calls based on credentials | M5 | R5, R6 |
| 28 | FEAT-SEC-01 | Test Isolation Invariant | Absolute prevention of real external network calls during automated testing | M6 | R6 |
| 29 | FEAT-SEC-02 | Zero Hardcoded Secrets | All credentials securely read from `IntegrationCredential` or environment variables | M6 | R6 |
| 30 | FEAT-SEC-03 | Resilience & Graceful Degradation | Fallback handling for Gemini Quota 429 and network timeouts | M6 | R6 |
| 31 | FEAT-DAT-01 | DB Parity & Zero Regression | Baseline count preservation for all 24 core tables in `db/baseline-counts.json` | M6 | R7 |
| 32 | FEAT-QG-01 | E2E Testing Suite (Tiers 1-4) | Comprehensive test suite (`scripts/verify-auto-social.ts`) covering all 35 features and 20 edge cases | M6 | R6, R7 |
| 33 | FEAT-UI-01 | Admin Auto Social CRM & Calendar UI | Responsive management views for campaigns, content sources, calendar, and post approvals | M7 | R7 |
| 34 | FEAT-UI-02 | Public Blog UI Route | Public responsive view for website blog posts at `/blog/[slug]` | M7 | R5, R7 |
| 35 | FEAT-UI-03 | Independent Browser Verification | Cross-device testing (Desktop + 390px Mobile), 0 console errors, no horizontal overflow | M7 | R7 |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | CRM Campaigns & DB Safety | FEAT-CRM-01, FEAT-CRM-02, FEAT-CRM-03, FEAT-CRM-04 | none | DONE |
| M2 | Google Drive Content Source | FEAT-DRV-01, FEAT-DRV-02, FEAT-DRV-03, FEAT-DRV-04, FEAT-DRV-05 | M1 | DONE |
| M3 | AI Planning & Copywriting | FEAT-AI-01, FEAT-AI-02, FEAT-AI-03, FEAT-AI-04, FEAT-AI-05 | M1 | DONE |
| M4 | Review & Scheduling Engine | FEAT-REV-01, FEAT-REV-02, FEAT-REV-03, FEAT-REV-04, FEAT-REV-05 | M1, M3 | DONE |
| M5 | 7-Platform Publishing Gateway | FEAT-PUB-01, FEAT-PUB-02, FEAT-PUB-03, FEAT-PUB-04, FEAT-PUB-05, FEAT-PUB-06, FEAT-PUB-07, FEAT-PUB-08 | M4 | DONE |
| M6 | Test & Operational Safety (E2E Track) | FEAT-SEC-01, FEAT-SEC-02, FEAT-SEC-03, FEAT-DAT-01, FEAT-QG-01 | M2, M3, M5 | DONE |
| M7 | UI/UX & Release Verification | FEAT-UI-01, FEAT-UI-02, FEAT-UI-03 | M5, M6 | DONE |

## Interface Contracts

### M1 ↔ M3 (Campaign ↔ AI Copywriter)
```typescript
interface CampaignData {
  id: string;
  code: string;
  title: string;
  description: string;
  startDate: string; // ISO
  endDate: string;   // ISO
  status: 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED';
  products: Array<{ id: string; name: string; price: number; discountPercent?: number }>;
  vouchers: Array<{ id: string; code: string; discountPercent?: number; discountAmount?: number; minOrderValue?: number }>;
}
```

### M2 ↔ M3 (Drive Items ↔ AI Context)
```typescript
interface DriveAssetContext {
  id: string;
  name: string;
  mimeType: string;
  viewUrl: string;
  thumbnailUrl?: string;
  textContent?: string; // Extracted from Docs (.txt) or Sheets (.csv)
  folderPath: string;
}
```

### M4 ↔ M5 (Post State Machine ↔ Publisher Gateway)
```typescript
interface PublishRequest {
  postId: string;
  platform: 'FACEBOOK' | 'ZALO_OA' | 'WEBSITE' | 'EXTERNAL_CMS' | 'INSTAGRAM' | 'TIKTOK' | 'THREADS';
  content: string;
  title?: string;
  mediaUrls: string[];
  scheduledAt: string; // ISO
  isMock: boolean;
}

interface PublishResult {
  success: boolean;
  externalPostId?: string;
  publishedUrl?: string;
  publishedAt: string;
  error?: string;
  isMockResult: boolean;
}
```

## Code Layout
- `prisma/schema.prisma`: Additive models `Campaign`, `ContentSource`, `ContentSourceItem`, `SocialPlan`, `SocialPost`, `SocialChannelConfig`, `AuditLog`.
- `src/lib/campaign-service.ts`: Campaign CRUD, boundary state evaluation, product & voucher linkage.
- `src/lib/drive-parser.ts`: Public Google Drive URL parser, recursive file enumerator, Docs/Sheets content extractor.
- `src/lib/social-ai.ts`: AI calendar generator, platform-specific copywriter, deterministic CRM invariant matcher, rubric evaluator.
- `src/lib/social-scheduler.ts`: Review & approval lifecycle, idempotency execution lock, scheduling queue.
- `src/lib/publishing-gateway.ts`: 7-platform publisher adapters (`FacebookAdapter`, `ZaloAdapter`, `WebsiteBlogAdapter`, `ExternalCmsAdapter`, `InstagramAdapter`, `TikTokAdapter`, `ThreadsAdapter`).
- `src/app/api/campaigns/`: Campaign API route handlers (Next.js 16 async params compliant).
- `src/app/api/social/`: Auto social endpoints (drive sync, plan generation, post approval, publishing trigger).
- `src/app/blog/`: Public website blog feed and post detail page (`/blog/[slug]`).
- `src/components/cms/views/campaigns-view.tsx` & `auto-social-view.tsx`: Admin CRM and Auto Social dashboards.
- `scripts/verify-auto-social.ts`: Full E2E & adversarial regression verification suite.
