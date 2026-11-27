import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { normalizeDomainHostname } from '@/lib/domain-routing'
import { broadcast, invalidateApiCache } from '@/lib/realtime'
import { getSettings } from '@/lib/settings'
import { extractShopProfileFromSettings } from '@/lib/shop-profile'
import { mergePreservingInternalVaultFields } from '@/lib/shopee-session-vault'

export interface WholesaleTierConfig {
  id: string
  minQty: number
  discountPercent: number
  label: string
  badge: string
  description: string
}

export interface StorefrontContactConfig {
  hotline: string
  zaloPhone: string
  zaloUrl: string
  email: string
  address: string
  workingHours: string
  shopeeUrl: string
  facebookUrl: string
  tiktokUrl: string
}

export interface StorefrontCmsConfig {
  enabled: boolean
  customDomain: string
  additionalDomains: string[]
  domainRoutingMode: 'STOREFRONT_ON_CUSTOM_DOMAIN' | 'MANUAL_STORE_PATH'
  cmsBackendOrigin: string
  heroBadge: string
  heroTitle: string
  heroSubtitle: string
  announcementBar: string
  wholesaleEnabled: boolean
  wholesaleTiers: WholesaleTierConfig[]
  wholesalePolicyNote: string
  oemCustomNote: string
  freeShipThreshold: number
  baseShippingFee: number
  returnDays: number
  allowPreorderWhenOutOfStock: boolean
  contact: StorefrontContactConfig
  updatedAt: string | null
}

export const DEFAULT_WHOLESALE_TIERS: WholesaleTierConfig[] = [
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
    description: 'Giá xuất xưởng tốt nhất · Hỗ trợ phối màu riêng, khắc/in logo hộp quà doanh nghiệp (OEM).',
  },
]

export const DEFAULT_STOREFRONT_CONFIG: StorefrontCmsConfig = {
  enabled: true,
  customDomain: 'bomocdecor.vn',
  additionalDomains: ['www.bomocdecor.vn'],
  domainRoutingMode: 'STOREFRONT_ON_CUSTOM_DOMAIN',
  cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
  heroBadge: 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc',
  heroTitle: 'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công Tinh Tế',
  heroSubtitle:
    'Chế tác tỉ mỉ từng khay, hũ nến thạch cao kháng dầu chịu nhiệt và nến bơ thực vật thuần chay không khói cho góc thiền, bàn trà, spa & quà tặng doanh nghiệp.',
  announcementBar:
    'Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000 ₫ · Chiết khấu Giá Sỉ tận xưởng từ 10 sản phẩm (-15% đến -35%)',
  wholesaleEnabled: true,
  wholesaleTiers: DEFAULT_WHOLESALE_TIERS,
  wholesalePolicyNote:
    'Được gộp tự do nhiều mẫu/phân loại trong cùng đơn sỉ để đạt mốc số lượng 10 · 30 · 100 sản phẩm. Xuất hóa đơn chứng từ đầy đủ, đóng gói chống sốc chuyên dụng bảo hành bể vỡ 1 đổi 1.',
  oemCustomNote:
    'Nhận gia công OEM theo màu sắc riêng, đổ nến bơ/sáp đậu nành theo mùi hương yêu cầu & thiết kế hộp quà tặng sự kiện, lễ Tết cho doanh nghiệp, spa, thiền viện.',
  freeShipThreshold: 500_000,
  baseShippingFee: 30_000,
  returnDays: 7,
  allowPreorderWhenOutOfStock: true,
  contact: {
    hotline: '0909 686 868',
    zaloPhone: '0909686868',
    zaloUrl: 'https://zalo.me/0909686868',
    email: 'lienhe@bomocdecor.vn',
    address: 'Xưởng Đúc Thủ Công & Showroom Bơ Mộc Decor — TP. Hồ Chí Minh',
    workingHours: '08:30 – 21:00 (Thứ 2 – Chủ Nhật)',
    shopeeUrl: 'https://shopee.vn/bomocdecor',
    facebookUrl: 'https://facebook.com/bomocdecor',
    tiktokUrl: 'https://tiktok.com/@bomocdecor',
  },
  updatedAt: null,
}

/**
 * Tính đơn giá sỉ theo số nguyên (basis points) để tránh sai số dấu phẩy động IEEE-754.
 */
export function computeWholesaleUnitPrice(retailPrice: number, discountPercent: number): number {
  const cleanRetail = Math.max(0, Math.round(Number(retailPrice) || 0))
  const clampedPct = Math.min(90, Math.max(0, Number(discountPercent) || 0))
  const keepBps = 10_000 - Math.round(clampedPct * 100)
  return Math.floor((cleanRetail * keepBps + 5_000) / 10_000)
}

export function resolveActiveWholesaleTier(
  totalQty: number,
  tiers: WholesaleTierConfig[],
  wholesaleEnabled = true
): WholesaleTierConfig | null {
  if (!wholesaleEnabled || !Array.isArray(tiers) || tiers.length === 0) return null
  const qty = Math.max(0, Math.floor(Number(totalQty) || 0))
  const sorted = [...tiers]
    .filter((t) => t.minQty > 0 && t.discountPercent > 0)
    .sort((a, b) => b.minQty - a.minQty)
  return sorted.find((t) => qty >= t.minQty) ?? null
}

function sanitizeTiers(raw: unknown): WholesaleTierConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_WHOLESALE_TIERS
  const cleaned: WholesaleTierConfig[] = []
  for (let i = 0; i < Math.min(6, raw.length); i++) {
    const item = raw[i]
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const minQty = Math.max(2, Math.min(100_000, Math.floor(Number(rec.minQty) || 0)))
    const discountPercent = Math.max(1, Math.min(85, Math.round((Number(rec.discountPercent) || 0) * 10) / 10))
    if (!minQty || !discountPercent) continue
    cleaned.push({
      id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 32) : `tier_${minQty}`,
      minQty,
      discountPercent,
      label:
        typeof rec.label === 'string' && rec.label.trim()
          ? rec.label.trim().slice(0, 80)
          : `Sỉ từ ${minQty} SP`,
      badge:
        typeof rec.badge === 'string' && rec.badge.trim()
          ? rec.badge.trim().slice(0, 20)
          : `-${discountPercent}%`,
      description:
        typeof rec.description === 'string' && rec.description.trim()
          ? rec.description.trim().slice(0, 240)
          : `Áp dụng cho đơn gộp từ ${minQty} sản phẩm trở lên.`,
    })
  }
  if (cleaned.length === 0) return DEFAULT_WHOLESALE_TIERS
  return cleaned.sort((a, b) => a.minQty - b.minQty)
}

export function normalizeStorefrontCmsConfig(
  rawInput: Record<string, unknown> | null | undefined,
  fallbackOverrides?: Partial<StorefrontCmsConfig>
): StorefrontCmsConfig {
  const base: StorefrontCmsConfig = {
    ...DEFAULT_STOREFRONT_CONFIG,
    ...fallbackOverrides,
    contact: {
      ...DEFAULT_STOREFRONT_CONFIG.contact,
      ...(fallbackOverrides?.contact ?? {}),
    },
  }
  if (!rawInput || typeof rawInput !== 'object') return base

  const str = (val: unknown, fb: string, maxLen = 300): string => {
    if (typeof val === 'string') {
      const t = val.trim().slice(0, maxLen)
      return t.length > 0 ? t : fb
    }
    return fb
  }

  const strAllowEmpty = (val: unknown, fb: string, maxLen = 300): string => {
    if (typeof val === 'string') return val.trim().slice(0, maxLen)
    return fb
  }

  const rawDomain =
    typeof rawInput.customDomain === 'string'
      ? normalizeDomainHostname(rawInput.customDomain, { stripWww: true })
      : base.customDomain

  let additionalDomains = base.additionalDomains
  if (Array.isArray(rawInput.additionalDomains)) {
    additionalDomains = rawInput.additionalDomains
      .map((d) => normalizeDomainHostname(String(d || ''), { stripWww: false }))
      .filter(Boolean)
      .slice(0, 10)
  } else if (typeof rawInput.additionalDomains === 'string') {
    additionalDomains = rawInput.additionalDomains
      .split(/[,;\s]+/)
      .map((d) => normalizeDomainHostname(d, { stripWww: false }))
      .filter(Boolean)
      .slice(0, 10)
  }
  if (rawDomain && !additionalDomains.includes(`www.${rawDomain}`)) {
    additionalDomains = [`www.${rawDomain}`, ...additionalDomains.filter((d) => d !== rawDomain)]
  }

  const rawContact =
    rawInput.contact && typeof rawInput.contact === 'object'
      ? (rawInput.contact as Record<string, unknown>)
      : {}

  const rawBackend = strAllowEmpty(rawInput.cmsBackendOrigin, base.cmsBackendOrigin, 200).replace(
    /\/+$/,
    ''
  )

  return {
    enabled: rawInput.enabled === undefined ? base.enabled : Boolean(rawInput.enabled),
    customDomain: rawDomain,
    additionalDomains,
    domainRoutingMode:
      rawInput.domainRoutingMode === 'MANUAL_STORE_PATH'
        ? 'MANUAL_STORE_PATH'
        : 'STOREFRONT_ON_CUSTOM_DOMAIN',
    cmsBackendOrigin: rawBackend || base.cmsBackendOrigin,
    heroBadge: str(rawInput.heroBadge, base.heroBadge, 120),
    heroTitle: str(rawInput.heroTitle, base.heroTitle, 180),
    heroSubtitle: str(rawInput.heroSubtitle, base.heroSubtitle, 400),
    announcementBar: str(rawInput.announcementBar, base.announcementBar, 260),
    wholesaleEnabled:
      rawInput.wholesaleEnabled === undefined ? base.wholesaleEnabled : Boolean(rawInput.wholesaleEnabled),
    wholesaleTiers: sanitizeTiers(rawInput.wholesaleTiers),
    wholesalePolicyNote: str(rawInput.wholesalePolicyNote, base.wholesalePolicyNote, 500),
    oemCustomNote: str(rawInput.oemCustomNote, base.oemCustomNote, 500),
    freeShipThreshold: Math.max(
      0,
      Math.min(50_000_000, Math.round(Number(rawInput.freeShipThreshold ?? base.freeShipThreshold) || 0))
    ),
    baseShippingFee: Math.max(
      0,
      Math.min(1_000_000, Math.round(Number(rawInput.baseShippingFee ?? base.baseShippingFee) || 0))
    ),
    returnDays: Math.max(0, Math.min(90, Math.floor(Number(rawInput.returnDays ?? base.returnDays) || 7))),
    allowPreorderWhenOutOfStock:
      rawInput.allowPreorderWhenOutOfStock === undefined
        ? base.allowPreorderWhenOutOfStock
        : Boolean(rawInput.allowPreorderWhenOutOfStock),
    contact: {
      hotline: strAllowEmpty(rawContact.hotline, base.contact.hotline, 40),
      zaloPhone: strAllowEmpty(rawContact.zaloPhone, base.contact.zaloPhone, 40),
      zaloUrl: strAllowEmpty(rawContact.zaloUrl, base.contact.zaloUrl, 200),
      email: strAllowEmpty(rawContact.email, base.contact.email, 120),
      address: strAllowEmpty(rawContact.address, base.contact.address, 260),
      workingHours: strAllowEmpty(rawContact.workingHours, base.contact.workingHours, 120),
      shopeeUrl: strAllowEmpty(rawContact.shopeeUrl, base.contact.shopeeUrl, 240),
      facebookUrl: strAllowEmpty(rawContact.facebookUrl, base.contact.facebookUrl, 240),
      tiktokUrl: strAllowEmpty(rawContact.tiktokUrl, base.contact.tiktokUrl, 240),
    },
    updatedAt: typeof rawInput.updatedAt === 'string' ? rawInput.updatedAt : base.updatedAt,
  }
}

// Bộ đệm RAM nhẹ phục vụ Proxy định tuyến tên miền riêng (< 1ms)
let cachedDomainsMemory: {
  checkedAt: number
  customDomain: string
  additionalDomains: string[]
  routingMode: StorefrontCmsConfig['domainRoutingMode']
} | null = null

export function invalidateStorefrontDomainMemoryCache(): void {
  cachedDomainsMemory = null
}

export function getCachedStorefrontDomainsSnapshot() {
  return cachedDomainsMemory
}

/**
 * Đọc cấu hình Website Khách hàng & Tên miền Riêng độc lập của CMS hiện tại.
 * Bảo toàn tuyệt đối số lượng dòng chuẩn (0 tạo mới dòng AppSetting hay IntegrationCredential).
 */
export async function getStorefrontConfigForCurrentCms(): Promise<{
  cmsInstanceId: string
  brandProfile: ReturnType<typeof extractShopProfileFromSettings> & {
    companyName: string
    companyPhone: string
    companyAddress: string
    invoiceBankCode: string
    invoiceBankName: string
    invoiceBankAccount: string
    invoiceBankHolder: string
  }
  config: StorefrontCmsConfig
}> {
  const [websiteCred, shopeeCred, rawSettings] = await Promise.all([
    db.integrationCredential.findUnique({ where: { provider: 'WEBSITE' } }).catch(() => null),
    db.integrationCredential.findUnique({ where: { provider: 'SHOPEE' } }).catch(() => null),
    getSettings([
      'brand_name',
      'brand_short_name',
      'brand_badge',
      'brand_subtitle',
      'brand_footer_tagline',
      'shop_default_workshop',
      'shop_workshop_presets',
      'shop_default_warehouse_label',
      'shop_storefront_url',
      'company_name',
      'company_phone',
      'company_address',
      'invoice_bank_code',
      'invoice_bank_name',
      'invoice_bank_account',
      'invoice_bank_holder',
    ]).catch(() => ({} as Record<string, string>)),
  ])

  const shopProfile = extractShopProfileFromSettings(rawSettings)

  let parsedWebCfg: Record<string, unknown> = {}
  if (websiteCred?.config) {
    try {
      parsedWebCfg = JSON.parse(websiteCred.config) as Record<string, unknown>
    } catch {
      parsedWebCfg = {}
    }
  }

  let shopeeUsername = 'bomocdecor'
  if (shopeeCred?.config) {
    try {
      const sCfg = JSON.parse(shopeeCred.config) as {
        username?: string
        __vault_v1?: { username?: string }
      }
      if (sCfg.__vault_v1?.username) shopeeUsername = String(sCfg.__vault_v1.username)
      else if (sCfg.username && sCfg.username !== 'thaimy1605') shopeeUsername = String(sCfg.username)
    } catch {
      // ignore
    }
  }

  const inferredDomainFromStorefrontUrl = normalizeDomainHostname(shopProfile.storefrontUrl, {
    stripWww: true,
  })
  const inferredSiteUrlDomain = normalizeDomainHostname(
    typeof parsedWebCfg.siteUrl === 'string' ? parsedWebCfg.siteUrl : '',
    { stripWww: true }
  )

  const fallbackCustomDomain =
    inferredDomainFromStorefrontUrl ||
    (inferredSiteUrlDomain && inferredSiteUrlDomain !== 'uudam.vn'
      ? inferredSiteUrlDomain
      : DEFAULT_STOREFRONT_CONFIG.customDomain)

  const rawV1 =
    parsedWebCfg.__storefront_v1 && typeof parsedWebCfg.__storefront_v1 === 'object'
      ? (parsedWebCfg.__storefront_v1 as Record<string, unknown>)
      : parsedWebCfg.storefrontConfigV1 && typeof parsedWebCfg.storefrontConfigV1 === 'object'
        ? (parsedWebCfg.storefrontConfigV1 as Record<string, unknown>)
        : null

  const normalized = normalizeStorefrontCmsConfig(rawV1, {
    customDomain: fallbackCustomDomain,
    cmsBackendOrigin:
      process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL?.trim() ||
      process.env.RENDER_EXTERNAL_URL?.trim() ||
      DEFAULT_STOREFRONT_CONFIG.cmsBackendOrigin,
    contact: {
      ...DEFAULT_STOREFRONT_CONFIG.contact,
      hotline: rawSettings.company_phone?.trim() || DEFAULT_STOREFRONT_CONFIG.contact.hotline,
      address: rawSettings.company_address?.trim() || DEFAULT_STOREFRONT_CONFIG.contact.address,
      shopeeUrl: `https://shopee.vn/${shopeeUsername}`,
    },
  })

  const instanceSeed = `${websiteCred?.id || 'local-cms'}:${shopProfile.brandShortName}`
  const cmsInstanceId = `cms_${crypto
    .createHash('sha256')
    .update(instanceSeed)
    .digest('hex')
    .slice(0, 12)}`

  cachedDomainsMemory = {
    checkedAt: Date.now(),
    customDomain: normalized.customDomain,
    additionalDomains: normalized.additionalDomains,
    routingMode: normalized.domainRoutingMode,
  }

  // Nếu brand_name trong DB vẫn là chuỗi mặc định 'OPENVN' nhưng là gian hàng Bơ Mộc Decor, ưu tiên hiển thị tên chuẩn trên Website
  const displayBrandName =
    shopProfile.brandName === 'OPENVN' && normalized.customDomain === 'bomocdecor.vn'
      ? 'Bơ Mộc Decor'
      : shopProfile.brandName

  return {
    cmsInstanceId,
    brandProfile: {
      ...shopProfile,
      brandName: displayBrandName,
      companyName: rawSettings.company_name ?? '',
      companyPhone: rawSettings.company_phone ?? '',
      companyAddress: rawSettings.company_address ?? '',
      invoiceBankCode: rawSettings.invoice_bank_code ?? '',
      invoiceBankName: rawSettings.invoice_bank_name ?? '',
      invoiceBankAccount: rawSettings.invoice_bank_account ?? '',
      invoiceBankHolder: rawSettings.invoice_bank_holder ?? '',
    },
    config: normalized,
  }
}

/**
 * Cập nhật cấu hình Website Khách hàng & Tên miền Riêng của CMS hiện tại vào
 * dòng `IntegrationCredential(provider='WEBSITE')` sẵn có (không sinh dòng mới).
 */
export async function saveStorefrontConfigForCurrentCms(
  partialInput: Record<string, unknown>
): Promise<StorefrontCmsConfig> {
  const current = await getStorefrontConfigForCurrentCms()
  const mergedInput: Record<string, unknown> = {
    ...current.config,
    ...partialInput,
    contact: {
      ...current.config.contact,
      ...(partialInput.contact && typeof partialInput.contact === 'object'
        ? (partialInput.contact as Record<string, unknown>)
        : {}),
    },
    updatedAt: new Date().toISOString(),
  }

  const nextConfig = normalizeStorefrontCmsConfig(mergedInput, current.config)

  const existingCred = await db.integrationCredential.findUnique({
    where: { provider: 'WEBSITE' },
  })

  const siteUrl = nextConfig.customDomain
    ? `https://${nextConfig.customDomain}`
    : current.brandProfile.storefrontUrl || '/store'

  if (existingCred) {
    let prevObj: Record<string, unknown> = {}
    try {
      prevObj = JSON.parse(existingCred.config) as Record<string, unknown>
    } catch {
      prevObj = {}
    }
    const nextDbConfig = mergePreservingInternalVaultFields(existingCred.config, {
      ...prevObj,
      siteUrl,
      connected: nextConfig.enabled,
    })
    delete nextDbConfig.storefrontConfigV1
    nextDbConfig.__storefront_v1 = nextConfig
    await db.integrationCredential.update({
      where: { provider: 'WEBSITE' },
      data: {
        active: nextConfig.enabled,
        config: JSON.stringify(nextDbConfig),
      },
    })
  }

  // Nếu tồn tại dòng shop_storefront_url trong AppSetting thì cập nhật giá trị (CHỈ updateMany để tuyệt đối không tạo thêm dòng mới vượt mốc 21 dòng!)
  await db.appSetting
    .updateMany({
      where: { key: 'shop_storefront_url' },
      data: { value: siteUrl },
    })
    .catch(() => null)

  // Đánh dấu kênh WEBSITE đã kết nối (updateMany trên dòng có sẵn -> giữ nguyên 10 dòng Channel)
  await db.channel
    .updateMany({
      where: { key: 'WEBSITE' },
      data: { connected: nextConfig.enabled },
    })
    .catch(() => null)

  invalidateStorefrontDomainMemoryCache()
  cachedDomainsMemory = {
    checkedAt: Date.now(),
    customDomain: nextConfig.customDomain,
    additionalDomains: nextConfig.additionalDomains,
    routingMode: nextConfig.domainRoutingMode,
  }
  invalidateApiCache('settings:public')
  invalidateApiCache('storefront:public')
  broadcast('settings.updated', {
    reason: 'storefront_config',
    customDomain: nextConfig.customDomain,
  })

  return nextConfig
}
