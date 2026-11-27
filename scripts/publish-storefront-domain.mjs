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
 *   node scripts/publish-storefront-domain.mjs --dry-run
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

  const contact = {
    hotline: savedSf.contact?.hotline || settings.company_phone || '0909 686 868',
    zaloPhone: savedSf.contact?.zaloPhone || '0909686868',
    zaloUrl: savedSf.contact?.zaloUrl || 'https://zalo.me/0909686868',
    email: savedSf.contact?.email || `lienhe@${customDomain}`,
    address:
      savedSf.contact?.address ||
      settings.company_address ||
      'Xưởng Đúc Thủ Công & Showroom Bơ Mộc Decor — TP. Hồ Chí Minh',
    workingHours: savedSf.contact?.workingHours || '08:30 – 21:00 (Thứ 2 – Chủ Nhật)',
    shopeeUrl: savedSf.contact?.shopeeUrl || `https://shopee.vn/${shopeeUsername}`,
    facebookUrl: savedSf.contact?.facebookUrl || 'https://facebook.com/bomocdecor',
    tiktokUrl: savedSf.contact?.tiktokUrl || 'https://tiktok.com/@bomocdecor',
  }

  const rawBrandName = settings.brand_name?.trim() || 'Bơ Mộc Decor'
  const brandName =
    rawBrandName === 'OPENVN' && customDomain === 'bomocdecor.vn'
      ? 'Bơ Mộc Decor'
      : rawBrandName

  const cmsInstanceId = `cms_${crypto
    .createHash('sha256')
    .update(`${webCred?.id || 'cms'}:${customDomain}`)
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
          let images = prod.image ? [prod.image] : []
          if (prod.attributes) {
            try {
              const attr = JSON.parse(prod.attributes)
              if (attr.shopeeItemId) shopeeItemId = String(attr.shopeeItemId)
              if (Array.isArray(attr.images) && attr.images.length > 0) {
                images = attr.images.filter((u) => typeof u === 'string' && u.startsWith('http'))
                if (prod.image && !images.includes(prod.image)) images = [prod.image, ...images]
              }
            } catch {
              // ignore
            }
          }
          const { cleanTitle, variantLabel } = splitTitle(prod.name)
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

          return {
            id: prod.id,
            sku: prod.sku,
            name: prod.name,
            cleanTitle,
            variantLabel,
            description: wl?.description || prod.description || '',
            categoryId: prod.categoryId,
            categoryName: prod.category?.name || 'Nến Bơ & Thạch Cao Thủ Công',
            retailPrice,
            wholesalePrices,
            unit: prod.unit || 'bộ',
            type: prod.type || 'SIMPLE',
            fragile: Boolean(prod.fragile),
            image: prod.image || images[0] || null,
            images: images.slice(0, 6),
            inStock: prod.stock > 0,
            availableToOrder: prod.stock > 0 || allowPreorder,
            stockLabel:
              prod.stock > 0
                ? `Sẵn hàng (${prod.stock} ${prod.unit || 'bộ'})`
                : allowPreorder
                  ? 'Chế tác thủ công tại xưởng (Giao 1–2 ngày)'
                  : 'Tạm hết hàng',
            shopeeUrl:
              shopeeItemId && shopeeShopId
                ? `https://shopee.vn/product/${shopeeShopId}/${shopeeItemId}`
                : contact.shopeeUrl,
          }
        })

  const hasBankTransfer = Boolean(settings.invoice_bank_code && settings.invoice_bank_account)
  const heroBadgeText =
    savedSf.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc'
  const rawBrandSub = (settings.brand_subtitle || '').trim()
  const customerBrandSubtitle =
    rawBrandSub && rawBrandSub !== 'Quản lý bán hàng đa kênh'
      ? rawBrandSub
      : heroBadgeText

  return {
    ok: true,
    storefrontClosed: !isEnabled,
    cmsInstanceId,
    generatedAt: new Date().toISOString(),
    brand: {
      brandName,
      brandShortName: settings.brand_short_name || 'BƠ MỘC',
      brandBadge: settings.brand_badge || 'CRAFT',
      brandSubtitle: customerBrandSubtitle,
      footerTagline:
        settings.brand_footer_tagline ||
        'Xưởng Đúc Thạch Cao Thủ Công & Nến Bơ Thực Vật Thuần Chay · Sỉ & Lẻ Toàn Quốc',
      workshopName: settings.shop_default_workshop || 'Xưởng Đúc Thủ Công Bơ Mộc',
      companyName: settings.company_name || brandName,
    },
    config: {
      enabled: isEnabled,
      customDomain,
      additionalDomains: [`www.${customDomain}`],
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
      freeShipThreshold: Number(savedSf.freeShipThreshold) || 500_000,
      baseShippingFee: Number(savedSf.baseShippingFee) || 30_000,
      returnDays: Number(savedSf.returnDays) || 7,
      allowPreorderWhenOutOfStock: allowPreorder,
      contact,
      banners: normalizeSnapshotBanners(savedSf.banners, isEnabled),
    },
    bankTransfer: hasBankTransfer
      ? {
          bankCode: settings.invoice_bank_code,
          bankName: settings.invoice_bank_name || settings.invoice_bank_code,
          bankAccount: settings.invoice_bank_account,
          bankHolder: settings.invoice_bank_holder || '',
        }
      : null,
    categories,
    products,
    articles: [],
  }
}

export function generateStandaloneStorefrontHtml(snapshot) {
  const brandName = escapeHtml(snapshot.brand.brandName)
  const rawSub = String(snapshot.brand.brandSubtitle || '').trim()
  const headerSub = escapeHtml(
    rawSub && rawSub !== 'Quản lý bán hàng đa kênh'
      ? rawSub
      : snapshot.config.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc'
  )
  const rawShort = String(snapshot.brand.brandShortName || snapshot.brand.brandName || 'BM')
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
  const jsonBootstrap = JSON.stringify(snapshot).replace(/<\//g, '<\\/')
  const tiers = snapshot.config.wholesaleTiers || []
  const wsRangeLabel =
    tiers.length >= 2
      ? `(${escapeHtml(tiers[0].badge)} → ${escapeHtml(tiers[tiers.length - 1].badge)})`
      : tiers.length === 1
        ? `(${escapeHtml(tiers[0].badge)})`
        : ''

  const sameAsLinks = [
    snapshot.config.contact?.shopeeUrl,
    snapshot.config.contact?.facebookUrl,
    snapshot.config.contact?.tiktokUrl,
  ].filter((u) => typeof u === 'string' && u.startsWith('https://'))

  const productListElements =
    !snapshot.storefrontClosed && Array.isArray(snapshot.products)
      ? snapshot.products.slice(0, 30).map((p, idx) => ({
          '@type': 'ListItem',
          position: idx + 1,
          item: {
            '@type': 'Product',
            sku: p.sku,
            name: p.name,
            description: String(p.description || p.cleanTitle || p.name).slice(0, 260),
            ...(p.image ? { image: p.image } : {}),
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
        }))
      : []

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Store',
        name: snapshot.brand.brandName,
        url: `https://${snapshot.config.customDomain}/`,
        description: snapshot.config.heroSubtitle,
        ...(snapshot.config.banners?.shopLogoUrl
          ? { logo: snapshot.config.banners.shopLogoUrl }
          : {}),
        ...(ogBannerImg ? { image: ogBannerImg } : {}),
        telephone: snapshot.config.contact.hotline,
        email: snapshot.config.contact.email,
        address: {
          '@type': 'PostalAddress',
          streetAddress: snapshot.config.contact.address,
          addressCountry: 'VN',
        },
        ...(sameAsLinks.length > 0 ? { sameAs: sameAsLinks } : {}),
      },
      {
        '@type': 'WebSite',
        name: snapshot.brand.brandName,
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
              name: `Danh mục sản phẩm ${snapshot.brand.brandName}`,
              numberOfItems: productListElements.length,
              itemListElement: productListElements,
            },
          ]
        : []),
    ],
  }).replace(/<\//g, '<\\/')

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
      --muted: #6b6661;
      --line: #e7e2da;
      --brand: #9a5b25;
      --brand-dark: #7c4619;
      --brand-soft: #fdf4eb;
      --accent: #0066cc;
      --accent-dark: #0052a8;
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
    a { color: inherit; text-decoration: none; }
    button, input, select, textarea { font: inherit; }
    .container { max-width: 1240px; margin: 0 auto; padding: 0 18px; }
    .topbar {
      background: linear-gradient(90deg, #fef3c7, #f5f5f4, #d1fae5);
      border-bottom: 1px solid var(--line);
      font-size: 12.5px;
      font-weight: 600;
      text-align: center;
      padding: 8px 14px;
      color: #292524;
    }
    header {
      z-index: 40;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
    }
    @media (min-width: 641px) {
      header { position: sticky; top: 0; }
    }
    .nav-wrap {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
    }
    .brand-box { display: flex; align-items: center; gap: 12px; cursor: pointer; }
    .brand-logo {
      width: 42px; height: 42px; border-radius: 13px;
      background: linear-gradient(135deg, #b4692c, #3f2e21);
      color: #fff; font-weight: 800; font-size: 18px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 4px 12px rgba(154, 91, 37, 0.25);
    }
    .brand-title { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
    .domain-pill {
      font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
      background: var(--brand-soft); color: var(--brand-dark); border: 1px solid #f0d5b8;
    }
    .brand-sub { font-size: 11.5px; color: var(--muted); }
    .nav-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .tab-btn {
      min-height: 40px; padding: 0 14px; border-radius: 11px; border: 1px solid transparent;
      background: transparent; color: var(--text); font-size: 13px; font-weight: 650;
      cursor: pointer; transition: all 0.16s ease; display: inline-flex; align-items: center; gap: 6px;
    }
    .tab-btn:hover { background: #f3efe9; }
    .tab-btn.active { background: #1c1917; color: #fff; }
    .tab-btn.wholesale.active { background: var(--brand); color: #fff; }
    .cart-btn {
      min-height: 40px; padding: 0 15px; border-radius: 11px; border: none;
      background: var(--accent); color: #fff; font-size: 13px; font-weight: 700;
      cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
    }
    .cart-btn:hover { background: var(--accent-dark); }
    .hero {
      padding: 36px 0 32px;
      background: radial-gradient(circle at top left, #fff8ed 0%, #faf8f5 55%, #eefaf4 100%);
      border-bottom: 1px solid var(--line);
    }
    .hero-grid {
      display: grid; gap: 24px; grid-template-columns: 1.35fr 1fr; align-items: center;
    }
    @media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr; } }
    .hero-badge {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 5px 13px; border-radius: 999px; background: #fff;
      border: 1px solid #e7cfb4; color: var(--brand-dark); font-size: 12px; font-weight: 700;
      margin-bottom: 12px;
    }
    .hero h1 { font-size: clamp(24px, 3.3vw, 38px); font-weight: 850; line-height: 1.18; letter-spacing: -0.02em; margin-bottom: 12px; }
    .hero p { color: var(--muted); font-size: 15px; max-width: 640px; margin-bottom: 18px; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 10px; }
    .btn-primary {
      min-height: 44px; padding: 0 18px; border-radius: 12px; border: none;
      background: #1c1917; color: #fff; font-weight: 700; font-size: 13.5px; cursor: pointer;
    }
    .btn-primary:hover { opacity: 0.92; }
    .btn-ws {
      min-height: 44px; padding: 0 18px; border-radius: 12px;
      border: 1.5px solid #d99b66; background: var(--brand-soft); color: var(--brand-dark);
      font-weight: 750; font-size: 13.5px; cursor: pointer;
    }
    .btn-outline {
      min-height: 44px; padding: 0 16px; border-radius: 12px;
      border: 1px solid var(--line); background: #fff; color: var(--text);
      font-weight: 650; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
    }
    .trust-stack { display: grid; gap: 10px; }
    .trust-card {
      background: rgba(255,255,255,0.92); border: 1px solid var(--line);
      border-radius: 14px; padding: 13px 15px; display: flex; gap: 12px; align-items: flex-start;
    }
    .trust-icon {
      width: 36px; height: 36px; border-radius: 10px; background: var(--brand-soft);
      color: var(--brand-dark); font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .trust-card h3 { font-size: 13px; font-weight: 750; margin-bottom: 2px; }
    .trust-card p { font-size: 12px; color: var(--muted); margin: 0; }
    main { padding: 28px 0 52px; min-height: 60vh; }
    .toolbar {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 15px; margin-bottom: 22px; box-shadow: var(--shadow);
      display: flex; flex-direction: column; gap: 12px;
    }
    .toolbar-row { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center; }
    .search-input {
      flex: 1; min-width: 240px; max-width: 440px; height: 42px;
      border: 1px solid var(--line); border-radius: 11px; padding: 0 14px; background: #fff; font-size: 13.5px;
    }
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
      display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(262px, 1fr));
    }
    .prod-card {
      background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
      overflow: hidden; display: flex; flex-direction: column; transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .prod-card:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
    .prod-img-wrap {
      position: relative; aspect-ratio: 1 / 1; background: #f3efe9; overflow: hidden; cursor: pointer;
    }
    .prod-img-wrap img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.3s ease; }
    .prod-card:hover .prod-img-wrap img { transform: scale(1.04); }
    .badge-var {
      position: absolute; top: 10px; left: 10px; background: rgba(28,25,23,0.84); color: #fff;
      font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
    }
    .badge-ws {
      position: absolute; top: 10px; right: 10px; background: #f59e0b; color: #1c1917;
      font-size: 10.5px; font-weight: 800; padding: 3px 9px; border-radius: 999px;
    }
    .prod-body { padding: 14px; display: flex; flex-direction: column; justify-content: space-between; flex: 1; gap: 12px; }
    .sku-line { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
    .sku-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .stock-ok { color: var(--ok); font-weight: 600; }
    .prod-title { font-size: 14px; font-weight: 750; line-height: 1.38; margin-top: 4px; cursor: pointer; }
    .prod-title:hover { color: var(--accent); }
    .prod-var-txt { font-size: 12px; color: var(--brand-dark); font-weight: 650; margin-top: 3px; }
    .price-area { border-top: 1px solid var(--line); padding-top: 10px; }
    .retail-price { font-size: 18px; font-weight: 850; color: var(--accent); }
    .ws-hint { font-size: 11.5px; color: var(--brand-dark); margin-top: 2px; }
    .ws-mini-table {
      background: var(--brand-soft); border: 1px solid #efd6b8; border-radius: 10px;
      padding: 8px 10px; font-size: 11.5px; display: grid; gap: 3px;
    }
    .ws-mini-row { display: flex; justify-content: space-between; }
    .card-actions { display: grid; grid-template-columns: 1fr 1.45fr; gap: 7px; margin-top: 10px; }
    .btn-sm-out {
      min-height: 38px; border-radius: 10px; border: 1px solid var(--line); background: #fff;
      font-size: 12px; font-weight: 650; cursor: pointer;
    }
    .btn-sm-buy {
      min-height: 38px; border-radius: 10px; border: none; background: #1c1917; color: #fff;
      font-size: 12px; font-weight: 750; cursor: pointer;
    }
    .btn-sm-buy:hover { background: var(--accent); }
    .tier-grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); margin-bottom: 22px; }
    .tier-card { background: var(--card); border: 1.5px solid var(--line); border-radius: var(--radius); padding: 18px; }
    .tier-card.featured { border-color: #d97706; background: #fffbf5; }
    .two-col { display: grid; gap: 22px; grid-template-columns: 1.35fr 1fr; align-items: start; }
    @media (max-width: 960px) { .two-col { grid-template-columns: 1fr; } }
    .panel { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
    .panel h2 { font-size: 17px; font-weight: 800; margin-bottom: 6px; }
    .panel p.desc { font-size: 12.5px; color: var(--muted); margin-bottom: 14px; }
    .table-scroll { overflow-x: auto; border: 1px solid var(--line); border-radius: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    th, td { padding: 10px 11px; border-bottom: 1px solid var(--line); text-align: left; }
    th { background: #f5f2ec; font-weight: 750; }
    td.num, th.num { text-align: right; }
    .form-grid { display: grid; gap: 11px; grid-template-columns: 1fr 1fr; }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
    .field { display: flex; flex-direction: column; gap: 4px; }
    .field.full { grid-column: 1 / -1; }
    .field label { font-size: 12px; font-weight: 700; }
    .field input, .field textarea {
      border: 1px solid var(--line); border-radius: 10px; padding: 9px 12px; font-size: 13.5px; background: #fff;
    }
    .contact-item {
      border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; background: #fff;
    }
    .contact-item small { display: block; font-size: 11.5px; color: var(--muted); }
    .contact-item strong, .contact-item a { font-size: 14.5px; font-weight: 750; color: var(--text); }
    .modal-backdrop {
      position: fixed; inset: 0; z-index: 80; background: rgba(15, 23, 42, 0.55);
      display: none; align-items: center; justify-content: center; padding: 16px;
    }
    .modal-backdrop.open { display: flex; }
    .modal {
      background: #fff; border-radius: 18px; max-width: 680px; width: 100%;
      max-height: 90vh; overflow-y: auto; padding: 22px; position: relative; box-shadow: 0 20px 50px rgba(0,0,0,0.22);
    }
    .modal-close {
      position: absolute; top: 14px; right: 14px; width: 34px; height: 34px;
      border-radius: 50%; border: 1px solid var(--line); background: #fff; cursor: pointer; font-weight: 800;
    }
    .alert-ok {
      background: var(--ok-soft); border: 1px solid #99f6e4; color: #115e59;
      padding: 13px 15px; border-radius: 12px; font-size: 13px; margin-bottom: 12px;
    }
    footer {
      background: #fff; border-top: 1px solid var(--line); padding: 30px 0; font-size: 12.5px; color: var(--muted);
    }
    .footer-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
    .footer-grid h4 { color: var(--text); font-size: 14px; font-weight: 800; margin-bottom: 8px; }
    .toast {
      position: fixed; bottom: 20px; right: 20px; z-index: 100;
      background: #1c1917; color: #fff; padding: 12px 16px; border-radius: 12px;
      font-size: 13px; font-weight: 650; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      display: none; max-width: 340px;
    }
    .hidden { display: none !important; }
    .brand-logo-img {
      width: 42px; height: 42px; border-radius: 50%; object-fit: cover;
      border: 1px solid var(--line); box-shadow: 0 2px 8px rgba(0,0,0,0.08); flex-shrink: 0;
    }
    .hero-cover-card {
      border-radius: 16px; overflow: hidden; border: 1px solid var(--line);
      background: var(--card); box-shadow: var(--shadow);
    }
    .hero-cover-card img { width: 100%; aspect-ratio: 1196 / 518; object-fit: cover; display: block; }
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
      height: 34px; border-top: 1px solid var(--line); padding: 0 14px;
      display: flex; align-items: center; justify-content: space-between; font-size: 11.5px; color: var(--muted);
    }
    .carousel-dots { display: flex; align-items: center; gap: 6px; }
    .carousel-dot {
      height: 8px; width: 8px; border-radius: 999px; border: none; background: #d6d0c7; cursor: pointer; transition: all 0.2s ease;
    }
    .carousel-dot.active { width: 20px; background: var(--brand); }
    .hotspot-stage { position: relative; width: 100%; background: #f3efe9; overflow: hidden; }
    .hotspot-stage img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .hotspot-zone {
      position: absolute; z-index: 4; border: 2px solid transparent; background: transparent;
      cursor: pointer; transition: all 0.18s ease;
    }
    .hotspot-zone:hover { background: rgba(0,0,0,0.05); border-color: rgba(251, 191, 36, 0.9); }
    .hotspot-pill {
      position: absolute; right: 8px; bottom: 8px; padding: 3px 9px; border-radius: 999px;
      background: rgba(28,25,23,0.78); color: #fff; font-size: 11px; font-weight: 700;
      white-space: nowrap; max-width: calc(100% - 10px); overflow: hidden; text-overflow: ellipsis;
      backdrop-filter: blur(4px); transition: transform 0.18s ease, background 0.18s ease;
    }
    @media (max-width: 520px) {
      .hotspot-pill { right: 5px; bottom: 5px; padding: 2px 6px; font-size: 9.5px; }
    }
    .hotspot-zone:hover .hotspot-pill { background: var(--brand); transform: scale(1.05); }
    .col-banner-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); }
    @media (max-width: 860px) { .col-banner-grid { grid-template-columns: repeat(2, 1fr); gap: 10px; } }
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
  </style>
</head>
<body>
  <div class="topbar" id="announcementBar">${escapeHtml(snapshot.config.announcementBar)}</div>

  <header>
    <div class="container nav-wrap">
      <div class="brand-box" onclick="switchTab('PRODUCTS')">
        <span id="brandLogoWrap">${
          shopLogoUrl
            ? `<img src="${shopLogoUrl}" alt="${brandName}" referrerpolicy="no-referrer" class="brand-logo-img" />`
            : `<div class="brand-logo" id="brandLogoBox">${logoInitials}</div>`
        }</span>
        <div>
          <div class="brand-title">
            <span id="brandNameHdr">${brandName}</span>
            <span class="domain-pill" id="domainPill">${domain}</span>
          </div>
          <div class="brand-sub" id="brandSubHdr">${headerSub}</div>
        </div>
      </div>

      <nav class="nav-tabs" aria-label="Điều hướng chính">
        <button type="button" class="tab-btn active" id="tab-PRODUCTS" onclick="switchTab('PRODUCTS')">
          Sản phẩm (<span id="prodCountNav">${snapshot.products.length}</span>)
        </button>
        <button type="button" class="tab-btn wholesale${snapshot.config.wholesaleEnabled === false ? ' hidden' : ''}" id="tab-WHOLESALE" onclick="switchTab('WHOLESALE')">
          Bảng Giá Sỉ <span id="wsNavBadge">${wsRangeLabel}</span>
        </button>
        <button type="button" class="tab-btn" id="tab-CONTACT" onclick="switchTab('CONTACT')">
          Liên hệ &amp; Xưởng
        </button>
        <button type="button" class="tab-btn" id="tab-TRACKING" onclick="switchTab('TRACKING')">
          Tra cứu đơn
        </button>
        <button type="button" class="cart-btn" onclick="openCartModal()">
          🛒 Giỏ hàng (<span id="cartCountBadge">0</span>)
        </button>
      </nav>
    </div>
  </header>

  <section class="hero">
    <div class="container hero-grid">
      <div>
        <div class="hero-badge" id="heroBadge">✨ ${escapeHtml(snapshot.config.heroBadge)}</div>
        <h1 id="heroTitle">${heroTitle}</h1>
        <p id="heroSubtitle">${heroSub}</p>
        <div class="hero-actions">
          <button type="button" class="btn-primary" onclick="switchTab('PRODUCTS'); setPriceMode('RETAIL')">
            Khám Phá Sản Phẩm
          </button>
          <button type="button" id="heroWsBtn" class="btn-ws${snapshot.config.wholesaleEnabled === false ? ' hidden' : ''}" onclick="switchTab('WHOLESALE')">
            Bảng Giá Sỉ Đại Lý &amp; Quà Tặng OEM
          </button>
          <a id="heroShopeeLink" href="${escapeHtml(snapshot.config.contact.shopeeUrl)}" target="_blank" rel="noopener noreferrer" class="btn-outline${snapshot.config.contact.shopeeUrl ? '' : ' hidden'}">
            Gian hàng Shopee ↗
          </a>
        </div>
      </div>

      <div class="trust-stack">
        <div id="heroCoverWrap" class="${
          snapshot.config.enabled !== false &&
          snapshot.config.banners?.enabled !== false &&
          snapshot.config.banners?.coverBannerUrl
            ? 'hero-cover-card'
            : 'hidden'
        }">${
          snapshot.config.enabled !== false &&
          snapshot.config.banners?.enabled !== false &&
          snapshot.config.banners?.coverBannerUrl
            ? `<picture>${
                snapshot.config.banners.mobileCoverBannerUrl
                  ? `<source media="(max-width: 640px)" srcset="${escapeHtml(snapshot.config.banners.mobileCoverBannerUrl)}" />`
                  : ''
              }<img src="${escapeHtml(snapshot.config.banners.coverBannerUrl)}" alt="${brandName}" referrerpolicy="no-referrer" /></picture>`
            : ''
        }</div>
        <div class="trust-card">
          <div class="trust-icon">🕯️</div>
          <div>
            <h3>Đúc Thủ Công &amp; Sáp Bơ Thực Vật Thuần Chay</h3>
            <p>Không khói đen, an toàn cho phòng thiền, bàn trà, spa; bề mặt thạch cao kháng dầu mịn đẹp.</p>
          </div>
        </div>
        <div class="trust-card">
          <div class="trust-icon">%</div>
          <div>
            <h3>Chiết Khấu Giá Sỉ Tận Xưởng (Gộp Mẫu Tự Do)</h3>
            <p>Từ 10 SP giảm 15% · Từ 30 SP giảm 25% · Từ 100 SP giảm 35% + Khắc/in hộp quà OEM.</p>
          </div>
        </div>
        <div class="trust-card">
          <div class="trust-icon">🛡️</div>
          <div>
            <h3>Đóng Gói Chống Sốc — Bảo Hành Bể Vỡ 1 Đổi 1</h3>
            <p>Giao hàng toàn quốc nhanh chóng, kiểm hàng và đổi mới miễn phí trong ${snapshot.config.returnDays} ngày.</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <main class="container">
    <!-- TAB 1: PRODUCTS -->
    <section id="sec-PRODUCTS">
      <div id="shopeeBannerShowcase" class="banner-showcase hidden"></div>
      <div class="toolbar">
        <div class="toolbar-row">
          <input type="search" id="searchInput" class="search-input" placeholder="Tìm sản phẩm (nến bơ, hoa sen, búp sen, khay oval...) hoặc mã SKU..." oninput="renderProducts()" />
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <div class="mode-switch${snapshot.config.wholesaleEnabled === false ? ' hidden' : ''}" id="modeSwitchWrap">
              <button type="button" id="modeRetailBtn" class="active" onclick="setPriceMode('RETAIL')">Giá Bán Lẻ</button>
              <button type="button" id="modeWsBtn" onclick="setPriceMode('WHOLESALE')">Hiển thị Giá Sỉ</button>
            </div>
            <select id="sortSelect" class="select-box" onchange="renderProducts()" aria-label="Sắp xếp sản phẩm">
              <option value="DEFAULT">Sắp xếp: Đề xuất</option>
              <option value="PRICE_ASC">Giá: Thấp → Cao</option>
              <option value="PRICE_DESC">Giá: Cao → Thấp</option>
            </select>
          </div>
        </div>
        <div id="catFilterRow" style="display:none; flex-wrap:wrap; gap:6px; border-top:1px solid var(--line); padding-top:10px;"></div>
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
          <div class="table-scroll">
            <table>
              <thead id="wsTableHead"></thead>
              <tbody id="wsTableBody"></tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <h2>Đăng Ký Nhận Báo Giá Sỉ &amp; Gia Công Quà Tặng (OEM)</h2>
          <p class="desc" id="oemNoteText">${escapeHtml(snapshot.config.oemCustomNote)}</p>
          <div id="wsSuccessAlert" class="alert-ok hidden"></div>
          <form id="wholesaleForm" onsubmit="submitWholesaleForm(event)" class="form-grid">
            <div class="field">
              <label for="wsName">Họ và tên người liên hệ *</label>
              <input id="wsName" required placeholder="Chị Minh Anh" />
            </div>
            <div class="field">
              <label for="wsPhone">Số điện thoại / Zalo *</label>
              <input id="wsPhone" required placeholder="0909..." />
            </div>
            <div class="field">
              <label for="wsShop">Tên Shop / Spa / Doanh nghiệp</label>
              <input id="wsShop" placeholder="An Nhiên Spa / Công ty..." />
            </div>
            <div class="field">
              <label for="wsQty">Số lượng dự kiến (SP)</label>
              <input id="wsQty" type="number" min="10" value="30" />
            </div>
            <div class="field full">
              <label for="wsAddr">Tỉnh / Thành phố nhận hàng</label>
              <input id="wsAddr" placeholder="TP.HCM, Hà Nội, Đà Nẵng..." />
            </div>
            <div class="field full">
              <label for="wsEmail">Email nhận bảng giá (tùy chọn)</label>
              <input id="wsEmail" type="email" placeholder="purchasing@company.vn" />
            </div>
            <div class="field full">
              <label for="wsNote">Mẫu sản phẩm quan tâm / Yêu cầu đóng hộp quà riêng</label>
              <textarea id="wsNote" rows="3" placeholder="VD: Báo giá 50 hộp nến bơ 50 viên + 50 chân nến Hoa Sen trắng..."></textarea>
            </div>
            <div class="field full">
              <button type="submit" class="btn-ws" style="width:100%" id="wsSubmitBtn">
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
          <div id="ctSuccessAlert" class="alert-ok hidden"></div>
          <form onsubmit="submitContactForm(event)" class="form-grid">
            <div class="field">
              <label for="ctName">Họ và tên *</label>
              <input id="ctName" required placeholder="Nguyễn Thanh Hà" />
            </div>
            <div class="field">
              <label for="ctPhone">Số điện thoại / Zalo *</label>
              <input id="ctPhone" required placeholder="0909..." />
            </div>
            <div class="field full">
              <label for="ctEmail">Email (tùy chọn)</label>
              <input id="ctEmail" type="email" placeholder="ban@email.com" />
            </div>
            <div class="field full">
              <label for="ctMsg">Nội dung cần tư vấn *</label>
              <textarea id="ctMsg" rows="4" required placeholder="Nhập câu hỏi hoặc yêu cầu của bạn..."></textarea>
            </div>
            <div class="field full">
              <button type="submit" class="btn-primary" style="width:100%" id="ctSubmitBtn">
                Gửi Liên Hệ Tới Cửa Hàng
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- TAB 4: TRACKING -->
    <section id="sec-TRACKING" class="hidden">
      <div class="panel" style="max-width:560px; margin:0 auto;">
        <h2>Tra Cứu Đơn Hàng &amp; Yêu Cầu Báo Giá Sỉ</h2>
        <p class="desc">Nhập mã đơn (VD: BM-WEB-... hoặc BM-SI-...) kèm số điện thoại đặt hàng để xem trạng thái.</p>
        <form onsubmit="submitLookup(event)" class="form-grid">
          <div class="field full">
            <label for="lkCode">Mã đơn hàng / Mã yêu cầu *</label>
            <input id="lkCode" required placeholder="VD: BM-WEB-261127-1234" />
          </div>
          <div class="field full">
            <label for="lkPhone">Số điện thoại đặt hàng (hoặc 4 số cuối) *</label>
            <input id="lkPhone" required placeholder="0909..." />
          </div>
          <div class="field full">
            <button type="submit" class="btn-primary" style="width:100%" id="lkBtn">Tra cứu ngay</button>
          </div>
        </form>
        <div id="lkOutput" style="margin-top:14px;"></div>
      </div>
    </section>
  </main>

  <footer>
    <div class="container footer-grid">
      <div>
        <h4 id="footerBrand">${brandName}</h4>
        <p id="footerWorkshop">${escapeHtml(snapshot.brand.workshopName)}</p>
        <p style="margin-top:6px;">Website chính thức: <strong>https://${domain}</strong></p>
      </div>
      <div>
        <h4>Dành cho Khách hàng &amp; Đối tác</h4>
        <p id="footerWsRow" class="${snapshot.config.wholesaleEnabled === false ? 'hidden' : ''}"><a href="#wholesale" onclick="switchTab('WHOLESALE'); return false;">• Bảng giá sỉ tận xưởng (10+ / 30+ / 100+ SP)</a></p>
        <p><a href="#contact" onclick="switchTab('CONTACT'); return false;">• Đặt gia công quà tặng doanh nghiệp (OEM)</a></p>
        <p><a href="#tracking" onclick="switchTab('TRACKING'); return false;">• Tra cứu trạng thái đơn hàng</a></p>
      </div>
      <div>
        <h4>Kết nối Đa kênh</h4>
        <p id="footerHotline">Hotline / Zalo: ${escapeHtml(snapshot.config.contact.hotline)}</p>
        <p><a id="footerShopee" href="${escapeHtml(snapshot.config.contact.shopeeUrl)}" target="_blank" rel="noopener">Shopee Chính hãng: ${escapeHtml(snapshot.config.contact.shopeeUrl.replace('https://', ''))}</a></p>
        <p style="margin-top:6px; opacity:0.75;"><a href="${escapeHtml(snapshot.config.cmsBackendOrigin)}/login" target="_blank" rel="noopener">Cổng Quản trị Nhân sự CMS ↗</a></p>
      </div>
    </div>
  </footer>

  <!-- Product Detail Modal -->
  <div class="modal-backdrop" id="prodModal" onclick="if(event.target===this)closeProdModal()">
    <div class="modal" id="prodModalContent"></div>
  </div>

  <!-- Cart & Checkout Modal -->
  <div class="modal-backdrop" id="cartModal" onclick="if(event.target===this)closeCartModal()">
    <div class="modal" id="cartModalContent"></div>
  </div>

  <div class="toast" id="toastBox"></div>

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
      paymentMethod: 'COD',
      cart: [],
      cartHydratedKey: null,
      pendingSku: '',
      completedOrder: null
    };

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
    function showToast(msg) {
      var el = document.getElementById('toastBox');
      el.textContent = msg;
      el.style.display = 'block';
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(function() { el.style.display = 'none'; }, 3200);
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
          showToast('Đã sao chép ' + label + ': ' + val);
        }).catch(function() {
          showToast(label + ': ' + val);
        });
      } else {
        showToast(label + ': ' + val);
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
            renderProducts();
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
      ['PRODUCTS', 'WHOLESALE', 'CONTACT', 'TRACKING'].forEach(function(t) {
        var sec = document.getElementById('sec-' + t);
        var btn = document.getElementById('tab-' + t);
        if (sec) sec.classList.toggle('hidden', t !== tab);
        if (btn) btn.classList.toggle('active', t === tab);
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        return clean.indexOf('nguyên liệu') >= 0 || clean.indexOf('bột thạch cao') >= 0 || clean.indexOf('khuôn') >= 0 || clean.indexOf('diy') >= 0 || clean.indexOf('đổ nến') >= 0 || desc.indexOf('bột thạch cao') >= 0 || desc.indexOf('khuôn silicone') >= 0;
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
        renderProducts();
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
      toggleCollectionFilter(col.id);
    }

    function clampRatioClient(val, fb) {
      var n = Number(val);
      return isFinite(n) && n >= 0.5 && n <= 5 ? Math.round(n * 1000) / 1000 : fb;
    }

    function renderShopeeBanners() {
      var wrap = document.getElementById('shopeeBannerShowcase');
      if (!wrap) return;
      var isClosed = Boolean(STATE.data && (STATE.data.storefrontClosed || (STATE.data.config && STATE.data.config.enabled === false)));
      var banners = (STATE.data && STATE.data.config && STATE.data.config.banners) || null;
      var heroCover = document.getElementById('heroCoverWrap');
      var brandNameTxt = (STATE.data && STATE.data.brand && STATE.data.brand.brandName) || 'Bơ Mộc Decor';

      if (banners && banners.shopLogoUrl) {
        var logoWrap = document.getElementById('brandLogoWrap');
        if (logoWrap) {
          logoWrap.innerHTML = '<img src="' + esc(banners.shopLogoUrl) + '" alt="' + esc(brandNameTxt) + '" referrerpolicy="no-referrer" class="brand-logo-img" />';
        }
      }

      if (heroCover) {
        if (!isClosed && banners && banners.enabled !== false && banners.coverBannerUrl) {
          heroCover.className = 'hero-cover-card';
          heroCover.innerHTML = '<picture>' +
            (banners.mobileCoverBannerUrl ? '<source media="(max-width: 640px)" srcset="' + esc(banners.mobileCoverBannerUrl) + '" />' : '') +
            '<img src="' + esc(banners.coverBannerUrl) + '" alt="' + esc(brandNameTxt) + '" referrerpolicy="no-referrer" />' +
          '</picture>';
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
            var clickAttr = clickable
              ? ' style="cursor:pointer" onclick="onCarouselSlideClick(' + i + ')"'
              : '';
            return '<div class="carousel-slide' + act + '">' +
              '<picture>' +
                (s.mobileImageUrl ? '<source media="(max-width: 640px)" srcset="' + esc(s.mobileImageUrl) + '" />' : '') +
                '<img src="' + esc(s.imageUrl) + '" alt="' + esc(s.title || (brandNameTxt + ' #' + (i + 1))) + '" referrerpolicy="no-referrer"' + clickAttr + ' />' +
              '</picture>' +
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
              '<div class="carousel-dots" style="flex-shrink:0;">' + dotsHtml + '</div>' +
            '</div>' +
          '</div>';
        }

        spotlights.forEach(function(sb, sIdx) {
          var ratio = clampRatioClient(sb.aspectRatio, 1.796);
          var hsHtml = (sb.hotspots || []).map(function(hs, hIdx) {
            var matched = findProductByBannerRef(hs.targetSku, hs.shopeeProductId);
            var lbl = (matched && matched.cleanTitle) || hs.label || ('Xem sản phẩm #' + (hIdx + 1));
            var pillTxt = matched ? fmtVND(matched.retailPrice) + ' ↗' : 'Xem SP';
            return '<button type="button" class="hotspot-zone" title="' + esc(lbl) + '" aria-label="' + esc(lbl) + '"' +
              ' style="left:' + hs.x + '%;top:' + hs.y + '%;width:' + hs.w + '%;height:' + hs.h + '%;"' +
              ' onclick="onSpotlightHotspotClick(' + sIdx + ',' + hIdx + ')">' +
              '<span class="hotspot-pill">' + esc(pillTxt) + '</span>' +
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
        colHtml = '<div class="col-banner-grid">' + collections.map(function(col, cIdx) {
          var isAct = STATE.selectedCollectionId === col.id;
          var cnt = allProds.filter(function(p) { return matchesColFilter(p, col); }).length;
          return '<button type="button" class="col-banner-btn' + (isAct ? ' active' : '') + '" onclick="toggleCollectionIdx(' + cIdx + ')">' +
            '<img src="' + esc(col.imageUrl) + '" alt="' + esc(col.name) + '" referrerpolicy="no-referrer" loading="lazy" />' +
            '<div style="min-width:0;flex:1;">' +
              '<div class="col-banner-title">' + esc(col.name) + '</div>' +
              '<div class="col-banner-sub">' + (isAct ? 'Đang lọc · Bỏ chọn' : (cnt + ' mẫu tại xưởng')) + '</div>' +
            '</div>' +
          '</button>';
        }).join('') + '</div>';
      }

      wrap.innerHTML = topHtml + colHtml;
    }

    function renderCategoryPills() {
      var cats = (STATE.data && STATE.data.categories) || [];
      var cols = (STATE.data && STATE.data.config && STATE.data.config.banners && STATE.data.config.banners.collectionBanners) || [];
      var activeCol = STATE.selectedCollectionId === 'ALL' ? null : cols.find(function(x) { return x.id === STATE.selectedCollectionId; });
      var row = document.getElementById('catFilterRow');
      if (!row) return;
      if (!cats.length && !activeCol) {
        row.style.display = 'none';
        return;
      }
      row.style.display = 'flex';
      var totalLen = ((STATE.data && STATE.data.products) || []).length;
      var html = '<button type="button" class="tab-btn ' + (STATE.selectedCat === 'ALL' && !activeCol ? 'active' : '') + '" style="min-height:34px;border-radius:999px;border-color:#e7e2da;font-size:12px;" onclick="setCategory(\\'ALL\\')">Tất cả (' + totalLen + ')</button>';
      if (activeCol) {
        html += '<button type="button" class="tab-btn wholesale active" style="min-height:34px;border-radius:999px;font-size:12px;" onclick="toggleCollectionFilter(\\'' + jsAttr(activeCol.id) + '\\')">Bộ sưu tập: ' + esc(activeCol.name) + ' ✕</button>';
        if (activeCol.shopeeUrl) {
          html += '<a href="' + esc(activeCol.shopeeUrl) + '" target="_blank" rel="noopener" class="btn-outline" style="min-height:34px;border-radius:999px;font-size:11.5px;padding:0 12px;">Xem trên Shopee ↗</a>';
        }
      }
      html += cats.map(function(c) {
        var isAct = STATE.selectedCat === c.id;
        return '<button type="button" class="tab-btn ' + (isAct ? 'active' : '') + '" style="min-height:34px;border-radius:999px;border-color:#e7e2da;font-size:12px;" onclick="setCategory(\\'' + jsAttr(c.id) + '\\')">' + esc(c.name) + '</button>';
      }).join('');
      row.innerHTML = html;
    }

    function renderProducts() {
      var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
      var sort = document.getElementById('sortSelect').value;
      var grid = document.getElementById('productGrid');
      var isClosed = Boolean(STATE.data && (STATE.data.storefrontClosed || (STATE.data.config && STATE.data.config.enabled === false)));
      document.getElementById('prodCountNav').textContent = String(((STATE.data && STATE.data.products) || []).length);

      if (isClosed) {
        grid.innerHTML = '<div class="panel" style="grid-column:1/-1;text-align:center;padding:42px;border-color:#f0d5b8;background:#fffbf5;">' +
          '<h3 style="font-size:17px;font-weight:800;margin-bottom:6px;">Website hiện đang tạm ngưng nhận đơn trực tuyến để cập nhật danh mục</h3>' +
          '<p style="font-size:13px;color:#6b6661;margin-bottom:14px;">Quý khách vẫn có thể tra cứu trạng thái đơn hàng đã đặt hoặc liên hệ trực tiếp Hotline / Zalo để được phục vụ ngay.</p>' +
          '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">' +
            '<button type="button" class="btn-primary" onclick="switchTab(\\'CONTACT\\')">Xem Thông tin Liên hệ &amp; Zalo</button>' +
            '<button type="button" class="btn-outline" onclick="switchTab(\\'TRACKING\\')">Tra cứu đơn hàng</button>' +
          '</div></div>';
        return;
      }

      var wsAllowed = !(STATE.data && STATE.data.config && STATE.data.config.wholesaleEnabled === false);
      var cols = (STATE.data && STATE.data.config && STATE.data.config.banners && STATE.data.config.banners.collectionBanners) || [];
      var activeCol = STATE.selectedCollectionId === 'ALL' ? null : cols.find(function(x) { return x.id === STATE.selectedCollectionId; });
      var list = (STATE.data.products || []).filter(function(p) {
        if (STATE.selectedCat !== 'ALL' && p.categoryId !== STATE.selectedCat) return false;
        if (activeCol && !matchesColFilter(p, activeCol)) return false;
        if (!q) return true;
        return p.name.toLowerCase().indexOf(q) >= 0 || p.sku.toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0;
      });
      if (sort === 'PRICE_ASC') list.sort(function(a, b) { return a.retailPrice - b.retailPrice; });
      if (sort === 'PRICE_DESC') list.sort(function(a, b) { return b.retailPrice - a.retailPrice; });

      if (!list.length) {
        grid.innerHTML = '<div class="panel" style="grid-column:1/-1;text-align:center;padding:40px;">Không tìm thấy sản phẩm phù hợp với từ khóa.</div>';
        return;
      }
      grid.innerHTML = list.map(function(p) {
        var wsList = wsAllowed ? (p.wholesalePrices || []) : [];
        var firstWs = wsList[0];
        var bestWs = wsList[wsList.length - 1];
        var canBuy = p.availableToOrder !== false;
        var priceHtml = '';
        if (STATE.priceMode === 'WHOLESALE' && wsList.length) {
          priceHtml = '<div class="ws-mini-table">' +
            '<div class="ws-mini-row" style="color:#6b6661"><span>Giá lẻ:</span><span style="text-decoration:line-through">' + fmtVND(p.retailPrice) + '</span></div>' +
            wsList.map(function(w) {
              return '<div class="ws-mini-row"><span>Từ ' + w.minQty + ' SP (' + esc(w.badge) + '):</span><strong style="color:#7c4619">' + fmtVND(w.unitPrice) + '</strong></div>';
            }).join('') +
            '</div>';
        } else {
          priceHtml = '<div><span class="retail-price">' + fmtVND(p.retailPrice) + '</span> <small style="color:#6b6661">/ ' + esc(p.unit) + '</small></div>' +
            (firstWs ? '<div class="ws-hint">Giá sỉ từ ' + firstWs.minQty + ' SP: <strong>' + fmtVND(firstWs.unitPrice) + '</strong></div>' : '');
        }
        var addQty = (STATE.priceMode === 'WHOLESALE' && firstWs) ? firstWs.minQty : 1;
        return '<article class="prod-card">' +
          '<div class="prod-img-wrap" onclick="openProdModal(\\'' + jsAttr(p.id) + '\\')">' +
            (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" />' : '') +
            (p.variantLabel ? '<span class="badge-var">' + esc(p.variantLabel) + '</span>' : '') +
            (bestWs ? '<span class="badge-ws">Sỉ từ ' + fmtVND(bestWs.unitPrice) + '</span>' : '') +
          '</div>' +
          '<div class="prod-body">' +
            '<div>' +
              '<div class="sku-line"><span class="sku-code">' + esc(p.sku) + '</span><span class="stock-ok">' + esc(p.stockLabel || 'Sẵn sàng đặt') + '</span></div>' +
              '<h3 class="prod-title" onclick="openProdModal(\\'' + jsAttr(p.id) + '\\')">' + esc(p.cleanTitle) + '</h3>' +
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

    function renderWholesaleSection() {
      var tiers = (STATE.data.config && STATE.data.config.wholesaleTiers) || [];
      document.getElementById('tierCardsGrid').innerHTML = tiers.map(function(t, i) {
        return '<div class="tier-card ' + (i === 1 ? 'featured' : '') + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<span class="domain-pill" style="background:#9a5b25;color:#fff;border:none;">Chiết khấu ' + esc(t.badge) + '</span>' +
            '<small style="font-weight:700;color:#6b6661">Tối thiểu ' + t.minQty + ' SP</small>' +
          '</div>' +
          '<h3 style="font-size:15.5px;font-weight:800;margin-bottom:4px;">' + esc(t.label) + '</h3>' +
          '<p style="font-size:12.5px;color:#6b6661;">' + esc(t.description) + '</p>' +
        '</div>';
      }).join('');

      document.getElementById('wsTableHead').innerHTML = '<tr><th>Sản phẩm / SKU</th><th class="num">Giá lẻ</th>' +
        tiers.map(function(t) { return '<th class="num">Từ ' + t.minQty + ' SP (' + esc(t.badge) + ')</th>'; }).join('') +
        '<th style="text-align:center">Đặt sỉ</th></tr>';

      document.getElementById('wsTableBody').innerHTML = (STATE.data.products || []).map(function(p) {
        var canBuy = p.availableToOrder !== false;
        return '<tr>' +
          '<td><div class="sku-code" style="font-size:10.5px;color:#6b6661">' + esc(p.sku) + '</div><strong>' + esc(p.cleanTitle) + '</strong>' +
          (p.variantLabel ? '<div style="font-size:11.5px;color:#7c4619">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') + '</td>' +
          '<td class="num" style="color:#6b6661">' + fmtVND(p.retailPrice) + '</td>' +
          tiers.map(function(t) {
            return '<td class="num"><strong>' + fmtVND(calcWsPrice(p.retailPrice, t.discountPercent)) + '</strong></td>';
          }).join('') +
          '<td style="text-align:center">' +
            (canBuy
              ? '<button type="button" class="btn-sm-out" style="padding:0 10px;min-height:30px;" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',10)">+10</button>'
              : '<button type="button" class="btn-sm-out" disabled style="padding:0 8px;min-height:30px;opacity:0.55;cursor:not-allowed;">Tạm hết</button>') +
          '</td>' +
        '</tr>';
      }).join('');
    }

    function renderContactSection() {
      var c = (STATE.data.config && STATE.data.config.contact) || {};
      var items = [
        c.hotline ? { label: 'Hotline Tư vấn & Đặt sỉ nhanh', html: '<a href="tel:' + esc(c.hotline.replace(/\\s+/g,'')) + '">' + esc(c.hotline) + '</a>' } : null,
        c.zaloUrl ? { label: 'Zalo Báo Sỉ & CSKH Trực Tuyến', html: '<a href="' + esc(c.zaloUrl) + '" target="_blank" rel="noopener" style="color:#0066cc">' + esc(c.zaloUrl) + ' ↗</a>' } : null,
        c.shopeeUrl ? { label: 'Gian hàng Shopee Chính hãng', html: '<a href="' + esc(c.shopeeUrl) + '" target="_blank" rel="noopener" style="color:#ea580c">' + esc(c.shopeeUrl) + ' ↗</a>' } : null,
        c.email ? { label: 'Email Hợp tác & Báo giá Doanh nghiệp', html: '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' } : null,
        c.address ? { label: 'Địa chỉ Xưởng Đúc Thủ Công & Kho Trung Tâm', html: '<strong>' + esc(c.address) + '</strong>' } : null,
        c.workingHours ? { label: 'Giờ mở cửa & Hỗ trợ', html: '<strong>' + esc(c.workingHours) + '</strong>' } : null
      ].filter(Boolean);
      document.getElementById('contactDetailsList').innerHTML = items.map(function(it) {
        return '<div class="contact-item"><small>' + esc(it.label) + '</small>' + it.html + '</div>';
      }).join('');
    }

    function openProdModal(prodId) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === prodId; });
      if (!p) return;
      var wsAllowed = isWholesaleAllowed();
      var canBuy = p.availableToOrder !== false && !isStoreClosed();
      var wsHtml = wsAllowed ? (p.wholesalePrices || []).map(function(w) {
        return '<div class="ws-mini-row"><span>Từ ' + w.minQty + ' ' + esc(p.unit) + ' (' + esc(w.badge) + '):</span><strong>' + fmtVND(w.unitPrice) + ' / ' + esc(p.unit) + '</strong></div>';
      }).join('') : '';
      var buyBtnsHtml = canBuy
        ? '<div style="display:grid;grid-template-columns:' + (wsAllowed ? '1fr 1fr' : '1fr') + ';gap:8px;">' +
            '<button type="button" class="btn-primary" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',1);closeProdModal();">Mua lẻ (+1)</button>' +
            (wsAllowed ? '<button type="button" class="btn-ws" onclick="addToCart(\\'' + jsAttr(p.id) + '\\',10);closeProdModal();openCartModal();">Nhập sỉ (+10)</button>' : '') +
          '</div>'
        : '<button type="button" class="btn-outline" disabled style="width:100%;justify-content:center;opacity:0.6;cursor:not-allowed;">Tạm hết hàng</button>';
      document.getElementById('prodModalContent').innerHTML =
        '<button type="button" class="modal-close" onclick="closeProdModal()">✕</button>' +
        '<div style="display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));">' +
          '<div style="background:#f3efe9;border-radius:14px;overflow:hidden;aspect-ratio:1/1;">' +
            (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" style="width:100%;height:100%;object-fit:cover;" />' : '') +
          '</div>' +
          '<div style="display:flex;flex-direction:column;justify-content:space-between;gap:12px;">' +
            '<div>' +
              '<div class="sku-code" style="font-size:11.5px;color:#6b6661">SKU: ' + esc(p.sku) + '</div>' +
              '<h2 style="font-size:18px;font-weight:800;margin:4px 0;">' + esc(p.cleanTitle) + '</h2>' +
              (p.variantLabel ? '<div style="font-size:13px;font-weight:700;color:#7c4619;margin-bottom:8px;">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') +
              '<div class="retail-price" style="font-size:22px;margin-bottom:10px;">' + fmtVND(p.retailPrice) + ' <small style="font-size:12px;font-weight:500;color:#6b6661">/ ' + esc(p.unit) + '</small></div>' +
              (wsHtml ? '<div class="ws-mini-table" style="margin-bottom:10px;"><strong style="margin-bottom:2px;">Bảng giá sỉ xưởng (gộp mẫu tự do):</strong>' + wsHtml + '</div>' : '') +
              (p.description ? '<div style="max-height:140px;overflow-y:auto;font-size:12.5px;color:#57534e;white-space:pre-line;border:1px solid #e7e2da;border-radius:10px;padding:10px;">' + esc(p.description) + '</div>' : '') +
            '</div>' +
            '<div style="display:grid;gap:8px;">' +
              buyBtnsHtml +
              '<div style="display:grid;grid-template-columns:' + (p.shopeeUrl ? '1fr 1fr' : '1fr') + ';gap:8px;">' +
                '<button type="button" class="btn-outline" style="justify-content:center;" onclick="shareProdLink(\\'' + jsAttr(p.sku) + '\\')">Sao chép link SP</button>' +
                (p.shopeeUrl ? '<a href="' + esc(p.shopeeUrl) + '" target="_blank" rel="noopener" class="btn-outline" style="justify-content:center;">Xem trên Shopee ↗</a>' : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.getElementById('prodModal').classList.add('open');
    }
    function closeProdModal() { document.getElementById('prodModal').classList.remove('open'); }

    function addToCart(prodId, qty) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === prodId; });
      if (!p || p.availableToOrder === false) return;
      STATE.completedOrder = null;
      var hit = STATE.cart.find(function(i) { return i.product.id === prodId; });
      if (hit) hit.quantity += qty;
      else STATE.cart.push({ product: p, quantity: qty });
      saveCartToStorage();
      updateCartBadge();
      showToast('Đã thêm ' + qty + ' ' + p.unit + ' "' + p.cleanTitle + '" vào giỏ hàng');
    }
    function setPaymentMethod(m) {
      STATE.paymentMethod = m;
      renderCartModal();
    }
    function updateCartQty(prodId, delta) {
      STATE.cart = STATE.cart.map(function(i) {
        return i.product.id === prodId ? { product: i.product, quantity: i.quantity + delta } : i;
      }).filter(function(i) { return i.quantity > 0; });
      saveCartToStorage();
      updateCartBadge();
      renderCartModal();
    }
    function updateCartBadge() {
      var total = STATE.cart.reduce(function(s, i) { return s + i.quantity; }, 0);
      document.getElementById('cartCountBadge').textContent = String(total);
    }

    function openCartModal() {
      renderCartModal();
      document.getElementById('cartModal').classList.add('open');
    }
    function closeCartModal() { document.getElementById('cartModal').classList.remove('open'); }

    function renderCartModal() {
      var box = document.getElementById('cartModalContent');
      var bank = STATE.data.bankTransfer || null;
      if (STATE.completedOrder) {
        var co = STATE.completedOrder;
        var doneQr = co.paymentMethod === 'BANK_TRANSFER' && bank ? buildVietQrUrl(bank, co.grandTotal, co.refCode) : '';
        var bankDoneHtml = (co.paymentMethod === 'BANK_TRANSFER' && bank)
          ? '<div style="margin-top:12px;background:#fff;border:1px solid #bfdbfe;border-radius:12px;padding:12px;text-align:left;font-size:12px;color:#1c1917;">' +
              '<div style="font-weight:800;color:#0052a8;margin-bottom:6px;">Quét mã VietQR thanh toán đơn ' + esc(co.refCode) + '</div>' +
              (doneQr ? '<div style="text-align:center;margin:8px 0;"><img src="' + esc(doneQr) + '" alt="VietQR" style="max-height:210px;border-radius:10px;border:1px solid #e7e2da;padding:6px;background:#fff;" onerror="this.style.display=\\'none\\'" /></div>' : '') +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;"><span>Ngân hàng: <strong>' + esc(bank.bankName) + '</strong> · STK: <strong>' + esc(bank.bankAccount) + '</strong></span><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:28px;" onclick="copyTxt(\\'' + jsAttr(bank.bankAccount) + '\\',\\'số tài khoản\\')">Copy STK</button></div>' +
              (bank.bankHolder ? '<div style="margin-top:3px;">Chủ TK: ' + esc(bank.bankHolder) + '</div>' : '') +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:4px;"><span>Nội dung CK: <strong style="font-family:monospace;">' + esc(co.refCode) + '</strong></span><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:28px;" onclick="copyTxt(\\'' + jsAttr(co.refCode) + '\\',\\'nội dung chuyển khoản\\')">Copy nội dung</button></div>' +
            '</div>'
          : '';
        box.innerHTML = '<button type="button" class="modal-close" onclick="closeCartModal()">✕</button>' +
          '<div class="alert-ok" style="text-align:center;padding:22px;">' +
            '<h3 style="font-size:18px;margin-bottom:6px;">🎉 Đặt hàng thành công!</h3>' +
            '<p>Mã đơn hàng của bạn: <strong style="font-family:monospace;font-size:15px;">' + esc(co.refCode) + '</strong> <button type="button" class="btn-sm-out" style="padding:0 8px;min-height:26px;margin-left:4px;" onclick="copyTxt(\\'' + jsAttr(co.refCode) + '\\',\\'mã đơn hàng\\')">Sao chép</button></p>' +
            '<p style="margin-top:6px;">Tổng thanh toán: <strong>' + fmtVND(co.grandTotal) + '</strong></p>' +
            bankDoneHtml +
            '<div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
              '<button type="button" class="btn-outline" style="min-height:40px;" onclick="jumpTrackOrder(\\'' + jsAttr(co.refCode) + '\\',\\'' + jsAttr(co.phone || '') + '\\')">Tra cứu đơn này</button>' +
              '<button type="button" class="btn-primary" style="min-height:40px;" onclick="STATE.completedOrder=null;closeCartModal();">Tiếp tục mua sắm</button>' +
            '</div>' +
          '</div>';
        return;
      }
      if (!STATE.cart.length) {
        box.innerHTML = '<button type="button" class="modal-close" onclick="closeCartModal()">✕</button>' +
          '<h3 style="font-size:17px;font-weight:800;margin-bottom:10px;">Giỏ hàng trực tuyến</h3>' +
          '<p style="padding:28px 0;text-align:center;color:#6b6661;">Giỏ hàng đang trống — hãy chọn sản phẩm lẻ hoặc sỉ để đặt mua.</p>';
        return;
      }
      var totalQty = STATE.cart.reduce(function(s, i) { return s + i.quantity; }, 0);
      var wsAllowed = !(STATE.data.config && STATE.data.config.wholesaleEnabled === false);
      var tiers = wsAllowed ? ((STATE.data.config && STATE.data.config.wholesaleTiers) || []).slice().sort(function(a, b) { return b.minQty - a.minQty; }) : [];
      var activeTier = wsAllowed ? (tiers.find(function(t) { return totalQty >= t.minQty; }) || null) : null;
      var retailSub = STATE.cart.reduce(function(s, i) { return s + i.product.retailPrice * i.quantity; }, 0);
      var effSub = STATE.cart.reduce(function(s, i) {
        var u = activeTier ? calcWsPrice(i.product.retailPrice, activeTier.discountPercent) : i.product.retailPrice;
        return s + u * i.quantity;
      }, 0);
      var saved = Math.max(0, retailSub - effSub);
      var freeShip = (STATE.data.config && STATE.data.config.freeShipThreshold) || 500000;
      var shipFee = effSub >= freeShip ? 0 : ((STATE.data.config && STATE.data.config.baseShippingFee) || 30000);
      var grand = effSub + shipFee;
      var pm = STATE.paymentMethod || 'COD';
      var shortTag = (STATE.data.brand && STATE.data.brand.brandShortName) || 'BM';
      var previewQr = (pm === 'BANK_TRANSFER' && bank) ? buildVietQrUrl(bank, grand, shortTag + ' WEB DONHANG') : '';

      box.innerHTML = '<button type="button" class="modal-close" onclick="closeCartModal()">✕</button>' +
        '<h3 style="font-size:18px;font-weight:800;margin-bottom:4px;">Giỏ hàng &amp; Đặt mua Trực tuyến</h3>' +
        '<p style="font-size:12px;color:#6b6661;margin-bottom:12px;">' + (wsAllowed ? 'Tự động tính chiết khấu Giá Sỉ khi tổng số lượng đạt mốc sỉ xưởng.' : 'Kiểm tra danh sách sản phẩm và thông tin nhận hàng.') + '</p>' +
        (activeTier ? '<div class="alert-ok">Đã kích hoạt <strong>' + esc(activeTier.label) + '</strong> — Tiết kiệm ngay <strong>' + fmtVND(saved) + '</strong>!</div>' : '') +
        '<div style="max-height:200px;overflow-y:auto;margin-bottom:14px;display:grid;gap:8px;">' +
          STATE.cart.map(function(i) {
            var u = activeTier ? calcWsPrice(i.product.retailPrice, activeTier.discountPercent) : i.product.retailPrice;
            return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #e7e2da;border-radius:10px;padding:8px 10px;font-size:12.5px;">' +
              '<div style="min-width:0;flex:1;padding-right:8px;"><strong>' + esc(i.product.cleanTitle) + '</strong><div style="color:#6b6661">' + fmtVND(u) + ' / ' + esc(i.product.unit) + (i.product.variantLabel ? ' · ' + esc(i.product.variantLabel) : '') + '</div></div>' +
              '<div style="display:flex;align-items:center;gap:6px;">' +
                '<button type="button" class="btn-sm-out" style="width:28px;min-height:28px;" onclick="updateCartQty(\\'' + jsAttr(i.product.id) + '\\',-1)">−</button>' +
                '<strong>' + i.quantity + '</strong>' +
                '<button type="button" class="btn-sm-out" style="width:28px;min-height:28px;" onclick="updateCartQty(\\'' + jsAttr(i.product.id) + '\\',1)">+</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<form onsubmit="submitOrderForm(event)" class="form-grid">' +
          '<div class="field"><label>Họ và tên người nhận *</label><input id="ordName" required placeholder="Nguyễn Minh Trân" /></div>' +
          '<div class="field"><label>Số điện thoại *</label><input id="ordPhone" required placeholder="0909..." /></div>' +
          '<div class="field full"><label>Địa chỉ giao hàng chi tiết *</label><input id="ordAddr" required placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..." /></div>' +
          '<div class="field full"><label>Ghi chú đơn hàng</label><input id="ordNote" placeholder="Gói quà, xuất hóa đơn, giờ giao..." /></div>' +
          '<div class="field full" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
            '<button type="button" class="btn-sm-out" style="' + (pm === 'COD' ? 'border-color:#0066cc;background:#eff6ff;color:#0066cc;font-weight:750;' : '') + '" onclick="setPaymentMethod(\\'COD\\')">Thanh toán khi nhận (COD)</button>' +
            '<button type="button" class="btn-sm-out" style="' + (pm === 'BANK_TRANSFER' ? 'border-color:#0066cc;background:#eff6ff;color:#0066cc;font-weight:750;' : '') + '" onclick="setPaymentMethod(\\'BANK_TRANSFER\\')">Chuyển khoản Ngân hàng</button>' +
          '</div>' +
          (pm === 'BANK_TRANSFER' && bank
            ? '<div class="field full" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:10px;font-size:12px;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;"><strong>Thông tin chuyển khoản &amp; VietQR:</strong><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:28px;" onclick="copyTxt(\\'' + jsAttr(bank.bankAccount) + '\\',\\'số tài khoản\\')">Copy STK</button></div>' +
                '<div style="margin-top:4px;">' + esc(bank.bankName) + ' · STK: <strong>' + esc(bank.bankAccount) + '</strong>' + (bank.bankHolder ? ' (' + esc(bank.bankHolder) + ')' : '') + '</div>' +
                (previewQr ? '<div style="text-align:center;margin-top:8px;"><img src="' + esc(previewQr) + '" alt="VietQR" style="max-height:185px;border-radius:8px;border:1px solid #dbeafe;padding:5px;background:#fff;" onerror="this.style.display=\\'none\\'" /><div style="font-size:11px;color:#6b6661;margin-top:4px;">Mã QR kèm đúng mã đơn BM-WEB-... cũng sẽ hiển thị ngay sau khi bấm Đặt mua</div></div>' : '') +
              '</div>'
            : '') +
          '<div class="field full" style="background:#f5f2ec;border-radius:11px;padding:11px;font-size:12.5px;">' +
            '<div style="display:flex;justify-content:space-between;"><span>Tạm tính (' + totalQty + ' SP):</span><strong>' + fmtVND(effSub) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;"><span>Phí vận chuyển:</span><strong>' + (shipFee === 0 ? 'Miễn phí' : fmtVND(shipFee)) + '</strong></div>' +
            '<div style="display:flex;justify-content:space-between;font-size:15px;margin-top:5px;padding-top:5px;border-top:1px solid #ddd;"><strong>Tổng thanh toán:</strong><strong style="color:#0066cc">' + fmtVND(grand) + '</strong></div>' +
          '</div>' +
          '<div class="field full"><button type="submit" class="cart-btn" style="width:100%;justify-content:center;min-height:44px;" id="ordSubmitBtn">Đặt mua ngay · ' + fmtVND(grand) + '</button></div>' +
        '</form>';
    }

    async function submitOrderForm(ev) {
      ev.preventDefault();
      var btn = document.getElementById('ordSubmitBtn');
      btn.disabled = true; btn.textContent = 'Đang gửi đơn hàng...';
      try {
        var res = await fetch(apiEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SUBMIT_WEB_ORDER',
            customerName: document.getElementById('ordName').value,
            customerPhone: document.getElementById('ordPhone').value,
            address: document.getElementById('ordAddr').value,
            note: document.getElementById('ordNote').value,
            paymentMethod: STATE.paymentMethod || 'COD',
            items: STATE.cart.map(function(i) { return { productId: i.product.id, sku: i.product.sku, quantity: i.quantity }; })
          })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Không thể gửi đơn');
        var ordPhoneVal = document.getElementById('ordPhone').value;
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
        showToast(e.message || 'Không thể kết nối máy chủ đặt hàng.');
        btn.disabled = false; btn.textContent = 'Thử lại đặt mua';
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
      } catch (e) {
        showToast(e.message || 'Vui lòng thử lại hoặc nhắn Zalo trực tiếp.');
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
        showToast(e.message || 'Không thể gửi tin nhắn lúc này.');
      } finally {
        btn.disabled = false; btn.textContent = 'Gửi Liên Hệ Tới Cửa Hàng';
      }
    }

    async function submitLookup(ev) {
      ev.preventDefault();
      var out = document.getElementById('lkOutput');
      out.innerHTML = '<p style="font-size:12.5px;color:#6b6661">Đang kiểm tra...</p>';
      try {
        var code = encodeURIComponent(document.getElementById('lkCode').value.trim());
        var phone = encodeURIComponent(document.getElementById('lkPhone').value.trim());
        var res = await fetch(apiEndpoint() + '?lookupCode=' + code + '&phone=' + phone, { cache: 'no-store' });
        var json = await res.json();
        if (!res.ok || !json.ok) {
          out.innerHTML = '<div style="color:#b91c1c;font-size:12.5px;padding:10px;border:1px solid #fecaca;border-radius:10px;background:#fef2f2;">' + esc(json.error || 'Không tìm thấy đơn hàng.') + '</div>';
          return;
        }
        var shipTxt = (json.shipment && json.shipment.trackingCode)
          ? '<br/>Vận chuyển: <strong>' + esc(json.shipment.carrier || 'ĐVVC') + '</strong> · Mã vận đơn: <strong style="font-family:monospace;">' + esc(json.shipment.trackingCode) + '</strong>'
          : '';
        var tierTxt = json.tierApplied ? '<br/>Mức chiết khấu sỉ: ' + esc(json.tierApplied) : '';
        out.innerHTML = '<div class="alert-ok"><strong>Mã: ' + esc(json.code) + '</strong>' +
          (json.title ? '<br/>' + esc(json.title) : '') +
          '<br/>Trạng thái: <strong>' + esc(formatLookupStatus(json.status)) + '</strong>' +
          (typeof json.total === 'number' ? '<br/>Tổng cộng: <strong>' + fmtVND(json.total) + '</strong>' : '') +
          tierTxt +
          shipTxt +
          '</div>';
      } catch (e) {
        out.innerHTML = '<p style="color:#b91c1c;font-size:12.5px;">Không thể kết nối máy chủ tra cứu lúc này.</p>';
      }
    }

    function applyLiveStorefrontData(live) {
      if (!live || !live.ok || !Array.isArray(live.products)) return;
      STATE.data = live;
      if (live.brand) {
        if (live.brand.brandName) {
          document.getElementById('brandNameHdr').textContent = live.brand.brandName;
          document.getElementById('footerBrand').textContent = live.brand.brandName;
          document.title = live.brand.brandName + ' — Sản phẩm Thủ công, Bảng Giá Sỉ & Liên hệ Chính thức';
        }
        if (live.brand.workshopName) {
          document.getElementById('footerWorkshop').textContent = live.brand.workshopName;
        }
      }
      if (live.config) {
        if (live.config.announcementBar) document.getElementById('announcementBar').textContent = live.config.announcementBar;
        if (live.config.heroBadge) {
          document.getElementById('heroBadge').textContent = '✨ ' + live.config.heroBadge;
          var subHdr = document.getElementById('brandSubHdr');
          var liveSub = (live.brand && live.brand.brandSubtitle) ? String(live.brand.brandSubtitle).trim() : '';
          if (subHdr) {
            subHdr.textContent = (liveSub && liveSub !== 'Quản lý bán hàng đa kênh')
              ? liveSub
              : live.config.heroBadge;
          }
        }
        if (live.config.heroTitle) document.getElementById('heroTitle').textContent = live.config.heroTitle;
        if (live.config.heroSubtitle) document.getElementById('heroSubtitle').textContent = live.config.heroSubtitle;
        if (live.config.wholesalePolicyNote) document.getElementById('wsPolicyText').textContent = live.config.wholesalePolicyNote;
        if (live.config.oemCustomNote) document.getElementById('oemNoteText').textContent = live.config.oemCustomNote;

        var wsOn = !live.storefrontClosed && live.config.wholesaleEnabled !== false;
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
        var wsBadgeEl = document.getElementById('wsNavBadge');
        if (wsBadgeEl) {
          wsBadgeEl.textContent = tList.length >= 2
            ? '(' + tList[0].badge + ' → ' + tList[tList.length - 1].badge + ')'
            : (tList.length === 1 ? '(' + tList[0].badge + ')' : '');
        }

        if (live.config.contact) {
          var spLink = document.getElementById('heroShopeeLink');
          var ftShopee = document.getElementById('footerShopee');
          var ftHot = document.getElementById('footerHotline');
          if (spLink) {
            spLink.href = live.config.contact.shopeeUrl || '#';
            spLink.classList.toggle('hidden', !live.config.contact.shopeeUrl);
          }
          if (ftShopee && live.config.contact.shopeeUrl) {
            ftShopee.href = live.config.contact.shopeeUrl;
            ftShopee.textContent = 'Shopee Chính hãng: ' + live.config.contact.shopeeUrl.replace('https://', '');
          }
          if (ftHot && live.config.contact.hotline) {
            ftHot.textContent = 'Hotline / Zalo: ' + live.config.contact.hotline;
          }
        }
      }
      reconcileCartFromStorage();
      renderShopeeBanners();
      renderCategoryPills();
      renderProducts();
      renderWholesaleSection();
      renderContactSection();
      if (document.getElementById('cartModal').classList.contains('open')) {
        renderCartModal();
      }
      tryOpenPendingDeepLinkSku();
    }

    // Khởi tạo tức thì 0ms từ dữ liệu bootstrap & đồng bộ ngầm từ CMS API riêng
    reconcileCartFromStorage();
    renderShopeeBanners();
    renderCategoryPills();
    renderProducts();
    renderWholesaleSection();
    renderContactSection();
    applyDeepLinkQuery();
    setInterval(function() {
      if (STATE.carouselPaused || STATE.tab !== 'PRODUCTS') return;
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

  console.log(`=== PUBLISH CUSTOM DOMAIN STOREFRONT ===`)
  console.log(`  CMS Instance ID : ${snapshot.cmsInstanceId}`)
  console.log(`  Brand           : ${snapshot.brand.brandName}`)
  console.log(`  Custom Domain   : https://${domain}`)
  console.log(`  CMS API Origin  : ${snapshot.config.cmsBackendOrigin}`)
  console.log(`  Active Products : ${snapshot.products.length} (0 costPrice exposed)`)
  console.log(`  Target Repo     : ${targetRepo}`)

  const stageDir = path.resolve('.beta_stage', `storefront-${domain.replace(/[^a-z0-9.-]/g, '-')}`)
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
