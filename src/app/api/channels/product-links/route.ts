import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { syncCombosUsingComponents } from '@/lib/combo'
import { logLedger } from '@/lib/ledger'
import { broadcast, getApiCache, getProductFromApiCache, invalidateApiCache, patchProductInApiCache, setApiCache } from '@/lib/realtime'
import { ensureWarehousesAndVouchersSeeded, syncProductWarehouseStock } from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

export interface UnlinkedMarketplaceItem {
  id: string
  channelKey: string
  shopeeItemId: string
  shopeeModelId: string
  shopeeSku: string
  parentSku: string
  name: string
  modelName: string
  description?: string
  sellPrice: number
  stock: number
  image: string | null
  images: string[]
  isUnlisted: boolean
  shopId: string
  shopUsername: string
  detectedAt: string
  suggestedCmsProducts: Array<{
    id: string
    sku: string
    name: string
    sellPrice: number
    stock: number
    score: number
    reason: string
  }>
}

export interface LinkedMarketplaceItem {
  cmsProductId: string
  cmsSku: string
  cmsName: string
  cmsStock: number
  cmsSellPrice: number
  cmsImage: string | null
  channelKey: string
  shopeeItemId: string
  shopeeModelId: string
  shopeeModelSku: string
  shopeeModelName: string
  lastSyncedShopeeStock: number
  lastSyncedShopeePrice: number
  liveShopeeStock: number
  openingStockOrigin: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE'
  openingStockOriginLabel: string
  openingStockQty: number
  shopeeSoldQty: number
  posSoldQty: number
  shopeeAdjustDelta: number
  manualDelta: number
  expectedStockByFormula: number
  unreconciledShopeeDelta: number
  reconciliationStatus:
    | 'RECONCILED_OK'
    | 'PENDING_SHOPEE_ORDER'
    | 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
    | 'SHOPEE_DIRECT_ADJUSTED'
    | 'STOCK_DRIFT'
  lastReconcileDecision?: string
  lastReconcileDecisionLabel?: string
  lastReconcileReason?: string
  lastReconcileAt?: string
  reconciledOrders: Array<{
    code: string
    channelKey: string
    shopeeOrderSn?: string
    quantity: number
    createdAt: string
  }>
  linkMode: string
  lastSyncedAt: string | null
  syncStatus: 'IN_SYNC' | 'STOCK_DRIFT' | 'PRICE_DRIFT'
  isUnlisted?: boolean
  lowStockThreshold?: number
  pendingOutboxSync?: boolean
}

function computeSimilarityScore(
  unlinked: { shopeeSku: string; parentSku: string; name: string; modelName: string; sellPrice: number },
  cmsProd: { sku: string; name: string; sellPrice: number }
): { score: number; reason: string } {
  let score = 0
  const reasons: string[] = []

  const uSku = (unlinked.shopeeSku || '').toUpperCase().trim()
  const pSku = (unlinked.parentSku || '').toUpperCase().trim()
  const cSku = cmsProd.sku.toUpperCase().trim()

  if (uSku && cSku === uSku) {
    score += 95
    reasons.push('Trùng khớp hoàn toàn mã SKU')
  } else if (uSku && (cSku.includes(uSku) || uSku.includes(cSku))) {
    score += 65
    reasons.push('Mã SKU gần giống')
  } else if (pSku && cSku.startsWith(pSku)) {
    score += 45
    reasons.push(`Cùng họ mã gốc ${pSku}`)
  }

  const mName = (unlinked.modelName || '').toLowerCase()
  const cName = cmsProd.name.toLowerCase()
  if (mName && cName.includes(mName)) {
    score += 35
    reasons.push(`Tên chứa phân loại «${unlinked.modelName}»`)
  } else if (mName.includes('combo') && (cSku.includes('COMBO') || cName.includes('combo'))) {
    score += 40
    reasons.push('Cùng phân loại Combo')
  }

  if (unlinked.sellPrice > 0 && Math.abs(unlinked.sellPrice - cmsProd.sellPrice) <= 1000) {
    score += 25
    reasons.push('Cùng mức giá bán')
  }

  return {
    score: Math.min(100, score),
    reason: reasons.join(' · ') || 'Cùng danh mục sản phẩm',
  }
}

// GET /api/channels/product-links — Lấy danh sách sản phẩm Đã liên kết, Chưa liên kết (cần ghép nối SKU) và danh sách hàng hóa CMS
export async function GET() {
  try {
    const cached = getApiCache<Record<string, unknown>>('channels:product-links')
    if (cached) {
      return NextResponse.json(cached)
    }

    const [allProducts, unlinkedLedgers, activeOrders, allStockMovements] = await Promise.all([
      db.product.findMany({
        orderBy: { updatedAt: 'desc' },
      }),
      db.ledgerEntry.findMany({
        where: {
          scope: 'CHANNEL',
          action: 'UNLINKED_MARKETPLACE_ITEM',
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.order.findMany({
        where: {
          status: { not: 'CANCELLED' },
        },
        include: {
          channel: { select: { key: true } },
          items: { select: { productId: true, quantity: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.stockMovement.findMany({
        select: {
          productId: true,
          type: true,
          quantity: true,
          note: true,
        },
      }),
    ])

    // Lập chỉ mục đối chiếu đơn hàng & biến động kho theo productId
    const orderStatsByProduct = new Map<
      string,
      {
        shopeeSoldQty: number
        posSoldQty: number
        reconciledOrders: Array<{
          code: string
          channelKey: string
          shopeeOrderSn?: string
          quantity: number
          createdAt: string
        }>
      }
    >()

    for (const ord of activeOrders) {
      const chKey = ord.channel?.key || 'POS'
      const snMatch = ord.note ? ord.note.match(/(?:Shopee\s*#|order_sn[:\s]*)([A-Z0-9_-]{8,})/i) : null
      const shopeeOrderSn = snMatch ? snMatch[1] : undefined
      for (const it of ord.items) {
        const cur = orderStatsByProduct.get(it.productId) || {
          shopeeSoldQty: 0,
          posSoldQty: 0,
          reconciledOrders: [],
        }
        if (chKey === 'SHOPEE') {
          cur.shopeeSoldQty += it.quantity
        } else {
          cur.posSoldQty += it.quantity
        }
        cur.reconciledOrders.push({
          code: ord.code,
          channelKey: chKey,
          shopeeOrderSn,
          quantity: it.quantity,
          createdAt: ord.createdAt.toISOString(),
        })
        orderStatsByProduct.set(it.productId, cur)
      }
    }

    const movementDeltaByProduct = new Map<
      string,
      { inPeriodDelta: number; shopeeAdjustDelta: number; manualDelta: number }
    >()
    for (const m of allStockMovements) {
      const noteUpper = (m.note || '').toUpperCase()
      if (noteUpper.includes('[GỐC TỒN ĐẦU')) continue
      const cur = movementDeltaByProduct.get(m.productId) || {
        inPeriodDelta: 0,
        shopeeAdjustDelta: 0,
        manualDelta: 0,
      }
      cur.inPeriodDelta += m.quantity
      const isOrderExport = m.type === 'EXPORT' && (m.note || '').includes('Xuất kho cho đơn')
      const isShopeeDirectAdjust = noteUpper.includes('[ĐỐI SOÁT ĐIỀU CHỈNH TỪ SÀN SHOPEE]')
      if (isShopeeDirectAdjust) {
        cur.shopeeAdjustDelta += m.quantity
      } else if (!isOrderExport) {
        cur.manualDelta += m.quantity
      }
      movementDeltaByProduct.set(m.productId, cur)
    }

    const linkedItems: LinkedMarketplaceItem[] = []
    const linkedModelKeys = new Set<string>()

    for (const p of allProducts) {
      if (p.status === 'INACTIVE') continue
      if (!p.attributes) continue
      let attrs: Record<string, unknown> = {}
      try {
        attrs = JSON.parse(p.attributes) as Record<string, unknown>
      } catch {
        continue
      }
      const shopeeItemId = String(attrs.shopeeItemId || '').trim()
      const shopeeModelId = String(attrs.shopeeModelId || '').trim()
      if (!shopeeItemId) continue

      const modelKey = `${shopeeItemId}_${shopeeModelId}`
      linkedModelKeys.add(modelKey)

      const lastSyncedStock =
        typeof attrs.lastSyncedShopeeStock === 'number' ? attrs.lastSyncedShopeeStock : p.stock
      const lastSyncedPrice =
        typeof attrs.lastSyncedShopeePrice === 'number' ? attrs.lastSyncedShopeePrice : p.sellPrice
      const liveShopeeStock =
        typeof attrs.liveShopeeStock === 'number' ? attrs.liveShopeeStock : lastSyncedStock

      const ordStats = orderStatsByProduct.get(p.id) || {
        shopeeSoldQty: 0,
        posSoldQty: 0,
        reconciledOrders: [],
      }
      const movStats = movementDeltaByProduct.get(p.id) || {
        inPeriodDelta: 0,
        shopeeAdjustDelta: 0,
        manualDelta: 0,
      }

      const openingStockOrigin: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE' =
        attrs.openingStockOrigin === 'CMS_WAREHOUSE' ? 'CMS_WAREHOUSE' : 'SHOPEE_MARKETPLACE'
      const openingStockOriginLabel = String(
        attrs.openingStockOriginLabel ||
          (openingStockOrigin === 'SHOPEE_MARKETPLACE'
            ? `Gốc tồn đầu từ Sàn Shopee (${String(attrs.shopUsername || 'thaimy1605')})`
            : 'Gốc tồn đầu tại Kho CMS (KHO-TRUNG-TAM)')
      )
      const openingStockQty =
        typeof attrs.openingStockQty === 'number'
          ? attrs.openingStockQty
          : p.stock - movStats.inPeriodDelta

      const expectedStockByFormula =
        openingStockQty -
        ordStats.shopeeSoldQty -
        ordStats.posSoldQty +
        movStats.shopeeAdjustDelta +
        movStats.manualDelta

      let reconciliationStatus: LinkedMarketplaceItem['reconciliationStatus'] = 'RECONCILED_OK'
      if (
        p.stock === 0 &&
        liveShopeeStock > 0 &&
        attrs.reconciliationStatus === 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
      ) {
        reconciliationStatus = 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
      } else if (attrs.reconciliationStatus === 'SHOPEE_DIRECT_ADJUSTED' && liveShopeeStock !== p.stock) {
        reconciliationStatus = 'SHOPEE_DIRECT_ADJUSTED'
      } else if (attrs.reconciliationStatus === 'PENDING_SHOPEE_ORDER' && liveShopeeStock < p.stock) {
        reconciliationStatus = 'PENDING_SHOPEE_ORDER'
      } else if (liveShopeeStock !== p.stock || lastSyncedStock !== p.stock) {
        reconciliationStatus =
          p.stock === 0 && liveShopeeStock > 0 ? 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK' : 'STOCK_DRIFT'
      }

      let syncStatus: 'IN_SYNC' | 'STOCK_DRIFT' | 'PRICE_DRIFT' = 'IN_SYNC'
      if (lastSyncedStock !== p.stock || liveShopeeStock !== p.stock) syncStatus = 'STOCK_DRIFT'
      else if (lastSyncedPrice !== p.sellPrice) syncStatus = 'PRICE_DRIFT'

      const isUnlisted = Boolean(attrs.isUnlistedOnShopee)
      const lastEditMs = attrs.lastCmsEditAt ? new Date(String(attrs.lastCmsEditAt)).getTime() : 0
      const pendingOutboxSync =
        attrs.pendingOutboxSync === true && lastEditMs > 0 && Date.now() - lastEditMs < 180_000

      linkedItems.push({
        cmsProductId: p.id,
        cmsSku: p.sku,
        cmsName: p.name,
        cmsStock: p.stock,
        cmsSellPrice: p.sellPrice,
        cmsImage: p.image,
        channelKey: 'SHOPEE',
        shopeeItemId,
        shopeeModelId,
        shopeeModelSku: String(attrs.shopeeModelSku || ''),
        shopeeModelName: String(attrs.shopeeModelName || attrs.modelName || ''),
        lastSyncedShopeeStock: lastSyncedStock,
        lastSyncedShopeePrice: lastSyncedPrice,
        liveShopeeStock,
        openingStockOrigin,
        openingStockOriginLabel,
        openingStockQty,
        shopeeSoldQty: ordStats.shopeeSoldQty,
        posSoldQty: ordStats.posSoldQty,
        shopeeAdjustDelta: movStats.shopeeAdjustDelta,
        manualDelta: movStats.manualDelta,
        expectedStockByFormula,
        unreconciledShopeeDelta: liveShopeeStock - p.stock,
        reconciliationStatus,
        lastReconcileDecision: attrs.lastReconcileDecision ? String(attrs.lastReconcileDecision) : undefined,
        lastReconcileDecisionLabel: attrs.lastReconcileDecisionLabel
          ? String(attrs.lastReconcileDecisionLabel)
          : undefined,
        lastReconcileReason: attrs.lastReconcileReason ? String(attrs.lastReconcileReason) : undefined,
        lastReconcileAt: attrs.lastReconcileAt ? String(attrs.lastReconcileAt) : undefined,
        reconciledOrders: ordStats.reconciledOrders,
        linkMode: String(attrs.linkMode || 'AUTO_SKU_MATCH'),
        lastSyncedAt: String(attrs.lastOutboundSyncAt || attrs.lastInboundSyncAt || p.updatedAt.toISOString()),
        syncStatus,
        isUnlisted,
        lowStockThreshold: p.lowStockThreshold || 5,
        pendingOutboxSync,
      })
    }

    // Lọc danh sách sản phẩm Sàn chưa liên kết (deduplicate theo shopeeItemId_shopeeModelId)
    const seenUnlinkedKeys = new Set<string>()
    const unlinkedItems: UnlinkedMarketplaceItem[] = []

    for (const entry of unlinkedLedgers) {
      if (!entry.detail) continue
      let d: Record<string, unknown> = {}
      try {
        d = JSON.parse(entry.detail) as Record<string, unknown>
      } catch {
        continue
      }
      const shopeeItemId = String(d.shopeeItemId || '').trim()
      const shopeeModelId = String(d.shopeeModelId || '').trim()
      if (!shopeeItemId) continue

      const modelKey = `${shopeeItemId}_${shopeeModelId}`
      // Nếu sản phẩm sàn này đã được liên kết với 1 hàng hóa CMS thì bỏ qua
      if (linkedModelKeys.has(modelKey) || seenUnlinkedKeys.has(modelKey)) continue
      seenUnlinkedKeys.add(modelKey)

      const shopeeSku = String(d.modelSku || d.sku || '').trim()
      const parentSku = String(d.parentSku || '').trim()
      const name = String(d.name || 'Sản phẩm Shopee').trim()
      const modelName = String(d.modelName || '').trim()
      const sellPrice = Number(d.sellPrice) || 0
      const stock = Number(d.stock) || 0

      // Tính điểm gợi ý ghép nối thông minh với các sản phẩm CMS hiện có
      const suggestions = allProducts
        .map((cp) => {
          const { score, reason } = computeSimilarityScore(
            { shopeeSku, parentSku, name, modelName, sellPrice },
            { sku: cp.sku, name: cp.name, sellPrice: cp.sellPrice }
          )
          return {
            id: cp.id,
            sku: cp.sku,
            name: cp.name,
            sellPrice: cp.sellPrice,
            stock: cp.stock,
            score,
            reason,
          }
        })
        .filter((s) => s.score >= 25)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)

      unlinkedItems.push({
        id: entry.id,
        channelKey: String(d.channelKey || 'SHOPEE'),
        shopeeItemId,
        shopeeModelId,
        shopeeSku,
        parentSku,
        name,
        modelName,
        description: String(d.description || name),
        sellPrice,
        stock,
        image: (d.image as string) || null,
        images: Array.isArray(d.images) ? (d.images as string[]) : [],
        isUnlisted: Boolean(d.isUnlisted),
        shopId: String(d.shopId || '197195817'),
        shopUsername: String(d.shopUsername || 'thaimy1605'),
        detectedAt: entry.createdAt.toISOString(),
        suggestedCmsProducts: suggestions,
      })
    }

    const cmsProducts = allProducts.map((p) => {
      let linkedModelId = ''
      if (p.attributes) {
        try {
          const a = JSON.parse(p.attributes) as Record<string, unknown>
          linkedModelId = String(a.shopeeModelId || '')
        } catch {
          // ignore
        }
      }
      return {
        id: p.id,
        sku: p.sku,
        name: p.name,
        sellPrice: p.sellPrice,
        stock: p.stock,
        image: p.image,
        linkedShopeeModelId: linkedModelId || null,
      }
    })

    const payload = {
      ok: true,
      stats: {
        totalMarketplaceItems: linkedItems.length + unlinkedItems.length,
        linkedCount: linkedItems.length,
        unlinkedCount: unlinkedItems.length,
        driftCount: linkedItems.filter((i) => i.syncStatus !== 'IN_SYNC').length,
        unlistedCount: linkedItems.filter((i) => i.isUnlisted).length,
        oversellRiskCount: linkedItems.filter((i) => !i.isUnlisted && i.cmsStock <= 0).length,
        lowStockRiskCount: linkedItems.filter(
          (i) => !i.isUnlisted && i.cmsStock > 0 && i.cmsStock <= (i.lowStockThreshold ?? 5)
        ).length,
        pendingOutboxCount: linkedItems.filter((i) => i.pendingOutboxSync).length,
      },
      linkedItems,
      unlinkedItems,
      cmsProducts,
    }
    setApiCache('channels:product-links', payload, 15_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/channels/product-links error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách liên kết sản phẩm' }, { status: 500 })
  }
}

// POST /api/channels/product-links — Thực hiện Liên kết, Tạo mới & Liên kết, hoặc Hủy liên kết
export async function POST(req: NextRequest) {
  try {
    invalidateApiCache('channels:product-links')
    const body = (await req.json()) as {
      action:
        | 'LINK_TO_EXISTING'
        | 'CREATE_AND_LINK'
        | 'UNLINK'
        | 'PUSH_STOCK_TO_CHANNEL'
        | 'TOGGLE_CHANNEL_STATUS'
        | 'BULK_CHANNEL_ACTION'
        | 'BULK_CREATE_AND_LINK'
        | 'RESOLVE_OPENING_OR_RECONCILE'
      cmsProductId?: string
      productId?: string
      productIds?: string[]
      resolveMode?:
        | 'TAKE_OPENING_FROM_MARKETPLACE'
        | 'KEEP_WAREHOUSE_AND_PUSH'
        | 'RECONCILE_SHOPEE_ORDERS'
        | 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'
      adjustReason?: string
      stockInitMode?: 'TAKE_FROM_MARKETPLACE' | 'KEEP_WAREHOUSE_STOCK'
      bulkType?:
        | 'PUSH_STOCK_AND_PRICE'
        | 'SET_ACTIVE'
        | 'SET_UNLISTED'
        | 'UPDATE_PRICE_AND_STOCK'
        | 'ASSIGN_CATEGORY'
        | 'SET_CMS_STATUS'
        | 'UNLINK'
      priceMode?: 'NONE' | 'SET' | 'ADD_AMOUNT' | 'ADD_PERCENT'
      priceValue?: number
      stockMode?: 'NONE' | 'SET' | 'ADD_DELTA'
      stockValue?: number
      categoryId?: string | null
      cmsStatus?: 'ACTIVE' | 'INACTIVE'
      unlinkedItems?: Array<{
        shopeeItemId: string
        shopeeModelId: string
        shopeeSku?: string
        parentSku?: string
        name: string
        modelName?: string
        description?: string
        sellPrice?: number
        stock?: number
        image?: string | null
        images?: string[]
        isUnlisted?: boolean
        shopId?: string
        shopUsername?: string
      }>
      channelId?: string
      channelKey?: string
      nextStatus?: string
      shopeeItemId?: string
      shopeeModelId?: string
      shopeeSku?: string
      parentSku?: string
      name?: string
      modelName?: string
      description?: string
      sellPrice?: number
      stock?: number
      image?: string | null
      images?: string[]
      isUnlisted?: boolean
      shopId?: string
      shopUsername?: string
      customSku?: string
      syncDirection?: 'CMS_TO_SHOPEE' | 'SHOPEE_TO_CMS'
    }

    const action = body.action
    const shopeeItemId = String(body.shopeeItemId || '').trim()
    const shopeeModelId = String(body.shopeeModelId || '').trim()

    // ===== 1. LIÊN KẾT SẢN PHẨM SÀN VỚI HÀNG HÓA CMS CÓ SẴN =====
    if (action === 'LINK_TO_EXISTING') {
      if (!body.cmsProductId || !shopeeItemId) {
        return NextResponse.json({ error: 'Thiếu cmsProductId hoặc shopeeItemId' }, { status: 400 })
      }
      const product = await db.product.findUnique({ where: { id: body.cmsProductId } })
      if (!product) {
        return NextResponse.json({ error: 'Không tìm thấy sản phẩm CMS để liên kết' }, { status: 404 })
      }

      // Nếu có sản phẩm CMS khác đang giữ liên kết shopeeModelId này thì gỡ liên kết cũ trước
      const allProds = await db.product.findMany({ where: { id: { not: product.id } } })
      for (const other of allProds) {
        if (!other.attributes) continue
        try {
          const oa = JSON.parse(other.attributes) as Record<string, unknown>
          if (
            String(oa.shopeeItemId || '') === shopeeItemId &&
            String(oa.shopeeModelId || '') === shopeeModelId
          ) {
            delete oa.shopeeItemId
            delete oa.shopeeModelId
            delete oa.shopeeModelSku
            delete oa.shopeeModelName
            delete oa.linkMode
            await db.product.update({
              where: { id: other.id },
              data: { attributes: JSON.stringify(oa) },
            })
          }
        } catch {
          // ignore
        }
      }

      let prevAttrs: Record<string, unknown> = {}
      try {
        prevAttrs = product.attributes ? (JSON.parse(product.attributes) as Record<string, unknown>) : {}
      } catch {
        prevAttrs = {}
      }

      // Nếu sản phẩm CMS này đang liên kết với một phân loại Shopee cũ KHÁC, trả phân loại cũ về hàng đợi Chưa liên kết để không mất dấu
      const prevLinkedItemId = String(prevAttrs.shopeeItemId || '').trim()
      const prevLinkedModelId = String(prevAttrs.shopeeModelId || '').trim()
      if (prevLinkedItemId && (prevLinkedItemId !== shopeeItemId || prevLinkedModelId !== shopeeModelId)) {
        const oldEntityCode = `${prevLinkedItemId}_${prevLinkedModelId}`
        const restoredOld = await db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: 'CHANNEL_PRODUCT_LINKED',
            entityCode: oldEntityCode,
          },
          data: {
            action: 'UNLINKED_MARKETPLACE_ITEM',
          },
        })
        if (restoredOld.count === 0) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'UNLINKED_MARKETPLACE_ITEM',
            entityType: 'Product',
            entityCode: oldEntityCode,
            title: `[GỠ LIÊN KẾT DO GHÉP ĐÈ] Sản phẩm Shopee (${String(prevAttrs.shopeeModelName || prevLinkedModelId)}) tách khỏi CMS [${product.sku}]`,
            detail: {
              channelKey: 'SHOPEE',
              shopeeItemId: prevLinkedItemId,
              shopeeModelId: prevLinkedModelId,
              sku: String(prevAttrs.shopeeModelSku || ''),
              modelSku: String(prevAttrs.shopeeModelSku || ''),
              modelName: String(prevAttrs.shopeeModelName || ''),
              name: product.name,
              sellPrice: Number(prevAttrs.lastSyncedShopeePrice) || product.sellPrice,
              stock:
                typeof prevAttrs.lastSyncedShopeeStock === 'number'
                  ? prevAttrs.lastSyncedShopeeStock
                  : product.stock,
              image: product.image,
            },
            actor: 'OPERATOR',
            originSource: 'SHOPEE_SYNC',
          })
        }
      }

      const takeFromMarketplace =
        body.stockInitMode === 'TAKE_FROM_MARKETPLACE' || body.syncDirection === 'SHOPEE_TO_CMS'
      const syncDir: 'SHOPEE_TO_CMS' | 'CMS_TO_SHOPEE' = takeFromMarketplace ? 'SHOPEE_TO_CMS' : 'CMS_TO_SHOPEE'
      const shopeeStock = Number.isFinite(Number(body.stock)) ? Number(body.stock) : product.stock
      const shopeePrice = Number(body.sellPrice) > 0 ? Number(body.sellPrice) : product.sellPrice
      const prevWarehouseStock = product.stock
      const nextStock = takeFromMarketplace ? shopeeStock : product.stock
      const shopUsername = String(body.shopUsername || prevAttrs.shopUsername || 'thaimy1605')

      const openingStockOrigin: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE' = takeFromMarketplace
        ? 'SHOPEE_MARKETPLACE'
        : 'CMS_WAREHOUSE'
      const openingStockOriginLabel = takeFromMarketplace
        ? `Gốc tồn đầu từ Sàn Shopee (${shopUsername} · Item #${shopeeItemId})`
        : `Gốc tồn đầu tại Kho CMS (KHO-TRUNG-TAM · Tồn kho: ${prevWarehouseStock} bộ)`

      const nextAttrs = {
        ...prevAttrs,
        brandLine: 'An Nhiên Thạch · Shopee Linked',
        shopeeItemId,
        shopeeModelId,
        shopeeModelSku: String(body.shopeeSku || prevAttrs.shopeeModelSku || ''),
        shopeeModelName: String(body.modelName || prevAttrs.shopeeModelName || ''),
        shopId: String(body.shopId || prevAttrs.shopId || '197195817'),
        shopUsername,
        linkMode: 'MANUAL_LINKED',
        linkedAt: new Date().toISOString(),
        openingStockOrigin,
        openingStockOriginLabel,
        openingStockQty: nextStock,
        openingStockLockedAt: new Date().toISOString(),
        liveShopeeStock: takeFromMarketplace ? nextStock : shopeeStock,
        unreconciledShopeeDelta: 0,
        reconciliationStatus: 'RECONCILED_OK',
        lastSyncedShopeeStock: takeFromMarketplace ? nextStock : shopeeStock,
        lastSyncedShopeePrice: shopeePrice,
      }

      const updated = await db.product.update({
        where: { id: product.id },
        data: {
          stock: nextStock,
          image: product.image || body.image || null,
          attributes: JSON.stringify(nextAttrs),
          status: nextStock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
        },
      })

      const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
      if (defaultWh && takeFromMarketplace) {
        await syncProductWarehouseStock(updated.id, defaultWh.id)
      }

      // Khi chọn lấy số tồn từ Sàn làm Tồn đầu kỳ: Ghi nhận rõ Phiếu Chốt Gốc Tồn Đầu Từ Sàn Shopee vào StockMovement & Sổ Data
      if (takeFromMarketplace) {
        await db.stockMovement.create({
          data: {
            productId: updated.id,
            warehouseId: defaultWh?.id ?? null,
            type: 'IMPORT',
            quantity: nextStock,
            stockAfter: nextStock,
            note: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Chốt tồn đầu kỳ từ Sàn Shopee (Shop ${shopUsername} · Item #${shopeeItemId} / Model #${shopeeModelId}): Tồn đầu = ${nextStock} bộ (Kho trước chốt: ${prevWarehouseStock} ➔ Sau chốt: ${nextStock})`,
          },
        })
        await logLedger({
          scope: 'INVENTORY',
          action: 'OPENING_STOCK_FROM_MARKETPLACE',
          entityType: 'Product',
          entityId: updated.id,
          entityCode: updated.sku,
          title: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Chốt tồn đầu kỳ [${updated.sku}] = ${nextStock} bộ từ Sàn Shopee (${shopUsername} · #${shopeeItemId})`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            source: 'SHOPEE_SELLER_CENTER',
            target: 'OPENVN_CMS',
            sku: updated.sku,
            shopeeItemId,
            shopeeModelId,
            prevWarehouseStock,
            openingStockQty: nextStock,
            openingStockOrigin: 'SHOPEE_MARKETPLACE',
            openingStockOriginLabel,
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
      }

      const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
      if (shopeeChannel) {
        await db.channelListing.upsert({
          where: {
            productId_channelId: {
              productId: updated.id,
              channelId: shopeeChannel.id,
            },
          },
          update: {
            price: updated.sellPrice,
            status: body.isUnlisted ? 'UNLISTED' : 'ACTIVE',
            descriptionSyncedAt: new Date(),
          },
          create: {
            productId: updated.id,
            channelId: shopeeChannel.id,
            price: updated.sellPrice,
            status: body.isUnlisted ? 'UNLISTED' : 'ACTIVE',
            description: updated.description || updated.name,
            descriptionSyncedAt: new Date(),
          },
        })
      }

      // Đánh dấu các bản ghi UNLINKED_MARKETPLACE_ITEM của model này thành CHANNEL_PRODUCT_LINKED
      await db.ledgerEntry.updateMany({
        where: {
          scope: 'CHANNEL',
          action: 'UNLINKED_MARKETPLACE_ITEM',
          entityCode: `${shopeeItemId}_${shopeeModelId}`,
        },
        data: {
          action: 'CHANNEL_PRODUCT_LINKED',
        },
      })

      // Nếu chọn chiều CMS_TO_SHOPEE và tồn kho khác nhau -> đẩy ngay vào Outbox để đồng bộ lên Shopee
      if (syncDir === 'CMS_TO_SHOPEE') {
        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_PENDING',
          entityType: 'Product',
          entityId: updated.id,
          entityCode: updated.sku,
          title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đẩy tồn kho [${updated.sku}] (${updated.stock}) lên Shopee Model ${shopeeModelId}`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            source: 'OPENVN_CMS',
            target: 'SHOPEE_SELLER_CENTER',
            sku: updated.sku,
            shopeeItemId,
            shopeeModelId,
            targetStock: updated.stock,
            reason: 'MANUAL_PRODUCT_LINK_SYNC',
          },
          actor: 'OPERATOR',
          originSource: 'SHOPEE_SYNC',
        })
      }

      await logLedger({
        scope: 'CHANNEL',
        action: 'CHANNEL_PRODUCT_LINKED',
        entityType: 'Product',
        entityId: updated.id,
        entityCode: updated.sku,
        title: `[LIÊN KẾT SẢN PHẨM] [${updated.sku}] ↔ Shopee (${body.modelName || shopeeModelId}) · Chiều: ${syncDir === 'CMS_TO_SHOPEE' ? '[CMS ➔ SÀN SHOPEE]' : '[SÀN SHOPEE ➔ CMS]'}`,
        detail: {
          direction: syncDir,
          cmsProductId: updated.id,
          cmsSku: updated.sku,
          shopeeItemId,
          shopeeModelId,
          shopeeSku: body.shopeeSku,
          syncDirection: syncDir,
          finalStock: updated.stock,
        },
        actor: 'OPERATOR',
        originSource: 'SHOPEE_SYNC',
      })

      broadcast('inventory.updated', { productId: updated.id, sku: updated.sku, stockAfter: updated.stock })
      broadcast('channel.product_linked', {
        cmsProductId: updated.id,
        cmsSku: updated.sku,
        shopeeItemId,
        shopeeModelId,
      })
      if (syncDir === 'CMS_TO_SHOPEE') {
        fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)
      }

      return NextResponse.json({
        ok: true,
        action: 'LINKED',
        product: {
          id: updated.id,
          sku: updated.sku,
          name: updated.name,
          stock: updated.stock,
          sellPrice: updated.sellPrice,
        },
      })
    }

    // ===== 2. TẠO MỚI HÀNG HÓA CMS TỪ SẢN PHẨM SÀN CHƯA CÓ SKU & LIÊN KẾT NGAY =====
    if (action === 'CREATE_AND_LINK') {
      const targetSku = String(body.customSku || body.shopeeSku || `SP-${shopeeModelId || shopeeItemId}`)
        .trim()
        .toUpperCase()
      const name = String(body.name || 'Sản phẩm Shopee').trim()
      if (!targetSku || !shopeeItemId) {
        return NextResponse.json({ error: 'Cần nhập mã SKU mới để tạo và liên kết' }, { status: 400 })
      }

      const existingSku = await db.product.findUnique({ where: { sku: targetSku } })
      if (existingSku && existingSku.status !== 'INACTIVE') {
        return NextResponse.json(
          { error: `Mã SKU «${targetSku}» đã tồn tại trong CMS. Vui lòng chọn "Liên kết với hàng hóa có sẵn".` },
          { status: 400 }
        )
      }

      // Chặn tạo thêm sản phẩm CMS thứ 2 cho cùng phân loại Shopee đã được liên kết với một sản phẩm đang hoạt động
      const allActiveProds = await db.product.findMany({ where: { status: { not: 'INACTIVE' } } })
      for (const ap of allActiveProds) {
        if (!ap.attributes) continue
        try {
          const oa = JSON.parse(ap.attributes) as Record<string, unknown>
          if (
            String(oa.shopeeItemId || '') === shopeeItemId &&
            String(oa.shopeeModelId || '') === shopeeModelId
          ) {
            return NextResponse.json(
              {
                error: `Phân loại Shopee (${shopeeItemId}/${shopeeModelId}) đã được liên kết với sản phẩm CMS «${ap.sku}». Không thể tạo trùng.`,
              },
              { status: 409 }
            )
          }
        } catch {
          // ignore
        }
      }

      let category = await db.category.findFirst({ where: { slug: 'an-nhien-thach-thach-cao' } })
      if (!category) category = await db.category.findFirst()
      if (!category) {
        return NextResponse.json({ error: 'Chưa có danh mục sản phẩm trong hệ thống' }, { status: 400 })
      }

      const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
      const sellPrice = Number(body.sellPrice) > 0 ? Number(body.sellPrice) : 59000
      const costPrice = Math.round(sellPrice * 0.45)
      const shopeeStock = Number.isFinite(Number(body.stock)) ? Math.max(0, Number(body.stock)) : 0
      const takeFromMarketplace =
        body.stockInitMode !== 'KEEP_WAREHOUSE_STOCK' && body.syncDirection !== 'CMS_TO_SHOPEE'
      const stock = takeFromMarketplace ? shopeeStock : 0
      const shopUsername = String(body.shopUsername || 'thaimy1605')
      const openingStockOrigin: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE' = takeFromMarketplace
        ? 'SHOPEE_MARKETPLACE'
        : 'CMS_WAREHOUSE'
      const openingStockOriginLabel = takeFromMarketplace
        ? `Gốc tồn đầu từ Sàn Shopee (${shopUsername} · Item #${shopeeItemId})`
        : 'Gốc tồn đầu tại Kho CMS (Kho trống = 0 bộ)'

      const attrs = {
        brandLine: 'An Nhiên Thạch · Shopee Linked',
        shopeeItemId,
        shopeeModelId,
        shopeeModelSku: String(body.shopeeSku || targetSku),
        shopeeModelName: String(body.modelName || ''),
        parentSku: String(body.parentSku || ''),
        shopId: String(body.shopId || '197195817'),
        shopUsername,
        linkMode: 'CREATED_AND_LINKED',
        linkedAt: new Date().toISOString(),
        openingStockOrigin,
        openingStockOriginLabel,
        openingStockQty: stock,
        openingStockLockedAt: new Date().toISOString(),
        liveShopeeStock: shopeeStock,
        unreconciledShopeeDelta: 0,
        reconciliationStatus: 'RECONCILED_OK',
        lastSyncedShopeeStock: takeFromMarketplace ? stock : shopeeStock,
        lastSyncedShopeePrice: sellPrice,
        gallery: body.images || [],
      }

      const created = existingSku
        ? await db.product.update({
            where: { id: existingSku.id },
            data: {
              name: body.modelName && !name.includes(body.modelName) ? `${name} — Phân loại: ${body.modelName}` : name,
              description: body.description || name,
              costPrice,
              sellPrice,
              stock,
              image: body.image || existingSku.image || null,
              status: stock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
              attributes: JSON.stringify(attrs),
            },
          })
        : await db.product.create({
            data: {
              sku: targetSku,
              barcode: null,
              name: body.modelName && !name.includes(body.modelName) ? `${name} — Phân loại: ${body.modelName}` : name,
              description: body.description || name,
              categoryId: category.id,
              costPrice,
              sellPrice,
              stock,
              lowStockThreshold: 5,
              image: body.image || null,
              status: stock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
              attributes: JSON.stringify(attrs),
              unit: 'bộ',
              type: 'SIMPLE',
              fragile: true,
              ownerWarehouseId: defaultWh?.id ?? null,
            },
          })

      if (defaultWh) {
        await syncProductWarehouseStock(created.id, defaultWh.id)
      }

      if (takeFromMarketplace) {
        await db.stockMovement.create({
          data: {
            productId: created.id,
            warehouseId: defaultWh?.id ?? null,
            type: 'IMPORT',
            quantity: stock,
            stockAfter: stock,
            note: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Chốt tồn đầu kỳ từ Sàn Shopee (Shop ${shopUsername} · Item #${shopeeItemId} / Model #${shopeeModelId}): Tồn đầu = ${stock} bộ (Kho trống = 0 ➔ Lấy tồn đầu từ Sàn = ${stock})`,
          },
        })
        await logLedger({
          scope: 'INVENTORY',
          action: 'OPENING_STOCK_FROM_MARKETPLACE',
          entityType: 'Product',
          entityId: created.id,
          entityCode: created.sku,
          title: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Khởi tạo & chốt tồn đầu kỳ [${created.sku}] = ${stock} bộ từ Sàn Shopee (${shopUsername} · #${shopeeItemId})`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            source: 'SHOPEE_SELLER_CENTER',
            target: 'OPENVN_CMS',
            sku: created.sku,
            shopeeItemId,
            shopeeModelId,
            openingStockQty: stock,
            openingStockOrigin: 'SHOPEE_MARKETPLACE',
            openingStockOriginLabel,
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
      } else if (shopeeStock !== stock) {
        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_PENDING',
          entityType: 'Product',
          entityId: created.id,
          entityCode: created.sku,
          title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Giữ tồn Kho trống = 0 cho [${created.sku}] & đẩy lên Shopee Model ${shopeeModelId}`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            source: 'OPENVN_CMS',
            target: 'SHOPEE_SELLER_CENTER',
            sku: created.sku,
            shopeeItemId,
            shopeeModelId,
            targetStock: stock,
            reason: 'KEEP_WAREHOUSE_EMPTY_STOCK_ON_LINK',
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
        fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)
      }

      const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
      if (shopeeChannel) {
        await db.channelListing.upsert({
          where: {
            productId_channelId: {
              productId: created.id,
              channelId: shopeeChannel.id,
            },
          },
          update: {
            price: sellPrice,
            status: body.isUnlisted ? 'UNLISTED' : 'ACTIVE',
            description: created.description || created.name,
            descriptionSyncedAt: new Date(),
          },
          create: {
            productId: created.id,
            channelId: shopeeChannel.id,
            price: sellPrice,
            status: body.isUnlisted ? 'UNLISTED' : 'ACTIVE',
            description: created.description || created.name,
            descriptionSyncedAt: new Date(),
          },
        })
      }

      await db.ledgerEntry.updateMany({
        where: {
          scope: 'CHANNEL',
          action: 'UNLINKED_MARKETPLACE_ITEM',
          entityCode: `${shopeeItemId}_${shopeeModelId}`,
        },
        data: {
          action: 'CHANNEL_PRODUCT_LINKED',
        },
      })

      await logLedger({
        scope: 'CHANNEL',
        action: 'CHANNEL_PRODUCT_CREATED_AND_LINKED',
        entityType: 'Product',
        entityId: created.id,
        entityCode: created.sku,
        title: `[SÀN SHOPEE ➔ CMS] Tạo mới & Liên kết: Shopee (${body.modelName || shopeeModelId}) ➔ CMS [${created.sku}] (Tồn: ${stock}, Giá: ${sellPrice.toLocaleString('vi-VN')}đ)`,
        detail: {
          direction: 'SHOPEE_TO_CMS',
          cmsProductId: created.id,
          cmsSku: created.sku,
          shopeeItemId,
          shopeeModelId,
          sellPrice,
          stock,
        },
        actor: 'OPERATOR',
        originSource: 'SHOPEE_SYNC',
      })

      broadcast('inventory.updated', { productId: created.id, sku: created.sku, stockAfter: created.stock })

      return NextResponse.json({
        ok: true,
        action: 'CREATED_AND_LINKED',
        product: {
          id: created.id,
          sku: created.sku,
          name: created.name,
          stock: created.stock,
          sellPrice: created.sellPrice,
        },
      })
    }

    // ===== 3. HỦY LIÊN KẾT SẢN PHẨM SÀN KHỎI HÀNG HÓA CMS (ĐỂ GHÉP LẠI VỚI MÃ KHÁC) =====
    if (action === 'UNLINK') {
      if (!body.cmsProductId) {
        return NextResponse.json({ error: 'Thiếu cmsProductId cần hủy liên kết' }, { status: 400 })
      }
      const product = await db.product.findUnique({ where: { id: body.cmsProductId } })
      if (!product) {
        return NextResponse.json({ error: 'Không tìm thấy sản phẩm CMS' }, { status: 404 })
      }

      let attrs: Record<string, unknown> = {}
      try {
        attrs = product.attributes ? (JSON.parse(product.attributes) as Record<string, unknown>) : {}
      } catch {
        attrs = {}
      }

      const oldItemId = String(attrs.shopeeItemId || '')
      const oldModelId = String(attrs.shopeeModelId || '')
      const oldModelSku = String(attrs.shopeeModelSku || '')
      const oldModelName = String(attrs.shopeeModelName || '')

      delete attrs.shopeeItemId
      delete attrs.shopeeModelId
      delete attrs.shopeeModelSku
      delete attrs.shopeeModelName
      delete attrs.linkMode
      delete attrs.lastSyncedShopeeStock
      delete attrs.lastSyncedShopeePrice

      await db.product.update({
        where: { id: product.id },
        data: { attributes: JSON.stringify(attrs) },
      })

      // Nếu có sản phẩm CMS trùng lặp nào khác đang giữ cùng (oldItemId, oldModelId) thì gỡ luôn để tránh ẩn mất bản ghi UNLINKED
      if (oldItemId) {
        const otherProducts = await db.product.findMany({
          where: { id: { not: product.id } },
        })
        for (const op of otherProducts) {
          if (!op.attributes) continue
          try {
            const oa = JSON.parse(op.attributes) as Record<string, unknown>
            const opItemMatch = String(oa.shopeeItemId || '') === oldItemId
            const opModelMatch = oldModelId
              ? String(oa.shopeeModelId || '') === oldModelId
              : !oa.shopeeModelId || String(oa.shopeeModelId) === '0'
            if (opItemMatch && opModelMatch) {
              delete oa.shopeeItemId
              delete oa.shopeeModelId
              delete oa.shopeeModelSku
              delete oa.shopeeModelName
              delete oa.linkMode
              await db.product.update({
                where: { id: op.id },
                data: { attributes: JSON.stringify(oa) },
              })
            }
          } catch {
            // ignore
          }
        }
      }

      // Đưa sản phẩm Sàn vừa gỡ về lại danh sách Chưa liên kết (UNLINKED_MARKETPLACE_ITEM) để người dùng chọn liên kết mới
      if (oldItemId) {
        await logLedger({
          scope: 'CHANNEL',
          action: 'UNLINKED_MARKETPLACE_ITEM',
          entityType: 'Product',
          entityCode: `${oldItemId}_${oldModelId}`,
          title: `[GỠ LIÊN KẾT] Sản phẩm Shopee (${oldModelName || oldModelId}) vừa gỡ khỏi CMS [${product.sku}]`,
          detail: {
            channelKey: 'SHOPEE',
            direction: 'CMS_TO_SHOPEE',
            shopeeItemId: oldItemId,
            shopeeModelId: oldModelId,
            modelSku: oldModelSku,
            modelName: oldModelName,
            name: product.name,
            sellPrice: product.sellPrice,
            stock: product.stock,
            image: product.image,
          },
          actor: 'OPERATOR',
          originSource: 'SHOPEE_SYNC',
        })
      }

      return NextResponse.json({
        ok: true,
        action: 'UNLINKED',
        cmsSku: product.sku,
        shopeeItemId: oldItemId,
        shopeeModelId: oldModelId,
      })
    }

    // ===== 4. ĐẨY ĐỒNG BỘ TỒN KHO & GIÁ LÊN SÀN (OUTBOX DISPATCH) =====
    if (action === 'PUSH_STOCK_TO_CHANNEL') {
      const productId = String(body.productId || '').trim()
      const channelId = String(body.channelId || '').trim()
      if (!productId) return NextResponse.json({ error: 'Thiếu productId' }, { status: 400 })

      type ProductWithListings = NonNullable<
        Awaited<ReturnType<typeof db.product.findUnique<{ where: { id: string }; include: { listings: true } }>>>
      >
      let product = getProductFromApiCache<ProductWithListings>(productId)
      if (!product || !Array.isArray(product.listings)) {
        product = await db.product.findUnique({
          where: { id: productId },
          include: { listings: true },
        })
      }
      if (!product) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })

      let attrs: Record<string, unknown> = {}
      try {
        if (product.attributes) attrs = JSON.parse(product.attributes)
      } catch {}

      const shopeeItemId = String(attrs.shopeeItemId || '').trim()
      const shopeeModelId = String(attrs.shopeeModelId || '').trim()
      if (!shopeeItemId) {
        return NextResponse.json({ error: 'Sản phẩm chưa liên kết với sàn Shopee' }, { status: 400 })
      }

      const listing = channelId
        ? product.listings.find((l) => l.channelId === channelId)
        : product.listings.find((l) => l.channelId)
      const targetPrice = listing?.price ?? product.sellPrice
      const targetStock = product.stock

      // Ghi nhận trạng thái chờ đẩy Outbox; lastSyncedShopeeStock/Price/Unlisted chỉ cập nhật khi nhận OUTBOX_ACK_RESULT (status = COMPLETED)
      attrs.pendingOutboxSync = true
      attrs.cmsTargetStock = targetStock
      attrs.cmsTargetPrice = targetPrice
      attrs.cmsTargetUnlisted = Boolean(attrs.isUnlistedOnShopee)
      attrs.lastOutboxSyncAt = new Date().toISOString()
      attrs.lastCmsEditAt = new Date().toISOString()
      const nextAttrsJson = JSON.stringify(attrs)
      await db.product.update({
        where: { id: product.id },
        data: { attributes: nextAttrsJson },
      })

      void logLedger({
        scope: 'CHANNEL',
        action: 'OUTBOX_PENDING',
        entityType: 'Product',
        entityId: product.id,
        entityCode: product.sku,
        title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: Đẩy tồn kho [${product.sku}] (${targetStock}) & giá (${targetPrice.toLocaleString('vi-VN')}₫) lên Shopee`,
        detail: {
          direction: 'CMS_TO_SHOPEE',
          source: 'OPENVN_CMS',
          target: 'SHOPEE_SELLER_CENTER',
          sku: product.sku,
          shopeeItemId,
          shopeeModelId,
          targetStock,
          targetPrice,
          targetUnlisted: Boolean(attrs.isUnlistedOnShopee),
          reason: 'MANUAL_PUSH_FROM_PRODUCT_FORM',
        },
        actor: 'OPERATOR',
        originSource: 'SHOPEE_SYNC',
      })

      const inPlacePatched = patchProductInApiCache(product.id, { attributes: nextAttrsJson })
      broadcast('inventory.updated', { productId: product.id, sku: product.sku, stockAfter: targetStock, inPlacePatched })
      fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)

      return NextResponse.json({
        ok: true,
        action: 'PUSHED',
        sku: product.sku,
        targetStock,
        targetPrice,
        shopeeItemId,
        shopeeModelId,
      })
    }

    // ===== 5. ĐỔI TRẠNG THÁI SẢN PHẨM TRÊN SÀN (ACTIVE <-> UNLISTED) =====
    if (action === 'TOGGLE_CHANNEL_STATUS') {
      const productId = String(body.productId || '').trim()
      const rawChannelId = String(body.channelId || '').trim()
      const rawChannelKey = String(body.channelKey || 'SHOPEE').trim().toUpperCase()
      const nextStatus = String(body.nextStatus || 'ACTIVE').trim().toUpperCase()
      if (!productId) {
        return NextResponse.json({ error: 'Thiếu productId' }, { status: 400 })
      }

      const [product, channel] = await Promise.all([
        db.product.findUnique({ where: { id: productId } }),
        rawChannelId
          ? db.channel.findUnique({ where: { id: rawChannelId } })
          : db.channel.findUnique({ where: { key: rawChannelKey } }),
      ])
      if (!product) return NextResponse.json({ error: 'Không tìm thấy sản phẩm' }, { status: 404 })
      if (!channel) return NextResponse.json({ error: 'Không tìm thấy kênh bán' }, { status: 404 })
      const channelId = channel.id

      let attrs: Record<string, unknown> = {}
      try {
        if (product.attributes) attrs = JSON.parse(product.attributes)
      } catch {}

      const targetUnlisted = nextStatus === 'UNLISTED'

      if (channel.key === 'SHOPEE') {
        const linkedItemId = String(attrs.shopeeItemId || '').trim()
        const linkedModelId = String(attrs.shopeeModelId || '').trim()
        if (!linkedItemId) {
          return NextResponse.json(
            { error: 'Sản phẩm chưa liên kết với sàn Shopee' },
            { status: 400 }
          )
        }
        attrs.isUnlistedOnShopee = targetUnlisted
        attrs.cmsRequestedUnlisted = targetUnlisted
        attrs.cmsTargetUnlisted = targetUnlisted
        attrs.pendingOutboxSync = true
        attrs.lastCmsEditAt = new Date().toISOString()

        await Promise.all([
          db.product.update({
            where: { id: product.id },
            data: { attributes: JSON.stringify(attrs) },
          }),
          db.channelListing.upsert({
            where: { productId_channelId: { productId, channelId } },
            update: { status: nextStatus },
            create: { productId, channelId, status: nextStatus },
          }),
        ])

        // Thực thi bất đồng bộ đồng bộ các phân loại cùng Item ID và ghi sổ cái để trả về ngay tức thì
        void (async () => {
          try {
            const siblingProducts = await db.product.findMany({
              where: { id: { not: product.id }, status: { not: 'INACTIVE' } },
            })
            const siblingUpdates: Array<Promise<unknown>> = []
            for (const sp of siblingProducts) {
              if (!sp.attributes) continue
              try {
                const sa = JSON.parse(sp.attributes) as Record<string, unknown>
                if (String(sa.shopeeItemId || '').trim() === linkedItemId) {
                  sa.isUnlistedOnShopee = targetUnlisted
                  sa.cmsRequestedUnlisted = targetUnlisted
                  sa.lastSyncedShopeeUnlisted = targetUnlisted
                  delete sa.cmsTargetUnlisted
                  sa.lastCmsEditAt = new Date().toISOString()
                  siblingUpdates.push(
                    db.product.update({
                      where: { id: sp.id },
                      data: { attributes: JSON.stringify(sa) },
                    }),
                    db.channelListing.upsert({
                      where: { productId_channelId: { productId: sp.id, channelId } },
                      update: { status: nextStatus },
                      create: { productId: sp.id, channelId, status: nextStatus, price: sp.sellPrice },
                    })
                  )
                }
              } catch {
                // ignore
              }
            }
            await Promise.all([
              ...siblingUpdates,
              logLedger({
                scope: 'CHANNEL',
                action: 'OUTBOX_PENDING',
                entityType: 'Product',
                entityId: product.id,
                entityCode: product.sku,
                title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox: ${targetUnlisted ? 'Tạm ẩn' : 'Mở bán lại'} [${product.sku}] (Item #${linkedItemId}) trên Shopee`,
                detail: {
                  direction: 'CMS_TO_SHOPEE',
                  source: 'OPENVN_CMS',
                  target: 'SHOPEE_SELLER_CENTER',
                  operation: 'TOGGLE_UNLIST',
                  sku: product.sku,
                  shopeeItemId: linkedItemId,
                  shopeeModelId: linkedModelId,
                  targetStock: product.stock,
                  targetPrice: product.sellPrice,
                  targetUnlisted,
                  reason: 'MANUAL_TOGGLE_VISIBILITY_FROM_CMS',
                },
                actor: 'OPERATOR',
                originSource: 'SHOPEE_SYNC',
              }),
              logLedger({
                scope: 'CHANNEL',
                action: 'CHANNEL_LISTING_STATUS_CHANGED',
                entityType: 'Product',
                entityId: product.id,
                entityCode: product.sku,
                title: `[CMS ➔ ${channel.name}] Đổi trạng thái bán [${product.sku}]: ${nextStatus === 'UNLISTED' ? 'Tạm ẩn trên sàn' : nextStatus === 'ACTIVE' ? 'Đang bán trên sàn' : 'Ngừng bán'}`,
                detail: {
                  direction: 'CMS_TO_SHOPEE',
                  channelKey: channel.key,
                  status: nextStatus,
                  shopeeItemId: attrs.shopeeItemId,
                  shopeeModelId: attrs.shopeeModelId,
                },
                actor: 'OPERATOR',
                originSource: 'MANUAL_ADMIN',
              }),
            ])
          } catch (bgErr) {
            console.error('Background toggle channel status error:', bgErr)
          }
        })()
      } else {
        await db.channelListing.upsert({
          where: { productId_channelId: { productId, channelId } },
          update: { status: nextStatus },
          create: { productId, channelId, status: nextStatus },
        })
        void logLedger({
          scope: 'CHANNEL',
          action: 'CHANNEL_LISTING_STATUS_CHANGED',
          entityType: 'Product',
          entityId: product.id,
          entityCode: product.sku,
          title: `[CMS ➔ ${channel.name}] Đổi trạng thái bán [${product.sku}]: ${nextStatus === 'UNLISTED' ? 'Tạm ẩn trên sàn' : nextStatus === 'ACTIVE' ? 'Đang bán trên sàn' : 'Ngừng bán'}`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            channelKey: channel.key,
            status: nextStatus,
            shopeeItemId: attrs.shopeeItemId,
            shopeeModelId: attrs.shopeeModelId,
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
      }

      broadcast('product.updated', { productId: product.id, sku: product.sku, status: nextStatus })
      broadcast('channel.updated', { channelId, channelKey: channel.key, productId: product.id, status: nextStatus })
      fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)

      return NextResponse.json({
        ok: true,
        action: 'STATUS_UPDATED',
        channelId,
        channelKey: channel.key,
        status: nextStatus,
      })
    }

    // ===== 6. THAO TÁC HÀNG LOẠT TRÊN NHIỀU SẢN PHẨM CMS & SÀN SHOPEE =====
    if (action === 'BULK_CHANNEL_ACTION') {
      const productIds = Array.isArray(body.productIds)
        ? [...new Set(body.productIds.map((id) => String(id).trim()).filter(Boolean))]
        : []
      const bulkType = body.bulkType || 'PUSH_STOCK_AND_PRICE'
      if (productIds.length === 0) {
        return NextResponse.json({ error: 'Vui lòng chọn ít nhất 1 sản phẩm để thao tác hàng loạt' }, { status: 400 })
      }

      const [selectedProducts, allActiveProducts, shopeeChannel] = await Promise.all([
        db.product.findMany({
          where: { id: { in: productIds } },
          include: { listings: { include: { channel: true } } },
        }),
        db.product.findMany({ where: { status: { not: 'INACTIVE' } } }),
        db.channel.findUnique({ where: { key: 'SHOPEE' } }),
      ])

      if (selectedProducts.length === 0) {
        return NextResponse.json({ error: 'Không tìm thấy sản phẩm hợp lệ' }, { status: 404 })
      }

      const affectedSkus: string[] = []
      let outboxTriggered = false
      const nowIso = new Date().toISOString()

      // 6A. Đẩy đồng bộ Tồn kho & Giá bán hàng loạt lên Shopee (Song song hóa Promise.all)
      if (bulkType === 'PUSH_STOCK_AND_PRICE') {
        const pushResults = await Promise.all(
          selectedProducts.map(async (p) => {
            let attrs: Record<string, unknown> = {}
            try {
              if (p.attributes) attrs = JSON.parse(p.attributes)
            } catch {}
            const sItemId = String(attrs.shopeeItemId || '').trim()
            const sModelId = String(attrs.shopeeModelId || '').trim()
            if (!sItemId) return null

            const shListing = p.listings.find((l) => l.channel.key === 'SHOPEE')
            const targetPrice = shListing?.price ?? p.sellPrice
            const targetStock = p.stock

            attrs.pendingOutboxSync = true
            attrs.cmsTargetStock = targetStock
            attrs.cmsTargetPrice = targetPrice
            attrs.cmsTargetUnlisted = Boolean(attrs.isUnlistedOnShopee)
            attrs.lastOutboxSyncAt = nowIso
            attrs.lastCmsEditAt = nowIso

            await Promise.all([
              db.product.update({
                where: { id: p.id },
                data: { attributes: JSON.stringify(attrs) },
              }),
              logLedger({
                scope: 'CHANNEL',
                action: 'OUTBOX_PENDING',
                entityType: 'Product',
                entityId: p.id,
                entityCode: p.sku,
                title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox (Hàng loạt): Đẩy tồn kho [${p.sku}] (${targetStock}) & giá (${targetPrice.toLocaleString('vi-VN')}₫)`,
                detail: {
                  direction: 'CMS_TO_SHOPEE',
                  source: 'OPENVN_CMS',
                  target: 'SHOPEE_SELLER_CENTER',
                  sku: p.sku,
                  shopeeItemId: sItemId,
                  shopeeModelId: sModelId,
                  targetStock,
                  targetPrice,
                  targetUnlisted: Boolean(attrs.isUnlistedOnShopee),
                  reason: 'BULK_PUSH_FROM_CMS',
                },
                actor: 'OPERATOR',
                originSource: 'SHOPEE_SYNC',
              }),
            ])

            return p.sku
          })
        )
        for (const sku of pushResults) {
          if (sku) {
            affectedSkus.push(sku)
            outboxTriggered = true
          }
        }
      }

      // 6B. Mở bán / Tạm ẩn hàng loạt trên Sàn Shopee
      else if (bulkType === 'SET_ACTIVE' || bulkType === 'SET_UNLISTED') {
        const targetUnlisted = bulkType === 'SET_UNLISTED'
        const nextStatus = targetUnlisted ? 'UNLISTED' : 'ACTIVE'
        const handledItemIds = new Set<string>()

        for (const p of selectedProducts) {
          let attrs: Record<string, unknown> = {}
          try {
            if (p.attributes) attrs = JSON.parse(p.attributes)
          } catch {}
          const sItemId = String(attrs.shopeeItemId || '').trim()
          const sModelId = String(attrs.shopeeModelId || '').trim()

          if (shopeeChannel) {
            await db.channelListing.upsert({
              where: { productId_channelId: { productId: p.id, channelId: shopeeChannel.id } },
              update: { status: nextStatus },
              create: { productId: p.id, channelId: shopeeChannel.id, status: nextStatus, price: p.sellPrice },
            })
          }

          if (!sItemId) {
            affectedSkus.push(p.sku)
            continue
          }

          const isFirstForThisItem = !handledItemIds.has(sItemId)
          handledItemIds.add(sItemId)

          attrs.isUnlistedOnShopee = targetUnlisted
          attrs.cmsRequestedUnlisted = targetUnlisted
          attrs.lastCmsEditAt = nowIso
          if (isFirstForThisItem) {
            attrs.cmsTargetUnlisted = targetUnlisted
            attrs.pendingOutboxSync = true
          } else {
            attrs.lastSyncedShopeeUnlisted = targetUnlisted
            delete attrs.cmsTargetUnlisted
          }

          await db.product.update({
            where: { id: p.id },
            data: { attributes: JSON.stringify(attrs) },
          })

          if (isFirstForThisItem) {
            // Đồng bộ luôn các biến thể anh em cùng Shopee Item ID
            for (const sp of allActiveProducts) {
              if (sp.id === p.id || !sp.attributes) continue
              try {
                const sa = JSON.parse(sp.attributes) as Record<string, unknown>
                if (String(sa.shopeeItemId || '').trim() === sItemId) {
                  sa.isUnlistedOnShopee = targetUnlisted
                  sa.cmsRequestedUnlisted = targetUnlisted
                  sa.lastSyncedShopeeUnlisted = targetUnlisted
                  delete sa.cmsTargetUnlisted
                  sa.lastCmsEditAt = nowIso
                  await db.product.update({
                    where: { id: sp.id },
                    data: { attributes: JSON.stringify(sa) },
                  })
                  if (shopeeChannel) {
                    await db.channelListing.upsert({
                      where: { productId_channelId: { productId: sp.id, channelId: shopeeChannel.id } },
                      update: { status: nextStatus },
                      create: { productId: sp.id, channelId: shopeeChannel.id, status: nextStatus, price: sp.sellPrice },
                    })
                  }
                }
              } catch {}
            }

            await logLedger({
              scope: 'CHANNEL',
              action: 'OUTBOX_PENDING',
              entityType: 'Product',
              entityId: p.id,
              entityCode: p.sku,
              title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox (Hàng loạt): ${targetUnlisted ? 'Tạm ẩn' : 'Mở bán lại'} [${p.sku}] (Item #${sItemId}) trên Shopee`,
              detail: {
                direction: 'CMS_TO_SHOPEE',
                source: 'OPENVN_CMS',
                target: 'SHOPEE_SELLER_CENTER',
                operation: 'TOGGLE_UNLIST',
                sku: p.sku,
                shopeeItemId: sItemId,
                shopeeModelId: sModelId,
                targetStock: p.stock,
                targetPrice: p.sellPrice,
                targetUnlisted,
                reason: 'BULK_TOGGLE_VISIBILITY_FROM_CMS',
              },
              actor: 'OPERATOR',
              originSource: 'SHOPEE_SYNC',
            })
            outboxTriggered = true
          }

          affectedSkus.push(p.sku)
        }

        if (affectedSkus.length > 0) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'CHANNEL_LISTING_STATUS_CHANGED',
            entityType: 'Product',
            entityCode: affectedSkus.join(', ').slice(0, 60),
            title: `[CMS ➔ Shopee] Đổi trạng thái hàng loạt (${affectedSkus.length} SP): ${targetUnlisted ? 'Tạm ẩn trên sàn' : 'Đang bán trên sàn'} [${affectedSkus.join(', ')}]`,
            detail: {
              direction: 'CMS_TO_SHOPEE',
              bulkType,
              status: nextStatus,
              skus: affectedSkus,
            },
            actor: 'OPERATOR',
            originSource: 'MANUAL_ADMIN',
          })
        }
      }

      // 6C. Cập nhật Giá bán & Tồn kho hàng loạt (kèm đẩy tự động lên Sàn Shopee)
      else if (bulkType === 'UPDATE_PRICE_AND_STOCK') {
        const priceMode = body.priceMode || 'NONE'
        const priceVal = Number(body.priceValue) || 0
        const stockMode = body.stockMode || 'NONE'
        const stockVal = Number(body.stockValue) || 0

        for (const p of selectedProducts) {
          let nextPrice = p.sellPrice
          if (priceMode === 'SET' && priceVal > 0) {
            nextPrice = Math.max(1000, Math.round(priceVal))
          } else if (priceMode === 'ADD_AMOUNT' && priceVal !== 0) {
            nextPrice = Math.max(1000, Math.round(p.sellPrice + priceVal))
          } else if (priceMode === 'ADD_PERCENT' && priceVal !== 0) {
            nextPrice = Math.max(1000, Math.round((p.sellPrice * (1 + priceVal / 100)) / 1000) * 1000)
          }

          let nextStock = p.stock
          if (p.type !== 'COMBO') {
            if (stockMode === 'SET' && stockVal >= 0) {
              nextStock = Math.max(0, Math.round(stockVal))
            } else if (stockMode === 'ADD_DELTA' && stockVal !== 0) {
              nextStock = Math.max(0, Math.round(p.stock + stockVal))
            }
          }

          const priceChanged = nextPrice !== p.sellPrice
          const stockChanged = nextStock !== p.stock
          if (!priceChanged && !stockChanged) continue

          let attrs: Record<string, unknown> = {}
          try {
            if (p.attributes) attrs = JSON.parse(p.attributes)
          } catch {}
          const sItemId = String(attrs.shopeeItemId || '').trim()
          const sModelId = String(attrs.shopeeModelId || '').trim()

          if (sItemId) {
            attrs.pendingOutboxSync = true
            attrs.cmsTargetStock = nextStock
            attrs.cmsTargetPrice = nextPrice
            attrs.lastCmsEditAt = nowIso
          }

          await db.product.update({
            where: { id: p.id },
            data: {
              sellPrice: nextPrice,
              stock: nextStock,
              status: nextStock === 0 ? 'OUT_OF_STOCK' : p.status === 'OUT_OF_STOCK' ? 'ACTIVE' : p.status,
              attributes: JSON.stringify(attrs),
            },
          })

          if (stockChanged) {
            const diff = nextStock - p.stock
            await syncProductWarehouseStock(p.id, p.ownerWarehouseId)
            await db.stockMovement.create({
              data: {
                productId: p.id,
                warehouseId: p.ownerWarehouseId ?? null,
                type: 'ADJUST',
                quantity: diff,
                stockAfter: nextStock,
                note: `Điều chỉnh tồn kho hàng loạt trên CMS: ${p.stock} -> ${nextStock}`,
              },
            })
          }

          if (priceChanged) {
            await db.channelListing.updateMany({
              where: { productId: p.id },
              data: { price: nextPrice },
            })
          }

          if (sItemId) {
            await logLedger({
              scope: 'CHANNEL',
              action: 'OUTBOX_PENDING',
              entityType: 'Product',
              entityId: p.id,
              entityCode: p.sku,
              title: `[CMS ➔ SÀN SHOPEE] Hàng đợi Outbox (Hàng loạt): Cập nhật [${p.sku}] (Tồn: ${nextStock}, Giá: ${nextPrice.toLocaleString('vi-VN')}đ) lên Shopee`,
              detail: {
                direction: 'CMS_TO_SHOPEE',
                source: 'OPENVN_CMS',
                target: 'SHOPEE_SELLER_CENTER',
                sku: p.sku,
                shopeeItemId: sItemId,
                shopeeModelId: sModelId,
                targetStock: nextStock,
                targetPrice: nextPrice,
                targetUnlisted: Boolean(attrs.isUnlistedOnShopee),
                reason: 'BULK_PRICE_OR_STOCK_EDIT',
              },
              actor: 'OPERATOR',
              originSource: 'SHOPEE_SYNC',
            })
            outboxTriggered = true
          }

          affectedSkus.push(p.sku)
        }

        if (affectedSkus.length > 0) {
          await syncCombosUsingComponents(
            db,
            selectedProducts.map((p) => p.id)
          )
          await logLedger({
            scope: 'INVENTORY',
            action: 'PRODUCT_UPDATED',
            entityType: 'Product',
            entityCode: affectedSkus.join(', ').slice(0, 60),
            title: `[THAO TÁC HÀNG LOẠT] Cập nhật Giá / Tồn kho cho ${affectedSkus.length} sản phẩm [${affectedSkus.join(', ')}]`,
            detail: {
              skus: affectedSkus,
              priceMode,
              priceValue: priceVal,
              stockMode,
              stockValue: stockVal,
            },
            actor: 'OPERATOR',
            originSource: 'MANUAL_ADMIN',
          })
        }
      }

      // 6D. Chuyển Danh mục hàng loạt
      else if (bulkType === 'ASSIGN_CATEGORY') {
        const targetCategoryId = body.categoryId && body.categoryId !== 'NONE' ? String(body.categoryId) : null
        await db.product.updateMany({
          where: { id: { in: productIds } },
          data: { categoryId: targetCategoryId },
        })
        for (const p of selectedProducts) affectedSkus.push(p.sku)
        await logLedger({
          scope: 'INVENTORY',
          action: 'PRODUCT_UPDATED',
          entityType: 'Product',
          entityCode: affectedSkus.join(', ').slice(0, 60),
          title: `[THAO TÁC HÀNG LOẠT] Chuyển danh mục cho ${affectedSkus.length} sản phẩm [${affectedSkus.join(', ')}]`,
          detail: { skus: affectedSkus, categoryId: targetCategoryId },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
      }

      // 6E. Đổi trạng thái kinh doanh trên CMS (ACTIVE <-> INACTIVE)
      else if (bulkType === 'SET_CMS_STATUS') {
        const nextCmsStatus = body.cmsStatus === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
        await db.product.updateMany({
          where: { id: { in: productIds } },
          data: { status: nextCmsStatus },
        })
        if (nextCmsStatus === 'ACTIVE') {
          await db.channelListing.updateMany({
            where: { productId: { in: productIds }, status: 'INACTIVE' },
            data: { status: 'ACTIVE' },
          })
        } else {
          await db.channelListing.updateMany({
            where: { productId: { in: productIds } },
            data: { status: 'INACTIVE' },
          })
        }
        for (const p of selectedProducts) affectedSkus.push(p.sku)
        await logLedger({
          scope: 'INVENTORY',
          action: 'PRODUCT_UPDATED',
          entityType: 'Product',
          entityCode: affectedSkus.join(', ').slice(0, 60),
          title: `[THAO TÁC HÀNG LOẠT] Chuyển trạng thái CMS sang «${nextCmsStatus === 'ACTIVE' ? 'Đang bán' : 'Ngừng bán'}» cho ${affectedSkus.length} sản phẩm`,
          detail: { skus: affectedSkus, status: nextCmsStatus },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })
      }

      // 6F. Gỡ liên kết Sàn hàng loạt
      else if (bulkType === 'UNLINK') {
        for (const p of selectedProducts) {
          let attrs: Record<string, unknown> = {}
          try {
            if (p.attributes) attrs = JSON.parse(p.attributes)
          } catch {}
          const oldItemId = String(attrs.shopeeItemId || '').trim()
          const oldModelId = String(attrs.shopeeModelId || '').trim()
          const oldModelSku = String(attrs.shopeeModelSku || '').trim()
          const oldModelName = String(attrs.shopeeModelName || '').trim()
          if (!oldItemId) continue

          delete attrs.shopeeItemId
          delete attrs.shopeeModelId
          delete attrs.shopeeModelSku
          delete attrs.shopeeModelName
          delete attrs.linkMode
          delete attrs.lastSyncedShopeeStock
          delete attrs.lastSyncedShopeePrice
          delete attrs.lastSyncedShopeeUnlisted
          delete attrs.pendingOutboxSync

          await db.product.update({
            where: { id: p.id },
            data: { attributes: JSON.stringify(attrs) },
          })

          await logLedger({
            scope: 'CHANNEL',
            action: 'UNLINKED_MARKETPLACE_ITEM',
            entityType: 'Product',
            entityCode: `${oldItemId}_${oldModelId}`,
            title: `[GỠ LIÊN KẾT HÀNG LOẠT] Sản phẩm Shopee (${oldModelName || oldModelId}) vừa gỡ khỏi CMS [${p.sku}]`,
            detail: {
              channelKey: 'SHOPEE',
              direction: 'CMS_TO_SHOPEE',
              shopeeItemId: oldItemId,
              shopeeModelId: oldModelId,
              modelSku: oldModelSku,
              modelName: oldModelName,
              name: p.name,
              sellPrice: p.sellPrice,
              stock: p.stock,
              image: p.image,
            },
            actor: 'OPERATOR',
            originSource: 'SHOPEE_SYNC',
          })

          affectedSkus.push(p.sku)
        }
      }

      broadcast('inventory.updated', { bulkCount: affectedSkus.length })
      broadcast('product.updated', { bulkCount: affectedSkus.length })
      broadcast('channel.updated', { bulkCount: affectedSkus.length })

      if (outboxTriggered) {
        fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)
      }

      return NextResponse.json({
        ok: true,
        action: 'BULK_COMPLETED',
        bulkType,
        processedCount: affectedSkus.length,
        affectedCount: affectedSkus.length,
        affectedSkus,
        outboxTriggered,
        message: `Đã xử lý ${affectedSkus.length} sản phẩm: ${affectedSkus.join(', ')}${outboxTriggered ? ' (Đang đồng bộ lên Sàn Shopee)' : ''}`,
      })
    }

    // ===== 7. TẠO HÀNG HÓA MỚI & LIÊN KẾT HÀNG LOẠT TỪ DANH SÁCH CHƯA LIÊN KẾT =====
    if (action === 'BULK_CREATE_AND_LINK') {
      const rawItems = Array.isArray(body.unlinkedItems)
        ? body.unlinkedItems
        : Array.isArray((body as unknown as { items?: UnlinkedMarketplaceItem[] }).items)
          ? (body as unknown as { items: UnlinkedMarketplaceItem[] }).items
          : []
      const items = rawItems
      if (items.length === 0) {
        return NextResponse.json({ error: 'Chưa chọn phân loại sàn nào để tạo & liên kết' }, { status: 400 })
      }

      await ensureWarehousesAndVouchersSeeded()
      const [primaryCategory, fallbackCategory, defaultWh, channels] = await Promise.all([
        db.category.findFirst({ where: { slug: 'an-nhien-thach-thach-cao' } }),
        db.category.findFirst(),
        db.warehouse.findFirst({ where: { isDefault: true } }),
        db.channel.findMany({ where: { key: { in: ['SHOPEE', 'FACEBOOK', 'POS'] } } }),
      ])
      const category = primaryCategory ?? fallbackCategory
      if (!category) {
        return NextResponse.json({ error: 'Chưa có danh mục sản phẩm trong DB' }, { status: 400 })
      }

      const createdSkus: string[] = []
      for (const item of items) {
        const sItemId = String(item.shopeeItemId || '').trim()
        const sModelId = String(item.shopeeModelId || '').trim()
        if (!sItemId) continue

        let candidateSku = (
          item.shopeeSku ||
          (item.parentSku ? `${item.parentSku}-${sModelId.slice(-4)}` : `SP-${sModelId || sItemId}`)
        )
          .trim()
          .toUpperCase()

        const existingBySku = await db.product.findFirst({
          where: { sku: { equals: candidateSku, mode: 'insensitive' } },
        })
        if (existingBySku && existingBySku.status !== 'INACTIVE') {
          candidateSku = `${candidateSku}-${sModelId.slice(-4) || Date.now().toString().slice(-4)}`
        }

        const sellPrice = Number(item.sellPrice) > 0 ? Number(item.sellPrice) : 59000
        const costPrice = Math.round(sellPrice * 0.45)
        const shopeeStock = Math.max(0, Number(item.stock) || 0)
        const takeFromMarketplace = body.stockInitMode !== 'KEEP_WAREHOUSE_STOCK'
        const stock = takeFromMarketplace ? shopeeStock : 0
        const fullName = item.modelName ? `${item.name} - ${item.modelName}` : item.name
        const isUnlisted = Boolean(item.isUnlisted)
        const shopUsername = item.shopUsername || 'thaimy1605'
        const openingStockOrigin: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE' = takeFromMarketplace
          ? 'SHOPEE_MARKETPLACE'
          : 'CMS_WAREHOUSE'
        const openingStockOriginLabel = takeFromMarketplace
          ? `Gốc tồn đầu từ Sàn Shopee (${shopUsername} · Item #${sItemId})`
          : 'Gốc tồn đầu tại Kho CMS (Kho trống = 0 bộ)'

        const attrObj = {
          brandLine: 'An Nhiên Thạch · Shopee Sync',
          shopeeItemId: sItemId,
          shopeeModelId: sModelId,
          shopeeModelSku: item.shopeeSku || candidateSku,
          shopeeModelName: item.modelName || '',
          shopId: item.shopId || '197195817',
          shopUsername,
          linkMode: 'CREATED_AND_LINKED',
          linkedAt: new Date().toISOString(),
          openingStockOrigin,
          openingStockOriginLabel,
          openingStockQty: stock,
          openingStockLockedAt: new Date().toISOString(),
          liveShopeeStock: shopeeStock,
          unreconciledShopeeDelta: 0,
          reconciliationStatus: 'RECONCILED_OK',
          lastSyncedShopeeStock: stock,
          lastSyncedShopeePrice: sellPrice,
          lastSyncedShopeeUnlisted: isUnlisted,
          isUnlistedOnShopee: isUnlisted,
          gallery: item.images || [],
        }

        const created =
          existingBySku && existingBySku.status === 'INACTIVE'
            ? await db.product.update({
                where: { id: existingBySku.id },
                data: {
                  sku: candidateSku,
                  name: fullName,
                  description: item.description || fullName,
                  costPrice,
                  sellPrice,
                  stock,
                  image: item.image || existingBySku.image,
                  status: stock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
                  attributes: JSON.stringify(attrObj),
                },
              })
            : await db.product.create({
                data: {
                  sku: candidateSku,
                  name: fullName,
                  description: item.description || fullName,
                  categoryId: category.id,
                  costPrice,
                  sellPrice,
                  stock,
                  lowStockThreshold: 5,
                  image: item.image || null,
                  status: stock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
                  attributes: JSON.stringify(attrObj),
                  unit: 'bộ',
                  type: 'SIMPLE',
                  fragile: true,
                  ownerWarehouseId: defaultWh?.id ?? null,
                },
              })

        if (defaultWh) {
          await syncProductWarehouseStock(created.id, defaultWh.id)
        }

        if (takeFromMarketplace) {
          await db.stockMovement.create({
            data: {
              productId: created.id,
              warehouseId: defaultWh?.id ?? null,
              type: 'IMPORT',
              quantity: stock,
              stockAfter: stock,
              note: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Chốt tồn đầu kỳ từ Sàn Shopee (Shop ${shopUsername} · Item #${sItemId} / Model #${sModelId}): Tồn đầu = ${stock} bộ`,
            },
          })
        }

        for (const ch of channels) {
          await db.channelListing.upsert({
            where: { productId_channelId: { productId: created.id, channelId: ch.id } },
            update: {
              price: sellPrice,
              status: ch.key === 'SHOPEE' && isUnlisted ? 'UNLISTED' : 'ACTIVE',
              description: item.description || fullName,
              descriptionSyncedAt: new Date(),
            },
            create: {
              productId: created.id,
              channelId: ch.id,
              price: sellPrice,
              status: ch.key === 'SHOPEE' && isUnlisted ? 'UNLISTED' : 'ACTIVE',
              description: item.description || fullName,
              descriptionSyncedAt: new Date(),
            },
          })
        }

        await db.ledgerEntry.deleteMany({
          where: {
            scope: 'CHANNEL',
            action: 'UNLINKED_MARKETPLACE_ITEM',
            entityCode: `${sItemId}_${sModelId}`,
          },
        })

        createdSkus.push(created.sku)
      }

      if (createdSkus.length > 0) {
        await logLedger({
          scope: 'CHANNEL',
          action: 'MARKETPLACE_PRODUCT_CREATED_AND_LINKED',
          entityType: 'Product',
          entityCode: createdSkus.join(', ').slice(0, 60),
          title: `[TẠO & LIÊN KẾT HÀNG LOẠT] Đã tạo mới & liên kết ${createdSkus.length} sản phẩm từ Sàn Shopee [${createdSkus.join(', ')}]`,
          detail: { createdSkus },
          actor: 'OPERATOR',
          originSource: 'SHOPEE_SYNC',
        })
      }

      broadcast('inventory.updated', { bulkCount: createdSkus.length })
      broadcast('channel.product_linked', { bulkCount: createdSkus.length })

      return NextResponse.json({
        ok: true,
        action: 'BULK_CREATED_AND_LINKED',
        createdCount: createdSkus.length,
        createdSkus,
        message: `Đã khởi tạo và liên kết ${createdSkus.length} mã SKU: ${createdSkus.join(', ')}`,
      })
    }

    // ===== 8. CHỐT TỒN ĐẦU KỲ (TỪ SÀN HOẶC TẠI KHO) & ĐỐI CHIẾU ĐƠN HÀNG SÀN SHOPEE =====
    if (action === 'RESOLVE_OPENING_OR_RECONCILE') {
      const targetId = body.cmsProductId || body.productId
      if (!targetId) {
        return NextResponse.json({ error: 'Thiếu cmsProductId' }, { status: 400 })
      }
      const product = await db.product.findUnique({ where: { id: targetId } })
      if (!product) {
        return NextResponse.json({ error: 'Không tìm thấy sản phẩm CMS' }, { status: 404 })
      }

      let attrs: Record<string, unknown> = {}
      try {
        attrs = product.attributes ? (JSON.parse(product.attributes) as Record<string, unknown>) : {}
      } catch {
        attrs = {}
      }

      const sItemId = String(attrs.shopeeItemId || body.shopeeItemId || '').trim()
      const sModelId = String(attrs.shopeeModelId || body.shopeeModelId || '').trim()
      const shopUsername = String(attrs.shopUsername || body.shopUsername || 'thaimy1605')
      const liveShopeeStock = Number.isFinite(Number(body.stock))
        ? Number(body.stock)
        : typeof attrs.liveShopeeStock === 'number'
          ? attrs.liveShopeeStock
          : typeof attrs.lastSyncedShopeeStock === 'number'
            ? attrs.lastSyncedShopeeStock
            : product.stock

      const resolveMode = body.resolveMode || 'RECONCILE_SHOPEE_ORDERS'
      const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })

      if (resolveMode === 'TAKE_OPENING_FROM_MARKETPLACE') {
        const prevWarehouseStock = product.stock
        const nextStock = Math.max(0, liveShopeeStock)
        const openingStockOriginLabel = `Gốc tồn đầu từ Sàn Shopee (${shopUsername} · Item #${sItemId})`
        const reasonText =
          (body.adjustReason || '').trim() || 'Chốt tồn đầu kỳ từ Sàn Shopee khi kho CMS đang trống (= 0)'
        const nowIso = new Date().toISOString()

        const nextAttrs = {
          ...attrs,
          openingStockOrigin: 'SHOPEE_MARKETPLACE',
          openingStockOriginLabel,
          openingStockQty: nextStock,
          openingStockLockedAt: nowIso,
          liveShopeeStock: nextStock,
          lastSyncedShopeeStock: nextStock,
          unreconciledShopeeDelta: 0,
          reconciliationStatus: 'RECONCILED_OK',
          lastReconcileDecision: 'TAKE_OPENING_FROM_MARKETPLACE',
          lastReconcileDecisionLabel: 'Lấy tồn Sàn làm Tồn đầu kỳ',
          lastReconcileReason: reasonText,
          lastReconcileAt: nowIso,
        }

        const updated = await db.product.update({
          where: { id: product.id },
          data: {
            stock: nextStock,
            status: nextStock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
            attributes: JSON.stringify(nextAttrs),
          },
        })

        if (defaultWh) {
          await syncProductWarehouseStock(updated.id, defaultWh.id)
        }

        await db.stockMovement.create({
          data: {
            productId: updated.id,
            warehouseId: defaultWh?.id ?? null,
            type: 'IMPORT',
            quantity: nextStock,
            stockAfter: nextStock,
            note: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Chốt tồn đầu kỳ từ Sàn Shopee (Shop ${shopUsername} · Item #${sItemId} / Model #${sModelId}): Tồn đầu = ${nextStock} bộ (Kho trước chốt: ${prevWarehouseStock} ➔ Sau chốt: ${nextStock}) · Lý do: "${reasonText}"`,
          },
        })

        await logLedger({
          scope: 'INVENTORY',
          action: 'OPENING_STOCK_FROM_MARKETPLACE',
          entityType: 'Product',
          entityId: updated.id,
          entityCode: updated.sku,
          title: `[GỐC TỒN ĐẦU TỪ SÀN SHOPEE] Lấy số tồn từ Sàn làm Tồn đầu kỳ [${updated.sku}] = ${nextStock} bộ · Lý do: "${reasonText}"`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            source: 'SHOPEE_SELLER_CENTER',
            target: 'OPENVN_CMS',
            sku: updated.sku,
            shopeeItemId: sItemId,
            shopeeModelId: sModelId,
            prevWarehouseStock,
            openingStockQty: nextStock,
            openingStockOrigin: 'SHOPEE_MARKETPLACE',
            openingStockOriginLabel,
            reason: reasonText,
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })

        broadcast('inventory.updated', { productId: updated.id, sku: updated.sku, stockAfter: updated.stock })
        broadcast('channel.updated', { productId: updated.id, sku: updated.sku })

        return NextResponse.json({
          ok: true,
          action: 'OPENING_TAKEN_FROM_MARKETPLACE',
          product: {
            id: updated.id,
            sku: updated.sku,
            stock: updated.stock,
            openingStockOrigin: 'SHOPEE_MARKETPLACE',
            openingStockOriginLabel,
            openingStockQty: nextStock,
            lastReconcileReason: reasonText,
          },
          message: `Đã lấy số tồn từ Sàn Shopee (${nextStock} bộ) làm Tồn đầu kỳ cho [${updated.sku}] · Lý do: "${reasonText}".`,
        })
      }

      if (resolveMode === 'KEEP_WAREHOUSE_AND_PUSH') {
        const openingStockOriginLabel = `Gốc tồn đầu tại Kho CMS (KHO-TRUNG-TAM · Tồn kho: ${product.stock} bộ)`
        const reasonText =
          (body.adjustReason || '').trim() || 'Giữ nguyên số tồn chuẩn tại Kho CMS & đẩy đồng bộ lên Sàn Shopee'
        const nowIso = new Date().toISOString()
        const nextAttrs = {
          ...attrs,
          openingStockOrigin: 'CMS_WAREHOUSE',
          openingStockOriginLabel,
          openingStockQty: typeof attrs.openingStockQty === 'number' ? attrs.openingStockQty : product.stock,
          openingStockLockedAt: nowIso,
          lastSyncedShopeeStock: product.stock,
          liveShopeeStock: product.stock,
          unreconciledShopeeDelta: 0,
          reconciliationStatus: 'RECONCILED_OK',
          lastReconcileDecision: 'KEEP_WAREHOUSE_AND_PUSH',
          lastReconcileDecisionLabel: 'Giữ tồn Kho CMS & đẩy Sàn',
          lastReconcileReason: reasonText,
          lastReconcileAt: nowIso,
          pendingOutboxSync: true,
          lastCmsEditAt: nowIso,
        }

        await db.product.update({
          where: { id: product.id },
          data: {
            attributes: JSON.stringify(nextAttrs),
          },
        })

        await logLedger({
          scope: 'CHANNEL',
          action: 'OUTBOX_PENDING',
          entityType: 'Product',
          entityId: product.id,
          entityCode: product.sku,
          title: `[CMS ➔ SÀN SHOPEE] Giữ tồn tại Kho CMS [${product.sku}] (${product.stock} bộ, từ chối tồn Sàn ${liveShopeeStock} bộ) & đẩy lên Sàn Shopee · Lý do: "${reasonText}"`,
          detail: {
            direction: 'CMS_TO_SHOPEE',
            source: 'OPENVN_CMS',
            target: 'SHOPEE_SELLER_CENTER',
            sku: product.sku,
            shopeeItemId: sItemId,
            shopeeModelId: sModelId,
            targetStock: product.stock,
            rejectedShopeeStock: liveShopeeStock,
            openingStockOrigin: 'CMS_WAREHOUSE',
            openingStockOriginLabel,
            reason: reasonText,
          },
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })

        fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)
        broadcast('channel.updated', { productId: product.id, sku: product.sku })

        return NextResponse.json({
          ok: true,
          action: 'KEPT_WAREHOUSE_STOCK_AND_PUSHED',
          product: {
            id: product.id,
            sku: product.sku,
            stock: product.stock,
            openingStockOrigin: 'CMS_WAREHOUSE',
            openingStockOriginLabel,
            lastReconcileReason: reasonText,
          },
          message: `Đã giữ tồn Kho CMS (${product.stock} bộ) làm gốc cho [${product.sku}] và đẩy lên Sàn Shopee · Lý do: "${reasonText}".`,
        })
      }

      if (resolveMode === 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT') {
        const prevWarehouseStock = product.stock
        const nextStock = Math.max(0, liveShopeeStock)
        const delta = nextStock - prevWarehouseStock
        const openingStockOrigin = String(attrs.openingStockOrigin || 'SHOPEE_MARKETPLACE')
        const openingStockOriginLabel = String(
          attrs.openingStockOriginLabel || `Gốc tồn đầu từ Sàn Shopee (${shopUsername} · Item #${sItemId})`
        )
        const openingStockQty =
          typeof attrs.openingStockQty === 'number' ? attrs.openingStockQty : prevWarehouseStock
        const reasonText =
          (body.adjustReason || '').trim() || 'Xác nhận số liệu điều chỉnh trên Sàn Shopee khớp kiểm đếm thực tế'
        const nowIso = new Date().toISOString()

        const nextAttrs = {
          ...attrs,
          openingStockOrigin,
          openingStockOriginLabel,
          openingStockQty,
          liveShopeeStock: nextStock,
          lastSyncedShopeeStock: nextStock,
          unreconciledShopeeDelta: 0,
          reconciliationStatus: 'RECONCILED_OK',
          lastShopeeAdjustDelta: delta,
          lastShopeeAdjustedAt: nowIso,
          lastReconcileDecision: 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT',
          lastReconcileDecisionLabel: 'Nhận ĐC từ Sàn là đúng',
          lastReconcileReason: reasonText,
          lastReconcileAt: nowIso,
        }

        const updated = await db.product.update({
          where: { id: product.id },
          data: {
            stock: nextStock,
            status: nextStock === 0 ? 'OUT_OF_STOCK' : 'ACTIVE',
            attributes: JSON.stringify(nextAttrs),
          },
        })

        if (defaultWh) {
          await syncProductWarehouseStock(updated.id, defaultWh.id)
        }

        if (delta !== 0) {
          await db.stockMovement.create({
            data: {
              productId: updated.id,
              warehouseId: defaultWh?.id ?? null,
              type: 'ADJUST',
              quantity: delta,
              stockAfter: nextStock,
              note: `[ĐỐI SOÁT ĐIỀU CHỈNH TỪ SÀN SHOPEE] Xác nhận số liệu điều chỉnh trên Sàn Shopee (${nextStock} bộ) là chính xác: Cân bằng tồn Kho CMS ${prevWarehouseStock} ➔ ${nextStock} (${delta > 0 ? '+' : ''}${delta} bộ) · Lý do: "${reasonText}" · Bảo toàn Gốc tồn đầu (${openingStockQty} bộ)`,
            },
          })
        }

        await logLedger({
          scope: 'INVENTORY',
          action: 'SHOPEE_DIRECT_ADJUSTMENT_RECONCILED',
          entityType: 'Product',
          entityId: updated.id,
          entityCode: updated.sku,
          title: `[ĐỐI SOÁT ĐIỀU CHỈNH SÀN ➔ KHO CMS] Xác nhận tồn Sàn [${updated.sku}] = ${nextStock} bộ là chính xác (${prevWarehouseStock} ➔ ${nextStock}, ${delta > 0 ? '+' : ''}${delta} bộ) · Lý do: "${reasonText}"`,
          detail: {
            direction: 'SHOPEE_TO_CMS',
            source: 'SHOPEE_SELLER_CENTER',
            target: 'OPENVN_CMS',
            sku: updated.sku,
            shopeeItemId: sItemId,
            shopeeModelId: sModelId,
            prevWarehouseStock,
            acceptedShopeeStock: nextStock,
            adjustDelta: delta,
            openingStockQty,
            openingStockOrigin,
            openingStockOriginLabel,
            reason: reasonText,
          },
          beforeSnapshot: { stock: prevWarehouseStock },
          afterSnapshot: { stock: nextStock },
          changedFields: ['stock'],
          actor: 'OPERATOR',
          originSource: 'MANUAL_ADMIN',
        })

        broadcast('inventory.updated', { productId: updated.id, sku: updated.sku, stockAfter: updated.stock })
        broadcast('channel.updated', { productId: updated.id, sku: updated.sku })

        return NextResponse.json({
          ok: true,
          action: 'SHOPEE_DIRECT_ADJUSTMENT_ACCEPTED',
          product: {
            id: updated.id,
            sku: updated.sku,
            stock: updated.stock,
            adjustDelta: delta,
            openingStockQty,
            lastReconcileReason: reasonText,
          },
          message: `Đã đối soát & xác nhận số tồn điều chỉnh trên Sàn Shopee (${nextStock} bộ) là chính xác cho [${updated.sku}] (${delta > 0 ? '+' : ''}${delta} bộ) · Lý do: "${reasonText}".`,
        })
      }

      // resolveMode === 'RECONCILE_SHOPEE_ORDERS': Đối chiếu đơn trên Sàn về CMS để theo dõi và trừ tồn chính xác
      fetch('http://127.0.0.1:51898/shopee/trigger-sync', { method: 'POST' }).catch(() => null)

      const [ordersForProduct, movementsForProduct] = await Promise.all([
        db.order.findMany({
          where: {
            status: { not: 'CANCELLED' },
            items: { some: { productId: product.id } },
          },
          include: {
            channel: { select: { key: true } },
            items: { where: { productId: product.id } },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.stockMovement.findMany({
          where: { productId: product.id },
          select: { type: true, quantity: true, note: true },
        }),
      ])

      let shopeeSoldQty = 0
      let posSoldQty = 0
      const reconciledOrders: Array<{ code: string; channelKey: string; shopeeOrderSn?: string; quantity: number }> = []

      for (const ord of ordersForProduct) {
        const chKey = ord.channel?.key || 'POS'
        const qty = ord.items.reduce((s, it) => s + it.quantity, 0)
        const snMatch = ord.note ? ord.note.match(/(?:Shopee\s*#|order_sn[:\s]*)([A-Z0-9_-]{8,})/i) : null
        if (chKey === 'SHOPEE') shopeeSoldQty += qty
        else posSoldQty += qty
        reconciledOrders.push({
          code: ord.code,
          channelKey: chKey,
          shopeeOrderSn: snMatch ? snMatch[1] : undefined,
          quantity: qty,
        })
      }

      let shopeeAdjustDelta = 0
      let manualDelta = 0
      for (const m of movementsForProduct) {
        const noteUpper = (m.note || '').toUpperCase()
        if (noteUpper.includes('[GỐC TỒN ĐẦU')) continue
        const isOrderExport = m.type === 'EXPORT' && (m.note || '').includes('Xuất kho cho đơn')
        if (noteUpper.includes('[ĐỐI SOÁT ĐIỀU CHỈNH TỪ SÀN SHOPEE]')) {
          shopeeAdjustDelta += m.quantity
        } else if (!isOrderExport) {
          manualDelta += m.quantity
        }
      }

      const openingStockQty =
        typeof attrs.openingStockQty === 'number'
          ? attrs.openingStockQty
          : product.stock + shopeeSoldQty + posSoldQty - shopeeAdjustDelta - manualDelta
      const expectedStock = openingStockQty - shopeeSoldQty - posSoldQty + shopeeAdjustDelta + manualDelta
      const unexplainedShopeeDelta = liveShopeeStock - product.stock

      if (unexplainedShopeeDelta !== 0) {
        await db.product.update({
          where: { id: product.id },
          data: {
            attributes: JSON.stringify({
              ...attrs,
              reconciliationStatus: 'SHOPEE_DIRECT_ADJUSTED',
              unreconciledShopeeDelta: unexplainedShopeeDelta,
            }),
          },
        })
      }

      return NextResponse.json({
        ok: true,
        action: 'RECONCILED_SHOPEE_ORDERS',
        reconciliation: {
          sku: product.sku,
          openingStockOrigin: String(attrs.openingStockOrigin || 'SHOPEE_MARKETPLACE'),
          openingStockOriginLabel: String(
            attrs.openingStockOriginLabel || `Gốc tồn đầu từ Sàn Shopee (${shopUsername})`
          ),
          openingStockQty,
          shopeeSoldQty,
          posSoldQty,
          shopeeAdjustDelta,
          manualDelta,
          expectedStock,
          currentCmsStock: product.stock,
          liveShopeeStock,
          unexplainedShopeeDelta,
          reconciledOrders,
        },
        message:
          unexplainedShopeeDelta !== 0
            ? `Đối chiếu [${product.sku}]: Không có đơn Sàn mới chưa trừ, nhưng Sàn đang lệch ${unexplainedShopeeDelta > 0 ? '+' : ''}${unexplainedShopeeDelta} bộ so với Kho CMS (Sàn: ${liveShopeeStock} vs Kho: ${product.stock}) do điều chỉnh trực tiếp trên Sàn. Nếu số trên Sàn (${liveShopeeStock}) là chính xác, bấm «Nhận ĐC Sàn» để cân bằng kho mà vẫn giữ nguyên Gốc tồn đầu (${openingStockQty}).`
            : `Đối chiếu [${product.sku}]: Gốc tồn đầu = ${openingStockQty} − Đơn Sàn = ${shopeeSoldQty} − Đơn Kho/POS = ${posSoldQty}${shopeeAdjustDelta ? ` + ĐC Sàn = ${shopeeAdjustDelta}` : ''} ➔ Tồn chuẩn = ${expectedStock} (Khớp 100% Kho CMS: ${product.stock} & Sàn: ${liveShopeeStock}).`,
      })
    }

    return NextResponse.json({ error: `Action «${action}» không hợp lệ` }, { status: 400 })
  } catch (error) {
    console.error('POST /api/channels/product-links error:', error)
    return NextResponse.json({ error: 'Không thể xử lý liên kết sản phẩm' }, { status: 500 })
  }
}
