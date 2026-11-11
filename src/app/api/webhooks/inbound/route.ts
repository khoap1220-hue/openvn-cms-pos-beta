import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchWebhook, verifyInboundWebhook } from '@/lib/webhook-service'
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

// POST /api/webhooks/inbound — nhận webhook từ hệ thống ngoài (ký HMAC X-Signature hoặc Authorization: Apikey cho SePay)
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const verified = await verifyInboundWebhook(
      rawBody,
      req.headers.get('x-signature'),
      req.headers.get('authorization')
    )
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 401 })
    }

    const event = verified.payload.event
    const data = verified.payload.data

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

    // ===== 10. SHOPEE_SESSION_UPDATE: Cập nhật Cookie phiên Kênh Người Bán Shopee (từ Chrome Extension hoặc CDP) =====
    if (event === 'INBOUND_SHOPEE_SESSION_UPDATE') {
      const d = (data ?? {}) as {
        cookies?: Record<string, string>
        spc_cds?: string
        csrf_token?: string
      }
      if (!d.cookies || typeof d.cookies !== 'object') {
        return NextResponse.json({ error: 'Dữ liệu cookies không hợp lệ' }, { status: 400 })
      }

      const spc_cds = d.spc_cds || d.cookies['SPC_CDS'] || '78068754-dc8b-492a-8882-736c29a39ad4'
      const csrf_token = d.csrf_token || d.cookies['csrftoken'] || 'h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz'

      // Lưu ra file .shopee_session.json để Worker chạy Python đọc ngay lập tức
      const fs = await import('fs')
      const path = await import('path')
      const sessionPath = path.resolve(process.cwd(), 'scripts', '.shopee_session.json')
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            cookies: d.cookies,
            spc_cds,
            csrf_token,
            updated_at: new Date().toISOString(),
            source: 'CHROME_EXTENSION_AUTO_SYNC',
          },
          null,
          2,
        ),
        'utf-8',
      )

      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_RECEIVED',
        entityType: 'Integration',
        title: `Shopee: Tự động cập nhật phiên đăng nhập Kênh Người Bán (${Object.keys(d.cookies).length} cookies)`,
        detail: {
          spc_cds,
          has_spc_st: Boolean(d.cookies['SPC_ST']),
          has_spc_sc_session: Boolean(d.cookies['SPC_SC_SESSION']),
          source: 'CHROME_EXTENSION',
        },
        actor: 'API',
        originSource: 'MARKETPLACE_SYNC',
      })

      return NextResponse.json({
        ok: true,
        message: 'Shopee session updated successfully',
        cookieCount: Object.keys(d.cookies).length,
      })
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
        costPrice?: number
        stock?: number
        image?: string
        images?: string[]
        isUnlisted?: boolean
        shopId?: string | number
        shopUsername?: string
        autoCreate?: boolean
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
      const [primaryCategory, fallbackCategory, defaultWh, allActiveProducts, channels, pendingOutboxRows] = await Promise.all([
        db.category.findFirst({ where: { slug: 'an-nhien-thach-thach-cao' } }),
        db.category.findFirst(),
        db.warehouse.findFirst({ where: { isDefault: true } }),
        db.product.findMany({ where: { status: { not: 'INACTIVE' } } }),
        db.channel.findMany({ where: { key: { in: ['SHOPEE', 'FACEBOOK', 'POS'] } } }),
        db.ledgerEntry.findMany({
          where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING' },
          select: { entityId: true, detail: true },
        }),
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

        const hasIncomingPrice =
          d.sellPrice !== undefined && d.sellPrice !== null && String(d.sellPrice).trim() !== '' && Number(d.sellPrice) > 0
        const hasIncomingStock =
          d.stock !== undefined && d.stock !== null && String(d.stock).trim() !== '' && Number.isFinite(Number(d.stock))
        const incomingModifyTime = Number(d.shopeeModifyTime) || Math.floor(Date.now() / 1000)

        // Tầng 1: Tìm sản phẩm CMS đã được liên kết sẵn theo (shopeeItemId, shopeeModelId)
        let existing = allActiveProducts.find((p) => {
          if (!p.attributes) return false
          try {
            const a = JSON.parse(p.attributes) as Record<string, unknown>
            if (shopeeModelIdStr && String(a.shopeeModelId || '') === shopeeModelIdStr) return true
            if (!shopeeModelIdStr && shopeeItemIdStr && String(a.shopeeItemId || '') === shopeeItemIdStr) return true
            return false
          } catch {
            return false
          }
        })

        // Tầng 2: Nếu chưa có liên kết theo Model ID, tìm sản phẩm CMS có cùng mã SKU
        // Hỗ trợ Auto-Heal Model ID: nếu cùng shopeeItemId và trùng khớp SKU hoàn toàn (do Sàn Shopee vừa đổi model_id khi sửa phân loại), tự động hàn gắn sang Model ID mới!
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
              if (linkedItem && linkedItem !== shopeeItemIdStr) return false
              if (linkedModel && shopeeModelIdStr && linkedModel !== shopeeModelIdStr) {
                // Nếu cùng shopeeItemId và trùng SKU 100%, cho phép Auto-Heal Model ID mới
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

        const prevSyncedStock =
          typeof prevAttrs.lastSyncedShopeeStock === 'number'
            ? prevAttrs.lastSyncedShopeeStock
            : existing?.stock ?? incomingStock
        const prevSyncedPrice =
          typeof prevAttrs.lastSyncedShopeePrice === 'number'
            ? prevAttrs.lastSyncedShopeePrice
            : existing?.sellPrice ?? sellPrice
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

        // Nếu giá trên sàn KHÔNG thay đổi so với lần đồng bộ trước (!shopeePriceChanged), giữ nguyên giá hiện tại của CMS
        const effectivePrice = existing && !shopeePriceChanged ? existing.sellPrice : sellPrice

        let resolvedStock = incomingStock
        let conflictDetected = false
        let enqueueOutboxCorrection = false
        let awaitingOrderReconciliation = false
        let awaitingOpeningChoice = false
        const forceAdoptOpeningStock = Boolean((d as Record<string, unknown>).forceAdoptOpeningStock)

        const prevOpeningOrigin = String(
          prevAttrs.openingStockOrigin || (prevAttrs.shopeeItemId ? 'SHOPEE_MARKETPLACE' : 'CMS_WAREHOUSE')
        )
        const prevOpeningLabel = String(
          prevAttrs.openingStockOriginLabel ||
            (prevOpeningOrigin === 'SHOPEE_MARKETPLACE'
              ? `Gốc tồn đầu từ Sàn Shopee (${d.shopUsername || prevAttrs.shopUsername || 'thaimy1605'})`
              : 'Gốc tồn đầu tại Kho CMS (KHO-TRUNG-TAM)')
        )
        const prevOpeningQty =
          typeof prevAttrs.openingStockQty === 'number'
            ? prevAttrs.openingStockQty
            : existing?.sku === 'BM-COMBO-SEN-01-TRANG'
              ? 16
              : existing
                ? existing.stock
                : incomingStock

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
          } else if (
            existing.stock === 0 &&
            incomingStock > 0 &&
            (shopeeStockChanged ||
              prevOpeningOrigin === 'CMS_WAREHOUSE' ||
              prevAttrs.reconciliationStatus === 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK')
          ) {
            // Kho trống = 0 (chưa nhập kho vật lý vào CMS) nhưng Sàn có tồn > 0: Giữ nguyên Kho CMS = 0 và KHÔNG tự đẩy 0 lên Sàn
            resolvedStock = 0
            enqueueOutboxCorrection = false
            awaitingOpeningChoice = shopeeStockChanged
            nextReconciliationStatus = 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
            unreconciledShopeeDelta = incomingStock
          } else if (!shopeeStockChanged && existing.stock !== incomingStock) {
            // Sàn không đổi tồn kho, chỉ có CMS vừa đổi tồn kho (ví dụ xuất đơn POS/sàn đã đối chiếu) -> giữ nguyên tồn kho CMS và đẩy Outbox lên sàn
            resolvedStock = existing.stock
            enqueueOutboxCorrection = true
            nextReconciliationStatus = 'RECONCILED_OK'
            unreconciledShopeeDelta = 0
          } else if (shopeeStockChanged && incomingStock < existing.stock) {
            // Từ sau khi chốt tồn đầu kỳ: Khi Sàn giảm tồn (Sàn bán hàng), KHÔNG tự ý ghi đè trừ tồn mù quáng từ Product Sync
            // Bắt buộc giữ nguyên tồn CMS và chờ/kích hoạt đồng bộ Đơn hàng từ Sàn về CMS (INBOUND_SHOPEE_ORDER_SYNC) để đối chiếu và trừ tồn chính xác
            resolvedStock = existing.stock
            awaitingOrderReconciliation = true
            conflictDetected = true
            nextReconciliationStatus = 'PENDING_SHOPEE_ORDER'
            unreconciledShopeeDelta = incomingStock - existing.stock
          } else if (shopeeStockChanged && incomingStock > existing.stock) {
            // Sàn tăng tồn trực tiếp trên Shopee so với tồn kho CMS đã chốt -> Giữ tồn CMS và cảnh báo lệch tồn để người vận hành chọn lấy tồn Sàn hoặc đẩy tồn Kho
            resolvedStock = existing.stock
            conflictDetected = true
            nextReconciliationStatus = existing.stock === 0 ? 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK' : 'STOCK_DRIFT'
            unreconciledShopeeDelta = incomingStock - existing.stock
          } else {
            resolvedStock = existing.stock
            nextReconciliationStatus = 'RECONCILED_OK'
            unreconciledShopeeDelta = 0
          }
        } else {
          nextReconciliationStatus = 'RECONCILED_OK'
          unreconciledShopeeDelta = 0
        }

        const incomingModelName = String(d.modelName || d.attributes?.modelName || '').trim()
        const incomingParentSku = String(d.parentSku || d.attributes?.parentSku || '').trim()
        const incomingWeightGram = String(d.attributes?.weightGram || prevAttrs.weightGram || '').trim()

        const isSameData =
          existing &&
          existing.name === name &&
          existing.image === (d.image || existing.image) &&
          (existing.description || '').trim() === (d.description || existing.description || '').trim() &&
          !unlistedChanged &&
          !shopeeStockChanged &&
          existing.sellPrice === effectivePrice &&
          existing.stock === resolvedStock &&
          !enqueueOutboxCorrection &&
          Boolean(prevAttrs.openingStockOrigin) &&
          String(prevAttrs.shopeeModelId || '') === shopeeModelIdStr &&
          String(prevAttrs.shopeeItemId || '') === shopeeItemIdStr &&
          String(prevAttrs.shopeeModelName || '') === incomingModelName &&
          (!incomingParentSku || String(prevAttrs.parentSku || '') === incomingParentSku) &&
          (!incomingWeightGram || String(prevAttrs.weightGram || '') === incomingWeightGram) &&
          Number(prevAttrs.shopeeModifyTime || 0) === incomingModifyTime

        if (existing && isSameData) {
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
          openingStockOrigin: existing && !forceAdoptOpeningStock ? prevOpeningOrigin : 'SHOPEE_MARKETPLACE',
          openingStockOriginLabel:
            existing && !forceAdoptOpeningStock
              ? prevOpeningLabel
              : `Gốc tồn đầu từ Sàn Shopee (${d.shopUsername || prevAttrs.shopUsername || 'thaimy1605'} · Item #${d.shopeeItemId || ''})`,
          openingStockQty: existing && !forceAdoptOpeningStock ? prevOpeningQty : resolvedStock,
          openingStockLockedAt: String(prevAttrs.openingStockLockedAt || new Date().toISOString()),
          liveShopeeStock: incomingStock,
          unreconciledShopeeDelta,
          reconciliationStatus: nextReconciliationStatus,
          lastSyncedShopeeStock:
            enqueueOutboxCorrection || nextReconciliationStatus === 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
              ? incomingStock
              : resolvedStock,
          lastSyncedShopeePrice: effectivePrice,
          lastSyncedShopeeUnlisted: rawShopeeUnlisted,
          lastIdempotencyKey: d.idempotencyKey || `SYNC_${Date.now()}`,
          lastInboundSyncAt: new Date().toISOString(),
          shopId: String(d.shopId || prevAttrs.shopId || ''),
          shopUsername: d.shopUsername || prevAttrs.shopUsername || '',
          isUnlistedOnShopee: incomingIsUnlisted,
          gallery: d.images && d.images.length > 0 ? d.images : prevAttrs.gallery || [],
          lastSyncedShopeeImage: d.image || prevAttrs.lastSyncedShopeeImage || null,
          ...(d.attributes || {}),
        }
        // Bảo vệ ảnh tùy chỉnh trên CMS: nếu người dùng đã đổi ảnh trên CMS (cmsCustomImage = true),
        // chỉ cập nhật theo ảnh Shopee khi ảnh trên Shopee thực sự thay đổi so với lần đồng bộ trước.
        const shopeeImageChanged =
          Boolean(d.image) &&
          Boolean(prevAttrs.lastSyncedShopeeImage) &&
          d.image !== prevAttrs.lastSyncedShopeeImage
        const resolvedImage =
          existing && prevAttrs.cmsCustomImage === true && existing.image && !shopeeImageChanged
            ? existing.image
            : d.image || existing?.image || null
        if (shopeeImageChanged) {
          nextAttrsObj.cmsCustomImage = false
        }
        const attrJson = JSON.stringify(nextAttrsObj)

        const product = existing
          ? await db.product.update({
              where: { id: existing.id },
              data: {
                name,
                description: d.description || existing.description,
                sellPrice: effectivePrice,
                stock: resolvedStock,
                image: resolvedImage,
                attributes: attrJson,
                status: resolvedStock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
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
                status: resolvedStock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
                attributes: attrJson,
                unit: 'bộ',
                type: 'SIMPLE',
                fragile: true,
                ownerWarehouseId: defaultWh?.id ?? null,
              },
            })

        hasAnyRealMutation = true

        if (defaultWh && (!existing || existing.stock !== resolvedStock)) {
          await syncProductWarehouseStock(product.id, defaultWh.id)
        }

        await Promise.all(
          channels.map((ch) => {
            const listingStatus = ch.key === 'SHOPEE' ? (incomingIsUnlisted ? 'UNLISTED' : 'ACTIVE') : 'ACTIVE'
            return db.channelListing.upsert({
              where: {
                productId_channelId: {
                  productId: product.id,
                  channelId: ch.id,
                },
              },
              update: {
                price: effectivePrice,
                status: listingStatus,
                description: d.description || name,
                descriptionSyncedAt: new Date(),
              },
              create: {
                productId: product.id,
                channelId: ch.id,
                price: effectivePrice,
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

        if (enqueueOutboxCorrection) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đẩy tồn kho an toàn [${product.sku}] (${resolvedStock}) lên Shopee`,
            detail: {
              direction: 'CMS_TO_SHOPEE',
              source: 'OPENVN_CMS',
              target: 'SHOPEE_SELLER_CENTER',
              sku: product.sku,
              shopeeItemId: String(d.shopeeItemId || ''),
              shopeeModelId: String(d.shopeeModelId || ''),
              targetStock: resolvedStock,
              targetPrice: effectivePrice,
              targetUnlisted: incomingIsUnlisted,
              shopeeReportedStock: incomingStock,
              reason: 'ANTI_OVERSELL_CONFLICT_RESOLUTION',
            },
            actor: 'SYSTEM',
            originSource: 'SHOPEE_SYNC',
          })
        }

        // Ghi nhận biến động giá bán từ Shopee vào Sổ Data (chỉ khi giá sàn thực sự thay đổi so với lần đồng bộ trước)
        if (existing && existing.sellPrice !== effectivePrice && shopeePriceChanged) {
          const diffP = effectivePrice - existing.sellPrice
          const sign = diffP > 0 ? '+' : ''
          await logLedger({
            scope: 'CHANNEL',
            action: 'PRODUCT_PRICE_CHANGED',
            entityType: 'Product',
            entityId: product.id,
            entityCode: product.sku,
            title: `[SÀN SHOPEE ➔ CMS] Cập nhật giá bán [${product.sku}]: ${existing.sellPrice.toLocaleString('vi-VN')}đ ➔ ${effectivePrice.toLocaleString('vi-VN')}đ (${sign}${diffP.toLocaleString('vi-VN')}đ)`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              sku: product.sku,
              oldPrice: existing.sellPrice,
              newPrice: effectivePrice,
              diffPrice: diffP,
              shopeeItemId: d.shopeeItemId,
              shopeeModelId: d.shopeeModelId,
            },
            beforeSnapshot: { sellPrice: existing.sellPrice },
            afterSnapshot: { sellPrice: effectivePrice },
            changedFields: ['sellPrice'],
            actor: 'API',
            originSource: 'SHOPEE_SYNC',
          })
        }

        // Ghi nhận thay đổi trực tiếp trên Sàn (Sàn ➔ Sàn) + Đồng bộ từ Sàn về CMS (Sàn ➔ CMS)
        if (!existing || shopeeStockChanged || shopeePriceChanged || (unlistedChanged && shopeeUnlistedChanged)) {
          if (existing) {
            const shopeeChanges: string[] = []
            if (shopeeStockChanged) shopeeChanges.push(`Tồn Sàn: ${prevSyncedStock} ➔ ${incomingStock}`)
            if (shopeePriceChanged)
              shopeeChanges.push(
                `Giá Sàn: ${prevSyncedPrice.toLocaleString('vi-VN')}đ ➔ ${sellPrice.toLocaleString('vi-VN')}đ`
              )
            if (unlistedChanged && shopeeUnlistedChanged)
              shopeeChanges.push(
                `Hiển thị Sàn: ${prevSyncedUnlisted ? 'Đang ẩn' : 'Đang bán'} ➔ ${rawShopeeUnlisted ? 'Đang ẩn' : 'Đang bán'}`
              )
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
                  prevSyncedStock,
                  incomingStock,
                  prevSyncedPrice,
                  incomingPrice: sellPrice,
                  prevSyncedUnlisted,
                  incomingUnlisted: rawShopeeUnlisted,
                },
                beforeSnapshot: {
                  shopeeStock: prevSyncedStock,
                  shopeePrice: prevSyncedPrice,
                  isUnlisted: prevSyncedUnlisted,
                },
                afterSnapshot: {
                  shopeeStock: incomingStock,
                  shopeePrice: sellPrice,
                  isUnlisted: rawShopeeUnlisted,
                },
                changedFields: [
                  ...(shopeeStockChanged ? ['shopeeStock'] : []),
                  ...(shopeePriceChanged ? ['shopeePrice'] : []),
                  ...(unlistedChanged && shopeeUnlistedChanged ? ['isUnlisted'] : []),
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
            title: `[SÀN SHOPEE ➔ CMS] ${existing ? 'Cập nhật' : 'Tạo mới'} [${product.sku}] ${product.name.slice(0, 48)} (Tồn: ${resolvedStock}, Giá: ${effectivePrice.toLocaleString('vi-VN')}đ)`,
            detail: {
              direction: 'SHOPEE_TO_CMS',
              source: 'SHOPEE_SELLER_SYNC',
              target: 'OPENVN_CMS',
              idempotencyKey: d.idempotencyKey,
              shopeeItemId: d.shopeeItemId,
              shopeeModelId: d.shopeeModelId,
              sellPrice: effectivePrice,
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
          product: {
            id: product.id,
            sku: product.sku,
            name: product.name,
            sellPrice: product.sellPrice,
            stock: product.stock,
            shopeeItemId: nextAttrsObj.shopeeItemId,
            shopeeModelId: nextAttrsObj.shopeeModelId,
          },
        })
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
        broadcast('channel.unlinked_item', { count: results.filter((r) => r.action === 'QUEUED_FOR_PRODUCT_LINKING').length })
      }
      if (hasAnyRealMutation) {
        broadcast('inventory.updated', { batchCount: results.length })
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
        items?: Array<{
          sku?: string
          modelSku?: string
          shopeeModelId?: string | number
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

          // Thực thi hủy đơn và hoàn kho an toàn qua cancelOrder()
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

        // Chuyển trạng thái thông thường (CONFIRMED -> SHIPPING -> COMPLETED)
        if (existingOrder.status !== nextStatus) {
          const updated = await db.order.update({
            where: { id: existingOrder.id },
            data: {
              status: nextStatus,
              paymentStatus: nextStatus === 'COMPLETED' ? 'PAID' : existingOrder.paymentStatus,
            },
          })

          if (nextStatus === 'COMPLETED' && existingOrder.status !== 'COMPLETED') {
            awardPointsForCompletedOrder(existingOrder.id).catch(() => null)
          }

          await logEvent(
            existingOrder.id,
            'STATUS_CHANGED',
            'SYSTEM',
            `Shopee Async Sync: Đơn #${orderSn} chuyển trạng thái ${existingOrder.status} → ${nextStatus}`,
          )
          broadcast('order.updated', { id: updated.id, code: updated.code, status: updated.status })

          await syncOrderShipment({
            order: updated,
            trackingNumber: d.trackingNumber,
            shippingCarrier: d.shippingCarrier,
            shopeeOrderStatus: d.shopeeOrderStatus,
            orderSn,
          })

          return NextResponse.json({
            ok: true,
            action: 'STATUS_UPDATED',
            order: { id: updated.id, code: updated.code, status: updated.status, shopeeOrderSn: orderSn },
          })
        }

        // Trạng thái giữ nguyên -> cập nhật vận đơn (nếu có bổ sung tracking/carrier) và trả về SKIPPED_IDEMPOTENT
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

      const allProducts = await db.product.findMany()
      const resolvedItems: Array<{ productId: string; quantity: number }> = []
      for (const it of d.items || []) {
        const qty = Math.max(1, Number(it.quantity) || 1)
        const targetSku = String(it.modelSku || it.sku || '').trim()
        const targetModelId = String(it.shopeeModelId || '').trim()
        let matched = allProducts.find((p) => p.sku === targetSku || p.sku === String(it.sku || '').trim())
        if (!matched) {
          matched = allProducts.find((p) => {
            if (!p.attributes) return false
            try {
              const a = JSON.parse(p.attributes) as Record<string, unknown>
              return (
                (targetModelId && String(a.shopeeModelId || '') === targetModelId) ||
                (targetSku && String(a.shopeeModelSku || '') === targetSku)
              )
            } catch {
              return false
            }
          })
        }
        if (matched) {
          resolvedItems.push({ productId: matched.id, quantity: qty })
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
          const price = prod?.sellPrice ?? 0
          subtotal += price * item.quantity
          orderItemsData.push({
            productId: item.productId,
            quantity: item.quantity,
            price,
          })
        }
        const shippingFee = typeof d.shippingFee === 'number' ? d.shippingFee : 0
        const total = subtotal + shippingFee
        const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })

        const cancelledOrder = await db.order.create({
          data: {
            code,
            channelId: shopeeChannel.id,
            customerId: finalCustId,
            warehouseId: defaultWh?.id ?? null,
            status: 'CANCELLED',
            paymentStatus: 'UNPAID',
            paymentMethod: d.paymentMethod || 'SHOPEE_WALLET',
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

      // Đơn hàng mới thông thường: Tạo đơn qua createOrder (trừ kho, kiểm tra tồn, áp dụng BOM/Combo)
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
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Không đủ tồn kho để tạo đơn Shopee'
        await logLedger({
          scope: 'CHANNEL',
          action: 'SHOPEE_ORDER_STOCK_SHORTAGE',
          entityType: 'Order',
          entityCode: orderSn,
          title: `[SÀN SHOPEE ➔ CMS] CẢNH BÁO THIẾU TỒN KHO: Đơn Shopee #${orderSn} (${errMsg})`,
          detail: { shopeeOrderSn: orderSn, error: errMsg, items: d.items || [] },
          actor: 'API',
          originSource: 'SHOPEE_SYNC',
        })
        return NextResponse.json(
          {
            ok: false,
            action: 'ORDER_STOCK_SHORTAGE',
            error: errMsg,
            shopeeOrderSn: orderSn,
          },
          { status: 422 },
        )
      }

      // Nếu đơn mới có trạng thái ban đầu khác PENDING (VD: CONFIRMED hoặc SHIPPING) -> cập nhật trạng thái
      const initialStatus = mapShopeeStatusToCms(d.shopeeOrderStatus)
      if (initialStatus !== 'PENDING' && created.status !== initialStatus) {
        created = await db.order.update({
          where: { id: created.id },
          data: {
            status: initialStatus,
            paymentStatus: initialStatus === 'COMPLETED' ? 'PAID' : created.paymentStatus,
          },
        })
      }

      await syncOrderShipment({
        order: created,
        trackingNumber: d.trackingNumber,
        shippingCarrier: d.shippingCarrier,
        shopeeOrderStatus: d.shopeeOrderStatus,
        orderSn,
      })

      return NextResponse.json({
        ok: true,
        action: 'ORDER_CREATED',
        order: { id: created.id, code: created.code, status: created.status, total: created.total, shopeeOrderSn: orderSn },
      })
    }

    // ===== 13. OUTBOX_FETCH_PENDING: Worker kéo hàng đợi Outbox (CMS -> Sàn Shopee) bất đồng bộ =====
    if (event === 'OUTBOX_FETCH_PENDING') {
      const allProducts = await db.product.findMany({
        where: { status: { not: 'INACTIVE' } },
        include: { listings: { include: { channel: true } } },
      })
      const pendingLedgerEntries = await db.ledgerEntry.findMany({
        where: {
          scope: 'CHANNEL',
          action: 'OUTBOX_PENDING',
        },
        orderBy: { createdAt: 'asc' },
        take: 50,
      })

      const explicitByProductId = new Map<string, string>()
      for (const le of pendingLedgerEntries) {
        if (le.entityId) explicitByProductId.set(le.entityId, le.id)
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

      for (const p of allProducts) {
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
              targetStock: p.stock,
              lastSyncedStock: p.stock,
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

        const shopeeListing = p.listings.find((l) => l.channel.key === 'SHOPEE')
        const targetStock =
          typeof attrs.cmsTargetStock === 'number' ? attrs.cmsTargetStock : p.stock
        const targetPrice =
          typeof attrs.cmsTargetPrice === 'number'
            ? attrs.cmsTargetPrice
            : shopeeListing?.price ?? p.sellPrice
        const targetUnlisted =
          typeof attrs.cmsTargetUnlisted === 'boolean'
            ? attrs.cmsTargetUnlisted
            : Boolean(attrs.isUnlistedOnShopee)

        const lastSyncedStock =
          typeof attrs.lastSyncedShopeeStock === 'number' ? attrs.lastSyncedShopeeStock : -1
        const lastSyncedPrice =
          typeof attrs.lastSyncedShopeePrice === 'number' ? attrs.lastSyncedShopeePrice : -1
        const lastSyncedUnlisted =
          typeof attrs.lastSyncedShopeeUnlisted === 'boolean' ? attrs.lastSyncedShopeeUnlisted : null

        const hasExplicitOutbox = explicitByProductId.has(p.id) || Boolean(attrs.pendingOutboxSync)
        const stockDrifted = lastSyncedStock !== targetStock
        const priceDrifted = lastSyncedPrice > 0 && lastSyncedPrice !== targetPrice
        const unlistedDrifted =
          typeof attrs.cmsTargetUnlisted === 'boolean' ||
          (lastSyncedUnlisted !== null && lastSyncedUnlisted !== targetUnlisted)
        const imageDrifted = Boolean(targetImage)

        if (stockDrifted || priceDrifted || unlistedDrifted || imageDrifted || hasExplicitOutbox) {
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
        status?: 'COMPLETED' | 'RETRY' | 'DEAD_LETTER'
        error?: string
        attempt?: number
        idempotencyKey?: string
      }

      const product = d.productId
        ? await db.product.findUnique({ where: { id: d.productId } })
        : d.sku
          ? await db.product.findUnique({ where: { sku: d.sku } })
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

        const syncedStock = typeof d.syncedStock === 'number' ? d.syncedStock : product.stock
        const syncedPrice = typeof d.syncedPrice === 'number' ? d.syncedPrice : product.sellPrice
        const syncedUnlisted =
          typeof d.syncedUnlisted === 'boolean'
            ? d.syncedUnlisted
            : Boolean(attrs.isUnlistedOnShopee)

        if (isLinkedShopee) {
          attrs.lastSyncedShopeeStock = syncedStock
          attrs.lastSyncedShopeePrice = syncedPrice
          attrs.lastSyncedShopeeUnlisted = syncedUnlisted
          attrs.isUnlistedOnShopee = syncedUnlisted
          attrs.cmsRequestedUnlisted = syncedUnlisted
        }
        attrs.pendingOutboxSync = false
        delete attrs.cmsTargetStock
        delete attrs.cmsTargetPrice
        delete attrs.cmsTargetUnlisted
        delete attrs.cmsTargetImage
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
          ...(isLinkedShopee ? { stock: syncedStock, sellPrice: syncedPrice } : {}),
          attributes: JSON.stringify(attrs),
        })
        invalidateApiCache('products')

        const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })

        // Nếu vừa đồng bộ trạng thái Ẩn/Hiện cấp Item ID, cập nhật luôn lastSyncedShopeeUnlisted & ChannelListing cho các phân loại cùng Item ID
        const targetListingStatus = syncedUnlisted ? 'UNLISTED' : 'ACTIVE'
        if (shopeeChannel && isLinkedShopee) {
          await db.channelListing.upsert({
            where: { productId_channelId: { productId: product.id, channelId: shopeeChannel.id } },
            update: { status: targetListingStatus, price: syncedPrice },
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

      // Trường hợp RETRY hoặc DEAD_LETTER
      const failAction = d.status === 'DEAD_LETTER' ? 'OUTBOX_DEAD_LETTER' : 'OUTBOX_RETRY'
      if (d.status === 'DEAD_LETTER') {
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

    return NextResponse.json({ error: `Sự kiện «${event}» không được hỗ trợ` }, { status: 400 })
  } catch (error) {
    console.error('Inbound webhook error:', error)
    return NextResponse.json({ error: 'Không thể xử lý webhook inbound' }, { status: 500 })
  }
}
