// ===== Agent Autopilot Engine =====
// State machine chạy theo tick 2.5s, xử lý 100% quy trình bán hàng:
//   Đơn mới → Xác nhận (Zalo) → Soạn hàng → Báo ĐVVC → Lấy hàng →
//   Đang giao → Đã giao → Chăm sóc → Xin đánh giá → Nhận đánh giá
// Mọi bước đều lưu vĩnh viễn vào SQLite (AgentActivity / OrderEvent / DirectMessage)
// và broadcast realtime qua socket.io mini-service.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { llmChat, llmVision } from '@/lib/llm'
import { awardPointsForCompletedOrder } from '@/lib/member'
import { refreshCustomerMemory, getMemorySnapshot } from '@/lib/memory-engine'
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
  buildVoiceContext,
  zaloKeyOf,
  classifySentiment,
  reactionForSentiment,
  detectReplyKind,
  sanitizeVoice,
  friendlyItemsText,
} from '@/lib/agents'
import { logActivity, logEvent, sendZalo } from '@/lib/agent-log'
import { logLedgerAsync } from '@/lib/ledger'

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
      message: `Đã ${enabled ? 'kích hoạt' : 'tạm ngưng'} quy trình tự động «${def.label}»`,
    })
  }
}

// ===== Bộ quy tắc giọng văn 100% Anti-AI — Ưu Đàm (gắn vào mọi LLM prompt) =====
const VOICE_RULES = `Bạn là nhân viên bán hàng tại tiệm nến & trà gốm "Ưu Đàm" (uudam.vn), nhắn tin Zalo cho khách như người thật của tiệm.
QUY TẮC GIỌNG VĂN BẮT BUỘC:
- Tự xưng "tụi em" hoặc "em" hoặc "Ưu Đàm". TUYỆT ĐỐI không nói "shop OmniSales", "quý khách", "kính chào", "hân hạnh phục vụ".
- CẤM TUYỆT ĐỐI các câu sáo rỗng: "vô cùng quý giá", "nguồn động lực quý báu", "cải thiện chất lượng dịch vụ", "trải nghiệm tuyệt vời", "mong sớm được phục vụ".
- KHÔNG đọc mã đơn hàng (kiểu DH261024-1234) trong lời thoại — chỉ được gửi mã vận đơn khi khách cần theo dõi. Gọi tên món hàng rút gọn gần gũi: "2 hũ trà Zen", "bịch sáp đậu nành", "set quà nến bơ".
- Câu ngắn, đời thường, ấm áp như nhắn tin với người quen: dùng "dạ", "nha", "nhé", "đó ạ". Tối đa 1 emoji (hoặc không dùng).
- Xưng hô theo cách ghi sẵn trong ngữ cảnh (vd "Chị Trân", "Anh Quân"). Có trí nhớ khách thì lồng ghép TỰ NHIÊN (hỏi thăm góp ý cũ, khen khách quen), đừng liệt kê máy móc.
- Chỉ xuất nội dung tin nhắn, không markdown, không ngoặc kép.`

const LLM_SYS_ZALO = VOICE_RULES

/** Ngữ cảnh trí nhớ cho prompt LLM của 1 khách. */
async function memoryPromptBlock(customerId: string, extra?: { imageAnalysis?: string | null }): Promise<string> {
  const mem = await getMemorySnapshot(customerId)
  if (!mem) return ''
  const lines = [
    `Xưng hô với khách: "${mem.displayName}".`,
    mem.contextSummary ? `Tóm tắt ngữ cảnh tích lũy: ${mem.contextSummary}` : '',
    mem.preferences.length > 0 ? `Sở thích/nhu cầu: ${mem.preferences.join('; ')}.` : '',
    mem.painPoints.length > 0 ? `Khách từng góp ý (PHẢI hỏi thăm + xin lỗi/rút kinh nghiệm nếu liên quan): ${mem.painPoints.join('; ')}.` : '',
    extra?.imageAnalysis ? `Khách vừa gửi ảnh — AI nhận diện: ${extra.imageAnalysis}. Trả lời đúng trọng tâm bức ảnh.` : '',
  ].filter(Boolean)
  return `\nTRÍ NHỚ KHÁCH HÀNG:\n${lines.join('\n')}\n`
}

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

    await refreshCustomerMemory(order.customer.id, 'ORDER', `Đơn mới ${order.code}`).catch(() => null)
    const mem = await getMemorySnapshot(order.customer.id)
    const ctx = buildVoiceContext({
      name: order.customer.name,
      salutation: mem?.salutation,
      orderCount: mem?.isReturning ? 2 : 1,
      items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
      preferences: mem?.preferences,
      painPoints: mem?.painPoints,
    })
    const itemsText = friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))
    const ai = await llmChat(
      LLM_SYS_ZALO,
      `${await memoryPromptBlock(order.customer.id)}\nViết tin nhắn xác nhận đơn cho khách. Món hàng: ${itemsText}. Tổng tiền: ${order.total}đ. ${order.address ? `Giao đến: ${order.address}.` : ''} Nội dung: chào khách quen/tân khách đúng kiểu, xác nhận đã chốt đơn, nêu món hàng + tổng tiền, hẹn gói giao sớm.`,
    )
    const content = sanitizeVoice(ai ?? tConfirm(ctx, order.total))

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
      message: `Đã xác nhận đơn hàng ${order.code} (${itemsText}) cho ${mem?.displayName ?? order.customer.name} và gửi thông báo Zalo`,
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
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: { include: { product: true } }, customer: true },
    })
    if (!order || order.status !== 'CONFIRMED') return

    await db.order.update({ where: { id: order.id }, data: { status: 'PACKING' } })
    await logEvent(order.id, 'PACKING', 'AGENT', 'Agent Kho vận soạn hàng & đóng gói')
    const itemsText = friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))
    const hasFragile = order.items.some((i) => i.product?.fragile)
    await logActivity({
      agent: 'LOGISTICS_AGENT',
      action: 'START_PACKING',
      level: 'info',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Chuyển đơn hàng ${order.code} (${itemsText}) sang khâu soạn hàng & đóng gói${hasFragile ? ' — áp dụng quy cách chống sốc hàng dễ vỡ' : ''}`,
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
      include: { channel: true, customer: true, items: { include: { product: true } } },
    })
    if (!order || !['PACKING', 'SHIPPING'].includes(order.status)) return
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
        codAmount: order.paymentMethod === 'COD' ? order.total : 0,
        codStatus: 'PENDING',
        dispatchedBy: 'AGENT',
      },
    })

    const mem = order.customer ? await getMemorySnapshot(order.customer.id) : null
    const ctx = buildVoiceContext({
      name: order.customer?.name ?? '',
      salutation: mem?.salutation,
      orderCount: mem?.isReturning ? 2 : 1,
      items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
      preferences: mem?.preferences,
      painPoints: mem?.painPoints,
    })
    const itemsText = friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))
    const notice = tCarrier(ctx, carrier.name, tracking)
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
      message: `Hoàn tất đóng gói đơn ${order.code} (${itemsText}) — đã khởi tạo vận đơn ${carrier.name} (${tracking}) cho ${mem?.displayName ?? order.customer?.name ?? 'khách hàng'}`,
      detail: notice,
    })
    logLedgerAsync({
      scope: 'AGENT',
      action: 'NOTIFY_CARRIER',
      entityType: 'Order',
      entityId: order.id,
      entityCode: order.code,
      title: `Báo ${carrier.name} lấy hàng đơn ${order.code} — mã ${tracking}`,
      detail: { carrier: carrier.key, trackingCode: tracking },
      actor: 'AGENT',
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

    // Đơn COD giao thành công → tiền thu hộ chuyển sang "đã nhận, chờ ĐVVC đối soát chuyển về"
    if (next === 'DELIVERED' && shipment.codStatus === 'PENDING' && shipment.codAmount > 0) {
      await db.shipment.update({
        where: { id: shipment.id },
        data: { codStatus: 'RECEIVED', codReceived: shipment.codAmount, codReceivedAt: new Date() },
      })
      logLedgerAsync({
        scope: 'ORDER',
        action: 'COD_RECEIVED',
        entityType: 'Shipment',
        entityId: shipment.id,
        entityCode: shipment.trackingCode,
        title: `Nhận COD đơn ${order.code} — ${carrierName(shipment.carrier)} thu hộ ${(shipment.codAmount).toLocaleString('vi-VN')}đ`,
        detail: { orderId: order.id, orderCode: order.code, codAmount: shipment.codAmount },
        actor: 'AGENT',
      })
    }

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
        message: `Đơn vị vận chuyển ${carrierName(shipment.carrier)} đã tiếp nhận kiện hàng ${order.code} (${order.customer?.name ?? 'khách lẻ'})`,
      })
      if (settings.master && settings.auto_care && order.customer) {
        const mem = await getMemorySnapshot(order.customer.id)
        const ctx = buildVoiceContext({ name: order.customer.name, salutation: mem?.salutation, orderCount: mem?.isReturning ? 2 : 1, preferences: mem?.preferences, painPoints: mem?.painPoints })
        await sendZalo({
          customerId: order.customer.id,
          channelKey: zaloKeyOf(order.channel.key),
          content: tPickup(ctx, carrierName(shipment.carrier)),
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
        message: `Vận đơn ${shipment.trackingCode} (${order.code}) đang luân chuyển đến địa chỉ nhận của ${order.customer?.name ?? 'khách hàng'}`,
      })
      if (settings.master && settings.auto_care && order.customer) {
        const mem = await getMemorySnapshot(order.customer.id)
        const ctx = buildVoiceContext({ name: order.customer.name, salutation: mem?.salutation, orderCount: mem?.isReturning ? 2 : 1, preferences: mem?.preferences, painPoints: mem?.painPoints })
        await sendZalo({
          customerId: order.customer.id,
          channelKey: zaloKeyOf(order.channel.key),
          content: tTransit(ctx),
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
        message: `Giao hàng thành công đơn ${order.code} cho ${order.customer?.name ?? 'khách hàng'} qua ${carrierName(shipment.carrier)} — đã hoàn tất đối soát giao vận`,
      })
      logLedgerAsync({
        scope: 'AGENT',
        action: 'DELIVERY_NOTICE',
        entityType: 'Order',
        entityId: order.id,
        entityCode: order.code,
        title: `Giao thành công đơn ${order.code} qua ${carrierName(shipment.carrier)}`,
        detail: { carrier: shipment.carrier, shipmentStatus: next },
        actor: 'AGENT',
      })
      // Giao thành công → tự tích điểm cho thành viên (idempotent qua Sổ Data)
      await awardPointsForCompletedOrder(order.id)
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
      include: { channel: true, customer: true, events: { orderBy: { createdAt: 'desc' }, take: 20 }, items: { include: { product: true } } },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return
    if (order.events.some((e) => e.type === 'CARE_SENT')) return

    await refreshCustomerMemory(order.customer.id, 'ORDER', `Giao thành công ${order.code}`).catch(() => null)
    const mem = await getMemorySnapshot(order.customer.id)
    const ctx = buildVoiceContext({
      name: order.customer.name,
      salutation: mem?.salutation,
      orderCount: mem?.isReturning ? 2 : 1,
      items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
      preferences: mem?.preferences,
      painPoints: mem?.painPoints,
    })
    const itemsText = friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))
    const ai = await llmChat(
      LLM_SYS_ZALO,
      `${await memoryPromptBlock(order.customer.id)}\nViết tin cảm ơn sau khi giao thành công. Món hàng: ${itemsText}. Nếu khách từng góp ý thì hỏi thăm nhẹ nhàng đã ổn chưa. Mời ghé lại tiệm.`,
    )
    const content = sanitizeVoice(ai ?? tCare(ctx))
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
      message: `Đã gửi thông điệp chăm sóc sau bán hàng đến ${mem?.displayName ?? order.customer.name} cho đơn ${order.code} (${itemsText})`,
      detail: content,
    })
    logLedgerAsync({
      scope: 'AGENT',
      action: 'CARE_MESSAGE',
      entityType: 'Order',
      entityId: order.id,
      entityCode: order.code,
      title: `Gửi tin cảm ơn khách sau giao đơn ${order.code}`,
      actor: 'AGENT',
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
      include: {
        channel: true,
        customer: true,
        events: { orderBy: { createdAt: 'desc' }, take: 20 },
        items: { include: { product: true } },
      },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return
    if (order.reviewRating != null) return
    if (!order.events.some((e) => e.type === 'CARE_SENT')) return
    if (order.events.some((e) => e.type === 'REVIEW_REQUESTED')) return

    const ai = await llmChat(
      LLM_SYS_ZALO,
      `${await memoryPromptBlock(order.customer.id)}\nViết tin nhờ khách chấm vài sao đánh giá. Giọng nhẹ nhàng như chủ tiệm nhờ vả người quen, KHÔNG nói "ý kiến quý giá/động lực".`,
    )
    const ctx = buildVoiceContext({
      name: order.customer.name,
      salutation: (await getMemorySnapshot(order.customer.id))?.salutation,
      orderCount: 1,
      items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
    })
    const content = sanitizeVoice(ai ?? tReviewRequest(ctx))
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
      message: `Đã gửi khảo sát đánh giá chất lượng đơn hàng ${order.code} (${friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))}) đến ${order.customer.name}`,
      detail: content,
    })
    logLedgerAsync({
      scope: 'AGENT',
      action: 'REQUEST_REVIEW',
      entityType: 'Order',
      entityId: order.id,
      entityCode: order.code,
      title: `Xin đánh giá đơn ${order.code} từ ${order.customer.name}`,
      actor: 'AGENT',
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
    const productNames = friendlyItemsText(order.items.map((i) => ({ quantity: i.quantity, product: i.product })))
    const ai = await llmChat(
      'Bạn viết giả lập đánh giá của một khách hàng Việt Nam trên sàn thương mại điện tử cho tiệm nến & trà gốm. Chỉ xuất nội dung đánh giá, tiếng Việt đời thường, 1–2 câu, không markdown, không ngoặc kép, không nói "shop OmniSales".',
      `Viết đánh giá ${rating}/5 sao của khách về: ${productNames}. ${rating >= 4 ? 'Khách hài lòng về chất lượng, đóng gói, mùi hương.' : 'Khách khá hài lòng nhưng góp ý giao hàng hơi chậm.'}`,
    )
    const comment =
      ai ??
      (rating >= 4
        ? `Hàng đẹp đúng hình, đóng gói cẩn thận, nến cháy thơm. Sẽ ghé tiếp ạ!`
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
      message: `Ghi nhận đánh giá ${rating}/5 sao từ ${order.customer?.name ?? 'khách hàng'} cho đơn hàng ${order.code} (${productNames})`,
      detail: comment,
    })
    // Đánh giá mới → chắt lọc lại trí nhớ khách (pain point nếu có góp ý)
    if (order.customerId) {
      await refreshCustomerMemory(order.customerId, 'REVIEW', `${rating}⭐: ${comment}`).catch(() => null)
    }
    broadcast('review.received', { orderId: order.id, code: order.code, rating, comment })
  })
}

// ===== 10. Agent Hỗ trợ 24/7: trả lời tin nhắn Zalo (đa phương thức + trí nhớ + reaction) =====
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

    await refreshCustomerMemory(customerId, 'MESSAGE', last.content.slice(0, 120)).catch(() => null)
    const mem = await getMemorySnapshot(customerId)
    const ctx = buildVoiceContext({
      name: customer.name,
      salutation: mem?.salutation,
      orderCount: mem?.isReturning ? 2 : 1,
      preferences: mem?.preferences,
      painPoints: mem?.painPoints,
    })

    // Chỉ trả lời tin nhắn mới nhất (tránh reply chồng)
    const convo = [...history].reverse().map((m) => `${m.sender === 'CUSTOMER' ? 'Khách' : 'Ưu Đàm'}: ${m.content}`).join('\n')
    const kind = detectReplyKind(last.content, last.imageAnalysis)
    const ai = await llmChat(
      LLM_SYS_ZALO,
      `${await memoryPromptBlock(customerId, { imageAnalysis: last.imageAnalysis })}\nTiệm: freeship đơn từ 500k, giao 1–3 ngày, đổi trả trong 7 ngày.\nLịch sử hội thoại:\n${convo}\n\nHãy trả lời tin nhắn mới nhất của khách${last.imageUrl ? ' (nhớ nhắc đúng nội dung bức ảnh khách vừa gửi)' : ''}.`,
    )
    // LLM quá tải → dùng template thông minh theo từ khóa + trí nhớ, Agent không bao giờ im lặng
    const content = sanitizeVoice(ai ?? tAutoReply(kind, ctx, { analysis: last.imageAnalysis }))

    // Re-check: khách nhắn thêm trong lúc LLM chạy thì bỏ lượt này
    const newest = await db.directMessage.findFirst({
      where: { customerId, channelKey },
      orderBy: { createdAt: 'desc' },
    })
    if (!newest || newest.id !== last.id) return

    // Thả cảm xúc tự động lên bong bóng tin nhắn khách (tích cực ❤️ / lỗi 😢 / trung tính 🙏)
    const reaction = reactionForSentiment(classifySentiment(last.content, last.imageAnalysis))
    const prevReactions = (() => {
      try {
        return JSON.parse(last.reactions ?? '[]') as Array<{ emoji: string; agent: string }>
      } catch {
        return []
      }
    })()
    if (!prevReactions.some((r) => r.agent === 'SUPPORT_AGENT')) {
      await db.directMessage.update({
        where: { id: last.id },
        data: { reactions: JSON.stringify([...prevReactions, { emoji: reaction.emoji, agent: 'SUPPORT_AGENT', at: new Date().toISOString() }]) },
      })
      broadcast('message.reaction', { messageId: last.id, customerId, channelKey, emoji: reaction.emoji })
      await logActivity({
        agent: 'SUPPORT_AGENT',
        action: 'REACTION',
        level: 'info',
        targetType: 'CONVERSATION',
        targetId: `${customerId}|${channelKey}`,
        targetLabel: customer.name,
        message: `${reaction.note} của ${mem?.displayName ?? customer.name}`,
      })
    }

    await sendZalo({
      customerId,
      channelKey,
      content,
      agentName: AGENTS.SUPPORT_AGENT.name,
      relatedOrderId: last.relatedOrderId,
    })
    logLedgerAsync({
      scope: 'AGENT',
      action: 'AUTO_REPLY',
      entityType: 'Customer',
      entityId: customerId,
      title: `Tự động trả lời tin nhắn của ${customer.name} trên ${channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo cá nhân'}`,
      actor: 'AGENT',
    })
    logLedgerAsync({
      scope: 'MESSAGE',
      action: 'AGENT_REPLY',
      entityType: 'DirectMessage',
      entityId: last.relatedOrderId ?? customerId,
      entityCode: channelKey,
      title: `Agent phản hồi tin nhắn ${customer.name} trên ${channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo cá nhân'}`,
      detail: { channelKey, relatedOrderId: last.relatedOrderId ?? null, kind },
      actor: 'AGENT',
    })
    await logActivity({
      agent: 'SUPPORT_AGENT',
      action: 'AUTO_REPLY',
      level: 'success',
      targetType: 'CONVERSATION',
      targetId: `${customerId}|${channelKey}`,
      targetLabel: customer.name,
      message: last.imageUrl
        ? `Đã phân tích hình ảnh đính kèm và phản hồi ${mem?.displayName ?? customer.name} trên ${channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo Cá nhân'}`
        : `Đã phản hồi tự động tin nhắn của ${mem?.displayName ?? customer.name} trên ${channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo Cá nhân'}`,
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
  // - Chế độ Vận hành Thực tế (simulation_mode = false): chỉ tự động tạo vận đơn sau khi kho đã xác nhận đóng gói xong (status = SHIPPING)
  // - Chế độ Mô phỏng Demo (simulation_mode = true): tự động tạo vận đơn ngay từ bước PACKING sau 4s
  if (settings.master && settings.auto_carrier) {
    const targetStatuses = settings.simulation_mode ? ['PACKING', 'SHIPPING'] : ['SHIPPING']
    const orders = await db.order.findMany({
      where: { status: { in: targetStatuses }, updatedAt: { lt: since(4000) }, shipments: { none: {} } },
      select: { id: true },
      take: 3,
    })
    for (const o of orders) dispatchCarrier(o.id)
  }

  // 4-6. Hành trình vận chuyển tự động giả lập (CHỈ chạy khi bật simulation_mode)
  if (settings.simulation_mode) {
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
    // Bước 9: Giả lập khách tự chấm sao đánh giá — CHỈ chạy khi bật simulation_mode
    if (settings.simulation_mode && o.reviewRating == null && o.events.some((e) => e.type === 'REVIEW_REQUESTED') && o.updatedAt < since(8000)) {
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
