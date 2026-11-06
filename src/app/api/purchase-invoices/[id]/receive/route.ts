import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { getAllUnitConfigs, syncLinkedVariantStocks } from '@/lib/unit-conversion'
import { syncCombosUsingComponents } from '@/lib/combo'

export const dynamic = 'force-dynamic'

interface ReceiveItemInput {
  productId: string
  receivedQuantity: number
  conversionRate?: number
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as { items?: ReceiveItemInput[] }
    const items = body.items ?? []

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Danh sách nhận hàng không được để trống' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUnique({
        where: { id },
        include: {
          items: true,
          partner: true,
        },
      })
      if (!invoice) throw new Error('Không tìm thấy đơn đặt hàng mua')

      const unitConfigs = await getAllUnitConfigs(tx)
      const receivedProductIds: string[] = []

      for (const item of items) {
        const rawQty = Number(item.receivedQuantity)
        if (!rawQty || rawQty <= 0) continue

        const product = await tx.product.findUnique({ where: { id: item.productId } })
        if (!product) throw new Error(`Sản phẩm ${item.productId} không tồn tại`)

        const uCfg = unitConfigs[item.productId]
        const rate = item.conversionRate && item.conversionRate > 0 ? item.conversionRate : (uCfg?.purchaseRate && uCfg.purchaseRate > 1 ? uCfg.purchaseRate : 1)
        const qty = Math.round(rawQty * rate)
        const noteSuffix =
          rate > 1
            ? ` (Nhận ${rawQty} ${uCfg?.purchaseUnit || ''} × ${rate} = +${qty} ${uCfg?.baseUnit || product.unit})`
            : ''

        const stockAfter = product.stock + qty
        await tx.product.update({
          where: { id: item.productId },
          data: { stock: stockAfter },
        })

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'IMPORT',
            quantity: qty,
            stockAfter,
            note: `Nhận hàng đơn PO ${invoice.code}${noteSuffix}`,
          },
        })
        receivedProductIds.push(item.productId)
      }

      if (receivedProductIds.length > 0) {
        await syncCombosUsingComponents(tx, receivedProductIds)
        await syncLinkedVariantStocks(tx, receivedProductIds)
      }

      // Đánh giá trạng thái nhận hàng của PO
      const allMovements = await tx.stockMovement.findMany({
        where: {
          type: 'IMPORT',
          note: { contains: invoice.code },
        },
      })
      const totalReceived = allMovements.reduce((sum, m) => sum + m.quantity, 0)
      const totalOrdered = invoice.items.reduce((sum, it) => sum + it.quantity, 0)

      const nextStatus = totalReceived >= totalOrdered ? 'POSTED' : 'PARTIALLY_RECEIVED'

      const updated = await tx.purchaseInvoice.update({
        where: { id },
        data: { status: nextStatus },
        include: {
          partner: true,
          items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
        },
      })

      return { invoice: updated, totalReceived, totalOrdered }
    })

    await recordLineageChange({
      scope: 'INVOICE',
      action: 'PURCHASE_RECEIVED',
      actor: 'OPERATOR',
      actorName: 'Người vận hành kho',
      originSource: 'MANUAL_ADMIN',
      entityType: 'PurchaseInvoice',
      entityId: id,
      entityCode: result.invoice.code,
      title: `Nhận hàng PO ${result.invoice.code} (${result.totalReceived}/${result.totalOrdered})`,
      after: { status: result.invoice.status, totalReceived: result.totalReceived },
    })

    broadcast('settings.updated', { reason: 'purchase_receive' })

    return NextResponse.json({ success: true, invoice: result.invoice })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi nhận hàng PO'
    console.error('Purchase invoice receive error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
