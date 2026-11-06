// ============================================================
// RBAC ENGINE — Hệ thống Phân quyền Vai trò & Kiểm soát Truy cập
// Dùng chung cho Edge/Node Proxy (src/proxy.ts), API Routes và React UI.
// ============================================================

export type RoleKey =
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER_POS'
  | 'WAREHOUSE'
  | 'ACCOUNTANT'
  | 'MARKETING'

export type AccessLevel = 'NONE' | 'READ' | 'WRITE' | 'FULL'

export type PermissionDomain =
  | 'overview'
  | 'pos'
  | 'orders'
  | 'logistics'
  | 'catalog'
  | 'inventory'
  | 'crm_marketing'
  | 'finance'
  | 'analytics_audit'
  | 'system_iam'

export type CmsViewId =
  | 'pos'
  | 'liveops'
  | 'orders'
  | 'inbox'
  | 'shipments'
  | 'products'
  | 'inventory'
  | 'stock-export'
  | 'stock-balance'
  | 'channels'
  | 'campaigns'
  | 'auto-social'
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
  | 'iam'
  | 'system'

export type PermissionMap = Record<PermissionDomain, AccessLevel>

export const ACCESS_RANK: Record<AccessLevel, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
  FULL: 3,
}

export const ACCESS_LEVEL_LABELS: Record<
  AccessLevel,
  { label: string; shortLabel: string; badgeClass: string }
> = {
  FULL: {
    label: 'Toàn quyền (Xem · Sửa · Xóa/Duyệt)',
    shortLabel: 'Toàn quyền',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  WRITE: {
    label: 'Thao tác (Xem · Tạo · Cập nhật)',
    shortLabel: 'Thao tác',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300',
  },
  READ: {
    label: 'Chỉ xem & tra cứu',
    shortLabel: 'Chỉ xem',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  },
  NONE: {
    label: 'Chặn truy cập (Ẩn menu & 403)',
    shortLabel: 'Chặn',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400',
  },
}

export const PERMISSION_DOMAINS: Array<{
  key: PermissionDomain
  label: string
  description: string
  views: CmsViewId[]
}> = [
  {
    key: 'overview',
    label: 'Tổng quan & Điều hành AI',
    description: 'Bảng tổng quan doanh thu, cảnh báo vận hành & Trung tâm Điều hành AI thời gian thực',
    views: ['dashboard', 'liveops'],
  },
  {
    key: 'pos',
    label: 'Quầy POS Bán tại kho',
    description: 'Bán hàng trực tiếp tại kho (/pos), quét mã vạch, in hóa đơn nhiệt K80',
    views: ['pos'],
  },
  {
    key: 'orders',
    label: 'Đơn hàng & Chat CSKH',
    description: 'Xử lý đơn đa sàn, tạo đơn mới, phản hồi khách trên Zalo OA/Cá nhân',
    views: ['orders', 'inbox'],
  },
  {
    key: 'logistics',
    label: 'Vận chuyển, Đóng gói & COD',
    description: 'Điều phối hãng vận chuyển, đối soát COD, xử lý đổi trả sau bán',
    views: ['shipments'],
  },
  {
    key: 'catalog',
    label: 'Sản phẩm, BOM & Kênh bán',
    description: 'Danh mục hàng hóa, định mức nguyên liệu Combo, đồng bộ sàn TMĐT',
    views: ['products', 'bom', 'channels'],
  },
  {
    key: 'inventory',
    label: 'Kho vận: Xuất · Nhập · Tồn · Cân bằng kho',
    description: 'Nhập kho NVL & hàng mua, Xuất kho, Tồn kho đa chi nhánh, Cân bằng kiểm kê kho',
    views: ['inventory', 'purchase', 'stock-export', 'stock-balance'],
  },
  {
    key: 'crm_marketing',
    label: 'Khách hàng, Khuyến mãi & Social',
    description: 'Hồ sơ hội viên, điểm thưởng, chiến dịch voucher, Auto Social AI 7 kênh',
    views: ['customers', 'campaigns', 'auto-social', 'partners'],
  },
  {
    key: 'finance',
    label: 'Hóa đơn VAT & Sổ quỹ Kế toán',
    description: 'Phát hành hóa đơn điện tử XML, sổ quỹ nội bộ, chốt/mở kỳ kế toán quý',
    views: ['accounting', 'sales'],
  },
  {
    key: 'analytics_audit',
    label: 'Báo cáo Lãi lỗ & Nhật ký Sổ Data',
    description: 'Báo cáo P&L biên lợi nhuận, giá vốn, truy vết nguồn gốc dữ liệu',
    views: ['reports', 'ledger'],
  },
  {
    key: 'system_iam',
    label: 'Hệ thống, Nhân sự & Hành vi Log',
    description: 'Quản lý tài khoản nhân sự, phân quyền RBAC, theo dõi log hành vi, API Key & Go-Live',
    views: ['iam', 'system', 'integrations', 'autopilot'],
  },
]

export interface RoleDefinition {
  key: RoleKey
  label: string
  shortLabel: string
  description: string
  badgeClass: string
  defaultView: CmsViewId
  preset: PermissionMap
}

export const ROLE_DEFINITIONS: Record<RoleKey, RoleDefinition> = {
  ADMIN: {
    key: 'ADMIN',
    label: 'Chủ tiệm / Quản trị tối cao',
    shortLabel: 'Quản trị viên',
    description:
      'Toàn quyền điều hành 100% phân hệ, quản trị nhân sự, phân quyền, khóa kỳ kế toán, cấu hình API và xem toàn bộ nhật ký hành vi.',
    badgeClass:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300',
    defaultView: 'dashboard',
    preset: {
      overview: 'FULL',
      pos: 'FULL',
      orders: 'FULL',
      logistics: 'FULL',
      catalog: 'FULL',
      inventory: 'FULL',
      crm_marketing: 'FULL',
      finance: 'FULL',
      analytics_audit: 'FULL',
      system_iam: 'FULL',
    },
  },
  MANAGER: {
    key: 'MANAGER',
    label: 'Quản lý vận hành cửa hàng',
    shortLabel: 'Quản lý ca',
    description:
      'Điều phối toàn bộ hoạt động bán hàng, kho vận, chiến dịch và xem báo cáo/nhật ký hành vi; không được xóa trắng hệ thống (Go-Live Reset) hoặc sửa nhân sự Admin.',
    badgeClass:
      'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300',
    defaultView: 'dashboard',
    preset: {
      overview: 'FULL',
      pos: 'FULL',
      orders: 'FULL',
      logistics: 'FULL',
      catalog: 'FULL',
      inventory: 'FULL',
      crm_marketing: 'FULL',
      finance: 'WRITE',
      analytics_audit: 'READ',
      system_iam: 'READ',
    },
  },
  CASHIER_POS: {
    key: 'CASHIER_POS',
    label: 'Thu ngân POS & Tư vấn Bán hàng',
    shortLabel: 'Thu ngân POS',
    description:
      'Chuyên đứng quầy POS (/pos), tạo đơn, tư vấn Zalo và tích điểm hội viên. Chặn xem Báo cáo lãi lỗ, Sổ quỹ kế toán, Nhập hàng NCC và Cấu hình hệ thống.',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300',
    defaultView: 'pos',
    preset: {
      overview: 'NONE',
      pos: 'FULL',
      orders: 'WRITE',
      logistics: 'READ',
      catalog: 'READ',
      inventory: 'NONE',
      crm_marketing: 'WRITE',
      finance: 'NONE',
      analytics_audit: 'NONE',
      system_iam: 'NONE',
    },
  },
  WAREHOUSE: {
    key: 'WAREHOUSE',
    label: 'Thủ kho & Đóng gói Vận đơn',
    shortLabel: 'Thủ kho',
    description:
      'Quản lý tồn kho đa điểm, quét mã vạch đóng gói đơn, bàn giao vận chuyển, định mức BOM và phiếu nhập hàng NCC. Chặn Sổ quỹ, Báo cáo tài chính và Hệ thống.',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
    defaultView: 'inventory',
    preset: {
      overview: 'NONE',
      pos: 'NONE',
      orders: 'WRITE',
      logistics: 'WRITE',
      catalog: 'WRITE',
      inventory: 'FULL',
      crm_marketing: 'NONE',
      finance: 'NONE',
      analytics_audit: 'NONE',
      system_iam: 'NONE',
    },
  },
  ACCOUNTANT: {
    key: 'ACCOUNTANT',
    label: 'Kế toán Nội bộ & Hóa đơn VAT',
    shortLabel: 'Kế toán',
    description:
      'Quản lý Sổ quỹ, phát hành Hóa đơn điện tử VAT, phiếu nhập mua, đối soát COD, chốt sổ quý và xem Báo cáo lãi lỗ / Sổ Data.',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
    defaultView: 'accounting',
    preset: {
      overview: 'READ',
      pos: 'NONE',
      orders: 'READ',
      logistics: 'WRITE',
      catalog: 'READ',
      inventory: 'WRITE',
      crm_marketing: 'READ',
      finance: 'FULL',
      analytics_audit: 'FULL',
      system_iam: 'NONE',
    },
  },
  MARKETING: {
    key: 'MARKETING',
    label: 'Chuyên viên Nội dung & Tiếp thị AI',
    shortLabel: 'Marketing',
    description:
      'Vận hành Chương trình khuyến mãi, Auto Social & Lịch AI 7 kênh, đồng bộ mô tả sản phẩm và chăm sóc khách hàng hội viên.',
    badgeClass:
      'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300',
    defaultView: 'campaigns',
    preset: {
      overview: 'READ',
      pos: 'NONE',
      orders: 'READ',
      logistics: 'NONE',
      catalog: 'WRITE',
      inventory: 'NONE',
      crm_marketing: 'FULL',
      finance: 'NONE',
      analytics_audit: 'NONE',
      system_iam: 'NONE',
    },
  },
}

export const ROLE_KEYS = Object.keys(ROLE_DEFINITIONS) as RoleKey[]

export function isValidRole(role: string | null | undefined): role is RoleKey {
  return Boolean(role && role in ROLE_DEFINITIONS)
}

export function isValidAccessLevel(level: string | null | undefined): level is AccessLevel {
  return level === 'NONE' || level === 'READ' || level === 'WRITE' || level === 'FULL'
}

export const VIEW_DOMAIN_MAP: Record<CmsViewId, PermissionDomain> = {
  dashboard: 'overview',
  liveops: 'overview',
  pos: 'pos',
  orders: 'orders',
  inbox: 'orders',
  shipments: 'logistics',
  products: 'catalog',
  bom: 'catalog',
  channels: 'catalog',
  inventory: 'inventory',
  purchase: 'inventory',
  'stock-export': 'inventory',
  'stock-balance': 'inventory',
  customers: 'crm_marketing',
  campaigns: 'crm_marketing',
  'auto-social': 'crm_marketing',
  partners: 'crm_marketing',
  accounting: 'finance',
  sales: 'finance',
  reports: 'analytics_audit',
  ledger: 'analytics_audit',
  autopilot: 'system_iam',
  integrations: 'system_iam',
  iam: 'system_iam',
  system: 'system_iam',
}

export function parseCustomPermissions(
  raw?: string | Partial<PermissionMap> | null
): Partial<PermissionMap> {
  if (!raw) return {}
  try {
    const obj = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : raw
    if (!obj || typeof obj !== 'object') return {}
    const out: Partial<PermissionMap> = {}
    for (const domain of PERMISSION_DOMAINS) {
      const val = (obj as Record<string, unknown>)[domain.key]
      if (typeof val === 'string' && isValidAccessLevel(val)) {
        out[domain.key] = val
      }
    }
    return out
  } catch {
    return {}
  }
}

export function resolveEffectivePermissions(
  roleInput?: string | null,
  customOverrides?: string | Partial<PermissionMap> | null
): PermissionMap {
  const role: RoleKey = isValidRole(roleInput) ? roleInput : 'ADMIN'
  const base = { ...ROLE_DEFINITIONS[role].preset }
  // Quản trị tối cao luôn giữ quyền hệ thống để không bao giờ tự khóa chính mình
  if (role === 'ADMIN') return base
  const overrides = parseCustomPermissions(customOverrides)
  for (const [domain, level] of Object.entries(overrides) as Array<[PermissionDomain, AccessLevel]>) {
    if (level) base[domain] = level
  }
  return base
}

export function hasDomainAccess(
  permissions: PermissionMap,
  domain: PermissionDomain,
  minLevel: AccessLevel = 'READ'
): boolean {
  const current = permissions[domain] ?? 'NONE'
  return ACCESS_RANK[current] >= ACCESS_RANK[minLevel]
}

export function canAccessView(permissions: PermissionMap, viewId: CmsViewId): boolean {
  const domain = VIEW_DOMAIN_MAP[viewId]
  if (!domain) return true
  return hasDomainAccess(permissions, domain, 'READ')
}

export function resolveFirstAllowedView(
  roleInput: string | null | undefined,
  permissions: PermissionMap
): CmsViewId {
  const role: RoleKey = isValidRole(roleInput) ? roleInput : 'ADMIN'
  const preferred = ROLE_DEFINITIONS[role].defaultView
  if (canAccessView(permissions, preferred)) return preferred
  const fallbackOrder: CmsViewId[] = [
    'dashboard',
    'pos',
    'orders',
    'inventory',
    'products',
    'campaigns',
    'accounting',
    'customers',
    'shipments',
    'inbox',
  ]
  for (const v of fallbackOrder) {
    if (canAccessView(permissions, v)) return v
  }
  return 'dashboard'
}

export interface ApiRouteRequirement {
  /** Cho phép nếu người dùng đạt ít nhất 1 trong các domain yêu cầu (VD: tạo hóa đơn bán từ POS hoặc Kế toán) */
  anyOf: Array<{ domain: PermissionDomain; level: AccessLevel }>
  module: string
  description: string
}

/**
 * Ánh xạ đường dẫn /api/* + HTTP Method sang yêu cầu phân quyền RBAC.
 * Trả về null cho các API công khai hoặc danh mục tra cứu nền dùng chung (categories, channels, warehouses GET...).
 */
export function resolveApiRoutePermission(
  pathname: string,
  methodInput: string
): ApiRouteRequirement | null {
  const method = methodInput.toUpperCase()
  const isRead = method === 'GET' || method === 'HEAD'
  const isDelete = method === 'DELETE'
  const writeLevel: AccessLevel = isDelete ? 'FULL' : 'WRITE'

  // Các endpoint xác thực, tự đổi mật khẩu cá nhân, beacon ghi nhận hành vi UI, webhook & mã vạch
  if (
    pathname === '/api' ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/webhooks/') ||
    pathname.startsWith('/api/barcode') ||
    (pathname === '/api/behavior-logs' && method === 'POST') ||
    pathname.startsWith('/api/behavior-logs/internal')
  ) {
    return null
  }

  // Danh mục tham chiếu nền (Kho, Kênh, Danh mục, Voucher, Chính sách điểm, Kỳ kế toán GET)
  // cần cho dropdown ở POS / Đơn hàng — chỉ khóa khi GHI/SỬA/XÓA
  if (
    isRead &&
    (pathname.startsWith('/api/categories') ||
      pathname.startsWith('/api/channels') ||
      pathname.startsWith('/api/warehouses') ||
      pathname.startsWith('/api/vouchers') ||
      pathname.startsWith('/api/loyalty-policy') ||
      pathname.startsWith('/api/periods') ||
      pathname.startsWith('/api/product-attributes'))
  ) {
    return null
  }

  // IAM & Quản trị nhân sự / Nhật ký hành vi
  if (pathname.startsWith('/api/iam/sessions')) {
    // Mọi nhân viên đăng nhập được xem & thu hồi phiên của chính mình; quản lý toàn bộ kiểm tra thêm trong route
    if (isRead || method === 'DELETE') return null
    return {
      anyOf: [{ domain: 'system_iam', level: 'FULL' }],
      module: 'iam',
      description: 'Quản lý phiên đăng nhập hệ thống',
    }
  }
  if (pathname.startsWith('/api/iam') || pathname.startsWith('/api/behavior-logs')) {
    return {
      anyOf: [{ domain: 'system_iam', level: isRead ? 'READ' : 'FULL' }],
      module: 'iam',
      description: isRead ? 'Xem danh sách nhân sự & nhật ký hành vi' : 'Quản trị tài khoản & phân quyền nhân sự',
    }
  }

  // Cấu hình hệ thống, Sao lưu, Go-Live Reset, Kết nối API, Autopilot
  if (pathname.startsWith('/api/system/reset') || pathname.startsWith('/api/system/backup')) {
    return {
      anyOf: [{ domain: 'system_iam', level: 'FULL' }],
      module: 'system',
      description: 'Sao lưu Database & Khởi tạo Go-Live hệ thống',
    }
  }
  if (
    pathname.startsWith('/api/settings') ||
    pathname.startsWith('/api/integrations') ||
    pathname.startsWith('/api/autopilot') ||
    pathname.startsWith('/api/simulate')
  ) {
    return {
      anyOf: [{ domain: 'system_iam', level: isRead ? 'READ' : writeLevel }],
      module: pathname.includes('integrations')
        ? 'integrations'
        : pathname.includes('autopilot')
          ? 'autopilot'
          : 'system',
      description: 'Cấu hình hệ thống, API đối tác & Trợ lý Autopilot',
    }
  }

  // Tổng quan & Điều hành AI (GET cho phép đọc nhẹ cho badge hoặc kiểm tra domain overview khi thao tác)
  if (pathname.startsWith('/api/dashboard') || pathname.startsWith('/api/liveops')) {
    if (isRead) return null
    return {
      anyOf: [{ domain: 'overview', level: writeLevel }],
      module: 'liveops',
      description: 'Vận hành Trung tâm Điều hành AI',
    }
  }

  // Báo cáo Lãi lỗ P&L, Đối soát, Sổ Data, Phân tích AI
  if (
    pathname.startsWith('/api/reports') ||
    pathname.startsWith('/api/ledger') ||
    pathname.startsWith('/api/reconciliation') ||
    pathname.startsWith('/api/lineage') ||
    pathname.startsWith('/api/ai-analysis') ||
    pathname.startsWith('/api/agent-activities')
  ) {
    return {
      anyOf: [{ domain: 'analytics_audit', level: isRead ? 'READ' : writeLevel }],
      module: pathname.includes('ledger') ? 'ledger' : 'reports',
      description: 'Truy cập Báo cáo tài chính Lãi lỗ (P&L) & Nhật ký Sổ Data',
    }
  }

  // Hóa đơn bán VAT, Sổ quỹ kế toán, Chốt sổ quý
  if (pathname.startsWith('/api/sales-invoices')) {
    if (method === 'POST' && pathname === '/api/sales-invoices') {
      // Cho phép cả Kế toán lẫn Thu ngân POS phát hành hóa đơn tự động khi thanh toán tại quầy
      return {
        anyOf: [
          { domain: 'finance', level: 'WRITE' },
          { domain: 'pos', level: 'WRITE' },
        ],
        module: 'sales',
        description: 'Phát hành Hóa đơn bán hàng / Phiếu xuất kho',
      }
    }
    return {
      anyOf: [{ domain: 'finance', level: isRead ? 'READ' : writeLevel }],
      module: 'sales',
      description: 'Quản lý Hóa đơn VAT & Ký số XML',
    }
  }
  if (pathname.startsWith('/api/invoice-dashboard') || pathname.startsWith('/api/periods')) {
    return {
      anyOf: [{ domain: 'finance', level: isRead ? 'READ' : 'FULL' }],
      module: 'accounting',
      description: isRead ? 'Xem Sổ quỹ & Bảng điều khiển Kế toán' : 'Chốt / Mở lại kỳ sổ sách kế toán',
    }
  }

  // Kho hàng & Hóa đơn mua NCC
  if (
    pathname.startsWith('/api/inventory') ||
    pathname.startsWith('/api/purchase-invoices') ||
    pathname.startsWith('/api/warehouses')
  ) {
    return {
      anyOf: [{ domain: 'inventory', level: isRead ? 'READ' : writeLevel }],
      module: pathname.includes('purchase') ? 'purchase' : 'inventory',
      description: 'Quản lý Tồn kho & Hóa đơn nhập hàng NCC',
    }
  }

  // Sản phẩm, Danh mục, BOM, Kênh bán
  if (
    pathname.startsWith('/api/products') ||
    pathname.startsWith('/api/categories') ||
    pathname.startsWith('/api/bom') ||
    pathname.startsWith('/api/channels') ||
    pathname.startsWith('/api/product-attributes')
  ) {
    if (isRead) {
      return {
        anyOf: [
          { domain: 'catalog', level: 'READ' },
          { domain: 'pos', level: 'READ' },
          { domain: 'orders', level: 'READ' },
          { domain: 'inventory', level: 'READ' },
        ],
        module: 'products',
        description: 'Tra cứu danh mục sản phẩm & tồn kho',
      }
    }
    return {
      anyOf: [{ domain: 'catalog', level: writeLevel }],
      module: pathname.includes('bom') ? 'bom' : pathname.includes('channels') ? 'channels' : 'products',
      description: 'Thêm / sửa / xóa Sản phẩm, BOM & Kênh bán',
    }
  }

  // Đơn hàng & Chat đa kênh
  if (pathname.startsWith('/api/orders') || pathname.startsWith('/api/inbox')) {
    return {
      anyOf: [
        { domain: 'orders', level: isRead ? 'READ' : writeLevel },
        { domain: 'pos', level: isRead ? 'READ' : 'WRITE' },
      ],
      module: pathname.includes('inbox') ? 'inbox' : 'orders',
      description: isRead ? 'Xem Đơn hàng & Tin nhắn CSKH' : 'Tạo / xử lý Đơn hàng & Phản hồi khách',
    }
  }

  // Vận chuyển, COD & Đổi trả sau bán
  if (
    pathname.startsWith('/api/shipments') ||
    pathname.startsWith('/api/aftersales') ||
    pathname.startsWith('/api/shipping')
  ) {
    return {
      anyOf: [
        { domain: 'logistics', level: isRead ? 'READ' : writeLevel },
        ...(isRead ? [{ domain: 'orders' as const, level: 'READ' as const }] : []),
      ],
      module: 'shipments',
      description: 'Điều phối Vận chuyển & Đối soát COD',
    }
  }

  // Khách hàng, Chiến dịch, Voucher, Auto Social, Đối tác
  if (
    pathname.startsWith('/api/customers') ||
    pathname.startsWith('/api/campaigns') ||
    pathname.startsWith('/api/vouchers') ||
    pathname.startsWith('/api/social') ||
    pathname.startsWith('/api/partners') ||
    pathname.startsWith('/api/loyalty-policy')
  ) {
    return {
      anyOf: [
        { domain: 'crm_marketing', level: isRead ? 'READ' : writeLevel },
        ...(pathname.startsWith('/api/customers')
          ? [{ domain: 'pos' as const, level: isRead ? ('READ' as const) : ('WRITE' as const) }]
          : []),
        ...(pathname.startsWith('/api/partners')
          ? [
              { domain: 'inventory' as const, level: isRead ? ('READ' as const) : ('WRITE' as const) },
              { domain: 'finance' as const, level: isRead ? ('READ' as const) : ('WRITE' as const) },
            ]
          : []),
      ],
      module: pathname.includes('social')
        ? 'auto-social'
        : pathname.includes('campaigns')
          ? 'campaigns'
          : pathname.includes('partners')
            ? 'partners'
            : 'customers',
      description: 'Quản lý Khách hàng, Chiến dịch khuyến mãi & Auto Social',
    }
  }

  return null
}

export function checkApiRequirement(
  permissions: PermissionMap,
  requirement: ApiRouteRequirement | null
): boolean {
  if (!requirement) return true
  return requirement.anyOf.some((rule) => hasDomainAccess(permissions, rule.domain, rule.level))
}
