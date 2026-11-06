'use client'

import { useEffect, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Bot,
  Boxes,
  BookOpenText,
  ClipboardList,
  ExternalLink,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  PackagePlus,
  PackageMinus,
  Plug,
  ReceiptText,
  Rocket,
  Settings,
  Share2,
  ShieldCheck,
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
import { canAccessView, type CmsViewId, type PermissionMap } from '@/lib/rbac'
import { cn } from '@/lib/utils'

export type ViewId = CmsViewId

export interface CurrentStaffProfile {
  id: string
  username: string
  displayName: string
  role: string
  roleLabel: string
  avatarColor: string
}

interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  badgeKey?: 'pendingOrders' | 'lowStock' | 'unread'
}

const NAV_OVERVIEW: NavItem[] = [
  { id: 'dashboard', label: 'Tổng quan kinh doanh', icon: LayoutDashboard },
  { id: 'liveops', label: 'Trung tâm Điều hành AI', icon: Rocket },
]

const NAV_SALES: NavItem[] = [
  { id: 'pos', label: 'Bán tại kho (POS)', icon: Store },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingCart, badgeKey: 'pendingOrders' },
  { id: 'sales', label: 'Bán hàng & Xuất HĐ', icon: PackageMinus },
  { id: 'shipments', label: 'Vận chuyển & COD', icon: Truck },
  { id: 'inbox', label: 'Chat đa kênh (Zalo)', icon: MessagesSquare, badgeKey: 'unread' },
]

const NAV_CATALOG: NavItem[] = [
  { id: 'products', label: 'Sản phẩm', icon: Package },
  { id: 'purchase', label: 'Nhập kho', icon: PackagePlus },
  { id: 'stock-export', label: 'Xuất kho', icon: PackageMinus },
  { id: 'inventory', label: 'Tồn kho', icon: Warehouse, badgeKey: 'lowStock' },
  { id: 'stock-balance', label: 'Cân bằng kho', icon: ClipboardList },
  { id: 'bom', label: 'Sản xuất & Định mức', icon: Boxes },
]

const NAV_CRM: NavItem[] = [
  { id: 'campaigns', label: 'Chương trình & Khuyến mãi', icon: Megaphone },
  { id: 'auto-social', label: 'Auto Social & Lịch AI', icon: Share2 },
  { id: 'customers', label: 'Khách hàng & Hội viên', icon: Users },
  { id: 'partners', label: 'Nhà cung cấp & Đối tác', icon: Users },
  { id: 'channels', label: 'Kênh bán hàng', icon: Store },
]

const NAV_FINANCE: NavItem[] = [
  { id: 'accounting', label: 'Sổ quỹ & Kế toán', icon: ReceiptText },
  { id: 'reports', label: 'Báo cáo phân tích', icon: BarChart3 },
  { id: 'ledger', label: 'Nhật ký Sổ Data', icon: BookOpenText },
]

const NAV_SYSTEM: NavItem[] = [
  { id: 'iam', label: 'Nhân sự & Hành vi Log', icon: ShieldCheck },
  { id: 'autopilot', label: 'Trợ lý AI Autopilot', icon: Bot },
  { id: 'integrations', label: 'Kết nối API & Webhook', icon: Plug },
  { id: 'system', label: 'Cấu hình hệ thống', icon: Settings },
]

function computeInitials(name: string): string {
  const words = name.replace(/\(.*\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'QT'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

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
  permissions,
  currentUser,
}: {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  badges: { pendingOrders: number; lowStock: number; unread: number }
  autopilotOn: boolean
  status: SidebarStatus
  permissions?: PermissionMap
  currentUser?: CurrentStaffProfile | null
}) {
  const [now, setNow] = useState('')
  useEffect(() => {
    const update = () => setNow(new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }))
    update()
    const t = setInterval(update, 10_000)
    return () => clearInterval(t)
  }, [])

  const filterAllowed = (items: NavItem[]) =>
    permissions ? items.filter((item) => canAccessView(permissions, item.id)) : items

  const allowedOverview = filterAllowed(NAV_OVERVIEW)
  const allowedSales = filterAllowed(NAV_SALES)
  const allowedCatalog = filterAllowed(NAV_CATALOG)
  const allowedCrm = filterAllowed(NAV_CRM)
  const allowedFinance = filterAllowed(NAV_FINANCE)
  const allowedSystem = filterAllowed(NAV_SYSTEM)
  const canOpenPos = !permissions || canAccessView(permissions, 'pos')
  const canOpenAutopilot = !permissions || canAccessView(permissions, 'autopilot')

  const badgeValue = (item: NavItem) => {
    if (!item.badgeKey) return undefined
    const v = badges[item.badgeKey]
    return v > 0 ? v : undefined
  }

  const badgeTone = (item: NavItem) => {
    if (item.badgeKey === 'pendingOrders') return 'bg-amber-600 text-white'
    if (item.badgeKey === 'lowStock') return 'bg-rose-600 text-white'
    return 'bg-[#0066CC] text-white'
  }

  const renderItems = (items: NavItem[]) =>
    items.map((item) => {
      const active = activeView === item.id
      return (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton
            isActive={active}
            onClick={() => onNavigate(item.id)}
            tooltip={item.label}
            className={cn(
              'h-7.5 rounded-lg text-[13px] transition-all',
              active
                ? 'bg-[#0066CC] font-semibold text-white shadow-sm hover:bg-[#0055B3] hover:text-white data-[active=true]:bg-[#0066CC] data-[active=true]:text-white'
                : 'text-sidebar-foreground/90 hover:bg-white/10 hover:text-white'
            )}
          >
            <item.icon className={cn('h-4 w-4 shrink-0', active ? 'text-white' : 'text-sidebar-foreground/80')} />
            <span>{item.label}</span>
          </SidebarMenuButton>
          {badgeValue(item) != null && (
            <SidebarMenuBadge className={cn('rounded-full px-1.5 text-[10px] font-bold shadow-xs', badgeTone(item))}>
              {badgeValue(item)}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      )
    })

  const staffName = currentUser?.displayName || 'Quản trị viên'
  const staffRoleLabel = currentUser?.roleLabel || 'Ca trực'
  const staffInitials = computeInitials(staffName)
  const staffAvatarColor = currentUser?.avatarColor || '#0066CC'

  return (
    <Sidebar collapsible="icon" style={{ ['--sidebar-width' as string]: '15.5rem' }}>
      <SidebarHeader className="border-b border-white/10 pb-2.5">
        <div className="flex items-center gap-2.5 px-2 pt-2 group-data-[collapsible=icon]:justify-center">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0088FF] to-[#0055CC] text-white shadow-md">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-bold tracking-tight text-white">OPENVN · Ưu Đàm</p>
              <span className="rounded bg-[#0066CC]/35 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                OMNI
              </span>
            </div>
            <p className="truncate text-[11px] text-slate-300">Quản lý bán hàng đa kênh</p>
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 px-2 group-data-[collapsible=icon]:hidden">
          {canOpenPos && (
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className={cn(
                'flex flex-1 items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors',
                activeView === 'pos'
                  ? 'border-[#38BDF8]/50 bg-[#0066CC] text-white'
                  : 'border-white/15 bg-white/10 text-white hover:bg-white/15'
              )}
            >
              <span className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 text-[#38BDF8]" />
                Bán tại kho (POS)
              </span>
            </button>
          )}
          <a
            href="/store"
            target="_blank"
            rel="noreferrer"
            title="Xem Cửa hàng trực tuyến"
            aria-label="Xem Cửa hàng trực tuyến"
            className={cn(
              'flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 text-xs text-sidebar-foreground/90 transition-colors hover:bg-white/10 hover:text-white',
              canOpenPos ? 'w-7' : 'flex-1 px-2.5'
            )}
          >
            <ExternalLink className="h-3.5 w-3.5 opacity-80" />
            {!canOpenPos && <span>Xem Cửa hàng trực tuyến</span>}
          </a>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-1">
        {allowedOverview.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Tổng quan &amp; AI
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedOverview)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {allowedSales.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Đơn hàng &amp; Bán hàng
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedSales)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {allowedCatalog.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Kho &amp; Sản xuất
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedCatalog)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {allowedCrm.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Khách hàng &amp; Kênh
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedCrm)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {allowedFinance.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Sổ quỹ &amp; Báo cáo
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedFinance)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {allowedSystem.length > 0 && (
          <SidebarGroup className="px-2 py-0.5">
            <SidebarGroupLabel className="h-5 text-[10px] font-semibold uppercase tracking-wider text-slate-300">
              Hệ thống &amp; Phân quyền
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{renderItems(allowedSystem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-white/10 p-1.5">
        <div className="flex flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
          {status.offline && (
            <div
              className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-300"
              role="status"
              aria-live="polite"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              NGOẠI TUYẾN — {status.pendingSync > 0 ? `${status.pendingSync} chờ đồng bộ` : 'Offline'}
            </div>
          )}
          {!status.offline && status.pendingSync > 0 && (
            <div className="flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-2.5 py-1.5 text-xs font-medium text-sky-300">
              <ClipboardList className="h-3.5 w-3.5 shrink-0" />
              {status.pendingSync} thao tác chờ đồng bộ
            </div>
          )}
          {status.periodClosed && (
            <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300">
              <ReceiptText className="h-3.5 w-3.5 shrink-0" />
              ĐÃ CHỐT SỔ — Q{status.periodClosed.quarter}/{status.periodClosed.year}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback
                  className="text-[11px] font-bold text-white"
                  style={{ backgroundColor: staffAvatarColor }}
                >
                  {staffInitials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold leading-tight text-white">{staffName}</p>
                <p className="truncate text-[10px] text-slate-300">
                  {staffRoleLabel} · <span className="font-mono tabular-nums">{now}</span>
                </p>
              </div>
            </div>
            {canOpenAutopilot && (
              <Badge
                onClick={() => onNavigate('autopilot')}
                className={cn(
                  'cursor-pointer px-1.5 py-0.5 text-[10px] font-semibold',
                  autopilotOn ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30' : 'bg-white/10 text-sidebar-foreground/70'
                )}
                title="Trạng thái Agent Autopilot"
              >
                AI {autopilotOn ? 'BẬT' : 'TẮT'}
              </Badge>
            )}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
