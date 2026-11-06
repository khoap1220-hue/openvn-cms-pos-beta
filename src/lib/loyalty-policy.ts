// =============================================================================
// BỘ MÁY CẤU HÌNH TÙY BIẾN & QUẢN LÝ TỪNG ĐỢT CHÍNH SÁCH ĐIỂM / HẠNG HỘI VIÊN
// (Customizable Loyalty Policy & Multi-Wave Version Control Engine)
// =============================================================================
// Lưu trữ bền vững trong Sổ Data (LedgerEntry scope = 'LOYALTY_POLICY') để:
//  1. Cho phép tùy biến linh hoạt: tỷ lệ tích điểm (VNĐ/điểm), tỷ lệ tiêu điểm (VNĐ/điểm),
//     trần % dùng điểm/đơn, điểm thưởng mở thẻ mới, ngưỡng Freeship, và 4 Hạng Hội viên
//     (tên hạng, ngưỡng chi tiêu, hệ số nhân điểm thưởng x1.0..x2.0, % chiết khấu hạng).
//  2. Quản lý sự thay đổi theo từng ĐỢT (Policy Waves: DOT-2026-01, DOT-2026-02...):
//     lưu đầy đủ snapshot từng đợt, tự động bóc tách Diff so với đợt liền trước,
//     thống kê hiệu quả thực tế từng đợt (số đơn, điểm cấp, điểm đổi, hội viên mới)
//     và cho phép Kích hoạt / Chuyển đổi (Activate / Rollback) giữa các đợt tức thì.
//  3. Bảo toàn 100% bất biến 24 bảng baseline (db/baseline-counts.json Delta = 0).

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import {
  DEFAULT_LOYALTY_CONFIG,
  normalizeLoyaltyConfig,
  diffLoyaltyConfigs,
  computeTierWithPolicy,
  calculateEarnedPointsWithPolicy,
  simulateLoyaltyOrderImpact,
  type TierKey,
  type CustomizableTierConfig,
  type LoyaltyPolicyConfig,
  type PolicyDiffItem,
  type LoyaltyWaveStats,
  type LoyaltyPolicyWave,
} from '@/lib/loyalty-policy-shared'

export {
  DEFAULT_LOYALTY_CONFIG,
  normalizeLoyaltyConfig,
  diffLoyaltyConfigs,
  computeTierWithPolicy,
  calculateEarnedPointsWithPolicy,
  simulateLoyaltyOrderImpact,
  type TierKey,
  type CustomizableTierConfig,
  type LoyaltyPolicyConfig,
  type PolicyDiffItem,
  type LoyaltyWaveStats,
  type LoyaltyPolicyWave,
}


/** Khởi tạo 2 Đợt chính sách mẫu (Đợt 1 gốc & Đợt 2 An Nhiên Thạch) nếu chưa có trong LedgerEntry */
async function ensureSeedPolicyWaves(): Promise<void> {
  const existingCount = await db.ledgerEntry.count({
    where: { scope: 'LOYALTY_POLICY', action: 'POLICY_WAVE_SAVED' },
  })
  if (existingCount > 0) return

  // Đợt 1: Chính sách Hội viên Tiêu chuẩn Khởi đầu 2026 (Đang ACTIVE mặc định để tương thích 100% với công thức chuẩn)
  const wave1Config = normalizeLoyaltyConfig(DEFAULT_LOYALTY_CONFIG)
  const wave1Payload: Omit<LoyaltyPolicyWave, 'id' | 'stats'> = {
    waveCode: 'DOT-2026-01',
    waveNumber: 1,
    name: 'Đợt 1 · Chính sách Hội viên Tiêu chuẩn Ưu Đàm 2026',
    status: 'ACTIVE',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    effectiveTo: null,
    changeNote: 'Thiết lập quy chế 4 Hạng Hội viên gốc (Bạc ≥ 1tr, Vàng ≥ 3tr, Kim cương ≥ 6tr), tích 1 điểm / 10.000đ, tiêu 1 điểm = 1.000đ.',
    actorName: 'Chủ tiệm Ưu Đàm',
    createdAt: '2026-09-01T00:00:00.000Z',
    config: wave1Config,
    changedSummary: diffLoyaltyConfigs(null, wave1Config),
  }

  // Đợt 2: Đợt Đặc Biệt Ra Mắt Bộ Sưu Tập Thạch Cao An Nhiên Thạch (Lên lịch sẵn để chủ shop có thể kích hoạt 1 chạm hoặc tùy biến)
  const wave2Config = normalizeLoyaltyConfig({
    ...DEFAULT_LOYALTY_CONFIG,
    earnVndPerPoint: 10_000,
    redeemVndPerPoint: 1_000,
    maxRedeemPct: 50,
    minOrderForRedeem: 200_000,
    welcomeBonusPoints: 15,
    freeShippingThreshold: 400_000,
    pointExpiryMonths: 12,
    tiers: [
      {
        ...DEFAULT_LOYALTY_CONFIG.tiers[0],
        pointsMultiplier: 1.0,
        tierDiscountPct: 0,
        perks: 'Tặng +15 điểm mở thẻ · Tích 1đ/10k · Đổi điểm giảm tới 50% đơn',
      },
      {
        ...DEFAULT_LOYALTY_CONFIG.tiers[1],
        threshold: 1_000_000,
        pointsMultiplier: 1.2,
        tierDiscountPct: 2,
        perks: 'Nhân x1.2 điểm tích lũy · Ưu đãi -2% dòng Thạch Cao & Nến Bấc Gỗ',
      },
      {
        ...DEFAULT_LOYALTY_CONFIG.tiers[2],
        threshold: 2_500_000,
        pointsMultiplier: 1.5,
        tierDiscountPct: 5,
        perks: 'Hạ ngưỡng lên hạng còn 2,5 triệu · Nhân x1.5 điểm · Tặng tinh dầu xông thạch cao',
      },
      {
        ...DEFAULT_LOYALTY_CONFIG.tiers[3],
        threshold: 5_000_000,
        pointsMultiplier: 2.0,
        tierDiscountPct: 8,
        perks: 'Hạ ngưỡng Kim cương còn 5 triệu · Nhân đôi x2.0 điểm · Ưu đãi VIP -8% & Freeship mọi đơn',
      },
    ],
  })

  const wave2Payload: Omit<LoyaltyPolicyWave, 'id' | 'stats'> = {
    waveCode: 'DOT-2026-02',
    waveNumber: 2,
    name: 'Đợt 2 · Chiến dịch An Nhiên Thạch — Nhân Hệ Số Điểm Hạng (x1.2–x2.0) & Tặng 15đ Mở Thẻ',
    status: 'SCHEDULED',
    effectiveFrom: '2026-10-25T00:00:00.000Z',
    effectiveTo: '2026-11-30T23:59:59.000Z',
    changeNote: 'Đợt kích cầu dòng Thạch Cao & Nến Bấc Gỗ: Tặng +15 điểm mở thẻ mới, hạ ngưỡng Hạng Vàng (2.5tr) & Kim cương (5tr), nhân hệ số điểm x1.2 / x1.5 / x2.0 theo hạng và giảm ngưỡng Freeship xuống 400.000đ.',
    actorName: 'Chủ tiệm Ưu Đàm',
    createdAt: '2026-10-25T08:00:00.000Z',
    config: wave2Config,
    changedSummary: diffLoyaltyConfigs(wave1Config, wave2Config),
  }

  await db.ledgerEntry.create({
    data: {
      scope: 'LOYALTY_POLICY',
      action: 'POLICY_WAVE_SAVED',
      entityType: 'LoyaltyPolicyWave',
      entityCode: wave1Payload.waveCode,
      sourceRefCode: wave1Payload.waveCode,
      title: wave1Payload.name,
      detail: JSON.stringify(wave1Payload),
      actor: 'OPERATOR',
      actorName: wave1Payload.actorName,
      originSource: 'SYSTEM_SEED',
      afterSnapshot: JSON.stringify(wave1Config),
      createdAt: new Date(wave1Payload.createdAt),
    },
  })

  await db.ledgerEntry.create({
    data: {
      scope: 'LOYALTY_POLICY',
      action: 'POLICY_WAVE_SAVED',
      entityType: 'LoyaltyPolicyWave',
      entityCode: wave2Payload.waveCode,
      sourceRefCode: wave2Payload.waveCode,
      title: wave2Payload.name,
      detail: JSON.stringify(wave2Payload),
      actor: 'OPERATOR',
      actorName: wave2Payload.actorName,
      originSource: 'MANUAL_ADMIN',
      beforeSnapshot: JSON.stringify(wave1Config),
      afterSnapshot: JSON.stringify(wave2Config),
      changedFields: JSON.stringify(wave2Payload.changedSummary.map((d) => d.field)),
      createdAt: new Date(wave2Payload.createdAt),
    },
  })
}

/** Đọc danh sách toàn bộ các Đợt chính sách (từ mới nhất -> cũ nhất) kèm thống kê từng đợt */
export async function listLoyaltyPolicyWaves(includeStats = true): Promise<LoyaltyPolicyWave[]> {
  await ensureSeedPolicyWaves()

  const entries = await db.ledgerEntry.findMany({
    where: { scope: 'LOYALTY_POLICY', action: 'POLICY_WAVE_SAVED' },
    orderBy: { createdAt: 'asc' },
  })

  const waves: LoyaltyPolicyWave[] = []
  for (const entry of entries) {
    try {
      const parsed = JSON.parse(entry.detail || '{}') as Partial<LoyaltyPolicyWave>
      const config = normalizeLoyaltyConfig(parsed.config)
      const prevConfig = waves.length > 0 ? waves[waves.length - 1].config : null
      waves.push({
        id: entry.id,
        waveCode: parsed.waveCode || entry.entityCode || `DOT-${waves.length + 1}`,
        waveNumber: parsed.waveNumber || waves.length + 1,
        name: parsed.name || entry.title,
        status: parsed.status || 'ARCHIVED',
        effectiveFrom: parsed.effectiveFrom || entry.createdAt.toISOString(),
        effectiveTo: parsed.effectiveTo ?? null,
        changeNote: parsed.changeNote || '',
        actorName: parsed.actorName || entry.actorName || 'Quản trị viên',
        createdAt: parsed.createdAt || entry.createdAt.toISOString(),
        config,
        changedSummary:
          Array.isArray(parsed.changedSummary) && parsed.changedSummary.length > 0
            ? parsed.changedSummary
            : diffLoyaltyConfigs(prevConfig, config),
      })
    } catch {
      // Bỏ qua bản ghi lỗi định dạng
    }
  }

  // Đảm bảo luôn có đúng 1 đợt ACTIVE (nếu không có thì lấy đợt đầu tiên)
  if (waves.length > 0 && !waves.some((w) => w.status === 'ACTIVE')) {
    waves[0].status = 'ACTIVE'
  }

  if (includeStats && waves.length > 0) {
    const [allOrders, pointEntries, allMembers] = await Promise.all([
      db.order.findMany({
        where: { status: { not: 'CANCELLED' } },
        select: { createdAt: true },
      }),
      db.ledgerEntry.findMany({
        where: { scope: 'CUSTOMER', action: { in: ['POINTS_EARNED', 'POINTS_ADJUSTED', 'POINTS_REDEEMED'] } },
        select: { action: true, detail: true, createdAt: true },
      }),
      db.customer.findMany({
        where: { isMember: true, memberAt: { not: null } },
        select: { memberAt: true },
      }),
    ])

    for (let i = 0; i < waves.length; i++) {
      const w = waves[i]
      const fromMs = new Date(w.effectiveFrom).getTime()
      const toMs = w.effectiveTo
        ? new Date(w.effectiveTo).getTime()
        : i + 1 < waves.length
          ? new Date(waves[i + 1].effectiveFrom).getTime()
          : Number.MAX_SAFE_INTEGER

      let pointsEarned = 0
      let pointsRedeemed = 0
      for (const pe of pointEntries) {
        const t = pe.createdAt.getTime()
        let matchedWaveCode: string | null = null
        try {
          const d = JSON.parse(pe.detail || '{}')
          if (d.waveCode) matchedWaveCode = d.waveCode
        } catch {
          // ignore
        }
        const inWave = matchedWaveCode ? matchedWaveCode === w.waveCode : t >= fromMs && t <= toMs
        if (!inWave) continue

        try {
          const d = JSON.parse(pe.detail || '{}')
          const pts = Number(d.earned ?? d.points ?? 0)
          if (pe.action === 'POINTS_REDEEMED') pointsRedeemed += pts
          else if (pts > 0) pointsEarned += pts
        } catch {
          // ignore
        }
      }

      const ordersInWave = allOrders.filter((o) => {
        const t = o.createdAt.getTime()
        return t >= fromMs && t <= toMs
      }).length

      const newMembersInWave = allMembers.filter((m) => {
        if (!m.memberAt) return false
        const t = m.memberAt.getTime()
        return t >= fromMs && t <= toMs
      }).length

      w.stats = {
        ordersInWave,
        pointsEarnedInWave: pointsEarned,
        pointsRedeemedInWave: pointsRedeemed,
        newMembersInWave,
      }
    }
  }

  return waves.sort((a, b) => b.waveNumber - a.waveNumber)
}

/** Lấy Đợt chính sách đang ACTIVE hiện tại */
export async function getActiveLoyaltyWave(): Promise<LoyaltyPolicyWave> {
  const waves = await listLoyaltyPolicyWaves(false)
  return waves.find((w) => w.status === 'ACTIVE') ?? waves[0]
}

/** Lấy cấu hình LoyaltyPolicyConfig đang ACTIVE */
export async function getActiveLoyaltyPolicy(): Promise<LoyaltyPolicyConfig> {
  const activeWave = await getActiveLoyaltyWave()
  return activeWave.config
}

/** Tạo một Đợt chính sách mới (hoặc cập nhật và lưu thành đợt thay đổi mới) */
export async function createLoyaltyPolicyWave(input: {
  name: string
  effectiveFrom?: string
  effectiveTo?: string | null
  changeNote?: string
  activateImmediately?: boolean
  actorName?: string
  config: Partial<LoyaltyPolicyConfig>
}): Promise<LoyaltyPolicyWave> {
  const existingAsc = (await listLoyaltyPolicyWaves(false)).sort((a, b) => a.waveNumber - b.waveNumber)
  const prevWave = existingAsc.find((w) => w.status === 'ACTIVE') ?? existingAsc[existingAsc.length - 1] ?? null
  const nextNumber = (existingAsc[existingAsc.length - 1]?.waveNumber ?? 0) + 1
  const waveCode = `DOT-2026-${String(nextNumber).padStart(2, '0')}`

  const normalizedConfig = normalizeLoyaltyConfig(input.config)
  const changedSummary = diffLoyaltyConfigs(prevWave?.config, normalizedConfig)
  const activate = input.activateImmediately !== false

  // Nếu kích hoạt ngay đợt mới, chuyển các đợt ACTIVE cũ sang ARCHIVED
  if (activate) {
    const entries = await db.ledgerEntry.findMany({
      where: { scope: 'LOYALTY_POLICY', action: 'POLICY_WAVE_SAVED' },
    })
    for (const entry of entries) {
      try {
        const parsed = JSON.parse(entry.detail || '{}') as LoyaltyPolicyWave
        if (parsed.status === 'ACTIVE') {
          parsed.status = 'ARCHIVED'
          if (!parsed.effectiveTo) parsed.effectiveTo = new Date().toISOString()
          await db.ledgerEntry.update({
            where: { id: entry.id },
            data: { detail: JSON.stringify(parsed) },
          })
        }
      } catch {
        // ignore
      }
    }
  }

  const nowIso = new Date().toISOString()
  const wavePayload: Omit<LoyaltyPolicyWave, 'id' | 'stats'> = {
    waveCode,
    waveNumber: nextNumber,
    name: input.name.trim() || `Đợt ${nextNumber} · Cập nhật Chính sách Hội viên`,
    status: activate ? 'ACTIVE' : 'SCHEDULED',
    effectiveFrom: input.effectiveFrom || nowIso,
    effectiveTo: input.effectiveTo ?? null,
    changeNote: input.changeNote?.trim() || 'Cập nhật tùy biến thông số tích điểm & hạng hội viên',
    actorName: input.actorName?.trim() || 'Chủ tiệm Ưu Đàm',
    createdAt: nowIso,
    config: normalizedConfig,
    changedSummary,
  }

  const created = await db.ledgerEntry.create({
    data: {
      scope: 'LOYALTY_POLICY',
      action: 'POLICY_WAVE_SAVED',
      entityType: 'LoyaltyPolicyWave',
      entityCode: waveCode,
      sourceRefCode: waveCode,
      title: wavePayload.name,
      detail: JSON.stringify(wavePayload),
      actor: 'OPERATOR',
      actorName: wavePayload.actorName,
      originSource: 'MANUAL_ADMIN',
      beforeSnapshot: prevWave ? JSON.stringify(prevWave.config) : null,
      afterSnapshot: JSON.stringify(normalizedConfig),
      changedFields: JSON.stringify(changedSummary.map((d) => d.field)),
    },
  })

  broadcast('loyalty.policy.updated', { waveCode, status: wavePayload.status })

  return {
    id: created.id,
    ...wavePayload,
  }
}

/** Kích hoạt (Activate / Rollback) một Đợt chính sách bất kỳ theo ID hoặc waveCode */
export async function activateLoyaltyPolicyWave(
  waveIdOrCode: string,
  actorName = 'Chủ tiệm Ưu Đàm'
): Promise<LoyaltyPolicyWave> {
  await ensureSeedPolicyWaves()
  const entries = await db.ledgerEntry.findMany({
    where: { scope: 'LOYALTY_POLICY', action: 'POLICY_WAVE_SAVED' },
    orderBy: { createdAt: 'asc' },
  })

  let targetEntry = entries.find((e) => e.id === waveIdOrCode || e.entityCode === waveIdOrCode)
  if (!targetEntry) {
    for (const e of entries) {
      try {
        const p = JSON.parse(e.detail || '{}')
        if (p.waveCode === waveIdOrCode) {
          targetEntry = e
          break
        }
      } catch {
        // ignore
      }
    }
  }
  if (!targetEntry) {
    throw new Error(`Không tìm thấy đợt chính sách: ${waveIdOrCode}`)
  }

  let activatedWave: LoyaltyPolicyWave | null = null

  for (const entry of entries) {
    const parsed = JSON.parse(entry.detail || '{}') as LoyaltyPolicyWave
    if (entry.id === targetEntry.id) {
      parsed.status = 'ACTIVE'
      activatedWave = { ...parsed, id: entry.id, config: normalizeLoyaltyConfig(parsed.config) }
    } else if (parsed.status === 'ACTIVE') {
      parsed.status = 'ARCHIVED'
    }
    await db.ledgerEntry.update({
      where: { id: entry.id },
      data: { detail: JSON.stringify(parsed) },
    })
  }

  if (!activatedWave) {
    throw new Error('Không thể kích hoạt đợt chính sách')
  }

  await db.ledgerEntry.create({
    data: {
      scope: 'LOYALTY_POLICY',
      action: 'POLICY_WAVE_ACTIVATED',
      entityType: 'LoyaltyPolicyWave',
      entityId: activatedWave.id,
      entityCode: activatedWave.waveCode,
      sourceRefCode: activatedWave.waveCode,
      title: `Kích hoạt áp dụng ${activatedWave.waveCode}: ${activatedWave.name}`,
      detail: JSON.stringify({
        waveCode: activatedWave.waveCode,
        name: activatedWave.name,
        activatedBy: actorName,
        activatedAt: new Date().toISOString(),
      }),
      actor: 'OPERATOR',
      actorName,
      originSource: 'MANUAL_ADMIN',
    },
  })

  broadcast('loyalty.policy.updated', { waveCode: activatedWave.waveCode, status: 'ACTIVE' })
  return activatedWave
}

/** Cập nhật trực tiếp cấu hình của một Đợt chính sách hiện có */
export async function updateLoyaltyPolicyWave(
  waveIdOrCode: string,
  updates: {
    name?: string
    effectiveFrom?: string
    effectiveTo?: string | null
    changeNote?: string
    config?: Partial<LoyaltyPolicyConfig>
  }
): Promise<LoyaltyPolicyWave> {
  await ensureSeedPolicyWaves()
  const entries = await db.ledgerEntry.findMany({
    where: { scope: 'LOYALTY_POLICY', action: 'POLICY_WAVE_SAVED' },
    orderBy: { createdAt: 'asc' },
  })

  const idx = entries.findIndex((e) => {
    if (e.id === waveIdOrCode || e.entityCode === waveIdOrCode) return true
    try {
      return JSON.parse(e.detail || '{}').waveCode === waveIdOrCode
    } catch {
      return false
    }
  })

  if (idx === -1) {
    throw new Error(`Không tìm thấy đợt chính sách: ${waveIdOrCode}`)
  }

  const entry = entries[idx]
  const parsed = JSON.parse(entry.detail || '{}') as LoyaltyPolicyWave
  const prevConfig = idx > 0 ? normalizeLoyaltyConfig(JSON.parse(entries[idx - 1].detail || '{}').config) : null
  const nextConfig = updates.config ? normalizeLoyaltyConfig({ ...parsed.config, ...updates.config }) : normalizeLoyaltyConfig(parsed.config)

  const updatedPayload: LoyaltyPolicyWave = {
    ...parsed,
    id: entry.id,
    name: updates.name !== undefined ? updates.name.trim() || parsed.name : parsed.name,
    effectiveFrom: updates.effectiveFrom !== undefined ? updates.effectiveFrom : parsed.effectiveFrom,
    effectiveTo: updates.effectiveTo !== undefined ? updates.effectiveTo : parsed.effectiveTo,
    changeNote: updates.changeNote !== undefined ? updates.changeNote.trim() : parsed.changeNote,
    config: nextConfig,
    changedSummary: diffLoyaltyConfigs(prevConfig, nextConfig),
  }

  await db.ledgerEntry.update({
    where: { id: entry.id },
    data: {
      title: updatedPayload.name,
      detail: JSON.stringify(updatedPayload),
      afterSnapshot: JSON.stringify(nextConfig),
      changedFields: JSON.stringify(updatedPayload.changedSummary.map((d) => d.field)),
    },
  })

  broadcast('loyalty.policy.updated', { waveCode: updatedPayload.waveCode, status: updatedPayload.status })
  return updatedPayload
}
