import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { DashboardData } from '@/lib/types'

export const dynamic = 'force-dynamic'

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export async function GET() {
  try {
    const now = new Date()
    const todayStart = startOfDay(now)
    const yesterdayStart = new Date(todayStart.getTime() - 86400000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const d14Start = new Date(todayStart.getTime() - 13 * 86400000)
    const d30Start = new Date(todayStart.getTime() - 29 * 86400000)

    const notCancelled = { not: 'CANCELLED' } as const

    const [
      revenueTodayAgg,
      revenueYesterdayAgg,
      revenueMonthAgg,
      revenuePrevMonthAgg,
      ordersTodayCount,
      ordersYesterdayCount,
      pendingOrders,
      totalProducts,
      lowStockCount,
      channels,
      recentOrders,
      lowStockProducts,
    ] = await Promise.all([
      db.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: todayStart }, status: notCancelled } }),
      db.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: yesterdayStart, lt: todayStart }, status: notCancelled } }),
      db.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: monthStart }, status: notCancelled } }),
      db.order.aggregate({ _sum: { total: true }, where: { createdAt: { gte: prevMonthStart, lt: monthStart }, status: notCancelled } }),
      db.order.count({ where: { createdAt: { gte: todayStart } } }),
      db.order.count({ where: { createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      db.order.count({ where: { status: { in: ['PENDING', 'CONFIRMED', 'PACKING'] } } }),
      db.product.count(),
      db.product.count({ where: { stock: { lte: db.product.fields.lowStockThreshold } } }),
      db.channel.findMany({ orderBy: { createdAt: 'asc' } }),
      db.order.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      }),
      db.product.findMany({
        where: { stock: { lte: db.product.fields.lowStockThreshold } },
        orderBy: { stock: 'asc' },
        take: 6,
        select: { id: true, sku: true, name: true, stock: true, lowStockThreshold: true },
      }),
    ])

    // Doanh thu & đơn theo ngày (14 ngày gần nhất)
    const recentOrdersForChart = await db.order.findMany({
      where: { createdAt: { gte: d14Start }, status: notCancelled },
      select: { createdAt: true, total: true },
    })
    const dayMap = new Map<string, { revenue: number; orders: number }>()
    for (let i = 0; i < 14; i++) {
      const d = new Date(todayStart.getTime() - i * 86400000)
      dayMap.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 })
    }
    for (const o of recentOrdersForChart) {
      const key = new Date(o.createdAt).toISOString().slice(0, 10)
      const entry = dayMap.get(key)
      if (entry) {
        entry.revenue += o.total
        entry.orders += 1
      }
    }
    const revenueByDay = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date,
        label: new Date(date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' }),
        ...v,
      }))

    // Đơn theo kênh (30 ngày)
    const monthOrders = await db.order.findMany({
      where: { createdAt: { gte: d30Start }, status: notCancelled },
      select: { channelId: true, total: true },
    })
    const channelStats = new Map<string, { orders: number; revenue: number }>()
    for (const o of monthOrders) {
      const s = channelStats.get(o.channelId) ?? { orders: 0, revenue: 0 }
      s.orders += 1
      s.revenue += o.total
      channelStats.set(o.channelId, s)
    }
    const ordersByChannel = channels
      .filter((c) => c.connected)
      .map((c) => ({
        key: c.key,
        name: c.name,
        color: c.color,
        orders: channelStats.get(c.id)?.orders ?? 0,
        revenue: channelStats.get(c.id)?.revenue ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // Top sản phẩm (30 ngày)
    const items30d = await db.orderItem.findMany({
      where: { order: { createdAt: { gte: d30Start }, status: notCancelled } },
      include: { product: { select: { id: true, sku: true, name: true } } },
    })
    const productAgg = new Map<string, { id: string; sku: string; name: string; sold: number; revenue: number }>()
    for (const it of items30d) {
      if (!it.product) continue
      const p = productAgg.get(it.productId) ?? { ...it.product, sold: 0, revenue: 0 }
      p.sold += it.quantity
      p.revenue += it.price * it.quantity
      productAgg.set(it.productId, p)
    }
    const topProducts = [...productAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5)

    const activeChannels = channels.filter((c) => c.connected).length
    const data: DashboardData = {
      stats: {
        revenueToday: revenueTodayAgg._sum.total ?? 0,
        revenueMonth: revenueMonthAgg._sum.total ?? 0,
        revenueGrowthPct:
          (revenuePrevMonthAgg._sum.total ?? 0) > 0
            ? Math.round((((revenueMonthAgg._sum.total ?? 0) - (revenuePrevMonthAgg._sum.total ?? 0)) / (revenuePrevMonthAgg._sum.total ?? 0)) * 1000) / 10
            : null,
        ordersToday: ordersTodayCount,
        ordersGrowthPct: ordersYesterdayCount > 0 ? Math.round(((ordersTodayCount - ordersYesterdayCount) / ordersYesterdayCount) * 1000) / 10 : null,
        pendingOrders,
        totalProducts,
        lowStockCount,
        activeChannels,
        totalChannels: channels.length,
        avgOrderValue: monthOrders.length > 0 ? Math.round(monthOrders.reduce((s, o) => s + o.total, 0) / monthOrders.length) : 0,
      },
      revenueByDay,
      ordersByChannel,
      // Prisma trả Date; khi serialize qua JSON sẽ là string đúng contract Order
      recentOrders: recentOrders as unknown as DashboardData['recentOrders'],
      lowStockProducts,
      topProducts,
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu tổng quan' }, { status: 500 })
  }
}
