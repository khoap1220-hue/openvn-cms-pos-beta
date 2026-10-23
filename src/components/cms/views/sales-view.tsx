'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatCompactVND, formatDate, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import {
  CircleDollarSign,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  Loader2,
  Plus,
  Receipt,
  Search,
  ShoppingBag,
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
}

interface PartnerLite {
  id: string
  code: string
  name: string
  taxCode: string | null
  type: string
}

interface InvoiceItemRow {
  quantity: number
  unitPrice: number
  amount: number
  product: { sku: string; name: string; unit: string }
}

interface SalesInvoice {
  id: string
  code: string
  invoiceDate: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  status: 'POSTED' | 'CANCELLED'
  note: string | null
  partner: { name: string; taxCode: string | null } | null
  order: { code: string } | null
  items: InvoiceItemRow[]
}

interface UninvoicedOrder {
  id: string
  code: string
  subtotal: number
  items: Array<{ product: { sku: string; name: string }; quantity: number; price: number }>
  customer: { name: string } | null
  createdAt: string
}

interface DraftRow {
  productId: string
  quantity: string
  unitPrice: string
}

const FIRST_YEAR = 2024
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR + 2 - FIRST_YEAR }, (_, i) => FIRST_YEAR + i)
const QUARTER_OPTIONS = [
  { value: 'all', label: 'Cả năm' },
  { value: '1', label: 'Quý 1' },
  { value: '2', label: 'Quý 2' },
  { value: '3', label: 'Quý 3' },
  { value: '4', label: 'Quý 4' },
]
const VAT_RATES = [0, 5, 8, 10]

const todayInput = () => {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function SalesView() {
  const [invoices, setInvoices] = useState<SalesInvoice[] | null>(null)
  const [uninvoiced, setUninvoiced] = useState<UninvoicedOrder[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [quarter, setQuarter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [partners, setPartners] = useState<PartnerLite[] | null>(null)
  const [products, setProducts] = useState<ProductLite[] | null>(null)

  const [detail, setDetail] = useState<SalesInvoice | null>(null)
  const [cancelTarget, setCancelTarget] = useState<SalesInvoice | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTab, setDialogTab] = useState<'order' | 'manual'>('order')
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [manualPartnerId, setManualPartnerId] = useState('none')
  const [invoiceDate, setInvoiceDate] = useState(todayInput())
  const [vatRate, setVatRate] = useState('8')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ productId: '', quantity: '', unitPrice: '' }])
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year) })
      if (quarter !== 'all') params.set('quarter', quarter)
      if (search) params.set('q', search)
      const [invoiceRes, uninvoicedRes] = await Promise.all([
        apiGet<{ invoices: SalesInvoice[] }>(`/api/sales-invoices?${params.toString()}`),
        apiGet<{ orders: UninvoicedOrder[] }>('/api/sales-invoices?uninvoiced=1'),
      ])
      setInvoices(invoiceRes.invoices)
      setUninvoiced(uninvoicedRes.orders)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải hóa đơn bán'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [year, quarter, search])

  useEffect(() => {
    void load()
  }, [load])

  const loadDialogData = useCallback(async () => {
    try {
      const [partnersRes, productsRes] = await Promise.all([
        apiGet<{ partners: PartnerLite[] }>('/api/partners'),
        apiGet<{ products: ProductLite[] }>('/api/products?status=ACTIVE'),
      ])
      setPartners(partnersRes.partners.filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH'))
      setProducts(productsRes.products)
    } catch {
      // bỏ qua — dialog vẫn mở, select sẽ rỗng
    }
  }, [])

  const openCreate = () => {
    setDialogTab('order')
    setSelectedOrderId('')
    setManualPartnerId('none')
    setInvoiceDate(todayInput())
    setVatRate('8')
    setNote('')
    setRows([{ productId: '', quantity: '', unitPrice: '' }])
    setDialogOpen(true)
    void loadDialogData()
  }

  const updateRow = (index: number, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const addRow = () => setRows((prev) => [...prev, { productId: '', quantity: '', unitPrice: '' }])

  const selectProduct = (index: number, productId: string) => {
    const product = (products ?? []).find((p) => p.id === productId)
    updateRow(index, {
      productId,
      unitPrice:
        product && (rows[index].unitPrice === '' || Number(rows[index].unitPrice) === 0)
          ? String(product.sellPrice)
          : rows[index].unitPrice,
    })
  }

  const manualTotals = useMemo(() => {
    let subtotal = 0
    for (const row of rows) {
      subtotal += (Number(row.quantity) || 0) * (Number(row.unitPrice) || 0)
    }
    const vat = Math.round((subtotal * (Number(vatRate) || 0)) / 100)
    return { subtotal, vat, total: subtotal + vat }
  }, [rows, vatRate])

  const posted = (invoices ?? []).filter((inv) => inv.status === 'POSTED')
  const totalRevenue = posted.reduce((sum, inv) => sum + inv.total, 0)
  const totalVatOutput = posted.reduce((sum, inv) => sum + inv.vatAmount, 0)

  const handleCreate = async () => {
    const common = {
      vatRate: Number(vatRate) || 0,
      invoiceDate: invoiceDate || undefined,
      note: note.trim() || undefined,
    }
    let body: Record<string, unknown>
    if (dialogTab === 'order') {
      if (!selectedOrderId) {
        toast({ title: 'Vui lòng chọn một đơn hàng cần xuất hóa đơn', variant: 'destructive' })
        return
      }
      body = { orderId: selectedOrderId, ...common }
    } else {
      const items: Array<{ productId: string; quantity: number; unitPrice?: number }> = []
      for (const row of rows) {
        const qty = Number(row.quantity)
        const price = row.unitPrice === '' ? undefined : Number(row.unitPrice)
        if (!row.productId) {
          toast({ title: 'Vui lòng chọn sản phẩm cho mọi dòng', variant: 'destructive' })
          return
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          toast({ title: 'Số lượng phải lớn hơn 0', variant: 'destructive' })
          return
        }
        if (price !== undefined && (!Number.isFinite(price) || price < 0)) {
          toast({ title: 'Đơn giá không được âm', variant: 'destructive' })
          return
        }
        items.push({ productId: row.productId, quantity: qty, ...(price !== undefined ? { unitPrice: price } : {}) })
      }
      if (items.length === 0) {
        toast({ title: 'Cần ít nhất 1 dòng sản phẩm', variant: 'destructive' })
        return
      }
      body = {
        partnerId: manualPartnerId !== 'none' ? manualPartnerId : undefined,
        items,
        ...common,
      }
    }
    setSubmitting(true)
    try {
      await apiPost<{ invoice: SalesInvoice }>('/api/sales-invoices', body)
      toast({
        title: 'Đã xuất hóa đơn bán',
        description: 'Doanh thu & thuế VAT đầu ra đã được ghi nhận.',
      })
      setDialogOpen(false)
      await load()
    } catch (e) {
      toast({
        title: 'Xuất hóa đơn bán thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await apiPost<{ invoice: SalesInvoice }>(`/api/sales-invoices/${cancelTarget.id}`, { action: 'CANCEL' })
      toast({
        title: 'Đã hủy hóa đơn bán',
        description: `${cancelTarget.code} — doanh thu, VAT & kho đã hoàn ngược.`,
      })
      setCancelTarget(null)
      setDetail(null)
      await load()
    } catch (e) {
      toast({
        title: 'Hủy hóa đơn thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Xuất hàng"
        description="Hóa đơn bán — ghi sổ doanh thu, thuế VAT đầu ra và trừ kho (kèm định mức BOM)"
      >
        <Button onClick={openCreate}>
          <Receipt className="h-4 w-4" />
          Tạo hóa đơn bán
        </Button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Tổng thu"
          value={loading ? '' : formatCompactVND(totalRevenue)}
          icon={CircleDollarSign}
          loading={loading}
          hint="Đã loại hóa đơn hủy"
          iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        />
        <StatCard
          title="Số hóa đơn"
          value={loading ? '' : formatNumber(invoices?.length ?? 0)}
          icon={Receipt}
          loading={loading}
          hint={`${posted.length} đã ghi sổ`}
        />
        <StatCard
          title="Thuế VAT đầu ra"
          value={loading ? '' : formatCompactVND(totalVatOutput)}
          icon={FileSpreadsheet}
          loading={loading}
          hint="Kê khai từ hóa đơn bán"
          iconClassName="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400"
        />
        <StatCard
          title="Đơn chưa xuất HĐ"
          value={loading ? '' : formatNumber(uninvoiced?.length ?? 0)}
          icon={ClipboardList}
          loading={loading}
          hint="Đơn COMPLETED chưa có hóa đơn"
          iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        />
      </div>

      {/* Bộ lọc */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={quarter} onValueChange={setQuarter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUARTER_OPTIONS.map((q) => (
              <SelectItem key={q.value} value={q.value}>
                {q.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                Năm {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm mã hóa đơn, đối tác, đơn nguồn..."
            className="pl-8"
          />
        </div>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : error ? (
            <div className="p-4">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : !invoices || invoices.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Receipt}
                title="Chưa có hóa đơn bán nào"
                description="Xuất hóa đơn từ đơn hàng COMPLETED hoặc tự tạo hóa đơn thủ công."
                action={
                  <Button onClick={openCreate}>
                    <Receipt className="h-4 w-4" />
                    Tạo hóa đơn bán
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Mã HĐ</TableHead>
                    <TableHead>Ngày</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Đơn nguồn</TableHead>
                    <TableHead className="text-right">Tiền hàng</TableHead>
                    <TableHead className="text-right">VAT</TableHead>
                    <TableHead className="text-right">Tổng cộng</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => (
                    <TableRow key={inv.id} className={inv.status === 'CANCELLED' ? 'opacity-60' : undefined}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{inv.code}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(inv.invoiceDate)}</TableCell>
                      <TableCell>
                        <p className="max-w-[160px] truncate font-medium">{inv.partner?.name ?? 'Khách lẻ'}</p>
                        {inv.partner?.taxCode && (
                          <p className="font-mono text-xs text-muted-foreground">{inv.partner.taxCode}</p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">
                        {inv.order?.code ?? '—'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums">{formatVND(inv.subtotal)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-sky-700 dark:text-sky-400">
                        {inv.vatRate}% · {formatVND(inv.vatAmount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatVND(inv.total)}
                      </TableCell>
                      <TableCell>
                        {inv.status === 'POSTED' ? (
                          <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                            Đã ghi sổ
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Đã hủy</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setDetail(inv)}
                          title="Xem chi tiết"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog chi tiết hóa đơn bán */}
      <Dialog open={detail !== null} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{detail.code}</span>
                  {detail.status === 'POSTED' ? (
                    <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      Đã ghi sổ
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Đã hủy</Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {formatDate(detail.invoiceDate)} — {detail.partner?.name ?? 'Khách lẻ'}
                  {detail.order ? ` · từ đơn ${detail.order.code}` : ' · tạo thủ công'}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono">Mã SP</TableHead>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead className="text-right">SL</TableHead>
                      <TableHead className="text-right">Đơn giá</TableHead>
                      <TableHead className="text-right">Thành tiền</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item, i) => (
                      <TableRow key={`${detail.id}-${i}`}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{item.product.sku}</TableCell>
                        <TableCell>
                          <p className="max-w-[220px] truncate font-medium">{item.product.name}</p>
                          <p className="text-xs text-muted-foreground">{item.product.unit}</p>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{formatNumber(item.quantity)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{formatVND(item.unitPrice)}</TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">{formatVND(item.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tiền hàng</span>
                  <span className="tabular-nums">{formatVND(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Thuế VAT ({detail.vatRate}%)</span>
                  <span className="tabular-nums text-sky-700 dark:text-sky-400">{formatVND(detail.vatAmount)}</span>
                </div>
                <div className="flex justify-between text-base font-bold">
                  <span>Tổng cộng</span>
                  <span className="tabular-nums">{formatVND(detail.total)}</span>
                </div>
                {detail.note && <p className="pt-1 text-xs text-muted-foreground">Ghi chú: {detail.note}</p>}
              </div>
              {detail.status === 'POSTED' && (
                <DialogFooter>
                  <Button variant="destructive" onClick={() => setCancelTarget(detail)}>
                    <Trash2 className="h-4 w-4" />
                    Hủy hóa đơn
                  </Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog tạo hóa đơn bán — 2 tab */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo hóa đơn bán</DialogTitle>
            <DialogDescription>
              Chọn xuất từ đơn hàng COMPLETED (không trừ kho lần 2) hoặc tự tạo hóa đơn thủ công (tự trừ kho + BOM).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <Tabs value={dialogTab} onValueChange={(value) => setDialogTab(value as 'order' | 'manual')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="order">Từ đơn hàng</TabsTrigger>
                <TabsTrigger value="manual">Tự tạo</TabsTrigger>
              </TabsList>

              <TabsContent value="order" className="mt-2">
                {!uninvoiced || uninvoiced.length === 0 ? (
                  <EmptyState
                    icon={ShoppingBag}
                    title="Không có đơn chưa xuất hóa đơn"
                    description="Mọi đơn COMPLETED đã được xuất hóa đơn."
                  />
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                    <RadioGroup value={selectedOrderId} onValueChange={setSelectedOrderId} className="gap-2">
                      {uninvoiced.map((order) => (
                        <Label
                          key={order.id}
                          htmlFor={`order-${order.id}`}
                          className="block"
                        >
                          <div
                            className={
                              'flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors ' +
                              (selectedOrderId === order.id
                                ? 'border-primary bg-primary/5'
                                : 'border-border/70 hover:bg-muted/60')
                            }
                          >
                            <RadioGroupItem value={order.id} id={`order-${order.id}`} className="mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="flex flex-wrap items-center gap-2">
                                <span className="font-mono text-sm font-semibold">{order.code}</span>
                                <span className="text-sm text-muted-foreground">
                                  {order.customer?.name ?? 'Khách lẻ'}
                                </span>
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatDateTime(order.createdAt)} · {order.items.length} mặt hàng
                              </p>
                            </div>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatVND(order.subtotal)}
                            </span>
                          </div>
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="manual" className="mt-2">
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="sales-partner">Khách hàng (đối tác)</Label>
                    <Select value={manualPartnerId} onValueChange={setManualPartnerId}>
                      <SelectTrigger id="sales-partner" className="w-full">
                        <SelectValue placeholder="Chọn khách hàng" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Không chọn (khách lẻ) —</SelectItem>
                        {(partners ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.taxCode ? ` (${p.taxCode})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Danh sách mặt hàng</Label>
                    {rows.map((row, index) => (
                      <div key={index} className="space-y-1.5 rounded-xl border p-3">
                        <div className="flex items-center gap-2">
                          <Select value={row.productId || undefined} onValueChange={(value) => selectProduct(index, value)}>
                            <SelectTrigger className="min-w-[200px] flex-1">
                              <SelectValue placeholder="Chọn sản phẩm" />
                            </SelectTrigger>
                            <SelectContent>
                              {(products ?? []).map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.sku} — {p.name} (tồn {formatNumber(p.stock)})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRow(index)}
                            disabled={rows.length === 1}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={row.quantity}
                            onChange={(e) => updateRow(index, { quantity: e.target.value })}
                            placeholder="Số lượng"
                            className="w-32"
                          />
                          <Input
                            type="number"
                            min={0}
                            step={1000}
                            value={row.unitPrice}
                            onChange={(e) => updateRow(index, { unitPrice: e.target.value })}
                            placeholder="Đơn giá bán"
                            className="w-40"
                          />
                          <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                            Thành tiền:{' '}
                            <span className="font-semibold text-foreground">
                              {formatVND((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0))}
                            </span>
                          </span>
                        </div>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={addRow}>
                      <Plus className="h-4 w-4" />
                      Thêm dòng
                    </Button>
                  </div>
                  <div className="rounded-xl border bg-muted/40 p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tiền hàng</span>
                      <span className="tabular-nums">{formatVND(manualTotals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Thuế VAT ({vatRate}%)</span>
                      <span className="tabular-nums text-sky-700 dark:text-sky-400">{formatVND(manualTotals.vat)}</span>
                    </div>
                    <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-bold">
                      <span>Tổng cộng</span>
                      <span className="tabular-nums">{formatVND(manualTotals.total)}</span>
                    </div>
                  </div>
                </div>
              </TabsContent>
            </Tabs>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="sales-date">Ngày hóa đơn</Label>
                <Input id="sales-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Thuế suất VAT</Label>
                <Select value={vatRate} onValueChange={setVatRate}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        VAT {rate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sales-note">Ghi chú</Label>
                <Input
                  id="sales-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Ghi chú trên hóa đơn..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleCreate()} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Xuất hóa đơn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm hủy hóa đơn */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={`Hủy hóa đơn bán ${cancelTarget?.code ?? ''}?`}
        description="Hóa đơn hủy sẽ không còn tính vào doanh thu, thuế VAT đầu ra; kho (và định mức BOM) được hoàn ngược."
        confirmText="Hủy hóa đơn"
        destructive
        loading={cancelling}
        onConfirm={() => void handleCancel()}
      />
    </div>
  )
}
