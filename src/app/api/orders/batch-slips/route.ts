import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { carrierName } from '@/lib/agents'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Danh sách mã đơn hàng không hợp lệ' }, { status: 400 })
    }

    if (!body || !Array.isArray(body.orderIds) || body.orderIds.length === 0) {
      return NextResponse.json({ error: 'Danh sách mã đơn hàng không hợp lệ' }, { status: 400 })
    }

    const orderIds = body.orderIds as string[]

    const orders = await db.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        channel: { select: { id: true, key: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                barcode: true,
                fragile: true,
              },
            },
          },
        },
        shipments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    })

    // Giữ đúng thứ tự của orderIds được yêu cầu
    const orderMap = new Map(orders.map((o) => [o.id, o]))

    const slips = orderIds
      .map((id) => orderMap.get(id))
      .filter((order): order is NonNullable<typeof order> => Boolean(order))
      .map((order) => {
        const hasFragile = order.items.some((it) => it.product?.fragile === true)
        const activeShipment = order.shipments?.[0]
        const carrier = activeShipment ? carrierName(activeShipment.carrier) : 'Giao Hàng Nhanh (GHN)'
        const trackingCode = activeShipment?.trackingCode ?? order.code
        const codAmount = order.paymentMethod === 'COD' && order.paymentStatus !== 'PAID' ? order.total : 0

        return {
          orderId: order.id,
          orderCode: order.code,
          createdAt: order.createdAt,
          hasFragile,
          sender: {
            name: 'OPENVN · Kho Ưu Đàm',
            phone: '0901 234 567',
            address: 'Kho Trung Tâm Ưu Đàm, Hà Nội',
          },
          recipient: {
            name: order.customer?.name ?? 'Khách lẻ',
            phone: order.customer?.phone ?? '—',
            address: order.address ?? 'Nhận tại quầy / Kho',
          },
          carrier,
          trackingCode,
          items: order.items.map((it) => ({
            productId: it.productId,
            name: it.product?.name ?? 'Sản phẩm',
            sku: it.product?.sku ?? '—',
            barcode: it.product?.barcode ?? null,
            quantity: it.quantity,
            price: it.price,
            fragile: Boolean(it.product?.fragile),
          })),
          subtotal: order.subtotal,
          shippingFee: order.shippingFee,
          discountAmount: order.discountAmount,
          total: order.total,
          codAmount,
          paymentMethod: order.paymentMethod,
          paymentStatus: order.paymentStatus,
          note: order.note,
        }
      })

    return NextResponse.json({
      success: true,
      slips,
      count: slips.length,
    })
  } catch (err) {
    console.error('Batch slips error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không thể tạo dữ liệu phiếu giao hàng hàng loạt' },
      { status: 500 }
    )
  }
}
