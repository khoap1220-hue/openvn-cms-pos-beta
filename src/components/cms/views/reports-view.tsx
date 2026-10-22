'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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
import { ErrorState } from '@/components/cms/page-header'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { formatCompactVND, formatNumber, formatVND } from '@/lib/format'
import { apiGet } from '@/lib/api'
import type { ReportsData } from '@/lib/types'
import { CheckCircle2, Percent, Receipt, Wallet } from 'lucide-react'

const PERIODS = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
]

export function ReportsView() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<ReportsData>(`/api/reports?days=${days}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Đã có lỗi xảy ra')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    load()
  }, [load])

  const maxChannelRevenue = Math.max(1, ...(data?.revenueByChannel ?? []).map((c) => c.revenue))
  const statusColors: Record<string, string> = {
    COMPLETED: '#10b981',
    SHIPPING: '#f59e0b',
    PACKING: '#8b5cf6',
    CONFIRMED: '#14b8a6',
    PENDING: '#fbbf24',
    CANCELLED: '#ef4444',
  }

  return (
    <div className="space-y-5">
      {/* Period switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">Báo cáo & phân tích</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Doanh thu, hiệu quả kênh bán và sản phẩm bán chạy</p>
        </div>
        <div className="flex rounded-lg border p-1">
          {PERIODS.map((p) => (
            <Button
              key={p.days}
              variant={days === p.days ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-3"
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              loading={loading}
              title={`Doanh thu ${days} ngày`}
              value={data ? formatCompactVND(data.summary.revenue) : '—'}
              icon={Wallet}
              hint={data ? `${formatVND(data.summary.revenue)} · đã loại trừ đơn hủy` : undefined}
            />
            <StatCard
              loading={loading}
              title="Số đơn hàng"
              value={data ? formatNumber(data.summary.orders) : '—'}
              icon={Receipt}
              iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950 dark:text-orange-400"
            />
            <StatCard
              loading={loading}
              title="Giá trị đơn trung bình"
              value={data ? formatCompactVND(data.summary.avgOrderValue) : '—'}
              icon={Percent}
              iconClassName="bg-teal-100 text-teal-600 dark:bg-teal-950 dark:text-teal-400"
              hint={data ? formatVND(data.summary.avgOrderValue) : undefined}
            />
            <StatCard
              loading={loading}
              title="Tỉ lệ hoàn thành"
              value={data ? `${data.summary.completionRate}%` : '—'}
              icon={CheckCircle2}
              iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
              hint={data ? `Tỉ lệ hủy: ${data.summary.cancelRate}%` : undefined}
            />
          </div>

          {/* Revenue trend */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Xu hướng doanh thu</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {loading ? (
                <Skeleton className="h-[280px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={data?.revenueByDay ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => formatCompactVND(v)} />
                    <Tooltip
                      formatter={(value, name) =>
                        name === 'revenue' ? [formatVND(Number(value)), 'Doanh thu'] : [formatNumber(Number(value)), 'Đơn hàng']
                      }
                      labelFormatter={(label) => `Ngày ${label}`}
                      contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="orders" stroke="#f59e0b" strokeWidth={2} dot={false} yAxisId="right" />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={32} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* Revenue by channel */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Doanh thu theo kênh</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {loading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <div className="space-y-4">
                    {(data?.revenueByChannel ?? []).map((c) => (
                      <div key={c.key}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="shrink-0 text-xs text-muted-foreground">{formatNumber(c.orders)} đơn</span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{formatVND(c.revenue)}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(2, (c.revenue / maxChannelRevenue) * 100)}%`, backgroundColor: c.color }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Status distribution */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Phân bố trạng thái đơn hàng</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                {loading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : (
                  <div className="grid h-[300px] grid-cols-2 items-center">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={data?.statusDistribution ?? []} dataKey="count" nameKey="status" innerRadius={50} outerRadius={85} paddingAngle={3} strokeWidth={0}>
                          {(data?.statusDistribution ?? []).map((s) => (
                            <Cell key={s.status} fill={statusColors[s.status] ?? '#a3a3a3'} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value, name) => [`${formatNumber(Number(value))} đơn`, name]}
                          contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 pr-2">
                      {(data?.statusDistribution ?? []).map((s) => (
                        <div key={s.status} className="flex items-center justify-between gap-2 text-sm">
                          <OrderStatusBadge status={s.status} />
                          <span className="font-medium tabular-nums">{formatNumber(s.count)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Top products */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Sản phẩm bán chạy</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {(data?.topProducts ?? []).map((p, i) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.sku}</p>
                      </div>
                      <div className="hidden w-28 shrink-0 text-right text-sm tabular-nums text-muted-foreground sm:block">
                        {formatNumber(p.sold)} SP
                      </div>
                      <span className="w-32 shrink-0 text-right text-sm font-semibold tabular-nums">{formatVND(p.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
