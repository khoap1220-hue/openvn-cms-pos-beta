import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logActivity, logEvent } from '@/lib/agent-log'
import { broadcast } from '@/lib/realtime'
import { recordLineageChange } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import { syncComboStock, syncCombosUsingComponents } from '@/lib/combo'
import { syncProductWarehouseStock } from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

interface OrderConfirmResult {
  orderId: string
  orderCode?: string
  status: 'CONFIRMED' | 'REJECTED'
  reason?: string
}

export async function POST(req: NextRequest) {
  try {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Danh sách mã đơn hàng không hợp lệ' }, { status: 400 })
    }

    if (!body || !Array.isArray(body.orderIds) || body.orderIds.length === 0) {
      return NextResponse.json({ error: 'Danh sách mã đơn hàng không hợp lệ' }, { status: 400 })
    }

    const orderIds = body.orderIds as string[]
    const results: OrderConfirmResult[] = []
    let processedCount = 0
    let rejectedCount = 0

    for (const orderId of orderIds) {
      if (typeof orderId !== 'string' || !orderId.trim()) {
        results.push({
          orderId: String(orderId),
          status: 'REJECTED',
          reason: 'Mã đơn hàng không hợp lệ',
        })
        rejectedCount++
        continue
      }

      // Kiểm tra và xử lý đơn hàng trong transaction riêng biệt cho từng đơn
      try {
        const orderResult = await db.$transaction(async (tx) => {
          // 1. Kiểm tra tồn tại
          const order = await tx.order.findUnique({
            where: { id: orderId },
            include: {
              items: {
                include: {
                  product: true,
                },
              },
            },
          })

          if (!order) {
            return {
              result: {
                orderId,
                status: 'REJECTED' as const,
                reason: 'Đơn hàng không tồn tại',
              },
              confirmedOrder: null,
            }
          }

          // 2. Kiểm tra trạng thái PENDING
          if (order.status !== 'PENDING') {
            return {
              result: {
                orderId: order.id,
                orderCode: order.code,
                status: 'REJECTED' as const,
                reason: `Đơn hàng đang ở trạng thái ${order.status}, chỉ đơn PENDING mới được xác nhận`,
              },
              confirmedOrder: null,
            }
          }

          // Kiểm tra xem đơn hàng đã được trừ kho lúc tạo đơn hay chưa (qua createOrder)
          const existingMovement = await tx.stockMovement.findFirst({
            where: {
              note: { contains: order.code },
              type: { in: ['EXPORT', 'COMBO_ISSUE'] },
            },
          })
          const alreadyDeducted = Boolean(existingMovement)

          if (alreadyDeducted) {
            // Tồn kho đã được trừ/giữ sẵn tại thời điểm tạo đơn (createOrder)
            // Không trừ kho lại, không kiểm tra tồn kho, không tạo StockMovement trùng lặp
            const updatedOrder = await tx.order.update({
              where: { id: order.id },
              data: { status: 'CONFIRMED' },
            })

            return {
              result: {
                orderId: order.id,
                orderCode: order.code,
                status: 'CONFIRMED' as const,
              },
              confirmedOrder: updatedOrder,
            }
          }

          // 3. Tính toán nhu cầu kho (đơn lẻ + thành phần combo) - chỉ thực hiện khi !alreadyDeducted
          const directDemands = new Map<string, { product: typeof order.items[0]['product']; quantity: number }>()
          const comboDemands = new Map<string, { componentProductId: string; quantity: number; componentSku: string; componentStock: number; comboName: string }>()
          const comboIdsToSync = new Set<string>()

          for (const item of order.items) {
            const product = item.product
            if (!product) {
              return {
                result: {
                  orderId: order.id,
                  orderCode: order.code,
                  status: 'REJECTED' as const,
                  reason: 'Sản phẩm trong đơn không tồn tại trên hệ thống',
                },
                confirmedOrder: null,
              }
            }

            if (product.type === 'COMBO') {
              comboIdsToSync.add(product.id)
              const bomRows = await tx.bomComponent.findMany({
                where: { productId: product.id },
                include: { componentProduct: true },
              })

              if (bomRows.length === 0) {
                return {
                  result: {
                    orderId: order.id,
                    orderCode: order.code,
                    status: 'REJECTED' as const,
                    reason: `Combo "${product.name}" chưa khai báo định mức BOM`,
                  },
                  confirmedOrder: null,
                }
              }

              for (const bom of bomRows) {
                const required = Math.round(bom.quantity * item.quantity)
                const existing = comboDemands.get(bom.componentProductId) ?? {
                  componentProductId: bom.componentProductId,
                  quantity: 0,
                  componentSku: bom.componentProduct.sku,
                  componentStock: bom.componentProduct.stock,
                  comboName: product.name,
                }
                existing.quantity += required
                comboDemands.set(bom.componentProductId, existing)
              }
            } else {
              const existing = directDemands.get(product.id) ?? {
                product,
                quantity: 0,
              }
              existing.quantity += item.quantity
              directDemands.set(product.id, existing)
            }
          }

          // 4. Kiểm tra tồn kho thực tế cho tất cả sản phẩm
          // 4.1. Kiểm tra sản phẩm đơn lẻ
          for (const [productId, demand] of directDemands.entries()) {
            const freshProd = await tx.product.findUnique({ where: { id: productId } })
            if (!freshProd) {
              return {
                result: {
                  orderId: order.id,
                  orderCode: order.code,
                  status: 'REJECTED' as const,
                  reason: `Sản phẩm ${demand.product?.sku ?? productId} không tồn tại`,
                },
                confirmedOrder: null,
              }
            }

            // Gộp thêm nếu SP này cũng bị trừ qua combo trong cùng đơn
            const comboDemandForThis = comboDemands.get(productId)?.quantity ?? 0
            const totalRequired = demand.quantity + comboDemandForThis

            if (freshProd.stock < totalRequired) {
              return {
                result: {
                  orderId: order.id,
                  orderCode: order.code,
                  status: 'REJECTED' as const,
                  reason: `Không đủ tồn kho (Sản phẩm ${freshProd.sku}: tồn ${freshProd.stock}, yêu cầu ${totalRequired})`,
                },
                confirmedOrder: null,
              }
            }
          }

          // 4.2. Kiểm tra các thành phần combo (chưa được kiểm tra ở trên)
          for (const [compId, demand] of comboDemands.entries()) {
            if (directDemands.has(compId)) continue // Đã kiểm tra gộp ở trên
            const freshComp = await tx.product.findUnique({ where: { id: compId } })
            if (!freshComp) {
              return {
                result: {
                  orderId: order.id,
                  orderCode: order.code,
                  status: 'REJECTED' as const,
                  reason: `Thành phần combo ${demand.componentSku} không tồn tại`,
                },
                confirmedOrder: null,
              }
            }

            if (freshComp.stock < demand.quantity) {
              return {
                result: {
                  orderId: order.id,
                  orderCode: order.code,
                  status: 'REJECTED' as const,
                  reason: `Không đủ tồn kho (Sản phẩm ${freshComp.sku}: tồn ${freshComp.stock}, yêu cầu ${demand.quantity})`,
                },
                confirmedOrder: null,
              }
            }
          }

          // 5. Trừ kho và tạo StockMovement
          const touchedComponentIds: string[] = []
          const touchedDirectIds: string[] = []

          // 5.1. Trừ kho sản phẩm đơn lẻ
          for (const [productId, demand] of directDemands.entries()) {
            const freshProd = (await tx.product.findUnique({ where: { id: productId } }))!
            const stockAfter = freshProd.stock - demand.quantity
            await tx.product.update({
              where: { id: productId },
              data: { stock: stockAfter },
            })
            await tx.stockMovement.create({
              data: {
                productId,
                warehouseId: order.warehouseId,
                type: 'EXPORT',
                quantity: -demand.quantity,
                stockAfter,
                note: `Xuất kho cho đơn ${order.code} (xác nhận hàng loạt)`,
              },
            })
            if (order.warehouseId) {
              await syncProductWarehouseStock(productId, order.warehouseId)
            }
            touchedDirectIds.push(productId)
          }

          // 5.2. Trừ kho thành phần combo
          for (const [compId, demand] of comboDemands.entries()) {
            const freshComp = (await tx.product.findUnique({ where: { id: compId } }))!
            const stockAfter = freshComp.stock - demand.quantity
            await tx.product.update({
              where: { id: compId },
              data: { stock: stockAfter },
            })
            await tx.stockMovement.create({
              data: {
                productId: compId,
                warehouseId: order.warehouseId,
                type: 'COMBO_ISSUE',
                quantity: -demand.quantity,
                stockAfter,
                note: `Trừ thành phần combo "${demand.comboName}" cho đơn ${order.code} (xác nhận hàng loạt)`,
              },
            })
            if (order.warehouseId) {
              await syncProductWarehouseStock(compId, order.warehouseId)
            }
            touchedComponentIds.push(compId)
          }

          // 5.3. Đồng bộ tồn combo
          for (const comboId of comboIdsToSync) {
            await syncComboStock(tx, comboId)
          }
          if (touchedComponentIds.length > 0) {
            await syncCombosUsingComponents(tx, touchedComponentIds)
          }
          if (touchedDirectIds.length > 0) {
            await syncCombosUsingComponents(tx, touchedDirectIds)
          }

          // 6. Cập nhật trạng thái đơn sang CONFIRMED
          const updatedOrder = await tx.order.update({
            where: { id: order.id },
            data: { status: 'CONFIRMED' },
          })

          return {
            result: {
              orderId: order.id,
              orderCode: order.code,
              status: 'CONFIRMED' as const,
            },
            confirmedOrder: updatedOrder,
          }
        })

        results.push(orderResult.result)

        if (orderResult.result.status === 'CONFIRMED') {
          processedCount++
          const confirmed = orderResult.confirmedOrder
          if (confirmed) {
            // Ghi timeline, broadcast và lineage ngoài transaction
            await logEvent(confirmed.id, 'STATUS_CHANGED', 'OPERATOR', 'Xác nhận đơn hàng hàng loạt')
            await logActivity({
              agent: 'SYSTEM',
              action: 'MANUAL_ACTION',
              level: 'info',
              targetType: 'ORDER',
              targetId: confirmed.id,
              targetLabel: confirmed.code,
              message: `Người vận hành xác nhận hàng loạt đơn ${confirmed.code}`,
            })
            broadcast('order.updated', { id: confirmed.id, status: 'CONFIRMED', code: confirmed.code })
            await recordLineageChange({
              scope: 'ORDER',
              action: 'STATUS_CHANGED',
              entityType: 'Order',
              entityId: confirmed.id,
              entityCode: confirmed.code,
              title: `Đơn ${confirmed.code}: PENDING → CONFIRMED (Hàng loạt)`,
              before: { status: 'PENDING', paymentStatus: confirmed.paymentStatus },
              after: { status: 'CONFIRMED', paymentStatus: confirmed.paymentStatus },
              actor: 'OPERATOR',
              actorName: 'Người vận hành',
              originSource: 'MANUAL_ADMIN',
            })
            dispatchWebhook('order.confirmed', {
              id: confirmed.id,
              code: confirmed.code,
              status: 'CONFIRMED',
              paymentStatus: confirmed.paymentStatus,
            })
          }
        } else {
          rejectedCount++
        }
      } catch (itemErr) {
        console.error(`Lỗi khi xử lý xác nhận đơn ${orderId}:`, itemErr)
        results.push({
          orderId,
          status: 'REJECTED',
          reason: itemErr instanceof Error ? itemErr.message : 'Lỗi hệ thống khi xác nhận đơn hàng',
        })
        rejectedCount++
      }
    }

    return NextResponse.json({
      success: true,
      processedCount,
      rejectedCount,
      results,
    })
  } catch (err) {
    console.error('Bulk confirm error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Không thể xử lý xác nhận hàng loạt' },
      { status: 500 }
    )
  }
}
