import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logLedgerAsync } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

const COD_STATUSES = ['PENDING', 'RECEIVED', 'RECONCILED']
const SHIPMENT_STATUSES = ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED']

// PATCH: cập nhật hành trình vận chuyển + đối soát tiền COD với ĐVVC
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as {
      status?: string
      codStatus?: string
      codReceived?: number
      codNote?: string
    }

    const shipment = await db.shipment.findUnique({
      where: { id },
      include: { order: { select: { id: true, code: true, total: true, paymentMethod: true } } },
    })
    if (!shipment) return NextResponse.json({ error: 'Không tìm thấy vận đơn' }, { status: 404 })

    const data: {
      status?: string
      codStatus?: string
      codReceived?: number
      codReceivedAt?: Date
      codNote?: string | null
    } = {}

    if (body.status !== undefined) {
      if (!SHIPMENT_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: 'Trạng thái vận chuyển không hợp lệ' }, { status: 400 })
      }
      data.status = body.status
    }

    if (body.codStatus !== undefined) {
      if (!COD_STATUSES.includes(body.codStatus)) {
        return NextResponse.json({ error: 'Trạng thái đối soát COD không hợp lệ' }, { status: 400 })
      }
      data.codStatus = body.codStatus
      if (body.codStatus === 'RECEIVED') {
        // Xác nhận ĐVVC đã thu hộ: mặc định nhận đúng số tiền thu hộ dự kiến
        data.codReceived = Number.isFinite(Number(body.codReceived))
          ? Math.max(0, Number(body.codReceived))
          : shipment.codAmount
        data.codReceivedAt = new Date()
      }
      if (body.codStatus === 'RECONCILED') {
        // Đối soát xong: tiền đã về — nếu chưa đánh dấu RECEIVED thì nhận đủ luôn
        data.codReceived = Number.isFinite(Number(body.codReceived))
          ? Math.max(0, Number(body.codReceived))
          : Math.max(shipment.codReceived, shipment.codAmount)
        if (!shipment.codReceivedAt) data.codReceivedAt = new Date()
      }
    } else if (body.codReceived !== undefined) {
      data.codReceived = Math.max(0, Number(body.codReceived))
    }

    if (body.codNote !== undefined) {
      data.codNote = body.codNote?.trim() || null
    }

    // Đánh dấu giao thành công trên đơn COD chưa ghi nhận → tự động chuyển RECEIVED
    if (data.status === 'DELIVERED' && !data.codStatus && shipment.codStatus === 'PENDING' && shipment.codAmount > 0) {
      data.codStatus = 'RECEIVED'
      data.codReceived = shipment.codAmount
      data.codReceivedAt = new Date()
    }

    const updated = await db.shipment.update({ where: { id }, data, include: { order: true } })

    // Sổ Data: mọi thao tác đối soát COD phải ghi vào đây
    const codChanged = data.codStatus !== undefined || data.codReceived !== undefined
    if (codChanged) {
      const amount = updated.codReceived
      const label =
        updated.codStatus === 'RECEIVED'
          ? `Đã nhận tiền COD từ ĐVVC cho đơn ${shipment.order.code} — ${(amount).toLocaleString('vi-VN')}đ`
          : updated.codStatus === 'RECONCILED'
            ? `Đối soát COD xong đơn ${shipment.order.code} — tiền ${(amount).toLocaleString('vi-VN')}đ đã về, chốt vào sổ`
            : `Chuyển đơn ${shipment.order.code} về chờ đối soát COD`
      logLedgerAsync({
        scope: 'ORDER',
        action: updated.codStatus === 'RECONCILED' ? 'COD_RECONCILED' : 'COD_RECEIVED',
        entityType: 'Shipment',
        entityId: updated.id,
        entityCode: updated.trackingCode,
        title: label,
        detail: {
          orderId: shipment.order.id,
          orderCode: shipment.order.code,
          codAmount: updated.codAmount,
          codReceived: updated.codReceived,
          note: updated.codNote,
        },
        actor: 'OPERATOR',
      })
    }

    broadcast('shipment.updated', { id: updated.id, orderId: updated.orderId, status: updated.status, codStatus: updated.codStatus })

    return NextResponse.json({ shipment: updated })
  } catch (error) {
    console.error('Shipment PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật vận đơn' }, { status: 500 })
  }
}
