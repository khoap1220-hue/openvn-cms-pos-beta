# EMPIRICAL CHALLENGER HANDOFF REPORT
**Agent ID**: `challenger_1_m6_as`
**Roles**: `critic`, `specialist`
**Milestone**: Milestone 6: E2E Testing Track & Operational Safety (R6, R7)
**Target**: `NetworkIsolationInterceptor` in `scripts/verify-auto-social.ts`
**Date**: 2026-10-27
**Final Verdict**: 🚨 **REJECT**

---

## 1. Observation

### Observation 1.1: Missing Array Argument Handling in `net.Socket.prototype.connect`
- **File**: `scripts/verify-auto-social.ts`, lines 208–218:
```ts
    // 3. Hook low-level net.Socket.prototype.connect
    const self = this
    net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
      let host = ''
      let port = 0
      if (typeof args[0] === 'object' && args[0] !== null) {
        const opt = args[0] as { host?: string; hostname?: string; port?: number }
        host = opt.host || opt.hostname || 'localhost'
        port = opt.port || 0
      } else if (typeof args[0] === 'number') {
        port = args[0]
        if (typeof args[1] === 'string') host = args[1]
      }
```
- **Observed Behavior**:
  When Node.js's standard `net.connect(options)` or `net.createConnection(options)` is called, Node.js internally normalizes arguments via `normalizeArgs` into an array:
  `args[0] = [ { host: 'graph.facebook.com', port: 443 }, null, Symbol(normalizedArgs): true ]`.
  Because `typeof [] === 'object'`, the `typeof args[0] === 'object'` branch executes. However, `args[0]` is an `Array`. Reading `(args[0] as any).host` or `(args[0] as any).hostname` returns `undefined`.
  Consequently, `host` falls back to `'localhost'`:
  `host = opt.host || opt.hostname || 'localhost'` (`host = 'localhost'`).
  Because `'localhost'` does not match `forbiddenHostPattern`, line 220 evaluates to `false`. Line 232 executes:
  `return self.originalSocketConnect.apply(this, args as Parameters<typeof self.originalSocketConnect>)`.
  **The interceptor completely fails to block the call and delegates to `originalSocketConnect`, transmitting real TCP socket packets over the wire to external social servers.**

### Observation 1.2: Unhooked `http.get` / `https.get` Escape Vector
- **File**: `scripts/verify-auto-social.ts`, lines 203–204:
```ts
    http.request = createHttpHook(this.originalHttpRequest, 'http') as typeof http.request
    https.request = createHttpHook(this.originalHttpsRequest, 'https') as typeof https.request
```
- **Observed Behavior**:
  `NetworkIsolationInterceptor.install()` hooks `http.request` and `https.request`, but omits `http.get` and `https.get`.
  In Node.js runtime (`node:http`), `http.get` invokes Node's internal, module-scoped `request()` function rather than the mutated `http.request` property.
  As a result:
  1. `http.get('http://openapi.zalo.me/test')` completely bypasses Layer 2 (`http.request` hook).
  2. The request enters `Agent.prototype.createSocket`, which calls `net.connect(...)`.
  3. Because `net.connect(...)` triggers the Array-argument bug documented in Observation 1.1, Layer 3 (`net.Socket.prototype.connect` hook) fails to recognize the host, evaluating it as `'localhost'`.
  4. Real socket connection is dispatched to `openapi.zalo.me:80`. `forbiddenOutboundAttempts` remains `0`.

### Observation 1.3: Unconditional Top-Level `main()` Execution in `scripts/verify-auto-social.ts`
- **File**: `scripts/verify-auto-social.ts`, lines 1570–1573:
```ts
main().catch((err) => {
  console.error('\n💥 [FATAL TEST SUITE ERROR]:', err)
  process.exit(1)
})
```
- **Observed Behavior**:
  There is no execution guard (such as `if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/verify-auto-social.ts'))` or `require.main === module`).
  Any external script or test harness attempting to import `NetworkIsolationInterceptor` (`import { NetworkIsolationInterceptor } from 'scripts/verify-auto-social.ts'`) immediately triggers the full 1574-line test suite against `db/custom.db`, violating test isolation and multi-agent concurrency safety.

### Observation 1.4: Empirical Test Harness Results
- **Harness Path**: `.agents/teamwork/challenger_1_m6_as/adversarial-interceptor-test.ts`
- **Command**: `npx tsx ".agents/teamwork/challenger_1_m6_as/adversarial-interceptor-test.ts"`
- **Verbatim Output**:
```
================================================================================
⚡ EMPIRICAL CHALLENGER AUDIT: NetworkIsolationInterceptor (R6 Safety)
================================================================================

================================================================================
PHASE 1: STRESS-TESTING CURRENT CODEBASE IMPLEMENTATION
================================================================================

--- Category 1.1: Fetch Interception ---
  ✅ [PASS] Current: Traps fetch("https://graph.facebook.com/v19.0/me")
  ✅ [PASS] Current: Traps fetch("https://openapi.zalo.me/v2.0/oa/message")
  ✅ [PASS] Current: Traps fetch("https://api.tiktok.com/v2/post/publish/video/init/")
  ✅ [PASS] Current: Traps fetch("https://open.tiktokapis.com/v2/post/publish/video/init/")
  ✅ [PASS] Current: Traps fetch("https://graph.instagram.com/v19.0/17841400/media")
  ✅ [PASS] Current: Traps fetch("https://graph.threads.net/v1.0/17841400/threads")
  ✅ [PASS] Current: Traps fetch("https://external-store.vn/api/webhook")
  ✅ [PASS] Current: Traps fetch("https://GRAPH.FACEBOOK.COM/V19.0/ME")
  ✅ [PASS] Current: Traps fetch("https://OpenApi.Zalo.Me/v2.0/oa/message")
  ✅ [PASS] Current: Traps fetch("https://API.TIKTOK.COM/v2/post")

--- Category 1.2: Direct http.request & https.request ---
  ✅ [PASS] Current: Traps https.request: graph.facebook.com
  ✅ [PASS] Current: Traps https.request: openapi.zalo.me
  ✅ [PASS] Current: Traps https.request: api.tiktok.com
  ✅ [PASS] Current: Traps https.request: graph.instagram.com
  ✅ [PASS] Current: Traps http.request: external-store.vn

--- Category 1.3: Low-Level net.connect Vulnerability Probe ---
  🚨 [EMPIRICALLY CONFIRMED] Socket call bypassed interceptor and reached originalSocketConnect!
  ✅ [PASS] VULNERABILITY REPRODUCTION: net.connect({ host: "graph.facebook.com", port: 443 })

--- Category 1.4: http.get Escape Vector Probe ---
  🚨 [EMPIRICALLY CONFIRMED] http.get bypassed both HTTP and Socket interceptors!
  ✅ [PASS] VULNERABILITY REPRODUCTION: http.get("http://openapi.zalo.me/test")

================================================================================
PHASE 2: VERIFYING HARDENED INTERCEPTOR WITH PROPOSED DEFENSE-IN-DEPTH PATCH
================================================================================

--- Category 2.1: Hardened Fetch Probes ---
  ✅ [PASS] Hardened: Traps fetch(...) (10/10 endpoints trapped)

--- Category 2.2: Hardened http.get & https.get Probes ---
  ✅ [PASS] Hardened: Traps synchronous http.get: openapi.zalo.me
  ✅ [PASS] Hardened: Traps synchronous https.get: graph.facebook.com
  ✅ [PASS] Hardened: Traps synchronous https.get: api.tiktok.com
  ✅ [PASS] Hardened: Traps synchronous https.get: graph.instagram.com
  ✅ [PASS] Hardened: Traps synchronous https.get: graph.threads.net
  ✅ [PASS] Hardened: Traps synchronous http.get: external-store.vn

--- Category 2.3: Hardened net.connect & Socket Probes ---
  ✅ [PASS] Hardened: Destroys socket and traps net.connect({ host: "graph.facebook.com", port: 443 })
  ✅ [PASS] Hardened: Destroys socket and traps net.connect(443, "openapi.zalo.me")
  ✅ [PASS] Hardened: Destroys socket and traps net.connect({ host: "api.tiktok.com", port: 443 })
  ✅ [PASS] Hardened: Destroys socket and traps net.connect(443, "graph.instagram.com")
  ✅ [PASS] Hardened: Destroys socket and traps net.connect({ host: "GRAPH.THREADS.NET", port: 443 })
  ✅ [PASS] Hardened: Destroys socket and traps net.connect(80, "external-store.vn")

--- Category 2.4: Permitted Traffic Whitelist Preservation ---
  ✅ [PASS] Hardened: Google Drive and Gemini are NOT blocked (R6 Exception Compliance)
```

---

## 2. Logic Chain

1. **Premise**: Requirement R6 states:
   > *"Trong phát triển và kiểm thử không gọi mạng/thiết bị thật... Bộ test tự động và mọi hoạt động kiểm thử của đội agent tuyệt đối không đăng bài công khai lên trang thật... Bằng chứng (log mạng hoặc cơ chế chặn trong test) cho thấy bộ test không gửi request đăng bài tới endpoint thật của Facebook/Zalo/Instagram/TikTok/Threads/website ngoài."*
2. **Analysis of Current Implementation**:
   - `global.fetch` hook works reliably for all tested string, URL, and Request objects (Observation 1.4, Category 1.1).
   - `http.request` and `https.request` work when invoked directly (Observation 1.4, Category 1.2).
   - However, Node.js standard library methods `net.connect` and `net.createConnection` pass arguments wrapped in an Array (`[options, cb]`).
   - Line 211 of `scripts/verify-auto-social.ts` checks `typeof args[0] === 'object'`. Because `Array` is an object in JS, it accesses `args[0].host` (which is `undefined`).
   - The default value `'localhost'` is assigned, which is not in `forbiddenHostPattern`.
   - The method falls through to `self.originalSocketConnect.apply(...)`, emitting real TCP packets to the internet (Observation 1.1, Category 1.3).
3. **Compounding Factor (`http.get`)**:
   - Node.js's internal `http.get` does not call `http.request`, completely bypassing Layer 2.
   - When `http.get` reaches Layer 3 (`net.connect`), the Array argument bug causes Layer 3 to fail as well.
   - As proven empirically in Observation 1.4 (Category 1.4), calls to `http.get('http://openapi.zalo.me/test')` leak directly to `originalSocketConnect` with 0 security vetos and 0 attempts logged.
4. **Conclusion**:
   The current `NetworkIsolationInterceptor` in `scripts/verify-auto-social.ts` is **NOT airtight**. It contains two critical leakage paths that permit real network socket connections to external social servers during test execution.

---

## 3. Caveats

- **Scope of Testing**:
  Testing was conducted entirely in memory without touching `db/custom.db` or triggering the database suite, strictly complying with the concurrency constraint.
- **Application Code Status**:
  In `src/lib/publishing-gateway.ts`, current code primarily uses `global.fetch` and `shouldUseSafeMock`. However, the purpose of `NetworkIsolationInterceptor` is to act as an un-bypassable runtime safety net (defense-in-depth). Because `net.connect` and `http.get` leak, any third-party library, transitive dependency, or future code using `http.get` or `net.connect` would bypass the interceptor undetected.
- **No Direct Modification**:
  As an empirical challenger with review-only scope, no changes were committed to `scripts/verify-auto-social.ts`. The exact hardened patch is provided below for `worker_m6` or `orchestrator_2` to apply.

---

## 4. Conclusion & Actionable Remediation

### Formal Verdict: 🚨 **REJECT**

The R6 Network Isolation invariant is **compromised** under `net.connect` and `http.get` calls.

### Concrete Remediation for Worker (`scripts/verify-auto-social.ts`):

#### Fix 1: Unwrap Array in `net.Socket.prototype.connect`
In `scripts/verify-auto-social.ts` around line 208:
```ts
    // 3. Hook low-level net.Socket.prototype.connect
    const self = this
    net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]): net.Socket {
      let host = ''
      let port = 0

      // Node.js net.connect / net.createConnection wraps arguments in an Array [options, cb]
      let firstArg = args[0]
      if (Array.isArray(firstArg)) {
        firstArg = firstArg[0]
      }

      if (typeof firstArg === 'object' && firstArg !== null) {
        const opt = firstArg as { host?: string; hostname?: string; port?: number }
        host = opt.host || opt.hostname || 'localhost'
        port = opt.port || 0
      } else if (typeof firstArg === 'number') {
        port = firstArg
        if (typeof args[1] === 'string') host = args[1]
      }

      if (self.forbiddenHostPattern.test(host)) {
        self.forbiddenOutboundAttempts++
        self.ledger.push({
          timestamp: new Date().toISOString(),
          protocol: 'socket',
          host: `${host}:${port}`,
          blocked: true,
        })
        this.destroy(new Error(`[SECURITY VETO R6] Socket kết nối trực tiếp tới ${host}:${port} bị chặn tuyệt đối`))
        return this
      }

      return self.originalSocketConnect.apply(this, args as Parameters<typeof self.originalSocketConnect>)
    }
```

#### Fix 2: Hook `http.get` and `https.get` at Layer 2
Add `originalHttpGet` and `originalHttpsGet` hooks in `NetworkIsolationInterceptor.install()` and `uninstall()`:
```ts
    http.get = createHttpHook(this.originalHttpGet, 'http') as typeof http.get
    https.get = createHttpHook(this.originalHttpsGet, 'https') as typeof https.get
```

#### Fix 3: Add Execution Guard around `main()`
In `scripts/verify-auto-social.ts` line 1570:
```ts
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/verify-auto-social.ts')) {
  main().catch((err) => {
    console.error('\n💥 [FATAL TEST SUITE ERROR]:', err)
    process.exit(1)
  })
}
```

---

## 5. Verification Method

To independently verify the vulnerability and the proposed mitigation:

1. **Execute the Empirical Challenger Stress Harness**:
   ```powershell
   npx tsx ".agents/teamwork/challenger_1_m6_as/adversarial-interceptor-test.ts"
   ```
2. **Expected Verification Outcome**:
   - Phase 1 reproduces the leaks on `net.connect({ host: "graph.facebook.com", port: 443 })` and `http.get("http://openapi.zalo.me/test")`.
   - Phase 2 confirms that the hardened interceptor achieves 100% containment across 40 assertions with zero network leakage.
3. **Invalidation Condition**:
   This rejection is invalidated once `worker_m6` applies Fix 1, Fix 2, and Fix 3 to `scripts/verify-auto-social.ts`, and the harness runs directly against `scripts/verify-auto-social.ts` with 0 leakage.
