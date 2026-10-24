'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber } from '@/lib/format'
import { MOVEMENT_TYPE_LABELS, type Product, type StockMovement } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Loader2,
  PackagePlus,
  ScanLine,
  Warehouse,
} from 'lucide-react'

import { BarcodeScanner } from '@/components/cms/barcode-scanner'

type LowStockProduct = Pick<
  Product,
  'id' | 'sku' | 'name' | 'stock' | 'lowStockThreshold' | 'sellPrice' | 'image'
>

/** Product của lib/types chưa có barcode — mở rộng cục bộ cho đến khi lib cập nhật */
type ProductWithBarcode = Product & { barcode?: string | null }

type MovementType = 'IMPORT' | 'EXPORT' | 'ADJUST'

const MOVEMENT_TYPE_OPTIONS: MovementType[] = ['IMPORT', 'EXPORT', 'ADJUST']

const MOVEMENT_BADGE_CLASSES: Record<string, string> = {
  IMPORT: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  EXPORT: 'border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  ADJUST: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
}

interface MovementFormState {
  productId: string
  type: MovementType
  quantity: string
  note: string
}

const EMPTY_MOVEMENT_FORM: MovementFormState = { productId: '', type: 'IMPORT', quantity: '', note: '' }

export function InventoryView() {
  const [lowStock, setLowStock] = useState<LowStockProduct[] | null>(null)
  const [movements, setMovements] = useState<StockMovement[] | null>(null)
  const [products, setProducts] = useState<ProductWithBarcode[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const qtyInputRef = useRef<HTMLInputElement | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<MovementFormState>(EMPTY_MOVEMENT_FORM)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [lowStockRes, movementsRes, productsRes] = await Promise.all([
        apiGet<{ products: ProductWithBarcode[] }>('/api/inventory?view=lowstock'),
        apiGet<{ movements: StockMovement[] }>('/api/inventory?view=movements'),
        apiGet<{ products: ProductWithBarcode[] }>('/api/products'),
      ])
      setLowStock(lowStockRes.products)
      setMovements(movementsRes.movements)
      setProducts(productsRes.products)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải dữ liệu kho'
      setError(message)
      toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const selectedProduct = useMemo(
    () => products?.find((p) => p.id === form.productId) ?? null,
    [products, form.productId]
  )

  const qtyNum = Number(form.quantity)
  const hasQty = form.quantity !== '' && !Number.isNaN(qtyNum) && Number.isFinite(qtyNum)

  // Preview tồn kho sau thao tác
  const preview = useMemo(() => {
    if (!selectedProduct || !hasQty) return null
    const current = selectedProduct.stock
    if (form.type === 'IMPORT') return { current, next: current + qtyNum, delta: qtyNum }
    if (form.type === 'EXPORT') return { current, next: current - qtyNum, delta: -qtyNum }
    return { current, next: qtyNum, delta: qtyNum - current }
  }, [selectedProduct, form.type, qtyNum, hasQty])

  const submitDisabled =
    !form.productId ||
    !hasQty ||
    (form.type !== 'ADJUST' && qtyNum <= 0) ||
    (form.type === 'EXPORT' && preview !== null && preview.next < 0)

  const openDialog = useCallback((prefill?: { productId: string; type: MovementType }) => {
    setForm(prefill ? { ...EMPTY_MOVEMENT_FORM, productId: prefill.productId, type: prefill.type } : EMPTY_MOVEMENT_FORM)
    setDialogOpen(true)
  }, [])

  // Quét mã vạch → tự mở phiếu nhập/xuất cho sản phẩm tương ứng
  const handleBarcodeScan = useCallback(
    async (code: string) => {
      // Ưu tiên tra trong state đã tải; không thấy thì hỏi server theo barcode chính xác
      let found = (products ?? []).find((p) => p.barcode === code) ?? null
      if (!found) {
        try {
          const res = await apiGet<{ products: ProductWithBarcode[] }>(
            `/api/products?barcode=${encodeURIComponent(code)}`
          )
          found = res.products[0] ?? null
        } catch {
          found = null
        }
      }
      if (!found) {
        toast({ title: `Không tìm thấy sản phẩm với mã vạch ${code}`, variant: 'destructive' })
        return
      }
      const product = found
      // Nếu SP tra từ server chưa có trong state, bổ sung để Select hiển thị đúng
      setProducts((prev) => (prev && !prev.some((p) => p.id === product.id) ? [...prev, product] : prev))
      openDialog({ productId: product.id, type: 'IMPORT' })
      toast({ title: `Đã chọn sản phẩm ${product.sku} — ${product.name}` })
      setTimeout(() => qtyInputRef.current?.focus(), 100)
    },
    [products, openDialog, toast]
  )

  const handleSubmit = async () => {
    if (!form.productId) {
      toast({ title: 'Vui lòng chọn sản phẩm', variant: 'destructive' })
      return
    }
    if (!hasQty) {
      toast({ title: 'Vui lòng nhập số lượng', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      await apiPost<{ movement: StockMovement }>('/api/inventory', {
        productId: form.productId,
        type: form.type,
        quantity: qtyNum,
        note: form.note.trim() || undefined,
      })
      toast({
        title: `Đã ${MOVEMENT_TYPE_LABELS[form.type].toLowerCase()} thành công`,
        description: selectedProduct ? `${selectedProduct.name} — ${MOVEMENT_TYPE_LABELS[form.type]}` : undefined,
      })
      setDialogOpen(false)
      setForm(EMPTY_MOVEMENT_FORM)
      await load()
    } catch (e) {
      toast({
        title: 'Thao tác kho thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader title="Tồn kho" description="Theo dõi tồn kho, nhập - xuất hàng và lịch sử biến động">
        <Button onClick={() => openDialog()}>
          <PackagePlus className="h-4 w-4" />
          Thao tác kho
        </Button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Sản phẩm sắp hết hàng"
          value={loading ? '' : formatNumber(lowStock?.length ?? 0)}
          icon={AlertTriangle}
          loading={loading}
          iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
          hint="Tồn kho đã chạm ngưỡng tối thiểu"
        />
        <StatCard
          title="Biến động kho gần nhất"
          value={loading ? '' : formatNumber(movements?.length ?? 0)}
          icon={ArrowLeftRight}
          loading={loading}
          hint="60 bản ghi mới nhất"
        />
      </div>

      {/* Quét mã vạch nhanh */}
      <Card className="mb-6 border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScanLine className="h-5 w-5 text-emerald-500" />
            Quét mã vạch nhanh
          </CardTitle>
          <CardDescription>Dùng bút quét USB hoặc camera — quét xong tự chọn sản phẩm cho phiếu kho</CardDescription>
        </CardHeader>
        <CardContent>
          <BarcodeScanner
            onScan={(code) => void handleBarcodeScan(code)}
            hint="Quét mã vạch → tự mở phiếu nhập/xuất cho sản phẩm tương ứng"
          />
        </CardContent>
      </Card>

      {/* Panel cảnh báo tồn kho thấp */}
      <Card className="mb-6 border-amber-200/70 shadow-sm dark:border-amber-900/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Cảnh báo tồn kho thấp
          </CardTitle>
          <CardDescription>Các sản phẩm đã chạm hoặc xuống dưới ngưỡng tồn tối thiểu, cần nhập thêm hàng</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={3} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load()} />
          ) : !lowStock || lowStock.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Tồn kho ổn định"
              description="Tất cả sản phẩm đều đang trên ngưỡng tồn tối thiểu."
            />
          ) : (
            <div className="max-h-96 divide-y overflow-y-auto">
              {lowStock.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <ProductAvatar name={p.name} image={p.image} className="h-9 w-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                      Còn {formatNumber(p.stock)}
                    </Badge>
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      / ngưỡng {formatNumber(p.lowStockThreshold)}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => openDialog({ productId: p.id, type: 'IMPORT' })}>
                      <PackagePlus className="h-4 w-4" />
                      Nhập thêm
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lịch sử biến động kho */}
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Warehouse className="h-5 w-5 text-primary" />
            Lịch sử biến động kho
          </CardTitle>
          <CardDescription>Ghi nhận nhập kho, xuất kho và điều chỉnh kiểm kê</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : !movements || movements.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ArrowLeftRight}
                title="Chưa có biến động kho nào"
                description="Thao tác nhập, xuất hoặc điều chỉnh kho sẽ được ghi nhận tại đây."
                action={
                  <Button onClick={() => openDialog()}>
                    <PackagePlus className="h-4 w-4" />
                    Thao tác kho
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Sản phẩm</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">Số lượng</TableHead>
                    <TableHead className="text-right">Tồn sau</TableHead>
                    <TableHead className="hidden lg:table-cell">Ghi chú</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDateTime(m.createdAt)}
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[200px] truncate font-medium">{m.product?.name ?? 'Sản phẩm đã xóa'}</p>
                        <p className="font-mono text-xs text-muted-foreground">{m.product?.sku ?? '—'}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('border-transparent', MOVEMENT_BADGE_CLASSES[m.type])}>
                          {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'whitespace-nowrap text-right font-semibold',
                          m.quantity > 0 && 'text-emerald-600 dark:text-emerald-400',
                          m.quantity < 0 && 'text-red-600 dark:text-red-400',
                          m.quantity === 0 && 'text-muted-foreground'
                        )}
                      >
                        {m.quantity > 0 ? '+' : ''}
                        {formatNumber(m.quantity)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">{formatNumber(m.stockAfter)}</TableCell>
                      <TableCell className="hidden max-w-[220px] lg:table-cell">
                        <span className="block truncate text-sm text-muted-foreground" title={m.note ?? undefined}>
                          {m.note ?? '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog thao tác kho (Nhập / Xuất / Điều chỉnh) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thao tác kho</DialogTitle>
            <DialogDescription>Nhập kho, xuất kho hoặc điều chỉnh số tồn sau khi kiểm kê.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="movement-product">
                Sản phẩm <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.productId || undefined}
                onValueChange={(value) => setForm({ ...form, productId: value, quantity: '' })}
              >
                <SelectTrigger id="movement-product" className="w-full">
                  <SelectValue placeholder="Chọn sản phẩm" />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sku})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="movement-type">
                Loại thao tác <span className="text-destructive">*</span>
              </Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as MovementType })}>
                <SelectTrigger id="movement-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOVEMENT_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {MOVEMENT_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="movement-quantity">
                {form.type === 'ADJUST' ? 'Số tồn mới (kiểm kê)' : 'Số lượng'}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="movement-quantity"
                ref={qtyInputRef}
                type="number"
                min={0}
                step={1}
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder={form.type === 'ADJUST' ? 'Nhập số tồn mới' : 'Nhập số lượng'}
              />
              {preview && (
                <p
                  className={cn(
                    'text-xs',
                    preview.next < 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'
                  )}
                >
                  Tồn hiện tại: {formatNumber(preview.current)} → sau thao tác:{' '}
                  <span className={cn(preview.next < 0 ? 'text-red-600 dark:text-red-400' : 'font-semibold text-emerald-600 dark:text-emerald-400')}>
                    {formatNumber(preview.next)}
                  </span>
                  {form.type === 'ADJUST' && (
                    <span>
                      {' '}(biến động: {preview.delta > 0 ? '+' : ''}
                      {formatNumber(preview.delta)})
                    </span>
                  )}
                  {preview.next < 0 && ' — vượt quá tồn hiện tại, không thể xuất'}
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="movement-note">Ghi chú</Label>
              <Textarea
                id="movement-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Ví dụ: Nhập lô hàng từ NCC, xuất cho đơn #123..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitDisabled || submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
