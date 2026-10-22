import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const order = await db.order.findUnique({
      where: { id },
      include: {
        channel: { select: { id: true, key: true, name: true, color: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
    })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })
    return NextResponse.json({ order })
  } catch (error) {
    console.error('Order GET error:', error)
    return NextResponse.json({ error: 'Không thể tải đơn hàng' }, { status: 500 })
  }
}

// PATCH: cập nhật trạng thái / thanh toán. Hủy đơn → hoàn kho.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { status, paymentStatus } = body

    const order = await db.order.findUnique({ where: { id }, include: { items: true } })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })

    const data: { status?: string; paymentStatus?: string } = {}
    if (status) {
      if (!['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'COMPLETED', 'CANCELLED'].includes(status)) {
        return NextResponse.json({ error: 'Trạng thái không hợp lệ' }, { status: 400 })
      }
      data.status = status
    }
    if (paymentStatus) data.paymentStatus = paymentStatus

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    // Hủy đơn: hoàn kho (chỉ khi đơn trước đó chưa bị hủy)
    const restocking = data.status === 'CANCELLED' && order.status !== 'CANCELLED'
    if (data.status === 'CANCELLED' && order.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Đơn hàng đã bị hủy trước đó' }, { status: 400 })
    }

    const updated = await db.order.update({ where: { id }, data })

    if (restocking) {
      for (const item of order.items) {
        const product = await db.product.findUnique({ where: { id: item.productId } })
        if (product) {
          const after = product.stock + item.quantity
          await db.product.update({ where: { id: product.id }, data: { stock: after } })
          await db.stockMovement.create({
            data: { productId: product.id, type: 'IMPORT', quantity: item.quantity, stockAfter: after, note: `Hoàn kho do hủy đơn ${order.code}` },
          })
        }
      }
    }

    // Đơn hoàn thành → tự đánh dấu đã thanh toán (nếu chưa)
    if (data.status === 'COMPLETED' && order.paymentStatus !== 'PAID') {
      await db.order.update({ where: { id }, data: { paymentStatus: 'PAID' } })
    }

    return NextResponse.json({ order: updated })
  } catch (error) {
    console.error('Order PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật đơn hàng' }, { status: 500 })
  }
}
