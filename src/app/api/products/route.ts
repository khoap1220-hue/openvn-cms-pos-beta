import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { comboAvailableFromRows, comboCostFromRows } from '@/lib/combo'
import { ensureWarehousesAndVouchersSeeded, syncProductWarehouseStock } from '@/lib/warehouse-service'
import {
  ensureUnitConversionsSeeded,
  getAllUnitConfigs,
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

export async function GET(req: NextRequest) {
  try {
    await Promise.all([ensureWarehousesAndVouchersSeeded(), ensureUnitConversionsSeeded()])
    const unitConfigs = await getAllUnitConfigs()
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()
    const status = searchParams.get('status')
    const categoryId = searchParams.get('categoryId')
    const channelId = searchParams.get('channelId')
    const barcode = searchParams.get('barcode')?.trim()

    const where: Record<string, unknown> = {}
    if (barcode) {
      // tra cứu chính xác theo mã vạch (dùng cho quét nhanh)
      where.barcode = barcode
    }
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ]
    }
    if (status && status !== 'ALL') where.status = status
    if (categoryId && categoryId !== 'ALL') where.categoryId = categoryId
    if (channelId && channelId !== 'ALL') where.listings = { some: { channelId, channel: { connected: true }, status: 'ACTIVE' } }

    const products = await db.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        listings: {
          where: { channel: { connected: true }, status: 'ACTIVE' },
          include: { channel: { select: { id: true, key: true, name: true, color: true, connected: true } } },
        },
        warehouseStocks: {
          include: { warehouse: { select: { id: true, code: true, name: true, type: true, commissionPct: true } } },
        },
        bomFinished: {
          include: { componentProduct: { select: { id: true, sku: true, name: true, unit: true, costPrice: true, stock: true } } },
        },
      },
    })

    // COMBO/SET quà tặng + gắn cấu hình quy đổi định lượng (unitConfig)
    const withCombo = products.map((p) => {
      const unitConfig = unitConfigs[p.id] ?? null
      if (p.type !== 'COMBO') {
        const { bomFinished: _bc, ...rest } = p
        return { ...rest, unitConfig }
      }
      const components = p.bomFinished.map((row) => ({
        productId: row.componentProduct.id,
        sku: row.componentProduct.sku,
        name: row.componentProduct.name,
        quantity: row.quantity,
        unit: row.componentProduct.unit,
        costPrice: row.componentProduct.costPrice,
        stock: row.componentProduct.stock,
      }))
      const { bomFinished, ...rest } = p
      return {
        ...rest,
        unitConfig,
        components,
        comboCostPrice: comboCostFromRows(bomFinished),
        comboAvailable: comboAvailableFromRows(bomFinished),
      }
    })

    return NextResponse.json({ products: withCombo })
  } catch (error) {
    console.error('Products GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách sản phẩm' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sku, name, description, categoryId, costPrice, sellPrice, stock, lowStockThreshold, status, listingChannelIds } = body
    const productType = typeof body.type === 'string' && body.type.trim() ? body.type.trim().toUpperCase() : 'SIMPLE'
    const baseUnitInput = typeof body.unit === 'string' && body.unit.trim() ? body.unit.trim() : 'sp'

    if (!sku?.trim() || !name?.trim()) {
      return NextResponse.json({ error: 'Vui lòng nhập SKU và tên sản phẩm' }, { status: 400 })
    }
    if (sellPrice == null || sellPrice < 0) {
      return NextResponse.json({ error: 'Giá bán không hợp lệ' }, { status: 400 })
    }

    const existing = await db.product.findUnique({ where: { sku: sku.trim() } })
    if (existing) {
      return NextResponse.json({ error: `SKU "${sku}" đã tồn tại` }, { status: 409 })
    }

    const barcodeInput = typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null
    if (barcodeInput) {
      if (!/^[\x20-\x7E]{1,64}$/.test(barcodeInput)) {
        return NextResponse.json({ error: 'Mã vạch chỉ được chứa 1–64 ký tự ASCII in được' }, { status: 400 })
      }
      const barcodeDup = await db.product.findUnique({ where: { barcode: barcodeInput } })
      if (barcodeDup) {
        return NextResponse.json({ error: `Mã vạch "${barcodeInput}" đã thuộc sản phẩm ${barcodeDup.sku}` }, { status: 409 })
      }
    }

    // ẢNH SẢN PHẨM: URL http(s) ≤ 500 ký tự (trống = không có ảnh)
    let imageInput: string | null = null
    if (typeof body.image === 'string' && body.image.trim()) {
      const img = body.image.trim()
      if (img.length > 500 || !/^https?:\/\//i.test(img)) {
        return NextResponse.json({ error: 'Ảnh sản phẩm phải là URL http(s) hợp lệ (tối đa 500 ký tự)' }, { status: 400 })
      }
      imageInput = img
    }

    // KÊNH BÁN + GIÁ RIÊNG THEO KÊNH: `listings` (kèm price) ưu tiên,
    // fallback `listingChannelIds` (tương thích ngược — giá null = theo giá bán chung)
    let targetListings: Array<{ channelId: string; price: number | null }> = []
    const hasListingsInput = Array.isArray(body.listings)
    if (hasListingsInput) {
      const parsed = parseListingsInput(body.listings)
      if ('error' in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      const channelIds = [...parsed.listings.keys()]
      if (channelIds.length > 0) {
        const channels = await db.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true } })
        const validIds = new Set(channels.map((c) => c.id))
        const unknown = channelIds.filter((cid) => !validIds.has(cid))
        if (unknown.length > 0) {
          return NextResponse.json({ error: `Kênh bán không tồn tại: ${unknown.join(', ')}` }, { status: 400 })
        }
      }
      targetListings = channelIds.map((channelId) => ({ channelId, price: parsed.listings.get(channelId) ?? null }))
    }

    const rawStock = Number(stock) || 0
    const unitCfgInput = body.unitConfig && typeof body.unitConfig === 'object' ? body.unitConfig : null
    const purchaseRate = unitCfgInput ? Math.max(1, Number(unitCfgInput.purchaseRate) || 1) : 1
    // Nếu nhập kho ban đầu theo đơn vị chẵn (VD: 10 kg) và bật convertInitialStock -> tự quy đổi ra 10.000 gr
    const initialStock =
      body.convertInitialStock && purchaseRate > 1 ? Math.round(rawStock * purchaseRate) : Math.round(rawStock)

    const product = await db.product.create({
      data: {
        sku: sku.trim(),
        barcode: barcodeInput,
        name: name.trim(),
        description: description?.trim() || null,
        categoryId: categoryId || null,
        costPrice: Number(costPrice) || 0,
        sellPrice: Number(sellPrice),
        stock: initialStock,
        lowStockThreshold:
          lowStockThreshold !== undefined && Number.isFinite(Number(lowStockThreshold)) && Number(lowStockThreshold) >= 0
            ? Math.round(Number(lowStockThreshold))
            : 5,
        status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        image: imageInput,
        unit: unitCfgInput?.baseUnit ? String(unitCfgInput.baseUnit).trim() : baseUnitInput,
        type: productType,
      },
    })

    if (unitCfgInput) {
      await saveProductUnitConfig(product.id, {
        baseUnit: String(unitCfgInput.baseUnit || baseUnitInput).trim(),
        purchaseUnit: String(unitCfgInput.purchaseUnit || baseUnitInput).trim(),
        purchaseRate,
        sellUnit: String(unitCfgInput.sellUnit || baseUnitInput).trim(),
        sellRate: Math.max(1, Number(unitCfgInput.sellRate) || 1),
        posQuickQuantities: Array.isArray(unitCfgInput.posQuickQuantities) ? unitCfgInput.posQuickQuantities : undefined,
        linkedBaseProductId: unitCfgInput.linkedBaseProductId ? String(unitCfgInput.linkedBaseProductId) : null,
      })
      if (unitCfgInput.linkedBaseProductId) {
        await syncLinkedVariantStocks(db, [String(unitCfgInput.linkedBaseProductId)])
      }
    }

    if (initialStock > 0) {
      const noteText =
        body.convertInitialStock && purchaseRate > 1
          ? `Nhập kho ban đầu ${rawStock} ${unitCfgInput?.purchaseUnit || ''} (tự quy đổi ×${purchaseRate} = +${initialStock} ${product.unit})`
          : 'Nhập kho khi tạo sản phẩm'
      await db.stockMovement.create({
        data: { productId: product.id, type: 'IMPORT', quantity: initialStock, stockAfter: initialStock, note: noteText },
      })
      await syncProductWarehouseStock(product.id, body.ownerWarehouseId ? String(body.ownerWarehouseId) : null)
    }

    if (hasListingsInput) {
      // listings[] gửi lên (kể cả rỗng = không kênh nào) — mỗi kênh kèm giá riêng
      if (targetListings.length > 0) {
        await db.channelListing.createMany({
          data: targetListings.map(({ channelId, price }) => ({ productId: product.id, channelId, price })),
        })
      }
    } else if (Array.isArray(listingChannelIds) && listingChannelIds.length > 0) {
      await db.channelListing.createMany({
        data: listingChannelIds.map((channelId: string) => ({ productId: product.id, channelId })),
      })
    }

    return NextResponse.json({ product }, { status: 201 })
  } catch (error) {
    console.error('Products POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo sản phẩm' }, { status: 500 })
  }
}
