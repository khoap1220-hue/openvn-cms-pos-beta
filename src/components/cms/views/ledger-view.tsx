'use client'

// SỔ DATA — nhật ký tổng hợp mọi dữ liệu & thao tác trong hệ thống + Đối soát tự động đa chiều

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  EyeOff,
  Filter,
  Link2,
  Loader2,
  Monitor,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Tag,
} from 'lucide-react'

import { apiGet, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { DataLineageBadge, LineageInspectorDialog, type LineageInspectorTarget } from '@/components/cms/lineage'
import { PeriodFilterBar, PeriodSummaryBar } from '@/components/cms/period-filter-bar'
import { EMPTY_PERIOD, type ChangedFilter, type PeriodRange } from '@/lib/lineage'

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
  // ===== Data Provenance (Truy xuất nguồn gốc & Kiểm toán thay đổi) =====
  originSource?: string | null
  actorName?: string | null
  sourceRefCode?: string | null
  beforeSnapshot?: string | null
  afterSnapshot?: string | null
  changedFields?: string | null
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

// Đối chiếu Kỳ kế toán trả thêm từ /api/ledger (Đầu kỳ → Phát sinh trong kỳ → Nguyên bản / Đã đổi)
interface LedgerPeriodStats {
  beforeCount: number
  inCount: number
  originalCount: number
  changedCount: number
}

// entityType đủ dữ liệu để mở Dialog Truy xuất nguồn gốc (có origin + timeline thay đổi)
const INSPECTABLE_ENTITY_TYPES = new Set([
  'Order',
  'Shipment',
  'Product',
  'Customer',
  'SalesInvoice',
  'PurchaseInvoice',
])

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
    value: 'CUSTOMER',
    label: 'Khách hàng & TV',
    badge: 'border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400',
  },
  {
    value: 'CAMPAIGN',
    label: 'Chương trình & Voucher',
    badge: 'border-transparent bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-400',
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

interface EntryBadges {
  direction?: {
    type: 'SAN_TO_SAN' | 'CMS_TO_CMS' | 'INBOUND' | 'OUTBOUND'
    label: string
    tooltip: string
  }
  isPriceChange?: boolean
  isCampaign?: boolean
  isUnlistedAlert?: boolean
  isSkuLink?: boolean
  isStockReconcile?: boolean
  reconcileReason?: string
}

function extractEntryBadges(entry: LedgerEntry): EntryBadges {
  const title = entry.title || ''
  const action = entry.action || ''
  const scope = entry.scope || ''
  const detail = entry.detail || ''

  let direction: EntryBadges['direction'] | undefined
  if (
    title.includes('SÀN SHOPEE ➔ SÀN SHOPEE') ||
    title.includes('SÀN ➔ SÀN') ||
    action.startsWith('SHOPEE_INTERNAL_') ||
    detail.includes('"direction":"SHOPEE_TO_SHOPEE"')
  ) {
    direction = {
      type: 'SAN_TO_SAN',
      label: 'Sàn ➔ Sàn',
      tooltip: 'Thay đổi phát sinh trực tiếp trên Sàn Shopee Seller Center (Giá, Tồn, Ẩn/Hiện hoặc SP trên Sàn)',
    }
  } else if (
    title.includes('SÀN SHOPEE ➔ CMS') ||
    action.startsWith('SHOPEE_INBOUND') ||
    action === 'OPENING_STOCK_FROM_MARKETPLACE' ||
    action === 'SHOPEE_DIRECT_ADJUSTMENT_RECONCILED' ||
    action === 'SHOPEE_STOCK_AWAITING_ORDER_RECONCILIATION' ||
    action === 'SHOPEE_OPENING_STOCK_CHOICE_REQUIRED' ||
    detail.includes('"direction":"SHOPEE_TO_CMS"')
  ) {
    direction = {
      type: 'INBOUND',
      label: 'Sàn ➔ CMS',
      tooltip: 'Dữ liệu từ sàn Shopee kéo về cập nhật hoặc đối soát vào hệ thống CMS',
    }
  } else if (
    title.includes('CMS ➔ SÀN SHOPEE') ||
    title.includes('CMS ➔ Shopee') ||
    action.startsWith('SHOPEE_OUTBOX') ||
    action.startsWith('OUTBOX_') ||
    action === 'KEEP_WAREHOUSE_STOCK_AND_PUSH' ||
    detail.includes('"direction":"CMS_TO_SHOPEE"')
  ) {
    direction = {
      type: 'OUTBOUND',
      label: 'CMS ➔ Sàn',
      tooltip: 'Dữ liệu từ kho CMS đẩy ra sàn Shopee (đồng bộ tồn / giá / liên kết)',
    }
  } else if (
    title.includes('CMS ➔ CMS') ||
    detail.includes('"direction":"CMS_TO_CMS"') ||
    entry.actor === 'OPERATOR' ||
    scope === 'INVENTORY' ||
    scope === 'INVOICE' ||
    scope === 'CAMPAIGN' ||
    scope === 'SETTINGS' ||
    scope === 'PERIOD'
  ) {
    direction = {
      type: 'CMS_TO_CMS',
      label: 'CMS ➔ CMS',
      tooltip: 'Thao tác thay đổi nội bộ trực tiếp trong hệ thống Quản trị CMS',
    }
  }

  const isPriceChange =
    action === 'PRODUCT_PRICE_CHANGED' ||
    action === 'CHANNEL_PRICE_CHANGED' ||
    title.includes('THAY ĐỔI GIÁ BÁN') ||
    title.includes('Cập nhật giá bán') ||
    (detail.includes('"oldPrice"') && detail.includes('"newPrice"'))

  const isCampaign =
    scope === 'CAMPAIGN' ||
    action.startsWith('CAMPAIGN_') ||
    action.startsWith('VOUCHER_') ||
    title.includes('[CHƯƠNG TRÌNH]')

  const isUnlistedAlert =
    action.includes('UNLISTED') ||
    title.includes('TẠM ẨN') ||
    title.includes('MỞ BÁN LẠI') ||
    title.includes('CẢNH BÁO SÀN')

  const isSkuLink =
    action.includes('LINK') ||
    title.includes('LIÊN KẾT') ||
    title.includes('GHÉP NỐI')

  const isStockReconcile =
    action === 'OPENING_STOCK_FROM_MARKETPLACE' ||
    action === 'KEEP_WAREHOUSE_STOCK_AND_PUSH' ||
    action === 'SHOPEE_DIRECT_ADJUSTMENT_RECONCILED' ||
    action === 'SHOPEE_STOCK_AWAITING_ORDER_RECONCILIATION' ||
    action === 'SHOPEE_OPENING_STOCK_CHOICE_REQUIRED' ||
    action === 'SHOPEE_ORDER_RECONCILIATION_TRIGGERED' ||
    title.includes('GỐC TỒN ĐẦU') ||
    title.includes('ĐỐI SOÁT TỒN SÀN') ||
    title.includes('GIỮ TỒN KHO CMS')

  let reconcileReason: string | undefined
  if (detail && detail.includes('"reason"')) {
    try {
      const parsed = JSON.parse(detail) as Record<string, unknown>
      if (typeof parsed.reason === 'string' && parsed.reason.trim()) {
        reconcileReason = parsed.reason.trim()
      }
    } catch {
      // ignore
    }
  }

  return { direction, isPriceChange, isCampaign, isUnlistedAlert, isSkuLink, isStockReconcile, reconcileReason }
}

interface PriceChangeDetail {
  sku?: string
  name?: string
  oldPrice?: number
  newPrice?: number
  diffPrice?: number
  percentChange?: number
  channel?: string
  actorName?: string
}

function parsePriceDetail(detail: string | null): PriceChangeDetail | null {
  if (!detail) return null
  try {
    const obj = JSON.parse(detail)
    if (obj && (typeof obj.oldPrice === 'number' || typeof obj.newPrice === 'number')) {
      return obj as PriceChangeDetail
    }
  } catch {
    // ignore
  }
  return null
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
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL' | 'PRICE' | 'CAMPAIGN' | 'SAN_TO_SAN' | 'CMS_TO_CMS' | 'INBOUND' | 'OUTBOUND'
  >('ALL')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [restoringTest, setRestoringTest] = useState(false)
  const [testCleanStatus, setTestCleanStatus] = useState<{ clean: boolean; leftoverCount: number } | null>(null)

  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null)

  const checkTestGuardStatus = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; clean: boolean; leftoverCount: number }>('/api/ledger/test-guard')
      setTestCleanStatus({ clean: res.clean, leftoverCount: res.leftoverCount })
    } catch {
      // ignore
    }
  }, [])

  const handleRestoreAndCleanTest = async () => {
    setRestoringTest(true)
    try {
      const res = await apiPost<{ ok: boolean; message: string }>('/api/ledger/test-guard', {
        action: 'RESTORE_AND_CLEAN',
      })
      toast({
        title: 'Đã hoàn nguyên & bảo vệ dữ liệu Beta',
        description: res.message,
      })
      await checkTestGuardStatus()
      setRefreshKey((k) => k + 1)
    } catch (e) {
      toast({
        title: 'Không thể hoàn nguyên dữ liệu test',
        description: errorMessage(e),
        variant: 'destructive',
      })
    } finally {
      setRestoringTest(false)
    }
  }

  // ===== Bộ lọc Kỳ kế toán + Nguồn gốc dữ liệu (Data Provenance) =====
  const [period, setPeriod] = useState<PeriodRange>(EMPTY_PERIOD)
  const [originSource, setOriginSource] = useState('ALL')
  const [changedFilter, setChangedFilter] = useState<ChangedFilter>('ALL')
  const [periodStats, setPeriodStats] = useState<LedgerPeriodStats | null>(null)
  const [lineageTarget, setLineageTarget] = useState<LineageInspectorTarget | null>(null)

  // ===== Tab 2: Đối soát tự động =====
  const [activeTab, setActiveTab] = useState('log')
  const [reconData, setReconData] = useState<ReconciliationData | null>(null)
  const [reconLoading, setReconLoading] = useState(false)
  const [reconError, setReconError] = useState<string | null>(null)

  // Tìm kiếm debounce siêu tốc 150ms (Zero-Flicker)
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 150)
    return () => clearTimeout(timer)
  }, [searchInput])

  const hasLoadedOnceRef = useRef(false)

  // silent = true hoặc sau lần tải đầu tiên: KHÔNG setLoading(true) (tránh flash skeleton khi chuyển bộ lọc nhanh)
  const fetchLedger = useCallback(async (silent = false) => {
    const showSkeleton = !silent && !hasLoadedOnceRef.current
    if (showSkeleton) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (scopeFilter !== 'ALL') params.set('scope', scopeFilter)
      if (
        categoryFilter === 'PRICE' ||
        categoryFilter === 'SAN_TO_SAN' ||
        categoryFilter === 'CMS_TO_CMS' ||
        categoryFilter === 'INBOUND' ||
        categoryFilter === 'OUTBOUND'
      ) {
        params.set('category', categoryFilter)
      }
      if (search) params.set('q', search)
      if (timeFilter !== 'ALL') params.set('days', timeFilter)
      if (period.preset !== 'ALL') params.set('preset', period.preset)
      if (period.preset === 'CUSTOM') {
        if (period.from) params.set('from', period.from)
        if (period.to) params.set('to', period.to)
      }
      if (originSource !== 'ALL') params.set('originSource', originSource)
      if (changedFilter !== 'ALL') params.set('onlyChanged', changedFilter)
      const data = await apiGet<{
        entries: LedgerEntry[]
        counts: Record<string, number>
        period?: LedgerPeriodStats
      }>(`/api/ledger?${params.toString()}`)
      setEntries(data.entries)
      setCounts(data.counts ?? {})
      setPeriodStats(data.period ?? null)
      setError(null)
      hasLoadedOnceRef.current = true
    } catch (err) {
      if (showSkeleton) setError(errorMessage(err))
    } finally {
      if (showSkeleton) setLoading(false)
    }
  }, [scopeFilter, categoryFilter, search, timeFilter, period, originSource, changedFilter, refreshKey])

  useEffect(() => {
    void fetchLedger()
    void checkTestGuardStatus()
  }, [fetchLedger, checkTestGuardStatus])

  // Realtime: có bản ghi Sổ Data mới → refetch sau 1s (giữ nguyên filter);
  // WS hỏng → polling 10s → refetch im lặng (không loading flash)
  const ledgerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtime((e) => {
    if (e.type === 'ledger.new') {
      if (ledgerTimer.current) clearTimeout(ledgerTimer.current)
      ledgerTimer.current = setTimeout(() => setRefreshKey((k) => k + 1), 1000)
    } else if (e.type === 'realtime.poll') {
      void fetchLedger(true)
    }
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

  // Mở Dialog Truy xuất nguồn gốc & Lịch sử thay đổi của đối tượng gốc (nếu bản ghi trỏ về entity)
  const openLineage = (entry: LedgerEntry) => {
    if (!entry.entityType || !entry.entityId) return
    setLineageTarget({
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityCode: entry.entityCode,
      label: entry.entityCode ?? entry.title,
    })
  }

  return (
    <div>
      <PageHeader
        title="Sổ Data"
        description="Mọi dữ liệu và thao tác trong hệ thống đều được ghi lại tại đây (Sàn ➔ Sàn · CMS ➔ CMS · Sàn ➔ CMS · CMS ➔ Sàn) — tự động bảo vệ & hoàn nguyên dữ liệu Beta"
      >
        <div className="flex flex-wrap items-center gap-2">
          {testCleanStatus && (
            <Badge
              variant="outline"
              className={cn(
                'gap-1 px-2.5 py-1 text-xs font-medium',
                testCleanStatus.clean
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {testCleanStatus.clean
                ? 'Dữ liệu Beta sạch 100% (0 rác Test)'
                : `Phát hiện ${testCleanStatus.leftoverCount} bản ghi Test`}
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={restoringTest}
            onClick={() => void handleRestoreAndCleanTest()}
            title="Phục hồi nguyên trạng trước khi test và quét sạch mọi bản ghi phát sinh không phải từ con người"
          >
            {restoringTest ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
            )}
            Phục hồi nguyên trạng sau Test
          </Button>
        </div>
      </PageHeader>

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
          <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
            <Select
              value={scopeFilter}
              onValueChange={(val) => {
                setScopeFilter(val)
                if (val !== 'CAMPAIGN' && categoryFilter === 'CAMPAIGN') {
                  setCategoryFilter('ALL')
                }
              }}
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
            <PeriodFilterBar
              value={period}
              onChange={setPeriod}
              showOrigin
              showChanged
              originSource={originSource}
              onOriginSourceChange={setOriginSource}
              changedFilter={changedFilter}
              onChangedFilterChange={setChangedFilter}
            />
            <div className="relative min-w-[240px] flex-1">
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

          {/* Thanh nút lọc nhanh nghiệp vụ: Đổi giá bán · Chương trình · Chiều đồng bộ */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 p-1.5">
            <span className="mr-1 text-xs font-semibold text-muted-foreground flex items-center gap-1 pl-1">
              <Filter className="h-3 w-3" /> Lọc nhanh:
            </span>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'ALL' && scopeFilter !== 'CAMPAIGN' && !searchInput ? 'secondary' : 'ghost'}
              className="h-7 px-2.5 text-xs font-medium"
              onClick={() => {
                setCategoryFilter('ALL')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              Tất cả
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'PRICE' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-amber-300 dark:border-amber-800 font-medium',
                categoryFilter === 'PRICE'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'text-amber-700 bg-background hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40'
              )}
              onClick={() => {
                setCategoryFilter('PRICE')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              <Tag className="h-3 w-3" />
              Đổi giá bán
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'CAMPAIGN' || scopeFilter === 'CAMPAIGN' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-fuchsia-300 dark:border-fuchsia-800 font-medium',
                categoryFilter === 'CAMPAIGN' || scopeFilter === 'CAMPAIGN'
                  ? 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white'
                  : 'text-fuchsia-700 bg-background hover:bg-fuchsia-50 dark:text-fuchsia-300 dark:hover:bg-fuchsia-950/40'
              )}
              onClick={() => {
                setCategoryFilter('CAMPAIGN')
                setScopeFilter('CAMPAIGN')
                setSearchInput('')
                setSearch('')
              }}
            >
              <Sparkles className="h-3 w-3" />
              Chương trình &amp; Voucher
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'SAN_TO_SAN' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-orange-300 dark:border-orange-800 font-medium',
                categoryFilter === 'SAN_TO_SAN'
                  ? 'bg-orange-600 hover:bg-orange-700 text-white'
                  : 'text-orange-700 bg-background hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/40'
              )}
              onClick={() => {
                setCategoryFilter('SAN_TO_SAN')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              <Store className="h-3 w-3" />
              Sàn ➔ Sàn
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'CMS_TO_CMS' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-teal-300 dark:border-teal-800 font-medium',
                categoryFilter === 'CMS_TO_CMS'
                  ? 'bg-teal-600 hover:bg-teal-700 text-white'
                  : 'text-teal-700 bg-background hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/40'
              )}
              onClick={() => {
                setCategoryFilter('CMS_TO_CMS')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              <Monitor className="h-3 w-3" />
              CMS ➔ CMS
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'INBOUND' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-sky-300 dark:border-sky-800 font-medium',
                categoryFilter === 'INBOUND'
                  ? 'bg-sky-600 hover:bg-sky-700 text-white'
                  : 'text-sky-700 bg-background hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40'
              )}
              onClick={() => {
                setCategoryFilter('INBOUND')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              <ArrowDownLeft className="h-3 w-3" />
              Sàn ➔ CMS (Inbound)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={categoryFilter === 'OUTBOUND' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-indigo-300 dark:border-indigo-800 font-medium',
                categoryFilter === 'OUTBOUND'
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
                  : 'text-indigo-700 bg-background hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40'
              )}
              onClick={() => {
                setCategoryFilter('OUTBOUND')
                setSearchInput('')
                setSearch('')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
              }}
            >
              <ArrowUpRight className="h-3 w-3" />
              CMS ➔ Sàn (Outbound)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={searchInput === 'TẠM ẨN' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-amber-300 dark:border-amber-800 font-medium',
                searchInput === 'TẠM ẨN'
                  ? 'bg-amber-600 hover:bg-amber-700 text-white'
                  : 'text-amber-700 bg-background hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40'
              )}
              onClick={() => {
                setCategoryFilter('ALL')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
                setSearchInput('TẠM ẨN')
                setSearch('TẠM ẨN')
              }}
            >
              <EyeOff className="h-3 w-3" />
              Ẩn/Hiện SP Sàn
            </Button>
            <Button
              type="button"
              size="sm"
              variant={searchInput === 'LIÊN KẾT' ? 'default' : 'outline'}
              className={cn(
                'h-7 px-2.5 text-xs gap-1 border-emerald-300 dark:border-emerald-800 font-medium',
                searchInput === 'LIÊN KẾT'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                  : 'text-emerald-700 bg-background hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-950/40'
              )}
              onClick={() => {
                setCategoryFilter('ALL')
                if (scopeFilter === 'CAMPAIGN') setScopeFilter('ALL')
                setSearchInput('LIÊN KẾT')
                setSearch('LIÊN KẾT')
              }}
            >
              <Link2 className="h-3 w-3" />
              Liên kết SKU
            </Button>
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

          {/* Đối chiếu Kỳ: Đầu kỳ → Phát sinh trong kỳ → Nguyên bản / Đã thay đổi */}
          {periodStats && (
            <div className="mb-3 space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Đối chiếu Kỳ
              </p>
              <PeriodSummaryBar
                segments={[
                  {
                    label: 'Đầu kỳ',
                    sub: 'bản ghi trước kỳ',
                    value: formatNumber(periodStats.beforeCount),
                    tone: 'default',
                  },
                  {
                    label: 'Phát sinh trong kỳ',
                    value: formatNumber(periodStats.inCount),
                    tone: 'blue',
                    operator: '+',
                  },
                  {
                    label: 'Nguyên bản',
                    value: formatNumber(periodStats.originalCount),
                    tone: 'green',
                    operator: '·',
                  },
                  {
                    label: 'Đã thay đổi',
                    value: formatNumber(periodStats.changedCount),
                    tone: 'amber',
                    operator: '·',
                  },
                ]}
              />
            </div>
          )}

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
            <div className="overflow-x-auto rounded-lg border lg:max-h-[540px] lg:overflow-y-auto">
              <Table className="min-w-[920px]">
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Thời gian</TableHead>
                    <TableHead>Phạm vi</TableHead>
                    <TableHead>Hành động</TableHead>
                    <TableHead>Nội dung</TableHead>
                    <TableHead>Nguồn gốc &amp; Lịch sử</TableHead>
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
                    const badges = extractEntryBadges(entry)
                    const rowPriceInfo = badges.isPriceChange ? parsePriceDetail(entry.detail) : null
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
                        <TableCell className="max-w-[420px]">
                          <div className="mb-1 flex flex-wrap items-center gap-1">
                            {badges.direction && (
                              <Badge
                                variant="outline"
                                className={cn(
                                  'h-5 gap-1 py-0 text-[10px] font-bold',
                                  badges.direction.type === 'SAN_TO_SAN'
                                    ? 'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300'
                                    : badges.direction.type === 'CMS_TO_CMS'
                                      ? 'border-teal-300 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/60 dark:text-teal-300'
                                      : badges.direction.type === 'INBOUND'
                                        ? 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                                        : 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                )}
                                title={badges.direction.tooltip}
                              >
                                {badges.direction.type === 'SAN_TO_SAN' ? (
                                  <Store className="h-3 w-3 text-orange-600 dark:text-orange-400" />
                                ) : badges.direction.type === 'CMS_TO_CMS' ? (
                                  <Monitor className="h-3 w-3 text-teal-600 dark:text-teal-400" />
                                ) : badges.direction.type === 'INBOUND' ? (
                                  <ArrowDownLeft className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                                ) : (
                                  <ArrowUpRight className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                                )}
                                {badges.direction.label}
                              </Badge>
                            )}
                            {badges.isPriceChange && (
                              <Badge
                                variant="outline"
                                className="h-5 gap-1 border-amber-300 bg-amber-50 py-0 text-[10px] font-bold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              >
                                <Tag className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                {rowPriceInfo &&
                                rowPriceInfo.oldPrice !== undefined &&
                                rowPriceInfo.newPrice !== undefined
                                  ? `${formatVND(rowPriceInfo.oldPrice)} ➔ ${formatVND(rowPriceInfo.newPrice)}`
                                  : 'Đổi giá bán'}
                              </Badge>
                            )}
                            {badges.isUnlistedAlert && (
                              <Badge
                                variant="outline"
                                className="h-5 gap-1 border-amber-300 bg-amber-50 py-0 text-[10px] font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              >
                                <EyeOff className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                                Ẩn/Hiện SP Sàn
                              </Badge>
                            )}
                            {badges.isSkuLink && (
                              <Badge
                                variant="outline"
                                className="h-5 gap-1 border-emerald-300 bg-emerald-50 py-0 text-[10px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              >
                                <Link2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                Liên kết SKU
                              </Badge>
                            )}
                            {badges.isCampaign && (
                              <Badge
                                variant="outline"
                                className="h-5 gap-1 border-fuchsia-300 bg-fuchsia-50 py-0 text-[10px] font-bold text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-300"
                              >
                                <Sparkles className="h-3 w-3 text-fuchsia-600 dark:text-fuchsia-400" />
                                Chương trình
                              </Badge>
                            )}
                            {badges.isStockReconcile && (
                              <Badge
                                variant="outline"
                                className="h-5 gap-1 border-violet-300 bg-violet-50 py-0 text-[10px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
                              >
                                <ClipboardCheck className="h-3 w-3 text-violet-600 dark:text-violet-400" />
                                Đối soát Tồn &amp; Gốc đầu kỳ
                              </Badge>
                            )}
                          </div>
                          <p className="truncate text-sm font-medium" title={entry.title}>
                            {entry.title}
                          </p>
                          {badges.reconcileReason && (
                            <p
                              className="mt-0.5 truncate rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                              title={`Lý do đối soát / chốt tồn: ${badges.reconcileReason}`}
                            >
                              Lý do: &ldquo;{badges.reconcileReason}&rdquo;
                            </p>
                          )}
                          {entry.entityCode && (
                            <p className="truncate font-mono text-xs text-muted-foreground">
                              {entry.entityCode}
                            </p>
                          )}
                        </TableCell>
                        <TableCell
                          className="whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <DataLineageBadge
                            originSource={entry.originSource}
                            changeCount={entry.changedFields ? 1 : 0}
                            onInspect={
                              entry.entityType && entry.entityId && INSPECTABLE_ENTITY_TYPES.has(entry.entityType)
                                ? () => openLineage(entry)
                                : undefined
                            }
                          />
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
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-left text-base leading-snug">{selectedEntry?.title}</DialogTitle>
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

          {selectedEntry && (() => {
            const badges = extractEntryBadges(selectedEntry)
            const priceInfo = parsePriceDetail(selectedEntry.detail)
            let beforeSnap: Record<string, unknown> | null = null
            let afterSnap: Record<string, unknown> | null = null
            try {
              if (selectedEntry.beforeSnapshot) beforeSnap = JSON.parse(selectedEntry.beforeSnapshot)
              if (selectedEntry.afterSnapshot) afterSnap = JSON.parse(selectedEntry.afterSnapshot)
            } catch {}
            const diffKeys = Array.from(
              new Set([...Object.keys(beforeSnap ?? {}), ...Object.keys(afterSnap ?? {})])
            ).filter((k) => JSON.stringify(beforeSnap?.[k]) !== JSON.stringify(afterSnap?.[k]))

            return (
              <div className="space-y-3">
                {/* Banner 4 chiều thay đổi dữ liệu */}
                {badges.direction && (
                  <div
                    className={cn(
                      'flex items-center justify-between rounded-lg border p-3 text-xs',
                      badges.direction.type === 'SAN_TO_SAN'
                        ? 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200'
                        : badges.direction.type === 'CMS_TO_CMS'
                          ? 'border-teal-200 bg-teal-50 text-teal-900 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200'
                          : badges.direction.type === 'INBOUND'
                            ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
                            : 'border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'
                    )}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      {badges.direction.type === 'SAN_TO_SAN' ? (
                        <>
                          <span className="rounded bg-orange-200 px-2 py-0.5 font-bold dark:bg-orange-800">SÀN SHOPEE</span>
                          <ArrowRight className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                          <span className="rounded bg-orange-200 px-2 py-0.5 font-bold dark:bg-orange-800">SÀN SHOPEE</span>
                        </>
                      ) : badges.direction.type === 'CMS_TO_CMS' ? (
                        <>
                          <span className="rounded bg-teal-200 px-2 py-0.5 font-bold dark:bg-teal-800">KHO CMS NỘI BỘ</span>
                          <ArrowRight className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                          <span className="rounded bg-teal-200 px-2 py-0.5 font-bold dark:bg-teal-800">KHO CMS NỘI BỘ</span>
                        </>
                      ) : badges.direction.type === 'INBOUND' ? (
                        <>
                          <span className="rounded bg-sky-200 px-2 py-0.5 font-bold dark:bg-sky-800">SÀN SHOPEE</span>
                          <ArrowRight className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                          <span className="rounded bg-background px-2 py-0.5 font-bold shadow-sm">KHO CMS NỘI BỘ</span>
                        </>
                      ) : (
                        <>
                          <span className="rounded bg-background px-2 py-0.5 font-bold shadow-sm">KHO CMS NỘI BỘ</span>
                          <ArrowRight className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                          <span className="rounded bg-indigo-200 px-2 py-0.5 font-bold dark:bg-indigo-800">SÀN SHOPEE</span>
                        </>
                      )}
                    </div>
                    <Badge variant="outline" className="border-current font-mono text-[10px] uppercase">
                      {badges.direction.type === 'SAN_TO_SAN'
                        ? 'Shopee Internal'
                        : badges.direction.type === 'CMS_TO_CMS'
                          ? 'CMS Internal'
                          : badges.direction.type === 'INBOUND'
                            ? 'Inbound Sync'
                            : 'Outbound Sync'}
                    </Badge>
                  </div>
                )}

                {/* Bảng Đối chiếu Trước -> Sau trực quan */}
                {diffKeys.length > 0 && (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <p className="mb-2 text-xs font-semibold">Đối chiếu Trước ➔ Sau thay đổi</p>
                    <div className="space-y-1.5 text-xs">
                      {diffKeys.map((k) => (
                        <div key={k} className="grid grid-cols-3 items-center gap-2 rounded border bg-background px-2.5 py-1.5">
                          <span className="font-mono font-medium text-muted-foreground">{k}</span>
                          <span className="truncate text-rose-600 line-through dark:text-rose-400">
                            {beforeSnap?.[k] !== undefined ? String(beforeSnap[k]) : '—'}
                          </span>
                          <span className="truncate font-semibold text-emerald-600 dark:text-emerald-400">
                            ➔ {afterSnap?.[k] !== undefined ? String(afterSnap[k]) : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Card so sánh trực quan biến động giá bán */}
                {priceInfo && (priceInfo.oldPrice !== undefined || priceInfo.newPrice !== undefined) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/30">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                        <Tag className="h-4 w-4 text-amber-600" /> So sánh biến động giá bán
                      </span>
                      {priceInfo.channel && (
                        <Badge variant="outline" className="border-amber-300 bg-background text-[11px] dark:border-amber-700">
                          Kênh: {priceInfo.channel}
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-3">
                      <div className="rounded border bg-background p-2">
                        <span className="block text-[11px] text-muted-foreground">Giá cũ</span>
                        <p className="text-sm font-semibold text-muted-foreground line-through">
                          {priceInfo.oldPrice !== undefined ? formatVND(priceInfo.oldPrice) : '—'}
                        </p>
                      </div>
                      <div className="rounded border bg-background p-2">
                        <span className="block text-[11px] text-muted-foreground">Giá mới</span>
                        <p className="text-sm font-bold text-amber-600 dark:text-amber-400">
                          {priceInfo.newPrice !== undefined ? formatVND(priceInfo.newPrice) : '—'}
                        </p>
                      </div>
                      <div className="col-span-2 flex flex-col justify-center rounded border bg-background p-2 sm:col-span-1">
                        <span className="block text-[11px] text-muted-foreground">Chênh lệch</span>
                        <p
                          className={cn(
                            'flex items-center justify-center gap-1 text-xs font-bold',
                            (priceInfo.diffPrice ?? 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          )}
                        >
                          {(priceInfo.diffPrice ?? 0) >= 0 ? '+' : ''}
                          {formatVND(priceInfo.diffPrice ?? 0)}
                          {priceInfo.percentChange !== undefined && (
                            <span className="text-[10px] font-normal">
                              ({(priceInfo.diffPrice ?? 0) >= 0 ? '+' : ''}{priceInfo.percentChange}%)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Raw JSON detail */}
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Dữ liệu chi tiết (Payload JSON)
                  </p>
                  <pre className="max-h-60 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs leading-relaxed">
                    {prettyDetail(selectedEntry.detail ?? null)}
                  </pre>
                </div>
              </div>
            )
          })()}
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
