'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Barcode,
  Boxes,
  Check,
  CheckCircle2,
  ClipboardCheck,
  LayoutGrid,
  ListFilter,
  Loader2,
  Minus,
  Package,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Trash2,
  Warehouse,
  X,
  Zap,
} from 'lucide-react'

import { apiGet, apiPost } from '@/lib/api'
import { formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { readShopProfileCache, useShopProfile } from '@/lib/shop-profile'
import type { Category, Product, WarehouseInfo } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

interface Partner {
  id: string
  code: string
  name: string
  type: string
  phone?: string | null
}

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProductAvatar } from '@/components/cms/product-avatar'

export type StockSlipMode = 'IMPORT' | 'PRODUCTION' | 'EXPORT' | 'ADJUST'

export interface BomRecipeItem {
  id: string
  quantity: number
  componentProduct: {
    id: string
    sku: string
    name: string
    unit: string
    stock: number
    costPrice: number
    purchaseRate?: number
    purchaseUnit?: string
  }
}

export interface BomGroupInfo {
  productId: string
  productSku: string
  productName: string
  unit: string
  stock: number
  components: BomRecipeItem[]
}

export interface FastStockCartItem {
  productId: string
  sku: string
  name: string
  image: string | null
  type: string
  currentStock: number
  lowStockThreshold: number
  baseUnit: string
  inputUnit: string
  conversionRate: number
  defaultPurchaseUnit: string
  defaultPurchaseRate: number
  quantity: number
  costPrice: number
  note: string
}

interface FastStockSlipTab {
  id: string
  label: string
  createdAt: string
  mode: StockSlipMode
  warehouseId: string
  supplierName: string
  note: string
  items: FastStockCartItem[]
  customMaterialQty?: Record<string, number>
}

interface CompletedBatchReceipt {
  batchCode: string
  mode: StockSlipMode
  warehouseName: string
  supplierName: string
  completedAt: string
  totalSkus: number
  totalConvertedUnits: number
  totalValue: number
  items: Array<{
    sku: string
    name: string
    inputQty: number
    inputUnit: string
    conversionRate: number
    convertedQty: number
    baseUnit: string
    stockBefore: number
    stockAfter: number
    costPrice: number
  }>
  consumedMaterials?: Array<{
    sku: string
    name: string
    unit: string
    consumedQty: number
    stockBefore: number
    stockAfter: number
  }>
}

function createEmptySlipTab(
  index: number,
  defaultWarehouseId = '',
  defaultMode: StockSlipMode = 'IMPORT'
): FastStockSlipTab {
  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const shopProfile = readShopProfileCache()
  return {
    id: `stock-slip-${Date.now()}-${index}`,
    label: defaultMode === 'PRODUCTION' ? `Lệnh SX ${index}` : `Phiếu ${index}`,
    createdAt: `${hh}:${mm}`,
    mode: defaultMode,
    warehouseId: defaultWarehouseId,
    supplierName: defaultMode === 'PRODUCTION' ? shopProfile.defaultWorkshopName : '',
    note: '',
    items: [],
    customMaterialQty: {},
  }
}

const SLIP_MODE_CONFIG: Record<
  StockSlipMode,
  { label: string; shortLabel: string; badgeClass: string; btnClass: string; icon: typeof ArrowDownToLine }
> = {
  IMPORT: {
    label: 'Phiếu Nhập Kho (NVL & Hàng hóa)',
    shortLabel: 'Nhập kho',
    badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    btnClass: 'bg-emerald-600 text-white hover:bg-emerald-700',
    icon: ArrowDownToLine,
  },
  PRODUCTION: {
    label: 'Phiếu Sản Xuất (Trừ NVL ➔ Cộng Thành phẩm)',
    shortLabel: 'Sản xuất',
    badgeClass: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
    btnClass: 'bg-[#0066CC] text-white hover:bg-[#0055B3]',
    icon: Boxes,
  },
  EXPORT: {
    label: 'Phiếu Xuất Kho / Hao hụt',
    shortLabel: 'Xuất kho',
    badgeClass: 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300',
    btnClass: 'bg-orange-600 text-white hover:bg-orange-700',
    icon: ArrowUpFromLine,
  },
  ADJUST: {
    label: 'Phiếu Kiểm Kê Cân Bằng Kho',
    shortLabel: 'Kiểm kê',
    badgeClass: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
    btnClass: 'bg-violet-600 text-white hover:bg-violet-700',
    icon: ClipboardCheck,
  },
}

const QUICK_QTY_CHIPS = [1, 5, 10, 20, 50, 100]

export function FastStockTerminal({
  onCompleted,
  defaultMode = 'IMPORT',
  allowedModes = ['IMPORT', 'PRODUCTION', 'EXPORT', 'ADJUST'],
}: {
  onCompleted?: () => void
  defaultMode?: StockSlipMode
  allowedModes?: StockSlipMode[]
} = {}) {
  const { toast } = useToast()
  const { profile: shopProfile } = useShopProfile()

  const [products, setProducts] = useState<Product[]>([])
  const [bomGroups, setBomGroups] = useState<BomGroupInfo[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseInfo[]>([])
  const [suppliers, setSuppliers] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  // Bộ lọc bên trái (giống POS)
  const [searchQuery, setSearchQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'BOM_READY' | 'WEIGHT_CONV' | 'MATERIAL' | 'FINISHED' | 'LOW_STOCK'>(
    defaultMode === 'PRODUCTION' ? 'BOM_READY' : 'ALL'
  )
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [mobileSection, setMobileSection] = useState<'catalog' | 'slip'>('catalog')

  // Đa tab phiếu kho (giống đa tab đơn POS)
  const nextTabCounter = useRef(2)
  const [tabs, setTabs] = useState<FastStockSlipTab[]>(() => [createEmptySlipTab(1, '', defaultMode)])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)
  const [completedReceipt, setCompletedReceipt] = useState<CompletedBatchReceipt | null>(null)

  const barcodeRef = useRef<HTMLInputElement | null>(null)

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  )

  const updateActiveTab = useCallback(
    (updater: (tab: FastStockSlipTab) => FastStockSlipTab) => {
      setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? updater(t) : t)))
    },
    [activeTab.id]
  )

  const loadData = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const [prodRes, bomRes, catRes, whRes, partRes] = await Promise.all([
          apiGet<{ products: Product[] }>('/api/products'),
          apiGet<{ groups: BomGroupInfo[] }>('/api/bom').catch(() => ({ groups: [] })),
          apiGet<{ categories: Category[] }>('/api/categories'),
          apiGet<{ warehouses: WarehouseInfo[] }>('/api/warehouses').catch(() => ({ warehouses: [] })),
          apiGet<{ partners: Partner[] }>('/api/partners?type=SUPPLIER').catch(() => ({ partners: [] })),
        ])
        // Loại bỏ COMBO khỏi danh mục nhập kho / sản xuất trực tiếp (vì COMBO tự tính từ thành phần BOM)
        setProducts(prodRes.products.filter((p) => p.type !== 'COMBO'))
        setBomGroups(bomRes.groups || [])
        setCategories(catRes.categories)
        setWarehouses(whRes.warehouses)
        setSuppliers(partRes.partners)

        if (whRes.warehouses.length > 0) {
          const defWh = whRes.warehouses.find((w) => w.isDefault) ?? whRes.warehouses[0]
          setTabs((prev) =>
            prev.map((t) => (t.warehouseId ? t : { ...t, warehouseId: defWh.id }))
          )
        }
      } catch (err) {
        if (!silent) {
          toast({
            title: 'Không thể tải dữ liệu kho',
            description: err instanceof Error ? err.message : 'Vui lòng thử lại',
            variant: 'destructive',
          })
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Map định mức BOM theo productId và tính số lượng tối đa có thể sản xuất từ tồn kho NVL hiện tại
  const bomByProductId = useMemo(() => {
    const map = new Map<string, BomGroupInfo>()
    for (const g of bomGroups) {
      if (g.components && g.components.length > 0) {
        map.set(g.productId, g)
      }
    }
    return map
  }, [bomGroups])

  const maxProducibleByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const [pid, g] of bomByProductId.entries()) {
      if (!g.components || g.components.length === 0) continue
      let minCap = Number.POSITIVE_INFINITY
      for (const comp of g.components) {
        if (comp.quantity <= 0) continue
        const cap = Math.floor(Math.max(0, comp.componentProduct.stock) / comp.quantity)
        if (cap < minCap) minCap = cap
      }
      if (Number.isFinite(minCap)) {
        map.set(pid, minCap)
      }
    }
    return map
  }, [bomByProductId])

  // ===== Thêm sản phẩm vào Phiếu Kho tốc độ cao =====
  const addProductToSlip = useCallback(
    (product: Product, addQty?: number) => {
      const uc = product.unitConfig
      const bUnit = uc?.baseUnit || product.unit || 'cái'
      const pUnit = uc?.purchaseUnit || bUnit
      const pRate = uc?.purchaseRate && uc.purchaseRate > 0 ? uc.purchaseRate : 1

      updateActiveTab((tab) => {
        const isImport = tab.mode === 'IMPORT'
        const defaultAdd = addQty ?? (isImport && pRate > 1 ? 10 : 5)
        const existing = tab.items.find((it) => it.productId === product.id)
        if (existing) {
          return {
            ...tab,
            items: tab.items.map((it) =>
              it.productId === product.id
                ? {
                    ...it,
                    currentStock: product.stock,
                    quantity: tab.mode === 'ADJUST' ? it.quantity : it.quantity + (addQty ?? 1),
                  }
                : it
            ),
          }
        }

        const initInputUnit = isImport && pRate > 1 ? pUnit : bUnit
        const initRate = isImport && pRate > 1 ? pRate : 1
        const initQty = tab.mode === 'ADJUST' ? product.stock : defaultAdd

        const newItem: FastStockCartItem = {
          productId: product.id,
          sku: product.sku,
          name: product.name,
          image: product.image,
          type: product.type || 'SIMPLE',
          currentStock: product.stock,
          lowStockThreshold: product.lowStockThreshold,
          baseUnit: bUnit,
          inputUnit: initInputUnit,
          conversionRate: initRate,
          defaultPurchaseUnit: pUnit,
          defaultPurchaseRate: pRate,
          quantity: initQty,
          costPrice: product.costPrice || 0,
          note: '',
        }
        return {
          ...tab,
          items: [newItem, ...tab.items],
        }
      })
    },
    [updateActiveTab]
  )

  // ===== Nạp tự động toàn bộ SP Sắp hết hàng vào phiếu nhập =====
  const fillAllLowStockProducts = useCallback(() => {
    const lowList = products.filter((p) => p.stock <= p.lowStockThreshold)
    if (lowList.length === 0) {
      toast({ title: 'Tất cả sản phẩm đều đang đủ tồn kho an toàn' })
      return
    }
    updateActiveTab((tab) => {
      const existingIds = new Set(tab.items.map((it) => it.productId))
      const addedItems: FastStockCartItem[] = []
      for (const product of lowList) {
        if (existingIds.has(product.id)) continue
        const uc = product.unitConfig
        const bUnit = uc?.baseUnit || product.unit || 'cái'
        const pUnit = uc?.purchaseUnit || bUnit
        const pRate = uc?.purchaseRate && uc.purchaseRate > 0 ? uc.purchaseRate : 1
        addedItems.push({
          productId: product.id,
          sku: product.sku,
          name: product.name,
          image: product.image,
          type: product.type || 'SIMPLE',
          currentStock: product.stock,
          lowStockThreshold: product.lowStockThreshold,
          baseUnit: bUnit,
          inputUnit: pRate > 1 ? pUnit : bUnit,
          conversionRate: pRate > 1 ? pRate : 1,
          defaultPurchaseUnit: pUnit,
          defaultPurchaseRate: pRate,
          quantity: 10,
          costPrice: product.costPrice || 0,
          note: 'Bổ sung tồn kho dưới ngưỡng',
        })
      }
      return {
        ...tab,
        mode: 'IMPORT',
        items: [...addedItems, ...tab.items],
      }
    })
    setMobileSection('slip')
    toast({
      title: `Đã thêm ${lowList.length} sản phẩm sắp hết hàng vào Phiếu Nhập`,
      description: 'Kiểm tra lại số lượng từng mặt hàng và nhấn Hoàn tất phiếu (F9) để ghi nhận tồn kho.',
    })
  }, [products, toast, updateActiveTab])

  // ===== Quét mã vạch hoặc gõ SKU + Enter (F2) =====
  const handleBarcodeSubmit = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim()
      if (!code) return
      const exact =
        products.find(
          (p) =>
            (p.barcode && p.barcode.toLowerCase() === code.toLowerCase()) ||
            p.sku.toLowerCase() === code.toLowerCase()
        ) ??
        products.find((p) => p.name.toLowerCase().includes(code.toLowerCase())) ??
        null

      if (!exact) {
        toast({
          title: `Không tìm thấy mã "${code}"`,
          description: 'Vui lòng kiểm tra lại SKU / Barcode hoặc tìm theo tên.',
          variant: 'destructive',
        })
        return
      }
      addProductToSlip(exact, 1)
      setBarcodeInput('')
      toast({
        title: `Đã thêm ${exact.name} vào ${activeTab.label}`,
        description: `${exact.sku} · ĐVT: ${exact.unitConfig?.purchaseUnit || exact.unit || 'cái'}`,
      })
    },
    [products, addProductToSlip, activeTab.label, toast]
  )

  const updateItemField = useCallback(
    (productId: string, patch: Partial<FastStockCartItem>) => {
      updateActiveTab((tab) => ({
        ...tab,
        items: tab.items.map((it) => (it.productId === productId ? { ...it, ...patch } : it)),
      }))
    },
    [updateActiveTab]
  )

  const removeSlipItem = useCallback(
    (productId: string) => {
      updateActiveTab((tab) => ({
        ...tab,
        items: tab.items.filter((it) => it.productId !== productId),
      }))
    },
    [updateActiveTab]
  )

  const addNewSlipTab = () => {
    const idx = nextTabCounter.current++
    const defWh = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? ''
    const newTab = createEmptySlipTab(idx, defWh, activeTab.mode)
    setTabs((prev) => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const closeSlipTab = (tabId: string) => {
    if (tabs.length <= 1) {
      const defWh = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? ''
      const reset = createEmptySlipTab(1, defWh, activeTab.mode)
      setTabs([reset])
      setActiveTabId(reset.id)
      return
    }
    const remaining = tabs.filter((t) => t.id !== tabId)
    setTabs(remaining)
    if (activeTab.id === tabId) {
      setActiveTabId(remaining[remaining.length - 1].id)
    }
  }

  // ===== Lọc danh sách sản phẩm hiển thị bên trái =====
  const isRawMaterialProduct = useCallback((p: Product) => {
    return (
      p.type === 'MATERIAL' ||
      p.type === 'RAW_MATERIAL' ||
      p.type === 'WEIGHT_BULK' ||
      p.sku.includes('-SAP-') ||
      p.sku.includes('-VL-')
    )
  }, [])

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return products.filter((p) => {
      if (selectedCategory !== 'ALL' && p.categoryId !== selectedCategory) return false
      const uc = p.unitConfig
      const hasConv = Boolean((uc && (uc.purchaseRate > 1 || uc.sellRate > 1)) || p.type === 'WEIGHT_BULK')
      const isMat = isRawMaterialProduct(p)
      const hasBom = bomByProductId.has(p.id)

      if (typeFilter === 'BOM_READY' && !hasBom) return false
      if (typeFilter === 'WEIGHT_CONV' && !hasConv) return false
      if (typeFilter === 'MATERIAL' && !isMat) return false
      if (typeFilter === 'FINISHED' && isMat) return false
      if (typeFilter === 'LOW_STOCK' && p.stock > p.lowStockThreshold) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, searchQuery, selectedCategory, typeFilter, isRawMaterialProduct, bomByProductId])

  // Map sản phẩm đã có trong phiếu hiện hành
  const slipItemByProduct = useMemo(() => {
    const map = new Map<string, FastStockCartItem>()
    for (const it of activeTab.items) {
      map.set(it.productId, it)
    }
    return map
  }, [activeTab.items])

  // Tổng hợp bảng Nguyên vật liệu cần trừ khi ở chế độ SẢN XUẤT (PRODUCTION)
  const productionMaterialRequirements = useMemo(() => {
    if (activeTab.mode !== 'PRODUCTION') return []
    const map = new Map<
      string,
      {
        componentId: string
        sku: string
        name: string
        unit: string
        purchaseUnit: string
        purchaseRate: number
        costPrice: number
        currentStock: number
        autoRequiredQty: number
        finalRequiredQty: number
        usedFor: string[]
      }
    >()

    for (const it of activeTab.items) {
      const prodQty = Math.max(0, Math.round((Number(it.quantity) || 0) * Math.max(1, Number(it.conversionRate) || 1)))
      if (prodQty <= 0) continue
      const bom = bomByProductId.get(it.productId)
      if (!bom || !bom.components) continue
      for (const c of bom.components) {
        const cp = c.componentProduct
        const need = Math.round(c.quantity * prodQty)
        const existing = map.get(cp.id) ?? {
          componentId: cp.id,
          sku: cp.sku,
          name: cp.name,
          unit: cp.unit || 'đv',
          purchaseUnit: cp.purchaseUnit || cp.unit || 'đv',
          purchaseRate: Math.max(1, Number(cp.purchaseRate) || 1),
          costPrice: cp.costPrice || 0,
          currentStock: cp.stock,
          autoRequiredQty: 0,
          finalRequiredQty: 0,
          usedFor: [],
        }
        existing.autoRequiredQty += need
        existing.usedFor.push(`${prodQty} ${it.baseUnit} ${it.sku}`)
        map.set(cp.id, existing)
      }
    }

    const customOverrides = activeTab.customMaterialQty ?? {}
    return Array.from(map.values()).map((row) => {
      const customVal = customOverrides[row.componentId]
      const finalRequiredQty =
        typeof customVal === 'number' && Number.isFinite(customVal) && customVal >= 0
          ? Math.round(customVal)
          : row.autoRequiredQty
      return {
        ...row,
        finalRequiredQty,
        stockAfter: row.currentStock - finalRequiredQty,
        isEnough: row.currentStock >= finalRequiredQty,
      }
    })
  }, [activeTab.mode, activeTab.items, activeTab.customMaterialQty, bomByProductId])

  // Tổng hợp số liệu toàn phiếu
  const slipTotals = useMemo(() => {
    let totalInputQty = 0
    let totalConvertedUnits = 0
    let totalCostValue = 0
    for (const it of activeTab.items) {
      const qty = Math.max(0, Number(it.quantity) || 0)
      const rate = Math.max(1, Number(it.conversionRate) || 1)
      const converted = Math.round(qty * rate)
      totalInputQty += qty
      totalConvertedUnits += converted
      const unitRatio = it.defaultPurchaseRate > 1 ? rate / it.defaultPurchaseRate : 1
      totalCostValue += Math.round(qty * unitRatio * (it.costPrice || 0))
    }
    const totalMaterialCost = productionMaterialRequirements.reduce(
      (sum, m) => sum + m.finalRequiredQty * m.costPrice,
      0
    )
    const hasInsufficientMaterial = productionMaterialRequirements.some((m) => !m.isEnough)
    return {
      skuCount: activeTab.items.length,
      totalInputQty,
      totalConvertedUnits,
      totalCostValue: activeTab.mode === 'PRODUCTION' && totalMaterialCost > 0 ? totalMaterialCost : totalCostValue,
      totalMaterialCost,
      hasInsufficientMaterial,
    }
  }, [activeTab.items, activeTab.mode, productionMaterialRequirements])

  // ===== Thực thi Hoàn tất Phiếu Kho / Phiếu Sản Xuất (F9) =====
  const handleExecuteBatchSlip = useCallback(async () => {
    if (activeTab.items.length === 0) {
      toast({
        title: 'Phiếu đang trống',
        description: 'Vui lòng chọn sản phẩm ở cột bên trái để đưa vào phiếu.',
        variant: 'destructive',
      })
      return
    }
    if (activeTab.mode === 'PRODUCTION' && slipTotals.hasInsufficientMaterial) {
      toast({
        title: 'Không đủ nguyên vật liệu trong kho để sản xuất',
        description: 'Vui lòng nhập thêm nguyên vật liệu hoặc giảm số lượng thành phẩm sản xuất.',
        variant: 'destructive',
      })
      return
    }

    setSubmitting(true)
    try {
      const snapshotItems = activeTab.items.map((it) => {
        const qty = Number(it.quantity) || 0
        const rate = Math.max(1, Number(it.conversionRate) || 1)
        const converted = Math.round(qty * rate)
        const stockAfter =
          activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION'
            ? it.currentStock + converted
            : activeTab.mode === 'EXPORT'
              ? it.currentStock - converted
              : converted
        return {
          sku: it.sku,
          name: it.name,
          inputQty: qty,
          inputUnit: it.inputUnit,
          conversionRate: rate,
          convertedQty: converted,
          baseUnit: it.baseUnit,
          stockBefore: it.currentStock,
          stockAfter,
          costPrice: it.costPrice,
        }
      })

      const res = await apiPost<{
        batchCode: string
        count: number
        totalConvertedUnits: number
        consumedMaterials?: CompletedBatchReceipt['consumedMaterials']
      }>('/api/inventory', {
        type: activeTab.mode,
        warehouseId: activeTab.warehouseId || undefined,
        supplierName: activeTab.supplierName || undefined,
        note: activeTab.note || undefined,
        items: activeTab.items.map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity) || 0,
          conversionRate: Math.max(1, Number(it.conversionRate) || 1),
          inputUnit: it.inputUnit,
          costPrice: it.costPrice,
          note: it.note || undefined,
        })),
        ...(activeTab.mode === 'PRODUCTION' && productionMaterialRequirements.length > 0
          ? {
              customMaterials: productionMaterialRequirements.map((m) => ({
                componentId: m.componentId,
                quantity: m.finalRequiredQty,
              })),
            }
          : {}),
      })

      const whName =
        warehouses.find((w) => w.id === activeTab.warehouseId)?.name ?? shopProfile.defaultWarehouseLabel

      setCompletedReceipt({
        batchCode: res.batchCode,
        mode: activeTab.mode,
        warehouseName: whName,
        supplierName:
          activeTab.supplierName ||
          (activeTab.mode === 'PRODUCTION' ? shopProfile.defaultWorkshopName : 'Nhập trực tiếp tại kho'),
        completedAt: formatDateTime(new Date().toISOString()),
        totalSkus: res.count,
        totalConvertedUnits: res.totalConvertedUnits,
        totalValue: slipTotals.totalCostValue,
        items: snapshotItems,
        consumedMaterials: res.consumedMaterials,
      })

      toast({
        title:
          activeTab.mode === 'PRODUCTION'
            ? `Đã hoàn tất lệnh sản xuất ${res.batchCode} (+${formatNumber(res.totalConvertedUnits)} thành phẩm)`
            : `Đã hoàn tất phiếu ${res.batchCode} (${res.count} mặt hàng)`,
        description:
          activeTab.mode === 'PRODUCTION'
            ? `Đã tự động trừ ${res.consumedMaterials?.length ?? 0} loại nguyên vật liệu trong kho và cộng tồn thành phẩm.`
            : `Tổng định lượng quy đổi đồng bộ: ${formatNumber(res.totalConvertedUnits)} đơn vị gốc.`,
      })

      // Xóa giỏ của phiếu vừa thực thi để sẵn sàng nhập lô tiếp theo
      updateActiveTab((tab) => ({
        ...tab,
        items: [],
        note: '',
        customMaterialQty: {},
      }))
      setMobileSection('catalog')

      // Cập nhật Optimistic tồn kho hiển thị ngay trên danh mục trước khi đồng bộ mạng
      const stockMap = new Map<string, number>()
      for (const it of snapshotItems) {
        stockMap.set(it.sku, it.stockAfter)
      }
      if (res.consumedMaterials) {
        for (const mat of res.consumedMaterials) {
          stockMap.set(mat.sku, mat.stockAfter)
        }
      }
      setProducts((prev) =>
        prev.map((p) => (stockMap.has(p.sku) ? { ...p, stock: stockMap.get(p.sku)! } : p))
      )

      await loadData(true)
      onCompleted?.()
    } catch (err) {
      toast({
        title: 'Không thể thực thi phiếu kho',
        description: err instanceof Error ? err.message : 'Vui lòng kiểm tra lại số lượng tồn kho',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }, [
    activeTab,
    warehouses,
    slipTotals.totalCostValue,
    slipTotals.hasInsufficientMaterial,
    productionMaterialRequirements,
    toast,
    updateActiveTab,
    loadData,
    onCompleted,
  ])

  // Phím tắt F2 (Quét mã / Tìm nhanh) & F9 (Hoàn tất Phiếu Kho) giống hệt POS
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault()
        barcodeRef.current?.focus()
        barcodeRef.current?.select()
      } else if (e.key === 'F9') {
        e.preventDefault()
        if (!submitting && activeTab.items.length > 0) {
          void handleExecuteBatchSlip()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [submitting, activeTab.items.length, handleExecuteBatchSlip])

  const modeCfg = SLIP_MODE_CONFIG[activeTab.mode]

  return (
    <div className="space-y-3">
      {/* Thanh Đa Tab Phiếu Kho + Chuyển đổi Nhập / Xuất / Kiểm kê giống POS */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-2 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const isAct = tab.id === activeTab.id
            return (
              <div
                key={tab.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all',
                  isAct
                    ? 'border-[#0066CC] bg-[#0066CC] text-white shadow-xs'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveTabId(tab.id)}
                  className="flex items-center gap-1.5"
                >
                  <span>{tab.label}</span>
                  {tab.items.length > 0 && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums',
                        isAct ? 'bg-white/25 text-white' : 'bg-[#0066CC]/15 text-[#0066CC]'
                      )}
                    >
                      {tab.items.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => closeSlipTab(tab.id)}
                  title="Đóng / Làm mới phiếu"
                  className={cn(
                    'rounded p-0.5 hover:bg-black/15',
                    isAct ? 'text-white/80 hover:text-white' : 'text-muted-foreground'
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addNewSlipTab}
            className="h-8 gap-1 border-dashed px-2.5 text-xs font-semibold text-[#0066CC]"
          >
            <Plus className="h-3.5 w-3.5" />
            Phiếu mới
          </Button>
        </div>

        {/* Chế độ phiếu: Nhập kho / Sản xuất / Xuất kho / Kiểm kê + Nút nạp nhanh SP sắp hết */}
        <div className="flex flex-wrap items-center gap-1.5">
          {allowedModes.map((m) => {
            const cfg = SLIP_MODE_CONFIG[m]
            const Icon = cfg.icon
            const active = activeTab.mode === m
            return (
              <button
                key={m}
                type="button"
                onClick={() => {
                  updateActiveTab((tab) => ({
                    ...tab,
                    mode: m,
                    supplierName:
                      m === 'PRODUCTION' && !tab.supplierName
                        ? shopProfile.defaultWorkshopName
                        : m !== 'PRODUCTION' && tab.supplierName === shopProfile.defaultWorkshopName
                          ? ''
                          : tab.supplierName,
                  }))
                  if (m === 'PRODUCTION') {
                    setTypeFilter('BOM_READY')
                  } else if (typeFilter === 'BOM_READY') {
                    setTypeFilter('ALL')
                  }
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all',
                  active ? cfg.btnClass : 'border-border bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {cfg.shortLabel}
              </button>
            )
          })}

          {activeTab.mode !== 'PRODUCTION' && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={fillAllLowStockProducts}
              className="h-8 gap-1 border-amber-400/60 bg-amber-50/70 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-300"
            >
              <Plus className="h-3.5 w-3.5 text-amber-600" />
              Thêm SP sắp hết hàng
            </Button>
          )}
        </div>
      </div>

      {/* Thanh chuyển đổi trên Mobile (< lg) */}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-card p-1 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileSection('catalog')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all',
            mobileSection === 'catalog'
              ? 'bg-[#0066CC] text-white'
              : 'text-muted-foreground'
          )}
        >
          <Package className="h-4 w-4" />
          {activeTab.mode === 'PRODUCTION'
            ? `Chọn Thành Phẩm (${filteredProducts.length})`
            : `Chọn Hàng Hóa (${filteredProducts.length})`}
        </button>
        <button
          type="button"
          onClick={() => setMobileSection('slip')}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all',
            mobileSection === 'slip'
              ? 'bg-emerald-600 text-white'
              : 'text-muted-foreground'
          )}
        >
          <Scale className="h-4 w-4" />
          Phiếu {modeCfg.shortLabel} ({activeTab.items.length} mã)
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ==================== CỘT TRÁI (7/12): DANH MỤC HÀNG HÓA / THÀNH PHẨM ==================== */}
        <div
          className={cn(
            'flex-col gap-3 lg:col-span-7 lg:flex',
            mobileSection === 'catalog' ? 'flex' : 'hidden'
          )}
        >
          <Card className="border-border/80 shadow-xs">
            <CardContent className="space-y-3 p-3 sm:p-4">
              {/* Ô Quét Barcode / SKU (F2) + Ô Tìm kiếm nhanh */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <div className="relative sm:col-span-6">
                  <Barcode className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0066CC]" />
                  <Input
                    ref={barcodeRef}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleBarcodeSubmit(barcodeInput)
                      }
                    }}
                    placeholder="Quét mã vạch / Gõ SKU + Enter (F2)..."
                    className="h-10 border-[#0066CC]/40 bg-sky-50/30 pl-9 font-mono text-xs focus-visible:ring-[#0066CC] dark:bg-sky-950/20"
                  />
                </div>
                <div className="relative sm:col-span-5">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={
                      activeTab.mode === 'PRODUCTION'
                        ? 'Tìm thành phẩm cần sản xuất (nến, thạch cao...)'
                        : 'Tìm tên sản phẩm, nguyên liệu, sáp, trầm...'
                    }
                    className="h-10 pl-9 text-xs"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1 sm:col-span-1">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => setViewMode((v) => (v === 'grid' ? 'table' : 'grid'))}
                    className="h-10 w-10 shrink-0"
                    title={viewMode === 'grid' ? 'Chuyển sang dạng bảng' : 'Chuyển sang dạng lưới thẻ'}
                  >
                    {viewMode === 'grid' ? <ListFilter className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {/* Bộ lọc phân loại theo chế độ Nhập kho vs Sản xuất */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(activeTab.mode === 'PRODUCTION'
                  ? ([
                      {
                        key: 'BOM_READY',
                        label: `Thành phẩm có định mức BOM (${
                          products.filter((p) => bomByProductId.has(p.id)).length
                        })`,
                      },
                      {
                        key: 'FINISHED',
                        label: `Tất cả thành phẩm (${
                          products.filter((p) => !isRawMaterialProduct(p)).length
                        })`,
                      },
                      { key: 'ALL', label: `Tất cả (${products.length})` },
                    ] as const)
                  : ([
                      { key: 'ALL', label: `Tất cả (${products.length})` },
                      {
                        key: 'MATERIAL',
                        label: `Nguyên vật liệu (${
                          products.filter((p) => isRawMaterialProduct(p)).length
                        })`,
                      },
                      {
                        key: 'WEIGHT_CONV',
                        label: `Có quy đổi ĐVT (${
                          products.filter(
                            (p) =>
                              (p.unitConfig && p.unitConfig.purchaseRate > 1) || p.type === 'WEIGHT_BULK'
                          ).length
                        })`,
                      },
                      {
                        key: 'FINISHED',
                        label: `Thành phẩm & Hàng bán (${
                          products.filter((p) => !isRawMaterialProduct(p)).length
                        })`,
                      },
                      {
                        key: 'LOW_STOCK',
                        label: `Sắp hết hàng (${products.filter((p) => p.stock <= p.lowStockThreshold).length})`,
                      },
                    ] as const)
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setTypeFilter(f.key)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-semibold transition-all',
                      typeFilter === f.key
                        ? 'border-[#0066CC] bg-[#0066CC] text-white'
                        : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {/* Bộ lọc Danh mục ngang */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => setSelectedCategory('ALL')}
                  className={cn(
                    'shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    selectedCategory === 'ALL'
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  Tất cả danh mục
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      'shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                      selectedCategory === cat.id
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>

              {/* Danh sách Sản phẩm */}
              {loading ? (
                <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tải danh mục hàng hóa...
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="flex h-52 flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center">
                  <Package className="mb-2 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-semibold text-muted-foreground">
                    Không tìm thấy sản phẩm khớp bộ lọc
                  </p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="grid max-h-[600px] grid-cols-1 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredProducts.map((p) => {
                    const uc = p.unitConfig
                    const bUnit = uc?.baseUnit || p.unit || 'cái'
                    const pUnit = uc?.purchaseUnit || bUnit
                    const pRate = uc?.purchaseRate && uc.purchaseRate > 0 ? uc.purchaseRate : 1
                    const inSlip = slipItemByProduct.get(p.id)
                    const isLow = p.stock <= p.lowStockThreshold
                    const bom = bomByProductId.get(p.id)
                    const maxMake = maxProducibleByProduct.get(p.id)

                    return (
                      <div
                        key={p.id}
                        onClick={() => addProductToSlip(p)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            addProductToSlip(p)
                          }
                        }}
                        className={cn(
                          'group relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 text-left transition-all hover:border-[#0066CC] hover:shadow-sm active:scale-[0.99]',
                          inSlip
                            ? 'border-emerald-500 bg-emerald-50/40 ring-1 ring-emerald-500/40 dark:bg-emerald-950/25'
                            : 'border-border/80 bg-card'
                        )}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <ProductAvatar name={p.name} image={p.image} className="h-9 w-9 shrink-0" />
                              <div className="min-w-0">
                                <p className="line-clamp-1 text-xs font-bold text-foreground group-hover:text-[#0066CC]">
                                  {p.name}
                                </p>
                                <p className="font-mono text-[10px] text-muted-foreground">{p.sku}</p>
                              </div>
                            </div>
                            {inSlip && (
                              <Badge className="shrink-0 bg-emerald-600 px-1.5 py-0 text-[10px] text-white">
                                +{inSlip.quantity} {inSlip.inputUnit}
                              </Badge>
                            )}
                          </div>

                          {/* Hiển thị công thức Định mức BOM (khi ở chế độ Sản xuất) hoặc Quy đổi ĐVT (khi ở chế độ Nhập kho) */}
                          <div className="mt-2 flex flex-wrap items-center gap-1">
                            {activeTab.mode === 'PRODUCTION' && bom ? (
                              <>
                                <span className="inline-flex items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                  <Boxes className="h-2.5 w-2.5" />
                                  Định mức: {bom.components.length} NVL
                                </span>
                                {maxMake !== undefined && (
                                  <span
                                    className={cn(
                                      'rounded-md px-1.5 py-0.5 text-[10px] font-bold',
                                      maxMake > 0
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                        : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    )}
                                  >
                                    {maxMake > 0 ? `Đủ NVL làm: ${formatNumber(maxMake)} ${bUnit}` : 'Thiếu NVL'}
                                  </span>
                                )}
                              </>
                            ) : pRate > 1 ? (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                <Scale className="h-2.5 w-2.5" />1 {pUnit} = {formatNumber(pRate)} {bUnit}
                              </span>
                            ) : (
                              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                ĐVT: {bUnit}
                              </span>
                            )}
                            {isLow && (
                              <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                Sắp hết
                              </span>
                            )}
                          </div>

                          {activeTab.mode === 'PRODUCTION' && bom && (
                            <p className="mt-1.5 line-clamp-2 text-[10px] text-muted-foreground">
                              {bom.components
                                .map((c) => `${formatNumber(c.quantity)} ${c.componentProduct.unit} ${c.componentProduct.name}`)
                                .join(' + ')}
                            </p>
                          )}
                        </div>

                        <div className="mt-2.5 flex items-end justify-between border-t border-border/60 pt-2">
                          <div>
                            <p className="text-[10px] text-muted-foreground">Tồn kho hiện tại</p>
                            <p className="text-xs font-bold tabular-nums text-foreground">
                              {formatNumber(p.stock)} {bUnit}
                              {pRate > 1 && (
                                <span className="ml-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  (≈ {(p.stock / pRate).toFixed(p.stock % pRate === 0 ? 0 : 1)} {pUnit})
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => addProductToSlip(p, 1)}
                              className="rounded-md border border-[#0066CC]/30 bg-[#0066CC]/10 px-2 py-1 text-[10px] font-bold text-[#0066CC] hover:bg-[#0066CC] hover:text-white dark:text-sky-300"
                            >
                              +1 {activeTab.mode === 'IMPORT' && pRate > 1 ? pUnit : bUnit}
                            </button>
                            <button
                              type="button"
                              onClick={() => addProductToSlip(p, 10)}
                              className="rounded-md bg-[#0066CC] px-2 py-1 text-[10px] font-bold text-white hover:bg-[#0055B3]"
                            >
                              +10 {activeTab.mode === 'IMPORT' && pRate > 1 ? pUnit : bUnit}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="max-h-[600px] overflow-y-auto rounded-lg border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 border-b bg-muted/90 text-[11px] font-semibold text-muted-foreground backdrop-blur">
                      <tr>
                        <th className="px-2.5 py-2">Sản phẩm / SKU</th>
                        <th className="px-2.5 py-2">
                          {activeTab.mode === 'PRODUCTION' ? 'Định mức BOM' : 'Quy đổi ĐVT'}
                        </th>
                        <th className="px-2.5 py-2 text-right">Tồn hiện tại</th>
                        <th className="px-2.5 py-2 text-right">Giá vốn</th>
                        <th className="px-2.5 py-2 text-right">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {filteredProducts.map((p) => {
                        const uc = p.unitConfig
                        const bUnit = uc?.baseUnit || p.unit || 'cái'
                        const pUnit = uc?.purchaseUnit || bUnit
                        const pRate = uc?.purchaseRate && uc.purchaseRate > 0 ? uc.purchaseRate : 1
                        const inSlip = slipItemByProduct.get(p.id)
                        const bom = bomByProductId.get(p.id)
                        return (
                          <tr key={p.id} className={cn('hover:bg-muted/40', inSlip && 'bg-emerald-50/50 dark:bg-emerald-950/20')}>
                            <td className="px-2.5 py-2">
                              <p className="font-semibold text-foreground">{p.name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{p.sku}</p>
                            </td>
                            <td className="px-2.5 py-2">
                              {activeTab.mode === 'PRODUCTION' && bom ? (
                                <span className="text-[11px] text-blue-700 dark:text-blue-300">
                                  {bom.components.map((c) => `${c.quantity} ${c.componentProduct.unit} ${c.componentProduct.sku}`).join(' + ')}
                                </span>
                              ) : pRate > 1 ? (
                                <Badge variant="outline" className="border-emerald-300 bg-emerald-50 font-mono text-[10px] text-emerald-800">
                                  1 {pUnit} = {formatNumber(pRate)} {bUnit}
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground">{bUnit}</span>
                              )}
                            </td>
                            <td className="px-2.5 py-2 text-right font-bold tabular-nums">
                              {formatNumber(p.stock)} {bUnit}
                            </td>
                            <td className="px-2.5 py-2 text-right tabular-nums text-muted-foreground">
                              {formatCompactVND(p.costPrice)}
                            </td>
                            <td className="px-2.5 py-2 text-right">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addProductToSlip(p, 1)}
                                  className="h-7 px-2 text-[11px]"
                                >
                                  +1 {activeTab.mode === 'IMPORT' && pRate > 1 ? pUnit : bUnit}
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => addProductToSlip(p, 10)}
                                  className="h-7 bg-[#0066CC] px-2 text-[11px] text-white hover:bg-[#0055B3]"
                                >
                                  +10 {activeTab.mode === 'IMPORT' && pRate > 1 ? pUnit : bUnit}
                                </Button>
                              </div>
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

        {/* ==================== CỘT PHẢI (5/12): PHIẾU NHẬP KHO / PHIẾU SẢN XUẤT ==================== */}
        <div
          className={cn(
            'flex-col gap-3 lg:col-span-5 lg:flex',
            mobileSection === 'slip' ? 'flex' : 'hidden'
          )}
        >
          <Card className="border-border/80 shadow-sm">
            <CardContent className="space-y-3.5 p-3.5 sm:p-4">
              {/* Header Phiếu Kho + Chọn Kho & Nhà cung cấp / Tổ sản xuất */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2.5">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn('px-2 py-0.5 text-xs font-bold', modeCfg.badgeClass)}>
                    {modeCfg.label}
                  </Badge>
                </div>
                {activeTab.items.length > 0 && (
                  <button
                    type="button"
                    onClick={() => updateActiveTab((tab) => ({ ...tab, items: [], customMaterialQty: {} }))}
                    className="text-xs font-medium text-rose-600 hover:underline"
                  >
                    Xóa trắng phiếu
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                    <Warehouse className="h-3 w-3 text-[#0066CC]" />
                    {activeTab.mode === 'PRODUCTION' ? 'Kho xuất NVL & nhập TP' : 'Kho thực hiện'}
                  </Label>
                  <Select
                    value={activeTab.warehouseId || undefined}
                    onValueChange={(v) => updateActiveTab((tab) => ({ ...tab, warehouseId: v }))}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={shopProfile.defaultWarehouseLabel} />
                    </SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-muted-foreground">
                    {activeTab.mode === 'PRODUCTION'
                      ? 'Tổ / Xưởng sản xuất'
                      : 'Nhà cung cấp / Nguồn lô hàng'}
                  </Label>
                  <Input
                    list="fast-stock-suppliers-list"
                    value={activeTab.supplierName}
                    onChange={(e) => updateActiveTab((tab) => ({ ...tab, supplierName: e.target.value }))}
                    placeholder={
                      activeTab.mode === 'PRODUCTION'
                        ? `VD: ${shopProfile.defaultWorkshopName}...`
                        : 'Chọn hoặc gõ tên NCC...'
                    }
                    className="h-8 text-xs"
                  />
                  <datalist id="fast-stock-suppliers-list">
                    {activeTab.mode === 'PRODUCTION'
                      ? shopProfile.workshopPresets.map((ws) => <option key={ws} value={ws} />)
                      : suppliers.map((s) => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>
              </div>

              {/* Danh sách các mặt hàng trong Phiếu Kho / Phiếu Sản Xuất */}
              {activeTab.items.length === 0 ? (
                <div className="flex h-60 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-5 text-center">
                  <Scale className="mb-2 h-9 w-9 text-muted-foreground/40" />
                  <p className="text-xs font-bold text-foreground">
                    {activeTab.mode === 'PRODUCTION'
                      ? `Chưa chọn thành phẩm cần sản xuất trong ${activeTab.label}`
                      : `Chưa có sản phẩm nào trong ${activeTab.label}`}
                  </p>
                  <p className="mt-1 max-w-xs text-[11px] text-muted-foreground">
                    {activeTab.mode === 'PRODUCTION'
                      ? 'Chọn thành phẩm ở cột bên trái để hệ thống tự động tính định mức nguyên vật liệu (sáp, tinh dầu, bấc, hũ) cần xuất trừ kho.'
                      : 'Chọn nguyên vật liệu hoặc hàng hóa ở danh sách bên trái, quét mã vạch (F2) để đưa vào phiếu.'}
                  </p>
                </div>
              ) : (
                <div className="max-h-[380px] divide-y overflow-y-auto rounded-xl border bg-background pr-1">
                  {activeTab.items.map((item, idx) => {
                    const qty = Math.max(0, Number(item.quantity) || 0)
                    const rate = Math.max(1, Number(item.conversionRate) || 1)
                    const convertedQty = Math.round(qty * rate)
                    const nextStock =
                      activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION'
                        ? item.currentStock + convertedQty
                        : activeTab.mode === 'EXPORT'
                          ? item.currentStock - convertedQty
                          : convertedQty

                    const unitPresets = [
                      ...(item.defaultPurchaseRate > 1
                        ? [
                            {
                              label: `1 ${item.defaultPurchaseUnit} = ${formatNumber(item.defaultPurchaseRate)} ${item.baseUnit}`,
                              unit: item.defaultPurchaseUnit,
                              rate: item.defaultPurchaseRate,
                            },
                          ]
                        : []),
                      {
                        label: `ĐV gốc: ${item.baseUnit} (×1)`,
                        unit: item.baseUnit,
                        rate: 1,
                      },
                      ...(item.baseUnit === 'gr'
                        ? [
                            { label: '1 Kg = 1.000 gr', unit: 'kg', rate: 1000 },
                            { label: 'Bao 5Kg = 5.000 gr', unit: 'bao 5kg', rate: 5000 },
                            { label: 'Bao 10Kg = 10.000 gr', unit: 'bao 10kg', rate: 10000 },
                          ]
                        : item.baseUnit === 'ml'
                          ? [{ label: '1 Lít = 1.000 ml', unit: 'lít', rate: 1000 }]
                          : [
                              { label: 'Hộp 10 (×10)', unit: 'hộp', rate: 10 },
                              { label: 'Thùng 24 (×24)', unit: 'thùng', rate: 24 },
                            ]),
                    ]
                    const uniquePresets = unitPresets.filter(
                      (p, i, arr) => arr.findIndex((x) => x.rate === p.rate && x.unit === p.unit) === i
                    )

                    return (
                      <div key={item.productId} className="space-y-2 p-3">
                        {/* Dòng 1: Tên SP + Xóa */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 items-start gap-2">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#0066CC]/10 text-[10px] font-bold text-[#0066CC]">
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-foreground">{item.name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">
                                {item.sku} · Tồn hiện tại:{' '}
                                <strong className="text-foreground">
                                  {formatNumber(item.currentStock)} {item.baseUnit}
                                </strong>
                              </p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeSlipItem(item.productId)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {/* Dòng 2: Chọn đơn vị quy đổi (ẩn khi ở chế độ Sản xuất thành phẩm tính theo cái/bộ) */}
                        {activeTab.mode !== 'PRODUCTION' && (
                          <div className="flex flex-wrap items-center gap-1">
                            {uniquePresets.map((preset) => {
                              const active =
                                item.conversionRate === preset.rate && item.inputUnit === preset.unit
                              return (
                                <button
                                  key={`${preset.unit}-${preset.rate}`}
                                  type="button"
                                  onClick={() =>
                                    updateItemField(item.productId, {
                                      inputUnit: preset.unit,
                                      conversionRate: preset.rate,
                                    })
                                  }
                                  className={cn(
                                    'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                                    active
                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                      : 'border-border bg-muted/40 text-muted-foreground hover:border-emerald-500 hover:text-foreground'
                                  )}
                                >
                                  {preset.label}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Dòng 3: Số lượng + Nút chọn nhanh 1 / 5 / 10 / 20 / 50 / 100 */}
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                updateItemField(item.productId, {
                                  quantity: Math.max(1, qty - 1),
                                })
                              }
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </Button>
                            <Input
                              type="number"
                              min={0.1}
                              step="any"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItemField(item.productId, {
                                  quantity: Math.max(0, Number(e.target.value) || 0),
                                })
                              }
                              className="h-8 w-16 px-1.5 text-center text-xs font-extrabold tabular-nums"
                            />
                            <span className="text-xs font-semibold text-foreground">{item.inputUnit}</span>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() =>
                                updateItemField(item.productId, {
                                  quantity: qty + 1,
                                })
                              }
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1">
                            {QUICK_QTY_CHIPS.map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => updateItemField(item.productId, { quantity: chip })}
                                className={cn(
                                  'rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold transition-colors',
                                  qty === chip
                                    ? 'border-[#0066CC] bg-[#0066CC] text-white'
                                    : 'border-border bg-muted/30 text-foreground hover:bg-muted'
                                )}
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Dòng 4: Kết quả quy đổi thời gian thực */}
                        <div
                          className={cn(
                            'flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px]',
                            nextStock < 0
                              ? 'border border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                              : 'bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                          )}
                        >
                          <span className="font-bold tabular-nums">
                            {rate > 1 ? (
                              <>
                                {qty} {item.inputUnit} × {formatNumber(rate)} ={' '}
                                {activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION'
                                  ? '+'
                                  : activeTab.mode === 'EXPORT'
                                    ? '-'
                                    : ''}
                                {formatNumber(convertedQty)} {item.baseUnit}
                              </>
                            ) : (
                              <>
                                {activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION'
                                  ? '+'
                                  : activeTab.mode === 'EXPORT'
                                    ? '-'
                                    : 'Tồn mới: '}
                                {formatNumber(convertedQty)} {item.baseUnit}
                              </>
                            )}
                          </span>
                          <span className="font-mono text-[10px]">
                            Tồn sau phiếu:{' '}
                            <strong className="font-bold">
                              {formatNumber(nextStock)} {item.baseUnit}
                            </strong>
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* BẢNG NGUYÊN VẬT LIỆU TỰ ĐỘNG XUẤT TRỪ KHO KHI SẢN XUẤT */}
              {activeTab.mode === 'PRODUCTION' && activeTab.items.length > 0 && (
                <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-blue-900 dark:text-blue-300">
                      <Boxes className="h-3.5 w-3.5 text-[#0066CC]" />
                      Nguyên vật liệu tự động xuất trừ kho ({productionMaterialRequirements.length} NVL)
                    </span>
                    {Object.keys(activeTab.customMaterialQty ?? {}).length > 0 && (
                      <button
                        type="button"
                        onClick={() => updateActiveTab((tab) => ({ ...tab, customMaterialQty: {} }))}
                        className="text-[10px] font-semibold text-[#0066CC] hover:underline"
                      >
                        Khôi phục theo định mức chuẩn
                      </button>
                    )}
                  </div>

                  {productionMaterialRequirements.length === 0 ? (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Thành phẩm đang chọn chưa khai báo công thức Định mức (BOM). Phiếu sản xuất sẽ chỉ cộng tồn kho thành phẩm.
                    </p>
                  ) : (
                    <div className="divide-y rounded-lg border bg-background text-xs">
                      {productionMaterialRequirements.map((mat) => (
                        <div key={mat.componentId} className="flex flex-wrap items-center justify-between gap-2 p-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-foreground">{mat.name}</p>
                            <p className="font-mono text-[10px] text-muted-foreground">
                              {mat.sku} · Tồn kho:{' '}
                              <strong className={mat.isEnough ? 'text-foreground' : 'text-rose-600'}>
                                {formatNumber(mat.currentStock)} {mat.unit}
                              </strong>
                              {mat.purchaseRate > 1 && (
                                <span className="ml-1 text-emerald-600">
                                  (≈ {(mat.currentStock / mat.purchaseRate).toFixed(1)} {mat.purchaseUnit})
                                </span>
                              )}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-rose-600">Trừ:</span>
                            <Input
                              type="number"
                              min={0}
                              value={mat.finalRequiredQty}
                              onChange={(e) => {
                                const val = Math.max(0, Number(e.target.value) || 0)
                                updateActiveTab((tab) => ({
                                  ...tab,
                                  customMaterialQty: {
                                    ...(tab.customMaterialQty ?? {}),
                                    [mat.componentId]: val,
                                  },
                                }))
                              }}
                              className="h-7 w-20 px-1.5 text-right font-mono text-xs font-bold"
                            />
                            <span className="font-mono text-[11px] font-semibold">{mat.unit}</span>
                            <Badge
                              variant="outline"
                              className={cn(
                                'px-1.5 py-0 text-[10px]',
                                mat.isEnough
                                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              )}
                            >
                              {mat.isEnough
                                ? `Còn ${formatNumber(mat.stockAfter)} ${mat.unit}`
                                : `Thiếu ${formatNumber(Math.abs(mat.stockAfter))} ${mat.unit}`}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Ghi chú phiếu & Tổng hợp định lượng + Nút Thực thi F9 */}
              <div className="space-y-3 border-t pt-3">
                <Input
                  value={activeTab.note}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, note: e.target.value }))}
                  placeholder={
                    activeTab.mode === 'PRODUCTION'
                      ? 'Ghi chú mẻ sản xuất (VD: Đổ nến bơ & thạch cao ca sáng)...'
                      : 'Ghi chú phiếu kho (VD: Nhập sáp đậu nành & trầm nụ lô tháng 11)...'
                  }
                  className="h-8 text-xs"
                />

                <div className="rounded-xl border border-emerald-300/80 bg-emerald-50/60 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {activeTab.mode === 'PRODUCTION' ? 'Số mã thành phẩm sản xuất:' : 'Số mã hàng trong phiếu:'}
                    </span>
                    <span className="font-bold tabular-nums">{slipTotals.skuCount} mã SP</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {activeTab.mode === 'PRODUCTION'
                        ? 'Tổng thành phẩm cộng kho:'
                        : 'Tổng định lượng quy đổi gốc:'}
                    </span>
                    <span className="text-sm font-extrabold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION'
                        ? '+'
                        : activeTab.mode === 'EXPORT'
                          ? '-'
                          : ''}
                      {formatNumber(slipTotals.totalConvertedUnits)} đơn vị gốc
                    </span>
                  </div>
                  {(activeTab.mode === 'IMPORT' || activeTab.mode === 'PRODUCTION') &&
                    slipTotals.totalCostValue > 0 && (
                      <div className="mt-1 flex items-center justify-between border-t border-emerald-200/80 pt-1 text-xs dark:border-emerald-800/60">
                        <span className="text-muted-foreground">
                          {activeTab.mode === 'PRODUCTION'
                            ? 'Tổng giá vốn NVL tiêu hao:'
                            : 'Ước tính giá trị lô nhập:'}
                        </span>
                        <span className="font-bold tabular-nums text-foreground">
                          {formatVND(slipTotals.totalCostValue)}
                        </span>
                      </div>
                    )}
                </div>

                <Button
                  type="button"
                  disabled={
                    submitting ||
                    activeTab.items.length === 0 ||
                    (activeTab.mode === 'PRODUCTION' && slipTotals.hasInsufficientMaterial)
                  }
                  onClick={() => void handleExecuteBatchSlip()}
                  className={cn('h-11 w-full text-sm font-bold shadow-sm', modeCfg.btnClass)}
                >
                  {submitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Hoàn tất phiếu {modeCfg.shortLabel.toLowerCase()} ({activeTab.items.length} SP) — F9
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Biên lai Xác nhận Phiếu Kho / Phiếu Sản Xuất vừa thực thi */}
      <Dialog open={completedReceipt !== null} onOpenChange={(o) => !o && setCompletedReceipt(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
              {completedReceipt?.mode === 'PRODUCTION'
                ? `Đã hoàn tất Lệnh Sản Xuất ${completedReceipt?.batchCode}`
                : `Đã hoàn tất Phiếu Kho ${completedReceipt?.batchCode}`}
            </DialogTitle>
            <DialogDescription>
              {completedReceipt?.warehouseName} · {completedReceipt?.completedAt}
            </DialogDescription>
          </DialogHeader>

          {completedReceipt && (
            <div className="space-y-3 py-1 text-xs">
              <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-2.5 text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    {completedReceipt.mode === 'PRODUCTION' ? 'Thành phẩm' : 'Số mặt hàng'}
                  </p>
                  <p className="text-sm font-bold">{completedReceipt.totalSkus} SKU</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    {completedReceipt.mode === 'PRODUCTION' ? 'Cộng kho TP' : 'Tổng quy đổi'}
                  </p>
                  <p className="text-sm font-bold text-emerald-600">
                    +{formatNumber(completedReceipt.totalConvertedUnits)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">
                    {completedReceipt.mode === 'PRODUCTION' ? 'Vốn NVL tiêu hao' : 'Giá trị lô hàng'}
                  </p>
                  <p className="text-sm font-bold">{formatCompactVND(completedReceipt.totalValue)}</p>
                </div>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-bold text-foreground">
                  {completedReceipt.mode === 'PRODUCTION'
                    ? '1. Thành phẩm đã cộng vào kho:'
                    : 'Chi tiết mặt hàng:'}
                </p>
                <div className="max-h-48 divide-y overflow-y-auto rounded-lg border">
                  {completedReceipt.items.map((it) => (
                    <div key={it.sku} className="flex items-center justify-between gap-2 p-2.5">
                      <div>
                        <p className="font-semibold text-foreground">{it.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {it.sku} · {it.inputQty} {it.inputUnit} × {formatNumber(it.conversionRate)} ={' '}
                          <strong className="text-emerald-700 dark:text-emerald-400">
                            +{formatNumber(it.convertedQty)} {it.baseUnit}
                          </strong>
                        </p>
                      </div>
                      <div className="text-right font-mono text-[11px]">
                        <span className="text-muted-foreground">{formatNumber(it.stockBefore)}</span>
                        {' ➔ '}
                        <strong className="text-foreground">
                          {formatNumber(it.stockAfter)} {it.baseUnit}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {completedReceipt.consumedMaterials && completedReceipt.consumedMaterials.length > 0 && (
                <div>
                  <p className="mb-1 text-[11px] font-bold text-blue-900 dark:text-blue-300">
                    2. Nguyên vật liệu đã tự động trừ kho:
                  </p>
                  <div className="max-h-48 divide-y overflow-y-auto rounded-lg border border-blue-200 bg-blue-50/30 dark:border-blue-900/60 dark:bg-blue-950/20">
                    {completedReceipt.consumedMaterials.map((mat) => (
                      <div key={mat.sku} className="flex items-center justify-between gap-2 p-2.5">
                        <div>
                          <p className="font-semibold text-foreground">{mat.name}</p>
                          <p className="font-mono text-[10px] text-rose-600 dark:text-rose-400">
                            {mat.sku} · Đã xuất trừ: <strong>-{formatNumber(mat.consumedQty)} {mat.unit}</strong>
                          </p>
                        </div>
                        <div className="text-right font-mono text-[11px]">
                          <span className="text-muted-foreground">{formatNumber(mat.stockBefore)}</span>
                          {' ➔ '}
                          <strong className="text-foreground">
                            {formatNumber(mat.stockAfter)} {mat.unit}
                          </strong>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setCompletedReceipt(null)} className="bg-[#0066CC] text-white hover:bg-[#0055B3]">
              Đóng &amp; Tiếp tục
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
