// scripts/verify-m3-ai.ts
// Automated Verification Suite for Milestone 3 Remediation (M3 Fix)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
// Tests:
// 1. Initial 24-table core baseline parity (Delta = 0)
// 2. Ưu Đàm Brand Voice & Anti-AI Filter (0 banned phrases, gentle authentic phrasing)
// 3. Deterministic CRM Invariant Matcher (prices, discount %, vouchers, tamper healing)
// 4. Category-Truthful Copywriting across 4 product categories (Tea, Candle, Incense, Ceramic)
// 5. Generation Source & Metadata Tracking (LLM vs TEMPLATE_FALLBACK with model, latency, error)
// 6. Platform Copy Adaptation across all 7 channels (Threads strict <= 500 chars, TikTok script, Website 400+ words)
// 7. Extreme Adversarial Threads Length Stress Testing (<= 500 characters invariant)
// 8. Content Calendar Generation strictly within Campaign Time Boundaries
// 9. Rubric Quality Gate (>= 8.0/10 evaluated across 10 sample drafts)
// 10. Next.js 16 Route Handlers E2E (POST, GET, GET /[id] with generationSource & generationMeta, DELETE)
// 11. Clean Teardown & Final 24-table baseline invariance (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  sanitizeBrandVoice,
  detectBannedPhrases,
  validateCrmInvariants,
  enforceCrmInvariants,
  evaluateDraftRubric,
  generatePlatformDraft,
  generateAlgorithmicDraft,
  detectProductCategory,
  calculateDistributedScheduleDates,
  generateSocialPlan,
  createAndPersistSocialPlan,
  ALL_SOCIAL_PLATFORMS,
  type SocialPlatform,
  type PlatformDraft,
} from '../src/lib/social-ai'
import {
  createCampaign,
  deleteCampaign,
  type CampaignData,
} from '../src/lib/campaign-service'
import { GET as getAiPlans, POST as postAiPlan } from '../src/app/api/social/ai-plan/route'
import { GET as getAiPlanById, DELETE as deleteAiPlanById } from '../src/app/api/social/ai-plan/[id]/route'
import { NextRequest } from 'next/server'

const prisma = new PrismaClient()

let passedTests = 0
let failedTests = 0

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`)
    passedTests++
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedTests++
    throw new Error(`Assertion failed: ${testName}`)
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
    assert(count === baseline[model], `[${label}] Bảng baseline ${model}: actual=${count} == baseline=${baseline[model]}`)
  }
}

async function main() {
  console.log('======================================================================')
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MILESTONE 3 REMEDIATION (M3 FIX) 🚀')
  console.log('======================================================================\n')

  const createdCampaignIds: string[] = []
  const createdPlanIds: string[] = []

  try {
    // ------------------------------------------------------------------
    // GIAI ĐOẠN 1: ĐỐI SOÁT BASELINE BAN ĐẦU 24 BẢNG CỐT LÕI
    // ------------------------------------------------------------------
    console.log('--- [GIAI ĐOẠN 1] Đối soát baseline ban đầu 24 bảng cốt lõi ---')
    await verifyBaselineParity('Khởi đầu M3')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 2: BỘ LỌC NGÔN NGỮ THƯƠNG HIỆU ƯU ĐÀM & ANTI-AI FILTER
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 2] Bộ lọc Anti-AI & Giọng văn Thương hiệu Ưu Đàm (FEAT-AI-02) ---')

    const dirtyAiCopy = `Kính chào quý khách hàng thân mến!
Shop OmniSales vô cùng hân hạnh được phục vụ quý khách. Sự ủng hộ của quý khách là nguồn động lực quý báu để chúng tôi cải thiện chất lượng dịch vụ và nâng cao chất lượng sản phẩm.
Đây là trải nghiệm tuyệt vời nhất và cơ hội ngàn năm có một không thể bỏ lỡ! Hãy nhanh tay kẻo lỡ sản phẩm hàng đầu này!
Thân ái và trân trọng, chúng tôi cam kết mang lại sự hài lòng tuyệt đối!`

    const sanitized = sanitizeBrandVoice(dirtyAiCopy)
    const detectedRemaining = detectBannedPhrases(sanitized)

    assert(
      detectedRemaining.length === 0,
      'Anti-AI Filter loại bỏ 100% cụm từ cấm',
      `Còn sót cụm từ: ${detectedRemaining.join(', ')}`
    )
    assert(
      !sanitized.includes('kính chào quý khách'),
      'Đã triệt tiêu hoàn toàn "kính chào quý khách"'
    )
    assert(
      !sanitized.includes('OmniSales') && !sanitized.includes('Shop OmniSales'),
      'Đã thay thế triệt để tên hệ thống OmniSales sang Ưu Đàm'
    )
    assert(
      sanitized.includes('tụi em') || sanitized.includes('Ưu Đàm'),
      'Tự xưng tụi em / Ưu Đàm xuất hiện đúng chuẩn ngữ cảnh'
    )
    assert(
      !sanitized.includes('trải nghiệm tuyệt vời'),
      'Đã loại bỏ văn mẫu "trải nghiệm tuyệt vời"'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 3: DETERMINISTIC CRM INVARIANT MATCHER
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 3] Động cơ Cưỡng chế Bất biến Dữ liệu CRM (FEAT-AI-03) ---')

    // Lấy một sản phẩm thật từ CSDL để liên kết chiến dịch
    const existingDbProduct = await prisma.product.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, sellPrice: true },
    })
    assert(!!existingDbProduct, 'Tìm thấy sản phẩm thật trong DB để thử nghiệm')

    // Tạo chiến dịch mẫu thật trong DB
    const testCampaign = await createCampaign({
      code: 'CP-TEST-M3-AI-01',
      name: 'Chiến Dịch Thiền Trà & Nến Bơ Mùa Thu',
      title: 'Mùa An Yên - Thiền Trà & Nến Bơ Ưu Đàm',
      description: 'Chương trình tri ân mùa thu với hương thơm thảo mộc và ánh nến ấm áp.',
      startDate: new Date('2026-11-01T08:00:00.000Z'),
      endDate: new Date('2026-11-10T22:00:00.000Z'),
      discountPercent: 15,
      voucherCode: 'UUDAM15THU',
      appliedProductIds: [existingDbProduct!.id],
    })
    createdCampaignIds.push(testCampaign.id)

    const prod = testCampaign.products[0]
    assert(!!prod, 'Chiến dịch thử nghiệm có sản phẩm làm giàu hợp lệ')

    // 1. Kiểm tra văn bản thiếu giá / sai voucher
    const draftWithoutPrice = 'Hương nến bơ mùa thu thơm ngát lòng người. Hãy cùng ghé Ưu Đàm nhé.'
    const check1 = validateCrmInvariants(draftWithoutPrice, testCampaign, prod)
    assert(!check1.valid, 'Phát hiện chính xác văn bản thiếu giá và mã voucher CRM')
    assert(!check1.matchedPrice, 'Xác nhận thiếu giá sản phẩm')
    assert(!check1.matchedVoucher, 'Xác nhận thiếu mã voucher')

    // 2. Dùng enforceCrmInvariants để tự động sửa chữa bất biến
    const healedCopy = enforceCrmInvariants(draftWithoutPrice, testCampaign, prod, undefined, 'FACEBOOK')
    const check2 = validateCrmInvariants(healedCopy, testCampaign, prod)
    assert(check2.valid, 'Deterministic Matcher đã hiệu đính và bổ sung 100% dữ liệu CRM chuẩn xác')
    assert(check2.matchedPrice, `Giá sản phẩm đã xuất hiện chính xác (${prod?.price})`)
    assert(check2.matchedDiscount, 'Tỷ lệ giảm giá 15% đã hiện diện chính xác')
    assert(check2.matchedVoucher, 'Mã voucher UUDAM15THU đã hiện diện chính xác')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 4: ĐÚNG SỰ THẬT THEO PHÂN LOẠI SẢN PHẨM (CATEGORY-TRUTHFUL FALLBACK)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 4] Kiểm định Tính Chân Thực Phân Loại Sản Phẩm (Category-Truthful Copy) ---')

    // 1. Test Trà (Tea): Hộp quà tặng trà sơn thủy
    const teaProduct = {
      id: 'p-tea-01',
      name: 'Hộp quà tặng trà sơn thủy kèm 2 hũ gốm',
      sku: 'UD-QT-001',
      price: 450000,
      originalPrice: 500000,
      campaignPrice: 450000,
      discountPercent: 10,
    }
    assert(detectProductCategory(teaProduct) === 'TEA', 'Nhận diện chuẩn xác phân loại TEA cho Hộp quà tặng trà sơn thủy')

    const teaDraft = generateAlgorithmicDraft({
      channel: 'FACEBOOK',
      campaign: testCampaign,
      product: teaProduct,
      scheduledAt: new Date(),
    })
    assert(
      /trà|ấm trà|thưởng trà|búp trà|tách gốm/i.test(teaDraft.content),
      'Bài viết Trà có từ ngữ đặc trưng về thưởng trà và trà thơm'
    )
    assert(
      !/đốm sáng nhỏ/i.test(teaDraft.content),
      'Bài viết Trà TUYỆT ĐỐI KHÔNG gán sai thuộc tính ánh sáng phát sáng ("đốm sáng nhỏ")'
    )
    assert(
      !/sáp nến đậu nành|bấc nến/i.test(teaDraft.content),
      'Bài viết Trà TUYỆT ĐỐI KHÔNG gán sai sáp nến đậu nành hay bấc nến'
    )

    // 2. Test Gốm/Tranh (Ceramic): Tranh gốm hoa mẫu đơn chim vàng
    const ceramicProduct = {
      id: 'p-ceramic-01',
      name: 'Tranh gốm hoa mẫu đơn chim vàng treo tường',
      sku: 'UD-QT-002',
      price: 350000,
      originalPrice: 400000,
      campaignPrice: 350000,
      discountPercent: 12,
    }
    assert(detectProductCategory(ceramicProduct) === 'CERAMIC', 'Nhận diện chuẩn xác phân loại CERAMIC cho Tranh gốm')

    const ceramicDraft = generateAlgorithmicDraft({
      channel: 'FACEBOOK',
      campaign: testCampaign,
      product: ceramicProduct,
      scheduledAt: new Date(),
    })
    assert(
      /gốm|men lam|đất sét|người thợ|chuốt gốm/i.test(ceramicDraft.content),
      'Bài viết Gốm có từ ngữ tôn vinh bàn tay người thợ gốm và men lam mộc'
    )
    assert(
      !/đốm sáng nhỏ/i.test(ceramicDraft.content),
      'Bài viết Tranh Gốm TUYỆT ĐỐI KHÔNG gán đốm sáng nhỏ phát sáng'
    )
    assert(
      !/sáp nến đậu nành|tinh dầu hay sáp nến/i.test(ceramicDraft.content),
      'Bài viết Tranh Gốm TUYỆT ĐỐI KHÔNG gán sáp nến hay tinh dầu'
    )

    // 3. Test Trầm hương (Incense)
    const incenseProduct = {
      id: 'p-incense-01',
      name: 'Vòng tay trầm hương tự nhiên rừng sâu nguyên bản',
      sku: 'UD-TRAM-001',
      price: 1250000,
      originalPrice: 1500000,
      campaignPrice: 1250000,
      discountPercent: 15,
    }
    assert(detectProductCategory(incenseProduct) === 'INCENSE', 'Nhận diện chuẩn xác phân loại INCENSE cho Trầm hương')

    const incenseDraft = generateAlgorithmicDraft({
      channel: 'FACEBOOK',
      campaign: testCampaign,
      product: incenseProduct,
      scheduledAt: new Date(),
    })
    assert(
      /trầm|khói|hương thơm thanh tịnh|gỗ trầm/i.test(incenseDraft.content),
      'Bài viết Trầm hương có thuộc tính hương trầm thanh tịnh'
    )
    assert(
      !/sáp nến đậu nành/i.test(incenseDraft.content),
      'Bài viết Trầm hương không nhầm lẫn với sáp nến đậu nành'
    )

    // 4. Test Nến thơm (Candle): Nến bơ Udumbara
    const candleProduct = {
      id: 'p-candle-01',
      name: 'Nến bơ Udumbara hũ thủy tinh',
      sku: 'UD-NEN-001',
      price: 129000,
      originalPrice: 150000,
      campaignPrice: 129000,
      discountPercent: 14,
    }
    assert(detectProductCategory(candleProduct) === 'CANDLE', 'Nhận diện chuẩn xác phân loại CANDLE cho Nến bơ')

    const candleDraft = generateAlgorithmicDraft({
      channel: 'FACEBOOK',
      campaign: testCampaign,
      product: candleProduct,
      scheduledAt: new Date(),
    })
    assert(
      /đốm sáng nhỏ|hương thơm mộc mạc|sáp đậu nành|hũ nến/i.test(candleDraft.content),
      'Bài viết Nến thơm mô tả đúng đốm sáng và sáp đậu nành tự nhiên'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 5: MINH BẠCH NGUỒN SINH & METADATA TRACKING (FEAT-AI-01)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 5] Kiểm định Minh bạch Nguồn sinh (generationSource & generationMeta) ---')

    // 1. Kiểm thử Fallback Generator khi LLM không có key
    const fallbackDraft = await generatePlatformDraft({
      channel: 'FACEBOOK',
      campaign: testCampaign,
      product: teaProduct,
      scheduledAt: new Date(),
    })
    assert(
      fallbackDraft.generationSource === 'TEMPLATE_FALLBACK',
      'Minh bạch nguồn sinh: xác định chính xác TEMPLATE_FALLBACK khi LLM không khả dụng'
    )
    assert(
      fallbackDraft.generationMeta.model === 'template-algorithmic-v2',
      `Model ghi nhận chuẩn template-algorithmic-v2 (got: ${fallbackDraft.generationMeta.model})`
    )
    assert(
      fallbackDraft.generationMeta.latencyMs >= 0,
      `Đo đạc chính xác độ trễ (${fallbackDraft.generationMeta.latencyMs}ms)`
    )
    assert(
      !!fallbackDraft.generationMeta.error && fallbackDraft.generationMeta.error.length > 0,
      `Lỗi LLM được ghi nhận minh bạch: "${fallbackDraft.generationMeta.error}"`
    )

    // 2. Kiểm thử Real LLM Generation (giả lập caller LLM trả về văn phong đạt chuẩn)
    const simulatedLlmCaller = async (_system: string, _user: string, _timeoutMs?: number) => {
      return `Chiều nay lành lạnh, pha ấm Hộp quà tặng trà sơn thủy kèm 2 hũ gốm mà thơm ấm cả gian phòng. Dịp Mùa An Yên - Thiền Trà & Nến Bơ Ưu Đàm này, tụi em thương gửi mình giá 450.000đ (giảm 15%). Mã ưu đãi thân gửi mình: UUDAM15THU. Nếu lòng cần khoảng lặng, mời mình ghé tiệm nhấp chén trà ấm nha 🌿`
    }

    const llmDraft = await generatePlatformDraft({
      channel: 'THREADS',
      campaign: testCampaign,
      product: teaProduct,
      scheduledAt: new Date(),
      llmCaller: simulatedLlmCaller,
    })

    assert(
      llmDraft.generationSource === 'LLM',
      `Minh bạch nguồn sinh: xác định chính xác LLM khi AI phản hồi thành công (got: ${llmDraft.generationSource})`
    )
    assert(
      llmDraft.generationMeta.model === 'gemini-2.0-flash',
      `Model ghi nhận gemini-2.0-flash (got: ${llmDraft.generationMeta.model})`
    )
    assert(
      llmDraft.generationMeta.error === undefined,
      'Không có lỗi khi LLM sinh thành công'
    )
    assert(
      llmDraft.rubricEvaluation.overallScore >= 8.0,
      `Bài viết do LLM sinh đạt Rubric (${llmDraft.rubricEvaluation.overallScore}/10 >= 8.0)`
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 6: ADAPTATION TRÊN 7 NỀN TẢNG & KIỂM SOÁT THREADS KHẮT KHE
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 6] Thích ứng 7 nền tảng & Giới hạn ký tự Threads <= 500 chars ---')

    for (const channel of ALL_SOCIAL_PLATFORMS) {
      const draft = await generatePlatformDraft({
        channel,
        campaign: testCampaign,
        product: prod,
        scheduledAt: new Date('2026-11-02T10:00:00.000Z'),
      })

      assert(draft.channel === channel, `Kênh phát hành ${channel} được gán chính xác`)
      assert(draft.content.length > 0, `Nội dung bản thảo kênh ${channel} không rỗng`)
      assert(detectBannedPhrases(draft.content).length === 0, `Kênh ${channel} sạch 100% cụm từ cấm`)

      if (channel === 'THREADS') {
        assert(
          draft.content.length <= 500,
          `Bản thảo Threads tuân thủ giới hạn ký tự (độ dài: ${draft.content.length} <= 500 ký tự)`
        )
      } else if (channel === 'TIKTOK') {
        assert(
          /hook|0\.1s|âm thanh/i.test(draft.content) && /kịch bản/i.test(draft.content),
          'Bản thảo TikTok có cấu trúc kịch bản video ngắn (Hook 0.1s -> Cảnh -> Thoại)'
        )
        assert(draft.mediaType === 'VIDEO', 'TikTok gán đúng loại media VIDEO')
      } else if (channel === 'WEBSITE') {
        assert(!!draft.title && draft.title.length > 0, 'Website Blog có tiêu đề sâu sắc')
        assert(!!draft.slug && draft.slug.length > 0, `Website Blog có slug hợp lệ: ${draft.slug}`)
        assert(draft.content.includes('# '), 'Website Blog định dạng Markdown chuẩn với các heading')
        const wordCount = draft.content.trim().split(/\s+/).length
        assert(wordCount >= 400, `Website Blog có độ dài sâu sắc (${wordCount} từ >= 400)`)
      } else if (channel === 'INSTAGRAM') {
        const fullText = `${draft.content} ${draft.hashtags || ''}`
        assert(fullText.includes('#uudam'), 'Instagram chứa hashtag #uudam')
        assert(fullText.includes('#chualanh'), 'Instagram chứa hashtag #chualanh')
        assert(fullText.includes('#binhyen'), 'Instagram chứa hashtag #binhyen')
      } else if (channel === 'EXTERNAL_CMS') {
        assert(!!draft.title && draft.title.length > 0, 'External CMS có tiêu đề sản phẩm')
      } else if (channel === 'ZALO_OA') {
        assert(draft.content.length <= 2000, 'Zalo OA tuân thủ độ dài tin nhắn broadcast')
      } else if (channel === 'FACEBOOK') {
        assert(draft.content.length >= 80, 'Facebook có độ dài tự sự đủ ấm áp')
      }
    }

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 7: STRESS TEST ĐỐI KHÁNG ĐỘ DÀI THREADS (CHALLENGER FIX)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 7] Stress Test Đối Kháng Độ Dài Threads (Bất biến <= 500 chars) ---')

    const extremeProduct = {
      id: 'p-extreme',
      sku: 'UD-EXTREME-001',
      name: 'Vật phẩm trầm hương cao cấp tự nhiên xuất xứ rừng sâu trăm năm tuổi được tiện thủ công tinh xảo tỉ mỉ từng chi tiết hoa văn vân gỗ quý hiếm kết hợp men gốm lam gia truyền hoàng cung xưa',
      price: 25000000,
      originalPrice: 30000000,
      campaignPrice: 25000000,
      discountPercent: 20,
    }
    const extremeVoucher = {
      id: 'v-extreme',
      code: 'SUPER_LONG_DISCOUNT_VOUCHER_CODE_EXTRA_2026_UUDAM',
      title: 'Voucher Khủng',
      discountType: 'PERCENT',
      discountValue: 20,
    }

    // Chạy 5 lần stress test với các input cực đại
    for (let i = 1; i <= 5; i++) {
      const extremeThreadsDraft = await generatePlatformDraft({
        channel: 'THREADS',
        campaign: {
          ...testCampaign,
          title: 'Chiến Dịch Đại Lễ Tri Ân Vu Lan Báo Hiếu Toàn Diện Cùng Ưu Đàm Toàn Quốc Mùa Thu Đông 2026',
        },
        product: extremeProduct,
        voucher: extremeVoucher,
        scheduledAt: new Date(),
      })

      assert(
        extremeThreadsDraft.content.length <= 500,
        `[Stress test #${i}] Threads chiều dài ${extremeThreadsDraft.content.length} <= 500 ký tự (Challenger bug đã được khắc phục triệt để)`
      )
      assert(
        extremeThreadsDraft.content.includes('25.000.000đ'),
        `[Stress test #${i}] Giá tiền CRM được bảo toàn trọn vẹn`
      )
      assert(
        extremeThreadsDraft.content.includes(extremeVoucher.code),
        `[Stress test #${i}] Mã voucher CRM được bảo toàn trọn vẹn`
      )
    }

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 8: TÍNH TOÁN LỊCH ĐĂNG TRONG RANH GIỚI THỜI GIAN CHIẾN DỊCH
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 8] Động cơ Lập lịch phân bổ thời gian (Time Boundary Engine) ---')

    const start = new Date(testCampaign.startDate)
    const end = new Date(testCampaign.endDate)
    const dates = calculateDistributedScheduleDates(start, end, 7)

    assert(dates.length === 7, 'Sinh đúng 7 mốc thời gian cho 7 bài viết')

    for (let i = 0; i < dates.length; i++) {
      const d = dates[i]
      assert(
        d.getTime() >= start.getTime() && d.getTime() <= end.getTime(),
        `Mốc thời gian bài #${i + 1} (${d.toISOString()}) nằm nghiêm ngặt trong ranh giới [${start.toISOString()} - ${end.toISOString()}]`
      )
      if (i > 0) {
        assert(
          dates[i].getTime() > dates[i - 1].getTime(),
          `Mốc thời gian bài #${i + 1} tuần tự sau bài #${i}`
        )
      }
    }

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 9: CHẤM ĐIỂM RUBRIC ĐỘC LẬP 10 BẢN THẢO MẪU (GATE >= 8.0/10)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 9] Cổng chất lượng Rubric 4 tiêu chí (FEAT-AI-05 - Ngưỡng >= 8.0/10) ---')

    const samplePlan = await generateSocialPlan(testCampaign.id, {
      postsCount: 10,
    })

    assert(samplePlan.posts.length === 10, 'Sinh thành công 10 bản thảo mẫu đa kênh')
    assert(samplePlan.rubricSummary.evaluatedCount === 10, 'Đã chấm điểm đầy đủ 10/10 bản thảo')
    assert(
      samplePlan.rubricSummary.allPassed,
      `Tất cả 10 bản thảo đều vượt qua ngưỡng >= 8.0/10 (Điểm trung bình: ${samplePlan.rubricSummary.averageScore}/10)`
    )

    let postIndex = 1
    for (const p of samplePlan.posts) {
      const evalRes = p.rubricEvaluation
      assert(
        evalRes.overallScore >= 8.0,
        `Bản thảo #${postIndex} (${p.channel}): Điểm=${evalRes.overallScore}/10 >= 8.0 (CRM=${evalRes.crmAccuracy.score}, Voice=${evalRes.brandVoice.score}, Format=${evalRes.platformFormatting.score}, CTA=${evalRes.callToAction.score})`
      )
      assert(evalRes.crmAccuracy.score >= 8.0, `Bản thảo #${postIndex} CRM Accuracy >= 8.0`)
      assert(evalRes.brandVoice.score >= 8.0, `Bản thảo #${postIndex} Brand Voice >= 8.0`)
      postIndex++
    }

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 10: NEXT.JS 16 ROUTE HANDLERS E2E & PERSISTENCE
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 10] Kiểm thử Next.js 16 Route Handlers E2E & Metadata Exposure ---')

    // 1. Test POST /api/social/ai-plan (Tạo kế hoạch và lưu DB)
    const postReq = new NextRequest('http://localhost:3010/api/social/ai-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId: testCampaign.id,
        postsCount: 7,
      }),
    })

    const postRes = await postAiPlan(postReq)
    assert(postRes.status === 201, `POST /api/social/ai-plan trả về HTTP 201 (got ${postRes.status})`)
    const postBody = await postRes.json()
    assert(!!postBody.plan?.id, 'Kế hoạch đã được lưu với ID duy nhất')
    assert(postBody.plan.posts.length === 7, `Kế hoạch lưu thành công 7 bài viết con (got ${postBody.plan.posts.length})`)
    createdPlanIds.push(postBody.plan.id)

    // Kiểm tra các trường metadata được expose trong bài viết con trả về từ POST
    assert(
      !!postBody.plan.posts[0].generationSource,
      `POST response chứa generationSource: ${postBody.plan.posts[0].generationSource}`
    )
    assert(
      !!postBody.plan.posts[0].generationMeta,
      `POST response chứa generationMeta: model=${postBody.plan.posts[0].generationMeta?.model}`
    )

    // 2. Test GET /api/social/ai-plan (Danh sách kế hoạch)
    const listReq = new NextRequest(`http://localhost:3010/api/social/ai-plan?campaignId=${testCampaign.id}`)
    const listRes = await getAiPlans(listReq)
    assert(listRes.status === 200, `GET /api/social/ai-plan trả về HTTP 200 (got ${listRes.status})`)
    const listBody = await listRes.json()
    assert(listBody.total >= 1, `Tìm thấy ít nhất 1 kế hoạch cho chiến dịch (got ${listBody.total})`)

    // 3. Test GET /api/social/ai-plan/[id] (Chi tiết kế hoạch kèm rubric, generationSource, generationMeta)
    const getByIdReq = new NextRequest(`http://localhost:3010/api/social/ai-plan/${postBody.plan.id}`)
    const getByIdRes = await getAiPlanById(getByIdReq, {
      params: Promise.resolve({ id: postBody.plan.id }),
    })
    assert(getByIdRes.status === 200, `GET /api/social/ai-plan/[id] trả về HTTP 200 (got ${getByIdRes.status})`)
    const getByIdData = await getByIdRes.json()
    assert(getByIdData.plan?.id === postBody.plan.id, 'ID kế hoạch trả về khớp chính xác')
    assert(getByIdData.plan.posts.length === 7, 'Trả về đủ 7 bài viết con')
    assert(
      !!getByIdData.plan.posts[0].rubricEvaluation,
      'Bài viết con chứa thông tin rubric evaluation đã giải mã'
    )
    assert(
      getByIdData.plan.posts[0].generationSource === 'TEMPLATE_FALLBACK' ||
      getByIdData.plan.posts[0].generationSource === 'LLM',
      `GET /[id] giải mã chính xác generationSource: ${getByIdData.plan.posts[0].generationSource}`
    )
    assert(
      !!getByIdData.plan.posts[0].generationMeta?.model,
      `GET /[id] giải mã chính xác generationMeta.model: ${getByIdData.plan.posts[0].generationMeta?.model}`
    )

    // 4. Test DELETE /api/social/ai-plan/[id]
    const delReq = new NextRequest(`http://localhost:3010/api/social/ai-plan/${postBody.plan.id}`)
    const delRes = await deleteAiPlanById(delReq, {
      params: Promise.resolve({ id: postBody.plan.id }),
    })
    assert(delRes.status === 200, `DELETE /api/social/ai-plan/[id] trả về HTTP 200 (got ${delRes.status})`)
    createdPlanIds.pop()

    // Xác nhận đã cascade xóa các bài viết con trong DB
    const leftoverPosts = await prisma.socialPost.count({ where: { planId: postBody.plan.id } })
    assert(leftoverPosts === 0, 'Cascade delete: toàn bộ bài viết con đã được dọn sạch')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 11: DỌN DẸP SẠCH DỮ LIỆU & ĐỐI SOÁT BASELINE INVARIANCE (DELTA = 0)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 11] Dọn dẹp sạch dữ liệu thử nghiệm & Đối soát an toàn CSDL ---')

    for (const planId of createdPlanIds) {
      await prisma.socialPost.deleteMany({ where: { planId } })
      await prisma.socialPlan.deleteMany({ where: { id: planId } })
    }

    for (const cid of createdCampaignIds) {
      await deleteCampaign(cid)
    }

    // Dọn dẹp các AuditLog tạo ra bởi các test campaign
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Campaign',
        entityId: { in: createdCampaignIds },
      },
    })

    console.log(`🧹 Đã dọn dẹp ${createdCampaignIds.length} chiến dịch và các bản ghi phụ thuộc`)

    // Ép WAL checkpoint
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

    // Kiểm tra tính toàn vẹn 24 bảng cốt lõi
    await verifyBaselineParity('Sau khi kết thúc M3')
    console.log('✅ [PASS] Đối soát CSDL: 100% 24 bảng baseline ban đầu nguyên vẹn tuyệt đối (Delta = 0)')

    console.log('\n======================================================================')
    console.log(`🏆 KẾT THÚC KIỂM THỬ M3 FIX THÀNH CÔNG! ĐẠT: ${passedTests}, LỖI: ${failedTests} 🏆`)
    console.log('======================================================================\n')
  } catch (err) {
    console.error('\n💥 LỖI TRONG QUÁ TRÌNH KIỂM THỬ M3:', err)
    try {
      for (const pid of createdPlanIds) {
        await prisma.socialPost.deleteMany({ where: { planId: pid } })
        await prisma.socialPlan.deleteMany({ where: { id: pid } })
      }
      for (const cid of createdCampaignIds) {
        await prisma.campaign.deleteMany({ where: { id: cid } })
        await prisma.auditLog.deleteMany({ where: { entityId: cid } })
      }
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
    } catch {
      // bỏ qua
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
