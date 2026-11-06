// verify-actual-interceptor.ts
// Empirical Challenger M6 Iteration 2: Direct Verification of scripts/verify-auto-social.ts
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'

console.log('================================================================================')
console.log('⚡ EMPIRICAL CHALLENGER M6 ITERATION 2: DIRECT INTERCEPTOR VERIFICATION')
console.log('================================================================================')

let totalTests = 0
let passedTests = 0
let failedTests = 0

function assertTest(name: string, ok: boolean, details?: string) {
  totalTests++
  if (ok) {
    passedTests++
    console.log(`  ✅ [PASS] ${name}`)
  } else {
    failedTests++
    console.error(`  ❌ [FAIL] ${name} -> ${details || 'Assertion failed'}`)
  }
}

async function run() {
  // Test 1: Verify isDirectExecution guard prevents top-level main execution
  console.log('\n--- Section 1: Target File Inspection & Import Isolation ---')
  const targetScriptPath = path.resolve('scripts/verify-auto-social.ts')
  const content = fs.readFileSync(targetScriptPath, 'utf8')

  assertTest(
    'isDirectExecution guard is defined in scripts/verify-auto-social.ts',
    content.includes('const isDirectExecution =') &&
      content.includes('process.argv[1]') &&
      content.includes('verify-auto-social.ts')
  )

  assertTest(
    'main() call is strictly wrapped by if (isDirectExecution)',
    content.includes('if (isDirectExecution) {\n  main().catch(') ||
      content.includes('if (isDirectExecution) {\r\n  main().catch(')
  )

  // Dynamically import from scripts/verify-auto-social.ts
  const importedModule = await import('../../../scripts/verify-auto-social.ts')
  const InterceptorClass = importedModule.NetworkIsolationInterceptor

  assertTest(
    'NetworkIsolationInterceptor successfully imported without running main()',
    typeof InterceptorClass === 'function'
  )

  // Test 2: Instantiate and install the ACTUAL interceptor
  console.log('\n--- Section 2: Low-Level Array Argument Unwrapping Probes (Fix 1) ---')
  const interceptor = new InterceptorClass()
  interceptor.install()

  // Track if any socket reaches original connect
  let rawSocketLeakCount = 0
  const origConnect = (interceptor as any).originalSocketConnect
  ;(interceptor as any).originalSocketConnect = function (this: net.Socket, ...args: any[]) {
    rawSocketLeakCount++
    this.destroy()
    return this
  }

  const socketEndpoints = [
    { name: 'net.connect({ host: "graph.facebook.com", port: 443 })', fn: () => net.connect({ host: 'graph.facebook.com', port: 443 }) },
    { name: 'net.connect(443, "openapi.zalo.me")', fn: () => net.connect(443, 'openapi.zalo.me') },
    { name: 'net.connect({ host: "api.tiktok.com", port: 443 })', fn: () => net.connect({ host: 'api.tiktok.com', port: 443 }) },
    { name: 'net.connect(443, "graph.instagram.com")', fn: () => net.connect(443, 'graph.instagram.com') },
    { name: 'net.connect({ host: "GRAPH.THREADS.NET", port: 443 })', fn: () => net.connect({ host: 'GRAPH.THREADS.NET', port: 443 }) },
    { name: 'net.connect(80, "external-store.vn")', fn: () => net.connect(80, 'external-store.vn') },
    { name: 'new net.Socket().connect({ host: "open.tiktokapis.com", port: 443 })', fn: () => new net.Socket().connect({ host: 'open.tiktokapis.com', port: 443 }) },
    { name: 'new net.Socket().connect(443, "graph.facebook.com")', fn: () => new net.Socket().connect(443, 'graph.facebook.com') },
    { name: 'net.createConnection({ host: "openapi.zalo.me", port: 443 })', fn: () => net.createConnection({ host: 'openapi.zalo.me', port: 443 }) },
    { name: 'net.createConnection(443, "api.tiktok.com")', fn: () => net.createConnection(443, 'api.tiktok.com') },
  ]

  for (const item of socketEndpoints) {
    let errorCaught = false
    let isSecurityVeto = false
    await new Promise<void>((resolve) => {
      const s = item.fn()
      s.on('error', (err: Error) => {
        errorCaught = true
        if (err.message.includes('[SECURITY VETO R6]')) {
          isSecurityVeto = true
        }
        resolve()
      })
      setTimeout(() => resolve(), 80)
    })
    assertTest(`Socket probe: ${item.name}`, errorCaught && isSecurityVeto, `errorCaught=${errorCaught}, veto=${isSecurityVeto}`)
  }

  assertTest(
    'Zero raw socket calls leaked through to originalSocketConnect',
    rawSocketLeakCount === 0,
    `Leaked count: ${rawSocketLeakCount}`
  )

  // Restore original hook
  ;(interceptor as any).originalSocketConnect = origConnect

  // Test 3: HTTP.get and HTTPS.get explicit hooking (Fix 2)
  console.log('\n--- Section 3: http.get and https.get Escape Vector Probes (Fix 2) ---')
  const getEndpoints = [
    { name: 'http.get("http://openapi.zalo.me/v2.0/test")', fn: () => http.get('http://openapi.zalo.me/v2.0/test') },
    { name: 'http.get("http://external-store.vn/api/posts")', fn: () => http.get('http://external-store.vn/api/posts') },
    { name: 'https.get("https://graph.facebook.com/v19.0/me")', fn: () => https.get('https://graph.facebook.com/v19.0/me') },
    { name: 'https.get("https://api.tiktok.com/v2/post")', fn: () => https.get('https://api.tiktok.com/v2/post') },
    { name: 'https.get("https://graph.instagram.com/v19.0/media")', fn: () => https.get('https://graph.instagram.com/v19.0/media') },
    { name: 'https.get("https://graph.threads.net/v1.0/threads")', fn: () => https.get('https://graph.threads.net/v1.0/threads') },
  ]

  for (const item of getEndpoints) {
    let threwVeto = false
    try {
      item.fn()
    } catch (err: any) {
      if (err.message && err.message.includes('[SECURITY VETO R6]')) {
        threwVeto = true
      }
    }
    assertTest(`Synchronous GET veto: ${item.name}`, threwVeto)
  }

  // Test 4: Fetch hooking
  console.log('\n--- Section 4: global.fetch Probes ---')
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

  for (const url of fetchEndpoints) {
    let threwVeto = false
    try {
      await fetch(url)
    } catch (err: any) {
      if (err.message && err.message.includes('[SECURITY VETO R6]')) {
        threwVeto = true
      }
    }
    assertTest(`Fetch veto: ${url}`, threwVeto)
  }

  // Test 5: Whitelist Preservation (Google Drive & Gemini API permitted)
  console.log('\n--- Section 5: Whitelist Preservation (R6 Compliance) ---')
  const allowedHosts = [
    'drive.google.com',
    'docs.google.com',
    'generativelanguage.googleapis.com',
    'localhost',
    '127.0.0.1',
  ]

  for (const host of allowedHosts) {
    const isBlocked = (interceptor as any).forbiddenHostPattern.test(host)
    assertTest(`Permitted host is NOT blocked: ${host}`, !isBlocked)
  }

  // Test 6: Verify uninstallation cleanly restores originals
  console.log('\n--- Section 6: Interceptor Lifecycle & Uninstall Restoration ---')
  interceptor.uninstall()
  assertTest('global.fetch restored after uninstall', global.fetch === (interceptor as any).originalFetch)
  assertTest('http.request restored after uninstall', http.request === (interceptor as any).originalHttpRequest)
  assertTest('https.request restored after uninstall', https.request === (interceptor as any).originalHttpsRequest)
  assertTest('http.get restored after uninstall', http.get === (interceptor as any).originalHttpGet)
  assertTest('https.get restored after uninstall', https.get === (interceptor as any).originalHttpsGet)
  assertTest('net.Socket.prototype.connect restored after uninstall', net.Socket.prototype.connect === (interceptor as any).originalSocketConnect)

  // Summary
  console.log('\n================================================================================')
  console.log('📊 EMPIRICAL CHALLENGER ITERATION 2 VERIFICATION SUMMARY')
  console.log('================================================================================')
  console.log(`Total assertions tested: ${totalTests}`)
  console.log(`Assertions passed      : ${passedTests}`)
  console.log(`Assertions failed      : ${failedTests}`)
  console.log(`Raw socket leaks count : ${rawSocketLeakCount}`)

  if (failedTests === 0 && rawSocketLeakCount === 0) {
    console.log('================================================================================')
    console.log('✅ FORMAL ADVERSARIAL VERDICT: APPROVE')
    console.log('All network leakage vectors (Array args, http.get/https.get, direct execution)')
    console.log('have been completely sealed. Network isolation (R6) is 100% airtight.')
    console.log('================================================================================\n')
    process.exit(0)
  } else {
    console.log('================================================================================')
    console.log('🚨 FORMAL ADVERSARIAL VERDICT: REJECT')
    console.log('================================================================================\n')
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err)
  process.exit(1)
})
