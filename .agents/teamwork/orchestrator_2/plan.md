# Execution Plan: AUTO SOCIAL Module for OPENVN · Ưu Đàm Suite

## Overview
Implement the AUTO SOCIAL module across requirements R1–R7 on top of Next.js 16 + Prisma/SQLite, integrating seamlessly with existing CRM, inventory, promotions, and brand aesthetics of Ưu Đàm.

## Phased Plan

### Phase 0: Survey & Requirements Mining
- Dispatch 3 Explorers / Spec Miners:
  - `explorer_survey_schema_crm`: Inspect current Prisma schema, DB structure, existing CRM promotions/campaigns/products/vouchers logic.
  - `explorer_survey_drive_ai`: Inspect external integration patterns, AI service/provider architecture (GEMINI_API_KEY, mock fallback), Google Drive API integration possibilities.
  - `spec_miner_auto_social`: Inspect `ORIGINAL_REQUEST.md` (specifically `## 2026-10-26T13:06:22Z`), `MATRIX_HANDOFF.md`, `docs/`, `AGENTS.md` (Next.js 16 breaking changes), and map all explicit and implicit requirements.
- Merge survey results into root `PROJECT.md` with full Feature Inventory and interface contracts.

### Phase 1: Milestone 1 - CRM Campaigns (R1, R7)
- Safe backup of `db/custom.db`.
- Prisma schema updates for Campaign & AutoSocial entities (Campaign, ContentSource, SocialPlan, SocialPost, SocialChannelConfig, AuditLog).
- Migration execution & validation without destroying existing data.
- API endpoints & Service layer for CRM Campaigns (CRUD, voucher/product linking, status computation).

### Phase 2: Milestone 2 - Public Google Drive Content Source (R2)
- Parser for public Google Drive folder links (folder ID extraction, handling standard and shortcut URLs).
- Ingestion engine: list files/folders recursively/paginated, inspect metadata, download/cache images, videos, docs, sheets.
- Fallback & error handling for invalid/restricted/empty folders. Real public folder verified & recorded for testing.

### Phase 3: Milestone 3 - AI Planning & Copywriting Engine (R3)
- AI Plan Generator: create social calendar, post distribution, theme planning matching CRM promotion dates & discounts.
- AI Copywriter: platform-specific drafts (Facebook, Zalo, Web, WP/Sapo/Haravan, Instagram, TikTok, Threads) respecting character limits, hashtags, and tone of Ưu Đàm (trầm mặc, thanh tịnh, chữa lành, tâm linh, trung cao cấp).
- Rubric evaluator: automated scoring (0-10) checking discount consistency, product accuracy, brand voice (gate: >= 8/10).

### Phase 4: Milestone 4 - Post Review & Scheduling Engine (R4)
- Owner approval workflow (DRAFT -> PENDING_APPROVAL -> APPROVED -> SCHEDULED -> PUBLISHING -> PUBLISHED / FAILED).
- Scheduling & queue runner (idempotent, retry on transient failure, status history).

### Phase 5: Milestone 5 - 7-Platform Publishing Gateway (R5, R6)
- Unified adapter architecture for 7 platforms:
  1. Facebook (Graph API / Page Feed)
  2. Zalo Official Account (Zalo OA Open API)
  3. Internal Website Blog (Ưu Đàm local CMS / blog post table)
  4. External WordPress / Haravan / Sapo (REST API / Webhook)
  5. Instagram (Graph API / Reels/Photo)
  6. TikTok (Content Posting API / Webhook)
  7. Threads (Threads API)
- Dual mode: Mock mode when credentials absent (validating payload schemas, simulated responses, zero external calls) and Real mode when credentials configured.
- Operational safety invariant: Automated test suite strictly runs in mock mode; external calls strictly guarded.

### Phase 6: Milestone 6 - E2E Testing Track & Operational Safety (R6, R7)
- Tier 1: Feature coverage (>=5 test cases per feature).
- Tier 2: Boundary & corner cases (empty folders, expired tokens, network timeouts, special characters, max length).
- Tier 3: Pairwise cross-feature combinations (Drive file -> AI copy -> Campaign voucher -> Multi-platform schedule).
- Tier 4: Real-world application scenarios (full campaign launch flow).
- Tier 5: Adversarial coverage hardening.

### Phase 7: Milestone 7 - UI/UX Verification & Release Audit (R7)
- UI page `/admin/auto-social` and subpages with responsive design (desktop + 390px mobile).
- Browser verification: 0 console errors, no horizontal overflow, responsive layout snapshots.
- Run `npm run verify` and `npm run build` with 0 errors / 0 warnings.
- Documentation update in `docs/` and `MATRIX_HANDOFF.md`.
- Forensic integrity audit & final sign-off.
