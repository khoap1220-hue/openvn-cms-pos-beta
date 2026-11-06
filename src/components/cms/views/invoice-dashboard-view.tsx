'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { apiGet, apiPost } from '@/lib/api'
import { formatAttributesReadable, formatCompactVND, formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import {
  CircleDollarSign,
  Crown,
  Landmark,
  LockKeyhole,
  Package,
  PackageSearch,
  Receipt,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

interface CashFlowMonth {
  month: number
  in: number
  out: number
  net: number
}

interface InventoryMovementRow {
  id: string
  sku: string
  name: string
  attributes: string | null
  unit: string
  stock: number
  in: number
  out: number
  closing: number
  movement: number
}

interface DashboardData {
  revenue: number
  revenueCount: number
  vatOutput: number
  expense: number
  expenseCount: number
  vatInput: number
  profit: number
  profitMargin: number
  /** tổng phí sàn TMĐT snapshot của các đơn trong kỳ (không hủy) */
  platformFee: number
  /** profit − platformFee — lợi nhuận sau khi trừ phí sàn */
  netProfit: number
  stockNow: number
  stockIn: number
  stockOut: number
  stockChange: number
  cashFlow: CashFlowMonth[]
  invoiceCounts: { sales: number; purchase: number }
  inventory: InventoryMovementRow[]
  periodClosed: boolean
  geminiConfigured: boolean
}

interface AiAnalysisResult {
  cashForecast: string
  stockRisks: string
  profitStrategy: string
  generatedAt: string
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

const AI_SECTIONS = [
  {
    key: 'cashForecast' as const,
    index: '①',
    title: 'Dự báo dòng tiền',
    icon: Landmark,
    iconClass: 'text-emerald-400',
  },
  {
    key: 'stockRisks' as const,
    index: '②',
    title: 'Cảnh báo tồn kho',
    icon: PackageSearch,
    iconClass: 'text-amber-400',
  },
  {
    key: 'profitStrategy' as const,
    index: '③',
    title: 'Chiến lược tối ưu lợi nhuận',
    icon: Crown,
    iconClass: 'text-sky-400',
  },
]

export function InvoiceDashboardView({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [year, setYear] = useState<number>(CURRENT_YEAR)
  const [quarter, setQuarter] = useState<number | null>(null)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<AiAnalysisResult | null>(null)
  const [aiNeedsKey, setAiNeedsKey] = useState(false)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year) })
      if (quarter !== null) params.set('quarter', String(quarter))
      const res = await apiGet<DashboardData>(`/api/invoice-dashboard?${params.toString()}`)
      setData(res)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải dữ liệu dashboard'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [year, quarter])

  useEffect(() => {
    void load()
  }, [load])

  const runAiAnalysis = async () => {
    setAiLoading(true)
    setAiNeedsKey(false)
    try {
      const res = await apiPost<AiAnalysisResult>('/api/ai-analysis', { year, quarter })
      setAiResult(res)
      toast({ title: 'Phân tích AI hoàn tất', description: '3 nhóm nhận định đã được cập nhật bên dưới.' })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'AI không phản hồi, vui lòng thử lại'
      // 400 = thiếu Gemini API Key → gợi ý nhảy sang Hệ thống; 502 = AI không phản hồi → chỉ toast
      setAiNeedsKey(message.includes('API Key'))
      toast({ title: 'Không thể phân tích AI', description: message, variant: 'destructive' })
    } finally {
      setAiLoading(false)
    }
  }

  const yearLabel = quarter !== null ? `Q${quarter}/${year}` : `năm ${year}`
  const stockRatio = data && data.stockIn > 0 ? Math.min(100, Math.max(0, (data.stockOut / data.stockIn) * 100)) : 0

  return (
    <div className="space-y-5">
      <PageHeader
        title="Bảng điều khiển hạch toán"
        description="Tổng quan doanh thu, chi phí, thuế VAT, lợi nhuận và dòng tiền kho theo kỳ kế toán"
      />

      {/* FR-DB-01: Bộ lọc toàn cục Quý / Năm + trạng thái chốt sổ */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={quarter === null ? 'all' : String(quarter)}
          onValueChange={(value) => setQuarter(value === 'all' ? null : Number(value))}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Chọn kỳ" />
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
            <SelectValue placeholder="Chọn năm" />
          </SelectTrigger>
          <SelectContent>
            {YEAR_OPTIONS.map((y) => (
              <SelectItem key={y} value={String(y)}>
                Năm {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {data?.periodClosed && quarter !== null && (
          <Badge className="gap-1 border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
            <LockKeyhole className="h-3 w-3" />
            ĐÃ CHỐT SỔ — Q{quarter}/{year}
          </Badge>
        )}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          {/* FR-DB-02→05: 6 thẻ KPI (gồm Lợi nhuận thực nhận sau phí sàn) */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <StatCard
              title="Doanh thu"
              value={data ? formatCompactVND(data.revenue) : '—'}
              icon={CircleDollarSign}
              loading={loading}
              hint={data ? `${formatNumber(data.revenueCount)} hóa đơn bán` : undefined}
              iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
            />
            <StatCard
              title="Tiền thuế VAT"
              value={data ? formatCompactVND(data.vatOutput) : '—'}
              icon={Receipt}
              loading={loading}
              hint="Thuế VAT bán ra (output)"
              iconClassName="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400"
            />
            <StatCard
              title="Chi phí"
              value={data ? formatCompactVND(data.expense) : '—'}
              icon={Wallet}
              loading={loading}
              hint={data ? `${formatNumber(data.expenseCount)} hóa đơn mua` : undefined}
              iconClassName="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
            />
            <StatCard
              title="Lợi nhuận"
              value={data ? formatCompactVND(data.profit) : '—'}
              icon={TrendingUp}
              loading={loading}
              hint={data ? `Tỷ suất ${Math.round(data.profitMargin * 10) / 10}%` : undefined}
              iconClassName="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400"
            />
            <StatCard
              title="Kho hàng"
              value={data ? formatNumber(data.stockNow) : '—'}
              icon={Package}
              loading={loading}
              hint={
                data
                  ? `Biến động kỳ: ${data.stockChange > 0 ? '+' : ''}${formatNumber(data.stockChange)} sp`
                  : undefined
              }
              iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            />
            <StatCard
              title="Lợi nhuận thực nhận"
              value={data ? formatCompactVND(data.netProfit) : '—'}
              icon={TrendingDown}
              loading={loading}
              hint={data ? `Sau phí sàn ${formatCompactVND(data.platformFee)}` : undefined}
              iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {/* FR-DB-06: Dòng tiền */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Dòng tiền</CardTitle>
                <CardDescription>Đơn vị: VNĐ — năm {year}</CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {loading ? (
                  <div className="h-72 w-full animate-pulse rounded-lg bg-muted" />
                ) : (
                  <ResponsiveContainer width="100%" height={288}>
                    <LineChart data={data?.cashFlow ?? []} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
                      <XAxis
                        dataKey="month"
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => `T${v}`}
                      />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={52}
                        tickFormatter={(v: number) => formatCompactVND(v)}
                      />
                      <Tooltip
                        formatter={(value, name) =>
                          name === 'in'
                            ? [formatVND(Number(value)), 'Tiền vào']
                            : [formatVND(Number(value)), 'Tiền ra']
                        }
                        labelFormatter={(label) => `Tháng ${label}`}
                        contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', fontSize: 13 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="in" name="Tiền vào" stroke="#10b981" strokeWidth={2.5} dot={false} />
                      <Line type="monotone" dataKey="out" name="Tiền ra" stroke="#f43f5e" strokeWidth={2.5} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            {/* FR-DB-07: Lưu chuyển tồn kho */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Lưu chuyển tồn kho</CardTitle>
                <CardDescription>Nhập — xuất kho trong {quarter !== null ? `Quý ${quarter}` : 'cả năm'} {year}</CardDescription>
              </CardHeader>
              <CardContent className="pt-2">
                {loading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-muted" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-emerald-200/70 bg-emerald-50/60 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
                        <p className="text-xs text-muted-foreground">Nhập trong kỳ</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          +{formatNumber(data?.stockIn ?? 0)} sp
                        </p>
                      </div>
                      <div className="rounded-xl border border-rose-200/70 bg-rose-50/60 p-3 dark:border-rose-900/50 dark:bg-rose-950/30">
                        <p className="text-xs text-muted-foreground">Xuất trong kỳ</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-rose-700 dark:text-rose-400">
                          −{formatNumber(data?.stockOut ?? 0)} sp
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-200/70 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                        <p className="text-xs text-muted-foreground">Chênh lệch ròng</p>
                        <p
                          className={cn(
                            'mt-1 text-xl font-bold tabular-nums text-amber-700 dark:text-amber-400'
                          )}
                        >
                          {(data?.stockChange ?? 0) > 0 ? '+' : ''}
                          {formatNumber(data?.stockChange ?? 0)} sp
                        </p>
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                        <span>Tỷ lệ xuất / nhập</span>
                        <span className="font-medium tabular-nums">{Math.round(stockRatio)}%</span>
                      </div>
                      <Progress value={stockRatio} className="h-2.5" />
                      <p className="mt-2 text-xs text-muted-foreground">
                        Xuất {formatNumber(data?.stockOut ?? 0)} sp trên tổng nhập {formatNumber(data?.stockIn ?? 0)} sp
                        — tồn hiện tại {formatNumber(data?.stockNow ?? 0)} sp
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* FR-DB-08: Chi tiết biến động sản phẩm */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Chi tiết biến động sản phẩm</CardTitle>
              <CardDescription>
                Nhập — xuất trong kỳ và tồn cuối kỳ của từng sản phẩm (tồn cuối = hiện tại − nhập + xuất sau kỳ)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4">
                  <TableSkeleton rows={5} />
                </div>
              ) : (
                (() => {
                  const rows = (data?.inventory ?? []).filter((row) => row.in > 0 || row.out > 0 || row.stock !== 0)
                  if (rows.length === 0) {
                    return (
                      <div className="p-4">
                        <EmptyState
                          icon={Package}
                          title="KHÔNG CÓ DỮ LIỆU SẢN PHẨM"
                          description="Không có biến động nhập/xuất và tồn kho bằng 0 trong kỳ đã chọn."
                        />
                      </div>
                    )
                  }
                  return (
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <TableHeader className="sticky top-0 bg-background">
                          <TableRow>
                            <TableHead className="font-mono">MÃ SP</TableHead>
                            <TableHead>TÊN SẢN PHẨM</TableHead>
                            <TableHead className="hidden md:table-cell">ĐẶC TÍNH</TableHead>
                            <TableHead className="text-right">NHẬP TRONG KỲ</TableHead>
                            <TableHead className="text-right">XUẤT TRONG KỲ</TableHead>
                            <TableHead className="text-right">TỒN CUỐI KỲ</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap font-mono text-xs">{row.sku}</TableCell>
                              <TableCell>
                                <p className="max-w-[220px] truncate font-medium">{row.name}</p>
                              </TableCell>
                              <TableCell className="hidden max-w-[200px] md:table-cell">
                                <span
                                  className="block truncate text-sm text-muted-foreground"
                                  title={formatAttributesReadable(row.attributes).text || undefined}
                                >
                                  {formatAttributesReadable(row.attributes).text || '—'}
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                                {row.in > 0 ? `+${formatNumber(row.in)}` : '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-rose-600 dark:text-rose-400">
                                {row.out > 0 ? `−${formatNumber(row.out)}` : '—'}
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                                {formatNumber(row.closing)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )
                })()
              )}
            </CardContent>
          </Card>

          {/* FR-DB-09: Phân tích chuyên sâu AI — card nền tối navy, full-width cuối trang */}
          <Card className="border-slate-800 bg-slate-900 text-slate-100 dark:bg-slate-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Sparkles className="h-5 w-5 text-amber-400" />
                Phân tích chuyên sâu AI
              </CardTitle>
              <CardDescription className="text-slate-400">
                AI đọc toàn bộ chứng từ trong kỳ và đưa ra 3 nhóm nhận định: dự báo dòng tiền, cảnh báo tồn kho,
                chiến lược tối ưu lợi nhuận.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  onClick={() => void runAiAnalysis()}
                  disabled={aiLoading}
                  className="bg-white text-slate-900 hover:bg-slate-200"
                >
                  {aiLoading ? <Sparkles className="h-4 w-4 animate-pulse" /> : <Sparkles className="h-4 w-4" />}
                  PHÂN TÍCH CHUYÊN SÂU
                </Button>
                {data && !data.geminiConfigured && (
                  <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-400">Chưa cấu hình API Key</Badge>
                )}
                {aiNeedsKey && onNavigate && (
                  <Button variant="outline" size="sm" className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white" onClick={() => onNavigate('system')}>
                    <Settings2 className="h-4 w-4" />
                    Cấu hình API Key trong Hệ thống
                  </Button>
                )}
              </div>

              {aiLoading && (
                <p className="flex items-center gap-2 text-sm text-slate-300">
                  <Sparkles className="h-4 w-4 animate-pulse text-amber-400" />
                  Phân tích chuyên sâu từ {(data?.invoiceCounts.sales ?? 0) + (data?.invoiceCounts.purchase ?? 0)} chứng từ...
                </p>
              )}

              {aiResult && !aiLoading && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {AI_SECTIONS.map((section) => {
                      const Icon = section.icon
                      return (
                        <div key={section.key} className="rounded-xl border border-slate-700/70 bg-slate-800/50 p-4">
                          <p className={cn('flex items-center gap-2 text-sm font-semibold', section.iconClass)}>
                            <Icon className="h-4 w-4" />
                            {section.index} {section.title}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
                            {aiResult[section.key]}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-xs text-slate-500">Cập nhật lúc {formatDateTime(aiResult.generatedAt)}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
