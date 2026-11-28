'use client'

import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react'

export interface ShopProfileConfig {
  brandName: string
  brandShortName: string
  brandBadge: string
  brandSubtitle: string
  brandFooterTagline: string
  defaultWorkshopName: string
  workshopPresets: string[]
  defaultWarehouseLabel: string
  storefrontUrl: string
}

export const DEFAULT_SHOP_PROFILE: ShopProfileConfig = {
  brandName: 'OPENVN · Ưu Đàm',
  brandShortName: 'OPENVN',
  brandBadge: 'OMNI',
  brandSubtitle: 'Quản lý bán hàng đa kênh',
  brandFooterTagline: 'Quản lý bán hàng đa kênh · Agent Autopilot 100% · Invoice Pro · Offline-first',
  defaultWorkshopName: 'Xưởng đúc thủ công',
  workshopPresets: [
    'Xưởng đúc thủ công',
    'Tổ đổ nến bơ tự nhiên',
    'Tổ hoàn thiện & đóng gói',
  ],
  defaultWarehouseLabel: 'Kho Trung Tâm',
  storefrontUrl: '/store',
}

export interface ShopProfilePreset {
  id: string
  label: string
  description: string
  config: ShopProfileConfig
}

export const SHOP_PROFILE_PRESETS: ShopProfilePreset[] = [
  {
    id: 'bomoc',
    label: 'Bơ Mộc · Showroom',
    description: 'Cấu hình thương hiệu cho Shop Bơ Mộc (Nến bơ & Thạch cao thủ công)',
    config: {
      brandName: 'Bơ Mộc · Showroom',
      brandShortName: 'BƠ MỘC',
      brandBadge: 'OMNI',
      brandSubtitle: 'Quản lý bán hàng đa kênh',
      brandFooterTagline: 'Quản lý bán hàng đa kênh · Đồng bộ Sàn & Xưởng thủ công · Offline-first',
      defaultWorkshopName: 'Xưởng đúc thủ công Bơ Mộc',
      workshopPresets: [
        'Xưởng đúc thủ công Bơ Mộc',
        'Tổ đổ nến bơ tự nhiên',
        'Tổ hoàn thiện & đóng gói',
      ],
      defaultWarehouseLabel: 'Kho Trung Tâm Bơ Mộc',
      storefrontUrl: 'https://bomocdecor.vn',
    },
  },
  {
    id: 'uudam',
    label: 'OPENVN · Ưu Đàm',
    description: 'Cấu hình mặc định OPENVN · Ưu Đàm Suite',
    config: {
      brandName: 'OPENVN · Ưu Đàm',
      brandShortName: 'OPENVN',
      brandBadge: 'OMNI',
      brandSubtitle: 'Quản lý bán hàng đa kênh',
      brandFooterTagline: 'Quản lý bán hàng đa kênh · Agent Autopilot 100% · Invoice Pro · Offline-first',
      defaultWorkshopName: 'Xưởng đúc thủ công Ưu Đàm',
      workshopPresets: [
        'Xưởng đúc thủ công Ưu Đàm',
        'Tổ đổ nến bơ tự nhiên',
        'Tổ hoàn thiện & đóng gói',
      ],
      defaultWarehouseLabel: 'Kho Trung Tâm',
      storefrontUrl: '/store',
    },
  },
  {
    id: 'annhien',
    label: 'An Nhiên Thạch · Studio',
    description: 'Cấu hình cho Showroom & Xưởng chế tác thủ công cao cấp',
    config: {
      brandName: 'An Nhiên Thạch · Studio',
      brandShortName: 'AN NHIÊN',
      brandBadge: 'PRO',
      brandSubtitle: 'Showroom & Xưởng chế tác thủ công',
      brandFooterTagline: 'Quản trị Showroom, Xưởng chế tác & Đa sàn thương mại điện tử',
      defaultWorkshopName: 'Xưởng chế tác An Nhiên',
      workshopPresets: [
        'Xưởng chế tác An Nhiên',
        'Tổ phối hương & đổ khuôn',
        'Tổ kiểm định & đóng gói',
      ],
      defaultWarehouseLabel: 'Kho Trung Tâm An Nhiên',
      storefrontUrl: '/store',
    },
  },
  {
    id: 'retail_generic',
    label: 'Cửa Hàng Đa Kênh (Tiêu chuẩn)',
    description: 'Cấu hình trung lập dùng chung cho mọi cửa hàng bán lẻ & kho vận',
    config: {
      brandName: 'Hệ Thống Bán Hàng Đa Kênh',
      brandShortName: 'CMS',
      brandBadge: 'OMNI',
      brandSubtitle: 'Quản lý bán hàng & Tồn kho đa sàn',
      brandFooterTagline: 'Hệ thống quản trị bán hàng đa kênh · Quản lý Kho, Đơn hàng & Sổ quỹ',
      defaultWorkshopName: 'Tổ sản xuất & Đóng gói',
      workshopPresets: [
        'Tổ sản xuất & Đóng gói',
        'Tổ gia công thành phẩm',
        'Kho đóng gói đơn sàn',
      ],
      defaultWarehouseLabel: 'Kho Trung Tâm',
      storefrontUrl: '/store',
    },
  },
]

const STORAGE_KEY = 'openvn_shop_profile_v1'
const UPDATE_EVENT = 'openvn:shop-profile-updated'

export function parseWorkshopPresets(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((s) => String(s).trim()).filter(Boolean)
    return cleaned.length > 0 ? cleaned : DEFAULT_SHOP_PROFILE.workshopPresets
  }
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const parts = raw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts
  }
  return DEFAULT_SHOP_PROFILE.workshopPresets
}

export function extractShopProfileFromSettings(
  raw: Record<string, unknown> | null | undefined
): ShopProfileConfig {
  if (!raw) return DEFAULT_SHOP_PROFILE
  const str = (key: string, fallback: string): string => {
    const val = raw[key]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
    return fallback
  }
  // Cho phép brand_badge rỗng nếu người dùng chủ động xóa nhãn
  const badgeVal =
    typeof raw.brand_badge === 'string' ? raw.brand_badge.trim() : DEFAULT_SHOP_PROFILE.brandBadge

  const defaultWorkshop = str('shop_default_workshop', DEFAULT_SHOP_PROFILE.defaultWorkshopName)
  const presets = parseWorkshopPresets(
    typeof raw.shop_workshop_presets === 'string' ? raw.shop_workshop_presets : undefined
  )
  const mergedPresets = presets.includes(defaultWorkshop)
    ? presets
    : [defaultWorkshop, ...presets]

  return {
    brandName: str('brand_name', DEFAULT_SHOP_PROFILE.brandName),
    brandShortName: str('brand_short_name', DEFAULT_SHOP_PROFILE.brandShortName),
    brandBadge: badgeVal,
    brandSubtitle: str('brand_subtitle', DEFAULT_SHOP_PROFILE.brandSubtitle),
    brandFooterTagline: str('brand_footer_tagline', DEFAULT_SHOP_PROFILE.brandFooterTagline),
    defaultWorkshopName: defaultWorkshop,
    workshopPresets: mergedPresets,
    defaultWarehouseLabel: str('shop_default_warehouse_label', DEFAULT_SHOP_PROFILE.defaultWarehouseLabel),
    storefrontUrl: str('shop_storefront_url', DEFAULT_SHOP_PROFILE.storefrontUrl),
  }
}

const ShopProfileContext = createContext<ShopProfileConfig | null>(null)

export function ShopProfileProvider({
  initialProfile,
  children,
}: {
  initialProfile: ShopProfileConfig
  children: React.ReactNode
}) {
  return createElement(ShopProfileContext.Provider, { value: initialProfile }, children)
}

let memoryProfileCache: ShopProfileConfig | null = null
let inflightSettingsFetch: Promise<ShopProfileConfig> | null = null

export function readShopProfileCache(fallback: ShopProfileConfig = DEFAULT_SHOP_PROFILE): ShopProfileConfig {
  if (typeof window === 'undefined') return fallback
  if (memoryProfileCache) return memoryProfileCache
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return fallback
    const parsed = JSON.parse(saved) as Partial<ShopProfileConfig>
    const profile: ShopProfileConfig = {
      brandName: parsed.brandName?.trim() || fallback.brandName,
      brandShortName: parsed.brandShortName?.trim() || fallback.brandShortName,
      brandBadge:
        typeof parsed.brandBadge === 'string' ? parsed.brandBadge.trim() : fallback.brandBadge,
      brandSubtitle: parsed.brandSubtitle?.trim() || fallback.brandSubtitle,
      brandFooterTagline: parsed.brandFooterTagline?.trim() || fallback.brandFooterTagline,
      defaultWorkshopName: parsed.defaultWorkshopName?.trim() || fallback.defaultWorkshopName,
      workshopPresets: parseWorkshopPresets(parsed.workshopPresets),
      defaultWarehouseLabel: parsed.defaultWarehouseLabel?.trim() || fallback.defaultWarehouseLabel,
      storefrontUrl: parsed.storefrontUrl?.trim() || fallback.storefrontUrl,
    }
    memoryProfileCache = profile
    return profile
  } catch {
    return fallback
  }
}

export function writeShopProfileCache(profile: ShopProfileConfig): void {
  if (typeof window === 'undefined') return
  memoryProfileCache = profile
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // ignore storage quota errors
  }
  window.dispatchEvent(new CustomEvent<ShopProfileConfig>(UPDATE_EVENT, { detail: profile }))
}

async function fetchShopProfileFromServer(force = false): Promise<ShopProfileConfig> {
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
    if (pathname === '/login' || pathname.endsWith('/login')) {
      try {
        const res = await fetch('/api/auth', { cache: 'no-store' })
        if (res.ok) {
          const data = (await res.json()) as {
            brand?: Partial<ShopProfileConfig>
          }
          if (data?.brand?.brandName) {
            const cached = readShopProfileCache()
            const merged: ShopProfileConfig = {
              ...cached,
              brandName: data.brand.brandName.trim() || cached.brandName,
              brandShortName: data.brand.brandShortName?.trim() || cached.brandShortName,
              brandBadge:
                typeof data.brand.brandBadge === 'string'
                  ? data.brand.brandBadge.trim()
                  : cached.brandBadge,
              brandSubtitle: data.brand.brandSubtitle?.trim() || cached.brandSubtitle,
              storefrontUrl: data.brand.storefrontUrl?.trim() || cached.storefrontUrl,
            }
            writeShopProfileCache(merged)
            return merged
          }
        }
      } catch {
        // ignore network errors on login screen
      }
      return readShopProfileCache()
    }
  }
  if (!force && inflightSettingsFetch) return inflightSettingsFetch
  inflightSettingsFetch = fetch('/api/settings', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return readShopProfileCache()
      const data = (await res.json()) as Record<string, unknown>
      const next = extractShopProfileFromSettings(data)
      writeShopProfileCache(next)
      return next
    })
    .catch(() => readShopProfileCache())
    .finally(() => {
      inflightSettingsFetch = null
    })
  return inflightSettingsFetch
}

export function useShopProfile() {
  const ssrProfile = useContext(ShopProfileContext)
  const baseFallback = ssrProfile ?? DEFAULT_SHOP_PROFILE
  const [profile, setProfile] = useState<ShopProfileConfig>(baseFallback)

  const refreshProfile = useCallback(async () => {
    const next = await fetchShopProfileFromServer(true)
    setProfile(next)
    return next
  }, [])

  useEffect(() => {
    setProfile(readShopProfileCache(baseFallback))
    void fetchShopProfileFromServer(false).then((next) => setProfile(next))

    const handleCustomUpdate = (e: Event) => {
      const custom = e as CustomEvent<ShopProfileConfig>
      if (custom.detail) {
        setProfile(custom.detail)
      } else {
        setProfile(readShopProfileCache(baseFallback))
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        memoryProfileCache = null
        setProfile(readShopProfileCache(baseFallback))
      }
    }

    window.addEventListener(UPDATE_EVENT, handleCustomUpdate)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(UPDATE_EVENT, handleCustomUpdate)
      window.removeEventListener('storage', handleStorage)
    }
  }, [baseFallback])

  return {
    profile,
    updateProfileCache: writeShopProfileCache,
    refreshProfile,
  }
}
