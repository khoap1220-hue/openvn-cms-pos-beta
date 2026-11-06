import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { dispatchWebhook } from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

const CASE_TYPES = ['RETURN', 'EXCHANGE', 'WARRANTY'] as const
const HANDLERS = ['OPERATOR', 'AGENT'] as const

const CASE_TYPE_LABELS: Record<string, string> = {
  RETURN: 'Trả hàng',
  EXCHANGE: 'Đổi hàng',
  WARRANTY: 'Bảo hành',
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Sinh mã vụ sau bán hàng SBH-{YYMMDD}-{seq4} */
async function nextCaseCode(date: Date): Promise<string> {
  const base = `SBH-${String(date.getFullYear()).slice(2)}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-`
  const rows = await db.afterSalesCase.findMany({ where: { code: { startsWith: base } }, select: { code: true } })
  let max = 0
  for (const row of rows) {
    const seq = Number(row.code.slice(base.length))
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${base}${String(max + 1).padStart(4, '0')}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const orderId = searchParams.get('orderId')?.trim()

    const cases = await db.afterSalesCase.findMany({
      where: orderId ? { orderId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { id: true, code: true, customer: { select: { id: true, name: true, phone: true } } } },
      },
    })

    return NextResponse.json({ cases })
  } catch (error) {
    console.error('Aftersales GET error:', error)
    return NextResponse.json({ error: 'Không thể tải vụ sau bán hàng' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const orderId = String(body.orderId ?? '')
    const type = String(body.type ?? '')
    const reason = String(body.reason ?? '').trim()

    if (!orderId) return NextResponse.json({ error: 'Vui lòng chọn đơn hàng' }, { status: 400 })
    if (!(CASE_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: 'Loại vụ không hợp lệ (RETURN | EXCHANGE | WARRANTY)' }, { status: 400 })
    }
    if (!reason) return NextResponse.json({ error: 'Vui lòng nhập lý do' }, { status: 400 })

    const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, code: true, status: true, total: true } })
    if (!order) return NextResponse.json({ error: 'Đơn hàng không tồn tại' }, { status: 404 })
    if (order.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Không thể tạo yêu cầu đổi trả / bảo hành cho đơn hàng đã hủy' }, { status: 400 })
    }

    const handledBy = (HANDLERS as readonly string[]).includes(String(body.handledBy ?? '')) ? String(body.handledBy) : 'OPERATOR'
    const refundAmount = Number(body.refundAmount)
    if (Number.isFinite(refundAmount) && refundAmount > order.total) {
      return NextResponse.json(
        { error: `Số tiền hoàn trả (${refundAmount.toLocaleString('vi-VN')}đ) không được vượt quá tổng đơn hàng (${order.total.toLocaleString('vi-VN')}đ)` },
        { status: 400 }
      )
    }

    const created = await db.afterSalesCase.create({
      data: {
        code: await nextCaseCode(new Date()),
        orderId,
        type,
        status: 'OPEN',
        reason,
        refundAmount: Number.isFinite(refundAmount) && refundAmount > 0 ? refundAmount : 0,
        handledBy,
      },
      include: {
        order: { select: { id: true, code: true, customer: { select: { id: true, name: true, phone: true } } } },
      },
    })

    await logLedger({
      scope: 'AFTERSALES',
      action: 'CASE_CREATED',
      actor: handledBy === 'AGENT' ? 'AGENT' : 'OPERATOR',
      entityType: 'AfterSalesCase',
      entityId: created.id,
      entityCode: created.code,
      title: `${CASE_TYPE_LABELS[type] ?? type} ${created.code} — đơn ${order.code}`,
      detail: { type, reason, refundAmount: created.refundAmount, handledBy },
    })
    broadcast('order.updated', { reason: 'aftersales', orderId, caseCode: created.code })
    dispatchWebhook('aftersales.created', created)

    return NextResponse.json({ case: created }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo vụ sau bán hàng'
    console.error('Aftersales POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
