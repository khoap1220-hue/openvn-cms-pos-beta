import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// GET ?productId → định mức của 1 thành phẩm; không param → tất cả group theo thành phẩm
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const productId = searchParams.get('productId')?.trim()

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
      return NextResponse.json({ productId, components })
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
        components: Array<{ id: string; quantity: number; componentProduct: { id: string; sku: string; name: string; unit: string; stock: number; costPrice: number } }>
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
        componentProduct: bom.componentProduct,
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

    await logLedger({
      scope: 'BOM',
      action: 'BOM_UPDATED',
      actor: 'OPERATOR',
      entityType: 'Product',
      entityId: productId,
      entityCode: product.sku,
      title: `Định mức ${product.name}: ${items.length} VLT`,
      detail: { components: items },
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
