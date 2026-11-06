import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logEvent } from '@/lib/agent-log'
import { recordLineageChangeAsync } from '@/lib/ledger'
import { awardPointsForCompletedOrder } from '@/lib/member'
import { syncComboStock, syncCombosUsingComponents } from '@/lib/combo'

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

    let updated
    if (data.status === 'RETURNED' && shipment.status !== 'RETURNED') {
      // Vận đơn hoàn hàng về kho -> tự động hủy đơn hàng gốc & hoàn trả tồn kho nguyên khối trong transaction
      updated = await db.$transaction(async (tx) => {
        const shipmentUpdated = await tx.shipment.update({ where: { id }, data, include: { order: true } })

        if (shipmentUpdated.order.status !== 'CANCELLED') {
          await tx.order.update({
            where: { id: shipmentUpdated.orderId },
            data: { status: 'CANCELLED' },
          })
          const orderItems = await tx.orderItem.findMany({ where: { orderId: shipmentUpdated.orderId } })
          const comboIdsToSync = new Set<string>()
          const restockedProductIds: string[] = []
          for (const item of orderItems) {
            const product = await tx.product.findUnique({ where: { id: item.productId } })
            if (!product) continue
            if (product.type === 'COMBO') {
              const components = await tx.bomComponent.findMany({
                where: { productId: product.id },
              })
              for (const row of components) {
                const qty = Math.round(row.quantity * item.quantity)
                if (qty <= 0) continue
                const comp = await tx.product.findUnique({ where: { id: row.componentProductId } })
                if (!comp) continue
                const after = comp.stock + qty
                await tx.product.update({ where: { id: row.componentProductId }, data: { stock: after } })
                await tx.stockMovement.create({
                  data: {
                    productId: row.componentProductId,
                    type: 'IMPORT',
                    quantity: qty,
                    stockAfter: after,
                    note: `Hoàn thành phần combo "${product.name}" × ${item.quantity} do vận đơn ${shipmentUpdated.trackingCode} hoàn trả (${shipmentUpdated.order.code})`,
                  },
                })
                restockedProductIds.push(row.componentProductId)
              }
              comboIdsToSync.add(product.id)
              continue
            }
            const after = product.stock + item.quantity
            await tx.product.update({ where: { id: product.id }, data: { stock: after } })
            await tx.stockMovement.create({
              data: {
                productId: product.id,
                type: 'IMPORT',
                quantity: item.quantity,
                stockAfter: after,
                note: `Hoàn kho do vận đơn ${shipmentUpdated.trackingCode} hoàn trả (${shipmentUpdated.order.code})`,
              },
            })
            restockedProductIds.push(product.id)
          }
          for (const comboId of comboIdsToSync) await syncComboStock(tx, comboId)
          if (restockedProductIds.length > 0) await syncCombosUsingComponents(tx, restockedProductIds)
        }

        return shipmentUpdated
      })

      await logEvent(
        updated.orderId,
        'STATUS_CHANGED',
        'OPERATOR',
        `Vận đơn ${updated.trackingCode} hoàn hàng về kho — đã tự động hủy đơn & hoàn trả tồn kho`
      )
      broadcast('order.updated', { id: updated.orderId, status: 'CANCELLED', code: updated.order.code })
    } else {
      updated = await db.shipment.update({ where: { id }, data, include: { order: true } })

      // Đồng bộ trạng thái đơn hàng cha khi vận đơn giao thành công / đối soát COD
      if (data.status === 'DELIVERED' && updated.order.status !== 'COMPLETED' && updated.order.status !== 'CANCELLED') {
        await db.order.update({
          where: { id: updated.orderId },
          data: { status: 'COMPLETED', paymentStatus: 'PAID' },
        })
        await logEvent(updated.orderId, 'DELIVERED', 'OPERATOR', `Vận đơn ${updated.trackingCode} đã giao thành công — đơn hoàn tất`)
        await awardPointsForCompletedOrder(updated.orderId)
        broadcast('order.updated', { id: updated.orderId, status: 'COMPLETED', paymentStatus: 'PAID', code: updated.order.code })
      } else if (
        (data.codStatus === 'RECEIVED' || data.codStatus === 'RECONCILED') &&
        updated.order.paymentStatus !== 'PAID'
      ) {
        await db.order.update({
          where: { id: updated.orderId },
          data: { paymentStatus: 'PAID' },
        })
        broadcast('order.updated', { id: updated.orderId, paymentStatus: 'PAID', code: updated.order.code })
      } else if (data.status && data.status !== shipment.status && ['PICKED_UP', 'IN_TRANSIT'].includes(data.status)) {
        if (updated.order.status !== 'SHIPPING' && updated.order.status !== 'COMPLETED' && updated.order.status !== 'CANCELLED') {
          await db.order.update({ where: { id: updated.orderId }, data: { status: 'SHIPPING' } })
        }
        await logEvent(
          updated.orderId,
          data.status,
          'OPERATOR',
          data.status === 'PICKED_UP'
            ? `ĐVVC đã lấy hàng (${updated.trackingCode})`
            : `Đơn hàng đang trên đường giao (${updated.trackingCode})`
        )
        broadcast('order.updated', { id: updated.orderId, status: 'SHIPPING', code: updated.order.code })
      }
    }

    const codChanged = data.codStatus !== undefined || data.codReceived !== undefined

    broadcast('shipment.updated', { id: updated.id, orderId: updated.orderId, status: updated.status, codStatus: updated.codStatus })

    // ===== DATA LINEAGE — chụp Trước → Sau cho mọi thay đổi vận đơn =====
    const beforeSnap: Record<string, unknown> = {}
    const afterSnap: Record<string, unknown> = {}
    if (data.status !== undefined && data.status !== shipment.status) {
      beforeSnap.status = shipment.status
      afterSnap.status = updated.status
    }
    if (codChanged) {
      beforeSnap.codStatus = shipment.codStatus
      afterSnap.codStatus = updated.codStatus
      if (updated.codReceived !== shipment.codReceived) {
        beforeSnap.codReceived = shipment.codReceived
        afterSnap.codReceived = updated.codReceived
      }
    }
    if (Object.keys(afterSnap).length > 0) {
      const isCodOnly = Object.keys(afterSnap).every((k) => k.startsWith('cod'))
      const action = isCodOnly
        ? (updated.codStatus === 'RECONCILED' ? 'COD_RECONCILED' : 'COD_RECEIVED')
        : 'SHIPMENT_STATUS_CHANGED'
      const lineTitle = isCodOnly
        ? (updated.codStatus === 'RECONCILED'
          ? `Đối soát COD xong đơn ${shipment.order.code} — ${(updated.codReceived).toLocaleString('vi-VN')}đ đã về, chốt vào sổ`
          : updated.codStatus === 'RECEIVED'
            ? `Đã nhận tiền COD từ ĐVVC cho đơn ${shipment.order.code} — ${(updated.codReceived).toLocaleString('vi-VN')}đ`
            : `Chuyển đơn ${shipment.order.code} về chờ đối soát COD`)
        : `Vận đơn ${updated.trackingCode}: ${shipment.status} → ${updated.status}`
      recordLineageChangeAsync({
        scope: 'ORDER',
        action,
        entityType: 'Shipment',
        entityId: updated.id,
        entityCode: updated.trackingCode,
        sourceRefCode: shipment.order.code,
        title: lineTitle,
        before: beforeSnap,
        after: afterSnap,
        actor: 'OPERATOR',
        actorName: 'Người vận hành',
        originSource: 'MANUAL_ADMIN',
        detail: {
          orderId: shipment.order.id,
          orderCode: shipment.order.code,
          codAmount: updated.codAmount,
          codReceived: updated.codReceived,
          note: updated.codNote,
        },
      })
    }

    return NextResponse.json({ shipment: updated })
  } catch (error) {
    console.error('Shipment PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật vận đơn' }, { status: 500 })
  }
}

export const PUT = PATCH
