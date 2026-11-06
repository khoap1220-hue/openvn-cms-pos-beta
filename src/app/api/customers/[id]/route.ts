import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTier } from '@/lib/types'
import { getActiveLoyaltyPolicy, computeTierWithPolicy } from '@/lib/loyalty-policy'

export const dynamic = 'force-dynamic'

// GET: chi tiết 1 khách hàng (thành viên + lịch sử đơn hàng gần nhất)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const customer = await db.customer.findUnique({
      where: { id },
      include: {
        orders: {
          where: { status: { not: 'CANCELLED' } },
          orderBy: { createdAt: 'desc' },
          take: 30,
          select: { id: true, code: true, status: true, total: true, paymentMethod: true, createdAt: true },
        },
      },
    })
    if (!customer) return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })

    const totalSpent = customer.orders.reduce((s, o) => s + o.total, 0)
    const [orderCount, activePolicy] = await Promise.all([
      db.order.count({ where: { customerId: id, status: { not: 'CANCELLED' } } }),
      getActiveLoyaltyPolicy().catch(() => null),
    ])
    const lastOrder = customer.orders[0]

    return NextResponse.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        address: customer.address,
        createdAt: customer.createdAt,
        isMember: customer.isMember,
        memberCode: customer.memberCode,
        memberAt: customer.memberAt,
        points: customer.points,
        // Trí nhớ dài hạn + chân dung
        avatarUrl: customer.avatarUrl,
        salutation: customer.salutation,
        inferredProfile: customer.inferredProfile,
        contextSummary: customer.contextSummary,
        preferences: customer.preferences,
        painPoints: customer.painPoints,
        nextFollowUp: customer.nextFollowUp,
        memoryUpdatedAt: customer.memoryUpdatedAt,
        tier: customer.isMember ? (activePolicy ? computeTierWithPolicy(totalSpent, activePolicy) : computeTier(totalSpent)) : null,
        stats: {
          orderCount,
          totalSpent,
          lastOrderAt: lastOrder?.createdAt.toISOString() ?? null,
        },
      },
      orders: customer.orders,
    })
  } catch (error) {
    console.error('Customer GET error:', error)
    return NextResponse.json({ error: 'Không thể tải chi tiết khách hàng' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>
    let existing = await db.customer.findUnique({ where: { id } })
    if (!existing && typeof body.phone === 'string' && body.phone.trim()) {
      existing = await db.customer.findFirst({ where: { phone: body.phone.trim() } })
    }
    if (!existing) return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })

    const data: Record<string, unknown> = {}
    for (const strKey of [
      'name',
      'phone',
      'email',
      'address',
      'salutation',
      'avatarUrl',
      'inferredProfile',
      'contextSummary',
      'preferences',
      'painPoints',
      'nextFollowUp',
    ]) {
      if (body[strKey] !== undefined) {
        data[strKey] = body[strKey] === null ? null : String(body[strKey]).trim() || null
      }
    }
    if (typeof data.name === 'string' && !data.name) delete data.name
    if (body.isMember !== undefined) data.isMember = Boolean(body.isMember)
    if (body.points !== undefined && Number.isFinite(Number(body.points))) {
      data.points = Math.max(0, Math.round(Number(body.points)))
    }

    const updated = await db.customer.update({
      where: { id: existing.id },
      data,
    })
    return NextResponse.json({ customer: updated })
  } catch (error) {
    console.error('Customer PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật khách hàng' }, { status: 500 })
  }
}

export const PUT = PATCH
