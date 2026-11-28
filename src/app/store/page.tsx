'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  BadgePercent,
  BookOpen,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileSearch,
  Flame,
  Globe,
  Info,
  Layers,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  QrCode,
  Search,
  Send,
  Share2,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  Truck,
  X,
  ZoomIn,
} from 'lucide-react'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ToastAction } from '@/components/ui/toast'
import { useToast } from '@/hooks/use-toast'
import { formatVND } from '@/lib/format'
import {
  hasAnySyncedShopeeBanners,
  matchesCollectionBannerProduct,
  type StorefrontBannersConfig,
  type StorefrontCarouselBanner,
} from '@/lib/storefront-banners'
import {
  buildStorefrontCartStorageKey,
  buildStorefrontProductShareUrl,
  buildStorefrontVietQrUrl,
  findSiblingVariantProducts,
  formatCustomerStorefrontBrandName,
  formatHeroShortProductLabel,
  formatStorefrontDisplayTitle,
  formatStorefrontLookupStatusLabel,
  formatWholesaleTiersSummary,
  isPlaceholderStorefrontEmail,
  isPlaceholderStorefrontPhone,
  parseStorefrontDeepLinkQuery,
  parseStorefrontProductDescription,
  reconcileActiveCartItems,
  reconcilePersistedCartWithCatalog,
  resolveCustomerHeaderSubtitle,
  resolveHeroPrimaryStage,
  resolveStorefrontHeroCopy,
  selectHeroShowcaseProducts,
  selectRelatedStorefrontProducts,
  serializeCartForStorage,
  type ProductDetailTabKey,
} from '@/lib/storefront-ux'
import { cn } from '@/lib/utils'

interface WholesalePriceEntry {
  tierId: string
  minQty: number
  label: string
  badge: string
  discountPercent: number
  unitPrice: number
}

interface StorefrontProduct {
  id: string
  sku: string
  parentSku?: string | null
  tierVariationName?: string | null
  name: string
  cleanTitle: string
  variantLabel: string | null
  description: string
  categoryId: string | null
  categoryName: string
  retailPrice: number
  wholesalePrices: WholesalePriceEntry[]
  unit: string
  type: string
  fragile: boolean
  weightGram?: number | null
  dimensionsLabel?: string | null
  daysToShip?: number | null
  image: string | null
  images: string[]
  inStock: boolean
  availableToOrder: boolean
  stockLabel: string
  shopeeUrl: string
}

interface WholesaleTier {
  id: string
  minQty: number
  discountPercent: number
  label: string
  badge: string
  description: string
}

interface StorefrontPayload {
  ok: boolean
  storefrontClosed?: boolean
  cmsInstanceId: string
  brand: {
    brandName: string
    brandShortName: string
    brandBadge: string
    brandSubtitle: string
    footerTagline: string
    workshopName: string
    companyName: string
  }
  config: {
    enabled: boolean
    customDomain: string
    additionalDomains: string[]
    cmsBackendOrigin: string
    heroBadge: string
    heroTitle: string
    heroSubtitle: string
    announcementBar: string
    wholesaleEnabled: boolean
    wholesaleTiers: WholesaleTier[]
    wholesalePolicyNote: string
    oemCustomNote: string
    freeShipThreshold: number
    baseShippingFee: number
    returnDays: number
    allowPreorderWhenOutOfStock: boolean
    contact: {
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
    bankTransfer?: {
      bankCode: string
      bankName: string
      bankAccount: string
      bankHolder: string
    } | null
    banners?: StorefrontBannersConfig
  }
  bankTransfer: {
    bankCode: string
    bankName: string
    bankAccount: string
    bankHolder: string
  } | null
  categories: Array<{ id: string; name: string; slug: string }>
  products: StorefrontProduct[]
  articles: Array<{
    id: string
    slug: string | null
    title: string | null
    excerpt: string | null
    publishedAt: string | null
    thumbnailUrl: string | null
  }>
}

interface StoreCartItem {
  product: StorefrontProduct
  quantity: number
}

declare global {
  interface Window {
    __OPENVN_STOREFRONT_BOOTSTRAP__?: StorefrontPayload
  }
}

function computeDiscountedPriceClient(retailPrice: number, discountPercent: number): number {
  const cleanRetail = Math.max(0, Math.round(Number(retailPrice) || 0))
  const clampedPct = Math.min(90, Math.max(0, Number(discountPercent) || 0))
  const keepBps = 10_000 - Math.round(clampedPct * 100)
  return Math.floor((cleanRetail * keepBps + 5_000) / 10_000)
}

function isStaticBetaHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window.location.hostname.toLowerCase()
  const hasSubpathShim = Boolean(
    (window as unknown as { __BETA_SUBPATH_SHIM__?: unknown }).__BETA_SUBPATH_SHIM__
  )
  return (
    hasSubpathShim ||
    host.endsWith('.github.io') ||
    host === 'khoaphan.dev' ||
    host.endsWith('.khoaphan.dev')
  )
}

function sanitizeClientStorefrontPayload(payload: StorefrontPayload | null): StorefrontPayload | null {
  if (!payload) return null
  const contact = payload.config?.contact
  const cleanedHotline =
    contact?.hotline && !isPlaceholderStorefrontPhone(contact.hotline) ? contact.hotline : ''
  const cleanedZaloPhone =
    contact?.zaloPhone && !isPlaceholderStorefrontPhone(contact.zaloPhone)
      ? contact.zaloPhone
      : ''
  const cleanedZaloUrl =
    contact?.zaloUrl && !isPlaceholderStorefrontPhone(contact.zaloUrl) ? contact.zaloUrl : ''
  const cleanedEmail =
    contact?.email && !isPlaceholderStorefrontEmail(contact.email) ? contact.email : ''

  const cleanedProducts = Array.isArray(payload.products)
    ? payload.products.map((p) => ({
        ...p,
        cleanTitle:
          formatStorefrontDisplayTitle(p.cleanTitle || p.name, p.variantLabel) ||
          p.cleanTitle ||
          p.name,
      }))
    : []

  return {
    ...payload,
    brand: {
      ...payload.brand,
      brandName: formatCustomerStorefrontBrandName(
        payload.brand?.brandName,
        payload.config?.customDomain
      ),
    },
    config: {
      ...payload.config,
      contact: {
        ...payload.config.contact,
        hotline: cleanedHotline,
        zaloPhone: cleanedZaloPhone,
        zaloUrl: cleanedZaloUrl,
        email: cleanedEmail,
      },
    },
    products: cleanedProducts,
  }
}

function resolveStorefrontApiEndpoint(bootstrapData?: StorefrontPayload | null): string {
  if (typeof window === 'undefined') return '/api/public/storefront'
  const host = window.location.hostname.toLowerCase()
  const isStaticCustomOrPagesHost =
    isStaticBetaHost() ||
    Boolean(bootstrapData) ||
    Boolean(window.__OPENVN_STOREFRONT_BOOTSTRAP__) ||
    (host !== 'localhost' &&
      host !== '127.0.0.1' &&
      !host.endsWith('.onrender.com') &&
      window.location.pathname === '/' &&
      Boolean(window.__OPENVN_STOREFRONT_BOOTSTRAP__))

  if (isStaticCustomOrPagesHost) {
    const origin = (
      bootstrapData?.config?.cmsBackendOrigin ||
      window.__OPENVN_STOREFRONT_BOOTSTRAP__?.config?.cmsBackendOrigin ||
      process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL ||
      'https://openvn-cms-pos-backend.onrender.com'
    ).replace(/\/+$/, '')
    return `${origin}/api/public/storefront`
  }
  return '/api/public/storefront'
}

type ActiveNavSection = 'PRODUCTS' | 'WHOLESALE' | 'CONTACT' | 'TRACKING'

export default function OnlineStorefrontPage() {
  const { toast, dismiss } = useToast()

  const [storeData, setStoreData] = useState<StorefrontPayload | null>(() =>
    typeof window !== 'undefined' && window.__OPENVN_STOREFRONT_BOOTSTRAP__
      ? sanitizeClientStorefrontPayload(window.__OPENVN_STOREFRONT_BOOTSTRAP__)
      : null
  )
  const [loading, setLoading] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.__OPENVN_STOREFRONT_BOOTSTRAP__ ? false : true
  )

  const [activeTab, setActiveTab] = useState<ActiveNavSection>('PRODUCTS')
  const [priceViewMode, setPriceViewMode] = useState<'RETAIL' | 'WHOLESALE'>('RETAIL')
  const [search, setSearch] = useState('')
  const [selectedCat, setSelectedCat] = useState<string>('ALL')
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>('ALL')
  const [carouselIdx, setCarouselIdx] = useState(0)
  const [carouselPaused, setCarouselPaused] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC'>('DEFAULT')
  const [selectedProduct, setSelectedProduct] = useState<StorefrontProduct | null>(null)
  const [selectedImageIdx, setSelectedImageIdx] = useState(0)
  const [quickViewQty, setQuickViewQty] = useState(1)
  const [detailTab, setDetailTab] = useState<ProductDetailTabKey>('OVERVIEW')
  const [detailZoomOpen, setDetailZoomOpen] = useState(false)

  const [cart, setCart] = useState<StoreCartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)

  // Checkout state
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [orderNote, setOrderNote] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'COD' | 'BANK_TRANSFER'>('COD')
  const [submittingOrder, setSubmittingOrder] = useState(false)
  const [completedOrder, setCompletedOrder] = useState<{
    refCode: string
    grandTotal: number
    wholesaleSaved: number
    tierLabel: string | null
    paymentMethod: 'COD' | 'BANK_TRANSFER'
  } | null>(null)
  const [qrLoadFailedUrl, setQrLoadFailedUrl] = useState<string | null>(null)
  const hydratedCartKeyRef = useRef<string | null>(null)
  const [hydratedCartKey, setHydratedCartKey] = useState<string | null>(null)
  const pendingDeepLinkSkuRef = useRef<string>('')
  const deepLinkSkuAppliedRef = useRef<boolean>(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Wholesale Inquiry Form state
  const [wsName, setWsName] = useState('')
  const [wsShopName, setWsShopName] = useState('')
  const [wsPhone, setWsPhone] = useState('')
  const [wsEmail, setWsEmail] = useState('')
  const [wsAddress, setWsAddress] = useState('')
  const [wsEstimatedQty, setWsEstimatedQty] = useState('30')
  const [wsNote, setWsNote] = useState('')
  const [submittingWholesale, setSubmittingWholesale] = useState(false)
  const [wholesaleSubmittedCode, setWholesaleSubmittedCode] = useState<string | null>(null)

  // Contact Form state
  const [ctName, setCtName] = useState('')
  const [ctPhone, setCtPhone] = useState('')
  const [ctEmail, setCtEmail] = useState('')
  const [ctMessage, setCtMessage] = useState('')
  const [submittingContact, setSubmittingContact] = useState(false)
  const [contactSubmittedCode, setContactSubmittedCode] = useState<string | null>(null)

  // Order / Quote Lookup state
  const [lookupCode, setLookupCode] = useState('')
  const [lookupPhone, setLookupPhone] = useState('')
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupResult, setLookupResult] = useState<{
    code: string
    status: string
    paymentStatus?: string | null
    title?: string
    total?: number | null
    tierApplied?: string | null
    createdAt?: string
    shipment?: {
      carrier?: string | null
      trackingCode?: string | null
      status?: string | null
    } | null
  } | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [isCustomDomainHost, setIsCustomDomainHost] = useState(false)
  const [hasStaffSession, setHasStaffSession] = useState(false)

  const loadStorefront = useCallback(async () => {
    const bootstrapped =
      typeof window !== 'undefined' ? window.__OPENVN_STOREFRONT_BOOTSTRAP__ ?? null : null
    if (bootstrapped) {
      setStoreData(sanitizeClientStorefrontPayload(bootstrapped))
      setLoading(false)
    } else {
      setLoading(true)
    }

    try {
      const endpoint = resolveStorefrontApiEndpoint(bootstrapped)
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (res.ok) {
        const liveData = (await res.json()) as StorefrontPayload
        if (liveData && liveData.ok && Array.isArray(liveData.products)) {
          setStoreData(sanitizeClientStorefrontPayload(liveData))
        }
      }
    } catch {
      // Giữ nguyên dữ liệu bootstrap tức thì nếu mạng chậm
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (mq) {
      setPrefersReducedMotion(mq.matches)
      const onChange = (ev: MediaQueryListEvent) => setPrefersReducedMotion(ev.matches)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hostname.toLowerCase()
      const p = window.location.pathname.toLowerCase()
      const staticBeta = isStaticBetaHost()
      const isInternal =
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h.endsWith('.onrender.com') ||
        staticBeta ||
        p.startsWith('/store') ||
        p.endsWith('/store') ||
        p.endsWith('/store/')
      const customHost = !isInternal
      setIsCustomDomainHost(customHost)

      const dl = parseStorefrontDeepLinkQuery(window.location.search)
      if (dl.tab) setActiveTab(dl.tab)
      if (dl.priceMode) setPriceViewMode(dl.priceMode)
      if (dl.query) setSearch(dl.query)
      if (dl.lookupCode) setLookupCode(dl.lookupCode)
      if (dl.sku) pendingDeepLinkSkuRef.current = dl.sku

      // Chỉ hiển thị nút CMS trên Header khi nhân sự đang có phiên đăng nhập hợp lệ trên máy chủ CMS
      if (!customHost && !staticBeta && !window.__OPENVN_STOREFRONT_BOOTSTRAP__) {
        fetch('/api/auth', {
          headers: { 'x-session-check': '1' },
          cache: 'no-store',
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { valid?: boolean } | null) => {
            if (d?.valid === true) setHasStaffSession(true)
          })
          .catch(() => null)
      }
    }
    void loadStorefront()
  }, [loadStorefront])

  const cfg = storeData?.config
  const brandName = useMemo(
    () =>
      formatCustomerStorefrontBrandName(
        storeData?.brand?.brandName || 'Bơ Mộc Decor',
        cfg?.customDomain
      ),
    [storeData?.brand?.brandName, cfg?.customDomain]
  )
  const headerSubtitle = useMemo(
    () =>
      resolveCustomerHeaderSubtitle({
        brandSubtitle: storeData?.brand?.brandSubtitle,
        workshopName: storeData?.brand?.workshopName,
        heroBadge: cfg?.heroBadge,
        brandName,
      }),
    [storeData?.brand?.brandSubtitle, storeData?.brand?.workshopName, cfg?.heroBadge, brandName]
  )

  useEffect(() => {
    if (brandName) {
      document.title = `${brandName} — Sản phẩm Thủ công, Bảng Giá Sỉ & Liên hệ Chính thức`
    }
  }, [brandName])

  const banners = cfg?.banners
  const showShopeeBanners =
    !storeData?.storefrontClosed &&
    cfg?.enabled !== false &&
    banners?.enabled !== false &&
    hasAnySyncedShopeeBanners(banners)
  const carouselBanners = useMemo(
    () => (showShopeeBanners ? banners?.carouselBanners ?? [] : []),
    [showShopeeBanners, banners?.carouselBanners]
  )
  const spotlightBanners = useMemo(
    () => (showShopeeBanners ? banners?.spotlightBanners ?? [] : []),
    [showShopeeBanners, banners?.spotlightBanners]
  )
  const products = useMemo(() => storeData?.products ?? [], [storeData?.products])
  const rawCollectionBanners = useMemo(
    () => (showShopeeBanners ? banners?.collectionBanners ?? [] : []),
    [showShopeeBanners, banners?.collectionBanners]
  )
  const collectionBannersWithCounts = useMemo(
    () =>
      rawCollectionBanners
        .map((col) => ({
          col,
          matchedCount: products.filter((p) => matchesCollectionBannerProduct(p, col)).length,
        }))
        .filter((entry) => entry.matchedCount > 0 || Boolean(entry.col.shopeeUrl)),
    [rawCollectionBanners, products]
  )

  const categories = useMemo(() => storeData?.categories ?? [], [storeData?.categories])
  const wholesaleTiers = useMemo(
    () => cfg?.wholesaleTiers ?? [],
    [cfg?.wholesaleTiers]
  )
  const contact = cfg?.contact
  const effectiveBankTransfer = storeData?.bankTransfer ?? cfg?.bankTransfer ?? null
  const cartStorageKey = storeData?.cmsInstanceId
    ? buildStorefrontCartStorageKey(storeData.cmsInstanceId)
    : null

  const isStorefrontClosed = Boolean(storeData?.storefrontClosed || cfg?.enabled === false)
  const isWholesaleAllowed = !isStorefrontClosed && cfg?.wholesaleEnabled !== false
  const freeShipThresholdEarly = cfg?.freeShipThreshold ?? 500_000
  const mainCatalogRef = useRef<HTMLElement | null>(null)

  const syncUrlSkuQuery = useCallback((skuValue: string) => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return
    try {
      const nextUrl = new URL(window.location.href)
      if (skuValue) {
        nextUrl.searchParams.set('sku', skuValue)
      } else {
        nextUrl.searchParams.delete('sku')
      }
      window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`)
    } catch {
      // ignore URL history restrictions
    }
  }, [])

  const openQuickView = useCallback(
    (product: StorefrontProduct, preserveTabAndQty = false) => {
      dismiss()
      setSelectedImageIdx(0)
      setDetailZoomOpen(false)
      if (!preserveTabAndQty) {
        setQuickViewQty(1)
        setDetailTab('OVERVIEW')
      }
      setSelectedProduct(product)
      syncUrlSkuQuery(product.sku)
    },
    [dismiss, syncUrlSkuQuery]
  )

  const closeQuickView = useCallback(() => {
    setDetailZoomOpen(false)
    setSelectedProduct(null)
    setQuickViewQty(1)
    setDetailTab('OVERVIEW')
    syncUrlSkuQuery('')
  }, [syncUrlSkuQuery])

  const openCartModal = useCallback(() => {
    dismiss()
    setCartOpen(true)
  }, [dismiss])

  const siblingVariants = useMemo(
    () => (selectedProduct ? findSiblingVariantProducts(selectedProduct, products) : []),
    [selectedProduct, products]
  )

  const relatedProducts = useMemo(
    () => (selectedProduct ? selectRelatedStorefrontProducts(selectedProduct, products, 3) : []),
    [selectedProduct, products]
  )

  const parsedSelectedDescription = useMemo(
    () =>
      selectedProduct
        ? parseStorefrontProductDescription(selectedProduct.description, {
            weightGram: selectedProduct.weightGram,
            dimensionsLabel: selectedProduct.dimensionsLabel,
            fragile: selectedProduct.fragile,
            unit: selectedProduct.unit,
          })
        : null,
    [selectedProduct]
  )

  const selectedGalleryImages = useMemo(() => {
    if (!selectedProduct) return []
    if (Array.isArray(selectedProduct.images) && selectedProduct.images.length > 0) {
      return selectedProduct.images
    }
    return selectedProduct.image ? [selectedProduct.image] : []
  }, [selectedProduct])

  const stepSelectedImage = useCallback(
    (delta: number) => {
      if (selectedGalleryImages.length <= 1) return
      setSelectedImageIdx(
        (prev) => ((prev + delta) % selectedGalleryImages.length + selectedGalleryImages.length) % selectedGalleryImages.length
      )
    },
    [selectedGalleryImages.length]
  )

  useEffect(() => {
    if (!selectedProduct || selectedGalleryImages.length <= 1) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowLeft') {
        ev.preventDefault()
        stepSelectedImage(-1)
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault()
        stepSelectedImage(1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedProduct, selectedGalleryImages.length, stepSelectedImage])

  const heroShowcaseProducts = useMemo(
    () => (isStorefrontClosed ? [] : selectHeroShowcaseProducts(products, 3)),
    [isStorefrontClosed, products]
  )
  const heroPrimaryStage = useMemo(
    () =>
      resolveHeroPrimaryStage({
        isStorefrontClosed,
        showShopeeBanners,
        brandName,
        coverBannerUrl: banners?.coverBannerUrl,
        mobileCoverBannerUrl: banners?.mobileCoverBannerUrl,
        firstCarouselBanner: carouselBanners[0] ?? null,
        showcaseProducts: heroShowcaseProducts,
      }),
    [
      isStorefrontClosed,
      showShopeeBanners,
      brandName,
      banners?.coverBannerUrl,
      banners?.mobileCoverBannerUrl,
      carouselBanners,
      heroShowcaseProducts,
    ]
  )
  const isInitialHeroLoading = loading && !storeData
  const hasHeroVisual =
    isInitialHeroLoading ||
    heroPrimaryStage.hasStageImage ||
    heroPrimaryStage.stripProducts.length > 0
  const minWholesaleQty = useMemo(
    () =>
      wholesaleTiers.length > 0
        ? Math.min(...wholesaleTiers.map((t) => Math.max(1, Math.floor(t.minQty))))
        : 10,
    [wholesaleTiers]
  )
  const wsRangeLabel = useMemo(() => {
    if (wholesaleTiers.length >= 2) {
      return `(${wholesaleTiers[0].badge} → ${wholesaleTiers[wholesaleTiers.length - 1].badge})`
    }
    if (wholesaleTiers.length === 1) {
      return `(${wholesaleTiers[0].badge})`
    }
    return ''
  }, [wholesaleTiers])
  const wsTiersSummary = useMemo(
    () => formatWholesaleTiersSummary(wholesaleTiers, cfg?.oemCustomNote),
    [wholesaleTiers, cfg?.oemCustomNote]
  )
  const heroCopy = useMemo(
    () =>
      resolveStorefrontHeroCopy({
        brandName,
        workshopName: storeData?.brand?.workshopName,
        customDomain: cfg?.customDomain,
        heroBadge: cfg?.heroBadge,
        heroTitle: cfg?.heroTitle,
        heroSubtitle: cfg?.heroSubtitle,
        announcementBar: cfg?.announcementBar,
        returnDays: cfg?.returnDays,
        freeShipFormatted: formatVND(freeShipThresholdEarly),
        minWholesaleQty,
        isWholesaleAllowed,
        isStorefrontClosed,
        totalProductsCount: products.length,
        sampleTexts: products.slice(0, 6).map((p) => p.cleanTitle || p.name),
      }),
    [
      brandName,
      storeData?.brand?.workshopName,
      cfg?.customDomain,
      cfg?.heroBadge,
      cfg?.heroTitle,
      cfg?.heroSubtitle,
      cfg?.announcementBar,
      cfg?.returnDays,
      freeShipThresholdEarly,
      minWholesaleQty,
      isWholesaleAllowed,
      isStorefrontClosed,
      products,
    ]
  )

  const selectNavTab = useCallback(
    (nextTab: ActiveNavSection) => {
      setActiveTab(nextTab)
      if (typeof window !== 'undefined') {
        const scrollBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
        window.requestAnimationFrame(() => {
          const tabEl = document.querySelector<HTMLElement>(`[data-nav-tab="${nextTab}"]`)
          tabEl?.scrollIntoView({
            behavior: scrollBehavior,
            block: 'nearest',
            inline: 'nearest',
          })
          if (nextTab === 'PRODUCTS') {
            window.scrollTo({ top: 0, behavior: scrollBehavior })
          } else {
            mainCatalogRef.current?.scrollIntoView({ behavior: scrollBehavior, block: 'start' })
          }
        })
      }
    },
    [prefersReducedMotion]
  )

  const scrollToCatalog = useCallback(() => {
    setActiveTab('PRODUCTS')
    if (typeof window !== 'undefined') {
      const scrollBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : 'smooth'
      window.requestAnimationFrame(() => {
        mainCatalogRef.current?.scrollIntoView({ behavior: scrollBehavior, block: 'start' })
      })
    }
  }, [prefersReducedMotion])

  useEffect(() => {
    if (!storeData) return
    if (!isWholesaleAllowed) {
      if (activeTab === 'WHOLESALE') setActiveTab('PRODUCTS')
      if (priceViewMode === 'WHOLESALE') setPriceViewMode('RETAIL')
    }
  }, [storeData, isWholesaleAllowed, activeTab, priceViewMode])

  useEffect(() => {
    if (typeof window === 'undefined' || !cartStorageKey || !storeData) return

    if (isStorefrontClosed) {
      setCart((prev) => (prev.length === 0 ? prev : []))
      return
    }

    if (hydratedCartKeyRef.current !== cartStorageKey) {
      if (products.length === 0) return
      hydratedCartKeyRef.current = cartStorageKey
      try {
        const raw = window.localStorage.getItem(cartStorageKey)
        const parsed = raw ? (JSON.parse(raw) as unknown) : []
        const reconciled = reconcilePersistedCartWithCatalog(parsed, products)
        setCart((prev) => {
          const baseActive = reconcileActiveCartItems(prev, products, false)
          if (reconciled.length === 0) return baseActive
          if (baseActive.length === 0) return reconciled
          const combined = [...reconciled]
          for (const item of baseActive) {
            const idx = combined.findIndex((c) => c.product.id === item.product.id)
            if (idx >= 0) {
              combined[idx] = {
                ...combined[idx],
                quantity: Math.min(10_000, combined[idx].quantity + item.quantity),
              }
            } else {
              combined.push(item)
            }
          }
          return combined
        })
      } catch {
        // ignore storage restrictions
      }
      setHydratedCartKey(cartStorageKey)
      return
    }

    setCart((prev) => {
      if (prev.length === 0) return prev
      const refreshed = reconcileActiveCartItems(prev, products, false)
      const unchanged =
        refreshed.length === prev.length &&
        refreshed.every(
          (item, idx) =>
            item.product === prev[idx]?.product && item.quantity === prev[idx]?.quantity
        )
      return unchanged ? prev : refreshed
    })
  }, [cartStorageKey, products, storeData, isStorefrontClosed])

  useEffect(() => {
    if (typeof window === 'undefined' || !cartStorageKey || isStorefrontClosed) return
    if (hydratedCartKey !== cartStorageKey) return
    try {
      const serialized = serializeCartForStorage(cart)
      if (serialized.length === 0) {
        window.localStorage.removeItem(cartStorageKey)
      } else {
        window.localStorage.setItem(cartStorageKey, JSON.stringify(serialized))
      }
    } catch {
      // ignore quota errors
    }
  }, [cart, cartStorageKey, hydratedCartKey, isStorefrontClosed])

  useEffect(() => {
    if (deepLinkSkuAppliedRef.current || !pendingDeepLinkSkuRef.current) {
      return
    }
    if (isStorefrontClosed) {
      pendingDeepLinkSkuRef.current = ''
      deepLinkSkuAppliedRef.current = true
      return
    }
    if (products.length === 0) return
    const targetSku = pendingDeepLinkSkuRef.current.trim().toUpperCase()
    const matched = products.find((p) => p.sku.toUpperCase() === targetSku)
    if (matched) {
      deepLinkSkuAppliedRef.current = true
      openQuickView(matched)
    }
  }, [products, isStorefrontClosed, openQuickView])

  useEffect(() => {
    if (carouselIdx >= carouselBanners.length && carouselBanners.length > 0) {
      setCarouselIdx(0)
    }
  }, [carouselIdx, carouselBanners.length])

  useEffect(() => {
    if (
      carouselBanners.length <= 1 ||
      carouselPaused ||
      prefersReducedMotion ||
      activeTab !== 'PRODUCTS'
    ) {
      return
    }
    const timer = window.setInterval(() => {
      setCarouselIdx((prev) => (prev + 1) % carouselBanners.length)
    }, 4800)
    return () => window.clearInterval(timer)
  }, [carouselBanners.length, carouselPaused, prefersReducedMotion, activeTab])

  const resolveProductFromBannerRef = useCallback(
    (targetSku?: string, shopeeProductId?: string): StorefrontProduct | null => {
      if (targetSku) {
        const bySku = products.find(
          (p) => p.sku.toUpperCase() === targetSku.trim().toUpperCase()
        )
        if (bySku) return bySku
      }
      if (shopeeProductId) {
        const suffix = `/${shopeeProductId.trim()}`
        const byShopee = products.find((p) => p.shopeeUrl && p.shopeeUrl.endsWith(suffix))
        if (byShopee) return byShopee
      }
      return null
    },
    [products]
  )

  const handleCarouselSlideClick = useCallback(
    (slide: StorefrontCarouselBanner) => {
      const matched = resolveProductFromBannerRef(slide.targetSku, slide.shopeeProductId)
      if (matched) {
        openQuickView(matched)
        return
      }
      if (slide.filterKeyword) {
        setSearch(slide.filterKeyword)
        return
      }
      if (slide.linkUrl) {
        window.open(slide.linkUrl, '_blank', 'noopener,noreferrer')
      }
    },
    [resolveProductFromBannerRef, openQuickView]
  )

  const activeCollectionBanner = useMemo(
    () =>
      selectedCollectionId === 'ALL'
        ? null
        : collectionBannersWithCounts.find(
            (x) => x.col.id === selectedCollectionId && x.matchedCount > 0
          )?.col ?? null,
    [collectionBannersWithCounts, selectedCollectionId]
  )

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = products.filter((p) => {
      if (selectedCat !== 'ALL' && p.categoryId !== selectedCat) return false
      if (
        activeCollectionBanner &&
        !matchesCollectionBannerProduct(p, activeCollectionBanner)
      ) {
        return false
      }
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.cleanTitle.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      )
    })
    if (sortBy === 'PRICE_ASC') {
      return [...base].sort((a, b) => a.retailPrice - b.retailPrice)
    }
    if (sortBy === 'PRICE_DESC') {
      return [...base].sort((a, b) => b.retailPrice - a.retailPrice)
    }
    return base
  }, [products, search, selectedCat, activeCollectionBanner, sortBy])

  const totalCartItems = useMemo(
    () => cart.reduce((sum, it) => sum + it.quantity, 0),
    [cart]
  )

  const activeCartWholesaleTier = useMemo(() => {
    if (!cfg?.wholesaleEnabled || wholesaleTiers.length === 0) return null
    const sorted = [...wholesaleTiers].sort((a, b) => b.minQty - a.minQty)
    return sorted.find((t) => totalCartItems >= t.minQty) ?? null
  }, [cfg?.wholesaleEnabled, wholesaleTiers, totalCartItems])

  const nextWholesaleTierHint = useMemo(() => {
    if (!cfg?.wholesaleEnabled || wholesaleTiers.length === 0) return null
    const sortedAsc = [...wholesaleTiers].sort((a, b) => a.minQty - b.minQty)
    return sortedAsc.find((t) => totalCartItems < t.minQty) ?? null
  }, [cfg?.wholesaleEnabled, wholesaleTiers, totalCartItems])

  const retailCartSubtotal = useMemo(
    () => cart.reduce((sum, it) => sum + it.product.retailPrice * it.quantity, 0),
    [cart]
  )

  const effectiveCartSubtotal = useMemo(() => {
    if (!activeCartWholesaleTier) return retailCartSubtotal
    return cart.reduce((sum, it) => {
      const wsPrice = computeDiscountedPriceClient(
        it.product.retailPrice,
        activeCartWholesaleTier.discountPercent
      )
      return sum + wsPrice * it.quantity
    }, 0)
  }, [cart, activeCartWholesaleTier, retailCartSubtotal])

  const wholesaleSavings = Math.max(0, retailCartSubtotal - effectiveCartSubtotal)
  const freeShipThreshold = cfg?.freeShipThreshold ?? 500_000
  const baseShippingFee = cfg?.baseShippingFee ?? 30_000
  const freeShipRemaining = Math.max(0, freeShipThreshold - effectiveCartSubtotal)
  const shippingFee =
    effectiveCartSubtotal === 0 || effectiveCartSubtotal >= freeShipThreshold
      ? 0
      : baseShippingFee
  const grandTotal = effectiveCartSubtotal + shippingFee

  const copyToClipboard = useCallback(
    async (value: string, label: string) => {
      if (!value) return
      try {
        await navigator.clipboard.writeText(value)
        toast({
          title: `Đã sao chép ${label}`,
          description: value,
        })
      } catch {
        toast({
          title: label,
          description: value,
        })
      }
    },
    [toast]
  )

  const checkoutPreviewVietQrUrl =
    paymentMethod === 'BANK_TRANSFER' && effectiveBankTransfer
      ? buildStorefrontVietQrUrl({
          bankCode: effectiveBankTransfer.bankCode,
          bankAccount: effectiveBankTransfer.bankAccount,
          bankHolder: effectiveBankTransfer.bankHolder,
          amount: grandTotal,
          addInfo: `${storeData?.brand?.brandShortName || 'BM'} WEB ${customerPhone.replace(/\D/g, '').slice(-10) || 'DONHANG'}`,
          template: 'compact2',
        })
      : ''

  const completedOrderVietQrUrl =
    completedOrder &&
    completedOrder.paymentMethod === 'BANK_TRANSFER' &&
    effectiveBankTransfer
      ? buildStorefrontVietQrUrl({
          bankCode: effectiveBankTransfer.bankCode,
          bankAccount: effectiveBankTransfer.bankAccount,
          bankHolder: effectiveBankTransfer.bankHolder,
          amount: completedOrder.grandTotal,
          addInfo: completedOrder.refCode,
          template: 'compact2',
        })
      : ''

  const addToCart = (
    product: StorefrontProduct,
    qtyToAdd = 1,
    options?: { silent?: boolean }
  ) => {
    if (!product.availableToOrder || isStorefrontClosed) return
    const safeQty = Math.max(1, Math.min(10_000, Math.floor(Number(qtyToAdd) || 1)))
    setCompletedOrder(null)
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.product.id === product.id)
      if (idx === -1) return [...prev, { product, quantity: safeQty }]
      return prev.map((it, i) =>
        i === idx ? { ...it, quantity: it.quantity + safeQty } : it
      )
    })
    if (!options?.silent) {
      toast({
        title: `Đã thêm ${safeQty} ${product.unit} vào giỏ hàng`,
        description: `${product.cleanTitle}${product.variantLabel ? ` (${product.variantLabel})` : ''}`,
        action: (
          <ToastAction
            altText="Xem giỏ hàng"
            onClick={() => openCartModal()}
            className="border-amber-300 bg-[#8c4f1e] text-xs font-bold text-white hover:bg-[#733f16] dark:border-amber-500 dark:bg-amber-400 dark:text-stone-950"
          >
            Xem giỏ →
          </ToastAction>
        ),
      })
    }
  }

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) =>
          it.product.id === productId ? { ...it, quantity: it.quantity + delta } : it
        )
        .filter((it) => it.quantity > 0)
    )
  }

  const handleCheckout = async () => {
    if (cart.length === 0) return
    if (!customerName.trim() || !customerPhone.trim() || !shippingAddress.trim()) {
      toast({
        title: 'Vui lòng điền đủ thông tin nhận hàng',
        description: 'Nhập Họ tên, Số điện thoại và Địa chỉ giao hàng chi tiết.',
        variant: 'destructive',
      })
      return
    }
    setSubmittingOrder(true)
    try {
      const endpoint = resolveStorefrontApiEndpoint(storeData)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_WEB_ORDER',
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          address: shippingAddress.trim(),
          note: orderNote.trim(),
          paymentMethod,
          items: cart.map((it) => ({
            productId: it.product.id,
            sku: it.product.sku,
            quantity: it.quantity,
          })),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        refCode?: string
        grandTotal?: number
        wholesaleSaved?: number
        wholesaleTier?: { label?: string } | null
        message?: string
        error?: string
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Không thể gửi đơn hàng lúc này.')
      }
      const refCode = json.refCode || `BM-WEB-${Date.now().toString().slice(-6)}`
      setCompletedOrder({
        refCode,
        grandTotal: json.grandTotal ?? grandTotal,
        wholesaleSaved: json.wholesaleSaved ?? wholesaleSavings,
        tierLabel: json.wholesaleTier?.label ?? activeCartWholesaleTier?.label ?? null,
        paymentMethod,
      })
      setCart([])
      setOrderNote('')
      toast({
        title: `Đặt hàng thành công (${refCode})`,
        description: json.message || 'Cửa hàng sẽ liên hệ xác nhận giao hàng sớm nhất.',
      })
    } catch (e) {
      toast({
        title: 'Không thể gửi đơn đặt hàng',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại hoặc gửi tin nhắn liên hệ.',
        variant: 'destructive',
      })
    } finally {
      setSubmittingOrder(false)
    }
  }

  const handleWholesaleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wsName.trim() || !wsPhone.trim()) {
      toast({
        title: 'Thiếu thông tin liên hệ sỉ',
        description: 'Vui lòng nhập Họ tên và Số điện thoại / Zalo để nhận bảng báo giá.',
        variant: 'destructive',
      })
      return
    }
    setSubmittingWholesale(true)
    try {
      const endpoint = resolveStorefrontApiEndpoint(storeData)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_WHOLESALE_INQUIRY',
          customerName: wsName.trim(),
          companyOrShopName: wsShopName.trim(),
          customerPhone: wsPhone.trim(),
          customerEmail: wsEmail.trim(),
          address: wsAddress.trim(),
          estimatedQty: Number(wsEstimatedQty) || 30,
          note: wsNote.trim(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        refCode?: string
        message?: string
        error?: string
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Không thể gửi yêu cầu báo giá sỉ.')
      }
      setWholesaleSubmittedCode(json.refCode || 'BM-SI-OK')
      toast({
        title: `Đã gửi yêu cầu báo giá sỉ (${json.refCode})`,
        description: json.message,
      })
    } catch (err) {
      toast({
        title: 'Lỗi gửi yêu cầu báo giá sỉ',
        description: err instanceof Error ? err.message : 'Vui lòng thử lại sau ít phút.',
        variant: 'destructive',
      })
    } finally {
      setSubmittingWholesale(false)
    }
  }

  const handleContactSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ctName.trim() || !ctPhone.trim() || !ctMessage.trim()) {
      toast({
        title: 'Vui lòng điền đủ thông tin',
        description: 'Nhập Họ tên, Số điện thoại và Nội dung cần tư vấn.',
        variant: 'destructive',
      })
      return
    }
    setSubmittingContact(true)
    try {
      const endpoint = resolveStorefrontApiEndpoint(storeData)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_CONTACT',
          customerName: ctName.trim(),
          customerPhone: ctPhone.trim(),
          customerEmail: ctEmail.trim(),
          note: ctMessage.trim(),
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        refCode?: string
        message?: string
        error?: string
      }
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Không thể gửi tin nhắn liên hệ.')
      }
      setContactSubmittedCode(json.refCode || 'BM-LH-OK')
      setCtMessage('')
      toast({
        title: `Đã gửi tin nhắn thành công (${json.refCode})`,
        description: json.message,
      })
    } catch (err) {
      toast({
        title: 'Không thể gửi liên hệ',
        description: err instanceof Error ? err.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      })
    } finally {
      setSubmittingContact(false)
    }
  }

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLookupError(null)
    setLookupResult(null)
    if (!lookupCode.trim() || lookupPhone.replace(/\D/g, '').length < 4) {
      setLookupError('Vui lòng nhập Mã đơn / Mã báo giá và ít nhất 4 số cuối Số điện thoại.')
      return
    }
    setLookupLoading(true)
    try {
      const base = resolveStorefrontApiEndpoint(storeData)
      const url = `${base}?lookupCode=${encodeURIComponent(lookupCode.trim())}&phone=${encodeURIComponent(lookupPhone.trim())}`
      const res = await fetch(url, { cache: 'no-store' })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        code?: string
        status?: string
        paymentStatus?: string | null
        title?: string
        total?: number | null
        tierApplied?: string | null
        createdAt?: string
        shipment?: {
          carrier?: string | null
          trackingCode?: string | null
          status?: string | null
        } | null
        error?: string
      }
      if (!res.ok || !json.ok) {
        setLookupError(json.error || 'Không tìm thấy thông tin phù hợp.')
        return
      }
      setLookupResult({
        code: json.code || lookupCode.trim().toUpperCase(),
        status: json.status || 'RECEIVED',
        paymentStatus: json.paymentStatus ?? null,
        title: json.title,
        total: json.total,
        tierApplied: json.tierApplied,
        createdAt: json.createdAt,
        shipment: json.shipment ?? null,
      })
    } catch {
      setLookupError('Không thể kết nối máy chủ tra cứu lúc này.')
    } finally {
      setLookupLoading(false)
    }
  }

  const estimatedQtyNum = Math.max(minWholesaleQty, Math.floor(Number(wsEstimatedQty) || 30))
  const simulatedTier = useMemo(() => {
    const sorted = [...wholesaleTiers].sort((a, b) => b.minQty - a.minQty)
    return sorted.find((t) => estimatedQtyNum >= t.minQty) ?? wholesaleTiers[0] ?? null
  }, [wholesaleTiers, estimatedQtyNum])

  const showMobileStickyCart =
    !isStorefrontClosed && totalCartItems > 0 && !cartOpen && !selectedProduct

  return (
    <div
      className={cn(
        'flex min-h-svh flex-col bg-background text-foreground',
        showMobileStickyCart && 'max-sm:pb-24'
      )}
    >
      {/* Thanh thông báo ưu đãi đầu trang */}
      <div className="border-b border-amber-200/70 bg-gradient-to-r from-amber-50 via-stone-50 to-emerald-50 px-3 py-1.5 text-center text-[11.5px] font-medium text-stone-800 sm:px-4 sm:py-2 sm:text-xs dark:border-stone-800 dark:from-stone-900 dark:via-slate-900 dark:to-emerald-950/50 dark:text-stone-200">
        <span>{heroCopy.effectiveAnnouncementBar}</span>
      </div>

      {/* Header Điều hướng Chính — Sticky 2 tầng gọn <= 92px trên Mobile, 1 hàng cân đối trên Desktop */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-3 py-1.5 sm:gap-3 sm:px-6 sm:py-2.5">
          {/* Tầng 1 Trái: Thương hiệu */}
          <button
            type="button"
            onClick={() => selectNavTab('PRODUCTS')}
            className="order-1 flex min-w-0 flex-1 items-center gap-2.5 text-left sm:flex-initial sm:gap-3"
          >
            {banners?.shopLogoUrl ? (
              <img
                src={banners.shopLogoUrl}
                alt={brandName}
                referrerPolicy="no-referrer"
                className="h-8 w-8 shrink-0 rounded-full border border-stone-200 object-cover shadow-xs sm:h-10 sm:w-10 dark:border-stone-700"
              />
            ) : (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#8c4f1e] to-stone-800 text-white shadow-sm sm:h-10 sm:w-10 sm:rounded-2xl">
                <ShoppingBag className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-base font-extrabold tracking-tight text-foreground sm:text-lg">
                  {brandName}
                </span>
                {cfg?.customDomain && (
                  <Badge
                    variant="outline"
                    className="hidden border-amber-300 bg-amber-50/90 text-[10px] font-semibold text-amber-950 md:inline-flex dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  >
                    {cfg.customDomain}
                  </Badge>
                )}
              </div>
              <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
                {headerSubtitle}
              </p>
            </div>
          </button>

          {/* Tầng 1 Phải trên Mobile / Cuối hàng trên Desktop: Nút Giỏ hàng + Công cụ */}
          <div className="order-2 flex shrink-0 items-center gap-1.5 sm:order-3">
            <Button
              type="button"
              size="sm"
              onClick={openCartModal}
              className="h-8.5 gap-1.5 bg-[#8c4f1e] px-2.5 text-xs font-bold text-white shadow-2xs hover:bg-[#733f16] sm:h-10 sm:px-3.5 dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
            >
              <ShoppingCart className="h-4 w-4 shrink-0" />
              <span className="tabular-nums">Giỏ hàng ({totalCartItems})</span>
            </Button>

            {!isCustomDomainHost && hasStaffSession && (
              <Button asChild variant="outline" size="sm" className="h-8.5 gap-1.5 text-xs sm:h-10">
                <Link href="/?cms=1" title="Về không gian Quản trị CMS">
                  <LayoutDashboard className="h-3.5 w-3.5 text-[#8c4f1e] dark:text-amber-400" />
                  <span className="hidden xl:inline">CMS</span>
                </Link>
              </Button>
            )}

            <div className="[&_button]:max-sm:h-8.5 [&_button]:max-sm:min-h-8.5 [&_button]:max-sm:w-8.5 [&_button]:max-sm:min-w-8.5">
              <ThemeToggle />
            </div>
          </div>

          {/* Tầng 2 trên Mobile (cuộn ngang 1 dòng mượt) / Giữa hàng trên Desktop: 4 Tab điều hướng */}
          <nav
            aria-label="Điều hướng cửa hàng"
            className="order-3 -mx-1 flex w-[calc(100%+0.5rem)] flex-nowrap items-center gap-1 overflow-x-auto px-1 pb-0 [scrollbar-width:none] sm:order-2 sm:mx-0 sm:w-auto sm:flex-wrap sm:gap-1.5 sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden"
          >
            <Button
              type="button"
              data-nav-tab="PRODUCTS"
              aria-current={activeTab === 'PRODUCTS' ? 'page' : undefined}
              variant={activeTab === 'PRODUCTS' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => selectNavTab('PRODUCTS')}
              className={cn(
                'h-8.5 shrink-0 gap-1 px-2 text-xs font-semibold whitespace-nowrap sm:h-9.5 sm:gap-1.5 sm:px-3',
                activeTab === 'PRODUCTS' &&
                  'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300'
              )}
            >
              <Store className="h-3.5 w-3.5 shrink-0" />
              <span>Sản phẩm ({products.length})</span>
            </Button>

            {isWholesaleAllowed && (
              <Button
                type="button"
                data-nav-tab="WHOLESALE"
                aria-current={activeTab === 'WHOLESALE' ? 'page' : undefined}
                variant={activeTab === 'WHOLESALE' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => selectNavTab('WHOLESALE')}
                className={cn(
                  'h-8.5 shrink-0 gap-1 px-2 text-xs font-semibold whitespace-nowrap sm:h-9.5 sm:gap-1.5 sm:px-3',
                  activeTab === 'WHOLESALE' &&
                    'bg-[#8c4f1e] text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300'
                )}
              >
                <BadgePercent className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Bảng Giá Sỉ
                  {wsRangeLabel ? (
                    <span className="max-[479px]:hidden"> {wsRangeLabel}</span>
                  ) : null}
                </span>
              </Button>
            )}

            <Button
              type="button"
              data-nav-tab="CONTACT"
              aria-current={activeTab === 'CONTACT' ? 'page' : undefined}
              variant={activeTab === 'CONTACT' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => selectNavTab('CONTACT')}
              className={cn(
                'h-8.5 shrink-0 gap-1 px-2 text-xs font-semibold whitespace-nowrap sm:h-9.5 sm:gap-1.5 sm:px-3',
                activeTab === 'CONTACT' &&
                  'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300'
              )}
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>Liên hệ &amp; Xưởng</span>
            </Button>

            <Button
              type="button"
              data-nav-tab="TRACKING"
              aria-current={activeTab === 'TRACKING' ? 'page' : undefined}
              variant={activeTab === 'TRACKING' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => selectNavTab('TRACKING')}
              className={cn(
                'h-8.5 shrink-0 gap-1 px-2 text-xs font-semibold whitespace-nowrap sm:h-9.5 sm:gap-1.5 sm:px-3',
                activeTab === 'TRACKING' &&
                  'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300'
              )}
            >
              <FileSearch className="h-3.5 w-3.5 shrink-0" />
              <span>Tra cứu đơn</span>
            </Button>
          </nav>
        </div>
      </header>

      {/* Hero Section — Chỉ hiển thị khi đang ở tab PRODUCTS để 3 tab còn lại hiện thẳng nội dung chính */}
      {activeTab === 'PRODUCTS' && (
        <section className="relative overflow-hidden border-b border-stone-200/80 bg-[radial-gradient(circle_at_0%_0%,rgba(245,213,172,0.28),transparent_48%),radial-gradient(circle_at_100%_100%,rgba(167,214,193,0.22),transparent_46%),linear-gradient(135deg,#fbf9f5_0%,#f7f1e7_52%,#f2f6f3_100%)] py-4 sm:py-8 lg:py-10 dark:border-stone-800 dark:bg-[radial-gradient(circle_at_0%_0%,rgba(180,83,9,0.16),transparent_45%),linear-gradient(135deg,#0c0a09_0%,#1c1917_55%,#0f172a_100%)]">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div
              className={cn(
                'grid items-center gap-5 sm:gap-7 lg:gap-9',
                hasHeroVisual ? 'lg:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]' : 'max-w-3xl'
              )}
            >
              {/* Cột Trái */}
              <div className="min-w-0 space-y-3 sm:space-y-4">
                <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-amber-300/75 bg-white/90 px-3 py-1 text-[11.5px] font-semibold text-amber-950 shadow-2xs backdrop-blur-xs sm:px-3.5 sm:py-1.5 sm:text-xs dark:border-amber-800/80 dark:bg-stone-900/90 dark:text-amber-200">
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                  <span className="truncate">
                    {cfg?.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc'}
                  </span>
                </div>

                <h1 className="text-[22px] leading-[1.2] font-extrabold tracking-tight text-stone-900 sm:text-4xl lg:text-[38px] dark:text-stone-50">
                  {cfg?.heroTitle || 'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công Tinh Tế'}
                </h1>

                <p className="max-w-xl text-[13.5px] leading-relaxed text-stone-600 sm:text-[15px] sm:leading-[1.65] dark:text-stone-300">
                  {cfg?.heroSubtitle ||
                    'Chế tác tỉ mỉ từng khay, hũ nến thạch cao kháng dầu chịu nhiệt và nến bơ thực vật thuần chay không khói cho góc thiền, bàn trà, spa & quà tặng doanh nghiệp.'}
                </p>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-semibold text-stone-700 dark:text-stone-300">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                    <span>{heroCopy.highlight1}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                    <span>{heroCopy.highlight2}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-400" />
                    <span>{heroCopy.highlight3}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-0.5 sm:gap-2.5 sm:pt-1">
                  {isStorefrontClosed ? (
                    <>
                      <Button
                        type="button"
                        onClick={() => selectNavTab('CONTACT')}
                        className="h-10 cursor-pointer gap-2 rounded-xl bg-stone-900 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-stone-800 sm:h-11 sm:px-4.5 sm:text-[13px] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                      >
                        <Phone className="h-4 w-4 shrink-0" />
                        <span>Liên Hệ Cửa Hàng</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => selectNavTab('TRACKING')}
                        className="h-10 cursor-pointer gap-1.5 rounded-xl border-amber-400/90 bg-amber-50/85 px-3.5 text-xs font-bold text-amber-950 transition hover:bg-amber-100/90 sm:h-11 sm:px-4 sm:text-[13px] dark:border-amber-700 dark:bg-amber-950/45 dark:text-amber-200"
                      >
                        <FileSearch className="h-4 w-4 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                        <span>Tra Cứu Đơn Hàng</span>
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      onClick={scrollToCatalog}
                      className="h-10 cursor-pointer gap-2 rounded-xl bg-stone-900 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-stone-800 sm:h-11 sm:px-4.5 sm:text-[13px] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                    >
                      <ShoppingBag className="h-4 w-4 shrink-0" />
                      <span>Khám Phá Sản Phẩm</span>
                    </Button>
                  )}

                  {isWholesaleAllowed && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => selectNavTab('WHOLESALE')}
                      className="h-10 max-w-full cursor-pointer gap-1.5 rounded-xl border-amber-400/90 bg-amber-50/85 px-3.5 text-xs font-bold text-amber-950 transition hover:bg-amber-100/90 sm:h-11 sm:px-4 sm:text-[13px] dark:border-amber-700 dark:bg-amber-950/45 dark:text-amber-200 dark:hover:bg-amber-950/70"
                    >
                      <BadgePercent className="h-4 w-4 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                      <span className="truncate">Bảng Giá Sỉ &amp; OEM {wsRangeLabel}</span>
                    </Button>
                  )}

                  {contact?.shopeeUrl && (
                    <Button
                      asChild
                      variant="outline"
                      className="h-10 gap-1.5 rounded-xl border-stone-300/90 bg-white/90 px-3.5 text-xs font-semibold text-stone-800 hover:bg-white sm:h-11 sm:px-4 sm:text-[13px] dark:border-stone-700 dark:bg-stone-900/80 dark:text-stone-200"
                    >
                      <a href={contact.shopeeUrl} target="_blank" rel="noopener noreferrer">
                        <span>Gian hàng Shopee</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Cột Phải: Khung Trưng Bày */}
              {hasHeroVisual && (
                <div className="min-w-0 rounded-[20px] border border-stone-200/90 bg-white/92 p-2 shadow-[0_20px_44px_-20px_rgba(45,33,20,0.18)] backdrop-blur-xs sm:rounded-[22px] sm:p-3 dark:border-stone-800 dark:bg-stone-900/90">
                  {isInitialHeroLoading ? (
                    <div className="space-y-2" aria-hidden="true">
                      <div className="aspect-[1196/518] w-full animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" />
                      <div className="grid grid-cols-3 gap-2">
                        <div className="h-[52px] animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800/50" />
                        <div className="h-[52px] animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800/50" />
                        <div className="h-[52px] animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800/50" />
                      </div>
                    </div>
                  ) : (
                    <>
                      {heroPrimaryStage.hasStageImage && (
                        <button
                          type="button"
                          onClick={() => {
                            if (heroPrimaryStage.stageProduct) {
                              openQuickView(heroPrimaryStage.stageProduct)
                            } else {
                              scrollToCatalog()
                            }
                          }}
                          aria-label={
                            heroPrimaryStage.stageProduct
                              ? `Xem chi tiết ${heroPrimaryStage.stageProduct.cleanTitle || heroPrimaryStage.stageProduct.name}`
                              : `Khám phá danh mục ${brandName}`
                          }
                          className="group/stage relative block w-full cursor-pointer overflow-hidden rounded-2xl border border-stone-200/70 bg-stone-100 text-left focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none dark:border-stone-800 dark:bg-stone-950"
                        >
                          <picture>
                            {heroPrimaryStage.mobileImageUrl && (
                              <source
                                media="(max-width: 640px)"
                                srcSet={heroPrimaryStage.mobileImageUrl}
                              />
                            )}
                            <img
                              src={heroPrimaryStage.imageUrl}
                              alt={heroPrimaryStage.alt}
                              fetchPriority="high"
                              referrerPolicy="no-referrer"
                              className="aspect-[1196/518] w-full object-cover transition-transform duration-500 group-hover/stage:scale-[1.018]"
                            />
                          </picture>
                          {heroPrimaryStage.isProductFallback && heroPrimaryStage.stageProduct ? (
                            <span className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 flex items-center justify-between gap-2 rounded-xl bg-stone-950/75 px-3 py-1.5 text-xs text-white backdrop-blur-xs">
                              <span className="truncate font-bold">
                                {formatHeroShortProductLabel(
                                  heroPrimaryStage.stageProduct.cleanTitle ||
                                    heroPrimaryStage.stageProduct.name,
                                  36
                                )}
                              </span>
                              <span className="shrink-0 font-extrabold whitespace-nowrap tabular-nums text-amber-300">
                                {formatVND(heroPrimaryStage.stageProduct.retailPrice)} · Xem →
                              </span>
                            </span>
                          ) : (
                            <span className="pointer-events-none absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-full bg-stone-950/72 px-2.5 py-1 text-[10.5px] font-semibold text-white opacity-90 backdrop-blur-xs transition group-hover/stage:bg-[#8c4f1e] group-hover/stage:opacity-100">
                              <span>Khám phá bộ sưu tập</span>
                              <ChevronRight className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      )}

                      {heroPrimaryStage.stripProducts.length > 0 && (
                        <div className={cn(heroPrimaryStage.hasStageImage && 'mt-2')}>
                          <div className="mb-1 flex items-center justify-between gap-2 px-1 text-[11px] text-stone-600 dark:text-stone-400">
                            <span className="font-bold text-stone-800 dark:text-stone-200">
                              {heroCopy.showcaseHeading}
                            </span>
                            <button
                              type="button"
                              onClick={scrollToCatalog}
                              className="inline-flex min-h-8 cursor-pointer items-center rounded-lg px-2 font-semibold text-[#8c4f1e] transition hover:bg-amber-50 hover:text-[#6f3d15] hover:underline dark:text-amber-400 dark:hover:bg-stone-800"
                            >
                              {heroCopy.showcaseActionLabel}
                            </button>
                          </div>

                          <div
                            className={cn(
                              'grid gap-1.5 sm:gap-2',
                              heroPrimaryStage.stripProducts.length === 1
                                ? 'grid-cols-1'
                                : heroPrimaryStage.stripProducts.length === 2
                                  ? 'grid-cols-2'
                                  : 'grid-cols-3'
                            )}
                          >
                            {heroPrimaryStage.stripProducts.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => openQuickView(item)}
                                className="group flex min-h-[52px] cursor-pointer items-center gap-1.5 rounded-xl border border-stone-200/85 bg-stone-50/85 p-1.5 text-left transition hover:-translate-y-0.5 hover:border-amber-400/80 hover:bg-white hover:shadow-xs sm:gap-2 sm:p-2 dark:border-stone-800 dark:bg-stone-950/60 dark:hover:border-amber-600/70 dark:hover:bg-stone-950"
                              >
                                {item.image && (
                                  <img
                                    src={item.image}
                                    alt={item.cleanTitle || item.name}
                                    referrerPolicy="no-referrer"
                                    loading="lazy"
                                    className="h-10 w-10 shrink-0 rounded-lg border border-stone-200/70 object-cover transition-transform duration-300 group-hover:scale-105 sm:h-11 sm:w-11 dark:border-stone-800"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="line-clamp-2 text-[10.5px] leading-[1.22] font-bold text-stone-800 group-hover:text-[#8c4f1e] sm:text-[11.5px] dark:text-stone-100 dark:group-hover:text-amber-300">
                                    {formatHeroShortProductLabel(item.cleanTitle || item.name)}
                                  </p>
                                  <p className="mt-0.5 text-[10.5px] font-extrabold whitespace-nowrap tabular-nums text-[#8c4f1e] sm:text-[11px] dark:text-amber-400">
                                    {formatVND(item.retailPrice)}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Tầng Đáy Hero: 3 Cam Kết (thu gọn trên Mobile để rút ngắn quãng cuộn tới sản phẩm) */}
            <div className="mt-4 grid gap-2 border-t border-stone-200/80 pt-3.5 md:mt-6 md:grid-cols-3 md:gap-4 md:pt-5 dark:border-stone-800/90">
              <div className="flex items-start gap-2.5 rounded-2xl border border-stone-200/85 bg-white/80 p-2.5 shadow-2xs backdrop-blur-xs transition hover:bg-white sm:gap-3 sm:p-3.5 dark:border-stone-800 dark:bg-stone-900/75">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100/90 text-[#7c4316] sm:h-9 sm:w-9 dark:bg-amber-950/80 dark:text-amber-300">
                  {heroCopy.craftIcon === 'FLAME' ? (
                    <Flame className="h-4 w-4" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 text-xs">
                  <p className="font-bold text-stone-900 dark:text-stone-100">
                    {heroCopy.craftPromiseTitle}
                  </p>
                  <p className="mt-0.5 line-clamp-1 leading-relaxed text-stone-600 sm:line-clamp-none dark:text-stone-400">
                    {heroCopy.craftPromiseDesc}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-stone-200/85 bg-white/80 p-2.5 shadow-2xs backdrop-blur-xs transition hover:bg-white sm:gap-3 sm:p-3.5 dark:border-stone-800 dark:bg-stone-900/75">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100/90 text-emerald-900 sm:h-9 sm:w-9 dark:bg-emerald-950/80 dark:text-emerald-300">
                  {isWholesaleAllowed ? (
                    <BadgePercent className="h-4 w-4" />
                  ) : (
                    <Truck className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 text-xs">
                  <p className="font-bold text-stone-900 dark:text-stone-100">
                    {heroCopy.wsPromiseTitle}
                  </p>
                  <p className="mt-0.5 line-clamp-1 leading-relaxed text-stone-600 sm:line-clamp-none dark:text-stone-400">
                    {isWholesaleAllowed
                      ? wsTiersSummary
                      : `Miễn phí giao hàng toàn quốc đơn lẻ từ ${formatVND(freeShipThreshold)}.`}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-2xl border border-stone-200/85 bg-white/80 p-2.5 shadow-2xs backdrop-blur-xs transition hover:bg-white sm:gap-3 sm:p-3.5 dark:border-stone-800 dark:bg-stone-900/75">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100/90 text-sky-900 sm:h-9 sm:w-9 dark:bg-sky-950/80 dark:text-sky-300">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div className="min-w-0 text-xs">
                  <p className="font-bold text-stone-900 dark:text-stone-100">
                    {heroCopy.safePromiseTitle}
                  </p>
                  <p className="mt-0.5 line-clamp-1 leading-relaxed text-stone-600 sm:line-clamp-none dark:text-stone-400">
                    {heroCopy.safePromiseDesc}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* MAIN CONTENT */}
      <main
        ref={mainCatalogRef}
        className="mx-auto w-full max-w-7xl flex-1 scroll-mt-24 px-4 py-6 sm:scroll-mt-18 sm:px-6 sm:py-8"
      >
        {/* ==================== TAB 1: DANH MỤC SẢN PHẨM ==================== */}
        {activeTab === 'PRODUCTS' && (
          <div className="space-y-6">
            {/* Banner Trang trí Đồng bộ từ Gian hàng Shopee */}
            {showShopeeBanners &&
              (carouselBanners.length > 0 ||
                spotlightBanners.length > 0 ||
                collectionBannersWithCounts.length > 0) && (
                <section aria-label="Bộ sưu tập & Banner nổi bật" className="space-y-4">
                  {(carouselBanners.length > 0 || spotlightBanners.length > 0) && (
                    <div className="grid items-start gap-4 lg:grid-cols-12">
                      {/* Carousel Banner */}
                      {carouselBanners.length > 0 && (
                        <div
                          onMouseEnter={() => setCarouselPaused(true)}
                          onMouseLeave={() => setCarouselPaused(false)}
                          className={cn(
                            'overflow-hidden rounded-2xl border bg-card shadow-2xs',
                            spotlightBanners.length > 0 ? 'lg:col-span-6' : 'lg:col-span-12'
                          )}
                        >
                          <div className="relative aspect-[2/1] w-full overflow-hidden bg-stone-100 dark:bg-stone-900">
                            {carouselBanners.map((slide, idx) => {
                              const isCurrent = idx === carouselIdx
                              const isClickable = Boolean(
                                slide.targetSku ||
                                  slide.shopeeProductId ||
                                  slide.filterKeyword ||
                                  slide.linkUrl
                              )
                              return (
                                <div
                                  key={slide.id}
                                  aria-hidden={!isCurrent}
                                  className={cn(
                                    'absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none',
                                    isCurrent
                                      ? 'z-10 opacity-100'
                                      : 'pointer-events-none z-0 opacity-0'
                                  )}
                                >
                                  {isClickable ? (
                                    <button
                                      type="button"
                                      onClick={() => handleCarouselSlideClick(slide)}
                                      aria-label={
                                        slide.title ||
                                        `${brandName} — Bộ sưu tập nổi bật #${idx + 1}`
                                      }
                                      className="block h-full w-full cursor-pointer text-left"
                                    >
                                      <picture>
                                        {slide.mobileImageUrl && (
                                          <source
                                            media="(max-width: 640px)"
                                            srcSet={slide.mobileImageUrl}
                                          />
                                        )}
                                        <img
                                          src={slide.imageUrl}
                                          alt={
                                            slide.title ||
                                            `${brandName} — Bộ sưu tập nổi bật #${idx + 1}`
                                          }
                                          referrerPolicy="no-referrer"
                                          className="h-full w-full object-cover"
                                        />
                                      </picture>
                                    </button>
                                  ) : (
                                    <picture>
                                      {slide.mobileImageUrl && (
                                        <source
                                          media="(max-width: 640px)"
                                          srcSet={slide.mobileImageUrl}
                                        />
                                      )}
                                      <img
                                        src={slide.imageUrl}
                                        alt={
                                          slide.title ||
                                          `${brandName} — Bộ sưu tập nổi bật #${idx + 1}`
                                        }
                                        referrerPolicy="no-referrer"
                                        className="h-full w-full object-cover"
                                      />
                                    </picture>
                                  )}
                                </div>
                              )
                            })}

                            {carouselBanners.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  aria-label="Banner trước"
                                  onClick={() =>
                                    setCarouselIdx(
                                      (prev) =>
                                        (prev - 1 + carouselBanners.length) %
                                        carouselBanners.length
                                    )
                                  }
                                  className="absolute top-1/2 left-2.5 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/40 text-white backdrop-blur-xs transition hover:bg-black/65"
                                >
                                  <ChevronLeft className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  aria-label="Banner tiếp theo"
                                  onClick={() =>
                                    setCarouselIdx(
                                      (prev) => (prev + 1) % carouselBanners.length
                                    )
                                  }
                                  className="absolute top-1/2 right-2.5 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/40 text-white backdrop-blur-xs transition hover:bg-black/65"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>

                          <div className="flex min-h-[38px] items-center justify-between gap-2 border-t bg-card px-3.5 text-[11px] text-muted-foreground">
                            <span className="truncate font-medium">
                              {carouselBanners[carouselIdx]?.title ||
                                `Bộ sưu tập Thủ công ${brandName}`}{' '}
                              ({carouselIdx + 1}/{carouselBanners.length})
                            </span>
                            <div className="flex shrink-0 items-center">
                              {carouselBanners.map((s, idx) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  aria-label={`Chuyển tới banner ${idx + 1}`}
                                  onClick={() => setCarouselIdx(idx)}
                                  className="flex h-8 w-8 items-center justify-center"
                                >
                                  <span
                                    className={cn(
                                      'block h-2 rounded-full transition-all',
                                      idx === carouselIdx
                                        ? 'w-5 bg-[#8c4f1e] dark:bg-amber-400'
                                        : 'w-2 bg-stone-300 dark:bg-stone-700'
                                    )}
                                  />
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Spotlight Hotspot Banner */}
                      {spotlightBanners.map((sb) => (
                        <div
                          key={sb.id}
                          className={cn(
                            'overflow-hidden rounded-2xl border bg-card shadow-2xs',
                            (carouselBanners.length > 0 ? 1 : 0) + spotlightBanners.length > 1
                              ? 'lg:col-span-6'
                              : 'lg:col-span-12'
                          )}
                        >
                          <div
                            className="relative w-full overflow-hidden bg-stone-100 dark:bg-stone-900"
                            style={{ aspectRatio: String(sb.aspectRatio || 1.796) }}
                          >
                            <picture>
                              {sb.mobileImageUrl && (
                                <source
                                  media="(max-width: 640px)"
                                  srcSet={sb.mobileImageUrl}
                                />
                              )}
                              <img
                                src={sb.imageUrl}
                                alt={sb.title || `${brandName} — Sản phẩm tiêu điểm`}
                                referrerPolicy="no-referrer"
                                className="h-full w-full object-cover"
                              />
                            </picture>

                            {sb.hotspots.map((hs, hIdx) => {
                              const matchedProd = resolveProductFromBannerRef(
                                hs.targetSku,
                                hs.shopeeProductId
                              )
                              const labelText =
                                matchedProd?.cleanTitle ||
                                hs.label ||
                                `Xem sản phẩm nổi bật #${hIdx + 1}`
                              return (
                                <button
                                  key={hs.id}
                                  type="button"
                                  title={labelText}
                                  aria-label={labelText}
                                  onClick={() => {
                                    if (matchedProd) {
                                      openQuickView(matchedProd)
                                      return
                                    }
                                    if (hs.linkUrl) {
                                      window.open(hs.linkUrl, '_blank', 'noopener,noreferrer')
                                    }
                                  }}
                                  style={{
                                    left: `${hs.x}%`,
                                    top: `${hs.y}%`,
                                    width: `${hs.w}%`,
                                    height: `${hs.h}%`,
                                  }}
                                  className="group/hs absolute z-10 cursor-pointer transition-all hover:bg-black/5 hover:ring-2 hover:ring-amber-300/90 hover:ring-inset focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:outline-none"
                                >
                                  <span className="pointer-events-none absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full bg-stone-950/78 px-1.5 py-0.5 text-[9.5px] font-semibold whitespace-nowrap tabular-nums text-white opacity-92 shadow-sm backdrop-blur-xs transition group-hover/hs:scale-105 group-hover/hs:bg-[#8c4f1e] group-hover/hs:opacity-100 sm:right-2 sm:bottom-2 sm:px-2.5 sm:py-1 sm:text-[10.5px]">
                                    <span>
                                      {matchedProd
                                        ? formatVND(matchedProd.retailPrice)
                                        : 'Xem SP'}
                                    </span>
                                    <Eye className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" />
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Thẻ Bộ Sưu Tập: nếu 0 SP khớp CMS thì chuyển thành mở Shopee (hoặc đã tự ẩn nếu không có shopeeUrl) */}
                  {collectionBannersWithCounts.length > 0 && (
                    <div
                      className={cn(
                        'grid grid-cols-2 gap-2.5 sm:gap-3',
                        collectionBannersWithCounts.length >= 4
                          ? 'sm:grid-cols-4'
                          : collectionBannersWithCounts.length === 3
                            ? 'sm:grid-cols-3'
                            : 'sm:grid-cols-2'
                      )}
                    >
                      {collectionBannersWithCounts.map(({ col, matchedCount }) => {
                        const isSelected = selectedCollectionId === col.id && matchedCount > 0
                        if (matchedCount === 0 && col.shopeeUrl) {
                          return (
                            <a
                              key={col.id}
                              href={col.shopeeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group flex flex-col items-start gap-2 rounded-2xl border border-border/80 bg-card p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-sm min-[420px]:flex-row min-[420px]:items-center sm:gap-3"
                            >
                              <img
                                src={col.imageUrl}
                                alt={col.name}
                                referrerPolicy="no-referrer"
                                loading="lazy"
                                className="h-12 w-12 shrink-0 rounded-xl border border-stone-200/70 object-cover transition-transform duration-300 group-hover:scale-105 min-[420px]:h-14 min-[420px]:w-14 sm:h-16 sm:w-16 dark:border-stone-800"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="line-clamp-2 text-xs leading-tight font-extrabold text-foreground sm:text-sm">
                                  {col.name}
                                </p>
                                <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium text-[#8c4f1e] dark:text-amber-400">
                                  <span>Xem trên Shopee</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </p>
                              </div>
                            </a>
                          )
                        }

                        return (
                          <button
                            key={col.id}
                            type="button"
                            onClick={() => {
                              setSelectedCat('ALL')
                              setSelectedCollectionId((prev) =>
                                prev === col.id ? 'ALL' : col.id
                              )
                            }}
                            className={cn(
                              'group flex flex-col items-start gap-2 rounded-2xl border p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm min-[420px]:flex-row min-[420px]:items-center sm:gap-3',
                              isSelected
                                ? 'border-[#8c4f1e] bg-amber-50/80 ring-1 ring-[#8c4f1e]/40 dark:border-amber-400 dark:bg-amber-950/35'
                                : 'border-border/80 bg-card hover:border-amber-300'
                            )}
                          >
                            <img
                              src={col.imageUrl}
                              alt={col.name}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="h-12 w-12 shrink-0 rounded-xl border border-stone-200/70 object-cover transition-transform duration-300 group-hover:scale-105 min-[420px]:h-14 min-[420px]:w-14 sm:h-16 sm:w-16 dark:border-stone-800"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-xs leading-tight font-extrabold text-foreground sm:text-sm">
                                {col.name}
                              </p>
                              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                                {isSelected
                                  ? 'Đang lọc · Bỏ chọn'
                                  : `${matchedCount} mẫu tại xưởng`}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              )}

            {/* Thanh công cụ Tìm kiếm + Xem Giá Lẻ/Sỉ + Lọc Danh mục (chỉ hiện dải pill khi > 1 danh mục hoặc đang lọc bộ sưu tập) */}
            {!isStorefrontClosed && (
              <div className="flex flex-col gap-3.5 rounded-2xl border bg-card p-3.5 shadow-2xs sm:p-4">
                <p className="sr-only" role="status" aria-live="polite">
                  Đang hiển thị {filteredProducts.length} sản phẩm
                </p>
                <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                  <form
                    role="search"
                    onSubmit={(e) => e.preventDefault()}
                    className="relative w-full lg:max-w-md"
                  >
                    <Label htmlFor="store-search-input" className="sr-only">
                      Tìm kiếm sản phẩm
                    </Label>
                    <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      id="store-search-input"
                      name="q"
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Tìm tên sản phẩm, màu hoặc mã SKU..."
                      aria-label="Tìm kiếm sản phẩm"
                      className={cn('h-10 pl-9', search && 'pr-10')}
                    />
                    <button type="submit" className="sr-only">
                      Tìm kiếm sản phẩm
                    </button>
                    {search && (
                      <button
                        type="button"
                        aria-label="Xóa từ khóa tìm kiếm"
                        onClick={() => {
                          setSearch('')
                          searchInputRef.current?.focus()
                        }}
                        className="absolute top-1/2 right-1.5 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </form>

                  <div className="flex flex-wrap items-center gap-2">
                    {isWholesaleAllowed && (
                      <div className="inline-flex rounded-xl border bg-muted/50 p-1">
                        <button
                          type="button"
                          onClick={() => setPriceViewMode('RETAIL')}
                          className={cn(
                            'min-h-9 rounded-lg px-3 text-xs font-bold transition-colors',
                            priceViewMode === 'RETAIL'
                              ? 'bg-card text-foreground shadow-2xs'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Giá Bán Lẻ
                        </button>
                        <button
                          type="button"
                          onClick={() => setPriceViewMode('WHOLESALE')}
                          className={cn(
                            'min-h-9 rounded-lg px-3 text-xs font-bold transition-colors',
                            priceViewMode === 'WHOLESALE'
                              ? 'bg-[#8c4f1e] text-white shadow-2xs dark:bg-amber-400 dark:text-stone-950'
                              : 'text-[#7c4316] hover:text-stone-900 dark:text-amber-300'
                          )}
                        >
                          Hiển thị Giá Sỉ
                        </button>
                      </div>
                    )}

                    <Label htmlFor="store-sort-select" className="sr-only">
                      Sắp xếp sản phẩm theo giá
                    </Label>
                    <select
                      id="store-sort-select"
                      name="sort"
                      aria-label="Sắp xếp theo giá"
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                      className="h-10 rounded-xl border bg-background px-3 text-xs font-medium text-foreground"
                    >
                      <option value="DEFAULT">Sắp xếp: Đề xuất</option>
                      <option value="PRICE_ASC">Giá: Thấp đến Cao</option>
                      <option value="PRICE_DESC">Giá: Cao đến Thấp</option>
                    </select>
                  </div>
                </div>

                {(categories.length > 1 || Boolean(activeCollectionBanner)) && (
                  <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCat('ALL')
                        setSelectedCollectionId('ALL')
                      }}
                      className={cn(
                        'inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                        selectedCat === 'ALL' && !activeCollectionBanner
                          ? 'border-stone-900 bg-stone-900 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-stone-950'
                          : 'bg-background text-foreground hover:bg-muted'
                      )}
                    >
                      Tất cả ({products.length})
                    </button>
                    {activeCollectionBanner && (
                      <div className="inline-flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedCollectionId('ALL')}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#8c4f1e] bg-[#8c4f1e] px-3.5 text-xs font-bold text-white dark:border-amber-400 dark:bg-amber-400 dark:text-stone-950"
                        >
                          <span>Bộ sưu tập: {activeCollectionBanner.name}</span>
                          <X className="h-3.5 w-3.5" />
                        </button>
                        {activeCollectionBanner.shopeeUrl && (
                          <a
                            href={activeCollectionBanner.shopeeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-9 items-center gap-1 rounded-full border px-3 text-[11px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <span>Xem trên Shopee</span>
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    )}
                    {categories.length > 1 &&
                      categories.map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setSelectedCat(cat.id)}
                          className={cn(
                            'inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                            selectedCat === cat.id
                              ? 'border-stone-900 bg-stone-900 text-white dark:border-amber-400 dark:bg-amber-400 dark:text-stone-950'
                              : 'bg-background text-foreground hover:bg-muted'
                          )}
                        >
                          {cat.name}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            )}

            {loading ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-80 animate-pulse rounded-2xl border bg-muted/40" />
                ))}
              </div>
            ) : storeData?.storefrontClosed || cfg?.enabled === false ? (
              <div className="rounded-2xl border border-amber-300/80 bg-amber-50/70 px-6 py-14 text-center dark:border-amber-900 dark:bg-amber-950/30">
                <Store className="mx-auto mb-3 h-10 w-10 text-[#8c4f1e] dark:text-amber-400" />
                <h2 className="text-base font-bold text-foreground">
                  Website hiện đang tạm ngưng nhận đơn trực tuyến để cập nhật danh mục
                </h2>
                <p className="mx-auto mt-1.5 max-w-lg text-xs text-muted-foreground">
                  Quý khách vẫn có thể tra cứu trạng thái đơn hàng đã đặt hoặc gửi tin nhắn liên hệ trực tiếp tới {brandName} để được hỗ trợ ngay.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => selectNavTab('CONTACT')}
                    className="bg-[#8c4f1e] text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950"
                  >
                    Liên hệ Cửa hàng
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => selectNavTab('TRACKING')}
                  >
                    Tra cứu đơn hàng
                  </Button>
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-14 text-center">
                <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-base font-semibold">Không tìm thấy sản phẩm phù hợp</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hãy thử từ khóa khác hoặc xem lại toàn bộ bộ sưu tập.
                </p>
                {(search || selectedCollectionId !== 'ALL' || selectedCat !== 'ALL') && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => {
                      setSearch('')
                      setSelectedCat('ALL')
                      setSelectedCollectionId('ALL')
                    }}
                  >
                    Hiển thị toàn bộ {products.length} mẫu
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredProducts.map((p) => {
                  const firstWs = p.wholesalePrices[0]
                  const bestWs = p.wholesalePrices[p.wholesalePrices.length - 1]
                  const cardTitle =
                    formatStorefrontDisplayTitle(p.cleanTitle || p.name, p.variantLabel) ||
                    p.cleanTitle
                  return (
                    <Card
                      key={p.id}
                      className="group flex flex-col gap-0 overflow-hidden border-border/80 py-0 transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <button
                        type="button"
                        onClick={() => openQuickView(p)}
                        className="relative flex aspect-square w-full cursor-pointer items-center justify-center overflow-hidden bg-stone-100/70 p-3 text-left dark:bg-stone-900/50"
                      >
                        {p.image ? (
                          <img
                            src={p.image}
                            alt={p.name}
                            className="h-full w-full rounded-xl object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        ) : (
                          <ProductAvatar name={p.name} className="h-20 w-20 text-xl" />
                        )}
                        {p.variantLabel && (
                          <Badge className="absolute top-3 left-3 bg-stone-900/88 text-[10px] font-semibold text-white backdrop-blur-xs">
                            {p.variantLabel}
                          </Badge>
                        )}
                        {bestWs && (
                          <Badge className="absolute top-3 right-3 border-amber-300 bg-amber-400 text-[10px] font-bold whitespace-nowrap tabular-nums text-stone-950">
                            Sỉ từ {formatVND(bestWs.unitPrice)}
                          </Badge>
                        )}
                      </button>

                      <CardContent className="flex flex-1 flex-col justify-between gap-3 p-4">
                        <div className="space-y-1.5">
                          {/* Ẩn mã SKU nội bộ khỏi mặt ngoài thẻ để nhãn tồn kho nằm gọn trên 1 dòng */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                              {p.stockLabel}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => openQuickView(p)}
                            className="block w-full cursor-pointer text-left"
                          >
                            <h2 className="line-clamp-2 text-sm leading-snug font-bold text-foreground transition-colors hover:text-[#8c4f1e] dark:hover:text-amber-300">
                              {cardTitle}
                            </h2>
                          </button>
                          {p.variantLabel && (
                            <p className="text-xs font-semibold text-[#7c4316] dark:text-amber-300">
                              Phân loại: {p.variantLabel}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2.5 border-t pt-3">
                          {priceViewMode === 'WHOLESALE' && p.wholesalePrices.length > 0 ? (
                            <div className="space-y-1 rounded-xl border border-amber-200/80 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900/60 dark:bg-amber-950/30">
                              <div className="flex justify-between gap-2 text-muted-foreground">
                                <span>Giá lẻ:</span>
                                <span className="line-through whitespace-nowrap tabular-nums">
                                  {formatVND(p.retailPrice)}
                                </span>
                              </div>
                              {p.wholesalePrices.map((wp) => (
                                <div
                                  key={wp.tierId}
                                  className="flex justify-between gap-2 font-semibold"
                                >
                                  <span>Từ {wp.minQty} SP ({wp.badge}):</span>
                                  <span className="font-bold whitespace-nowrap tabular-nums text-[#7c4316] dark:text-amber-300">
                                    {formatVND(wp.unitPrice)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-base font-extrabold whitespace-nowrap tabular-nums text-[#8c4f1e] dark:text-amber-400">
                                  {formatVND(p.retailPrice)}
                                </p>
                                <span className="text-[11px] text-muted-foreground">
                                  / {p.unit}
                                </span>
                              </div>
                              {firstWs && (
                                <p className="mt-0.5 text-[11px] text-[#7c4316] dark:text-amber-300">
                                  Giá sỉ từ {firstWs.minQty} SP:{' '}
                                  <strong className="whitespace-nowrap tabular-nums">
                                    {formatVND(firstWs.unitPrice)}
                                  </strong>
                                </p>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-5 gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => openQuickView(p)}
                              className="col-span-2 h-10 gap-1 px-2 text-xs font-semibold"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              Chi tiết
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!p.availableToOrder}
                              onClick={() =>
                                addToCart(
                                  p,
                                  priceViewMode === 'WHOLESALE' && firstWs ? firstWs.minQty : 1
                                )
                              }
                              className="col-span-3 h-10 gap-1 bg-stone-900 px-2.5 text-xs font-bold text-white hover:bg-[#8c4f1e] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {!p.availableToOrder
                                ? 'Tạm hết hàng'
                                : priceViewMode === 'WHOLESALE' && firstWs
                                  ? `Thêm ${firstWs.minQty} SP`
                                  : 'Chọn mua'}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 2: BẢNG GIÁ SỈ & CHÍNH SÁCH ĐẠI LÝ ==================== */}
        {activeTab === 'WHOLESALE' && isWholesaleAllowed && (
          <div className="space-y-6 sm:space-y-8">
            <div className="grid gap-3.5 md:grid-cols-3">
              {wholesaleTiers.map((tier, idx) => (
                <Card
                  key={tier.id}
                  className={cn(
                    'border-2',
                    idx === 1
                      ? 'border-[#8c4f1e] bg-amber-50/40 shadow-sm dark:border-amber-500 dark:bg-amber-950/20'
                      : 'border-border'
                  )}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <Badge className="bg-[#8c4f1e] text-xs font-bold text-white dark:bg-amber-400 dark:text-stone-950">
                        Chiết khấu {tier.badge}
                      </Badge>
                      <span className="text-xs font-semibold text-muted-foreground">
                        Tối thiểu {tier.minQty} SP
                      </span>
                    </div>
                    <CardTitle className="pt-1 text-base">{tier.label}</CardTitle>
                    <CardDescription className="text-xs">{tier.description}</CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </div>

            <div className="grid gap-6 lg:grid-cols-12">
              {/* Bảng giá sỉ Responsive: Thẻ Mobile (< 640px) & Bảng Desktop (>= 640px) */}
              <Card className="lg:col-span-7">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
                    Bảng Báo Giá Sỉ Niêm Yết Theo Từng Mã Sản Phẩm ({products.length} mã)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {cfg?.wholesalePolicyNote}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* Mobile Wholesale Cards (< 640px) — chống bóp nát chữ & gãy ký hiệu ₫ */}
                  <div className="space-y-3 sm:hidden">
                    {products.map((p) => {
                      const cardTitle =
                        formatStorefrontDisplayTitle(p.cleanTitle || p.name, p.variantLabel) ||
                        p.cleanTitle
                      return (
                        <div
                          key={p.id}
                          className="space-y-2.5 rounded-2xl border bg-card p-3 shadow-2xs"
                        >
                          <div className="flex items-start gap-2.5">
                            {p.image ? (
                              <img
                                src={p.image}
                                alt={p.name}
                                loading="lazy"
                                className="h-12 w-12 shrink-0 rounded-xl border object-cover"
                              />
                            ) : (
                              <ProductAvatar name={p.name} className="h-12 w-12 shrink-0 text-sm" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-xs leading-snug font-bold text-foreground">
                                {cardTitle}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                                {p.variantLabel && (
                                  <span className="font-semibold text-[#7c4316] dark:text-amber-300">
                                    {p.variantLabel}
                                  </span>
                                )}
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {p.sku}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-amber-200/70 bg-amber-50/45 p-2 text-center dark:border-amber-900/60 dark:bg-amber-950/25">
                            {wholesaleTiers.slice(0, 3).map((t) => {
                              const wp =
                                p.wholesalePrices.find((x) => x.tierId === t.id)?.unitPrice ??
                                computeDiscountedPriceClient(p.retailPrice, t.discountPercent)
                              return (
                                <div key={t.id} className="min-w-0">
                                  <p className="text-[10px] font-semibold text-muted-foreground">
                                    ≥{t.minQty} ({t.badge})
                                  </p>
                                  <p className="mt-0.5 text-xs font-extrabold whitespace-nowrap tabular-nums text-[#7c4316] dark:text-amber-300">
                                    {formatVND(wp)}
                                  </p>
                                </div>
                              )
                            })}
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-[11px] text-muted-foreground">
                              Giá lẻ:{' '}
                              <span className="line-through whitespace-nowrap tabular-nums">
                                {formatVND(p.retailPrice)}
                              </span>
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              disabled={!p.availableToOrder}
                              onClick={() => addToCart(p, minWholesaleQty)}
                              className="min-h-[38px] gap-1 bg-stone-900 px-3.5 text-xs font-bold text-white hover:bg-[#8c4f1e] dark:bg-amber-400 dark:text-stone-950"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {p.availableToOrder ? `Thêm ${minWholesaleQty} ${p.unit}` : 'Tạm hết'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop/Tablet Matrix Table (>= 640px) */}
                  <div className="hidden overflow-x-auto rounded-xl border sm:block">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-muted/60 font-bold text-foreground">
                        <tr>
                          <th className="px-3 py-2.5">Sản phẩm / Phân loại</th>
                          <th className="px-3 py-2.5 text-right whitespace-nowrap">Giá lẻ</th>
                          {wholesaleTiers.map((t) => (
                            <th
                              key={t.id}
                              className="px-3 py-2.5 text-right whitespace-nowrap text-[#7c4316] dark:text-amber-300"
                            >
                              Từ {t.minQty} SP ({t.badge})
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-center whitespace-nowrap">Chọn sỉ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {products.map((p) => {
                          const rowTitle =
                            formatStorefrontDisplayTitle(
                              p.cleanTitle || p.name,
                              p.variantLabel
                            ) || p.cleanTitle
                          return (
                            <tr key={p.id} className="hover:bg-muted/30">
                              <td className="px-3 py-2.5">
                                <p className="font-mono text-[10px] text-muted-foreground">
                                  {p.sku}
                                </p>
                                <p className="font-semibold text-foreground">{rowTitle}</p>
                                {p.variantLabel && (
                                  <p className="text-[11px] font-medium text-[#7c4316] dark:text-amber-300">
                                    Phân loại: {p.variantLabel}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-medium whitespace-nowrap tabular-nums text-muted-foreground">
                                {formatVND(p.retailPrice)}
                              </td>
                              {wholesaleTiers.map((t) => {
                                const wp =
                                  p.wholesalePrices.find((x) => x.tierId === t.id)?.unitPrice ??
                                  computeDiscountedPriceClient(p.retailPrice, t.discountPercent)
                                return (
                                  <td
                                    key={t.id}
                                    className="px-3 py-2.5 text-right font-bold whitespace-nowrap tabular-nums text-foreground"
                                  >
                                    {formatVND(wp)}
                                  </td>
                                )
                              })}
                              <td className="px-3 py-2.5 text-center">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={!p.availableToOrder}
                                  onClick={() => addToCart(p, minWholesaleQty)}
                                  className="min-h-[36px] px-2.5 text-[11px] font-semibold whitespace-nowrap"
                                >
                                  {p.availableToOrder ? `+${minWholesaleQty}` : 'Tạm hết'}
                                </Button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Form Đăng ký Báo giá sỉ & Gia công OEM */}
              <Card className="border-amber-300/80 lg:col-span-5 dark:border-amber-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Calculator className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
                    Đăng Ký Nhận Báo Giá Sỉ &amp; Gia Công Quà Tặng (OEM)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {cfg?.oemCustomNote}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {wholesaleSubmittedCode ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/40"
                    >
                      <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
                      <p className="text-base font-bold text-emerald-950 dark:text-emerald-200">
                        Đã tiếp nhận yêu cầu sỉ ({wholesaleSubmittedCode})
                      </p>
                      <p className="text-xs text-emerald-800 dark:text-emerald-300">
                        Bộ phận Sỉ &amp; Xưởng {brandName} sẽ liên hệ Zalo/SĐT của bạn kèm catalog &amp; chính sách mẫu thử trong 15–30 phút.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setWholesaleSubmittedCode(null)}
                      >
                        Gửi yêu cầu khác
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleWholesaleSubmit} className="space-y-3">
                      <div className="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-950/30">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Sản lượng dự kiến mỗi đơn:</span>
                          <span className="font-bold whitespace-nowrap tabular-nums text-[#7c4316] dark:text-amber-300">
                            {estimatedQtyNum} sản phẩm
                          </span>
                        </div>
                        {simulatedTier && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Mức áp dụng dự kiến:{' '}
                            <strong className="text-foreground">
                              {simulatedTier.label} (Chiết khấu {simulatedTier.discountPercent}%)
                            </strong>
                          </p>
                        )}
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="ws-name">Họ và tên người liên hệ *</Label>
                          <Input
                            id="ws-name"
                            name="wsName"
                            autoComplete="name"
                            value={wsName}
                            onChange={(e) => setWsName(e.target.value)}
                            placeholder="Chị Minh Anh"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ws-phone">Số điện thoại / Zalo *</Label>
                          <Input
                            id="ws-phone"
                            name="wsPhone"
                            type="tel"
                            inputMode="tel"
                            autoComplete="tel"
                            value={wsPhone}
                            onChange={(e) => setWsPhone(e.target.value)}
                            placeholder="VD: 09xx xxx xxx"
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ws-shop">Tên Shop / Spa / Doanh nghiệp</Label>
                          <Input
                            id="ws-shop"
                            name="companyOrShopName"
                            autoComplete="organization"
                            value={wsShopName}
                            onChange={(e) => setWsShopName(e.target.value)}
                            placeholder="An Nhiên Spa / Quà tặng ABC..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ws-qty">Số lượng sỉ dự kiến (SP)</Label>
                          <Input
                            id="ws-qty"
                            name="estimatedQty"
                            type="number"
                            inputMode="numeric"
                            min={minWholesaleQty}
                            value={wsEstimatedQty}
                            onChange={(e) => setWsEstimatedQty(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-addr">Tỉnh/Thành phố nhận hàng</Label>
                          <Input
                            id="ws-addr"
                            name="wsAddress"
                            autoComplete="address-level1"
                            value={wsAddress}
                            onChange={(e) => setWsAddress(e.target.value)}
                            placeholder="TP.HCM, Hà Nội, Đà Nẵng..."
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-email">Email nhận bảng giá PDF/Excel (tùy chọn)</Label>
                          <Input
                            id="ws-email"
                            name="wsEmail"
                            type="email"
                            inputMode="email"
                            autoComplete="email"
                            value={wsEmail}
                            onChange={(e) => setWsEmail(e.target.value)}
                            placeholder="purchasing@company.vn"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-note">Ghi chú mẫu quan tâm / Yêu cầu in logo OEM</Label>
                          <Textarea
                            id="ws-note"
                            name="wsNote"
                            rows={3}
                            value={wsNote}
                            onChange={(e) => setWsNote(e.target.value)}
                            placeholder="VD: Quan tâm 50 hộp nến bơ Tealight 50 viên + 50 chân nến Hoa Sen trắng làm quà tri ân..."
                          />
                        </div>
                      </div>

                      <Button
                        type="submit"
                        disabled={submittingWholesale}
                        className="h-11 w-full gap-2 bg-[#8c4f1e] text-xs font-bold text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                      >
                        <Send className="h-4 w-4" />
                        {submittingWholesale
                          ? 'Đang gửi yêu cầu báo giá...'
                          : 'Gửi Yêu Cầu Nhận Bảng Giá Sỉ Chính Thức'}
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ==================== TAB 3: LIÊN HỆ & XƯỞNG SẢN XUẤT ==================== */}
        {activeTab === 'CONTACT' && (
          <div className="grid gap-6 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
                    Thông Tin Liên Hệ Chính Thức — {brandName}
                  </CardTitle>
                  <CardDescription>
                    Kết nối trực tiếp với Xưởng sản xuất &amp; Bộ phận CSKH lẻ / sỉ
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3.5 text-sm">
                  {contact?.hotline && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Phone className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">Hotline Tư vấn &amp; Đặt sỉ nhanh</p>
                        <a
                          href={`tel:${contact.hotline.replace(/\s+/g, '')}`}
                          className="text-base font-extrabold text-foreground hover:text-[#8c4f1e]"
                        >
                          {contact.hotline}
                        </a>
                      </div>
                    </div>
                  )}

                  {contact?.zaloUrl && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <MessageCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-sky-700 dark:text-sky-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">Zalo Chăm sóc Khách hàng &amp; Báo Sỉ</p>
                        <a
                          href={contact.zaloUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-[#8c4f1e] hover:underline dark:text-amber-400"
                        >
                          <span>
                            Nhắn Zalo trực tiếp
                            {contact.zaloPhone || contact.hotline
                              ? ` (${contact.zaloPhone || contact.hotline})`
                              : ''}
                          </span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  )}

                  {!contact?.hotline && !contact?.zaloUrl && (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3.5 text-xs text-stone-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-stone-200">
                      <MessageCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                      <div>
                        <p className="font-bold">Tiếp nhận tư vấn trực tuyến 24/7 qua Hộp thư CMS</p>
                        <p className="mt-0.5 leading-relaxed text-muted-foreground">
                          Để lại SĐT/Zalo và nội dung cần hỗ trợ ở biểu mẫu bên cạnh — bộ phận CSKH &amp; Xưởng {brandName} nhận tin tức thì và phản hồi trực tiếp cho bạn.
                        </p>
                      </div>
                    </div>
                  )}

                  {contact?.shopeeUrl && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <ShoppingBag className="mt-0.5 h-4.5 w-4.5 shrink-0 text-orange-600" />
                      <div>
                        <p className="text-xs text-muted-foreground">Gian hàng TMĐT Chính hãng</p>
                        <a
                          href={contact.shopeeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-orange-700 hover:underline dark:text-orange-400"
                        >
                          <span>{contact.shopeeUrl}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  )}

                  {contact?.email && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Mail className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-700 dark:text-emerald-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">Email Hợp tác &amp; Hóa đơn Doanh nghiệp</p>
                        <a
                          href={`mailto:${contact.email}`}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {contact.email}
                        </a>
                      </div>
                    </div>
                  )}

                  {contact?.address && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <MapPin className="mt-0.5 h-4.5 w-4.5 shrink-0 text-rose-700 dark:text-rose-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">Địa chỉ Xưởng &amp; Kho Trung Tâm</p>
                        <p className="font-medium text-foreground">{contact.address}</p>
                      </div>
                    </div>
                  )}

                  {contact?.workingHours && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Clock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                      <div>
                        <p className="text-xs text-muted-foreground">Khung giờ hỗ trợ</p>
                        <p className="font-medium text-foreground">{contact.workingHours}</p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="lg:col-span-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Send className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
                    Gửi Tin Nhắn Tư Vấn Trực Tuyến
                  </CardTitle>
                  <CardDescription>
                    Mọi câu hỏi về sản phẩm, phối màu thủ công hoặc đặt quà tặng sự kiện sẽ chuyển thẳng vào Hộp thư CSKH của {brandName}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {contactSubmittedCode && (
                    <div
                      role="status"
                      aria-live="polite"
                      className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
                    >
                      Đã tiếp nhận tin nhắn mã <strong>{contactSubmittedCode}</strong>. Cảm ơn bạn đã liên hệ {brandName}!
                    </div>
                  )}
                  <form onSubmit={handleContactSubmit} className="space-y-3.5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="ct-name">Họ và tên *</Label>
                        <Input
                          id="ct-name"
                          name="contactName"
                          autoComplete="name"
                          value={ctName}
                          onChange={(e) => setCtName(e.target.value)}
                          placeholder="Nguyễn Thanh Hà"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="ct-phone">Số điện thoại / Zalo *</Label>
                        <Input
                          id="ct-phone"
                          name="contactPhone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          value={ctPhone}
                          onChange={(e) => setCtPhone(e.target.value)}
                          placeholder="VD: 09xx xxx xxx"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ct-email">Email (tùy chọn)</Label>
                      <Input
                        id="ct-email"
                        name="contactEmail"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        value={ctEmail}
                        onChange={(e) => setCtEmail(e.target.value)}
                        placeholder="ban@email.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ct-msg">Nội dung cần hỗ trợ *</Label>
                      <Textarea
                        id="ct-msg"
                        name="contactMessage"
                        rows={4}
                        value={ctMessage}
                        onChange={(e) => setCtMessage(e.target.value)}
                        placeholder="Nhập câu hỏi hoặc yêu cầu tư vấn của bạn..."
                        required
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={submittingContact}
                      className="h-11 w-full gap-2 bg-stone-900 text-xs font-bold text-white hover:bg-[#8c4f1e] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                    >
                      <Send className="h-4 w-4" />
                      {submittingContact ? 'Đang gửi tin nhắn...' : 'Gửi Liên Hệ Tới Cửa Hàng'}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* ==================== TAB 4: TRA CỨU ĐƠN HÀNG / YÊU CẦU BÁO GIÁ ==================== */}
        {activeTab === 'TRACKING' && (
          <div className="mx-auto max-w-xl">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileSearch className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
                  Tra Cứu Trạng Thái Đơn Hàng &amp; Yêu Cầu Báo Giá Sỉ
                </CardTitle>
                <CardDescription className="text-xs">
                  Nhập mã đơn hàng (VD: BM-WEB-... hoặc DH...) kèm số điện thoại đặt hàng để kiểm tra tiến độ xử lý.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <form onSubmit={handleLookup} className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="lk-code">Mã đơn hàng / Mã yêu cầu sỉ *</Label>
                    <Input
                      id="lk-code"
                      name="lookupCode"
                      autoComplete="off"
                      value={lookupCode}
                      onChange={(e) => setLookupCode(e.target.value)}
                      placeholder="VD: BM-WEB-261127-1234"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="lk-phone">Số điện thoại người nhận (hoặc 4 số cuối) *</Label>
                    <Input
                      id="lk-phone"
                      name="lookupPhone"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      value={lookupPhone}
                      onChange={(e) => setLookupPhone(e.target.value)}
                      placeholder="Nhập SĐT đặt hàng hoặc 4 số cuối"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={lookupLoading}
                    className="h-11 w-full bg-stone-900 text-xs font-bold text-white hover:bg-[#8c4f1e] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                  >
                    {lookupLoading ? 'Đang kiểm tra...' : 'Tra cứu ngay'}
                  </Button>
                </form>

                {lookupError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                  >
                    {lookupError}
                  </div>
                )}

                {lookupResult && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs dark:border-emerald-900 dark:bg-emerald-950/30"
                  >
                    <p className="font-mono text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      Mã: {lookupResult.code}
                    </p>
                    {lookupResult.title && <p className="font-medium">{lookupResult.title}</p>}
                    <p>
                      Trạng thái:{' '}
                      <Badge variant="outline" className="font-semibold">
                        {formatStorefrontLookupStatusLabel(lookupResult.status)}
                      </Badge>
                    </p>
                    {typeof lookupResult.total === 'number' && (
                      <p>
                        Tổng thanh toán:{' '}
                        <strong className="whitespace-nowrap tabular-nums">
                          {formatVND(lookupResult.total)}
                        </strong>
                      </p>
                    )}
                    {lookupResult.tierApplied && (
                      <p>Mức chiết khấu sỉ: {lookupResult.tierApplied}</p>
                    )}
                    {lookupResult.shipment?.trackingCode && (
                      <p>
                        Vận chuyển:{' '}
                        <strong>{lookupResult.shipment.carrier || 'ĐVVC'}</strong> · Mã vận đơn:{' '}
                        <strong className="font-mono">{lookupResult.shipment.trackingCode}</strong>
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>

      {/* Footer thương hiệu */}
      <footer className="border-t bg-card py-8 text-xs text-muted-foreground">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 sm:grid-cols-3 sm:px-6">
          <div className="space-y-1.5">
            <p className="text-sm font-bold text-foreground">{brandName}</p>
            <p>{storeData?.brand?.workshopName || 'Xưởng Đúc Thủ Công & Nến Bơ Tự Nhiên'}</p>
            {cfg?.customDomain && (
              <p className="inline-flex items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400">
                <Globe className="h-3 w-3" />
                <span>Website chính thức: https://{cfg.customDomain}</span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-foreground">Chính sách Khách hàng &amp; Đại lý Sỉ</p>
            <ul className="space-y-1">
              {isWholesaleAllowed && (
                <li>
                  <button
                    type="button"
                    onClick={() => selectNavTab('WHOLESALE')}
                    className="hover:text-foreground hover:underline"
                  >
                    Bảng giá sỉ tận xưởng (Từ {minWholesaleQty} sản phẩm)
                  </button>
                </li>
              )}
              <li>
                <button
                  type="button"
                  onClick={() => selectNavTab('CONTACT')}
                  className="hover:text-foreground hover:underline"
                >
                  Đặt gia công quà tặng doanh nghiệp (OEM)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => selectNavTab('TRACKING')}
                  className="hover:text-foreground hover:underline"
                >
                  Tra cứu đơn hàng trực tuyến
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-foreground">Kết nối đa kênh</p>
            {contact?.hotline ? (
              <p>Hotline / Zalo: {contact.hotline}</p>
            ) : (
              <p>
                <button
                  type="button"
                  onClick={() => selectNavTab('CONTACT')}
                  className="font-medium text-[#8c4f1e] hover:underline dark:text-amber-400"
                >
                  Nhắn tin tư vấn trực tuyến 24/7 →
                </button>
              </p>
            )}
            {contact?.shopeeUrl && (
              <p>
                <a
                  href={contact.shopeeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground hover:underline"
                >
                  Shopee Chính hãng: {contact.shopeeUrl.replace('https://', '')}
                </a>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {!isCustomDomainHost && (
                <Link
                  href="/blog"
                  className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
                >
                  <BookOpen className="h-3 w-3" /> Góc Tĩnh Tâm
                </Link>
              )}
              <a
                href={
                  isCustomDomainHost && cfg?.cmsBackendOrigin
                    ? `${cfg.cmsBackendOrigin}/login`
                    : '/login'
                }
                className="text-[11px] opacity-75 hover:opacity-100 hover:underline"
              >
                Cổng Nhân sự CMS
              </a>
            </div>
          </div>
        </div>
      </footer>

      {/* Sticky Bottom Cart & Wholesale Progress Bar trên Mobile (< 640px) */}
      {showMobileStickyCart && (
        <div
          role="region"
          aria-label="Tóm tắt giỏ hàng nhanh"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-amber-300/80 bg-card/98 px-3 pt-2 pb-[max(0.65rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(28,25,23,0.12)] backdrop-blur-md sm:hidden dark:border-stone-800"
        >
          <p className="mb-1.5 truncate text-[11px] font-semibold text-[#7c4316] dark:text-amber-300">
            {activeCartWholesaleTier
              ? `Đã áp giá sỉ ${activeCartWholesaleTier.badge} · Tiết kiệm ${formatVND(wholesaleSavings)}`
              : nextWholesaleTierHint
                ? `Mua thêm ${nextWholesaleTierHint.minQty - totalCartItems} SP nhận giá sỉ ${nextWholesaleTierHint.badge}`
                : freeShipRemaining > 0
                  ? `Mua thêm ${formatVND(freeShipRemaining)} để Miễn phí vận chuyển`
                  : 'Đơn hàng đã đủ điều kiện Miễn phí vận chuyển'}
          </p>
          <div className="flex items-center justify-between gap-2.5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-muted-foreground">
                {totalCartItems} sản phẩm
              </p>
              <p className="text-sm font-extrabold whitespace-nowrap tabular-nums text-foreground">
                {formatVND(effectiveCartSubtotal)}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => setCartOpen(true)}
              className="h-10 shrink-0 gap-1.5 rounded-xl bg-[#8c4f1e] px-4 text-xs font-bold text-white shadow-sm hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950"
            >
              <span>Xem giỏ &amp; Đặt mua →</span>
            </Button>
          </div>
        </div>
      )}

      {/* Hộp thoại Chi Tiết Sản Phẩm (Artisan Product Sheet — Đa ảnh, Bảng sỉ tương tác, 3 Tab cấu trúc & Gợi ý phối bộ) */}
      <Dialog
        open={Boolean(selectedProduct)}
        onOpenChange={(open) => {
          if (!open) closeQuickView()
        }}
      >
        <DialogContent
          hideMaximizeButton
          className="max-h-[92svh] overflow-y-auto p-4 sm:max-w-4xl sm:p-6 max-sm:pb-0"
        >
          {selectedProduct &&
            (() => {
              const displayModalTitle =
                formatStorefrontDisplayTitle(
                  selectedProduct.cleanTitle || selectedProduct.name,
                  selectedProduct.variantLabel
                ) ||
                selectedProduct.cleanTitle ||
                selectedProduct.name
              const activeImgUrl =
                selectedGalleryImages[selectedImageIdx] || selectedProduct.image || ''
              const projectedQty = totalCartItems + quickViewQty
              const activeModalWs =
                isWholesaleAllowed && selectedProduct.wholesalePrices.length > 0
                  ? [...selectedProduct.wholesalePrices]
                      .sort((a, b) => b.minQty - a.minQty)
                      .find((w) => projectedQty >= w.minQty) ?? null
                  : null
              const effectiveUnitPrice = activeModalWs
                ? activeModalWs.unitPrice
                : selectedProduct.retailPrice
              const lineSubtotal = effectiveUnitPrice * quickViewQty
              const lineSaved = Math.max(
                0,
                (selectedProduct.retailPrice - effectiveUnitPrice) * quickViewQty
              )
              const siblingsHaveDiffPrice = siblingVariants.some(
                (s) => s.retailPrice !== selectedProduct.retailPrice
              )
              const tierGroupLabel =
                selectedProduct.tierVariationName || 'Phân loại cùng mẫu'
              const returnDaysVal =
                typeof cfg?.returnDays === 'number' ? cfg.returnDays : 7

              const ovSecs =
                parsedSelectedDescription?.sections.filter((s) => s.tab === 'OVERVIEW') ?? []
              const spSecs =
                parsedSelectedDescription?.sections.filter((s) => s.tab === 'SPECS') ?? []
              const caSecs =
                parsedSelectedDescription?.sections.filter((s) => s.tab === 'CARE') ?? []
              const leadParagraphs = parsedSelectedDescription?.leadParagraphs ?? []
              const quickSpecs = parsedSelectedDescription?.quickSpecs ?? []

              const availableTabs: Array<{
                key: ProductDetailTabKey
                label: string
                sections: typeof ovSecs
              }> = []
              if (
                ovSecs.length > 0 ||
                (spSecs.length === 0 && caSecs.length === 0 && leadParagraphs.length > 1)
              ) {
                availableTabs.push({
                  key: 'OVERVIEW',
                  label: 'Đặc điểm & Công năng',
                  sections: ovSecs,
                })
              }
              if (spSecs.length > 0) {
                availableTabs.push({
                  key: 'SPECS',
                  label: 'Thông số kỹ thuật',
                  sections: spSecs,
                })
              }
              if (caSecs.length > 0) {
                availableTabs.push({
                  key: 'CARE',
                  label: 'Bảo quản & Đóng gói',
                  sections: caSecs,
                })
              }
              const activeDetailTabObj =
                availableTabs.find((t) => t.key === detailTab) ?? availableTabs[0] ?? null

              return (
                <>
                  <DialogHeader className="sr-only">
                    <DialogTitle>{displayModalTitle}</DialogTitle>
                    <DialogDescription>
                      Mã SKU {selectedProduct.sku} · {selectedProduct.stockLabel}
                    </DialogDescription>
                  </DialogHeader>

                  <div className="grid gap-6 md:grid-cols-[minmax(280px,0.88fr)_minmax(0,1.12fr)] md:items-start">
                    {/* Cột Trái: Sân khấu Gallery đa ảnh + Lưới Thông số Nhanh + Cam kết xưởng */}
                    <div className="space-y-2.5 md:sticky md:top-0">
                      <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-stone-100/70 dark:bg-stone-900/50">
                        {activeImgUrl ? (
                          <button
                            type="button"
                            onClick={() => setDetailZoomOpen(true)}
                            aria-label={`Phóng lớn ảnh ${displayModalTitle}`}
                            className="h-full w-full cursor-zoom-in"
                          >
                            <img
                              src={activeImgUrl}
                              alt={displayModalTitle}
                              className="h-full w-full object-cover"
                            />
                          </button>
                        ) : (
                          <ProductAvatar
                            name={selectedProduct.name}
                            className="h-24 w-24 text-2xl"
                          />
                        )}

                        {selectedGalleryImages.length > 1 && (
                          <>
                            <button
                              type="button"
                              aria-label="Ảnh sản phẩm trước"
                              onClick={() => stepSelectedImage(-1)}
                              className="absolute top-1/2 left-2.5 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-white/92 text-stone-900 shadow-sm transition hover:border-[#8c4f1e] hover:text-[#8c4f1e] dark:bg-stone-900/90 dark:text-stone-100"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Ảnh sản phẩm tiếp theo"
                              onClick={() => stepSelectedImage(1)}
                              className="absolute top-1/2 right-2.5 inline-flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border bg-white/92 text-stone-900 shadow-sm transition hover:border-[#8c4f1e] hover:text-[#8c4f1e] dark:bg-stone-900/90 dark:text-stone-100"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                            <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-stone-900/80 px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-white">
                              {selectedImageIdx + 1} / {selectedGalleryImages.length}
                            </span>
                          </>
                        )}

                        {activeImgUrl && (
                          <button
                            type="button"
                            onClick={() => setDetailZoomOpen(true)}
                            className="absolute right-2.5 bottom-2.5 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border bg-white/94 px-2.5 text-[11px] font-bold text-stone-900 shadow-xs transition hover:border-[#8c4f1e] hover:text-[#8c4f1e] dark:bg-stone-900/90 dark:text-stone-100"
                          >
                            <ZoomIn className="h-3.5 w-3.5" />
                            <span>Phóng lớn</span>
                          </button>
                        )}
                      </div>

                      {selectedGalleryImages.length > 1 && (
                        <div
                          role="tablist"
                          aria-label="Bộ sưu tập ảnh sản phẩm"
                          className="flex gap-2 overflow-x-auto py-1"
                        >
                          {selectedGalleryImages.map((imgUrl, idx) => (
                            <button
                              key={`${imgUrl}-${idx}`}
                              type="button"
                              role="tab"
                              aria-label={`Ảnh sản phẩm ${idx + 1}`}
                              aria-selected={selectedImageIdx === idx}
                              onClick={() => setSelectedImageIdx(idx)}
                              className={cn(
                                'h-14 w-14 shrink-0 cursor-pointer overflow-hidden rounded-xl border-2 transition-all',
                                selectedImageIdx === idx
                                  ? 'border-[#8c4f1e] ring-2 ring-[#8c4f1e]/20 dark:border-amber-400'
                                  : 'border-border/70 opacity-75 hover:opacity-100'
                              )}
                            >
                              <img
                                src={imgUrl}
                                alt=""
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      {quickSpecs.length > 0 && (
                        <div className="hidden grid-cols-2 gap-2 pt-1 md:grid">
                          {quickSpecs.map((spec) => (
                            <div
                              key={spec.label}
                              className="rounded-xl border bg-muted/25 px-3 py-2 text-xs"
                            >
                              <span className="block text-[11px] font-medium text-muted-foreground">
                                {spec.label}
                              </span>
                              <strong className="mt-0.5 block leading-snug font-bold text-foreground">
                                {spec.value}
                              </strong>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="hidden flex-wrap gap-1.5 pt-0.5 md:flex">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" />
                          Đúc thủ công tỉ mỉ
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                          <ShieldCheck className="h-3 w-3" />
                          {returnDaysVal > 0
                            ? `Đổi mới bể vỡ ${returnDaysVal} ngày`
                            : 'Đồng kiểm khi nhận'}
                        </span>
                        {isWholesaleAllowed && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50/80 px-2.5 py-1 text-[11px] font-semibold text-[#7c4316] dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            <BadgePercent className="h-3 w-3" />
                            Gộp mẫu sỉ từ {minWholesaleQty} SP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Cột Phải: Định danh, Giá & Bảng sỉ tương tác, Biến thể kèm ảnh, 3 Tab cấu trúc & Cụm mua hàng */}
                    <div className="flex min-w-0 flex-col space-y-3.5 sm:pr-2">
                      <div className="space-y-1.5 sm:pr-8">
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded-md border bg-muted/50 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted-foreground">
                            SKU: {selectedProduct.sku}
                          </span>
                          <span className="rounded-md border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                            {selectedProduct.stockLabel}
                          </span>
                        </div>

                        <h2 className="text-lg leading-snug font-extrabold tracking-tight text-foreground sm:text-xl">
                          {displayModalTitle}
                        </h2>

                        {leadParagraphs[0] && (
                          <p className="text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
                            {leadParagraphs[0]}
                          </p>
                        )}
                      </div>

                      {/* Khung Giá Động & Bộ chọn nhanh mốc Giá Sỉ Xưởng */}
                      <div className="space-y-2.5 rounded-2xl border bg-muted/25 p-3.5">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <span className="block text-[11.5px] font-medium text-muted-foreground">
                              {activeModalWs
                                ? `Đơn giá sỉ đang áp dụng (${activeModalWs.badge}):`
                                : 'Giá bán lẻ niêm yết:'}
                            </span>
                            <div className="flex items-baseline gap-2">
                              <span className="text-2xl font-extrabold whitespace-nowrap tabular-nums text-[#8c4f1e] dark:text-amber-400">
                                {formatVND(effectiveUnitPrice)}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                / {selectedProduct.unit}
                              </span>
                              {activeModalWs && (
                                <span className="text-xs text-muted-foreground line-through tabular-nums">
                                  {formatVND(selectedProduct.retailPrice)}
                                </span>
                              )}
                            </div>
                          </div>

                          {(quickViewQty > 1 || lineSaved > 0) && (
                            <div className="text-right text-xs">
                              <span className="block text-muted-foreground">
                                Tạm tính ({quickViewQty} {selectedProduct.unit}):{' '}
                                <strong className="font-bold tabular-nums text-foreground">
                                  {formatVND(lineSubtotal)}
                                </strong>
                              </span>
                              {lineSaved > 0 && (
                                <span className="font-bold text-emerald-700 dark:text-emerald-400">
                                  Tiết kiệm {formatVND(lineSaved)}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {isWholesaleAllowed && selectedProduct.wholesalePrices.length > 0 && (
                          <div className="space-y-1.5 border-t border-dashed pt-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-1 text-[11.5px]">
                              <strong className="font-bold text-[#7c4316] dark:text-amber-200">
                                Bảng giá sỉ xưởng (bấm chọn nhanh mốc số lượng):
                              </strong>
                              {totalCartItems > 0 && (
                                <span className="text-muted-foreground">
                                  Giỏ đã có {totalCartItems} SP
                                </span>
                              )}
                            </div>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                              <button
                                type="button"
                                onClick={() => setQuickViewQty(1)}
                                className={cn(
                                  'cursor-pointer rounded-xl border p-2 text-left transition-all',
                                  !activeModalWs
                                    ? 'border-[#8c4f1e] bg-amber-50/80 ring-1 ring-[#8c4f1e]/30 dark:border-amber-400 dark:bg-amber-950/40'
                                    : 'border-border bg-background hover:border-amber-400'
                                )}
                              >
                                <span className="block text-[11px] font-semibold text-[#7c4316] dark:text-amber-300">
                                  Mua lẻ (1+ {selectedProduct.unit})
                                </span>
                                <strong className="block text-xs font-extrabold tabular-nums">
                                  {formatVND(selectedProduct.retailPrice)}
                                </strong>
                              </button>
                              {selectedProduct.wholesalePrices.map((wp) => {
                                const isActiveTier = activeModalWs?.tierId === wp.tierId
                                return (
                                  <button
                                    key={wp.tierId}
                                    type="button"
                                    onClick={() => setQuickViewQty(wp.minQty)}
                                    className={cn(
                                      'cursor-pointer rounded-xl border p-2 text-left transition-all',
                                      isActiveTier
                                        ? 'border-[#8c4f1e] bg-amber-50/80 ring-1 ring-[#8c4f1e]/30 dark:border-amber-400 dark:bg-amber-950/40'
                                        : 'border-border bg-background hover:border-amber-400'
                                    )}
                                  >
                                    <span className="block text-[11px] font-semibold text-[#7c4316] dark:text-amber-300">
                                      Từ {wp.minQty} ({wp.badge})
                                    </span>
                                    <strong className="block text-xs font-extrabold tabular-nums">
                                      {formatVND(wp.unitPrice)}
                                    </strong>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Chip chuyển nhanh giữa các màu/quy cách cùng dòng sản phẩm (kèm ảnh & giá) */}
                      {siblingVariants.length > 1 ? (
                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-foreground">
                            Chọn {tierGroupLabel} ({siblingVariants.length}):{' '}
                            {selectedProduct.variantLabel && (
                              <strong className="text-[#8c4f1e] dark:text-amber-300">
                                {selectedProduct.variantLabel}
                              </strong>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {siblingVariants.map((sib) => {
                              const isCurrent = sib.id === selectedProduct.id
                              return (
                                <button
                                  key={sib.id}
                                  type="button"
                                  onClick={() => openQuickView(sib, true)}
                                  className={cn(
                                    'inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border py-1 pr-3 text-xs font-semibold transition-all',
                                    sib.image ? 'pl-1.5' : 'pl-3',
                                    isCurrent
                                      ? 'border-[#8c4f1e] bg-[#8c4f1e] text-white dark:border-amber-400 dark:bg-amber-400 dark:text-stone-950'
                                      : 'border-border bg-background text-foreground hover:border-amber-400 hover:bg-amber-50/50 dark:hover:bg-stone-800'
                                  )}
                                >
                                  {sib.image && (
                                    <img
                                      src={sib.image}
                                      alt=""
                                      className="h-6 w-6 shrink-0 rounded-full border border-black/10 object-cover"
                                    />
                                  )}
                                  <span>{sib.variantLabel || sib.sku}</span>
                                  {siblingsHaveDiffPrice && (
                                    <span className="text-[11px] font-medium tabular-nums opacity-85">
                                      · {formatVND(sib.retailPrice)}
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ) : (
                        selectedProduct.variantLabel && (
                          <p className="text-xs font-semibold text-[#7c4316] dark:text-amber-300">
                            Phân loại: {selectedProduct.variantLabel}
                          </p>
                        )
                      )}

                      {/* Khung Số lượng & Mua hàng (Nằm ngay trên vùng fold ở Desktop, ghim đáy gọn gàng ở Mobile) */}
                      <div className="space-y-2.5 rounded-2xl border bg-background p-3 max-sm:order-10 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-4 max-sm:py-2.5 max-sm:shadow-[0_-8px_20px_rgba(0,0,0,0.08)]">
                        {selectedProduct.availableToOrder && (
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <span className="text-xs font-bold text-foreground">
                                Số lượng đặt chọn:
                              </span>
                              {isWholesaleAllowed && !activeModalWs && (
                                <p className="text-[11px] text-muted-foreground">
                                  Gộp từ {minWholesaleQty} SP bất kỳ tự động giảm giá sỉ
                                </p>
                              )}
                            </div>
                            <div className="inline-flex items-center gap-1 rounded-xl border bg-muted/30 p-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Giảm số lượng chọn"
                                onClick={() => setQuickViewQty((q) => Math.max(1, q - 1))}
                                className="h-9 w-9 rounded-lg"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <span className="min-w-9 text-center text-sm font-bold tabular-nums">
                                {quickViewQty}
                              </span>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                aria-label="Tăng số lượng chọn"
                                onClick={() => setQuickViewQty((q) => Math.min(999, q + 1))}
                                className="h-9 w-9 rounded-lg"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        )}

                        <div
                          className={cn(
                            'grid gap-2',
                            isWholesaleAllowed ? 'grid-cols-[1.15fr_0.85fr]' : 'grid-cols-1'
                          )}
                        >
                          <Button
                            type="button"
                            disabled={!selectedProduct.availableToOrder}
                            onClick={() => {
                              addToCart(selectedProduct, quickViewQty)
                              closeQuickView()
                            }}
                            className="h-11 gap-1.5 whitespace-nowrap bg-stone-900 text-xs font-bold text-white hover:bg-[#8c4f1e] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                          >
                            <Plus className="h-4 w-4 shrink-0" />
                            {selectedProduct.availableToOrder ? (
                              <>
                                <span className="hidden sm:inline">
                                  Thêm vào giỏ ({quickViewQty} · {formatVND(lineSubtotal)})
                                </span>
                                <span className="sm:hidden">
                                  Giỏ ({quickViewQty} · {formatVND(lineSubtotal)})
                                </span>
                              </>
                            ) : (
                              'Tạm hết hàng'
                            )}
                          </Button>
                          {isWholesaleAllowed && (
                            <Button
                              type="button"
                              variant="outline"
                              disabled={!selectedProduct.availableToOrder}
                              onClick={() => {
                                addToCart(selectedProduct, minWholesaleQty)
                                closeQuickView()
                                setCartOpen(true)
                              }}
                              className="h-11 gap-1.5 whitespace-nowrap border-amber-400 bg-amber-50/70 text-xs font-bold text-[#7c4316] hover:bg-amber-100/80 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                            >
                              <BadgePercent className="h-4 w-4 shrink-0" />
                              <span>Nhập sỉ (+{minWholesaleQty})</span>
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* 3 Tab Thông tin Chi tiết có cấu trúc (Xóa sổ khung cuộn 125px kẹt tay) */}
                      {activeDetailTabObj && (
                        <div className="space-y-2">
                          {availableTabs.length > 1 && (
                            <div
                              role="tablist"
                              aria-label="Thông tin chi tiết sản phẩm"
                              className="flex gap-1 overflow-x-auto rounded-xl bg-muted/60 p-1"
                            >
                              {availableTabs.map((tb) => {
                                const isActiveTab = tb.key === activeDetailTabObj.key
                                return (
                                  <button
                                    key={tb.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActiveTab}
                                    onClick={() => setDetailTab(tb.key)}
                                    className={cn(
                                      'min-h-8 flex-1 shrink-0 cursor-pointer rounded-lg px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-all',
                                      isActiveTab
                                        ? 'bg-background text-foreground shadow-xs'
                                        : 'text-muted-foreground hover:text-foreground'
                                    )}
                                  >
                                    {tb.label}
                                  </button>
                                )
                              })}
                            </div>
                          )}

                          <div
                            role="tabpanel"
                            className="space-y-3 rounded-2xl border bg-card p-3.5 text-xs leading-relaxed"
                          >
                            {activeDetailTabObj.sections.length > 0
                              ? activeDetailTabObj.sections.map((sec, sIdx) => (
                                  <div
                                    key={`${sec.title}-${sIdx}`}
                                    className={cn(
                                      'space-y-1.5',
                                      sIdx > 0 && 'border-t border-dashed pt-2.5'
                                    )}
                                  >
                                    <h3 className="text-[12.5px] font-extrabold text-[#7c4316] dark:text-amber-300">
                                      {sec.title}
                                    </h3>
                                    {sec.bullets.length > 0 && (
                                      <ul className="space-y-1.5">
                                        {sec.bullets.map((b, bIdx) => (
                                          <li
                                            key={bIdx}
                                            className="relative pl-3.5 text-foreground"
                                          >
                                            <span className="absolute top-2 left-0 h-1.5 w-1.5 rounded-full bg-[#8c4f1e] dark:bg-amber-400" />
                                            {b.label ? (
                                              <>
                                                <strong className="font-bold">{b.label}:</strong>{' '}
                                                <span className="text-muted-foreground">
                                                  {b.text}
                                                </span>
                                              </>
                                            ) : (
                                              <span className="text-muted-foreground">
                                                {b.text}
                                              </span>
                                            )}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                    {sec.paragraphs.map((pr, pIdx) => (
                                      <p key={pIdx} className="text-muted-foreground">
                                        {pr}
                                      </p>
                                    ))}
                                  </div>
                                ))
                              : leadParagraphs.slice(1).map((lp, lIdx) => (
                                  <p key={lIdx} className="text-muted-foreground">
                                    {lp}
                                  </p>
                                ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-9 w-full gap-1.5 text-xs"
                          onClick={() => {
                            if (typeof window === 'undefined') return
                            const url = buildStorefrontProductShareUrl(
                              window.location.href,
                              selectedProduct.sku
                            )
                            void copyToClipboard(url, 'liên kết sản phẩm')
                          }}
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span>Sao chép link SP</span>
                        </Button>
                        {selectedProduct.shopeeUrl && (
                          <Button
                            asChild
                            variant="outline"
                            size="sm"
                            className="h-9 w-full gap-1.5 text-xs"
                          >
                            <a
                              href={selectedProduct.shopeeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span>Xem trên Shopee</span>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Gợi ý phối đồng bộ tại xưởng (3 dòng sản phẩm bổ trợ khác nhóm) */}
                  {relatedProducts.length > 0 && (
                    <div className="mt-2 space-y-2.5 border-t pt-4 max-sm:pb-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-extrabold text-foreground">
                          Gợi ý phối đồng bộ tại xưởng
                        </h3>
                        {isWholesaleAllowed && (
                          <span className="text-xs font-semibold text-[#7c4316] dark:text-amber-300">
                            Gộp mẫu tự do hưởng chiết khấu sỉ
                          </span>
                        )}
                      </div>
                      <div className="grid gap-2.5 sm:grid-cols-3">
                        {relatedProducts.map((rel) => {
                          const relTitle =
                            formatStorefrontDisplayTitle(
                              rel.cleanTitle || rel.name,
                              rel.variantLabel
                            ) ||
                            rel.cleanTitle ||
                            rel.name
                          return (
                            <button
                              key={rel.id}
                              type="button"
                              onClick={() => openQuickView(rel)}
                              className="flex cursor-pointer items-center gap-2.5 rounded-xl border bg-muted/25 p-2.5 text-left transition hover:border-[#8c4f1e] hover:bg-amber-50/50 dark:hover:bg-stone-800/70"
                            >
                              {rel.image ? (
                                <img
                                  src={rel.image}
                                  alt=""
                                  loading="lazy"
                                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                                />
                              ) : (
                                <ProductAvatar name={rel.name} className="h-12 w-12 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-foreground">
                                  {relTitle}
                                </p>
                                {rel.variantLabel && (
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {rel.variantLabel}
                                  </p>
                                )}
                                <p className="mt-0.5 text-xs font-extrabold tabular-nums text-[#8c4f1e] dark:text-amber-400">
                                  {formatVND(rel.retailPrice)}{' '}
                                  <span className="text-[11px] font-normal text-muted-foreground">
                                    / {rel.unit}
                                  </span>
                                </p>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )
            })()}
        </DialogContent>
      </Dialog>

      {/* Lightbox Phóng Lớn Hình Ảnh Sản Phẩm */}
      <Dialog open={detailZoomOpen && Boolean(selectedProduct)} onOpenChange={setDetailZoomOpen}>
        <DialogContent
          hideMaximizeButton
          className="border-stone-800 bg-stone-950/95 p-3 text-white sm:max-w-3xl"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Phóng lớn hình ảnh sản phẩm</DialogTitle>
            <DialogDescription>
              Xem chi tiết bề mặt và kiểu dáng sản phẩm độ phân giải gốc.
            </DialogDescription>
          </DialogHeader>
          {selectedProduct && (
            <div className="relative flex min-h-[50svh] items-center justify-center">
              <img
                src={selectedGalleryImages[selectedImageIdx] || selectedProduct.image || ''}
                alt={selectedProduct.cleanTitle || selectedProduct.name}
                className="max-h-[82svh] w-auto rounded-xl object-contain"
              />
              {selectedGalleryImages.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Ảnh trước"
                    onClick={() => stepSelectedImage(-1)}
                    className="absolute top-1/2 left-2 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-stone-950 shadow-md hover:bg-white"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Ảnh tiếp theo"
                    onClick={() => stepSelectedImage(1)}
                    className="absolute top-1/2 right-2 inline-flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-white/90 text-stone-950 shadow-md hover:bg-white"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-3 py-1 text-xs font-bold tabular-nums text-white">
                    {selectedImageIdx + 1} / {selectedGalleryImages.length}
                  </span>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Hộp thoại Giỏ hàng & Đặt hàng */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent hideMaximizeButton className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader className="sm:pr-10">
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-[#8c4f1e] dark:text-amber-400" />
              Giỏ hàng &amp; Đặt mua Trực tuyến
            </DialogTitle>
            <DialogDescription>
              {isWholesaleAllowed
                ? `Tự động áp dụng chiết khấu Giá Sỉ khi tổng giỏ hàng từ ${minWholesaleQty} sản phẩm trở lên.`
                : 'Kiểm tra danh sách sản phẩm và nhập thông tin nhận hàng.'}
            </DialogDescription>
          </DialogHeader>

          {completedOrder ? (
            <div
              role="status"
              aria-live="polite"
              className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/30"
            >
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                Đặt hàng thành công!
              </p>
              <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                <span>Mã đơn hàng của bạn:</span>
                <strong className="font-mono text-sm">{completedOrder.refCode}</strong>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => void copyToClipboard(completedOrder.refCode, 'mã đơn hàng')}
                >
                  <Copy className="h-3 w-3" /> Sao chép
                </Button>
              </div>
              <p className="text-xs font-semibold whitespace-nowrap tabular-nums">
                Tổng thanh toán: {formatVND(completedOrder.grandTotal)}
                {completedOrder.tierLabel ? ` (${completedOrder.tierLabel})` : ''}
              </p>

              {completedOrder.paymentMethod === 'BANK_TRANSFER' && effectiveBankTransfer ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-white/95 p-3 text-left text-xs dark:border-amber-900 dark:bg-stone-950/80">
                  <div className="flex items-center gap-1.5 font-bold text-[#7c4316] dark:text-amber-200">
                    <QrCode className="h-4 w-4 shrink-0" />
                    <span>Quét mã VietQR thanh toán đơn {completedOrder.refCode}</span>
                  </div>
                  {completedOrderVietQrUrl && qrLoadFailedUrl !== completedOrderVietQrUrl && (
                    <div className="flex justify-center py-1">
                      <img
                        src={completedOrderVietQrUrl}
                        alt={`VietQR thanh toán ${completedOrder.refCode}`}
                        className="max-h-56 rounded-lg border bg-white p-1.5 shadow-xs"
                        onError={() => setQrLoadFailedUrl(completedOrderVietQrUrl)}
                      />
                    </div>
                  )}
                  <div className="space-y-1 text-[11.5px]">
                    <p>
                      Ngân hàng: <strong>{effectiveBankTransfer.bankName}</strong>
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Số TK:{' '}
                        <strong className="font-mono">{effectiveBankTransfer.bankAccount}</strong>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() =>
                          void copyToClipboard(
                            effectiveBankTransfer.bankAccount,
                            'số tài khoản'
                          )
                        }
                      >
                        <Copy className="h-3 w-3" /> Copy STK
                      </Button>
                    </div>
                    {effectiveBankTransfer.bankHolder && (
                      <p>Chủ TK: {effectiveBankTransfer.bankHolder}</p>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        Nội dung CK: <strong className="font-mono">{completedOrder.refCode}</strong>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() =>
                          void copyToClipboard(completedOrder.refCode, 'nội dung chuyển khoản')
                        }
                      >
                        <Copy className="h-3 w-3" /> Copy nội dung
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                completedOrder.paymentMethod === 'BANK_TRANSFER' && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-300/80 bg-amber-50/90 p-3 text-left text-xs text-stone-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                    <span>
                      Xưởng sẽ kiểm tra đơn <strong>{completedOrder.refCode}</strong> và gửi mã
                      VietQR chính thức kèm mã đơn hàng qua SĐT/Zalo của bạn ngay sau khi tiếp nhận
                      đơn.
                    </span>
                  </div>
                )
              )}

              <div className="flex flex-wrap justify-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 text-xs font-semibold"
                  onClick={() => {
                    setLookupCode(completedOrder.refCode)
                    if (customerPhone.trim()) setLookupPhone(customerPhone.trim())
                    setCompletedOrder(null)
                    setCartOpen(false)
                    selectNavTab('TRACKING')
                  }}
                >
                  <FileSearch className="mr-1.5 h-3.5 w-3.5" />
                  Tra cứu đơn này
                </Button>
                <Button
                  type="button"
                  className="h-10 bg-[#8c4f1e] text-xs font-bold text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950"
                  onClick={() => {
                    setCompletedOrder(null)
                    setCartOpen(false)
                  }}
                >
                  Tiếp tục mua sắm
                </Button>
              </div>
            </div>
          ) : cart.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <ShoppingBag className="mx-auto h-10 w-10 text-muted-foreground/45" />
              <p className="text-sm text-muted-foreground">
                Giỏ hàng đang trống — hãy chọn sản phẩm lẻ hoặc gộp mẫu sỉ để đặt mua.
              </p>
              <Button
                type="button"
                onClick={() => {
                  setCartOpen(false)
                  scrollToCatalog()
                }}
                className="bg-[#8c4f1e] text-xs font-bold text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950"
              >
                Khám phá sản phẩm
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Hộp gợi ý tiến trình đạt mốc Giá Sỉ & Freeship */}
              <div className="space-y-1.5 rounded-xl border border-amber-200/85 bg-amber-50/65 px-3 py-2.5 text-xs dark:border-amber-900/60 dark:bg-amber-950/35">
                {activeCartWholesaleTier ? (
                  <p className="font-semibold text-amber-950 dark:text-amber-200">
                    Đã kích hoạt <strong>{activeCartWholesaleTier.label}</strong>: Giảm ngay{' '}
                    <strong className="whitespace-nowrap tabular-nums">
                      {formatVND(wholesaleSavings)}
                    </strong>
                    {nextWholesaleTierHint
                      ? ` · Mua thêm ${nextWholesaleTierHint.minQty - totalCartItems} SP nhận mức ${nextWholesaleTierHint.badge}`
                      : ''}
                  </p>
                ) : (
                  nextWholesaleTierHint && (
                    <p className="text-stone-700 dark:text-stone-200">
                      Mua thêm{' '}
                      <strong className="text-[#7c4316] dark:text-amber-300">
                        {nextWholesaleTierHint.minQty - totalCartItems} sản phẩm
                      </strong>{' '}
                      bất kỳ để nhận giá sỉ <strong>{nextWholesaleTierHint.badge}</strong>.
                    </p>
                  )
                )}
                <p className="text-[11.5px] text-muted-foreground">
                  {freeShipRemaining > 0 ? (
                    <>
                      Mua thêm{' '}
                      <strong className="whitespace-nowrap tabular-nums text-foreground">
                        {formatVND(freeShipRemaining)}
                      </strong>{' '}
                      để được <strong>Miễn phí vận chuyển toàn quốc</strong>.
                    </>
                  ) : (
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                      ✓ Đã đủ điều kiện Miễn phí vận chuyển toàn quốc (≥{' '}
                      {formatVND(freeShipThreshold)})
                    </span>
                  )}
                </p>
              </div>

              {/* Danh sách dòng giỏ hàng có ảnh 48×48px + nút >= 36px + nút Xóa */}
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {cart.map((it) => {
                  const unitPrice = activeCartWholesaleTier
                    ? computeDiscountedPriceClient(
                        it.product.retailPrice,
                        activeCartWholesaleTier.discountPercent
                      )
                    : it.product.retailPrice
                  const lineTitle =
                    formatStorefrontDisplayTitle(
                      it.product.cleanTitle || it.product.name,
                      it.product.variantLabel
                    ) || it.product.cleanTitle
                  return (
                    <div
                      key={it.product.id}
                      className="flex items-center justify-between gap-2.5 rounded-xl border bg-muted/30 p-2 text-xs"
                    >
                      {it.product.image ? (
                        <img
                          src={it.product.image}
                          alt={lineTitle}
                          className="h-12 w-12 shrink-0 rounded-lg border object-cover"
                        />
                      ) : (
                        <ProductAvatar
                          name={it.product.name}
                          className="h-12 w-12 shrink-0 text-xs"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-foreground">{lineTitle}</p>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          <span className="whitespace-nowrap tabular-nums">
                            {formatVND(unitPrice)}
                          </span>{' '}
                          / {it.product.unit}
                          {it.product.variantLabel ? ` · ${it.product.variantLabel}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9"
                          aria-label="Giảm số lượng"
                          onClick={() => updateCartQty(it.product.id, -1)}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-7 text-center font-bold tabular-nums">
                          {it.quantity}
                        </span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-9 w-9"
                          aria-label="Tăng số lượng"
                          onClick={() => updateCartQty(it.product.id, 1)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                          aria-label="Xóa sản phẩm khỏi giỏ"
                          onClick={() => updateCartQty(it.product.id, -it.quantity)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="store-cust-name">Họ và tên người nhận *</Label>
                  <Input
                    id="store-cust-name"
                    name="customerName"
                    autoComplete="name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nguyễn Minh Trân"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="store-cust-phone">Số điện thoại *</Label>
                  <Input
                    id="store-cust-phone"
                    name="customerPhone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="VD: 09xx xxx xxx"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-addr">Địa chỉ giao hàng chi tiết *</Label>
                  <Input
                    id="store-cust-addr"
                    name="address"
                    autoComplete="street-address"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..."
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-note">Ghi chú đơn hàng (tùy chọn)</Label>
                  <Textarea
                    id="store-cust-note"
                    name="note"
                    rows={2}
                    value={orderNote}
                    onChange={(e) => setOrderNote(e.target.value)}
                    placeholder="Gói quà tặng, xuất hóa đơn, giờ giao mong muốn..."
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('COD')}
                  className={cn(
                    'min-h-10 cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'COD'
                      ? 'border-[#8c4f1e] bg-amber-50/90 text-[#7c4316] dark:border-amber-400 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'bg-card text-muted-foreground hover:text-foreground'
                  )}
                >
                  Thanh toán khi nhận (COD)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('BANK_TRANSFER')}
                  className={cn(
                    'min-h-10 cursor-pointer rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'BANK_TRANSFER'
                      ? 'border-[#8c4f1e] bg-amber-50/90 text-[#7c4316] dark:border-amber-400 dark:bg-amber-950/50 dark:text-amber-200'
                      : 'bg-card text-muted-foreground hover:text-foreground'
                  )}
                >
                  Chuyển khoản Ngân hàng
                </button>
              </div>

              {paymentMethod === 'BANK_TRANSFER' &&
                (effectiveBankTransfer ? (
                  <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 font-bold text-[#7c4316] dark:text-amber-200">
                        <QrCode className="h-4 w-4 shrink-0" />
                        <span>Thông tin chuyển khoản &amp; VietQR tự động:</span>
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 px-2 text-[11px]"
                        onClick={() =>
                          void copyToClipboard(
                            effectiveBankTransfer.bankAccount,
                            'số tài khoản'
                          )
                        }
                      >
                        <Copy className="h-3 w-3" /> Copy STK
                      </Button>
                    </div>
                    <p className="mt-0.5">
                      Ngân hàng: <strong>{effectiveBankTransfer.bankName}</strong> · STK:{' '}
                      <strong className="font-mono">{effectiveBankTransfer.bankAccount}</strong>
                    </p>
                    {effectiveBankTransfer.bankHolder && (
                      <p>Chủ TK: {effectiveBankTransfer.bankHolder}</p>
                    )}
                    {checkoutPreviewVietQrUrl && qrLoadFailedUrl !== checkoutPreviewVietQrUrl && (
                      <div className="flex flex-col items-center gap-1 pt-1">
                        <img
                          src={checkoutPreviewVietQrUrl}
                          alt="Mã VietQR chuyển khoản"
                          className="max-h-48 rounded-lg border bg-white p-1.5 shadow-xs"
                          onError={() => setQrLoadFailedUrl(checkoutPreviewVietQrUrl)}
                        />
                        <span className="text-[11px] text-muted-foreground">
                          Mã QR kèm đúng mã đơn hàng cũng sẽ hiển thị ngay sau khi bấm Đặt mua
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    role="status"
                    aria-live="polite"
                    className="flex items-start gap-2 rounded-xl border border-amber-300/80 bg-amber-50/85 p-3 text-xs text-stone-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#8c4f1e] dark:text-amber-400" />
                    <span>
                      Xưởng sẽ kiểm tra đơn và gửi mã VietQR chính thức kèm mã đơn hàng qua
                      SĐT/Zalo của bạn ngay sau khi tiếp nhận đơn.
                    </span>
                  </div>
                ))}

              <div className="space-y-1 rounded-xl border bg-muted/40 p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    Tạm tính ({totalCartItems} sản phẩm):
                  </span>
                  <span className="font-medium whitespace-nowrap tabular-nums">
                    {formatVND(effectiveCartSubtotal)}
                  </span>
                </div>
                {wholesaleSavings > 0 && (
                  <div className="flex justify-between gap-2 text-[#7c4316] dark:text-amber-300">
                    <span>Tiết kiệm chiết khấu sỉ:</span>
                    <span className="font-bold whitespace-nowrap tabular-nums">
                      -{formatVND(wholesaleSavings)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Phí giao hàng:
                  </span>
                  <span className="font-medium whitespace-nowrap tabular-nums">
                    {shippingFee === 0
                      ? `Miễn phí (Đơn ≥ ${formatVND(freeShipThreshold)})`
                      : formatVND(shippingFee)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 border-t pt-1.5 text-sm font-bold text-foreground">
                  <span>Tổng thanh toán:</span>
                  <span className="whitespace-nowrap tabular-nums text-[#8c4f1e] dark:text-amber-400">
                    {formatVND(grandTotal)}
                  </span>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  disabled={submittingOrder}
                  onClick={() => void handleCheckout()}
                  className="h-11 w-full bg-[#8c4f1e] text-sm font-bold whitespace-nowrap tabular-nums text-white hover:bg-[#733f16] dark:bg-amber-400 dark:text-stone-950 dark:hover:bg-amber-300"
                >
                  {submittingOrder
                    ? 'Đang xử lý đơn hàng...'
                    : `Đặt mua ngay · ${formatVND(grandTotal)}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
