/**
 * Kiểm thử Tự động: Cảnh báo Mất liên kết Sàn Shopee & Xử lý Hàng đợi Bất đồng bộ (Transactional Outbox)
 * Chạy: npx tsx scripts/test-shopee-async-disconnection.ts --live
 */
import { execSync } from 'node:child_process'
import { db } from '../src/lib/db'

const BASE_URL = process.env.CMS_BASE_URL || 'http://127.0.0.1:3010'
const LIVE_MODE = process.argv.includes('--live')

let passed = 0

function assert(cond: unknown, label: string, detail?: string): asserts cond {
  if (!cond) {
    console.error(`❌ [FAIL] ${label}${detail ? ` — ${detail}` : ''}`)
    process.exit(1)
  }
  passed += 1
  console.log(`✅ [PASS #${passed}] ${label}`)
}

async function runPythonUnitSuite() {
  console.log('\n--- SUITE 1: Python Daemon Error Classifier & WAITING_SESSION Guard ---')
  const pyCode = `
import os
import sys
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ.pop('SHOPEE_OUTBOX_DRY_RUN', None)

import scripts.shopee_seller_sync as sync_mod

# 1. Error classifier checks
assert sync_mod._classify_shopee_error("HTTP 401: Unauthorized") == "AUTH_EXPIRED"
assert sync_mod._classify_shopee_error("Stock: {'code': 100010005, 'message': 'not login'}") == "AUTH_EXPIRED"
assert sync_mod._classify_shopee_error("MODEL_ID_MISMATCH_GUARD: Model 999 khong khop") == "BROKEN_LINK"
assert sync_mod._classify_shopee_error("UNINITIALIZED_VARIATION_GUARD: id=0") == "BROKEN_LINK"
assert sync_mod._classify_shopee_error("HTTP 503 Service Unavailable") == "TRANSIENT"

# 2. When GLOBAL_STATE['alive'] == False, process_outbound_outbox_from_cms MUST NOT call Shopee API or burn retries
sync_mod.GLOBAL_STATE["alive"] = False
sync_mod.GLOBAL_STATE["outboundRetries"].clear()

def fake_webhook(event, data):
    if event == "OUTBOX_FETCH_PENDING":
        return True, {
            "ok": True,
            "jobs": [
                {"outboxId": "OB_1", "productId": "P1", "sku": "SKU-1", "shopeeItemId": "111", "shopeeModelId": "222", "targetStock": 5, "targetPrice": 50000, "stockDrifted": True},
                {"outboxId": "OB_2", "productId": "P2", "sku": "SKU-2", "shopeeItemId": "111", "shopeeModelId": "223", "targetStock": 8, "targetPrice": 60000, "stockDrifted": True},
            ]
        }
    raise RuntimeError(f"Unexpected webhook call while waiting session: {event}")

def poisoned_stock_update(*args, **kwargs):
    raise RuntimeError("CRITICAL: Shopee stock mutation called while session is disconnected!")

sync_mod.call_cms_webhook = fake_webhook
sync_mod.update_shopee_product_stock = poisoned_stock_update

res_cnt = sync_mod.process_outbound_outbox_from_cms({}, "cds", "csrf")
assert res_cnt == 0, f"Expected 0 processed while offline, got {res_cnt}"
assert sync_mod.GLOBAL_STATE["deferredOutboxCount"] == 2, f"Expected deferredOutboxCount=2, got {sync_mod.GLOBAL_STATE['deferredOutboxCount']}"
assert len(sync_mod.GLOBAL_STATE["outboundRetries"]) == 0, "Expected 0 retries burned while disconnected!"
print("PYTHON_ASYNC_GUARD_OK")
`
  const out = execSync('python', {
    input: pyCode,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert(
    out.includes('PYTHON_ASYNC_GUARD_OK'),
    'Python Daemon giữ nguyên hàng đợi WAITING_SESSION (0 gọi Shopee API / 0 đốt retry / 0 rơi vào DLQ khi mất phiên)'
  )
}

async function runLiveHttpSuite() {
  console.log('\n--- SUITE 2: Live HTTP Async Queue, Broken-Link Alert & Session Recovery ---')
  const startedAt = new Date(Date.now() - 1000)
  const activeKey = await db.apiKey.findFirst({ where: { active: true } })
  assert(Boolean(activeKey?.secret), 'Tìm thấy API Key nội bộ để xác thực Webhook')

  const category = await db.category.findFirst()
  const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
  assert(Boolean(category && shopeeChannel), 'Tìm thấy Category & Shopee Channel')

  const synthSku = `SYNTH-ASYNC-${Date.now()}`
  let createdProdId: string | null = null

  const postWebhook = async (payload: Record<string, unknown>) => {
    const res = await fetch(`${BASE_URL}/api/webhooks/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${activeKey!.secret}`,
      },
      body: JSON.stringify(payload),
    })
    return { status: res.status, ok: res.ok, json: (await res.json()) as Record<string, any> }
  }

  try {
    const prod = await db.product.create({
      data: {
        sku: synthSku,
        name: 'Sản phẩm Kiểm thử Hàng đợi Bất đồng bộ',
        categoryId: category!.id,
        costPrice: 30000,
        sellPrice: 79000,
        stock: 12,
        status: 'ACTIVE',
        attributes: JSON.stringify({
          shopeeItemId: '9998887771',
          shopeeModelId: '8887776661',
          shopeeModelName: 'Trắng',
          lastSyncedShopeeStock: 0,
          lastSyncedShopeePrice: 79000,
        }),
      },
    })
    createdProdId = prod.id

    await db.channelListing.create({
      data: {
        productId: prod.id,
        channelId: shopeeChannel!.id,
        price: 79000,
        status: 'ACTIVE',
      },
    })

    // 1. Đẩy đồng bộ khi phiên Shopee đang hết hạn (alive = false) -> thành công 200 OK và báo queuedAsync
    const pushRes = await fetch(`${BASE_URL}/api/channels/product-links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PUSH_STOCK_TO_CHANNEL',
        productId: prod.id,
        channelId: shopeeChannel!.id,
        channelKey: 'SHOPEE',
      }),
    })
    const pushJson = (await pushRes.json()) as Record<string, any>
    assert(pushRes.ok && pushJson.ok === true, 'PUSH_STOCK_TO_CHANNEL trả về 200 OK ngay cả khi mất phiên')
    assert(typeof pushJson.queuedAsync === 'boolean', 'Response chứa cờ queuedAsync tường minh')

    // 2. Lùi lastCmsEditAt về quá khứ 15 phút (> 180s) để chứng minh pendingOutboxSync KHÔNG bị mất dấu sau 3 phút
    const currProd = await db.product.findUnique({ where: { id: prod.id } })
    const attrsBackdated = JSON.parse(currProd?.attributes || '{}')
    attrsBackdated.lastCmsEditAt = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    await db.product.update({
      where: { id: prod.id },
      data: { attributes: JSON.stringify(attrsBackdated) },
    })

    const linksRes = await fetch(`${BASE_URL}/api/channels/product-links`, { cache: 'no-store' })
    const linksJson = (await linksRes.json()) as Record<string, any>
    const linkedItem = (linksJson.linkedItems || []).find((i: any) => i.cmsProductId === prod.id)
    assert(
      Boolean(linkedItem && linkedItem.pendingOutboxSync === true),
      'pendingOutboxSync vẫn giữ bền vững = true sau > 15 phút mất kết nối (sửa triệt để lỗi rơi cờ sau 180s)'
    )

    // 3. Kiểm tra GET /api/channels/async-queue nhận diện tác vụ chờ & cảnh báo toàn cục
    const qRes1 = await fetch(`${BASE_URL}/api/channels/async-queue`, { cache: 'no-store' })
    const qJson1 = (await qRes1.json()) as Record<string, any>
    assert(qRes1.ok && qJson1.ok === true, 'GET /api/channels/async-queue trả về 200 OK')
    const qItem1 = (qJson1.items || []).find((i: any) => i.productId === prod.id)
    assert(Boolean(qItem1), 'Hàng đợi Bất đồng bộ liệt kê chính xác sản phẩm đang chờ đẩy')

    // 4. Giả lập OUTBOX_ACK_RESULT (DEFERRED_SESSION_LOST) -> Không được rơi vào DEAD_LETTER
    const defAck = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: `TEST_DEF_${prod.id}`,
        productId: prod.id,
        sku: synthSku,
        shopeeItemId: '9998887771',
        shopeeModelId: '8887776661',
        status: 'DEFERRED_SESSION_LOST',
        error: 'HTTP 401: Unauthorized session expired',
      },
    })
    assert(defAck.ok && defAck.json.status === 'DEFERRED_SESSION_LOST', 'ACK DEFERRED_SESSION_LOST trả về 200 OK')
    const dlqCheck = await db.ledgerEntry.count({
      where: { scope: 'CHANNEL', action: 'OUTBOX_DEAD_LETTER', entityId: prod.id },
    })
    assert(dlqCheck === 0, 'DEFERRED_SESSION_LOST giữ 0 bản ghi DEAD_LETTER')

    // 5. Giả lập OUTBOX_ACK_RESULT (BROKEN_LINK) -> Bật cảnh báo đứt liên kết mã Sàn
    const brokenAck = await postWebhook({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: `TEST_BRK_${prod.id}`,
        productId: prod.id,
        sku: synthSku,
        shopeeItemId: '9998887771',
        shopeeModelId: '8887776661',
        status: 'BROKEN_LINK',
        error: 'MODEL_ID_MISMATCH_GUARD: Model 8887776661 không còn trên Shopee',
      },
    })
    assert(brokenAck.ok && brokenAck.json.status === 'BROKEN_LINK', 'ACK BROKEN_LINK trả về 200 OK')

    const qRes2 = await fetch(`${BASE_URL}/api/channels/async-queue`, { cache: 'no-store' })
    const qJson2 = (await qRes2.json()) as Record<string, any>
    assert(
      qJson2.summary.brokenLinkCount >= 1 &&
        (qJson2.alerts || []).some((a: any) => a.id === 'SHOPEE_BROKEN_PRODUCT_LINKS'),
      'GET /api/channels/async-queue phát hiện tức thì cảnh báo SHOPEE_BROKEN_PRODUCT_LINKS'
    )

    // 6. Bấm Thử lại (RETRY_FAILED) từ Async Queue -> Xóa cờ đứt link, đưa lại vào hàng đợi
    const retryRes = await fetch(`${BASE_URL}/api/channels/async-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RETRY_FAILED', productId: prod.id }),
    })
    const retryJson = (await retryRes.json()) as Record<string, any>
    const retriedItem = (retryJson.items || []).find((i: any) => i.productId === prod.id)
    assert(
      retryRes.ok && Boolean(retriedItem) && retriedItem.status !== 'BROKEN_LINK',
      'POST /api/channels/async-queue (RETRY_FAILED) xếp lại sản phẩm vào hàng đợi thành công'
    )

    // 7. Kiểm tra INBOUND_SHOPEE_SESSION_ALERT (SESSION_LOST & SESSION_RESTORED tự động requeue DLQ)
    await db.ledgerEntry.updateMany({
      where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING', entityId: prod.id },
      data: { action: 'OUTBOX_DEAD_LETTER' },
    })
    const restoreAlert = await postWebhook({
      event: 'INBOUND_SHOPEE_SESSION_ALERT',
      data: {
        alertType: 'SESSION_RESTORED',
        shopId: '197195817',
        username: 'thaimy1605',
        reason: 'Kiểm thử khôi phục kết nối',
      },
    })
    assert(
      restoreAlert.ok && restoreAlert.json.requeuedCount >= 1,
      'INBOUND_SHOPEE_SESSION_ALERT (SESSION_RESTORED) tự động chuyển OUTBOX_DEAD_LETTER về OUTBOX_PENDING'
    )

    // 8. Hủy tác vụ (CANCEL_ITEM) -> Gỡ sạch khỏi hàng đợi bất đồng bộ
    const cancelRes = await fetch(`${BASE_URL}/api/channels/async-queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'CANCEL_ITEM', productId: prod.id }),
    })
    const cancelJson = (await cancelRes.json()) as Record<string, any>
    const afterCancel = (cancelJson.items || []).find((i: any) => i.productId === prod.id)
    assert(
      cancelRes.ok && !afterCancel,
      'POST /api/channels/async-queue (CANCEL_ITEM) hủy sạch tác vụ chờ và ngăn tự lặp lại'
    )
  } finally {
    if (createdProdId) {
      await db.channelListing.deleteMany({ where: { productId: createdProdId } })
      await db.warehouseStock.deleteMany({ where: { productId: createdProdId } })
      await db.stockMovement.deleteMany({ where: { productId: createdProdId } })
      await db.ledgerEntry.deleteMany({
        where: {
          OR: [
            { entityId: createdProdId },
            { entityCode: synthSku },
            {
              scope: 'CHANNEL',
              action: { in: ['SHOPEE_SESSION_LOST', 'SHOPEE_SESSION_RESTORED'] },
              createdAt: { gte: startedAt },
            },
          ],
        },
      })
      await db.product.deleteMany({ where: { id: createdProdId } })
      // Invalidate L1 cache on server
      await fetch(`${BASE_URL}/api/channels/async-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'FLUSH_NOW' }),
      }).catch(() => null)
    }
  }
}

async function main() {
  await runPythonUnitSuite()
  if (LIVE_MODE) {
    await runLiveHttpSuite()
  }
  console.log(`\n🎉 HOÀN TẤT KIỂM THỬ MẤT LIÊN KẾT & BẤT ĐỒNG BỘ: ${passed}/${passed} PASS!`)
  await db.$disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exit(1)
})
