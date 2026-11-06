# BRIEFING — 2026-10-26T13:10:00Z

## Mission
Extract, document, and formalize all authoritative requirements, interfaces, state machines, validation rules, error behaviors, edge cases, and acceptance criteria for the AUTO SOCIAL module addition to OPENVN · Ưu Đàm Suite (R1-R7).

## 🔒 My Identity
- Archetype: Specification Miner
- Roles: Specification Mining, Requirements Analysis, Interface Contract Definition
- Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\spec_miner_requirements
- Original parent: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Milestone: Auto Social Module Requirements Specification (R1-R7)

## 🔒 Key Constraints
- Read-only probe: Do NOT implement code changes or alter production/suite files.
- Probe authoritative specifications in ORIGINAL_REQUEST.md, MATRIX_HANDOFF.md, docs/*, existing codebase, and AGENTS.md.
- Detail R1 through R7 thoroughly (fields, schemas, state transitions, error modes, test tiers, mock vs real behaviors).
- Deliverables: spec_analysis.md and handoff.md in working directory.

## Current Parent
- Conversation ID: 3f0d510d-9880-49f5-b710-8d6bfe356311
- Updated: 2026-10-26T13:18:45Z

## Task Summary
- **What to build**: Specification analysis document `spec_analysis.md` and handoff report `handoff.md`.
- **Success criteria**: Complete coverage of R1-R7 with acceptance criteria, schema definitions, boundary conditions, error responses, platform constraints, and comprehensive Feature Inventory table.
- **Interface contracts**: Fully defined in `spec_analysis.md` (22 API endpoints, 4 new Prisma models).
- **Code layout**: Working directory `.agents/teamwork/spec_miner_requirements/`.

## Key Decisions Made
- Mining covered both the high-level user requirements from `ORIGINAL_REQUEST.md` (2026-10-26T13:06:22Z update) and the existing architecture established in previous milestones (M1-M7 in MATRIX_HANDOFF.md, existing Prisma schema, existing APIs, routes, UI components).
- Formulated non-destructive Prisma schema extension (4 new models: `SocialCampaign`, `DriveSource`, `DriveItem`, `SocialPost`) guaranteeing zero breakage of 28 core tables in `db/baseline-counts.json`.
- Defined multi-tier Google Drive reader (Drive API v3 + Embedded Web Reader + Direct Export) requiring no mandatory Google Cloud OAuth from shop owner.
- Established strict 100% Anti-AI brand voice rules based on `src/lib/agent-voice.ts` with anti-hallucination deterministic CRM invariant matching.
- Established the Three Iron Publishing Gates (Owner Approval Gate, Campaign Status Gate, Scheduled Time Gate) with database-level idempotency lock.
- Formalized Safe Mock isolation architecture guaranteeing zero real outbound social HTTP calls during test runs.

## Artifact Index
- `spec_analysis.md` — Detailed requirements, API contracts, Prisma models, Feature Inventory (35 items), and Adversarial Matrix (20 items).
- `handoff.md` — 5-component hard handoff report for orchestrator and downstream subagents.
- `progress.md` — Liveness heartbeat and step tracking.
- `DISPATCH.md` — Original dispatch assignment log.
