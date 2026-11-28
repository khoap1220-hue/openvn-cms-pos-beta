// ============================================================================
// STOREFRONT BANNERS — Isomorphic Types, Sanitizer & Smart Collection Matcher
// Dùng chung an toàn cho cả Server (API / Prisma / Sync) & Client ('use client').
// ============================================================================

export interface StorefrontBannerHotspot {
  id: string
  x: number
  y: number
  w: number
  h: number
  shopeeProductId: string
  targetSku: string
  label: string
  linkUrl: string
}

export interface StorefrontCarouselBanner {
  id: string
  imageUrl: string
  mobileImageUrl: string
  title: string
  subtitle: string
  aspectRatio: number
  shopeeProductId: string
  targetSku: string
  filterKeyword: string
  linkUrl: string
}

export interface StorefrontSpotlightBanner {
  id: string
  imageUrl: string
  mobileImageUrl: string
  title: string
  aspectRatio: number
  hotspots: StorefrontBannerHotspot[]
}

export interface StorefrontCollectionBanner {
  id: string
  collectionId: string
  name: string
  imageUrl: string
  productCount: number
  filterKeyword: string
  shopeeUrl: string
}

export interface StorefrontBannersConfig {
  enabled: boolean
  shopLogoUrl: string
  coverBannerUrl: string
  mobileCoverBannerUrl: string
  carouselBanners: StorefrontCarouselBanner[]
  spotlightBanners: StorefrontSpotlightBanner[]
  collectionBanners: StorefrontCollectionBanner[]
  sourceShopId: string
  sourceShopUsername: string
  sourceDraftId: string
  syncedAt: string | null
}

export const DEFAULT_STOREFRONT_BANNERS: StorefrontBannersConfig = {
  enabled: true,
  shopLogoUrl: '',
  coverBannerUrl: '',
  mobileCoverBannerUrl: '',
  carouselBanners: [],
  spotlightBanners: [],
  collectionBanners: [],
  sourceShopId: '',
  sourceShopUsername: '',
  sourceDraftId: '',
  syncedAt: null,
}

const SHOPEE_FILE_HASH_RE = /^[a-z]{2}-\d{5,12}-[a-z0-9]{3,16}-[a-z0-9_-]{6,80}$/i

export function sanitizeSafeBannerUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim().slice(0, 400)
  if (!trimmed) return ''
  if (/[\s<>"'`\u0000-\u001f]/.test(trimmed)) return ''
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:') ||
    lower.startsWith('data:') ||
    lower.startsWith('vbscript:') ||
    lower.startsWith('file:')
  ) {
    return ''
  }
  if (SHOPEE_FILE_HASH_RE.test(trimmed)) {
    return `https://down-vn.img.susercontent.com/file/${trimmed}`
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed
  }
  if (lower.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed)
      if (parsed.protocol === 'https:') return parsed.toString()
    } catch {
      return ''
    }
  }
  return ''
}

function cleanText(raw: unknown, maxLen = 160): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, maxLen)
}

function roundPct(val: number): number {
  return Math.round(val * 100) / 100
}

export function sanitizeBannerHotspot(
  raw: unknown,
  fallbackIdx = 0
): StorefrontBannerHotspot | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const rawX = Number(rec.x)
  const rawY = Number(rec.y)
  const rawW = Number(rec.w)
  const rawH = Number(rec.h)
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
    return null
  }
  const x = roundPct(Math.min(99, Math.max(0, Number.isFinite(rawX) ? rawX : 0)))
  const y = roundPct(Math.min(99, Math.max(0, Number.isFinite(rawY) ? rawY : 0)))
  const w = roundPct(Math.min(100 - x, Math.max(1, rawW)))
  const h = roundPct(Math.min(100 - y, Math.max(1, rawH)))

  const shopeeProductId = cleanText(
    typeof rec.shopeeProductId === 'number' ? String(rec.shopeeProductId) : rec.shopeeProductId,
    40
  ).replace(/[^\d]/g, '')

  return {
    id: cleanText(rec.id, 48) || `hs_${fallbackIdx + 1}`,
    x,
    y,
    w,
    h,
    shopeeProductId,
    targetSku: cleanText(rec.targetSku, 64),
    label: cleanText(rec.label, 140),
    linkUrl: sanitizeSafeBannerUrl(rec.linkUrl),
  }
}

export function sanitizeStorefrontBanners(
  rawInput: unknown,
  fallback: StorefrontBannersConfig = DEFAULT_STOREFRONT_BANNERS
): StorefrontBannersConfig {
  if (!rawInput || typeof rawInput !== 'object' || Array.isArray(rawInput)) {
    return {
      ...fallback,
      carouselBanners: [...fallback.carouselBanners],
      spotlightBanners: fallback.spotlightBanners.map((s) => ({
        ...s,
        hotspots: [...s.hotspots],
      })),
      collectionBanners: [...fallback.collectionBanners],
    }
  }

  const raw = rawInput as Record<string, unknown>

  const carouselBanners: StorefrontCarouselBanner[] = []
  if (Array.isArray(raw.carouselBanners)) {
    for (let i = 0; i < Math.min(10, raw.carouselBanners.length); i++) {
      const item = raw.carouselBanners[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const imageUrl = sanitizeSafeBannerUrl(rec.imageUrl)
      if (!imageUrl) continue
      const mobileImageUrl = sanitizeSafeBannerUrl(rec.mobileImageUrl) || imageUrl
      const rawRatio = Number(rec.aspectRatio)
      const aspectRatio =
        Number.isFinite(rawRatio) && rawRatio >= 0.5 && rawRatio <= 5
          ? Math.round(rawRatio * 1000) / 1000
          : 2
      const shopeeProductId = cleanText(
        typeof rec.shopeeProductId === 'number'
          ? String(rec.shopeeProductId)
          : rec.shopeeProductId,
        40
      ).replace(/[^\d]/g, '')
      carouselBanners.push({
        id: cleanText(rec.id, 48) || `carousel_${i + 1}`,
        imageUrl,
        mobileImageUrl,
        title: cleanText(rec.title, 120),
        subtitle: cleanText(rec.subtitle, 160),
        aspectRatio,
        shopeeProductId,
        targetSku: cleanText(rec.targetSku, 64),
        filterKeyword: cleanText(rec.filterKeyword, 80),
        linkUrl: sanitizeSafeBannerUrl(rec.linkUrl),
      })
    }
  } else {
    carouselBanners.push(...fallback.carouselBanners)
  }

  const spotlightBanners: StorefrontSpotlightBanner[] = []
  if (Array.isArray(raw.spotlightBanners)) {
    for (let i = 0; i < Math.min(6, raw.spotlightBanners.length); i++) {
      const item = raw.spotlightBanners[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const imageUrl = sanitizeSafeBannerUrl(rec.imageUrl)
      if (!imageUrl) continue
      const mobileImageUrl = sanitizeSafeBannerUrl(rec.mobileImageUrl) || imageUrl
      const rawRatio = Number(rec.aspectRatio)
      const aspectRatio =
        Number.isFinite(rawRatio) && rawRatio >= 0.5 && rawRatio <= 5
          ? Math.round(rawRatio * 1000) / 1000
          : 1.796
      const hotspots: StorefrontBannerHotspot[] = []
      if (Array.isArray(rec.hotspots)) {
        for (let hIdx = 0; hIdx < Math.min(12, rec.hotspots.length); hIdx++) {
          const hs = sanitizeBannerHotspot(rec.hotspots[hIdx], hIdx)
          if (hs) hotspots.push(hs)
        }
      }
      spotlightBanners.push({
        id: cleanText(rec.id, 48) || `spotlight_${i + 1}`,
        imageUrl,
        mobileImageUrl,
        title: cleanText(rec.title, 120),
        aspectRatio,
        hotspots,
      })
    }
  } else {
    spotlightBanners.push(
      ...fallback.spotlightBanners.map((s) => ({ ...s, hotspots: [...s.hotspots] }))
    )
  }

  const collectionBanners: StorefrontCollectionBanner[] = []
  if (Array.isArray(raw.collectionBanners)) {
    for (let i = 0; i < Math.min(12, raw.collectionBanners.length); i++) {
      const item = raw.collectionBanners[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const imageUrl = sanitizeSafeBannerUrl(rec.imageUrl)
      const name = cleanText(rec.name, 80)
      if (!imageUrl || !name) continue
      const collectionId = cleanText(
        typeof rec.collectionId === 'number' ? String(rec.collectionId) : rec.collectionId,
        40
      )
      collectionBanners.push({
        id: cleanText(rec.id, 48) || `col_${collectionId || i + 1}`,
        collectionId,
        name,
        imageUrl,
        productCount: Math.max(0, Math.min(100_000, Math.floor(Number(rec.productCount) || 0))),
        filterKeyword: cleanText(rec.filterKeyword, 100),
        shopeeUrl: sanitizeSafeBannerUrl(rec.shopeeUrl),
      })
    }
  } else {
    collectionBanners.push(...fallback.collectionBanners)
  }

  const shopLogoUrl =
    raw.shopLogoUrl !== undefined
      ? sanitizeSafeBannerUrl(raw.shopLogoUrl)
      : fallback.shopLogoUrl
  const coverBannerUrl =
    raw.coverBannerUrl !== undefined
      ? sanitizeSafeBannerUrl(raw.coverBannerUrl)
      : fallback.coverBannerUrl
  const mobileCoverBannerUrl =
    raw.mobileCoverBannerUrl !== undefined
      ? sanitizeSafeBannerUrl(raw.mobileCoverBannerUrl) || coverBannerUrl
      : fallback.mobileCoverBannerUrl || coverBannerUrl

  return {
    enabled: raw.enabled === undefined ? fallback.enabled : Boolean(raw.enabled),
    shopLogoUrl,
    coverBannerUrl,
    mobileCoverBannerUrl,
    carouselBanners,
    spotlightBanners,
    collectionBanners,
    sourceShopId:
      raw.sourceShopId !== undefined
        ? cleanText(raw.sourceShopId, 40).replace(/[^\d]/g, '')
        : fallback.sourceShopId,
    sourceShopUsername:
      raw.sourceShopUsername !== undefined
        ? cleanText(raw.sourceShopUsername, 64)
        : fallback.sourceShopUsername,
    sourceDraftId:
      raw.sourceDraftId !== undefined
        ? cleanText(raw.sourceDraftId, 64)
        : fallback.sourceDraftId,
    syncedAt:
      raw.syncedAt === null
        ? null
        : typeof raw.syncedAt === 'string' && raw.syncedAt.trim()
          ? raw.syncedAt.trim().slice(0, 64)
          : fallback.syncedAt,
  }
}

export function hasAnySyncedShopeeBanners(banners?: StorefrontBannersConfig | null): boolean {
  if (!banners) return false
  return Boolean(
    banners.coverBannerUrl ||
      banners.carouselBanners.length > 0 ||
      banners.spotlightBanners.length > 0 ||
      banners.collectionBanners.length > 0
  )
}

export function matchesCollectionBannerProduct(
  product: {
    sku: string
    name: string
    cleanTitle?: string
    description?: string
  },
  collection: {
    name: string
    filterKeyword?: string
  }
): boolean {
  const cleanTitle = (product.cleanTitle || product.name || '')
    .split('— Phân loại:')[0]
    .trim()
    .toLowerCase()
  const skuLower = (product.sku || '').toLowerCase()
  const descLower = (product.description || '').toLowerCase()
  const colName = (collection.name || '').trim().toLowerCase()

  if (!colName && !collection.filterKeyword) return true

  // Phân biệt chính xác bộ sưu tập "Nến" thuần túy vs phụ kiện Đế Nến / Chân Nến / Hũ Đựng Nến
  if (colName === 'nến' || collection.filterKeyword === '__CANDLE_ONLY__') {
    return (
      cleanTitle === 'nến' ||
      cleanTitle.startsWith('nến ') ||
      skuLower.includes('-tea-') ||
      skuLower.startsWith('nen-')
    )
  }

  // Bộ sưu tập Nguyên Liệu DIY (chỉ khớp nguyên liệu thô/bột/khuôn/sáp rời, không khớp hũ/cốc thành phẩm có chữ "đổ nến")
  if (colName.includes('nguyên liệu') || colName.includes('diy')) {
    return (
      cleanTitle.includes('nguyên liệu') ||
      cleanTitle.includes('bột thạch cao') ||
      cleanTitle.includes('khuôn') ||
      cleanTitle.includes('diy') ||
      descLower.includes('bột thạch cao nguyên liệu') ||
      descLower.includes('khuôn silicone')
    )
  }

  const rawExpr = (collection.filterKeyword || collection.name || '').toLowerCase()
  const tokens = rawExpr
    .replace(/\bvà\b/g, '|')
    .split(/[|,;/+&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)

  if (tokens.length === 0) return true

  return tokens.some((tok) => {
    if (tok === 'đế nến' || tok === 'chân nến') {
      return cleanTitle.includes('đế nến') || cleanTitle.includes('chân nến')
    }
    return cleanTitle.includes(tok) || skuLower.includes(tok)
  })
}
