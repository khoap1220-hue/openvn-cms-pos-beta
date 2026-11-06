import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PeriodClosedError, cancelPurchaseInvoice } from '@/lib/invoice-service'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const invoice = await db.purchaseInvoice.findUnique({
      where: { id },
      include: {
        partner: true,
        items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
    })
    if (!invoice) return NextResponse.json({ error: 'Không tìm thấy hóa đơn mua' }, { status: 404 })
    return NextResponse.json({ invoice })
  } catch (error) {
    console.error('Purchase invoice GET error:', error)
    return NextResponse.json({ error: 'Không thể tải hóa đơn mua' }, { status: 500 })
  }
}

// POST { action: 'CANCEL', note? } — hủy hóa đơn (dùng POST thay DELETE để giữ lịch sử vĩnh viễn)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action === 'APPROVE') {
      const current = await db.purchaseInvoice.findUnique({
        where: { id },
        include: {
          partner: true,
          items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
        },
      })
      if (!current) return NextResponse.json({ error: 'Không tìm thấy hóa đơn mua' }, { status: 404 })
      const updated = await db.purchaseInvoice.update({
        where: { id },
        data: { status: 'APPROVED' },
        include: {
          partner: true,
          items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
        },
      })
      return NextResponse.json({ invoice: updated })
    }
    if (action !== 'CANCEL') {
      return NextResponse.json({ error: 'Hành động không hợp lệ (hỗ trợ CANCEL, APPROVE)' }, { status: 400 })
    }
    const invoice = await cancelPurchaseInvoice(id, body.note != null ? String(body.note) : undefined)
    return NextResponse.json({ invoice })
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : 'Không thể hủy hóa đơn mua'
    console.error('Purchase invoice CANCEL error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
