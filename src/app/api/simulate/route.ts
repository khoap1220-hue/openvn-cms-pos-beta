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
  'Chào Ưu Đàm, cho mình hỏi hũ nến hoa sen còn hàng không ạ?',
  'Đơn của mình bao giờ thì nhận được vậy tiệm?',
  'Tiệm có freeship không ạ, mình mua thêm hũ trà nữa?',
  'Mình nhận nến rồi nhưng muốn đổi mùi hương thì làm thế nào ạ?',
  'Nến của tiệm thắp được bao nhiêu tiếng vậy ạ?',
  'Tiệm ơi, mình đang tự đổ nến thì nên dùng sáp nào ạ?',
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

    // ===== Khách gửi ảnh kèm tin nhắn (kịch bản test multimodal) =====
    if (type === 'zalo_image') {
      const scenario = (body as { scenario?: string }).scenario ?? 'praise_burn'
      const forcedId = (body as { customerId?: string }).customerId
      const customers = await db.customer.findMany({ take: 30, orderBy: { createdAt: 'desc' } })
      if (customers.length === 0) {
        return NextResponse.json({ error: 'Chưa có khách hàng nào' }, { status: 400 })
      }
      // Ưu tiên khách đúng kịch bản: nắp hở → khách từng góp ý nắp (Trân); còn lại khách quen bất kỳ
      const byName = (name: string) => customers.find((c) => c.name === name)
      const forced = forcedId ? customers.find((c) => c.id === forcedId) : undefined
      const customer =
        forced ??
        (scenario === 'lid_defect'
          ? byName('Ngô Bảo Trân') ?? customers[0]
          : scenario === 'diy_wax'
            ? byName('Hà Minh Quân') ?? customers[0]
            : customers[Math.floor(Math.random() * customers.length)])
      const channelKey = Math.random() < 0.6 ? 'ZALO_OA' : 'ZALO_PERSONAL'

      const OSS = (hash: string) => `https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/${hash}.jpg`
      const scenarios: Record<string, { imageUrl: string; content: string; analysis: string }> = {
        praise_burn: {
          imageUrl: OSS('a1aaeeb81709'), // hũ nến hoa sen đang thắp — góc đốt đẹp
          content: 'Nhìn góc đốt nến tối qua đẹp xỉu luôn á, bóng nến vàng ấm cả bàn ơi là xinh 😍',
          analysis: 'Ảnh chụp hũ nến hoa sen đang thắp trong góc decor tối, bóng nến vàng ấm lan trên mặt bàn gỗ, toàn cảnh ấm cúng, không có lỗi gì — khách chụp khoe góc đốt nến đẹp.',
        },
        lid_defect: {
          imageUrl: OSS('ecba3f9b86ea'), // hũ trà gốm nắp gỗ — kịch bản nắp chưa khít
          content: 'Mình vừa kiểm tra cái hũ trà thì thấy nắp gỗ nó bị hở một mạch, đóng lại không khít, có kẽ hở nhìn rõ luôn ấy ạ 😔',
          analysis: 'Ảnh chụp cận hũ trà gốm nắp gỗ: nắp gỗ đóng lệch, có kẽ hở rõ giữa nắp và miệng hũ — lỗi nắp chưa khít trên chính sản phẩm khách mua.',
        },
        find_similar: {
          imageUrl: OSS('4869e1f68625'), // bộ ấm trà gốm men lam — hỏi tìm mẫu tương tự
          content: 'Mình thấy cái ấm gốm như trong ảnh này xinh quá, shop có mẫu tương tự nào không ạ?',
          analysis: 'Ảnh chụp bộ ấm trà gốm men lam hoa văn cổ điển đặt cạnh chén trà — khách chụp mẫu tham khảo và muốn tiệm tư vấn sản phẩm tương tự đang bán.',
        },
      }
      const sc = scenarios[scenario] ?? scenarios.praise_burn

      const message = await sendZalo({
        customerId: customer.id,
        channelKey,
        content: sc.content,
        sender: 'CUSTOMER',
        isAuto: false,
        imageUrl: sc.imageUrl,
        imageAnalysis: sc.analysis,
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
