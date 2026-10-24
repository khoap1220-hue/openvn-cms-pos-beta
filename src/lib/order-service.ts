// Service tạo đơn dùng chung cho POS/API + Agent Simulator

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent } from '@/lib/agent-log'
import { logLedgerAsync, recordLineageChangeAsync, inferOriginSource } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import { issueComboComponents, syncComboStock } from '@/lib/combo'
import { friendlyItemsText } from '@/lib/agents'

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

  const orderItems: Array<{ productId: string; quantity: number; price: number; isCombo: boolean }> = []
  let subtotal = 0
  // (COMBO) gộp nhu cầu thành phần của toàn bộ combo trong đơn để kiểm tra kho 1 lần
  const comboDemands = new Map<string, { required: number; comboNames: Set<string> }>()
  for (const it of input.items) {
    const qty = Math.max(1, Number(it.quantity) || 1)
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) throw new Error('Sản phẩm không tồn tại')
    const isCombo = product.type === 'COMBO'
    if (isCombo) {
      const rows = await db.bomComponent.findMany({
        where: { productId: product.id },
        include: { componentProduct: { select: { id: true, name: true, stock: true } } },
      })
      if (rows.length === 0) throw new Error(`Combo "${product.name}" chưa khai báo thành phần ở Định mức`)
      for (const row of rows) {
        const required = row.quantity * qty
        const entry = comboDemands.get(row.componentProductId) ?? { required: 0, comboNames: new Set<string>() }
        entry.required += required
        entry.comboNames.add(product.name)
        comboDemands.set(row.componentProductId, entry)
        if (row.componentProduct.stock < required) {
          throw new Error(`Combo "${product.name}" không thể đóng — "${row.componentProduct.name}" chỉ còn ${row.componentProduct.stock}`)
        }
      }
    } else if (product.stock < qty) {
      throw new Error(`Sản phẩm "${product.name}" chỉ còn ${product.stock} trong kho`)
    }
    const listing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
    })
    const price = listing?.price ?? product.sellPrice
    subtotal += price * qty
    orderItems.push({ productId: product.id, quantity: qty, price, isCombo })
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
  // Phí sàn TMĐT: snapshot lúc tạo đơn (từ cấu hình % của kênh) — trừ khi đối soát để tính lợi nhuận thực nhận
  const platformFeePct = channel.feePercent
  const platformFee = Math.round((subtotal * platformFeePct) / 100)
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
      platformFeePct,
      platformFee,
      note: input.note?.trim() || null,
      address: input.address?.trim() || null,
      items: { create: orderItems.map(({ isCombo, ...rest }) => rest) },
    },
    include: {
      channel: { select: { id: true, key: true, name: true, color: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  })

  // Trừ kho + ghi biến động (lưu trữ vĩnh viễn)
  for (const it of orderItems) {
    if (it.isCombo) continue // COMBO: trừ kho thành phần (dưới), không trừ kho gộp
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (product) {
      const after = product.stock - it.quantity
      await db.product.update({ where: { id: product.id }, data: { stock: after } })
      await db.stockMovement.create({
        data: { productId: product.id, type: 'EXPORT', quantity: -it.quantity, stockAfter: after, note: `Xuất kho cho đơn ${code}` },
      })
    }
  }

  // COMBO/SET quà tặng: trừ kho từng thành phần × định mức + đồng bộ tồn hiển thị của combo
  if (comboDemands.size > 0) {
    await db.$transaction(async (tx) => {
      const issued = await issueComboComponents(
        tx,
        new Map([...comboDemands.entries()].map(([pid, e]) => [pid, e.required])),
        (componentName, qty) => `Trừ thành phần combo ${qty} ${componentName} cho đơn ${code}`
      )
      const comboIds = [...new Set(orderItems.filter((it) => it.isCombo).map((it) => it.productId))]
      for (const comboId of comboIds) await syncComboStock(tx, comboId)
      const warnings = issued.filter((r) => r.warning)
      if (warnings.length > 0) {
        await logLedgerAsync({
          scope: 'INVENTORY',
          action: 'COMBO_ISSUE_WARNING',
          entityType: 'Order',
          entityCode: code,
          title: `Đơn ${code}: trừ kho thành phần combo có cảnh báo`,
          detail: { warnings: warnings.map((w) => w.warning) },
          actor: 'SYSTEM',
        })
      }
    })
  }

  await logEvent(order.id, 'CREATED', 'SYSTEM', `Nhận đơn mới qua ${channel.name}`)
  const friendlyOrderItems = order.items.map((i) => ({ quantity: i.quantity, product: i.product }))
  const itemsSummary = friendlyItemsText(friendlyOrderItems)
  await logActivity({
    agent: 'SYSTEM',
    action: 'ORDER_RECEIVED',
    level: 'info',
    targetType: 'ORDER',
    targetId: order.id,
    targetLabel: order.code,
    message: `Khách ${order.customer?.name ?? 'lẻ'} vừa chốt ${itemsSummary} qua ${channel.name} — tổng ${(order.total).toLocaleString('vi-VN')}đ (${order.code})`,
  })
  broadcast('order.created', order)

  // Trí nhớ dài hạn: đơn mới → chắt lọc lại hồ sơ khách (contextSummary/preferences/painPoints)
  if (finalCustomerId) {
    const { refreshCustomerMemory } = await import('@/lib/memory-engine')
    refreshCustomerMemory(finalCustomerId, 'ORDER', `Đơn mới ${order.code}`).catch(() => null)
  }

  // Sổ Data + Webhook outbound (fire-and-forget) — chụp snapshot gốc đơn hàng (DATA LINEAGE)
  recordLineageChangeAsync({
    scope: 'ORDER',
    action: 'ORDER_CREATED',
    entityType: 'Order',
    entityId: order.id,
    entityCode: order.code,
    sourceRefCode: order.code,
    title: `Đơn ${order.code} — ${channel.name}`,
    after: {
      status: 'PENDING',
      paymentMethod: order.paymentMethod,
      paymentStatus: 'UNPAID',
      total: order.total,
      itemCount: order.items.length,
    },
    originSource: inferOriginSource({ channelKey: channel.key, actor: 'SYSTEM', action: 'ORDER_CREATED' }),
    actorName: 'Kênh bán',
    actor: 'SYSTEM',
    detail: { total: order.total, items: order.items.length, customer: order.customer?.name ?? 'Khách lẻ' },
  })
  dispatchWebhook('order.created', {
    id: order.id,
    code: order.code,
    channel: channel.key,
    total: order.total,
    customer: order.customer?.name ?? 'Khách lẻ',
    items: order.items.map((i) => ({ sku: i.product?.sku ?? null, name: i.product?.name ?? null, quantity: i.quantity, price: i.price })),
  })

  return order
}
