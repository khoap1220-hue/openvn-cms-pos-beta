// Service tạo đơn dùng chung cho POS/API + Agent Simulator

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent } from '@/lib/agent-log'
import { logLedgerAsync, recordLineageChangeAsync, inferOriginSource } from '@/lib/ledger'
import { dispatchWebhook } from '@/lib/webhook-service'
import { issueComboComponents, syncComboStock, syncCombosUsingComponents } from '@/lib/combo'
import { adjustPoints, awardPointsForCompletedOrder } from '@/lib/member'
import { getActiveLoyaltyPolicy } from '@/lib/loyalty-policy'
import { friendlyItemsText } from '@/lib/agents'
import {
  calculateVoucherDiscount,
  ensureWarehousesAndVouchersSeeded,
  syncProductWarehouseStock,
} from '@/lib/warehouse-service'
import {
  ensureUnitConversionsSeeded,
  getAllUnitConfigs,
  syncLinkedVariantStocks,
} from '@/lib/unit-conversion'

export interface CreateOrderInput {
  channelId: string
  items: Array<{
    productId: string
    quantity: number
    /** Định lượng quy đổi trừ kho cho 1 đơn vị bán (VD: 500 = 500gr, 1000 = 1kg) */
    unitMultiplier?: number
    /** Nhãn đơn vị bán (VD: '500gr', '1kg') */
    unitLabel?: string
  }>
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  address?: string
  note?: string
  paymentMethod?: string
  /** Kho xuất hàng (mặc định: Kho Trung Tâm Ưu Đàm) */
  warehouseId?: string
  /** Mã giảm giá / Voucher áp dụng */
  voucherCode?: string
  /** Phí vận chuyển tùy chọn (VD: POS nhận hàng trực tiếp tại kho = 0đ) */
  shippingFee?: number
  /** Chiết khấu trực tiếp tại quầy POS (VND) */
  discountAmount?: number
  /** Số điểm hội viên quy đổi tại quầy POS (1 điểm = 1.000đ giảm giá) */
  redeemPoints?: number
  /** POS bán tại kho nhận hàng ngay: tự động hoàn tất đơn (COMPLETED + PAID) & cộng điểm */
  instantComplete?: boolean
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.channelId) throw new Error('Vui lòng chọn kênh bán')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Đơn hàng cần ít nhất 1 sản phẩm')
  }

  const channel = await db.channel.findUnique({ where: { id: input.channelId } })
  if (!channel) throw new Error('Kênh bán không tồn tại')

  await ensureUnitConversionsSeeded()
  const unitConfigs = await getAllUnitConfigs()

  const orderItems: Array<{
    productId: string
    quantity: number
    price: number
    isCombo: boolean
    targetStockProductId: string
    deductBaseQty: number
    unitSummaryNote?: string
  }> = []
  let subtotal = 0
  // (COMBO) gộp nhu cầu thành phần của toàn bộ combo trong đơn + nhu cầu trực tiếp để kiểm tra kho tổng thể 1 lần
  const comboDemands = new Map<string, { required: number; comboNames: Set<string> }>()
  const directDemands = new Map<string, { required: number; name: string; stock: number; baseUnit: string }>()
  const componentStockMap = new Map<string, { name: string; stock: number }>()

  for (const it of input.items) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1))
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) throw new Error('Sản phẩm không tồn tại')
    if (product.status === 'INACTIVE') {
      throw new Error(`Sản phẩm "${product.name}" đã ngừng kinh doanh`)
    }
    const unitCfg = unitConfigs[product.id] ?? null
    const defaultSellRate = Math.max(1, unitCfg?.sellRate || 1)
    const customMultiplier = Number(it.unitMultiplier)
    const effectiveSellRate =
      Number.isFinite(customMultiplier) && customMultiplier > 0 ? Math.round(customMultiplier) : defaultSellRate

    let targetStockProduct = product
    if (unitCfg?.linkedBaseProductId) {
      const baseProd = await db.product.findUnique({ where: { id: unitCfg.linkedBaseProductId } })
      if (baseProd) targetStockProduct = baseProd
    }
    const targetUnitCfg = unitConfigs[targetStockProduct.id] ?? unitCfg
    const baseUnitLabel = targetUnitCfg?.baseUnit || targetStockProduct.unit || 'sp'

    const isCombo = product.type === 'COMBO'
    if (isCombo) {
      const rows = await db.bomComponent.findMany({
        where: { productId: product.id },
        include: { componentProduct: { select: { id: true, name: true, stock: true } } },
      })
      if (rows.length === 0) throw new Error(`Combo "${product.name}" chưa khai báo thành phần ở Định mức`)
      for (const row of rows) {
        const required = Math.round(row.quantity * qty)
        const entry = comboDemands.get(row.componentProductId) ?? { required: 0, comboNames: new Set<string>() }
        entry.required += required
        entry.comboNames.add(product.name)
        comboDemands.set(row.componentProductId, entry)
        componentStockMap.set(row.componentProductId, {
          name: row.componentProduct.name,
          stock: row.componentProduct.stock,
        })
        if (row.componentProduct.stock < entry.required) {
          throw new Error(`Combo "${product.name}" không thể đóng — "${row.componentProduct.name}" chỉ còn ${row.componentProduct.stock} (cần ${entry.required})`)
        }
      }
    } else {
      const deductBaseQty = Math.round(qty * effectiveSellRate)
      const prevDirect = directDemands.get(targetStockProduct.id)?.required ?? 0
      const nextDirect = prevDirect + deductBaseQty
      directDemands.set(targetStockProduct.id, {
        required: nextDirect,
        name: targetStockProduct.name,
        stock: targetStockProduct.stock,
        baseUnit: baseUnitLabel,
      })
      if (targetStockProduct.stock < nextDirect) {
        throw new Error(
          `Kho "${targetStockProduct.name}" chỉ còn ${targetStockProduct.stock.toLocaleString('vi-VN')} ${baseUnitLabel} (cần ${nextDirect.toLocaleString('vi-VN')} ${baseUnitLabel})`
        )
      }
    }
    const listing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
    })
    const basePrice = listing?.price ?? product.sellPrice
    const price =
      effectiveSellRate !== defaultSellRate
        ? Math.round((basePrice * effectiveSellRate) / defaultSellRate)
        : basePrice
    subtotal += price * qty
    const deductBaseQty = isCombo ? qty : Math.round(qty * effectiveSellRate)
    const unitLabelText = it.unitLabel?.trim() || (effectiveSellRate !== defaultSellRate ? `${effectiveSellRate}${baseUnitLabel}` : unitCfg?.sellUnit || product.unit || 'sp')
    const unitSummaryNote =
      !isCombo && (effectiveSellRate > 1 || targetStockProduct.id !== product.id)
        ? ` (${qty} × ${unitLabelText} → quy đổi trừ -${deductBaseQty} ${baseUnitLabel})`
        : ''

    orderItems.push({
      productId: product.id,
      quantity: qty,
      price,
      isCombo,
      targetStockProductId: targetStockProduct.id,
      deductBaseQty,
      unitSummaryNote,
    })
  }

  // Kiểm tra tổng nhu cầu kết hợp (khi 1 sản phẩm vừa được mua lẻ vừa nằm trong Combo của cùng đơn hàng)
  for (const [compId, comboEntry] of comboDemands.entries()) {
    const directEntry = directDemands.get(compId)
    if (directEntry) {
      const totalNeeded = directEntry.required + comboEntry.required
      if (directEntry.stock < totalNeeded) {
        throw new Error(
          `Sản phẩm "${directEntry.name}" chỉ còn ${directEntry.stock} trong kho (đơn cần ${directEntry.required} lẻ + ${comboEntry.required} trong Combo = ${totalNeeded})`
        )
      }
    }
  }

  let finalCustomerId: string | null = input.customerId || null
  if (!finalCustomerId && input.customerPhone?.trim()) {
    const existingByPhone = await db.customer.findFirst({
      where: { phone: input.customerPhone.trim() },
      select: { id: true },
    })
    if (existingByPhone) {
      finalCustomerId = existingByPhone.id
    }
  }
  if (!finalCustomerId && input.customerName?.trim()) {
    const customer = await db.customer.create({
      data: {
        name: input.customerName.trim(),
        phone: input.customerPhone?.trim() || null,
        email: input.customerEmail?.trim() || null,
        address: input.address?.trim() || null,
      },
    })
    finalCustomerId = customer.id
  }

  const activePolicy = await getActiveLoyaltyPolicy().catch(() => null)
  const freeShipThreshold = activePolicy?.freeShippingThreshold ?? 500_000
  const redeemVndPerPoint = activePolicy?.redeemVndPerPoint ?? 1_000
  const minOrderForRedeem = activePolicy?.minOrderForRedeem ?? 0
  const maxRedeemPct = activePolicy?.maxRedeemPct ?? 100

  const shippingFee =
    typeof input.shippingFee === 'number' && Number.isFinite(input.shippingFee) && input.shippingFee >= 0
      ? Math.round(input.shippingFee)
      : subtotal >= freeShipThreshold
        ? 0
        : 30000

  // Xử lý chiết khấu trực tiếp & đổi điểm Hội viên tại POS (theo cấu hình Đợt chính sách hiện hành)
  const redeemPoints = Math.max(0, Math.floor(Number(input.redeemPoints) || 0))
  if (redeemPoints > 0) {
    if (!finalCustomerId) {
      throw new Error('Vui lòng chọn khách hàng thành viên để sử dụng điểm tích lũy')
    }
    const cust = await db.customer.findUnique({ where: { id: finalCustomerId } })
    if (!cust || !cust.isMember) {
      throw new Error('Chỉ khách hàng đã đăng ký Thành viên mới có thể đổi điểm')
    }
    if (cust.points < redeemPoints) {
      throw new Error(`Thành viên chỉ còn ${cust.points} điểm, không đủ để đổi ${redeemPoints} điểm`)
    }
    if (minOrderForRedeem > 0 && subtotal < minOrderForRedeem) {
      throw new Error(`Đơn hàng tối thiểu ${minOrderForRedeem.toLocaleString('vi-VN')}đ mới được áp dụng đổi điểm`)
    }
    const maxAllowedPointsDiscount = Math.floor((subtotal * maxRedeemPct) / 100)
    if (redeemPoints * redeemVndPerPoint > maxAllowedPointsDiscount) {
      const maxPts = Math.floor(maxAllowedPointsDiscount / redeemVndPerPoint)
      throw new Error(`Chính sách đợt hiện tại giới hạn đổi điểm tối đa ${maxRedeemPct}% giá trị đơn (${maxPts} điểm)`)
    }
  }
  const pointsDiscount = redeemPoints * redeemVndPerPoint
  const manualDiscount = Math.max(0, Math.round(Number(input.discountAmount) || 0))

  // Xử lý Mã giảm giá / Voucher (nếu có)
  await ensureWarehousesAndVouchersSeeded()
  let appliedVoucherCode: string | null = null
  let voucherDiscount = 0
  if (input.voucherCode?.trim()) {
    const cleanCode = input.voucherCode.trim().toUpperCase()
    const voucher = await db.voucher.findUnique({ where: { code: cleanCode } })
    if (!voucher) {
      throw new Error(`Mã giảm giá "${cleanCode}" không tồn tại`)
    }
    const evalRes = calculateVoucherDiscount(voucher, subtotal, shippingFee)
    if (!evalRes.valid) {
      throw new Error(evalRes.reason || `Mã giảm giá "${cleanCode}" không đủ điều kiện áp dụng`)
    }
    appliedVoucherCode = voucher.code
    voucherDiscount = evalRes.discountAmount
    await db.voucher.update({
      where: { id: voucher.id },
      data: { usedCount: { increment: 1 } },
    })
  }

  // Nếu UI đã gộp sẵn voucher vào manualDiscount hoặc truyền riêng, đảm bảo không cộng trùng
  const effectivePromoDiscount =
    appliedVoucherCode && manualDiscount === 0 ? voucherDiscount : manualDiscount
  const totalDiscount = Math.min(subtotal + shippingFee, effectivePromoDiscount + pointsDiscount)
  const finalTotal = Math.max(0, subtotal + shippingFee - totalDiscount)

  // Kho xuất hàng (mặc định: Kho Trung Tâm Ưu Đàm)
  let targetWarehouseId: string | null = input.warehouseId?.trim() || null
  if (!targetWarehouseId) {
    const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
    targetWarehouseId = defaultWh?.id ?? null
  }

  // Phí sàn TMĐT: snapshot lúc tạo đơn (từ cấu hình % của kênh) — trừ khi đối soát để tính lợi nhuận thực nhận
  const platformFeePct = channel.feePercent
  const platformFee = Math.round((subtotal * platformFeePct) / 100)
  const now = new Date()
  const code = `DH${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`

  const initialStatus = input.instantComplete ? 'COMPLETED' : 'PENDING'
  const initialPaymentStatus = input.instantComplete ? 'PAID' : 'UNPAID'

  const order = await db.order.create({
    data: {
      code,
      channelId: channel.id,
      customerId: finalCustomerId,
      status: initialStatus,
      paymentMethod: input.paymentMethod || 'COD',
      paymentStatus: initialPaymentStatus,
      subtotal,
      shippingFee,
      total: finalTotal,
      warehouseId: targetWarehouseId,
      voucherCode: appliedVoucherCode,
      discountAmount: totalDiscount,
      platformFeePct,
      platformFee,
      note: input.note?.trim() || null,
      address: input.address?.trim() || null,
      items: {
        create: orderItems.map(({ productId, quantity, price }) => ({
          productId,
          quantity,
          price,
        })),
      },
    },
    include: {
      channel: { select: { id: true, key: true, name: true, color: true } },
      customer: { select: { id: true, name: true, phone: true } },
      items: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  })

  // Trừ kho + quy đổi định lượng đồng bộ + ghi biến động (lưu trữ vĩnh viễn)
  const deductedSimpleIds: string[] = []
  for (const it of orderItems) {
    if (it.isCombo) continue // COMBO: trừ kho thành phần (dưới), không trừ kho gộp
    const targetProduct = await db.product.findUnique({ where: { id: it.targetStockProductId } })
    if (targetProduct) {
      const deductAmt = Math.max(1, it.deductBaseQty)
      const after = Math.max(0, targetProduct.stock - deductAmt)
      await db.product.update({ where: { id: targetProduct.id }, data: { stock: after } })
      await syncProductWarehouseStock(targetProduct.id, targetWarehouseId)
      await db.stockMovement.create({
        data: {
          productId: targetProduct.id,
          warehouseId: targetWarehouseId,
          type: 'EXPORT',
          quantity: -deductAmt,
          stockAfter: after,
          note: `Xuất kho cho đơn ${code}${it.unitSummaryNote || ''}`,
        },
      })
      deductedSimpleIds.push(targetProduct.id)
    }
  }
  if (deductedSimpleIds.length > 0) {
    await Promise.all([
      syncCombosUsingComponents(db, deductedSimpleIds),
      syncLinkedVariantStocks(db, deductedSimpleIds),
    ])
  }

  // COMBO/SET quà tặng: trừ kho từng thành phần × định mức + đồng bộ tồn hiển thị của combo
  if (comboDemands.size > 0) {
    await db.$transaction(async (tx) => {
      const issued = await issueComboComponents(
        tx,
        new Map([...comboDemands.entries()].map(([pid, e]) => [pid, e.required])),
        (componentName, qty) => `Trừ thành phần combo ${qty} ${componentName} cho đơn ${code}`
      )
      const comboIds = [...new Set(orderItems.filter((it) => it.isCombo).map((it) => it.productId))]
      for (const comboId of comboIds) await syncComboStock(tx, comboId)
      await syncCombosUsingComponents(tx, [...comboDemands.keys()])
      const warnings = issued.filter((r) => r.warning)
      if (warnings.length > 0) {
        await logLedgerAsync({
          scope: 'INVENTORY',
          action: 'COMBO_ISSUE_WARNING',
          entityType: 'Order',
          entityCode: code,
          title: `Đơn ${code}: trừ kho thành phần combo có cảnh báo`,
          detail: { warnings: warnings.map((w) => w.warning) },
          actor: 'SYSTEM',
        })
      }
    })
    for (const compId of comboDemands.keys()) {
      await syncProductWarehouseStock(compId, targetWarehouseId)
    }
  }

  await logEvent(order.id, 'CREATED', 'SYSTEM', `Nhận đơn mới qua ${channel.name}`)
  if (redeemPoints > 0 && finalCustomerId) {
    await adjustPoints(
      finalCustomerId,
      'REDEEM',
      redeemPoints,
      `Đổi ${redeemPoints} điểm giảm ${pointsDiscount.toLocaleString('vi-VN')}đ cho đơn POS ${order.code}`,
      'OPERATOR'
    )
  }
  if (input.instantComplete) {
    await logEvent(
      order.id,
      'COMPLETED',
      'OPERATOR',
      `Bán hàng trực tiếp tại kho (POS) — đã thu tiền (${order.paymentMethod}) & bàn giao hàng tại chỗ`
    )
    await awardPointsForCompletedOrder(order.id)
  }
  const friendlyOrderItems = order.items.map((i) => ({ quantity: i.quantity, product: i.product }))
  const itemsSummary = friendlyItemsText(friendlyOrderItems)
  await logActivity({
    agent: 'SYSTEM',
    action: 'ORDER_RECEIVED',
    level: 'info',
    targetType: 'ORDER',
    targetId: order.id,
    targetLabel: order.code,
    message: `Tiếp nhận đơn hàng mới ${order.code} (${itemsSummary}) từ ${order.customer?.name ?? 'khách lẻ'} qua kênh ${channel.name} — tổng giá trị ${(order.total).toLocaleString('vi-VN')}đ`,
  })
  broadcast('order.created', order)

  // Trí nhớ dài hạn: đơn mới → chắt lọc lại hồ sơ khách (contextSummary/preferences/painPoints)
  if (finalCustomerId) {
    const { refreshCustomerMemory } = await import('@/lib/memory-engine')
    refreshCustomerMemory(finalCustomerId, 'ORDER', `Đơn mới ${order.code}`).catch(() => null)
  }

  // Sổ Data + Webhook outbound (fire-and-forget) — chụp snapshot gốc đơn hàng (DATA LINEAGE)
  recordLineageChangeAsync({
    scope: 'ORDER',
    action: 'ORDER_CREATED',
    entityType: 'Order',
    entityId: order.id,
    entityCode: order.code,
    sourceRefCode: order.code,
    title: `Đơn ${order.code} — ${channel.name}`,
    after: {
      status: 'PENDING',
      paymentMethod: order.paymentMethod,
      paymentStatus: 'UNPAID',
      total: order.total,
      itemCount: order.items.length,
    },
    originSource: inferOriginSource({ channelKey: channel.key, actor: 'SYSTEM', action: 'ORDER_CREATED' }),
    actorName: 'Kênh bán',
    actor: 'SYSTEM',
    detail: { total: order.total, items: order.items.length, customer: order.customer?.name ?? 'Khách lẻ' },
  })
  dispatchWebhook('order.created', {
    id: order.id,
    code: order.code,
    channel: channel.key,
    warehouseId: order.warehouseId,
    voucherCode: order.voucherCode,
    discountAmount: order.discountAmount,
    total: order.total,
    customer: order.customer?.name ?? 'Khách lẻ',
    items: order.items.map((i) => ({ sku: i.product?.sku ?? null, name: i.product?.name ?? null, quantity: i.quantity, price: i.price })),
  })

  // Nếu đơn hàng có sản phẩm thuộc Shop liên kết bán chéo (PARTNER_SHOP) → tự động bắn sự kiện alliance.order.cross_sold
  void (async () => {
    try {
      const partnerWhs = await db.warehouse.findMany({ where: { type: 'PARTNER_SHOP', active: true } })
      if (partnerWhs.length === 0) return
      const partnerById = new Map(partnerWhs.map((w) => [w.id, w]))
      const productIds = orderItems.map((i) => i.productId)
      const fullProducts = await db.product.findMany({ where: { id: { in: productIds } } })
      for (const item of orderItems) {
        const prod = fullProducts.find((p) => p.id === item.productId)
        if (!prod || !prod.ownerWarehouseId) continue
        const partnerWh = partnerById.get(prod.ownerWarehouseId)
        if (!partnerWh) continue
        const grossRevenue = Math.round(item.price * item.quantity)
        const rate = prod.crossSellRate ?? partnerWh.commissionPct
        const commissionAmount = Math.round((grossRevenue * rate) / 100)
        dispatchWebhook('alliance.order.cross_sold', {
          orderCode: order.code,
          partnerShopCode: partnerWh.code,
          partnerShopName: partnerWh.name,
          sku: prod.sku,
          productName: prod.name,
          quantity: item.quantity,
          grossRevenue,
          commissionPct: rate,
          commissionAmount,
          netPayableToPartner: Math.max(0, grossRevenue - commissionAmount),
        })
      }
    } catch {
      // fire-and-forget
    }
  })()

  return order
}
