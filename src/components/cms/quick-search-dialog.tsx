'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  Bot,
  Boxes,
  LayoutDashboard,
  Loader2,
  MessagesSquare,
  Package,
  PackageMinus,
  PackagePlus,
  Plug,
  ReceiptText,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { apiGet } from '@/lib/api'
import { trackClientBehavior } from '@/lib/behavior-client'
import { formatVND } from '@/lib/format'
import { canAccessView, type PermissionMap } from '@/lib/rbac'
import { ORDER_STATUS_LABELS } from '@/lib/types'
import type { ViewId } from '@/components/cms/app-sidebar'

interface QuickNavEntry {
  id: ViewId
  label: string
  hint: string
  keywords: string
  icon: typeof LayoutDashboard
}

const QUICK_NAVS: QuickNavEntry[] = [
  { id: 'pos', label: 'Bán tại kho (OPENVN POS)', hint: 'Quầy bán hàng tại kho, quét mã vạch, thu tiền, in K80', keywords: 'pos ban hang tai kho tai quay quet ma vach k80 openvn pos', icon: Store },
  { id: 'dashboard', label: 'Tổng quan kinh doanh', hint: 'Doanh thu, đơn hàng, việc cần xử lý hôm nay', keywords: 'tong quan dashboard doanh thu kpi openvn', icon: LayoutDashboard },
  { id: 'liveops', label: 'Trung tâm Điều hành AI', hint: 'Giám sát tác nhân tự động hóa, luồng xử lý đơn & kiểm thử đa kênh', keywords: 'trung tam dieu hanh ai liveops agent tu dong buong lai', icon: Rocket },
  { id: 'orders', label: 'Quản lý Đơn hàng', hint: 'Tạo đơn, duyệt đơn, quét mã vạch đóng gói, đổi trả', keywords: 'don hang orders pos tao don', icon: ShoppingCart },
  { id: 'sales', label: 'Bán hàng & Xuất hóa đơn VAT', hint: 'Lập phiếu xuất kho, hóa đơn GTGT VietQR', keywords: 'ban hang xuat hoa don vat sales pos', icon: PackageMinus },
  { id: 'shipments', label: 'Vận chuyển & Đối soát COD', hint: 'Theo dõi GHN, GHTK, Viettel Post, thu hộ COD', keywords: 'van chuyen giao hang cod shipments', icon: Truck },
  { id: 'inbox', label: 'Chat đa kênh (Zalo OA / Cá nhân)', hint: 'Hộp thư CSKH tự động & phân tích ảnh Vision', keywords: 'chat zalo inbox hop thu tin nhan', icon: MessagesSquare },
  { id: 'products', label: 'Danh sách Sản phẩm', hint: 'Quản lý SKU, giá kênh, in tem mã vạch CODE128', keywords: 'san pham products sku barcode ma vach', icon: Package },
  { id: 'purchase', label: 'Nhập kho & Hóa đơn mua', hint: 'Nhập nguyên vật liệu, hàng mua, quy đổi định lượng & hóa đơn NCC', keywords: 'nhap kho nhap hang mua hang purchase nha cung cap', icon: PackagePlus },
  { id: 'stock-export', label: 'Xuất kho & Điều chuyển', hint: 'Lập phiếu xuất kho nội bộ, xuất hao hụt, điều chuyển kho A sang B', keywords: 'xuat kho dieu chuyen kho stock export hao hut', icon: PackageMinus },
  { id: 'inventory', label: 'Quản lý Tồn kho & Sổ kho', hint: 'Bảng tồn kho chi tiết, giá trị vốn tồn, cảnh báo sắp hết hàng & sổ XNT', keywords: 'ton kho inventory the kho so kho', icon: Warehouse },
  { id: 'stock-balance', label: 'Cân bằng kho (Kiểm kê thực tế)', hint: 'Kiểm đếm thực tế tại kệ, tự động tính lệch thừa thiếu & cân bằng kho', keywords: 'can bang kho kiem ke stock balance dieu chinh', icon: Warehouse },
  { id: 'bom', label: 'Sản xuất & Định mức BOM', hint: 'Lập lệnh sản xuất tự động trừ NVL cộng thành phẩm & công thức BOM', keywords: 'san xuat combo dinh muc bom nguyen vat lieu', icon: Boxes },
  { id: 'customers', label: 'Khách hàng & Hội viên', hint: 'Chăm sóc khách hàng, nâng hạng thành viên & tích điểm', keywords: 'khach hang hoi vien member tich diem', icon: Users },
  { id: 'partners', label: 'Nhà cung cấp & Đối tác', hint: 'Danh bạ đối tác, mã số thuế, công nợ', keywords: 'doi tac nha cung cap partners mst', icon: Users },
  { id: 'channels', label: 'Kênh bán hàng đa sàn', hint: 'Shopee, TikTok Shop, Lazada, Tiki, Zalo, POS, Website', keywords: 'kenh ban channels shopee tiktok lazada', icon: Store },
  { id: 'accounting', label: 'Sổ quỹ & Bảng điều khiển Kế toán', hint: 'Dòng tiền, công nợ, chốt sổ kỳ kế toán', keywords: 'ke toan so quy accounting chot so', icon: ReceiptText },
  { id: 'reports', label: 'Báo cáo phân tích & Lãi lỗ (P&L)', hint: 'Báo cáo doanh thu, lợi nhuận, AI phân tích tài chính', keywords: 'bao cao reports lai lo pnl phan tich', icon: BarChart3 },
  { id: 'ledger', label: 'Nhật ký Sổ Data (Audit Trail)', hint: 'Truy xuất nguồn gốc dữ liệu & lịch sử chỉnh sửa', keywords: 'so data ledger audit lich su', icon: BookOpenText },
  { id: 'iam', label: 'Nhân sự, Phân quyền & Nhật ký Hành vi', hint: 'Quản lý tài khoản nhân viên, ma trận RBAC 6 vai trò, theo dõi log thao tác & cảnh báo bảo mật', keywords: 'iam nhan su phan quyen rbac log hanh vi tai khoan pin bao mat', icon: ShieldCheck },
  { id: 'autopilot', label: 'Cấu hình Trợ lý AI Autopilot', hint: 'Bật/tắt từng Agent tự động xác nhận, kho vận, CSKH', keywords: 'autopilot cau hinh ai agent', icon: Bot },
  { id: 'integrations', label: 'Kết nối API & Webhook', hint: 'Khóa API, Webhook hai chiều, thông tin kết nối ĐVVC', keywords: 'api webhook integrations tich hop', icon: Plug },
  { id: 'system', label: 'Cấu hình Hệ thống & Bảo mật', hint: 'Thông tin cửa hàng, mật khẩu quản trị, sao lưu DB, Go-Live', keywords: 'he thong cai dat system backup mat khau', icon: Settings },
]

interface SearchResults {
  orders: Array<{ id: string; code: string; status: string; total: number; customer?: { name: string; phone?: string | null } | null }>
  products: Array<{ id: string; sku: string; name: string; stock: number; sellPrice: number }>
  customers: Array<{ id: string; name: string; phone?: string | null; memberCode?: string | null; points: number }>
}

export function QuickSearchDialog({
  open,
  onOpenChange,
  onNavigate,
  permissions,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (view: ViewId) => void
  permissions?: PermissionMap
}) {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResults>({ orders: [], products: [], customers: [] })

  const canReadOrders = !permissions || canAccessView(permissions, 'orders') || canAccessView(permissions, 'pos')
  const canReadProducts =
    !permissions ||
    canAccessView(permissions, 'products') ||
    canAccessView(permissions, 'pos') ||
    canAccessView(permissions, 'orders') ||
    canAccessView(permissions, 'inventory')
  const canReadCustomers = !permissions || canAccessView(permissions, 'customers') || canAccessView(permissions, 'pos')

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({ orders: [], products: [], customers: [] })
    }
  }, [open])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults({ orders: [], products: [], customers: [] })
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const [ordRes, prodRes, custRes] = await Promise.all([
          canReadOrders
            ? apiGet<{ orders: SearchResults['orders'] }>(`/api/orders?search=${encodeURIComponent(q)}&pageSize=4`)
            : Promise.resolve({ orders: [] }),
          canReadProducts
            ? apiGet<{ products: SearchResults['products'] }>(`/api/products?search=${encodeURIComponent(q)}`)
            : Promise.resolve({ products: [] }),
          canReadCustomers
            ? apiGet<{ customers: SearchResults['customers'] }>(`/api/customers?search=${encodeURIComponent(q)}`)
            : Promise.resolve({ customers: [] }),
        ])
        if (!cancelled) {
          setResults({
            orders: (ordRes.orders ?? []).slice(0, 4),
            products: (prodRes.products ?? []).slice(0, 4),
            customers: (custRes.customers ?? []).slice(0, 4),
          })
        }
      } catch {
        // ignore search errors
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 220)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, canReadOrders, canReadProducts, canReadCustomers])

  const matchedNavs = useMemo(() => {
    const allowedNavs = permissions
      ? QUICK_NAVS.filter((item) => canAccessView(permissions, item.id))
      : QUICK_NAVS
    const q = query.trim().toLowerCase()
    if (!q) return allowedNavs.slice(0, 8)
    return allowedNavs.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.keywords.includes(q)
    ).slice(0, 6)
  }, [query, permissions])

  const selectView = (view: ViewId) => {
    const q = query.trim()
    if (q.length >= 2) {
      trackClientBehavior({
        category: 'NAVIGATION',
        action: 'QUICK_SEARCH',
        module: view,
        summary: `Tìm kiếm nhanh Ctrl+K "${q.slice(0, 60)}" → mở ${view}`,
        metadata: { keyword: q.slice(0, 60), targetView: view },
      })
    }
    onNavigate(view)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[82vh] overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Tìm kiếm nhanh toàn hệ thống OPENVN</DialogTitle>
          <DialogDescription>Tìm đơn hàng, sản phẩm, khách hàng hoặc chuyển nhanh giữa các phân hệ.</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-primary" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập mã đơn (DH...), tên/SKU sản phẩm, SĐT khách hàng hoặc tên phân hệ..."
            className="h-9 border-0 px-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
          {/* Kết quả Đơn hàng */}
          {results.orders.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Đơn hàng khớp từ khóa
              </p>
              <div className="space-y-1">
                {results.orders.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => selectView('orders')}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/70"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold text-primary">{o.code}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {o.customer?.name ?? 'Khách lẻ'} {o.customer?.phone ? `· ${o.customer.phone}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className="text-[11px]">
                        {ORDER_STATUS_LABELS[o.status] ?? o.status}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{formatVND(o.total)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Kết quả Sản phẩm */}
          {results.products.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Sản phẩm &amp; Tồn kho
              </p>
              <div className="space-y-1">
                {results.products.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectView('products')}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline" className={p.stock <= 5 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'text-[11px]'}>
                        Tồn: {p.stock}
                      </Badge>
                      <span className="text-sm font-semibold tabular-nums">{formatVND(p.sellPrice)}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Kết quả Khách hàng */}
          {results.customers.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Khách hàng &amp; Hội viên
              </p>
              <div className="space-y-1">
                {results.customers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectView('customers')}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/70"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.phone ?? 'Chưa có SĐT'}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.memberCode && (
                        <Badge className="bg-primary/10 text-primary hover:bg-primary/15">{c.memberCode}</Badge>
                      )}
                      <span className="text-xs font-medium text-muted-foreground">{c.points} điểm</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Điều hướng nhanh phân hệ OPENVN */}
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {query.trim() ? 'Phân hệ chức năng phù hợp' : 'Truy cập nhanh phân hệ OPENVN'}
            </p>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {matchedNavs.map((nav) => (
                <button
                  key={nav.id}
                  type="button"
                  onClick={() => selectView(nav.id)}
                  className="flex items-center gap-2.5 rounded-lg border border-border/60 bg-card px-3 py-2 text-left transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <nav.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{nav.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{nav.hint}</p>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
