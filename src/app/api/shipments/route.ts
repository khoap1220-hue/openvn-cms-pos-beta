import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent, sendZalo } from '@/lib/agent-log'
import { AGENTS, CARRIERS, makeTrackingCode, tCarrier, buildVoiceContext, zaloKeyOf } from '@/lib/agents'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const codStatus = searchParams.get('codStatus')
    const where: Record<string, unknown> = {}
    if (status && status !== 'ALL') where.status = status
    if (codStatus && codStatus !== 'ALL') where.codStatus = codStatus

    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0))

    const [shipments, active, deliveredToday, dispatchedToday, codPendingAgg, codReceivedAgg] = await Promise.all([
      db.shipment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 100,
        include: {
          order: {
            select: {
              code: true,
              total: true,
              status: true,
              paymentMethod: true,
              address: true,
              customer: { select: { id: true, name: true, phone: true } },
              channel: { select: { id: true, key: true, name: true, color: true } },
              items: { select: { quantity: true, product: { select: { sku: true, name: true, fragile: true } } } },
            },
          },
        },
      }),
      db.shipment.count({ where: { status: { in: ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT'] } } }),
      db.shipment.count({ where: { status: 'DELIVERED', updatedAt: { gte: startOfDay } } }),
      db.shipment.count({ where: { createdAt: { gte: startOfDay } } }),
      // Đối soát COD: tiền chờ ĐVVC chuyển về + số vận đơn chờ
      db.shipment.aggregate({
        where: { codStatus: 'PENDING' },
        _count: true,
        _sum: { codAmount: true },
      }),
      db.shipment.aggregate({
        where: { codStatus: { in: ['RECEIVED', 'RECONCILED'] }, codReceivedAt: { gte: startOfDay } },
        _sum: { codReceived: true },
      }),
    ])

    return NextResponse.json({
      shipments,
      stats: {
        active,
        deliveredToday,
        dispatchedToday,
        codPendingCount: codPendingAgg._count,
        codPendingAmount: codPendingAgg._sum.codAmount ?? 0,
        codReceivedToday: codReceivedAgg._sum.codReceived ?? 0,
      },
    })
  } catch (error) {
    console.error('Shipments GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách vận chuyển' }, { status: 500 })
  }
}

// POST: người vận hành tự báo đơn vị vận chuyển (khi tắt auto_carrier)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { orderId?: string; carrier?: string }
    if (!body.orderId) return NextResponse.json({ error: 'Thiếu mã đơn hàng' }, { status: 400 })

    const order = await db.order.findUnique({
      where: { id: body.orderId },
      include: { channel: true, customer: true, items: { include: { product: true } } },
    })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })
    if (['CANCELLED', 'COMPLETED'].includes(order.status)) {
      return NextResponse.json({ error: 'Không thể báo vận chuyển cho đơn đã hủy/hoàn thành' }, { status: 400 })
    }
    const existing = await db.shipment.findUnique({ where: { orderId: order.id } })
    if (existing) return NextResponse.json({ error: 'Đơn hàng đã được báo đơn vị vận chuyển' }, { status: 409 })

    const carrier = CARRIERS.find((c) => c.key === body.carrier) ?? CARRIERS[Math.floor(Math.random() * CARRIERS.length)]
    const tracking = makeTrackingCode(carrier.key)
    const shipment = await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: carrier.key,
        trackingCode: tracking,
        status: 'DISPATCHED',
        fee: order.shippingFee,
        codAmount: order.paymentMethod === 'COD' ? order.total : 0,
        codStatus: 'PENDING',
        dispatchedBy: 'OPERATOR',
      },
      include: { order: true },
    })

    await logEvent(order.id, 'CARRIER_DISPATCHED', 'OPERATOR', `Người vận hành báo ${carrier.name} lấy hàng — mã vận đơn ${tracking}`)
    if (order.customer) {
      const { getMemorySnapshot } = await import('@/lib/memory-engine')
      const mem = await getMemorySnapshot(order.customer.id).catch(() => null)
      const ctx = buildVoiceContext({
        name: order.customer.name,
        salutation: mem?.salutation,
        orderCount: mem?.isReturning ? 2 : 1,
        items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
        preferences: mem?.preferences,
        painPoints: mem?.painPoints,
      })
      await sendZalo({
        customerId: order.customer.id,
        channelKey: zaloKeyOf(order.channel.key),
        content: tCarrier(ctx, carrier.name, tracking),
        agentName: AGENTS.LOGISTICS_AGENT.name,
        relatedOrderId: order.id,
      })
    }
    await logActivity({
      agent: 'SYSTEM',
      action: 'MANUAL_ACTION',
      level: 'info',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Người vận hành tự báo ${carrier.name} lấy hàng đơn ${order.code} — mã vận đơn ${tracking}`,
    })
    broadcast('shipment.updated', { id: shipment.id, orderId: order.id, status: 'DISPATCHED', code: order.code })

    return NextResponse.json({ shipment }, { status: 201 })
  } catch (error) {
    console.error('Shipments POST error:', error)
    return NextResponse.json({ error: 'Không thể báo đơn vị vận chuyển' }, { status: 500 })
  }
}
