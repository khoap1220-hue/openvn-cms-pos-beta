'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Search,
  Trash2,
  Wand2,
} from 'lucide-react'

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api'
import { formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import type { Category, Channel, Product, ProductListing } from '@/lib/types'
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

export function ProductsView() {
  const { toast } = useToast()

  // ===== Danh sách sản phẩm + bộ lọc =====
  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [page, setPage] = useState(1)

  // ===== Meta data =====
  const [categories, setCategories] = useState<Category[]>([])
  const [channels, setChannels] = useState<Channel[]>([])

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
      const [catRes, chRes] = await Promise.all([
        apiGet<{ categories: Category[] }>('/api/categories'),
        apiGet<{ channels: Channel[] }>('/api/channels'),
      ])
      setCategories(catRes.categories)
      setChannels(chRes.channels)
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

  // ===== Phân trang client-side =====
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pagedProducts = useMemo(
    () => products.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [products, currentPage]
  )
  const hasFilter = search !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL'

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
      listingChannelIds: (p.listings ?? []).map((l) => l.channelId),
      channelPrices: prices,
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
      return { channelId, price: raw ? Number(raw) : null }
    })
    setSaving(true)
    try {
      const base = {
        type: form.type,
        sku: form.sku.trim(),
        name: form.name.trim(),
        description: form.description.trim(),
        categoryId: form.categoryId === 'NONE' ? null : form.categoryId,
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
        await apiPut<{ product: ProductRow }>(`/api/products/${editing.id}`, base)
        toast({ title: 'Đã cập nhật sản phẩm', description: base.name })
      } else {
        await apiPost<{ product: Product }>('/api/products', { ...base, stock: Number(form.stock) || 0 })
        toast({ title: 'Đã thêm sản phẩm mới', description: base.name })
      }
      setDialogOpen(false)
      void fetchProducts()
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
      <PageHeader title="Sản phẩm" description="Quản lý sản phẩm và kênh phân phối đa kênh">
        <Button variant="outline" onClick={() => openPrintDialog(products)}>
          <Barcode className="mr-1.5 h-4 w-4" /> In nhãn mã vạch
        </Button>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Thêm sản phẩm
        </Button>
      </PageHeader>

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
      ) : products.length === 0 ? (
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
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead>Danh mục</TableHead>
                  <TableHead>Mã vạch</TableHead>
                  <TableHead>Giá bán</TableHead>
                  <TableHead>Tồn kho</TableHead>
                  <TableHead>Kênh bán</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="w-12 text-right">
                    <span className="sr-only">Hành động</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedProducts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ProductAvatar name={p.name} image={p.image} />
                        <div className="min-w-0">
                          <p className="flex max-w-[220px] items-center gap-1.5 font-medium">
                            <span className="truncate">{p.name}</span>
                            {p.type === 'COMBO' && <ComboBadge />}
                          </p>
                          <p className="text-xs text-muted-foreground">{p.sku}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{p.category?.name ?? '—'}</TableCell>
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
                    <TableCell className="whitespace-nowrap text-sm">{formatVND(p.sellPrice)}</TableCell>
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
                            {p.stock === 0 ? 'Hết hàng' : `Còn ${p.stock}`}
                          </Badge>
                          <p className="text-xs text-muted-foreground">Ngưỡng {p.lowStockThreshold}</p>
                        </div>
                      ) : (
                        <span className="text-sm">{formatNumber(p.stock)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[220px] flex-wrap gap-x-3 gap-y-1">
                        {(p.listings ?? []).length > 0 ? (
                          (p.listings ?? []).map((l) => {
                            const priceTitle =
                              l.price != null ? `Giá riêng: ${formatVND(l.price)}` : 'Theo giá bán chung'
                            const descTitle = l.descriptionSyncedAt
                              ? `Mô tả: đã đồng bộ ${formatDateTime(l.descriptionSyncedAt)}`
                              : 'Mô tả: chưa đồng bộ'
                            return (
                              <span
                                key={l.id}
                                title={`${priceTitle}\n${descTitle}`}
                                className="inline-flex min-w-0 items-center gap-1"
                              >
                                <ChannelBadge channel={l.channel} className="min-w-0 text-xs" />
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
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
                            <Pencil className="mr-2 h-4 w-4" /> Sửa
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
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phân trang client-side */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              Hiển thị {formatNumber((currentPage - 1) * PAGE_SIZE + 1)}–
              {formatNumber(Math.min(currentPage * PAGE_SIZE, products.length))} trong{' '}
              {formatNumber(products.length)} sản phẩm
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
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                <SelectTrigger id="product-type" className="w-full">
                  <SelectValue placeholder="Chọn loại sản phẩm" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SIMPLE">Sản phẩm thường</SelectItem>
                  <SelectItem value="COMBO">Combo · Set quà tặng (gộp nhiều thành phẩm)</SelectItem>
                </SelectContent>
              </Select>
              {form.type === 'COMBO' && (
                <p className="text-xs text-violet-600 dark:text-violet-400">
                  Xuất bán sẽ tự trừ kho các sản phẩm thành phần khai báo ở mục Kho &amp; Định mức — giá vốn gộp tính
                  tự động.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Danh mục</Label>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="product-cost">Giá vốn (đ)</Label>
                <Input
                  id="product-cost"
                  type="number"
                  min={0}
                  step={1000}
                  value={form.costPrice}
                  onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                  placeholder="0"
                />
                {form.type === 'COMBO' && (
                  <p className="text-xs text-muted-foreground">Combo: giá vốn gộp tự tính từ thành phần.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-sell">
                  Giá bán (đ) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="product-sell"
                  type="number"
                  min={0}
                  step={1000}
                  value={form.sellPrice}
                  onChange={(e) => setForm((f) => ({ ...f, sellPrice: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="product-stock">Tồn kho ban đầu</Label>
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
                                ch.connected ? 'cursor-pointer' : 'cursor-not-allowed'
                              )}
                            >
                              <Checkbox
                                checked={checked}
                                disabled={!ch.connected}
                                onCheckedChange={(checkedState) => toggleChannel(ch.id, checkedState === true)}
                                aria-label={`Bán trên ${ch.name}`}
                              />
                              <ChannelBadge channel={ch} className="min-w-0 flex-1 truncate font-medium" />
                              {!ch.connected && (
                                <span className="shrink-0 text-xs text-muted-foreground">(Chưa kết nối)</span>
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
    </div>
  )
}
