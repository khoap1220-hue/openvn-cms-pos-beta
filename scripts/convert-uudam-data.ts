/**
 * Chuyển đổi dữ liệu mẫu (đơn hàng, vận đơn, hóa đơn mua/bán, kênh bán) sang
 * 100% sản phẩm THẬT của shop Ưu Đàm (uudam.vn) — để Dashboard + AI phân tích
 * đúng ngữ cảnh ngành hàng (nến, trà, ấm gốm).
 *
 * Chạy: bun scripts/convert-uudam-data.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

function ean13(base12: string): string {
  const digits = base12.split('').map(Number)
  let sum = 0
  digits.forEach((d, i) => (sum += i % 2 === 0 ? d : d * 3))
  return base12 + String((10 - (sum % 10)) % 10)
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const randInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))

async function main() {
  console.log('== Chuyển đổi dữ liệu mẫu sang sản phẩm Ưu Đàm ==')

  // 1) Cấu hình % phí sàn cho từng kênh (tham chiếu thị trường TMĐT VN)
  const FEES: Record<string, number> = { SHOPEE: 8.5, LAZADA: 8, TIKTOK: 6, TIKI: 7 }
  for (const [key, fee] of Object.entries(FEES)) {
    await db.channel.updateMany({ where: { key }, data: { feePercent: fee } })
  }
  console.log('1) Phí sàn:', JSON.stringify(FEES))

  // 2) Hàng dễ vỡ: nến / gốm / thủy tinh / sứ
  const fragileSkus = ['UD-NEN-001', 'UD-NEN-002', 'UD-DEN-001', 'UD-TRA-001', 'UD-TRA-002', 'UD-TRA-003', 'UD-QT-001', 'UD-QT-002']
  await db.product.updateMany({ where: { sku: { in: fragileSkus } }, data: { fragile: true } })
  console.log('2) fragile=true cho', fragileSkus.length, 'SP gốm/nến/thủy tinh')

  // 3) COMBO/Set quà tặng mẫu: thành phần = thành phẩm gộp lại
  const [nen, huTra] = await Promise.all([
    db.product.findUnique({ where: { sku: 'UD-NEN-001' } }),
    db.product.findUnique({ where: { sku: 'UD-TRA-003' } }),
  ])
  if (!nen || !huTra) throw new Error('Thiếu UD-NEN-001 / UD-TRA-003 — hãy chạy seed-uudam.ts trước')
  const comboCost = Math.round(nen.costPrice * 1 + huTra.costPrice * 1)
  const combo = await db.product.upsert({
    where: { sku: 'UD-COMBO-001' },
    update: {
      name: 'Set quà tặng Ưu Đàm — Nến bơ Udumbara + Hũ trà gốm Zen',
      type: 'COMBO',
      fragile: true,
      costPrice: comboCost,
      sellPrice: 219000,
      description: 'Set quà tặng gộp 2 thành phẩm: 1 nến bơ Udumbara hũ thủy tinh + 1 hũ trà gốm nắp gỗ Zen — gói hộp quà sẵn, biếu tặng sang trọng.',
      attributes: 'Gộp 2 thành phẩm / gói hộp quà / hàng dễ vỡ',
      unit: 'bộ',
    },
    create: {
      sku: 'UD-COMBO-001',
      name: 'Set quà tặng Ưu Đàm — Nến bơ Udumbara + Hũ trà gốm Zen',
      type: 'COMBO',
      fragile: true,
      barcode: ean13('893604400012'),
      categoryId: null, // gán Quà tặng & Tranh dưới
      costPrice: comboCost,
      sellPrice: 219000,
      stock: 0,
      lowStockThreshold: 5,
      description: 'Set quà tặng gộp 2 thành phẩm: 1 nến bơ Udumbara hũ thủy tinh + 1 hũ trà gốm nắp gỗ Zen — gói hộp quà sẵn, biếu tặng sang trọng.',
      attributes: 'Gộp 2 thành phẩm / gói hộp quà / hàng dễ vỡ',
      unit: 'bộ',
      status: 'ACTIVE',
    },
  })
  const quaCat = await db.category.findUnique({ where: { slug: 'qua-tang-tranh' } })
  if (quaCat) await db.product.update({ where: { id: combo.id }, data: { categoryId: quaCat.id } })
  await db.bomComponent.upsert({
    where: { productId_componentProductId: { productId: combo.id, componentProductId: nen.id } },
    update: { quantity: 1 },
    create: { productId: combo.id, componentProductId: nen.id, quantity: 1 },
  })
  await db.bomComponent.upsert({
    where: { productId_componentProductId: { productId: combo.id, componentProductId: huTra.id } },
    update: { quantity: 1 },
    create: { productId: combo.id, componentProductId: huTra.id, quantity: 1 },
  })
  console.log('3) COMBO:', combo.sku, '— giá vốn gộp', comboCost, '= 1 x', nen.sku, '+ 1 x', huTra.sku)

  // 4) Kênh bán: bỏ SP demo cũ, đưa SP Ưu Đàm (trừ combo) lên toàn bộ kênh
  const channels = await db.channel.findMany()
  const udProducts = await db.product.findMany({ where: { sku: { startsWith: 'UD-' } } })
  const udIds = new Set(udProducts.map((p) => p.id))
  const oldListings = await db.channelListing.findMany({ where: { productId: { notIn: [...udIds] } }, select: { id: true } })
  if (oldListings.length) await db.channelListing.deleteMany({ where: { id: { in: oldListings.map((l) => l.id) } } })
  const sellable = udProducts.filter((p) => p.type !== 'COMBO')
  let addedListings = 0
  for (const ch of channels) {
    const have = await db.channelListing.findMany({ where: { channelId: ch.id, productId: { in: sellable.map((p) => p.id) } }, select: { productId: true } })
    const haveSet = new Set(have.map((h) => h.productId))
    const missing = sellable.filter((p) => !haveSet.has(p.id))
    if (missing.length) {
      await db.channelListing.createMany({ data: missing.map((p) => ({ productId: p.id, channelId: ch.id, status: 'ACTIVE' })) })
      addedListings += missing.length
    }
  }
  console.log('4) Kênh bán: xóa', oldListings.length, 'listing SP cũ — thêm', addedListings, 'listing UD lên', channels.length, 'kênh')

  // 5) ĐƠN HÀNG: đổi toàn bộ item sang SP Ưu Đàm + tính lại tiền + snapshot phí sàn
  const orders = await db.order.findMany({ include: { channel: true, items: true } })
  let orderCount = 0
  for (const o of orders) {
    const n = Math.random() < 0.25 ? 2 : 1
    const lines = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      const p = pick(sellable)
      const qty = p.sellPrice <= 50000 ? randInt(1, 3) : randInt(1, 2)
      lines.set(p.id, (lines.get(p.id) ?? 0) + qty)
    }
    const items = [...lines.entries()].map(([productId, quantity]) => {
      const prod = sellable.find((x) => x.id === productId)!
      return { productId, quantity, price: prod.sellPrice }
    })
    const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0)
    const shippingFee = subtotal >= 500000 ? 0 : 30000
    const total = subtotal + shippingFee
    const platformFeePct = o.channel.feePercent
    const platformFee = Math.round((subtotal * platformFeePct) / 100)

    await db.$transaction(async (tx) => {
      await tx.orderItem.deleteMany({ where: { orderId: o.id } })
      await tx.orderItem.createMany({ data: items.map((it) => ({ ...it, orderId: o.id })) })
      await tx.order.update({
        where: { id: o.id },
        data: { subtotal, shippingFee, total, platformFeePct, platformFee },
      })
    })
    orderCount++
  }
  console.log('5) Đơn hàng: chuyển', orderCount, 'đơn sang SP Ưu Đàm (+ phí sàn snapshot)')

  // 6) HÓA ĐƠN BÁN (POSTED): dựng lại item từ đơn liên kết hoặc SP Ưu Đàm ngẫu nhiên
  const salesInvoices = await db.salesInvoice.findMany({ where: { status: 'POSTED' } })
  const ordersForInv = await db.order.findMany({
    where: { id: { in: salesInvoices.filter((i) => i.orderId).map((i) => i.orderId as string) } },
    include: { items: true },
  })
  const ordersById = new Map(ordersForInv.map((o) => [o.id, o]))
  let siCount = 0
  for (const inv of salesInvoices) {
    const linkedOrder = inv.orderId ? ordersById.get(inv.orderId) : null
    let lines: Array<{ productId: string; quantity: number; unitPrice: number }>
    if (linkedOrder && linkedOrder.items.length > 0) {
      lines = linkedOrder.items.map((it) => ({ productId: it.productId, quantity: it.quantity, unitPrice: it.price }))
    } else {
      const p1 = pick(sellable)
      lines = [{ productId: p1.id, quantity: randInt(1, 3), unitPrice: p1.sellPrice }]
    }
    const subtotal = lines.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
    const vatAmount = Math.round((subtotal * inv.vatRate) / 100)
    const total = subtotal + vatAmount
    await db.$transaction(async (tx) => {
      await tx.salesInvoiceItem.deleteMany({ where: { invoiceId: inv.id } })
      await tx.salesInvoiceItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: inv.id })) })
      await tx.salesInvoice.update({ where: { id: inv.id }, data: { subtotal, vatAmount, total } })
    })
    siCount++
  }
  console.log('6) Hóa đơn bán: chuyển', siCount, 'HĐ POSTED sang SP Ưu Đàm')

  // 7) HÓA ĐƠN MUA (POSTED): nguyên vật liệu làm nến của shop
  const mats = await db.product.findMany({ where: { sku: { in: ['UD-SAP-001', 'UD-SAP-002', 'UD-VL-001', 'UD-NEN-002'] } } })
  const purchaseInvoices = await db.purchaseInvoice.findMany({ where: { status: 'POSTED' } })
  let piCount = 0
  for (const inv of purchaseInvoices) {
    const shuffled = [...mats].sort(() => Math.random() - 0.5).slice(0, randInt(2, 3))
    const lines = shuffled.map((p) => {
      const qty = p.sku === 'UD-VL-001' ? randInt(5, 10) : p.unit === 'kg' ? randInt(10, 25) : randInt(30, 60)
      return { productId: p.id, quantity: qty, unitPrice: p.costPrice }
    })
    const subtotal = lines.reduce((s, it) => s + it.quantity * it.unitPrice, 0)
    const vatAmount = Math.round((subtotal * inv.vatRate) / 100)
    const total = subtotal + vatAmount
    await db.$transaction(async (tx) => {
      await tx.purchaseInvoiceItem.deleteMany({ where: { invoiceId: inv.id } })
      await tx.purchaseInvoiceItem.createMany({ data: lines.map((l) => ({ ...l, invoiceId: inv.id })) })
      await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { subtotal, vatAmount, total } })
    })
    piCount++
  }
  console.log('7) Hóa đơn mua: chuyển', piCount, 'HĐ POSTED sang nguyên liệu Ưu Đàm')

  // 8) VẬN ĐƠN: backfill trạng thái đối soát COD
  const shipments = await db.shipment.findMany({ include: { order: true } })
  let codPending = 0
  let codReceived = 0
  let codNone = 0
  for (const s of shipments) {
    const isCod = s.order.paymentMethod === 'COD'
    const data: Record<string, unknown> = {}
    if (isCod) {
      data.codAmount = s.order.total
      if (s.status === 'DELIVERED') {
        data.codStatus = 'RECEIVED'
        data.codReceived = s.order.total
        data.codReceivedAt = s.updatedAt
        codReceived++
      } else if (s.status === 'RETURNED') {
        data.codStatus = 'PENDING'
        data.codNote = 'Đơn hoàn trả — chờ xử lý hàng & tiền'
        codPending++
      } else {
        data.codStatus = 'PENDING'
        codPending++
      }
    } else {
      data.codAmount = 0
      data.codStatus = 'RECONCILED'
      data.codNote = 'Không thu hộ — khách thanh toán chuyển khoản'
      codNone++
    }
    await db.shipment.update({ where: { id: s.id }, data })
  }
  console.log('8) Vận đơn:', shipments.length, '— COD chờ đối soát:', codPending, '| đã nhận:', codReceived, '| không thu hộ:', codNone)

  // 9) Đồng bộ tồn kho hiển thị của combo (derived = min over components)
  const comps = await db.bomComponent.findMany({ where: { productId: combo.id } })
  let avail = Number.MAX_SAFE_INTEGER
  for (const c of comps) {
    const p = await db.product.findUnique({ where: { id: c.componentProductId } })
    const a = p ? Math.floor(p.stock / Math.max(c.quantity, 0.0001)) : 0
    avail = Math.min(avail, a)
  }
  if (avail === Number.MAX_SAFE_INTEGER) avail = 0
  await db.product.update({ where: { id: combo.id }, data: { stock: avail } })

  // 10) Sổ Data
  await db.ledgerEntry.create({
    data: {
      scope: 'ORDER',
      action: 'SAMPLE_DATA_MIGRATED',
      title: `Chuyển ${orderCount} đơn hàng, ${shipments.length} vận đơn, ${siCount} HĐ bán, ${piCount} HĐ mua sang danh mục shop Ưu Đàm (uudam.vn) + cấu hình phí sàn TMĐT`,
      entityType: 'MIGRATION',
      entityCode: 'UUDAM.VN',
      detail: JSON.stringify({
        orders: orderCount,
        shipments: shipments.length,
        salesInvoices: siCount,
        purchaseInvoices: piCount,
        channelFees: FEES,
        combo: combo.sku,
      }),
      actor: 'OPERATOR',
    },
  })

  console.log('== DONE ==')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
