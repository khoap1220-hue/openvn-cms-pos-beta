import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

/**
 * POST /api/products/[id]/sync-description
 * Đẩy bản mô tả chuẩn (Product.description — nguồn chân lý duy nhất) lên các kênh bán.
 * Body optional: { channelIds?: string[] } — bỏ trống = đồng bộ TẤT CẢ listing của sản phẩm.
 * Mô tả master có thể null — khi đó bản kênh cũng được ghi đè về null (đồng bộ "xóa sạch").
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Body optional — rỗng/không JSON = đồng bộ tất cả kênh
    let channelIds: string[] | null = null
    try {
      const body = (await req.json()) as { channelIds?: unknown }
      if (Array.isArray(body?.channelIds)) {
        channelIds = body.channelIds.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      }
    } catch {
      // body trống — coi như đồng bộ tất cả
    }

    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })
    }

    const listings = await db.channelListing.findMany({
      where: { productId: id, ...(channelIds ? { channelId: { in: channelIds } } : {}) },
      include: { channel: { select: { id: true, key: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    })

    const syncedAt = new Date()
    if (listings.length > 0) {
      await db.channelListing.updateMany({
        where: { id: { in: listings.map((l) => l.id) } },
        data: { description: product.description, descriptionSyncedAt: syncedAt },
      })
    }

    // DATA LINEAGE — trước/sau theo số kênh đã từng được đồng bộ mô tả
    const beforeSynced = listings.filter((l) => l.descriptionSyncedAt != null).length
    await recordLineageChange({
      scope: 'INVENTORY',
      action: 'PRODUCT_DESCRIPTION_SYNCED',
      entityType: 'Product',
      entityId: id,
      entityCode: product.sku,
      title: `Đồng bộ mô tả ${product.sku} lên ${listings.length} kênh`,
      before: { syncedChannels: beforeSynced },
      after: { syncedChannels: listings.length },
      actor: 'OPERATOR',
      actorName: 'Người vận hành',
      originSource: 'MANUAL_ADMIN',
      detail: { sku: product.sku, name: product.name, descriptionLength: product.description?.length ?? 0 },
    })

    // Realtime — báo các view đang mở biết sản phẩm vừa đổi
    broadcast('product.updated', { id })

    return NextResponse.json({
      synced: listings.length,
      channels: listings.map((l) => ({
        channelId: l.channelId,
        key: l.channel.key,
        name: l.channel.name,
        syncedAt: syncedAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('Product sync-description error:', error)
    return NextResponse.json({ error: 'Không thể đồng bộ mô tả sản phẩm' }, { status: 500 })
  }
}
