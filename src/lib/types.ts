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
  channel?: Pick<Channel, 'id' | 'key' | 'name' | 'color'> | null
}

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  categoryId: string | null
  category?: Category | null
  costPrice: number
  sellPrice: number
  stock: number
  lowStockThreshold: number
  image: string | null
  status: string
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
  stats?: {
    orderCount: number
    totalSpent: number
    lastOrderAt: string | null
  }
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
  note: string | null
  address: string | null
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
