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
