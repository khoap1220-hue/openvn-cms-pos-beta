'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Loader2,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  Wallet,
} from 'lucide-react'

import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, PAYMENT_METHOD_LABELS } from '@/lib/types'
import type { Channel, Order, Product } from '@/lib/types'
import { useToast } from '@/hooks/use-toast'

import { Button } from '@/components/ui/button'
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

const PAGE_SIZE = 10
// Luồng xử lý đơn: PENDING → CONFIRMED → PACKING → SHIPPING → COMPLETED (CANCELLED từ mọi trạng thái)
const STATUS_FLOW = ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'COMPLETED'] as const

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
  const [orders, setOrders] = useState<Order[]>([])
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

  // ===== Dialog chi tiết đơn hàng =====
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Order | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailReload, setDetailReload] = useState(0)
  const [statusChoice, setStatusChoice] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [markingPaid, setMarkingPaid] = useState(false)
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)

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
      const data = await apiGet<{
        orders: Order[]
        total: number
        page: number
        pageSize: number
        totalPages: number
      }>(`/api/orders?${params.toString()}`)
      setOrders(data.orders)
      setTotal(data.total)
      setTotalPages(Math.max(1, data.totalPages))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, channelFilter, page, refreshKey])

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

  // ===== Chi tiết đơn hàng =====
  const openDetail = (id: string) => {
    setDetailId(id)
    setDetail(null)
    setDetailError(null)
    setStatusChoice('')
    setDetailOpen(true)
  }

  useEffect(() => {
    if (!detailOpen || !detailId) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    apiGet<{ order: Order }>(`/api/orders/${detailId}`)
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

  const handleUpdateStatus = async (target: string) => {
    if (!detail) return
    setUpdatingStatus(true)
    try {
      await apiPatch<{ order: Order }>(`/api/orders/${detail.id}`, { status: target })
      toast({
        title: 'Đã cập nhật trạng thái',
        description: `${detail.code} → ${ORDER_STATUS_LABELS[target] ?? target}`,
      })
      setDetailReload((k) => k + 1)
      setRefreshKey((k) => k + 1)
    } catch (err) {
      toast({
        title: 'Không thể cập nhật trạng thái',
        description: errorMessage(err),
        variant: 'destructive',
      })
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
  const hasFilter = search !== '' || statusFilter !== 'ALL' || channelFilter !== 'ALL'
  const nextStatuses = detail ? allowedNextStatuses(detail.status) : []

  return (
    <div>
      <PageHeader title="Đơn hàng" description="Theo dõi và xử lý đơn hàng từ tất cả các kênh bán">
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> Tạo đơn
        </Button>
      </PageHeader>

      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
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
          <div className="overflow-x-auto rounded-lg border">
            <Table className="min-w-[960px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Kênh</TableHead>
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
    </div>
  )
}
