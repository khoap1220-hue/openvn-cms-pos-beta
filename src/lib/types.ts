// Shared TypeScript types cho OmniSales CMS — contract giữa API và UI

export interface Channel {
  id: string
  key: string
  name: string
  color: string
  connected: boolean
  feePercent: number
  syncedAt: string | null
  stats?: {
    orders: number
    revenue: number
    listings: number
    /** tiền phí sàn snapshot của các đơn không hủy (đối soát TMĐT) */
    platformFee: number
    /** revenue − platformFee — doanh thu thực nhận sau phí */
    netRevenue: number
  }
}

export interface Category {
  id: string
  name: string
  slug: string
  productCount?: number
}

export interface ProductListing {
  id: string
  productId: string
  channelId: string
  price: number | null
  status: string
  /** bản mô tả đã đồng bộ lên kênh (null = chưa từng đẩy) */
  description?: string | null
  descriptionSyncedAt?: string | null
  channel?: (Pick<Channel, 'id' | 'key' | 'name' | 'color'> & { connected?: boolean }) | null
}

export interface ProductUnitConfig {
  productId: string
  baseUnit: string
  purchaseUnit: string
  purchaseRate: number
  sellUnit: string
  sellRate: number
  posQuickQuantities: number[]
  linkedBaseProductId?: string | null
  updatedAt?: string
}

export interface ProductTypeInfo {
  code: string
  name: string
  description: string
  badgeColor: string
  supportsConversion: boolean
  deductLinkedBaseOnSale?: boolean
  isSystem?: boolean
}

export interface Product {
  id: string
  sku: string
  barcode: string | null
  name: string
  description: string | null
  attributes?: string | null
  categoryId: string | null
  category?: Category | null
  costPrice: number
  sellPrice: number
  stock: number
  lowStockThreshold: number
  image: string | null
  status: string
  unit?: string
  /** SIMPLE | WEIGHT_BULK | PACKAGED_VARIANT | MATERIAL | COMBO */
  type?: string
  /** Cấu hình quy đổi định lượng Nhập (kg/lít/thùng) ⇄ Kho gốc (gr/ml/cái) ⇄ Bán */
  unitConfig?: ProductUnitConfig | null
  /** hàng dễ vỡ (gốm sứ / nến / thủy tinh) — in cảnh báo trên phiếu gửi hàng */
  fragile?: boolean
  /** Kho sở hữu hoặc Shop đối tác liên kết bán chéo */
  ownerWarehouseId?: string | null
  crossSellRate?: number | null
  warehouseStocks?: Array<{ warehouseId: string; quantity: number; warehouse?: { id: string; code: string; name: string; type: string; commissionPct: number } }>
  /** (COMBO) thành phần + giá vốn gộp tính từ Định mức — do API trả về khi có */
  components?: Array<{ productId: string; sku: string; name: string; quantity: number; unit: string; costPrice: number; stock: number }>
  comboCostPrice?: number
  comboAvailable?: number
  createdAt: string
  listings?: ProductListing[]
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  createdAt: string
  /** false = Khách hàng · true = Thành viên (đã đăng ký chương trình thân thiết) */
  isMember?: boolean
  /** MÃ THÀNH VIÊN (TV0001...) — chỉ có khi isMember */
  memberCode?: string | null
  memberAt?: string | null
  /** điểm tích lũy hiện có: 1 điểm / 10.000đ đơn hoàn tất */
  points?: number
  /** hạng thành viên tính từ tổng chi tiêu (server trả về) */
  tier?: MemberTierInfo
  // ===== TRÍ NHỚ DÀI HẠN + CHÂN DUNG (Long-term Context Summary) =====
  avatarUrl?: string | null
  salutation?: string | null
  inferredProfile?: string | null
  contextSummary?: string | null
  preferences?: string | null
  painPoints?: string | null
  nextFollowUp?: string | null
  memoryUpdatedAt?: string | null
  stats?: {
    orderCount: number
    totalSpent: number
    lastOrderAt: string | null
  }
}

// ===== Thành viên & Tích điểm (Khách hàng ⇒ Thành viên) =====

export interface MemberTier {
  key: 'MEMBER' | 'SILVER' | 'GOLD' | 'DIAMOND'
  label: string
  /** ngưỡng tổng chi tiêu tích lũy (đ, từ đơn không hủy) để đạt hạng */
  threshold: number
  /** class Badge (outline) cho hạng */
  badge: string
  /** màu thanh tiến độ tới hạng kế */
  bar: string
}

/** Hạng theo tổng chi tiêu — thấp → cao */
export const MEMBER_TIERS: MemberTier[] = [
  { key: 'MEMBER', label: 'Thành viên mới', threshold: 0, badge: 'bg-stone-100 text-stone-700 border-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:border-stone-800', bar: 'bg-stone-400' },
  { key: 'SILVER', label: 'Hạng Bạc', threshold: 1_000_000, badge: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800', bar: 'bg-slate-400' },
  { key: 'GOLD', label: 'Hạng Vàng', threshold: 3_000_000, badge: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900', bar: 'bg-amber-500' },
  { key: 'DIAMOND', label: 'Hạng Kim cương', threshold: 6_000_000, badge: 'bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900', bar: 'bg-violet-500' },
]

export const POINTS_VND_RATE = 10_000 // 1 điểm / 10.000đ giá trị đơn hoàn tất

/** Tính điểm tích lũy cho 1 đơn hoàn tất */
export function pointsForTotal(total: number): number {
  return Math.max(0, Math.floor(total / POINTS_VND_RATE))
}

export interface MemberTierInfo {
  key: MemberTier['key']
  label: string
  threshold: number
  /** hạng kế tiếp (null nếu đã cao nhất) */
  nextKey?: string
  nextLabel?: string
  nextThreshold?: number
  /** % tiến độ từ ngưỡng hạng hiện tại tới hạng kế (100 nếu cao nhất) */
  progressPct?: number
}

/** Xác định hạng thành viên theo tổng chi tiêu tích lũy */
export function computeTier(totalSpent: number): MemberTierInfo {
  const sorted = [...MEMBER_TIERS].sort((a, b) => a.threshold - b.threshold)
  let current = sorted[0]
  for (const t of sorted) if (totalSpent >= t.threshold) current = t
  const next = sorted.find((t) => t.threshold > current.threshold)
  if (!next) return { key: current.key, label: current.label, threshold: current.threshold, progressPct: 100 }
  const span = next.threshold - current.threshold
  const progressPct = Math.max(0, Math.min(100, Math.round(((totalSpent - current.threshold) / span) * 100)))
  return { key: current.key, label: current.label, threshold: current.threshold, nextKey: next.key, nextLabel: next.label, nextThreshold: next.threshold, progressPct }
}

export interface OrderItem {
  id: string
  orderId: string
  productId: string
  quantity: number
  price: number
  product?: Pick<Product, 'id' | 'sku' | 'name'> | null
}

export interface Order {
  id: string
  code: string
  customerId: string | null
  customer?: Pick<Customer, 'id' | 'name' | 'phone'> | null
  channelId: string
  channel?: Pick<Channel, 'id' | 'key' | 'name' | 'color'> | null
  status: string
  paymentMethod: string
  paymentStatus: string
  subtotal: number
  shippingFee: number
  total: number
  /** snapshot % phí sàn TMĐT lúc tạo đơn (từ kênh) */
  platformFeePct?: number
  /** snapshot tiền phí sàn (subtotal × pct/100) — trừ khi đối soát để tính lợi nhuận thực nhận */
  platformFee?: number
  note: string | null
  address: string | null
  reviewRating?: number | null
  reviewComment?: string | null
  shipments?: Shipment[]
  events?: OrderEvent[]
  createdAt: string
  items: OrderItem[]
}

export interface StockMovement {
  id: string
  productId: string
  type: string
  quantity: number
  stockAfter: number
  note: string | null
  createdAt: string
  product?: Pick<Product, 'id' | 'sku' | 'name' | 'stock'> | null
}

export interface DashboardData {
  stats: {
    revenueToday: number
    revenueMonth: number
    revenueGrowthPct: number | null
    ordersToday: number
    ordersGrowthPct: number | null
    pendingOrders: number
    totalProducts: number
    lowStockCount: number
    activeChannels: number
    totalChannels: number
    avgOrderValue: number
  }
  revenueByDay: Array<{ date: string; label: string; revenue: number; orders: number }>
  ordersByChannel: Array<{ key: string; name: string; color: string; orders: number; revenue: number }>
  recentOrders: Order[]
  lowStockProducts: Array<Pick<Product, 'id' | 'sku' | 'name' | 'stock' | 'lowStockThreshold'>>
  topProducts: Array<{ id: string; sku: string; name: string; sold: number; revenue: number }>
}

export interface ReportsData {
  summary: {
    revenue: number
    orders: number
    avgOrderValue: number
    completionRate: number
    cancelRate: number
  }
  revenueByChannel: Array<{ key: string; name: string; color: string; orders: number; revenue: number }>
  revenueByDay: Array<{ date: string; label: string; revenue: number; orders: number }>
  statusDistribution: Array<{ status: string; count: number }>
  topProducts: Array<{ id: string; sku: string; name: string; sold: number; revenue: number }>
}

// ===== P&L & UNIT ECONOMICS (Báo cáo Lợi nhuận Ròng — 5 tầng) =====
/** 1 dòng P&L: 5 tầng chi phí → Net Profit + % Margin. Dùng cho cả tổng/kênh/sản phẩm. */
export interface PnlRow {
  /** Tầng 1 — Doanh thu gộp (chưa trừ gì) */
  grossRevenue: number
  /** Tầng 2 — Giá vốn (SIMPLE: costPrice × SL · COMBO: định mức BOM) */
  cogs: number
  /** Tầng 3a — Phí sàn TMĐT (snapshot trên đơn + ước tính % phí kênh cho đơn thiếu) */
  platformFee: number
  /** Tầng 3b — Vận chuyển shop hỗ trợ (cước DVVC thực/ước tính − phí thu khách) */
  shippingSubsidy: number
  /** Tầng 4 — Điểm thưởng/hoa hồng Affiliate ước tính (điểm phát sinh × 1.000đ) */
  pointsCost: number
  /** Tầng 5 — Lợi nhuận ròng = 1 − 2 − 3a − 3b − 4 */
  netProfit: number
  /** % Margin = netProfit / grossRevenue */
  marginPct: number
}

export interface PnlChannelRow extends PnlRow {
  key: string
  name: string
  color: string
  orders: number
}

export interface PnlProductRow extends PnlRow {
  id: string
  sku: string
  name: string
  type: string
  /** SIMPLE | COMBO — COMBO tính giá vốn theo định mức BOM */
  units: number
}

export interface PnlData {
  days: number
  /** kỳ lọc: from-to ISO + nhãn hiển thị */
  period: { from: string; to: string; label: string }
  summary: PnlRow & { orders: number }
  byChannel: PnlChannelRow[]
  products: PnlProductRow[]
  /** các giả định ước tính đang dùng — hiển thị minh bạch trên UI */
  assumptions: {
    /** giá trị quy đổi 1 điểm thưởng (đ) */
    pointValueVnd: number
    /** cước DVVC ước tính theo hãng khi Shipment.fee = 0 (đ/đơn) */
    carrierFeeEstimates: Record<string, number>
  }
}

// ===== Constants / Labels =====

export const ORDER_STATUSES = ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING', 'COMPLETED', 'CANCELLED'] as const

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Chờ xử lý',
  CONFIRMED: 'Đã xác nhận',
  PACKING: 'Đang đóng gói',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn thành',
  CANCELLED: 'Đã hủy',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  COD: 'COD',
  BANKING: 'Chuyển khoản',
  MOMO: 'Ví MoMo',
  CARD: 'Thẻ tín dụng',
}

export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  PAID: 'Đã thanh toán',
  UNPAID: 'Chưa thanh toán',
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  IMPORT: 'Nhập kho',
  EXPORT: 'Xuất kho',
  ADJUST: 'Điều chỉnh',
}

// ===== Lớp vận hành tự động (Agent Autopilot) =====

export interface Shipment {
  id: string
  orderId: string
  carrier: string
  trackingCode: string
  status: string
  fee: number
  /** PENDING (chờ đối soát) | RECEIVED (đã nhận COD) | RECONCILED (đã đối soát vào sổ) */
  codStatus: string
  /** tiền thu hộ dự kiến (COD) */
  codAmount: number
  /** tiền COD thực nhận từ ĐVVC */
  codReceived: number
  codReceivedAt: string | null
  codNote: string | null
  dispatchedBy: string
  createdAt: string
  updatedAt: string
  order?: {
    code: string
    total: number
    status: string
    paymentMethod: string
    address?: string | null
    customer?: { id: string; name: string; phone: string | null } | null
    channel?: { id: string; key: string; name: string; color: string } | null
    items?: Array<{ quantity: number; product: { sku: string; name: string; fragile: boolean } } | null>
  } | null
}

export interface AgentActivity {
  id: string
  agent: string
  action: string
  level: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  message: string
  detail: string | null
  createdAt: string
}

export interface OrderEvent {
  id: string
  orderId: string
  type: string
  actor: string
  title: string
  detail: string | null
  createdAt: string
}

export interface DirectMessage {
  id: string
  channelKey: string
  customerId: string | null
  sender: 'CUSTOMER' | 'AGENT' | 'OPERATOR'
  agentName: string | null
  content: string
  relatedOrderId: string | null
  isAuto: boolean
  readAt: string | null
  createdAt: string
  /** ảnh khách đính kèm (multimodal) + AI nhận diện */
  imageUrl?: string | null
  imageAnalysis?: string | null
  /** reactions Agent thả: [{emoji:"❤️", agent:"SUPPORT_AGENT", at}] */
  reactions?: string | null
  customer?: { id: string; name: string; phone: string | null } | null
}

export interface AutomationSettings {
  [key: string]: boolean
}

export interface Conversation {
  key: string
  customerId: string
  channelKey: string
  customer: { id: string; name: string; phone: string | null }
  lastMessage: { content: string; createdAt: string; sender: string; agentName: string | null; isAuto: boolean }
  unread: number
  total: number
}

export interface AttentionOrder {
  id: string
  code: string
  total: number
  createdAt: string
  channel?: { id: string; key: string; name: string; color: string } | null
  customer?: { name: string; phone: string | null } | null
  items?: Array<{ product?: { name: string } | null }>
}

export interface LiveOpsData {
  settings: AutomationSettings
  stats: {
    pendingOrders: number
    processing: number
    shippingCount: number
    completedTotal: number
    tasksToday: number
    reviewsToday: number
    messagesToday: number
    unread: number
    automationRate: number
    codUnreconciledCount?: number
    codUnreconciledAmount?: number
    lowStockCount?: number
    posOrdersToday?: number
  }
  pipeline: Array<{ key: string; label: string; count: number }>
  activities: AgentActivity[]
  activeShipments: Shipment[]
  attention: {
    pendingList: AttentionOrder[]
    packingStuckList: AttentionOrder[]
    pendingActive: boolean
    packingStuckActive: boolean
  }
}

export const CHANNEL_KEY_LABELS: Record<string, string> = {
  ZALO_OA: 'Zalo OA',
  ZALO_PERSONAL: 'Zalo cá nhân',
}

export const AGENT_ACTION_LABELS: Record<string, string> = {
  ORDER_RECEIVED: 'Tiếp nhận đơn mới',
  CONFIRM_ORDER: 'Xác nhận đơn hàng',
  START_PACKING: 'Lập phiếu đóng gói',
  NOTIFY_CARRIER: 'Điều phối vận chuyển',
  PICKUP: 'Bàn giao ĐVVC',
  IN_TRANSIT: 'Đang luân chuyển',
  DELIVERY_NOTICE: 'Thông báo phát hàng',
  CARE_MESSAGE: 'Chăm sóc sau bán',
  REQUEST_REVIEW: 'Khảo sát chất lượng',
  REVIEW_RECEIVED: 'Ghi nhận đánh giá',
  AUTO_REPLY: 'Phản hồi tự động',
  MANUAL_ACTION: 'Điều phối thủ công',
}

// ===== Đa Kho & Liên kết Shop Bán chéo + Chương trình Voucher =====

export interface WarehouseInfo {
  id: string
  code: string
  name: string
  type: 'INTERNAL' | 'PARTNER_SHOP' | string
  address: string | null
  phone: string | null
  managerName: string | null
  commissionPct: number
  isDefault: boolean
  active: boolean
  totalStock?: number
  skuCount?: number
}

export interface CrossSellSettlement {
  warehouseId: string
  code: string
  name: string
  managerName: string | null
  commissionPct: number
  unitsSold: number
  grossRevenue: number
  commissionAmount: number
  netPayableToPartner: number
  products: Array<{
    productId: string
    sku: string
    name: string
    unitsSold: number
    revenue: number
    commissionAmount: number
  }>
}

export interface VoucherInfo {
  id: string
  code: string
  title: string
  description: string | null
  discountType: 'PERCENT' | 'FIXED' | 'FREESHIP' | string
  discountValue: number
  maxDiscount: number | null
  minOrderAmount: number
  usageLimit: number | null
  usedCount: number
  scope: 'ALL' | 'ALLIANCE' | string
  active: boolean
  expiresAt: string | null
}

