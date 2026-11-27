import { db } from '@/lib/db'
import { readDecryptedShopeeSessionFromVault } from '@/lib/shopee-session-vault'
import {
  sanitizeSafeBannerUrl,
  sanitizeStorefrontBanners,
  type StorefrontBannerHotspot,
  type StorefrontBannersConfig,
  type StorefrontCarouselBanner,
  type StorefrontCollectionBanner,
  type StorefrontSpotlightBanner,
} from '@/lib/storefront-banners'
import {
  getStorefrontConfigForCurrentCms,
  saveStorefrontConfigForCurrentCms,
  type StorefrontCmsConfig,
} from '@/lib/storefront-config'

export interface CmsProductShopeeRef {
  id: string
  sku: string
  name: string
  shopeeItemId: string
}

interface RawDecorationHotspot {
  position?: {
    x?: number
    y?: number
    w?: number
    h?: number
  }
  navigator?: {
    url?: string
    type?: number
    product_id?: number | string
    productId?: number | string
  }
}

interface RawDecorationBannerItem {
  image?: string
  banner_image?: string
  image_url?: string
  texts?: string[]
  title?: string
  display_ratio?: number
  navigator?: {
    url?: string
    type?: number
    product_id?: number | string
    productId?: number | string
  }
}

interface RawDecorationComponent {
  type?: number
  meta?: { id?: string; type?: string }
  data?: {
    type?: string
    title?: string
    shop_cover_image?: string
    image?: string
    image_url?: string
    generate_image?: string
    cover_image?: string
    cover?: string
    thumb_url?: string
    video_url?: string
    display_ratio?: number
    banners?: RawDecorationBannerItem[]
    hotspots?: RawDecorationHotspot[]
    items?: Array<{ item_id?: number | string; product_id?: number | string; url?: string }>
    products?: Array<{ item_id?: number | string; product_id?: number | string; url?: string }>
    video?: {
      cover?: string
      cover_image?: string
      thumb_url?: string
      url?: string
    }
    navigator?: {
      url?: string
      type?: number
      product_id?: number | string
      productId?: number | string
    }
  }
}

export interface RawShopeeBannerSyncPayload {
  shopId: string
  shopUsername: string
  profileInfo?: {
    basic_info?: {
      shop_name?: string
      shop_desc?: string
      shop_logo?: string
    }
  } | null
  pcDraft?: {
    draft_id?: number | string
    draft_type?: string
    decoration_data?: RawDecorationComponent[] | null
  } | null
  mobileDraft?: {
    draft_id?: number | string
    draft_type?: string
    decoration_data?: RawDecorationComponent[] | null
  } | null
  instantDeco?: {
    decoration_data?: RawDecorationComponent[] | null
  } | null
  collectionList?: Array<{
    id?: number | string
    name?: string
    status?: string
    sort_weight?: number
    product_count?: number
    cover_image?: string
  }> | null
  cmsProducts?: CmsProductShopeeRef[]
  syncedAt?: string
}

function cleanProductTitle(fullName: string): string {
  const marker = '— Phân loại:'
  const idx = fullName.indexOf(marker)
  return (idx > 0 ? fullName.slice(0, idx) : fullName).trim()
}

function deriveCollectionFilterKeyword(name: string): string {
  const lower = name.trim().toLowerCase()
  if (lower === 'nến') return '__CANDLE_ONLY__'
  if (lower.includes('nguyên liệu') || lower.includes('diy')) {
    return 'đổ nến|nguyên liệu|bột thạch cao|khuôn|diy'
  }
  if (lower.includes('khay') || lower.includes('đế nến')) {
    return 'khay|đế nến|chân nến'
  }
  return name
    .toLowerCase()
    .replace(/\bvà\b/g, '|')
    .split(/[|,;/+&]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .join('|')
}

function matchBestCmsProductByShopeeItemId(
  byShopeeItemId: Map<string, CmsProductShopeeRef[]>,
  shopeeProductId: string
): CmsProductShopeeRef | null {
  if (!shopeeProductId) return null
  const matches = byShopeeItemId.get(shopeeProductId)
  if (!matches || matches.length === 0) return null
  if (matches.length === 1) return matches[0]
  // Ưu tiên phân loại nổi bật nếu có nhiều biến thể cùng shopeeItemId
  const camVariant = matches.find((m) => m.sku.toUpperCase().endsWith('-CAM'))
  if (camVariant) return camVariant
  return matches[0]
}

export interface ShopeeDraftCandidate {
  draft_id?: number | string
  draft_type?: string
  decoration_data?: RawDecorationComponent[] | null
}

/**
 * Ưu tiên bản thiết kế đang xuất bản trực tiếp trên kênh Shopee (`draft_type === 'publish'`)
 * có `decoration_data` khác rỗng; chỉ rơi về bản nháp (`draft_get`) nếu chưa có bản publish chứa dữ liệu.
 */
export function selectEffectiveShopeeDraft(
  draftGetData: ShopeeDraftCandidate | null | undefined,
  draftListEntries: ShopeeDraftCandidate[] | null | undefined
): ShopeeDraftCandidate | null {
  const list = Array.isArray(draftListEntries) ? draftListEntries : []
  const publishedFromList = list.find(
    (d) =>
      String(d?.draft_type || '').toLowerCase() === 'publish' &&
      Array.isArray(d?.decoration_data) &&
      d.decoration_data.length > 0
  )
  if (publishedFromList) return publishedFromList

  if (
    draftGetData &&
    String(draftGetData.draft_type || '').toLowerCase() === 'publish' &&
    Array.isArray(draftGetData.decoration_data) &&
    draftGetData.decoration_data.length > 0
  ) {
    return draftGetData
  }

  const anyNonEmptyList = list.find(
    (d) => Array.isArray(d?.decoration_data) && d.decoration_data.length > 0
  )
  if (anyNonEmptyList) return anyNonEmptyList

  if (
    draftGetData &&
    Array.isArray(draftGetData.decoration_data) &&
    draftGetData.decoration_data.length > 0
  ) {
    return draftGetData
  }

  return null
}

function isMultiBannerRowType(type?: number): boolean {
  return type === 2 || type === 3 || type === 4 || type === 10
}

function isVideoBannerComponent(comp?: RawDecorationComponent): boolean {
  if (!comp?.data) return false
  if (comp.type === 8 || comp.type === 18) return true
  return Boolean(
    comp.data.video?.cover ||
      comp.data.video?.cover_image ||
      comp.data.video?.thumb_url ||
      comp.data.video_url
  )
}

function isInstantDecoBannerComponent(comp?: RawDecorationComponent): boolean {
  if (!comp?.data) return false
  return Boolean(
    comp.data.generate_image ||
      (comp.type !== 20 &&
        comp.type !== 9 &&
        comp.type !== 1 &&
        !isMultiBannerRowType(comp.type) &&
        !isVideoBannerComponent(comp) &&
        comp.data.image_url)
  )
}

function canPairMobileSpotlight(
  pcComp: RawDecorationComponent,
  mobComp: RawDecorationComponent | undefined,
  pcRatio: number
): boolean {
  if (!mobComp?.data) return false
  const mobRatio =
    Number(mobComp.data.display_ratio || mobComp.data.banners?.[0]?.display_ratio) || pcRatio
  if (Math.abs(mobRatio - pcRatio) > 0.22) return false

  const pcHs = Array.isArray(pcComp.data?.hotspots) ? pcComp.data!.hotspots! : []
  const mobHs = Array.isArray(mobComp.data?.hotspots) ? mobComp.data!.hotspots! : []
  if (pcHs.length === 0 && mobHs.length === 0) return true
  if (pcHs.length !== mobHs.length) return false

  for (let i = 0; i < pcHs.length; i++) {
    const pPid = String(
      pcHs[i]?.navigator?.product_id ?? pcHs[i]?.navigator?.productId ?? ''
    ).replace(/[^\d]/g, '')
    const mPid = String(
      mobHs[i]?.navigator?.product_id ?? mobHs[i]?.navigator?.productId ?? ''
    ).replace(/[^\d]/g, '')
    if (pPid !== mPid) return false
    const px = Number(pcHs[i]?.position?.x ?? 0)
    const py = Number(pcHs[i]?.position?.y ?? 0)
    const mx = Number(mobHs[i]?.position?.x ?? 0)
    const my = Number(mobHs[i]?.position?.y ?? 0)
    if (Math.abs(px - mx) > 8 || Math.abs(py - my) > 8) return false
  }
  return true
}

export function parseShopeeDecorationPayloadToBanners(
  payload: RawShopeeBannerSyncPayload
): StorefrontBannersConfig {
  const shopId = String(payload.shopId || '').trim()
  const shopUsername = String(payload.shopUsername || '').trim()
  const syncedAt = payload.syncedAt || new Date().toISOString()

  const byShopeeItemId = new Map<string, CmsProductShopeeRef[]>()
  for (const prod of payload.cmsProducts ?? []) {
    const sid = String(prod.shopeeItemId || '').trim()
    if (!sid) continue
    const list = byShopeeItemId.get(sid) ?? []
    list.push(prod)
    byShopeeItemId.set(sid, list)
  }

  const shopLogoUrl = sanitizeSafeBannerUrl(payload.profileInfo?.basic_info?.shop_logo || '')

  const rawPcComponents = Array.isArray(payload.pcDraft?.decoration_data)
    ? payload.pcDraft!.decoration_data!
    : []
  const rawMobComponents = Array.isArray(payload.mobileDraft?.decoration_data)
    ? payload.mobileDraft!.decoration_data!
    : []
  const rawInstantComponents = Array.isArray(payload.instantDeco?.decoration_data)
    ? payload.instantDeco!.decoration_data!
    : []

  const pcComponents = rawPcComponents
  const mobComponents = rawMobComponents.length > 0 ? rawMobComponents : rawInstantComponents

  // 1. Shop Cover Banner (type = 20)
  const pcCoverComp = pcComponents.find((c) => c?.type === 20 && c?.data?.shop_cover_image)
  const mobCoverComp = mobComponents.find((c) => c?.type === 20 && c?.data?.shop_cover_image)
  const pcCoverUrl = sanitizeSafeBannerUrl(pcCoverComp?.data?.shop_cover_image || '')
  const mobCoverUrl = sanitizeSafeBannerUrl(mobCoverComp?.data?.shop_cover_image || '')
  const coverBannerUrl = pcCoverUrl || mobCoverUrl
  const mobileCoverBannerUrl = mobCoverUrl || pcCoverUrl

  // 2. Carousel Banners (type = 1) + Video Poster Banners (type = 8 | 18)
  const pcCarousels = pcComponents.filter(
    (c) => c?.type === 1 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0
  )
  const mobCarousels = mobComponents.filter(
    (c) => c?.type === 1 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0
  )
  const primaryCarouselComps = pcCarousels.length > 0 ? pcCarousels : mobCarousels

  const carouselBanners: StorefrontCarouselBanner[] = []
  primaryCarouselComps.forEach((comp, compIdx) => {
    const pairedMobComp = pcCarousels.length > 0 ? mobCarousels[compIdx] : undefined
    const slides = comp.data?.banners ?? []
    const mobSlides = pairedMobComp?.data?.banners ?? []
    const ratio = Number(comp.data?.display_ratio) || 2
    const mobRatio = Number(pairedMobComp?.data?.display_ratio) || ratio
    const canPairMobRatio = Math.abs(mobRatio - ratio) <= 0.25

    slides.forEach((slide, slideIdx) => {
      const imageUrl = sanitizeSafeBannerUrl(
        slide.image || slide.banner_image || slide.image_url || ''
      )
      if (!imageUrl) return
      const rawPid = String(
        slide.navigator?.product_id ?? slide.navigator?.productId ?? ''
      ).replace(/[^\d]/g, '')
      const mobSlide = mobSlides[slideIdx]
      const mobPid = String(
        mobSlide?.navigator?.product_id ?? mobSlide?.navigator?.productId ?? ''
      ).replace(/[^\d]/g, '')
      const pairedMobUrl =
        canPairMobRatio && (!rawPid || !mobPid || rawPid === mobPid)
          ? sanitizeSafeBannerUrl(
              mobSlide?.image || mobSlide?.banner_image || mobSlide?.image_url || ''
            )
          : ''
      const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, rawPid)
      const titleFromTexts =
        (Array.isArray(slide.texts) && slide.texts[0] ? slide.texts[0] : '') || slide.title || ''
      const subFromTexts = Array.isArray(slide.texts) && slide.texts[1] ? slide.texts[1] : ''
      const fallbackLink =
        slide.navigator?.url || (rawPid && shopId ? `https://shopee.vn/product/${shopId}/${rawPid}` : '')

      carouselBanners.push({
        id: `carousel_${compIdx + 1}_${slideIdx + 1}`,
        imageUrl,
        mobileImageUrl: pairedMobUrl || imageUrl,
        title: titleFromTexts || (matchedProd ? cleanProductTitle(matchedProd.name) : ''),
        subtitle: subFromTexts,
        aspectRatio: ratio,
        shopeeProductId: rawPid,
        targetSku: matchedProd?.sku || '',
        filterKeyword: '',
        linkUrl: sanitizeSafeBannerUrl(fallbackLink),
      })
    })
  })

  // Video Banner Poster fallback (type = 8 | 18) -> đồng bộ ảnh bìa video & đường dẫn an toàn
  const pcVideos = pcComponents.filter((c) => isVideoBannerComponent(c))
  const mobVideos = mobComponents.filter((c) => isVideoBannerComponent(c))
  const primaryVideoComps = pcVideos.length > 0 ? pcVideos : mobVideos
  primaryVideoComps.forEach((comp, vIdx) => {
    const posterRaw =
      comp.data?.cover_image ||
      comp.data?.cover ||
      comp.data?.thumb_url ||
      comp.data?.video?.cover_image ||
      comp.data?.video?.cover ||
      comp.data?.video?.thumb_url ||
      comp.data?.image ||
      ''
    const imageUrl = sanitizeSafeBannerUrl(posterRaw)
    if (!imageUrl) return
    const pid = String(
      comp.data?.navigator?.product_id ?? comp.data?.navigator?.productId ?? ''
    ).replace(/[^\d]/g, '')
    const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, pid)
    const linkRaw =
      comp.data?.navigator?.url ||
      (pid && shopId
        ? `https://shopee.vn/product/${shopId}/${pid}`
        : shopUsername
          ? `https://shopee.vn/${shopUsername}`
          : '')
    carouselBanners.push({
      id: `video_banner_${vIdx + 1}`,
      imageUrl,
      mobileImageUrl: imageUrl,
      title: comp.data?.title || (matchedProd ? cleanProductTitle(matchedProd.name) : ''),
      subtitle: '',
      aspectRatio: Number(comp.data?.display_ratio) || 1.778,
      shopeeProductId: pid,
      targetSku: matchedProd?.sku || '',
      filterKeyword: '',
      linkUrl: sanitizeSafeBannerUrl(linkRaw),
    })
  })

  // 3. Spotlight, Multi-Hotspot (type = 9), Single/Multi-Column Banner (type = 2,3,4,10) & Instant Deco
  const isSpotlightLike = (c?: RawDecorationComponent): boolean =>
    Boolean(
      (c?.type === 9 && Boolean(c?.data?.image || c?.data?.image_url)) ||
        (isMultiBannerRowType(c?.type) &&
          Array.isArray(c?.data?.banners) &&
          c!.data!.banners!.length > 0) ||
        isInstantDecoBannerComponent(c)
    )

  const pcSpotlights = pcComponents.filter(isSpotlightLike)
  const mobSpotlights = mobComponents.filter(isSpotlightLike)
  const primarySpotlightComps =
    pcSpotlights.length > 0
      ? pcSpotlights
      : mobSpotlights.length > 0
        ? mobSpotlights
        : rawInstantComponents.filter(isSpotlightLike)

  const spotlightBanners: StorefrontSpotlightBanner[] = []
  primarySpotlightComps.forEach((comp, compIdx) => {
    const pairedMob = pcSpotlights.length > 0 ? mobSpotlights[compIdx] : undefined

    // Case A: Single / 2-Column / 3-Column Clickable Banner Row (type = 2, 3, 4, 10) without explicit hotspots
    if (
      isMultiBannerRowType(comp.type) &&
      Array.isArray(comp.data?.banners) &&
      comp.data!.banners!.length > 0 &&
      (!Array.isArray(comp.data?.hotspots) || comp.data!.hotspots!.length === 0)
    ) {
      const rowBanners = comp.data!.banners!
      const mobRowBanners = Array.isArray(pairedMob?.data?.banners) ? pairedMob!.data!.banners! : []
      rowBanners.forEach((bItem, bIdx) => {
        const imageUrl = sanitizeSafeBannerUrl(
          bItem.image || bItem.banner_image || bItem.image_url || ''
        )
        if (!imageUrl) return
        const itemRatio = Number(bItem.display_ratio || comp.data?.display_ratio) || 2
        const mobItem = mobRowBanners[bIdx]
        const mobRatio = Number(mobItem?.display_ratio || pairedMob?.data?.display_ratio) || itemRatio
        const pid = String(
          bItem.navigator?.product_id ?? bItem.navigator?.productId ?? ''
        ).replace(/[^\d]/g, '')
        const mobPid = String(
          mobItem?.navigator?.product_id ?? mobItem?.navigator?.productId ?? ''
        ).replace(/[^\d]/g, '')
        const pairedMobUrl =
          Math.abs(mobRatio - itemRatio) <= 0.25 && (!pid || !mobPid || pid === mobPid)
            ? sanitizeSafeBannerUrl(
                mobItem?.image || mobItem?.banner_image || mobItem?.image_url || ''
              )
            : ''
        const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, pid)
        const fallbackLink =
          bItem.navigator?.url || (pid && shopId ? `https://shopee.vn/product/${shopId}/${pid}` : '')
        const safeLink = sanitizeSafeBannerUrl(fallbackLink)
        const itemTitle =
          (Array.isArray(bItem.texts) && bItem.texts[0] ? bItem.texts[0] : '') ||
          bItem.title ||
          comp.data?.title ||
          ''

        const itemHotspots: StorefrontBannerHotspot[] = []
        if (pid || matchedProd || safeLink) {
          itemHotspots.push({
            id: `hs_${compIdx + 1}_${bIdx + 1}`,
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            shopeeProductId: pid,
            targetSku: matchedProd?.sku || '',
            label:
              (matchedProd ? cleanProductTitle(matchedProd.name) : '') ||
              itemTitle ||
              'Xem chi tiết ưu đãi',
            linkUrl: safeLink,
          })
        }

        spotlightBanners.push({
          id:
            rowBanners.length === 1 && comp.meta?.id
              ? comp.meta.id
              : `spotlight_${compIdx + 1}_${bIdx + 1}`,
          imageUrl,
          mobileImageUrl: pairedMobUrl || imageUrl,
          title: itemTitle,
          aspectRatio: itemRatio,
          hotspots: itemHotspots,
        })
      })
      return
    }

    // Case B: Hotspot Banner (type = 9) hoặc Instant Deco Composite (`generate_image`)
    const rawImg =
      comp.type === 9
        ? comp.data?.image || comp.data?.image_url
        : comp.data?.generate_image ||
          comp.data?.image_url ||
          comp.data?.image ||
          comp.data?.banners?.[0]?.image ||
          comp.data?.banners?.[0]?.banner_image
    const imageUrl = sanitizeSafeBannerUrl(rawImg || '')
    if (!imageUrl) return

    const ratio =
      Number(comp.data?.display_ratio || comp.data?.banners?.[0]?.display_ratio) || 1.796
    const rawMobImg =
      pairedMob && canPairMobileSpotlight(comp, pairedMob, ratio)
        ? pairedMob.type === 9
          ? pairedMob.data?.image || pairedMob.data?.image_url
          : pairedMob.data?.generate_image ||
            pairedMob.data?.image_url ||
            pairedMob.data?.image ||
            pairedMob.data?.banners?.[0]?.image ||
            pairedMob.data?.banners?.[0]?.banner_image
        : ''
    const mobileImageUrl = sanitizeSafeBannerUrl(rawMobImg || '') || imageUrl

    const hotspots: StorefrontBannerHotspot[] = []
    const rawHotspots = Array.isArray(comp.data?.hotspots) ? comp.data!.hotspots! : []
    rawHotspots.forEach((hs, hsIdx) => {
      const pos = hs.position
      if (!pos) return
      const pid = String(hs.navigator?.product_id ?? hs.navigator?.productId ?? '').replace(
        /[^\d]/g,
        ''
      )
      const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, pid)
      const fallbackLink =
        hs.navigator?.url ||
        (pid && shopId ? `https://shopee.vn/product/${shopId}/${pid}` : '')
      hotspots.push({
        id: `hs_${compIdx + 1}_${hsIdx + 1}`,
        x: Number(pos.x ?? 0),
        y: Number(pos.y ?? 0),
        w: Number(pos.w ?? 0),
        h: Number(pos.h ?? 0),
        shopeeProductId: pid,
        targetSku: matchedProd?.sku || '',
        label: matchedProd ? cleanProductTitle(matchedProd.name) : '',
        linkUrl: sanitizeSafeBannerUrl(fallbackLink),
      })
    })

    // Nếu là Instant Deco gắn danh sách `items` / `products` mà không có tọa độ hotspot rời, chia cột đều tự động
    if (hotspots.length === 0) {
      const linkedItems = (comp.data?.items || comp.data?.products || []).slice(0, 6)
      if (linkedItems.length > 0) {
        const sliceW = 100 / linkedItems.length
        linkedItems.forEach((it, idx) => {
          const pid = String(it.product_id ?? it.item_id ?? '').replace(/[^\d]/g, '')
          const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, pid)
          const fallbackLink =
            it.url || (pid && shopId ? `https://shopee.vn/product/${shopId}/${pid}` : '')
          const safeLink = sanitizeSafeBannerUrl(fallbackLink)
          if (!pid && !matchedProd && !safeLink) return
          hotspots.push({
            id: `hs_inst_${compIdx + 1}_${idx + 1}`,
            x: idx * sliceW,
            y: 0,
            w: sliceW,
            h: 100,
            shopeeProductId: pid,
            targetSku: matchedProd?.sku || '',
            label: matchedProd ? cleanProductTitle(matchedProd.name) : '',
            linkUrl: safeLink,
          })
        })
      } else if (comp.data?.navigator) {
        const pid = String(
          comp.data.navigator.product_id ?? comp.data.navigator.productId ?? ''
        ).replace(/[^\d]/g, '')
        const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, pid)
        const fallbackLink =
          comp.data.navigator.url ||
          (pid && shopId ? `https://shopee.vn/product/${shopId}/${pid}` : '')
        const safeLink = sanitizeSafeBannerUrl(fallbackLink)
        if (pid || matchedProd || safeLink) {
          hotspots.push({
            id: `hs_full_${compIdx + 1}`,
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            shopeeProductId: pid,
            targetSku: matchedProd?.sku || '',
            label: matchedProd ? cleanProductTitle(matchedProd.name) : comp.data?.title || '',
            linkUrl: safeLink,
          })
        }
      }
    }

    spotlightBanners.push({
      id: comp.meta?.id || `spotlight_${compIdx + 1}`,
      imageUrl,
      mobileImageUrl,
      title: comp.data?.title || '',
      aspectRatio: ratio,
      hotspots,
    })
  })

  // 4. Shop Category Collection Cover Banners (collection_list)
  const rawCollections = Array.isArray(payload.collectionList) ? payload.collectionList : []
  const sortedActiveCollections = [...rawCollections]
    .filter(
      (c) =>
        c &&
        (!c.status || String(c.status).toLowerCase() === 'active') &&
        Boolean(c.cover_image) &&
        Boolean(c.name)
    )
    .sort((a, b) => Number(b.sort_weight || 0) - Number(a.sort_weight || 0))

  const collectionBanners: StorefrontCollectionBanner[] = sortedActiveCollections.map(
    (col, idx) => {
      const colId = String(col.id ?? idx + 1).trim()
      const name = String(col.name || '').trim()
      const shopeeUrl = shopUsername
        ? `https://shopee.vn/${shopUsername}?shopCollection=${encodeURIComponent(colId)}#product_list`
        : ''
      return {
        id: `col_${colId}`,
        collectionId: colId,
        name,
        imageUrl: sanitizeSafeBannerUrl(col.cover_image || ''),
        productCount: Math.max(0, Math.floor(Number(col.product_count) || 0)),
        filterKeyword: deriveCollectionFilterKeyword(name),
        shopeeUrl,
      }
    }
  )

  const draftIds = [payload.pcDraft?.draft_id, payload.mobileDraft?.draft_id]
    .filter(Boolean)
    .map(String)
    .join(':')

  return sanitizeStorefrontBanners({
    enabled: true,
    shopLogoUrl,
    coverBannerUrl,
    mobileCoverBannerUrl,
    carouselBanners,
    spotlightBanners,
    collectionBanners,
    sourceShopId: shopId,
    sourceShopUsername: shopUsername,
    sourceDraftId: draftIds,
    syncedAt,
  })
}

async function fetchSellerCenterJson<T>(
  url: string,
  headers: Record<string, string>
): Promise<{ status: number; data: T | null }> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { status: res.status, data: null }
    const json = (await res.json()) as T
    return { status: res.status, data: json }
  } catch {
    return { status: 0, data: null }
  }
}

export async function syncShopeeBannersForCurrentCms(): Promise<{
  ok: boolean
  config: StorefrontCmsConfig
  banners: StorefrontBannersConfig
  summary: {
    shopId: string
    shopUsername: string
    hasLogo: boolean
    hasCover: boolean
    carouselCount: number
    spotlightCount: number
    hotspotCount: number
    collectionCount: number
  }
}> {
  const current = await getStorefrontConfigForCurrentCms()
  const session = await readDecryptedShopeeSessionFromVault(
    current.shopeeShopId || undefined
  )
  if (!session || Object.keys(session.cookies).length === 0) {
    throw new Error(
      'Chưa tìm thấy phiên đăng nhập Shopee hợp lệ trong Kho Phiên (Vault) của CMS này. Vui lòng kết nối tài khoản Shopee trước khi đồng bộ Banner.'
    )
  }

  const cookieStr = Object.entries(session.cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  const spcCds = encodeURIComponent(session.spcCds || session.cookies.SPC_CDS || '')
  const csrfToken = session.csrfToken || session.cookies.csrftoken || ''

  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Cookie: cookieStr,
    Accept: 'application/json, text/plain, */*',
    Referer: 'https://banhang.shopee.vn/portal/decoration',
    'X-CSRFToken': csrfToken,
  }

  const [
    profileRes,
    pcDraftRes,
    mobDraftRes,
    pcListRes,
    mobListRes,
    collectionRes,
    rawDbProducts,
  ] = await Promise.all([
    fetchSellerCenterJson<{
      basic_info?: { shop_name?: string; shop_desc?: string; shop_logo?: string }
    }>(
      `https://banhang.shopee.vn/api/sellermanagement_seller/v1/shop/profile/info?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    fetchSellerCenterJson<{
      code?: number
      data?: ShopeeDraftCandidate
    }>(
      `https://banhang.shopee.vn/api/n/decoration/pc_homepage/draft_get/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    fetchSellerCenterJson<{
      code?: number
      data?: ShopeeDraftCandidate
    }>(
      `https://banhang.shopee.vn/api/n/decoration/homepage/draft_get/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    fetchSellerCenterJson<{
      code?: number
      data?: { pc_homepage_list?: ShopeeDraftCandidate[] }
    }>(
      `https://banhang.shopee.vn/api/n/decoration/pc_homepage/draft_list/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    fetchSellerCenterJson<{
      code?: number
      data?: { homepage_list?: ShopeeDraftCandidate[] }
    }>(
      `https://banhang.shopee.vn/api/n/decoration/homepage/draft_list/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    fetchSellerCenterJson<{
      code?: number
      data?: {
        list?: Array<{
          id?: number
          name?: string
          status?: string
          sort_weight?: number
          product_count?: number
          cover_image?: string
        }>
      }
    }>(
      `https://banhang.shopee.vn/api/shopcategory/v4/category/get_collection_list/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
      headers
    ),
    db.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ sellPrice: 'asc' }, { name: 'asc' }],
      select: { id: true, sku: true, name: true, attributes: true },
    }),
  ])

  const allAuthFailed =
    profileRes.status !== 200 &&
    pcDraftRes.status !== 200 &&
    mobDraftRes.status !== 200 &&
    collectionRes.status !== 200
  if (allAuthFailed) {
    throw new Error(
      `Không thể truy vấn dữ liệu Trang trí Shop từ Shopee Kênh Người Bán (HTTP ${pcDraftRes.status || profileRes.status}). Vui lòng làm mới phiên Shopee và thử lại.`
    )
  }

  const effectivePcDraft = selectEffectiveShopeeDraft(
    pcDraftRes.data?.code === 0 ? pcDraftRes.data.data : null,
    pcListRes.data?.data?.pc_homepage_list
  )

  const effectiveMobDraft = selectEffectiveShopeeDraft(
    mobDraftRes.data?.code === 0 ? mobDraftRes.data.data : null,
    mobListRes.data?.data?.homepage_list
  )

  const cmsProducts: CmsProductShopeeRef[] = rawDbProducts.map((p) => {
    let shopeeItemId = ''
    if (p.attributes) {
      try {
        const attr = JSON.parse(p.attributes) as { shopeeItemId?: string | number }
        if (attr.shopeeItemId) shopeeItemId = String(attr.shopeeItemId).trim()
      } catch {
        // ignore
      }
    }
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      shopeeItemId,
    }
  })

  const shopUsername =
    session.username && session.username !== 'thaimy1605'
      ? session.username
      : session.shopId === '197195817'
        ? 'bomocdecor'
        : session.username

  const syncedBanners = parseShopeeDecorationPayloadToBanners({
    shopId: session.shopId,
    shopUsername,
    profileInfo: profileRes.data,
    pcDraft: effectivePcDraft,
    mobileDraft: effectiveMobDraft,
    collectionList: collectionRes.data?.data?.list ?? [],
    cmsProducts,
  })

  // Bảo toàn trạng thái bật/tắt hiển thị banner trước đó nếu người vận hành chủ động cấu hình
  const mergedBanners: StorefrontBannersConfig = {
    ...syncedBanners,
    enabled: current.config.banners?.enabled ?? true,
  }

  const nextConfig = await saveStorefrontConfigForCurrentCms({
    banners: mergedBanners,
  })

  const hotspotCount = nextConfig.banners.spotlightBanners.reduce(
    (sum, sb) => sum + sb.hotspots.length,
    0
  )

  return {
    ok: true,
    config: nextConfig,
    banners: nextConfig.banners,
    summary: {
      shopId: session.shopId,
      shopUsername,
      hasLogo: Boolean(nextConfig.banners.shopLogoUrl),
      hasCover: Boolean(nextConfig.banners.coverBannerUrl),
      carouselCount: nextConfig.banners.carouselBanners.length,
      spotlightCount: nextConfig.banners.spotlightBanners.length,
      hotspotCount,
      collectionCount: nextConfig.banners.collectionBanners.length,
    },
  }
}
