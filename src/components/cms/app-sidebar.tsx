'use client'

import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bot,
  LayoutDashboard,
  MessagesSquare,
  Package,
  Rocket,
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

interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  badgeKey?: 'pendingOrders' | 'lowStock' | 'unread'
}

const NAV_OPS: NavItem[] = [
  { id: 'liveops', label: 'Buồng lái', icon: Rocket },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingCart, badgeKey: 'pendingOrders' },
  { id: 'inbox', label: 'Hộp thư Zalo', icon: MessagesSquare, badgeKey: 'unread' },
  { id: 'shipments', label: 'Vận chuyển', icon: Truck },
]

const NAV_MANAGE: NavItem[] = [
  { id: 'products', label: 'Sản phẩm', icon: Package },
  { id: 'inventory', label: 'Tồn kho', icon: Warehouse, badgeKey: 'lowStock' },
  { id: 'channels', label: 'Kênh bán', icon: Store },
  { id: 'customers', label: 'Khách hàng', icon: Users },
]

const NAV_INSIGHT: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
  { id: 'autopilot', label: 'Tự động hóa', icon: Bot },
]

export function AppSidebar({
  activeView,
  onNavigate,
  badges,
  autopilotOn,
}: {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  badges: { pendingOrders: number; lowStock: number; unread: number }
  autopilotOn: boolean
}) {
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
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-3 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold leading-tight">OmniSales</p>
            <p className="truncate text-xs text-muted-foreground">CMS bán đa kênh</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
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
          <SidebarGroupLabel>Phân tích</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_INSIGHT)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
          <div className="flex items-center justify-between rounded-lg border bg-card px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium">Autopilot</span>
            </div>
            <Badge className={autopilotOn ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'}>
              {autopilotOn ? 'BẬT' : 'TẮT'}
            </Badge>
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
