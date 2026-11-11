import { useEffect, useState } from 'react'

// OFFLINE-FIRST — hàng đợi thao tác + cache dữ liệu (localStorage).
// Khi mất mạng: mutation (POST/PATCH/PUT/DELETE) được xếp hàng và tự đồng bộ lại khi online;
// GET trả về cache lần gần nhất. Sổ Data & mọi view không cần tự xử lý — lib/api.ts gọi vào đây.

const QUEUE_KEY = 'omni:offline:queue'
const CACHE_PREFIX = 'omni:cache:'
const CACHE_TS_PREFIX = 'omni:cache-ts:'
const MAX_CACHE_BYTES = 400_000

export interface QueuedMutation {
  id: string
  url: string
  method: string
  body: string | null
  queuedAt: string
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function getQueue(): QueuedMutation[] {
  if (typeof window === 'undefined') return []
  return safeParse<QueuedMutation[]>(localStorage.getItem(QUEUE_KEY), [])
}

export function getQueueSize(): number {
  return getQueue().length
}

export function enqueueMutation(url: string, method: string, body: string | null): QueuedMutation {
  const queue = getQueue()
  const item: QueuedMutation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    method,
    body,
    queuedAt: new Date().toISOString(),
  }
  queue.push(item)
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-100)))
  } catch {
    // storage đầy — giữ item mới nhất
    localStorage.setItem(QUEUE_KEY, JSON.stringify([item]))
  }
  window.dispatchEvent(new CustomEvent('omni:queue-changed'))
  return item
}

function removeFromQueue(id: string): void {
  const queue = getQueue().filter((q) => q.id !== id)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new CustomEvent('omni:queue-changed'))
}

/** Phát lại toàn bộ thao tác đã xếp hàng. Trả về số thao tác đồng bộ thành công. */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  const queue = getQueue()
  let synced = 0
  let failed = 0
  for (const item of [...queue]) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: item.body ?? undefined,
      })
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // 4xx = dữ liệu lỗi/kỳ chốt — không retry nữa, bỏ khỏi hàng đợi
        removeFromQueue(item.id)
        if (res.ok) synced++
      } else {
        failed++
      }
    } catch {
      failed++ // vẫn mất mạng — giữ lại để lần sau
    }
  }
  return { synced, failed }
}

// ===== Cache GET cho chế độ đọc offline (ghi bất đồng bộ để không chặn luồng dựng giao diện React) =====
export function cacheGetResponse(url: string, data: unknown): void {
  if (typeof window === 'undefined') return
  setTimeout(() => {
    try {
      const json = JSON.stringify(data)
      if (json.length > MAX_CACHE_BYTES) return
      localStorage.setItem(CACHE_PREFIX + url, json)
      localStorage.setItem(CACHE_TS_PREFIX + url, String(Date.now()))
    } catch {
      // storage đầy — bỏ qua
    }
  }, 0)
}

export function getCachedResponse<T>(url: string): T | null {
  if (typeof window === 'undefined') return null
  return safeParse<T | null>(localStorage.getItem(CACHE_PREFIX + url), null)
}

export function cacheAge(url: string): number | null {
  if (typeof window === 'undefined') return null
  const ts = localStorage.getItem(CACHE_TS_PREFIX + url)
  return ts ? Number(ts) : null
}

// ===== Hook trạng thái online + hàng đợi (dùng ở shell) =====

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

export function setupOfflineListeners(handlers: {
  onOnline: () => void
  onOffline: () => void
  onQueueChange?: () => void
}): () => void {
  const online = () => void (async () => {
    await flushQueue()
    handlers.onOnline()
  })()
  const offline = () => handlers.onOffline()
  const queueChange = () => handlers.onQueueChange?.()
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  window.addEventListener('omni:queue-changed', queueChange)
  return () => {
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
    window.removeEventListener('omni:queue-changed', queueChange)
  }
}
