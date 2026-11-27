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
  texts?: string[]
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
    display_ratio?: number
    banners?: RawDecorationBannerItem[]
    hotspots?: RawDecorationHotspot[]
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
    decoration_data?: RawDecorationComponent[] | null
  } | null
  mobileDraft?: {
    draft_id?: number | string
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

  const pcComponents = Array.isArray(payload.pcDraft?.decoration_data)
    ? payload.pcDraft!.decoration_data!
    : []
  const mobComponents = Array.isArray(payload.mobileDraft?.decoration_data)
    ? payload.mobileDraft!.decoration_data!
    : []

  // 1. Shop Cover Banner (type = 20)
  const pcCoverComp = pcComponents.find((c) => c?.type === 20 && c?.data?.shop_cover_image)
  const mobCoverComp = mobComponents.find((c) => c?.type === 20 && c?.data?.shop_cover_image)
  const pcCoverUrl = sanitizeSafeBannerUrl(pcCoverComp?.data?.shop_cover_image || '')
  const mobCoverUrl = sanitizeSafeBannerUrl(mobCoverComp?.data?.shop_cover_image || '')
  const coverBannerUrl = pcCoverUrl || mobCoverUrl
  const mobileCoverBannerUrl = mobCoverUrl || pcCoverUrl

  // 2. Carousel Banners (type = 1)
  const pcCarousels = pcComponents.filter(
    (c) => c?.type === 1 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0
  )
  const mobCarousels = mobComponents.filter(
    (c) => c?.type === 1 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0
  )
  const primaryCarouselComps = pcCarousels.length > 0 ? pcCarousels : mobCarousels

  const carouselBanners: StorefrontCarouselBanner[] = []
  primaryCarouselComps.forEach((comp, compIdx) => {
    const pairedMobComp = mobCarousels[compIdx]
    const slides = comp.data?.banners ?? []
    const mobSlides = pairedMobComp?.data?.banners ?? []
    const ratio = Number(comp.data?.display_ratio) || 2

    slides.forEach((slide, slideIdx) => {
      const imageUrl = sanitizeSafeBannerUrl(slide.image || slide.banner_image || '')
      if (!imageUrl) return
      const pairedMobUrl = sanitizeSafeBannerUrl(
        mobSlides[slideIdx]?.image || mobSlides[slideIdx]?.banner_image || ''
      )
      const rawPid = String(
        slide.navigator?.product_id ?? slide.navigator?.productId ?? ''
      ).replace(/[^\d]/g, '')
      const matchedProd = matchBestCmsProductByShopeeItemId(byShopeeItemId, rawPid)
      const titleFromTexts = Array.isArray(slide.texts) && slide.texts[0] ? slide.texts[0] : ''
      const subFromTexts = Array.isArray(slide.texts) && slide.texts[1] ? slide.texts[1] : ''

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
        linkUrl: sanitizeSafeBannerUrl(slide.navigator?.url || ''),
      })
    })
  })

  // 3. Spotlight & Multi-Hotspot Banners (type = 9 hoặc type = 10)
  const pcSpotlights = pcComponents.filter(
    (c) =>
      (c?.type === 9 && Boolean(c?.data?.image)) ||
      (c?.type === 10 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0)
  )
  const mobSpotlights = mobComponents.filter(
    (c) =>
      (c?.type === 9 && Boolean(c?.data?.image)) ||
      (c?.type === 10 && Array.isArray(c?.data?.banners) && c.data!.banners!.length > 0)
  )
  const primarySpotlightComps = pcSpotlights.length > 0 ? pcSpotlights : mobSpotlights

  const spotlightBanners: StorefrontSpotlightBanner[] = []
  primarySpotlightComps.forEach((comp, compIdx) => {
    const pairedMob = mobSpotlights[compIdx]
    const rawImg =
      comp.type === 9
        ? comp.data?.image
        : comp.data?.banners?.[0]?.image || comp.data?.banners?.[0]?.banner_image
    const rawMobImg =
      pairedMob?.type === 9
        ? pairedMob.data?.image
        : pairedMob?.data?.banners?.[0]?.image || pairedMob?.data?.banners?.[0]?.banner_image
    const imageUrl = sanitizeSafeBannerUrl(rawImg || '')
    if (!imageUrl) return
    const mobileImageUrl = sanitizeSafeBannerUrl(rawMobImg || '') || imageUrl
    const ratio =
      Number(comp.data?.display_ratio || comp.data?.banners?.[0]?.display_ratio) || 1.796

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

  const [profileRes, pcDraftRes, mobDraftRes, pcListRes, collectionRes, rawDbProducts] =
    await Promise.all([
      fetchSellerCenterJson<{
        basic_info?: { shop_name?: string; shop_desc?: string; shop_logo?: string }
      }>(
        `https://banhang.shopee.vn/api/sellermanagement_seller/v1/shop/profile/info?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
        headers
      ),
      fetchSellerCenterJson<{
        code?: number
        data?: { draft_id?: number; decoration_data?: RawDecorationComponent[] }
      }>(
        `https://banhang.shopee.vn/api/n/decoration/pc_homepage/draft_get/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
        headers
      ),
      fetchSellerCenterJson<{
        code?: number
        data?: { draft_id?: number; decoration_data?: RawDecorationComponent[] }
      }>(
        `https://banhang.shopee.vn/api/n/decoration/homepage/draft_get/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
        headers
      ),
      fetchSellerCenterJson<{
        code?: number
        data?: {
          pc_homepage_list?: Array<{
            draft_id?: number
            draft_type?: string
            decoration_data?: RawDecorationComponent[]
          }>
        }
      }>(
        `https://banhang.shopee.vn/api/n/decoration/pc_homepage/draft_list/?SPC_CDS=${spcCds}&SPC_CDS_VER=2`,
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

  const publishedPcListEntry =
    pcListRes.data?.data?.pc_homepage_list?.find((d) => d.draft_type === 'publish') ??
    pcListRes.data?.data?.pc_homepage_list?.[0]

  const effectivePcDraft =
    pcDraftRes.data?.code === 0 && Array.isArray(pcDraftRes.data?.data?.decoration_data)
      ? pcDraftRes.data.data
      : publishedPcListEntry || null

  const effectiveMobDraft =
    mobDraftRes.data?.code === 0 && Array.isArray(mobDraftRes.data?.data?.decoration_data)
      ? mobDraftRes.data.data
      : null

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
