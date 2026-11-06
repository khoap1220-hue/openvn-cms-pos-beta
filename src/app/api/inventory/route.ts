import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import { syncCombosUsingComponents } from '@/lib/combo'
import { syncProductWarehouseStock } from '@/lib/warehouse-service'
import { getAllUnitConfigs, getProductUnitConfig, syncLinkedVariantStocks } from '@/lib/unit-conversion'
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

// POST: nhập / xuất / điều chỉnh tồn kho (Hỗ trợ cả đơn lẻ và Phiếu Nhập/Xuất/Kiểm kê Hàng Loạt chuẩn POS)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ===== CHẾ ĐỘ PHIẾU NHẬP KHO / SẢN XUẤT / XUẤT KHO / KIỂM KÊ THEO LÔ =====
    if (Array.isArray(body.items) && body.items.length > 0) {
      const batchType = String(body.type || body.mode || 'IMPORT').toUpperCase()
      if (!['IMPORT', 'PRODUCTION', 'EXPORT', 'ADJUST'].includes(batchType)) {
        return NextResponse.json({ error: 'Loại phiếu kho không hợp lệ' }, { status: 400 })
      }
      const warehouseId = body.warehouseId ? String(body.warehouseId) : null
      const supplierName = body.supplierName ? String(body.supplierName).trim() : ''
      const batchNote = body.note ? String(body.note).trim() : ''
      const prefix =
        batchType === 'IMPORT'
          ? 'PNK'
          : batchType === 'PRODUCTION'
            ? 'LSX'
            : batchType === 'EXPORT'
              ? 'PXK'
              : 'PKK'
      const batchCode = `${prefix}-${Date.now().toString(36).toUpperCase()}`

      const unitMap = await getAllUnitConfigs()
      const productIds: string[] = Array.from(
        new Set<string>(
          (body.items as Array<{ productId?: string }>)
            .map((it) => String(it.productId || ''))
            .filter((id): id is string => id.length > 0)
        )
      )
      const products = await db.product.findMany({ where: { id: { in: productIds } } })
      const prodById = new Map(products.map((p) => [p.id, p]))

      // ===== XỬ LÝ RIÊNG CHO PHIẾU SẢN XUẤT (TRỪ NGUYÊN VẬT LIỆU BOM ➔ CỘNG THÀNH PHẨM) =====
      if (batchType === 'PRODUCTION') {
        const bomRows = await db.bomComponent.findMany({
          where: { productId: { in: productIds } },
          include: {
            componentProduct: true,
          },
        })
        const bomByProduct = new Map<string, typeof bomRows>()
        for (const b of bomRows) {
          const list = bomByProduct.get(b.productId) ?? []
          list.push(b)
          bomByProduct.set(b.productId, list)
        }

        // Tổng hợp nhu cầu Nguyên vật liệu tiêu hao
        const materialDemands = new Map<
          string,
          {
            componentId: string
            requiredQty: number
            usedForLabels: string[]
          }
        >()

        for (const rawItem of body.items) {
          const pid = String(rawItem.productId || '')
          const prod = prodById.get(pid)
          if (!prod) {
            return NextResponse.json({ error: `Không tìm thấy thành phẩm ID ${pid}` }, { status: 404 })
          }
          if (prod.type === 'COMBO') {
            return NextResponse.json(
              { error: `"${prod.name}" là bộ Combo tự gộp — vui lòng chọn thành phẩm sản xuất.` },
              { status: 400 }
            )
          }
          const qty = Math.round(Math.abs(Number(rawItem.quantity) || 0))
          if (qty <= 0) {
            return NextResponse.json({ error: `Số lượng sản xuất của "${prod.name}" phải lớn hơn 0` }, { status: 400 })
          }

          const prodBoms = bomByProduct.get(pid) ?? []
          for (const b of prodBoms) {
            const need = Math.round(b.quantity * qty)
            if (need <= 0) continue
            const prev = materialDemands.get(b.componentProductId) ?? {
              componentId: b.componentProductId,
              requiredQty: 0,
              usedForLabels: [],
            }
            prev.requiredQty += need
            prev.usedForLabels.push(`${qty} ${prod.unit || 'sp'} ${prod.sku} (${need} ${b.componentProduct.unit || 'đv'})`)
            materialDemands.set(b.componentProductId, prev)
          }
        }

        // Cho phép ghi đè số lượng nguyên vật liệu thực tế từ client nếu có gửi customMaterials
        if (Array.isArray(body.customMaterials) && body.customMaterials.length > 0) {
          for (const cm of body.customMaterials as Array<{ componentId?: string; quantity?: number }>) {
            const cid = String(cm.componentId || '')
            const cqty = Math.round(Math.abs(Number(cm.quantity) || 0))
            if (!cid) continue
            if (cqty <= 0) {
              materialDemands.delete(cid)
            } else {
              const existing = materialDemands.get(cid)
              materialDemands.set(cid, {
                componentId: cid,
                requiredQty: cqty,
                usedForLabels: existing?.usedForLabels ?? ['Định lượng tiêu hao thực tế'],
              })
            }
          }
        }

        // Kiểm tra tồn kho Nguyên vật liệu trước khi thực thi
        const matIds = Array.from(materialDemands.keys())
        const matProducts = matIds.length > 0 ? await db.product.findMany({ where: { id: { in: matIds } } }) : []
        const matById = new Map(matProducts.map((m) => [m.id, m]))

        for (const [cid, demand] of materialDemands.entries()) {
          const mat = matById.get(cid)
          if (!mat) {
            return NextResponse.json({ error: `Không tìm thấy nguyên vật liệu ID ${cid}` }, { status: 404 })
          }
          const matUnit = unitMap[cid]?.baseUnit || mat.unit || 'đv'
          if (mat.stock < demand.requiredQty) {
            return NextResponse.json(
              {
                error: `Thiếu nguyên vật liệu "${mat.name}": Tồn kho hiện có ${mat.stock.toLocaleString('vi-VN')} ${matUnit}, cần ${demand.requiredQty.toLocaleString('vi-VN')} ${matUnit} để sản xuất.`,
              },
              { status: 400 }
            )
          }
        }

        const createdMovements: unknown[] = []
        const consumedMaterials: Array<{
          sku: string
          name: string
          unit: string
          consumedQty: number
          stockBefore: number
          stockAfter: number
        }> = []
        const touchedIds: string[] = []
        let totalProducedUnits = 0

        // 1. Trừ tồn kho Nguyên vật liệu tiêu hao
        for (const [cid, demand] of materialDemands.entries()) {
          const mat = matById.get(cid)!
          const matUnit = unitMap[cid]?.baseUnit || mat.unit || 'đv'
          const beforeStock = mat.stock
          const afterStock = Math.max(0, beforeStock - demand.requiredQty)

          await db.product.update({
            where: { id: cid },
            data: { stock: afterStock },
          })
          mat.stock = afterStock
          await syncProductWarehouseStock(cid, warehouseId)

          const matNote = `[${batchCode}] Xuất NVL sản xuất (${demand.usedForLabels.join(', ')})${batchNote ? ` · ${batchNote}` : ''}`
          const mov = await db.stockMovement.create({
            data: {
              productId: cid,
              warehouseId,
              type: 'EXPORT',
              quantity: -demand.requiredQty,
              stockAfter: afterStock,
              note: matNote,
            },
            include: { product: { select: { id: true, sku: true, name: true, stock: true, unit: true } } },
          })
          createdMovements.push(mov)
          touchedIds.push(cid)
          consumedMaterials.push({
            sku: mat.sku,
            name: mat.name,
            unit: matUnit,
            consumedQty: demand.requiredQty,
            stockBefore: beforeStock,
            stockAfter: afterStock,
          })

          await recordLineageChange({
            scope: 'INVENTORY',
            action: 'STOCK_EXPORT',
            entityType: 'Product',
            entityId: cid,
            entityCode: mat.sku,
            title: `[${batchCode}] Xuất NVL ${mat.sku} -${demand.requiredQty} ${matUnit}`,
            before: { stock: beforeStock },
            after: { stock: afterStock },
            actor: 'OPERATOR',
            actorName: supplierName || 'Xưởng sản xuất',
            originSource: 'MANUAL_ADMIN',
            sourceRefCode: batchCode,
            detail: { batchCode, stockAfter: afterStock, quantity: -demand.requiredQty, note: matNote },
          })
        }

        // 2. Cộng tồn kho Thành phẩm vừa sản xuất
        for (const rawItem of body.items) {
          const pid = String(rawItem.productId)
          const prod = prodById.get(pid)!
          const rawQty = Math.round(Math.abs(Number(rawItem.quantity) || 0))
          const rate = Math.max(1, Number(rawItem.conversionRate) || 1)
          const producedQty = Math.round(rawQty * rate)
          const baseUnitLabel = unitMap[pid]?.baseUnit || prod.unit || 'sp'
          const beforeStock = prod.stock
          const afterStock = beforeStock + producedQty

          const itemCost = Number(rawItem.costPrice)
          const updateData: { stock: number; costPrice?: number } = { stock: afterStock }
          if (Number.isFinite(itemCost) && itemCost > 0) {
            updateData.costPrice = Math.round(itemCost)
          }

          await db.product.update({ where: { id: pid }, data: updateData })
          prod.stock = afterStock
          await syncProductWarehouseStock(pid, warehouseId)

          const prodBoms = bomByProduct.get(pid) ?? []
          const bomSummary =
            prodBoms.length > 0
              ? ` (Đã trừ NVL: ${prodBoms.map((b) => `${Math.round(b.quantity * producedQty)} ${b.componentProduct.unit || ''} ${b.componentProduct.sku}`).join(' + ')})`
              : ''
          const headerParts = [`[${batchCode}] Nhập thành phẩm sản xuất`]
          if (supplierName) headerParts.push(`Tổ SX: ${supplierName}`)
          if (batchNote) headerParts.push(batchNote)
          if (rawItem.note) headerParts.push(String(rawItem.note).trim())
          const finalNote = `${headerParts.join(' · ')}${bomSummary}`

          const mov = await db.stockMovement.create({
            data: {
              productId: pid,
              warehouseId,
              type: 'IMPORT',
              quantity: producedQty,
              stockAfter: afterStock,
              note: finalNote,
            },
            include: { product: { select: { id: true, sku: true, name: true, stock: true, unit: true } } },
          })
          createdMovements.push(mov)
          touchedIds.push(pid)
          totalProducedUnits += producedQty

          await recordLineageChange({
            scope: 'INVENTORY',
            action: 'STOCK_IMPORT',
            entityType: 'Product',
            entityId: pid,
            entityCode: prod.sku,
            title: `[${batchCode}] Sản xuất ${prod.sku} +${producedQty} ${baseUnitLabel}`,
            before: { stock: beforeStock },
            after: { stock: afterStock },
            actor: 'OPERATOR',
            actorName: supplierName || 'Xưởng sản xuất',
            originSource: 'MANUAL_ADMIN',
            sourceRefCode: batchCode,
            detail: { batchCode, stockAfter: afterStock, quantity: producedQty, note: finalNote },
          })
        }

        await Promise.all([
          syncCombosUsingComponents(db, touchedIds),
          syncLinkedVariantStocks(db, touchedIds),
        ])

        return NextResponse.json(
          {
            batchCode,
            count: body.items.length,
            totalConvertedUnits: totalProducedUnits,
            movements: createdMovements,
            consumedMaterials,
          },
          { status: 201 }
        )
      }

      // Kiểm tra hợp lệ toàn bộ dòng trước khi ghi DB
      for (const rawItem of body.items) {
        const pid = String(rawItem.productId || '')
        const prod = prodById.get(pid)
        if (!prod) {
          return NextResponse.json({ error: `Không tìm thấy sản phẩm ID ${pid}` }, { status: 404 })
        }
        if (prod.type === 'COMBO') {
          return NextResponse.json(
            { error: `Sản phẩm Combo "${prod.name}" tự tính từ thành phần BOM — vui lòng chọn sản phẩm thành phần.` },
            { status: 400 }
          )
        }
        const qty = Number(rawItem.quantity)
        const rate = Math.max(1, Number(rawItem.conversionRate) || unitMap[pid]?.purchaseRate || 1)
        const converted = Math.round(Math.abs(qty) * rate)
        if (batchType !== 'ADJUST' && (!Number.isFinite(qty) || converted <= 0)) {
          return NextResponse.json({ error: `Số lượng của "${prod.name}" phải lớn hơn 0` }, { status: 400 })
        }
        if (batchType === 'EXPORT' && prod.stock < converted) {
          const bUnit = unitMap[pid]?.baseUnit || prod.unit || 'sp'
          return NextResponse.json(
            { error: `"${prod.name}" chỉ còn ${prod.stock} ${bUnit}, không đủ xuất ${converted} ${bUnit}` },
            { status: 400 }
          )
        }
      }

      const createdMovements: unknown[] = []
      const touchedIds: string[] = []
      let totalConvertedUnits = 0

      for (const rawItem of body.items) {
        const pid = String(rawItem.productId)
        const prod = prodById.get(pid)!
        const unitCfg = unitMap[pid]
        const rawQty = Number(rawItem.quantity) || 0
        const explicitRate = Number(rawItem.conversionRate)
        const effectiveRate =
          Number.isFinite(explicitRate) && explicitRate > 0
            ? explicitRate
            : batchType === 'IMPORT' && unitCfg?.purchaseRate
              ? unitCfg.purchaseRate
              : 1
        const inputUnitLabel =
          typeof rawItem.inputUnit === 'string' && rawItem.inputUnit.trim()
            ? rawItem.inputUnit.trim()
            : batchType === 'IMPORT' && unitCfg?.purchaseUnit
              ? unitCfg.purchaseUnit
              : prod.unit || 'sp'
        const baseUnitLabel = unitCfg?.baseUnit || prod.unit || 'sp'

        let newStock: number
        let movementQty: number
        let conversionSuffix = ''

        if (batchType === 'IMPORT') {
          const absInput = Math.abs(rawQty)
          movementQty = Math.round(absInput * effectiveRate)
          newStock = prod.stock + movementQty
          if (effectiveRate > 1) {
            conversionSuffix = ` (Nhập ${absInput} ${inputUnitLabel} × ${effectiveRate} = +${movementQty} ${baseUnitLabel})`
          }
        } else if (batchType === 'EXPORT') {
          const absInput = Math.abs(rawQty)
          movementQty = -Math.round(absInput * effectiveRate)
          newStock = prod.stock + movementQty
          if (effectiveRate > 1) {
            conversionSuffix = ` (Xuất ${absInput} ${inputUnitLabel} × ${effectiveRate} = ${movementQty} ${baseUnitLabel})`
          }
        } else {
          newStock = Math.max(0, Math.round(rawQty * effectiveRate))
          movementQty = newStock - prod.stock
          if (effectiveRate > 1) {
            conversionSuffix = ` (Kiểm kê ${rawQty} ${inputUnitLabel} × ${effectiveRate} = ${newStock} ${baseUnitLabel})`
          }
        }

        const itemCost = Number(rawItem.costPrice)
        const updateData: { stock: number; costPrice?: number } = { stock: newStock }
        if (batchType === 'IMPORT' && Number.isFinite(itemCost) && itemCost > 0) {
          updateData.costPrice = Math.round(itemCost)
        }

        await db.product.update({ where: { id: pid }, data: updateData })
        prod.stock = newStock
        await syncProductWarehouseStock(pid, warehouseId)

        const headerParts = [`[${batchCode}]`]
        if (supplierName) headerParts.push(`NCC: ${supplierName}`)
        if (batchNote) headerParts.push(batchNote)
        if (rawItem.note) headerParts.push(String(rawItem.note).trim())
        const finalNote = `${headerParts.join(' · ')}${conversionSuffix}`

        const mov = await db.stockMovement.create({
          data: {
            productId: pid,
            warehouseId,
            type: batchType,
            quantity: movementQty,
            stockAfter: newStock,
            note: finalNote,
          },
          include: { product: { select: { id: true, sku: true, name: true, stock: true, unit: true } } },
        })
        createdMovements.push(mov)
        touchedIds.push(pid)
        totalConvertedUnits += Math.abs(movementQty)

        const action = batchType === 'IMPORT' ? 'STOCK_IMPORT' : batchType === 'EXPORT' ? 'STOCK_EXPORT' : 'STOCK_ADJUST'
        const qtyText = movementQty >= 0 ? `+${movementQty}` : `${movementQty}`
        await recordLineageChange({
          scope: 'INVENTORY',
          action,
          entityType: 'Product',
          entityId: pid,
          entityCode: prod.sku,
          title: `[${batchCode}] ${prod.sku} ${qtyText} ${baseUnitLabel}`,
          before: { stock: newStock - movementQty },
          after: { stock: newStock },
          actor: 'OPERATOR',
          actorName: 'Thủ kho (POS Kho)',
          originSource: 'MANUAL_ADMIN',
          sourceRefCode: batchCode,
          detail: { batchCode, stockAfter: newStock, quantity: movementQty, note: finalNote },
        })
      }

      await Promise.all([
        syncCombosUsingComponents(db, touchedIds),
        syncLinkedVariantStocks(db, touchedIds),
      ])

      return NextResponse.json(
        {
          batchCode,
          count: createdMovements.length,
          totalConvertedUnits,
          movements: createdMovements,
        },
        { status: 201 }
      )
    }

    const { productId, quantity, note } = body
    const type = String(body.type || body.mode || '').toUpperCase()

    if (!productId || !type) return NextResponse.json({ error: 'Thiếu thông tin sản phẩm hoặc loại thao tác' }, { status: 400 })
    if (!['IMPORT', 'EXPORT', 'ADJUST'].includes(type)) {
      return NextResponse.json({ error: 'Loại thao tác không hợp lệ' }, { status: 400 })
    }

    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })
    if (product.type === 'COMBO') {
      return NextResponse.json(
        { error: 'Sản phẩm Combo tự động tính tồn kho từ thành phần định mức (BOM). Vui lòng nhập/xuất trên sản phẩm thành phần.' },
        { status: 400 }
      )
    }

    const unitCfg = await getProductUnitConfig(productId)
    const rawQty = Number(quantity) || 0
    // Hệ số quy đổi định lượng (VD: nhập 10 kg × 1000 = 10.000 gr)
    const explicitRate = Number(body.conversionRate)
    const effectiveRate =
      Number.isFinite(explicitRate) && explicitRate > 0
        ? explicitRate
        : body.usePurchaseUnit && unitCfg?.purchaseRate
          ? unitCfg.purchaseRate
          : body.useSellUnit && unitCfg?.sellRate
            ? unitCfg.sellRate
            : 1
    const inputUnitLabel =
      typeof body.inputUnit === 'string' && body.inputUnit.trim()
        ? body.inputUnit.trim()
        : body.usePurchaseUnit && unitCfg?.purchaseUnit
          ? unitCfg.purchaseUnit
          : body.useSellUnit && unitCfg?.sellUnit
            ? unitCfg.sellUnit
            : product.unit || 'sp'
    const baseUnitLabel = unitCfg?.baseUnit || product.unit || 'sp'

    let newStock: number
    let movementQty: number
    let conversionNoteSuffix = ''

    if (type === 'IMPORT') {
      const absInput = Math.abs(rawQty)
      movementQty = Math.round(absInput * effectiveRate)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      newStock = product.stock + movementQty
      if (effectiveRate > 1) {
        conversionNoteSuffix = ` (Nhập ${absInput} ${inputUnitLabel} × ${effectiveRate} = +${movementQty} ${baseUnitLabel})`
      }
    } else if (type === 'EXPORT') {
      const absInput = Math.abs(rawQty)
      movementQty = Math.round(absInput * effectiveRate)
      if (movementQty === 0) return NextResponse.json({ error: 'Số lượng phải lớn hơn 0' }, { status: 400 })
      if (product.stock < movementQty) {
        return NextResponse.json(
          { error: `Chỉ còn ${product.stock} ${baseUnitLabel} trong kho, không thể xuất ${movementQty} ${baseUnitLabel}` },
          { status: 400 }
        )
      }
      newStock = product.stock - movementQty
      movementQty = -movementQty
      if (effectiveRate > 1) {
        conversionNoteSuffix = ` (Xuất ${absInput} ${inputUnitLabel} × ${effectiveRate} = -${Math.abs(movementQty)} ${baseUnitLabel})`
      }
    } else {
      // ADJUST: quantity là số lượng tồn mới (tuyệt đối, có thể nhân hệ số quy đổi nếu chọn đơn vị chẵn)
      newStock = Math.round(rawQty * effectiveRate)
      if (Number.isNaN(newStock) || newStock < 0) return NextResponse.json({ error: 'Số lượng tồn mới không hợp lệ' }, { status: 400 })
      movementQty = newStock - product.stock
      if (effectiveRate > 1) {
        conversionNoteSuffix = ` (Kiểm kê ${rawQty} ${inputUnitLabel} × ${effectiveRate} = ${newStock} ${baseUnitLabel})`
      }
    }

    const baseNote = note?.trim() || (type === 'IMPORT' ? 'Nhập kho' : type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kiểm kê')
    const finalNote = `${baseNote}${conversionNoteSuffix}`
    await db.product.update({ where: { id: productId }, data: { stock: newStock } })
    await syncProductWarehouseStock(productId, body.warehouseId ? String(body.warehouseId) : null)
    const movement = await db.stockMovement.create({
      data: {
        productId,
        warehouseId: body.warehouseId ? String(body.warehouseId) : null,
        type,
        quantity: movementQty,
        stockAfter: newStock,
        note: finalNote,
      },
      include: { product: { select: { id: true, sku: true, name: true, stock: true } } },
    })

    // Đồng bộ tồn kho các sản phẩm COMBO và các phân loại đóng gói liên kết có dùng nguyên liệu này
    await Promise.all([
      syncCombosUsingComponents(db, [productId]),
      syncLinkedVariantStocks(db, [productId]),
    ])

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
