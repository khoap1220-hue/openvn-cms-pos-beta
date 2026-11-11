'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { LucideIcon } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ChevronDown,
  ExternalLink,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Megaphone,
  Menu,
  MessageSquare,
  Package,
  Plus,
  ReceiptText,
  Rocket,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react'
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  AppSidebar,
  type CurrentStaffProfile,
  type SidebarStatus,
  type ViewId,
} from '@/components/cms/app-sidebar'
import { QuickSearchDialog } from '@/components/cms/quick-search-dialog'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { PosView } from '@/components/cms/views/pos-view'
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
import { SystemView, type SystemSectionTab } from '@/components/cms/views/system-view'
import type { CatalogSettingsSubTab } from '@/components/cms/views/system-catalog-settings'
import { useShopProfile } from '@/lib/shop-profile'
import { LedgerView } from '@/components/cms/views/ledger-view'
import { IntegrationsView } from '@/components/cms/views/integrations-view'
import { CampaignsView } from '@/components/cms/views/campaigns-view'
import { AutoSocialView } from '@/components/cms/views/auto-social-view'
import { IamView } from '@/components/cms/views/iam-view'
import { apiGet, apiPatch, prefetchCoreCmsViews } from '@/lib/api'
import { trackClientBehavior } from '@/lib/behavior-client'
import { getQueueSize, setupOfflineListeners } from '@/lib/offline'
import {
  ROLE_DEFINITIONS,
  canAccessView,
  isValidRole,
  resolveEffectivePermissions,
  resolveFirstAllowedView,
  type PermissionMap,
} from '@/lib/rbac'
import { useRealtime, useRealtimeStatus } from '@/hooks/use-realtime'
import type { DashboardData, LiveOpsData } from '@/lib/types'
import { cn } from '@/lib/utils'

const VIEW_LABELS: Record<ViewId, string> = {
  pos: 'POS Bán hàng tại kho',
  dashboard: 'Tổng quan kinh doanh',
  liveops: 'Trung tâm Điều hành AI (LiveOps)',
  orders: 'Quản lý Đơn hàng',
  inbox: 'Chat đa kênh (Zalo OA / Cá nhân)',
  shipments: 'Vận chuyển & Đối soát COD',
  products: 'Quản lý Sản phẩm',
  inventory: 'Quản lý Tồn kho & Sổ Thẻ kho',
  'stock-export': 'Xuất kho & Điều chuyển nội bộ',
  'stock-balance': 'Cân bằng kho & Kiểm kê thực tế',
  bom: 'Sản xuất & Định mức (BOM)',
  channels: 'Kênh bán hàng đa sàn',
  campaigns: 'Chương trình & Khuyến mãi (CRM)',
  'auto-social': 'Auto Social — Tiếp thị AI & Lịch Đăng',
  customers: 'Khách hàng & Hội viên',
  partners: 'Nhà cung cấp & Đối tác',
  purchase: 'Nhập kho & Hóa đơn mua hàng',
  sales: 'Bán hàng — Xuất hóa đơn VAT',
  accounting: 'Sổ quỹ & Bảng điều khiển Kế toán',
  reports: 'Báo cáo phân tích & Lãi lỗ',
  autopilot: 'Cấu hình Trợ lý AI Autopilot',
  ledger: 'Nhật ký Sổ Data (Audit Trail)',
  integrations: 'Kết nối API & Webhook',
  iam: 'Nhân sự, Phân quyền & Nhật ký Hành vi',
  system: 'Trung tâm Cấu hình Hệ thống',
}

function isViewId(value: string | null): value is ViewId {
  return Boolean(value && value in VIEW_LABELS)
}

function getAvatarInitials(name: string): string {
  const words = name.replace(/\(.*\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'AD'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

interface MobileNavCandidate {
  id: ViewId
  label: string
  icon: LucideIcon
  primary?: boolean
  badgeKey?: 'pendingOrders' | 'lowStock'
}

const MOBILE_NAV_CANDIDATES: MobileNavCandidate[] = [
  { id: 'dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { id: 'orders', label: 'Đơn hàng', icon: ShoppingCart, badgeKey: 'pendingOrders' },
  { id: 'pos', label: 'POS Kho', icon: Store, primary: true },
  { id: 'products', label: 'Sản phẩm', icon: Package, badgeKey: 'lowStock' },
  { id: 'inventory', label: 'Tồn kho', icon: Warehouse, badgeKey: 'lowStock' },
  { id: 'customers', label: 'Khách hàng', icon: Users },
  { id: 'accounting', label: 'Kế toán', icon: ReceiptText },
  { id: 'campaigns', label: 'Khuyến mãi', icon: Megaphone },
  { id: 'shipments', label: 'Vận đơn', icon: Truck },
]

function MobileBottomNav({
  activeView,
  onNavigate,
  badges,
  permissions,
}: {
  activeView: ViewId
  onNavigate: (view: ViewId) => void
  badges: { pendingOrders: number; lowStock: number; unread: number }
  permissions: PermissionMap
}) {
  const { setOpenMobile } = useSidebar()
  const primaryTabs = useMemo(
    () => MOBILE_NAV_CANDIDATES.filter((t) => canAccessView(permissions, t.id)).slice(0, 4),
    [permissions]
  )
  const isSecondaryView = !primaryTabs.some((t) => t.id === activeView)
  const colClass =
    primaryTabs.length === 4
      ? 'grid-cols-5'
      : primaryTabs.length === 3
        ? 'grid-cols-4'
        : primaryTabs.length === 2
          ? 'grid-cols-3'
          : 'grid-cols-2'

  return (
    <nav
      aria-label="Thanh điều hướng nhanh trên điện thoại"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border/90 bg-card/95 px-2 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-4px_18px_rgba(15,23,42,0.08)] backdrop-blur-md md:hidden"
    >
      <div className={cn('mx-auto grid max-w-md items-end gap-1', colClass)}>
        {primaryTabs.map((tab) => {
          const Icon = tab.icon
          const active = activeView === tab.id
          if (tab.primary) {
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-1.5 py-1.5 text-[11px] font-bold shadow-sm transition-transform active:scale-95',
                  active
                    ? 'bg-[#0052A3] text-white ring-2 ring-[#0066CC]/35'
                    : 'bg-[#0066CC] text-white'
                )}
              >
                <Icon className="h-5 w-5" />
                <span>{tab.label}</span>
              </button>
            )
          }

          const badgeCount =
            tab.badgeKey === 'pendingOrders'
              ? badges.pendingOrders
              : tab.badgeKey === 'lowStock'
                ? badges.lowStock
                : 0

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onNavigate(tab.id)}
              className={cn(
                'relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-primary/10 font-semibold text-[#0066CC] dark:text-sky-400'
                  : 'text-muted-foreground active:bg-muted'
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5" />
                {badgeCount > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1.5 -right-2.5 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-4 text-white',
                      tab.badgeKey === 'pendingOrders' ? 'bg-amber-500' : 'bg-rose-500'
                    )}
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
              <span className="truncate">{tab.label}</span>
            </button>
          )
        })}

        <button
          type="button"
          onClick={() => setOpenMobile(true)}
          className={cn(
            'relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-[11px] font-medium transition-colors',
            isSecondaryView
              ? 'bg-primary/10 font-semibold text-[#0066CC] dark:text-sky-400'
              : 'text-muted-foreground active:bg-muted'
          )}
        >
          <div className="relative">
            <Menu className="h-5 w-5" />
            {badges.unread > 0 && (
              <span className="absolute -top-1 -right-1.5 h-2.5 w-2.5 rounded-full bg-sky-500" />
            )}
          </div>
          <span>Danh mục</span>
        </button>
      </div>
    </nav>
  )
}

interface AuthSessionResponse {
  authenticated: boolean
  revokedOrLocked?: boolean
  mode?: string
  role?: string | null
  user?: CurrentStaffProfile | null
  permissions?: PermissionMap
  authRequired?: boolean
  trackNavigation?: boolean
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>(undefined)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [badges, setBadges] = useState({ pendingOrders: 0, lowStock: 0, unread: 0 })
  const [autopilotOn, setAutopilotOn] = useState(true)
  const [status, setStatus] = useState<SidebarStatus>({ offline: false, pendingSync: 0, periodClosed: null })

  // Trạng thái Xác thực Đa Tài khoản, Phân quyền RBAC & Theo dõi Hành vi
  const [currentUser, setCurrentUser] = useState<CurrentStaffProfile | null>(null)
  const [permissions, setPermissions] = useState<PermissionMap>(() => resolveEffectivePermissions('ADMIN'))
  const [authMode, setAuthMode] = useState<string>('internal-open')
  const [authLoaded, setAuthLoaded] = useState(false)
  const [trackNavigation, setTrackNavigation] = useState(true)

  // Hộp thoại Tự đổi Mật khẩu & Mã PIN cá nhân
  const [selfSecurityOpen, setSelfSecurityOpen] = useState(false)
  const [selfCurrentPwd, setSelfCurrentPwd] = useState('')
  const [selfNewPwd, setSelfNewPwd] = useState('')
  const [selfNewPin, setSelfNewPin] = useState('')
  const [savingSelfSecurity, setSavingSelfSecurity] = useState(false)

  const router = useRouter()
  const { toast } = useToast()
  const realtimeMode = useRealtimeStatus()
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewStayRef = useRef<{ view: ViewId; enteredAt: number } | null>(null)
  const blockedLoggedRef = useRef<string | null>(null)

  const handleNavigateWithParam = useCallback((view: ViewId, param?: string) => {
    if (param) setSelectedCampaignId(param)
    setActiveView(view)
  }, [])

  const [systemSectionTab, setSystemSectionTab] = useState<SystemSectionTab>('CATALOG_MASTER')
  const [systemCatalogSubTab, setSystemCatalogSubTab] = useState<CatalogSettingsSubTab>('CATEGORIES')

  // Tải phiên đăng nhập & phân quyền RBAC hiện hành + đọc ?view= từ URL
  const refreshAuthContext = useCallback(async (isInitial = false) => {
    try {
      const res = await apiGet<AuthSessionResponse>('/api/auth')
      if (res.revokedOrLocked) {
        router.push('/login?reason=revoked')
        return
      }
      const nextPerms = res.permissions ?? resolveEffectivePermissions(res.role ?? 'ADMIN')
      setCurrentUser(res.user ?? null)
      setPermissions(nextPerms)
      setAuthMode(res.mode ?? (res.authenticated ? 'session' : 'internal-open'))
      setTrackNavigation(res.trackNavigation ?? true)
      setAuthLoaded(true)
      prefetchCoreCmsViews()

      if (isInitial && typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const requested = params.get('view')
        if (isViewId(requested) && canAccessView(nextPerms, requested)) {
          setActiveView(requested)
        } else {
          setActiveView((prev) =>
            canAccessView(nextPerms, prev)
              ? prev
              : resolveFirstAllowedView(res.role, nextPerms)
          )
        }
      }
    } catch {
      setAuthLoaded(true)
    }
  }, [router])

  useEffect(() => {
    const t = setTimeout(() => void refreshAuthContext(true), 0)
    return () => clearTimeout(t)
  }, [refreshAuthContext])

  // Ghi nhận hành vi chuyển màn hình kèm thời lượng lưu trang (durationMs) & đồng bộ query ?view=
  useEffect(() => {
    if (!authLoaded || typeof window === 'undefined') return

    const basePath = window.location.pathname || '/'
    const targetUrl = activeView === 'dashboard' ? basePath : `${basePath}?view=${activeView}`
    if (`${window.location.pathname}${window.location.search}` !== targetUrl) {
      window.history.replaceState(null, '', targetUrl)
    }

    const allowed = canAccessView(permissions, activeView)
    if (!allowed) {
      if (blockedLoggedRef.current !== activeView) {
        blockedLoggedRef.current = activeView
        trackClientBehavior({
          category: 'NAVIGATION',
          action: 'ACCESS_BLOCKED_UI',
          module: activeView,
          path: targetUrl,
          summary: `Bị chặn hiển thị phân hệ ${VIEW_LABELS[activeView]} do giới hạn vai trò`,
        })
      }
      return
    }

    blockedLoggedRef.current = null
    const now = Date.now()
    const prev = viewStayRef.current
    const prevDurationMs =
      prev && prev.view !== activeView ? Math.max(0, now - prev.enteredAt) : undefined
    viewStayRef.current = { view: activeView, enteredAt: now }

    if (trackNavigation) {
      trackClientBehavior({
        category: 'NAVIGATION',
        action: 'VIEW_MODULE',
        module: activeView,
        path: targetUrl,
        summary: `Truy cập phân hệ: ${VIEW_LABELS[activeView]}`,
        durationMs: prevDurationMs,
        metadata: prev && prev.view !== activeView ? { previousModule: prev.view } : undefined,
      })
    }
  }, [activeView, authLoaded, permissions, trackNavigation])

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' })
    } catch {
      // ignore
    }
    router.push('/login')
  }

  const handleSaveSelfSecurity = async () => {
    if (!selfNewPwd.trim() && !selfNewPin.trim()) {
      toast({
        title: 'Chưa nhập thông tin mới',
        description: 'Vui lòng nhập mật khẩu mới hoặc mã PIN 4–6 chữ số.',
        variant: 'destructive',
      })
      return
    }
    if (selfNewPin.trim() && !/^\d{4,6}$/.test(selfNewPin.trim())) {
      toast({
        title: 'Mã PIN chưa hợp lệ',
        description: 'Mã PIN ca trực phải gồm 4 đến 6 chữ số (VD: 1234).',
        variant: 'destructive',
      })
      return
    }
    setSavingSelfSecurity(true)
    try {
      await apiPatch('/api/auth', {
        currentPassword: selfCurrentPwd.trim() || undefined,
        newPassword: selfNewPwd.trim() || undefined,
        newPin: selfNewPin.trim() || undefined,
      })
      setSelfSecurityOpen(false)
      setSelfCurrentPwd('')
      setSelfNewPwd('')
      setSelfNewPin('')
      toast({
        title: 'Đã cập nhật thông tin bảo mật cá nhân',
        description: 'Mật khẩu / Mã PIN ca trực mới đã có hiệu lực ngay lập tức.',
      })
      void refreshAuthContext(false)
    } catch (e) {
      toast({
        title: 'Không thể cập nhật bảo mật',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại mật khẩu hiện tại',
        variant: 'destructive',
      })
    } finally {
      setSavingSelfSecurity(false)
    }
  }

  const refreshBadges = useCallback(async () => {
    try {
      const liveops = await apiGet<LiveOpsData>('/api/liveops')
      setBadges({
        pendingOrders: liveops.stats.pendingOrders ?? 0,
        lowStock: liveops.stats.lowStockCount ?? 0,
        unread: liveops.stats.unread ?? 0,
      })
      setAutopilotOn(liveops.settings.master ?? true)
    } catch {
      // badge không quan trọng — bỏ qua lỗi (offline dùng cache của sidebar)
    }
  }, [])

  // Phím tắt toàn cục Ctrl+K / Cmd+K mở thanh tìm kiếm nhanh chuẩn OPENVN
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQuickSearchOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Trạng thái offline-first + hàng đợi đồng bộ + chốt sổ kỳ hiện tại
  useEffect(() => {
    const updateQueue = () => setStatus((s) => ({ ...s, pendingSync: getQueueSize() }))
    const initTimer = setTimeout(updateQueue, 0)
    const cleanup = setupOfflineListeners({
      onOnline: () => {
        setStatus((s) => ({ ...s, offline: false, pendingSync: getQueueSize() }))
        toast({ title: 'Đã kết nối lại', description: 'Dữ liệu ngoại tuyến đã được đồng bộ.' })
        void refreshBadges()
      },
      onOffline: () => setStatus((s) => ({ ...s, offline: true })),
      onQueueChange: updateQueue,
    })
    return () => {
      clearTimeout(initTimer)
      cleanup()
    }
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

  const { profile: shopProfile, refreshProfile: refreshShopProfile } = useShopProfile()

  // 'realtime.poll' = WS hỏng, đang fallback polling 10s → làm mới badge im lặng
  useRealtime((e) => {
    if (!['order.created', 'order.updated', 'message.new', 'settings.updated', 'review.received', 'realtime.poll'].includes(e.type)) return
    if (badgeTimer.current) clearTimeout(badgeTimer.current)
    badgeTimer.current = setTimeout(() => {
      void refreshBadges()
      if (e.type === 'settings.updated') {
        void refreshPeriodStatus()
        void refreshShopProfile()
      }
    }, 1200)
  })

  const canViewDashboard = canAccessView(permissions, 'dashboard')
  const canViewLiveOps = canAccessView(permissions, 'liveops')
  const canViewOrders = canAccessView(permissions, 'orders')
  const canViewInbox = canAccessView(permissions, 'inbox')
  const canViewInventory = canAccessView(permissions, 'inventory')
  const canViewPos = canAccessView(permissions, 'pos')
  const canViewIam = canAccessView(permissions, 'iam')
  const isCurrentViewAllowed = canAccessView(permissions, activeView)
  const fallbackAllowedView = resolveFirstAllowedView(currentUser?.role, permissions)

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const viewLabel = VIEW_LABELS[activeView] || shopProfile.brandSubtitle
      document.title = `${shopProfile.brandName} — ${viewLabel}`
    }
  }, [activeView, shopProfile.brandName, shopProfile.brandSubtitle])

  const displayStaffName = currentUser?.displayName || 'Quản trị viên'
  const displayRoleLabel = currentUser?.roleLabel || 'Toàn quyền'
  const displayUsername = currentUser?.username || 'admin'
  const displayAvatarColor = currentUser?.avatarColor || '#0066CC'
  const displayInitials = getAvatarInitials(displayStaffName)
  const roleBadgeClass =
    currentUser && isValidRole(currentUser.role)
      ? ROLE_DEFINITIONS[currentUser.role].badgeClass
      : ROLE_DEFINITIONS.ADMIN.badgeClass

  return (
    <SidebarProvider>
      <AppSidebar
        activeView={activeView}
        onNavigate={setActiveView}
        onOpenBrandSettings={() => {
          setSystemSectionTab('COMPANY_INVOICE')
          setActiveView('system')
        }}
        badges={badges}
        autopilotOn={autopilotOn}
        status={status}
        permissions={permissions}
        currentUser={currentUser}
      />
      <SidebarInset className="flex min-h-svh min-w-0 flex-1 flex-col overflow-x-clip">
        {/* OPENVN Omni Top Action Bar — Luôn giữ 1 dòng cố định (flex-nowrap), tinh gọn cụm nút bên phải */}
        <header className="sticky top-0 z-30 flex h-14 shrink-0 flex-nowrap items-center gap-2 overflow-hidden border-b bg-card px-3 shadow-2xs sm:px-4">
          <SidebarTrigger aria-label="Mở/đóng thanh điều hướng" />
          <Separator orientation="vertical" className="h-5" />

          {/* Định vị phân hệ hiện tại */}
          <nav aria-label="Định vị" className="flex min-w-0 shrink items-center gap-1.5 text-sm">
            <span className="hidden shrink-0 font-bold text-[#0066CC] xl:inline dark:text-sky-400">
              {shopProfile.brandShortName}
            </span>
            <span className="hidden text-muted-foreground xl:inline">/</span>
            <span className="max-w-[150px] truncate font-semibold text-foreground sm:max-w-[230px] lg:max-w-[280px]">
              {VIEW_LABELS[activeView]}
            </span>
          </nav>

          {/* Thanh Tìm kiếm nhanh toàn hệ thống chuẩn OPENVN (Ctrl+K) */}
          <button
            type="button"
            onClick={() => setQuickSearchOpen(true)}
            className="mx-auto hidden h-9 min-w-[220px] max-w-md flex-1 items-center gap-2 rounded-lg border border-border/80 bg-muted/50 px-3.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted md:flex xl:max-w-lg"
          >
            <Search className="h-4 w-4 shrink-0 text-[#0066CC] dark:text-sky-400" />
            <span className="truncate">Tìm đơn hàng (DH...), SKU, SĐT khách...</span>
            <kbd className="ml-auto shrink-0 rounded border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground">
              Ctrl K
            </kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Nút tìm kiếm cho màn hình nhỏ */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 md:hidden"
              onClick={() => setQuickSearchOpen(true)}
              aria-label="Tìm kiếm nhanh"
            >
              <Search className="h-4 w-4" />
            </Button>

            {/* Cảnh báo tồn kho gọn (chỉ hiện trực tiếp trên màn hình cực rộng >= 2xl, dưới 2xl gộp vào menu Ca trực) */}
            {canViewInventory && badges.lowStock > 0 && (
              <button
                type="button"
                onClick={() => setActiveView('inventory')}
                className="hidden shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 2xl:inline-flex dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300"
                title="Sản phẩm chạm ngưỡng sắp hết hàng"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{badges.lowStock} sắp hết</span>
              </button>
            )}

            {/* 1 Nút CTA chính duy nhất trên Header: Bán tại kho (POS) */}
            {canViewPos && (
              <Button
                size="sm"
                className="hidden h-8 shrink-0 gap-1.5 whitespace-nowrap bg-[#0066CC] px-3 text-xs font-semibold text-white shadow-xs hover:bg-[#0055B3] sm:inline-flex"
                onClick={() => setActiveView('pos')}
              >
                <Store className="h-3.5 w-3.5" />
                <span>Bán tại kho (POS)</span>
              </Button>
            )}

            <ThemeToggle />

            {/* Menu Tài khoản Ca trực + Gộp gọn Trạng thái Hệ thống, AI, Tạo đơn & Cảnh báo */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Tài khoản ca trực, Trạng thái hệ thống & Tác vụ nhanh"
                  className="relative flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 p-1 text-left transition-colors hover:border-primary/40 hover:bg-muted lg:rounded-xl lg:px-2"
                >
                  <div className="relative">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback
                        className="text-[11px] font-bold text-white"
                        style={{ backgroundColor: displayAvatarColor }}
                      >
                        {displayInitials}
                      </AvatarFallback>
                    </Avatar>
                    {/* Chấm trạng thái kết nối Realtime / Tự đồng bộ tích hợp gọn trên Avatar */}
                    <span
                      className={cn(
                        'absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card',
                        realtimeMode === 'live'
                          ? 'bg-emerald-500'
                          : realtimeMode === 'polling'
                            ? 'bg-amber-500'
                            : 'bg-slate-400'
                      )}
                      title={
                        realtimeMode === 'live'
                          ? 'Kết nối Realtime trực tuyến'
                          : realtimeMode === 'polling'
                            ? 'Đang tự đồng bộ định kỳ'
                            : 'Mất kết nối'
                      }
                    />
                  </div>
                  <div className="hidden min-w-0 max-w-[115px] 2xl:block">
                    <p className="truncate text-xs font-semibold leading-tight text-foreground">
                      {displayStaffName}
                    </p>
                    <p className="truncate text-[10px] leading-tight text-muted-foreground">
                      {displayRoleLabel}
                    </p>
                  </div>
                  {(badges.lowStock > 0 || badges.unread > 0) && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white 2xl:hidden">
                      {badges.lowStock + badges.unread}
                    </span>
                  )}
                  <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground lg:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuLabel className="space-y-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{displayStaffName}</p>
                    <Badge variant="outline" className={cn('px-1.5 py-0 text-[10px]', roleBadgeClass)}>
                      {displayRoleLabel}
                    </Badge>
                  </div>
                  <p className="truncate font-mono text-xs font-normal text-muted-foreground">
                    @{displayUsername} · {authMode === 'session' ? 'Phiên bảo vệ RBAC' : 'Mở nội bộ'}
                  </p>
                  {/* Trạng thái Hệ thống & AI gộp gọn trong menu */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        'gap-1 text-[10px] font-medium',
                        realtimeMode === 'live'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          realtimeMode === 'live' ? 'bg-emerald-500' : 'bg-amber-500'
                        )}
                      />
                      {realtimeMode === 'live' ? 'Realtime trực tuyến' : 'Tự đồng bộ (10s)'}
                    </Badge>
                    {canViewLiveOps && (
                      <Badge
                        variant="outline"
                        onClick={() => setActiveView('liveops')}
                        className={cn(
                          'cursor-pointer gap-1 text-[10px] font-medium',
                          autopilotOn
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400'
                            : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400'
                        )}
                      >
                        <Bot className="h-3 w-3" />
                        AI {autopilotOn ? 'BẬT' : 'TẮT'}
                      </Badge>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Tác vụ nhanh & Cảnh báo */}
                {canViewOrders && (
                  <DropdownMenuItem onClick={() => setActiveView('orders')} className="cursor-pointer gap-2">
                    <Plus className="h-4 w-4 text-[#0066CC]" />
                    <span>Tạo đơn hàng mới</span>
                    {badges.pendingOrders > 0 && (
                      <Badge className="ml-auto bg-amber-500 px-1.5 py-0 text-[10px] text-white">
                        {badges.pendingOrders} chờ
                      </Badge>
                    )}
                  </DropdownMenuItem>
                )}
                {canViewInventory && badges.lowStock > 0 && (
                  <DropdownMenuItem onClick={() => setActiveView('inventory')} className="cursor-pointer gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-500" />
                    <span>Cảnh báo tồn kho sắp hết</span>
                    <Badge className="ml-auto bg-rose-500 px-1.5 py-0 text-[10px] text-white">
                      {badges.lowStock} mã
                    </Badge>
                  </DropdownMenuItem>
                )}
                {canViewInbox && badges.unread > 0 && (
                  <DropdownMenuItem onClick={() => setActiveView('inbox')} className="cursor-pointer gap-2">
                    <MessageSquare className="h-4 w-4 text-sky-500" />
                    <span>Tin nhắn Zalo chưa đọc</span>
                    <Badge className="ml-auto bg-sky-500 px-1.5 py-0 text-[10px] text-white">
                      {badges.unread}
                    </Badge>
                  </DropdownMenuItem>
                )}
                {canViewLiveOps && (
                  <DropdownMenuItem onClick={() => setActiveView('liveops')} className="cursor-pointer gap-2">
                    <Rocket className="h-4 w-4 text-emerald-600" />
                    <span>Trung tâm Điều hành AI (LiveOps)</span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                {canViewIam && (
                  <DropdownMenuItem onClick={() => setActiveView('iam')} className="cursor-pointer gap-2">
                    <ShieldCheck className="h-4 w-4 text-[#0066CC]" />
                    <span>Nhân sự, Phân quyền &amp; Hành vi Log</span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem
                  onClick={() => {
                    setSelfCurrentPwd('')
                    setSelfNewPwd('')
                    setSelfNewPin('')
                    setSelfSecurityOpen(true)
                  }}
                  className="cursor-pointer gap-2"
                >
                  <KeyRound className="h-4 w-4 text-amber-600" />
                  <span>Đổi mật khẩu / Mã PIN ca trực</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  onClick={() => {
                    router.push('/login')
                  }}
                  className="cursor-pointer gap-2"
                >
                  <LogIn className="h-4 w-4 text-sky-600" />
                  <span>Chuyển tài khoản / Đổi ca PIN</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => void handleLogout()}
                  className="cursor-pointer gap-2 text-rose-600 focus:text-rose-600"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Đăng xuất &amp; Khóa phiên</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-x-hidden px-2.5 py-3 sm:px-4 sm:py-5 md:px-6">
          <div className="mx-auto w-full max-w-[1440px]">
            {!isCurrentViewAllowed ? (
              <div className="mx-auto my-10 max-w-xl">
                <Card className="border-amber-200 shadow-sm dark:border-amber-900/60">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-300">
                      <ShieldAlert className="h-5 w-5" />
                      Giới hạn Phân quyền Vai trò (RBAC)
                    </CardTitle>
                    <CardDescription>
                      Tài khoản <strong>{displayStaffName}</strong> (@{displayUsername} · Vai trò:{' '}
                      <strong>{displayRoleLabel}</strong>) không có quyền truy cập phân hệ{' '}
                      <strong>{VIEW_LABELS[activeView]}</strong>. Hệ thống đã ghi nhận sự kiện kiểm soát truy cập.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center gap-2.5">
                    <Button
                      className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                      onClick={() => setActiveView(fallbackAllowedView)}
                    >
                      <ArrowLeft className="mr-1.5 h-4 w-4" />
                      Về {VIEW_LABELS[fallbackAllowedView]}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        router.push('/login')
                      }}
                    >
                      <LogIn className="mr-1.5 h-4 w-4" />
                      Đổi tài khoản ca trực
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <>
                {activeView === 'pos' && <PosView />}
                {activeView === 'liveops' && <LiveOpsView onNavigate={setActiveView} />}
                {activeView === 'orders' && <OrdersView />}
                {activeView === 'inbox' && <InboxView />}
                {activeView === 'shipments' && <ShipmentsView />}
                {activeView === 'autopilot' && <AutopilotView />}
                {activeView === 'dashboard' && <DashboardView onNavigate={setActiveView} />}
                {activeView === 'products' && (
                  <ProductsView
                    onOpenSystemCatalog={(subTab) => {
                      setSystemSectionTab('CATALOG_MASTER')
                      setSystemCatalogSubTab(subTab)
                      setActiveView('system')
                    }}
                  />
                )}
                {activeView === 'channels' && <ChannelsView />}
                {activeView === 'campaigns' && <CampaignsView onNavigate={handleNavigateWithParam} />}
                {activeView === 'auto-social' && (
                  <AutoSocialView
                    initialCampaignId={selectedCampaignId}
                    onNavigate={handleNavigateWithParam}
                  />
                )}
                {activeView === 'customers' && <CustomersView />}
                {activeView === 'inventory' && (
                  <InventoryView key="view-stock" initialModule="STOCK" onNavigate={setActiveView} />
                )}
                {activeView === 'stock-export' && (
                  <InventoryView key="view-export" initialModule="EXPORT" onNavigate={setActiveView} />
                )}
                {activeView === 'stock-balance' && (
                  <InventoryView key="view-balance" initialModule="BALANCE" onNavigate={setActiveView} />
                )}
                {activeView === 'reports' && <ReportsView />}
                {activeView === 'accounting' && <InvoiceDashboardView onNavigate={(v) => setActiveView(v as ViewId)} />}
                {activeView === 'partners' && <PartnersView />}
                {activeView === 'bom' && <BomView onNavigate={setActiveView} />}
                {activeView === 'purchase' && <PurchaseView onNavigate={setActiveView} />}
                {activeView === 'sales' && <SalesView />}
                {activeView === 'iam' && <IamView currentPermissions={permissions} />}
                {activeView === 'system' && (
                  <SystemView
                    onNavigate={setActiveView}
                    initialSection={systemSectionTab}
                    initialCatalogSubTab={systemCatalogSubTab}
                    onSectionChange={setSystemSectionTab}
                  />
                )}
                {activeView === 'ledger' && <LedgerView />}
                {activeView === 'integrations' && <IntegrationsView />}
              </>
            )}
          </div>
        </main>

        <footer className="mt-auto shrink-0 border-t bg-card px-4 py-3 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:px-6 md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-[1440px] flex-col items-center justify-between gap-1 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
            <p>
              © {new Date().getFullYear()}{' '}
              <span className="font-semibold text-foreground">{shopProfile.brandName}</span>
              {shopProfile.brandFooterTagline ? ` — ${shopProfile.brandFooterTagline}` : ''}
            </p>
            <div className="flex items-center gap-3">
              <span>Shopee · TikTok · Lazada · Tiki · Zalo OA · POS</span>
              <a
                href={shopProfile.storefrontUrl || '/store'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                Cửa hàng <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </footer>

        <MobileBottomNav
          activeView={activeView}
          onNavigate={setActiveView}
          badges={badges}
          permissions={permissions}
        />

        <QuickSearchDialog
          open={quickSearchOpen}
          onOpenChange={setQuickSearchOpen}
          onNavigate={setActiveView}
          permissions={permissions}
        />

        {/* Hộp thoại tự đổi mật khẩu & mã PIN 4–6 số cá nhân */}
        <Dialog open={selfSecurityOpen} onOpenChange={setSelfSecurityOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Fingerprint className="h-5 w-5 text-[#0066CC]" />
                Bảo mật cá nhân — {displayStaffName}
              </DialogTitle>
              <DialogDescription>
                Cập nhật mật khẩu đăng nhập hoặc mã PIN 4–6 chữ số dùng chuyển ca nhanh tại Quầy POS &amp; Điện thoại (@{displayUsername}).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3.5 py-1">
              <div className="space-y-1.5">
                <Label htmlFor="self-current-pwd">Mật khẩu hiện tại</Label>
                <Input
                  id="self-current-pwd"
                  type="password"
                  value={selfCurrentPwd}
                  onChange={(e) => setSelfCurrentPwd(e.target.value)}
                  placeholder="Nhập mật khẩu hiện tại để xác minh..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="self-new-pwd">Mật khẩu mới (để trống nếu giữ nguyên)</Label>
                <Input
                  id="self-new-pwd"
                  type="password"
                  value={selfNewPwd}
                  onChange={(e) => setSelfNewPwd(e.target.value)}
                  placeholder="Tối thiểu 4 ký tự..."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="self-new-pin">Mã PIN ca trực 4–6 chữ số (để trống nếu giữ nguyên)</Label>
                <Input
                  id="self-new-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={selfNewPin}
                  onChange={(e) => setSelfNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Ví dụ: 1234"
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setSelfSecurityOpen(false)}>
                Hủy
              </Button>
              <Button
                className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                onClick={() => void handleSaveSelfSecurity()}
                disabled={savingSelfSecurity}
              >
                {savingSelfSecurity ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}
                Lưu thông tin mới
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SidebarInset>
    </SidebarProvider>
  )
}
