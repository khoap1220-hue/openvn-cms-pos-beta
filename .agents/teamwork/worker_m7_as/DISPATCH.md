## 2026-10-27T04:27:06Z
You are Worker M7 (worker_m7_as).
Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_as\

CRITICAL MANDATORY INSTRUCTIONS:
1. First, read ORIGINAL_REQUEST.md at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\ORIGINAL_REQUEST.md
2. Read PROJECT.md at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md
3. Read the master exploration handoff from explorer_m7_as at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_m7_as\handoff.md

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

EXCLUSIVE WRITE OWNERSHIP:
You exclusively own and modify:
- src/components/cms/views/campaigns-view.tsx (create new)
- src/components/cms/views/auto-social-view.tsx (create new)
- src/components/cms/app-sidebar.tsx (wire nav items in NAV_CRM)
- src/app/page.tsx (wire activeView in VIEW_LABELS and main view router)
- docs/FEATURE_EXPERIENCE_MATRIX.md (update Auto Social features STT 20-26, record public Drive URL)
- docs/RELEASE_CHECKLIST.md (complete release sign-off for Auto Social)
- MATRIX_HANDOFF.md (document /blog, /blog/[slug], /api/campaigns, /api/social/*, test runner, public Drive URL)

PUBLIC TEST GOOGLE DRIVE LINK:
https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY

MISSION & ASSIGNED TASKS:
1. Create `src/components/cms/views/campaigns-view.tsx`:
   - 'use client'
   - Full CRM Campaign management: list campaigns, filter by status (UPCOMING, RUNNING, ENDED, CANCELLED), search, stats cards (Total, Running, Upcoming, Ended), create/edit campaign modal with date validation (endDate > startDate), link products (/api/products) and vouchers (/api/vouchers).
   - Fast action button to navigate or trigger Auto Social AI generation.
   - Fully responsive design with overflow-x-auto on table, stack cards on mobile 390px.
2. Create `src/components/cms/views/auto-social-view.tsx`:
   - 'use client'
   - 4-Tab comprehensive view:
     - Tab 1: Drive Sources: Connect public Google Drive folder (prefill default public link: https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY), sync button calling POST /api/social/drive, display synced items, file tree, Docs/Sheets previews.
     - Tab 2: AI Planning: Select campaign & drive source, select target platforms (7 platforms), configure post count, tone requirements, generate plan button calling POST /api/social/ai-plan, show generated draft calendar with CRM invariant badges.
     - Tab 3: Calendar & Review: List posts, filter by channel & status (DRAFT, PENDING_APPROVAL, APPROVED, SCHEDULED, PUBLISHED, REJECTED, FAILED), post detail modal/card, Owner actions: Approve (APPROVE), Reject (REJECT with reason), Reschedule (RESCHEDULE), Publish Now (PUBLISH), Retry (RETRY).
     - Tab 4: 7-Platform Publishing Gateway: Gateway status for all 7 platforms (Facebook, Zalo OA, Website Blog /blog, External CMS, Instagram, TikTok, Threads), Safe Mock indicator, trigger schedule queue runner button calling POST /api/social/schedule.
   - Fully responsive on desktop 1440px and mobile 390px without horizontal overflow.
3. Wire navigation in `src/components/cms/app-sidebar.tsx`:
   - Add 'campaigns' and 'auto-social' to ViewId.
   - Add entries in NAV_CRM with icons Megaphone and Share2 (from lucide-react).
4. Wire router in `src/app/page.tsx`:
   - Add 'campaigns' and 'auto-social' in VIEW_LABELS.
   - Import CampaignsView and AutoSocialView, render conditionally in `<main>` when activeView matches.
5. Update documentation:
   - `docs/FEATURE_EXPERIENCE_MATRIX.md`: Add STT 20-26 covering all Auto Social capabilities with public Drive URL, mark 100% operational.
   - `docs/RELEASE_CHECKLIST.md`: Complete release checklist for Auto Social module.
   - `MATRIX_HANDOFF.md`: Update access endpoints, API catalog (2.10 & 2.11), operational test instructions (`npm run test:autosocial`), and record the public Drive link.

MANDATORY VERIFICATION CHECKS:
You MUST run the following commands:
1. `npx tsc --noEmit` (must be 0 errors)
2. `npm run lint` (must be 0 warnings / 0 errors)
3. `node scripts/check-counts.mjs` (must match 24/24 core tables, Delta = 0)
4. Verify HTTP 200 on `/blog` and `/api/campaigns`
