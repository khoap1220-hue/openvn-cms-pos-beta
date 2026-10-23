import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { formatVND } from '@/lib/format'

export const dynamic = 'force-dynamic'

interface ReconciliationIssue {
  type: 'ORDER_NO_INVOICE' | 'MOVEMENT_NO_PURCHASE' | 'NEGATIVE_STOCK' | 'CASH_MISMATCH'
  severity: 'warning' | 'error'
  title: string
  count: number
  estimatedValue?: number
  samples: Array<Record<string, unknown>>
}

// GET — đối soát tự động đa chiều (4 phép)
export async function GET(_req: NextRequest) {
  try {
    const now = new Date()
    const issues: ReconciliationIssue[] = []

    // a) Đơn COMPLETED chưa có hóa đơn bán
    const invoiced = await db.salesInvoice.findMany({ where: { orderId: { not: null } }, select: { orderId: true } })
    const invoicedIds = invoiced.map((row) => row.orderId as string)
    const uninvoicedOrders = await db.order.findMany({
      where: { status: 'COMPLETED', id: { notIn: invoicedIds } },
      select: { code: true, total: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    if (uninvoicedOrders.length > 0) {
      issues.push({
        type: 'ORDER_NO_INVOICE',
        severity: 'warning',
        title: `${uninvoicedOrders.length} đơn hoàn tất chưa có hóa đơn bán`,
        count: uninvoicedOrders.length,
        samples: uninvoicedOrders.slice(0, 20).map((o) => ({ code: o.code, total: o.total, createdAt: o.createdAt })),
      })
    }

    // b) Phiếu nhập kho 90 ngày qua không kèm hóa đơn mua (note không chứa 'PM')
    const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const orphanImports = await db.stockMovement.findMany({
      where: {
        type: { in: ['IMPORT', 'PURCHASE'] },
        createdAt: { gte: since90 },
        NOT: [{ note: { contains: 'PM' } }],
      },
      include: { product: { select: { name: true, sku: true, costPrice: true } } },
      orderBy: { createdAt: 'desc' },
    })
    if (orphanImports.length > 0) {
      const estimatedValue = orphanImports.reduce((sum, m) => sum + m.product.costPrice * Math.abs(m.quantity), 0)
      issues.push({
        type: 'MOVEMENT_NO_PURCHASE',
        severity: 'warning',
        title: `${orphanImports.length} phiếu nhập kho 90 ngày qua không kèm hóa đơn mua`,
        count: orphanImports.length,
        estimatedValue,
        samples: orphanImports.slice(0, 20).map((m) => ({
          product: m.product.name,
          sku: m.product.sku,
          quantity: m.quantity,
          note: m.note,
          createdAt: m.createdAt,
        })),
      })
    }

    // c) Sản phẩm tồn kho âm
    const negativeStock = await db.product.findMany({
      where: { stock: { lt: 0 } },
      select: { sku: true, name: true, stock: true },
      orderBy: { stock: 'asc' },
    })
    if (negativeStock.length > 0) {
      issues.push({
        type: 'NEGATIVE_STOCK',
        severity: 'error',
        title: `${negativeStock.length} sản phẩm đang tồn kho âm`,
        count: negativeStock.length,
        samples: negativeStock.slice(0, 20),
      })
    }

    // d) Chênh lệch dòng tiền kỳ hiện tại: hóa đơn bán vs đơn hàng COMPLETED
    const year = now.getFullYear()
    const quarter = Math.floor(now.getMonth() / 3) + 1
    const start = new Date(year, (quarter - 1) * 3, 1)
    const end = new Date(year, quarter * 3, 1)
    const [salesAgg, ordersAgg] = await Promise.all([
      db.salesInvoice.aggregate({
        where: { status: 'POSTED', invoiceDate: { gte: start, lt: end } },
        _sum: { total: true },
        _count: true,
      }),
      db.order.aggregate({
        where: { status: 'COMPLETED', createdAt: { gte: start, lt: end } },
        _sum: { subtotal: true },
        _count: true,
      }),
    ])
    const salesTotal = salesAgg._sum.total ?? 0
    const ordersSubtotal = ordersAgg._sum.subtotal ?? 0
    const diff = Math.abs(salesTotal - ordersSubtotal)
    const biggest = Math.max(Math.abs(salesTotal), Math.abs(ordersSubtotal))
    if (biggest > 0 && diff > biggest * 0.05 && diff > 100000) {
      issues.push({
        type: 'CASH_MISMATCH',
        severity: 'warning',
        title: `Dòng tiền Q${quarter}/${year} lệch ${formatVND(diff)} giữa hóa đơn bán (${formatVND(salesTotal)}) và đơn hàng COMPLETED (${formatVND(ordersSubtotal)})`,
        count: 1,
        samples: [
          {
            period: `Q${quarter}/${year}`,
            salesTotal,
            salesInvoiceCount: salesAgg._count,
            ordersSubtotal,
            completedOrderCount: ordersAgg._count,
            diff,
          },
        ],
      })
    }

    const ok = issues.length === 0
    const summary = ok
      ? 'Đối soát 4 phép hoàn tất — không phát hiện lệch dữ liệu.'
      : `Phát hiện ${issues.length} nhóm vấn đề: ${issues.map((i) => i.title).join('; ')}.`

    return NextResponse.json({ checkedAt: now.toISOString(), ok, issues, summary })
  } catch (error) {
    console.error('Reconciliation GET error:', error)
    return NextResponse.json({ error: 'Không thể chạy đối soát' }, { status: 500 })
  }
}
