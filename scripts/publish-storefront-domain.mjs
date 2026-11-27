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
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

async function buildCmsStorefrontSnapshot() {
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

  let shopeeUsername = 'bomocdecor'
  try {
    const sObj = JSON.parse(shopeeCred?.config || '{}')
    if (sObj?.__vault_v1?.username) shopeeUsername = String(sObj.__vault_v1.username)
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

  const webChannelId = webChannel?.id || ''
  const products = rawProducts
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
      const wholesalePrices = wholesaleTiers.map((t) => ({
        tierId: t.id,
        minQty: t.minQty,
        label: t.label,
        badge: t.badge,
        discountPercent: t.discountPercent,
        unitPrice: computeWholesaleUnitPrice(retailPrice, t.discountPercent),
      }))

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
        availableToOrder: true,
        stockLabel:
          prod.stock > 0
            ? `Sẵn hàng (${prod.stock} ${prod.unit || 'bộ'})`
            : 'Chế tác thủ công tại xưởng (Giao 1–2 ngày)',
        shopeeUrl: shopeeItemId
          ? `https://shopee.vn/product/197195817/${shopeeItemId}`
          : contact.shopeeUrl,
      }
    })

  return {
    ok: true,
    cmsInstanceId,
    generatedAt: new Date().toISOString(),
    brand: {
      brandName,
      brandShortName: settings.brand_short_name || 'BƠ MỘC',
      brandBadge: settings.brand_badge || 'CRAFT',
      brandSubtitle:
        settings.brand_subtitle || 'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công',
      footerTagline:
        settings.brand_footer_tagline ||
        'Xưởng Đúc Thạch Cao Thủ Công & Nến Bơ Thực Vật Thuần Chay · Sỉ & Lẻ Toàn Quốc',
      workshopName: settings.shop_default_workshop || 'Xưởng Đúc Thủ Công Bơ Mộc',
      companyName: settings.company_name || brandName,
    },
    config: {
      enabled: true,
      customDomain,
      additionalDomains: [`www.${customDomain}`],
      cmsBackendOrigin,
      heroBadge:
        savedSf.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc',
      heroTitle:
        savedSf.heroTitle ||
        'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công Tinh Tế',
      heroSubtitle:
        savedSf.heroSubtitle ||
        'Chế tác tỉ mỉ từng khay, hũ nến thạch cao kháng dầu chịu nhiệt và nến bơ thực vật thuần chay không khói cho góc thiền, bàn trà, spa & quà tặng doanh nghiệp.',
      announcementBar:
        savedSf.announcementBar ||
        'Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000 ₫ · Chiết khấu Giá Sỉ tận xưởng từ 10 sản phẩm (-15% đến -35%)',
      wholesaleEnabled: savedSf.wholesaleEnabled !== false,
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
      allowPreorderWhenOutOfStock: true,
      contact,
    },
    bankTransfer: null,
    categories,
    products,
    articles: [],
  }
}

function generateStandaloneStorefrontHtml(snapshot) {
  const brandName = escapeHtml(snapshot.brand.brandName)
  const domain = escapeHtml(snapshot.config.customDomain)
  const heroTitle = escapeHtml(snapshot.config.heroTitle)
  const heroSub = escapeHtml(snapshot.config.heroSubtitle)
  const firstImage = escapeHtml(snapshot.products[0]?.image || '')
  const jsonBootstrap = JSON.stringify(snapshot).replace(/<\//g, '<\\/')

  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Store',
    name: snapshot.brand.brandName,
    url: `https://${snapshot.config.customDomain}/`,
    description: snapshot.config.heroSubtitle,
    telephone: snapshot.config.contact.hotline,
    email: snapshot.config.contact.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: snapshot.config.contact.address,
      addressCountry: 'VN',
    },
  }).replace(/<\//g, '<\\/')

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${brandName} — Sản phẩm Thủ công, Bảng Giá Sỉ &amp; Liên hệ Chính thức (${domain})</title>
  <meta name="description" content="${heroSub}" />
  <link rel="canonical" href="https://${domain}/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${brandName} — ${heroTitle}" />
  <meta property="og:description" content="${heroSub}" />
  <meta property="og:url" content="https://${domain}/" />
  ${firstImage ? `<meta property="og:image" content="${firstImage}" />` : ''}
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
      position: sticky;
      top: 0;
      z-index: 40;
      background: rgba(255, 255, 255, 0.94);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--line);
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
  </style>
</head>
<body>
  <div class="topbar" id="announcementBar">${escapeHtml(snapshot.config.announcementBar)}</div>

  <header>
    <div class="container nav-wrap">
      <div class="brand-box" onclick="switchTab('PRODUCTS')">
        <div class="brand-logo">BM</div>
        <div>
          <div class="brand-title">
            <span id="brandNameHdr">${brandName}</span>
            <span class="domain-pill" id="domainPill">${domain}</span>
          </div>
          <div class="brand-sub" id="brandSubHdr">${escapeHtml(snapshot.brand.brandSubtitle)}</div>
        </div>
      </div>

      <nav class="nav-tabs" aria-label="Điều hướng chính">
        <button type="button" class="tab-btn active" id="tab-PRODUCTS" onclick="switchTab('PRODUCTS')">
          Sản phẩm (<span id="prodCountNav">${snapshot.products.length}</span>)
        </button>
        <button type="button" class="tab-btn wholesale" id="tab-WHOLESALE" onclick="switchTab('WHOLESALE')">
          Bảng Giá Sỉ (-15% → -35%)
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
          <button type="button" class="btn-ws" onclick="switchTab('WHOLESALE')">
            Bảng Giá Sỉ Đại Lý &amp; Quà Tặng OEM
          </button>
          <a id="heroShopeeLink" href="${escapeHtml(snapshot.config.contact.shopeeUrl)}" target="_blank" rel="noopener noreferrer" class="btn-outline">
            Gian hàng Shopee ↗
          </a>
        </div>
      </div>

      <div class="trust-stack">
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
      <div class="toolbar">
        <div class="toolbar-row">
          <input type="search" id="searchInput" class="search-input" placeholder="Tìm sản phẩm (nến bơ, hoa sen, búp sen, khay oval...) hoặc mã SKU..." oninput="renderProducts()" />
          <div style="display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
            <div class="mode-switch">
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
        <p><a href="#wholesale" onclick="switchTab('WHOLESALE'); return false;">• Bảng giá sỉ tận xưởng (10+ / 30+ / 100+ SP)</a></p>
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
      cart: [],
      completedOrder: null
    };

    function fmtVND(n) {
      return Math.round(Number(n) || 0).toLocaleString('vi-VN') + ' ₫';
    }
    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

    function renderProducts() {
      var q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
      var sort = document.getElementById('sortSelect').value;
      var list = (STATE.data.products || []).filter(function(p) {
        if (!q) return true;
        return p.name.toLowerCase().indexOf(q) >= 0 || p.sku.toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0;
      });
      if (sort === 'PRICE_ASC') list.sort(function(a, b) { return a.retailPrice - b.retailPrice; });
      if (sort === 'PRICE_DESC') list.sort(function(a, b) { return b.retailPrice - a.retailPrice; });

      document.getElementById('prodCountNav').textContent = String((STATE.data.products || []).length);
      var grid = document.getElementById('productGrid');
      if (!list.length) {
        grid.innerHTML = '<div class="panel" style="grid-column:1/-1;text-align:center;padding:40px;">Không tìm thấy sản phẩm phù hợp với từ khóa.</div>';
        return;
      }
      grid.innerHTML = list.map(function(p) {
        var wsList = p.wholesalePrices || [];
        var firstWs = wsList[0];
        var bestWs = wsList[wsList.length - 1];
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
          '<div class="prod-img-wrap" onclick="openProdModal(\\'' + esc(p.id) + '\\')">' +
            (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.name) + '" loading="lazy" />' : '') +
            (p.variantLabel ? '<span class="badge-var">' + esc(p.variantLabel) + '</span>' : '') +
            (bestWs ? '<span class="badge-ws">Sỉ từ ' + fmtVND(bestWs.unitPrice) + '</span>' : '') +
          '</div>' +
          '<div class="prod-body">' +
            '<div>' +
              '<div class="sku-line"><span class="sku-code">' + esc(p.sku) + '</span><span class="stock-ok">Sẵn sàng đặt</span></div>' +
              '<h3 class="prod-title" onclick="openProdModal(\\'' + esc(p.id) + '\\')">' + esc(p.cleanTitle) + '</h3>' +
              (p.variantLabel ? '<div class="prod-var-txt">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') +
            '</div>' +
            '<div class="price-area">' +
              priceHtml +
              '<div class="card-actions">' +
                '<button type="button" class="btn-sm-out" onclick="openProdModal(\\'' + esc(p.id) + '\\')">Chi tiết</button>' +
                '<button type="button" class="btn-sm-buy" onclick="addToCart(\\'' + esc(p.id) + '\\',' + addQty + ')">+ ' + (addQty > 1 ? 'Thêm ' + addQty + ' SP' : 'Chọn mua') + '</button>' +
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
        return '<tr>' +
          '<td><div class="sku-code" style="font-size:10.5px;color:#6b6661">' + esc(p.sku) + '</div><strong>' + esc(p.cleanTitle) + '</strong>' +
          (p.variantLabel ? '<div style="font-size:11.5px;color:#7c4619">Phân loại: ' + esc(p.variantLabel) + '</div>' : '') + '</td>' +
          '<td class="num" style="color:#6b6661">' + fmtVND(p.retailPrice) + '</td>' +
          tiers.map(function(t) {
            return '<td class="num"><strong>' + fmtVND(calcWsPrice(p.retailPrice, t.discountPercent)) + '</strong></td>';
          }).join('') +
          '<td style="text-align:center"><button type="button" class="btn-sm-out" style="padding:0 10px;min-height:30px;" onclick="addToCart(\\'' + esc(p.id) + '\\',10)">+10</button></td>' +
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
      var wsHtml = (p.wholesalePrices || []).map(function(w) {
        return '<div class="ws-mini-row"><span>Từ ' + w.minQty + ' ' + esc(p.unit) + ' (' + esc(w.badge) + '):</span><strong>' + fmtVND(w.unitPrice) + ' / ' + esc(p.unit) + '</strong></div>';
      }).join('');
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
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">' +
                '<button type="button" class="btn-primary" onclick="addToCart(\\'' + esc(p.id) + '\\',1);closeProdModal();">Mua lẻ (+1)</button>' +
                '<button type="button" class="btn-ws" onclick="addToCart(\\'' + esc(p.id) + '\\',10);closeProdModal();openCartModal();">Nhập sỉ (+10)</button>' +
              '</div>' +
              (p.shopeeUrl ? '<a href="' + esc(p.shopeeUrl) + '" target="_blank" rel="noopener" class="btn-outline" style="justify-content:center;">Xem sản phẩm trên Shopee ↗</a>' : '') +
            '</div>' +
          '</div>' +
        '</div>';
      document.getElementById('prodModal').classList.add('open');
    }
    function closeProdModal() { document.getElementById('prodModal').classList.remove('open'); }

    function addToCart(prodId, qty) {
      var p = (STATE.data.products || []).find(function(x) { return x.id === prodId; });
      if (!p) return;
      STATE.completedOrder = null;
      var hit = STATE.cart.find(function(i) { return i.product.id === prodId; });
      if (hit) hit.quantity += qty;
      else STATE.cart.push({ product: p, quantity: qty });
      updateCartBadge();
      showToast('Đã thêm ' + qty + ' ' + p.unit + ' "' + p.cleanTitle + '" vào giỏ hàng');
    }
    function updateCartQty(prodId, delta) {
      STATE.cart = STATE.cart.map(function(i) {
        return i.product.id === prodId ? { product: i.product, quantity: i.quantity + delta } : i;
      }).filter(function(i) { return i.quantity > 0; });
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
      if (STATE.completedOrder) {
        box.innerHTML = '<button type="button" class="modal-close" onclick="closeCartModal()">✕</button>' +
          '<div class="alert-ok" style="text-align:center;padding:24px;">' +
            '<h3 style="font-size:18px;margin-bottom:6px;">🎉 Đặt hàng thành công!</h3>' +
            '<p>Mã đơn hàng của bạn: <strong style="font-family:monospace;font-size:15px;">' + esc(STATE.completedOrder.refCode) + '</strong></p>' +
            '<p style="margin-top:6px;">Tổng thanh toán: <strong>' + fmtVND(STATE.completedOrder.grandTotal) + '</strong></p>' +
            '<button type="button" class="btn-primary" style="margin-top:14px;" onclick="STATE.completedOrder=null;closeCartModal();">Tiếp tục mua sắm</button>' +
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
      var tiers = ((STATE.data.config && STATE.data.config.wholesaleTiers) || []).slice().sort(function(a, b) { return b.minQty - a.minQty; });
      var activeTier = tiers.find(function(t) { return totalQty >= t.minQty; }) || null;
      var retailSub = STATE.cart.reduce(function(s, i) { return s + i.product.retailPrice * i.quantity; }, 0);
      var effSub = STATE.cart.reduce(function(s, i) {
        var u = activeTier ? calcWsPrice(i.product.retailPrice, activeTier.discountPercent) : i.product.retailPrice;
        return s + u * i.quantity;
      }, 0);
      var saved = Math.max(0, retailSub - effSub);
      var freeShip = (STATE.data.config && STATE.data.config.freeShipThreshold) || 500000;
      var shipFee = effSub >= freeShip ? 0 : ((STATE.data.config && STATE.data.config.baseShippingFee) || 30000);
      var grand = effSub + shipFee;

      box.innerHTML = '<button type="button" class="modal-close" onclick="closeCartModal()">✕</button>' +
        '<h3 style="font-size:18px;font-weight:800;margin-bottom:4px;">Giỏ hàng &amp; Đặt mua Trực tuyến</h3>' +
        '<p style="font-size:12px;color:#6b6661;margin-bottom:12px;">Tự động tính chiết khấu Giá Sỉ khi tổng số lượng từ 10 sản phẩm trở lên.</p>' +
        (activeTier ? '<div class="alert-ok">Đã kích hoạt <strong>' + esc(activeTier.label) + '</strong> — Tiết kiệm ngay <strong>' + fmtVND(saved) + '</strong>!</div>' : '') +
        '<div style="max-height:200px;overflow-y:auto;margin-bottom:14px;display:grid;gap:8px;">' +
          STATE.cart.map(function(i) {
            var u = activeTier ? calcWsPrice(i.product.retailPrice, activeTier.discountPercent) : i.product.retailPrice;
            return '<div style="display:flex;justify-content:space-between;align-items:center;border:1px solid #e7e2da;border-radius:10px;padding:8px 10px;font-size:12.5px;">' +
              '<div style="min-width:0;flex:1;padding-right:8px;"><strong>' + esc(i.product.cleanTitle) + '</strong><div style="color:#6b6661">' + fmtVND(u) + ' / ' + esc(i.product.unit) + (i.product.variantLabel ? ' · ' + esc(i.product.variantLabel) : '') + '</div></div>' +
              '<div style="display:flex;align-items:center;gap:6px;">' +
                '<button type="button" class="btn-sm-out" style="width:28px;min-height:28px;" onclick="updateCartQty(\\'' + esc(i.product.id) + '\\',-1)">−</button>' +
                '<strong>' + i.quantity + '</strong>' +
                '<button type="button" class="btn-sm-out" style="width:28px;min-height:28px;" onclick="updateCartQty(\\'' + esc(i.product.id) + '\\',1)">+</button>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<form onsubmit="submitOrderForm(event)" class="form-grid">' +
          '<div class="field"><label>Họ và tên người nhận *</label><input id="ordName" required placeholder="Nguyễn Minh Trân" /></div>' +
          '<div class="field"><label>Số điện thoại *</label><input id="ordPhone" required placeholder="0909..." /></div>' +
          '<div class="field full"><label>Địa chỉ giao hàng chi tiết *</label><input id="ordAddr" required placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..." /></div>' +
          '<div class="field full"><label>Ghi chú đơn hàng</label><input id="ordNote" placeholder="Gói quà, xuất hóa đơn, giờ giao..." /></div>' +
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
            paymentMethod: 'COD',
            items: STATE.cart.map(function(i) { return { productId: i.product.id, sku: i.product.sku, quantity: i.quantity }; })
          })
        });
        var json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || 'Không thể gửi đơn');
        STATE.completedOrder = { refCode: json.refCode, grandTotal: json.grandTotal };
        STATE.cart = [];
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
        out.innerHTML = '<div class="alert-ok"><strong>Mã: ' + esc(json.code) + '</strong><br/>Trạng thái: ' + esc(json.status) +
          (typeof json.total === 'number' ? '<br/>Tổng cộng: <strong>' + fmtVND(json.total) + '</strong>' : '') + '</div>';
      } catch (e) {
        out.innerHTML = '<p style="color:#b91c1c;font-size:12.5px;">Không thể kết nối máy chủ tra cứu lúc này.</p>';
      }
    }

    function applyLiveStorefrontData(live) {
      if (!live || !live.ok || !Array.isArray(live.products)) return;
      STATE.data = live;
      if (live.brand && live.brand.brandName) {
        document.getElementById('brandNameHdr').textContent = live.brand.brandName;
        document.getElementById('footerBrand').textContent = live.brand.brandName;
      }
      if (live.config) {
        if (live.config.announcementBar) document.getElementById('announcementBar').textContent = live.config.announcementBar;
        if (live.config.heroTitle) document.getElementById('heroTitle').textContent = live.config.heroTitle;
        if (live.config.heroSubtitle) document.getElementById('heroSubtitle').textContent = live.config.heroSubtitle;
      }
      renderProducts();
      renderWholesaleSection();
      renderContactSection();
    }

    // Khởi tạo tức thì 0ms từ dữ liệu bootstrap & đồng bộ ngầm từ CMS API riêng
    renderProducts();
    renderWholesaleSection();
    renderContactSection();
    fetch(apiEndpoint(), { cache: 'no-store' })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(d) { if (d) applyLiveStorefrontData(d); })
      .catch(function() {});
  </script>
</body>
</html>
`
}

async function main() {
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
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://${domain}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n</urlset>\n`,
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

main().catch(async (err) => {
  console.error(err)
  await prisma.$disconnect().catch(() => null)
  process.exit(1)
})
