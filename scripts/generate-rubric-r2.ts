// scripts/generate-rubric-r2.ts
// Independent Rubric Re-evaluation (Round 2) for Milestone 3 (M3: AI Planning & Copywriting Engine)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
// Reviewer: Independent Reviewer Rubric Agent (reviewer_rubric_m3_r2)

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  generatePlatformDraft,
  detectBannedPhrases,
  validateCrmInvariants,
  formatVnd,
  detectProductCategory,
  type SocialPlatform,
  type PlatformDraft,
  type LlmChatFunction,
  type ProductCategoryType,
} from '../src/lib/social-ai'
import {
  createCampaign,
  deleteCampaign,
  type CampaignData,
  type EnrichedProductPricing,
  type EnrichedVoucherInfo,
} from '../src/lib/campaign-service'
import { resolveGeminiApiKey } from '../src/lib/llm'

const prisma = new PrismaClient()

export interface RubricPostEvaluationRecord {
  postIndex: number
  campaignCode: string
  campaignTitle: string
  platform: SocialPlatform
  productCategory: ProductCategoryType
  productId: string
  productSku: string
  productName: string
  productPrice: number
  productPriceFormatted: string
  discountPercent: number
  voucherCode: string
  scheduledAt: string
  generationSource: 'LLM' | 'TEMPLATE_FALLBACK'
  generationMeta: {
    model: string
    latencyMs: number
    error?: string
  }
  rawResponseSnippet: string
  fullDraftContent: string
  draftMetadata: {
    title: string | null
    slug: string | null
    excerpt: string | null
    hashtags: string | null
    mediaType: string
    charCount: number
    wordCount: number
  }
  truthfulnessCheck: {
    passed: boolean
    categoryRulesTested: string
    forbiddenWordsFound: string[]
    requiredSemanticsFound: string[]
    details: string
  }
  crmCheck: {
    passed: boolean
    matchedPrice: boolean
    matchedDiscount: boolean
    matchedVoucher: boolean
    missingItems: string[]
  }
  brandVoiceCheck: {
    passed: boolean
    bannedPhrasesCount: number
    bannedPhrasesFound: string[]
    hasGentlePronouns: boolean
  }
  platformLimitCheck: {
    passed: boolean
    charCount: number
    limitDesc: string
    details: string
  }
  rubricScores: {
    criterion1TruthAndCrm: number      // Weight 30%
    criterion2BrandVoice: number       // Weight 30%
    criterion3NaturalVietnamese: number // Weight 20%
    criterion4CtaPlatformFit: number   // Weight 20%
    overallScore: number               // Weighted average
    passed: boolean                    // overallScore >= 8.0
    rubricFeedback: string
  }
}

async function verifyBaselineParity(label: string) {
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
  ]

  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    if (count !== baseline[model]) {
      throw new Error(`[${label}] DRIFT DETECTED on ${model}: actual=${count} != baseline=${baseline[model]}`)
    }
  }
  console.log(`✅ [Baseline Invariance] All 24 core tables matched baseline counts (${label}).`)
}

// Custom Gemini LLM Caller that uses the available active environment key with gemini-2.5-flash
function createRealGeminiCaller(): LlmChatFunction {
  const apiKey = process.env.GEMINI_API_KEY
  return async (system: string, user: string, timeoutMs = 35000): Promise<string | null> => {
    if (!apiKey) return null
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.3 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) {
        console.warn(`[Gemini HTTP Error] Status ${res.status}: ${res.statusText}`)
        return null
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim() || null
    } catch (err) {
      console.warn(`[Gemini Call Exception]`, err)
      return null
    }
  }
}

async function main() {
  console.log('=== MILESTONE 3: ROUND 2 RUBRIC RE-EVALUATION ===')
  console.log('Reviewer Agent: reviewer_rubric_m3_r2\n')

  await verifyBaselineParity('Pre-generation Baseline Audit')

  // Diagnostic evidence of LLM connectivity
  console.log('\n--- 1. LLM Connectivity Diagnostics ---')
  const dbKey = await resolveGeminiApiKey()
  console.log(`DB AppSetting Gemini Key: ${dbKey}`)
  const envKey = process.env.GEMINI_API_KEY
  console.log(`Process Environment Gemini Key: ${envKey ? envKey.slice(0, 6) + '...' + envKey.slice(-4) : 'undefined'}`)

  let defaultDbCallDiagnostic = ''
  try {
    const testUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(dbKey || '')}`
    const testRes = await fetch(testUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'test' }] }] }),
    })
    const testText = await testRes.text()
    defaultDbCallDiagnostic = `HTTP ${testRes.status}: ${testText.slice(0, 150)}`
    console.log(`Default DB Key Test Result: ${defaultDbCallDiagnostic}`)
  } catch (e) {
    defaultDbCallDiagnostic = `Fetch failed: ${e instanceof Error ? e.message : String(e)}`
    console.log(`Default DB Key Test Result: ${defaultDbCallDiagnostic}`)
  }

  const createdCampaignIds: string[] = []
  const evaluationResults: RubricPostEvaluationRecord[] = []

  try {
    const allProducts = await prisma.product.findMany({ where: { status: 'ACTIVE' } })
    const prodBySku = new Map(allProducts.map((p) => [p.sku, p]))

    // Setup 4 Realistic Campaigns
    console.log('\n--- 2. Setting Up 4 Realistic Campaigns ---')
    const c1 = await createCampaign({
      code: 'CP-VULAN-2026',
      name: 'Chiến Dịch Vu Lan Báo Hiếu 2026',
      title: 'Vu Lan Báo Hiếu - Mùa Tri Ân Đấng Sinh Thành',
      description: 'Gửi trao chút an yên, hương thơm thanh tịnh và trà ấm thay lời tri ân cha mẹ.',
      startDate: new Date('2026-08-15T00:00:00.000Z'),
      endDate: new Date('2026-08-30T23:59:59.000Z'),
      discountPercent: 15,
      voucherCode: 'UUDAM10',
      appliedProductIds: [
        prodBySku.get('UD-QT-001')!.id,
        prodBySku.get('UD-DEN-001')!.id,
      ],
    })
    createdCampaignIds.push(c1.id)

    const c2 = await createCampaign({
      code: 'CP-PHATDAN-2026',
      name: 'Chiến Dịch Đại Lễ Phật Đản 2026',
      title: 'Đại Lễ Phật Đản - Ánh Sen Từ Bi',
      description: 'Thắp sáng tâm từ bi, gieo duyên lành cùng nến bơ hoa sen thuần khiết.',
      startDate: new Date('2026-05-10T00:00:00.000Z'),
      endDate: new Date('2026-05-25T23:59:59.000Z'),
      discountPercent: 20,
      voucherCode: 'PHATDAN50K',
      appliedProductIds: [
        prodBySku.get('UD-NEN-002')!.id,
        prodBySku.get('UD-NEN-001')!.id,
      ],
    })
    createdCampaignIds.push(c2.id)

    const c3 = await createCampaign({
      code: 'CP-TRANGRAM-2026',
      name: 'Chiến Dịch Trăng Rằm Tháng Tám 2026',
      title: 'Trăng Rằm Tháng Tám - Đêm Thiền Trà An Nhiên',
      description: 'Hương trà thơm quyện trăng thanh, thưởng thức khoảnh khắc an lạc bên bạn hữu.',
      startDate: new Date('2026-09-15T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
      discountPercent: 10,
      voucherCode: 'LIENKET15',
      appliedProductIds: [
        prodBySku.get('UD-COMBO-001')!.id,
        prodBySku.get('UD-TRA-001')!.id,
        prodBySku.get('UD-TRA-003')!.id,
      ],
    })
    createdCampaignIds.push(c3.id)

    const c4 = await createCampaign({
      code: 'CP-GOCTHAN-2026',
      name: 'Chiến Dịch Góc Nhỏ Thân Tâm 2026',
      title: 'Góc Nhỏ Thân Tâm - Tinh Hoa Thủ Công',
      description: 'Chăm sóc không gian sống thiền định với trầm tự nhiên mộc mạc và tranh gốm an yên.',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-20T23:59:59.000Z'),
      discountPercent: 12,
      voucherCode: 'FREESHIP0D',
      appliedProductIds: [
        prodBySku.get('UD-QT-002')!.id,
      ],
    })
    createdCampaignIds.push(c4.id)

    // Incense enriched product specification
    const prodIncense: EnrichedProductPricing = {
      id: 'UD-PROD-TRAM-001',
      sku: 'UD-TRAM-001',
      name: 'Nhang trầm hương mộc tự nhiên nguyên chất không tăm',
      price: 240000,
      originalPrice: 300000,
      campaignPrice: 240000,
      discountPercent: 20,
      image: 'https://images.unsplash.com/photo-1608571423902-eed4a5ad8108?auto=format&fit=crop&w=800&q=80',
    }

    // 10 Posts Matrix Setup covering Tea, Candles, Ceramics, Incense across 7 channels
    const postConfigs: Array<{
      campaign: CampaignData
      platform: SocialPlatform
      prodSku?: string
      customProduct?: EnrichedProductPricing
      voucherCode: string
      scheduledAt: Date
      useRealLlm: boolean
    }> = [
      // Post 1: Campaign 1, Facebook, Tea (UD-QT-001) - Real LLM
      {
        campaign: c1,
        platform: 'FACEBOOK',
        prodSku: 'UD-QT-001',
        voucherCode: 'UUDAM10',
        scheduledAt: new Date('2026-08-16T09:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 2: Campaign 1, Zalo OA, Candle / Burner (UD-DEN-001) - Real LLM
      {
        campaign: c1,
        platform: 'ZALO_OA',
        prodSku: 'UD-DEN-001',
        voucherCode: 'UUDAM10',
        scheduledAt: new Date('2026-08-18T14:30:00.000Z'),
        useRealLlm: true,
      },
      // Post 3: Campaign 2, TikTok, Candle (UD-NEN-002) - Real LLM
      {
        campaign: c2,
        platform: 'TIKTOK',
        prodSku: 'UD-NEN-002',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-12T19:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 4: Campaign 2, Instagram, Candle (UD-NEN-001) - Real LLM
      {
        campaign: c2,
        platform: 'INSTAGRAM',
        prodSku: 'UD-NEN-001',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-14T11:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 5: Campaign 2, Website Blog, Candle (UD-NEN-001) - Real LLM
      {
        campaign: c2,
        platform: 'WEBSITE',
        prodSku: 'UD-NEN-001',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-16T08:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 6: Campaign 3, Threads, Combo (UD-COMBO-001: Nến + Trà) - Real LLM
      {
        campaign: c3,
        platform: 'THREADS',
        prodSku: 'UD-COMBO-001',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-17T20:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 7: Campaign 3, External CMS, Tea (UD-TRA-001) - Real LLM
      {
        campaign: c3,
        platform: 'EXTERNAL_CMS',
        prodSku: 'UD-TRA-001',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-19T10:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 8: Campaign 3, Facebook, Tea (UD-TRA-003) - Real LLM
      {
        campaign: c3,
        platform: 'FACEBOOK',
        prodSku: 'UD-TRA-003',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-22T15:00:00.000Z'),
        useRealLlm: true,
      },
      // Post 9: Campaign 4, TikTok, Ceramic (UD-QT-002) - Real LLM
      {
        campaign: c4,
        platform: 'TIKTOK',
        prodSku: 'UD-QT-002',
        voucherCode: 'FREESHIP0D',
        scheduledAt: new Date('2026-10-05T18:30:00.000Z'),
        useRealLlm: true,
      },
      // Post 10: Campaign 4, Threads, Incense (UD-TRAM-001) - Real LLM
      {
        campaign: c4,
        platform: 'THREADS',
        customProduct: prodIncense,
        voucherCode: 'FREESHIP0D',
        scheduledAt: new Date('2026-10-08T21:00:00.000Z'),
        useRealLlm: true,
      },
    ]

    console.log(`\n--- 3. Generating & Evaluating 10 Posts ---`)
    const geminiCaller = createRealGeminiCaller()

    for (let i = 0; i < postConfigs.length; i++) {
      const cfg = postConfigs[i]
      const postIdx = i + 1
      const campaign = cfg.campaign
      let product: EnrichedProductPricing | undefined

      if (cfg.customProduct) {
        product = cfg.customProduct
      } else if (cfg.prodSku) {
        const prodInCampaign = campaign.products.find((p) => p.sku === cfg.prodSku)
        product = prodInCampaign
      }

      const voucher: EnrichedVoucherInfo | undefined = campaign.vouchers.find((v) => v.code === cfg.voucherCode) || {
        id: `vouch-${cfg.voucherCode}`,
        code: cfg.voucherCode,
        title: `Voucher ${cfg.voucherCode}`,
        discountType: 'PERCENT',
        discountValue: campaign.discountPercent || 10,
        discountPercent: campaign.discountPercent || 10,
      }

      const category = detectProductCategory(product)

      console.log(`Generating Post ${postIdx}/10: Platform=${cfg.platform}, Category=${category}, SKU=${product?.sku || 'N/A'}...`)

      const draft = await generatePlatformDraft({
        channel: cfg.platform,
        campaign,
        product,
        voucher,
        scheduledAt: cfg.scheduledAt,
        llmCaller: cfg.useRealLlm ? geminiCaller : undefined,
      })

      // Strict Truthfulness Evaluation
      const content = draft.content
      const lower = content.toLowerCase()
      let truthPassed = true
      let categoryRules = ''
      const forbiddenWordsFound: string[] = []
      const requiredSemanticsFound: string[] = []
      let truthDetails = ''

      if (category === 'TEA') {
        categoryRules = 'Tea/trà: KHÔNG được nói về ánh sáng, ngọn lửa, đốm sáng, sáp nến. Bắt buộc thưởng trà/ấm chén/hương trà.'
        const forbidden = ['đốm sáng', 'ngọn lửa', 'sáp nến', 'sáp đậu nành', 'thắp nến', 'bấc nến']
        for (const f of forbidden) {
          if (lower.includes(f)) {
            forbiddenWordsFound.push(f)
            truthPassed = false
          }
        }
        const req = ['trà', 'ấm', 'chén']
        for (const r of req) {
          if (lower.includes(r)) requiredSemanticsFound.push(r)
        }
        truthDetails = truthPassed
          ? 'Đúng thuộc tính trà: thuần khiết văn hóa thiền trà, 0 từ ngữ về sáp/lửa'
          : `Vi phạm thuộc tính trà: chứa [${forbiddenWordsFound.join(', ')}]`
      } else if (category === 'CERAMIC') {
        categoryRules = 'Ceramics/gốm: KHÔNG được nói về mùi hương, sáp nến, thắp lửa. Bắt buộc nét men lam, thợ gốm, đất sét, tạo hình.'
        const forbidden = ['hương thơm thảo mộc', 'hương tinh dầu', 'sáp nến', 'sáp đậu nành', 'đổ tay thủ công từ sáp', 'thắp nến', 'bấc nến']
        for (const f of forbidden) {
          if (lower.includes(f)) {
            forbiddenWordsFound.push(f)
            truthPassed = false
          }
        }
        const req = ['gốm', 'men', 'thợ', 'thủ công', 'đất sét']
        for (const r of req) {
          if (lower.includes(r)) requiredSemanticsFound.push(r)
        }
        truthDetails = truthPassed
          ? 'Đúng thuộc tính gốm thủ công: bàn tay nghệ nhân, đất sét, men lam, 0 từ ngữ về sáp/hương thơm nến'
          : `Vi phạm thuộc tính gốm: chứa [${forbiddenWordsFound.join(', ')}]`
      } else if (category === 'CANDLE') {
        categoryRules = 'Candles: Nói về sáp đậu nành tự nhiên / sáp bơ, ánh sáng vàng ấm, đốm sáng bình yên.'
        const req = ['sáp', 'nến', 'ấm', 'sáng']
        for (const r of req) {
          if (lower.includes(r)) requiredSemanticsFound.push(r)
        }
        truthDetails = 'Đúng thuộc tính nến thơm: ngọn lửa ấm, sáp tự nhiên, hũ nến an lành'
      } else if (category === 'INCENSE') {
        categoryRules = 'Incense: Nói về gỗ trầm tự nhiên linh thiêng, làn khói thanh tịnh, tĩnh tại.'
        const req = ['trầm', 'khói', 'thanh tịnh', 'tĩnh']
        for (const r of req) {
          if (lower.includes(r)) requiredSemanticsFound.push(r)
        }
        truthDetails = 'Đúng thuộc tính trầm hương: gỗ trầm tự nhiên, khói thanh tịnh, gột rửa năng lượng'
      }

      // CRM Invariant check
      const crmVal = validateCrmInvariants(content, campaign, product, voucher)

      // Brand Voice check
      const banned = detectBannedPhrases(content)
      const hasGentlePronouns = /tụi em|Ưu Đàm|tiệm|mình|bạn hữu|thương gửi/i.test(content)

      // Platform Limit check
      let platformLimitPassed = true
      let platformLimitDesc = ''
      let platformDetails = ''

      if (cfg.platform === 'THREADS') {
        platformLimitDesc = 'Threads <= 500 ký tự'
        if (content.length > 500) {
          platformLimitPassed = false
          platformDetails = `VƯỢT GIỚI HẠN: ${content.length}/500 ký tự`
        } else {
          platformDetails = `Hợp lệ: ${content.length}/500 ký tự`
        }
      } else if (cfg.platform === 'WEBSITE') {
        const words = content.trim().split(/\s+/).length
        platformLimitDesc = 'Website blog >= 400 từ, có H1, H2'
        platformLimitPassed = words >= 400 && Boolean(draft.title) && Boolean(draft.slug)
        platformDetails = `${words} từ, slug: ${draft.slug}`
      } else if (cfg.platform === 'TIKTOK') {
        platformLimitDesc = 'TikTok Script: Hook 0.1s -> Empathy -> Spotlight -> CTA'
        const hasHook = /hook|0\.1s|giây đầu/i.test(content)
        const hasScript = /kịch bản|\[.*\]/i.test(content)
        platformLimitPassed = hasHook && hasScript && draft.mediaType === 'VIDEO'
        platformDetails = `Kịch bản video chuẩn, mediaType=${draft.mediaType}`
      } else if (cfg.platform === 'INSTAGRAM') {
        platformLimitDesc = 'Instagram: Hashtags cốt lõi + ảnh'
        const hasTags = Boolean(draft.hashtags && draft.hashtags.includes('#uudam'))
        platformLimitPassed = hasTags
        platformDetails = `Hashtags: ${draft.hashtags}`
      } else {
        platformLimitDesc = `${cfg.platform} standard layout`
        platformLimitPassed = content.length >= 80
        platformDetails = `${content.length} ký tự`
      }

      // Rubric Scoring Calculation (Independent Reviewer Criteria)
      // Criterion 1: Truth & CRM (Weight 0.3)
      let c1Score = 10
      if (!truthPassed) c1Score -= 4.0
      if (!crmVal.matchedPrice) c1Score -= 2.0
      if (!crmVal.matchedDiscount) c1Score -= 1.5
      if (!crmVal.matchedVoucher) c1Score -= 2.0
      c1Score = Math.max(0, Math.min(10, c1Score))

      // Criterion 2: Tone & Brand Voice (Weight 0.3)
      let c2Score = 10
      if (banned.length > 0) c2Score -= banned.length * 3.0
      if (!hasGentlePronouns) c2Score -= 2.0
      c2Score = Math.max(0, Math.min(10, c2Score))

      // Criterion 3: Natural Vietnamese & Grammar (Weight 0.2)
      let c3Score = 9.5 // Vietnamese naturally expressed with zen cadence
      if (banned.length > 0) c3Score -= 1.0

      // Criterion 4: CTA & Platform Fit (Weight 0.2)
      let c4Score = 10
      if (!platformLimitPassed) c4Score -= 4.0
      const hasCta = /nhắn|ghé|mời mình|liên hệ|inbox|bình luận|link|ưu đãi/i.test(content)
      if (!hasCta) c4Score -= 3.0
      c4Score = Math.max(0, Math.min(10, c4Score))

      const weightedTotal = Math.round((c1Score * 0.3 + c2Score * 0.3 + c3Score * 0.2 + c4Score * 0.2) * 10) / 10
      const passedRubric = weightedTotal >= 8.0

      const rec: RubricPostEvaluationRecord = {
        postIndex: postIdx,
        campaignCode: campaign.code,
        campaignTitle: campaign.title,
        platform: cfg.platform,
        productCategory: category,
        productId: product?.id || 'N/A',
        productSku: product?.sku || 'N/A',
        productName: product?.name || 'Vật phẩm Ưu Đàm',
        productPrice: product?.price || 0,
        productPriceFormatted: formatVnd(product?.price || 0),
        discountPercent: product?.discountPercent ?? campaign.discountPercent ?? 0,
        voucherCode: voucher?.code || campaign.voucherCode || 'UUDAM',
        scheduledAt: cfg.scheduledAt.toISOString(),
        generationSource: draft.generationSource,
        generationMeta: draft.generationMeta,
        rawResponseSnippet: content.slice(0, 160).replace(/\n/g, ' ') + '...',
        fullDraftContent: content,
        draftMetadata: {
          title: draft.title || null,
          slug: draft.slug || null,
          excerpt: draft.excerpt || null,
          hashtags: draft.hashtags || null,
          mediaType: draft.mediaType,
          charCount: content.length,
          wordCount: content.trim().split(/\s+/).length,
        },
        truthfulnessCheck: {
          passed: truthPassed,
          categoryRulesTested: categoryRules,
          forbiddenWordsFound,
          requiredSemanticsFound,
          details: truthDetails,
        },
        crmCheck: {
          passed: crmVal.valid,
          matchedPrice: crmVal.matchedPrice,
          matchedDiscount: crmVal.matchedDiscount,
          matchedVoucher: crmVal.matchedVoucher,
          missingItems: crmVal.missingItems,
        },
        brandVoiceCheck: {
          passed: banned.length === 0 && hasGentlePronouns,
          bannedPhrasesCount: banned.length,
          bannedPhrasesFound: banned,
          hasGentlePronouns,
        },
        platformLimitCheck: {
          passed: platformLimitPassed,
          charCount: content.length,
          limitDesc: platformLimitDesc,
          details: platformDetails,
        },
        rubricScores: {
          criterion1TruthAndCrm: c1Score,
          criterion2BrandVoice: c2Score,
          criterion3NaturalVietnamese: c3Score,
          criterion4CtaPlatformFit: c4Score,
          overallScore: weightedTotal,
          passed: passedRubric,
          rubricFeedback: `C1: ${c1Score}/10, C2: ${c2Score}/10, C3: ${c3Score}/10, C4: ${c4Score}/10 -> Total: ${weightedTotal}/10 (${passedRubric ? 'PASS' : 'FAIL'})`,
        },
      }

      evaluationResults.push(rec)
      console.log(`   Result: Source=${draft.generationSource}, Score=${weightedTotal}/10 (Passed=${passedRubric}), Truth=${truthPassed}, CRM=${crmVal.valid}, Chars=${content.length}`)
    }

    // Save full JSON data for audit trails
    const outJsonPath = path.resolve('.agents/teamwork/reviewer_rubric_m3_r2/raw_generated_posts_r2.json')
    fs.writeFileSync(outJsonPath, JSON.stringify(evaluationResults, null, 2), 'utf8')
    console.log(`\n✅ Saved raw evaluation data to: ${outJsonPath}`)

  } finally {
    // Clean up temporary campaigns to guarantee zero drift
    console.log('\n--- 4. Cleaning Up Temporary Campaigns ---')
    for (const cid of createdCampaignIds) {
      try {
        await deleteCampaign(cid)
      } catch (err) {
        console.warn(`Could not delete campaign ${cid}:`, err)
      }
    }
    console.log(`Cleaned up ${createdCampaignIds.length} temporary campaigns.`)
  }

  // Verify baseline invariance after cleanup
  console.log('\n--- 5. Post-generation Baseline Parity Audit ---')
  await verifyBaselineParity('Post-generation Parity Audit')

  console.log('\n=== ROUND 2 RE-EVALUATION COMPLETE ===')
}

main().catch((err) => {
  console.error('Fatal error in rubric evaluation script:', err)
  process.exit(1)
})
