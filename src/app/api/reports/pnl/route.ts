import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { comboCostFromRows } from '@/lib/combo'
import type { PnlChannelRow, PnlData, PnlProductRow, PnlRow } from '@/lib/types'

// BÁO CÁO LỢI NHUẬN RÒNG (P&L & UNIT ECONOMICS) — 5 TẦNG:
// (1) Doanh thu gộp → (2) COGS giá vốn → (3a) Phí sàn TMĐT + (3b) Vận chuyển shop hỗ trợ
// → (4) Điểm thưởng/hoa hồng Affiliate (ước tính) → (5) Lợi nhuận ròng + % Margin.

export const dynamic = 'force-dynamic'

// Giả định ước tính — trả về trong PnlData.assumptions để UI hiển thị minh bạch
const CARRIER_FEE_ESTIMATES: Record<string, number> = {
  GHN: 22_000,
  GHTK: 22_000,
  JT: 20_000,
  VIETTEL: 15_000,
  NINJA: 18_000,
}
const DEFAULT_CARRIER_FEE = 20_000 // hãng lạ / không khớp bảng ước tính
const POINT_VALUE_VND = 1_000 // chi phí quy đổi ước tính 1 điểm thưởng
const POINTS_ISSUE_RATE = 10_000 // 1 điểm / 10.000đ giá trị đơn hoàn tất

/**
 * Làm tròn an toàn 5 tầng → PnlRow.
 * netProfit tính từ các tầng ĐÃ LÀM TRÒN để đẳng thức
 * Net = Gross − COGS − Phí sàn − Vận chuyển − Điểm giữ nguyên tuyệt đối (chấp nhận chênh lệch ≤ 0,5đ/ tầng do làm tròn).
 */
function buildRow(
  grossRevenue: number,
  cogs: number,
  platformFee: number,
  shippingSubsidy: number,
  pointsCost: number
): PnlRow {
  const g = Math.round(grossRevenue)
  const c = Math.round(cogs)
  const p = Math.round(platformFee)
  const s = Math.round(shippingSubsidy)
  const pt = Math.round(pointsCost)
  const netProfit = g - c - p - s - pt // có thể âm — giữ nguyên dấu
  return {
    grossRevenue: g,
    cogs: c,
    platformFee: p,
    shippingSubsidy: s,
    pointsCost: pt,
    netProfit,
    marginPct: g > 0 ? Math.round((netProfit / g) * 1000) / 10 : 0,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const days = Math.min(90, Math.max(7, Number(searchParams.get('days')) || 30))
    const now = new Date()
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const from = new Date(todayStart.getTime() - (days - 1) * 86400000)
    const to = now
    const fmt = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    const label = `${days} ngày gần nhất (${fmt(from)} → ${fmt(to)})`

    // 1 truy vấn chính: đơn trong kỳ (đã loại hủy) + items + kênh + vận đơn — không N+1
    const orders = await db.order.findMany({
      where: { createdAt: { gte: from }, status: { not: 'CANCELLED' } },
      include: {
        items: { select: { productId: true, quantity: true, price: true } },
        channel: { select: { key: true, name: true, color: true, feePercent: true } },
        shipments: { select: { carrier: true, fee: true } },
      },
    })

    // Lookup sản phẩm trong bộ nhớ (Map — tránh query từng item)
    const productIds = new Set<string>()
    for (const o of orders) for (const it of o.items) productIds.add(it.productId)
    const products = productIds.size
      ? await db.product.findMany({
          where: { id: { in: [...productIds] } },
          select: { id: true, sku: true, name: true, type: true, costPrice: true },
        })
      : []
    const productMap = new Map(products.map((p) => [p.id, p]))

    // Giá vốn combo = Σ định mức BOM × costPrice thành phần (1 truy vấn cho mọi combo trong kỳ)
    const comboIds = products.filter((p) => p.type === 'COMBO').map((p) => p.id)
    const bomRows = comboIds.length
      ? await db.bomComponent.findMany({
          where: { productId: { in: comboIds } },
          include: { componentProduct: { select: { costPrice: true } } },
        })
      : []
    const comboRowsMap = new Map<string, Array<{ quantity: number; componentProduct: { costPrice: number } }>>()
    for (const r of bomRows) {
      const list = comboRowsMap.get(r.productId) ?? []
      list.push({ quantity: r.quantity, componentProduct: { costPrice: r.componentProduct.costPrice } })
      comboRowsMap.set(r.productId, list)
    }
    const comboUnitCost = new Map<string, number>()
    for (const [comboId, rows] of comboRowsMap) comboUnitCost.set(comboId, comboCostFromRows(rows))
    const unitCostOf = (productId: string): number => {
      const p = productMap.get(productId)
      if (!p) return 0
      return p.type === 'COMBO' ? (comboUnitCost.get(p.id) ?? 0) : p.costPrice
    }

    // Bộ cộng dồn: tổng kỳ / theo kênh / theo sản phẩm
    const total = { orders: 0, grossRevenue: 0, cogs: 0, platformFee: 0, shippingSubsidy: 0, pointsCost: 0 }
    const channelAgg = new Map<
      string,
      { key: string; name: string; color: string; orders: number; grossRevenue: number; cogs: number; platformFee: number; shippingSubsidy: number; pointsCost: number }
    >()
    const productAgg = new Map<
      string,
      { id: string; sku: string; name: string; type: string; units: number; grossRevenue: number; cogs: number; platformFee: number; shippingSubsidy: number; pointsCost: number }
    >()

    for (const o of orders) {
      // Tầng 1 — Doanh thu gộp (đã gồm phí ship thu khách, chưa trừ gì)
      const grossRevenue = o.total

      // Tầng 2 — COGS: SIMPLE = costPrice × SL · COMBO = giá vốn định mức BOM × SL
      let cogs = 0
      for (const it of o.items) cogs += unitCostOf(it.productId) * it.quantity

      // Tầng 3a — Phí sàn TMĐT: ưu tiên snapshot ghi trên đơn lúc tạo;
      // đơn THIẾU snapshot (platformFee = 0) → ước tính theo % phí kênh HIỆN TẠI trên subtotal
      const platformFee = o.platformFee > 0 ? o.platformFee : (o.subtotal * (o.channel?.feePercent ?? 0)) / 100

      // Tầng 3b — Vận chuyển shop hỗ trợ = cước DVVC (thực tế, thiếu thì ước tính theo hãng) − phí ship thu khách.
      // Shipment.orderId unique → tối đa 1 vận đơn/đơn; kênh POS không có vận đơn → 0.
      const shipment = o.shipments[0]
      let shippingSubsidy = 0
      if (shipment) {
        const carrierFee = shipment.fee > 0 ? shipment.fee : (CARRIER_FEE_ESTIMATES[shipment.carrier] ?? DEFAULT_CARRIER_FEE)
        shippingSubsidy = Math.max(0, carrierFee - o.shippingFee) // đơn freeship ≥500k (shippingFee=0) sẽ lộ rõ phần shop đền
      }

      // Tầng 4 — Điểm thưởng/hoa hồng Affiliate (ước tính): chỉ phát sinh trên đơn COMPLETED
      const pointsIssued = o.status === 'COMPLETED' ? Math.floor(o.total / POINTS_ISSUE_RATE) : 0
      const pointsCost = pointsIssued * POINT_VALUE_VND

      // Cộng dồn tổng kỳ & theo kênh (mọi tầng)
      total.orders += 1
      total.grossRevenue += grossRevenue
      total.cogs += cogs
      total.platformFee += platformFee
      total.shippingSubsidy += shippingSubsidy
      total.pointsCost += pointsCost
      const ch =
        channelAgg.get(o.channelId) ??
        {
          key: o.channel?.key ?? o.channelId,
          name: o.channel?.name ?? 'Kênh không rõ',
          color: o.channel?.color ?? '#a3a3a3',
          orders: 0,
          grossRevenue: 0,
          cogs: 0,
          platformFee: 0,
          shippingSubsidy: 0,
          pointsCost: 0,
        }
      ch.orders += 1
      ch.grossRevenue += grossRevenue
      ch.cogs += cogs
      ch.platformFee += platformFee
      ch.shippingSubsidy += shippingSubsidy
      ch.pointsCost += pointsCost
      channelAgg.set(o.channelId, ch)

      // Phân bổ per-product cho phí sàn / vận chuyển / điểm: theo tỷ lệ doanh thu item trên subtotal đơn.
      // Guard subtotal ≤ 0 → chia đều theo số lượng; đơn không có item nào → không phân bổ (vẫn tính ở tổng & kênh).
      const totalQty = o.items.reduce((s, it) => s + it.quantity, 0)
      for (const it of o.items) {
        const itemRevenue = it.price * it.quantity
        const share = o.subtotal > 0 ? itemRevenue / o.subtotal : totalQty > 0 ? it.quantity / totalQty : 0
        const p = productMap.get(it.productId)
        const pa =
          productAgg.get(it.productId) ??
          {
            id: it.productId,
            sku: p?.sku ?? it.productId,
            name: p?.name ?? 'Sản phẩm không rõ',
            type: p?.type ?? 'SIMPLE',
            units: 0,
            grossRevenue: 0,
            cogs: 0,
            platformFee: 0,
            shippingSubsidy: 0,
            pointsCost: 0,
          }
        pa.units += it.quantity
        pa.grossRevenue += itemRevenue
        pa.cogs += unitCostOf(it.productId) * it.quantity
        pa.platformFee += platformFee * share
        pa.shippingSubsidy += shippingSubsidy * share
        pa.pointsCost += pointsCost * share
        productAgg.set(it.productId, pa)
      }
    }

    const summary = {
      orders: total.orders,
      ...buildRow(total.grossRevenue, total.cogs, total.platformFee, total.shippingSubsidy, total.pointsCost),
    }

    const byChannel: PnlChannelRow[] = [...channelAgg.values()]
      .map((c) => ({
        key: c.key,
        name: c.name,
        color: c.color,
        orders: c.orders,
        ...buildRow(c.grossRevenue, c.cogs, c.platformFee, c.shippingSubsidy, c.pointsCost),
      }))
      .sort((a, b) => b.grossRevenue - a.grossRevenue)

    const productRows: PnlProductRow[] = [...productAgg.values()]
      .map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        type: p.type,
        units: p.units,
        ...buildRow(p.grossRevenue, p.cogs, p.platformFee, p.shippingSubsidy, p.pointsCost),
      }))
      .sort((a, b) => b.netProfit - a.netProfit)

    const data: PnlData = {
      days,
      period: { from: from.toISOString(), to: to.toISOString(), label },
      summary,
      byChannel,
      products: productRows,
      assumptions: { pointValueVnd: POINT_VALUE_VND, carrierFeeEstimates: CARRIER_FEE_ESTIMATES },
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('PnL GET error:', error)
    return NextResponse.json({ error: 'Không thể tải báo cáo lợi nhuận ròng' }, { status: 500 })
  }
}
