import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

const CASE_STATUSES = ['PROCESSING', 'RESOLVED', 'REJECTED'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>

    const existing = await db.afterSalesCase.findUnique({
      where: { id },
      include: { order: { select: { code: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'Không tìm thấy vụ sau bán hàng' }, { status: 404 })

    const data: { status?: string; resolution?: string | null; refundAmount?: number } = {}

    if (body.status !== undefined) {
      const status = String(body.status)
      if (!(CASE_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json({ error: 'Trạng thái không hợp lệ (PROCESSING | RESOLVED | REJECTED)' }, { status: 400 })
      }
      data.status = status
    }
    if (body.resolution !== undefined) data.resolution = String(body.resolution).trim() || null
    if (body.refundAmount !== undefined) {
      const refund = Number(body.refundAmount)
      if (!Number.isFinite(refund) || refund < 0) {
        return NextResponse.json({ error: 'Số tiền hoàn không hợp lệ' }, { status: 400 })
      }
      data.refundAmount = refund
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    const updated = await db.afterSalesCase.update({ where: { id }, data })

    await logLedger({
      scope: 'AFTERSALES',
      action: 'CASE_UPDATED',
      actor: 'OPERATOR',
      entityType: 'AfterSalesCase',
      entityId: id,
      entityCode: updated.code,
      title: `Cập nhật ${updated.code} — ${existing.order.code}: ${existing.status} → ${updated.status}`,
      detail: {
        from: existing.status,
        to: updated.status,
        resolution: updated.resolution,
        refundAmount: updated.refundAmount,
      },
    })
    broadcast('order.updated', { reason: 'aftersales', orderId: updated.orderId, caseCode: updated.code })

    return NextResponse.json({ case: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật vụ sau bán hàng'
    console.error('Aftersales PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export const PUT = PATCH
