'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Barcode,
  Banknote,
  Boxes,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Coins,
  Copy,
  CreditCard,
  Crown,
  FileText,
  History,
  LayoutGrid,
  List,
  Loader2,
  Minus,
  Package,
  PackageCheck,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Search,
  Share2,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Truck,
  UserCheck,
  UserPlus,
  Users,
  Warehouse,
  X,
  Zap,
} from 'lucide-react'

import { apiGet, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { printReceipt } from '@/lib/escpos'
import { DEFAULT_LOYALTY_CONFIG, type LoyaltyPolicyConfig } from '@/lib/loyalty-policy-shared'
import {
  MEMBER_TIERS,
  pointsForTotal,
  type Category,
  type Channel,
  type Customer,
  type Order,
  type Product,
  type VoucherInfo,
  type WarehouseInfo,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { OrderStatusBadge } from '@/components/cms/status-badge'

interface PosCartItem {
  productId: string
  sku: string
  name: string
  price: number
  basePrice?: number
  quantity: number
  maxStock: number
  type?: string
  image?: string | null
  barcode?: string | null
  baseUnit?: string
  unitMultiplier?: number
  unitLabel?: string
  defaultSellRate?: number
  quickQuantities?: number[]
}

interface PosOrderTab {
  id: string
  label: string
  createdAt: string
  items: PosCartItem[]
  customer: Customer | null
  fulfillmentMode: 'PICKUP_AT_WAREHOUSE' | 'SHIP_FROM_WAREHOUSE'
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
  discountAmount: string
  voucherCode: string
  redeemPoints: string
  shippingFee: string
  shippingAddress: string
  cashReceived: string
  note: string
}

interface CompletedPosReceipt {
  order: Order
  invoiceCode?: string | null
  customer: Customer | null
  fulfillmentMode: 'PICKUP_AT_WAREHOUSE' | 'SHIP_FROM_WAREHOUSE'
  discountAmount: number
  redeemPoints: number
  pointsEarned: number
  cashReceived: number
  changeDue: number
  cashierTime: string
}

function createEmptyTab(index: number): PosOrderTab {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return {
    id: `pos-tab-${Date.now()}-${index}`,
    label: `Đơn ${index}`,
    createdAt: `${hh}:${mm}`,
    items: [],
    customer: null,
    fulfillmentMode: 'PICKUP_AT_WAREHOUSE',
    paymentMethod: 'CASH',
    discountAmount: '0',
    voucherCode: '',
    redeemPoints: '0',
    shippingFee: '0',
    shippingAddress: '',
    cashReceived: '',
    note: '',
  }
}

const TIER_MAP = Object.fromEntries(MEMBER_TIERS.map((t) => [t.key, t]))

export function PosView({ standalone = false }: { standalone?: boolean } = {}) {
  const { toast } = useToast()

  // ===== Dữ liệu kho hàng, danh mục, kênh bán & khách hàng =====
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseInfo[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('')
  const [vouchers, setVouchers] = useState<VoucherInfo[]>([])
  const [loyaltyPolicy, setLoyaltyPolicy] = useState<LoyaltyPolicyConfig>(DEFAULT_LOYALTY_CONFIG)
  const [activeWaveCode, setActiveWaveCode] = useState<string>('DOT-2026-01')
  const [runningCampaigns, setRunningCampaigns] = useState<
    Array<{
      id: string
      code: string
      name: string
      discountPercent?: number | null
      discountAmount?: number | null
      voucherCode?: string | null
      appliedProductIds?: string[]
      products?: Array<{ id: string; sku: string; originalPrice: number; campaignPrice: number }>
    }>
  >([])
  const [recentPosOrders, setRecentPosOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)

  // ===== Bộ lọc tìm kiếm hàng hóa tại kho =====
  const [searchQuery, setSearchQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [stockFilter, setStockFilter] = useState<'ALL' | 'IN_STOCK' | 'COMBO' | 'LOW_STOCK'>('IN_STOCK')
  const [layoutMode, setLayoutMode] = useState<'grid' | 'table'>('grid')
  const [mobileSection, setMobileSection] = useState<'catalog' | 'checkout'>('catalog')

  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const barcodeInputRef = useRef<HTMLInputElement | null>(null)

  // ===== Quản lý nhiều hóa đơn chờ cùng lúc (Multi-Tab OPENVN POS) =====
  const [tabs, setTabs] = useState<PosOrderTab[]>(() => [createEmptyTab(1)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const nextTabCounter = useRef(2)

  // ===== Tùy chọn xuất chứng từ & in hóa đơn nhiệt K80 =====
  const [autoIssueInvoice, setAutoIssueInvoice] = useState(true)
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // ===== Tìm & tạo nhanh khách hàng tại quầy =====
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerDropdownOpen, setCustomerDropdownOpen] = useState(false)
  const [newCustomerOpen, setNewCustomerOpen] = useState(false)
  const [newCustomerForm, setNewCustomerForm] = useState({
    name: '',
    phone: '',
    address: '',
    registerMember: true,
  })
  const [creatingCustomer, setCreatingCustomer] = useState(false)

  // ===== Dialog In phiếu xuất kho / Hóa đơn K80 & Lịch sử đơn ca trực =====
  const [receiptModal, setReceiptModal] = useState<CompletedPosReceipt | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  // ===== Tối ưu trải nghiệm Mobile POS: Quét Camera & Thu gọn Ưu đãi =====
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [cameraFilter, setCameraFilter] = useState('')
  const [showPromoMobile, setShowPromoMobile] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const lastScannedRef = useRef<{ code: string; time: number }>({ code: '', time: 0 })

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  )

  const updateActiveTab = useCallback(
    (updater: (prev: PosOrderTab) => PosOrderTab) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? updater(t) : t)))
    },
    [activeTab.id]
  )

  // Kênh POS (ưu tiên channel key === 'POS')
  const posChannel = useMemo(
    () => channels.find((c) => c.key.toUpperCase() === 'POS') ?? channels[0] ?? null,
    [channels]
  )

  // Giá bán áp dụng tại kho POS (ưu tiên giá riêng kênh POS nếu có)
  const getPosPrice = useCallback(
    (product: Product): number => {
      if (!posChannel) return product.sellPrice
      const listing = (product.listings ?? []).find((l) => l.channelId === posChannel.id)
      return listing?.price ?? product.sellPrice
    },
    [posChannel]
  )

  // Tồn kho khả dụng (với Combo lấy comboAvailable hoặc stock)
  const getAvailableStock = useCallback((product: Product): number => {
    if (product.type === 'COMBO') {
      return product.comboAvailable ?? product.stock
    }
    return product.stock
  }, [])

  // ===== Tải dữ liệu kho & danh mục =====
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const [prodRes, catRes, chRes, custRes, whRes, vchRes, polRes, campRes] = await Promise.all([
        apiGet<{ products: Product[] }>('/api/products?status=ACTIVE'),
        apiGet<{ categories: Category[] }>('/api/categories'),
        apiGet<{ channels: Channel[] }>('/api/channels'),
        apiGet<{ customers: Customer[] }>('/api/customers'),
        apiGet<{ warehouses: WarehouseInfo[] }>('/api/warehouses').catch(() => ({ warehouses: [] })),
        apiGet<{ vouchers: VoucherInfo[] }>('/api/vouchers').catch(() => ({ vouchers: [] })),
        apiGet<{ activeWave: { waveCode: string }; policy: LoyaltyPolicyConfig }>('/api/loyalty-policy').catch(
          () => null
        ),
        apiGet<{ campaigns: typeof runningCampaigns }>('/api/campaigns?status=RUNNING').catch(() => ({
          campaigns: [],
        })),
      ])
      setProducts(prodRes.products)
      setCategories(catRes.categories)
      setChannels(chRes.channels)
      setCustomers(custRes.customers)
      setWarehouses(whRes.warehouses)
      setVouchers(vchRes.vouchers.filter((v) => v.active))
      if (polRes?.policy) {
        setLoyaltyPolicy(polRes.policy)
        setActiveWaveCode(polRes.activeWave?.waveCode || 'DOT-2026-01')
      }
      if (Array.isArray(campRes?.campaigns)) {
        setRunningCampaigns(campRes.campaigns)
      }
      if (!selectedWarehouseId && whRes.warehouses.length > 0) {
        const def = whRes.warehouses.find((w) => w.isDefault) ?? whRes.warehouses[0]
        setSelectedWarehouseId(def.id)
      }

      const posCh = chRes.channels.find((c) => c.key.toUpperCase() === 'POS')
      if (posCh) {
        const ordRes = await apiGet<{ orders: Order[] }>(
          `/api/orders?channelId=${posCh.id}&pageSize=10`
        )
        setRecentPosOrders(ordRes.orders)
      }
    } catch (err) {
      if (!silent) {
        toast({
          title: 'Không thể tải dữ liệu kho POS',
          description: err instanceof Error ? err.message : 'Vui lòng thử lại',
          variant: 'destructive',
        })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // ===== Thêm sản phẩm vào đơn đang chọn =====
  const addProductToCart = useCallback(
    (product: Product, addQty = 1) => {
      const maxStock = getAvailableStock(product)
      if (maxStock <= 0) {
        toast({
          title: `Sản phẩm "${product.name}" đã hết hàng trong kho`,
          description: `Mã SKU: ${product.sku} · Tồn kho: 0`,
          variant: 'destructive',
        })
        return false
      }

      const price = getPosPrice(product)
      const uc = product.unitConfig
      const defaultSellRate = uc?.sellRate || 1
      const baseUnit = uc?.baseUnit || product.unit || 'cái'
      const unitLabel = uc?.sellUnit || baseUnit
      const quickQuantities =
        uc?.posQuickQuantities && uc.posQuickQuantities.length > 0
          ? uc.posQuickQuantities
          : defaultSellRate > 1 || baseUnit === 'gr' || baseUnit === 'ml'
            ? [100, 200, 500, 1000]
            : undefined
      let exceeded = false

      updateActiveTab((tab) => {
        const existing = tab.items.find((it) => it.productId === product.id)
        const currentQty = existing?.quantity ?? 0
        const mult = existing?.unitMultiplier ?? defaultSellRate
        if ((currentQty + addQty) * mult > maxStock) {
          exceeded = true
          return tab
        }
        const nextItems = existing
          ? tab.items.map((it) =>
              it.productId === product.id
                ? { ...it, quantity: it.quantity + addQty, maxStock }
                : it
            )
          : [
              ...tab.items,
              {
                productId: product.id,
                sku: product.sku,
                name: product.name,
                price,
                basePrice: price,
                quantity: addQty,
                maxStock,
                type: product.type,
                image: product.image,
                barcode: product.barcode,
                baseUnit,
                unitMultiplier: defaultSellRate,
                unitLabel,
                defaultSellRate,
                quickQuantities,
              },
            ]
        return { ...tab, items: nextItems }
      })

      if (exceeded) {
        toast({
          title: `Vượt quá tồn kho tại chỗ (${maxStock})`,
          description: `${product.name} (${product.sku}) chỉ còn tối đa ${maxStock} sản phẩm.`,
          variant: 'destructive',
        })
        return false
      }
      return true
    },
    [getAvailableStock, getPosPrice, toast, updateActiveTab]
  )

  // ===== Quét mã vạch hoặc nhập SKU nhanh (F2) =====
  const handleBarcodeSubmit = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim()
      if (!code) return
      const exactMatch =
        products.find(
          (p) =>
            (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
            p.sku.toLowerCase() === code.toLowerCase()
        ) ?? null

      if (!exactMatch) {
        toast({
          title: `Không tìm thấy mã vạch / SKU "${code}"`,
          description: 'Vui lòng kiểm tra lại tem mã vạch hoặc tìm theo tên sản phẩm.',
          variant: 'destructive',
        })
        return
      }

      const added = addProductToCart(exactMatch, 1)
      if (added) {
        setBarcodeInput('')
        toast({
          title: `Đã thêm +1 ${exactMatch.name}`,
          description: `${exactMatch.sku} · ${formatVND(getPosPrice(exactMatch))}`,
        })
      }
    },
    [products, addProductToCart, getPosPrice, toast]
  )

  // ===== Cập nhật số lượng từng dòng =====
  const updateItemQty = (productId: string, nextQty: number) => {
    updateActiveTab((tab) => {
      if (nextQty <= 0) {
        return { ...tab, items: tab.items.filter((it) => it.productId !== productId) }
      }
      return {
        ...tab,
        items: tab.items.map((it) => {
          if (it.productId !== productId) return it
          const mult = it.unitMultiplier || 1
          if (nextQty * mult > it.maxStock) {
            toast({
              title: `Tồn kho chỉ còn ${formatNumber(it.maxStock)} ${it.baseUnit || 'SP'}`,
              description: it.name,
              variant: 'destructive',
            })
            return { ...it, quantity: Math.max(1, Math.floor(it.maxStock / mult)) }
          }
          return { ...it, quantity: nextQty }
        }),
      }
    })
  }

  // ===== Đổi định lượng bán nhanh (VD: 100gr / 200gr / 500gr / 1kg) =====
  const updateItemUnitMultiplier = (productId: string, nextMult: number, nextLabel: string) => {
    updateActiveTab((tab) => ({
      ...tab,
      items: tab.items.map((it) => {
        if (it.productId !== productId) return it
        const defRate = it.defaultSellRate || 1000
        const basePrice = it.basePrice ?? it.price
        const nextPrice = Math.max(0, Math.round(basePrice * (nextMult / defRate)))
        return {
          ...it,
          unitMultiplier: nextMult,
          unitLabel: nextLabel,
          price: nextPrice,
        }
      }),
    }))
  }

  const removeCartItem = (productId: string) => {
    updateActiveTab((tab) => ({
      ...tab,
      items: tab.items.filter((it) => it.productId !== productId),
    }))
  }

  // ===== Quản lý các Tab đơn hàng tại quầy =====
  const addNewOrderTab = () => {
    const idx = nextTabCounter.current++
    const newTab = createEmptyTab(idx)
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const closeOrderTab = (tabId: string) => {
    if (tabs.length <= 1) {
      // Nếu chỉ còn 1 tab thì làm mới tab đó
      const resetTab = createEmptyTab(1)
      setTabs([resetTab])
      setActiveTabId(resetTab.id)
      return
    }
    const remaining = tabs.filter((t) => t.id !== tabId)
    setTabs(remaining)
    if (activeTab.id === tabId) {
      setActiveTabId(remaining[remaining.length - 1].id)
    }
  }

  // ===== Lọc danh sách sản phẩm hiển thị tại kho =====
  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.categoryId !== selectedCategory) return false
      const avail = getAvailableStock(p)
      if (stockFilter === 'IN_STOCK' && avail <= 0) return false
      if (stockFilter === 'COMBO' && p.type !== 'COMBO') return false
      if (stockFilter === 'LOW_STOCK' && avail > p.lowStockThreshold) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, searchQuery, selectedCategory, stockFilter, getAvailableStock])

  // Bản đồ số lượng đang nằm trong giỏ của từng SP
  const cartQtyByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const it of activeTab.items) {
      map.set(it.productId, it.quantity)
    }
    return map
  }, [activeTab.items])

  // ===== Tính toán tổng tiền, chiết khấu, đổi điểm, tiền thừa trả khách =====
  const subtotal = useMemo(
    () => activeTab.items.reduce((sum, it) => sum + it.price * it.quantity, 0),
    [activeTab.items]
  )
  const totalQuantity = useMemo(
    () => activeTab.items.reduce((sum, it) => sum + it.quantity, 0),
    [activeTab.items]
  )
  const shippingFee = useMemo(() => {
    if (activeTab.fulfillmentMode === 'PICKUP_AT_WAREHOUSE') return 0
    if (subtotal >= 500000) return 0
    const parsed = Number(activeTab.shippingFee)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : 30000
  }, [activeTab.fulfillmentMode, activeTab.shippingFee, subtotal])

  const selectedWarehouse = useMemo(
    () => warehouses.find((w) => w.id === selectedWarehouseId) ?? warehouses[0] ?? null,
    [warehouses, selectedWarehouseId]
  )

  const applyVoucherToTab = useCallback(
    (v: VoucherInfo) => {
      if (subtotal < v.minOrderAmount) {
        toast({
          title: `Chưa đủ điều kiện áp mã ${v.code}`,
          description: `Đơn tối thiểu ${formatVND(v.minOrderAmount)} (cần mua thêm ${formatVND(
            v.minOrderAmount - subtotal
          )})`,
          variant: 'destructive',
        })
        return
      }
      let disc = 0
      if (v.discountType === 'PERCENT') {
        disc = Math.round((subtotal * v.discountValue) / 100)
        if (v.maxDiscount && v.maxDiscount > 0) disc = Math.min(disc, v.maxDiscount)
      } else if (v.discountType === 'FIXED') {
        disc = Math.min(subtotal, Math.round(v.discountValue))
      } else if (v.discountType === 'FREESHIP') {
        disc = Math.min(shippingFee > 0 ? shippingFee : 30000, Math.round(v.discountValue))
      }
      updateActiveTab((tab) => ({
        ...tab,
        voucherCode: v.code,
        discountAmount: String(disc),
        shippingFee: v.discountType === 'FREESHIP' ? '0' : tab.shippingFee,
      }))
      toast({
        title: `Đã áp mã ${v.code}`,
        description: `${v.title} (-${formatVND(disc)})`,
      })
    },
    [subtotal, shippingFee, toast, updateActiveTab]
  )

  // Tự động cập nhật lại mức giảm của Voucher khi tổng tiền giỏ hàng thay đổi
  useEffect(() => {
    if (!activeTab.voucherCode) return
    const v = vouchers.find((x) => x.code === activeTab.voucherCode)
    if (!v) return
    if (subtotal < v.minOrderAmount) {
      updateActiveTab((tab) => ({
        ...tab,
        voucherCode: '',
        discountAmount: '0',
      }))
      return
    }
    let disc = 0
    if (v.discountType === 'PERCENT') {
      disc = Math.round((subtotal * v.discountValue) / 100)
      if (v.maxDiscount && v.maxDiscount > 0) disc = Math.min(disc, v.maxDiscount)
    } else if (v.discountType === 'FIXED') {
      disc = Math.min(subtotal, Math.round(v.discountValue))
    } else if (v.discountType === 'FREESHIP') {
      disc = Math.min(shippingFee > 0 ? shippingFee : 30000, Math.round(v.discountValue))
    }
    if (String(disc) !== activeTab.discountAmount) {
      updateActiveTab((tab) => ({
        ...tab,
        discountAmount: String(disc),
      }))
    }
  }, [subtotal, shippingFee, activeTab.voucherCode, activeTab.discountAmount, vouchers, updateActiveTab])

  const maxRedeemablePoints = useMemo(() => {
    if (!activeTab.customer?.isMember) return 0
    const custPoints = activeTab.customer.points ?? 0
    const rate = loyaltyPolicy.redeemVndPerPoint || 1000
    const maxPct = loyaltyPolicy.maxRedeemPct || 100
    if (loyaltyPolicy.minOrderForRedeem > 0 && subtotal < loyaltyPolicy.minOrderForRedeem) return 0
    const maxAllowedVnd = Math.floor(((subtotal + shippingFee) * maxPct) / 100)
    const maxBySubtotal = Math.floor(maxAllowedVnd / rate)
    return Math.max(0, Math.min(custPoints, maxBySubtotal))
  }, [activeTab.customer, subtotal, shippingFee, loyaltyPolicy])

  const redeemPoints = useMemo(() => {
    if (!activeTab.customer?.isMember) return 0
    const raw = Math.max(0, Math.floor(Number(activeTab.redeemPoints) || 0))
    return Math.min(raw, maxRedeemablePoints)
  }, [activeTab.customer, activeTab.redeemPoints, maxRedeemablePoints])

  const pointsDiscount = redeemPoints * (loyaltyPolicy.redeemVndPerPoint || 1000)
  const manualDiscount = Math.max(0, Math.round(Number(activeTab.discountAmount) || 0))
  const totalDiscount = Math.min(subtotal + shippingFee, manualDiscount + pointsDiscount)
  const grandTotal = Math.max(0, subtotal + shippingFee - totalDiscount)
  const estimatedPointsEarned = useMemo(() => {
    if (!activeTab.customer?.isMember) return 0
    const earnRate = loyaltyPolicy.earnVndPerPoint || 10000
    const tierKey = activeTab.customer.tier?.key || 'MEMBER'
    const tierMult = loyaltyPolicy.tiers.find((t) => t.key === tierKey)?.pointsMultiplier || 1.0
    const basePts = Math.max(0, Math.floor(grandTotal / earnRate))
    return Math.max(0, Math.floor(basePts * tierMult))
  }, [activeTab.customer, grandTotal, loyaltyPolicy])

  const cashReceivedNum = useMemo(() => {
    const raw = Number(activeTab.cashReceived)
    if (!activeTab.cashReceived.trim() || !Number.isFinite(raw)) return grandTotal
    return Math.max(0, Math.round(raw))
  }, [activeTab.cashReceived, grandTotal])

  const changeDue = Math.max(0, cashReceivedNum - grandTotal)

  // ===== Tìm kiếm khách hàng tại quầy =====
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase()
    if (!q) return customers.slice(0, 8)
    return customers
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q) ||
          (c.memberCode ?? '').toLowerCase().includes(q)
      )
      .slice(0, 8)
  }, [customers, customerSearch])

  const handleQuickCreateCustomer = async () => {
    if (!newCustomerForm.name.trim()) {
      toast({ title: 'Vui lòng nhập tên khách hàng', variant: 'destructive' })
      return
    }
    setCreatingCustomer(true)
    try {
      const res = await apiPost<{ customer: Customer }>('/api/customers', {
        name: newCustomerForm.name.trim(),
        phone: newCustomerForm.phone.trim() || undefined,
        address: newCustomerForm.address.trim() || undefined,
      })
      let created = res.customer
      if (newCustomerForm.registerMember) {
        try {
          const memRes = await apiPost<{ customer: Customer }>(
            `/api/customers/${created.id}/member`,
            {}
          )
          created = memRes.customer
        } catch {
          // giữ khách hàng vừa tạo nếu nâng cấp lỗi
        }
      }
      setCustomers((prev) => [created, ...prev])
      updateActiveTab((tab) => ({
        ...tab,
        customer: created,
        shippingAddress: created.address ?? tab.shippingAddress,
      }))
      setNewCustomerOpen(false)
      setNewCustomerForm({ name: '', phone: '', address: '', registerMember: true })
      toast({
        title: created.isMember
          ? `Đã tạo Hội viên ${created.name} (${created.memberCode})`
          : `Đã thêm khách hàng ${created.name}`,
      })
    } catch (err) {
      toast({
        title: 'Không thể tạo khách hàng',
        description: err instanceof Error ? err.message : 'Đã xảy ra lỗi',
        variant: 'destructive',
      })
    } finally {
      setCreatingCustomer(false)
    }
  }

  // ===== Xử lý Thanh toán & Xuất kho (F9) =====
  const handleCheckout = useCallback(async () => {
    if (!posChannel) {
      toast({ title: 'Chưa tìm thấy kênh bán POS', variant: 'destructive' })
      return
    }
    if (activeTab.items.length === 0) {
      toast({
        title: 'Giỏ hàng tại kho đang trống',
        description: 'Vui lòng quét mã vạch hoặc chọn ít nhất 1 sản phẩm để xuất bán.',
        variant: 'destructive',
      })
      return
    }
    if (
      activeTab.fulfillmentMode === 'SHIP_FROM_WAREHOUSE' &&
      !activeTab.shippingAddress.trim() &&
      !activeTab.customer?.address
    ) {
      toast({
        title: 'Vui lòng nhập địa chỉ giao hàng',
        description: 'Đơn đóng gói & giao từ kho cần có địa chỉ người nhận.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const isPickup = activeTab.fulfillmentMode === 'PICKUP_AT_WAREHOUSE'
      const whLabel = selectedWarehouse ? `[Kho: ${selectedWarehouse.name}]` : '[Kho Trung Tâm Ưu Đàm]'
      const noteParts: string[] = [
        isPickup ? `[POS Tại Kho - Nhận hàng ngay] ${whLabel}` : `[POS Tại Kho - Đóng gói giao đi] ${whLabel}`,
      ]
      if (activeTab.voucherCode) {
        noteParts.push(`Voucher ${activeTab.voucherCode}`)
      }
      if (manualDiscount > 0) {
        noteParts.push(`Chiết khấu trực tiếp: -${formatVND(manualDiscount)}`)
      }
      if (redeemPoints > 0) {
        noteParts.push(`Đổi ${redeemPoints} điểm: -${formatVND(pointsDiscount)}`)
      }
      if (activeTab.note.trim()) {
        noteParts.push(activeTab.note.trim())
      }

      const nowDate = new Date()
      const yy = String(nowDate.getFullYear()).slice(-2)
      const mm = String(nowDate.getMonth() + 1).padStart(2, '0')
      const dd = String(nowDate.getDate()).padStart(2, '0')
      const fallbackCode = `DH${yy}${mm}${dd}-${String(Math.floor(1000 + Math.random() * 9000))}`
      const fallbackCustomerName = activeTab.customer?.name || 'Khách mua trực tiếp tại kho'

      const res = await apiPost<{ order: Order }>('/api/orders', {
        code: fallbackCode,
        channelId: posChannel.id,
        channel: {
          id: posChannel.id,
          key: posChannel.key,
          name: posChannel.name,
          color: posChannel.color,
        },
        warehouseId: selectedWarehouse?.id,
        voucherCode: activeTab.voucherCode || undefined,
        items: activeTab.items.map((it, idx) => ({
          id: `pos-item-${Date.now()}-${idx}`,
          productId: it.productId,
          quantity: it.quantity,
          price: it.price,
          unitMultiplier: it.unitMultiplier,
          unitLabel: it.unitLabel,
          product: {
            id: it.productId,
            sku: it.sku,
            name: it.name,
          },
        })),
        customerId: activeTab.customer?.id,
        customerName: fallbackCustomerName,
        customerPhone: activeTab.customer?.phone || undefined,
        customer: {
          id: activeTab.customer?.id || 'pos-guest',
          name: fallbackCustomerName,
          phone: activeTab.customer?.phone || null,
        },
        address: isPickup
          ? `Nhận trực tiếp tại ${selectedWarehouse?.name ?? 'Kho Ưu Đàm'}`
          : activeTab.shippingAddress.trim() || activeTab.customer?.address || undefined,
        note: noteParts.join(' · '),
        paymentMethod: activeTab.paymentMethod,
        status: isPickup ? 'COMPLETED' : 'CONFIRMED',
        paymentStatus: isPickup ? 'PAID' : 'UNPAID',
        subtotal,
        shippingFee,
        discountAmount: manualDiscount,
        total: grandTotal,
        redeemPoints,
        instantComplete: isPickup,
      })

      const normalizedOrder: Order = {
        ...res.order,
        id: res.order?.id || `pos-${Date.now()}`,
        code: res.order?.code || fallbackCode,
        status: res.order?.status || (isPickup ? 'COMPLETED' : 'CONFIRMED'),
        paymentMethod: res.order?.paymentMethod || activeTab.paymentMethod,
        paymentStatus: res.order?.paymentStatus || (isPickup ? 'PAID' : 'UNPAID'),
        subtotal: Number.isFinite(Number(res.order?.subtotal)) ? Number(res.order.subtotal) : subtotal,
        shippingFee: Number.isFinite(Number(res.order?.shippingFee)) ? Number(res.order.shippingFee) : shippingFee,
        total: Number.isFinite(Number(res.order?.total)) ? Number(res.order.total) : grandTotal,
        channel: res.order?.channel?.name
          ? res.order.channel
          : {
              id: posChannel.id,
              key: posChannel.key,
              name: posChannel.name,
              color: posChannel.color,
            },
        customer: res.order?.customer?.name
          ? res.order.customer
          : {
              id: activeTab.customer?.id || 'pos-guest',
              name: fallbackCustomerName,
              phone: activeTab.customer?.phone || null,
            },
        items:
          Array.isArray(res.order?.items) && res.order.items.length > 0
            ? res.order.items.map((it, idx) => {
                const cartItem =
                  activeTab.items.find((c) => c.productId === it.productId) ?? activeTab.items[idx]
                const safePrice = Number.isFinite(Number(it.price))
                  ? Number(it.price)
                  : (cartItem?.price ?? 0)
                return {
                  ...it,
                  id: it.id || `pos-item-${idx}`,
                  price: safePrice,
                  quantity: Number(it.quantity) || cartItem?.quantity || 1,
                  product: it.product?.name
                    ? it.product
                    : {
                        id: cartItem?.productId || it.productId,
                        sku: cartItem?.sku || 'SKU',
                        name: cartItem?.name || 'Sản phẩm',
                      },
                }
              })
            : activeTab.items.map((it, idx) => ({
                id: `pos-item-${idx}`,
                orderId: res.order?.id || 'pos',
                productId: it.productId,
                quantity: it.quantity,
                price: it.price,
                product: {
                  id: it.productId,
                  sku: it.sku,
                  name: it.name,
                },
              })),
      }

      let issuedInvoiceCode: string | null = null
      if (autoIssueInvoice && isPickup) {
        try {
          const invRes = await apiPost<{ invoice: { code: string } }>('/api/sales-invoices', {
            orderId: normalizedOrder.id,
            note: `Xuất hóa đơn tự động từ quầy POS tại kho (${normalizedOrder.code})`,
          })
          issuedInvoiceCode = invRes.invoice?.code || null
        } catch {
          // Không chặn luồng thanh toán nếu kỳ kế toán khóa
        }
      }

      const receipt: CompletedPosReceipt = {
        order: normalizedOrder,
        invoiceCode: issuedInvoiceCode,
        customer: activeTab.customer,
        fulfillmentMode: activeTab.fulfillmentMode,
        discountAmount: totalDiscount,
        redeemPoints,
        pointsEarned: estimatedPointsEarned,
        cashReceived: cashReceivedNum,
        changeDue,
        cashierTime: formatDateTime(new Date().toISOString()),
      }

      toast({
        title: `Thanh toán thành công đơn ${normalizedOrder.code}`,
        description: `${formatVND(normalizedOrder.total)}${
          issuedInvoiceCode ? ` · Phiếu xuất/HĐ: ${issuedInvoiceCode}` : ''
        }`,
      })

      if (autoPrintReceipt) {
        setReceiptModal(receipt)
      }

      // Làm mới giỏ hàng hiện tại & tải lại tồn kho
      updateActiveTab((tab) => ({
        ...createEmptyTab(Number(tab.label.replace(/\D/g, '')) || 1),
        id: tab.id,
        label: tab.label,
      }))
      setMobileSection('catalog')
      void loadData(true)
    } catch (err) {
      toast({
        title: 'Không thể hoàn tất thanh toán POS',
        description: err instanceof Error ? err.message : 'Vui lòng kiểm tra lại tồn kho',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }, [
    posChannel,
    selectedWarehouse,
    activeTab,
    manualDiscount,
    redeemPoints,
    pointsDiscount,
    shippingFee,
    autoIssueInvoice,
    totalDiscount,
    estimatedPointsEarned,
    cashReceivedNum,
    changeDue,
    autoPrintReceipt,
    toast,
    updateActiveTab,
    loadData,
  ])

  // ===== Quét mã vạch / QR bằng Camera điện thoại (HTML5 getUserMedia + BarcodeDetector) =====
  useEffect(() => {
    if (!cameraOpen) return
    let activeStream: MediaStream | null = null
    let scanTimer: ReturnType<typeof setInterval> | null = null
    let cancelled = false
    setCameraError(null)

    const startCamera = async () => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Trình duyệt hiện tại chưa cấp quyền Camera. Bạn có thể chạm chọn nhanh mã SKU bên dưới.')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        activeStream = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => null)
        }

        const BarcodeDetectorCtor = (
          window as unknown as {
            BarcodeDetector?: new (opts?: { formats?: string[] }) => {
              detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
            }
          }
        ).BarcodeDetector

        if (BarcodeDetectorCtor) {
          const detector = new BarcodeDetectorCtor({
            formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'qr_code', 'upc_a', 'upc_e'],
          })
          scanTimer = setInterval(async () => {
            if (!videoRef.current || videoRef.current.readyState < 2) return
            try {
              const codes = await detector.detect(videoRef.current)
              const raw = codes[0]?.rawValue?.trim()
              if (raw) {
                const now = Date.now()
                if (lastScannedRef.current.code === raw && now - lastScannedRef.current.time < 1800) {
                  return
                }
                lastScannedRef.current = { code: raw, time: now }
                if (typeof navigator.vibrate === 'function') navigator.vibrate(60)
                handleBarcodeSubmit(raw)
              }
            } catch {
              // Bỏ qua frame lỗi
            }
          }, 260)
        }
      } catch {
        setCameraError('Không mở được Camera sau (hoặc chưa cấp quyền). Hãy chạm chọn nhanh mã vạch bên dưới.')
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      if (scanTimer) clearInterval(scanTimer)
      if (activeStream) activeStream.getTracks().forEach((t) => t.stop())
    }
  }, [cameraOpen, handleBarcodeSubmit])

  const handleShareReceipt = useCallback(
    async (rec: CompletedPosReceipt) => {
      const lines = [
        `HÓA ĐƠN POS ƯU ĐÀM — ${rec.order.code}`,
        `Thời gian: ${rec.cashierTime}`,
        `Khách hàng: ${rec.customer?.name ?? 'Khách mua tại kho'}`,
        `------------------------`,
        ...rec.order.items.map(
          (it) => `• ${it.product?.name ?? 'Sản phẩm'}: ${it.quantity} x ${formatVND(it.price)} = ${formatVND(it.quantity * it.price)}`
        ),
        `------------------------`,
        `Tổng thanh toán: ${formatVND(rec.order.total)} (${rec.order.paymentMethod})`,
        `Cảm ơn Quý khách đã mua sắm tại Kho Ưu Đàm!`,
      ]
      const text = lines.join('\n')
      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({ title: `Hóa đơn ${rec.order.code}`, text })
          return
        }
      } catch {
        // fallback copy
      }
      try {
        await navigator.clipboard.writeText(text)
        toast({
          title: 'Đã sao chép nội dung hóa đơn',
          description: 'Bạn có thể dán gửi ngay qua Zalo / SMS cho khách hàng.',
        })
      } catch {
        toast({ title: 'Đã tạo tóm tắt hóa đơn', description: rec.order.code })
      }
    },
    [toast]
  )

  // ===== Phím tắt bàn phím chuẩn OPENVN POS (F2, F3, F9) =====
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        barcodeInputRef.current?.focus()
      } else if (e.key === 'F3') {
        e.preventDefault()
        searchInputRef.current?.focus()
      } else if (e.key === 'F9') {
        e.preventDefault()
        if (!submitting && activeTab.items.length > 0) {
          void handleCheckout()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, activeTab.items.length, handleCheckout])

  return (
    <div className="space-y-3">
      {/* ===== THANH ĐIỀU KHIỂN ĐẦU TRANG OPENVN POS (ĐA HÓA ĐƠN CHỜ + KHO XUẤT) ===== */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/80 bg-[#182537] px-3 py-2 text-white shadow-sm">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          <div className="mr-2 flex shrink-0 items-center gap-2 border-r border-white/15 pr-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0066CC] text-white shadow-xs">
              <Store className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-bold leading-tight">OPENVN POS · Bán Tại Kho</p>
              {warehouses.length > 0 ? (
                <select
                  value={selectedWarehouseId}
                  onChange={(e) => setSelectedWarehouseId(e.target.value)}
                  aria-label="Chọn kho xuất bán"
                  className="mt-0.5 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-sky-200 outline-none hover:bg-white/20"
                >
                  {warehouses.map((wh) => (
                    <option key={wh.id} value={wh.id} className="bg-slate-900 text-white">
                      {wh.name} {wh.type === 'PARTNER_SHOP' ? `(Liên kết · HH ${wh.commissionPct}%)` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-[10px] text-slate-300">Kho Trung Tâm Ưu Đàm</p>
              )}
            </div>
          </div>

          {/* Các Tab đơn hàng đang mở song song */}
          {tabs.map((tab) => {
            const isCurrent = tab.id === activeTab.id
            const itemCount = tab.items.reduce((s, i) => s + i.quantity, 0)
            return (
              <div
                key={tab.id}
                className={cn(
                  'group flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
                  isCurrent
                    ? 'bg-[#0066CC] font-semibold text-white shadow-xs'
                    : 'bg-white/10 text-slate-200 hover:bg-white/15'
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="flex items-center gap-1.5"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                  {itemCount > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10px] font-bold',
                        isCurrent ? 'bg-white text-[#0066CC]' : 'bg-[#0066CC] text-white'
                      )}
                    >
                      {itemCount}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => closeOrderTab(tab.id)}
                  title="Đóng hoặc làm mới đơn này"
                  aria-label={`Đóng ${tab.label}`}
                  className="ml-0.5 rounded p-0.5 opacity-75 hover:bg-black/20 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}

          <Button
            size="sm"
            variant="ghost"
            onClick={addNewOrderTab}
            className="h-8 shrink-0 gap-1 border border-dashed border-white/25 px-2.5 text-xs text-slate-200 hover:bg-white/10 hover:text-white"
          >
            <Plus className="h-3.5 w-3.5" /> Thêm đơn chờ
          </Button>
        </div>

        {/* Cụm phím tắt & Lịch sử đơn POS trong ca */}
        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 text-[11px] text-slate-300 xl:flex">
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">F2: Mã vạch</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">F3: Tìm hàng</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono">F9: Thanh toán</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setHistoryOpen(true)}
            className="h-8 gap-1.5 bg-white/10 px-2.5 text-xs text-white hover:bg-white/20"
          >
            <History className="h-3.5 w-3.5" />
            <span>Đơn tại kho ({recentPosOrders.length})</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void loadData()}
            className="h-8 w-8 p-0 text-slate-200 hover:bg-white/10 hover:text-white"
            title="Làm mới tồn kho"
            aria-label="Làm mới tồn kho"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* ===== THANH CHUYỂN NHANH 2 MÀN HÌNH TRÊN ĐIỆN THOẠI / TABLET (< lg): CHỌN HÀNG <-> THANH TOÁN ===== */}
      <div className="sticky top-13 z-10 grid grid-cols-2 gap-1.5 rounded-xl border border-border/90 bg-card/95 p-1 shadow-xs backdrop-blur-md lg:hidden">
        <button
          type="button"
          onClick={() => setMobileSection('catalog')}
          className={cn(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-all',
            mobileSection === 'catalog'
              ? 'bg-[#0066CC] text-white shadow-xs'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <Package className="h-4 w-4 shrink-0" />
          <span>Chọn hàng ({filteredProducts.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileSection('checkout')}
          className={cn(
            'flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold transition-all',
            mobileSection === 'checkout'
              ? 'bg-[#0066CC] text-white shadow-xs'
              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
          )}
        >
          <ShoppingBag className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Giỏ &amp; Thu tiền{totalQuantity > 0 ? ` (${totalQuantity} · ${formatVND(grandTotal)})` : ' (0)'}
          </span>
        </button>
      </div>

      {/* ===== BỐ CỤC 2 CỘT CHUẨN OPENVN POS: TRÁI (KHO HÀNG HÓA) — PHẢI (HÓA ĐƠN THANH TOÁN) ===== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ==================== CỘT TRÁI (7/12): QUÉT MÃ VẠCH & CHỌN HÀNG TẠI KHO ==================== */}
        <div
          className={cn(
            'flex-col gap-3 lg:col-span-7 lg:flex',
            mobileSection === 'catalog' ? 'flex' : 'hidden'
          )}
        >
          <Card className="border-border/80 shadow-xs">
            <CardContent className="space-y-3 p-3.5">
              {/* Hàng 1: Quét mã vạch (F2) + Camera Mobile + Tìm tên/SKU (F3) + Chuyển kiểu hiển thị */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="flex flex-1 items-center gap-1.5">
                  <form
                    className="relative flex-1"
                    onSubmit={(e) => {
                      e.preventDefault()
                      handleBarcodeSubmit(barcodeInput)
                    }}
                  >
                    <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0066CC]" />
                    <Input
                      ref={barcodeInputRef}
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      placeholder="Mã vạch / SKU + Enter..."
                      aria-label="Quét mã vạch hoặc nhập SKU"
                      className="h-10 border-[#0066CC]/40 bg-sky-50/40 pl-9 pr-16 text-base font-medium focus-visible:ring-[#0066CC] sm:h-9 sm:text-xs dark:bg-sky-950/20"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="absolute right-1.5 top-1/2 h-7 -translate-y-1/2 bg-[#0066CC] px-2.5 text-xs font-semibold text-white hover:bg-[#0055B3] sm:text-[11px]"
                    >
                      Thêm
                    </Button>
                  </form>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCameraOpen(true)}
                    className="h-10 shrink-0 gap-1.5 border-[#0066CC]/50 bg-[#0066CC]/10 px-3 text-xs font-bold text-[#0066CC] hover:bg-[#0066CC] hover:text-white sm:h-9 dark:text-sky-300"
                    title="Quét mã vạch / QR bằng Camera điện thoại"
                  >
                    <Camera className="h-4 w-4 shrink-0" />
                    <span>Quét Cam</span>
                  </Button>
                </div>

                <div className="flex flex-1 items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={searchInputRef}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Tìm theo tên hàng hóa, mã SKU..."
                      aria-label="Tìm theo tên hàng hóa hoặc mã SKU"
                      className="h-10 pl-9 pr-8 text-base sm:h-9 sm:text-xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Xóa từ khóa tìm kiếm"
                        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex h-10 shrink-0 items-center rounded-lg border bg-muted/40 p-0.5 sm:h-9">
                    <button
                      type="button"
                      onClick={() => setLayoutMode('grid')}
                      aria-label="Hiển thị dạng lưới thẻ"
                      className={cn(
                        'flex h-full items-center justify-center rounded-md px-2.5 transition-colors md:px-1.5',
                        layoutMode === 'grid'
                          ? 'bg-card text-[#0066CC] shadow-2xs'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode('table')}
                      aria-label="Hiển thị dạng bảng tồn kho"
                      className={cn(
                        'flex h-full items-center justify-center rounded-md px-2.5 transition-colors md:px-1.5',
                        layoutMode === 'table'
                          ? 'bg-card text-[#0066CC] shadow-2xs'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Hàng 2: Bộ lọc nhanh Tồn kho & Danh mục sản phẩm (Cuộn ngang mượt trên điện thoại) */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
                {(
                  [
                    { key: 'IN_STOCK', label: 'Còn tồn kho' },
                    { key: 'ALL', label: 'Tất cả hàng' },
                    { key: 'COMBO', label: 'Combo / Bộ quà' },
                    { key: 'LOW_STOCK', label: 'Sắp hết hàng' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setStockFilter(f.key)}
                    className={cn(
                      'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-2.5 sm:py-1 sm:text-[11px]',
                      stockFilter === f.key
                        ? 'bg-[#0066CC] font-semibold text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                    )}
                  >
                    {f.label}
                  </button>
                ))}

                <Separator orientation="vertical" className="mx-1 h-4 shrink-0" />

                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={cn(
                    'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:px-2.5 sm:py-1 sm:text-[11px]',
                    selectedCategory === 'ALL'
                      ? 'border-[#0066CC] bg-[#0066CC]/10 font-semibold text-[#0066CC] dark:text-sky-300'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  )}
                >
                  Mọi danh mục ({products.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      'shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors sm:px-2.5 sm:py-1 sm:text-[11px]',
                      selectedCategory === cat.id
                        ? 'border-[#0066CC] bg-[#0066CC]/10 font-semibold text-[#0066CC] dark:text-sky-300'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Danh sách sản phẩm tại kho (Grid hoặc Table) */}
          <Card className="flex-1 border-border/80 shadow-xs">
            <CardContent className="p-3 sm:p-3.5">
              {loading ? (
                <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin text-[#0066CC]" />
                  Đang tải danh mục hàng trong kho...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                  <Warehouse className="h-9 w-9 text-muted-foreground/50" />
                  <p className="text-sm font-semibold">Không tìm thấy mặt hàng phù hợp trong kho</p>
                  <p className="text-xs text-muted-foreground">
                    Thử đổi bộ lọc danh mục hoặc tìm kiếm bằng từ khóa khác.
                  </p>
                </div>
              ) : layoutMode === 'grid' ? (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:max-h-[620px] lg:overflow-y-auto lg:pr-1">
                  {filteredProducts.map((p) => {
                    const avail = getAvailableStock(p)
                    const price = getPosPrice(p)
                    const inCartQty = cartQtyByProduct.get(p.id) ?? 0
                    const outOfStock = avail <= 0
                    const isLow = avail > 0 && avail <= p.lowStockThreshold

                    return (
                      <div
                        key={p.id}
                        role="button"
                        tabIndex={outOfStock ? -1 : 0}
                        onClick={() => {
                          if (!outOfStock) addProductToCart(p, 1)
                        }}
                        onKeyDown={(e) => {
                          if (!outOfStock && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault()
                            addProductToCart(p, 1)
                          }
                        }}
                        className={cn(
                          'group relative flex flex-col justify-between rounded-xl border p-2.5 text-left transition-all select-none sm:p-3',
                          outOfStock
                            ? 'cursor-not-allowed border-border/50 bg-muted/40 opacity-60'
                            : inCartQty > 0
                              ? 'cursor-pointer border-[#0066CC] bg-[#0066CC]/[0.04] shadow-xs ring-1 ring-[#0066CC]/35 active:scale-[0.99]'
                              : 'cursor-pointer border-border/80 bg-card hover:-translate-y-0.5 hover:border-[#0066CC]/60 hover:shadow-sm active:scale-[0.99]'
                        )}
                      >
                        {inCartQty > 0 && (
                          <span className="absolute right-2 top-2 rounded-full bg-[#0066CC] px-2 py-0.5 text-[10px] font-bold text-white shadow-xs">
                            Đã chọn: {inCartQty}
                          </span>
                        )}

                        <div className="flex items-start gap-2.5">
                          <ProductAvatar name={p.name} image={p.image} className="h-10 w-10 shrink-0 rounded-lg" />
                          <div className="min-w-0 flex-1 pr-6">
                            <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground">
                              {p.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <span className="font-mono text-[10px] text-muted-foreground">{p.sku}</span>
                              {p.type === 'COMBO' && (
                                <Badge
                                  variant="outline"
                                  className="h-4 border-violet-300 px-1 text-[9px] font-semibold text-violet-700 dark:border-violet-800 dark:text-violet-300"
                                >
                                  Combo
                                </Badge>
                              )}
                              {p.crossSellRate && p.crossSellRate > 0 ? (
                                <Badge
                                  variant="outline"
                                  className="h-4 border-amber-300 bg-amber-50/80 px-1 text-[9px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                >
                                  Bán chéo · HH {p.crossSellRate}%
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <div className="mt-2.5 border-t border-border/50 pt-2">
                          <div className="flex items-end justify-between">
                            <div>
                              <p className="text-sm font-bold tabular-nums text-[#0066CC] dark:text-sky-400">
                                {formatVND(price)}
                              </p>
                              {p.warehouseStocks && p.warehouseStocks.length > 0 && selectedWarehouse ? (
                                (() => {
                                  const atThisWh =
                                    p.warehouseStocks.find((ws) => ws.warehouseId === selectedWarehouse.id)
                                      ?.quantity ?? 0
                                  const atOtherWh = Math.max(0, avail - atThisWh)
                                  return (
                                    <p className="text-[10px] text-muted-foreground">
                                      Kho này: <strong className="text-foreground">{atThisWh}</strong>
                                      {atOtherWh > 0 ? ` · Liên kết: +${atOtherWh}` : ''}
                                    </p>
                                  )
                                })()
                              ) : p.barcode ? (
                                <p className="font-mono text-[10px] text-muted-foreground">{p.barcode}</p>
                              ) : null}
                            </div>
                            <span
                              className={cn(
                                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                                outOfStock
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : isLow
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              )}
                            >
                              {outOfStock ? 'Hết hàng' : `Tồn: ${avail}`}
                            </span>
                          </div>

                          {/* Cụm tăng/giảm số lượng trực tiếp 1 chạm trên thẻ sản phẩm (rất tiện trên điện thoại) */}
                          {inCartQty > 0 && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2 flex items-center justify-between rounded-lg bg-[#0066CC]/10 p-1 dark:bg-sky-950/60"
                            >
                              <button
                                type="button"
                                onClick={() => updateItemQty(p.id, inCartQty - 1)}
                                aria-label={`Giảm số lượng ${p.name}`}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-background text-foreground shadow-2xs active:scale-95"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="text-xs font-extrabold tabular-nums text-[#0066CC] dark:text-sky-300">
                                {inCartQty} SP
                              </span>
                              <button
                                type="button"
                                onClick={() => addProductToCart(p, 1)}
                                aria-label={`Tăng số lượng ${p.name}`}
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0066CC] text-white shadow-2xs active:scale-95"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="overflow-x-auto lg:max-h-[620px] lg:overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 border-b bg-muted/80 text-[11px] font-semibold text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-2.5 py-2">Sản phẩm / SKU</th>
                        <th className="px-2.5 py-2">Mã vạch</th>
                        <th className="px-2.5 py-2 text-right">Tồn kho</th>
                        <th className="px-2.5 py-2 text-right">Giá POS</th>
                        <th className="px-2.5 py-2 text-right">Chọn</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredProducts.map((p) => {
                        const avail = getAvailableStock(p)
                        const price = getPosPrice(p)
                        const inCartQty = cartQtyByProduct.get(p.id) ?? 0
                        return (
                          <tr key={p.id} className="hover:bg-muted/40">
                            <td className="px-2.5 py-2">
                              <p className="font-medium text-foreground">{p.name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{p.sku}</p>
                            </td>
                            <td className="px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                              {p.barcode ?? '—'}
                            </td>
                            <td className="px-2.5 py-2 text-right font-semibold tabular-nums">
                              {avail}
                            </td>
                            <td className="px-2.5 py-2 text-right font-bold tabular-nums text-[#0066CC] dark:text-sky-400">
                              {formatVND(price)}
                            </td>
                            <td className="px-2.5 py-2 text-right">
                              <Button
                                size="sm"
                                disabled={avail <= 0}
                                onClick={() => addProductToCart(p, 1)}
                                className="h-7 bg-[#0066CC] px-2.5 text-[11px] text-white hover:bg-[#0055B3]"
                              >
                                <Plus className="mr-1 h-3 w-3" />
                                {inCartQty > 0 ? `Thêm (${inCartQty})` : 'Chọn'}
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ==================== CỘT PHẢI (5/12): PHIẾU BÁN HÀNG TẠI KHO & THANH TOÁN ==================== */}
        <div
          className={cn(
            'flex-col gap-3 lg:col-span-5 lg:flex',
            mobileSection === 'checkout' ? 'flex' : 'hidden'
          )}
        >
          <Card className="border-border/80 shadow-sm">
            <CardContent className="space-y-3.5 p-3.5 sm:p-4">
              {/* Nút quay lại chọn thêm hàng hóa trên điện thoại (< lg) */}
              <div className="flex items-center justify-between border-b pb-2.5 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileSection('catalog')}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-3 text-xs font-semibold text-foreground active:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5 text-[#0066CC]" />
                  <span>Chọn thêm hàng hóa</span>
                </button>
                <span className="text-xs font-bold text-[#0066CC] tabular-nums">
                  {totalQuantity} SP · {formatVND(grandTotal)}
                </span>
              </div>
              {/* 1. KHÁCH HÀNG & THẺ HỘI VIÊN (F4) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <Users className="h-3.5 w-3.5 text-[#0066CC]" />
                    Khách mua tại kho
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNewCustomerOpen(true)}
                    className="h-6 gap-1 px-2 text-[11px] font-semibold text-[#0066CC] hover:bg-[#0066CC]/10 dark:text-sky-400"
                  >
                    <UserPlus className="h-3 w-3" /> + Thêm khách / Hội viên mới
                  </Button>
                </div>

                {activeTab.customer ? (
                  <div className="rounded-xl border border-[#0066CC]/30 bg-sky-50/50 p-3 dark:bg-sky-950/25">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <UserCheck className="h-4 w-4 shrink-0 text-[#0066CC]" />
                          <span className="truncate text-sm font-bold">{activeTab.customer.name}</span>
                          {activeTab.customer.isMember && (
                            <Badge className="bg-[#0066CC] px-1.5 py-0 text-[10px] text-white">
                              {activeTab.customer.memberCode}
                            </Badge>
                          )}
                          {activeTab.customer.tier && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'px-1.5 py-0 text-[10px] font-semibold',
                                TIER_MAP[activeTab.customer.tier.key]?.badge
                              )}
                            >
                              <Crown className="mr-1 h-2.5 w-2.5" />
                              {activeTab.customer.tier.label}
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          SĐT: {activeTab.customer.phone || 'Chưa cập nhật'}
                          {activeTab.customer.address ? ` · ${activeTab.customer.address}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() =>
                          updateActiveTab((tab) => ({ ...tab, customer: null, redeemPoints: '0' }))
                        }
                        aria-label="Bỏ chọn khách hàng"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    {activeTab.customer.isMember && (
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#0066CC]/15 pt-2 text-xs">
                        <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-300">
                          <Coins className="h-3.5 w-3.5" />
                          Điểm tích lũy: <strong>{formatNumber(activeTab.customer.points ?? 0)} điểm</strong>
                          <span className="text-[11px] text-muted-foreground">
                            (Tối đa dùng {formatNumber(maxRedeemablePoints)} điểm)
                          </span>
                        </span>
                        <span className="flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                          <Sparkles className="h-3 w-3" />+{estimatedPointsEarned} điểm sau đơn này
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={customerSearch}
                        onFocus={() => setCustomerDropdownOpen(true)}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value)
                          setCustomerDropdownOpen(true)
                        }}
                        placeholder="Tìm SĐT, tên khách hoặc mã Hội viên (TV0001)..."
                        aria-label="Tìm khách hàng hoặc hội viên"
                        className="h-10 pl-8 pr-14 text-base sm:h-9 sm:text-xs"
                      />
                      {customerDropdownOpen && (
                        <button
                          type="button"
                          onClick={() => setCustomerDropdownOpen(false)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                        >
                          Đóng
                        </button>
                      )}
                      {customerDropdownOpen && filteredCustomers.length > 0 && (
                        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border bg-popover p-1 shadow-xl">
                          {filteredCustomers.map((c) => {
                            const selectCust = () => {
                              updateActiveTab((tab) => ({
                                ...tab,
                                customer: c,
                                shippingAddress: c.address ?? tab.shippingAddress,
                              }))
                              setCustomerSearch('')
                              setCustomerDropdownOpen(false)
                            }
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onMouseDown={(e) => {
                                  e.preventDefault()
                                  selectCust()
                                }}
                                onClick={selectCust}
                                className="flex w-full items-center justify-between rounded-lg px-2.5 py-2.5 text-left text-xs hover:bg-muted active:bg-muted"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-semibold">
                                    {c.name}{' '}
                                    {c.phone && <span className="font-mono text-muted-foreground">· {c.phone}</span>}
                                  </p>
                                  {c.address && (
                                    <p className="truncate text-[11px] text-muted-foreground">{c.address}</p>
                                  )}
                                </div>
                                {c.isMember && (
                                  <Badge variant="outline" className="ml-2 shrink-0 border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-800">
                                    {c.memberCode} · {c.points ?? 0} điểm
                                  </Badge>
                                )}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Gợi ý chọn nhanh Hội viên 1 chạm trên điện thoại */}
                    {customers.length > 0 && (
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                        <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                          Chọn nhanh:
                        </span>
                        {customers.slice(0, 4).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              updateActiveTab((tab) => ({
                                ...tab,
                                customer: c,
                                shippingAddress: c.address ?? tab.shippingAddress,
                              }))
                              setCustomerDropdownOpen(false)
                            }}
                            className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-medium text-foreground hover:border-[#0066CC] hover:text-[#0066CC] active:scale-95"
                          >
                            {c.name}
                            {c.isMember ? ` (${c.memberCode})` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator />

              {/* 2. DANH SÁCH SẢN PHẨM TRONG HÓA ĐƠN POS */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Giỏ hàng xuất kho ({activeTab.items.length} mã · {totalQuantity} SP)
                  </span>
                  {activeTab.items.length > 0 && (
                    <button
                      type="button"
                      onClick={() => updateActiveTab((tab) => ({ ...tab, items: [] }))}
                      className="text-[11px] font-medium text-rose-600 hover:underline"
                    >
                      Xóa toàn bộ
                    </button>
                  )}
                </div>

                {activeTab.items.length === 0 ? (
                  <div className="flex h-36 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-4 text-center sm:h-44">
                    <ShoppingBag className="mb-1.5 h-8 w-8 text-muted-foreground/40" />
                    <p className="text-xs font-semibold text-muted-foreground">
                      Chưa có hàng hóa nào trong phiếu bán tại kho
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Quét mã vạch (F2 / Camera) hoặc chạm vào sản phẩm để thêm vào đơn.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setMobileSection('catalog')}
                      className="mt-2.5 h-8 gap-1.5 border-[#0066CC]/40 text-xs font-semibold text-[#0066CC] lg:hidden"
                    >
                      <Package className="h-3.5 w-3.5" />
                      Mở danh mục chọn hàng
                    </Button>
                  </div>
                ) : (
                  <div className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-background pr-1">
                    {activeTab.items.map((item, idx) => {
                      const bUnit = item.baseUnit || 'cái'
                      const mult = item.unitMultiplier || 1
                      const hasQuickWeights = item.quickQuantities && item.quickQuantities.length > 0
                      return (
                        <div key={item.productId} className="space-y-1.5 p-2.5">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-semibold">{item.name}</p>
                              <p className="font-mono text-[11px] text-muted-foreground">
                                {item.sku} · {formatVND(item.price)} / {item.unitLabel || bUnit}
                                {mult > 1 && (
                                  <span className="ml-1.5 rounded bg-emerald-100 px-1 py-0.2 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    Trừ kho: -{formatNumber(item.quantity * mult)} {bUnit}
                                  </span>
                                )}
                              </p>
                            </div>

                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 md:h-7 md:w-7"
                                onClick={() => updateItemQty(item.productId, item.quantity - 1)}
                                aria-label={`Giảm số lượng ${item.name}`}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                type="number"
                                min={1}
                                step={1}
                                max={Math.max(1, Math.floor(item.maxStock / mult))}
                                value={item.quantity}
                                onChange={(e) => updateItemQty(item.productId, Number(e.target.value) || 1)}
                                aria-label={`Số lượng ${item.name}`}
                                className="h-9 w-12 px-1 text-center text-base font-semibold tabular-nums sm:text-xs md:h-7"
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-9 w-9 md:h-7 md:w-7"
                                onClick={() => updateItemQty(item.productId, item.quantity + 1)}
                                aria-label={`Tăng số lượng ${item.name}`}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>

                            <div className="w-20 text-right">
                              <p className="text-xs font-bold tabular-nums">{formatVND(item.price * item.quantity)}</p>
                            </div>

                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive md:h-7 md:w-7"
                              onClick={() => removeCartItem(item.productId)}
                              aria-label={`Xóa ${item.name} khỏi đơn`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          {hasQuickWeights && (
                            <div className="flex flex-wrap items-center gap-1 pl-7">
                              <span className="text-[10px] font-semibold text-muted-foreground">Định lượng bán:</span>
                              {(item.quickQuantities ?? []).map((q) => {
                                const qLabel =
                                  q >= 1000 && bUnit === 'gr'
                                    ? `${q / 1000}kg (${formatNumber(q)}gr)`
                                    : q >= 1000 && bUnit === 'ml'
                                      ? `${q / 1000}lít (${formatNumber(q)}ml)`
                                      : `${formatNumber(q)}${bUnit}`
                                const active = mult === q
                                return (
                                  <button
                                    key={q}
                                    type="button"
                                    onClick={() => updateItemUnitMultiplier(item.productId, q, qLabel)}
                                    className={cn(
                                      'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                                      active
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : 'border-border bg-muted/40 text-foreground hover:border-emerald-500'
                                    )}
                                  >
                                    {qLabel}
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* 3. HÌNH THỨC NHẬN HÀNG TẠI KHO */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Hình thức xuất kho &amp; Bàn giao
                </Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        fulfillmentMode: 'PICKUP_AT_WAREHOUSE',
                        shippingFee: '0',
                      }))
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-all',
                      activeTab.fulfillmentMode === 'PICKUP_AT_WAREHOUSE'
                        ? 'border-[#0066CC] bg-[#0066CC]/10 font-semibold text-[#0066CC] dark:text-sky-300'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <PackageCheck className="h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Nhận ngay tại kho</p>
                      <p className="text-[10px]">Hoàn tất &amp; trừ kho tức thì</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      updateActiveTab((tab) => ({
                        ...tab,
                        fulfillmentMode: 'SHIP_FROM_WAREHOUSE',
                        shippingFee:
                          subtotal >= (loyaltyPolicy.freeShippingThreshold || 500000) ? '0' : '30000',
                      }))
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-xl border p-2.5 text-left text-xs transition-all',
                      activeTab.fulfillmentMode === 'SHIP_FROM_WAREHOUSE'
                        ? 'border-[#0066CC] bg-[#0066CC]/10 font-semibold text-[#0066CC] dark:text-sky-300'
                        : 'border-border bg-card text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <Truck className="h-4 w-4 shrink-0" />
                    <div>
                      <p className="font-semibold">Đóng gói giao đi</p>
                      <p className="text-[10px]">Chuyển sang bộ phận vận đơn</p>
                    </div>
                  </button>
                </div>

                {activeTab.fulfillmentMode === 'SHIP_FROM_WAREHOUSE' && (
                  <div className="space-y-2 rounded-xl border bg-muted/30 p-2.5">
                    <div className="flex items-center justify-between rounded-lg bg-background px-2.5 py-1.5 text-[11px]">
                      {subtotal >= (loyaltyPolicy.freeShippingThreshold || 500000) ? (
                        <span className="flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Đơn ≥ {formatVND(loyaltyPolicy.freeShippingThreshold || 500000)}: Đã được Miễn phí vận chuyển (Tiết kiệm 30.000đ)
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          Mua thêm{' '}
                          <strong className="text-[#0066CC] dark:text-sky-400">
                            {formatVND(
                              Math.max(0, (loyaltyPolicy.freeShippingThreshold || 500000) - subtotal)
                            )}
                          </strong>{' '}
                          để được <strong>Freeship</strong> (mốc{' '}
                          {formatVND(loyaltyPolicy.freeShippingThreshold || 500000)})
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <div className="sm:col-span-2">
                        <Label className="text-[11px]">Địa chỉ nhận hàng</Label>
                        <Input
                          value={activeTab.shippingAddress}
                          onChange={(e) =>
                            updateActiveTab((tab) => ({ ...tab, shippingAddress: e.target.value }))
                          }
                          placeholder="Số nhà, đường, phường/xã, quận/huyện..."
                          className="mt-1 h-9 text-base sm:h-8 sm:text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-[11px]">Phí ship (đ)</Label>
                        <Input
                          type="number"
                          min={0}
                          step={5000}
                          value={
                            subtotal >= (loyaltyPolicy.freeShippingThreshold || 500000)
                              ? '0'
                              : activeTab.shippingFee
                          }
                          onChange={(e) =>
                            updateActiveTab((tab) => ({ ...tab, shippingFee: e.target.value }))
                          }
                          className="mt-1 h-9 text-base tabular-nums sm:h-8 sm:text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 4. CHIẾT KHẤU, VOUCHER, ĐỔI ĐIỂM & TỔNG TIỀN */}
              <div className="space-y-2.5 rounded-xl border bg-muted/25 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Tạm tính ({totalQuantity} sản phẩm)</span>
                  <span className="font-semibold tabular-nums">{formatVND(subtotal)}</span>
                </div>

                {/* Nút thu gọn / mở rộng Ưu đãi & Voucher trên điện thoại để giảm cuộn trang */}
                <button
                  type="button"
                  onClick={() => setShowPromoMobile((v) => !v)}
                  className="flex w-full items-center justify-between rounded-lg border border-[#0066CC]/30 bg-background px-2.5 py-2 text-xs font-semibold text-[#0066CC] lg:hidden dark:text-sky-300"
                >
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>
                      Voucher, Chiết khấu &amp; Đổi điểm
                      {totalDiscount > 0 ? ` (-${formatVND(totalDiscount)})` : ''}
                    </span>
                  </span>
                  {showPromoMobile || totalDiscount > 0 ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                <div
                  className={cn(
                    'space-y-2.5 lg:block',
                    showPromoMobile || totalDiscount > 0 ? 'block' : 'hidden'
                  )}
                >
                  {/* Nhận diện tự động Chiến dịch CRM đang chạy (1 chạm áp giá chiến dịch tại POS) */}
                  {(() => {
                    if (activeTab.items.length === 0 || runningCampaigns.length === 0) return null
                    for (const camp of runningCampaigns) {
                      const campProdMap = new Map(
                        (camp.products ?? []).map((p) => [p.id, p])
                      )
                      let savings = 0
                      let matchedCount = 0
                      for (const item of activeTab.items) {
                        const cp = campProdMap.get(item.productId)
                        if (cp && cp.campaignPrice < item.price) {
                          savings += (item.price - cp.campaignPrice) * item.quantity
                          matchedCount += item.quantity
                        } else if (
                          camp.appliedProductIds?.includes(item.productId) &&
                          camp.discountPercent &&
                          camp.discountPercent > 0
                        ) {
                          savings += Math.round((item.price * item.quantity * camp.discountPercent) / 100)
                          matchedCount += item.quantity
                        }
                      }
                      if (savings > 0) {
                        const isApplied = Number(activeTab.discountAmount) === savings
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/80 bg-amber-50/80 px-2.5 py-1.5 text-[11px] dark:border-amber-800 dark:bg-amber-950/40">
                            <span className="font-medium text-amber-900 dark:text-amber-200">
                              <Sparkles className="mr-1 inline h-3 w-3 text-amber-600" />
                              Chiến dịch <strong>{camp.code}</strong> ({matchedCount} SP): Ưu đãi{' '}
                              <strong>-{formatVND(savings)}</strong>
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateActiveTab((tab) => ({
                                  ...tab,
                                  voucherCode: camp.voucherCode || tab.voucherCode,
                                  discountAmount: String(savings),
                                }))
                              }
                              className={cn(
                                'rounded border px-2 py-0.5 text-[10px] font-bold transition-all',
                                isApplied
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-amber-500 bg-amber-600 text-white hover:bg-amber-700'
                              )}
                            >
                              {isApplied ? '✓ Đã áp giá chiến dịch' : 'Áp dụng giá chiến dịch'}
                            </button>
                          </div>
                        )
                      }
                    }
                    return null
                  })()}

                  {/* Chọn nhanh Mã khuyến mãi / Voucher */}
                  {vouchers.length > 0 && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-muted-foreground">
                          Mã khuyến mãi / Voucher:
                        </span>
                        {activeTab.voucherCode && (
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                voucherCode: '',
                                discountAmount: '0',
                              }))
                            }
                            className="text-[10px] font-semibold text-rose-600 hover:underline"
                          >
                            Bỏ mã {activeTab.voucherCode}
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {vouchers.map((v) => {
                          const isSelected = activeTab.voucherCode === v.code
                          const eligible = subtotal >= v.minOrderAmount
                          return (
                            <button
                              key={v.id}
                              type="button"
                              onClick={() => applyVoucherToTab(v)}
                              title={`${v.title} (Đơn tối thiểu ${formatVND(v.minOrderAmount)})`}
                              className={cn(
                                'rounded-lg border px-2 py-1 text-[10px] font-semibold transition-all',
                                isSelected
                                  ? 'border-emerald-600 bg-emerald-700 text-white shadow-2xs'
                                  : eligible
                                    ? 'border-[#0066CC]/40 bg-sky-50/70 text-[#0066CC] hover:bg-[#0066CC]/10 dark:bg-sky-950/40 dark:text-sky-300'
                                    : 'border-border bg-card text-muted-foreground opacity-75 hover:opacity-100'
                              )}
                            >
                              {v.code} ·{' '}
                              {v.discountType === 'PERCENT'
                                ? `-${v.discountValue}%`
                                : v.discountType === 'FREESHIP'
                                  ? 'Freeship'
                                  : `-${formatNumber(v.discountValue / 1000)}k`}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2 pt-0.5 sm:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between">
                        <Label className="text-[11px] text-muted-foreground">Chiết khấu (đ)</Label>
                        {activeTab.voucherCode && (
                          <span className="font-mono text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            {activeTab.voucherCode}
                          </span>
                        )}
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={5000}
                        value={activeTab.discountAmount}
                        onChange={(e) =>
                          updateActiveTab((tab) => ({
                            ...tab,
                            voucherCode: '',
                            discountAmount: e.target.value,
                          }))
                        }
                        aria-label="Chiết khấu trực tiếp"
                        className="mt-1 h-9 text-base tabular-nums sm:h-7 sm:text-xs"
                      />
                      <div className="mt-1 flex flex-wrap gap-1">
                        {(() => {
                          const tierKey = activeTab.customer?.tier?.key
                          const tierCfg = tierKey
                            ? loyaltyPolicy.tiers.find((t) => t.key === tierKey)
                            : null
                          if (activeTab.customer?.isMember && tierCfg && tierCfg.tierDiscountPct > 0) {
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  updateActiveTab((tab) => ({
                                    ...tab,
                                    voucherCode: '',
                                    discountAmount: String(
                                      Math.round((subtotal * tierCfg.tierDiscountPct) / 100)
                                    ),
                                  }))
                                }
                                className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-200"
                              >
                                Hạng -{tierCfg.tierDiscountPct}%
                              </button>
                            )
                          }
                          return null
                        })()}
                        {[
                          { label: '5%', calc: () => Math.round(subtotal * 0.05) },
                          { label: '10%', calc: () => Math.round(subtotal * 0.1) },
                          { label: '-20k', calc: () => 20000 },
                          { label: '-50k', calc: () => 50000 },
                        ].map((chip) => (
                          <button
                            key={chip.label}
                            type="button"
                            onClick={() =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                voucherCode: '',
                                discountAmount: String(Math.min(subtotal, chip.calc())),
                              }))
                            }
                            className="rounded border bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground hover:border-[#0066CC] hover:text-[#0066CC] sm:px-1.5 sm:py-0.5"
                          >
                            {chip.label}
                          </button>
                        ))}
                        {manualDiscount > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                voucherCode: '',
                                discountAmount: '0',
                              }))
                            }
                            className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-medium text-rose-700 sm:px-1.5 sm:py-0.5"
                          >
                            Xoá
                          </button>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">
                        Đổi điểm ({activeTab.customer?.isMember ? `Tối đa ${maxRedeemablePoints}` : 'Chỉ Hội viên'})
                      </Label>
                      <div className="mt-1 flex gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={maxRedeemablePoints}
                          disabled={!activeTab.customer?.isMember || maxRedeemablePoints <= 0}
                          value={activeTab.redeemPoints}
                          onChange={(e) =>
                            updateActiveTab((tab) => ({ ...tab, redeemPoints: e.target.value }))
                          }
                          aria-label="Số điểm hội viên muốn đổi"
                          className="h-9 text-base tabular-nums sm:h-7 sm:text-xs"
                        />
                        {activeTab.customer?.isMember && maxRedeemablePoints > 0 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              updateActiveTab((tab) => ({
                                ...tab,
                                redeemPoints: String(maxRedeemablePoints),
                              }))
                            }
                            className="h-9 px-2 text-[10px] sm:h-7"
                          >
                            Tối đa
                          </Button>
                        )}
                      </div>
                      {activeTab.customer?.isMember && maxRedeemablePoints > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {[
                            { label: '10đ', val: Math.min(10, maxRedeemablePoints) },
                            { label: '20đ', val: Math.min(20, maxRedeemablePoints) },
                            { label: '50%', val: Math.max(1, Math.floor(maxRedeemablePoints / 2)) },
                            { label: '0đ', val: 0 },
                          ].map((chip) => (
                            <button
                              key={chip.label}
                              type="button"
                              onClick={() =>
                                updateActiveTab((tab) => ({ ...tab, redeemPoints: String(chip.val) }))
                              }
                              className="rounded border bg-background px-2 py-1 font-mono text-[10px] font-medium text-muted-foreground hover:border-[#0066CC] hover:text-[#0066CC] sm:px-1.5 sm:py-0.5"
                            >
                              {chip.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        Quy đổi: <strong>1 điểm = {formatNumber(loyaltyPolicy.redeemVndPerPoint || 1000)}đ</strong> ·{' '}
                        <span className="font-mono">{activeWaveCode}</span>
                        {pointsDiscount > 0 ? ` (-${formatVND(pointsDiscount)})` : ''}
                      </p>
                    </div>
                  </div>
                </div>

                {activeTab.fulfillmentMode === 'SHIP_FROM_WAREHOUSE' && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Phí giao hàng</span>
                    <span className="font-medium tabular-nums">
                      {shippingFee === 0 ? '0 đ (Freeship)' : formatVND(shippingFee)}
                    </span>
                  </div>
                )}

                {totalDiscount > 0 && (
                  <div className="flex items-center justify-between text-xs text-emerald-700 dark:text-emerald-400">
                    <span>
                      Tổng giảm giá ({activeTab.voucherCode ? `Mã ${activeTab.voucherCode}` : 'Chiết khấu'}{' '}
                      + Đổi điểm)
                    </span>
                    <span className="font-semibold tabular-nums">-{formatVND(totalDiscount)}</span>
                  </div>
                )}

                <Separator />

                <div className="flex items-baseline justify-between pt-0.5">
                  <div>
                    <span className="text-sm font-bold">KHÁCH CẦN TRẢ</span>
                    {activeTab.customer?.isMember && grandTotal > 0 && (
                      <p className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                        Tích lũy thêm +{estimatedPointsEarned} điểm Hội viên (1 điểm / 10k)
                      </p>
                    )}
                  </div>
                  <span className="text-xl font-extrabold tabular-nums text-[#0066CC] dark:text-sky-400">
                    {formatVND(grandTotal)}
                  </span>
                </div>
              </div>

              {/* 5. PHƯƠNG THỨC THANH TOÁN & TÍNH TIỀN THỪA */}
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Phương thức thanh toán
                </Label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(
                    [
                      { key: 'CASH', label: 'Tiền mặt', icon: Banknote },
                      { key: 'BANK_TRANSFER', label: 'Chuyển khoản QR', icon: QrCode },
                      { key: 'CARD', label: 'Quẹt thẻ', icon: CreditCard },
                      { key: 'COD', label: 'Thu hộ COD', icon: Truck },
                    ] as const
                  ).map((pm) => {
                    const active = activeTab.paymentMethod === pm.key
                    return (
                      <button
                        key={pm.key}
                        type="button"
                        onClick={() => updateActiveTab((tab) => ({ ...tab, paymentMethod: pm.key }))}
                        className={cn(
                          'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-medium transition-all sm:flex-col sm:gap-1 sm:py-2 sm:text-[11px]',
                          active
                            ? 'border-[#0066CC] bg-[#0066CC] font-semibold text-white shadow-2xs'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <pm.icon className="h-4 w-4 shrink-0" />
                        <span>{pm.label}</span>
                      </button>
                    )
                  })}
                </div>

                {/* Tính tiền khách đưa & tiền thừa khi thu Tiền mặt */}
                {activeTab.paymentMethod === 'CASH' && grandTotal > 0 && (
                  <div className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs font-semibold">Tiền khách đưa (đ)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={10000}
                        value={activeTab.cashReceived}
                        onChange={(e) =>
                          updateActiveTab((tab) => ({ ...tab, cashReceived: e.target.value }))
                        }
                        placeholder={String(grandTotal)}
                        aria-label="Tiền khách đưa"
                        className="h-9 w-36 bg-background text-right text-base font-bold tabular-nums sm:h-7 sm:text-xs"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {Number(activeTab.cashReceived) > 0 && Number(activeTab.cashReceived) < 10000 && (
                        <button
                          type="button"
                          onClick={() =>
                            updateActiveTab((tab) => ({
                              ...tab,
                              cashReceived: String(Math.round(Number(tab.cashReceived) * 1000)),
                            }))
                          }
                          className="min-h-8 rounded-md border border-emerald-400 bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200"
                        >
                          + .000 ({formatVND(Math.round(Number(activeTab.cashReceived) * 1000))})
                        </button>
                      )}
                      {[
                        { label: 'Đủ tiền', val: grandTotal },
                        { label: '100k', val: 100000 },
                        { label: '200k', val: 200000 },
                        { label: '500k', val: 500000 },
                        { label: '1.000k', val: 1000000 },
                      ].map((d) => (
                        <button
                          key={d.label}
                          type="button"
                          onClick={() =>
                            updateActiveTab((tab) => ({ ...tab, cashReceived: String(d.val) }))
                          }
                          className="min-h-8 rounded-md border bg-background px-2.5 py-1 text-[11px] font-semibold hover:border-[#0066CC] hover:text-[#0066CC] md:min-h-0 md:px-2 md:py-0.5 md:text-[10px]"
                        >
                          {d.label}
                        </button>
                      ))}
                      <span className="ml-auto text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        Tiền thừa: {formatVND(changeDue)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Mã VietQR trực quan khi chọn Chuyển khoản trên điện thoại / tại quầy */}
                {activeTab.paymentMethod === 'BANK_TRANSFER' && grandTotal > 0 && (
                  <div className="flex flex-col gap-2.5 rounded-xl border border-sky-200 bg-sky-50/60 p-3 text-xs sm:flex-row sm:items-center sm:justify-between dark:border-sky-900 dark:bg-sky-950/25">
                    <div className="flex items-center gap-3">
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-white p-1 shadow-2xs">
                        <img
                          src={`https://img.vietqr.io/image/MB-0909123456-qr_only.png?amount=${grandTotal}&addInfo=${encodeURIComponent(
                            'POS UU DAM'
                          )}`}
                          alt="Mã VietQR thanh toán"
                          className="h-full w-full object-contain"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none'
                          }}
                        />
                        <QrCode className="h-10 w-10 text-[#0066CC]" />
                      </div>
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5">
                          <p className="font-bold text-[#0066CC] dark:text-sky-300">
                            Quét mã VietQR tại quầy
                          </p>
                          <Badge
                            variant="outline"
                            className="border-emerald-300 bg-emerald-50 px-1.5 py-0 text-[9px] text-emerald-700"
                          >
                            Tự động gạch nợ
                          </Badge>
                        </div>
                        <p className="text-[11px] text-foreground">
                          Số tiền: <strong className="text-sm text-[#0066CC]">{formatVND(grandTotal)}</strong>
                        </p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          MB Bank · 0909123456 · ND: POS UU DAM
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <Input
                  value={activeTab.note}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, note: e.target.value }))}
                  placeholder="Ghi chú đơn xuất kho (người nhận tại kho, biển số xe, yêu cầu đóng gói)..."
                  aria-label="Ghi chú đơn xuất kho"
                  className="h-9 text-base sm:h-8 sm:text-xs"
                />
              </div>

              {/* 6. TÙY CHỌN CHỨNG TỪ & IN HÓA ĐƠN NHIỆT K80 */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={autoIssueInvoice}
                    onCheckedChange={(v) => setAutoIssueInvoice(Boolean(v))}
                  />
                  <span>Tự lập Hóa đơn bán / Phiếu xuất kho</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={autoPrintReceipt}
                    onCheckedChange={(v) => setAutoPrintReceipt(Boolean(v))}
                  />
                  <span>Mở phiếu K80 sau thanh toán</span>
                </label>
              </div>

              {/* 7. NÚT THANH TOÁN & XUẤT KHO (F9) — Dính cố định dưới đáy màn hình điện thoại */}
              <div
                className={cn(
                  'sticky z-20 pt-1 lg:static lg:pt-0',
                  standalone ? 'bottom-2' : 'bottom-[4.5rem] md:bottom-2'
                )}
              >
                <Button
                  size="lg"
                  disabled={submitting || activeTab.items.length === 0}
                  onClick={() => void handleCheckout()}
                  className="h-12 w-full gap-2 rounded-xl bg-[#0066CC] text-xs font-extrabold text-white shadow-lg hover:bg-[#0055B3] sm:text-sm"
                >
                  {submitting ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 shrink-0" />
                  )}
                  <span className="truncate">
                    {activeTab.fulfillmentMode === 'PICKUP_AT_WAREHOUSE'
                      ? `THANH TOÁN & XUẤT KHO NGAY (${formatVND(grandTotal)})`
                      : `TẠO ĐƠN & CHUYỂN ĐÓNG GÓI (${formatVND(grandTotal)})`}
                  </span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ===== THANH NỔI TÓM TẮT GIỎ HÀNG & THU TIỀN NHANH 1 CHẠM TRÊN ĐIỆN THOẠI (< lg) ===== */}
      {mobileSection === 'catalog' && activeTab.items.length > 0 && (
        <div
          className={cn(
            'sticky z-20 lg:hidden',
            standalone ? 'bottom-2' : 'bottom-[4.5rem] md:bottom-2'
          )}
        >
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-[#0066CC]/40 bg-[#0F1E36] p-2.5 text-white shadow-xl">
            <div className="min-w-0 pl-1">
              <p className="text-[10px] font-medium text-sky-200">
                Đã chọn {totalQuantity} SP ({activeTab.items.length} mã)
              </p>
              <p className="truncate text-sm font-extrabold tabular-nums sm:text-base">
                {formatVND(grandTotal)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void handleCheckout()}
                className="h-10 gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs hover:bg-emerald-500 active:scale-95"
                title="Xác nhận thu tiền mặt và hoàn tất đơn hàng"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                <span>Thu nhanh</span>
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setMobileSection('checkout')
                  if (typeof window !== 'undefined') {
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                }}
                className="h-10 gap-1 rounded-xl bg-[#0088FF] px-3 text-xs font-bold text-white shadow-xs hover:bg-[#0077E6] active:scale-95"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span>Giỏ &amp; Sửa ({totalQuantity})</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== DIALOG QUÉT MÃ VẠCH / QR BẰNG CAMERA ĐIỆN THOẠI ===== */}
      <Dialog open={cameraOpen} onOpenChange={setCameraOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-[#0066CC]" />
              Quét Mã Vạch / QR Bằng Camera
            </DialogTitle>
            <DialogDescription>
              Hướng camera sau vào tem mã vạch sản phẩm hoặc chạm chọn nhanh mã SKU bên dưới.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative flex h-44 w-full items-center justify-center overflow-hidden rounded-xl border border-[#0066CC]/40 bg-slate-950 text-white">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {/* Khung ngắm laser quét mã vạch */}
              <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-sky-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
                <div className="absolute top-1/2 right-2 left-2 h-0.5 -translate-y-1/2 bg-rose-500/90 shadow-[0_0_8px_#f43f5e]" />
              </div>
              {cameraError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 p-4 text-center text-xs text-slate-200">
                  <Barcode className="mb-1.5 h-7 w-7 text-sky-400" />
                  <p>{cameraError}</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-muted-foreground">
                  Chạm chọn nhanh mã vạch / SKU tại kho ({products.length} mã):
                </Label>
              </div>
              <Input
                value={cameraFilter}
                onChange={(e) => setCameraFilter(e.target.value)}
                placeholder="Lọc nhanh SKU, mã vạch hoặc tên SP..."
                className="h-9 text-base sm:text-xs"
              />
              <div className="max-h-48 divide-y overflow-y-auto rounded-xl border bg-muted/20">
                {products
                  .filter((p) => {
                    const q = cameraFilter.trim().toLowerCase()
                    if (!q) return getAvailableStock(p) > 0
                    return (
                      p.name.toLowerCase().includes(q) ||
                      p.sku.toLowerCase().includes(q) ||
                      (p.barcode ?? '').toLowerCase().includes(q)
                    )
                  })
                  .slice(0, 12)
                  .map((p) => {
                    const avail = getAvailableStock(p)
                    const inCart = cartQtyByProduct.get(p.id) ?? 0
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={avail <= 0}
                        onClick={() => {
                          handleBarcodeSubmit(p.barcode || p.sku)
                        }}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted active:bg-muted"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{p.name}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">
                            SKU: {p.sku} {p.barcode ? `· Barcode: ${p.barcode}` : ''} · Tồn: {avail}
                          </p>
                        </div>
                        <Badge className="shrink-0 bg-[#0066CC] text-[10px] text-white">
                          {inCart > 0 ? `+1 (Đã có ${inCart})` : '+ Quét thêm'}
                        </Badge>
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row justify-between gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setCameraOpen(false)} className="flex-1 sm:flex-none">
              Đóng ({totalQuantity} SP trong giỏ)
            </Button>
            {totalQuantity > 0 && (
              <Button
                onClick={() => {
                  setCameraOpen(false)
                  setMobileSection('checkout')
                }}
                className="flex-1 bg-[#0066CC] text-white hover:bg-[#0055B3] sm:flex-none"
              >
                Sang Thu tiền ({formatVND(grandTotal)})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== DIALOG THÊM NHANH KHÁCH HÀNG / HỘI VIÊN TẠI QUẦY POS ===== */}
      <Dialog open={newCustomerOpen} onOpenChange={setNewCustomerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm nhanh khách hàng tại kho (POS)</DialogTitle>
            <DialogDescription>
              Lưu thông tin khách và cấp mã Hội viên ngay tại quầy để tích điểm cho đơn hàng này.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Họ và tên khách hàng *</Label>
              <Input
                value={newCustomerForm.name}
                onChange={(e) => setNewCustomerForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Nguyễn Minh Anh"
                className="mt-1 text-base sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Số điện thoại</Label>
              <Input
                value={newCustomerForm.phone}
                onChange={(e) => setNewCustomerForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="VD: 0909123456"
                className="mt-1 text-base sm:text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Địa chỉ</Label>
              <Textarea
                rows={2}
                value={newCustomerForm.address}
                onChange={(e) => setNewCustomerForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Địa chỉ nhận hàng (nếu có)..."
                className="mt-1 text-base sm:text-sm"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-amber-50/60 p-2.5 text-xs font-medium dark:bg-amber-950/20">
              <Checkbox
                checked={newCustomerForm.registerMember}
                onCheckedChange={(v) =>
                  setNewCustomerForm((f) => ({ ...f, registerMember: Boolean(v) }))
                }
              />
              <span>Đăng ký thẻ Hội viên thân thiết ngay (tự cấp mã TV &amp; tích điểm)</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewCustomerOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={creatingCustomer}
              onClick={() => void handleQuickCreateCustomer()}
              className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
            >
              {creatingCustomer && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu &amp; Chọn khách này
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== DIALOG PHIẾU XUẤT KHO KIÊM HÓA ĐƠN BÁN LẺ K80 CHUẨN OPENVN POS ===== */}
      <Dialog open={receiptModal !== null} onOpenChange={(o) => !o && setReceiptModal(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-[#0066CC]" />
              Phiếu Xuất Kho Kiêm Hóa Đơn Bán Lẻ (POS)
            </DialogTitle>
            <DialogDescription>
              Đơn hàng đã được ghi nhận vào Sổ cái dữ liệu và trừ tồn kho thực tế.
            </DialogDescription>
          </DialogHeader>

          {receiptModal && (
            <div className="rounded-xl border bg-white p-4 font-mono text-xs text-slate-900 shadow-inner">
              <div className="border-b border-dashed border-slate-300 pb-2 text-center">
                <p className="text-sm font-bold uppercase">CỬA HÀNG &amp; KHO TRUNG TÂM ƯU ĐÀM</p>
                <p className="text-[11px] text-slate-600">Nến Bơ Thực Vật · Gốm Trà · Quà Tặng Thiền</p>
                <p className="mt-1 text-xs font-bold">PHIẾU XUẤT KHO / HÓA ĐƠN BÁN LẺ</p>
              </div>

              <div className="space-y-1 border-b border-dashed border-slate-300 py-2 text-[11px]">
                <div className="flex justify-between">
                  <span>Mã đơn POS:</span>
                  <span className="font-bold">{receiptModal.order.code}</span>
                </div>
                {receiptModal.invoiceCode && (
                  <div className="flex justify-between">
                    <span>Số chứng từ XK:</span>
                    <span className="font-bold">{receiptModal.invoiceCode}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Thời gian:</span>
                  <span>{receiptModal.cashierTime}</span>
                </div>
                <div className="flex justify-between">
                  <span>Khách hàng:</span>
                  <span className="font-semibold">
                    {receiptModal.customer?.name ?? 'Khách mua trực tiếp tại kho'}
                  </span>
                </div>
                {receiptModal.customer?.memberCode && (
                  <div className="flex justify-between">
                    <span>Mã Hội viên:</span>
                    <span>
                      {receiptModal.customer.memberCode} (+{receiptModal.pointsEarned} điểm)
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Hình thức:</span>
                  <span>
                    {receiptModal.fulfillmentMode === 'PICKUP_AT_WAREHOUSE'
                      ? 'Nhận hàng ngay tại kho'
                      : 'Đóng gói giao từ kho'}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-dashed divide-slate-200 py-2">
                {receiptModal.order.items.map((it) => (
                  <div key={it.id} className="py-1.5">
                    <p className="font-semibold">{it.product?.name ?? 'Sản phẩm'}</p>
                    <div className="flex justify-between text-[11px] text-slate-600">
                      <span>
                        {it.quantity} x {formatVND(it.price)}
                      </span>
                      <span className="font-bold text-slate-900">
                        {formatVND(it.quantity * it.price)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1 border-t border-dashed border-slate-300 pt-2 text-[11px]">
                <div className="flex justify-between">
                  <span>Tạm tính:</span>
                  <span>{formatVND(receiptModal.order.subtotal)}</span>
                </div>
                {receiptModal.discountAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Chiết khấu / Đổi điểm:</span>
                    <span>-{formatVND(receiptModal.discountAmount)}</span>
                  </div>
                )}
                {receiptModal.order.shippingFee > 0 && (
                  <div className="flex justify-between">
                    <span>Phí vận chuyển:</span>
                    <span>{formatVND(receiptModal.order.shippingFee)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-300 pt-1 text-sm font-bold">
                  <span>TỔNG THANH TOÁN:</span>
                  <span>{formatVND(receiptModal.order.total)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Khách thanh toán ({receiptModal.order.paymentMethod}):</span>
                  <span>{formatVND(receiptModal.cashReceived)}</span>
                </div>
                {receiptModal.changeDue > 0 && (
                  <div className="flex justify-between font-semibold">
                    <span>Tiền thừa trả khách:</span>
                    <span>{formatVND(receiptModal.changeDue)}</span>
                  </div>
                )}
              </div>

              <p className="mt-3 text-center text-[10px] italic text-slate-500">
                Cảm ơn Quý khách đã mua sắm tại Kho Ưu Đàm!
              </p>
            </div>
          )}

          <DialogFooter className="flex-wrap gap-2">
            <Button variant="outline" onClick={() => setReceiptModal(null)}>
              Đóng
            </Button>
            {receiptModal && (
              <Button
                variant="outline"
                onClick={() => void handleShareReceipt(receiptModal)}
                className="border-[#0066CC]/40 text-[#0066CC] hover:bg-[#0066CC]/10"
              >
                <Share2 className="mr-1.5 h-4 w-4" /> Chia sẻ / Gửi Zalo
              </Button>
            )}
            <Button
              onClick={() => {
                if (receiptModal) void printReceipt(receiptModal.order)
                else window.print()
              }}
              className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
            >
              <Printer className="mr-1.5 h-4 w-4" /> In phiếu K80 / A5
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== DIALOG LỊCH SỬ ĐƠN BÁN TẠI KHO (POS) TRONG CA ===== */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Đơn bán hàng tại kho (POS) gần đây</DialogTitle>
            <DialogDescription>
              Danh sách 10 đơn hàng gần nhất phát sinh tại quầy kho POS. Chạm để xem hoặc in lại phiếu.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-96 overflow-y-auto rounded-lg border">
            {recentPosOrders.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                Chưa có đơn hàng POS nào trong ca trực.
              </p>
            ) : (
              <>
                {/* Giao diện thẻ gọn gàng trên điện thoại (< sm) */}
                <div className="divide-y sm:hidden">
                  {recentPosOrders.map((o) => (
                    <div key={o.id} className="space-y-1.5 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-bold text-[#0066CC]">{o.code}</span>
                        <OrderStatusBadge status={o.status} />
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">
                          {o.customer?.name ?? 'Khách lẻ tại kho'} ({o.items.length} SP)
                        </span>
                        <span className="font-extrabold tabular-nums text-[#0066CC]">
                          {formatVND(o.total)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[11px] text-muted-foreground">
                          {formatDateTime(o.createdAt)}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setHistoryOpen(false)
                            setReceiptModal({
                              order: o,
                              customer: customers.find((c) => c.id === o.customer?.id) ?? null,
                              fulfillmentMode: 'PICKUP_AT_WAREHOUSE',
                              discountAmount: Math.max(0, o.subtotal + o.shippingFee - o.total),
                              redeemPoints: 0,
                              pointsEarned: 0,
                              cashReceived: o.total,
                              changeDue: 0,
                              cashierTime: formatDateTime(o.createdAt),
                            })
                          }}
                          className="h-7 gap-1 px-2.5 text-[11px]"
                        >
                          <Printer className="h-3 w-3" /> Xem / In phiếu
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Bảng trên màn hình lớn (sm+) */}
                <table className="hidden w-full text-left text-xs sm:table">
                  <thead className="border-b bg-muted/60 font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-2.5">Mã đơn</th>
                      <th className="p-2.5">Khách hàng</th>
                      <th className="p-2.5">Số mặt hàng</th>
                      <th className="p-2.5">Trạng thái</th>
                      <th className="p-2.5 text-right">Tổng tiền</th>
                      <th className="p-2.5 text-right">Phiếu K80</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentPosOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-muted/40">
                        <td className="p-2.5 font-mono font-bold text-[#0066CC]">{o.code}</td>
                        <td className="p-2.5">
                          <p className="font-medium">{o.customer?.name ?? 'Khách lẻ tại kho'}</p>
                          <p className="text-[10px] text-muted-foreground">{formatDateTime(o.createdAt)}</p>
                        </td>
                        <td className="p-2.5">{o.items.length} SP</td>
                        <td className="p-2.5">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="p-2.5 text-right font-bold tabular-nums">
                          {formatVND(o.total)}
                        </td>
                        <td className="p-2.5 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setHistoryOpen(false)
                              setReceiptModal({
                                order: o,
                                customer: customers.find((c) => c.id === o.customer?.id) ?? null,
                                fulfillmentMode: 'PICKUP_AT_WAREHOUSE',
                                discountAmount: Math.max(0, o.subtotal + o.shippingFee - o.total),
                                redeemPoints: 0,
                                pointsEarned: 0,
                                cashReceived: o.total,
                                changeDue: 0,
                                cashierTime: formatDateTime(o.createdAt),
                              })
                            }}
                            className="h-7 gap-1 px-2 text-[11px]"
                          >
                            <Printer className="h-3 w-3" /> In lại
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
