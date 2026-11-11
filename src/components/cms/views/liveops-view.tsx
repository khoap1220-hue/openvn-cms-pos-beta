'use client'

// Trung tâm Điều hành AI (LiveOps): giám sát thời gian thực tổ hợp tác nhân AI,
// luồng xử lý đơn đa kênh và kịch bản kiểm thử nghiệp vụ tự động hóa.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Banknote,
  Bot,
  CircleAlert,
  Clock,
  MessageCircle,
  Package,
  Play,
  ShoppingBag,
  Smartphone,
  Store,
  Truck,
  Zap,
} from 'lucide-react'
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
import { formatCompactVND, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export function LiveOpsView({
  onNavigate,
}: {
  onNavigate?: (view: 'pos' | 'orders' | 'inbox' | 'shipments' | 'autopilot' | 'inventory') => void
}) {
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
    } else if (
      [
        'order.created',
        'order.updated',
        'shipment.updated',
        'settings.updated',
        'review.received',
        'message.new',
      ].includes(e.type)
    ) {
      scheduleRefetch()
    } else if (e.type === 'realtime.poll') {
      // WS hỏng → polling 10s: load im lặng (load không setLoading(true) — không flash skeleton)
      scheduleRefetch()
    }
  })

  const toggleMaster = async (enabled: boolean) => {
    try {
      const res = await apiPatch<{ settings: Record<string, boolean> }>('/api/autopilot', {
        key: 'master',
        enabled,
      })
      setData((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      toast({
        title: enabled
          ? 'Đã kích hoạt Điều phối Tự động AI'
          : 'Đã chuyển sang Điều hành Thủ công',
        description: enabled
          ? 'Hệ thống AI bắt đầu tiếp nhận và xử lý tự động toàn trình đơn hàng đa kênh.'
          : 'Các đơn hàng phát sinh mới sẽ chuyển về hàng đợi để nhân sự phê duyệt thủ công.',
      })
    } catch (error) {
      toast({
        title: 'Không thể cập nhật trạng thái',
        description: error instanceof Error ? error.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      })
    }
  }

  const simulate = async (
    type: string,
    label: string,
    busyKey?: string,
    channelKey?: string
  ) => {
    setSimulating(busyKey ?? type)
    try {
      await apiPost('/api/simulate', { type, channelKey })
      toast({
        title: `Đã khởi tạo kịch bản: ${label}`,
        description:
          'Hệ thống AI đang tiếp nhận và xử lý trên nhật ký điều hành thời gian thực.',
      })
      scheduleRefetch()
    } catch (error) {
      toast({
        title: 'Không thể khởi chạy kịch bản kiểm thử',
        description: error instanceof Error ? error.message : 'Lỗi không xác định',
        variant: 'destructive',
      })
    } finally {
      setSimulating(null)
    }
  }

  const runDrill = async (channel: 'SHOPEE' | 'TIKTOK', label: string) => {
    setSimulating(channel)
    try {
      const res = await apiPost<{ order: { code: string } }>('/api/autopilot/drill', {
        channel,
        customerName: `Khách Kiểm Thử ${label}`,
        itemSku: channel === 'SHOPEE' ? 'UD-QT-002' : 'UD-VL-001',
        quantity: 1,
      })
      toast({
        title: `Đã đồng bộ đơn kiểm thử: ${label}`,
        description: `Mã đơn ${res.order.code} đã được tiếp nhận vào luồng điều phối đa kênh.`,
      })
      scheduleRefetch()
    } catch (error) {
      toast({
        title: 'Không thể khởi chạy kịch bản sàn TMĐT',
        description: error instanceof Error ? error.message : 'Lỗi không xác định',
        variant: 'destructive',
      })
    } finally {
      setSimulating(null)
    }
  }

  const quickConfirm = async (orderId: string, code: string) => {
    try {
      await apiPatch(`/api/orders/${orderId}`, { status: 'CONFIRMED' })
      toast({
        title: `Đã phê duyệt đơn ${code}`,
        description: 'Đơn hàng đã chuyển sang phân hệ Quản lý Đơn hàng để chuẩn bị xuất kho.',
      })
      scheduleRefetch()
    } catch (error) {
      toast({
        title: 'Không thể phê duyệt đơn',
        description: error instanceof Error ? error.message : 'Vui lòng kiểm tra lại.',
        variant: 'destructive',
      })
    }
  }

  const quickDispatch = async (orderId: string, code: string) => {
    try {
      await apiPost('/api/shipments', { orderId })
      toast({
        title: `Đã điều phối vận chuyển cho đơn ${code}`,
        description: 'Lệnh lấy hàng đã được gửi sang đối tác vận chuyển.',
      })
      scheduleRefetch()
    } catch (error) {
      toast({
        title: 'Không thể điều phối vận chuyển',
        description: error instanceof Error ? error.message : 'Vui lòng kiểm tra lại.',
        variant: 'destructive',
      })
    }
  }

  const toggleSimulation = async (enabled: boolean) => {
    try {
      const res = await apiPatch<{ settings: Record<string, boolean> }>('/api/autopilot', {
        key: 'simulation_mode',
        enabled,
      })
      setData((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      toast({
        title: enabled
          ? 'Đã bật Chế độ Kiểm thử Nhanh (Sandbox 30s)'
          : 'Đã chuyển về Môi trường Vận hành Thực tế',
        description: enabled
          ? 'Vận đơn kiểm thử sẽ tự động chạy hết chu trình giao nhận và khảo sát chất lượng trong 30 giây.'
          : 'Đơn hàng tuân thủ quy trình thực tế: kiểm đếm mã vạch xuất kho và đồng bộ trạng thái từ đơn vị vận chuyển.',
      })
    } catch (error) {
      toast({
        title: 'Không thể chuyển đổi môi trường',
        description: error instanceof Error ? error.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      })
    }
  }

  const master = data?.settings.master ?? false
  const simulationMode = data?.settings.simulation_mode ?? false
  const attentionCount =
    (data?.attention.pendingActive ? data.attention.pendingList.length : 0) +
    (data?.attention.packingStuckActive ? data.attention.packingStuckList.length : 0)

  return (
    <div className="space-y-5">
      {/* ===== Trung tâm Điều phối Tự động AI ===== */}
      <Card
        className={cn(
          'border shadow-sm',
          master
            ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 via-background to-background dark:border-emerald-900 dark:from-emerald-950/40'
            : 'border-amber-200 bg-gradient-to-r from-amber-50 via-background to-background dark:border-amber-900 dark:from-amber-950/40'
        )}
      >
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div
              className={cn(
                'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm',
                master ? 'bg-emerald-600' : 'bg-muted-foreground/50'
              )}
            >
              <Bot className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold leading-tight">
                  Hệ thống Điều phối Tự động AI
                </h2>
                {master ? (
                  <Badge className="inline-flex h-6 items-center rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white shadow-xs">
                    ĐANG KÍCH HOẠT
                  </Badge>
                ) : (
                  <Badge className="inline-flex h-6 items-center rounded-md bg-amber-600 px-2.5 text-[11px] font-semibold text-white shadow-xs">
                    ĐIỀU HÀNH THỦ CÔNG
                  </Badge>
                )}
                {simulationMode ? (
                  <Badge
                    variant="outline"
                    className="inline-flex h-6 items-center rounded-md border-amber-400 bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  >
                    CHẾ ĐỘ KIỂM THỬ (SANDBOX 30S)
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="inline-flex h-6 items-center rounded-md border-sky-300 bg-sky-50 px-2.5 text-[11px] font-semibold text-sky-700 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
                  >
                    MÔI TRƯỜNG THỰC TẾ
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {master
                  ? 'Tổ hợp AI tự động tiếp nhận và xác nhận đơn đa kênh, điều phối đơn vị vận chuyển, chăm sóc sau bán và ghi nhận phản hồi chất lượng theo thời gian thực.'
                  : 'Đang tạm dừng tự động hóa: Đơn hàng và hội thoại mới được chuyển về hàng đợi để nhân sự phê duyệt trực tiếp.'}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-5 sm:justify-end sm:gap-8">
            <div className="text-right">
              <p className="text-xl font-bold leading-tight">{data?.stats.tasksToday ?? 0}</p>
              <p className="text-xs text-muted-foreground">tác vụ hoàn tất hôm nay</p>
            </div>
            <Separator orientation="vertical" className="hidden h-10 sm:block" />
            <div className="text-right">
              <p className="text-xl font-bold leading-tight text-emerald-600">
                {data?.stats.automationRate ?? 100}%
              </p>
              <p className="text-xs text-muted-foreground">tỷ lệ tự động hóa (24h)</p>
            </div>
            <Switch
              checked={master}
              onCheckedChange={toggleMaster}
              aria-label="Bật hoặc tắt Hệ thống Điều phối Tự động AI"
              className="scale-125"
            />
          </div>
        </CardContent>
      </Card>

      {/* ===== Chỉ số Điều hành Thời gian thực (KPI) ===== */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title="Đơn chờ tiếp nhận"
          value={String(data?.stats.pendingOrders ?? 0)}
          icon={Clock}
          loading={loading}
          iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-950"
        />
        <StatCard
          title="Đang xử lý & Đóng gói"
          value={String(data?.stats.processing ?? 0)}
          icon={Package}
          loading={loading}
          iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-950"
        />
        <StatCard
          title="Đang luân chuyển giao hàng"
          value={String(data?.stats.shippingCount ?? 0)}
          icon={Truck}
          loading={loading}
          iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950"
        />
        <StatCard
          title="Tác vụ AI xử lý hôm nay"
          value={String(data?.stats.tasksToday ?? 0)}
          icon={Bot}
          loading={loading}
          hint={`${data?.stats.reviewsToday ?? 0} phản hồi đánh giá · ${data?.stats.messagesToday ?? 0} lượt tương tác`}
          iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950"
        />
      </div>

      {/* ===== Tiến trình Đơn hàng & Cảnh báo Vận hành Trọng yếu ===== */}
      <Card className="border-border/70 shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-2 overflow-x-auto">
            {(data?.pipeline ?? []).map((step, i) => (
              <div key={step.key} className="flex shrink-0 items-center gap-2">
                <div
                  className={cn(
                    'rounded-xl border px-3 py-2 text-center',
                    step.count > 0 ? 'border-primary/30 bg-primary/5' : 'border-border/60'
                  )}
                >
                  <p
                    className={cn(
                      'text-lg font-bold leading-none',
                      step.count > 0 ? 'text-primary' : 'text-muted-foreground/50'
                    )}
                  >
                    {step.count}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{step.label}</p>
                </div>
                {i < (data?.pipeline.length ?? 0) - 1 && (
                  <span className="text-muted-foreground/60">→</span>
                )}
              </div>
            ))}
            {loading && <Skeleton className="h-16 w-full" />}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 border-t pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <button
              type="button"
              onClick={() => onNavigate?.('shipments')}
              className="flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-2 text-left transition-colors hover:bg-amber-100/70 dark:border-amber-900 dark:bg-amber-950/40"
            >
              <Banknote className="h-5 w-5 shrink-0 text-amber-600" />
              <div>
                <p className="text-xs font-bold text-foreground sm:text-sm">
                  Công nợ COD chờ đối soát:{' '}
                  {formatCompactVND(data?.stats.codUnreconciledAmount ?? 0)}
                </p>
                <p className="text-[11px] text-muted-foreground sm:text-xs">
                  {data?.stats.codUnreconciledCount ?? 0} vận đơn chờ quyết toán quỹ
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('inventory')}
              className="flex items-center gap-2.5 rounded-lg border border-rose-200 bg-rose-50/70 px-3.5 py-2 text-left transition-colors hover:bg-rose-100/70 dark:border-rose-900 dark:bg-rose-950/40"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <p className="text-xs font-bold text-foreground sm:text-sm">
                  Cảnh báo tồn kho thấp: {data?.stats.lowStockCount ?? 0} mã
                </p>
                <p className="text-[11px] text-muted-foreground sm:text-xs">Chạm định mức an toàn tối thiểu</p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => onNavigate?.('pos')}
              className="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50/70 px-3.5 py-2 text-left transition-colors hover:bg-sky-100/70 dark:border-sky-900 dark:bg-sky-950/40"
            >
              <Store className="h-5 w-5 shrink-0 text-[#0066CC]" />
              <div>
                <p className="text-xs font-bold text-foreground sm:text-sm">
                  Giao dịch tại quầy hôm nay: {data?.stats.posOrdersToday ?? 0} đơn
                </p>
                <p className="text-[11px] text-muted-foreground sm:text-xs">Truy cập Quầy Thu ngân POS</p>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      {/* ===== Không gian Giám sát & Điều phối Chính ===== */}
      <div className="grid gap-5 lg:grid-cols-5">
        {/* Nhật ký điều hành thời gian thực */}
        <Card className="border-border/70 shadow-sm lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-4 w-4 text-primary" />
              Nhật ký Điều hành AI Thời gian thực
              <span className="relative ml-1 flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => onNavigate?.('autopilot')}
            >
              Cấu hình quy tắc →
            </Button>
          </CardHeader>
          <CardContent className="pt-0 lg:max-h-[560px] lg:overflow-y-auto [scrollbar-width:thin]">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : feed.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Chưa ghi nhận tác vụ tự động trong phiên hiện tại. Khởi chạy kịch bản kiểm thử ở
                bảng bên cạnh để kiểm chứng luồng xử lý.
              </p>
            ) : (
              <div className="space-y-1">
                {feed.map((activity) => (
                  <div
                    key={activity.id}
                    className="flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <AgentDot agent={activity.agent} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">{activity.message}</p>
                      {activity.detail && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {activity.detail}
                        </p>
                      )}
                      <div className="mt-1 flex items-center gap-2">
                        <AgentBadge agent={activity.agent} />
                        <span className="text-[11px] text-muted-foreground">
                          {AGENT_ACTION_LABELS[activity.action] ?? activity.action}
                        </span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(activity.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cột phải: Kiểm thử Nghiệp vụ, Giao vận & Hàng đợi Phê duyệt */}
        <div className="space-y-5 lg:col-span-2">
          {/* Kiểm thử Nghiệp vụ Đa kênh (Sandbox) */}
          <Card className="border-primary/30 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Play className="h-4 w-4 text-primary" />
                  Kiểm thử Nghiệp vụ Đa kênh
                </CardTitle>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Chu trình nhanh (30s)</span>
                  <Switch
                    checked={simulationMode}
                    onCheckedChange={toggleSimulation}
                    aria-label="Bật hoặc tắt chế độ kiểm thử chu trình nhanh 30 giây"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {simulationMode
                  ? 'Chế độ Kiểm thử nhanh: Đơn mẫu tự động hoàn tất toàn trình (Xác nhận → Đóng gói → Giao vận → Đánh giá) trong 30 giây.'
                  : 'Chế độ Quy trình chuẩn: Đơn khởi tạo sẽ dừng tại khâu Đóng gói để chờ kiểm đếm mã vạch và bàn giao đơn vị vận chuyển thực tế.'}
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              <Button
                variant="outline"
                className="h-10 min-h-[40px] justify-start gap-2 px-3.5 text-xs font-medium sm:text-sm"
                disabled={simulating !== null}
                onClick={() => simulate('zalo_order', 'Đơn hàng Zalo OA', 'oa', 'ZALO_OA')}
              >
                <ShoppingBag className="h-4 w-4 text-emerald-600" />
                Tạo đơn kiểm thử · Zalo OA
                {simulating === 'oa' && (
                  <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
              </Button>
              <Button
                variant="outline"
                className="h-10 min-h-[40px] justify-start gap-2 px-3.5 text-xs font-medium sm:text-sm"
                disabled={simulating !== null}
                onClick={() =>
                  simulate('zalo_order', 'Đơn hàng Zalo Cá nhân', 'cn', 'ZALO_PERSONAL')
                }
              >
                <Smartphone className="h-4 w-4 text-teal-600" />
                Tạo đơn kiểm thử · Zalo Cá nhân
                {simulating === 'cn' && (
                  <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
              </Button>
              <Button
                variant="outline"
                className="h-10 min-h-[40px] justify-start gap-2 border-orange-200 px-3.5 text-xs font-medium hover:bg-orange-50 dark:border-orange-900 dark:hover:bg-orange-950/40 sm:text-sm"
                disabled={simulating !== null}
                onClick={() => runDrill('SHOPEE', 'Shopee')}
              >
                <ShoppingBag className="h-4 w-4 text-[#EE4D2D]" />
                Đồng bộ đơn mẫu · Shopee
                {simulating === 'SHOPEE' && (
                  <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-[#EE4D2D] border-t-transparent" />
                )}
              </Button>
              <Button
                variant="outline"
                className="h-10 min-h-[40px] justify-start gap-2 border-pink-200 px-3.5 text-xs font-medium hover:bg-pink-50 dark:border-pink-900 dark:hover:bg-pink-950/40 sm:text-sm"
                disabled={simulating !== null}
                onClick={() => runDrill('TIKTOK', 'TikTok Shop')}
              >
                <Zap className="h-4 w-4 text-[#FE2C55]" />
                Đồng bộ đơn mẫu · TikTok Shop
                {simulating === 'TIKTOK' && (
                  <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-[#FE2C55] border-t-transparent" />
                )}
              </Button>
              <Button
                variant="outline"
                className="h-10 min-h-[40px] justify-start gap-2 px-3.5 text-xs font-medium sm:text-sm"
                disabled={simulating !== null}
                onClick={() => simulate('zalo_message', 'Hội thoại tư vấn khách hàng')}
              >
                <MessageCircle className="h-4 w-4 text-violet-600" />
                Mô phỏng hội thoại tư vấn khách hàng
                {simulating === 'zalo_message' && (
                  <span className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Giám sát Hành trình Giao vận */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Truck className="h-4 w-4 text-orange-600" />
                Giám sát Hành trình Giao vận
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => onNavigate?.('shipments')}
              >
                Quản lý vận đơn →
              </Button>
            </CardHeader>
            <CardContent className="max-h-72 space-y-2 overflow-y-auto pt-0 [scrollbar-width:thin]">
              {(data?.activeShipments ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Hiện không có vận đơn nào đang trên tuyến giao hàng.
                </p>
              ) : (
                data?.activeShipments.map((s) => {
                  const carrier = CARRIERS.find((c) => c.key === s.carrier)
                  return (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          <span className="font-mono text-xs">{s.trackingCode}</span> ·{' '}
                          {s.order?.customer?.name ?? '—'}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: carrier?.color ?? '#999' }}
                          />
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

          {/* Hàng đợi Cần Phê duyệt & Điều phối Kho */}
          {attentionCount > 0 && (
            <Card className="border-amber-300 bg-amber-50/60 shadow-sm dark:border-amber-900 dark:bg-amber-950/30">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
                  <CircleAlert className="h-4 w-4" />
                  Hàng đợi Phê duyệt &amp; Xuất kho ({attentionCount})
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {master && !simulationMode
                    ? 'Hệ thống AI đã xác nhận đơn và lập phiếu soạn hàng — vui lòng hoàn tất kiểm đếm đóng gói tại kho và điều phối vận chuyển.'
                    : 'Tác vụ tự động đang tạm dừng cho nhóm đơn này — vui lòng phê duyệt trực tiếp hoặc kích hoạt lại Điều phối Tự động AI.'}
                </p>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {data?.attention.pendingActive &&
                  data.attention.pendingList.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-background px-3 py-2 dark:border-amber-900"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-medium">{o.code}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.customer?.name} · {o.channel?.name}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 shrink-0"
                        onClick={() => quickConfirm(o.id, o.code)}
                      >
                        Phê duyệt
                      </Button>
                    </div>
                  ))}
                {data?.attention.packingStuckActive &&
                  data.attention.packingStuckList.map((o) => (
                    <div
                      key={o.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-background px-3 py-2 dark:border-amber-900"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-medium">{o.code}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {o.customer?.name ?? 'Khách lẻ'} · Chờ kiểm đếm đóng gói &amp; bàn giao
                          vận chuyển
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 text-xs"
                          onClick={() => onNavigate?.('orders')}
                        >
                          Kiểm đếm
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0"
                          onClick={() => quickDispatch(o.id, o.code)}
                        >
                          Điều phối ĐVVC
                        </Button>
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Danh sách Tác nhân AI đang trực tuyến */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Tổ hợp Tác nhân AI đang trực tuyến:
        </span>
        {Object.values(AGENTS)
          .filter((a) => a.key !== 'SYSTEM')
          .map((a) => (
            <AgentBadge key={a.key} agent={a.key} />
          ))}
      </div>
    </div>
  )
}
