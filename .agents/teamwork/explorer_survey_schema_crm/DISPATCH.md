## 2026-10-26T13:10:00Z
From: 3f0d510d-9880-49f5-b710-8d6bfe356311
Content:
You are an Explorer subagent for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite.

## Working Directory
`y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_survey_schema_crm`
Create your working directory and maintain your `progress.md` and `analysis.md` there.

## Mandatory Inputs to Read
1. `y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md` (Read in full, especially section `## 2026-10-26T13:06:22Z`)
2. `prisma/schema.prisma`
3. Existing schema migrations and database setup (`prisma/migrations`, `db/custom.db`, seed files if any)
4. Existing CRM models, product models, voucher models, promotions, and related APIs under `src/app/api/` or `app/api/`
5. `AGENTS.md` regarding Next.js 16 breaking changes

## Objective
Analyze the current database schema, ORM setup, existing CRM features, and determine:
1. Current models for Products, Vouchers, Promotions, Orders, Customers.
2. How to design the new entities for AUTO SOCIAL (Campaign, ContentSource, SocialPlan, SocialPost, SocialChannelConfig, AuditLog) while ensuring 100% backward compatibility with zero regressions.
3. Safe DB migration strategy: how SQLite is used, location of `db/custom.db`, backup requirements before applying migrations.
4. Any existing data types, Enums, relations, and conventions.

## Deliverables
Write your comprehensive technical analysis to `analysis.md` and summarize your findings in `handoff.md` in your working directory.
Send a completion message back to the orchestrator with the link to your handoff report.
Do NOT modify any codebase files or run migrations yourself. Exploration only.
