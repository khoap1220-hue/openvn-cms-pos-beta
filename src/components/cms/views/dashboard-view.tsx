'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Bot,
  Clock,
  ExternalLink,
  MessageSquare,
  Package,
  PackageMinus,
  PackagePlus,
  PackageX,
  Plus,
  Rocket,
  ShoppingCart,
  Store,
  TrendingUp,
  Trophy,
  Truck,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/cms/stat-card'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { ChannelBadge } from '@/components/cms/channel-badge'
import { ErrorState } from '@/components/cms/page-header'
import { formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { apiGet } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import type { DashboardData, LiveOpsData } from '@/lib/types'
import type { ViewId } from '@/components/cms/app-sidebar'
import { cn } from '@/lib/utils'

export function DashboardView({ onNavigate }: { onNavigate?: (view: ViewId) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [liveops, setLiveops] = useState<LiveOpsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState<7 | 14 | 30 | 90>(14)

  const load = useCallback(async (silent = false, targetDays = days) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const [res, ops] = await Promise.all([
        apiGet<DashboardData>(`/api/dashboard?days=${targetDays}`),
        apiGet<LiveOpsData>('/api/liveops').catch(() => null),
      ])
      setData(res)
      if (ops) setLiveops(ops)
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'Đã có lỗi xảy ra')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  useRealtime((e) => {
    if (['order.created', 'order.updated', 'shipment.updated', 'message.new', 'realtime.poll'].includes(e.type)) {
      void load(true)
    }
  })

  if (error) {
    return <ErrorState message={error} onRetry={() => void load()} />
  }

  const d = data
  const masterOn = liveops?.settings.master ?? true

  const todoItems = [
    {
      label: 'Chờ xác nhận',
      count: d?.stats.pendingOrders ?? 0,
      hint: 'Đơn mới cần duyệt',
      icon: Clock,
      tone: 'text-amber-600 bg-amber-50 border-amber-200/80 dark:bg-amber-950/50 dark:text-amber-400 dark:border-amber-900',
      view: 'orders' as ViewId,
    },
    {
      label: 'Đang đóng gói',
      count: liveops?.stats.processing ?? 0,
      hint: 'Chờ quét mã vạch & xuất',
      icon: Package,
      tone: 'text-violet-600 bg-violet-50 border-violet-200/80 dark:bg-violet-950/50 dark:text-violet-400 dark:border-violet-900',
      view: 'orders' as ViewId,
    },
    {
      label: 'Đang giao hàng',
      count: liveops?.stats.shippingCount ?? 0,
      hint: 'Đang trên đường vận chuyển',
      icon: Truck,
      tone: 'text-[#0088FF] bg-sky-50 border-sky-200/80 dark:bg-sky-950/50 dark:text-sky-400 dark:border-sky-900',
      view: 'shipments' as ViewId,
    },
    {
      label: 'Tin nhắn Zalo',
      count: liveops?.stats.unread ?? 0,
      hint: 'Khách hàng chờ phản hồi',
      icon: MessageSquare,
      tone: 'text-teal-600 bg-teal-50 border-teal-200/80 dark:bg-teal-950/50 dark:text-teal-400 dark:border-teal-900',
      view: 'inbox' as ViewId,
    },
    {
      label: 'Sắp hết hàng',
      count: d?.stats.lowStockCount ?? 0,
      hint: 'Cần nhập bổ sung kho',
      icon: PackageX,
      tone: 'text-rose-600 bg-rose-50 border-rose-200/80 dark:bg-rose-950/50 dark:text-rose-400 dark:border-rose-900',
      view: 'inventory' as ViewId,
    },
    {
      label: 'Tác vụ AI hôm nay',
      count: liveops?.stats.tasksToday ?? 0,
      hint: masterOn ? 'Autopilot đang BẬT 100%' : 'Autopilot đang TẮT',
      icon: Bot,
      tone: 'text-emerald-600 bg-emerald-50 border-emerald-200/80 dark:bg-emerald-950/50 dark:text-emerald-400 dark:border-emerald-900',
      view: 'liveops' as ViewId,
    },
  ]

  return (
    <div className="space-y-5">
      {/* ===== Thanh Chào mừng & Thao tác nhanh chuẩn OPENVN ===== */}
      <Card className="border-border/80 bg-gradient-to-r from-[#0066CC]/8 via-card to-card shadow-xs">
        <CardContent className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight sm:text-xl">
                Tổng quan Cửa hàng Ưu Đàm
              </h1>
              <Badge className="bg-[#0066CC] text-white hover:bg-[#0055B3]">
                {d ? `${d.stats.activeChannels}/${d.stats.totalChannels} kênh kết nối` : 'Đa kênh OPENVN'}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'cursor-pointer',
                  masterOn
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50 text-amber-700'
                )}
                onClick={() => onNavigate?.('liveops')}
              >
                <Bot className="mr-1 h-3.5 w-3.5" />
                {masterOn ? 'Agent Autopilot đang vận hành' : 'Chế độ thủ công'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Theo dõi tình hình kinh doanh, tồn kho, đối soát COD và điều phối đơn hàng đa sàn thời gian thực.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="bg-[#0066CC] font-semibold text-white shadow-xs hover:bg-[#0055B3]"
              onClick={() => onNavigate?.('pos')}
            >
              <Store className="mr-1.5 h-4 w-4" /> Bán tại kho (POS)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate?.('orders')}
            >
              <Plus className="mr-1.5 h-4 w-4 text-[#0066CC]" /> Tạo đơn hàng
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNavigate?.('purchase')}>
              <PackagePlus className="mr-1.5 h-4 w-4 text-emerald-600" /> Nhập kho NCC
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNavigate?.('sales')}>
              <PackageMinus className="mr-1.5 h-4 w-4 text-[#0088FF]" /> Xuất hóa đơn VAT
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNavigate?.('products')}>
              <Package className="mr-1.5 h-4 w-4 text-violet-600" /> Sản phẩm
            </Button>
            <Button size="sm" variant="outline" onClick={() => onNavigate?.('liveops')}>
              <Rocket className="mr-1.5 h-4 w-4 text-amber-600" /> Điều hành AI
            </Button>
            <Button size="sm" variant="ghost" asChild className="text-primary">
              <a href="/store" target="_blank" rel="noreferrer">
                <Store className="mr-1.5 h-4 w-4" /> Cửa hàng <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ===== Việc cần xử lý hôm nay (OPENVN Actionable Status Strip) ===== */}
      <Card className="border-border/80 shadow-xs">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 pt-4">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-[#0088FF]" />
            Việc cần xử lý trong ngày
          </CardTitle>
          <span className="text-xs text-muted-foreground">Nhấn vào từng mục để xử lý ngay</span>
        </CardHeader>
        <CardContent className="pb-4 pt-0">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {todoItems.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => onNavigate?.(item.view)}
                className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-[#0088FF]/50 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
                    {item.label}
                  </span>
                  <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', item.tone)}>
                    <item.icon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <div className="mt-2">
                  {loading ? (
                    <Skeleton className="h-7 w-14" />
                  ) : (
                    <p className="text-2xl font-bold tracking-tight tabular-nums text-foreground group-hover:text-[#0088FF]">
                      {formatNumber(item.count)}
                    </p>
                  )}
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.hint}</p>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ===== 4 Thẻ KPI Doanh thu & Đơn hàng chuẩn OPENVN ===== */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loading}
          title="Doanh thu hôm nay"
          value={d ? formatCompactVND(d.stats.revenueToday) : '—'}
          icon={Banknote}
          iconClassName="bg-[#0088FF]/10 text-[#0088FF]"
          trend={d?.stats.revenueGrowthPct != null ? { value: d.stats.revenueGrowthPct, label: 'so với tháng trước' } : undefined}
          hint={d ? `Tháng này: ${formatVND(d.stats.revenueMonth)}` : undefined}
        />
        <StatCard
          loading={loading}
          title="Đơn hàng hôm nay"
          value={d ? formatNumber(d.stats.ordersToday) : '—'}
          icon={ShoppingCart}
          iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
          trend={d?.stats.ordersGrowthPct != null ? { value: d.stats.ordersGrowthPct, label: 'so với hôm qua' } : undefined}
          hint={d ? `Giá trị đơn TB: ${formatCompactVND(d.stats.avgOrderValue)}` : undefined}
        />
        <StatCard
          loading={loading}
          title="Doanh thu tháng này"
          value={d ? formatCompactVND(d.stats.revenueMonth) : '—'}
          icon={TrendingUp}
          iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-950 dark:text-violet-400"
          hint={d ? `Đơn hoàn tất & đang vận hành` : undefined}
        />
        <StatCard
          loading={loading}
          title="Danh mục & Tồn kho"
          value={d ? `${formatNumber(d.stats.totalProducts)} SP` : '—'}
          icon={Package}
          iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
          hint={d ? `${d.stats.lowStockCount} sản phẩm chạm ngưỡng cảnh báo` : undefined}
        />
      </div>

      {/* ===== Biểu đồ Doanh thu OPENVN Blue & Tỷ trọng Kênh bán ===== */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="border-border/80 shadow-xs xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Biểu đồ doanh thu {days} ngày gần nhất</CardTitle>
              <p className="text-xs text-muted-foreground">Tổng hợp doanh thu thực tế từ tất cả các kênh bán</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs">
                {([7, 14, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setDays(d)
                      void load(false, d)
                    }}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      days === d
                        ? 'bg-background font-semibold text-[#0066CC] shadow-xs dark:text-sky-400'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {d} ngày
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" className="text-xs font-semibold text-[#0066CC] dark:text-sky-400" onClick={() => onNavigate?.('reports')}>
                Báo cáo chi tiết <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={d?.revenueByDay ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="openvnRevenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0088FF" stopOpacity={0.32} />
                      <stop offset="100%" stopColor="#0088FF" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatCompactVND(v)} />
                  <Tooltip
                    formatter={(value) => [formatVND(Number(value)), 'Doanh thu']}
                    labelFormatter={(label) => `Ngày ${label}`}
                    contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#0088FF" strokeWidth={2.5} fill="url(#openvnRevenueGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/80 shadow-xs">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Tỷ trọng đơn theo kênh (30 ngày)</CardTitle>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs font-semibold text-[#0066CC] dark:text-sky-400" onClick={() => onNavigate?.('channels')}>
              Kênh bán
            </Button>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (d?.ordersByChannel.length ?? 0) === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">Chưa có dữ liệu</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={185}>
                  <PieChart>
                    <Pie
                      data={d?.ordersByChannel ?? []}
                      dataKey="orders"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={76}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {(d?.ordersByChannel ?? []).map((c) => (
                        <Cell key={c.key} fill={c.color} aria-label={`${c.name}: ${c.orders} đơn`} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${formatNumber(Number(value))} đơn`, name]}
                      contentStyle={{ borderRadius: 10, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-2 space-y-1.5">
                  {(d?.ordersByChannel ?? []).slice(0, 5).map((c) => (
                    <div key={c.key} className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatNumber(c.orders)} đơn</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ===== Đơn hàng mới nhất + Top sản phẩm + Cảnh báo tồn kho ===== */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="border-border/80 shadow-xs xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base">Đơn hàng mới nhất</CardTitle>
              <p className="text-xs text-muted-foreground">Nhấn vào đơn hàng để chuyển tới màn hình xử lý</p>
            </div>
            <Button variant="ghost" size="sm" className="font-semibold text-[#0066CC] dark:text-sky-400" onClick={() => onNavigate?.('orders')}>
              Xem tất cả <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (d?.recentOrders ?? []).length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Chưa có đơn hàng nào.</p>
            ) : (
              <div className="divide-y divide-border/60">
                {(d?.recentOrders ?? []).map((o) => (
                  <div
                    key={o.id}
                    onClick={() => onNavigate?.('orders')}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-semibold text-[#0066CC] dark:text-sky-400">{o.code}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.customer?.name ?? 'Khách lẻ'} · {formatDateTime(o.createdAt)}
                      </p>
                    </div>
                    <ChannelBadge channel={o.channel} showName={false} />
                    <OrderStatusBadge status={o.status} className="hidden sm:inline-flex" />
                    <span className="w-28 shrink-0 text-right text-sm font-bold tabular-nums">{formatVND(o.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Trophy className="h-4 w-4 text-amber-500" /> Top sản phẩm bán chạy
              </CardTitle>
              <span className="text-xs text-muted-foreground">30 ngày</span>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-1">
                  {(d?.topProducts ?? []).map((p, i) => (
                    <div
                      key={p.id}
                      onClick={() => onNavigate?.('products')}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
                    >
                      <span
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                          i === 0
                            ? 'bg-amber-500 text-white'
                            : i === 1
                              ? 'bg-slate-400 text-white'
                              : i === 2
                                ? 'bg-amber-700 text-white'
                                : 'bg-primary/10 text-primary'
                        )}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{formatNumber(p.sold)} đã bán</p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatCompactVND(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/80 shadow-xs">
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Package className="h-4 w-4 text-rose-500" /> Cảnh báo sắp hết hàng
              </CardTitle>
              <Button variant="ghost" size="sm" className="font-semibold text-[#0066CC] dark:text-sky-400" onClick={() => onNavigate?.('inventory')}>
                Nhập kho
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (d?.lowStockProducts.length ?? 0) === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Tất cả sản phẩm đều đủ hàng ✅</p>
              ) : (
                <div className="space-y-1">
                  {(d?.lowStockProducts ?? []).map((p) => (
                    <div
                      key={p.id}
                      onClick={() => onNavigate?.('inventory')}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                        Còn {p.stock}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
