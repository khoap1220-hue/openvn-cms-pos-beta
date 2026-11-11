import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'
import { dispatchWebhook } from '@/lib/webhook-service'
import type { CrossSellSettlement } from '@/lib/types'

let seedPromise: Promise<void> | null = null
let warehousesSeededDone = false
let cachedDefaultWarehouseId: string | null = null

export async function ensureWarehousesAndVouchersSeeded(): Promise<void> {
  if (warehousesSeededDone) return
  if (seedPromise) {
    await seedPromise
    return
  }

  seedPromise = (async () => {
    try {
      const whCount = await db.warehouse.count()
      if (whCount === 0) {
        const central = await db.warehouse.create({
          data: {
            code: 'KHO-TRUNG-TAM',
            name: 'Kho Trung Tâm',
            type: 'INTERNAL',
            address: 'TP.HCM',
            phone: '',
            managerName: 'Quản kho',
            commissionPct: 0,
            isDefault: true,
            active: true,
          },
        })
        cachedDefaultWarehouseId = central.id

        const products = await db.product.findMany({
          where: { type: 'SIMPLE' },
        })
        for (const p of products) {
          await db.product.update({
            where: { id: p.id },
            data: { ownerWarehouseId: central.id, crossSellRate: null },
          })
          await db.warehouseStock.upsert({
            where: { warehouseId_productId: { warehouseId: central.id, productId: p.id } },
            update: { quantity: Math.max(0, p.stock) },
            create: { warehouseId: central.id, productId: p.id, quantity: Math.max(0, p.stock) },
          })
        }
      }
      warehousesSeededDone = true
    } catch (e) {
      console.error('ensureWarehousesAndVouchersSeeded error:', e)
    } finally {
      seedPromise = null
    }
  })()

  await seedPromise
}

export async function getDefaultWarehouseId(): Promise<string | null> {
  if (cachedDefaultWarehouseId) return cachedDefaultWarehouseId
  await ensureWarehousesAndVouchersSeeded()
  const defaultWh = await db.warehouse.findFirst({
    where: { isDefault: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (defaultWh?.id) cachedDefaultWarehouseId = defaultWh.id
  return cachedDefaultWarehouseId
}

/**
 * Đảm bảo tổng tồn kho chi tiết (`WarehouseStock`) của 1 sản phẩm khớp với `Product.stock`.
 * Nếu lệch (ví dụ sản phẩm mới tạo hoặc vừa nhập/xuất trực tiếp), tự động bù vào kho mặc định.
 */
export async function syncProductWarehouseStock(
  productId: string,
  preferredWarehouseId?: string | null
): Promise<void> {
  await ensureWarehousesAndVouchersSeeded()

  const product = await db.product.findUnique({
    where: { id: productId },
    include: { warehouseStocks: true },
  })
  if (!product || product.type === 'COMBO') return

  const sumWarehouse = product.warehouseStocks.reduce((s, ws) => s + ws.quantity, 0)
  const delta = product.stock - sumWarehouse
  if (delta === 0) return

  let targetWarehouseId = preferredWarehouseId
  if (!targetWarehouseId) {
    targetWarehouseId = (await getDefaultWarehouseId()) ?? product.warehouseStocks[0]?.warehouseId
  }
  if (!targetWarehouseId) return

  if (delta > 0) {
    const existing = product.warehouseStocks.find((ws) => ws.warehouseId === targetWarehouseId)
    await db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: targetWarehouseId, productId } },
      update: { quantity: (existing?.quantity ?? 0) + delta },
      create: { warehouseId: targetWarehouseId, productId, quantity: delta },
    })
  } else {
    // Cần trừ bớt Math.abs(delta), ưu tiên trừ từ targetWarehouseId rồi đến các kho khác
    let remainingToSubtract = Math.abs(delta)
    const orderedStocks = [...product.warehouseStocks].sort((a, b) => {
      if (a.warehouseId === targetWarehouseId) return -1
      if (b.warehouseId === targetWarehouseId) return 1
      return b.quantity - a.quantity
    })

    for (const ws of orderedStocks) {
      if (remainingToSubtract <= 0) break
      const take = Math.min(ws.quantity, remainingToSubtract)
      if (take > 0) {
        await db.warehouseStock.update({
          where: { id: ws.id },
          data: { quantity: ws.quantity - take },
        })
        remainingToSubtract -= take
      }
    }
  }
}

/**
 * Điều chuyển hàng hóa giữa 2 Kho / Shop liên kết (`Kho A ➔ Kho B`)
 * Tổng tồn `Product.stock` giữ nguyên, tồn từng kho cập nhật tức thì + ghi Sổ Data.
 */
export async function transferStockBetweenWarehouses(params: {
  productId: string
  fromWarehouseId: string
  toWarehouseId: string
  quantity: number
  note?: string
}): Promise<{
  productId: string
  sku: string
  productName: string
  fromWarehouseName: string
  toWarehouseName: string
  quantity: number
  fromAfter: number
  toAfter: number
}> {
  const { productId, fromWarehouseId, toWarehouseId, quantity, note } = params
  if (!productId || !fromWarehouseId || !toWarehouseId) {
    throw new Error('Vui lòng chọn đầy đủ Sản phẩm, Kho xuất và Kho nhận.')
  }
  if (fromWarehouseId === toWarehouseId) {
    throw new Error('Kho xuất và Kho nhận phải khác nhau.')
  }
  const qty = Math.floor(Number(quantity) || 0)
  if (qty <= 0) {
    throw new Error('Số lượng điều chuyển phải lớn hơn 0.')
  }

  await syncProductWarehouseStock(productId, fromWarehouseId)

  const [product, fromWh, toWh, fromStockRow, toStockRow] = await Promise.all([
    db.product.findUnique({ where: { id: productId } }),
    db.warehouse.findUnique({ where: { id: fromWarehouseId } }),
    db.warehouse.findUnique({ where: { id: toWarehouseId } }),
    db.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: fromWarehouseId, productId } },
    }),
    db.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: toWarehouseId, productId } },
    }),
  ])

  if (!product) throw new Error('Không tìm thấy sản phẩm.')
  if (product.type === 'COMBO') {
    throw new Error('Sản phẩm Combo tính tồn từ nguyên liệu BOM, vui lòng điều chuyển trên sản phẩm thành phần.')
  }
  if (!fromWh || !toWh) throw new Error('Không tìm thấy kho xuất hoặc kho nhận.')

  const currentFromQty = fromStockRow?.quantity ?? 0
  if (currentFromQty < qty) {
    throw new Error(
      `${fromWh.name} chỉ còn ${currentFromQty} ${product.unit || 'SP'}, không đủ để điều chuyển ${qty}.`
    )
  }

  const fromAfter = currentFromQty - qty
  const currentToQty = toStockRow?.quantity ?? 0
  const toAfter = currentToQty + qty

  await db.$transaction([
    db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: fromWarehouseId, productId } },
      update: { quantity: fromAfter },
      create: { warehouseId: fromWarehouseId, productId, quantity: fromAfter },
    }),
    db.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: toWarehouseId, productId } },
      update: { quantity: toAfter },
      create: { warehouseId: toWarehouseId, productId, quantity: toAfter },
    }),
    db.stockMovement.create({
      data: {
        productId,
        warehouseId: fromWarehouseId,
        type: 'EXPORT',
        quantity: -qty,
        stockAfter: product.stock,
        note: `Điều chuyển kho [${fromWh.code} ➔ ${toWh.code}]: Xuất ${qty} SP${note ? ` (${note.trim()})` : ''}`,
      },
    }),
    db.stockMovement.create({
      data: {
        productId,
        warehouseId: toWarehouseId,
        type: 'IMPORT',
        quantity: qty,
        stockAfter: product.stock,
        note: `Điều chuyển kho [${fromWh.code} ➔ ${toWh.code}]: Nhập ${qty} SP${note ? ` (${note.trim()})` : ''}`,
      },
    }),
  ])

  await recordLineageChange({
    scope: 'INVENTORY',
    action: 'WAREHOUSE_TRANSFER',
    entityType: 'Product',
    entityId: product.id,
    entityCode: product.sku,
    title: `Điều chuyển ${qty} × ${product.sku} từ ${fromWh.name} sang ${toWh.name}`,
    actor: 'OPERATOR',
    actorName: 'Quản kho Ưu Đàm',
    originSource: 'MANUAL_ADMIN',
    sourceRefCode: `${fromWh.code}->${toWh.code}`,
    before: { [fromWh.code]: currentFromQty, [toWh.code]: currentToQty, totalStock: product.stock },
    after: { [fromWh.code]: fromAfter, [toWh.code]: toAfter, totalStock: product.stock },
    detail: { quantity: qty, note: note ?? null },
  })

  dispatchWebhook('warehouse.transfer', {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    fromWarehouseCode: fromWh.code,
    fromWarehouseName: fromWh.name,
    toWarehouseCode: toWh.code,
    toWarehouseName: toWh.name,
    quantity: qty,
    fromAfter,
    toAfter,
    note: note ?? null,
  })
  broadcast('inventory.updated', {
    productId: product.id,
    sku: product.sku,
    fromWarehouseId,
    toWarehouseId,
    quantity: qty,
  })

  return {
    productId: product.id,
    sku: product.sku,
    productName: product.name,
    fromWarehouseName: fromWh.name,
    toWarehouseName: toWh.name,
    quantity: qty,
    fromAfter,
    toAfter,
  }
}

/**
 * Ghi nhận Phiếu Quyết toán Công nợ Bán chéo (`CROSS_SELL_SETTLED`) với Shop Liên kết
 */
export async function settlePartnerCrossSell(params: {
  warehouseId: string
  note?: string
}): Promise<{
  settlementCode: string
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  grossRevenue: number
  commissionAmount: number
  netPayableToPartner: number
  settledAt: string
}> {
  const { warehouseId, note } = params
  if (!warehouseId) throw new Error('Thiếu mã Shop liên kết để quyết toán.')

  const settlements = await computeCrossSellSettlements()
  const target = settlements.find((s) => s.warehouseId === warehouseId)
  if (!target) {
    throw new Error('Không tìm thấy dữ liệu đối soát cho Shop liên kết này.')
  }

  const settlementCode = `QT-${target.code}-${Date.now().toString().slice(-4)}`
  const settledAt = new Date().toISOString()

  await recordLineageChange({
    scope: 'INVOICE',
    action: 'CROSS_SELL_SETTLED',
    entityType: 'Warehouse',
    entityId: target.warehouseId,
    entityCode: settlementCode,
    sourceRefCode: target.code,
    title: `Quyết toán công nợ bán chéo ${target.name}: thực trả ${target.netPayableToPartner.toLocaleString('vi-VN')}đ (Hoa hồng OPENVN: ${target.commissionAmount.toLocaleString('vi-VN')}đ)`,
    actor: 'OPERATOR',
    actorName: 'Kế toán OPENVN',
    originSource: 'MANUAL_ADMIN',
    after: {
      settlementCode,
      partnerShopCode: target.code,
      unitsSold: target.unitsSold,
      grossRevenue: target.grossRevenue,
      commissionAmount: target.commissionAmount,
      netPayableToPartner: target.netPayableToPartner,
    },
    detail: { note: note ?? 'Quyết toán định kỳ Liên Shop' },
  })

  dispatchWebhook('alliance.settlement.recorded', {
    settlementCode,
    partnerShopCode: target.code,
    partnerShopName: target.name,
    unitsSold: target.unitsSold,
    grossRevenue: target.grossRevenue,
    commissionPct: target.commissionPct,
    commissionAmount: target.commissionAmount,
    netPayableToPartner: target.netPayableToPartner,
    settledAt,
  })

  return {
    settlementCode,
    warehouseId: target.warehouseId,
    warehouseCode: target.code,
    warehouseName: target.name,
    grossRevenue: target.grossRevenue,
    commissionAmount: target.commissionAmount,
    netPayableToPartner: target.netPayableToPartner,
    settledAt,
  }
}

/**
 * Tính toán Bảng Đối soát Hoa hồng Bán chéo giữa các Shop liên kết (`PARTNER_SHOP`)
 */
export async function computeCrossSellSettlements(): Promise<CrossSellSettlement[]> {
  await ensureWarehousesAndVouchersSeeded()

  const [partnerWarehouses, products, orders] = await Promise.all([
    db.warehouse.findMany({
      where: { type: 'PARTNER_SHOP', active: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.product.findMany({
      include: {
        bomFinished: {
          include: { componentProduct: true },
        },
      },
    }),
    db.order.findMany({
      where: { status: { not: 'CANCELLED' } },
      include: { items: true },
    }),
  ])

  const productById = new Map(products.map((p) => [p.id, p]))

  return partnerWarehouses.map((wh) => {
    const productStatsMap = new Map<
      string,
      { productId: string; sku: string; name: string; unitsSold: number; revenue: number; commissionAmount: number }
    >()

    for (const order of orders) {
      for (const item of order.items) {
        const prod = productById.get(item.productId)
        if (!prod) continue

        if (prod.type === 'COMBO' && prod.bomFinished.length > 0) {
          // Nếu bán Combo có chứa sản phẩm của Shop liên kết, phân bổ doanh thu theo tỷ trọng giá bán lẻ thành phần
          const totalComponentRetail = prod.bomFinished.reduce(
            (sum, comp) => sum + comp.componentProduct.sellPrice * comp.quantity,
            0
          )
          for (const comp of prod.bomFinished) {
            const compProd = comp.componentProduct
            if (compProd.ownerWarehouseId !== wh.id) continue

            const compUnits = Math.round(item.quantity * comp.quantity)
            const weight =
              totalComponentRetail > 0
                ? (compProd.sellPrice * comp.quantity) / totalComponentRetail
                : 1 / prod.bomFinished.length
            const allocatedRevenue = Math.round(item.price * item.quantity * weight)
            const rate = compProd.crossSellRate ?? wh.commissionPct
            const comm = Math.round((allocatedRevenue * rate) / 100)

            const current = productStatsMap.get(compProd.id) ?? {
              productId: compProd.id,
              sku: compProd.sku,
              name: `${compProd.name} (trong Combo)`,
              unitsSold: 0,
              revenue: 0,
              commissionAmount: 0,
            }
            current.unitsSold += compUnits
            current.revenue += allocatedRevenue
            current.commissionAmount += comm
            productStatsMap.set(compProd.id, current)
          }
        } else if (prod.ownerWarehouseId === wh.id) {
          const lineRevenue = Math.round(item.price * item.quantity)
          const rate = prod.crossSellRate ?? wh.commissionPct
          const comm = Math.round((lineRevenue * rate) / 100)

          const current = productStatsMap.get(prod.id) ?? {
            productId: prod.id,
            sku: prod.sku,
            name: prod.name,
            unitsSold: 0,
            revenue: 0,
            commissionAmount: 0,
          }
          current.unitsSold += item.quantity
          current.revenue += lineRevenue
          current.commissionAmount += comm
          productStatsMap.set(prod.id, current)
        }
      }
    }

    const productRows = Array.from(productStatsMap.values()).sort((a, b) => b.revenue - a.revenue)
    const unitsSold = productRows.reduce((s, r) => s + r.unitsSold, 0)
    const grossRevenue = productRows.reduce((s, r) => s + r.revenue, 0)
    const commissionAmount = productRows.reduce((s, r) => s + r.commissionAmount, 0)
    const netPayableToPartner = Math.max(0, grossRevenue - commissionAmount)

    return {
      warehouseId: wh.id,
      code: wh.code,
      name: wh.name,
      managerName: wh.managerName,
      commissionPct: wh.commissionPct,
      unitsSold,
      grossRevenue,
      commissionAmount,
      netPayableToPartner,
      products: productRows,
    }
  })
}

/**
 * Tính số tiền giảm của một Mã Voucher dựa trên tạm tính & phí ship
 */
export function calculateVoucherDiscount(
  voucher: {
    discountType: string
    discountValue: number
    maxDiscount?: number | null
    minOrderAmount: number
    usageLimit?: number | null
    usedCount: number
    active: boolean
    expiresAt?: Date | string | null
  },
  subtotal: number,
  shippingFee: number
): { valid: boolean; discountAmount: number; reason?: string } {
  if (!voucher.active) {
    return { valid: false, discountAmount: 0, reason: 'Mã giảm giá đang tạm ngưng.' }
  }
  if (voucher.expiresAt && new Date(voucher.expiresAt).getTime() < Date.now()) {
    return { valid: false, discountAmount: 0, reason: 'Mã giảm giá đã hết hạn.' }
  }
  if (voucher.usageLimit !== null && voucher.usageLimit !== undefined && voucher.usedCount >= voucher.usageLimit) {
    return { valid: false, discountAmount: 0, reason: 'Mã giảm giá đã hết lượt sử dụng.' }
  }
  if (subtotal < voucher.minOrderAmount) {
    return {
      valid: false,
      discountAmount: 0,
      reason: `Đơn tối thiểu ${voucher.minOrderAmount.toLocaleString('vi-VN')}đ (thiếu ${(voucher.minOrderAmount - subtotal).toLocaleString('vi-VN')}đ).`,
    }
  }

  let discount = 0
  if (voucher.discountType === 'PERCENT') {
    discount = Math.round((subtotal * voucher.discountValue) / 100)
    if (voucher.maxDiscount && voucher.maxDiscount > 0) {
      discount = Math.min(discount, voucher.maxDiscount)
    }
  } else if (voucher.discountType === 'FIXED') {
    discount = Math.min(subtotal, Math.round(voucher.discountValue))
  } else if (voucher.discountType === 'FREESHIP') {
    discount = Math.min(shippingFee > 0 ? shippingFee : 30000, Math.round(voucher.discountValue))
  }

  return { valid: true, discountAmount: Math.max(0, discount) }
}
