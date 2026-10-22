import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()
    const status = searchParams.get('status')
    const channelId = searchParams.get('channelId')
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 15))

    const where: Record<string, unknown> = {}
    if (status && status !== 'ALL') where.status = status
    if (channelId && channelId !== 'ALL') where.channelId = channelId
    if (search) {
      where.OR = [{ code: { contains: search } }, { customer: { is: { name: { contains: search } } } }, { customer: { is: { phone: { contains: search } } } }]
    }

    const [total, orders] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      }),
    ])

    return NextResponse.json({ orders, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  } catch (error) {
    console.error('Orders GET error:', error)
    return NextResponse.json({ error: 'Không thể tải đơn hàng' }, { status: 500 })
  }
}

// POST: tạo đơn thủ công (POS / Facebook) — trừ kho + ghi biến động
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { channelId, customerId, customerName, customerPhone, address, note, paymentMethod, items } = body

    if (!channelId) return NextResponse.json({ error: 'Vui lòng chọn kênh bán' }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Đơn hàng cần ít nhất 1 sản phẩm' }, { status: 400 })
    }

    const channel = await db.channel.findUnique({ where: { id: channelId } })
    if (!channel) return NextResponse.json({ error: 'Kênh bán không tồn tại' }, { status: 404 })

    // Lấy thông tin sản phẩm + kiểm tra tồn kho
    const orderItems: Array<{ productId: string; quantity: number; price: number }> = []
    let subtotal = 0
    for (const it of items) {
      const qty = Number(it.quantity) || 1
      if (qty <= 0) continue
      const product = await db.product.findUnique({ where: { id: it.productId } })
      if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })
      if (product.stock < qty) {
        return NextResponse.json({ error: `Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho` }, { status: 400 })
      }
      const listing = await db.channelListing.findUnique({ where: { productId_channelId: { productId: product.id, channelId } } })
      const price = listing?.price ?? product.sellPrice
      subtotal += price * qty
      orderItems.push({ productId: product.id, quantity: qty, price })
    }

    // Tạo/tìm khách hàng
    let finalCustomerId: string | null = customerId || null
    if (!finalCustomerId && customerName?.trim()) {
      const customer = await db.customer.create({
        data: {
          name: customerName.trim(),
          phone: customerPhone?.trim() || null,
          address: address?.trim() || null,
        },
      })
      finalCustomerId = customer.id
    }

    const shippingFee = subtotal >= 500000 ? 0 : 30000
    const now = new Date()
    const code = `DH${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`

    const order = await db.order.create({
      data: {
        code,
        channelId,
        customerId: finalCustomerId,
        status: 'PENDING',
        paymentMethod: paymentMethod || 'COD',
        paymentStatus: 'UNPAID',
        subtotal,
        shippingFee,
        total: subtotal + shippingFee,
        note: note?.trim() || null,
        address: address?.trim() || null,
        items: { create: orderItems },
      },
      include: {
        channel: { select: { id: true, key: true, name: true, color: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true } } } },
      },
    })

    // Trừ kho + ghi biến động
    for (const it of orderItems) {
      const product = await db.product.findUnique({ where: { id: it.productId } })
      if (product) {
        const after = product.stock - it.quantity
        await db.product.update({ where: { id: product.id }, data: { stock: after } })
        await db.stockMovement.create({
          data: { productId: product.id, type: 'EXPORT', quantity: -it.quantity, stockAfter: after, note: `Xuất kho cho đơn ${code}` },
        })
      }
    }

    return NextResponse.json({ order }, { status: 201 })
  } catch (error) {
    console.error('Orders POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo đơn hàng' }, { status: 500 })
  }
}
