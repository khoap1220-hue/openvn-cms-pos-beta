import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view') || 'movements'
    const productId = searchParams.get('productId')

    if (view === 'lowstock') {
      const products = await db.product.findMany({
        where: { stock: { lte: db.product.fields.lowStockThreshold } },
        orderBy: { stock: 'asc' },
        select: { id: true, sku: true, name: true, stock: true, lowStockThreshold: true, sellPrice: true },
      })
      return NextResponse.json({ products })
    }

    const movements = await db.stockMovement.findMany({
      where: productId ? { productId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { product: { select: { id: true, sku: true, name: true, stock: true } } },
    })
    return NextResponse.json({ movements })
  } catch (error) {
    console.error('Inventory GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu kho' }, { status: 500 })
  }
}

// POST: nhập / xuất / điều chỉnh tồn kho
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { productId, type, quantity, note } = body

    if (!productId || !type) return NextResponse.json({ error: 'Thiếu thông tin sản phẩm hoặc loại thao tác' }, { status: 400 })
    if (!['IMPORT', 'EXPORT', 'ADJUST'].includes(type)) {
      return NextResponse.json({ error: 'Loại thao tác không hợp lệ' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })

    let newStock: number
    let movementQty: number

    if (type === 'IMPORT') {
      movementQty = Math.abs(Number(quantity) || 0)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      newStock = product.stock + movementQty
    } else if (type === 'EXPORT') {
      movementQty = Math.abs(Number(quantity) || 0)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      if (product.stock < movementQty) {
        return NextResponse.json({ error: `Chỉ còn ${product.stock} trong kho, không thể xuất ${movementQty}` }, { status: 400 })
      }
      newStock = product.stock - movementQty
      movementQty = -movementQty
    } else {
      // ADJUST: quantity là số lượng tồn mới (tuyệt đối)
      newStock = Number(quantity)
      if (Number.isNaN(newStock) || newStock < 0) return NextResponse.json({ error: 'Số lượng tồn mới không hợp lệ' }, { status: 400 })
      movementQty = newStock - product.stock
    }

    const finalNote = note?.trim() || (type === 'IMPORT' ? 'Nhập kho' : type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kiểm kê')
    await db.product.update({ where: { id: productId }, data: { stock: newStock } })
    const movement = await db.stockMovement.create({
      data: {
        productId,
        type,
        quantity: movementQty,
        stockAfter: newStock,
        note: finalNote,
      },
      include: { product: { select: { id: true, sku: true, name: true, stock: true } } },
    })

    // Sổ Data: biến động kho
    const action = type === 'IMPORT' ? 'STOCK_IMPORT' : type === 'EXPORT' ? 'STOCK_EXPORT' : 'STOCK_ADJUST'
    const qtyText = movementQty >= 0 ? `+${movementQty}` : `${movementQty}`
    const actionLabel = type === 'IMPORT' ? 'Nhập kho' : type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kho'
    await logLedger({
      scope: 'INVENTORY',
      action,
      entityType: 'Product',
      entityId: productId,
      entityCode: product.sku,
      title: `${actionLabel} ${product.sku} ${qtyText}`,
      detail: { stockAfter: newStock, note: finalNote },
      actor: 'OPERATOR',
    })

    // Webhook outbound: biến động tồn kho
    dispatchWebhook('stock.movement', { productId, sku: product.sku, type, quantity: movementQty, stockAfter: newStock })

    return NextResponse.json({ movement }, { status: 201 })
  } catch (error) {
    console.error('Inventory POST error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật kho' }, { status: 500 })
  }
}
