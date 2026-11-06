// ===== Thành viên & Tích điểm — vòng đời Khách hàng ⇒ Thành viên =====
// Nguyên tắc:
//  - Khách hàng: mọi người mua hàng (tự tạo từ đơn đầu tiên hoặc thêm tay).
//  - Thành viên: khách hàng đăng ký qua "Nâng cấp thành viên" → cấp mã TV + ngày tham gia.
//  - Tích điểm: đơn hoàn tất (COMPLETED) → +floor(total / 10.000) điểm nếu khách là thành viên
//    tại thời điểm hoàn tất. Idempotent nhờ Sổ Data (1 đơn chỉ ghi POINTS_EARNED 1 lần).
//  - Hạng: tự tính từ tổng chi tiêu tích lũy (đơn không hủy) — computeTier() ở lib/types.
//  - Mọi thao tác ghi Sổ Data scope CUSTOMER.

import { db } from '@/lib/db'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { dispatchWebhook } from '@/lib/webhook-service'
import { computeTier, pointsForTotal } from '@/lib/types'
import {
  getActiveLoyaltyWave,
  computeTierWithPolicy,
  calculateEarnedPointsWithPolicy,
} from '@/lib/loyalty-policy'

/** Sinh mã thành viên tiếp theo (TV0001, TV0002, ...) — quét mã hiện có, lấy max + 1 */
export async function nextMemberCode(): Promise<string> {
  const members = await db.customer.findMany({
    where: { memberCode: { not: null } },
    select: { memberCode: true },
  })
  let max = 0
  for (const m of members) {
    const match = /^TV(\d+)$/.exec(m.memberCode ?? '')
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `TV${String(max + 1).padStart(4, '0')}`
}

/** Đăng ký thành viên cho 1 khách hàng — trả về customer đã cập nhật */
export async function registerMember(customerId: string, actor: 'OPERATOR' | 'SYSTEM' = 'OPERATOR') {
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new Error('Không tìm thấy khách hàng')
  if (customer.isMember) throw new Error('Khách hàng này đã là thành viên')

  const activeWave = await getActiveLoyaltyWave().catch(() => null)
  const welcomeBonus = activeWave?.config.welcomeBonusPoints ?? 0

  const memberCode = await nextMemberCode()
  const updated = await db.customer.update({
    where: { id: customerId },
    data: {
      isMember: true,
      memberCode,
      memberAt: new Date(),
      ...(welcomeBonus > 0 ? { points: { increment: welcomeBonus } } : {}),
    },
  })

  const totalSpent = await db.order
    .aggregate({ where: { customerId, status: { not: 'CANCELLED' } }, _sum: { total: true } })
    .then((r) => r._sum.total ?? 0)
  const tier = activeWave ? computeTierWithPolicy(totalSpent, activeWave.config) : computeTier(totalSpent)

  await recordLineageChange({
    scope: 'CUSTOMER',
    action: 'MEMBER_REGISTERED',
    entityType: 'Customer',
    entityId: customerId,
    entityCode: memberCode,
    sourceRefCode: memberCode,
    title: `${customer.name} chính thức trở thành thành viên — mã ${memberCode}${welcomeBonus > 0 ? ` (+${welcomeBonus} điểm mở thẻ)` : ''}`,
    before: { isMember: false, points: customer.points },
    after: { isMember: true, memberCode, points: updated.points },
    actor,
    actorName: actor === 'OPERATOR' ? 'Người vận hành' : 'Agent Tự động',
    originSource: actor === 'OPERATOR' ? 'MANUAL_ADMIN' : 'AGENT_AUTOPILOT',
    detail: {
      name: customer.name,
      phone: customer.phone,
      memberCode,
      totalSpent,
      tier: tier.key,
      welcomeBonusPoints: welcomeBonus,
      waveCode: activeWave?.waveCode ?? 'DOT-2026-01',
    },
  })
  broadcast('customer.updated', { id: customerId, isMember: true, memberCode })
  dispatchWebhook('member.registered', {
    customerId,
    name: customer.name,
    phone: customer.phone,
    memberCode,
    tier: tier.key,
    totalSpent,
  })

  return updated
}

export type PointsMode = 'EARN' | 'REDEEM'

/** Cộng (EARN — bù điểm) / Trừ (REDEEM — đổi quà) điểm thủ công, có lý do */
export async function adjustPoints(customerId: string, mode: PointsMode, points: number, note?: string, actor: 'OPERATOR' | 'SYSTEM' = 'OPERATOR') {
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) throw new Error('Không tìm thấy khách hàng')
  if (!customer.isMember) throw new Error('Chỉ thành viên mới có điểm tích lũy')
  const amount = Math.floor(Number(points))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Số điểm phải là số nguyên dương')
  if (mode === 'REDEEM' && amount > customer.points) {
    throw new Error(`Chỉ có thể trừ tối đa ${customer.points} điểm (điểm hiện có của thành viên)`)
  }

  const delta = mode === 'EARN' ? amount : -amount
  const updated = await db.customer.update({
    where: { id: customerId },
    data: { points: { increment: delta } },
  })

  const action = mode === 'EARN' ? 'POINTS_ADJUSTED' : 'POINTS_REDEEMED'
  const verb = mode === 'EARN' ? 'Cộng' : 'Trừ'
  await recordLineageChange({
    scope: 'CUSTOMER',
    action,
    entityType: 'Customer',
    entityId: customerId,
    entityCode: customer.memberCode ?? undefined,
    sourceRefCode: customer.memberCode ?? undefined,
    title: `${verb} ${amount} điểm — ${customer.name} (${customer.memberCode})`,
    before: { points: customer.points },
    after: { points: updated.points },
    actor,
    actorName: actor === 'OPERATOR' ? 'Người vận hành' : 'Agent Tự động',
    originSource: actor === 'OPERATOR' ? 'MANUAL_ADMIN' : 'AGENT_AUTOPILOT',
    detail: {
      mode,
      points: amount,
      note: note?.trim() || (mode === 'EARN' ? 'Bù điểm thủ công' : 'Đổi quà / giảm giá bằng điểm'),
    },
  })
  broadcast('customer.updated', { id: customerId, points: updated.points })

  return updated
}

/**
 * Tích điểm tự động khi 1 đơn chuyển sang COMPLETED (hoàn tất).
 * Luật: khách là thành viên tại thời điểm hoàn tất → +floor(order.total / 10.000) điểm.
 * Idempotent: nếu Sổ Data đã có POINTS_EARNED cho mã đơn này thì bỏ qua.
 * Lỗi không được làm hỏng nghiệp vụ chính — bắt mọi exception.
 */
export async function awardPointsForCompletedOrder(orderId: string): Promise<void> {
  try {
    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { customer: { select: { id: true, name: true, memberCode: true, isMember: true, points: true } } },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return

    const already = await db.ledgerEntry.findFirst({
      where: {
        action: 'POINTS_EARNED',
        OR: [
          { entityType: 'Order', entityId: orderId },
          { entityType: 'Customer', sourceRefCode: order.code },
        ],
      },
      select: { id: true },
    })
    if (already) return
    const customer = order.customer
    if (!customer.isMember) return

    const totalSpent = await db.order
      .aggregate({ where: { customerId: customer.id, status: { not: 'CANCELLED' } }, _sum: { total: true } })
      .then((r) => r._sum.total ?? 0)

    const activeWave = await getActiveLoyaltyWave().catch(() => null)
    const calc = activeWave
      ? calculateEarnedPointsWithPolicy(order.total, activeWave.config, totalSpent)
      : { earned: pointsForTotal(order.total), basePoints: pointsForTotal(order.total), multiplier: 1.0, tierKey: computeTier(totalSpent).key }
    const earned = calc.earned
    if (earned <= 0) return

    const updated = await db.customer.update({
      where: { id: customer.id },
      data: { points: { increment: earned } },
    })

    const tier = activeWave ? computeTierWithPolicy(totalSpent, activeWave.config) : computeTier(totalSpent)
    const earnRateLabel = activeWave
      ? `1 điểm / ${activeWave.config.earnVndPerPoint.toLocaleString('vi-VN')}đ${calc.multiplier !== 1 ? ` (x${calc.multiplier})` : ''}`
      : '1 điểm / 10.000đ'

    await recordLineageChange({
      scope: 'CUSTOMER',
      action: 'POINTS_EARNED',
      entityType: 'Customer',
      entityId: customer.id,
      entityCode: customer.memberCode ?? undefined,
      sourceRefCode: order.code,
      title: `+${earned} điểm từ đơn ${order.code} — ${customer.name} (${customer.memberCode})`,
      before: { points: customer.points },
      after: { points: updated.points },
      actor: 'AGENT',
      actorName: 'Agent Tự động',
      originSource: 'AGENT_AUTOPILOT',
      detail: {
        orderCode: order.code,
        orderTotal: order.total,
        earned,
        basePoints: calc.basePoints,
        multiplier: calc.multiplier,
        rate: earnRateLabel,
        waveCode: activeWave?.waveCode ?? 'DOT-2026-01',
        waveName: activeWave?.name,
        pointsBefore: customer.points,
        pointsAfter: updated.points,
        memberCode: customer.memberCode,
        tier: tier.key,
      },
    })
    broadcast('customer.updated', { id: customer.id, points: updated.points, earned, orderCode: order.code })
    dispatchWebhook('member.points', {
      customerId: customer.id,
      memberCode: customer.memberCode,
      orderCode: order.code,
      earned,
      points: updated.points,
      tier: tier.key,
    })
  } catch (error) {
    console.error('awardPointsForCompletedOrder error:', error)
  }
}
