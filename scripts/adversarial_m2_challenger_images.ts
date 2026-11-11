/**
 * scripts/adversarial_m2_challenger_images.ts
 *
 * EMPIRICAL ADVERSARIAL STRESS HARNESS — MILESTONE 2:
 * ZERO-STORAGE CDN POINTER & SHOPEE SYNC DAEMON HARDENING
 *
 * Challenger: teamwork_challenger (Role: critic, specialist)
 *
 * Empirical Challenge Scope:
 * 1. Tier 1: Daemon Online & Dynamic Port Routing (SHOPEE_SYNC_PORT)
 *    - Spins up mock Shopee sync daemon on isolated port 51899
 *    - Verifies POST /api/products/upload-image routes to SHOPEE_SYNC_PORT
 *    - Verifies returns Shopee CDN URL pointer (~74B), bytesInDb=74, storageMode='SHOPEE_CDN', pendingCdnOffload=false
 * 2. Tier 2: Daemon Offline (Micro-WebP & External HTTP Pointer Fallbacks)
 *    - Shuts down daemon
 *    - Verifies Micro-WebP fallback (<=8KB) sets storageMode='MICRO_WEBP_FALLBACK', pendingCdnOffload=true
 *    - Verifies External HTTP(S) pointer sets storageMode='EXTERNAL_HTTP_FALLBACK', pendingCdnOffload=false
 *    - Adversarial boundary tests:
 *      * URL length 2048 -> 200 OK
 *      * URL length 2049 -> 413 Payload Too Large
 *      * Micro-WebP > 12000 chars -> 413 Payload Too Large
 *      * Empty payload / garbage non-image -> 400 Bad Request
 * 3. Tier 3: Outbox Reconciliation
 *    - Offline product with pendingCdnOffload=true is discovered by OUTBOX_FETCH_PENDING (imageDrifted=true)
 *    - Daemon ACK (OUTBOX_ACK_RESULT) with new Shopee CDN URL updates product image, clears pendingCdnOffload to false, updates L1 cache
 * 4. cmsCustomImage Protection Logic
 *    - Scenario A: Routine inbound poll with unchanged Shopee image -> PRESERVES CMS custom image & cmsCustomImage: true
 *    - Scenario B: Legitimate Shopee Seller Center portal change -> HONORS portal change, updates product image, resets cmsCustomImage: false
 *    - Scenario C: Routine poll on unflagged product -> normal sync
 * 5. Data Invariant R2
 *    - Pre-test Snapshot -> Post-test Restore & Clean -> 13/17 Canonical Products Delta = 0, Clean State = true
 */

import http from 'node:http'
import { db } from '../src/lib/db'
import {
  takeSnapshot,
  restoreAndClean,
  assert13RealProductsInvariant,
  verifyCleanState,
  DEFAULT_BASE_URL,
} from './test_guard_helper'

const BASE_URL = DEFAULT_BASE_URL.trim()
const CMS_API_KEY = '191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955'
const MOCK_DAEMON_PORT = 51898
const CUSTOM_DAEMON_PORT = 51899

interface TestResult {
  suite: string
  name: string
  status: 'PASS' | 'FAIL'
  error?: string
}

const results: TestResult[] = []

function assert(condition: boolean, suite: string, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] [${suite}] ${name}`)
    results.push({ suite, name, status: 'PASS' })
  } else {
    console.error(`  ❌ [FAIL] [${suite}] ${name}${detail ? ` -> ${detail}` : ''}`)
    results.push({ suite, name, status: 'FAIL', error: detail })
    throw new Error(`Assertion failed: [${suite}] ${name} (${detail || 'Condition not met'})`)
  }
}

async function postWebhook(payload: Record<string, unknown>) {
  const res = await fetch(`${BASE_URL}/api/webhooks/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Apikey ${CMS_API_KEY}`,
    },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let json: any = {}
  try {
    json = JSON.parse(text)
  } catch {
    json = { rawText: text }
  }
  return { status: res.status, ok: res.ok, json }
}

const TINY_MICRO_WEBP =
  'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoIAAgAAkA4JZwCdADcAA/v3cAAAA=='

async function main() {
  console.log('================================================================================')
  console.log('🛡️ EMPIRICAL ADVERSARIAL STRESS HARNESS: ZERO-STORAGE CDN & SHOPEE SYNC DAEMON')
  console.log('================================================================================\n')

  // Phase 0: Freeze baseline
  console.log('📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  await takeSnapshot({ silent: false })

  let mockDaemonServer: http.Server | null = null
  let mockDaemonRequestCount = 0
  let lastMockDaemonBody: any = null

  try {
    // --------------------------------------------------------------------------
    // SUITE 1: TIER 1 — DAEMON ONLINE (DIRECT SHOPEE CDN POINTER & DYNAMIC PORT)
    // --------------------------------------------------------------------------
    console.log('\n--- SUITE 1: Tier 1 Direct Shopee CDN Pointer & Dynamic Port Routing ---')

    // 1.1 Start mock daemon on standard port 51898 to test live Next.js HTTP server
    await new Promise<void>((resolve, reject) => {
      mockDaemonServer = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/shopee/upload-image') {
          mockDaemonRequestCount++
          let body = ''
          req.on('data', (chunk) => {
            body += chunk
          })
          req.on('end', () => {
            try {
              lastMockDaemonBody = JSON.parse(body)
            } catch {
              lastMockDaemonBody = { raw: body }
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(
              JSON.stringify({
                ok: true,
                url: 'https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-tier1-online-74b',
                imageId: 'vn-11134207-7ras8-tier1-online-74b',
                syncedToShopee: Boolean(lastMockDaemonBody.syncToShopee),
              })
            )
          })
        } else if (req.method === 'POST' && req.url === '/shopee/trigger-sync') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } else {
          res.writeHead(404)
          res.end()
        }
      })
      mockDaemonServer.listen(MOCK_DAEMON_PORT, '127.0.0.1', () => {
        console.log(`  🌐 Mock Shopee Sync Daemon running at http://127.0.0.1:${MOCK_DAEMON_PORT}`)
        resolve()
      })
      mockDaemonServer.on('error', reject)
    })

    // Upload with daemon online on default port 51898 via live HTTP
    const cdnUploadRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: TINY_MICRO_WEBP,
        filename: 'tier1_product.webp',
        shopeeItemId: '19719879801',
        shopeeModelId: '0',
        syncToShopee: true,
      }),
    })
    const cdnUploadJson = await cdnUploadRes.json()

    assert(cdnUploadRes.ok, 'SUITE_1', 'upload-image succeeds with daemon online (HTTP 200)')
    assert(mockDaemonRequestCount >= 1, 'SUITE_1', 'Daemon received request on port 51898')
    assert(cdnUploadJson.storageMode === 'SHOPEE_CDN', 'SUITE_1', 'storageMode is SHOPEE_CDN')
    assert(cdnUploadJson.pendingCdnOffload === false, 'SUITE_1', 'pendingCdnOffload is false for Tier 1 direct CDN')
    assert(
      cdnUploadJson.url === 'https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-tier1-online-74b',
      'SUITE_1',
      'Returned URL is the exact Shopee CDN URL pointer (~74B)'
    )
    assert(cdnUploadJson.bytesInDb === cdnUploadJson.url.length, 'SUITE_1', 'bytesInDb equals CDN URL length (~74B)')

    // 1.2 Test Dynamic Port Override (SHOPEE_SYNC_PORT) using route handler
    console.log('  Testing dynamic SHOPEE_SYNC_PORT override on custom port 51899...')
    let customDaemonReceived = false
    const customDaemonServer = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/shopee/upload-image') {
        customDaemonReceived = true
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            url: 'https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-custom-port-51899',
            imageId: 'custom-port-id',
          })
        )
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    await new Promise<void>((resolve, reject) => {
      customDaemonServer.listen(CUSTOM_DAEMON_PORT, '127.0.0.1', () => resolve())
      customDaemonServer.on('error', reject)
    })

    // Set process.env.SHOPEE_SYNC_PORT and call route handler directly
    process.env.SHOPEE_SYNC_PORT = String(CUSTOM_DAEMON_PORT)
    const { POST: uploadRoutePost } = await import('../src/app/api/products/upload-image/route')
    const { NextRequest: NextRequestClass } = await import('next/server')

    const customReq = new NextRequestClass(`http://127.0.0.1:3010/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: TINY_MICRO_WEBP,
        filename: 'custom_port.webp',
      }),
    })
    const customRes = await uploadRoutePost(customReq)
    const customJson = await customRes.json()

    assert(customDaemonReceived, 'SUITE_1', 'Custom daemon on port 51899 received request via SHOPEE_SYNC_PORT')
    assert(
      customJson.url === 'https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-custom-port-51899',
      'SUITE_1',
      'Route returns custom port CDN pointer'
    )

    // Clean up custom daemon
    await new Promise<void>((resolve) => customDaemonServer.close(() => resolve()))
    delete process.env.SHOPEE_SYNC_PORT

    // 1.3 Shut down mock daemon to prepare for offline testing
    await new Promise<void>((resolve) => {
      if (mockDaemonServer) {
        mockDaemonServer.close(() => {
          console.log('  🛑 Mock Shopee Sync Daemon stopped (offline simulated)')
          mockDaemonServer = null
          resolve()
        })
      } else {
        resolve()
      }
    })


    // --------------------------------------------------------------------------
    // SUITE 2: TIER 2 — DAEMON OFFLINE (FALLBACK CASCADE & BOUNDARY STRESS)
    // --------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Tier 2 Daemon Offline Fallback Cascade & Boundary Stress ---')

    // 2.1 Micro-WebP fallback when daemon is offline
    const microFallbackRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: TINY_MICRO_WEBP,
        filename: 'offline_product.webp',
      }),
    })
    const microFallbackJson = await microFallbackRes.json()
    assert(microFallbackRes.ok, 'SUITE_2', 'Micro-WebP fallback succeeds when daemon offline (HTTP 200)')
    assert(microFallbackJson.storageMode === 'MICRO_WEBP_FALLBACK', 'SUITE_2', 'storageMode is MICRO_WEBP_FALLBACK')
    assert(microFallbackJson.pendingCdnOffload === true, 'SUITE_2', 'pendingCdnOffload is true for Micro-WebP')
    assert(microFallbackJson.url === TINY_MICRO_WEBP, 'SUITE_2', 'Micro-WebP data URL returned intact')
    assert(microFallbackJson.bytesInDb <= 12000, 'SUITE_2', 'bytesInDb is <= 12000 bytes (~8KB limit)')

    // 2.2 External HTTP pointer fallback when daemon is offline
    const externalHttpUrl = 'https://s3.ap-southeast-1.amazonaws.com/media/offline-pointer.webp'
    const httpFallbackRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: externalHttpUrl,
      }),
    })
    const httpFallbackJson = await httpFallbackRes.json()
    assert(httpFallbackRes.ok, 'SUITE_2', 'External HTTP pointer fallback succeeds when daemon offline (HTTP 200)')
    assert(httpFallbackJson.storageMode === 'EXTERNAL_HTTP_FALLBACK', 'SUITE_2', 'storageMode is EXTERNAL_HTTP_FALLBACK')
    assert(httpFallbackJson.pendingCdnOffload === false, 'SUITE_2', 'pendingCdnOffload is false for external HTTP pointer')
    assert(httpFallbackJson.url === externalHttpUrl, 'SUITE_2', 'HTTP pointer URL returned intact')

    // 2.3 Boundary Stress: Long HTTP URL pointer exactly 2048 chars
    const basePrefix = 'https://down-vn.img.susercontent.com/file/vn-11134207?token='
    const validLongUrl = basePrefix + 'x'.repeat(2048 - basePrefix.length)
    assert(validLongUrl.length === 2048, 'SUITE_2', 'Generated exact 2048-char URL')

    const long2048Res = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: validLongUrl,
      }),
    })
    const long2048Json = await long2048Res.json()
    assert(long2048Res.ok, 'SUITE_2', 'upload-image accepts exact 2048-char HTTP pointer URL', long2048Json.error)
    assert(long2048Json.url === validLongUrl, 'SUITE_2', '2048-char URL preserved verbatim')

    // 2.4 Boundary Stress: Oversized HTTP URL pointer 2049 chars (exceeds 2048 limit)
    const invalidLongUrl = validLongUrl + 'z'
    assert(invalidLongUrl.length === 2049, 'SUITE_2', 'Generated 2049-char URL (oversized)')

    const long2049Res = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: invalidLongUrl,
      }),
    })
    assert(long2049Res.status === 413, 'SUITE_2', 'upload-image rejects 2049-char URL with HTTP 413 (Payload Too Large)')

    // 2.5 Boundary Stress: Oversized Micro-WebP base64 (> 12000 chars)
    const oversizedBase64 = 'data:image/webp;base64,' + 'A'.repeat(12005)
    const oversizedWebpRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: oversizedBase64,
      }),
    })
    assert(oversizedWebpRes.status === 413, 'SUITE_2', 'upload-image rejects oversized base64 (>12KB) with HTTP 413')

    // 2.6 Boundary Stress: Empty payload / missing images
    const emptyPayloadRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert(emptyPayloadRes.status === 400, 'SUITE_2', 'upload-image rejects empty image payload with HTTP 400')

    // --------------------------------------------------------------------------
    // SUITE 3: TIER 3 — OUTBOX RECONCILIATION FOR OFFLINE MICRO-WEBP
    // --------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Tier 3 Outbox Reconciliation for Offline Micro-WebP ---')

    const outboxSku = 'SP-TEST-M2-OUTBOX-OFFLOAD'
    await db.product.deleteMany({ where: { sku: outboxSku } })

    const createOutboxProdRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: outboxSku,
        name: 'Sản Phẩm Cần Outbox Reconcile M2',
        sellPrice: 199000,
        costPrice: 99000,
        stock: 45,
        image: TINY_MICRO_WEBP,
        attributes: JSON.stringify({
          shopeeItemId: '8877665544',
          shopeeModelId: '0',
          pendingCdnOffload: true,
          cmsCustomImage: false,
        }),
      }),
    })
    const createOutboxProdJson = await createOutboxProdRes.json()
    assert(createOutboxProdRes.ok, 'SUITE_3', 'Product with pendingCdnOffload created')
    const outboxProd = createOutboxProdJson.product

    // Poll pending outbox jobs
    const outboxFetchRes = await postWebhook({
      event: 'OUTBOX_FETCH_PENDING',
      data: {},
    })
    assert(outboxFetchRes.ok, 'SUITE_3', 'OUTBOX_FETCH_PENDING webhook returns 200 OK')
    const matchingJob = outboxFetchRes.json.jobs?.find((j: any) => j.productId === outboxProd.id)
    assert(Boolean(matchingJob), 'SUITE_3', 'Outbox job successfully created for pendingCdnOffload product')
    assert(matchingJob?.imageDrifted === true, 'SUITE_3', 'Job has imageDrifted = true')
    assert(matchingJob?.targetImage === TINY_MICRO_WEBP, 'SUITE_3', 'Job targetImage is the Micro-WebP data URL')

    // Send ACK from daemon with new Shopee CDN URL pointer
    const reconciledCdnUrl = 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-reconciled-pointer'
    const outboxAckRes = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: matchingJob.outboxId,
        productId: outboxProd.id,
        sku: outboxSku,
        shopeeItemId: '8877665544',
        shopeeModelId: '0',
        syncedStock: 45,
        syncedPrice: 199000,
        syncedImage: reconciledCdnUrl,
        status: 'COMPLETED',
        idempotencyKey: `ACK_CHALLENGER_${outboxProd.id}`,
      },
    })
    assert(outboxAckRes.ok, 'SUITE_3', 'OUTBOX_ACK_RESULT returns 200 OK')

    // Verify DB state
    const dbOutboxProd = await db.product.findUnique({ where: { id: outboxProd.id } })
    assert(dbOutboxProd?.image === reconciledCdnUrl, 'SUITE_3', 'DB product image updated to Shopee CDN URL pointer')
    const parsedAttrs = JSON.parse(dbOutboxProd?.attributes || '{}')
    assert(parsedAttrs.pendingCdnOffload === false, 'SUITE_3', 'pendingCdnOffload cleared to false after ACK')
    assert(parsedAttrs.lastSyncedShopeeImage === reconciledCdnUrl, 'SUITE_3', 'lastSyncedShopeeImage recorded in attributes')

    // Verify L1 cache reflection
    const cacheListRes = await fetch(`${BASE_URL}/api/products`)
    const cacheListJson = (await cacheListRes.json()) as { products: any[] }
    const cachedProd = cacheListJson.products.find((p) => p.id === outboxProd.id)
    assert(cachedProd?.image === reconciledCdnUrl, 'SUITE_3', 'L1 cache immediately serves reconciled Shopee CDN pointer')

    // --------------------------------------------------------------------------
    // SUITE 4: cmsCustomImage PROTECTION & OVERRIDE LOGIC
    // --------------------------------------------------------------------------
    console.log('\n--- SUITE 4: cmsCustomImage Inbound Protection & Legitimate Portal Override ---')

    const cmsCustomSku = 'SP-TEST-M2-CMS-CUSTOM-IMG'
    await db.product.deleteMany({ where: { sku: cmsCustomSku } })

    const customCmsImage = 'https://custom-brand-cdn.vn/special-marketing-cover.webp'
    const baselineShopeeImage = 'https://down-vn.img.susercontent.com/file/vn-11134207-baseline-shopee'

    // Create product with cmsCustomImage = true and unique model ID
    const createCmsProdRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: cmsCustomSku,
        name: 'Sản Phẩm Ảnh Độc Quyền CMS',
        sellPrice: 350000,
        costPrice: 180000,
        stock: 50,
        image: customCmsImage,
        attributes: JSON.stringify({
          shopeeItemId: '7766554433',
          shopeeModelId: '7766554433_M1',
          cmsCustomImage: true,
          lastSyncedShopeeImage: baselineShopeeImage,
        }),
      }),
    })
    const createCmsProdJson = await createCmsProdRes.json()
    assert(createCmsProdRes.ok, 'SUITE_4', 'Product with cmsCustomImage=true created')
    const cmsProd = createCmsProdJson.product

    // 4.1 Scenario A: Routine inbound poll with UNCHANGED Shopee image -> PRESERVES CMS custom image
    console.log('  Testing Scenario A: Routine inbound poll (Shopee image unchanged)...')
    const routinePollRes = await postWebhook({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        sku: cmsCustomSku,
        name: 'Sản Phẩm Ảnh Độc Quyền CMS',
        shopeeItemId: '7766554433',
        shopeeModelId: '7766554433_M1',
        stock: 50,
        sellPrice: 350000,
        image: baselineShopeeImage, // Unchanged from baseline
      },
    })
    assert(routinePollRes.ok, 'SUITE_4', 'Routine inbound catalog sync returns HTTP 200', JSON.stringify(routinePollRes.json))

    const afterRoutineProd = await db.product.findUnique({ where: { id: cmsProd.id } })
    assert(
      afterRoutineProd?.image === customCmsImage,
      'SUITE_4',
      'Scenario A: CMS custom image PRESERVED (not overwritten by routine Shopee poll)'
    )
    const afterRoutineAttrs = JSON.parse(afterRoutineProd?.attributes || '{}')
    assert(
      afterRoutineAttrs.cmsCustomImage === true,
      'SUITE_4',
      'Scenario A: cmsCustomImage remains true after routine poll'
    )

    // 4.2 Scenario B: Legitimate Shopee Seller Center portal change -> HONORS portal change
    console.log('  Testing Scenario B: Legitimate Shopee Seller Center portal image change...')
    const portalChangedShopeeImage = 'https://down-vn.img.susercontent.com/file/vn-11134207-portal-changed-2026'
    const portalSyncRes = await postWebhook({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        sku: cmsCustomSku,
        name: 'Sản Phẩm Ảnh Độc Quyền CMS (Cập Nhật Portal)',
        shopeeItemId: '7766554433',
        shopeeModelId: '7766554433_M1',
        stock: 50,
        sellPrice: 350000,
        image: portalChangedShopeeImage, // Changed on Shopee portal!
      },
    })
    assert(portalSyncRes.ok, 'SUITE_4', 'Inbound portal change sync returns HTTP 200')

    const afterPortalProd = await db.product.findUnique({ where: { id: cmsProd.id } })
    console.log('    [SCENARIO B DEBUG] afterPortalProd image:', afterPortalProd?.image)
    console.log('    [SCENARIO B DEBUG] portalChangedShopeeImage:', portalChangedShopeeImage)
    console.log('    [SCENARIO B DEBUG] attributes:', afterPortalProd?.attributes)
    console.log('    [SCENARIO B DEBUG] portalSyncRes.json:', portalSyncRes.json)
    assert(
      afterPortalProd?.image === portalChangedShopeeImage,
      'SUITE_4',
      'Scenario B: HONORS portal change! Product image updated to new Shopee image',
      `actual: ${afterPortalProd?.image}, expected: ${portalChangedShopeeImage}`
    )
    const afterPortalAttrs = JSON.parse(afterPortalProd?.attributes || '{}')
    assert(
      afterPortalAttrs.cmsCustomImage === false,
      'SUITE_4',
      'Scenario B: cmsCustomImage reset to false after legitimate portal change'
    )
    assert(
      afterPortalAttrs.lastSyncedShopeeImage === portalChangedShopeeImage,
      'SUITE_4',
      'Scenario B: lastSyncedShopeeImage updated to new Shopee portal image'
    )

    // 4.3 Scenario C: Routine poll on unflagged product updates normally
    console.log('  Testing Scenario C: Routine poll on unflagged product...')
    const unflaggedImage3 = 'https://down-vn.img.susercontent.com/file/vn-11134207-normal-sync'
    const normalSyncRes = await postWebhook({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        sku: cmsCustomSku,
        name: 'Sản Phẩm Bình Thường',
        shopeeItemId: '7766554433',
        shopeeModelId: '7766554433_M1',
        stock: 50,
        sellPrice: 350000,
        image: unflaggedImage3,
      },
    })
    assert(normalSyncRes.ok, 'SUITE_4', 'Normal inbound sync returns HTTP 200')
    const afterNormalProd = await db.product.findUnique({ where: { id: cmsProd.id } })
    console.log('    [SCENARIO C DEBUG] normalSyncRes.json:', normalSyncRes.json)
    console.log('    [SCENARIO C DEBUG] afterNormalProd image:', afterNormalProd?.image)
    console.log('    [SCENARIO C DEBUG] expected image:', unflaggedImage3)
    assert(
      afterNormalProd?.image === unflaggedImage3,
      'SUITE_4',
      'Scenario C: Normal product image synced directly',
      `actual: ${afterNormalProd?.image}, expected: ${unflaggedImage3}`
    )
  } finally {
    // Ensure mock server is cleanly closed
    if (mockDaemonServer) {
      await new Promise<void>((resolve) => {
        (mockDaemonServer as http.Server).close(() => resolve())
      })
    }

    // --------------------------------------------------------------------------
    // TEARDOWN: RESTORE_AND_CLEAN & INVARIANT AUDIT
    // --------------------------------------------------------------------------
    console.log('\n🧹 [PHASE TEARDOWN] Executing RESTORE_AND_CLEAN via Test-Guard...')
    await restoreAndClean({ silent: false })

    console.log('⚖️ [FORENSIC AUDIT] Verifying Shop thaimy1605 Canonical Products Invariant (Delta = 0)...')
    const invariantResult = await assert13RealProductsInvariant(db, { silent: false })
    assert(invariantResult.passed, 'INVARIANT', 'ZERO_DELTA: Canonical Products Invariant Certified (Delta = 0)')
    assert(
      invariantResult.deltas.filter((d) => d.status !== 'MATCH').length === 0,
      'INVARIANT',
      'ZERO_DELTA: Zero stock or price deltas across all products (Delta = 0)'
    )

    console.log('✨ [CLEAN STATE AUDIT] Verifying Ecosystem Clean State...')
    const cleanResult = await verifyCleanState({ silent: false })
    assert(cleanResult.clean, 'CLEAN_STATE', 'Zero leftover test records across all tables')
  }

  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  console.log('\n================================================================================')
  console.log(`📊 EMPIRICAL CHALLENGE VERDICT: ${passed} / ${results.length} PASSED (Failed: ${failed})`)
  console.log('================================================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error in empirical challenger suite:', err)
  process.exit(1)
})
