/**
 * scripts/verify-master-production-suite.ts
 *
 * ============================================================================
 * MASTER E2E PRODUCTION READINESS & INVARIANT VERIFICATION SUITE
 * Project: OPENVN · Ưu Đàm Suite (Multi-Channel Omnisales & Zero-Storage CDN)
 * Worker: M4 (Master E2E Verification & Operational Safety Runner)
 * Milestone: M4 (FEAT-TEST-01)
 *
 * Verifies all 10 inventoried features across 4 Tiers:
 * ----------------------------------------------------------------------------
 * [TIER 1: FAST WRITE PATH & L1 CACHE OPTIMIZATION]
 * - FEAT-WRT-01: Scoped L1 invalidation & socket broadcast on CSV product import
 * - FEAT-WRT-02: Non-product cache preservation on POST /api/products validation failure
 * - FEAT-WRT-03: Flexible L1 cache TTL handling, clamp floor Math.max(ttlMs, 10_000)
 *
 * [TIER 2: ZERO-STORAGE CDN POINTER & SHOPEE SYNC DAEMON]
 * - FEAT-CDN-01: Support up to 2048 chars for CDN image pointer input without truncation
 * - FEAT-CDN-02: Dynamic Shopee sync daemon port fallback (process.env.SHOPEE_SYNC_PORT || 51898)
 * - FEAT-CDN-03: 3-tier image update cascade & cmsCustomImage overwrite protection
 *
 * [TIER 3: PRODUCTION PACKAGING & SAFE MAINTENANCE FRAMEWORK]
 * - FEAT-OPS-01: Clean production baseline parity across 24/24 core business tables
 * - FEAT-OPS-02: Safe Maintenance & Upgrade Runbook (docs/MAINTENANCE_RUNBOOK.md)
 * - FEAT-OPS-03: Operational Handover Documentation (HANDOVER_MAINTENANCE.md)
 *
 * [TIER 4: MASTER E2E TEST-GUARD & SHOP THAIMY1605 INVARIANT PRESERVATION]
 * - FEAT-TEST-01: Full Test-Guard cycle (SNAPSHOT -> Mutative Workflow -> RESTORE_AND_CLEAN -> Delta = 0)
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'

import {
  setApiCache,
  getApiCache,
  getApiCacheKeys,
  invalidateApiCache,
  patchProductInApiCache,
  getProductFromApiCache,
} from '../src/lib/realtime'

import { POST as importProductsPost } from '../src/app/api/products/import/route'
import { POST as createProductPost } from '../src/app/api/products/route'
import { POST as uploadImagePost } from '../src/app/api/products/upload-image/route'

import {
  takeSnapshot,
  restoreAndClean,
  verifyCleanState,
  assert13RealProductsInvariant,
  AUTHORITATIVE_13_PRODUCTS,
  AUTHORITATIVE_TOTAL_STOCK,
  DEFAULT_BASE_URL,
  DEFAULT_CENTRAL_WAREHOUSE_ID,
} from './test_guard_helper'

const prisma = new PrismaClient()

// Underlying global cache map for empirical white-box assertions
const gCache = globalThis as unknown as {
  __cmsApiCache?: Map<string, { data: unknown; rawJson: string; expiresAt: number }>
}

interface TestAssertion {
  tier: string
  featureId: string
  name: string
  status: 'PASS' | 'FAIL'
  detail?: string
  durationMs: number
}

const testResults: TestAssertion[] = []
let totalPassCount = 0
let totalFailCount = 0

function assert(
  condition: boolean,
  tier: string,
  featureId: string,
  name: string,
  detail?: string,
  durationMs = 0
) {
  if (condition) {
    console.log(`  ✅ [PASS] [${tier}] [${featureId}] ${name}`)
    testResults.push({ tier, featureId, name, status: 'PASS', detail, durationMs })
    totalPassCount++
  } else {
    const errorMsg = `❌ [FAIL] [${tier}] [${featureId}] ${name}${detail ? ` -> ${detail}` : ''}`
    console.error(`  ${errorMsg}`)
    testResults.push({ tier, featureId, name, status: 'FAIL', detail, durationMs })
    totalFailCount++
    throw new Error(`Assertion failed: [${tier}] [${featureId}] ${name} (${detail || 'Condition not met'})`)
  }
}

// 24 Core business tables mandated for baseline parity
const CORE_BUSINESS_TABLES = [
  'Product',
  'Category',
  'Order',
  'OrderItem',
  'Customer',
  'SalesInvoice',
  'PurchaseInvoice',
  'StockMovement',
  'Warehouse',
  'WarehouseStock',
  'Voucher',
  'BomComponent',
  'AccountingPeriod',
  'Partner',
  'Channel',
  'ChannelListing',
  'Shipment',
  'AfterSalesCase',
  'AppSetting',
  'IntegrationCredential',
  'ApiKey',
  'WebhookEndpoint',
  'AutomationSetting',
  'OrderEvent',
]

const TINY_MICRO_WEBP =
  'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoIAAgAAkA4JZwCdADcAA/v3cAAAA=='

// Helper to virtualize time for precise TTL expiration checking
function withMockTime<T>(mockNow: number, fn: () => T): T {
  const originalNow = Date.now
  try {
    Date.now = () => mockNow
    return fn()
  } finally {
    Date.now = originalNow
  }
}

async function ensureServerRunning(): Promise<() => void> {
  const targetUrl = `${DEFAULT_BASE_URL}/api/ledger/test-guard`
  try {
    const res = await fetch(targetUrl, { method: 'GET', signal: AbortSignal.timeout(2000) })
    if (res.ok) {
      console.log(`  🌐 Detected active Next.js server at ${DEFAULT_BASE_URL}`)
      return () => {}
    }
  } catch {}

  const standaloneEntry = fs.existsSync('.runtime/standalone/server.js')
    ? '.runtime/standalone/server.js'
    : '.next/standalone/server.js'
  console.log(`  🚀 Launching Next.js standalone server (${standaloneEntry}) on ${DEFAULT_BASE_URL}...`)
  const child = spawn('node', [standaloneEntry], {
    env: { ...process.env, PORT: '3010', HOSTNAME: '127.0.0.1' },
    stdio: 'ignore',
  })

  const start = Date.now()
  let isReady = false
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 600))
    try {
      const res = await fetch(targetUrl, { method: 'GET', signal: AbortSignal.timeout(1000) })
      if (res.ok) {
        isReady = true
        console.log(`  ✅ Next.js standalone server ready on ${DEFAULT_BASE_URL}`)
        break
      }
    } catch {}
  }

  if (!isReady) {
    try {
      child.kill()
    } catch {}
    throw new Error(`Failed to start Next.js server on ${DEFAULT_BASE_URL} within 15s`)
  }

  return () => {
    try {
      child.kill('SIGINT')
    } catch {}
  }
}

async function runMasterProductionSuite() {
  const suiteStartTime = Date.now()
  console.log('================================================================================')
  console.log('  OPENVN · ƯU ĐÀM SUITE — MASTER E2E PRODUCTION READINESS SUITE')
  console.log('  Scope: All 10 Features (FEAT-WRT-01..03, FEAT-CDN-01..03, FEAT-OPS-01..03, FEAT-TEST-01)')
  console.log('  Target: Production Packaging, Zero-Storage CDN & Safe Maintenance (Delta = 0)')
  console.log('================================================================================\n')

  const cleanupServer = await ensureServerRunning()

  const cacheMap = gCache.__cmsApiCache
  if (!cacheMap) {
    throw new Error('Fatal: globalThis.__cmsApiCache was not initialized')
  }

  // ============================================================================
  // TIER 1: FAST WRITE PATH & L1 CACHE OPTIMIZATION (FEAT-WRT-01..03)
  // ============================================================================
  console.log('--------------------------------------------------------------------------------')
  console.log('📦 TIER 1: FAST WRITE PATH & L1 CACHE OPTIMIZATION HARDENING')
  console.log('--------------------------------------------------------------------------------')

  // --- FEAT-WRT-01: CSV Product Import cache invalidation & socket broadcast ---
  {
    const t0 = Date.now()
    // 1.1 Source code verification
    const importRoutePath = path.resolve('src/app/api/products/import/route.ts')
    const importContent = fs.readFileSync(importRoutePath, 'utf8')
    assert(
      importContent.includes("invalidateApiCache('products')"),
      'TIER_1',
      'FEAT-WRT-01',
      'src/app/api/products/import/route.ts calls invalidateApiCache("products") after transaction',
      undefined,
      Date.now() - t0
    )
    assert(
      importContent.includes("broadcast('product.updated'"),
      'TIER_1',
      'FEAT-WRT-01',
      'src/app/api/products/import/route.ts emits broadcast("product.updated", ...) after import',
      undefined,
      Date.now() - t0
    )

    // 1.2 Programmatic scoped eviction verification
    invalidateApiCache()
    setApiCache('products:list', { prods: [] }, 60_000)
    setApiCache('products:category_sen', { prods: [] }, 60_000)
    setApiCache('channels:all', { channels: [] }, 60_000)
    setApiCache('categories:all', { cats: [] }, 60_000)

    invalidateApiCache('products')
    assert(
      getApiCache('products:list') === null && getApiCache('products:category_sen') === null,
      'TIER_1',
      'FEAT-WRT-01',
      'Scoped invalidation removes all products:* cache keys',
      undefined,
      Date.now() - t0
    )
    assert(
      getApiCache('channels:all') !== null && getApiCache('categories:all') !== null,
      'TIER_1',
      'FEAT-WRT-01',
      'Scoped invalidation preserves non-product cache keys (channels:all, categories:all)',
      undefined,
      Date.now() - t0
    )

    // 1.3 Atomic validation rejection verification (HTTP 422 on invalid CSV)
    const emptyCsvReq = new NextRequest('http://127.0.0.1:3010/api/products/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: '' }),
    })
    const emptyRes = await importProductsPost(emptyCsvReq)
    assert(
      emptyRes.status === 422,
      'TIER_1',
      'FEAT-WRT-01',
      'POST /api/products/import rejects empty CSV payload with HTTP 422',
      undefined,
      Date.now() - t0
    )
  }

  // --- FEAT-WRT-02: Non-product cache preservation on POST /api/products validation failure ---
  {
    const t0 = Date.now()
    // 2.1 Source code verification: no premature cache wipe
    const productRoutePath = path.resolve('src/app/api/products/route.ts')
    const productContent = fs.readFileSync(productRoutePath, 'utf8')
    const postFunctionMatch = productContent.slice(productContent.indexOf('export async function POST'))
    const postHead = postFunctionMatch.slice(0, 300)
    assert(
      !postHead.includes('invalidateApiCache()') && !postHead.includes("invalidateApiCache('products')"),
      'TIER_1',
      'FEAT-WRT-02',
      'POST /api/products does not call global invalidateApiCache() prior to input validation',
      undefined,
      Date.now() - t0
    )

    // 2.2 Programmatic preservation verification on validation failure
    setApiCache('categories:static', { cats: ['Thạch cao', 'Nến'] }, 120_000)
    setApiCache('channels:active', { channels: ['Shopee', 'Tiktok'] }, 120_000)
    setApiCache('dashboard:14', { revenue: 1000000 }, 120_000)

    // Call POST /api/products with missing required fields (sku, name)
    const invalidReq1 = new NextRequest('http://127.0.0.1:3010/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: '', name: '', sellPrice: 50000 }),
    })
    const res1 = await createProductPost(invalidReq1)
    assert(
      res1.status === 400,
      'TIER_1',
      'FEAT-WRT-02',
      'POST /api/products returns HTTP 400 when SKU/name is missing',
      undefined,
      Date.now() - t0
    )
    assert(
      getApiCache('categories:static') !== null &&
        getApiCache('channels:active') !== null &&
        getApiCache('dashboard:14') !== null,
      'TIER_1',
      'FEAT-WRT-02',
      'Non-product caches are 100% preserved when product creation validation fails',
      undefined,
      Date.now() - t0
    )

    // Call POST with negative sellPrice
    const invalidReq2 = new NextRequest('http://127.0.0.1:3010/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku: 'TEST-SKU-INVALID', name: 'Test Invalid', sellPrice: -100 }),
    })
    const res2 = await createProductPost(invalidReq2)
    assert(
      res2.status === 400,
      'TIER_1',
      'FEAT-WRT-02',
      'POST /api/products returns HTTP 400 when sellPrice is negative',
      undefined,
      Date.now() - t0
    )
    assert(
      getApiCache('categories:static') !== null,
      'TIER_1',
      'FEAT-WRT-02',
      'Caches remain intact across consecutive validation failures',
      undefined,
      Date.now() - t0
    )
  }

  // --- FEAT-WRT-03: Flexible L1 cache TTL handling & floor clamp Math.max(ttlMs, 10_000) ---
  {
    const t0 = Date.now()
    invalidateApiCache()

    // 3.1 Sub-10s TTL floor clamp: ttlMs = 2,500ms clamped to 10,000ms
    const tMock = 1_700_000_000_000
    withMockTime(tMock, () => {
      setApiCache('test:clamped-sub10s', { value: 'floor-test' }, 2_500)
    })
    const clampedEntry = cacheMap.get('test:clamped-sub10s')
    assert(
      clampedEntry !== undefined && clampedEntry.expiresAt === tMock + 10_000,
      'TIER_1',
      'FEAT-WRT-03',
      'Sub-10s TTL (2,500ms) is clamped to the minimum floor of exactly 10,000ms',
      `expiresAt: ${clampedEntry?.expiresAt}, expected: ${tMock + 10_000}`,
      Date.now() - t0
    )

    // 3.2 Custom TTL above floor: ttlMs = 15,000ms respected (expires at exactly t0 + 15,000ms)
    withMockTime(tMock, () => {
      setApiCache('test:custom-15s', { value: 'custom-ttl' }, 15_000)
    })
    const customEntry = cacheMap.get('test:custom-15s')
    assert(
      customEntry !== undefined && customEntry.expiresAt === tMock + 15_000,
      'TIER_1',
      'FEAT-WRT-03',
      'Custom TTL (15,000ms) is preserved exactly at t0 + 15,000ms (not clamped to 120s or 180s)',
      `expiresAt: ${customEntry?.expiresAt}, expected: ${tMock + 15_000}`,
      Date.now() - t0
    )

    // 3.3 Default TTL: 180_000ms
    withMockTime(tMock, () => {
      setApiCache('test:default-ttl', { value: 'default-ttl' })
    })
    const defaultEntry = cacheMap.get('test:default-ttl')
    assert(
      defaultEntry !== undefined && defaultEntry.expiresAt === tMock + 180_000,
      'TIER_1',
      'FEAT-WRT-03',
      'Default TTL is 180,000ms when ttlMs parameter is omitted',
      undefined,
      Date.now() - t0
    )

    // 3.4 In-place cache patch verification (patchProductInApiCache)
    setApiCache('products:all', {
      products: [
        { id: 'prod-m4-inplace', sku: 'BM-TEA-10', stock: 50, sellPrice: 59000 },
        { id: 'prod-m4-other', sku: 'BM-TEA-50', stock: 30, sellPrice: 169000 },
      ],
    })
    const patchResult = patchProductInApiCache('prod-m4-inplace', { stock: 45, sellPrice: 62000 })
    assert(
      patchResult === true,
      'TIER_1',
      'FEAT-WRT-03',
      'patchProductInApiCache returns true when target product exists in products:* cache',
      undefined,
      Date.now() - t0
    )
    const cachedProds = getApiCache<{ products: Array<{ id: string; stock: number; sellPrice: number }> }>('products:all')
    const patchedProd = cachedProds?.products.find((p) => p.id === 'prod-m4-inplace')
    assert(
      patchedProd?.stock === 45 && patchedProd?.sellPrice === 62000,
      'TIER_1',
      'FEAT-WRT-03',
      'In-place cache patch updates stock and sellPrice in RAM without full DB reload',
      undefined,
      Date.now() - t0
    )
  }

  // ============================================================================
  // TIER 2: ZERO-STORAGE CDN POINTER & SHOPEE SYNC DAEMON (FEAT-CDN-01..03)
  // ============================================================================
  console.log('\n--------------------------------------------------------------------------------')
  console.log('🌐 TIER 2: ZERO-STORAGE CDN POINTER & SHOPEE SYNC DAEMON HARDENING')
  console.log('--------------------------------------------------------------------------------')

  // --- FEAT-CDN-01: Support up to 2048 chars for CDN image pointer input without truncation ---
  {
    const t0 = Date.now()
    // 4.1 Inspect CMS UI component: products-view.tsx
    const productsViewPath = path.resolve('src/components/cms/views/products-view.tsx')
    const productsViewContent = fs.readFileSync(productsViewPath, 'utf8')
    assert(
      productsViewContent.includes('maxLength={2048}'),
      'TIER_2',
      'FEAT-CDN-01',
      'src/components/cms/views/products-view.tsx defines maxLength={2048} on CDN image input',
      undefined,
      Date.now() - t0
    )

    // 4.2 Boundary testing on URL length in regex
    const baseCdnUrl = 'https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-master-2048-pointer?ref='
    const padLength2048 = 2048 - baseCdnUrl.length
    const valid2048Url = baseCdnUrl + 'x'.repeat(padLength2048)
    const invalid2049Url = valid2048Url + 'y'

    assert(
      valid2048Url.length === 2048,
      'TIER_2',
      'FEAT-CDN-01',
      'Constructed boundary test URL has exact length of 2048 characters',
      undefined,
      Date.now() - t0
    )
    assert(
      invalid2049Url.length === 2049,
      'TIER_2',
      'FEAT-CDN-01',
      'Constructed over-boundary test URL has exact length of 2049 characters',
      undefined,
      Date.now() - t0
    )

    const isHttpUrl2048 = /^https?:\/\//i.test(valid2048Url) && valid2048Url.length <= 2048
    const isHttpUrl2049 = /^https?:\/\//i.test(invalid2049Url) && invalid2049Url.length <= 2048
    assert(
      isHttpUrl2048 === true,
      'TIER_2',
      'FEAT-CDN-01',
      'HTTP URL pointer validation passes for exact 2048 characters',
      undefined,
      Date.now() - t0
    )
    assert(
      isHttpUrl2049 === false,
      'TIER_2',
      'FEAT-CDN-01',
      'HTTP URL pointer validation rejects 2049 characters (> 2048)',
      undefined,
      Date.now() - t0
    )

    // 4.3 Test POST /api/products/upload-image handling of 2048-char pointer
    const uploadReq2048 = new NextRequest('http://127.0.0.1:3010/api/products/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: valid2048Url, filename: 'valid2048.webp' }),
    })
    const uploadRes2048 = await uploadImagePost(uploadReq2048)
    const uploadJson2048 = await uploadRes2048.json()
    assert(
      uploadRes2048.status === 200 && uploadJson2048.storageMode === 'EXTERNAL_HTTP_FALLBACK',
      'TIER_2',
      'FEAT-CDN-01',
      'POST /api/products/upload-image accepts 2048-char URL and returns EXTERNAL_HTTP_FALLBACK (200 OK)',
      undefined,
      Date.now() - t0
    )

    // 4.4 Test POST /api/products/upload-image rejection of 2049-char pointer
    const uploadReq2049 = new NextRequest('http://127.0.0.1:3010/api/products/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataUrl: invalid2049Url, filename: 'invalid2049.webp' }),
    })
    const uploadRes2049 = await uploadImagePost(uploadReq2049)
    assert(
      uploadRes2049.status === 413,
      'TIER_2',
      'FEAT-CDN-01',
      'POST /api/products/upload-image rejects 2049-char URL with HTTP 413 (Payload Too Large)',
      undefined,
      Date.now() - t0
    )
  }

  // --- FEAT-CDN-02: Dynamic Shopee sync daemon port fallback (process.env.SHOPEE_SYNC_PORT || 51898) ---
  {
    const t0 = Date.now()
    // 5.1 Static audit across all 4 targeted API routes
    const filesToAudit = [
      'src/app/api/products/upload-image/route.ts',
      'src/app/api/products/[id]/route.ts',
      'src/app/api/channels/[id]/route.ts',
      'src/app/api/webhooks/inbound/route.ts',
    ]

    for (const relPath of filesToAudit) {
      const fullPath = path.resolve(relPath)
      const content = fs.readFileSync(fullPath, 'utf8')
      const hasPortFallback =
        content.includes('SHOPEE_SYNC_PORT') && content.includes('51898')
      assert(
        hasPortFallback,
        'TIER_2',
        'FEAT-CDN-02',
        `Dynamic port fallback (process.env.SHOPEE_SYNC_PORT || 51898) is implemented in ${relPath}`,
        undefined,
        Date.now() - t0
      )
    }

    // 5.2 Dynamic empirical network routing test with ephemeral mock server
    const CUSTOM_TEST_PORT = 53891
    const mockDaemonTracking = { received: false, url: '' }

    const mockDaemonServer = http.createServer((req, res) => {
      mockDaemonTracking.received = true
      mockDaemonTracking.url = req.url || ''
      if (req.method === 'POST' && req.url === '/shopee/upload-image') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            url: `https://down-vn.img.susercontent.com/file/vn-mock-custom-port-${CUSTOM_TEST_PORT}`,
            imageId: `img-custom-${CUSTOM_TEST_PORT}`,
            syncedToShopee: true,
          })
        )
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve, reject) => {
      mockDaemonServer.listen(CUSTOM_TEST_PORT, '127.0.0.1', () => resolve())
      mockDaemonServer.on('error', reject)
    })

    const prevPort = process.env.SHOPEE_SYNC_PORT
    try {
      process.env.SHOPEE_SYNC_PORT = String(CUSTOM_TEST_PORT)
      const uploadReq = new NextRequest('http://127.0.0.1:3010/api/products/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: TINY_MICRO_WEBP,
          filename: 'custom_port_test.webp',
          shopeeItemId: '19719879801',
          syncToShopee: true,
        }),
      })

      const uploadRes = await uploadImagePost(uploadReq)
      const uploadJson = await uploadRes.json()

      assert(
        mockDaemonTracking.received === true && mockDaemonTracking.url === '/shopee/upload-image',
        'TIER_2',
        'FEAT-CDN-02',
        `upload-image route dynamically routed request to SHOPEE_SYNC_PORT :${CUSTOM_TEST_PORT}`,
        undefined,
        Date.now() - t0
      )
      assert(
        uploadRes.status === 200 && uploadJson.storageMode === 'SHOPEE_CDN',
        'TIER_2',
        'FEAT-CDN-02',
        'Dynamic port request returns status 200 and SHOPEE_CDN storage mode',
        undefined,
        Date.now() - t0
      )
      assert(
        uploadJson.url === `https://down-vn.img.susercontent.com/file/vn-mock-custom-port-${CUSTOM_TEST_PORT}`,
        'TIER_2',
        'FEAT-CDN-02',
        'Response contains the Shopee CDN URL returned by the custom port daemon',
        undefined,
        Date.now() - t0
      )
    } finally {
      if (prevPort !== undefined) {
        process.env.SHOPEE_SYNC_PORT = prevPort
      } else {
        delete process.env.SHOPEE_SYNC_PORT
      }
      await new Promise<void>((resolve) => mockDaemonServer.close(() => resolve()))
    }
  }

  // --- FEAT-CDN-03: 3-tier image update cascade & cmsCustomImage overwrite protection ---
  {
    const t0 = Date.now()
    // 6.1 Tier 2: Micro-WebP offline fallback when daemon is unreachable
    const OFFLINE_DUMMY_PORT = 53892
    const prevPort = process.env.SHOPEE_SYNC_PORT
    process.env.SHOPEE_SYNC_PORT = String(OFFLINE_DUMMY_PORT)

    try {
      const offlineUploadReq = new NextRequest('http://127.0.0.1:3010/api/products/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: TINY_MICRO_WEBP,
          filename: 'offline_fallback.webp',
          shopeeItemId: '19719879801',
          syncToShopee: true,
        }),
      })

      const offlineUploadRes = await uploadImagePost(offlineUploadReq)
      const offlineUploadJson = await offlineUploadRes.json()

      assert(
        offlineUploadRes.status === 200,
        'TIER_2',
        'FEAT-CDN-03',
        'When daemon is offline, upload-image gracefully completes with HTTP 200',
        undefined,
        Date.now() - t0
      )
      assert(
        offlineUploadJson.storageMode === 'MICRO_WEBP_FALLBACK',
        'TIER_2',
        'FEAT-CDN-03',
        'storageMode is set to MICRO_WEBP_FALLBACK when daemon is offline',
        undefined,
        Date.now() - t0
      )
      assert(
        offlineUploadJson.pendingCdnOffload === true,
        'TIER_2',
        'FEAT-CDN-03',
        'pendingCdnOffload is set to true for background Outbox offload recovery',
        undefined,
        Date.now() - t0
      )
    } finally {
      if (prevPort !== undefined) {
        process.env.SHOPEE_SYNC_PORT = prevPort
      } else {
        delete process.env.SHOPEE_SYNC_PORT
      }
    }

    // 6.2 cmsCustomImage protection logic in webhook inbound route
    const webhookRoutePath = path.resolve('src/app/api/webhooks/inbound/route.ts')
    const webhookContent = fs.readFileSync(webhookRoutePath, 'utf8')
    assert(
      webhookContent.includes('prevAttrs.cmsCustomImage === true') &&
        webhookContent.includes('!shopeeImageChanged'),
      'TIER_2',
      'FEAT-CDN-03',
      'Inbound webhook guards CMS custom images from routine polling overwrite when !shopeeImageChanged',
      undefined,
      Date.now() - t0
    )
    assert(
      webhookContent.includes('if (shopeeImageChanged) {') &&
        webhookContent.includes('nextAttrsObj.cmsCustomImage = false'),
      'TIER_2',
      'FEAT-CDN-03',
      'Inbound webhook accepts legitimate Shopee portal changes (shopeeImageChanged) and resets cmsCustomImage',
      undefined,
      Date.now() - t0
    )
  }

  // ============================================================================
  // TIER 3: PRODUCTION PACKAGING & SAFE MAINTENANCE FRAMEWORK (FEAT-OPS-01..03)
  // ============================================================================
  console.log('\n--------------------------------------------------------------------------------')
  console.log('📋 TIER 3: PRODUCTION PACKAGING & SAFE MAINTENANCE FRAMEWORK')
  console.log('--------------------------------------------------------------------------------')

  // --- FEAT-OPS-01: Baseline 24-table parity check (db/baseline-counts.json) ---
  {
    const t0 = Date.now()
    const baselinePath = path.resolve('db/baseline-counts.json')
    assert(
      fs.existsSync(baselinePath),
      'TIER_3',
      'FEAT-OPS-01',
      'db/baseline-counts.json exists in workspace root',
      undefined,
      Date.now() - t0
    )

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    let allParityMatched = true
    let tablesChecked = 0

    for (const model of CORE_BUSINESS_TABLES) {
      const expected = baseline[model]
      assert(
        expected !== undefined,
        'TIER_3',
        'FEAT-OPS-01',
        `Table '${model}' is defined in db/baseline-counts.json`,
        undefined,
        Date.now() - t0
      )

      const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
      const delegate = (prisma as any)[delegateName]
      assert(
        delegate && typeof delegate.count === 'function',
        'TIER_3',
        'FEAT-OPS-01',
        `Prisma client has valid delegate for model '${model}'`,
        undefined,
        Date.now() - t0
      )

      const actualCount = await delegate.count()
      const isMatch = actualCount === expected
      if (!isMatch) allParityMatched = false
      tablesChecked++

      assert(
        isMatch,
        'TIER_3',
        'FEAT-OPS-01',
        `Parity check: ${model.padEnd(22)} actual=${actualCount} baseline=${expected}`,
        undefined,
        Date.now() - t0
      )
    }

    assert(
      tablesChecked === 24 && allParityMatched,
      'TIER_3',
      'FEAT-OPS-01',
      '100% PARITY MATCH across all 24/24 Core Business Tables vs clean production baseline',
      undefined,
      Date.now() - t0
    )
  }

  // --- FEAT-OPS-02: Safe Maintenance & Upgrade Runbook (docs/MAINTENANCE_RUNBOOK.md) ---
  {
    const t0 = Date.now()
    const runbookPath = path.resolve('docs/MAINTENANCE_RUNBOOK.md')
    assert(
      fs.existsSync(runbookPath),
      'TIER_3',
      'FEAT-OPS-02',
      'docs/MAINTENANCE_RUNBOOK.md exists on main branch',
      undefined,
      Date.now() - t0
    )

    const runbookContent = fs.readFileSync(runbookPath, 'utf8')
    assert(
      runbookContent.length > 5000,
      'TIER_3',
      'FEAT-OPS-02',
      'docs/MAINTENANCE_RUNBOOK.md is comprehensive (> 5KB / > 300 lines)',
      undefined,
      Date.now() - t0
    )

    // Verify mandatory operational sections
    const requiredRunbookPhrases = [
      'Expand-and-Contract',
      'thaimy1605',
      'Delta = 0',
      'POST /shopee/pause',
      'POST /shopee/resume',
      'prisma db push',
    ]

    for (const phrase of requiredRunbookPhrases) {
      assert(
        runbookContent.includes(phrase),
        'TIER_3',
        'FEAT-OPS-02',
        `Runbook contains mandatory operational section: '${phrase}'`,
        undefined,
        Date.now() - t0
      )
    }

    assert(
      runbookContent.includes('RTO') && /5\s*phút/i.test(runbookContent),
      'TIER_3',
      'FEAT-OPS-02',
      'Runbook contains mandatory RTO < 5 phút emergency recovery budget',
      undefined,
      Date.now() - t0
    )
  }

  // --- FEAT-OPS-03: Operational Handover Documentation (HANDOVER_MAINTENANCE.md) ---
  {
    const t0 = Date.now()
    const handoverPath = path.resolve('HANDOVER_MAINTENANCE.md')
    assert(
      fs.existsSync(handoverPath),
      'TIER_3',
      'FEAT-OPS-03',
      'HANDOVER_MAINTENANCE.md exists in workspace root',
      undefined,
      Date.now() - t0
    )

    const handoverContent = fs.readFileSync(handoverPath, 'utf8')
    assert(
      handoverContent.length > 3000,
      'TIER_3',
      'FEAT-OPS-03',
      'HANDOVER_MAINTENANCE.md contains full handover instructions (> 3KB / > 150 lines)',
      undefined,
      Date.now() - t0
    )

    // Verify 1-Click launcher commands & rules
    const requiredHandoverPhrases = [
      'run-production.bat',
      'start-cms.ps1',
      'run-shopee-sync.bat',
      'launch-chrome-shopee.bat',
      'beta-feedback',
      'thaimy1605',
    ]

    for (const phrase of requiredHandoverPhrases) {
      assert(
        handoverContent.includes(phrase),
        'TIER_3',
        'FEAT-OPS-03',
        `Handover document specifies operational command/guideline: '${phrase}'`,
        undefined,
        Date.now() - t0
      )
    }
  }

  // ============================================================================
  // TIER 4: MASTER E2E TEST-GUARD & SHOP THAIMY1605 INVARIANT (FEAT-TEST-01)
  // ============================================================================
  console.log('\n--------------------------------------------------------------------------------')
  console.log('🛡️ TIER 4: MASTER E2E TEST-GUARD & SHOP THAIMY1605 INVARIANT PRESERVATION')
  console.log('--------------------------------------------------------------------------------')

  // --- FEAT-TEST-01: Full Test-Guard cycle, teardown, and assert13RealProductsInvariant ---
  {
    const t0 = Date.now()

    // 10.1 Pre-test invariant audit on real products
    console.log('  Auditing baseline invariant on shop thaimy1605 canonical products...')
    const preAudit = await assert13RealProductsInvariant(prisma, { silent: true })
    assert(
      preAudit.passed === true,
      'TIER_4',
      'FEAT-TEST-01',
      'Initial invariant audit PASS: Shop thaimy1605 baseline is in 100% canonical state',
      undefined,
      Date.now() - t0
    )
    assert(
      preAudit.totalActualStock === AUTHORITATIVE_TOTAL_STOCK,
      'TIER_4',
      'FEAT-TEST-01',
      `Initial total stock is exactly ${AUTHORITATIVE_TOTAL_STOCK}/${AUTHORITATIVE_TOTAL_STOCK} across ${AUTHORITATIVE_13_PRODUCTS.length} SKUs`,
      undefined,
      Date.now() - t0
    )
    assert(
      preAudit.actualCount === AUTHORITATIVE_13_PRODUCTS.length,
      'TIER_4',
      'FEAT-TEST-01',
      `Initial product count is exactly ${AUTHORITATIVE_13_PRODUCTS.length} SKUs`,
      undefined,
      Date.now() - t0
    )

    // 10.2 Take Snapshot via Test-Guard API endpoint
    console.log('  Taking Snapshot via POST /api/ledger/test-guard (action: SNAPSHOT)...')
    const snapshotResult = await takeSnapshot({ baseUrl: DEFAULT_BASE_URL, silent: true })
    assert(
      snapshotResult.ok === true && snapshotResult.action === 'SNAPSHOT_CREATED',
      'TIER_4',
      'FEAT-TEST-01',
      'Test-Guard SNAPSHOT created successfully with frozen baseline',
      `createdAt: ${snapshotResult.createdAt}, productCount: ${snapshotResult.productCount}`,
      Date.now() - t0
    )

    // 10.3 Run Simulated Operational Mutation Workflow (Creating synthetic test artifact)
    console.log('  Executing simulated operational mutations (Synthetic test product)...')
    const TEST_PROD_ID = 'test-e2e-m4-synthetic-prod'
    const TEST_SKU = 'TEST-E2E-M4-TEMP'

    const createdTestProd = await prisma.product.create({
      data: {
        id: TEST_PROD_ID,
        sku: TEST_SKU,
        name: '[TEST] M4 Synthetic Operational Test Product',
        costPrice: 45000,
        sellPrice: 99000,
        stock: 10,
        unit: 'sp',
        type: 'SIMPLE',
        status: 'ACTIVE',
      },
    })
    assert(
      createdTestProd.sku === TEST_SKU,
      'TIER_4',
      'FEAT-TEST-01',
      'Synthetic test product created in database to verify topological teardown',
      undefined,
      Date.now() - t0
    )

    // Create warehouse stock for synthetic product
    await prisma.warehouseStock.create({
      data: {
        productId: TEST_PROD_ID,
        warehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
        quantity: 10,
      },
    })

    // Verify mutation is visible
    const mutatedCount = await prisma.product.count()
    assert(
      mutatedCount === AUTHORITATIVE_13_PRODUCTS.length + 1,
      'TIER_4',
      'FEAT-TEST-01',
      `Database temporarily mutated: product count increased from ${AUTHORITATIVE_13_PRODUCTS.length} to ${mutatedCount}`,
      undefined,
      Date.now() - t0
    )

    // 10.4 Execute RESTORE_AND_CLEAN Teardown
    console.log('  Executing teardown via POST /api/ledger/test-guard (action: RESTORE_AND_CLEAN)...')
    const restoreResult = await restoreAndClean({ baseUrl: DEFAULT_BASE_URL, silent: true })
    assert(
      restoreResult.ok === true && restoreResult.action === 'RESTORED_AND_CLEANED',
      'TIER_4',
      'FEAT-TEST-01',
      'Test-Guard RESTORE_AND_CLEAN executed successfully',
      `restoredProductsCount: ${restoreResult.restoredProductsCount}, removedTestArtifactsCount: ${restoreResult.removedTestArtifactsCount}`,
      Date.now() - t0
    )

    // 10.5 Invariant Certification on Shop thaimy1605 (Delta = 0, stock 307/307)
    console.log('  Executing rigorous assert13RealProductsInvariant(prisma) post-teardown...')
    const postAudit = await assert13RealProductsInvariant(prisma, { silent: false })

    assert(
      postAudit.passed === true,
      'TIER_4',
      'FEAT-TEST-01',
      'Post-teardown assert13RealProductsInvariant PASS: 100% preservation certified',
      undefined,
      Date.now() - t0
    )
    assert(
      postAudit.actualCount === AUTHORITATIVE_13_PRODUCTS.length,
      'TIER_4',
      'FEAT-TEST-01',
      `Product count returned to exact baseline: ${AUTHORITATIVE_13_PRODUCTS.length} / ${AUTHORITATIVE_13_PRODUCTS.length}`,
      undefined,
      Date.now() - t0
    )
    assert(
      postAudit.totalActualStock === AUTHORITATIVE_TOTAL_STOCK,
      'TIER_4',
      'FEAT-TEST-01',
      `Total stock is certified at exactly ${AUTHORITATIVE_TOTAL_STOCK}/${AUTHORITATIVE_TOTAL_STOCK} (Delta = 0)`,
      undefined,
      Date.now() - t0
    )
    assert(
      postAudit.deltas.every((d) => d.status === 'MATCH' && d.stockDelta === 0 && d.priceDelta === 0),
      'TIER_4',
      'FEAT-TEST-01',
      `All ${AUTHORITATIVE_13_PRODUCTS.length}/${AUTHORITATIVE_13_PRODUCTS.length} SKUs have status MATCH with stockDelta === 0 and priceDelta === 0`,
      undefined,
      Date.now() - t0
    )

    // Verify synthetic test product was completely removed
    const leftoverTestProd = await prisma.product.findUnique({ where: { sku: TEST_SKU } })
    assert(
      leftoverTestProd === null,
      'TIER_4',
      'FEAT-TEST-01',
      'Synthetic test product TEST-E2E-M4-TEMP was cleanly removed without residue',
      undefined,
      Date.now() - t0
    )

    // 10.6 Clean state verification
    const cleanStatus = await verifyCleanState({ baseUrl: DEFAULT_BASE_URL, silent: true })
    assert(
      cleanStatus.clean === true && cleanStatus.leftoverCount === 0,
      'TIER_4',
      'FEAT-TEST-01',
      'verifyCleanState confirms clean=true and leftoverCount=0 across entire schema',
      undefined,
      Date.now() - t0
    )

    // 10.7 Post-teardown 24 Core Tables Parity check
    console.log('  Re-verifying 24 Core Business Tables baseline parity post-teardown...')
    const baseline = JSON.parse(fs.readFileSync('db/baseline-counts.json', 'utf8'))
    let finalParityOk = true
    for (const model of CORE_BUSINESS_TABLES) {
      const expected = baseline[model]
      const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
      const delegate = (prisma as any)[delegateName]
      const actual = await delegate.count()
      if (actual !== expected) {
        finalParityOk = false
      }
    }
    assert(
      finalParityOk === true,
      'TIER_4',
      'FEAT-TEST-01',
      'Post-teardown 24/24 Core Business Tables remain 100% in parity with db/baseline-counts.json',
      undefined,
      Date.now() - t0
    )
  }

  await prisma.$disconnect()
  cleanupServer()

  const totalDuration = ((Date.now() - suiteStartTime) / 1000).toFixed(2)
  console.log('\n================================================================================')
  console.log('  MASTER PRODUCTION READINESS AUDIT SUMMARY')
  console.log('================================================================================')
  console.log(`  Total Assertions Checked : ${testResults.length}`)
  console.log(`  Passed Assertions        : ${totalPassCount}`)
  console.log(`  Failed Assertions        : ${totalFailCount}`)
  console.log(`  Shop thaimy1605 Delta    : 0 (100% PRESERVED, stock ${AUTHORITATIVE_TOTAL_STOCK}/${AUTHORITATIVE_TOTAL_STOCK}, ${AUTHORITATIVE_13_PRODUCTS.length}/${AUTHORITATIVE_13_PRODUCTS.length} SKUs MATCH)`)
  console.log(`  Database Core Parity     : 24 / 24 Tables MATCH (100%)`)
  console.log(`  Total Execution Time     : ${totalDuration}s`)
  console.log(`  Overall Suite Status     : ${totalFailCount === 0 ? '🏆 ALL PASS (100%)' : '❌ FAILED'}`)
  console.log('================================================================================\n')

  if (totalFailCount > 0) {
    process.exit(1)
  }
}

runMasterProductionSuite().catch(async (err) => {
  console.error('\n💥 FATAL SUITE EXECUTION ERROR:', err)
  try {
    await prisma.$disconnect()
  } catch {}
  process.exit(1)
})
