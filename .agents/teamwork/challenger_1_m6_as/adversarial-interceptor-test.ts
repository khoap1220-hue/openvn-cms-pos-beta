// adversarial-interceptor-test.ts
// ================================================================================
// EMPIRICAL CHALLENGER STRESS HARNESS: NetworkIsolationInterceptor (R6 Operational Safety)
// Challenger: challenger_1_m6_as
// Milestone: Milestone 6 (E2E Testing Track & Operational Safety)
// Target: scripts/verify-auto-social.ts -> NetworkIsolationInterceptor
// ================================================================================

import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'

// Telemetry counters
let totalTests = 0
let passedTests = 0
let failedTests = 0
const findings: Array<{ category: string; description: string; detail: string }> = []

function test(name: string, fn: () => void | Promise<void>) {
  totalTests++
  try {
    const result = fn()
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<void>)
        .then(() => {
          passedTests++
          console.log(`  ✅ [PASS] ${name}`)
        })
        .catch((err: any) => {
          failedTests++
          const errorMsg = err instanceof Error ? err.message : String(err)
          console.error(`  ❌ [FAIL] ${name} -> ${errorMsg}`)
        })
    } else {
      passedTests++
      console.log(`  ✅ [PASS] ${name}`)
      return Promise.resolve()
    }
  } catch (err: any) {
    failedTests++
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`  ❌ [FAIL] ${name} -> ${errorMsg}`)
    return Promise.resolve()
  }
}

// --------------------------------------------------------------------------------
// 1. INSPECT TARGET FILE: scripts/verify-auto-social.ts
// --------------------------------------------------------------------------------
const targetScriptPath = path.resolve('scripts/verify-auto-social.ts')
if (!fs.existsSync(targetScriptPath)) {
  console.error(`❌ Target script not found at ${targetScriptPath}`)
  process.exit(1)
}

const targetScriptContent = fs.readFileSync(targetScriptPath, 'utf8')

// Check for top-level main execution hazard
const hasMainGuard =
  targetScriptContent.includes('require.main === module') ||
  targetScriptContent.includes('process.argv[1].endsWith') ||
  targetScriptContent.includes('fileURLToPath(import.meta.url)')

if (!hasMainGuard && targetScriptContent.includes('main().catch(')) {
  findings.push({
    category: 'ARCHITECTURAL HAZARD',
    description: 'scripts/verify-auto-social.ts invokes main() unconditionally at file root (line 1570)',
    detail:
      'Importing NetworkIsolationInterceptor directly triggers prisma connection and E2E test execution against db/custom.db, violating isolation/concurrency.',
  })
}

// --------------------------------------------------------------------------------
// 2. CURRENT IMPLEMENTATION: As defined in scripts/verify-auto-social.ts lines 119-260
// --------------------------------------------------------------------------------
export interface InterceptedRequestLog {
  timestamp: string
  protocol: 'fetch' | 'http' | 'https' | 'socket'
  host: string
  url?: string
  blocked: boolean
}

export class CurrentNetworkIsolationInterceptor {
  private originalFetch = global.fetch
  private originalHttpRequest = http.request
  private originalHttpsRequest = https.request
  private originalSocketConnect = net.Socket.prototype.connect

  private forbiddenHostPattern =
    /(facebook|zalo|tiktok|threads|instagram|external-store\.vn|open\.tiktokapis\.com|graph\.facebook\.com|openapi\.zalo\.me|graph\.threads\.net)/i

  public totalIntercepted = 0
  public forbiddenOutboundAttempts = 0
  public ledger: InterceptedRequestLog[] = []
  private installed = false

  install() {
    if (this.installed) return
    this.installed = true

    // 1. Hook global.fetch
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      this.totalIntercepted++
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      let hostname = ''
      try {
        hostname = new URL(urlStr).hostname
      } catch {
        hostname = urlStr
      }

      if (this.forbiddenHostPattern.test(hostname)) {
        this.forbiddenOutboundAttempts++
        this.ledger.push({
          timestamp: new Date().toISOString(),
          protocol: 'fetch',
          host: hostname,
          url: urlStr,
          blocked: true,
        })
        throw new Error(`[SECURITY VETO R6] Bị chặn gọi mạng thật tới nền tảng ngoài trong test: ${urlStr}`)
      }

      this.ledger.push({
        timestamp: new Date().toISOString(),
        protocol: 'fetch',
        host: hostname,
        url: urlStr,
        blocked: false,
      })
      return this.originalFetch(input, init)
    }

    // 2. Hook http.request & https.request
    const createHttpHook = (origFn: typeof http.request, protocol: 'http' | 'https') => {
      return (urlOrOptions: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown): http.ClientRequest => {
        this.totalIntercepted++
        let host = ''
        if (typeof urlOrOptions === 'string') {
          try {
            host = new URL(urlOrOptions).hostname
          } catch {
            host = urlOrOptions
          }
        } else if (urlOrOptions instanceof URL) {
          host = urlOrOptions.hostname
        } else if (urlOrOptions && typeof urlOrOptions === 'object') {
          const opt = urlOrOptions as { hostname?: string; host?: string }
          host = opt.hostname || opt.host || ''
        }

        if (this.forbiddenHostPattern.test(host)) {
          this.forbiddenOutboundAttempts++
          this.ledger.push({
            timestamp: new Date().toISOString(),
            protocol,
            host,
            blocked: true,
          })
          throw new Error(`[SECURITY VETO R6] Bị chặn kết nối HTTP(S) tới máy chủ mạng xã hội ngoài: ${host}`)
        }

        return (origFn as Function).call(null, urlOrOptions, optionsOrCallback, maybeCallback)
      }
    }

    http.request = createHttpHook(this.originalHttpRequest, 'http') as typeof http.request
    https.request = createHttpHook(this.originalHttpsRequest, 'https') as typeof https.request

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
  }

  assertZeroOutbound(testScope: string) {
    if (this.forbiddenOutboundAttempts !== 0) {
      console.error(`❌ [SECURITY VIOLATION] Phát hiện ${this.forbiddenOutboundAttempts} kết nối ra ngoài trong [${testScope}]:`)
      for (const log of this.ledger.filter((l) => l.blocked)) {
        console.error(`  - ${log.timestamp} | ${log.protocol} | Target: ${log.host} | ${log.url || ''}`)
      }
      throw new Error(`[SECURITY VETO R6] Kiểm toán an toàn mạng thất bại: ${this.forbiddenOutboundAttempts} outbound calls detected.`)
    }
  }

  reset() {
    this.totalIntercepted = 0
    this.forbiddenOutboundAttempts = 0
    this.ledger = []
  }

  uninstall() {
    if (!this.installed) return
    global.fetch = this.originalFetch
    http.request = this.originalHttpRequest
    https.request = this.originalHttpsRequest
    net.Socket.prototype.connect = this.originalSocketConnect
    this.installed = false
  }
}

// --------------------------------------------------------------------------------
// 3. HARDENED IMPLEMENTATION: Complete Fix for Array args & http.get / https.get
// --------------------------------------------------------------------------------
export class HardenedNetworkIsolationInterceptor {
  private originalFetch = global.fetch
  private originalHttpRequest = http.request
  private originalHttpsRequest = https.request
  private originalHttpGet = http.get
  private originalHttpsGet = https.get
  private originalSocketConnect = net.Socket.prototype.connect

  private forbiddenHostPattern =
    /(facebook|zalo|tiktok|threads|instagram|external-store\.vn|open\.tiktokapis\.com|graph\.facebook\.com|openapi\.zalo\.me|graph\.threads\.net)/i

  public totalIntercepted = 0
  public forbiddenOutboundAttempts = 0
  public ledger: InterceptedRequestLog[] = []
  private installed = false

  install() {
    if (this.installed) return
    this.installed = true

    // 1. Hook global.fetch
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      this.totalIntercepted++
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      let hostname = ''
      try {
        hostname = new URL(urlStr).hostname
      } catch {
        hostname = urlStr
      }

      if (this.forbiddenHostPattern.test(hostname)) {
        this.forbiddenOutboundAttempts++
        this.ledger.push({
          timestamp: new Date().toISOString(),
          protocol: 'fetch',
          host: hostname,
          url: urlStr,
          blocked: true,
        })
        throw new Error(`[SECURITY VETO R6] Bị chặn gọi mạng thật tới nền tảng ngoài trong test: ${urlStr}`)
      }

      this.ledger.push({
        timestamp: new Date().toISOString(),
        protocol: 'fetch',
        host: hostname,
        url: urlStr,
        blocked: false,
      })
      return this.originalFetch(input, init)
    }

    // 2. Hook http.request, https.request, http.get, https.get
    const createHttpHook = (origFn: Function, protocol: 'http' | 'https') => {
      return (urlOrOptions: unknown, optionsOrCallback?: unknown, maybeCallback?: unknown): http.ClientRequest => {
        this.totalIntercepted++
        let host = ''
        if (typeof urlOrOptions === 'string') {
          try {
            host = new URL(urlOrOptions).hostname
          } catch {
            host = urlOrOptions
          }
        } else if (urlOrOptions instanceof URL) {
          host = urlOrOptions.hostname
        } else if (urlOrOptions && typeof urlOrOptions === 'object') {
          const opt = urlOrOptions as { hostname?: string; host?: string }
          host = opt.hostname || opt.host || ''
        }

        if (this.forbiddenHostPattern.test(host)) {
          this.forbiddenOutboundAttempts++
          this.ledger.push({
            timestamp: new Date().toISOString(),
            protocol,
            host,
            blocked: true,
          })
          throw new Error(`[SECURITY VETO R6] Bị chặn kết nối HTTP(S) tới máy chủ mạng xã hội ngoài: ${host}`)
        }

        return origFn.call(null, urlOrOptions, optionsOrCallback, maybeCallback)
      }
    }

    http.request = createHttpHook(this.originalHttpRequest, 'http') as typeof http.request
    https.request = createHttpHook(this.originalHttpsRequest, 'https') as typeof https.request
    http.get = createHttpHook(this.originalHttpGet, 'http') as typeof http.get
    https.get = createHttpHook(this.originalHttpsGet, 'https') as typeof https.get

    // 3. Hook low-level net.Socket.prototype.connect (with Array unwrap handling)
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
  }

  assertZeroOutbound(testScope: string) {
    if (this.forbiddenOutboundAttempts !== 0) {
      console.error(`❌ [SECURITY VIOLATION] Phát hiện ${this.forbiddenOutboundAttempts} kết nối ra ngoài trong [${testScope}]:`)
      for (const log of this.ledger.filter((l) => l.blocked)) {
        console.error(`  - ${log.timestamp} | ${log.protocol} | Target: ${log.host} | ${log.url || ''}`)
      }
      throw new Error(`[SECURITY VETO R6] Kiểm toán an toàn mạng thất bại: ${this.forbiddenOutboundAttempts} outbound calls detected.`)
    }
  }

  reset() {
    this.totalIntercepted = 0
    this.forbiddenOutboundAttempts = 0
    this.ledger = []
  }

  uninstall() {
    if (!this.installed) return
    global.fetch = this.originalFetch
    http.request = this.originalHttpRequest
    https.request = this.originalHttpsRequest
    http.get = this.originalHttpGet
    https.get = this.originalHttpsGet
    net.Socket.prototype.connect = this.originalSocketConnect
    this.installed = false
  }
}

// --------------------------------------------------------------------------------
// 4. MAIN TEST RUNNER
// --------------------------------------------------------------------------------
async function run() {
  console.log('================================================================================')
  console.log('⚡ EMPIRICAL CHALLENGER AUDIT: NetworkIsolationInterceptor (R6 Safety)')
  console.log('================================================================================\n')

  // PART A: Testing Current Implementation
  console.log('================================================================================')
  console.log('PHASE 1: STRESS-TESTING CURRENT CODEBASE IMPLEMENTATION')
  console.log('================================================================================')
  const current = new CurrentNetworkIsolationInterceptor()
  current.install()

  // 1. Fetch traps
  const fetchEndpoints = [
    'https://graph.facebook.com/v19.0/me',
    'https://openapi.zalo.me/v2.0/oa/message',
    'https://api.tiktok.com/v2/post/publish/video/init/',
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    'https://graph.instagram.com/v19.0/17841400/media',
    'https://graph.threads.net/v1.0/17841400/threads',
    'https://external-store.vn/api/webhook',
    'https://GRAPH.FACEBOOK.COM/V19.0/ME',
    'https://OpenApi.Zalo.Me/v2.0/oa/message',
    'https://API.TIKTOK.COM/v2/post',
  ]

  console.log('\n--- Category 1.1: Fetch Interception ---')
  for (const ep of fetchEndpoints) {
    await test(`Current: Traps fetch("${ep}")`, async () => {
      let threw = false
      try {
        await global.fetch(ep)
      } catch (err: any) {
        threw = true
        if (!err.message.includes('[SECURITY VETO R6]')) {
          throw new Error(`Unexpected error message: ${err.message}`)
        }
      }
      if (!threw) throw new Error('Fetch did not throw [SECURITY VETO R6]!')
    })
  }

  // 2. Direct http.request / https.request
  console.log('\n--- Category 1.2: Direct http.request & https.request ---')
  const directHttpEndpoints = [
    { name: 'https.request: graph.facebook.com', fn: () => https.request('https://graph.facebook.com') },
    { name: 'https.request: openapi.zalo.me', fn: () => https.request(new URL('https://openapi.zalo.me')) },
    { name: 'https.request: api.tiktok.com', fn: () => https.request({ hostname: 'api.tiktok.com' }) },
    { name: 'https.request: graph.instagram.com', fn: () => https.request({ hostname: 'graph.instagram.com' }) },
    { name: 'http.request: external-store.vn', fn: () => http.request('http://external-store.vn') },
  ]
  for (const ep of directHttpEndpoints) {
    await test(`Current: Traps ${ep.name}`, () => {
      let threw = false
      try {
        ep.fn()
      } catch (err: any) {
        threw = true
        if (!err.message.includes('[SECURITY VETO R6]')) {
          throw new Error(`Unexpected error message: ${err.message}`)
        }
      }
      if (!threw) throw new Error('http.request did not throw [SECURITY VETO R6]!')
    })
  }

  // 3. Testing the VULNERABILITY in current Socket hook: net.connect
  console.log('\n--- Category 1.3: Low-Level net.connect Vulnerability Probe ---')
  await test('VULNERABILITY REPRODUCTION: net.connect({ host: "graph.facebook.com", port: 443 })', () => {
    // Intercept originalSocketConnect to record if it leaks
    let leaked = false
    const origConnect = (current as any).originalSocketConnect
    ;(current as any).originalSocketConnect = function (...args: any[]) {
      leaked = true
      this.destroy()
      return this
    }

    const prevCount = current.forbiddenOutboundAttempts
    net.connect({ host: 'graph.facebook.com', port: 443 })
    ;(current as any).originalSocketConnect = origConnect

    if (leaked && current.forbiddenOutboundAttempts === prevCount) {
      findings.push({
        category: 'CRITICAL SECURITY LEAK',
        description: 'net.Socket.prototype.connect fails to inspect Array-wrapped arguments from net.connect',
        detail:
          'In Node.js, net.connect normalizes arguments into an Array. Current implementation reads args[0].host, which evaluates to undefined on arrays, falling back to "localhost" and bypassing the security check entirely.',
      })
      console.log('  🚨 [EMPIRICALLY CONFIRMED] Socket call bypassed interceptor and reached originalSocketConnect!')
    } else {
      throw new Error('Expected vulnerability did not trigger!')
    }
  })

  // 4. Testing the VULNERABILITY in http.get
  console.log('\n--- Category 1.4: http.get Escape Vector Probe ---')
  await test('VULNERABILITY REPRODUCTION: http.get("http://openapi.zalo.me/test")', async () => {
    let leaked = false
    const origConnect = (current as any).originalSocketConnect
    ;(current as any).originalSocketConnect = function (...args: any[]) {
      leaked = true
      this.destroy()
      return this
    }

    const prevCount = current.forbiddenOutboundAttempts
    await new Promise<void>((resolve) => {
      const req = http.get('http://openapi.zalo.me/test', () => {})
      req.on('error', () => resolve())
      setTimeout(() => resolve(), 80)
    })
    ;(current as any).originalSocketConnect = origConnect

    if (leaked && current.forbiddenOutboundAttempts === prevCount) {
      findings.push({
        category: 'CRITICAL SECURITY LEAK',
        description: 'http.get bypasses Layer 2 HTTP hook and leaks directly through unpatched net.connect',
        detail:
          'Node.js http.get calls private internal request() rather than exported http.request. Combined with the Array bug in Socket.connect, outbound calls to social endpoints completely escape to the real network.',
      })
      console.log('  🚨 [EMPIRICALLY CONFIRMED] http.get bypassed both HTTP and Socket interceptors!')
    } else {
      throw new Error('Expected http.get escape did not trigger!')
    }
  })

  current.uninstall()

  // PART B: Testing Hardened Implementation
  console.log('\n================================================================================')
  console.log('PHASE 2: VERIFYING HARDENED INTERCEPTOR WITH PROPOSED DEFENSE-IN-DEPTH PATCH')
  console.log('================================================================================')
  const hardened = new HardenedNetworkIsolationInterceptor()
  hardened.install()

  console.log('\n--- Category 2.1: Hardened Fetch Probes ---')
  for (const ep of fetchEndpoints) {
    await test(`Hardened: Traps fetch("${ep}")`, async () => {
      let threw = false
      try {
        await global.fetch(ep)
      } catch (err: any) {
        threw = true
        if (!err.message.includes('[SECURITY VETO R6]')) {
          throw new Error(`Unexpected error message: ${err.message}`)
        }
      }
      if (!threw) throw new Error('Fetch did not throw [SECURITY VETO R6]!')
    })
  }

  console.log('\n--- Category 2.2: Hardened http.get & https.get Probes ---')
  const getEndpoints = [
    { name: 'http.get: openapi.zalo.me', fn: () => http.get('http://openapi.zalo.me/test') },
    { name: 'https.get: graph.facebook.com', fn: () => https.get('https://graph.facebook.com/v19.0/me') },
    { name: 'https.get: api.tiktok.com', fn: () => https.get('https://api.tiktok.com/v2/test') },
    { name: 'https.get: graph.instagram.com', fn: () => https.get('https://graph.instagram.com/test') },
    { name: 'https.get: graph.threads.net', fn: () => https.get('https://graph.threads.net/test') },
    { name: 'http.get: external-store.vn', fn: () => http.get('http://external-store.vn/api') },
  ]
  for (const ep of getEndpoints) {
    await test(`Hardened: Traps synchronous ${ep.name}`, () => {
      let threw = false
      try {
        ep.fn()
      } catch (err: any) {
        threw = true
        if (!err.message.includes('[SECURITY VETO R6]')) {
          throw new Error(`Unexpected error message: ${err.message}`)
        }
      }
      if (!threw) throw new Error('http.get did not throw [SECURITY VETO R6]!')
    })
  }

  console.log('\n--- Category 2.3: Hardened net.connect & Socket Probes ---')
  const rawSocketEndpoints = [
    { name: 'net.connect({ host: "graph.facebook.com", port: 443 })', fn: () => net.connect({ host: 'graph.facebook.com', port: 443 }) },
    { name: 'net.connect(443, "openapi.zalo.me")', fn: () => net.connect(443, 'openapi.zalo.me') },
    { name: 'net.connect({ host: "api.tiktok.com", port: 443 })', fn: () => net.connect({ host: 'api.tiktok.com', port: 443 }) },
    { name: 'net.connect(443, "graph.instagram.com")', fn: () => net.connect(443, 'graph.instagram.com') },
    { name: 'net.connect({ host: "GRAPH.THREADS.NET", port: 443 })', fn: () => net.connect({ host: 'GRAPH.THREADS.NET', port: 443 }) },
    { name: 'net.connect(80, "external-store.vn")', fn: () => net.connect(80, 'external-store.vn') },
  ]
  for (const ep of rawSocketEndpoints) {
    await test(`Hardened: Destroys socket and traps ${ep.name}`, async () => {
      let errorCaught = false
      let errorMessage = ''
      await new Promise<void>((resolve) => {
        const socket = ep.fn()
        socket.on('error', (err: Error) => {
          errorCaught = true
          errorMessage = err.message
          resolve()
        })
        setTimeout(() => resolve(), 60)
      })
      if (!errorCaught) throw new Error('Socket was not destroyed with error!')
      if (!errorMessage.includes('[SECURITY VETO R6]')) {
        throw new Error(`Wrong error message: ${errorMessage}`)
      }
    })
  }

  console.log('\n--- Category 2.4: Permitted Traffic Whitelist Preservation ---')
  await test('Hardened: Google Drive and Gemini are NOT blocked (R6 Exception Compliance)', () => {
    const allowed = ['drive.google.com', 'docs.google.com', 'generativelanguage.googleapis.com', 'localhost']
    for (const h of allowed) {
      if ((hardened as any).forbiddenHostPattern.test(h)) {
        throw new Error(`Permitted host ${h} was incorrectly blocked!`)
      }
    }
  })

  hardened.uninstall()

  // ------------------------------------------------------------------------------
  // FINAL EVALUATION
  // ------------------------------------------------------------------------------
  console.log('\n================================================================================')
  console.log('📊 EMPIRICAL CHALLENGER FINDINGS SUMMARY')
  console.log('================================================================================')
  console.log(`Total tests executed       : ${totalTests}`)
  console.log(`Passed tests               : ${passedTests}`)
  console.log(`Failed tests               : ${failedTests}`)
  console.log(`Critical findings uncovered: ${findings.length}\n`)

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]
    console.error(`[Finding ${i + 1}] [${f.category}]: ${f.description}`)
    console.error(`   Details: ${f.detail}\n`)
  }

  if (findings.length > 0) {
    console.log('================================================================================')
    console.log('🚨 FORMAL ADVERSARIAL VERDICT: REJECT')
    console.log('Reason: NetworkIsolationInterceptor in scripts/verify-auto-social.ts has two real')
    console.log('leakage vectors (Array-wrapped socket args and unhooked http.get/https.get) and')
    console.log('lacks an execution guard around main(). R6 invariant is NOT airtight.')
    console.log('================================================================================\n')
  } else {
    console.log('================================================================================')
    console.log('✅ FORMAL ADVERSARIAL VERDICT: APPROVE')
    console.log('================================================================================\n')
  }
}

run().catch((err) => {
  console.error('Fatal runner error:', err)
  process.exit(1)
})
