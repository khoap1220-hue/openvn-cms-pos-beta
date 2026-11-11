import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { broadcast, getProductFromApiCache, invalidateApiCache, patchProductInApiCache } from '@/lib/realtime'
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

    const existingInclude = {
      listings: {
        include: {
          channel: { select: { id: true, key: true, name: true, color: true, connected: true } },
        },
      },
    }
    type ExistingWithListings = NonNullable<
      Awaited<ReturnType<typeof db.product.findUnique<{ where: { id: string }; include: typeof existingInclude }>>>
    >
    let existing = await db.product.findUnique({ where: { id }, include: existingInclude })
    if (!existing && sku && typeof sku === 'string' && sku.trim()) {
      existing = await db.product.findUnique({ where: { sku: sku.trim() }, include: existingInclude })
    }
    if (!existing) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })
    const targetId = existing.id

    // MÃ VẠCH: chỉ kiểm tra trùng lặp trên DB khi mã vạch thực sự thay đổi
    let barcodeChanged: { from: string | null; to: string | null } | null = null
    let nextBarcodeToCheck: string | null = null
    if (body.barcode !== undefined) {
      const nextBarcode =
        typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null
      if (nextBarcode) {
        if (!/^[\x20-\x7E]{1,64}$/.test(nextBarcode)) {
          return NextResponse.json({ error: 'Mã vạch chỉ được chứa 1–64 ký tự ASCII in được' }, { status: 400 })
        }
        if (nextBarcode !== (existing.barcode ?? null)) {
          nextBarcodeToCheck = nextBarcode
        }
      }
      if ((existing.barcode ?? null) !== nextBarcode) {
        barcodeChanged = { from: existing.barcode ?? null, to: nextBarcode }
      }
    }

    const skuToCheck = sku && sku.trim() !== existing.sku ? sku.trim() : null
    if (skuToCheck || nextBarcodeToCheck) {
      const [skuDup, barcodeDup] = await Promise.all([
        skuToCheck ? db.product.findUnique({ where: { sku: skuToCheck }, select: { id: true } }) : Promise.resolve(null),
        nextBarcodeToCheck
          ? db.product.findUnique({ where: { barcode: nextBarcodeToCheck }, select: { id: true, sku: true } })
          : Promise.resolve(null),
      ])
      if (skuDup && skuDup.id !== targetId) {
        return NextResponse.json({ error: `SKU "${sku}" đã tồn tại` }, { status: 409 })
      }
      if (barcodeDup && barcodeDup.id !== targetId) {
        return NextResponse.json(
          { error: `Mã vạch "${nextBarcodeToCheck}" đã thuộc sản phẩm ${barcodeDup.sku}` },
          { status: 409 }
        )
      }
    }

    // ẢNH SẢN PHẨM: Hỗ trợ Con trỏ URL CDN http(s) ≤ 2048 ký tự (~75B) HOẶC Micro-WebP nội bộ ≤ 12.000 ký tự (~8KB) cho SP không liên kết sàn
    let imageInput: string | null | undefined
    if (body.image !== undefined) {
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

    // KÊNH BÁN + GIÁ RIÊNG THEO KÊNH: ưu tiên lấy map từ existing.listings để tránh query thừa
    const hasListingsInput = Array.isArray(body.listings)
    let targetListings = new Map<string, number | null>()
    const channelKeyById = new Map<string, string>(
      existing.listings.map((l) => [l.channelId, l.channel.key])
    )
    if (hasListingsInput) {
      const parsed = parseListingsInput(body.listings)
      if ('error' in parsed) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      targetListings = parsed.listings
      const missingChannelIds = [...targetListings.keys()].filter((cid) => !channelKeyById.has(cid))
      if (missingChannelIds.length > 0) {
        const channels = await db.channel.findMany({
          where: { id: { in: missingChannelIds } },
          select: { id: true, key: true },
        })
        const validIds = new Set(channels.map((c) => c.id))
        const unknown = missingChannelIds.filter((cid) => !validIds.has(cid))
        if (unknown.length > 0) {
          return NextResponse.json({ error: `Kênh bán không tồn tại: ${unknown.join(', ')}` }, { status: 400 })
        }
        for (const c of channels) channelKeyById.set(c.id, c.key)
      }
    }

    const effectiveType = nextType ?? existing.type
    const hasStockInput = body.stock !== undefined && effectiveType !== 'COMBO' && Number.isFinite(Number(body.stock))
    const nextStockVal = hasStockInput ? Math.max(0, Math.round(Number(body.stock))) : undefined
    const parsedThreshold =
      lowStockThreshold !== undefined && Number.isFinite(Number(lowStockThreshold)) && Number(lowStockThreshold) >= 0
        ? Math.round(Number(lowStockThreshold))
        : undefined
    const nextSellPrice = sellPrice !== undefined ? Number(sellPrice) : existing.sellPrice
    const nextStockEffective = nextStockVal !== undefined ? nextStockVal : existing.stock

    // Tính toán trước thay đổi ChannelListing và Outbox Shopee để gộp vào 1 lần ghi DB duy nhất
    const currentListings = existing.listings
    const currentIds = new Set(currentListings.map((l) => l.channelId))
    const priceTracks: Array<[string, number | null, number | null]> = []
    const listingsToRemove: string[] = []
    const listingsToCreate: Array<{ productId: string; channelId: string; price: number | null }> = []
    const listingsToUpdate: Array<{ channelId: string; price: number | null }> = []

    if (hasListingsInput) {
      for (const l of currentListings) {
        if (!targetListings.has(l.channelId)) listingsToRemove.push(l.id)
      }
      for (const [channelId, price] of targetListings) {
        const oldListing = currentListings.find((l) => l.channelId === channelId)
        if (currentIds.has(channelId)) {
          if ((oldListing?.price ?? null) !== price) {
            listingsToUpdate.push({ channelId, price })
          }
        } else {
          listingsToCreate.push({ productId: targetId, channelId, price })
        }
        const oldPrice = oldListing?.price ?? null
        if (oldPrice !== price) {
          const key = channelKeyById.get(channelId) ?? channelId
          priceTracks.push([`price_${key.toLowerCase()}`, oldPrice, price])
        }
      }
    } else if (Array.isArray(listingChannelIds)) {
      const targetIds = new Set(listingChannelIds as string[])
      for (const l of currentListings) {
        if (!targetIds.has(l.channelId)) listingsToRemove.push(l.id)
      }
      for (const cid of targetIds) {
        if (!currentIds.has(cid)) listingsToCreate.push({ productId: targetId, channelId: cid, price: null })
      }
    }

    // Kiểm tra liên kết Shopee & cờ bảo vệ ảnh tùy chỉnh trong attributes để gộp vào cùng 1 lệnh db.product.update
    let nextAttributesJson: string | undefined
    let outboxLogInput: Parameters<typeof logLedger>[0] | null = null
    let shopeeListingAutoPriceUpdateId: string | null = null
    const imageChanged = imageInput !== undefined && imageInput !== (existing.image || null)
    const syncImageToShopee = body.syncImageToShopee !== false

    if (existing.attributes || imageChanged) {
      try {
        const latestAttrs = existing.attributes
          ? (JSON.parse(existing.attributes) as Record<string, unknown>)
          : ({} as Record<string, unknown>)
        let attrsMutated = false

        if (imageChanged) {
          latestAttrs.cmsCustomImage = Boolean(imageInput)
          latestAttrs.lastCmsImageUpdatedAt = new Date().toISOString()
          latestAttrs.pendingCdnOffload = Boolean(imageInput && imageInput.startsWith('data:image/'))
          attrsMutated = true
        }

        const shopeeItemId = String(latestAttrs.shopeeItemId || '').trim()
        const shopeeModelId = String(latestAttrs.shopeeModelId || '').trim()
        if (shopeeItemId) {
          const shopeeListing = currentListings.find((l) => l.channel.key === 'SHOPEE')
          const hasExplicitShopeeTrack = priceTracks.some(([f]) => f === 'price_shopee')
          if (existing.sellPrice !== nextSellPrice && !hasExplicitShopeeTrack && shopeeListing) {
            shopeeListingAutoPriceUpdateId = shopeeListing.id
          }
          const explicitShopeePrice = hasListingsInput && shopeeListing ? targetListings.get(shopeeListing.channelId) : undefined
          const targetShopeePrice =
            hasExplicitShopeeTrack && explicitShopeePrice != null
              ? explicitShopeePrice
              : nextSellPrice
          const targetShopeeStock = nextStockEffective
          const stockChanged = existing.stock !== nextStockEffective
          const priceChanged = existing.sellPrice !== nextSellPrice || hasExplicitShopeeTrack
          const shouldPushImage = imageChanged && Boolean(imageInput) && syncImageToShopee

          if (stockChanged || priceChanged || shouldPushImage) {
            latestAttrs.pendingOutboxSync = true
            latestAttrs.cmsTargetStock = targetShopeeStock
            latestAttrs.cmsTargetPrice = targetShopeePrice
            if (shouldPushImage && imageInput) {
              latestAttrs.cmsTargetImage = imageInput
            }
            latestAttrs.lastCmsEditAt = new Date().toISOString()
            attrsMutated = true
            outboxLogInput = {
              scope: 'CHANNEL',
              action: 'OUTBOX_PENDING',
              entityType: 'Product',
              entityId: targetId,
              entityCode: sku ? sku.trim() : existing.sku,
              title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đẩy cập nhật [${sku ? sku.trim() : existing.sku}] (Tồn: ${targetShopeeStock}, Giá: ${targetShopeePrice.toLocaleString('vi-VN')}đ${shouldPushImage ? ', Ảnh mới' : ''}) lên Shopee`,
              detail: {
                direction: 'CMS_TO_SHOPEE',
                source: 'OPENVN_CMS',
                target: 'SHOPEE_SELLER_CENTER',
                sku: sku ? sku.trim() : existing.sku,
                shopeeItemId,
                shopeeModelId,
                targetStock: targetShopeeStock,
                targetPrice: targetShopeePrice,
                targetImage: shouldPushImage ? imageInput : undefined,
                targetUnlisted: Boolean(latestAttrs.isUnlistedOnShopee),
                reason: 'CMS_PRODUCT_EDIT',
              },
              actor: 'OPERATOR',
              originSource: 'SHOPEE_SYNC',
            }
          }
        }

        if (attrsMutated) {
          nextAttributesJson = JSON.stringify(latestAttrs)
        }
      } catch {
        // ignore invalid json
      }
    }

    // Chỉ đẩy những cột thực sự thay đổi vào db.product.update (nếu không có cột nào đổi thì bỏ qua 1 roundtrip DB)
    const updateData: Record<string, any> = {}
    if (sku !== undefined && sku.trim() !== existing.sku) updateData.sku = sku.trim()
    if (name !== undefined && name.trim() !== existing.name) updateData.name = name.trim()
    if (body.barcode !== undefined) {
      const nextBarcode = body.barcode && String(body.barcode).trim() ? String(body.barcode).trim() : null
      if (nextBarcode !== (existing.barcode || null)) updateData.barcode = nextBarcode
    }
    if (description !== undefined) {
      const nextDesc = description?.trim() || null
      if (nextDesc !== (existing.description || null)) updateData.description = nextDesc
    }
    if (categoryId !== undefined) {
      const nextCat = categoryId || null
      if (nextCat !== (existing.categoryId || null)) updateData.categoryId = nextCat
    }
    if (costPrice !== undefined && (Number(costPrice) || 0) !== Number(existing.costPrice || 0)) {
      updateData.costPrice = Number(costPrice) || 0
    }
    if (sellPrice !== undefined && Number(sellPrice) !== Number(existing.sellPrice || 0)) {
      updateData.sellPrice = Number(sellPrice)
    }
    if (parsedThreshold !== undefined && parsedThreshold !== Number(existing.lowStockThreshold || 0)) {
      updateData.lowStockThreshold = parsedThreshold
    }
    if (nextStockVal !== undefined && nextStockVal !== Number(existing.stock || 0)) {
      updateData.stock = nextStockVal
    }
    if (status !== undefined && status !== existing.status) {
      updateData.status = status
    }
    if (imageInput !== undefined && imageInput !== (existing.image || null)) {
      updateData.image = imageInput
    }
    if (nextType !== undefined && nextType !== existing.type) {
      updateData.type = nextType
    }
    if (nextUnit !== undefined && nextUnit !== existing.unit) {
      updateData.unit = nextUnit
    }
    if (nextAttributesJson !== undefined && nextAttributesJson !== (existing.attributes || null)) {
      updateData.attributes = nextAttributesJson
    }

    // Thực thi song song toàn bộ cập nhật chính trong 1 đợt
    const [product, savedUnitConfig] = await Promise.all([
      Object.keys(updateData).length > 0
        ? db.product.update({
            where: { id: targetId },
            data: updateData,
          })
        : Promise.resolve({ ...existing, updatedAt: new Date() }),
      body.unitConfig && typeof body.unitConfig === 'object'
        ? saveProductUnitConfig(
            targetId,
            {
              baseUnit: String(body.unitConfig.baseUnit || nextUnit || existing.unit || 'sp').trim(),
              purchaseUnit: String(body.unitConfig.purchaseUnit || nextUnit || existing.unit || 'sp').trim(),
              purchaseRate: Math.max(1, Number(body.unitConfig.purchaseRate) || 1),
              sellUnit: String(body.unitConfig.sellUnit || nextUnit || existing.unit || 'sp').trim(),
              sellRate: Math.max(1, Number(body.unitConfig.sellRate) || 1),
              posQuickQuantities: Array.isArray(body.unitConfig.posQuickQuantities)
                ? body.unitConfig.posQuickQuantities
                : undefined,
              linkedBaseProductId: body.unitConfig.linkedBaseProductId
                ? String(body.unitConfig.linkedBaseProductId)
                : null,
            },
            true
          )
        : getProductUnitConfig(targetId),
      status !== undefined && status !== existing.status
        ? status === 'ACTIVE'
          ? db.channelListing.updateMany({
              where: { productId: targetId, status: 'INACTIVE' },
              data: { status: 'ACTIVE' },
            })
          : db.channelListing.updateMany({
              where: { productId: targetId },
              data: { status: 'INACTIVE' },
            })
        : Promise.resolve(),
      listingsToRemove.length > 0
        ? db.channelListing.deleteMany({ where: { id: { in: listingsToRemove } } })
        : Promise.resolve(),
      listingsToCreate.length > 0
        ? db.channelListing.createMany({ data: listingsToCreate })
        : Promise.resolve(),
      ...listingsToUpdate.map((u) =>
        db.channelListing.update({
          where: { productId_channelId: { productId: targetId, channelId: u.channelId } },
          data: { price: u.price },
        })
      ),
      shopeeListingAutoPriceUpdateId &&
      !listingsToUpdate.some(
        (u) => currentListings.find((l) => l.id === shopeeListingAutoPriceUpdateId)?.channelId === u.channelId
      )
        ? db.channelListing.update({
            where: { id: shopeeListingAutoPriceUpdateId },
            data: { price: nextSellPrice },
          })
        : Promise.resolve(),
    ])

    // Cập nhật tức thì bộ nhớ đệm L1 (Surgical In-Place Patch) trước khi trả về response
    const inPlacePatched = patchProductInApiCache(targetId, {
      ...product,
      unitConfig: savedUnitConfig,
    })

    // Thực thi bất đồng bộ (non-blocking) các tác vụ hậu kỳ: đồng bộ kho con, combo, ghi sổ cái & lineage
    void (async () => {
      try {
        const bgTasks: Array<Promise<unknown>> = []

        if (nextStockVal !== undefined && nextStockVal !== existing.stock) {
          const diff = nextStockVal - existing.stock
          bgTasks.push(
            syncProductWarehouseStock(targetId, existing.ownerWarehouseId),
            db.stockMovement.create({
              data: {
                productId: targetId,
                warehouseId: existing.ownerWarehouseId ?? null,
                type: 'ADJUST',
                quantity: diff,
                stockAfter: nextStockVal,
                note: `Cập nhật tồn kho từ hồ sơ sản phẩm: ${existing.stock} -> ${nextStockVal} (${diff > 0 ? `+${diff}` : diff})`,
              },
            }),
            syncCombosUsingComponents(db, [targetId]),
            syncLinkedVariantStocks(db, [targetId])
          )
        } else if (body.unitConfig?.linkedBaseProductId) {
          bgTasks.push(syncLinkedVariantStocks(db, [String(body.unitConfig.linkedBaseProductId)]))
        }

        if (outboxLogInput) {
          bgTasks.push(logLedger(outboxLogInput))
          fetch(`${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/trigger-sync`, { method: 'POST' }).catch(() => null)
        }

        if (barcodeChanged) {
          bgTasks.push(
            recordLineageChange({
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
          )
        }

        if (existing.sellPrice !== product.sellPrice) {
          const diffPrice = product.sellPrice - existing.sellPrice
          const pctChange = existing.sellPrice > 0 ? ((diffPrice / existing.sellPrice) * 100).toFixed(1) : '100'
          const sign = diffPrice > 0 ? '+' : ''
          bgTasks.push(
            logLedger({
              scope: 'INVENTORY',
              action: 'PRODUCT_PRICE_CHANGED',
              entityType: 'Product',
              entityId: targetId,
              entityCode: product.sku,
              title: `[CMS ➔ CMS] [THAY ĐỔI GIÁ BÁN] [${product.sku}] ${existing.sellPrice.toLocaleString('vi-VN')}đ ➔ ${product.sellPrice.toLocaleString('vi-VN')}đ (${sign}${diffPrice.toLocaleString('vi-VN')}đ, ${sign}${pctChange}%)`,
              detail: {
                direction: 'CMS_TO_CMS',
                sku: product.sku,
                name: product.name,
                oldPrice: existing.sellPrice,
                newPrice: product.sellPrice,
                diffPrice,
                percentChange: Number(pctChange),
                costPrice: product.costPrice,
                margin:
                  product.sellPrice > 0
                    ? (((product.sellPrice - product.costPrice) / product.sellPrice) * 100).toFixed(1) + '%'
                    : '0%',
              },
              beforeSnapshot: { sellPrice: existing.sellPrice, costPrice: existing.costPrice },
              afterSnapshot: { sellPrice: product.sellPrice, costPrice: product.costPrice },
              changedFields: ['sellPrice'],
              actor: 'OPERATOR',
              originSource: 'MANUAL_ADMIN',
            })
          )
        }

        for (const [field, oldP, newP] of priceTracks) {
          if (oldP !== newP && newP !== null) {
            const chKey = field.replace('price_', '').toUpperCase()
            const oldPNum = oldP ?? existing.sellPrice
            const diffP = newP - oldPNum
            const sign = diffP > 0 ? '+' : ''
            bgTasks.push(
              logLedger({
                scope: 'CHANNEL',
                action: 'CHANNEL_PRICE_CHANGED',
                entityType: 'Product',
                entityId: targetId,
                entityCode: product.sku,
                title: `[GIÁ KÊNH ${chKey}] [${product.sku}] ${oldPNum.toLocaleString('vi-VN')}đ ➔ ${newP.toLocaleString('vi-VN')}đ (${sign}${diffP.toLocaleString('vi-VN')}đ)`,
                detail: {
                  channelKey: chKey,
                  sku: product.sku,
                  oldPrice: oldPNum,
                  newPrice: newP,
                  diffPrice: diffP,
                },
                beforeSnapshot: { [field]: oldP },
                afterSnapshot: { [field]: newP },
                changedFields: [field],
                actor: 'OPERATOR',
                originSource: 'MANUAL_ADMIN',
              })
            )
          }
        }

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
          ['image', existing.image, product.image],
          ['type', existing.type, product.type],
          ...priceTracks,
        ]
        for (const [field, b, a] of track) {
          if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
            before[field] = b
            after[field] = a
          }
        }

        // Nếu ảnh sản phẩm đang ở chế độ dự phòng Micro-WebP (data:image/...), tự động đẩy ngầm lên Shopee Media CDN để giải phóng DB về con trỏ 75 bytes
        if (product.image && product.image.startsWith('data:image/')) {
          bgTasks.push(
            (async () => {
              try {
                const parsedAttrs = product.attributes
                  ? (JSON.parse(product.attributes) as Record<string, unknown>)
                  : ({} as Record<string, unknown>)
                const sItemId = String(parsedAttrs.shopeeItemId || '').trim()
                const sModelId = String(parsedAttrs.shopeeModelId || '').trim()
                const res = await fetch(`${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/upload-image`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    dataUrl: product.image,
                    filename: `${product.sku}.webp`,
                    shopeeItemId: sItemId,
                    shopeeModelId: sModelId,
                    syncToShopee: Boolean(sItemId) && syncImageToShopee,
                  }),
                  signal: AbortSignal.timeout(7000),
                })
                if (res.ok) {
                  const data = (await res.json()) as { ok?: boolean; url?: string }
                  if (data.ok && data.url && /^https?:\/\//i.test(data.url)) {
                    parsedAttrs.pendingCdnOffload = false
                    parsedAttrs.lastSyncedShopeeImage = data.url
                    delete parsedAttrs.cmsTargetImage
                    const nextAttrsStr = JSON.stringify(parsedAttrs)
                    await db.product.update({
                      where: { id: targetId },
                      data: { image: data.url, attributes: nextAttrsStr },
                    })
                    patchProductInApiCache(targetId, { image: data.url, attributes: nextAttrsStr })
                    broadcast('product.updated', { id: targetId, inPlacePatched: true })
                  }
                }
              } catch {
                // Giữ nguyên ảnh Micro-WebP dự phòng nếu Daemon chưa bật
              }
            })()
          )
        }
        if (Object.keys(after).length > 0) {
          bgTasks.push(
            recordLineageChange({
              scope: 'INVENTORY',
              action: 'PRODUCT_UPDATED',
              entityType: 'Product',
              entityId: targetId,
              entityCode: product.sku,
              sourceRefCode: product.sku,
              title: `[CMS ➔ CMS] Cập nhật sản phẩm ${product.sku} — ${Object.keys(after).join(', ')}`,
              before,
              after,
              detail: { direction: 'CMS_TO_CMS', changedFields: Object.keys(after) },
              actor: 'OPERATOR',
              actorName: 'Người vận hành',
              originSource: 'MANUAL_ADMIN',
            })
          )
        }

        if (bgTasks.length > 0) {
          await Promise.all(bgTasks)
        }
      } catch (bgErr) {
        console.error('Background product post-update error:', bgErr)
      }
    })()

    broadcast('product.updated', { id: targetId, status: product.status, inPlacePatched })
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
    invalidateApiCache('products')
    invalidateApiCache('inventory:')
    invalidateApiCache('bom:')
    broadcast('product.updated', { id, deleted: true })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Product DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa sản phẩm' }, { status: 500 })
  }
}
