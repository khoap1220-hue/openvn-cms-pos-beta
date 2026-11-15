import { getApiCache, setApiCache } from '@/lib/realtime'
import { getSettings } from '@/lib/settings'
import {
  DEFAULT_INVENTORY_SYNC_POLICY,
  INVENTORY_POLICY_SETTING_KEYS,
  type InventorySyncPolicy,
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
  hasExplicitOutbox: boolean
  isUnlistedOnShopee?: boolean
}

export interface MarketplaceStockResolution {
  targetStock: number
  stockDrifted: boolean
  isMarketplaceStockProtected: boolean
  isVirtualRefillJob: boolean
}

/**
 * Giải quyết số lượng tồn kho đích trên Sàn TMĐT (Shopee) từ Chính sách cửa hàng:
 * - Bất biến: Shopee API chỉ nhận tồn >= 0; Kho CMS giữ 100% tồn vật lý thật (có thể âm nếu bật bán âm).
 * - Mode 1 (SYNC_CMS_TO_MARKETPLACE): Đẩy max(0, cmsRealStock) từ CMS lên Sàn.
 * - Mode 2 (VIRTUAL_ALWAYS_IN_STOCK): Chống ghi đè 2 chiều; giữ nguyên tồn ảo trên Sàn hoặc tự động bơm lại
 *   lên virtualStockQty khi tồn Sàn tụt xuống <= virtualMinThreshold (nếu bật virtualAutoRefill).
 */
export function resolveMarketplaceTargetStock(
  input: MarketplaceStockResolutionInput
): MarketplaceStockResolution {
  const {
    policy,
    cmsRealStock,
    lastSyncedStock,
    cmsExplicitTargetStock,
    hasExplicitOutbox,
    isUnlistedOnShopee = false,
  } = input

  // 1. Lệnh đẩy tường minh từ người vận hành (VD: Bấm "Đẩy tồn lên Sàn" hoặc "Áp mức tồn ảo")
  if (typeof cmsExplicitTargetStock === 'number' && Number.isFinite(cmsExplicitTargetStock)) {
    const clampedTarget = Math.max(0, Math.round(cmsExplicitTargetStock))
    return {
      targetStock: clampedTarget,
      stockDrifted: hasExplicitOutbox || lastSyncedStock !== clampedTarget,
      isMarketplaceStockProtected: false,
      isVirtualRefillJob: false,
    }
  }

  // 2. Chế độ 1: Đồng bộ tồn kho thật từ CMS lên Sàn (CMS -> Sàn)
  if (policy.syncMode === 'SYNC_CMS_TO_MARKETPLACE') {
    const clampedReal = Math.max(0, Math.round(cmsRealStock))
    const drifted =
      (hasExplicitOutbox || lastSyncedStock >= 0) && lastSyncedStock !== clampedReal
    return {
      targetStock: clampedReal,
      stockDrifted: drifted,
      isMarketplaceStockProtected: false,
      isVirtualRefillJob: false,
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
  }
}

export { canChannelSellNegative }
