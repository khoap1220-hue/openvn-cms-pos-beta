// Service tạo đơn dùng chung cho POS/API + Agent Simulator

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity, logEvent } from '@/lib/agent-log'
import { logLedgerAsync, recordLineageChangeAsync, inferOriginSource } from '@/lib/ledger'
import type { OriginSource } from '@/lib/lineage'
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
import {
  cancelPendingShopeePrintJob,
  enqueueShopeeOrderForLinkedPos,
} from '@/lib/peripheral-hub'
import {
  canChannelSellNegative,
  getInventorySyncPolicy,
} from '@/lib/inventory-policy'

export function isMaskedOrDummyPhone(phone: unknown): boolean {
  if (!phone || typeof phone !== 'string') return true
  const p = phone.trim()
  if (!p) return true

  // Chứa ký tự che sao hoặc ký tự x/X
  if (p.includes('*') || p.includes('x') || p.includes('X')) return true

  // Danh sách các số điện thoại mẫu / giữ chỗ phổ biến
  const dummySet = new Set([
    '0900000000',
    '0000000000',
    '0123456789',
    '0987654321',
    '0999999999',
    '0888888888',
    '0777777777',
    '0111111111',
    '0222222222',
    '0333333333',
    '0444444444',
    '0555555555',
  ])
  if (dummySet.has(p)) return true

  // Lọc chỉ giữ chữ số
  const digits = p.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 12) return true

  // Trùng lặp một chữ số duy nhất (VD: 000000000, 0999999999)
  if (/^0(\d)\1{7,}$/.test(digits)) return true
  if (digits === '0900000000') return true

  return false
}

export interface StockShortageWarningItem {
  productId: string
  sku: string
  name: string
  available: number
  required: number
  deducted: number
  shortage: number
  unit: string
}

export interface CreateOrderInput {
  channelId: string
  items: Array<{
    productId: string
    quantity: number
    /** Đơn giá ghi đè trên từng dòng (hỗ trợ cả sản phẩm quà tặng mua kèm 0đ từ Sàn) */
    priceOverride?: number
    /** Định lượng quy đổi trừ kho cho 1 đơn vị bán (VD: 500 = 500gr, 1000 = 1kg) */
    unitMultiplier?: number
    /** Nhãn đơn vị bán (VD: '500gr', '1kg') */
    unitLabel?: string
  }>
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  buyerUsername?: string
  channelCustomerRef?: string
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
  /**
   * Cho phép tiếp nhận & in đơn từ Sàn Shopee ngay cả khi tồn kho CMS = 0 hoặc thiếu tồn,
   * ghi nhận cảnh báo lệch kho để đối soát sau (không làm gián đoạn phiên Live).
   */
  allowStockShortage?: boolean
  /** Cho phép trừ thẳng tồn kho vật lý CMS xuống số âm (< 0) theo cài đặt cửa hàng */
  allowNegativeStock?: boolean
  /** Trì hoãn đẩy hàng đợi in POS đến sau khi đồng bộ xong mã vận đơn Shipment */
  deferPosPrintEnqueue?: boolean
  /** Giá bán thực tế từng sản phẩm từ đơn Sàn (nếu có Flash Sale / Live Voucher) */
  itemPriceOverrides?: Record<string, number>
}

export async function createOrder(input: CreateOrderInput) {
  if (!input.channelId) throw new Error('Vui lòng chọn kênh bán')
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Đơn hàng cần ít nhất 1 sản phẩm')
  }

  const [channel, inventoryPolicy] = await Promise.all([
    db.channel.findUnique({ where: { id: input.channelId } }),
    getInventorySyncPolicy(),
  ])
  if (!channel) throw new Error('Kênh bán không tồn tại')

  const allowNegative =
    input.allowNegativeStock !== undefined
      ? Boolean(input.allowNegativeStock)
      : canChannelSellNegative(inventoryPolicy, channel.key)
  const allowShortage = Boolean(input.allowStockShortage) || allowNegative
  const stockShortageWarnings: StockShortageWarningItem[] = []

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
  const directDemands = new Map<
    string,
    { required: number; sku: string; name: string; stock: number; baseUnit: string }
  >()
  const componentStockMap = new Map<
    string,
    { sku: string; name: string; stock: number; unit: string }
  >()

  for (const it of input.items) {
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1))
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) throw new Error('Sản phẩm không tồn tại')
    if (product.status === 'INACTIVE' && !allowShortage) {
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
        include: {
          componentProduct: { select: { id: true, sku: true, name: true, stock: true, unit: true } },
        },
      })
      if (rows.length === 0 && !allowShortage) {
        throw new Error(`Combo "${product.name}" chưa khai báo thành phần ở Định mức`)
      }
      for (const row of rows) {
        const required = Math.round(row.quantity * qty)
        const entry = comboDemands.get(row.componentProductId) ?? { required: 0, comboNames: new Set<string>() }
        entry.required += required
        entry.comboNames.add(product.name)
        comboDemands.set(row.componentProductId, entry)
        componentStockMap.set(row.componentProductId, {
          sku: row.componentProduct.sku,
          name: row.componentProduct.name,
          stock: row.componentProduct.stock,
          unit: row.componentProduct.unit || 'bộ',
        })
        if (row.componentProduct.stock < entry.required && !allowShortage) {
          throw new Error(`Combo "${product.name}" không thể đóng — "${row.componentProduct.name}" chỉ còn ${row.componentProduct.stock} (cần ${entry.required})`)
        }
      }
    } else {
      const deductBaseQty = Math.round(qty * effectiveSellRate)
      const prevDirect = directDemands.get(targetStockProduct.id)?.required ?? 0
      const nextDirect = prevDirect + deductBaseQty
      directDemands.set(targetStockProduct.id, {
        required: nextDirect,
        sku: targetStockProduct.sku,
        name: targetStockProduct.name,
        stock: targetStockProduct.stock,
        baseUnit: baseUnitLabel,
      })
      if (targetStockProduct.stock < nextDirect && !allowShortage) {
        throw new Error(
          `Kho "${targetStockProduct.name}" chỉ còn ${targetStockProduct.stock.toLocaleString('vi-VN')} ${baseUnitLabel} (cần ${nextDirect.toLocaleString('vi-VN')} ${baseUnitLabel})`
        )
      }
    }
    const listing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
    })
    const overridePrice =
      typeof it.priceOverride === 'number' && Number.isFinite(it.priceOverride)
        ? it.priceOverride
        : input.itemPriceOverrides?.[product.id]
    const basePrice =
      typeof overridePrice === 'number' && Number.isFinite(overridePrice) && overridePrice >= 0
        ? Math.round(overridePrice)
        : (listing?.price ?? product.sellPrice)
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
      if (directEntry.stock < totalNeeded && !allowShortage) {
        throw new Error(
          `Sản phẩm "${directEntry.name}" chỉ còn ${directEntry.stock} trong kho (đơn cần ${directEntry.required} lẻ + ${comboEntry.required} trong Combo = ${totalNeeded})`
        )
      }
    }
  }

  if (allowShortage && !allowNegative) {
    const allProductIds = new Set<string>([...directDemands.keys(), ...comboDemands.keys()])
    for (const pid of allProductIds) {
      const dEntry = directDemands.get(pid)
      const cEntry = comboDemands.get(pid)
      const cMeta = componentStockMap.get(pid)
      const required = (dEntry?.required ?? 0) + (cEntry?.required ?? 0)
      const available = Math.max(0, dEntry?.stock ?? cMeta?.stock ?? 0)
      if (available < required) {
        const deducted = Math.min(available, required)
        stockShortageWarnings.push({
          productId: pid,
          sku: dEntry?.sku || cMeta?.sku || '—',
          name: dEntry?.name || cMeta?.name || 'Sản phẩm',
          available,
          required,
          deducted,
          shortage: required - deducted,
          unit: dEntry?.baseUnit || cMeta?.unit || 'bộ',
        })
      }
    }
  }

  let finalCustomerId: string | null = input.customerId || null

  // 1. Phân giải danh tính khách hàng theo Channel Reference (VD: shopee:<buyer_username>)
  const channelRef =
    input.channelCustomerRef?.trim().toLowerCase() ||
    (input.buyerUsername?.trim() ? `shopee:${input.buyerUsername.trim().toLowerCase()}` : null)

  if (!finalCustomerId && channelRef) {
    const existingByChannel = await db.customer.findFirst({
      where: {
        OR: [
          { email: channelRef },
          { inferredProfile: { contains: channelRef } },
        ],
      },
      select: { id: true },
    })
    if (existingByChannel) {
      finalCustomerId = existingByChannel.id
    }
  }

  // 2. Tra cứu theo SĐT THỰC (Bỏ qua SĐT ẩn/che PII như 0900000000, ******, tránh gộp nhầm nhiều khách thành một)
  const rawPhone = input.customerPhone?.trim() || null
  const isMaskedPhone = isMaskedOrDummyPhone(rawPhone)

  if (!finalCustomerId && rawPhone && !isMaskedPhone) {
    const existingByPhone = await db.customer.findFirst({
      where: { phone: rawPhone },
      select: { id: true },
    })
    if (existingByPhone) {
      finalCustomerId = existingByPhone.id
    }
  }

  // 3. Tạo hồ sơ khách hàng mới nếu chưa tồn tại
  if (!finalCustomerId && (input.customerName?.trim() || channelRef)) {
    const name =
      input.customerName?.trim() ||
      (input.buyerUsername?.trim() ? `Shopee @${input.buyerUsername.trim()}` : 'Khách vãng lai')

    const phoneToStore = isMaskedPhone ? null : rawPhone
    const emailToStore = input.customerEmail?.trim() || channelRef || null

    const profileMeta: Record<string, unknown> = {}
    if (channelRef) profileMeta.channelRef = channelRef
    if (input.buyerUsername) profileMeta.buyerUsername = input.buyerUsername.trim()
    if (isMaskedPhone && rawPhone) profileMeta.maskedPhone = rawPhone

    const customer = await db.customer.create({
      data: {
        name,
        phone: phoneToStore,
        email: emailToStore,
        address: input.address?.trim() || null,
        inferredProfile: Object.keys(profileMeta).length > 0 ? JSON.stringify(profileMeta) : null,
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
  const shopeeSnMatch = (input.note || '').match(/Shopee Order #([A-Za-z0-9_-]+)/i)
  const extractedShopeeOrderSn = shopeeSnMatch?.[1] || ''
  const deductedSimpleIds: string[] = []
  let shouldTriggerShopeeOutbox = false

  for (const it of orderItems) {
    if (it.isCombo) continue // COMBO: trừ kho thành phần (dưới), không trừ kho gộp
    const targetProduct = await db.product.findUnique({ where: { id: it.targetStockProductId } })
    if (targetProduct) {
      const stockBefore = targetProduct.stock
      const availableBefore = Math.max(0, stockBefore)
      const deductAmt = Math.max(1, it.deductBaseQty)
      const actualDeducted = allowNegative
        ? deductAmt
        : allowShortage
          ? Math.min(availableBefore, deductAmt)
          : deductAmt
      const shortageQty = Math.max(0, deductAmt - actualDeducted)
      const after = allowNegative
        ? stockBefore - actualDeducted
        : stockBefore - actualDeducted
      let prodAttrs: Record<string, unknown> = {}
      try {
        if (targetProduct.attributes) {
          prodAttrs = JSON.parse(targetProduct.attributes) as Record<string, unknown>
        }
      } catch {
        prodAttrs = {}
      }
      const openingOrigin =
        prodAttrs.openingStockOrigin === 'CMS_WAREHOUSE' ? 'CMS_WAREHOUSE' : 'SHOPEE_MARKETPLACE'
      const openingOriginShort =
        openingOrigin === 'CMS_WAREHOUSE' ? 'Gốc tồn Kho CMS' : 'Gốc tồn đầu từ Sàn Shopee'

      if (channel.key === 'SHOPEE') {
        const prevLiveShopee =
          typeof prodAttrs.liveShopeeStock === 'number'
            ? prodAttrs.liveShopeeStock
            : typeof prodAttrs.lastSyncedShopeeStock === 'number'
              ? prodAttrs.lastSyncedShopeeStock
              : Math.max(0, stockBefore)
        const estimatedNextShopee =
          prevLiveShopee >= deductAmt ? prevLiveShopee - deductAmt : prevLiveShopee

        if (shortageQty > 0) {
          // Chế độ KHÔNG bán âm khi kho CMS = 0 / thiếu tồn: kẹp tồn CMS tại 0, bảo vệ tồn Sàn & ghi nhận lệch chờ đối soát
          const prevShortage = Math.max(0, Number(prodAttrs.pendingOrderShortageQty) || 0)
          prodAttrs.liveShopeeStock = estimatedNextShopee
          prodAttrs.lastSyncedShopeeStock = estimatedNextShopee
          prodAttrs.pendingOrderShortageQty = prevShortage + shortageQty
          prodAttrs.unreconciledShopeeDelta = estimatedNextShopee - after
          prodAttrs.reconciliationStatus =
            after === 0 && estimatedNextShopee > 0
              ? 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
              : 'STOCK_DRIFT'
          prodAttrs.lastShortageOrderSn = extractedShopeeOrderSn || code
          prodAttrs.lastShortageOrderCode = code
          prodAttrs.lastShortageAt = new Date().toISOString()
        } else if (inventoryPolicy.syncMode === 'VIRTUAL_ALWAYS_IN_STOCK') {
          // Chế độ Tồn ảo trên Sàn & Chống ghi đè tồn thật CMS (bao gồm cả khi bật Bán âm CMS after < 0):
          // Tồn thật CMS = after; Tồn trên Sàn = estimatedNextShopee (tự bơm lại nếu bật virtualAutoRefill và chạm ngưỡng)
          prodAttrs.liveShopeeStock = estimatedNextShopee
          prodAttrs.lastSyncedShopeeStock = estimatedNextShopee
          prodAttrs.unreconciledShopeeDelta = estimatedNextShopee - after
          prodAttrs.reconciliationStatus =
            after < 0
              ? 'STOCK_DRIFT'
              : after === 0 && estimatedNextShopee > 0
                ? 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
                : estimatedNextShopee === after
                  ? 'RECONCILED_OK'
                  : 'STOCK_DRIFT'
          prodAttrs.lastReconciledOrderSn = extractedShopeeOrderSn || code
          prodAttrs.lastReconciledOrderCode = code
          prodAttrs.lastReconciledAt = new Date().toISOString()
          if (
            inventoryPolicy.virtualAutoRefill &&
            estimatedNextShopee <= inventoryPolicy.virtualMinThreshold &&
            estimatedNextShopee !== inventoryPolicy.virtualStockQty
          ) {
            shouldTriggerShopeeOutbox = true
          }
        } else {
          // Chế độ Đồng bộ CMS lên Sàn (SYNC_CMS_TO_MARKETPLACE)
          const clampedForShopee = Math.max(0, after)
          prodAttrs.liveShopeeStock = estimatedNextShopee
          prodAttrs.lastSyncedShopeeStock = estimatedNextShopee
          prodAttrs.unreconciledShopeeDelta = estimatedNextShopee - after
          prodAttrs.reconciliationStatus =
            estimatedNextShopee === clampedForShopee && after >= 0 ? 'RECONCILED_OK' : 'STOCK_DRIFT'
          prodAttrs.lastReconciledOrderSn = extractedShopeeOrderSn || code
          prodAttrs.lastReconciledOrderCode = code
          prodAttrs.lastReconciledAt = new Date().toISOString()
          if (estimatedNextShopee !== clampedForShopee) {
            shouldTriggerShopeeOutbox = true
          }
        }
      }

      let prodAttrsMutated = channel.key === 'SHOPEE'
      if (actualDeducted > 0 && typeof prodAttrs.mode1HoldBaselineStock === 'number') {
        delete prodAttrs.mode1HoldBaselineStock
        delete prodAttrs.mode1HoldSetAt
        prodAttrsMutated = true
      }

      await db.product.update({
        where: { id: targetProduct.id },
        data: {
          stock: after,
          ...(prodAttrsMutated ? { attributes: JSON.stringify(prodAttrs) } : {}),
        },
      })
      await syncProductWarehouseStock(targetProduct.id, targetWarehouseId)
      const negativeNoteSuffix =
        after < 0
          ? ` [Bán âm kho thật CMS: ${stockBefore} ➔ ${after} ${targetProduct.unit || 'bộ'} — tự bù trừ khi nhập kho]`
          : ''
      const shortageNoteSuffix =
        shortageQty > 0
          ? ` [CẢNH BÁO LỆCH KHO CHỜ ĐỐI SOÁT: thiếu ${shortageQty} ${targetProduct.unit || 'bộ'} tại CMS — đã trừ ${actualDeducted}/${deductAmt}, nhận & in đơn không gián đoạn Live]`
          : ''
      const movementNote =
        channel.key === 'SHOPEE'
          ? `Xuất kho cho đơn ${code} (Đối chiếu Đơn Sàn Shopee ${extractedShopeeOrderSn ? `#${extractedShopeeOrderSn}` : ''} · Trừ trên ${openingOriginShort})${it.unitSummaryNote || ''}${negativeNoteSuffix}${shortageNoteSuffix}`
          : `Xuất kho cho đơn ${code}${it.unitSummaryNote || ''}${negativeNoteSuffix}${shortageNoteSuffix}`
      await db.stockMovement.create({
        data: {
          productId: targetProduct.id,
          warehouseId: targetWarehouseId,
          type: 'EXPORT',
          quantity: -actualDeducted,
          stockAfter: after,
          note: movementNote,
        },
      })
      if (actualDeducted > 0) {
        deductedSimpleIds.push(targetProduct.id)
      }
      // Tự động đẩy vào Transactional Outbox (CMS -> Sàn Shopee) khi trừ kho tại POS / kênh khác CHỈ KHI bật chế độ Đồng bộ CMS lên Sàn
      if (
        channel.key !== 'SHOPEE' &&
        inventoryPolicy.syncMode === 'SYNC_CMS_TO_MARKETPLACE' &&
        targetProduct.attributes
      ) {
        try {
          const attrs = JSON.parse(targetProduct.attributes) as Record<string, unknown>
          if (attrs.shopeeItemId && attrs.shopeeModelId) {
            const clampedShopeeTarget = Math.max(0, after)
            shouldTriggerShopeeOutbox = true
            logLedgerAsync({
              scope: 'CHANNEL',
              action: 'OUTBOX_PENDING',
              entityType: 'Product',
              entityId: targetProduct.id,
              entityCode: targetProduct.sku,
              title: `Outbox: Đơn ${code} (${channel.name}) trừ kho thật [${targetProduct.sku}] (${after}) → chờ đồng bộ tồn (${clampedShopeeTarget}) lên Shopee`,
              detail: {
                orderCode: code,
                channelKey: channel.key,
                sku: targetProduct.sku,
                shopeeItemId: String(attrs.shopeeItemId),
                shopeeModelId: String(attrs.shopeeModelId),
                cmsRealStock: after,
                targetStock: clampedShopeeTarget,
              },
              actor: 'SYSTEM',
              originSource: 'SHOPEE_SYNC',
            })
          }
        } catch {
          // ignore parse error
        }
      }
    }
  }
  if (deductedSimpleIds.length > 0) {
    await Promise.all([
      syncCombosUsingComponents(db, deductedSimpleIds),
      syncLinkedVariantStocks(db, deductedSimpleIds),
    ])
  }
  if (shouldTriggerShopeeOutbox) {
    fetch(
      `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT || '51898'}/shopee/trigger-sync`,
      { method: 'POST' }
    ).catch(() => null)
  }

  // COMBO/SET quà tặng: trừ kho từng thành phần × định mức + đồng bộ tồn hiển thị của combo
  if (comboDemands.size > 0) {
    await db.$transaction(async (tx) => {
      const issued = await issueComboComponents(
        tx,
        new Map([...comboDemands.entries()].map(([pid, e]) => [pid, e.required])),
        (componentName, qty) => `Trừ thành phần combo ${qty} ${componentName} cho đơn ${code}`,
        { allowNegative, warehouseId: targetWarehouseId }
      )
      // Ghi nhận bút toán 0 cho thành phần combo có tồn = 0 (khi allowShortage = true & !allowNegative) để cancelOrder bảo toàn kho = 0
      for (const r of issued) {
        if (r.deducted === 0 && r.required > 0) {
          await tx.stockMovement.create({
            data: {
              productId: r.componentProductId,
              warehouseId: targetWarehouseId,
              type: 'COMBO_ISSUE',
              quantity: 0,
              stockAfter: r.stockAfter,
              note: `Trừ thành phần combo 0/${r.required} ${r.componentName} cho đơn ${code} [CẢNH BÁO LỆCH KHO CHỜ ĐỐI SOÁT]`,
            },
          })
        }
      }
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
    level: stockShortageWarnings.length > 0 ? 'warning' : 'info',
    targetType: 'ORDER',
    targetId: order.id,
    targetLabel: order.code,
    message:
      stockShortageWarnings.length > 0
        ? `Tiếp nhận đơn ${order.code} (${itemsSummary}) qua ${channel.name} — [Chờ đối soát kho CMS: thiếu ${stockShortageWarnings.map((w) => `${w.sku} -${w.shortage}`).join(', ')}]`
        : `Tiếp nhận đơn hàng mới ${order.code} (${itemsSummary}) từ ${order.customer?.name ?? 'khách lẻ'} qua kênh ${channel.name} — tổng giá trị ${(order.total).toLocaleString('vi-VN')}đ`,
  })
  broadcast('order.created', order)

  // Tự động đẩy đơn Shopee mới vào hàng đợi in tự động cho Máy POS đang liên kết
  if (channel.key === 'SHOPEE' && !input.instantComplete && !input.deferPosPrintEnqueue) {
    enqueueShopeeOrderForLinkedPos({
      orderId: order.id,
      orderCode: order.code,
      shopeeOrderSn: extractedShopeeOrderSn || undefined,
      customerName: order.customer?.name ?? input.customerName ?? null,
      note: order.note,
      total: order.total,
      itemCount: order.items.reduce((s, it) => s + it.quantity, 0),
    })
  }

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

  return Object.assign(order, { stockShortageWarnings })
}

export interface CancelOrderInput {
  orderId: string
  reason?: string
  actor?: 'OPERATOR' | 'SYSTEM' | 'API'
  actorName?: string
  originSource?: OriginSource
}

export interface CancelOrderResult {
  ok: boolean
  alreadyCancelled: boolean
  orderId: string
  orderCode: string
  restockedCount: number
  restockedProductIds: string[]
}

export async function cancelOrder(input: CancelOrderInput): Promise<CancelOrderResult> {
  const { orderId, reason, actor = 'SYSTEM', actorName = 'Shopee Sync', originSource = 'SHOPEE_SYNC' } = input

  const targetOrder = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!targetOrder) {
    throw new Error(`Đơn hàng với ID «${orderId}» không tồn tại`)
  }

  if (targetOrder.status === 'CANCELLED') {
    return {
      ok: true,
      alreadyCancelled: true,
      orderId: targetOrder.id,
      orderCode: targetOrder.code,
      restockedCount: 0,
      restockedProductIds: [],
    }
  }

  if (targetOrder.status === 'COMPLETED') {
    throw new Error(`Không thể hủy đơn hàng đã hoàn tất (${targetOrder.code})`)
  }

  const unitConfigs = await getAllUnitConfigs().catch(() => ({} as Record<string, { sellRate?: number; linkedBaseProductId?: string | null }>))

  const result = await db.$transaction(async (tx) => {
    // 1. Atomic CAS check to prevent concurrent double-cancellation
    const updateCheck = await tx.order.updateMany({
      where: { id: orderId, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED' },
    })
    if (updateCheck.count === 0) {
      return { alreadyCancelled: true, restockedIds: [] }
    }

    // Đối chiếu chính xác số lượng thực tế đã trừ kho của đơn này (bảo toàn 100% khi đơn Live nhận lúc kho CMS = 0)
    const priorMovements = await tx.stockMovement.findMany({
      where: {
        type: { in: ['EXPORT', 'COMBO_ISSUE'] },
        note: { contains: targetOrder.code },
      },
    })

    const restockedProductIds: string[] = []
    const comboIdsToSync = new Set<string>()
    const targetWhId = targetOrder.warehouseId

    // 2. Gom nhóm theo productId / componentProductId để KHÔNG hoàn kho trùng gấp đôi khi cùng 1 SKU xuất hiện ở >= 2 dòng (VD: 1 dòng mua giá thường + 1 dòng quà tặng 0đ)
    const comboCompDemands = new Map<string, { compQty: number; labels: string[] }>()
    const simpleProdDemands = new Map<string, number>()

    for (const item of targetOrder.items) {
      const product = await tx.product.findUnique({ where: { id: item.productId } })
      if (!product) continue

      if (product.type === 'COMBO') {
        const bomRows = await tx.bomComponent.findMany({
          where: { productId: product.id },
        })
        for (const row of bomRows) {
          const compQty = Math.round(row.quantity * item.quantity)
          if (compQty <= 0) continue
          const prev = comboCompDemands.get(row.componentProductId) ?? { compQty: 0, labels: [] }
          prev.compQty += compQty
          prev.labels.push(`"${product.name}" × ${item.quantity}`)
          comboCompDemands.set(row.componentProductId, prev)
        }
        comboIdsToSync.add(product.id)
      } else {
        const uCfg = unitConfigs[product.id] ?? null
        const sellRate = Math.max(1, Number(uCfg?.sellRate) || 1)
        let stockProdId = product.id
        if (uCfg?.linkedBaseProductId) {
          const baseExists = await tx.product.findUnique({
            where: { id: uCfg.linkedBaseProductId },
            select: { id: true },
          })
          if (baseExists) stockProdId = baseExists.id
        }
        const expectedBaseQty = Math.round(item.quantity * sellRate)
        simpleProdDemands.set(stockProdId, (simpleProdDemands.get(stockProdId) ?? 0) + expectedBaseQty)
      }
    }

    for (const [compId, demand] of comboCompDemands.entries()) {
      const comp = await tx.product.findUnique({ where: { id: compId } })
      if (!comp) continue

      const compMovs = priorMovements.filter(
        (m) => m.type === 'COMBO_ISSUE' && m.productId === comp.id
      )
      const actualCompRestock =
        compMovs.length > 0
          ? compMovs.reduce((s, m) => s + Math.max(0, -m.quantity), 0)
          : demand.compQty
      const comboSummary = demand.labels.join(', ')

      if (actualCompRestock > 0) {
        const updatedComp = await tx.product.update({
          where: { id: comp.id },
          data: {
            stock: { increment: actualCompRestock },
            status: 'ACTIVE',
          },
        })
        const afterStock = updatedComp.stock

        const effectiveWhId = targetWhId || comp.ownerWarehouseId
        if (effectiveWhId) {
          await tx.warehouseStock.updateMany({
            where: { warehouseId: effectiveWhId, productId: comp.id },
            data: { quantity: { increment: actualCompRestock } },
          })
        }

        await tx.stockMovement.create({
          data: {
            productId: comp.id,
            warehouseId: effectiveWhId ?? null,
            type: 'RETURN',
            quantity: actualCompRestock,
            stockAfter: afterStock,
            note: `Hoàn thành phần combo ${comboSummary} do hủy đơn ${targetOrder.code}${reason ? ` (${reason})` : ''}`,
          },
        })
        restockedProductIds.push(comp.id)
      } else {
        const effectiveWhId = targetWhId || comp.ownerWarehouseId
        await tx.stockMovement.create({
          data: {
            productId: comp.id,
            warehouseId: effectiveWhId ?? null,
            type: 'RETURN',
            quantity: 0,
            stockAfter: comp.stock,
            note: `Hủy đơn combo ${comboSummary} (${targetOrder.code}) — giữ nguyên kho thành phần = ${comp.stock} (đơn trước đó nhận khi kho CMS = 0, chưa trừ tồn vật lý)`,
          },
        })
      }
    }

    for (const [stockProdId, totalExpectedQty] of simpleProdDemands.entries()) {
      const product = await tx.product.findUnique({ where: { id: stockProdId } })
      if (!product) continue

      // Restock simple product according to exact previously deducted quantity across all order lines of this SKU
      const prodMovs = priorMovements.filter(
        (m) => m.type === 'EXPORT' && m.productId === product.id
      )
      const actualRestockQty =
        prodMovs.length > 0
          ? prodMovs.reduce((s, m) => s + Math.max(0, -m.quantity), 0)
          : totalExpectedQty
      const cancelledShortage = Math.max(0, totalExpectedQty - actualRestockQty)

      let nextAttrJson: string | undefined
      if (product.attributes && (cancelledShortage > 0 || actualRestockQty > 0)) {
        try {
          const attrs = JSON.parse(product.attributes) as Record<string, unknown>
          let mutatedAttrs = false
          if (actualRestockQty > 0 && typeof attrs.mode1HoldBaselineStock === 'number') {
            delete attrs.mode1HoldBaselineStock
            delete attrs.mode1HoldSetAt
            mutatedAttrs = true
          }
          if (cancelledShortage > 0) {
            const prevShortage = Math.max(0, Number(attrs.pendingOrderShortageQty) || 0)
            const nextShortage = Math.max(0, prevShortage - cancelledShortage)
            attrs.pendingOrderShortageQty = nextShortage
            const afterCandidate = product.stock + actualRestockQty
            const liveSp =
              typeof attrs.liveShopeeStock === 'number' ? attrs.liveShopeeStock : afterCandidate
            if (nextShortage === 0 && afterCandidate === liveSp) {
              attrs.reconciliationStatus = 'RECONCILED_OK'
              attrs.unreconciledShopeeDelta = 0
            }
            mutatedAttrs = true
          }
          if (mutatedAttrs) {
            nextAttrJson = JSON.stringify(attrs)
          }
        } catch {
          nextAttrJson = undefined
        }
      }

      if (actualRestockQty > 0) {
        const updatedProduct = await tx.product.update({
          where: { id: product.id },
          data: {
            stock: { increment: actualRestockQty },
            status: 'ACTIVE',
            ...(nextAttrJson ? { attributes: nextAttrJson } : {}),
          },
        })
        const afterStock = updatedProduct.stock

        const effectiveWhId = targetWhId || product.ownerWarehouseId
        if (effectiveWhId) {
          await tx.warehouseStock.updateMany({
            where: { warehouseId: effectiveWhId, productId: product.id },
            data: { quantity: { increment: actualRestockQty } },
          })
        }

        await tx.stockMovement.create({
          data: {
            productId: product.id,
            warehouseId: effectiveWhId ?? null,
            type: 'RETURN',
            quantity: actualRestockQty,
            stockAfter: afterStock,
            note: `Hoàn kho do hủy đơn ${targetOrder.code}${reason ? ` (${reason})` : ''}`,
          },
        })
        restockedProductIds.push(product.id)
      } else {
        if (nextAttrJson) {
          await tx.product.update({
            where: { id: product.id },
            data: { attributes: nextAttrJson },
          })
        }
        const effectiveWhId = targetWhId || product.ownerWarehouseId
        await tx.stockMovement.create({
          data: {
            productId: product.id,
            warehouseId: effectiveWhId ?? null,
            type: 'RETURN',
            quantity: 0,
            stockAfter: product.stock,
            note: `Hủy đơn ${targetOrder.code} — giữ nguyên kho CMS = ${product.stock} (đơn Live trước đó nhận khi kho CMS = 0, chưa trừ tồn vật lý)${reason ? ` · ${reason}` : ''}`,
          },
        })
      }
    }

    // 3. Sync combo availability and linked variants
    for (const comboId of comboIdsToSync) {
      await syncComboStock(tx, comboId)
    }
    if (restockedProductIds.length > 0) {
      await syncCombosUsingComponents(tx, restockedProductIds)
      await syncLinkedVariantStocks(tx, restockedProductIds)
    }

    // 4. Restore voucher usage count if applicable
    if (targetOrder.voucherCode) {
      const v = await tx.voucher.findUnique({ where: { code: targetOrder.voucherCode } })
      if (v && v.usedCount > 0) {
        await tx.voucher.update({
          where: { id: v.id },
          data: { usedCount: Math.max(0, v.usedCount - 1) },
        })
      }
    }

    return { alreadyCancelled: false, restockedIds: restockedProductIds }
  })

  if (result.alreadyCancelled) {
    return {
      ok: true,
      alreadyCancelled: true,
      orderId: targetOrder.id,
      orderCode: targetOrder.code,
      restockedCount: 0,
      restockedProductIds: [],
    }
  }

  // 5. Ensure warehouse stock matches product stock totals
  for (const pid of result.restockedIds) {
    await syncProductWarehouseStock(pid, targetOrder.warehouseId).catch(() => null)
  }

  // 6. Timeline, Lineage & Realtime broadcast
  await logEvent(
    targetOrder.id,
    'CANCELLED',
    actor,
    reason || `Đơn hàng bị hủy — hoàn kho tự động (${result.restockedIds.length} SKU)`
  )

  await recordLineageChangeAsync({
    scope: 'ORDER',
    action: 'ORDER_CANCELLED',
    entityType: 'Order',
    entityId: targetOrder.id,
    entityCode: targetOrder.code,
    title: `Hủy đơn ${targetOrder.code} — hoàn kho tự động`,
    before: { status: targetOrder.status, paymentStatus: targetOrder.paymentStatus },
    after: { status: 'CANCELLED', paymentStatus: targetOrder.paymentStatus },
    actor,
    actorName,
    originSource,
    detail: { restockedCount: result.restockedIds.length, reason: reason || null },
  })

  cancelPendingShopeePrintJob(targetOrder.id, 'ORDER_CANCELLED')

  broadcast('order.updated', { id: targetOrder.id, status: 'CANCELLED', code: targetOrder.code })
  if (result.restockedIds.length > 0) {
    broadcast('inventory.updated', { orderId: targetOrder.id, restoredCount: result.restockedIds.length })
    const policy = await getInventorySyncPolicy().catch(() => null)
    if (policy?.syncMode === 'SYNC_CMS_TO_MARKETPLACE') {
      fetch(
        `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT || '51898'}/shopee/trigger-sync`,
        { method: 'POST' }
      ).catch(() => null)
    }
  }

  return {
    ok: true,
    alreadyCancelled: false,
    orderId: targetOrder.id,
    orderCode: targetOrder.code,
    restockedCount: result.restockedIds.length,
    restockedProductIds: result.restockedIds,
  }
}
