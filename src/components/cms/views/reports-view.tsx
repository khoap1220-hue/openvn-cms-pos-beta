'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { StatCard } from '@/components/cms/stat-card'
import { ErrorState } from '@/components/cms/page-header'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { formatCompactVND, formatNumber, formatVND } from '@/lib/format'
import { cn } from '@/lib/utils'
import { apiGet } from '@/lib/api'
import type { PnlData, ReportsData } from '@/lib/types'
import { CheckCircle2, Percent, Receipt, Wallet } from 'lucide-react'

const PERIODS = [
  { days: 7, label: '7 ngày' },
  { days: 30, label: '30 ngày' },
  { days: 90, label: '90 ngày' },
]

// ===== P&L (Task 29) — helpers hiển thị Lợi nhuận Ròng 5 tầng =====

/** Lợi nhuận ròng: emerald khi dương, rose khi âm */
function pnlNetClass(v: number): string {
  return v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
}

/** Badge % Margin: emerald ≥20% · amber 0–20% · rose <0 */
function pnlMarginBadgeClass(pct: number): string {
  if (pct < 0) return 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
  if (pct < 20) return 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
  return 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
}

const COMBO_BADGE_CLASS = 'border-transparent bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400'

/** 1 tầng trong thanh tổng hợp P&L — visually giống PeriodSummaryBar (label nhỏ + giá trị tabular-nums) */
function PnlSegment({
  label,
  value,
  valueClassName,
  badge,
}: {
  label: string
  value: string
  valueClassName?: string
  badge?: ReactNode
}) {
  return (
    <div className="min-w-[92px] rounded-md border bg-muted/40 px-2.5 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-semibold leading-tight tabular-nums', valueClassName)}>{value}</p>
      {badge}
    </div>
  )
}

export function ReportsView() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<ReportsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // P&L 5 tầng — load song song với reports theo cùng kỳ, try/catch riêng:
  // lỗi P&L chỉ ẩn phần P&L, KHÔNG phá các phần báo cáo cũ
  const [pnl, setPnl] = useState<PnlData | null>(null)
  const [pnlLoading, setPnlLoading] = useState(true)

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

  useEffect(() => {
    let cancelled = false
    setPnlLoading(true)
    apiGet<PnlData>(`/api/reports/pnl?days=${days}`)
      .then((res) => {
        if (!cancelled) setPnl(res)
      })
      .catch(() => {
        if (!cancelled) setPnl(null)
      })
      .finally(() => {
        if (!cancelled) setPnlLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [days])

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

          {/* ===== P&L — Báo cáo Lợi nhuận Ròng 5 tầng (Task 29) ===== */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Báo cáo Lợi nhuận Ròng (P&amp;L &amp; Unit Economics)</CardTitle>
              <p className="text-xs text-muted-foreground">
                5 tầng: Doanh thu gộp → Giá vốn → Phí sàn &amp; vận chuyển → Điểm thưởng → Lợi nhuận ròng
                {pnl ? ` · ${pnl.period.label}` : ''}
              </p>
            </CardHeader>
            <CardContent className="space-y-4 pt-2">
              {pnlLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-44 w-full" />
                </div>
              ) : pnl && pnl.summary.orders > 0 ? (
                <>
                  {/* Thanh tổng hợp 5 tầng — visually giống PeriodSummaryBar */}
                  <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border bg-background/60 p-2 text-sm"
                    aria-label="Công thức lợi nhuận ròng 5 tầng"
                    data-testid="pnl-summary-bar"
                  >
                    <PnlSegment
                      label="Doanh thu gộp"
                      value={formatCompactVND(pnl.summary.grossRevenue)}
                      valueClassName="text-emerald-600 dark:text-emerald-400"
                    />
                    <span className="px-0.5 font-semibold text-muted-foreground/70" aria-hidden>
                      −
                    </span>
                    <PnlSegment label="Giá vốn COGS" value={formatCompactVND(pnl.summary.cogs)} />
                    <span className="px-0.5 font-semibold text-muted-foreground/70" aria-hidden>
                      −
                    </span>
                    <PnlSegment label="Phí sàn TMĐT" value={formatCompactVND(pnl.summary.platformFee)} />
                    <span className="px-0.5 font-semibold text-muted-foreground/70" aria-hidden>
                      −
                    </span>
                    <PnlSegment label="Vận chuyển hỗ trợ" value={formatCompactVND(pnl.summary.shippingSubsidy)} />
                    <span className="px-0.5 font-semibold text-muted-foreground/70" aria-hidden>
                      −
                    </span>
                    <PnlSegment label="Điểm thưởng (ước tính)" value={formatCompactVND(pnl.summary.pointsCost)} />
                    <span className="px-0.5 font-semibold text-foreground" aria-hidden>
                      =
                    </span>
                    <PnlSegment
                      label="Lợi nhuận ròng"
                      value={formatCompactVND(pnl.summary.netProfit)}
                      valueClassName={pnlNetClass(pnl.summary.netProfit)}
                      badge={
                        <Badge variant="outline" className={cn('mt-1', pnlMarginBadgeClass(pnl.summary.marginPct))}>
                          {pnl.summary.marginPct}% margin
                        </Badge>
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Gồm {formatNumber(pnl.summary.orders)} đơn chưa hủy · Lợi nhuận ròng đầy đủ:{' '}
                    <span className={cn('font-semibold tabular-nums', pnlNetClass(pnl.summary.netProfit))}>
                      {formatVND(pnl.summary.netProfit)}
                    </span>{' '}
                    trên doanh thu gộp {formatVND(pnl.summary.grossRevenue)}
                  </p>

                  {/* Bảng theo kênh */}
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Lợi nhuận ròng theo kênh</h3>
                    <div className="overflow-x-auto rounded-lg border">
                      <Table className="min-w-[900px]" aria-label="Lợi nhuận ròng theo kênh">
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-4">Kênh</TableHead>
                            <TableHead className="text-right">Số đơn</TableHead>
                            <TableHead className="text-right">Doanh thu gộp</TableHead>
                            <TableHead className="text-right">Giá vốn</TableHead>
                            <TableHead className="text-right">Phí sàn</TableHead>
                            <TableHead className="text-right">Vận chuyển</TableHead>
                            <TableHead className="text-right">Điểm</TableHead>
                            <TableHead className="text-right font-semibold">Lợi nhuận ròng</TableHead>
                            <TableHead className="pr-4 text-right">% Margin</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pnl.byChannel.map((ch) => (
                            <TableRow key={ch.key}>
                              <TableCell className="pl-4">
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: ch.color }} aria-hidden />
                                  <span className="font-medium">{ch.name}</span>
                                </span>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(ch.orders)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatVND(ch.grossRevenue)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(ch.cogs)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(ch.platformFee)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(ch.shippingSubsidy)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(ch.pointsCost)}</TableCell>
                              <TableCell className={cn('text-right font-semibold tabular-nums', pnlNetClass(ch.netProfit))}>
                                {formatVND(ch.netProfit)}
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                <Badge variant="outline" className={pnlMarginBadgeClass(ch.marginPct)}>
                                  {ch.marginPct}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Unit Economics per sản phẩm — max-h-96 cuộn dọc ngay trên table-container để header sticky + scrollbar ngang luôn nhìn thấy */}
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Unit Economics theo sản phẩm</h3>
                    <div className="overflow-hidden rounded-lg border [&_[data-slot=table-container]]:max-h-96 [&_[data-slot=table-container]]:overflow-y-auto [&_[data-slot=table-container]]:[scrollbar-width:thin]">
                      <Table className="min-w-[1000px]" aria-label="Unit Economics theo sản phẩm">
                        <TableHeader className="sticky top-0 z-10 bg-background">
                          <TableRow>
                            <TableHead className="pl-4">Sản phẩm</TableHead>
                            <TableHead className="text-right">SL bán</TableHead>
                            <TableHead className="text-right">Doanh thu</TableHead>
                            <TableHead className="text-right">COGS</TableHead>
                            <TableHead className="text-right">Phí sàn</TableHead>
                            <TableHead className="text-right">Vận chuyển</TableHead>
                            <TableHead className="text-right">Điểm</TableHead>
                            <TableHead className="text-right font-semibold">Lợi nhuận ròng</TableHead>
                            <TableHead className="pr-4 text-right">% Margin</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pnl.products.map((p) => (
                            <TableRow key={p.id}>
                              <TableCell className="max-w-[300px] pl-4">
                                <p className="truncate text-sm font-medium" title={p.name}>
                                  {p.name}
                                </p>
                                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="font-mono">{p.sku}</span>
                                  {p.type === 'COMBO' && (
                                    <Badge variant="outline" className={cn('h-4 px-1.5 text-[10px]', COMBO_BADGE_CLASS)}>
                                      COMBO
                                    </Badge>
                                  )}
                                </p>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{formatNumber(p.units)}</TableCell>
                              <TableCell className="text-right tabular-nums">{formatVND(p.grossRevenue)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(p.cogs)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(p.platformFee)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(p.shippingSubsidy)}</TableCell>
                              <TableCell className="text-right tabular-nums text-muted-foreground">{formatVND(p.pointsCost)}</TableCell>
                              <TableCell className={cn('text-right font-semibold tabular-nums', pnlNetClass(p.netProfit))}>
                                {formatVND(p.netProfit)}
                              </TableCell>
                              <TableCell className="pr-4 text-right">
                                <Badge variant="outline" className={pnlMarginBadgeClass(p.marginPct)}>
                                  {p.marginPct}%
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Dòng giả định ước tính */}
                  <p className="text-xs text-muted-foreground">
                    Ước tính: phí sàn dùng snapshot trên đơn (thiếu thì tính % phí kênh hiện tại) · cước DVVC thay bằng ước
                    tính theo hãng khi chưa ghi thực tế · điểm thưởng quy đổi{' '}
                    {formatNumber(pnl.assumptions.pointValueVnd)}đ/điểm (phát sinh 1 điểm/10.000đ đơn hoàn tất)
                  </p>
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Không có đơn hàng nào trong kỳ — thử chọn kỳ dài hơn để xem lợi nhuận ròng.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
