import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { comboAvailableFromRows, comboCostFromRows } from '@/lib/combo'

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
        bomFinished: {
          include: { componentProduct: { select: { id: true, sku: true, name: true, unit: true, costPrice: true, stock: true } } },
        },
      },
    })
    if (!product) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })

    if (product.type !== 'COMBO') {
      const { bomFinished: _bc, ...rest } = product
      return NextResponse.json({ product: rest })
    }
    const components = product.bomFinished.map((row) => ({
      productId: row.componentProduct.id,
      sku: row.componentProduct.sku,
      name: row.componentProduct.name,
      quantity: row.quantity,
      unit: row.componentProduct.unit,
      costPrice: row.componentProduct.costPrice,
      stock: row.componentProduct.stock,
    }))
    const { bomFinished, ...rest } = product
    return NextResponse.json({
      product: {
        ...rest,
        components,
        comboCostPrice: comboCostFromRows(product.bomFinished),
        comboAvailable: comboAvailableFromRows(product.bomFinished),
      },
    })
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

    // MÃ VẠCH: cập nhật nếu gửi lên (trống = xóa mã vạch)
    let barcodeChanged: { from: string | null; to: string | null } | null = null
    if (body.barcode !== undefined) {
      const nextBarcode =
        typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null
      if (nextBarcode) {
        if (!/^[\x20-\x7E]{1,64}$/.test(nextBarcode)) {
          return NextResponse.json({ error: 'Mã vạch chỉ được chứa 1–64 ký tự ASCII in được' }, { status: 400 })
        }
        const dup = await db.product.findUnique({ where: { barcode: nextBarcode } })
        if (dup && dup.id !== id) {
          return NextResponse.json(
            { error: `Mã vạch "${nextBarcode}" đã thuộc sản phẩm ${dup.sku}` },
            { status: 409 }
          )
        }
      }
      if ((existing.barcode ?? null) !== nextBarcode) {
        barcodeChanged = { from: existing.barcode ?? null, to: nextBarcode }
      }
    }

    // ẢNH SẢN PHẨM: URL http(s) ≤ 500 ký tự (trống = xóa ảnh)
    let imageInput: string | null | undefined
    if (body.image !== undefined) {
      if (typeof body.image === 'string' && body.image.trim()) {
        const img = body.image.trim()
        if (img.length > 500 || !/^https?:\/\//i.test(img)) {
          return NextResponse.json({ error: 'Ảnh sản phẩm phải là URL http(s) hợp lệ (tối đa 500 ký tự)' }, { status: 400 })
        }
        imageInput = img
      } else {
        imageInput = null
      }
    }

    // Loại sản phẩm: SIMPLE | COMBO (Set quà tặng — thành phần khai báo ở Định mức)
    let nextType: string | undefined
    if (body.type !== undefined) {
      nextType = body.type === 'COMBO' ? 'COMBO' : 'SIMPLE'
    }

    const product = await db.product.update({
      where: { id },
      data: {
        ...(sku !== undefined ? { sku: sku.trim() } : {}),
        ...(name !== undefined ? { name: name.trim() } : {}),
        ...(body.barcode !== undefined
          ? { barcode: body.barcode && String(body.barcode).trim() ? String(body.barcode).trim() : null }
          : {}),
        ...(description !== undefined ? { description: description?.trim() || null } : {}),
        ...(categoryId !== undefined ? { categoryId: categoryId || null } : {}),
        ...(costPrice !== undefined ? { costPrice: Number(costPrice) || 0 } : {}),
        ...(sellPrice !== undefined ? { sellPrice: Number(sellPrice) } : {}),
        ...(lowStockThreshold !== undefined ? { lowStockThreshold: Number(lowStockThreshold) || 5 } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(imageInput !== undefined ? { image: imageInput } : {}),
        ...(nextType !== undefined ? { type: nextType } : {}),
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

    if (barcodeChanged) {
      await recordLineageChange({
        scope: 'INVENTORY',
        action: 'PRODUCT_BARCODE_UPDATED',
        entityType: 'Product',
        entityId: id,
        entityCode: product.sku,
        sourceRefCode: product.sku,
        title: `Cập nhật mã vạch ${product.sku}: ${barcodeChanged.from ?? '(trống)'} → ${barcodeChanged.to ?? '(xóa)'}`,
        before: { barcode: barcodeChanged.from },
        after: { barcode: barcodeChanged.to },
        actor: 'OPERATOR',
        actorName: 'Người vận hành',
        originSource: 'BARCODE_SCAN',
        detail: { sku: product.sku, name: product.name },
      })
    }

    // DATA LINEAGE — chụp diff các trường sản phẩm đã sửa
    {
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      const track: Array<[string, unknown, unknown]> = [
        ['sku', existing.sku, product.sku],
        ['name', existing.name, product.name],
        ['costPrice', existing.costPrice, product.costPrice],
        ['sellPrice', existing.sellPrice, product.sellPrice],
        ['lowStockThreshold', existing.lowStockThreshold, product.lowStockThreshold],
        ['status', existing.status, product.status],
        ['barcode', existing.barcode, product.barcode],
        ['type', existing.type, product.type],
      ]
      for (const [field, b, a] of track) {
        if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
          before[field] = b
          after[field] = a
        }
      }
      if (Object.keys(after).length > 0) {
        await recordLineageChange({
          scope: 'INVENTORY',
          action: 'PRODUCT_UPDATED',
          entityType: 'Product',
          entityId: id,
          entityCode: product.sku,
          sourceRefCode: product.sku,
          title: `Cập nhật sản phẩm ${product.sku} — ${Object.keys(after).join(', ')}`,
          before,
          after,
          actor: 'OPERATOR',
          actorName: 'Người vận hành',
          originSource: 'MANUAL_ADMIN',
        })
      }
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
