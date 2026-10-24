// DATA PROVENANCE — hằng số & helper dùng chung cho Truy xuất nguồn gốc dữ liệu
// và Kiểm toán thay đổi (Diff Trước/Sau). File này phải client-safe (không import db).

// ===== Nguồn gốc sinh dữ liệu =====
export type OriginSource =
  | 'SHOPEE_SYNC'
  | 'MARKETPLACE_SYNC'
  | 'ZALO_OA'
  | 'POS'
  | 'AGENT_AUTOPILOT'
  | 'BARCODE_SCAN'
  | 'MANUAL_ADMIN'
  | 'SYSTEM_SEED'

export const ORIGIN_SOURCES: Record<
  OriginSource,
  { label: string; badgeClass: string; hint: string }
> = {
  SHOPEE_SYNC: {
    label: 'Từ Shopee',
    badgeClass:
      'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900',
    hint: 'Đồng bộ tự động từ kênh sàn TMĐT Shopee',
  },
  MARKETPLACE_SYNC: {
    label: 'Kênh online khác',
    badgeClass:
      'bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-400 dark:border-teal-900',
    hint: 'Đồng bộ từ kênh bán online: Lazada, TikTok Shop, Tiki, Website, Facebook...',
  },
  ZALO_OA: {
    label: 'Từ Zalo OA',
    badgeClass:
      'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950 dark:text-sky-400 dark:border-sky-900',
    hint: 'Tin nhắn / đơn từ Zalo Official Account',
  },
  POS: {
    label: 'Tại quầy (POS)',
    badgeClass:
      'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
    hint: 'Bán trực tiếp tại quầy của Ưu Đàm',
  },
  AGENT_AUTOPILOT: {
    label: 'Agent tự động',
    badgeClass:
      'bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900',
    hint: 'Agent Autopilot tự vận hành (xác nhận / kho vận / CSKH / đánh giá / hỗ trợ)',
  },
  BARCODE_SCAN: {
    label: 'Quét mã vạch',
    badgeClass:
      'bg-lime-100 text-lime-700 border-lime-200 dark:bg-lime-950 dark:text-lime-400 dark:border-lime-900',
    hint: 'Thao tác qua bút quét / camera quét mã vạch',
  },
  MANUAL_ADMIN: {
    label: 'Quản trị viên',
    badgeClass:
      'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
    hint: 'Người vận hành nhập liệu trực tiếp trên hệ thống',
  },
  SYSTEM_SEED: {
    label: 'Dữ liệu mẫu',
    badgeClass:
      'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800',
    hint: 'Dữ liệu mẫu / Script khởi tạo hệ thống',
  },
}

export const ORIGIN_SOURCE_KEYS = Object.keys(ORIGIN_SOURCES) as OriginSource[]

export function originLabel(source?: string | null): string {
  if (!source) return 'Không rõ nguồn gốc'
  return ORIGIN_SOURCES[source as OriginSource]?.label ?? source
}

// ===== Actor hiển thị =====
export const ACTOR_NAME_DEFAULTS: Record<string, string> = {
  AGENT: 'Agent Tự động',
  OPERATOR: 'Người vận hành',
  SYSTEM: 'Hệ thống',
  CUSTOMER: 'Khách hàng',
  API: 'API tích hợp',
}

// ===== Nhãn trường cho bảng Diff Trước/Sau =====
export const FIELD_LABELS: Record<string, string> = {
  status: 'Trạng thái',
  codStatus: 'Đối soát COD',
  paymentStatus: 'Thanh toán',
  paymentMethod: 'Hình thức thanh toán',
  stock: 'Tồn kho',
  quantity: 'Số lượng',
  itemCount: 'Số món',
  note: 'Ghi chú',
  total: 'Tổng tiền',
  subtotal: 'Tạm tính',
  shippingFee: 'Phí vận chuyển',
  platformFee: 'Phí sàn TMĐT',
  platformFeePct: '% Phí sàn',
  fee: 'Phí ship',
  codAmount: 'Tiền thu hộ (COD)',
  codReceived: 'COD thực nhận',
  points: 'Điểm TV',
  isMember: 'Thành viên',
  memberCode: 'Mã TV',
  name: 'Tên',
  phone: 'Điện thoại',
  address: 'Địa chỉ',
  email: 'Email',
  sellPrice: 'Giá bán',
  costPrice: 'Giá vốn',
  lowStockThreshold: 'Ngưỡng tồn tối thiểu',
  price: 'Giá',
  carrier: 'Đơn vị vận chuyển',
  trackingCode: 'Mã vận đơn',
  salutation: 'Xưng hô',
  reviewRating: 'Đánh giá',
  reason: 'Lý do',
  resolution: 'Cách xử lý',
  refundAmount: 'Tiền hoàn',
  vatRate: 'VAT (%)',
  vatAmount: 'Tiền VAT',
  invoiceNo: 'Số hóa đơn',
  partnerId: 'Đối tác',
  customerId: 'Khách hàng',
  type: 'Loại',
  level: 'Mức độ',
  active: 'Kích hoạt',
  connected: 'Kết nối',
  feePercent: 'Phí kênh (%)',
  stockAfter: 'Tồn sau',
  fragile: 'Hàng dễ vỡ',
  barcode: 'Mã vạch',
  attributes: 'Đặc tính',
  unit: 'Đơn vị',
  description: 'Mô tả',
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

// Trường tiền tệ — hiển thị định dạng VND trong bảng diff
const MONEY_FIELDS = new Set([
  'total',
  'subtotal',
  'shippingFee',
  'platformFee',
  'fee',
  'codAmount',
  'codReceived',
  'refundAmount',
  'sellPrice',
  'costPrice',
  'price',
  'vatAmount',
])

// Trường boolean có nhãn riêng
const BOOL_LABELS: Record<string, [string, string]> = {
  isMember: ['Khách thường', 'Thành viên'],
  fragile: ['Bình thường', 'Dễ vỡ'],
  active: ['Tắt', 'Bật'],
  connected: ['Ngắt', 'Đã kết nối'],
}

const STATUS_LABELS: Record<string, Record<string, string>> = {
  status: {
    PENDING: 'Chờ xác nhận',
    CONFIRMED: 'Đã xác nhận',
    PACKING: 'Đang đóng gói',
    SHIPPING: 'Đang giao',
    SHIPPED: 'Đã bàn giao ĐVVC',
    DELIVERED: 'Đã giao',
    COMPLETED: 'Hoàn tất',
    CANCELLED: 'Đã hủy',
    DISPATCHED: 'Đã báo ĐVVC',
    PICKED_UP: 'Đã lấy hàng',
    IN_TRANSIT: 'Đang vận chuyển',
    RETURNED: 'Đã trả hàng',
  },
  codStatus: {
    PENDING: 'Chờ đối soát',
    RECEIVED: 'Đã nhận COD',
    RECONCILED: 'Đã đối soát',
  },
  paymentStatus: {
    UNPAID: 'Chưa thanh toán',
    PAID: 'Đã thanh toán',
    REFUNDED: 'Đã hoàn tiền',
  },
  paymentMethod: {
    COD: 'COD',
    BANKING: 'Chuyển khoản',
    MOMO: 'Ví MoMo',
    CARD: 'Thẻ',
  },
  type: {
    IMPORT: 'Nhập kho',
    EXPORT: 'Xuất kho',
    ADJUST: 'Điều chỉnh',
    RETURN: 'Đổi trả',
    EXCHANGE: 'Đổi hàng',
    WARRANTY: 'Bảo hành',
  },
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') {
    const [no, yes] = BOOL_LABELS[field] ?? ['Không', 'Có']
    return value ? yes : no
  }
  if (typeof value === 'number') {
    if (MONEY_FIELDS.has(field)) return formatVNDClient(value)
    return new Intl.NumberFormat('vi-VN').format(value)
  }
  if (typeof value === 'string') {
    const statusMap = STATUS_LABELS[field]
    if (statusMap && statusMap[value]) return statusMap[value]
    // ISO date string
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      try {
        return new Date(value).toLocaleString('vi-VN', { hour12: false })
      } catch {
        return value
      }
    }
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatVNDClient(v: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(Math.round(v))} ₫`
}

// ===== Parse snapshot/changedFields JSON an toàn (client + server dùng chung) =====
export function parseSnapshot(json: string | null | undefined): Record<string, unknown> | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function parseChangedFields(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((f): f is string => typeof f === 'string') : []
  } catch {
    return []
  }
}

// ===== Bộ lọc kỳ kế toán =====
export type PeriodPreset =
  | 'ALL'
  | 'TODAY'
  | 'YESTERDAY'
  | 'LAST7'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'CUSTOM'

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  ALL: 'Tất cả',
  TODAY: 'Hôm nay',
  YESTERDAY: 'Hôm qua',
  LAST7: '7 ngày qua',
  THIS_MONTH: 'Đầu tháng này',
  LAST_MONTH: 'Kỳ trước (tháng trước)',
  CUSTOM: 'Tùy chỉnh',
}

export interface PeriodRange {
  preset: PeriodPreset
  from: string // yyyy-MM-dd
  to: string // yyyy-MM-dd
}

export const EMPTY_PERIOD: PeriodRange = { preset: 'ALL', from: '', to: '' }

function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Chuyển preset thành khoảng [fromDate, toDate] (Date | null) — client + server dùng chung */
export function resolvePeriodRange(range: PeriodRange): { fromDate: Date | null; toDate: Date | null; label: string } {
  const now = new Date()
  switch (range.preset) {
    case 'ALL':
      return { fromDate: null, toDate: null, label: 'Toàn bộ thời gian' }
    case 'TODAY':
      return { fromDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()), toDate: null, label: 'Hôm nay' }
    case 'YESTERDAY': {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
      return { fromDate: y, toDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()), label: 'Hôm qua' }
    }
    case 'LAST7':
      return {
        fromDate: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7),
        toDate: null,
        label: '7 ngày qua',
      }
    case 'THIS_MONTH':
      return {
        fromDate: new Date(now.getFullYear(), now.getMonth(), 1),
        toDate: null,
        label: `Tháng này (từ ${toISODate(new Date(now.getFullYear(), now.getMonth(), 1))})`,
      }
    case 'LAST_MONTH': {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const end = new Date(now.getFullYear(), now.getMonth(), 1)
      return { fromDate: start, toDate: end, label: `Kỳ trước (${toISODate(start)} → ${toISODate(end)})` }
    }
    case 'CUSTOM': {
      const fromDate = range.from ? new Date(`${range.from}T00:00:00`) : null
      const toDate = range.to ? new Date(`${range.to}T23:59:59.999`) : null
      const label = fromDate && toDate ? `${range.from} → ${range.to}` : fromDate ? `Từ ${range.from}` : toDate ? `Đến ${range.to}` : 'Tùy chỉnh'
      return { fromDate, toDate, label }
    }
  }
}

/** Nhãn tình trạng thay đổi cho bộ lọc & badge */
export type ChangedFilter = 'ALL' | 'CHANGED' | 'ORIGINAL'
export const CHANGED_FILTER_LABELS: Record<ChangedFilter, string> = {
  ALL: 'Tất cả',
  CHANGED: 'Đã thay đổi',
  ORIGINAL: 'Nguyên bản',
}
