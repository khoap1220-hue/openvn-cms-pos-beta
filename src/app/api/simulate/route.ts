import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createOrder } from '@/lib/order-service'
import { sendZalo } from '@/lib/agent-log'
import { logLedgerAsync } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

const NEW_CUSTOMERS = [
  { name: 'Ngô Bảo Trân', phone: '0905123456' },
  { name: 'Hà Minh Quân', phone: '0357894321' },
  { name: 'Trương Mỹ Linh', phone: '0981239876' },
  { name: 'Võ Thanh Sơn', phone: '0365558899' },
]
const ADDRESSES = ['25 Nguyễn Huệ, Quận 1, TP. Hồ Chí Minh', '88 Trần Hưng Đạo, Hải An, Hải Phòng', '12 Phạm Ngũ Lão, Hoàn Kiếm, Hà Nội', '305 Cách Mạng Tháng Tám, Quận 10, TP. Hồ Chí Minh']

const QUESTIONS = [
  'Chào shop, cho mình hỏi mẫu áo sơ mi lụa còn size M không ạ?',
  'Đơn của mình bao giờ thì nhận được vậy shop?',
  'Shop có freeship không ạ, mình mua thêm vài món nữa?',
  'Mình nhận hàng rồi mà muốn đổi size thì làm thế nào ạ?',
  'Sản phẩm của shop có phải hàng chính hãng không ạ?',
  'Shop ơi, đơn của mình đang giao đến đâu rồi ạ?',
]

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { type?: string; channelKey?: string }
    const type = body.type

    if (type === 'zalo_order') {
      const zaloChannels = await db.channel.findMany({ where: { key: { in: ['ZALO_OA', 'ZALO_PERSONAL'] }, connected: true } })
      const filtered = body.channelKey ? zaloChannels.filter((c) => c.key === body.channelKey) : zaloChannels
      if (filtered.length === 0) {
        return NextResponse.json({ error: 'Chưa kết nối kênh Zalo này' }, { status: 400 })
      }
      const channel = filtered[Math.floor(Math.random() * filtered.length)]

      // Sản phẩm đang bán trên kênh Zalo đó
      const listings = await db.channelListing.findMany({
        where: { channelId: channel.id, product: { status: 'ACTIVE', stock: { gt: 0 } } },
        include: { product: true },
        take: 30,
      })
      if (listings.length === 0) {
        return NextResponse.json({ error: 'Chưa có sản phẩm nào trên kênh này' }, { status: 400 })
      }
      const shuffled = [...listings].sort(() => Math.random() - 0.5)
      const chosen = shuffled.slice(0, Math.random() > 0.6 ? 2 : 1)
      const items = chosen.map((l) => ({ productId: l.productId, quantity: 1 + Math.floor(Math.random() * 2) }))

      // Khách: 70% khách cũ có hội thoại, 30% khách mới
      const existingCustomers = await db.customer.findMany({ take: 30, orderBy: { createdAt: 'desc' } })
      const useExisting = existingCustomers.length > 0 && Math.random() < 0.7
      const picked: { id?: string; name: string; phone: string | null } = useExisting
        ? existingCustomers[Math.floor(Math.random() * existingCustomers.length)]
        : NEW_CUSTOMERS[Math.floor(Math.random() * NEW_CUSTOMERS.length)]

      const order = await createOrder({
        channelId: channel.id,
        items,
        customerId: useExisting ? picked.id : undefined,
        customerName: useExisting ? undefined : picked.name,
        customerPhone: useExisting ? undefined : (picked.phone ?? undefined),
        address: useExisting ? undefined : ADDRESSES[Math.floor(Math.random() * ADDRESSES.length)],
        paymentMethod: 'COD',
      })

      // Sổ Data: đơn mô phỏng
      logLedgerAsync({
        scope: 'ORDER',
        action: 'SIMULATED',
        entityType: 'Order',
        entityId: order.id,
        entityCode: order.code,
        title: `Mô phỏng đơn ${order.code} qua ${channel.name}`,
        detail: { channelKey: channel.key },
        actor: 'SYSTEM',
      })

      // Khách nhắn kèm trên Zalo → Agent Hỗ trợ sẽ tự trả lời
      await sendZalo({
        customerId: order.customerId ?? picked.id ?? '',
        channelKey: channel.key,
        content: `Chào shop, mình vừa đặt đơn ${order.code} trên ${channel.name} rồi nhé. Shop xác nhận giúp mình với ạ 🙏`,
        sender: 'CUSTOMER',
        relatedOrderId: order.id,
        isAuto: false,
      })

      return NextResponse.json({ order }, { status: 201 })
    }

    if (type === 'zalo_message') {
      const customers = await db.customer.findMany({ take: 30, orderBy: { createdAt: 'desc' } })
      if (customers.length === 0) {
        return NextResponse.json({ error: 'Chưa có khách hàng nào' }, { status: 400 })
      }
      const customer = customers[Math.floor(Math.random() * customers.length)]
      const channelKey = Math.random() < 0.6 ? 'ZALO_OA' : 'ZALO_PERSONAL'
      const message = await sendZalo({
        customerId: customer.id,
        channelKey,
        content: QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)],
        sender: 'CUSTOMER',
        isAuto: false,
      })
      return NextResponse.json({ message }, { status: 201 })
    }

    return NextResponse.json({ error: 'Loại mô phỏng không hợp lệ' }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể mô phỏng'
    console.error('Simulate error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
