'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { Bot } from 'lucide-react'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar, type SidebarStatus, type ViewId } from '@/components/cms/app-sidebar'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { LiveOpsView } from '@/components/cms/views/liveops-view'
import { InboxView } from '@/components/cms/views/inbox-view'
import { ShipmentsView } from '@/components/cms/views/shipments-view'
import { AutopilotView } from '@/components/cms/views/autopilot-view'
import { DashboardView } from '@/components/cms/views/dashboard-view'
import { ProductsView } from '@/components/cms/views/products-view'
import { OrdersView } from '@/components/cms/views/orders-view'
import { ChannelsView } from '@/components/cms/views/channels-view'
import { CustomersView } from '@/components/cms/views/customers-view'
import { InventoryView } from '@/components/cms/views/inventory-view'
import { ReportsView } from '@/components/cms/views/reports-view'
import { InvoiceDashboardView } from '@/components/cms/views/invoice-dashboard-view'
import { PartnersView } from '@/components/cms/views/partners-view'
import { BomView } from '@/components/cms/views/bom-view'
import { PurchaseView } from '@/components/cms/views/purchase-view'
import { SalesView } from '@/components/cms/views/sales-view'
import { SystemView } from '@/components/cms/views/system-view'
import { LedgerView } from '@/components/cms/views/ledger-view'
import { IntegrationsView } from '@/components/cms/views/integrations-view'
import { apiGet } from '@/lib/api'
import { getQueueSize, setupOfflineListeners } from '@/lib/offline'
import { useRealtime, useRealtimeStatus } from '@/hooks/use-realtime'
import type { DashboardData, LiveOpsData } from '@/lib/types'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<ViewId, string> = {
  liveops: 'Buồng lái — Vận hành 1 người',
  orders: 'Đơn hàng',
  inbox: 'Hộp thư Zalo',
  shipments: 'Vận chuyển',
  products: 'Sản phẩm',
  inventory: 'Tồn kho',
  bom: 'Kho hàng & Định mức',
  channels: 'Kênh bán',
  customers: 'Khách hàng',
  partners: 'Đối tác',
  purchase: 'Nhập hàng — Hóa đơn mua',
  sales: 'Xuất hàng — Hóa đơn bán',
  dashboard: 'Tổng quan',
  accounting: 'Bảng điều khiển — Vận hành doanh nghiệp',
  reports: 'Báo cáo',
  autopilot: 'Tự động hóa',
  ledger: 'Sổ Data — Nhật ký tổng hợp',
  integrations: 'API & Webhook',
  system: 'Hệ thống',
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>('liveops')
  const [badges, setBadges] = useState({ pendingOrders: 0, lowStock: 0, unread: 0 })
  const [autopilotOn, setAutopilotOn] = useState(true)
  const [status, setStatus] = useState<SidebarStatus>({ offline: false, pendingSync: 0, periodClosed: null })
  const { toast } = useToast()
  const live = useRealtimeStatus()
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshBadges = useCallback(async () => {
    try {
      const [dash, liveops] = await Promise.all([
        apiGet<DashboardData>('/api/dashboard'),
        apiGet<LiveOpsData>('/api/liveops'),
      ])
      setBadges({ pendingOrders: dash.stats.pendingOrders, lowStock: dash.stats.lowStockCount, unread: liveops.stats.unread })
      setAutopilotOn(liveops.settings.master ?? true)
    } catch {
      // badge không quan trọng — bỏ qua lỗi (offline dùng cache của sidebar)
    }
  }, [])

  // Trạng thái offline-first + hàng đợi đồng bộ + chốt sổ kỳ hiện tại
  useEffect(() => {
    const updateQueue = () => setStatus((s) => ({ ...s, pendingSync: getQueueSize() }))
    updateQueue()
    const cleanup = setupOfflineListeners({
      onOnline: () => {
        setStatus((s) => ({ ...s, offline: false, pendingSync: getQueueSize() }))
        toast({ title: 'Đã kết nối lại', description: 'Dữ liệu ngoại tuyến đã được đồng bộ.' })
        void refreshBadges()
      },
      onOffline: () => setStatus((s) => ({ ...s, offline: true })),
      onQueueChange: updateQueue,
    })
    return cleanup
  }, [toast, refreshBadges])

  const refreshPeriodStatus = useCallback(async () => {
    try {
      const now = new Date()
      const year = now.getFullYear()
      const quarter = Math.floor(now.getMonth() / 3) + 1
      const data = await apiGet<{ periods: Array<{ year: number; quarter: number; status: string }> }>(`/api/periods?year=${year}`)
      const p = data.periods.find((x) => x.quarter === quarter)
      setStatus((s) => ({ ...s, periodClosed: p?.status === 'CLOSED' ? { year, quarter } : null }))
    } catch {
      // bỏ qua — offline
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void refreshPeriodStatus(), 0)
    const timer = setInterval(() => void refreshPeriodStatus(), 60_000)
    return () => {
      clearTimeout(t)
      clearInterval(timer)
    }
  }, [refreshPeriodStatus])

  useEffect(() => {
    const t = setTimeout(() => void refreshBadges(), 0)
    return () => clearTimeout(t)
  }, [refreshBadges])

  // Đăng ký Service Worker (Offline-first)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // không chặn ứng dụng nếu SW lỗi
      })
    }
  }, [])

  useRealtime((e) => {
    if (!['order.created', 'order.updated', 'message.new', 'settings.updated', 'review.received'].includes(e.type)) return
    if (badgeTimer.current) clearTimeout(badgeTimer.current)
    badgeTimer.current = setTimeout(() => {
      void refreshBadges()
      if (e.type === 'settings.updated') void refreshPeriodStatus()
    }, 1200)
  })

  return (
    <SidebarProvider>
      <AppSidebar activeView={activeView} onNavigate={setActiveView} badges={badges} autopilotOn={autopilotOn} status={status} />
      <SidebarInset className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <SidebarTrigger aria-label="Mở/đóng thanh điều hướng" />
          <Separator orientation="vertical" className="h-5" />
          <nav aria-label="Định vị" className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="hidden shrink-0 font-semibold text-foreground/70 sm:inline">OmniSales</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="truncate font-medium">{VIEW_LABELS[activeView]}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'hidden gap-1.5 font-medium sm:inline-flex',
                autopilotOn ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400' : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400',
              )}
            >
              <Bot className="h-3.5 w-3.5" />
              Autopilot {autopilotOn ? 'BẬT' : 'TẮT'}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                'gap-1.5 font-medium',
                live ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400' : 'border-border bg-muted text-muted-foreground',
              )}
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2">
                {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
              </span>
              {live ? 'Realtime' : 'Mất kết nối'}
            </Badge>
            <ThemeToggle />
            <Avatar className="hidden h-8 w-8 sm:flex">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">AD</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-[1440px]">
            {activeView === 'liveops' && <LiveOpsView onNavigate={setActiveView} />}
            {activeView === 'orders' && <OrdersView />}
            {activeView === 'inbox' && <InboxView />}
            {activeView === 'shipments' && <ShipmentsView />}
            {activeView === 'autopilot' && <AutopilotView />}
            {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
            {activeView === 'products' && <ProductsView />}
            {activeView === 'channels' && <ChannelsView />}
            {activeView === 'customers' && <CustomersView />}
            {activeView === 'inventory' && <InventoryView />}
            {activeView === 'reports' && <ReportsView />}
            {activeView === 'accounting' && <InvoiceDashboardView onNavigate={(v) => setActiveView(v as ViewId)} />}
            {activeView === 'partners' && <PartnersView />}
            {activeView === 'bom' && <BomView />}
            {activeView === 'purchase' && <PurchaseView />}
            {activeView === 'sales' && <SalesView />}
            {activeView === 'system' && <SystemView />}
            {activeView === 'ledger' && <LedgerView />}
            {activeView === 'integrations' && <IntegrationsView />}
          </div>
        </main>

        <footer className="mt-auto shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1 text-xs text-muted-foreground sm:flex-row">
            <p>
              © {new Date().getFullYear()} <span className="font-semibold text-foreground">OmniSales Suite</span> — CMS bán đa kênh · Agent Autopilot 100% · Invoice Pro hạch toán · Offline-first
            </p>
            <p>Zalo OA · Zalo cá nhân · STMDT (Shopee · Lazada · TikTok · Tiki) · Website · App · Facebook · POS</p>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
