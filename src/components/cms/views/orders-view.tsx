'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  Eye,
  LifeBuoy,
  Loader2,
  Minus,
  MoreHorizontal,
  PackageCheck,
  Plus,
  ScanLine,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
} from 'lucide-react'

import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/types'
import type { Channel, Order, OrderItem, Product } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'

import { BarcodeScanner } from '@/components/cms/barcode-scanner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { OrderStatusBadge, PaymentStatusBadge } from '@/components/cms/status-badge'
import { ShipmentStatusBadge } from '@/components/cms/agent-badge'
import { DataLineageBadge, LineageInspectorDialog, type LineageInspectorTarget } from '@/components/cms/lineage'
import { PeriodFilterBar, PeriodSummaryBar } from '@/components/cms/period-filter-bar'
import { useRealtime } from '@/hooks/use-realtime'
import { carrierName } from '@/lib/agents'
import { EMPTY_PERIOD, type ChangedFilter, type PeriodRange } from '@/lib/lineage'

const PAGE_SIZE = 10
// Luồng xử lý đơn: PENDING → CONFIRMED → PACKING → SHIPPING → COMPLETED (CANCELLED từ mọi trạng thái)
const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'COMPLETED'] as const

// Kiểm đếm đóng gói + đối soát: GET /api/orders/[id] trả items[].product kèm barcode + costPrice —
// mở rộng type cục bộ (không sửa lib/types) để dùng barcode khi quét và giá vốn khi hạch toán
type DetailOrderItem = OrderItem & {
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'barcode' | 'costPrice'> | null
}
type DetailOrder = Omit<Order, 'items'> & { items: DetailOrderItem[] }

// Nguồn gốc + số lần thay đổi trả thêm từ API danh sách đơn (không có trong type Order gốc)
type OrderWithLineage = Order & { originSource?: string | null; changeCount?: number }

interface CreateOrderItem {
  productId: string
  name: string
  sku: string
  price: number
  quantity: number
}

interface CreateOrderFormState {
  channelId: string
  customerName: string
  customerPhone: string
  address: string
  note: string
  paymentMethod: string
}

const EMPTY_CREATE_FORM: CreateOrderFormState = {
  channelId: '',
  customerName: '',
  customerPhone: '',
  address: '',
  note: '',
  paymentMethod: 'COD',
}

const EVENT_ACTOR_LABELS: Record<string, string> = {
  AGENT: 'Agent tự động',
  OPERATOR: 'Người vận hành',
  SYSTEM: 'Hệ thống',
  CUSTOMER: 'Khách hàng',
}

const EVENT_ACTOR_DOTS: Record<string, string> = {
  AGENT: 'bg-emerald-500',
  OPERATOR: 'bg-violet-500',
  SYSTEM: 'bg-slate-400',
  CUSTOMER: 'bg-amber-500',
}

// ===== Sau bán hàng: đổi trả / bảo hành =====
interface AfterSalesCase {
  id: string
  code: string
  type: string
  status: string
  reason: string
  resolution: string | null
  refundAmount: number
  handledBy: string
  createdAt: string
  order?: { id: string; code: string }
}

const CASE_TYPE_BADGES: Record<string, { label: string; className: string }> = {
  RETURN: {
    label: 'Đổi trả',
    className: 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  },
  EXCHANGE: {
    label: 'Đổi hàng',
    className: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  WARRANTY: {
    label: 'Bảo hành',
    className: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  },
}

const CASE_STATUS_BADGES: Record<string, { label: string; className: string }> = {
  OPEN: {
    label: 'Mới',
    className: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  PROCESSING: {
    label: 'Đang xử lý',
    className: 'border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  },
  RESOLVED: {
    label: 'Đã giải quyết',
    className: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  REJECTED: { label: 'Từ chối', className: 'border-transparent bg-muted text-muted-foreground' },
}

const CASE_STATUS_ACTIONS: Array<{ status: string; label: string }> = [
  { status: 'PROCESSING', label: 'Đang xử lý' },
  { status: 'RESOLVED', label: 'Đã giải quyết' },
  { status: 'REJECTED', label: 'Từ chối' },
]

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

// Các trạng thái đích hợp lệ từ trạng thái hiện tại (chỉ tiến theo luồng + có thể hủy)
function allowedNextStatuses(current: string): string[] {
  if (current === 'CANCELLED') return []
  const idx = STATUS_FLOW.indexOf(current as (typeof STATUS_FLOW)[number])
  const forward = idx >= 0 ? STATUS_FLOW.slice(idx + 1) : STATUS_FLOW
  return [...forward, 'CANCELLED']
}

function itemsSummary(order: Order): string {
  if (order.items.length === 0) return '—'
  if (order.items.length === 1) {
    const item = order.items[0]
    return `${item.quantity} × ${item.product?.name ?? 'Sản phẩm'}`
  }
  return `${order.items.length} sản phẩm`
}

function InfoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm font-medium">{children}</div>
    </div>
  )
}

export function OrdersView() {
  const { toast } = useToast()

  // ===== Danh sách đơn hàng + bộ lọc + phân trang server-side =====
  const [orders, setOrders] = useState<OrderWithLineage[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [channelFilter, setChannelFilter] = useState('ALL')
  const [channels, setChannels] = useState<Channel[]>([])

  // Bộ lọc kỳ kế toán + nguồn gốc + trạng thái thay đổi (Data Provenance)
  const [period, setPeriod] = useState<PeriodRange>(EMPTY_PERIOD)
  const [originSource, setOriginSource] = useState('ALL')
  const [changedFilter, setChangedFilter] = useState<ChangedFilter>('ALL')
  const [lineageTarget, setLineageTarget] = useState<LineageInspectorTarget | null>(null)
  // Đối chiếu Kỳ đơn hàng trả về từ API theo bộ lọc hiện tại
  const [periodStats, setPeriodStats] = useState<{
    openingPending: number
    newInPeriod: number
    completedInPeriod: number
    remaining: number
  } | null>(null)

  // Realtime: Agent tự cập nhật đơn → tự refresh danh sách + dialog chi tiết
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtime((e) => {
    if (!['order.created', 'order.updated', 'review.received'].includes(e.type)) return
    if (realtimeTimer.current) clearTimeout(realtimeTimer.current)
    realtimeTimer.current = setTimeout(() => {
      setRefreshKey((k) => k + 1)
      if (detailOpen && detailId) setDetailReload((k) => k + 1)
    }, 600)
  })

  // ===== Dialog chi tiết đơn hàng =====
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailOrder | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReload, setDetailReload] = useState(0)
  const [statusChoice, setStatusChoice] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  // Kiểm đếm đóng gói: số món đã quét theo từng dòng (key = productId) — chỉ là state phiên, không lưu server
  const [scannedCounts, setScannedCounts] = useState<Record<string, number>>({})

  // ===== Sau bán hàng: đổi trả / bảo hành =====
  const [cases, setCases] = useState<AfterSalesCase[]>([])
  const [casesLoading, setCasesLoading] = useState(false)
  const [caseActionId, setCaseActionId] = useState<string | null>(null)
  const [createCaseOpen, setCreateCaseOpen] = useState(false)
  const [caseType, setCaseType] = useState('RETURN')
  const [caseReason, setCaseReason] = useState('')
  const [caseRefund, setCaseRefund] = useState('')
  const [caseHandledBy, setCaseHandledBy] = useState('OPERATOR')
  const [caseSubmitting, setCaseSubmitting] = useState(false)

  // ===== Dialog tạo đơn =====
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<CreateOrderFormState>(EMPTY_CREATE_FORM)
  const [createProducts, setCreateProducts] = useState<Product[]>([])
  const [createLoadingProducts, setCreateLoadingProducts] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [selectedQty, setSelectedQty] = useState('1')
  const [items, setItems] = useState<CreateOrderItem[]>([])
  const [submitting, setSubmitting] = useState(false)

  // ===== Tìm kiếm debounce =====
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (channelFilter !== 'ALL') params.set('channelId', channelFilter)
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      if (period.preset !== 'ALL') {
        params.set('preset', period.preset)
        if (period.preset === 'CUSTOM') {
          if (period.from) params.set('from', period.from)
          if (period.to) params.set('to', period.to)
        }
      }
      if (originSource !== 'ALL') params.set('originSource', originSource)
      if (changedFilter !== 'ALL') params.set('onlyChanged', changedFilter)
      const data = await apiGet<{
        orders: OrderWithLineage[]
        total: number
        page: number
        pageSize: number
        totalPages: number
        period: {
          openingPending: number
          newInPeriod: number
          completedInPeriod: number
          remaining: number
        }
      }>(`/api/orders?${params.toString()}`)
      setOrders(data.orders)
      setTotal(data.total)
      setTotalPages(Math.max(1, data.totalPages))
      setPeriodStats(data.period ?? null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, channelFilter, page, refreshKey, period, originSource, changedFilter])

  useEffect(() => {
    void fetchOrders()
  }, [fetchOrders])

  const fetchChannels = useCallback(async () => {
    try {
      const data = await apiGet<{ channels: Channel[] }>('/api/channels')
      setChannels(data.channels)
    } catch (err) {
      toast({
        title: 'Không thể tải danh sách kênh bán',
        description: errorMessage(err),
        variant: 'destructive',
      })
    }
  }, [toast])

  useEffect(() => {
    void fetchChannels()
  }, [fetchChannels])

  const connectedChannels = useMemo(() => channels.filter((c) => c.connected), [channels])

  // Đổi bộ lọc kỳ/nguồn gốc/trạng thái thay đổi → quay về trang 1
  const applyPeriod = (next: PeriodRange) => {
    setPeriod(next)
    setPage(1)
  }
  const applyOriginSource = (v: string) => {
    setOriginSource(v)
    setPage(1)
  }
  const applyChangedFilter = (v: ChangedFilter) => {
    setChangedFilter(v)
    setPage(1)
  }

  // Mở dialog Truy xuất nguồn gốc & Lịch sử thay đổi của đơn hàng
  const openLineage = (o: OrderWithLineage) => {
    setLineageTarget({ entityType: 'Order', entityId: o.id, entityCode: o.code, label: `Đơn ${o.code}` })
  }

  // ===== Chi tiết đơn hàng =====
  const openDetail = (id: string) => {
    setDetailId(id)
    setDetail(null)
    setDetailError(null)
    setStatusChoice('')
    setCases([])
    setScannedCounts({})
    setDetailOpen(true)
  }

  useEffect(() => {
    if (!detailOpen || !detailId) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    apiGet<{ order: DetailOrder }>(`/api/orders/${detailId}`)
      .then((data) => {
        if (!cancelled) setDetail(data.order)
      })
      .catch((err) => {
        if (!cancelled) setDetailError(errorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailOpen, detailId, detailReload])

  // ===== Fetch vụ sau bán hàng của đơn (reload cùng detailReload) =====
  useEffect(() => {
    if (!detailOpen || !detailId) return
    let cancelled = false
    setCasesLoading(true)
    apiGet<{ cases: AfterSalesCase[] }>(`/api/aftersales?orderId=${detailId}`)
      .then((data) => {
        if (!cancelled) setCases(data.cases)
      })
      .catch(() => {
        if (!cancelled) setCases([])
      })
      .finally(() => {
        if (!cancelled) setCasesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [detailOpen, detailId, detailReload])

  const handleUpdateStatus = async (target: string): Promise<boolean> => {
    if (!detail) return false
    setUpdatingStatus(true)
    try {
      await apiPatch<{ order: Order }>(`/api/orders/${detail.id}`, { status: target })
      toast({
        title: 'Đã cập nhật trạng thái',
        description: `${detail.code} → ${ORDER_STATUS_LABELS[target] ?? target}`,
      })
      setDetailReload((k) => k + 1)
      setRefreshKey((k) => k + 1)
      return true
    } catch (err) {
      toast({
        title: 'Không thể cập nhật trạng thái',
        description: errorMessage(err),
        variant: 'destructive',
      })
      return false
    } finally {
      setUpdatingStatus(false)
      setStatusChoice('')
    }
  }

  const handleStatusSelect = (target: string) => {
    setStatusChoice(target)
    if (target === 'CANCELLED') {
      setConfirmCancelOpen(true)
      return
    }
    void handleUpdateStatus(target)
  }

  const handleConfirmCancel = () => {
    setConfirmCancelOpen(false)
    setStatusChoice('')
    void handleUpdateStatus('CANCELLED')
  }

  // ===== Kiểm đếm đóng gói bằng mã vạch (đơn đang PACKING) =====
  const handlePackingScan = (raw: string) => {
    if (!detail || detail.status !== 'PACKING') return
    const code = raw.trim()
    if (!code) return
    const lower = code.toLowerCase()
    // So khớp mã vạch chính xác trước, không thấy thì so SKU (không phân biệt hoa thường)
    const item =
      detail.items.find((it) => it.product?.barcode != null && it.product.barcode === code) ??
      detail.items.find((it) => it.product?.sku != null && it.product.sku.toLowerCase() === lower)
    if (!item) {
      toast({
        title: `Không thuộc đơn hàng ${detail.code}`,
        description: `Mã quét "${code}" không khớp sản phẩm nào trong đơn.`,
        variant: 'destructive',
      })
      return
    }
    const sku = item.product?.sku ?? item.productId
    const needed = item.quantity
    const scanned = scannedCounts[item.productId] ?? 0
    if (scanned >= needed) {
      // Đã đủ số lượng — vẫn ghi nhận quét thừa (badge "Thừa") nhưng không tính vào tổng đủ
      toast({
        title: `«${sku}» đã đủ ${needed} — quét thừa`,
        description: 'Kiểm tra lại thùng hàng: có thể quét nhầm hoặc bỏ thừa món.',
      })
    } else {
      toast({ title: `${sku}: ${scanned + 1}/${needed}` })
    }
    setScannedCounts((prev) => ({ ...prev, [item.productId]: (prev[item.productId] ?? 0) + 1 }))
  }

  const handlePackingConfirm = async () => {
    if (!detail) return
    const totalUnits = detail.items.reduce((sum, it) => sum + it.quantity, 0)
    const code = detail.code
    // Tái sử dụng hàm PATCH trạng thái hiện có → giữ nguyên timeline + Sổ Data + webhook như bấm tay
    const ok = await handleUpdateStatus('SHIPPING')
    if (ok) {
      setScannedCounts({})
      toast({ title: `Đã kiểm đếm đủ ${totalUnits} món — đơn ${code} chuyển Đang giao` })
    }
  }

  const handleMarkPaid = async () => {
    if (!detail) return
    setMarkingPaid(true)
    try {
      await apiPatch<{ order: Order }>(`/api/orders/${detail.id}`, { paymentStatus: 'PAID' })
      toast({ title: 'Đã xác nhận thanh toán', description: `${detail.code} đã được đánh dấu đã thanh toán.` })
      setDetailReload((k) => k + 1)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast({
        title: 'Không thể cập nhật thanh toán',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setMarkingPaid(false)
    }
  }

  // ===== Sau bán hàng: xử lý nhanh trạng thái + tạo yêu cầu =====
  const handleCaseStatus = async (caseId: string, status: string, label: string) => {
    setCaseActionId(caseId)
    try {
      await apiPatch<{ case: AfterSalesCase }>(`/api/aftersales/${caseId}`, {
        status,
        resolution: `Đã ${label.toLowerCase()} bởi người vận hành`,
      })
      toast({ title: `Đã chuyển yêu cầu sang "${label}"` })
      setDetailReload((k) => k + 1)
    } catch (err) {
      toast({
        title: 'Không thể cập nhật yêu cầu sau bán hàng',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setCaseActionId(null)
    }
  }

  const openCreateCase = () => {
    setCaseType('RETURN')
    setCaseReason('')
    setCaseRefund(detail ? String(Math.round(detail.total)) : '0')
    setCaseHandledBy('OPERATOR')
    setCreateCaseOpen(true)
  }

  const submitCreateCase = async () => {
    if (!detail) return
    if (!caseReason.trim()) {
      toast({ title: 'Vui lòng nhập lý do đổi trả / bảo hành', variant: 'destructive' })
      return
    }
    setCaseSubmitting(true)
    try {
      const data = await apiPost<{ case: AfterSalesCase }>('/api/aftersales', {
        orderId: detail.id,
        type: caseType,
        reason: caseReason.trim(),
        refundAmount: caseType === 'WARRANTY' ? 0 : Math.max(0, Number(caseRefund) || 0),
        handledBy: caseHandledBy,
      })
      toast({
        title: `Đã tạo yêu cầu ${data.case.code}`,
        description: 'Yêu cầu sau bán hàng đã được ghi vào Sổ Data.',
      })
      setCreateCaseOpen(false)
      setDetailReload((k) => k + 1)
    } catch (err) {
      toast({
        title: 'Không thể tạo yêu cầu sau bán hàng',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setCaseSubmitting(false)
    }
  }

  // ===== Tạo đơn hàng =====
  const openCreate = () => {
    setCreateForm(EMPTY_CREATE_FORM)
    setItems([])
    setSelectedProductId('')
    setSelectedQty('1')
    setProductSearch('')
    setCreateOpen(true)
  }

  useEffect(() => {
    if (!createOpen) return
    let cancelled = false
    setCreateLoadingProducts(true)
    apiGet<{ products: Product[] }>('/api/products?status=ACTIVE')
      .then((data) => {
        if (!cancelled) setCreateProducts(data.products)
      })
      .catch((err) => {
        if (!cancelled) {
          toast({
            title: 'Không thể tải danh sách sản phẩm',
            description: errorMessage(err),
            variant: 'destructive',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setCreateLoadingProducts(false)
      })
    return () => {
      cancelled = true
    }
  }, [createOpen, toast])

  const filteredCreateProducts = useMemo(() => {
    const keyword = productSearch.trim().toLowerCase()
    if (!keyword) return createProducts
    return createProducts.filter(
      (p) => p.name.toLowerCase().includes(keyword) || p.sku.toLowerCase().includes(keyword)
    )
  }, [createProducts, productSearch])

  const createTotal = useMemo(
    () => items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [items]
  )

  const handleAddItem = () => {
    const product = createProducts.find((p) => p.id === selectedProductId)
    if (!product) {
      toast({ title: 'Vui lòng chọn một sản phẩm', variant: 'destructive' })
      return
    }
    const qty = Math.max(1, Math.floor(Number(selectedQty) || 1))
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id)
      if (existing) {
        return prev.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + qty } : i))
      }
      return [
        ...prev,
        { productId: product.id, name: product.name, sku: product.sku, price: product.sellPrice, quantity: qty },
      ]
    })
    setSelectedProductId('')
    setSelectedQty('1')
  }

  const changeItemQty = (productId: string, delta: number) => {
    setItems((prev) =>
      prev.map((i) =>
        i.productId === productId ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i
      )
    )
  }

  const removeItem = (productId: string) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId))
  }

  const submitCreate = async () => {
    if (!createForm.channelId) {
      toast({ title: 'Vui lòng chọn kênh bán', variant: 'destructive' })
      return
    }
    if (!createForm.customerName.trim()) {
      toast({ title: 'Vui lòng nhập tên khách hàng', variant: 'destructive' })
      return
    }
    if (items.length === 0) {
      toast({ title: 'Vui lòng thêm ít nhất một sản phẩm vào đơn', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const data = await apiPost<{ order: Order }>('/api/orders', {
        channelId: createForm.channelId,
        customerName: createForm.customerName.trim(),
        customerPhone: createForm.customerPhone.trim(),
        address: createForm.address.trim(),
        note: createForm.note.trim(),
        paymentMethod: createForm.paymentMethod,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      })
      toast({ title: 'Đã tạo đơn hàng', description: `Mã đơn ${data.order.code}` })
      setCreateOpen(false)
      setPage(1)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      // Lỗi 400: hết hàng hoặc dữ liệu không hợp lệ — hiển thị message từ server
      toast({
        title: 'Không thể tạo đơn hàng',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ===== Phân trang hiển thị =====
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)
  const hasFilter =
    search !== '' ||
    statusFilter !== 'ALL' ||
    channelFilter !== 'ALL' ||
    period.preset !== 'ALL' ||
    originSource !== 'ALL' ||
    changedFilter !== 'ALL'
  const nextStatuses = detail ? allowedNextStatuses(detail.status) : []

  // Kiểm đếm đóng gói: tiến độ theo từng dòng (dòng "đủ" = đã quét >= SL cần đóng, quét thừa không tính thêm)
  const packingItems = detail?.items ?? []
  const packingDoneLines = packingItems.filter((it) => (scannedCounts[it.productId] ?? 0) >= it.quantity).length
  const packingAllDone = packingItems.length > 0 && packingDoneLines === packingItems.length

  // Đối soát đơn: phí sàn snapshot lúc tạo + giá vốn từ snapshot costPrice từng dòng (thiếu costPrice tính 0)
  const platformFee = detail?.platformFee ?? 0
  const costTotal = detail ? detail.items.reduce((sum, it) => sum + it.quantity * (it.product?.costPrice ?? 0), 0) : 0
  const netProfit = detail ? detail.subtotal - platformFee - costTotal : 0

  return (
    <div>
      <PageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn hàng từ tất cả các kênh bán">
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Tạo đơn
        </Button>
      </PageHeader>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm mã đơn, tên hoặc SĐT khách..."
            className="pl-8"
            aria-label="Tìm kiếm đơn hàng"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Lọc theo trạng thái">
            <SelectValue placeholder="Tất cả trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_LABELS[s] ?? s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={channelFilter}
          onValueChange={(v) => {
            setChannelFilter(v)
            setPage(1)
          }}
        >
          <SelectTrigger className="w-full sm:w-[170px]" aria-label="Lọc theo kênh bán">
            <SelectValue placeholder="Tất cả kênh" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả kênh</SelectItem>
            {channels.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        </div>

        {/* Bộ lọc Kỳ kế toán + Nguồn gốc dữ liệu + Trạng thái thay đổi */}
        <PeriodFilterBar
          value={period}
          onChange={applyPeriod}
          showOrigin
          showChanged
          originSource={originSource}
          onOriginSourceChange={applyOriginSource}
          changedFilter={changedFilter}
          onChangedFilterChange={applyChangedFilter}
        />
      </div>

      {/* Nội dung chính */}
      {loading ? (
        <TableSkeleton rows={7} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void fetchOrders()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title={hasFilter ? 'Không tìm thấy đơn hàng nào' : 'Chưa có đơn hàng nào'}
          description={
            hasFilter
              ? 'Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc.'
              : 'Các đơn hàng từ mọi kênh bán sẽ hiển thị tại đây.'
          }
          action={
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> Tạo đơn
            </Button>
          }
        />
      ) : (
        <>
          {/* Đối chiếu Kỳ đơn hàng: Đầu kỳ chờ → Đơn mới → Hoàn tất/Hủy → Còn lại cuối kỳ */}
          {periodStats && (
            <div className="mb-4 space-y-1">
              <PeriodSummaryBar
                segments={[
                  { label: 'Đầu kỳ chờ xử lý', value: String(periodStats.openingPending), tone: 'amber' },
                  { label: 'Đơn mới trong kỳ', value: String(periodStats.newInPeriod), tone: 'blue', operator: '+' },
                  { label: 'Hoàn tất/Hủy trong kỳ', value: String(periodStats.completedInPeriod), tone: 'green', operator: '−' },
                  { label: 'Còn lại cuối kỳ', value: String(periodStats.remaining), tone: 'default', operator: '=' },
                ]}
              />
              <p className="text-[11px] text-muted-foreground">Đối chiếu Kỳ đơn hàng — tính theo bộ lọc thời gian hiện tại.</p>
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Kênh</TableHead>
                  <TableHead>Nguồn gốc & Lịch sử</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Sản phẩm</TableHead>
                  <TableHead className="text-right">Tổng tiền</TableHead>
                  <TableHead>Thanh toán</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead>Thời gian</TableHead>
                  <TableHead className="text-right">Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-sm font-medium">{o.code}</TableCell>
                    <TableCell>
                      <ChannelBadge channel={o.channel} className="text-xs" />
                    </TableCell>
                    <TableCell>
                      <DataLineageBadge
                        compact
                        originSource={o.originSource}
                        changeCount={o.changeCount}
                        onInspect={() => openLineage(o)}
                      />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{o.customer?.name ?? 'Khách lẻ'}</p>
                      {o.customer?.phone && (
                        <p className="text-xs text-muted-foreground">{o.customer.phone}</p>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate text-sm">{itemsSummary(o)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-semibold">
                      {formatVND(o.total)}
                    </TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </TableCell>
                    <TableCell>
                      <OrderStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {formatDateTime(o.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => openDetail(o.id)}>
                        <Eye className="mr-1 h-4 w-4" /> Chi tiết
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phân trang server-side */}
          <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              Hiển thị {formatNumber(from)}–{formatNumber(to)} trong {formatNumber(total)} đơn
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Trước
              </Button>
              <span className="text-sm text-muted-foreground">
                Trang {page}/{totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              >
                Sau <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Dialog chi tiết đơn hàng */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2.5">
              {detail ? (
                <>
                  <span className="font-mono">{detail.code}</span>
                  <OrderStatusBadge status={detail.status} />
                </>
              ) : (
                'Chi tiết đơn hàng'
              )}
            </DialogTitle>
            <DialogDescription>Thông tin chi tiết và các sản phẩm trong đơn hàng.</DialogDescription>
          </DialogHeader>

          {detailLoading && !detail ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : detailError ? (
            <ErrorState message={detailError} onRetry={() => setDetailReload((k) => k + 1)} />
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <InfoField label="Kênh bán">
                  <ChannelBadge channel={detail.channel} />
                </InfoField>
                <InfoField label="Khách hàng">{detail.customer?.name ?? 'Khách lẻ'}</InfoField>
                <InfoField label="Số điện thoại">{detail.customer?.phone ?? '—'}</InfoField>
                <InfoField label="Địa chỉ">{detail.address ?? '—'}</InfoField>
                <InfoField label="Thanh toán">
                  <span>{PAYMENT_METHOD_LABELS[detail.paymentMethod] ?? detail.paymentMethod}</span>
                  <PaymentStatusBadge status={detail.paymentStatus} />
                </InfoField>
                <InfoField label="Ghi chú">{detail.note ?? '—'}</InfoField>
              </div>

              <Separator />

              <div className="overflow-x-auto rounded-lg border">
                <Table className="min-w-[420px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead className="text-right">Đơn giá</TableHead>
                      <TableHead className="text-center">SL</TableHead>
                      <TableHead className="text-right">Thành tiền</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          Đơn hàng không có sản phẩm nào.
                        </TableCell>
                      </TableRow>
                    ) : (
                      detail.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <p className="text-sm font-medium">
                              {item.product?.name ?? 'Sản phẩm đã xóa'}
                            </p>
                            {item.product?.sku && (
                              <p className="text-xs text-muted-foreground">{item.product.sku}</p>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm">
                            {formatVND(item.price)}
                          </TableCell>
                          <TableCell className="text-center text-sm">{item.quantity}</TableCell>
                          <TableCell className="whitespace-nowrap text-right text-sm font-medium">
                            {formatVND(item.price * item.quantity)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tạm tính</span>
                  <span>{formatVND(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phí vận chuyển</span>
                  <span>{formatVND(detail.shippingFee)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-base font-semibold">
                  <span>Tổng cộng</span>
                  <span className="text-primary">{formatVND(detail.total)}</span>
                </div>
              </div>

              {/* Đối soát — tóm tắt tài chính: phí sàn snapshot + giá vốn → lợi nhuận thực nhận */}
              <div className="ml-auto w-full max-w-xs space-y-1.5 border-t pt-3 text-sm">
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Calculator className="h-3.5 w-3.5" />
                  Đối soát
                </p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tạm thu (hàng)</span>
                  <span>{formatVND(detail.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phí ship</span>
                  <span>{formatVND(detail.shippingFee)}</span>
                </div>
                {platformFee > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phí sàn</span>
                    <span className="text-rose-600 dark:text-rose-400">
                      {formatVND(platformFee)} ({detail.platformFeePct ?? 0}%)
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Giá vốn</span>
                  <span>{formatVND(costTotal)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-base font-semibold">
                  <span>Lợi nhuận thực nhận</span>
                  <span
                    className={
                      netProfit >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }
                  >
                    {formatVND(netProfit)}
                  </span>
                </div>
              </div>

              {detail.shipments && detail.shipments.length > 0 && detail.shipments[0] && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {carrierName(detail.shipments[0].carrier)} —{' '}
                      <span className="font-mono text-xs">{detail.shipments[0].trackingCode}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Báo bởi {detail.shipments[0].dispatchedBy === 'AGENT' ? 'Agent Kho vận (tự động)' : 'Người vận hành'} · Phí {formatVND(detail.shipments[0].fee)}
                    </p>
                  </div>
                  <ShipmentStatusBadge status={detail.shipments[0].status} />
                </div>
              )}

              {detail.events && detail.events.length > 0 && (
                <div>
                  <p className="mb-3 text-sm font-semibold">Hành trình xử lý (Agent + người vận hành)</p>
                  <div className="max-h-64 space-y-0 overflow-y-auto pr-1 [scrollbar-width:thin]">
                    {[...detail.events].reverse().map((ev, idx, arr) => (
                      <div key={ev.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${EVENT_ACTOR_DOTS[ev.actor] ?? 'bg-slate-400'}`} />
                          {idx < arr.length - 1 && <span className="w-px flex-1 bg-border" />}
                        </div>
                        <div className="min-w-0 flex-1 pb-3">
                          <p className="text-sm leading-snug">{ev.title}</p>
                          {ev.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{ev.detail}</p>}
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {EVENT_ACTOR_LABELS[ev.actor] ?? ev.actor} · {formatDateTime(ev.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {typeof detail.reviewRating === 'number' && detail.reviewRating != null && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-600">
                    {'★'.repeat(detail.reviewRating)}
                    {'☆'.repeat(5 - detail.reviewRating)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">Khách đánh giá {detail.reviewRating}/5</span>
                  </p>
                  {detail.reviewComment && <p className="mt-1 text-sm text-muted-foreground">“{detail.reviewComment}”</p>}
                </div>
              )}

              {/* Sau bán hàng — Đổi trả / Bảo hành */}
              <div className="border-t pt-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Sau bán hàng — Đổi trả / Bảo hành</p>
                  {detail.status === 'COMPLETED' && (
                    <Button variant="outline" size="sm" onClick={openCreateCase}>
                      <LifeBuoy className="mr-1 h-4 w-4" /> Tạo yêu cầu
                    </Button>
                  )}
                </div>

                {detail.status !== 'COMPLETED' ? (
                  <p className="text-xs text-muted-foreground">
                    Có thể tạo đổi trả / bảo hành sau khi đơn hoàn tất.
                  </p>
                ) : casesLoading && cases.length === 0 ? (
                  <Skeleton className="h-12 w-full" />
                ) : cases.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Đơn chưa có yêu cầu đổi trả / bảo hành nào.</p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {cases.map((c) => {
                      const typeBadge = CASE_TYPE_BADGES[c.type] ?? {
                        label: c.type,
                        className: 'border-transparent bg-muted text-muted-foreground',
                      }
                      const statusBadge = CASE_STATUS_BADGES[c.status] ?? {
                        label: c.status,
                        className: 'border-transparent bg-muted text-muted-foreground',
                      }
                      return (
                        <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5">
                          <span className="font-mono text-xs font-semibold">{c.code}</span>
                          <Badge variant="outline" className={`border-transparent ${typeBadge.className}`}>
                            {typeBadge.label}
                          </Badge>
                          <Badge variant="outline" className={`border-transparent ${statusBadge.className}`}>
                            {statusBadge.label}
                          </Badge>
                          <span
                            className="min-w-0 flex-1 basis-40 truncate text-xs text-muted-foreground"
                            title={c.reason}
                          >
                            {c.reason}
                          </span>
                          {c.refundAmount > 0 && (
                            <span className="whitespace-nowrap text-xs font-medium">{formatVND(c.refundAmount)}</span>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                disabled={caseActionId === c.id}
                                aria-label="Xử lý nhanh yêu cầu"
                              >
                                {caseActionId === c.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {CASE_STATUS_ACTIONS.map((action) => (
                                <DropdownMenuItem
                                  key={action.status}
                                  disabled={c.status === action.status}
                                  onClick={() => void handleCaseStatus(c.id, action.status, action.label)}
                                >
                                  {action.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Kiểm đếm đóng gói bằng mã vạch — hiện khi CONFIRMED (rút gọn) / PACKING (đầy đủ) */}
              {(detail.status === 'CONFIRMED' || detail.status === 'PACKING') && (
                <Card className="border-emerald-200/70 dark:border-emerald-900/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ScanLine className="h-5 w-5 text-emerald-500" />
                      Kiểm đếm đóng gói bằng mã vạch
                    </CardTitle>
                    {detail.status === 'CONFIRMED' ? (
                      <CardDescription>
                        Chuyển đơn sang «Đang đóng gói» để bắt đầu kiểm đếm — quét từng sản phẩm bỏ vào thùng.
                      </CardDescription>
                    ) : (
                      <CardDescription>
                        Quét mã vạch từng sản phẩm bỏ vào thùng — đủ hết các dòng mới chuyển giao vận chuyển.
                      </CardDescription>
                    )}
                  </CardHeader>
                  {detail.status === 'PACKING' && (
                    <CardContent className="space-y-3">
                      <BarcodeScanner
                        autoFocus
                        onScan={handlePackingScan}
                        hint="Quét mã vạch sản phẩm để kiểm đếm — quét 1 lần = 1 món đã bỏ vào thùng"
                      />

                      <div className="overflow-x-auto rounded-lg border">
                        <Table className="min-w-[440px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Sản phẩm</TableHead>
                              <TableHead className="text-center">Tiến độ</TableHead>
                              <TableHead className="text-right">Trạng thái</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.items.map((item) => {
                              const scanned = scannedCounts[item.productId] ?? 0
                              const needed = item.quantity
                              const over = scanned > needed
                              const done = scanned >= needed
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <p className="text-sm font-medium">
                                      {item.product?.name ?? 'Sản phẩm đã xóa'}
                                    </p>
                                    {item.product?.sku && (
                                      <p className="text-xs text-muted-foreground">{item.product.sku}</p>
                                    )}
                                    {item.product == null ? null : item.product.barcode ? (
                                      <p className="font-mono text-[11px] text-muted-foreground">{item.product.barcode}</p>
                                    ) : (
                                      <p className="text-xs italic text-muted-foreground">chưa có mã vạch — chọn thủ công</p>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <div className="mx-auto flex w-24 flex-col items-center gap-1">
                                      <span
                                        className={`text-xs font-medium ${
                                          done ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                                        }`}
                                      >
                                        {scanned}/{needed}
                                      </span>
                                      <Progress
                                        value={needed > 0 ? Math.min(100, (scanned / needed) * 100) : 100}
                                        className={`h-1.5 ${done ? '[&>div]:bg-emerald-500' : '[&>div]:bg-amber-500'}`}
                                      />
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {over ? (
                                      <Badge className="border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                                        Thừa {scanned - needed}
                                      </Badge>
                                    ) : done ? (
                                      <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                        Đủ
                                      </Badge>
                                    ) : (
                                      <Badge className="border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                                        Còn {needed - scanned}
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        {packingAllDone ? (
                          <Badge className="border-transparent bg-emerald-100 px-3 py-1 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                            Đã đủ {packingDoneLines}/{packingItems.length} dòng
                          </Badge>
                        ) : (
                          <Badge className="border-transparent bg-amber-100 px-3 py-1 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-400">
                            Còn thiếu {packingItems.length - packingDoneLines}/{packingItems.length} dòng
                          </Badge>
                        )}
                        <Button
                          onClick={() => void handlePackingConfirm()}
                          disabled={!packingAllDone || updatingStatus}
                          className="bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          {updatingStatus ? (
                            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                          ) : (
                            <PackageCheck className="mr-1.5 h-4 w-4" />
                          )}
                          Xác nhận đủ — Chuyển Đang giao
                        </Button>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Việc quét chỉ là kiểm đếm phiên làm việc — dữ liệu chính thức ghi Sổ Data khi chuyển trạng thái.
                      </p>
                    </CardContent>
                  )}
                </Card>
              )}

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">Cập nhật trạng thái</span>
                  <Select
                    value={statusChoice}
                    onValueChange={handleStatusSelect}
                    disabled={updatingStatus || nextStatuses.length === 0}
                  >
                    <SelectTrigger className="w-[190px]">
                      <SelectValue
                        placeholder={nextStatuses.length === 0 ? 'Không thể cập nhật' : 'Chọn trạng thái'}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {nextStatuses.map((s) => (
                        <SelectItem key={s} value={s}>
                          {ORDER_STATUS_LABELS[s] ?? s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {detail.paymentStatus === 'UNPAID' && (
                  <Button onClick={() => void handleMarkPaid()} disabled={markingPaid}>
                    {markingPaid ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Wallet className="mr-1.5 h-4 w-4" />
                    )}
                    Đánh dấu đã thanh toán
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận hủy đơn (cảnh báo hoàn kho) */}
      <ConfirmDialog
        open={confirmCancelOpen}
        onOpenChange={(open) => {
          setConfirmCancelOpen(open)
          if (!open) setStatusChoice('')
        }}
        title={`Hủy đơn hàng ${detail?.code ?? ''}?`}
        description="Đơn hàng sẽ chuyển sang trạng thái Đã hủy và số lượng sản phẩm trong đơn sẽ được hoàn lại vào kho. Hành động này không thể hoàn tác."
        confirmText="Xác nhận hủy đơn"
        destructive
        loading={updatingStatus}
        onConfirm={handleConfirmCancel}
      />

      {/* Dialog tạo đơn hàng */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!submitting) setCreateOpen(open)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Tạo đơn hàng</DialogTitle>
            <DialogDescription>
              Tạo đơn thủ công (POS) — tổng tiền được hệ thống tự tính theo giá hiện tại.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>
                Kênh bán <span className="text-destructive">*</span>
              </Label>
              <Select
                value={createForm.channelId}
                onValueChange={(v) => setCreateForm((f) => ({ ...f, channelId: v }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn kênh bán" />
                </SelectTrigger>
                <SelectContent>
                  {connectedChannels.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      Không có kênh nào đã kết nối
                    </div>
                  ) : (
                    connectedChannels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          {c.name}
                        </span>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              {connectedChannels.length === 0 && (
                <p className="text-xs text-destructive">Chưa có kênh bán nào được kết nối.</p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="order-customer-name">
                  Tên khách hàng <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="order-customer-name"
                  value={createForm.customerName}
                  onChange={(e) => setCreateForm((f) => ({ ...f, customerName: e.target.value }))}
                  placeholder="VD: Nguyễn Văn A"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-customer-phone">Số điện thoại</Label>
                <Input
                  id="order-customer-phone"
                  value={createForm.customerPhone}
                  onChange={(e) => setCreateForm((f) => ({ ...f, customerPhone: e.target.value }))}
                  placeholder="VD: 0901234567"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="order-address">Địa chỉ giao hàng</Label>
                <Input
                  id="order-address"
                  value={createForm.address}
                  onChange={(e) => setCreateForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Phương thức thanh toán</Label>
                <Select
                  value={createForm.paymentMethod}
                  onValueChange={(v) => setCreateForm((f) => ({ ...f, paymentMethod: v }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn phương thức" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="order-note">Ghi chú</Label>
                <Textarea
                  id="order-note"
                  rows={1}
                  value={createForm.note}
                  onChange={(e) => setCreateForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="Ghi chú cho đơn hàng..."
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>Chọn sản phẩm</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Tìm sản phẩm..."
                    className="pl-8"
                    aria-label="Tìm sản phẩm để thêm vào đơn"
                  />
                </div>
                <Select
                  value={selectedProductId}
                  onValueChange={setSelectedProductId}
                  disabled={createLoadingProducts}
                >
                  <SelectTrigger className="w-full sm:w-[240px]">
                    <SelectValue
                      placeholder={createLoadingProducts ? 'Đang tải...' : 'Chọn sản phẩm'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredCreateProducts.length === 0 ? (
                      <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                        Không có sản phẩm phù hợp
                      </div>
                    ) : (
                      filteredCreateProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} · Tồn {p.stock}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  step={1}
                  className="w-full sm:w-20"
                  value={selectedQty}
                  onChange={(e) => setSelectedQty(e.target.value)}
                  aria-label="Số lượng"
                />
                <Button variant="secondary" onClick={handleAddItem}>
                  <Plus className="mr-1 h-4 w-4" /> Thêm
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Sản phẩm trong đơn</Label>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Chưa có sản phẩm nào. Chọn sản phẩm bên trên rồi bấm &quot;Thêm&quot;.
                </p>
              ) : (
                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <div key={item.productId} className="flex items-center gap-2 rounded-lg border p-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatVND(item.price)} · {item.sku}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => changeItemQty(item.productId, -1)}
                          disabled={item.quantity <= 1}
                          aria-label="Giảm số lượng"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </Button>
                        <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => changeItemQty(item.productId, 1)}
                          aria-label="Tăng số lượng"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <span className="w-24 text-right text-sm font-semibold">
                        {formatVND(item.price * item.quantity)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => removeItem(item.productId)}
                        aria-label="Xóa sản phẩm khỏi đơn"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-x-0">
            <p className="text-sm">
              Tạm tính:{' '}
              <span className="text-base font-semibold text-primary">{formatVND(createTotal)}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
                Hủy
              </Button>
              <Button onClick={() => void submitCreate()} disabled={submitting}>
                {submitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                <ShoppingCart className="mr-1.5 h-4 w-4" />
                Tạo đơn hàng
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog tạo yêu cầu sau bán hàng (đổi trả / bảo hành) */}
      <Dialog
        open={createCaseOpen}
        onOpenChange={(open) => {
          if (!caseSubmitting) setCreateCaseOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo yêu cầu sau bán hàng</DialogTitle>
            <DialogDescription>
              Đổi trả / bảo hành cho đơn <span className="font-mono">{detail?.code}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Loại yêu cầu</Label>
              <Select
                value={caseType}
                onValueChange={(v) => {
                  setCaseType(v)
                  setCaseRefund(v === 'RETURN' && detail ? String(Math.round(detail.total)) : '0')
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="RETURN">Đổi trả (hoàn tiền)</SelectItem>
                  <SelectItem value="EXCHANGE">Đổi hàng</SelectItem>
                  <SelectItem value="WARRANTY">Bảo hành</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="aftersales-reason">
                Lý do <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="aftersales-reason"
                rows={3}
                value={caseReason}
                onChange={(e) => setCaseReason(e.target.value)}
                placeholder="Mô tả vấn đề của khách hàng..."
              />
            </div>

            {caseType !== 'WARRANTY' && (
              <div className="space-y-1.5">
                <Label htmlFor="aftersales-refund">Số tiền hoàn (VND)</Label>
                <Input
                  id="aftersales-refund"
                  type="number"
                  min={0}
                  step={1000}
                  value={caseRefund}
                  onChange={(e) => setCaseRefund(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Người xử lý</Label>
              <Select value={caseHandledBy} onValueChange={setCaseHandledBy}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">Người vận hành</SelectItem>
                  <SelectItem value="AGENT">Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCaseOpen(false)} disabled={caseSubmitting}>
              Hủy
            </Button>
            <Button onClick={() => void submitCreateCase()} disabled={caseSubmitting}>
              {caseSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Tạo yêu cầu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Truy xuất nguồn gốc & Lịch sử thay đổi (Diff Trước → Sau) */}
      <LineageInspectorDialog
        open={lineageTarget !== null}
        onOpenChange={(o) => {
          if (!o) setLineageTarget(null)
        }}
        target={lineageTarget}
      />
    </div>
  )
}
