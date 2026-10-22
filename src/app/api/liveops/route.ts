import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSettingsMap } from '@/lib/agent-engine'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await getSettingsMap()
    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0))
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000)

    const [
      pendingOrders,
      confirmedOrders,
      packingOrders,
      shippingOrders,
      completedTotal,
      tasksToday,
      reviewsToday,
      messagesToday,
      unread,
      activities,
      activeShipments,
      pendingList,
      packingStuckList,
      automationTotal,
      agentHandled,
    ] = await Promise.all([
      db.order.count({ where: { status: 'PENDING' } }),
      db.order.count({ where: { status: 'CONFIRMED' } }),
      db.order.count({ where: { status: 'PACKING' } }),
      db.order.count({ where: { status: 'SHIPPING' } }),
      db.order.count({ where: { status: 'COMPLETED' } }),
      db.agentActivity.count({ where: { createdAt: { gte: startOfDay }, agent: { not: 'SYSTEM' } } }),
      db.agentActivity.count({ where: { createdAt: { gte: startOfDay }, action: 'REVIEW_RECEIVED' } }),
      db.directMessage.count({ where: { createdAt: { gte: startOfDay } } }),
      db.directMessage.count({ where: { sender: 'CUSTOMER', readAt: null } }),
      db.agentActivity.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }),
      db.shipment.findMany({
        where: { status: { in: ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT'] } },
        orderBy: { updatedAt: 'desc' },
        take: 8,
        include: {
          order: {
            select: {
              code: true,
              customer: { select: { name: true } },
              channel: { select: { key: true, name: true, color: true } },
            },
          },
        },
      }),
      db.order.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 5,
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { name: true, phone: true } },
          items: { include: { product: { select: { name: true } } } },
        },
      }),
      db.order.findMany({
        where: { status: 'PACKING', shipments: { none: {} } },
        orderBy: { updatedAt: 'asc' },
        take: 5,
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { name: true, phone: true } },
        },
      }),
      db.agentActivity.count({ where: { createdAt: { gte: dayAgo }, agent: { not: 'SYSTEM' } } }),
      db.agentActivity.count({ where: { createdAt: { gte: dayAgo }, agent: { not: 'SYSTEM' }, action: { not: 'MANUAL_ACTION' } } }),
    ])

    const automationRate = automationTotal > 0 ? Math.round((agentHandled / automationTotal) * 100) : 100

    return NextResponse.json({
      settings,
      stats: {
        pendingOrders,
        processing: confirmedOrders + packingOrders,
        shippingCount: shippingOrders,
        completedTotal,
        tasksToday,
        reviewsToday,
        messagesToday,
        unread,
        automationRate,
      },
      pipeline: [
        { key: 'PENDING', label: 'Đơn mới', count: pendingOrders },
        { key: 'CONFIRMED', label: 'Đã xác nhận', count: confirmedOrders },
        { key: 'PACKING', label: 'Đang đóng gói', count: packingOrders },
        { key: 'SHIPPING', label: 'Đang giao', count: shippingOrders },
        { key: 'COMPLETED', label: 'Hoàn thành', count: completedTotal },
      ],
      activities,
      activeShipments,
      attention: {
        pendingList,
        packingStuckList,
        pendingActive: !settings.master || !settings.auto_confirm,
        packingStuckActive: !settings.master || !settings.auto_carrier,
      },
    })
  } catch (error) {
    console.error('LiveOps GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu buồng lái' }, { status: 500 })
  }
}
