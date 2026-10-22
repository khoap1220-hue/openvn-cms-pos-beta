// Service tạo đơn dùng chung cho POS/API + Agent Simulator

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent } from '@/lib/agent-log'

export interface CreateOrderInput {
  channelId: string
  items: Array<{ productId: string; quantity: number }>
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  address?: string
  note?: string
  paymentMethod?: string
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.channelId) throw new Error('Vui lòng chọn kênh bán')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Đơn hàng cần ít nhất 1 sản phẩm')
  }

  const channel = await db.channel.findUnique({ where: { id: input.channelId } })
  if (!channel) throw new Error('Kênh bán không tồn tại')

  const orderItems: Array<{ productId: string; quantity: number; price: number }> = []
  let subtotal = 0
  for (const it of input.items) {
    const qty = Math.max(1, Number(it.quantity) || 1)
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) throw new Error('Sản phẩm không tồn tại')
    if (product.stock < qty) {
      throw new Error(`Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`)
    }
    const listing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
    })
    const price = listing?.price ?? product.sellPrice
    subtotal += price * qty
    orderItems.push({ productId: product.id, quantity: qty, price })
  }

  let finalCustomerId: string | null = input.customerId || null
  if (!finalCustomerId && input.customerName?.trim()) {
    const customer = await db.customer.create({
      data: {
        name: input.customerName.trim(),
        phone: input.customerPhone?.trim() || null,
        email: input.customerEmail?.trim() || null,
        address: input.address?.trim() || null,
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
      channelId: channel.id,
      customerId: finalCustomerId,
      status: 'PENDING',
      paymentMethod: input.paymentMethod || 'COD',
      paymentStatus: 'UNPAID',
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      note: input.note?.trim() || null,
      address: input.address?.trim() || null,
      items: { create: orderItems },
    },
    include: {
      channel: { select: { id: true, key: true, name: true, color: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  })

  // Trừ kho + ghi biến động (lưu trữ vĩnh viễn)
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

  await logEvent(order.id, 'CREATED', 'SYSTEM', `Nhận đơn mới qua ${channel.name}`)
  await logActivity({
    agent: 'SYSTEM',
    action: 'ORDER_RECEIVED',
    level: 'info',
    targetType: 'ORDER',
    targetId: order.id,
    targetLabel: order.code,
    message: `Nhận đơn mới ${order.code} qua ${channel.name} — ${order.customer?.name ?? 'Khách lẻ'}, tổng ${(order.total).toLocaleString('vi-VN')}đ`,
  })
  broadcast('order.created', order)

  return order
}
