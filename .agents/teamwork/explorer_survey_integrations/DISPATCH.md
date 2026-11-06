## 2026-10-26T13:10:00Z
You are an Explorer subagent for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_survey_integrations`
Create your working directory and maintain your `progress.md` and `analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `.env`, `.env.example`, configuration files
3. Existing AI/LLM integration code (Gemini API, Google GenAI SDK, fallback logic)
4. Existing external API integrations (WordPress, social media, webhooks)
5. Existing background jobs, scheduling, cron, or queue systems in the project
6. `AGENTS.md` and `package.json`

## Objective
Analyze the current technical capabilities and architecture for external integrations:
1. Google Drive API integration: how public Google Drive folder links can be parsed without requiring expensive/restricted OAuth for public links (or via Google Drive API v3 public key / web scraping / public export links), handling files (images, video, docs, sheets). Find a valid public Google Drive test folder if possible.
2. AI generation: how the app calls Gemini or other LLMs, prompt structure, tone guidelines for Ưu Đàm (trầm mặc, thanh tịnh, chữa lành, tâm linh, định vị trung cao cấp), rubric scoring mechanism (8/10+ threshold).
3. 7-Platform Publishing Gateway: analyze integration architecture for Facebook, Zalo OA, Website Blog, WordPress/Haravan/Sapo, Instagram, TikTok, Threads. Design mock vs real mode architecture.
4. Operational Safety Invariant: how to guarantee automated tests NEVER hit real external endpoints.

## Deliverables
Write your comprehensive technical analysis to `analysis.md` and summarize your findings in `handoff.md` in your working directory.
Send a completion message back to the orchestrator with the link to your handoff report.
Do NOT modify any codebase files. Exploration only.
