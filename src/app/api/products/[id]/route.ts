import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { comboAvailableFromRows, comboCostFromRows, syncComboStock, syncCombosUsingComponents } from '@/lib/combo'
import { syncProductWarehouseStock } from '@/lib/warehouse-service'
import {
  getProductUnitConfig,
  saveProductUnitConfig,
  syncLinkedVariantStocks,
} from '@/lib/unit-conversion'

export const dynamic = 'force-dynamic'

/** Giới hạn giá bán riêng trên một kênh (0đ – 1 tỷđ) */
const MAX_CHANNEL_PRICE = 1_000_000_000

/**
 * Parse mảng `listings` từ body: [{ channelId, price }] — price null/undefined = theo giá bán chung.
 * Dedupe theo channelId (mục sau đè mục trước). Trả error khi price không hợp lệ.
 */
function parseListingsInput(raw: unknown): { listings: Map<string, number | null> } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'Danh sách kênh bán (listings) không hợp lệ' }
  const map = new Map<string, number | null>()
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const channelId = (item as { channelId?: unknown }).channelId
    if (typeof channelId !== 'string' || !channelId.trim()) continue
    const priceRaw = (item as { price?: unknown }).price
    let price: number | null = null
    if (priceRaw !== null && priceRaw !== undefined && priceRaw !== '') {
      const num = Number(priceRaw)
      if (!Number.isFinite(num) || num < 0 || num > MAX_CHANNEL_PRICE) {
        return { error: 'Giá bán trên kênh phải là số từ 0 đến 1.000.000.000đ' }
      }
      price = num
    }
    map.set(channelId.trim(), price)
  }
  return { listings: map }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const product = await db.product.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        listings: { include: { channel: { select: { id: true, key: true, name: true, color: true, connected: true } } } },
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

    let existing = await db.product.findUnique({ where: { id } })
    if (!existing && sku && typeof sku === 'string' && sku.trim()) {
      existing = await db.product.findUnique({ where: { sku: sku.trim() } })
    }
    if (!existing) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })
    const targetId = existing.id

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
        if (dup && dup.id !== targetId) {
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

    // Loại sản phẩm: SIMPLE | WEIGHT_BULK | PACKAGED_VARIANT | MATERIAL | COMBO | Custom
    let nextType: string | undefined
    if (body.type !== undefined && typeof body.type === 'string' && body.type.trim()) {
      nextType = body.type.trim().toUpperCase()
    }
    const nextUnit =
      body.unitConfig?.baseUnit
        ? String(body.unitConfig.baseUnit).trim()
        : typeof body.unit === 'string' && body.unit.trim()
          ? body.unit.trim()
          : undefined

    // KÊNH BÁN + GIÁ RIÊNG THEO KÊNH: `listings` (kèm price) ưu tiên — parse & validate
    // TRƯỚC khi ghi DB để không rơi vào trạng thái nửa vời. Fallback `listingChannelIds`
    // (tương thích ngược — khi đó KHÔNG đụng price các listing tồn tại).
    const hasListingsInput = Array.isArray(body.listings)
    let targetListings = new Map<string, number | null>()
    let channelKeyById = new Map<string, string>()
    if (hasListingsInput) {
      const parsed = parseListingsInput(body.listings)
      if ('error' in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      targetListings = parsed.listings
      const channelIds = [...targetListings.keys()]
      if (channelIds.length > 0) {
        const channels = await db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true, key: true } })
        const validIds = new Set(channels.map((c) => c.id))
        const unknown = channelIds.filter((cid) => !validIds.has(cid))
        if (unknown.length > 0) {
          return NextResponse.json({ error: `Kênh bán không tồn tại: ${unknown.join(', ')}` }, { status: 400 })
        }
        channelKeyById = new Map(channels.map((c) => [c.id, c.key]))
      }
    }

    const effectiveType = nextType ?? existing.type
    const hasStockInput = body.stock !== undefined && effectiveType !== 'COMBO' && Number.isFinite(Number(body.stock))
    const nextStockVal = hasStockInput ? Math.max(0, Math.round(Number(body.stock))) : undefined
    const parsedThreshold =
      lowStockThreshold !== undefined && Number.isFinite(Number(lowStockThreshold)) && Number(lowStockThreshold) >= 0
        ? Math.round(Number(lowStockThreshold))
        : undefined

    const product = await db.product.update({
      where: { id: targetId },
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
        ...(parsedThreshold !== undefined ? { lowStockThreshold: parsedThreshold } : {}),
        ...(nextStockVal !== undefined ? { stock: nextStockVal } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(imageInput !== undefined ? { image: imageInput } : {}),
        ...(nextType !== undefined ? { type: nextType } : {}),
        ...(nextUnit !== undefined ? { unit: nextUnit } : {}),
      },
    })

    if (status !== undefined) {
      // Khi sản phẩm chuyển sang Ngừng bán (INACTIVE), đồng bộ trạng thái listings trên mọi kênh
      await db.channelListing.updateMany({
        where: { productId: targetId },
        data: { status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' },
      })
    }

    if (nextStockVal !== undefined && nextStockVal !== existing.stock) {
      const diff = nextStockVal - existing.stock
      await syncProductWarehouseStock(targetId, existing.ownerWarehouseId)
      await db.stockMovement.create({
        data: {
          productId: targetId,
          warehouseId: existing.ownerWarehouseId ?? null,
          type: 'ADJUST',
          quantity: diff,
          stockAfter: nextStockVal,
          note: `Cập nhật tồn kho từ hồ sơ sản phẩm: ${existing.stock} -> ${nextStockVal} (${diff > 0 ? `+${diff}` : diff})`,
        },
      })
      await Promise.all([
        syncCombosUsingComponents(db, [targetId]),
        syncLinkedVariantStocks(db, [targetId]),
      ])
    }

    if (body.unitConfig && typeof body.unitConfig === 'object') {
      const uc = body.unitConfig
      await saveProductUnitConfig(targetId, {
        baseUnit: String(uc.baseUnit || product.unit || 'sp').trim(),
        purchaseUnit: String(uc.purchaseUnit || product.unit || 'sp').trim(),
        purchaseRate: Math.max(1, Number(uc.purchaseRate) || 1),
        sellUnit: String(uc.sellUnit || product.unit || 'sp').trim(),
        sellRate: Math.max(1, Number(uc.sellRate) || 1),
        posQuickQuantities: Array.isArray(uc.posQuickQuantities) ? uc.posQuickQuantities : undefined,
        linkedBaseProductId: uc.linkedBaseProductId ? String(uc.linkedBaseProductId) : null,
      })
      if (uc.linkedBaseProductId) {
        await syncLinkedVariantStocks(db, [String(uc.linkedBaseProductId)])
      } else {
        await syncLinkedVariantStocks(db, [targetId])
      }
    }
    const savedUnitConfig = await getProductUnitConfig(targetId)

    // Đồng bộ danh sách kênh bán + giá riêng theo kênh
    // priceTracks: [field price_{channel.key}, before, after] — đưa vào lineage PRODUCT_UPDATED
    const priceTracks: Array<[string, number | null, number | null]> = []
    if (hasListingsInput) {
      const current = await db.channelListing.findMany({ where: { productId: targetId } })
      const currentIds = new Set(current.map((l) => l.channelId))

      // Kênh đang có mà không nằm trong target → gỡ listing
      const toRemove = current.filter((l) => !targetListings.has(l.channelId)).map((l) => l.id)
      if (toRemove.length > 0) await db.channelListing.deleteMany({ where: { id: { in: toRemove } } })

      // Upsert từng kênh target với giá riêng (unique productId + channelId)
      for (const [channelId, price] of targetListings) {
        if (currentIds.has(channelId)) {
          await db.channelListing.update({ where: { productId_channelId: { productId: targetId, channelId } }, data: { price } })
        } else {
          await db.channelListing.create({ data: { productId: targetId, channelId, price } })
        }
      }

      // Detect thay đổi price từng kênh để ghi lineage (kênh mới thêm có giá cũng tính là thay đổi)
      for (const [channelId, newPrice] of targetListings) {
        const oldListing = current.find((l) => l.channelId === channelId)
        const oldPrice = oldListing?.price ?? null
        if (oldPrice !== newPrice) {
          const key = channelKeyById.get(channelId) ?? channelId
          priceTracks.push([`price_${key.toLowerCase()}`, oldPrice, newPrice])
        }
      }
    } else if (Array.isArray(listingChannelIds)) {
      const current = await db.channelListing.findMany({ where: { productId: targetId } })
      const currentIds = new Set(current.map((l) => l.channelId))
      const targetIds = new Set(listingChannelIds as string[])

      const toRemove = current.filter((l) => !targetIds.has(l.channelId)).map((l) => l.id)
      if (toRemove.length > 0) await db.channelListing.deleteMany({ where: { id: { in: toRemove } } })

      const toAdd = [...targetIds].filter((cid) => !currentIds.has(cid))
      if (toAdd.length > 0) await db.channelListing.createMany({ data: toAdd.map((channelId) => ({ productId: targetId, channelId })) })
    }

    if (barcodeChanged) {
      await recordLineageChange({
        scope: 'INVENTORY',
        action: 'PRODUCT_BARCODE_UPDATED',
        entityType: 'Product',
        entityId: targetId,
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

    // DATA LINEAGE — chụp diff các trường sản phẩm đã sửa (gồm giá riêng từng kênh price_{key})
    {
      const before: Record<string, unknown> = {}
      const after: Record<string, unknown> = {}
      const track: Array<[string, unknown, unknown]> = [
        ['sku', existing.sku, product.sku],
        ['name', existing.name, product.name],
        ['costPrice', existing.costPrice, product.costPrice],
        ['sellPrice', existing.sellPrice, product.sellPrice],
        ['stock', existing.stock, product.stock],
        ['lowStockThreshold', existing.lowStockThreshold, product.lowStockThreshold],
        ['status', existing.status, product.status],
        ['barcode', existing.barcode, product.barcode],
        ['type', existing.type, product.type],
        ...priceTracks,
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
          entityId: targetId,
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

    broadcast('product.updated', { id: targetId, status: product.status })
    return NextResponse.json({ product: { ...product, unitConfig: savedUnitConfig } })
  } catch (error) {
    console.error('Product PUT error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật sản phẩm' }, { status: 500 })
  }
}

export const PATCH = PUT

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const [orderItemCount, purchaseItemCount, salesItemCount, parentCombos] = await Promise.all([
      db.orderItem.count({ where: { productId: id } }),
      db.purchaseInvoiceItem.count({ where: { productId: id } }),
      db.salesInvoiceItem.count({ where: { productId: id } }),
      db.bomComponent.findMany({
        where: { componentProductId: id, product: { type: 'COMBO' } },
        select: { productId: true },
      }),
    ])
    if (orderItemCount + purchaseItemCount + salesItemCount > 0) {
      return NextResponse.json(
        { error: 'Sản phẩm đã có đơn hàng hoặc chứng từ mua/bán, chỉ có thể chuyển sang trạng thái "Ngừng bán"' },
        { status: 409 }
      )
    }
    await db.product.delete({ where: { id } })
    for (const row of parentCombos) {
      await syncComboStock(db, row.productId)
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Product DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa sản phẩm' }, { status: 500 })
  }
}
