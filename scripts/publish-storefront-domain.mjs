#!/usr/bin/env node
/**
 * ============================================================================
 * MULTI-CMS INDEPENDENT CUSTOM DOMAIN STOREFRONT PUBLISHER
 * Xuất bản Website Khách hàng (Sản phẩm · Bảng Giá Sỉ · Liên hệ · Đặt hàng · Tra cứu)
 * ra Tên miền Riêng (Custom Domain CDN 24/7 + Live API Sync về đúng CMS độc lập).
 *
 * Cách dùng cho từng CMS độc lập:
 *   node scripts/publish-storefront-domain.mjs
 *   node scripts/publish-storefront-domain.mjs --domain=bomocdecor.vn --repo=khoap1220-hue/bomocdecor-vn --backend=https://openvn-cms-pos-backend.onrender.com
 *   node scripts/publish-storefront-domain.mjs --dry-run --out-dir=/path/to/temp
 * ============================================================================
 */

import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

let _prisma = null
function getPrisma() {
  if (!_prisma) _prisma = new PrismaClient()
  return _prisma
}

function parseArg(flag) {
  const pref = `--${flag}=`
  const hit = process.argv.find((a) => a.startsWith(pref))
  return hit ? hit.slice(pref.length).trim() : ''
}

const isDryRun = process.argv.includes('--dry-run')

function computeWholesaleUnitPrice(retailPrice, discountPercent) {
  const cleanRetail = Math.max(0, Math.round(Number(retailPrice) || 0))
  const clampedPct = Math.min(90, Math.max(0, Number(discountPercent) || 0))
  const keepBps = 10_000 - Math.round(clampedPct * 100)
  return Math.floor((cleanRetail * keepBps + 5_000) / 10_000)
}

function splitTitle(fullName) {
  const marker = '— Phân loại:'
  const idx = String(fullName || '').indexOf(marker)
  if (idx > 0) {
    return {
      cleanTitle: fullName.slice(0, idx).trim(),
      variantLabel: fullName.slice(idx + marker.length).trim() || null,
    }
  }
  return { cleanTitle: String(fullName || '').trim(), variantLabel: null }
}

const PLACEHOLDER_PHONE_SET = new Set(['0909686868', '84909686868'])
const PLACEHOLDER_EMAIL_SET = new Set(['lienhe@bomocdecor.vn'])

function isPlaceholderPhoneMjs(raw) {
  const digits = String(raw || '').replace(/\D/g, '')
  return Boolean(digits && PLACEHOLDER_PHONE_SET.has(digits))
}

function isPlaceholderEmailMjs(raw) {
  const lower = String(raw || '').trim().toLowerCase()
  return Boolean(lower && PLACEHOLDER_EMAIL_SET.has(lower))
}

export function formatCustomerBrandNameMjs(rawBrandName, customDomain) {
  const dom = String(customDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
  let raw = String(rawBrandName || '').trim()
  if (!raw || raw.toUpperCase() === 'OPENVN') {
    return dom.startsWith('bomoc') ? 'Bơ Mộc Decor' : 'Cửa Hàng Trực Tuyến'
  }
  if (/^OPENVN\s*[·•|-]\s*/i.test(raw)) {
    if (dom.startsWith('bomoc')) return 'Bơ Mộc Decor'
    raw = raw.replace(/^OPENVN\s*[·•|-]\s*/i, '').trim()
  }
  const stripped = raw
    .replace(/\s*[·•|-]\s*(Showroom|POS|CMS|Admin|Quản\s*trị|Hệ\s*thống)\s*$/i, '')
    .trim()
  const cleaned = stripped || raw
  if (cleaned.toLowerCase() === 'bơ mộc' && dom.includes('bomocdecor')) {
    return 'Bơ Mộc Decor'
  }
  return cleaned
}

export function resolveHeaderSubtitleMjs(opts) {
  const sub = String(opts?.brandSubtitle || '').trim()
  const badge = String(opts?.heroBadge || '').trim()
  const workshop = String(opts?.workshopName || '').trim()
  const brand = String(opts?.brandName || '').trim()
  const isInternal = !sub || /quản lý bán hàng|agent autopilot|offline-first|pos/i.test(sub)
  if (!isInternal && sub.toLowerCase() !== badge.toLowerCase()) {
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

const COLOR_PHRASE_MJS =
  '(?:Trắng(?:\\s+Mộc)?|Kem(?:\\s+Bơ)?|Vàng(?:\\s+Bơ)?|Cam(?:\\s+Đất)?|Xanh(?:\\s+Sage|\\s+Rêu|\\s+Ngọc)?|Đen|Be|Nâu(?:\\s+Đất)?|Xám|Hồng(?:\\s+Phấn)?)'
const MULTI_COLOR_RE_MJS = new RegExp(
  `\\s+${COLOR_PHRASE_MJS}(?:\\s*[,/]\\s*${COLOR_PHRASE_MJS})+`,
  'gi'
)

export function formatDisplayTitleMjs(rawNameOrCleanTitle, variantLabel) {
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
    base = base.replace(MULTI_COLOR_RE_MJS, '').replace(/\s{2,}/g, ' ').trim()
    const isShapeOnly = /hoa\s*sen|chum|trái\s*tim|\bcm\b/i.test(vLabel)
    if (!isShapeOnly) {
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

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeBannerUrlMjs(raw) {
  if (typeof raw !== 'string') return ''
  const t = raw.trim().slice(0, 400)
  if (!t || /[\s<>"'`\u0000-\u001f]/.test(t)) return ''
  if (/^[a-z]{2}-\d{5,12}-[a-z0-9]{3,16}-[a-z0-9_-]{6,80}$/i.test(t)) {
    return `https://down-vn.img.susercontent.com/file/${t}`
  }
  if (t.startsWith('/') && !t.startsWith('//')) return t
  if (t.toLowerCase().startsWith('https://')) {
    try {
      const u = new URL(t)
      if (u.protocol === 'https:') return u.toString()
    } catch {
      return ''
    }
  }
  return ''
}

export function clampSafeAspectRatioMjs(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0.5 && n <= 5 ? Math.round(n * 1000) / 1000 : fallback
}

export function normalizeSnapshotBanners(rawBanners, isEnabled) {
  const b = rawBanners && typeof rawBanners === 'object' ? rawBanners : {}
  const shopLogoUrl = sanitizeBannerUrlMjs(b.shopLogoUrl)
  if (!isEnabled) {
    return {
      enabled: false,
      shopLogoUrl,
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
  }
  const coverBannerUrl = sanitizeBannerUrlMjs(b.coverBannerUrl)
  const mobileCoverBannerUrl = sanitizeBannerUrlMjs(b.mobileCoverBannerUrl) || coverBannerUrl
  const carouselBanners = Array.isArray(b.carouselBanners)
    ? b.carouselBanners
        .slice(0, 10)
        .map((c, idx) => {
          const imageUrl = sanitizeBannerUrlMjs(c?.imageUrl)
          if (!imageUrl) return null
          return {
            id: String(c?.id || `carousel_${idx + 1}`).slice(0, 48),
            imageUrl,
            mobileImageUrl: sanitizeBannerUrlMjs(c?.mobileImageUrl) || imageUrl,
            title: String(c?.title || '').trim().slice(0, 120),
            subtitle: String(c?.subtitle || '').trim().slice(0, 160),
            aspectRatio: clampSafeAspectRatioMjs(c?.aspectRatio, 2),
            shopeeProductId: String(c?.shopeeProductId || '').replace(/[^\d]/g, ''),
            targetSku: String(c?.targetSku || '').trim().slice(0, 64),
            filterKeyword: String(c?.filterKeyword || '').trim().slice(0, 80),
            linkUrl: sanitizeBannerUrlMjs(c?.linkUrl),
          }
        })
        .filter(Boolean)
    : []
  const spotlightBanners = Array.isArray(b.spotlightBanners)
    ? b.spotlightBanners
        .slice(0, 6)
        .map((s, idx) => {
          const imageUrl = sanitizeBannerUrlMjs(s?.imageUrl)
          if (!imageUrl) return null
          const hotspots = Array.isArray(s?.hotspots)
            ? s.hotspots
                .slice(0, 12)
                .map((hs, hIdx) => {
                  const rawX = Number(hs?.x)
                  const rawY = Number(hs?.y)
                  const rawW = Number(hs?.w)
                  const rawH = Number(hs?.h)
                  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
                    return null
                  }
                  const x = Math.min(99, Math.max(0, Number.isFinite(rawX) ? rawX : 0))
                  const y = Math.min(99, Math.max(0, Number.isFinite(rawY) ? rawY : 0))
                  const w = Math.min(100 - x, Math.max(1, rawW))
                  const h = Math.min(100 - y, Math.max(1, rawH))
                  return {
                    id: String(hs?.id || `hs_${hIdx + 1}`).slice(0, 48),
                    x: Math.round(x * 100) / 100,
                    y: Math.round(y * 100) / 100,
                    w: Math.round(w * 100) / 100,
                    h: Math.round(h * 100) / 100,
                    shopeeProductId: String(hs?.shopeeProductId || '').replace(/[^\d]/g, ''),
                    targetSku: String(hs?.targetSku || '').trim().slice(0, 64),
                    label: String(hs?.label || '').trim().slice(0, 140),
                    linkUrl: sanitizeBannerUrlMjs(hs?.linkUrl),
                  }
                })
                .filter(Boolean)
            : []
          return {
            id: String(s?.id || `spotlight_${idx + 1}`).slice(0, 48),
            imageUrl,
            mobileImageUrl: sanitizeBannerUrlMjs(s?.mobileImageUrl) || imageUrl,
            title: String(s?.title || '').trim().slice(0, 120),
            aspectRatio: clampSafeAspectRatioMjs(s?.aspectRatio, 1.796),
            hotspots,
          }
        })
        .filter(Boolean)
    : []
  const collectionBanners = Array.isArray(b.collectionBanners)
    ? b.collectionBanners
        .map((col, idx) => {
          const imageUrl = sanitizeBannerUrlMjs(col?.imageUrl)
          const name = String(col?.name || '').trim().slice(0, 80)
          if (!imageUrl || !name) return null
          return {
            id: String(col?.id || `col_${idx + 1}`).slice(0, 48),
            collectionId: String(col?.collectionId || idx + 1).slice(0, 40),
            name,
            imageUrl,
            productCount: Math.max(0, Math.floor(Number(col?.productCount) || 0)),
            filterKeyword: String(col?.filterKeyword || '').trim().slice(0, 100),
            shopeeUrl: sanitizeBannerUrlMjs(col?.shopeeUrl),
          }
        })
        .filter(Boolean)
    : []

  return {
    enabled: b.enabled !== false,
    shopLogoUrl,
    coverBannerUrl,
    mobileCoverBannerUrl,
    carouselBanners,
    spotlightBanners,
    collectionBanners,
    sourceShopId: String(b.sourceShopId || '').replace(/[^\d]/g, ''),
    sourceShopUsername: String(b.sourceShopUsername || '').trim().slice(0, 64),
    sourceDraftId: String(b.sourceDraftId || '').trim().slice(0, 64),
    syncedAt: typeof b.syncedAt === 'string' ? b.syncedAt : null,
  }
}

async function buildCmsStorefrontSnapshot() {
  const prisma = getPrisma()
  const [webCred, shopeeCred, settingsRows, categories, webChannel, rawProducts] =
    await Promise.all([
      prisma.integrationCredential.findUnique({ where: { provider: 'WEBSITE' } }),
      prisma.integrationCredential.findUnique({ where: { provider: 'SHOPEE' } }),
      prisma.appSetting.findMany({
        where: {
          key: {
            in: [
              'brand_name',
              'brand_short_name',
              'brand_badge',
              'brand_subtitle',
              'brand_footer_tagline',
              'shop_default_workshop',
              'shop_storefront_url',
              'company_name',
              'company_phone',
              'company_address',
              'invoice_bank_code',
              'invoice_bank_name',
              'invoice_bank_account',
              'invoice_bank_holder',
            ],
          },
        },
      }),
      prisma.category.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      }),
      prisma.channel.findUnique({ where: { key: 'WEBSITE' }, select: { id: true } }),
      prisma.product.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ sellPrice: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          categoryId: true,
          sellPrice: true,
          stock: true,
          unit: true,
          type: true,
          fragile: true,
          image: true,
          attributes: true,
          category: { select: { id: true, name: true, slug: true } },
          listings: {
            select: { channelId: true, price: true, status: true, description: true },
          },
        },
      }),
    ])

  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]))
  let webCfgObj = {}
  try {
    webCfgObj = JSON.parse(webCred?.config || '{}')
  } catch {
    webCfgObj = {}
  }

  let shopeeShopId = ''
  let shopeeUsername = ''
  try {
    const sObj = JSON.parse(shopeeCred?.config || '{}')
    const rawSid = sObj?.__vault_v1?.shopId ?? sObj?.shopId ?? ''
    if (rawSid && /^\d+$/.test(String(rawSid).trim())) {
      shopeeShopId = String(rawSid).trim()
    }
    if (sObj?.__vault_v1?.username) shopeeUsername = String(sObj.__vault_v1.username).trim()
    else if (sObj?.username && sObj.username !== 'thaimy1605') {
      shopeeUsername = String(sObj.username).trim()
    } else if (shopeeShopId === '197195817') {
      shopeeUsername = 'bomocdecor'
    }
  } catch {
    // ignore
  }

  const savedSf = webCfgObj.__storefront_v1 || webCfgObj.storefrontConfigV1 || {}
  const customDomain = (
    parseArg('domain') ||
    savedSf.customDomain ||
    'bomocdecor.vn'
  )
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()

  const cmsBackendOrigin = (
    parseArg('backend') ||
    savedSf.cmsBackendOrigin ||
    process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL ||
    'https://openvn-cms-pos-backend.onrender.com'
  ).replace(/\/+$/, '')

  const wholesaleTiers =
    Array.isArray(savedSf.wholesaleTiers) && savedSf.wholesaleTiers.length > 0
      ? savedSf.wholesaleTiers
      : [
          {
            id: 'tier_10',
            minQty: 10,
            discountPercent: 15,
            label: 'Sỉ Khởi Nghiệp (Từ 10 SP)',
            badge: '-15%',
            description: 'Áp dụng đơn gộp từ 10 sản phẩm bất kỳ · Hỗ trợ Shop Decor, Phòng trà, Homestay.',
          },
          {
            id: 'tier_30',
            minQty: 30,
            discountPercent: 25,
            label: 'Sỉ Đại Lý / Spa (Từ 30 SP)',
            badge: '-25%',
            description: 'Chiết khấu sâu 25% tại xưởng · Hỗ trợ hình ảnh/video gốc & ưu tiên xuất kho.',
          },
          {
            id: 'tier_100',
            minQty: 100,
            discountPercent: 35,
            label: 'Nhà Phân Phối / Quà Tặng DN (100+ SP)',
            badge: '-35%',
            description: 'Giá xuất xưởng tốt nhất · Hỗ trợ phối màu riêng & in/khắc logo hộp quà doanh nghiệp (OEM).',
          },
        ]

  const rawCompanyPhone = String(settings.company_phone || '').trim()
  const companyHasSamplePhone = isPlaceholderPhoneMjs(rawCompanyPhone)
  const effectiveCompanyPhone = rawCompanyPhone && !companyHasSamplePhone ? rawCompanyPhone : ''
  const effectiveCompanyDigits = effectiveCompanyPhone.replace(/\D/g, '')

  const rawSavedHotline = String(savedSf.contact?.hotline || '').trim()
  const rawSavedZaloPhone = String(savedSf.contact?.zaloPhone || '').trim()
  const rawSavedZaloUrl = String(savedSf.contact?.zaloUrl || '').trim()
  const rawSavedEmail = String(savedSf.contact?.email || '').trim()

  const resolvedHotline =
    !companyHasSamplePhone && isPlaceholderPhoneMjs(rawSavedHotline)
      ? effectiveCompanyPhone
      : rawSavedHotline || effectiveCompanyPhone
  const resolvedZaloPhone =
    !companyHasSamplePhone && isPlaceholderPhoneMjs(rawSavedZaloPhone)
      ? effectiveCompanyDigits
      : rawSavedZaloPhone || resolvedHotline.replace(/\D/g, '')
  const resolvedZaloUrl =
    !companyHasSamplePhone && isPlaceholderPhoneMjs(rawSavedZaloUrl)
      ? effectiveCompanyDigits
        ? `https://zalo.me/${effectiveCompanyDigits}`
        : ''
      : rawSavedZaloUrl || (resolvedZaloPhone ? `https://zalo.me/${resolvedZaloPhone}` : '')
  const resolvedEmail =
    !companyHasSamplePhone && isPlaceholderEmailMjs(rawSavedEmail) ? '' : rawSavedEmail

  const contact = {
    hotline: resolvedHotline,
    zaloPhone: resolvedZaloPhone,
    zaloUrl: resolvedZaloUrl,
    email: resolvedEmail,
    address:
      savedSf.contact?.address ||
      settings.company_address ||
      'Xưởng Đúc Thủ Công & Showroom Chính Hãng — TP. Hồ Chí Minh',
    workingHours: savedSf.contact?.workingHours || '08:30 – 21:00 (Thứ 2 – Chủ Nhật)',
    shopeeUrl: savedSf.contact?.shopeeUrl || (shopeeUsername ? `https://shopee.vn/${shopeeUsername}` : ''),
    facebookUrl: savedSf.contact?.facebookUrl || '',
    tiktokUrl: savedSf.contact?.tiktokUrl || '',
  }

  const rawBrandName = settings.brand_name?.trim() || 'Bơ Mộc Decor'
  const brandName = formatCustomerBrandNameMjs(rawBrandName, customDomain)
  const brandShortName = settings.brand_short_name?.trim() || 'BƠ MỘC'

  // Đồng bộ công thức cmsInstanceId với getStorefrontConfigForCurrentCms() để dùng chung bộ nhớ giỏ hàng
  const cmsInstanceId = `cms_${crypto
    .createHash('sha256')
    .update(`${webCred?.id || 'local-cms'}:${brandShortName}`)
    .digest('hex')
    .slice(0, 12)}`

  const allowPreorder = savedSf.allowPreorderWhenOutOfStock !== false
  const isEnabled = savedSf.enabled !== false
  const wholesaleEnabled = savedSf.wholesaleEnabled !== false

  const webChannelId = webChannel?.id || ''
  const products = !isEnabled
    ? []
    : rawProducts
        .filter((prod) => {
          if (!webChannelId) return true
          const wl = prod.listings.find((l) => l.channelId === webChannelId)
          return !wl || wl.status !== 'INACTIVE'
        })
        .map((prod) => {
          const wl = webChannelId
            ? prod.listings.find((l) => l.channelId === webChannelId)
            : null
          const retailPrice = wl?.price && wl.price > 0 ? wl.price : prod.sellPrice
          let shopeeItemId = null
          let parentSku = null
          let tierVariationName = null
          let weightGram = null
          let dimensionsLabel = null
          let daysToShip = null
          const rawImgCandidates = [prod.image]
          if (prod.attributes) {
            try {
              const attr = JSON.parse(prod.attributes)
              if (attr.shopeeItemId) shopeeItemId = String(attr.shopeeItemId).trim() || null
              if (attr.parentSku) parentSku = String(attr.parentSku).trim() || null
              if (attr.tierVariationName) {
                tierVariationName = String(attr.tierVariationName).trim() || null
              }
              const wNum = Number(attr.weightGram)
              if (Number.isFinite(wNum) && wNum > 0) weightGram = Math.round(wNum)
              if (attr.dimensionCm && typeof attr.dimensionCm === 'object') {
                const l = Number(attr.dimensionCm.length)
                const w = Number(attr.dimensionCm.width)
                const h = Number(attr.dimensionCm.height)
                if (l > 0 && w > 0 && h > 0) dimensionsLabel = `${l} × ${w} × ${h} cm`
              }
              if (attr.preOrderInfo && typeof attr.preOrderInfo === 'object') {
                const d = Number(attr.preOrderInfo.days_to_ship)
                if (Number.isFinite(d) && d > 0 && d <= 30) daysToShip = Math.round(d)
              }
              rawImgCandidates.push(attr.variantImage)
              if (Array.isArray(attr.gallery)) rawImgCandidates.push(...attr.gallery)
              if (Array.isArray(attr.images)) rawImgCandidates.push(...attr.images)
              rawImgCandidates.push(attr.coverImage)
              rawImgCandidates.push(attr.lastSyncedShopeeImage)
            } catch {
              // ignore
            }
          }
          const seenImgs = new Set()
          const images = []
          for (const u of rawImgCandidates) {
            if (typeof u !== 'string') continue
            const cleanU = u.trim()
            if (!cleanU || (!cleanU.startsWith('http://') && !cleanU.startsWith('https://') && !cleanU.startsWith('/'))) continue
            if (seenImgs.has(cleanU)) continue
            seenImgs.add(cleanU)
            images.push(cleanU)
            if (images.length >= 8) break
          }
          const { cleanTitle: rawClean, variantLabel } = splitTitle(prod.name)
          const cleanTitle = formatDisplayTitleMjs(rawClean, variantLabel) || rawClean
          const wholesalePrices = wholesaleEnabled
            ? wholesaleTiers.map((t) => ({
                tierId: t.id,
                minQty: t.minQty,
                label: t.label,
                badge: t.badge,
                discountPercent: t.discountPercent,
                unitPrice: computeWholesaleUnitPrice(retailPrice, t.discountPercent),
              }))
            : []
          const unitVal = prod.unit || 'sp'

          return {
            id: prod.id,
            sku: prod.sku,
            parentSku,
            tierVariationName,
            name: prod.name,
            cleanTitle,
            variantLabel,
            description: wl?.description || prod.description || '',
            categoryId: prod.categoryId,
            categoryName: prod.category?.name || 'Bộ sưu tập Thủ công',
            retailPrice,
            wholesalePrices,
            unit: unitVal,
            type: prod.type || 'SIMPLE',
            fragile: Boolean(prod.fragile),
            weightGram,
            dimensionsLabel,
            daysToShip,
            image: prod.image || images[0] || null,
            images,
            inStock: prod.stock > 0,
            availableToOrder: prod.stock > 0 || allowPreorder,
            stockLabel:
              prod.stock > 0
                ? `Sẵn hàng (${prod.stock} ${unitVal})`
                : allowPreorder
                  ? `Đặt chế tác tại xưởng (Giao ${daysToShip || 2} ngày)`
                  : 'Tạm hết hàng',
            shopeeUrl:
              shopeeItemId && shopeeShopId
                ? `https://shopee.vn/product/${shopeeShopId}/${shopeeItemId}`
                : contact.shopeeUrl,
          }
        })

  const savedBank =
    savedSf.bankTransfer &&
    typeof savedSf.bankTransfer === 'object' &&
    savedSf.bankTransfer.bankCode &&
    savedSf.bankTransfer.bankAccount
      ? {
          bankCode: String(savedSf.bankTransfer.bankCode).trim(),
          bankName:
            String(savedSf.bankTransfer.bankName || '').trim() ||
            String(savedSf.bankTransfer.bankCode).trim(),
          bankAccount: String(savedSf.bankTransfer.bankAccount).trim(),
          bankHolder: String(savedSf.bankTransfer.bankHolder || '').trim(),
        }
      : null

  const resolvedBankTransfer =
    savedBank ||
    (settings.invoice_bank_code && settings.invoice_bank_account
      ? {
          bankCode: settings.invoice_bank_code,
          bankName: settings.invoice_bank_name || settings.invoice_bank_code,
          bankAccount: settings.invoice_bank_account,
          bankHolder: settings.invoice_bank_holder || '',
        }
      : null)

  const heroBadgeText =
    savedSf.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc'
  const workshopName = settings.shop_default_workshop || 'Xưởng Đúc Thủ Công Bơ Mộc'
  const customerBrandSubtitle = resolveHeaderSubtitleMjs({
    brandSubtitle: settings.brand_subtitle,
    workshopName,
    heroBadge: heroBadgeText,
    brandName,
  })

  return {
    ok: true,
    storefrontClosed: !isEnabled,
    cmsInstanceId,
    generatedAt: new Date().toISOString(),
    brand: {
      brandName,
      brandShortName,
      brandBadge: settings.brand_badge || 'CRAFT',
      brandSubtitle: customerBrandSubtitle,
      footerTagline:
        settings.brand_footer_tagline ||
        'Xưởng Đúc Thạch Cao Thủ Công & Nến Bơ Thực Vật Thuần Chay · Sỉ & Lẻ Toàn Quốc',
      workshopName,
      companyName: formatCustomerBrandNameMjs(settings.company_name || brandName, customDomain),
    },
    config: {
      enabled: isEnabled,
      customDomain,
      additionalDomains: customDomain ? [`www.${customDomain}`] : [],
      cmsBackendOrigin,
      heroBadge: heroBadgeText,
      heroTitle:
        savedSf.heroTitle ||
        'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công Tinh Tế',
      heroSubtitle:
        savedSf.heroSubtitle ||
        'Chế tác tỉ mỉ từng khay, hũ nến thạch cao kháng dầu chịu nhiệt và nến bơ thực vật thuần chay không khói cho góc thiền, bàn trà, spa & quà tặng doanh nghiệp.',
      announcementBar:
        savedSf.announcementBar ||
        'Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000 ₫ · Chiết khấu Giá Sỉ tận xưởng từ 10 sản phẩm (-15% đến -35%)',
      wholesaleEnabled,
      wholesaleTiers,
      wholesalePolicyNote:
        savedSf.wholesalePolicyNote ||
        'Được gộp tự do nhiều mẫu/phân loại trong cùng đơn sỉ để đạt mốc số lượng 10 · 30 · 100 sản phẩm. Đóng gói chống sốc chuyên dụng bảo hành bể vỡ 1 đổi 1 toàn quốc.',
      oemCustomNote:
        savedSf.oemCustomNote ||
        'Nhận gia công OEM theo màu sắc riêng, đổ nến bơ/sáp thực vật theo mùi hương yêu cầu & thiết kế hộp quà tặng sự kiện, lễ Tết cho doanh nghiệp, spa, thiền viện.',
      freeShipThreshold:
        savedSf.freeShipThreshold !== undefined &&
        savedSf.freeShipThreshold !== null &&
        savedSf.freeShipThreshold !== '' &&
        Number.isFinite(Number(savedSf.freeShipThreshold)) &&
        Number(savedSf.freeShipThreshold) > 0
          ? Number(savedSf.freeShipThreshold)
          : 500_000,
      baseShippingFee:
        savedSf.baseShippingFee !== undefined &&
        savedSf.baseShippingFee !== null &&
        savedSf.baseShippingFee !== '' &&
        Number.isFinite(Number(savedSf.baseShippingFee)) &&
        Number(savedSf.baseShippingFee) >= 0
          ? Number(savedSf.baseShippingFee)
          : 30_000,
      returnDays:
        savedSf.returnDays !== undefined &&
        savedSf.returnDays !== null &&
        savedSf.returnDays !== '' &&
        Number.isFinite(Number(savedSf.returnDays)) &&
        Number(savedSf.returnDays) > 0
          ? Number(savedSf.returnDays)
          : 7,
      allowPreorderWhenOutOfStock: allowPreorder,
      contact,
      bankTransfer: savedBank,
      banners: normalizeSnapshotBanners(savedSf.banners, isEnabled),
    },
    bankTransfer: resolvedBankTransfer,
    categories,
    products,
    articles: [],
  }
}

const SVG_ICON_FLAME =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>'
const SVG_ICON_SPARKLES =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>'
const SVG_ICON_BADGE_PCT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m15 9-6 6"/><path d="M9 9h.01"/><path d="M15 15h.01"/></svg>'
const SVG_ICON_TRUCK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>'
const SVG_ICON_EYE_SM =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>'
const SVG_ICON_TRASH_SM =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>'

function formatHeroShortLabelMjs(cleanTitleOrName, maxChars = 26) {
  const limit = Math.max(12, Math.min(48, Math.floor(Number(maxChars) || 26)))
  const raw = String(cleanTitleOrName || '')
    .split('— Phân loại:')[0]
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .trim()
  if (!raw) return 'Sản phẩm tiêu biểu'
  const firstPart = raw.split(/\s+[-–—|/]\s+|:\s+/)[0]?.trim() || raw
  const base = firstPart.length >= 6 ? firstPart : raw
  if (base.length <= limit) return base
  const stopRx = /^(có|không|trắng|kem|xanh|đen|vàng|cam|be|đựng|cúng|lót|cắm|đặt|xi|dùng|phối)$/i
  const danglingRx = /^(nắp|thạch|xi|màu|size|cỡ|dùng|đựng|cho|kèm|và|với|tặng|loại|mẫu|bộ|set)$/i
  const kept = []
  for (const w of base.split(/\s+/).filter(Boolean)) {
    const cw = w.replace(/[,.;:!?]+$/g, '')
    if (!cw) continue
    const curLen = kept.join(' ').length
    if (curLen >= 14 && stopRx.test(cw)) break
    const nextLen = curLen === 0 ? cw.length : curLen + 1 + cw.length
    if (kept.length >= 2 && nextLen > limit) break
    kept.push(cw)
    if (nextLen >= limit) break
  }
  while (kept.length > 2 && danglingRx.test(kept[kept.length - 1])) {
    kept.pop()
  }
  return kept.length >= 2 ? kept.join(' ') : base.slice(0, limit).trim()
}

function formatWholesaleSummaryMjs(tiers, oemCustomNote) {
  const oemText = typeof oemCustomNote === 'string' ? oemCustomNote.trim() : ''
  const hasOem = typeof oemCustomNote === 'boolean' ? oemCustomNote : oemText.length > 0
  const mentionsGiftBox =
    typeof oemCustomNote === 'boolean'
      ? oemCustomNote
      : /hộp quà|khắc|in logo|oem/i.test(oemText)
  const oemSuffix = !hasOem
    ? '.'
    : mentionsGiftBox
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
  if (!sorted.length) return 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ.'
  const parts = sorted.map(
    (t) => `Từ ${Math.floor(t.minQty)} SP giảm ${Math.round(t.discountPercent * 10) / 10}%`
  )
  return `${parts.join(' · ')}${oemSuffix}`
}

function resolveHeroCopyMjs(ctx) {
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
  const isCandleAtelier =
    dom.startsWith('bomoc') || /nến\s*bơ|sáp\s*bơ|thạch\s*cao|bơ\s*mộc|tealight/i.test(corpus)
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
    (rawAnnounce.startsWith('Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000') &&
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
  if (isCandleAtelier) {
    return {
      isCandleAtelier: true,
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
    isCandleAtelier: false,
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

function resolveHeroStageMjs(opts) {
  if (opts.isClosed) {
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
  const coverUrl = opts.showBanners ? String(opts.banners?.coverBannerUrl || '').trim() : ''
  if (coverUrl) {
    return {
      hasStageImage: true,
      imageUrl: coverUrl,
      mobileImageUrl: String(opts.banners?.mobileCoverBannerUrl || '').trim(),
      alt: `${opts.brandName} — Không gian trưng bày chính thức`,
      isProductFallback: false,
      stageProduct: null,
      stripProducts: opts.showcaseProducts,
    }
  }
  const firstCar = opts.showBanners ? opts.banners?.carouselBanners?.[0] : null
  const carUrl = firstCar ? String(firstCar.imageUrl || '').trim() : ''
  if (carUrl) {
    return {
      hasStageImage: true,
      imageUrl: carUrl,
      mobileImageUrl: String(firstCar.mobileImageUrl || '').trim(),
      alt: firstCar.title || `${opts.brandName} — Bộ sưu tập nổi bật`,
      isProductFallback: false,
      stageProduct: null,
      stripProducts: opts.showcaseProducts,
    }
  }
  const lead = opts.showcaseProducts[0] || null
  const leadImg = lead && typeof lead.image === 'string' ? lead.image.trim() : ''
  if (lead && leadImg) {
    return {
      hasStageImage: true,
      imageUrl: leadImg,
      mobileImageUrl: '',
      alt: lead.cleanTitle || lead.name,
      isProductFallback: true,
      stageProduct: lead,
      stripProducts: opts.showcaseProducts.length >= 2 ? opts.showcaseProducts : [],
    }
  }
  return {
    hasStageImage: false,
    imageUrl: '',
    mobileImageUrl: '',
    alt: '',
    isProductFallback: false,
    stageProduct: null,
    stripProducts: opts.showcaseProducts,
  }
}

function selectHeroProductsMjs(products, maxItems = 3) {
  if (!Array.isArray(products) || maxItems <= 0) return []
  const withImg = products.filter((p) => Boolean(p && typeof p.image === 'string' && p.image.trim()))
  if (!withImg.length) return []
  const orderable = withImg.filter((p) => p.availableToOrder !== false)
  const pool = orderable.length ? orderable : withImg

  const byTitle = new Map()
  for (const prod of pool) {
    const key = String(prod.cleanTitle || prod.name || prod.sku)
      .split('— Phân loại:')[0]
      .trim()
      .toLowerCase()
    const prev = byTitle.get(key)
    if (!prev || (!prev.inStock && Boolean(prod.inStock))) {
      byTitle.set(key, prod)
    }
  }
  const distinct = Array.from(byTitle.values())
  const selected = []
  const used = new Set()
  const familyChecks = [
    (lead) => lead.startsWith('hũ ') || lead.startsWith('cốc '),
    (lead) => lead.startsWith('nến ') || lead.includes('nến bơ') || lead.includes('tealight'),
    (lead) => lead.startsWith('khay ') || lead.includes('đế nến') || lead.includes('chân nến'),
  ]
  for (const fn of familyChecks) {
    if (selected.length >= maxItems) break
    const hit = distinct.find(
      (p) => !used.has(p.id) && fn(String(p.cleanTitle || p.name || '').trim().slice(0, 32).toLowerCase())
    )
    if (hit) {
      selected.push(hit)
      used.add(hit.id)
    }
  }
  for (const p of distinct) {
    if (selected.length >= maxItems) break
    if (!used.has(p.id)) {
      selected.push(p)
      used.add(p.id)
    }
  }
  for (const p of pool) {
    if (selected.length >= maxItems) break
    if (!used.has(p.id)) {
      selected.push(p)
      used.add(p.id)
    }
  }
  return selected
}

export function generateStandaloneStorefrontHtml(snapshot) {
  const cleanedBrandStr = formatCustomerBrandNameMjs(
    snapshot.brand?.brandName,
    snapshot.config?.customDomain
  )
  const brandName = escapeHtml(cleanedBrandStr)
  const headerSub = escapeHtml(
    resolveHeaderSubtitleMjs({
      brandSubtitle: snapshot.brand?.brandSubtitle,
      workshopName: snapshot.brand?.workshopName,
      heroBadge: snapshot.config?.heroBadge,
      brandName: cleanedBrandStr,
    })
  )
  const rawShort = String(snapshot.brand?.brandShortName || cleanedBrandStr || 'BM')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .trim()
  const shortWords = rawShort.split(/[^A-Z0-9]+/).filter(Boolean)
  const logoInitials = escapeHtml(
    shortWords.length >= 2
      ? shortWords
          .slice(0, 2)
          .map((w) => w[0])
          .join('')
      : (shortWords[0] || 'BM').slice(0, 2)
  )
  const domain = escapeHtml(snapshot.config.customDomain)
  const heroTitle = escapeHtml(snapshot.config.heroTitle)
  const heroSub = escapeHtml(snapshot.config.heroSubtitle)
  const shopLogoUrl = escapeHtml(snapshot.config.banners?.shopLogoUrl || '')
  const ogBannerImg = escapeHtml(
    snapshot.config.banners?.coverBannerUrl ||
      snapshot.config.banners?.carouselBanners?.[0]?.imageUrl ||
      snapshot.products[0]?.image ||
      ''
  )

  const sanitizedBootstrapSnapshot = {
    ...snapshot,
    brand: {
      ...snapshot.brand,
      brandName: cleanedBrandStr,
      brandSubtitle: resolveHeaderSubtitleMjs({
        brandSubtitle: snapshot.brand?.brandSubtitle,
        workshopName: snapshot.brand?.workshopName,
        heroBadge: snapshot.config?.heroBadge,
        brandName: cleanedBrandStr,
      }),
    },
    products: (snapshot.products || []).map((p) => ({
      ...p,
      cleanTitle: formatDisplayTitleMjs(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle || p.name,
    })),
  }
  const jsonBootstrap = JSON.stringify(sanitizedBootstrapSnapshot).replace(/<\//g, '<\\/')
  const tiers = snapshot.config.wholesaleTiers || []
  const wsRangeLabel =
    tiers.length >= 2
      ? `(${escapeHtml(tiers[0].badge)} → ${escapeHtml(tiers[tiers.length - 1].badge)})`
      : tiers.length === 1
        ? `(${escapeHtml(tiers[0].badge)})`
        : ''
  const isClosedInit = Boolean(snapshot.storefrontClosed || snapshot.config.enabled === false)
  const wsAllowedInit = !isClosedInit && snapshot.config.wholesaleEnabled !== false
  const minWsQtyInit =
    tiers.length > 0
      ? Math.min(...tiers.map((t) => Math.max(1, Math.floor(Number(t.minQty) || 10))))
      : 10
  const freeShipInitFmt = `${Math.max(0, Math.round(Number(snapshot.config.freeShipThreshold) || 500_000)).toLocaleString('vi-VN')} ₫`
  const wsSummaryInit = escapeHtml(formatWholesaleSummaryMjs(tiers, snapshot.config.oemCustomNote))
  const heroCopyInit = resolveHeroCopyMjs({
    brandName: cleanedBrandStr,
    workshopName: snapshot.brand.workshopName,
    customDomain: snapshot.config.customDomain,
    heroBadge: snapshot.config.heroBadge,
    heroTitle: snapshot.config.heroTitle,
    heroSubtitle: snapshot.config.heroSubtitle,
    announcementBar: snapshot.config.announcementBar,
    returnDays: snapshot.config.returnDays,
    freeShipFormatted: freeShipInitFmt,
    minWholesaleQty: minWsQtyInit,
    isWholesaleAllowed: wsAllowedInit,
    isStorefrontClosed: isClosedInit,
    totalProductsCount: (snapshot.products || []).length,
    sampleTexts: (snapshot.products || []).slice(0, 6).map((p) => p.cleanTitle || p.name),
  })
  const showBannersInit = Boolean(!isClosedInit && snapshot.config.banners?.enabled !== false)
  const heroShowcaseInit = isClosedInit
    ? []
    : selectHeroProductsMjs(sanitizedBootstrapSnapshot.products || [], 3)
  const heroStageInit = resolveHeroStageMjs({
    isClosed: isClosedInit,
    showBanners: showBannersInit,
    brandName: cleanedBrandStr || 'Cửa hàng',
    banners: snapshot.config.banners,
    showcaseProducts: heroShowcaseInit,
  })
  const hasHeroVisualInit =
    heroStageInit.hasStageImage || heroStageInit.stripProducts.length > 0
  const stageCaptionHtml =
    heroStageInit.isProductFallback && heroStageInit.stageProduct
      ? `<span class="hero-stage-caption fallback"><span class="hero-stage-cap-name">${escapeHtml(
          formatHeroShortLabelMjs(
            heroStageInit.stageProduct.cleanTitle || heroStageInit.stageProduct.name,
            36
          )
        )}</span><span class="hero-stage-cap-price">${Math.max(
          0,
          Math.round(Number(heroStageInit.stageProduct.retailPrice) || 0)
        ).toLocaleString('vi-VN')} ₫ · Xem →</span></span>`
      : `<span class="hero-stage-caption">Khám phá bộ sưu tập ›</span>`
  const heroCoverMediaHtml = heroStageInit.hasStageImage
    ? `<button type="button" class="hero-cover-media" onclick="onHeroStageClick()" aria-label="${escapeHtml(heroStageInit.alt)}"><picture>${
        heroStageInit.mobileImageUrl
          ? `<source media="(max-width: 640px)" srcset="${escapeHtml(heroStageInit.mobileImageUrl)}" />`
          : ''
      }<img src="${escapeHtml(heroStageInit.imageUrl)}" alt="${escapeHtml(heroStageInit.alt)}" referrerpolicy="no-referrer" /></picture>${stageCaptionHtml}</button>`
    : ''
  const stripColsInit = Math.min(3, Math.max(1, heroStageInit.stripProducts.length || 3))
  const heroFeaturedStripHtml =
    heroStageInit.stripProducts.length > 0
      ? `<div class="hero-featured-strip${heroStageInit.hasStageImage ? ' with-cover' : ''}">` +
        `<div class="hero-featured-head"><span id="heroShowcaseHeading">${escapeHtml(heroCopyInit.showcaseHeading)}</span><button type="button" class="hero-featured-more" onclick="scrollToCatalog()">${escapeHtml(heroCopyInit.showcaseActionLabel)}</button></div>` +
        `<div class="hero-featured-grid cols-${stripColsInit}">` +
        heroStageInit.stripProducts
          .map(
            (item, idx) =>
              `<button type="button" class="hero-mini-item" onclick="openHeroShowcaseIdx(${idx})">` +
              (item.image
                ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.cleanTitle || item.name)}" referrerpolicy="no-referrer" loading="lazy" />`
                : '') +
              `<div class="hero-mini-meta"><div class="hero-mini-name">${escapeHtml(formatHeroShortLabelMjs(item.cleanTitle || item.name))}</div><div class="hero-mini-price">${Math.max(0, Math.round(Number(item.retailPrice) || 0)).toLocaleString('vi-VN')} ₫</div></div>` +
              `</button>`
          )
          .join('') +
        `</div></div>`
      : ''

  const sameAsLinks = [
    snapshot.config.contact?.shopeeUrl,
    snapshot.config.contact?.facebookUrl,
    snapshot.config.contact?.tiktokUrl,
  ].filter((u) => typeof u === 'string' && u.startsWith('https://'))

  const productListElements =
    !snapshot.storefrontClosed && Array.isArray(sanitizedBootstrapSnapshot.products)
      ? sanitizedBootstrapSnapshot.products.slice(0, 30).map((p, idx) => {
          const cleanLdDesc = String(p.description || p.cleanTitle || p.name)
            .split('\n')
            .filter((ln) => !/^#[A-Za-z0-9_\u00C0-\u024F]+/.test(ln.trim()))
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 280)
          const ldImages =
            Array.isArray(p.images) && p.images.length > 0
              ? p.images
              : p.image
                ? [p.image]
                : undefined
          return {
            '@type': 'ListItem',
            position: idx + 1,
            item: {
              '@type': 'Product',
              sku: p.sku,
              name: p.cleanTitle || p.name,
              description: cleanLdDesc,
              ...(ldImages ? { image: ldImages } : {}),
              offers: {
                '@type': 'Offer',
                priceCurrency: 'VND',
                price: Math.max(0, Math.round(Number(p.retailPrice) || 0)),
                availability:
                  p.availableToOrder !== false
                    ? 'https://schema.org/InStock'
                    : 'https://schema.org/OutOfStock',
                url: `https://${snapshot.config.customDomain}/?sku=${encodeURIComponent(p.sku)}`,
              },
            },
          }
        })
      : []

  const cleanHotlineLd = String(snapshot.config.contact?.hotline || '').trim()
  const cleanEmailLd = String(snapshot.config.contact?.email || '').trim()

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Store',
        name: cleanedBrandStr,
        url: `https://${snapshot.config.customDomain}/`,
        description: snapshot.config.heroSubtitle,
        ...(snapshot.config.banners?.shopLogoUrl
          ? { logo: snapshot.config.banners.shopLogoUrl }
          : {}),
        ...(ogBannerImg ? { image: ogBannerImg } : {}),
        ...(cleanHotlineLd ? { telephone: cleanHotlineLd } : {}),
        ...(cleanEmailLd ? { email: cleanEmailLd } : {}),
        address: {
          '@type': 'PostalAddress',
          streetAddress: snapshot.config.contact.address,
          addressCountry: 'VN',
        },
        ...(sameAsLinks.length > 0 ? { sameAs: sameAsLinks } : {}),
      },
      {
        '@type': 'WebSite',
        name: cleanedBrandStr,
        url: `https://${snapshot.config.customDomain}/`,
        inLanguage: 'vi-VN',
        potentialAction: {
          '@type': 'SearchAction',
          target: `https://${snapshot.config.customDomain}/?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      ...(productListElements.length > 0
        ? [
            {
              '@type': 'ItemList',
              name: `Danh mục sản phẩm ${cleanedBrandStr}`,
              numberOfItems: productListElements.length,
              itemListElement: productListElements,
            },
          ]
        : []),
    ],
  }).replace(/<\//g, '<\\/')

  const footerHotlineHtml = cleanHotlineLd
    ? `<p id="footerHotline">Hotline / Zalo: ${escapeHtml(cleanHotlineLd)}</p>`
    : `<p id="footerHotline"><button type="button" class="link-btn" onclick="switchTab('CONTACT')">Nhắn tin tư vấn trực tuyến 24/7 →</button></p>`

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${brandName} — Sản phẩm Thủ công, Bảng Giá Sỉ &amp; Liên hệ Chính thức (${domain})</title>
  <meta name="description" content="${heroSub}" />
  <link rel="canonical" href="https://${domain}/" />
  ${shopLogoUrl ? `<link rel="icon" href="${shopLogoUrl}" />` : ''}
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="vi_VN" />
  <meta property="og:site_name" content="${brandName}" />
  <meta property="og:title" content="${brandName} — ${heroTitle}" />
  <meta property="og:description" content="${heroSub}" />
  <meta property="og:url" content="https://${domain}/" />
  ${ogBannerImg ? `<meta property="og:image" content="${ogBannerImg}" />` : ''}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${brandName} — ${heroTitle}" />
  <meta name="twitter:description" content="${heroSub}" />
  ${ogBannerImg ? `<meta name="twitter:image" content="${ogBannerImg}" />` : ''}
  <script type="application/ld+json">${structuredData}</script>
  <style>
    :root {
      --bg: #faf8f5;
      --card: #ffffff;
      --text: #1c1917;
      --muted: #57534e;
      --line: #e5ded5;
      --brand: #8c4f1e;
      --brand-dark: #6f3d15;
      --brand-soft: #fdf4eb;
      --accent: #8c4f1e;
      --accent-dark: #6f3d15;
      --ok: #0f766e;
      --ok-soft: #ecfdf5;
      --radius: 16px;
      --shadow: 0 8px 24px rgba(28, 25, 23, 0.06);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    body.has-mobile-bar { padding-bottom: 86px; }
    @media (min-width: 641px) { body.has-mobile-bar { padding-bottom: 0; } }
    a { color: inherit; text-decoration: none; }
    button, input, select, textarea { font: inherit; }
    a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
    }
    .money, td.num, th.num, .retail-price, .hero-mini-price, .hero-stage-cap-price {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .container { max-width: 1280px; margin: 0 auto; padding: 0 24px; }
    @media (max-width: 640px) { .container { padding: 0 14px; } }
    .topbar {
      background: linear-gradient(90deg, #fef3c7, #f5f5f4, #d1fae5);
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      padding: 6px 12px;
      color: #292524;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 40;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
    }
    .nav-wrap {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 4px 10px;
      padding: 5px 0;
    }
    @media (min-width: 641px) {
      .nav-wrap { padding: 10px 0; gap: 10px 14px; }
    }
    .brand-box {
      order: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      cursor: pointer;
      min-width: 0;
      border: none;
      background: transparent;
      text-align: left;
      padding: 1px 0;
    }
    .brand-box > span.brand-meta { min-width: 0; display: block; }
    .brand-logo {
      width: 38px; height: 38px; border-radius: 12px;
      background: linear-gradient(135deg, #8c4f1e, #3f2e21);
      color: #fff; font-weight: 800; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(140, 79, 30, 0.22);
      flex-shrink: 0;
    }
    .brand-logo-img {
      width: 38px; height: 38px; border-radius: 50%; object-fit: cover;
      border: 1px solid var(--line); box-shadow: 0 2px 8px rgba(0,0,0,0.08); flex-shrink: 0;
      display: block;
    }
    @media (max-width: 640px) {
      .brand-box { flex: 1; }
      .brand-logo, .brand-logo-img { width: 32px; height: 32px; font-size: 13px; }
      header .domain-pill, header .brand-sub { display: none !important; }
    }
    .brand-title {
      font-size: 17px; font-weight: 800; letter-spacing: -0.02em;
      display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; color: var(--text);
    }
    @media (max-width: 640px) {
      .brand-title { font-size: 15.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }
    .domain-pill {
      font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
      background: var(--brand-soft); color: var(--brand-dark); border: 1px solid #f0d5b8;
    }
    .closed-store-panel {
      grid-column: 1 / -1; text-align: center; padding: 42px;
      border-color: #f0d5b8; background: #fffbf5; color: var(--fg);
    }
    .brand-sub { font-size: 11.5px; color: var(--muted); display: block; }
    .header-actions { order: 2; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .nav-tabs {
      order: 3;
      width: 100%;
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: 4px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      padding-bottom: 0;
    }
    .nav-tabs::-webkit-scrollbar { display: none; }
    @media (min-width: 641px) {
      .nav-tabs { order: 2; width: auto; flex-wrap: wrap; overflow-x: visible; gap: 6px; padding-bottom: 0; }
      .header-actions { order: 3; }
    }
    .tab-btn {
      min-height: 34px; padding: 0 11px; border-radius: 10px; border: 1px solid transparent;
      background: transparent; color: var(--text); font-size: 12.5px; font-weight: 650;
      cursor: pointer; transition: all 0.16s ease; display: inline-flex; align-items: center; gap: 6px;
      white-space: nowrap; flex-shrink: 0;
    }
    @media (min-width: 641px) {
      .tab-btn { min-height: 38px; padding: 0 13px; font-size: 13px; }
    }
    .tab-btn:hover { background: #f3efe9; }
    .tab-btn.active { background: #1c1917; color: #fff; }
    .tab-btn.wholesale.active { background: var(--brand); color: #fff; }
    .cart-btn {
      min-height: 34px; padding: 0 12px; border-radius: 10px; border: none;
      background: var(--accent); color: #fff; font-size: 12.5px; font-weight: 700;
      cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    @media (min-width: 641px) {
      .cart-btn { min-height: 40px; padding: 0 15px; font-size: 13px; border-radius: 11px; }
    }
    .cart-btn:hover { background: var(--accent-dark); }
    .hero {
      padding: 32px 0 26px;
      background:
        radial-gradient(circle at 0% 0%, rgba(245, 213, 172, 0.3), transparent 48%),
        radial-gradient(circle at 100% 100%, rgba(167, 214, 193, 0.22), transparent 46%),
        linear-gradient(135deg, #fbf9f5 0%, #f7f1e7 52%, #f2f6f3 100%);
      border-bottom: 1px solid #e5ddd1;
    }
    @media (max-width: 640px) { .hero { padding: 16px 0 14px; } }
    .hero-grid {
      display: grid; gap: 32px; grid-template-columns: minmax(0, 1.12fr) minmax(0, 1fr); align-items: center;
    }
    .hero-grid > * { min-width: 0; }
    .hero-grid.single { grid-template-columns: minmax(0, 1fr); max-width: 760px; }
    @media (max-width: 960px) { .hero-grid { grid-template-columns: minmax(0, 1fr); gap: 18px; } }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 7px; max-width: 100%;
      padding: 5px 13px; border-radius: 999px; background: rgba(255,255,255,0.92);
      border: 1px solid #e4cbb0; color: #783f12; font-size: 12px; font-weight: 700;
      box-shadow: 0 2px 8px rgba(140, 79, 30, 0.06); margin-bottom: 11px;
    }
    .hero-badge svg { flex-shrink: 0; color: #8c4f1e; }
    .hero-badge span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .hero h1 {
      font-size: clamp(23px, 3vw, 38px); font-weight: 850; line-height: 1.18;
      letter-spacing: -0.022em; margin-bottom: 10px; color: #1c1917;
    }
    .hero-sub { color: #57534e; font-size: 15px; line-height: 1.62; max-width: 580px; margin-bottom: 14px; }
    @media (max-width: 640px) { .hero-sub { font-size: 13.5px; line-height: 1.54; margin-bottom: 10px; } }
    .hero-highlights {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px 13px;
      margin-bottom: 15px; font-size: 12px; font-weight: 650; color: #3f3a36;
    }
    @media (max-width: 640px) { .hero-highlights { margin-bottom: 12px; gap: 4px 10px; } }
    .hero-hl-item { display: inline-flex; align-items: center; gap: 5px; }
    .hero-hl-item svg { flex-shrink: 0; }
    .hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .btn-primary {
      min-height: 42px; padding: 0 16px; border-radius: 12px; border: none; max-width: 100%;
      background: #1c1917; color: #fff; font-weight: 750; font-size: 12.5px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      box-shadow: 0 8px 20px -8px rgba(28, 25, 23, 0.32); transition: background 0.18s ease, transform 0.18s ease;
    }
    .btn-primary:hover { background: var(--brand); transform: translateY(-1px); }
    .btn-ws {
      min-height: 42px; padding: 0 15px; border-radius: 12px; max-width: 100%;
      border: 1.5px solid #d59b62; background: #fff8ee; color: #6f3d15;
      font-weight: 750; font-size: 12.5px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
    }
    .btn-ws > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .btn-ws:hover { background: #fdefdc; border-color: #c28144; transform: translateY(-1px); }
    .btn-outline {
      min-height: 42px; padding: 0 14px; border-radius: 12px; max-width: 100%;
      border: 1px solid #dfd7cc; background: rgba(255,255,255,0.92); color: #292524;
      font-weight: 650; font-size: 12.5px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
      transition: background 0.18s ease, border-color 0.18s ease;
    }
    .btn-outline:hover { background: #fff; border-color: #c8bdb0; }
    .w-full { width: 100%; }
    .hero-showcase-card {
      border-radius: 20px; padding: 10px; border: 1px solid #e5ddd1;
      background: rgba(255, 255, 255, 0.92);
      box-shadow: 0 20px 44px -20px rgba(45, 33, 20, 0.18), 0 2px 8px rgba(28, 25, 23, 0.04);
    }
    .hero-cover-media {
      position: relative; display: block; width: 100%; padding: 0; text-align: left; cursor: pointer;
      border-radius: 14px; overflow: hidden; border: 1px solid rgba(28, 25, 23, 0.07);
      background: #efeae2;
    }
    .hero-cover-media img {
      width: 100%; aspect-ratio: 1196 / 518; object-fit: cover; display: block;
      transition: transform 0.45s ease;
    }
    .hero-cover-media:hover img { transform: scale(1.018); }
    .hero-stage-caption {
      position: absolute; right: 10px; bottom: 10px; padding: 4px 10px; border-radius: 999px;
      background: rgba(28, 25, 23, 0.76); color: #fff; font-size: 10.5px; font-weight: 700;
      backdrop-filter: blur(4px); pointer-events: none; transition: background 0.18s ease;
    }
    .hero-cover-media:hover .hero-stage-caption { background: #6f3d15; }
    .hero-stage-caption.fallback {
      left: 10px; border-radius: 11px; padding: 6px 12px;
      display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11.5px;
    }
    .hero-stage-cap-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; }
    .hero-stage-cap-price { flex-shrink: 0; color: #fcd34d; font-weight: 800; }
    .hero-featured-strip.with-cover { margin-top: 8px; }
    .hero-featured-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 0 3px 4px; font-size: 11.5px; color: var(--muted);
    }
    .hero-featured-head span { font-weight: 750; color: #3f3a36; }
    .hero-featured-more {
      border: none; background: transparent; min-height: 32px; padding: 4px 8px; border-radius: 8px;
      font-size: 11.5px; font-weight: 700; color: #8c4f1e; cursor: pointer;
      display: inline-flex; align-items: center;
    }
    .hero-featured-more:hover { text-decoration: underline; background: #fbf4eb; color: #693811; }
    .hero-featured-grid {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
    }
    .hero-featured-grid.cols-1 { grid-template-columns: minmax(0, 1fr); }
    .hero-featured-grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hero-featured-grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .hero-mini-item {
      min-height: 54px; padding: 6px 8px; border-radius: 12px;
      border: 1px solid #e8e0d5; background: #faf8f4; text-align: left; cursor: pointer;
      display: flex; align-items: center; gap: 7px; transition: all 0.18s ease;
    }
    .hero-mini-item:hover {
      background: #fff; border-color: #d59b62; transform: translateY(-1px);
      box-shadow: 0 6px 14px rgba(28, 25, 23, 0.06);
    }
    .hero-mini-item img {
      width: 40px; height: 40px; border-radius: 8px; object-fit: cover;
      flex-shrink: 0; border: 1px solid rgba(28, 25, 23, 0.07);
    }
    .hero-mini-meta { min-width: 0; flex: 1; }
    .hero-mini-name {
      font-size: 11px; font-weight: 750; color: #1c1917; line-height: 1.24;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      overflow: hidden; white-space: normal;
    }
    .hero-mini-price { font-size: 11px; font-weight: 800; color: #8c4f1e; margin-top: 2px; }
    @media (max-width: 420px) {
      .hero-featured-grid.cols-3 { gap: 5px; }
      .hero-mini-item { padding: 5px; gap: 5px; }
      .hero-mini-item img { width: 32px; height: 32px; }
      .hero-mini-name { font-size: 10px; }
      .hero-mini-price { font-size: 10px; }
    }
    .hero-promise-grid {
      margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(214, 203, 188, 0.78);
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px;
    }
    @media (max-width: 860px) {
      .hero-promise-grid { grid-template-columns: 1fr; gap: 8px; margin-top: 14px; padding-top: 12px; }
    }
    .promise-card {
      background: rgba(255, 255, 255, 0.84); border: 1px solid #e6ddd0;
      border-radius: 14px; padding: 12px 14px; display: flex; gap: 10px; align-items: flex-start;
      transition: background 0.18s ease, border-color 0.18s ease;
    }
    @media (max-width: 640px) {
      .promise-card { padding: 9px 11px; }
      .promise-card p { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
    }
    .promise-card:hover { background: rgba(255, 255, 255, 0.96); border-color: #dacbb8; }
    .promise-icon {
      width: 34px; height: 34px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .promise-icon.craft { background: #fbf0df; color: #8c4f1e; }
    .promise-icon.ws { background: #e9f5ee; color: #1b6b50; }
    .promise-icon.safe { background: #edf3f8; color: #235784; }
    h2 { font-size: 18px; font-weight: 800; color: #1c1917; line-height: 1.3; }
    h3 { font-size: 14.5px; font-weight: 750; color: #1c1917; line-height: 1.35; }
    .promise-card h3 { font-size: 14.5px; margin-bottom: 2px; }
    .promise-card p { font-size: 12px; color: var(--muted); margin: 0; line-height: 1.48; }
    main { padding: 24px 0 48px; min-height: 60vh; scroll-margin-top: 94px; }
    .toolbar {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 14px; margin-bottom: 20px; box-shadow: var(--shadow);
      display: flex; flex-direction: column; gap: 12px;
    }
    .toolbar-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }
    .toolbar-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .search-wrap { position: relative; flex: 1; min-width: 220px; max-width: 440px; }
    .search-input {
      width: 100%; height: 42px;
      border: 1px solid var(--line); border-radius: 11px; padding: 0 38px 0 14px; background: #fff; font-size: 13.5px;
    }
    .search-clear {
      position: absolute; top: 50%; right: 5px; transform: translateY(-50%);
      width: 32px; height: 32px; border-radius: 8px; border: none; background: transparent;
      color: var(--muted); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font-weight: 700;
    }
    .search-clear:hover { background: #f3efe9; color: var(--text); }
    .cat-filter-row {
      display: none; flex-wrap: wrap; gap: 6px; border-top: 1px solid var(--line); padding-top: 10px;
    }
    .cat-filter-row.visible { display: flex; }
    .mode-switch {
      display: inline-flex; background: #f3efe9; padding: 4px; border-radius: 11px; border: 1px solid var(--line);
    }
    .mode-switch button {
      min-height: 34px; padding: 0 13px; border: none; border-radius: 8px;
      background: transparent; font-size: 12.5px; font-weight: 700; cursor: pointer; color: var(--muted);
    }
    .mode-switch button.active { background: #fff; color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .mode-switch button.ws-active { background: var(--brand); color: #fff; }
    .select-box { height: 40px; border-radius: 10px; border: 1px solid var(--line); padding: 0 12px; background: #fff; font-size: 12.5px; font-weight: 600; }
    .prod-grid {
      display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr));
    }
    .prod-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      overflow: hidden; display: flex; flex-direction: column; transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .prod-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
    .prod-img-wrap {
      position: relative; aspect-ratio: 1 / 1; width: 100%; border: none; padding: 0;
      background: #f3efe9; overflow: hidden; cursor: pointer; display: block; text-align: left;
    }
    .prod-img-wrap img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s ease; }
    .prod-card:hover .prod-img-wrap img { transform: scale(1.04); }
    .badge-var {
      position: absolute; top: 10px; left: 10px; background: rgba(28,25,23,0.86); color: #fff;
      font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
    }
    .badge-ws {
      position: absolute; top: 10px; right: 10px; background: #fbbf24; color: #1c1917;
      font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px;
      white-space: nowrap; font-variant-numeric: tabular-nums;
    }
    .prod-body { padding: 14px; display: flex; flex-direction: column; justify-content: space-between; flex: 1; gap: 12px; }
    .sku-line { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--muted); }
    .sku-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .stock-ok {
      color: var(--ok); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .prod-title {
      font-size: 14.5px; font-weight: 750; line-height: 1.36; margin-top: 4px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .prod-title-btn {
      border: none; background: transparent; padding: 0; text-align: left; cursor: pointer;
      color: inherit; font: inherit; display: inline;
    }
    .prod-title-btn:hover { color: var(--accent); }
    .prod-var-txt { font-size: 12px; color: var(--brand-dark); font-weight: 650; margin-top: 3px; }
    .price-area { border-top: 1px solid var(--line); padding-top: 10px; }
    .retail-price { font-size: 18px; font-weight: 850; color: var(--accent); }
    .ws-hint { font-size: 11.5px; color: var(--brand-dark); margin-top: 2px; }
    .ws-mini-table {
      background: var(--brand-soft); border: 1px solid #efd6b8; border-radius: 10px;
      padding: 8px 10px; font-size: 11.5px; display: grid; gap: 3px;
    }
    .ws-mini-row { display: flex; justify-content: space-between; gap: 8px; }
    .card-actions { display: grid; grid-template-columns: 1fr 1.45fr; gap: 7px; margin-top: 10px; }
    .btn-sm-out {
      min-height: 38px; border-radius: 10px; border: 1px solid var(--line); background: #fff;
      font-size: 12px; font-weight: 650; cursor: pointer; padding: 0 10px;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    }
    .btn-sm-out:hover { background: #faf6f1; border-color: #d6c8b8; }
    .btn-sm-buy {
      min-height: 38px; border-radius: 10px; border: none; background: #1c1917; color: #fff;
      font-size: 12px; font-weight: 750; cursor: pointer; padding: 0 12px;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    }
    .btn-sm-buy:hover { background: var(--accent); }
    .tier-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); margin-bottom: 22px; }
    .tier-card { background: var(--card); border: 1.5px solid var(--line); border-radius: var(--radius); padding: 18px; }
    .tier-card.featured { border-color: var(--brand); background: #fffbf5; }
    .two-col { display: grid; gap: 22px; grid-template-columns: 1.35fr 1fr; align-items: start; }
    @media (max-width: 960px) { .two-col { grid-template-columns: 1fr; } }
    .panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
    .panel-narrow { max-width: 560px; margin: 0 auto; }
    .panel h2 { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
    .panel p.desc { font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
    .ws-desktop-table { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
    .ws-mobile-cards { display: none; gap: 12px; }
    @media (max-width: 640px) {
      .ws-desktop-table { display: none; }
      .ws-mobile-cards { display: grid; }
      .panel { padding: 15px; }
    }
    .ws-m-card {
      border: 1px solid var(--line); border-radius: 14px; padding: 12px; background: #fff;
      display: grid; gap: 10px;
    }
    .ws-m-head { display: flex; align-items: flex-start; gap: 10px; }
    .ws-m-head img { width: 48px; height: 48px; border-radius: 10px; object-fit: cover; border: 1px solid var(--line); flex-shrink: 0; }
    .ws-m-tiers {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px;
      background: var(--brand-soft); border: 1px solid #efd6b8; border-radius: 10px; padding: 8px 6px; text-align: center;
    }
    .ws-m-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { padding: 10px 11px; border-bottom: 1px solid var(--line); text-align: left; }
    th { background: #f5f2ec; font-weight: 750; }
    td.num, th.num { text-align: right; }
    .ws-sim-box {
      background: var(--brand-soft); border: 1px solid #efd6b8; border-radius: 12px;
      padding: 10px 12px; font-size: 12px; margin-bottom: 12px;
    }
    .form-grid { display: grid; gap: 11px; grid-template-columns: 1fr 1fr; }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field.full { grid-column: 1 / -1; }
    .field label { font-size: 12px; font-weight: 700; color: var(--text); }
    .field input, .field textarea {
      border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font-size: 13.5px; background: #fff; color: var(--text);
    }
    .contact-item {
      border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; background: #fff;
    }
    .contact-item.highlight { background: var(--brand-soft); border-color: #efd6b8; }
    .contact-item small { display: block; font-size: 11.5px; color: var(--muted); }
    .contact-item strong, .contact-item a { font-size: 14px; font-weight: 750; color: var(--text); }
    .lk-output { margin-top: 14px; }
    .modal-backdrop {
      position: fixed; inset: 0; z-index: 85; background: rgba(15, 23, 42, 0.62);
      backdrop-filter: blur(3px);
      display: none; align-items: center; justify-content: center; padding: 16px;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      background: #fff; border-radius: 20px; max-width: 680px; width: 100%;
      max-height: 91vh; overflow-y: auto; padding: 24px; position: relative; box-shadow: 0 24px 60px rgba(15, 23, 42, 0.26);
    }
    .modal.modal-prod { max-width: 940px; padding: 24px 26px 22px; }
    .modal-cart { max-width: 540px; }
    @media (max-width: 640px) {
      .modal-backdrop { align-items: flex-end; padding: 0; }
      .modal { border-radius: 22px 22px 0 0 !important; max-height: 93dvh !important; padding: 16px 15px 0 !important; }
      .modal.modal-cart { padding: 18px 16px 22px !important; }
    }
    .modal-close {
      position: sticky; top: 0; float: right; z-index: 12; margin-left: 8px;
      width: 38px; height: 38px;
      border-radius: 50%; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.96); cursor: pointer; font-weight: 800;
      display: inline-flex; align-items: center; justify-content: center; color: var(--text); box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .modal-close:hover { background: var(--brand-soft); border-color: var(--brand); color: var(--brand-dark); }
    .pd-layout {
      display: grid; gap: 22px; grid-template-columns: minmax(0, 1fr); clear: both;
    }
    @media (min-width: 768px) {
      .pd-layout { grid-template-columns: minmax(290px, 0.88fr) minmax(0, 1.12fr); align-items: start; gap: 26px; }
      .pd-gallery-col { position: sticky; top: 0; }
    }
    .pd-stage {
      position: relative; background: #f3efe9; border-radius: 16px; overflow: hidden;
      aspect-ratio: 1 / 1; border: 1px solid var(--line);
    }
    .pd-stage-img-btn {
      width: 100%; height: 100%; padding: 0; border: none; background: transparent; cursor: zoom-in; display: block;
    }
    .pd-stage-img-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pd-nav-arrow {
      position: absolute; top: 50%; transform: translateY(-50%); z-index: 4;
      width: 38px; height: 38px; border-radius: 50%; border: 1px solid rgba(28, 25, 23, 0.14);
      background: rgba(255, 255, 255, 0.92); color: var(--text); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .pd-nav-arrow:hover { background: #fff; border-color: var(--brand); color: var(--brand); }
    .pd-nav-arrow.prev { left: 10px; }
    .pd-nav-arrow.next { right: 10px; }
    .pd-counter-pill {
      position: absolute; bottom: 10px; left: 10px; z-index: 4;
      background: rgba(28, 25, 23, 0.78); color: #fff; font-size: 11.5px; font-weight: 700;
      padding: 4px 10px; border-radius: 999px; font-variant-numeric: tabular-nums;
    }
    .pd-zoom-pill {
      position: absolute; bottom: 10px; right: 10px; z-index: 4;
      background: rgba(255, 255, 255, 0.94); color: var(--text); border: 1px solid var(--line);
      font-size: 11.5px; font-weight: 700; min-height: 32px; padding: 0 11px; border-radius: 999px;
      cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .pd-zoom-pill:hover { border-color: var(--brand); color: var(--brand-dark); }
    .modal-thumbs { display: flex; gap: 7px; overflow-x: auto; padding: 9px 2px 3px; scrollbar-width: thin; }
    .modal-thumb-btn {
      width: 56px; height: 56px; border-radius: 10px; overflow: hidden; border: 2px solid var(--line);
      padding: 0; background: #f3efe9; cursor: pointer; flex-shrink: 0; opacity: 0.76; transition: opacity 0.16s ease, border-color 0.16s ease;
    }
    .modal-thumb-btn:hover { opacity: 1; }
    .modal-thumb-btn.active { border-color: var(--brand); opacity: 1; box-shadow: 0 0 0 2px rgba(140, 79, 30, 0.18); }
    .modal-thumb-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .pd-quick-specs {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 10px;
    }
    .pd-trust-strip {
      display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px;
    }
    @media (max-width: 767px) {
      .pd-gallery-extra { display: none; }
    }
      background: #faf8f5; border: 1px solid var(--line); border-radius: 11px; padding: 8px 10px;
    }
    .pd-spec-chip small { display: block; font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 1px; }
    .pd-spec-chip strong { display: block; font-size: 12px; color: var(--text); font-weight: 700; line-height: 1.35; }
    .pd-spec-chip {
      background: #faf8f5; border: 1px solid var(--line); border-radius: 11px; padding: 8px 10px;
    }
    .pd-spec-chip small { display: block; font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 1px; }
    .pd-spec-chip strong { display: block; font-size: 12px; color: var(--text); font-weight: 700; line-height: 1.35; }
    .pd-trust-badge {
      display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 650;
      color: var(--ok); background: var(--ok-soft); border: 1px solid #99f6e4; border-radius: 999px; padding: 4px 10px;
    }
    .pd-meta-row {
      display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 6px;
    }
    .pd-sku-pill {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; font-weight: 700;
      background: #f5f2ec; color: var(--muted); border: 1px solid var(--line); border-radius: 7px; padding: 2px 8px;
    }
    .pd-stock-pill {
      font-size: 11.5px; font-weight: 700; color: var(--ok); background: var(--ok-soft);
      border: 1px solid #99f6e4; border-radius: 7px; padding: 2px 8px;
    }
    .pd-title { font-size: 20px; font-weight: 850; line-height: 1.28; color: var(--text); margin: 2px 0 6px; }
    .pd-lead { font-size: 13px; line-height: 1.55; color: var(--muted); margin-bottom: 10px; }
    .pd-price-panel {
      background: #faf8f5; border: 1px solid var(--line); border-radius: 14px; padding: 11px 13px; margin-bottom: 11px;
    }
    .pd-price-main { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px; }
    .pd-price-now { font-size: 24px; font-weight: 850; color: var(--brand); font-variant-numeric: tabular-nums; }
    .pd-price-strike { font-size: 13px; color: var(--muted); text-decoration: line-through; margin-left: 6px; font-weight: 500; }
    .pd-ws-tier-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 6px; margin-top: 9px;
    }
    .pd-ws-tier-btn {
      text-align: left; border: 1px solid #e6d3bd; background: #fff; border-radius: 10px;
      padding: 7px 9px; cursor: pointer; transition: border-color 0.15s ease, background 0.15s ease;
    }
    .pd-ws-tier-btn:hover { border-color: var(--brand); background: var(--brand-soft); }
    .pd-ws-tier-btn.active { border-color: var(--brand); background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--brand); }
    .pd-ws-tier-btn small { display: block; font-size: 11px; color: var(--brand-dark); font-weight: 700; }
    .pd-ws-tier-btn strong { display: block; font-size: 12.5px; color: var(--text); font-weight: 800; font-variant-numeric: tabular-nums; }
    .var-chip-row { display: flex; flex-wrap: wrap; gap: 7px; margin: 6px 0 12px; }
    .var-chip {
      min-height: 38px; padding: 4px 12px 4px 6px; border-radius: 999px; border: 1px solid var(--line);
      background: #fff; font-size: 12px; font-weight: 700; cursor: pointer; color: var(--text);
      display: inline-flex; align-items: center; gap: 7px; transition: border-color 0.15s ease, background 0.15s ease;
    }
    .var-chip.no-thumb { padding: 4px 13px; }
    .var-chip:hover { border-color: var(--brand); background: var(--brand-soft); }
    .var-chip.active { background: var(--brand); border-color: var(--brand); color: #fff; }
    .var-chip-thumb { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; flex-shrink: 0; border: 1px solid rgba(0,0,0,0.08); background: #f3efe9; }
    .var-chip-price { font-size: 11px; font-weight: 600; opacity: 0.88; font-variant-numeric: tabular-nums; }
    .pd-tabs-nav {
      display: flex; gap: 4px; background: #f3efe9; padding: 4px; border-radius: 11px; margin-bottom: 10px; overflow-x: auto;
    }
    .pd-tab-btn {
      flex: 1; min-width: max-content; min-height: 34px; border: none; border-radius: 8px; background: transparent;
      font-size: 12px; font-weight: 700; color: var(--muted); padding: 5px 11px; cursor: pointer;
    }
    .pd-tab-btn.active { background: #fff; color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .pd-tab-panel {
      border: 1px solid var(--line); border-radius: 13px; padding: 12px 14px; background: #fff; margin-bottom: 12px;
    }
    .pd-sec-block + .pd-sec-block { margin-top: 11px; padding-top: 10px; border-top: 1px dashed var(--line); }
    .pd-sec-heading { font-size: 13px; font-weight: 800; color: var(--brand-dark); margin-bottom: 6px; }
    .pd-bullet-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 6px; }
    .pd-bullet-item {
      position: relative; padding-left: 14px; font-size: 12.5px; line-height: 1.52; color: var(--text);
    }
    .pd-bullet-item::before {
      content: ''; position: absolute; left: 0; top: 7px; width: 6px; height: 6px; border-radius: 50%; background: var(--brand);
    }
    .pd-bullet-item span { color: var(--muted); }
    .pd-cta-box {
      background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 11px 13px;
      display: grid; gap: 9px; margin-bottom: 12px;
    }
    .pd-share-row {
      display: grid; gap: 8px; margin-bottom: 6px;
    }
    @media (max-width: 640px) {
      .pd-right-col { display: flex; flex-direction: column; }
      .pd-cta-box {
        order: 10; position: sticky; bottom: 0; z-index: 10;
        margin: 8px -15px 0; border-radius: 0; border-left: none; border-right: none; border-bottom: none;
        padding: 9px 15px calc(11px + env(safe-area-inset-bottom));
        background: #ffffff; box-shadow: 0 -8px 20px rgba(0,0,0,0.08);
      }
      .pd-buy-label-full { display: none; }
      .pd-buy-label-compact { display: inline !important; }
    }
    .pd-buy-label-compact { display: none; }
    .pd-related-wrap {
      margin-top: 18px; padding-top: 15px; border-top: 1px solid var(--line); clear: both;
    }
    @media (max-width: 640px) { .pd-related-wrap { padding-bottom: 14px; } }
    .pd-related-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 10px; margin-top: 9px;
    }
    .pd-rel-card {
      display: flex; align-items: center; gap: 10px; border: 1px solid var(--line); border-radius: 12px;
      padding: 8px 10px; background: #faf8f5; cursor: pointer; text-align: left; width: 100%;
    }
    .pd-rel-card:hover { border-color: var(--brand); background: var(--brand-soft); }
    .pd-rel-card img { width: 52px; height: 52px; border-radius: 9px; object-fit: cover; flex-shrink: 0; background: #eee; }
    .pd-zoom-backdrop {
      position: fixed; inset: 0; z-index: 95; background: rgba(12, 10, 9, 0.9);
      display: none; align-items: center; justify-content: center; padding: 20px;
    }
    .pd-zoom-backdrop.open { display: flex; }
    .pd-zoom-img { max-width: min(92vw, 860px); max-height: 86vh; border-radius: 14px; object-fit: contain; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
    .qty-stepper {
      display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line);
      border-radius: 10px; padding: 3px; background: #faf8f5;
    }
    .qty-btn {
      width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--line);
      background: #fff; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
    }
    .qty-btn.danger { color: #dc2626; border-color: transparent; background: transparent; }
    .qty-btn.danger:hover { background: #fef2f2; }
    .cart-line {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      min-width: 0; overflow: hidden;
      border: 1px solid var(--line); border-radius: 12px; padding: 8px 10px; font-size: 12.5px; background: #faf8f5;
    }
    .cart-line-thumb {
      width: 48px; height: 48px; border-radius: 9px; object-fit: cover; border: 1px solid var(--line); flex-shrink: 0; background: #eee;
    }
    .alert-ok {
      background: var(--ok-soft); border: 1px solid #99f6e4; color: #115e59;
      padding: 12px 14px; border-radius: 12px; font-size: 12.5px; margin-bottom: 12px;
    }
    .alert-amber {
      background: var(--brand-soft); border: 1px solid #efd6b8; color: #6f3d15;
      padding: 11px 13px; border-radius: 12px; font-size: 12px; margin-bottom: 12px;
    }
    .pay-choice {
      min-height: 40px; border-radius: 11px; border: 1px solid var(--line); background: #fff;
      font-size: 12px; font-weight: 650; cursor: pointer; padding: 6px 10px; color: var(--muted);
    }
    .pay-choice.active {
      border-color: var(--brand); background: var(--brand-soft); color: var(--brand-dark); font-weight: 750;
    }
    footer {
      background: #fff; border-top: 1px solid var(--line); padding: 30px 0; font-size: 12.5px; color: var(--muted);
    }
    .footer-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .footer-grid h3 { color: var(--text); font-size: 14.5px; font-weight: 800; margin-bottom: 8px; }
    .footer-note { margin-top: 6px; }
    .link-btn {
      border: none; background: transparent; min-height: 32px; padding: 4px 6px; color: var(--brand); font-weight: 700; cursor: pointer;
      display: inline-flex; align-items: center;
    }
    .link-btn:hover { text-decoration: underline; }
    .mobile-cart-bar {
      position: fixed; left: 0; right: 0; bottom: 0; z-index: 55;
      background: rgba(255, 255, 255, 0.98); border-top: 1px solid #e4cbb0;
      padding: 8px 14px calc(10px + env(safe-area-inset-bottom));
      box-shadow: 0 -8px 24px rgba(28, 25, 23, 0.12); backdrop-filter: blur(10px);
    }
    @media (min-width: 641px) { .mobile-cart-bar { display: none !important; } }
    .mobile-cart-hint {
      font-size: 11px; font-weight: 700; color: var(--brand-dark); margin-bottom: 5px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .mobile-cart-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .mobile-cart-cnt { font-size: 11px; color: var(--muted); }
    .mobile-cart-sum { font-size: 15px; font-weight: 850; color: var(--text); }
    .toast {
      position: fixed; bottom: 20px; right: 20px; z-index: 65;
      background: #1c1917; color: #fff; padding: 11px 14px; border-radius: 12px;
      font-size: 12.5px; font-weight: 650; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      display: none; max-width: 350px; align-items: center; justify-content: space-between; gap: 10px;
    }
    .toast.open { display: flex; }
    @media (max-width: 640px) {
      .toast { left: 12px; right: 12px; bottom: 92px; max-width: none; }
    }
    .toast-cta {
      border: 1px solid rgba(255,255,255,0.3); background: var(--brand); color: #fff;
      border-radius: 8px; padding: 5px 10px; font-size: 11.5px; font-weight: 750; cursor: pointer; white-space: nowrap;
    }
    .hidden { display: none !important; }
    .banner-showcase { margin-bottom: 22px; display: grid; gap: 14px; }
    .banner-top-grid { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
    .banner-top-grid.single { grid-template-columns: 1fr; }
    @media (max-width: 900px) { .banner-top-grid { grid-template-columns: 1fr; } }
    .banner-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      overflow: hidden; box-shadow: var(--shadow);
    }
    .carousel-stage { position: relative; width: 100%; aspect-ratio: 2 / 1; background: #f3efe9; overflow: hidden; }
    .carousel-slide {
      position: absolute; inset: 0; opacity: 0; pointer-events: none; transition: opacity 0.45s ease;
    }
    .carousel-slide.active { opacity: 1; pointer-events: auto; z-index: 2; }
    .carousel-slide img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .carousel-hit-btn {
      display: block; width: 100%; height: 100%; padding: 0; border: none; background: transparent; cursor: pointer;
    }
    .carousel-nav {
      position: absolute; top: 50%; transform: translateY(-50%); z-index: 5;
      width: 36px; height: 36px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.45);
      background: rgba(28,25,23,0.45); color: #fff; font-weight: 800; cursor: pointer;
      display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px);
    }
    .carousel-nav:hover { background: rgba(28,25,23,0.72); }
    .carousel-nav.prev { left: 10px; }
    .carousel-nav.next { right: 10px; }
    .carousel-bar {
      min-height: 38px; border-top: 1px solid var(--line); padding: 0 12px;
      display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--muted);
    }
    .carousel-dots { display: flex; align-items: center; }
    .carousel-dot {
      min-width: 32px; min-height: 32px; border: none; background: transparent; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; padding: 0;
    }
    .carousel-dot::after {
      content: ""; display: block; height: 8px; width: 8px; border-radius: 999px;
      background: #d6d0c7; transition: all 0.2s ease;
    }
    .carousel-dot.active::after { width: 20px; background: var(--brand); }
    .hotspot-stage { position: relative; width: 100%; background: #f3efe9; overflow: hidden; }
    .hotspot-stage img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hotspot-zone {
      position: absolute; z-index: 4; border: 2px solid transparent; background: transparent;
      cursor: pointer; transition: all 0.18s ease;
    }
    .hotspot-zone:hover { background: rgba(0,0,0,0.05); border-color: rgba(251, 191, 36, 0.9); }
    .hotspot-pill {
      position: absolute; right: 8px; bottom: 8px; padding: 3px 9px; border-radius: 999px;
      background: rgba(28,25,23,0.8); color: #fff; font-size: 11px; font-weight: 700;
      white-space: nowrap; max-width: calc(100% - 10px); overflow: hidden; text-overflow: ellipsis;
      backdrop-filter: blur(4px); transition: transform 0.18s ease, background 0.18s ease;
      display: inline-flex; align-items: center; gap: 4px; font-variant-numeric: tabular-nums;
    }
    @media (max-width: 520px) {
      .hotspot-pill { right: 5px; bottom: 5px; padding: 2px 6px; font-size: 9.5px; }
    }
    .hotspot-zone:hover .hotspot-pill { background: var(--brand); transform: scale(1.05); }
    .col-banner-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); }
    .col-banner-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
    .col-banner-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
    @media (max-width: 860px) { .col-banner-grid, .col-banner-grid.cols-3 { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
    .col-banner-btn {
      display: flex; align-items: center; gap: 12px; padding: 10px; border-radius: 15px;
      border: 1px solid var(--line); background: var(--card); text-align: left; cursor: pointer;
      transition: all 0.18s ease;
    }
    @media (max-width: 420px) {
      .col-banner-btn { flex-direction: column; align-items: flex-start; gap: 8px; padding: 10px; }
      .col-banner-btn img { width: 48px !important; height: 48px !important; }
    }
    .col-banner-btn:hover { transform: translateY(-2px); border-color: #d99b66; box-shadow: var(--shadow); }
    .col-banner-btn.active { border-color: var(--brand); background: var(--brand-soft); box-shadow: 0 0 0 1px var(--brand); }
    .col-banner-btn img { width: 60px; height: 60px; border-radius: 11px; object-fit: cover; flex-shrink: 0; border: 1px solid var(--line); }
    .col-banner-title { font-size: 13.5px; font-weight: 800; color: var(--text); line-height: 1.25; }
    .col-banner-sub { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
    .col-banner-sub.shopee { color: var(--brand); font-weight: 700; }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
  </style>
</head>
<body>
  <div class="topbar" id="announcementBar">${escapeHtml(heroCopyInit.effectiveAnnouncementBar)}</div>

  <header>
    <div class="container nav-wrap">
      <button type="button" class="brand-box" onclick="switchTab('PRODUCTS')" aria-label="Trang chủ ${brandName}">
        <span id="brandLogoWrap">${
          shopLogoUrl
            ? `<img src="${shopLogoUrl}" alt="${brandName}" referrerpolicy="no-referrer" class="brand-logo-img" />`
            : `<span class="brand-logo" id="brandLogoBox">${logoInitials}</span>`
        }</span>
        <span class="brand-meta">
          <span class="brand-title">
            <span id="brandNameHdr">${brandName}</span>
            <span class="domain-pill" id="domainPill">${domain}</span>
          </span>
          <span class="brand-sub" id="brandSubHdr">${headerSub}</span>
        </span>
      </button>

      <nav class="nav-tabs" aria-label="Điều hướng chính">
        <button type="button" class="tab-btn active" id="tab-PRODUCTS" aria-current="page" onclick="switchTab('PRODUCTS')">
          <span>Sản phẩm (<span id="prodCountNav">${snapshot.products.length}</span>)</span>
        </button>
        <button type="button" class="tab-btn wholesale${wsAllowedInit ? '' : ' hidden'}" id="tab-WHOLESALE" onclick="switchTab('WHOLESALE')">
          <span>Bảng Giá Sỉ <span id="wsNavBadge">${wsRangeLabel}</span></span>
        </button>
        <button type="button" class="tab-btn" id="tab-CONTACT" onclick="switchTab('CONTACT')">
          <span>Liên hệ &amp; Xưởng</span>
        </button>
        <button type="button" class="tab-btn" id="tab-TRACKING" onclick="switchTab('TRACKING')">
          <span>Tra cứu đơn</span>
        </button>
      </nav>

      <div class="header-actions">
        <button type="button" class="cart-btn" onclick="openCartModal()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>
          <span>Giỏ hàng (<span id="cartCountBadge">0</span>)</span>
        </button>
      </div>
    </div>
  </header>

  <section class="hero" id="heroSection">
    <div class="container">
      <div class="hero-grid${hasHeroVisualInit ? '' : ' single'}" id="heroMainGrid">
        <div>
          <div class="hero-badge">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/></svg>
            <span id="heroBadge">${escapeHtml(snapshot.config.heroBadge)}</span>
          </div>
          <h1 id="heroTitle">${heroTitle}</h1>
          <p class="hero-sub" id="heroSubtitle">${heroSub}</p>

          <div class="hero-highlights">
            <span class="hero-hl-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
              <span id="heroHighlight1">${escapeHtml(heroCopyInit.highlight1)}</span>
            </span>
            <span class="hero-hl-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8c4f1e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
              <span id="heroHighlight2">${escapeHtml(heroCopyInit.highlight2)}</span>
            </span>
            <span class="hero-hl-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0369a1" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>
              <span id="heroHighlightWs">${escapeHtml(heroCopyInit.highlight3)}</span>
            </span>
          </div>

          <div class="hero-actions">
            <button type="button" id="heroOpenExploreBtn" class="btn-primary${isClosedInit ? ' hidden' : ''}" onclick="scrollToCatalog()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
              <span>Khám Phá Sản Phẩm</span>
            </button>
            <button type="button" id="heroClosedContactBtn" class="${isClosedInit ? 'btn-primary' : 'btn-outline hidden'}" onclick="switchTab('CONTACT')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>Liên Hệ Cửa Hàng</span>
            </button>
            <button type="button" id="heroClosedTrackBtn" class="btn-ws${isClosedInit ? '' : ' hidden'}" onclick="switchTab('TRACKING')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><circle cx="11.5" cy="14.5" r="2.5"/><path d="M13.3 16.3 15 18"/></svg>
              <span>Tra Cứu Đơn Hàng</span>
            </button>
            <button type="button" id="heroWsBtn" class="btn-ws${wsAllowedInit ? '' : ' hidden'}" onclick="switchTab('WHOLESALE')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"/><path d="m15 9-6 6"/><path d="M9 9h.01"/><path d="M15 15h.01"/></svg>
              <span>Bảng Giá Sỉ &amp; OEM <span id="heroWsRangeTxt">${wsRangeLabel}</span></span>
            </button>
            <a id="heroShopeeLink" href="${escapeHtml(snapshot.config.contact.shopeeUrl)}" target="_blank" rel="noopener noreferrer" class="btn-outline${snapshot.config.contact.shopeeUrl ? '' : ' hidden'}">
              <span>Gian hàng Shopee</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>
            </a>
          </div>
        </div>

        <div id="heroCoverWrap" class="${hasHeroVisualInit ? 'hero-showcase-card' : 'hidden'}">${heroCoverMediaHtml}${heroFeaturedStripHtml}</div>
      </div>

      <h2 class="sr-only">Cam kết chất lượng và chính sách cửa hàng</h2>
      <div class="hero-promise-grid">
        <div class="promise-card">
          <div class="promise-icon craft" id="heroCraftIconWrap">${
            heroCopyInit.craftIcon === 'FLAME' ? SVG_ICON_FLAME : SVG_ICON_SPARKLES
          }</div>
          <div>
            <h3 id="heroCraftPromiseTitle">${escapeHtml(heroCopyInit.craftPromiseTitle)}</h3>
            <p id="heroCraftPromiseDesc">${escapeHtml(heroCopyInit.craftPromiseDesc)}</p>
          </div>
        </div>

        <div class="promise-card">
          <div class="promise-icon ws" id="heroWsIconWrap">${
            wsAllowedInit ? SVG_ICON_BADGE_PCT : SVG_ICON_TRUCK
          }</div>
          <div>
            <h3 id="heroWsPromiseTitle">${escapeHtml(heroCopyInit.wsPromiseTitle)}</h3>
            <p id="heroWsPromiseDesc">${
              wsAllowedInit
                ? wsSummaryInit
                : `Miễn phí giao hàng toàn quốc đơn lẻ từ ${freeShipInitFmt} · Kiểm hàng trước khi nhận.`
            }</p>
          </div>
        </div>

        <div class="promise-card">
          <div class="promise-icon safe">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>
          </div>
          <div>
            <h3 id="heroSafePromiseTitle">${escapeHtml(heroCopyInit.safePromiseTitle)}</h3>
            <p id="heroSafePromiseDesc">${escapeHtml(heroCopyInit.safePromiseDesc)}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <main class="container" id="mainContent">
    <!-- TAB 1: PRODUCTS -->
    <section id="sec-PRODUCTS" aria-labelledby="catalogSectionTitle">
      <h2 id="catalogSectionTitle" class="sr-only">Danh mục sản phẩm chính thức</h2>
      <div id="shopeeBannerShowcase" class="banner-showcase hidden"></div>
      <div class="toolbar${isClosedInit ? ' hidden' : ''}" id="catalogToolbar">
        <div class="toolbar-row">
          <div class="search-wrap">
            <label for="searchInput" class="sr-only">Tìm kiếm sản phẩm</label>
            <input type="search" id="searchInput" name="q" aria-label="Tìm kiếm sản phẩm" class="search-input" placeholder="Tìm tên sản phẩm, màu hoặc mã SKU..." oninput="onSearchInput()" />
            <button type="button" id="searchClearBtn" class="search-clear hidden" aria-label="Xóa từ khóa tìm kiếm" onclick="clearSearchInput()">✕</button>
          </div>
          <div class="toolbar-controls">
            <div class="mode-switch${wsAllowedInit ? '' : ' hidden'}" id="modeSwitchWrap">
              <button type="button" id="modeRetailBtn" class="active" onclick="setPriceMode('RETAIL')">Giá Bán Lẻ</button>
              <button type="button" id="modeWsBtn" onclick="setPriceMode('WHOLESALE')">Hiển thị Giá Sỉ</button>
            </div>
            <label for="sortSelect" class="sr-only">Sắp xếp sản phẩm</label>
            <select id="sortSelect" name="sort" class="select-box" onchange="renderProducts()" aria-label="Sắp xếp sản phẩm">
              <option value="DEFAULT">Sắp xếp: Đề xuất</option>
              <option value="PRICE_ASC">Giá: Thấp → Cao</option>
              <option value="PRICE_DESC">Giá: Cao → Thấp</option>
            </select>
          </div>
        </div>
        <div id="catFilterRow" class="cat-filter-row"></div>
      </div>
      <div class="prod-grid" id="productGrid"></div>
    </section>

    <!-- TAB 2: WHOLESALE -->
    <section id="sec-WHOLESALE" class="hidden">
      <div class="tier-grid" id="tierCardsGrid"></div>
      <div class="two-col">
        <div class="panel">
          <h2>Bảng Báo Giá Sỉ Niêm Yết Theo Từng Mã SKU</h2>
          <p class="desc" id="wsPolicyText">${escapeHtml(snapshot.config.wholesalePolicyNote)}</p>
          <div class="ws-mobile-cards" id="wsMobileCards"></div>
          <div class="ws-desktop-table">
            <table>
              <thead id="wsTableHead"></thead>
              <tbody id="wsTableBody"></tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h2>Đăng Ký Nhận Báo Giá Sỉ &amp; Gia Công Quà Tặng (OEM)</h2>
          <p class="desc" id="oemNoteText">${escapeHtml(snapshot.config.oemCustomNote)}</p>
          <div id="wsSuccessAlert" class="alert-ok hidden" role="status" aria-live="polite"></div>
          <div id="wsSimBox" class="ws-sim-box"></div>
          <form id="wholesaleForm" onsubmit="submitWholesaleForm(event)" class="form-grid">
            <div class="field">
              <label for="wsName">Họ và tên người liên hệ *</label>
              <input id="wsName" name="wsName" autocomplete="name" required placeholder="Chị Minh Anh" />
            </div>
            <div class="field">
              <label for="wsPhone">Số điện thoại / Zalo *</label>
              <input id="wsPhone" name="wsPhone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="VD: 09xx xxx xxx" />
            </div>
            <div class="field">
              <label for="wsShop">Tên Shop / Spa / Doanh nghiệp</label>
              <input id="wsShop" name="companyOrShopName" autocomplete="organization" placeholder="An Nhiên Spa / Công ty..." />
            </div>
            <div class="field">
              <label for="wsQty">Số lượng dự kiến (SP)</label>
              <input id="wsQty" name="estimatedQty" type="number" inputmode="numeric" min="${minWsQtyInit}" value="${Math.max(minWsQtyInit, 30)}" oninput="updateWsSimulator()" />
            </div>
            <div class="field full">
              <label for="wsAddr">Tỉnh / Thành phố nhận hàng</label>
              <input id="wsAddr" name="wsAddress" autocomplete="address-level1" placeholder="TP.HCM, Hà Nội, Đà Nẵng..." />
            </div>
            <div class="field full">
              <label for="wsEmail">Email nhận bảng giá (tùy chọn)</label>
              <input id="wsEmail" name="wsEmail" type="email" inputmode="email" autocomplete="email" placeholder="purchasing@company.vn" />
            </div>
            <div class="field full">
              <label for="wsNote">Mẫu sản phẩm quan tâm / Yêu cầu đóng hộp quà riêng</label>
              <textarea id="wsNote" name="wsNote" rows="3" placeholder="VD: Báo giá 50 hộp nến bơ 50 viên + 50 chân nến Hoa Sen trắng..."></textarea>
            </div>
            <div class="field full">
              <button type="submit" class="btn-ws w-full" id="wsSubmitBtn">
                Gửi Yêu Cầu Nhận Bảng Giá Sỉ Chính Thức
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- TAB 3: CONTACT -->
    <section id="sec-CONTACT" class="hidden">
      <div class="two-col">
        <div class="panel">
          <h2>Thông Tin Liên Hệ &amp; Xưởng Sản Xuất</h2>
          <p class="desc">Kết nối trực tiếp với xưởng chế tác và bộ phận chăm sóc khách hàng lẻ / đại lý sỉ.</p>
          <div id="contactDetailsList"></div>
        </div>
        <div class="panel">
          <h2>Gửi Tin Nhắn Tư Vấn Trực Tuyến</h2>
          <p class="desc">Tin nhắn của bạn được đồng bộ trực tiếp vào Hộp thư CSKH của hệ thống CMS.</p>
          <div id="ctSuccessAlert" class="alert-ok hidden" role="status" aria-live="polite"></div>
          <form onsubmit="submitContactForm(event)" class="form-grid">
            <div class="field">
              <label for="ctName">Họ và tên *</label>
              <input id="ctName" name="contactName" autocomplete="name" required placeholder="Nguyễn Thanh Hà" />
            </div>
            <div class="field">
              <label for="ctPhone">Số điện thoại / Zalo *</label>
              <input id="ctPhone" name="contactPhone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="VD: 09xx xxx xxx" />
            </div>
            <div class="field full">
              <label for="ctEmail">Email (tùy chọn)</label>
              <input id="ctEmail" name="contactEmail" type="email" inputmode="email" autocomplete="email" placeholder="ban@email.com" />
            </div>
            <div class="field full">
              <label for="ctMsg">Nội dung cần tư vấn *</label>
              <textarea id="ctMsg" name="contactMessage" rows="4" required placeholder="Nhập câu hỏi hoặc yêu cầu của bạn..."></textarea>
            </div>
            <div class="field full">
              <button type="submit" class="btn-primary w-full" id="ctSubmitBtn">
                Gửi Liên Hệ Tới Cửa Hàng
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- TAB 4: TRACKING -->
    <section id="sec-TRACKING" class="hidden">
      <div class="panel panel-narrow">
        <h2>Tra Cứu Đơn Hàng &amp; Yêu Cầu Báo Giá Sỉ</h2>
        <p class="desc">Nhập mã đơn (VD: BM-WEB-... hoặc BM-SI-...) kèm số điện thoại đặt hàng để xem trạng thái.</p>
        <form onsubmit="submitLookup(event)" class="form-grid">
          <div class="field full">
            <label for="lkCode">Mã đơn hàng / Mã yêu cầu *</label>
            <input id="lkCode" name="lookupCode" autocomplete="off" required placeholder="VD: BM-WEB-261127-1234" />
          </div>
          <div class="field full">
            <label for="lkPhone">Số điện thoại đặt hàng (hoặc 4 số cuối) *</label>
            <input id="lkPhone" name="lookupPhone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="Nhập SĐT đặt hàng hoặc 4 số cuối" />
          </div>
          <div class="field full">
            <button type="submit" class="btn-primary w-full" id="lkBtn">Tra cứu ngay</button>
          </div>
        </form>
        <div id="lkOutput" class="lk-output" role="status" aria-live="polite"></div>
      </div>
    </section>
  </main>

  <footer>
    <h2 class="sr-only">Thông tin chân trang cửa hàng</h2>
    <div class="container footer-grid">
      <div>
        <h3 id="footerBrand">${brandName}</h3>
        <p id="footerWorkshop">${escapeHtml(snapshot.brand.workshopName)}</p>
        <p class="footer-note">Website chính thức: <strong>https://${domain}</strong></p>
      </div>
      <div>
        <h3>Dành cho Khách hàng &amp; Đối tác</h3>
        <p id="footerWsRow" class="${snapshot.config.wholesaleEnabled === false ? 'hidden' : ''}"><a href="#wholesale" onclick="switchTab('WHOLESALE'); return false;">• Bảng giá sỉ tận xưởng (Từ ${minWsQtyInit}+ SP)</a></p>
        <p><a href="#contact" onclick="switchTab('CONTACT'); return false;">• Đặt gia công quà tặng doanh nghiệp (OEM)</a></p>
        <p><a href="#tracking" onclick="switchTab('TRACKING'); return false;">• Tra cứu trạng thái đơn hàng</a></p>
      </div>
      <div>
        <h3>Kết nối Đa kênh</h3>
        ${footerHotlineHtml}
        <p class="${snapshot.config.contact.shopeeUrl ? '' : 'hidden'}" id="footerShopeeWrap"><a id="footerShopee" href="${escapeHtml(snapshot.config.contact.shopeeUrl)}" target="_blank" rel="noopener">Shopee Chính hãng: ${escapeHtml(snapshot.config.contact.shopeeUrl.replace('https://', ''))}</a></p>
        <p class="footer-note"><a href="${escapeHtml(snapshot.config.cmsBackendOrigin)}/login" target="_blank" rel="noopener">Cổng Quản trị Nhân sự CMS ↗</a></p>
      </div>
    </div>
  </footer>

  <!-- Mobile Sticky Bottom Cart & Wholesale Progress Bar (< 640px) -->
  <div id="mobileCartBar" class="mobile-cart-bar hidden" role="region" aria-label="Tóm tắt giỏ hàng nhanh">
    <div id="mobileCartHint" class="mobile-cart-hint"></div>
    <div class="mobile-cart-row">
      <div>
        <div class="mobile-cart-cnt" id="mobileCartCountTxt">0 sản phẩm</div>
        <div class="money mobile-cart-sum" id="mobileCartTotalTxt">0 ₫</div>
      </div>
      <button type="button" class="cart-btn" onclick="openCartModal()">Xem giỏ &amp; Đặt mua →</button>
    </div>
  </div>

  <!-- Product Detail Modal -->
  <div class="modal-backdrop" id="prodModal" role="dialog" aria-modal="true" aria-labelledby="prodModalTitle" aria-hidden="true" onclick="if(event.target===this)closeProdModal()">
    <div class="modal modal-prod" id="prodModalContent"></div>
  </div>

  <!-- Product Image Lightbox Zoom -->
  <div class="pd-zoom-backdrop" id="prodZoomModal" role="dialog" aria-modal="true" aria-label="Phóng lớn hình ảnh sản phẩm" aria-hidden="true" onclick="if(event.target===this)closeZoomModal()">
    <button type="button" class="pd-nav-arrow prev" id="prodZoomPrevBtn" aria-label="Ảnh trước" onclick="stepModalImg(-1)">‹</button>
    <img id="prodZoomImg" class="pd-zoom-img" src="" alt="" />
    <button type="button" class="pd-nav-arrow next" id="prodZoomNextBtn" aria-label="Ảnh tiếp theo" onclick="stepModalImg(1)">›</button>
    <button type="button" class="modal-close" style="position:fixed;top:18px;right:18px;" aria-label="Đóng phóng lớn ảnh" onclick="closeZoomModal()">✕</button>
  </div>

  <!-- Cart & Checkout Modal -->
  <div class="modal-backdrop" id="cartModal" role="dialog" aria-modal="true" aria-labelledby="cartModalTitle" aria-hidden="true" onclick="if(event.target===this)closeCartModal()">
    <div class="modal modal-cart" id="cartModalContent"></div>
  </div>

  <div class="toast" id="toastBox" role="status" aria-live="polite"></div>

  <script>
    window.__OPENVN_STOREFRONT_BOOTSTRAP__ = ${jsonBootstrap};
    var STATE = {
      data: window.__OPENVN_STOREFRONT_BOOTSTRAP__,
      tab: 'PRODUCTS',
      priceMode: 'RETAIL',
      selectedCat: 'ALL',
      selectedCollectionId: 'ALL',
      carouselIdx: 0,
      carouselPaused: false,
      heroShowcase: [],
      paymentMethod: 'COD',
      cart: [],
      cartHydratedKey: null,
      pendingSku: '',
      modalProdId: '',
      modalImgIdx: 0,
      modalQty: 1,
      modalTab: 'OVERVIEW',
      zoomOpen: false,
      lastFocusedEl: null,
      checkoutDraft: { name: '', phone: '', addr: '', note: '' },
      completedOrder: null
    };

    function prefersReducedMotionClient() {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function fmtVND(n) {
      return Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' ₫';
    }
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function jsAttr(s) {
      var jsEsc = String(s == null ? '' : s)
        .replace(/\\\\/g, '\\\\\\\\')
        .replace(/'/g, "\\\\'")
        .replace(/\\r/g, '\\\\r')
        .replace(/\\n/g, '\\\\n')
        .replace(/\\u2028/g, '\\\\u2028')
        .replace(/\\u2029/g, '\\\\u2029');
      return esc(jsEsc);
    }
    function calcWsPrice(retail, pct) {
      var r = Math.max(0, Math.round(Number(retail) || 0));
      var keepBps = 10000 - Math.round(Math.min(90, Math.max(0, Number(pct) || 0)) * 100);
      return Math.floor((r * keepBps + 5000) / 10000);
    }
    function apiEndpoint() {
      var origin = (STATE.data && STATE.data.config && STATE.data.config.cmsBackendOrigin) || 'https://openvn-cms-pos-backend.onrender.com';
      return origin.replace(/\\/+$/, '') + '/api/public/storefront';
    }
    function isAnyModalOpen() {
      var pm = document.getElementById('prodModal');
      var cm = document.getElementById('cartModal');
      var zm = document.getElementById('prodZoomModal');
      return Boolean(
        STATE.zoomOpen ||
        (zm && zm.classList.contains('open')) ||
        (pm && pm.classList.contains('open')) ||
        (cm && cm.classList.contains('open'))
      );
    }
    function syncBodyScrollLock() {
      document.body.style.overflow = isAnyModalOpen() ? 'hidden' : '';
    }
    function hideToast() {
      var el = document.getElementById('toastBox');
      if (el) el.classList.remove('open');
      clearTimeout(window.__toastTimer);
    }
    function showToast(msg, withCartCta) {
      if (isAnyModalOpen()) return;
      var el = document.getElementById('toastBox');
      if (!el) return;
      el.innerHTML = '<span>' + esc(msg) + '</span>' +
        (withCartCta ? '<button type="button" class="toast-cta" onclick="hideToast();openCartModal();">Xem giỏ →</button>' : '');
      el.classList.add('open');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(function() { el.classList.remove('open'); }, 3400);
    }

    function syncCheckoutDraftFromDom() {
      var nEl = document.getElementById('ordName');
      var pEl = document.getElementById('ordPhone');
      var aEl = document.getElementById('ordAddr');
      var mEl = document.getElementById('ordNote');
      if (nEl) STATE.checkoutDraft.name = nEl.value;
      if (pEl) STATE.checkoutDraft.phone = pEl.value;
      if (aEl) STATE.checkoutDraft.addr = aEl.value;
      if (mEl) STATE.checkoutDraft.note = mEl.value;
    }

    function onCheckoutDraftInput(field, val) {
      if (!STATE.checkoutDraft) STATE.checkoutDraft = { name: '', phone: '', addr: '', note: '' };
      STATE.checkoutDraft[field] = String(val == null ? '' : val);
    }

    function formatDisplayTitleClient(rawTitle, variantLabel) {
      var base = String(rawTitle || '').split('— Phân loại:')[0].trim();
      if (!base) return '';
      var vLabel = String(variantLabel || '').trim();
      var hasVar = vLabel.length > 0;
      if (hasVar) {
        base = base.replace(/\\s*\\((?:Hộp|Set|Bộ|Combo)\\s+\\d+\\s*[-–/]\\s*\\d+[^)]*\\)\\s*$/i, '').trim();
      }
      base = base.replace(/\\s*\\(Tặng\\s+Kèm[^)]*\\)/gi, '').trim();
      var dParts = base.split(/\\s+[-–|]\\s+/);
      if (dParts[0] && dParts[0].trim().length >= 8) base = dParts[0].trim();
      if (hasVar) {
        var cIdx = base.indexOf(':');
        if (cIdx >= 10) base = base.slice(0, cIdx).trim();
        var colPart = '(?:Trắng(?:\\\\s+Mộc)?|Kem(?:\\\\s+Bơ)?|Vàng(?:\\\\s+Bơ)?|Cam(?:\\\\s+Đất)?|Xanh(?:\\\\s+Sage|\\\\s+Rêu|\\\\s+Ngọc)?|Đen|Be|Nâu(?:\\\\s+Đất)?|Xám|Hồng(?:\\\\s+Phấn)?)';
        var multiRx = new RegExp('\\\\s+' + colPart + '(?:\\\\s*[,/]\\\\s*' + colPart + ')+', 'gi');
        base = base.replace(multiRx, '').replace(/\\s{2,}/g, ' ').trim();
        if (!/hoa\\s*sen|chum|trái\\s*tim|\\bcm\\b/i.test(vLabel)) {
          base = base.replace(/\\s+\\bTrắng\\s+Mộc\\b/gi, '').replace(/\\s{2,}/g, ' ').trim();
        }
      }
      if (base.length > 34) {
        var shortSeo = base.replace(/\\s*(?:,\\s*)?(?:Chịu\\s+Nhiệt|Kháng\\s+Dầu|Đế\\s+Lót|Đựng\\s+(?:Nến|Đồ|Trang\\s+Sức|Phụ\\s+Kiện|Nụ)|Đổ\\s+Nến(?:\\s+Thơm|\\s+Bơ)?|Lót\\s+Nến|Cắm\\s+Bút|Cúng\\s+Phật)(?:\\s|$|[,.-]).*$/i, '').trim();
        if (shortSeo.length >= 14) base = shortSeo;
      }
      return base.replace(/[,.;:]+$/, '').trim();
    }

    function extractShopeeKeyClient(url) {
      var m = String(url || '').match(/\\/product\\/(\\d+\\/\\d+)/);
      return m && m[1] ? m[1] : '';
    }

    function findSiblingVariantsClient(prod) {
      var prods = (STATE.data && STATE.data.products) || [];
      if (!prod || prods.length <= 1) return [];
      var curParent = String(prod.parentSku || '').trim().toUpperCase();
      var curKey = extractShopeeKeyClient(prod.shopeeUrl);
      var curTitle = formatDisplayTitleClient(prod.cleanTitle || prod.name, prod.variantLabel).toLowerCase();
      var list = prods.filter(function(it) {
        if (!it.variantLabel && !prod.variantLabel) return false;
        var itParent = String(it.parentSku || '').trim().toUpperCase();
        if (curParent && itParent) return curParent === itParent;
        var itTitle = formatDisplayTitleClient(it.cleanTitle || it.name, it.variantLabel).toLowerCase();
        if (curTitle && itTitle && curTitle === itTitle) return true;
        if (curKey && extractShopeeKeyClient(it.shopeeUrl) === curKey) {
          return !curTitle || !itTitle || curTitle === itTitle;
        }
        return false;
      });
      return list.length >= 2 ? list : [];
    }

    function selectRelatedProdsClient(prod, maxItems) {
      var limit = Math.max(1, Math.min(6, Number(maxItems) || 3));
      var prods = (STATE.data && STATE.data.products) || [];
      if (!prod || prods.length <= 1) return [];
      var curFam = String(prod.parentSku || '').trim().toUpperCase() ||
        formatDisplayTitleClient(prod.cleanTitle || prod.name, prod.variantLabel).toLowerCase();
      var seen = {};
      if (curFam) seen[curFam] = true;
      var cands = [];
      prods.forEach(function(it) {
        if (!it || it.id === prod.id || it.availableToOrder === false) return;
        var fam = String(it.parentSku || '').trim().toUpperCase() ||
          formatDisplayTitleClient(it.cleanTitle || it.name, it.variantLabel).toLowerCase() || it.id;
        if (seen[fam]) return;
        seen[fam] = true;
        cands.push(it);
      });
      var curTxt = ((prod.cleanTitle || '') + ' ' + (prod.name || '')).toLowerCase();
      var isCandle = /nến\\s*bơ|tealight/.test(curTxt);
      var isTray = /khay/.test(curTxt);
      function scoreIt(c) {
        var t = ((c.cleanTitle || '') + ' ' + (c.name || '')).toLowerCase();
        var s = c.image ? 10 : 0;
        if (isCandle) {
          if (/chân\\s*nến|đế\\s*nến|hũ/.test(t)) s += 6;
          else if (/khay/.test(t)) s += 4;
        } else if (isTray) {
          if (/hũ|cốc/.test(t)) s += 6;
          else if (/nến\\s*bơ|tealight/.test(t)) s += 5;
        } else {
          if (/nến\\s*bơ|tealight/.test(t)) s += 6;
          else if (/khay/.test(t)) s += 5;
        }
        return s;
      }
      cands.sort(function(a, b) { return scoreIt(b) - scoreIt(a); });
      return cands.slice(0, limit);
    }

    function parseProdDescClient(rawDesc, prod) {
      var rawLines = String(rawDesc || '').replace(/\\r\\n/g, '\\n').split('\\n').map(function(l) { return l.trim(); });
      var hashtagRe = /^#[A-Za-z0-9_\u00C0-\u024F]+(?:\\s+#[A-Za-z0-9_\u00C0-\u024F]+)*$/;
      var bulletRe = /^(?:[-•*▪▫◦+])\\s+/;
      var numHeadRe = /^\\d+\\s*[.)]\\s*(.+)$/;
      var lines = rawLines.filter(function(l) { return l.length > 0 && !hashtagRe.test(l); });

      function cleanHead(h) {
        var c = h.replace(numHeadRe, '$1')
          .replace(/:+\\s*$/, '')
          .replace(/\\s+trên\\s+shopee\\b/gi, '')
          .replace(/\\s*\\(tham\\s+khảo\\)/gi, '')
          .replace(/\\s{2,}/g, ' ')
          .trim();
        if (!c) return 'Thông tin chi tiết';
        var letters = c.replace(/[^A-Za-z\u00C0-\u1EF9]/g, '');
        var uppers = letters.replace(/[^A-Z\u00C0-\u00DE\u0102\u0110\u0128\u0168\u01A0\u01AF]/g, '');
        if (letters.length >= 4 && (c === c.toUpperCase() || uppers.length / letters.length > 0.75)) {
          var low = c.toLowerCase();
          c = low.charAt(0).toUpperCase() + low.slice(1);
          c = c.replace(/\\btealight\\b/gi, 'Tealight').replace(/\\bwabi-sabi\\b/gi, 'Wabi-Sabi').replace(/\\boem\\b/gi, 'OEM');
        }
        return c;
      }

      function tabForTitle(t) {
        var low = t.toLowerCase();
        if (/thông\\s*số|kích\\s*thước|chất\\s*liệu|quy\\s*cách|trọng\\s*lượng|phân\\s*loại\\s*màu|phân\\s*loại\\s*mẫu/.test(low)) return 'SPECS';
        if (/hướng\\s*dẫn|bảo\\s*quản|đóng\\s*gói|lưu\\s*ý|hỗ\\s*trợ|vận\\s*chuyển/.test(low)) return 'CARE';
        return 'OVERVIEW';
      }

      var leads = [];
      var sections = [];
      var curSec = null;

      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var nxt = lines[i + 1] || '';
        var isBul = bulletRe.test(ln);
        var isNumH = !isBul && numHeadRe.test(ln) && ln.length <= 84;
        var isUnnumH = !isBul && ln.length >= 6 && ln.length <= 68 && !/[.!?]$/.test(ln) && (ln.slice(-1) === ':' || bulletRe.test(nxt));

        if (isNumH || isUnnumH) {
          var normT = cleanHead(ln);
          curSec = { title: normT, tab: tabForTitle(normT), bullets: [], paragraphs: [] };
          sections.push(curSec);
          continue;
        }
        if (isBul) {
          if (!curSec) {
            curSec = { title: 'Điểm nổi bật', tab: 'OVERVIEW', bullets: [], paragraphs: [] };
            sections.push(curSec);
          }
          var bBody = ln.replace(bulletRe, '').trim();
          var cIdx = bBody.indexOf(':');
          if (cIdx >= 3 && cIdx <= 46 && !/[.!?]/.test(bBody.slice(0, cIdx))) {
            curSec.bullets.push({ label: bBody.slice(0, cIdx).trim(), text: bBody.slice(cIdx + 1).trim() });
          } else {
            curSec.bullets.push({ label: null, text: bBody });
          }
          continue;
        }
        var cleanLn = ln.replace(/(?:\\s+#[A-Za-z0-9_\u00C0-\u024F]+){2,}\\s*$/, '').trim();
        if (!cleanLn) continue;
        if (!curSec) leads.push(cleanLn);
        else curSec.paragraphs.push(cleanLn);
      }

      var quickSpecs = [];
      function addSpec(lbl, val) {
        if (!lbl || !val || quickSpecs.length >= 4) return;
        var cl = lbl.trim();
        var cv = val.trim().replace(/\\.$/, '');
        if (!cl || !cv) return;
        for (var k = 0; k < quickSpecs.length; k++) {
          if (quickSpecs[k].label.toLowerCase() === cl.toLowerCase()) return;
        }
        quickSpecs.push({ label: cl, value: cv.slice(0, 95) });
      }
      sections.forEach(function(sec) {
        if (sec.tab !== 'SPECS') return;
        sec.bullets.forEach(function(b) {
          if (!b.label || /phân\\s*loại|^hộp\\s+\\d+|^mẫu\\s+|^combo\\s+|^set\\s+/i.test(b.label)) return;
          if (b.text.length > 88) return;
          var sl = b.label
            .replace(/^Kích thước lòng (?:hũ|khay)$/i, 'Lòng trong')
            .replace(/^Trọng lượng vỏ hũ cả nắp$/i, 'Trọng lượng tịnh');
          addSpec(sl, b.text);
        });
      });
      if (quickSpecs.length < 4 && prod && prod.weightGram > 0) {
        var hasW = quickSpecs.some(function(s) { return /trọng\\s*lượng|khối\\s*lượng/i.test(s.label); });
        if (!hasW) addSpec('Khối lượng đóng gói', '~' + prod.weightGram + ' gram');
      }
      if (quickSpecs.length < 4 && prod && prod.dimensionsLabel) {
        var hasD = quickSpecs.some(function(s) { return /kích\\s*thước|đường\\s*kính|lòng/i.test(s.label); });
        if (!hasD) addSpec('Quy cách hộp gửi', prod.dimensionsLabel);
      }
      if (quickSpecs.length < 4 && prod && prod.fragile) {
        addSpec('Đóng gói an toàn', 'Xốp chống sốc đa lớp · Bảo hành 1 đổi 1');
      }
      return { leads: leads, sections: sections, quickSpecs: quickSpecs };
    }

    function cartStorageKey() {
      var cid = String((STATE.data && STATE.data.cmsInstanceId) || 'default')
        .replace(/[^A-Za-z0-9_-]/g, '_')
        .slice(0, 64) || 'default';
      return 'openvn_sf_cart_v1_' + cid;
    }

    function isStoreClosed() {
      return Boolean(STATE.data && (STATE.data.storefrontClosed || (STATE.data.config && STATE.data.config.enabled === false)));
    }

    function isWholesaleAllowed() {
      return !isStoreClosed() && !(STATE.data && STATE.data.config && STATE.data.config.wholesaleEnabled === false);
    }

    function saveCartToStorage() {
      try {
        if (isStoreClosed()) return;
        var key = cartStorageKey();
        if (!STATE.cart || !STATE.cart.length) {
          window.localStorage.removeItem(key);
          return;
        }
        var payload = STATE.cart.slice(0, 60).map(function(it) {
          return {
            productId: String(it.product.id || ''),
            sku: String(it.product.sku || ''),
            quantity: Math.max(1, Math.min(10000, Math.floor(Number(it.quantity) || 1)))
          };
        });
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch (e) {}
    }

    function reconcileItemsAgainstCatalog(rawList, prods) {
      var next = [];
      if (!Array.isArray(rawList) || !Array.isArray(prods) || !prods.length) return next;
      rawList.slice(0, 60).forEach(function(item) {
        if (!item) return;
        var pid = String(item.productId || (item.product && item.product.id) || '').trim();
        var sku = String(item.sku || (item.product && item.product.sku) || '').trim().toUpperCase();
        var qty = Math.max(0, Math.min(10000, Math.floor(Number(item.quantity) || 0)));
        if (qty <= 0 || (!pid && !sku)) return;
        var matched = prods.find(function(p) {
          return (pid && p.id === pid) || (sku && String(p.sku || '').toUpperCase() === sku);
        });
        if (!matched || matched.availableToOrder === false) return;
        var hit = next.find(function(c) { return c.product.id === matched.id; });
        if (hit) hit.quantity = Math.min(10000, hit.quantity + qty);
        else next.push({ product: matched, quantity: qty });
      });
      return next;
    }

    function reconcileCartFromStorage() {
      try {
        if (isStoreClosed()) {
          STATE.cart = [];
          updateCartBadge();
          return;
        }
        var prods = (STATE.data && STATE.data.products) || [];
        var key = cartStorageKey();
        if (STATE.cartHydratedKey !== key) {
          if (!prods.length) return;
          STATE.cartHydratedKey = key;
          var raw = window.localStorage.getItem(key);
          var saved = raw ? JSON.parse(raw) : [];
          var fromStorage = reconcileItemsAgainstCatalog(saved, prods);
          var fromActive = reconcileItemsAgainstCatalog(STATE.cart, prods);
          fromActive.forEach(function(act) {
            var hit = fromStorage.find(function(x) { return x.product.id === act.product.id; });
            if (hit) hit.quantity = Math.min(10000, hit.quantity + act.quantity);
            else fromStorage.push(act);
          });
          STATE.cart = fromStorage;
          saveCartToStorage();
          updateCartBadge();
          return;
        }
        STATE.cart = reconcileItemsAgainstCatalog(STATE.cart, prods);
        saveCartToStorage();
        updateCartBadge();
      } catch (e) {}
    }

    var VIETQR_BANK_ALIASES = {
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
      SHINHANBANK: 'SHBVN'
    };

    function cleanVietQrMemo(raw) {
      return String(raw || '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[đĐ]/g, function(ch) { return ch === 'đ' ? 'd' : 'D'; })
        .replace(/[^A-Za-z0-9 -]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 50);
    }

    function cleanVietQrAccountName(raw) {
      return String(raw || '')
        .normalize('NFD')
        .replace(/[\\u0300-\\u036f]/g, '')
        .replace(/[đĐ]/g, 'D')
        .toUpperCase()
        .replace(/[^A-Za-z0-9 .&-]/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim()
        .slice(0, 70);
    }

    function resolveActiveBank() {
      if (STATE.data && STATE.data.bankTransfer && STATE.data.bankTransfer.bankCode && STATE.data.bankTransfer.bankAccount) {
        return STATE.data.bankTransfer;
      }
      var cfgBank = STATE.data && STATE.data.config && STATE.data.config.bankTransfer;
      if (cfgBank && cfgBank.bankCode && cfgBank.bankAccount) return cfgBank;
      return null;
    }

    function buildVietQrUrl(bank, amount, memo) {
      if (!bank) return '';
      var rawCode = String(bank.bankCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      var code = VIETQR_BANK_ALIASES[rawCode] || rawCode;
      var acct = String(bank.bankAccount || '').trim().replace(/[\\s.-]+/g, '').replace(/[^A-Za-z0-9]/g, '');
      if (code.length < 2 || code.length > 20 || acct.length < 5 || acct.length > 26) return '';
      var qs = [];
      var amt = Math.max(0, Math.round(Number(amount) || 0));
      if (amt > 0) qs.push('amount=' + encodeURIComponent(String(amt)));
      var cleanMemo = cleanVietQrMemo(memo);
      if (cleanMemo) qs.push('addInfo=' + encodeURIComponent(cleanMemo));
      var holder = cleanVietQrAccountName(bank.bankHolder);
      if (holder) qs.push('accountName=' + encodeURIComponent(holder));
      return 'https://img.vietqr.io/image/' + code + '-' + acct + '-compact2.png' + (qs.length ? '?' + qs.join('&') : '');
    }

    function copyTxt(val, label) {
      if (!val) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).then(function() {
          showToast('Đã sao chép ' + label + ': ' + val, false);
        }).catch(function() {
          showToast(label + ': ' + val, false);
        });
      } else {
        showToast(label + ': ' + val, false);
      }
    }

    function shareProdLink(sku) {
      var cleanSku = String(sku || '').trim();
      var base = window.location.origin + '/';
      var url = cleanSku ? (base + '?sku=' + encodeURIComponent(cleanSku)) : base;
      copyTxt(url, 'liên kết sản phẩm');
    }

    function formatLookupStatus(st) {
      var k = String(st || '').trim().toUpperCase();
      var map = {
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
        REFUNDED: 'Đã hoàn tiền'
      };
      return map[k] || (st ? String(st) : 'Đã tiếp nhận');
    }

    function jumpTrackOrder(refCode, phone) {
      var lkCode = document.getElementById('lkCode');
      var lkPhone = document.getElementById('lkPhone');
      if (lkCode && refCode) lkCode.value = refCode;
      if (lkPhone && phone) lkPhone.value = phone;
      STATE.completedOrder = null;
      closeCartModal();
      switchTab('TRACKING');
    }

    function tryOpenPendingDeepLinkSku() {
      if (!STATE.pendingSku || isStoreClosed()) return;
      var target = String(STATE.pendingSku).trim().toUpperCase();
      var hit = ((STATE.data && STATE.data.products) || []).find(function(p) {
        return String(p.sku || '').toUpperCase() === target;
      });
      if (hit) {
        STATE.pendingSku = '';
        openProdModal(hit.id);
      }
    }

    function onSearchInput() {
      var sIn = document.getElementById('searchInput');
      var clr = document.getElementById('searchClearBtn');
      if (clr && sIn) clr.classList.toggle('hidden', !sIn.value);
      renderProducts();
    }

    function clearSearchInput() {
      var sIn = document.getElementById('searchInput');
      var clr = document.getElementById('searchClearBtn');
      if (sIn) {
        sIn.value = '';
        sIn.focus();
      }
      if (clr) clr.classList.add('hidden');
      renderProducts();
    }

    function applyDeepLinkQuery() {
      try {
        var sp = new URLSearchParams(window.location.search || '');
        var rawTab = String(sp.get('tab') || sp.get('section') || '').trim().toUpperCase();
        if ((rawTab === 'WHOLESALE' || rawTab === 'SI' || rawTab === 'BANGGIASI') && isWholesaleAllowed()) switchTab('WHOLESALE');
        else if (rawTab === 'CONTACT' || rawTab === 'LIENHE') switchTab('CONTACT');
        else if (rawTab === 'TRACKING' || rawTab === 'TRACUU' || rawTab === 'LOOKUP') switchTab('TRACKING');

        var rawMode = String(sp.get('mode') || '').trim().toUpperCase();
        if ((rawMode === 'WHOLESALE' || rawMode === 'SI') && isWholesaleAllowed()) setPriceMode('WHOLESALE');
        else if (rawMode === 'RETAIL' || rawMode === 'LE') setPriceMode('RETAIL');

        var q = String(sp.get('q') || sp.get('search') || '').trim().slice(0, 80);
        if (q) {
          var sIn = document.getElementById('searchInput');
          if (sIn) {
            sIn.value = q;
            onSearchInput();
          }
        }

        var code = String(sp.get('code') || sp.get('lookupCode') || '').trim().toUpperCase().slice(0, 48);
        if (code) {
          var lkIn = document.getElementById('lkCode');
          if (lkIn) lkIn.value = code;
          if (!rawTab) switchTab('TRACKING');
        }

        var sku = String(sp.get('sku') || '').trim().toUpperCase();
        if (sku && !isStoreClosed()) {
          STATE.pendingSku = sku;
          tryOpenPendingDeepLinkSku();
        }
      } catch (e) {}
    }

    function switchTab(tab) {
      STATE.tab = tab;
      var heroSec = document.getElementById('heroSection');
      if (heroSec) heroSec.classList.toggle('hidden', tab !== 'PRODUCTS');
      ['PRODUCTS', 'WHOLESALE', 'CONTACT', 'TRACKING'].forEach(function(t) {
        var sec = document.getElementById('sec-' + t);
        var btn = document.getElementById('tab-' + t);
        if (sec) sec.classList.toggle('hidden', t !== tab);
        if (btn) {
          btn.classList.toggle('active', t === tab);
          if (t === tab) btn.setAttribute('aria-current', 'page');
          else btn.removeAttribute('aria-current');
        }
      });
      var beh = prefersReducedMotionClient() ? 'auto' : 'smooth';
      if (tab === 'PRODUCTS') {
        window.scrollTo({ top: 0, behavior: beh });
      } else {
        var mainEl = document.getElementById('mainContent');
        if (mainEl && mainEl.scrollIntoView) {
          mainEl.scrollIntoView({ behavior: beh, block: 'start' });
        } else {
          window.scrollTo({ top: 0, behavior: beh });
        }
      }
    }

    function setPriceMode(mode) {
      STATE.priceMode = mode;
      document.getElementById('modeRetailBtn').className = mode === 'RETAIL' ? 'active' : '';
      document.getElementById('modeWsBtn').className = mode === 'WHOLESALE' ? 'ws-active' : '';
      renderProducts();
    }

    function setCategory(catId) {
      STATE.selectedCat = catId;
      if (catId === 'ALL') STATE.selectedCollectionId = 'ALL';
      renderShopeeBanners();
      renderCategoryPills();
      renderProducts();
    }

    function matchesColFilter(prod, col) {
      if (!col) return true;
      var clean = String(prod.cleanTitle || prod.name || '').split('— Phân loại:')[0].trim().toLowerCase();
      var sku = String(prod.sku || '').toLowerCase();
      var desc = String(prod.description || '').toLowerCase();
      var cName = String(col.name || '').trim().toLowerCase();
      if (cName === 'nến' || col.filterKeyword === '__CANDLE_ONLY__') {
        return clean === 'nến' || clean.indexOf('nến ') === 0 || sku.indexOf('-tea-') >= 0 || sku.indexOf('nen-') === 0;
      }
      if (cName.indexOf('nguyên liệu') >= 0 || cName.indexOf('diy') >= 0) {
        return clean.indexOf('nguyên liệu') >= 0 || clean.indexOf('bột thạch cao') >= 0 || clean.indexOf('khuôn') >= 0 || clean.indexOf('diy') >= 0 || desc.indexOf('bột thạch cao nguyên liệu') >= 0 || desc.indexOf('khuôn silicone') >= 0;
      }
      var expr = String(col.filterKeyword || col.name || '').toLowerCase().replace(/\\bvà\\b/g, '|');
      var toks = expr.split(/[|,;/+&]+/).map(function(t) { return t.trim(); }).filter(function(t) { return t.length >= 2; });
      if (!toks.length) return true;
      return toks.some(function(tok) {
        if (tok === 'đế nến' || tok === 'chân nến') return clean.indexOf('đế nến') >= 0 || clean.indexOf('chân nến') >= 0;
        return clean.indexOf(tok) >= 0 || sku.indexOf(tok) >= 0;
      });
    }

    function findProductByBannerRef(targetSku, shopeePid) {
      var list = (STATE.data && STATE.data.products) || [];
      if (targetSku) {
        var uSku = String(targetSku).trim().toUpperCase();
        var bySku = list.find(function(p) { return String(p.sku || '').toUpperCase() === uSku; });
        if (bySku) return bySku;
      }
      if (shopeePid) {
        var suf = '/' + String(shopeePid).trim();
        var bySp = list.find(function(p) { return p.shopeeUrl && p.shopeeUrl.slice(-suf.length) === suf; });
        if (bySp) return bySp;
      }
      return null;
    }

    function toggleCollectionFilter(colId) {
      STATE.selectedCat = 'ALL';
      STATE.selectedCollectionId = STATE.selectedCollectionId === colId ? 'ALL' : colId;
      renderShopeeBanners();
      renderCategoryPills();
      renderProducts();
    }

    function setCarouselSlide(idx) {
      var banners = (STATE.data && STATE.data.config && STATE.data.config.banners) || {};
      var slides = banners.carouselBanners || [];
      if (!slides.length) return;
      STATE.carouselIdx = ((idx % slides.length) + slides.length) % slides.length;
      renderShopeeBanners();
    }

    function stepCarousel(delta) {
      setCarouselSlide((STATE.carouselIdx || 0) + delta);
    }

    function onBannerRefClick(sku, pid, kw, url) {
      var prod = findProductByBannerRef(sku, pid);
      if (prod) {
        openProdModal(prod.id);
        return;
      }
      if (kw) {
        document.getElementById('searchInput').value = kw;
        onSearchInput();
        return;
      }
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }

    function onCarouselSlideClick(idx) {
      var b = STATE.data && STATE.data.config && STATE.data.config.banners;
      var s = b && b.carouselBanners && b.carouselBanners[idx];
      if (!s) return;
      onBannerRefClick(s.targetSku || '', s.shopeeProductId || '', s.filterKeyword || '', s.linkUrl || '');
    }

    function onSpotlightHotspotClick(sIdx, hIdx) {
      var b = STATE.data && STATE.data.config && STATE.data.config.banners;
      var sb = b && b.spotlightBanners && b.spotlightBanners[sIdx];
      var hs = sb && sb.hotspots && sb.hotspots[hIdx];
      if (!hs) return;
      onBannerRefClick(hs.targetSku || '', hs.shopeeProductId || '', '', hs.linkUrl || '');
    }

    function toggleCollectionIdx(cIdx) {
      var b = STATE.data && STATE.data.config && STATE.data.config.banners;
      var col = b && b.collectionBanners && b.collectionBanners[cIdx];
      if (!col) return;
      var allProds = (STATE.data && STATE.data.products) || [];
      var cnt = allProds.filter(function(p) { return matchesColFilter(p, col); }).length;
      if (cnt === 0) {
        if (col.shopeeUrl) window.open(col.shopeeUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      toggleCollectionFilter(col.id);
    }

    function clampRatioClient(val, fb) {
      var n = Number(val);
      return isFinite(n) && n >= 0.5 && n <= 5 ? Math.round(n * 1000) / 1000 : fb;
    }

    var SVG_FLAME_CLIENT = '${SVG_ICON_FLAME}';
    var SVG_SPARKLES_CLIENT = '${SVG_ICON_SPARKLES}';
    var SVG_PCT_CLIENT = '${SVG_ICON_BADGE_PCT}';
    var SVG_TRUCK_CLIENT = '${SVG_ICON_TRUCK}';
    var SVG_EYE_CLIENT = '${SVG_ICON_EYE_SM}';
    var SVG_TRASH_CLIENT = '${SVG_ICON_TRASH_SM}';

    function minWholesaleQtyClient() {
      var tiers = (STATE.data && STATE.data.config && STATE.data.config.wholesaleTiers) || [];
      if (!tiers.length) return 10;
      return Math.min.apply(null, tiers.map(function(t) { return Math.max(1, Math.floor(Number(t && t.minQty) || 10)); }));
    }

    function shortHeroLabelClient(rawTitle, maxChars) {
      var limit = Math.max(12, Math.min(48, Math.floor(Number(maxChars) || 26)));
      var raw = String(rawTitle || '').split('— Phân loại:')[0].replace(/\\s*\\([^)]*\\)\\s*$/g, '').trim();
      if (!raw) return 'Sản phẩm tiêu biểu';
      var seg = raw.split(/\\s+[-–—|/\\u007c]\\s+|:\\s+/)[0];
      var base = (seg && seg.trim().length >= 6) ? seg.trim() : raw;
      if (base.length <= limit) return base;
      var stopRx = /^(có|không|trắng|kem|xanh|đen|vàng|cam|be|đựng|cúng|lót|cắm|đặt|xi|dùng|phối)$/i;
      var dangRx = /^(nắp|thạch|xi|màu|size|cỡ|dùng|đựng|cho|kèm|và|với|tặng|loại|mẫu|bộ|set)$/i;
      var words = base.split(/\\s+/).filter(Boolean);
      var kept = [];
      for (var i = 0; i < words.length; i++) {
        var cw = words[i].replace(/[,.;:!?]+$/g, '');
        if (!cw) continue;
        var curLen = kept.join(' ').length;
        if (curLen >= 14 && stopRx.test(cw)) break;
        var nextLen = curLen === 0 ? cw.length : (curLen + 1 + cw.length);
        if (kept.length >= 2 && nextLen > limit) break;
        kept.push(cw);
        if (nextLen >= limit) break;
      }
      while (kept.length > 2 && dangRx.test(kept[kept.length - 1])) {
        kept.pop();
      }
      return kept.length >= 2 ? kept.join(' ') : base.slice(0, limit).trim();
    }

    function formatWsSummaryClient(tiers, oemNote) {
      var oemTxt = typeof oemNote === 'string' ? oemNote.trim() : '';
      var hasOem = typeof oemNote === 'boolean' ? oemNote : oemTxt.length > 0;
      var giftBox = typeof oemNote === 'boolean' ? oemNote : /hộp quà|khắc|in logo|oem/i.test(oemTxt);
      var suffix = !hasOem ? '.' : (giftBox ? ' + Khắc/in hộp quà OEM.' : ' + Hỗ trợ gia công theo yêu cầu.');
      if (!Array.isArray(tiers) || !tiers.length) {
        return hasOem
          ? ('Chiết khấu trực tiếp theo mốc số lượng sỉ' + suffix)
          : 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ.';
      }
      var sorted = tiers.slice().filter(function(t) {
        return Number(t && t.minQty) > 0 && Number(t && t.discountPercent) > 0;
      }).sort(function(a, b) { return a.minQty - b.minQty; }).slice(0, 4);
      if (!sorted.length) return 'Chiết khấu trực tiếp theo mốc số lượng đặt sỉ.';
      var parts = sorted.map(function(t) {
        return 'Từ ' + Math.floor(t.minQty) + ' SP giảm ' + (Math.round(t.discountPercent * 10) / 10) + '%';
      });
      return parts.join(' · ') + suffix;
    }

    function resolveHeroCopyClient(d) {
      var cfg = (d && d.config) || {};
      var br = (d && d.brand) || {};
      var prods = (d && d.products) || [];
      var isClosed = Boolean(d && (d.storefrontClosed || cfg.enabled === false));
      var wsOn = !isClosed && cfg.wholesaleEnabled !== false;
      var tList = cfg.wholesaleTiers || [];
      var minQ = tList.length ? Math.min.apply(null, tList.map(function(t) { return Math.max(1, Math.floor(Number(t && t.minQty) || 10)); })) : 10;
      var freeShipFmt = fmtVND(cfg.freeShipThreshold || 500000);
      var retDays = typeof cfg.returnDays === 'number' && isFinite(cfg.returnDays) ? Math.max(0, Math.floor(cfg.returnDays)) : 7;
      var dom = String(cfg.customDomain || '').trim().toLowerCase();
      var sample = prods.slice(0, 6).map(function(p) { return p.cleanTitle || p.name || ''; }).join(' ');
      var corpus = [br.brandName || '', cfg.heroBadge || '', cfg.heroTitle || '', cfg.heroSubtitle || '', sample].join(' ').toLowerCase();
      var isCandle = dom.indexOf('bomoc') === 0 || /nến\\s*bơ|sáp\\s*bơ|thạch\\s*cao|bơ\\s*mộc|tealight/i.test(corpus);
      var brandClean = String(br.brandName || 'Cửa hàng Chính hãng').trim() || 'Cửa hàng Chính hãng';
      var rawWsName = String(br.workshopName || '').trim();
      var hasCustomWs = Boolean(rawWsName) && !/xưởng đúc thủ công|bơ mộc/i.test(rawWsName) && rawWsName.toLowerCase() !== brandClean.toLowerCase();

      var hl3 = isClosed
        ? 'Hỗ trợ tra cứu đơn & CSKH trực tuyến'
        : (wsOn ? ('Sỉ gộp mẫu tự do từ ' + minQ + ' SP') : ('Freeship đơn từ ' + freeShipFmt));

      var rawAnn = String(cfg.announcementBar || '').trim();
      var isDefAnn = !rawAnn || (rawAnn.indexOf('Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000') === 0 && rawAnn.indexOf('Chiết khấu Giá Sỉ') >= 0);
      var effAnn = rawAnn;
      if (isClosed && isDefAnn) {
        effAnn = 'Thông báo: ' + brandClean + ' hiện tạm ngưng nhận đơn trực tuyến để cập nhật danh mục · Hỗ trợ tra cứu đơn đã đặt & tư vấn trực tiếp.';
      } else if (!wsOn && isDefAnn) {
        effAnn = retDays > 0
          ? ('Miễn phí vận chuyển toàn quốc đơn từ ' + freeShipFmt + ' · Kiểm hàng & đổi mới miễn phí trong ' + retDays + ' ngày')
          : ('Miễn phí vận chuyển toàn quốc đơn từ ' + freeShipFmt + ' · Đồng kiểm sản phẩm trước khi thanh toán');
      } else if (!effAnn) {
        effAnn = 'Miễn phí vận chuyển toàn quốc đơn từ ' + freeShipFmt + ' · Chiết khấu Giá Sỉ từ ' + minQ + ' sản phẩm';
      }

      if (isCandle) {
        return {
          isCandle: true,
          effectiveAnnouncementBar: effAnn,
          highlight1: '100% Sáp bơ thực vật không khói',
          highlight2: 'Cốt thạch cao khoáng kháng dầu',
          highlight3: hl3,
          showcaseHeading: 'Tác phẩm tiêu biểu tại xưởng',
          showcaseActionLabel: 'Xem trọn bộ ' + prods.length + ' mẫu →',
          craftIcon: 'FLAME',
          craftPromiseTitle: 'Đúc Thủ Công & Sáp Bơ Thực Vật Thuần Chay',
          craftPromiseDesc: 'Không khói đen, an toàn cho phòng thiền, bàn trà, spa; bề mặt thạch cao kháng dầu mịn đẹp.',
          wsPromiseTitle: wsOn ? 'Chiết Khấu Giá Sỉ Tận Xưởng (Gộp Mẫu Tự Do)' : 'Ưu Đãi Vận Chuyển Toàn Quốc',
          safePromiseTitle: retDays > 0 ? 'Đóng Gói Chống Sốc — Bảo Hành Bể Vỡ 1 Đổi 1' : 'Đóng Gói Chống Sốc Nhiều Lớp Chuyên Dụng',
          safePromiseDesc: retDays > 0
            ? ('Xốp định hình nhiều lớp chuyên dụng, kiểm hàng và đổi mới miễn phí trong ' + retDays + ' ngày.')
            : 'Xốp định hình nhiều lớp chuyên dụng, hỗ trợ kiểm tra sản phẩm ngay khi nhận hàng.'
        };
      }
      return {
        isCandle: false,
        effectiveAnnouncementBar: effAnn,
        highlight1: 'Sản phẩm chính hãng tuyển chọn',
        highlight2: retDays > 0 ? ('Đồng kiểm & đổi trả trong ' + retDays + ' ngày') : 'Đồng kiểm hàng trước khi nhận',
        highlight3: hl3,
        showcaseHeading: 'Sản phẩm tiêu biểu',
        showcaseActionLabel: 'Xem tất cả ' + prods.length + ' SP →',
        craftIcon: 'SPARKLES',
        craftPromiseTitle: hasCustomWs ? (rawWsName + ' — Cam Kết Chất Lượng') : (brandClean + ' — Tuyển Chọn Chính Hãng'),
        craftPromiseDesc: 'Kiểm định chất lượng kỹ lưỡng từng sản phẩm trước khi xuất kho, hình ảnh và thông số minh bạch.',
        wsPromiseTitle: wsOn ? 'Chính Sách Chiết Khấu Sỉ Linh Hoạt (Gộp Mẫu)' : 'Ưu Đãi Vận Chuyển Toàn Quốc',
        safePromiseTitle: retDays > 0 ? ('Đóng Gói Chuẩn — Đổi Trả Trong ' + retDays + ' Ngày') : 'Đóng Gói An Toàn — Đồng Kiểm Khi Nhận',
        safePromiseDesc: retDays > 0
          ? ('Đóng gói tiêu chuẩn giao toàn quốc, kiểm hàng khi nhận và hỗ trợ đổi mới trong ' + retDays + ' ngày.')
          : 'Đóng gói tiêu chuẩn giao toàn quốc, quý khách được kiểm tra sản phẩm trước khi thanh toán.'
      };
    }

    function selectHeroProductsClient(prods, maxItems) {
      var limit = maxItems || 3;
      if (!Array.isArray(prods) || limit <= 0) return [];
      var withImg = prods.filter(function(p) { return Boolean(p && typeof p.image === 'string' && p.image.trim()); });
      if (!withImg.length) return [];
      var orderable = withImg.filter(function(p) { return p.availableToOrder !== false; });
      var pool = orderable.length ? orderable : withImg;
      var byTitle = {};
      var keys = [];
      pool.forEach(function(p) {
        var k = String(p.cleanTitle || p.name || p.sku).split('— Phân loại:')[0].trim().toLowerCase();
        if (!byTitle[k]) {
          byTitle[k] = p;
          keys.push(k);
        } else if (!byTitle[k].inStock && Boolean(p.inStock)) {
          byTitle[k] = p;
        }
      });
      var distinct = keys.map(function(k) { return byTitle[k]; });
      var selected = [];
      var used = {};
      var familyFns = [
        function(lead) { return lead.indexOf('hũ ') === 0 || lead.indexOf('cốc ') === 0; },
        function(lead) { return lead.indexOf('nến ') === 0 || lead.indexOf('nến bơ') >= 0 || lead.indexOf('tealight') >= 0; },
        function(lead) { return lead.indexOf('khay ') === 0 || lead.indexOf('đế nến') >= 0 || lead.indexOf('chân nến') >= 0; }
      ];
      familyFns.forEach(function(fn) {
        if (selected.length >= limit) return;
        var hit = distinct.find(function(p) {
          var lead = String(p.cleanTitle || p.name || '').trim().slice(0, 32).toLowerCase();
          return !used[p.id] && fn(lead);
        });
        if (hit) {
          selected.push(hit);
          used[hit.id] = true;
        }
      });
      distinct.forEach(function(p) {
        if (selected.length < limit && !used[p.id]) {
          selected.push(p);
          used[p.id] = true;
        }
      });
      pool.forEach(function(p) {
        if (selected.length < limit && !used[p.id]) {
          selected.push(p);
          used[p.id] = true;
        }
      });
      return selected;
    }

    function scrollToCatalog() {
      STATE.tab = 'PRODUCTS';
      var heroSec = document.getElementById('heroSection');
      if (heroSec) heroSec.classList.remove('hidden');
      ['PRODUCTS', 'WHOLESALE', 'CONTACT', 'TRACKING'].forEach(function(t) {
        var sec = document.getElementById('sec-' + t);
        var btn = document.getElementById('tab-' + t);
        if (sec) sec.classList.toggle('hidden', t !== 'PRODUCTS');
        if (btn) btn.classList.toggle('active', t === 'PRODUCTS');
      });
      var mainEl = document.getElementById('mainContent');
      var beh = prefersReducedMotionClient() ? 'auto' : 'smooth';
      if (mainEl && mainEl.scrollIntoView) {
        mainEl.scrollIntoView({ behavior: beh, block: 'start' });
      }
    }

    function onHeroStageClick() {
      if (STATE.heroStageProductId) {
        openProdModal(STATE.heroStageProductId);
        return;
      }
      scrollToCatalog();
    }

    function openHeroShowcaseIdx(idx) {
      var list = STATE.heroShowcase || [];
      var item = list[idx];
      if (item && item.id) {
        openProdModal(item.id);
      }
    }

    function renderShopeeBanners() {
      var wrap = document.getElementById('shopeeBannerShowcase');
      if (!wrap) return;
      var isClosed = Boolean(STATE.data && (STATE.data.storefrontClosed || (STATE.data.config && STATE.data.config.enabled === false)));
      var banners = (STATE.data && STATE.data.config && STATE.data.config.banners) || null;
      var showBanners = Boolean(!isClosed && banners && banners.enabled !== false);
      var heroCover = document.getElementById('heroCoverWrap');
      var heroMainGrid = document.getElementById('heroMainGrid');
      var brandNameTxt = (STATE.data && STATE.data.brand && STATE.data.brand.brandName) || 'Cửa hàng';
      var allProdsForHero = (STATE.data && STATE.data.products) || [];
      var pickedHero = isClosed ? [] : selectHeroProductsClient(allProdsForHero, 3);
      var heroCopyLive = resolveHeroCopyClient(STATE.data);

      if (banners && banners.shopLogoUrl) {
        var logoWrap = document.getElementById('brandLogoWrap');
        if (logoWrap) {
          logoWrap.innerHTML = '<img src="' + esc(banners.shopLogoUrl) + '" alt="' + esc(brandNameTxt) + '" referrerpolicy="no-referrer" class="brand-logo-img" />';
        }
      }

      if (heroCover) {
        var stageUrl = '';
        var stageMobUrl = '';
        var stageAlt = '';
        var stageProd = null;
        var stripItems = pickedHero;
        if (!isClosed) {
          if (showBanners && banners.coverBannerUrl) {
            stageUrl = banners.coverBannerUrl;
            stageMobUrl = banners.mobileCoverBannerUrl || '';
            stageAlt = brandNameTxt + ' — Không gian trưng bày chính thức';
          } else if (showBanners && banners.carouselBanners && banners.carouselBanners[0] && banners.carouselBanners[0].imageUrl) {
            stageUrl = banners.carouselBanners[0].imageUrl;
            stageMobUrl = banners.carouselBanners[0].mobileImageUrl || '';
            stageAlt = banners.carouselBanners[0].title || (brandNameTxt + ' — Bộ sưu tập nổi bật');
          } else if (pickedHero[0] && pickedHero[0].image) {
            stageUrl = pickedHero[0].image;
            stageAlt = pickedHero[0].cleanTitle || pickedHero[0].name;
            stageProd = pickedHero[0];
            stripItems = pickedHero.length >= 2 ? pickedHero : [];
          }
        }
        STATE.heroStageProductId = stageProd ? stageProd.id : '';
        STATE.heroShowcase = stripItems;

        var hasVisual = Boolean(stageUrl || stripItems.length > 0);
        if (heroMainGrid) {
          heroMainGrid.classList.toggle('single', !hasVisual);
        }
        if (hasVisual) {
          heroCover.className = 'hero-showcase-card';
          var capHtml = stageProd
            ? '<span class="hero-stage-caption fallback"><span class="hero-stage-cap-name">' + esc(shortHeroLabelClient(stageProd.cleanTitle || stageProd.name, 36)) + '</span><span class="hero-stage-cap-price">' + fmtVND(stageProd.retailPrice) + ' · Xem →</span></span>'
            : '<span class="hero-stage-caption">Khám phá bộ sưu tập ›</span>';
          var coverPart = stageUrl
            ? '<button type="button" class="hero-cover-media" onclick="onHeroStageClick()" aria-label="' + esc(stageAlt) + '"><picture>' +
                (stageMobUrl ? '<source media="(max-width: 640px)" srcset="' + esc(stageMobUrl) + '" />' : '') +
                '<img src="' + esc(stageUrl) + '" alt="' + esc(stageAlt) + '" referrerpolicy="no-referrer" />' +
              '</picture>' + capHtml + '</button>'
            : '';
          var colsCnt = Math.min(3, Math.max(1, stripItems.length || 3));
          var stripPart = stripItems.length > 0
            ? '<div class="hero-featured-strip' + (stageUrl ? ' with-cover' : '') + '">' +
                '<div class="hero-featured-head">' +
                  '<span>' + esc(heroCopyLive.showcaseHeading) + '</span>' +
                  '<button type="button" class="hero-featured-more" onclick="scrollToCatalog()">' + esc(heroCopyLive.showcaseActionLabel) + '</button>' +
                '</div>' +
                '<div class="hero-featured-grid cols-' + colsCnt + '">' +
                  stripItems.map(function(it, idx) {
                    return '<button type="button" class="hero-mini-item" onclick="openHeroShowcaseIdx(' + idx + ')">' +
                      (it.image ? '<img src="' + esc(it.image) + '" alt="' + esc(it.cleanTitle || it.name) + '" referrerpolicy="no-referrer" loading="lazy" />' : '') +
                      '<div class="hero-mini-meta">' +
                        '<div class="hero-mini-name">' + esc(shortHeroLabelClient(it.cleanTitle || it.name)) + '</div>' +
                        '<div class="hero-mini-price">' + fmtVND(it.retailPrice) + '</div>' +
                      '</div>' +
                    '</button>';
                  }).join('') +
                '</div>' +
              '</div>'
            : '';
          heroCover.innerHTML = coverPart + stripPart;
        } else {
          heroCover.className = 'hidden';
          heroCover.innerHTML = '';
        }
      }

      if (isClosed || !banners || banners.enabled === false) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        return;
      }

      var carousels = banners.carouselBanners || [];
      var spotlights = banners.spotlightBanners || [];
      var collections = banners.collectionBanners || [];
      if (!carousels.length && !spotlights.length && !collections.length) {
        wrap.classList.add('hidden');
        wrap.innerHTML = '';
        return;
      }

      if (STATE.carouselIdx >= carousels.length) STATE.carouselIdx = 0;
      wrap.classList.remove('hidden');

      var topHtml = '';
      if (carousels.length || spotlights.length) {
        var totalCards = (carousels.length ? 1 : 0) + spotlights.length;
        var singleCls = totalCards <= 1 ? ' single' : '';
        topHtml += '<div class="banner-top-grid' + singleCls + '">';

        if (carousels.length) {
          var slidesHtml = carousels.map(function(s, i) {
            var act = i === STATE.carouselIdx ? ' active' : '';
            var clickable = Boolean(s.targetSku || s.shopeeProductId || s.filterKeyword || s.linkUrl);
            var picHtml = '<picture>' +
              (s.mobileImageUrl ? '<source media="(max-width: 640px)" srcset="' + esc(s.mobileImageUrl) + '" />' : '') +
              '<img src="' + esc(s.imageUrl) + '" alt="' + esc(s.title || (brandNameTxt + ' #' + (i + 1))) + '" referrerpolicy="no-referrer" />' +
            '</picture>';
            return '<div class="carousel-slide' + act + '" aria-hidden="' + (i === STATE.carouselIdx ? 'false' : 'true') + '">' +
              (clickable
                ? '<button type="button" class="carousel-hit-btn" aria-label="' + esc(s.title || ('Xem bộ sưu tập #' + (i + 1))) + '" onclick="onCarouselSlideClick(' + i + ')">' + picHtml + '</button>'
                : picHtml) +
            '</div>';
          }).join('');

          var navBtns = carousels.length > 1
            ? '<button type="button" class="carousel-nav prev" aria-label="Banner trước" onclick="stepCarousel(-1)">‹</button>' +
              '<button type="button" class="carousel-nav next" aria-label="Banner tiếp" onclick="stepCarousel(1)">›</button>'
            : '';

          var dotsHtml = carousels.map(function(s, i) {
            return '<button type="button" class="carousel-dot' + (i === STATE.carouselIdx ? ' active' : '') + '" aria-label="Slide ' + (i + 1) + '" onclick="setCarouselSlide(' + i + ')"></button>';
          }).join('');

          var curSlide = carousels[STATE.carouselIdx] || {};
          var barTitle = curSlide.title || ('Bộ sưu tập Thủ công ' + brandNameTxt);

          topHtml += '<div class="banner-card" onmouseenter="STATE.carouselPaused=true" onmouseleave="STATE.carouselPaused=false">' +
            '<div class="carousel-stage">' + slidesHtml + navBtns + '</div>' +
            '<div class="carousel-bar">' +
              '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:8px;">' + esc(barTitle) + ' (' + (STATE.carouselIdx + 1) + '/' + carousels.length + ')</span>' +
              '<div class="carousel-dots">' + dotsHtml + '</div>' +
            '</div>' +
          '</div>';
        }

        spotlights.forEach(function(sb, sIdx) {
          var ratio = clampRatioClient(sb.aspectRatio, 1.796);
          var hsHtml = (sb.hotspots || []).map(function(hs, hIdx) {
            var matched = findProductByBannerRef(hs.targetSku, hs.shopeeProductId);
            var lbl = (matched && matched.cleanTitle) || hs.label || ('Xem sản phẩm #' + (hIdx + 1));
            var pillInner = matched ? ('<span>' + esc(fmtVND(matched.retailPrice)) + '</span>' + SVG_EYE_CLIENT) : ('<span>Xem SP</span>' + SVG_EYE_CLIENT);
            return '<button type="button" class="hotspot-zone" title="' + esc(lbl) + '" aria-label="' + esc(lbl) + '"' +
              ' style="left:' + hs.x + '%;top:' + hs.y + '%;width:' + hs.w + '%;height:' + hs.h + '%;"' +
              ' onclick="onSpotlightHotspotClick(' + sIdx + ',' + hIdx + ')">' +
              '<span class="hotspot-pill">' + pillInner + '</span>' +
            '</button>';
          }).join('');

          topHtml += '<div class="banner-card">' +
            '<div class="hotspot-stage" style="aspect-ratio:' + ratio + ';">' +
              '<picture>' +
                (sb.mobileImageUrl ? '<source media="(max-width: 640px)" srcset="' + esc(sb.mobileImageUrl) + '" />' : '') +
                '<img src="' + esc(sb.imageUrl) + '" alt="' + esc(sb.title || (brandNameTxt + ' tiêu điểm')) + '" referrerpolicy="no-referrer" />' +
              '</picture>' +
              hsHtml +
            '</div>' +
          '</div>';
        });

        topHtml += '</div>';
      }

      var colHtml = '';
      if (collections.length) {
        var allProds = (STATE.data && STATE.data.products) || [];
        var visibleCols = collections.map(function(col, cIdx) {
          var cnt = allProds.filter(function(p) { return matchesColFilter(p, col); }).length;
          return { col: col, cIdx: cIdx, cnt: cnt };
        }).filter(function(entry) {
          return entry.cnt > 0 || Boolean(entry.col.shopeeUrl);
        });

        if (visibleCols.length) {
          var gridColsCls = visibleCols.length === 3 ? ' cols-3' : (visibleCols.length <= 2 ? ' cols-2' : '');
          colHtml = '<div class="col-banner-grid' + gridColsCls + '">' + visibleCols.map(function(entry) {
            var col = entry.col;
            var cnt = entry.cnt;
            if (cnt === 0 && col.shopeeUrl) {
              return '<a href="' + esc(col.shopeeUrl) + '" target="_blank" rel="noopener noreferrer" class="col-banner-btn">' +
                '<img src="' + esc(col.imageUrl) + '" alt="' + esc(col.name) + '" referrerpolicy="no-referrer" loading="lazy" />' +
                '<div style="min-width:0;flex:1;">' +
                  '<div class="col-banner-title">' + esc(col.name) + '</div>' +
                  '<div class="col-banner-sub shopee">Xem trên Shopee ↗</div>' +
                '</div>' +
              '</a>';
            }
            var isAct = STATE.selectedCollectionId === col.id;
            return '<button type="button" class="col-banner-btn' + (isAct ? ' active' : '') + '" onclick="toggleCollectionIdx(' + entry.cIdx + ')">' +
              '<img src="' + esc(col.imageUrl) + '" alt="' + esc(col.name) + '" referrerpolicy="no-referrer" loading="lazy" />' +
              '<div style="min-width:0;flex:1;">' +
                '<div class="col-banner-title">' + esc(col.name) + '</div>' +
                '<div class="col-banner-sub">' + (isAct ? 'Đang lọc · Bỏ chọn' : (cnt + ' mẫu tại xưởng')) + '</div>' +
              '</div>' +
            '</button>';
          }).join('') + '</div>';
        }
      }

      wrap.innerHTML = topHtml + colHtml;
    }

    function renderCategoryPills() {
      var cats = (STATE.data && STATE.data.categories) || [];
      var cols = (STATE.data && STATE.data.config && STATE.data.config.banners && STATE.data.config.banners.collectionBanners) || [];
      var allProds = (STATE.data && STATE.data.products) || [];
      var activeCol = STATE.selectedCollectionId === 'ALL' ? null : cols.find(function(x) {
        return x.id === STATE.selectedCollectionId && allProds.some(function(p) { return matchesColFilter(p, x); });
      });
      var row = document.getElementById('catFilterRow');
      if (!row) return;
      if (cats.length <= 1 && !activeCol) {
        row.classList.remove('visible');
        row.innerHTML = '';
        return;
      }
      row.classList.add('visible');
      var totalLen = allProds.length;
      var html = '<button type="button" class="tab-btn ' + (STATE.selectedCat === 'ALL' && !activeCol ? 'active' : '') + '" style="min-height:34px;border-radius:999px;border-color:#e5ded5;font-size:12px;" onclick="setCategory(\\'ALL\\')">Tất cả (' + totalLen + ')</button>';
      if (activeCol) {
        html += '<button type="button" class="tab-btn wholesale active" style="min-height:34px;border-radius:999px;font-size:12px;" onclick="toggleCollectionFilter(\\'' + jsAttr(activeCol.id) + '\\')">Bộ sưu tập: ' + esc(activeCol.name) + ' ✕</button>';
        if (activeCol.shopeeUrl) {
          html += '<a href="' + esc(activeCol.shopeeUrl) + '" target="_blank" rel="noopener" class="btn-outline" style="min-height:34px;border-radius:999px;font-size:11.5px;padding:0 12px;">Xem trên Shopee ↗</a>';
        }
      }
      if (cats.length > 1) {
        html += cats.map(function(c) {
          var isAct = STATE.selectedCat === c.id;
          return '<button type="button" class="tab-btn ' + (isAct ? 'active' : '') + '" style="min-height:34px;border-radius:999px;border-color:#e5ded5;font-size:12px;" onclick="setCategory(\\'' + jsAttr(c.id) + '\\')">' + esc(c.name) + '</button>';
        }).join('');
      }
      row.innerHTML = html;
    }

    function renderProducts() {
      var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
      var sort = document.getElementById('sortSelect').value;
      var grid = document.getElementById('productGrid');
      var isClosed = Boolean(STATE.data && (STATE.data.storefrontClosed || (STATE.data.config && STATE.data.config.enabled === false)));
      var tb = document.getElementById('catalogToolbar');
      if (tb) tb.classList.toggle('hidden', isClosed);
      document.getElementById('prodCountNav').textContent = String(((STATE.data && STATE.data.products) || []).length);

      if (isClosed) {
        grid.innerHTML = '<div class="panel closed-store-panel">' +
          '<h3 style="font-size:16px;font-weight:800;margin-bottom:6px;">Website hiện đang tạm ngưng nhận đơn trực tuyến để cập nhật danh mục</h3>' +
          '<p style="font-size:13px;color:#57534e;margin-bottom:14px;">Quý khách vẫn có thể tra cứu trạng thái đơn hàng đã đặt hoặc gửi tin nhắn liên hệ trực tiếp để được phục vụ ngay.</p>' +
          '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn-primary" onclick="switchTab(\\'CONTACT\\')">Liên hệ Cửa hàng</button>' +
            '<button type="button" class="btn-outline" onclick="switchTab(\\'TRACKING\\')">Tra cứu đơn hàng</button>' +
          '</div></div>';
        return;
      }

      var wsAllowed = !(STATE.data && STATE.data.config && STATE.data.config.wholesaleEnabled === false);
      var cols = (STATE.data && STATE.data.config && STATE.data.config.banners && STATE.data.config.banners.collectionBanners) || [];
      var allProds = (STATE.data && STATE.data.products) || [];
      var activeCol = STATE.selectedCollectionId === 'ALL' ? null : cols.find(function(x) {
        return x.id === STATE.selectedCollectionId && allProds.some(function(p) { return matchesColFilter(p, x); });
      });
      var list = allProds.filter(function(p) {
        if (STATE.selectedCat !== 'ALL' && p.categoryId !== STATE.selectedCat) return false;
        if (activeCol && !matchesColFilter(p, activeCol)) return false;
        if (!q) return true;
        return p.name.toLowerCase().indexOf(q) >= 0 || (p.cleanTitle || '').toLowerCase().indexOf(q) >= 0 || p.sku.toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0;
      });
      if (sort === 'PRICE_ASC') list.sort(function(a, b) { return a.retailPrice - b.retailPrice; });
      if (sort === 'PRICE_DESC') list.sort(function(a, b) { return b.retailPrice - a.retailPrice; });

      if (!list.length) {
        grid.innerHTML = '<div class="panel" style="grid-column:1/-1;text-align:center;padding:40px;">' +
          '<p style="font-weight:700;margin-bottom:10px;">Không tìm thấy sản phẩm phù hợp với từ khóa.</p>' +
          '<button type="button" class="btn-outline" onclick="clearSearchInput();setCategory(\\'ALL\\');">Xem toàn bộ ' + allProds.length + ' mẫu</button>' +
        '</div>';
        return;
      }
      grid.innerHTML = list.map(function(p) {
        var wsList = wsAllowed ? (p.wholesalePrices || []) : [];
        var firstWs = wsList[0];
        var bestWs = wsList[wsList.length - 1];
        var canBuy = p.availableToOrder !== false;
        var cardTitle = formatDisplayTitleClient(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle || p.name;
        var priceHtml = '';
        if (STATE.priceMode === 'WHOLESALE' && wsList.length) {
          priceHtml = '<div class="ws-mini-table">' +
            '<div class="ws-mini-row" style="color:#57534e"><span>Giá lẻ:</span><span class="money" style="text-decoration:line-through">' + fmtVND(p.retailPrice) + '</span></div>' +
            wsList.map(function(w) {
              return '<div class="ws-mini-row"><span>Từ ' + w.minQty + ' SP (' + esc(w.badge) + '):</span><strong class="money" style="color:#6f3d15">' + fmtVND(w.unitPrice) + '</strong></div>';
            }).join('') +
            '</div>';
        } else {
          priceHtml = '<div><span class="retail-price">' + fmtVND(p.retailPrice) + '</span> <small style="color:#57534e">/ ' + esc(p.unit) + '</small></div>' +
            (firstWs ? '<div class="ws-hint">Giá sỉ từ ' + firstWs.minQty + ' SP: <strong class="money">' + fmtVND(firstWs.unitPrice) + '</strong></div>' : '');
        }
        var addQty = (STATE.priceMode === 'WHOLESALE' && firstWs) ? firstWs.minQty : 1;
        return '<article class="prod-card">' +
          '<button type="button" class="prod-img-wrap" aria-label="Xem nhanh ' + esc(cardTitle) + '" onclick="openProdModal(\\'' + jsAttr(p.id) + '\\')">' +
            (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(cardTitle) + '" loading="lazy" />' : '') +
            (p.variantLabel ? '<span class="badge-var">' + esc(p.variantLabel) + '</span>' : '') +
            (bestWs ? '<span class="badge-ws">Sỉ từ ' + fmtVND(bestWs.unitPrice) + '</span>' : '') +
          '</button>' +
          '<div class="prod-body">' +
            '<div>' +
              '<div class="sku-line"><span class="stock-ok">' + esc(p.stockLabel || 'Sẵn sàng đặt') + '</span></div>' +
              '<h3 class="prod-title"><button type="button" class="prod-title-btn" onclick="openProdModal(\\'' + jsAttr(p.id) + '\\')">' + esc(cardTitle) + '</button></h3>' +
              (p.variantLabel ? '<div class="prod-var-txt">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') +
            '</div>' +
            '<div class="price-area">' +
              priceHtml +
              '<div class="card-actions">' +
                '<button type="button" class="btn-sm-out" onclick="openProdModal(\\'' + jsAttr(p.id) + '\\')">Chi tiết</button>' +
                (canBuy
                  ? '<button type="button" class="btn-sm-buy" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',' + addQty + ')">+ ' + (addQty > 1 ? 'Thêm ' + addQty + ' SP' : 'Chọn mua') + '</button>'
                  : '<button type="button" class="btn-sm-out" disabled style="opacity:0.55;cursor:not-allowed;">Tạm hết hàng</button>') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    function updateWsSimulator() {
      var box = document.getElementById('wsSimBox');
      var qIn = document.getElementById('wsQty');
      if (!box) return;
      var tiers = ((STATE.data && STATE.data.config && STATE.data.config.wholesaleTiers) || []).slice().sort(function(a, b) { return b.minQty - a.minQty; });
      var minQ = minWholesaleQtyClient();
      var qty = Math.max(minQ, Math.floor(Number(qIn && qIn.value) || 30));
      var matched = tiers.find(function(t) { return qty >= t.minQty; }) || tiers[tiers.length - 1] || null;
      box.innerHTML = '<div style="display:flex;justify-content:space-between;gap:8px;"><span>Sản lượng dự kiến mỗi đơn:</span><strong class="money" style="color:#6f3d15">' + qty + ' sản phẩm</strong></div>' +
        (matched ? '<div style="margin-top:4px;font-size:11.5px;color:#57534e;">Mức áp dụng dự kiến: <strong style="color:#1c1917">' + esc(matched.label) + ' (Chiết khấu ' + matched.discountPercent + '%)</strong></div>' : '');
    }

    function renderWholesaleSection() {
      var tiers = (STATE.data.config && STATE.data.config.wholesaleTiers) || [];
      document.getElementById('tierCardsGrid').innerHTML = tiers.map(function(t, i) {
        return '<div class="tier-card ' + (i === 1 ? 'featured' : '') + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<span class="domain-pill" style="background:#8c4f1e;color:#fff;border:none;">Chiết khấu ' + esc(t.badge) + '</span>' +
            '<small style="font-weight:700;color:#57534e">Tối thiểu ' + t.minQty + ' SP</small>' +
          '</div>' +
          '<h3 style="font-size:15.5px;font-weight:800;margin-bottom:4px;">' + esc(t.label) + '</h3>' +
          '<p style="font-size:12.5px;color:#57534e;">' + esc(t.description) + '</p>' +
        '</div>';
      }).join('');

      document.getElementById('wsTableHead').innerHTML = '<tr><th>Sản phẩm / SKU</th><th class="num">Giá lẻ</th>' +
        tiers.map(function(t) { return '<th class="num">Từ ' + t.minQty + ' SP (' + esc(t.badge) + ')</th>'; }).join('') +
        '<th style="text-align:center;white-space:nowrap;">Đặt sỉ</th></tr>';

      var minQWs = minWholesaleQtyClient();
      var prods = STATE.data.products || [];
      document.getElementById('wsTableBody').innerHTML = prods.map(function(p) {
        var canBuy = p.availableToOrder !== false;
        var rowTitle = formatDisplayTitleClient(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle || p.name;
        return '<tr>' +
          '<td><div class="sku-code" style="font-size:10.5px;color:#57534e">' + esc(p.sku) + '</div><strong>' + esc(rowTitle) + '</strong>' +
          (p.variantLabel ? '<div style="font-size:11.5px;color:#6f3d15;font-weight:600;">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') + '</td>' +
          '<td class="num" style="color:#57534e">' + fmtVND(p.retailPrice) + '</td>' +
          tiers.map(function(t) {
            return '<td class="num"><strong>' + fmtVND(calcWsPrice(p.retailPrice, t.discountPercent)) + '</strong></td>';
          }).join('') +
          '<td style="text-align:center">' +
            (canBuy
              ? '<button type="button" class="btn-sm-out" style="padding:0 12px;min-height:36px;" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',' + minQWs + ')">+' + minQWs + '</button>'
              : '<button type="button" class="btn-sm-out" disabled style="padding:0 8px;min-height:36px;opacity:0.55;cursor:not-allowed;">Tạm hết</button>') +
          '</td>' +
        '</tr>';
      }).join('');

      var mBox = document.getElementById('wsMobileCards');
      if (mBox) {
        mBox.innerHTML = prods.map(function(p) {
          var canBuy = p.availableToOrder !== false;
          var cTitle = formatDisplayTitleClient(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle || p.name;
          return '<div class="ws-m-card">' +
            '<div class="ws-m-head">' +
              (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(cTitle) + '" loading="lazy" />' : '') +
              '<div style="min-width:0;flex:1;">' +
                '<div style="font-size:13px;font-weight:800;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + esc(cTitle) + '</div>' +
                '<div style="font-size:11px;margin-top:3px;">' +
                  (p.variantLabel ? '<strong style="color:#6f3d15;">' + esc(p.variantLabel) + '</strong> · ' : '') +
                  '<span class="sku-code" style="font-size:10px;color:#57534e;">' + esc(p.sku) + '</span>' +
                '</div>' +
              '</div>' +
            '</div>' +
            '<div class="ws-m-tiers">' +
              tiers.slice(0, 3).map(function(t) {
                return '<div><div style="font-size:10px;color:#57534e;font-weight:650;">≥' + t.minQty + ' (' + esc(t.badge) + ')</div>' +
                  '<div class="money" style="font-size:12px;font-weight:850;color:#6f3d15;margin-top:2px;">' + fmtVND(calcWsPrice(p.retailPrice, t.discountPercent)) + '</div></div>';
              }).join('') +
            '</div>' +
            '<div class="ws-m-foot">' +
              '<span style="font-size:11.5px;color:#57534e;">Giá lẻ: <span class="money" style="text-decoration:line-through;">' + fmtVND(p.retailPrice) + '</span></span>' +
              (canBuy
                ? '<button type="button" class="btn-sm-buy" style="min-height:38px;padding:0 14px;" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',' + minQWs + ')">+ Thêm ' + minQWs + ' ' + esc(p.unit) + '</button>'
                : '<button type="button" class="btn-sm-out" disabled style="min-height:38px;opacity:0.55;">Tạm hết</button>') +
            '</div>' +
          '</div>';
        }).join('');
      }
      updateWsSimulator();
    }

    function renderContactSection() {
      var c = (STATE.data.config && STATE.data.config.contact) || {};
      var bName = (STATE.data.brand && STATE.data.brand.brandName) || 'Xưởng';
      var items = [
        c.hotline ? { label: 'Hotline Tư vấn & Đặt sỉ nhanh', html: '<a href="tel:' + esc(c.hotline.replace(/\\s+/g,'')) + '">' + esc(c.hotline) + '</a>' } : null,
        c.zaloUrl ? { label: 'Zalo Báo Sỉ & CSKH Trực Tuyến', html: '<a href="' + esc(c.zaloUrl) + '" target="_blank" rel="noopener" style="color:#8c4f1e">' + esc(c.zaloUrl) + ' ↗</a>' } : null,
        (!c.hotline && !c.zaloUrl) ? { highlight: true, label: 'Tiếp nhận tư vấn trực tuyến 24/7 qua Hộp thư CMS', html: '<span style="font-size:12.5px;color:#57534e;display:block;margin-top:2px;">Để lại SĐT/Zalo tại biểu mẫu bên cạnh — bộ phận CSKH &amp; ' + esc(bName) + ' tiếp nhận tức thì và phản hồi trực tiếp cho bạn.</span>' } : null,
        c.shopeeUrl ? { label: 'Gian hàng Shopee Chính hãng', html: '<a href="' + esc(c.shopeeUrl) + '" target="_blank" rel="noopener" style="color:#c2410c">' + esc(c.shopeeUrl) + ' ↗</a>' } : null,
        c.email ? { label: 'Email Hợp tác & Báo giá Doanh nghiệp', html: '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' } : null,
        c.address ? { label: 'Địa chỉ Xưởng / Showroom Chính thức', html: '<strong>' + esc(c.address) + '</strong>' } : null,
        c.workingHours ? { label: 'Giờ mở cửa & Hỗ trợ', html: '<strong>' + esc(c.workingHours) + '</strong>' } : null
      ].filter(Boolean);
      document.getElementById('contactDetailsList').innerHTML = items.map(function(it) {
        return '<div class="contact-item' + (it.highlight ? ' highlight' : '') + '"><small>' + esc(it.label) + '</small>' + it.html + '</div>';
      }).join('');
    }

    function syncUrlSkuParam(skuVal) {
      try {
        if (!window.history || typeof window.history.replaceState !== 'function' || !window.location || !window.location.href) return;
        var u = new URL(window.location.href);
        if (skuVal) u.searchParams.set('sku', skuVal);
        else u.searchParams.delete('sku');
        window.history.replaceState(null, '', u.pathname + u.search + u.hash);
      } catch (e) {}
    }

    function setModalImgIdx(idx) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === STATE.modalProdId; });
      if (!p) return;
      var imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.image ? [p.image] : []);
      var len = imgs.length || 1;
      STATE.modalImgIdx = ((idx % len) + len) % len;
      renderProdModalContent();
      syncZoomModalDom();
    }

    function stepModalImg(delta) {
      setModalImgIdx((STATE.modalImgIdx || 0) + delta);
    }

    function setModalTab(tabKey) {
      STATE.modalTab = tabKey;
      renderProdModalContent();
    }

    function setModalQtyDirect(nextQty) {
      STATE.modalQty = Math.max(1, Math.min(999, Math.floor(Number(nextQty) || 1)));
      renderProdModalContent();
    }

    function stepModalQty(delta) {
      setModalQtyDirect((STATE.modalQty || 1) + delta);
    }

    function syncZoomModalDom() {
      var zModal = document.getElementById('prodZoomModal');
      if (!zModal) return;
      if (!STATE.zoomOpen) {
        zModal.classList.remove('open');
        zModal.setAttribute('aria-hidden', 'true');
        return;
      }
      var p = (STATE.data.products || []).find(function(x) { return x.id === STATE.modalProdId; });
      var imgs = p && Array.isArray(p.images) && p.images.length ? p.images : (p && p.image ? [p.image] : []);
      var activeImg = imgs[STATE.modalImgIdx] || (p && p.image) || '';
      var zImg = document.getElementById('prodZoomImg');
      var zPrev = document.getElementById('prodZoomPrevBtn');
      var zNext = document.getElementById('prodZoomNextBtn');
      if (zImg) {
        zImg.src = activeImg;
        zImg.alt = (p && (p.cleanTitle || p.name)) || '';
      }
      if (zPrev) zPrev.classList.toggle('hidden', imgs.length <= 1);
      if (zNext) zNext.classList.toggle('hidden', imgs.length <= 1);
      zModal.classList.add('open');
      zModal.setAttribute('aria-hidden', 'false');
    }

    function openZoomModal() {
      STATE.zoomOpen = true;
      syncZoomModalDom();
    }

    function closeZoomModal() {
      STATE.zoomOpen = false;
      syncZoomModalDom();
    }

    function renderProdModalContent() {
      var p = (STATE.data.products || []).find(function(x) { return x.id === STATE.modalProdId; });
      if (!p) return;
      var wsAllowed = isWholesaleAllowed();
      var minQModal = minWholesaleQtyClient();
      var canBuy = p.availableToOrder !== false && !isStoreClosed();
      var imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.image ? [p.image] : []);
      if (STATE.modalImgIdx >= imgs.length) STATE.modalImgIdx = 0;
      var activeImg = imgs[STATE.modalImgIdx] || p.image || '';
      var siblings = findSiblingVariantsClient(p);
      var related = selectRelatedProdsClient(p, 3);
      var parsed = parseProdDescClient(p.description, p);
      var mTitle = formatDisplayTitleClient(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle || p.name;

      var existingCartQty = (STATE.cart || []).reduce(function(s, it) { return s + (Number(it.quantity) || 0); }, 0);
      var selQty = Math.max(1, Number(STATE.modalQty) || 1);
      var projectedTotalQty = existingCartQty + selQty;
      var wsList = wsAllowed ? (p.wholesalePrices || []) : [];
      var activeModalWs = null;
      if (wsList.length) {
        var sortedWsDesc = wsList.slice().sort(function(a, b) { return b.minQty - a.minQty; });
        activeModalWs = sortedWsDesc.find(function(w) { return projectedTotalQty >= w.minQty; }) || null;
      }
      var effUnitPrice = activeModalWs ? activeModalWs.unitPrice : p.retailPrice;
      var lineSubtotal = effUnitPrice * selQty;
      var lineSaved = Math.max(0, (p.retailPrice - effUnitPrice) * selQty);

      var stageNavHtml = imgs.length > 1
        ? '<button type="button" class="pd-nav-arrow prev" aria-label="Ảnh sản phẩm trước" onclick="stepModalImg(-1)">‹</button>' +
          '<button type="button" class="pd-nav-arrow next" aria-label="Ảnh sản phẩm tiếp theo" onclick="stepModalImg(1)">›</button>' +
          '<span class="pd-counter-pill">' + (STATE.modalImgIdx + 1) + ' / ' + imgs.length + '</span>'
        : '';

      var zoomBtnHtml = activeImg
        ? '<button type="button" class="pd-zoom-pill" aria-label="Phóng lớn ảnh sản phẩm" onclick="openZoomModal()"><span>Phóng lớn</span></button>'
        : '';

      var thumbsHtml = imgs.length > 1
        ? '<div class="modal-thumbs" role="tablist" aria-label="Bộ sưu tập ảnh sản phẩm">' + imgs.map(function(u, idx) {
            return '<button type="button" class="modal-thumb-btn' + (idx === STATE.modalImgIdx ? ' active' : '') + '" aria-label="Ảnh ' + (idx + 1) + '" aria-selected="' + (idx === STATE.modalImgIdx ? 'true' : 'false') + '" onclick="setModalImgIdx(' + idx + ')"><img src="' + esc(u) + '" alt="" loading="lazy" /></button>';
          }).join('') + '</div>'
        : '';

      var quickSpecsHtml = parsed.quickSpecs.length
        ? '<div class="pd-quick-specs">' + parsed.quickSpecs.map(function(sp) {
            return '<div class="pd-spec-chip"><small>' + esc(sp.label) + '</small><strong>' + esc(sp.value) + '</strong></div>';
          }).join('') + '</div>'
        : '';

      var returnDaysCfg = (STATE.data.config && typeof STATE.data.config.returnDays === 'number') ? STATE.data.config.returnDays : 7;
      var trustStripHtml = '<div class="pd-trust-strip">' +
        '<span class="pd-trust-badge">✓ Đúc thủ công tỉ mỉ</span>' +
        (returnDaysCfg > 0 ? '<span class="pd-trust-badge">✓ Đổi mới bể vỡ ' + returnDaysCfg + ' ngày</span>' : '<span class="pd-trust-badge">✓ Đồng kiểm khi nhận</span>') +
        (wsAllowed ? '<span class="pd-trust-badge">✓ Gộp mẫu tính sỉ từ ' + minQModal + ' SP</span>' : '') +
      '</div>';

      var sibDiffPrice = siblings.some(function(s) { return s.retailPrice !== p.retailPrice; });
      var tierGroupLabel = p.tierVariationName || 'Phân loại cùng mẫu';
      var siblingsHtml = siblings.length > 1
        ? '<div style="margin:8px 0 12px;">' +
            '<div style="font-size:12px;font-weight:750;margin-bottom:6px;color:var(--text);">Chọn ' + esc(tierGroupLabel) + ' (' + siblings.length + '):' + (p.variantLabel ? ' <strong style="color:var(--brand-dark);">' + esc(p.variantLabel) + '</strong>' : '') + '</div>' +
            '<div class="var-chip-row">' + siblings.map(function(sib) {
              var act = sib.id === p.id ? ' active' : '';
              var hasThumb = Boolean(sib.image);
              return '<button type="button" class="var-chip' + act + (hasThumb ? '' : ' no-thumb') + '" onclick="openProdModal(\\'' + jsAttr(sib.id) + '\\')">' +
                (hasThumb ? '<img src="' + esc(sib.image) + '" alt="" class="var-chip-thumb" />' : '') +
                '<span>' + esc(sib.variantLabel || sib.sku) + '</span>' +
                (sibDiffPrice ? '<span class="var-chip-price">· ' + fmtVND(sib.retailPrice) + '</span>' : '') +
              '</button>';
            }).join('') + '</div>' +
          '</div>'
        : (p.variantLabel ? '<div style="font-size:12.5px;font-weight:700;color:var(--brand-dark);margin-bottom:8px;">Phân loại: ' + esc(p.variantLabel) + '</div>' : '');

      var wsInteractiveHtml = wsList.length
        ? '<div style="margin-top:9px;padding-top:9px;border-top:1px dashed var(--line);">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11.5px;margin-bottom:5px;">' +
              '<strong style="color:var(--brand-dark);">Bảng giá sỉ xưởng (bấm chọn nhanh số lượng):</strong>' +
              (existingCartQty > 0 ? '<span style="color:var(--muted);">Giỏ đã có ' + existingCartQty + ' SP</span>' : '') +
            '</div>' +
            '<div class="pd-ws-tier-grid">' +
              '<button type="button" class="pd-ws-tier-btn' + (!activeModalWs ? ' active' : '') + '" onclick="setModalQtyDirect(1)">' +
                '<small>Mua lẻ (1+ ' + esc(p.unit) + ')</small>' +
                '<strong>' + fmtVND(p.retailPrice) + ' / ' + esc(p.unit) + '</strong>' +
              '</button>' +
              wsList.map(function(w) {
                var isActTier = Boolean(activeModalWs && activeModalWs.tierId === w.tierId);
                return '<button type="button" class="pd-ws-tier-btn' + (isActTier ? ' active' : '') + '" onclick="setModalQtyDirect(' + w.minQty + ')">' +
                  '<small>Từ ' + w.minQty + ' ' + esc(p.unit) + ' (' + esc(w.badge) + ')</small>' +
                  '<strong>' + fmtVND(w.unitPrice) + ' / ' + esc(p.unit) + '</strong>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>'
        : '';

      var pricePanelHtml = '<div class="pd-price-panel">' +
        '<div class="pd-price-main">' +
          '<div>' +
            '<div style="font-size:11.5px;color:var(--muted);font-weight:600;">' + (activeModalWs ? ('Đơn giá sỉ đang áp dụng (' + esc(activeModalWs.badge) + '):') : 'Giá bán lẻ niêm yết:') + '</div>' +
            '<div><span class="pd-price-now">' + fmtVND(effUnitPrice) + '</span> <small style="font-size:12px;color:var(--muted);">/ ' + esc(p.unit) + '</small>' +
              (activeModalWs ? '<span class="pd-price-strike">' + fmtVND(p.retailPrice) + '</span>' : '') +
            '</div>' +
          '</div>' +
          (selQty > 1 || lineSaved > 0
            ? '<div style="text-align:right;">' +
                '<div style="font-size:11.5px;color:var(--muted);">Tạm tính (' + selQty + ' ' + esc(p.unit) + '): <strong class="money" style="color:var(--text);">' + fmtVND(lineSubtotal) + '</strong></div>' +
                (lineSaved > 0 ? '<div style="font-size:11.5px;font-weight:750;color:var(--ok);">Tiết kiệm ' + fmtVND(lineSaved) + '</div>' : '') +
              '</div>'
            : '') +
        '</div>' +
        wsInteractiveHtml +
      '</div>';

      var ovSecs = parsed.sections.filter(function(s) { return s.tab === 'OVERVIEW'; });
      var spSecs = parsed.sections.filter(function(s) { return s.tab === 'SPECS'; });
      var caSecs = parsed.sections.filter(function(s) { return s.tab === 'CARE'; });

      var availTabs = [];
      if (ovSecs.length || (!spSecs.length && !caSecs.length && parsed.leads.length > 1)) {
        availTabs.push({ key: 'OVERVIEW', label: 'Đặc điểm & Công năng', secs: ovSecs });
      }
      if (spSecs.length) {
        availTabs.push({ key: 'SPECS', label: 'Thông số kỹ thuật', secs: spSecs });
      }
      if (caSecs.length) {
        availTabs.push({ key: 'CARE', label: 'Bảo quản & Đóng gói', secs: caSecs });
      }
      var activeTabObj = availTabs.find(function(t) { return t.key === STATE.modalTab; }) || availTabs[0] || null;

      function renderSecList(secArr) {
        return secArr.map(function(sec) {
          var bHtml = sec.bullets.length
            ? '<ul class="pd-bullet-list">' + sec.bullets.map(function(b) {
                return '<li class="pd-bullet-item">' + (b.label ? ('<strong>' + esc(b.label) + ':</strong> <span>' + esc(b.text) + '</span>') : esc(b.text)) + '</li>';
              }).join('') + '</ul>'
            : '';
          var pHtml = sec.paragraphs.map(function(pr) {
            return '<p style="font-size:12.5px;line-height:1.55;color:var(--muted);margin-top:5px;">' + esc(pr) + '</p>';
          }).join('');
          return '<div class="pd-sec-block"><div class="pd-sec-heading">' + esc(sec.title) + '</div>' + bHtml + pHtml + '</div>';
        }).join('');
      }

      var detailTabsHtml = '';
      if (activeTabObj) {
        var navBtns = availTabs.length > 1
          ? '<div class="pd-tabs-nav" role="tablist" aria-label="Thông tin chi tiết sản phẩm">' +
              availTabs.map(function(tb) {
                var isAct = tb.key === activeTabObj.key;
                return '<button type="button" role="tab" aria-selected="' + (isAct ? 'true' : 'false') + '" class="pd-tab-btn' + (isAct ? ' active' : '') + '" onclick="setModalTab(\\'' + tb.key + '\\')">' + esc(tb.label) + '</button>';
              }).join('') +
            '</div>'
          : '';
        var panelBody = activeTabObj.secs.length
          ? renderSecList(activeTabObj.secs)
          : parsed.leads.slice(1).map(function(lp) { return '<p style="font-size:12.5px;line-height:1.55;color:var(--muted);">' + esc(lp) + '</p>'; }).join('');
        detailTabsHtml = navBtns + '<div class="pd-tab-panel" role="tabpanel">' + panelBody + '</div>';
      }

      var qtyPickerHtml = canBuy
        ? '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
            '<div><span style="font-size:12.5px;font-weight:750;color:var(--text);">Số lượng đặt chọn:</span>' +
              (wsAllowed && !activeModalWs ? '<div style="font-size:11px;color:var(--muted);">Gộp từ ' + minQModal + ' SP bất kỳ tự động giảm giá sỉ</div>' : '') +
            '</div>' +
            '<div class="qty-stepper">' +
              '<button type="button" class="qty-btn" aria-label="Giảm số lượng" onclick="stepModalQty(-1)">−</button>' +
              '<strong id="prodModalQtyVal" style="min-width:34px;text-align:center;font-variant-numeric:tabular-nums;">' + selQty + '</strong>' +
              '<button type="button" class="qty-btn" aria-label="Tăng số lượng" onclick="stepModalQty(1)">+</button>' +
            '</div>' +
          '</div>'
        : '';

      var buyBtnsHtml = canBuy
        ? '<div style="display:grid;grid-template-columns:' + (wsAllowed ? '1.15fr 0.85fr' : '1fr') + ';gap:8px;">' +
            '<button type="button" class="btn-primary" style="min-height:44px;white-space:nowrap;" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',STATE.modalQty||1);closeProdModal();">' +
              '<span class="pd-buy-label-full" id="prodModalBuyBtnTxt">+ Thêm vào giỏ (' + selQty + ' · ' + fmtVND(lineSubtotal) + ')</span>' +
              '<span class="pd-buy-label-compact">+ Giỏ (' + selQty + ' · ' + fmtVND(lineSubtotal) + ')</span>' +
            '</button>' +
            (wsAllowed ? '<button type="button" class="btn-ws" style="min-height:44px;white-space:nowrap;" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',' + minQModal + ');closeProdModal();openCartModal();"><span>Nhập sỉ (+' + minQModal + ')</span></button>' : '') +
          '</div>'
        : '<button type="button" class="btn-outline w-full" disabled style="opacity:0.6;cursor:not-allowed;min-height:44px;">Tạm hết hàng</button>';

      var shareBtnsHtml = '<div class="pd-share-row" style="grid-template-columns:' + (p.shopeeUrl ? '1fr 1fr' : '1fr') + ';">' +
        '<button type="button" class="btn-outline" style="min-height:38px;font-size:12px;" onclick="shareProdLink(\\'' + jsAttr(p.sku) + '\\')">Sao chép link SP</button>' +
        (p.shopeeUrl ? '<a href="' + esc(p.shopeeUrl) + '" target="_blank" rel="noopener" class="btn-outline" style="min-height:38px;font-size:12px;">Xem trên Shopee ↗</a>' : '') +
      '</div>';

      var relatedHtml = related.length
        ? '<div class="pd-related-wrap">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
              '<strong style="font-size:13.5px;color:var(--text);">Gợi ý phối đồng bộ tại xưởng</strong>' +
              (wsAllowed ? '<span style="font-size:11.5px;color:var(--brand-dark);font-weight:650;">Gộp mẫu tự do hưởng chiết khấu sỉ</span>' : '') +
            '</div>' +
            '<div class="pd-related-grid">' +
              related.map(function(rp) {
                var rTitle = formatDisplayTitleClient(rp.cleanTitle || rp.name, rp.variantLabel) || rp.cleanTitle || rp.name;
                return '<button type="button" class="pd-rel-card" onclick="openProdModal(\\'' + jsAttr(rp.id) + '\\')">' +
                  (rp.image ? '<img src="' + esc(rp.image) + '" alt="" loading="lazy" />' : '') +
                  '<div style="min-width:0;flex:1;">' +
                    '<strong style="display:block;font-size:12.5px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(rTitle) + '</strong>' +
                    (rp.variantLabel ? '<div style="font-size:11px;color:var(--muted);">' + esc(rp.variantLabel) + '</div>' : '') +
                    '<div style="font-size:12.5px;font-weight:800;color:var(--brand);margin-top:2px;font-variant-numeric:tabular-nums;">' + fmtVND(rp.retailPrice) + ' <small style="font-weight:500;color:var(--muted);">/ ' + esc(rp.unit) + '</small></div>' +
                  '</div>' +
                '</button>';
              }).join('') +
            '</div>' +
          '</div>'
        : '';

      document.getElementById('prodModalContent').innerHTML =
        '<button type="button" class="modal-close" id="prodModalCloseBtn" aria-label="Đóng chi tiết sản phẩm" onclick="closeProdModal()">✕</button>' +
        '<div class="pd-layout">' +
          '<div class="pd-gallery-col">' +
            '<div class="pd-stage">' +
              (activeImg
                ? '<button type="button" class="pd-stage-img-btn" aria-label="Phóng lớn ảnh ' + esc(mTitle) + '" onclick="openZoomModal()"><img src="' + esc(activeImg) + '" alt="' + esc(mTitle) + '" /></button>'
                : '') +
              stageNavHtml +
              zoomBtnHtml +
            '</div>' +
            thumbsHtml +
            '<div class="pd-gallery-extra">' + quickSpecsHtml + trustStripHtml + '</div>' +
          '</div>' +
          '<div class="pd-right-col" style="min-width:0;">' +
            '<div class="pd-meta-row">' +
              '<span class="pd-sku-pill">SKU: ' + esc(p.sku) + '</span>' +
              '<span class="pd-stock-pill">' + esc(p.stockLabel || 'Sẵn sàng đặt') + '</span>' +
            '</div>' +
            '<h2 id="prodModalTitle" class="pd-title">' + esc(mTitle) + '</h2>' +
            (parsed.leads[0] ? '<p class="pd-lead">' + esc(parsed.leads[0]) + '</p>' : '') +
            pricePanelHtml +
            siblingsHtml +
            '<div class="pd-cta-box">' +
              qtyPickerHtml +
              buyBtnsHtml +
            '</div>' +
            detailTabsHtml +
            shareBtnsHtml +
          '</div>' +
        '</div>' +
        relatedHtml;
    }

    function openProdModal(prodId) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === prodId; });
      if (!p) return;
      hideToast();
      var wasAlreadyOpen = Boolean(document.getElementById('prodModal') && document.getElementById('prodModal').classList.contains('open'));
      if (!isAnyModalOpen()) STATE.lastFocusedEl = document.activeElement;
      var prevProd = wasAlreadyOpen && STATE.modalProdId
        ? (STATE.data.products || []).find(function(x) { return x.id === STATE.modalProdId; })
        : null;
      var switchingSibling = Boolean(
        prevProd &&
        prevProd.id !== prodId &&
        findSiblingVariantsClient(prevProd).some(function(s) { return s.id === prodId; })
      );
      STATE.modalProdId = prodId;
      STATE.modalImgIdx = 0;
      if (!switchingSibling) {
        STATE.modalTab = 'OVERVIEW';
        STATE.modalQty = 1;
      }
      renderProdModalContent();
      var modal = document.getElementById('prodModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      syncUrlSkuParam(p.sku);
      syncBodyScrollLock();
      updateMobileCartBar();
      if (!switchingSibling) {
        var mContent = document.getElementById('prodModalContent');
        if (mContent) mContent.scrollTop = 0;
        var closeBtn = document.getElementById('prodModalCloseBtn');
        if (closeBtn) closeBtn.focus();
      }
    }

    function closeProdModal() {
      closeZoomModal();
      var modal = document.getElementById('prodModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      STATE.modalQty = 1;
      STATE.modalTab = 'OVERVIEW';
      syncUrlSkuParam('');
      syncBodyScrollLock();
      updateMobileCartBar();
      if (STATE.lastFocusedEl && STATE.lastFocusedEl.focus && !isAnyModalOpen()) {
        try { STATE.lastFocusedEl.focus(); } catch (e) {}
      }
    }

    function addToCart(prodId, qty) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === prodId; });
      if (!p || p.availableToOrder === false || isStoreClosed()) return;
      var addQ = Math.max(1, Math.min(10000, Math.floor(Number(qty) || 1)));
      STATE.completedOrder = null;
      var hit = STATE.cart.find(function(i) { return i.product.id === prodId; });
      if (hit) hit.quantity += addQ;
      else STATE.cart.push({ product: p, quantity: addQ });
      saveCartToStorage();
      updateCartBadge();
      var cTitle = formatDisplayTitleClient(p.cleanTitle || p.name, p.variantLabel) || p.cleanTitle;
      showToast('Đã thêm ' + addQ + ' ' + p.unit + ' "' + cTitle + '"', true);
    }

    function setPaymentMethod(m) {
      syncCheckoutDraftFromDom();
      STATE.paymentMethod = m;
      renderCartModal();
    }

    function updateCartQty(prodId, delta) {
      syncCheckoutDraftFromDom();
      STATE.cart = STATE.cart.map(function(i) {
        return i.product.id === prodId ? { product: i.product, quantity: i.quantity + delta } : i;
      }).filter(function(i) { return i.quantity > 0; });
      saveCartToStorage();
      updateCartBadge();
      renderCartModal();
    }

    function removeCartItem(prodId) {
      syncCheckoutDraftFromDom();
      STATE.cart = STATE.cart.filter(function(i) { return i.product.id !== prodId; });
      saveCartToStorage();
      updateCartBadge();
      renderCartModal();
    }

    function computeCartMetrics() {
      var totalQty = STATE.cart.reduce(function(s, i) { return s + i.quantity; }, 0);
      var wsAllowed = isWholesaleAllowed();
      var rawTiers = wsAllowed ? ((STATE.data.config && STATE.data.config.wholesaleTiers) || []) : [];
      var descTiers = rawTiers.slice().sort(function(a, b) { return b.minQty - a.minQty; });
      var ascTiers = rawTiers.slice().sort(function(a, b) { return a.minQty - b.minQty; });
      var activeTier = wsAllowed ? (descTiers.find(function(t) { return totalQty >= t.minQty; }) || null) : null;
      var nextTier = wsAllowed ? (ascTiers.find(function(t) { return totalQty < t.minQty; }) || null) : null;
      var retailSub = STATE.cart.reduce(function(s, i) { return s + i.product.retailPrice * i.quantity; }, 0);
      var effSub = STATE.cart.reduce(function(s, i) {
        var u = activeTier ? calcWsPrice(i.product.retailPrice, activeTier.discountPercent) : i.product.retailPrice;
        return s + u * i.quantity;
      }, 0);
      var saved = Math.max(0, retailSub - effSub);
      var freeShip = (STATE.data.config && STATE.data.config.freeShipThreshold) || 500000;
      var freeShipRem = Math.max(0, freeShip - effSub);
      var shipFee = (effSub === 0 || effSub >= freeShip) ? 0 : ((STATE.data.config && STATE.data.config.baseShippingFee) || 30000);
      return {
        totalQty: totalQty,
        wsAllowed: wsAllowed,
        activeTier: activeTier,
        nextTier: nextTier,
        retailSub: retailSub,
        effSub: effSub,
        saved: saved,
        freeShip: freeShip,
        freeShipRem: freeShipRem,
        shipFee: shipFee,
        grand: effSub + shipFee
      };
    }

    function updateMobileCartBar() {
      var bar = document.getElementById('mobileCartBar');
      if (!bar) return;
      var m = computeCartMetrics();
      var shouldShow = !isStoreClosed() && m.totalQty > 0 && !isAnyModalOpen();
      bar.classList.toggle('hidden', !shouldShow);
      document.body.classList.toggle('has-mobile-bar', shouldShow);
      if (!shouldShow) return;
      var hintEl = document.getElementById('mobileCartHint');
      var cntEl = document.getElementById('mobileCartCountTxt');
      var totEl = document.getElementById('mobileCartTotalTxt');
      if (hintEl) {
        if (m.activeTier) {
          hintEl.textContent = 'Đã áp giá sỉ ' + m.activeTier.badge + ' · Tiết kiệm ' + fmtVND(m.saved);
        } else if (m.nextTier) {
          hintEl.textContent = 'Mua thêm ' + (m.nextTier.minQty - m.totalQty) + ' SP nhận giá sỉ ' + m.nextTier.badge;
        } else if (m.freeShipRem > 0) {
          hintEl.textContent = 'Mua thêm ' + fmtVND(m.freeShipRem) + ' để Miễn phí vận chuyển';
        } else {
          hintEl.textContent = 'Đơn hàng đủ điều kiện Miễn phí vận chuyển';
        }
      }
      if (cntEl) cntEl.textContent = m.totalQty + ' sản phẩm';
      if (totEl) totEl.textContent = fmtVND(m.effSub);
    }

    function updateCartBadge() {
      var total = STATE.cart.reduce(function(s, i) { return s + i.quantity; }, 0);
      var badge = document.getElementById('cartCountBadge');
      if (badge) badge.textContent = String(total);
      updateMobileCartBar();
    }

    function openCartModal() {
      hideToast();
      if (!isAnyModalOpen()) STATE.lastFocusedEl = document.activeElement;
      renderCartModal();
      var modal = document.getElementById('cartModal');
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      syncBodyScrollLock();
      updateMobileCartBar();
      var closeBtn = document.getElementById('cartModalCloseBtn');
      if (closeBtn) closeBtn.focus();
    }

    function closeCartModal() {
      syncCheckoutDraftFromDom();
      var modal = document.getElementById('cartModal');
      if (!modal) return;
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      syncBodyScrollLock();
      updateMobileCartBar();
      if (STATE.lastFocusedEl && STATE.lastFocusedEl.focus && !isAnyModalOpen()) {
        try { STATE.lastFocusedEl.focus(); } catch (e) {}
      }
    }

    function renderCartModal() {
      syncCheckoutDraftFromDom();
      var box = document.getElementById('cartModalContent');
      var bank = resolveActiveBank();
      if (STATE.completedOrder) {
        var co = STATE.completedOrder;
        var doneQr = co.paymentMethod === 'BANK_TRANSFER' && bank ? buildVietQrUrl(bank, co.grandTotal, co.refCode) : '';
        var bankDoneHtml = '';
        if (co.paymentMethod === 'BANK_TRANSFER') {
          if (bank) {
            bankDoneHtml = '<div style="margin-top:12px;background:#fff;border:1px solid #efd6b8;border-radius:12px;padding:12px;text-align:left;font-size:12px;color:#1c1917;">' +
              '<div style="font-weight:800;color:#6f3d15;margin-bottom:6px;">Quét mã VietQR thanh toán đơn ' + esc(co.refCode) + '</div>' +
              (doneQr ? '<div style="text-align:center;margin:8px 0;"><img src="' + esc(doneQr) + '" alt="VietQR" style="max-height:210px;border-radius:10px;border:1px solid #e5ded5;padding:6px;background:#fff;" onerror="this.style.display=\\'none\\'" /></div>' : '') +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;"><span>Ngân hàng: <strong>' + esc(bank.bankName) + '</strong> · STK: <strong>' + esc(bank.bankAccount) + '</strong></span><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:32px;" onclick="copyTxt(\\'' + jsAttr(bank.bankAccount) + '\\',\\'số tài khoản\\')">Copy STK</button></div>' +
              (bank.bankHolder ? '<div style="margin-top:3px;">Chủ TK: ' + esc(bank.bankHolder) + '</div>' : '') +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;"><span>Nội dung CK: <strong style="font-family:monospace;">' + esc(co.refCode) + '</strong></span><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:32px;" onclick="copyTxt(\\'' + jsAttr(co.refCode) + '\\',\\'nội dung chuyển khoản\\')">Copy nội dung</button></div>' +
            '</div>';
          } else {
            bankDoneHtml = '<div class="alert-amber" style="margin-top:12px;text-align:left;">' +
              'Xưởng sẽ kiểm tra đơn <strong>' + esc(co.refCode) + '</strong> và gửi mã VietQR chính thức kèm mã đơn hàng qua SĐT/Zalo của bạn ngay sau khi tiếp nhận đơn.' +
            '</div>';
          }
        }
        box.innerHTML = '<button type="button" class="modal-close" id="cartModalCloseBtn" aria-label="Đóng giỏ hàng" onclick="closeCartModal()">✕</button>' +
          '<div class="alert-ok" role="status" aria-live="polite" style="text-align:center;padding:20px;margin-bottom:0;">' +
            '<h2 id="cartModalTitle" style="font-size:18px;margin-bottom:6px;color:#115e59;">Đặt hàng thành công!</h2>' +
            '<p>Mã đơn hàng của bạn: <strong style="font-family:monospace;font-size:15px;">' + esc(co.refCode) + '</strong> <button type="button" class="btn-sm-out" style="padding:0 10px;min-height:32px;margin-left:4px;" onclick="copyTxt(\\'' + jsAttr(co.refCode) + '\\',\\'mã đơn hàng\\')">Sao chép</button></p>' +
            '<p class="money" style="margin-top:6px;">Tổng thanh toán: <strong>' + fmtVND(co.grandTotal) + '</strong></p>' +
            bankDoneHtml +
            '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
              '<button type="button" class="btn-outline" style="min-height:40px;" onclick="jumpTrackOrder(\\'' + jsAttr(co.refCode) + '\\',\\'' + jsAttr(co.phone || '') + '\\')">Tra cứu đơn này</button>' +
              '<button type="button" class="btn-primary" style="min-height:40px;" onclick="STATE.completedOrder=null;closeCartModal();">Tiếp tục mua sắm</button>' +
            '</div>' +
          '</div>';
        return;
      }
      if (!STATE.cart.length) {
        box.innerHTML = '<button type="button" class="modal-close" id="cartModalCloseBtn" aria-label="Đóng giỏ hàng" onclick="closeCartModal()">✕</button>' +
          '<h2 id="cartModalTitle" style="font-size:18px;font-weight:800;margin-bottom:10px;">Giỏ hàng trực tuyến</h2>' +
          '<div style="padding:26px 0;text-align:center;">' +
            '<p style="color:#57534e;margin-bottom:14px;">Giỏ hàng đang trống — hãy chọn sản phẩm lẻ hoặc gộp mẫu sỉ để đặt mua.</p>' +
            '<button type="button" class="btn-primary" onclick="closeCartModal();scrollToCatalog();">Khám phá sản phẩm</button>' +
          '</div>';
        return;
      }

      var m = computeCartMetrics();
      var pm = STATE.paymentMethod || 'COD';
      var draft = STATE.checkoutDraft || { name: '', phone: '', addr: '', note: '' };
      var shortTag = (STATE.data.brand && STATE.data.brand.brandShortName) || 'BM';
      var phoneDigits = String(draft.phone || '').replace(/\\D/g, '').slice(-10) || 'DONHANG';
      var previewQr = (pm === 'BANK_TRANSFER' && bank) ? buildVietQrUrl(bank, m.grand, shortTag + ' WEB ' + phoneDigits) : '';

      var progressHtml = '<div class="alert-amber" role="status" aria-live="polite">' +
        (m.activeTier
          ? '<div>Đã kích hoạt <strong>' + esc(m.activeTier.label) + '</strong>: Tiết kiệm ngay <strong class="money">' + fmtVND(m.saved) + '</strong>' +
            (m.nextTier ? (' · Mua thêm ' + (m.nextTier.minQty - m.totalQty) + ' SP nhận mức ' + esc(m.nextTier.badge)) : '') + '</div>'
          : (m.nextTier
              ? '<div>Mua thêm <strong>' + (m.nextTier.minQty - m.totalQty) + ' sản phẩm</strong> bất kỳ để nhận giá sỉ <strong>' + esc(m.nextTier.badge) + '</strong>.</div>'
              : '')) +
        '<div style="margin-top:3px;font-size:11.5px;color:#57534e;">' +
          (m.freeShipRem > 0
            ? ('Mua thêm <strong class="money">' + fmtVND(m.freeShipRem) + '</strong> để được <strong>Miễn phí vận chuyển toàn quốc</strong>.')
            : '<strong style="color:#0f766e;">✓ Đã đủ điều kiện Miễn phí vận chuyển toàn quốc.</strong>') +
        '</div>' +
      '</div>';

      var bankCheckoutHtml = '';
      if (pm === 'BANK_TRANSFER') {
        if (bank) {
          bankCheckoutHtml = '<div class="field full" style="background:#fdf4eb;border:1px solid #efd6b8;border-radius:10px;padding:10px;font-size:12px;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><strong style="color:#6f3d15;">Thông tin chuyển khoản &amp; VietQR:</strong><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:32px;" onclick="copyTxt(\\'' + jsAttr(bank.bankAccount) + '\\',\\'số tài khoản\\')">Copy STK</button></div>' +
            '<div style="margin-top:4px;">' + esc(bank.bankName) + ' · STK: <strong>' + esc(bank.bankAccount) + '</strong>' + (bank.bankHolder ? ' (' + esc(bank.bankHolder) + ')' : '') + '</div>' +
            (previewQr ? '<div style="text-align:center;margin-top:8px;"><img src="' + esc(previewQr) + '" alt="VietQR" style="max-height:185px;border-radius:8px;border:1px solid #efd6b8;padding:5px;background:#fff;" onerror="this.style.display=\\'none\\'" /><div style="font-size:11px;color:#57534e;margin-top:4px;">Mã QR kèm đúng mã đơn hàng cũng sẽ hiển thị ngay sau khi bấm Đặt mua</div></div>' : '') +
          '</div>';
        } else {
          bankCheckoutHtml = '<div class="field full alert-amber" role="status" aria-live="polite" style="margin-bottom:0;">' +
            'Xưởng sẽ kiểm tra đơn và gửi mã VietQR chính thức kèm mã đơn hàng qua SĐT/Zalo của bạn ngay sau khi tiếp nhận đơn.' +
          '</div>';
        }
      }

      box.innerHTML = '<button type="button" class="modal-close" id="cartModalCloseBtn" aria-label="Đóng giỏ hàng" onclick="closeCartModal()">✕</button>' +
        '<h2 id="cartModalTitle" style="font-size:18px;font-weight:800;margin-bottom:4px;padding-right:36px;">Giỏ hàng &amp; Đặt mua Trực tuyến</h2>' +
        '<p style="font-size:12px;color:#57534e;margin-bottom:10px;">' + (m.wsAllowed ? 'Tự động tính chiết khấu Giá Sỉ khi tổng số lượng đạt mốc sỉ xưởng.' : 'Kiểm tra danh sách sản phẩm và thông tin nhận hàng.') + '</p>' +
        progressHtml +
        '<div style="max-height:210px;overflow-y:auto;margin-bottom:14px;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;">' +
          STATE.cart.map(function(i) {
            var u = m.activeTier ? calcWsPrice(i.product.retailPrice, m.activeTier.discountPercent) : i.product.retailPrice;
            var lTitle = formatDisplayTitleClient(i.product.cleanTitle || i.product.name, i.product.variantLabel) || i.product.cleanTitle;
            return '<div class="cart-line">' +
              (i.product.image ? '<img src="' + esc(i.product.image) + '" alt="' + esc(lTitle) + '" class="cart-line-thumb" />' : '') +
              '<div style="min-width:0;flex:1;"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(lTitle) + '</strong><div style="color:#57534e;font-size:11.5px;"><span class="money">' + fmtVND(u) + '</span> / ' + esc(i.product.unit) + (i.product.variantLabel ? ' · ' + esc(i.product.variantLabel) : '') + '</div></div>' +
              '<div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">' +
                '<button type="button" class="qty-btn" aria-label="Giảm số lượng" onclick="updateCartQty(\\'' + jsAttr(i.product.id) + '\\',-1)">−</button>' +
                '<strong style="min-width:24px;text-align:center;font-variant-numeric:tabular-nums;">' + i.quantity + '</strong>' +
                '<button type="button" class="qty-btn" aria-label="Tăng số lượng" onclick="updateCartQty(\\'' + jsAttr(i.product.id) + '\\',1)">+</button>' +
                '<button type="button" class="qty-btn danger" aria-label="Xóa sản phẩm khỏi giỏ" onclick="removeCartItem(\\'' + jsAttr(i.product.id) + '\\')">' + SVG_TRASH_CLIENT + '</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<form onsubmit="submitOrderForm(event)" class="form-grid">' +
          '<div class="field"><label for="ordName">Họ và tên người nhận *</label><input id="ordName" name="customerName" autocomplete="name" required value="' + esc(draft.name) + '" oninput="onCheckoutDraftInput(\\'name\\',this.value)" placeholder="Nguyễn Minh Trân" /></div>' +
          '<div class="field"><label for="ordPhone">Số điện thoại *</label><input id="ordPhone" name="customerPhone" type="tel" inputmode="tel" autocomplete="tel" required value="' + esc(draft.phone) + '" oninput="onCheckoutDraftInput(\\'phone\\',this.value)" placeholder="VD: 09xx xxx xxx" /></div>' +
          '<div class="field full"><label for="ordAddr">Địa chỉ giao hàng chi tiết *</label><input id="ordAddr" name="address" autocomplete="street-address" required value="' + esc(draft.addr) + '" oninput="onCheckoutDraftInput(\\'addr\\',this.value)" placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..." /></div>' +
          '<div class="field full"><label for="ordNote">Ghi chú đơn hàng</label><input id="ordNote" name="note" value="' + esc(draft.note) + '" oninput="onCheckoutDraftInput(\\'note\\',this.value)" placeholder="Gói quà, xuất hóa đơn, giờ giao..." /></div>' +
          '<div class="field full" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            '<button type="button" class="pay-choice' + (pm === 'COD' ? ' active' : '') + '" onclick="setPaymentMethod(\\'COD\\')">Thanh toán khi nhận (COD)</button>' +
            '<button type="button" class="pay-choice' + (pm === 'BANK_TRANSFER' ? ' active' : '') + '" onclick="setPaymentMethod(\\'BANK_TRANSFER\\')">Chuyển khoản Ngân hàng</button>' +
          '</div>' +
          bankCheckoutHtml +
          '<div class="field full" style="background:#f5f2ec;border-radius:11px;padding:11px;font-size:12.5px;">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;"><span>Tạm tính (' + m.totalQty + ' SP):</span><strong class="money">' + fmtVND(m.effSub) + '</strong></div>' +
            (m.saved > 0 ? '<div style="display:flex;justify-content:space-between;gap:8px;color:#6f3d15;"><span>Tiết kiệm chiết khấu sỉ:</span><strong class="money">-' + fmtVND(m.saved) + '</strong></div>' : '') +
            '<div style="display:flex;justify-content:space-between;gap:8px;"><span>Phí vận chuyển:</span><strong class="money">' + (m.shipFee === 0 ? 'Miễn phí' : fmtVND(m.shipFee)) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;gap:8px;font-size:15px;margin-top:5px;padding-top:5px;border-top:1px solid #ddd;"><strong>Tổng thanh toán:</strong><strong class="money" style="color:#8c4f1e">' + fmtVND(m.grand) + '</strong></div>' +
          '</div>' +
          '<div class="field full"><button type="submit" class="cart-btn w-full" style="justify-content:center;min-height:44px;" id="ordSubmitBtn">Đặt mua ngay · ' + fmtVND(m.grand) + '</button></div>' +
        '</form>';
    }

    async function submitOrderForm(ev) {
      ev.preventDefault();
      syncCheckoutDraftFromDom();
      var btn = document.getElementById('ordSubmitBtn');
      btn.disabled = true; btn.textContent = 'Đang gửi đơn hàng...';
      try {
        var res = await fetch(apiEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SUBMIT_WEB_ORDER',
            customerName: STATE.checkoutDraft.name,
            customerPhone: STATE.checkoutDraft.phone,
            address: STATE.checkoutDraft.addr,
            note: STATE.checkoutDraft.note,
            paymentMethod: STATE.paymentMethod || 'COD',
            items: STATE.cart.map(function(i) { return { productId: i.product.id, sku: i.product.sku, quantity: i.quantity }; })
          })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Không thể gửi đơn');
        var ordPhoneVal = STATE.checkoutDraft.phone;
        STATE.checkoutDraft = { name: '', phone: '', addr: '', note: '' };
        STATE.completedOrder = {
          refCode: json.refCode,
          grandTotal: json.grandTotal,
          paymentMethod: STATE.paymentMethod || 'COD',
          phone: ordPhoneVal
        };
        STATE.cart = [];
        saveCartToStorage();
        updateCartBadge();
        renderCartModal();
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Thử lại đặt mua · ' + fmtVND(computeCartMetrics().grand);
        alert(e.message || 'Không thể kết nối máy chủ đặt hàng.');
      }
    }

    async function submitWholesaleForm(ev) {
      ev.preventDefault();
      var btn = document.getElementById('wsSubmitBtn');
      btn.disabled = true; btn.textContent = 'Đang gửi yêu cầu...';
      try {
        var res = await fetch(apiEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SUBMIT_WHOLESALE_INQUIRY',
            customerName: document.getElementById('wsName').value,
            customerPhone: document.getElementById('wsPhone').value,
            companyOrShopName: document.getElementById('wsShop').value,
            estimatedQty: Number(document.getElementById('wsQty').value) || 30,
            address: document.getElementById('wsAddr').value,
            customerEmail: document.getElementById('wsEmail').value,
            note: document.getElementById('wsNote').value
          })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Lỗi gửi báo giá');
        var al = document.getElementById('wsSuccessAlert');
        al.textContent = json.message || ('Đã gửi yêu cầu mã ' + json.refCode);
        al.classList.remove('hidden');
        document.getElementById('wholesaleForm').reset();
        updateWsSimulator();
      } catch (e) {
        showToast(e.message || 'Vui lòng thử lại sau ít phút.', false);
      } finally {
        btn.disabled = false; btn.textContent = 'Gửi Yêu Cầu Nhận Bảng Giá Sỉ Chính Thức';
      }
    }

    async function submitContactForm(ev) {
      ev.preventDefault();
      var btn = document.getElementById('ctSubmitBtn');
      btn.disabled = true; btn.textContent = 'Đang gửi...';
      try {
        var res = await fetch(apiEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SUBMIT_CONTACT',
            customerName: document.getElementById('ctName').value,
            customerPhone: document.getElementById('ctPhone').value,
            customerEmail: document.getElementById('ctEmail').value,
            note: document.getElementById('ctMsg').value
          })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Lỗi gửi liên hệ');
        var al = document.getElementById('ctSuccessAlert');
        al.textContent = json.message || ('Đã tiếp nhận mã ' + json.refCode);
        al.classList.remove('hidden');
        document.getElementById('ctMsg').value = '';
      } catch (e) {
        showToast(e.message || 'Không thể gửi tin nhắn lúc này.', false);
      } finally {
        btn.disabled = false; btn.textContent = 'Gửi Liên Hệ Tới Cửa Hàng';
      }
    }

    async function submitLookup(ev) {
      ev.preventDefault();
      var out = document.getElementById('lkOutput');
      out.innerHTML = '<p style="font-size:12.5px;color:#57534e">Đang kiểm tra...</p>';
      try {
        var code = encodeURIComponent(document.getElementById('lkCode').value.trim());
        var phone = encodeURIComponent(document.getElementById('lkPhone').value.trim());
        var res = await fetch(apiEndpoint() + '?lookupCode=' + code + '&phone=' + phone, { cache: 'no-store' });
        var json = await res.json();
        if (!res.ok || !json.ok) {
          out.innerHTML = '<div style="color:#991b1b;font-size:12.5px;padding:10px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;">' + esc(json.error || 'Không tìm thấy đơn hàng.') + '</div>';
          return;
        }
        var shipTxt = (json.shipment && json.shipment.trackingCode)
          ? '<br/>Vận chuyển: <strong>' + esc(json.shipment.carrier || 'ĐVVC') + '</strong> · Mã vận đơn: <strong style="font-family:monospace;">' + esc(json.shipment.trackingCode) + '</strong>'
          : '';
        var tierTxt = json.tierApplied ? '<br/>Mức chiết khấu sỉ: ' + esc(json.tierApplied) : '';
        out.innerHTML = '<div class="alert-ok"><strong>Mã: ' + esc(json.code) + '</strong>' +
          (json.title ? '<br/>' + esc(json.title) : '') +
          '<br/>Trạng thái: <strong>' + esc(formatLookupStatus(json.status)) + '</strong>' +
          (typeof json.total === 'number' ? '<br/>Tổng cộng: <strong class="money">' + fmtVND(json.total) + '</strong>' : '') +
          tierTxt +
          shipTxt +
          '</div>';
      } catch (e) {
        out.innerHTML = '<p style="color:#991b1b;font-size:12.5px;">Không thể kết nối máy chủ tra cứu lúc này.</p>';
      }
    }

    function applyLiveStorefrontData(live) {
      if (!live || !live.ok || !Array.isArray(live.products)) return;
      syncCheckoutDraftFromDom();
      STATE.data = live;
      if (live.brand) {
        if (live.brand.brandName) {
          document.getElementById('brandNameHdr').textContent = live.brand.brandName;
          document.getElementById('footerBrand').textContent = live.brand.brandName;
          document.title = live.brand.brandName + ' — Sản phẩm, Bảng Giá Sỉ & Liên hệ Chính thức';
        }
        if (live.brand.workshopName) {
          document.getElementById('footerWorkshop').textContent = live.brand.workshopName;
        }
      }
      if (live.config) {
        var copyLive = resolveHeroCopyClient(live);
        document.getElementById('announcementBar').textContent = copyLive.effectiveAnnouncementBar;
        if (live.config.heroBadge) {
          document.getElementById('heroBadge').textContent = live.config.heroBadge;
          var subHdr = document.getElementById('brandSubHdr');
          var liveSub = (live.brand && live.brand.brandSubtitle) ? String(live.brand.brandSubtitle).trim() : '';
          var wsSub = (live.brand && live.brand.workshopName) ? String(live.brand.workshopName).trim() : '';
          if (subHdr) {
            if (liveSub && !/quản lý bán hàng/i.test(liveSub) && liveSub.toLowerCase() !== String(live.config.heroBadge).trim().toLowerCase()) {
              subHdr.textContent = liveSub;
            } else if (wsSub && !/quản lý bán hàng/i.test(wsSub)) {
              subHdr.textContent = wsSub;
            }
          }
        }
        if (live.config.heroTitle) document.getElementById('heroTitle').textContent = live.config.heroTitle;
        if (live.config.heroSubtitle) document.getElementById('heroSubtitle').textContent = live.config.heroSubtitle;
        if (live.config.wholesalePolicyNote) document.getElementById('wsPolicyText').textContent = live.config.wholesalePolicyNote;
        if (live.config.oemCustomNote) document.getElementById('oemNoteText').textContent = live.config.oemCustomNote;

        var isClosedLive = Boolean(live.storefrontClosed || live.config.enabled === false);
        var wsOn = !isClosedLive && live.config.wholesaleEnabled !== false;
        var openExploreBtn = document.getElementById('heroOpenExploreBtn');
        var closedContactBtn = document.getElementById('heroClosedContactBtn');
        var closedTrackBtn = document.getElementById('heroClosedTrackBtn');
        if (openExploreBtn) openExploreBtn.classList.toggle('hidden', isClosedLive);
        if (closedContactBtn) {
          closedContactBtn.className = isClosedLive ? 'btn-primary' : 'btn-outline hidden';
        }
        if (closedTrackBtn) closedTrackBtn.classList.toggle('hidden', !isClosedLive);

        var tabWs = document.getElementById('tab-WHOLESALE');
        var heroWs = document.getElementById('heroWsBtn');
        var modeSw = document.getElementById('modeSwitchWrap');
        var ftWs = document.getElementById('footerWsRow');
        if (tabWs) tabWs.classList.toggle('hidden', !wsOn);
        if (heroWs) heroWs.classList.toggle('hidden', !wsOn);
        if (modeSw) modeSw.classList.toggle('hidden', !wsOn);
        if (ftWs) ftWs.classList.toggle('hidden', !wsOn);
        if (!wsOn && STATE.priceMode === 'WHOLESALE') {
          STATE.priceMode = 'RETAIL';
          var mRet = document.getElementById('modeRetailBtn');
          var mWs = document.getElementById('modeWsBtn');
          if (mRet) mRet.className = 'active';
          if (mWs) mWs.className = '';
        }
        if (!wsOn && STATE.tab === 'WHOLESALE') {
          switchTab('PRODUCTS');
        }

        var tList = live.config.wholesaleTiers || [];
        var rangeTxt = tList.length >= 2
          ? '(' + tList[0].badge + ' → ' + tList[tList.length - 1].badge + ')'
          : (tList.length === 1 ? '(' + tList[0].badge + ')' : '');
        var wsBadgeEl = document.getElementById('wsNavBadge');
        if (wsBadgeEl) wsBadgeEl.textContent = rangeTxt;
        var heroRangeEl = document.getElementById('heroWsRangeTxt');
        if (heroRangeEl) heroRangeEl.textContent = rangeTxt;

        var minWsQtyLive = minWholesaleQtyClient();
        var wsQtyIn = document.getElementById('wsQty');
        if (wsQtyIn) wsQtyIn.min = String(minWsQtyLive);

        var freeShipLiveFmt = fmtVND(live.config.freeShipThreshold || 500000);
        var hl1El = document.getElementById('heroHighlight1');
        var hl2El = document.getElementById('heroHighlight2');
        var hlWsEl = document.getElementById('heroHighlightWs');
        if (hl1El) hl1El.textContent = copyLive.highlight1;
        if (hl2El) hl2El.textContent = copyLive.highlight2;
        if (hlWsEl) hlWsEl.textContent = copyLive.highlight3;

        var craftIconEl = document.getElementById('heroCraftIconWrap');
        var craftTitleEl = document.getElementById('heroCraftPromiseTitle');
        var craftDescEl = document.getElementById('heroCraftPromiseDesc');
        if (craftIconEl) craftIconEl.innerHTML = copyLive.craftIcon === 'FLAME' ? SVG_FLAME_CLIENT : SVG_SPARKLES_CLIENT;
        if (craftTitleEl) craftTitleEl.textContent = copyLive.craftPromiseTitle;
        if (craftDescEl) craftDescEl.textContent = copyLive.craftPromiseDesc;

        var wsIconEl = document.getElementById('heroWsIconWrap');
        var prTitleEl = document.getElementById('heroWsPromiseTitle');
        var prDescEl = document.getElementById('heroWsPromiseDesc');
        if (wsIconEl) wsIconEl.innerHTML = wsOn ? SVG_PCT_CLIENT : SVG_TRUCK_CLIENT;
        if (prTitleEl) prTitleEl.textContent = copyLive.wsPromiseTitle;
        if (prDescEl) {
          prDescEl.textContent = wsOn
            ? formatWsSummaryClient(tList, live.config.oemCustomNote)
            : ('Miễn phí giao hàng toàn quốc đơn lẻ từ ' + freeShipLiveFmt + ' · Kiểm hàng trước khi nhận.');
        }

        var safeTitleEl = document.getElementById('heroSafePromiseTitle');
        var safeDescEl = document.getElementById('heroSafePromiseDesc');
        if (safeTitleEl) safeTitleEl.textContent = copyLive.safePromiseTitle;
        if (safeDescEl) safeDescEl.textContent = copyLive.safePromiseDesc;

        if (live.config.contact) {
          var spLink = document.getElementById('heroShopeeLink');
          var ftShopee = document.getElementById('footerShopee');
          var ftShopeeWrap = document.getElementById('footerShopeeWrap');
          var ftHot = document.getElementById('footerHotline');
          if (spLink) {
            spLink.href = live.config.contact.shopeeUrl || '#';
            spLink.classList.toggle('hidden', !live.config.contact.shopeeUrl);
          }
          if (ftShopeeWrap) {
            ftShopeeWrap.classList.toggle('hidden', !live.config.contact.shopeeUrl);
          }
          if (ftShopee && live.config.contact.shopeeUrl) {
            ftShopee.href = live.config.contact.shopeeUrl;
            ftShopee.textContent = 'Shopee Chính hãng: ' + live.config.contact.shopeeUrl.replace('https://', '');
          }
          if (ftHot) {
            if (live.config.contact.hotline) {
              ftHot.textContent = 'Hotline / Zalo: ' + live.config.contact.hotline;
            } else {
              ftHot.innerHTML = '<button type="button" class="link-btn" onclick="switchTab(\\'CONTACT\\')">Nhắn tin tư vấn trực tuyến 24/7 →</button>';
            }
          }
        }
      }
      reconcileCartFromStorage();
      renderShopeeBanners();
      renderCategoryPills();
      renderProducts();
      renderWholesaleSection();
      renderContactSection();
      if (document.getElementById('prodModal').classList.contains('open')) {
        renderProdModalContent();
      }
      if (document.getElementById('cartModal').classList.contains('open')) {
        renderCartModal();
      }
      tryOpenPendingDeepLinkSku();
    }

    document.addEventListener('keydown', function(ev) {
      var prodOpen = document.getElementById('prodModal') && document.getElementById('prodModal').classList.contains('open');
      if (ev.key === 'Escape') {
        if (STATE.zoomOpen) {
          closeZoomModal();
        } else if (prodOpen) {
          closeProdModal();
        } else if (document.getElementById('cartModal').classList.contains('open')) {
          closeCartModal();
        }
      } else if (prodOpen && ev.key === 'ArrowLeft') {
        stepModalImg(-1);
      } else if (prodOpen && ev.key === 'ArrowRight') {
        stepModalImg(1);
      }
    });

    // Khởi tạo tức thì 0ms từ dữ liệu bootstrap & đồng bộ ngầm từ CMS API riêng
    reconcileCartFromStorage();
    renderShopeeBanners();
    renderCategoryPills();
    renderProducts();
    renderWholesaleSection();
    renderContactSection();
    applyDeepLinkQuery();
    setInterval(function() {
      if (STATE.carouselPaused || STATE.tab !== 'PRODUCTS' || prefersReducedMotionClient()) return;
      var b = STATE.data && STATE.data.config && STATE.data.config.banners;
      if (b && b.enabled !== false && b.carouselBanners && b.carouselBanners.length > 1) {
        stepCarousel(1);
      }
    }, 4800);
    fetch(apiEndpoint(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (d) applyLiveStorefrontData(d); })
      .catch(function() {});
  </script>
</body>
</html>
`
}

export function generateStorefrontSitemapXml(snapshot) {
  const domain = String(snapshot?.config?.customDomain || 'bomocdecor.vn').trim()
  const isClosed = Boolean(snapshot?.storefrontClosed || snapshot?.config?.enabled === false)
  const wsAllowed = !isClosed && snapshot?.config?.wholesaleEnabled !== false
  const urls = [{ loc: `https://${domain}/`, changefreq: 'daily', priority: '1.0' }]
  if (wsAllowed) {
    urls.push({ loc: `https://${domain}/?tab=WHOLESALE`, changefreq: 'daily', priority: '0.9' })
  }
  urls.push({ loc: `https://${domain}/?tab=CONTACT`, changefreq: 'weekly', priority: '0.8' })
  if (!isClosed && Array.isArray(snapshot?.products)) {
    for (const p of snapshot.products.slice(0, 100)) {
      if (p?.sku) {
        urls.push({
          loc: `https://${domain}/?sku=${encodeURIComponent(String(p.sku))}`,
          changefreq: 'daily',
          priority: '0.8',
        })
      }
    }
  }
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${escapeHtml(u.loc)}</loc><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

async function main() {
  const prisma = getPrisma()
  const snapshot = await buildCmsStorefrontSnapshot()
  const domain = snapshot.config.customDomain
  const targetRepo = parseArg('repo') || 'khoap1220-hue/bomocdecor-vn'
  const customOutDir = parseArg('out-dir')

  console.log(`=== PUBLISH CUSTOM DOMAIN STOREFRONT ===`)
  console.log(`  CMS Instance ID : ${snapshot.cmsInstanceId}`)
  console.log(`  Brand           : ${snapshot.brand.brandName}`)
  console.log(`  Custom Domain   : https://${domain}`)
  console.log(`  CMS API Origin  : ${snapshot.config.cmsBackendOrigin}`)
  console.log(`  Active Products : ${snapshot.products.length} (0 costPrice exposed)`)
  console.log(`  Target Repo     : ${targetRepo}`)

  const stageDir = customOutDir
    ? path.resolve(customOutDir)
    : path.resolve('.beta_stage', `storefront-${domain.replace(/[^a-z0-9.-]/g, '-')}`)
  fs.rmSync(stageDir, { recursive: true, force: true })
  fs.mkdirSync(stageDir, { recursive: true })

  const html = generateStandaloneStorefrontHtml(snapshot)
  fs.writeFileSync(path.join(stageDir, 'index.html'), html, 'utf8')
  fs.writeFileSync(path.join(stageDir, '404.html'), html, 'utf8')
  fs.writeFileSync(path.join(stageDir, 'CNAME'), domain, 'ascii')
  fs.writeFileSync(path.join(stageDir, '.nojekyll'), '', 'utf8')
  fs.writeFileSync(
    path.join(stageDir, 'storefront-data.json'),
    JSON.stringify(snapshot, null, 2),
    'utf8'
  )
  fs.writeFileSync(
    path.join(stageDir, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: https://${domain}/sitemap.xml\n`,
    'utf8'
  )
  fs.writeFileSync(
    path.join(stageDir, 'sitemap.xml'),
    generateStorefrontSitemapXml(snapshot),
    'utf8'
  )

  if (isDryRun) {
    console.log(`[DRY-RUN] Staged standalone storefront at: ${stageDir}`)
    await prisma.$disconnect()
    return
  }

  try {
    execFileSync('gh', ['auth', 'setup-git'], { stdio: 'ignore' })
    execFileSync('git', ['init'], { cwd: stageDir, stdio: 'ignore' })
    execFileSync('git', ['checkout', '-B', 'gh-pages'], { cwd: stageDir, stdio: 'ignore' })
    execFileSync('git', ['add', '-A'], { cwd: stageDir, stdio: 'ignore' })
    execFileSync(
      'git',
      [
        '-c',
        'user.name=OpenVNStorefrontPublisher',
        '-c',
        'user.email=noreply@users.noreply.github.com',
        'commit',
        '-m',
        `Publish storefront ${domain} (${snapshot.products.length} products)`,
      ],
      { cwd: stageDir, stdio: 'ignore' }
    )
    execFileSync(
      'git',
      ['push', '--force', `https://github.com/${targetRepo}.git`, 'gh-pages:gh-pages'],
      { cwd: stageDir, stdio: 'inherit' }
    )
    console.log(`✅ Published https://${domain}/ -> ${targetRepo} (gh-pages)`)
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true })
    await prisma.$disconnect()
  }
}

const isDirectCli =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectCli) {
  main().catch(async (err) => {
    console.error(err)
    if (_prisma) await _prisma.$disconnect().catch(() => null)
    process.exit(1)
  })
}
