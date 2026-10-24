import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent, sendZalo } from '@/lib/agent-log'
import { recordLineageChangeAsync } from '@/lib/ledger'
import { AGENTS, CARRIERS, makeTrackingCode, tCarrier, buildVoiceContext, zaloKeyOf } from '@/lib/agents'
import type { PeriodRange } from '@/lib/lineage'
import { resolvePeriodRange } from '@/lib/lineage'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const codStatus = searchParams.get('codStatus')

    // ===== Bộ lọc Thời gian + Nguồn gốc + Trạng thái thay đổi (DATA PROVENANCE) =====
    const period: PeriodRange = {
      preset: (searchParams.get('preset') as PeriodRange['preset']) || 'ALL',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }
    const { fromDate, toDate } = resolvePeriodRange(period)
    const originSource = searchParams.get('originSource') // AGENT_AUTOPILOT | MANUAL_ADMIN
    const onlyChanged = searchParams.get('onlyChanged') // ALL | CHANGED | ORIGINAL

    const where: Record<string, unknown> = {}
    if (status && status !== 'ALL') where.status = status
    if (codStatus && codStatus !== 'ALL') where.codStatus = codStatus
    if (originSource === 'AGENT_AUTOPILOT') where.dispatchedBy = 'AGENT'
    else if (originSource === 'MANUAL_ADMIN') where.dispatchedBy = 'OPERATOR'
    if (fromDate || toDate) {
      const created: Record<string, Date> = {}
      if (fromDate) created.gte = fromDate
      if (toDate) created.lt = toDate
      where.createdAt = created
    }

    // onlyChanged: đối chiếu Sổ Data — vận đơn từng được sửa (có entry changedFields)
    const changedAgg = await db.ledgerEntry.groupBy({
      by: ['entityId'],
      _count: { _all: true },
      where: { entityType: 'Shipment', changedFields: { not: null }, entityId: { not: null } },
    })
    const changedMap = new Map(changedAgg.map((c) => [c.entityId as string, c._count._all]))
    if (onlyChanged === 'CHANGED') where.id = { in: [...changedMap.keys()] }
    else if (onlyChanged === 'ORIGINAL') where.id = { notIn: [...changedMap.keys()] }

    // statsWhere: giống where nhưng KHÔNG gạch createdAt — dùng cho đối chiếu Đầu kỳ/Cuối kỳ
    // (vận đơn tồn từ trước kỳ phải tính cả những cái tạo TRƯỚC khoảng lọc)
    const { createdAt: _createdAtRange, ...statsWhere } = where

    const startOfDay = new Date(new Date().setHours(0, 0, 0, 0))

    const [shipments, active, deliveredToday, dispatchedToday, statsRows, codPendingAgg, codReceivedAgg] = await Promise.all([
      db.shipment.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: 100,
        include: {
          order: {
            select: {
              code: true,
              total: true,
              status: true,
              paymentMethod: true,
              address: true,
              customer: { select: { id: true, name: true, phone: true } },
              channel: { select: { id: true, key: true, name: true, color: true } },
              items: { select: { quantity: true, product: { select: { sku: true, name: true, fragile: true } } } },
            },
          },
        },
      }),
      db.shipment.count({ where: { status: { in: ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT'] } } }),
      db.shipment.count({ where: { status: 'DELIVERED', updatedAt: { gte: startOfDay } } }),
      db.shipment.count({ where: { createdAt: { gte: startOfDay } } }),
      // Toàn bộ vận đơn khớp bộ lọc nghiệp vụ (không gạch thời gian) cho đối chiếu kỳ
      db.shipment.findMany({
        where: statsWhere,
        select: { id: true, status: true, createdAt: true, updatedAt: true },
      }),
      // Đối soát COD: tiền chờ ĐVVC chuyển về + số vận đơn chờ
      db.shipment.aggregate({
        where: { codStatus: 'PENDING' },
        _count: true,
        _sum: { codAmount: true },
      }),
      db.shipment.aggregate({
        where: { codStatus: { in: ['RECEIVED', 'RECONCILED'] }, codReceivedAt: { gte: startOfDay } },
        _sum: { codReceived: true },
      }),
    ])

    // ===== Đối chiếu Kỳ: Đầu kỳ chờ → Phát sinh mới → Hoàn tất trong kỳ → Còn lại cuối kỳ =====
    // Công thức chính xác theo mốc thời gian:
    //   remainingAtEnd = (tạo trước cuối kỳ) − (đã hoàn tất trước cuối kỳ)
    //   opening = (tạo trước đầu kỳ) − (hoàn tất trước đầu kỳ)
    //   opening + new − completed = remainingAtEnd (luôn khớp)
    const filtered = statsRows
    const inPeriod = (d: Date) => (!fromDate || d.getTime() >= fromTime) && (!toDate || d.getTime() < toTime)
    const settledStatuses = ['DELIVERED', 'RETURNED']
    const toTime = toDate ? toDate.getTime() : Number.POSITIVE_INFINITY
    const fromTime = fromDate ? fromDate.getTime() : Number.NEGATIVE_INFINITY
    const isSettled = (s: { status: string }) => settledStatuses.includes(s.status)
    const newInPeriod = filtered.filter((s) => inPeriod(s.createdAt)).length
    const completedInPeriod = filtered.filter((s) => isSettled(s) && inPeriod(s.updatedAt)).length
    const createdBeforeFrom = filtered.filter((s) => fromDate && s.createdAt.getTime() < fromTime).length
    const settledBeforeFrom = filtered.filter((s) => isSettled(s) && s.updatedAt.getTime() < fromTime).length
    const openingPending = createdBeforeFrom - settledBeforeFrom
    // Còn lại cuối kỳ = đã tồn tại TRƯỚC mốc cuối kỳ và chưa hoàn tất lúc đó
    const remaining = filtered.filter(
      (s) => s.createdAt.getTime() < toTime && !(isSettled(s) && s.updatedAt.getTime() < toTime)
    ).length

    // Gắn nguồn gốc + số lần thay đổi cho từng dòng (badge Nguồn gốc / Đã đổi N lần)
    const shipmentsWithLineage = shipments.map((s) => ({
      ...s,
      originSource: s.dispatchedBy === 'AGENT' ? 'AGENT_AUTOPILOT' : 'MANUAL_ADMIN',
      changeCount: changedMap.get(s.id) ?? 0,
    }))

    return NextResponse.json({
      shipments: shipmentsWithLineage,
      stats: {
        active,
        deliveredToday,
        dispatchedToday,
        codPendingCount: codPendingAgg._count,
        codPendingAmount: codPendingAgg._sum.codAmount ?? 0,
        codReceivedToday: codReceivedAgg._sum.codReceived ?? 0,
      },
      period: {
        openingPending,
        newInPeriod,
        completedInPeriod,
        remaining,
        fromDate: fromDate?.toISOString() ?? null,
        toDate: toDate?.toISOString() ?? null,
      },
    })
  } catch (error) {
    console.error('Shipments GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách vận chuyển' }, { status: 500 })
  }
}

// POST: người vận hành tự báo đơn vị vận chuyển (khi tắt auto_carrier)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { orderId?: string; carrier?: string }
    if (!body.orderId) return NextResponse.json({ error: 'Thiếu mã đơn hàng' }, { status: 400 })

    const order = await db.order.findUnique({
      where: { id: body.orderId },
      include: { channel: true, customer: true, items: { include: { product: true } } },
    })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })
    if (['CANCELLED', 'COMPLETED'].includes(order.status)) {
      return NextResponse.json({ error: 'Không thể báo vận chuyển cho đơn đã hủy/hoàn thành' }, { status: 400 })
    }
    const existing = await db.shipment.findUnique({ where: { orderId: order.id } })
    if (existing) return NextResponse.json({ error: 'Đơn hàng đã được báo đơn vị vận chuyển' }, { status: 409 })

    const carrier = CARRIERS.find((c) => c.key === body.carrier) ?? CARRIERS[Math.floor(Math.random() * CARRIERS.length)]
    const tracking = makeTrackingCode(carrier.key)
    const shipment = await db.shipment.create({
      data: {
        orderId: order.id,
        carrier: carrier.key,
        trackingCode: tracking,
        status: 'DISPATCHED',
        fee: order.shippingFee,
        codAmount: order.paymentMethod === 'COD' ? order.total : 0,
        codStatus: 'PENDING',
        dispatchedBy: 'OPERATOR',
      },
      include: { order: true },
    })

    await logEvent(order.id, 'CARRIER_DISPATCHED', 'OPERATOR', `Người vận hành báo ${carrier.name} lấy hàng — mã vận đơn ${tracking}`)
    // DATA LINEAGE — snapshot gốc vận đơn
    recordLineageChangeAsync({
      scope: 'ORDER',
      action: 'SHIPMENT_ORIGINAL',
      entityType: 'Shipment',
      entityId: shipment.id,
      entityCode: tracking,
      sourceRefCode: tracking,
      title: `Vận đơn ${tracking} tạo — báo ${carrier.name} lấy hàng đơn ${order.code}`,
      after: { status: 'DISPATCHED', codStatus: 'PENDING', carrier: carrier.key, trackingCode: tracking, fee: shipment.fee, codAmount: shipment.codAmount },
      actor: 'OPERATOR',
      actorName: 'Người vận hành',
      originSource: 'MANUAL_ADMIN',
      detail: { orderId: order.id, orderCode: order.code },
    })
    if (order.customer) {
      const { getMemorySnapshot } = await import('@/lib/memory-engine')
      const mem = await getMemorySnapshot(order.customer.id).catch(() => null)
      const ctx = buildVoiceContext({
        name: order.customer.name,
        salutation: mem?.salutation,
        orderCount: mem?.isReturning ? 2 : 1,
        items: order.items.map((i) => ({ quantity: i.quantity, product: i.product })),
        preferences: mem?.preferences,
        painPoints: mem?.painPoints,
      })
      await sendZalo({
        customerId: order.customer.id,
        channelKey: zaloKeyOf(order.channel.key),
        content: tCarrier(ctx, carrier.name, tracking),
        agentName: AGENTS.LOGISTICS_AGENT.name,
        relatedOrderId: order.id,
      })
    }
    await logActivity({
      agent: 'SYSTEM',
      action: 'MANUAL_ACTION',
      level: 'info',
      targetType: 'ORDER',
      targetId: order.id,
      targetLabel: order.code,
      message: `Người vận hành tự báo ${carrier.name} lấy hàng đơn ${order.code} — mã vận đơn ${tracking}`,
    })
    broadcast('shipment.updated', { id: shipment.id, orderId: order.id, status: 'DISPATCHED', code: order.code })

    return NextResponse.json({ shipment }, { status: 201 })
  } catch (error) {
    console.error('Shipments POST error:', error)
    return NextResponse.json({ error: 'Không thể báo đơn vị vận chuyển' }, { status: 500 })
  }
}
