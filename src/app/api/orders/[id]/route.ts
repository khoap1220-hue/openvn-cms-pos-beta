import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logActivity, logEvent } from '@/lib/agent-log'
import { broadcast } from '@/lib/realtime'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/types'
import { recordLineageChange } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import { syncComboStock, syncCombosUsingComponents } from '@/lib/combo'
import { adjustPoints, awardPointsForCompletedOrder } from '@/lib/member'

export const dynamic = 'force-dynamic'

// Map trạng thái mới → sự kiện webhook outbound tương ứng
const STATUS_WEBHOOK_EVENT: Record<string, string> = {
  CONFIRMED: 'order.confirmed',
  PACKING: 'order.packing',
  SHIPPING: 'order.shipping',
  COMPLETED: 'order.completed',
  CANCELLED: 'order.cancelled',
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const order = await db.order.findUnique({
      where: { id },
      include: {
        channel: { select: { id: true, key: true, name: true, color: true } },
        customer: { select: { id: true, name: true, phone: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true, barcode: true, costPrice: true, type: true, fragile: true, image: true } } } },
        shipments: true,
        events: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })
    return NextResponse.json({ order })
  } catch (error) {
    console.error('Order GET error:', error)
    return NextResponse.json({ error: 'Không thể tải đơn hàng' }, { status: 500 })
  }
}

// PATCH: cập nhật trạng thái / thanh toán. Hủy đơn → hoàn kho.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { status, paymentStatus } = body

    const order = await db.order.findUnique({ where: { id }, include: { items: true } })
    if (!order) return NextResponse.json({ error: 'Không tìm thấy đơn hàng' }, { status: 404 })

    const data: { status?: string; paymentStatus?: string } = {}
    if (status) {
      if (!['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'COMPLETED', 'CANCELLED'].includes(status)) {
        return NextResponse.json({ error: 'Trạng thái không hợp lệ' }, { status: 400 })
      }
      data.status = status
    }
    if (paymentStatus) data.paymentStatus = paymentStatus

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    // Chặn mở lại đơn đã hủy (vì đã hoàn kho tự động khi hủy)
    if (order.status === 'CANCELLED' && data.status && data.status !== 'CANCELLED') {
      return NextResponse.json(
        { error: 'Đơn hàng đã hủy (đã hoàn kho), không thể chuyển lại trạng thái khác' },
        { status: 400 }
      )
    }

    // Hủy đơn: hoàn kho (chỉ khi đơn trước đó chưa bị hủy)
    if (data.status === 'CANCELLED') {
      if (order.status === 'CANCELLED') {
        return NextResponse.json({ error: 'Đơn hàng đã bị hủy trước đó' }, { status: 400 })
      }
      if (order.status === 'COMPLETED') {
        return NextResponse.json({ error: 'Không thể hủy đơn hàng đã hoàn tất' }, { status: 400 })
      }
    }

    const restocking = data.status === 'CANCELLED' && order.status !== 'CANCELLED'

    let updated
    if (restocking) {
      updated = await db.$transaction(async (tx) => {
        const orderUpdated = await tx.order.update({ where: { id }, data })

        // Combo/Set quà tặng: hoàn kho TỪNG THÀNH PHẦN (đơn lúc tạo đã trừ thành phần, không trừ combo)
        const comboIdsToSync = new Set<string>()
        const restockedProductIds: string[] = []
        for (const item of order.items) {
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          if (!product) continue
          if (product.type === 'COMBO') {
            const components = await tx.bomComponent.findMany({
              where: { productId: product.id },
              include: { componentProduct: { select: { id: true, name: true } } },
            })
            for (const row of components) {
              const qty = Math.round(row.quantity * item.quantity)
              if (qty <= 0) continue
              const comp = await tx.product.findUnique({ where: { id: row.componentProductId } })
              if (!comp) continue
              const after = comp.stock + qty
              await tx.product.update({ where: { id: row.componentProductId }, data: { stock: after } })
              const compWhId = order.warehouseId || comp.ownerWarehouseId
              if (compWhId) {
                await tx.warehouseStock.updateMany({
                  where: { warehouseId: compWhId, productId: row.componentProductId },
                  data: { quantity: { increment: qty } },
                })
              }
              await tx.stockMovement.create({
                data: {
                  productId: row.componentProductId,
                  warehouseId: compWhId ?? null,
                  type: 'IMPORT',
                  quantity: qty,
                  stockAfter: after,
                  note: `Hoàn thành phần combo "${product.name}" × ${item.quantity} do hủy đơn ${order.code}`,
                },
              })
              restockedProductIds.push(row.componentProductId)
            }
            comboIdsToSync.add(product.id)
            continue
          }
          const after = product.stock + item.quantity
          await tx.product.update({ where: { id: product.id }, data: { stock: after } })
          const prodWhId = order.warehouseId || product.ownerWarehouseId
          if (prodWhId) {
            await tx.warehouseStock.updateMany({
              where: { warehouseId: prodWhId, productId: product.id },
              data: { quantity: { increment: item.quantity } },
            })
          }
          await tx.stockMovement.create({
            data: {
              productId: product.id,
              warehouseId: prodWhId ?? null,
              type: 'IMPORT',
              quantity: item.quantity,
              stockAfter: after,
              note: `Hoàn kho do hủy đơn ${order.code}`,
            },
          })
          restockedProductIds.push(product.id)
        }
        for (const comboId of comboIdsToSync) await syncComboStock(tx, comboId)
        if (restockedProductIds.length > 0) await syncCombosUsingComponents(tx, restockedProductIds)

        // Hoàn lại lượt dùng Voucher nếu đơn hủy có áp mã
        if (order.voucherCode) {
          const v = await tx.voucher.findUnique({ where: { code: order.voucherCode } })
          if (v && v.usedCount > 0) {
            await tx.voucher.update({
              where: { id: v.id },
              data: { usedCount: Math.max(0, v.usedCount - 1) },
            })
          }
        }

        return orderUpdated
      })

      // Hoàn lại điểm Hội viên đã đổi (nếu đơn lúc tạo có trừ điểm REDEEM)
      if (order.customerId) {
        const redeemEntries = await db.ledgerEntry.findMany({
          where: {
            entityType: 'Customer',
            entityId: order.customerId,
            action: 'POINTS_REDEEMED',
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        })
        const matchedEntry = redeemEntries.find((e) => e.detail && e.detail.includes(order.code))
        if (matchedEntry?.detail) {
          try {
            const parsed = JSON.parse(matchedEntry.detail) as { points?: number }
            const pts = Math.floor(Number(parsed.points) || 0)
            if (pts > 0) {
              await adjustPoints(
                order.customerId,
                'EARN',
                pts,
                `Hoàn lại ${pts} điểm đã đổi do hủy đơn ${order.code}`,
                'SYSTEM'
              )
            }
          } catch {
            // Bỏ qua nếu không parse được detail
          }
        }
      }
    } else {
      updated = await db.order.update({ where: { id }, data })
    }

    // Đơn hoàn thành → tự đánh dấu đã thanh toán (nếu chưa)
    const autoPaid = data.status === 'COMPLETED' && order.paymentStatus !== 'PAID'
    if (autoPaid) {
      await db.order.update({ where: { id }, data: { paymentStatus: 'PAID' } })
    }
    const finalPaymentStatus = autoPaid ? 'PAID' : (data.paymentStatus ?? order.paymentStatus)

    // Ghi timeline + broadcast realtime
    if (data.status && data.status !== order.status) {
      if (data.status === 'CANCELLED') {
        await logEvent(id, 'CANCELLED', 'OPERATOR', 'Người vận hành hủy đơn — hoàn kho tự động')
        await logActivity({
          agent: 'SYSTEM',
          action: 'MANUAL_ACTION',
          level: 'warning',
          targetType: 'ORDER',
          targetId: id,
          targetLabel: order.code,
          message: `Người vận hành hủy đơn ${order.code} (hoàn kho tự động)`,
        })
      } else {
        await logEvent(id, 'STATUS_CHANGED', 'OPERATOR', `Người vận hành chuyển trạng thái: ${ORDER_STATUS_LABELS[order.status] ?? order.status} → ${ORDER_STATUS_LABELS[data.status] ?? data.status}`)
        await logActivity({
          agent: 'SYSTEM',
          action: 'MANUAL_ACTION',
          level: 'info',
          targetType: 'ORDER',
          targetId: id,
          targetLabel: order.code,
          message: `Người vận hành chuyển đơn ${order.code} sang «${ORDER_STATUS_LABELS[data.status] ?? data.status}»`,
        })
      }
      broadcast('order.updated', { id, status: data.status, code: order.code })

      // Sổ Data: đổi trạng thái / hủy đơn — chụp lineage Trước → Sau
      if (data.status === 'CANCELLED') {
        await recordLineageChange({
          scope: 'ORDER',
          action: 'ORDER_CANCELLED',
          entityType: 'Order',
          entityId: id,
          entityCode: order.code,
          title: `Hủy đơn ${order.code} — hoàn kho tự động`,
          before: { status: order.status, paymentStatus: order.paymentStatus },
          after: { status: 'CANCELLED', paymentStatus: finalPaymentStatus },
          actor: 'OPERATOR',
          actorName: 'Người vận hành',
          originSource: 'MANUAL_ADMIN',
          detail: { restocked: restocking },
        })
      } else {
        await recordLineageChange({
          scope: 'ORDER',
          action: 'STATUS_CHANGED',
          entityType: 'Order',
          entityId: id,
          entityCode: order.code,
          title: `Đơn ${order.code}: ${ORDER_STATUS_LABELS[order.status] ?? order.status} → ${ORDER_STATUS_LABELS[data.status] ?? data.status}`,
          before: { status: order.status, paymentStatus: order.paymentStatus },
          after: { status: data.status, paymentStatus: finalPaymentStatus },
          actor: 'OPERATOR',
          actorName: 'Người vận hành',
          originSource: 'MANUAL_ADMIN',
        })
      }

      // Đơn hoàn tất → tự tích điểm cho thành viên (1 điểm / 10.000đ, ghi Sổ Data)
      if (data.status === 'COMPLETED') {
        await awardPointsForCompletedOrder(id)
      }

      // Webhook outbound theo trạng thái mới (kèm paymentStatus khi có đánh dấu thanh toán)
      const webhookEvent = STATUS_WEBHOOK_EVENT[data.status]
      if (webhookEvent) {
        dispatchWebhook(webhookEvent, { id, code: order.code, status: data.status, paymentStatus: finalPaymentStatus })
      }
    } else if (data.paymentStatus) {
      broadcast('order.updated', { id, paymentStatus: data.paymentStatus, code: order.code })

      // Sổ Data: đánh dấu thanh toán — chụp lineage Trước → Sau
      await recordLineageChange({
        scope: 'ORDER',
        action: 'PAYMENT_MARKED',
        entityType: 'Order',
        entityId: id,
        entityCode: order.code,
        title: `Đơn ${order.code} — thanh toán ${PAYMENT_STATUS_LABELS[data.paymentStatus] ?? data.paymentStatus}`,
        before: { paymentStatus: order.paymentStatus },
        after: { paymentStatus: data.paymentStatus },
        actor: 'OPERATOR',
        actorName: 'Người vận hành',
        originSource: 'MANUAL_ADMIN',
      })

      // Webhook outbound kèm paymentStatus (theo trạng thái hiện tại của đơn)
      const webhookEvent = STATUS_WEBHOOK_EVENT[updated.status]
      if (webhookEvent) {
        dispatchWebhook(webhookEvent, { id, code: order.code, status: updated.status, paymentStatus: data.paymentStatus })
      }
    }

    return NextResponse.json({ order: updated })
  } catch (error) {
    console.error('Order PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật đơn hàng' }, { status: 500 })
  }
}

export const PUT = PATCH
