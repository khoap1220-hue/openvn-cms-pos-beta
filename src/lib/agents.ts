// Đội ngũ Agent + cấu hình tự động hóa + mẫu tin nhắn Zalo

export interface AgentMeta {
  key: string
  name: string
  short: string
  badgeClass: string
  dotClass: string
}

export const AGENTS: Record<string, AgentMeta> = {
  SYSTEM: { key: 'SYSTEM', name: 'Hệ thống', short: 'HỆ THỐNG', badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', dotClass: 'bg-slate-400' },
  CONFIRM_AGENT: { key: 'CONFIRM_AGENT', name: 'Agent Tư vấn', short: 'TƯ VẤN', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400', dotClass: 'bg-emerald-500' },
  LOGISTICS_AGENT: { key: 'LOGISTICS_AGENT', name: 'Agent Kho vận', short: 'KHO VẬN', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400', dotClass: 'bg-amber-500' },
  CARE_AGENT: { key: 'CARE_AGENT', name: 'Agent CSKH', short: 'CSKH', badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400', dotClass: 'bg-violet-500' },
  REVIEW_AGENT: { key: 'REVIEW_AGENT', name: 'Agent Đánh giá', short: 'ĐÁNH GIÁ', badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400', dotClass: 'bg-rose-500' },
  SUPPORT_AGENT: { key: 'SUPPORT_AGENT', name: 'Agent Hỗ trợ 24/7', short: 'HỖ TRỢ', badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400', dotClass: 'bg-teal-500' },
}

export const AGENT_ORDER = ['CONFIRM_AGENT', 'LOGISTICS_AGENT', 'CARE_AGENT', 'REVIEW_AGENT', 'SUPPORT_AGENT'] as const

// ===== Đơn vị vận chuyển =====
export interface CarrierMeta {
  key: string
  name: string
  color: string
}

export const CARRIERS: CarrierMeta[] = [
  { key: 'GHN', name: 'Giao Hàng Nhanh', color: '#16A34A' },
  { key: 'GHTK', name: 'Giao Hàng Tiết Kiệm', color: '#EA580C' },
  { key: 'VIETTEL', name: 'Viettel Post', color: '#DC2626' },
  { key: 'JT', name: 'J&T Express', color: '#DB2777' },
  { key: 'NINJA', name: 'Ninja Van', color: '#0D9488' },
]

export function pickCarrier(): CarrierMeta {
  return CARRIERS[Math.floor(Math.random() * CARRIERS.length)]
}

export function carrierName(key: string): string {
  return CARRIERS.find((c) => c.key === key)?.name ?? key
}

export function makeTrackingCode(carrierKey: string): string {
  const d = new Date()
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  return `${carrierKey}${ymd}${Math.floor(100000 + Math.random() * 900000)}`
}

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  DISPATCHED: 'Đã báo shipper',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang giao',
  DELIVERED: 'Đã giao',
  RETURNED: 'Đang hoàn về',
}

// ===== Công tắc tự động hóa (dùng chung client/server) =====
export interface AutomationDef {
  key: string
  label: string
  desc: string
  agent: string | null
}

export const AUTOMATION_DEFS: AutomationDef[] = [
  {
    key: 'master',
    label: 'Agent Autopilot',
    desc: 'Công tắc tổng. Khi BẬT, đội Agent tự vận hành toàn bộ quy trình bán hàng — người vận hành chỉ cần giám sát.',
    agent: null,
  },
  {
    key: 'auto_confirm',
    label: 'Tự xác nhận đơn qua Zalo',
    desc: 'Nhận đơn từ Zalo OA / Zalo cá nhân / mọi kênh → Agent Tư vấn tự kiểm tra kho và soạn tin xác nhận đơn gửi khách.',
    agent: 'CONFIRM_AGENT',
  },
  {
    key: 'auto_carrier',
    label: 'Tự báo đơn vị vận chuyển',
    desc: 'Khi đơn được soạn & đóng gói xong → Agent Kho vận tự báo GHN / GHTK / Viettel Post / J&T / Ninja Van đến lấy hàng và nhận mã vận đơn.',
    agent: 'LOGISTICS_AGENT',
  },
  {
    key: 'auto_care',
    label: 'Chăm sóc sau bán',
    desc: 'Báo khách từng bước hành trình vận chuyển, nhắn cảm ơn khi giao thành công và hỏi thăm trải nghiệm.',
    agent: 'CARE_AGENT',
  },
  {
    key: 'auto_review',
    label: 'Tự xin đánh giá',
    desc: 'Gửi yêu cầu đánh giá sau khi khách nhận hàng, tiếp nhận và tổng hợp điểm sao về hệ thống.',
    agent: 'REVIEW_AGENT',
  },
  {
    key: 'auto_reply',
    label: 'AI trả lời tin nhắn 24/7',
    desc: 'Agent Hỗ trợ đọc hiểu tin nhắn Zalo của khách và trả lời tự động mọi lúc, kể cả ngoài giờ.',
    agent: 'SUPPORT_AGENT',
  },
]

export const DEFAULT_SETTINGS: Record<string, boolean> = {
  master: true,
  auto_confirm: true,
  auto_carrier: true,
  auto_care: true,
  auto_review: true,
  auto_reply: true,
}

// ===== Mẫu tin nhắn Zalo (dự phòng khi LLM không khả dụng) =====

function vnd(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ'
}

export function tConfirm(name: string, code: string, items: string, total: number): string {
  return `Chào ${name} 🌿 OmniSales xác nhận đơn ${code} của anh/chị: ${items}. Tổng thanh toán: ${vnd(total)}. Shop sẽ đóng gói và bàn giao đơn vị vận chuyển trong hôm nay ạ!`
}

export function tCarrier(code: string, carrier: string, tracking: string): string {
  return `Đơn ${code} của mình đã được đóng gói xong và bàn giao cho ${carrier} 🚚 Mã vận đơn: ${tracking}. Anh/chị theo dõi hành trình đơn hàng trong ứng dụng nhé!`
}

export function tPickup(code: string, carrier: string): string {
  return `🚗 ${carrier} đã đến lấy hàng đơn ${code}. Dự kiến giao trong 1–2 ngày tới, anh/chị vui lòng nghe máy khi shipper gọi ạ!`
}

export function tTransit(code: string): string {
  return `📦 Đơn ${code} đang trên đường giao đến anh/chị. Cảm ơn anh/chị đã chờ shop ạ!`
}

export function tCare(name: string, code: string): string {
  return `Anh/chị ${name} ơi, đơn ${code} đã giao thành công 🎉 OmniSales cảm ơn anh/chị rất nhiều. Nếu cần hỗ trợ gì thêm, anh/chị cứ nhắn shop bất cứ lúc nào nhé!`
}

export function tReviewRequest(code: string): string {
  return `Anh/chị ơi, đơn ${code} đã được giao 💌 Nếu được, anh/chị dành 10 giây đánh giá sản phẩm & dịch vụ của shop (1–5⭐) giúp mình nhé. Ý kiến của anh/chị rất quan trọng với OmniSales!`
}

export function tAutoReply(content: string, name: string): string {
  const c = content.toLowerCase()
  if (c.includes('size') || c.includes('còn không') || c.includes('hàng không')) {
    return `Dạ ${name} ơi, sản phẩm của shop vẫn còn hàng đầy đủ size ạ. Anh/chị chọn mẫu rồi đặt đơn ngay trên Zalo, shop sẽ xác nhận và giao nhanh trong 1–2 ngày ạ! 🌿`
  }
  if (c.includes('đơn') || c.includes('giao') || c.includes('nhận được')) {
    return `Dạ đơn của ${name} đang được giao trong 1–2 ngày tới ạ. Shipper sẽ gọi trước khi đến, anh/chị để ý điện thoại giúp shop nhé!`
  }
  if (c.includes('freeship') || c.includes('giảm giá') || c.includes('khuyến mãi')) {
    return `Dạ shop đang có freeship cho đơn từ 500k ạ. ${name} ơi thêm vài món nữa để được miễn phí giao hàng luôn nhé!`
  }
  if (c.includes('đổi') || c.includes('trả')) {
    return `Dạ shop hỗ trợ đổi trả trong 7 ngày kể từ khi nhận hàng ạ. ${name} cứ nhắn shop kèm ảnh sản phẩm để được hỗ trợ nhanh nhất nhé!`
  }
  return `Dạ cảm ơn ${name} đã nhắn tin cho OmniSales 🌿 Anh/chị cần tư vấn sản phẩm hay kiểm tra đơn hàng thì nói rõ giúp shop, shop hỗ trợ ngay ạ!`
}

export function zaloKeyOf(channelKey: string): string {
  return channelKey === 'ZALO_PERSONAL' ? 'ZALO_PERSONAL' : 'ZALO_OA'
}
