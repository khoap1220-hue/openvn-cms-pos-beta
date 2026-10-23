// INVOICE SERVICE — nghiệp vụ hóa đơn mua/bán của module Invoice Pro.
// Nguyên tắc:
//  - Mọi thao tác ghi Sổ Data (logLedger) + broadcast realtime + dispatch webhook.
//  - Kỳ kế toán CLOSED → chặn mọi ghi dữ liệu (PeriodClosedError → HTTP 409).
//  - Số lượng là Float (được phép lẻ) nhưng Product.stock là Int → luôn Math.round khi cộng/trừ kho.
//  - Xuất kho ghi movement quantity ÂM, nhập kho ghi quantity DƯƠNG.

import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logLedger } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'

type Tx = Prisma.TransactionClient

// ===== Lỗi nghiệp vụ để HTTP layer map status =====

/** Kỳ kế toán đã chốt sổ — HTTP layer map thành 409 */
export class PeriodClosedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PeriodClosedError'
  }
}

// ===== Kỳ kế toán =====

export function quarterOf(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1
}

/** Kỳ (year, quarter) chứa date phải OPEN, ngược lại throw PeriodClosedError */
export async function assertPeriodOpen(date: Date): Promise<void> {
  const year = date.getFullYear()
  const quarter = quarterOf(date)
  const period = await db.accountingPeriod.findUnique({
    where: { year_quarter: { year, quarter } },
  })
  if (period && period.status === 'CLOSED') {
    throw new PeriodClosedError(`Kỳ Q${quarter}/${year} đã chốt sổ — không thể thay đổi dữ liệu`)
  }
}

// ===== Helpers =====

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Sinh mã hóa đơn PMM{YYMMDD}-{seq4} (mua) / PXK{YYMMDD}-{seq4} (bán) — seq theo ngày, tăng dần */
async function genInvoiceCode(prefix: 'PMM' | 'PXK', date: Date): Promise<string> {
  const base = `${prefix}${String(date.getFullYear()).slice(2)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-`
  const rows =
    prefix === 'PMM'
      ? await db.purchaseInvoice.findMany({ where: { code: { startsWith: base } }, select: { code: true } })
      : await db.salesInvoice.findMany({ where: { code: { startsWith: base } }, select: { code: true } })
  let max = 0
  for (const row of rows) {
    const seq = Number(row.code.slice(base.length))
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${base}${String(max + 1).padStart(4, '0')}`
}

/** Cộng/trừ kho trong transaction + ghi StockMovement (delta dương = nhập, âm = xuất) */
async function applyStockChange(tx: Tx, productId: string, delta: number, type: string, note: string): Promise<void> {
  if (delta === 0) return
  const product = await tx.product.findUnique({ where: { id: productId } })
  if (!product) throw new Error('Sản phẩm không tồn tại')
  const after = product.stock + delta
  await tx.product.update({ where: { id: productId }, data: { stock: after } })
  await tx.stockMovement.create({ data: { productId, type, quantity: delta, stockAfter: after, note } })
}

/**
 * Trừ kho vật liệu có kẹp sàn 0 (BOM định mức): nếu kho không đủ vẫn trừ về 0.
 * Trả về lượng thực trừ (>= 0) để caller đưa vào cảnh báo Sổ Data.
 */
async function applyClampedIssue(tx: Tx, productId: string, deduct: number, type: string, note: string): Promise<number> {
  if (deduct <= 0) return 0
  const product = await tx.product.findUnique({ where: { id: productId } })
  if (!product) return 0
  const after = Math.max(0, product.stock - deduct)
  const actualDelta = after - product.stock // âm
  if (actualDelta === 0) return 0
  await tx.product.update({ where: { id: productId }, data: { stock: after } })
  await tx.stockMovement.create({ data: { productId, type, quantity: actualDelta, stockAfter: after, note } })
  return Math.abs(actualDelta)
}

export interface InvoiceItemInput {
  productId: string
  quantity: number
  unitPrice: number
}

interface NormalizedItem {
  productId: string
  quantity: number
  unitPrice: number
}

/** Validate & chuẩn hóa items hóa đơn: sản phẩm tồn tại, quantity > 0, unitPrice >= 0 */
async function normalizeItems(items: unknown): Promise<NormalizedItem[]> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Hóa đơn cần ít nhất 1 dòng sản phẩm')
  }
  const rows = items as Array<Record<string, unknown>>
  const productIds = rows.map((r) => String(r.productId ?? ''))
  const products = await db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
  const nameById = new Map(products.map((p) => [p.id, p.name]))
  const normalized: NormalizedItem[] = []
  for (const row of rows) {
    const productId = String(row.productId ?? '')
    const productName = nameById.get(productId)
    if (!productName) throw new Error('Sản phẩm trong hóa đơn không tồn tại')
    const quantity = Number(row.quantity)
    const unitPrice = Number(row.unitPrice)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Số lượng của "${productName}" phải lớn hơn 0`)
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new Error(`Đơn giá của "${productName}" không được âm`)
    }
    normalized.push({ productId, quantity, unitPrice })
  }
  return normalized
}

function parseVatRate(input: unknown): number {
  const rate = Number(input)
  if (!Number.isFinite(rate) || rate < 0) return 8
  return rate
}

function parseInvoiceDate(input: unknown): Date {
  if (input == null || input === '') return new Date()
  const date = new Date(String(input))
  if (Number.isNaN(date.getTime())) throw new Error('Ngày hóa đơn không hợp lệ')
  return date
}

async function resolvePartner(partnerId: unknown): Promise<{ id: string; name: string } | null> {
  const id = partnerId ? String(partnerId) : ''
  if (!id) return null
  const partner = await db.partner.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!partner) throw new Error('Đối tác không tồn tại')
  return partner
}

// ===== HÓA ĐƠN MUA =====

export interface CreatePurchaseInvoiceInput {
  partnerId?: string | null
  items: InvoiceItemInput[]
  vatRate?: number
  invoiceDate?: string | Date
  note?: string
}

export async function createPurchaseInvoice(input: CreatePurchaseInvoiceInput) {
  const invoiceDate = parseInvoiceDate(input.invoiceDate)
  await assertPeriodOpen(invoiceDate)
  const items = await normalizeItems(input.items)
  const partner = await resolvePartner(input.partnerId)
  const vatRate = parseVatRate(input.vatRate)

  const subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
  const vatAmount = (subtotal * vatRate) / 100
  const total = subtotal + vatAmount
  const code = await genInvoiceCode('PMM', invoiceDate)

  const created = await db.$transaction(async (tx) => {
    const invoice = await tx.purchaseInvoice.create({
      data: {
        code,
        partnerId: partner?.id ?? null,
        invoiceDate,
        subtotal,
        vatRate,
        vatAmount,
        total,
        status: 'POSTED',
        note: input.note?.trim() || null,
        items: {
          create: items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.quantity * it.unitPrice,
          })),
        },
      },
    })
    // Nhập kho theo từng dòng hóa đơn
    for (const it of items) {
      await applyStockChange(tx, it.productId, Math.round(it.quantity), 'IMPORT', `Nhập mua theo hóa đơn ${code}`)
    }
    return invoice
  })

  const full = await db.purchaseInvoice.findUnique({
    where: { id: created.id },
    include: {
      partner: true,
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  })

  await logLedger({
    scope: 'INVOICE',
    action: 'PURCHASE_CREATED',
    actor: 'OPERATOR',
    entityType: 'PurchaseInvoice',
    entityId: created.id,
    entityCode: code,
    title: `Hóa đơn mua ${code} — ${partner?.name ?? 'Nhà cung cấp lẻ'}`,
    detail: {
      subtotal,
      vatRate,
      vatAmount,
      total,
      itemCount: items.length,
      items: items.map((it) => ({ productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice })),
    },
  })
  broadcast('settings.updated', { reason: 'invoice' })
  dispatchWebhook('invoice.purchase.created', full)

  return full
}

// ===== HÓA ĐƠN BÁN =====

export interface CreateSalesInvoiceInput {
  orderId?: string | null
  partnerId?: string | null
  items?: InvoiceItemInput[]
  subtotal?: number
  vatRate?: number
  invoiceDate?: string | Date
  note?: string
}

interface BomIssuedRecord {
  componentProductId: string
  componentName: string
  bomQuantity: number
  itemQuantity: number
  deducted: number
  warning?: string
}

/** Map orderId → code (SalesInvoice chỉ lưu orderId, không có relation tới Order) */
export async function getOrderCodeMap(orderIds: Array<string | null | undefined>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(orderIds.filter((id): id is string => Boolean(id))))
  if (unique.length === 0) return new Map()
  const rows = await db.order.findMany({ where: { id: { in: unique } }, select: { id: true, code: true } })
  return new Map(rows.map((row) => [row.id, row.code]))
}

export async function createSalesInvoice(input: CreateSalesInvoiceInput) {
  const invoiceDate = parseInvoiceDate(input.invoiceDate)
  await assertPeriodOpen(invoiceDate)
  const partner = await resolvePartner(input.partnerId)
  const vatRate = parseVatRate(input.vatRate)

  const hasExplicitItems = Array.isArray(input.items) && input.items.length > 0
  let items: NormalizedItem[]
  let order: { id: string; code: string; subtotal: number } | null = null

  if (input.orderId) {
    const found = await db.order.findUnique({
      where: { id: String(input.orderId) },
      include: { items: true },
    })
    if (!found) throw new Error('Đơn hàng không tồn tại')
    order = { id: found.id, code: found.code, subtotal: found.subtotal }
    if (hasExplicitItems) {
      items = await normalizeItems(input.items)
    } else {
      if (found.items.length === 0) throw new Error('Đơn hàng không có sản phẩm nào để xuất hóa đơn')
      items = found.items.map((oi) => ({ productId: oi.productId, quantity: oi.quantity, unitPrice: oi.price }))
    }
  } else {
    // Tạo thủ công — bắt buộc có items, sẽ trừ kho
    items = await normalizeItems(input.items)
  }

  // Subtotal: ưu tiên items vừa chuẩn hóa; với hóa đơn từ đơn hàng không truyền items → dùng order.subtotal
  let subtotal: number
  if (hasExplicitItems) {
    subtotal = items.reduce((sum, it) => sum + it.quantity * it.unitPrice, 0)
  } else if (order) {
    const override = Number(input.subtotal)
    subtotal = input.subtotal != null && Number.isFinite(override) ? override : order.subtotal
  } else {
    subtotal = 0
  }
  const vatAmount = (subtotal * vatRate) / 100
  const total = subtotal + vatAmount
  const code = await genInvoiceCode('PXK', invoiceDate)

  // Tên thành phẩm để ghi note movement BOM theo đúng format "... cho {qty} {tên TP} (HĐ {code})"
  const productsForName = await db.product.findMany({
    where: { id: { in: items.map((it) => it.productId) } },
    select: { id: true, name: true },
  })
  const productNameById = new Map(productsForName.map((p) => [p.id, p.name]))

  const created = await db.$transaction(async (tx) => {
    const invoice = await tx.salesInvoice.create({
      data: {
        code,
        orderId: order?.id ?? null,
        partnerId: partner?.id ?? null,
        invoiceDate,
        subtotal,
        vatRate,
        vatAmount,
        total,
        status: 'POSTED',
        note: input.note?.trim() || null,
        items: {
          create: items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            amount: it.quantity * it.unitPrice,
          })),
        },
      },
    })

    // Tạo thủ công (không qua đơn hàng) → trừ kho thành phẩm
    if (!order) {
      for (const it of items) {
        await applyStockChange(tx, it.productId, -Math.round(it.quantity), 'SALE_EXPORT', `Xuất bán theo hóa đơn ${code}`)
      }
    }

    // BOM trừ định mức nguyên vật liệu cho mọi thành phẩm trong items có khai báo định mức
    const bomIssued: BomIssuedRecord[] = []
    for (const it of items) {
      const finishedName = productNameById.get(it.productId) ?? 'Thành phẩm'
      const bomRows = await tx.bomComponent.findMany({
        where: { productId: it.productId },
        include: { componentProduct: { select: { id: true, name: true, unit: true } } },
      })
      for (const bom of bomRows) {
        const deduct = Math.round(bom.quantity * it.quantity)
        if (deduct <= 0) continue
        const note = `Định mức ${bom.quantity} ${bom.componentProduct.unit} ${bom.componentProduct.name} cho ${it.quantity} ${finishedName} (HĐ ${code})`
        const deducted = await applyClampedIssue(tx, bom.componentProductId, deduct, 'BOM_ISSUE', note)
        if (deducted >= deduct) {
          bomIssued.push({
            componentProductId: bom.componentProductId,
            componentName: bom.componentProduct.name,
            bomQuantity: bom.quantity,
            itemQuantity: it.quantity,
            deducted,
          })
        } else {
          // Kho VLT không đủ — vẫn trừ (tối đa về 0) nhưng cảnh báo vào Sổ Data
          bomIssued.push({
            componentProductId: bom.componentProductId,
            componentName: bom.componentProduct.name,
            bomQuantity: bom.quantity,
            itemQuantity: it.quantity,
            deducted,
            warning: `Kho vật liệu "${bom.componentProduct.name}" không đủ — chỉ trừ được ${deducted}/${deduct}`,
          })
        }
      }
    }
    return { invoice, bomIssued }
  })

  const full = await db.salesInvoice.findUnique({
    where: { id: created.invoice.id },
    include: {
      partner: true,
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  })
  const result = full
    ? { ...full, order: order ? { id: order.id, code: order.code } : null }
    : full

  await logLedger({
    scope: 'INVOICE',
    action: 'SALES_CREATED',
    actor: 'OPERATOR',
    entityType: 'SalesInvoice',
    entityId: created.invoice.id,
    entityCode: code,
    title: `Hóa đơn bán ${code}${order ? ` — đơn ${order.code}` : partner ? ` — ${partner.name}` : ''}`,
    detail: {
      orderId: order?.id ?? null,
      orderCode: order?.code ?? null,
      subtotal,
      vatRate,
      vatAmount,
      total,
      itemCount: items.length,
      items: items.map((it) => ({ productId: it.productId, quantity: it.quantity, unitPrice: it.unitPrice })),
      bomIssued: created.bomIssued,
    },
  })
  broadcast('settings.updated', { reason: 'invoice' })
  dispatchWebhook('invoice.sales.created', result)

  return result
}

// ===== HỦY HÓA ĐƠN =====

function appendCancelNote(current: string | null, note?: string): string | null {
  const reason = note?.trim()
  if (!reason) return current
  return current ? `${current} | Hủy: ${reason}` : `Hủy: ${reason}`
}

export async function cancelPurchaseInvoice(id: string, note?: string) {
  const invoice = await db.purchaseInvoice.findUnique({ where: { id }, include: { items: true } })
  if (!invoice) throw new Error('Hóa đơn mua không tồn tại')
  if (invoice.status === 'CANCELLED') throw new Error('Hóa đơn đã bị hủy trước đó')
  await assertPeriodOpen(invoice.invoiceDate)

  await db.$transaction(async (tx) => {
    await tx.purchaseInvoice.update({
      where: { id },
      data: { status: 'CANCELLED', note: appendCancelNote(invoice.note, note) },
    })
    // Hoàn nhập: trừ lại đúng lượng đã nhập khi tạo hóa đơn
    for (const it of invoice.items) {
      await applyStockChange(tx, it.productId, -Math.round(it.quantity), 'REVERSE', `Hủy hóa đơn mua ${invoice.code} — trừ lại kho đã nhập`)
    }
  })

  const full = await db.purchaseInvoice.findUnique({
    where: { id },
    include: {
      partner: true,
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  })

  await logLedger({
    scope: 'INVOICE',
    action: 'PURCHASE_CANCELLED',
    actor: 'OPERATOR',
    entityType: 'PurchaseInvoice',
    entityId: id,
    entityCode: invoice.code,
    title: `Hủy hóa đơn mua ${invoice.code}`,
    detail: {
      note: note?.trim() || null,
      reversedItems: invoice.items.map((it) => ({ productId: it.productId, quantity: Math.round(it.quantity) })),
    },
  })
  broadcast('settings.updated', { reason: 'invoice' })

  return full
}

export async function cancelSalesInvoice(id: string, note?: string) {
  const invoice = await db.salesInvoice.findUnique({ where: { id }, include: { items: true } })
  if (!invoice) throw new Error('Hóa đơn bán không tồn tại')
  if (invoice.status === 'CANCELLED') throw new Error('Hóa đơn đã bị hủy trước đó')
  await assertPeriodOpen(invoice.invoiceDate)

  await db.$transaction(async (tx) => {
    await tx.salesInvoice.update({
      where: { id },
      data: { status: 'CANCELLED', note: appendCancelNote(invoice.note, note) },
    })
    // Hoàn kho dựa trên movement thật của hóa đơn (xuất thủ công + BOM_ISSUE, kể cả trường hợp bị kẹp về 0)
    const movements = await tx.stockMovement.findMany({
      where: { type: { in: ['SALE_EXPORT', 'BOM_ISSUE'] }, note: { contains: invoice.code } },
    })
    for (const mv of movements) {
      await applyStockChange(tx, mv.productId, -mv.quantity, 'REVERSE', `Hủy hóa đơn bán ${invoice.code} — hoàn kho`)
    }
  })

  const full = await db.salesInvoice.findUnique({
    where: { id },
    include: {
      partner: true,
      items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  })
  const orderCodeMap = await getOrderCodeMap([invoice.orderId])
  const result =
    full && invoice.orderId
      ? { ...full, order: { id: invoice.orderId, code: orderCodeMap.get(invoice.orderId) ?? null } }
      : full

  await logLedger({
    scope: 'INVOICE',
    action: 'SALES_CANCELLED',
    actor: 'OPERATOR',
    entityType: 'SalesInvoice',
    entityId: id,
    entityCode: invoice.code,
    title: `Hủy hóa đơn bán ${invoice.code}${invoice.orderId ? ` — đơn ${orderCodeMap.get(invoice.orderId) ?? ''}` : ''}`,
    detail: { note: note?.trim() || null, orderId: invoice.orderId },
  })
  broadcast('settings.updated', { reason: 'invoice' })

  return result
}
