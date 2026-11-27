import { type NextFetchEvent, NextRequest, NextResponse } from 'next/server'
import {
  hasNonLoopbackForwardedClient,
  isLoopbackIpOrHost,
  matchesConfiguredStorefrontDomain,
  normalizeDomainHostname,
} from '@/lib/domain-routing'
import {
  getApiCacheRawJson,
  getMaintenanceMemoryState,
  resolveL1CacheKey,
} from '@/lib/realtime'
import {
  AUTH_LOCK_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  extractApiKeyFromHeaders,
  extractClientIp,
  parseDeviceFromUserAgent,
  signInternalAuditPayload,
  verifySessionToken,
} from '@/lib/auth'
import {
  type PermissionMap,
  ROLE_DEFINITIONS,
  type RoleKey,
  canAccessView,
  checkApiRequirement,
  isValidRole,
  resolveApiRoutePermission,
  resolveEffectivePermissions,
} from '@/lib/rbac'

const PUBLIC_PREFIXES = [
  '/login',
  '/store',
  '/blog',
  '/pos/scanner',
  '/api/public/',
  '/api/health',
  '/api/auth',
  '/api/webhooks/',
  '/api/barcode',
  '/api/peripherals',
  '/api/behavior-logs/internal',
  '/_next',
  '/thach-cao/',
  '/hot_1688/',
  '/reviews/',
  '/models/',
  '/data/',
  '/sw.js',
  '/logo.svg',
  '/robots.txt',
  '/favicon.ico',
]

const MAINTENANCE_EXEMPT_PREFIXES = [
  '/api/system/maintenance',
  '/api/system/backup',
  '/api/ledger/test-guard',
  '/api/auth',
  '/api/health',
  '/api/behavior-logs/internal',
]

const STATIC_PUBLIC_ASSET_RE =
  /\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest|txt|xml|woff2?)$/i

function isProxyCloudRenderRuntime(): boolean {
  const explicitRole = (process.env.SHOPEE_NODE_ROLE || '').trim().toUpperCase()
  if (explicitRole === 'CLOUD' || explicitRole === 'CLOUD_RENDER' || explicitRole === 'RENDER') {
    return true
  }
  return (
    process.env.RENDER === 'true' ||
    Boolean(process.env.RENDER_SERVICE_ID?.trim()) ||
    Boolean(process.env.RENDER_EXTERNAL_URL?.trim())
  )
}

function isTrustedShopeeCloudBridgeOrigin(originHeader: string | null): boolean {
  const origin = (originHeader || '').trim().replace(/\/+$/, '').toLowerCase()
  if (!origin) return false
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    return true
  }
  const configuredCloud = (
    process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    'https://openvn-cms-pos-backend.onrender.com'
  )
    .replace(/\/+$/, '')
    .toLowerCase()
  if (configuredCloud && origin === configuredCloud) {
    return true
  }
  return (
    origin === 'https://bomocdecor.vn' ||
    origin === 'https://www.bomocdecor.vn' ||
    origin === 'https://khoaphan.dev' ||
    origin === 'https://www.khoaphan.dev' ||
    origin === 'https://khoap1220-hue.github.io' ||
    origin === 'https://openvn-cms-pos-backend.onrender.com' ||
    origin === 'http://localhost:3010' ||
    origin === 'http://127.0.0.1:3010' ||
    origin === 'http://localhost:3000' ||
    origin === 'http://127.0.0.1:3000'
  )
}

function buildSanitizedRequestHeaders(req: NextRequest): Headers {
  const h = new Headers(req.headers)
  h.delete('x-cms-authenticated-caller')
  h.delete('x-unauthenticated-public-bridge')
  h.delete('x-staff-uid')
  h.delete('x-staff-usr')
  h.delete('x-staff-name')
  h.delete('x-staff-role')
  h.delete('x-staff-sid')
  return h
}

// Bộ đệm ngắn hạn (4 giây) kiểm tra trạng thái thu hồi phiên & quyền mới nhất từ SQLite
const sessionCache = new Map<
  string,
  {
    checkedAt: number
    valid: boolean
    revokedOrLocked: boolean
    authRequired: boolean
    role: RoleKey | null
    permissions: PermissionMap | null
  }
>()

function describeProxyMutation(methodInput: string, pathname: string): {
  module: string
  summary: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
} {
  const method = methodInput.toUpperCase()
  const verb = method === 'POST' ? 'Tạo / thực thi' : method === 'DELETE' ? 'Xóa / hủy' : 'Cập nhật'
  if (pathname.startsWith('/api/orders/bulk-confirm')) {
    return { module: 'orders', summary: 'Xác nhận hàng loạt đơn hàng', riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/orders')) {
    return {
      module: 'orders',
      summary: `${verb} đơn hàng (${method} ${pathname})`,
      riskLevel: method === 'DELETE' ? 'MEDIUM' : 'LOW',
    }
  }
  if (pathname.startsWith('/api/products')) {
    return {
      module: 'products',
      summary: `${verb} danh mục sản phẩm (${method} ${pathname})`,
      riskLevel: method === 'DELETE' ? 'HIGH' : 'LOW',
    }
  }
  if (pathname.startsWith('/api/inventory') || pathname.startsWith('/api/warehouses')) {
    return { module: 'inventory', summary: `${verb} tồn kho / kho hàng`, riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/sales-invoices')) {
    return {
      module: 'sales',
      summary: pathname.includes('/sign')
        ? 'Ký số Hóa đơn điện tử VAT'
        : `${verb} hóa đơn bán hàng (${method})`,
      riskLevel: 'MEDIUM',
    }
  }
  if (pathname.startsWith('/api/purchase-invoices')) {
    return { module: 'purchase', summary: `${verb} phiếu nhập hàng NCC`, riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/reports/baocao')) {
    return {
      module: 'reports',
      summary: `${verb} Sổ Vận hành Bơ Mộc (baocao · 13 Sheet)`,
      riskLevel: 'LOW',
    }
  }
  if (pathname.startsWith('/api/periods')) {
    return { module: 'accounting', summary: 'Chốt / Mở lại kỳ sổ sách kế toán quý', riskLevel: 'HIGH' }
  }
  if (pathname.startsWith('/api/customers')) {
    return { module: 'customers', summary: `${verb} hồ sơ khách hàng / hội viên`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/campaigns') || pathname.startsWith('/api/vouchers')) {
    return { module: 'campaigns', summary: `${verb} chiến dịch khuyến mãi / voucher`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/social')) {
    return { module: 'auto-social', summary: `${verb} bài đăng Auto Social`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/shipments') || pathname.startsWith('/api/aftersales')) {
    return { module: 'shipments', summary: `${verb} vận đơn / đối soát COD / đổi trả`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/settings') || pathname.startsWith('/api/integrations')) {
    return { module: 'system', summary: `${verb} cấu hình hệ thống / đối tác`, riskLevel: 'HIGH' }
  }
  if (pathname.startsWith('/api/system/reset')) {
    return { module: 'system', summary: 'Khởi tạo vận hành thực tế (Go-Live Reset)', riskLevel: 'HIGH' }
  }
  return {
    module: 'system',
    summary: `${verb} dữ liệu qua API (${method} ${pathname})`,
    riskLevel: method === 'DELETE' ? 'HIGH' : 'LOW',
  }
}

function buildInternalLoopbackUrl(req: NextRequest, apiPath: string): URL {
  const port = req.nextUrl.port || process.env.PORT || '3000'
  return new URL(apiPath, `http://127.0.0.1:${port}`)
}

function buildPublicRedirectUrl(req: NextRequest, targetPath: string): URL {
  const fwdProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const fwdHost =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim()
  if (fwdHost && (fwdProto || !fwdHost.startsWith('localhost'))) {
    const proto = fwdProto || (req.nextUrl.protocol === 'https:' ? 'https' : 'http')
    return new URL(targetPath, `${proto}://${fwdHost}`)
  }
  return new URL(targetPath, req.url)
}

async function emitInternalBehaviorLog(
  req: NextRequest,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const rawJson = JSON.stringify(payload)
    const sig = await signInternalAuditPayload(rawJson)
    const auditUrl = buildInternalLoopbackUrl(req, '/api/behavior-logs/internal')
    await fetch(auditUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-audit-sig': sig,
      },
      body: rawJson,
    })
  } catch {
    // Không chặn request chính nếu kênh audit nền bận
  }
}

function shouldAutoAuditApiMutation(pathname: string, method: string): boolean {
  const m = method.toUpperCase()
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(m)) return false
  // Bỏ qua các endpoint đã tự ghi BehaviorLog chi tiết hoặc bộ giả lập nền 30s
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/iam') ||
    pathname.startsWith('/api/behavior-logs') ||
    pathname.startsWith('/api/simulate') ||
    pathname.startsWith('/api/peripherals')
  ) {
    return false
  }
  return true
}

let proxyStorefrontDomainCache: {
  checkedAt: number
  domains: string[]
  routingMode: string
} | null = null

export function clearProxyStorefrontDomainCache(): void {
  proxyStorefrontDomainCache = null
}

async function shouldRewriteRootToCustomDomainStorefront(req: NextRequest): Promise<boolean> {
  if (req.nextUrl.searchParams.get('cms') === '1' || req.nextUrl.searchParams.has('view')) {
    return false
  }
  const rawHost =
    req.headers.get('x-storefront-domain')?.trim() ||
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    req.headers.get('host')?.trim() ||
    ''
  const normHost = normalizeDomainHostname(rawHost, { stripWww: false })
  if (!normHost || isLoopbackIpOrHost(normHost)) return false
  if (normHost.endsWith('.onrender.com') || normHost.endsWith('.github.io')) return false
  if (normHost === 'khoaphan.dev' || normHost === 'www.khoaphan.dev') return false

  const envDomains = (process.env.STOREFRONT_CUSTOM_DOMAINS || '')
    .split(/[,;\s]+/)
    .map((d) => normalizeDomainHostname(d, { stripWww: false }))
    .filter(Boolean)
  if (envDomains.length > 0 && matchesConfiguredStorefrontDomain(normHost, envDomains)) {
    return true
  }

  const now = Date.now()
  if (!proxyStorefrontDomainCache || now - proxyStorefrontDomainCache.checkedAt > 30_000) {
    try {
      const sfUrl = buildInternalLoopbackUrl(req, '/api/public/storefront')
      const sfRes = await fetch(sfUrl, { cache: 'no-store' })
      if (sfRes.ok) {
        const sfData = (await sfRes.json()) as {
          config?: {
            enabled?: boolean
            customDomain?: string
            additionalDomains?: string[]
            domainRoutingMode?: string
          }
        }
        const cfg = sfData.config
        const domains =
          cfg?.enabled === false
            ? []
            : [cfg?.customDomain || '', ...(cfg?.additionalDomains || [])].filter(Boolean)
        proxyStorefrontDomainCache = {
          checkedAt: now,
          domains,
          routingMode: cfg?.domainRoutingMode || 'STOREFRONT_ON_CUSTOM_DOMAIN',
        }
      }
    } catch {
      // Bỏ qua nếu đang khởi động máy chủ nội bộ
    }
  }

  if (
    proxyStorefrontDomainCache &&
    proxyStorefrontDomainCache.routingMode === 'STOREFRONT_ON_CUSTOM_DOMAIN'
  ) {
    return matchesConfiguredStorefrontDomain(normHost, proxyStorefrontDomainCache.domains, [
      'khoaphan.dev',
      'www.khoaphan.dev',
    ])
  }
  return false
}

export async function proxy(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl

  // Xóa ngay bộ đệm phiên khi có bất kỳ thay đổi nào về xác thực, phân quyền, khóa tài khoản hoặc thu hồi phiên
  if (
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    (pathname.startsWith('/api/auth') || pathname.startsWith('/api/iam'))
  ) {
    sessionCache.clear()
  }

  if (
    req.method !== 'GET' &&
    req.method !== 'HEAD' &&
    (pathname.startsWith('/api/storefront-config') ||
      pathname.startsWith('/api/settings') ||
      pathname.startsWith('/api/integrations'))
  ) {
    proxyStorefrontDomainCache = null
  }

  // Định tuyến Tên miền Riêng (Custom Domain) cho từng CMS độc lập:
  // Khách truy cập trang chủ `/` qua tên miền riêng (VD: bomocdecor.vn) sẽ xem ngay Website Khách hàng (/store)
  if (pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
    if (await shouldRewriteRootToCustomDomainStorefront(req)) {
      return NextResponse.rewrite(new URL('/store', req.url))
    }
  }

  // L1 Pre-Serialized Cache Fast-Path cho GET /api/auth (< 2ms)
  if (pathname === '/api/auth' && req.method === 'GET' && req.headers.get('x-session-check') !== '1') {
    const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value || '__anon__'
    const authKey = `auth:${sessionToken}:${req.nextUrl.searchParams.toString()}`
    const rawJson = getApiCacheRawJson(authKey)
    if (rawJson) {
      return new NextResponse(rawJson, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-CMS-Cache': 'L1-FASTPATH',
        },
      })
    }
  }

  // 1. Cho phép tài nguyên tĩnh, trang công khai (/blog, /login), Socket.IO (?EIO=*), CORS preflight cho Shopee Session Bridge và health probe GET /api
  if (
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    STATIC_PUBLIC_ASSET_RE.test(pathname) ||
    req.nextUrl.searchParams.has('EIO') ||
    (pathname === '/api' && req.method === 'GET') ||
    (pathname === '/api/channels/shopee-session' && req.method.toUpperCase() === 'OPTIONS')
  ) {
    return NextResponse.next()
  }

  // 1B. Cổng bảo vệ Chế độ Bảo trì Nâng cấp An toàn (Read-Only Drain Mode trên nhánh chính)
  const methodUpper = req.method.toUpperCase()
  if (
    pathname.startsWith('/api/') &&
    !['GET', 'HEAD', 'OPTIONS'].includes(methodUpper) &&
    !MAINTENANCE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    const maint = getMaintenanceMemoryState()
    if (maint.enabled) {
      const retrySec = String(maint.retryAfterSec || 120)
      return NextResponse.json(
        {
          ok: false,
          code: 'MAINTENANCE_READ_ONLY',
          error: maint.reason,
          retryAfterSec: maint.retryAfterSec || 120,
        },
        {
          status: 503,
          headers: {
            'Retry-After': retrySec,
            'X-CMS-Maintenance': 'read-only',
          },
        }
      )
    }
  }

  const ip = extractClientIp(req.headers)
  const ua = req.headers.get('user-agent') ?? ''
  const { deviceType } = parseDeviceFromUserAgent(ua)

  // 2. Xác thực tích hợp bên ngoài qua X-API-Key / Bearer omni_...
  if (pathname.startsWith('/api/')) {
    const apiKey = extractApiKeyFromHeaders(req.headers)
    if (apiKey) {
      try {
        const verifyUrl = buildInternalLoopbackUrl(req, '/api/auth')
        const verifyRes = await fetch(verifyUrl, {
          headers: { 'x-api-key': apiKey },
        })
        if (verifyRes.ok) {
          if (shouldAutoAuditApiMutation(pathname, req.method)) {
            const desc = describeProxyMutation(req.method, pathname)
            event.waitUntil(
              emitInternalBehaviorLog(req, {
                username: 'api_key',
                actorName: 'Tích hợp External API Key',
                actorRole: 'API_KEY',
                category: 'MUTATION',
                action: 'API_MUTATION',
                module: desc.module,
                method: req.method,
                path: pathname,
                summary: `[API Key] ${desc.summary}`,
                riskLevel: desc.riskLevel,
                status: 'SUCCESS',
                statusCode: 200,
                ipAddress: ip,
                deviceType: 'API',
                userAgent: ua,
              })
            )
          }
          const apiKeyHeaders = buildSanitizedRequestHeaders(req)
          apiKeyHeaders.set('x-cms-authenticated-caller', '1')
          return NextResponse.next({ request: { headers: apiKeyHeaders } })
        }
        return NextResponse.json(
          { error: 'API Key không hợp lệ hoặc đã bị thu hồi' },
          { status: 401 }
        )
      } catch {
        return NextResponse.json(
          { error: 'Không thể xác thực API Key' },
          { status: 500 }
        )
      }
    }
  }

  // 3. Kiểm tra Cookie phiên đăng nhập nhân sự
  const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const verified = await verifySessionToken(sessionToken)

  if (verified.valid && verified.claims) {
    const claims = verified.claims
    const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())
    const cached = sessionCache.get(claims.sid)
    const now = Date.now()

    let liveValid = true
    let liveRevoked = false
    let liveRole: RoleKey = isValidRole(claims.rol) ? claims.rol : 'CASHIER_POS'
    let livePermissions: PermissionMap = resolveEffectivePermissions(liveRole, claims.ovr)

    // Với thao tác ghi/xóa luôn đối chiếu trực tiếp DB; với GET cache 300 giây (tự xóa tức thì khi /api/auth hoặc /api/iam thay đổi) để đạt độ trễ < 1ms
    if (!cached || isMutating || now - cached.checkedAt > 300_000) {
      try {
        const checkUrl = buildInternalLoopbackUrl(req, '/api/auth')
        const checkRes = await fetch(checkUrl, {
          headers: {
            cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
            'x-session-check': '1',
          },
        })
        if (checkRes.ok) {
          const checkData = (await checkRes.json()) as {
            valid?: boolean
            revokedOrLocked?: boolean
            authRequired?: boolean
            role?: string | null
            permissions?: PermissionMap
          }
          liveValid = Boolean(checkData.valid)
          liveRevoked = Boolean(checkData.revokedOrLocked)
          if (isValidRole(checkData.role)) liveRole = checkData.role
          if (checkData.permissions) livePermissions = checkData.permissions
          sessionCache.set(claims.sid, {
            checkedAt: now,
            valid: liveValid,
            revokedOrLocked: liveRevoked,
            authRequired: Boolean(checkData.authRequired),
            role: liveRole,
            permissions: livePermissions,
          })
        }
      } catch {
        // Nếu gọi nội bộ lỗi tạm thời, tiếp tục dùng claims đã xác thực chữ ký HMAC
      }
    } else {
      liveValid = cached.valid
      liveRevoked = cached.revokedOrLocked
      if (cached.role) liveRole = cached.role
      if (cached.permissions) livePermissions = cached.permissions
    }

    // Phiên đã bị Admin thu hồi từ xa hoặc tài khoản vừa bị khóa
    if (!liveValid || liveRevoked) {
      sessionCache.delete(claims.sid)
      if (pathname.startsWith('/api/')) {
        const res = NextResponse.json(
          { error: 'Phiên đăng nhập đã bị thu hồi hoặc tài khoản đang tạm khóa.' },
          { status: 401 }
        )
        res.cookies.delete(SESSION_COOKIE_NAME)
        return res
      }
      const loginUrl = buildPublicRedirectUrl(req, '/login')
      loginUrl.searchParams.set('reason', 'revoked')
      const res = NextResponse.redirect(loginUrl)
      res.cookies.delete(SESSION_COOKIE_NAME)
      return res
    }

    // 3A. Kiểm tra quyền RBAC đối với trang Quầy POS độc lập (/pos)
    if (pathname === '/pos' && !canAccessView(livePermissions, 'pos')) {
      event.waitUntil(
        emitInternalBehaviorLog(req, {
          userId: claims.uid === 'admin' ? null : claims.uid,
          sessionId: claims.sid,
          username: claims.usr,
          actorName: claims.nam,
          actorRole: liveRole,
          category: 'SECURITY',
          action: 'PERMISSION_DENIED',
          module: 'pos',
          method: 'GET',
          path: pathname,
          summary: `Từ chối truy cập Quầy POS (${pathname}) đối với vai trò ${ROLE_DEFINITIONS[liveRole].shortLabel}`,
          riskLevel: 'MEDIUM',
          status: 'DENIED',
          statusCode: 403,
          ipAddress: ip,
          deviceType,
          userAgent: ua,
        })
      )
      const deniedUrl = buildPublicRedirectUrl(req, '/')
      deniedUrl.searchParams.set('denied', 'pos')
      return NextResponse.redirect(deniedUrl)
    }

    // 3B. Kiểm tra quyền RBAC đối với mọi API (/api/*)
    if (pathname.startsWith('/api/')) {
      const requirement = resolveApiRoutePermission(pathname, req.method)
      if (!checkApiRequirement(livePermissions, requirement)) {
        const roleLabel = ROLE_DEFINITIONS[liveRole].shortLabel
        event.waitUntil(
          emitInternalBehaviorLog(req, {
            userId: claims.uid === 'admin' ? null : claims.uid,
            sessionId: claims.sid,
            username: claims.usr,
            actorName: claims.nam,
            actorRole: liveRole,
            category: 'SECURITY',
            action: 'PERMISSION_DENIED',
            module: requirement?.module ?? 'system',
            method: req.method,
            path: pathname,
            summary: `Chặn 403 (${roleLabel}): Không đủ quyền "${requirement?.description ?? pathname}"`,
            metadata: {
              requiredAnyOf: requirement?.anyOf,
              method: req.method,
            },
            riskLevel: 'HIGH',
            status: 'DENIED',
            statusCode: 403,
            ipAddress: ip,
            deviceType,
            userAgent: ua,
          })
        )
        return NextResponse.json(
          {
            error: `Tài khoản vai trò "${roleLabel}" không có quyền thực hiện: ${requirement?.description ?? pathname}`,
            code: 'FORBIDDEN_RBAC',
          },
          { status: 403 }
        )
      }

      // Ghi nhận tự động mọi thao tác thay đổi dữ liệu hợp lệ (POST / PATCH / PUT / DELETE)
      if (shouldAutoAuditApiMutation(pathname, req.method)) {
        const desc = describeProxyMutation(req.method, pathname)
        event.waitUntil(
          emitInternalBehaviorLog(req, {
            userId: claims.uid === 'admin' ? null : claims.uid,
            sessionId: claims.sid,
            username: claims.usr,
            actorName: claims.nam,
            actorRole: liveRole,
            category: 'MUTATION',
            action: 'API_MUTATION',
            module: desc.module,
            method: req.method,
            path: pathname,
            summary: desc.summary,
            riskLevel: desc.riskLevel,
            status: 'SUCCESS',
            statusCode: 200,
            ipAddress: ip,
            deviceType,
            userAgent: ua,
          })
        )
      }
    }

    // L1 Pre-Serialized Cache Fast-Path (< 2ms): trả thẳng chuỗi JSON đã serialize từ RAM sau khi đã kiểm tra RBAC
    if (req.method === 'GET' && pathname.startsWith('/api/')) {
      const l1Key = resolveL1CacheKey(pathname, req.nextUrl.searchParams)
      if (l1Key) {
        const rawJson = getApiCacheRawJson(l1Key)
        if (rawJson) {
          return new NextResponse(rawJson, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-CMS-Cache': 'L1-FASTPATH',
            },
          })
        }
      }
    }

    // Truyền định danh nhân sự đã xác thực xuống Route Handlers & Sổ Data (logLedger)
    const reqHeaders = buildSanitizedRequestHeaders(req)
    reqHeaders.set('x-cms-authenticated-caller', '1')
    reqHeaders.set('x-staff-uid', claims.uid)
    reqHeaders.set('x-staff-usr', claims.usr)
    reqHeaders.set('x-staff-name', encodeURIComponent(claims.nam))
    reqHeaders.set('x-staff-role', liveRole)
    reqHeaders.set('x-staff-sid', claims.sid)

    return NextResponse.next({
      request: { headers: reqHeaders },
    })
  }

  // 4. Không có phiên đăng nhập — kiểm tra chính sách Bắt buộc đăng nhập
  const lockCookie = req.cookies.get(AUTH_LOCK_COOKIE_NAME)?.value
  let requireAuth =
    process.env.CMS_REQUIRE_AUTH === 'true' || lockCookie === 'true'

  if (!requireAuth && lockCookie !== 'false') {
    const cachedAnon = sessionCache.get('__policy__')
    const now = Date.now()
    if (!cachedAnon || now - cachedAnon.checkedAt > 300_000) {
      try {
        const checkUrl = buildInternalLoopbackUrl(req, '/api/auth')
        const checkRes = await fetch(checkUrl, {
          headers: { 'x-session-check': '1' },
        })
        if (checkRes.ok) {
          const d = (await checkRes.json()) as { authRequired?: boolean }
          requireAuth = Boolean(d.authRequired)
          sessionCache.set('__policy__', {
            checkedAt: now,
            valid: false,
            revokedOrLocked: false,
            authRequired: requireAuth,
            role: null,
            permissions: null,
          })
        }
      } catch {
        // Fallback an toàn
      }
    } else {
      requireAuth = cachedAnon.authRequired
    }
  }

  if (!requireAuth) {
    // L1 Pre-Serialized Cache Fast-Path (< 2ms) cho chế độ Mở Nội Bộ
    if (req.method === 'GET' && pathname.startsWith('/api/')) {
      const l1Key = resolveL1CacheKey(pathname, req.nextUrl.searchParams)
      if (l1Key) {
        const rawJson = getApiCacheRawJson(l1Key)
        if (rawJson) {
          return new NextResponse(rawJson, {
            status: 200,
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'X-CMS-Cache': 'L1-FASTPATH',
            },
          })
        }
      }
    }

    // Chế độ Mở Nội Bộ: vẫn ghi nhật ký hành vi cho các thao tác GHI/SỬA/XÓA qua API
    if (pathname.startsWith('/api/') && shouldAutoAuditApiMutation(pathname, req.method)) {
      const desc = describeProxyMutation(req.method, pathname)
      event.waitUntil(
        emitInternalBehaviorLog(req, {
          username: 'internal',
          actorName: 'Ca trực Nội bộ (Mở)',
          actorRole: 'ADMIN',
          category: 'MUTATION',
          action: 'API_MUTATION',
          module: desc.module,
          method: req.method,
          path: pathname,
          summary: desc.summary,
          riskLevel: desc.riskLevel,
          status: 'SUCCESS',
          statusCode: 200,
          ipAddress: ip,
          deviceType,
          userAgent: ua,
        })
      )
    }
    const openHeaders = buildSanitizedRequestHeaders(req)
    if (pathname === '/api/channels/shopee-session') {
      const originHdr = req.headers.get('origin')?.trim().replace(/\/+$/, '') || ''
      const reqHost = req.nextUrl.origin.replace(/\/+$/, '')
      const isCrossOrigin = Boolean(originHdr && originHdr.toLowerCase() !== reqHost.toLowerCase())
      if (
        isCrossOrigin &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase()) &&
        !isTrustedShopeeCloudBridgeOrigin(originHdr)
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: 'ORIGIN_FORBIDDEN',
            error: 'Nguồn gọi chéo tên miền (Origin) không nằm trong danh sách tin cậy.',
          },
          { status: 403 }
        )
      }
      if (
        isCrossOrigin ||
        isProxyCloudRenderRuntime() ||
        hasNonLoopbackForwardedClient(req.headers)
      ) {
        openHeaders.set('x-unauthenticated-public-bridge', '1')
      }
    }
    return NextResponse.next({ request: { headers: openHeaders } })
  }

  // Cho phép Trang Beta chính chủ (khoaphan.dev / github.io), Chrome Extension và GET telemetry đọc/đẩy phiên Shopee an toàn trên Cloud
  if (
    pathname === '/api/channels/shopee-session' &&
    (req.method.toUpperCase() === 'GET' ||
      isTrustedShopeeCloudBridgeOrigin(req.headers.get('origin')))
  ) {
    const bridgeHeaders = buildSanitizedRequestHeaders(req)
    bridgeHeaders.set('x-unauthenticated-public-bridge', '1')
    return NextResponse.next({ request: { headers: bridgeHeaders } })
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      {
        error:
          'Vui lòng đăng nhập tài khoản nhân sự hoặc cung cấp X-API-Key hợp lệ để tiếp tục.',
        code: 'UNAUTHORIZED',
      },
      { status: 401 }
    )
  }

  const loginUrl = buildPublicRedirectUrl(req, '/login')
  if (pathname && pathname !== '/' && pathname.startsWith('/')) {
    loginUrl.searchParams.set('next', pathname)
  }
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
