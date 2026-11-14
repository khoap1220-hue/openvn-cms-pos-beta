// Broadcast realtime event qua mini-service socket.io (port 3003).
// Fire-and-forget: lỗi kết nối không ảnh hưởng nghiệp vụ chính.

const REALTIME_URL = process.env.REALTIME_URL || `http://localhost:${process.env.REALTIME_PORT || '3013'}`

export type CmsEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.event'
  | 'agent.activity'
  | 'shipment.updated'
  | 'message.new'
  | 'message.reaction'
  | 'review.received'
  | 'settings.updated'
  | 'ledger.new'
  | 'customer.updated'
  | 'product.updated'
  | 'inventory.updated'
  | 'channel.updated'
  | 'channel.unlinked_item'
  | 'channel.product_linked'
  | 'channel.session_lost'
  | 'channel.session_restored'
  | 'channel.link_lost'
  | 'outbox.updated'
  | 'loyalty.policy.updated'
  | 'campaign.wave.updated'
  | 'behavior.new'
  | 'marketplace.unlisted_alert'

export interface MaintenanceMemoryState {
  enabled: boolean
  reason: string
  retryAfterSec: number
  updatedAt: string | null
  hydrated: boolean
}

// Bộ nhớ đệm đọc tốc độ cao (In-Memory L1 Pre-Serialized SWR Cache) tự động xóa tức thì khi có bất kỳ sự kiện broadcast mutation nào
const gCache = globalThis as unknown as {
  __cmsApiCache?: Map<string, { data: unknown; rawJson: string; expiresAt: number }>
  __cmsMaintenanceState?: MaintenanceMemoryState
}
const apiCacheMap = gCache.__cmsApiCache ?? (gCache.__cmsApiCache = new Map())
const maintenanceState =
  gCache.__cmsMaintenanceState ??
  (gCache.__cmsMaintenanceState = {
    enabled: process.env.CMS_MAINTENANCE_MODE === 'true',
    reason: 'Hệ thống đang bảo trì nâng cấp an toàn trên nhánh chính (Read-Only).',
    retryAfterSec: 120,
    updatedAt: null,
    hydrated: false,
  })

export function getMaintenanceMemoryState(): MaintenanceMemoryState {
  return maintenanceState
}

export function setMaintenanceMemoryState(patch: Partial<MaintenanceMemoryState>): MaintenanceMemoryState {
  if (patch.enabled !== undefined) maintenanceState.enabled = Boolean(patch.enabled)
  if (patch.reason !== undefined) maintenanceState.reason = patch.reason
  if (patch.retryAfterSec !== undefined && Number.isFinite(patch.retryAfterSec) && patch.retryAfterSec > 0) {
    maintenanceState.retryAfterSec = Math.floor(patch.retryAfterSec)
  }
  if (patch.updatedAt !== undefined) maintenanceState.updatedAt = patch.updatedAt
  if (patch.hydrated !== undefined) maintenanceState.hydrated = patch.hydrated
  return maintenanceState
}

export function getApiCache<T>(key: string): T | null {
  const entry = apiCacheMap.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    apiCacheMap.delete(key)
    return null
  }
  return entry.data as T
}

export function getApiCacheRawJson(key: string): string | null {
  const entry = apiCacheMap.get(key)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    apiCacheMap.delete(key)
    return null
  }
  return entry.rawJson
}

export function getApiCacheKeys(): string[] {
  return Array.from(apiCacheMap.keys())
}

export function setApiCache<T>(key: string, data: T, ttlMs = 180_000): void {
  const effectiveTtl = Math.max(ttlMs, 10_000)
  apiCacheMap.set(key, {
    data,
    rawJson: JSON.stringify(data),
    expiresAt: Date.now() + effectiveTtl,
  })
}

/**
 * Tra cứu nhanh 1 sản phẩm từ bộ nhớ đệm L1 `products:*` (0ms) để tránh query `findUnique` thừa trước khi `update`.
 */
export function getProductFromApiCache<T = Record<string, unknown>>(idOrSku: string): T | null {
  if (!idOrSku) return null
  for (const [key, entry] of apiCacheMap.entries()) {
    if (!key.startsWith('products:')) continue
    if (entry.expiresAt <= Date.now()) continue
    const dataObj = entry.data as { products?: Array<Record<string, unknown>> } | null
    if (!dataObj || !Array.isArray(dataObj.products)) continue
    const found = dataObj.products.find((p) => p.id === idOrSku || p.sku === idOrSku)
    if (found) return found as unknown as T
  }
  return null
}

/**
 * Cập nhật trực tiếp (Surgical In-Place Patch) một sản phẩm trong bộ nhớ đệm L1 `products:*`
 * giúp thao tác Sửa/Lưu sản phẩm hoặc Nhập/Xuất kho phản hồi tức thì (<25ms) mà không cần tải lại toàn bộ bảng từ DB.
 */
export function patchProductInApiCache(
  productId: string,
  patch: Record<string, unknown>
): boolean {
  let patchedAny = false
  for (const [key, entry] of apiCacheMap.entries()) {
    if (!key.startsWith('products:')) continue
    const dataObj = entry.data as { products?: Array<Record<string, unknown>> } | null
    if (!dataObj || !Array.isArray(dataObj.products)) continue
    let found = false
    const nextProducts = dataObj.products.map((p) => {
      if (p.id === productId) {
        found = true
        return { ...p, ...patch }
      }
      return p
    })
    if (found) {
      const nextData = { ...dataObj, products: nextProducts }
      apiCacheMap.set(key, {
        data: nextData,
        rawJson: JSON.stringify(nextData),
        expiresAt: Date.now() + 180_000,
      })
      patchedAny = true
    }
  }
  return patchedAny
}

export function resolveL1CacheKey(pathname: string, searchParams: URLSearchParams): string | null {
  switch (pathname) {
    case '/api/dashboard': {
      const d = parseInt(searchParams.get('days') || '14', 10)
      return `dashboard:${[7, 14, 30, 90].includes(d) ? d : 14}`
    }
    case '/api/liveops':
      return 'liveops:main'
    case '/api/products':
      return `products:${searchParams.toString()}`
    case '/api/channels':
      return 'channels:all'
    case '/api/channels/product-links':
      return 'channels:product-links'
    case '/api/orders':
      return `orders:${searchParams.toString()}`
    case '/api/inventory':
      return `inventory:${searchParams.toString()}`
    case '/api/periods':
      return `periods:${Number(searchParams.get('year')) || new Date().getFullYear()}`
    case '/api/categories':
      return 'categories:all'
    case '/api/warehouses':
      return 'warehouses:all'
    case '/api/unit-conversions':
      return 'unit-conversions:all'
    case '/api/vouchers':
      return searchParams.get('code') ? null : 'vouchers:all'
    case '/api/loyalty-policy':
      return 'loyalty-policy:all'
    case '/api/shipments':
      return `shipments:${searchParams.toString()}`
    case '/api/customers':
      return `customers:${searchParams.toString()}`
    case '/api/reports': {
      const days = Math.min(90, Math.max(7, Number(searchParams.get('days')) || 30))
      return `reports:${days}`
    }
    case '/api/inbox':
      return !searchParams.get('customerId') && !searchParams.get('channelKey')
        ? 'inbox:conversations'
        : null
    case '/api/bom':
      return `bom:${searchParams.get('productId')?.trim() || 'all'}`
    case '/api/invoice-dashboard': {
      const year = Number(searchParams.get('year')) || new Date().getFullYear()
      const qp = Number(searchParams.get('quarter')) || 0
      return `invoice-dashboard:${year}:${qp >= 1 && qp <= 4 ? qp : 0}`
    }
    case '/api/sales-invoices':
      return `sales-invoices:${searchParams.toString()}`
    case '/api/purchase-invoices':
      return `purchase-invoices:${searchParams.toString()}`
    case '/api/partners':
      return `partners:${searchParams.toString()}`
    case '/api/ledger':
      return `ledger:${searchParams.toString()}`
    case '/api/ledger/test-guard':
      return 'ledger:test-guard'
    case '/api/settings':
      return 'settings:public'
    case '/api/reconciliation':
      return 'reconciliation:main'
    case '/api/integrations':
      return 'integrations:main'
    default:
      return null
  }
}

export function invalidateApiCache(prefix?: string): void {
  if (!prefix) {
    apiCacheMap.clear()
    return
  }
  for (const k of apiCacheMap.keys()) {
    if (k.startsWith(prefix)) apiCacheMap.delete(k)
  }
}

export function broadcast(type: CmsEventType, payload?: unknown): void {
  // Mọi sự kiện thay đổi dữ liệu đều làm mới bộ nhớ đệm test-guard
  invalidateApiCache('ledger:test-guard')
  // Xóa cache phân vùng thông minh theo đúng miền dữ liệu thay đổi (Domain-Scoped Cache Invalidation)
  switch (type) {
    case 'behavior.new':
      invalidateApiCache('behavior:')
      break
    case 'ledger.new':
      invalidateApiCache('ledger:')
      invalidateApiCache('reconciliation:')
      invalidateApiCache('integrations:')
      break
    case 'agent.activity':
      invalidateApiCache('liveops:')
      break
    case 'message.new':
    case 'message.reaction':
      invalidateApiCache('inbox:')
      invalidateApiCache('liveops:')
      break
    case 'product.updated':
    case 'inventory.updated': {
      const keepProductsCache =
        payload != null &&
        typeof payload === 'object' &&
        (payload as { inPlacePatched?: boolean }).inPlacePatched === true
      if (!keepProductsCache) {
        invalidateApiCache('products:')
      }
      invalidateApiCache('inventory:')
      invalidateApiCache('warehouses:')
      invalidateApiCache('bom:')
      invalidateApiCache('channels')
      invalidateApiCache('dashboard:')
      invalidateApiCache('reconciliation:')
      break
    }
    case 'channel.updated':
    case 'channel.unlinked_item':
    case 'channel.product_linked':
    case 'marketplace.unlisted_alert':
      invalidateApiCache('channels')
      invalidateApiCache('products:')
      invalidateApiCache('dashboard:')
      invalidateApiCache('integrations:')
      break
    case 'order.created':
    case 'order.updated':
    case 'order.event':
    case 'shipment.updated':
      invalidateApiCache('orders:')
      invalidateApiCache('products:')
      invalidateApiCache('inventory:')
      invalidateApiCache('warehouses:')
      invalidateApiCache('vouchers:')
      invalidateApiCache('shipments:')
      invalidateApiCache('dashboard:')
      invalidateApiCache('liveops:')
      invalidateApiCache('reports:')
      invalidateApiCache('invoice-dashboard:')
      invalidateApiCache('sales-invoices:')
      invalidateApiCache('reconciliation:')
      break
    case 'customer.updated':
    case 'loyalty.policy.updated':
      invalidateApiCache('customers:')
      invalidateApiCache('loyalty-policy:')
      break
    case 'settings.updated':
      invalidateApiCache('settings:')
      invalidateApiCache('liveops:')
      invalidateApiCache('periods:')
      invalidateApiCache('integrations:')
      break
    case 'review.received':
      invalidateApiCache('dashboard:')
      invalidateApiCache('liveops:')
      break
    case 'campaign.wave.updated':
      invalidateApiCache('dashboard:')
      invalidateApiCache('campaigns:')
      break
    default:
      // Không xóa toàn bộ cache khi có sự kiện phụ không xác định
      break
  }

  const body = JSON.stringify({
    event: 'cms',
    payload: { type, at: new Date().toISOString(), data: payload ?? null },
  })
  fetch(`${REALTIME_URL}/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {
    // realtime service tạm mất — bỏ qua, client sẽ tự refetch định kỳ
  })
}
