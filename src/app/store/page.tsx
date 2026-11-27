'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Award,
  BadgePercent,
  BookOpen,
  Building2,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FileSearch,
  Globe,
  Layers,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageCircle,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  Trash2,
  Truck,
  X,
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
import { useToast } from '@/hooks/use-toast'
import { formatVND } from '@/lib/format'
import {
  hasAnySyncedShopeeBanners,
  matchesCollectionBannerProduct,
  type StorefrontBannersConfig,
  type StorefrontCarouselBanner,
} from '@/lib/storefront-banners'
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
  const { toast } = useToast()

  const [storeData, setStoreData] = useState<StorefrontPayload | null>(() =>
    typeof window !== 'undefined' && window.__OPENVN_STOREFRONT_BOOTSTRAP__
      ? window.__OPENVN_STOREFRONT_BOOTSTRAP__
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
  const [sortBy, setSortBy] = useState<'DEFAULT' | 'PRICE_ASC' | 'PRICE_DESC'>('DEFAULT')
  const [selectedProduct, setSelectedProduct] = useState<StorefrontProduct | null>(null)
  const [selectedImageIdx, setSelectedImageIdx] = useState(0)

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
  } | null>(null)

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
    title?: string
    total?: number | null
    tierApplied?: string | null
    createdAt?: string
  } | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [isCustomDomainHost, setIsCustomDomainHost] = useState(false)

  const loadStorefront = useCallback(async () => {
    const bootstrapped =
      typeof window !== 'undefined' ? window.__OPENVN_STOREFRONT_BOOTSTRAP__ ?? null : null
    if (bootstrapped) {
      setStoreData(bootstrapped)
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
          setStoreData(liveData)
        }
      }
    } catch {
      // Nếu mạng chậm hoặc máy chủ Render đang khởi động, giữ nguyên dữ liệu bootstrap tức thì
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const h = window.location.hostname.toLowerCase()
      const p = window.location.pathname.toLowerCase()
      const isInternal =
        h === 'localhost' ||
        h === '127.0.0.1' ||
        h.endsWith('.onrender.com') ||
        isStaticBetaHost() ||
        p.startsWith('/store') ||
        p.endsWith('/store') ||
        p.endsWith('/store/')
      setIsCustomDomainHost(!isInternal)
    }
    void loadStorefront()
  }, [loadStorefront])

  useEffect(() => {
    if (storeData?.brand?.brandName) {
      document.title = `${storeData.brand.brandName} — Sản phẩm Thủ công, Bảng Giá Sỉ & Liên hệ Chính thức`
    }
  }, [storeData?.brand?.brandName])

  const brandName = storeData?.brand?.brandName || 'Bơ Mộc Decor'
  const cfg = storeData?.config
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
  const collectionBanners = useMemo(
    () => (showShopeeBanners ? banners?.collectionBanners ?? [] : []),
    [showShopeeBanners, banners?.collectionBanners]
  )
  const products = useMemo(() => storeData?.products ?? [], [storeData?.products])
  const categories = useMemo(() => storeData?.categories ?? [], [storeData?.categories])
  const wholesaleTiers = useMemo(
    () => cfg?.wholesaleTiers ?? [],
    [cfg?.wholesaleTiers]
  )
  const contact = cfg?.contact

  useEffect(() => {
    if (carouselIdx >= carouselBanners.length && carouselBanners.length > 0) {
      setCarouselIdx(0)
    }
  }, [carouselIdx, carouselBanners.length])

  useEffect(() => {
    if (carouselBanners.length <= 1 || carouselPaused || activeTab !== 'PRODUCTS') return
    const timer = window.setInterval(() => {
      setCarouselIdx((prev) => (prev + 1) % carouselBanners.length)
    }, 4800)
    return () => window.clearInterval(timer)
  }, [carouselBanners.length, carouselPaused, activeTab])

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
        setSelectedImageIdx(0)
        setSelectedProduct(matched)
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
    [resolveProductFromBannerRef]
  )

  const activeCollectionBanner = useMemo(
    () =>
      selectedCollectionId === 'ALL'
        ? null
        : collectionBanners.find((c) => c.id === selectedCollectionId) ?? null,
    [collectionBanners, selectedCollectionId]
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
  const shippingFee =
    effectiveCartSubtotal === 0 || effectiveCartSubtotal >= freeShipThreshold
      ? 0
      : baseShippingFee
  const grandTotal = effectiveCartSubtotal + shippingFee

  const addToCart = (product: StorefrontProduct, qtyToAdd = 1) => {
    setCompletedOrder(null)
    setCart((prev) => {
      const idx = prev.findIndex((it) => it.product.id === product.id)
      if (idx === -1) return [...prev, { product, quantity: qtyToAdd }]
      return prev.map((it, i) =>
        i === idx ? { ...it, quantity: it.quantity + qtyToAdd } : it
      )
    })
    toast({
      title: `Đã thêm ${qtyToAdd} ${product.unit} vào giỏ hàng`,
      description: `${product.cleanTitle}${product.variantLabel ? ` (${product.variantLabel})` : ''}`,
    })
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
      })
      setCart([])
      toast({
        title: `Đặt hàng thành công (${refCode})`,
        description: json.message || 'Cửa hàng sẽ liên hệ xác nhận giao hàng sớm nhất.',
      })
    } catch (e) {
      toast({
        title: 'Không thể gửi đơn đặt hàng',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại hoặc liên hệ Zalo/Hotline.',
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
        description: err instanceof Error ? err.message : 'Vui lòng thử lại hoặc nhắn Zalo trực tiếp.',
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
        title?: string
        total?: number | null
        tierApplied?: string | null
        createdAt?: string
        error?: string
      }
      if (!res.ok || !json.ok) {
        setLookupError(json.error || 'Không tìm thấy thông tin phù hợp.')
        return
      }
      setLookupResult({
        code: json.code || lookupCode.trim().toUpperCase(),
        status: json.status || 'RECEIVED',
        title: json.title,
        total: json.total,
        tierApplied: json.tierApplied,
        createdAt: json.createdAt,
      })
    } catch {
      setLookupError('Không thể kết nối máy chủ tra cứu lúc này.')
    } finally {
      setLookupLoading(false)
    }
  }

  const estimatedQtyNum = Math.max(10, Math.floor(Number(wsEstimatedQty) || 30))
  const simulatedTier = useMemo(() => {
    const sorted = [...wholesaleTiers].sort((a, b) => b.minQty - a.minQty)
    return sorted.find((t) => estimatedQtyNum >= t.minQty) ?? wholesaleTiers[0] ?? null
  }, [wholesaleTiers, estimatedQtyNum])

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      {/* Thanh thông báo ưu đãi đầu trang */}
      <div className="border-b border-amber-200/70 bg-gradient-to-r from-amber-50 via-stone-50 to-emerald-50 px-4 py-2 text-center text-xs font-medium text-stone-800 dark:border-stone-800 dark:from-stone-900 dark:via-slate-900 dark:to-emerald-950/50 dark:text-stone-200">
        <span>
          {cfg?.announcementBar ||
            'Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000 ₫ · Chiết khấu Giá Sỉ tận xưởng từ 10 sản phẩm (-15% đến -35%)'}
        </span>
      </div>

      {/* Header Điều hướng Chính */}
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('PRODUCTS')}
            className="flex items-center gap-3 text-left"
          >
            {banners?.shopLogoUrl ? (
              <img
                src={banners.shopLogoUrl}
                alt={brandName}
                referrerPolicy="no-referrer"
                className="h-10 w-10 shrink-0 rounded-full border border-stone-200 object-cover shadow-xs dark:border-stone-700"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-700 via-amber-600 to-stone-800 text-white shadow-sm">
                <ShoppingBag className="h-5 w-5" />
              </div>
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-extrabold tracking-tight text-foreground">
                  {brandName}
                </span>
                {cfg?.customDomain && (
                  <Badge
                    variant="outline"
                    className="border-amber-300 bg-amber-50/90 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                  >
                    {cfg.customDomain}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Xưởng Nến Bơ Tự Nhiên &amp; Thạch Cao Decor Thủ Công · Sỉ &amp; Lẻ Toàn Quốc
              </p>
            </div>
          </button>

          {/* Menu Chức năng Khách hàng */}
          <nav
            aria-label="Điều hướng cửa hàng"
            className="flex flex-wrap items-center gap-1.5"
          >
            <Button
              type="button"
              variant={activeTab === 'PRODUCTS' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('PRODUCTS')}
              className={cn(
                'h-10 gap-1.5 text-xs font-semibold',
                activeTab === 'PRODUCTS' && 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-600'
              )}
            >
              <Store className="h-3.5 w-3.5" />
              <span>Sản phẩm ({products.length})</span>
            </Button>

            {cfg?.wholesaleEnabled !== false && (
              <Button
                type="button"
                variant={activeTab === 'WHOLESALE' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setActiveTab('WHOLESALE')}
                className={cn(
                  'h-10 gap-1.5 text-xs font-semibold',
                  activeTab === 'WHOLESALE' &&
                    'bg-amber-700 text-white hover:bg-amber-800 dark:bg-amber-600'
                )}
              >
                <BadgePercent className="h-3.5 w-3.5" />
                <span>Bảng Giá Sỉ</span>
              </Button>
            )}

            <Button
              type="button"
              variant={activeTab === 'CONTACT' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('CONTACT')}
              className={cn(
                'h-10 gap-1.5 text-xs font-semibold',
                activeTab === 'CONTACT' && 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-600'
              )}
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Liên hệ &amp; Xưởng</span>
            </Button>

            <Button
              type="button"
              variant={activeTab === 'TRACKING' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab('TRACKING')}
              className={cn(
                'h-10 gap-1.5 text-xs font-semibold',
                activeTab === 'TRACKING' && 'bg-stone-900 text-white hover:bg-stone-800 dark:bg-amber-600'
              )}
            >
              <FileSearch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Tra cứu đơn</span>
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={() => setCartOpen(true)}
              className="h-10 gap-1.5 bg-[#0066CC] px-3.5 text-xs font-bold text-white hover:bg-[#0055B3]"
            >
              <ShoppingCart className="h-4 w-4" />
              <span>Giỏ hàng ({totalCartItems})</span>
            </Button>

            {!isCustomDomainHost && (
              <Button asChild variant="outline" size="sm" className="h-10 gap-1.5 text-xs">
                <Link href="/?cms=1">
                  <LayoutDashboard className="h-3.5 w-3.5 text-[#0066CC]" />
                  <span className="hidden lg:inline">CMS</span>
                </Link>
              </Button>
            )}

            <ThemeToggle />
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="border-b bg-gradient-to-br from-stone-100/90 via-amber-50/40 to-emerald-50/40 py-8 sm:py-10 dark:from-stone-950 dark:via-slate-900 dark:to-stone-900">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid items-center gap-6 lg:grid-cols-12">
            <div className="space-y-3 lg:col-span-7">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-white/90 px-3.5 py-1 text-xs font-semibold text-amber-900 shadow-2xs dark:border-amber-800 dark:bg-stone-900 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                <span>{cfg?.heroBadge || 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc'}</span>
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                {cfg?.heroTitle || 'Nến Bơ Tự Nhiên & Thạch Cao Decor Thủ Công Tinh Tế'}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {cfg?.heroSubtitle ||
                  'Chế tác tỉ mỉ từng khay, hũ nến thạch cao kháng dầu chịu nhiệt và nến bơ thực vật thuần chay không khói cho góc thiền, bàn trà, spa & quà tặng doanh nghiệp.'}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                <Button
                  type="button"
                  onClick={() => {
                    setActiveTab('PRODUCTS')
                    setPriceViewMode('RETAIL')
                  }}
                  className="h-11 gap-2 bg-stone-900 px-5 text-xs font-bold text-white hover:bg-stone-800 dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  <ShoppingBag className="h-4 w-4" />
                  Xem Bộ Sưu Tập Sản Phẩm
                </Button>
                {cfg?.wholesaleEnabled !== false && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setActiveTab('WHOLESALE')}
                    className="h-11 gap-2 border-amber-400 bg-amber-50/70 px-5 text-xs font-bold text-amber-950 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    <BadgePercent className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                    Xem Bảng Giá Sỉ Xưởng (-15% → -35%)
                  </Button>
                )}
                {contact?.shopeeUrl && (
                  <Button asChild variant="outline" className="h-11 gap-1.5 text-xs font-semibold">
                    <a href={contact.shopeeUrl} target="_blank" rel="noopener noreferrer">
                      <span>Gian hàng Shopee</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {/* Ảnh bìa Gian hàng Shopee (nếu có) + 3 Cam kết Xưởng sản xuất */}
            <div className="space-y-3 lg:col-span-5">
              {showShopeeBanners && banners?.coverBannerUrl && (
                <div className="overflow-hidden rounded-2xl border border-stone-200/90 bg-card shadow-sm dark:border-stone-800">
                  <picture>
                    {banners.mobileCoverBannerUrl && (
                      <source
                        media="(max-width: 640px)"
                        srcSet={banners.mobileCoverBannerUrl}
                      />
                    )}
                    <img
                      src={banners.coverBannerUrl}
                      alt={`${brandName} — Không gian thủ công`}
                      referrerPolicy="no-referrer"
                      className="aspect-[1196/518] w-full object-cover"
                    />
                  </picture>
                </div>
              )}

              <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
                <div className="flex items-start gap-3 rounded-2xl border bg-card/90 p-3 shadow-2xs">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    <Award className="h-4 w-4" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Đúc Thủ Công &amp; Sáp Bơ Thuần Chay</p>
                    <p className="mt-0.5 text-muted-foreground">
                      Không khói đen, không hóa chất độc hại, bề mặt thạch cao phủ chống thấm mịn màng.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border bg-card/90 p-3 shadow-2xs">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    <BadgePercent className="h-4 w-4" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Giá Sỉ Tận Gốc Tại Xưởng (Gộp Mẫu Tự Do)</p>
                    <p className="mt-0.5 text-muted-foreground">
                      Từ 10 SP giảm 15% · Từ 30 SP giảm 25% · Từ 100 SP giảm 35% + Gia công quà tặng OEM.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl border bg-card/90 p-3 shadow-2xs">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="text-xs">
                    <p className="font-bold text-foreground">Bảo Hành Bể Vỡ 1 Đổi 1 Toàn Quốc</p>
                    <p className="mt-0.5 text-muted-foreground">
                      Đóng gói xốp định hình nhiều lớp, đổi trả miễn phí trong {cfg?.returnDays ?? 7} ngày.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MAIN CONTENT */}
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {/* ==================== TAB 1: DANH MỤC SẢN PHẨM ==================== */}
        {activeTab === 'PRODUCTS' && (
          <div className="space-y-6">
            {/* Banner Trang trí Đồng bộ từ Gian hàng Shopee (Carousel + Điểm chạm SP + Bộ sưu tập) */}
            {showShopeeBanners &&
              (carouselBanners.length > 0 ||
                spotlightBanners.length > 0 ||
                collectionBanners.length > 0) && (
                <section aria-label="Bộ sưu tập & Banner nổi bật" className="space-y-4">
                  {(carouselBanners.length > 0 || spotlightBanners.length > 0) && (
                    <div className="grid items-start gap-4 lg:grid-cols-12">
                      {/* Carousel Banner Xoay vòng */}
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
                                    'absolute inset-0 transition-opacity duration-500',
                                    isCurrent
                                      ? 'z-10 opacity-100'
                                      : 'pointer-events-none z-0 opacity-0'
                                  )}
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
                                      onClick={() => {
                                        if (isClickable) handleCarouselSlideClick(slide)
                                      }}
                                      className={cn(
                                        'h-full w-full object-cover',
                                        isClickable && 'cursor-pointer'
                                      )}
                                    />
                                  </picture>
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
                                  className="absolute top-1/2 left-2.5 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/35 text-white backdrop-blur-xs transition hover:bg-black/60"
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
                                  className="absolute top-1/2 right-2.5 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/40 bg-black/35 text-white backdrop-blur-xs transition hover:bg-black/60"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>

                          <div className="flex h-[34px] items-center justify-between border-t bg-card px-3.5 text-[11px] text-muted-foreground">
                            <span className="truncate font-medium">
                              Bộ sưu tập Thủ công {brandName} ({carouselIdx + 1}/
                              {carouselBanners.length})
                            </span>
                            <div className="flex items-center gap-1.5">
                              {carouselBanners.map((s, idx) => (
                                <button
                                  key={s.id}
                                  type="button"
                                  aria-label={`Chuyển tới banner ${idx + 1}`}
                                  onClick={() => setCarouselIdx(idx)}
                                  className={cn(
                                    'h-2 rounded-full transition-all',
                                    idx === carouselIdx
                                      ? 'w-5 bg-amber-700 dark:bg-amber-400'
                                      : 'w-2 bg-stone-300 hover:bg-stone-400 dark:bg-stone-700'
                                  )}
                                />
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Banner Điểm chạm Tương tác Đa Sản phẩm (Shopee Hotspot Banner) */}
                      {spotlightBanners.map((sb) => (
                        <div
                          key={sb.id}
                          className={cn(
                            'overflow-hidden rounded-2xl border bg-card shadow-2xs',
                            carouselBanners.length > 0 ? 'lg:col-span-6' : 'lg:col-span-12'
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
                                      setSelectedImageIdx(0)
                                      setSelectedProduct(matchedProd)
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
                                  <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-stone-950/75 px-2.5 py-1 text-[10.5px] font-semibold text-white opacity-85 shadow-sm backdrop-blur-xs transition group-hover/hs:scale-105 group-hover/hs:bg-amber-700 group-hover/hs:opacity-100">
                                    <span>
                                      {matchedProd
                                        ? formatVND(matchedProd.retailPrice)
                                        : 'Xem SP'}
                                    </span>
                                    <Eye className="h-3 w-3" />
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 4 Thẻ Bộ Sưu Tập Hình Ảnh Đồng Bộ Từ Shopee */}
                  {collectionBanners.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {collectionBanners.map((col) => {
                        const isSelected = selectedCollectionId === col.id
                        const matchedCount = products.filter((p) =>
                          matchesCollectionBannerProduct(p, col)
                        ).length
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
                              'group flex items-center gap-3 rounded-2xl border p-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm',
                              isSelected
                                ? 'border-amber-600 bg-amber-50/80 ring-1 ring-amber-600/40 dark:border-amber-500 dark:bg-amber-950/35'
                                : 'border-border/80 bg-card hover:border-amber-300'
                            )}
                          >
                            <img
                              src={col.imageUrl}
                              alt={col.name}
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="h-14 w-14 shrink-0 rounded-xl border border-stone-200/70 object-cover transition-transform duration-300 group-hover:scale-105 sm:h-16 sm:w-16 dark:border-stone-800"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-extrabold text-foreground sm:text-sm">
                                {col.name}
                              </p>
                              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">
                                {isSelected
                                  ? 'Đang lọc · Bấm để bỏ'
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

            {/* Thanh công cụ Tìm kiếm + Lọc Danh mục + Chuyển đổi Xem Giá Lẻ / Giá Sỉ */}
            <div className="flex flex-col gap-4 rounded-2xl border bg-card p-4 shadow-2xs">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div className="relative w-full lg:max-w-md">
                  <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm theo tên sản phẩm (nến bơ, hoa sen, hũ búp sen, khay oval) hoặc SKU..."
                    aria-label="Tìm kiếm sản phẩm"
                    className="h-10 pl-9"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {cfg?.wholesaleEnabled !== false && (
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
                            ? 'bg-amber-600 text-white shadow-2xs'
                            : 'text-amber-800 hover:text-amber-900 dark:text-amber-300'
                        )}
                      >
                        Hiển thị Giá Sỉ
                      </button>
                    </div>
                  )}

                  <select
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

              {categories.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCat('ALL')
                      setSelectedCollectionId('ALL')
                    }}
                    className={cn(
                      'inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                      selectedCat === 'ALL' && selectedCollectionId === 'ALL'
                        ? 'border-stone-900 bg-stone-900 text-white dark:border-amber-600 dark:bg-amber-600'
                        : 'bg-background text-foreground hover:bg-muted'
                    )}
                  >
                    Tất cả ({products.length})
                  </button>
                  {activeCollectionBanner && (
                    <div className="inline-flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSelectedCollectionId('ALL')}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-amber-600 bg-amber-600 px-3.5 text-xs font-bold text-white"
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
                  {categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCat(cat.id)}
                      className={cn(
                        'inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-semibold transition-colors',
                        selectedCat === cat.id
                          ? 'border-stone-900 bg-stone-900 text-white dark:border-amber-600 dark:bg-amber-600'
                          : 'bg-background text-foreground hover:bg-muted'
                      )}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {loading ? (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-80 animate-pulse rounded-2xl border bg-muted/40" />
                ))}
              </div>
            ) : storeData?.storefrontClosed || cfg?.enabled === false ? (
              <div className="rounded-2xl border border-amber-300/80 bg-amber-50/70 py-14 px-6 text-center dark:border-amber-900 dark:bg-amber-950/30">
                <Store className="mx-auto mb-3 h-10 w-10 text-amber-700 dark:text-amber-400" />
                <p className="text-base font-bold text-foreground">
                  Website hiện đang tạm ngưng nhận đơn trực tuyến để cập nhật danh mục
                </p>
                <p className="mx-auto mt-1.5 max-w-lg text-xs text-muted-foreground">
                  Quý khách vẫn có thể tra cứu trạng thái đơn hàng đã đặt hoặc liên hệ trực tiếp Hotline / Zalo của {brandName} để được phục vụ ngay.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <Button type="button" size="sm" onClick={() => setActiveTab('CONTACT')}>
                    Xem Thông tin Liên hệ &amp; Zalo
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setActiveTab('TRACKING')}>
                    Tra cứu đơn hàng
                  </Button>
                </div>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="rounded-2xl border border-dashed py-16 text-center">
                <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
                <p className="text-base font-semibold">Không tìm thấy sản phẩm phù hợp</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Hãy thử từ khóa khác hoặc xem toàn bộ bộ sưu tập.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredProducts.map((p) => {
                  const firstWs = p.wholesalePrices[0]
                  const bestWs = p.wholesalePrices[p.wholesalePrices.length - 1]
                  return (
                    <Card
                      key={p.id}
                      className="group flex flex-col overflow-hidden border-border/80 transition-all hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedProduct(p)}
                        className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-stone-100/70 p-3 text-left dark:bg-stone-900/50"
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
                          <Badge className="absolute top-3 left-3 bg-stone-900/85 text-[10px] font-semibold text-white backdrop-blur-xs">
                            {p.variantLabel}
                          </Badge>
                        )}
                        {bestWs && (
                          <Badge className="absolute top-3 right-3 border-amber-300 bg-amber-500 text-[10px] font-bold text-stone-950">
                            Sỉ từ {formatVND(bestWs.unitPrice)}
                          </Badge>
                        )}
                      </button>

                      <CardContent className="flex flex-1 flex-col justify-between gap-3 p-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-[10.5px] text-muted-foreground">
                              {p.sku}
                            </span>
                            <span className="text-[10.5px] font-medium text-emerald-700 dark:text-emerald-400">
                              {p.stockLabel}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setSelectedProduct(p)}
                            className="text-left"
                          >
                            <h2 className="line-clamp-2 text-sm font-bold leading-snug text-foreground hover:text-[#0066CC]">
                              {p.cleanTitle}
                            </h2>
                          </button>
                          {p.variantLabel && (
                            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
                              Phân loại: {p.variantLabel}
                            </p>
                          )}
                        </div>

                        <div className="space-y-2.5 border-t pt-3">
                          {priceViewMode === 'WHOLESALE' && p.wholesalePrices.length > 0 ? (
                            <div className="space-y-1 rounded-xl border border-amber-200/80 bg-amber-50/60 p-2 text-[11px] dark:border-amber-900/60 dark:bg-amber-950/30">
                              <div className="flex justify-between text-muted-foreground">
                                <span>Giá lẻ niêm yết:</span>
                                <span className="line-through">{formatVND(p.retailPrice)}</span>
                              </div>
                              {p.wholesalePrices.map((wp) => (
                                <div key={wp.tierId} className="flex justify-between font-semibold">
                                  <span>Từ {wp.minQty} SP ({wp.badge}):</span>
                                  <span className="font-bold text-amber-800 dark:text-amber-300">
                                    {formatVND(wp.unitPrice)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-baseline justify-between gap-2">
                                <p className="text-base font-extrabold text-[#0066CC] dark:text-sky-400">
                                  {formatVND(p.retailPrice)}
                                </p>
                                <span className="text-[11px] text-muted-foreground">
                                  / {p.unit}
                                </span>
                              </div>
                              {firstWs && (
                                <p className="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300">
                                  Giá sỉ từ {firstWs.minQty} SP:{' '}
                                  <strong>{formatVND(firstWs.unitPrice)}</strong>
                                </p>
                              )}
                            </div>
                          )}

                          <div className="grid grid-cols-5 gap-1.5">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedImageIdx(0)
                                setSelectedProduct(p)
                              }}
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
                                addToCart(p, priceViewMode === 'WHOLESALE' && firstWs ? firstWs.minQty : 1)
                              }
                              className="col-span-3 h-10 gap-1 bg-stone-900 px-2.5 text-xs font-bold text-white hover:bg-stone-800 dark:bg-[#0066CC] dark:hover:bg-[#0055B3]"
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
        {activeTab === 'WHOLESALE' && (
          <div className="space-y-8">
            <div className="grid gap-4 md:grid-cols-3">
              {wholesaleTiers.map((tier, idx) => (
                <Card
                  key={tier.id}
                  className={cn(
                    'border-2',
                    idx === 1
                      ? 'border-amber-500 bg-amber-50/40 shadow-sm dark:bg-amber-950/20'
                      : 'border-border'
                  )}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <Badge className="bg-amber-600 text-xs font-bold text-white">
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
              {/* Bảng ma trận giá sỉ toàn bộ SKU */}
              <Card className="lg:col-span-7">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-5 w-5 text-amber-700" />
                    Bảng Báo Giá Sỉ Niêm Yết Theo Từng Mã Sản Phẩm ({products.length} mã)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {cfg?.wholesalePolicyNote}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b bg-muted/60 font-bold text-foreground">
                        <tr>
                          <th className="px-3 py-2.5">Sản phẩm / Phân loại</th>
                          <th className="px-3 py-2.5 text-right">Giá lẻ</th>
                          {wholesaleTiers.map((t) => (
                            <th
                              key={t.id}
                              className="px-3 py-2.5 text-right text-amber-800 dark:text-amber-300"
                            >
                              Từ {t.minQty} SP ({t.badge})
                            </th>
                          ))}
                          <th className="px-3 py-2.5 text-center">Chọn sỉ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {products.map((p) => (
                          <tr key={p.id} className="hover:bg-muted/30">
                            <td className="px-3 py-2.5">
                              <p className="font-mono text-[10px] text-muted-foreground">{p.sku}</p>
                              <p className="font-semibold text-foreground">{p.cleanTitle}</p>
                              {p.variantLabel && (
                                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                                  Phân loại: {p.variantLabel}
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right font-medium text-muted-foreground">
                              {formatVND(p.retailPrice)}
                            </td>
                            {wholesaleTiers.map((t) => {
                              const wp =
                                p.wholesalePrices.find((x) => x.tierId === t.id)?.unitPrice ??
                                computeDiscountedPriceClient(p.retailPrice, t.discountPercent)
                              return (
                                <td
                                  key={t.id}
                                  className="px-3 py-2.5 text-right font-bold text-foreground"
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
                                onClick={() => addToCart(p, 10)}
                                className="h-8 px-2.5 text-[11px] font-semibold"
                              >
                                +10
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Form Đăng ký Báo giá sỉ & Gia công OEM */}
              <Card className="border-amber-300/80 lg:col-span-5 dark:border-amber-900">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Calculator className="h-5 w-5 text-amber-700" />
                    Đăng Ký Nhận Báo Giá Sỉ &amp; Gia Công Quà Tặng (OEM)
                  </CardTitle>
                  <CardDescription className="text-xs">
                    {cfg?.oemCustomNote}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {wholesaleSubmittedCode ? (
                    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/40">
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
                      <div className="rounded-xl border bg-amber-50/60 p-3 text-xs dark:bg-amber-950/30">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">Sản lượng dự kiến mỗi đơn:</span>
                          <span className="font-bold text-amber-800 dark:text-amber-300">
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
                            value={wsPhone}
                            onChange={(e) => setWsPhone(e.target.value)}
                            placeholder="0909..."
                            required
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ws-shop">Tên Shop / Spa / Doanh nghiệp</Label>
                          <Input
                            id="ws-shop"
                            value={wsShopName}
                            onChange={(e) => setWsShopName(e.target.value)}
                            placeholder="An Nhiên Spa / Quà tặng ABC..."
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ws-qty">Số lượng sỉ dự kiến (SP)</Label>
                          <Input
                            id="ws-qty"
                            type="number"
                            min={10}
                            value={wsEstimatedQty}
                            onChange={(e) => setWsEstimatedQty(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-addr">Tỉnh/Thành phố nhận hàng</Label>
                          <Input
                            id="ws-addr"
                            value={wsAddress}
                            onChange={(e) => setWsAddress(e.target.value)}
                            placeholder="TP.HCM, Hà Nội, Đà Nẵng..."
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-email">Email nhận bảng giá PDF/Excel (tùy chọn)</Label>
                          <Input
                            id="ws-email"
                            type="email"
                            value={wsEmail}
                            onChange={(e) => setWsEmail(e.target.value)}
                            placeholder="purchasing@company.vn"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-2">
                          <Label htmlFor="ws-note">Ghi chú mẫu quan tâm / Yêu cầu in logo OEM</Label>
                          <Textarea
                            id="ws-note"
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
                        className="h-11 w-full gap-2 bg-amber-700 text-xs font-bold text-white hover:bg-amber-800"
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
                    <Building2 className="h-5 w-5 text-[#0066CC]" />
                    Thông Tin Liên Hệ Chính Thức — {brandName}
                  </CardTitle>
                  <CardDescription>
                    Kết nối trực tiếp với Xưởng sản xuất &amp; Bộ phận CSKH lẻ / sỉ
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  {contact?.hotline && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Phone className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#0066CC]" />
                      <div>
                        <p className="text-xs text-muted-foreground">Hotline Tư vấn &amp; Đặt sỉ nhanh</p>
                        <a
                          href={`tel:${contact.hotline.replace(/\s+/g, '')}`}
                          className="text-base font-extrabold text-foreground hover:text-[#0066CC]"
                        >
                          {contact.hotline}
                        </a>
                      </div>
                    </div>
                  )}

                  {contact?.zaloUrl && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <MessageCircle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-sky-600" />
                      <div>
                        <p className="text-xs text-muted-foreground">Zalo Chăm sóc Khách hàng &amp; Báo Sỉ</p>
                        <a
                          href={contact.zaloUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-bold text-[#0066CC] hover:underline"
                        >
                          <span>Nhắn Zalo trực tiếp ({contact.zaloPhone || contact.hotline})</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
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
                          className="inline-flex items-center gap-1 font-bold text-orange-600 hover:underline"
                        >
                          <span>{contact.shopeeUrl}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </div>
                  )}

                  {contact?.email && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Mail className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-600" />
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
                      <MapPin className="mt-0.5 h-4.5 w-4.5 shrink-0 text-rose-600" />
                      <div>
                        <p className="text-xs text-muted-foreground">Địa chỉ Xưởng &amp; Kho Trung Tâm</p>
                        <p className="font-medium text-foreground">{contact.address}</p>
                      </div>
                    </div>
                  )}

                  {contact?.workingHours && (
                    <div className="flex items-start gap-3 rounded-xl border p-3">
                      <Clock className="mt-0.5 h-4.5 w-4.5 shrink-0 text-amber-600" />
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
                    <Send className="h-5 w-5 text-[#0066CC]" />
                    Gửi Tin Nhắn Tư Vấn Trực Tuyến
                  </CardTitle>
                  <CardDescription>
                    Mọi câu hỏi về sản phẩm, mùi hương nến bơ, phối màu khay thạch cao hoặc đặt quà sự kiện sẽ được chuyển thẳng vào Hộp thư CSKH của CMS.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {contactSubmittedCode && (
                    <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
                      Đã tiếp nhận tin nhắn mã <strong>{contactSubmittedCode}</strong>. Cảm ơn bạn đã liên hệ {brandName}!
                    </div>
                  )}
                  <form onSubmit={handleContactSubmit} className="space-y-3.5">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor="ct-name">Họ và tên *</Label>
                        <Input
                          id="ct-name"
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
                          value={ctPhone}
                          onChange={(e) => setCtPhone(e.target.value)}
                          placeholder="0909..."
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ct-email">Email (tùy chọn)</Label>
                      <Input
                        id="ct-email"
                        type="email"
                        value={ctEmail}
                        onChange={(e) => setCtEmail(e.target.value)}
                        placeholder="ban@email.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ct-msg">Nội dung cần hỗ trợ *</Label>
                      <Textarea
                        id="ct-msg"
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
                      className="h-11 w-full gap-2 bg-[#0066CC] text-xs font-bold text-white hover:bg-[#0055B3]"
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
                  <FileSearch className="h-5 w-5 text-[#0066CC]" />
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
                      value={lookupPhone}
                      onChange={(e) => setLookupPhone(e.target.value)}
                      placeholder="VD: 0909686868"
                      required
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={lookupLoading}
                    className="h-11 w-full bg-[#0066CC] text-xs font-bold text-white hover:bg-[#0055B3]"
                  >
                    {lookupLoading ? 'Đang kiểm tra...' : 'Tra cứu ngay'}
                  </Button>
                </form>

                {lookupError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                    {lookupError}
                  </div>
                )}

                {lookupResult && (
                  <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
                    <p className="font-mono text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      Mã: {lookupResult.code}
                    </p>
                    {lookupResult.title && <p className="font-medium">{lookupResult.title}</p>}
                    <p>
                      Trạng thái:{' '}
                      <Badge variant="outline" className="font-semibold">
                        {lookupResult.status === 'RECEIVED_PENDING_CONFIRM'
                          ? 'Đã tiếp nhận — Đang chờ CSKH xác nhận giao hàng'
                          : lookupResult.status === 'RECEIVED_WHOLESALE_LEAD'
                            ? 'Đã tiếp nhận — Bộ phận Sỉ đang lập báo giá'
                            : lookupResult.status}
                      </Badge>
                    </p>
                    {typeof lookupResult.total === 'number' && (
                      <p>
                        Tổng thanh toán: <strong>{formatVND(lookupResult.total)}</strong>
                      </p>
                    )}
                    {lookupResult.tierApplied && (
                      <p>Mức chiết khấu sỉ: {lookupResult.tierApplied}</p>
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
              <li>
                <button
                  type="button"
                  onClick={() => setActiveTab('WHOLESALE')}
                  className="hover:text-foreground hover:underline"
                >
                  Bảng giá sỉ tận xưởng (Từ 10 · 30 · 100 sản phẩm)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setActiveTab('CONTACT')}
                  className="hover:text-foreground hover:underline"
                >
                  Đặt gia công quà tặng doanh nghiệp (OEM)
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => setActiveTab('TRACKING')}
                  className="hover:text-foreground hover:underline"
                >
                  Tra cứu đơn hàng trực tuyến
                </button>
              </li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-foreground">Kết nối đa kênh</p>
            {contact?.hotline && <p>Hotline / Zalo: {contact.hotline}</p>}
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
            <div className="flex items-center gap-3 pt-1">
              {!isCustomDomainHost && (
                <Link href="/blog" className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
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

      {/* Hộp thoại Xem Chi Tiết Sản Phẩm (Quick-View Modal) */}
      <Dialog
        open={Boolean(selectedProduct)}
        onOpenChange={(open) => {
          if (!open) setSelectedProduct(null)
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
          {selectedProduct && (
            <>
              <DialogHeader>
                <DialogTitle className="text-base leading-snug">
                  {selectedProduct.cleanTitle}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Mã SKU: <strong className="font-mono">{selectedProduct.sku}</strong>
                  {selectedProduct.variantLabel
                    ? ` · Phân loại: ${selectedProduct.variantLabel}`
                    : ''}{' '}
                  · {selectedProduct.stockLabel}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border bg-muted/30 p-2">
                    {(selectedProduct.images[selectedImageIdx] || selectedProduct.image) ? (
                      <img
                        src={selectedProduct.images[selectedImageIdx] || selectedProduct.image || ''}
                        alt={selectedProduct.name}
                        className="h-full w-full rounded-xl object-cover"
                      />
                    ) : (
                      <ProductAvatar name={selectedProduct.name} className="h-24 w-24 text-2xl" />
                    )}
                  </div>
                  {selectedProduct.images.length > 1 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1">
                      {selectedProduct.images.map((imgUrl, idx) => (
                        <button
                          key={imgUrl}
                          type="button"
                          onClick={() => setSelectedImageIdx(idx)}
                          className={cn(
                            'h-12 w-12 shrink-0 overflow-hidden rounded-lg border-2 transition-all',
                            selectedImageIdx === idx
                              ? 'border-[#0066CC] ring-1 ring-[#0066CC]'
                              : 'border-transparent opacity-70 hover:opacity-100'
                          )}
                        >
                          <img src={imgUrl} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col justify-between space-y-4">
                  <div className="space-y-3">
                    <div>
                      <span className="text-xs text-muted-foreground">Giá bán lẻ niêm yết:</span>
                      <p className="text-2xl font-extrabold text-[#0066CC] dark:text-sky-400">
                        {formatVND(selectedProduct.retailPrice)}{' '}
                        <span className="text-xs font-normal text-muted-foreground">
                          / {selectedProduct.unit}
                        </span>
                      </p>
                    </div>

                    {selectedProduct.wholesalePrices.length > 0 && (
                      <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900 dark:bg-amber-950/30">
                        <p className="font-bold text-amber-950 dark:text-amber-200">
                          Bảng Giá Sỉ Xưởng (Gộp mẫu tự do):
                        </p>
                        {selectedProduct.wholesalePrices.map((wp) => (
                          <div key={wp.tierId} className="flex items-center justify-between">
                            <span>
                              Từ {wp.minQty} {selectedProduct.unit} ({wp.badge}):
                            </span>
                            <strong className="text-amber-900 dark:text-amber-300">
                              {formatVND(wp.unitPrice)} / {selectedProduct.unit}
                            </strong>
                          </div>
                        ))}
                      </div>
                    )}

                    {selectedProduct.description && (
                      <div className="max-h-36 overflow-y-auto whitespace-pre-line rounded-xl border bg-muted/20 p-3 text-xs leading-relaxed text-muted-foreground">
                        {selectedProduct.description}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        disabled={!selectedProduct.availableToOrder}
                        onClick={() => {
                          addToCart(selectedProduct, 1)
                          setSelectedProduct(null)
                        }}
                        className="h-10 gap-1.5 bg-[#0066CC] text-xs font-bold text-white hover:bg-[#0055B3]"
                      >
                        <Plus className="h-4 w-4" />
                        {selectedProduct.availableToOrder ? 'Mua lẻ (+1)' : 'Tạm hết hàng'}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!selectedProduct.availableToOrder}
                        onClick={() => {
                          addToCart(selectedProduct, 10)
                          setSelectedProduct(null)
                          setCartOpen(true)
                        }}
                        className="h-10 gap-1.5 border-amber-400 text-xs font-bold text-amber-900 dark:text-amber-300"
                      >
                        <BadgePercent className="h-4 w-4" />
                        Nhập sỉ (+10)
                      </Button>
                    </div>
                    {selectedProduct.shopeeUrl && (
                      <Button asChild variant="ghost" size="sm" className="w-full gap-1.5 text-xs">
                        <a
                          href={selectedProduct.shopeeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <span>Xem sản phẩm này trên Shopee</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Hộp thoại Giỏ hàng & Đặt hàng (Tự động tính cả Giá Lẻ & Giá Sỉ theo tổng số lượng!) */}
      <Dialog open={cartOpen} onOpenChange={setCartOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-[#0066CC]" />
              Giỏ hàng &amp; Đặt mua Trực tuyến
            </DialogTitle>
            <DialogDescription>
              Tự động áp dụng chiết khấu Giá Sỉ tận xưởng khi tổng giỏ hàng từ 10 sản phẩm trở lên.
            </DialogDescription>
          </DialogHeader>

          {completedOrder ? (
            <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
              <p className="text-base font-bold text-emerald-900 dark:text-emerald-200">
                Đặt hàng thành công!
              </p>
              <p className="text-xs text-emerald-800 dark:text-emerald-300">
                Mã đơn hàng của bạn:{' '}
                <strong className="font-mono text-sm">{completedOrder.refCode}</strong>
              </p>
              <p className="text-xs font-semibold">
                Tổng thanh toán: {formatVND(completedOrder.grandTotal)}
                {completedOrder.tierLabel ? ` (${completedOrder.tierLabel})` : ''}
              </p>
              <Button
                type="button"
                className="h-10 bg-[#0066CC] text-white hover:bg-[#0055B3]"
                onClick={() => {
                  setCompletedOrder(null)
                  setCartOpen(false)
                }}
              >
                Tiếp tục mua sắm
              </Button>
            </div>
          ) : cart.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Giỏ hàng đang trống — hãy chọn sản phẩm lẻ hoặc sỉ để đặt mua.
            </div>
          ) : (
            <div className="space-y-4">
              {activeCartWholesaleTier ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50/80 px-3 py-2 text-xs font-semibold text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  🎉 Đã kích hoạt <strong>{activeCartWholesaleTier.label}</strong>: Giảm ngay{' '}
                  <strong>{formatVND(wholesaleSavings)}</strong> trên đơn này!
                </div>
              ) : (
                nextWholesaleTierHint && (
                  <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                    Mua thêm{' '}
                    <strong className="text-foreground">
                      {nextWholesaleTierHint.minQty - totalCartItems} sản phẩm
                    </strong>{' '}
                    bất kỳ để nhận giá sỉ <strong>{nextWholesaleTierHint.badge}</strong>!
                  </div>
                )
              )}

              <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                {cart.map((it) => {
                  const unitPrice = activeCartWholesaleTier
                    ? computeDiscountedPriceClient(
                        it.product.retailPrice,
                        activeCartWholesaleTier.discountPercent
                      )
                    : it.product.retailPrice
                  return (
                    <div
                      key={it.product.id}
                      className="flex items-center justify-between gap-2 rounded-xl border bg-muted/30 p-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{it.product.cleanTitle}</p>
                        <p className="text-muted-foreground">
                          {formatVND(unitPrice)} / {it.product.unit}
                          {it.product.variantLabel ? ` · ${it.product.variantLabel}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          aria-label="Giảm số lượng"
                          onClick={() => updateCartQty(it.product.id, -1)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center font-bold">{it.quantity}</span>
                        <Button
                          type="button"
                          size="icon"
                          variant="outline"
                          className="h-8 w-8"
                          aria-label="Tăng số lượng"
                          onClick={() => updateCartQty(it.product.id, 1)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-rose-600"
                          aria-label="Xóa khỏi giỏ"
                          onClick={() => updateCartQty(it.product.id, -it.quantity)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Nguyễn Minh Trân"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="store-cust-phone">Số điện thoại *</Label>
                  <Input
                    id="store-cust-phone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="0909..."
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-addr">Địa chỉ giao hàng chi tiết *</Label>
                  <Input
                    id="store-cust-addr"
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Số nhà, đường, phường/xã, quận/huyện, tỉnh/thành..."
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="store-cust-note">Ghi chú đơn hàng (tùy chọn)</Label>
                  <Textarea
                    id="store-cust-note"
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
                    'min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'COD'
                      ? 'border-[#0066CC] bg-sky-50 text-[#0066CC] dark:bg-sky-950/50 dark:text-sky-300'
                      : 'bg-card text-muted-foreground'
                  )}
                >
                  Thanh toán khi nhận hàng (COD)
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('BANK_TRANSFER')}
                  className={cn(
                    'min-h-10 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors',
                    paymentMethod === 'BANK_TRANSFER'
                      ? 'border-[#0066CC] bg-sky-50 text-[#0066CC] dark:bg-sky-950/50 dark:text-sky-300'
                      : 'bg-card text-muted-foreground'
                  )}
                >
                  Chuyển khoản Ngân hàng
                </button>
              </div>

              {paymentMethod === 'BANK_TRANSFER' && storeData?.bankTransfer && (
                <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs dark:border-sky-900 dark:bg-sky-950/30">
                  <p className="font-bold text-sky-900 dark:text-sky-200">
                    Thông tin chuyển khoản thanh toán:
                  </p>
                  <p className="mt-0.5">
                    Ngân hàng: <strong>{storeData.bankTransfer.bankName}</strong> · STK:{' '}
                    <strong className="font-mono">{storeData.bankTransfer.bankAccount}</strong>
                  </p>
                  {storeData.bankTransfer.bankHolder && (
                    <p>Chủ TK: {storeData.bankTransfer.bankHolder}</p>
                  )}
                </div>
              )}

              <div className="space-y-1 rounded-xl border bg-muted/40 p-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Tạm tính ({totalCartItems} sản phẩm):
                  </span>
                  <span className="font-medium">{formatVND(effectiveCartSubtotal)}</span>
                </div>
                {wholesaleSavings > 0 && (
                  <div className="flex justify-between text-amber-800 dark:text-amber-300">
                    <span>Tiết kiệm chiết khấu sỉ:</span>
                    <span className="font-bold">-{formatVND(wholesaleSavings)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Truck className="h-3.5 w-3.5" /> Phí giao hàng:
                  </span>
                  <span className="font-medium">
                    {shippingFee === 0
                      ? `Miễn phí (Đơn ≥ ${formatVND(freeShipThreshold)})`
                      : formatVND(shippingFee)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1.5 text-sm font-bold text-foreground">
                  <span>Tổng thanh toán:</span>
                  <span className="text-[#0066CC] dark:text-sky-400">{formatVND(grandTotal)}</span>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  disabled={submittingOrder}
                  onClick={() => void handleCheckout()}
                  className="h-11 w-full bg-[#0066CC] text-sm font-bold text-white hover:bg-[#0055B3]"
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
