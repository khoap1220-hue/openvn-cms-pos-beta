## 2026-10-26T14:41:49Z
You are the Independent Rubric Reviewer for Milestone 3 (M3: AI Planning & Copywriting Engine) of the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## MANDATORY DIRECTIVE FROM CALLER / SENTINEL
As instructed by the Sentinel: The rubric evaluation of post quality (Truth / CRM accuracy, Ưu Đàm brand voice, Natural Vietnamese without typos, Quality CTA) MUST BE PERFORMED BY AN INDEPENDENT AGENT (YOU, not the worker, not the generation LLM).
You must evaluate 10 REAL social media posts generated from the system's AI pipeline across various products/campaigns (NOT hardcoded text, NOT pre-written templates).
The detailed score table and commentary for each post must be recorded as an evidence file: `.agents/teamwork/reviewer_rubric_m3/rubric_evidence.md`.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\reviewer_rubric_m3`
Create your working directory and maintain your `progress.md`, `rubric_evidence.md`, and `handoff.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md`
3. `src/lib/social-ai.ts` and `src/lib/agent-voice.ts`
4. Worker M3 handoff: `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m3_ai\handoff.md`

## Review & Rubric Evaluation Tasks
1. Execute a generation script to produce 10 REAL posts using the live `social-ai.ts` engine across different campaigns (e.g. Vu Lan, Phật Đản, Trăng Rằm), platforms (Facebook, Zalo OA, Website Blog, Instagram, TikTok, Threads, External CMS), and products (Nến thơm, Vòng trầm, Đèn sen...).
2. Independently evaluate each of the 10 posts against the 4 core criteria on a scale of 0 to 10:
   - **Tiêu chí 1: Tính chân thực & Khớp số liệu CRM (Weight 30%)**: Giá, % giảm, mã voucher khớp 100% dữ liệu chiến dịch.
   - **Tiêu chí 2: Giọng điệu Ưu Đàm (Weight 30%)**: Trầm mặc, thanh tịnh, chữa lành, định vị trung - cao cấp; TUYỆT ĐỐI KHÔNG chứa cụm từ AI sáo rỗng (`BANNED_PHRASES`).
   - **Tiêu chí 3: Tiếng Việt tự nhiên & Ngữ pháp (Weight 20%)**: Không lỗi chính tả, câu từ trôi chảy, đúng quy chuẩn xưng hô ("tụi em", "Ưu Đàm").
   - **Tiêu chí 4: Lời kêu gọi hành động (CTA) & Phù hợp nền tảng (Weight 20%)**: Phù hợp định dạng nền tảng (Threads <= 500 chars, TikTok hook script, IG hashtags), CTA nhẹ nhàng, thanh tao.
3. Write the complete evaluation evidence table with full post content, sub-scores, total score, and specific reviewer remarks for every post into `rubric_evidence.md`.
4. Check if all 10 posts achieve a score of $\ge 8.0/10$.
5. Run `npx tsx scripts/verify-m3-ai.ts` and verify 24 baseline tables maintain Delta = 0.
6. Provide verdict: APPROVE (if all 10 posts pass $\ge 8.0/10$ and all criteria met) or REQUEST_CHANGES. Send completion message back to orchestrator.
