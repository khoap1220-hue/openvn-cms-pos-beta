'use client'

// SỔ DATA — nhật ký tổng hợp mọi dữ liệu & thao tác trong hệ thống + Đối soát tự động đa chiều

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  ScrollText,
  Search,
} from 'lucide-react'

import { apiGet } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'

// ===== Types =====

interface LedgerEntry {
  id: string
  scope: string
  action: string
  entityType: string | null
  entityId: string | null
  entityCode: string | null
  title: string
  detail: string | null
  actor: string
  createdAt: string
}

interface ReconciliationIssue {
  type: string
  severity: 'warning' | 'error'
  title: string
  count: number
  estimatedValue?: number
  samples: Array<Record<string, unknown>>
}

interface ReconciliationData {
  checkedAt: string
  ok: boolean
  issues: ReconciliationIssue[]
  summary: string
}

// ===== Hằng số hiển thị =====

const SCOPES: Array<{ value: string; label: string; badge: string }> = [
  {
    value: 'ORDER',
    label: 'Đơn hàng',
    badge: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  {
    value: 'INVOICE',
    label: 'Hóa đơn',
    badge: 'border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  },
  {
    value: 'INVENTORY',
    label: 'Kho hàng',
    badge: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  {
    value: 'AGENT',
    label: 'Agent',
    badge: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  },
  {
    value: 'WEBHOOK',
    label: 'Webhook',
    badge: 'border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400',
  },
  {
    value: 'PARTNER',
    label: 'Đối tác',
    badge: 'border-transparent bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-400',
  },
  {
    value: 'BOM',
    label: 'Định mức BOM',
    badge: 'border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  },
  {
    value: 'AFTERSALES',
    label: 'Sau bán hàng',
    badge: 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  },
  {
    value: 'PERIOD',
    label: 'Kỳ sổ sách',
    badge: 'border-transparent bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  {
    value: 'SETTINGS',
    label: 'Cấu hình',
    badge: 'border-transparent bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  },
  {
    value: 'CHANNEL',
    label: 'Kênh bán',
    badge: 'border-transparent bg-lime-100 text-lime-700 dark:bg-lime-950 dark:text-lime-400',
  },
  {
    value: 'MESSAGE',
    label: 'Tin nhắn',
    badge: 'border-transparent bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-400',
  },
  {
    value: 'SYSTEM',
    label: 'Hệ thống',
    badge: 'bg-muted text-muted-foreground',
  },
]

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  SCOPES.map((s) => [s.value, s.label] as const)
)
const SCOPE_BADGES: Record<string, string> = Object.fromEntries(
  SCOPES.map((s) => [s.value, s.badge] as const)
)

const ACTOR_BADGES: Record<string, { label: string; badge: string }> = {
  AGENT: {
    label: 'Agent',
    badge: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  },
  OPERATOR: {
    label: 'Người vận hành',
    badge: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  },
  SYSTEM: { label: 'Hệ thống', badge: 'bg-muted text-muted-foreground' },
  CUSTOMER: {
    label: 'Khách',
    badge: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  API: {
    label: 'API',
    badge: 'border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400',
  },
}

const TIME_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '1', label: 'Hôm nay' },
  { value: '7', label: '7 ngày qua' },
  { value: '30', label: '30 ngày qua' },
  { value: 'ALL', label: 'Tất cả' },
]

const RECON_GUIDES: Array<{ title: string; description: string }> = [
  {
    title: 'Đơn ↔ Hóa đơn',
    description: 'Đơn hàng đã hoàn tất (COMPLETED) nhưng chưa được lập hóa đơn bán tương ứng.',
  },
  {
    title: 'Kho ↔ Hóa đơn mua',
    description: 'Phiếu nhập kho trong 90 ngày qua chưa kèm hóa đơn mua (PM) — nghi nhập hàng không chứng từ.',
  },
  {
    title: 'Tồn kho âm',
    description: 'Sản phẩm có tồn nhỏ hơn 0 do xuất vượt nhập — lỗi dữ liệu kho cần xử lý ngay.',
  },
  {
    title: 'Dòng tiền',
    description: 'Tổng hóa đơn bán POSTED so với tổng đơn COMPLETED trong quý lệch nhau quá 5% và trên 100.000đ.',
  },
]

// ===== Helpers =====

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

/** Parse chi tiết JSON an toàn để hiển thị pretty */
function prettyDetail(detail: string | null): string {
  if (!detail) return '—'
  try {
    const parsed: unknown = JSON.parse(detail)
    if (parsed !== null && typeof parsed === 'object') return JSON.stringify(parsed, null, 2)
    return String(parsed)
  } catch {
    return detail
  }
}

function sampleText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return formatNumber(value)
  return String(value)
}

// ===== Component =====

export function LedgerView() {
  const { toast } = useToast()

  // ===== Tab 1: Nhật ký tổng hợp =====
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  const [scopeFilter, setScopeFilter] = useState('ALL')
  const [timeFilter, setTimeFilter] = useState('ALL')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null)

  // ===== Tab 2: Đối soát tự động =====
  const [activeTab, setActiveTab] = useState('log')
  const [reconData, setReconData] = useState<ReconciliationData | null>(null)
  const [reconLoading, setReconLoading] = useState(false)
  const [reconError, setReconError] = useState<string | null>(null)

  // Tìm kiếm debounce 400ms
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const fetchLedger = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (scopeFilter !== 'ALL') params.set('scope', scopeFilter)
      if (search) params.set('q', search)
      if (timeFilter !== 'ALL') params.set('days', timeFilter)
      const data = await apiGet<{ entries: LedgerEntry[]; counts: Record<string, number> }>(
        `/api/ledger?${params.toString()}`
      )
      setEntries(data.entries)
      setCounts(data.counts ?? {})
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [scopeFilter, search, timeFilter, refreshKey])

  useEffect(() => {
    void fetchLedger()
  }, [fetchLedger])

  // Realtime: có bản ghi Sổ Data mới → refetch sau 1s (giữ nguyên filter)
  const ledgerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtime((e) => {
    if (e.type !== 'ledger.new') return
    if (ledgerTimer.current) clearTimeout(ledgerTimer.current)
    ledgerTimer.current = setTimeout(() => setRefreshKey((k) => k + 1), 1000)
  })

  const runReconciliation = useCallback(async () => {
    setReconLoading(true)
    setReconError(null)
    try {
      const data = await apiGet<ReconciliationData>('/api/reconciliation')
      setReconData(data)
    } catch (err) {
      setReconError(errorMessage(err))
      toast({ title: 'Không thể chạy đối soát', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setReconLoading(false)
    }
  }, [toast])

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    // Mở tab đối soát lần đầu → tự chạy một lượt
    if (value === 'reconciliation' && !reconData && !reconLoading && !reconError) {
      void runReconciliation()
    }
  }

  const countBadges = useMemo(() => SCOPES.filter((s) => (counts[s.value] ?? 0) > 0), [counts])

  return (
    <div>
      <PageHeader
        title="Sổ Data"
        description="Mọi dữ liệu và thao tác trong hệ thống đều được ghi lại tại đây — nhật ký tổng hợp & đối soát tự động"
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger value="log">
            <ScrollText className="mr-1.5 h-4 w-4" />
            Nhật ký tổng hợp
          </TabsTrigger>
          <TabsTrigger value="reconciliation">
            <ClipboardCheck className="mr-1.5 h-4 w-4" />
            Đối soát tự động
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: NHẬT KÝ TỔNG HỢP ===== */}
        <TabsContent value="log" className="mt-0">
          {/* Thanh công cụ */}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              value={scopeFilter}
              onValueChange={setScopeFilter}
            >
              <SelectTrigger className="w-full sm:w-[180px]" aria-label="Lọc theo phạm vi">
                <SelectValue placeholder="Tất cả phạm vi" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả phạm vi</SelectItem>
                {SCOPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={timeFilter}
              onValueChange={setTimeFilter}
            >
              <SelectTrigger className="w-full sm:w-[150px]" aria-label="Lọc theo thời gian">
                <SelectValue placeholder="Thời gian" />
              </SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tìm theo nội dung hoặc mã đối tượng..."
                className="pl-8"
                aria-label="Tìm kiếm trong Sổ Data"
              />
            </div>
          </div>

          {/* Tổng theo scope */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {countBadges.length === 0 ? (
              <span className="text-xs text-muted-foreground">Chưa có bản ghi nào trong Sổ Data.</span>
            ) : (
              countBadges.map((s) => (
                <Badge
                  key={s.value}
                  variant="outline"
                  className={cn('gap-1 border-transparent text-xs', s.badge)}
                >
                  {s.label}
                  <span className="font-semibold">{formatNumber(counts[s.value] ?? 0)}</span>
                </Badge>
              ))
            )}
          </div>

          {/* Bảng nhật ký */}
          {loading ? (
            <TableSkeleton rows={8} />
          ) : error ? (
            <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Không có bản ghi phù hợp"
              description="Thử đổi phạm vi, khoảng thời gian hoặc từ khóa tìm kiếm."
            />
          ) : (
            <div className="max-h-[480px] overflow-y-auto overflow-x-auto rounded-lg border">
              <Table className="min-w-[760px]">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Phạm vi</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Nội dung</TableHead>
                    <TableHead>Thực hiện</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => {
                    const scopeBadge = SCOPE_BADGES[entry.scope] ?? 'bg-muted text-muted-foreground'
                    const actor = ACTOR_BADGES[entry.actor] ?? {
                      label: entry.actor,
                      badge: 'bg-muted text-muted-foreground',
                    }
                    return (
                      <TableRow
                        key={entry.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedEntry(entry)}
                      >
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {formatDateTime(entry.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('border-transparent', scopeBadge)}>
                            {SCOPE_LABELS[entry.scope] ?? entry.scope}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">{entry.action}</TableCell>
                        <TableCell className="max-w-[340px]">
                          <p className="truncate text-sm font-medium" title={entry.title}>
                            {entry.title}
                          </p>
                          {entry.entityCode && (
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {entry.entityCode}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn('border-transparent whitespace-nowrap', actor.badge)}>
                            {actor.label}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Bấm vào một dòng để xem chi tiết JSON của bản ghi. Dữ liệu tự cập nhật realtime.
          </p>
        </TabsContent>

        {/* ===== TAB 2: ĐỐI SOÁT TỰ ĐỘNG ĐA CHIỀU ===== */}
        <TabsContent value="reconciliation" className="mt-0 space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Button onClick={() => void runReconciliation()} disabled={reconLoading}>
                {reconLoading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <ClipboardCheck className="mr-1.5 h-4 w-4" />
                )}
                Chạy đối soát
              </Button>
              {reconData && (
                <span className="text-sm text-muted-foreground">
                  Đối soát lúc <span className="font-medium text-foreground">{formatDateTime(reconData.checkedAt)}</span>
                </span>
              )}
            </div>
          </div>

          {reconLoading && !reconData ? (
            <TableSkeleton rows={4} />
          ) : reconError && !reconData ? (
            <ErrorState message={reconError} onRetry={() => void runReconciliation()} />
          ) : !reconData ? (
            <EmptyState
              icon={ClipboardCheck}
              title="Chưa chạy đối soát"
              description="Chạy đối soát để kiểm tra 4 phép khớp dữ liệu đa chiều của hệ thống."
              action={
                <Button onClick={() => void runReconciliation()} disabled={reconLoading}>
                  {reconLoading && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                  Chạy đối soát ngay
                </Button>
              }
            />
          ) : (
            <>
              {/* Banner tổng */}
              <Card
                className={cn(
                  'shadow-sm',
                  reconData.ok
                    ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
                    : 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30'
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  {reconData.ok ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div>
                    <p
                      className={cn(
                        'font-medium',
                        reconData.ok
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-amber-700 dark:text-amber-400'
                      )}
                    >
                      {reconData.ok ? 'Không phát hiện sai lệch' : 'Phát hiện sai lệch dữ liệu'}
                    </p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{reconData.summary}</p>
                  </div>
                </CardContent>
              </Card>

              {/* Danh sách issues */}
              {reconData.issues.map((issue) => (
                <Card key={issue.type} className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {issue.severity === 'error' ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      )}
                      <p className="font-medium">{issue.title}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'border-transparent',
                          issue.severity === 'error'
                            ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                        )}
                      >
                        {formatNumber(issue.count)} mục
                      </Badge>
                      {typeof issue.estimatedValue === 'number' && (
                        <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">
                          Ước tính {formatVND(issue.estimatedValue)}
                        </Badge>
                      )}
                    </div>

                    {/* Samples theo từng loại đối soát */}
                    {issue.samples.length > 0 &&
                      (issue.type === 'ORDER_NO_INVOICE' ? (
                        <div className={cn(issue.samples.length > 4 && 'max-h-40 overflow-y-auto')}>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Mã đơn</TableHead>
                                <TableHead className="text-right">Giá trị</TableHead>
                                <TableHead>Ngày</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {issue.samples.map((sample, idx) => (
                                <TableRow key={idx}>
                                  <TableCell className="font-mono text-xs font-medium">
                                    {sampleText(sample.code)}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-right text-sm">
                                    {typeof sample.total === 'number' ? formatVND(sample.total) : '—'}
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                    {typeof sample.createdAt === 'string'
                                      ? formatDateTime(sample.createdAt)
                                      : '—'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : issue.type === 'NEGATIVE_STOCK' ? (
                        <div className={cn(issue.samples.length > 4 && 'max-h-40 overflow-y-auto')}>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>SKU</TableHead>
                                <TableHead>Tồn</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {issue.samples.map((sample, idx) => (
                                <TableRow key={idx}>
                                  <TableCell>
                                    <p className="font-mono text-xs font-medium">{sampleText(sample.sku)}</p>
                                    {typeof sample.name === 'string' && (
                                      <p className="text-xs text-muted-foreground">{sampleText(sample.name)}</p>
                                    )}
                                  </TableCell>
                                  <TableCell className="font-mono text-sm font-semibold text-red-600 dark:text-red-400">
                                    {sampleText(sample.stock)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className={cn('space-y-1.5', issue.samples.length > 4 && 'max-h-40 overflow-y-auto')}>
                          {issue.samples.map((sample, idx) => (
                            <p
                              key={idx}
                              className="break-all rounded bg-muted px-2 py-1.5 font-mono text-xs"
                            >
                              {JSON.stringify(sample)}
                            </p>
                          ))}
                        </div>
                      ))}
                  </CardContent>
                </Card>
              ))}
            </>
          )}

          {/* Hướng dẫn 4 phép đối soát */}
          <div className="rounded-lg border bg-muted/30 p-4">
            <p className="mb-2 text-sm font-semibold">4 phép đối soát đa chiều</p>
            <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
              {RECON_GUIDES.map((g) => (
                <div key={g.title} className="rounded-md border bg-background p-2.5">
                  <p className="font-medium text-foreground">{g.title}</p>
                  <p className="mt-0.5">{g.description}</p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialog chi tiết bản ghi */}
      <Dialog
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left text-base">{selectedEntry?.title}</DialogTitle>
            <DialogDescription>
              {selectedEntry && (
                <>
                  {SCOPE_LABELS[selectedEntry.scope] ?? selectedEntry.scope} ·{' '}
                  <span className="font-mono">{selectedEntry.action}</span> ·{' '}
                  {formatDateTime(selectedEntry.createdAt)}
                  {selectedEntry.entityCode && (
                    <>
                      {' '}
                      · <span className="font-mono">{selectedEntry.entityCode}</span>
                    </>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
            {prettyDetail(selectedEntry?.detail ?? null)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
