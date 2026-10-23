'use client'

import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bot,
  Boxes,
  BookOpenText,
  ClipboardList,
  LayoutDashboard,
  MessagesSquare,
  Package,
  PackagePlus,
  PackageMinus,
  Plug,
  ReceiptText,
  Rocket,
  Settings,
  ShoppingCart,
  ShoppingBag,
  Store,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type ViewId =
  | 'liveops'
  | 'orders'
  | 'inbox'
  | 'shipments'
  | 'products'
  | 'inventory'
  | 'channels'
  | 'customers'
  | 'dashboard'
  | 'reports'
  | 'autopilot'
  | 'accounting'
  | 'bom'
  | 'partners'
  | 'purchase'
  | 'sales'
  | 'ledger'
  | 'integrations'
  | 'system'

interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  badgeKey?: 'pendingOrders' | 'lowStock' | 'unread'
}

const NAV_OVERVIEW: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'accounting', label: 'Bảng điều khiển', icon: ReceiptText },
]

const NAV_OPS: NavItem[] = [
  { id: 'liveops', label: 'Buồng lái', icon: Rocket },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingCart, badgeKey: 'pendingOrders' },
  { id: 'inbox', label: 'Hộp thư Zalo', icon: MessagesSquare, badgeKey: 'unread' },
  { id: 'shipments', label: 'Vận chuyển', icon: Truck },
  { id: 'autopilot', label: 'Tự động hóa', icon: Bot },
]

const NAV_MANAGE: NavItem[] = [
  { id: 'products', label: 'Sản phẩm', icon: Package },
  { id: 'inventory', label: 'Tồn kho', icon: Warehouse, badgeKey: 'lowStock' },
  { id: 'bom', label: 'Kho & Định mức', icon: Boxes },
  { id: 'channels', label: 'Kênh bán', icon: Store },
  { id: 'customers', label: 'Khách hàng', icon: Users },
  { id: 'partners', label: 'Đối tác', icon: Users },
]

const NAV_ACCOUNTING: NavItem[] = [
  { id: 'purchase', label: 'Nhập hàng', icon: PackagePlus },
  { id: 'sales', label: 'Xuất hàng', icon: PackageMinus },
]

const NAV_BOOKS: NavItem[] = [
  { id: 'ledger', label: 'Sổ Data', icon: BookOpenText },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
]

const NAV_SYSTEM: NavItem[] = [
  { id: 'system', label: 'Cấu hình', icon: Settings },
  { id: 'integrations', label: 'API & Webhook', icon: Plug },
]

export interface SidebarStatus {
  offline: boolean
  pendingSync: number
  periodClosed: { year: number; quarter: number } | null
}

export function AppSidebar({
  activeView,
  onNavigate,
  badges,
  autopilotOn,
  status,
}: {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  badges: { pendingOrders: number; lowStock: number; unread: number }
  autopilotOn: boolean
  status: SidebarStatus
}) {
  const [now, setNow] = useState('')
  useEffect(() => {
    const update = () => setNow(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  const badgeValue = (item: NavItem) => {
    if (!item.badgeKey) return undefined
    const v = badges[item.badgeKey]
    return v > 0 ? v : undefined
  }

  const renderItems = (items: NavItem[]) =>
    items.map((item) => (
      <SidebarMenuItem key={item.id}>
        <SidebarMenuButton isActive={activeView === item.id} onClick={() => onNavigate(item.id)} tooltip={item.label}>
          <item.icon />
          <span>{item.label}</span>
        </SidebarMenuButton>
        {badgeValue(item) != null && <SidebarMenuBadge className="bg-primary/10 text-primary">{badgeValue(item)}</SidebarMenuBadge>}
      </SidebarMenuItem>
    ))

  return (
    <Sidebar collapsible="icon" style={{ ['--sidebar-width' as string]: '15rem' }}>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-3 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold leading-tight">OmniSales</p>
            <p className="truncate text-xs text-muted-foreground">Bán đa kênh · Invoice Pro</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Tổng quan</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_OVERVIEW)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Vận hành</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_OPS)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Quản trị</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_MANAGE)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Kế toán</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_ACCOUNTING)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Sổ sách & Phân tích</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_BOOKS)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Hệ thống</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_SYSTEM)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
          {/* Chỉ báo trạng thái Offline-first / Chốt sổ — nằm dưới thanh menu trái */}
          {status.offline && (
            <div
              className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
              role="status"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              NGOẠI TUYẾN — {status.pendingSync > 0 ? `${status.pendingSync} thao tác chờ đồng bộ` : 'chế độ Offline'}
            </div>
          )}
          {!status.offline && status.pendingSync > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-2 text-xs font-medium text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              {status.pendingSync} thao tác chờ đồng bộ
            </div>
          )}
          {status.periodClosed && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300">
              <ReceiptText className="h-3.5 w-3.5 shrink-0" />
              ĐÃ CHỐT SỔ — Q{status.periodClosed.quarter}/{status.periodClosed.year}
            </div>
          )}
          <div className="flex items-center justify-between rounded-lg border bg-card px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">Autopilot</span>
            </div>
            <Badge className={cn(autopilotOn ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground')}>
              {autopilotOn ? 'BẬT' : 'TẮT'}
            </Badge>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-card px-2.5 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Giờ hệ thống</span>
            <span className="font-mono text-xs tabular-nums">{now}</span>
          </div>
          <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">QT</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium leading-tight">Quản trị viên</p>
              <p className="truncate text-xs text-muted-foreground">1 người vận hành</p>
            </div>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
