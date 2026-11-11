/**
 * scripts/adversarial_r2_reviewer.ts
 *
 * Adversarial Reviewer Round 2 Verification Suite:
 * - Test 1: BOM recipe mutation & products:static_meta cache invalidation (Combo availability & cost recalculation).
 * - Test 2: Product deletion (DELETE /api/products/[id]) cache invalidation (immediate cache eviction, no stale ghost items).
 * - Test 3: Simple linked Shopee item (shopeeItemId present, shopeeModelId = '0') Outbox drift detection & syncing.
 * - Test 4: External HTTP(S) zero-storage image pointer upload fallback.
 * - Invariant Guard: Pre-test Snapshot -> Post-test Restore & Clean -> Delta = 0 certified.
 */

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

interface TestResult {
  name: string
  status: 'PASS' | 'FAIL'
  error?: string
}

const results: TestResult[] = []

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`)
    results.push({ name, status: 'PASS' })
  } else {
    console.error(`  ❌ [FAIL] ${name}${detail ? ` -> ${detail}` : ''}`)
    results.push({ name, status: 'FAIL', error: detail })
    throw new Error(`Assertion failed: ${name} (${detail || 'Condition not met'})`)
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

async function main() {
  console.log('================================================================================')
  console.log('🛡️ ADVERSARIAL REVIEWER (ROUND 2) DEEP VERIFICATION SUITE')
  console.log('================================================================================\n')

  // Phase 0: Snapshot
  console.log('📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  await takeSnapshot({ silent: false })

  try {
    // --------------------------------------------------------------------------
    // TEST 1: BOM Mutation & products:static_meta Cache Invalidation
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 1: BOM Recipe Mutation & products:static_meta Invalidation ---')
    const compASku = 'SP-TEST-R2-COMPA'
    const compBSku = 'SP-TEST-R2-COMPB'
    const comboSku = 'SP-TEST-R2-COMBO'

    await db.product.deleteMany({ where: { sku: { in: [compASku, compBSku, comboSku] } } })

    // 1.1 Create component A (stock 10, cost 10000)
    const compARes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: compASku,
        name: 'Vật Liệu Test R2 - Thành Phần A',
        sellPrice: 20000,
        costPrice: 10000,
        stock: 10,
        type: 'SIMPLE',
      }),
    })
    const compAJson = await compARes.json()
    assert(compARes.ok, 'T1: Component A created', compAJson.error)
    const prodA = compAJson.product

    // 1.2 Create component B (stock 20, cost 5000)
    const compBRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: compBSku,
        name: 'Vật Liệu Test R2 - Thành Phần B',
        sellPrice: 15000,
        costPrice: 5000,
        stock: 20,
        type: 'SIMPLE',
      }),
    })
    const compBJson = await compBRes.json()
    assert(compBRes.ok, 'T1: Component B created', compBJson.error)
    const prodB = compBJson.product

    // 1.3 Create COMBO product
    const comboRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: comboSku,
        name: 'Bộ Combo Test R2 (Thành Phẩm)',
        sellPrice: 50000,
        costPrice: 0,
        stock: 0,
        type: 'COMBO',
      }),
    })
    const comboJson = await comboRes.json()
    assert(comboRes.ok, 'T1: Combo product created', comboJson.error)
    const prodCombo = comboJson.product

    // 1.4 Prime the L1 cache for products
    const initialQueryRes = await fetch(`${BASE_URL}/api/products`)
    const initialQueryJson = await initialQueryRes.json()
    const initialComboInCache = initialQueryJson.products.find((p: any) => p.id === prodCombo.id)
    assert(Boolean(initialComboInCache), 'T1: Initial products cache populated with COMBO item')
    assert(initialComboInCache.comboAvailable === 0, 'T1: Initial comboAvailable = 0 before recipe definition')

    // 1.5 Define BOM via POST /api/bom: recipe 2x Component A + 1x Component B
    const bomRes = await fetch(`${BASE_URL}/api/bom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: prodCombo.id,
        items: [
          { componentProductId: prodA.id, quantity: 2 },
          { componentProductId: prodB.id, quantity: 1 },
        ],
      }),
    })
    const bomJson = await bomRes.json()
    assert(bomRes.ok, 'T1: BOM recipe defined successfully via POST /api/bom', bomJson.error)

    // 1.6 Immediately query GET /api/products: must reflect updated comboAvailable = 5 (10 / 2) and comboCostPrice = 25000 (2*10k + 1*5k)
    const afterBomQueryRes = await fetch(`${BASE_URL}/api/products`)
    const afterBomQueryJson = await afterBomQueryRes.json()
    const afterBomCombo = afterBomQueryJson.products.find((p: any) => p.id === prodCombo.id)
    assert(Boolean(afterBomCombo), 'T1: COMBO product found in products query after BOM update')
    assert(afterBomCombo.comboAvailable === 5, 'T1: products:static_meta invalidated: comboAvailable = 5 (10 / 2)', `actual: ${afterBomCombo.comboAvailable}`)
    assert(afterBomCombo.comboCostPrice === 25000, 'T1: comboCostPrice = 25,000đ (2x10,000 + 1x5,000)', `actual: ${afterBomCombo.comboCostPrice}`)

    // --------------------------------------------------------------------------
    // TEST 2: DELETE /api/products/[id] Cache Invalidation
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: Product Deletion & Immediate L1 Cache Eviction ---')
    // Prime the cache
    const preDeleteQueryRes = await fetch(`${BASE_URL}/api/products`)
    const preDeleteQueryJson = await preDeleteQueryRes.json()
    assert(preDeleteQueryJson.products.some((p: any) => p.id === prodCombo.id), 'T2: COMBO product exists in L1 cache before DELETE')

    // Delete the COMBO product
    const deleteRes = await fetch(`${BASE_URL}/api/products/${prodCombo.id}`, {
      method: 'DELETE',
    })
    assert(deleteRes.ok, 'T2: DELETE /api/products/[id] succeeded')

    // Immediate query of /api/products must NOT contain the deleted product
    const postDeleteQueryRes = await fetch(`${BASE_URL}/api/products`)
    const postDeleteQueryJson = await postDeleteQueryRes.json()
    const stillPresent = postDeleteQueryJson.products.some((p: any) => p.id === prodCombo.id)
    assert(!stillPresent, 'T2: Deleted product immediately evicted from L1 cache (No ghost item!)')

    // Clean up component items
    await fetch(`${BASE_URL}/api/products/${prodA.id}`, { method: 'DELETE' })
    await fetch(`${BASE_URL}/api/products/${prodB.id}`, { method: 'DELETE' })

    // --------------------------------------------------------------------------
    // TEST 3: Simple Linked Shopee Item (shopeeModelId = '0') Outbox Sync
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: Simple Linked Shopee Item (modelId = 0) Outbox Sync ---')
    const simpleShopeeSku = 'SP-TEST-SHOPEE-SIMPLE-01'
    await db.product.deleteMany({ where: { sku: simpleShopeeSku } })

    const createSimpleRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: simpleShopeeSku,
        name: 'Sản phẩm Shopee Đơn giản Không Phân loại',
        sellPrice: 120000,
        costPrice: 60000,
        stock: 50,
        type: 'SIMPLE',
      }),
    })
    const createSimpleJson = await createSimpleRes.json()
    assert(createSimpleRes.ok, 'T3: Simple Shopee test product created')
    const simpleProd = createSimpleJson.product

    // Bind Shopee link attributes: shopeeItemId = '777888999', shopeeModelId = '0'
    const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
    if (shopeeChannel) {
      await db.channelListing.create({
        data: {
          productId: simpleProd.id,
          channelId: shopeeChannel.id,
          price: 120000,
          status: 'ACTIVE',
        },
      })
    }
    await db.product.update({
      where: { id: simpleProd.id },
      data: {
        attributes: JSON.stringify({
          brandLine: 'An Nhiên Thạch · Shopee Sync',
          shopeeItemId: '777888999',
          shopeeModelId: '0',
          lastSyncedShopeeStock: 50,
          lastSyncedShopeePrice: 120000,
          lastSyncedShopeeUnlisted: false,
          isUnlistedOnShopee: false,
        }),
      },
    })

    // Modify stock via PUT /api/products/[id]
    const updateStockRes = await fetch(`${BASE_URL}/api/products/${simpleProd.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock: 45,
        sellPrice: 125000,
      }),
    })
    assert(updateStockRes.ok, 'T3: PUT product stock=45, price=125000 succeeded')

    // Fetch Outbox jobs
    const fetchOutboxRes = await postWebhook({
      event: 'OUTBOX_FETCH_PENDING',
      data: {},
    })
    assert(fetchOutboxRes.ok, 'T3: OUTBOX_FETCH_PENDING succeeded')
    const simpleJob = (fetchOutboxRes.json.jobs || []).find((j: any) => j.productId === simpleProd.id)
    assert(Boolean(simpleJob), 'T3: Outbox generated sync job for simple Shopee item (NOT dropped as unlinked!)')
    assert(simpleJob?.shopeeItemId === '777888999', 'T3: Job has valid shopeeItemId = 777888999')
    assert(simpleJob?.shopeeModelId === '0', 'T3: Job has shopeeModelId = 0')
    assert(simpleJob?.targetStock === 45, 'T3: Job targetStock = 45')
    assert(simpleJob?.targetPrice === 125000, 'T3: Job targetPrice = 125000')
    assert(simpleJob?.stockDrifted === true, 'T3: stockDrifted = true')
    assert(simpleJob?.priceDrifted === true, 'T3: priceDrifted = true')

    // Send ACK COMPLETED
    const ackRes = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: simpleJob.outboxId,
        productId: simpleProd.id,
        sku: simpleShopeeSku,
        shopeeItemId: '777888999',
        shopeeModelId: '0',
        status: 'COMPLETED',
        syncedStock: 45,
        syncedPrice: 125000,
        syncedUnlisted: false,
        idempotencyKey: `ACK_SIMPLE_${Date.now()}`,
      },
    })
    assert(ackRes.ok, 'T3: OUTBOX_ACK_RESULT returned HTTP 200')

    const verifiedProd = await db.product.findUnique({ where: { id: simpleProd.id } })
    const verifiedAttrs = JSON.parse(verifiedProd?.attributes || '{}')
    assert(verifiedAttrs.lastSyncedShopeeStock === 45, 'T3: lastSyncedShopeeStock updated to 45')
    assert(verifiedAttrs.lastSyncedShopeePrice === 125000, 'T3: lastSyncedShopeePrice updated to 125000')
    assert(verifiedAttrs.pendingOutboxSync === false, 'T3: pendingOutboxSync cleared to false')

    // Clean up test product
    await fetch(`${BASE_URL}/api/products/${simpleProd.id}`, { method: 'DELETE' })

    // --------------------------------------------------------------------------
    // TEST 4: Zero-Storage External HTTP(S) Image Pointer Fallback
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 4: External HTTP(S) URL Zero-Storage Image Pointer Fallback ---')
    const testHttpUrl = 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-pointer-test99'
    const uploadRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: testHttpUrl,
        filename: 'pointer.jpg',
      }),
    })
    const uploadJson = await uploadRes.json()
    assert(uploadRes.ok, 'T4: POST /api/products/upload-image accepted HTTP URL pointer', uploadJson.error)
    assert(Boolean(uploadJson.url), 'T4: upload-image returned image URL')
    assert(uploadJson.bytesInDb <= 150, 'T4: bytesInDb <= 150 bytes (Zero-Storage Pointer verified)', `${uploadJson.bytesInDb}B`)

  } finally {
    // --------------------------------------------------------------------------
    // TEARDOWN PHASE
    // --------------------------------------------------------------------------
    console.log('\n🧹 [PHASE TEARDOWN] Executing RESTORE_AND_CLEAN via Test-Guard...')
    const teardownRes = await restoreAndClean({ silent: false })
    assert(teardownRes.ok, 'TEARDOWN: restoreAndClean executed successfully')

    console.log('⚖️ [FORENSIC AUDIT] Verifying Shop thaimy1605 13 Real Products Invariant (Delta = 0)...')
    const invariant = await assert13RealProductsInvariant({ silent: false })
    assert(invariant.passed, 'ZERO_DELTA: 13 Canonical Products Invariant Certified')
    assert(invariant.deltaCount === 0, 'ZERO_DELTA: Zero stock or price deltas across all products (Delta = 0)')

    console.log('✨ [CLEAN STATE AUDIT] Verifying Ecosystem Clean State...')
    const cleanCheck = await verifyCleanState({ silent: false })
    assert(cleanCheck.clean, 'CLEAN_STATE: Zero leftover test records across all tables')
  }

  console.log('\n================================================================================')
  console.log(`📊 ADVERSARIAL ROUND 2 VERDICT: ${results.filter((r) => r.status === 'PASS').length} / ${results.length} PASSED`)
  console.log('================================================================================')
}

main().catch((err) => {
  console.error('\n❌ FATAL TEST FAILURE:', err)
  process.exit(1)
})
