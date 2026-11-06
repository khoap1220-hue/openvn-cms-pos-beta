import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import {
  DEFAULT_PRODUCT_TYPES,
  PRESET_CONVERSION_TEMPLATES,
  deleteProductUnitConfig,
  getAllUnitConfigs,
  getProductTypesCatalog,
  saveProductTypesCatalog,
  saveProductUnitConfig,
  syncLinkedVariantStocks,
} from '@/lib/unit-conversion'
import { syncCombosUsingComponents } from '@/lib/combo'
import { syncProductWarehouseStock } from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [productTypes, unitConfigs] = await Promise.all([
      getProductTypesCatalog(),
      getAllUnitConfigs(),
    ])
    return NextResponse.json({
      productTypes,
      unitConfigs,
      presets: PRESET_CONVERSION_TEMPLATES,
    })
  } catch (error) {
    console.error('GET /api/unit-conversions error:', error)
    return NextResponse.json({ error: 'Không thể tải cấu hình loại sản phẩm & quy đổi định lượng' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? 'save_unit_config')

    if (action === 'save_product_type') {
      const code = String(body.code ?? '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_')
      const name = String(body.name ?? '').trim()
      const description = String(body.description ?? '').trim()
      const badgeColor = String(body.badgeColor ?? 'blue').trim()
      const supportsConversion = body.supportsConversion !== false
      const deductLinkedBaseOnSale = Boolean(body.deductLinkedBaseOnSale)

      if (!code || !name) {
        return NextResponse.json({ error: 'Vui lòng nhập Mã loại và Tên loại sản phẩm' }, { status: 400 })
      }

      const current = await getProductTypesCatalog()
      const idx = current.findIndex((t) => t.code === code)
      const isSystem = DEFAULT_PRODUCT_TYPES.some((t) => t.code === code)
      const entry = {
        code,
        name,
        description: description || 'Loại sản phẩm tùy chỉnh theo quy trình vận hành.',
        badgeColor,
        supportsConversion,
        deductLinkedBaseOnSale,
        isSystem,
      }
      if (idx >= 0) {
        current[idx] = entry
      } else {
        current.push(entry)
      }
      const updated = await saveProductTypesCatalog(current)

      await logLedger({
        scope: 'INVENTORY',
        action: 'PRODUCT_TYPE_SAVED',
        actor: 'OPERATOR',
        entityType: 'ProductType',
        entityId: code,
        entityCode: code,
        title: `Cập nhật loại sản phẩm: ${name} (${code})`,
        detail: entry,
      })

      return NextResponse.json({ productTypes: updated, saved: entry })
    }

    if (action === 'delete_product_type') {
      const code = String(body.code ?? '').trim().toUpperCase()
      if (DEFAULT_PRODUCT_TYPES.some((t) => t.code === code)) {
        return NextResponse.json({ error: 'Không thể xóa loại sản phẩm mặc định của hệ thống' }, { status: 400 })
      }
      const current = await getProductTypesCatalog()
      const next = current.filter((t) => t.code !== code)
      await saveProductTypesCatalog(next)
      await db.product.updateMany({ where: { type: code }, data: { type: 'SIMPLE' } })
      return NextResponse.json({ productTypes: next })
    }

    if (action === 'delete_unit_config') {
      const productId = String(body.productId ?? '').trim()
      if (!productId) return NextResponse.json({ error: 'Thiếu productId' }, { status: 400 })
      await deleteProductUnitConfig(productId)
      const unitConfigs = await getAllUnitConfigs()
      return NextResponse.json({ unitConfigs })
    }

    if (action === 'save_unit_config') {
      const productId = String(body.productId ?? '').trim()
      if (!productId) return NextResponse.json({ error: 'Vui lòng chọn sản phẩm cần cấu hình quy đổi' }, { status: 400 })

      const product = await db.product.findUnique({ where: { id: productId } })
      if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })

      const baseUnit = String(body.baseUnit ?? product.unit ?? 'gr').trim() || 'gr'
      const purchaseUnit = String(body.purchaseUnit ?? 'kg').trim() || baseUnit
      const purchaseRate = Math.max(1, Number(body.purchaseRate) || 1)
      const sellUnit = String(body.sellUnit ?? baseUnit).trim() || baseUnit
      const sellRate = Math.max(1, Number(body.sellRate) || 1)
      const linkedBaseProductId = body.linkedBaseProductId ? String(body.linkedBaseProductId).trim() : null
      const productType = body.productType ? String(body.productType).trim() : undefined
      const convertCurrentStock = Boolean(body.convertCurrentStock)
      const posQuickQuantities = Array.isArray(body.posQuickQuantities)
        ? body.posQuickQuantities.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
        : baseUnit === 'gr'
          ? [100, 200, 500, 1000]
          : [1]

      const saved = await saveProductUnitConfig(productId, {
        baseUnit,
        purchaseUnit,
        purchaseRate,
        sellUnit,
        sellRate,
        posQuickQuantities,
        linkedBaseProductId,
      })

      let nextStock = product.stock
      let nextThreshold = product.lowStockThreshold

      if (convertCurrentStock && purchaseRate > 1) {
        nextStock = Math.round(product.stock * purchaseRate)
        nextThreshold = Math.round(product.lowStockThreshold * purchaseRate)
        await db.stockMovement.create({
          data: {
            productId: product.id,
            type: 'ADJUST',
            quantity: nextStock - product.stock,
            stockAfter: nextStock,
            note: `Quy đổi định lượng tồn kho: ${product.stock} ${purchaseUnit} × ${purchaseRate} = ${nextStock} ${baseUnit}`,
          },
        })
        await db.product.update({
          where: { id: product.id },
          data: { stock: nextStock, lowStockThreshold: nextThreshold },
        })
        await syncProductWarehouseStock(product.id, product.ownerWarehouseId)
      }

      await db.product.update({
        where: { id: product.id },
        data: {
          unit: baseUnit,
          ...(productType ? { type: productType } : {}),
          ...(convertCurrentStock && purchaseRate > 1 ? { stock: nextStock, lowStockThreshold: nextThreshold } : {}),
        },
      })

      if (linkedBaseProductId) {
        await syncLinkedVariantStocks(db, [linkedBaseProductId])
      } else {
        await syncLinkedVariantStocks(db, [product.id])
      }
      await syncCombosUsingComponents(db, [product.id])

      await logLedger({
        scope: 'INVENTORY',
        action: 'UNIT_CONVERSION_UPDATED',
        actor: 'OPERATOR',
        entityType: 'Product',
        entityId: product.id,
        entityCode: product.sku,
        title: `Cấu hình quy đổi định lượng ${product.name}: 1 ${purchaseUnit} = ${purchaseRate} ${baseUnit} · Bán: 1 ${sellUnit} = ${sellRate} ${baseUnit}`,
        detail: { saved, convertCurrentStock, nextStock },
      })

      const unitConfigs = await getAllUnitConfigs()
      return NextResponse.json({ saved, unitConfigs, nextStock })
    }

    return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 })
  } catch (error) {
    console.error('POST /api/unit-conversions error:', error)
    return NextResponse.json({ error: 'Không thể lưu cấu hình quy đổi định lượng' }, { status: 500 })
  }
}
