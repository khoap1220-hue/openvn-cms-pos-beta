// Chính sách Tồn kho Thật CMS & Đồng bộ Tồn kho Ảo Sàn TMĐT (Dùng chung Server & Client)
// Bất biến cốt lõi: Tồn kho CMS (Product.stock / WarehouseStock / StockMovement) BẮT BUỘC 100% là dữ liệu vật lý thật tại kho;
// Sàn TMĐT (Shopee) có thể chạy tồn kho ảo tùy nhu cầu cửa hàng mà KHÔNG BAO GIỜ ghi đè ngược vào kho thật CMS.

export type InventoryMarketplaceSyncMode =
  | 'SYNC_CMS_TO_MARKETPLACE' // 1. Đồng bộ tồn kho thật từ CMS lên Sàn (CMS -> Sàn: max(0, CMS stock))
  | 'VIRTUAL_ALWAYS_IN_STOCK' // 2. Sàn luôn tồn hàng ở mức ảo & Chống ghi đè tồn thật CMS

export type NegativeStockScope =
  | 'ALL_CHANNELS' // Cho phép bán âm kho thật trên mọi kênh (Sàn TMĐT + POS tại quầy + Đơn nội bộ)
  | 'MARKETPLACE_ONLY' // Chỉ cho phép bán âm kho thật từ đơn đồng bộ Sàn TMĐT (POS vẫn chặn khi kho <= 0)

export interface InventorySyncPolicy {
  /** Chế độ liên kết tồn kho giữa Kho thật CMS và Sàn TMĐT */
  syncMode: InventoryMarketplaceSyncMode
  /** Mức tồn kho ảo duy trì trên Sàn khi chọn chế độ VIRTUAL_ALWAYS_IN_STOCK (mặc định: 100) */
  virtualStockQty: number
  /** Ngưỡng tối thiểu trên Sàn để tự động bơm lại mức tồn ảo (mặc định: 10) */
  virtualMinThreshold: number
  /** Tự động bơm lại mức tồn ảo lên Sàn qua Outbox khi tồn Sàn tụt xuống <= ngưỡng */
  virtualAutoRefill: boolean
  /** 3. Cho phép bán âm Kho thật CMS (trừ thẳng tồn vật lý xuống < 0 để khi nhập hàng tự bù trừ chính xác) */
  allowNegativeStock: boolean
  /** Phạm vi áp dụng bán âm kho thật CMS */
  negativeStockScope: NegativeStockScope
}

export const INVENTORY_POLICY_SETTING_KEYS = [
  'inventory_sync_mode',
  'inventory_virtual_stock_qty',
  'inventory_virtual_min_threshold',
  'inventory_virtual_auto_refill',
  'inventory_allow_negative_stock',
  'inventory_negative_stock_scope',
] as const

export const DEFAULT_INVENTORY_SYNC_POLICY: InventorySyncPolicy = {
  syncMode: 'VIRTUAL_ALWAYS_IN_STOCK',
  virtualStockQty: 100,
  virtualMinThreshold: 10,
  virtualAutoRefill: false,
  allowNegativeStock: false,
  negativeStockScope: 'ALL_CHANNELS',
}

export const INVENTORY_POLICY_DEFAULTS_MAP: Record<
  (typeof INVENTORY_POLICY_SETTING_KEYS)[number],
  string
> = {
  inventory_sync_mode: DEFAULT_INVENTORY_SYNC_POLICY.syncMode,
  inventory_virtual_stock_qty: String(DEFAULT_INVENTORY_SYNC_POLICY.virtualStockQty),
  inventory_virtual_min_threshold: String(DEFAULT_INVENTORY_SYNC_POLICY.virtualMinThreshold),
  inventory_virtual_auto_refill: String(DEFAULT_INVENTORY_SYNC_POLICY.virtualAutoRefill),
  inventory_allow_negative_stock: String(DEFAULT_INVENTORY_SYNC_POLICY.allowNegativeStock),
  inventory_negative_stock_scope: DEFAULT_INVENTORY_SYNC_POLICY.negativeStockScope,
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') {
    const norm = raw.trim().toLowerCase()
    if (norm === 'true' || norm === '1' || norm === 'yes' || norm === 'on') return true
    if (norm === 'false' || norm === '0' || norm === 'no' || norm === 'off') return false
  }
  return fallback
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const num = Number(raw)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.round(num)))
}

export function parseInventorySyncPolicy(
  rawMap?: Record<string, unknown> | null
): InventorySyncPolicy {
  if (!rawMap) return { ...DEFAULT_INVENTORY_SYNC_POLICY }

  const rawMode = String(rawMap.inventory_sync_mode ?? '').trim().toUpperCase()
  const syncMode: InventoryMarketplaceSyncMode =
    rawMode === 'SYNC_CMS_TO_MARKETPLACE'
      ? 'SYNC_CMS_TO_MARKETPLACE'
      : 'VIRTUAL_ALWAYS_IN_STOCK'

  const virtualStockQty = clampInt(
    rawMap.inventory_virtual_stock_qty,
    1,
    999_999,
    DEFAULT_INVENTORY_SYNC_POLICY.virtualStockQty
  )
  const virtualMinThreshold = clampInt(
    rawMap.inventory_virtual_min_threshold,
    0,
    Math.max(0, virtualStockQty - 1),
    Math.min(DEFAULT_INVENTORY_SYNC_POLICY.virtualMinThreshold, Math.max(0, virtualStockQty - 1))
  )
  const virtualAutoRefill = parseBool(
    rawMap.inventory_virtual_auto_refill,
    DEFAULT_INVENTORY_SYNC_POLICY.virtualAutoRefill
  )
  const allowNegativeStock = parseBool(
    rawMap.inventory_allow_negative_stock,
    DEFAULT_INVENTORY_SYNC_POLICY.allowNegativeStock
  )
  const rawScope = String(rawMap.inventory_negative_stock_scope ?? '').trim().toUpperCase()
  const negativeStockScope: NegativeStockScope =
    rawScope === 'MARKETPLACE_ONLY' ? 'MARKETPLACE_ONLY' : 'ALL_CHANNELS'

  return {
    syncMode,
    virtualStockQty,
    virtualMinThreshold,
    virtualAutoRefill,
    allowNegativeStock,
    negativeStockScope,
  }
}

export function canChannelSellNegative(
  policy: InventorySyncPolicy,
  channelKey?: string | null
): boolean {
  if (!policy.allowNegativeStock) return false
  if (policy.negativeStockScope === 'ALL_CHANNELS') return true
  const ck = String(channelKey || '').trim().toUpperCase()
  return (
    ck === 'SHOPEE' ||
    ck === 'TIKTOK' ||
    ck === 'LAZADA' ||
    ck === 'TIKI' ||
    ck.includes('SHOPEE')
  )
}
