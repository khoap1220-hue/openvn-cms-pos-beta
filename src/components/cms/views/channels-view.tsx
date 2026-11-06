'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch } from '@/lib/api'
import { formatCompactVND, formatNumber, formatVND } from '@/lib/format'
import type { Channel } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ChannelBadge, ConnectedDot, SyncInfo } from '@/components/cms/channel-badge'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { Calculator, Loader2, RefreshCw, Save, Store, ShoppingCart, Wallet } from 'lucide-react'

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<Channel | null>(null)
  // Cấu hình phí sàn TMĐT: bản nháp % phí theo kênh (key = channel.id) — lưu xong xóa nháp để hiện giá trị server
  const [feeDrafts, setFeeDrafts] = useState<Record<string, string>>({})
  const [savingFeeId, setSavingFeeId] = useState<string | null>(null)
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<{ channels: Channel[] }>('/api/channels')
      setChannels(data.channels)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải kênh bán'
      setError(message)
      toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  const handleConnect = async (channel: Channel) => {
    setTogglingId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { connected: true })
      toast({
        title: `Đã kết nối kênh ${channel.name}`,
        description: 'Sản phẩm đang bán đã được đẩy lên kênh.',
      })
      await load()
    } catch (e) {
      toast({
        title: 'Kết nối thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const handleConfirmDisconnect = async () => {
    if (!pendingDisconnect) return
    const channel = pendingDisconnect
    setTogglingId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { connected: false })
      toast({
        title: `Đã tắt bán / ngắt kết nối kênh ${channel.name}`,
        description: 'Toàn bộ sản phẩm đã được đồng bộ gỡ khỏi danh sách bán trên kênh.',
      })
      setPendingDisconnect(null)
      await load()
    } catch (e) {
      toast({
        title: 'Ngắt kết nối thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const handleSync = async (channel: Channel) => {
    setSyncingId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { sync: true })
      toast({ title: `Đã đồng bộ kênh ${channel.name}`, description: 'Dữ liệu kênh đã được cập nhật.' })
      await load()
    } catch (e) {
      toast({
        title: 'Đồng bộ thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSyncingId(null)
    }
  }

  const connectedCount = channels?.filter((c) => c.connected).length ?? 0
  const totalOrders = channels?.reduce((s, c) => s + (c.stats?.orders ?? 0), 0) ?? 0
  const totalRevenue = channels?.reduce((s, c) => s + (c.stats?.revenue ?? 0), 0) ?? 0

  // ===== Phí sàn TMĐT: nhập % phí + lưu (PATCH /api/channels/[id]) =====
  const feeDraftFor = (channel: Channel) => feeDrafts[channel.id] ?? String(channel.feePercent)
  const feeChanged = (channel: Channel) => {
    const raw = feeDraftFor(channel).trim()
    if (raw === '') return false
    const value = Number(raw)
    return Number.isFinite(value) && value !== channel.feePercent
  }

  const handleSaveFee = async (channel: Channel) => {
    const raw = feeDraftFor(channel).trim()
    const value = Number(raw)
    if (raw === '' || !Number.isFinite(value)) return
    setSavingFeeId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { feePercent: value })
      toast({
        title: `Đã lưu phí sàn ${channel.name}: ${value}%`,
        description: 'Đơn hàng mới trên kênh này sẽ được ghi nhận phí sàn này.',
      })
      setFeeDrafts((prev) => {
        const next = { ...prev }
        delete next[channel.id]
        return next
      })
      await load()
    } catch (e) {
      toast({
        title: 'Lưu phí sàn thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingFeeId(null)
    }
  }

  // Đối soát sàn TMĐT: chỉ hiển thị kênh có cấu hình phí > 0, sắp theo tiền phí giảm dần
  const reconChannels = (channels ?? [])
    .filter((c) => c.feePercent > 0)
    .sort((a, b) => (b.stats?.platformFee ?? 0) - (a.stats?.platformFee ?? 0))
  const reconTotals = reconChannels.reduce(
    (acc, c) => ({
      orders: acc.orders + (c.stats?.orders ?? 0),
      revenue: acc.revenue + (c.stats?.revenue ?? 0),
      platformFee: acc.platformFee + (c.stats?.platformFee ?? 0),
      netRevenue: acc.netRevenue + (c.stats?.netRevenue ?? 0),
    }),
    { orders: 0, revenue: 0, platformFee: 0, netRevenue: 0 }
  )

  return (
    <div>
      <PageHeader title="Kênh bán" description="Kết nối và đồng bộ sản phẩm tới các sàn thương mại điện tử" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Kênh đang kết nối"
          value={loading ? '' : `${connectedCount}/${channels?.length ?? 0}`}
          icon={Store}
          loading={loading}
          hint="Sẵn sàng nhận đơn từ các sàn"
        />
        <StatCard
          title="Tổng đơn hàng"
          value={loading ? '' : formatNumber(totalOrders)}
          icon={ShoppingCart}
          loading={loading}
          hint="Gộp từ tất cả các kênh"
        />
        <StatCard
          title="Tổng doanh thu"
          value={loading ? '' : formatCompactVND(totalRevenue)}
          icon={Wallet}
          loading={loading}
          hint={formatVND(totalRevenue)}
        />
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !channels || channels.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Chưa có kênh bán nào"
          description="Thêm kênh bán trong hệ thống để bắt đầu bán hàng đa kênh."
          action={<Button onClick={load}>Tải lại</Button>}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {channels.map((channel) => {
              const busy = togglingId === channel.id
              const syncing = syncingId === channel.id
              return (
                <Card key={channel.id} className="border-border/70 shadow-sm">
                  <CardContent className="flex h-full flex-col gap-4 p-5">
                  {/* Header: logo + tên + trạng thái */}
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-lg text-base font-bold text-white shadow-sm"
                      style={{ backgroundColor: channel.color }}
                      aria-hidden
                    >
                      {channel.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{channel.name}</span>
                        <ConnectedDot connected={channel.connected} />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {channel.connected ? 'Đang hoạt động' : 'Chưa kết nối'}
                        </span>
                        {channel.feePercent > 0 && (
                          <Badge variant="secondary" className="text-[11px]">
                            Phí {channel.feePercent}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Cấu hình % phí sàn — snapshot vào từng đơn mới của kênh này */}
                  <div className="rounded-lg border border-dashed p-3">
                    <div className="flex items-center justify-between gap-2">
                      <label
                        htmlFor={`channel-fee-${channel.id}`}
                        className="shrink-0 text-xs font-medium text-muted-foreground"
                      >
                        Phí sàn (%)
                      </label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`channel-fee-${channel.id}`}
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={100}
                          step={0.5}
                          className="h-8 w-20 text-right text-sm"
                          value={feeDraftFor(channel)}
                          onChange={(e) =>
                            setFeeDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))
                          }
                          aria-label={`Phí sàn (%) của kênh ${channel.name}`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 px-3"
                          disabled={!feeChanged(channel) || savingFeeId === channel.id}
                          onClick={() => void handleSaveFee(channel)}
                        >
                          {savingFeeId === channel.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Lưu
                        </Button>
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Tự động trừ khi đối soát đơn hàng mới trên kênh này
                    </p>
                  </div>

                  {/* Stats hàng ngang */}
                  <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-3 text-center">
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">Sản phẩm đang bán</p>
                      <p className="mt-0.5 text-sm font-semibold">{formatNumber(channel.stats?.listings ?? 0)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">Đơn hàng</p>
                      <p className="mt-0.5 text-sm font-semibold">{formatNumber(channel.stats?.orders ?? 0)}</p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-xs text-muted-foreground">Doanh thu</p>
                      <p className="mt-0.5 truncate text-sm font-semibold" title={formatVND(channel.stats?.revenue ?? 0)}>
                        {formatCompactVND(channel.stats?.revenue ?? 0)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto">
                    <Separator className="mb-3" />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <SyncInfo syncedAt={channel.syncedAt} />
                      <div className="flex items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <Switch
                            checked={channel.connected}
                            disabled={busy}
                            aria-label={`Kết nối kênh ${channel.name}`}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                void handleConnect(channel)
                              } else {
                                setPendingDisconnect(channel)
                              }
                            }}
                          />
                          <span className="text-muted-foreground">Kết nối</span>
                        </label>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!channel.connected || busy || syncing}
                          onClick={() => void handleSync(channel)}
                        >
                          <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                          Đồng bộ
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          </div>

          {/* Đối soát sàn TMĐT — các kênh có cấu hình phí > 0 */}
          <Card className="mt-6 border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-5 w-5 text-emerald-500" />
                Đối soát sàn TMĐT
              </CardTitle>
              <CardDescription>
                Phí sàn được snapshot trên từng đơn lúc tạo — tự động trừ khi đối soát để tính đúng lợi nhuận thực nhận.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reconChannels.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Chưa cấu hình phí sàn cho kênh nào.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kênh</TableHead>
                        <TableHead className="text-right">Đơn hàng</TableHead>
                        <TableHead className="text-right">Doanh thu</TableHead>
                        <TableHead className="text-right">Phí sàn</TableHead>
                        <TableHead className="text-right">Thực nhận</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconChannels.map((channel) => (
                        <TableRow key={channel.id}>
                          <TableCell>
                            <ChannelBadge channel={channel} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(channel.stats?.orders ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(channel.stats?.revenue ?? 0)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            <span className="text-xs text-muted-foreground">{channel.feePercent}%</span>{' '}
                            <span className="font-medium text-rose-600 dark:text-rose-400">
                              −{formatVND(channel.stats?.platformFee ?? 0)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatVND(channel.stats?.netRevenue ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell>Tổng cộng</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(reconTotals.orders)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatVND(reconTotals.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                          −{formatVND(reconTotals.platformFee)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatVND(reconTotals.netRevenue)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null)
        }}
        title={`Ngắt kết nối kênh ${pendingDisconnect?.name ?? ''}?`}
        description="Đơn hàng mới từ kênh này sẽ không còn được đồng bộ về hệ thống. Bạn có thể kết nối lại bất cứ lúc nào."
        confirmText="Ngắt kết nối"
        destructive
        loading={pendingDisconnect !== null && togglingId === pendingDisconnect.id}
        onConfirm={() => void handleConfirmDisconnect()}
      />
    </div>
  )
}
