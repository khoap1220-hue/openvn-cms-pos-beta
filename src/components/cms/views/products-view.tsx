'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRightLeft,
  Barcode,
  Boxes,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderKanban,
  FolderPlus,
  Layers,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Scale,
  Search,
  Sparkles,
  Tags,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import type { Category, Channel, Product, ProductListing, ProductTypeInfo, ProductUnitConfig } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

import { ChannelBadge } from '@/components/cms/channel-badge'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { LabelPrintDialog, type BarcodeProduct } from '@/components/cms/label-print-dialog'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { ProductStatusBadge } from '@/components/cms/status-badge'

const PAGE_SIZE = 20

const PRESET_CATEGORIES = [
  'Trầm hương & Nhang sạch',
  'Trà đạo & Ấm tử sa',
  'Thạch cao & Nến thơm',
  'Gốm sứ & Đồ thờ',
  'Combo & Quà tặng Tâm An',
  'Phụ kiện Thiền & Yoga',
]

function clientSlugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/** Product của lib/types chưa có barcode — mở rộng cục bộ cho đến khi lib cập nhật */
type ProductRow = Product & { barcode?: string | null }

interface ProductFormState {
  type: string
  sku: string
  name: string
  description: string
  categoryId: string
  barcode: string
  image: string
  costPrice: string
  sellPrice: string
  stock: string
  lowStockThreshold: string
  status: string
  listingChannelIds: string[]
  /** Giá bán riêng từng kênh (string thô từ input — rỗng = null = theo giá bán chung) */
  channelPrices: Record<string, string>
  /** Cấu hình đơn vị tính & quy đổi định lượng (VD: Nhập kg -> Kho gr -> Bán gói/kg) */
  baseUnit: string
  purchaseUnit: string
  purchaseRate: string
  sellUnit: string
  sellRate: string
  linkedBaseProductId: string
  convertInitialStock: boolean
}

const EMPTY_FORM: ProductFormState = {
  type: 'SIMPLE',
  sku: '',
  name: '',
  description: '',
  categoryId: 'NONE',
  barcode: '',
  image: '',
  costPrice: '',
  sellPrice: '',
  stock: '0',
  lowStockThreshold: '10',
  status: 'ACTIVE',
  listingChannelIds: [],
  channelPrices: {},
  baseUnit: 'cái',
  purchaseUnit: 'cái',
  purchaseRate: '1',
  sellUnit: 'cái',
  sellRate: '1',
  linkedBaseProductId: 'NONE',
  convertInitialStock: true,
}

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

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

/** Badge nhỏ đánh dấu sản phẩm Combo/Set quà tặng */
function ComboBadge() {
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-violet-300 text-[10px] font-medium text-violet-600 dark:border-violet-800 dark:text-violet-400"
    >
      Combo
    </Badge>
  )
}

/** Response POST /api/products/[id]/sync-description */
interface SyncDescriptionResponse {
  synced: number
  channels: Array<{ channelId: string; key: string; name: string; syncedAt: string }>
}

/**
 * Trạng thái đồng bộ mô tả của một kênh (chỉ dùng trong form sửa sản phẩm):
 * - chưa từng sync → "Chưa đồng bộ"
 * - đã sync nhưng bản kênh ≠ mô tả master → badge amber "Chưa cập nhật"
 */
function ChannelDescStatus({ listing, master }: { listing: ProductListing; master: string | null }) {
  if (!listing.descriptionSyncedAt) {
    return <p className="pl-7 pt-0.5 text-xs text-muted-foreground">Chưa đồng bộ mô tả</p>
  }
  const outdated = (listing.description ?? null) !== master
  return (
    <p className="flex flex-wrap items-center gap-1.5 pl-7 pt-0.5 text-xs text-muted-foreground">
      Đã đồng bộ {formatDateTime(listing.descriptionSyncedAt)}
      {outdated && (
        <Badge
          variant="outline"
          className="h-4 border-amber-300 bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400"
        >
          Chưa cập nhật
        </Badge>
      )}
    </p>
  )
}

export function ProductsView({
  onOpenSystemCatalog,
}: {
  onOpenSystemCatalog?: (subTab: 'CATEGORIES' | 'UNIT_CONVERSION' | 'ATTRIBUTES') => void
} = {}) {
  const { toast } = useToast()

  // ===== Danh sách sản phẩm + bộ lọc =====
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [quickTab, setQuickTab] = useState<
    'ALL' | 'ACTIVE' | 'LOW_STOCK' | 'COMBO' | 'INACTIVE' | 'CATEGORIES' | 'UNIT_CONVERSION'
  >('ALL')
  const [page, setPage] = useState(1)

  // ===== Meta data =====
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [productTypes, setProductTypes] = useState<ProductTypeInfo[]>([])
  const [unitConfigs, setUnitConfigs] = useState<Record<string, ProductUnitConfig>>({})

  // ===== Thiết lập Loại sản phẩm & Quy đổi Định lượng (Kg ⇄ Gram) =====
  const [convProductId, setConvProductId] = useState('')
  const [convType, setConvType] = useState('WEIGHT_BULK')
  const [convBaseUnit, setConvBaseUnit] = useState('gr')
  const [convPurchaseUnit, setConvPurchaseUnit] = useState('kg')
  const [convPurchaseRate, setConvPurchaseRate] = useState('1000')
  const [convSellUnit, setConvSellUnit] = useState('kg (1.000gr)')
  const [convSellRate, setConvSellRate] = useState('1000')
  const [convLinkedBaseId, setConvLinkedBaseId] = useState('NONE')
  const [convScaleCurrentStock, setConvScaleCurrentStock] = useState(false)
  const [savingConv, setSavingConv] = useState(false)

  // Nhập kho nhanh theo đơn vị quy đổi (VD: Nhập 10 kg -> +10.000 gr)
  const [quickImportProd, setQuickImportProd] = useState<ProductRow | null>(null)
  const [quickImportQty, setQuickImportQty] = useState('10')
  const [quickImportSaving, setQuickImportSaving] = useState(false)

  // Thêm Loại sản phẩm mới
  const [newTypeCode, setNewTypeCode] = useState('')
  const [newTypeName, setNewTypeName] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')
  const [savingNewType, setSavingNewType] = useState(false)

  // ===== Thiết lập & Quản lý Danh mục Sản phẩm =====
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

  // Gán sản phẩm hàng loạt vào danh mục
  const [assignCatModal, setAssignCatModal] = useState<Category | null>(null)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignOnlyUncategorized, setAssignOnlyUncategorized] = useState(false)
  const [selectedAssignProductIds, setSelectedAssignProductIds] = useState<string[]>([])
  const [savingAssign, setSavingAssign] = useState(false)

  // Tạo nhanh danh mục ngay trong form Thêm/Sửa sản phẩm
  const [inlineCatOpen, setInlineCatOpen] = useState(false)
  const [inlineCatName, setInlineCatName] = useState('')
  const [inlineCatSaving, setInlineCatSaving] = useState(false)

  // ===== Dialog thêm / sửa =====
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  /** Bản sao live của các listing (kèm trạng thái đồng bộ mô tả) của SP đang sửa — cập nhật sau khi sync */
  const [editingListings, setEditingListings] = useState<ProductListing[]>([])
  const [syncingDesc, setSyncingDesc] = useState(false)

  // ===== Xóa sản phẩm =====
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ===== In nhãn mã vạch =====
  const [printOpen, setPrintOpen] = useState(false)
  const [printProducts, setPrintProducts] = useState<BarcodeProduct[]>([])

  const openPrintDialog = (list: ProductRow[]) => {
    setPrintProducts(
      list.map((p) => ({ id: p.id, sku: p.sku, name: p.name, barcode: p.barcode ?? null, sellPrice: p.sellPrice }))
    )
    setPrintOpen(true)
  }

  // ===== Xuất / Nhập CSV =====
  const [exportingCsv, setExportingCsv] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importErrors, setImportErrors] = useState<
    Array<{ row: number; sku?: string; field?: string; message: string }>
  >([])
  const [importSuccessMessage, setImportSuccessMessage] = useState<string | null>(null)

  const handleExportCsv = async () => {
    try {
      setExportingCsv(true)
      const res = await fetch('/api/products/export')
      if (!res.ok) {
        throw new Error(`Lỗi tải danh mục (${res.status})`)
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'danh-muc-san-pham.csv'
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast({
        title: 'Xuất CSV thành công',
        description: 'Tệp danh mục sản phẩm đã được tải về máy.',
      })
    } catch (err) {
      toast({
        title: 'Không thể xuất danh mục CSV',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setExportingCsv(false)
    }
  }

  const handleImportSubmit = async () => {
    if (!importFile) return
    setImporting(true)
    setImportErrors([])
    setImportSuccessMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', importFile)

      const res = await fetch('/api/products/import', {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        if (data?.errors && Array.isArray(data.errors)) {
          setImportErrors(data.errors)
          toast({
            title: 'Tệp CSV có lỗi kiểm tra dữ liệu',
            description: `Phát hiện ${data.totalErrors || data.errors.length} dòng lỗi. Dữ liệu chưa được ghi vào hệ thống.`,
            variant: 'destructive',
          })
        } else {
          toast({
            title: 'Nhập CSV thất bại',
            description: data?.error || 'Đã xảy ra lỗi khi tải lên',
            variant: 'destructive',
          })
        }
        return
      }

      setImportSuccessMessage(`Đã nhập thành công ${data.processedCount ?? 0} sản phẩm vào hệ thống.`)
      toast({
        title: 'Nhập CSV thành công',
        description: `Đã xử lý ${data.processedCount ?? 0} sản phẩm.`,
      })
      await fetchProducts()
    } catch (err) {
      toast({
        title: 'Lỗi tải lên tệp CSV',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setImporting(false)
    }
  }

  // ===== Tìm kiếm debounce (client-side) =====
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchProducts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (categoryFilter !== 'ALL') params.set('categoryId', categoryFilter)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      const qs = params.toString()
      const data = await apiGet<{ products: ProductRow[] }>(`/api/products${qs ? `?${qs}` : ''}`)
      setProducts(data.products)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [search, categoryFilter, statusFilter])

  useEffect(() => {
    void fetchProducts()
  }, [fetchProducts])

  const fetchMeta = useCallback(async () => {
    try {
      const [catRes, chRes, ucRes] = await Promise.all([
        apiGet<{ categories: Category[] }>('/api/categories'),
        apiGet<{ channels: Channel[] }>('/api/channels'),
        apiGet<{ productTypes: ProductTypeInfo[]; unitConfigs: Record<string, ProductUnitConfig> }>('/api/unit-conversions'),
      ])
      setCategories(catRes.categories)
      setChannels(chRes.channels)
      setProductTypes(ucRes.productTypes ?? [])
      setUnitConfigs(ucRes.unitConfigs ?? {})
    } catch (err) {
      toast({
        title: 'Không thể tải danh mục / kênh bán',
        description: errorMessage(err),
        variant: 'destructive',
      })
    }
  }, [toast])

  useEffect(() => {
    void fetchMeta()
  }, [fetchMeta])

  // Tự động đồng bộ ngầm khi có sự kiện thay đổi sản phẩm / kênh bán / kết nối
  useRealtime((e) => {
    if (['product.updated', 'channel.updated', 'realtime.poll'].includes(e.type)) {
      void fetchProducts()
      void fetchMeta()
    }
  })

  // ===== Bộ lọc OPENVN Quick Tab + Phân trang client-side =====
  const tabCounts = useMemo(() => {
    const convertedCount = products.filter((p) => {
      const uc = p.unitConfig ?? unitConfigs[p.id]
      return (uc && (uc.purchaseRate > 1 || uc.sellRate > 1 || uc.linkedBaseProductId)) || p.type === 'WEIGHT_BULK' || p.type === 'PACKAGED_VARIANT' || p.type === 'MATERIAL'
    }).length
    return {
      ALL: products.length,
      ACTIVE: products.filter((p) => p.status === 'ACTIVE').length,
      LOW_STOCK: products.filter((p) => p.stock <= p.lowStockThreshold).length,
      COMBO: products.filter((p) => p.type === 'COMBO').length,
      INACTIVE: products.filter((p) => p.status === 'INACTIVE').length,
      CATEGORIES: categories.length,
      UNIT_CONVERSION: convertedCount,
    }
  }, [products, categories, unitConfigs])

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
      await Promise.all([fetchMeta(), fetchProducts()])
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
      await fetchProducts()
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
      await fetchMeta()
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
      await Promise.all([fetchMeta(), fetchProducts()])
    } catch (err) {
      toast({ title: 'Không thể xóa loại sản phẩm', description: errorMessage(err), variant: 'destructive' })
    }
  }

  // Thống kê chi tiết cho từng danh mục (tính từ danh sách SP hiện có)
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
      const unitCost = p.type === 'COMBO' ? (p.comboCostPrice || p.costPrice || 0) : (p.costPrice ?? 0)
      const effectiveStock = p.type === 'COMBO' ? (p.comboAvailable ?? p.stock) : p.stock
      entry.count += 1
      if (p.status === 'ACTIVE') entry.activeCount += 1
      entry.totalStock += Math.max(0, effectiveStock)
      entry.totalStockValue += Math.max(0, effectiveStock * unitCost)
      if (entry.sampleNames.length < 3) entry.sampleNames.push(p.name)
      map.set(p.categoryId, entry)
    }
    return map
  }, [categories, products])

  const uncategorizedProducts = useMemo(() => products.filter((p) => !p.categoryId), [products])

  // ===== Handlers Thiết lập Danh mục Sản phẩm =====
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
      await fetchMeta()
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

  const handleInlineCreateCategory = async () => {
    const name = inlineCatName.trim()
    if (!name) {
      toast({ title: 'Vui lòng nhập tên danh mục mới', variant: 'destructive' })
      return
    }
    setInlineCatSaving(true)
    try {
      const res = await apiPost<{ category: Category }>('/api/categories', {
        name,
        slug: clientSlugify(name),
      })
      await fetchMeta()
      setForm((f) => ({ ...f, categoryId: res.category.id }))
      setInlineCatName('')
      setInlineCatOpen(false)
      toast({
        title: 'Đã thêm & chọn danh mục mới',
        description: res.category.name,
      })
    } catch (err) {
      toast({
        title: 'Không thể tạo danh mục',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setInlineCatSaving(false)
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
      await Promise.all([fetchMeta(), fetchProducts()])
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
      if (categoryFilter === deletingCat.id) {
        setCategoryFilter('ALL')
      }
      setDeletingCat(null)
      setReassignCatId('NONE')
      await Promise.all([fetchMeta(), fetchProducts()])
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
      await Promise.all([fetchMeta(), fetchProducts()])
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

  const filteredProducts = useMemo(() => {
    switch (quickTab) {
      case 'ACTIVE':
        return products.filter((p) => p.status === 'ACTIVE')
      case 'LOW_STOCK':
        return products.filter((p) => p.stock <= p.lowStockThreshold)
      case 'COMBO':
        return products.filter((p) => p.type === 'COMBO')
      case 'INACTIVE':
        return products.filter((p) => p.status === 'INACTIVE')
      default:
        return products
    }
  }, [products, quickTab])

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedProducts = useMemo(
    () => filteredProducts.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredProducts, currentPage]
  )
  const hasFilter =
    search !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL' || quickTab !== 'ALL'

  // ===== Dialog handlers =====
  const openCreate = () => {
    setEditing(null)
    setEditingListings([])
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (p: ProductRow) => {
    setEditing(p)
    setEditingListings(p.listings ?? [])
    // Giá kênh: listing có price → String(price), không có → '' (theo giá chung)
    const prices: Record<string, string> = {}
    for (const l of p.listings ?? []) {
      prices[l.channelId] = l.price != null ? String(l.price) : ''
    }
    const uc = p.unitConfig ?? unitConfigs[p.id]
    const defaultUnit = p.unit || 'cái'
    const activeConnectedChannelIds = (p.listings ?? [])
      .filter((l) => {
        const ch = l.channel ?? channels.find((c) => c.id === l.channelId)
        return ch ? ch.connected !== false : true
      })
      .map((l) => l.channelId)

    setForm({
      type: p.type ?? 'SIMPLE',
      sku: p.sku,
      name: p.name,
      description: p.description ?? '',
      categoryId: p.categoryId ?? 'NONE',
      barcode: p.barcode ?? '',
      image: p.image ?? '',
      costPrice: String(p.costPrice),
      sellPrice: String(p.sellPrice),
      stock: String(p.stock),
      lowStockThreshold: String(p.lowStockThreshold),
      status: p.status,
      listingChannelIds: activeConnectedChannelIds,
      channelPrices: prices,
      baseUnit: uc?.baseUnit || defaultUnit,
      purchaseUnit: uc?.purchaseUnit || defaultUnit,
      purchaseRate: String(uc?.purchaseRate || 1),
      sellUnit: uc?.sellUnit || defaultUnit,
      sellRate: String(uc?.sellRate || 1),
      linkedBaseProductId: uc?.linkedBaseProductId || 'NONE',
      convertInitialStock: false,
    })
    setDialogOpen(true)
  }

  const toggleChannel = (channelId: string, checked: boolean) => {
    setForm((f) => ({
      ...f,
      listingChannelIds: checked
        ? [...f.listingChannelIds, channelId]
        : f.listingChannelIds.filter((id) => id !== channelId),
    }))
  }

  const setChannelPrice = (channelId: string, value: string) => {
    setForm((f) => ({
      ...f,
      channelPrices: { ...f.channelPrices, [channelId]: value.replace(/[^\d.]/g, '') },
    }))
  }

  const handleSave = async () => {
    if (!form.sku.trim()) {
      toast({ title: 'Vui lòng nhập SKU sản phẩm', variant: 'destructive' })
      return
    }
    if (!form.name.trim()) {
      toast({ title: 'Vui lòng nhập tên sản phẩm', variant: 'destructive' })
      return
    }
    if (!Number(form.sellPrice)) {
      toast({ title: 'Vui lòng nhập giá bán hợp lệ', variant: 'destructive' })
      return
    }
    // Giá kênh phải là số ≥ 0 khi có nhập
    for (const ch of channels) {
      const raw = (form.channelPrices[ch.id] ?? '').trim()
      if (raw && (Number.isNaN(Number(raw)) || Number(raw) < 0)) {
        toast({ title: `Giá kênh ${ch.name} không hợp lệ`, description: 'Chỉ nhận số từ 0 trở lên — bỏ trống để dùng giá chung.', variant: 'destructive' })
        return
      }
    }
    // Danh sách kênh kèm giá riêng: giá trống = null (theo giá bán chung)
    const listings = form.listingChannelIds.map((channelId) => {
      const raw = (form.channelPrices[channelId] ?? '').trim()
      const prevListing = editingListings.find((el) => el.channelId === channelId)
      const chObj = channels.find((c) => c.id === channelId)
      return {
        id: prevListing?.id ?? `listing-${channelId}`,
        channelId,
        price: raw ? Number(raw) : null,
        ...(chObj ? { channel: chObj } : {}),
      }
    })
    setSaving(true)
    try {
      const pRate = Math.max(1, Number(form.purchaseRate) || 1)
      const sRate = Math.max(1, Number(form.sellRate) || 1)
      const bUnit = form.baseUnit.trim() || 'cái'
      const pUnit = form.purchaseUnit.trim() || bUnit
      const sUnit = form.sellUnit.trim() || bUnit
      const unitConfigPayload = {
        baseUnit: bUnit,
        purchaseUnit: pUnit,
        purchaseRate: pRate,
        sellUnit: sUnit,
        sellRate: sRate,
        linkedBaseProductId: form.linkedBaseProductId === 'NONE' ? null : form.linkedBaseProductId,
      }
      const selectedCat = form.categoryId === 'NONE' ? null : (categories.find((c) => c.id === form.categoryId) ?? null)
      const base = {
        type: form.type,
        unit: bUnit,
        unitConfig: unitConfigPayload,
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        categoryId: form.categoryId === 'NONE' ? null : form.categoryId,
        category: selectedCat,
        barcode: form.barcode.trim(),
        image: form.image.trim(),
        costPrice: Number(form.costPrice) || 0,
        sellPrice: Number(form.sellPrice) || 0,
        lowStockThreshold: Number(form.lowStockThreshold) || 0,
        status: form.status,
        listingChannelIds: form.listingChannelIds,
        listings,
      }
      if (editing) {
        await apiPut<{ product: ProductRow }>(`/api/products/${editing.id}`, {
          ...base,
          ...(form.type !== 'COMBO' && form.stock.trim() !== '' ? { stock: Number(form.stock) || 0 } : {}),
        })
        toast({ title: 'Đã cập nhật sản phẩm & cấu hình quy đổi', description: base.name })
      } else {
        await apiPost<{ product: Product }>('/api/products', {
          ...base,
          stock: Number(form.stock) || 0,
          convertInitialStock: form.convertInitialStock && pRate > 1,
        })
        toast({ title: 'Đã thêm sản phẩm mới', description: base.name })
      }
      setDialogOpen(false)
      void Promise.all([fetchProducts(), fetchMeta()])
    } catch (err) {
      toast({
        title: editing ? 'Không thể cập nhật sản phẩm' : 'Không thể thêm sản phẩm',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (p: Product) => {
    const nextStatus = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    try {
      await apiPut<{ product: Product }>(`/api/products/${p.id}`, { status: nextStatus })
      toast({
        title: nextStatus === 'ACTIVE' ? 'Đã kích hoạt lại sản phẩm' : 'Đã ngừng bán sản phẩm',
        description: p.name,
      })
      void fetchProducts()
    } catch (err) {
      toast({
        title: 'Cập nhật trạng thái thất bại',
        description: errorMessage(err),
        variant: 'destructive',
      })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    setDeleteLoading(true)
    try {
      await apiDelete<{ success: boolean }>(`/api/products/${deleting.id}`)
      toast({ title: 'Đã xóa sản phẩm', description: deleting.name })
      setDeleting(null)
      void fetchProducts()
    } catch (err) {
      // 409: sản phẩm đã có đơn hàng → gợi ý chuyển sang "Ngừng bán"
      toast({
        title: 'Không thể xóa sản phẩm',
        description: `${errorMessage(err)}. Nếu sản phẩm đã có đơn hàng, hãy chuyển sang "Ngừng bán" thay vì xóa.`,
        variant: 'destructive',
      })
      setDeleting(null)
    } finally {
      setDeleteLoading(false)
    }
  }

  // ===== Đồng bộ mô tả sản phẩm lên các kênh =====
  const syncDescription = async (productId: string): Promise<SyncDescriptionResponse> => {
    // Không gửi channelIds = đồng bộ TẤT CẢ kênh của sản phẩm
    return apiPost<SyncDescriptionResponse>(`/api/products/${productId}/sync-description`, {})
  }

  // Từ dropdown menu từng dòng trong bảng
  const handleSyncDescription = async (p: ProductRow) => {
    try {
      const res = await syncDescription(p.id)
      if (res.synced === 0) {
        toast({ title: 'Sản phẩm chưa có kênh bán nào để đồng bộ', description: p.name })
        return
      }
      toast({
        title: `Đã đồng bộ mô tả ${p.name} tới ${res.synced} kênh`,
        description: res.channels.map((c) => c.name).join(', '),
      })
      void fetchProducts()
    } catch (err) {
      toast({
        title: 'Không thể đồng bộ mô tả',
        description: errorMessage(err),
        variant: 'destructive',
      })
    }
  }

  // Từ nút trong form sửa sản phẩm — cập nhật trạng thái mô tả ngay trong dialog
  const handleSyncDescriptionFromForm = async () => {
    if (!editing) return
    setSyncingDesc(true)
    try {
      const res = await syncDescription(editing.id)
      if (res.synced === 0) {
        toast({ title: 'Sản phẩm chưa có kênh bán nào để đồng bộ', description: editing.name })
        return
      }
      toast({
        title: `Đã đồng bộ mô tả tới ${res.synced} kênh`,
        description: res.channels.map((c) => c.name).join(', '),
      })
      // Cập nhật local: bản kênh = mô tả master đang lưu trong DB (editing.description)
      const syncedByChannel = new Map(res.channels.map((c) => [c.channelId, c.syncedAt]))
      setEditingListings((prev) =>
        prev.map((l) => {
          const syncedAt = syncedByChannel.get(l.channelId)
          return syncedAt ? { ...l, description: editing.description ?? null, descriptionSyncedAt: syncedAt } : l
        })
      )
    } catch (err) {
      toast({
        title: 'Không thể đồng bộ mô tả',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSyncingDesc(false)
    }
  }

  return (
    <div>
      <PageHeader title="Quản lý Sản phẩm" description="Danh sách hàng hóa, giá bán đa kênh, tồn kho quy đổi tự động (Kg ⇄ Gr) và in nhãn mã vạch">
        {/* Cụm nút đầy đủ trên màn hình rộng (>= xl) */}
        <div className="hidden items-center gap-2 xl:flex">
          <Button
            variant="outline"
            className="border-[#0066CC]/40 text-[#0066CC] hover:bg-[#0066CC]/5 dark:text-sky-400"
            onClick={() => {
              if (onOpenSystemCatalog) {
                onOpenSystemCatalog('UNIT_CONVERSION')
              } else {
                setQuickTab('UNIT_CONVERSION')
              }
            }}
            title="Mở Trung tâm Cấu hình Hệ thống: Danh mục, Loại sản phẩm & Quy đổi Định lượng"
          >
            <Scale className="mr-1.5 h-4 w-4" />
            Cấu hình Danh mục &amp; Quy đổi ĐVT
          </Button>
          <Button variant="outline" onClick={() => void handleExportCsv()} disabled={exportingCsv}>
            {exportingCsv ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            {exportingCsv ? 'Đang xuất...' : 'Xuất CSV'}
          </Button>
          <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" /> Nhập CSV
          </Button>
          <Button variant="outline" onClick={() => openPrintDialog(filteredProducts)}>
            <Barcode className="mr-1.5 h-4 w-4" /> In nhãn mã vạch
          </Button>
        </div>

        {/* Menu gộp gọn các tác vụ phụ trên Điện thoại & Tablet (< xl) */}
        <div className="xl:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5">
                <MoreHorizontal className="h-4 w-4" />
                <span>Tiện ích &amp; CSV</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => {
                  if (onOpenSystemCatalog) {
                    onOpenSystemCatalog('UNIT_CONVERSION')
                  } else {
                    setQuickTab('UNIT_CONVERSION')
                  }
                }}
                className="cursor-pointer gap-2 text-xs"
              >
                <Scale className="h-4 w-4 text-[#0066CC]" />
                <span>Cấu hình Danh mục &amp; Quy đổi ĐVT</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openPrintDialog(filteredProducts)}
                className="cursor-pointer gap-2 text-xs"
              >
                <Barcode className="h-4 w-4 text-foreground" />
                <span>In nhãn mã vạch</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setImportDialogOpen(true)}
                className="cursor-pointer gap-2 text-xs"
              >
                <Upload className="h-4 w-4 text-emerald-600" />
                <span>Nhập sản phẩm từ CSV</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => void handleExportCsv()}
                disabled={exportingCsv}
                className="cursor-pointer gap-2 text-xs"
              >
                <Download className="h-4 w-4 text-sky-600" />
                <span>{exportingCsv ? 'Đang xuất CSV...' : 'Xuất danh sách CSV'}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Button className="bg-[#0066CC] text-white hover:bg-[#0055B3]" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Thêm sản phẩm
        </Button>
      </PageHeader>

      {/* OPENVN Horizontal Quick-Filter Tabs (thuần bộ lọc vận hành Sản phẩm; phần Thiết lập đã đưa về Cấu hình Hệ thống) */}
      <div className="mb-4 overflow-x-auto rounded-t-xl border border-b-0 bg-card px-2 pt-1.5 shadow-xs">
        <div className="flex min-w-max items-center gap-1 border-b border-border/60">
          {(
            [
              { key: 'ALL', label: 'Tất cả sản phẩm', count: tabCounts.ALL },
              { key: 'ACTIVE', label: 'Đang giao dịch', count: tabCounts.ACTIVE },
              { key: 'LOW_STOCK', label: 'Sắp hết / Hết hàng', count: tabCounts.LOW_STOCK, alert: true },
              { key: 'COMBO', label: 'Combo / Bộ quà tặng', count: tabCounts.COMBO },
              { key: 'INACTIVE', label: 'Ngừng kinh doanh', count: tabCounts.INACTIVE },
            ] as const
          ).map((tab) => {
            const active = quickTab === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setQuickTab(tab.key)
                  setPage(1)
                }}
                className={cn(
                  'relative flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium transition-colors',
                  active
                    ? 'font-semibold text-[#0066CC] dark:text-sky-400'
                    : 'highlight' in tab && tab.highlight
                      ? 'font-semibold text-emerald-700 hover:text-emerald-800 dark:text-emerald-400'
                      : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums',
                    active
                      ? 'bg-[#0066CC]/10 text-[#0066CC] dark:bg-sky-400/15 dark:text-sky-300'
                      : 'alert' in tab && tab.alert && tab.count > 0
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : 'highlight' in tab && tab.highlight
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                  )}
                >
                  {tab.count}
                </span>
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#0066CC] dark:bg-sky-400" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {quickTab === 'CATEGORIES' ? (
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
                Chiếm {products.length > 0 ? Math.round(((products.length - uncategorizedProducts.length) / products.length) * 100) : 100}% tổng danh mục hàng hóa
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
                  Nhập tên danh mục — hệ thống tự động tạo mã đường dẫn (Slug) chuẩn SEO cho gian hàng Storefront và bộ lọc POS.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 self-start text-xs sm:self-auto"
                onClick={() => setQuickTab('ALL')}
              >
                ← Quay lại danh sách Sản phẩm
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
              <div className="space-y-1.5 sm:col-span-5">
                <Label htmlFor="new-cat-name">
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
                />
              </div>
              <div className="space-y-1.5 sm:col-span-4">
                <Label htmlFor="new-cat-slug">Mã đường dẫn (Slug SEO)</Label>
                <Input
                  id="new-cat-slug"
                  value={newCatSlug}
                  onChange={(e) => {
                    setNewCatSlugTouched(true)
                    setNewCatSlug(e.target.value)
                  }}
                  placeholder="VD: tram-huong-nhang-sach"
                  className="font-mono text-xs"
                />
              </div>
              <div className="sm:col-span-3">
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

            {/* Danh mục gợi ý */}
            {(() => {
              const existingSlugs = new Set(categories.map((c) => c.slug))
              const availablePresets = PRESET_CATEGORIES.filter((preset) => !existingSlugs.has(clientSlugify(preset)))
              if (availablePresets.length === 0) return null
              return (
                <div className="mt-3.5 flex flex-wrap items-center gap-1.5 border-t pt-3">
                  <span className="mr-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Danh mục gợi ý:
                  </span>
                  {availablePresets.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={creatingCat}
                      className="h-7 rounded-full px-2.5 text-xs"
                      onClick={() => void handleCreateCategory(preset)}
                    >
                      <Plus className="mr-1 h-3 w-3 text-[#0066CC]" />
                      {preset}
                    </Button>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Danh sách Danh mục Sản phẩm */}
          {categories.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="Chưa có danh mục sản phẩm nào"
              description="Hãy nhập tên danh mục ở khung phía trên hoặc chọn danh mục gợi ý để khởi tạo bộ danh mục chuẩn."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
              <Table tableId="categories-setup">
                <TableHeader>
                  <TableRow>
                    <TableHead locked>Tên danh mục</TableHead>
                    <TableHead>Mã Slug</TableHead>
                    <TableHead>Số lượng SP</TableHead>
                    <TableHead>Sản phẩm tiêu biểu</TableHead>
                    <TableHead className="text-right">Tổng tồn kho</TableHead>
                    <TableHead className="text-right">Giá trị tồn kho</TableHead>
                    <TableHead locked className="text-right">
                      Thao tác thiết lập
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categories.map((cat) => {
                    const st = categoryStatsMap.get(cat.id) ?? {
                      count: cat.productCount ?? 0,
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
                            <div className="flex items-center gap-2">
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0066CC]/10 text-[#0066CC] dark:bg-sky-400/15 dark:text-sky-300">
                                <FolderKanban className="h-4 w-4" />
                              </span>
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
                          {formatNumber(st.totalStock)} SP
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
                                {savingCat ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
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
                                className="h-8 px-2.5 text-xs"
                                onClick={() => {
                                  setCategoryFilter(cat.id)
                                  setQuickTab('ALL')
                                  setPage(1)
                                }}
                                title="Xem danh sách sản phẩm thuộc danh mục này"
                              >
                                Xem SP ({st.count})
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-[#0066CC]/30 px-2.5 text-xs text-[#0066CC] hover:bg-[#0066CC]/5 dark:text-sky-400"
                                onClick={() => openAssignProductsModal(cat)}
                                title="Chọn & gán sản phẩm vào danh mục này"
                              >
                                <Plus className="mr-1 h-3.5 w-3.5" />
                                Gán SP
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
          )}
        </div>
      ) : quickTab === 'UNIT_CONVERSION' ? (
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
                {tabCounts.UNIT_CONVERSION} sản phẩm
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
                  const badgeStyle = PRODUCT_TYPE_BADGES[pt.code]?.className ?? 'border-emerald-300 bg-emerald-50 text-emerald-700'
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
                    {savingNewType ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                    Thêm loại
                  </Button>
                </div>
              </div>
            </div>

            {/* Cột phải: Thiết lập Quy đổi Định lượng cho Sản phẩm (7 cột) */}
            <div className="space-y-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5 lg:col-span-7">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <Scale className="h-4 w-4 text-emerald-600" />
                    2. Thiết lập Quy đổi Định lượng (Nhập Kho ⇄ Tồn Gốc ⇄ Xuất Bán)
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Ví dụ: Khi nhập kho <strong>10 kg</strong> tự động quy đổi ra <strong>+10.000 gr</strong> (1 kg = 1.000 gr); khi bán lẻ 100gr / 500gr / 1kg tự trừ đồng bộ vào kho gram.
                  </p>
                </div>
              </div>

              {/* Bộ mẫu quy đổi nhanh 1 chạm */}
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-emerald-50/60 p-2.5 dark:bg-emerald-950/20">
                <span className="mr-1 flex items-center gap-1 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  <Sparkles className="h-3.5 w-3.5" />
                  Mẫu quy đổi chuẩn:
                </span>
                {[
                  { label: '1 Kg = 1.000 Gr (Nhập Kg, Bán Kg/Gr)', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'kg (1.000gr)', sRate: '1000', type: 'WEIGHT_BULK' },
                  { label: 'Nhập Kg → Bán Gói 500gr', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'gói 500gr', sRate: '500', type: 'WEIGHT_BULK' },
                  { label: 'Nhập Kg → Bán Hộp 200gr', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'hộp 200gr', sRate: '200', type: 'WEIGHT_BULK' },
                  { label: 'Nhập Kg → Bán Lẻ 100gr', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'gói 100gr', sRate: '100', type: 'WEIGHT_BULK' },
                  { label: '1 Lít = 1.000 Ml (Tinh dầu)', base: 'ml', pUnit: 'lít', pRate: '1000', sUnit: 'chai 100ml', sRate: '100', type: 'MATERIAL' },
                  { label: '1 Thùng = 24 Cái', base: 'cái', pUnit: 'thùng', pRate: '24', sUnit: 'cái', sRate: '1', type: 'SIMPLE' },
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
                    placeholder="VD: gr, ml, cái, viên..."
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Mọi biến động nhập/xuất sẽ quy về đơn vị gốc này (VD: <strong>gr</strong>).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>Đơn vị Nhập kho</Label>
                    <Input
                      value={convPurchaseUnit}
                      onChange={(e) => setConvPurchaseUnit(e.target.value)}
                      placeholder="VD: kg, thùng, bao..."
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
                  <p className="col-span-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    Ví dụ: Nhập <strong>10 {convPurchaseUnit || 'kg'}</strong> → Hệ thống tự cộng{' '}
                    <strong>+{formatNumber(10 * (Number(convPurchaseRate) || 1))} {convBaseUnit || 'gr'}</strong> vào tồn kho.
                  </p>
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
                  <p className="col-span-2 text-[11px] font-medium text-[#0066CC] dark:text-sky-400">
                    Khi bán <strong>1 {convSellUnit || 'đơn vị'}</strong> → Tự động trừ{' '}
                    <strong>-{formatNumber(Number(convSellRate) || 1)} {convBaseUnit || 'gr'}</strong> tồn kho.
                  </p>
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
                  <p className="text-[11px] text-muted-foreground">
                    Dùng khi tạo SKU gói nhỏ (VD: Gói 200gr) muốn rút chung từ bao sáp/trầm tổng.
                  </p>
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
                      Nhân luôn tồn kho hiện tại của SP này với{' '}
                      <strong>×{formatNumber(Number(convPurchaseRate) || 1)}</strong> (chuyển tồn từ {convPurchaseUnit} sang {convBaseUnit})
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

          {/* Bảng danh sách các Sản phẩm đang áp dụng Quy đổi Định lượng + Nút Nhập kho Quy đổi 1 chạm */}
          <div className="rounded-xl border bg-card shadow-xs">
            <div className="flex flex-col gap-2 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Danh sách Sản phẩm &amp; Nguyên vật liệu có Quy đổi Định lượng
                </h3>
                <p className="text-xs text-muted-foreground">
                  Bấm <strong>&ldquo;Nhập kho quy đổi&rdquo;</strong> để nhập theo Kg/Thùng (VD: nhập 10 kg → hệ thống tự cộng +10.000 gr).
                </p>
              </div>
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
                    <TableHead className="text-right">Thao tác nhanh</TableHead>
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
                      const linkedBase = uc?.linkedBaseProductId
                        ? products.find((item) => item.id === uc.linkedBaseProductId)
                        : null
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
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              VD: Nhập 10 {pUnit} → +{formatNumber(10 * pRate)} {bUnit}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs font-medium text-foreground">
                              1 {sUnit} = trừ {formatNumber(sRate)} {bUnit}
                            </span>
                            {linkedBase ? (
                              <p className="text-[11px] text-amber-700 dark:text-amber-400">
                                Trừ đồng bộ vào: {linkedBase.name} ({formatNumber(linkedBase.stock)} {linkedBase.unit})
                              </p>
                            ) : (
                              <p className="text-[11px] text-muted-foreground">
                                Hỗ trợ bán lẻ 100{bUnit}, 200{bUnit}, 500{bUnit}, 1{pUnit} tại POS
                              </p>
                            )}
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
      ) : (
        <>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, SKU hoặc mã vạch..."
            className="pl-8"
            aria-label="Tìm kiếm sản phẩm"
          />
        </div>
        <Select
          value={categoryFilter}
          onValueChange={(v) => {
            setCategoryFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Lọc theo danh mục">
            <SelectValue placeholder="Tất cả danh mục" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả danh mục</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[150px]" aria-label="Lọc theo trạng thái">
            <SelectValue placeholder="Tất cả trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            <SelectItem value="ACTIVE">Đang bán</SelectItem>
            <SelectItem value="INACTIVE">Ngừng bán</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Nội dung chính */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void fetchProducts()} />
      ) : filteredProducts.length === 0 ? (
        <EmptyState
          icon={Package}
          title={hasFilter ? 'Không tìm thấy sản phẩm nào' : 'Chưa có sản phẩm nào'}
          description={
            hasFilter
              ? 'Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc.'
              : 'Bắt đầu bằng cách thêm sản phẩm đầu tiên cho cửa hàng.'
          }
          action={
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> Thêm sản phẩm
            </Button>
          }
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <Table tableId="products-main" className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead locked>Sản phẩm</TableHead>
                  <TableHead defaultHidden>Mã SKU</TableHead>
                  <TableHead>Danh mục</TableHead>
                  <TableHead>Mã vạch</TableHead>
                  <TableHead defaultHidden className="text-right">Giá vốn</TableHead>
                  <TableHead className="text-right">Giá bán</TableHead>
                  <TableHead defaultHidden className="text-right">Lợi nhuận gộp</TableHead>
                  <TableHead>Tồn kho</TableHead>
                  <TableHead defaultHidden className="text-right">Giá trị tồn</TableHead>
                  <TableHead defaultHidden className="text-right">Ngưỡng tối thiểu</TableHead>
                  <TableHead>Kênh bán</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead locked className="w-12 text-right">
                    <span className="sr-only">Hành động</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedProducts.map((p) => {
                  const uc = p.unitConfig ?? unitConfigs[p.id]
                  const bUnit = uc?.baseUnit || p.unit || 'cái'
                  const pUnit = uc?.purchaseUnit || bUnit
                  const pRate = uc?.purchaseRate || 1
                  const unitCost = p.type === 'COMBO' ? (p.comboCostPrice || p.costPrice || 0) : (p.costPrice ?? 0)
                  const grossProfit = Math.max(0, (p.sellPrice ?? 0) - unitCost)
                  const marginPct = p.sellPrice > 0 ? Math.round((grossProfit / p.sellPrice) * 100) : 0
                  const effectiveStock = p.type === 'COMBO' ? (p.comboAvailable ?? p.stock) : p.stock
                  const stockValue = Math.max(0, Math.round((effectiveStock / (pRate > 1 ? pRate : 1)) * unitCost))
                  const typeBadge = PRODUCT_TYPE_BADGES[p.type ?? 'SIMPLE']
                  return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ProductAvatar name={p.name} image={p.image} />
                        <div className="min-w-0">
                          <div className="flex max-w-[260px] flex-wrap items-center gap-1.5 font-medium">
                            <span className="truncate">{p.name}</span>
                            {p.type === 'COMBO' ? (
                              <ComboBadge />
                            ) : typeBadge && p.type !== 'SIMPLE' ? (
                              <Badge variant="outline" className={cn('h-4 px-1.5 text-[10px] font-medium', typeBadge.className)}>
                                {typeBadge.label}
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <span>{p.sku}</span>
                            {pRate > 1 && (
                              <span className="rounded bg-emerald-100 px-1 py-0.2 font-mono text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                1 {pUnit} = {formatNumber(pRate)} {bUnit}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs font-semibold text-foreground/90">
                      {p.sku}
                    </TableCell>
                    <TableCell className="text-sm">
                      {(p.categoryId ? categories.find((c) => c.id === p.categoryId)?.name : null) ??
                        p.category?.name ??
                        '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {p.barcode ? (
                          <span className="max-w-[140px] truncate font-mono text-xs" title={p.barcode}>
                            {p.barcode}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                          title="In nhãn mã vạch"
                          aria-label={`In nhãn mã vạch cho ${p.sku}`}
                          onClick={() => openPrintDialog([p])}
                        >
                          <Barcode className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm text-muted-foreground">
                      {formatVND(unitCost)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm font-medium">{formatVND(p.sellPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm">
                      <div className="inline-flex flex-col items-end">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                          +{formatVND(grossProfit)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">Biên {marginPct}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.type === 'COMBO' ? (
                        <div className="space-y-0.5" title="Số bộ đóng được từ tồn thành phần">
                          <span className="text-sm tabular-nums">
                            {formatNumber(p.comboAvailable ?? p.stock)}
                          </span>
                          <p className="text-xs text-muted-foreground">bộ (tự động)</p>
                        </div>
                      ) : p.stock <= p.lowStockThreshold ? (
                        <div className="space-y-0.5">
                          <Badge
                            variant="outline"
                            className="border-red-200 bg-red-100 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
                          >
                            {p.stock === 0 ? 'Hết hàng' : `Còn ${formatNumber(p.stock)} ${bUnit}`}
                          </Badge>
                          <p className="text-xs text-muted-foreground">Ngưỡng {formatNumber(p.lowStockThreshold)} {bUnit}</p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <span className="text-sm font-medium tabular-nums">
                            {formatNumber(p.stock)} <span className="text-xs text-muted-foreground">{bUnit}</span>
                          </span>
                          {pRate > 1 && (
                            <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                              ≈ {(p.stock / pRate).toFixed(p.stock % pRate === 0 ? 0 : 2)} {pUnit}
                            </p>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-sm font-medium">
                      {formatVND(stockValue)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {formatNumber(p.lowStockThreshold)} {bUnit}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[220px] flex-wrap gap-x-3 gap-y-1">
                        {p.status === 'INACTIVE' ? (
                          <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            Ngừng bán trên mọi kênh
                          </span>
                        ) : (() => {
                          const activeListings = (p.listings ?? []).filter((l) => {
                            const ch = l.channel ?? channels.find((c) => c.id === l.channelId)
                            return ch && ch.connected !== false
                          })
                          if (activeListings.length === 0) {
                            return <span className="text-xs text-muted-foreground">—</span>
                          }
                          return activeListings.map((l) => {
                            const ch = l.channel ?? channels.find((c) => c.id === l.channelId)
                            const priceTitle =
                              l.price != null ? `Giá riêng: ${formatVND(l.price)}` : 'Theo giá bán chung'
                            const descTitle = l.descriptionSyncedAt
                              ? `Mô tả: đã đồng bộ ${formatDateTime(l.descriptionSyncedAt)}`
                              : 'Mô tả: chưa đồng bộ'
                            return (
                              <span
                                key={l.id ?? l.channelId}
                                title={`${priceTitle}\n${descTitle}`}
                                className="inline-flex min-w-0 items-center gap-1"
                              >
                                <ChannelBadge
                                  channel={ch}
                                  className="min-w-0 text-xs"
                                />
                                {l.price != null && (
                                  <>
                                    <span aria-hidden className="text-xs text-muted-foreground">
                                      ·
                                    </span>
                                    <span className="text-xs font-medium tabular-nums text-foreground/80">
                                      {formatCompactVND(l.price)}
                                    </span>
                                  </>
                                )}
                              </span>
                            )
                          })
                        })()}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ProductStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Hành động cho {p.name}</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => openEdit(p)}>
                            <Pencil className="mr-2 h-4 w-4" /> Sửa &amp; Quy đổi ĐVT
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setQuickImportProd(p)
                              setQuickImportQty('10')
                            }}
                          >
                            <Scale className="mr-2 h-4 w-4 text-emerald-600" /> Nhập kho quy đổi ({pUnit} → {bUnit})
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void handleSyncDescription(p)}>
                            <RefreshCw className="mr-2 h-4 w-4" /> Đồng bộ mô tả
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => void handleToggleStatus(p)}>
                            <Power className="mr-2 h-4 w-4" />
                            {p.status === 'ACTIVE' ? 'Ngừng bán' : 'Kích hoạt lại'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => setDeleting(p)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Xóa
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {/* Phân trang client-side */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              Hiển thị {formatNumber((currentPage - 1) * PAGE_SIZE + 1)}–
              {formatNumber(Math.min(currentPage * PAGE_SIZE, filteredProducts.length))} trong{' '}
              {formatNumber(filteredProducts.length)} sản phẩm
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" /> Trước
                </Button>
                <span className="text-sm text-muted-foreground">
                  Trang {currentPage}/{totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                >
                  Sau <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </>
      )}
        </>
      )}

      {/* Dialog thêm / sửa sản phẩm */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!saving) setDialogOpen(open)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Cập nhật thông tin sản phẩm và đồng bộ kênh bán.'
                : 'Điền thông tin để tạo sản phẩm mới trong hệ thống.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="product-sku">
                SKU <span className="text-destructive">*</span>
              </Label>
              <Input
                id="product-sku"
                value={form.sku}
                onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                placeholder="VD: AO-SOMI-01"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="product-barcode">Mã vạch (CODE128)</Label>
              <div className="flex gap-2">
                <Input
                  id="product-barcode"
                  value={form.barcode}
                  onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                  placeholder="VD: 8935201001234"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  title="Tự sinh mã vạch"
                  onClick={() => setForm((f) => ({ ...f, barcode: `BC${Date.now().toString(36).toUpperCase()}` }))}
                >
                  <Wand2 className="h-4 w-4" />
                  Tự sinh
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Quét bút quét USB hoặc nhập tay. Để trống sẽ sinh theo SKU khi in nhãn.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-name">
                Tên sản phẩm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="product-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Áo sơ mi nam dài tay"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="product-description">Mô tả</Label>
              <Textarea
                id="product-description"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Mô tả ngắn về sản phẩm..."
              />
              <p className="text-xs text-muted-foreground">
                Mô tả là nguồn chân lý duy nhất — bấm "Đồng bộ mô tả ngay" (mục Kênh bán) để đẩy bản sao này lên các kênh.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-image">Ảnh sản phẩm (URL)</Label>
              <div className="flex items-center gap-3">
                <ProductAvatar name={form.name || '?'} image={form.image.trim() || null} className="h-12 w-12" />
                <Input
                  id="product-image"
                  value={form.image}
                  onChange={(e) => setForm((f) => ({ ...f, image: e.target.value }))}
                  placeholder="https://... (dán link ảnh Shopee/web)"
                  maxLength={500}
                  className="flex-1"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Dán link ảnh http(s) — hiển thị trong danh sách Kho hàng. Bỏ trống sẽ hiện chữ cái đầu.
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="product-type">Loại sản phẩm</Label>
              <Select
                value={form.type}
                onValueChange={(v) => {
                  setForm((f) => {
                    if (v === 'WEIGHT_BULK' && f.baseUnit === 'cái') {
                      return {
                        ...f,
                        type: v,
                        baseUnit: 'gr',
                        purchaseUnit: 'kg',
                        purchaseRate: '1000',
                        sellUnit: 'kg (1.000gr)',
                        sellRate: '1000',
                      }
                    }
                    return { ...f, type: v }
                  })
                }}
              >
                <SelectTrigger id="product-type" className="w-full">
                  <SelectValue placeholder="Chọn loại sản phẩm" />
                </SelectTrigger>
                <SelectContent>
                  {productTypes.length > 0 ? (
                    productTypes.map((pt) => (
                      <SelectItem key={pt.code} value={pt.code}>
                        {pt.name} — {pt.description}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="SIMPLE">Thành phẩm chuẩn (Theo cái/hộp/bộ)</SelectItem>
                      <SelectItem value="WEIGHT_BULK">Hàng định lượng / Cân ký (Nhập Kg ⇄ Lưu &amp; Bán Gram)</SelectItem>
                      <SelectItem value="PACKAGED_VARIANT">Quy cách đóng gói đồng bộ (Trừ thẳng vào kho gốc)</SelectItem>
                      <SelectItem value="MATERIAL">Nguyên vật liệu / Bán thành phẩm (BOM)</SelectItem>
                      <SelectItem value="COMBO">Combo · Set quà tặng (Gộp nhiều thành phẩm)</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              {form.type === 'COMBO' && (
                <p className="text-xs text-violet-600 dark:text-violet-400">
                  Xuất bán sẽ tự trừ kho các sản phẩm thành phần khai báo ở mục Kho &amp; Định mức — giá vốn gộp tính
                  tự động.
                </p>
              )}
            </div>

            {/* Khung Cấu hình Đơn vị tính & Quy đổi Định lượng ngay trong form Thêm/Sửa */}
            <div className="space-y-3 rounded-xl border border-emerald-300/70 bg-emerald-50/40 p-3.5 sm:col-span-2 dark:border-emerald-900 dark:bg-emerald-950/20">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-900 dark:text-emerald-300">
                    <Scale className="h-3.5 w-3.5" />
                    Đơn vị tính &amp; Quy đổi Định lượng tự động (Nhập ⇄ Kho ⇄ Bán)
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    VD: Nhập kho theo <strong>kg</strong> (1 kg = 1.000 gr), lưu kho theo <strong>gr</strong>, khi bán lẻ tự trừ đồng bộ.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: 'Chuẩn: 1 Cái', base: 'cái', pUnit: 'cái', pRate: '1', sUnit: 'cái', sRate: '1' },
                    { label: '1 Kg = 1.000 Gr', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'kg (1.000gr)', sRate: '1000' },
                    { label: 'Nhập Kg → Bán Gói 200gr', base: 'gr', pUnit: 'kg', pRate: '1000', sUnit: 'gói 200gr', sRate: '200' },
                    { label: '1 Lít = 1.000 Ml', base: 'ml', pUnit: 'lít', pRate: '1000', sUnit: 'chai 100ml', sRate: '100' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          baseUnit: preset.base,
                          purchaseUnit: preset.pUnit,
                          purchaseRate: preset.pRate,
                          sellUnit: preset.sUnit,
                          sellRate: preset.sRate,
                          type: Number(preset.pRate) > 1 && f.type === 'SIMPLE' ? 'WEIGHT_BULK' : f.type,
                        }))
                      }
                      className="rounded-full border border-emerald-300 bg-background px-2 py-0.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                <div className="space-y-1">
                  <Label className="text-[11px]">ĐVT Tồn gốc</Label>
                  <Input
                    value={form.baseUnit}
                    onChange={(e) => setForm((f) => ({ ...f, baseUnit: e.target.value }))}
                    placeholder="gr / cái"
                    className="h-8 bg-background text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">ĐVT Nhập kho</Label>
                  <Input
                    value={form.purchaseUnit}
                    onChange={(e) => setForm((f) => ({ ...f, purchaseUnit: e.target.value }))}
                    placeholder="kg / thùng"
                    className="h-8 bg-background text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">1 ĐV Nhập = ? Gốc</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.purchaseRate}
                    onChange={(e) => setForm((f) => ({ ...f, purchaseRate: e.target.value }))}
                    placeholder="1000"
                    className="h-8 bg-background font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">ĐVT Xuất bán</Label>
                  <Input
                    value={form.sellUnit}
                    onChange={(e) => setForm((f) => ({ ...f, sellUnit: e.target.value }))}
                    placeholder="gói / kg"
                    className="h-8 bg-background text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">1 ĐV Bán trừ ? Gốc</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.sellRate}
                    onChange={(e) => setForm((f) => ({ ...f, sellRate: e.target.value }))}
                    placeholder="1000"
                    className="h-8 bg-background font-mono text-xs"
                  />
                </div>
              </div>

              {(Number(form.purchaseRate) > 1 || Number(form.sellRate) > 1) && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/80 px-2.5 py-1.5 text-[11px]">
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">
                    Minh họa: Khi nhập <strong>10 {form.purchaseUnit || 'kg'}</strong> → Kho tự cộng{' '}
                    <strong>+{formatNumber(10 * (Number(form.purchaseRate) || 1))} {form.baseUnit || 'gr'}</strong>. Khi bán{' '}
                    <strong>1 {form.sellUnit || 'đơn vị'}</strong> → Tự trừ{' '}
                    <strong>-{formatNumber(Number(form.sellRate) || 1)} {form.baseUnit || 'gr'}</strong>.
                  </span>
                  {!editing && Number(form.purchaseRate) > 1 && (
                    <label className="flex cursor-pointer items-center gap-1.5 font-medium">
                      <Checkbox
                        checked={form.convertInitialStock}
                        onCheckedChange={(c) => setForm((f) => ({ ...f, convertInitialStock: c === true }))}
                      />
                      <span>Tồn ban đầu nhập theo {form.purchaseUnit} (nhân ×{form.purchaseRate})</span>
                    </label>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Danh mục sản phẩm</Label>
                <button
                  type="button"
                  onClick={() => setInlineCatOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066CC] hover:underline dark:text-sky-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {inlineCatOpen ? 'Đóng tạo nhanh' : 'Tạo danh mục mới'}
                </button>
              </div>
              {inlineCatOpen && (
                <div className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#0066CC]/40 bg-[#0066CC]/5 p-2">
                  <Input
                    value={inlineCatName}
                    onChange={(e) => setInlineCatName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleInlineCreateCategory()
                      }
                    }}
                    placeholder="Nhập tên danh mục mới (VD: Trầm hương)..."
                    className="h-8 flex-1 bg-background text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 bg-[#0066CC] px-2.5 text-xs text-white hover:bg-[#0055B3]"
                    disabled={inlineCatSaving || !inlineCatName.trim()}
                    onClick={() => void handleInlineCreateCategory()}
                  >
                    {inlineCatSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Lưu & Chọn'}
                  </Button>
                </div>
              )}
              <Select
                value={form.categoryId}
                onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn danh mục" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">— Không phân loại —</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="product-cost">Giá vốn (đ)</Label>
                  {Number(form.costPrice) > 0 && (
                    <span className="text-[11px] font-medium text-muted-foreground tabular-nums">
                      {formatVND(Number(form.costPrice))}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    id="product-cost"
                    type="number"
                    min={0}
                    step={1000}
                    value={form.costPrice}
                    onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                    placeholder="VD: 190000"
                  />
                  {Number(form.costPrice) > 0 && Number(form.costPrice) < 10000 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 shrink-0 px-2.5 font-mono text-xs font-bold text-[#0066CC] md:h-9"
                      title="Nhân 1.000 VNĐ"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          costPrice: String(Math.round(Number(f.costPrice) * 1000)),
                        }))
                      }
                    >
                      .000
                    </Button>
                  )}
                </div>
                {form.type === 'COMBO' && (
                  <p className="text-xs text-muted-foreground">Combo: giá vốn gộp tự tính từ thành phần.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="product-sell">
                    Giá bán (đ) <span className="text-destructive">*</span>
                  </Label>
                  {Number(form.sellPrice) > 0 && (
                    <span className="text-[11px] font-semibold text-[#0066CC] tabular-nums dark:text-sky-400">
                      {formatVND(Number(form.sellPrice))}
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Input
                    id="product-sell"
                    type="number"
                    min={0}
                    step={1000}
                    value={form.sellPrice}
                    onChange={(e) => setForm((f) => ({ ...f, sellPrice: e.target.value }))}
                    placeholder="VD: 390000"
                  />
                  {Number(form.sellPrice) > 0 && Number(form.sellPrice) < 10000 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-11 shrink-0 px-2.5 font-mono text-xs font-bold text-[#0066CC] md:h-9"
                      title="Nhân 1.000 VNĐ"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          sellPrice: String(Math.round(Number(f.sellPrice) * 1000)),
                        }))
                      }
                    >
                      .000
                    </Button>
                  )}
                </div>
                {Number(form.sellPrice) > 0 && Number(form.costPrice) > 0 && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                    Lãi gộp ước tính: {formatVND(Number(form.sellPrice) - Number(form.costPrice))} (
                    {Math.round(((Number(form.sellPrice) - Number(form.costPrice)) / Number(form.sellPrice)) * 100)}%)
                  </p>
                )}
              </div>
            </div>
            {form.type !== 'COMBO' && (
              <div className="space-y-1.5">
                <Label htmlFor="product-stock">
                  {editing ? `Tồn kho hiện tại (${form.baseUnit || 'đv'})` : 'Tồn kho ban đầu'}
                </Label>
                <Input
                  id="product-stock"
                  type="number"
                  min={0}
                  step={1}
                  value={form.stock}
                  onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="product-threshold">Ngưỡng cảnh báo tồn kho</Label>
              <Input
                id="product-threshold"
                type="number"
                min={0}
                step={1}
                value={form.lowStockThreshold}
                onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3 sm:col-span-2">
              <Switch
                id="product-status"
                checked={form.status === 'ACTIVE'}
                onCheckedChange={(checked) =>
                  setForm((f) => ({ ...f, status: checked ? 'ACTIVE' : 'INACTIVE' }))
                }
              />
              <div>
                <Label htmlFor="product-status">Đang bán</Label>
                <p className="text-xs text-muted-foreground">
                  Tắt để ngừng bán sản phẩm này trên mọi kênh
                </p>
              </div>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Kênh bán &amp; giá riêng theo kênh</Label>
                {editing && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSyncDescriptionFromForm()}
                    disabled={syncingDesc || editingListings.length === 0}
                    title="Đẩy mô tả sản phẩm (bản đã lưu) lên tất cả kênh đang bán"
                  >
                    <RefreshCw className={cn('mr-1.5 h-4 w-4', syncingDesc && 'animate-spin')} />
                    Đồng bộ mô tả ngay
                  </Button>
                )}
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-3">
                {channels.length === 0 ? (
                  <p className="py-2 text-center text-sm text-muted-foreground">
                    Không có kênh bán nào.
                  </p>
                ) : (
                  (() => {
                    const commonSell = Number(form.sellPrice)
                    const pricePlaceholder =
                      form.sellPrice.trim() !== '' && Number.isFinite(commonSell) && commonSell > 0
                        ? `Giá chung ${formatCompactVND(commonSell)}`
                        : 'Giá chung'
                    return channels.map((ch) => {
                      const checked = form.listingChannelIds.includes(ch.id)
                      const channelListing = editingListings.find((l) => l.channelId === ch.id)
                      return (
                        <div
                          key={ch.id}
                          className={cn(
                            'rounded-md px-1.5 py-1.5 hover:bg-muted/60',
                            !ch.connected && 'opacity-50'
                          )}
                        >
                          <div className="flex items-center gap-2.5">
                            <label
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2.5 text-sm',
                                ch.connected || checked ? 'cursor-pointer' : 'cursor-not-allowed'
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={!ch.connected && !checked}
                                onCheckedChange={(checkedState) => toggleChannel(ch.id, checkedState === true)}
                                aria-label={`Bán trên ${ch.name}`}
                              />
                              <ChannelBadge channel={ch} className="min-w-0 flex-1 truncate font-medium" />
                              {!ch.connected && (
                                <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
                                  {checked ? '(Đang chọn — Kênh đang tắt bán)' : '(Kênh đang tắt bán)'}
                                </span>
                              )}
                            </label>
                            <Input
                              className="h-9 w-32 shrink-0 text-right tabular-nums"
                              type="text"
                              inputMode="numeric"
                              placeholder={pricePlaceholder}
                              value={form.channelPrices[ch.id] ?? ''}
                              onChange={(e) => setChannelPrice(ch.id, e.target.value)}
                              disabled={!checked || !ch.connected}
                              aria-label={`Giá bán riêng trên ${ch.name} (bỏ trống để dùng giá chung)`}
                              title="Bỏ trống để dùng giá bán chung"
                            />
                          </div>
                          {editing && checked && channelListing && (
                            <ChannelDescStatus listing={channelListing} master={editing.description ?? null} />
                          )}
                        </div>
                      )
                    })
                  })()
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Chỉ có thể chọn kênh đã kết nối. Bỏ trống giá kênh để theo giá bán chung — đặt giá
                riêng khi bán khác giá trên từng kênh.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Hủy
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {editing ? 'Lưu thay đổi' : 'Thêm sản phẩm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận xóa */}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title={`Xóa sản phẩm "${deleting?.name ?? ''}"?`}
        description="Sản phẩm sẽ bị xóa vĩnh viễn khỏi hệ thống. Hành động này không thể hoàn tác."
        confirmText="Xóa sản phẩm"
        destructive
        loading={deleteLoading}
        onConfirm={() => void handleDelete()}
      />

      {/* Dialog in nhãn mã vạch */}
      <LabelPrintDialog open={printOpen} onOpenChange={setPrintOpen} products={printProducts} />

      {/* Dialog Xác nhận xóa Danh mục Sản phẩm (có tùy chọn chuyển SP sang danh mục khác) */}
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
            <Button
              variant="outline"
              disabled={deletingCatLoading}
              onClick={() => {
                setDeletingCat(null)
                setReassignCatId('NONE')
              }}
            >
              Hủy
            </Button>
            <Button
              variant="destructive"
              disabled={deletingCatLoading}
              onClick={() => void handleDeleteCategory()}
            >
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
            <DialogTitle>
              Gán sản phẩm vào danh mục &ldquo;{assignCatModal?.name}&rdquo;
            </DialogTitle>
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
              {(() => {
                const q = assignSearch.trim().toLowerCase()
                const list = products.filter((p) => {
                  if (assignOnlyUncategorized && p.categoryId && p.categoryId !== assignCatModal?.id) {
                    return false
                  }
                  if (!q) return true
                  return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
                })
                if (list.length === 0) {
                  return (
                    <p className="p-6 text-center text-xs text-muted-foreground">
                      Không có sản phẩm nào khớp bộ lọc.
                    </p>
                  )
                }
                return list.map((p) => {
                  const checked = selectedAssignProductIds.includes(p.id)
                  const otherCat = p.category && p.categoryId !== assignCatModal?.id ? p.category.name : null
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
                      {otherCat ? (
                        <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                          Đang ở: {otherCat}
                        </Badge>
                      ) : !p.categoryId ? (
                        <Badge variant="outline" className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          Chưa phân loại
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 border-emerald-300 bg-emerald-50 text-[10px] text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                          Trong danh mục này
                        </Badge>
                      )}
                    </label>
                  )
                })
              })()}
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

      {/* Dialog nhập CSV */}
      <Dialog
        open={importDialogOpen}
        onOpenChange={(open) => {
          setImportDialogOpen(open)
          if (!open) {
            setImportFile(null)
            setImportErrors([])
            setImportSuccessMessage(null)
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nhập danh mục sản phẩm từ CSV</DialogTitle>
            <DialogDescription>
              Tải lên tệp CSV chứa danh mục hàng hóa và bảng giá. Dữ liệu sẽ được kiểm tra nguyên tử: chỉ cập nhật khi 100% các dòng đều hợp lệ.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="csv-file-input">Chọn tệp CSV (.csv)</Label>
              <Input
                id="csv-file-input"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  setImportFile(e.target.files?.[0] ?? null)
                  setImportErrors([])
                  setImportSuccessMessage(null)
                }}
                disabled={importing}
              />
              <p className="text-xs text-muted-foreground">
                Cột bắt buộc: sku, name, costPrice, sellPrice, stock, unit, type. Hỗ trợ UTF-8 BOM tiếng Việt.
              </p>
            </div>

            {importSuccessMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                <p className="font-medium">{importSuccessMessage}</p>
              </div>
            )}

            {importErrors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-destructive">
                  Chi tiết {importErrors.length} lỗi phát hiện (Dữ liệu chưa lưu vào CSDL):
                </p>
                <div className="max-h-60 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Dòng</TableHead>
                        <TableHead className="w-32">Mã SKU</TableHead>
                        <TableHead className="w-28">Trường lỗi</TableHead>
                        <TableHead>Chi tiết lỗi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importErrors.map((err, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="font-mono text-xs">{err.row}</TableCell>
                          <TableCell className="font-mono text-xs">{err.sku || '—'}</TableCell>
                          <TableCell className="text-xs font-medium text-destructive">{err.field || '—'}</TableCell>
                          <TableCell className="text-xs">{err.message}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportDialogOpen(false)}
              disabled={importing}
            >
              Đóng
            </Button>
            <Button
              className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
              onClick={() => void handleImportSubmit()}
              disabled={!importFile || importing}
            >
              {importing ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Đang kiểm tra & nhập...
                </>
              ) : (
                <>
                  <Upload className="mr-1.5 h-4 w-4" /> Nhập dữ liệu
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Nhập kho Quy đổi Định lượng 1 chạm (VD: Nhập 10 kg -> +10.000 gr) */}
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
                      {pRate > 1 ? ` (≈ ${(quickImportProd.stock / pRate).toFixed(2)} ${pUnit})` : ''}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="quick-import-qty">
                        Số lượng nhập ({pUnit}) <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex gap-1">
                        {['1', '5', '10', '20', '50'].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setQuickImportQty(val)}
                            className={cn(
                              'rounded border px-2 py-0.5 text-xs font-semibold transition-colors',
                              quickImportQty === val
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'bg-background hover:bg-muted'
                            )}
                          >
                            {val} {pUnit}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Input
                      id="quick-import-qty"
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
                    <p className="mt-0.5 text-xs text-emerald-800/80 dark:text-emerald-300/80">
                      Tồn kho mới sau khi nhập:{' '}
                      <strong>
                        {formatNumber(quickImportProd.stock + convertedAdd)} {bUnit}
                      </strong>
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
    </div>
  )
}
