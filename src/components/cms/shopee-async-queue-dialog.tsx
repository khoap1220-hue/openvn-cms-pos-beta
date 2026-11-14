'use client'

import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  Layers,
  Loader2,
  Play,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Trash2,
  Unlink,
} from 'lucide-react'

export type AsyncQueueItemStatus =
  | 'PENDING'
  | 'WAITING_SESSION'
  | 'RETRYING'
  | 'DEAD_LETTER'
  | 'BROKEN_LINK'

export interface AsyncQueueItem {
  productId: string
  sku: string
  name: string
  image: string | null
  shopeeItemId: string
  shopeeModelId: string
  shopeeModelName: string
  cmsStock: number
  targetStock: number
  lastSyncedStock: number
  cmsSellPrice: number
  targetPrice: number
  lastSyncedPrice: number
  targetUnlisted: boolean
  status: AsyncQueueItemStatus
  changeSummary: string
  reason: string | null
  queuedAt: string
}

export interface AsyncQueueSnapshot {
  ok: boolean
  connection: {
    shopeeChannelEnabled: boolean
    daemonOnline: boolean
    sessionAlive: boolean
    state: 'CONNECTED' | 'SESSION_EXPIRED' | 'DAEMON_OFFLINE' | 'CHANNEL_DISABLED'
    shopId: string
    username: string
    lastSync: number | string | null
    lastAlertReason: string | null
  }
  summary: {
    totalActionable: number
    pendingCount: number
    waitingSessionCount: number
    deadLetterCount: number
    brokenLinkCount: number
    inboundSpoolPending: number
    unlinkedMarketplaceCount: number
  }
  alerts: Array<{
    id: string
    severity: 'critical' | 'warning' | 'info'
    title: string
    description: string
    ctaType: 'RECONNECT_COOKIE' | 'OPEN_ASYNC_QUEUE'
  }>
  items: AsyncQueueItem[]
}

interface ShopeeAsyncQueueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: AsyncQueueSnapshot | null
  onSnapshotChange?: (next: AsyncQueueSnapshot) => void
  onRefresh: () => Promise<void> | void
  onOpenCookieDialog: (tab: 'curl' | 'extension') => void
  onUnlinkToRelink?: (productId: string, sku: string) => void
}

function statusBadge(status: AsyncQueueItemStatus) {
  switch (status) {
    case 'WAITING_SESSION':
      return (
        <Badge className="bg-amber-500/15 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300">
          <Clock className="mr-1 h-3 w-3" />
          Chờ kết nối lại
        </Badge>
      )
    case 'BROKEN_LINK':
      return (
        <Badge variant="destructive">
          <Unlink className="mr-1 h-3 w-3" />
          Đứt liên kết Sàn
        </Badge>
      )
    case 'DEAD_LETTER':
      return (
        <Badge className="bg-rose-500/15 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300">
          <AlertTriangle className="mr-1 h-3 w-3" />
          Tạm dừng (DLQ)
        </Badge>
      )
    case 'RETRYING':
      return (
        <Badge className="bg-sky-500/15 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300">
          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
          Đang thử lại
        </Badge>
      )
    default:
      return (
        <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Đang đẩy lên Sàn
        </Badge>
      )
  }
}

export function ShopeeAsyncQueueDialog({
  open,
  onOpenChange,
  snapshot,
  onSnapshotChange,
  onRefresh,
  onOpenCookieDialog,
  onUnlinkToRelink,
}: ShopeeAsyncQueueDialogProps) {
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const { toast } = useToast()

  const conn = snapshot?.connection
  const summary = snapshot?.summary
  const items = snapshot?.items ?? []

  const runQueueAction = async (
    action: 'FLUSH_NOW' | 'RETRY_FAILED' | 'CANCEL_ITEM',
    productId?: string
  ) => {
    const key = productId ? `${action}:${productId}` : action
    setBusyAction(key)
    try {
      const res = await apiPost<AsyncQueueSnapshot & { message?: string }>(
        '/api/channels/async-queue',
        {
          action,
          productId,
        }
      )
      if (res?.ok && onSnapshotChange) {
        onSnapshotChange(res)
      }
      toast({
        title:
          action === 'CANCEL_ITEM'
            ? 'Đã hủy tác vụ chờ đồng bộ'
            : action === 'RETRY_FAILED'
              ? 'Đã xếp lại tác vụ vào hàng đợi'
              : 'Đã kích hoạt đồng bộ bất đồng bộ',
        description: res.message || 'Trạng thái hàng đợi đã được cập nhật.',
      })
      await onRefresh()
    } catch (e) {
      toast({
        title: 'Thao tác hàng đợi thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Layers className="h-5 w-5 text-orange-600" />
            Hàng đợi Đồng bộ Bất đồng bộ Sàn Shopee (Transactional Outbox)
          </DialogTitle>
          <DialogDescription>
            Bảo toàn 100% thay đổi giá bán, tồn kho và trạng thái ẩn/hiện trên CMS ngay cả khi mất
            mạng hoặc hết hạn Cookie Shopee — tự động đẩy bù theo thứ tự ngay khi kết nối lại.
          </DialogDescription>
        </DialogHeader>

        {/* Trạng thái phiên kết nối thời gian thực */}
        <div
          className={`rounded-xl border p-3.5 text-xs ${
            conn?.sessionAlive
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-amber-300 bg-amber-50/85 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-start gap-2">
              {conn?.sessionAlive ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <div className="space-y-0.5">
                <div className="font-semibold">
                  {conn?.sessionAlive
                    ? `Phiên Shopee Trực tuyến (${conn.username} · #${conn.shopId})`
                    : !conn?.daemonOnline
                      ? `Trạm đồng bộ Shopee tạm ngắt (${conn?.username || 'thaimy1605'} · #${conn?.shopId || '197195817'})`
                      : `Phiên Cookie Shopee đã hết hạn (${conn.username} · #${conn.shopId})`}
                </div>
                <p className="text-[11px] opacity-90">
                  {conn?.sessionAlive
                    ? 'Mọi thay đổi trên CMS được đẩy tự động lên Sàn Shopee trong vòng vài giây.'
                    : 'Chế độ Giữ Hàng Đợi An Toàn đang bật: các tác vụ chờ KHÔNG bị đốt lượt thử hay rơi vào DLQ, và sẽ tự động đồng bộ ngay khi bạn nạp lại Cookie.'}
                </p>
              </div>
            </div>

            {!conn?.sessionAlive && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  size="sm"
                  className="h-7 bg-orange-600 px-2.5 text-xs text-white hover:bg-orange-700"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenCookieDialog('curl')
                  }}
                >
                  <KeyRound className="mr-1 h-3 w-3" />
                  Dán lệnh cURL
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 bg-background px-2.5 text-xs"
                  onClick={() => {
                    onOpenChange(false)
                    onOpenCookieDialog('extension')
                  }}
                >
                  <Puzzle className="mr-1 h-3 w-3 text-orange-600" />
                  Extension Shop
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* 4 Ô Đếm Trạng thái Bất đồng bộ */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Chờ kết nối lại</div>
            <div className="mt-0.5 text-lg font-bold text-amber-600 dark:text-amber-400">
              {summary?.waitingSessionCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Đang đẩy lên Sàn</div>
            <div className="mt-0.5 text-lg font-bold text-sky-600 dark:text-sky-400">
              {summary?.pendingCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Đứt liên kết mã Sàn</div>
            <div className="mt-0.5 text-lg font-bold text-rose-600 dark:text-rose-400">
              {summary?.brokenLinkCount ?? 0}
            </div>
          </div>
          <div className="rounded-lg border bg-muted/30 px-3 py-2">
            <div className="text-[11px] text-muted-foreground">Tạm dừng (DLQ)</div>
            <div className="mt-0.5 text-lg font-bold text-foreground">
              {summary?.deadLetterCount ?? 0}
            </div>
          </div>
        </div>

        {/* Thanh công cụ điều phối */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Danh sách tác vụ đồng bộ ({items.length})
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            {((summary?.deadLetterCount ?? 0) > 0 || (summary?.brokenLinkCount ?? 0) > 0) && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-orange-300 text-xs text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300"
                disabled={busyAction !== null}
                onClick={() => void runQueueAction('RETRY_FAILED')}
              >
                {busyAction === 'RETRY_FAILED' ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                )}
                Thử lại tất cả mục lỗi
              </Button>
            )}
            <Button
              size="sm"
              className="h-8 bg-orange-600 text-xs text-white hover:bg-orange-700"
              disabled={busyAction !== null || items.length === 0}
              onClick={() => void runQueueAction('FLUSH_NOW')}
            >
              {busyAction === 'FLUSH_NOW' ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Đẩy hàng đợi ngay
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={busyAction !== null}
              onClick={() => void onRefresh()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Làm mới
            </Button>
          </div>
        </div>

        {/* Danh sách các tác vụ trong Hàng đợi */}
        {items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-emerald-300/70 bg-emerald-50/40 p-6 text-center dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-semibold text-foreground">
              0 tác vụ tồn đọng — Toàn bộ dữ liệu CMS &amp; Sàn đang đồng bộ sạch
            </p>
            <p className="mx-auto mt-1 max-w-lg text-xs text-muted-foreground">
              Nếu Cookie Shopee hết hạn giữa ca trực, bạn vẫn có thể bán hàng tại POS hoặc chỉnh
              sửa giá/tồn kho bình thường — các thay đổi sẽ tự động xếp hàng tại đây và đẩy bù lên
              Sàn ngay khi kết nối lại.
            </p>
          </div>
        ) : (
          <div className="max-h-[340px] space-y-2 overflow-y-auto pr-1">
            {items.map((item) => {
              const isItemBusy =
                busyAction === `RETRY_FAILED:${item.productId}` ||
                busyAction === `CANCEL_ITEM:${item.productId}`
              return (
                <div
                  key={item.productId}
                  className="flex flex-col justify-between gap-2.5 rounded-lg border bg-card p-3 text-xs sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="font-mono text-[11px] font-semibold">
                        {item.sku}
                      </Badge>
                      {statusBadge(item.status)}
                      {item.shopeeItemId && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          Item #{item.shopeeItemId} · Model #{item.shopeeModelId || '0'}
                        </span>
                      )}
                    </div>
                    <p className="line-clamp-1 font-medium text-foreground">{item.name}</p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-sky-700 dark:text-sky-300">
                        {item.changeSummary}
                      </span>
                      {item.reason && (
                        <span className="text-muted-foreground">· {item.reason}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {item.status === 'BROKEN_LINK' && onUnlinkToRelink && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-orange-300 px-2 text-[11px] text-orange-700 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-300"
                        disabled={busyAction !== null}
                        onClick={() => {
                          onOpenChange(false)
                          onUnlinkToRelink(item.productId, item.sku)
                        }}
                      >
                        <Unlink className="mr-1 h-3 w-3" />
                        Gỡ &amp; Ghép lại
                      </Button>
                    )}
                    {(item.status === 'DEAD_LETTER' || item.status === 'BROKEN_LINK') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        disabled={busyAction !== null}
                        onClick={() => void runQueueAction('RETRY_FAILED', item.productId)}
                      >
                        {isItemBusy ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 h-3 w-3" />
                        )}
                        Thử lại
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px] text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                      disabled={busyAction !== null}
                      onClick={() => void runQueueAction('CANCEL_ITEM', item.productId)}
                      title="Hủy yêu cầu đẩy đồng bộ này"
                    >
                      {isItemBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="mr-1 h-3 w-3" />
                      )}
                      Hủy
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
