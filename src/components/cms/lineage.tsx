'use client'

// DATA PROVENANCE UI — Badge nguồn gốc + Badge trạng thái biến đổi + Dialog Truy xuất
// nguồn gốc & So sánh thay đổi (Diff Trước → Sau) trên từng dòng dữ liệu.

import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, History, Loader2, Sparkles } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'
import {
  ORIGIN_SOURCES,
  fieldLabel,
  formatFieldValue,
  originLabel,
  parseChangedFields,
  parseSnapshot,
  type OriginSource,
} from '@/lib/lineage'

// ===== Kiểu dữ liệu entry trả về từ /api/lineage (raw Prisma JSON) =====
export interface LineageEntryRaw {
  id: string
  scope: string
  action: string
  entityType: string | null
  entityId: string | null
  entityCode: string | null
  title: string
  detail: string | null
  actor: string
  originSource: string | null
  actorName: string | null
  sourceRefCode: string | null
  beforeSnapshot: string | null
  afterSnapshot: string | null
  changedFields: string | null
  createdAt: string
}

// ============================================================
// DataLineageBadge — Badge nguồn gốc + trạng thái biến đổi
// ============================================================

export function OriginBadge({ source, className }: { source?: string | null; className?: string }) {
  const meta = source ? ORIGIN_SOURCES[source as OriginSource] : null
  return (
    <Badge
      variant="outline"
      title={meta?.hint ?? 'Chưa xác định nguồn gốc dữ liệu'}
      className={cn('whitespace-nowrap text-[11px] font-medium', meta?.badgeClass, className)}
    >
      {meta ? meta.label : originLabel(source)}
    </Badge>
  )
}

export function ChangeCountBadge({
  changeCount,
  onClick,
  className,
}: {
  changeCount?: number | null
  onClick?: () => void
  className?: string
}) {
  const changed = (changeCount ?? 0) > 0
  return (
    <Badge
      variant="outline"
      onClick={onClick}
      className={cn(
        'whitespace-nowrap text-[11px] font-medium',
        changed
          ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
        onClick && 'cursor-pointer transition-opacity hover:opacity-80',
        className
      )}
      title={changed ? `Đã được cập nhật ${changeCount} lần — bấm để xem lịch sử` : 'Chưa từng bị chỉnh sửa'}
    >
      {changed ? `Đã đổi (${changeCount} lần)` : 'Nguyên bản'}
    </Badge>
  )
}

/**
 * Badge dòng dữ liệu: [Nguồn gốc] + [Nguyên bản | Đã đổi N lần]
 * Bấm vào → mở LineageInspectorDialog (nếu truyền onClick / onInspect)
 */
export function DataLineageBadge({
  originSource,
  changeCount,
  onInspect,
  compact = false,
  className,
}: {
  originSource?: string | null
  changeCount?: number | null
  /** Bấm badge "Nguyên bản/Đã đổi" → mở inspector */
  onInspect?: () => void
  compact?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {originSource ? <OriginBadge source={originSource} /> : null}
      <ChangeCountBadge changeCount={changeCount} onClick={onInspect} />
    </span>
  )
}

// ============================================================
// LineageInspectorDialog — Truy xuất nguồn gốc & So sánh thay đổi
// ============================================================

function SnapshotGrid({ snapshot, tone }: { snapshot: Record<string, unknown>; tone: 'before' | 'after' | 'origin' }) {
  const keys = Object.keys(snapshot)
  if (keys.length === 0) return null
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {keys.map((k) => (
        <div key={k} className="col-span-2 grid grid-cols-[110px_1fr] items-baseline gap-2">
          <span className="text-muted-foreground">{fieldLabel(k)}</span>
          <span
            className={cn(
              'font-medium',
              tone === 'before' && 'text-red-700 dark:text-red-400',
              tone === 'after' && 'text-emerald-700 dark:text-emerald-400',
              tone === 'origin' && 'text-foreground'
            )}
          >
            {formatFieldValue(k, snapshot[k])}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Bảng đối chiếu Trước (đỏ nhạt) → Sau (xanh nhạt) của từng trường thay đổi */
function DiffTable({ changedFields, before, after }: { changedFields: string[]; before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/60 text-left text-muted-foreground">
            <th className="px-2.5 py-1.5 font-medium">Trường</th>
            <th className="px-2.5 py-1.5 font-medium text-red-700 dark:text-red-400">Trước</th>
            <th className="w-6 px-1 py-1.5"></th>
            <th className="px-2.5 py-1.5 font-medium text-emerald-700 dark:text-emerald-400">Sau</th>
          </tr>
        </thead>
        <tbody>
          {changedFields.map((f) => (
            <tr key={f} className="border-t">
              <td className="px-2.5 py-1.5 font-medium">{fieldLabel(f)}</td>
              <td className="bg-red-50/70 px-2.5 py-1.5 text-red-800 dark:bg-red-950/40 dark:text-red-300">
                {formatFieldValue(f, before?.[f])}
              </td>
              <td className="px-1 py-1.5 text-center text-muted-foreground">
                <ArrowRight className="inline h-3.5 w-3.5" />
              </td>
              <td className="bg-emerald-50/70 px-2.5 py-1.5 font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
                {formatFieldValue(f, after?.[f])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  STATUS_CHANGED: 'Đổi trạng thái',
  ORDER_CANCELLED: 'Hủy đơn',
  PAYMENT_MARKED: 'Đánh dấu thanh toán',
  COD_RECEIVED: 'Nhận COD',
  COD_RECONCILED: 'Đối soát COD xong',
  SHIPMENT_STATUS_CHANGED: 'Cập nhật vận đơn',
  STOCK_IMPORT: 'Nhập kho',
  STOCK_EXPORT: 'Xuất kho',
  STOCK_ADJUST: 'Điều chỉnh kiểm kê',
  PRODUCT_UPDATED: 'Cập nhật sản phẩm',
  PRODUCT_BARCODE_UPDATED: 'Cập nhật mã vạch',
  POINTS_EARNED: 'Tích điểm',
  POINTS_ADJUSTED: 'Cộng điểm',
  POINTS_REDEEMED: 'Trừ điểm',
  MEMBER_REGISTERED: 'Nâng cấp thành viên',
  MEMBER_UPGRADED: 'Nâng cấp thành viên',
  CASE_UPDATED: 'Cập nhật đổi trả',
  SALES_CANCELLED: 'Hủy hóa đơn bán',
  PURCHASE_CANCELLED: 'Hủy hóa đơn mua',
}

export interface LineageInspectorTarget {
  entityType: string
  entityId?: string | null
  entityCode?: string | null
  /** Tên hiển thị của dòng dữ liệu (vd: mã đơn, SKU, tên khách) */
  label?: string
}

export function LineageInspectorDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: LineageInspectorTarget | null
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<{
    origin: LineageEntryRaw | null
    changes: LineageEntryRaw[]
    changeCount: number
    entityCode: string | null
  } | null>(null)

  const fetchLineage = useCallback(async () => {
    if (!target?.entityType || (!target.entityId && !target.entityCode)) return
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ entityType: target.entityType })
      if (target.entityId) qs.set('entityId', target.entityId)
      else if (target.entityCode) qs.set('entityCode', target.entityCode)
      const res = await fetch(`/api/lineage?${qs.toString()}`)
      if (!res.ok) throw new Error('Không tải được lịch sử')
      const json = await res.json()
      setData({ origin: json.origin, changes: json.changes ?? [], changeCount: json.changeCount ?? 0, entityCode: json.entityCode })
    } catch {
      setError('Không thể tải lịch sử nguồn gốc. Vui lòng thử lại.')
    } finally {
      setLoading(false)
    }
  }, [target])

  useEffect(() => {
    if (open) void fetchLineage()
    else setData(null)
  }, [open, fetchLineage])

  const originSnap = data?.origin ? parseSnapshot(data.origin.afterSnapshot) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4.5 w-4.5 text-violet-500" />
            Nguồn gốc &amp; Lịch sử thay đổi
          </DialogTitle>
          <DialogDescription className="truncate">
            {target?.label ?? data?.entityCode ?? '—'}
            {data ? ` · ${data.changeCount > 0 ? `Đã đổi ${data.changeCount} lần` : 'Nguyên bản — chưa từng sửa'}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 px-1">
          <ScrollArea className="h-full max-h-[62vh] pr-2">
            {loading ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tải lịch sử…
              </div>
            ) : error ? (
              <div className="space-y-2 py-6 text-center">
                <p className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => void fetchLineage()}>
                  Thử lại
                </Button>
              </div>
            ) : !data || (data.changes.length === 0 && !data.origin) ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <History className="mx-auto mb-2 h-8 w-8 opacity-40" />
                Chưa có lịch sử thay đổi nào được ghi nhận cho dòng dữ liệu này.
              </div>
            ) : (
              <div className="space-y-4 pb-2">
                {/* ===== Thông tin gốc ===== */}
                {data.origin && (
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-violet-500" /> Thông tin gốc
                    </p>
                    <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span>
                        <span className="text-muted-foreground">Khởi tạo: </span>
                        <span className="font-medium">{formatDateTime(data.origin.createdAt)}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground">Nguồn gốc: </span>
                        <OriginBadge source={data.origin.originSource} />
                      </span>
                      <span>
                        <span className="text-muted-foreground">Người tạo: </span>
                        <span className="font-medium">{data.origin.actorName ?? data.origin.actor}</span>
                      </span>
                      {data.origin.sourceRefCode && (
                        <span>
                          <span className="text-muted-foreground">Chứng từ gốc: </span>
                          <span className="font-mono font-medium">{data.origin.sourceRefCode}</span>
                        </span>
                      )}
                    </div>
                    {originSnap && <SnapshotGrid snapshot={originSnap} tone="origin" />}
                  </div>
                )}

                <Separator />

                {/* ===== Timeline thay đổi ===== */}
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Timeline thay đổi ({data.changes.length})
                  </p>
                  {data.changes.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                      Dòng dữ liệu này chưa từng bị chỉnh sửa — vẫn là bản Nguyên bản.
                    </p>
                  ) : (
                    <ol className="space-y-3">
                      {data.changes
                        .slice()
                        .reverse()
                        .map((e) => {
                          const changed = parseChangedFields(e.changedFields)
                          const before = parseSnapshot(e.beforeSnapshot)
                          const after = parseSnapshot(e.afterSnapshot)
                          return (
                            <li key={e.id} className="relative rounded-lg border p-3 pl-4">
                              {/* timeline dot */}
                              <span className="absolute left-1.5 top-4 h-2 w-2 rounded-full bg-violet-400" />
                              <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant="outline" className="text-[10px] font-medium">
                                    {ACTION_LABELS[e.action] ?? e.action}
                                  </Badge>
                                  <OriginBadge source={e.originSource} />
                                  <span className="text-xs text-muted-foreground">{e.actorName ?? e.actor}</span>
                                </div>
                                <span className="text-xs text-muted-foreground">{formatDateTime(e.createdAt)}</span>
                              </div>
                              <p className="mb-2 text-xs text-muted-foreground">{e.title}</p>
                              {changed.length > 0 && before && after && (
                                <DiffTable changedFields={changed} before={before} after={after} />
                              )}
                            </li>
                          )
                        })}
                    </ol>
                  )}
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}
