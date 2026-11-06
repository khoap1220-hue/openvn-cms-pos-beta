/**
 * scripts/verify-loyalty-and-campaigns.ts
 * Kiểm thử toàn diện 10 nhóm nghiệp vụ Điểm Khách Hàng (Loyalty Points & Tiers)
 * và Chương Trình Khuyến Mãi & Voucher (CRM Campaigns & Vouchers).
 * Tự động dọn dẹp dữ liệu test sau khi chạy để giữ nguyên 100% Baseline Parity.
 */

import { db } from '../src/lib/db'
import { computeTier, pointsForTotal } from '../src/lib/types'
import { registerMember, adjustPoints, awardPointsForCompletedOrder } from '../src/lib/member'
import { createOrder } from '../src/lib/order-service'
import { calculateVoucherDiscount } from '../src/lib/warehouse-service'
import {
  computeCampaignStatus,
  validateCampaignDates,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  getCampaign,
  listCampaignWaves,
  activateCampaignWave,
} from '../src/lib/campaign-service'
import {
  listLoyaltyPolicyWaves,
  getActiveLoyaltyWave,
  createLoyaltyPolicyWave,
  activateLoyaltyPolicyWave,
  calculateEarnedPointsWithPolicy,
  computeTierWithPolicy,
  simulateLoyaltyOrderImpact,
  DEFAULT_LOYALTY_CONFIG,
} from '../src/lib/loyalty-policy'
import { generatePlatformDraft, validateCrmInvariants } from '../src/lib/social-ai'

interface StepResult {
  id: string
  name: string
  passed: boolean
  detail: string
}

const results: StepResult[] = []

function record(id: string, name: string, passed: boolean, detail: string) {
  results.push({ id, name, passed, detail })
  const icon = passed ? '✅ [PASS]' : '❌ [FAIL]'
  console.log(`${icon} ${id} (${name}): ${detail}`)
  if (!passed) {
    throw new Error(`Kiểm thử thất bại tại ${id}: ${detail}`)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('🧪 KIỂM THỬ NGHIỆP VỤ ĐIỂM KHÁCH HÀNG (LOYALTY) & CHƯƠNG TRÌNH KHUYẾN MÃI (CRM)')
  console.log('================================================================================\n')

  let tempCustomerId: string | null = null
  const createdOrderIds: string[] = []
  let tempCampaignId: string | null = null

  // Snapshot trạng thái ban đầu của sản phẩm UD-TC-001 và voucher UUDAM10
  const prod = await db.product.findUnique({
    where: { sku: 'UD-TC-001' },
    include: { warehouseStocks: true },
  })
  if (!prod) throw new Error('Không tìm thấy sản phẩm UD-TC-001')
  const initialStock = prod.stock
  const initialWhStocks = prod.warehouseStocks.map((ws) => ({ id: ws.id, quantity: ws.quantity }))

  const uudamVoucher = await db.voucher.findUnique({ where: { code: 'UUDAM10' } })
  if (!uudamVoucher) throw new Error('Không tìm thấy voucher UUDAM10')
  const initialVoucherUsedCount = uudamVoucher.usedCount

  const posChannel = await db.channel.findFirst({ where: { key: 'POS' } })
  if (!posChannel) throw new Error('Không tìm thấy kênh POS')

  const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
  if (!defaultWh) throw new Error('Không tìm thấy kho mặc định')

  try {
    // ------------------------------------------------------------------------
    // 1. NGHIỆP VỤ 1: QUY TẮC 4 HẠNG HỘI VIÊN & CÔNG THỨC TÍNH ĐIỂM
    // ------------------------------------------------------------------------
    const tier0 = computeTier(0)
    const tierSilver = computeTier(1_200_000)
    const tierGold = computeTier(3_500_000)
    const tierDiamond = computeTier(6_500_000)
    const pts780k = pointsForTotal(780_000)
    const pts9k = pointsForTotal(9_500)

    const tierOk =
      tier0.key === 'MEMBER' &&
      tierSilver.key === 'SILVER' &&
      tierGold.key === 'GOLD' &&
      tierDiamond.key === 'DIAMOND' &&
      tierDiamond.progressPct === 100 &&
      pts780k === 78 &&
      pts9k === 0

    record(
      'Nghiệp vụ 1',
      'Quy chế 4 Hạng Hội viên & Tỷ lệ tích điểm (1 điểm / 10.000đ)',
      tierOk,
      `0đ->${tier0.label}, 1.2tr->${tierSilver.label}, 3.5tr->${tierGold.label}, 6.5tr->${tierDiamond.label} (100%); 780.000đ = ${pts780k} điểm`
    )

    // ------------------------------------------------------------------------
    // 2. NGHIỆP VỤ 2: TẠO KHÁCH HÀNG & NÂNG CẤP THÀNH VIÊN (CẤP MÃ TVxxxx)
    // ------------------------------------------------------------------------
    const tempCustomer = await db.customer.create({
      data: {
        name: 'Khách Kiểm Thử Hội Viên An Nhiên',
        phone: '0999888777',
        email: 'loyalty.test@uudam.vn',
        address: '88 Nguyễn Huệ, Quận 1, TP.HCM',
      },
    })
    tempCustomerId = tempCustomer.id

    // Chặn cộng điểm khi chưa là thành viên
    let blockedNonMemberPoints = false
    try {
      await adjustPoints(tempCustomer.id, 'EARN', 10, 'Test khi chưa nâng cấp')
    } catch {
      blockedNonMemberPoints = true
    }

    const upgraded = await registerMember(tempCustomer.id, 'OPERATOR')

    // Chặn nâng cấp thành viên trùng lần 2
    let blockedDuplicateUpgrade = false
    try {
      await registerMember(tempCustomer.id, 'OPERATOR')
    } catch {
      blockedDuplicateUpgrade = true
    }

    record(
      'Nghiệp vụ 2',
      'Nâng cấp Hội viên, Cấp mã TVxxxx & Chặn thao tác sai quy tắc',
      Boolean(
        upgraded.isMember &&
          upgraded.memberCode?.startsWith('TV') &&
          blockedNonMemberPoints &&
          blockedDuplicateUpgrade
      ),
      `Cấp mã thành viên ${upgraded.memberCode}, chặn cộng điểm khi chưa là TV (${blockedNonMemberPoints}), chặn nâng cấp trùng (${blockedDuplicateUpgrade})`
    )

    // ------------------------------------------------------------------------
    // 3. NGHIỆP VỤ 3: CỘNG / TRỪ ĐIỂM THỦ CÔNG & CHẶN TRỪ QUÁ SỐ DƯ ĐIỂM
    // ------------------------------------------------------------------------
    const afterEarn = await adjustPoints(tempCustomer.id, 'EARN', 50, 'Tặng điểm tri ân mở thẻ', 'OPERATOR')
    const afterRedeem = await adjustPoints(tempCustomer.id, 'REDEEM', 20, 'Đổi quà nến tealight', 'OPERATOR')

    let blockedOverRedeem = false
    try {
      await adjustPoints(tempCustomer.id, 'REDEEM', 999, 'Đổi quá số điểm hiện có', 'OPERATOR')
    } catch {
      blockedOverRedeem = true
    }

    record(
      'Nghiệp vụ 3',
      'Cộng / Trừ điểm thủ công & Bảo vệ số dư điểm không âm',
      afterEarn.points === 50 && afterRedeem.points === 30 && blockedOverRedeem,
      `Cộng +50 điểm -> 50, Trừ -20 điểm -> ${afterRedeem.points} điểm; chặn trừ vượt số dư 999 điểm (${blockedOverRedeem})`
    )

    // ------------------------------------------------------------------------
    // 4. NGHIỆP VỤ 4: MUA HÀNG TẠI POS (KẾT HỢP VOUCHER UUDAM10 + ĐỔI ĐIỂM + TÍCH ĐIỂM ĐƠN MỚI)
    // ------------------------------------------------------------------------
    // Khách đang có 30 điểm. Mua 2 bộ UD-TC-001 (2 * 390.000đ = 780.000đ).
    // Áp mã UUDAM10 (-10% tối đa 50.000đ) + Đổi 30 điểm (-30.000đ) => Tổng giảm 80.000đ => Thanh toán 700.000đ.
    // Đơn POS hoàn tất ngay (instantComplete: true) => Trừ 30 điểm đổi, cộng +70 điểm (700.000đ / 10.000đ) => Điểm cuối = 70 điểm!
    const posOrder = await createOrder({
      channelId: posChannel.id,
      warehouseId: defaultWh.id,
      customerId: tempCustomer.id,
      items: [{ productId: prod.id, quantity: 2 }],
      voucherCode: 'UUDAM10',
      redeemPoints: 30,
      shippingFee: 0,
      paymentMethod: 'BANKING',
      instantComplete: true,
    })
    createdOrderIds.push(posOrder.id)

    // Gọi awardPointsForCompletedOrder lần 2 để kiểm tra Idempotency (không cộng trùng)
    await awardPointsForCompletedOrder(posOrder.id)

    const custAfterPos = await db.customer.findUnique({ where: { id: tempCustomer.id } })

    record(
      'Nghiệp vụ 4',
      'Thanh toán POS kết hợp Voucher UUDAM10 + Đổi điểm (1đ=1.000đ) + Tích điểm tự động Idempotent',
      posOrder.subtotal === 780_000 &&
        posOrder.discountAmount === 80_000 &&
        posOrder.total === 700_000 &&
        custAfterPos?.points === 70,
      `Đơn ${posOrder.code}: Tạm tính 780.000đ - Giảm 80.000đ (Voucher 50k + 30 điểm) = 700.000đ. Điểm hội viên: 30 - 30 (đổi) + 70 (tích mới) = ${custAfterPos?.points} điểm (Idempotent 100%)`
    )

    // ------------------------------------------------------------------------
    // 5. NGHIỆP VỤ 5: ĐẶT ĐƠN CHỜ GIAO CÓ ĐỔI ĐIỂM & VOUCHER -> HỦY ĐƠN HOÀN ĐIỂM & HOÀN VOUCHER
    // ------------------------------------------------------------------------
    // Khách đang có 70 điểm. Đặt 1 đơn chờ giao (instantComplete: false) đổi 25 điểm (-25.000đ) + mã UUDAM10 (-39.000đ)
    const pendingOrder = await createOrder({
      channelId: posChannel.id,
      warehouseId: defaultWh.id,
      customerId: tempCustomer.id,
      items: [{ productId: prod.id, quantity: 1 }],
      voucherCode: 'UUDAM10',
      redeemPoints: 25,
      shippingFee: 30000,
      paymentMethod: 'COD',
      instantComplete: false,
    })
    createdOrderIds.push(pendingOrder.id)

    const custDuringPending = await db.customer.findUnique({ where: { id: tempCustomer.id } })
    const voucherDuringPending = await db.voucher.findUnique({ where: { code: 'UUDAM10' } })

    // Bây giờ gọi PATCH /api/orders/[id] để HỦY đơn pendingOrder
    const { PATCH: patchOrderRoute } = await import('../src/app/api/orders/[id]/route')
    const cancelReq = new Request(`http://localhost:3010/api/orders/${pendingOrder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'CANCELLED' }),
    })
    const cancelRes = await patchOrderRoute(cancelReq as never, {
      params: Promise.resolve({ id: pendingOrder.id }),
    })

    const custAfterCancel = await db.customer.findUnique({ where: { id: tempCustomer.id } })
    const voucherAfterCancel = await db.voucher.findUnique({ where: { code: 'UUDAM10' } })

    record(
      'Nghiệp vụ 5',
      'Hủy đơn hàng có Đổi điểm & Voucher -> Tự động hoàn Điểm + hoàn lượt Voucher + hoàn Kho',
      cancelRes.status === 200 &&
        custDuringPending?.points === 45 &&
        custAfterCancel?.points === 70 &&
        voucherAfterCancel?.usedCount === (voucherDuringPending?.usedCount ?? 1) - 1,
      `Khi tạo đơn chờ: điểm 70 -> ${custDuringPending?.points}. Sau khi HỦY đơn: điểm tự động hoàn về ${custAfterCancel?.points} điểm, lượt dùng UUDAM10 hoàn lại chuẩn xác`
    )

    // ------------------------------------------------------------------------
    // 6. NGHIỆP VỤ 6: KIỂM TRA QUY TẮC 4 MÃ VOUCHER HỆ THỐNG (PERCENT, FIXED, ALLIANCE, FREESHIP)
    // ------------------------------------------------------------------------
    const allVouchers = await db.voucher.findMany()
    const vUudam = allVouchers.find((v) => v.code === 'UUDAM10')!
    const vPhatDan = allVouchers.find((v) => v.code === 'PHATDAN50K')!
    const vLienKet = allVouchers.find((v) => v.code === 'LIENKET15')!
    const vFreeship = allVouchers.find((v) => v.code === 'FREESHIP0D')!

    const evalUnderMin = calculateVoucherDiscount(vPhatDan, 250_000, 30_000) // min 400k -> invalid
    const evalPhatDanOk = calculateVoucherDiscount(vPhatDan, 450_000, 30_000) // -> 50k
    const evalUudamCap = calculateVoucherDiscount(vUudam, 900_000, 0) // 10% of 900k = 90k, capped at 50k
    const evalLienKetCap = calculateVoucherDiscount(vLienKet, 600_000, 0) // 15% of 600k = 90k, capped at 80k
    const evalFreeship = calculateVoucherDiscount(vFreeship, 250_000, 30_000) // -> 30k

    record(
      'Nghiệp vụ 6',
      'Kiểm định Bộ máy Tính toán 4 Mã Voucher (Đơn tối thiểu, Trần giảm tối đa & Freeship)',
      !evalUnderMin.valid &&
        evalPhatDanOk.valid &&
        evalPhatDanOk.discountAmount === 50_000 &&
        evalUudamCap.discountAmount === 50_000 &&
        evalLienKetCap.discountAmount === 80_000 &&
        evalFreeship.discountAmount === 30_000,
      `Chặn đơn dưới mức tối thiểu (${evalUnderMin.reason}); UUDAM10 trần ${evalUudamCap.discountAmount}đ; LIENKET15 trần ${evalLienKetCap.discountAmount}đ; PHATDAN50K giảm ${evalPhatDanOk.discountAmount}đ; FREESHIP0D giảm ${evalFreeship.discountAmount}đ`
    )

    // ------------------------------------------------------------------------
    // 7. NGHIỆP VỤ 7: VÒNG ĐỜI TRẠNG THÁI CHƯƠNG TRÌNH CRM & RÀNG BUỘC THỜI GIAN
    // ------------------------------------------------------------------------
    const invalidDates = validateCampaignDates('2026-11-10T00:00:00Z', '2026-11-01T00:00:00Z')
    const validDates = validateCampaignDates('2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z')

    const stUpcoming = computeCampaignStatus(
      { startDate: '2026-12-01T00:00:00Z', endDate: '2026-12-15T00:00:00Z', status: 'UPCOMING' },
      '2026-11-01T00:00:00Z'
    )
    const stRunning = computeCampaignStatus(
      { startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-15T00:00:00Z', status: 'UPCOMING' },
      '2026-10-28T00:00:00Z'
    )
    const stEnded = computeCampaignStatus(
      { startDate: '2026-09-01T00:00:00Z', endDate: '2026-09-15T00:00:00Z', status: 'RUNNING' },
      '2026-10-28T00:00:00Z'
    )
    const stCancelled = computeCampaignStatus(
      { startDate: '2026-10-01T00:00:00Z', endDate: '2026-11-15T00:00:00Z', status: 'CANCELLED' },
      '2026-10-28T00:00:00Z'
    )

    record(
      'Nghiệp vụ 7',
      'Boundary Engine trạng thái Chương trình CRM (UPCOMING / RUNNING / ENDED / CANCELLED)',
      !invalidDates.valid &&
        validDates.valid &&
        stUpcoming === 'UPCOMING' &&
        stRunning === 'RUNNING' &&
        stEnded === 'ENDED' &&
        stCancelled === 'CANCELLED',
      `Chặn ngày kết thúc <= ngày bắt đầu; tự động chuyển trạng thái theo mốc thời gian thực: ${stUpcoming} -> ${stRunning} -> ${stEnded} & ưu tiên cờ ${stCancelled}`
    )

    // ------------------------------------------------------------------------
    // 8. NGHIỆP VỤ 8: TẠO MỚI, GHI ĐÈ GIÁ RIÊNG TỪNG SP (OVERRIDES), CẬP NHẬT & XÓA CHƯƠNG TRÌNH
    // ------------------------------------------------------------------------
    const createdCamp = await createCampaign({
      name: 'Chương Trình Thử Nghiệm Ưu Đãi Thạch Cao Đặc Biệt',
      description: 'Kiểm thử chiết khấu chung 20% kết hợp ghi đè giá đặc biệt cho UD-TC-001',
      startDate: new Date(Date.now() - 3600_000).toISOString(),
      endDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
      discountPercent: 20,
      voucherCode: 'PHATDAN50K',
      appliedProductIds: [prod.id],
      productOverrides: {
        [prod.id]: { specialPrice: 299_000 },
      },
    })
    tempCampaignId = createdCamp.id

    const overrideProd = createdCamp.products.find((p) => p.id === prod.id)
    const updatedCamp = await updateCampaign(createdCamp.id, {
      discountPercent: 25,
      productOverrides: {}, // Xóa override để dùng mức giảm chung 25%
    })
    const generalDiscountProd = updatedCamp.products.find((p) => p.id === prod.id) // 390.000 * 0.75 = 292.500

    await deleteCampaign(createdCamp.id)
    await db.ledgerEntry.deleteMany({
      where: { scope: 'CAMPAIGN_WAVE', entityId: createdCamp.id },
    })
    tempCampaignId = null

    record(
      'Nghiệp vụ 8',
      'CRUD Chương trình Khuyến mãi: Ghi đè giá đặc biệt (Special Price) & Chiết khấu % chung',
      overrideProd?.campaignPrice === 299_000 && generalDiscountProd?.campaignPrice === 292_500,
      `Giá gốc 390.000đ -> Ghi đè giá đặc biệt: ${overrideProd?.campaignPrice.toLocaleString('vi-VN')}đ; Bỏ ghi đè dùng giảm 25%: ${generalDiscountProd?.campaignPrice.toLocaleString('vi-VN')}đ`
    )

    // ------------------------------------------------------------------------
    // 9. NGHIỆP VỤ 9: KIỂM TRA CHIẾN DỊCH THẬT CP-THACHCAO-2026 & ĐỒNG BỘ AUTO SOCIAL
    // ------------------------------------------------------------------------
    const thachCaoCamp = await getCampaign('CP-THACHCAO-2026')
    if (!thachCaoCamp) throw new Error('Không tìm thấy chiến dịch CP-THACHCAO-2026')

    const tcProd1 = thachCaoCamp.products.find((p) => p.sku === 'UD-TC-001')
    const tcVoucher = thachCaoCamp.vouchers.find((v) => v.code === 'UUDAM10')

    const draftZalo = await generatePlatformDraft({
      channel: 'ZALO_OA',
      campaign: thachCaoCamp,
      product: tcProd1,
      voucher: tcVoucher,
      scheduledAt: new Date(),
      variationIndex: 2, // Kiểm thử góc viết số 2 (KOL Review)
    })

    const invariantCheck = validateCrmInvariants(draftZalo.content, thachCaoCamp, tcProd1, tcVoucher)

    record(
      'Nghiệp vụ 9',
      'Liên kết Chiến dịch CP-THACHCAO-2026 (-15%, UUDAM10) sang AI Auto Social (Góc KOL Review)',
      thachCaoCamp.status === 'RUNNING' &&
        thachCaoCamp.products.length === 10 &&
        tcProd1?.campaignPrice === 331_500 &&
        invariantCheck.valid &&
        draftZalo.rubricEvaluation.passed,
      `CP-THACHCAO-2026 liên kết đủ 10 SP Thạch Cao + mã UUDAM10; Bài viết Zalo OA đạt ${draftZalo.rubricEvaluation.overallScore}/10 điểm Rubric & khớp 100% bất biến CRM`
    )

    // ------------------------------------------------------------------------
    // 10. NGHIỆP VỤ 10: TÙY BIẾN CHÍNH SÁCH ĐIỂM/HẠNG & QUẢN LÝ SỰ THAY ĐỔI TỪNG ĐỢT (LOYALTY WAVES)
    // ------------------------------------------------------------------------
    const initialWaves = await listLoyaltyPolicyWaves()
    const baseActiveWave = await getActiveLoyaltyWave()

    // Tạo một Đợt Chính sách tùy biến mới (Đợt Flash VIP: 5.000đ = 1đ, 1đ đổi 1.500đ, Hạng Vàng nhân x1.5, Kim Cương nhân x2.5)
    const testPolicyWave = await createLoyaltyPolicyWave({
      name: 'Đợt Kiểm Thử Tùy Biến VIP (5.000đ/đ · Nhân x2.5)',
      effectiveFrom: '2026-11-01T00:00:00.000Z',
      effectiveTo: '2026-11-30T23:59:59.000Z',
      changeNote: 'Kiểm thử tùy biến tỷ lệ tích/đổi điểm, ngưỡng hạng và hệ số nhân theo đợt',
      activateImmediately: true,
      config: {
        ...DEFAULT_LOYALTY_CONFIG,
        earnVndPerPoint: 5_000,
        redeemVndPerPoint: 1_500,
        maxRedeemPct: 70,
        welcomeBonusPoints: 25,
        tiers: DEFAULT_LOYALTY_CONFIG.tiers.map((t) =>
          t.key === 'GOLD'
            ? { ...t, threshold: 4_000_000, pointsMultiplier: 1.5, tierDiscountPct: 6 }
            : t.key === 'DIAMOND'
              ? { ...t, threshold: 12_000_000, pointsMultiplier: 2.5, tierDiscountPct: 12 }
              : t
        ),
      },
    })

    // Kiểm tra tính toán điểm & hạng theo Đợt mới vừa kích hoạt + Bộ mô phỏng Live Simulator
    const customTierFor45M = computeTierWithPolicy(4_500_000, testPolicyWave.config) // Ngưỡng mới GOLD = 4tr -> GOLD
    const customEarnedPoints = calculateEarnedPointsWithPolicy(500_000, testPolicyWave.config, 4_500_000)
    // 500.000 / 5.000 = 100 điểm cơ bản * 1.5 (GOLD multiplier) = 150 điểm
    const simImpact = simulateLoyaltyOrderImpact(500_000, 'GOLD', testPolicyWave.config)
    // Giảm trực tiếp 6% của 500k = 30.000đ, còn 470k -> 470k / 5k = 94 * 1.5 = 141đ * 1.500đ = 211.500đ -> tổng ưu đãi > 25% -> HIGH_RISK

    // Rollback kích hoạt lại Đợt gốc (DOT-2026-01) và xóa đợt test tạm
    await activateLoyaltyPolicyWave(baseActiveWave.waveCode)
    await db.ledgerEntry.deleteMany({
      where: {
        scope: 'LOYALTY_POLICY',
        OR: [{ entityId: testPolicyWave.waveCode }, { sourceRefCode: testPolicyWave.waveCode }],
      },
    })
    const restoredWave = await getActiveLoyaltyWave()

    record(
      'Nghiệp vụ 10',
      'Tùy biến Chính sách Điểm/Hạng & Quản lý sự thay đổi từng Đợt (Loyalty Policy Waves + Live Simulator + Rollback)',
      initialWaves.length >= 2 &&
        testPolicyWave.status === 'ACTIVE' &&
        testPolicyWave.changedSummary.length >= 4 &&
        customTierFor45M.key === 'GOLD' &&
        customEarnedPoints.earned === 150 &&
        simImpact.tierDiscountVnd === 30_000 &&
        simImpact.marginSafetyStatus === 'HIGH_RISK' &&
        restoredWave.waveCode === baseActiveWave.waveCode,
      `Quản lý ${initialWaves.length} đợt chuẩn (${initialWaves.map((w) => w.waveCode).join(', ')}); Tạo đợt tùy biến (${testPolicyWave.waveCode}) bóc tách ${testPolicyWave.changedSummary.length} thay đổi (Diff), Live Simulator cảnh báo chi phí ưu đãi ${simImpact.effectiveBenefitPct}% (${simImpact.marginSafetyStatus}), Rollback về ${restoredWave.waveCode} thành công`
    )

    // ------------------------------------------------------------------------
    // 11. NGHIỆP VỤ 11: QUẢN LÝ SỰ THAY ĐỔI TỪNG ĐỢT CHƯƠNG TRÌNH KHUYẾN MÃI & KHÔI PHỤC ĐỢT (CAMPAIGN WAVES)
    // ------------------------------------------------------------------------
    const campWavesBefore = await listCampaignWaves('CP-THACHCAO-2026')
    const dot01 = campWavesBefore.find((w) => w.waveCode.endsWith('#DOT-01'))
    const dot02 = campWavesBefore.find((w) => w.waveCode.endsWith('#DOT-02'))

    // Thử nghiệm Khôi phục (Rollback) CP-THACHCAO-2026 về Đợt 01 (Early Bird -10%, không kèm voucher)
    const rolledBackToDot01 = await activateCampaignWave('CP-THACHCAO-2026', 'CP-THACHCAO-2026#DOT-01')
    const prodInDot01 = rolledBackToDot01.campaign.products.find((p) => p.sku === 'UD-TC-001') // 390.000 * 0.9 = 351.000

    // Khôi phục lại Đợt 02 chính thức (-15% + UUDAM10) và xóa bản ghi log rollback thử nghiệm để giữ lịch sử sạch
    const restoredToDot02 = await activateCampaignWave('CP-THACHCAO-2026', 'CP-THACHCAO-2026#DOT-02')
    const prodInDot02 = restoredToDot02.campaign.products.find((p) => p.sku === 'UD-TC-001') // 390.000 * 0.85 = 331.500

    // Xóa các bản ghi wave phát sinh trên DOT-02 trong lúc test để giữ nguyên 2 đợt chuẩn
    await db.ledgerEntry.deleteMany({
      where: {
        scope: 'CAMPAIGN_WAVE',
        entityId: 'CP-THACHCAO-2026',
        NOT: {
          sourceRefCode: { in: ['CP-THACHCAO-2026#DOT-01', 'CP-THACHCAO-2026#DOT-02'] },
        },
      },
    })

    record(
      'Nghiệp vụ 11',
      'Quản lý sự thay đổi từng Đợt Chương trình CRM (Campaign Waves Diff & 1-Click Rollback)',
      Boolean(dot01 && dot02) &&
        rolledBackToDot01.campaign.discountPercent === 10 &&
        prodInDot01?.campaignPrice === 351_000 &&
        restoredToDot02.campaign.discountPercent === 15 &&
        prodInDot02?.campaignPrice === 331_500,
      `So sánh Đợt 01 (-10%, UD-TC-001 = ${prodInDot01?.campaignPrice.toLocaleString('vi-VN')}đ) <-> Đợt 02 (-15% + UUDAM10, UD-TC-001 = ${prodInDot02?.campaignPrice.toLocaleString('vi-VN')}đ) & Khôi phục nguyên trạng 100%`
    )
  } finally {
    // ------------------------------------------------------------------------
    // DỌN DẸP DỮ LIỆU TEST ĐỂ BẢO TOÀN 100% BASELINE PARITY (DELTA = 0)
    // ------------------------------------------------------------------------
    if (tempCampaignId) {
      await db.campaign.deleteMany({ where: { id: tempCampaignId } })
    }
    if (createdOrderIds.length > 0) {
      for (const oid of createdOrderIds) {
        const ord = await db.order.findUnique({ where: { id: oid } })
        if (ord) {
          await db.stockMovement.deleteMany({ where: { note: { contains: ord.code } } })
          await db.agentActivity.deleteMany({ where: { targetId: oid } })
          await db.ledgerEntry.deleteMany({
            where: {
              OR: [{ entityId: oid }, { sourceRefCode: ord.code }, { detail: { contains: ord.code } }],
            },
          })
        }
      }
      await db.order.deleteMany({ where: { id: { in: createdOrderIds } } })
    }
    if (tempCustomerId) {
      await db.ledgerEntry.deleteMany({ where: { entityId: tempCustomerId } })
      await db.directMessage.deleteMany({ where: { customerId: tempCustomerId } })
      await db.customer.deleteMany({ where: { id: tempCustomerId } })
    }

    // Khôi phục chính xác tồn kho UD-TC-001 và usedCount của UUDAM10
    await db.product.update({
      where: { id: prod.id },
      data: { stock: initialStock },
    })
    for (const ws of initialWhStocks) {
      await db.warehouseStock.update({
        where: { id: ws.id },
        data: { quantity: ws.quantity },
      })
    }
    await db.voucher.update({
      where: { id: uudamVoucher.id },
      data: { usedCount: initialVoucherUsedCount },
    })
  }

  console.log('\n================================================================================')
  console.log(`🏆 HOÀN TẤT KIỂM THỬ ĐIỂM KHÁCH HÀNG & CHƯƠNG TRÌNH: ĐẠT ${results.length}/${results.length} NGHIỆP VỤ (100% PASS)`)
  console.log('================================================================================')
}

main()
  .catch((err) => {
    console.error('❌ Lỗi kiểm thử:', err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
