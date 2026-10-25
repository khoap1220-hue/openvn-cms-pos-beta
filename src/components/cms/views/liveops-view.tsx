'use client'

// Buồng lái vận hành 1 người: giám sát realtime toàn bộ đội Agent
// + mô phỏng khách từ Zalo để kiểm thử quy trình tự động 100%.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Clock, MessageCircle, Package, Play, Smartphone, ShoppingBag, Truck, Zap, CircleAlert } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { StatCard } from '@/components/cms/stat-card'
import { AgentBadge, AgentDot, ShipmentStatusBadge } from '@/components/cms/agent-badge'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { AGENTS, CARRIERS } from '@/lib/agents'
import { AGENT_ACTION_LABELS, type LiveOpsData } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function LiveOpsView({ onNavigate }: { onNavigate?: (view: 'orders' | 'inbox' | 'shipments' | 'autopilot') => void }) {
  const { toast } = useToast()
  const [data, setData] = useState<LiveOpsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [feed, setFeed] = useState<LiveOpsData['activities']>([])
  const [simulating, setSimulating] = useState<string | null>(null)
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await apiGet<LiveOpsData>('/api/liveops')
      setData(d)
      setFeed(d.activities)
    } catch {
      // giữ nguyên dữ liệu cũ khi lỗi mạng
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current)
    refetchTimer.current = setTimeout(() => void load(), 700)
  }, [load])

  useRealtime((e) => {
    if (e.type === 'agent.activity') {
      const activity = e.data as LiveOpsData['activities'][number]
      setFeed((prev) => [activity, ...prev].slice(0, 40))
      scheduleRefetch()
    } else if (['order.created', 'order.updated', 'shipment.updated', 'settings.updated', 'review.received', 'message.new'].includes(e.type)) {
      scheduleRefetch()
    } else if (e.type === 'realtime.poll') {
      // WS hỏng → polling 10s: load im lặng (load không setLoading(true) — không flash skeleton)
      scheduleRefetch()
    }
  })

  const toggleMaster = async (enabled: boolean) => {
    try {
      const res = await apiPatch<{ settings: Record<string, boolean> }>('/api/autopilot', { key: 'master', enabled })
      setData((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      toast({
        title: enabled ? '🤖 Agent Autopilot đã BẬT' : 'Autopilot đã TẮT',
        description: enabled ? 'Đội Agent tiếp quản toàn bộ quy trình bán hàng.' : 'Chuyển sang chế độ thủ công — bạn tự xử lý đơn hàng.',
      })
    } catch (error) {
      toast({ title: 'Lỗi', description: error instanceof Error ? error.message : 'Không thể đổi chế độ', variant: 'destructive' })
    }
  }

  const simulate = async (type: string, label: string, busyKey?: string, channelKey?: string) => {
    setSimulating(busyKey ?? type)
    try {
      await apiPost('/api/simulate', { type, channelKey })
      toast({ title: `${label} đã tạo`, description: 'Agent đang xử lý — theo dõi luồng hoạt động bên dưới 👀' })
      scheduleRefetch()
    } catch (error) {
      toast({ title: 'Không thể mô phỏng', description: error instanceof Error ? error.message : 'Lỗi không xác định', variant: 'destructive' })
    } finally {
      setSimulating(null)
    }
  }

  const quickConfirm = async (orderId: string, code: string) => {
    try {
      await apiPatch(`/api/orders/${orderId}`, { status: 'CONFIRMED' })
      toast({ title: `Đã xác nhận ${code}`, description: 'Tiếp tục xử lý trong tab Đơn hàng.' })
      scheduleRefetch()
    } catch (error) {
      toast({ title: 'Lỗi', description: error instanceof Error ? error.message : 'Không thể xác nhận', variant: 'destructive' })
    }
  }

  const quickDispatch = async (orderId: string, code: string) => {
    try {
      await apiPost('/api/shipments', { orderId })
      toast({ title: `Đã báo ĐVVC cho ${code}`, description: 'Đơn vị vận chuyển sẽ đến lấy hàng.' })
      scheduleRefetch()
    } catch (error) {
      toast({ title: 'Lỗi', description: error instanceof Error ? error.message : 'Không thể báo vận chuyển', variant: 'destructive' })
    }
  }

  const master = data?.settings.master ?? false
  const attentionCount =
    (data?.attention.pendingActive ? data.attention.pendingList.length : 0) +
    (data?.attention.packingStuckActive ? data.attention.packingStuckList.length : 0)

  return (
    <div className="space-y-5">
      {/* ===== Autopilot banner ===== */}
      <Card className={cn('border shadow-sm', master ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-background to-background dark:border-emerald-900 dark:from-emerald-950/40' : 'border-amber-200 bg-gradient-to-r from-amber-50 via-background to-background dark:border-amber-900 dark:from-amber-950/40')}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm', master ? 'bg-emerald-600' : 'bg-muted-foreground/50')}>
              <Bot className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold leading-tight">Agent Autopilot</h2>
                {master ? (
                  <Badge className="bg-emerald-600 text-white">ĐANG VẬN HÀNH</Badge>
                ) : (
                  <Badge className="bg-amber-500 text-white">TẮT</Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {master
                  ? 'Đội Agent tự xác nhận đơn qua Zalo, báo đơn vị vận chuyển, chăm sóc & xin đánh giá — bạn chỉ cần giám sát.'
                  : 'Chế độ thủ công: mọi đơn hàng cần bạn tự xử lý.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-5 sm:gap-8">
            <div className="text-right">
              <p className="text-xl font-bold leading-tight">{data?.stats.tasksToday ?? 0}</p>
              <p className="text-xs text-muted-foreground">tác vụ Agent hôm nay</p>
            </div>
            <Separator orientation="vertical" className="hidden h-10 sm:block" />
            <div className="text-right">
              <p className="text-xl font-bold leading-tight text-emerald-600">{data?.stats.automationRate ?? 100}%</p>
              <p className="text-xs text-muted-foreground">tự động hóa 24h</p>
            </div>
            <Switch checked={master} onCheckedChange={toggleMaster} aria-label="Bật/tắt Agent Autopilot" className="scale-125" />
          </div>
        </CardContent>
      </Card>

      {/* ===== KPI ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Đơn chờ xử lý" value={String(data?.stats.pendingOrders ?? 0)} icon={Clock} loading={loading} iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-950" />
        <StatCard title="Đang xử lý (xác nhận + đóng gói)" value={String(data?.stats.processing ?? 0)} icon={Package} loading={loading} iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-950" />
        <StatCard title="Đang giao hàng" value={String(data?.stats.shippingCount ?? 0)} icon={Truck} loading={loading} iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950" />
        <StatCard title="Tác vụ Agent hôm nay" value={String(data?.stats.tasksToday ?? 0)} icon={Bot} loading={loading} hint={`${data?.stats.reviewsToday ?? 0} đánh giá nhận được · ${data?.stats.messagesToday ?? 0} tin nhắn`} iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950" />
      </div>

      {/* ===== Pipeline ===== */}
      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex items-center gap-2 overflow-x-auto p-4">
          {(data?.pipeline ?? []).map((step, i) => (
            <div key={step.key} className="flex shrink-0 items-center gap-2">
              <div className={cn('rounded-xl border px-3 py-2 text-center', step.count > 0 ? 'border-primary/30 bg-primary/5' : 'border-border/60')}>
                <p className={cn('text-lg font-bold leading-none', step.count > 0 ? 'text-primary' : 'text-muted-foreground/50')}>{step.count}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{step.label}</p>
              </div>
              {i < (data?.pipeline.length ?? 0) - 1 && <span className="text-muted-foreground/60">→</span>}
            </div>
          ))}
          {loading && <Skeleton className="h-16 w-full" />}
        </CardContent>
      </Card>

      {/* ===== Main grid ===== */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Feed realtime */}
        <Card className="border-border/70 shadow-sm lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" />
              Luồng hoạt động Agent
              <span className="relative ml-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => onNavigate?.('autopilot')}>
              Xem tất cả →
            </Button>
          </CardHeader>
          <CardContent className="max-h-[560px] overflow-y-auto pt-0 [scrollbar-width:thin]">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : feed.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Chưa có hoạt động nào. Bấm «Mô phỏng đơn Zalo» để xem Agent làm việc 👇
              </p>
            ) : (
              <div className="space-y-1">
                {feed.map((activity) => (
                  <div key={activity.id} className="flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                    <AgentDot agent={activity.agent} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{activity.message}</p>
                      {activity.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{activity.detail}</p>}
                      <div className="mt-1 flex items-center gap-2">
                        <AgentBadge agent={activity.agent} />
                        <span className="text-[11px] text-muted-foreground">{AGENT_ACTION_LABELS[activity.action] ?? activity.action}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(activity.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-5 lg:col-span-2">
          {/* Simulator */}
          <Card className="border-primary/30 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Play className="h-4 w-4 text-primary" />
                Kiểm thử vận hành 1 người
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Bấm để mô phỏng khách đến từ Zalo — Agent sẽ xác nhận, soạn hàng, báo shipper, chăm sóc & xin đánh giá tự động 100%.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
              <Button variant="outline" className="justify-start" disabled={simulating !== null} onClick={() => simulate('zalo_order', 'Đơn Zalo OA', 'oa', 'ZALO_OA')}>
                <ShoppingBag className="h-4 w-4 text-emerald-600" />
                Đơn mới · Zalo OA
                {simulating === 'oa' && <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
              </Button>
              <Button variant="outline" className="justify-start" disabled={simulating !== null} onClick={() => simulate('zalo_order', 'Đơn Zalo cá nhân', 'cn', 'ZALO_PERSONAL')}>
                <Smartphone className="h-4 w-4 text-teal-600" />
                Đơn mới · Zalo cá nhân
                {simulating === 'cn' && <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
              </Button>
              <Button variant="outline" className="justify-start" disabled={simulating !== null} onClick={() => simulate('zalo_message', 'Tin nhắn khách')}>
                <MessageCircle className="h-4 w-4 text-violet-600" />
                Khách nhắn tin hỏi
                {simulating === 'zalo_message' && <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />}
              </Button>
            </CardContent>
          </Card>

          {/* Active shipments */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4 text-orange-600" />
                Đang vận chuyển
              </CardTitle>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => onNavigate?.('shipments')}>
                Tất cả →
              </Button>
            </CardHeader>
            <CardContent className="max-h-72 space-y-2 overflow-y-auto pt-0 [scrollbar-width:thin]">
              {(data?.activeShipments ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Không có đơn nào đang giao.</p>
              ) : (
                data?.activeShipments.map((s) => {
                  const carrier = CARRIERS.find((c) => c.key === s.carrier)
                  return (
                    <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <span className="font-mono text-xs">{s.trackingCode}</span> · {s.order?.customer?.name ?? '—'}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: carrier?.color ?? '#999' }} />
                          {carrier?.name ?? s.carrier} · {s.order?.code}
                        </p>
                      </div>
                      <ShipmentStatusBadge status={s.status} />
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>

          {/* Attention queue */}
          {attentionCount > 0 && (
            <Card className="border-amber-300 bg-amber-50/60 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
                  <CircleAlert className="h-4 w-4" />
                  Cần người xử lý ({attentionCount})
                </CardTitle>
                <p className="text-xs text-muted-foreground">Agent đang tắt cho các công việc này — xử lý tay hoặc bật lại Autopilot.</p>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {data?.attention.pendingActive &&
                  data.attention.pendingList.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-background px-3 py-2 dark:border-amber-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium font-mono">{o.code}</p>
                        <p className="truncate text-xs text-muted-foreground">{o.customer?.name} · {o.channel?.name}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => quickConfirm(o.id, o.code)}>
                        Xác nhận
                      </Button>
                    </div>
                  ))}
                {data?.attention.packingStuckActive &&
                  data.attention.packingStuckList.map((o) => (
                    <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-background px-3 py-2 dark:border-amber-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium font-mono">{o.code}</p>
                        <p className="truncate text-xs text-muted-foreground">Đã đóng gói · chưa báo shipper</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => quickDispatch(o.id, o.code)}>
                        Báo ĐVVC
                      </Button>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Agent chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Đội Agent đang trực:</span>
        {Object.values(AGENTS)
          .filter((a) => a.key !== 'SYSTEM')
          .map((a) => (
            <AgentBadge key={a.key} agent={a.key} />
          ))}
      </div>
    </div>
  )
}
