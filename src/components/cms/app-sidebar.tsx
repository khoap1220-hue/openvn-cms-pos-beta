'use client'

import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  LayoutDashboard,
  Package,
  ShoppingCart,
  ShoppingBag,
  Store,
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

export type ViewId = 'dashboard' | 'products' | 'orders' | 'channels' | 'customers' | 'inventory' | 'reports'

interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  badgeKey?: 'pendingOrders' | 'lowStock'
}

const NAV_MAIN: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingCart, badgeKey: 'pendingOrders' },
  { id: 'products', label: 'Sản phẩm', icon: Package },
  { id: 'inventory', label: 'Tồn kho', icon: Warehouse, badgeKey: 'lowStock' },
]

const NAV_MANAGE: NavItem[] = [
  { id: 'channels', label: 'Kênh bán', icon: Store },
  { id: 'customers', label: 'Khách hàng', icon: Users },
  { id: 'reports', label: 'Báo cáo', icon: BarChart3 },
]

export function AppSidebar({
  activeView,
  onNavigate,
  badges,
}: {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  badges: { pendingOrders: number; lowStock: number }
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
          <SidebarGroupLabel>Quản trị</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_MAIN)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Phân tích</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{renderItems(NAV_MANAGE)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-2.5 rounded-lg border bg-card p-2 group-data-[collapsible=icon]:justify-center">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">QT</AvatarFallback>
          </Avatar>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium leading-tight">Quản trị viên</p>
            <p className="truncate text-xs text-muted-foreground">admin@omnisales.vn</p>
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
