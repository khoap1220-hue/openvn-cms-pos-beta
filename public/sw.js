// OPENVN · Ưu Đàm — PWA Service Worker v3.0 (Subpath-Safe + Native OS Notifications + Zero Stale Cache)
// Hỗ trợ đồng thời:
//   1. Máy chủ Node cục bộ (scope: "/")
//   2. GitHub Pages / Subpath CDN (scope: "/openvn-cms-pos-beta/")
// Tuyệt đối KHÔNG cache HTML động hoặc /api/* nhằm đảm bảo tồn kho thật CMS và đơn hàng luôn mới 100%.

const PWA_ASSETS_CACHE = 'openvn-pwa-assets-v3'

function resolveScopeUrl(relPath) {
  const scope = (self.registration && self.registration.scope) || self.location.origin + '/'
  const cleanScope = scope.endsWith('/') ? scope : scope + '/'
  if (!relPath || relPath === '/') return cleanScope
  if (/^https?:\/\//i.test(relPath)) return relPath
  const trimmed = String(relPath).replace(/^\/+/, '')
  // Nếu relPath đã bắt đầu bằng subpath của scope (ví dụ "openvn-cms-pos-beta/pos"), không ghép lặp
  try {
    const scopePathname = new URL(cleanScope).pathname.replace(/^\/+|\/+$/g, '')
    if (scopePathname && (trimmed === scopePathname || trimmed.startsWith(scopePathname + '/'))) {
      return new URL('/' + trimmed, cleanScope).toString()
    }
  } catch {
    // ignore URL parse fallback
  }
  return new URL(trimmed, cleanScope).toString()
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(PWA_ASSETS_CACHE)
      .then((cache) =>
        cache
          .addAll([
            resolveScopeUrl('manifest.webmanifest'),
            resolveScopeUrl('icons/icon-192.png'),
            resolveScopeUrl('icons/icon-512.png'),
            resolveScopeUrl('apple-touch-icon.png'),
          ])
          .catch(() => undefined)
      )
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== PWA_ASSETS_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (
    url.pathname.includes('/_next/webpack-hmr') ||
    url.pathname.includes('hot-reload') ||
    url.pathname.includes('/__beta') ||
    url.searchParams.has('EIO')
  ) {
    return
  }

  const isStaticIconOrManifest =
    url.pathname.endsWith('/manifest.webmanifest') ||
    url.pathname.endsWith('/apple-touch-icon.png') ||
    url.pathname.includes('/icons/icon-')

  if (isStaticIconOrManifest) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches
              .open(PWA_ASSETS_CACHE)
              .then((cache) => cache.put(req, copy))
              .catch(() => undefined)
          }
          return res
        })
        .catch(async () => {
          const cached = await caches.match(req)
          return cached || Response.error()
        })
    )
    return
  }

  // Điều hướng trang & dữ liệu API: Luôn ưu tiên mạng trực tiếp (không ghi đè cache gây lệch tồn kho/giao diện)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(
            '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OPENVN POS — Ngoại tuyến</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0F1E36;color:#F8FAFC;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:24px;text-align:center}.card{max-width:420px;background:#1E293B;border:1px solid #334155;border-radius:16px;padding:24px}button{margin-top:16px;background:#0066CC;color:#fff;border:0;border-radius:8px;padding:10px 18px;font-weight:600;cursor:pointer}</style></head><body><div class="card"><h2>Đang mất kết nối mạng</h2><p>OPENVN · Ưu Đàm sẽ tự động khôi phục phiên làm việc ngay khi thiết bị có mạng trở lại.</p><button onclick="location.reload()">Thử kết nối lại</button></div></body></html>',
            { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          )
      )
    )
  }
})

function buildNotificationOptions(payload) {
  const icon = resolveScopeUrl('icons/icon-192.png')
  const badge = resolveScopeUrl('icons/icon-192.png')
  const targetUrl = resolveScopeUrl((payload && payload.url) || '/')
  return {
    body: (payload && payload.body) || 'Có cập nhật vận hành mới trên OPENVN · Ưu Đàm.',
    icon,
    badge,
    tag: (payload && payload.tag) || 'openvn-event-' + Date.now(),
    renotify: Boolean(payload && payload.renotify !== false),
    requireInteraction: Boolean(payload && payload.urgent),
    vibrate: payload && payload.silent ? [] : [180, 70, 180],
    silent: Boolean(payload && payload.silent),
    data: {
      url: targetUrl,
      view: (payload && payload.view) || null,
      category: (payload && payload.category) || 'system',
    },
  }
}

self.addEventListener('push', (event) => {
  let payload = {
    title: 'OPENVN · Ưu Đàm',
    body: 'Có thông báo vận hành mới.',
    url: '/',
  }
  if (event.data) {
    try {
      const parsed = event.data.json()
      if (parsed && typeof parsed === 'object') {
        payload = { ...payload, ...parsed }
      }
    } catch {
      payload.body = event.data.text() || payload.body
    }
  }
  event.waitUntil(
    self.registration.showNotification(
      payload.title || 'OPENVN · Ưu Đàm',
      buildNotificationOptions(payload)
    )
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'OPENVN_SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (data.type === 'OPENVN_SHOW_NOTIFICATION' && data.payload) {
    const p = data.payload
    event.waitUntil(
      self.registration.showNotification(
        p.title || 'OPENVN · Ưu Đàm',
        buildNotificationOptions(p)
      )
    )
  }
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawTarget = (event.notification.data && event.notification.data.url) || resolveScopeUrl('/')
  const targetView = (event.notification.data && event.notification.data.view) || null

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        const scope = (self.registration && self.registration.scope) || self.location.origin + '/'
        for (const client of windowClients) {
          if (client.url && client.url.startsWith(scope) && 'focus' in client) {
            client.postMessage({
              type: 'OPENVN_NOTIFICATION_CLICK',
              url: rawTarget,
              view: targetView,
            })
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(rawTarget)
        }
        return undefined
      })
  )
})
