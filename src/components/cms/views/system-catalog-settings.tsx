'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Boxes,
  Check,
  FolderKanban,
  FolderPlus,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Scale,
  Search,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Trash2,
  X,
} from 'lucide-react'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api'
import { formatAttributesReadable, formatNumber, formatVND } from '@/lib/format'
import type { Category, Product, ProductTypeInfo, ProductUnitConfig } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ProductAvatar } from '@/components/cms/product-avatar'

const PRESET_CATEGORIES = [
  'Trầm hương & Nhang sạch',
  'Trà đạo & Ấm tử sa',
  'Thạch cao & Nến thơm',
  'Gốm sứ & Đồ thờ',
  'Combo & Quà tặng Tâm An',
  'Phụ kiện Thiền & Yoga',
]

const PRODUCT_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  SIMPLE: {
    label: 'Thành phẩm',
    className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300',
  },
  WEIGHT_BULK: {
    label: 'Định lượng Kg⇄Gr',
    className: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  },
  PACKAGED_VARIANT: {
    label: 'Đóng gói đồng bộ',
    className: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  },
  MATERIAL: {
    label: 'Nguyên vật liệu',
    className: 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
  },
  COMBO: {
    label: 'Combo',
    className: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300',
  },
}

function clientSlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

export type CatalogSettingsSubTab = 'CATEGORIES' | 'UNIT_CONVERSION' | 'ATTRIBUTES'

export function SystemCatalogSettings({
  activeSubTab,
  onSubTabChange,
}: {
  activeSubTab: CatalogSettingsSubTab
  onSubTabChange?: (tab: CatalogSettingsSubTab) => void
}) {
  const { toast } = useToast()

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [productTypes, setProductTypes] = useState<ProductTypeInfo[]>([])
  const [unitConfigs, setUnitConfigs] = useState<Record<string, ProductUnitConfig>>({})
  const [loading, setLoading] = useState(true)

  // ===== State Danh mục Sản phẩm =====
  const [newCatName, setNewCatName] = useState('')
  const [newCatSlug, setNewCatSlug] = useState('')
  const [newCatSlugTouched, setNewCatSlugTouched] = useState(false)
  const [creatingCat, setCreatingCat] = useState(false)
  const [editingCat, setEditingCat] = useState<Category | null>(null)
  const [editCatName, setEditCatName] = useState('')
  const [editCatSlug, setEditCatSlug] = useState('')
  const [savingCat, setSavingCat] = useState(false)
  const [deletingCat, setDeletingCat] = useState<Category | null>(null)
  const [reassignCatId, setReassignCatId] = useState<string>('NONE')
  const [deletingCatLoading, setDeletingCatLoading] = useState(false)
  const [assignCatModal, setAssignCatModal] = useState<Category | null>(null)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignOnlyUncategorized, setAssignOnlyUncategorized] = useState(false)
  const [selectedAssignProductIds, setSelectedAssignProductIds] = useState<string[]>([])
  const [savingAssign, setSavingAssign] = useState(false)

  // ===== State Loại SP & Quy đổi Định lượng =====
  const [convProductId, setConvProductId] = useState<string>('')
  const [convType, setConvType] = useState<string>('WEIGHT_BULK')
  const [convBaseUnit, setConvBaseUnit] = useState<string>('gr')
  const [convPurchaseUnit, setConvPurchaseUnit] = useState<string>('kg')
  const [convPurchaseRate, setConvPurchaseRate] = useState<string>('1000')
  const [convSellUnit, setConvSellUnit] = useState<string>('kg (1.000gr)')
  const [convSellRate, setConvSellRate] = useState<string>('1000')
  const [convLinkedBaseId, setConvLinkedBaseId] = useState<string>('NONE')
  const [convScaleCurrentStock, setConvScaleCurrentStock] = useState<boolean>(false)
  const [savingConv, setSavingConv] = useState<boolean>(false)

  const [newTypeCode, setNewTypeCode] = useState('')
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')
  const [savingNewType, setSavingNewType] = useState(false)

  const [quickImportProd, setQuickImportProd] = useState<Product | null>(null)
  const [quickImportQty, setQuickImportQty] = useState<string>('10')
  const [quickImportSaving, setQuickImportSaving] = useState<boolean>(false)

  // ===== State Đặc tính & Đơn vị tính nhanh =====
  const [attrSearch, setAttrSearch] = useState('')
  const [attrDrafts, setAttrDrafts] = useState<Record<string, { unit: string; attributes: string }>>({})
  const [savingAttrId, setSavingAttrId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [prodRes, catRes, ucRes] = await Promise.all([
        apiGet<{ products: Product[] }>('/api/products'),
        apiGet<{ categories: Category[] }>('/api/categories'),
        apiGet<{ productTypes: ProductTypeInfo[]; unitConfigs: Record<string, ProductUnitConfig> }>('/api/unit-conversions'),
      ])
      setProducts(prodRes.products)
      setCategories(catRes.categories)
      setProductTypes(ucRes.productTypes ?? [])
      setUnitConfigs(ucRes.unitConfigs ?? {})
      const drafts: Record<string, { unit: string; attributes: string }> = {}
      for (const p of prodRes.products) {
        drafts[p.id] = {
          unit: p.unit || 'cái',
          attributes: formatAttributesReadable(p.attributes).text,
        }
      }
      setAttrDrafts(drafts)
    } catch (err) {
      toast({
        title: 'Không thể tải dữ liệu cấu hình danh mục',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const uncategorizedProducts = useMemo(() => products.filter((p) => !p.categoryId), [products])

  const convertedProductsCount = useMemo(
    () =>
      products.filter((p) => {
        const uc = p.unitConfig ?? unitConfigs[p.id]
        return (
          (uc && (uc.purchaseRate > 1 || uc.sellRate > 1 || uc.linkedBaseProductId)) ||
          p.type === 'WEIGHT_BULK' ||
          p.type === 'PACKAGED_VARIANT' ||
          p.type === 'MATERIAL'
        )
      }).length,
    [products, unitConfigs]
  )

  const categoryStatsMap = useMemo(() => {
    const map = new Map<
      string,
      { count: number; activeCount: number; totalStock: number; totalStockValue: number; sampleNames: string[] }
    >()
    for (const c of categories) {
      map.set(c.id, { count: 0, activeCount: 0, totalStock: 0, totalStockValue: 0, sampleNames: [] })
    }
    for (const p of products) {
      if (!p.categoryId) continue
      const entry = map.get(p.categoryId) ?? {
        count: 0,
        activeCount: 0,
        totalStock: 0,
        totalStockValue: 0,
        sampleNames: [],
      }
      const uc = p.unitConfig ?? unitConfigs[p.id]
      const pRate = uc?.purchaseRate || 1
      const unitCost = p.type === 'COMBO' ? (p.comboCostPrice ?? p.costPrice ?? 0) : (p.costPrice ?? 0)
      const effectiveStock = p.type === 'COMBO' ? (p.comboAvailable ?? p.stock) : p.stock
      entry.count += 1
      if (p.status === 'ACTIVE') entry.activeCount += 1
      entry.totalStock += Math.max(0, effectiveStock)
      entry.totalStockValue += Math.max(0, Math.round((effectiveStock / (pRate > 1 ? pRate : 1)) * unitCost))
      if (entry.sampleNames.length < 3) entry.sampleNames.push(p.name)
      map.set(p.categoryId, entry)
    }
    return map
  }, [categories, products, unitConfigs])

  // ===== Handlers Danh mục =====
  const handleCreateCategory = async (customName?: string) => {
    const nameToUse = (customName ?? newCatName).trim()
    if (!nameToUse) {
      toast({ title: 'Vui lòng nhập tên danh mục sản phẩm', variant: 'destructive' })
      return
    }
    const slugToUse = customName ? clientSlugify(customName) : (newCatSlug.trim() || clientSlugify(nameToUse))
    setCreatingCat(true)
    try {
      const res = await apiPost<{ category: Category }>('/api/categories', {
        name: nameToUse,
        slug: slugToUse,
      })
      toast({
        title: 'Đã tạo danh mục sản phẩm mới',
        description: `${res.category.name} (/${res.category.slug})`,
      })
      if (!customName) {
        setNewCatName('')
        setNewCatSlug('')
        setNewCatSlugTouched(false)
      }
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể tạo danh mục',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setCreatingCat(false)
    }
  }

  const openEditCategory = (cat: Category) => {
    setEditingCat(cat)
    setEditCatName(cat.name)
    setEditCatSlug(cat.slug)
  }

  const handleSaveEditCategory = async () => {
    if (!editingCat) return
    const name = editCatName.trim()
    const slug = clientSlugify(editCatSlug.trim() || name)
    if (!name) {
      toast({ title: 'Tên danh mục không được để trống', variant: 'destructive' })
      return
    }
    setSavingCat(true)
    try {
      await apiPut<{ category: Category }>(`/api/categories/${editingCat.id}`, { name, slug })
      toast({ title: 'Đã cập nhật danh mục', description: `${name} (/${slug})` })
      setEditingCat(null)
      await loadAll()
    } catch (err) {
      toast({
        title: 'Cập nhật danh mục thất bại',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSavingCat(false)
    }
  }

  const handleDeleteCategory = async () => {
    if (!deletingCat) return
    setDeletingCatLoading(true)
    try {
      const qs = reassignCatId && reassignCatId !== 'NONE' ? `?reassignTo=${encodeURIComponent(reassignCatId)}` : ''
      await apiDelete<{ success: boolean; affectedProducts: number }>(`/api/categories/${deletingCat.id}${qs}`)
      toast({
        title: 'Đã xóa danh mục sản phẩm',
        description: deletingCat.name,
      })
      setDeletingCat(null)
      setReassignCatId('NONE')
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể xóa danh mục',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setDeletingCatLoading(false)
    }
  }

  const openAssignProductsModal = (cat: Category, defaultUncategorizedOnly = false) => {
    setAssignCatModal(cat)
    setAssignSearch('')
    setAssignOnlyUncategorized(defaultUncategorizedOnly)
    const currentlyInCat = products.filter((p) => p.categoryId === cat.id).map((p) => p.id)
    setSelectedAssignProductIds(currentlyInCat)
  }

  const handleSaveAssignProducts = async () => {
    if (!assignCatModal) return
    setSavingAssign(true)
    try {
      const currentlyInCat = new Set(products.filter((p) => p.categoryId === assignCatModal.id).map((p) => p.id))
      const nextSelected = new Set(selectedAssignProductIds)
      const assignProductIds = selectedAssignProductIds.filter((id) => !currentlyInCat.has(id))
      const removeProductIds = Array.from(currentlyInCat).filter((id) => !nextSelected.has(id))

      await apiPut<{ category: Category }>(`/api/categories/${assignCatModal.id}`, {
        name: assignCatModal.name,
        slug: assignCatModal.slug,
        assignProductIds,
        removeProductIds,
      })
      toast({
        title: `Đã cập nhật sản phẩm cho "${assignCatModal.name}"`,
        description: `Hiện có ${nextSelected.size} sản phẩm trong danh mục này.`,
      })
      setAssignCatModal(null)
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể gán sản phẩm vào danh mục',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSavingAssign(false)
    }
  }

  // ===== Handlers Loại SP & Quy đổi ĐVT =====
  const selectProductForConversion = (productId: string) => {
    setConvProductId(productId)
    const p = products.find((item) => item.id === productId)
    const uc = p?.unitConfig ?? unitConfigs[productId]
    if (uc) {
      setConvType(p?.type && p.type !== 'SIMPLE' ? p.type : 'WEIGHT_BULK')
      setConvBaseUnit(uc.baseUnit || p?.unit || 'gr')
      setConvPurchaseUnit(uc.purchaseUnit || 'kg')
      setConvPurchaseRate(String(uc.purchaseRate || 1000))
      setConvSellUnit(uc.sellUnit || 'kg (1.000gr)')
      setConvSellRate(String(uc.sellRate || 1000))
      setConvLinkedBaseId(uc.linkedBaseProductId || 'NONE')
      setConvScaleCurrentStock(false)
    } else if (p) {
      setConvType(p.type === 'SIMPLE' ? 'WEIGHT_BULK' : (p.type || 'WEIGHT_BULK'))
      setConvBaseUnit('gr')
      setConvPurchaseUnit('kg')
      setConvPurchaseRate('1000')
      setConvSellUnit('kg (1.000gr)')
      setConvSellRate('1000')
      setConvLinkedBaseId('NONE')
      setConvScaleCurrentStock(p.stock > 0 && p.stock < 500 && p.unit !== 'gr')
    }
  }

  const handleSaveUnitConversion = async () => {
    if (!convProductId) {
      toast({ title: 'Vui lòng chọn sản phẩm cần thiết lập quy đổi định lượng', variant: 'destructive' })
      return
    }
    setSavingConv(true)
    try {
      await apiPost('/api/unit-conversions', {
        action: 'save_unit_config',
        productId: convProductId,
        productType: convType,
        baseUnit: convBaseUnit.trim() || 'gr',
        purchaseUnit: convPurchaseUnit.trim() || 'kg',
        purchaseRate: Math.max(1, Number(convPurchaseRate) || 1),
        sellUnit: convSellUnit.trim() || convBaseUnit.trim() || 'gr',
        sellRate: Math.max(1, Number(convSellRate) || 1),
        linkedBaseProductId: convLinkedBaseId === 'NONE' ? null : convLinkedBaseId,
        convertCurrentStock: convScaleCurrentStock,
      })
      toast({
        title: 'Đã lưu cấu hình quy đổi định lượng',
        description: `Nhập: 1 ${convPurchaseUnit} = ${formatNumber(Number(convPurchaseRate) || 1)} ${convBaseUnit} · Bán: 1 ${convSellUnit} = trừ ${formatNumber(Number(convSellRate) || 1)} ${convBaseUnit}`,
      })
      setConvScaleCurrentStock(false)
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể lưu quy đổi định lượng',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSavingConv(false)
    }
  }

  const handleQuickConvertedImport = async () => {
    if (!quickImportProd) return
    const qty = Number(quickImportQty)
    if (!qty || qty <= 0) {
      toast({ title: 'Vui lòng nhập số lượng lớn hơn 0', variant: 'destructive' })
      return
    }
    const uc = quickImportProd.unitConfig ?? unitConfigs[quickImportProd.id]
    const rate = uc?.purchaseRate || 1000
    const pUnit = uc?.purchaseUnit || 'kg'
    const bUnit = uc?.baseUnit || quickImportProd.unit || 'gr'
    setQuickImportSaving(true)
    try {
      await apiPost('/api/inventory', {
        productId: quickImportProd.id,
        type: 'IMPORT',
        quantity: qty,
        conversionRate: rate,
        inputUnit: pUnit,
        note: `Nhập kho quy đổi định lượng (${qty} ${pUnit} = +${formatNumber(Math.round(qty * rate))} ${bUnit})`,
      })
      toast({
        title: `Đã nhập ${qty} ${pUnit} → +${formatNumber(Math.round(qty * rate))} ${bUnit}`,
        description: `${quickImportProd.name} đã được cộng tồn kho và đồng bộ toàn hệ thống.`,
      })
      setQuickImportProd(null)
      await loadAll()
    } catch (err) {
      toast({
        title: 'Nhập kho quy đổi thất bại',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setQuickImportSaving(false)
    }
  }

  const handleCreateProductType = async () => {
    if (!newTypeCode.trim() || !newTypeName.trim()) {
      toast({ title: 'Vui lòng nhập Mã loại và Tên loại sản phẩm', variant: 'destructive' })
      return
    }
    setSavingNewType(true)
    try {
      await apiPost('/api/unit-conversions', {
        action: 'save_product_type',
        code: newTypeCode.trim().toUpperCase(),
        name: newTypeName.trim(),
        description: newTypeDesc.trim(),
        badgeColor: 'emerald',
        supportsConversion: true,
      })
      toast({
        title: 'Đã thêm loại sản phẩm mới',
        description: `${newTypeName.trim()} (${newTypeCode.trim().toUpperCase()})`,
      })
      setNewTypeCode('')
      setNewTypeName('')
      setNewTypeDesc('')
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể thêm loại sản phẩm',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSavingNewType(false)
    }
  }

  const handleDeleteProductType = async (code: string) => {
    try {
      await apiPost('/api/unit-conversions', { action: 'delete_product_type', code })
      toast({ title: 'Đã xóa loại sản phẩm tùy chỉnh', description: code })
      await loadAll()
    } catch (err) {
      toast({ title: 'Không thể xóa loại sản phẩm', description: errorMessage(err), variant: 'destructive' })
    }
  }

  const handleSaveProductAttr = async (productId: string) => {
    const draft = attrDrafts[productId]
    if (!draft) return
    setSavingAttrId(productId)
    try {
      await apiPatch('/api/product-attributes', {
        id: productId,
        unit: draft.unit.trim() || 'cái',
        attributes: draft.attributes.trim() || null,
      })
      toast({ title: 'Đã lưu đơn vị tính & đặc tính sản phẩm' })
      await loadAll()
    } catch (err) {
      toast({
        title: 'Không thể lưu đặc tính sản phẩm',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSavingAttrId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Thanh chuyển đổi nhanh giữa 3 phân mục Cấu hình Danh mục & Hàng hóa */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-xs">
        <button
          type="button"
          onClick={() => onSubTabChange?.('CATEGORIES')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all',
            activeSubTab === 'CATEGORIES'
              ? 'bg-[#0066CC] text-white shadow-xs'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <FolderKanban className="h-4 w-4" />
          <span>Thiết lập Danh mục Sản phẩm</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              activeSubTab === 'CATEGORIES' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            )}
          >
            {categories.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSubTabChange?.('UNIT_CONVERSION')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all',
            activeSubTab === 'UNIT_CONVERSION'
              ? 'bg-[#0066CC] text-white shadow-xs'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Scale className="h-4 w-4" />
          <span>Loại Sản phẩm &amp; Quy đổi Định lượng (Kg ⇄ Gr)</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              activeSubTab === 'UNIT_CONVERSION' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            )}
          >
            {convertedProductsCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onSubTabChange?.('ATTRIBUTES')}
          className={cn(
            'flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition-all',
            activeSubTab === 'ATTRIBUTES'
              ? 'bg-[#0066CC] text-white shadow-xs'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span>Đơn vị tính &amp; Đặc tính Quy cách</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
              activeSubTab === 'ATTRIBUTES' ? 'bg-white/20 text-white' : 'bg-muted text-foreground'
            )}
          >
            {products.length}
          </span>
        </button>
      </div>

      {activeSubTab === 'CATEGORIES' && (
        <div className="space-y-5">
          {/* Thẻ chỉ số tổng quan Danh mục */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Tổng số Danh mục</p>
                <FolderKanban className="h-4 w-4 text-[#0066CC]" />
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{categories.length}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Đồng bộ tự động với POS, Storefront &amp; Báo cáo</p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Sản phẩm đã phân loại</p>
                <Tags className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {products.length - uncategorizedProducts.length} / {products.length}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Chiếm{' '}
                {products.length > 0
                  ? Math.round(((products.length - uncategorizedProducts.length) / products.length) * 100)
                  : 100}
                % tổng danh mục hàng hóa
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Sản phẩm chưa phân loại</p>
                <Layers className="h-4 w-4 text-amber-500" />
              </div>
              <div className="mt-1.5 flex items-baseline justify-between gap-2">
                <p className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {uncategorizedProducts.length}
                </p>
                {uncategorizedProducts.length > 0 && categories.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => openAssignProductsModal(categories[0], true)}
                  >
                    Phân loại nhanh
                  </Button>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {uncategorizedProducts.length === 0
                  ? '100% sản phẩm đã có danh mục rõ ràng'
                  : 'Bấm "Gán SP" ở bất kỳ danh mục nào bên dưới để phân nhóm'}
              </p>
            </div>
          </div>

          {/* Khung Tạo Danh mục mới + Gợi ý 1 chạm */}
          <div className="rounded-xl border bg-card p-4 shadow-xs sm:p-5">
            <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <FolderPlus className="h-4 w-4 text-[#0066CC]" />
                  Tạo Danh mục Sản phẩm mới
                </h3>
                <p className="text-xs text-muted-foreground">
                  Nhập tên danh mục (đường dẫn slug tự sinh chuẩn tiếng Việt) hoặc chọn nhanh từ bộ gợi ý ngành hàng.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
              <div className="sm:col-span-5">
                <Label htmlFor="new-cat-name" className="text-xs">
                  Tên danh mục <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="new-cat-name"
                  value={newCatName}
                  onChange={(e) => {
                    const val = e.target.value
                    setNewCatName(val)
                    if (!newCatSlugTouched) {
                      setNewCatSlug(clientSlugify(val))
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      void handleCreateCategory()
                    }
                  }}
                  placeholder="VD: Trầm hương & Nhang sạch"
                  className="mt-1"
                />
              </div>
              <div className="sm:col-span-4">
                <Label htmlFor="new-cat-slug" className="text-xs">
                  Mã đường dẫn (Slug)
                </Label>
                <Input
                  id="new-cat-slug"
                  value={newCatSlug}
                  onChange={(e) => {
                    setNewCatSlugTouched(true)
                    setNewCatSlug(e.target.value)
                  }}
                  placeholder="tram-huong-nhang-sach"
                  className="mt-1 font-mono text-xs"
                />
              </div>
              <div className="flex items-end sm:col-span-3">
                <Button
                  className="w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                  disabled={creatingCat || !newCatName.trim()}
                  onClick={() => void handleCreateCategory()}
                >
                  {creatingCat ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 h-4 w-4" />
                  )}
                  Thêm danh mục
                </Button>
              </div>
            </div>

            {(() => {
              const existingNames = new Set(categories.map((c) => c.name.toLowerCase()))
              const availablePresets = PRESET_CATEGORIES.filter((p) => !existingNames.has(p.toLowerCase()))
              if (availablePresets.length === 0) return null
              return (
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t pt-3">
                  <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Danh mục gợi ý:
                  </span>
                  {availablePresets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={creatingCat}
                      onClick={() => void handleCreateCategory(preset)}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-emerald-500/50 bg-emerald-50/60 px-2.5 py-1 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                    >
                      <Plus className="h-3 w-3" />
                      {preset}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Bảng Danh sách Danh mục & Công cụ Gán / Sửa / Xóa */}
          <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
            <Table className="min-w-[780px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Tên danh mục</TableHead>
                  <TableHead>Mã đường dẫn (Slug)</TableHead>
                  <TableHead>Số sản phẩm</TableHead>
                  <TableHead>Sản phẩm tiêu biểu</TableHead>
                  <TableHead className="text-right">Tổng tồn kho</TableHead>
                  <TableHead className="text-right">Giá trị tồn</TableHead>
                  <TableHead className="text-right">Thao tác quản trị</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((cat) => {
                  const st = categoryStatsMap.get(cat.id) ?? {
                    count: 0,
                    activeCount: 0,
                    totalStock: 0,
                    totalStockValue: 0,
                    sampleNames: [],
                  }
                  const isInlineEditing = editingCat?.id === cat.id
                  return (
                    <TableRow key={cat.id}>
                      <TableCell>
                        {isInlineEditing ? (
                          <Input
                            value={editCatName}
                            onChange={(e) => {
                              setEditCatName(e.target.value)
                              setEditCatSlug(clientSlugify(e.target.value))
                            }}
                            className="h-8 min-w-[180px]"
                            autoFocus
                          />
                        ) : (
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0066CC]/10 text-[#0066CC] dark:bg-sky-400/15 dark:text-sky-300">
                              <FolderKanban className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{cat.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {st.activeCount}/{st.count} SP đang giao dịch
                              </p>
                            </div>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {isInlineEditing ? (
                          <Input
                            value={editCatSlug}
                            onChange={(e) => setEditCatSlug(e.target.value)}
                            className="h-8 min-w-[150px] font-mono text-xs"
                          />
                        ) : (
                          <Badge variant="secondary" className="font-mono text-xs font-normal">
                            /{cat.slug}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'font-semibold tabular-nums',
                            st.count > 0
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'text-muted-foreground'
                          )}
                        >
                          {st.count} sản phẩm
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        {st.sampleNames.length > 0 ? (
                          <p className="truncate text-xs text-muted-foreground" title={st.sampleNames.join(', ')}>
                            {st.sampleNames.join(', ')}
                            {st.count > st.sampleNames.length ? ` (+${st.count - st.sampleNames.length})` : ''}
                          </p>
                        ) : (
                          <span className="text-xs italic text-muted-foreground">Chưa gắn sản phẩm</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatNumber(st.totalStock)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-foreground">
                        {formatVND(st.totalStockValue)}
                      </TableCell>
                      <TableCell className="text-right">
                        {isInlineEditing ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              className="h-8 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
                              disabled={savingCat}
                              onClick={() => void handleSaveEditCategory()}
                            >
                              {savingCat ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="mr-1 h-3.5 w-3.5" />
                              )}
                              Lưu
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-xs"
                              disabled={savingCat}
                              onClick={() => setEditingCat(null)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 border-[#0066CC]/30 px-2.5 text-xs text-[#0066CC] hover:bg-[#0066CC]/5 dark:text-sky-400"
                              onClick={() => openAssignProductsModal(cat)}
                            >
                              <Plus className="mr-1 h-3.5 w-3.5" />
                              Gán SP ({st.count})
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={() => openEditCategory(cat)}
                              title="Đổi tên / mã slug danh mục"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => {
                                setDeletingCat(cat)
                                setReassignCatId('NONE')
                              }}
                              title="Xóa danh mục"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {activeSubTab === 'UNIT_CONVERSION' && (
        <div className="space-y-5">
          {/* 3 Thẻ chỉ số tổng quan Quản lý Loại SP & Quy đổi Định lượng */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Danh mục Loại sản phẩm</p>
                <Boxes className="h-4 w-4 text-[#0066CC]" />
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums">{productTypes.length} loại</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Thành phẩm, Định lượng Kg⇄Gr, Đóng gói đồng bộ, Nguyên vật liệu, Combo...
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">SP áp dụng Quy đổi Định lượng</p>
                <Scale className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {convertedProductsCount} sản phẩm
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Tự động nhân hệ số khi nhập kho (VD: 10 kg = +10.000 gr) &amp; trừ đồng bộ khi bán
              </p>
            </div>
            <div className="rounded-xl border bg-card p-4 shadow-xs">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Cơ chế Đồng bộ Tồn kho</p>
                <ArrowRightLeft className="h-4 w-4 text-amber-500" />
              </div>
              <p className="mt-1.5 text-base font-bold text-foreground">
                Nhập Chẵn (Kg/Lít/Thùng) ⇄ Kho Lẻ (Gr/Ml)
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Khi bán POS / Đơn hàng hoặc sản xuất BOM sẽ tự động quy đổi &amp; trừ thẳng vào tồn gốc
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Cột trái: Quản lý Loại sản phẩm (5 cột) */}
            <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5 lg:col-span-5">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Boxes className="h-4 w-4 text-[#0066CC]" />
                  1. Quản lý Loại Sản phẩm (Product Types)
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Phân loại bản chất hàng hóa để hệ thống tự áp dụng quy tắc quản lý kho &amp; định lượng.
                </p>
              </div>

              <div className="divide-y rounded-lg border">
                {productTypes.map((pt) => {
                  const countByType = products.filter((p) => (p.type || 'SIMPLE') === pt.code).length
                  const badgeStyle =
                    PRODUCT_TYPE_BADGES[pt.code]?.className ??
                    'border-emerald-300 bg-emerald-50 text-emerald-700'
                  return (
                    <div key={pt.code} className="flex items-start justify-between gap-2 p-3 text-xs">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn('text-[10px] font-semibold', badgeStyle)}>
                            {pt.name}
                          </Badge>
                          <span className="font-mono text-[10px] text-muted-foreground">{pt.code}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {countByType} SP
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">{pt.description}</p>
                      </div>
                      {!pt.isSystem && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0 text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => void handleDeleteProductType(pt.code)}
                          title="Xóa loại sản phẩm tùy chỉnh"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Thêm loại sản phẩm tùy chỉnh */}
              <div className="space-y-2.5 rounded-lg border border-dashed bg-muted/20 p-3">
                <p className="text-xs font-semibold text-foreground">Thêm Loại Sản phẩm tùy chỉnh</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={newTypeCode}
                    onChange={(e) => setNewTypeCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    placeholder="Mã (VD: LIQUID_OIL)"
                    className="h-8 font-mono text-xs"
                  />
                  <Input
                    value={newTypeName}
                    onChange={(e) => setNewTypeName(e.target.value)}
                    placeholder="Tên loại (VD: Tinh dầu chiết ml)"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newTypeDesc}
                    onChange={(e) => setNewTypeDesc(e.target.value)}
                    placeholder="Mô tả quy tắc nhập / xuất..."
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0 bg-[#0066CC] px-3 text-xs text-white hover:bg-[#0055B3]"
                    disabled={savingNewType || !newTypeCode.trim() || !newTypeName.trim()}
                    onClick={() => void handleCreateProductType()}
                  >
                    {savingNewType ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="mr-1 h-3.5 w-3.5" />
                    )}
                    Thêm loại
                  </Button>
                </div>
              </div>
            </div>

            {/* Cột phải: Thiết lập Quy đổi Định lượng cho Sản phẩm (7 cột) */}
            <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5 lg:col-span-7">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                  <Scale className="h-4 w-4 text-emerald-600" />
                  2. Thiết lập Quy đổi Định lượng (Nhập Kho ⇄ Tồn Gốc ⇄ Xuất Bán)
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Ví dụ: Khi nhập kho <strong>10 kg</strong> tự động quy đổi ra <strong>+10.000 gr</strong> (1 kg = 1.000 gr); khi bán lẻ 100gr / 500gr / 1kg tự trừ đồng bộ vào kho gram.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-emerald-50/60 p-2.5 dark:bg-emerald-950/20">
                <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  Mẫu quy đổi chuẩn:
                </span>
                {[
                  {
                    label: '1 Kg = 1.000 Gr (Nhập Kg, Bán Kg/Gr)',
                    base: 'gr',
                    pUnit: 'kg',
                    pRate: '1000',
                    sUnit: 'kg (1.000gr)',
                    sRate: '1000',
                    type: 'WEIGHT_BULK',
                  },
                  {
                    label: 'Nhập Kg → Bán Gói 500gr',
                    base: 'gr',
                    pUnit: 'kg',
                    pRate: '1000',
                    sUnit: 'gói 500gr',
                    sRate: '500',
                    type: 'WEIGHT_BULK',
                  },
                  {
                    label: 'Nhập Kg → Bán Hộp 200gr',
                    base: 'gr',
                    pUnit: 'kg',
                    pRate: '1000',
                    sUnit: 'hộp 200gr',
                    sRate: '200',
                    type: 'WEIGHT_BULK',
                  },
                  {
                    label: '1 Lít = 1.000 Ml (Tinh dầu)',
                    base: 'ml',
                    pUnit: 'lít',
                    pRate: '1000',
                    sUnit: 'chai 100ml',
                    sRate: '100',
                    type: 'MATERIAL',
                  },
                  {
                    label: '1 Thùng = 24 Cái',
                    base: 'cái',
                    pUnit: 'thùng',
                    pRate: '24',
                    sUnit: 'cái',
                    sRate: '1',
                    type: 'SIMPLE',
                  },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setConvBaseUnit(preset.base)
                      setConvPurchaseUnit(preset.pUnit)
                      setConvPurchaseRate(preset.pRate)
                      setConvSellUnit(preset.sUnit)
                      setConvSellRate(preset.sRate)
                      setConvType(preset.type)
                    }}
                    className="rounded-full border border-emerald-300 bg-background px-2.5 py-1 text-[11px] font-medium text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-900/40"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Chọn sản phẩm cần thiết lập quy đổi</Label>
                  <Select value={convProductId} onValueChange={selectProductForConversion}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="— Chọn sản phẩm hoặc nguyên liệu —" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          [{p.sku}] {p.name} (Tồn: {formatNumber(p.stock)} {p.unit || 'cái'})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Loại sản phẩm áp dụng</Label>
                  <Select value={convType} onValueChange={setConvType}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn loại sản phẩm" />
                    </SelectTrigger>
                    <SelectContent>
                      {productTypes.map((pt) => (
                        <SelectItem key={pt.code} value={pt.code}>
                          {pt.name} ({pt.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Đơn vị tồn kho gốc (Nhỏ nhất)</Label>
                  <Input
                    value={convBaseUnit}
                    onChange={(e) => setConvBaseUnit(e.target.value)}
                    placeholder="VD: gr, ml, cái..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Đơn vị Nhập kho</Label>
                    <Input
                      value={convPurchaseUnit}
                      onChange={(e) => setConvPurchaseUnit(e.target.value)}
                      placeholder="VD: kg, thùng..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Hệ số quy đổi Nhập</Label>
                    <Input
                      type="number"
                      min={1}
                      value={convPurchaseRate}
                      onChange={(e) => setConvPurchaseRate(e.target.value)}
                      placeholder="VD: 1000"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Đơn vị Xuất bán mặc định</Label>
                    <Input
                      value={convSellUnit}
                      onChange={(e) => setConvSellUnit(e.target.value)}
                      placeholder="VD: gói 200gr, kg..."
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Định lượng trừ kho / 1 ĐV bán</Label>
                    <Input
                      type="number"
                      min={1}
                      value={convSellRate}
                      onChange={(e) => setConvSellRate(e.target.value)}
                      placeholder="VD: 1000 hoặc 200"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Liên kết trừ thẳng vào Kho SP Gốc (Tùy chọn)</Label>
                  <Select value={convLinkedBaseId} onValueChange={setConvLinkedBaseId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="— Trừ trực tiếp trên chính SP này —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">— Trừ trực tiếp trên chính SP này —</SelectItem>
                      {products
                        .filter((p) => p.id !== convProductId)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            Trừ vào kho: [{p.sku}] {p.name} ({formatNumber(p.stock)} {p.unit})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {convProductId && (
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex cursor-pointer items-center gap-2 text-xs">
                    <Checkbox
                      checked={convScaleCurrentStock}
                      onCheckedChange={(c) => setConvScaleCurrentStock(c === true)}
                    />
                    <span>
                      Nhân luôn tồn kho hiện tại với <strong>×{formatNumber(Number(convPurchaseRate) || 1)}</strong> (chuyển tồn từ {convPurchaseUnit} sang {convBaseUnit})
                    </span>
                  </label>
                  <Button
                    className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                    disabled={savingConv || !convProductId}
                    onClick={() => void handleSaveUnitConversion()}
                  >
                    {savingConv ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                    Lưu cấu hình Quy đổi Định lượng
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Bảng danh sách SP áp dụng quy đổi */}
          <div className="rounded-xl border bg-card shadow-xs">
            <div className="border-b p-4">
              <h3 className="text-sm font-bold text-foreground">
                Danh sách Sản phẩm &amp; Nguyên vật liệu đang áp dụng Quy đổi Định lượng
              </h3>
              <p className="text-xs text-muted-foreground">
                Bấm <strong>&ldquo;Nhập kho (kg → gr)&rdquo;</strong> để kiểm nghiệm quy đổi tự động (VD: nhập 10 kg = +10.000 gr).
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sản phẩm / SKU</TableHead>
                    <TableHead>Loại SP</TableHead>
                    <TableHead>Công thức Quy đổi Nhập kho</TableHead>
                    <TableHead>Quy tắc Xuất bán / POS</TableHead>
                    <TableHead className="text-right">Tồn kho Đồng bộ</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products
                    .filter((p) => {
                      const uc = p.unitConfig ?? unitConfigs[p.id]
                      return (
                        (uc && (uc.purchaseRate > 1 || uc.sellRate > 1 || uc.linkedBaseProductId)) ||
                        p.type === 'WEIGHT_BULK' ||
                        p.type === 'PACKAGED_VARIANT' ||
                        p.type === 'MATERIAL'
                      )
                    })
                    .map((p) => {
                      const uc = p.unitConfig ?? unitConfigs[p.id]
                      const bUnit = uc?.baseUnit || p.unit || 'gr'
                      const pUnit = uc?.purchaseUnit || 'kg'
                      const pRate = uc?.purchaseRate || 1
                      const sUnit = uc?.sellUnit || bUnit
                      const sRate = uc?.sellRate || 1
                      const badge = PRODUCT_TYPE_BADGES[p.type ?? 'SIMPLE'] ?? PRODUCT_TYPE_BADGES.SIMPLE
                      const approxPurchase = pRate > 1 ? (p.stock / pRate).toFixed(p.stock % pRate === 0 ? 0 : 2) : null
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <ProductAvatar name={p.name} image={p.image} className="h-9 w-9" />
                              <div>
                                <p className="font-semibold text-foreground">{p.name}</p>
                                <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn('text-xs font-semibold', badge.className)}>
                              {badge.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-emerald-300 bg-emerald-50 font-mono text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            >
                              1 {pUnit} = {formatNumber(pRate)} {bUnit}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-foreground">
                              1 {sUnit} = trừ {formatNumber(sRate)} {bUnit}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <p className="font-bold tabular-nums text-foreground">
                              {formatNumber(p.stock)} {bUnit}
                            </p>
                            {approxPurchase && (
                              <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                ≈ {approxPurchase} {pUnit}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                className="h-8 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
                                onClick={() => {
                                  setQuickImportProd(p)
                                  setQuickImportQty('10')
                                }}
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />
                                Nhập kho ({pUnit} → {bUnit})
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2.5 text-xs"
                                onClick={() => selectProductForConversion(p.id)}
                              >
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                Sửa quy đổi
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'ATTRIBUTES' && (
        <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">
                Thiết lập Đơn vị tính Gốc &amp; Đặc tính Quy cách Hàng hóa
              </h3>
              <p className="text-xs text-muted-foreground">
                Chuẩn hóa đơn vị tính (`gr`, `kg`, `hộp`, `bộ`, `cái`) và thuộc tính mô tả quy cách in trên hóa đơn &amp; tem nhãn.
              </p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={attrSearch}
                onChange={(e) => setAttrSearch(e.target.value)}
                placeholder="Tìm theo tên hoặc SKU..."
                className="pl-8 text-xs"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm / SKU</TableHead>
                  <TableHead className="w-36">Đơn vị tính gốc</TableHead>
                  <TableHead>Đặc tính / Quy cách (Mùi hương, Trọng lượng, Chất liệu...)</TableHead>
                  <TableHead className="w-28 text-right">Lưu</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products
                  .filter((p) => {
                    const q = attrSearch.trim().toLowerCase()
                    if (!q) return true
                    return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
                  })
                  .map((p) => {
                    const draft = attrDrafts[p.id] ?? {
                      unit: p.unit || 'cái',
                      attributes: formatAttributesReadable(p.attributes).text,
                    }
                    return (
                      <TableRow key={p.id}>
                        <TableCell>
                          <p className="font-medium text-foreground">{p.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.unit}
                            onChange={(e) =>
                              setAttrDrafts((prev) => ({
                                ...prev,
                                [p.id]: { ...draft, unit: e.target.value },
                              }))
                            }
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={draft.attributes}
                            onChange={(e) =>
                              setAttrDrafts((prev) => ({
                                ...prev,
                                [p.id]: { ...draft, attributes: e.target.value },
                              }))
                            }
                            placeholder="VD: Hương trầm tự nhiên · Hộp 60 nụ · Cháy 25 phút"
                            className="h-8 text-xs"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 text-xs"
                            disabled={savingAttrId === p.id}
                            onClick={() => void handleSaveProductAttr(p.id)}
                          >
                            {savingAttrId === p.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="mr-1 h-3.5 w-3.5" />
                            )}
                            Lưu
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Dialog Xác nhận xóa Danh mục */}
      <Dialog
        open={deletingCat !== null}
        onOpenChange={(open) => {
          if (!open && !deletingCatLoading) {
            setDeletingCat(null)
            setReassignCatId('NONE')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xóa danh mục &ldquo;{deletingCat?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Các sản phẩm thuộc danh mục này sẽ không bị xóa. Bạn có thể chuyển chúng sang một danh mục khác hoặc để về trạng thái &ldquo;Không phân loại&rdquo;.
            </DialogDescription>
          </DialogHeader>
          {deletingCat && (categoryStatsMap.get(deletingCat.id)?.count ?? 0) > 0 && (
            <div className="space-y-2 py-2">
              <Label>
                Chuyển {categoryStatsMap.get(deletingCat.id)?.count} sản phẩm đang thuộc danh mục này sang:
              </Label>
              <Select value={reassignCatId} onValueChange={setReassignCatId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn danh mục đích" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Để về Không phân loại —</SelectItem>
                  {categories
                    .filter((c) => c.id !== deletingCat.id)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        Chuyển sang: {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={deletingCatLoading} onClick={() => setDeletingCat(null)}>
              Hủy
            </Button>
            <Button variant="destructive" disabled={deletingCatLoading} onClick={() => void handleDeleteCategory()}>
              {deletingCatLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Xác nhận xóa danh mục
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Gán Sản phẩm hàng loạt vào Danh mục */}
      <Dialog
        open={assignCatModal !== null}
        onOpenChange={(open) => {
          if (!open && !savingAssign) setAssignCatModal(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Gán sản phẩm vào danh mục &ldquo;{assignCatModal?.name}&rdquo;</DialogTitle>
            <DialogDescription>
              Đánh dấu các sản phẩm thuộc danh mục này. Bỏ đánh dấu để gỡ sản phẩm khỏi danh mục.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={assignSearch}
                  onChange={(e) => setAssignSearch(e.target.value)}
                  placeholder="Tìm sản phẩm theo tên hoặc SKU..."
                  className="pl-8"
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant={assignOnlyUncategorized ? 'default' : 'outline'}
                className="h-9 text-xs"
                onClick={() => setAssignOnlyUncategorized((prev) => !prev)}
              >
                Chỉ hiện SP chưa phân loại ({uncategorizedProducts.length})
              </Button>
            </div>
            <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
              {products
                .filter((p) => {
                  if (assignOnlyUncategorized && p.categoryId && p.categoryId !== assignCatModal?.id) return false
                  const q = assignSearch.trim().toLowerCase()
                  if (!q) return true
                  return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
                })
                .map((p) => {
                  const checked = selectedAssignProductIds.includes(p.id)
                  return (
                    <label
                      key={p.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50',
                        checked && 'bg-[#0066CC]/5'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(c) => {
                            setSelectedAssignProductIds((prev) =>
                              c === true ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                            )
                          }}
                        />
                        <ProductAvatar name={p.name} image={p.image} className="h-8 w-8 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{p.name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {p.sku} · {formatVND(p.sellPrice)}
                          </p>
                        </div>
                      </div>
                    </label>
                  )
                })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={savingAssign} onClick={() => setAssignCatModal(null)}>
              Hủy
            </Button>
            <Button
              className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
              disabled={savingAssign}
              onClick={() => void handleSaveAssignProducts()}
            >
              {savingAssign && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu danh sách ({selectedAssignProductIds.length} SP)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Nhập kho Quy đổi Định lượng 1 chạm */}
      <Dialog
        open={quickImportProd !== null}
        onOpenChange={(open) => {
          if (!open && !quickImportSaving) setQuickImportProd(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-emerald-600" />
              Nhập kho Quy đổi Định lượng
            </DialogTitle>
            <DialogDescription>
              Nhập số lượng theo đơn vị chẵn — hệ thống tự động nhân hệ số quy đổi và cộng vào tồn kho gốc.
            </DialogDescription>
          </DialogHeader>
          {quickImportProd &&
            (() => {
              const uc = quickImportProd.unitConfig ?? unitConfigs[quickImportProd.id]
              const bUnit = uc?.baseUnit || quickImportProd.unit || 'gr'
              const pUnit = uc?.purchaseUnit || 'kg'
              const pRate = uc?.purchaseRate || 1000
              const qtyNum = Math.max(0, Number(quickImportQty) || 0)
              const convertedAdd = Math.round(qtyNum * pRate)
              return (
                <div className="space-y-4 py-2">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="font-semibold text-foreground">{quickImportProd.name}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                      {quickImportProd.sku} · Tồn hiện tại:{' '}
                      <strong className="text-foreground">
                        {formatNumber(quickImportProd.stock)} {bUnit}
                      </strong>
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sys-quick-import-qty">
                      Số lượng nhập ({pUnit}) <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="sys-quick-import-qty"
                      type="number"
                      min={0.1}
                      step="any"
                      value={quickImportQty}
                      onChange={(e) => setQuickImportQty(e.target.value)}
                      className="text-base font-bold tabular-nums"
                    />
                  </div>
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <p className="text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                      Kết quả quy đổi tự động
                    </p>
                    <p className="mt-1 text-lg font-extrabold tabular-nums">
                      {qtyNum} {pUnit} × {formatNumber(pRate)} = +{formatNumber(convertedAdd)} {bUnit}
                    </p>
                  </div>
                </div>
              )
            })()}
          <DialogFooter>
            <Button variant="outline" disabled={quickImportSaving} onClick={() => setQuickImportProd(null)}>
              Hủy
            </Button>
            <Button
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={quickImportSaving}
              onClick={() => void handleQuickConvertedImport()}
            >
              {quickImportSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Xác nhận nhập kho quy đổi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading && <div className="sr-only">Đang tải...</div>}
    </div>
  )
}
