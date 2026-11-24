import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  dispatchWebhook,
  resolveSafeProjectRoot,
  verifyInboundWebhook,
} from '@/lib/webhook-service'
import { createOrder, cancelOrder, isMaskedOrDummyPhone } from '@/lib/order-service'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { broadcast, patchProductInApiCache, invalidateApiCache } from '@/lib/realtime'
import { awardPointsForCompletedOrder } from '@/lib/member'
import { syncCombosUsingComponents } from '@/lib/combo'
import { logEvent, sendZalo } from '@/lib/agent-log'
import { ensureCustomerProfile, refreshCustomerMemory } from '@/lib/memory-engine'
import { llmVision } from '@/lib/llm'
import { carrierName, makeTrackingCode } from '@/lib/agents'
import {
  calculateVoucherDiscount,
  ensureWarehousesAndVouchersSeeded,
  syncProductWarehouseStock,
} from '@/lib/warehouse-service'
import { PROTECTED_REAL_SKUS } from '@/app/api/ledger/test-guard/route'
import { enqueueShopeeOrderForLinkedPos } from '@/lib/peripheral-hub'
import { isSyntheticSku } from '@/lib/synthetic-filter'
import {
  getInventorySyncPolicy,
  resolveMarketplaceTargetStock,
} from '@/lib/inventory-policy'
import {
  acquireOrRenewShopeeLeaderLease,
  isCloudRenderRuntime,
  markVaultSessionExpiredInMeta,
  readDecryptedShopeeSessionFromVault,
  readShopeeSessionVaultMetadata,
  saveEncryptedShopeeSessionToVault,
  type ShopeeNodeRole,
} from '@/lib/shopee-session-vault'

export const dynamic = 'force-dynamic'

interface InboundOrderData {
  channelKey?: string
  warehouseId?: string
  warehouseCode?: string
  voucherCode?: string
  discountAmount?: number
  shippingFee?: number
  paymentMethod?: string
  instantComplete?: boolean
  items?: Array<{ productId?: string; sku?: string; quantity?: number }>
  customerName?: string
  customerPhone?: string
  address?: string
  note?: string
}

interface InboundStockData {
  productId?: string
  sku?: string
  warehouseId?: string
  warehouseCode?: string
  delta?: number
  note?: string
}

interface InboundAllianceStockSyncData {
  warehouseCode?: string
  warehouseId?: string
  items?: Array<{ sku?: string; productId?: string; quantity?: number; delta?: number }>
  note?: string
}

interface InboundVoucherValidateData {
  voucherCode?: string
  subtotal?: number
  shippingFee?: number
}

interface InboundShipmentUpdateData {
  trackingCode?: string
  orderCode?: string
  status?: 'DISPATCHED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED'
  codStatus?: 'PENDING' | 'RECEIVED' | 'RECONCILED'
  codReceived?: number
  fee?: number
}

interface InboundZaloMessageData {
  customerName?: string
  customerPhone?: string
  channelKey?: 'ZALO_OA' | 'ZALO_PERSONAL'
  content?: string
  imageUrl?: string
}

interface InboundPaymentConfirmData {
  orderCode?: string
  orderId?: string
  amount?: number
  reference?: string
}

interface InboundSepayTransactionData {
  id?: number | string
  gateway?: string
  transactionDate?: string
  accountNumber?: string
  subAccount?: string | null
  code?: string | null
  content?: string
  transferType?: 'in' | 'out' | string
  transferAmount?: number
  accumulated?: number
  referenceCode?: string
  description?: string
  orderCode?: string
}

export function normalizeShopeeCarrier(rawCarrier?: string): string {
  if (!rawCarrier) return 'SPX'
  const c = rawCarrier.toUpperCase()
  if (c.includes('GHN') || c.includes('GIAO HÀNG NHANH')) return 'GHN'
  if (c.includes('GHTK') || c.includes('TIẾT KIỆM') || c.includes('TIET KIEM')) return 'GHTK'
  if (c.includes('VIETTEL')) return 'VIETTEL'
  if (c.includes('J&T') || c.includes('JT')) return 'JT'
  if (c.includes('NINJA')) return 'NINJA'
  if (c.includes('VNPOST') || c.includes('BƯU ĐIỆN') || c.includes('BUU DIEN')) return 'VNPOST'
  if (c.includes('SPX') || c.includes('SHOPEE')) return 'SPX'
  return rawCarrier.trim().slice(0, 20) || 'SPX'
}

async function syncOrderShipment({
  order,
  trackingNumber,
  shippingCarrier,
  shopeeOrderStatus,
  orderSn,
}: {
  order: { id: string; code: string; status: string; shippingFee?: number; paymentMethod?: string; total: number }
  trackingNumber?: string
  shippingCarrier?: string
  shopeeOrderStatus?: string
  orderSn: string
}) {
  const rawTracking = trackingNumber?.trim()
  const rawCarrier = shippingCarrier?.trim()
  const carrierKey = normalizeShopeeCarrier(rawCarrier)

  const mapStatus = (st?: string): 'DISPATCHED' | 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED' | 'RETURNED' => {
    const s = String(st || '').toUpperCase().trim()
    if (s === 'COMPLETED' || s === '305') return 'DELIVERED'
    if (s === 'SHIPPED' || s === 'TO_CONFIRM_RECEIVE' || s === '304') return 'IN_TRANSIT'
    if (s === 'CANCELLED' || s === 'IN_CANCEL' || s === '306') return 'RETURNED'
    return 'DISPATCHED'
  }
  const targetShipmentStatus = mapStatus(shopeeOrderStatus || order.status)

  const existingShipment = await db.shipment.findUnique({
    where: { orderId: order.id },
  })

  if (existingShipment) {
    const dataToUpdate: Record<string, unknown> = {}
    if (rawTracking && rawTracking !== existingShipment.trackingCode) {
      const clash = await db.shipment.findUnique({ where: { trackingCode: rawTracking } })
      if (!clash || clash.id === existingShipment.id) {
        dataToUpdate.trackingCode = rawTracking
      }
    }
    if (rawCarrier && carrierKey !== existingShipment.carrier) {
      dataToUpdate.carrier = carrierKey
    }

    const rank: Record<string, number> = { DISPATCHED: 1, PICKED_UP: 2, IN_TRANSIT: 3, DELIVERED: 4, RETURNED: 5 }
    const currentRank = rank[existingShipment.status] || 1
    const targetRank = rank[targetShipmentStatus] || 1

    if (targetRank > currentRank || (targetShipmentStatus === 'RETURNED' && existingShipment.status !== 'RETURNED')) {
      dataToUpdate.status = targetShipmentStatus
      if (targetShipmentStatus === 'DELIVERED' && existingShipment.codAmount > 0 && existingShipment.codStatus === 'PENDING') {
        dataToUpdate.codStatus = 'RECEIVED'
        dataToUpdate.codReceived = existingShipment.codAmount
        dataToUpdate.codReceivedAt = new Date()
      }
    }

    if (Object.keys(dataToUpdate).length > 0) {
      const updated = await db.shipment.update({
        where: { id: existingShipment.id },
        data: dataToUpdate,
      })
      broadcast('shipment.updated', {
        id: updated.id,
        orderId: order.id,
        status: updated.status,
        code: order.code,
      })
      await logEvent(
        order.id,
        updated.status === 'DELIVERED' ? 'DELIVERED' : 'STATUS_CHANGED',
        'SYSTEM',
        `Shopee Sync: Cập nhật vận đơn ${updated.trackingCode} (${updated.carrier}) trạng thái ${updated.status}`,
      )
      return updated
    }
    return existingShipment
  }

  if (rawTracking || rawCarrier || ['CONFIRMED', 'SHIPPING', 'COMPLETED'].includes(order.status)) {
    let trackingCode = rawTracking || makeTrackingCode(carrierKey)
    const dup = await db.shipment.findUnique({ where: { trackingCode } })
    if (dup && dup.orderId !== order.id) {
      trackingCode = `${trackingCode}_${orderSn.slice(-4)}`
    }

    const codAmount = order.paymentMethod === 'COD' ? order.total : 0
    const isDelivered = targetShipmentStatus === 'DELIVERED'
    const codStatus = isDelivered && codAmount > 0 ? 'RECEIVED' : 'PENDING'

    const created = await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: carrierKey,
        trackingCode,
        status: targetShipmentStatus,
        fee: order.shippingFee ?? 0,
        codAmount,
        codStatus,
        codReceived: codStatus === 'RECEIVED' ? codAmount : 0,
        codReceivedAt: codStatus === 'RECEIVED' ? new Date() : null,
        dispatchedBy: 'AGENT',
      },
    })
    broadcast('shipment.updated', {
      id: created.id,
      orderId: order.id,
      status: created.status,
      code: order.code,
    })
    await logEvent(
      order.id,
      targetShipmentStatus === 'DELIVERED' ? 'DELIVERED' : 'CARRIER_DISPATCHED',
      'SYSTEM',
      `Shopee Sync: Khởi tạo vận đơn ${carrierKey} (mã: ${trackingCode}) trạng thái ${targetShipmentStatus}`,
    )
    await logLedger({
      scope: 'WEBHOOK',
      action: 'INBOUND_RECEIVED',
      entityType: 'Shipment',
      entityId: created.id,
      entityCode: created.trackingCode,
      title: `[SÀN SHOPEE ➔ CMS] Tự động tạo vận đơn ${created.trackingCode} (${carrierKey}) cho đơn ${order.code}`,
      detail: {
        orderId: order.id,
        orderCode: order.code,
        carrier: carrierKey,
        trackingCode,
        status: targetShipmentStatus,
      },
      actor: 'API',
      originSource: 'SHOPEE_SYNC',
    })
    return created
  }

  return null
}

const WEBHOOK_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Signature',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: WEBHOOK_CORS_HEADERS })
}

// POST /api/webhooks/inbound — nhận webhook từ hệ thống ngoài (ký HMAC X-Signature hoặc Authorization: Apikey cho SePay)
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const hasForwardedFor = Boolean(req.headers.get('x-forwarded-for')?.trim())
    const verified = await verifyInboundWebhook(
      rawBody,
      req.headers.get('x-signature'),
      req.headers.get('authorization'),
      { hasForwardedFor }
    )
    if (!verified.ok) {
      return NextResponse.json(
        { error: verified.reason },
        { status: 401, headers: WEBHOOK_CORS_HEADERS }
      )
    }

    const event = verified.payload.event
    const data = verified.payload.data
    // Chỉ chấp nhận truy cập Kho Phiên Mã Hóa nội bộ khi request đến từ loopback (không qua reverse proxy x-forwarded-for)
    // VÀ được ký bằng khóa cầu nối Daemon nội bộ (CMS_INTERNAL_BRIDGE_SECRET / .cms_bridge_token / CMS_API_KEY), tuyệt đối chặn khóa đối tác ngoài!
    const isTrustedInternalDaemon = !hasForwardedFor && verified.isInternalDaemonBridgeSecret

    // ===== 1. PING: kiểm tra kết nối =====
    if (event === 'INBOUND_PING') {
      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_RECEIVED',
        entityType: 'Webhook',
        title: 'Nhận INBOUND_PING từ hệ thống ngoài',
        detail: { event, result: 'pong' },
        actor: 'API',
      })
      return NextResponse.json({ ok: true, pong: true })
    }

    // ===== 2. Tạo đơn từ hệ thống ngoài / Shop Liên kết =====
    if (event === 'INBOUND_ORDER_CREATE') {
      await ensureWarehousesAndVouchersSeeded()
      const d = (data ?? {}) as InboundOrderData
      const channelKey = d.channelKey?.trim() || 'WEBSITE'
      const channel = await db.channel.findUnique({ where: { key: channelKey } })
      if (!channel) {
        return NextResponse.json({ error: `Không tìm thấy kênh bán với key «${channelKey}»` }, { status: 400 })
      }
      if (!Array.isArray(d.items) || d.items.length === 0) {
        return NextResponse.json({ error: 'Thiếu danh sách sản phẩm (items)' }, { status: 400 })
      }

      const resolvedItems: Array<{ productId: string; quantity: number }> = []
      for (const it of d.items) {
        const qty = Math.max(1, Number(it.quantity) || 1)
        let pid = it.productId ? String(it.productId).trim() : ''
        if (!pid && it.sku) {
          const bySku = await db.product.findFirst({ where: { sku: String(it.sku).trim() }, select: { id: true } })
          if (bySku) pid = bySku.id
        }
        if (pid) resolvedItems.push({ productId: pid, quantity: qty })
      }
      if (resolvedItems.length === 0) {
        return NextResponse.json({ error: 'Danh sách sản phẩm không hợp lệ (cần productId hoặc sku)' }, { status: 400 })
      }

      let targetWarehouseId = d.warehouseId?.trim() || undefined
      if (!targetWarehouseId && d.warehouseCode?.trim()) {
        const wh = await db.warehouse.findUnique({ where: { code: d.warehouseCode.trim().toUpperCase() } })
        if (wh) targetWarehouseId = wh.id
      }

      try {
        const order = await createOrder({
          channelId: channel.id,
          items: resolvedItems,
          warehouseId: targetWarehouseId,
          voucherCode: d.voucherCode?.trim() || undefined,
          discountAmount: typeof d.discountAmount === 'number' ? d.discountAmount : undefined,
          shippingFee: typeof d.shippingFee === 'number' ? d.shippingFee : undefined,
          paymentMethod: d.paymentMethod?.trim() || undefined,
          instantComplete: Boolean(d.instantComplete),
          customerName: d.customerName?.trim() || undefined,
          customerPhone: d.customerPhone?.trim() || undefined,
          address: d.address?.trim() || undefined,
          note: d.note?.trim() || undefined,
        })
        await logLedger({
          scope: 'WEBHOOK',
          action: 'INBOUND_RECEIVED',
          entityType: 'Order',
          entityId: order.id,
          entityCode: order.code,
          title: `[SÀN SHOPEE ➔ CMS] Kéo đơn hàng mới ${order.code} từ kênh ${channel.name} (Tổng: ${order.total.toLocaleString('vi-VN')}đ)`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            source: 'SHOPEE_SELLER_SYNC',
            target: 'OPENVN_CMS',
            event,
            channelKey,
            orderCode: order.code,
            total: order.total,
            voucherCode: order.voucherCode,
            discountAmount: order.discountAmount,
          },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        return NextResponse.json({
          ok: true,
          order: {
            code: order.code,
            id: order.id,
            total: order.total,
            voucherCode: order.voucherCode,
            discountAmount: order.discountAmount,
          },
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Không thể tạo đơn hàng'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    // ===== 3. Cập nhật tồn kho từ hệ thống ngoài (đồng bộ cả Product.stock & WarehouseStock) =====
    if (event === 'INBOUND_STOCK_UPDATE') {
      await ensureWarehousesAndVouchersSeeded()
      const d = (data ?? {}) as InboundStockData
      let productId = d.productId?.trim() || ''
      if (!productId && d.sku?.trim()) {
        const bySku = await db.product.findFirst({ where: { sku: d.sku.trim() }, select: { id: true } })
        if (bySku) productId = bySku.id
      }
      const delta = Number(d.delta)
      if (!productId) return NextResponse.json({ error: 'Thiếu productId hoặc sku' }, { status: 400 })
      if (!Number.isFinite(delta) || delta === 0) {
        return NextResponse.json({ error: 'delta phải là số khác 0' }, { status: 400 })
      }

      const product = await db.product.findUnique({ where: { id: productId } })
      if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })
      if (product.type === 'COMBO') {
        return NextResponse.json(
          { error: 'Sản phẩm Combo tự động tính tồn kho từ thành phần định mức (BOM)' },
          { status: 400 }
        )
      }

      let targetWarehouseId: string | null = d.warehouseId?.trim() || null
      if (!targetWarehouseId && d.warehouseCode?.trim()) {
        const wh = await db.warehouse.findUnique({ where: { code: d.warehouseCode.trim().toUpperCase() } })
        if (wh) targetWarehouseId = wh.id
      }
      if (!targetWarehouseId) {
        const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
        targetWarehouseId = defaultWh?.id ?? null
      }

      const stockAfter = product.stock + delta
      if (stockAfter < 0) {
        return NextResponse.json({ error: `Kho không đủ: hiện có ${product.stock}, không thể trừ ${Math.abs(delta)}` }, { status: 400 })
      }

      await db.product.update({ where: { id: productId }, data: { stock: stockAfter } })
      await syncProductWarehouseStock(productId, targetWarehouseId)
      await db.stockMovement.create({
        data: {
          productId,
          warehouseId: targetWarehouseId,
          type: 'ADJUST',
          quantity: delta,
          stockAfter,
          note: d.note?.trim() || 'Cập nhật kho từ webhook ngoài',
        },
      })
      await syncCombosUsingComponents(db, [productId])

      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_RECEIVED',
        entityType: 'Product',
        entityId: productId,
        entityCode: product.sku,
        title: `Inbound cập nhật kho ${product.sku} ${delta > 0 ? '+' : ''}${delta} → ${stockAfter}`,
        detail: { event, delta, stockAfter, warehouseId: targetWarehouseId },
        actor: 'API',
      })
      dispatchWebhook('stock.movement', {
        productId,
        sku: product.sku,
        warehouseId: targetWarehouseId,
        delta,
        stockAfter,
      })
      broadcast('inventory.updated', { productId, sku: product.sku, stockAfter })
      return NextResponse.json({ ok: true, productId, sku: product.sku, stockAfter, warehouseId: targetWarehouseId })
    }

    // ===== 4. Cập nhật hành trình vận đơn & COD thực tế từ ĐVVC (GHN / GHTK / ViettelPost...) =====
    if (event === 'INBOUND_SHIPMENT_UPDATE') {
      const d = (data ?? {}) as InboundShipmentUpdateData
      const trackingCode = d.trackingCode?.trim()
      const orderCode = d.orderCode?.trim()
      if (!trackingCode && !orderCode) {
        return NextResponse.json({ error: 'Cần cung cấp trackingCode hoặc orderCode' }, { status: 400 })
      }

      const shipment = trackingCode
        ? await db.shipment.findUnique({ where: { trackingCode }, include: { order: true } })
        : await db.shipment.findFirst({ where: { order: { code: orderCode } }, include: { order: true } })

      if (!shipment) {
        return NextResponse.json({ error: 'Không tìm thấy vận đơn tương ứng' }, { status: 404 })
      }

      const validStatuses = ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED']
      const nextStatus = d.status && validStatuses.includes(d.status) ? d.status : shipment.status
      const validCod = ['PENDING', 'RECEIVED', 'RECONCILED']
      let nextCodStatus = d.codStatus && validCod.includes(d.codStatus) ? d.codStatus : shipment.codStatus
      let nextCodReceived = typeof d.codReceived === 'number' ? d.codReceived : shipment.codReceived

      if (nextStatus === 'DELIVERED' && shipment.codAmount > 0 && nextCodStatus === 'PENDING') {
        nextCodStatus = 'RECEIVED'
        nextCodReceived = shipment.codAmount
      }

      const updatedShipment = await db.shipment.update({
        where: { id: shipment.id },
        data: {
          status: nextStatus,
          codStatus: nextCodStatus,
          codReceived: nextCodReceived,
          codReceivedAt: nextCodStatus !== 'PENDING' && !shipment.codReceivedAt ? new Date() : shipment.codReceivedAt,
          fee: typeof d.fee === 'number' && d.fee >= 0 ? d.fee : shipment.fee,
        },
      })

      if (nextStatus === 'PICKED_UP' || nextStatus === 'IN_TRANSIT') {
        await db.order.update({ where: { id: shipment.orderId }, data: { status: 'SHIPPING' } })
        await logEvent(
          shipment.orderId,
          nextStatus,
          'SYSTEM',
          `Webhook ${carrierName(shipment.carrier)}: cập nhật trạng thái «${nextStatus}»`,
        )
      } else if (nextStatus === 'DELIVERED') {
        await db.order.update({
          where: { id: shipment.orderId },
          data: { status: 'COMPLETED', paymentStatus: 'PAID' },
        })
        await logEvent(
          shipment.orderId,
          'DELIVERED',
          'SYSTEM',
          `Webhook ${carrierName(shipment.carrier)}: giao hàng thành công (${shipment.trackingCode})`,
        )
        await awardPointsForCompletedOrder(shipment.orderId)
      }

      await recordLineageChange({
        scope: 'WEBHOOK',
        action: 'INBOUND_SHIPMENT_UPDATE',
        entityType: 'Shipment',
        entityId: shipment.id,
        entityCode: shipment.trackingCode,
        sourceRefCode: shipment.order.code,
        title: `Webhook ĐVVC cập nhật vận đơn ${shipment.trackingCode} → ${nextStatus}`,
        before: { status: shipment.status, codStatus: shipment.codStatus, codReceived: shipment.codReceived },
        after: { status: updatedShipment.status, codStatus: updatedShipment.codStatus, codReceived: updatedShipment.codReceived },
        actor: 'API',
        actorName: `Webhook ${carrierName(shipment.carrier)}`,
        originSource: 'MARKETPLACE_SYNC',
      })

      broadcast('shipment.updated', {
        id: shipment.id,
        orderId: shipment.orderId,
        status: updatedShipment.status,
        code: shipment.order.code,
      })
      broadcast('order.updated', {
        id: shipment.orderId,
        status: nextStatus === 'DELIVERED' ? 'COMPLETED' : 'SHIPPING',
        code: shipment.order.code,
      })

      return NextResponse.json({
        ok: true,
        shipment: {
          id: updatedShipment.id,
          trackingCode: updatedShipment.trackingCode,
          status: updatedShipment.status,
          codStatus: updatedShipment.codStatus,
        },
      })
    }

    // ===== 5. Nhận tin nhắn khách hàng từ Webhook Zalo OA =====
    if (event === 'INBOUND_ZALO_MESSAGE') {
      const d = (data ?? {}) as InboundZaloMessageData
      const content = String(d.content ?? '').trim()
      const imageUrl = d.imageUrl?.trim() || null
      if (!content && !imageUrl) {
        return NextResponse.json({ error: 'Thiếu nội dung tin nhắn (content hoặc imageUrl)' }, { status: 400 })
      }
      const channelKey = d.channelKey === 'ZALO_PERSONAL' ? 'ZALO_PERSONAL' : 'ZALO_OA'
      const phone = d.customerPhone?.trim() || null
      const name = d.customerName?.trim() || 'Khách Zalo'

      let customer = phone ? await db.customer.findFirst({ where: { phone } }) : null
      if (!customer) {
        customer = await db.customer.create({
          data: { name, phone },
        })
        await ensureCustomerProfile(customer.id).catch(() => null)
      }

      let imageAnalysis: string | null = null
      if (imageUrl) {
        imageAnalysis = await llmVision(
          'Mô tả ngắn gọn bằng tiếng Việt (1-2 câu) bức ảnh khách gửi cho tiệm nến & gốm trà: sản phẩm gì, tình trạng (đẹp hay lỗi/vỡ/hở nắp).',
          imageUrl,
        )
      }

      const msg = await sendZalo({
        customerId: customer.id,
        channelKey,
        content: content || '[Khách gửi hình ảnh]',
        sender: 'CUSTOMER',
        isAuto: false,
        imageUrl,
        imageAnalysis,
      })

      await refreshCustomerMemory(customer.id, 'MESSAGE', content || imageAnalysis || 'Khách gửi ảnh').catch(() => null)

      await logLedger({
        scope: 'MESSAGE',
        action: 'INBOUND_RECEIVED',
        entityType: 'Customer',
        entityId: customer.id,
        entityCode: customer.memberCode ?? customer.phone ?? customer.name,
        title: `Nhận tin nhắn Zalo từ ${customer.name}`,
        detail: { channelKey, content: content.slice(0, 120), hasImage: Boolean(imageUrl) },
        actor: 'CUSTOMER',
        originSource: 'ZALO_OA',
      })

      return NextResponse.json({ ok: true, messageId: msg?.id ?? null, customerId: customer.id })
    }

    // ===== 6. Xác nhận thanh toán chuyển khoản (PayOS / VietQR) =====
    if (event === 'INBOUND_PAYMENT_CONFIRM') {
      const d = (data ?? {}) as InboundPaymentConfirmData
      const order = d.orderId
        ? await db.order.findUnique({ where: { id: d.orderId } })
        : d.orderCode
          ? await db.order.findUnique({ where: { code: d.orderCode } })
          : null

      if (!order) {
        return NextResponse.json({ error: 'Không tìm thấy đơn hàng để xác nhận thanh toán' }, { status: 404 })
      }

      const updated = await db.order.update({
        where: { id: order.id },
        data: { paymentStatus: 'PAID' },
      })

      await logEvent(
        order.id,
        'STATUS_CHANGED',
        'SYSTEM',
        `Xác nhận thanh toán tự động qua Webhook${d.reference ? ` (Mã GD: ${d.reference})` : ''}`,
      )

      await recordLineageChange({
        scope: 'ORDER',
        action: 'PAYMENT_MARKED',
        entityType: 'Order',
        entityId: order.id,
        entityCode: order.code,
        sourceRefCode: d.reference ?? order.code,
        title: `Webhook xác nhận thanh toán đơn ${order.code}`,
        before: { paymentStatus: order.paymentStatus },
        after: { paymentStatus: 'PAID' },
        actor: 'API',
        actorName: 'Webhook Thanh toán',
        originSource: 'MARKETPLACE_SYNC',
        detail: { amount: d.amount ?? order.total, reference: d.reference ?? null },
      })

      broadcast('order.updated', { id: order.id, status: updated.status, code: order.code })
      return NextResponse.json({ ok: true, order: { id: updated.id, code: updated.code, paymentStatus: updated.paymentStatus } })
    }

    // ===== 7. Đồng bộ tồn kho Liên Shop Bán chéo (Partner Shop Alliance Stock Sync) =====
    if (event === 'INBOUND_ALLIANCE_STOCK_SYNC') {
      await ensureWarehousesAndVouchersSeeded()
      const d = (data ?? {}) as InboundAllianceStockSyncData
      const warehouseCode = d.warehouseCode?.trim().toUpperCase()
      const warehouse = d.warehouseId
        ? await db.warehouse.findUnique({ where: { id: d.warehouseId } })
        : warehouseCode
          ? await db.warehouse.findUnique({ where: { code: warehouseCode } })
          : await db.warehouse.findFirst({ where: { type: 'PARTNER_SHOP', active: true } })

      if (!warehouse) {
        return NextResponse.json({ error: 'Không tìm thấy Kho / Shop liên kết để đồng bộ' }, { status: 404 })
      }

      const items = Array.isArray(d.items) ? d.items : []
      const synced: Array<{ sku: string; warehouseQuantity: number; totalStock: number }> = []

      for (const item of items) {
        const product = item.productId
          ? await db.product.findUnique({ where: { id: String(item.productId) } })
          : item.sku
            ? await db.product.findFirst({ where: { sku: String(item.sku).trim() } })
            : null

        if (!product || product.type === 'COMBO') continue

        const existingWs = await db.warehouseStock.findUnique({
          where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
        })
        const currentWhQty = existingWs?.quantity ?? 0
        const nextWhQty =
          typeof item.quantity === 'number'
            ? Math.max(0, Math.floor(item.quantity))
            : typeof item.delta === 'number'
              ? Math.max(0, currentWhQty + Math.floor(item.delta))
              : currentWhQty

        const delta = nextWhQty - currentWhQty
        if (delta !== 0) {
          const nextTotalStock = Math.max(0, product.stock + delta)
          await db.$transaction([
            db.warehouseStock.upsert({
              where: { warehouseId_productId: { warehouseId: warehouse.id, productId: product.id } },
              update: { quantity: nextWhQty },
              create: { warehouseId: warehouse.id, productId: product.id, quantity: nextWhQty },
            }),
            db.product.update({
              where: { id: product.id },
              data: { stock: nextTotalStock },
            }),
            db.stockMovement.create({
              data: {
                productId: product.id,
                warehouseId: warehouse.id,
                type: delta > 0 ? 'IMPORT' : 'EXPORT',
                quantity: delta,
                stockAfter: nextTotalStock,
                note: d.note?.trim() || `Đồng bộ tồn kho Liên Shop từ ${warehouse.name} (${warehouse.code})`,
              },
            }),
          ])
          await syncCombosUsingComponents(db, [product.id])
          synced.push({ sku: product.sku, warehouseQuantity: nextWhQty, totalStock: nextTotalStock })
        } else {
          synced.push({ sku: product.sku, warehouseQuantity: currentWhQty, totalStock: product.stock })
        }
      }

      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_ALLIANCE_SYNC',
        entityType: 'Warehouse',
        entityId: warehouse.id,
        entityCode: warehouse.code,
        title: `Inbound đồng bộ tồn kho từ ${warehouse.name} (${synced.length} SKU)`,
        detail: { warehouseCode: warehouse.code, synced },
        actor: 'API',
        originSource: 'MARKETPLACE_SYNC',
      })

      broadcast('inventory.updated', { warehouseId: warehouse.id, syncedCount: synced.length })
      return NextResponse.json({
        ok: true,
        warehouse: { id: warehouse.id, code: warehouse.code, name: warehouse.name },
        syncedCount: synced.length,
        synced,
      })
    }

    // ===== 8. Kiểm tra & Tính chiết khấu Voucher từ Storefront / Zalo Mini App =====
    if (event === 'INBOUND_VOUCHER_VALIDATE') {
      await ensureWarehousesAndVouchersSeeded()
      const d = (data ?? {}) as InboundVoucherValidateData
      const code = String(d.voucherCode ?? '').trim().toUpperCase()
      const subtotal = Math.max(0, Number(d.subtotal ?? 0) || 0)
      const shippingFee = Math.max(0, Number(d.shippingFee ?? 30000) || 0)

      if (!code) {
        return NextResponse.json({ error: 'Thiếu mã voucherCode' }, { status: 400 })
      }
      const voucher = await db.voucher.findUnique({ where: { code } })
      if (!voucher) {
        return NextResponse.json({ ok: true, valid: false, discountAmount: 0, reason: 'Mã giảm giá không tồn tại' })
      }
      const evalRes = calculateVoucherDiscount(voucher, subtotal, shippingFee)
      return NextResponse.json({
        ok: true,
        valid: evalRes.valid,
        discountAmount: evalRes.discountAmount,
        reason: evalRes.reason ?? null,
        voucher: {
          code: voucher.code,
          title: voucher.title,
          discountType: voucher.discountType,
          discountValue: voucher.discountValue,
          minOrderAmount: voucher.minOrderAmount,
        },
      })
    }

    // ===== 9. Nhận biến động số dư Ngân hàng & VietQR tự động từ SePay (sepay.vn) =====
    if (event === 'INBOUND_SEPAY_TRANSACTION') {
      const d = (data ?? {}) as InboundSepayTransactionData
      const gateway = String(d.gateway ?? 'MBBank').trim()
      const accountNumber = String(d.accountNumber ?? '0905123456888').trim()
      const transferAmount = Math.max(0, Number(d.transferAmount ?? 0) || 0)
      const content = String(d.content ?? d.description ?? '').trim()
      const referenceCode = String(d.referenceCode ?? `FT${Date.now()}`).trim()

      // Tự động bóc tách mã đơn DH... từ nội dung chuyển khoản (kể cả khi ngân hàng xóa dấu gạch ngang)
      const normalizeDhCode = (input: string): string => {
        const m = input.match(/DH(\d{6})[-\s]?(\d{3,6})/i)
        return m ? `DH${m[1]}-${m[2]}`.toUpperCase() : ''
      }
      const extractedOrderCode = (
        normalizeDhCode(d.orderCode ?? '') ||
        normalizeDhCode(d.code ?? '') ||
        normalizeDhCode(content) ||
        (d.orderCode?.trim() || d.code?.trim() || '')
      ).toUpperCase()

      let matchedOrder = extractedOrderCode
        ? await db.order.findUnique({ where: { code: extractedOrderCode } })
        : null

      if (matchedOrder && matchedOrder.paymentStatus !== 'PAID') {
        matchedOrder = await db.order.update({
          where: { id: matchedOrder.id },
          data: { paymentStatus: 'PAID' },
        })
        await logEvent(
          matchedOrder.id,
          'STATUS_CHANGED',
          'SYSTEM',
          `SePay (${gateway}): Đã nhận chuyển khoản +${transferAmount.toLocaleString('vi-VN')}đ (Mã tham chiếu: ${referenceCode})`,
        )
        broadcast('order.updated', {
          id: matchedOrder.id,
          status: matchedOrder.status,
          code: matchedOrder.code,
        })
      }

      await logLedger({
        scope: 'WEBHOOK',
        action: 'SEPAY_BANK_TRANSFER_CONFIRMED',
        entityType: 'Order',
        entityId: matchedOrder?.id ?? undefined,
        entityCode: matchedOrder?.code ?? (extractedOrderCode || referenceCode),
        title: `SePay (${gateway}): Nhận +${transferAmount.toLocaleString('vi-VN')}đ · ${extractedOrderCode || content || referenceCode}`,
        detail: {
          provider: 'SEPAY',
          gateway,
          accountNumber,
          transferAmount,
          content,
          referenceCode,
          matchedOrderCode: matchedOrder?.code ?? (extractedOrderCode || null),
          orderPaymentStatus: matchedOrder ? 'PAID' : 'VERIFIED_BANK_INFLOW',
        },
        actor: 'API',
        originSource: 'MARKETPLACE_SYNC',
      })

      return NextResponse.json({
        ok: true,
        provider: 'SEPAY',
        gateway,
        accountNumber,
        transferAmount,
        referenceCode,
        matchedOrderCode: matchedOrder?.code ?? (extractedOrderCode || null),
        paymentStatus: 'PAID',
        message: `Đã xác nhận biến động số dư SePay (+${transferAmount.toLocaleString('vi-VN')}đ qua ${gateway})`,
      })
    }

    // ===== 10. SHOPEE_SESSION_UPDATE: Cập nhật Cookie phiên Kênh Người Bán Shopee (từ Chrome Extension, CDP hoặc Daemon) =====
    if (event === 'INBOUND_SHOPEE_SESSION_UPDATE') {
      const d = (data ?? {}) as {
        cookies?: Record<string, string>
        spc_cds?: string
        csrf_token?: string
        source?: string
        expectedShopId?: string
        shopId?: string
        username?: string
        syncVaultOnly?: boolean
        updatedByRole?: ShopeeNodeRole | 'OPERATOR'
      }
      if (
        !d.cookies ||
        typeof d.cookies !== 'object' ||
        Object.keys(d.cookies).length === 0 ||
        String(d.cookies['SPC_U'] || '') === '3813970' ||
        d.cookies['SPC_ST'] === 'test_token'
      ) {
        return NextResponse.json(
          { error: 'Dữ liệu cookies không hợp lệ hoặc là cookie mẫu bị chặn' },
          { status: 400, headers: WEBHOOK_CORS_HEADERS }
        )
      }

      const spc_cds = d.spc_cds || d.cookies['SPC_CDS'] || 'c2344aba-5428-425d-bba9-04838a499109'
      const csrf_token = d.csrf_token || d.cookies['csrftoken'] || '0BQKllKGsakrP1WMZnz4ZKeXdP3neixB'
      const source = d.source || 'CHROME_EXTENSION_AUTO_SYNC'
      const expectedShopId = (d.expectedShopId || '').trim()

      // Luồng nội bộ 1 chiều từ Python Daemon (đã xác thực Shopee & xoay vòng Cookie trượt):
      // Mã hóa AES-256-GCM và lưu thẳng lên Supabase Vault mà không gọi vòng ngược lại :51898.
      if (d.syncVaultOnly === true) {
        if (!isTrustedInternalDaemon) {
          return NextResponse.json(
            { error: 'Không đủ quyền cập nhật trực tiếp Kho Phiên nội bộ' },
            { status: 403, headers: WEBHOOK_CORS_HEADERS }
          )
        }
        const vaultEnv = await saveEncryptedShopeeSessionToVault({
          cookies: d.cookies,
          spcCds: spc_cds,
          csrfToken: csrf_token,
          shopId: d.shopId || expectedShopId || '197195817',
          username: d.username || 'thaimy1605',
          source,
          updatedByRole: d.updatedByRole || (isCloudRenderRuntime() ? 'CLOUD_RENDER' : 'LOCAL_VN'),
          verifiedLive: true,
        })

        const isSilentSlidingSource = [
          'HEARTBEAT_KEEP_ALIVE',
          'SUBSESSION_AUTO_REFRESH',
          'PRODUCT_LIST_RESPONSE',
          'PRODUCT_INFO_RESPONSE',
          'AUTO_SLIDING_SESSION',
        ].includes(source)

        if (!isSilentSlidingSource) {
          broadcast('channel.updated', {
            key: 'SHOPEE',
            sessionUpdated: true,
            verifiedLive: true,
            shopId: vaultEnv.shopId,
            username: vaultEnv.username,
          })
        }

        return NextResponse.json(
          {
            ok: true,
            verifiedLive: true,
            vaultSynced: true,
            vaultVersion: vaultEnv.version,
            updatedAt: vaultEnv.updatedAt,
            updatedAtMs: vaultEnv.updatedAtMs,
          },
          { headers: WEBHOOK_CORS_HEADERS }
        )
      }

      let verifiedLive = false
      let detectedShopId: string | null = null
      let detectedUsername: string | null = null
      let daemonOnline = false

      // 1. Chuyển tiếp sang Python Sync Daemon (:51898) để nạp nóng RAM + xác thực trực tiếp Shopee
      const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'
      try {
        const bridgeRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cookies: d.cookies,
            spc_cds,
            csrf_token,
            source,
            expectedShopId,
          }),
          signal: AbortSignal.timeout(8000),
        })
        daemonOnline = true
        const bridgeData = (await bridgeRes.json().catch(() => ({}))) as {
          ok?: boolean
          shopId?: string
          username?: string
          error?: string
        }
        if (bridgeRes.status === 409) {
          return NextResponse.json(
            {
              ok: false,
              error:
                bridgeData.error ||
                'Tài khoản Shopee đang đăng nhập không khớp với Shop liên kết.',
              shopId: bridgeData.shopId,
              username: bridgeData.username,
            },
            { status: 409, headers: WEBHOOK_CORS_HEADERS }
          )
        }
        if (bridgeRes.ok && bridgeData.ok) {
          verifiedLive = true
          detectedShopId = bridgeData.shopId ? String(bridgeData.shopId) : null
          detectedUsername = bridgeData.username ? String(bridgeData.username) : null
        }
      } catch {
        // Daemon chưa chạy -> xác thực trực tiếp với Shopee API v2/login bên dưới
      }

      // 2. Khi Daemon chưa bật, xác thực trực tiếp với Shopee API v2/login trước khi lưu Kho Phiên
      if (!verifiedLive && !daemonOnline) {
        try {
          const cookieHeader = Object.entries(d.cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ')
          const loginUrl = `https://banhang.shopee.vn/api/v2/login/?SPC_CDS=${encodeURIComponent(spc_cds)}&SPC_CDS_VER=2`
          const directRes = await fetch(loginUrl, {
            method: 'GET',
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
              Cookie: cookieHeader,
              Accept: 'application/json, text/plain, */*',
              Referer: 'https://banhang.shopee.vn/portal/sale/order',
              'X-CSRFToken': csrf_token,
            },
            signal: AbortSignal.timeout(8000),
          })
          if (directRes.ok) {
            const directJson = (await directRes.json().catch(() => ({}))) as {
              shopid?: number | string
              username?: string
            }
            if (directJson?.shopid) {
              const sid = String(directJson.shopid)
              if (expectedShopId && sid !== expectedShopId) {
                return NextResponse.json(
                  {
                    ok: false,
                    error: `Tài khoản Shopee đang đăng nhập (${directJson.username || '?'} · #${sid}) không khớp với Shop liên kết (#${expectedShopId}).`,
                    shopId: sid,
                    username: directJson.username || null,
                  },
                  { status: 409, headers: WEBHOOK_CORS_HEADERS }
                )
              }
              verifiedLive = true
              detectedShopId = sid
              detectedUsername = directJson.username ? String(directJson.username) : null
            }
          }
        } catch {
          // Bỏ qua lỗi mạng tạm thời
        }

        try {
          const fs = await import('fs')
          const path = await import('path')
          const safeRoot = resolveSafeProjectRoot()
          const sessionPath = path.join(
            /* turbopackIgnore: true */ safeRoot,
            'scripts',
            '.shopee_session.json'
          )
          if (
            fs.existsSync(/* turbopackIgnore: true */ path.dirname(sessionPath)) &&
            (verifiedLive || !fs.existsSync(/* turbopackIgnore: true */ sessionPath))
          ) {
            fs.writeFileSync(
              sessionPath,
              JSON.stringify(
                {
                  cookies: d.cookies,
                  spc_cds,
                  csrf_token,
                  updated_at: new Date().toISOString(),
                  source,
                },
                null,
                2
              ),
              'utf-8'
            )
          }
        } catch {
          // Không chặn nếu filesystem trên container chỉ đọc
        }
      }

      // 3. Mã hóa AES-256-GCM và lưu vào Kho Phiên Supabase (chỉ ghi đè khi đã xác thực Live hoặc Kho Phiên chưa có phiên Live)
      let vaultSynced = false
      const hasCoreCookie = Boolean(
        d.cookies['SPC_ST'] || d.cookies['SPC_SC_SESSION'] || d.cookies['SPC_EC']
      )
      if (hasCoreCookie) {
        const existingVaultMeta = await readShopeeSessionVaultMetadata()
        if (verifiedLive || !existingVaultMeta.hasEncryptedSession || !existingVaultMeta.verifiedLive) {
          await saveEncryptedShopeeSessionToVault({
            cookies: d.cookies,
            spcCds: spc_cds,
            csrfToken: csrf_token,
            shopId: detectedShopId || expectedShopId || '197195817',
            username: detectedUsername || 'thaimy1605',
            source,
            updatedByRole: d.updatedByRole || 'OPERATOR',
            verifiedLive,
          }).catch(() => null)
          vaultSynced = true
        }
      }

      const maskedSpcCds =
        spc_cds.length > 8 ? `${spc_cds.slice(0, 4)}••••${spc_cds.slice(-4)}` : '••••'

      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_RECEIVED',
        entityType: 'Integration',
        title: `Shopee: Cập nhật phiên Cookie Kênh Người Bán (${Object.keys(d.cookies).length} cookies · ${verifiedLive ? 'Live + Cloud Vault' : 'Dự phòng'})`,
        detail: {
          spc_cds_masked: maskedSpcCds,
          has_spc_st: Boolean(d.cookies['SPC_ST']),
          has_spc_sc_session: Boolean(d.cookies['SPC_SC_SESSION']),
          verified_live: verifiedLive,
          vault_synced: vaultSynced,
          shop_id: detectedShopId,
          username: detectedUsername,
          source,
        },
        actor: 'API',
        originSource: 'MARKETPLACE_SYNC',
      })

      broadcast('channel.updated', {
        key: 'SHOPEE',
        sessionUpdated: true,
        verifiedLive,
        vaultSynced,
        shopId: detectedShopId,
        username: detectedUsername,
      })

      return NextResponse.json(
        {
          ok: true,
          verifiedLive,
          vaultSynced,
          daemonOnline,
          shopId: detectedShopId,
          username: detectedUsername,
          message: verifiedLive
            ? 'Đã xác thực & đồng bộ phiên Cookie Shopee lên Kho Phiên Mã Hóa Cloud 24/7!'
            : 'Đã lưu phiên Cookie dự phòng (Daemon đang ngoại tuyến).',
          cookieCount: Object.keys(d.cookies).length,
        },
        { headers: WEBHOOK_CORS_HEADERS }
      )
    }

    // ===== 11. SHOPEE_PRODUCT_SYNC & SHOPEE_BATCH_SYNC: Đồng bộ Sản phẩm/Phân loại từ Shopee về CMS (Batch + Zero-Write Fast-Path) =====
    if (event === 'INBOUND_SHOPEE_PRODUCT_SYNC' || event === 'INBOUND_SHOPEE_BATCH_SYNC') {
      await ensureWarehousesAndVouchersSeeded()
      type ShopeeSyncItemInput = {
        idempotencyKey?: string
        shopeeItemId?: string | number
        shopeeModelId?: string | number
        shopeeModifyTime?: number
        sku?: string
        modelSku?: string
        parentSku?: string
        modelName?: string
        name?: string
        description?: string
        sellPrice?: number
        shopeeNormalPrice?: number | null
        shopeePromotionPrice?: number | null
        costPrice?: number
        stock?: number
        image?: string
        images?: string[]
        isUnlisted?: boolean
        shopId?: string | number
        shopUsername?: string
        autoCreate?: boolean
        forceAdoptOpeningStock?: boolean
        itemActiveModelIds?: Array<string | number>
        attributes?: Record<string, unknown>
      }

      const isBatch = event === 'INBOUND_SHOPEE_BATCH_SYNC'
      const rawData = (data ?? {}) as ShopeeSyncItemInput & { items?: ShopeeSyncItemInput[] }
      const itemsToProcess: ShopeeSyncItemInput[] = isBatch
        ? Array.isArray(rawData.items)
          ? rawData.items
          : []
        : [rawData]

      if (itemsToProcess.length === 0) {
        return NextResponse.json({ ok: true, results: [], syncedCount: 0 })
      }

      // Nạp song song toàn bộ dữ liệu tham chiếu trong 1 roundtrip duy nhất tới Supabase
      const [primaryCategory, fallbackCategory, defaultWh, allActiveProducts, channels, pendingOutboxRows, inventoryPolicy] = await Promise.all([
        db.category.findFirst({ where: { slug: 'an-nhien-thach-thach-cao' } }),
        db.category.findFirst(),
        db.warehouse.findFirst({ where: { isDefault: true } }),
        db.product.findMany({
          where: { status: { not: 'INACTIVE' } },
          include: { listings: { include: { channel: { select: { id: true, key: true } } } } },
        }),
        db.channel.findMany({ where: { key: { in: ['SHOPEE', 'FACEBOOK', 'POS'] } } }),
        db.ledgerEntry.findMany({
          where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING' },
          select: { entityId: true, detail: true },
        }),
        getInventorySyncPolicy(),
      ])

      const pendingOutboxProductIds = new Set<string>()
      const pendingOutboxItemIds = new Set<string>()
      for (const row of pendingOutboxRows) {
        if (row.entityId) pendingOutboxProductIds.add(row.entityId)
        if (row.detail) {
          try {
            const det = JSON.parse(row.detail) as Record<string, unknown>
            if (det.shopeeItemId) pendingOutboxItemIds.add(String(det.shopeeItemId).trim())
          } catch {
            // ignore
          }
        }
      }

      // Kiểm tra trạng thái Test-Guard đang hoạt động để bảo vệ tuyệt đối 13 sản phẩm thật
      const activeTestSnapshot = await db.appSetting.findUnique({ where: { key: 'beta_test_snapshot_v1' } }).catch(() => null)
      const isTestGuardActive = Boolean(activeTestSnapshot) || process.env.TEST_GUARD_ACTIVE === '1'

      const category = primaryCategory ?? fallbackCategory
      if (!category) {
        return NextResponse.json({ error: 'Chưa có danh mục sản phẩm trong DB' }, { status: 400 })
      }

      const results: Array<Record<string, unknown>> = []
      let hasAnyRealMutation = false
      let hasUnlinkedItem = false
      let hasVirtualRefillTrigger = false
      const activeModelsByItemId = new Map<string, Set<string>>()
      const updatedModelIdsByProductId = new Map<string, string>()

      for (const d of itemsToProcess) {
        const rawSku = (d.sku || '').trim()
        const rawModelSku = (d.modelSku || '').trim()
        const name = (d.name || '').trim()
        if (!name) {
          results.push({ ok: false, error: 'Thiếu tên sản phẩm Shopee' })
          continue
        }

        const shopeeItemIdStr = String(d.shopeeItemId || '').trim()
        const shopeeModelIdStr = String(d.shopeeModelId || '').trim()
        if (!shopeeItemIdStr) {
          results.push({ ok: false, error: 'Thiếu mã sản phẩm sàn (shopeeItemId)' })
          continue
        }

        const isRealModelId = Boolean(shopeeModelIdStr && shopeeModelIdStr !== '0')
        const normalizedModelId = isRealModelId ? shopeeModelIdStr : '0'

        if (Array.isArray(d.itemActiveModelIds) && d.itemActiveModelIds.length > 0) {
          const existingSet = activeModelsByItemId.get(shopeeItemIdStr) ?? new Set<string>()
          for (const mid of d.itemActiveModelIds) {
            const mStr = String(mid ?? '').trim()
            if (mStr) existingSet.add(mStr !== '0' ? mStr : '0')
          }
          if (existingSet.size > 0) activeModelsByItemId.set(shopeeItemIdStr, existingSet)
        }

        const hasIncomingPrice =
          d.sellPrice !== undefined && d.sellPrice !== null && String(d.sellPrice).trim() !== '' && Number(d.sellPrice) > 0
        const hasIncomingStock =
          d.stock !== undefined && d.stock !== null && String(d.stock).trim() !== '' && Number.isFinite(Number(d.stock))
        const incomingModifyTime = Number(d.shopeeModifyTime) || Math.floor(Date.now() / 1000)

        // Tầng 1: Tìm sản phẩm CMS đã được liên kết sẵn theo cặp (shopeeItemId, shopeeModelId)
        // Bảo vệ chống đụng độ chéo khi nhiều sản phẩm đơn trên Shopee cùng có shopeeModelId = "0"!
        let existing = allActiveProducts.find((p) => {
          if (!p.attributes) return false
          try {
            const a = JSON.parse(p.attributes) as Record<string, unknown>
            const aItemId = String(a.shopeeItemId || '').trim()
            const aModelRaw = String(a.shopeeModelId || '').trim()
            const aModelNorm = aModelRaw && aModelRaw !== '0' ? aModelRaw : '0'
            if (isRealModelId) {
              if (aItemId && aItemId !== shopeeItemIdStr) return false
              return aModelNorm === normalizedModelId
            }
            return aItemId === shopeeItemIdStr && aModelNorm === '0'
          } catch {
            return false
          }
        })

        // Tầng 2: Nếu chưa có liên kết theo Model ID, tìm sản phẩm CMS có cùng mã SKU
        // Hỗ trợ Auto-Heal Model ID: nếu cùng shopeeItemId và trùng khớp SKU hoàn toàn (do Sàn Shopee vừa đổi/gộp model_id khi sửa phân loại), tự động hàn gắn sang Model ID mới!
        let autoHealedOldModelId = ''
        if (!existing && (rawModelSku || rawSku)) {
          const candidateSku = (rawModelSku || rawSku).toUpperCase()
          existing = allActiveProducts.find((p) => {
            if (p.sku.toUpperCase() !== candidateSku) return false
            if (!p.attributes) return true
            try {
              const a = JSON.parse(p.attributes) as Record<string, unknown>
              const linkedItem = String(a.shopeeItemId || '').trim()
              const linkedModel = String(a.shopeeModelId || '').trim()
              const linkedModelNorm = linkedModel && linkedModel !== '0' ? linkedModel : '0'
              if (linkedItem && linkedItem !== shopeeItemIdStr) return false
              if (linkedModel && linkedModelNorm !== normalizedModelId) {
                // Nếu cùng shopeeItemId và trùng SKU 100%, cho phép Auto-Heal Model ID mới (kể cả gộp về model_id = 0)
                if (linkedItem && linkedItem === shopeeItemIdStr) {
                  autoHealedOldModelId = linkedModel
                  return true
                }
                return false
              }
              return true
            } catch {
              return true
            }
          })
        }

        // Nếu bật autoCreate và trùng SKU với sản phẩm INACTIVE trong DB thì khôi phục sản phẩm đó thay vì tạo trùng gây lỗi Unique Constraint
        if (!existing && d.autoCreate === true && (rawModelSku || rawSku)) {
          const candidateSku = (rawModelSku || rawSku).trim()
          const bySkuAnyStatus = await db.product.findFirst({
            where: { sku: { equals: candidateSku, mode: 'insensitive' } },
            include: { listings: { include: { channel: { select: { id: true, key: true } } } } },
          })
          if (bySkuAnyStatus) {
            existing = bySkuAnyStatus
          }
        }

        const sellPrice = hasIncomingPrice ? Number(d.sellPrice) : existing ? existing.sellPrice : 59000
        const costPrice =
          Number(d.costPrice) > 0
            ? Number(d.costPrice)
            : existing
              ? existing.costPrice
              : Math.round(sellPrice * 0.45)
        const incomingStock = hasIncomingStock ? Math.max(0, Number(d.stock)) : existing ? existing.stock : 0

        // Tầng 3: Đưa vào Hàng đợi Chờ Liên kết Sản phẩm (UNLINKED_MARKETPLACE_ITEM) nếu không khớp SKU
        if (!existing && d.autoCreate !== true) {
          const entityCode = `${shopeeItemIdStr}_${shopeeModelIdStr}`
          const existingUnlinked = await db.ledgerEntry.findFirst({
            where: {
              scope: 'CHANNEL',
              action: 'UNLINKED_MARKETPLACE_ITEM',
              entityCode,
            },
          })
          const unlinkedDetail = {
            channelKey: 'SHOPEE',
            shopeeItemId: shopeeItemIdStr,
            shopeeModelId: shopeeModelIdStr,
            itemActiveModelIds: Array.isArray(d.itemActiveModelIds)
              ? d.itemActiveModelIds.map((m) => String(m ?? '').trim()).filter(Boolean)
              : undefined,
            sku: rawSku,
            modelSku: rawModelSku,
            parentSku: String(d.parentSku || d.attributes?.parentSku || ''),
            modelName: String(d.modelName || d.attributes?.modelName || ''),
            name,
            description: d.description || name,
            sellPrice,
            stock: incomingStock,
            image: d.image || null,
            images: d.images || [],
            isUnlisted: Boolean(d.isUnlisted),
            shopId: String(d.shopId || ''),
            shopUsername: d.shopUsername || '',
            idempotencyKey: d.idempotencyKey,
          }
          if (existingUnlinked) {
            let prevUnlinkedObj: Record<string, unknown> = {}
            try {
              if (existingUnlinked.detail) prevUnlinkedObj = JSON.parse(existingUnlinked.detail)
            } catch {}
            const prevUPrice = Number(prevUnlinkedObj.sellPrice ?? sellPrice)
            const prevUStock = Number(prevUnlinkedObj.stock ?? incomingStock)
            const prevUUnlisted = Boolean(prevUnlinkedObj.isUnlisted ?? Boolean(d.isUnlisted))
            const curUUnlisted = Boolean(d.isUnlisted)
            if (prevUPrice !== sellPrice || prevUStock !== incomingStock || prevUUnlisted !== curUUnlisted) {
              const changeParts: string[] = []
              if (prevUStock !== incomingStock) changeParts.push(`Tồn Sàn: ${prevUStock} ➔ ${incomingStock}`)
              if (prevUPrice !== sellPrice)
                changeParts.push(
                  `Giá Sàn: ${prevUPrice.toLocaleString('vi-VN')}đ ➔ ${sellPrice.toLocaleString('vi-VN')}đ`
                )
              if (prevUUnlisted !== curUUnlisted)
                changeParts.push(`Hiển thị Sàn: ${prevUUnlisted ? 'Đang ẩn' : 'Đang bán'} ➔ ${curUUnlisted ? 'Đang ẩn' : 'Đang bán'}`)
              const displayShopeeSku = rawModelSku || rawSku || 'Chưa có SKU'
              await logLedger({
                scope: 'CHANNEL',
                action: 'SHOPEE_INTERNAL_CHANGED',
                entityType: 'Product',
                entityCode,
                title: `[SÀN SHOPEE ➔ SÀN SHOPEE] Thay đổi trên Sàn (${d.modelName || displayShopeeSku}): ${changeParts.join(' · ')}`,
                detail: {
                  ...unlinkedDetail,
                  direction: 'SHOPEE_TO_SHOPEE',
                  prevStock: prevUStock,
                  newStock: incomingStock,
                  prevPrice: prevUPrice,
                  newPrice: sellPrice,
                  prevUnlisted: prevUUnlisted,
                  newUnlisted: curUUnlisted,
                },
                beforeSnapshot: { stock: prevUStock, sellPrice: prevUPrice, isUnlisted: prevUUnlisted },
                afterSnapshot: { stock: incomingStock, sellPrice, isUnlisted: curUUnlisted },
                changedFields: [
                  ...(prevUStock !== incomingStock ? ['stock'] : []),
                  ...(prevUPrice !== sellPrice ? ['sellPrice'] : []),
                  ...(prevUUnlisted !== curUUnlisted ? ['isUnlisted'] : []),
                ],
                actor: 'API',
                originSource: 'SHOPEE_SYNC',
              })
            }
            const displayShopeeSku = rawModelSku || rawSku || 'Chưa có SKU'
            await db.ledgerEntry.update({
              where: { id: existingUnlinked.id },
              data: {
                title: `[SÀN SHOPEE ➔ CMS] Chờ liên kết SKU: [${displayShopeeSku}] ${name.slice(0, 48)} (${d.modelName || 'Mặc định'})`,
                detail: JSON.stringify({ ...unlinkedDetail, direction: 'SHOPEE_TO_CMS' }),
              },
            })
          } else {
            const displayShopeeSku = rawModelSku || rawSku || 'Chưa có SKU'
            await logLedger({
              scope: 'CHANNEL',
              action: 'SHOPEE_INTERNAL_CREATED',
              entityType: 'Product',
              entityCode,
              title: `[SÀN SHOPEE ➔ SÀN SHOPEE] Phát hiện sản phẩm/phân loại mới trên Sàn: [${displayShopeeSku}] ${name.slice(0, 42)} (${d.modelName || 'Mặc định'})`,
              detail: { ...unlinkedDetail, direction: 'SHOPEE_TO_SHOPEE' },
              afterSnapshot: { stock: incomingStock, sellPrice, isUnlisted: Boolean(d.isUnlisted) },
              actor: 'API',
              originSource: 'SHOPEE_SYNC',
            })
            await logLedger({
              scope: 'CHANNEL',
              action: 'UNLINKED_MARKETPLACE_ITEM',
              entityType: 'Product',
              entityCode,
              title: `[SÀN SHOPEE ➔ CMS] Chờ liên kết SKU: [${displayShopeeSku}] ${name.slice(0, 48)} (${d.modelName || 'Mặc định'})`,
              detail: { ...unlinkedDetail, direction: 'SHOPEE_TO_CMS' },
              actor: 'API',
              originSource: 'SHOPEE_SYNC',
            })
          }
          hasUnlinkedItem = true
          results.push({
            ok: true,
            action: 'QUEUED_FOR_PRODUCT_LINKING',
            reason: 'UNMATCHED_SKU',
            shopeeItemId: shopeeItemIdStr,
            shopeeModelId: shopeeModelIdStr,
            shopeeSku: rawModelSku || rawSku,
          })
          continue
        }

        const sku = existing ? existing.sku : rawModelSku || rawSku || `SP-${shopeeModelIdStr || shopeeItemIdStr}`
        let prevAttrs: Record<string, unknown> = {}
        if (existing?.attributes) {
          try {
            prevAttrs = JSON.parse(existing.attributes) as Record<string, unknown>
          } catch {
            prevAttrs = {}
          }
        }

        // BẢO VỆ DỮ LIỆU CMS TRƯỚC KHI OUTBOX ĐẨY XONG (KÈM TTL GUARD 180 GIÂY CHỐNG TREO KHÓA VĨNH VIỄN):
        // Nếu sản phẩm vừa được chỉnh sửa trên CMS (pendingOutboxSync === true trong vòng 180s hoặc đang có OUTBOX_PENDING trên cùng Item/Product),
        // TUYỆT ĐỐI KHÔNG cho phép dữ liệu cũ từ Shopee Inbound ghi đè ngược lại CMS!
        const lastEditMs = prevAttrs.lastCmsEditAt ? new Date(String(prevAttrs.lastCmsEditAt)).getTime() : 0
        const isRecentPendingFlag =
          prevAttrs.pendingOutboxSync === true &&
          lastEditMs > 0 &&
          Date.now() - lastEditMs < 180_000
        const hasPendingOutbox =
          existing &&
          (isRecentPendingFlag ||
            pendingOutboxProductIds.has(existing.id) ||
            (shopeeItemIdStr && pendingOutboxItemIds.has(shopeeItemIdStr)))

        if (existing && hasPendingOutbox) {
          results.push({
            ok: true,
            action: 'SKIPPED_PENDING_OUTBOX',
            idempotencyKey: d.idempotencyKey,
            product: {
              id: existing.id,
              sku: existing.sku,
              name: existing.name,
              sellPrice: existing.sellPrice,
              stock: existing.stock,
              shopeeItemId: shopeeItemIdStr,
              shopeeModelId: shopeeModelIdStr,
            },
          })
          continue
        }

        const existingShopeeListing = existing?.listings?.find((l) => l.channel.key === 'SHOPEE') ?? null
        const prevSyncedStock =
          typeof prevAttrs.lastSyncedShopeeStock === 'number'
            ? prevAttrs.lastSyncedShopeeStock
            : existing?.stock ?? incomingStock
        const prevSyncedPrice =
          typeof prevAttrs.lastSyncedShopeePrice === 'number'
            ? prevAttrs.lastSyncedShopeePrice
            : existingShopeeListing?.price ?? existing?.sellPrice ?? sellPrice
        const prevSyncedUnlisted =
          typeof prevAttrs.lastSyncedShopeeUnlisted === 'boolean'
            ? prevAttrs.lastSyncedShopeeUnlisted
            : Boolean(prevAttrs.isUnlistedOnShopee)

        const rawShopeeUnlisted = Boolean(d.isUnlisted)
        const shopeeStockChanged = !existing || incomingStock !== prevSyncedStock
        const shopeePriceChanged = !existing || sellPrice !== prevSyncedPrice
        const shopeeUnlistedChanged = !existing || rawShopeeUnlisted !== prevSyncedUnlisted

        // Nếu trạng thái trên sàn KHÔNG thay đổi so với lần đồng bộ trước (!shopeeUnlistedChanged) mà CMS đã chủ động đặt cmsRequestedUnlisted (true hoặc false),
        // giữ nguyên trạng thái của CMS, không cho phép dữ liệu cũ từ sàn ghi đè ngược!
        const incomingIsUnlisted =
          !shopeeUnlistedChanged && typeof prevAttrs.cmsRequestedUnlisted === 'boolean'
            ? prevAttrs.cmsRequestedUnlisted
            : rawShopeeUnlisted
        const prevIsUnlisted = Boolean(prevAttrs.isUnlistedOnShopee)
        const unlistedChanged = prevIsUnlisted !== incomingIsUnlisted

        // Nếu giá trên sàn KHÔNG thay đổi so với lần đồng bộ trước (!shopeePriceChanged), giữ nguyên giá kênh Shopee hiện tại;
        // nếu chủ shop đã cấu hình giá riêng tại POS/CMS khác với giá kênh Shopee (ChannelListing.price !== Product.sellPrice),
        // chỉ cập nhật giá kênh Shopee (effectiveShopeePrice) mà KHÔNG ghi đè giá bán lẻ POS (effectivePrice)!
        const currentShopeePrice = existing
          ? existingShopeeListing?.price ?? existing.sellPrice
          : sellPrice
        const effectiveShopeePrice = existing && !shopeePriceChanged ? currentShopeePrice : sellPrice
        const hasCustomChannelPriceSplit = Boolean(
          existing &&
            existingShopeeListing &&
            existingShopeeListing.price != null &&
            existingShopeeListing.price !== existing.sellPrice
        )
        const effectivePrice =
          existing && hasCustomChannelPriceSplit ? existing.sellPrice : effectiveShopeePrice

        // Bất biến cốt lõi: Tồn kho CMS (Product.stock) BẮT BUỘC 100% là dữ liệu vật lý thật tại kho;
        // tồn kho Sàn Shopee có thể là tồn ảo (trừ khi người vận hành bấm tường minh forceAdoptOpeningStock).
        const forceAdoptOpeningStock = Boolean((d as Record<string, unknown>).forceAdoptOpeningStock)
        let resolvedStock = existing
          ? forceAdoptOpeningStock
            ? incomingStock
            : existing.stock
          : forceAdoptOpeningStock
            ? incomingStock
            : 0
        let conflictDetected = false
        let enqueueOutboxCorrection = false
        let awaitingOrderReconciliation = false
        let awaitingOpeningChoice = false

        const prevOpeningOrigin = String(
          prevAttrs.openingStockOrigin || (forceAdoptOpeningStock ? 'SHOPEE_MARKETPLACE' : 'CMS_WAREHOUSE')
        )
        const prevOpeningLabel = String(
          prevAttrs.openingStockOriginLabel ||
            (prevOpeningOrigin === 'SHOPEE_MARKETPLACE'
              ? `Gốc tồn đầu từ Sàn Shopee (${d.shopUsername || prevAttrs.shopUsername || 'thaimy1605'})`
              : 'Gốc tồn đầu tại Kho CMS (Dữ liệu kho thật)')
        )
        const prevOpeningQty =
          typeof prevAttrs.openingStockQty === 'number'
            ? prevAttrs.openingStockQty
            : existing?.sku === 'BM-COMBO-SEN-01-TRANG'
              ? 16
              : existing
                ? existing.stock
                : resolvedStock

        let nextReconciliationStatus = String(prevAttrs.reconciliationStatus || 'RECONCILED_OK')
        let unreconciledShopeeDelta = 0

        if (existing) {
          if (isTestGuardActive && PROTECTED_REAL_SKUS.has(existing.sku?.toUpperCase()?.trim())) {
            // TRONG PHIÊN TEST-GUARD: TUYỆT ĐỐI BẢO TOÀN TỒN KHO SẢN PHẨM THẬT, KHÔNG CHO PHÉP GHI ĐÈ TỪ SÀN
            resolvedStock = existing.stock
            enqueueOutboxCorrection = false
            nextReconciliationStatus = 'RECONCILED_OK'
            unreconciledShopeeDelta = 0
          } else if (forceAdoptOpeningStock) {
            resolvedStock = incomingStock
            nextReconciliationStatus = 'RECONCILED_OK'
            unreconciledShopeeDelta = 0
          } else if (inventoryPolicy.syncMode === 'SYNC_CMS_TO_MARKETPLACE') {
            // CHẾ ĐỘ 1: Đồng bộ tồn kho thật từ CMS lên Sàn (CMS -> Sàn: max(0, CMS stock))
            resolvedStock = existing.stock
            const clampedCmsStock = Math.max(0, resolvedStock)
            if (!shopeeStockChanged && clampedCmsStock !== incomingStock) {
              enqueueOutboxCorrection = true
              nextReconciliationStatus = 'RECONCILED_OK'
              unreconciledShopeeDelta = 0
            } else if (shopeeStockChanged && incomingStock < clampedCmsStock) {
              // Sàn giảm tồn (có đơn phát sinh trên Sàn) -> giữ tồn kho thật CMS và kích hoạt kéo đơn Sàn về đối chiếu trừ tồn
              awaitingOrderReconciliation = true
              conflictDetected = true
              nextReconciliationStatus = 'PENDING_SHOPEE_ORDER'
              unreconciledShopeeDelta = incomingStock - resolvedStock
            } else if (clampedCmsStock !== incomingStock) {
              // Tồn Sàn đang lệch so với kho thật CMS (VD: vừa chuyển sang Mode 1 hoặc Sàn vừa chỉnh tay) -> đẩy kho thật CMS lên Sàn
              enqueueOutboxCorrection = true
              conflictDetected = shopeeStockChanged
              nextReconciliationStatus = 'RECONCILED_OK'
              unreconciledShopeeDelta = 0
            } else {
              nextReconciliationStatus = 'RECONCILED_OK'
              unreconciledShopeeDelta = incomingStock - resolvedStock
            }
          } else {
            // CHẾ ĐỘ 2 (VIRTUAL_ALWAYS_IN_STOCK): Sàn luôn tồn hàng ở mức ảo & Chống ghi đè tồn thật CMS 100%
            resolvedStock = existing.stock
            enqueueOutboxCorrection = false
            if (shopeeStockChanged && prevSyncedStock >= 0 && incomingStock < prevSyncedStock) {
              // Tồn ảo trên Sàn vừa giảm -> có khách đặt hàng trên Sàn -> kéo đơn về CMS ngay để trừ kho thật / in phiếu
              awaitingOrderReconciliation = true
            }
            if (
              inventoryPolicy.virtualAutoRefill &&
              !incomingIsUnlisted &&
              incomingStock <= inventoryPolicy.virtualMinThreshold &&
              incomingStock !== inventoryPolicy.virtualStockQty
            ) {
              hasVirtualRefillTrigger = true
            }
            if (incomingStock !== resolvedStock) {
              awaitingOpeningChoice = false
              nextReconciliationStatus = 'VIRTUAL_MARKETPLACE_ACTIVE'
              unreconciledShopeeDelta = incomingStock - resolvedStock
            } else {
              nextReconciliationStatus = 'RECONCILED_OK'
              unreconciledShopeeDelta = 0
            }
          }
        } else {
          // Sản phẩm mới kéo từ Sàn về CMS: Kho thật CMS khởi tạo = 0 (trừ khi forceAdoptOpeningStock = true)
          if (
            inventoryPolicy.syncMode === 'VIRTUAL_ALWAYS_IN_STOCK' &&
            inventoryPolicy.virtualAutoRefill &&
            !incomingIsUnlisted &&
            incomingStock <= inventoryPolicy.virtualMinThreshold &&
            incomingStock !== inventoryPolicy.virtualStockQty
          ) {
            hasVirtualRefillTrigger = true
          }
          if (!forceAdoptOpeningStock && incomingStock > 0) {
            if (inventoryPolicy.syncMode === 'SYNC_CMS_TO_MARKETPLACE') {
              enqueueOutboxCorrection = true
              nextReconciliationStatus = 'RECONCILED_OK'
              unreconciledShopeeDelta = 0
            } else {
              nextReconciliationStatus = 'VIRTUAL_MARKETPLACE_ACTIVE'
              unreconciledShopeeDelta = incomingStock - resolvedStock
            }
          } else {
            nextReconciliationStatus = 'RECONCILED_OK'
            unreconciledShopeeDelta = 0
          }
        }

        const incomingModelName = String(d.modelName || d.attributes?.modelName || '').trim()
        const incomingParentSku = String(d.parentSku || d.attributes?.parentSku || '').trim()
        const incomingWeightGram = String(d.attributes?.weightGram || prevAttrs.weightGram || '').trim()
        const incomingModelSkuEffective = String(d.modelSku || d.attributes?.modelSku || rawSku || '').trim()
        const wasBrokenLink = prevAttrs.brokenMarketplaceLink === true

        // Bảo vệ tên & ảnh nội bộ tùy chỉnh trên CMS: nếu người dùng đã sửa tên gọn trên CMS (cmsCustomName = true)
        // hoặc đổi ảnh trên CMS (cmsCustomImage = true), chỉ ghi đè khi tiêu đề / ảnh trên Shopee thực sự thay đổi so với lần đồng bộ trước.
        const shopeeTitleChanged =
          Boolean(name) &&
          Boolean(prevAttrs.lastSyncedShopeeName) &&
          name !== String(prevAttrs.lastSyncedShopeeName)
        const resolvedName =
          existing && prevAttrs.cmsCustomName === true && existing.name && !shopeeTitleChanged
            ? existing.name
            : name
        const shopeeImageChanged =
          Boolean(d.image) &&
          Boolean(prevAttrs.lastSyncedShopeeImage) &&
          d.image !== prevAttrs.lastSyncedShopeeImage
        const resolvedImage =
          existing && prevAttrs.cmsCustomImage === true && existing.image && !shopeeImageChanged
            ? existing.image
            : d.image || existing?.image || null

        const isSameData =
          existing &&
          !autoHealedOldModelId &&
          !wasBrokenLink &&
          existing.name === resolvedName &&
          Boolean(prevAttrs.lastSyncedShopeeName) &&
          String(prevAttrs.lastSyncedShopeeName) === name &&
          existing.image === resolvedImage &&
          (!d.image || prevAttrs.lastSyncedShopeeImage === d.image) &&
          (existing.description || '').trim() === (d.description || existing.description || '').trim() &&
          !unlistedChanged &&
          !shopeeStockChanged &&
          existing.sellPrice === effectivePrice &&
          (!existingShopeeListing || existingShopeeListing.price == null || existingShopeeListing.price === effectiveShopeePrice) &&
          existing.stock === resolvedStock &&
          !enqueueOutboxCorrection &&
          Boolean(prevAttrs.openingStockOrigin) &&
          String(prevAttrs.shopeeModelId || '') === shopeeModelIdStr &&
          String(prevAttrs.shopeeItemId || '') === shopeeItemIdStr &&
          String(prevAttrs.shopeeModelName || '') === incomingModelName &&
          (!incomingModelSkuEffective || String(prevAttrs.shopeeModelSku || '') === incomingModelSkuEffective) &&
          (!incomingParentSku || String(prevAttrs.parentSku || '') === incomingParentSku) &&
          (!incomingWeightGram || String(prevAttrs.weightGram || '') === incomingWeightGram) &&
          Number(prevAttrs.shopeeModifyTime || 0) === incomingModifyTime

        if (existing && isSameData) {
          updatedModelIdsByProductId.set(existing.id, shopeeModelIdStr || String(prevAttrs.shopeeModelId || '').trim())
          if (
            inventoryPolicy.syncMode === 'VIRTUAL_ALWAYS_IN_STOCK' &&
            inventoryPolicy.virtualAutoRefill &&
            !incomingIsUnlisted &&
            incomingStock <= inventoryPolicy.virtualMinThreshold &&
            incomingStock !== inventoryPolicy.virtualStockQty
          ) {
            hasVirtualRefillTrigger = true
          }
          results.push({
            ok: true,
            action: 'SKIPPED_IDEMPOTENT',
            idempotencyKey: d.idempotencyKey,
            product: {
              id: existing.id,
              sku: existing.sku,
              name: existing.name,
              sellPrice: existing.sellPrice,
              stock: existing.stock,
              shopeeItemId: shopeeItemIdStr,
              shopeeModelId: shopeeModelIdStr,
            },
          })
          continue
        }

        const nextAttrsObj: Record<string, unknown> = {
          ...prevAttrs,
          brandLine: 'An Nhiên Thạch · Shopee Sync',
          shopeeItemId: String(d.shopeeItemId || prevAttrs.shopeeItemId || ''),
          shopeeModelId: String(d.shopeeModelId || prevAttrs.shopeeModelId || ''),
          shopeeModelSku: String(d.modelSku || d.attributes?.modelSku || prevAttrs.shopeeModelSku || sku),
          shopeeModelName: incomingModelName || String(prevAttrs.shopeeModelName || ''),
          parentSku: incomingParentSku || String(prevAttrs.parentSku || ''),
          shopeeModifyTime: incomingModifyTime,
          openingStockOrigin: existing && !forceAdoptOpeningStock ? prevOpeningOrigin : forceAdoptOpeningStock ? 'SHOPEE_MARKETPLACE' : 'CMS_WAREHOUSE',
          openingStockOriginLabel:
            existing && !forceAdoptOpeningStock
              ? prevOpeningLabel
              : forceAdoptOpeningStock
                ? `Gốc tồn đầu từ Sàn Shopee (${d.shopUsername || prevAttrs.shopUsername || 'thaimy1605'} · Item #${d.shopeeItemId || ''})`
                : 'Gốc tồn đầu tại Kho CMS (Dữ liệu kho thật)',
          openingStockQty: existing && !forceAdoptOpeningStock ? prevOpeningQty : resolvedStock,
          openingStockLockedAt: String(prevAttrs.openingStockLockedAt || new Date().toISOString()),
          liveShopeeStock: incomingStock,
          unreconciledShopeeDelta,
          reconciliationStatus: nextReconciliationStatus,
          lastSyncedShopeeStock: incomingStock,
          ...(enqueueOutboxCorrection ? { pendingOutboxSync: true } : {}),
          lastSyncedShopeePrice: effectiveShopeePrice,
          ...(typeof d.shopeeNormalPrice === 'number' ? { shopeeNormalPrice: d.shopeeNormalPrice } : {}),
          ...(d.shopeePromotionPrice !== undefined ? { shopeePromotionPrice: d.shopeePromotionPrice } : {}),
          lastSyncedShopeeUnlisted: rawShopeeUnlisted,
          lastIdempotencyKey: d.idempotencyKey || `SYNC_${Date.now()}`,
          lastInboundSyncAt: new Date().toISOString(),
          shopId: String(d.shopId || prevAttrs.shopId || ''),
          shopUsername: d.shopUsername || prevAttrs.shopUsername || '',
          isUnlistedOnShopee: incomingIsUnlisted,
          gallery: d.images && d.images.length > 0 ? d.images : prevAttrs.gallery || [],
          lastSyncedShopeeName: name || prevAttrs.lastSyncedShopeeName || null,
          lastSyncedShopeeImage: d.image || prevAttrs.lastSyncedShopeeImage || null,
          ...(d.attributes || {}),
        }
        if (autoHealedOldModelId || wasBrokenLink) {
          delete nextAttrsObj.brokenMarketplaceLink
          delete nextAttrsObj.brokenLinkReason
          delete nextAttrsObj.brokenLinkDetectedAt
          if (nextAttrsObj.outboxState === 'BROKEN_LINK') {
            delete nextAttrsObj.outboxState
          }
        }
        if (shopeeTitleChanged) {
          nextAttrsObj.cmsCustomName = false
        }
        if (shopeeImageChanged) {
          nextAttrsObj.cmsCustomImage = false
        }
        const attrJson = JSON.stringify(nextAttrsObj)

        const product = existing
          ? await db.product.update({
              where: { id: existing.id },
              data: {
                name: resolvedName,
                description: d.description || existing.description,
                sellPrice: effectivePrice,
                stock: resolvedStock,
                image: resolvedImage,
                attributes: attrJson,
                status: existing.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              },
            })
          : await db.product.create({
              data: {
                sku,
                barcode: null,
                name,
                description: d.description || name,
                categoryId: category.id,
                costPrice,
                sellPrice: effectivePrice,
                stock: resolvedStock,
                lowStockThreshold: 5,
                image: d.image || null,
                status: 'ACTIVE',
                attributes: attrJson,
                unit: 'bộ',
                type: 'SIMPLE',
                fragile: true,
                ownerWarehouseId: defaultWh?.id ?? null,
              },
            })

        updatedModelIdsByProductId.set(product.id, String(nextAttrsObj.shopeeModelId || '').trim())
        hasAnyRealMutation = true

        if (existing && (autoHealedOldModelId || wasBrokenLink)) {
          await db.ledgerEntry.updateMany({
            where: {
              scope: 'CHANNEL',
              action: 'OUTBOX_BROKEN_LINK',
              entityId: product.id,
            },
            data: { action: 'OUTBOX_COMPLETED' },
          })
          if (autoHealedOldModelId) {
            await logLedger({
              scope: 'CHANNEL',
              action: 'SHOPEE_MODEL_ID_AUTO_HEALED',
              entityType: 'Product',
              entityId: product.id,
              entityCode: product.sku,
              title: `[TỰ HÀN GẮN MÃ PHÂN LOẠI] [${product.sku}] tự động khôi phục Model ID Shopee: #${autoHealedOldModelId} ➔ #${shopeeModelIdStr}`,
              detail: {
                direction: 'SHOPEE_TO_CMS',
                sku: product.sku,
                shopeeItemId: shopeeItemIdStr,
                oldModelId: autoHealedOldModelId,
                newModelId: shopeeModelIdStr,
              },
              actor: 'SYSTEM',
              originSource: 'SHOPEE_SYNC',
            })
          }
        }

        if (defaultWh) {
          await syncProductWarehouseStock(product.id, defaultWh.id)
        }

        // Chỉ cập nhật ChannelListing của SHOPEE khi sản phẩm đã tồn tại để KHÔNG ghi đè giá/trạng thái riêng của POS & FACEBOOK!
        const channelsToUpsert = existing ? channels.filter((ch) => ch.key === 'SHOPEE') : channels
        await Promise.all(
          channelsToUpsert.map((ch) => {
            const isShopeeChannel = ch.key === 'SHOPEE'
            const listingStatus = isShopeeChannel ? (incomingIsUnlisted ? 'UNLISTED' : 'ACTIVE') : 'ACTIVE'
            const listingPrice = isShopeeChannel ? effectiveShopeePrice : null
            return db.channelListing.upsert({
              where: {
                productId_channelId: {
                  productId: product.id,
                  channelId: ch.id,
                },
              },
              update: {
                price: listingPrice,
                status: listingStatus,
                description: d.description || name,
                descriptionSyncedAt: new Date(),
              },
              create: {
                productId: product.id,
                channelId: ch.id,
                price: listingPrice,
                status: listingStatus,
                description: d.description || name,
                descriptionSyncedAt: new Date(),
              },
            })
          })
        )

        // Báo động trạng thái sản phẩm Ẩn / Mở bán lại trên sàn về CMS (chỉ khi thực sự thay đổi từ phía sàn Shopee)
        if (unlistedChanged && shopeeUnlistedChanged) {
          if (incomingIsUnlisted) {
            await logLedger({
              scope: 'CHANNEL',
              action: 'SHOPEE_ITEM_UNLISTED_ALERT',
              entityType: 'Product',
              entityId: product.id,
              entityCode: product.sku,
              title: `[SÀN SHOPEE ➔ CMS] CẢNH BÁO: Sản phẩm [${product.sku}] bị ẨN trên sàn Shopee (Item #${d.shopeeItemId})`,
              detail: {
                direction: 'SHOPEE_TO_CMS',
                source: 'SHOPEE_SELLER_SYNC',
                sku: product.sku,
                shopeeItemId: String(d.shopeeItemId || ''),
                shopeeModelId: String(d.shopeeModelId || ''),
                modelName: d.modelName,
                isUnlisted: true,
                reason: 'MARKETPLACE_PRODUCT_UNLISTED_OR_HIDDEN',
                resolvedStock,
                sellPrice: effectivePrice,
              },
              actor: 'API',
              originSource: 'SHOPEE_SYNC',
            })
            broadcast('marketplace.unlisted_alert', {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              shopeeItemId: String(d.shopeeItemId || ''),
              isUnlisted: true,
              message: `Sản phẩm [${product.sku}] ${product.name} vừa bị ẨN trên sàn Shopee!`,
            })
          } else {
            await logLedger({
              scope: 'CHANNEL',
              action: 'SHOPEE_ITEM_RELISTED_ALERT',
              entityType: 'Product',
              entityId: product.id,
              entityCode: product.sku,
              title: `[SÀN SHOPEE ➔ CMS] Sản phẩm [${product.sku}] đã ĐƯỢC MỞ BÁN LẠI trên sàn Shopee (Item #${d.shopeeItemId})`,
              detail: {
                direction: 'SHOPEE_TO_CMS',
                source: 'SHOPEE_SELLER_SYNC',
                sku: product.sku,
                shopeeItemId: String(d.shopeeItemId || ''),
                shopeeModelId: String(d.shopeeModelId || ''),
                modelName: d.modelName,
                isUnlisted: false,
                reason: 'MARKETPLACE_PRODUCT_RELISTED',
                resolvedStock,
                sellPrice: effectivePrice,
              },
              actor: 'API',
              originSource: 'SHOPEE_SYNC',
            })
            broadcast('marketplace.unlisted_alert', {
              productId: product.id,
              sku: product.sku,
              name: product.name,
              shopeeItemId: String(d.shopeeItemId || ''),
              isUnlisted: false,
              message: `Sản phẩm [${product.sku}] ${product.name} đã được Mở bán lại trên Shopee.`,
            })
          }
        }

        if (awaitingOpeningChoice) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'SHOPEE_OPENING_STOCK_CHOICE_REQUIRED',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[CHỐT TỒN ĐẦU KỲ] Kho trống = 0 nhưng Sàn Shopee có ${incomingStock} bộ [${product.sku}] — Chờ chọn: Lấy số tồn từ Sàn làm Tồn đầu kỳ hay Giữ tồn tại Kho CMS`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              sku: product.sku,
              shopeeItemId: String(d.shopeeItemId || ''),
              shopeeModelId: String(d.shopeeModelId || ''),
              cmsWarehouseStock: 0,
              shopeeReportedStock: incomingStock,
              reconciliationStatus: nextReconciliationStatus,
              reason: 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK',
            },
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        if (awaitingOrderReconciliation) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'SHOPEE_STOCK_AWAITING_ORDER_RECONCILIATION',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[ĐỐI CHIẾU ĐƠN SÀN ↔ KHO CMS] Sàn Shopee giảm tồn [${product.sku}] (${resolvedStock} ➔ ${incomingStock}): Giữ tồn Kho (${resolvedStock}) & đồng bộ đơn hàng từ Sàn về CMS để đối chiếu trừ tồn chính xác`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              sku: product.sku,
              shopeeItemId: String(d.shopeeItemId || ''),
              shopeeModelId: String(d.shopeeModelId || ''),
              cmsAuthoritativeStock: resolvedStock,
              shopeeLiveStock: incomingStock,
              unreconciledDelta: incomingStock - resolvedStock,
              openingStockOrigin: nextAttrsObj.openingStockOrigin,
              openingStockOriginLabel: nextAttrsObj.openingStockOriginLabel,
              openingStockQty: nextAttrsObj.openingStockQty,
              reconciliationStatus: nextReconciliationStatus,
              reason: 'MARKETPLACE_SALE_REQUIRES_ORDER_RECONCILIATION',
            },
            actor: 'SYSTEM',
            originSource: 'SHOPEE_SYNC',
          })
          // Kích hoạt kéo đơn hàng Shopee ngay lập tức để đối chiếu và trừ tồn qua INBOUND_SHOPEE_ORDER_SYNC -> createOrder()
          fetch(`${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/trigger-sync`, { method: 'POST' }).catch(() => null)
        }

        if (enqueueOutboxCorrection && !pendingOutboxProductIds.has(product.id) && !prevAttrs.pendingOutboxSync) {
          const clampedTargetStock = Math.max(0, resolvedStock)
          await logLedger({
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đồng bộ kho thật CMS [${product.sku}] (${clampedTargetStock}) lên Shopee`,
            detail: {
              direction: 'CMS_TO_SHOPEE',
              source: 'OPENVN_CMS',
              target: 'SHOPEE_SELLER_CENTER',
              sku: product.sku,
              shopeeItemId: String(d.shopeeItemId || ''),
              shopeeModelId: String(d.shopeeModelId || ''),
              targetStock: clampedTargetStock,
              cmsRealStock: resolvedStock,
              targetPrice: effectiveShopeePrice,
              targetUnlisted: incomingIsUnlisted,
              shopeeReportedStock: incomingStock,
              reason: 'SYNC_CMS_TO_MARKETPLACE_POLICY',
            },
            actor: 'SYSTEM',
            originSource: 'SHOPEE_SYNC',
          })
          pendingOutboxProductIds.add(product.id)
        }

        const shopeeNameChanged = Boolean(existing && (existing.name !== product.name || shopeeTitleChanged))
        const prevModelName = String(prevAttrs.shopeeModelName || '').trim()
        const shopeeModelNameChanged = Boolean(
          existing && incomingModelName !== prevModelName && (incomingModelName || prevModelName)
        )
        const prevModelSku = String(prevAttrs.shopeeModelSku || '').trim()
        const shopeeModelSkuChanged = Boolean(
          existing && incomingModelSkuEffective && prevModelSku && incomingModelSkuEffective !== prevModelSku
        )

        // Ghi nhận biến động tên sản phẩm / tên phân loại từ Shopee vào Sổ Data
        if (existing && (shopeeNameChanged || shopeeModelNameChanged)) {
          const nameDiffParts: string[] = []
          if (shopeeNameChanged) {
            nameDiffParts.push(`Tên SP: «${existing.name.slice(0, 36)}» ➔ «${product.name.slice(0, 36)}»`)
          }
          if (shopeeModelNameChanged) {
            nameDiffParts.push(`Phân loại: «${prevModelName || 'Mặc định'}» ➔ «${incomingModelName || 'Mặc định'}»`)
          }
          await logLedger({
            scope: 'CHANNEL',
            action: 'PRODUCT_NAME_CHANGED',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[SÀN SHOPEE ➔ CMS] Cập nhật tên sản phẩm/phân loại [${product.sku}]: ${nameDiffParts.join(' · ')}`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              sku: product.sku,
              oldName: existing.name,
              newName: product.name,
              oldModelName: prevModelName,
              newModelName: incomingModelName,
              shopeeItemId: d.shopeeItemId,
              shopeeModelId: d.shopeeModelId,
            },
            beforeSnapshot: { name: existing.name, modelName: prevModelName },
            afterSnapshot: { name: product.name, modelName: incomingModelName },
            changedFields: [
              ...(shopeeNameChanged ? ['name'] : []),
              ...(shopeeModelNameChanged ? ['modelName'] : []),
            ],
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        // Ghi nhận biến động giá bán từ Shopee vào Sổ Data (chỉ khi giá sàn thực sự thay đổi so với lần đồng bộ trước)
        if (existing && currentShopeePrice !== effectiveShopeePrice && shopeePriceChanged) {
          const diffP = effectiveShopeePrice - currentShopeePrice
          const sign = diffP > 0 ? '+' : ''
          await logLedger({
            scope: 'CHANNEL',
            action: 'PRODUCT_PRICE_CHANGED',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[SÀN SHOPEE ➔ CMS] Cập nhật giá bán [${product.sku}]: ${currentShopeePrice.toLocaleString('vi-VN')}đ ➔ ${effectiveShopeePrice.toLocaleString('vi-VN')}đ (${sign}${diffP.toLocaleString('vi-VN')}đ)${hasCustomChannelPriceSplit ? ` · Giữ giá POS riêng ${effectivePrice.toLocaleString('vi-VN')}đ` : ''}`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              sku: product.sku,
              oldPrice: currentShopeePrice,
              newPrice: effectiveShopeePrice,
              diffPrice: diffP,
              posSellPrice: effectivePrice,
              channelPriceSplit: hasCustomChannelPriceSplit,
              shopeeItemId: d.shopeeItemId,
              shopeeModelId: d.shopeeModelId,
            },
            beforeSnapshot: { sellPrice: existing.sellPrice, shopeePrice: currentShopeePrice },
            afterSnapshot: { sellPrice: effectivePrice, shopeePrice: effectiveShopeePrice },
            changedFields: hasCustomChannelPriceSplit ? ['shopeePrice'] : ['sellPrice', 'shopeePrice'],
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        // Ghi nhận thay đổi trực tiếp trên Sàn (Sàn ➔ Sàn) + Đồng bộ từ Sàn về CMS (Sàn ➔ CMS)
        if (
          !existing ||
          shopeeStockChanged ||
          shopeePriceChanged ||
          shopeeNameChanged ||
          shopeeModelNameChanged ||
          shopeeModelSkuChanged ||
          shopeeImageChanged ||
          (unlistedChanged && shopeeUnlistedChanged)
        ) {
          if (existing) {
            const shopeeChanges: string[] = []
            if (shopeeNameChanged) shopeeChanges.push(`Tên Sàn: «${existing.name.slice(0, 28)}» ➔ «${name.slice(0, 28)}»`)
            if (shopeeModelNameChanged) shopeeChanges.push(`Phân loại: «${prevModelName || 'Mặc định'}» ➔ «${incomingModelName || 'Mặc định'}»`)
            if (shopeeModelSkuChanged) shopeeChanges.push(`SKU Sàn: ${prevModelSku} ➔ ${incomingModelSkuEffective}`)
            if (shopeeStockChanged) shopeeChanges.push(`Tồn Sàn: ${prevSyncedStock} ➔ ${incomingStock}`)
            if (shopeePriceChanged)
              shopeeChanges.push(
                `Giá Sàn: ${prevSyncedPrice.toLocaleString('vi-VN')}đ ➔ ${sellPrice.toLocaleString('vi-VN')}đ`
              )
            if (unlistedChanged && shopeeUnlistedChanged)
              shopeeChanges.push(
                `Hiển thị Sàn: ${prevSyncedUnlisted ? 'Đang ẩn' : 'Đang bán'} ➔ ${rawShopeeUnlisted ? 'Đang ẩn' : 'Đang bán'}`
              )
            if (shopeeImageChanged) shopeeChanges.push('Ảnh đại diện Sàn mới')
            if (shopeeChanges.length > 0) {
              await logLedger({
                scope: 'CHANNEL',
                action: 'SHOPEE_INTERNAL_CHANGED',
                entityType: 'Product',
                entityId: product.id,
                entityCode: product.sku,
                title: `[SÀN SHOPEE ➔ SÀN SHOPEE] Biến động trực tiếp trên Sàn [${product.sku}]: ${shopeeChanges.join(' · ')}`,
                detail: {
                  direction: 'SHOPEE_TO_SHOPEE',
                  source: 'SHOPEE_SELLER_CENTER',
                  target: 'SHOPEE_SELLER_CENTER',
                  sku: product.sku,
                  shopeeItemId: d.shopeeItemId,
                  shopeeModelId: d.shopeeModelId,
                  prevName: existing.name,
                  incomingName: name,
                  prevModelName,
                  incomingModelName,
                  prevSyncedStock,
                  incomingStock,
                  prevSyncedPrice,
                  incomingPrice: sellPrice,
                  prevSyncedUnlisted,
                  incomingUnlisted: rawShopeeUnlisted,
                },
                beforeSnapshot: {
                  name: existing.name,
                  modelName: prevModelName,
                  shopeeStock: prevSyncedStock,
                  shopeePrice: prevSyncedPrice,
                  isUnlisted: prevSyncedUnlisted,
                },
                afterSnapshot: {
                  name,
                  modelName: incomingModelName,
                  shopeeStock: incomingStock,
                  shopeePrice: sellPrice,
                  isUnlisted: rawShopeeUnlisted,
                },
                changedFields: [
                  ...(shopeeNameChanged ? ['name'] : []),
                  ...(shopeeModelNameChanged ? ['modelName'] : []),
                  ...(shopeeModelSkuChanged ? ['shopeeModelSku'] : []),
                  ...(shopeeStockChanged ? ['shopeeStock'] : []),
                  ...(shopeePriceChanged ? ['shopeePrice'] : []),
                  ...(unlistedChanged && shopeeUnlistedChanged ? ['isUnlisted'] : []),
                  ...(shopeeImageChanged ? ['image'] : []),
                ],
                actor: 'API',
                originSource: 'SHOPEE_SYNC',
              })
            }
          }

          await logLedger({
            scope: 'CHANNEL',
            action: existing ? 'SHOPEE_INBOUND_UPDATED' : 'SHOPEE_INBOUND_CREATED',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[SÀN SHOPEE ➔ CMS] ${existing ? 'Cập nhật' : 'Tạo mới'} [${product.sku}] ${product.name.slice(0, 48)} (Tồn: ${resolvedStock}, Giá Shopee: ${effectiveShopeePrice.toLocaleString('vi-VN')}đ)`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              target: 'OPENVN_CMS',
              idempotencyKey: d.idempotencyKey,
              shopeeItemId: d.shopeeItemId,
              shopeeModelId: d.shopeeModelId,
              sellPrice: effectivePrice,
              shopeePrice: effectiveShopeePrice,
              incomingStock,
              resolvedStock,
              conflictDetected,
              isUnlisted: incomingIsUnlisted,
              shopUsername: d.shopUsername,
            },
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        results.push({
          ok: true,
          action: existing ? 'UPDATED' : 'CREATED',
          conflictResolved: conflictDetected,
          outboxEnqueued: enqueueOutboxCorrection,
          autoHealedOldModelId: autoHealedOldModelId || undefined,
          product: {
            id: product.id,
            sku: product.sku,
            name: product.name,
            sellPrice: product.sellPrice,
            shopeePrice: effectiveShopeePrice,
            stock: product.stock,
            shopeeItemId: nextAttrsObj.shopeeItemId,
            shopeeModelId: nextAttrsObj.shopeeModelId,
          },
        })
      }

      // Phát hiện chủ động phân loại (Model ID) vừa bị XÓA hoặc thay thế trên Sàn Shopee dựa trên danh sách itemActiveModelIds
      if (activeModelsByItemId.size > 0) {
        const allIncomingSynthetic = itemsToProcess.every((it) =>
          isSyntheticSku(it.sku || it.modelSku || '', PROTECTED_REAL_SKUS)
        )
        for (const [itemId, activeModelSet] of activeModelsByItemId.entries()) {
          for (const sib of allActiveProducts) {
            if (isTestGuardActive && allIncomingSynthetic && PROTECTED_REAL_SKUS.has(sib.sku?.toUpperCase()?.trim())) {
              continue
            }
            let sibAttrs: Record<string, unknown> = {}
            try {
              sibAttrs = sib.attributes ? (JSON.parse(sib.attributes) as Record<string, unknown>) : {}
            } catch {
              continue
            }
            if (String(sibAttrs.shopeeItemId || '').trim() !== itemId) continue
            const rawSibModelId =
              updatedModelIdsByProductId.get(sib.id) ?? String(sibAttrs.shopeeModelId || '').trim()
            const effectiveSibModelId = rawSibModelId && rawSibModelId !== '0' ? rawSibModelId : '0'
            if (activeModelSet.has(effectiveSibModelId)) continue
            if (sibAttrs.brokenMarketplaceLink === true) continue

            const reasonStr = `Phân loại (Model #${effectiveSibModelId}) của Item #${itemId} không còn tồn tại trong danh sách phân loại đang hoạt động trên Shopee`
            sibAttrs.pendingOutboxSync = false
            sibAttrs.outboxState = 'BROKEN_LINK'
            sibAttrs.brokenMarketplaceLink = true
            sibAttrs.brokenLinkReason = reasonStr
            sibAttrs.brokenLinkDetectedAt = new Date().toISOString()

            await db.product.update({
              where: { id: sib.id },
              data: { attributes: JSON.stringify(sibAttrs) },
            })
            await db.ledgerEntry.updateMany({
              where: {
                scope: 'CHANNEL',
                action: 'OUTBOX_PENDING',
                entityId: sib.id,
              },
              data: { action: 'OUTBOX_BROKEN_LINK' },
            })
            await logLedger({
              scope: 'CHANNEL',
              action: 'OUTBOX_BROKEN_LINK',
              entityType: 'Product',
              entityId: sib.id,
              entityCode: sib.sku,
              title: `[CẢNH BÁO XÓA PHÂN LOẠI SÀN] Mã [${sib.sku}] mất phân loại Model #${effectiveSibModelId} trên Shopee (Item #${itemId})`,
              detail: {
                direction: 'SHOPEE_TO_CMS',
                status: 'BROKEN_LINK',
                sku: sib.sku,
                shopeeItemId: itemId,
                shopeeModelId: effectiveSibModelId,
                activeModelIds: Array.from(activeModelSet),
                error: reasonStr,
              },
              actor: 'API',
              originSource: 'SHOPEE_SYNC',
            })
            broadcast('channel.link_lost', {
              productId: sib.id,
              sku: sib.sku,
              shopeeItemId: itemId,
              shopeeModelId: effectiveSibModelId,
              reason: reasonStr,
            })
            hasAnyRealMutation = true
          }
        }

        // Thu hồi đồng thời các dòng UNLINKED_MARKETPLACE_ITEM của những model_id cũ đã bị xóa trên cùng shopeeItemId
        const unlinkedOnActiveItems = await db.ledgerEntry.findMany({
          where: {
            scope: 'CHANNEL',
            action: 'UNLINKED_MARKETPLACE_ITEM',
          },
          select: { id: true, entityCode: true, detail: true },
        })
        const staleUnlinkedLedgerIds: string[] = []
        for (const ul of unlinkedOnActiveItems) {
          let ulItemId = ''
          let ulModelId = ''
          let ulSku = ''
          if (ul.detail) {
            try {
              const ud = JSON.parse(ul.detail) as Record<string, unknown>
              ulItemId = String(ud.shopeeItemId || '').trim()
              ulModelId = String(ud.shopeeModelId || '').trim()
              ulSku = String(ud.modelSku || ud.sku || '').trim()
            } catch {
              // ignore
            }
          }
          if (!ulItemId && ul.entityCode && ul.entityCode.includes('_')) {
            const idx = ul.entityCode.indexOf('_')
            ulItemId = ul.entityCode.slice(0, idx).trim()
            ulModelId = ul.entityCode.slice(idx + 1).trim()
          }
          const activeSet = activeModelsByItemId.get(ulItemId)
          if (!activeSet || activeSet.size === 0) continue
          if (isTestGuardActive && allIncomingSynthetic && !isSyntheticSku(ulSku, PROTECTED_REAL_SKUS)) {
            continue
          }
          const normModelId = ulModelId && ulModelId !== '0' ? ulModelId : '0'
          if (!activeSet.has(normModelId)) {
            staleUnlinkedLedgerIds.push(ul.id)
          }
        }
        if (staleUnlinkedLedgerIds.length > 0) {
          await db.ledgerEntry.updateMany({
            where: { id: { in: staleUnlinkedLedgerIds } },
            data: { action: 'UNLINKED_STALE_MODEL_REMOVED' },
          })
          hasUnlinkedItem = true
          hasAnyRealMutation = true
        }
      }

      // Cập nhật thời điểm đồng bộ kênh SHOPEE 1 lần duy nhất cho cả lô
      const shopeeCh = channels.find((c) => c.key === 'SHOPEE')
      if (shopeeCh && hasAnyRealMutation) {
        await db.channel.update({
          where: { id: shopeeCh.id },
          data: { connected: true, syncedAt: new Date() },
        })
      }

      if (hasUnlinkedItem) {
        invalidateApiCache('channels')
        broadcast('channel.unlinked_item', { count: results.filter((r) => r.action === 'QUEUED_FOR_PRODUCT_LINKING').length })
      }
      if (hasAnyRealMutation) {
        invalidateApiCache('products')
        invalidateApiCache('channels')
        invalidateApiCache('inventory:')
        invalidateApiCache('reports:')
        broadcast('product.updated', { batchSync: true, batchCount: results.length })
        broadcast('inventory.updated', { batchCount: results.length })
      }
      if (
        hasVirtualRefillTrigger &&
        !itemsToProcess.every((it) => isSyntheticSku(it.sku || it.modelSku || '', PROTECTED_REAL_SKUS))
      ) {
        broadcast('outbox.updated', { reason: 'virtual_auto_refill_triggered' })
        fetch(
          `${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/trigger-sync`,
          { method: 'POST' }
        ).catch(() => null)
      }

      if (!isBatch) {
        return NextResponse.json(results[0] ?? { ok: true })
      }

      return NextResponse.json({
        ok: true,
        batchSize: itemsToProcess.length,
        results,
      })
    }

    // ===== 12. SHOPEE_ORDER_SYNC: Đồng bộ bất đồng bộ Đơn hàng & Trạng thái từ Shopee về CMS (Idempotent) =====
    if (event === 'INBOUND_SHOPEE_ORDER_SYNC') {
      await ensureWarehousesAndVouchersSeeded()
      const d = (data ?? {}) as {
        idempotencyKey?: string
        shopeeOrderSn?: string
        shopeeOrderId?: string | number
        shopeeOrderStatus?: string
        customerName?: string
        customerPhone?: string
        buyerUsername?: string
        address?: string
        paymentMethod?: string
        shippingFee?: number
        trackingNumber?: string
        shippingCarrier?: string
        orderTotal?: number
        autoCreateUnlinkedSku?: boolean
        allowSyntheticPrintQueue?: boolean
        items?: Array<{
          sku?: string
          modelSku?: string
          shopeeItemId?: string | number
          shopeeModelId?: string | number
          name?: string
          modelName?: string
          price?: number
          quantity?: number
        }>
      }
      const orderSn = String(d.shopeeOrderSn || d.shopeeOrderId || '').trim()
      if (!orderSn) {
        return NextResponse.json({ error: 'Thiếu mã đơn hàng Shopee (shopeeOrderSn)' }, { status: 400 })
      }

      let existingOrder = await db.order.findFirst({
        where: {
          note: { contains: `Shopee Order #${orderSn}` },
        },
        include: { items: true },
      })

      // Fallback tra cứu bổ sung nếu đơn hàng được ghi nhận dạng `#orderSn` hoặc `orderSn`
      if (!existingOrder) {
        existingOrder = await db.order.findFirst({
          where: {
            OR: [
              { note: { contains: `#${orderSn}` } },
              { note: { contains: orderSn } },
            ],
          },
          include: { items: true },
        })
      }

      const mapShopeeStatusToCms = (st?: string): 'PENDING' | 'CONFIRMED' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED' => {
        const s = String(st || '').toUpperCase().trim()
        if (s === 'COMPLETED' || s === '305') return 'COMPLETED'
        if (s === 'SHIPPED' || s === 'TO_CONFIRM_RECEIVE' || s === '304') return 'SHIPPING'
        if (s === 'PROCESSED' || s === 'READY_TO_SHIP' || s === '302' || s === '303') return 'CONFIRMED'
        if (s === 'CANCELLED' || s === 'IN_CANCEL' || s === '306') return 'CANCELLED'
        if (s === 'UNPAID' || s === '301') return 'PENDING'
        return 'CONFIRMED'
      }

      const nextStatus = mapShopeeStatusToCms(d.shopeeOrderStatus)

      // --------------------------------------------------------------------------
      // CASE 1: ĐƠN HÀNG ĐÃ TỒN TẠI TRONG CMS
      // --------------------------------------------------------------------------
      if (existingOrder) {
        // Nếu đơn hàng đã ở trạng thái cuối, chặn chuyển ngược bất hợp lý
        if (
          (existingOrder.status === 'CANCELLED' && nextStatus !== 'CANCELLED') ||
          (existingOrder.status === 'COMPLETED' && nextStatus !== 'COMPLETED')
        ) {
          return NextResponse.json(
            {
              error: `Đơn hàng #${orderSn} đã ở trạng thái cuối (${existingOrder.status}), không thể chuyển ngược sang ${nextStatus}`,
              order: {
                id: existingOrder.id,
                code: existingOrder.code,
                status: existingOrder.status,
                shopeeOrderSn: orderSn,
              },
            },
            { status: 409 },
          )
        }

        // Nếu đơn chuyển sang CANCELLED
        if (nextStatus === 'CANCELLED') {
          if (existingOrder.status === 'CANCELLED') {
            await syncOrderShipment({
              order: existingOrder,
              trackingNumber: d.trackingNumber,
              shippingCarrier: d.shippingCarrier,
              shopeeOrderStatus: d.shopeeOrderStatus,
              orderSn,
            })
            return NextResponse.json({
              ok: true,
              action: 'SKIPPED_IDEMPOTENT',
              order: {
                id: existingOrder.id,
                code: existingOrder.code,
                status: existingOrder.status,
                shopeeOrderSn: orderSn,
              },
            })
          }

          // Thực thi hủy đơn và hoàn kho an toàn qua cancelOrder() (bảo toàn 100% tồn = 0 nếu đơn nhận lúc kho trống)
          const cancelRes = await cancelOrder({
            orderId: existingOrder.id,
            reason: `Shopee Inbound Sync: Đơn hàng bị hủy trên sàn (#${orderSn})`,
            actor: 'API',
            actorName: 'Shopee Seller Sync',
            originSource: 'SHOPEE_SYNC',
          })

          if (cancelRes.alreadyCancelled) {
            return NextResponse.json({
              ok: true,
              action: 'SKIPPED_IDEMPOTENT',
              order: {
                id: existingOrder.id,
                code: existingOrder.code,
                status: 'CANCELLED',
                shopeeOrderSn: orderSn,
              },
            })
          }

          await syncOrderShipment({
            order: { ...existingOrder, status: 'CANCELLED' },
            trackingNumber: d.trackingNumber,
            shippingCarrier: d.shippingCarrier,
            shopeeOrderStatus: 'CANCELLED',
            orderSn,
          })

          return NextResponse.json({
            ok: true,
            action: 'ORDER_CANCELLED_RESTOCKED',
            order: {
              id: existingOrder.id,
              code: existingOrder.code,
              status: 'CANCELLED',
              shopeeOrderSn: orderSn,
              restockedCount: cancelRes.restockedCount,
            },
          })
        }

        // Chuyển trạng thái thông thường (PENDING -> CONFIRMED -> SHIPPING -> COMPLETED)
        if (existingOrder.status !== nextStatus) {
          const updated = await db.order.update({
            where: { id: existingOrder.id },
            data: {
              status: nextStatus,
              paymentStatus: nextStatus === 'COMPLETED' ? 'PAID' : existingOrder.paymentStatus,
            },
          })

          if (nextStatus === 'COMPLETED' && existingOrder.status !== 'COMPLETED') {
            awardPointsForCompletedOrder(updated.id).catch(() => null)
          }

          await logEvent(
            existingOrder.id,
            'STATUS_CHANGED',
            'SYSTEM',
            `Shopee Async Sync: Đơn #${orderSn} chuyển trạng thái ${existingOrder.status} → ${nextStatus}`,
          )
          broadcast('order.updated', { id: updated.id, code: updated.code, status: updated.status })

          const syncedShip = await syncOrderShipment({
            order: updated,
            trackingNumber: d.trackingNumber,
            shippingCarrier: d.shippingCarrier,
            shopeeOrderStatus: d.shopeeOrderStatus,
            orderSn,
          })

          if (nextStatus === 'CONFIRMED' || nextStatus === 'SHIPPING') {
            enqueueShopeeOrderForLinkedPos({
              orderId: updated.id,
              orderCode: updated.code,
              shopeeOrderSn: orderSn,
              customerName: d.customerName ?? null,
              note: updated.note,
              total: updated.total,
              trackingCode: syncedShip?.trackingCode ?? d.trackingNumber ?? null,
              carrier: syncedShip?.carrier ? carrierName(syncedShip.carrier) : (d.shippingCarrier ?? 'SPX Express'),
              itemCount: Array.isArray(d.items)
                ? d.items.reduce((s, it) => s + (Number(it.quantity) || 1), 0)
                : existingOrder.items.reduce((s, it) => s + it.quantity, 0) || 1,
              allowSynthetic: Boolean(d.allowSyntheticPrintQueue),
            })
          }

          return NextResponse.json({
            ok: true,
            action: 'STATUS_UPDATED',
            order: { id: updated.id, code: updated.code, status: updated.status, shopeeOrderSn: orderSn },
          })
        }

        // Trạng thái giữ nguyên -> cập nhật vận đơn (nếu có bổ sung tracking/carrier) và trả về SKIPPED_IDEMPOTENT
        const syncedSame = await syncOrderShipment({
          order: existingOrder,
          trackingNumber: d.trackingNumber,
          shippingCarrier: d.shippingCarrier,
          shopeeOrderStatus: d.shopeeOrderStatus,
          orderSn,
        })
        if (syncedSame && (existingOrder.status === 'CONFIRMED' || existingOrder.status === 'SHIPPING')) {
          enqueueShopeeOrderForLinkedPos({
            orderId: existingOrder.id,
            orderCode: existingOrder.code,
            shopeeOrderSn: orderSn,
            customerName: d.customerName ?? null,
            note: existingOrder.note,
            total: existingOrder.total,
            trackingCode: syncedSame.trackingCode,
            carrier: carrierName(syncedSame.carrier),
            itemCount: existingOrder.items.reduce((s, it) => s + it.quantity, 0) || 1,
            allowSynthetic: Boolean(d.allowSyntheticPrintQueue),
          })
        }

        return NextResponse.json({
          ok: true,
          action: 'SKIPPED_IDEMPOTENT',
          order: { id: existingOrder.id, code: existingOrder.code, status: existingOrder.status, shopeeOrderSn: orderSn },
        })
      }

      // --------------------------------------------------------------------------
      // CASE 2: ĐƠN HÀNG MỚI (CHƯA TỒN TẠI TRONG CMS)
      // --------------------------------------------------------------------------
      const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
      if (!shopeeChannel) {
        return NextResponse.json({ error: 'Không tìm thấy kênh SHOPEE' }, { status: 400 })
      }

      const [allProducts, fallbackCat, defaultWh] = await Promise.all([
        db.product.findMany(),
        db.category.findFirst({ orderBy: { createdAt: 'asc' } }),
        db.warehouse.findFirst({ where: { isDefault: true } }),
      ])

      const resolvedItems: Array<{ productId: string; quantity: number; priceOverride?: number }> = []
      const itemPriceOverrides: Record<string, number> = {}
      const autoLinkedSkus: string[] = []

      for (const it of d.items || []) {
        const qty = Math.max(1, Number(it.quantity) || 1)
        const rawItemSku = String(it.sku || '').trim()
        const rawModelSku = String(it.modelSku || '').trim()
        const targetSku = rawModelSku || rawItemSku
        const targetItemId = String(it.shopeeItemId || '').trim()
        const targetModelId = String(it.shopeeModelId || '').trim()
        const rawItemName = String(it.name || '').trim()
        const rawModelName = String(it.modelName || '').trim()
        const hasExplicitItemPrice =
          it.price !== undefined &&
          it.price !== null &&
          String(it.price).trim() !== '' &&
          Number.isFinite(Number(it.price)) &&
          Number(it.price) >= 0
        const itemUnitPrice = hasExplicitItemPrice ? Math.max(0, Math.round(Number(it.price))) : -1
        const autoItemPrice = Math.max(0, itemUnitPrice)

        // Ưu tiên 1: Khớp chính xác theo shopeeModelId (khóa bất biến của phân loại trên Sàn)
        let matched =
          targetModelId && targetModelId !== '0'
            ? allProducts.find((p) => {
                if (!p.attributes) return false
                try {
                  const a = JSON.parse(p.attributes) as Record<string, unknown>
                  return String(a.shopeeModelId || '') === targetModelId
                } catch {
                  return false
                }
              })
            : undefined

        // Ưu tiên 2: Khớp theo mã SKU / modelSku (CHỈ khi có chuỗi SKU khác rỗng)
        if (!matched && (targetSku.length > 0 || rawItemSku.length > 0)) {
          matched = allProducts.find(
            (p) =>
              (targetSku.length > 0 && p.sku === targetSku) ||
              (rawItemSku.length > 0 && p.sku === rawItemSku)
          )
          if (!matched && targetSku.length > 0) {
            matched = allProducts.find((p) => {
              if (!p.attributes) return false
              try {
                const a = JSON.parse(p.attributes) as Record<string, unknown>
                return String(a.shopeeModelSku || '') === targetSku
              } catch {
                return false
              }
            })
          }
        }

        // Ưu tiên 3: Khớp theo shopeeItemId cho sản phẩm đơn (không chia phân loại hoặc duy nhất 1 SKU gắn Item ID)
        if (!matched && targetItemId && targetItemId !== '0' && (!targetModelId || targetModelId === '0')) {
          const byItemId = allProducts.filter((p) => {
            if (!p.attributes) return false
            try {
              const a = JSON.parse(p.attributes) as Record<string, unknown>
              return String(a.shopeeItemId || '') === targetItemId
            } catch {
              return false
            }
          })
          if (byItemId.length === 1) {
            matched = byItemId[0]
          }
        }

        // Ưu tiên 4 (Bảo vệ vận hành Live không gián đoạn): Nếu đơn Shopee Live phát sinh mã mới chưa kịp liên kết CMS
        // (có shopeeItemId hoặc tên sản phẩm thật từ Sàn), tự động tạo & liên kết Product tồn = 0 để đơn và phiếu in vẫn chạy thông suốt!
        if (!matched && d.autoCreateUnlinkedSku !== false && (targetItemId.length > 0 || rawItemName.length > 0)) {
          const existingSkuSet = new Set(allProducts.map((p) => p.sku.toUpperCase()))
          let autoSku =
            targetSku && !existingSkuSet.has(targetSku.toUpperCase())
              ? targetSku
              : `SP-LIVE-${targetModelId && targetModelId !== '0' ? targetModelId : targetItemId || Date.now().toString().slice(-8)}`
          if (existingSkuSet.has(autoSku.toUpperCase())) {
            autoSku = `${autoSku}-${Math.floor(100 + Math.random() * 900)}`
          }
          const autoName = rawItemName
            ? rawModelName && !rawItemName.includes(rawModelName)
              ? `${rawItemName} — ${rawModelName}`
              : rawItemName
            : `Sản phẩm Shopee Live (${autoSku})`
          const nowIso = new Date().toISOString()
          const autoAttrs = {
            shopeeItemId: targetItemId || '0',
            shopeeModelId: targetModelId || '0',
            shopeeModelSku: targetSku,
            shopeeModelName: rawModelName,
            linkMode: 'AUTO_CREATED_FROM_LIVE_ORDER',
            openingStockOrigin: 'CMS_WAREHOUSE',
            openingStockOriginLabel: 'Khởi tạo tự động tồn = 0 khi nhận đơn Shopee Live (chờ nhập kho & đối soát)',
            openingStockQty: 0,
            liveShopeeStock: 0,
            lastSyncedShopeeStock: 0,
            lastSyncedShopeePrice: autoItemPrice,
            reconciliationStatus: 'STOCK_DRIFT',
            autoCreatedFromOrderSn: orderSn,
            lastInboundSyncAt: nowIso,
          }
          const createdProd = await db.product.create({
            data: {
              sku: autoSku,
              name: autoName,
              categoryId: fallbackCat?.id ?? null,
              costPrice: 0,
              sellPrice: autoItemPrice,
              stock: 0,
              lowStockThreshold: 5,
              status: 'ACTIVE',
              type: 'SIMPLE',
              unit: 'bộ',
              fragile: false,
              ownerWarehouseId: defaultWh?.id ?? null,
              attributes: JSON.stringify(autoAttrs),
            },
          })
          if (defaultWh) {
            await db.warehouseStock
              .upsert({
                where: {
                  warehouseId_productId: { warehouseId: defaultWh.id, productId: createdProd.id },
                },
                update: { quantity: 0 },
                create: { warehouseId: defaultWh.id, productId: createdProd.id, quantity: 0 },
              })
              .catch(() => null)
          }
          await db.channelListing
            .upsert({
              where: {
                productId_channelId: { productId: createdProd.id, channelId: shopeeChannel.id },
              },
              update: { price: autoItemPrice, status: 'ACTIVE', description: autoName },
              create: {
                productId: createdProd.id,
                channelId: shopeeChannel.id,
                price: autoItemPrice,
                status: 'ACTIVE',
                description: autoName,
              },
            })
            .catch(() => null)

          allProducts.push(createdProd)
          matched = createdProd
          autoLinkedSkus.push(createdProd.sku)

          await logLedger({
            scope: 'CHANNEL',
            action: 'SHOPEE_ORDER_AUTO_LINKED_SKU',
            entityType: 'Product',
            entityId: createdProd.id,
            entityCode: createdProd.sku,
            title: `[BẢO VỆ LIVE KHÔNG GIÁN ĐOẠN] Tự động tạo & liên kết SKU [${createdProd.sku}] (tồn CMS = 0) cho đơn Shopee #${orderSn} — chờ đối soát sau`,
            detail: {
              shopeeOrderSn: orderSn,
              sku: createdProd.sku,
              name: createdProd.name,
              shopeeItemId: targetItemId,
              shopeeModelId: targetModelId,
              price: autoItemPrice,
            },
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        if (matched) {
          resolvedItems.push({
            productId: matched.id,
            quantity: qty,
            ...(itemUnitPrice >= 0 ? { priceOverride: itemUnitPrice } : {}),
          })
          if (itemUnitPrice >= 0 && !(matched.id in itemPriceOverrides)) {
            itemPriceOverrides[matched.id] = itemUnitPrice
          }
        }
      }

      if (resolvedItems.length === 0) {
        await logLedger({
          scope: 'CHANNEL',
          action: 'SHOPEE_ORDER_UNLINKED_SKU',
          entityType: 'Order',
          entityCode: orderSn,
          title: `[SÀN SHOPEE ➔ CMS] CẢNH BÁO: Đơn hàng #${orderSn} chứa sản phẩm chưa liên kết SKU trong CMS`,
          detail: { shopeeOrderSn: orderSn, items: d.items || [] },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        return NextResponse.json(
          {
            ok: false,
            action: 'QUEUED_UNLINKED_ORDER_SKU',
            error: `Đơn hàng Shopee #${orderSn} chứa sản phẩm chưa được liên kết với hàng hóa CMS`,
            shopeeOrderSn: orderSn,
          },
          { status: 422 },
        )
      }

      // Nếu đơn hàng đã bị hủy TRƯỚC KHI đồng bộ về CMS:
      // Tạo bản ghi đơn hàng trực tiếp với trạng thái CANCELLED mà KHÔNG gọi createOrder (tránh trừ kho sai & tránh lỗi thiếu tồn kho 422)
      if (nextStatus === 'CANCELLED') {
        const now = new Date()
        const code = `DH${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`

        let finalCustId: string | null = null
        const channelRef = d.buyerUsername ? `shopee:${d.buyerUsername.toLowerCase()}` : null
        if (channelRef) {
          const exCust = await db.customer.findFirst({
            where: { OR: [{ email: channelRef }, { inferredProfile: { contains: channelRef } }] },
            select: { id: true },
          })
          if (exCust) finalCustId = exCust.id
        }
        const rawP = d.customerPhone?.trim() || null
        const isMaskedP = isMaskedOrDummyPhone(rawP)
        if (!finalCustId && rawP && !isMaskedP) {
          const exByP = await db.customer.findFirst({ where: { phone: rawP }, select: { id: true } })
          if (exByP) finalCustId = exByP.id
        }
        if (!finalCustId) {
          const pMeta: Record<string, unknown> = {}
          if (channelRef) pMeta.channelRef = channelRef
          if (d.buyerUsername) pMeta.buyerUsername = d.buyerUsername
          if (isMaskedP && rawP) pMeta.maskedPhone = rawP
          const newCust = await db.customer.create({
            data: {
              name: d.customerName || (d.buyerUsername ? `Shopee @${d.buyerUsername}` : `Khách Shopee #${orderSn.slice(-6)}`),
              phone: isMaskedP ? null : rawP,
              email: channelRef || null,
              address: d.address || 'Shopee Delivery',
              inferredProfile: Object.keys(pMeta).length > 0 ? JSON.stringify(pMeta) : null,
            },
          })
          finalCustId = newCust.id
        }

        let subtotal = 0
        const orderItemsData: Array<{ productId: string; quantity: number; price: number }> = []
        for (const item of resolvedItems) {
          const prod = allProducts.find((p) => p.id === item.productId)
          const price = item.priceOverride ?? itemPriceOverrides[item.productId] ?? prod?.sellPrice ?? 0
          subtotal += price * item.quantity
          orderItemsData.push({
            productId: item.productId,
            quantity: item.quantity,
            price,
          })
        }
        const shippingFee = typeof d.shippingFee === 'number' ? d.shippingFee : 0
        const total = subtotal + shippingFee

        const cancelledOrder = await db.order.create({
          data: {
            code,
            channelId: shopeeChannel.id,
            customerId: finalCustId,
            warehouseId: defaultWh?.id ?? null,
            status: 'CANCELLED',
            paymentStatus: 'UNPAID',
            paymentMethod: d.paymentMethod || 'SHOPEE_WALLET',
            subtotal,
            shippingFee,
            total,
            note: `Shopee Order #${orderSn} (Đơn đã hủy trước khi đồng bộ)`,
            items: {
              create: orderItemsData,
            },
          },
        })

        await logEvent(
          cancelledOrder.id,
          'CANCELLED',
          'SYSTEM',
          `Shopee Inbound: Đơn hàng nhập khẩu đã hủy sẵn trên sàn (#${orderSn})`
        )
        broadcast('order.created', { id: cancelledOrder.id, code: cancelledOrder.code, status: 'CANCELLED' })

        await syncOrderShipment({
          order: cancelledOrder,
          trackingNumber: d.trackingNumber,
          shippingCarrier: d.shippingCarrier,
          shopeeOrderStatus: d.shopeeOrderStatus,
          orderSn,
        })

        return NextResponse.json({
          ok: true,
          action: 'ORDER_CREATED_ALREADY_CANCELLED',
          order: {
            id: cancelledOrder.id,
            code: cancelledOrder.code,
            status: cancelledOrder.status,
            total: cancelledOrder.total,
            shopeeOrderSn: orderSn,
          },
        })
      }

      // Đơn hàng mới từ Sàn Shopee: Cho phép tiếp nhận & in tự động ngay cả khi kho CMS = 0 (allowStockShortage: true),
      // ghi nhận đầy đủ cảnh báo lệch kho chờ đối soát để KHÔNG làm gián đoạn phiên Live!
      let created
      try {
        const channelRef = d.buyerUsername ? `shopee:${d.buyerUsername.toLowerCase()}` : undefined
        created = await createOrder({
          channelId: shopeeChannel.id,
          items: resolvedItems,
          customerName: d.customerName || (d.buyerUsername ? `Shopee @${d.buyerUsername}` : `Khách Shopee #${orderSn.slice(-6)}`),
          customerPhone: d.customerPhone || undefined,
          customerEmail: channelRef,
          buyerUsername: d.buyerUsername,
          channelCustomerRef: channelRef,
          address: d.address || 'Shopee Delivery',
          note: `Shopee Order #${orderSn}`,
          paymentMethod: d.paymentMethod || 'SHOPEE_WALLET',
          shippingFee: typeof d.shippingFee === 'number' ? d.shippingFee : 0,
          allowStockShortage: true,
          deferPosPrintEnqueue: true,
          itemPriceOverrides: Object.keys(itemPriceOverrides).length > 0 ? itemPriceOverrides : undefined,
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Lỗi không xác định khi tạo đơn Shopee'
        await logLedger({
          scope: 'CHANNEL',
          action: 'SHOPEE_ORDER_CREATE_ERROR',
          entityType: 'Order',
          entityCode: orderSn,
          title: `[SÀN SHOPEE ➔ CMS] LỖI TẠO ĐƠN #${orderSn}: ${errMsg}`,
          detail: { shopeeOrderSn: orderSn, error: errMsg, items: d.items || [] },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        return NextResponse.json(
          {
            ok: false,
            action: 'ORDER_CREATE_ERROR',
            error: errMsg,
            shopeeOrderSn: orderSn,
          },
          { status: 422 },
        )
      }

      const shortageWarnings = created.stockShortageWarnings || []
      const shortageNoteSuffix =
        shortageWarnings.length > 0
          ? ` [Chờ đối soát kho CMS: thiếu ${shortageWarnings.map((w) => `${w.sku} (-${w.shortage})`).join(', ')}]`
          : ''

      // Nếu đơn mới có trạng thái ban đầu khác PENDING (VD: CONFIRMED hoặc SHIPPING) hoặc có ghi chú lệch kho -> cập nhật 1 lần
      const initialStatus = mapShopeeStatusToCms(d.shopeeOrderStatus)
      let persistedOrder = created as {
        id: string
        code: string
        status: string
        paymentStatus: string
        paymentMethod: string
        shippingFee: number
        total: number
        note: string | null
      }
      if ((initialStatus !== 'PENDING' && created.status !== initialStatus) || shortageNoteSuffix) {
        persistedOrder = await db.order.update({
          where: { id: created.id },
          data: {
            status: initialStatus !== 'PENDING' ? initialStatus : created.status,
            paymentStatus: initialStatus === 'COMPLETED' ? 'PAID' : created.paymentStatus,
            ...(shortageNoteSuffix
              ? { note: `${created.note || `Shopee Order #${orderSn}`}${shortageNoteSuffix}` }
              : {}),
          },
        })
      }

      if (shortageWarnings.length > 0) {
        await logLedger({
          scope: 'INVENTORY',
          action: 'SHOPEE_ORDER_ACCEPTED_WITH_STOCK_SHORTAGE',
          entityType: 'Order',
          entityId: persistedOrder.id,
          entityCode: persistedOrder.code,
          title: `[NHẬN & IN ĐƠN LIVE KHI KHO CMS = 0] Đơn ${persistedOrder.code} (#${orderSn}): tiếp nhận không gián đoạn, ghi cảnh báo thiếu kho [${shortageWarnings.map((w) => `${w.sku}: thiếu ${w.shortage}`).join(', ')}] để đối soát sau`,
          detail: {
            shopeeOrderSn: orderSn,
            orderCode: persistedOrder.code,
            warnings: shortageWarnings,
            autoLinkedSkus,
          },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        await logEvent(
          persistedOrder.id,
          'STATUS_CHANGED',
          'SYSTEM',
          `Cảnh báo lệch kho khi nhận đơn Shopee #${orderSn}: thiếu ${shortageWarnings
            .map((w) => `${w.sku} (kho CMS có ${w.available}, đơn cần ${w.required} ${w.unit})`)
            .join(', ')} — Đã cho phép tiếp nhận & đẩy in tự động để không gián đoạn phiên Live, chờ đối soát nhập kho sau.`
        )
        invalidateApiCache('products')
        broadcast('channel.updated', {
          orderCode: persistedOrder.code,
          shopeeOrderSn: orderSn,
          stockShortageWarnings: shortageWarnings,
        })
      }

      // Khởi tạo / đồng bộ vận đơn TRƯỚC KHI đẩy vào hàng đợi in tự động của máy POS để phiếu in luôn có đủ Mã vận đơn & ĐVVC (SPX)!
      const syncedShip = await syncOrderShipment({
        order: persistedOrder,
        trackingNumber: d.trackingNumber,
        shippingCarrier: d.shippingCarrier,
        shopeeOrderStatus: d.shopeeOrderStatus,
        orderSn,
      })

      if (initialStatus === 'CONFIRMED' || initialStatus === 'SHIPPING') {
        enqueueShopeeOrderForLinkedPos({
          orderId: persistedOrder.id,
          orderCode: persistedOrder.code,
          shopeeOrderSn: orderSn,
          customerName: d.customerName ?? null,
          note: persistedOrder.note,
          total: persistedOrder.total,
          trackingCode: syncedShip?.trackingCode ?? d.trackingNumber ?? null,
          carrier: syncedShip?.carrier
            ? carrierName(syncedShip.carrier)
            : (d.shippingCarrier ?? 'SPX Express'),
          itemCount: resolvedItems.reduce((s, it) => s + it.quantity, 0),
          allowSynthetic: Boolean(d.allowSyntheticPrintQueue),
        })
      }

      return NextResponse.json({
        ok: true,
        action:
          shortageWarnings.length > 0
            ? 'ORDER_CREATED_WITH_STOCK_SHORTAGE_WARNING'
            : 'ORDER_CREATED',
        stockShortageWarnings: shortageWarnings,
        autoLinkedSkus: autoLinkedSkus.length > 0 ? autoLinkedSkus : undefined,
        order: {
          id: persistedOrder.id,
          code: persistedOrder.code,
          status: persistedOrder.status,
          total: persistedOrder.total,
          shopeeOrderSn: orderSn,
          trackingCode: syncedShip?.trackingCode ?? d.trackingNumber ?? null,
        },
      })
    }

    // ===== 13. OUTBOX_FETCH_PENDING: Worker kéo hàng đợi Outbox (CMS -> Sàn Shopee) bất đồng bộ =====
    if (event === 'OUTBOX_FETCH_PENDING') {
      const [allProducts, pendingLedgerEntries, inventoryPolicy] = await Promise.all([
        db.product.findMany({
          where: { status: { not: 'INACTIVE' } },
          include: { listings: { include: { channel: true } } },
        }),
        db.ledgerEntry.findMany({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
          },
          orderBy: { createdAt: 'asc' },
          take: 50,
        }),
        getInventorySyncPolicy(),
      ])

      const NON_PRICE_OUTBOX_REASONS = new Set([
        'SYNC_CMS_TO_MARKETPLACE_POLICY',
        'VIRTUAL_AUTO_REFILL',
        'APPLY_VIRTUAL_STOCK_TO_MARKETPLACE',
        'KEEP_WAREHOUSE_EMPTY_STOCK_ON_LINK',
        'MANUAL_PRODUCT_LINK_SYNC',
        'MANUAL_TOGGLE_VISIBILITY_FROM_CMS',
        'BULK_TOGGLE_VISIBILITY_FROM_CMS',
      ])
      const explicitByProductId = new Map<string, string>()
      const explicitPriceByProductId = new Set<string>()
      for (const le of pendingLedgerEntries) {
        if (!le.entityId) continue
        explicitByProductId.set(le.entityId, le.id)
        if (le.detail) {
          try {
            const det = JSON.parse(le.detail) as Record<string, unknown>
            const op = String(det.operation || '').trim().toUpperCase()
            const reason = String(det.reason || '').trim().toUpperCase()
            if (
              typeof det.targetPrice === 'number' &&
              det.targetPrice > 0 &&
              op !== 'TOGGLE_UNLIST' &&
              !NON_PRICE_OUTBOX_REASONS.has(reason)
            ) {
              explicitPriceByProductId.add(le.entityId)
            }
          } catch {
            // ignore malformed detail
          }
        }
      }

      const jobs: Array<{
        outboxId: string
        productId: string
        sku: string
        name: string
        shopeeItemId: string
        shopeeModelId: string
        locationId: string
        targetStock: number
        lastSyncedStock: number
        targetPrice: number
        lastSyncedPrice: number
        targetUnlisted: boolean
        lastSyncedUnlisted: boolean | null
        targetImage?: string
        stockDrifted: boolean
        priceDrifted: boolean
        unlistedDrifted: boolean
        imageDrifted: boolean
        idempotencyKey: string
      }> = []

      const outboxReq = (data ?? {}) as {
        includeSyntheticTest?: boolean
        onlySyntheticTest?: boolean
      }

      for (const p of allProducts) {
        const isSynth = isSyntheticSku(p.sku, PROTECTED_REAL_SKUS)
        if (outboxReq.onlySyntheticTest && !isSynth) continue
        if (!outboxReq.includeSyntheticTest && !outboxReq.onlySyntheticTest && isSynth) continue

        let attrs: Record<string, unknown> = {}
        if (p.attributes) {
          try {
            attrs = JSON.parse(p.attributes) as Record<string, unknown>
          } catch {
            attrs = {}
          }
        }
        const shopeeItemId = String(attrs.shopeeItemId || '').trim()
        const shopeeModelId = String(attrs.shopeeModelId || '').trim()

        const isMicroWebp = typeof p.image === 'string' && p.image.startsWith('data:image/')
        const hasPendingCdn = Boolean(attrs.pendingCdnOffload)
        const targetImage: string | undefined =
          typeof attrs.cmsTargetImage === 'string' && attrs.cmsTargetImage.trim()
            ? attrs.cmsTargetImage.trim()
            : isMicroWebp && p.image
              ? p.image
              : undefined

        // Nếu sản phẩm KHÔNG liên kết Shopee nhưng có ảnh Micro-WebP dự phòng cần offload lên Shopee Media CDN
        const isLinkedShopee = Boolean(shopeeItemId && shopeeItemId !== '0')
        if (!isLinkedShopee) {
          if (targetImage && (isMicroWebp || hasPendingCdn)) {
            const outboxId = explicitByProductId.get(p.id) || `IMAGE_OFFLOAD_${p.id}_${Date.now()}`
            jobs.push({
              outboxId,
              productId: p.id,
              sku: p.sku,
              name: p.name,
              shopeeItemId: '',
              shopeeModelId: '',
              locationId: 'VNZ',
              targetStock: Math.max(0, p.stock),
              lastSyncedStock: Math.max(0, p.stock),
              targetPrice: p.sellPrice,
              lastSyncedPrice: p.sellPrice,
              targetUnlisted: false,
              lastSyncedUnlisted: false,
              targetImage,
              stockDrifted: false,
              priceDrifted: false,
              unlistedDrifted: false,
              imageDrifted: true,
              idempotencyKey: `IMAGE_OFFLOAD_${p.id}_${p.sku}`,
            })
          }
          continue
        }

        // Nếu sản phẩm đang bị đánh dấu đứt liên kết mã trên Sàn (BROKEN_LINK) và chưa có lệnh đẩy lại tường minh -> tạm ngưng sinh job tự động để không lặp vô hạn
        if (Boolean(attrs.brokenMarketplaceLink) && !explicitByProductId.has(p.id)) {
          continue
        }

        const shopeeListing = p.listings.find((l) => l.channel.key === 'SHOPEE')
        const lastSyncedStock =
          typeof attrs.lastSyncedShopeeStock === 'number'
            ? attrs.lastSyncedShopeeStock
            : typeof attrs.liveShopeeStock === 'number'
              ? attrs.liveShopeeStock
              : -1
        const lastSyncedPrice =
          typeof attrs.lastSyncedShopeePrice === 'number' ? attrs.lastSyncedShopeePrice : -1
        const lastSyncedUnlisted =
          typeof attrs.lastSyncedShopeeUnlisted === 'boolean' ? attrs.lastSyncedShopeeUnlisted : null

        const hasExplicitOutbox = explicitByProductId.has(p.id) || Boolean(attrs.pendingOutboxSync)
        const targetPrice =
          typeof attrs.cmsTargetPrice === 'number'
            ? attrs.cmsTargetPrice
            : shopeeListing?.price ?? p.sellPrice
        const targetUnlisted =
          typeof attrs.cmsTargetUnlisted === 'boolean'
            ? attrs.cmsTargetUnlisted
            : Boolean(attrs.isUnlistedOnShopee)

        const stockRes = resolveMarketplaceTargetStock({
          policy: inventoryPolicy,
          cmsRealStock: p.stock,
          lastSyncedStock,
          cmsExplicitTargetStock:
            typeof attrs.cmsTargetStock === 'number' ? attrs.cmsTargetStock : undefined,
          cmsTargetStockOrigin:
            typeof attrs.cmsTargetStockOrigin === 'string' ? attrs.cmsTargetStockOrigin : undefined,
          mode1HoldBaselineStock:
            typeof attrs.mode1HoldBaselineStock === 'number'
              ? attrs.mode1HoldBaselineStock
              : undefined,
          hasExplicitOutbox,
          isUnlistedOnShopee: targetUnlisted,
        })
        const targetStock = stockRes.targetStock

        if (
          !hasExplicitOutbox &&
          typeof attrs.outboxSuppressedKey === 'string' &&
          attrs.outboxSuppressedKey === `${targetStock}_${targetPrice}_${targetUnlisted ? 1 : 0}`
        ) {
          continue
        }
        const stockDrifted = stockRes.stockDrifted
        // Chỉ sinh lệnh đẩy giá Outbox khi có chủ đích sửa/đẩy giá từ CMS (cmsTargetPrice tường minh hoặc OUTBOX_PENDING có chủ đích giá)
        const hasExplicitPriceIntent =
          typeof attrs.cmsTargetPrice === 'number' || explicitPriceByProductId.has(p.id)
        const priceDrifted =
          hasExplicitPriceIntent &&
          targetPrice > 0 &&
          (typeof attrs.cmsTargetPrice === 'number'
            ? lastSyncedPrice !== targetPrice
            : lastSyncedPrice > 0 && lastSyncedPrice !== targetPrice)
        const unlistedDrifted =
          typeof attrs.cmsTargetUnlisted === 'boolean' ||
          (lastSyncedUnlisted !== null && lastSyncedUnlisted !== targetUnlisted)
        const imageDrifted = Boolean(targetImage)
        const hasActionableExplicitMutation =
          hasExplicitOutbox &&
          (!stockRes.isMarketplaceStockProtected ||
            typeof attrs.cmsTargetPrice === 'number' ||
            typeof attrs.cmsTargetUnlisted === 'boolean' ||
            Boolean(targetImage))

        if (
          stockDrifted ||
          priceDrifted ||
          unlistedDrifted ||
          imageDrifted ||
          hasActionableExplicitMutation
        ) {
          const outboxId = explicitByProductId.get(p.id) || `AUTO_OUTBOX_${p.id}_${targetStock}_${targetPrice}_${targetUnlisted ? 1 : 0}`
          jobs.push({
            outboxId,
            productId: p.id,
            sku: p.sku,
            name: p.name,
            shopeeItemId,
            shopeeModelId: shopeeModelId || '0',
            locationId: 'VNZ',
            targetStock,
            lastSyncedStock,
            targetPrice,
            lastSyncedPrice,
            targetUnlisted,
            lastSyncedUnlisted,
            targetImage,
            stockDrifted,
            priceDrifted,
            unlistedDrifted,
            imageDrifted,
            idempotencyKey: `OUTBOX_${shopeeItemId}_${shopeeModelId || '0'}_S${targetStock}_P${targetPrice}_U${targetUnlisted ? 1 : 0}`,
          })
        }
      }

      return NextResponse.json({
        ok: true,
        pendingCount: jobs.length,
        jobs,
      })
    }

    // ===== 14. OUTBOX_ACK_RESULT: Worker xác nhận kết quả đẩy Outbox (CMS -> Sàn Shopee) =====
    if (event === 'OUTBOX_ACK_RESULT') {
      const d = (data ?? {}) as {
        outboxId?: string
        productId?: string
        sku?: string
        shopeeItemId?: string
        shopeeModelId?: string
        syncedStock?: number
        syncedPrice?: number
        syncedUnlisted?: boolean
        syncedImage?: string | null
        status?: 'COMPLETED' | 'RETRY' | 'DEAD_LETTER' | 'DEFERRED_SESSION_LOST' | 'BROKEN_LINK'
        error?: string
        attempt?: number
        idempotencyKey?: string
      }

      const product = d.productId
        ? await db.product.findUnique({
            where: { id: d.productId },
            include: { listings: { include: { channel: { select: { id: true, key: true } } } } },
          })
        : d.sku
          ? await db.product.findUnique({
              where: { sku: d.sku },
              include: { listings: { include: { channel: { select: { id: true, key: true } } } } },
            })
          : null

      if (!product) {
        return NextResponse.json({ error: 'Không tìm thấy sản phẩm để ACK Outbox' }, { status: 404 })
      }

      if (d.status === 'COMPLETED') {
        let attrs: Record<string, unknown> = {}
        try {
          attrs = product.attributes ? (JSON.parse(product.attributes) as Record<string, unknown>) : {}
        } catch {
          attrs = {}
        }
        const itemIdStr = String(d.shopeeItemId || attrs.shopeeItemId || '').trim()
        const isLinkedShopee = Boolean(itemIdStr && itemIdStr !== '0')
        const existingShopeeListing = product.listings.find((l) => l.channel.key === 'SHOPEE') ?? null
        const hasExplicitSyncedPrice =
          typeof d.syncedPrice === 'number' && Number.isFinite(d.syncedPrice) && d.syncedPrice > 0
        const preservedShopeePrice =
          typeof attrs.lastSyncedShopeePrice === 'number' && attrs.lastSyncedShopeePrice > 0
            ? attrs.lastSyncedShopeePrice
            : existingShopeeListing?.price ?? product.sellPrice

        const syncedStock =
          typeof d.syncedStock === 'number' ? Math.max(0, d.syncedStock) : Math.max(0, product.stock)
        const syncedPrice = hasExplicitSyncedPrice ? Number(d.syncedPrice) : preservedShopeePrice
        const syncedUnlisted =
          typeof d.syncedUnlisted === 'boolean'
            ? d.syncedUnlisted
            : Boolean(attrs.isUnlistedOnShopee)

        if (isLinkedShopee) {
          attrs.lastSyncedShopeeStock = syncedStock
          attrs.liveShopeeStock = syncedStock
          attrs.lastSyncedShopeePrice = syncedPrice
          attrs.lastSyncedShopeeUnlisted = syncedUnlisted
          attrs.isUnlistedOnShopee = syncedUnlisted
          attrs.cmsRequestedUnlisted = syncedUnlisted
        }
        attrs.pendingOutboxSync = false
        delete attrs.cmsTargetStock
        delete attrs.cmsTargetStockOrigin
        delete attrs.mode1HoldBaselineStock
        delete attrs.cmsTargetPrice
        delete attrs.cmsTargetUnlisted
        delete attrs.cmsTargetImage
        delete attrs.outboxState
        delete attrs.outboxError
        delete attrs.lastOutboxDeferredAt
        delete attrs.brokenMarketplaceLink
        delete attrs.brokenLinkReason
        delete attrs.brokenLinkDetectedAt
        delete attrs.outboxSuppressedKey
        const syncedImageUrl =
          typeof d.syncedImage === 'string' && /^https?:\/\//i.test(d.syncedImage.trim())
            ? d.syncedImage.trim()
            : null
        if (syncedImageUrl) {
          attrs.lastSyncedShopeeImage = syncedImageUrl
          attrs.pendingCdnOffload = false
        }
        attrs.lastOutboundSyncAt = new Date().toISOString()
        attrs.lastOutboundIdempotencyKey = d.idempotencyKey || `ACK_${Date.now()}`

        await db.product.update({
          where: { id: product.id },
          data: {
            ...(syncedImageUrl ? { image: syncedImageUrl } : {}),
            attributes: JSON.stringify(attrs),
          },
        })
        patchProductInApiCache(product.id, {
          ...(syncedImageUrl ? { image: syncedImageUrl } : {}),
          ...(isLinkedShopee ? { stock: product.stock, sellPrice: product.sellPrice } : {}),
          attributes: JSON.stringify(attrs),
        })
        invalidateApiCache('products')

        const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })

        // Nếu vừa đồng bộ trạng thái Ẩn/Hiện cấp Item ID, cập nhật luôn lastSyncedShopeeUnlisted & ChannelListing cho các phân loại cùng Item ID
        const targetListingStatus = syncedUnlisted ? 'UNLISTED' : 'ACTIVE'
        if (shopeeChannel && isLinkedShopee) {
          await db.channelListing.upsert({
            where: { productId_channelId: { productId: product.id, channelId: shopeeChannel.id } },
            update: {
              status: targetListingStatus,
              ...(hasExplicitSyncedPrice ? { price: syncedPrice } : {}),
            },
            create: { productId: product.id, channelId: shopeeChannel.id, status: targetListingStatus, price: syncedPrice },
          })
        }
        if (isLinkedShopee && typeof d.syncedUnlisted === 'boolean') {
          const siblings = await db.product.findMany({
            where: { id: { not: product.id }, status: { not: 'INACTIVE' } },
          })
          for (const sp of siblings) {
            if (!sp.attributes) continue
            try {
              const sa = JSON.parse(sp.attributes) as Record<string, unknown>
              if (String(sa.shopeeItemId || '').trim() === itemIdStr) {
                sa.lastSyncedShopeeUnlisted = syncedUnlisted
                sa.isUnlistedOnShopee = syncedUnlisted
                sa.cmsRequestedUnlisted = syncedUnlisted
                sa.pendingOutboxSync = false
                delete sa.cmsTargetUnlisted
                await db.product.update({
                  where: { id: sp.id },
                  data: { attributes: JSON.stringify(sa) },
                })
                if (shopeeChannel) {
                  await db.channelListing.upsert({
                    where: { productId_channelId: { productId: sp.id, channelId: shopeeChannel.id } },
                    update: { status: targetListingStatus },
                    create: { productId: sp.id, channelId: shopeeChannel.id, status: targetListingStatus, price: sp.sellPrice },
                  })
                }
              }
            } catch {
              // ignore
            }
          }
        }

        // Đánh dấu mọi LedgerEntry OUTBOX_PENDING của sản phẩm này thành OUTBOX_COMPLETED
        await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityId: product.id,
          },
          data: {
            action: 'OUTBOX_COMPLETED',
          },
        })

        if (shopeeChannel && isLinkedShopee) {
          await db.channel.update({
            where: { id: shopeeChannel.id },
            data: { connected: true, syncedAt: new Date() },
          })
        }

        const statusLabel = syncedUnlisted ? 'Tạm ẩn' : 'Đang bán'
        const titleText = isLinkedShopee
          ? `[CMS ➔ SÀN SHOPEE] Đồng bộ thành công: [${product.sku}] Tồn = ${syncedStock}, Giá = ${syncedPrice.toLocaleString('vi-VN')}đ, Trạng thái = ${statusLabel}`
          : `[CMS ➔ SHOPEE CDN] Giải phóng ảnh thành công: [${product.sku}] Lưu con trỏ CDN 0MB DB (${syncedImageUrl || 'Shopee Media CDN'})`
        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_SYNC_SUCCESS',
          entityType: 'Product',
          entityId: product.id,
          entityCode: product.sku,
          title: titleText,
          detail: {
            direction: isLinkedShopee ? 'CMS_TO_SHOPEE' : 'CMS_TO_SHOPEE_CDN',
            source: 'OPENVN_CMS',
            target: isLinkedShopee ? 'SHOPEE_SELLER_CENTER' : 'SHOPEE_MEDIA_CDN',
            status: 'COMPLETED',
            outboxId: d.outboxId,
            shopeeItemId: d.shopeeItemId,
            shopeeModelId: d.shopeeModelId,
            syncedStock: isLinkedShopee ? syncedStock : undefined,
            syncedPrice: isLinkedShopee ? syncedPrice : undefined,
            syncedUnlisted: isLinkedShopee ? syncedUnlisted : undefined,
            syncedImage: syncedImageUrl,
            idempotencyKey: d.idempotencyKey,
          },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })

        invalidateApiCache('channels:product-links')
        broadcast('outbox.updated', { productId: product.id, sku: product.sku, status: 'COMPLETED' })
        if (isLinkedShopee) {
          broadcast('inventory.updated', { productId: product.id, sku: product.sku, stockAfter: syncedStock })
        }
        if (syncedImageUrl) {
          broadcast('product.updated', { id: product.id, inPlacePatched: true })
        }
        return NextResponse.json({
          ok: true,
          status: 'COMPLETED',
          sku: product.sku,
          syncedStock,
          syncedPrice,
          syncedUnlisted,
          syncedImage: syncedImageUrl,
        })
      }

      let failAttrs: Record<string, unknown> = {}
      try {
        failAttrs = product.attributes ? (JSON.parse(product.attributes) as Record<string, unknown>) : {}
      } catch {
        failAttrs = {}
      }

      // Nếu bước đẩy Tồn kho đã thành công trên Shopee trước khi bước Giá gặp lỗi (VD: PRICE_LOCKED_PROMOTION do Flash Sale),
      // ghi nhận ngay tồn đã đồng bộ để không lệch lastSyncedShopeeStock!
      if (typeof d.syncedStock === 'number') {
        const ackedPartialStock = Math.max(0, d.syncedStock)
        failAttrs.lastSyncedShopeeStock = ackedPartialStock
        failAttrs.liveShopeeStock = ackedPartialStock
        delete failAttrs.cmsTargetStock
        delete failAttrs.cmsTargetStockOrigin
      }

      // Trường hợp mất phiên Cookie giữa chừng: Giữ nguyên trong OUTBOX_PENDING (WAITING_SESSION), KHÔNG đốt retry vào DLQ
      if (d.status === 'DEFERRED_SESSION_LOST') {
        failAttrs.pendingOutboxSync = true
        failAttrs.outboxState = 'WAITING_SESSION'
        failAttrs.lastOutboxDeferredAt = new Date().toISOString()
        failAttrs.outboxError = d.error
          ? String(d.error).slice(0, 300)
          : 'Phiên Cookie Shopee hết hạn — đang chờ nạp lại để tự động đồng bộ'

        await db.product.update({
          where: { id: product.id },
          data: { attributes: JSON.stringify(failAttrs) },
        })
        patchProductInApiCache(product.id, { attributes: JSON.stringify(failAttrs) })

        const existingPending = await db.ledgerEntry.count({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityId: product.id,
          },
        })
        if (existingPending === 0) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[HÀNG ĐỢI BẤT ĐỒNG BỘ] Tạm giữ đồng bộ [${product.sku}] chờ khôi phục phiên Cookie Shopee`,
            detail: {
              direction: 'CMS_TO_SHOPEE',
              status: 'WAITING_SESSION',
              sku: product.sku,
              shopeeItemId: d.shopeeItemId || failAttrs.shopeeItemId,
              shopeeModelId: d.shopeeModelId || failAttrs.shopeeModelId,
              targetStock: typeof failAttrs.cmsTargetStock === 'number' ? failAttrs.cmsTargetStock : product.stock,
              targetPrice: typeof failAttrs.cmsTargetPrice === 'number' ? failAttrs.cmsTargetPrice : product.sellPrice,
              error: d.error,
              idempotencyKey: d.idempotencyKey,
            },
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        invalidateApiCache('channels:product-links')
        broadcast('outbox.updated', {
          productId: product.id,
          sku: product.sku,
          status: 'WAITING_SESSION',
        })
        return NextResponse.json({
          ok: true,
          status: 'DEFERRED_SESSION_LOST',
          sku: product.sku,
        })
      }

      // Trường hợp đứt liên kết mã sản phẩm / phân loại trên Shopee (xóa phân loại hoặc đổi Model ID)
      if (d.status === 'BROKEN_LINK') {
        const reasonStr = d.error
          ? String(d.error).slice(0, 300)
          : 'Mã sản phẩm hoặc phân loại trên Sàn Shopee không còn tồn tại / lệch Model ID'
        failAttrs.pendingOutboxSync = false
        failAttrs.outboxState = 'BROKEN_LINK'
        failAttrs.brokenMarketplaceLink = true
        failAttrs.brokenLinkReason = reasonStr
        failAttrs.brokenLinkDetectedAt = new Date().toISOString()

        await db.product.update({
          where: { id: product.id },
          data: { attributes: JSON.stringify(failAttrs) },
        })
        patchProductInApiCache(product.id, { attributes: JSON.stringify(failAttrs) })

        await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityId: product.id,
          },
          data: {
            action: 'OUTBOX_BROKEN_LINK',
          },
        })

        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_BROKEN_LINK',
          entityType: 'Product',
          entityId: product.id,
          entityCode: product.sku,
          title: `[CẢNH BÁO ĐỨT LIÊN KẾT SÀN] Mã [${product.sku}] mất liên kết Item/Model trên Shopee (#${d.shopeeItemId || failAttrs.shopeeItemId || '?'})`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            status: 'BROKEN_LINK',
            outboxId: d.outboxId,
            shopeeItemId: d.shopeeItemId || failAttrs.shopeeItemId,
            shopeeModelId: d.shopeeModelId || failAttrs.shopeeModelId,
            error: reasonStr,
            idempotencyKey: d.idempotencyKey,
          },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })

        invalidateApiCache('channels:product-links')
        invalidateApiCache('products')
        broadcast('channel.link_lost', {
          productId: product.id,
          sku: product.sku,
          shopeeItemId: d.shopeeItemId || failAttrs.shopeeItemId,
          shopeeModelId: d.shopeeModelId || failAttrs.shopeeModelId,
          reason: reasonStr,
        })
        broadcast('outbox.updated', {
          productId: product.id,
          sku: product.sku,
          status: 'BROKEN_LINK',
        })
        return NextResponse.json({
          ok: true,
          status: 'BROKEN_LINK',
          sku: product.sku,
        })
      }

      // Trường hợp RETRY hoặc DEAD_LETTER (lỗi mạng tạm thời)
      const failAction = d.status === 'DEAD_LETTER' ? 'OUTBOX_DEAD_LETTER' : 'OUTBOX_RETRY'
      failAttrs.outboxState = d.status === 'DEAD_LETTER' ? 'DEAD_LETTER' : 'RETRYING'
      failAttrs.outboxError = d.error ? String(d.error).slice(0, 300) : undefined
      if (d.status === 'DEAD_LETTER') {
        failAttrs.pendingOutboxSync = false
        await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityId: product.id,
          },
          data: {
            action: 'OUTBOX_DEAD_LETTER',
          },
        })
      }
      await db.product.update({
        where: { id: product.id },
        data: { attributes: JSON.stringify(failAttrs) },
      })
      patchProductInApiCache(product.id, { attributes: JSON.stringify(failAttrs) })
      invalidateApiCache('channels:product-links')
      broadcast('outbox.updated', {
        productId: product.id,
        sku: product.sku,
        status: d.status,
      })

      await logLedger({
        scope: 'CHANNEL',
        action: failAction,
        entityType: 'Product',
        entityId: product.id,
        entityCode: product.sku,
        title: `[CMS ➔ SÀN SHOPEE] Đồng bộ lỗi (${failAction}): [${product.sku}] lần thử #${d.attempt || 1}`,
        detail: {
          direction: 'CMS_TO_SHOPEE',
          status: failAction,
          outboxId: d.outboxId,
          error: d.error,
          attempt: d.attempt,
          idempotencyKey: d.idempotencyKey,
        },
        actor: 'API',
        originSource: 'SHOPEE_SYNC',
      })

      return NextResponse.json({
        ok: true,
        status: d.status,
        sku: product.sku,
      })
    }

    // ===== 15. OUTBOX_ENQUEUE: Đưa yêu cầu đồng bộ tồn kho/giá từ CMS vào hàng đợi Outbox bất đồng bộ =====
    if (event === 'OUTBOX_ENQUEUE') {
      const d = (data ?? {}) as { sku?: string; productId?: string; all?: boolean; reason?: string }
      const targets = d.all
        ? await db.product.findMany({ where: { status: { not: 'INACTIVE' } } })
        : d.productId
          ? await db.product.findMany({ where: { id: d.productId } })
          : d.sku
            ? await db.product.findMany({ where: { sku: d.sku } })
            : []

      const enqueued: string[] = []
      for (const p of targets) {
        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_PENDING',
          entityType: 'Product',
          entityId: p.id,
          entityCode: p.sku,
          title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đẩy tồn kho [${p.sku}] (${p.stock}) từ CMS lên Shopee`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            source: 'OPENVN_CMS',
            target: 'SHOPEE_SELLER_CENTER',
            sku: p.sku,
            targetStock: p.stock,
            targetPrice: p.sellPrice,
            reason: d.reason || 'MANUAL_OR_POS_TRIGGER',
          },
          actor: 'SYSTEM',
          originSource: 'SHOPEE_SYNC',
        })
        enqueued.push(p.sku)
      }

      return NextResponse.json({
        ok: true,
        enqueuedCount: enqueued.length,
        enqueuedSkus: enqueued,
      })
    }

    // ===== 16. INBOUND_CLEAN_STALE_SKUS: Dọn dẹp các mã SKU cha/trùng lặp khi tách biến thể Shopee =====
    if (event === 'INBOUND_CLEAN_STALE_SKUS') {
      const d = (data ?? {}) as { skus?: string[] }
      const skus = Array.isArray(d.skus) ? d.skus : []
      const deleted: string[] = []
      const fallbackProd = await db.product.findFirst({
        where: { sku: { notIn: skus }, status: 'ACTIVE' },
      })
      for (const s of skus) {
        const prod = await db.product.findUnique({ where: { sku: s } })
        if (prod) {
          try {
            if (fallbackProd) {
              await db.orderItem.updateMany({
                where: { productId: prod.id },
                data: { productId: fallbackProd.id },
              })
              await db.salesInvoiceItem.updateMany({
                where: { productId: prod.id },
                data: { productId: fallbackProd.id },
              })
              await db.purchaseInvoiceItem.updateMany({
                where: { productId: prod.id },
                data: { productId: fallbackProd.id },
              })
            } else {
              await db.orderItem.deleteMany({ where: { productId: prod.id } })
              await db.salesInvoiceItem.deleteMany({ where: { productId: prod.id } })
              await db.purchaseInvoiceItem.deleteMany({ where: { productId: prod.id } })
            }
            await db.bomComponent.deleteMany({
              where: { OR: [{ productId: prod.id }, { componentProductId: prod.id }] },
            })
            await db.channelListing.deleteMany({ where: { productId: prod.id } })
            await db.warehouseStock.deleteMany({ where: { productId: prod.id } })
            await db.stockMovement.deleteMany({ where: { productId: prod.id } })
            await db.product.delete({ where: { id: prod.id } })
            deleted.push(s)
          } catch {
            await db.product.update({
              where: { id: prod.id },
              data: { status: 'INACTIVE', attributes: '{}' },
            })
            deleted.push(`${s}(INACTIVE)`)
          }
        }
      }
      return NextResponse.json({ ok: true, deleted })
    }

    // ===== 17. INBOUND_CLEAN_STALE_LOGS: Dọn dẹp các bản ghi log bị ghi đè sai / trùng lặp trong Sổ Cái =====
    if (event === 'INBOUND_CLEAN_STALE_LOGS') {
      const d = (data ?? {}) as { ids?: string[] }
      const ids = Array.isArray(d.ids) ? d.ids : []
      if (ids.length === 0) return NextResponse.json({ ok: true, deletedCount: 0 })
      const res = await db.ledgerEntry.deleteMany({ where: { id: { in: ids } } })
      return NextResponse.json({ ok: true, deletedCount: res.count })
    }

    // ===== 18. INBOUND_SHOPEE_SESSION_ALERT: Cảnh báo mất phiên / khôi phục phiên Cookie Shopee & tự động xếp lại hàng đợi =====
    if (event === 'INBOUND_SHOPEE_SESSION_ALERT') {
      const d = (data ?? {}) as {
        alertType?: 'SESSION_LOST' | 'SESSION_RESTORED'
        shopId?: string
        username?: string
        reason?: string
        deferredOutboxCount?: number
      }
      const alertType = d.alertType === 'SESSION_RESTORED' ? 'SESSION_RESTORED' : 'SESSION_LOST'
      const shopName = String(d.username || 'thaimy1605')
      const shopId = String(d.shopId || '197195817')

      let requeuedCount = 0
      if (alertType === 'SESSION_RESTORED') {
        const rq = await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: { in: ['OUTBOX_DEAD_LETTER', 'OUTBOX_DEFERRED'] },
          },
          data: {
            action: 'OUTBOX_PENDING',
          },
        })
        requeuedCount = rq.count
      } else {
        await markVaultSessionExpiredInMeta(d.reason || 'Phiên Cookie Shopee đã hết hạn')
      }

      await logLedger({
        scope: 'CHANNEL',
        action: alertType === 'SESSION_RESTORED' ? 'SHOPEE_SESSION_RESTORED' : 'SHOPEE_SESSION_LOST',
        entityType: 'Channel',
        entityCode: 'SHOPEE',
        title:
          alertType === 'SESSION_RESTORED'
            ? `[KHÔI PHỤC LIÊN KẾT] Shopee (${shopName} · #${shopId}) đã kết nối lại${requeuedCount > 0 ? ` — Tự động xếp lại ${requeuedCount} tác vụ vào hàng đợi` : ''}`
            : `[CẢNH BÁO MẤT LIÊN KẾT] Phiên Cookie Shopee (${shopName} · #${shopId}) hết hạn — Kích hoạt Hàng đợi Bất đồng bộ an toàn`,
        detail: {
          alertType,
          shopId,
          username: shopName,
          reason: d.reason || null,
          deferredOutboxCount: d.deferredOutboxCount ?? 0,
          requeuedCount,
        },
        actor: 'SYSTEM',
        originSource: 'SHOPEE_SYNC',
      })

      invalidateApiCache('channels:product-links')
      if (alertType === 'SESSION_LOST') {
        broadcast('channel.session_lost', {
          key: 'SHOPEE',
          shopId,
          username: shopName,
          reason: d.reason || 'Phiên Cookie Kênh Người Bán Shopee đã hết hạn.',
          deferredOutboxCount: d.deferredOutboxCount ?? 0,
        })
      } else {
        broadcast('channel.session_restored', {
          key: 'SHOPEE',
          shopId,
          username: shopName,
          requeuedCount,
        })
        broadcast('channel.updated', {
          key: 'SHOPEE',
          sessionUpdated: true,
          verifiedLive: true,
        })
      }

      return NextResponse.json({
        ok: true,
        alertType,
        requeuedCount,
      })
    }

    // ===== 19. INBOUND_SHOPEE_CATALOG_RECONCILE: Phát hiện chủ động sản phẩm gốc (Item ID) đã bị xóa trên Kênh Người Bán Shopee =====
    if (event === 'INBOUND_SHOPEE_CATALOG_RECONCILE') {
      const d = (data ?? {}) as {
        deletedShopeeItemIds?: Array<string | number>
        fullCatalogItemIds?: Array<string | number>
        activeCount?: number
        shopId?: string | number
        shopUsername?: string
      }
      const deletedSet = new Set(
        (Array.isArray(d.deletedShopeeItemIds) ? d.deletedShopeeItemIds : [])
          .map((id) => String(id ?? '').trim())
          .filter(Boolean)
      )
      const fullCatalogSet =
        Array.isArray(d.fullCatalogItemIds) && d.fullCatalogItemIds.length > 0
          ? new Set(d.fullCatalogItemIds.map((id) => String(id ?? '').trim()).filter(Boolean))
          : null
      const targetShopId = String(d.shopId ?? '').trim()

      if (deletedSet.size === 0 && !fullCatalogSet) {
        return NextResponse.json({ ok: true, brokenCount: 0, brokenSkus: [] })
      }

      const activeTestSnapshot = await db.appSetting
        .findUnique({ where: { key: 'beta_test_snapshot_v1' } })
        .catch(() => null)
      const isTestGuardActive = Boolean(activeTestSnapshot) || process.env.TEST_GUARD_ACTIVE === '1'

      const candidateProducts = await db.product.findMany({
        where: { status: { not: 'INACTIVE' } },
        select: { id: true, sku: true, name: true, attributes: true },
      })

      // Chốt an toàn chống xóa nhầm hàng loạt: chỉ đối chiếu vắng mặt trên fullCatalogSet khi cùng shopId
      // và danh mục trả về có giao thoa thực tế (>= 1 Item ID đang liên kết thuộc cùng shopId)
      let matchingCatalogOverlap = 0
      if (fullCatalogSet) {
        for (const cp of candidateProducts) {
          if (!cp.attributes) continue
          try {
            const ca = JSON.parse(cp.attributes) as Record<string, unknown>
            const cItem = String(ca.shopeeItemId || '').trim()
            const cShop = String(ca.shopId || '').trim()
            if (cItem && fullCatalogSet.has(cItem) && (!targetShopId || !cShop || cShop === targetShopId)) {
              matchingCatalogOverlap += 1
            }
          } catch {
            // ignore
          }
        }
      }

      const brokenSkus: string[] = []
      for (const prod of candidateProducts) {
        const isProtectedReal = PROTECTED_REAL_SKUS.has(prod.sku?.toUpperCase()?.trim())
        if (isTestGuardActive && isProtectedReal) {
          continue
        }
        let attrs: Record<string, unknown> = {}
        try {
          attrs = prod.attributes ? (JSON.parse(prod.attributes) as Record<string, unknown>) : {}
        } catch {
          continue
        }
        const linkedItemId = String(attrs.shopeeItemId || '').trim()
        if (!linkedItemId || linkedItemId === '0') continue
        if (attrs.brokenMarketplaceLink === true) continue

        const prodShopId = String(attrs.shopId || '').trim()
        const isExplicitlyDeleted = deletedSet.has(linkedItemId)
        let isMissingFromFullScan = false
        if (!isExplicitlyDeleted && fullCatalogSet && matchingCatalogOverlap > 0 && !fullCatalogSet.has(linkedItemId)) {
          const sameShop = targetShopId
            ? prodShopId === targetShopId || (!prodShopId && targetShopId === '197195817' && !isSyntheticSku(prod.sku, PROTECTED_REAL_SKUS) && !prod.sku.toUpperCase().startsWith('SYNTH-'))
            : false
          if (sameShop) {
            isMissingFromFullScan = true
          }
        }

        if (!isExplicitlyDeleted && !isMissingFromFullScan) continue

        const reasonStr = `Sản phẩm gốc (Item #${linkedItemId}) không còn tồn tại trong danh mục đang hoạt động trên Kênh Người Bán Shopee`
        attrs.pendingOutboxSync = false
        attrs.outboxState = 'BROKEN_LINK'
        attrs.brokenMarketplaceLink = true
        attrs.brokenLinkReason = reasonStr
        attrs.brokenLinkDetectedAt = new Date().toISOString()

        await db.product.update({
          where: { id: prod.id },
          data: { attributes: JSON.stringify(attrs) },
        })
        await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityId: prod.id,
          },
          data: { action: 'OUTBOX_BROKEN_LINK' },
        })
        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_BROKEN_LINK',
          entityType: 'Product',
          entityId: prod.id,
          entityCode: prod.sku,
          title: `[CẢNH BÁO XÓA SẢN PHẨM SÀN] Mã [${prod.sku}] mất Item gốc #${linkedItemId} trên Shopee`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            status: 'BROKEN_LINK',
            sku: prod.sku,
            shopeeItemId: linkedItemId,
            shopeeModelId: attrs.shopeeModelId,
            error: reasonStr,
          },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        broadcast('channel.link_lost', {
          productId: prod.id,
          sku: prod.sku,
          shopeeItemId: linkedItemId,
          shopeeModelId: attrs.shopeeModelId,
          reason: reasonStr,
        })
        brokenSkus.push(prod.sku)
      }

      if (brokenSkus.length > 0) {
        invalidateApiCache('products')
        invalidateApiCache('channels')
      }

      return NextResponse.json({
        ok: true,
        brokenCount: brokenSkus.length,
        brokenSkus,
      })
    }

    // ===== 20. OUTBOX_VAULT_PULL_AND_LEASE: Đồng bộ Kho Phiên Mã Hóa AES-256-GCM & Khóa chống xung đột Leader Lease (LOCAL_VN vs CLOUD_RENDER) =====
    if (event === 'OUTBOX_VAULT_PULL_AND_LEASE') {
      if (!isTrustedInternalDaemon) {
        return NextResponse.json(
          { error: 'Truy cập Kho Phiên Mã Hóa nội bộ bị từ chối đối với kết nối không tin cậy.' },
          { status: 403, headers: WEBHOOK_CORS_HEADERS }
        )
      }

      const d = (data ?? {}) as {
        nodeId?: string
        nodeRole?: ShopeeNodeRole
        hostname?: string
        action?: 'ACQUIRE_OR_RENEW' | 'RELEASE' | 'PEEK'
        ttlMs?: number
        expectedShopId?: string
      }
      const nodeId = String(d.nodeId || '').trim()
      if (!nodeId) {
        return NextResponse.json(
          { error: 'Thiếu nodeId khi đồng bộ Leader Lease' },
          { status: 400, headers: WEBHOOK_CORS_HEADERS }
        )
      }
      const nodeRole: ShopeeNodeRole =
        d.nodeRole === 'CLOUD_RENDER' ? 'CLOUD_RENDER' : 'LOCAL_VN'
      const action =
        d.action === 'RELEASE' || d.action === 'PEEK' ? d.action : 'ACQUIRE_OR_RENEW'

      const leaseOutcome = await acquireOrRenewShopeeLeaderLease({
        nodeId,
        nodeRole,
        hostname: d.hostname,
        action,
        ttlMs: d.ttlMs,
      })

      const decryptedSession =
        action !== 'RELEASE'
          ? await readDecryptedShopeeSessionFromVault(d.expectedShopId)
          : null

      return NextResponse.json({
        ok: true,
        leaseGranted: leaseOutcome.leaseGranted,
        preemptedCloud: leaseOutcome.preemptedCloud,
        yieldedToLocal: leaseOutcome.yieldedToLocal,
        lease: leaseOutcome.lease,
        vault: decryptedSession
          ? {
              hasSession: true,
              verifiedLive: decryptedSession.verifiedLive,
              version: decryptedSession.version,
              updatedAt: decryptedSession.updatedAt,
              updatedAtMs: decryptedSession.updatedAtMs,
              source: decryptedSession.source,
              shopId: decryptedSession.shopId,
              username: decryptedSession.username,
              cookies: decryptedSession.cookies,
              spc_cds: decryptedSession.spcCds,
              csrf_token: decryptedSession.csrfToken,
            }
          : { hasSession: false },
      })
    }

    return NextResponse.json({ error: `Sự kiện «${event}» không được hỗ trợ` }, { status: 400 })
  } catch (error) {
    console.error('Inbound webhook error:', error)
    return NextResponse.json({ error: 'Không thể xử lý webhook inbound' }, { status: 500 })
  }
}
