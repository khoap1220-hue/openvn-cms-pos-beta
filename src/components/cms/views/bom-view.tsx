'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatAttributesReadable, formatNumber, formatVND } from '@/lib/format'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { FastStockTerminal } from './fast-stock-terminal'
import { WarehouseModuleNav } from '@/components/cms/warehouse-module-nav'
import type { ViewId } from '@/components/cms/app-sidebar'
import {
  Boxes,
  Gift,
  Layers,
  ListTree,
  Loader2,
  PackageSearch,
  Plus,
  Save,
  Search,
  Tags,
  Trash2,
  X,
} from 'lucide-react'

interface ProductLite {
  id: string
  sku: string
  name: string
  unit: string | null
  costPrice: number
  sellPrice: number
  stock: number
  attributes: string | null
  type?: string
}

interface BomComponentProduct {
  id: string
  sku: string
  name: string
  unit: string
  stock: number
  costPrice: number
}

interface BomComponent {
  quantity: number
  componentProduct: BomComponentProduct
}

interface BomGroup {
  productId: string
  productSku: string
  productName: string
  unit: string
  stock: number
  components: BomComponent[]
}

interface BomRow {
  componentProductId: string
  quantity: string
}

const ATTR_PLACEHOLDER = 'Size M; Lụa; Màu trắng'

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

export function BomView({ onNavigate }: { onNavigate?: (view: ViewId) => void } = {}) {
  const [activeSection, setActiveSection] = useState<'PRODUCTION' | 'BOM_SETUP'>('PRODUCTION')
  const [groups, setGroups] = useState<BomGroup[] | null>(null)
  const [products, setProducts] = useState<ProductLite[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogProductId, setDialogProductId] = useState('')
  const [rows, setRows] = useState<BomRow[]>([])
  const [submitting, setSubmitting] = useState(false)

  const [attrSearch, setAttrSearch] = useState('')
  const [attrEdits, setAttrEdits] = useState<Record<string, { attributes: string; unit: string }>>({})
  const [savingAttrId, setSavingAttrId] = useState<string | null>(null)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [bomRes, productsRes] = await Promise.all([
        apiGet<{ groups: BomGroup[] }>('/api/bom'),
        apiGet<{ products: ProductLite[] }>('/api/products?status=ACTIVE'),
      ])
      setGroups(bomRes.groups)
      setProducts(productsRes.products)
      setSelectedId((prev) => prev ?? bomRes.groups[0]?.productId ?? null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải dữ liệu kho & định mức'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selectedGroup = useMemo(
    () => (groups ?? []).find((g) => g.productId === selectedId) ?? null,
    [groups, selectedId]
  )
  const selectedProduct = useMemo(
    () => (products ?? []).find((p) => p.id === selectedId) ?? null,
    [products, selectedId]
  )

  // Map loại sản phẩm (SIMPLE/COMBO) theo productId — group BOM không trả type nên tra từ danh sách products
  const productTypeById = useMemo(() => {
    const map = new Map<string, string>()
    ;(products ?? []).forEach((p) => map.set(p.id, p.type ?? 'SIMPLE'))
    return map
  }, [products])
  const selectedIsCombo = productTypeById.get(selectedId ?? '') === 'COMBO'
  const dialogIsCombo = productTypeById.get(dialogProductId) === 'COMBO'

  const totalBomCost = useMemo(
    () =>
      (selectedGroup?.components ?? []).reduce(
        (sum, c) => sum + c.componentProduct.costPrice * c.quantity,
        0
      ),
    [selectedGroup]
  )
  const finishedCost = selectedProduct?.costPrice ?? 0
  const bomMargin = finishedCost - totalBomCost

  const openConfig = (productId?: string) => {
    const targetId = productId ?? selectedId ?? ''
    const existing = (groups ?? []).find((g) => g.productId === targetId)
    setDialogProductId(targetId)
    setRows(
      existing && existing.components.length > 0
        ? existing.components.map((c) => ({ componentProductId: c.componentProduct.id, quantity: String(c.quantity) }))
        : [{ componentProductId: '', quantity: '' }]
    )
    setDialogOpen(true)
  }

  const addRow = () => setRows((prev) => [...prev, { componentProductId: '', quantity: '' }])

  const updateRow = (index: number, patch: Partial<BomRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const handleSaveBom = async () => {
    if (!dialogProductId) {
      toast({ title: 'Vui lòng chọn thành phẩm', variant: 'destructive' })
      return
    }
    const items: Array<{ componentProductId: string; quantity: number }> = []
    for (const row of rows) {
      const qty = Number(row.quantity)
      if (!row.componentProductId) {
        toast({
          title: dialogIsCombo ? 'Vui lòng chọn thành phần cho mọi dòng' : 'Vui lòng chọn nguyên vật liệu cho mọi dòng',
          variant: 'destructive',
        })
        return
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        toast({ title: 'Định mức phải là số lớn hơn 0', variant: 'destructive' })
        return
      }
      items.push({ componentProductId: row.componentProductId, quantity: qty })
    }
    if (items.length === 0) {
      toast({
        title: dialogIsCombo ? 'Cần ít nhất 1 thành phần trong combo' : 'Cần ít nhất 1 nguyên vật liệu trong định mức',
        variant: 'destructive',
      })
      return
    }
    setSubmitting(true)
    try {
      await apiPost('/api/bom', { productId: dialogProductId, items })
      toast({
        title: dialogIsCombo ? 'Đã lưu thành phần combo' : 'Đã lưu định mức BOM',
        description: dialogIsCombo
          ? 'Thành phần thay thế toàn bộ cấu hình cũ — tồn combo và giá vốn gộp đã được đồng bộ tự động.'
          : 'Định mức mới thay thế toàn bộ cấu hình cũ. Xuất bán thành phẩm sẽ tự trừ VLT.',
      })
      setDialogOpen(false)
      setSelectedId(dialogProductId)
      await load()
    } catch (e) {
      toast({
        title: 'Lưu định mức thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const getAttrEdit = (p: ProductLite) =>
    attrEdits[p.id] ?? { attributes: formatAttributesReadable(p.attributes).text, unit: p.unit ?? '' }

  const setAttrEdit = (p: ProductLite, patch: Partial<{ attributes: string; unit: string }>) =>
    setAttrEdits((prev) => ({
      ...prev,
      [p.id]: {
        ...(prev[p.id] ?? { attributes: formatAttributesReadable(p.attributes).text, unit: p.unit ?? '' }),
        ...patch,
      },
    }))

  const attrDirty = (p: ProductLite) => {
    const edit = attrEdits[p.id]
    if (!edit) return false
    return edit.attributes !== formatAttributesReadable(p.attributes).text || edit.unit !== (p.unit ?? '')
  }

  const handleSaveAttr = async (p: ProductLite) => {
    const edit = getAttrEdit(p)
    setSavingAttrId(p.id)
    try {
      await apiPatch('/api/product-attributes', {
        id: p.id,
        attributes: edit.attributes.trim() || null,
        unit: edit.unit.trim() || null,
      })
      toast({ title: 'Đã lưu thuộc tính', description: `${p.name} — ĐẶC TÍNH & đơn vị tính cập nhật` })
      setAttrEdits((prev) => {
        const next = { ...prev }
        delete next[p.id]
        return next
      })
      await load()
    } catch (e) {
      toast({
        title: 'Lưu thuộc tính thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingAttrId(null)
    }
  }

  const attrQuery = attrSearch.trim().toLowerCase()
  const attrRows = (products ?? [])
    .filter((p) => !attrQuery || p.name.toLowerCase().includes(attrQuery) || p.sku.toLowerCase().includes(attrQuery))
    .slice(0, 20)

  return (
    <div>
      <WarehouseModuleNav active="bom" onNavigate={onNavigate} />

      <PageHeader
        title="Sản xuất & Định mức (BOM)"
        description="Lập phiếu sản xuất thành phẩm (tự động trừ nguyên vật liệu theo định mức và cộng kho thành phẩm) & quản lý công thức định mức (BOM)"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => setActiveSection('PRODUCTION')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                activeSection === 'PRODUCTION'
                  ? 'bg-[#0066CC] text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Boxes className="h-3.5 w-3.5" />
              1. Lập phiếu sản xuất thành phẩm
            </button>
            <button
              type="button"
              onClick={() => setActiveSection('BOM_SETUP')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                activeSection === 'BOM_SETUP'
                  ? 'bg-[#0066CC] text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <ListTree className="h-3.5 w-3.5" />
              2. Công thức Định mức (BOM) &amp; Combo ({groups?.length ?? 0})
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => openConfig()}>
            <Plus className="h-4 w-4" />
            Cấu hình định mức
          </Button>
        </div>
      </PageHeader>

      {activeSection === 'PRODUCTION' ? (
        <div className="mb-8">
          <FastStockTerminal
            defaultMode="PRODUCTION"
            allowedModes={['PRODUCTION']}
            onCompleted={() => void load()}
          />
        </div>
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
            {/* Danh sách thành phẩm có định mức */}
            <div className="lg:col-span-2">
              <Card className="border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListTree className="h-5 w-5 text-amber-500" />
                    Thành phẩm có định mức
                  </CardTitle>
                  <CardDescription>{groups?.length ?? 0} sản phẩm đã cấu hình BOM</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {loading ? (
                    <div className="p-4">
                      <TableSkeleton rows={4} />
                    </div>
                  ) : !groups || groups.length === 0 ? (
                    <div className="p-4">
                      <EmptyState
                        icon={Layers}
                        title="Chưa có định mức nào"
                        description="Cấu hình định mức để tự động trừ nguyên vật liệu khi bán thành phẩm."
                        action={
                          <Button onClick={() => openConfig()}>
                            <Plus className="h-4 w-4" />
                            Cấu hình định mức
                          </Button>
                        }
                      />
                    </div>
                  ) : (
                    <div className="max-h-96 space-y-2 overflow-y-auto p-3">
                      {groups.map((g) => (
                        <button
                          key={g.productId}
                          type="button"
                          onClick={() => setSelectedId(g.productId)}
                          className={cn(
                            'w-full rounded-xl border p-3 text-left transition-colors',
                            g.productId === selectedId
                              ? 'border-primary bg-primary/5'
                              : 'border-border/70 hover:bg-muted/60'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 font-medium">
                                <span className="truncate">{g.productName}</span>
                                {productTypeById.get(g.productId) === 'COMBO' && <ComboBadge />}
                              </p>
                              <p className="font-mono text-xs text-muted-foreground">{g.productSku}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className="shrink-0 border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
                            >
                              Tồn {formatNumber(g.stock)}
                            </Badge>
                          </div>
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {g.components.length}{' '}
                            {productTypeById.get(g.productId) === 'COMBO'
                              ? 'thành phần combo'
                              : 'nguyên vật liệu trong định mức'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Chi tiết định mức của thành phẩm đang chọn */}
            <div className="lg:col-span-3">
              <Card className="border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                    <span className="flex items-center gap-2">
                      {selectedIsCombo ? (
                        <Gift className="h-5 w-5 text-violet-500" />
                      ) : (
                        <Boxes className="h-5 w-5 text-sky-500" />
                      )}
                      {selectedGroup
                        ? `${selectedIsCombo ? 'Thành phần combo' : 'Định mức'} — ${selectedGroup.productName}`
                        : 'Chi tiết định mức'}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => openConfig()}>
                      <Plus className="h-4 w-4" />
                      Cấu hình định mức
                    </Button>
                  </CardTitle>
                  {selectedGroup && (
                    <CardDescription>
                      {selectedIsCombo
                        ? 'Combo xuất bán sẽ tự trừ kho từng thành phần theo số lượng dưới đây; giá vốn gộp = Σ giá vốn thành phần × định mức.'
                        : `Mỗi 1 ${selectedGroup.unit} ${selectedGroup.productName} xuất bán sẽ tự trừ các VLT bên dưới`}
                    </CardDescription>
                  )}
                </CardHeader>
                <CardContent className="p-0">
                  {loading ? (
                    <div className="p-4">
                      <TableSkeleton rows={4} />
                    </div>
                  ) : !selectedGroup || selectedGroup.components.length === 0 ? (
                    <div className="p-4">
                      <EmptyState
                        icon={Boxes}
                        title="Chưa chọn thành phẩm hoặc chưa có định mức"
                        description="Chọn một thành phẩm bên trái hoặc tạo định mức mới."
                      />
                    </div>
                  ) : (
                    <>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="font-mono">
                                {selectedIsCombo ? 'Mã thành phần' : 'Mã VLT'}
                              </TableHead>
                              <TableHead>{selectedIsCombo ? 'Tên thành phần' : 'Tên nguyên vật liệu'}</TableHead>
                              <TableHead className="text-right">
                                {selectedIsCombo ? `Định mức/${selectedGroup?.unit ?? 'bộ'}` : 'Định mức/sp'}
                              </TableHead>
                              <TableHead className="text-right">{selectedIsCombo ? 'Tồn thành phần' : 'Tồn VLT'}</TableHead>
                              <TableHead className="text-right">{selectedIsCombo ? 'Vốn thành phần' : 'Vốn VLT'}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedGroup.components.map((c) => (
                              <TableRow key={c.componentProduct.id}>
                                <TableCell className="whitespace-nowrap font-mono text-xs">
                                  {c.componentProduct.sku}
                                </TableCell>
                                <TableCell>
                                  <p className="max-w-[200px] truncate font-medium">{c.componentProduct.name}</p>
                                  <p className="text-xs text-muted-foreground">{c.componentProduct.unit}</p>
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {formatNumber(c.quantity)} {c.componentProduct.unit}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'whitespace-nowrap text-right tabular-nums',
                                    c.componentProduct.stock <= 0 && 'font-semibold text-rose-600 dark:text-rose-400'
                                  )}
                                >
                                  {formatNumber(c.componentProduct.stock)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-right tabular-nums">
                                  {formatVND(c.componentProduct.costPrice * c.quantity)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4">
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {selectedIsCombo ? 'Giá vốn gộp 1 combo' : 'Tổng vốn định mức / sp'}
                          </p>
                          <p className="text-lg font-bold tabular-nums">{formatVND(totalBomCost)}</p>
                        </div>
                        <div
                          className={cn(
                            'rounded-xl border px-4 py-2 text-right',
                            bomMargin > 0
                              ? 'border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/30'
                              : bomMargin === 0
                                ? 'border-border bg-muted/50'
                                : 'border-rose-200/70 bg-rose-50/60 dark:border-rose-900/50 dark:bg-rose-950/30'
                          )}
                        >
                          <p className="text-xs text-muted-foreground">
                            {bomMargin > 0
                              ? selectedIsCombo
                                ? 'Lãi gộp / bộ'
                                : 'Lãi định mức / sp'
                              : bomMargin === 0
                                ? selectedIsCombo
                                  ? 'Giá vốn khớp'
                                  : 'Cân bằng định mức'
                                : selectedIsCombo
                                  ? 'Giá vốn TP chưa khớp'
                                  : 'Vượt vốn định mức'}
                          </p>
                          <p
                            className={cn(
                              'text-lg font-bold tabular-nums',
                              bomMargin > 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : bomMargin === 0
                                  ? 'text-muted-foreground'
                                  : 'text-rose-700 dark:text-rose-400'
                            )}
                          >
                            {bomMargin > 0 ? '+' : ''}
                            {formatVND(bomMargin)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {selectedIsCombo ? 'Giá vốn combo (tự đồng bộ): ' : 'Giá vốn TP: '}
                            {formatVND(finishedCost)}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Thuộc tính sản phẩm */}
          <Card className="mt-4 border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Tags className="h-5 w-5 text-violet-500" />
                Thuộc tính sản phẩm (ĐẶC TÍNH)
              </CardTitle>
              <CardDescription>
                Gợi ý viết: &quot;{ATTR_PLACEHOLDER}&quot; — phân tách bằng dấu chấm phẩy, hiển thị trên hóa đơn & phiếu kho
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-3 border-b p-4">
                <div className="relative w-full max-w-xs">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={attrSearch}
                    onChange={(e) => setAttrSearch(e.target.value)}
                    placeholder="Tìm sản phẩm theo tên hoặc mã..."
                    className="pl-8"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Hiển thị tối đa 20 dòng — sửa trực tiếp rồi bấm Lưu</p>
              </div>
              {loading ? (
                <div className="p-4">
                  <TableSkeleton rows={5} />
                </div>
              ) : attrRows.length === 0 ? (
                <div className="p-4">
                  <EmptyState icon={PackageSearch} title="Không tìm thấy sản phẩm" description="Thử từ khóa khác." />
                </div>
              ) : (
                <div className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead className="font-mono">Mã SP</TableHead>
                        <TableHead>Tên sản phẩm</TableHead>
                        <TableHead className="w-24">Đơn vị</TableHead>
                        <TableHead>ĐẶC TÍNH</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {attrRows.map((p) => {
                        const edit = getAttrEdit(p)
                        const dirty = attrDirty(p)
                        const parsedAttr = formatAttributesReadable(edit.attributes || p.attributes)
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{p.sku}</TableCell>
                            <TableCell>
                              <p className="min-w-[200px] max-w-[320px] font-medium leading-snug" title={p.name}>
                                {p.name}
                              </p>
                            </TableCell>
                            <TableCell>
                              <Input
                                value={edit.unit}
                                onChange={(e) => setAttrEdit(p, { unit: e.target.value })}
                                placeholder="cái"
                                className="h-8 w-20 text-sm"
                              />
                            </TableCell>
                            <TableCell>
                              <div className="space-y-1.5">
                                {parsedAttr.tags.length > 0 && (
                                  <div className="flex flex-wrap gap-1">
                                    {parsedAttr.tags.map((tag, idx) => (
                                      <Badge
                                        key={idx}
                                        variant="secondary"
                                        className="px-1.5 py-0 text-[10.5px] font-normal text-foreground/85"
                                      >
                                        {tag}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                                <Input
                                  value={edit.attributes}
                                  onChange={(e) => setAttrEdit(p, { attributes: e.target.value })}
                                  placeholder={ATTR_PLACEHOLDER}
                                  className="h-8 text-sm"
                                />
                              </div>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="icon"
                                variant={dirty ? 'default' : 'ghost'}
                                className="h-8 w-8"
                                disabled={!dirty || savingAttrId !== null}
                                onClick={() => void handleSaveAttr(p)}
                                title="Lưu thuộc tính"
                              >
                                {savingAttrId === p.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Save className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Dialog cấu hình định mức BOM */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{dialogIsCombo ? 'Cấu hình thành phần combo' : 'Cấu hình định mức (BOM)'}</DialogTitle>
            <DialogDescription>
              {dialogIsCombo
                ? 'Thành phần combo sẽ thay thế toàn bộ cấu hình cũ — combo xuất bán tự trừ kho từng thành phần; tồn combo và giá vốn gộp được đồng bộ tự động.'
                : 'Định mức sẽ thay thế toàn bộ cấu hình cũ của thành phẩm. Mỗi dòng là 1 nguyên vật liệu trừ theo số lượng thành phẩm xuất.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="bom-product">
                Thành phẩm <span className="text-destructive">*</span>
              </Label>
              <Select
                value={dialogProductId || undefined}
                onValueChange={(value) => setDialogProductId(value)}
              >
                <SelectTrigger id="bom-product" className="w-full">
                  <SelectValue placeholder="Chọn thành phẩm" />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-1.5">
                        <span>
                          {p.sku} — {p.name} (tồn {formatNumber(p.stock)})
                        </span>
                        {p.type === 'COMBO' && <ComboBadge />}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {dialogIsCombo && (
                <p className="text-xs text-violet-600 dark:text-violet-400">
                  Sản phẩm này là COMBO — các dòng dưới đây là thành phần cấu thành bộ combo.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>{dialogIsCombo ? 'Thành phần combo & định mức' : 'Nguyên vật liệu & định mức'}</Label>
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={row.componentProductId || undefined}
                    onValueChange={(value) => updateRow(index, { componentProductId: value })}
                  >
                    <SelectTrigger className="min-w-[220px] flex-1">
                      <SelectValue placeholder={dialogIsCombo ? 'Chọn thành phần combo' : 'Chọn nguyên vật liệu'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(products ?? [])
                        .filter((p) => p.id !== dialogProductId)
                        .map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.sku} — {p.name} (tồn {formatNumber(p.stock)})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step={0.5}
                    min={0.1}
                    value={row.quantity}
                    onChange={(e) => updateRow(index, { quantity: e.target.value })}
                    placeholder="Định mức"
                    className="w-28"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(index)}
                    disabled={rows.length === 1}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addRow}>
                <Plus className="h-4 w-4" />
                {dialogIsCombo ? 'Thêm thành phần' : 'Thêm nguyên liệu'}
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSaveBom()} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              Lưu định mức
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
