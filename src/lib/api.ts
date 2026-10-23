// Helper fetch API phía client — tích hợp Offline-first:
// - GET: network-first, mất mạng trả cache lần gần nhất (localStorage).
// - POST/PATCH/PUT/DELETE: mất mạng → xếp vào hàng đợi, tự đồng bộ khi online.

import { cacheGetResponse, getCachedResponse, enqueueMutation } from '@/lib/offline'

const OFFLINE_QUEUED_MESSAGE = 'Mất kết nối — thao tác đã lưu Offline và sẽ tự đồng bộ khi có mạng'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error((json as { error?: string }).error || `Lỗi ${res.status}`)
    }
    if (method === 'GET') cacheGetResponse(url, json)
    return json as T
  } catch (e) {
    const isNetworkError = e instanceof TypeError || (e instanceof Error && (e.message === 'Failed to fetch' || e.message === 'Load failed'))
    if (!isNetworkError) throw e

    if (method !== 'GET') {
      enqueueMutation(url, method, (options?.body as string) ?? null)
      throw new Error(OFFLINE_QUEUED_MESSAGE)
    }
    const cached = getCachedResponse<T>(url)
    if (cached !== null) return cached
    throw new Error('Ngoại tuyến — chưa có dữ liệu cache cho mục này')
  }
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
