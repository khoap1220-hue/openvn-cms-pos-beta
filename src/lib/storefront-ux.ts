/**
 * Pure UX, VietQR, Deep-Link & Isolated Cart Persistence Helpers for Online Storefront
 * Shared across `/store` (Next.js App Router) and verification suites.
 * Strictly 0 costPrice / 0 secret exposure; isolated per `cmsInstanceId`.
 */

export type StorefrontNavTab = 'PRODUCTS' | 'WHOLESALE' | 'CONTACT' | 'TRACKING'

export interface StorefrontVietQrInput {
  bankCode?: string | null
  bankAccount?: string | null
  bankHolder?: string | null
  amount?: number | null
  addInfo?: string | null
  template?: 'compact' | 'compact2' | 'qr_only'
}

export interface PersistedCartLineRef {
  productId: string
  sku: string
  quantity: number
}

export interface StorefrontDeepLinkState {
  tab: StorefrontNavTab | null
  sku: string
  query: string
  priceMode: 'RETAIL' | 'WHOLESALE' | null
  lookupCode: string
}

export function sanitizeVietQrTransferMemo(raw?: string | null): string {
  if (!raw) return ''
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, (ch) => (ch === 'đ' ? 'd' : 'D'))
    .replace(/[^A-Za-z0-9 -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50)
}

export function buildStorefrontVietQrUrl(input: StorefrontVietQrInput): string {
  const cleanCode = String(input.bankCode || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const cleanAccount = String(input.bankAccount || '')
    .trim()
    .replace(/[\s.-]+/g, '')
    .replace(/[^A-Za-z0-9]/g, '')

  if (cleanCode.length < 2 || cleanCode.length > 20) return ''
  if (cleanAccount.length < 5 || cleanAccount.length > 26) return ''

  const tpl = input.template || 'compact2'
  const params = new URLSearchParams()

  const cleanAmount = Math.max(0, Math.round(Number(input.amount) || 0))
  if (cleanAmount > 0) {
    params.set('amount', String(cleanAmount))
  }

  const memo = sanitizeVietQrTransferMemo(input.addInfo)
  if (memo) {
    params.set('addInfo', memo)
  }

  const holder = String(input.bankHolder || '')
    .trim()
    .slice(0, 70)
  if (holder) {
    params.set('accountName', holder)
  }

  const qs = params.toString()
  return `https://img.vietqr.io/image/${cleanCode}-${cleanAccount}-${tpl}.png${qs ? `?${qs}` : ''}`
}

export function buildStorefrontCartStorageKey(cmsInstanceId?: string | null): string {
  const cleanId =
    String(cmsInstanceId || '')
      .trim()
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 64) || 'default'
  return `openvn_sf_cart_v1_${cleanId}`
}

export function serializeCartForStorage<
  T extends { product: { id: string; sku: string }; quantity: number },
>(cart: T[]): PersistedCartLineRef[] {
  if (!Array.isArray(cart)) return []
  return cart
    .slice(0, 60)
    .map((line) => ({
      productId: String(line?.product?.id || '').trim(),
      sku: String(line?.product?.sku || '').trim(),
      quantity: Math.max(0, Math.min(10_000, Math.floor(Number(line?.quantity) || 0))),
    }))
    .filter((line) => (line.productId || line.sku) && line.quantity > 0)
}

export function reconcilePersistedCartWithCatalog<
  P extends { id: string; sku: string; availableToOrder: boolean },
>(rawSaved: unknown, catalogProducts: P[]): Array<{ product: P; quantity: number }> {
  if (!Array.isArray(rawSaved) || !Array.isArray(catalogProducts) || catalogProducts.length === 0) {
    return []
  }

  const merged = new Map<string, { product: P; quantity: number }>()
  for (const rawItem of rawSaved.slice(0, 60)) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const rec = rawItem as Record<string, unknown>
    const pid = String(rec.productId || '').trim()
    const sku = String(rec.sku || '')
      .trim()
      .toUpperCase()
    const qty = Math.max(0, Math.min(10_000, Math.floor(Number(rec.quantity) || 0)))
    if (qty <= 0 || (!pid && !sku)) continue

    const matched = catalogProducts.find(
      (p) => (pid && p.id === pid) || (sku && p.sku.toUpperCase() === sku)
    )
    if (!matched || !matched.availableToOrder) continue

    const existing = merged.get(matched.id)
    if (existing) {
      existing.quantity = Math.min(10_000, existing.quantity + qty)
    } else {
      merged.set(matched.id, { product: matched, quantity: qty })
    }
  }

  return Array.from(merged.values())
}

export function parseStorefrontDeepLinkQuery(searchString: string): StorefrontDeepLinkState {
  const sp = new URLSearchParams(searchString.startsWith('?') ? searchString.slice(1) : searchString)
  const rawTab = String(sp.get('tab') || sp.get('section') || '')
    .trim()
    .toUpperCase()

  let tab: StorefrontNavTab | null = null
  if (rawTab === 'PRODUCTS' || rawTab === 'SANPHAM') tab = 'PRODUCTS'
  else if (rawTab === 'WHOLESALE' || rawTab === 'SI' || rawTab === 'BANGGIASI') tab = 'WHOLESALE'
  else if (rawTab === 'CONTACT' || rawTab === 'LIENHE') tab = 'CONTACT'
  else if (rawTab === 'TRACKING' || rawTab === 'TRACUU' || rawTab === 'LOOKUP') tab = 'TRACKING'

  const sku = String(sp.get('sku') || '')
    .trim()
    .slice(0, 64)
  const query = String(sp.get('q') || sp.get('search') || '')
    .trim()
    .slice(0, 80)

  const rawMode = String(sp.get('mode') || '')
    .trim()
    .toUpperCase()
  const priceMode =
    rawMode === 'WHOLESALE' || rawMode === 'SI'
      ? 'WHOLESALE'
      : rawMode === 'RETAIL' || rawMode === 'LE'
        ? 'RETAIL'
        : null

  const lookupCode = String(sp.get('code') || sp.get('lookupCode') || '')
    .trim()
    .toUpperCase()
    .slice(0, 48)

  if (!tab && lookupCode) {
    tab = 'TRACKING'
  }

  return { tab, sku, query, priceMode, lookupCode }
}

export function formatStorefrontLookupStatusLabel(status?: string | null): string {
  const code = String(status || '')
    .trim()
    .toUpperCase()
  const labels: Record<string, string> = {
    RECEIVED_PENDING_CONFIRM: 'Đã tiếp nhận — Đang chờ CSKH xác nhận giao hàng',
    RECEIVED_WHOLESALE_LEAD: 'Đã tiếp nhận — Bộ phận Sỉ đang lập báo giá chi tiết',
    RECEIVED: 'Đã tiếp nhận yêu cầu',
    PENDING: 'Chờ xác nhận đơn hàng',
    CONFIRMED: 'Đã xác nhận — Đang chuẩn bị hàng tại xưởng',
    PROCESSING: 'Đang chế tác / đóng gói chống sốc',
    PACKING: 'Đang đóng gói bàn giao vận chuyển',
    READY_TO_SHIP: 'Sẵn sàng bàn giao đơn vị vận chuyển',
    SHIPPING: 'Đang vận chuyển giao hàng',
    IN_TRANSIT: 'Đang trên đường giao tới bạn',
    DELIVERED: 'Đã giao hàng thành công',
    COMPLETED: 'Hoàn tất đơn hàng',
    CANCELLED: 'Đã hủy đơn',
    RETURNED: 'Hoàn trả / Đổi hàng',
  }
  return labels[code] || (status ? String(status) : 'Đã tiếp nhận')
}

export function buildStorefrontProductShareUrl(
  baseHref: string,
  sku: string
): string {
  const cleanSku = String(sku || '').trim()
  try {
    const u = new URL(baseHref)
    u.hash = ''
    u.search = ''
    if (cleanSku) {
      u.searchParams.set('sku', cleanSku)
    }
    return u.toString()
  } catch {
    return cleanSku ? `?sku=${encodeURIComponent(cleanSku)}` : baseHref
  }
}
