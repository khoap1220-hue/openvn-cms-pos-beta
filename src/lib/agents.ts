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
  CONFIRM_AGENT: { key: 'CONFIRM_AGENT', name: 'AI Tiếp nhận & Tư vấn', short: 'TIẾP NHẬN', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400', dotClass: 'bg-emerald-500' },
  LOGISTICS_AGENT: { key: 'LOGISTICS_AGENT', name: 'AI Điều phối Kho vận', short: 'KHO VẬN', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400', dotClass: 'bg-amber-500' },
  CARE_AGENT: { key: 'CARE_AGENT', name: 'AI Chăm sóc Khách hàng', short: 'CSKH', badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400', dotClass: 'bg-violet-500' },
  REVIEW_AGENT: { key: 'REVIEW_AGENT', name: 'AI Quản trị Chất lượng', short: 'CHẤT LƯỢNG', badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400', dotClass: 'bg-rose-500' },
  SUPPORT_AGENT: { key: 'SUPPORT_AGENT', name: 'AI Phản hồi Đa kênh 24/7', short: 'TRỰC TUYẾN 24/7', badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400', dotClass: 'bg-teal-500' },
}

export const AGENT_ORDER = ['CONFIRM_AGENT', 'LOGISTICS_AGENT', 'CARE_AGENT', 'REVIEW_AGENT', 'SUPPORT_AGENT'] as const

// ===== Đơn vị vận chuyển =====
export interface CarrierMeta {
  key: string
  name: string
  color: string
}

export const CARRIERS: CarrierMeta[] = [
  { key: 'SPX', name: 'SPX Express', color: '#EE4D2D' },
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
  DISPATCHED: 'Chờ lấy hàng',
  PICKED_UP: 'Đã lấy hàng',
  IN_TRANSIT: 'Đang luân chuyển',
  DELIVERED: 'Đã giao thành công',
  RETURNED: 'Đang hoàn trả',
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
    label: 'Hệ thống Điều phối Tự động AI',
    desc: 'Công tắc điều hành tổng thể. Khi kích hoạt, tổ hợp tác nhân AI tự động điều phối toàn trình xử lý đơn đa kênh theo thời gian thực.',
    agent: null,
  },
  {
    key: 'auto_confirm',
    label: 'Tự động xác nhận đơn đa kênh',
    desc: 'Tiếp nhận đơn từ Zalo OA, Zalo Cá nhân và các sàn TMĐT → AI Tiếp nhận đối chiếu tồn kho và gửi thông báo xác nhận đơn hàng.',
    agent: 'CONFIRM_AGENT',
  },
  {
    key: 'auto_carrier',
    label: 'Tự động điều phối đơn vị vận chuyển',
    desc: 'Khi đơn hoàn tất đóng gói xuất kho → AI Điều phối Kho vận kết nối GHN / GHTK / Viettel Post / J&T / Ninja Van để tạo mã vận đơn và đặt lịch lấy hàng.',
    agent: 'LOGISTICS_AGENT',
  },
  {
    key: 'auto_care',
    label: 'Chăm sóc hành trình sau bán',
    desc: 'Cập nhật tự động tiến độ giao vận cho khách hàng, gửi thông điệp tri ân và hướng dẫn sử dụng sau khi phát hàng thành công.',
    agent: 'CARE_AGENT',
  },
  {
    key: 'auto_review',
    label: 'Khảo sát & Ghi nhận đánh giá chất lượng',
    desc: 'Tự động gửi khảo sát mức độ hài lòng sau khi hoàn tất đơn và tổng hợp chỉ số chất lượng dịch vụ về hệ thống.',
    agent: 'REVIEW_AGENT',
  },
  {
    key: 'auto_reply',
    label: 'Tư vấn & Phản hồi khách hàng 24/7',
    desc: 'AI Phản hồi Đa kênh phân tích ngữ cảnh tin nhắn và hình ảnh khách gửi để tư vấn tức thì trong và ngoài giờ hành chính.',
    agent: 'SUPPORT_AGENT',
  },
  {
    key: 'simulation_mode',
    label: 'Chế độ Kiểm thử Nhanh (Sandbox 30s)',
    desc: 'Khi TẮT (Môi trường thực tế): Tuân thủ kiểm đếm mã vạch đóng gói và đồng bộ trạng thái thật từ ĐVVC. Khi BẬT: Tự động mô phỏng chu trình giao vận & đánh giá trong 30 giây.',
    agent: null,
  },
]

export const DEFAULT_SETTINGS: Record<string, boolean> = {
  master: true,
  auto_confirm: true,
  auto_carrier: true,
  auto_care: true,
  auto_review: true,
  auto_reply: true,
  simulation_mode: false,
}

// ===== Mẫu tin nhắn Zalo (dự phòng khi LLM không khả dụng) — giọng chủ tiệm Ưu Đàm =====
// Toàn bộ template đi qua bộ lọc Anti-AI (sanitizeVoice) ở agent-voice.ts.

import {
  buildVoiceContext,
  vAutoReplyByKind,
  vCare,
  vCarrier,
  vConfirm,
  vPickup,
  vReviewRequest,
  vTransit,
  type VoiceContext,
} from '@/lib/agent-voice'

export type { VoiceContext }
export { buildVoiceContext, sanitizeVoice, friendlyProductName, friendlyItemsText, analyzeCustomerName, classifySentiment, reactionForSentiment, detectReplyKind } from '@/lib/agent-voice'

export function tConfirm(ctx: VoiceContext, total: number): string {
  return vConfirm(ctx, total)
}

export function tCarrier(ctx: VoiceContext, carrier: string, tracking: string): string {
  return vCarrier(ctx, carrier, tracking)
}

export function tPickup(ctx: VoiceContext, carrier: string): string {
  return vPickup(ctx, carrier)
}

export function tTransit(ctx: VoiceContext): string {
  return vTransit(ctx)
}

export function tCare(ctx: VoiceContext): string {
  return vCare(ctx)
}

export function tReviewRequest(ctx: VoiceContext): string {
  return vReviewRequest(ctx)
}

export function tAutoReply(
  kind: 'order' | 'stock' | 'promo' | 'return' | 'image_praise' | 'image_defect' | 'image_similar' | 'general',
  ctx: VoiceContext,
  extra?: { analysis?: string | null; productName?: string },
): string {
  return vAutoReplyByKind(kind, ctx, extra)
}

export function zaloKeyOf(channelKey: string): string {
  return channelKey === 'ZALO_PERSONAL' ? 'ZALO_PERSONAL' : 'ZALO_OA'
}
