// =============================================================================
// CẤU HÌNH & CÔNG THỨC TÍNH ĐIỂM / HẠNG HỘI VIÊN DÙNG CHUNG (CLIENT + SERVER)
// Không phụ thuộc Prisma hay Node.js runtime để an toàn 100% trên trình duyệt.
// =============================================================================

import { MEMBER_TIERS, POINTS_VND_RATE, type MemberTierInfo } from '@/lib/types'

export type TierKey = 'MEMBER' | 'SILVER' | 'GOLD' | 'DIAMOND'

export interface CustomizableTierConfig {
  key: TierKey
  label: string
  /** Ngưỡng tổng chi tiêu tích lũy (VNĐ) để đạt hạng */
  threshold: number
  /** Hệ số nhân điểm tích lũy của hạng (VD: 1.0, 1.2, 1.5, 2.0) */
  pointsMultiplier: number
  /** % chiết khấu ưu đãi đặc quyền theo hạng (VD: 0, 2, 5, 8) */
  tierDiscountPct: number
  /** Quyền lợi mô tả hiển thị cho thu ngân & khách hàng */
  perks: string
  badge: string
  bar: string
}

export interface LoyaltyPolicyConfig {
  /** Bao nhiêu VNĐ thanh toán = 1 điểm cơ sở (Mặc định: 10.000đ) */
  earnVndPerPoint: number
  /** 1 điểm đổi được bao nhiêu VNĐ khi thanh toán (Mặc định: 1.000đ) */
  redeemVndPerPoint: number
  /** Giới hạn tối đa % giá trị đơn hàng được thanh toán bằng điểm (Mặc định: 50%) */
  maxRedeemPct: number
  /** Giá trị đơn hàng tối thiểu được phép dùng điểm (Mặc định: 0đ) */
  minOrderForRedeem: number
  /** Điểm thưởng chào mừng tặng ngay khi nâng cấp Hội viên mới (Mặc định: 0) */
  welcomeBonusPoints: number
  /** Ngưỡng đơn hàng được miễn phí vận chuyển tự động (Mặc định: 500.000đ) */
  freeShippingThreshold: number
  /** Thời hạn hiệu lực của điểm (tháng, Mặc định: 12) */
  pointExpiryMonths: number
  /** Cấu hình 4 Hạng Hội viên */
  tiers: CustomizableTierConfig[]
}

export interface PolicyDiffItem {
  field: string
  label: string
  before: string
  after: string
}

export interface LoyaltyWaveStats {
  ordersInWave: number
  pointsEarnedInWave: number
  pointsRedeemedInWave: number
  newMembersInWave: number
}

export interface LoyaltyPolicyWave {
  id: string
  waveCode: string
  waveNumber: number
  name: string
  status: 'ACTIVE' | 'SCHEDULED' | 'ARCHIVED'
  effectiveFrom: string
  effectiveTo: string | null
  changeNote: string
  actorName: string
  createdAt: string
  config: LoyaltyPolicyConfig
  changedSummary: PolicyDiffItem[]
  stats?: LoyaltyWaveStats
}

/** Cấu hình Đợt 1 tiêu chuẩn mặc định của Ưu Đàm */
export const DEFAULT_LOYALTY_CONFIG: LoyaltyPolicyConfig = {
  earnVndPerPoint: POINTS_VND_RATE, // 10.000đ = 1 điểm
  redeemVndPerPoint: 1_000, // 1 điểm = 1.000đ
  maxRedeemPct: 100, // Cho phép đổi tối đa 100% giá trị đơn (tương thích ngược)
  minOrderForRedeem: 0,
  welcomeBonusPoints: 0,
  freeShippingThreshold: 500_000,
  pointExpiryMonths: 12,
  tiers: [
    {
      key: 'MEMBER',
      label: 'Thành viên mới',
      threshold: 0,
      pointsMultiplier: 1.0,
      tierDiscountPct: 0,
      perks: 'Tích 1 điểm / 10.000đ · Đổi điểm giảm giá trực tiếp tại POS & Online',
      badge: MEMBER_TIERS[0].badge,
      bar: MEMBER_TIERS[0].bar,
    },
    {
      key: 'SILVER',
      label: 'Hạng Bạc',
      threshold: 1_000_000,
      pointsMultiplier: 1.0,
      tierDiscountPct: 0,
      perks: 'Tích điểm tiêu chuẩn · Ưu tiên nhận mã giảm giá lễ hội Ưu Đàm',
      badge: MEMBER_TIERS[1].badge,
      bar: MEMBER_TIERS[1].bar,
    },
    {
      key: 'GOLD',
      label: 'Hạng Vàng',
      threshold: 3_000_000,
      pointsMultiplier: 1.0,
      tierDiscountPct: 0,
      perks: 'Quà tặng tinh dầu / bấc gỗ dịp sinh nhật · Ưu tiên đóng gói hộp quà cao cấp',
      badge: MEMBER_TIERS[2].badge,
      bar: MEMBER_TIERS[2].bar,
    },
    {
      key: 'DIAMOND',
      label: 'Hạng Kim cương',
      threshold: 6_000_000,
      pointsMultiplier: 1.0,
      tierDiscountPct: 0,
      perks: 'Đặc quyền VIP Ưu Đàm · Tặng mẫu thử tuyệt tác Thạch Cao mới & Freeship ưu tiên',
      badge: MEMBER_TIERS[3].badge,
      bar: MEMBER_TIERS[3].bar,
    },
  ],
}

/** Chuẩn hóa & bảo vệ tính toàn vẹn của cấu hình LoyaltyPolicyConfig */
export function normalizeLoyaltyConfig(raw?: Partial<LoyaltyPolicyConfig> | null): LoyaltyPolicyConfig {
  const base = DEFAULT_LOYALTY_CONFIG
  if (!raw) return structuredClone(base)

  const earnVndPerPoint = Math.max(1_000, Math.round(Number(raw.earnVndPerPoint) || base.earnVndPerPoint))
  const redeemVndPerPoint = Math.max(100, Math.round(Number(raw.redeemVndPerPoint) || base.redeemVndPerPoint))
  const maxRedeemPct = Math.min(100, Math.max(5, Math.round(Number(raw.maxRedeemPct) || base.maxRedeemPct)))
  const minOrderForRedeem = Math.max(0, Math.round(Number(raw.minOrderForRedeem) ?? base.minOrderForRedeem))
  const welcomeBonusPoints = Math.max(0, Math.round(Number(raw.welcomeBonusPoints) ?? base.welcomeBonusPoints))
  const freeShippingThreshold = Math.max(0, Math.round(Number(raw.freeShippingThreshold) ?? base.freeShippingThreshold))
  const pointExpiryMonths = Math.max(1, Math.round(Number(raw.pointExpiryMonths) || base.pointExpiryMonths))

  const rawTiers = Array.isArray(raw.tiers) ? raw.tiers : []
  const tiers: CustomizableTierConfig[] = base.tiers.map((defTier) => {
    const found = rawTiers.find((t) => t?.key === defTier.key)
    if (!found) return { ...defTier }
    return {
      key: defTier.key,
      label: String(found.label || defTier.label).trim() || defTier.label,
      threshold: defTier.key === 'MEMBER' ? 0 : Math.max(100_000, Math.round(Number(found.threshold) ?? defTier.threshold)),
      pointsMultiplier: Math.max(0.5, Math.min(10, Number(found.pointsMultiplier) || defTier.pointsMultiplier)),
      tierDiscountPct: Math.max(0, Math.min(50, Number(found.tierDiscountPct) ?? defTier.tierDiscountPct)),
      perks: String(found.perks ?? defTier.perks).trim() || defTier.perks,
      badge: defTier.badge,
      bar: defTier.bar,
    }
  })

  // Đảm bảo ngưỡng tăng dần từ MEMBER -> SILVER -> GOLD -> DIAMOND
  tiers.sort((a, b) => {
    const order: Record<TierKey, number> = { MEMBER: 0, SILVER: 1, GOLD: 2, DIAMOND: 3 }
    return order[a.key] - order[b.key]
  })
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].threshold <= tiers[i - 1].threshold) {
      tiers[i].threshold = tiers[i - 1].threshold + 500_000
    }
  }

  return {
    earnVndPerPoint,
    redeemVndPerPoint,
    maxRedeemPct,
    minOrderForRedeem,
    welcomeBonusPoints,
    freeShippingThreshold,
    pointExpiryMonths,
    tiers,
  }
}

const fmtVnd = (n: number) => `${n.toLocaleString('vi-VN')}₫`

/** So sánh 2 cấu hình giữa 2 đợt để sinh bảng Diff trực quan */
export function diffLoyaltyConfigs(
  prev: LoyaltyPolicyConfig | null | undefined,
  next: LoyaltyPolicyConfig
): PolicyDiffItem[] {
  if (!prev) {
    return [
      {
        field: 'init',
        label: 'Khởi tạo chính sách gốc',
        before: 'Chưa thiết lập',
        after: `Tích 1đ/${fmtVnd(next.earnVndPerPoint)} · Tiêu 1đ=${fmtVnd(next.redeemVndPerPoint)}`,
      },
    ]
  }
  const diffs: PolicyDiffItem[] = []

  if (prev.earnVndPerPoint !== next.earnVndPerPoint) {
    diffs.push({
      field: 'earnVndPerPoint',
      label: 'Tỷ lệ tích điểm',
      before: `1 điểm / ${fmtVnd(prev.earnVndPerPoint)}`,
      after: `1 điểm / ${fmtVnd(next.earnVndPerPoint)}`,
    })
  }
  if (prev.redeemVndPerPoint !== next.redeemVndPerPoint) {
    diffs.push({
      field: 'redeemVndPerPoint',
      label: 'Giá trị đổi 1 điểm',
      before: `1 điểm = ${fmtVnd(prev.redeemVndPerPoint)}`,
      after: `1 điểm = ${fmtVnd(next.redeemVndPerPoint)}`,
    })
  }
  if (prev.maxRedeemPct !== next.maxRedeemPct) {
    diffs.push({
      field: 'maxRedeemPct',
      label: 'Trần thanh toán bằng điểm',
      before: `Tối đa ${prev.maxRedeemPct}% đơn`,
      after: `Tối đa ${next.maxRedeemPct}% đơn`,
    })
  }
  if (prev.minOrderForRedeem !== next.minOrderForRedeem) {
    diffs.push({
      field: 'minOrderForRedeem',
      label: 'Đơn tối thiểu được đổi điểm',
      before: fmtVnd(prev.minOrderForRedeem),
      after: fmtVnd(next.minOrderForRedeem),
    })
  }
  if (prev.welcomeBonusPoints !== next.welcomeBonusPoints) {
    diffs.push({
      field: 'welcomeBonusPoints',
      label: 'Điểm thưởng mở thẻ Hội viên',
      before: `+${prev.welcomeBonusPoints} điểm`,
      after: `+${next.welcomeBonusPoints} điểm`,
    })
  }
  if (prev.freeShippingThreshold !== next.freeShippingThreshold) {
    diffs.push({
      field: 'freeShippingThreshold',
      label: 'Ngưỡng Freeship tự động',
      before: `Đơn ≥ ${fmtVnd(prev.freeShippingThreshold)}`,
      after: `Đơn ≥ ${fmtVnd(next.freeShippingThreshold)}`,
    })
  }
  if (prev.pointExpiryMonths !== next.pointExpiryMonths) {
    diffs.push({
      field: 'pointExpiryMonths',
      label: 'Thời hạn hiệu lực điểm',
      before: `${prev.pointExpiryMonths} tháng`,
      after: `${next.pointExpiryMonths} tháng`,
    })
  }

  for (const nextTier of next.tiers) {
    const prevTier = prev.tiers.find((t) => t.key === nextTier.key)
    if (!prevTier) continue
    if (prevTier.label !== nextTier.label) {
      diffs.push({
        field: `tier_${nextTier.key}_label`,
        label: `Tên hạng ${nextTier.key}`,
        before: prevTier.label,
        after: nextTier.label,
      })
    }
    if (prevTier.threshold !== nextTier.threshold) {
      diffs.push({
        field: `tier_${nextTier.key}_threshold`,
        label: `Ngưỡng lên ${nextTier.label}`,
        before: fmtVnd(prevTier.threshold),
        after: fmtVnd(nextTier.threshold),
      })
    }
    if (prevTier.pointsMultiplier !== nextTier.pointsMultiplier) {
      diffs.push({
        field: `tier_${nextTier.key}_multiplier`,
        label: `Hệ số nhân điểm ${nextTier.label}`,
        before: `x${prevTier.pointsMultiplier}`,
        after: `x${nextTier.pointsMultiplier}`,
      })
    }
    if (prevTier.tierDiscountPct !== nextTier.tierDiscountPct) {
      diffs.push({
        field: `tier_${nextTier.key}_discount`,
        label: `Chiết khấu đặc quyền ${nextTier.label}`,
        before: `${prevTier.tierDiscountPct}%`,
        after: `${nextTier.tierDiscountPct}%`,
      })
    }
  }

  return diffs
}

/** Tính hạng thành viên dựa trên cấu hình Đợt chính sách hiện hành */
export function computeTierWithPolicy(
  totalSpent: number,
  config: LoyaltyPolicyConfig = DEFAULT_LOYALTY_CONFIG
): MemberTierInfo & { pointsMultiplier: number; tierDiscountPct: number; perks: string } {
  const sorted = [...config.tiers].sort((a, b) => a.threshold - b.threshold)
  let current = sorted[0]
  for (const t of sorted) {
    if (totalSpent >= t.threshold) current = t
  }
  const next = sorted.find((t) => t.threshold > current.threshold)
  if (!next) {
    return {
      key: current.key,
      label: current.label,
      threshold: current.threshold,
      progressPct: 100,
      pointsMultiplier: current.pointsMultiplier,
      tierDiscountPct: current.tierDiscountPct,
      perks: current.perks,
    }
  }
  const span = next.threshold - current.threshold
  const progressPct = Math.max(0, Math.min(100, Math.round(((totalSpent - current.threshold) / span) * 100)))
  return {
    key: current.key,
    label: current.label,
    threshold: current.threshold,
    nextKey: next.key,
    nextLabel: next.label,
    nextThreshold: next.threshold,
    progressPct,
    pointsMultiplier: current.pointsMultiplier,
    tierDiscountPct: current.tierDiscountPct,
    perks: current.perks,
  }
}

/** Tính số điểm tích lũy cho 1 đơn hoàn tất theo Đợt chính sách & Hạng hội viên */
export function calculateEarnedPointsWithPolicy(
  orderTotal: number,
  config: LoyaltyPolicyConfig = DEFAULT_LOYALTY_CONFIG,
  totalSpentForTier = 0
): { earned: number; basePoints: number; multiplier: number; tierKey: TierKey; tierLabel: string } {
  const tierInfo = computeTierWithPolicy(totalSpentForTier, config)
  const basePoints = Math.max(0, Math.floor(orderTotal / config.earnVndPerPoint))
  const multiplier = tierInfo.pointsMultiplier || 1.0
  const earned = Math.max(0, Math.floor(basePoints * multiplier))
  return {
    earned,
    basePoints,
    multiplier,
    tierKey: tierInfo.key as TierKey,
    tierLabel: tierInfo.label,
  }
}

/**
 * Bộ mô phỏng trực tiếp (Live Simulator) hiệu quả & chi phí ưu đãi trên 1 đơn hàng mẫu
 * giúp Chủ cửa hàng kiểm tra ngay biên lợi nhuận trước khi bấm Lưu Đợt chính sách.
 */
export function simulateLoyaltyOrderImpact(
  sampleOrderVnd: number,
  tierKey: TierKey,
  config: LoyaltyPolicyConfig = DEFAULT_LOYALTY_CONFIG
): {
  sampleOrderVnd: number
  tierKey: TierKey
  tierLabel: string
  tierDiscountPct: number
  tierDiscountVnd: number
  netPayableAfterTierVnd: number
  earnedPoints: number
  earnedPointsValueVnd: number
  maxRedeemAllowedVnd: number
  maxRedeemAllowedPoints: number
  isFreeshipEligible: boolean
  totalBenefitValueVnd: number
  effectiveBenefitPct: number
  marginSafetyStatus: 'SAFE' | 'MODERATE' | 'HIGH_RISK'
} {
  const safeOrder = Math.max(0, Math.round(sampleOrderVnd || 0))
  const tier = config.tiers.find((t) => t.key === tierKey) ?? config.tiers[0]
  const tierDiscountPct = tier?.tierDiscountPct ?? 0
  const tierDiscountVnd = Math.round((safeOrder * tierDiscountPct) / 100)
  const netPayableAfterTierVnd = Math.max(0, safeOrder - tierDiscountVnd)

  const basePts = Math.floor(netPayableAfterTierVnd / Math.max(1000, config.earnVndPerPoint))
  const earnedPoints = Math.max(0, Math.floor(basePts * (tier?.pointsMultiplier ?? 1)))
  const earnedPointsValueVnd = earnedPoints * Math.max(100, config.redeemVndPerPoint)

  const maxRedeemAllowedVnd =
    safeOrder >= config.minOrderForRedeem
      ? Math.floor((netPayableAfterTierVnd * config.maxRedeemPct) / 100)
      : 0
  const maxRedeemAllowedPoints = Math.floor(
    maxRedeemAllowedVnd / Math.max(100, config.redeemVndPerPoint)
  )

  const isFreeshipEligible =
    config.freeShippingThreshold > 0 && netPayableAfterTierVnd >= config.freeShippingThreshold

  const totalBenefitValueVnd = tierDiscountVnd + earnedPointsValueVnd
  const effectiveBenefitPct =
    safeOrder > 0 ? Number(((totalBenefitValueVnd / safeOrder) * 100).toFixed(1)) : 0

  const marginSafetyStatus: 'SAFE' | 'MODERATE' | 'HIGH_RISK' =
    effectiveBenefitPct <= 15 ? 'SAFE' : effectiveBenefitPct <= 25 ? 'MODERATE' : 'HIGH_RISK'

  return {
    sampleOrderVnd: safeOrder,
    tierKey: tier?.key ?? 'MEMBER',
    tierLabel: tier?.label ?? 'Thành viên mới',
    tierDiscountPct,
    tierDiscountVnd,
    netPayableAfterTierVnd,
    earnedPoints,
    earnedPointsValueVnd,
    maxRedeemAllowedVnd,
    maxRedeemAllowedPoints,
    isFreeshipEligible,
    totalBenefitValueVnd,
    effectiveBenefitPct,
    marginSafetyStatus,
  }
}
