// ===== Thành viên & Tích điểm — vòng đời Khách hàng ⇒ Thành viên =====
// Nguyên tắc:
//  - Khách hàng: mọi người mua hàng (tự tạo từ đơn đầu tiên hoặc thêm tay).
//  - Thành viên: khách hàng đăng ký qua "Nâng cấp thành viên" → cấp mã TV + ngày tham gia.
//  - Tích điểm: đơn hoàn tất (COMPLETED) → +floor(total / 10.000) điểm nếu khách là thành viên
//    tại thời điểm hoàn tất. Idempotent nhờ Sổ Data (1 đơn chỉ ghi POINTS_EARNED 1 lần).
//  - Hạng: tự tính từ tổng chi tiêu tích lũy (đơn không hủy) — computeTier() ở lib/types.
//  - Mọi thao tác ghi Sổ Data scope CUSTOMER.

import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { dispatchWebhook } from '@/lib/webhook-service'
import { computeTier, pointsForTotal } from '@/lib/types'

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

  const memberCode = await nextMemberCode()
  const updated = await db.customer.update({
    where: { id: customerId },
    data: { isMember: true, memberCode, memberAt: new Date() },
  })

  const totalSpent = await db.order
    .aggregate({ where: { customerId, status: { not: 'CANCELLED' } }, _sum: { total: true } })
    .then((r) => r._sum.total ?? 0)
  const tier = computeTier(totalSpent)

  await logLedger({
    scope: 'CUSTOMER',
    action: 'MEMBER_REGISTERED',
    entityType: 'Customer',
    entityId: customerId,
    entityCode: memberCode,
    title: `${customer.name} chính thức trở thành thành viên — mã ${memberCode}`,
    detail: { name: customer.name, phone: customer.phone, memberCode, totalSpent, tier: tier.key },
    actor,
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
  await logLedger({
    scope: 'CUSTOMER',
    action,
    entityType: 'Customer',
    entityId: customerId,
    entityCode: customer.memberCode ?? undefined,
    title: `${verb} ${amount} điểm — ${customer.name} (${customer.memberCode})`,
    detail: {
      mode,
      points: amount,
      before: customer.points,
      after: updated.points,
      note: note?.trim() || (mode === 'EARN' ? 'Bù điểm thủ công' : 'Đổi quà / giảm giá bằng điểm'),
    },
    actor,
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
    const already = await db.ledgerEntry.findFirst({
      where: { action: 'POINTS_EARNED', entityType: 'Order', entityId: orderId },
      select: { id: true },
    })
    if (already) return

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { customer: { select: { id: true, name: true, memberCode: true, isMember: true, points: true } } },
    })
    if (!order || order.status !== 'COMPLETED' || !order.customer) return
    const customer = order.customer
    if (!customer.isMember) return

    const earned = pointsForTotal(order.total)
    if (earned <= 0) return

    const updated = await db.customer.update({
      where: { id: customer.id },
      data: { points: { increment: earned } },
    })

    const totalSpent = await db.order
      .aggregate({ where: { customerId: customer.id, status: { not: 'CANCELLED' } }, _sum: { total: true } })
      .then((r) => r._sum.total ?? 0)
    const tier = computeTier(totalSpent)

    await logLedger({
      scope: 'CUSTOMER',
      action: 'POINTS_EARNED',
      entityType: 'Order',
      entityId: orderId,
      entityCode: order.code,
      title: `+${earned} điểm từ đơn ${order.code} — ${customer.name} (${customer.memberCode})`,
      detail: {
        orderCode: order.code,
        orderTotal: order.total,
        earned,
        rate: '1 điểm / 10.000đ',
        pointsBefore: customer.points,
        pointsAfter: updated.points,
        memberCode: customer.memberCode,
        tier: tier.key,
      },
      actor: 'SYSTEM',
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
