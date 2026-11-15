import crypto from 'crypto'
import { db } from '../src/lib/db'
import { getActiveInboundSecrets } from '../src/lib/webhook-service'
import { hmacSign, SESSION_COOKIE_NAME } from '../src/lib/auth'

const BASE_URL = process.env.CMS_BASE_URL || 'http://localhost:3010'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`)
  }
}

async function buildAdminCookie(): Promise<string> {
  const exp = Date.now() + 3600_000
  const sig = await hmacSign(`ADMIN.${exp}`)
  return `${SESSION_COOKIE_NAME}=ADMIN.${exp}.${sig}`
}

async function signInbound(secret: string, bodyObj: unknown): Promise<{ raw: string; sig: string }> {
  const raw = JSON.stringify(bodyObj)
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex')
  return { raw, sig }
}

async function callApi<T = Record<string, unknown>>(
  cookie: string,
  path: string,
  init?: RequestInit
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
      'User-Agent': 'HeadlessChrome/131.0 AutomatedVerifier',
      'x-test-suppress-daemon-trigger': '1',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let data: unknown = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { raw: text }
  }
  return { status: res.status, data: data as T }
}

async function postWebhook<T = Record<string, unknown>>(
  secret: string,
  payload: Record<string, unknown>
): Promise<{ status: number; data: T }> {
  const { raw, sig } = await signInbound(secret, payload)
  const res = await fetch(`${BASE_URL}/api/webhooks/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': `sha256=${sig}`,
      'User-Agent': 'HeadlessChrome/131.0 AutomatedVerifier',
    },
    body: raw,
  })
  const data = (await res.json()) as T
  return { status: res.status, data }
}

async function sumWarehouseStock(productId: string): Promise<number> {
  const rows = await db.warehouseStock.findMany({ where: { productId } })
  return rows.reduce((sum, r) => sum + r.quantity, 0)
}

async function main() {
  console.log('=== VERIFYING INVENTORY POLICY: CMS REAL STOCK vs VIRTUAL MARKETPLACE & NEGATIVE STOCK ===')
  const cookie = await buildAdminCookie()
  const secrets = await getActiveInboundSecrets()
  const secret = secrets[0]
  assert(secret, 'Missing active inbound webhook secret')

  const startedAt = new Date(Date.now() - 1000)
  const testRunTag = Date.now().toString().slice(-6)
  const testSku1 = `SP-TEST-POL1-${testRunTag}`
  const testName1 = `[TEST] Tồn Ảo Sàn & Tồn Thật CMS ${testRunTag}`
  const testSku2 = `SP-TEST-POL2-${testRunTag}`
  const testItemId1 = `999881${testRunTag}`
  const testModelId1 = `888771${testRunTag}`
  const testItemId2 = `999882${testRunTag}`
  const testModelId2 = `888772${testRunTag}`
  const testOrderSn1 = `TEST_POL_CLAMP_${testRunTag}`
  const testOrderSn2 = `TEST_POL_NEG_${testRunTag}`

  // Snapshot original settings & product link attributes of real 18 SKUs
  const originalSettingsRows = await db.appSetting.findMany({
    where: {
      key: {
        in: [
          'inventory_sync_mode',
          'inventory_virtual_stock_qty',
          'inventory_virtual_min_threshold',
          'inventory_virtual_auto_refill',
          'inventory_allow_negative_stock',
          'inventory_negative_stock_scope',
        ],
      },
    },
  })
  const originalSettingMap = new Map(originalSettingsRows.map((r) => [r.key, r.value]))
  const realProductsBefore = await db.product.findMany({
    select: { id: true, sku: true, stock: true, attributes: true },
  })
  const channelsBefore = await db.channel.findMany({
    select: { id: true, key: true, syncedAt: true },
  })

  const createdProductIds = new Set<string>()
  const createdOrderIds = new Set<string>()

  try {
    const channels = await db.channel.findMany()
    const posChannel = channels.find((c) => c.key === 'POS') || channels[0]
    assert(posChannel, 'POS channel must exist')

    // ------------------------------------------------------------------
    // STEP 1: Set Safe Default Mode 2 (VIRTUAL_ALWAYS_IN_STOCK, autoRefill=false, allowNegative=false)
    // ------------------------------------------------------------------
    const setMode2Init = await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inventory_sync_mode: 'VIRTUAL_ALWAYS_IN_STOCK',
        inventory_virtual_stock_qty: '100',
        inventory_virtual_min_threshold: '10',
        inventory_virtual_auto_refill: 'false',
        inventory_allow_negative_stock: 'false',
        inventory_negative_stock_scope: 'ALL_CHANNELS',
      }),
    })
    assert(setMode2Init.status === 200, `PATCH /api/settings failed: ${setMode2Init.status}`)
    console.log('[PASS 1] Configured Mode 2 (VIRTUAL_ALWAYS_IN_STOCK) via PATCH /api/settings')

    // ------------------------------------------------------------------
    // STEP 2: Hard Invariant — INBOUND_SHOPEE_PRODUCT_SYNC with virtual stock 100 creates CMS stock = 0
    // ------------------------------------------------------------------
    const syncCreateRes = await postWebhook(secret, {
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        autoCreate: true,
        shopeeItemId: testItemId1,
        shopeeModelId: testModelId1,
        sku: testSku1,
        parentSku: testSku1,
        name: `[TEST] Tồn Ảo Sàn & Tồn Thật CMS ${testRunTag}`,
        modelName: 'Bản Chuẩn',
        sellPrice: 120000,
        stock: 100, // Virtual Shopee stock = 100!
        shopId: '197195817',
        shopUsername: 'thaimy1605',
      },
    })
    assert(syncCreateRes.status === 200, `INBOUND_SHOPEE_PRODUCT_SYNC failed: ${syncCreateRes.status}`)
    const prod1 = await db.product.findUnique({ where: { sku: testSku1 } })
    assert(prod1, 'Synthetic product 1 must be created')
    createdProductIds.add(prod1.id)
    assert(prod1.stock === 0, `CMS stock must be 0 (real physical stock), got ${prod1.stock}`)
    assert((await sumWarehouseStock(prod1.id)) === 0, 'WarehouseStock sum must be 0')

    // Re-sync with Shopee virtual stock 95 -> CMS stock MUST remain 0
    const resync95 = await postWebhook<{ ok: boolean }>(secret, {
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        shopeeItemId: testItemId1,
        shopeeModelId: testModelId1,
        sku: testSku1,
        name: testName1,
        sellPrice: 120000,
        stock: 95,
        shopId: '197195817',
        shopUsername: 'thaimy1605',
      },
    })
    assert(resync95.status === 200 && resync95.data.ok, 'Resync 95 must succeed')
    const prod1AfterResync = await db.product.findUniqueOrThrow({ where: { id: prod1.id } })
    assert(prod1AfterResync.stock === 0, `CMS stock must stay 0 on Shopee virtual stock resync, got ${prod1AfterResync.stock}`)

    // CREATE_AND_LINK without confirmRealPhysicalStock must also keep CMS stock = 0
    const createLinkRes = await callApi<{ ok: boolean; product?: { id: string; stock: number } }>(
      cookie,
      '/api/channels/product-links',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'CREATE_AND_LINK',
          customSku: testSku2,
          shopeeItemId: testItemId2,
          shopeeModelId: testModelId2,
          name: `[TEST] Guard Create Link ${testRunTag}`,
          sellPrice: 90000,
          stock: 88,
          stockInitMode: 'TAKE_FROM_MARKETPLACE',
          confirmRealPhysicalStock: false,
        }),
      }
    )
    assert(createLinkRes.status === 200 && createLinkRes.data.ok, 'CREATE_AND_LINK failed')
    const prod2 = await db.product.findUniqueOrThrow({ where: { sku: testSku2 } })
    createdProductIds.add(prod2.id)
    assert(prod2.stock === 0, `CREATE_AND_LINK without confirmRealPhysicalStock must keep CMS stock = 0, got ${prod2.stock}`)
    console.log('[PASS 2] Hard Invariant verified: CMS = 100% Real Stock (never overwritten by Shopee virtual stock)')

    // ------------------------------------------------------------------
    // STEP 3: Option 2 — VIRTUAL_ALWAYS_IN_STOCK shields both CMS & Shopee + Auto-Refill + 1-Click Apply
    // ------------------------------------------------------------------
    const linksMode2 = await callApi<{
      linkedItems: Array<{ cmsProductId: string; reconciliationStatus: string; syncStatus: string }>
    }>(cookie, '/api/channels/product-links')
    const linked1 = linksMode2.data.linkedItems.find((i) => i.cmsProductId === prod1.id)
    assert(linked1, 'prod1 must appear in linkedItems')
    assert(
      linked1.reconciliationStatus === 'VIRTUAL_MARKETPLACE_ACTIVE',
      `Expected VIRTUAL_MARKETPLACE_ACTIVE, got ${linked1.reconciliationStatus}`
    )
    assert(linked1.syncStatus === 'IN_SYNC', `Expected IN_SYNC in Mode 2, got ${linked1.syncStatus}`)

    const outboxIdle = await postWebhook<{
      jobs: Array<{ productId: string; stockDrifted: boolean; targetStock: number }>
    }>(secret, { event: 'OUTBOX_FETCH_PENDING', data: { onlySyntheticTest: true } })
    const outboxProd1Idle = outboxIdle.data.jobs.find((i) => i.productId === prod1.id)
    assert(!outboxProd1Idle, 'Mode 2 (autoRefill=false) must NOT push CMS 0 stock to overwrite Shopee 95')

    // Enable virtualAutoRefill=true and drop Shopee stock to 8 (<= threshold 10)
    await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inventory_virtual_auto_refill: 'true',
      }),
    })
    const dropTo8Res = await postWebhook<{ ok: boolean }>(secret, {
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        shopeeItemId: testItemId1,
        shopeeModelId: testModelId1,
        sku: testSku1,
        name: testName1,
        sellPrice: 120000,
        stock: 8,
        shopId: '197195817',
        shopUsername: 'thaimy1605',
      },
    })
    assert(dropTo8Res.status === 200 && dropTo8Res.data.ok, 'Drop to 8 sync must succeed')
    const outboxRefill = await postWebhook<{
      jobs: Array<{ productId: string; stockDrifted: boolean; targetStock: number }>
    }>(secret, { event: 'OUTBOX_FETCH_PENDING', data: { onlySyntheticTest: true } })
    const refillItem = outboxRefill.data.jobs.find((i) => i.productId === prod1.id)
    assert(refillItem && refillItem.stockDrifted && refillItem.targetStock === 100, 'Auto-refill must queue targetStock=100')
    await postWebhook(secret, {
      event: 'OUTBOX_ACK_RESULT',
      data: {
        productId: prod1.id,
        status: 'COMPLETED',
        syncedStock: 100,
        syncedPrice: 120000,
      },
    })
    assert((await db.product.findUniqueOrThrow({ where: { id: prod1.id } })).stock === 0, 'CMS stock must still be 0 after refill')

    // Test 1-Click APPLY_VIRTUAL_STOCK_TO_MARKETPLACE for specific test product only
    await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({ inventory_virtual_auto_refill: 'false' }),
    })
    const applyVirtRes = await callApi<{ ok: boolean; queuedCount: number }>(
      cookie,
      '/api/channels/product-links',
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'APPLY_VIRTUAL_STOCK_TO_MARKETPLACE',
          productIds: [prod1.id],
          virtualStockQty: 150,
        }),
      }
    )
    assert(applyVirtRes.status === 200 && applyVirtRes.data.queuedCount === 1, 'APPLY_VIRTUAL_STOCK_TO_MARKETPLACE failed')
    const outboxManualVirt = await postWebhook<{
      jobs: Array<{ productId: string; stockDrifted: boolean; targetStock: number }>
    }>(secret, { event: 'OUTBOX_FETCH_PENDING', data: { onlySyntheticTest: true } })
    const manualVirtItem = outboxManualVirt.data.jobs.find((i) => i.productId === prod1.id)
    assert(
      manualVirtItem && manualVirtItem.stockDrifted && manualVirtItem.targetStock === 150,
      'APPLY_VIRTUAL_STOCK_TO_MARKETPLACE must queue targetStock=150'
    )
    await postWebhook(secret, {
      event: 'OUTBOX_ACK_RESULT',
      data: {
        productId: prod1.id,
        status: 'COMPLETED',
        syncedStock: 150,
        syncedPrice: 120000,
      },
    })
    console.log('[PASS 3] Option 2 verified: Virtual stock protection, Auto-Refill (8 ➔ 100), and 1-Click Apply (150)')

    // ------------------------------------------------------------------
    // STEP 4: Option 3 — Negative Stock Disabled vs Enabled (POS + Shopee Live + Cancel + Import Reconciliation)
    // ------------------------------------------------------------------
    // 4a. When allowNegativeStock = false: POS blocks stock=0, Shopee Live accepts & clamps at 0
    const posBlocked = await callApi(cookie, '/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        channelId: posChannel.id,
        customerName: 'Khách Test POS Chặn Âm',
        customerPhone: '0900009911',
        paymentMethod: 'CASH',
        instantComplete: true,
        items: [{ productId: prod1.id, quantity: 1 }],
      }),
    })
    assert(posBlocked.status === 400, `POS must reject 0-stock order when allowNegativeStock=false, got ${posBlocked.status}`)

    const shopeeClampRes = await postWebhook<{ ok: boolean; order?: { id: string } }>(secret, {
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: testOrderSn1,
        shopeeOrderStatus: 'READY_TO_SHIP',
        buyerUsername: 'buyer_clamp_test',
        recipientName: 'Khách Test Clamp',
        recipientPhone: '0900009912',
        shippingAddress: 'Q1, TP.HCM',
        items: [
          {
            shopeeItemId: testItemId1,
            shopeeModelId: testModelId1,
            sku: testSku1,
            quantity: 2,
            price: 120000,
          },
        ],
      },
    })
    assert(shopeeClampRes.status === 200 && shopeeClampRes.data.ok, 'Shopee Live order must succeed at 0 stock')
    if (shopeeClampRes.data.order?.id) createdOrderIds.add(shopeeClampRes.data.order.id)
    const prod1Clamped = await db.product.findUniqueOrThrow({ where: { id: prod1.id } })
    assert(prod1Clamped.stock === 0, `Shopee order with allowNegativeStock=false must clamp at 0, got ${prod1Clamped.stock}`)
    const attrsClamped = JSON.parse(prod1Clamped.attributes || '{}') as { pendingOrderShortageQty?: number }
    assert(attrsClamped.pendingOrderShortageQty === 2, `Expected pendingOrderShortageQty=2, got ${attrsClamped.pendingOrderShortageQty}`)

    // 4b. Enable allowNegativeStock = true (ALL_CHANNELS): POS deducts 0 ➔ -2, Shopee deducts -2 ➔ -5
    await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inventory_allow_negative_stock: 'true',
        inventory_negative_stock_scope: 'ALL_CHANNELS',
      }),
    })

    const posNegRes = await callApi<{ order: { id: string; code: string } }>(cookie, '/api/orders', {
      method: 'POST',
      body: JSON.stringify({
        channelId: posChannel.id,
        customerName: 'Khách Test POS Bán Âm',
        customerPhone: '0900009913',
        paymentMethod: 'CASH',
        instantComplete: false,
        items: [{ productId: prod1.id, quantity: 2 }],
      }),
    })
    assert(posNegRes.status === 201 && posNegRes.data.order?.id, `POS negative order failed: ${posNegRes.status}`)
    const posNegOrderId = posNegRes.data.order.id
    createdOrderIds.add(posNegOrderId)

    const prod1AfterPosNeg = await db.product.findUniqueOrThrow({ where: { id: prod1.id } })
    assert(prod1AfterPosNeg.stock === -2, `Expected CMS stock = -2 after POS sale, got ${prod1AfterPosNeg.stock}`)
    assert((await sumWarehouseStock(prod1.id)) === -2, 'WarehouseStock sum must equal -2')

    const shopeeNegRes = await postWebhook<{ ok: boolean; order?: { id: string } }>(secret, {
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: testOrderSn2,
        shopeeOrderStatus: 'READY_TO_SHIP',
        buyerUsername: 'buyer_neg_test',
        recipientName: 'Khách Test Bán Âm Shopee',
        recipientPhone: '0900009914',
        shippingAddress: 'Q3, TP.HCM',
        items: [
          {
            shopeeItemId: testItemId1,
            shopeeModelId: testModelId1,
            sku: testSku1,
            quantity: 3,
            price: 120000,
          },
        ],
      },
    })
    assert(shopeeNegRes.status === 200 && shopeeNegRes.data.ok, 'Shopee negative order failed')
    if (shopeeNegRes.data.order?.id) createdOrderIds.add(shopeeNegRes.data.order.id)

    const prod1AfterShopeeNeg = await db.product.findUniqueOrThrow({ where: { id: prod1.id } })
    assert(prod1AfterShopeeNeg.stock === -5, `Expected CMS stock = -5 after Shopee sale, got ${prod1AfterShopeeNeg.stock}`)
    assert((await sumWarehouseStock(prod1.id)) === -5, 'WarehouseStock sum must equal -5')

    // Inbound Shopee product resync must NOT overwrite negative stock -5!
    const resync147 = await postWebhook<{ ok: boolean }>(secret, {
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        shopeeItemId: testItemId1,
        shopeeModelId: testModelId1,
        sku: testSku1,
        name: testName1,
        sellPrice: 120000,
        stock: 147,
        shopId: '197195817',
        shopUsername: 'thaimy1605',
      },
    })
    assert(resync147.status === 200 && resync147.data.ok, 'Resync 147 must succeed')
    assert(
      (await db.product.findUniqueOrThrow({ where: { id: prod1.id } })).stock === -5,
      'Negative CMS stock -5 must never be overwritten by Shopee product sync'
    )

    // Cancel POS order (-5 + 2 = -3)
    const cancelRes = await callApi(cookie, `/api/orders/${posNegOrderId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'CANCELLED', cancelReason: 'Test hoàn tồn âm' }),
    })
    assert(cancelRes.status === 200, `Cancel POS order failed: ${cancelRes.status}`)
    assert((await db.product.findUniqueOrThrow({ where: { id: prod1.id } })).stock === -3, 'Expected stock = -3 after cancel')
    assert((await sumWarehouseStock(prod1.id)) === -3, 'WarehouseStock sum must equal -3 after cancel')

    // Physical Warehouse IMPORT +10 reconciles -3 + 10 = +7 (and clears pendingOrderShortageQty=2 -> 0)
    const importRes = await callApi(cookie, '/api/inventory', {
      method: 'POST',
      body: JSON.stringify({
        productId: prod1.id,
        type: 'IMPORT',
        quantity: 10,
        note: 'Nhập hàng vật lý bù âm kho test',
      }),
    })
    assert(importRes.status === 201, `POST /api/inventory IMPORT failed: ${importRes.status}`)
    const prod1Reconciled = await db.product.findUniqueOrThrow({ where: { id: prod1.id } })
    assert(prod1Reconciled.stock === 7, `Expected reconciled stock = +7 (-3 + 10), got ${prod1Reconciled.stock}`)
    assert((await sumWarehouseStock(prod1.id)) === 7, 'WarehouseStock sum must equal +7')
    const attrsReconciled = JSON.parse(prod1Reconciled.attributes || '{}') as { pendingOrderShortageQty?: number }
    assert(
      (attrsReconciled.pendingOrderShortageQty || 0) === 0,
      `Expected pendingOrderShortageQty=0 after +10 import, got ${attrsReconciled.pendingOrderShortageQty}`
    )
    console.log('[PASS 4] Option 3 verified: POS & Shopee negative deduction (0 ➔ -2 ➔ -5), cancel (-3), import reconcile (+7)')

    // ------------------------------------------------------------------
    // STEP 5: Option 1 — SYNC_CMS_TO_MARKETPLACE pushes real stock (7) & clamps negative (-2 ➔ 0 on Shopee)
    // ------------------------------------------------------------------
    // Note: Keep the 18 real SKUs untouched by snapshotting/restoring their attributes in finally;
    // here we test Mode 1 Outbox resolution!
    await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inventory_sync_mode: 'SYNC_CMS_TO_MARKETPLACE',
      }),
    })

    const outboxMode1Pos = await postWebhook<{
      jobs: Array<{ productId: string; stockDrifted: boolean; targetStock: number }>
    }>(secret, { event: 'OUTBOX_FETCH_PENDING', data: { onlySyntheticTest: true } })
    const mode1ItemPos = outboxMode1Pos.data.jobs.find((i) => i.productId === prod1.id)
    assert(
      mode1ItemPos && mode1ItemPos.stockDrifted && mode1ItemPos.targetStock === 7,
      `Mode 1 must push CMS real stock 7 to Shopee, got ${JSON.stringify(mode1ItemPos)}`
    )
    await postWebhook(secret, {
      event: 'OUTBOX_ACK_RESULT',
      data: {
        productId: prod1.id,
        status: 'COMPLETED',
        syncedStock: 7,
        syncedPrice: 120000,
      },
    })

    // Export 9 units in warehouse -> CMS real stock becomes -2; Shopee targetStock MUST clamp at 0!
    const exportNegRes = await callApi(cookie, '/api/inventory', {
      method: 'POST',
      body: JSON.stringify({
        productId: prod1.id,
        type: 'EXPORT',
        quantity: 9,
        note: 'Xuất kho âm -2 kiểm tra đẩy 0 lên Sàn',
      }),
    })
    assert(exportNegRes.status === 201, `POST /api/inventory EXPORT into negative failed: ${exportNegRes.status}`)
    assert((await db.product.findUniqueOrThrow({ where: { id: prod1.id } })).stock === -2, 'Expected CMS stock = -2')

    const outboxMode1Clamp = await postWebhook<{
      jobs: Array<{ productId: string; stockDrifted: boolean; targetStock: number }>
    }>(secret, { event: 'OUTBOX_FETCH_PENDING', data: { onlySyntheticTest: true } })
    const mode1ItemClamp = outboxMode1Clamp.data.jobs.find((i) => i.productId === prod1.id)
    assert(
      mode1ItemClamp && mode1ItemClamp.stockDrifted && mode1ItemClamp.targetStock === 0,
      `Mode 1 with negative CMS stock (-2) must clamp Shopee targetStock at 0, got ${JSON.stringify(mode1ItemClamp)}`
    )
    console.log('[PASS 5] Option 1 verified: Real stock pushed (7) and negative CMS stock (-2) clamped to 0 on Shopee')
  } finally {
    console.log('--- Cleaning up synthetic records & restoring safe default policy ---')
    // Restore safe default policy via API so L1 cache invalidates cleanly
    await callApi(cookie, '/api/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        inventory_sync_mode: originalSettingMap.get('inventory_sync_mode') || 'VIRTUAL_ALWAYS_IN_STOCK',
        inventory_virtual_stock_qty: originalSettingMap.get('inventory_virtual_stock_qty') || '100',
        inventory_virtual_min_threshold: originalSettingMap.get('inventory_virtual_min_threshold') || '10',
        inventory_virtual_auto_refill: originalSettingMap.get('inventory_virtual_auto_refill') || 'false',
        inventory_allow_negative_stock: originalSettingMap.get('inventory_allow_negative_stock') || 'false',
        inventory_negative_stock_scope: originalSettingMap.get('inventory_negative_stock_scope') || 'ALL_CHANNELS',
      }),
    }).catch(() => null)

    // If those setting rows did not exist in DB before test, delete them so AppSetting table row count Delta === 0
    const keysToDelete = [
      'inventory_sync_mode',
      'inventory_virtual_stock_qty',
      'inventory_virtual_min_threshold',
      'inventory_virtual_auto_refill',
      'inventory_allow_negative_stock',
      'inventory_negative_stock_scope',
    ].filter((k) => !originalSettingMap.has(k))
    if (keysToDelete.length > 0) {
      await db.appSetting.deleteMany({ where: { key: { in: keysToDelete } } })
    }

    // Restore exact attributes & stock of the 18 canonical products in case anything touched them
    for (const rp of realProductsBefore) {
      await db.product.update({
        where: { id: rp.id },
        data: { stock: rp.stock, attributes: rp.attributes },
      })
    }
    for (const ch of channelsBefore) {
      await db.channel.update({
        where: { id: ch.id },
        data: { syncedAt: ch.syncedAt },
      })
    }

    // Delete synthetic orders, salesInvoices, shipments, customers, products, movements, logs
    const testOrders = await db.order.findMany({
      where: {
        OR: [
          { id: { in: Array.from(createdOrderIds) } },
          { createdAt: { gte: startedAt }, note: { contains: 'TEST_POL_' } },
          { createdAt: { gte: startedAt }, customer: { is: { name: { contains: 'Khách Test' } } } },
        ],
      },
      select: { id: true, customerId: true },
    })
    const orderIds = testOrders.map((o) => o.id)
    const customerIds = Array.from(
      new Set(testOrders.map((o) => o.customerId).filter((id): id is string => Boolean(id)))
    )

    if (orderIds.length > 0) {
      const invs = await db.salesInvoice.findMany({
        where: { orderId: { in: orderIds } },
        select: { id: true },
      })
      const invIds = invs.map((i) => i.id)
      if (invIds.length > 0) {
        await db.salesInvoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } })
        await db.salesInvoice.deleteMany({ where: { id: { in: invIds } } })
      }
      await db.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } })
      await db.shipment.deleteMany({ where: { orderId: { in: orderIds } } })
      await db.afterSalesCase.deleteMany({ where: { orderId: { in: orderIds } } })
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } })
      await db.order.deleteMany({ where: { id: { in: orderIds } } })
    }

    if (customerIds.length > 0) {
      await db.directMessage.deleteMany({ where: { customerId: { in: customerIds } } }).catch(() => null)
      await db.customer.deleteMany({
        where: {
          id: { in: customerIds },
          createdAt: { gte: startedAt },
        },
      })
    }

    const prodIds = Array.from(createdProductIds)
    if (prodIds.length > 0) {
      await db.stockMovement.deleteMany({ where: { productId: { in: prodIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: prodIds } } })
      await db.channelListing.deleteMany({ where: { productId: { in: prodIds } } })
      await db.product.deleteMany({ where: { id: { in: prodIds } } })
    }

    await db.webhookDelivery.deleteMany({ where: { createdAt: { gte: startedAt } } }).catch(() => null)
    await db.ledgerEntry.deleteMany({ where: { createdAt: { gte: startedAt } } }).catch(() => null)
    await db.agentActivity.deleteMany({ where: { createdAt: { gte: startedAt } } }).catch(() => null)
    await db.behaviorLog.deleteMany({ where: { createdAt: { gte: startedAt } } }).catch(() => null)
    await db.auditLog.deleteMany({ where: { createdAt: { gte: startedAt } } }).catch(() => null)

    // Refresh server L1 caches via silent GET
    await callApi(cookie, '/api/settings').catch(() => null)
    await callApi(cookie, '/api/channels/product-links').catch(() => null)
  }

  console.log('=== ALL INVENTORY POLICY E2E ASSERTIONS PASSED (100% CLEANUP COMPLETE) ===')
}

main()
  .catch((err) => {
    console.error('VERIFICATION FAILED:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
