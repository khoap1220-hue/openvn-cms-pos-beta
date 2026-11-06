'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatDate, formatNumber, formatVND } from '@/lib/format'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { BarcodeScanner } from '@/components/cms/barcode-scanner'
import { InvoicePrintDialog } from '@/components/cms/invoice-print'
import type { InvoicePrintData } from '@/components/cms/invoice-print'
import { DataLineageBadge, LineageInspectorDialog } from '@/components/cms/lineage'
import type { LineageInspectorTarget } from '@/components/cms/lineage'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
  Download,
  Eye,
  FileCode,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  Receipt,
  Search,
  ShieldCheck,
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

export interface SalesInvoice {
  id: string
  code: string
  invoiceDate: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  status: 'POSTED' | 'CANCELLED'
  note: string | null
  invoiceNo?: number | null
  series?: string | null
  templateCode?: string | null
  partner: { name: string; taxCode: string | null; address?: string | null; phone?: string | null } | null
  order: { code: string } | null
  items: InvoiceItemRow[]
}

export type InvoiceWithLineage = SalesInvoice & { originSource?: string | null; changeCount?: number }

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

function isInvoiceSigned(invoice: { note?: string | null }): boolean {
  return Boolean(invoice.note && invoice.note.includes('KÝ SỐ'))
}

function getInvoiceLookupCode(invoice: { note?: string | null }): string | null {
  if (!invoice.note) return null
  const m = invoice.note.match(/(?:Mã tra cứu|Tra cứu):\s*([^\s|\]]+)/i)
  return m ? m[1] : null
}

export function SalesInvoicesView() {
  const [invoices, setInvoices] = useState<InvoiceWithLineage[] | null>(null)
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
  const [signingId, setSigningId] = useState<string | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogTab, setDialogTab] = useState<'order' | 'manual'>('order')
  const [selectedOrderId, setSelectedOrderId] = useState<string>('')
  const [manualPartnerId, setManualPartnerId] = useState('none')
  const [invoiceDate, setInvoiceDate] = useState(todayInput())
  const [vatRate, setVatRate] = useState('8')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<DraftRow[]>([{ productId: '', quantity: '', unitPrice: '' }])
  const [submitting, setSubmitting] = useState(false)

  // In hóa đơn
  const [printOpen, setPrintOpen] = useState(false)
  const [printInvoice, setPrintInvoice] = useState<InvoicePrintData | null>(null)
  const [printLoading, setPrintLoading] = useState(false)

  // Truy xuất nguồn gốc
  const [lineageTarget, setLineageTarget] = useState<LineageInspectorTarget | null>(null)
  const openLineage = (inv: InvoiceWithLineage) =>
    setLineageTarget({
      entityType: 'SalesInvoice',
      entityId: inv.id,
      entityCode: inv.code,
      label: `Hóa đơn bán ${inv.code}`,
    })

  const vatDefaultRef = useRef('8')
  const invoiceDefaultNoteRef = useRef('')
  const { toast } = useToast()

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    apiGet<{ vat_default?: string; invoice_default_note?: string }>('/api/settings')
      .then((res) => {
        if (cancelled) return
        const vat = Number(res.vat_default)
        if (res.vat_default != null && res.vat_default !== '' && Number.isFinite(vat) && vat >= 0 && vat <= 100) {
          vatDefaultRef.current = String(vat)
        }
        if (typeof res.invoice_default_note === 'string') {
          invoiceDefaultNoteRef.current = res.invoice_default_note
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year) })
      if (quarter !== 'all') params.set('quarter', quarter)
      if (search) params.set('q', search)
      const [invoiceRes, uninvoicedRes] = await Promise.all([
        apiGet<{ invoices: InvoiceWithLineage[] }>(`/api/sales-invoices?${params.toString()}`),
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
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Lỗi tải dữ liệu',
        description: e instanceof Error ? e.message : 'Không thể tải danh sách đối tác / sản phẩm',
      })
    }
  }, [toast])

  const openCreate = useCallback(() => {
    setSelectedOrderId(uninvoiced && uninvoiced.length > 0 ? uninvoiced[0].id : '')
    setManualPartnerId('none')
    setInvoiceDate(todayInput())
    setVatRate(vatDefaultRef.current)
    setNote(invoiceDefaultNoteRef.current)
    setRows([{ productId: '', quantity: '', unitPrice: '' }])
    setDialogTab(uninvoiced && uninvoiced.length > 0 ? 'order' : 'manual')
    setDialogOpen(true)
    void loadDialogData()
  }, [uninvoiced, loadDialogData])

  const downloadXml = (inv: { id: string; code: string; status: string }) => {
    if (inv.status === 'CANCELLED') {
      toast({
        variant: 'destructive',
        title: 'Không thể xuất XML',
        description: 'Hóa đơn đã bị hủy, không thể xuất file XML theo quy định Thuế.',
      })
      return
    }

    const downloadUrl = `/api/sales-invoices/${inv.id}/xml`
    const a = document.createElement('a')
    a.href = downloadUrl
    a.download = `${inv.code}.xml`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)

    toast({
      title: 'Đang tải XML hóa đơn',
      description: `Đã bắt đầu tải tệp XML chuẩn QĐ 1450 cho hóa đơn ${inv.code}`,
    })
  }

  const handleSign = async (inv: { id: string; code: string; status: string }, provider = 'MOCK_VNPT') => {
    if (inv.status === 'CANCELLED') {
      toast({
        variant: 'destructive',
        title: 'Không thể ký số',
        description: 'Không thể ký số hóa đơn đã bị hủy.',
      })
      return
    }

    try {
      setSigningId(inv.id)
      const res = await apiPost<{
        success: boolean
        signature: { lookupCode: string; signedAt: string }
        provider: string
      }>(`/api/sales-invoices/${inv.id}/sign`, { provider })

      if (res.success) {
        toast({
          title: 'Ký số hóa đơn thành công',
          description: `Đã ký số điện tử qua ${res.provider}. Mã tra cứu: ${res.signature.lookupCode}`,
        })
        await load()
        if (detail && detail.id === inv.id) {
          const updated = await apiGet<{ invoice: SalesInvoice }>(`/api/sales-invoices/${inv.id}`)
          if (updated.invoice) setDetail(updated.invoice)
        }
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Ký số thất bại',
        description: err instanceof Error ? err.message : 'Lỗi kết nối bộ ký số hóa đơn',
      })
    } finally {
      setSigningId(null)
    }
  }

  const openPrint = async () => {
    if (!detail) return
    setPrintLoading(true)
    try {
      const res = await apiGet<{ invoice: SalesInvoice }>(`/api/sales-invoices/${detail.id}`)
      setPrintInvoice(res.invoice)
      setPrintOpen(true)
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Lỗi tải bản in',
        description: e instanceof Error ? e.message : 'Không thể tải dữ liệu chi tiết hóa đơn',
      })
    } finally {
      setPrintLoading(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await apiPost<{ invoice: SalesInvoice }>(`/api/sales-invoices/${cancelTarget.id}`, { action: 'CANCEL' })
      toast({
        title: 'Hủy hóa đơn thành công',
        description: `Hóa đơn ${cancelTarget.code} đã chuyển sang ĐÃ HỦY. Kho hàng đã được hoàn trả.`,
      })
      setCancelTarget(null)
      if (detail && detail.id === cancelTarget.id) {
        setDetail((prev) => (prev ? { ...prev, status: 'CANCELLED' } : null))
      }
      await load()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Hủy hóa đơn thất bại',
        description: e instanceof Error ? e.message : 'Không thể hủy hóa đơn bán',
      })
    } finally {
      setCancelling(false)
    }
  }

  const handleCreateSubmit = async () => {
    setSubmitting(true)
    try {
      if (dialogTab === 'order') {
        if (!selectedOrderId) {
          toast({ variant: 'destructive', title: 'Thiếu thông tin', description: 'Vui lòng chọn một đơn hàng' })
          return
        }
        await apiPost<{ invoice: SalesInvoice }>('/api/sales-invoices', {
          orderId: selectedOrderId,
          invoiceDate,
          vatRate: Number(vatRate),
          note: note.trim() || undefined,
        })
      } else {
        const cleanItems = rows
          .filter((r) => r.productId && Number(r.quantity) > 0)
          .map((r) => ({
            productId: r.productId,
            quantity: Number(r.quantity),
            unitPrice: Number(r.unitPrice),
          }))
        if (cleanItems.length === 0) {
          toast({ variant: 'destructive', title: 'Thiếu dòng hàng', description: 'Cần ít nhất một sản phẩm hợp lệ' })
          return
        }
        await apiPost<{ invoice: SalesInvoice }>('/api/sales-invoices', {
          partnerId: manualPartnerId === 'none' ? undefined : manualPartnerId,
          invoiceDate,
          vatRate: Number(vatRate),
          items: cleanItems,
          note: note.trim() || undefined,
        })
      }
      toast({ title: 'Tạo hóa đơn thành công', description: 'Hóa đơn đã được ghi sổ.' })
      setDialogOpen(false)
      await load()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Tạo hóa đơn thất bại',
        description: e instanceof Error ? e.message : 'Không thể tạo hóa đơn bán',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const stats = useMemo(() => {
    if (!invoices) return { count: 0, revenue: 0, vat: 0 }
    const valid = invoices.filter((i) => i.status === 'POSTED')
    return {
      count: valid.length,
      revenue: valid.reduce((sum, i) => sum + i.total, 0),
      vat: valid.reduce((sum, i) => sum + i.vatAmount, 0),
    }
  }, [invoices])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hóa đơn bán hàng & VAT Điện tử (QĐ 1450)"
        description="Quản lý hóa đơn bán, xuất XML chuẩn Tổng cục Thuế và ký số điện tử (VNPT / Viettel SInvoice)"
      >
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Tạo hóa đơn bán
        </Button>
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={Receipt}
          title="Hóa đơn đã ghi sổ"
          value={formatNumber(stats.count)}
          hint="Trong kỳ chọn lọc"
        />
        <StatCard
          icon={CircleDollarSign}
          title="Doanh thu bán hàng"
          value={formatVND(stats.revenue)}
          hint="Đã bao gồm thuế GTGT"
        />
        <StatCard
          icon={FileSpreadsheet}
          title="Thuế VAT đầu ra"
          value={formatVND(stats.vat)}
          hint="Số thuế phải nộp ngân sách"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28">
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

          <Select value={quarter} onValueChange={setQuarter}>
            <SelectTrigger className="w-32">
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
        </div>

        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm mã HĐ, khách hàng, MST..."
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
            <div className="overflow-x-auto lg:max-h-[550px] lg:overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-xs">
                  <TableRow>
                    <TableHead>Mã HĐ</TableHead>
                    <TableHead>Ngày lập</TableHead>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Đơn nguồn</TableHead>
                    <TableHead className="text-right">Tổng tiền</TableHead>
                    <TableHead>Trạng thái</TableHead>
                    <TableHead>Ký số điện tử</TableHead>
                    <TableHead className="text-right">Thao tác</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((inv) => {
                    const signed = isInvoiceSigned(inv)
                    const lookup = getInvoiceLookupCode(inv)
                    const isCancelled = inv.status === 'CANCELLED'

                    return (
                      <TableRow key={inv.id} className={isCancelled ? 'opacity-60 bg-muted/20' : undefined}>
                        <TableCell className="whitespace-nowrap font-mono text-xs font-semibold">
                          {inv.code}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {formatDate(inv.invoiceDate)}
                        </TableCell>
                        <TableCell>
                          <p className="max-w-[160px] truncate font-medium">{inv.partner?.name ?? 'Khách lẻ'}</p>
                          {inv.partner?.taxCode && (
                            <p className="font-mono text-xs text-muted-foreground">{inv.partner.taxCode}</p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {inv.order?.code ?? '—'}
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
                          {signed ? (
                            <div className="flex flex-col gap-0.5">
                              <Badge className="w-fit border-transparent bg-emerald-600 text-white hover:bg-emerald-700">
                                <ShieldCheck className="mr-1 h-3 w-3" />
                                Đã ký số
                              </Badge>
                              {lookup && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  {lookup}
                                </span>
                              )}
                            </div>
                          ) : isCancelled ? (
                            <Badge variant="outline" className="text-muted-foreground">
                              Không áp dụng
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="w-fit border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400"
                            >
                              Chưa ký số
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Nút Tải XML */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1 text-xs"
                              onClick={() => downloadXml(inv)}
                              disabled={isCancelled}
                              title={isCancelled ? 'Hóa đơn đã hủy không thể xuất XML' : 'Tải tệp XML QĐ 1450'}
                            >
                              <Download className="h-3.5 w-3.5 text-blue-600" />
                              <span className="hidden sm:inline">Tải XML</span>
                            </Button>

                            {/* Nút Ký số nếu chưa ký */}
                            {!signed && !isCancelled && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1 text-xs border-emerald-500/50 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                                onClick={() => void handleSign(inv, 'MOCK_VNPT')}
                                disabled={signingId === inv.id}
                                title="Ký số hóa đơn điện tử"
                              >
                                {signingId === inv.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                                )}
                                <span className="hidden sm:inline">Ký số</span>
                              </Button>
                            )}

                            {/* Nút Chi tiết */}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setDetail(inv)}
                              title="Xem chi tiết"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
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

      {/* Drawer / Dialog chi tiết hóa đơn bán */}
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
                  {isInvoiceSigned(detail) ? (
                    <Badge className="border-transparent bg-emerald-600 text-white">
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Đã ký số điện tử
                    </Badge>
                  ) : (
                    detail.status === 'POSTED' && (
                      <Badge variant="outline" className="border-amber-300 text-amber-700">
                        Chưa ký số
                      </Badge>
                    )
                  )}
                </DialogTitle>
                <DialogDescription>
                  {formatDate(detail.invoiceDate)} — {detail.partner?.name ?? 'Khách lẻ'}
                  {detail.order ? ` · Từ đơn hàng ${detail.order.code}` : ' · Tạo thủ công'}
                </DialogDescription>
              </DialogHeader>

              {/* Thông tin đối tác & ký số */}
              <div className="rounded-lg border bg-muted/30 p-3 text-xs space-y-1">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Người mua: </span>
                    <span className="font-medium">{detail.partner?.name || 'Khách lẻ'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Mã số thuế: </span>
                    <span className="font-mono font-medium">{detail.partner?.taxCode || '—'}</span>
                  </div>
                </div>
                {detail.partner?.address && (
                  <div>
                    <span className="text-muted-foreground">Địa chỉ: </span>
                    <span>{detail.partner.address}</span>
                  </div>
                )}
                {getInvoiceLookupCode(detail) && (
                  <div className="pt-1 text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Mã tra cứu hóa đơn điện tử: </span>
                    <span className="font-mono">{getInvoiceLookupCode(detail)}</span>
                  </div>
                )}
              </div>

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
                <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                  <div className="flex gap-2">
                    {/* Nút Tải XML trong Drawer */}
                    <Button variant="secondary" onClick={() => downloadXml(detail)}>
                      <Download className="h-4 w-4" />
                      Tải XML
                    </Button>

                    {/* Nút Ký số trong Drawer nếu chưa ký */}
                    {!isInvoiceSigned(detail) && (
                      <Button
                        variant="default"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => void handleSign(detail, 'MOCK_VNPT')}
                        disabled={signingId === detail.id}
                      >
                        {signingId === detail.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4" />
                        )}
                        Ký số
                      </Button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => void openPrint()} disabled={printLoading}>
                      {printLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                      In hóa đơn
                    </Button>
                    <Button variant="destructive" onClick={() => setCancelTarget(detail)}>
                      <Trash2 className="h-4 w-4" />
                      Hủy hóa đơn
                    </Button>
                  </div>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog tạo hóa đơn */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo hóa đơn bán</DialogTitle>
            <DialogDescription>
              Xuất từ đơn hàng COMPLETED hoặc tự tạo hóa đơn thủ công.
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
                          htmlFor={order.id}
                          className="flex cursor-pointer items-start justify-between rounded-lg border p-3 hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
                        >
                          <div className="flex items-start gap-3">
                            <RadioGroupItem value={order.id} id={order.id} className="mt-1" />
                            <div className="space-y-0.5">
                              <p className="font-mono text-sm font-semibold">{order.code}</p>
                              <p className="text-xs text-muted-foreground">
                                {order.customer?.name ?? 'Khách lẻ'} · {formatDate(order.createdAt)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {order.items.length} mặt hàng:{' '}
                                {order.items.map((it) => `${it.product.name} (x${it.quantity})`).join(', ')}
                              </p>
                            </div>
                          </div>
                          <p className="font-semibold tabular-nums text-primary">{formatVND(order.subtotal)}</p>
                        </Label>
                      ))}
                    </RadioGroup>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="manual" className="mt-2 space-y-3">
                <div className="space-y-1.5">
                  <Label>Khách hàng / Đối tác</Label>
                  <Select value={manualPartnerId} onValueChange={setManualPartnerId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Chọn khách hàng" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Khách lẻ (không chọn)</SelectItem>
                      {partners?.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} {p.taxCode ? `(MST: ${p.taxCode})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Danh sách sản phẩm</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRows((r) => [...r, { productId: '', quantity: '', unitPrice: '' }])}
                    >
                      <Plus className="h-3.5 w-3.5" /> Thêm dòng
                    </Button>
                  </div>
                  {rows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Select
                        value={row.productId}
                        onValueChange={(val) => {
                          const p = products?.find((item) => item.id === val)
                          setRows((prev) =>
                            prev.map((r, i) =>
                              i === idx
                                ? { ...r, productId: val, unitPrice: p ? String(p.sellPrice) : r.unitPrice }
                                : r
                            )
                          )
                        }}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Chọn sản phẩm..." />
                        </SelectTrigger>
                        <SelectContent>
                          {products?.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name} ({p.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        type="number"
                        placeholder="SL"
                        className="w-20"
                        value={row.quantity}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, quantity: e.target.value } : r))
                          )
                        }
                      />
                      <Input
                        type="number"
                        placeholder="Đơn giá"
                        className="w-28"
                        value={row.unitPrice}
                        onChange={(e) =>
                          setRows((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, unitPrice: e.target.value } : r))
                          )
                        }
                      />
                      {rows.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <Label>Ngày lập hóa đơn</Label>
                <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Thuế suất VAT (%)</Label>
                <Select value={vatRate} onValueChange={setVatRate}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VAT_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>
                        {rate}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ghi chú</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú hóa đơn..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleCreateSubmit} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Tạo &amp; Ghi sổ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm dialog hủy */}
      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Xác nhận hủy hóa đơn bán?"
        description={`Hóa đơn ${cancelTarget?.code} sẽ chuyển sang ĐÃ HỦY. Số lượng hàng hóa sẽ được hoàn trả lại kho tự động.`}
        confirmText="Xác nhận hủy"
        destructive
        loading={cancelling}
        onConfirm={handleCancel}
      />

      {/* Dialog in ấn */}
      {printInvoice && (
        <InvoicePrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          invoice={printInvoice}
          kind="sales"
        />
      )}

      {/* Dialog truy xuất nguồn gốc Sổ Data */}
      {lineageTarget && (
        <LineageInspectorDialog
          target={lineageTarget}
          open={lineageTarget !== null}
          onOpenChange={(open) => !open && setLineageTarget(null)}
        />
      )}
    </div>
  )
}

export { SalesInvoicesView as SalesView }
export default SalesInvoicesView
