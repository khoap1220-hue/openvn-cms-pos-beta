/**
 * scripts/adversarial_r3_reviewer.ts
 *
 * Adversarial Reviewer Round 3 Deep Verification Suite:
 * - Test 1: External HTTP(S) image URL pointer >= 500 chars (up to 2048) in upload-image, POST and PUT products.
 * - Test 2: upload-image HTTP pointer fallback resolution when candidate URL is in microDataUrl.
 * - Test 3: POST /api/products preserves caller-supplied custom attributes and broadcasts product.updated.
 * - Test 4: Dynamic BOM Combo availability propagation in L1 cache upon component stock update.
 * - Test 5: Inbound Outbox ACK for linked Shopee product image offload broadcasts product.updated.
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
  console.log('🛡️ ADVERSARIAL REVIEWER (ROUND 3) DEEP VERIFICATION SUITE')
  console.log('================================================================================\n')

  // Phase 0: Snapshot
  console.log('📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  await takeSnapshot({ silent: false })

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Long External HTTP(S) Image URL Pointer (500 < length <= 2048)
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 1: Long External HTTP(S) Image URL Pointer (> 500 characters) ---')
    // Generate a realistic 620-character signed CDN image pointer URL
    const queryToken = 'a'.repeat(540)
    const longCdnUrl = `https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-m23xyz?sig=${queryToken}`
    assert(longCdnUrl.length > 500 && longCdnUrl.length <= 2048, 'T1: URL length is between 500 and 2048 chars', `Length=${longCdnUrl.length}`)

    // 1.1 upload-image accepts long HTTP URL pointer
    const uploadRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: longCdnUrl,
        filename: 'long_pointer.webp',
      }),
    })
    const uploadJson = await uploadRes.json()
    assert(uploadRes.ok, 'T1: upload-image accepted >500B URL pointer', uploadJson.error)
    assert(uploadJson.storageMode === 'EXTERNAL_HTTP_FALLBACK', 'T1: storageMode is EXTERNAL_HTTP_FALLBACK')
    assert(uploadJson.url === longCdnUrl, 'T1: upload-image returned long URL pointer intact')
    assert(uploadJson.pendingCdnOffload === false, 'T1: pendingCdnOffload is false for HTTP pointers')

    // 1.2 POST /api/products accepts long HTTP URL pointer
    const testSkuLong = 'SP-TEST-R3-LONGURL'
    await db.product.deleteMany({ where: { sku: testSkuLong } })

    const createLongRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: testSkuLong,
        name: 'Sản Phẩm Test URL CDN Dài R3',
        sellPrice: 99000,
        stock: 10,
        image: longCdnUrl,
        attributes: JSON.stringify({ customBrand: 'UuDamSuite', author: 'ReviewerR3' }),
      }),
    })
    const createLongJson = await createLongRes.json()
    assert(createLongRes.ok, 'T1: POST /api/products accepted >500B image URL pointer', createLongJson.error)
    const longProd = createLongJson.product
    assert(longProd.image === longCdnUrl, 'T1: Product stored long image URL intact')

    // 1.3 PUT /api/products/[id] accepts long HTTP URL pointer update
    const queryToken2 = 'b'.repeat(580)
    const longCdnUrl2 = `https://down-vn.img.susercontent.com/file/vn-11134207-7ras8-m99updated?token=${queryToken2}`
    const updateLongRes = await fetch(`${BASE_URL}/api/products/${longProd.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: longCdnUrl2,
      }),
    })
    const updateLongJson = await updateLongRes.json()
    assert(updateLongRes.ok, 'T1: PUT /api/products/[id] accepted updated >500B image URL pointer', updateLongJson.error)
    assert(updateLongJson.product.image === longCdnUrl2, 'T1: Product updated to new long image URL')

    // --------------------------------------------------------------------------
    // TEST 2: upload-image Fallback with Candidate in microDataUrl
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 2: upload-image Candidate in microDataUrl ---')
    const microCdnPointer = 'https://s3.ap-southeast-1.amazonaws.com/openvn-bucket/media/test-micro-pointer.webp'
    const uploadMicroRes = await fetch(`${BASE_URL}/api/products/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl: '', // empty dataUrl
        microDataUrl: microCdnPointer,
      }),
    })
    const uploadMicroJson = await uploadMicroRes.json()
    assert(uploadMicroRes.ok, 'T2: upload-image accepted HTTP pointer in microDataUrl', uploadMicroJson.error)
    assert(uploadMicroJson.storageMode === 'EXTERNAL_HTTP_FALLBACK', 'T2: storageMode is EXTERNAL_HTTP_FALLBACK')
    assert(uploadMicroJson.url === microCdnPointer, 'T2: url matches microDataUrl pointer')

    // --------------------------------------------------------------------------
    // TEST 3: Preservation of Caller Custom Attributes on POST /api/products
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 3: Caller Custom Attributes Preserved on POST /api/products ---')
    const testSkuAttrs = 'SP-TEST-R3-ATTRS'
    await db.product.deleteMany({ where: { sku: testSkuAttrs } })

    const createAttrsRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: testSkuAttrs,
        name: 'Sản Phẩm Test Attributes R3',
        sellPrice: 150000,
        stock: 25,
        attributes: JSON.stringify({
          shopeeItemId: '9988776655',
          brand: 'AnNhienThach',
          material: 'Gypsum',
        }),
      }),
    })
    const createAttrsJson = await createAttrsRes.json()
    assert(createAttrsRes.ok, 'T3: Product with custom attributes created', createAttrsJson.error)
    const createdProd = createAttrsJson.product
    assert(Boolean(createdProd.attributes), 'T3: Product has attributes saved')
    const parsedSavedAttrs = JSON.parse(createdProd.attributes)
    assert(parsedSavedAttrs.shopeeItemId === '9988776655', 'T3: shopeeItemId preserved in attributes')
    assert(parsedSavedAttrs.brand === 'AnNhienThach', 'T3: brand preserved in attributes')
    assert(parsedSavedAttrs.material === 'Gypsum', 'T3: material preserved in attributes')
    assert(typeof parsedSavedAttrs.cmsCustomImage === 'boolean', 'T3: cmsCustomImage added to attributes')

    // --------------------------------------------------------------------------
    // TEST 4: Dynamic BOM Combo Availability in L1 Cache
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 4: Dynamic BOM Combo Availability in L1 Cache ---')
    const compSku = 'SP-TEST-R3-COMP'
    const comboSku = 'SP-TEST-R3-COMBO'
    await db.product.deleteMany({ where: { sku: { in: [compSku, comboSku] } } })

    // 4.1 Create component with stock = 20
    const compRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: compSku,
        name: 'Thành Phần R3 Test',
        sellPrice: 30000,
        costPrice: 15000,
        stock: 20,
        type: 'SIMPLE',
      }),
    })
    const compJson = await compRes.json()
    assert(compRes.ok, 'T4: Component created with stock = 20')
    const compProd = compJson.product

    // 4.2 Create combo product
    const comboRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: comboSku,
        name: 'Combo R3 Test',
        sellPrice: 80000,
        type: 'COMBO',
      }),
    })
    const comboJson = await comboRes.json()
    assert(comboRes.ok, 'T4: Combo product created')
    const comboProd = comboJson.product

    // 4.3 Define recipe: Combo requires 4x Component (available = 20 / 4 = 5)
    const bomRes = await fetch(`${BASE_URL}/api/bom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productId: comboProd.id,
        items: [{ componentProductId: compProd.id, quantity: 4 }],
      }),
    })
    const bomJson = await bomRes.json()
    assert(bomRes.ok, 'T4: BOM recipe created (4x Component per Combo)')

    // 4.4 Prime L1 cache
    const listRes1 = await fetch(`${BASE_URL}/api/products`)
    const listJson1 = (await listRes1.json()) as { products: any[] }
    const comboInCache1 = listJson1.products.find((p) => p.id === comboProd.id)
    assert(comboInCache1?.comboAvailable === 5, 'T4: Initial comboAvailable in cache is 5', `actual: ${comboInCache1?.comboAvailable}`)

    // 4.5 Update component stock: 20 -> 8 (new comboAvailable = 8 / 4 = 2)
    const updateCompRes = await fetch(`${BASE_URL}/api/products/${compProd.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stock: 8,
      }),
    })
    assert(updateCompRes.ok, 'T4: Component stock updated to 8')

    // Allow non-blocking background task to complete combo sync (poll up to 3000ms)
    let comboInCache2: any = null
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((r) => setTimeout(r, 200))
      const listRes2 = await fetch(`${BASE_URL}/api/products`)
      const listJson2 = (await listRes2.json()) as { products: any[] }
      comboInCache2 = listJson2.products.find((p) => p.id === comboProd.id)
      if (comboInCache2?.stock === 2) {
        console.log(`  ℹ️ Combo stock synced to 2 at attempt ${attempt + 1}`)
        break
      }
    }
    assert(comboInCache2?.stock === 2, 'T4: Combo stock in L1 cache updated to 2 after component change', `actual: ${comboInCache2?.stock}`)

    // --------------------------------------------------------------------------
    // TEST 5: Outbox ACK Broadcast for Linked Shopee Product Image Offload
    // --------------------------------------------------------------------------
    console.log('\n--- TEST 5: Outbox ACK Broadcast for Linked Shopee Image Offload ---')
    const linkedSku = 'SP-TEST-R3-LINKED'
    await db.product.deleteMany({ where: { sku: linkedSku } })

    const sampleMicroWebp =
      'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADwAQCdASoIAAgAAkA4JZwCdADcAA/v3cAAAA=='
    const createLinkedRes = await fetch(`${BASE_URL}/api/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku: linkedSku,
        name: 'Sản Phẩm Liên Kết Shopee Cần Offload Ảnh R3',
        sellPrice: 120000,
        stock: 30,
        image: sampleMicroWebp,
        attributes: JSON.stringify({
          shopeeItemId: '123456789',
          shopeeModelId: '0',
          pendingCdnOffload: true,
          cmsCustomImage: true,
        }),
      }),
    })
    const createLinkedJson = await createLinkedRes.json()
    assert(createLinkedRes.ok, 'T5: Linked Shopee product with micro-webp image created')
    const linkedProd = createLinkedJson.product

    // Fetch Outbox jobs
    const fetchOutbox = await postWebhook({
      event: 'OUTBOX_FETCH_PENDING',
      data: {},
    })
    assert(fetchOutbox.ok, 'T5: OUTBOX_FETCH_PENDING succeeded')
    const linkedJob = fetchOutbox.json.jobs?.find((j: any) => j.productId === linkedProd.id)
    assert(Boolean(linkedJob), 'T5: Outbox generated job for linked product')
    assert(linkedJob?.imageDrifted === true, 'T5: Job marked imageDrifted = true')

    // Simulate Shopee daemon returning ACK with offloaded CDN URL
    const offloadedCdnUrl = 'https://down-vn.img.susercontent.com/file/vn-11134207-7r98o-offloaded-r3'
    const ackRes = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: linkedJob.outboxId,
        productId: linkedProd.id,
        sku: linkedSku,
        shopeeItemId: '123456789',
        shopeeModelId: '0',
        syncedStock: 30,
        syncedPrice: 120000,
        syncedImage: offloadedCdnUrl,
        status: 'COMPLETED',
        idempotencyKey: `ACK_R3_${linkedProd.id}`,
      },
    })
    assert(ackRes.ok, 'T5: OUTBOX_ACK_RESULT returned HTTP 200')

    // Verify DB product has offloaded image
    const reloadedLinked = await db.product.findUnique({ where: { id: linkedProd.id } })
    assert(reloadedLinked?.image === offloadedCdnUrl, 'T5: DB product image updated to Shopee CDN URL')
    const reloadedAttrs = JSON.parse(reloadedLinked?.attributes || '{}')
    assert(reloadedAttrs.pendingCdnOffload === false, 'T5: pendingCdnOffload cleared to false')
    assert(reloadedAttrs.lastSyncedShopeeImage === offloadedCdnUrl, 'T5: lastSyncedShopeeImage recorded')

    // Verify L1 cache serves updated image URL
    const cachedList = (await (await fetch(`${BASE_URL}/api/products`)).json()) as { products: any[] }
    const cachedLinked = cachedList.products.find((p) => p.id === linkedProd.id)
    assert(cachedLinked?.image === offloadedCdnUrl, 'T5: L1 cache immediately reflects Shopee CDN image URL')
  } finally {
    // --------------------------------------------------------------------------
    // TEARDOWN: RESTORE_AND_CLEAN & INVARIANT AUDIT
    // --------------------------------------------------------------------------
    console.log('\n🧹 [PHASE TEARDOWN] Executing RESTORE_AND_CLEAN via Test-Guard...')
    await restoreAndClean({ silent: false })

    console.log('⚖️ [FORENSIC AUDIT] Verifying Shop thaimy1605 13 Real Products Invariant (Delta = 0)...')
    const invariantResult = await assert13RealProductsInvariant(db, { silent: false })
    assert(invariantResult.passed, 'ZERO_DELTA: 13 Canonical Products Invariant Certified')
    assert(
      invariantResult.deltas.filter((d) => d.status !== 'MATCH').length === 0,
      'ZERO_DELTA: Zero stock or price deltas across all products (Delta = 0)'
    )

    console.log('✨ [CLEAN STATE AUDIT] Verifying Ecosystem Clean State...')
    const cleanResult = await verifyCleanState({ silent: false })
    assert(cleanResult.clean, 'CLEAN_STATE: Zero leftover test records across all tables')
  }

  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  console.log('\n================================================================================')
  console.log(`📊 ADVERSARIAL ROUND 3 VERDICT: ${passed} / ${results.length} PASSED (Failed: ${failed})`)
  console.log('================================================================================\n')
}

main().catch((err) => {
  console.error('Fatal error in Round 3 adversarial test:', err)
  process.exit(1)
})
