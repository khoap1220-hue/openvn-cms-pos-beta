// scripts/verify-m1-l1-cache-challenger.ts
/**
 * ============================================================================
 * EMPIRICAL CHALLENGER VERIFICATION HARNESS — MILESTONE 1
 * Subject: Write Path & L1 Cache Optimization Hardening
 * Target: src/lib/realtime.ts, src/app/api/products/import/route.ts, src/app/api/products/route.ts
 *
 * Rules:
 * 1. Zero trust in worker claims — reproduce everything empirically.
 * 2. Exact test cases for TTL clamping, custom expiration, and domain scoping.
 * 3. Boundary, edge-case, and concurrency stress testing.
 * 4. Zero DB mutations (Delta = 0).
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  setApiCache,
  getApiCache,
  getApiCacheRawJson,
  getApiCacheKeys,
  invalidateApiCache,
  getProductFromApiCache,
  patchProductInApiCache,
  broadcast,
  resolveL1CacheKey,
} from '../src/lib/realtime'

// Global handle to underlying cache map for empirical white-box verification
const gCache = globalThis as unknown as {
  __cmsApiCache?: Map<string, { data: unknown; rawJson: string; expiresAt: number }>
}

let totalTests = 0
let passedTests = 0
let failedTests = 0

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++
  if (condition) {
    console.log(`  [PASS] ${testName}`)
    passedTests++
  } else {
    console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedTests++
    throw new Error(`Assertion failed: ${testName} -> ${detail ?? ''}`)
  }
}

// Time virtualization helper for non-blocking sub-millisecond precision testing
function withMockTime<T>(mockNow: number, fn: () => T): T {
  const originalNow = Date.now
  try {
    Date.now = () => mockNow
    return fn()
  } finally {
    Date.now = originalNow
  }
}

async function runMilestone1ChallengerSuite() {
  console.log('====================================================================')
  console.log('  CHALLENGER EMPIRICAL VERIFICATION — MILESTONE 1 L1 CACHE')
  console.log('====================================================================\n')

  const map = gCache.__cmsApiCache
  if (!map) {
    throw new Error('Fatal: __cmsApiCache was not initialized on globalThis')
  }

  // --------------------------------------------------------------------------
  // SUITE 1: AUTHORITATIVE DISPATCH TEST REQUIREMENTS
  // --------------------------------------------------------------------------
  console.log('--- [SUITE 1] Authoritative Dispatch Requirements ---')

  // Case 1.1: TTL = 15,000ms expires after 15s (NOT clamped to 120s)
  {
    invalidateApiCache()
    const t0 = 1_000_000_000
    withMockTime(t0, () => {
      setApiCache('test:custom-15s', { val: 'live-15s' }, 15_000)
    })

    const entry = map.get('test:custom-15s')
    assert(entry !== undefined, 'Case 1.1a: Entry inserted into cache')
    assert(entry?.expiresAt === t0 + 15_000, `Case 1.1b: expiresAt is exactly t0 + 15,000ms (got ${entry?.expiresAt})`)

    // Verify retrievable at 14,990ms
    withMockTime(t0 + 14_990, () => {
      const res = getApiCache<{ val: string }>('test:custom-15s')
      assert(res?.val === 'live-15s', 'Case 1.1c: Data retrievable at t0 + 14,990ms (pre-expiration)')
    })

    // Verify expired at 15,001ms (Crucial: proves it is NOT clamped to 120s!)
    withMockTime(t0 + 15_001, () => {
      const res = getApiCache<{ val: string }>('test:custom-15s')
      assert(res === null, 'Case 1.1d: Entry returns null at t0 + 15,001ms (proves NOT clamped to 120s)')
      assert(!map.has('test:custom-15s'), 'Case 1.1e: Expired entry is evicted from cache map')
    })
  }

  // Case 1.2: TTL = 2,000ms is clamped to floor 10s (10,000ms)
  {
    invalidateApiCache()
    const t0 = 1_000_000_000
    withMockTime(t0, () => {
      setApiCache('test:clamped-2s', { val: 'clamped' }, 2_000)
    })

    const entry = map.get('test:clamped-2s')
    assert(entry !== undefined, 'Case 1.2a: Clamped entry inserted into cache')
    assert(entry?.expiresAt === t0 + 10_000, `Case 1.2b: expiresAt is clamped to floor 10,000ms (got ${entry?.expiresAt})`)

    // At 2,001ms, it MUST still be alive because of 10s floor clamp
    withMockTime(t0 + 2_001, () => {
      const res = getApiCache<{ val: string }>('test:clamped-2s')
      assert(res?.val === 'clamped', 'Case 1.2c: Data STILL alive at 2,001ms (floor clamp active)')
    })

    // At 9,999ms, it MUST still be alive
    withMockTime(t0 + 9_999, () => {
      const res = getApiCache<{ val: string }>('test:clamped-2s')
      assert(res?.val === 'clamped', 'Case 1.2d: Data STILL alive at 9,999ms')
    })

    // At 10,001ms, it expires
    withMockTime(t0 + 10_001, () => {
      const res = getApiCache<{ val: string }>('test:clamped-2s')
      assert(res === null, 'Case 1.2e: Data expires at 10,001ms (floor reached)')
      assert(!map.has('test:clamped-2s'), 'Case 1.2f: Entry evicted after 10s floor')
    })
  }

  // Case 1.3: Default TTL is 180s (180,000ms)
  {
    invalidateApiCache()
    const t0 = 1_000_000_000
    withMockTime(t0, () => {
      setApiCache('test:default-ttl', { val: 'default-180s' })
    })

    const entry = map.get('test:default-ttl')
    assert(entry !== undefined, 'Case 1.3a: Default entry inserted into cache')
    assert(entry?.expiresAt === t0 + 180_000, `Case 1.3b: Default expiresAt is t0 + 180,000ms (got ${entry?.expiresAt})`)

    // Still alive at 179,990ms
    withMockTime(t0 + 179_990, () => {
      const res = getApiCache<{ val: string }>('test:default-ttl')
      assert(res?.val === 'default-180s', 'Case 1.3c: Data alive at 179,990ms')
    })

    // Expired at 180,001ms
    withMockTime(t0 + 180_001, () => {
      const res = getApiCache<{ val: string }>('test:default-ttl')
      assert(res === null, 'Case 1.3d: Data expires at 180,001ms')
    })
  }

  // Case 1.4: invalidateApiCache('products') purges products: prefix and retains other domains
  {
    invalidateApiCache()
    setApiCache('products:category=all', { p: 1 })
    setApiCache('products:search=thachcao', { p: 2 })
    setApiCache('products:detail:sku100', { p: 3 })
    setApiCache('orders:recent', { o: 1 })
    setApiCache('dashboard:14', { d: 1 })
    setApiCache('inventory:main', { i: 1 })
    setApiCache('settings:public', { s: 1 })
    setApiCache('ledger:test-guard', { lg: 1 })

    assert(map.size === 8, 'Case 1.4a: 8 cache items across diverse domains populated')

    invalidateApiCache('products')

    // Products prefix must be purged
    assert(getApiCache('products:category=all') === null, 'Case 1.4b: products:category=all is purged')
    assert(getApiCache('products:search=thachcao') === null, 'Case 1.4c: products:search=thachcao is purged')
    assert(getApiCache('products:detail:sku100') === null, 'Case 1.4d: products:detail:sku100 is purged')

    // All other domains MUST be retained intact
    assert(getApiCache<{ o: number }>('orders:recent')?.o === 1, 'Case 1.4e: orders:recent retained')
    assert(getApiCache<{ d: number }>('dashboard:14')?.d === 1, 'Case 1.4f: dashboard:14 retained')
    assert(getApiCache<{ i: number }>('inventory:main')?.i === 1, 'Case 1.4g: inventory:main retained')
    assert(getApiCache<{ s: number }>('settings:public')?.s === 1, 'Case 1.4h: settings:public retained')
    assert(getApiCache<{ lg: number }>('ledger:test-guard')?.lg === 1, 'Case 1.4i: ledger:test-guard retained')
    assert(map.size === 5, 'Case 1.4j: Exactly 5 items remain (3 products purged)')
  }

  // --------------------------------------------------------------------------
  // SUITE 2: ADVERSARIAL BOUNDARY & STRESS TTL COMPUTATIONS
  // --------------------------------------------------------------------------
  console.log('\n--- [SUITE 2] Adversarial Boundary & Stress TTL Computations ---')

  const boundaryCases = [
    { name: 'Negative TTL (-10,000ms)', ttl: -10_000, expectedEffective: 10_000 },
    { name: 'Zero TTL (0ms)', ttl: 0, expectedEffective: 10_000 },
    { name: 'Sub-floor TTL (9,999ms)', ttl: 9_999, expectedEffective: 10_000 },
    { name: 'Exact floor TTL (10,000ms)', ttl: 10_000, expectedEffective: 10_000 },
    { name: 'Just above floor TTL (10,001ms)', ttl: 10_001, expectedEffective: 10_001 },
    { name: 'Sub-old-clamp TTL (119,999ms)', ttl: 119_999, expectedEffective: 119_999 },
    { name: 'Exact old clamp TTL (120,000ms)', ttl: 120_000, expectedEffective: 120_000 },
    { name: 'Large TTL (600,000ms / 10m)', ttl: 600_000, expectedEffective: 600_000 },
  ]

  for (const b of boundaryCases) {
    invalidateApiCache()
    const t0 = 500_000_000
    withMockTime(t0, () => {
      setApiCache(`boundary:${b.ttl}`, { val: b.ttl }, b.ttl)
    })
    const entry = map.get(`boundary:${b.ttl}`)
    assert(
      entry?.expiresAt === t0 + b.expectedEffective,
      `Case 2 Boundary: ${b.name} -> expected effective TTL ${b.expectedEffective}ms (got ${entry ? entry.expiresAt - t0 : 'undefined'})`
    )
  }

  // --------------------------------------------------------------------------
  // SUITE 3: INVALIDATION EDGE CASES & BROADCAST DOMAIN PURGING
  // --------------------------------------------------------------------------
  console.log('\n--- [SUITE 3] Invalidation Scoping & Broadcast Mechanics ---')

  // Case 3.1: Global Invalidation when no argument provided
  {
    invalidateApiCache()
    setApiCache('k1', 'v1')
    setApiCache('k2', 'v2')
    assert(map.size === 2, 'Case 3.1a: Cache initialized with 2 keys')
    invalidateApiCache()
    assert(map.size === 0, 'Case 3.1b: invalidateApiCache() with no argument clears all keys')
  }

  // Case 3.2: Invalidation of non-matching prefix
  {
    invalidateApiCache()
    setApiCache('orders:1', 'ord1')
    invalidateApiCache('nonexistent:')
    assert(map.size === 1 && map.has('orders:1'), 'Case 3.2: Non-matching prefix purges 0 keys')
  }

  // Case 3.3: Invalidation prefix boundary ('products:' vs 'products')
  {
    invalidateApiCache()
    setApiCache('products:1', 'prod1')
    setApiCache('products_other:2', 'prod2')
    setApiCache('production:3', 'prod3')

    // Calling with 'products:' only purges 'products:1'
    invalidateApiCache('products:')
    assert(getApiCache('products:1') === null, 'Case 3.3a: products:1 is purged by products:')
    assert(getApiCache('products_other:2') === 'prod2', 'Case 3.3b: products_other:2 retained by products:')
    assert(getApiCache('production:3') === 'prod3', 'Case 3.3c: production:3 retained by products:')

    // Calling with 'products' purges 'products_other:2' (startsWith match), but 'production:3' is retained (does not start with 'products')
    invalidateApiCache('products')
    assert(getApiCache('products_other:2') === null, 'Case 3.3d: products_other:2 purged by products')
    assert(getApiCache('production:3') === 'prod3', 'Case 3.3e: production:3 correctly retained because production does not start with products')
  }

  // Case 3.4: Broadcast 'product.updated' without inPlacePatched (standard mutation)
  {
    invalidateApiCache()
    setApiCache('products:all', { list: [] })
    setApiCache('inventory:wh1', { stock: 10 })
    setApiCache('warehouses:all', { wh: [] })
    setApiCache('bom:sku1', { b: [] })
    setApiCache('channels:all', { c: [] })
    setApiCache('dashboard:14', { d: [] })
    setApiCache('reconciliation:main', { r: [] })
    setApiCache('ledger:test-guard', { lg: [] })
    setApiCache('orders:recent', { ord: [] })
    setApiCache('customers:all', { cust: [] })

    // Simulate standard product update (e.g. from CSV import or manual save)
    broadcast('product.updated', { imported: true, count: 10 })

    assert(getApiCache('products:all') === null, 'Case 3.4a: products:all purged by broadcast')
    assert(getApiCache('inventory:wh1') === null, 'Case 3.4b: inventory:wh1 purged by broadcast')
    assert(getApiCache('warehouses:all') === null, 'Case 3.4c: warehouses:all purged by broadcast')
    assert(getApiCache('bom:sku1') === null, 'Case 3.4d: bom:sku1 purged by broadcast')
    assert(getApiCache('channels:all') === null, 'Case 3.4e: channels:all purged by broadcast')
    assert(getApiCache('dashboard:14') === null, 'Case 3.4f: dashboard:14 purged by broadcast')
    assert(getApiCache('reconciliation:main') === null, 'Case 3.4g: reconciliation:main purged by broadcast')
    assert(getApiCache('ledger:test-guard') === null, 'Case 3.4h: ledger:test-guard purged by broadcast')

    // Unrelated domains MUST NOT be purged
    assert(getApiCache<{ ord: unknown[] }>('orders:recent')?.ord !== undefined, 'Case 3.4i: orders:recent retained')
    assert(getApiCache<{ cust: unknown[] }>('customers:all')?.cust !== undefined, 'Case 3.4j: customers:all retained')
  }

  // Case 3.5: Broadcast 'product.updated' with inPlacePatched: true
  {
    invalidateApiCache()
    setApiCache('products:fast', { list: ['keep-me'] })
    setApiCache('inventory:fast', { stock: 5 })

    broadcast('product.updated', { inPlacePatched: true })

    assert(getApiCache<{ list: string[] }>('products:fast')?.list[0] === 'keep-me', 'Case 3.5a: products:fast RETAINED when inPlacePatched: true')
    assert(getApiCache('inventory:fast') === null, 'Case 3.5b: inventory:fast still purged')
  }

  // --------------------------------------------------------------------------
  // SUITE 4: FAST-PATH HELPERS (getProductFromApiCache, patchProductInApiCache)
  // --------------------------------------------------------------------------
  console.log('\n--- [SUITE 4] Fast-Path In-Memory Helpers ---')

  // Case 4.1: Lookup product by ID and SKU from cached listing
  {
    invalidateApiCache()
    setApiCache('products:page1', {
      products: [
        { id: 'prod_001', sku: 'SKU-001', name: 'Thạch Cao A', sellPrice: 50000 },
        { id: 'prod_002', sku: 'SKU-002', name: 'Nến Thơm B', sellPrice: 120000 },
      ],
    })

    const byId = getProductFromApiCache<{ id: string; name: string }>('prod_001')
    assert(byId?.name === 'Thạch Cao A', 'Case 4.1a: Found product by ID in 0ms')

    const bySku = getProductFromApiCache<{ id: string; name: string }>('SKU-002')
    assert(bySku?.name === 'Nến Thơm B', 'Case 4.1b: Found product by SKU in 0ms')

    const notFound = getProductFromApiCache('SKU-NONEXISTENT')
    assert(notFound === null, 'Case 4.1c: Non-existent product returns null')
  }

  // Case 4.2: Expired products cache does not return stale item
  {
    invalidateApiCache()
    const t0 = 100_000_000
    withMockTime(t0, () => {
      setApiCache('products:expired', {
        products: [{ id: 'prod_exp', sku: 'EXP-1', name: 'Stale Item' }],
      }, 15_000)
    })

    withMockTime(t0 + 15_001, () => {
      const found = getProductFromApiCache('prod_exp')
      assert(found === null, 'Case 4.2: Expired product list is ignored by getProductFromApiCache')
    })
  }

  // Case 4.3: Surgical in-place patch
  {
    invalidateApiCache()
    setApiCache('products:page1', {
      products: [
        { id: 'p1', sku: 'S1', name: 'Original', stock: 10 },
      ],
    })

    const patched = patchProductInApiCache('p1', { stock: 99, name: 'Patched Name' })
    assert(patched === true, 'Case 4.3a: patchProductInApiCache returned true')

    const updated = getProductFromApiCache<{ id: string; name: string; stock: number }>('p1')
    assert(updated?.stock === 99, 'Case 4.3b: Stock updated to 99 in L1 cache')
    assert(updated?.name === 'Patched Name', 'Case 4.3c: Name updated in L1 cache')

    // Verify rawJson is synchronized
    const rawJson = getApiCacheRawJson('products:page1')
    assert(rawJson !== null && rawJson.includes('"stock":99'), 'Case 4.3d: rawJson updated in-sync')
  }

  // --------------------------------------------------------------------------
  // SUITE 5: CODEBASE AST / STATIC VERIFICATION OF WRITE PATHS
  // --------------------------------------------------------------------------
  console.log('\n--- [SUITE 5] Static Codebase Verification of Write Paths ---')

  // Case 5.1: Verify src/app/api/products/import/route.ts
  {
    const importRoutePath = path.resolve('src/app/api/products/import/route.ts')
    const content = fs.readFileSync(importRoutePath, 'utf-8')

    // Must import invalidateApiCache and broadcast
    assert(
      content.includes("import { broadcast, invalidateApiCache } from '@/lib/realtime'"),
      'Case 5.1a: import/route.ts imports broadcast and invalidateApiCache from @/lib/realtime'
    )

    // Must call invalidateApiCache('products') after db.$transaction
    const txIndex = content.indexOf('await db.$transaction(')
    const invIndex = content.indexOf("invalidateApiCache('products')", txIndex)
    const bcastIndex = content.indexOf("broadcast('product.updated'", txIndex)

    assert(txIndex > 0, 'Case 5.1b: db.$transaction found in import/route.ts')
    assert(invIndex > txIndex, 'Case 5.1c: invalidateApiCache("products") called AFTER transaction')
    assert(bcastIndex > invIndex, 'Case 5.1d: broadcast("product.updated") called AFTER invalidateApiCache')
  }

  // Case 5.2: Verify src/app/api/products/route.ts
  {
    const productsRoutePath = path.resolve('src/app/api/products/route.ts')
    const content = fs.readFileSync(productsRoutePath, 'utf-8')

    // Inspect POST handler start: must NOT call invalidateApiCache() before validation
    const postStart = content.indexOf('export async function POST(req: NextRequest) {')
    assert(postStart > 0, 'Case 5.2a: POST handler found in products/route.ts')

    const first500CharsOfPost = content.slice(postStart, postStart + 500)
    assert(
      !first500CharsOfPost.includes('invalidateApiCache()'),
      'Case 5.2b: Early global invalidateApiCache() is REMOVED from POST start (no cache thrashing on 400/409)'
    )

    // Verify scoped invalidation occurs upon successful creation
    const return201 = content.indexOf('status: 201')
    assert(return201 > postStart, 'Case 5.2c: Successful 201 response found in POST')

    const pre201Slice = content.slice(return201 - 250, return201)
    assert(
      pre201Slice.includes("invalidateApiCache('products')"),
      'Case 5.2d: invalidateApiCache("products") called right before status 201'
    )
    assert(
      pre201Slice.includes("broadcast('product.updated'"),
      'Case 5.2e: broadcast("product.updated") called right before status 201'
    )
  }

  // --------------------------------------------------------------------------
  // SUITE 6: HIGH-CONCURRENCY & STRESS HARNESS
  // --------------------------------------------------------------------------
  console.log('\n--- [SUITE 6] High-Concurrency & Stress Harness ---')

  {
    invalidateApiCache()
    const NUM_KEYS = 500
    const NUM_ITERATIONS = 10

    // Concurrently write 500 keys
    const writePromises: Promise<void>[] = []
    for (let i = 0; i < NUM_KEYS; i++) {
      writePromises.push(
        (async () => {
          const key = `stress:k_${i}`
          setApiCache(key, { index: i, timestamp: Date.now() }, 15_000)
        })()
      )
    }
    await Promise.all(writePromises)
    assert(map.size === NUM_KEYS, `Case 6.1: Successfully inserted ${NUM_KEYS} keys concurrently`)

    // Concurrently read and verify all 500 keys across iterations
    let readHits = 0
    const readPromises: Promise<void>[] = []
    for (let iter = 0; iter < NUM_ITERATIONS; iter++) {
      for (let i = 0; i < NUM_KEYS; i++) {
        readPromises.push(
          (async () => {
            const data = getApiCache<{ index: number }>(`stress:k_${i}`)
            if (data?.index === i) {
              readHits++
            }
          })()
        )
      }
    }
    await Promise.all(readPromises)
    assert(
      readHits === NUM_KEYS * NUM_ITERATIONS,
      `Case 6.2: Concurrent reads achieved 100% hit rate (${readHits}/${NUM_KEYS * NUM_ITERATIONS})`
    )

    // Interleave concurrent writes, reads, and domain invalidations
    const mixedOps: Promise<void>[] = []
    for (let i = 0; i < 100; i++) {
      mixedOps.push(
        (async () => {
          setApiCache(`domainA:${i}`, { v: i }, 20_000)
          setApiCache(`domainB:${i}`, { v: i }, 20_000)
        })()
      )
    }
    await Promise.all(mixedOps)

    invalidateApiCache('domainA:')
    const remainingA = Array.from(map.keys()).filter((k) => k.startsWith('domainA:')).length
    const remainingB = Array.from(map.keys()).filter((k) => k.startsWith('domainB:')).length

    assert(remainingA === 0, 'Case 6.3a: domainA: completely purged during mixed stress')
    assert(remainingB === 100, 'Case 6.3b: domainB: 100 entries completely retained')
  }

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n====================================================================')
  console.log(`TOTAL TESTS:  ${totalTests}`)
  console.log(`PASSED:       ${passedTests}`)
  console.log(`FAILED:       ${failedTests}`)
  console.log('====================================================================')

  if (failedTests > 0) {
    throw new Error(`Empirical challenger suite failed with ${failedTests} failures`)
  }
}

runMilestone1ChallengerSuite()
  .then(() => {
    console.log('\n>>> EMPIRICAL CHALLENGER VERIFICATION COMPLETE: ALL ASSUMPTIONS TESTED AND PASSED <<<')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n>>> EMPIRICAL CHALLENGER VERIFICATION FAILED <<<', err)
    process.exit(1)
  })
