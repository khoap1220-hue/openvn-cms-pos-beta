import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { syncComboStock } from '@/lib/combo'
import { getAllUnitConfigs } from '@/lib/unit-conversion'

export const dynamic = 'force-dynamic'

let defaultProductionBomsSeeded = false

async function ensureDefaultProductionBomsSeeded() {
  if (defaultProductionBomsSeeded) return
  defaultProductionBomsSeeded = true
  try {
    const skus = ['UD-TC-001', 'UD-TC-006', 'UD-TC-007', 'UD-SAP-001', 'UD-SAP-002', 'UD-VL-001']
    const prods = await db.product.findMany({
      where: { sku: { in: skus } },
      select: { id: true, sku: true },
    })
    const bySku = new Map(prods.map((p) => [p.sku, p.id]))
    const sap1 = bySku.get('UD-SAP-001')
    const sap2 = bySku.get('UD-SAP-002')
    const bac = bySku.get('UD-VL-001')
    if (!sap1 || !bac) return

    const recipes: Array<{ targetSku: string; items: Array<{ componentId: string; quantity: number }> }> = [
      {
        targetSku: 'UD-TC-001',
        items: [
          { componentId: sap1, quantity: 180 },
          { componentId: bac, quantity: 1 },
        ],
      },
      {
        targetSku: 'UD-TC-006',
        items: [
          { componentId: sap1, quantity: 220 },
          { componentId: bac, quantity: 1 },
        ],
      },
      {
        targetSku: 'UD-TC-007',
        items: [
          { componentId: sap2 || sap1, quantity: 250 },
          { componentId: bac, quantity: 1 },
        ],
      },
    ]

    for (const r of recipes) {
      const pid = bySku.get(r.targetSku)
      if (!pid) continue
      const existingCount = await db.bomComponent.count({ where: { productId: pid } })
      if (existingCount === 0) {
        await db.bomComponent.createMany({
          data: r.items.map((it) => ({
            productId: pid,
            componentProductId: it.componentId,
            quantity: it.quantity,
          })),
        })
      }
    }
  } catch (err) {
    console.warn('Skip seeding default production BOMs:', err)
  }
}

// GET ?productId → định mức của 1 thành phẩm; không param → tất cả group theo thành phẩm
export async function GET(req: NextRequest) {
  try {
    await ensureDefaultProductionBomsSeeded()
    const unitMap = await getAllUnitConfigs()
    const { searchParams } = new URL(req.url)
    const productId = searchParams.get('productId')?.trim()

    const enrichComponentProduct = (cp: {
      id: string
      sku: string
      name: string
      unit: string
      stock: number
      costPrice: number
    }) => {
      const uCfg = unitMap[cp.id]
      const purchaseRate = Math.max(1, Number(uCfg?.purchaseRate) || 1)
      // Nếu sản phẩm lưu theo gr/ml có hệ số quy đổi (VD: 1 kg = 1.000 gr) và costPrice đang lưu theo đơn vị mua (VD: 52.000₫/kg)
      const baseUnitCost =
        purchaseRate > 1 && cp.costPrice >= purchaseRate
          ? Math.round(cp.costPrice / purchaseRate)
          : cp.costPrice
      return {
        ...cp,
        costPrice: baseUnitCost,
        rawCostPrice: cp.costPrice,
        purchaseRate,
        purchaseUnit: uCfg?.purchaseUnit || cp.unit,
      }
    }

    if (productId) {
      const product = await db.product.findUnique({ where: { id: productId }, select: { id: true } })
      if (!product) return NextResponse.json({ error: 'Thành phẩm không tồn tại' }, { status: 404 })
      const components = await db.bomComponent.findMany({
        where: { productId },
        orderBy: { createdAt: 'asc' },
        include: {
          componentProduct: { select: { id: true, sku: true, name: true, unit: true, stock: true, costPrice: true } },
        },
      })
      return NextResponse.json({
        productId,
        components: components.map((c) => ({
          ...c,
          componentProduct: enrichComponentProduct(c.componentProduct),
        })),
      })
    }

    const all = await db.bomComponent.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, stock: true } },
        componentProduct: { select: { id: true, sku: true, name: true, unit: true, stock: true, costPrice: true } },
      },
    })

    const groups = new Map<
      string,
      {
        productId: string
        productSku: string
        productName: string
        unit: string
        stock: number
        components: Array<{
          id: string
          quantity: number
          componentProduct: {
            id: string
            sku: string
            name: string
            unit: string
            stock: number
            costPrice: number
            rawCostPrice?: number
            purchaseRate?: number
            purchaseUnit?: string
          }
        }>
      }
    >()
    for (const bom of all) {
      const group = groups.get(bom.productId) ?? {
        productId: bom.product.id,
        productSku: bom.product.sku,
        productName: bom.product.name,
        unit: bom.product.unit,
        stock: bom.product.stock,
        components: [],
      }
      group.components.push({
        id: bom.id,
        quantity: bom.quantity,
        componentProduct: enrichComponentProduct(bom.componentProduct),
      })
      groups.set(bom.productId, group)
    }

    return NextResponse.json({ groups: Array.from(groups.values()) })
  } catch (error) {
    console.error('BOM GET error:', error)
    return NextResponse.json({ error: 'Không thể tải định mức nguyên vật liệu' }, { status: 500 })
  }
}

// POST { productId, items: [{ componentProductId, quantity }] } — thay thế toàn bộ định mức của thành phẩm
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const productId = String(body.productId ?? '')
    if (!productId) return NextResponse.json({ error: 'Thiếu thành phẩm (productId)' }, { status: 400 })

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return NextResponse.json({ error: 'Thành phẩm không tồn tại' }, { status: 404 })

    const rawItems = body.items as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(rawItems)) {
      return NextResponse.json({ error: 'Danh sách vật liệu không hợp lệ (có thể để rỗng để xóa định mức)' }, { status: 400 })
    }

    const seen = new Set<string>()
    const items: Array<{ componentProductId: string; quantity: number }> = []
    for (const row of rawItems) {
      const componentProductId = String(row.componentProductId ?? '')
      const quantity = Number(row.quantity)
      if (componentProductId === productId) {
        return NextResponse.json({ error: 'Vật liệu không được trùng với chính thành phẩm' }, { status: 400 })
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: 'Định mức phải là số lớn hơn 0' }, { status: 400 })
      }
      if (seen.has(componentProductId)) {
        return NextResponse.json({ error: 'Danh sách vật liệu bị trùng' }, { status: 400 })
      }
      seen.add(componentProductId)
      items.push({ componentProductId, quantity })
    }

    if (items.length > 0) {
      const components = await db.product.findMany({
        where: { id: { in: items.map((it) => it.componentProductId) } },
        select: { id: true },
      })
      if (components.length !== items.length) {
        return NextResponse.json({ error: 'Một số vật liệu không tồn tại' }, { status: 400 })
      }
    }

    await db.$transaction([
      db.bomComponent.deleteMany({ where: { productId } }),
      db.bomComponent.createMany({
        data: items.map((it) => ({ productId, componentProductId: it.componentProductId, quantity: it.quantity })),
      }),
    ])

    // Combo/Set quà tặng: đồng bộ tồn hiển thị = số bộ đóng được từ thành phần
    // + giá vốn gộp = Σ costPrice thành phần × định mức
    if (product.type === 'COMBO') {
      const rows = await db.bomComponent.findMany({
        where: { productId },
        include: { componentProduct: { select: { costPrice: true } } },
      })
      const comboCost = rows.reduce((s, r) => s + r.quantity * r.componentProduct.costPrice, 0)
      await syncComboStock(db, productId)
      await db.product.update({ where: { id: productId }, data: { costPrice: Math.round(comboCost) } })
    }

    await logLedger({
      scope: 'BOM',
      action: 'BOM_UPDATED',
      actor: 'OPERATOR',
      entityType: 'Product',
      entityId: productId,
      entityCode: product.sku,
      title: product.type === 'COMBO' ? `Thành phần ${product.name}: ${items.length} thành phần` : `Định mức ${product.name}: ${items.length} VLT`,
      detail: { components: items, productType: product.type },
    })

    const components = await db.bomComponent.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
      include: {
        componentProduct: { select: { id: true, sku: true, name: true, unit: true, stock: true, costPrice: true } },
      },
    })

    return NextResponse.json({ productId, components })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu định mức'
    console.error('BOM POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
