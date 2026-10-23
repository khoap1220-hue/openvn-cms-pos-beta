import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createOrder } from '@/lib/order-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim()
    const status = searchParams.get('status')
    const channelId = searchParams.get('channelId')
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 15))

    const where: Record<string, unknown> = {}
    if (status && status !== 'ALL') where.status = status
    if (channelId && channelId !== 'ALL') where.channelId = channelId
    if (search) {
      where.OR = [{ code: { contains: search } }, { customer: { is: { name: { contains: search } } } }, { customer: { is: { phone: { contains: search } } } }]
    }

    const [total, orders] = await Promise.all([
      db.order.count({ where }),
      db.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      }),
    ])

    return NextResponse.json({ orders, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
  } catch (error) {
    console.error('Orders GET error:', error)
    return NextResponse.json({ error: 'Không thể tải đơn hàng' }, { status: 500 })
  }
}

// POST: tạo đơn (POS / bất kỳ kênh) — Agent Autopilot sẽ tự xử lý tiếp
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const order = await createOrder({
      channelId: String(body.channelId ?? ''),
      items: (body.items as Array<{ productId: string; quantity: number }>) ?? [],
      customerId: (body.customerId as string) || undefined,
      customerName: (body.customerName as string) || undefined,
      customerPhone: (body.customerPhone as string) || undefined,
      address: (body.address as string) || undefined,
      note: (body.note as string) || undefined,
      paymentMethod: (body.paymentMethod as string) || undefined,
    })
    return NextResponse.json({ order }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo đơn hàng'
    console.error('Orders POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
