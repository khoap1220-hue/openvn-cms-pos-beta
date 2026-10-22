'use client'

import { useEffect, useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { AppSidebar, type ViewId } from '@/components/cms/app-sidebar'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { DashboardView } from '@/components/cms/views/dashboard-view'
import { ProductsView } from '@/components/cms/views/products-view'
import { OrdersView } from '@/components/cms/views/orders-view'
import { ChannelsView } from '@/components/cms/views/channels-view'
import { CustomersView } from '@/components/cms/views/customers-view'
import { InventoryView } from '@/components/cms/views/inventory-view'
import { ReportsView } from '@/components/cms/views/reports-view'
import { apiGet } from '@/lib/api'
import type { DashboardData } from '@/lib/types'

const VIEW_LABELS: Record<ViewId, string> = {
  dashboard: 'Tổng quan',
  products: 'Sản phẩm',
  orders: 'Đơn hàng',
  channels: 'Kênh bán',
  customers: 'Khách hàng',
  inventory: 'Tồn kho',
  reports: 'Báo cáo',
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [badges, setBadges] = useState({ pendingOrders: 0, lowStock: 0 })

  useEffect(() => {
    let cancelled = false
    apiGet<DashboardData>('/api/dashboard')
      .then((d) => {
        if (!cancelled) setBadges({ pendingOrders: d.stats.pendingOrders, lowStock: d.stats.lowStockCount })
      })
      .catch(() => {
        // Badge không quan trọng — bỏ qua lỗi
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <SidebarProvider>
      <AppSidebar activeView={activeView} onNavigate={setActiveView} badges={badges} />
      <SidebarInset className="flex min-h-svh flex-col">
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/75">
          <SidebarTrigger aria-label="Mở/đóng thanh điều hướng" />
          <Separator orientation="vertical" className="h-5" />
          <nav aria-label="Định vị" className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="hidden shrink-0 font-semibold text-foreground/70 sm:inline">OmniSales</span>
            <span className="hidden text-muted-foreground sm:inline">/</span>
            <span className="truncate font-medium">{VIEW_LABELS[activeView]}</span>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <Avatar className="hidden h-8 w-8 sm:flex">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">AD</AvatarFallback>
            </Avatar>
          </div>
        </header>

        <main className="flex-1 px-4 py-5 md:px-6">
          <div className="mx-auto w-full max-w-[1440px]">
            {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
            {activeView === 'products' && <ProductsView />}
            {activeView === 'orders' && <OrdersView />}
            {activeView === 'channels' && <ChannelsView />}
            {activeView === 'customers' && <CustomersView />}
            {activeView === 'inventory' && <InventoryView />}
            {activeView === 'reports' && <ReportsView />}
          </div>
        </main>

        <footer className="mt-auto shrink-0 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1 text-xs text-muted-foreground sm:flex-row">
            <p>
              © {new Date().getFullYear()} <span className="font-semibold text-foreground">OmniSales</span> — CMS bán hàng đa kênh
            </p>
            <p>Shopee · Lazada · TikTok Shop · Tiki · Website · Facebook · POS</p>
          </div>
        </footer>
      </SidebarInset>
    </SidebarProvider>
  )
}
