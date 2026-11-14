// Helper fetch API phía client — tích hợp Offline-first + In-Flight Deduplication + Memory Cache:
// - GET: gộp các request trùng lặp đang bay (in-flight coalescing) & cache RAM ngắn hạn (2.5s),
//        mất mạng trả cache lần gần nhất (localStorage).
// - POST/PATCH/PUT/DELETE: xóa ngay cache RAM để hiển thị dữ liệu mới tức thì; mất mạng → xếp vào hàng đợi.

import { cacheGetResponse, getCachedResponse, enqueueMutation } from '@/lib/offline'

const OFFLINE_QUEUED_MESSAGE = 'Mất kết nối — thao tác đã lưu Offline và sẽ tự đồng bộ khi có mạng'

const inflightGetMap = new Map<string, Promise<unknown>>()
const clientMemCache = new Map<string, { data: unknown; expiresAt: number }>()
const CLIENT_MEM_TTL_MS = 120_000

export function invalidateClientApiCache(): void {
  clientMemCache.clear()
}

let prefetchedOnce = false
export function prefetchCoreCmsViews(): void {
  if (prefetchedOnce || typeof window === 'undefined') return
  prefetchedOnce = true
  const coreUrls = [
    '/api/auth',
    '/api/dashboard?days=14',
    '/api/liveops',
    '/api/products',
    '/api/channels',
    '/api/channels/product-links',
    '/api/channels/shopee-session',
    '/api/channels/async-queue',
    '/api/peripherals',
    '/api/orders',
    '/api/inventory',
    '/api/periods',
    '/api/categories',
    '/api/warehouses',
    '/api/unit-conversions',
    '/api/vouchers',
    '/api/loyalty-policy',
    '/api/shipments',
    '/api/customers',
    '/api/reports?days=30',
    '/api/inbox',
    '/api/bom',
    '/api/invoice-dashboard',
    '/api/sales-invoices',
    '/api/purchase-invoices',
    '/api/partners',
    '/api/ledger',
  ]
  setTimeout(() => {
    for (const url of coreUrls) {
      if (!clientMemCache.has(url)) {
        void request(url).catch(() => null)
      }
    }
  }, 150)
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()

  if (method !== 'GET') {
    clientMemCache.clear()
  } else {
    const memHit = clientMemCache.get(url)
    if (memHit && memHit.expiresAt > Date.now()) {
      return memHit.data as T
    }
    const inflight = inflightGetMap.get(url)
    if (inflight) {
      return inflight as Promise<T>
    }
  }

  const runFetch = (async (): Promise<T> => {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        ...options,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || `Lỗi ${res.status}`)
      }
      if (method === 'GET') {
        clientMemCache.set(url, { data: json, expiresAt: Date.now() + CLIENT_MEM_TTL_MS })
        cacheGetResponse(url, json)
      }
      return json as T
    } catch (e) {
      const isNetworkError =
        e instanceof TypeError ||
        (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Load failed'))
      if (!isNetworkError) throw e

      if (method !== 'GET') {
        enqueueMutation(url, method, (options?.body as string) ?? null)
        throw new Error(OFFLINE_QUEUED_MESSAGE)
      }
      const cached = getCachedResponse<T>(url)
      if (cached !== null) return cached
      throw new Error('Ngoại tuyến — chưa có dữ liệu cache cho mục này')
    } finally {
      if (method === 'GET') {
        inflightGetMap.delete(url)
      }
    }
  })()

  if (method === 'GET') {
    inflightGetMap.set(url, runFetch)
  }
  return runFetch
}

export function apiGet<T>(url: string): Promise<T> {
  return request<T>(url)
}

export function apiPost<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'POST', body: JSON.stringify(body) })
}

export function apiPut<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'PUT', body: JSON.stringify(body) })
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return request<T>(url, { method: 'PATCH', body: JSON.stringify(body) })
}

export function apiDelete<T>(url: string): Promise<T> {
  return request<T>(url, { method: 'DELETE' })
}
