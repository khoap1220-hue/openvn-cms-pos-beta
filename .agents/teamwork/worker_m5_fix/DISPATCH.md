## 2026-10-26T17:08:03Z

You are Worker M5 Fix (`worker_m5_fix`) for Milestone 5 of the AUTO SOCIAL module in OPENVN · Ưu Đàm Suite.

## Mission
Remediate the 4 issues identified by Reviewer 1 (`reviewer_1_m5`) in `src/lib/publishing-gateway.ts`, `src/app/api/social/schedule/route.ts`, and `src/middleware.ts`.

## Reviewer 1 Defect Report
Read the full report from Reviewer 1 at:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_1_m5\handoff.md`

Summary of defects:
1. `npx tsc --noEmit` / `npm run build` failed with `TS2345: Property 'postId' is missing in type ... but required in type 'PublishRequest'`. In `src/lib/publishing-gateway.ts`, `interface PublishRequest` has `postId: string`, but adapters treat `postId` as optional (`if (request.postId)`).
2. In `src/app/api/social/schedule/route.ts`, `publishing-gateway` is not imported. Without it, background cron calls to `/api/social/schedule` fall back to `defaultMockPublisher`, bypassing the 7-platform gateway!
3. `src/middleware.ts` lacks `'/blog'` in `PUBLIC_PREFIXES`. If `CMS_REQUIRE_AUTH=true`, public blog visitors are redirected to `/login`.
4. Boundary validation in `InstagramAdapter` and `TikTokAdapter`: empty string elements like `['']` bypass `.length === 0`.

## Mandatory Fix Instructions
1. **Fix `src/lib/publishing-gateway.ts`**:
   - In `interface PublishRequest`: change `postId: string` to `postId?: string`.
   - In `InstagramAdapter`: filter valid media URLs before checking count:
     ```typescript
     const validMedia = (request.mediaUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
     if (validMedia.length === 0) {
       throw new Error('Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video')
     }
     ```
   - In `TikTokAdapter`:
     ```typescript
     const validMedia = (request.mediaUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
     if (request.mediaType !== 'VIDEO' || validMedia.length === 0) {
       throw new Error('TikTok bắt buộc phải có tài nguyên video')
     }
     ```
2. **Fix `src/app/api/social/schedule/route.ts`**:
   - Add `import '@/lib/publishing-gateway'` at the top so that `setPublisher(publishPost)` is executed whenever the schedule route is loaded.
3. **Fix `src/middleware.ts`**:
   - Add `'/blog'` to `PUBLIC_PREFIXES` array.
4. **Fix `scripts/stress-m5-platforms.ts`**:
   - Ensure all calls adhere to `PublishRequest` and test passes cleanly.
5. **Run Verification Commands**:
   - `npx tsx scripts/verify-m5-publishing.ts`
   - `npx tsx scripts/stress-m5-platforms.ts`
   - `npx tsx scripts/verify-challenger-2-m5.ts`
   - `node scripts/check-counts.mjs` (confirm 100% MATCH, Delta = 0 across 24 core tables).
   - `npx tsc --noEmit` (MUST be 0 errors).
   - `npm run lint` (MUST be 0 errors).
   - `npm run build` (MUST build cleanly).

Working Directory: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5_fix\`
When complete, write your handoff report to `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m5_fix\handoff.md` and send a message.
