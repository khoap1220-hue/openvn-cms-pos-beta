import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTier } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()
    const scope = searchParams.get('scope') // ALL | MEMBER | CUSTOMER

    const where: Record<string, unknown> = {}
    if (scope === 'MEMBER') where.isMember = true
    if (scope === 'CUSTOMER') where.isMember = false
    if (search) {
      where.OR = [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }, { memberCode: { contains: search } }]
    }

    const customers = await db.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        orders: { where: { status: { not: 'CANCELLED' } }, select: { total: true, createdAt: true } },
      },
    })

    const data = customers.map((c) => {
      const totalSpent = c.orders.reduce((s, o) => s + o.total, 0)
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        email: c.email,
        address: c.address,
        createdAt: c.createdAt,
        isMember: c.isMember,
        memberCode: c.memberCode,
        memberAt: c.memberAt,
        points: c.points,
        tier: c.isMember ? computeTier(totalSpent) : null,
        stats: {
          orderCount: c.orders.length,
          totalSpent,
          lastOrderAt: c.orders.length > 0 ? c.orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt.toISOString() : null,
        },
      }
    })

    // Sắp xếp: thành viên + tổng chi tiêu giảm dần
    data.sort((a, b) => {
      if (a.isMember !== b.isMember) return a.isMember ? -1 : 1
      return b.stats.totalSpent - a.stats.totalSpent
    })

    // Thống kê toàn bộ (không theo filter) cho các thẻ tổng quan
    const [allCount, memberCount, pointsAgg] = await Promise.all([
      db.customer.count(),
      db.customer.count({ where: { isMember: true } }),
      db.customer.aggregate({ where: { isMember: true }, _sum: { points: true } }),
    ])

    return NextResponse.json({
      customers: data,
      stats: {
        totalCustomers: allCount,
        memberCount,
        customerCount: allCount - memberCount,
        pointsIssued: pointsAgg._sum.points ?? 0,
      },
    })
  } catch (error) {
    console.error('Customers GET error:', error)
    return NextResponse.json({ error: 'Không thể tải khách hàng' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { name, phone, email, address } = body
    if (!name?.trim()) return NextResponse.json({ error: 'Vui lòng nhập tên khách hàng' }, { status: 400 })

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
        email: email?.trim() || null,
        address: address?.trim() || null,
      },
    })
    return NextResponse.json({ customer }, { status: 201 })
  } catch (error) {
    console.error('Customers POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo khách hàng' }, { status: 500 })
  }
}
