'use client'

// BỘ LỌC THỜI GIAN CHUẨN KẾ TOÁN + Thanh đối chiếu Kỳ
// (Đầu kỳ → Phát sinh trong kỳ → Cuối kỳ) dùng chung cho Sổ Data, Tồn kho,
// Vận chuyển, Đơn hàng. Hỗ trợ query params: from, to, originSource, onlyChanged.

import { useState } from 'react'
import { CalendarRange, ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  CHANGED_FILTER_LABELS,
  ORIGIN_SOURCES,
  ORIGIN_SOURCE_KEYS,
  PERIOD_PRESET_LABELS,
  type ChangedFilter,
  type PeriodPreset,
  type PeriodRange,
} from '@/lib/lineage'

const PRESET_ORDER: PeriodPreset[] = ['ALL', 'TODAY', 'YESTERDAY', 'LAST7', 'THIS_MONTH', 'LAST_MONTH', 'CUSTOM']

export interface PeriodFilterBarProps {
  value: PeriodRange
  onChange: (next: PeriodRange) => void
  /** Hiển thị bộ lọc Nguồn gốc dữ liệu */
  showOrigin?: boolean
  /** Hiển thị bộ lọc Trạng thái thay đổi (Nguyên bản / Đã đổi) */
  showChanged?: boolean
  /** Thu hẹp danh sách nguồn gốc hiển thị (vd Vận chuyển chỉ có Agent/Quản trị viên) */
  originOptions?: Array<keyof typeof ORIGIN_SOURCES>
  originSource?: string
  onOriginSourceChange?: (v: string) => void
  changedFilter?: ChangedFilter
  onChangedFilterChange?: (v: ChangedFilter) => void
  className?: string
}

export function PeriodFilterBar({
  value,
  onChange,
  showOrigin = false,
  showChanged = false,
  originOptions,
  originSource = 'ALL',
  onOriginSourceChange,
  changedFilter = 'ALL',
  onChangedFilterChange,
  className,
}: PeriodFilterBarProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const activeCount =
    (value.preset !== 'ALL' ? 1 : 0) +
    (showOrigin && originSource !== 'ALL' ? 1 : 0) +
    (showChanged && changedFilter !== 'ALL' ? 1 : 0)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Nút thu gọn / mở rộng bộ lọc kỳ & nguồn gốc trên điện thoại (< sm) */}
      <div className="flex items-center justify-between sm:hidden">
        <button
          type="button"
          onClick={() => setMobileExpanded((v) => !v)}
          className={cn(
            'inline-flex min-h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors',
            activeCount > 0 || mobileExpanded
              ? 'border-[#0066CC]/40 bg-sky-50/70 text-[#0066CC] dark:border-sky-800 dark:bg-sky-950/35 dark:text-sky-300'
              : 'border-border bg-card text-muted-foreground'
          )}
        >
          <span className="inline-flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>
              Lọc kỳ &amp; Nguồn gốc ({PERIOD_PRESET_LABELS[value.preset]})
            </span>
            {activeCount > 0 && (
              <span className="rounded-full bg-[#0066CC] px-1.5 py-0.5 text-[10px] font-bold text-white">
                {activeCount}
              </span>
            )}
          </span>
          {mobileExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      <div
        className={cn(
          'flex-col gap-2 sm:flex sm:flex-row sm:flex-wrap sm:items-center',
          mobileExpanded ? 'flex rounded-xl border bg-muted/25 p-2.5 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0' : 'hidden sm:flex'
        )}
      >
      {/* Chọn nhanh kỳ */}
      <div className="flex items-center gap-2">
        <CalendarRange className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Select
          value={value.preset}
          onValueChange={(v) => onChange({ ...value, preset: v as PeriodPreset })}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Chọn kỳ thời gian">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESET_ORDER.map((p) => (
              <SelectItem key={p} value={p}>
                {PERIOD_PRESET_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Khoảng ngày tùy chỉnh */}
      {value.preset === 'CUSTOM' && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={value.from}
            max={value.to || undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            aria-label="Từ ngày"
            className="w-full sm:w-36"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            value={value.to}
            min={value.from || undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            aria-label="Đến ngày"
            className="w-full sm:w-36"
          />
        </div>
      )}

      {/* Nguồn gốc dữ liệu */}
      {showOrigin && (
        <Select value={originSource} onValueChange={(v) => onOriginSourceChange?.(v)}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Lọc theo nguồn gốc dữ liệu">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Mọi nguồn gốc</SelectItem>
            {(originOptions ?? ORIGIN_SOURCE_KEYS).map((k) => (
              <SelectItem key={k} value={k}>
                {ORIGIN_SOURCES[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Trạng thái thay đổi */}
      {showChanged && (
        <Select value={changedFilter} onValueChange={(v) => onChangedFilterChange?.(v as ChangedFilter)}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Lọc theo trạng thái thay đổi">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CHANGED_FILTER_LABELS) as ChangedFilter[]).map((k) => (
              <SelectItem key={k} value={k}>
                {CHANGED_FILTER_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      </div>
    </div>
  )
}

// ============================================================
// PeriodSummaryBar — thanh đối chiếu Kỳ (Đầu kỳ → Phát sinh → Cuối kỳ)
// ============================================================

export interface PeriodSummarySegment {
  label: string
  value: string
  sub?: string
  tone?: 'default' | 'green' | 'red' | 'amber' | 'violet' | 'blue' | 'emerald'
  operator?: string // dấu hiển thị trước ô: '', '+', '−', '='
}

const TONE_CLASSES: Record<NonNullable<PeriodSummarySegment['tone']>, string> = {
  default: 'bg-muted/50 border-border',
  green: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900',
  emerald: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900',
  red: 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900',
  amber: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900',
  violet: 'bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-900',
  blue: 'bg-sky-50 border-sky-200 dark:bg-sky-950/40 dark:border-sky-900',
}

const OPERATOR_CLASSES: Record<string, string> = {
  '+': 'text-emerald-600 dark:text-emerald-400',
  '−': 'text-red-600 dark:text-red-400',
  '=': 'text-foreground',
}

export function PeriodSummaryBar({
  segments,
  className,
}: {
  segments: PeriodSummarySegment[]
  className?: string
}) {
  return (
    <div
      className={cn('flex flex-wrap items-stretch gap-1.5 rounded-lg border bg-background/60 p-2', className)}
      data-testid="period-summary-bar"
    >
      {segments.map((seg, i) => (
        <div key={seg.label} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="px-0.5 text-sm font-semibold text-muted-foreground/70" aria-hidden>
              {seg.operator ?? '+'}
            </span>
          )}
          <div className={cn('min-w-[92px] rounded-md border px-2.5 py-1.5', TONE_CLASSES[seg.tone ?? 'default'])}>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{seg.label}</p>
            <p className="text-sm font-bold leading-tight">{seg.value}</p>
            {seg.sub && <p className="text-[10px] text-muted-foreground">{seg.sub}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}
