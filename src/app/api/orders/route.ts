import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createOrder } from '@/lib/order-service'
import { getApiCache, setApiCache } from '@/lib/realtime'
import type { PeriodRange } from '@/lib/lineage'
import { resolvePeriodRange } from '@/lib/lineage'

export const dynamic = 'force-dynamic'

// Nguồn gốc dữ liệu theo kênh bán (đồng bộ lib/lineage.ts)
function originOfChannelKey(key?: string | null): string | null {
  if (!key) return null
  const ck = key.toUpperCase()
  if (ck.includes('SHOPEE')) return 'SHOPEE_SYNC'
  if (ck.includes('ZALO')) return 'ZALO_OA'
  if (ck === 'POS') return 'POS'
  if (['WEBSITE', 'FACEBOOK', 'APP', 'LAZADA', 'TIKTOK', 'TIKI'].includes(ck)) return 'MARKETPLACE_SYNC'
  return null
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const cacheKey = `orders:${searchParams.toString()}`
    const cached = getApiCache<Record<string, unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const search = searchParams.get('search')?.trim()
    const status = searchParams.get('status')
    const channelId = searchParams.get('channelId')
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize')) || 15))

    // ===== Bộ lọc Thời gian + Nguồn gốc + Trạng thái thay đổi (DATA PROVENANCE) =====
    const period: PeriodRange = {
      preset: (searchParams.get('preset') as PeriodRange['preset']) || 'ALL',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }
    const { fromDate, toDate } = resolvePeriodRange(period)
    const originSource = searchParams.get('originSource')
    const onlyChanged = searchParams.get('onlyChanged') // ALL | CHANGED | ORIGINAL

    // Số lần thay đổi theo Sổ Data (đơn từng được sửa có entry changedFields)
    const changedAgg = await db.ledgerEntry.groupBy({
      by: ['entityId'],
      _count: { _all: true },
      where: { entityType: 'Order', changedFields: { not: null }, entityId: { not: null } },
    })
    const changedMap = new Map(changedAgg.map((c) => [c.entityId as string, c._count._all]))

    const where: Record<string, unknown> = {}
    if (status && status !== 'ALL') where.status = status
    if (channelId && channelId !== 'ALL') where.channelId = channelId
    if (search) {
      where.OR = [{ code: { contains: search } }, { customer: { is: { name: { contains: search } } } }, { customer: { is: { phone: { contains: search } } } }]
    }
    if (fromDate || toDate) {
      const created: Record<string, Date> = {}
      if (fromDate) created.gte = fromDate
      if (toDate) created.lt = toDate
      where.createdAt = created
    }
    if (originSource && originSource !== 'ALL') {
      const channels = await db.channel.findMany({ select: { id: true, key: true } })
      const matched = channels.filter((c) => originOfChannelKey(c.key) === originSource).map((c) => c.id)
      where.channelId = matched.length > 0 ? { in: matched } : '__none__'
    }
    if (onlyChanged === 'CHANGED') where.id = { in: [...changedMap.keys()] }
    else if (onlyChanged === 'ORIGINAL') where.id = { notIn: [...changedMap.keys()] }

    // statsWhere: giống where nhưng KHÔNG gạch createdAt — dùng cho đối chiếu Đầu kỳ/Cuối kỳ
    // (hàng tồn từ trước kỳ phải tính cả những đơn tạo TRƯỚC khoảng lọc)
    const { createdAt: _createdAtRange, ...statsWhere } = where

    const [total, statsRows, orders] = await Promise.all([
      db.order.count({ where }),
      // Toàn bộ đơn khớp bộ lọc NGHIỆP VỤ (không gạch thời gian) để dựng đối chiếu kỳ chuẩn kế toán
      // — hàng tồn từ trước kỳ (Đầu kỳ) phải được tính cả những đơn tạo TRƯỚC khoảng lọc
      db.order.findMany({
        where: statsWhere,
        select: { id: true, status: true, createdAt: true, updatedAt: true },
      }),
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

    // ===== Đối chiếu Kỳ: Đầu kỳ chờ → Phát sinh mới → Hoàn tất trong kỳ → Còn lại cuối kỳ =====
    // Công thức chính xác theo mốc thời gian (opening + new − completed = remaining)
    const settledStatuses = ['COMPLETED', 'CANCELLED']
    const toTime = toDate ? toDate.getTime() : Number.POSITIVE_INFINITY
    const fromTime = fromDate ? fromDate.getTime() : Number.NEGATIVE_INFINITY
    const inPeriod = (d: Date) => (!fromDate || d.getTime() >= fromTime) && (!toDate || d.getTime() < toTime)
    const isSettled = (o: { status: string }) => settledStatuses.includes(o.status)
    const newInPeriod = statsRows.filter((o) => inPeriod(o.createdAt)).length
    const completedInPeriod = statsRows.filter((o) => isSettled(o) && inPeriod(o.updatedAt)).length
    const createdBeforeFrom = statsRows.filter((o) => fromDate && o.createdAt.getTime() < fromTime).length
    const settledBeforeFrom = statsRows.filter((o) => isSettled(o) && o.updatedAt.getTime() < fromTime).length
    const openingPending = createdBeforeFrom - settledBeforeFrom
    // Còn lại cuối kỳ = đã tồn tại TRƯỚC mốc cuối kỳ và chưa hoàn tất lúc đó
    const remaining = statsRows.filter(
      (o) => o.createdAt.getTime() < toTime && !(isSettled(o) && o.updatedAt.getTime() < toTime)
    ).length

    // Gắn nguồn gốc + số lần thay đổi cho từng dòng (badge Nguồn gốc / Đã đổi N lần)
    const ordersWithLineage = orders.map((o) => ({
      ...o,
      originSource: originOfChannelKey(o.channel?.key),
      changeCount: changedMap.get(o.id) ?? 0,
    }))

    const responsePayload = {
      orders: ordersWithLineage,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      period: {
        openingPending,
        newInPeriod,
        completedInPeriod,
        remaining,
        fromDate: fromDate?.toISOString() ?? null,
        toDate: toDate?.toISOString() ?? null,
      },
    }
    setApiCache(cacheKey, responsePayload, 15_000)
    return NextResponse.json(responsePayload)
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
      warehouseId: (body.warehouseId as string) || undefined,
      voucherCode: (body.voucherCode as string) || undefined,
      shippingFee: body.shippingFee !== undefined ? Number(body.shippingFee) : undefined,
      discountAmount: body.discountAmount !== undefined ? Number(body.discountAmount) : undefined,
      redeemPoints: body.redeemPoints !== undefined ? Number(body.redeemPoints) : undefined,
      instantComplete: Boolean(body.instantComplete),
    })
    return NextResponse.json({ order }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo đơn hàng'
    console.error('Orders POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
