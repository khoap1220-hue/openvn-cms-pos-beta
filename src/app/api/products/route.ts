import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { comboAvailableFromRows, comboCostFromRows } from '@/lib/combo'
import { broadcast, getApiCache, invalidateApiCache, setApiCache, patchProductInApiCache } from '@/lib/realtime'
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
    const { searchParams } = new URL(req.url)
    const cacheKey = `products:${searchParams.toString()}`
    const cached = getApiCache<{ products: unknown[] }>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

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

    type StaticProductMeta = {
      allCategories: Array<{ id: string; name: string; slug: string }>
      allChannels: Array<{ id: string; key: string; name: string; color: string; connected: boolean }>
      allWarehouses: Array<{ id: string; code: string; name: string; type: string; commissionPct: number }>
      allBomRows: Awaited<ReturnType<typeof db.bomComponent.findMany>>
    }
    const cachedStatic = getApiCache<StaticProductMeta>('products:static_meta')

    const [
      ,
      ,
      unitConfigs,
      rawProducts,
      allListings,
      allWhStocks,
      freshStatic,
    ] = await Promise.all([
      ensureWarehousesAndVouchersSeeded(),
      ensureUnitConversionsSeeded(),
      getAllUnitConfigs(),
      db.product.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      }),
      db.channelListing.findMany({ where: { status: { in: ['ACTIVE', 'UNLISTED'] } } }),
      db.warehouseStock.findMany(),
      cachedStatic
        ? Promise.resolve(cachedStatic)
        : Promise.all([
            db.category.findMany({ select: { id: true, name: true, slug: true } }),
            db.channel.findMany({ select: { id: true, key: true, name: true, color: true, connected: true } }),
            db.warehouse.findMany({ select: { id: true, code: true, name: true, type: true, commissionPct: true } }),
            db.bomComponent.findMany(),
          ]).then(([allCategories, allChannels, allWarehouses, allBomRows]) => {
            const meta: StaticProductMeta = { allCategories, allChannels, allWarehouses, allBomRows }
            setApiCache('products:static_meta', meta, 120_000)
            return meta
          }),
    ])

    const { allCategories, allChannels, allWarehouses, allBomRows } = freshStatic

    const catMap = new Map(allCategories.map((c) => [c.id, c]))
    const chMap = new Map(allChannels.map((c) => [c.id, c]))
    const whMap = new Map(allWarehouses.map((w) => [w.id, w]))
    const prodMap = new Map(rawProducts.map((p) => [p.id, p]))

    const listingsByProd = new Map<string, Array<Record<string, unknown>>>()
    for (const l of allListings) {
      const ch = chMap.get(l.channelId)
      if (!ch || !ch.connected) continue
      const arr = listingsByProd.get(l.productId) ?? []
      arr.push({ ...l, channel: ch })
      listingsByProd.set(l.productId, arr)
    }

    const whStocksByProd = new Map<string, Array<Record<string, unknown>>>()
    for (const ws of allWhStocks) {
      const wh = whMap.get(ws.warehouseId)
      if (!wh) continue
      const arr = whStocksByProd.get(ws.productId) ?? []
      arr.push({ ...ws, warehouse: wh })
      whStocksByProd.set(ws.productId, arr)
    }

    const bomByProd = new Map<
      string,
      Array<{
        id: string
        productId: string
        componentProductId: string
        quantity: number
        createdAt: Date
        componentProduct: {
          id: string
          sku: string
          name: string
          unit: string
          costPrice: number
          stock: number
        }
      }>
    >()
    for (const b of allBomRows) {
      const cp = prodMap.get(b.componentProductId)
      if (!cp) continue
      const arr = bomByProd.get(b.productId) ?? []
      arr.push({
        ...b,
        componentProduct: {
          id: cp.id,
          sku: cp.sku,
          name: cp.name,
          unit: cp.unit,
          costPrice: cp.costPrice,
          stock: cp.stock,
        },
      })
      bomByProd.set(b.productId, arr)
    }

    const products = rawProducts.map((p) => ({
      ...p,
      category: p.categoryId ? (catMap.get(p.categoryId) ?? null) : null,
      listings: listingsByProd.get(p.id) ?? [],
      warehouseStocks: whStocksByProd.get(p.id) ?? [],
      bomFinished: bomByProd.get(p.id) ?? [],
    }))

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

    const payload = { products: withCombo }
    setApiCache(cacheKey, payload, 15_000)
    return NextResponse.json(payload)
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

    // ẢNH SẢN PHẨM: Hỗ trợ Con trỏ URL CDN http(s) ≤ 2048 ký tự (~75B) HOẶC Micro-WebP nội bộ ≤ 12.000 ký tự (~8KB) cho SP không liên kết sàn
    let imageInput: string | null = null
    if (typeof body.image === 'string' && body.image.trim()) {
      const img = body.image.trim()
      const isHttpUrl = /^https?:\/\//i.test(img) && img.length <= 2048
      const isMicroDataUrl = /^data:image\/(webp|jpeg|jpg|png|gif);base64,/i.test(img) && img.length <= 12_000
      if (!isHttpUrl && !isMicroDataUrl) {
        return NextResponse.json(
          {
            error:
              'Ảnh sản phẩm phải là URL http(s) (≤ 2048 ký tự) hoặc ảnh nén siêu nhẹ Micro-WebP (≤ 8KB)',
          },
          { status: 400 }
        )
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

    let initialAttrs: Record<string, unknown> = {}
    if (body.attributes) {
      if (typeof body.attributes === 'string') {
        try {
          initialAttrs = JSON.parse(body.attributes) as Record<string, unknown>
        } catch {
          initialAttrs = {}
        }
      } else if (typeof body.attributes === 'object' && body.attributes !== null) {
        initialAttrs = { ...(body.attributes as Record<string, unknown>) }
      }
    }
    initialAttrs.cmsCustomImage = Boolean(imageInput)
    initialAttrs.pendingCdnOffload = Boolean(imageInput && imageInput.startsWith('data:image/'))

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
        attributes: JSON.stringify(initialAttrs),
      },
    })

    if (imageInput && imageInput.startsWith('data:image/')) {
      void (async () => {
        try {
          const res = await fetch(`${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/upload-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              dataUrl: imageInput,
              filename: `${product.sku}.webp`,
              shopeeItemId: '',
              shopeeModelId: '',
              syncToShopee: false,
            }),
            signal: AbortSignal.timeout(7000),
          })
          if (res.ok) {
            const data = (await res.json()) as { ok?: boolean; url?: string }
            if (data.ok && data.url && /^https?:\/\//i.test(data.url)) {
              initialAttrs.pendingCdnOffload = false
              initialAttrs.lastSyncedShopeeImage = data.url
              const nextAttrsStr = JSON.stringify(initialAttrs)
              await db.product.update({
                where: { id: product.id },
                data: { image: data.url, attributes: nextAttrsStr },
              })
              patchProductInApiCache(product.id, { image: data.url, attributes: nextAttrsStr })
              broadcast('product.updated', { id: product.id, inPlacePatched: true })
            }
          }
        } catch {
          // Micro-WebP fallback remains intact
        }
      })()
    }

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

    invalidateApiCache('products')
    broadcast('product.updated', { id: product.id, created: true })
    return NextResponse.json({ product }, { status: 201 })
  } catch (error) {
    console.error('Products POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo sản phẩm' }, { status: 500 })
  }
}
