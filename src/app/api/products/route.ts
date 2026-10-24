import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { comboAvailableFromRows, comboCostFromRows } from '@/lib/combo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
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
    if (channelId && channelId !== 'ALL') where.listings = { some: { channelId } }

    const products = await db.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        listings: {
          include: { channel: { select: { id: true, key: true, name: true, color: true } } },
        },
        bomFinished: {
          include: { componentProduct: { select: { id: true, sku: true, name: true, unit: true, costPrice: true, stock: true } } },
        },
      },
    })

    // COMBO/SET quà tặng: trả kèm thành phần + giá vốn gộp + số bộ có thể đóng được
    const withCombo = products.map((p) => {
      if (p.type !== 'COMBO') {
        const { bomFinished: _bc, ...rest } = p
        return rest
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
    const productType = body.type === 'COMBO' ? 'COMBO' : 'SIMPLE'

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

    const initialStock = Number(stock) || 0
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
        lowStockThreshold: Number(lowStockThreshold) || 5,
        status: status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
        image: imageInput,
        type: productType,
      },
    })

    if (initialStock > 0) {
      await db.stockMovement.create({
        data: { productId: product.id, type: 'IMPORT', quantity: initialStock, stockAfter: initialStock, note: 'Nhập kho khi tạo sản phẩm' },
      })
    }

    if (Array.isArray(listingChannelIds) && listingChannelIds.length > 0) {
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
