import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyInboundWebhook } from '@/lib/webhook-service'
import { createOrder } from '@/lib/order-service'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

interface InboundOrderData {
  channelKey?: string
  items?: Array<{ productId?: string; quantity?: number }>
  customerName?: string
  customerPhone?: string
  address?: string
}

interface InboundStockData {
  productId?: string
  delta?: number
  note?: string
}

// POST /api/webhooks/inbound — nhận webhook từ hệ thống ngoài (ký HMAC X-Signature)
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const verified = await verifyInboundWebhook(rawBody, req.headers.get('x-signature'))
    if (!verified.ok) {
      return NextResponse.json({ error: verified.reason }, { status: 401 })
    }

    const event = verified.payload.event
    const data = verified.payload.data

    // ===== PING: kiểm tra kết nối =====
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

    // ===== Tạo đơn từ hệ thống ngoài =====
    if (event === 'INBOUND_ORDER_CREATE') {
      const d = (data ?? {}) as InboundOrderData
      const channelKey = d.channelKey?.trim() || 'WEBSITE'
      const channel = await db.channel.findUnique({ where: { key: channelKey } })
      if (!channel) {
        return NextResponse.json({ error: `Không tìm thấy kênh bán với key «${channelKey}»` }, { status: 400 })
      }
      if (!Array.isArray(d.items) || d.items.length === 0) {
        return NextResponse.json({ error: 'Thiếu danh sách sản phẩm (items)' }, { status: 400 })
      }
      const items = d.items
        .map((it) => ({ productId: String(it.productId ?? ''), quantity: Math.max(1, Number(it.quantity) || 1) }))
        .filter((it) => it.productId)
      if (items.length === 0) {
        return NextResponse.json({ error: 'Danh sách sản phẩm không hợp lệ' }, { status: 400 })
      }

      try {
        const order = await createOrder({
          channelId: channel.id,
          items,
          customerName: d.customerName?.trim() || undefined,
          customerPhone: d.customerPhone?.trim() || undefined,
          address: d.address?.trim() || undefined,
        })
        await logLedger({
          scope: 'WEBHOOK',
          action: 'INBOUND_RECEIVED',
          entityType: 'Order',
          entityId: order.id,
          entityCode: order.code,
          title: `Inbound tạo đơn ${order.code} từ hệ thống ngoài (kênh ${channel.name})`,
          detail: { event, channelKey, orderCode: order.code, total: order.total },
          actor: 'API',
        })
        return NextResponse.json({ ok: true, order: { code: order.code, id: order.id } })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Không thể tạo đơn hàng'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    // ===== Cập nhật tồn kho từ hệ thống ngoài =====
    if (event === 'INBOUND_STOCK_UPDATE') {
      const d = (data ?? {}) as InboundStockData
      const productId = d.productId?.trim()
      const delta = Number(d.delta)
      if (!productId) return NextResponse.json({ error: 'Thiếu productId' }, { status: 400 })
      if (!Number.isFinite(delta) || delta === 0) {
        return NextResponse.json({ error: 'delta phải là số khác 0' }, { status: 400 })
      }

      const product = await db.product.findUnique({ where: { id: productId } })
      if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })

      const stockAfter = product.stock + delta
      if (stockAfter < 0) {
        return NextResponse.json({ error: `Kho không đủ: hiện có ${product.stock}, không thể trừ ${Math.abs(delta)}` }, { status: 400 })
      }

      await db.product.update({ where: { id: productId }, data: { stock: stockAfter } })
      await db.stockMovement.create({
        data: {
          productId,
          type: 'ADJUST',
          quantity: delta,
          stockAfter,
          note: d.note?.trim() || 'Cập nhật kho từ webhook ngoài',
        },
      })

      await logLedger({
        scope: 'WEBHOOK',
        action: 'INBOUND_RECEIVED',
        entityType: 'Product',
        entityId: productId,
        entityCode: product.sku,
        title: `Inbound cập nhật kho ${product.sku} ${delta > 0 ? '+' : ''}${delta} → ${stockAfter}`,
        detail: { event, delta, stockAfter },
        actor: 'API',
      })
      return NextResponse.json({ ok: true, productId, sku: product.sku, stockAfter })
    }

    return NextResponse.json({ error: `Sự kiện «${event}» không được hỗ trợ` }, { status: 400 })
  } catch (error) {
    console.error('Inbound webhook error:', error)
    return NextResponse.json({ error: 'Không thể xử lý webhook inbound' }, { status: 500 })
  }
}
