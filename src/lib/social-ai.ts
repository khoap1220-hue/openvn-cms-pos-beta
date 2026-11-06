// src/lib/social-ai.ts
// Milestone 3 (M3: AI Planning & Copywriting Engine)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
// Multi-platform content calendar generator, 7-channel copywriting, anti-AI brand voice filter,
// deterministic CRM invariant matcher, and 4-criterion automated rubric quality gate (>= 8.0/10).

import { db } from '@/lib/db'
import {
  getCampaign,
  type CampaignData,
  type EnrichedProductPricing,
  type EnrichedVoucherInfo,
} from '@/lib/campaign-service'
import { BANNED_PHRASES } from '@/lib/agent-voice'
import { llmChat } from '@/lib/llm'
import type { SocialPlan, SocialPost } from '@prisma/client'

// ============================================================
// 1. TYPES & CONTRACTS
// ============================================================

export type SocialPlatform =
  | 'FACEBOOK'
  | 'ZALO_OA'
  | 'WEBSITE'
  | 'EXTERNAL_CMS'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'THREADS'

export const ALL_SOCIAL_PLATFORMS: SocialPlatform[] = [
  'FACEBOOK',
  'ZALO_OA',
  'WEBSITE',
  'EXTERNAL_CMS',
  'INSTAGRAM',
  'TIKTOK',
  'THREADS',
]

export interface DriveAssetContext {
  id: string
  name: string
  mimeType: string
  fileType: string
  viewUrl?: string | null
  thumbnailUrl?: string | null
  downloadUrl?: string | null
  textContent?: string | null
  path?: string | null
}

export interface RubricCriterionScore {
  score: number // 0 - 10
  weight: number
  weightedScore: number
  passed: boolean
  feedback: string
}

export interface RubricEvaluation {
  crmAccuracy: RubricCriterionScore
  brandVoice: RubricCriterionScore
  platformFormatting: RubricCriterionScore
  callToAction: RubricCriterionScore
  overallScore: number // 0.0 - 10.0
  passed: boolean // overallScore >= 8.0
}

export interface GenerationMeta {
  model: string
  latencyMs: number
  error?: string
}

export type ProductCategoryType = 'TEA' | 'CANDLE' | 'INCENSE' | 'CERAMIC' | 'GENERAL'

export function detectProductCategory(product?: EnrichedProductPricing | null): ProductCategoryType {
  if (!product) return 'GENERAL'
  const text = `${product.name} ${product.sku || ''}`.toLowerCase()
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')

  // 1. Trầm hương / Nhang / Vòng trầm / Xông trầm (Kiểm tra trước để ud-tram không bị dính ud-tra)
  if (
    /\btram\b/i.test(normalized) ||
    /\bvong\b/i.test(normalized) ||
    normalized.includes('xong huong') ||
    /\bnhang\b/i.test(normalized) ||
    /\bud-tram\b/i.test(normalized) ||
    normalized.includes('ud-tram-')
  ) {
    return 'INCENSE'
  }

  // 2. Tranh gốm / Gốm men lam / Decor / Tranh treo tường
  if (
    /\btranh\b/i.test(normalized) ||
    /\bgom\b/i.test(normalized) ||
    normalized.includes('men lam') ||
    normalized.includes('treo tuong') ||
    normalized.includes('ud-qt-002')
  ) {
    // Nếu là đồ gốm phục vụ uống trà (Bộ ấm trà gốm, Hũ trà gốm, Hộp quà trà kèm hũ gốm) thì phân vào TEA
    if (/\btra\b/i.test(normalized) || normalized.includes('am tra') || normalized.includes('hu tra')) {
      return 'TEA'
    }
    return 'CERAMIC'
  }

  // 3. Trà / Ấm trà / Hộp quà trà / Bình pha trà / Hũ trà gốm Zen
  if (
    /\btra\b/i.test(normalized) ||
    normalized.includes('am tra') ||
    normalized.includes('pha tra') ||
    normalized.includes('hop qua tang tra') ||
    normalized.includes('son thuy') ||
    /\bud-tra\b/i.test(normalized) ||
    normalized.includes('ud-tra-') ||
    normalized.includes('ud-qt-001')
  ) {
    return 'TEA'
  }

  // 4. Nến thơm / Nến bơ / Sáp nến / Bấc nến / Đèn xông nến / Thạch cao chữa lành
  if (
    /\bnen\b/i.test(normalized) ||
    /\bsap\b/i.test(normalized) ||
    normalized.includes('thach cao') ||
    normalized.includes('bac nen') ||
    normalized.includes('bac go') ||
    normalized.includes('den xong') ||
    /\bcandle\b/i.test(normalized) ||
    /\bwax\b/i.test(normalized) ||
    /\bud-nen\b/i.test(normalized) ||
    normalized.includes('ud-nen-') ||
    /\bud-tc\b/i.test(normalized) ||
    normalized.includes('ud-tc-') ||
    /\bud-sap\b/i.test(normalized) ||
    normalized.includes('ud-sap-') ||
    /\bud-vl\b/i.test(normalized) ||
    normalized.includes('ud-vl-')
  ) {
    return 'CANDLE'
  }

  return 'GENERAL'
}

export function isThachCaoProduct(product?: EnrichedProductPricing | null): boolean {
  if (!product) return false
  const text = `${product.name || ''} ${product.sku || ''} ${product.image || ''}`.toLowerCase()
  return (
    text.includes('thạch cao') ||
    text.includes('thach cao') ||
    text.includes('ud-tc-') ||
    text.includes('/thach-cao/') ||
    text.includes('1688-')
  )
}

export interface PlatformDraft {
  channel: SocialPlatform
  title?: string | null
  slug?: string | null
  content: string
  excerpt?: string | null
  mediaUrls: string[]
  mediaType: 'NONE' | 'IMAGE' | 'VIDEO' | 'CAROUSEL'
  hashtags?: string | null
  targetUrl?: string | null
  scheduledAt: Date
  rubricEvaluation: RubricEvaluation
  generationSource: 'LLM' | 'TEMPLATE_FALLBACK'
  generationMeta: GenerationMeta
}

export type LlmChatFunction = (system: string, user: string, timeoutMs?: number) => Promise<string | null>

export interface GeneratePlanOptions {
  platforms?: (SocialPlatform | string)[]
  postsCount?: number
  contentSourceId?: string
  targetProductIds?: string[]
  targetVoucherIds?: string[]
  brandTone?: string
  customPrompt?: string
  llmCaller?: LlmChatFunction
}

export interface GeneratePlatformDraftOptions {
  channel: SocialPlatform
  campaign: CampaignData
  product?: EnrichedProductPricing
  voucher?: EnrichedVoucherInfo
  driveAssets?: DriveAssetContext[]
  scheduledAt: Date
  customPrompt?: string
  llmCaller?: LlmChatFunction
  variationIndex?: number
}

export interface GeneratedSocialPlanResult {
  plan: {
    title: string
    description: string
    targetAudience: string
    brandTone: string
    startDate: Date
    endDate: Date
    totalPosts: number
    status: string
  }
  posts: PlatformDraft[]
  rubricSummary: {
    averageScore: number
    allPassed: boolean
    evaluatedCount: number
    scoresByChannel: Record<string, number>
  }
}

// ============================================================
// 2. BRAND VOICE & ANTI-AI FILTER (FEAT-AI-02)
// ============================================================

/**
 * Danh sách cụm từ cấm mở rộng dành riêng cho Social Copywriting.
 * Tuyệt đối không cho phép văn phong công nghiệp, sáo rỗng hoặc xưng hô xa cách.
 */
export const EXTENDED_BANNED_PHRASES: Array<{ pattern: RegExp; replace: string }> = [
  ...BANNED_PHRASES,
  { pattern: /kính chào quý khách/gi, replace: 'thương gửi mình' },
  { pattern: /kính chào quý khách hàng/gi, replace: 'thương gửi mình' },
  { pattern: /quý khách hàng thân mến/gi, replace: 'bạn hữu thương mến' },
  { pattern: /hân hạnh được đón tiếp/gi, replace: 'rất vui được đón mình ghé chơi' },
  { pattern: /trải nghiệm tuyệt vời nhất/gi, replace: 'khoảnh khắc an lành và thư thái' },
  { pattern: /sự lựa chọn hoàn hảo/gi, replace: 'chút duyên lành phù hợp' },
  { pattern: /không thể bỏ lỡ/gi, replace: 'mời mình ghé xem' },
  { pattern: /cơ hội ngàn năm có một/gi, replace: 'dịp đặc biệt này' },
  { pattern: /hãy nhanh tay kẻo lỡ/gi, replace: 'nếu hữu duyên, mời mình ghé tiệm' },
  { pattern: /sản phẩm hàng đầu/gi, replace: 'món quà thủ công tỉ mỉ' },
  { pattern: /chúng tôi cam kết mang lại/gi, replace: 'tụi em luôn mong gửi gắm' },
  { pattern: /đội ngũ chuyên nghiệp/gi, replace: 'những người bạn thợ tỉ mỉ' },
]

/**
 * Làm sạch và chuyển hóa văn phong AI thành giọng thương hiệu Ưu Đàm:
 * - Trầm lắng, an nhiên, chữa lành, tinh tế, chân thành.
 * - Tự xưng: "tụi em", "Ưu Đàm". Gọi người đọc: "mình", "bạn hữu", "khách thương".
 * - Triệt tiêu 100% văn mẫu thương mại ồn ào và cụm từ cấm.
 */
export function sanitizeBrandVoice(text: string): string {
  if (!text) return ''
  let sanitized = text

  // 1. Thay thế theo từ điển cụm từ cấm
  for (const { pattern, replace } of EXTENDED_BANNED_PHRASES) {
    sanitized = sanitized.replace(pattern, replace)
  }

  // 2. Chuẩn hóa xưng hô nếu phát hiện danh xưng xa cách
  sanitized = sanitized
    .replace(/\bchúng tôi\b/gi, 'tụi em')
    .replace(/\bShop\b/g, 'Ưu Đàm')
    .replace(/\bshop\b/g, 'tụi em')
    .replace(/\bquý khách\b/gi, 'mình')
    .replace(/\bkhách hàng\b/gi, 'bạn hữu')

  // 3. Chuẩn hóa khoảng trắng và dấu câu
  sanitized = sanitized
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.,!?:;])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  return sanitized
}

/**
 * Kiểm tra xem văn bản có còn sót cụm từ cấm nào không.
 */
export function detectBannedPhrases(text: string): string[] {
  if (!text) return []
  const found: string[] = []
  for (const { pattern } of EXTENDED_BANNED_PHRASES) {
    const matches = text.match(pattern)
    if (matches && matches.length > 0) {
      found.push(...matches)
    }
  }
  return Array.from(new Set(found))
}

// ============================================================
// 3. DETERMINISTIC CRM INVARIANT MATCHER (FEAT-AI-03)
// ============================================================

export function formatVnd(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(amount) + 'đ'
}

/**
 * Chuẩn hóa chuỗi số tiền và phần trăm để tìm kiếm regex linh hoạt nhưng chính xác.
 */
function createPriceRegexes(amount: number): RegExp[] {
  const formatted = new Intl.NumberFormat('vi-VN').format(amount) // vd: 150.000
  const plain = amount.toString() // vd: 150000
  return [
    new RegExp(`${formatted.replace(/\./g, '\\.')}\\s*(đ|vnđ|d|vnd)?`, 'i'),
    new RegExp(`\\b${plain}\\s*(đ|vnđ|d|vnd)?`, 'i'),
  ]
}

/**
 * Thẩm tra sự hiện diện bất biến của dữ liệu CRM trong bài viết.
 */
export function validateCrmInvariants(
  content: string,
  campaign: CampaignData,
  product?: EnrichedProductPricing,
  voucher?: EnrichedVoucherInfo
): {
  valid: boolean
  matchedPrice: boolean
  matchedDiscount: boolean
  matchedVoucher: boolean
  missingItems: string[]
} {
  const missingItems: string[] = []

  // 1. Kiểm tra giá sản phẩm (nếu có sản phẩm mục tiêu)
  let matchedPrice = true
  if (product && product.price > 0) {
    const priceRegexes = createPriceRegexes(product.price)
    const hasPrice = priceRegexes.some((re) => re.test(content))
    if (!hasPrice) {
      matchedPrice = false
      missingItems.push(`Giá sản phẩm ${product.name} (${formatVnd(product.price)})`)
    }
  }

  // 2. Kiểm tra chiết khấu % (nếu chiến dịch hoặc sản phẩm có % giảm)
  let matchedDiscount = true
  const targetDiscount = product?.discountPercent ?? campaign.discountPercent
  if (targetDiscount && targetDiscount > 0) {
    const discountStr = targetDiscount.toString().replace('.', '\\.')
    const discountRegex = new RegExp(`(${discountStr}%|giảm\\s*${discountStr}%)`, 'i')
    if (!discountRegex.test(content)) {
      matchedDiscount = false
      missingItems.push(`Tỷ lệ giảm giá ${targetDiscount}%`)
    }
  }

  // 3. Kiểm tra mã Voucher (nếu chiến dịch có voucher áp dụng)
  let matchedVoucher = true
  const targetVoucherCode = voucher?.code ?? campaign.voucherCode
  if (targetVoucherCode) {
    const voucherRegex = new RegExp(`\\b${targetVoucherCode.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
    if (!voucherRegex.test(content)) {
      matchedVoucher = false
      missingItems.push(`Mã voucher ${targetVoucherCode}`)
    }
  }

  const valid = matchedPrice && matchedDiscount && matchedVoucher
  return { valid, matchedPrice, matchedDiscount, matchedVoucher, missingItems }
}

/**
 * Động cơ cưỡng chế bất biến dữ liệu CRM (Deterministic CRM Invariant Enforcer):
 * Nếu nội dung thiếu hoặc chứa sai lệch về giá, discount %, hoặc voucher code,
 * hàm này sẽ hiệu đính hoặc gắn thêm block dữ liệu xác thực CRM chuẩn 100%.
 */
export function enforceCrmInvariants(
  content: string,
  campaign: CampaignData,
  product?: EnrichedProductPricing,
  voucher?: EnrichedVoucherInfo,
  platform: SocialPlatform = 'FACEBOOK'
): string {
  let updated = content

  const targetPrice = product?.price
  const targetDiscount = product?.discountPercent ?? campaign.discountPercent
  const targetVoucherCode = voucher?.code ?? campaign.voucherCode

  // Nếu là THREADS và ký tự quá sát giới hạn, ta sẽ tích hợp khéo léo gọn gàng
  const isShortPlatform = platform === 'THREADS'

  // 1. Đảm bảo mã Voucher xuất hiện chuẩn xác
  if (targetVoucherCode) {
    const voucherRegex = new RegExp(`\\b${targetVoucherCode.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i')
    if (!voucherRegex.test(updated)) {
      if (isShortPlatform) {
        updated += ` (Mã: ${targetVoucherCode})`
      } else {
        updated += `\n\n🌿 Mã ưu đãi thân gửi mình: ${targetVoucherCode}`
      }
    }
  }

  // 2. Đảm bảo tỷ lệ giảm giá xuất hiện chuẩn xác
  if (targetDiscount && targetDiscount > 0) {
    const discountRegex = new RegExp(`\\b${targetDiscount}%`, 'i')
    if (!discountRegex.test(updated)) {
      if (isShortPlatform) {
        updated += ` - Giảm ${targetDiscount}%`
      } else {
        updated += `\n🌿 Ưu đãi an yên: Giảm ${targetDiscount}% cho dịp này.`
      }
    }
  }

  // 3. Đảm bảo giá sản phẩm xuất hiện chuẩn xác
  if (targetPrice && targetPrice > 0) {
    const priceRegexes = createPriceRegexes(targetPrice)
    const hasPrice = priceRegexes.some((re) => re.test(updated))
    if (!hasPrice) {
      const priceText = formatVnd(targetPrice)
      if (isShortPlatform) {
        updated += ` | ${priceText}`
      } else {
        const prodName = product?.name ? ` ${product.name}` : ''
        updated += `\n🌿 Món an lành${prodName}: ${priceText}`
      }
    }
  }

  return updated.trim()
}

// ============================================================
// 4. AUTOMATED RUBRIC EVALUATOR (FEAT-AI-05 - GATE >= 8.0/10)
// ============================================================

/**
 * Đánh giá chất lượng bản thảo dựa trên rubric 4 tiêu chí nghiêm ngặt:
 * 1. CRM Data Accuracy (trọng số 30%)
 * 2. Ưu Đàm Brand Voice (trọng số 30%)
 * 3. Platform Formatting (trọng số 20%)
 * 4. Call to Action (trọng số 20%)
 * Ngưỡng đạt: Điểm tổng kết >= 8.0/10
 */
export function evaluateDraftRubric(
  draft: {
    channel: SocialPlatform
    title?: string | null
    slug?: string | null
    content: string
    mediaUrls?: string[]
    hashtags?: string | null
  },
  campaign: CampaignData,
  product?: EnrichedProductPricing,
  voucher?: EnrichedVoucherInfo
): RubricEvaluation {
  const content = draft.content || ''

  // ------------------------------------------------------------
  // Tiêu chí 1: CRM Data Accuracy (Trọng số 30%)
  // ------------------------------------------------------------
  const crmCheck = validateCrmInvariants(content, campaign, product, voucher)
  let crmScore = 10
  const crmFeedbacks: string[] = []

  if (!crmCheck.matchedPrice && product && product.price > 0) {
    crmScore -= 3.5
    crmFeedbacks.push(`Chưa phản ánh đúng giá sản phẩm ${formatVnd(product.price)}`)
  }
  if (!crmCheck.matchedDiscount && (product?.discountPercent || campaign.discountPercent)) {
    crmScore -= 3.0
    crmFeedbacks.push('Thiếu hoặc lệch % giảm giá chiến dịch')
  }
  if (!crmCheck.matchedVoucher && (voucher?.code || campaign.voucherCode)) {
    crmScore -= 3.5
    crmFeedbacks.push('Thiếu mã voucher khuyến mãi')
  }
  crmScore = Math.max(0, Math.min(10, crmScore))
  const crmFeedback = crmFeedbacks.length > 0
    ? crmFeedbacks.join('; ')
    : 'Dữ liệu giá bán, chiết khấu và voucher khớp 100% với CRM'

  // ------------------------------------------------------------
  // Tiêu chí 2: Ưu Đàm Brand Voice (Trọng số 30%)
  // ------------------------------------------------------------
  let voiceScore = 10
  const voiceFeedbacks: string[] = []
  const banned = detectBannedPhrases(content)

  if (banned.length > 0) {
    voiceScore -= Math.min(6, banned.length * 2.5)
    voiceFeedbacks.push(`Chứa cụm từ cấm: ${banned.join(', ')}`)
  }

  // Kiểm tra xưng hô chuẩn mực Ưu Đàm
  const hasGentlePronouns =
    /tụi em|Ưu Đàm|tiệm|mình|bạn hữu|thương gửi|an yên|thư thái|bình yên|chữa lành/i.test(content)
  if (!hasGentlePronouns) {
    voiceScore -= 2.0
    voiceFeedbacks.push('Thiếu sắc thái tĩnh tại, từ bi, xưng hô gần gũi của Ưu Đàm')
  }

  // Trừ điểm nếu có từ ngữ thương mại hối thúc
  if (/nhanh tay|kẻo lỡ|cháy hàng|mua ngay kẻo hết|sập sàn|xả kho/i.test(content)) {
    voiceScore -= 3.0
    voiceFeedbacks.push('Văn phong quá ồn ào hoặc hối thúc thương mại')
  }
  voiceScore = Math.max(0, Math.min(10, voiceScore))
  const voiceFeedback = voiceFeedbacks.length > 0
    ? voiceFeedbacks.join('; ')
    : 'Giọng văn đúng chất Ưu Đàm: an tĩnh, chân thành, xưng tụi em, 0 cụm từ cấm'

  // ------------------------------------------------------------
  // Tiêu chí 3: Platform Formatting (Trọng số 20%)
  // ------------------------------------------------------------
  let fmtScore = 10
  const fmtFeedbacks: string[] = []

  switch (draft.channel) {
    case 'THREADS':
      // Strictly <= 500 ký tự
      if (content.length > 500) {
        fmtScore = 2.0
        fmtFeedbacks.push(`Vượt quá giới hạn Threads: ${content.length}/500 ký tự`)
      } else if (content.length < 50) {
        fmtScore -= 2.0
        fmtFeedbacks.push('Nội dung Threads quá ngắn')
      }
      break

    case 'TIKTOK':
      // Cấu trúc kịch bản video: Hook, Empathy/Thân bài, Spotlight, CTA
      const hasHook = /hook|0\.1s|giây đầu|mở đầu|âm thanh|hình ảnh/i.test(content)
      const hasScriptStructure = /\[.*\]|kịch bản|lời thoại|thực hiện|cảnh|khung hình/i.test(content)
      if (!hasHook || !hasScriptStructure) {
        fmtScore -= 3.0
        fmtFeedbacks.push('Chưa đúng cấu trúc kịch bản video ngắn TikTok (Hook 0.1s -> Cảnh -> Thoại)')
      }
      break

    case 'WEBSITE':
      // Blog: Tiêu đề, Slug, và độ dài bài viết contemplative
      if (!draft.title || draft.title.trim().length === 0) {
        fmtScore -= 3.0
        fmtFeedbacks.push('Website Blog thiếu tiêu đề')
      }
      if (!draft.slug || draft.slug.trim().length === 0) {
        fmtScore -= 2.0
        fmtFeedbacks.push('Website Blog thiếu slug công khai')
      }
      // Đếm từ hoặc kiểm tra độ dài bài viết blog (yêu cầu bài viết sâu sắc)
      const wordCount = content.trim().split(/\s+/).length
      if (wordCount < 400) {
        fmtScore -= 3.0
        fmtFeedbacks.push(`Độ dài blog chưa đủ sâu sắc (${wordCount} từ, kỳ vọng >= 400-800 từ)`)
      }
      break

    case 'INSTAGRAM': {
      // Hashtags bắt buộc: #uudam, #chualanh, #binhyen và tag tương ứng phân loại sản phẩm
      const tagText = `${content} ${draft.hashtags || ''}`.toLowerCase()
      const reqTags = ['#uudam', '#chualanh', '#binhyen']
      const cat = detectProductCategory(product)
      if (cat === 'TEA') reqTags.push('#trathien')
      else if (cat === 'INCENSE') reqTags.push('#tramhuong')
      else if (cat === 'CERAMIC') reqTags.push('#gomthucong')
      else reqTags.push('#nenthom')

      const missingTags = reqTags.filter((t) => {
        if (t === '#trathien') return !tagText.includes('#trathien') && !tagText.includes('#tra')
        if (t === '#tramhuong') return !tagText.includes('#tramhuong') && !tagText.includes('#tram')
        if (t === '#gomthucong') return !tagText.includes('#gomthucong') && !tagText.includes('#gom') && !tagText.includes('#tranh')
        return !tagText.includes(t)
      })
      if (missingTags.length > 0) {
        fmtScore -= Math.min(4, missingTags.length * 1.0)
        fmtFeedbacks.push(`Thiếu hashtags chuẩn Instagram: ${missingTags.join(', ')}`)
      }
      break
    }

    case 'EXTERNAL_CMS':
      if (!draft.title) {
        fmtScore -= 2.5
        fmtFeedbacks.push('CMS bài viết thiếu tiêu đề sản phẩm')
      }
      break

    case 'ZALO_OA':
      if (content.length > 2000) {
        fmtScore -= 2.0
        fmtFeedbacks.push('Tin thông báo Zalo OA quá dài')
      }
      break

    case 'FACEBOOK':
      if (content.length < 80) {
        fmtScore -= 2.0
        fmtFeedbacks.push('Bài viết Facebook quá ngắn, thiếu tính tự sự')
      }
      break
  }
  fmtScore = Math.max(0, Math.min(10, fmtScore))
  const fmtFeedback = fmtFeedbacks.length > 0
    ? fmtFeedbacks.join('; ')
    : `Định dạng hoàn hảo cho nền tảng ${draft.channel}`

  // ------------------------------------------------------------
  // Tiêu chí 4: Call to Action (Trọng số 20%)
  // ------------------------------------------------------------
  let ctaScore = 10
  const ctaFeedbacks: string[] = []

  const hasCta = /nhắn|ghé|mời mình|liên hệ|inbox|bình luận|link|ưu đãi|xem thêm|tìm hiểu|chia sẻ/i.test(content)
  if (!hasCta) {
    ctaScore -= 4.0
    ctaFeedbacks.push('Thiếu lời mời gọi hành động (CTA) tự nhiên')
  }
  ctaScore = Math.max(0, Math.min(10, ctaScore))
  const ctaFeedback = ctaFeedbacks.length > 0
    ? ctaFeedbacks.join('; ')
    : 'Lời mời gọi hành động nhẹ nhàng, không tạo áp lực'

  // ------------------------------------------------------------
  // TỔNG HỢP ĐIỂM
  // ------------------------------------------------------------
  const weightedScore =
    crmScore * 0.3 + voiceScore * 0.3 + fmtScore * 0.2 + ctaScore * 0.2

  const roundedOverall = Math.round(weightedScore * 10) / 10
  const passed = roundedOverall >= 8.0

  return {
    crmAccuracy: {
      score: crmScore,
      weight: 0.3,
      weightedScore: Math.round(crmScore * 0.3 * 10) / 10,
      passed: crmScore >= 8.0,
      feedback: crmFeedback,
    },
    brandVoice: {
      score: voiceScore,
      weight: 0.3,
      weightedScore: Math.round(voiceScore * 0.3 * 10) / 10,
      passed: voiceScore >= 8.0,
      feedback: voiceFeedback,
    },
    platformFormatting: {
      score: fmtScore,
      weight: 0.2,
      weightedScore: Math.round(fmtScore * 0.2 * 10) / 10,
      passed: fmtScore >= 8.0,
      feedback: fmtFeedback,
    },
    callToAction: {
      score: ctaScore,
      weight: 0.2,
      weightedScore: Math.round(ctaScore * 0.2 * 10) / 10,
      passed: ctaScore >= 8.0,
      feedback: ctaFeedback,
    },
    overallScore: roundedOverall,
    passed,
  }
}

// ============================================================
// 5. PLATFORM COPY GENERATOR (FEAT-AI-01 & FEAT-AI-04)
// ============================================================

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Trình sinh nội dung chuẩn mực theo từng kênh (Algorithmic Archetype Engine).
 * Được thiết kế tỉ mỉ, giàu chất thơ thiền, chia nhánh chuẩn xác theo phân loại sản phẩm:
 * - Trà: hương trà thanh tao, nghệ thuật pha trà tĩnh lặng, ấm áp (KHÔNG gán ánh sáng hay sáp).
 * - Nến: sáp đậu nành tự nhiên, bấc nến lách tách, ánh sáng vàng ấm.
 * - Trầm/Hương: làn khói trầm mộc mạc, thanh tịnh, tĩnh tại.
 * - Gốm/Tranh: đất sét phù sa, bàn tay người thợ gốm, nét men lam mộc mạc (KHÔNG gán sáp hay hương thơm nến).
 */
export function generateAlgorithmicDraft(params: {
  channel: SocialPlatform
  campaign: CampaignData
  product?: EnrichedProductPricing
  voucher?: EnrichedVoucherInfo
  driveAssets?: DriveAssetContext[]
  scheduledAt: Date
  variationIndex?: number
}): Omit<PlatformDraft, 'rubricEvaluation' | 'generationSource' | 'generationMeta'> {
  const { channel, campaign, product, voucher, driveAssets, scheduledAt, variationIndex = 0 } = params
  const category = detectProductCategory(product)
  const isThachCao = isThachCaoProduct(product)
  const angle = Math.abs(variationIndex) % 5

  const prodName = product?.name || 'Vật phẩm thủ công an yên'
  const prodPrice = product?.price ? formatVnd(product.price) : 'Giá ưu đãi'
  const origPrice = product?.originalPrice ? formatVnd(product.originalPrice) : ''
  const discountPct = product?.discountPercent ?? campaign.discountPercent
  const voucherCode = voucher?.code ?? campaign.voucherCode

  // Tìm tài nguyên ảnh hoặc video từ Drive hoặc từ Sản phẩm (Xoay vòng cửa sổ trượt theo variationIndex để không trùng ảnh)
  const mediaUrls: string[] = []
  let mediaType: PlatformDraft['mediaType'] = 'IMAGE'

  if (isThachCao && product?.image && channel !== 'TIKTOK') {
    mediaUrls.push(product.image)
  }

  if (driveAssets && driveAssets.length > 0) {
    if (channel === 'TIKTOK') {
      const vids = driveAssets.filter((a) => a.fileType === 'VIDEO')
      const vid = vids.length > 0 ? vids[Math.abs(variationIndex) % vids.length] : undefined
      if (vid && (vid.downloadUrl || vid.viewUrl)) {
        mediaUrls.push(vid.downloadUrl || vid.viewUrl!)
        mediaType = 'VIDEO'
      }
    }
    if (mediaUrls.length < 3) {
      const imgs = driveAssets.filter((a) => a.fileType === 'IMAGE')
      if (imgs.length > 0) {
        const startOffset = (Math.abs(variationIndex) * 2) % imgs.length
        for (let step = 0; step < imgs.length; step++) {
          const img = imgs[(startOffset + step) % imgs.length]
          const url = img.downloadUrl || img.viewUrl || img.thumbnailUrl
          if (url && !mediaUrls.includes(url)) {
            mediaUrls.push(url)
            if (mediaUrls.length >= 3) break
          }
        }
      }
    }
  }

  // Fallback sang ảnh sản phẩm nếu Drive chưa có
  if (mediaUrls.length === 0 && product?.image) {
    mediaUrls.push(product.image)
  }
  if (mediaUrls.length === 0 && campaign.bannerUrl) {
    mediaUrls.push(campaign.bannerUrl)
  }
  if (mediaUrls.length === 0) {
    if (category === 'TEA') {
      mediaUrls.push('https://images.unsplash.com/photo-1576092768241-dec231879fc3?auto=format&fit=crop&w=800&q=80')
    } else if (category === 'INCENSE') {
      mediaUrls.push('https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=800&q=80')
    } else if (category === 'CERAMIC') {
      mediaUrls.push('https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?auto=format&fit=crop&w=800&q=80')
    } else {
      mediaUrls.push('https://images.unsplash.com/photo-1603006905003-be475563bc59?auto=format&fit=crop&w=800&q=80')
    }
  }

  let title: string | null = null
  let slug: string | null = null
  let content = ''
  let excerpt: string | null = null
  let hashtags: string | null = null
  const targetUrl = `https://uudam.vn/campaigns/${campaign.code}`

  switch (channel) {
    // ------------------------------------------------------------
    // FACEBOOK: Tự sự, bình yên, đúng chủng loại sản phẩm, ưu đãi rõ ràng
    // ------------------------------------------------------------
    case 'FACEBOOK': {
      switch (category) {
        case 'TEA':
          title = `Gửi chén trà ấm và chút an yên cùng ${campaign.title}`
          hashtags = '#uudam #trathien #amtra #songcham #chualanh #uudamsuite'
          content = [
            `Có những buổi chiều, trở về nhà sau những bộn bề, chỉ cần một ấm trà nóng bên khung cửa sổ và hương thơm mộc mạc của ${prodName} cũng đủ để lòng mình dịu lại.`,
            '',
            `Tụi em ở Ưu Đàm luôn tin rằng, mỗi ấm trà hay tách gốm được làm ra bằng sự tĩnh lặng sẽ mang đến năng lượng an lành cho tâm hồn bạn hữu. Từng búp trà thơm lành, từng nét men gốm mộc mạc đều được chắt chiu bằng tất cả sự chân thành.`,
            '',
            `Nhân dịp "${campaign.title}", tụi em thương gửi đến mình chút duyên lành đặc biệt:`,
            `🌿 ${prodName}: ${prodPrice}${origPrice ? ` (giá niêm yết ${origPrice})` : ''}`,
            discountPct ? `🌿 Ưu đãi an yên: Giảm ${discountPct}% cho các sản phẩm trong chiến dịch.` : '',
            voucherCode ? `🌿 Mã ưu đãi thân gửi mình: ${voucherCode}` : '',
            '',
            `Nếu lòng đang cần một khoảng lặng, mời mình nhắn tụi em hoặc ghé tiệm nhấp chén trà ấm nha. Tụi em luôn sẵn lòng sẻ chia cùng mình.`,
            '',
            hashtags,
          ]
            .filter(Boolean)
            .join('\n')
          excerpt = `Chén trà an yên gửi trao cùng ${campaign.title} tại tiệm Ưu Đàm.`
          break

        case 'INCENSE':
          title = `Làn khói trầm thanh tịnh, lắng lòng cùng ${campaign.title}`
          hashtags = '#uudam #tramhuong #xongtram #songcham #chualanh #uudamsuite'
          content = [
            `Có những khoảng lặng trong ngày, chỉ cần một làn khói mộc và hương thơm thanh tịnh của ${prodName} cũng đủ để mọi ưu phiền tan biến.`,
            '',
            `Tụi em ở Ưu Đàm luôn trân quý những giá trị linh thiêng từ gỗ trầm tự nhiên. Không hóa chất tạo mùi, không hương liệu nhân tạo, từng nén trầm mộc mang đến sự an định và thanh lọc gian nhà của bạn hữu.`,
            '',
            `Nhân dịp "${campaign.title}", tụi em thương gửi đến mình chút duyên lành đặc biệt:`,
            `🌿 ${prodName}: ${prodPrice}${origPrice ? ` (giá niêm yết ${origPrice})` : ''}`,
            discountPct ? `🌿 Ưu đãi an yên: Giảm ${discountPct}% cho các sản phẩm trong chiến dịch.` : '',
            voucherCode ? `🌿 Mã ưu đãi thân gửi mình: ${voucherCode}` : '',
            '',
            `Nếu lòng đang cần một khoảng lặng thanh tịnh, mời mình nhắn tụi em để thưởng chút hương gỗ tự nhiên nha. Tụi em luôn sẵn lòng sẻ chia cùng mình.`,
            '',
            hashtags,
          ]
            .filter(Boolean)
            .join('\n')
          excerpt = `Hương trầm an định gửi trao cùng ${campaign.title} tại tiệm Ưu Đàm.`
          break

        case 'CERAMIC':
          title = `Nét gốm thủ công mộc mạc điểm tô tổ ấm cùng ${campaign.title}`
          hashtags = '#uudam #gomthucong #tranhgom #homedecor #chualanh #uudamsuite'
          content = [
            `Có những góc nhỏ trong nhà, chỉ cần một nét gốm mộc mạc từ ${prodName} cũng đủ để không gian thêm phần ấm cúng và an định.`,
            '',
            `Tụi em ở Ưu Đàm luôn tin rằng, đất sét và phù sa qua bàn tay chuốt gốm tài hoa của người thợ sẽ lưu giữ hồn cốt thủ công tinh tế. Từng lớp men lam, từng đường nét tạo hình đều được gửi gắm trọn vẹn tình yêu thương và sự bền bỉ theo thời gian.`,
            '',
            `Nhân dịp "${campaign.title}", tụi em thương gửi đến mình chút duyên lành đặc biệt:`,
            `🌿 ${prodName}: ${prodPrice}${origPrice ? ` (giá niêm yết ${origPrice})` : ''}`,
            discountPct ? `🌿 Ưu đãi an yên: Giảm ${discountPct}% cho các sản phẩm trong chiến dịch.` : '',
            voucherCode ? `🌿 Mã ưu đãi thân gửi mình: ${voucherCode}` : '',
            '',
            `Nếu đang muốn làm mới không gian sống bằng chút bình yên mộc mạc, mời mình nhắn tụi em nha. Tụi em luôn sẵn lòng sẻ chia cùng mình.`,
            '',
            hashtags,
          ]
            .filter(Boolean)
            .join('\n')
          excerpt = `Gốm mộc thủ công gửi trao cùng ${campaign.title} tại tiệm Ưu Đàm.`
          break

        case 'CANDLE':
        default:
          title = isThachCao
            ? `Tuyệt tác thạch cao vi khoáng & nến bấc gỗ chữa lành — ${campaign.title}`
            : `Gửi chút an yên ngày chớm lạnh cùng ${campaign.title}`
          hashtags = isThachCao
            ? '#uudam #annhienthach #thachcaochualanh #nenbacgo #wabisabi #chualanh #uudamsuite'
            : '#uudam #nenthom #nenbo #songcham #chualanh #uudamsuite'
          content = [
            `Có những buổi chiều, trở về nhà sau những bộn bề, chỉ cần một đốm sáng nhỏ và hương thơm mộc mạc của ${prodName} cũng đủ để lòng mình dịu lại.`,
            '',
            isThachCao
              ? `Tụi em ở Ưu Đàm — An Nhiên Thạch luôn trân quý từng đường nét điêu khắc thạch cao vi khoáng trắng ngà mịn lì, không một vết bọt khí chuẩn phong cách Wabi-Sabi. Sự kết hợp giữa sáp đậu nành thiên nhiên, bấc gỗ reo tí tách êm đềm (ánh lửa ấm 2700K) và cốt thạch cao giữ hương tinh dầu bền lâu đã được 4 KOL Châu Á (Minh Khuê, Khánh Linh, Thanh Thảo, Bảo Trân) kiểm chứng. Khi dùng hết sáp, mình còn có thể nhỏ tinh dầu trực tiếp lên cốt thạch cao để tái sử dụng làm đá khuếch tán thơm phòng.`
              : `Tụi em ở Ưu Đàm luôn tin rằng, mỗi hũ nến được làm ra bằng sự tĩnh lặng sẽ mang đến năng lượng an lành cho không gian sống của bạn hữu. Từng hạt sáp đậu nành tự nhiên, bấc gỗ lách tách và hương tinh dầu dịu mát đều được chắt chiu bằng tất cả sự chân thành.`,
            '',
            `Nhân dịp "${campaign.title}", tụi em thương gửi đến mình chút duyên lành đặc biệt:`,
            `🌿 ${prodName}: ${prodPrice}${origPrice ? ` (giá niêm yết ${origPrice})` : ''}`,
            discountPct ? `🌿 Ưu đãi an yên: Giảm ${discountPct}% cho các sản phẩm trong chiến dịch.` : '',
            voucherCode ? `🌿 Mã ưu đãi thân gửi mình: ${voucherCode}` : '',
            isThachCao ? `🌿 Cam kết an tâm: Đóng gói hộp chống sốc EPE 4 lớp bảo toàn nguyên vẹn 100%, gửi ảnh chụp thật qua Zalo trước khi giao.` : '',
            '',
            `Nếu lòng đang cần một khoảng lặng, mời mình nhắn tụi em hoặc ghé tiệm chọn một mùi hương ấm áp nha. Tụi em luôn sẵn lòng sẻ chia cùng mình.`,
            '',
            hashtags,
          ]
            .filter(Boolean)
            .join('\n')
          excerpt = `Chút an yên gửi trao cùng ${campaign.title} tại tiệm Ưu Đàm.`
          break
      }
      break
    }

    // ------------------------------------------------------------
    // ZALO OA: Trang trọng, súc tích, phong cách thông báo thân mật
    // ------------------------------------------------------------
    case 'ZALO_OA': {
      title = `[Ưu Đàm] Gửi trao an lành - ${campaign.title}`
      let introDesc = ''
      let ctaDesc = ''

      switch (category) {
        case 'TEA':
          introDesc = `Trong chương trình "${campaign.title}", tụi em đã chuẩn bị những mẻ trà và ấm chén ${prodName} thơm lành nhất để gửi đến góc nhỏ của mình:`
          ctaDesc = `Mời mình bấm vào xem chi tiết để chọn cho góc thưởng trà hay bàn làm việc một thức uống ấm lòng nhé. Tụi em luôn ở đây hỗ trợ mình ạ.`
          break
        case 'INCENSE':
          introDesc = `Trong chương trình "${campaign.title}", tụi em đã tuyển chọn những mẻ trầm mộc ${prodName} thanh tịnh nhất để gửi đến góc nhỏ của mình:`
          ctaDesc = `Mời mình bấm vào xem chi tiết để mang làn hương trầm tự nhiên về thanh lọc gian nhà nhé. Tụi em luôn ở đây hỗ trợ mình ạ.`
          break
        case 'CERAMIC':
          introDesc = `Trong chương trình "${campaign.title}", tụi em đã hoàn thiện những tác phẩm thủ công ${prodName} mộc mạc nhất để gửi đến góc nhỏ của mình:`
          ctaDesc = `Mời mình bấm vào xem chi tiết để điểm tô cho tổ ấm nét men gốm tinh xảo nhé. Tụi em luôn ở đây hỗ trợ mình ạ.`
          break
        case 'CANDLE':
        default:
          introDesc = `Trong chương trình "${campaign.title}", tụi em đã chuẩn bị những mẻ ${prodName} thơm lành nhất để gửi đến góc nhỏ của mình:`
          ctaDesc = `Mời mình bấm vào xem chi tiết để chọn cho góc thiền hay bàn làm việc một đốm sáng ấm áp nhé. Tụi em luôn ở đây hỗ trợ mình ạ.`
          break
      }

      content = [
        `Thương gửi mình,`,
        '',
        `Tụi em bên tiệm Ưu Đàm xin gửi lời chúc một ngày an vui và thong dong đến bạn hữu.`,
        '',
        introDesc,
        `• Mức giá ưu đãi: ${prodPrice}`,
        discountPct ? `• Chiết khấu an yên: Giảm ${discountPct}%` : '',
        voucherCode ? `• Mã quà tặng dành riêng cho mình: ${voucherCode}` : '',
        '',
        ctaDesc,
      ]
        .filter(Boolean)
        .join('\n')
      excerpt = `Ưu đãi ${campaign.title} dành riêng cho bạn hữu Ưu Đàm qua Zalo OA.`
      break
    }

    // ------------------------------------------------------------
    // WEBSITE BLOG: Bài viết sâu sắc, chuẩn SEO, 400+ từ markdown
    // ------------------------------------------------------------
    case 'WEBSITE': {
      let craftSection = ''
      let ritualSection = ''

      switch (category) {
        case 'TEA':
          title = `Thưởng Một Chén Trà An Yên: Nghệ Thuật Nuôi Dưỡng Thân Tâm Giữa Đời Thường`
          slug = slugify(`thuong-mot-chen-tra-an-yen-${campaign.code.toLowerCase()}`)
          hashtags = '#uudam #trathien #songchambinhyen'
          excerpt = `Giữa nhịp sống hối hả, học cách dừng lại thưởng một ngụm trà ấm là phương thức giản dị nhất để tìm về chốn an yên trong tâm hồn.`
          craftSection = [
            `## 2. Hồn Cốt Trà Thiền Và Nét Gốm Mộc Mạc`,
            '',
            `Mỗi sản phẩm tại Ưu Đàm không đơn thuần là một vật phẩm tiêu dùng, mà là kết tinh của sự kiên nhẫn. Từng búp trà non được hái khi sương sớm còn đọng trên lá, xao khô bằng phương pháp truyền thống giữ trọn hương mộc thuần khiết. Kết hợp cùng ấm chén gốm mộc tráng men tự nhiên, mỗi ấm trà pha ra mang trọn vẹn vị chát dịu và hậu ngọt lắng sâu.`,
            '',
            `Khi dòng nước nóng chạm vào lá trà, hương thơm thảo mộc tự nhiên lan tỏa khắp gian phòng tựa như một làn gió sớm trong khu vườn thiền. Sự mộc mạc ấy giúp tâm trí người thưởng trà lắng xuống, các giác quan được xoa dịu một cách tự nhiên nhất.`,
            '',
            `> *"An yên không phải là không có bão giông, mà là tâm tĩnh lặng ngay giữa tâm bão."*`,
          ].join('\n')
          ritualSection = [
            `## 4. Cách Thiết Lập Một Bàn Trà Tĩnh Lặng Tại Gia`,
            '',
            `Để đón nhận trọn vẹn năng lượng an lành từ chén trà, mình có thể áp dụng vài bước nhỏ mỗi ngày:`,
            `1. **Dọn dẹp mặt bàn**: Chỉ để lại chiếc ấm chén mộc, một cuốn sách yêu thích và vật phẩm ${prodName}.`,
            `2. **Lắng nghe âm thanh**: Lắng nghe tiếng nước reo róc rách, tiếng rót trà vào chén trong trẻo êm đềm.`,
            `3. **Thưởng hương**: Nâng chén trà ngang tầm mắt, hít sâu hương trà thảo mộc thơm lành lan tỏa.`,
            `4. **Thưởng vị trong chánh niệm**: Nhấp từng ngụm nhỏ, cảm nhận hơi ấm lan tỏa khắp thân tâm.`,
          ].join('\n')
          break

        case 'INCENSE':
          title = `Làn Hương Trầm Tĩnh Tại: Nghệ Thuật Thanh Lọc Không Gian Giữa Đời Thường`
          slug = slugify(`lan-huong-tram-tinh-tai-${campaign.code.toLowerCase()}`)
          hashtags = '#uudam #tramhuong #songchambinhyen'
          excerpt = `Giữa nhịp sống hối hả, thắp một nén trầm tự nhiên thanh tịnh là phương thức giản dị nhất để thanh lọc không gian và tìm về chốn an yên.`
          craftSection = [
            `## 2. Tinh Hoa Gỗ Trầm Tự Nhiên Qua Bàn Tay Nghệ Nhân`,
            '',
            `Mỗi sản phẩm tại Ưu Đàm không đơn thuần là một vật phẩm tiêu dùng, mà là kết tinh của thời gian và đất trời. Bột trầm hương tự nhiên không tẩm ướp hóa chất tạo mùi hay chất cháy công nghiệp, giữ trọn vẹn hương gỗ trầm ấm, ngọt sâu và linh thiêng.`,
            '',
            `Khi làn khói trầm mỏng manh uốn lượn thong dong trong gian phòng, không gian như được gột rửa mọi năng lượng trì trệ. Hương thơm sâu lắng đưa tâm trí trở về trạng thái an định, giúp các giác quan được xoa dịu một cách tự nhiên nhất.`,
            '',
            `> *"An yên không phải là không có bão giông, mà là tâm tĩnh lặng ngay giữa tâm bão."*`,
          ].join('\n')
          ritualSection = [
            `## 4. Cách Thưởng Trầm Nuôi Dưỡng Tâm An Tại Gia`,
            '',
            `Để đón nhận trọn vẹn năng lượng an lành từ hương trầm, mình có thể áp dụng vài bước nhỏ mỗi tối:`,
            `1. **Chuẩn bị không gian**: Đặt lư xông hoặc khay trầm cùng vật phẩm ${prodName} ở nơi thoáng gió nhẹ.`,
            `2. **Châm nén trầm**: Đón lấy đốm tàn đỏ êm đềm, ngắm nhìn làn khói uốn lượn nhẹ nhàng.`,
            `3. **Tĩnh tâm thở sâu**: Ba nhịp thở vào - thở ra nhẹ nhàng để cảm nhận trọn vẹn hương gỗ tự nhiên thanh lọc tâm trí.`,
            `4. **Lắng nghe tĩnh lặng**: Dành 10 phút buông bỏ mọi suy nghĩ, hòa mình vào sự bình yên của hiện tại.`,
          ].join('\n')
          break

        case 'CERAMIC':
          title = `Nghệ Thuật Gốm Mộc Ưu Đàm: Chạm Vào Đất Mẹ Nuôi Dưỡng Bình Yên`
          slug = slugify(`nghe-thuat-gom-moc-uudam-${campaign.code.toLowerCase()}`)
          hashtags = '#uudam #gomthucong #songchambinhyen'
          excerpt = `Từng đường nét gốm thủ công mộc mạc điểm tô không gian sống, mang lại sự vững chãi và an định cho thân tâm.`
          craftSection = [
            `## 2. Hồn Cốt Thủ Công Từ Đất, Nước Và Đôi Bàn Tay Người Thợ Gốm`,
            '',
            `Mỗi tác phẩm gốm tại Ưu Đàm không đơn thuần là một vật phẩm trang trí, mà là kết tinh của sự tỉ mỉ. Đất sét từ những tầng phù sa màu mỡ trải qua bàn tay chuốt gốm tài hoa của nghệ nhân, tráng lớp men lam mộc mạc và nung ở nhiệt độ cao để đạt độ bền vững trường tồn.`,
            '',
            `Từng góc gốm mộc, từng đường rạn men tự nhiên đều mang theo hơi thở của đất mẹ và tâm huyết của người thợ. Nét đẹp giản dị ấy điểm tô cho không gian sống sự trang nhã, giúp tâm hồn người thưởng lãm lắng xuống và cảm nhận trọn vẹn sự an yên.`,
            '',
            `> *"An yên không phải là không có bão giông, mà là tâm tĩnh lặng ngay giữa tâm bão."*`,
          ].join('\n')
          ritualSection = [
            `## 4. Cách Bày Trí Không Gian Sống Tối Giản Và An Nhiên`,
            '',
            `Để kiến tạo một góc thiền mộc mạc với gốm thủ công, mình có thể áp dụng vài bước nhỏ:`,
            `1. **Chọn góc tĩnh**: Đặt vật phẩm ${prodName} ở vị trí đón ánh sáng tự nhiên nhẹ nhàng.`,
            `2. **Tối giản xung quanh**: Hạn chế đồ đạc rườm rà, để nét gốm mộc mạc trở thành điểm nhấn an lành.`,
            `3. **Chạm và cảm nhận**: Cảm nhận độ nhám mịn của men gốm thủ công, kết nối lại với những điều mộc mạc.`,
            `4. **Lắng đọng tâm trí**: Ngắm nhìn những đường nét thủ công chân phương để lòng mình nhẹ nhõm hơn sau ngày dài.`,
          ].join('\n')
          break

        case 'CANDLE':
        default:
          title = isThachCao
            ? `Nghệ Thuật Thạch Cao Vi Khoáng & Nến Bấc Gỗ Chữa Lành: Kiến Tạo Góc Tĩnh Tâm Wabi-Sabi`
            : `Thắp Một Đốm Sáng Bình Yên: Nghệ Thuật Nuôi Dưỡng Thân Tâm Giữa Đời Thường`
          slug = slugify(
            isThachCao
              ? `nghe-thuat-thach-cao-vi-khoang-nen-bac-go-${campaign.code.toLowerCase()}`
              : `thap-mot-dom-sang-binh-yen-${campaign.code.toLowerCase()}`
          )
          hashtags = isThachCao
            ? '#uudam #annhienthach #thachcaochualanh #nenbacgo #wabisabi'
            : '#uudam #songchambinhyeu #nghethuatnenthom'
          excerpt = isThachCao
            ? `Khám phá bộ sưu tập thạch cao vi khoáng mịn lì không bọt khí kết hợp nến bấc gỗ sáp thực vật từ An Nhiên Thạch · Ưu Đàm — tuyệt tác chữa lành được 4 KOL Châu Á bảo chứng.`
            : `Giữa nhịp sống hối hả, học cách dừng lại thắp một ngọn nến ấm là phương thức giản dị nhất để tìm về chốn an yên trong tâm hồn.`
          craftSection = isThachCao
            ? [
                `## 2. Tuyệt Tác Điêu Khắc Thạch Cao Vi Khoáng & Sáp Đậu Nành Bấc Gỗ`,
                '',
                `Mỗi tác phẩm thuộc dòng **An Nhiên Thạch** tại Ưu Đàm không đơn thuần là một vật phẩm trang trí, mà là sự giao hòa giữa nghệ thuật điêu khắc thạch cao vi khoáng cao cấp và liệu pháp hương thơm chữa lành. Cốt thạch cao được đúc đặc thủ công với bề mặt trắng ngà Wabi-Sabi mịn như lụa, hoàn toàn không có vết rỗ bọt khí như các sản phẩm đại trà.`,
                '',
                `Bên trong lớp thạch cao mát lạnh là sáp đậu nành thực vật thuần khiết cùng bấc gỗ tự nhiên phát tiếng kêu tí tách êm dịu như lửa trại đêm đông. Ánh lửa vàng ấm 2700K xuyên qua vân thạch cao tạo hiệu ứng hắt sáng tĩnh tại, không khói đen. Đặc biệt, khi dùng hết sáp nến, mình có thể nhỏ trực tiếp 3–4 giọt tinh dầu Đàn Hương hoặc Bạch Trà lên thành thạch cao để tái sử dụng trọn đời làm đá khuếch tán thơm phòng.`,
                '',
                `> *"An yên không phải là không có bão giông, mà là tâm tĩnh lặng ngay giữa tâm bão."*`,
              ].join('\n')
            : [
                `## 2. Hồn Cốt Thủ Công Từ Sáp Đậu Nành Và Tinh Dầu Thực Vật`,
                '',
                `Mỗi sản phẩm tại Ưu Đàm không đơn thuần là một vật phẩm tiêu dùng, mà là kết tinh của sự kiên nhẫn. Sáp đậu nành và sáp bơ tự nhiên thuần khiết hòa quyện cùng tinh dầu thảo mộc không pha tạp hương liệu độc hại.`,
                '',
                `Khi ánh lửa chạm vào bấc nến cotton, không có khói đen ngột ngạt mà chỉ có hương thơm dịu nhẹ lan tỏa, tựa như một làn sương sớm lướt qua khu vườn thiền. Sự mộc mạc ấy giúp tâm trí người thưởng lãm lắng xuống, các giác quan được xoa dịu một cách tự nhiên nhất.`,
                '',
                `> *"An yên không phải là không có bão giông, mà là tâm tĩnh lặng ngay giữa tâm bão."*`,
              ].join('\n')
          ritualSection = [
            `## 4. Cách Thiết Lập Một Góc Thiền Nến Thơm & Thạch Cao Tại Gia`,
            '',
            `Để đón nhận trọn vẹn năng lượng an lành, mình có thể áp dụng vài bước nhỏ sau mỗi tối:`,
            `1. **Dọn dẹp mặt bàn**: Chỉ để lại một cuốn sách yêu thích, một chiếc khay nhỏ và tuyệt tác ${prodName}.`,
            `2. **Điều chỉnh ánh sáng**: Tắt bớt đèn điện huỳnh quang, để ánh nến vàng ấm 2700K trở thành nguồn sáng chính.`,
            `3. **Lắng nghe âm thanh**: Bật một bản nhạc tần số 432Hz du dương và lắng nghe tiếng bấc gỗ reo tí tách êm đềm.`,
            `4. **Thưởng hương & Tái sử dụng**: Hít thở sâu hương Đàn Hương & Bạch Trà; hoặc nhỏ vài giọt tinh dầu lên cốt thạch cao để hương thơm lan tỏa tự nhiên cả khi không đốt nến.`,
          ].join('\n')
          break
      }

      content = [
        `# ${title}`,
        '',
        `*Tác giả: Ban Biên Tập Ưu Đàm*`,
        '',
        `## 1. Khoảng Lặng Giữa Những Đợt Sóng Cuộc Đời`,
        '',
        `Giữa nhịp sống đô thị cuồn cuộn với những guồng quay của công việc và deadline, có bao giờ bạn chợt nhận ra mình đã lâu không lắng nghe hơi thở của chính mình? Đôi khi, niềm hạnh phúc không nằm ở những điều xa xôi mà ẩn hiện ngay trong một buổi chiều buông rèm, khi ngoài hiên lất phất mưa và lòng mình tìm về một chốn nương náu bình yên.`,
        '',
        `Tụi em tại Ưu Đàm luôn ấp ủ một tâm nguyện: mang thiên nhiên mộc mạc và sự an định trở lại với từng gian phòng. Không gian ấy không cần quá cầu kỳ, chỉ cần một góc nhỏ tĩnh tại với ${prodName}, nơi mọi lo toan tạm gác lại sau cánh cửa.`,
        '',
        craftSection,
        '',
        `## 3. Món Quà Trao Gửi Cùng Chiến Dịch "${campaign.title}"`,
        '',
        `Để đồng hành cùng bạn hữu trên hành trình tìm về bình yên nội tại, tụi em tổ chức chương trình "${campaign.title}". Đây là dịp tụi em muốn tri ân những tâm hồn đã luôn yêu quý và gắn bó cùng tiệm suốt chặng đường qua.`,
        '',
        `Trong chương trình này, tụi em trân trọng giới thiệu:`,
        `- **Sản phẩm trọng tâm**: ${prodName}`,
        `- **Mức giá ưu đãi**: **${prodPrice}** ${origPrice ? `(giá gốc: ${origPrice})` : ''}`,
        discountPct ? `- **Tỷ lệ chiết khấu**: Giảm ${discountPct}% trực tiếp trên từng đơn hàng.` : '',
        voucherCode ? `- **Mã tri ân thân gửi**: Nhập mã \`${voucherCode}\` tại bước thanh toán để nhận thêm quà tặng an lành.` : '',
        '',
        ritualSection,
        '',
        `## 5. Lời Nhắn Nhủ Từ Ưu Đàm`,
        '',
        `Cuộc đời dẫu có nhiều thăng trầm, chỉ mong mình luôn giữ được một góc nhỏ bình yên trong lòng. Nếu lòng mình thấy mỏi mệt hay cần tìm một món quà ấm áp tặng người thương, mời mình nhắn tụi em hoặc ghé thăm tiệm Ưu Đàm nha. Tụi em luôn sẵn lòng sẻ chia cùng mình từng câu chuyện nhỏ.`,
      ]
        .filter(Boolean)
        .join('\n')
      break
    }

    // ------------------------------------------------------------
    // EXTERNAL CMS (WordPress / Haravan / Sapo): E-commerce, tính năng & giá
    // ------------------------------------------------------------
    case 'EXTERNAL_CMS': {
      title = `[Khuyến Mãi] ${prodName} - Ưu Đãi An Yên ${campaign.title}`
      let introCategory = ''
      let featureBullets: string[] = []

      switch (category) {
        case 'TEA':
          hashtags = '#uudam #khuyenmai #trathien'
          introCategory = `${prodName} là dòng sản phẩm trà và ấm chén thủ công cao cấp được chế tác riêng cho không gian thưởng trà thư thái tại Ưu Đàm. Sản phẩm kết hợp nguyên liệu tự nhiên thuần khiết, an toàn cho sức khỏe và đậm đà phong vị Việt.`
          featureBullets = [
            `• Nguyên liệu tự nhiên thượng hạng, hương trà thơm mộc tinh tế.`,
            `• Chế tác thủ công mộc mạc, giữ trọn hương vị và hơi ấm khi pha.`,
            `• Thiết kế trang nhã, điểm tô bàn trà và phòng khách phong cách Zen.`,
          ]
          break
        case 'INCENSE':
          hashtags = '#uudam #khuyenmai #tramhuong'
          introCategory = `${prodName} là dòng sản phẩm trầm hương tự nhiên cao cấp được tuyển chọn riêng cho không gian thiền định và tĩnh tâm tại Ưu Đàm. Sản phẩm hoàn toàn không tẩm ướp hóa chất, an toàn cho cả gia đình.`
          featureBullets = [
            `• 100% trầm hương tự nhiên nguyên chất, khói mỏng không cay mắt.`,
            `• Hương gỗ trầm ấm, thanh lọc không khí và xua tan căng thẳng.`,
            `• Thích hợp cho thiền định, yoga và không gian thờ cúng tôn nghiêm.`,
          ]
          break
        case 'CERAMIC':
          hashtags = '#uudam #khuyenmai #gomthucong'
          introCategory = `${prodName} là dòng tác phẩm gốm mộc thủ công tinh xảo được tạo tác riêng cho không gian sống an nhiên tại Ưu Đàm. Mỗi tác phẩm đều được chế tác tỉ mỉ từ đất sét tự nhiên nung nhiệt độ cao.`
          featureBullets = [
            `• Đất sét phù sa nung ở nhiệt độ cao, kết cấu bền chắc vĩnh cửu.`,
            `• Lớp men lam thủ công độc bản, mang vẻ đẹp hoài niệm trang nhã.`,
            `• Điểm tô tổ ấm, phòng khách, phòng làm việc thêm ấm cúng và an định.`,
          ]
          break
        case 'CANDLE':
        default:
          hashtags = '#uudam #khuyenmai #nenthom'
          introCategory = `${prodName} là dòng sản phẩm nến thơm thủ công cao cấp được chế tác riêng cho không gian sống thư thái tại Ưu Đàm. Sản phẩm kết hợp nguyên liệu tự nhiên 100%, an toàn cho sức khỏe và thân thiện với môi trường.`
          featureBullets = [
            `• Thành phần sáp đậu nành tự nhiên, không độc hại, không khói muội.`,
            `• Hương thơm thư giãn từ tinh dầu thảo mộc tự nhiên.`,
            `• Thiết kế hũ gốm hoặc thủy tinh trang nhã, điểm tô không gian sống.`,
          ]
          break
      }

      content = [
        `# ${title}`,
        '',
        `### Giới thiệu sản phẩm`,
        introCategory,
        '',
        `### Thông tin chương trình "${campaign.title}"`,
        `- Giá khuyến mãi: **${prodPrice}** ${origPrice ? `(Giá niêm yết: ${origPrice})` : ''}`,
        discountPct ? `- Mức giảm giá: **Giảm ${discountPct}%**` : '',
        voucherCode ? `- Mã ưu đãi áp dụng: **${voucherCode}**` : '',
        `- Thời gian áp dụng: Từ ${new Date(campaign.startDate).toLocaleDateString('vi-VN')} đến ${new Date(campaign.endDate).toLocaleDateString('vi-VN')}`,
        '',
        `### Đặc điểm nổi bật`,
        ...featureBullets,
        '',
        `Mời mình đặt mua ngay hôm nay để nhận trọn vẹn ưu đãi và quà tặng kèm từ tụi em nhé!`,
      ]
        .filter(Boolean)
        .join('\n')
      excerpt = `Mua ${prodName} giá ưu đãi ${prodPrice} trong chương trình ${campaign.title}.`
      break
    }

    // ------------------------------------------------------------
    // INSTAGRAM: Visual-first, ngắn gọn, giàu cảm xúc, hashtag chuẩn
    // ------------------------------------------------------------
    case 'INSTAGRAM': {
      let instaIntro = ''
      switch (category) {
        case 'TEA':
          hashtags = '#uudam #trathien #chualanh #binhyen #thugian #homedecor #songcham'
          instaIntro = `Góc nhỏ bình yên, thêm một chén trà ấm dịu dàng... 🌿\n\nTụi em vừa chuẩn bị mẻ trà và ấm chén ${prodName} mới, hương thảo mộc thanh tao vương trên từng góc nhỏ.`
          break
        case 'INCENSE':
          hashtags = '#uudam #tramhuong #chualanh #binhyen #thugian #homedecor #songcham'
          instaIntro = `Góc nhỏ bình yên, làn khói trầm uốn lượn thong dong... 🌿\n\nTụi em vừa hoàn thiện mẻ ${prodName} mới, hương trầm mộc tự nhiên lan tỏa tĩnh tại.`
          break
        case 'CERAMIC':
          hashtags = '#uudam #gomthucong #chualanh #binhyen #thugian #homedecor #songcham'
          instaIntro = `Góc nhỏ bình yên, nét gốm mộc mạc đậm tình người thợ... 🌿\n\nTụi em vừa hoàn thiện tác phẩm ${prodName} mới, men gốm thủ công tinh xảo điểm tô gian phòng.`
          break
        case 'CANDLE':
        default:
          hashtags = '#uudam #nenthom #chualanh #binhyen #thugian #homedecor #songcham'
          instaIntro = `Góc nhỏ bình yên, thêm một đốm sáng dịu dàng... 🌿\n\nTụi em vừa hoàn thiện mẻ ${prodName} mới, hương thảo mộc thanh tao vương trên từng góc gốm mộc.`
          break
      }

      content = [
        instaIntro,
        '',
        `Trong chương trình "${campaign.title}", tụi em thương gửi mình:`,
        `• Mức giá ưu đãi: ${prodPrice}`,
        discountPct ? `• Giảm ${discountPct}% an yên` : '',
        voucherCode ? `• Mã quà tặng: ${voucherCode}` : '',
        '',
        `Mời mình nhắn tin cho tụi em qua Direct Message để chọn món quà yêu thích nha ✨`,
        '',
        hashtags,
      ]
        .filter(Boolean)
        .join('\n')
      excerpt = `Góc nhỏ bình yên cùng ${prodName} tại Ưu Đàm.`
      break
    }

    // ------------------------------------------------------------
    // TIKTOK: Kịch bản video ngắn (Hook 0.1s -> Empathy -> Spotlight -> CTA)
    // ------------------------------------------------------------
    case 'TIKTOK': {
      mediaType = 'VIDEO'
      let hookDesc = ''
      let empathyDesc = ''
      let spotDesc = ''
      let ctaLine = ''

      switch (category) {
        case 'TEA':
          hashtags = '#uudam #trathien #chualanh #binhyen #learnontiktok'
          hookDesc = `Cận cảnh bàn tay nâng niu ấm gốm, dòng nước sôi rót vào chén trà trong vắt. Tiếng nước reo róc rách giòn tan, hơi ấm bốc lên êm đềm. Dòng chữ hiện lên màn hình: "Nếu hôm nay mình thấy mệt mỏi, dừng lại 3 giây nghe tiếng rót trà này nha..."`
          empathyDesc = `Góc máy quay chậm gian phòng tĩnh lặng, hơi trà nghi ngút trên bàn gỗ. Lời thoại nhẹ nhàng (Voiceover ấm áp của thợ tiệm): "Sau một ngày dài bận rộn ngoài kia, thứ mình cần nhất đôi khi chỉ là một chén trà nóng để lòng mình dịu lại."`
          spotDesc = `Góc cận 360 độ xoay quanh ${prodName}. Zoom vào chất men gốm mộc mạc và màu nước trà vàng óng. Lời thoại: "Món quà ${prodName} được tụi em chăm chút tỉ mỉ từ trà thơm và nghệ thuật gốm thủ công mộc mạc."`
          ctaLine = `"Mời mình nhấn vào link ở phần tiểu sử bio hoặc bình luận bên dưới, tụi em gửi tặng mình mã ưu đãi nhấp chén trà ấm nha!"`
          break

        case 'INCENSE':
          hashtags = '#uudam #tramhuong #chualanh #binhyen #learnontiktok'
          hookDesc = `Cận cảnh châm nén trầm, đốm tàn đỏ êm đềm bừng sáng rồi làn khói trắng mảnh mai uốn lượn thong dong... Dòng chữ hiện lên: "Nếu hôm nay lòng thấy chộn rộn, dừng lại 3 giây ngắm làn khói trầm này nha..."`
          empathyDesc = `Góc máy quay chậm không gian thiền tĩnh tại, khói trầm lan tỏa dịu mát. Lời thoại nhẹ nhàng: "Giữa những ồn ào ngoài kia, thứ ta cần nhất là một khoảng lặng để thanh lọc tâm trí."`
          spotDesc = `Góc cận 360 độ xoay quanh ${prodName}. Lời thoại: "Mỗi nén ${prodName} được tiện thủ công hoàn toàn từ trầm tự nhiên thanh khiết."`
          ctaLine = `"Mời mình nhấn vào link ở bio hoặc bình luận bên dưới, tụi em gửi tặng mã ưu đãi thưởng hương trầm an lành nha!"`
          break

        case 'CERAMIC':
          hashtags = '#uudam #gomthucong #chualanh #binhyen #learnontiktok'
          hookDesc = `Cận cảnh bàn tay người thợ chuốt gốm xoay đều trên bàn xoay, từng đường vân men lam hiện lên sống động... Dòng chữ hiện lên: "Nếu hôm nay thấy lòng vội vã, dừng lại 3 giây ngắm nét gốm mộc này nha..."`
          empathyDesc = `Góc máy quay góc phòng khách ấm cúng, chiếc bình gốm cắm cành hoa dại bên thềm nắng. Lời thoại: "Đôi khi chỉ cần một nét mộc mạc của gốm cũng đủ mang lại sự bình yên cho tổ ấm."`
          spotDesc = `Góc cận chi tiết ${prodName}, zoom vào đường rạn men lam cổ điển. Lời thoại: "Mỗi tác phẩm ${prodName} là tâm huyết từ đất sét và ngọn lửa nung kiên nhẫn của người thợ Ưu Đàm."`
          ctaLine = `"Mời mình nhấn vào link ở bio hoặc bình luận bên dưới, tụi em gửi tặng mã ưu đãi chọn tác phẩm gốm an yên nha!"`
          break

        case 'CANDLE':
        default:
          hashtags = '#uudam #nenthom #chualanh #binhyen #learnontiktok'
          hookDesc = `Cận cảnh bàn tay quẹt que diêm gỗ thắp lên đốm lửa nhỏ. Tiếng "tách" vang lên giòn tan, âm thanh bấc gỗ reo lách tách êm đềm. Dòng chữ hiện lên màn hình: "Nếu hôm nay mình thấy mệt mỏi, dừng lại 3 giây nghe tiếng này nha..."`
          empathyDesc = `Góc máy quay chậm gian phòng tối, ánh nến vàng lan tỏa trên mặt bàn gỗ. Lời thoại nhẹ nhàng (Voiceover ấm áp của thợ tiệm): "Sau một ngày dài bận rộn ngoài kia, thứ mình cần nhất đôi khi chỉ là một khoảng lặng cho riêng mình."`
          spotDesc = `Góc cận 360 độ xoay quanh ${prodName}. Zoom vào chất sáp đậu nành mịn màng và men gốm tinh xảo. Lời thoại: "Mỗi hũ ${prodName} này được tụi em đổ tay thủ công hoàn toàn từ sáp tự nhiên và tinh dầu thực vật."`
          ctaLine = `"Mời mình nhấn vào link ở phần tiểu sử bio hoặc bình luận bên dưới, tụi em gửi tặng mình mã ưu đãi để thắp sáng góc an yên nha!"`
          break
      }

      content = [
        `[KỊCH BẢN VIDEO NGẮN TIKTOK - ƯU ĐÀM]`,
        '',
        `[0.1s Hook - Mở đầu thị giác & âm thanh]:`,
        hookDesc,
        '',
        `[Empathy - Nỗi lòng & Đồng cảm]:`,
        empathyDesc,
        '',
        `[Product Spotlight - Điểm nhấn sản phẩm]:`,
        spotDesc,
        `Chữ nổi bật trên video: Giá ưu đãi ${prodPrice}${discountPct ? ` - Giảm ${discountPct}%` : ''}.`,
        voucherCode ? `Nhập mã ${voucherCode} để nhận thêm quà tặng.` : '',
        '',
        `[Call to Action - Kêu gọi hành động]:`,
        `Nhân vật nâng chén trà nóng, mỉm cười thư thái. ${ctaLine}`,
        '',
        hashtags,
      ]
        .filter(Boolean)
        .join('\n')
      excerpt = `Kịch bản video TikTok 0.1s Hook chữa lành cùng ${prodName}.`
      break
    }

    // ------------------------------------------------------------
    // THREADS: Hội thoại tâm tình, chân thật, STRICTLY <= 500 KÝ TỰ
    // ------------------------------------------------------------
    case 'THREADS': {
      let base = ''
      switch (category) {
        case 'TEA':
          base = `Chiều nay lành lạnh, pha ấm ${prodName} mà thơm ấm cả gian phòng. Cuộc sống vội vã quá, đôi khi chỉ cần một chén trà tĩnh tại để lòng mình dịu lại. Dịp "${campaign.title}" này, món an lành gửi mình giá ${prodPrice}${discountPct ? ` (giảm ${discountPct}%)` : ''}. Mã thân gửi: ${voucherCode || 'UUDAM'}. Nếu cần chút an yên, nhắn tụi em chia sẻ nha 🌿`
          break
        case 'INCENSE':
          base = `Chiều nay tĩnh lặng, tụi em châm nén ${prodName} mà khói trầm lan tỏa bình yên. Cuộc sống vội vã quá, mong mình luôn có góc nhỏ thanh tịnh. Dịp "${campaign.title}" này, món an lành gửi mình giá ${prodPrice}${discountPct ? ` (giảm ${discountPct}%)` : ''}. Mã thân gửi: ${voucherCode || 'UUDAM'}. Nhắn tụi em sẻ chia nha 🌿`
          break
        case 'CERAMIC':
          base = `Góc nhỏ bình yên điểm tô chút gốm mộc ${prodName}. Từng đường nét thủ công mộc mạc mang lại sự an định cho gian nhà. Dịp "${campaign.title}" này, món an lành gửi mình giá ${prodPrice}${discountPct ? ` (giảm ${discountPct}%)` : ''}. Mã thân gửi: ${voucherCode || 'UUDAM'}. Nếu hữu duyên, nhắn tụi em chia sẻ nha 🌿`
          break
        case 'CANDLE':
        default:
          base = `Chiều nay lành lạnh, tụi em ngồi thắp hũ ${prodName} mà thơm ấm cả gian phòng. Cuộc sống vội vã quá, đôi khi chỉ cần một khoảng lặng nhỏ để lòng mình dịu lại. Dịp "${campaign.title}" này, món an lành gửi mình giá ${prodPrice}${discountPct ? ` (giảm ${discountPct}%)` : ''}. Mã thân gửi: ${voucherCode || 'UUDAM'}. Nếu cần chút an yên, nhắn tụi em chia sẻ nha 🌿`
          break
      }
      content = base
      excerpt = `Tâm tình chiều muộn cùng Ưu Đàm trên Threads.`
      break
    }
  }

  // Nếu variationIndex > 0 (bài thứ 2, 3, 4... trên cùng kênh), xoay vòng 5 góc khai thác (Content Angles) để không bao giờ trùng lặp câu chữ
  if (angle > 0 && channel !== 'THREADS') {
    const kolNames = ['Minh Khuê (Lifestyle & Thiền)', 'Khánh Linh (Home Decor Wabi-Sabi)', 'Thanh Thảo (Aromatherapy)', 'Bảo Trân (Mindful Living)']
    const chosenKol = kolNames[angle % kolNames.length]
    const angleIntroMap: Record<number, string> = {
      1: `Góc nhìn nghệ nhân Ưu Đàm: Để tạo nên một tuyệt tác ${prodName} đạt chuẩn thẩm mỹ tĩnh tại, từng mẻ nguyên liệu đều trải qua quá trình tuyển chọn và chế tác thủ công tỉ mỉ.`,
      2: `Chia sẻ từ bạn hữu & KOL ${chosenKol}: "Điều làm mình thương nhất ở ${prodName} của tiệm Ưu Đàm chính là cảm giác bình yên, mộc mạc ngay từ khoảnh khắc mở hộp."`,
      3: `Gợi ý sống xanh & tái sử dụng bền vững: Không chỉ dừng lại ở những giờ phút thưởng hương ấm áp, ${prodName} còn là vật phẩm trang trí và lưu hương tinh dầu lâu dài cho góc làm việc của mình.`,
      4: `Món quà trao tay người thương: Mỗi bộ ${prodName} trước khi rời tiệm đều được tụi em nâng niu trong hộp chống sốc 4 lớp và gửi ảnh chụp thật để mình trọn vẹn an tâm.`,
    }
    const angleNote = angleIntroMap[angle]
    if (angleNote && !content.includes(angleNote)) {
      content = `${angleNote}\n\n${content}`
    }
    if (title && angle > 0) {
      const titleSuffixes = ['', ' — Góc Nhìn Chế Tác Thủ Công', ' — Cảm Nhận Từ Bạn Hữu & KOL', ' — Nghệ Thuật Sống Chậm & Tái Sử Dụng', ' — Món Quà Bình Yên Trao Tay']
      title = `${title}${titleSuffixes[angle] || ` (Phần ${angle + 1})`}`
    }
    if (slug && angle > 0) {
      slug = `${slug}-goc-${angle + 1}`
    }
  } else if (angle > 0 && channel === 'THREADS') {
    const threadOpeners = [
      '',
      `Đêm muộn tĩnh lặng, thắp nhẹ ${prodName} nghe lòng bình yên lạ kỳ.`,
      `Góc bàn làm việc hôm nay có thêm ${prodName} thơm dịu từ Ưu Đàm.`,
      `Một món quà nhỏ chữa lành tâm trí sau ngày dài: ${prodName}.`,
      `Thưởng thức trọn vẹn sự an nhiên trong từng khoảnh khắc cùng ${prodName}.`,
    ]
    const opener = threadOpeners[angle]
    if (opener) {
      content = `${opener} Dịp "${campaign.title}", tụi em thương gửi mình mức giá ưu đãi ${prodPrice}${discountPct ? ` (giảm ${discountPct}%)` : ''}, kèm mã ${voucherCode || 'UUDAM'}. Mời mình nhắn tụi em sẻ chia nha 🌿`
    }
  }

  // Chạy qua lớp Brand Voice Sanitizer
  content = sanitizeBrandVoice(content)

  // Cưỡng chế CRM Invariant Matcher
  content = enforceCrmInvariants(content, campaign, product, voucher, channel)

  // Đảm bảo Threads không bao giờ vượt quá 500 ký tự sau khi enforce
  if (channel === 'THREADS') {
    if (content.length > 500) {
      const crmTag = ` (${prodPrice}${discountPct ? ` -${discountPct}%` : ''} mã ${voucherCode || 'UUDAM'})`
      const suffix = `... Mời mình nhắn tụi em nha 🌿${crmTag}`
      const targetLen = 500 - suffix.length
      if (targetLen > 10) {
        const shortCore = content.slice(0, targetLen).replace(/[,\s]+$/, '')
        content = `${shortCore}${suffix}`
      } else {
        content = content.slice(0, 500)
      }
    }
    if (content.length > 500) {
      content = content.slice(0, 500)
    }
  }

  return {
    channel,
    title,
    slug,
    content,
    excerpt,
    mediaUrls,
    mediaType,
    hashtags,
    targetUrl,
    scheduledAt,
  }
}

/**
 * Trình sinh bản thảo tích hợp AI (Google Gemini / LLM / ZAI) có fallback thuật toán an toàn.
 * Ghi nhận rõ ràng generationSource ('LLM' | 'TEMPLATE_FALLBACK') và generationMeta.
 * Timeout nâng lên 35 giây (35,000ms), không fallback im lặng.
 */
export async function generatePlatformDraft(
  params: GeneratePlatformDraftOptions
): Promise<PlatformDraft> {
  const { channel, campaign, product, voucher, driveAssets, scheduledAt, customPrompt, llmCaller, variationIndex = 0 } = params
  const category = detectProductCategory(product)
  const caller = llmCaller || llmChat
  const LLM_TIMEOUT_MS = 35000 // 35 seconds per Sentinel directive

  // 1. Sinh bản thảo cơ sở qua Algorithmic Engine để đảm bảo 100% invariant và phân loại sản phẩm
  const baseDraft = generateAlgorithmicDraft({
    channel,
    campaign,
    product,
    voucher,
    driveAssets,
    scheduledAt,
    variationIndex,
  })

  let finalDraftContent = baseDraft.content
  let finalTitle = baseDraft.title
  let finalSlug = baseDraft.slug
  let finalExcerpt = baseDraft.excerpt

  let generationSource: 'LLM' | 'TEMPLATE_FALLBACK' = 'TEMPLATE_FALLBACK'
  let generationMeta: GenerationMeta = {
    model: 'template-algorithmic-v2',
    latencyMs: 0,
  }

  const startTime = Date.now()

  // 2. Thử tinh chỉnh hoặc sinh mới qua LLM với timeout 35 giây
  try {
    const prodInfo = product
      ? `Sản phẩm: ${product.name}, Phân loại: ${category}, Giá khuyến mãi: ${formatVnd(product.price)}, Giảm: ${product.discountPercent ?? campaign.discountPercent ?? 0}%`
      : 'Không gắn sản phẩm cụ thể'
    const voucherInfo = voucher ? `Mã voucher: ${voucher.code}` : campaign.voucherCode ? `Mã voucher: ${campaign.voucherCode}` : 'Không có'

    const systemPrompt = `Bạn là Giám đốc Sáng tạo và Chăm sóc Khách hàng tại Tiệm Ưu Đàm (OPENVN · Ưu Đàm Suite).
Thương hiệu Ưu Đàm định vị: Trầm hương tự nhiên, nến thơm thủ công, gốm men lam, trà thiền, phong cách an nhiên, chữa lành, sâu sắc.
Quy tắc vàng:
1. Xưng 'tụi em' hoặc 'Ưu Đàm', gọi người đọc là 'mình' hoặc 'bạn hữu'.
2. TUYỆT ĐỐI KHÔNG dùng các từ cấm AI sáo rỗng: 'kính chào', 'quý khách', 'trải nghiệm tuyệt vời', 'hân hạnh', 'động lực quý báu', 'cơ hội không thể bỏ lỡ'...
3. BẮT BUỘC giữ đúng thông tin CRM: ${prodInfo}; ${voucherInfo}.
4. ĐÚNG THUỘC TÍNH SẢN PHẨM: Trà nói về hương trà/thưởng trà; Nến nói về sáp/ngọn lửa; Trầm nói về khói trầm/thanh tịnh; Gốm nói về nét vuốt men lam thủ công. TUYỆT ĐỐI KHÔNG gán đốm sáng hay sáp nến cho trà hoặc gốm.
5. Kênh đăng: ${channel}.
${channel === 'THREADS' ? 'LƯU Ý ĐẶC BIỆT: THREADS BẮT BUỘC PHẢI DƯỚI 500 KÝ TỰ!' : ''}
${channel === 'TIKTOK' ? 'Viết theo cấu trúc Kịch bản video (Hook 0.1s -> Nỗi lòng -> Spotlight sản phẩm -> Kêu gọi hành động).' : ''}
${channel === 'WEBSITE' ? 'Viết bài blog giàu cảm xúc, phân tích sâu sắc về lối sống an yên, cấu trúc markdown chuẩn với các mục rõ ràng.' : ''}`

    const userPrompt = `Hãy viết một bài đăng hoàn hảo cho kênh ${channel} trong chiến dịch "${campaign.title}".
Mô tả chiến dịch: ${campaign.description || 'Lan tỏa an lành và sự tĩnh tại'}.
${customPrompt ? `Yêu cầu thêm từ chủ tiệm: ${customPrompt}` : ''}
Bài viết nháp gợi ý của tiệm:
---
${baseDraft.content}
---
Hãy viết nội dung chân thành, đúng chất Ưu Đàm, đúng sản phẩm và tuân thủ các quy tắc trên.`

    const aiResponse = await caller(systemPrompt, userPrompt, LLM_TIMEOUT_MS)
    const latency = Date.now() - startTime

    if (aiResponse && aiResponse.trim().length > 0) {
      let candidate = sanitizeBrandVoice(aiResponse.trim())
      candidate = enforceCrmInvariants(candidate, campaign, product, voucher, channel)

      // Kiểm tra tính hợp lệ của Threads
      if (channel === 'THREADS' && candidate.length > 500) {
        const prodPrice = product?.price ? formatVnd(product.price) : 'Giá ưu đãi'
        const discountPct = product?.discountPercent ?? campaign.discountPercent
        const voucherCode = voucher?.code ?? campaign.voucherCode
        const crmTag = ` (${prodPrice}${discountPct ? ` -${discountPct}%` : ''} mã ${voucherCode || 'UUDAM'})`
        const suffix = `... Mời mình nhắn tụi em nha 🌿${crmTag}`
        const targetLen = 500 - suffix.length
        if (targetLen > 10) {
          const shortCore = candidate.slice(0, targetLen).replace(/[,\s]+$/, '')
          candidate = `${shortCore}${suffix}`
        }
        if (candidate.length > 500) {
          candidate = candidate.slice(0, 500)
        }
      }

      // Đánh giá thử qua Rubric
      const candidateRubric = evaluateDraftRubric(
        {
          channel,
          title: finalTitle,
          slug: finalSlug,
          content: candidate,
          mediaUrls: baseDraft.mediaUrls,
          hashtags: baseDraft.hashtags,
        },
        campaign,
        product,
        voucher
      )

      if (candidateRubric.overallScore >= 8.0) {
        finalDraftContent = candidate
        generationSource = 'LLM'
        generationMeta = {
          model: 'gemini-2.0-flash',
          latencyMs: latency,
        }
      } else {
        const errMsg = `Nội dung do LLM sinh không đạt ngưỡng Rubric (${candidateRubric.overallScore}/10 < 8.0)`
        console.warn(`[SocialAI] ${errMsg}. Chuyển sang dùng bản thảo mẫu theo phân loại sản phẩm.`)
        generationSource = 'TEMPLATE_FALLBACK'
        generationMeta = {
          model: 'template-algorithmic-v2',
          latencyMs: latency,
          error: errMsg,
        }
      }
    } else {
      const errMsg = 'LLM không phản hồi hoặc chưa cấu hình API key hợp lệ'
      console.warn(`[SocialAI] Gọi LLM không khả dụng (${latency}ms): ${errMsg}. Dùng bản thảo mẫu theo phân loại sản phẩm.`)
      generationSource = 'TEMPLATE_FALLBACK'
      generationMeta = {
        model: 'template-algorithmic-v2',
        latencyMs: latency,
        error: errMsg,
      }
    }
  } catch (err) {
    const latency = Date.now() - startTime
    const errMsg = err instanceof Error ? err.message : String(err)
    console.warn(`[SocialAI] Lỗi khi gọi LLM (${latency}ms): ${errMsg}. Dùng bản thảo mẫu theo phân loại sản phẩm.`)
    generationSource = 'TEMPLATE_FALLBACK'
    generationMeta = {
      model: 'template-algorithmic-v2',
      latencyMs: latency,
      error: errMsg,
    }
  }

  // Đảm bảo Threads không bao giờ vượt quá 500 ký tự
  if (channel === 'THREADS' && finalDraftContent.length > 500) {
    finalDraftContent = finalDraftContent.slice(0, 500)
  }

  // 3. Đánh giá Rubric bản thảo cuối cùng
  const rubricEvaluation = evaluateDraftRubric(
    {
      channel,
      title: finalTitle,
      slug: finalSlug,
      content: finalDraftContent,
      mediaUrls: baseDraft.mediaUrls,
      hashtags: baseDraft.hashtags,
    },
    campaign,
    product,
    voucher
  )

  return {
    channel,
    title: finalTitle,
    slug: finalSlug,
    content: finalDraftContent,
    excerpt: finalExcerpt,
    mediaUrls: baseDraft.mediaUrls,
    mediaType: baseDraft.mediaType,
    hashtags: baseDraft.hashtags,
    targetUrl: baseDraft.targetUrl,
    scheduledAt,
    rubricEvaluation,
    generationSource,
    generationMeta,
  }
}

// ============================================================
// 6. CONTENT CALENDAR & SOCIAL PLAN GENERATOR (FEAT-AI-01)
// ============================================================

/**
 * Phân bổ các mốc thời gian đăng bài dàn trải đều trong khoảng startDate đến endDate của chiến dịch.
 */
export function calculateDistributedScheduleDates(
  startDate: Date | string,
  endDate: Date | string,
  count: number
): Date[] {
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).getTime()

  if (count <= 0) return []
  if (count === 1) {
    // 1 bài: đăng ở 1/3 thời gian chiến dịch
    return [new Date(startMs + Math.round((endMs - startMs) * 0.33))]
  }

  const duration = endMs - startMs
  const interval = duration / (count + 1)
  const dates: Date[] = []

  for (let i = 1; i <= count; i++) {
    const scheduledTime = new Date(Math.round(startMs + interval * i))
    dates.push(scheduledTime)
  }

  return dates
}

/**
 * Sinh kế hoạch nội dung mạng xã hội hoàn chỉnh (AI Planning Engine).
 */
export async function generateSocialPlan(
  campaignId: string,
  options?: GeneratePlanOptions
): Promise<GeneratedSocialPlanResult> {
  // 1. Nạp dữ liệu chiến dịch đã làm giàu
  const campaign = await getCampaign(campaignId)
  if (!campaign) {
    throw new Error(`Không tìm thấy chiến dịch có mã hoặc ID "${campaignId}"`)
  }

  // 2. Xác định danh sách nền tảng mục tiêu
  const targetPlatforms: SocialPlatform[] = (
    options?.platforms && options.platforms.length > 0
      ? (options.platforms as SocialPlatform[])
      : ALL_SOCIAL_PLATFORMS
  ).filter((p) => ALL_SOCIAL_PLATFORMS.includes(p))

  if (targetPlatforms.length === 0) {
    throw new Error('Danh sách nền tảng mục tiêu không hợp lệ')
  }

  const postsCount = options?.postsCount && options.postsCount > 0
    ? options.postsCount
    : targetPlatforms.length

  // 3. Nạp tài nguyên Drive nếu có contentSourceId (tối đa 120 tệp để xoay vòng ảnh không trùng lặp)
  let driveAssets: DriveAssetContext[] = []
  if (options?.contentSourceId) {
    try {
      const items = await db.contentSourceItem.findMany({
        where: { contentSourceId: options.contentSourceId },
        take: 120,
      })
      driveAssets = items.map((item) => ({
        id: item.id,
        name: item.name,
        mimeType: item.mimeType,
        fileType: item.fileType,
        viewUrl: item.webViewLink,
        thumbnailUrl: item.thumbnailUrl,
        downloadUrl: item.downloadUrl,
        textContent: item.textContent,
        path: item.path,
      }))
    } catch {
      // Bỏ qua nếu chưa nạp được item
    }
  }

  // 4. Tính toán lịch phân bổ thời gian
  const scheduleDates = calculateDistributedScheduleDates(
    campaign.startDate,
    campaign.endDate,
    postsCount
  )

  // 5. Chuẩn bị danh sách sản phẩm và voucher để xoay vòng gán vào các bài
  const products = campaign.products.length > 0 ? campaign.products : []
  const vouchers = campaign.vouchers.length > 0 ? campaign.vouchers : []

  // 6. Sinh từng bản thảo thích ứng với từng kênh (tự động xoay vòng góc viết khi 1 kênh xuất hiện nhiều lần)
  const posts: PlatformDraft[] = []
  const scoresByChannel: Record<string, number> = {}
  const channelOccurrenceCounts: Record<string, number> = {}
  const usedSlugs = new Set<string>()

  for (let i = 0; i < postsCount; i++) {
    const channel = targetPlatforms[i % targetPlatforms.length]
    const channelOccurrence = channelOccurrenceCounts[channel] || 0
    channelOccurrenceCounts[channel] = channelOccurrence + 1

    const scheduledAt = scheduleDates[i] || new Date(campaign.startDate)
    const product = products.length > 0 ? products[i % products.length] : undefined
    const voucher = vouchers.length > 0 ? vouchers[i % vouchers.length] : undefined

    const draft = await generatePlatformDraft({
      channel,
      campaign,
      product,
      voucher,
      driveAssets,
      scheduledAt,
      customPrompt: options?.customPrompt,
      llmCaller: options?.llmCaller,
      variationIndex: channelOccurrence,
    })

    // Đảm bảo slug bài viết Website không bao giờ trùng nhau trong cùng kế hoạch
    if (draft.slug) {
      let uniqueSlug = draft.slug
      let suffix = 2
      while (usedSlugs.has(uniqueSlug)) {
        uniqueSlug = `${draft.slug}-${suffix}`
        suffix++
      }
      draft.slug = uniqueSlug
      usedSlugs.add(uniqueSlug)
    }

    posts.push(draft)
    scoresByChannel[channel] = draft.rubricEvaluation.overallScore
  }

  // 7. Tổng hợp thống kê rubric
  const totalScore = posts.reduce((sum, p) => sum + p.rubricEvaluation.overallScore, 0)
  const averageScore = Math.round((totalScore / posts.length) * 10) / 10
  const allPassed = posts.every((p) => p.rubricEvaluation.passed)

  return {
    plan: {
      title: `Kế hoạch nội dung mạng xã hội: ${campaign.title}`,
      description: `Lịch đăng bài tự động trên ${targetPlatforms.length} nền tảng cho chiến dịch ${campaign.title} (${campaign.code}).`,
      targetAudience: 'Người yêu phong cách sống an yên, thiền trà, nến thơm và nghệ thuật thủ công mộc mạc.',
      brandTone: options?.brandTone || 'Trang nhã, từ bi, an định, hướng thiện, chân thành Ưu Đàm',
      startDate: new Date(campaign.startDate),
      endDate: new Date(campaign.endDate),
      totalPosts: posts.length,
      status: 'GENERATED',
    },
    posts,
    rubricSummary: {
      averageScore,
      allPassed,
      evaluatedCount: posts.length,
      scoresByChannel,
    },
  }
}

/**
 * Sinh kế hoạch và lưu trực tiếp vào cơ sở dữ liệu (`SocialPlan` và `SocialPost`).
 */
export async function createAndPersistSocialPlan(
  campaignId: string,
  options?: GeneratePlanOptions
): Promise<{
  plan: SocialPlan & {
    posts: Array<
      SocialPost & {
        rubricEvaluation?: PlatformDraft['rubricEvaluation']
        generationSource?: PlatformDraft['generationSource']
        generationMeta?: PlatformDraft['generationMeta']
      }
    >
  }
  rubricSummary: GeneratedSocialPlanResult['rubricSummary']
}> {
  const result = await generateSocialPlan(campaignId, options)

  // Chống trùng lặp slug với các bài viết đã có trong cơ sở dữ liệu
  const existingSlugsRows = await db.socialPost.findMany({
    where: { slug: { not: null } },
    select: { slug: true },
  })
  const dbSlugs = new Set(existingSlugsRows.map((r) => r.slug).filter((s): s is string => Boolean(s)))
  for (const post of result.posts) {
    if (post.slug) {
      let candidateSlug = post.slug
      let counter = 2
      while (dbSlugs.has(candidateSlug)) {
        candidateSlug = `${post.slug}-${counter}`
        counter++
      }
      post.slug = candidateSlug
      dbSlugs.add(candidateSlug)
    }
  }

  const hasLlm = result.posts.some((p) => p.generationSource === 'LLM')
  const aiModel = hasLlm ? 'gemini-2.0-flash' : 'template-algorithmic-v2'

  const createdPlan = await db.socialPlan.create({
    data: {
      campaignId,
      title: result.plan.title,
      description: result.plan.description,
      targetAudience: result.plan.targetAudience,
      brandTone: result.plan.brandTone,
      status: 'GENERATED',
      aiModel,
      promptUsed: options?.customPrompt || 'Ưu Đàm Auto Social Planning Engine',
      startDate: result.plan.startDate,
      endDate: result.plan.endDate,
      totalPosts: result.posts.length,
      approvedPosts: 0,
      publishedPosts: 0,
      posts: {
        create: result.posts.map((post) => ({
          campaignId,
          channel: post.channel,
          title: post.title,
          slug: post.slug,
          content: post.content,
          excerpt: post.excerpt,
          mediaUrls: JSON.stringify(post.mediaUrls),
          mediaType: post.mediaType,
          hashtags: post.hashtags,
          targetUrl: post.targetUrl,
          status: 'DRAFT',
          scheduledAt: post.scheduledAt,
          payloadSnapshot: JSON.stringify({
            rubricEvaluation: post.rubricEvaluation,
            generationSource: post.generationSource,
            generationMeta: post.generationMeta,
          }),
        })),
      },
    },
    include: {
      posts: true,
    },
  })

  return {
    plan: {
      ...createdPlan,
      posts: createdPlan.posts.map((p, idx) => ({
        ...p,
        rubricEvaluation: result.posts[idx]?.rubricEvaluation,
        generationSource: result.posts[idx]?.generationSource,
        generationMeta: result.posts[idx]?.generationMeta,
      })),
    },
    rubricSummary: result.rubricSummary,
  }
}
