// ============================================================
// DOMAIN ROUTING & LOOPBACK DETECTION UTILITIES (Zero-DB Pure Module)
// Dùng chung cho Next.js Proxy (src/proxy.ts), API Routes, Daemon Security
// và Hệ thống Định tuyến Tên miền Riêng Độc lập cho từng CMS.
// ============================================================

const LOOPBACK_EXACT = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '0:0:0:0:0:0:0:1',
  'localhost',
])

/**
 * Chuẩn hóa địa chỉ IP hoặc Hostname (gỡ bỏ dấu ngoặc vuông IPv6 và cổng :port)
 * để kiểm tra chính xác kết nối Loopback nội bộ (tránh lỗi Next.js 16 base-server.js
 * tự gán `x-forwarded-for: 127.0.0.1` / `::ffff:127.0.0.1` cho socket nội bộ).
 */
export function isLoopbackIpOrHost(raw: string | null | undefined): boolean {
  if (!raw) return false
  let cleaned = raw.trim().toLowerCase()
  if (!cleaned) return false

  // Gỡ [::1]:3000 -> ::1
  if (cleaned.startsWith('[')) {
    const closeIdx = cleaned.indexOf(']')
    if (closeIdx > 1) {
      cleaned = cleaned.slice(1, closeIdx)
    }
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(cleaned) || /^localhost:\d+$/.test(cleaned)) {
    cleaned = cleaned.slice(0, cleaned.lastIndexOf(':'))
  }

  if (LOOPBACK_EXACT.has(cleaned)) return true
  if (cleaned.startsWith('127.')) return true
  if (cleaned.startsWith('::ffff:127.')) return true
  return false
}

/**
 * Trả về `true` CHỈ KHI request đi qua Reverse Proxy ngoài Internet (Render Edge, Cloudflare, Nginx...)
 * có chứa ít nhất một địa chỉ IP / Host không phải Loopback.
 * Trả về `false` đối với kết nối Loopback nội bộ (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`).
 */
export function hasNonLoopbackForwardedClient(
  headers: Pick<Headers, 'get'> | null | undefined
): boolean {
  if (!headers) return false

  const xff = headers.get('x-forwarded-for')?.trim()
  if (xff) {
    const hops = xff
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
    if (hops.some((hop) => !isLoopbackIpOrHost(hop))) {
      return true
    }
  }

  for (const ipHeader of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip']) {
    const val = headers.get(ipHeader)?.trim()
    if (val && !isLoopbackIpOrHost(val)) {
      return true
    }
  }

  const fwdHost = headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (fwdHost && !isLoopbackIpOrHost(fwdHost)) {
    return true
  }

  return false
}

/**
 * Chuẩn hóa tên miền cấu hình của từng CMS (bỏ http/https, đường dẫn, cổng, khoảng trắng, dấu chấm cuối).
 * VD: "https://www.BoMocDecor.vn/store/" -> "www.bomocdecor.vn"
 */
export function normalizeDomainHostname(
  rawInput: string | null | undefined,
  options?: { stripWww?: boolean }
): string {
  if (!rawInput) return ''
  let s = String(rawInput).trim().toLowerCase()
  if (!s || s.startsWith('/')) return ''
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const slashIdx = s.indexOf('/')
  if (slashIdx >= 0) s = s.slice(0, slashIdx)
  const qIdx = s.indexOf('?')
  if (qIdx >= 0) s = s.slice(0, qIdx)
  const hashIdx = s.indexOf('#')
  if (hashIdx >= 0) s = s.slice(0, hashIdx)
  if (!s.startsWith('[')) {
    const colonIdx = s.indexOf(':')
    if (colonIdx >= 0) s = s.slice(0, colonIdx)
  }
  s = s.replace(/\.+$/, '').trim()
  if (options?.stripWww && s.startsWith('www.') && s.length > 4) {
    s = s.slice(4)
  }
  // Chỉ chấp nhận ký tự tên miền chuẩn RFC (a-z, 0-9, -, .)
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s)) {
    return ''
  }
  return s
}

/**
 * Kiểm tra xem Host hiện tại của request có khớp với Tên miền Riêng (Custom Domain)
 * đã cấu hình cho Website Khách hàng của CMS này hay không (hỗ trợ cả bản có `www.` và không `www.`).
 */
export function matchesConfiguredStorefrontDomain(
  requestHostHeader: string | null | undefined,
  configuredDomains: Array<string | null | undefined>,
  excludedAdminHosts: Array<string | null | undefined> = []
): boolean {
  const reqApex = normalizeDomainHostname(requestHostHeader, { stripWww: true })
  const reqExact = normalizeDomainHostname(requestHostHeader, { stripWww: false })
  if (!reqExact || isLoopbackIpOrHost(reqExact)) return false
  if (reqExact.endsWith('.onrender.com') || reqExact.endsWith('.github.io')) return false

  for (const adminHost of excludedAdminHosts) {
    const cleanAdmin = normalizeDomainHostname(adminHost, { stripWww: false })
    if (cleanAdmin && (cleanAdmin === reqExact || cleanAdmin === reqApex)) {
      return false
    }
  }

  for (const candidate of configuredDomains) {
    const cleanCandApex = normalizeDomainHostname(candidate, { stripWww: true })
    const cleanCandExact = normalizeDomainHostname(candidate, { stripWww: false })
    if (!cleanCandExact) continue
    if (reqExact === cleanCandExact || reqApex === cleanCandApex) {
      return true
    }
  }

  return false
}
