// ===== Agent Autopilot Engine =====
// State machine chạy theo tick 2.5s, xử lý 100% quy trình bán hàng:
//   Đơn mới → Xác nhận (Zalo) → Soạn hàng → Báo ĐVVC → Lấy hàng →
//   Đang giao → Đã giao → Chăm sóc → Xin đánh giá → Nhận đánh giá
// Mọi bước đều lưu vĩnh viễn vào SQLite (AgentActivity / OrderEvent / DirectMessage)
// và broadcast realtime qua socket.io mini-service.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { llmChat } from '@/lib/llm'
import {
  AGENTS,
  AUTOMATION_DEFS,
  DEFAULT_SETTINGS,
  carrierName,
  makeTrackingCode,
  pickCarrier,
  tCare,
  tAutoReply,
  tCarrier,
  tConfirm,
  tPickup,
  tReviewRequest,
  tTransit,
  zaloKeyOf,
} from '@/lib/agents'
import { logActivity, logEvent, sendZalo } from '@/lib/agent-log'

const g = globalThis as unknown as {
  __cmsEngineTimer?: ReturnType<typeof setInterval>
  __cmsEngineBusy?: boolean
}

// Chống xử lý trùng lặp khi LLM đang chạy
const inflight = new Set<string>()
function once(key: string, fn: () => Promise<void>) {
  if (inflight.has(key)) return
  inflight.add(key)
  fn()
    .catch((e) => console.error(`[Engine] ${key}:`, e))
    .finally(() => inflight.delete(key))
}

export async function getSettingsMap(): Promise<Record<string, boolean>> {
  const map: Record<string, boolean> = { ...DEFAULT_SETTINGS }
  try {
    const rows = await db.automationSetting.findMany()
    for (const r of rows) map[r.key] = r.enabled
  } catch {
    // DB chưa sẵn sàng — dùng mặc định
  }
  return map
}

export async function setSetting(key: string, enabled: boolean) {
  await db.automationSetting.upsert({
    where: { key },
    update: { enabled },
    create: { key, enabled },
  })
  broadcast('settings.updated', { key, enabled })
  const def = AUTOMATION_DEFS.find((d) => d.key === key)
  if (def) {
    await logActivity({
      agent: 'SYSTEM',
      action: 'MANUAL_ACTION',
      level: enabled ? 'success' : 'warning',
      message: `Người vận hành đã ${enabled ? 'BẬT' : 'TẮT'} chế độ «${def.label}»`,
    })
  }
}

const LLM_SYS_ZALO =
  'Bạn là nhân viên chăm sóc khách hàng của shop thời trang & phụ kiện OmniSales tại Việt Nam. Hãy viết tin nhắn Zalo gửi khách bằng tiếng Việt, thân thiện, tự nhiên, 2–3 câu, dùng 1–2 emoji vừa phải, KHÔNG dùng markdown, KHÔNG đặt trong ngoặc kép. Chỉ xuất nội dung tin nhắn.'

// ===== 1. Agent Tư vấn: xác nhận đơn + nhắn Zalo =====
async function agentConfirm(orderId: string) {
  once(`confirm:${orderId}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master || !settings.auto_confirm) return
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { channel: true, customer: true, items: { include: { product: true } } },
    })
    if (!order || order.status !== 'PENDING' || !order.customer) return

    const itemsText = order.items.map((i) => `${i.quantity}× ${i.product?.name ?? ''}`).join(', ')
    const ai = await llmChat(
      LLM_SYS_ZALO,
      `Viết tin nhắn xác nhận đơn hàng cho khách ${order.customer.name}. Mã đơn: ${order.code}. Sản phẩm: ${itemsText}. Tổng tiền: ${order.total}đ. ${order.address ? `Địa chỉ giao: ${order.address}.` : ''} Nội dung: chào khách, xác nhận đã nhận đơn, nêu sản phẩm + tổng tiền, hẹn đóng gói giao sớm.`,
    )
    const content = ai ?? tConfirm(order.customer.name, order.code, itemsText, order.total)

    await db.order.update({ where: { id: order.id }, data: { status: 'CONFIRMED' } })
    await logEvent(order.id, 'CONFIRMED', 'AGENT', 'Agent Tư vấn xác nhận đơn', content)
    await sendZalo({
      customerId: order.customer.id,
      channelKey: zaloKeyOf(order.channel.key),
      content,
      agentName: AGENTS.CONFIRM_AGENT.name,
      relatedOrderId: order.id,
    })
    await logActivity({
      agent: 'CONFIRM_AGENT',
      action: 'CONFIRM_ORDER',
      level: 'success',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Tự động xác nhận đơn ${order.code} (${order.customer.name}) và nhắn tin Zalo cho khách`,
      detail: content,
    })
    broadcast('order.updated', { id: order.id, status: 'CONFIRMED', code: order.code })
  })
}

// ===== 2. Agent Kho vận: soạn hàng =====
async function startPacking(orderId: string) {
  once(`packing:${orderId}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master) return
    const order = await db.order.findUnique({ where: { id: orderId } })
    if (!order || order.status !== 'CONFIRMED') return

    await db.order.update({ where: { id: order.id }, data: { status: 'PACKING' } })
    await logEvent(order.id, 'PACKING', 'AGENT', 'Agent Kho vận soạn hàng & đóng gói')
    await logActivity({
      agent: 'LOGISTICS_AGENT',
      action: 'START_PACKING',
      level: 'info',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Soạn hàng & đóng gói đơn ${order.code}`,
    })
    broadcast('order.updated', { id: order.id, status: 'PACKING', code: order.code })
  })
}

// ===== 3. Agent Kho vận: báo đơn vị vận chuyển khi đóng đơn xong =====
async function dispatchCarrier(orderId: string) {
  once(`dispatch:${orderId}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master || !settings.auto_carrier) return
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { channel: true, customer: true },
    })
    if (!order || order.status !== 'PACKING') return
    const existing = await db.shipment.findUnique({ where: { orderId: order.id } })
    if (existing) return

    const carrier = pickCarrier()
    const tracking = makeTrackingCode(carrier.key)
    const shipment = await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: carrier.key,
        trackingCode: tracking,
        status: 'DISPATCHED',
        fee: order.shippingFee,
        dispatchedBy: 'AGENT',
      },
    })

    const notice = tCarrier(order.code, carrier.name, tracking)
    await logEvent(order.id, 'CARRIER_DISPATCHED', 'AGENT', `Báo ${carrier.name} đến lấy hàng — mã vận đơn ${tracking}`)
    if (order.customer) {
      await sendZalo({
        customerId: order.customer.id,
        channelKey: zaloKeyOf(order.channel.key),
        content: notice,
        agentName: AGENTS.LOGISTICS_AGENT.name,
        relatedOrderId: order.id,
      })
    }
    await logActivity({
      agent: 'LOGISTICS_AGENT',
      action: 'NOTIFY_CARRIER',
      level: 'success',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Đóng gói xong → tự động báo ${carrier.name} lấy hàng đơn ${order.code}. Mã vận đơn: ${tracking}`,
      detail: notice,
    })
    broadcast('shipment.updated', { id: shipment.id, orderId: order.id, status: 'DISPATCHED', code: order.code })
  })
}

// ===== 4-6. Hành trình vận chuyển (đơn vị vận chuyển cập nhật) =====
async function advanceShipment(shipmentId: string, next: 'PICKED_UP' | 'IN_TRANSIT' | 'DELIVERED') {
  once(`ship:${shipmentId}:${next}`, async () => {
    const settings = await getSettingsMap()
    const shipment = await db.shipment.findUnique({
      where: { id: shipmentId },
      include: { order: { include: { channel: true, customer: true } } },
    })
    if (!shipment || shipment.status === 'DELIVERED' || shipment.status === 'RETURNED') return
    const order = shipment.order

    await db.shipment.update({ where: { id: shipment.id }, data: { status: next } })

    if (next === 'PICKED_UP') {
      await db.order.update({ where: { id: order.id }, data: { status: 'SHIPPING' } })
      await logEvent(order.id, 'PICKED_UP', 'SYSTEM', `${carrierName(shipment.carrier)} đã lấy hàng`)
      await logActivity({
        agent: 'LOGISTICS_AGENT',
        action: 'PICKUP',
        level: 'info',
        targetType: 'ORDER',
        targetId: order.id,
        targetLabel: order.code,
        message: `${carrierName(shipment.carrier)} đã nhận đơn ${order.code} — chuyển trạng thái đang giao`,
      })
      if (settings.master && settings.auto_care && order.customer) {
        await sendZalo({
          customerId: order.customer.id,
          channelKey: zaloKeyOf(order.channel.key),
          content: tPickup(order.code, carrierName(shipment.carrier)),
          agentName: AGENTS.CARE_AGENT.name,
          relatedOrderId: order.id,
        })
      }
    } else if (next === 'IN_TRANSIT') {
      await logEvent(order.id, 'IN_TRANSIT', 'SYSTEM', 'Đơn hàng đang trên đường giao')
      await logActivity({
        agent: 'LOGISTICS_AGENT',
        action: 'IN_TRANSIT',
        level: 'info',
        targetType: 'ORDER',
        targetId: order.id,
        targetLabel: order.code,
        message: `Đơn ${order.code} đang trên đường giao đến khách`,
      })
      if (settings.master && settings.auto_care && order.customer) {
        await sendZalo({
          customerId: order.customer.id,
          channelKey: zaloKeyOf(order.channel.key),
          content: tTransit(order.code),
          agentName: AGENTS.CARE_AGENT.name,
          relatedOrderId: order.id,
        })
      }
    } else if (next === 'DELIVERED') {
      await db.order.update({
        where: { id: order.id },
        data: { status: 'COMPLETED', paymentStatus: 'PAID' },
      })
      await logEvent(order.id, 'DELIVERED', 'SYSTEM', 'Giao hàng thành công — thu tiền COD')
      await logActivity({
        agent: 'LOGISTICS_AGENT',
        action: 'DELIVERY_NOTICE',
        level: 'success',
        targetType: 'ORDER',
        targetId: order.id,
        targetLabel: order.code,
        message: `Giao thành công đơn ${order.code} qua ${carrierName(shipment.carrier)} — hoàn tất vòng đời đơn hàng`,
      })
    }
    broadcast('shipment.updated', { id: shipment.id, orderId: order.id, status: next, code: order.code })
    broadcast('order.updated', { id: order.id, status: next === 'DELIVERED' ? 'COMPLETED' : 'SHIPPING', code: order.code })
  })
}

// ===== 7. Agent CSKH: cảm ơn sau giao hàng =====
async function agentCare(orderId: string) {
  once(`care:${orderId}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master || !settings.auto_care) return
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { channel: true, customer: true, events: { orderBy: { createdAt: 'desc' }, take: 20 } },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return
    if (order.events.some((e) => e.type === 'CARE_SENT')) return

    const ai = await llmChat(
      LLM_SYS_ZALO,
      `Viết tin nhắn cảm ơn khách ${order.customer.name} sau khi đơn ${order.code} giao thành công. Nội dung: cảm ơn, hỏi thăm trải nghiệm, mời quay lại shop.`,
    )
    const content = ai ?? tCare(order.customer.name, order.code)
    await logEvent(order.id, 'CARE_SENT', 'AGENT', 'Agent CSKH gửi tin cảm ơn sau bán', content)
    await sendZalo({
      customerId: order.customer.id,
      channelKey: zaloKeyOf(order.channel.key),
      content,
      agentName: AGENTS.CARE_AGENT.name,
      relatedOrderId: order.id,
    })
    await logActivity({
      agent: 'CARE_AGENT',
      action: 'CARE_MESSAGE',
      level: 'success',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Giao hàng xong → nhắn cảm ơn & hỏi thăm ${order.customer.name} (đơn ${order.code})`,
      detail: content,
    })
  })
}

// ===== 8. Agent Đánh giá: xin review =====
async function requestReview(orderId: string) {
  once(`review:${orderId}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master || !settings.auto_review) return
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { channel: true, customer: true, events: { orderBy: { createdAt: 'desc' }, take: 20 } },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return
    if (order.reviewRating != null) return
    if (!order.events.some((e) => e.type === 'CARE_SENT')) return
    if (order.events.some((e) => e.type === 'REVIEW_REQUESTED')) return

    const ai = await llmChat(
      LLM_SYS_ZALO,
      `Viết tin nhắn gửi khách ${order.customer.name} xin đánh giá (sao) cho đơn ${order.code} sau khi giao thành công. Ngắn gọn, lịch sự, nhấn mạnh ý kiến của khách rất quan trọng với shop.`,
    )
    const content = ai ?? tReviewRequest(order.code)
    await logEvent(order.id, 'REVIEW_REQUESTED', 'AGENT', 'Agent Đánh giá gửi yêu cầu đánh giá', content)
    await sendZalo({
      customerId: order.customer.id,
      channelKey: zaloKeyOf(order.channel.key),
      content,
      agentName: AGENTS.REVIEW_AGENT.name,
      relatedOrderId: order.id,
    })
    await logActivity({
      agent: 'REVIEW_AGENT',
      action: 'REQUEST_REVIEW',
      level: 'info',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Gửi yêu cầu đánh giá cho khách ${order.customer.name} (đơn ${order.code})`,
      detail: content,
    })
  })
}

// ===== 9. Khách phản hồi đánh giá (mô phỏng mạng xã hội) =====
async function submitReview(orderId: string) {
  once(`reviewed:${orderId}`, async () => {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, events: { orderBy: { createdAt: 'desc' }, take: 20 }, customer: true },
    })
    if (!order || order.reviewRating != null) return
    if (!order.events.some((e) => e.type === 'REVIEW_REQUESTED')) return

    const ratingPool = [5, 5, 5, 5, 4, 4, 5, 4, 3, 5]
    const rating = ratingPool[Math.floor(Math.random() * ratingPool.length)]
    const productNames = order.items.map((i) => i.product?.name ?? '').filter(Boolean).join(', ')
    const ai = await llmChat(
      'Bạn viết giả lập đánh giá của một khách hàng Việt Nam trên sàn thương mại điện tử. Chỉ xuất nội dung đánh giá, tiếng Việt tự nhiên, 1–2 câu, không markdown, không ngoặc kép.',
      `Viết đánh giá ${rating}/5 sao của khách về sản phẩm: ${productNames} (đơn ${order.code}). ${rating >= 4 ? 'Khách hài lòng về chất lượng và tốc độ giao hàng.' : 'Khách khá hài lòng nhưng góp ý giao hàng hơi chậm.'}`,
    )
    const comment =
      ai ??
      (rating >= 4
        ? `Sản phẩm đẹp đúng hình, giao hàng nhanh. Sẽ ủng hộ shop tiếp ạ!`
        : `Đồ ổn trong tầm giá, giao hơi chậm một chút nhưng tổng thể ok ạ.`)

    await db.order.update({ where: { id: order.id }, data: { reviewRating: rating, reviewComment: comment } })
    await logEvent(order.id, 'REVIEW_RECEIVED', 'CUSTOMER', `Khách đánh giá ${rating}⭐ cho đơn hàng`, comment)
    await logActivity({
      agent: 'REVIEW_AGENT',
      action: 'REVIEW_RECEIVED',
      level: 'success',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Nhận đánh giá ${rating}⭐ từ ${order.customer?.name ?? 'khách hàng'} cho đơn ${order.code}`,
      detail: comment,
    })
    broadcast('review.received', { orderId: order.id, code: order.code, rating, comment })
  })
}

// ===== 10. Agent Hỗ trợ 24/7: trả lời tin nhắn Zalo =====
async function autoReply(customerId: string, channelKey: string) {
  once(`reply:${customerId}|${channelKey}`, async () => {
    const settings = await getSettingsMap()
    if (!settings.master || !settings.auto_reply) return

    const history = await db.directMessage.findMany({
      where: { customerId, channelKey },
      orderBy: { createdAt: 'desc' },
      take: 8,
    })
    if (history.length === 0) return
    const last = history[0] // newest (desc)
    if (last.sender !== 'CUSTOMER') return

    const customer = await db.customer.findUnique({ where: { id: customerId } })
    if (!customer) return

    // Chỉ trả lời tin nhắn mới nhất (tránh reply chồng)
    const convo = [...history].reverse().map((m) => `${m.sender === 'CUSTOMER' ? 'Khách' : 'Shop'}: ${m.content}`).join('\n')
    const ai = await llmChat(
      'Bạn là Agent hỗ trợ khách hàng 24/7 của shop OmniSales (thời trang & phụ kiện, freeship đơn từ 500k, giao hàng 1–3 ngày, hỗ trợ đổi trả trong 7 ngày). Trả lời tin nhắn khách Zalo bằng tiếng Việt, ngắn gọn tự nhiên 1–3 câu, có thể dùng 1 emoji, KHÔNG markdown. Nếu khách hỏi đơn hàng thì hướng dẫn theo dõi; nếu hỏi sản phẩm thì tư vấn nhiệt tình.',
      `Lịch sử hội thoại:\n${convo}\n\nHãy trả lời tin nhắn mới nhất của khách.`,
    )
    // LLM quá tải → dùng template thông minh theo từ khóa, Agent không bao giờ im lặng
    const content = ai ?? tAutoReply(last.content, customer.name)

    // Re-check: khách nhắn thêm trong lúc LLM chạy thì bỏ lượt này
    const newest = await db.directMessage.findFirst({
      where: { customerId, channelKey },
      orderBy: { createdAt: 'desc' },
    })
    if (!newest || newest.id !== last.id) return

    await sendZalo({
      customerId,
      channelKey,
      content,
      agentName: AGENTS.SUPPORT_AGENT.name,
      relatedOrderId: last.relatedOrderId,
    })
    await logActivity({
      agent: 'SUPPORT_AGENT',
      action: 'AUTO_REPLY',
      level: 'success',
      targetType: 'CONVERSATION',
      targetId: `${customerId}|${channelKey}`,
      targetLabel: customer.name,
      message: `Tự động trả lời tin nhắn của ${customer.name} trên ${channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo cá nhân'}`,
      detail: content,
    })
  })
}

// ===== Tick chính =====
async function runTick() {
  const settings = await getSettingsMap()
  const now = Date.now()
  const since = (ms: number) => new Date(now - ms)
  const dayAgo = since(24 * 3600 * 1000)

  // 1. Xác nhận đơn
  if (settings.master && settings.auto_confirm) {
    const orders = await db.order.findMany({
      where: { status: 'PENDING', createdAt: { lt: since(4000) } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: 3,
    })
    for (const o of orders) agentConfirm(o.id)
  }

  // 2. Soạn hàng
  if (settings.master) {
    const orders = await db.order.findMany({
      where: { status: 'CONFIRMED', updatedAt: { lt: since(4000) } },
      select: { id: true },
      take: 3,
    })
    for (const o of orders) startPacking(o.id)
  }

  // 3. Báo đơn vị vận chuyển
  if (settings.master && settings.auto_carrier) {
    const orders = await db.order.findMany({
      where: { status: 'PACKING', updatedAt: { lt: since(4000) }, shipments: { none: {} } },
      select: { id: true },
      take: 3,
    })
    for (const o of orders) dispatchCarrier(o.id)
  }

  // 4-6. Hành trình vận chuyển (bên vận chuyển cập nhật — luôn chạy)
  const shipments = await db.shipment.findMany({
    where: { status: { in: ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT'] }, updatedAt: { lt: since(5000) } },
    select: { id: true, status: true },
    take: 5,
  })
  for (const s of shipments) {
    if (s.status === 'DISPATCHED') advanceShipment(s.id, 'PICKED_UP')
    else if (s.status === 'PICKED_UP') advanceShipment(s.id, 'IN_TRANSIT')
    else if (s.status === 'IN_TRANSIT') advanceShipment(s.id, 'DELIVERED')
  }

  // 7-9. Chuỗi sau bán (chỉ đơn trong 24h gần đây)
  const afterSale = await db.order.findMany({
    where: { status: 'COMPLETED', createdAt: { gte: dayAgo } },
    include: { events: { orderBy: { createdAt: 'desc' }, take: 20 } },
    orderBy: { updatedAt: 'asc' },
    take: 6,
  })
  for (const o of afterSale) {
    if (settings.master && settings.auto_care && !o.events.some((e) => e.type === 'CARE_SENT') && o.updatedAt < since(2500)) {
      agentCare(o.id)
    }
    if (
      settings.master &&
      settings.auto_review &&
      o.reviewRating == null &&
      o.events.some((e) => e.type === 'CARE_SENT') &&
      !o.events.some((e) => e.type === 'REVIEW_REQUESTED') &&
      o.updatedAt < since(2500)
    ) {
      requestReview(o.id)
    }
    if (o.reviewRating == null && o.events.some((e) => e.type === 'REVIEW_REQUESTED') && o.updatedAt < since(8000)) {
      submitReview(o.id)
    }
  }

  // 10. AI trả lời tin nhắn
  if (settings.master && settings.auto_reply) {
    const recent = await db.directMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
    })
    const groups = new Map<string, string>()
    for (const m of recent) {
      const key = `${m.customerId}|${m.channelKey}`
      if (!groups.has(key)) groups.set(key, m.sender)
    }
    for (const [key, lastSender] of groups) {
      if (lastSender !== 'CUSTOMER') continue
      const [customerId, channelKey] = key.split('|')
      if (!customerId) continue
      const last = recent.find((m) => m.customerId === customerId && m.channelKey === channelKey)
      if (!last || last.createdAt > since(6000)) continue
      autoReply(customerId, channelKey)
    }
  }
}

export function ensureEngine() {
  if (g.__cmsEngineTimer) return
  g.__cmsEngineTimer = setInterval(() => {
    if (g.__cmsEngineBusy) return
    g.__cmsEngineBusy = true
    runTick()
      .catch((e) => console.error('[AgentEngine] tick error:', e))
      .finally(() => {
        g.__cmsEngineBusy = false
      })
  }, 2500)
  console.log('[AgentEngine] ✅ Autopilot engine đã khởi động (tick 2.5s) — 10 bước tự động hóa')
}
