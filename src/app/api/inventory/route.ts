import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import type { PeriodRange } from '@/lib/lineage'
import { resolvePeriodRange } from '@/lib/lineage'

export const dynamic = 'force-dynamic'

function originFromNote(note?: string | null): string {
  const n = (note ?? '').toLowerCase()
  if (n.includes('tồn đầu kỳ') || n.includes('seed')) return 'SYSTEM_SEED'
  if (n.includes('đơn dh') || n.includes('combo') || n.includes('hóa đơn')) return 'AGENT_AUTOPILOT'
  return 'MANUAL_ADMIN'
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const view = searchParams.get('view') || 'movements'
    const productId = searchParams.get('productId')

    if (view === 'lowstock') {
      const products = await db.product.findMany({
        where: { stock: { lte: db.product.fields.lowStockThreshold } },
        orderBy: { stock: 'asc' },
        select: { id: true, sku: true, name: true, stock: true, lowStockThreshold: true, sellPrice: true },
      })
      return NextResponse.json({ products })
    }

    // ===== Bộ lọc kỳ kế toán: movements trong khoảng + Đối chiếu Đầu kỳ → Trong kỳ → Cuối kỳ =====
    const period: PeriodRange = {
      preset: (searchParams.get('preset') as PeriodRange['preset']) || 'ALL',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }
    const { fromDate, toDate } = resolvePeriodRange(period)

    const movWhere: Record<string, unknown> = {}
    if (productId) movWhere.productId = productId
    if (fromDate || toDate) {
      const created: Record<string, Date> = {}
      if (fromDate) created.gte = fromDate
      if (toDate) created.lt = toDate
      movWhere.createdAt = created
    }

    const [movements, periodMoves] = await Promise.all([
      db.stockMovement.findMany({
        where: movWhere,
        orderBy: { createdAt: 'desc' },
        take: productId ? 200 : 120,
        include: { product: { select: { id: true, sku: true, name: true, stock: true } } },
      }),
      // Toàn bộ movement của phạm vi đang xét (tất cả hoặc 1 SP) để dựng đối chiếu kỳ
      db.stockMovement.findMany({
        where: productId ? { productId } : {},
        orderBy: { createdAt: 'asc' },
        select: { quantity: true, type: true, createdAt: true },
      }),
    ])

    // Tồn hiện tại theo phạm vi (1 SP hoặc tổng tất cả SP SIMPLE + thành phần)
    const currentStock = productId
      ? (await db.product.findUnique({ where: { id: productId }, select: { stock: true } }))?.stock ?? 0
      : (await db.product.aggregate({ _sum: { stock: true } }))._sum.stock ?? 0

    const inRange = (d: Date) => (!fromDate || d >= fromDate) && (!toDate || d < toDate)
    const inPeriodMoves = periodMoves.filter((m) => inRange(m.createdAt))
    const afterToMoves = toDate ? periodMoves.filter((m) => m.createdAt >= toDate) : []

    // Tồn cuối kỳ = tồn hiện tại − Σ(biến động SAU toDate); Tồn đầu kỳ = cuối kỳ − Σ(trong kỳ)
    const afterToDelta = afterToMoves.reduce((s, m) => s + m.quantity, 0)
    const closing = currentStock - afterToDelta
    const inPeriodDelta = inPeriodMoves.reduce((s, m) => s + m.quantity, 0)
    const opening = closing - inPeriodDelta
    const importQty = inPeriodMoves.filter((m) => m.type === 'IMPORT').reduce((s, m) => s + m.quantity, 0)
    // Xuất/ĐC trong kỳ: xuất kho + trừ thành phần combo (COMBO_ISSUE) — mọi biến động âm không phải điều chỉnh
    const exportQty = Math.abs(
      inPeriodMoves.filter((m) => m.type === 'EXPORT' || m.type === 'COMBO_ISSUE').reduce((s, m) => s + m.quantity, 0)
    )
    const adjustQty = inPeriodMoves.filter((m) => m.type === 'ADJUST').reduce((s, m) => s + m.quantity, 0)

    // Gắn nguồn gốc suy luận cho từng dòng movement (hiển thị badge trên UI)
    const movementsWithOrigin = movements.map((m) => ({ ...m, originSource: originFromNote(m.note) }))

    return NextResponse.json({
      movements: movementsWithOrigin,
      period: {
        opening,
        importQty,
        exportQty,
        adjustQty,
        closing,
        movementCount: inPeriodMoves.length,
        fromDate: fromDate?.toISOString() ?? null,
        toDate: toDate?.toISOString() ?? null,
      },
    })
  } catch (error) {
    console.error('Inventory GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu kho' }, { status: 500 })
  }
}

// POST: nhập / xuất / điều chỉnh tồn kho
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { productId, type, quantity, note } = body

    if (!productId || !type) return NextResponse.json({ error: 'Thiếu thông tin sản phẩm hoặc loại thao tác' }, { status: 400 })
    if (!['IMPORT', 'EXPORT', 'ADJUST'].includes(type)) {
      return NextResponse.json({ error: 'Loại thao tác không hợp lệ' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })

    let newStock: number
    let movementQty: number

    if (type === 'IMPORT') {
      movementQty = Math.abs(Number(quantity) || 0)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      newStock = product.stock + movementQty
    } else if (type === 'EXPORT') {
      movementQty = Math.abs(Number(quantity) || 0)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      if (product.stock < movementQty) {
        return NextResponse.json({ error: `Chỉ còn ${product.stock} trong kho, không thể xuất ${movementQty}` }, { status: 400 })
      }
      newStock = product.stock - movementQty
      movementQty = -movementQty
    } else {
      // ADJUST: quantity là số lượng tồn mới (tuyệt đối)
      newStock = Number(quantity)
      if (Number.isNaN(newStock) || newStock < 0) return NextResponse.json({ error: 'Số lượng tồn mới không hợp lệ' }, { status: 400 })
      movementQty = newStock - product.stock
    }

    const finalNote = note?.trim() || (type === 'IMPORT' ? 'Nhập kho' : type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kiểm kê')
    await db.product.update({ where: { id: productId }, data: { stock: newStock } })
    const movement = await db.stockMovement.create({
      data: {
        productId,
        type,
        quantity: movementQty,
        stockAfter: newStock,
        note: finalNote,
      },
      include: { product: { select: { id: true, sku: true, name: true, stock: true } } },
    })

    // Sổ Data: biến động kho — chụp lineage Tồn trước → Tồn sau
    const action = type === 'IMPORT' ? 'STOCK_IMPORT' : type === 'EXPORT' ? 'STOCK_EXPORT' : 'STOCK_ADJUST'
    const qtyText = movementQty >= 0 ? `+${movementQty}` : `${movementQty}`
    const actionLabel = type === 'IMPORT' ? 'Nhập kho' : type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kho'
    await recordLineageChange({
      scope: 'INVENTORY',
      action,
      entityType: 'Product',
      entityId: productId,
      entityCode: product.sku,
      title: `${actionLabel} ${product.sku} ${qtyText}`,
      before: { stock: product.stock },
      after: { stock: newStock },
      actor: 'OPERATOR',
      actorName: 'Người vận hành',
      originSource: 'MANUAL_ADMIN',
      sourceRefCode: finalNote,
      detail: { stockAfter: newStock, quantity: movementQty, note: finalNote },
    })

    // Webhook outbound: biến động tồn kho
    dispatchWebhook('stock.movement', { productId, sku: product.sku, type, quantity: movementQty, stockAfter: newStock })

    return NextResponse.json({ movement }, { status: 201 })
  } catch (error) {
    console.error('Inventory POST error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật kho' }, { status: 500 })
  }
}
