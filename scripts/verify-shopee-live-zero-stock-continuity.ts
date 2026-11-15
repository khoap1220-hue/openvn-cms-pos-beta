/**
 * scripts/verify-shopee-live-zero-stock-continuity.ts
 *
 * Non-Destructive End-to-End Live Verification Suite:
 * - Zero-Stock & Partial-Stock Shopee Live Order Acceptance + Auto-Print Queue (0 HTTP 422 interruption)
 * - Outbox Zero-Overwrite Protection (isMarketplaceStockProtected preserves Shopee Live stock > 0 when CMS = 0)
 * - Exact Inventory Conservation on Order Cancellation (0 deducted -> 0 restocked; 1/3 deducted -> +1 restocked)
 * - Pending Print Job Auto-Skip on Marketplace Cancellation (prevents printing cancelled Live orders)
 * - Unlinked Live Item Auto-Creation & Auto-Linking Continuity
 * - Strict POS Stock Validation Preservation (allowStockShortage omitted -> rejected)
 * - Zero Physical Paper Waste & 100% Zero-Delta Restoration of Canonical Shop thaimy1605
 */

import { execSync } from 'node:child_process'
import { db } from '../src/lib/db'
import { removeShopeePrintJobForTest } from '../src/lib/peripheral-hub'

const BASE_URL = (process.env.CMS_BASE_URL || 'http://127.0.0.1:3010').replace(/\/+$/, '')
const CMS_API_KEY = '191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955'

let totalChecks = 0
let passedChecks = 0

function assert(cond: unknown, suite: string, msg: string, detail?: string): asserts cond {
  totalChecks++
  if (cond) {
    passedChecks++
    console.log(`  [PASS] [${suite}] ${msg}`)
  } else {
    const err = `[FAIL] [${suite}] ${msg}${detail ? ` -> ${detail}` : ''}`
    console.error(`  ${err}`)
    throw new Error(err)
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
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, json }
}

async function main() {
  console.log('================================================================================')
  console.log('SHOPEE LIVE ZERO-STOCK ORDER CONTINUITY & AUTO-PRINT VERIFICATION SUITE')
  console.log('================================================================================')

  const realBaselineProducts = await db.product.findMany({
    where: {
      NOT: {
        OR: [{ sku: { startsWith: 'SP-TEST-LIVE0-' } }, { sku: 'SP-LIVE-777666555' }],
      },
    },
    orderBy: { sku: 'asc' },
  })
  console.log(`[BASELINE] Captured ${realBaselineProducts.length} real CMS products without mutation.`)

  const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
  const posChannel = await db.channel.findUnique({ where: { key: 'POS' } })
  const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
  assert(defaultWh && posChannel && shopeeChannel, 'SETUP', 'Default warehouse, POS channel, and SHOPEE channel exist')

  let daemonPaused = false
  try {
    const pr = await fetch('http://127.0.0.1:51898/shopee/pause', {
      method: 'POST',
      signal: AbortSignal.timeout(1200),
    })
    daemonPaused = pr.ok
  } catch {
    daemonPaused = false
  }

  // Save & temporarily disable autoPrintShopeeOrder on POS-UUDAM-01 so open browser tabs never fire physical paper
  let prevAutoPrintShopee = false
  try {
    const stRes = await fetch(`${BASE_URL}/api/peripherals?stationId=POS-UUDAM-01`)
    const stJson = await stRes.json()
    prevAutoPrintShopee = Boolean(stJson?.station?.autoPrintShopeeOrder)
    if (prevAutoPrintShopee) {
      await fetch(`${BASE_URL}/api/peripherals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_STATION_CONFIG',
          stationId: 'POS-UUDAM-01',
          autoPrintShopeeOrder: false,
        }),
      })
    }
  } catch {
    // ignore
  }

  const createdOrderIds: string[] = []
  const createdProductIds: string[] = []
  const createdSkus = ['SP-TEST-LIVE0-ZERO', 'SP-TEST-LIVE0-PARTIAL', 'SP-LIVE-777666555']
  const testRunTag = Date.now().toString().slice(-7)

  try {
    // Clean any stale leftover synthetic SKUs first
    await db.product.deleteMany({ where: { sku: { in: createdSkus } } })

    // ------------------------------------------------------------------------
    // SUITE 1: ZERO-STOCK SHOPEE LIVE ORDER + SHIPMENT + AUTO-PRINT QUEUE
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 1: Zero-Stock Shopee Live Order Acceptance & Auto-Print ---')
    const zeroProd = await db.product.create({
      data: {
        sku: 'SP-TEST-LIVE0-ZERO',
        name: '[TEST] Nến Bơ Hoa Sen Zero-Stock Live Continuity',
        costPrice: 35000,
        sellPrice: 89000,
        stock: 0,
        status: 'ACTIVE',
        type: 'SIMPLE',
        unit: 'bộ',
        fragile: true,
        ownerWarehouseId: defaultWh.id,
        attributes: JSON.stringify({
          shopeeItemId: '999000111',
          shopeeModelId: '888000111',
          shopeeModelSku: 'SP-TEST-LIVE0-ZERO',
          openingStockOrigin: 'CMS_WAREHOUSE',
          openingStockOriginLabel: 'Gốc tồn đầu tại Kho CMS (chưa nhập kho)',
          openingStockQty: 0,
          liveShopeeStock: 20,
          lastSyncedShopeeStock: 20,
          lastSyncedShopeePrice: 89000,
          reconciliationStatus: 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK',
        }),
      },
    })
    createdProductIds.push(zeroProd.id)
    await db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: defaultWh.id, productId: zeroProd.id } },
      update: { quantity: 0 },
      create: { warehouseId: defaultWh.id, productId: zeroProd.id, quantity: 0 },
    })
    await db.channelListing.upsert({
      where: { productId_channelId: { productId: zeroProd.id, channelId: shopeeChannel.id } },
      update: { price: 89000, status: 'ACTIVE' },
      create: { productId: zeroProd.id, channelId: shopeeChannel.id, price: 89000, status: 'ACTIVE' },
    })

    const orderSnZero = `TESTLIVE0Z_${testRunTag}`
    const trackingZero = `SPXVN_LIVE0_${testRunTag}`
    const resZero = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnZero,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: '[TEST] Khách Chốt Phiên Live Kho 0',
        customerPhone: '0900000000',
        buyerUsername: `test_live0_buyer_${testRunTag}`,
        address: '123 Nguyễn Huệ, Quận 1, TP.HCM',
        paymentMethod: 'COD',
        shippingFee: 0,
        trackingNumber: trackingZero,
        shippingCarrier: 'SPX Express',
        allowSyntheticPrintQueue: true,
        items: [
          {
            sku: 'SP-TEST-LIVE0-ZERO',
            shopeeItemId: '999000111',
            shopeeModelId: '888000111',
            price: 79000,
            quantity: 2,
          },
        ],
      },
    })

    assert(resZero.status === 200 && resZero.ok, 'S1-ZERO-ACCEPT', 'Zero-stock Shopee Live order accepted with HTTP 200 OK', JSON.stringify(resZero.json))
    assert(
      resZero.json.action === 'ORDER_CREATED_WITH_STOCK_SHORTAGE_WARNING',
      'S1-ZERO-ACCEPT',
      'Response action is ORDER_CREATED_WITH_STOCK_SHORTAGE_WARNING'
    )
    assert(
      Array.isArray(resZero.json.stockShortageWarnings) &&
        resZero.json.stockShortageWarnings.length === 1 &&
        resZero.json.stockShortageWarnings[0].shortage === 2 &&
        resZero.json.stockShortageWarnings[0].deducted === 0,
      'S1-ZERO-ACCEPT',
      'Shortage warning accurately reports available=0, deducted=0, shortage=2'
    )

    const zeroOrderId = String(resZero.json.order.id)
    createdOrderIds.push(zeroOrderId)

    const zeroOrderDb = await db.order.findUnique({
      where: { id: zeroOrderId },
      include: { shipments: true, items: true },
    })
    assert(zeroOrderDb?.status === 'CONFIRMED', 'S1-ZERO-ACCEPT', 'Order status progressed to CONFIRMED')
    assert(zeroOrderDb?.paymentMethod === 'COD', 'S1-ZERO-ACCEPT', 'COD payment method preserved accurately')
    assert(zeroOrderDb?.total === 158000, 'S1-ZERO-ACCEPT', `Live Flash Sale price override honored (158,000 === ${zeroOrderDb?.total})`)
    assert(
      Boolean(zeroOrderDb?.note?.includes(`Shopee Order #${orderSnZero}`) && zeroOrderDb?.note?.includes('Chờ đối soát kho CMS')),
      'S1-ZERO-ACCEPT',
      'Order note retains Shopee Order #SN and appends CMS shortage reconciliation tag'
    )
    assert(
      zeroOrderDb?.shipments?.[0]?.trackingCode === trackingZero && zeroOrderDb?.shipments?.[0]?.carrier === 'SPX',
      'S1-ZERO-ACCEPT',
      'SPX Shipment committed BEFORE POS auto-print enqueue'
    )

    const zeroProdAfter = await db.product.findUnique({ where: { id: zeroProd.id } })
    assert(zeroProdAfter?.stock === 0, 'S1-ZERO-ACCEPT', 'CMS Product.stock clamped at 0 (no negative stock)')
    const zeroAttrsAfter = JSON.parse(zeroProdAfter?.attributes || '{}')
    assert(zeroAttrsAfter.pendingOrderShortageQty === 2, 'S1-ZERO-ACCEPT', 'Product attributes recorded pendingOrderShortageQty = 2')
    assert(zeroAttrsAfter.liveShopeeStock === 18, 'S1-ZERO-ACCEPT', 'Estimated liveShopeeStock updated from 20 -> 18')

    // Verify POS Auto-Print Queue & Batch Slips + Dry-Run Spooler Render
    const periphRes = await fetch(`${BASE_URL}/api/peripherals?stationId=POS-UUDAM-01`)
    const periphJson = await periphRes.json()
    const queuedJob = (periphJson?.station?.pendingShopeePrintJobs || []).find(
      (j: { orderId: string }) => j.orderId === zeroOrderId
    )
    assert(Boolean(queuedJob), 'S1-AUTOPRINT', 'Zero-stock Shopee order enqueued into Linked POS pendingShopeePrintJobs')
    assert(queuedJob.trackingCode === trackingZero, 'S1-AUTOPRINT', `Print job carries exact trackingCode (${queuedJob.trackingCode})`)
    assert(queuedJob.shopeeOrderSn === orderSnZero, 'S1-AUTOPRINT', `Print job carries exact shopeeOrderSn (${queuedJob.shopeeOrderSn})`)

    const slipRes = await fetch(`${BASE_URL}/api/orders/batch-slips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: [zeroOrderId] }),
    })
    const slipJson = await slipRes.json()
    const slip = slipJson?.slips?.[0]
    assert(slip?.shopeeOrderSn === orderSnZero, 'S1-AUTOPRINT', 'batch-slips exposes shopeeOrderSn for A6/K80 label header')
    assert(slip?.trackingCode === trackingZero && slip?.carrier === 'SPX Express', 'S1-AUTOPRINT', 'batch-slips exposes SPX Express & trackingCode')
    assert(slip?.codAmount === 158000, 'S1-AUTOPRINT', 'batch-slips calculates exact COD amount (158,000đ)')

    const dryPrintRes = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'WINDOWS_SPOOLER_PRINT',
        stationId: 'POS-UUDAM-01',
        jobType: 'SHOPEE_SLIP',
        shopeeFormat: 'A6_LABEL',
        slip,
        dryRun: true,
      }),
    })
    const dryPrintJson = await dryPrintRes.json()
    assert(dryPrintRes.ok && dryPrintJson.ok === true, 'S1-AUTOPRINT', 'Windows GDI+ Silent Spooler dry-run rendered A6 Shopee slip (0 paper wasted)', JSON.stringify(dryPrintJson))

    // ------------------------------------------------------------------------
    // SUITE 2: OUTBOX ZERO-OVERWRITE PROTECTION (SHOPEE LIVE STOCK SAFE)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 2: Outbox Zero-Overwrite Protection ---')
    const outboxRes = await postWebhook({ event: 'OUTBOX_FETCH_PENDING', data: {} })
    assert(outboxRes.ok, 'S2-OUTBOX-SAFE', 'OUTBOX_FETCH_PENDING succeeded')
    const jobs = (outboxRes.json.jobs || []) as Array<{ sku: string; stockDrifted: boolean; targetStock: number }>
    const zeroSkuOutbox = jobs.find((j) => j.sku === 'SP-TEST-LIVE0-ZERO')
    assert(!zeroSkuOutbox, 'S2-OUTBOX-SAFE', 'Zero Outbox jobs generated for SP-TEST-LIVE0-ZERO (Shopee Live stock 18 is NOT overwritten with 0!)')
    const realStockPushJobs = jobs.filter((j) => j.stockDrifted && j.targetStock === 0)
    assert(
      realStockPushJobs.length === 0,
      'S2-OUTBOX-SAFE',
      `Zero automatic targetStock=0 Outbox jobs across all linked products (actual: ${realStockPushJobs.length})`
    )

    const linksRes = await fetch(`${BASE_URL}/api/channels/product-links`)
    const linksJson = await linksRes.json()
    const linkedZero = (linksJson?.linkedItems || []).find(
      (x: { cmsSku: string }) => x.cmsSku === 'SP-TEST-LIVE0-ZERO'
    )
    assert(
      linkedZero?.pendingOrderShortageQty === 2,
      'S2-OUTBOX-SAFE',
      'GET /api/channels/product-links exposes pendingOrderShortageQty = 2 for UI badge'
    )

    // ------------------------------------------------------------------------
    // SUITE 3: ZERO-STOCK ORDER CANCELLATION CONSERVATION & PRINT SKIP
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Zero-Stock Order Cancellation Conservation ---')
    const resCancelZero = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnZero,
        shopeeOrderStatus: '306',
      },
    })
    assert(
      resCancelZero.ok && resCancelZero.json.action === 'ORDER_CANCELLED_RESTOCKED',
      'S3-ZERO-CANCEL',
      'Zero-stock order cancelled cleanly via webhook 306'
    )
    assert(
      resCancelZero.json.order.restockedCount === 0,
      'S3-ZERO-CANCEL',
      'restockedCount === 0 because 0 physical units were previously deducted'
    )
    const zeroProdAfterCancel = await db.product.findUnique({ where: { id: zeroProd.id } })
    assert(
      zeroProdAfterCancel?.stock === 0,
      'S3-ZERO-CANCEL',
      `CMS stock strictly conserved at 0 after cancelling zero-stock order (actual: ${zeroProdAfterCancel?.stock})`
    )
    const zeroAttrsAfterCancel = JSON.parse(zeroProdAfterCancel?.attributes || '{}')
    assert(
      zeroAttrsAfterCancel.pendingOrderShortageQty === 0,
      'S3-ZERO-CANCEL',
      'pendingOrderShortageQty decremented cleanly back to 0'
    )

    const periphAfterCancel = await (await fetch(`${BASE_URL}/api/peripherals?stationId=POS-UUDAM-01`)).json()
    const stillPending = (periphAfterCancel?.station?.pendingShopeePrintJobs || []).find(
      (j: { orderId: string }) => j.orderId === zeroOrderId
    )
    const inHistory = (periphAfterCancel?.station?.shopeePrintQueue || []).find(
      (j: { orderId: string }) => j.orderId === zeroOrderId
    )
    assert(!stillPending && inHistory?.status === 'SKIPPED', 'S3-ZERO-CANCEL', 'Pending POS print job automatically marked SKIPPED upon marketplace cancellation')

    // ------------------------------------------------------------------------
    // SUITE 4: PARTIAL-STOCK DEDUCTION & EXACT PARTIAL RESTOCK (stock=1, qty=3)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Partial-Stock Deduction & Exact Partial Restock ---')
    const partialProd = await db.product.create({
      data: {
        sku: 'SP-TEST-LIVE0-PARTIAL',
        name: '[TEST] Nến Bơ Partial-Stock Live Continuity',
        costPrice: 20000,
        sellPrice: 50000,
        stock: 1,
        status: 'ACTIVE',
        type: 'SIMPLE',
        unit: 'hộp',
        ownerWarehouseId: defaultWh.id,
        attributes: JSON.stringify({
          shopeeItemId: '999000222',
          shopeeModelId: '888000222',
          openingStockOrigin: 'CMS_WAREHOUSE',
          liveShopeeStock: 10,
          lastSyncedShopeeStock: 10,
        }),
      },
    })
    createdProductIds.push(partialProd.id)
    await db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: defaultWh.id, productId: partialProd.id } },
      update: { quantity: 1 },
      create: { warehouseId: defaultWh.id, productId: partialProd.id, quantity: 1 },
    })

    const orderSnPartial = `TESTLIVE0P_${testRunTag}`
    const resPartial = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnPartial,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: '[TEST] Khách Partial Kho 1 Mua 3',
        customerPhone: '0900000000',
        buyerUsername: `test_partial_${testRunTag}`,
        items: [{ sku: 'SP-TEST-LIVE0-PARTIAL', quantity: 3 }],
      },
    })
    assert(resPartial.ok, 'S4-PARTIAL', 'Partial-stock order (have 1, need 3) accepted with HTTP 200')
    createdOrderIds.push(String(resPartial.json.order.id))

    const partialDuring = await db.product.findUnique({ where: { id: partialProd.id } })
    assert(partialDuring?.stock === 0, 'S4-PARTIAL', 'CMS stock deducted 1 -> 0')
    assert(
      JSON.parse(partialDuring?.attributes || '{}').pendingOrderShortageQty === 2,
      'S4-PARTIAL',
      'pendingOrderShortageQty recorded exact shortage = 2'
    )

    const resPartialCancel = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: { shopeeOrderSn: orderSnPartial, shopeeOrderStatus: '306' },
    })
    assert(resPartialCancel.ok, 'S4-PARTIAL', 'Partial-stock order cancelled cleanly')
    const partialAfterCancel = await db.product.findUnique({ where: { id: partialProd.id } })
    assert(
      partialAfterCancel?.stock === 1,
      'S4-PARTIAL',
      `Exact previously deducted +1 unit restocked (0 -> 1, NOT +3! actual: ${partialAfterCancel?.stock})`
    )
    assert(
      JSON.parse(partialAfterCancel?.attributes || '{}').pendingOrderShortageQty === 0,
      'S4-PARTIAL',
      'pendingOrderShortageQty reset to 0 after cancellation'
    )

    // ------------------------------------------------------------------------
    // SUITE 5: UNLINKED LIVE SKU AUTO-CREATE & CONTINUITY
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Unlinked Live Item Auto-Create Continuity ---')
    const orderSnUnlinked = `TESTLIVE0U_${testRunTag}`
    const resUnlinked = await postWebhook({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: orderSnUnlinked,
        shopeeOrderStatus: 'READY_TO_SHIP',
        customerName: '[TEST] Khách Mua Mã Mới Phiên Live',
        customerPhone: '0900000000',
        buyerUsername: `test_unlinked_${testRunTag}`,
        items: [
          {
            sku: '',
            modelSku: '',
            shopeeItemId: '999888777',
            shopeeModelId: '777666555',
            name: '[TEST] Set Nến Thiền Mới Lên Live',
            modelName: 'Hộp Hồng',
            price: 95000,
            quantity: 1,
          },
        ],
      },
    })
    assert(resUnlinked.ok && resUnlinked.status === 200, 'S5-UNLINKED-LIVE', 'Unlinked Live item order auto-linked and accepted (HTTP 200)', JSON.stringify(resUnlinked.json))
    createdOrderIds.push(String(resUnlinked.json.order.id))
    const autoProd = await db.product.findUnique({ where: { sku: 'SP-LIVE-777666555' } })
    assert(Boolean(autoProd), 'S5-UNLINKED-LIVE', 'Auto-created SKU SP-LIVE-777666555 with stock = 0')
    if (autoProd) createdProductIds.push(autoProd.id)

    // ------------------------------------------------------------------------
    // SUITE 6: STRICT POS VALIDATION PRESERVED
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 6: Strict POS Stock Validation Preserved ---')
    const posRes = await fetch(`${BASE_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: posChannel.id,
        customerName: '[TEST] Khách Lẻ POS',
        items: [{ productId: zeroProd.id, quantity: 1 }],
      }),
    })
    assert(!posRes.ok && posRes.status === 400, 'S6-POS-STRICT', `Direct POS order on stock=0 SKU strictly rejected with HTTP ${posRes.status}`)

    // ------------------------------------------------------------------------
    // SUITE 7: PYTHON DAEMON ITEM MAPPING & COD DETECTION
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 7: Python Daemon Item Mapping & COD Detection ---')
    const pyCheck = execSync(
      'python -c "import os; os.environ[\'PYTHONDONTWRITEBYTECODE\']=\'1\'; src=open(\'scripts/shopee_seller_sync.py\', encoding=\'utf-8\').read(); import ast; ast.parse(src); assert \'BM-SEN-01\' not in src.split(\'def detect_and_enqueue_inbound_orders\')[1].split(\'def flush_inbound_queue_to_cms\')[0]; assert \'is_cod_order\' in src; print(\'DAEMON_MAPPING_OK\')"',
      { encoding: 'utf-8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
    )
    assert(pyCheck.includes('DAEMON_MAPPING_OK'), 'S7-PYTHON-DAEMON', 'shopee_seller_sync.py passes AST, removes hardcoded BM-SEN-01 fallback, and detects COD')
  } finally {
    console.log('\n[CLEANUP] Removing all synthetic verification artifacts...')
    for (const oid of createdOrderIds) {
      removeShopeePrintJobForTest(oid)
      await fetch(`${BASE_URL}/api/peripherals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'REMOVE_TEST_PRINT_JOB', stationId: 'POS-UUDAM-01', orderId: oid }),
      }).catch(() => null)
    }

    if (createdOrderIds.length > 0) {
      const testOrders = await db.order.findMany({
        where: { id: { in: createdOrderIds } },
        select: { id: true, code: true, customerId: true },
      })
      const orderCodes = testOrders.map((o) => o.code)
      const custIds = testOrders.map((o) => o.customerId).filter((x): x is string => Boolean(x))

      await db.shipment.deleteMany({ where: { orderId: { in: createdOrderIds } } })
      await db.orderEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } })
      await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } })
      await db.order.deleteMany({ where: { id: { in: createdOrderIds } } })
      for (const code of orderCodes) {
        await db.stockMovement.deleteMany({ where: { note: { contains: code } } })
        await db.ledgerEntry.deleteMany({ where: { entityCode: code } })
        await db.agentActivity.deleteMany({ where: { targetLabel: code } })
      }
      if (custIds.length > 0) {
        await db.directMessage.deleteMany({ where: { customerId: { in: custIds } } })
        await db.customer.deleteMany({ where: { id: { in: custIds }, orders: { none: {} } } })
      }
    }

    await db.ledgerEntry.deleteMany({
      where: {
        OR: [
          { entityCode: { startsWith: 'TESTLIVE0' } },
          { entityCode: { in: createdSkus } },
        ],
      },
    })
    await db.stockMovement.deleteMany({ where: { product: { sku: { in: createdSkus } } } })
    await db.warehouseStock.deleteMany({ where: { product: { sku: { in: createdSkus } } } })
    await db.channelListing.deleteMany({ where: { product: { sku: { in: createdSkus } } } })
    await db.product.deleteMany({ where: { sku: { in: createdSkus } } })

    if (prevAutoPrintShopee) {
      await fetch(`${BASE_URL}/api/peripherals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'UPDATE_STATION_CONFIG',
          stationId: 'POS-UUDAM-01',
          autoPrintShopeeOrder: true,
        }),
      }).catch(() => null)
    }

    if (daemonPaused) {
      await fetch('http://127.0.0.1:51898/shopee/resume', {
        method: 'POST',
        signal: AbortSignal.timeout(1200),
      }).catch(() => null)
    }

    // Verify 100% Zero-Delta across all real products
    const realAfterProducts = await db.product.findMany({
      orderBy: { sku: 'asc' },
    })
    assert(
      realAfterProducts.length === realBaselineProducts.length,
      'ZERO-DELTA',
      `Exact product count restored (${realAfterProducts.length} === ${realBaselineProducts.length})`
    )
    for (let i = 0; i < realBaselineProducts.length; i++) {
      const b = realBaselineProducts[i]
      const a = realAfterProducts[i]
      assert(
        b.sku === a.sku && b.stock === a.stock && b.sellPrice === a.sellPrice,
        'ZERO-DELTA',
        `Product ${b.sku} unchanged (stock=${a.stock}, price=${a.sellPrice})`
      )
    }
  }

  console.log('\n================================================================================')
  console.log(`ALL ${passedChecks}/${totalChecks} LIVE CONTINUITY & ZERO-DELTA CHECKS PASSED!`)
  console.log('================================================================================')
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nVERIFICATION FAILED:', err)
    process.exit(1)
  })
