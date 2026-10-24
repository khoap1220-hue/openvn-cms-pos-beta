/**
 * SEED "TRÍ NHỚ DÀI HẠN + 100% ANTI-AI" cho toàn hệ thống Agent & Khách hàng.
 *  1) Gieo dữ liệu ngữ cảnh: Trân góp ý "nắp gỗ chưa khít" (review 4⭐ + tin nhắn khách),
 *     Quân nhắn "tự đổ nến DIY" — để memory engine bắt painPoint / preference.
 *  2) Backfill 100% khách: salutation + avatar (DiceBear) + inferredProfile + chắt lọc
 *     contextSummary/preferences/painPoints/nextFollowUp (memory-engine, ghi Sổ Data).
 *  3) Viết lại toàn bộ Nhật ký hoạt động Agent (AgentActivity) + tin nhắn AGENT trong
 *     Hộp thư Zalo sang giọng người thật của tiệm Ưu Đàm (100% Anti-AI).
 *
 * Chạy: bun scripts/seed-memory-upgrade.ts  (idempotent — chạy lại không nhân bản)
 */
import { PrismaClient } from '@prisma/client'
import { analyzeCustomerName, defaultAvatarUrl, friendlyProductName, friendlyItemsText, sanitizeVoice } from '../src/lib/agent-voice'

const db = new PrismaClient()

// Dùng memory-engine thật của app (bun hiểu tsconfig paths "@/*")
async function engine() {
  const mod = await import('../src/lib/memory-engine')
  return mod
}

async function main() {
  const { refreshCustomerMemory } = await engine()

  // ============ 1) Gieo dữ liệu ngữ cảnh (pain point / DIY) ============
  console.log('== 1) Gieo dữ liệu ngữ cảnh khách ==')
  const tran = await db.customer.findFirst({ where: { name: 'Ngô Bảo Trân' } })
  if (tran) {
    const order = await db.order.findFirst({ where: { customerId: tran.id }, include: { items: { include: { product: true } } } })
    if (order) {
      await db.order.update({
        where: { id: order.id },
        data: {
          reviewRating: 4,
          reviewComment: 'Hũ trà gốm đẹp, đựng trà sang. Riêng nắp gỗ chưa khít lắm, đóng lại cứ bị hở một mạch nhẹ ạ.',
        },
      })
      console.log(`   Đã gieo review 4⭐ góp ý nắp gỗ cho ${tran.name} (${order.code})`)
    }
    // Tin nhắn khách mô tả kỹ lỗi (agent reply sau này sẽ xin lỗi đúng lỗi + bù quà)
    const hasPainMsg = await db.directMessage.findFirst({ where: { customerId: tran.id, sender: 'CUSTOMER', content: { contains: 'nắp' } } })
    if (!hasPainMsg) {
      await db.directMessage.create({
        data: {
          customerId: tran.id,
          channelKey: 'ZALO_OA',
          sender: 'CUSTOMER',
          content: 'Mình nhận hũ trà rồi, nến/gốm thì đẹp nhưng nắp gỗ nó chưa khít lắm, đóng lại bị hở nhẹ một mạch. Lần sau tiệm kiểm tra kỹ giúp mình nha.',
          isAuto: false,
          createdAt: new Date(Date.now() - 3600_000),
        },
      })
      console.log(`   Đã gieo tin nhắn Zalo góp ý nắp gỗ của ${tran.name}`)
    }
  }

  const quan = await db.customer.findFirst({ where: { name: 'Hà Minh Quân' } })
  if (quan) {
    const hasDiyMsg = await db.directMessage.findFirst({ where: { customerId: quan.id, sender: 'CUSTOMER', content: { contains: 'tự đổ' } } })
    if (!hasDiyMsg) {
      await db.directMessage.create({
        data: {
          customerId: quan.id,
          channelKey: 'ZALO_OA',
          sender: 'CUSTOMER',
          content: 'Tiệm ơi, mình đang tự đổ nến ở nhà, mẻ đầu tay dùng sáp đậu nành của tiệm + bấc cotton, hôm nay cháy thử thấy ổn lắm. Sắp hết sáp chắc phải mua tiếp quá 😄',
          isAuto: false,
          createdAt: new Date(Date.now() - 7200_000),
        },
      })
      console.log(`   Đã gieo tin nhắn DIY của ${quan.name}`)
    }
  }

  // Dọn luôn các tin nhắn khách/nhận xét còn ngữ cảnh thời trang cũ → ngữ cảnh nến/trà/gốm
  const oldContextMsgs = await db.directMessage.findMany({ where: { sender: 'CUSTOMER', OR: [{ content: { contains: 'áo' } }, { content: { contains: 'size' } }, { content: { contains: 'đường may' } }, { content: { contains: 'quần' } }, { content: { contains: 'giày' } }, { content: { contains: 'serum' } }, { content: { contains: 'chính hãng' } }] } })
  for (const m of oldContextMsgs) {
    const mapped = m.content
      .replace(/mẫu áo sơ mi lụa còn size M/i, 'hũ nến hoa sen còn hàng')
      .replace(/muốn đổi size/i, 'muốn đổi mùi hương')
      .replace(/hàng chính hãng/i, 'nến cháy được bao nhiêu tiếng')
      .replace(/Sản phẩm bị lỗi đường may sau 3 ngày sử dụng/i, 'Hộp đựng bị móp nhẹ lúc ship, hàng bên trong vẫn ổn')
      .replace(/Chất liệu áo lụa mềm mại, form dáng đẹp, giao hàng siêu nhanh/i, 'Set quà trà sơn thủy đóng hộp rất sang, người nhận mê lắm')
      .replace(/Chất lượng quần jeans rất tốt, vải dày dặn đường may đẹp/i, 'Sáp đậu nành cháy sạch, không bám muội — đổ nến đạt luôn')
      .replace(/Giày chất lượng tốt giao hàng siêu nhanh, rất hài lòng với sản phẩm/i, 'Khối sáp tinh khiết thơm nhẹ, giao nhanh đóng gói kỹ')
    if (mapped !== m.content) {
      await db.directMessage.update({ where: { id: m.id }, data: { content: mapped } })
    }
  }
  if (oldContextMsgs.length > 0) console.log(`   Đã chuyển ${oldContextMsgs.length} tin nhắn khách sang ngữ cảnh Ưu Đàm`)
  const quanReview = quan ? await db.order.findFirst({ where: { customerId: quan.id, reviewComment: { contains: 'áo lụa' } } }) : null
  if (quanReview) {
    await db.order.update({ where: { id: quanReview.id }, data: { reviewComment: 'Set quà trà sơn thủy đóng hộp rất sang, người nhận mê lắm. Giao nhanh nữa chứ.' } })
    console.log(`   Đã chuyển nhận xét cũ của ${quan?.name} sang ngữ cảnh set quà`)
  }

  // ============ 2) Backfill toàn bộ khách hàng ============
  console.log('== 2) Backfill chân dung + trí nhớ cho toàn bộ khách ==')
  const customers = await db.customer.findMany({ orderBy: { createdAt: 'asc' } })
  let profiled = 0
  for (const c of customers) {
    const p = analyzeCustomerName(c.name)
    const data: Record<string, string | Date> = {}
    if (!c.avatarUrl) data.avatarUrl = defaultAvatarUrl(c.name)
    if (!c.salutation) data.salutation = p.salutation
    if (Object.keys(data).length > 0) {
      await db.customer.update({ where: { id: c.id }, data })
      profiled++
    }
    await refreshCustomerMemory(c.id, 'MANUAL', 'Seed trí nhớ dài hạn toàn tiệm').catch((e) => console.error(`   ${c.name}:`, e))
  }
  console.log(`   Đã dựng avatar/xưng hô cho ${profiled}/${customers.length} khách + chắt lọc trí nhớ`)

  // ============ 3) Viết lại Nhật ký hoạt động Agent (giọng Ưu Đàm) ============
  console.log('== 3) Viết lại Nhật ký hoạt động Agent ==')
  const activities = await db.agentActivity.findMany({ orderBy: { createdAt: 'asc' } })
  let rewrote = 0

  // cache đơn theo id
  const orderCache = new Map<string, { code: string; items: Array<{ quantity: number; product: { name: string; sku: string } | null }>; customerName: string | null; carrier?: string } | null>()
  async function loadOrder(orderId: string | null) {
    if (!orderId) return null
    if (orderCache.has(orderId)) return orderCache.get(orderId)
    const o = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: { select: { name: true, sku: true } } } }, customer: { select: { name: true } }, shipments: { select: { carrier: true }, take: 1 } },
    })
    const val = o
      ? {
          code: o.code,
          items: o.items.map((i) => ({ quantity: i.quantity, product: i.product ? { name: i.product.name, sku: i.product.sku ?? '' } : null })),
          customerName: o.customer?.name ?? null,
          carrier: o.shipments[0]?.carrier,
        }
      : null
    orderCache.set(orderId, val)
    return val
  }

  for (const a of activities) {
    let message = a.message
    let detail = a.detail
    const order = await loadOrder(a.targetType === 'ORDER' ? a.targetId : null)
    const itemsText = order ? friendlyItemsText(order.items) : ''
    const who = order?.customerName ?? a.targetLabel ?? 'khách'
    const profile = who && who !== 'khách' ? analyzeCustomerName(who) : null
    const call = profile ? `${profile.title === 'Anh' ? 'anh' : 'chị'} ${profile.givenName}` : 'khách'

    switch (a.action) {
      case 'ORDER_RECEIVED': {
        const m = a.message.match(/tổng ([\d.,]+)đ/)
        const total = m ? m[1] : ''
        message = `Khách ${order?.customerName ?? 'lẻ'} vừa chốt ${itemsText || 'hàng'} qua ${extractChannel(a.message)} — tổng ${total}đ (${order?.code ?? a.targetLabel ?? ''})`
        break
      }
      case 'CONFIRM_ORDER':
        message = `Chốt ${itemsText || 'đơn hàng'} cho ${call} — nhắn Zalo xác nhận xong, gói hàng liền (${order?.code ?? a.targetLabel ?? ''})`
        if (order) detail = sanitizeVoice(`Dạ ${call} ơi, đơn mình chốt ${itemsText} nha. Tụi em gói xong là giao bên ship luôn đó ạ.`)
        break
      case 'START_PACKING':
        message = `Vào gói ${itemsText || 'đơn hàng'} cho ${call}${/gốm|nến|thủy tinh/i.test(itemsText) ? ' — bọc mút kỹ mấy món dễ vỡ' : ''} (${order?.code ?? a.targetLabel ?? ''})`
        break
      case 'NOTIFY_CARRIER': {
        const tracking = a.message.match(/\b((GHN|GHTK|VIETTEL|JT|NINJA)\w{6,15})\b/)?.[1] ?? (typeof a.detail === 'string' ? a.detail.match(/\b((GHN|GHTK|VIETTEL|JT|NINJA)\w{6,15})\b/)?.[1] : undefined)
        const carrier = extractCarrierName(a.message) ?? 'đơn vị vận chuyển'
        message = `Gói xong ${itemsText || 'đơn hàng'} → gọi ${carrier} qua lấy luôn cho ${call}${tracking ? `, mã vận đơn ${tracking}` : ''}`
        if (order && tracking) detail = sanitizeVoice(`${call} ơi, ${itemsText} của mình đã gói cẩn thận (nến/gốm thì bọc mút kỹ nha) và giao cho ${carrier} rồi 📦 Mã theo dõi: ${tracking}. Có gì báo tụi em một tiếng nhé!`)
        break
      }
      case 'PICKUP': {
        const carrier = extractCarrierName(a.message) ?? 'Shipper'
        message = `${carrier} nhận hàng rồi — đơn ${order?.code ?? a.targetLabel ?? ''} của ${call} lên đường giao`
        break
      }
      case 'IN_TRANSIT':
        message = `Hàng đang lăn bánh tới nhà ${call} (${order?.code ?? a.targetLabel ?? ''}) — có cập nhật là báo ngay`
        break
      case 'DELIVERY_NOTICE': {
        const carrier = extractCarrierName(a.message) ?? 'shipper'
        message = `Tới nơi rồi! Giao thành công ${order?.code ?? a.targetLabel ?? ''} cho ${call} qua ${carrier} — COD về sạch, hoàn tất vòng đời đơn`
        break
      }
      case 'CARE_MESSAGE':
        message = `Nhắn thăm ${call} sau khi ${itemsText || 'hàng'} tới nhà (${order?.code ?? a.targetLabel ?? ''})`
        if (order) detail = sanitizeVoice(`Dạ ${itemsText} đã tới nhà ${call} rồi. Thích ghê — thắp nến hay pha trà cũng ấm cả nhà đó ạ. Dùng thấy ổn thì kể tụi em nghe với nha ❤️`)
        break
      case 'REQUEST_REVIEW':
        message = `Nhờ ${call} chấm sao cho ${itemsText || 'đơn hàng'} (${order?.code ?? a.targetLabel ?? ''})`
        if (order) detail = sanitizeVoice(`${call} ơi, ${itemsText} ổn không mình nhỉ? Nếu tiện thì chấm vài sao + viết vài chữ cho tụi em với nha 🙏 — mấy dòng của mình là gạch vàng để tiệm giữ lửa làm hàng đẹp hơn đó ạ.`)
        break
      case 'REVIEW_RECEIVED': {
        const rating = a.message.match(/(\d)⭐/)?.[1] ?? '5'
        message = `${order?.customerName ?? who} thả ${rating}⭐ khen ${itemsText || 'hàng'} (${order?.code ?? a.targetLabel ?? ''})`
        break
      }
      case 'AUTO_REPLY':
        message = `Tự động trả lời ${call} bằng giọng chủ tiệm (Zalo)`
        if (typeof a.detail === 'string' && a.detail.trim()) {
          detail = sanitizeVoice(`Dạ ${call} cần tư vấn mùi hương, trà gốm hay kiểm tra đơn thì nói rõ giúp tụi em, em hỗ trợ liền nha 🙏`)
        }
        break
      case 'MANUAL_ACTION':
      default:
        // giữ nguyên (thao tác của người vận hành, giọng người sẵn)
        break
    }

    if (message !== a.message || detail !== a.detail) {
      await db.agentActivity.update({ where: { id: a.id }, data: { message, detail: detail ?? null } })
      rewrote++
    }
  }
  console.log(`   Đã viết lại ${rewrote}/${activities.length} dòng Nhật ký Agent`)

  // ============ 4) Viết lại tin nhắn AGENT trong Hộp thư Zalo ============
  console.log('== 4) Viết lại tin nhắn Agent trong Hộp thư Zalo ==')
  const agentMsgs = await db.directMessage.findMany({
    where: { sender: 'AGENT' },
    orderBy: { createdAt: 'asc' },
    include: { customer: { select: { id: true, name: true, salutation: true } } },
  })
  let msgsRewrote = 0
  for (const m of agentMsgs) {
    const c = m.customer
    if (!c) continue
    const profile = analyzeCustomerName(c.name)
    const call = `${profile.title === 'Anh' ? 'anh' : 'chị'} ${profile.givenName}`
    const order = m.relatedOrderId ? await loadOrder(m.relatedOrderId) : null
    const itemsText = order ? friendlyItemsText(order.items) : 'đơn hàng'

    let content: string | null = null
    const old = m.content
    if (/xác nhận đơn/.test(old)) {
      const total = old.match(/Tổng thanh toán: ([\d.,]+đ)/)?.[1]
      content = sanitizeVoice(`Dạ ${call} ơi, đơn mình chốt ${itemsText}${total ? ` tổng ${total}` : ''} nha. Tụi em gói xong là giao bên ship luôn đó ạ.`)
    } else if (/đã được đóng gói xong và bàn giao/.test(old)) {
      const carrier = extractCarrierName(old) ?? 'đơn vị vận chuyển'
      const tracking = old.match(/\b((?:GHN|GHTK|VIETTEL|JT|NINJA)\d{12,15})\b/)?.[1]
      content = sanitizeVoice(`${call} ơi, ${itemsText} của mình đã gói cẩn thận (nến/gốm thì bọc mút kỹ nha) và giao cho ${carrier} rồi 📦${tracking ? ` Mã theo dõi: ${tracking}.` : ''} Có gì báo tụi em một tiếng nhé!`)
    } else if (/đã đến lấy hàng/.test(old)) {
      const carrier = extractCarrierName(old) ?? 'Shipper'
      content = sanitizeVoice(`Dạ ${carrier} qua lấy ${itemsText} rồi đó ạ. ${call} để ý điện thoại trong hôm nay với ngày mai là shipper gọi, nghe máy giúp tụi em nha 🙏`)
    } else if (/đang trên đường giao/.test(old)) {
      content = sanitizeVoice(`${itemsText} đang trên đường tới nhà mình rồi nha ${call}. Gần tới tụi em báo ngay đó ạ 🚚`)
    } else if (/đã giao thành công 🎉/.test(old)) {
      content = sanitizeVoice(`Dạ ${itemsText} đã tới nhà ${call} rồi. Thích ghê — thắp nến hay pha trà cũng ấm cả nhà đó ạ. Dùng thấy ổn thì kể tụi em nghe với nha ❤️`)
    } else if (/đánh giá sản phẩm & dịch vụ|đánh giá \(sao\)/.test(old)) {
      content = sanitizeVoice(`${call} ơi, ${itemsText} ổn không mình nhỉ? Nếu tiện thì chấm vài sao + viết vài chữ cho tụi em với nha 🙏 — mấy dòng của mình là gạch vàng để tiệm giữ lửa làm hàng đẹp hơn đó ạ.`)
    } else if (/freeship/.test(old)) {
      content = sanitizeVoice(`Dạ đơn từ 500k tụi em freeship luôn nha ${call}. Thêm hũ nến hay bình trà nữa là được miễn phí giao hàng liền đó ạ 📦`)
    } else if (/còn hàng đầy đủ/.test(old)) {
      content = sanitizeVoice(`Dạ món mình hỏi vẫn còn hàng đầy đủ đó ${call} ạ. Chốt đơn là tụi em gói gửi ngay trong hôm nay nha!`)
    } else if (/đổi trả trong 7 ngày/.test(old)) {
      content = sanitizeVoice(`Dạ trong 7 ngày kể từ ngày nhận hàng tụi em hỗ trợ đổi/đổi mẫu hết nha ${call}. Mình nhắn kèm ảnh món hàng để tụi em xem rồi xử ngay cho nhanh ạ 🙏`)
    } else if (/cảm ơn|ủng hộ|hân hạnh|tin tưởng|giữ lửa/.test(old)) {
      content = sanitizeVoice(`Dạ tụi em cảm ơn ${call} nhiều lắm, có mình ủng hộ là tiệm giữ lửa nến cứ cháy đều đều đó ạ ❤️ Cần gì nhắn em một tiếng nha!`)
    } else if (/cần tư vấn mùi hương/.test(old)) {
      content = sanitizeVoice(`Dạ ${call} cần tư vấn mùi hương, trà gốm hay kiểm tra đơn thì nói rõ giúp tụi em, em hỗ trợ liền nha 🙏`)
    } else if (/OmniSales|shop|quý khách/.test(old)) {
      content = sanitizeVoice(`Dạ ${call} cần tư vấn mùi hương, trà gốm hay kiểm tra đơn thì nói rõ giúp tụi em, em hỗ trợ liền nha 🙏`)
    }

    if (content && content !== old) {
      await db.directMessage.update({ where: { id: m.id }, data: { content } })
      msgsRewrote++
    }
  }
  console.log(`   Đã viết lại ${msgsRewrote}/${agentMsgs.length} tin nhắn Agent`)

  // ============ 5) Rà lọc Anti-AI lần cuối toàn bộ văn bản do Agent tạo ============
  console.log('== 5) Rà lọc Anti-AI lần cuối (Shop→tụi em, banned, mã đơn, emoji) ==')
  let voiceFixed = 0
  for (const m of await db.directMessage.findMany({ where: { sender: 'AGENT' } })) {
    const fixed = sanitizeVoice(m.content)
    if (fixed !== m.content) {
      await db.directMessage.update({ where: { id: m.id }, data: { content: fixed } })
      voiceFixed++
    }
  }
  let actFixed = 0
  for (const a of await db.agentActivity.findMany()) {
    // Nhật ký là văn bản NỘI BỘ cho người vận hành — GIỮ mã đơn để tra cứu, chỉ lọc từ ngữ sáo rỗng
    const fixedMsg = sanitizeVoice(a.message, { keepOrderCodes: true })
    const fixedDetail = a.detail ? sanitizeVoice(a.detail, { keepOrderCodes: true }) : a.detail
    if (fixedMsg !== a.message || fixedDetail !== a.detail) {
      await db.agentActivity.update({ where: { id: a.id }, data: { message: fixedMsg, detail: fixedDetail } })
      actFixed++
    }
  }
  console.log(`   Đã lọc thêm ${voiceFixed} tin nhắn + ${actFixed} dòng nhật ký`)

  // ============ 6) Khôi phục mã đơn trong nhật ký (tham chiếu vận hành) ============
  console.log('== 6) Khôi phục mã đơn trong Nhật ký nội bộ ==')
  let codesRestored = 0
  const actsToFix = await db.agentActivity.findMany({ where: { targetType: 'ORDER', targetId: { not: null } } })
  for (const a of actsToFix) {
    if (!a.message.includes('đơn mình vừa chốt')) continue
    const o = await db.order.findUnique({ where: { id: a.targetId! }, select: { code: true } })
    if (!o) continue
    const fixed = a.message.replaceAll('đơn mình vừa chốt', o.code)
    await db.agentActivity.update({ where: { id: a.id }, data: { message: fixed } })
    codesRestored++
  }
  console.log(`   Đã khôi phục mã cho ${codesRestored} dòng nhật ký`)

  // Sổ Data: tổng kết lần seed
  await db.ledgerEntry.create({
    data: {
      scope: 'CUSTOMER',
      action: 'MEMORY_SYSTEM_SEEDED',
      entityType: 'SYSTEM',
      entityCode: 'UUDAM.VN',
      title: 'Khởi động hệ thống Trí nhớ dài hạn + giọng Ưu Đàm 100% Anti-AI cho toàn bộ Agent',
      detail: JSON.stringify({
        customersProfiled: profiled,
        totalCustomers: customers.length,
        agentActivityRewritten: rewrote,
        agentMessagesRewritten: msgsRewrote,
      }),
      actor: 'OPERATOR',
    },
  })
  console.log('DONE ✔')
}

function extractChannel(msg: string): string {
  const m = msg.match(/qua (Zalo OA|Zalo cá nhân|Shopee|Lazada|TikTok Shop|Website|Facebook|Tiki|POS)/)
  return m ? m[1] : 'kênh bán'
}

function extractCarrierName(text: string): string | null {
  for (const name of ['Giao Hàng Nhanh', 'Giao Hàng Tiết Kiệm', 'Viettel Post', 'J&T Express', 'Ninja Van']) {
    if (text.includes(name)) return name
  }
  return null
}

main()
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
