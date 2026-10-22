import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// PATCH: kết nối / ngắt kết nối / đồng bộ kênh
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { connected, sync } = body as { connected?: boolean; sync?: boolean }

    const channel = await db.channel.findUnique({ where: { id } })
    if (!channel) return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 })

    const data: { connected?: boolean; syncedAt?: Date } = {}
    if (typeof connected === 'boolean') data.connected = connected
    if (sync) data.syncedAt = new Date()

    const updated = await db.channel.update({ where: { id }, data })

    // Khi kết nối lại: tự động đẩy các sản phẩm ACTIVE lên kênh nếu chưa có
    if (data.connected === true) {
      const products = await db.product.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
      const existingListings = await db.channelListing.findMany({ where: { channelId: id }, select: { productId: true } })
      const existingIds = new Set(existingListings.map((l) => l.productId))
      const toAdd = products.filter((p) => !existingIds.has(p.id))
      if (toAdd.length > 0) {
        await db.channelListing.createMany({ data: toAdd.map((p) => ({ productId: p.id, channelId: id })) })
      }
    }

    return NextResponse.json({ channel: updated })
  } catch (error) {
    console.error('Channel PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật kênh' }, { status: 500 })
  }
}
