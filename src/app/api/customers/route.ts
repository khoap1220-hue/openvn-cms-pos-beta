import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()

    const where: Record<string, unknown> = {}
    if (search) {
      where.OR = [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }]
    }

    const customers = await db.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        orders: { where: { status: { not: 'CANCELLED' } }, select: { total: true, createdAt: true } },
      },
    })

    const data = customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      createdAt: c.createdAt,
      stats: {
        orderCount: c.orders.length,
        totalSpent: c.orders.reduce((s, o) => s + o.total, 0),
        lastOrderAt: c.orders.length > 0 ? c.orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0].createdAt.toISOString() : null,
      },
    }))

    // Sắp xếp theo tổng chi tiêu giảm dần
    data.sort((a, b) => b.stats.totalSpent - a.stats.totalSpent)

    return NextResponse.json({ customers: data })
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
