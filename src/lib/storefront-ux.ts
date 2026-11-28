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

export function formatHeroShortProductLabel(
  cleanTitleOrName?: string | null,
  maxChars = 26
): string {
  const limit = Math.max(12, Math.min(48, Math.floor(Number(maxChars) || 26)))
  const raw = String(cleanTitleOrName || '')
    .split('— Phân loại:')[0]
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
  if (!raw) return 'Sản phẩm tiêu biểu'
  const firstSegment = raw.split(/\s+[-–—|/]\s+|:\s+/)[0]?.trim() || raw
  const base = firstSegment.length >= 6 ? firstSegment : raw
  if (base.length <= limit) return base

  const stopAttrPattern =
    /^(có|không|trắng|kem|xanh|đen|vàng|cam|be|đựng|cúng|lót|cắm|đặt|xi|dùng|phối)$/i
  const danglingTailPattern =
    /^(nắp|thạch|xi|màu|size|cỡ|dùng|đựng|cho|kèm|và|với|tặng|loại|mẫu|bộ|set)$/i
  const words = base.split(/\s+/).filter(Boolean)
  const kept: string[] = []

  for (const w of words) {
    const cleanWord = w.replace(/[,.;:!?]+$/g, '')
    if (!cleanWord) continue
    const currentLen = kept.join(' ').length
    if (currentLen >= 14 && stopAttrPattern.test(cleanWord)) {
      break
    }
    const nextLen = currentLen === 0 ? cleanWord.length : currentLen + 1 + cleanWord.length
    if (kept.length >= 2 && nextLen > limit) {
      break
    }
    kept.push(cleanWord)
    if (nextLen >= limit) break
  }

  while (kept.length > 2 && danglingTailPattern.test(kept[kept.length - 1])) {
    kept.pop()
  }

  if (kept.length >= 2) {
    return kept.join(' ')
  }
  return base.slice(0, limit).trim()
}

export function formatWholesaleTiersSummary(
  tiers?: Array<{ minQty: number; discountPercent: number; badge?: string }> | null,
  oemCustomNote?: boolean | string | null
): string {
  const oemText = typeof oemCustomNote === 'string' ? oemCustomNote.trim() : ''
  const hasOem = typeof oemCustomNote === 'boolean' ? oemCustomNote : oemText.length > 0
  const mentionsGiftBoxOem =
    typeof oemCustomNote === 'boolean'
      ? oemCustomNote
      : /hộp quà|khắc|in logo|oem/i.test(oemText)
  const oemSuffix = !hasOem
    ? '.'
    : mentionsGiftBoxOem
      ? ' + Khắc/in hộp quà OEM.'
      : ' + Hỗ trợ gia công theo yêu cầu.'

  if (!Array.isArray(tiers) || tiers.length === 0) {
    return hasOem
      ? `Chiết khấu trực tiếp theo mốc số lượng sỉ${oemSuffix}`
      : 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ.'
  }
  const sorted = [...tiers]
    .filter((t) => Number(t?.minQty) > 0 && Number(t?.discountPercent) > 0)
    .sort((a, b) => a.minQty - b.minQty)
    .slice(0, 4)
  if (sorted.length === 0) {
    return 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ.'
  }
  const parts = sorted.map(
    (t) => `Từ ${Math.floor(t.minQty)} SP giảm ${Math.round(t.discountPercent * 10) / 10}%`
  )
  return `${parts.join(' · ')}${oemSuffix}`
}

export interface StorefrontHeroCopyContext {
  brandName?: string | null
  workshopName?: string | null
  customDomain?: string | null
  heroBadge?: string | null
  heroTitle?: string | null
  heroSubtitle?: string | null
  announcementBar?: string | null
  returnDays?: number | null
  freeShipFormatted: string
  minWholesaleQty: number
  isWholesaleAllowed: boolean
  isStorefrontClosed?: boolean
  totalProductsCount?: number
  sampleTexts?: string[]
}

export interface ResolvedStorefrontHeroCopy {
  isCandlePlasterAtelier: boolean
  effectiveAnnouncementBar: string
  highlight1: string
  highlight2: string
  highlight3: string
  showcaseHeading: string
  showcaseActionLabel: string
  craftIcon: 'FLAME' | 'SPARKLES'
  craftPromiseTitle: string
  craftPromiseDesc: string
  wsPromiseTitle: string
  safePromiseTitle: string
  safePromiseDesc: string
}

const DEFAULT_BOMOC_ANNOUNCEMENT_PREFIX = 'Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000'

export function resolveStorefrontHeroCopy(
  ctx: StorefrontHeroCopyContext
): ResolvedStorefrontHeroCopy {
  const dom = String(ctx.customDomain || '').trim().toLowerCase()
  const corpus = [
    ctx.brandName || '',
    ctx.heroBadge || '',
    ctx.heroTitle || '',
    ctx.heroSubtitle || '',
    ...(ctx.sampleTexts || []).slice(0, 6),
  ]
    .join(' ')
    .toLowerCase()

  const isCandlePlasterAtelier =
    dom.startsWith('bomoc') ||
    /nến\s*bơ|sáp\s*bơ|thạch\s*cao|bơ\s*mộc|tealight/i.test(corpus)

  const returnDays =
    typeof ctx.returnDays === 'number' && Number.isFinite(ctx.returnDays)
      ? Math.max(0, Math.floor(ctx.returnDays))
      : 7
  const brandClean = String(ctx.brandName || 'Cửa hàng Chính hãng').trim() || 'Cửa hàng Chính hãng'
  const rawWorkshop = String(ctx.workshopName || '').trim()
  const hasCustomWorkshop =
    Boolean(rawWorkshop) &&
    !/xưởng đúc thủ công|bơ mộc/i.test(rawWorkshop) &&
    rawWorkshop.toLowerCase() !== brandClean.toLowerCase()

  const freeShipFmt = String(ctx.freeShipFormatted || '').trim()
  const isZeroFreeShip = /^0(?:\D+)?$/.test(freeShipFmt)
  const isDefault500kFreeShip = /^500[.,]000(?:\D+)?$/.test(freeShipFmt)
  const freeShipPhrase = isZeroFreeShip
    ? 'Miễn phí vận chuyển toàn quốc mọi đơn hàng'
    : `Miễn phí vận chuyển toàn quốc đơn từ ${freeShipFmt}`

  const highlight3 = ctx.isStorefrontClosed
    ? 'Hỗ trợ tra cứu đơn & CSKH trực tuyến'
    : ctx.isWholesaleAllowed
      ? `Sỉ gộp mẫu tự do từ ${Math.max(1, Math.floor(ctx.minWholesaleQty || 10))} SP`
      : isZeroFreeShip
        ? 'Miễn phí vận chuyển mọi đơn'
        : `Freeship đơn từ ${freeShipFmt}`

  const rawAnnounce = String(ctx.announcementBar || '').trim()
  const isDefaultWsAnnounce =
    !rawAnnounce ||
    (rawAnnounce.startsWith(DEFAULT_BOMOC_ANNOUNCEMENT_PREFIX) &&
      rawAnnounce.includes('Chiết khấu Giá Sỉ'))

  let effectiveAnnouncementBar = rawAnnounce
  if (ctx.isStorefrontClosed && isDefaultWsAnnounce) {
    effectiveAnnouncementBar = `Thông báo: ${brandClean} hiện tạm ngưng nhận đơn trực tuyến để cập nhật danh mục · Hỗ trợ tra cứu đơn đã đặt & tư vấn trực tiếp.`
  } else if (!ctx.isWholesaleAllowed && isDefaultWsAnnounce) {
    effectiveAnnouncementBar =
      returnDays > 0
        ? `${freeShipPhrase} · Kiểm hàng & đổi mới miễn phí trong ${returnDays} ngày`
        : `${freeShipPhrase} · Đồng kiểm sản phẩm trước khi thanh toán`
  } else if (!effectiveAnnouncementBar || (isDefaultWsAnnounce && !isDefault500kFreeShip)) {
    effectiveAnnouncementBar = `${freeShipPhrase} · Chiết khấu Giá Sỉ từ ${Math.max(1, Math.floor(ctx.minWholesaleQty || 10))} sản phẩm`
  }

  const totalCount = Math.max(0, Math.floor(Number(ctx.totalProductsCount) || 0))

  if (isCandlePlasterAtelier) {
    return {
      isCandlePlasterAtelier: true,
      effectiveAnnouncementBar,
      highlight1: '100% Sáp bơ thực vật không khói',
      highlight2: 'Cốt thạch cao khoáng kháng dầu',
      highlight3,
      showcaseHeading: 'Tác phẩm tiêu biểu tại xưởng',
      showcaseActionLabel: `Xem trọn bộ ${totalCount} mẫu →`,
      craftIcon: 'FLAME',
      craftPromiseTitle: 'Đúc Thủ Công & Sáp Bơ Thực Vật Thuần Chay',
      craftPromiseDesc:
        'Không khói đen, an toàn cho phòng thiền, bàn trà, spa; bề mặt thạch cao kháng dầu mịn đẹp.',
      wsPromiseTitle: ctx.isWholesaleAllowed
        ? 'Chiết Khấu Giá Sỉ Tận Xưởng (Gộp Mẫu Tự Do)'
        : 'Ưu Đãi Vận Chuyển Toàn Quốc',
      safePromiseTitle:
        returnDays > 0
          ? 'Đóng Gói Chống Sốc — Bảo Hành Bể Vỡ 1 Đổi 1'
          : 'Đóng Gói Chống Sốc Nhiều Lớp Chuyên Dụng',
      safePromiseDesc:
        returnDays > 0
          ? `Xốp định hình nhiều lớp chuyên dụng, kiểm hàng và đổi mới miễn phí trong ${returnDays} ngày.`
          : 'Xốp định hình nhiều lớp chuyên dụng, hỗ trợ kiểm tra sản phẩm ngay khi nhận hàng.',
    }
  }

  return {
    isCandlePlasterAtelier: false,
    effectiveAnnouncementBar,
    highlight1: 'Sản phẩm chính hãng tuyển chọn',
    highlight2:
      returnDays > 0
        ? `Đồng kiểm & đổi trả trong ${returnDays} ngày`
        : 'Đồng kiểm hàng trước khi nhận',
    highlight3,
    showcaseHeading: 'Sản phẩm tiêu biểu',
    showcaseActionLabel: `Xem tất cả ${totalCount} SP →`,
    craftIcon: 'SPARKLES',
    craftPromiseTitle: hasCustomWorkshop
      ? `${rawWorkshop} — Cam Kết Chất Lượng`
      : `${brandClean} — Tuyển Chọn Chính Hãng`,
    craftPromiseDesc:
      'Kiểm định chất lượng kỹ lưỡng từng sản phẩm trước khi xuất kho, hình ảnh và thông số minh bạch.',
    wsPromiseTitle: ctx.isWholesaleAllowed
      ? 'Chính Sách Chiết Khấu Sỉ Linh Hoạt (Gộp Mẫu)'
      : 'Ưu Đãi Vận Chuyển Toàn Quốc',
    safePromiseTitle:
      returnDays > 0
        ? `Đóng Gói Chuẩn — Đổi Trả Trong ${returnDays} Ngày`
        : 'Đóng Gói An Toàn — Đồng Kiểm Khi Nhận',
    safePromiseDesc:
      returnDays > 0
        ? `Đóng gói tiêu chuẩn giao toàn quốc, kiểm hàng khi nhận và hỗ trợ đổi mới trong ${returnDays} ngày.`
        : 'Đóng gói tiêu chuẩn giao toàn quốc, quý khách được kiểm tra sản phẩm trước khi thanh toán.',
  }
}

export interface HeroPrimaryStageResult<P> {
  hasStageImage: boolean
  imageUrl: string
  mobileImageUrl: string
  alt: string
  isProductFallback: boolean
  stageProduct: P | null
  stripProducts: P[]
}

export function resolveHeroPrimaryStage<
  P extends {
    id: string
    name: string
    cleanTitle?: string | null
    image?: string | null
    retailPrice?: number
  },
>(options: {
  isStorefrontClosed: boolean
  showShopeeBanners: boolean
  brandName: string
  coverBannerUrl?: string | null
  mobileCoverBannerUrl?: string | null
  firstCarouselBanner?: {
    imageUrl?: string | null
    mobileImageUrl?: string | null
    title?: string | null
  } | null
  showcaseProducts: P[]
}): HeroPrimaryStageResult<P> {
  if (options.isStorefrontClosed) {
    return {
      hasStageImage: false,
      imageUrl: '',
      mobileImageUrl: '',
      alt: '',
      isProductFallback: false,
      stageProduct: null,
      stripProducts: [],
    }
  }

  const coverUrl = options.showShopeeBanners ? String(options.coverBannerUrl || '').trim() : ''
  if (coverUrl) {
    return {
      hasStageImage: true,
      imageUrl: coverUrl,
      mobileImageUrl: String(options.mobileCoverBannerUrl || '').trim(),
      alt: `${options.brandName} — Không gian trưng bày chính thức`,
      isProductFallback: false,
      stageProduct: null,
      stripProducts: options.showcaseProducts,
    }
  }

  const carouselUrl = options.showShopeeBanners
    ? String(options.firstCarouselBanner?.imageUrl || '').trim()
    : ''
  if (carouselUrl) {
    return {
      hasStageImage: true,
      imageUrl: carouselUrl,
      mobileImageUrl: String(options.firstCarouselBanner?.mobileImageUrl || '').trim(),
      alt: options.firstCarouselBanner?.title || `${options.brandName} — Bộ sưu tập nổi bật`,
      isProductFallback: false,
      stageProduct: null,
      stripProducts: options.showcaseProducts,
    }
  }

  const leadProd = options.showcaseProducts[0] ?? null
  const leadImg = leadProd && typeof leadProd.image === 'string' ? leadProd.image.trim() : ''
  if (leadProd && leadImg) {
    return {
      hasStageImage: true,
      imageUrl: leadImg,
      mobileImageUrl: '',
      alt: leadProd.cleanTitle || leadProd.name,
      isProductFallback: true,
      stageProduct: leadProd,
      // When only 1 product exists and it already occupies the primary stage with caption, omit duplicate 1-tile strip
      stripProducts: options.showcaseProducts.length >= 2 ? options.showcaseProducts : [],
    }
  }

  return {
    hasStageImage: false,
    imageUrl: '',
    mobileImageUrl: '',
    alt: '',
    isProductFallback: false,
    stageProduct: null,
    stripProducts: options.showcaseProducts,
  }
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

const PLACEHOLDER_PHONE_DIGITS = new Set(['0909686868', '84909686868'])
const PLACEHOLDER_EMAILS = new Set(['lienhe@bomocdecor.vn', 'lienhe@uudam.vn'])

export function isPlaceholderStorefrontPhone(raw?: string | null): boolean {
  const digits = String(raw || '').replace(/\D/g, '')
  if (!digits) return false
  return PLACEHOLDER_PHONE_DIGITS.has(digits)
}

export function isPlaceholderStorefrontEmail(raw?: string | null): boolean {
  const lower = String(raw || '').trim().toLowerCase()
  if (!lower) return false
  return PLACEHOLDER_EMAILS.has(lower)
}

/**
 * Chuẩn hóa tên thương hiệu hiển thị cho khách hàng trên Storefront / Blog công khai:
 * - Gỡ tiền tố hệ thống `OPENVN · ` và hậu tố quản trị nội bộ (`· Showroom`, `· POS`, `· CMS`, `· Admin`)
 * - Tự động giữ nguyên 100% tính độc lập của từng CMS khác nhau.
 */
export function formatCustomerStorefrontBrandName(
  rawBrandName?: string | null,
  customDomain?: string | null
): string {
  const dom = String(customDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  let raw = String(rawBrandName || '').trim()

  if (!raw || raw.toUpperCase() === 'OPENVN') {
    if (dom.startsWith('bomoc')) return 'Bơ Mộc Decor'
    return 'Cửa Hàng Trực Tuyến'
  }

  if (/^OPENVN\s*[·•|-]\s*/i.test(raw)) {
    if (dom.startsWith('bomoc')) return 'Bơ Mộc Decor'
    raw = raw.replace(/^OPENVN\s*[·•|-]\s*/i, '').trim()
  }

  const strippedSuffix = raw
    .replace(/\s*[·•|-]\s*(Showroom|POS|CMS|Admin|Quản\s*trị|Hệ\s*thống)\s*$/i, '')
    .trim()

  const cleaned = strippedSuffix || raw
  if (
    cleaned.toLowerCase() === 'bơ mộc' &&
    dom.includes('bomocdecor')
  ) {
    return 'Bơ Mộc Decor'
  }
  return cleaned
}

/**
 * Chọn dòng phụ ngắn gọn dưới Logo Header sao cho không lộ nhãn nội bộ POS
 * và không lặp nguyên văn câu khẩu hiệu ở `.hero-badge` ngay bên dưới.
 */
export function resolveCustomerHeaderSubtitle(options: {
  brandSubtitle?: string | null
  workshopName?: string | null
  heroBadge?: string | null
  brandName?: string | null
}): string {
  const sub = String(options.brandSubtitle || '').trim()
  const badge = String(options.heroBadge || '').trim()
  const workshop = String(options.workshopName || '').trim()
  const brand = String(options.brandName || '').trim()

  const isInternalSub =
    !sub ||
    /quản lý bán hàng|agent autopilot|offline-first|pos/i.test(sub)

  if (!isInternalSub && sub.toLowerCase() !== badge.toLowerCase()) {
    return sub
  }
  if (
    workshop &&
    !/quản lý bán hàng/i.test(workshop) &&
    workshop.toLowerCase() !== badge.toLowerCase() &&
    workshop.toLowerCase() !== brand.toLowerCase()
  ) {
    return workshop
  }
  return 'Cửa hàng trực tuyến chính thức'
}

const COLOR_PHRASE_PART =
  '(?:Trắng(?:\\s+Mộc)?|Kem(?:\\s+Bơ)?|Vàng(?:\\s+Bơ)?|Cam(?:\\s+Đất)?|Xanh(?:\\s+Sage|\\s+Rêu|\\s+Ngọc)?|Đen|Be|Nâu(?:\\s+Đất)?|Xám|Hồng(?:\\s+Phấn)?)'
const MULTI_COLOR_LIST_RE = new RegExp(
  `\\s+${COLOR_PHRASE_PART}(?:\\s*[,/]\\s*${COLOR_PHRASE_PART})+`,
  'gi'
)

/**
 * Làm sạch tiêu đề hiển thị trên thẻ sản phẩm Storefront:
 * - Cắt đuôi nhồi từ khóa SEO sàn TMĐT (` - Decor ... - Bơ Mộc`)
 * - Gỡ danh sách nhiều màu hoặc tên màu mâu thuẫn (`Trắng Mộc` trên thẻ `Kem bơ` / `Xanh sage`)
 *   khi sản phẩm đã có `variantLabel` riêng, nhưng vẫn giữ đầy đủ `name` gốc để tìm kiếm.
 */
export function formatStorefrontDisplayTitle(
  rawNameOrCleanTitle: string,
  variantLabel?: string | null
): string {
  let base = String(rawNameOrCleanTitle || '')
    .split('— Phân loại:')[0]
    .trim()
  if (!base) return ''

  const vLabel = String(variantLabel || '').trim()
  const hasVariant = vLabel.length > 0

  if (hasVariant) {
    base = base.replace(/\s*\((?:Hộp|Set|Bộ|Combo)\s+\d+\s*[-–/]\s*\d+[^)]*\)\s*$/i, '').trim()
  }
  base = base.replace(/\s*\(Tặng\s+Kèm[^)]*\)/gi, '').trim()

  const dashParts = base.split(/\s+[-–|]\s+/)
  if (dashParts[0] && dashParts[0].trim().length >= 8) {
    base = dashParts[0].trim()
  }

  if (hasVariant) {
    const colonIdx = base.indexOf(':')
    if (colonIdx >= 10) {
      base = base.slice(0, colonIdx).trim()
    }
    base = base.replace(MULTI_COLOR_LIST_RE, '').replace(/\s{2,}/g, ' ').trim()
    const isShapeOnlyVariant = /hoa\s*sen|chum|trái\s*tim|\bcm\b/i.test(vLabel)
    if (!isShapeOnlyVariant) {
      base = base.replace(/\s+\bTrắng\s+Mộc\b/gi, '').replace(/\s{2,}/g, ' ').trim()
    }
  }

  if (base.length > 34) {
    const trimmedSeo = base
      .replace(
        /\s*(?:,\s*)?(?:Chịu\s+Nhiệt|Kháng\s+Dầu|Đế\s+Lót|Đựng\s+(?:Nến|Đồ|Trang\s+Sức|Phụ\s+Kiện|Nụ)|Đổ\s+Nến(?:\s+Thơm|\s+Bơ)?|Lót\s+Nến|Cắm\s+Bút|Cúng\s+Phật)(?:\s|$|[,.-]).*$/i,
        ''
      )
      .trim()
    if (trimmedSeo.length >= 14) {
      base = trimmedSeo
    }
  }

  return base.replace(/[,.;:]+$/, '').trim()
}

function extractShopeeProductKey(shopeeUrl?: string | null): string {
  const raw = String(shopeeUrl || '').trim()
  const m = raw.match(/\/product\/(\d+\/\d+)/)
  return m?.[1] || ''
}

export interface ProductPhysicalMeta {
  shopeeItemId: string | null
  parentSku: string | null
  tierVariationName: string | null
  weightGram: number | null
  dimensionsLabel: string | null
  daysToShip: number | null
}

function parseRawAttributesObject(
  rawAttributes?: string | Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!rawAttributes) return null
  if (typeof rawAttributes === 'object') return rawAttributes
  if (typeof rawAttributes === 'string') {
    try {
      const parsed = JSON.parse(rawAttributes) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
  }
  return null
}

/**
 * Hợp nhất & khử trùng lặp bộ sưu tập ảnh sản phẩm từ `Product.image` và `Product.attributes`
 * (`variantImage`, `gallery`, `images`, `coverImage`). Luôn đặt ảnh biến thể hiện tại lên đầu tiên.
 */
export function extractProductGalleryImages(
  primaryImage?: string | null,
  rawAttributes?: string | Record<string, unknown> | null,
  maxImages = 8
): string[] {
  const limit = Math.max(1, Math.min(12, Math.floor(Number(maxImages) || 8)))
  const attr = parseRawAttributesObject(rawAttributes)
  const rawCandidates: unknown[] = [primaryImage]

  if (attr) {
    rawCandidates.push(attr.variantImage)
    if (Array.isArray(attr.gallery)) rawCandidates.push(...attr.gallery)
    if (Array.isArray(attr.images)) rawCandidates.push(...attr.images)
    rawCandidates.push(attr.coverImage)
    rawCandidates.push(attr.lastSyncedShopeeImage)
  }

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of rawCandidates) {
    if (typeof item !== 'string') continue
    const clean = item.trim()
    if (!clean || (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('/'))) {
      continue
    }
    if (seen.has(clean)) continue
    seen.add(clean)
    result.push(clean)
    if (result.length >= limit) break
  }
  return result
}

/**
 * Trích xuất siêu dữ liệu vật lý & phân nhóm biến thể an toàn (0 lộ giá vốn / secret).
 */
export function extractProductPhysicalMeta(
  rawAttributes?: string | Record<string, unknown> | null
): ProductPhysicalMeta {
  const attr = parseRawAttributesObject(rawAttributes)
  if (!attr) {
    return {
      shopeeItemId: null,
      parentSku: null,
      tierVariationName: null,
      weightGram: null,
      dimensionsLabel: null,
      daysToShip: null,
    }
  }

  const shopeeItemId = attr.shopeeItemId ? String(attr.shopeeItemId).trim() || null : null
  const parentSku = attr.parentSku ? String(attr.parentSku).trim() || null : null
  const tierVariationName = attr.tierVariationName
    ? String(attr.tierVariationName).trim() || null
    : null

  const rawWeight = Number(attr.weightGram)
  const weightGram =
    Number.isFinite(rawWeight) && rawWeight > 0 ? Math.round(rawWeight) : null

  let dimensionsLabel: string | null = null
  if (attr.dimensionCm && typeof attr.dimensionCm === 'object') {
    const dim = attr.dimensionCm as Record<string, unknown>
    const l = Number(dim.length)
    const w = Number(dim.width)
    const h = Number(dim.height)
    if (l > 0 && w > 0 && h > 0) {
      dimensionsLabel = `${l} × ${w} × ${h} cm`
    }
  }

  let daysToShip: number | null = null
  if (attr.preOrderInfo && typeof attr.preOrderInfo === 'object') {
    const d = Number((attr.preOrderInfo as Record<string, unknown>).days_to_ship)
    if (Number.isFinite(d) && d > 0 && d <= 30) {
      daysToShip = Math.round(d)
    }
  }

  return {
    shopeeItemId,
    parentSku,
    tierVariationName,
    weightGram,
    dimensionsLabel,
    daysToShip,
  }
}

export type ProductDetailTabKey = 'OVERVIEW' | 'SPECS' | 'CARE'

export interface ParsedDescriptionBullet {
  label: string | null
  text: string
}

export interface ParsedDescriptionSection {
  title: string
  tab: ProductDetailTabKey
  bullets: ParsedDescriptionBullet[]
  paragraphs: string[]
}

export interface ProductQuickSpecItem {
  label: string
  value: string
}

export interface ParsedProductDescription {
  leadParagraphs: string[]
  sections: ParsedDescriptionSection[]
  quickSpecs: ProductQuickSpecItem[]
  cleanPlainText: string
}

const HASHTAG_ONLY_LINE_RE = /^#[A-Za-z0-9_\u00C0-\u024F]+(?:\s+#[A-Za-z0-9_\u00C0-\u024F]+)*$/
const BULLET_PREFIX_RE = /^(?:[-•*▪▫◦+])\s+/
const NUMBERED_HEADING_RE = /^\d+\s*[.)]\s*(.+)$/

function normalizeSectionHeadingTitle(rawHeading: string): string {
  let clean = rawHeading
    .replace(NUMBERED_HEADING_RE, '$1')
    .replace(/:+\s*$/, '')
    .replace(/\s+trên\s+shopee\b/gi, '')
    .replace(/\s*\(tham\s+khảo\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (!clean) return 'Thông tin chi tiết'

  const letters = clean.replace(/[^A-Za-z\u00C0-\u1EF9]/g, '')
  const upperLetters = letters.replace(/[^A-Z\u00C0-\u00DE\u0102\u0110\u0128\u0168\u01A0\u01AF]/g, '')
  const isAllCaps =
    letters.length >= 4 &&
    (clean === clean.toUpperCase() || upperLetters.length / letters.length > 0.75)

  if (isAllCaps) {
    const lower = clean.toLowerCase()
    clean = lower.charAt(0).toUpperCase() + lower.slice(1)
    clean = clean
      .replace(/\bshopee\b/gi, 'Shopee')
      .replace(/\btealight\b/gi, 'Tealight')
      .replace(/\bwabi-sabi\b/gi, 'Wabi-Sabi')
      .replace(/\boem\b/gi, 'OEM')
  }
  return clean
}

function classifyDescriptionSectionTab(title: string): ProductDetailTabKey {
  const lower = title.toLowerCase()
  if (/thông\s*số|kích\s*thước|chất\s*liệu|quy\s*cách|trọng\s*lượng|phân\s*loại\s*màu|phân\s*loại\s*mẫu/.test(lower)) {
    return 'SPECS'
  }
  if (/hướng\s*dẫn|bảo\s*quản|đóng\s*gói|lưu\s*ý|hỗ\s*trợ|vận\s*chuyển/.test(lower)) {
    return 'CARE'
  }
  return 'OVERVIEW'
}

function splitBulletLabelAndValue(rawBullet: string): ParsedDescriptionBullet {
  const body = rawBullet.replace(BULLET_PREFIX_RE, '').trim()
  const colonIdx = body.indexOf(':')
  if (colonIdx >= 3 && colonIdx <= 46) {
    const label = body.slice(0, colonIdx).trim()
    const rest = body.slice(colonIdx + 1).trim()
    if (label && rest && !/[.!?]/.test(label)) {
      return { label, text: rest }
    }
  }
  return { label: null, text: body }
}

/**
 * Chuyển đổi mô tả sản phẩm dài (`1,800–2,300` ký tự) thành cấu trúc Editorial rõ ràng:
 * - Gỡ sạch dòng `#hashtag` SEO cuối bài và cụm `"TRÊN SHOPEE"`
 * - Chia thành `leadParagraphs` + `sections` gắn nhãn tab (`OVERVIEW` | `SPECS` | `CARE`)
 * - Tự động rút trích `quickSpecs` (Kích thước, Lòng hũ, Trọng lượng, Chất liệu...) để khách đọc lướt trong 2 giây.
 */
export function parseStorefrontProductDescription(
  rawDescription?: string | null,
  fallbackMeta?: {
    weightGram?: number | null
    dimensionsLabel?: string | null
    fragile?: boolean
    unit?: string | null
  }
): ParsedProductDescription {
  const rawLines = String(rawDescription || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/g, '').trim())

  const filteredLines = rawLines.filter((line) => !HASHTAG_ONLY_LINE_RE.test(line))
  const cleanPlainText = filteredLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const leadParagraphs: string[] = []
  const sections: ParsedDescriptionSection[] = []
  let currentSection: ParsedDescriptionSection | null = null

  const nonEmptyLines = filteredLines.filter((l) => l.length > 0)
  for (let i = 0; i < nonEmptyLines.length; i += 1) {
    const line = nonEmptyLines[i]
    const nextLine = nonEmptyLines[i + 1] || ''
    const isBullet = BULLET_PREFIX_RE.test(line)
    const isNumberedHeading =
      !isBullet && NUMBERED_HEADING_RE.test(line) && line.length <= 84
    const isUnnumberedHeading =
      !isBullet &&
      line.length >= 6 &&
      line.length <= 68 &&
      !/[.!?]$/.test(line) &&
      (line.endsWith(':') || BULLET_PREFIX_RE.test(nextLine))

    if (isNumberedHeading || isUnnumberedHeading) {
      const normalizedTitle = normalizeSectionHeadingTitle(line)
      currentSection = {
        title: normalizedTitle,
        tab: classifyDescriptionSectionTab(normalizedTitle),
        bullets: [],
        paragraphs: [],
      }
      sections.push(currentSection)
      continue
    }

    if (isBullet) {
      if (!currentSection) {
        currentSection = {
          title: 'Điểm nổi bật',
          tab: 'OVERVIEW',
          bullets: [],
          paragraphs: [],
        }
        sections.push(currentSection)
      }
      currentSection.bullets.push(splitBulletLabelAndValue(line))
      continue
    }

    const strippedInlineTags = line.replace(/(?:\s+#[A-Za-z0-9_\u00C0-\u024F]+){2,}\s*$/, '').trim()
    if (!strippedInlineTags) continue

    if (!currentSection) {
      leadParagraphs.push(strippedInlineTags)
    } else {
      currentSection.paragraphs.push(strippedInlineTags)
    }
  }

  const quickSpecs: ProductQuickSpecItem[] = []
  const pushSpec = (label: string, value: string) => {
    const cleanLbl = label.trim()
    const cleanVal = value.trim().replace(/\.$/, '')
    if (!cleanLbl || !cleanVal || quickSpecs.length >= 4) return
    if (quickSpecs.some((s) => s.label.toLowerCase() === cleanLbl.toLowerCase())) return
    quickSpecs.push({ label: cleanLbl, value: cleanVal.slice(0, 95) })
  }

  for (const sec of sections) {
    if (sec.tab !== 'SPECS') continue
    for (const b of sec.bullets) {
      if (!b.label) continue
      const low = b.label.toLowerCase()
      if (/phân\s*loại|^hộp\s+\d+|^mẫu\s+|^combo\s+|^set\s+/.test(low)) continue
      if (b.text.length > 88) continue
      const shortLabel = b.label
        .replace(/^Kích thước phủ bì$/i, 'Kích thước phủ bì')
        .replace(/^Kích thước lòng (?:hũ|khay)$/i, 'Lòng trong')
        .replace(/^Trọng lượng vỏ hũ cả nắp$/i, 'Trọng lượng tịnh')
      pushSpec(shortLabel, b.text)
    }
  }

  if (quickSpecs.length < 4 && fallbackMeta?.weightGram && fallbackMeta.weightGram > 0) {
    const hasWeight = quickSpecs.some((s) => /trọng\s*lượng|khối\s*lượng/i.test(s.label))
    if (!hasWeight) {
      pushSpec('Khối lượng đóng gói', `~${fallbackMeta.weightGram} gram`)
    }
  }
  if (quickSpecs.length < 4 && fallbackMeta?.dimensionsLabel) {
    const hasDim = quickSpecs.some((s) => /kích\s*thước|đường\s*kính|lòng/i.test(s.label))
    if (!hasDim) {
      pushSpec('Quy cách hộp gửi', fallbackMeta.dimensionsLabel)
    }
  }
  if (quickSpecs.length < 4 && fallbackMeta?.fragile) {
    pushSpec('Đóng gói an toàn', 'Xốp chống sốc đa lớp · Bảo hành 1 đổi 1')
  }

  return {
    leadParagraphs,
    sections,
    quickSpecs,
    cleanPlainText,
  }
}

/**
 * Tìm danh sách các phân loại màu/quy cách cùng dòng sản phẩm để khách chuyển nhanh
 * trong hộp thoại Chi tiết sản phẩm:
 * - Ưu tiên khớp chính xác `parentSku` để chống gom nhầm khi 2 dòng sản phẩm khác nhau
 *   từng dùng chung `shopeeItemId` (ví dụ `BM-SEN-01` vs `BM-L08-DE-MINI`).
 * - Fallback an toàn về tên hiển thị đã chuẩn hóa khi sản phẩm chưa có `parentSku`.
 */
export function findSiblingVariantProducts<
  P extends {
    id: string
    sku: string
    name: string
    cleanTitle?: string | null
    variantLabel?: string | null
    shopeeUrl?: string | null
    parentSku?: string | null
  },
>(current: P, catalogProducts: P[]): P[] {
  if (!current || !Array.isArray(catalogProducts) || catalogProducts.length <= 1) {
    return []
  }
  const curParentSku = String(current.parentSku || '').trim().toUpperCase()
  const curShopeeKey = extractShopeeProductKey(current.shopeeUrl)
  const curDisplay = formatStorefrontDisplayTitle(
    current.cleanTitle || current.name,
    current.variantLabel
  ).toLowerCase()

  const siblings = catalogProducts.filter((item) => {
    if (!item.variantLabel && !current.variantLabel) return false
    const itemParentSku = String(item.parentSku || '').trim().toUpperCase()

    if (curParentSku && itemParentSku) {
      return curParentSku === itemParentSku
    }

    const itemDisplay = formatStorefrontDisplayTitle(
      item.cleanTitle || item.name,
      item.variantLabel
    ).toLowerCase()

    if (curDisplay && itemDisplay && curDisplay === itemDisplay) {
      return true
    }
    if (curShopeeKey && extractShopeeProductKey(item.shopeeUrl) === curShopeeKey) {
      return !curDisplay || !itemDisplay || curDisplay === itemDisplay
    }
    return false
  })

  return siblings.length >= 2 ? siblings : []
}

/**
 * Chọn danh sách sản phẩm gợi ý phối đồng bộ khác dòng (`3` mẫu đại diện từ các nhóm sản phẩm khác)
 * giúp khách lẻ dễ phối bộ decor và khách sỉ dễ gộp đủ mốc chiết khấu.
 */
export function selectRelatedStorefrontProducts<
  P extends {
    id: string
    sku: string
    name: string
    cleanTitle?: string | null
    variantLabel?: string | null
    parentSku?: string | null
    image?: string | null
    availableToOrder?: boolean
  },
>(current: P, catalogProducts: P[], maxItems = 3): P[] {
  const limit = Math.max(1, Math.min(6, Math.floor(Number(maxItems) || 3)))
  if (!current || !Array.isArray(catalogProducts) || catalogProducts.length <= 1) {
    return []
  }

  const curFamilyKey =
    String(current.parentSku || '').trim().toUpperCase() ||
    formatStorefrontDisplayTitle(current.cleanTitle || current.name, current.variantLabel)
      .trim()
      .toLowerCase()

  const seenFamilies = new Set<string>([curFamilyKey])
  const distinctCandidates: P[] = []

  for (const item of catalogProducts) {
    if (!item || item.id === current.id || item.availableToOrder === false) continue
    const familyKey =
      String(item.parentSku || '').trim().toUpperCase() ||
      formatStorefrontDisplayTitle(item.cleanTitle || item.name, item.variantLabel)
        .trim()
        .toLowerCase() ||
      item.id
    if (seenFamilies.has(familyKey)) continue
    seenFamilies.add(familyKey)
    distinctCandidates.push(item)
  }

  // Ưu tiên gợi ý chéo nhóm công năng (Nến bơ Tealight <-> Hũ/Chân nến <-> Khay lót)
  const curText = `${current.cleanTitle || ''} ${current.name || ''}`.toLowerCase()
  const isCandle = /nến\s*bơ|tealight/.test(curText)
  const isTray = /khay/.test(curText)

  const scoreCandidate = (cand: P): number => {
    const txt = `${cand.cleanTitle || ''} ${cand.name || ''}`.toLowerCase()
    let score = cand.image ? 10 : 0
    if (isCandle) {
      if (/chân\s*nến|đế\s*nến|hũ/.test(txt)) score += 6
      else if (/khay/.test(txt)) score += 4
    } else if (isTray) {
      if (/hũ|cốc/.test(txt)) score += 6
      else if (/nến\s*bơ|tealight/.test(txt)) score += 5
    } else {
      if (/nến\s*bơ|tealight/.test(txt)) score += 6
      else if (/khay/.test(txt)) score += 5
    }
    return score
  }

  return distinctCandidates
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, limit)
}



