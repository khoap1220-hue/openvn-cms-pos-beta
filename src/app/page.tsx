'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Bot } from 'lucide-react'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar, type ViewId } from '@/components/cms/app-sidebar'
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
import { apiGet } from '@/lib/api'
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
  channels: 'Kênh bán',
  customers: 'Khách hàng',
  dashboard: 'Tổng quan',
  reports: 'Báo cáo',
  autopilot: 'Tự động hóa',
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>('liveops')
  const [badges, setBadges] = useState({ pendingOrders: 0, lowStock: 0, unread: 0 })
  const [autopilotOn, setAutopilotOn] = useState(true)
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
      // badge không quan trọng — bỏ qua lỗi
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => void refreshBadges(), 0)
    return () => clearTimeout(t)
  }, [refreshBadges])

  useRealtime((e) => {
    if (!['order.created', 'order.updated', 'message.new', 'settings.updated', 'review.received'].includes(e.type)) return
    if (badgeTimer.current) clearTimeout(badgeTimer.current)
    badgeTimer.current = setTimeout(() => void refreshBadges(), 1200)
  })

  return (
    <SidebarProvider>
      <AppSidebar activeView={activeView} onNavigate={setActiveView} badges={badges} autopilotOn={autopilotOn} />
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
          </div>
        </main>

        <footer className="mt-auto shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1 text-xs text-muted-foreground sm:flex-row">
            <p>
              © {new Date().getFullYear()} <span className="font-semibold text-foreground">OmniSales</span> — CMS bán đa kênh · Agent Autopilot 100% · Lưu trữ vĩnh viễn
            </p>
            <p>Zalo OA · Zalo cá nhân · Shopee · Lazada · TikTok Shop · Tiki · Website · Facebook · POS</p>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
