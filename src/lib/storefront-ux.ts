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

const VIETQR_BANK_ALIASES: Record<string, string> = {
  VIETCOMBANK: 'VCB',
  TECHCOMBANK: 'TCB',
  VIETINBANK: 'ICB',
  AGRIBANK: 'VBA',
  MBBANK: 'MB',
  SACOMBANK: 'STB',
  VPBANK: 'VPB',
  TPBANK: 'TPB',
  HDBANK: 'HDB',
  LPBANK: 'LPB',
  LIENVIETPOSTBANK: 'LPB',
  EXIMBANK: 'EIB',
  SEABANK: 'SEAB',
  SHINHANBANK: 'SHBVN',
}

export function normalizeVietQrBankCode(raw?: string | null): string {
  const clean = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  if (!clean) return ''
  return VIETQR_BANK_ALIASES[clean] || clean
}

export function sanitizeVietQrAccountName(raw?: string | null): string {
  if (!raw) return ''
  return String(raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/[^A-Z0-9 .&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 70)
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
  const cleanCode = normalizeVietQrBankCode(input.bankCode)
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

  const holder = sanitizeVietQrAccountName(input.bankHolder)
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

export function reconcileActiveCartItems<
  P extends { id: string; sku: string; availableToOrder: boolean },
>(
  currentCart: Array<{ product: P; quantity: number }>,
  catalogProducts: P[],
  storefrontClosed = false
): Array<{ product: P; quantity: number }> {
  if (storefrontClosed || !Array.isArray(currentCart) || currentCart.length === 0) {
    return []
  }
  return reconcilePersistedCartWithCatalog(serializeCartForStorage(currentCart), catalogProducts)
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
    RECEIVED_CONTACT: 'Đã tiếp nhận tin nhắn — Bộ phận CSKH đang phản hồi',
    RECEIVED: 'Đã tiếp nhận yêu cầu',
    NEW: 'Mới tạo — Đang chờ xử lý',
    PENDING: 'Chờ xác nhận đơn hàng',
    PAID: 'Đã thanh toán — Đang chuẩn bị giao hàng',
    CONFIRMED: 'Đã xác nhận — Đang chuẩn bị hàng tại xưởng',
    PROCESSING: 'Đang chế tác / đóng gói chống sốc',
    PACKING: 'Đang đóng gói bàn giao vận chuyển',
    PACKED: 'Đã đóng gói — Sẵn sàng bàn giao ĐVVC',
    READY_TO_SHIP: 'Sẵn sàng bàn giao đơn vị vận chuyển',
    DISPATCHED: 'Đã bàn giao đơn vị vận chuyển',
    PICKED_UP: 'Đơn vị vận chuyển đã lấy hàng',
    SHIPPING: 'Đang vận chuyển giao hàng',
    IN_TRANSIT: 'Đang trên đường giao tới bạn',
    DELIVERED: 'Đã giao hàng thành công',
    COMPLETED: 'Hoàn tất đơn hàng',
    CANCELLED: 'Đã hủy đơn',
    RETURNED: 'Hoàn trả / Đổi hàng',
    REFUNDED: 'Đã hoàn tiền',
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

export function formatHeroShortProductLabel(cleanTitleOrName?: string | null): string {
  const raw = String(cleanTitleOrName || '')
    .split('— Phân loại:')[0]
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
  if (!raw) return 'Sản phẩm thủ công'
  const firstDashPart = raw.split(/\s+[-–—]\s+/)[0]?.trim() || raw
  const base = firstDashPart.length >= 6 ? firstDashPart : raw
  if (base.length <= 26) return base

  const stopAttrPattern =
    /^(có|không|trắng|kem|xanh|đen|vàng|cam|be|đựng|cúng|lót|cắm|đặt|xi)$/i
  const words = base.split(/\s+/)
  const kept: string[] = []
  for (const w of words) {
    const cleanWord = w.replace(/[,.;:!?]+$/g, '')
    if (kept.join(' ').length >= 14 && stopAttrPattern.test(cleanWord)) {
      break
    }
    kept.push(cleanWord)
    if (kept.join(' ').length >= 26) break
  }
  return kept.length >= 2 ? kept.join(' ') : base.slice(0, 26).trim()
}

export function formatWholesaleTiersSummary(
  tiers?: Array<{ minQty: number; discountPercent: number; badge?: string }> | null,
  hasOemNote = true
): string {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return hasOemNote
      ? 'Chiết khấu trực tiếp theo mốc số lượng tại xưởng + Hỗ trợ gia công hộp quà OEM.'
      : 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ tại xưởng.'
  }
  const sorted = [...tiers]
    .filter((t) => Number(t?.minQty) > 0 && Number(t?.discountPercent) > 0)
    .sort((a, b) => a.minQty - b.minQty)
    .slice(0, 4)
  if (sorted.length === 0) {
    return 'Chiết khấu trực tiếp theo mốc số lượng tại xưởng.'
  }
  const parts = sorted.map(
    (t) => `Từ ${Math.floor(t.minQty)} SP giảm ${Math.round(t.discountPercent * 10) / 10}%`
  )
  return `${parts.join(' · ')}${hasOemNote ? ' + Khắc/in hộp quà OEM.' : '.'}`
}

export function selectHeroShowcaseProducts<
  P extends {
    id: string
    sku: string
    name: string
    cleanTitle?: string | null
    image?: string | null
    inStock?: boolean
    availableToOrder?: boolean
  },
>(products: P[], maxItems = 3): P[] {
  if (!Array.isArray(products) || maxItems <= 0) return []
  const limit = Math.min(6, Math.max(1, Math.floor(maxItems)))
  const withImage = products.filter((p) => Boolean(p && typeof p.image === 'string' && p.image.trim()))
  if (withImage.length === 0) return []

  const orderable = withImage.filter((p) => p.availableToOrder !== false)
  const pool = orderable.length > 0 ? orderable : withImage

  // Deduplicate by base cleanTitle, preferring in-stock variants so hero tiles represent distinct product lines
  const byTitle = new Map<string, P>()
  for (const prod of pool) {
    const baseKey = String(prod.cleanTitle || prod.name || prod.sku)
      .split('— Phân loại:')[0]
      .trim()
      .toLowerCase()
    const existing = byTitle.get(baseKey)
    if (!existing || (!existing.inStock && Boolean(prod.inStock))) {
      byTitle.set(baseKey, prod)
    }
  }

  const distinct = Array.from(byTitle.values())
  const selected: P[] = []
  const pickedIds = new Set<string>()

  const familyChecks: Array<(prefix: string) => boolean> = [
    (prefix) => prefix.startsWith('hũ ') || prefix.startsWith('cốc '),
    (prefix) =>
      prefix.startsWith('nến ') ||
      prefix.includes('nến bơ') ||
      prefix.includes('tealight'),
    (prefix) =>
      prefix.startsWith('khay ') ||
      prefix.startsWith('đế nến') ||
      prefix.startsWith('chân nến'),
  ]

  for (const matchesFamily of familyChecks) {
    if (selected.length >= limit) break
    const hit = distinct.find((p) => {
      if (pickedIds.has(p.id)) return false
      const lead = String(p.cleanTitle || p.name || '')
        .trim()
        .slice(0, 32)
        .toLowerCase()
      return matchesFamily(lead)
    })
    if (hit) {
      selected.push(hit)
      pickedIds.add(hit.id)
    }
  }

  for (const prod of distinct) {
    if (selected.length >= limit) break
    if (!pickedIds.has(prod.id)) {
      selected.push(prod)
      pickedIds.add(prod.id)
    }
  }

  for (const prod of pool) {
    if (selected.length >= limit) break
    if (!pickedIds.has(prod.id)) {
      selected.push(prod)
      pickedIds.add(prod.id)
    }
  }

  return selected
}

