// ACCOUNTING — aggregation cho dashboard Invoice Pro (FR-DB-01~08).
// Quy ước:
//  - quarter = null → gộp cả 4 quý của năm.
//  - Kỳ [start, end): start = new Date(year, (q-1)*3, 1), end = new Date(year, q*3, 1) (exclusive).
//  - Doanh thu/chi phí chỉ tính hóa đơn POSTED (không tính CANCELLED).
//  - Movement nhập = quantity > 0, xuất = quantity < 0.

import { db } from '@/lib/db'

export interface InvoiceDashboardInput {
  year: number
  quarter: number | null
}

export interface DashboardInventoryRow {
  id: string
  sku: string
  name: string
  attributes: string | null
  unit: string
  stock: number
  in: number
  out: number
  closing: number
  movement: number
}

export interface InvoiceDashboard {
  year: number
  quarter: number | null
  revenue: number
  revenueCount: number
  vatOutput: number
  expense: number
  expenseCount: number
  vatInput: number
  profit: number
  profitMargin: number
  stockNow: number
  stockIn: number
  stockOut: number
  stockChange: number
  cashFlow: Array<{ month: number; in: number; out: number; net: number }>
  invoiceCounts: { sales: number; purchase: number }
  inventory: DashboardInventoryRow[]
}

interface InvoiceRow {
  invoiceDate: Date
  subtotal: number
  vatAmount: number
  total: number
}

function inRange(date: Date, start: Date, end: Date): boolean {
  return date >= start && date < end
}

/** Nửa mở [start, end) của một quý — dùng chung cho filter theo kỳ */
export function quarterRange(year: number, quarter: number): { start: Date; end: Date } {
  return { start: new Date(year, (quarter - 1) * 3, 1), end: new Date(year, quarter * 3, 1) }
}

export async function getInvoiceDashboard({ year, quarter }: InvoiceDashboardInput): Promise<InvoiceDashboard> {
  const quarters = quarter && quarter >= 1 && quarter <= 4 ? [quarter] : [1, 2, 3, 4]
  const start = new Date(year, (Math.min(...quarters) - 1) * 3, 1)
  const end = new Date(year, Math.max(...quarters) * 3, 1)

  const [salesRows, purchaseRows, stockAgg, movementsInPeriod, movementsAfter, products] = await Promise.all([
    db.salesInvoice.findMany({
      where: { status: 'POSTED', invoiceDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
      select: { invoiceDate: true, subtotal: true, vatAmount: true, total: true },
    }),
    db.purchaseInvoice.findMany({
      where: { status: 'POSTED', invoiceDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) } },
      select: { invoiceDate: true, subtotal: true, vatAmount: true, total: true },
    }),
    db.product.aggregate({ _sum: { stock: true } }),
    db.stockMovement.findMany({
      where: { createdAt: { gte: start, lt: end } },
      select: { productId: true, quantity: true },
    }),
    db.stockMovement.findMany({
      where: { createdAt: { gte: end } },
      select: { productId: true, quantity: true },
    }),
    db.product.findMany({
      select: { id: true, sku: true, name: true, attributes: true, unit: true, stock: true },
    }),
  ])

  // FR-DB-01~04: doanh thu / chi phí / VAT trong kỳ đã chọn
  const periodSales = salesRows.filter((r) => inRange(r.invoiceDate, start, end))
  const periodPurchases = purchaseRows.filter((r) => inRange(r.invoiceDate, start, end))
  const revenue = periodSales.reduce((s, r) => s + r.subtotal, 0)
  const vatOutput = periodSales.reduce((s, r) => s + r.vatAmount, 0)
  const expense = periodPurchases.reduce((s, r) => s + r.subtotal, 0)
  const vatInput = periodPurchases.reduce((s, r) => s + r.vatAmount, 0)
  const profit = revenue - expense
  const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0

  // FR-DB-05~06: tồn kho hiện tại + biến động kho trong kỳ
  const stockNow = stockAgg._sum.stock ?? 0
  let stockIn = 0
  let stockOut = 0
  for (const mv of movementsInPeriod) {
    if (mv.quantity > 0) stockIn += mv.quantity
    else stockOut += Math.abs(mv.quantity)
  }
  const stockChange = stockIn - stockOut

  // FR-DB-07: dòng tiền 12 tháng của năm (luôn đủ T1..T12)
  const cashFlow: Array<{ month: number; in: number; out: number; net: number }> = []
  for (let month = 1; month <= 12; month++) {
    const mStart = new Date(year, month - 1, 1)
    const mEnd = new Date(year, month, 1)
    const cashIn = salesRows.filter((r) => inRange(r.invoiceDate, mStart, mEnd)).reduce((s, r) => s + r.total, 0)
    const cashOut = purchaseRows.filter((r) => inRange(r.invoiceDate, mStart, mEnd)).reduce((s, r) => s + r.total, 0)
    cashFlow.push({ month, in: cashIn, out: cashOut, net: cashIn - cashOut })
  }

  // FR-DB-08: inventory theo sản phẩm — nhập/xuất trong kỳ + tồn cuối kỳ
  //   closing = stock - inAfter + outAfter (loại bỏ biến động phát sinh SAU kỳ)
  const inPeriodByProduct = new Map<string, { in: number; out: number }>()
  for (const mv of movementsInPeriod) {
    const row = inPeriodByProduct.get(mv.productId) ?? { in: 0, out: 0 }
    if (mv.quantity > 0) row.in += mv.quantity
    else row.out += Math.abs(mv.quantity)
    inPeriodByProduct.set(mv.productId, row)
  }
  const afterByProduct = new Map<string, { in: number; out: number }>()
  for (const mv of movementsAfter) {
    const row = afterByProduct.get(mv.productId) ?? { in: 0, out: 0 }
    if (mv.quantity > 0) row.in += mv.quantity
    else row.out += Math.abs(mv.quantity)
    afterByProduct.set(mv.productId, row)
  }

  const inventory: DashboardInventoryRow[] = products.map((p) => {
    const period = inPeriodByProduct.get(p.id) ?? { in: 0, out: 0 }
    const after = afterByProduct.get(p.id) ?? { in: 0, out: 0 }
    const closing = p.stock - after.in + after.out
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      attributes: p.attributes,
      unit: p.unit,
      stock: p.stock,
      in: period.in,
      out: period.out,
      closing,
      movement: period.in + period.out,
    }
  })
  inventory.sort((a, b) => b.out - a.out || b.in - a.in || a.name.localeCompare(b.name))

  return {
    year,
    quarter: quarter && quarter >= 1 && quarter <= 4 ? quarter : null,
    revenue,
    revenueCount: periodSales.length,
    vatOutput,
    expense,
    expenseCount: periodPurchases.length,
    vatInput,
    profit,
    profitMargin,
    stockNow,
    stockIn,
    stockOut,
    stockChange,
    cashFlow,
    invoiceCounts: { sales: periodSales.length, purchase: periodPurchases.length },
    inventory,
  }
}
