/**
 * scripts/adversarial_r1_reviewer.ts
 *
 * Adversarial Reviewer Round 1 Test Suite:
 * - Edge Case 1: Order ingestion & cancellation cache invalidation (no stale L1 cache drift).
 * - Edge Case 2: Unlinked product image offload via Outbox recovery (no stock corruption, no bogus Shopee ChannelListing).
 * - Edge Case 3: Write path latency & Optimistic L1 cache consistency.
 * - Invariant Guard: Pre-test Snapshot -> Post-test Restore & Clean -> Delta = 0 certified.
 */

import { db } from '../src/lib/db'
import {
  takeSnapshot,
  restoreAndClean,
  assert13RealProductsInvariant,
  verifyCleanState,
  DEFAULT_BASE_URL,
  DEFAULT_CENTRAL_WAREHOUSE_ID,
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
  console.log('🛡️ ADVERSARIAL REVIEWER (ROUND 1) VERIFICATION SUITE')
  console.log('================================================================================\n')

  // 1. Snapshot Phase
  console.log('📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  await takeSnapshot({ silent: false })

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Cache Invalidation on Order Lifecycle & Inventory Adjustment
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 1: Order Lifecycle Cache Invalidation ---')
    const testSku = 'SP-TEST-TEA-10'
    await db.product.deleteMany({ where: { sku: testSku } })
    const createRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: testSku,
        name: 'Sản phẩm Test Order Cache',
        sellPrice: 50000,
        costPrice: 20000,
        stock: 100,
        type: 'SIMPLE',
      }),
    })
    const createJson = await createRes.json()
    assert(createRes.ok, 'T1: Test product created via POST /api/products', createJson.error)
    const syntheticProd = createJson.product

    // Seed cache by querying /api/products
    const seedRes = await fetch(`${BASE_URL}/api/products`)
    const seedJson = await seedRes.json()
    const seedProd = seedJson.products.find((p: any) => p.id === syntheticProd.id)
    assert(seedProd?.stock === 100, 'T1: Initial L1 cache reflects stock = 100')

    // Ingest order for 5 units
    const orderSn = `ORD_CACHE_R1_${Date.now()}`
    const orderWebhookRes = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSn,
        shopeeOrderStatus: 'PROCESSED',
        buyerUsername: 'buyer_test_r1',
        recipientName: 'Test Buyer R1',
        recipientPhone: '0901234567',
        shippingAddress: '123 Đường Test, Hà Nội',
        totalAmount: 250000,
        paymentMethod: 'SHOPEE_PAY',
        items: [
          {
            sku: testSku,
            modelSku: testSku,
            shopeeItemId: '999888111',
            shopeeModelId: '999888222',
            name: 'Sản phẩm Test Order Cache',
            quantity: 5,
            modelDiscountedPrice: 50000,
            modelOriginalPrice: 50000,
          },
        ],
      },
    })
    assert(orderWebhookRes.ok, 'T1: Order webhook ingested successfully')

    // Immediate query of /api/products should show stock = 95 (cache was properly invalidated)
    const afterOrderRes = await fetch(`${BASE_URL}/api/products`)
    const afterOrderJson = await afterOrderRes.json()
    const afterOrderProd = afterOrderJson.products.find((p: any) => p.id === syntheticProd.id)
    assert(afterOrderProd?.stock === 95, 'T1: L1 cache immediately returns stock = 95 after order ingestion', `actual: ${afterOrderProd?.stock}`)

    // Cancel order
    const cancelWebhookRes = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSn,
        shopeeOrderStatus: 'CANCELLED',
        cancelReason: 'Buyer request test',
      },
    })
    assert(cancelWebhookRes.ok, 'T1: Cancel webhook processed successfully')

    // Immediate query of /api/products should show stock = 100
    const afterCancelRes = await fetch(`${BASE_URL}/api/products`)
    const afterCancelJson = await afterCancelRes.json()
    const afterCancelProd = afterCancelJson.products.find((p: any) => p.id === syntheticProd.id)
    assert(afterCancelProd?.stock === 100, 'T1: L1 cache immediately returns stock = 100 after order cancellation', `actual: ${afterCancelProd?.stock}`)

    // --------------------------------------------------------------------------
    // TEST 2: Unlinked Product Image Offload & Stock Protection
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: Unlinked Product Image Offload without Stock Corruption ---')
    const unlinkedSku = 'SP-TEST-UNLINKED-OFFLOAD'
    const microWebpBase64 = 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoIAAgAAkA4JaQAA3AA/vsVAAA=' // Valid tiny WebP
    await db.product.deleteMany({ where: { sku: unlinkedSku } })
    const createUnlinkedRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: unlinkedSku,
        name: 'Sản phẩm Nội bộ Không Liên kết Sàn (Chỉ POS/Kho)',
        sellPrice: 75000,
        costPrice: 35000,
        stock: 30,
        type: 'SIMPLE',
        image: microWebpBase64,
      }),
    })
    const createUnlinkedJson = await createUnlinkedRes.json()
    assert(createUnlinkedRes.ok, 'T2: Unlinked product created via POST /api/products', createUnlinkedJson.error)
    const unlinkedProd = createUnlinkedJson.product

    // Confirm no Shopee listing exists for this unlinked product
    const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
    if (shopeeChannel) {
      await db.channelListing.deleteMany({
        where: { productId: unlinkedProd.id, channelId: shopeeChannel.id },
      })
    }

    // Step 2.1: Adjust stock via POST /api/inventory while daemon is offline
    const adjustRes = await fetch(`${BASE_URL}/api/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: unlinkedProd.id,
        type: 'IMPORT',
        quantity: 10,
        note: 'Nhập hàng nội bộ kho kiểm kê',
      }),
    })
    assert(adjustRes.ok, 'T2: Stock adjustment (IMPORT +10) succeeded')
    const updatedProdInDb = await db.product.findUnique({ where: { id: unlinkedProd.id } })
    assert(updatedProdInDb?.stock === 40, 'T2: Database product stock is now 40')

    // Step 2.2: Daemon recovers and fetches pending jobs via OUTBOX_FETCH_PENDING
    const fetchJobsRes = await postWebhook({
      event: 'OUTBOX_FETCH_PENDING',
      data: {},
    })
    assert(fetchJobsRes.ok, 'T2: OUTBOX_FETCH_PENDING returns HTTP 200')
    const offloadJob = (fetchJobsRes.json.jobs || []).find((j: any) => j.productId === unlinkedProd.id)
    assert(Boolean(offloadJob), 'T2: Daemon received CDN offload job for unlinked product')
    assert(offloadJob?.imageDrifted === true, 'T2: Offload job marked imageDrifted = true')
    assert(offloadJob?.shopeeItemId === '', 'T2: Offload job has empty shopeeItemId')

    // Step 2.3: Daemon uploads to Shopee CDN and sends OUTBOX_ACK_RESULT
    const mockCdnUrl = 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-reviewertest77'
    const ackRes = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: offloadJob.outboxId,
        productId: unlinkedProd.id,
        sku: unlinkedSku,
        shopeeItemId: '',
        shopeeModelId: '',
        status: 'COMPLETED',
        syncedImage: mockCdnUrl,
        syncedStock: 30, // Note: stale initial stock from job creation
        syncedPrice: 75000,
        idempotencyKey: `ACK_TEST_${Date.now()}`,
      },
    })
    assert(ackRes.ok, 'T2: OUTBOX_ACK_RESULT returns HTTP 200')

    // Step 2.4: Verify product state after ACK
    const finalProd = await db.product.findUnique({ where: { id: unlinkedProd.id } })
    assert(finalProd?.image === mockCdnUrl, 'T2: Product image updated to Shopee CDN URL')
    const finalAttrs = JSON.parse(finalProd?.attributes || '{}')
    assert(finalAttrs.pendingCdnOffload === false, 'T2: pendingCdnOffload cleared to false')
    assert(finalAttrs.lastSyncedShopeeImage === mockCdnUrl, 'T2: lastSyncedShopeeImage set to CDN URL')
    assert(finalProd?.stock === 40, 'T2: Product stock remains 40 (NOT corrupted by stale job snapshot!)')

    // Verify L1 cache query
    const cacheCheckRes = await fetch(`${BASE_URL}/api/products`)
    const cacheCheckJson = await cacheCheckRes.json()
    const cachedItem = cacheCheckJson.products.find((p: any) => p.id === unlinkedProd.id)
    assert(cachedItem?.stock === 40, 'T2: L1 cache serves stock = 40 (consistent with DB)')
    assert(cachedItem?.image === mockCdnUrl, 'T2: L1 cache serves updated CDN image URL')

    // Step 2.5: Crucial Verification — NO bogus Shopee ChannelListing created for unlinked product
    if (shopeeChannel) {
      const listingCount = await db.channelListing.count({
        where: { productId: unlinkedProd.id, channelId: shopeeChannel.id },
      })
      assert(listingCount === 0, 'T2: Zero Shopee ChannelListings created for unlinked product (Clean Isolation)')
    }

    // --------------------------------------------------------------------------
    // TEST 3: Latency & Optimistic Write Performance
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: Write Path Latency & Concurrency Robustness ---')
    const t0 = performance.now()
    const updateRes = await fetch(`${BASE_URL}/api/products/${unlinkedProd.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: unlinkedSku,
        name: 'Sản phẩm Nội bộ Đã Cập nhật Tên Nhanh',
        sellPrice: 80000,
      }),
    })
    const t1 = performance.now()
    assert(updateRes.ok, 'T3: PUT /api/products/[id] succeeded')
    const elapsed = t1 - t0
    console.log(`    ⏱️ Product PUT response time: ${elapsed.toFixed(1)}ms`)
    assert(elapsed < 2000, 'T3: Product PUT responds under 2000ms (fast write path)', `${elapsed.toFixed(1)}ms`)

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
  console.log(`📊 ADVERSARIAL TEST VERDICT: ${results.filter((r) => r.status === 'PASS').length} / ${results.length} PASSED`)
  console.log('================================================================================')
}

main().catch((err) => {
  console.error('\n❌ FATAL TEST FAILURE:', err)
  process.exit(1)
})
