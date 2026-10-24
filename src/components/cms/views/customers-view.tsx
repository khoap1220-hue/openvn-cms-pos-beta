'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatNumber, formatVND, formatDate } from '@/lib/format'
import type { Customer, MemberTier, MemberTierInfo } from '@/lib/types'
import { MEMBER_TIERS, POINTS_VND_RATE } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import {
  Users,
  Wallet,
  Crown,
  Trophy,
  Sparkles,
  Search,
  UserPlus,
  Loader2,
  UserX,
  ChevronRight,
  Coins,
  Plus,
  Minus,
  History,
  BadgeCheck,
  Gift,
} from 'lucide-react'

interface CustomerFormState {
  name: string
  phone: string
  email: string
  address: string
}

const EMPTY_FORM: CustomerFormState = { name: '', phone: '', email: '', address: '' }

interface CustomersStats {
  totalCustomers: number
  memberCount: number
  customerCount: number
  pointsIssued: number
}

interface DetailOrder {
  id: string
  code: string
  status: string
  total: number
  paymentMethod: string
  createdAt: string
}

interface CustomerDetail {
  customer: Customer
  orders: DetailOrder[]
}

// Tra cấu hình hạng (badge/bar class) theo key — server trả MemberTierInfo (key/label/ngưỡng)
const TIER_BY_KEY = Object.fromEntries(MEMBER_TIERS.map((t) => [t.key, t])) as Record<string, MemberTier>
const tierBar = (key: string): string => TIER_BY_KEY[key]?.bar ?? 'bg-stone-400'

// ===== Badge hạng thành viên (cục bộ) =====
function TierBadge({ tier, className }: { tier?: MemberTierInfo | null; className?: string }) {
  if (!tier) return null
  const config = TIER_BY_KEY[tier.key]
  return (
    <Badge variant="outline" className={`gap-1 font-semibold ${config?.badge ?? ''} ${className ?? ''}`}>
      <Crown className="h-3 w-3" />
      {tier.label}
    </Badge>
  )
}

export function CustomersView() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [stats, setStats] = useState<CustomersStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'MEMBER' | 'CUSTOMER'>('ALL')

  // Dialog thêm khách hàng
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  // Dialog chi tiết khách hàng / thành viên
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  // Dialog cộng / trừ điểm
  const [pointsMode, setPointsMode] = useState<'EARN' | 'REDEEM' | null>(null)
  const [pointsInput, setPointsInput] = useState('')
  const [pointsNote, setPointsNote] = useState('')
  const [pointsSubmitting, setPointsSubmitting] = useState(false)

  // Debounce ô tìm kiếm 400ms
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(
    async (keyword: string, scope: 'ALL' | 'MEMBER' | 'CUSTOMER') => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (keyword) params.set('search', keyword)
        if (scope !== 'ALL') params.set('scope', scope)
        const qs = params.toString()
        const data = await apiGet<{ customers: Customer[]; stats: CustomersStats }>(`/api/customers${qs ? `?${qs}` : ''}`)
        setCustomers(data.customers)
        setStats(data.stats)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Không thể tải khách hàng'
        setError(message)
        toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void load(search, scopeFilter)
  }, [load, search, scopeFilter])

  const openAddDialog = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Vui lòng nhập tên khách hàng', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      await apiPost<{ customer: Customer }>('/api/customers', {
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
      })
      toast({ title: 'Đã thêm khách hàng', description: form.name.trim() })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Thêm khách hàng thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ===== Chi tiết khách hàng =====
  const refreshDetail = useCallback(async (customerId: string) => {
    const data = await apiGet<CustomerDetail>(`/api/customers/${customerId}`)
    setDetail(data)
    return data
  }, [])

  const openDetail = async (customerId: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      await refreshDetail(customerId)
    } catch (e) {
      toast({
        title: 'Không thể tải chi tiết khách hàng',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  // ===== Nâng cấp thành viên =====
  const handleUpgrade = async () => {
    if (!detail) return
    setUpgrading(true)
    try {
      const res = await apiPost<{ customer: Customer }>(`/api/customers/${detail.customer.id}/member`, {})
      toast({
        title: 'Đã nâng cấp thành viên',
        description: `${res.customer.name} — mã thành viên ${res.customer.memberCode}`,
      })
      setUpgradeOpen(false)
      await refreshDetail(detail.customer.id)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Nâng cấp thành viên thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setUpgrading(false)
    }
  }

  // ===== Cộng / trừ điểm =====
  const openPointsDialog = (mode: 'EARN' | 'REDEEM') => {
    setPointsMode(mode)
    setPointsInput('')
    setPointsNote('')
  }

  const handlePoints = async () => {
    if (!detail || !pointsMode) return
    const amount = Number(pointsInput)
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ title: 'Số điểm phải là số nguyên dương', variant: 'destructive' })
      return
    }
    if (pointsMode === 'REDEEM' && amount > (detail.customer.points ?? 0)) {
      toast({
        title: 'Vượt số điểm hiện có',
        description: `Thành viên chỉ còn ${detail.customer.points ?? 0} điểm`,
        variant: 'destructive',
      })
      return
    }
    setPointsSubmitting(true)
    try {
      const res = await apiPost<{ customer: Customer }>(`/api/customers/${detail.customer.id}/points`, {
        mode: pointsMode,
        points: amount,
        note: pointsNote,
      })
      toast({
        title: pointsMode === 'EARN' ? `Đã cộng ${amount} điểm` : `Đã trừ ${amount} điểm`,
        description: `${res.customer.name} — hiện có ${res.customer.points} điểm`,
      })
      setPointsMode(null)
      await refreshDetail(detail.customer.id)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Cập nhật điểm thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setPointsSubmitting(false)
    }
  }

  const totals = useMemo(() => {
    const list = customers ?? []
    const totalSpent = list.reduce((s, c) => s + (c.stats?.totalSpent ?? 0), 0)
    const top = list.reduce<Customer | null>((best, c) => {
      if (!c.stats) return best
      if (!best?.stats || c.stats.totalSpent > best.stats.totalSpent) return c
      return best
    }, null)
    return { totalSpent, top }
  }, [customers])

  const memberPct = stats && stats.totalCustomers > 0 ? Math.round((stats.memberCount / stats.totalCustomers) * 100) : 0
  const detailTier = detail?.customer.isMember ? detail.customer.tier : null

  // % tiến độ tới hạng kế của 1 dòng trong bảng (member)
  const tierProgress = (c: Customer): { pct: number; bar: string } | null => {
    if (!c.isMember || !c.tier) return null
    return { pct: c.tier.progressPct ?? 0, bar: tierBar(c.tier.key) }
  }

  return (
    <div>
      <PageHeader
        title="Khách hàng"
        description="Khách hàng ⇒ Thành viên: quản lý hồ sơ, nâng cấp thành viên, tích điểm và hạng thân thiết"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Tổng khách hàng"
          value={loading ? '' : formatNumber(stats?.totalCustomers ?? 0)}
          icon={Users}
          loading={loading}
          hint="Toàn bộ khách hàng trong hệ thống"
        />
        <StatCard
          title="Thành viên"
          value={loading ? '' : formatNumber(stats?.memberCount ?? 0)}
          icon={Crown}
          loading={loading}
          hint={`+${formatNumber(stats?.customerCount ?? 0)} khách hàng thường · ${memberPct}% chuyển đổi`}
        />
        <StatCard
          title="Tổng doanh thu từ khách"
          value={loading ? '' : formatVND(totals.totalSpent)}
          icon={Wallet}
          loading={loading}
          hint="Không tính đơn đã hủy"
        />
        <StatCard
          title="Điểm đã phát hành"
          value={loading ? '' : formatNumber(stats?.pointsIssued ?? 0)}
          icon={Sparkles}
          loading={loading}
          hint={`Quy đổi 1 điểm / ${formatNumber(POINTS_VND_RATE)}₫`}
        />
        <StatCard
          title="Khách chi tiêu cao nhất"
          value={loading ? '' : totals.top?.name ?? '—'}
          icon={Trophy}
          loading={loading}
          hint={totals.top?.stats ? `Đã chi ${formatVND(totals.top.stats.totalSpent)}` : 'Chưa có dữ liệu'}
        />
      </div>

      {/* Toolbar: tìm kiếm + lọc thành viên + thêm khách hàng */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm tên, SĐT, email, mã TV..."
              className="pl-9"
              aria-label="Tìm kiếm khách hàng"
            />
          </div>
          <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as 'ALL' | 'MEMBER' | 'CUSTOMER')}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Lọc loại khách hàng">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả</SelectItem>
              <SelectItem value="MEMBER">Thành viên</SelectItem>
              <SelectItem value="CUSTOMER">Khách hàng thường</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openAddDialog} className="shrink-0">
          <UserPlus className="h-4 w-4" />
          Thêm khách hàng
        </Button>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load(search, scopeFilter)} />
          ) : !customers || customers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={search || scopeFilter !== 'ALL' ? UserX : Users}
                title={search || scopeFilter !== 'ALL' ? 'Không tìm thấy khách hàng nào' : 'Chưa có khách hàng nào'}
                description={
                  search || scopeFilter !== 'ALL'
                    ? 'Không có kết quả phù hợp với bộ lọc hiện tại. Thử từ khóa hoặc bộ lọc khác.'
                    : 'Thêm khách hàng đầu tiên để bắt đầu quản lý đơn hàng.'
                }
                action={
                  <Button onClick={openAddDialog}>
                    <UserPlus className="h-4 w-4" />
                    Thêm khách hàng
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Hạng thành viên</TableHead>
                    <TableHead>Số điện thoại</TableHead>
                    <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
                    <TableHead className="text-right">Số đơn</TableHead>
                    <TableHead className="text-right">Tổng chi tiêu</TableHead>
                    <TableHead className="w-32 text-right">Điểm</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Đơn cuối</TableHead>
                    <TableHead aria-label="Chi tiết" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => {
                    const progress = tierProgress(c)
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => void openDetail(c.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ProductAvatar name={c.name} className="h-9 w-9" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{c.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{c.email || 'Chưa có email'}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {c.isMember ? (
                            <div className="flex flex-col items-start gap-1">
                              <TierBadge tier={c.tier} />
                              <span className="font-mono text-[10px] text-muted-foreground">{c.memberCode}</span>
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground">Khách hàng</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{c.phone || '—'}</TableCell>
                        <TableCell className="hidden max-w-[220px] md:table-cell">
                          <span className="block truncate text-sm text-muted-foreground" title={c.address ?? undefined}>
                            {c.address || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(c.stats?.orderCount ?? 0)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatVND(c.stats?.totalSpent ?? 0)}</TableCell>
                        <TableCell className="text-right">
                          {c.isMember ? (
                            <div className="flex flex-col items-end gap-1">
                              <span className="font-mono text-sm font-semibold tabular-nums">{formatNumber(c.points ?? 0)} đ</span>
                              {progress && (
                                <div className="h-1 w-20 overflow-hidden rounded-full bg-muted" title={`Tiến độ tới hạng kế: ${progress.pct}%`}>
                                  <div className={`h-full rounded-full ${progress.bar}`} style={{ width: `${progress.pct}%` }} />
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                          {c.stats?.lastOrderAt ? formatDate(c.stats.lastOrderAt) : '—'}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
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

      {/* Dialog thêm khách hàng */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm khách hàng</DialogTitle>
            <DialogDescription>Điền thông tin khách hàng mới. Chỉ tên là bắt buộc.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="customer-name">
                Tên khách hàng <span className="text-destructive">*</span>
              </Label>
              <Input
                id="customer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nguyễn Văn A"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="customer-phone">Số điện thoại</Label>
                <Input
                  id="customer-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0901234567"
                  inputMode="tel"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="khach@email.com"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-address">Địa chỉ</Label>
              <Textarea
                id="customer-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting || !form.name.trim()}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm khách hàng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog chi tiết khách hàng / thành viên */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {detailLoading || !detail ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">Chi tiết khách hàng</DialogTitle>
                <div className="flex items-start gap-3 pt-1">
                  <ProductAvatar name={detail.customer.name} className="h-12 w-12 text-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold leading-tight">{detail.customer.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {detail.customer.phone || 'Chưa có SĐT'}
                      {detail.customer.email ? ` · ${detail.customer.email}` : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {detail.customer.isMember ? (
                        <>
                          <TierBadge tier={detailTier} />
                          <span className="font-mono text-xs font-semibold text-muted-foreground">{detail.customer.memberCode}</span>
                        </>
                      ) : (
                        <Badge variant="outline" className="font-medium text-muted-foreground">Khách hàng thường</Badge>
                      )}
                    </div>
                  </div>
                </div>
              </DialogHeader>

              {/* Khối thành viên: điểm + hạng / mời gia nhập */}
              {detail.customer.isMember ? (
                <div className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Điểm tích lũy</p>
                      <p className="mt-0.5 flex items-baseline gap-1.5">
                        <Coins className="h-5 w-5 text-amber-500" aria-hidden />
                        <span className="text-3xl font-bold tabular-nums">{formatNumber(detail.customer.points ?? 0)}</span>
                        <span className="text-sm text-muted-foreground">điểm</span>
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Tham gia: {detail.customer.memberAt ? formatDate(detail.customer.memberAt) : '—'}</p>
                      <p className="mt-0.5">1 điểm / {formatNumber(POINTS_VND_RATE)}₫ đơn hoàn tất</p>
                    </div>
                  </div>

                  {/* Tiến độ hạng */}
                  {detailTier && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium">{detailTier.label}</span>
                        <span className="text-muted-foreground">
                          {detailTier.nextLabel
                            ? `Cần thêm ${formatVND(Math.max(0, (detailTier.nextThreshold ?? 0) - (detail.customer.stats?.totalSpent ?? 0)))} nữa để lên ${detailTier.nextLabel}`
                            : 'Hạng cao nhất của chương trình'}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${tierBar(detailTier.key)}`}
                          style={{ width: `${detailTier.progressPct ?? 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openPointsDialog('EARN')}>
                      <Plus className="h-4 w-4" />
                      Cộng điểm
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => openPointsDialog('REDEEM')}
                      disabled={(detail.customer.points ?? 0) <= 0}
                    >
                      <Minus className="h-4 w-4" />
                      Trừ điểm (đổi quà)
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-muted/40 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                      <Gift className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">Nâng cấp thành chương trình thành viên</p>
                      <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        <li>• Tích 1 điểm / {formatNumber(POINTS_VND_RATE)}₫ mỗi đơn hoàn tất — đổi quà, giảm giá</li>
                        <li>• Hạng tự động: Bạc ({formatVND(1_000_000)}) → Vàng ({formatVND(3_000_000)}) → Kim cương ({formatVND(6_000_000)})</li>
                        <li>• Cấp mã thành viên riêng, ghi nhận vào Sổ Data</li>
                      </ul>
                      <Button size="sm" className="mt-3" onClick={() => setUpgradeOpen(true)}>
                        <Sparkles className="h-4 w-4" />
                        Nâng cấp thành viên
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* Lịch sử đơn hàng */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <History className="h-4 w-4 text-muted-foreground" aria-hidden />
                    Lịch sử đơn hàng
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(detail.customer.stats?.orderCount ?? 0)} đơn · {formatVND(detail.customer.stats?.totalSpent ?? 0)}
                  </p>
                </div>
                {detail.orders.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Khách hàng chưa có đơn hàng nào
                  </p>
                ) : (
                  <div className="max-h-64 overflow-y-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-9 text-xs">Đơn</TableHead>
                          <TableHead className="h-9 text-xs">Trạng thái</TableHead>
                          <TableHead className="h-9 text-right text-xs">Tổng</TableHead>
                          <TableHead className="h-9 text-right text-xs">Ngày</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.orders.map((o) => (
                          <TableRow key={o.id}>
                            <TableCell className="py-1.5 font-mono text-xs">{o.code}</TableCell>
                            <TableCell className="py-1.5">
                              <OrderStatusBadge status={o.status} className="text-[10px]" />
                            </TableCell>
                            <TableCell className="py-1.5 text-right font-mono text-xs tabular-nums">{formatVND(o.total)}</TableCell>
                            <TableCell className="py-1.5 text-right text-xs text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận nâng cấp thành viên */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-amber-500" aria-hidden />
              Nâng cấp thành viên
            </DialogTitle>
            <DialogDescription>
              Xác nhận nâng cấp <span className="font-semibold text-foreground">{detail?.customer.name}</span> thành thành viên của chương trình khách hàng thân thiết?
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <li>• Cấp mã thành viên (TV…) và ngày tham gia</li>
            <li>• Tích 1 điểm / {formatNumber(POINTS_VND_RATE)}₫ cho mỗi đơn hoàn tất từ thời điểm này</li>
            <li>• Hạng Bạc / Vàng / Kim cương tự động theo tổng chi tiêu</li>
            <li>• Thao tác ghi vào Sổ Data (MEMBER_REGISTERED)</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)} disabled={upgrading}>
              Hủy
            </Button>
            <Button onClick={() => void handleUpgrade()} disabled={upgrading}>
              {upgrading && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận nâng cấp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cộng / trừ điểm */}
      <Dialog open={pointsMode !== null} onOpenChange={(open) => !open && setPointsMode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{pointsMode === 'EARN' ? 'Cộng điểm (bù điểm)' : 'Trừ điểm (đổi quà / giảm giá)'}</DialogTitle>
            <DialogDescription>
              {detail?.customer.name} — hiện có <span className="font-semibold text-foreground">{formatNumber(detail?.customer.points ?? 0)} điểm</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-2">
              <Label htmlFor="points-amount">
                Số điểm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="points-amount"
                type="number"
                min={1}
                value={pointsInput}
                onChange={(e) => setPointsInput(e.target.value)}
                placeholder={pointsMode === 'EARN' ? 'VD: 50' : 'VD: 20'}
                autoFocus
              />
              {pointsMode === 'REDEEM' && (
                <p className="text-xs text-muted-foreground">Tối đa {formatNumber(detail?.customer.points ?? 0)} điểm.</p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="points-note">Lý do</Label>
              <Textarea
                id="points-note"
                value={pointsNote}
                onChange={(e) => setPointsNote(e.target.value)}
                placeholder={pointsMode === 'EARN' ? 'VD: Bù điểm do sự cố đơn hàng' : 'VD: Đổi voucher giảm 50.000₫'}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPointsMode(null)} disabled={pointsSubmitting}>
              Hủy
            </Button>
            <Button
              onClick={() => void handlePoints()}
              disabled={pointsSubmitting || !pointsInput}
            >
              {pointsSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {pointsMode === 'EARN' ? 'Cộng điểm' : 'Trừ điểm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
