import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PeriodClosedError, cancelSalesInvoice, getOrderCodeMap } from '@/lib/invoice-service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const invoice = await db.salesInvoice.findUnique({
      where: { id },
      include: {
        partner: true,
        items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
    })
    if (!invoice) return NextResponse.json({ error: 'Không tìm thấy hóa đơn bán' }, { status: 404 })

    const orderCodeMap = await getOrderCodeMap([invoice.orderId])
    const withOrder = invoice.orderId
      ? { ...invoice, order: { id: invoice.orderId, code: orderCodeMap.get(invoice.orderId) ?? null } }
      : { ...invoice, order: null }

    return NextResponse.json({ invoice: withOrder })
  } catch (error) {
    console.error('Sales invoice GET error:', error)
    return NextResponse.json({ error: 'Không thể tải hóa đơn bán' }, { status: 500 })
  }
}

// POST { action: 'CANCEL', note? } — hủy hóa đơn
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (String(body.action ?? '') !== 'CANCEL') {
      return NextResponse.json({ error: 'Hành động không hợp lệ (chỉ hỗ trợ CANCEL)' }, { status: 400 })
    }
    const invoice = await cancelSalesInvoice(id, body.note != null ? String(body.note) : undefined)
    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : 'Không thể hủy hóa đơn bán'
    console.error('Sales invoice CANCEL error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
