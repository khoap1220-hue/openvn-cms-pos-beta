// Verify script cho Task 29 — đối chiếu số học API /api/reports/pnl với tính tay từ DB
import { db } from '../src/lib/db'

const CARRIER_FEE_ESTIMATES: Record<string, number> = { GHN: 22000, GHTK: 22000, JT: 20000, VIETTEL: 15000, NINJA: 18000 }

async function main() {
  const res = await fetch('http://localhost:3000/api/reports/pnl?days=30')
  if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
  const pnl = (await res.json()) as import('../src/lib/types').PnlData

  // ---------- (a) summary ≈ Σ byChannel ----------
  const sumCh = pnl.byChannel.reduce(
    (a, c) => ({
      orders: a.orders + c.orders,
      grossRevenue: a.grossRevenue + c.grossRevenue,
      cogs: a.cogs + c.cogs,
      platformFee: a.platformFee + c.platformFee,
      shippingSubsidy: a.shippingSubsidy + c.shippingSubsidy,
      pointsCost: a.pointsCost + c.pointsCost,
    }),
    { orders: 0, grossRevenue: 0, cogs: 0, platformFee: 0, shippingSubsidy: 0, pointsCost: 0 }
  )
  const cmp = (name: string, x: number, y: number) => {
    const ok = Math.abs(x - y) <= 2
    console.log(`${ok ? '✅' : '❌'} (a) summary.${name} = ${x} vs ΣbyChannel = ${y} (diff ${Math.abs(x - y)})`)
    if (!ok) process.exitCode = 1
  }
  cmp('orders', pnl.summary.orders, sumCh.orders)
  cmp('grossRevenue', pnl.summary.grossRevenue, sumCh.grossRevenue)
  cmp('cogs', pnl.summary.cogs, sumCh.cogs)
  cmp('platformFee', pnl.summary.platformFee, sumCh.platformFee)
  cmp('shippingSubsidy', pnl.summary.shippingSubsidy, sumCh.shippingSubsidy)
  cmp('pointsCost', pnl.summary.pointsCost, sumCh.pointsCost)

  // ---------- (c) identity Net = Gross − COGS − Fee − Ship − Points ----------
  const identity = (label: string, r: { grossRevenue: number; cogs: number; platformFee: number; shippingSubsidy: number; pointsCost: number; netProfit: number }) => {
    const calc = r.grossRevenue - r.cogs - r.platformFee - r.shippingSubsidy - r.pointsCost
    const ok = Math.abs(calc - r.netProfit) <= 2
    console.log(`${ok ? '✅' : '❌'} (c) identity ${label}: net=${r.netProfit} vs 5-tier=${calc} (diff ${Math.abs(calc - r.netProfit)})`)
    if (!ok) process.exitCode = 1
  }
  identity('summary', pnl.summary)
  identity(`channel[${pnl.byChannel[0].key}]`, pnl.byChannel[0])
  const worst = [...pnl.products].sort((a, b) => Math.abs(a.netProfit) - Math.abs(b.netProfit))[0]
  identity(`product[${worst.sku}]`, worst)
  for (const p of pnl.products) identity(`product[${p.sku}]`, p)
  for (const c of pnl.byChannel) identity(`channel[${c.key}]`, c)

  // ---------- (b) tính tay 1 đơn cụ thể từ DB ----------
  // Chọn đơn 1 sản phẩm, có shipment, trong kỳ 30 ngày, fees đủ интересн: ưu tiên đơn có platformFee>0 + shipment fee>0
  const days = pnl.days
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const from = new Date(todayStart.getTime() - (days - 1) * 86400000)

  const orders = await db.order.findMany({
    where: { createdAt: { gte: from }, status: { not: 'CANCELLED' } },
    include: {
      items: true,
      channel: { select: { key: true, feePercent: true } },
      shipments: { select: { carrier: true, fee: true } },
    },
  })
  // Đối chiếu trực tiếp nhất: đơn 1 sản phẩm mà sản phẩm đó CHỈ xuất hiện trong đúng 1 đơn trong kỳ
  // → dòng products[sku] phải bằng đúng 5 tầng tính tay của riêng đơn đó. Ưu tiên COMBO + freeship.
  const productOrderCount = new Map<string, number>()
  for (const o of orders) for (const it of o.items) productOrderCount.set(it.productId, (productOrderCount.get(it.productId) ?? 0) + 1)
  const uniqueOrderFor = (pid: string) => (productOrderCount.get(pid) ?? 0) === 1
  const comboProductId = (await db.product.findFirst({ where: { type: 'COMBO' }, select: { id: true } }))?.id
  const target =
    orders.find((o) => o.items.length === 1 && o.items[0].productId === comboProductId && uniqueOrderFor(comboProductId)) ??
    orders.find((o) => o.items.length === 1 && o.shippingFee === 0 && o.shipments[0] && uniqueOrderFor(o.items[0].productId)) ??
    orders.find((o) => o.items.length === 1 && o.platformFee === 0 && o.channel.feePercent > 0 && uniqueOrderFor(o.items[0].productId)) ??
    orders.find((o) => o.items.length === 1 && uniqueOrderFor(o.items[0].productId)) ??
    orders.find((o) => o.items.length === 1 && o.shipments[0])!
  console.log(`\n(b) Đơn đối chiếu: ${target.code} — ${target.channel.key} (fee%=${target.channel.feePercent}) — status ${target.status}`)
  const item = target.items[0]
  const prod = await db.product.findUnique({ where: { id: item.productId }, select: { id: true, sku: true, name: true, type: true, costPrice: true } })
  let unitCost = prod!.costPrice
  if (prod!.type === 'COMBO') {
    const rows = await db.bomComponent.findMany({ where: { productId: prod!.id }, include: { componentProduct: { select: { costPrice: true } } } })
    unitCost = Math.round(rows.reduce((s, r) => s + r.quantity * r.componentProduct.costPrice, 0))
  }
  const platformFee = target.platformFee > 0 ? target.platformFee : (target.subtotal * target.channel.feePercent) / 100
  const shipment = target.shipments[0]
  const carrierFee = shipment ? (shipment.fee > 0 ? shipment.fee : (CARRIER_FEE_ESTIMATES[shipment.carrier] ?? 20000)) : 0
  const shipSubsidy = shipment ? Math.max(0, carrierFee - target.shippingFee) : 0
  const pointsIssued = target.status === 'COMPLETED' ? Math.floor(target.total / 10000) : 0
  const pointsCost = pointsIssued * 1000
  const cogs = unitCost * item.quantity
  // Dòng products theo spec: grossRevenue = Σ itemRevenue (price×qty) — KHÔNG gồm phí ship;
  // phí sàn/vận chuyển/điểm phân bổ theo tỷ lệ itemRevenue/subtotal
  const share = target.subtotal > 0 ? (item.price * item.quantity) / target.subtotal : 1
  const expGross = Math.round(item.price * item.quantity)
  const expCogs = Math.round(cogs)
  const expFee = Math.round(platformFee * share)
  const expShip = Math.round(shipSubsidy * share)
  const expPts = Math.round(pointsCost * share)
  const expNet = expGross - expCogs - expFee - expShip - expPts
  const apiRow = pnl.products.find((p) => p.sku === prod!.sku)
  const shipInfo = shipment ? `shipment ${shipment.carrier} fee=${shipment.fee}${shipment.fee === 0 ? ' (→ ước tính ' + carrierFee + ')' : ''}` : 'không shipment (POS/online chưa phát)'
  console.log(`    SP: ${prod!.sku} (${prod!.type}${prod!.type === 'COMBO' ? `, giá vốn BOM=${unitCost}` : ''}) × ${item.quantity} @ ${item.price}`)
  console.log(`    Đơn: subtotal=${target.subtotal} shipFee(khách trả)=${target.shippingFee} total=${target.total} platformFee snapshot=${target.platformFee} · ${shipInfo}`)
  console.log(`    Tính tay (tầng SP — gross=itemRevenue=${item.price}×${item.quantity}): gross=${expGross} cogs=${expCogs} fee=${expFee} ship=${expShip} pts=${expPts} net=${expNet} (điểm đơn=${pointsIssued}×1000×share=${share.toFixed(2)})`)
  console.log(`    API     : gross=${apiRow?.grossRevenue} cogs=${apiRow?.cogs} fee=${apiRow?.platformFee} ship=${apiRow?.shippingSubsidy} pts=${apiRow?.pointsCost} net=${apiRow?.netProfit} margin=${apiRow?.marginPct}%`)
  // SP chỉ bán trong đúng 1 đơn → so trực tiếp từng tầng với dòng products[sku]
  const sameSkuOrders = orders.filter((o) => o.items.some((it) => it.productId === prod!.id))
  const direct = sameSkuOrders.length === 1
  const cmp2 = (name: string, x: number, y: number) => {
    const ok = Math.abs(x - y) <= 2
    console.log(`${ok ? '✅' : '❌'} (b) product[${prod!.sku}].${name}: ${direct ? 'tính tay đơn lẻ' : 'tính tay toàn kỳ'}=${x} vs API=${y} (diff ${Math.abs(x - y)})`)
    if (!ok) process.exitCode = 1
  }
  let mGross = 0, mCogs = 0, mFee = 0, mShip = 0, mPts = 0, mUnits = 0
  if (!direct) {
    for (const o of sameSkuOrders) {
      const oShipment = o.shipments[0]
      const oCarrierFee = oShipment ? (oShipment.fee > 0 ? oShipment.fee : (CARRIER_FEE_ESTIMATES[oShipment.carrier] ?? 20000)) : 0
      const oShipSubsidy = oShipment ? Math.max(0, oCarrierFee - o.shippingFee) : 0
      const oPoints = o.status === 'COMPLETED' ? Math.floor(o.total / 10000) * 1000 : 0
      const oFee = o.platformFee > 0 ? o.platformFee : (o.subtotal * o.channel.feePercent) / 100
      const oTotalQty = o.items.reduce((s, it) => s + it.quantity, 0)
      for (const it of o.items) {
        if (it.productId !== prod!.id) continue
        const itShare = o.subtotal > 0 ? (it.price * it.quantity) / o.subtotal : oTotalQty > 0 ? it.quantity / oTotalQty : 0
        mGross += it.price * it.quantity
        mCogs += unitCost * it.quantity
        mFee += oFee * itShare
        mShip += oShipSubsidy * itShare
        mPts += oPoints * itShare
        mUnits += it.quantity
      }
    }
  } else {
    mGross = expGross; mCogs = expCogs; mFee = expFee; mShip = expShip; mPts = expPts; mUnits = item.quantity
  }
  const mNet = Math.round(mGross) - Math.round(mCogs) - Math.round(mFee) - Math.round(mShip) - Math.round(mPts)
  cmp2('units', mUnits, apiRow?.units ?? -1)
  cmp2('grossRevenue', Math.round(mGross), apiRow?.grossRevenue ?? -1)
  cmp2('cogs', Math.round(mCogs), apiRow?.cogs ?? -1)
  cmp2('platformFee', Math.round(mFee), apiRow?.platformFee ?? -1)
  cmp2('shippingSubsidy', Math.round(mShip), apiRow?.shippingSubsidy ?? -1)
  cmp2('pointsCost', Math.round(mPts), apiRow?.pointsCost ?? -1)
  cmp2('netProfit', mNet, apiRow?.netProfit ?? -1)

  console.log(`\n→ SP đối chiếu xuất hiện trong ${sameSkuOrders.length} đơn trong kỳ (${direct ? 'so TRỰC TIẾP từng tầng' : 'đã tính tay gộp toàn kỳ'})`)

  // Freeship demo: 1 đơn ≥500k shippingFee=0 có shipment → subsidy = cước (ước tính khi fee=0)
  const fs = orders.find((o) => o.shippingFee === 0 && o.total >= 500000 && o.shipments[0])
  if (fs) {
    const fCarrier = fs.shipments[0].fee > 0 ? fs.shipments[0].fee : (CARRIER_FEE_ESTIMATES[fs.shipments[0].carrier] ?? 20000)
    console.log(`\nFreeship demo: ${fs.code} total=${fs.total} shipFee=0 · ${fs.shipments[0].carrier} fee=${fs.shipments[0].fee}${fs.shipments[0].fee === 0 ? ' → ước tính ' + fCarrier : ''} → shop hỗ trợ ${Math.max(0, fCarrier)}đ`)
  }

  await db.$disconnect()
}

main().catch((e) => {
  console.error('VERIFY FAILED:', e)
  process.exit(1)
})
