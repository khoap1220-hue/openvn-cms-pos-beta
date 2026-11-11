import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getApiCache, setApiCache } from '@/lib/realtime'
import type { Channel } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cached = getApiCache<{ channels: Channel[] }>('channels:all')
    if (cached) {
      return NextResponse.json(cached)
    }

    const channels = await db.channel.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { orders: true, listings: true } },
        orders: { where: { status: { not: 'CANCELLED' } }, select: { total: true, subtotal: true, platformFee: true } },
      },
    })

    const data: Channel[] = channels.map((c) => {
      const revenue = c.orders.reduce((s, o) => s + o.total, 0)
      const platformFee = c.orders.reduce((s, o) => s + o.platformFee, 0)
      return {
        id: c.id,
        key: c.key,
        name: c.name,
        color: c.color,
        connected: c.connected,
        feePercent: c.feePercent,
        syncedAt: c.syncedAt?.toISOString() ?? null,
        stats: {
          orders: c._count.orders,
          revenue,
          listings: c._count.listings,
          // Đối soát phí sàn TMĐT: phí snapshot trên từng đơn + doanh thu thực nhận sau phí
          platformFee,
          netRevenue: revenue - platformFee,
        },
      }
    })

    const payload = { channels: data }
    setApiCache('channels:all', payload, 15_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Channels GET error:', error)
    return NextResponse.json({ error: 'Không thể tải kênh bán' }, { status: 500 })
  }
}
