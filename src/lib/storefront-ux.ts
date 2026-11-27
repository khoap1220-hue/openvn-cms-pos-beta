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

  const highlight3 = ctx.isStorefrontClosed
    ? 'Hỗ trợ tra cứu đơn & CSKH trực tuyến'
    : ctx.isWholesaleAllowed
      ? `Sỉ gộp mẫu tự do từ ${Math.max(1, Math.floor(ctx.minWholesaleQty || 10))} SP`
      : `Freeship đơn từ ${ctx.freeShipFormatted}`

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
        ? `Miễn phí vận chuyển toàn quốc đơn từ ${ctx.freeShipFormatted} · Kiểm hàng & đổi mới miễn phí trong ${returnDays} ngày`
        : `Miễn phí vận chuyển toàn quốc đơn từ ${ctx.freeShipFormatted} · Đồng kiểm sản phẩm trước khi thanh toán`
  } else if (!effectiveAnnouncementBar) {
    effectiveAnnouncementBar = `Miễn phí vận chuyển toàn quốc đơn từ ${ctx.freeShipFormatted} · Chiết khấu Giá Sỉ từ ${Math.max(1, Math.floor(ctx.minWholesaleQty || 10))} sản phẩm`
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

