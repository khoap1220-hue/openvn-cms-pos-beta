import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const product = await db.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        listings: { include: { channel: { select: { id: true, key: true, name: true, color: true } } } },
        stockMovements: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    })
    if (!product) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })
    return NextResponse.json({ product })
  } catch (error) {
    console.error('Product GET error:', error)
    return NextResponse.json({ error: 'Không thể tải sản phẩm' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { sku, name, description, categoryId, costPrice, sellPrice, lowStockThreshold, status, listingChannelIds } = body

    const existing = await db.product.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })

    if (sku && sku.trim() !== existing.sku) {
      const dup = await db.product.findUnique({ where: { sku: sku.trim() } })
      if (dup) return NextResponse.json({ error: `SKU "${sku}" đã tồn tại` }, { status: 409 })
    }

    const product = await db.product.update({
      where: { id },
      data: {
        ...(sku !== undefined ? { sku: sku.trim() } : {}),
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        ...(costPrice !== undefined ? { costPrice: Number(costPrice) || 0 } : {}),
        ...(sellPrice !== undefined ? { sellPrice: Number(sellPrice) } : {}),
        ...(lowStockThreshold !== undefined ? { lowStockThreshold: Number(lowStockThreshold) || 5 } : {}),
        ...(status !== undefined ? { status } : {}),
      },
    })

    // Đồng bộ danh sách kênh bán nếu có gửi lên
    if (Array.isArray(listingChannelIds)) {
      const current = await db.channelListing.findMany({ where: { productId: id } })
      const currentIds = new Set(current.map((l) => l.channelId))
      const targetIds = new Set(listingChannelIds as string[])

      const toRemove = current.filter((l) => !targetIds.has(l.channelId)).map((l) => l.id)
      if (toRemove.length > 0) await db.channelListing.deleteMany({ where: { id: { in: toRemove } } })

      const toAdd = [...targetIds].filter((cid) => !currentIds.has(cid))
      if (toAdd.length > 0) await db.channelListing.createMany({ data: toAdd.map((channelId) => ({ productId: id, channelId })) })
    }

    return NextResponse.json({ product })
  } catch (error) {
    console.error('Product PUT error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật sản phẩm' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const orderItemCount = await db.orderItem.count({ where: { productId: id } })
    if (orderItemCount > 0) {
      return NextResponse.json({ error: 'Sản phẩm đã có đơn hàng, chỉ có thể chuyển sang trạng thái "Ngừng bán"' }, { status: 409 })
    }
    await db.product.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Product DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa sản phẩm' }, { status: 500 })
  }
}
