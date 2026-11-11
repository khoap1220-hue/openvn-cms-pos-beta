import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getApiCache, setApiCache } from '@/lib/realtime'
import type { ReportsData } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(90, Math.max(7, Number(searchParams.get('days')) || 30))
    const cacheKey = `reports:${days}`
    const cached = getApiCache<ReportsData>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const periodStart = new Date(todayStart.getTime() - (days - 1) * 86400000)
    const notCancelled = { not: 'CANCELLED' } as const

    const [orders, channels, allStatusCounts, items, totalOrdersAll] = await Promise.all([
      db.order.findMany({
        where: { createdAt: { gte: periodStart }, status: notCancelled },
        select: { channelId: true, total: true, createdAt: true },
      }),
      db.channel.findMany({ orderBy: { createdAt: 'asc' } }),
      db.order.groupBy({ by: ['status'], _count: { _all: true } }),
      db.orderItem.findMany({
        where: { order: { createdAt: { gte: periodStart }, status: notCancelled } },
        include: { product: { select: { id: true, sku: true, name: true } } },
      }),
      db.order.count({ where: { createdAt: { gte: periodStart } } }),
    ])

    const totalOrdersInPeriod = orders.length
    const totalRevenue = orders.reduce((s, o) => s + o.total, 0)

    // Doanh thu theo kênh
    const channelMap = new Map<string, { orders: number; revenue: number }>()
    for (const o of orders) {
      const s = channelMap.get(o.channelId) ?? { orders: 0, revenue: 0 }
      s.orders += 1
      s.revenue += o.total
      channelMap.set(o.channelId, s)
    }
    const revenueByChannel = channels
      .map((c) => ({
        key: c.key,
        name: c.name,
        color: c.color,
        orders: channelMap.get(c.id)?.orders ?? 0,
        revenue: channelMap.get(c.id)?.revenue ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // Doanh thu theo ngày
    const dayMap = new Map<string, { revenue: number; orders: number }>()
    for (let i = 0; i < days; i++) {
      const d = new Date(todayStart.getTime() - i * 86400000)
      dayMap.set(d.toISOString().slice(0, 10), { revenue: 0, orders: 0 })
    }
    for (const o of orders) {
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

    // Top sản phẩm
    const productAgg = new Map<string, { id: string; sku: string; name: string; sold: number; revenue: number }>()
    for (const it of items) {
      if (!it.product) continue
      const p = productAgg.get(it.productId) ?? { ...it.product, sold: 0, revenue: 0 }
      p.sold += it.quantity
      p.revenue += it.price * it.quantity
      productAgg.set(it.productId, p)
    }
    const topProducts = [...productAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8)

    // Tổng đơn trong kỳ (kể cả hủy) để tính tỉ lệ
    void totalOrdersAll
    const completedCount = allStatusCounts.find((s) => s.status === 'COMPLETED')?._count._all ?? 0
    const cancelledCount = allStatusCounts.find((s) => s.status === 'CANCELLED')?._count._all ?? 0
    const totalCountAll = allStatusCounts.reduce((s, x) => s + x._count._all, 0)

    const data: ReportsData = {
      summary: {
        revenue: totalRevenue,
        orders: totalOrdersInPeriod,
        avgOrderValue: totalOrdersInPeriod > 0 ? Math.round(totalRevenue / totalOrdersInPeriod) : 0,
        completionRate: totalCountAll > 0 ? Math.round((completedCount / totalCountAll) * 1000) / 10 : 0,
        cancelRate: totalCountAll > 0 ? Math.round((cancelledCount / totalCountAll) * 1000) / 10 : 0,
      },
      revenueByChannel,
      revenueByDay,
      statusDistribution: allStatusCounts.map((s) => ({ status: s.status, count: s._count._all })).sort((a, b) => b.count - a.count),
      topProducts,
    }

    setApiCache(cacheKey, data, 15_000)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Reports GET error:', error)
    return NextResponse.json({ error: 'Không thể tải báo cáo' }, { status: 500 })
  }
}
