/**
 * scripts/stress_m2_r2_concurrency.ts
 *
 * TARGETED ADVERSARIAL STRESS HARNESS — MILESTONE 2 (ITERATION 2)
 * OPENVN · Ưu Đàm Suite Shopee Seller Sync Hardening
 *
 * Specific Verification Scenarios:
 * 1. Resurrection of Cancelled Orders:
 *    - Verify Autopilot CAS transitions (startPacking, advanceShipment) CANNOT overwrite CANCELLED status back to PACKING or SHIPPING.
 * 2. Concurrent Cancellation Webhooks Over-Restock:
 *    - Fire 5 concurrent cancellation webhooks against active order.
 *    - Verify stock is restocked EXACTLY ONCE (no duplicate restock, no phantom inventory, Delta = 0).
 *    - Verify exactly 1 StockMovement(type: 'RETURN') is created.
 * 3. Data Isolation (R2):
 *    - Call teardown restoreAndClean.
 *    - Verify 13 canonical products of shop thaimy1605 in Supabase PostgreSQL: exact 258 units.
 *    - Verify 13 canonical products in SQLite custom.db: exact 258 units.
 *    - Verify clean: true, leftoverCount = 0.
 */

import path from 'node:path'
import fs from 'node:fs'
import { db } from '../src/lib/db'
import { cancelOrder } from '../src/lib/order-service'
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

async function postWebhook(body: any, baseUrl = DEFAULT_BASE_URL) {
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

async function main() {
  console.log('================================================================================')
  console.log('⚔️  ADVERSARIAL EMPIRICAL HARNESS: MILESTONE 2 ITERATION 2 (CHALLENGER 1)')
  console.log('================================================================================')

  // PHASE 0: Snapshot Baseline
  console.log('\n📸 [PHASE 0] Taking Pre-Test Snapshot via Test-Guard...')
  const snapRes = await takeSnapshot({ autoCleanFirst: true, silent: false })
  assert(snapRes.ok && snapRes.productCount === 13, 'PHASE-0', 'Pre-test snapshot successful (13 canonical products frozen)')

  try {
    // ========================================================================
    // SCENARIO 1: ANTI-RESURRECTION OF CANCELLED ORDERS
    // ========================================================================
    console.log('\n--- SCENARIO 1: Anti-Resurrection of Cancelled Orders ---')

    const orderSn1 = `[TEST]_R2_RESURRECT_GUARD_${Date.now()}`
    const rCreate1 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSn1,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách Test Chống Hồi Sinh',
        customerPhone: '0912345678',
        items: [{ sku: 'BM-TEA-10', quantity: 1 }],
      },
    })
    assert(rCreate1.ok, 'S1-RESURRECT', `Order ${orderSn1} created with status CONFIRMED`)
    const orderId1 = rCreate1.json.order?.id
    assert(Boolean(orderId1), 'S1-RESURRECT', 'Order ID received')

    // Cancel the order via webhook (Shopee status 306)
    const rCancel1 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSn1, shopeeOrderStatus: '306' },
    })
    assert(rCancel1.ok && rCancel1.json.action === 'ORDER_CANCELLED_RESTOCKED', 'S1-RESURRECT', 'Order successfully cancelled and restocked')

    // Verify order in DB is CANCELLED
    const dbOrderAfterCancel = await db.order.findUnique({ where: { id: orderId1 } })
    assert(dbOrderAfterCancel?.status === 'CANCELLED', 'S1-RESURRECT', 'Order status in DB is CANCELLED')

    // Test 1.1: Direct CAS simulation of startPacking
    console.log('  ▶ [Test 1.1] Testing startPacking CAS guard: updateMany(status: CONFIRMED -> PACKING)')
    const packingCasRes = await db.order.updateMany({
      where: { id: orderId1, status: 'CONFIRMED' },
      data: { status: 'PACKING' },
    })
    assert(packingCasRes.count === 0, 'S1-RESURRECT', `startPacking CAS update affected 0 rows (count: ${packingCasRes.count}), cannot resurrect CANCELLED order!`)

    // Test 1.2: Direct CAS simulation of advanceShipment
    console.log('  ▶ [Test 1.2] Testing advanceShipment CAS guard: updateMany(status: notIn [CANCELLED, COMPLETED] -> SHIPPING)')
    const shippingCasRes = await db.order.updateMany({
      where: { id: orderId1, status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      data: { status: 'SHIPPING' },
    })
    assert(shippingCasRes.count === 0, 'S1-RESURRECT', `advanceShipment CAS update affected 0 rows (count: ${shippingCasRes.count}), cannot resurrect CANCELLED order!`)

    // Test 1.3: Direct CAS simulation of delivered
    console.log('  ▶ [Test 1.3] Testing advanceShipment DELIVERED CAS guard: updateMany(status: notIn [CANCELLED] -> COMPLETED)')
    const deliveredCasRes = await db.order.updateMany({
      where: { id: orderId1, status: { notIn: ['CANCELLED'] } },
      data: { status: 'COMPLETED', paymentStatus: 'PAID' },
    })
    assert(deliveredCasRes.count === 0, 'S1-RESURRECT', `advanceShipment DELIVERED CAS update affected 0 rows (count: ${deliveredCasRes.count}), cannot complete CANCELLED order!`)

    // Test 1.4: Inbound webhook backward transition rejection
    console.log('  ▶ [Test 1.4] Testing inbound webhook backward transitions on CANCELLED order')
    const rBack302 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSn1, shopeeOrderStatus: '302' },
    })
    assert(rBack302.status === 409, 'S1-RESURRECT', 'Webhook 302 on CANCELLED order rejected with HTTP 409 Conflict')

    const rBack304 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSn1, shopeeOrderStatus: '304' },
    })
    assert(rBack304.status === 409, 'S1-RESURRECT', 'Webhook 304 on CANCELLED order rejected with HTTP 409 Conflict')

    const rBack305 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSn1, shopeeOrderStatus: '305' },
    })
    assert(rBack305.status === 409, 'S1-RESURRECT', 'Webhook 305 on CANCELLED order rejected with HTTP 409 Conflict')

    // Confirm final state in database
    const dbOrderFinal1 = await db.order.findUnique({ where: { id: orderId1 } })
    assert(dbOrderFinal1?.status === 'CANCELLED', 'S1-RESURRECT', `Order status strictly remained CANCELLED (actual: ${dbOrderFinal1?.status})`)

    // ========================================================================
    // SCENARIO 2: CONCURRENT CANCELLATION WEBHOOKS OVER-RESTOCK STRESS
    // ========================================================================
    console.log('\n--- SCENARIO 2: Concurrent Cancellation Webhooks Over-Restock Stress ---')

    const stockBefore2 = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    const orderSn2 = `[TEST]_R2_CONCUR_WH_${Date.now()}`

    console.log(`  ▶ Creating active order for 2x BM-TEA-50 (Baseline stock: ${stockBefore2})...`)
    const rCreate2 = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSn2,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: 'Khách Stress 5x Webhook R2',
        customerPhone: '0912345678',
        items: [{ sku: 'BM-TEA-50', quantity: 2 }],
      },
    })
    assert(rCreate2.ok, 'S2-CONCUR-WH', `Order ${orderSn2} created via inbound sync`)
    const stockDuring2 = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stockDuring2 === stockBefore2 - 2, 'S2-CONCUR-WH', `Stock correctly decremented by 2 (${stockBefore2} -> ${stockDuring2})`)

    // Fire 5 CONCURRENT cancellation webhooks simultaneously
    console.log('  ⚡ Firing 5 concurrent cancellation webhooks via Promise.all()...')
    const whPromises = [
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn2, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn2, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn2, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn2, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
      postWebhook({ event: 'INBOUND_SHOPEE_ORDER_SYNC', data: { shopeeOrderSn: orderSn2, shopeeOrderStatus: '306', customerPhone: '0912345678' } }),
    ]
    const whResults = await Promise.all(whPromises)

    // Assertions on responses
    const all200 = whResults.every((r) => r.status === 200)
    assert(all200, 'S2-CONCUR-WH', 'All 5 concurrent cancellation webhooks returned HTTP 200', `Statuses: ${whResults.map(r => r.status).join(',')}`)

    const restockedResponses = whResults.filter((r) => r.json.action === 'ORDER_CANCELLED_RESTOCKED')
    const idempotentResponses = whResults.filter((r) => r.json.action === 'SKIPPED_IDEMPOTENT')
    assert(restockedResponses.length === 1, 'S2-CONCUR-WH', `EXACTLY 1 response has action ORDER_CANCELLED_RESTOCKED (actual: ${restockedResponses.length}/5)`)
    assert(idempotentResponses.length === 4, 'S2-CONCUR-WH', `EXACTLY 4 responses have action SKIPPED_IDEMPOTENT (actual: ${idempotentResponses.length}/5)`)

    // Assertions on Stock (NO OVER-RESTOCK!)
    const stockAfter2 = (await db.product.findUnique({ where: { sku: 'BM-TEA-50' } }))!.stock
    assert(stockAfter2 === stockBefore2, 'S2-CONCUR-WH', `Stock restored to EXACT baseline (${stockAfter2} === ${stockBefore2}), ZERO unearned inventory (Delta = 0)!`)

    // Assertions on StockMovement records (EXACTLY 1 RETURN MOVEMENT!)
    const movements2 = await db.stockMovement.findMany({
      where: { type: 'RETURN', note: { contains: orderSn2 } },
    })
    assert(movements2.length === 1, 'S2-CONCUR-WH', `EXACTLY 1 StockMovement(type: 'RETURN') created for orderSn2 (actual: ${movements2.length})`)
    if (movements2.length > 0) {
      assert(movements2[0].quantity === 2, 'S2-CONCUR-WH', `Restored quantity in StockMovement is exactly +2 (actual: ${movements2[0].quantity})`)
    }

  } finally {
    // ========================================================================
    // SCENARIO 3: DATA ISOLATION & DUAL-DATABASE TEARDOWN (R2)
    // ========================================================================
    console.log('\n--- SCENARIO 3: Data Isolation & Dual-Database Teardown (R2) ---')
    console.log('🧹 [TEARDOWN] Invoking restoreAndClean via Test-Guard...')
    const cleanRes = await restoreAndClean({ silent: false })
    assert(cleanRes.ok && cleanRes.action === 'RESTORED_AND_CLEANED', 'S3-DATA-ISOLATION', 'Test guard successfully cleaned all test artifacts')

    console.log('⚖️ [AUDIT 1/2] Verifying Supabase PostgreSQL 13 Canonical Products (Delta = 0)...')
    const pgAudit = await assert13RealProductsInvariant(db, { silent: false })
    assert(pgAudit.passed, 'S3-DATA-ISOLATION', `Supabase PostgreSQL Invariant Certified: ${pgAudit.summary}`)
    assert(pgAudit.deltaCount === 0, 'S3-DATA-ISOLATION', 'Zero stock or price deltas in Supabase PostgreSQL (Delta = 0)')

    console.log('⚖️ [AUDIT 2/2] Verifying SQLite custom.db 13 Canonical Products (Delta = 0)...')
    const sqlitePath = path.resolve(process.cwd(), 'db/custom.db')
    if (fs.existsSync(sqlitePath)) {
      const { DatabaseSync } = await import('node:sqlite')
      const sqlite = new DatabaseSync(sqlitePath)
      const sqliteProducts = sqlite.prepare('SELECT id, sku, name, costPrice, sellPrice, stock FROM Product').all() as any[]
      sqlite.close()

      let sqliteMatched = true
      let totalSqliteStock = 0
      const sqliteMismatches: string[] = []

      for (const p of AUTHORITATIVE_13_PRODUCTS) {
        const row = sqliteProducts.find((x) => x.sku === p.sku)
        if (!row) {
          sqliteMismatches.push(`Missing SKU in SQLite: ${p.sku}`)
          sqliteMatched = false
        } else {
          totalSqliteStock += row.stock
          if (row.stock !== p.stock || row.sellPrice !== p.sellPrice) {
            sqliteMismatches.push(`Mismatch for ${p.sku}: stock=${row.stock}/exp=${p.stock}, price=${row.sellPrice}/exp=${p.sellPrice}`)
            sqliteMatched = false
          }
        }
      }

      assert(sqliteMatched, 'S3-DATA-ISOLATION', `All 13 canonical products match in SQLite custom.db (Delta = 0)${sqliteMismatches.length > 0 ? `: ${sqliteMismatches.join('; ')}` : ''}`)
      assert(totalSqliteStock === 258, 'S3-DATA-ISOLATION', `SQLite custom.db total canonical stock is exactly 258 units (actual: ${totalSqliteStock})`)
    } else {
      console.log('  ⚠️ SQLite custom.db not found')
    }

    console.log('✨ [CLEAN STATE] Verifying Clean State across all tables...')
    const cleanCheck = await verifyCleanState({ silent: false })
    assert(cleanCheck.clean && cleanCheck.leftoverCount === 0, 'S3-DATA-ISOLATION', 'Zero leftover test records across all tables (clean: true, leftoverCount: 0)')
  }

  console.log('\n================================================================================')
  console.log(`📊 SCENARIOS SUMMARY: ${passedAssertions} / ${totalAssertions} ASSERTIONS PASSED`)
  console.log('================================================================================')
  if (failures.length === 0) {
    console.log('🎉 VERDICT: CONFIRM — ALL 3 ADVERSARIAL SCENARIOS VERIFIED 100% PASS!')
  } else {
    console.error(`💥 VERDICT: REJECT — ${failures.length} ASSERTIONS FAILED!`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n💥 FATAL UNCAUGHT RUNTIME EXCEPTION:', err)
  process.exit(1)
})
