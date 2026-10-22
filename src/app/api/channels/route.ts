import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { Channel } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const channels = await db.channel.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        _count: { select: { orders: true, listings: true } },
        orders: { where: { status: { not: 'CANCELLED' } }, select: { total: true } },
      },
    })

    const data: Channel[] = channels.map((c) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      color: c.color,
      connected: c.connected,
      feePercent: c.feePercent,
      syncedAt: c.syncedAt?.toISOString() ?? null,
      stats: {
        orders: c._count.orders,
        revenue: c.orders.reduce((s, o) => s + o.total, 0),
        listings: c._count.listings,
      },
    }))

    return NextResponse.json({ channels: data })
  } catch (error) {
    console.error('Channels GET error:', error)
    return NextResponse.json({ error: 'Không thể tải kênh bán' }, { status: 500 })
  }
}
