'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Package,
  PackageX,
  ShoppingCart,
  Trophy,
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
import { Skeleton } from '@/components/ui/skeleton'
import { StatCard } from '@/components/cms/stat-card'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { ChannelBadge } from '@/components/cms/channel-badge'
import { ErrorState } from '@/components/cms/page-header'
import { formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { apiGet } from '@/lib/api'
import type { DashboardData } from '@/lib/types'
import type { ViewId } from '@/components/cms/app-sidebar'

export function DashboardView({ onNavigate }: { onNavigate?: (view: ViewId) => void }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<DashboardData>('/api/dashboard')
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đã có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (error) {
    return <ErrorState message={error} onRetry={load} />
  }

  const d = data

  return (
    <div className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          loading={loading}
          title="Doanh thu hôm nay"
          value={d ? formatCompactVND(d.stats.revenueToday) : '—'}
          icon={Banknote}
          trend={d?.stats.revenueGrowthPct != null ? { value: d.stats.revenueGrowthPct, label: 'so với tháng trước' } : undefined}
          hint={d ? `Tháng này: ${formatVND(d.stats.revenueMonth)}` : undefined}
        />
        <StatCard
          loading={loading}
          title="Đơn hàng hôm nay"
          value={d ? formatNumber(d.stats.ordersToday) : '—'}
          icon={ShoppingCart}
          iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
          trend={d?.stats.ordersGrowthPct != null ? { value: d.stats.ordersGrowthPct, label: 'so với hôm qua' } : undefined}
          hint={d ? `Giá trị đơn TB: ${formatCompactVND(d.stats.avgOrderValue)}` : undefined}
        />
        <StatCard
          loading={loading}
          title="Đơn chờ xử lý"
          value={d ? formatNumber(d.stats.pendingOrders) : '—'}
          icon={AlertTriangle}
          iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400"
          hint={d ? 'Cần xác nhận & đóng gói' : undefined}
        />
        <StatCard
          loading={loading}
          title="Sản phẩm sắp hết"
          value={d ? formatNumber(d.stats.lowStockCount) : '—'}
          icon={PackageX}
          iconClassName="bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400"
          hint={d ? `Tổng ${d.stats.totalProducts} sản phẩm · ${d.stats.activeChannels}/${d.stats.totalChannels} kênh kết nối` : undefined}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Doanh thu 14 ngày gần nhất</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={d?.revenueByDay ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatCompactVND(v)} />
                  <Tooltip
                    formatter={(value) => [formatVND(Number(value)), 'Doanh thu']}
                    labelFormatter={(label) => `Ngày ${label}`}
                    contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Đơn theo kênh (30 ngày)</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (d?.ordersByChannel.length ?? 0) === 0 ? (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">Chưa có dữ liệu</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={d?.ordersByChannel ?? []}
                      dataKey="orders"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {(d?.ordersByChannel ?? []).map((c) => (
                        <Cell key={c.key} fill={c.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [`${formatNumber(Number(value))} đơn`, name]}
                      contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 13 }}
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
                      <span className="shrink-0 font-medium tabular-nums">{formatNumber(c.orders)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent orders + side lists */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Đơn hàng mới nhất</CardTitle>
            <Button variant="ghost" size="sm" className="text-primary" onClick={() => onNavigate?.('orders')}>
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
            ) : (
              <div className="space-y-0.5">
                {(d?.recentOrders ?? []).map((o) => (
                  <div key={o.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-sm font-medium">{o.code}</p>
                      <p className="truncate text-xs text-muted-foreground">{o.customer?.name ?? 'Khách lẻ'} · {formatDateTime(o.createdAt)}</p>
                    </div>
                    <ChannelBadge channel={o.channel} showName={false} />
                    <OrderStatusBadge status={o.status} className="hidden sm:inline-flex" />
                    <span className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums">{formatVND(o.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Trophy className="h-4 w-4 text-amber-500" /> Top sản phẩm
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
                    <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
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

          <Card>
            <CardHeader className="flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-1.5 text-base">
                <Package className="h-4 w-4 text-red-500" /> Sắp hết hàng
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-primary" onClick={() => onNavigate?.('inventory')}>
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
                    <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.sku}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-400">
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
