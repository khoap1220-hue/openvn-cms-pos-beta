import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dispatchWebhook, verifyInboundWebhook } from '@/lib/webhook-service'
import { createOrder } from '@/lib/order-service'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { awardPointsForCompletedOrder } from '@/lib/member'
import { syncCombosUsingComponents } from '@/lib/combo'
import { logEvent, sendZalo } from '@/lib/agent-log'
import { ensureCustomerProfile, refreshCustomerMemory } from '@/lib/memory-engine'
import { llmVision } from '@/lib/llm'
import { carrierName } from '@/lib/agents'
import {
  calculateVoucherDiscount,
  ensureWarehousesAndVouchersSeeded,
  syncProductWarehouseStock,
} from '@/lib/warehouse-service'

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
          title: `Inbound tạo đơn ${order.code} từ hệ thống ngoài (kênh ${channel.name})`,
          detail: {
            event,
            channelKey,
            orderCode: order.code,
            total: order.total,
            voucherCode: order.voucherCode,
            discountAmount: order.discountAmount,
          },
          actor: 'API',
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

    return NextResponse.json({ error: `Sự kiện «${event}» không được hỗ trợ` }, { status: 400 })
  } catch (error) {
    console.error('Inbound webhook error:', error)
    return NextResponse.json({ error: 'Không thể xử lý webhook inbound' }, { status: 500 })
  }
}
