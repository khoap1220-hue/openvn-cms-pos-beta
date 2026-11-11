/**
 * scripts/stress_m2_adversarial_challenger.ts
 *
 * ADVERSARIAL STRESS TEST SUITE — MILESTONE 2: FEATURES 6 & 7
 * OPENVN · Ưu Đàm Suite Shopee Seller Sync Production Hardening
 *
 * EMPIRICAL CHALLENGER MISSION:
 * 1. Adversarial Status Transitions (Terminal State Lock):
 *    - COMPLETED -> CONFIRMED (HTTP 409 Conflict)
 *    - COMPLETED -> SHIPPING (HTTP 409 Conflict)
 *    - COMPLETED order direct cancellation rejection
 *    - CANCELLED -> CONFIRMED (HTTP 409 Conflict)
 *    - CANCELLED -> SHIPPING (HTTP 409 Conflict)
 *    - CANCELLED -> COMPLETED (HTTP 409 Conflict)
 * 2. Idempotent Replays & Redundant Operations Guard:
 *    - Replay COMPLETED -> HTTP 200 SKIPPED_IDEMPOTENT, zero redundant operations
 *    - Replay CANCELLED -> HTTP 200 SKIPPED_IDEMPOTENT, zero duplicate restock
 *    - Direct cancelOrder on already CANCELLED -> alreadyCancelled: true
 * 3. Concurrent & Duplicate Cancellation Stress:
 *    - 5 concurrent cancelOrder() calls: EXACTLY 1 restocks, 4 return alreadyCancelled: true
 *    - 5 concurrent Inbound Webhook cancellation calls: EXACTLY 1 restocks, zero duplicate stock
 * 4. Pre-Cancelled Order Ingestion:
 *    - Simple product arriving cancelled (shopeeOrderStatus: '306') -> zero stock deduction
 *    - COMBO product arriving cancelled -> zero BOM component stock deduction
 *    - Out-Of-Stock (stock: 0) product arriving cancelled -> succeeds without HTTP 422
 * 5. Data Isolation Invariant (R2):
 *    - takeSnapshot() before, restoreAndClean() in finally
 *    - Supabase PostgreSQL 13 Canonical Products: Delta = 0
 *    - SQLite custom.db 13 Canonical Products: Delta = 0
 *    - verifyCleanState(): leftoverCount = 0
 */

import path from 'node:path'
import fs from 'node:fs'
import { db } from '../src/lib/db'
import { cancelOrder, createOrder } from '../src/lib/order-service'
import {
  takeSnapshot,
  restoreAndClean,
  verifyCleanState,
  assert13RealProductsInvariant,
  AUTHORITATIVE_13_PRODUCTS,
  DEFAULT_CENTRAL_WAREHOUSE_ID,
  DEFAULT_BASE_URL,
} from './test_guard_helper'

const CMS_API_KEY = '191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955'

interface WebhookResponse {
  status: number
  ok: boolean
  json: any
}

async function postWebhook(body: any, baseUrl = DEFAULT_BASE_URL): Promise<WebhookResponse> {
  const res = await fetch(`${baseUrl}/api/webhooks/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Apikey ${CMS_API_KEY}`,
    },
    body: JSON.stringify(body),
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

let totalAssertions = 0
let passedAssertions = 0
const failures: string[] = []

function assert(condition: boolean, suite: string, message: string, detail?: string) {
  totalAssertions++
  if (condition) {
    passedAssertions++
    console.log(`  ✅ [PASS] [${suite}] ${message}`)
  } else {
    const errMsg = `❌ [FAIL] [${suite}] ${message}${detail ? ` (${detail})` : ''}`
    console.error(errMsg)
    failures.push(errMsg)
  }
}

async function runAdversarialStressSuite() {
  console.log('================================================================================')
  console.log('⚔️  ADVERSARIAL STRESS CHALLENGER SUITE: MILESTONE 2 (FEATURES 6 & 7)')
  console.log('================================================================================')

  // PHASE 0: Snapshot Baseline
  console.log('\n📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  const snapRes = await takeSnapshot({ autoCleanFirst: true, silent: false })
  assert(snapRes.ok && snapRes.productCount === 13, 'PHASE-0', 'Pre-test snapshot successful (13 canonical products frozen)')

  try {
    // ========================================================================
    // SUITE 1: ADVERSARIAL STATUS TRANSITIONS (TERMINAL STATE LOCK)
    // ========================================================================
    console.log('\n--- SUITE 1: Adversarial Status Transitions (Terminal State Lock) ---')

    // Setup 1.1: Order progressing to COMPLETED
    const orderSnComp = `[TEST]_R2_ADV_ORDER_COMP_${Date.now()}`
    const rCompCreate = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnComp,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách Kiểm Định M2 Comp',
        customerPhone: '0912345678',
        items: [{ sku: 'BM-TEA-10', quantity: 1 }],
      },
    })
    assert(rCompCreate.ok, 'S1-COMPLETED-LOCK', `Order ${orderSnComp} created via inbound sync`, `Status: ${rCompCreate.status}, Payload: ${JSON.stringify(rCompCreate.json)}`)
    const compOrderId = rCompCreate.json.order?.id
    assert(Boolean(compOrderId), 'S1-COMPLETED-LOCK', 'Order ID returned from creation')

    // Progress to SHIPPING
    const rCompShip = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnComp, shopeeOrderStatus: '304' },
    })
    assert(rCompShip.ok && rCompShip.json.order?.status === 'SHIPPING', 'S1-COMPLETED-LOCK', 'Progressed to SHIPPING (304)')

    // Progress to COMPLETED
    const rCompDone = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnComp, shopeeOrderStatus: '305' },
    })
    assert(rCompDone.ok && rCompDone.json.order?.status === 'COMPLETED', 'S1-COMPLETED-LOCK', 'Progressed to COMPLETED (305)')

    // Attack 1.1A: Backward transition COMPLETED -> CONFIRMED (302)
    const rBack302 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnComp, shopeeOrderStatus: '302' },
    })
    assert(rBack302.status === 409, 'S1-COMPLETED-LOCK', 'COMPLETED -> CONFIRMED (302) is rejected with HTTP 409 Conflict')
    assert(
      typeof rBack302.json.error === 'string' && rBack302.json.error.includes('trạng thái cuối'),
      'S1-COMPLETED-LOCK',
      'HTTP 409 payload correctly cites terminal state violation'
    )
    const dbOrderAfter302 = await db.order.findUnique({ where: { id: compOrderId } })
    assert(dbOrderAfter302?.status === 'COMPLETED', 'S1-COMPLETED-LOCK', 'Order status in DB strictly remained COMPLETED after rejected 302')

    // Attack 1.1B: Backward transition COMPLETED -> SHIPPING (304)
    const rBack304 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnComp, shopeeOrderStatus: '304' },
    })
    assert(rBack304.status === 409, 'S1-COMPLETED-LOCK', 'COMPLETED -> SHIPPING (304) is rejected with HTTP 409 Conflict')
    const dbOrderAfter304 = await db.order.findUnique({ where: { id: compOrderId } })
    assert(dbOrderAfter304?.status === 'COMPLETED', 'S1-COMPLETED-LOCK', 'Order status in DB strictly remained COMPLETED after rejected 304')

    // Attack 1.1C: Direct cancelOrder() on COMPLETED order
    let directCancelThrew = false
    try {
      await cancelOrder({ orderId: compOrderId, reason: 'Adversarial Direct Cancel on COMPLETED' })
    } catch (err: any) {
      directCancelThrew = true
      assert(err.message.includes('Không thể hủy đơn hàng đã hoàn tất'), 'S1-COMPLETED-LOCK', 'cancelOrder() threw expected error on completed order')
    }
    assert(directCancelThrew, 'S1-COMPLETED-LOCK', 'cancelOrder() refused cancellation of COMPLETED order')
    const dbOrderAfterDirectCancel = await db.order.findUnique({ where: { id: compOrderId } })
    assert(dbOrderAfterDirectCancel?.status === 'COMPLETED', 'S1-COMPLETED-LOCK', 'Order status in DB strictly remained COMPLETED after direct cancel attempt')

    // Setup 1.2: Order progressing to CANCELLED
    const orderSnCanc = `[TEST]_R2_ADV_ORDER_CANC_${Date.now()}`
    const rCancCreate = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnCanc,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách Kiểm Định M2 Canc',
        customerPhone: '0912345678',
        items: [{ sku: 'BM-TEA-10', quantity: 1 }],
      },
    })
    assert(rCancCreate.ok, 'S1-CANCELLED-LOCK', `Order ${orderSnCanc} created via inbound sync`, `Status: ${rCancCreate.status}, Payload: ${JSON.stringify(rCancCreate.json)}`)
    const cancOrderId = rCancCreate.json.order?.id
    assert(Boolean(cancOrderId), 'S1-CANCELLED-LOCK', 'Order ID returned from creation')

    // Transition to CANCELLED
    const rCancDone = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnCanc, shopeeOrderStatus: '306' },
    })
    assert(rCancDone.ok && rCancDone.json.action === 'ORDER_CANCELLED_RESTOCKED', 'S1-CANCELLED-LOCK', 'Order transitioned to CANCELLED with restock')

    // Attack 1.2A: Backward transition CANCELLED -> CONFIRMED (302)
    const rCancBack302 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnCanc, shopeeOrderStatus: '302' },
    })
    assert(rCancBack302.status === 409, 'S1-CANCELLED-LOCK', 'CANCELLED -> CONFIRMED (302) is rejected with HTTP 409 Conflict', `Actual status: ${rCancBack302.status}, Payload: ${JSON.stringify(rCancBack302.json)}`)
    const dbOrderAfterCanc302 = await db.order.findUnique({ where: { id: cancOrderId } })
    assert(dbOrderAfterCanc302?.status === 'CANCELLED', 'S1-CANCELLED-LOCK', 'Order status in DB strictly remained CANCELLED after rejected 302', `Actual DB status: ${dbOrderAfterCanc302?.status}`)

    // Attack 1.2B: Backward transition CANCELLED -> SHIPPING (304)
    const rCancBack304 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnCanc, shopeeOrderStatus: '304' },
    })
    assert(rCancBack304.status === 409, 'S1-CANCELLED-LOCK', 'CANCELLED -> SHIPPING (304) is rejected with HTTP 409 Conflict', `Actual status: ${rCancBack304.status}, Payload: ${JSON.stringify(rCancBack304.json)}`)
    const dbOrderAfterCanc304 = await db.order.findUnique({ where: { id: cancOrderId } })
    assert(dbOrderAfterCanc304?.status === 'CANCELLED', 'S1-CANCELLED-LOCK', 'Order status in DB strictly remained CANCELLED after rejected 304', `Actual DB status: ${dbOrderAfterCanc304?.status}`)

    // Attack 1.2C: Backward transition CANCELLED -> COMPLETED (305)
    const rCancBack305 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnCanc, shopeeOrderStatus: '305' },
    })
    assert(rCancBack305.status === 409, 'S1-CANCELLED-LOCK', 'CANCELLED -> COMPLETED (305) is rejected with HTTP 409 Conflict', `Actual status: ${rCancBack305.status}, Payload: ${JSON.stringify(rCancBack305.json)}`)
    const dbOrderAfterCanc305 = await db.order.findUnique({ where: { id: cancOrderId } })
    assert(dbOrderAfterCanc305?.status === 'CANCELLED', 'S1-CANCELLED-LOCK', 'Order status in DB strictly remained CANCELLED after rejected 305', `Actual DB status: ${dbOrderAfterCanc305?.status}`)

    // ========================================================================
    // SUITE 2: IDEMPOTENT REPLAYS & REDUNDANT OPERATIONS GUARD
    // ========================================================================
    console.log('\n--- SUITE 2: Idempotent Replays & Redundant Operations Guard ---')

    // 2.1 Replay COMPLETED on COMPLETED order
    const rCompReplay = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnComp, shopeeOrderStatus: '305' },
    })
    assert(rCompReplay.status === 200, 'S2-IDEMPOTENT', 'Replay COMPLETED returns HTTP 200')
    assert(rCompReplay.json.action === 'SKIPPED_IDEMPOTENT', 'S2-IDEMPOTENT', 'Replay COMPLETED returns action: SKIPPED_IDEMPOTENT')
    assert(rCompReplay.json.order?.status === 'COMPLETED', 'S2-IDEMPOTENT', 'Order status remains COMPLETED')

    // 2.2 Replay CANCELLED on CANCELLED order
    const tea10StockBeforeReplay = (await db.product.findUnique({ where: { sku: 'BM-TEA-10' } }))!.stock
    const rCancReplay = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnCanc, shopeeOrderStatus: '306' },
    })
    assert(rCancReplay.status === 200, 'S2-IDEMPOTENT', 'Replay CANCELLED returns HTTP 200')
    assert(rCancReplay.json.action === 'SKIPPED_IDEMPOTENT', 'S2-IDEMPOTENT', 'Replay CANCELLED returns action: SKIPPED_IDEMPOTENT')
    const tea10StockAfterReplay = (await db.product.findUnique({ where: { sku: 'BM-TEA-10' } }))!.stock
    assert(tea10StockAfterReplay === tea10StockBeforeReplay, 'S2-IDEMPOTENT', 'Zero duplicate inventory restocked on CANCELLED replay (Delta = 0)', `Before: ${tea10StockBeforeReplay}, After: ${tea10StockAfterReplay}`)

    // 2.3 Direct cancelOrder() on already CANCELLED order
    let directCancReplay: any = null
    try {
      directCancReplay = await cancelOrder({ orderId: cancOrderId, reason: 'Idempotent cancelOrder call' })
    } catch (err: any) {
      directCancReplay = { ok: false, error: err.message }
    }
    assert(directCancReplay?.ok === true, 'S2-IDEMPOTENT', 'cancelOrder() returns ok: true on already CANCELLED order', `Result: ${JSON.stringify(directCancReplay)}`)
    assert(directCancReplay?.alreadyCancelled === true, 'S2-IDEMPOTENT', 'cancelOrder() returns alreadyCancelled: true')
    assert(directCancReplay?.restockedCount === 0, 'S2-IDEMPOTENT', 'cancelOrder() restockedCount is 0 on duplicate call')

    // ========================================================================
    // SUITE 3: CONCURRENT & DUPLICATE CANCELLATION STRESS (5 SIMULTANEOUS CALLS)
    // ========================================================================
    console.log('\n--- SUITE 3: Concurrent & Duplicate Cancellation Stress (5 Concurrent Calls) ---')

    // Test 3.1: 5 Concurrent cancelOrder() function calls
    console.log('  ▶ [Test 3.1] 5 Concurrent cancelOrder() CAS stress test')
    const tea50Prod = await db.product.findUnique({ where: { sku: 'BM-TEA-50' } })
    assert(Boolean(tea50Prod), 'S3-CONCURRENCY-5X', 'BM-TEA-50 product exists')
    const stock31Before = tea50Prod!.stock

    const shopeeChan = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
    assert(Boolean(shopeeChan), 'S3-CONCURRENCY-5X', 'SHOPEE channel exists')

    // Create active order with 2x BM-TEA-50 directly
    const ord31 = await createOrder({
      channelId: shopeeChan!.id,
      items: [{ productId: tea50Prod!.id, quantity: 2 }],
      customerName: 'Khách Stress 5x CAS',
      customerPhone: '0912345678',
      note: '[TEST] Concurrency Stress 5x cancelOrder',
      paymentMethod: 'SHOPEE_WALLET',
    })
    const stock31During = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stock31During === stock31Before - 2, 'S3-CONCURRENCY-5X', `Stock deducted by 2 (before: ${stock31Before}, during: ${stock31During})`)

    // Fire 5 CONCURRENT cancelOrder calls
    console.log('    ⚡ Firing 5 concurrent cancelOrder() calls via Promise.all()...')
    const concurResults = await Promise.all([
      cancelOrder({ orderId: ord31.id, reason: 'Concurrent Cancel Shot 1' }),
      cancelOrder({ orderId: ord31.id, reason: 'Concurrent Cancel Shot 2' }),
      cancelOrder({ orderId: ord31.id, reason: 'Concurrent Cancel Shot 3' }),
      cancelOrder({ orderId: ord31.id, reason: 'Concurrent Cancel Shot 4' }),
      cancelOrder({ orderId: ord31.id, reason: 'Concurrent Cancel Shot 5' }),
    ])

    const successWinners = concurResults.filter((r) => r.ok && !r.alreadyCancelled)
    const idempotentLosers = concurResults.filter((r) => r.ok && r.alreadyCancelled)

    assert(successWinners.length === 1, 'S3-CONCURRENCY-5X', `EXACTLY ONE execution succeeded with restock (actual: ${successWinners.length}/5)`)
    assert(idempotentLosers.length === 4, 'S3-CONCURRENCY-5X', `ALL 4 other concurrent executions returned alreadyCancelled: true (actual: ${idempotentLosers.length}/5)`)
    assert(successWinners[0].restockedCount === 1, 'S3-CONCURRENCY-5X', 'Winning execution restocked 1 SKU')

    // Verify final stock is exactly restored to baseline
    const stock31After = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stock31After === stock31Before, 'S3-CONCURRENCY-5X', `Final stock strictly restored to baseline (${stock31After} === ${stock31Before}), ZERO duplicate return!`)

    // Verify warehouse stock is also restored
    const whStock31 = await db.warehouseStock.findFirst({
      where: { warehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID, productId: tea50Prod!.id },
    })
    assert(whStock31?.quantity === stock31Before, 'S3-CONCURRENCY-5X', `WarehouseStock matches baseline (${whStock31?.quantity} === ${stock31Before})`)

    // Verify StockMovement count of type RETURN for this order is exactly 1
    const movements31 = await db.stockMovement.findMany({
      where: { productId: tea50Prod!.id, type: 'RETURN', note: { contains: ord31.code } },
    })
    assert(movements31.length === 1, 'S3-CONCURRENCY-5X', `EXACTLY ONE StockMovement(RETURN) record created for ord31 (actual: ${movements31.length})`)
    assert(movements31[0].quantity === 2, 'S3-CONCURRENCY-5X', 'StockMovement restored quantity is exactly +2')

    // Small pause between concurrency tests to allow connection pool to settle
    await new Promise((r) => setTimeout(r, 600))

    // Test 3.2: 5 Concurrent Webhook Inbound Cancellation Calls
    console.log('  ▶ [Test 3.2] 5 Concurrent Webhook Inbound Cancellation stress test')
    const stock32Before = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    const orderSn32 = `[TEST]_R2_ADV_WH_CONCUR_${Date.now()}`

    const r32Create = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSn32,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách Stress 5x Webhook',
        customerPhone: '0912345678',
        items: [{ sku: 'BM-TEA-50', quantity: 2 }],
      },
    })
    assert(r32Create.ok, 'S3-WH-CONCURRENCY-5X', `Order ${orderSn32} created via inbound sync`, `Status: ${r32Create.status}, Payload: ${JSON.stringify(r32Create.json)}`)
    const stock32During = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stock32During === stock32Before - 2, 'S3-WH-CONCURRENCY-5X', `Stock deducted by 2 (before: ${stock32Before}, during: ${stock32During})`)

    // Fire 5 CONCURRENT Webhook cancellation calls
    console.log('    ⚡ Firing 5 concurrent cancellation webhooks via Promise.all()...')
    const whConcurResults = await Promise.all([
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn32, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn32, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn32, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn32, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn32, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
    ])

    // Every call must return HTTP 200
    const all200 = whConcurResults.every((r) => r.status === 200)
    assert(all200, 'S3-WH-CONCURRENCY-5X', 'All 5 concurrent webhook calls returned HTTP 200', `Statuses: ${whConcurResults.map(r => r.status).join(',')}`)

    // Verify final stock is exactly restored to baseline
    const stock32After = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stock32After === stock32Before, 'S3-WH-CONCURRENCY-5X', `Stock restored to baseline (${stock32After} === ${stock32Before}), ZERO duplicate return from webhook race!`)

    // Verify StockMovement RETURN count for orderSn32 is exactly 1
    const movements32 = await db.stockMovement.findMany({
      where: { productId: tea50Prod!.id, type: 'RETURN', note: { contains: orderSn32 } },
    })
    assert(movements32.length === 1, 'S3-WH-CONCURRENCY-5X', `EXACTLY ONE StockMovement(RETURN) record created for orderSn32 (actual: ${movements32.length})`)
    if (movements32.length > 0) {
      assert(movements32[0].quantity === 2, 'S3-WH-CONCURRENCY-5X', 'StockMovement restored quantity is exactly +2')
    }

    // ========================================================================
    // SUITE 4: PRE-CANCELLED ORDER INGESTION (EDGE CASES)
    // ========================================================================
    console.log('\n--- SUITE 4: Pre-Cancelled Order Ingestion (Edge Cases) ---')

    // 4.1 Simple product arriving already cancelled
    console.log('  ▶ [Test 4.1] Simple product arriving pre-cancelled (shopeeOrderStatus: 306)')
    const tea100StockBefore = (await db.product.findUnique({ where: { sku: 'BM-TEA-100' } }))!.stock
    const orderSnPreSimple = `[TEST]_R2_ADV_PRE_SIMP_${Date.now()}`

    const rPreSimple = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnPreSimple,
        shopeeOrderStatus: '306',
        customerName: 'Khách Đã Hủy Trên Sàn',
        customerPhone: '0900000000',
        items: [{ sku: 'BM-TEA-100', quantity: 4 }],
      },
    })
    assert(rPreSimple.status === 200, 'S4-PRE-CANCEL', 'Pre-cancelled simple order returned HTTP 200', `Status: ${rPreSimple.status}, Payload: ${JSON.stringify(rPreSimple.json)}`)
    assert(rPreSimple.json.action === 'ORDER_CREATED_ALREADY_CANCELLED', 'S4-PRE-CANCEL', 'Action is ORDER_CREATED_ALREADY_CANCELLED')
    assert(rPreSimple.json.order?.status === 'CANCELLED', 'S4-PRE-CANCEL', 'Order status is directly CANCELLED')

    const tea100StockAfter = (await db.product.findUnique({ where: { sku: 'BM-TEA-100' } }))!.stock
    assert(tea100StockAfter === tea100StockBefore, 'S4-PRE-CANCEL', `Stock of BM-TEA-100 completely unchanged (${tea100StockAfter} === ${tea100StockBefore}, Delta = 0)`)

    const preMovements = await db.stockMovement.findMany({
      where: { note: { contains: orderSnPreSimple } },
    })
    assert(preMovements.length === 0, 'S4-PRE-CANCEL', 'ZERO StockMovement records created for pre-cancelled simple order')

    // 4.2 Synthetic COMBO product arriving pre-cancelled
    console.log('  ▶ [Test 4.2] COMBO product arriving pre-cancelled (BOM components stock untouched)')
    const compSkuAdv = `T-COMPA-PRE-${Date.now()}`
    const comboSkuAdv = `T-COMBO-PRE-${Date.now()}`

    const compProdAdv = await db.product.create({
      data: {
        sku: compSkuAdv,
        name: 'Nguyên liệu BOM Thử Nghiệm Adv',
        sellPrice: 20000,
        costPrice: 10000,
        stock: 50,
        type: 'SIMPLE',
        unit: 'sp',
        status: 'ACTIVE',
        ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
      },
    })

    const comboProdAdv = await db.product.create({
      data: {
        sku: comboSkuAdv,
        name: 'Combo Thử Nghiệm Adv',
        sellPrice: 60000,
        costPrice: 30000,
        stock: 25,
        type: 'COMBO',
        unit: 'bộ',
        status: 'ACTIVE',
        ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
      },
    })

    await db.bomComponent.create({
      data: {
        productId: comboProdAdv.id,
        componentProductId: compProdAdv.id,
        quantity: 2,
      },
    })

    const orderSnPreCombo = `[TEST]_R2_ADV_PRE_COMBO_${Date.now()}`
    const rPreCombo = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnPreCombo,
        shopeeOrderStatus: '306',
        customerName: 'Khách Đã Hủy Combo',
        customerPhone: '0900000000',
        items: [{ sku: comboSkuAdv, quantity: 3 }],
      },
    })
    assert(rPreCombo.status === 200, 'S4-PRE-CANCEL', 'Pre-cancelled COMBO order returned HTTP 200', `Status: ${rPreCombo.status}, Payload: ${JSON.stringify(rPreCombo.json)}`)
    assert(rPreCombo.json.action === 'ORDER_CREATED_ALREADY_CANCELLED', 'S4-PRE-CANCEL', 'Action is ORDER_CREATED_ALREADY_CANCELLED')

    const compStockAfterPre = (await db.product.findUnique({ where: { id: compProdAdv.id } }))!.stock
    assert(compStockAfterPre === 50, 'S4-PRE-CANCEL', `BOM component stock completely untouched (${compStockAfterPre} === 50, Delta = 0)`)

    const comboMovements = await db.stockMovement.findMany({
      where: { note: { contains: orderSnPreCombo } },
    })
    assert(comboMovements.length === 0, 'S4-PRE-CANCEL', 'ZERO StockMovement records created for pre-cancelled COMBO order')

    // 4.3 Zero-stock / Out-Of-Stock product arriving pre-cancelled (MUST NOT fail with HTTP 422!)
    console.log('  ▶ [Test 4.3] Out-Of-Stock (stock: 0) product arriving pre-cancelled')
    const oosSku = `R2-OOS-PRE-${Date.now()}`
    const oosProd = await db.product.create({
      data: {
        sku: oosSku,
        name: 'Sản phẩm hết hàng pre-cancel test',
        sellPrice: 150000,
        costPrice: 70000,
        stock: 0,
        type: 'SIMPLE',
        unit: 'cái',
        status: 'OUT_OF_STOCK',
        ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
      },
    })

    const orderSnPreOos = `[TEST]_R2_ADV_PRE_OOS_${Date.now()}`
    const rPreOos = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnPreOos,
        shopeeOrderStatus: '306',
        customerName: 'Khách Mua Hàng Hết Kho Hủy Luôn',
        customerPhone: '0900000000',
        items: [{ sku: oosSku, quantity: 5 }],
      },
    })
    assert(rPreOos.status === 200, 'S4-PRE-CANCEL', 'Pre-cancelled OOS order returned HTTP 200 (not blocked by stock shortage!)')
    assert(rPreOos.json.action === 'ORDER_CREATED_ALREADY_CANCELLED', 'S4-PRE-CANCEL', 'Action is ORDER_CREATED_ALREADY_CANCELLED')
    assert(rPreOos.json.order?.status === 'CANCELLED', 'S4-PRE-CANCEL', 'OOS order created with status: CANCELLED')

    const oosStockAfter = (await db.product.findUnique({ where: { id: oosProd.id } }))!.stock
    assert(oosStockAfter === 0, 'S4-PRE-CANCEL', 'OOS stock strictly preserved at 0')

  } finally {
    // ========================================================================
    // SUITE 5: FORENSIC DUAL-DATABASE INVARIANT & CLEAN STATE CERTIFICATION
    // ========================================================================
    console.log('\n🧹 [PHASE TEARDOWN] Executing RESTORE_AND_CLEAN via Test-Guard...')
    const cleanRes = await restoreAndClean({ silent: false })
    assert(cleanRes.ok && cleanRes.action === 'RESTORED_AND_CLEANED', 'TEARDOWN', 'Test guard successfully cleaned all test artifacts')

    console.log('⚖️ [FORENSIC AUDIT 1/2] Verifying Supabase PostgreSQL 13 Canonical Products (Delta = 0)...')
    const pgAudit = await assert13RealProductsInvariant(db, { silent: false })
    assert(pgAudit.passed, 'ZERO_DELTA_PG', `Supabase PostgreSQL Invariant Certified: ${pgAudit.summary}`)
    assert(pgAudit.deltaCount === 0, 'ZERO_DELTA_PG', 'Zero stock or price deltas in Supabase PostgreSQL (Delta = 0)')

    console.log('⚖️ [FORENSIC AUDIT 2/2] Verifying SQLite custom.db 13 Canonical Products (Delta = 0)...')
    const sqlitePath = path.resolve(process.cwd(), 'db/custom.db')
    if (fs.existsSync(sqlitePath)) {
      const { DatabaseSync } = await import('node:sqlite')
      const sqlite = new DatabaseSync(sqlitePath)
      const sqliteProducts = sqlite.prepare('SELECT id, sku, name, costPrice, sellPrice, stock FROM Product').all() as any[]
      sqlite.close()

      let sqliteMatched = true
      const sqliteMismatches: string[] = []

      for (const p of AUTHORITATIVE_13_PRODUCTS) {
        const row = sqliteProducts.find((x) => x.sku === p.sku)
        if (!row) {
          sqliteMismatches.push(`Missing SKU in SQLite: ${p.sku}`)
          sqliteMatched = false
        } else if (row.stock !== p.stock || row.sellPrice !== p.sellPrice) {
          sqliteMismatches.push(`Mismatch for ${p.sku}: stock=${row.stock}/exp=${p.stock}, price=${row.sellPrice}/exp=${p.sellPrice}`)
          sqliteMatched = false
        }
      }

      assert(sqliteMatched, 'ZERO_DELTA_SQLITE', `All 13 canonical products match in SQLite custom.db (Delta = 0)${sqliteMismatches.length > 0 ? `: ${sqliteMismatches.join('; ')}` : ''}`)
    } else {
      console.log('  ⚠️ SQLite custom.db not found, skipping SQLite-specific audit')
    }

    console.log('✨ [CLEAN STATE AUDIT] Verifying Ecosystem Clean State...')
    const cleanCheck = await verifyCleanState({ silent: false })
    assert(cleanCheck.clean && cleanCheck.leftoverCount === 0, 'CLEAN_STATE', 'Zero leftover test records across all tables (clean: true)')
  }

  console.log('\n================================================================================')
  console.log(`📊 ADVERSARIAL STRESS CHALLENGE SUMMARY: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`)
  console.log('================================================================================')
  if (failures.length === 0) {
    console.log('🎉 VERDICT: CONFIRM — ALL ADVERSARIAL CHALLENGES WITHSTOOD SUCCESSFULLY!')
  } else {
    console.error(`💥 VERDICT: REJECT — ${failures.length} ADVERSARIAL CHALLENGES FAILED!`)
    process.exit(1)
  }
}

runAdversarialStressSuite().catch((err) => {
  console.error('\n💥 FATAL UNCAUGHT RUNTIME EXCEPTION IN CHALLENGER SUITE:', err)
  process.exit(1)
})
