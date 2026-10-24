'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatCompactVND, formatDate, formatNumber, formatVND } from '@/lib/format'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { BarcodeScanner } from '@/components/cms/barcode-scanner'
import { InvoicePrintDialog } from '@/components/cms/invoice-print'
import type { InvoicePrintData } from '@/components/cms/invoice-print'
import {
  Eye,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  Plus,
  Printer,
  Receipt,
  Search,
  Trash2,
  Wallet,
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
  barcode?: string | null
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

interface PurchaseInvoice {
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
  items: InvoiceItemRow[]
}

/** Chi tiết hóa đơn mua từ GET /api/purchase-invoices/{id} — partner FULL (đủ địa chỉ/điện thoại để in) */
interface PurchaseInvoiceDetail {
  id: string
  code: string
  invoiceDate: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  status: 'POSTED' | 'CANCELLED'
  note: string | null
  partner: { name: string; taxCode: string | null; address?: string | null; phone?: string | null } | null
  items: InvoiceItemRow[]
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

export function PurchaseView() {
  const [invoices, setInvoices] = useState<PurchaseInvoice[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [quarter, setQuarter] = useState<string>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [partners, setPartners] = useState<PartnerLite[] | null>(null)
  const [products, setProducts] = useState<ProductLite[] | null>(null)

  const [detail, setDetail] = useState<PurchaseInvoice | null>(null)
  const [cancelTarget, setCancelTarget] = useState<PurchaseInvoice | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // In hóa đơn mua — dữ liệu mới nhất từ API chi tiết (partner FULL) + dialog xem trước bản in
  const [printOpen, setPrintOpen] = useState(false)
  const [printInvoice, setPrintInvoice] = useState<InvoicePrintData | null>(null)
  const [printLoading, setPrintLoading] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<{
    partnerId: string
    invoiceDate: string
    vatRate: string
    note: string
  }>({ partnerId: 'none', invoiceDate: todayInput(), vatRate: '8', note: '' })
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
      const res = await apiGet<{ invoices: PurchaseInvoice[] }>(`/api/purchase-invoices?${params.toString()}`)
      setInvoices(res.invoices)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải hóa đơn mua'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [year, quarter, search])

  useEffect(() => {
    void load()
  }, [load])

  // Dữ liệu phụ cho dialog tạo: đối tác NCC + danh mục sản phẩm
  const loadDialogData = useCallback(async () => {
    try {
      const [partnersRes, productsRes] = await Promise.all([
        apiGet<{ partners: PartnerLite[] }>('/api/partners?type=SUPPLIER'),
        apiGet<{ products: ProductLite[] }>('/api/products?status=ACTIVE'),
      ])
      setPartners(partnersRes.partners)
      setProducts(productsRes.products)
    } catch {
      // bỏ qua — dialog vẫn mở, select sẽ rỗng
    }
  }, [])

  const openCreate = () => {
    setForm({ partnerId: 'none', invoiceDate: todayInput(), vatRate: '8', note: '' })
    setRows([{ productId: '', quantity: '', unitPrice: '' }])
    setDialogOpen(true)
    void loadDialogData()
  }

  const updateRow = (index: number, patch: Partial<DraftRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index))

  const addRow = () => setRows((prev) => [...prev, { productId: '', quantity: '', unitPrice: '' }])

  // Quét mã vạch trong dialog tạo hóa đơn mua → thêm nhanh/tăng SL dòng sản phẩm
  const handleScanToAdd = (code: string) => {
    const product =
      (products ?? []).find((p) => p.barcode === code) ?? (products ?? []).find((p) => p.sku === code)
    if (!product) {
      toast({ title: `Không tìm thấy sản phẩm với mã vạch ${code}`, variant: 'destructive' })
      return
    }
    setRows((prev) => {
      const existIdx = prev.findIndex((r) => r.productId === product.id)
      if (existIdx >= 0) {
        // Đã có dòng của SP này → tăng số lượng lên 1
        return prev.map((row, i) =>
          i === existIdx ? { ...row, quantity: String((Number(row.quantity) || 0) + 1) } : row
        )
      }
      // Dòng đầu vẫn trống → điền vào thay vì thêm dòng mới
      if (prev[0] && prev[0].productId === '') {
        return prev.map((row, i) =>
          i === 0 ? { productId: product.id, quantity: '1', unitPrice: String(product.costPrice) } : row
        )
      }
      return [...prev, { productId: product.id, quantity: '1', unitPrice: String(product.costPrice) }]
    })
  }

  const draftTotals = useMemo(() => {
    const vatRate = Number(form.vatRate) || 0
    let subtotal = 0
    for (const row of rows) {
      const qty = Number(row.quantity) || 0
      const price = Number(row.unitPrice) || 0
      subtotal += qty * price
    }
    const vatAmount = Math.round((subtotal * vatRate) / 100)
    return { subtotal, vatAmount, total: subtotal + vatAmount }
  }, [rows, form.vatRate])

  const posted = (invoices ?? []).filter((inv) => inv.status === 'POSTED')
  const totalExpense = posted.reduce((sum, inv) => sum + inv.total, 0)
  const totalVatInput = posted.reduce((sum, inv) => sum + inv.vatAmount, 0)
  const avgPerInvoice = posted.length > 0 ? Math.round(totalExpense / posted.length) : 0

  const openDialogReady = dialogOpen && products !== null

  const handleCreate = async () => {
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
    setSubmitting(true)
    try {
      await apiPost<{ invoice: PurchaseInvoice }>('/api/purchase-invoices', {
        partnerId: form.partnerId !== 'none' ? form.partnerId : undefined,
        items,
        vatRate: Number(form.vatRate) || 0,
        invoiceDate: form.invoiceDate || undefined,
        note: form.note.trim() || undefined,
      })
      toast({
        title: 'Đã ghi sổ hóa đơn mua',
        description: 'Chi phí & tồn kho đã được cập nhật theo hóa đơn.',
      })
      setDialogOpen(false)
      await load()
    } catch (e) {
      toast({
        title: 'Ghi sổ hóa đơn mua thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  /** Mở dialog in hóa đơn mua — luôn lấy dữ liệu FRESH từ API chi tiết để có đầy đủ địa chỉ/điện thoại NCC */
  const openPrint = async () => {
    if (!detail) return
    setPrintLoading(true)
    try {
      const fresh = await apiGet<{ invoice: PurchaseInvoiceDetail }>(`/api/purchase-invoices/${detail.id}`)
      const inv = fresh.invoice
      setPrintInvoice({
        id: inv.id,
        code: inv.code,
        invoiceDate: inv.invoiceDate,
        subtotal: inv.subtotal,
        vatRate: inv.vatRate,
        vatAmount: inv.vatAmount,
        total: inv.total,
        status: inv.status,
        note: inv.note,
        partner: inv.partner
          ? {
              name: inv.partner.name,
              taxCode: inv.partner.taxCode,
              address: inv.partner.address ?? null,
              phone: inv.partner.phone ?? null,
            }
          : null,
        items: inv.items,
      })
      setPrintOpen(true)
    } catch (e) {
      toast({
        title: 'Không thể tải dữ liệu in hóa đơn',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setPrintLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await apiPost<{ invoice: PurchaseInvoice }>(`/api/purchase-invoices/${cancelTarget.id}`, { action: 'CANCEL' })
      toast({
        title: 'Đã hủy hóa đơn mua',
        description: `${cancelTarget.code} — tồn kho & chi phí đã hoàn ngược.`,
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

  const selectProduct = (index: number, productId: string) => {
    const product = (products ?? []).find((p) => p.id === productId)
    updateRow(index, {
      productId,
      unitPrice:
        product && (rows[index].unitPrice === '' || Number(rows[index].unitPrice) === 0)
          ? String(product.costPrice)
          : rows[index].unitPrice,
    })
  }

  return (
    <div>
      <PageHeader
        title="Nhập hàng"
        description="Hóa đơn mua nguyên vật liệu — ghi sổ chi phí, thuế VAT đầu vào và nhập kho"
      >
        <Button onClick={openCreate}>
          <PackagePlus className="h-4 w-4" />
          Tạo hóa đơn mua
        </Button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Tổng chi"
          value={loading ? '' : formatCompactVND(totalExpense)}
          icon={Wallet}
          loading={loading}
          hint="Đã loại hóa đơn hủy"
          iconClassName="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
        />
        <StatCard
          title="Số hóa đơn"
          value={loading ? '' : formatNumber(invoices?.length ?? 0)}
          icon={Receipt}
          loading={loading}
          hint={`${posted.length} đã ghi sổ`}
        />
        <StatCard
          title="Thuế VAT đầu vào"
          value={loading ? '' : formatCompactVND(totalVatInput)}
          icon={FileSpreadsheet}
          loading={loading}
          hint="Khấu trừ từ hóa đơn mua"
          iconClassName="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400"
        />
        <StatCard
          title="Giá trị TB / hóa đơn"
          value={loading ? '' : formatCompactVND(avgPerInvoice)}
          icon={PackagePlus}
          loading={loading}
          hint="Trên hóa đơn đã ghi sổ"
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
            placeholder="Tìm mã hóa đơn, đối tác..."
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
                icon={PackagePlus}
                title="Chưa có hóa đơn mua nào"
                description="Tạo hóa đơn mua để ghi sổ chi phí và nhập kho nguyên vật liệu."
                action={
                  <Button onClick={openCreate}>
                    <PackagePlus className="h-4 w-4" />
                    Tạo hóa đơn mua
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
                    <TableHead>Đối tác</TableHead>
                    <TableHead className="text-right">SL mặt hàng</TableHead>
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
                        <p className="max-w-[180px] truncate font-medium">{inv.partner?.name ?? '—'}</p>
                        {inv.partner?.taxCode && (
                          <p className="font-mono text-xs text-muted-foreground">{inv.partner.taxCode}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{inv.items.length}</TableCell>
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

      {/* Dialog chi tiết hóa đơn */}
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
                  {formatDate(detail.invoiceDate)} — {detail.partner?.name ?? 'Không có đối tác'}
                  {detail.partner?.taxCode ? ` (MST ${detail.partner.taxCode})` : ''}
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
                  <Button variant="outline" onClick={() => void openPrint()} disabled={printLoading}>
                    {printLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                    In hóa đơn
                  </Button>
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

      {/* Dialog tạo hóa đơn mua */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo hóa đơn mua</DialogTitle>
            <DialogDescription>
              Ghi sổ chi phí, thuế VAT đầu vào và tự động nhập kho theo từng dòng sản phẩm.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="purchase-partner">Đối tác (NCC)</Label>
                <Select value={form.partnerId} onValueChange={(value) => setForm({ ...form, partnerId: value })}>
                  <SelectTrigger id="purchase-partner" className="w-full">
                    <SelectValue placeholder="Chọn nhà cung cấp" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Không chọn —</SelectItem>
                    {(partners ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.taxCode ? ` (${p.taxCode})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="purchase-date">Ngày hóa đơn</Label>
                <Input
                  id="purchase-date"
                  type="date"
                  value={form.invoiceDate}
                  onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Danh sách mặt hàng</Label>
                <div className="w-[110px]">
                  <Select value={form.vatRate} onValueChange={(value) => setForm({ ...form, vatRate: value })}>
                    <SelectTrigger className="h-9">
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
              </div>
              <BarcodeScanner
                onScan={handleScanToAdd}
                hint="Quét mã vạch để thêm nhanh dòng sản phẩm"
                className="mb-3"
              />
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
                      placeholder="Đơn giá"
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
                <span className="tabular-nums">{formatVND(draftTotals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Thuế VAT ({form.vatRate}%)</span>
                <span className="tabular-nums text-sky-700 dark:text-sky-400">{formatVND(draftTotals.vatAmount)}</span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-bold">
                <span>Tổng cộng</span>
                <span className="tabular-nums">{formatVND(draftTotals.total)}</span>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="purchase-note">Ghi chú</Label>
              <Textarea
                id="purchase-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Số HĐ nhà cung cấp, lô hàng, điểm giao nhận..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={submitting || !openDialogReady || rows.length === 0}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Ghi sổ hóa đơn
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog in hóa đơn mua — dữ liệu chi tiết fresh + settings tải khi mở */}
      <InvoicePrintDialog open={printOpen} onOpenChange={setPrintOpen} invoice={printInvoice} kind="purchase" />

      {/* Confirm hủy hóa đơn */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title={`Hủy hóa đơn mua ${cancelTarget?.code ?? ''}?`}
        description="Hóa đơn hủy sẽ không còn tính vào chi phí, thuế VAT đầu vào và tồn kho được hoàn ngược."
        confirmText="Hủy hóa đơn"
        destructive
        loading={cancelling}
        onConfirm={() => void handleCancel()}
      />
    </div>
  )
}
