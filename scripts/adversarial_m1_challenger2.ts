/**
 * scripts/adversarial_m1_challenger2.ts
 *
 * Empirical Adversarial Stress Test Suite for Milestone 1 (M1: Write Path & L1 Cache Optimization Hardening)
 * Evaluates:
 * - High-throughput concurrent cache operations (setApiCache, getApiCache, invalidateApiCache)
 * - Map integrity, domain isolation, and absence of race conditions / corruption
 * - Boundary TTL calculations and sanitization
 * - In-place patch concurrency
 * - Edge input handling on POST /api/products/import
 * - Edge input handling on POST /api/products
 * - Cache retention invariant on validation failures (FEAT-WRT-02)
 * - Scoped invalidation on broadcast (FEAT-WRT-01, FEAT-WRT-03)
 */

import { NextRequest } from 'next/server'
import {
  setApiCache,
  getApiCache,
  getApiCacheKeys,
  invalidateApiCache,
  getProductFromApiCache,
  patchProductInApiCache,
  broadcast,
} from '../src/lib/realtime'
import { validateProductCsv } from '../src/lib/csv-helper'
import { POST as importPost } from '../src/app/api/products/import/route'
import { POST as productPost } from '../src/app/api/products/route'

let passedTests = 0
let failedTests = 0
const failures: string[] = []

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`)
    passedTests++
  } else {
    const msg = `❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`
    console.error(`  ${msg}`)
    failures.push(msg)
    failedTests++
  }
}

async function runSuite1_CacheConcurrencyAndIntegrity() {
  console.log('\n================================================================================')
  console.log('⚡ SUITE 1: RAPID CONCURRENT CACHE STRESS TEST & MAP INTEGRITY')
  console.log('================================================================================')

  // Clean state
  invalidateApiCache()
  assert(getApiCacheKeys().length === 0, '1.0: Cache starts completely clean')

  // 1.1: Rapid concurrent writes across multiple domains (50,000 total operations)
  const CONCURRENT_OPS = 50_000
  const domains = ['products', 'orders', 'dashboard', 'inventory', 'settings']
  const startTime = Date.now()

  const writePromises: Promise<void>[] = []
  for (let i = 0; i < CONCURRENT_OPS; i++) {
    const domain = domains[i % domains.length]
    const key = `${domain}:key_${i}`
    const payload = { id: i, domain, timestamp: startTime + i }
    writePromises.push(
      (async () => {
        setApiCache(key, payload, 30_000)
      })()
    )
  }

  await Promise.all(writePromises)
  const durationWritesMs = Date.now() - startTime
  console.log(`  ℹ️ Completed ${CONCURRENT_OPS} concurrent setApiCache writes in ${durationWritesMs}ms`)

  assert(
    getApiCacheKeys().length === CONCURRENT_OPS,
    '1.1: Map holds exactly 50,000 entries without loss or key corruption'
  )

  // 1.2: Concurrent reads during active map access
  let successfulReads = 0
  const readPromises: Promise<void>[] = []
  for (let i = 0; i < 10_000; i++) {
    const key = `orders:key_${i * 5 + 1}`
    readPromises.push(
      (async () => {
        const val = getApiCache<{ id: number; domain: string }>(key)
        if (val && val.domain === 'orders') successfulReads++
      })()
    )
  }
  await Promise.all(readPromises)
  assert(successfulReads === 10_000, '1.2: Concurrent reads retrieved 10,000 correct entries')

  // 1.3: Concurrent interleaved invalidations while writes are actively occurring
  const interleavedPromises: Promise<void>[] = []
  for (let i = 0; i < 5_000; i++) {
    interleavedPromises.push(
      (async () => {
        setApiCache(`products:extra_${i}`, { extra: i }, 20_000)
      })()
    )
  }
  interleavedPromises.push(
    (async () => {
      invalidateApiCache('orders')
    })()
  )
  for (let i = 0; i < 2_000; i++) {
    interleavedPromises.push(
      (async () => {
        setApiCache(`dashboard:extra_${i}`, { stat: i }, 15_000)
      })()
    )
  }

  await Promise.all(interleavedPromises)

  const remainingKeys = getApiCacheKeys()
  const ordersRemaining = remainingKeys.filter((k) => k.startsWith('orders:'))
  const dashboardRemaining = remainingKeys.filter((k) => k.startsWith('dashboard:'))
  const settingsRemaining = remainingKeys.filter((k) => k.startsWith('settings:'))

  assert(ordersRemaining.length === 0, '1.3a: invalidateApiCache("orders") purged all orders keys')
  assert(dashboardRemaining.length > 0, '1.3b: dashboard keys preserved during interleaved operations')
  assert(settingsRemaining.length === 10_000, '1.3c: settings keys completely untouched (10,000 entries)')

  // 1.4: Invalidate 'products' domain explicitly
  invalidateApiCache('products')
  const productsAfter = getApiCacheKeys().filter((k) => k.startsWith('products:'))
  assert(productsAfter.length === 0, '1.4: invalidateApiCache("products") purged all product keys')

  // 1.5: Adversarial key formats and extreme inputs
  const adversarialKeys = [
    '', // empty string
    'products:special:.*+?^${}()|[]\\', // regex metacharacters
    'products:nến_bơ_thạch_cao_2026_🔥_tiếng_việt', // unicode & emoji
    'a'.repeat(50_000), // massive 50k key
    'products:null_byte\0test', // null byte
  ]

  for (const advKey of adversarialKeys) {
    setApiCache(advKey, { adv: true, keyLen: advKey.length }, 15_000)
    const readBack = getApiCache<{ adv: boolean }>(advKey)
    assert(readBack?.adv === true, `1.5: Adversarial key handled cleanly: len=${advKey.length}`)
  }

  invalidateApiCache('products:special:')
  assert(
    getApiCache('products:special:.*+?^${}()|[]\\') === null,
    '1.5b: Substring prefix matching handles regex special characters safely'
  )

  // 1.6: Boundary TTL verification (FEAT-WRT-03 hardening)
  const g = (globalThis as unknown as { __cmsApiCache: Map<string, { expiresAt: number }> }).__cmsApiCache
  const tNow = Date.now()

  setApiCache('ttl:caller_15s', { val: 1 }, 15_000)
  setApiCache('ttl:caller_45s', { val: 1 }, 45_000)
  setApiCache('ttl:caller_default', { val: 1 })
  setApiCache('ttl:caller_zero', { val: 1 }, 0)
  setApiCache('ttl:caller_neg', { val: 1 }, -5_000)
  setApiCache('ttl:caller_small', { val: 1 }, 5_000)

  const e15 = g.get('ttl:caller_15s')!.expiresAt - tNow
  const e45 = g.get('ttl:caller_45s')!.expiresAt - tNow
  const eDef = g.get('ttl:caller_default')!.expiresAt - tNow
  const eZero = g.get('ttl:caller_zero')!.expiresAt - tNow
  const eNeg = g.get('ttl:caller_neg')!.expiresAt - tNow
  const eSmall = g.get('ttl:caller_small')!.expiresAt - tNow

  assert(e15 >= 14_900 && e15 <= 15_500, `1.6a: TTL 15s respected (${e15}ms)`)
  assert(e45 >= 44_900 && e45 <= 45_500, `1.6b: TTL 45s respected (${e45}ms)`)
  assert(eDef >= 179_900 && eDef <= 180_500, `1.6c: Default TTL 180s respected (${eDef}ms)`)
  assert(eZero >= 9_900 && eZero <= 10_500, `1.6d: Zero TTL clamped to safe floor 10s (${eZero}ms)`)
  assert(eNeg >= 9_900 && eNeg <= 10_500, `1.6e: Negative TTL clamped to safe floor 10s (${eNeg}ms)`)
  assert(eSmall >= 9_900 && eSmall <= 10_500, `1.6f: 5s TTL clamped to safe floor 10s (${eSmall}ms)`)

  // 1.7: Surgical In-Place Patch Concurrency
  invalidateApiCache()
  setApiCache('products:query1', {
    products: [
      { id: 'p1', sku: 'SKU-01', name: 'Sản phẩm 1', stock: 10 },
      { id: 'p2', sku: 'SKU-02', name: 'Sản phẩm 2', stock: 20 },
    ],
  })
  setApiCache('products:query2', {
    products: [
      { id: 'p1', sku: 'SKU-01', name: 'Sản phẩm 1', stock: 10 },
      { id: 'p3', sku: 'SKU-03', name: 'Sản phẩm 3', stock: 30 },
    ],
  })

  const p1Found = getProductFromApiCache<{ name: string; stock: number }>('p1')
  assert(p1Found?.name === 'Sản phẩm 1', '1.7a: getProductFromApiCache finds item by ID')
  const p2BySku = getProductFromApiCache<{ name: string; stock: number }>('SKU-02')
  assert(p2BySku?.stock === 20, '1.7b: getProductFromApiCache finds item by SKU')

  const patchResult = patchProductInApiCache('p1', { stock: 99, name: 'Sản phẩm 1 Đã Vá' })
  assert(patchResult === true, '1.7c: patchProductInApiCache returned true')

  const q1After = getApiCache<{ products: Array<{ id: string; stock: number; name: string }> }>('products:query1')
  const q2After = getApiCache<{ products: Array<{ id: string; stock: number; name: string }> }>('products:query2')
  assert(q1After?.products[0]?.stock === 99, '1.7d: Surgical patch updated query1 in-place')
  assert(q2After?.products[0]?.stock === 99, '1.7e: Surgical patch updated query2 in-place')
}

async function runSuite2_CsvImportRouteStress() {
  console.log('\n================================================================================')
  console.log('📄 SUITE 2: CSV IMPORT ROUTE (`/api/products/import`) EDGE INPUT STRESS')
  console.log('================================================================================')

  // Setup cache to verify whether it gets accidentally invalidated on failure
  invalidateApiCache()
  setApiCache('products:snapshot', { safe: true })
  setApiCache('orders:snapshot', { safe: true })

  // 2.1: Empty body
  const reqEmpty = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: '' }),
  })
  const resEmpty = await importPost(reqEmpty)
  const jsonEmpty = await resEmpty.json()
  assert(resEmpty.status === 422, '2.1a: Empty CSV returns 422')
  assert(jsonEmpty.errors?.[0]?.message.includes('không có nội dung'), '2.1b: Accurate error message on empty CSV')
  assert(getApiCache('products:snapshot') !== null, '2.1c: Cache invariant: L1 cache retained on 422 empty body')

  // 2.2: Whitespace only
  const reqWs = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: '   \r\n   \t  \n  ' }),
  })
  const resWs = await importPost(reqWs)
  assert(resWs.status === 422, '2.2: Whitespace-only CSV returns 422')

  // 2.3: Empirical Detection of Stream Consumption Flaw on text/csv body
  // When a non-JSON body is sent without multipart, route attempts req.json() then in catch attempts req.text().
  // In Web Request API, body stream is already consumed by req.json(), resulting in TypeError: Body is unusable.
  const reqRawCsv = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'text/csv' },
    body: 'sku,name,costPrice,sellPrice,stock\nTEST-01,Test,10,20,5',
  })
  const resRawCsv = await importPost(reqRawCsv)
  const jsonRawCsv = await resRawCsv.json()
  assert(
    resRawCsv.status === 500 && jsonRawCsv.errors?.[0]?.field === 'system',
    '2.3: Empirical Finding CONFIRMED: raw text/csv causes Body is unusable (HTTP 500 pre-existing bug)'
  )

  // 2.4: Missing mandatory header columns
  const reqBadHeader = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: 'sku,name,stock\nSKU-01,Test Product,10' }),
  })
  const resBadHeader = await importPost(reqBadHeader)
  const jsonBadHeader = await resBadHeader.json()
  assert(resBadHeader.status === 422, '2.4a: Missing required headers (costPrice, sellPrice) returns 422')
  assert(
    jsonBadHeader.errors?.[0]?.message.includes('Tiêu đề cột thiếu các trường bắt buộc'),
    '2.4b: Descriptive header validation error message'
  )

  // 2.5: Header only, 0 data rows behavior
  // Note: validateProductCsv currently returns { items: [], errors: [] } for header-only CSV,
  // causing the route to execute an empty transaction and return HTTP 200 with processedCount = 0.
  const reqHeaderOnly = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: 'sku,name,costPrice,sellPrice,stock' }),
  })
  const resHeaderOnly = await importPost(reqHeaderOnly)
  const jsonHeaderOnly = await resHeaderOnly.json()
  assert(
    resHeaderOnly.status === 200 && jsonHeaderOnly.processedCount === 0,
    '2.5: Header only CSV produces processedCount: 0 (safe no-op, though triggers 0-item invalidation)'
  )

  // 2.6: Multi-error line-by-line reporting
  const invalidMultiCsv = `sku,name,costPrice,sellPrice,stock,type
,Sản Phẩm Không SKU,10000,20000,5,SIMPLE
SKU-NEG-SELL,Sản Phẩm Giá Âm,10000,-50000,5,SIMPLE
SKU-NEG-COST,Sản Phẩm Giá Vốn Âm,-10000,50000,5,SIMPLE
SKU-BAD-TYPE,Sản Phẩm Sai Type,10000,50000,5,BOGUS_TYPE
SKU-NO-NAME,,10000,50000,5,SIMPLE`

  const reqMulti = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: invalidMultiCsv }),
  })
  const resMulti = await importPost(reqMulti)
  const jsonMulti = await resMulti.json()
  assert(resMulti.status === 422, '2.6a: Multi-error CSV returns 422')
  assert(jsonMulti.totalErrors === 5, `2.6b: Exactly 5 errors reported (received ${jsonMulti.totalErrors})`)
  assert(jsonMulti.errors.length === 5, '2.6c: Detailed errors array contains 5 items')

  // 2.7: RFC 4180 complex CSV parsing (BOM, quotes in quotes, commas in values, CRLF)
  const complexCsv = `\uFEFF"sku","name","costPrice","sellPrice","stock","unit","type"
"SKU-Q1","Hũ Sen ""Đặc Biệt"", Size L",50000,100000,15,"hũ","SIMPLE"
"SKU-Q2","Nến Thơm, Hương Trầm & Quế",35000,75000,20,"hộp","SIMPLE"`

  const validated = validateProductCsv(complexCsv)
  assert(validated.errors.length === 0, '2.7a: RFC 4180 complex CSV parsed with 0 errors')
  assert(validated.items.length === 2, '2.7b: Correctly extracted 2 valid items')
  assert(
    validated.items[0]?.name === 'Hũ Sen "Đặc Biệt", Size L',
    '2.7c: Escaped quotes and commas preserved exactly in name'
  )

  // 2.8: Verify cache invariant: On all 422 validation errors, existing cache is retained
  invalidateApiCache()
  setApiCache('products:retain_test', { safe: true })
  setApiCache('orders:retain_test', { safe: true })
  const reqFreshError = new NextRequest('http://localhost:3010/api/products/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ csv: invalidMultiCsv }),
  })
  await importPost(reqFreshError)
  assert(
    getApiCache('products:retain_test') !== null && getApiCache('orders:retain_test') !== null,
    '2.8: Cache Invariant: Pre-existing L1 cache across all domains was 100% retained on 422 rejected imports'
  )
}

async function runSuite3_ProductCreationRouteStress() {
  console.log('\n================================================================================')
  console.log('🛍️ SUITE 3: PRODUCT CREATION ROUTE (`/api/products`) EDGE INPUT & CACHE PRESERVATION')
  console.log('================================================================================')

  // Setup cache entries across multiple domains
  invalidateApiCache()
  setApiCache('products:list', { data: 'old_products' })
  setApiCache('orders:summary', { total: 100 })
  setApiCache('dashboard:14', { revenue: 5000000 })
  setApiCache('settings:public', { shopName: 'OPENVN' })

  // 3.1: Empty JSON body
  const reqEmpty = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  const resEmpty = await productPost(reqEmpty)
  const jsonEmpty = await resEmpty.json()
  assert(resEmpty.status === 400, '3.1a: Empty POST /api/products returns 400')
  assert(jsonEmpty.error.includes('Vui lòng nhập SKU và tên'), '3.1b: Returns correct error message')

  // FEAT-WRT-02 VERIFICATION: Ensure cache is NOT invalidated!
  assert(getApiCache('products:list') !== null, '3.1c [FEAT-WRT-02]: products cache retained on 400')
  assert(getApiCache('orders:summary') !== null, '3.1d [FEAT-WRT-02]: orders cache retained on 400')
  assert(getApiCache('dashboard:14') !== null, '3.1e [FEAT-WRT-02]: dashboard cache retained on 400')
  assert(getApiCache('settings:public') !== null, '3.1f [FEAT-WRT-02]: settings cache retained on 400')

  // 3.2: Missing SKU
  const reqNoSku = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Chân Nến Bơ Mộc', sellPrice: 50000 }),
  })
  const resNoSku = await productPost(reqNoSku)
  assert(resNoSku.status === 400, '3.2: Missing SKU returns 400')

  // 3.3: Whitespace SKU
  const reqWsSku = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: '   ', name: 'Chân Nến Bơ Mộc', sellPrice: 50000 }),
  })
  const resWsSku = await productPost(reqWsSku)
  assert(resWsSku.status === 400, '3.3: Whitespace-only SKU returns 400')

  // 3.4: Missing Name
  const reqNoName = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'TEST-SKU-01', sellPrice: 50000 }),
  })
  const resNoName = await productPost(reqNoName)
  assert(resNoName.status === 400, '3.4: Missing Name returns 400')

  // 3.5: Negative sellPrice
  const reqNegPrice = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'TEST-SKU-01', name: 'Sản phẩm', sellPrice: -100 }),
  })
  const resNegPrice = await productPost(reqNegPrice)
  const jsonNegPrice = await resNegPrice.json()
  assert(resNegPrice.status === 400, '3.5a: Negative sellPrice returns 400')
  assert(jsonNegPrice.error.includes('Giá bán không hợp lệ'), '3.5b: Error message notes invalid price')

  // 3.6: Null sellPrice
  const reqNullPrice = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sku: 'TEST-SKU-01', name: 'Sản phẩm', sellPrice: null }),
  })
  const resNullPrice = await productPost(reqNullPrice)
  assert(resNullPrice.status === 400, '3.6: Null sellPrice returns 400')

  // 3.7: Barcode with non-ASCII or Vietnamese characters
  const reqBadBarcode = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sku: 'TEST-SKU-BAR',
      name: 'Sản phẩm Mã Vạch',
      sellPrice: 50000,
      barcode: 'MÃ-VẠCH-TIẾNG-VIỆT',
    }),
  })
  const resBadBarcode = await productPost(reqBadBarcode)
  const jsonBadBarcode = await resBadBarcode.json()
  assert(resBadBarcode.status === 400, '3.7a: Non-ASCII barcode returns 400')
  assert(
    jsonBadBarcode.error.includes('ASCII in được'),
    '3.7b: Error message notes ASCII requirement for barcode'
  )

  // 3.8: Barcode > 64 chars
  const reqLongBarcode = new NextRequest('http://localhost:3010/api/products', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sku: 'TEST-SKU-BAR65',
      name: 'Sản phẩm Mã Vạch Dài',
      sellPrice: 50000,
      barcode: 'A'.repeat(65),
    }),
  })
  const resLongBarcode = await productPost(reqLongBarcode)
  assert(resLongBarcode.status === 400, '3.8: Barcode > 64 chars returns 400')

  // Final check: confirm that ALL cache domains were preserved across every single failed POST test
  assert(
    getApiCache('products:list') !== null &&
      getApiCache('orders:summary') !== null &&
      getApiCache('dashboard:14') !== null &&
      getApiCache('settings:public') !== null,
    '3.9 [FEAT-WRT-02 Final]: Cache integrity maintained across 100% of rejected requests'
  )
}

async function runSuite4_BroadcastAndScopedInvalidation() {
  console.log('\n================================================================================')
  console.log('📡 SUITE 4: BROADCAST & DOMAIN-SCOPED INVALIDATION VERIFICATION')
  console.log('================================================================================')

  // Populate cache with entries for all domains
  invalidateApiCache()
  setApiCache('products:page1', { p: 1 })
  setApiCache('products:search=nen', { p: 2 })
  setApiCache('inventory:summary', { inv: 10 })
  setApiCache('warehouses:all', { wh: 1 })
  setApiCache('bom:all', { bom: 5 })
  setApiCache('channels:all', { ch: 2 })
  setApiCache('dashboard:14', { rev: 500 })
  setApiCache('reconciliation:main', { rec: 1 })
  setApiCache('ledger:test-guard', { guard: true })
  setApiCache('orders:all', { ord: 50 })
  setApiCache('customers:all', { cust: 20 })
  setApiCache('settings:public', { set: true })
  setApiCache('periods:2026', { per: 2026 })

  // 4.1: Broadcast 'product.updated' (normal update / import)
  broadcast('product.updated', { imported: true, count: 10 })

  // Should be invalidated:
  assert(getApiCache('products:page1') === null, '4.1a: products:page1 invalidated')
  assert(getApiCache('products:search=nen') === null, '4.1b: products:search invalidated')
  assert(getApiCache('inventory:summary') === null, '4.1c: inventory invalidated')
  assert(getApiCache('warehouses:all') === null, '4.1d: warehouses invalidated')
  assert(getApiCache('bom:all') === null, '4.1e: bom invalidated')
  assert(getApiCache('channels:all') === null, '4.1f: channels invalidated')
  assert(getApiCache('dashboard:14') === null, '4.1g: dashboard invalidated')
  assert(getApiCache('reconciliation:main') === null, '4.1h: reconciliation invalidated')
  assert(getApiCache('ledger:test-guard') === null, '4.1i: ledger:test-guard invalidated')

  // Should be PRESERVED (unrelated domains):
  assert(getApiCache('orders:all') !== null, '4.1j: orders domain preserved')
  assert(getApiCache('customers:all') !== null, '4.1k: customers domain preserved')
  assert(getApiCache('settings:public') !== null, '4.1l: settings domain preserved')
  assert(getApiCache('periods:2026') !== null, '4.1m: periods domain preserved')

  // 4.2: Broadcast 'product.updated' with { inPlacePatched: true }
  setApiCache('products:patched', { p: 'keep_me' })
  setApiCache('inventory:summary', { inv: 10 })
  broadcast('product.updated', { inPlacePatched: true })

  assert(getApiCache('products:patched') !== null, '4.2a: inPlacePatched preserves products cache')
  assert(getApiCache('inventory:summary') === null, '4.2b: dependent inventory cache invalidated')
}

async function main() {
  console.log('================================================================================')
  console.log('🔥 EMPIRICAL CHALLENGER ADVERSARIAL STRESS SUITE: MILESTONE 1 🔥')
  console.log('================================================================================')

  const t0 = Date.now()

  try {
    await runSuite1_CacheConcurrencyAndIntegrity()
    await runSuite2_CsvImportRouteStress()
    await runSuite3_ProductCreationRouteStress()
    await runSuite4_BroadcastAndScopedInvalidation()

    const elapsed = Date.now() - t0
    console.log('\n================================================================================')
    console.log(`🏁 TEST RUN SUMMARY (${elapsed}ms)`)
    console.log(`   Passed: ${passedTests}`)
    console.log(`   Failed: ${failedTests}`)
    console.log('================================================================================\n')

    if (failedTests > 0) {
      console.error('❌ Failures encountered:')
      failures.forEach((f) => console.error(`   ${f}`))
      process.exit(1)
    } else {
      console.log('🎉 ALL EMPIRICAL CHALLENGE TESTS PASSED PERFECTLY')
      process.exit(0)
    }
  } catch (err) {
    console.error('💥 Unhandled exception during stress suite:', err)
    process.exit(1)
  }
}

main()
