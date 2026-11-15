import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { getApiCache, invalidateApiCache, patchProductInApiCache, setApiCache } from '@/lib/realtime'
import { getSettings } from '@/lib/settings'
import {
  DEFAULT_INVENTORY_SYNC_POLICY,
  INVENTORY_POLICY_SETTING_KEYS,
  type InventoryModeTransitionStrategy,
  type InventorySyncPolicy,
  type InventoryTransitionExecutionSummary,
  type InventoryTransitionImpactSummary,
  canChannelSellNegative,
  parseInventorySyncPolicy,
} from '@/lib/inventory-policy-shared'

export * from '@/lib/inventory-policy-shared'

const POLICY_CACHE_KEY = 'settings:inventory_policy'

/**
 * Đọc chính sách Tồn kho Thật CMS & Đồng bộ Tồn kho Sàn hiện hành từ AppSetting (có L1 cache 60s,
 * tự động xóa tức thì khi PATCH /api/settings gọi invalidateApiCache('settings:')).
 */
export async function getInventorySyncPolicy(): Promise<InventorySyncPolicy> {
  const cached = getApiCache<InventorySyncPolicy>(POLICY_CACHE_KEY)
  if (cached) return cached

  try {
    const raw = await getSettings([...INVENTORY_POLICY_SETTING_KEYS])
    const policy = parseInventorySyncPolicy(raw)
    setApiCache(POLICY_CACHE_KEY, policy, 60_000)
    return policy
  } catch {
    return { ...DEFAULT_INVENTORY_SYNC_POLICY }
  }
}

export interface MarketplaceStockResolutionInput {
  policy: InventorySyncPolicy
  cmsRealStock: number
  lastSyncedStock: number
  cmsExplicitTargetStock?: number
  cmsTargetStockOrigin?: string
  mode1HoldBaselineStock?: number
  hasExplicitOutbox: boolean
  isUnlistedOnShopee?: boolean
}

export interface MarketplaceStockResolution {
  targetStock: number
  stockDrifted: boolean
  isMarketplaceStockProtected: boolean
  isVirtualRefillJob: boolean
  isMode1HeldUntilNextChange: boolean
}

/**
 * Giải quyết số lượng tồn kho đích trên Sàn TMĐT (Shopee) từ Chính sách cửa hàng:
 * - Bất biến: Shopee API chỉ nhận tồn >= 0; Kho CMS giữ 100% tồn vật lý thật (có thể âm nếu bật bán âm).
 * - Khử xung đột khi chuyển chế độ (Mode Switch Guard):
 *   + Đang ở Mode 2 (Tồn ảo) sẽ bỏ qua cmsExplicitTargetStock sinh từ Mode 1 ('CMS_SYNC_POLICY') để không đẩy tồn 0 làm tắt hàng Live.
 *   + Đang ở Mode 1 (CMS -> Sàn) sẽ bỏ qua cmsExplicitTargetStock sinh từ Mode 2 ('VIRTUAL_POLICY') và tôn trọng cờ giữ mượt
 *     `mode1HoldBaselineStock` cho đến khi phát sinh biến động kho thật tiếp theo.
 */
export function resolveMarketplaceTargetStock(
  input: MarketplaceStockResolutionInput
): MarketplaceStockResolution {
  const {
    policy,
    cmsRealStock,
    lastSyncedStock,
    cmsExplicitTargetStock,
    cmsTargetStockOrigin,
    mode1HoldBaselineStock,
    hasExplicitOutbox,
    isUnlistedOnShopee = false,
  } = input

  // 1. Lệnh đẩy tường minh hợp lệ với chế độ hiện hành (loại bỏ lệnh tồn đọng mâu thuẫn từ chế độ cũ)
  if (typeof cmsExplicitTargetStock === 'number' && Number.isFinite(cmsExplicitTargetStock)) {
    const isStaleMode1TargetInMode2 =
      policy.syncMode === 'VIRTUAL_ALWAYS_IN_STOCK' && cmsTargetStockOrigin === 'CMS_SYNC_POLICY'
    const isStaleMode2TargetInMode1 =
      policy.syncMode === 'SYNC_CMS_TO_MARKETPLACE' && cmsTargetStockOrigin === 'VIRTUAL_POLICY'

    if (!isStaleMode1TargetInMode2 && !isStaleMode2TargetInMode1) {
      const clampedTarget = Math.max(0, Math.round(cmsExplicitTargetStock))
      return {
        targetStock: clampedTarget,
        stockDrifted: hasExplicitOutbox || lastSyncedStock !== clampedTarget,
        isMarketplaceStockProtected: false,
        isVirtualRefillJob: cmsTargetStockOrigin === 'VIRTUAL_POLICY',
        isMode1HeldUntilNextChange: false,
      }
    }
  }

  // 2. Chế độ 1: Đồng bộ tồn kho thật từ CMS lên Sàn (CMS -> Sàn)
  if (policy.syncMode === 'SYNC_CMS_TO_MARKETPLACE') {
    const clampedReal = Math.max(0, Math.round(cmsRealStock))

    // Cổng chuyển mượt không gián đoạn (SEAMLESS_HOLD_CURRENT):
    // Nếu vừa chuyển từ Chế độ 2 sang Chế độ 1 và sản phẩm chưa có biến động kho thật mới (clampedReal === mode1HoldBaselineStock),
    // giữ nguyên số tồn đang bán trên Sàn để không làm tắt hàng / đứt phiên Live đột ngột.
    if (
      typeof mode1HoldBaselineStock === 'number' &&
      Number.isFinite(mode1HoldBaselineStock) &&
      mode1HoldBaselineStock === clampedReal &&
      lastSyncedStock >= 0 &&
      lastSyncedStock !== clampedReal
    ) {
      return {
        targetStock: lastSyncedStock,
        stockDrifted: false,
        isMarketplaceStockProtected: true,
        isVirtualRefillJob: false,
        isMode1HeldUntilNextChange: true,
      }
    }

    const drifted =
      (hasExplicitOutbox || lastSyncedStock >= 0) && lastSyncedStock !== clampedReal
    return {
      targetStock: drifted || lastSyncedStock < 0 ? clampedReal : lastSyncedStock,
      stockDrifted: drifted,
      isMarketplaceStockProtected: false,
      isVirtualRefillJob: false,
      isMode1HeldUntilNextChange: false,
    }
  }

  // 3. Chế độ 2: Sàn luôn tồn hàng ở mức ảo — Chống ghi đè tồn thật CMS
  if (
    policy.virtualAutoRefill &&
    !isUnlistedOnShopee &&
    lastSyncedStock >= 0 &&
    lastSyncedStock <= policy.virtualMinThreshold &&
    lastSyncedStock !== policy.virtualStockQty
  ) {
    return {
      targetStock: policy.virtualStockQty,
      stockDrifted: true,
      isMarketplaceStockProtected: false,
      isVirtualRefillJob: true,
      isMode1HeldUntilNextChange: false,
    }
  }

  // Giữ nguyên tồn ảo hiện có trên Sàn, tuyệt đối không đẩy tồn 0 / tồn âm từ CMS lên ghi đè Sàn
  const preservedMarketplaceStock =
    lastSyncedStock >= 0 ? lastSyncedStock : Math.max(0, policy.virtualStockQty)

  return {
    targetStock: preservedMarketplaceStock,
    stockDrifted: false,
    isMarketplaceStockProtected: true,
    isVirtualRefillJob: false,
    isMode1HeldUntilNextChange: false,
  }
}

/**
 * Đo lường tức thì tác động chuyển đổi chế độ tồn kho trước khi áp dụng (Read-only, < 10ms).
 */
export async function computeInventoryTransitionImpact(): Promise<InventoryTransitionImpactSummary> {
  const [products, pendingOutboxRows] = await Promise.all([
    db.product.findMany({
      where: { status: { not: 'INACTIVE' } },
      select: { id: true, stock: true, sellPrice: true, attributes: true },
    }),
    db.ledgerEntry.findMany({
      where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING' },
      select: { entityId: true },
    }),
  ])

  const pendingOutboxIds = new Set(
    pendingOutboxRows.map((r) => r.entityId).filter((id): id is string => Boolean(id))
  )

  let linkedShopeeSkus = 0
  let wouldZeroOutOnShopeeCount = 0
  let positiveDriftedSkusCount = 0
  let zeroOnShopeeLinkedCount = 0
  let negativeCmsSkusCount = 0
  let negativeCmsTotalUnits = 0
  let pendingModeStockOutboxCount = 0

  for (const p of products) {
    if (p.stock < 0) {
      negativeCmsSkusCount++
      negativeCmsTotalUnits += Math.abs(p.stock)
    }

    let attrs: Record<string, unknown> = {}
    if (p.attributes) {
      try {
        attrs = JSON.parse(p.attributes) as Record<string, unknown>
      } catch {
        attrs = {}
      }
    }

    const sItemId = String(attrs.shopeeItemId || '').trim()
    if (!sItemId || sItemId === '0') continue

    linkedShopeeSkus++
    const liveShopee =
      typeof attrs.liveShopeeStock === 'number'
        ? attrs.liveShopeeStock
        : typeof attrs.lastSyncedShopeeStock === 'number'
          ? attrs.lastSyncedShopeeStock
          : Math.max(0, p.stock)

    if (p.stock <= 0 && liveShopee > 0) {
      wouldZeroOutOnShopeeCount++
    } else if (p.stock > 0 && liveShopee !== p.stock) {
      positiveDriftedSkusCount++
    }

    if (liveShopee <= 0 && !attrs.isUnlistedOnShopee) {
      zeroOnShopeeLinkedCount++
    }

    if (pendingOutboxIds.has(p.id) || typeof attrs.cmsTargetStock === 'number') {
      pendingModeStockOutboxCount++
    }
  }

  return {
    totalActiveProducts: products.length,
    linkedShopeeSkus,
    wouldZeroOutOnShopeeCount,
    positiveDriftedSkusCount,
    zeroOnShopeeLinkedCount,
    negativeCmsSkusCount,
    negativeCmsTotalUnits,
    pendingModeStockOutboxCount,
  }
}

/**
 * Thực thi chuyển đổi chế độ Tồn kho Thật CMS & Đồng bộ Sàn KHÔNG GIÁN ĐOẠN VẬN HÀNH:
 * 1. Bảo toàn 100% Product.stock, WarehouseStock, Order và StockMovement (không làm mất tồn âm hay tồn thật).
 * 2. Dọn sạch lệnh đẩy tồn kho mâu thuẫn từ chế độ cũ nhưng BẢO TOÀN 100% lệnh đổi Giá / Ẩn-Hiện / Ảnh đang chờ trong Outbox.
 * 3. Ở chế độ mặc định SEAMLESS_HOLD_CURRENT khi chuyển từ Mode 2 sang Mode 1: khóa mốc `mode1HoldBaselineStock`
 *    để KHÔNG đẩy tồn 0 làm tắt hàng đang Live trên Shopee; chỉ tự động đồng bộ từ lần biến động kho thật kế tiếp.
 */
export async function reconcileInventoryModeTransition(params: {
  prevPolicy: InventorySyncPolicy
  nextPolicy: InventorySyncPolicy
  strategy?: InventoryModeTransitionStrategy
  onlyProductIds?: string[]
  actor?: string
}): Promise<InventoryTransitionExecutionSummary> {
  const {
    prevPolicy,
    nextPolicy,
    strategy = 'SEAMLESS_HOLD_CURRENT',
    onlyProductIds,
    actor = 'OPERATOR',
  } = params
  const scopedIds =
    Array.isArray(onlyProductIds) && onlyProductIds.length > 0
      ? new Set(onlyProductIds.map((id) => String(id).trim()).filter(Boolean))
      : null

  const modeSwitched = prevPolicy.syncMode !== nextPolicy.syncMode
  const negativeToggled =
    prevPolicy.allowNegativeStock !== nextPolicy.allowNegativeStock ||
    prevPolicy.negativeStockScope !== nextPolicy.negativeStockScope

  const [products, pendingRows] = await Promise.all([
    db.product.findMany({
      where: { status: { not: 'INACTIVE' } },
      include: { listings: { include: { channel: true } } },
    }),
    db.ledgerEntry.findMany({
      where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING' },
      select: { id: true, entityId: true, detail: true },
    }),
  ])

  const pendingLedgerIdsByProduct = new Map<string, string[]>()
  for (const r of pendingRows) {
    if (!r.entityId) continue
    const list = pendingLedgerIdsByProduct.get(r.entityId) ?? []
    list.push(r.id)
    pendingLedgerIdsByProduct.set(r.entityId, list)
  }

  let heldOnMarketplaceCount = 0
  let cancelledStaleStockOutboxCount = 0
  let preservedNonStockOutboxCount = 0
  let queuedImmediateSyncCount = 0
  let preservedNegativeSkusCount = 0

  const ledgerIdsToSupersede: string[] = []
  const nowIso = new Date().toISOString()

  for (const p of products) {
    if (scopedIds && !scopedIds.has(p.id)) continue
    if (p.stock < 0) {
      preservedNegativeSkusCount++
    }
    if (!p.attributes) continue

    let attrs: Record<string, unknown> = {}
    try {
      attrs = JSON.parse(p.attributes) as Record<string, unknown>
    } catch {
      continue
    }

    const sItemId = String(attrs.shopeeItemId || '').trim()
    if (!sItemId || sItemId === '0') continue

    let mutated = false
    const shopeeListing = p.listings.find((l) => l.channel.key === 'SHOPEE')
    const effectiveTargetPrice =
      typeof attrs.cmsTargetPrice === 'number'
        ? attrs.cmsTargetPrice
        : shopeeListing?.price ?? p.sellPrice
    const lastSyncedPrice =
      typeof attrs.lastSyncedShopeePrice === 'number'
        ? attrs.lastSyncedShopeePrice
        : effectiveTargetPrice
    const lastSyncedStock =
      typeof attrs.lastSyncedShopeeStock === 'number'
        ? attrs.lastSyncedShopeeStock
        : typeof attrs.liveShopeeStock === 'number'
          ? attrs.liveShopeeStock
          : Math.max(0, p.stock)
    const liveShopeeStock =
      typeof attrs.liveShopeeStock === 'number' ? attrs.liveShopeeStock : lastSyncedStock
    const effectiveUnlisted =
      typeof attrs.cmsTargetUnlisted === 'boolean'
        ? attrs.cmsTargetUnlisted
        : Boolean(attrs.isUnlistedOnShopee)
    const lastSyncedUnlisted =
      typeof attrs.lastSyncedShopeeUnlisted === 'boolean' ? attrs.lastSyncedShopeeUnlisted : null

    const hasPendingPrice =
      typeof attrs.cmsTargetPrice === 'number'
        ? attrs.cmsTargetPrice !== lastSyncedPrice
        : lastSyncedPrice > 0 && lastSyncedPrice !== effectiveTargetPrice
    const hasPendingUnlisted =
      typeof attrs.cmsTargetUnlisted === 'boolean' ||
      (lastSyncedUnlisted !== null && lastSyncedUnlisted !== effectiveUnlisted)
    const hasPendingImage = Boolean(
      (typeof attrs.cmsTargetImage === 'string' && attrs.cmsTargetImage.trim()) ||
        attrs.pendingCdnOffload
    )
    const hasNonStockOutboxMutation = hasPendingPrice || hasPendingUnlisted || hasPendingImage
    const productLedgerIds = pendingLedgerIdsByProduct.get(p.id) ?? []

    if (nextPolicy.syncMode === 'VIRTUAL_ALWAYS_IN_STOCK') {
      // Chuyển sang / cập nhật Chế độ 2 (Tồn ảo trên Sàn & Chống ghi đè CMS)
      if (typeof attrs.mode1HoldBaselineStock === 'number') {
        delete attrs.mode1HoldBaselineStock
        mutated = true
      }

      if (strategy === 'APPLY_IMMEDIATELY' && !effectiveUnlisted) {
        if (lastSyncedStock !== nextPolicy.virtualStockQty) {
          attrs.cmsTargetStock = nextPolicy.virtualStockQty
          attrs.cmsTargetStockOrigin = 'VIRTUAL_POLICY'
          attrs.pendingOutboxSync = true
          attrs.lastOutboxSyncAt = nowIso
          delete attrs.outboxSuppressedKey
          mutated = true
          queuedImmediateSyncCount++
        }
      } else {
        // SEAMLESS_HOLD_CURRENT: Hủy các lệnh chờ đẩy tồn từ Chế độ 1 (trừ khi là override thủ công đơn lẻ), giữ nguyên Giá/Ảnh/Ẩn-Hiện
        if (
          typeof attrs.cmsTargetStock === 'number' &&
          attrs.cmsTargetStockOrigin !== 'MANUAL_OVERRIDE'
        ) {
          delete attrs.cmsTargetStock
          delete attrs.cmsTargetStockOrigin
          mutated = true
        }

        const needsAutoRefillNow =
          nextPolicy.virtualAutoRefill &&
          !effectiveUnlisted &&
          lastSyncedStock >= 0 &&
          lastSyncedStock <= nextPolicy.virtualMinThreshold &&
          lastSyncedStock !== nextPolicy.virtualStockQty

        if (needsAutoRefillNow) {
          queuedImmediateSyncCount++
        } else if (productLedgerIds.length > 0 || Boolean(attrs.pendingOutboxSync)) {
          if (hasNonStockOutboxMutation) {
            preservedNonStockOutboxCount++
          } else if (attrs.cmsTargetStockOrigin !== 'MANUAL_OVERRIDE') {
            attrs.pendingOutboxSync = false
            delete attrs.outboxState
            delete attrs.outboxError
            mutated = true
            cancelledStaleStockOutboxCount++
            ledgerIdsToSupersede.push(...productLedgerIds)
          }
        }
      }

      const nextRecStatus =
        liveShopeeStock !== p.stock ? 'VIRTUAL_MARKETPLACE_ACTIVE' : 'RECONCILED_OK'
      if (attrs.reconciliationStatus !== nextRecStatus) {
        attrs.reconciliationStatus = nextRecStatus
        mutated = true
      }
    } else {
      // Chuyển sang / cập nhật Chế độ 1 (Đồng bộ tồn kho thật CMS -> Sàn)
      const clampedReal = Math.max(0, p.stock)

      if (typeof attrs.cmsTargetStock === 'number' && attrs.cmsTargetStockOrigin === 'VIRTUAL_POLICY') {
        delete attrs.cmsTargetStock
        delete attrs.cmsTargetStockOrigin
        mutated = true
      }

      if (strategy === 'APPLY_IMMEDIATELY') {
        if (typeof attrs.mode1HoldBaselineStock === 'number') {
          delete attrs.mode1HoldBaselineStock
          mutated = true
        }
        if (typeof attrs.outboxSuppressedKey === 'string') {
          delete attrs.outboxSuppressedKey
          mutated = true
        }
        if (lastSyncedStock !== clampedReal) {
          attrs.cmsTargetStock = clampedReal
          attrs.cmsTargetStockOrigin = 'CMS_SYNC_POLICY'
          attrs.pendingOutboxSync = true
          attrs.lastCmsEditAt = nowIso
          mutated = true
          queuedImmediateSyncCount++
        }
        const nextRecStatus =
          liveShopeeStock === clampedReal && p.stock >= 0 ? 'RECONCILED_OK' : 'STOCK_DRIFT'
        if (attrs.reconciliationStatus !== nextRecStatus) {
          attrs.reconciliationStatus = nextRecStatus
          mutated = true
        }
      } else {
        // SEAMLESS_HOLD_CURRENT (Mặc định an toàn khi chuyển từ Mode 2 sang Mode 1):
        // Giữ nguyên các SKU đang bán trên Sàn (không đẩy tồn 0 đột ngột làm sập giỏ Live), chỉ đồng bộ khi có biến động mới!
        if (modeSwitched && lastSyncedStock >= 0 && lastSyncedStock !== clampedReal) {
          attrs.mode1HoldBaselineStock = clampedReal
          attrs.mode1HoldSetAt = nowIso
          attrs.reconciliationStatus = 'MODE1_HOLD_UNTIL_NEXT_CHANGE'
          mutated = true
          heldOnMarketplaceCount++
        } else if (
          attrs.reconciliationStatus === 'VIRTUAL_MARKETPLACE_ACTIVE' &&
          typeof attrs.mode1HoldBaselineStock !== 'number'
        ) {
          attrs.reconciliationStatus =
            liveShopeeStock === clampedReal && p.stock >= 0 ? 'RECONCILED_OK' : 'STOCK_DRIFT'
          mutated = true
        }

        if (productLedgerIds.length > 0 || Boolean(attrs.pendingOutboxSync)) {
          if (hasNonStockOutboxMutation) {
            preservedNonStockOutboxCount++
          } else if (modeSwitched && attrs.cmsTargetStockOrigin !== 'MANUAL_OVERRIDE') {
            attrs.pendingOutboxSync = false
            delete attrs.outboxState
            delete attrs.outboxError
            mutated = true
            cancelledStaleStockOutboxCount++
            ledgerIdsToSupersede.push(...productLedgerIds)
          }
        }
      }
    }

    if (mutated) {
      const nextJson = JSON.stringify(attrs)
      await db.product.update({
        where: { id: p.id },
        data: { attributes: nextJson },
      })
      patchProductInApiCache(p.id, { attributes: nextJson })
    }
  }

  if (ledgerIdsToSupersede.length > 0) {
    await db.ledgerEntry.updateMany({
      where: { id: { in: Array.from(new Set(ledgerIdsToSupersede)) } },
      data: { action: 'OUTBOX_SUPERSEDED_BY_MODE_SWITCH' },
    })
  }

  if (modeSwitched || negativeToggled || strategy === 'APPLY_IMMEDIATELY') {
    void logLedger({
      scope: 'SETTINGS',
      action: 'INVENTORY_MODE_TRANSITION_APPLIED',
      actor: actor === 'SYSTEM' ? 'SYSTEM' : 'OPERATOR',
      title: `[CHUYỂN CHẾ ĐỘ KHÔNG GIÁN ĐOẠN] ${prevPolicy.syncMode} ➔ ${nextPolicy.syncMode} · Bán âm: ${nextPolicy.allowNegativeStock ? `BẬT (${nextPolicy.negativeStockScope})` : 'TẮT'} (${strategy === 'APPLY_IMMEDIATELY' ? 'Đồng bộ ngay' : 'Chuyển mượt bảo vệ phiên bán'})`,
      detail: {
        prevPolicy,
        nextPolicy,
        strategy,
        heldOnMarketplaceCount,
        cancelledStaleStockOutboxCount,
        preservedNonStockOutboxCount,
        queuedImmediateSyncCount,
        preservedNegativeSkusCount,
      },
    })
  }

  invalidateApiCache('settings:')
  invalidateApiCache('products')
  invalidateApiCache('inventory:')
  invalidateApiCache('channels:product-links')

  const shouldTriggerDaemonSync =
    queuedImmediateSyncCount > 0 || preservedNonStockOutboxCount > 0

  return {
    modeSwitched,
    negativeToggled,
    strategy,
    heldOnMarketplaceCount,
    cancelledStaleStockOutboxCount,
    preservedNonStockOutboxCount,
    queuedImmediateSyncCount,
    preservedNegativeSkusCount,
    shouldTriggerDaemonSync,
  }
}

export { canChannelSellNegative }
