import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { computeTier } from '@/lib/types'
import { getActiveLoyaltyPolicy, computeTierWithPolicy } from '@/lib/loyalty-policy'
import { getLineageMeta } from '@/lib/lineage-server'

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

    const [customers, activePolicy] = await Promise.all([
      db.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          orders: { where: { status: { not: 'CANCELLED' } }, select: { total: true, createdAt: true } },
        },
      }),
      getActiveLoyaltyPolicy().catch(() => null),
    ])

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
        tier: c.isMember ? (activePolicy ? computeTierWithPolicy(totalSpent, activePolicy) : computeTier(totalSpent)) : null,
        originSource: 'MANUAL_ADMIN' as string,
        changeCount: 0,
        stats: {
          orderCount: c.orders.length,
          totalSpent,
          lastOrderAt: c.orders.length > 0 ? c.orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt.toISOString() : null,
        },
      }
    })

    // DATA PROVENANCE — số lần sửa + nguồn gốc theo Sổ Data
    const lineageMeta = await getLineageMeta('Customer', data.map((c) => c.id))
    for (const c of data) {
      c.changeCount = lineageMeta.get(c.id)?.changeCount ?? 0
      c.originSource = (lineageMeta.get(c.id)?.originSource ?? 'MANUAL_ADMIN') as string
    }

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

    const trimmedPhone = phone?.trim() || null
    if (trimmedPhone) {
      const existing = await db.customer.findFirst({
        where: { phone: trimmedPhone },
      })
      if (existing) {
        return NextResponse.json(
          { error: 'Số điện thoại này đã được đăng ký cho khách hàng khác' },
          { status: 400 }
        )
      }
    }

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        phone: trimmedPhone,
        email: email?.trim() || null,
        address: address?.trim() || null,
      },
    })
    // Khách mới → dựng ngay chân dung: xưng hô + avatar + nhận diện tên
    const { ensureCustomerProfile } = await import('@/lib/memory-engine')
    await ensureCustomerProfile(customer.id).catch(() => null)
    // DATA LINEAGE — snapshot gốc hồ sơ khách
    await recordLineageChange({
      scope: 'CUSTOMER',
      action: 'CUSTOMER_ORIGINAL',
      entityType: 'Customer',
      entityId: customer.id,
      entityCode: customer.phone ?? customer.name,
      sourceRefCode: customer.phone ?? undefined,
      title: `Hồ sơ khách hàng ${customer.name} được tạo mới`,
      after: { name: customer.name, phone: customer.phone, isMember: false, points: 0 },
      actor: 'OPERATOR',
      actorName: 'Người vận hành',
      originSource: 'MANUAL_ADMIN',
    })
    return NextResponse.json({ customer }, { status: 201 })
  } catch (error) {
    console.error('Customers POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo khách hàng' }, { status: 500 })
  }
}
