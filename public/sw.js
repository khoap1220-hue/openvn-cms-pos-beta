// OmniSales Suite — Service Worker (Offline-first)
// Chiến lược: network-first cho mọi request; khi mất mạng mới dùng cache.
// Cache: điều hướng trang + GET /api/* + static assets. Không đụng websocket/HMR.

const SHELL_CACHE = 'omni-shell-v1'
const API_CACHE = 'omni-api-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(['/']).catch(() => undefined)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== API_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return // mutation luôn đi thẳng mạng (UI tự xếp hàng offline)
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/_next/webpack-hmr') || url.pathname.includes('hot-reload')) return

  // Network-first với fallback cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          const cacheName = url.pathname.startsWith('/api/') ? API_CACHE : SHELL_CACHE
          caches.open(cacheName).then((cache) => cache.put(req, copy)).catch(() => undefined)
        }
        return res
      })
      .catch(async () => {
        const cache = await caches.open(url.pathname.startsWith('/api/') ? API_CACHE : SHELL_CACHE)
        const cached = await cache.match(req, { ignoreSearch: url.pathname.startsWith('/api/') })
        if (cached) return cached
        if (req.mode === 'navigate') {
          const shell = await caches.open(SHELL_CACHE)
          const shellRes = await shell.match('/')
          if (shellRes) return shellRes
        }
        return new Response(JSON.stringify({ error: 'Ngoại tuyến — không có dữ liệu cache' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      })
  )
})
