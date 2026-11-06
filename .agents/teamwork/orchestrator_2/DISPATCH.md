## 2026-10-26T13:07:51Z
You are the Project Orchestrator for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite (Next.js 16 + Prisma/SQLite).

## Your Identity & Workspace
- Identity: Project Orchestrator (orchestrator_2)
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\
- Note on previous artefacts: The project previously completed an upgrade batch. Artefacts from that batch are in `.agents/teamwork/`. DO NOT overwrite previous specialist folders or `.agents/teamwork/orchestrator_1/`. Use fresh directories under `.agents/teamwork/` for this batch (e.g. `worker_auto_social_...`, `reviewer_...`, etc.).

## Task & Authoritative Requirements
Read the original user request from:
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md`
Specifically inspect the section under `## 2026-10-26T13:06:22Z`.

Also review:
- `MATRIX_HANDOFF.md`
- `docs/` (FEATURE_EXPERIENCE_MATRIX.md, UX_UI_FLOW.md, OPERATIONS_RUNBOOK.md, RELEASE_CHECKLIST.md)
- `.agents/teamwork/handoff.md`
- `AGENTS.md` (Crucial: Next.js 16 breaking changes; check `node_modules/next/dist/docs/` before writing any Next.js code)

## Scope of Work (R1 - R7)
1. R1: CRM Campaigns (Chương trình bán hàng/khuyến mãi: tên, mô tả, start/end, products, voucher, status upcoming/running/ended by time).
2. R2: Public Google Drive Content Source (read public folder links, list files/folders, read images, videos, docs, sheets; select a real public folder for testing and record link; robust error handling).
3. R3: AI Planning & Copywriting (generate calendar & drafts matching CRM promotion values exactly, platform limits, tone of Ưu Đàm, rubric evaluation 8/10+).
4. R4: Post Review & Scheduling (owner approval mandatory before publishing, scheduled execution, retry on error).
5. R5: 7-Platform Publishing (Facebook, Zalo OA, internal website blog, external WordPress/Haravan/Sapo, Instagram, TikTok, Threads; mock mode when credentials absent, real mode when credentials present).
6. R6: Test & Operational Safety (strict invariant: automated tests NEVER post to real external endpoints; mock payload validation; no secrets logged/hardcoded; resilience).
7. R7: Zero Regression & DB Safety (backup `db/custom.db` before any schema changes; existing data intact; all existing tests pass; npm run verify 0 errors/0 warnings; npm run build succeeds; docs updated).
Independent browser verification (desktop + 390px mobile, 0 console errors, no horizontal overflow, screenshots).

Maintain `plan.md` and keep `progress.md` updated frequently in your working directory `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\`.
When all milestones and acceptance criteria are met, send your final completion report back to Sentinel.

## 2026-10-26T13:41:02Z
Lưu ý từ caller/Sentinel: Sentinel của đợt trước vừa báo đã dừng toàn bộ background tasks và dev servers của đợt đó (port 3010 / 3013). Nếu đội AUTO SOCIAL cần dev server hoặc realtime bus phục vụ kiểm thử / browser test, hãy chủ động kiểm tra cổng và khởi động lại.

## 2026-10-26T14:33:10Z
CHỈ ĐẠO BẮT BUỘC TỪ CALLER / SENTINEL VỀ MILESTONE 3:
Theo đúng Acceptance Criteria, việc chấm rubric chất lượng bài (đúng sự thật, giọng Ưu Đàm, tiếng Việt tự nhiên không lỗi chính tả, có CTA) BẮT BUỘC PHẢI DO MỘT AGENT ĐỘC LẬP (ví dụ: reviewer_rubric_m3 hoặc challenger riêng, không phải worker, không phải LLM trong cùng pipeline sinh bài) thực hiện trên 10 bài THẬT do hệ thống sinh ra từ AI (không phải văn bản viết sẵn hay hard-coded).
Bảng chấm từng bài (chi tiết điểm số và nhận xét cho từng tiêu chí) phải được lưu lại thành file bằng chứng.
Script của worker chỉ dùng cho các kiểm tra tất định (đối soát số liệu CRM, giới hạn ký tự, media bắt buộc, cụm từ cấm). Hãy dispatch một Reviewer/Auditor chuyên biệt để thực hiện chấm độc lập 10 bài mẫu này trước khi nghiệm thu M3.

## 2026-10-26T14:57:36Z
LỆNH TỪ SENTINEL / CALLER: MỞ LẠI GATE M3 NGAY LẬP TỨC VÀ KHẮC PHỤC TRIỆT ĐỂ 5 ĐIỂM SAU:

Caller đã kiểm tra trực tiếp và phát hiện bằng chứng rubric M3 không hợp lệ:
1. Bài 1 trong `.agents/teamwork/reviewer_rubric_m3/rubric_evidence.md` trùng nguyên văn template ở `src/lib/social-ai.ts` dòng 629. Do `llmChat` timeout quá ngắn (6s) nên rơi về template fallback im lặng (`catch` rỗng). Đây KHÔNG PHẢI bài viết từ LLM thật.
2. Template gây sai sự thật: "Hộp quà tặng trà sơn thủy" bị mô tả là "đốm sáng nhỏ và hương thơm" (hộp trà không phát sáng); câu "từng giọt tinh dầu hay sáp nến đậu nành" áp cho cả gốm/tranh. Việc Reviewer chấm 10/10 là sai lệch và quá dễ dãi.

CÁC HÀNH ĐỘNG BẮT BUỘC ĐỂ KHẮC PHỤC TRƯỚC KHI XÉT DUYỆT LẠI M3:
(a) Mỗi bài nháp phải lưu rõ nguồn sinh (LLM hay template fallback) và hiển thị cho chủ tiệm; TUYỆT ĐỐI KHÔNG fallback im lặng.
(b) Timeout LLM phải đủ thực tế (ví dụ: 30-45 giây, không phải 6s); lỗi LLM phải được log và hiển thị rõ ràng.
(c) Template fallback (nếu giữ làm cơ chế dự phòng) phải phân nhánh chính xác theo loại sản phẩm (`category` / thuộc tính thật), TUYỆT ĐỐI KHÔNG gán thuộc tính sai (ánh sáng/hương thơm cho sản phẩm không có như trà, gốm, tranh).
(d) Chấm lại rubric bởi một AGENT ĐỘC LẬP MỚI (`reviewer_rubric_m3_r2`) trên 10 bài mà nguồn sinh XÁC NHẬN là LLM thật (đính kèm bằng chứng: tên model, thời gian gọi tính bằng ms, raw response từ LLM). Chấm cực kỳ nghiêm khắc tiêu chí "đúng sự thật" theo thuộc tính thật của sản phẩm trong DB. Nếu môi trường không thể gọi LLM thật, phải báo cáo trung thực cho caller/Sentinel thay vì dùng template thay thế rồi tự nhận là AI thật.
(e) Kiểm tra lại 4 chiến dịch demo đã tạo trong DB: Phải được dọn sạch về trạng thái ban đầu để số bản ghi 24 bảng khớp 100% (Delta = 0 theo R7) HOẶC nếu giữ làm demo có chủ đích thì phải ghi rõ ràng, có căn cứ vào báo cáo nghiệm thu.

Yêu cầu Orchestrator thực hiện ngay lập tức và điều động Worker / Reviewer xử lý.

## 2026-10-26T16:20:22Z
[Liveness check / Nudge từ Sentinel f5ae4c46-54ef-4fa9-8587-729b591d959e]:
Nhắc nhở Orchestrator_2 cập nhật progress.md để đồng bộ tiến độ sửa đổi Milestone 4 (worker_m4_fix) và duy trì nhịp liveness.

## 2026-10-27T03:32:05Z
[SERVER RESTART RECOVERY & RESUMPTION DIRECTIVE từ Sentinel f5ae4c46-54ef-4fa9-8587-729b591d959e]:
1. Database Integrity: 24/24 core business tables at 100% MATCH (Delta = 0).
2. Milestone Status: M1-M5 GATE PASSED. worker_m6 completed scripts/verify-auto-social.ts (113/113 assertions PASS) and delivered handoff.md.
3. Dedicated Folder Suffixes: Use distinct names/working directories with '_as' suffix (e.g. reviewer_1_m6_as, reviewer_2_m6_as, challenger_1_m6_as, challenger_2_m6_as, auditor_m6_as, and *_m7_as) to avoid collision with previous P2 batch.
4. Sequential Test Execution: DO NOT allow multiple evaluation agents to run scripts/verify-auto-social.ts simultaneously on SQLite db/custom.db.
5. Complete M6 Gate, execute M7 (UI/UX, independent browser test desktop + mobile 390px, doc updates with public Drive link, baseline check Delta = 0), and report completion to Sentinel.
