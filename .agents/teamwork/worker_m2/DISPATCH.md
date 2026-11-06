## 2026-10-26T08:00:15Z
[Message] timestamp=2026-10-26T08:00:15Z sender=7124d145-f8bf-4670-a0d0-13114c2b24e3 priority=MESSAGE_PRIORITY_HIGH content=You are worker_m2, the System Hardening & Defect Fixer for OPENVN · Ưu Đàm Suite.
Your working directory is: y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\worker_m2
Your parent conversation ID is: 7124d145-f8bf-4670-a0d0-13114c2b24e3

MANDATORY FIRST STEPS:
Read these files:
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\ORIGINAL_REQUEST.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\orchestrator_1\PROJECT.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\.agents\teamwork\explorer_survey_1\handoff.md
- y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\TEST_READY.md

FILE OWNERSHIP:
You exclusively own and may edit:
- src/app/api/orders/[id]/route.ts
- src/app/api/shipments/[id]/route.ts
- src/app/api/customers/route.ts
- src/app/api/system/backup/route.ts
Do NOT touch other files in src/ or prisma/ unless strictly necessary.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

YOUR MISSION (Milestone M2 - System Hardening & Defect Rectification - R1):
1. Wrap Order Cancellation in db.$transaction in src/app/api/orders/[id]/route.ts:
   - Ensure order status update, stock increment, StockMovement creation, and combo stock synchronization (syncComboStock) execute atomically within db.$transaction.
   - Guard against invalid status transitions (e.g. cannot cancel already cancelled or completed orders).
2. Wrap Shipment RETURNED in db.$transaction in src/app/api/shipments/[id]/route.ts:
   - Ensure shipment status update, order status cancellation/update, item stock restoration, and StockMovement records execute atomically within db.$transaction.
3. Customer Phone Duplicate Guard in src/app/api/customers/route.ts:
   - In POST method, if phone is provided (non-empty string), check if another customer already has this phone.
   - If duplicate phone is found, reject with HTTP 400 (or 409) and JSON: { error: "Số điện thoại này đã được đăng ký cho khách hàng khác" }.
   - Allow customer creation when phone is empty (walk-in guest).
4. Turbopack Dynamic Tracing in src/app/api/system/backup/route.ts:
   - Resolve dynamic filesystem access warning clean for Turbopack while preserving backup download functionality.
5. Verification & Testing:
   - Run `node --experimental-strip-types scripts/verify-r1-regressions.ts` -> All R1 scenarios MUST PASS.
   - Run `npx tsc --noEmit` -> 0 errors.
   - Run `npm run lint` -> 0 errors, 0 warnings.
   - Run `npm run test:chain` -> Monotonic stock ledger MUST PASS 100%.
   - Run `npm run test:scenarios` -> 21/21 scenarios MUST PASS.
6. Documentation in handoff.md:
   - Provide structured defect report: file:line, error mechanism, fix implemented, regression test name for each bug.
7. Send message to parent (7124d145-f8bf-4670-a0d0-13114c2b24e3) with summary and handoff path.
