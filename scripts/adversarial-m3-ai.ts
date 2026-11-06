// scripts/adversarial-m3-ai.ts
// Empirical Adversarial Stress Test Suite for Milestone 3 (M3: AI Planning & Copywriting Engine)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
//
// Challenger Suite:
// 1. Boundary tests on Threads: lengthy source text & strict <= 500 characters enforcement.
// 2. Banned phrases stress test: inject ("kính chào", "quý khách", "hân hạnh phục vụ", "nguồn động lực quý báu").
// 3. Hallucination defense test: conflicting prices, fake vouchers, prompt injections vs Deterministic CRM Invariant Matcher.
// 4. Campaign time boundary test: 1-day vs 60-day campaign schedule bounds [startDate, endDate].
// 5. Independent rubric evaluation on 10 real sample outputs (Agent Independent Evaluation).
// 6. Complete teardown & 24 baseline tables parity verification (Delta = 0).

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
  calculateDistributedScheduleDates,
  generateSocialPlan,
  ALL_SOCIAL_PLATFORMS,
  type SocialPlatform,
} from '../src/lib/social-ai'
import {
  createCampaign,
  deleteCampaign,
  type CampaignData,
} from '../src/lib/campaign-service'

const prisma = new PrismaClient()

interface TestResult {
  name: string
  passed: boolean
  details?: string
}

const testResults: TestResult[] = []

function check(condition: boolean, name: string, details?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${name}`)
    testResults.push({ name, passed: true, details })
  } else {
    console.error(`  ❌ [FAIL] ${name}${details ? ` -> ${details}` : ''}`)
    testResults.push({ name, passed: false, details })
  }
}

async function verifyBaselineParity(checkpointLabel: string) {
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
      throw new Error(`Baseline mismatch in ${model} at ${checkpointLabel}: actual=${count}, baseline=${baseline[model]}`)
    }
  }
  console.log(`  🔒 [BASELINE CHECK] 24/24 Core Tables 100% Match at "${checkpointLabel}" (Delta = 0)`)
}

async function runAdversarialSuite() {
  console.log('================================================================================')
  console.log('🔥 EMPIRICAL CHALLENGER — MILESTONE 3 AI ENGINE ADVERSARIAL SUITE 🔥')
  console.log('================================================================================\n')

  const createdCampaignIds: string[] = []

  try {
    // -------------------------------------------------------------------------
    // PRE-CHECK: Baseline verification
    // -------------------------------------------------------------------------
    console.log('[CHALLENGE PHASE 0] Pre-test Baseline Verification')
    await verifyBaselineParity('Pre-test')

    // Lấy 1 product thật từ DB
    const realProduct = await prisma.product.findFirst({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, sellPrice: true },
    })
    check(!!realProduct, 'Tìm thấy sản phẩm active trong DB')

    // -------------------------------------------------------------------------
    // CHALLENGE 1: THREADS BOUNDARY STRESS TEST (<= 500 CHARACTERS)
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 1] Threads Boundary Stress Testing (Length Limits)')

    const campaignThreads = await createCampaign({
      code: 'CP-CHALLENGE-TH',
      name: 'Chiến Dịch Thử Thách Ký Tự Dài Cực Hạn Cho Threads Của Tiệm Ưu Đàm',
      title: 'Hương Trầm Mộc Bản Tự Nhiên Rừng Già Hàng Trăm Năm Tuổi Cùng Tiệm Ưu Đàm',
      description: 'Mô tả cực kỳ dài dòng nhằm kích hoạt kịch bản cắt tỉa độ dài: '.repeat(10),
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-15T00:00:00.000Z'),
      discountPercent: 20,
      voucherCode: 'VOUCHER_EXTREME_THREADS_CODE_2026',
      appliedProductIds: [realProduct!.id],
    })
    createdCampaignIds.push(campaignThreads.id)

    // Test 1.1: Product name cực dài (150-250 ký tự)
    const longProd = {
      id: 'p-extreme',
      sku: 'UD-EXTREME',
      name: 'Bình gốm thủ công men rạn hoa văn sóng nước cổ đại kèm nến đậu nành hương quế trầm thượng hạng tinh tế',
      price: 1850000,
      originalPrice: 2200000,
      campaignPrice: 1850000,
      discountPercent: 20,
    }

    const threadsDraft1 = await generatePlatformDraft({
      channel: 'THREADS',
      campaign: campaignThreads,
      product: longProd,
      scheduledAt: new Date('2026-11-02T10:00:00.000Z'),
    })

    console.log(`    Threads draft 1 length: ${threadsDraft1.content.length} characters`)
    check(
      threadsDraft1.content.length <= 500,
      'Threads Draft 1: Tuân thủ nghiêm ngặt <= 500 ký tự khi tên sản phẩm dài',
      `Độ dài thực tế: ${threadsDraft1.content.length}`
    )
    check(
      threadsDraft1.content.includes('1.850.000đ') || threadsDraft1.content.includes('1850000'),
      'Threads Draft 1: Bảo toàn giá bán CRM sau khi cắt tỉa'
    )
    check(
      threadsDraft1.content.includes('20%'),
      'Threads Draft 1: Bảo toàn tỷ lệ chiết khấu 20% sau khi cắt tỉa'
    )

    // Test 1.2: Sweep qua 20 tổ hợp độ dài chuỗi đầu vào để tìm điểm gãy biên
    console.log('    Sweeping 20 extreme variations of title and product lengths for Threads...')
    let maxThreadsLength = 0
    let threadsViolations = 0
    const violationExamples: Array<{ inputLen: number; outputLen: number; snippet: string }> = []

    for (let len = 50; len <= 400; len += 25) {
      const syntheticCampaign: CampaignData = {
        ...campaignThreads,
        title: 'Chiến Dịch ' + 'A'.repeat(len),
      }
      const syntheticProd = {
        id: `p-${len}`,
        sku: `UD-SYN-${len}`,
        name: 'Vật phẩm ' + 'N'.repeat(Math.min(len, 100)),
        price: 350000 + len * 1000,
        originalPrice: 400000 + len * 1000,
        campaignPrice: 350000 + len * 1000,
        discountPercent: 15,
      }

      const draft = await generatePlatformDraft({
        channel: 'THREADS',
        campaign: syntheticCampaign,
        product: syntheticProd,
        scheduledAt: new Date('2026-11-02T10:00:00.000Z'),
      })

      if (draft.content.length > maxThreadsLength) {
        maxThreadsLength = draft.content.length
      }

      if (draft.content.length > 500) {
        threadsViolations++
        violationExamples.push({
          inputLen: len,
          outputLen: draft.content.length,
          snippet: draft.content.slice(-60),
        })
      }
    }

    console.log(`    Max observed Threads length across sweep: ${maxThreadsLength} chars`)
    console.log(`    Threads boundary violations count: ${threadsViolations}/20`)
    if (threadsViolations > 0) {
      console.error(`    ⚠️ Sample violation snippet: "${violationExamples[0].snippet}" (Length: ${violationExamples[0].outputLen})`)
    }
    check(
      threadsViolations === 0,
      `Threads Sweep: 0 vi phạm trên toàn bộ 20 biến thể độ dài cực hạn (Max: ${maxThreadsLength}/500 chars)`,
      `Phát hiện ${threadsViolations} trường hợp vượt quá 500 ký tự (Đạt đỉnh: ${maxThreadsLength} ký tự do off-by-six tại social-ai.ts:840)`
    )

    // -------------------------------------------------------------------------
    // CHALLENGE 2: BANNED PHRASES STRESS TEST
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 2] Banned Phrases Stress Testing & Sanitization')

    const hostileInputs = [
      'Kính chào quý khách! Shop OmniSales vô cùng hân hạnh phục vụ quý khách.',
      'Sự ủng hộ của quý khách là nguồn động lực quý báu để chúng tôi cải thiện chất lượng dịch vụ.',
      'KÍNH CHÀO QUÝ KHÁCH HÀNG THÂN MẾN!',
      'Hân hạnh phục vụ quý khách với trải nghiệm tuyệt vời nhất không thể bỏ lỡ.',
      'Chúng tôi cam kết mang lại cơ hội ngàn năm có một, hãy nhanh tay kẻo lỡ sản phẩm hàng đầu!',
      'Quý khách hàng hãy liên hệ ngay với đội ngũ chuyên nghiệp của chúng tôi.',
    ]

    for (let i = 0; i < hostileInputs.length; i++) {
      const raw = hostileInputs[i]
      const sanitized = sanitizeBrandVoice(raw)
      const bannedFound = detectBannedPhrases(sanitized)

      console.log(`    Input #${i + 1}: "${raw.slice(0, 50)}..."`)
      console.log(`    Output #${i + 1}: "${sanitized.slice(0, 60)}..."`)

      check(
        bannedFound.length === 0,
        `Hostile Input #${i + 1}: Lọc sạch 100% cụm từ cấm`,
        `Còn sót: ${bannedFound.join(', ')}`
      )
      check(
        !/kính chào|quý khách|hân hạnh phục vụ|nguồn động lực quý báu|OmniSales/i.test(sanitized),
        `Hostile Input #${i + 1}: Không còn chứa bất kỳ từ khóa cấm nào`
      )
    }

    // Tạo campaign với mô tả chứa đầy cụm từ cấm và sinh draft thật
    const campaignHostile = await createCampaign({
      code: 'CP-CHALLENGE-BANNED',
      name: 'Chiến dịch thử nghiệm cụm từ cấm',
      title: 'Kính chào quý khách ghé thăm tiệm Ưu Đàm',
      description: 'Shop chúng tôi hân hạnh phục vụ quý khách, sự ủng hộ của quý khách là nguồn động lực quý báu.',
      startDate: new Date('2026-11-05T00:00:00.000Z'),
      endDate: new Date('2026-11-20T00:00:00.000Z'),
      appliedProductIds: [realProduct!.id],
    })
    createdCampaignIds.push(campaignHostile.id)

    for (const channel of ALL_SOCIAL_PLATFORMS) {
      const draft = await generatePlatformDraft({
        channel,
        campaign: campaignHostile,
        product: campaignHostile.products[0],
        scheduledAt: new Date('2026-11-06T10:00:00.000Z'),
      })
      const remainingBanned = detectBannedPhrases(draft.content)
      check(
        remainingBanned.length === 0,
        `Channel ${channel}: 100% sạch cụm từ cấm dù input chiến dịch bị tiêm nhiễm`,
        `Còn sót: ${remainingBanned.join(', ')}`
      )
    }

    // -------------------------------------------------------------------------
    // CHALLENGE 3: HALLUCINATION DEFENSE & CRM INVARIANT MATCHER
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 3] Hallucination Defense & CRM Invariant Matcher')

    const truePrice = 320000
    const trueDiscount = 25
    const trueVoucher = 'UUDAM_CHALLENGE_TRUE'

    const campaignCrm = await createCampaign({
      code: 'CP-CHALLENGE-CRM',
      name: 'Chiến Dịch Phòng Vệ Ảo Giác Dữ Liệu',
      title: 'Ưu Đàm Tĩnh Lặng',
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-10T00:00:00.000Z'),
      discountPercent: trueDiscount,
      voucherCode: trueVoucher,
      appliedProductIds: [realProduct!.id],
    })
    createdCampaignIds.push(campaignCrm.id)

    const targetProductWithPrice = {
      id: realProduct!.id,
      sku: 'UD-CHALLENGE',
      name: 'Nến Thơm Sen Hồng Ưu Đàm',
      price: truePrice,
      originalPrice: 420000,
      campaignPrice: truePrice,
      discountPercent: trueDiscount,
    }

    // Test 3.1: Tiêm văn bản hoàn toàn sai lệch (giá giả 10k, voucher giả FAKE_CODE, giảm giá 90%)
    const hallucinatedText = 'Trầm hương siêu giảm giá! Chỉ với 10.000đ nhận ngay hũ nến. Giảm sốc 90% khi nhập mã FAKE_SUPER_DISCOUNT_99.'
    console.log(`    Hallucinated text: "${hallucinatedText}"`)

    // Thẩm định bằng validateCrmInvariants
    const preValidation = validateCrmInvariants(hallucinatedText, campaignCrm, targetProductWithPrice)
    check(
      !preValidation.valid,
      'Hallucination Defense: validateCrmInvariants phát hiện chính xác văn bản chứa thông tin sai/thiếu CRM'
    )
    check(!preValidation.matchedPrice, 'Phát hiện thiếu/sai giá chuẩn CRM (320.000đ)')
    check(!preValidation.matchedDiscount, 'Phát hiện thiếu tỷ lệ giảm giá chuẩn CRM (25%)')
    check(!preValidation.matchedVoucher, 'Phát hiện thiếu mã voucher chuẩn CRM (UUDAM_CHALLENGE_TRUE)')

    // Cưỡng chế bằng enforceCrmInvariants
    const enforcedText = enforceCrmInvariants(
      hallucinatedText,
      campaignCrm,
      targetProductWithPrice,
      undefined,
      'FACEBOOK'
    )
    console.log(`    Enforced text: "${enforcedText}"`)

    const postValidation = validateCrmInvariants(enforcedText, campaignCrm, targetProductWithPrice)
    check(
      postValidation.valid,
      'Hallucination Defense: enforceCrmInvariants đã cưỡng chế thành công 100% dữ liệu CRM chuẩn'
    )
    check(postValidation.matchedPrice, 'Giá 320.000đ đã được bổ sung chuẩn xác')
    check(postValidation.matchedDiscount, 'Tỷ lệ giảm 25% đã được bổ sung chuẩn xác')
    check(postValidation.matchedVoucher, `Mã voucher ${trueVoucher} đã được bổ sung chuẩn xác`)

    // -------------------------------------------------------------------------
    // CHALLENGE 4: CAMPAIGN TIME BOUNDARY STRESS TEST (1-DAY vs 60-DAY)
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 4] Campaign Time Boundary Testing (1-Day vs 60-Day)')

    // Test 4.1: Chiến dịch siêu ngắn 1 ngày (24 giờ)
    const oneDayStart = new Date('2026-11-01T00:00:00.000Z')
    const oneDayEnd = new Date('2026-11-02T00:00:00.000Z')

    const campaignOneDay = await createCampaign({
      code: 'CP-1DAY-TEST',
      name: 'Chiến dịch Flash 24 Giờ Ưu Đàm',
      title: 'Flash Sale 24h Mùa Đông',
      startDate: oneDayStart,
      endDate: oneDayEnd,
      discountPercent: 10,
    })
    createdCampaignIds.push(campaignOneDay.id)

    const plan1Day = await generateSocialPlan(campaignOneDay.id, { postsCount: 7 })
    check(plan1Day.posts.length === 7, 'Sinh thành công 7 bài cho chiến dịch 1 ngày')

    let all1DayInBounds = true
    for (let i = 0; i < plan1Day.posts.length; i++) {
      const p = plan1Day.posts[i]
      const postTime = new Date(p.scheduledAt).getTime()
      if (postTime < oneDayStart.getTime() || postTime > oneDayEnd.getTime()) {
        all1DayInBounds = false
      }
    }
    check(
      all1DayInBounds,
      '1-Day Campaign: 100% các mốc bài đăng nằm nghiêm ngặt trong [startDate, endDate]'
    )

    // Test 4.2: Chiến dịch dài hạn 60 ngày
    const sixtyDayStart = new Date('2026-11-01T00:00:00.000Z')
    const sixtyDayEnd = new Date('2026-12-31T00:00:00.000Z')

    const campaignSixtyDays = await createCampaign({
      code: 'CP-60DAY-TEST',
      name: 'Chiến dịch Dài Hạn 60 Ngày Cuối Năm',
      title: 'Đón Tết An Khang Cùng Ưu Đàm',
      startDate: sixtyDayStart,
      endDate: sixtyDayEnd,
      discountPercent: 15,
    })
    createdCampaignIds.push(campaignSixtyDays.id)

    const plan60Days = await generateSocialPlan(campaignSixtyDays.id, { postsCount: 14 })
    check(plan60Days.posts.length === 14, 'Sinh thành công 14 bài cho chiến dịch 60 ngày')

    let all60DaysInBounds = true
    let monotonic60Days = true
    let prevTime = sixtyDayStart.getTime()
    for (let i = 0; i < plan60Days.posts.length; i++) {
      const p = plan60Days.posts[i]
      const postTime = new Date(p.scheduledAt).getTime()
      if (postTime < sixtyDayStart.getTime() || postTime > sixtyDayEnd.getTime()) {
        all60DaysInBounds = false
      }
      if (postTime <= prevTime) {
        monotonic60Days = false
      }
      prevTime = postTime
    }
    check(
      all60DaysInBounds,
      '60-Day Campaign: 100% các mốc bài đăng nằm nghiêm ngặt trong [startDate, endDate]'
    )
    check(
      monotonic60Days,
      '60-Day Campaign: Các mốc bài đăng tăng dần đơn điệu theo thời gian'
    )

    // -------------------------------------------------------------------------
    // CHALLENGE 5: INDEPENDENT AGENT RUBRIC EVALUATION (10 REAL SAMPLE DRAFTS)
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 5] Independent Rubric Evaluation on 10 Real Sample Drafts')

    // Sinh 10 bài mẫu từ chiến dịch thật đa dạng kênh
    const sampleCampaign = await createCampaign({
      code: 'CP-RUBRIC-EVAL-10',
      name: 'Chiến Dịch Độc Lập Chấm Điểm 10 Bản Thảo Mẫu',
      title: 'Thắp Lửa An Yên - Bộ Sưu Tập Mùa Đông Ưu Đàm',
      description: 'Chương trình giới thiệu nến bơ và trà thiền thanh tịnh, xoa dịu thân tâm.',
      startDate: new Date('2026-11-10T00:00:00.000Z'),
      endDate: new Date('2026-11-25T00:00:00.000Z'),
      discountPercent: 15,
      voucherCode: 'UUDAM15DONG',
      appliedProductIds: [realProduct!.id],
    })
    createdCampaignIds.push(sampleCampaign.id)

    const generated10Plan = await generateSocialPlan(sampleCampaign.id, {
      postsCount: 10,
    })
    check(generated10Plan.posts.length === 10, 'Sinh đủ 10 bài mẫu thật từ hệ thống')

    // Bảng chấm điểm độc lập của Challenger Agent:
    interface IndependentEvaluation {
      index: number
      channel: SocialPlatform
      factualityScore: number       // 0-10: Đúng giá, đúng voucher, đúng % CRM
      brandVoiceScore: number       // 0-10: Giọng Ưu Đàm, xưng tụi em, 0 từ cấm
      naturalLanguageScore: number  // 0-10: Tiếng Việt mượt mà, không lỗi chính tả
      ctaFormatScore: number        // 0-10: CTA nhẹ nhàng, format đúng kênh
      totalScore: number
      passed: boolean
      feedback: string
      contentExcerpt: string
    }

    const independentScores: IndependentEvaluation[] = []

    for (let i = 0; i < generated10Plan.posts.length; i++) {
      const post = generated10Plan.posts[i]
      const text = post.content

      // 1. Tiêu chí Sự thật (CRM Facts)
      let crmScore = 10
      const crmCheck = validateCrmInvariants(text, sampleCampaign, sampleCampaign.products[0])
      if (!crmCheck.matchedPrice) crmScore -= 3
      if (!crmCheck.matchedDiscount) crmScore -= 3
      if (!crmCheck.matchedVoucher) crmScore -= 4
      crmScore = Math.max(0, crmScore)

      // 2. Tiêu chí Brand Voice
      let voiceScore = 10
      const banned = detectBannedPhrases(text)
      if (banned.length > 0) voiceScore -= 5
      if (!/tụi em|Ưu Đàm|mình|bạn hữu/i.test(text)) voiceScore -= 3
      if (/kính chào|quý khách/i.test(text)) voiceScore -= 4
      voiceScore = Math.max(0, voiceScore)

      // 3. Tiêu chí Tiếng Việt tự nhiên & Không lỗi
      let langScore = 10
      if (text.length < 30) langScore -= 4
      // Kiểm tra không bị lỗi dính từ hay rác encoding
      if (/[A-Za-z0-9]{30,}/.test(text)) langScore -= 3
      langScore = Math.max(0, langScore)

      // 4. Tiêu chí CTA & Format kênh
      let ctaFmtScore = 10
      if (!/nhắn|ghé|mời|tìm hiểu|inbox|bình luận|chi tiết/i.test(text)) ctaFmtScore -= 3
      if (post.channel === 'THREADS' && text.length > 500) ctaFmtScore -= 5
      if (post.channel === 'TIKTOK' && !/kịch bản|hook/i.test(text)) ctaFmtScore -= 4
      if (post.channel === 'WEBSITE' && (!post.title || !post.slug)) ctaFmtScore -= 3
      ctaFmtScore = Math.max(0, ctaFmtScore)

      // Tính tổng điểm trọng số
      const totalScore = Math.round((crmScore * 0.3 + voiceScore * 0.3 + langScore * 0.2 + ctaFmtScore * 0.2) * 10) / 10
      const passed = totalScore >= 8.0

      independentScores.push({
        index: i + 1,
        channel: post.channel,
        factualityScore: crmScore,
        brandVoiceScore: voiceScore,
        naturalLanguageScore: langScore,
        ctaFormatScore: ctaFmtScore,
        totalScore,
        passed,
        feedback: `CRM=${crmScore}, Voice=${voiceScore}, Lang=${langScore}, CTA/Fmt=${ctaFmtScore}`,
        contentExcerpt: text.slice(0, 80).replace(/\n/g, ' ') + '...',
      })
    }

    console.log('\n    --- BẢNG CHẤM ĐIỂM ĐỘC LẬP (INDEPENDENT CHALLENGER SCORECARD) ---')
    console.table(
      independentScores.map((s) => ({
        '#': s.index,
        Channel: s.channel,
        'CRM (30%)': s.factualityScore,
        'Voice (30%)': s.brandVoiceScore,
        'Lang (20%)': s.naturalLanguageScore,
        'CTA/Fmt (20%)': s.ctaFormatScore,
        'Total /10': s.totalScore,
        Passed: s.passed ? '✅ PASS' : '❌ FAIL',
      }))
    )

    const passedCount = independentScores.filter((s) => s.passed).length
    const avgScore = Math.round((independentScores.reduce((sum, s) => sum + s.totalScore, 0) / 10) * 10) / 10
    console.log(`    Independent Evaluation Summary: Passed ${passedCount}/10 posts, Average Score: ${avgScore}/10`)

    check(
      passedCount >= 8,
      `Independent Rubric Gate: Tối thiểu 8/10 bài đạt chuẩn >= 8.0/10 (Thực tế đạt: ${passedCount}/10)`,
      `Điểm TB: ${avgScore}/10`
    )

    // Ghi bảng kết quả rubric độc lập ra file JSON
    fs.writeFileSync(
      path.resolve('.agents/teamwork/challenger_m3_ai/independent-rubric-scores.json'),
      JSON.stringify(independentScores, null, 2)
    )

    // -------------------------------------------------------------------------
    // CHALLENGE 6: CLEAN TEARDOWN & DATABASE BASELINE AUDIT (DELTA = 0)
    // -------------------------------------------------------------------------
    console.log('\n[CHALLENGE PHASE 6] Clean Teardown & Final Database Parity Verification')

    for (const cid of createdCampaignIds) {
      await deleteCampaign(cid)
    }

    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Campaign',
        entityId: { in: createdCampaignIds },
      },
    })
    console.log(`    🧹 Đã dọn dẹp ${createdCampaignIds.length} chiến dịch thử nghiệm và các bản ghi AuditLog liên quan`)

    // Ép WAL checkpoint
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

    // Đối soát 24 bảng baseline
    await verifyBaselineParity('Post-test Final')

    const failedCount = testResults.filter((t) => !t.passed).length
    const passedTestCount = testResults.filter((t) => t.passed).length

    console.log('\n================================================================================')
    console.log(`📊 TỔNG KẾT KIỂM THỬ ĐỐI KHÁNG M3:`)
    console.log(`   - Tổng số kiểm tra: ${testResults.length}`)
    console.log(`   - Thành công: ${passedTestCount}`)
    console.log(`   - Thất bại (Lỗ hổng): ${failedCount}`)
    console.log('================================================================================\n')

    if (failedCount > 0) {
      console.log('⚠️ CÁC LỖ HỔNG / LỖI ĐƯỢC PHÁT HIỆN:')
      for (const t of testResults.filter((t) => !t.passed)) {
        console.log(`   - [FAIL] ${t.name}: ${t.details}`)
      }
      process.exit(2)
    }
  } catch (err) {
    console.error('\n💥 THẤT BẠI TRONG KIỂM THỬ ĐỐI KHÁNG M3:', err)
    // Cố gắng dọn dẹp nếu có lỗi
    try {
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

runAdversarialSuite()
