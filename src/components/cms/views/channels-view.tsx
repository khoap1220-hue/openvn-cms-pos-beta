'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch } from '@/lib/api'
import { formatCompactVND, formatNumber, formatVND } from '@/lib/format'
import type { Channel } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ConnectedDot, SyncInfo } from '@/components/cms/channel-badge'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { Store, RefreshCw, ShoppingCart, Wallet } from 'lucide-react'

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<Channel | null>(null)
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
      toast({ title: `Đã ngắt kết nối kênh ${channel.name}` })
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
