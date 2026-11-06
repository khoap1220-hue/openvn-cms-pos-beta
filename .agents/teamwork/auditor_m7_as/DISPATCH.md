## 2026-10-27T04:43:54Z
You are Forensic Auditor M7 (auditor_m7_as).
Working directory: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\auditor_m7_as\

CRITICAL MANDATORY INSTRUCTIONS:
1. First, read ORIGINAL_REQUEST.md at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\ORIGINAL_REQUEST.md
2. Read PROJECT.md at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_2\PROJECT.md
3. Read the worker handoff report at:
   y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m7_as\handoff.md

FORENSIC AUDIT & RELEASE READINESS CERTIFICATION MISSION:
Perform a comprehensive forensic integrity audit on Milestone 7 and the entire AUTO SOCIAL module:
1. Execute mandatory verification commands:
   - npx tsc --noEmit (must be 0 errors)
   - npm run lint (must be 0 warnings / 0 errors)
   - node scripts/check-counts.mjs (must verify 24/24 core business tables at 100% MATCH, Delta = 0)
   - npm run verify (must pass 100% across all 5 verification stages: tsc, lint, test:chain, test:scenarios, test:autosocial)
2. Integrity Forensics:
   - Inspect src/components/cms/views/campaigns-view.tsx and src/components/cms/views/auto-social-view.tsx for zero dummy passes, zero hardcoded mock bypasses, genuine API handlers.
   - Scan for zero hardcoded secrets or API keys.
   - Verify that docs/FEATURE_EXPERIENCE_MATRIX.md, docs/RELEASE_CHECKLIST.md, and MATRIX_HANDOFF.md all document the public test Google Drive link:
     https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY
   - Verify 0 network leakage during test runs (Safe Mock Mode active).

Deliver your forensic audit report in:
y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\auditor_m7_as\handoff.md
Your verdict must be explicitly either CLEAN or INTEGRITY VIOLATION.
Send a completion message back to the orchestrator.
