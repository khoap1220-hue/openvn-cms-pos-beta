import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTier } from '@/lib/types'

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
    const orderCount = await db.order.count({ where: { customerId: id, status: { not: 'CANCELLED' } } })
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
        tier: customer.isMember ? computeTier(totalSpent) : null,
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
