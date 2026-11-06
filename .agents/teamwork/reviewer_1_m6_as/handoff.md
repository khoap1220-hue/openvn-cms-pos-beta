# HANDOFF REPORT — Reviewer & Adversarial Critic (Milestone 6: E2E Testing Track & Operational Safety)

**Reviewer Agent**: `reviewer_1_m6_as`  
**Date**: 2026-10-27  
**Target Milestone**: Milestone 6: E2E Testing Track & Operational Safety (R6, R7)  
**Parent Orchestrator Conversation ID**: `3f0d510d-9880-49f5-b710-8d6bfe356311`  
**Verdict**: **REQUEST_CHANGES**

---

## 1. Observation

### 1.1. Test Execution Commands & Verbatim Results

1. **Database Baseline Parity Audit (`node scripts/check-counts.mjs`)**:
   ```text
   === OPENVN · ƯU ĐÀM SUITE — DATABASE BASELINE AUDIT ===
   Checking 24 Core Business Tables vs db/baseline-counts.json:

   ✅ [MATCH] Product                  actual=12 baseline=12
   ✅ [MATCH] Category                 actual=3 baseline=3
   ✅ [MATCH] Order                    actual=173 baseline=173
   ✅ [MATCH] OrderItem                actual=226 baseline=226
   ✅ [MATCH] Customer                 actual=34 baseline=34
   ✅ [MATCH] SalesInvoice             actual=10 baseline=10
   ✅ [MATCH] PurchaseInvoice          actual=4 baseline=4
   ✅ [MATCH] StockMovement            actual=246 baseline=246
   ✅ [MATCH] Warehouse                actual=4 baseline=4
   ✅ [MATCH] WarehouseStock           actual=22 baseline=22
   ✅ [MATCH] Voucher                  actual=4 baseline=4
   ✅ [MATCH] BomComponent             actual=5 baseline=5
   ✅ [MATCH] AccountingPeriod         actual=5 baseline=5
   ✅ [MATCH] Partner                  actual=1 baseline=1
   ✅ [MATCH] Channel                  actual=10 baseline=10
   ✅ [MATCH] ChannelListing           actual=110 baseline=110
   ✅ [MATCH] Shipment                 actual=85 baseline=85
   ✅ [MATCH] AfterSalesCase           actual=2 baseline=2
   ✅ [MATCH] AppSetting               actual=16 baseline=16
   ✅ [MATCH] IntegrationCredential    actual=14 baseline=14
   ✅ [MATCH] ApiKey                   actual=1 baseline=1
   ✅ [MATCH] WebhookEndpoint          actual=2 baseline=2
   ✅ [MATCH] AutomationSetting        actual=6 baseline=6
   ✅ [MATCH] OrderEvent               actual=392 baseline=392

   Core Business Tables Checked : 24 / 24
   Core Parity Status           : 100% MATCH (PASS)
   ```

2. **Standalone Run (`npx tsx scripts/verify-auto-social.ts` - Task 56)**:
   - Output: 113/113 assertions passed, 0 failures, exit code 0.
   - Network safety verified: 0 outbound calls to real social media.
   - Baseline parity verified: 24/24 core tables matched (Delta = 0).

3. **Master Verification Pipeline Failure (`npm run verify` - Task 86 & Task 114)**:
   - **Task 86 (Exit code 1)**:
     ```text
     --- [Tier 1 / Area 1] CRM Campaigns & Pricing (FEAT-CRM-01..04) ---
     💥 [FATAL TEST SUITE ERROR]: Error: Mã chiến dịch "CP-TEST-T1-CRM" đã tồn tại
         at createCampaign (file:///Y:/Z.AI/workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005%20(1)/src/lib/campaign-service.ts:1:6271)
         at async main (Y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\scripts\verify-auto-social.ts:654:25) {
       statusCode: 409
     }
     ```
   - **Task 114 (Exit code 1)**:
     ```text
     --- [Tier 1 / Area 2] Google Drive Ingestion (FEAT-DRV-01..05) ---
     [DriveParser] Không thể trích xuất văn bản từ tệp 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms: [TypeError: fetch failed] {
       [cause]: ConnectTimeoutError: Connect Timeout Error (attempted addresses: 142.250.197.33:443, 2404:6800:4005:822::2001:443, timeout: 10000ms)
           at onConnectTimeout (node:internal/deps/undici/undici:1981:23)
           at Immediate._onImmediate (node:internal/deps/undici/undici:1947:35)
           at process.processImmediate (node:internal/timers:504:21) {
         code: 'UND_ERR_CONNECT_TIMEOUT'
       }
     }
       ❌ [FAIL] T1-DRV-04: extractDocumentText trích xuất text từ Google Sheet công khai
     💥 [FATAL TEST SUITE ERROR]: Error: Assertion failed: T1-DRV-04: extractDocumentText trích xuất text từ Google Sheet công khai ()
         at assert (Y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\scripts\verify-auto-social.ts:79:11)
         at main (Y:\Z.AI\workspace-57aaf18c-d0b6-44bc-8c6d-cf1574a56005 (1)\scripts\verify-auto-social.ts:725:5)
     ```

4. **Dual-Runtime Trampoline Inspection (`scripts/verify-auto-social.ts:27-42`)**:
   ```typescript
   if (!process.env.__AUTO_SOCIAL_TSX_ACTIVE__) {
     const isTsx =
       process.execArgv.some((a) => a.includes('tsx')) ||
       typeof (process as any)[Symbol.for('ts-node.register.instance')] !== 'undefined'
     if (!isTsx) {
       process.env.__AUTO_SOCIAL_TSX_ACTIVE__ = '1'
       const rawScript = process.argv[1] ? path.resolve(process.argv[1]) : path.resolve('scripts/verify-auto-social.ts')
       const quotedScript = `"${rawScript}"`
       const result = spawnSync('npx', ['tsx', quotedScript, ...process.argv.slice(2)], {
         stdio: 'inherit',
         shell: true,
         env: { ...process.env, __AUTO_SOCIAL_TSX_ACTIVE__: '1' },
       })
       process.exit(result.status ?? (result.error ? 1 : 0))
     }
   }
   ```

5. **Dev Server Requirement for Sub-Test `test:scenarios`**:
   - `task-64` failed on `test:scenarios` with `[cause]: AggregateError [ECONNREFUSED]` because the dev server on port 3010 was not running. Once the Next.js dev server was launched on port 3010 (`npm run dev`), `test:scenarios` passed 21/21 scenarios cleanly.

---

## 2. Logic Chain

1. **Intermittent Network Failure Invalidates the Quality Gate (`npm run verify`)**:
   - *Observation*: `scripts/verify-auto-social.ts` line 724 executes `extractDocumentText('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', 'application/vnd.google-apps.spreadsheet')`.
   - *Observation*: `extractDocumentText` initiates a live HTTP GET to `https://docs.google.com/spreadsheets/d/.../export?format=csv`. In testing under `task-34` and `task-114`, this request timed out with `ConnectTimeoutError` after 10,000ms.
   - *Deduction*: Relying on an un-retried, un-mocked live external internet request in the automated CI/verification suite directly violates:
     - `ORIGINAL_REQUEST.md` line 119: "`npm run verify` pass 0 lỗi/0 cảnh báo".
     - `TEST_READY.md` line 19 and lines 111-112: "No External Network Dependencies: Tests run offline or in isolated environments without needing live third-party API credentials".
   - *Consequence*: The test suite is brittle and flaky, causing `npm run verify` to fail non-deterministically.

2. **Absence of Pre-Flight Database Test Cleanup Causes Cascading 409 Conflict**:
   - *Observation*: `scripts/verify-auto-social.ts` runs database cleanup ONLY in `finally` (`PHASE 8`, lines 1548-1552). Phase 0 (lines 592-640) performs zero cleanup of test entities with prefix `CP-TEST-` or `test_`.
   - *Observation*: In `task-86`, `createCampaign` threw `Error: Mã chiến dịch "CP-TEST-T1-CRM" đã tồn tại` with status code 409 because a previous interrupted or un-checkpointed run left a residual record.
   - *Deduction*: A resilient test suite must perform idempotent pre-flight sweeping in Phase 0 (just as `scripts/verify-realworld-scenarios.ts` does in `cleanupLeftoverTestData`), ensuring that a run can always start cleanly regardless of whether the previous execution completed or crashed.

3. **Dual-Runtime Claim is a Facade Trampoline**:
   - *Observation*: Running `node --experimental-strip-types scripts/verify-auto-social.ts` executes lines 27-42, which detects `!isTsx` and delegates via `spawnSync('npx', ['tsx', ...])`.
   - *Deduction*: Worker M6 claimed native compatibility with both `node --experimental-strip-types` and `tsx`. In reality, `node` is merely used as a trampoline launcher to execute `npx tsx`. While the workaround works on machines with `npx tsx` installed, it masks the fact that the code does not natively run under raw Node ESM.

---

## 3. Quality Review & Adversarial Findings

### [Critical] Finding 1: Flaky Live External Network Call in T1-DRV-04 Causes `npm run verify` Abort
- **What**: `scripts/verify-auto-social.ts` lines 723-725 performs an un-mocked live network call to Google Sheets (`docs.google.com`), which intermittently fails with `ConnectTimeoutError`.
- **Where**: `scripts/verify-auto-social.ts:723-725` & `src/lib/drive-parser.ts:250-307`
- **Why**: Automated test suites and quality gates must be deterministic and offline-capable (`TEST_READY.md` lines 111-112). A network timeout against Google's servers halts the entire verification gate.
- **Suggestion**: In `scripts/verify-auto-social.ts`, wrap `extractDocumentText` with retry logic or verify against a local mock/fixture response if the network times out, OR have `extractDocumentText` gracefully degrade in test mode when `process.env.NODE_ENV === 'test'`.

### [Major] Finding 2: Missing Phase 0 Pre-Flight Test Data Cleanup Causes 409 Conflict on Re-Run
- **What**: If any run is terminated abruptly, `CP-TEST-T1-CRM` remains in the DB, causing the subsequent run to crash at line 654 with HTTP 409 Conflict.
- **Where**: `scripts/verify-auto-social.ts:592-645`
- **Why**: Test suites must be self-healing and idempotent.
- **Suggestion**: Add `await dbParity.cleanupTestData(testContext)` inside Phase 0 before running Tier 1 tests.

### [Major] Finding 3: Trampoline Facade for `node --experimental-strip-types`
- **What**: Lines 27-42 in `scripts/verify-auto-social.ts` use `spawnSync('npx', ['tsx', ...])` to re-execute itself when invoked via `node --experimental-strip-types`.
- **Where**: `scripts/verify-auto-social.ts:27-42`
- **Why**: While practically effective on this environment, it masks the underlying ESM path resolution issue rather than resolving it natively.
- **Suggestion**: Document this transparently in `TEST_READY.md` as an orchestration trampoline for Windows path spaces, or ensure proper module resolution.

### [Minor] Finding 4: Undocumented Port 3010 Dev Server Prerequisite for `npm run verify`
- **What**: `npm run verify` invokes `npm run test:scenarios`, which requires an active HTTP server on `http://localhost:3010`. If not running, it fails with `ECONNREFUSED`.
- **Where**: `package.json:15` & `TEST_READY.md:6`
- **Why**: Developers running `npm run verify` without the dev server running in the background will fail at step 4 (`test:scenarios`).
- **Suggestion**: Document in `TEST_READY.md` that `npm run dev` must be running on port 3010 prior to executing `npm run verify`, or add a pre-flight port check.

---

## 4. Adversarial Challenge Report

### [High] Challenge: External Network Dependency Blast Radius
- **Assumption challenged**: The test suite assumes `docs.google.com` is 100% available with zero latency and zero packet drop.
- **Attack scenario**: Tested by running `npm run verify` under fluctuating network / DNS resolution.
- **Blast radius**: The entire release gate fails (`exit code 1`), blocking CI/CD pipelines and deployment.
- **Mitigation**: Provide local test fixtures or Safe Mock fallback for Google Drive text extraction during test execution.

---

## 5. Verified Claims

| Claim | Method | Result |
|---|---|---|
| 35 features across Tiers 1-4 covered in `scripts/verify-auto-social.ts` | Code inspection & execution | ✅ PASS (All 35 features present and exercised) |
| Multi-layer Network Isolation Interceptor blocks Facebook/Zalo/etc. | Adversarial probe test at line 620 | ✅ PASS (Intercepted and vetoed with `[SECURITY VETO R6]`) |
| Codebase Secret Scanner detects 0 hardcoded secrets | Scan across `src/`, `prisma/`, `mini-services/` | ✅ PASS (0 hardcoded credentials found) |
| 24/24 Core Business Tables preserved (Delta = 0) | `node scripts/check-counts.mjs` | ✅ PASS (100% MATCH across 24 core tables) |
| `npx tsx scripts/verify-auto-social.ts` standalone execution | Executed via Task 56 | ✅ PASS (113/113 assertions pass when network does not timeout) |
| `npm run verify` passes with 0 errors | Executed via Task 86 & Task 114 | ❌ FAIL (Failed in Task 86 due to 409 conflict, and Task 114 due to Google Sheets network timeout) |

---

## 6. Caveats

- Implementation code was strictly NOT modified by this reviewer in accordance with the review-only constraint.
- The 24 core business tables remain completely intact (100% MATCH, Delta = 0).
- When network connectivity to Google does not timeout, the 4-tier suite executes all 113 assertions and finishes in ~18 seconds.

---

## 7. Conclusion

While Milestone 6 has achieved impressive depth—implementing 113 real assertions across 35 features, a functional multi-layer network interceptor, and 100% database parity (24/24 core tables preserved)—the master test suite cannot be approved in its current state because:
1. `npm run verify` intermittently fails with `ConnectTimeoutError` on live external Google Sheet fetching (`T1-DRV-04`).
2. `scripts/verify-auto-social.ts` lacks Phase 0 pre-flight DB cleanup, causing subsequent test runs to fail with HTTP 409 Conflict if an earlier run was aborted.

**Verdict**: **REQUEST_CHANGES**

---

## 8. Verification Method for Re-Review

To independently verify the fixes:
1. Add pre-flight cleanup in Phase 0 of `scripts/verify-auto-social.ts`.
2. Add offline mock fallback or resilient retry in `scripts/verify-auto-social.ts` for `T1-DRV-04` so it never fails on network timeout.
3. Ensure the dev server is running: `npm run dev` (port 3010).
4. Run `npm run verify` 3 times consecutively to guarantee 0 flakiness:
   ```bash
   npm run verify
   ```
5. Confirm 24/24 core tables match:
   ```bash
   node scripts/check-counts.mjs
   ```
