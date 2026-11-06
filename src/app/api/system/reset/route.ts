import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncComboStock } from '@/lib/combo'
import { logLedger } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

// POST /api/system/reset — Làm sạch dữ liệu giao dịch mẫu để bắt đầu vận hành thực tế (Go-Live)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      confirmCode?: string
      clearCustomers?: boolean
      resetStockZero?: boolean
    }

    if (String(body.confirmCode ?? '').trim().toUpperCase() !== 'GO-LIVE') {
      return NextResponse.json(
        { error: 'Mã xác nhận không đúng. Vui lòng nhập chính xác chữ GO-LIVE để xác nhận.' },
        { status: 400 },
      )
    }

    const clearCustomers = Boolean(body.clearCustomers)
    const resetStockZero = Boolean(body.resetStockZero)

    const counts = await db.$transaction(async (tx) => {
      const deletedAfterSales = await tx.afterSalesCase.deleteMany()
      const deletedEvents = await tx.orderEvent.deleteMany()
      const deletedShipments = await tx.shipment.deleteMany()
      const deletedOrderItems = await tx.orderItem.deleteMany()
      const deletedOrders = await tx.order.deleteMany()
      const deletedSalesItems = await tx.salesInvoiceItem.deleteMany()
      const deletedSales = await tx.salesInvoice.deleteMany()
      const deletedPurchaseItems = await tx.purchaseInvoiceItem.deleteMany()
      const deletedPurchases = await tx.purchaseInvoice.deleteMany()
      const deletedMessages = await tx.directMessage.deleteMany()
      const deletedActivities = await tx.agentActivity.deleteMany()
      const deletedMovements = await tx.stockMovement.deleteMany()
      const deletedDeliveries = await tx.webhookDelivery.deleteMany()
      const deletedLedger = await tx.ledgerEntry.deleteMany()
      await tx.socialPost.deleteMany({
        where: { externalPostId: { startsWith: 'fb_test_' } },
      })

      let deletedCustomersCount = 0
      if (clearCustomers) {
        const res = await tx.customer.deleteMany()
        deletedCustomersCount = res.count
      } else {
        await tx.customer.updateMany({ data: { points: 0 } })
      }

      // Mở lại toàn bộ kỳ kế toán nếu đang bị khóa mẫu
      await tx.accountingPeriod.updateMany({
        data: { status: 'OPEN', closedAt: null, note: null },
      })

      // Chuyển sang Chế độ Vận hành Thực tế (tắt simulation_mode)
      await tx.automationSetting.upsert({
        where: { key: 'simulation_mode' },
        update: { enabled: false },
        create: { key: 'simulation_mode', enabled: false },
      })

      if (resetStockZero) {
        await tx.product.updateMany({ data: { stock: 0 } })
        await tx.warehouseStock.updateMany({ data: { quantity: 0 } })
      } else {
        const simpleProducts = await tx.product.findMany({
          where: { type: 'SIMPLE', stock: { gt: 0 } },
          select: { id: true, stock: true },
        })
        if (simpleProducts.length > 0) {
          await tx.stockMovement.createMany({
            data: simpleProducts.map((p) => ({
              productId: p.id,
              type: 'IMPORT',
              quantity: p.stock,
              stockAfter: p.stock,
              note: 'Tồn kho đầu kỳ khi bắt đầu vận hành chính thức (Go-Live)',
            })),
          })
        }
      }

      return {
        orders: deletedOrders.count,
        shipments: deletedShipments.count,
        salesInvoices: deletedSales.count,
        purchaseInvoices: deletedPurchases.count,
        messages: deletedMessages.count,
        activities: deletedActivities.count,
        movements: deletedMovements.count,
        ledgerEntries: deletedLedger.count,
        afterSales: deletedAfterSales.count,
        events: deletedEvents.count,
        orderItems: deletedOrderItems.count,
        salesItems: deletedSalesItems.count,
        purchaseItems: deletedPurchaseItems.count,
        deliveries: deletedDeliveries.count,
        customers: deletedCustomersCount,
      }
    })

    // Đồng bộ lại tồn kho Combo từ tồn thành phần
    const combos = await db.product.findMany({ where: { type: 'COMBO' }, select: { id: true } })
    for (const c of combos) {
      await syncComboStock(db, c.id).catch(() => null)
    }

    await logLedger({
      scope: 'SYSTEM',
      action: 'SYSTEM_GOLIVE_INITIALIZED',
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      title: 'Khởi tạo vận hành thực tế (Go-Live) — Đã dọn sạch dữ liệu giao dịch mẫu',
      detail: {
        clearedCounts: counts,
        clearCustomers,
        resetStockZero,
        simulationMode: false,
      },
    })

    broadcast('settings.updated', { key: 'simulation_mode', enabled: false })
    broadcast('order.updated', { reset: true })

    return NextResponse.json({
      ok: true,
      cleared: counts,
      message: 'Đã làm sạch dữ liệu mẫu và chuyển hệ thống sang Chế độ Vận hành Thực tế.',
    })
  } catch (error) {
    console.error('System reset POST error:', error)
    return NextResponse.json({ error: 'Không thể làm sạch dữ liệu mẫu' }, { status: 500 })
  }
}
