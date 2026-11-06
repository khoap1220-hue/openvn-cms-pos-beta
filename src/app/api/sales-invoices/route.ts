import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PeriodClosedError, createSalesInvoice, getOrderCodeMap } from '@/lib/invoice-service'
import { quarterRange } from '@/lib/accounting'
import { getLineageMeta } from '@/lib/lineage-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || 0
    const quarter = Number(searchParams.get('quarter')) || 0
    const q = searchParams.get('q')?.trim()
    const orderId = searchParams.get('orderId')?.trim()
    const uninvoiced = searchParams.get('uninvoiced')

    // ?uninvoiced=1 → danh sách đơn COMPLETED chưa có hóa đơn bán (kèm items)
    if (uninvoiced === '1') {
      const invoiced = await db.salesInvoice.findMany({
        where: { orderId: { not: null } },
        select: { orderId: true },
      })
      const invoicedIds = invoiced.map((row) => row.orderId as string)
      const orders = await db.order.findMany({
        where: { status: 'COMPLETED', id: { notIn: invoicedIds } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          channel: { select: { id: true, key: true, name: true, color: true } },
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
        },
      })
      return NextResponse.json({ orders })
    }

    const where: Record<string, unknown> = {}
    if (orderId) where.orderId = orderId
    if (year > 0) {
      where.invoiceDate =
        quarter >= 1 && quarter <= 4
          ? { gte: quarterRange(year, quarter).start, lt: quarterRange(year, quarter).end }
          : { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) }
    }
    if (q) {
      where.OR = [{ code: { contains: q } }, { partner: { is: { name: { contains: q } } } }]
    }

    const invoices = await db.salesInvoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        partner: { select: { id: true, code: true, name: true, taxCode: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
    })

    // SalesInvoice chỉ lưu orderId — ghép mã đơn vào kết quả
    const orderCodeMap = await getOrderCodeMap(invoices.map((inv) => inv.orderId))
    // DATA PROVENANCE — số lần sửa + nguồn gốc theo Sổ Data
    const lineageMeta = await getLineageMeta('SalesInvoice', invoices.map((inv) => inv.id))
    const withOrder = invoices.map((inv) => ({
      ...inv,
      order: inv.orderId ? { id: inv.orderId, code: orderCodeMap.get(inv.orderId) ?? null } : null,
      originSource: lineageMeta.get(inv.id)?.originSource ?? null,
      changeCount: lineageMeta.get(inv.id)?.changeCount ?? 0,
    }))

    return NextResponse.json({ invoices: withOrder })
  } catch (error) {
    console.error('Sales invoices GET error:', error)
    return NextResponse.json({ error: 'Không thể tải hóa đơn bán' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const invoice = await createSalesInvoice({
      orderId: body.orderId ? String(body.orderId) : null,
      partnerId: body.partnerId ? String(body.partnerId) : null,
      items: Array.isArray(body.items)
        ? (body.items as Array<{ productId: string; quantity: number; unitPrice: number }>)
        : undefined,
      subtotal: body.subtotal != null ? Number(body.subtotal) : undefined,
      vatRate: body.vatRate != null ? Number(body.vatRate) : undefined,
      invoiceDate: body.invoiceDate != null ? String(body.invoiceDate) : undefined,
      note: body.note != null ? String(body.note) : undefined,
    })
    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : 'Không thể tạo hóa đơn bán'
    console.error('Sales invoices POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
