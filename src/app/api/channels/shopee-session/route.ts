import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, invalidateApiCache } from '@/lib/realtime'
import {
  maskSecretValue,
  parseShopeeCurlOrCookieInput,
  type MaskedCookiePreview,
} from '@/lib/shopee-curl-parser'
import {
  DEFAULT_SHOPEE_SHOP_BINDING,
  generateShopeeExtensionFiles,
} from '@/lib/shopee-extension-bundle'
import {
  hasNonLoopbackForwardedClient,
  isCloudRenderRuntime,
  isTrustedShopeeCloudBridgeOrigin,
  markVaultSessionExpiredInMeta,
  readDecryptedShopeeSessionFromVault,
  readShopeeSessionVaultMetadata,
  resolvePublicCloudBackendOrigin,
  saveEncryptedShopeeSessionToVault,
} from '@/lib/shopee-session-vault'

export const dynamic = 'force-dynamic'

const SESSION_WATCH_KEYS = [
  'SPC_ST',
  'SPC_SC_SESSION',
  'SPC_EC',
  'SPC_R_T_ID',
  'SPC_T_ID',
  'SPC_SI',
  'SPC_U',
  'SPC_CDS',
  'csrftoken',
] as const

function buildShopeeSessionCorsHeaders(req?: NextRequest): Record<string, string> {
  const rawOrigin = req?.headers.get('origin')?.trim().replace(/\/+$/, '') || ''
  const isAllowedOrigin = Boolean(rawOrigin) && isTrustedShopeeCloudBridgeOrigin(rawOrigin)

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-API-Key, X-Cloud-Sync-Passcode',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
  if (isAllowedOrigin) {
    headers['Access-Control-Allow-Origin'] = rawOrigin
  }
  return headers
}

interface SessionDiskMeta {
  cookieCount: number
  hasSpcSt: boolean
  hasSpcScSession: boolean
  hasSpcEc: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  updatedAt: string | null
  source: string | null
  rawCookies: Record<string, string>
  spcCds: string
  csrfToken: string
}

function resolveProjectRoot(
  fsMod: typeof import('node:fs'),
  pathMod: typeof import('node:path')
): string {
  const envRoot = process.env.OPENVN_PROJECT_ROOT?.trim()
  if (envRoot && fsMod.existsSync(/* turbopackIgnore: true */ envRoot)) {
    return envRoot
  }
  const cwd = process.cwd()
  if (
    fsMod.existsSync(
      /* turbopackIgnore: true */ pathMod.join(
        /* turbopackIgnore: true */ cwd,
        'scripts',
        'shopee_seller_sync.py'
      )
    )
  ) {
    return cwd
  }
  const twoUp = pathMod.resolve(/* turbopackIgnore: true */ cwd, '..', '..')
  if (
    fsMod.existsSync(
      /* turbopackIgnore: true */ pathMod.join(
        /* turbopackIgnore: true */ twoUp,
        'scripts',
        'shopee_seller_sync.py'
      )
    )
  ) {
    return twoUp
  }
  return cwd
}

function resolveShopeeSessionPath(
  fsMod: typeof import('node:fs'),
  pathMod: typeof import('node:path')
): string {
  const root = resolveProjectRoot(fsMod, pathMod)
  return pathMod.join(/* turbopackIgnore: true */ root, 'scripts', '.shopee_session.json')
}

async function readSessionDiskMetadata(): Promise<SessionDiskMeta> {
  const empty: SessionDiskMeta = {
    cookieCount: 0,
    hasSpcSt: false,
    hasSpcScSession: false,
    hasSpcEc: false,
    sessionKeysFound: [],
    maskedPreview: [],
    updatedAt: null,
    source: null,
    rawCookies: {},
    spcCds: '',
    csrfToken: '',
  }
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const sessionPath = resolveShopeeSessionPath(fs, path)
    if (!fs.existsSync(/* turbopackIgnore: true */ sessionPath)) {
      return empty
    }
    const raw = JSON.parse(
      fs.readFileSync(/* turbopackIgnore: true */ sessionPath, 'utf-8')
    ) as {
      cookies?: Record<string, string>
      spc_cds?: string
      csrf_token?: string
      updated_at?: string
      source?: string
    }
    const cookies = raw.cookies && typeof raw.cookies === 'object' ? raw.cookies : {}
    if (String(cookies['SPC_U'] || '') === '3813970' || cookies['SPC_ST'] === 'test_token') {
      return empty
    }
    const sessionKeysFound = SESSION_WATCH_KEYS.filter((k) => Boolean(cookies[k]))
    const maskedPreview: MaskedCookiePreview[] = sessionKeysFound.map((k) => ({
      key: k,
      maskedValue: maskSecretValue(String(cookies[k] || '')),
    }))
    return {
      cookieCount: Object.keys(cookies).length,
      hasSpcSt: Boolean(cookies['SPC_ST']),
      hasSpcScSession: Boolean(cookies['SPC_SC_SESSION']),
      hasSpcEc: Boolean(cookies['SPC_EC']),
      sessionKeysFound: [...sessionKeysFound],
      maskedPreview,
      updatedAt: raw.updated_at || null,
      source: raw.source || null,
      rawCookies: cookies,
      spcCds: raw.spc_cds || cookies['SPC_CDS'] || '',
      csrfToken: raw.csrf_token || cookies['csrftoken'] || '',
    }
  } catch {
    return empty
  }
}

async function resolveShopBindingAndPairingPreview(): Promise<{
  shopId: string
  username: string
  shopLabel: string
  pairingKeyPreview: string
}> {
  let shopId: string = DEFAULT_SHOPEE_SHOP_BINDING.shopId
  let username: string = DEFAULT_SHOPEE_SHOP_BINDING.username
  const shopLabel: string = DEFAULT_SHOPEE_SHOP_BINDING.shopLabel

  try {
    const shopeeCred = await db.integrationCredential.findUnique({
      where: { provider: 'SHOPEE' },
    })
    if (shopeeCred?.config) {
      const cfg = JSON.parse(shopeeCred.config) as {
        shopId?: string | number
        username?: string
      }
      if (cfg.shopId) shopId = String(cfg.shopId)
      if (cfg.username) username = String(cfg.username)
    }
  } catch {
    // Giữ thông số liên kết chuẩn mặc định
  }

  let pairingKeyPreview = 'Zero-Secret AES-256-GCM'
  try {
    const activeKey = await db.apiKey.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    })
    if (activeKey?.secret) {
      pairingKeyPreview = maskSecretValue(activeKey.secret)
    }
  } catch {
    // Bỏ qua nếu chưa có khóa
  }

  return { shopId, username, shopLabel, pairingKeyPreview }
}

async function extractRawCookiesFromLocalCdp(
  fsMod: typeof import('node:fs'),
  pathMod: typeof import('node:path'),
  cdpPort = 9222
): Promise<{
  ok?: boolean
  cdpReachable?: boolean
  cookies?: Record<string, string>
  spc_cds?: string
  csrf_token?: string
  error?: string
}> {
  const { execFileSync } = await import('node:child_process')
  const root = resolveProjectRoot(fsMod, pathMod)
  const scriptPath = pathMod.join(
    /* turbopackIgnore: true */ root,
    'scripts',
    'extract_shopee_cdp.py'
  )
  try {
    const stdout = execFileSync(
      'python',
      ['-B', scriptPath, `--port=${cdpPort}`, '--json', '--no-write'],
      {
        cwd: root,
        encoding: 'utf-8',
        timeout: 8000,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      }
    )
    return JSON.parse(stdout.trim() || '{}')
  } catch (err) {
    const stdoutStr =
      err && typeof err === 'object' && 'stdout' in err
        ? String((err as { stdout?: unknown }).stdout || '').trim()
        : ''
    if (stdoutStr.startsWith('{')) {
      try {
        return JSON.parse(stdoutStr)
      } catch {
        // ignore
      }
    }
    return { ok: false, cdpReachable: false }
  }
}

function persistVerifiedSessionToDisk(
  fsMod: typeof import('node:fs'),
  pathMod: typeof import('node:path'),
  cookies: Record<string, string>,
  spcCds: string,
  csrfToken: string,
  source: string
): void {
  try {
    const sessionPath = resolveShopeeSessionPath(fsMod, pathMod)
    const effCds = spcCds || cookies['SPC_CDS'] || 'c2344aba-5428-425d-bba9-04838a499109'
    const effCsrf = csrfToken || cookies['csrftoken'] || '0BQKllKGsakrP1WMZnz4ZKeXdP3neixB'
    fsMod.writeFileSync(
      /* turbopackIgnore: true */ sessionPath,
      JSON.stringify(
        {
          cookies,
          spc_cds: effCds,
          csrf_token: effCsrf,
          updated_at: new Date().toISOString(),
          source,
        },
        null,
        2
      ),
      'utf-8'
    )
  } catch {
    // Không chặn nếu filesystem trên môi trường Cloud chỉ đọc
  }
}

async function probeCdpPortOnline(cdpPort = 9222): Promise<boolean> {
  if (isCloudRenderRuntime()) return false
  try {
    const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
      method: 'GET',
      signal: AbortSignal.timeout(800),
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}

async function fetchDaemonStatus(bridgePort: string) {
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/shopee/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      alive?: boolean
      paused?: boolean
      nodeRole?: string
      standbyYieldedToLocal?: boolean
      shopId?: string
      username?: string
      cookieCount?: number
      hasSpcSt?: boolean
      hasSpcScSession?: boolean
      lastSync?: string | number | null
      asyncQueue?: {
        trackedProducts?: number
        dlqCount?: number
      }
    }
    if (!data.ok) return null
    return data
  } catch {
    return null
  }
}

function mergeSetCookieHeadersIntoJar(
  cookies: Record<string, string>,
  resHeaders: Headers
): boolean {
  const rawSetCookies =
    typeof (resHeaders as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (resHeaders as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : []
  let rotated = false
  for (const sc of rawSetCookies) {
    const low = sc.toLowerCase()
    if (low.includes('max-age=0') || low.includes('max-age=-')) continue
    const firstPart = sc.split(';')[0] || ''
    const eqIdx = firstPart.indexOf('=')
    if (eqIdx <= 0) continue
    const k = firstPart.slice(0, eqIdx).trim()
    const v = firstPart.slice(eqIdx + 1).trim()
    if (!k || !v || v === '""' || v === "''" || v.toLowerCase() === 'deleted') continue
    if (cookies[k] !== v) {
      cookies[k] = v
      rotated = true
    }
  }
  return rotated
}

async function verifyDirectlyWithShopee(
  inputCookies: Record<string, string>,
  spcCds: string,
  csrfToken: string
): Promise<{
  alive: boolean
  shopId: string | null
  username: string | null
  cookies: Record<string, string>
  rotated: boolean
}> {
  const cookies = { ...inputCookies }
  const effCds = spcCds || cookies['SPC_CDS'] || 'c2344aba-5428-425d-bba9-04838a499109'
  const effCsrf = csrfToken || cookies['csrftoken'] || '0BQKllKGsakrP1WMZnz4ZKeXdP3neixB'

  const attemptLoginCheck = async (): Promise<{
    alive: boolean
    shopId: string | null
    username: string | null
    rotated: boolean
  }> => {
    const cookieHeader = Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
    const url = `https://banhang.shopee.vn/api/v2/login/?SPC_CDS=${encodeURIComponent(cookies['SPC_CDS'] || effCds)}&SPC_CDS_VER=2`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://banhang.shopee.vn/portal/sale/order',
        'X-CSRFToken': cookies['csrftoken'] || effCsrf,
      },
      signal: AbortSignal.timeout(8000),
    })
    const rotated = mergeSetCookieHeadersIntoJar(cookies, res.headers)
    if (!res.ok) return { alive: false, shopId: null, username: null, rotated }
    const data = (await res.json().catch(() => ({}))) as {
      shopid?: number | string
      username?: string
    }
    if (data && data.shopid) {
      return {
        alive: true,
        shopId: String(data.shopid),
        username: data.username ? String(data.username) : null,
        rotated,
      }
    }
    return { alive: false, shopId: null, username: null, rotated }
  }

  try {
    const first = await attemptLoginCheck()
    if (first.alive) {
      return { ...first, cookies }
    }

    // Nếu SPC_SC_SESSION hết hạn nhưng SPC_EC / SPC_ST còn hạn, thử làm mới phiên phụ Seller Center
    if (cookies['SPC_EC'] || cookies['SPC_ST']) {
      const cookieHeader = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const subUrl = `https://banhang.shopee.vn/api/selleraccount/login/?SPC_CDS=${encodeURIComponent(cookies['SPC_CDS'] || effCds)}&SPC_CDS_VER=2`
      const subRes = await fetch(subUrl, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Cookie: cookieHeader,
          Accept: 'application/json, text/html, */*',
          Referer: 'https://banhang.shopee.vn/',
          'X-CSRFToken': cookies['csrftoken'] || effCsrf,
        },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null)
      if (subRes && mergeSetCookieHeadersIntoJar(cookies, subRes.headers)) {
        const second = await attemptLoginCheck()
        if (second.alive) {
          return { ...second, cookies, rotated: true }
        }
      }
    }
    return { alive: false, shopId: null, username: null, cookies, rotated: first.rotated }
  } catch {
    return { alive: false, shopId: null, username: null, cookies, rotated: false }
  }
}

async function buildCombinedStatusPayload(overrideLive?: {
  alive: boolean
  shopId?: string | null
  username?: string | null
}) {
  const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'
  const cloudBackendOrigin = resolvePublicCloudBackendOrigin()
  const [daemon, diskMeta, vaultMeta, binding, cdpOnline] = await Promise.all([
    fetchDaemonStatus(bridgePort),
    readSessionDiskMetadata(),
    readShopeeSessionVaultMetadata(),
    resolveShopBindingAndPairingPreview(),
    probeCdpPortOnline(9222),
  ])

  const daemonOnline = Boolean(daemon)
  const standbyYieldedToLocal = Boolean(daemon?.standbyYieldedToLocal)
  const resolvedAlive =
    overrideLive !== undefined
      ? overrideLive.alive
      : Boolean(daemon?.alive) ||
        Boolean(standbyYieldedToLocal && vaultMeta.hasEncryptedSession && vaultMeta.verifiedLive) ||
        Boolean(!daemonOnline && vaultMeta.hasEncryptedSession && vaultMeta.verifiedLive)

  const diskUpdatedMs = diskMeta.updatedAt ? Date.parse(diskMeta.updatedAt) || 0 : 0
  const preferVaultMeta =
    vaultMeta.hasEncryptedSession &&
    (diskMeta.cookieCount === 0 || vaultMeta.updatedAtMs >= diskUpdatedMs)

  const effectiveCookieCount =
    daemon?.cookieCount ||
    (preferVaultMeta ? vaultMeta.cookieCount : diskMeta.cookieCount) ||
    vaultMeta.cookieCount ||
    diskMeta.cookieCount

  const rawLastSync = daemon?.lastSync
  const formattedLastSync =
    typeof rawLastSync === 'number' && rawLastSync > 0
      ? new Date(rawLastSync * 1000).toISOString()
      : typeof rawLastSync === 'string'
        ? rawLastSync
        : null

  return {
    ok: true,
    daemonOnline,
    cdpOnline,
    nodeRole: isCloudRenderRuntime() ? ('CLOUD_RENDER' as const) : ('LOCAL_VN' as const),
    authMode: 'PERSISTENT_BROWSER_SESSION_NO_PARTNER_KEY' as const,
    alive: resolvedAlive,
    paused: Boolean(daemon?.paused),
    shopId:
      overrideLive?.shopId ||
      daemon?.shopId ||
      (preferVaultMeta ? vaultMeta.shopId : null) ||
      binding.shopId,
    username:
      overrideLive?.username ||
      daemon?.username ||
      (preferVaultMeta ? vaultMeta.username : null) ||
      binding.username,
    cookieCount: effectiveCookieCount,
    hasSpcSt: Boolean(
      daemon?.hasSpcSt ?? (preferVaultMeta ? vaultMeta.hasSpcSt : diskMeta.hasSpcSt)
    ),
    hasSpcScSession: Boolean(
      daemon?.hasSpcScSession ??
        (preferVaultMeta ? vaultMeta.hasSpcScSession : diskMeta.hasSpcScSession)
    ),
    hasSpcEc: preferVaultMeta ? vaultMeta.hasSpcEc : diskMeta.hasSpcEc,
    sessionKeysFound: preferVaultMeta ? vaultMeta.sessionKeysFound : diskMeta.sessionKeysFound,
    maskedPreview: preferVaultMeta ? vaultMeta.maskedPreview : diskMeta.maskedPreview,
    updatedAt: preferVaultMeta ? vaultMeta.updatedAt : diskMeta.updatedAt,
    source: preferVaultMeta ? vaultMeta.source : diskMeta.source,
    lastSync: formattedLastSync,
    trackedProducts: daemon?.asyncQueue?.trackedProducts ?? 0,
    dlqCount: daemon?.asyncQueue?.dlqCount ?? 0,
    cloudVault: {
      enabled: true,
      cipher: 'AES-256-GCM' as const,
      provider: 'SUPABASE_POSTGRESQL' as const,
      region: 'singapore' as const,
      cloudBackendOrigin,
      hasEncryptedSession: vaultMeta.hasEncryptedSession,
      verifiedLive: vaultMeta.verifiedLive,
      cookieCount: vaultMeta.cookieCount,
      updatedAt: vaultMeta.updatedAt,
      updatedByRole: vaultMeta.updatedByRole,
      source: vaultMeta.source,
      version: vaultMeta.version,
      standbyYieldedToLocal,
      leaderLease: vaultMeta.leaderLease,
    },
    extensionInfo: {
      shopId: binding.shopId,
      username: binding.username,
      shopLabel: binding.shopLabel,
      bridgePort: Number(bridgePort),
      cdpPort: 9222,
      cloudOrigin: cloudBackendOrigin,
      downloadUrl: '/api/channels/shopee-extension',
      unpackedDir: 'extensions/shopee-sync-extension',
      launcherScript: 'launch-chrome-shopee.bat',
      pairingKeyPreview: binding.pairingKeyPreview,
    },
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildShopeeSessionCorsHeaders(req),
  })
}

export async function GET(req?: NextRequest) {
  const payload = await buildCombinedStatusPayload()
  return NextResponse.json(payload, {
    headers: buildShopeeSessionCorsHeaders(req),
  })
}

export async function POST(req: NextRequest) {
  const corsHeaders = buildShopeeSessionCorsHeaders(req)
  try {
    const rawOrigin = req.headers.get('origin')?.trim().replace(/\/+$/, '') || ''
    const reqOrigin = req.nextUrl.origin.replace(/\/+$/, '')
    const isCrossOrigin = Boolean(rawOrigin && rawOrigin.toLowerCase() !== reqOrigin.toLowerCase())
    if (isCrossOrigin && !isTrustedShopeeCloudBridgeOrigin(rawOrigin)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'ORIGIN_FORBIDDEN',
          error: 'Nguồn gọi chéo tên miền (Origin) không nằm trong danh sách được phép.',
        },
        { status: 403, headers: corsHeaders }
      )
    }

    const hasForwardedFor = hasNonLoopbackForwardedClient(req.headers)
    const isAuthenticatedCmsCaller = req.headers.get('x-cms-authenticated-caller') === '1'
    const isRemoteOrCloudRequest = isCloudRenderRuntime() || hasForwardedFor
    const requiredPasscode = process.env.SHOPEE_CLOUD_SYNC_PASSCODE?.trim()
    const isPublicBridgeCaller =
      req.headers.get('x-unauthenticated-public-bridge') === '1' ||
      (!isAuthenticatedCmsCaller &&
        (isRemoteOrCloudRequest || isCrossOrigin || Boolean(requiredPasscode)))

    const body = (await req.json().catch(() => ({}))) as {
      action?:
        | 'CHECK_SESSION'
        | 'IMPORT_CURL'
        | 'LAUNCH_ONE_TIME_BROWSER'
        | 'SYNC_FROM_CDP'
      rawInput?: string
      enforceShopLock?: boolean
    }

    if (
      (isRemoteOrCloudRequest || isPublicBridgeCaller) &&
      (body.action === 'LAUNCH_ONE_TIME_BROWSER' || body.action === 'SYNC_FROM_CDP')
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: 'LOCAL_ACTION_ONLY',
          error:
            'Thao tác mở trình duyệt / hút cổng CDP :9222 chỉ chạy trên máy Windows cục bộ, không chạy từ xa qua Cloud.',
        },
        { status: 403, headers: corsHeaders }
      )
    }

    if (isPublicBridgeCaller && requiredPasscode) {
      const providedPasscode = req.headers.get('x-cloud-sync-passcode')?.trim() || ''
      if (providedPasscode !== requiredPasscode) {
        return NextResponse.json(
          {
            ok: false,
            code: 'CLOUD_PASSCODE_REQUIRED',
            error: 'Thiếu hoặc sai mã khóa đồng bộ Cloud (SHOPEE_CLOUD_SYNC_PASSCODE).',
          },
          { status: 401, headers: corsHeaders }
        )
      }
    }

    const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'

    // ===== 1. MỞ TRÌNH DUYỆT HỒ SƠ BỀN VỮNG (ĐĂNG NHẬP 1 LẦN - KHÔNG CẦN PARTNER ID) =====
    if (body.action === 'LAUNCH_ONE_TIME_BROWSER') {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const { spawn } = await import('node:child_process')
      const root = resolveProjectRoot(fs, path)
      const batPath = path.join(/* turbopackIgnore: true */ root, 'launch-chrome-shopee.bat')

      if (process.platform !== 'win32' || !fs.existsSync(/* turbopackIgnore: true */ batPath)) {
        return NextResponse.json(
          {
            ok: false,
            code: 'LAUNCHER_UNAVAILABLE',
            error:
              'Tính năng mở nhanh Trình duyệt Hồ sơ Bền vững chỉ khả dụng khi chạy OPENVN CMS trực tiếp trên máy Windows cục bộ.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      // Tạo bản sao Extension cục bộ ngoài Git (%LOCALAPPDATA%\OPENVN\ShopeeSellerExtension-197195817)
      // tích hợp sẵn đồng bộ kép Local + Cloud Render Singapore (Zero-Secret Leak)
      try {
        const localAppData = process.env.LOCALAPPDATA?.trim()
        if (localAppData) {
          const binding = await resolveShopBindingAndPairingPreview()
          const stagedExtDir = path.join(
            /* turbopackIgnore: true */ localAppData,
            'OPENVN',
            `ShopeeSellerExtension-${binding.shopId || '197195817'}`
          )
          fs.mkdirSync(/* turbopackIgnore: true */ stagedExtDir, { recursive: true })
          const cmsOrigin = req.nextUrl.origin.replace('0.0.0.0', '127.0.0.1')
          const extFiles = generateShopeeExtensionFiles({
            shopId: binding.shopId,
            username: binding.username,
            shopLabel: binding.shopLabel,
            cmsOrigin,
            cloudOrigin: resolvePublicCloudBackendOrigin(),
            syncToCloud: true,
            bridgePort: Number(bridgePort),
            pairingToken: '',
            enforceShopLock: true,
            generatedAt: new Date().toISOString(),
          })
          for (const entry of extFiles) {
            const targetFile = path.join(/* turbopackIgnore: true */ stagedExtDir, entry.name)
            fs.mkdirSync(/* turbopackIgnore: true */ path.dirname(targetFile), { recursive: true })
            if (typeof entry.content === 'string') {
              fs.writeFileSync(/* turbopackIgnore: true */ targetFile, entry.content, 'utf-8')
            } else {
              fs.writeFileSync(/* turbopackIgnore: true */ targetFile, Buffer.from(entry.content))
            }
          }
        }
      } catch {
        // Fallback an toàn về extensions/shopee-sync-extension + cổng CDP :9222
      }

      const child = spawn('cmd.exe', ['/c', batPath, '--silent'], {
        cwd: root,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      })
      child.unref()

      await new Promise((r) => setTimeout(r, 900))
      const refreshed = await buildCombinedStatusPayload()
      return NextResponse.json(
        {
          ...refreshed,
          launched: true,
          message:
            'Đã mở Trình duyệt Hồ sơ Bền vững Shopee (kết nối tự động qua cổng CDP 9222 & đồng bộ lên Cloud 24/7). Bạn chỉ cần đăng nhập 1 lần duy nhất!',
        },
        { headers: corsHeaders }
      )
    }

    // ===== 2. HÚT PHIÊN TỰ ĐỘNG TỪ TRÌNH DUYỆT ĐĂNG NHẬP 1 LẦN (CDP :9222) =====
    if (body.action === 'SYNC_FROM_CDP') {
      const binding = await resolveShopBindingAndPairingPreview()
      const enforceShopLock = body.enforceShopLock !== false
      const expectedShopId = enforceShopLock ? binding.shopId : ''

      // 2A. Nếu Python Daemon đang bật, ưu tiên gọi thẳng /shopee/sync-cdp
      try {
        const cdpRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/sync-cdp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedShopId }),
          signal: AbortSignal.timeout(8000),
        })
        const cdpJson = (await cdpRes.json().catch(() => ({}))) as {
          ok?: boolean
          alive?: boolean
          code?: string
          shopId?: string
          username?: string
          cookieCount?: number
          error?: string
        }
        if (cdpRes.status === 409 || cdpJson.code === 'SHOP_MISMATCH') {
          return NextResponse.json(
            {
              ok: false,
              code: 'SHOP_MISMATCH',
              shopId: cdpJson.shopId,
              username: cdpJson.username,
              expectedShopId,
              error:
                cdpJson.error ||
                `Tài khoản đang đăng nhập trên trình duyệt (${cdpJson.username || '?'} · #${cdpJson.shopId}) không khớp với shop liên kết (#${expectedShopId}).`,
            },
            { status: 409, headers: corsHeaders }
          )
        }
        if (cdpRes.ok && cdpJson.ok && cdpJson.alive) {
          // Đồng bộ luôn từ đĩa vừa được Daemon ghi lên Kho Phiên Mã Hóa Supabase
          const diskAfterCdp = await readSessionDiskMetadata()
          if (diskAfterCdp.cookieCount > 0) {
            await saveEncryptedShopeeSessionToVault({
              cookies: diskAfterCdp.rawCookies,
              spcCds: diskAfterCdp.spcCds,
              csrfToken: diskAfterCdp.csrfToken,
              shopId: cdpJson.shopId || binding.shopId,
              username: cdpJson.username || binding.username,
              source: 'CHROME_CDP_ONE_TIME_LOGIN',
              updatedByRole: 'LOCAL_VN',
              verifiedLive: true,
            }).catch(() => null)
          }

          const refreshed = await buildCombinedStatusPayload({
            alive: true,
            shopId: cdpJson.shopId,
            username: cdpJson.username,
          })
          return NextResponse.json(
            {
              ...refreshed,
              imported: true,
              verifiedLive: true,
              message: `Đã hút tự động ${cdpJson.cookieCount || refreshed.cookieCount} Cookie từ Trình duyệt Đăng nhập 1 lần & lưu lên Kho Phiên Mã Hóa Cloud cho shop ${refreshed.username} (#${refreshed.shopId})!`,
            },
            { headers: corsHeaders }
          )
        }
      } catch {
        // Daemon chưa chạy -> bóc tách trực tiếp qua scripts/extract_shopee_cdp.py --json --no-write bên dưới
      }

      // 2B. Bóc tách trực tiếp qua Python extractor CLI (--json --no-write) khi Daemon ngoại tuyến
      const fs = await import('node:fs')
      const path = await import('node:path')
      const extracted = await extractRawCookiesFromLocalCdp(fs, path, 9222)

      if (!extracted.ok || !extracted.cookies) {
        return NextResponse.json(
          {
            ok: false,
            code: extracted.cdpReachable ? 'CDP_NOT_LOGGED_IN' : 'CDP_OFFLINE',
            error:
              extracted.error ||
              'Chưa kết nối được Trình duyệt Đăng nhập 1 lần (cổng 9222). Hãy bấm «Mở Trình duyệt Đăng nhập 1 lần» và đăng nhập banhang.shopee.vn.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      const directCheck = await verifyDirectlyWithShopee(
        extracted.cookies,
        extracted.spc_cds || '',
        extracted.csrf_token || ''
      )
      if (!directCheck.alive) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SESSION_EXPIRED_OR_INVALID',
            error:
              'Trình duyệt đang mở nhưng phiên trên banhang.shopee.vn đã hết hạn. Hãy tải lại tab banhang.shopee.vn và đăng nhập lại 1 lần.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      if (expectedShopId && directCheck.shopId && directCheck.shopId !== expectedShopId) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SHOP_MISMATCH',
            shopId: directCheck.shopId,
            username: directCheck.username,
            expectedShopId,
            error: `Tài khoản Shopee (${directCheck.username || '?'} · #${directCheck.shopId}) không khớp với shop liên kết (#${expectedShopId}).`,
          },
          { status: 409, headers: corsHeaders }
        )
      }

      persistVerifiedSessionToDisk(
        fs,
        path,
        directCheck.cookies,
        extracted.spc_cds || '',
        extracted.csrf_token || '',
        'CHROME_CDP_ONE_TIME_LOGIN'
      )

      await saveEncryptedShopeeSessionToVault({
        cookies: directCheck.cookies,
        spcCds: extracted.spc_cds || '',
        csrfToken: extracted.csrf_token || '',
        shopId: directCheck.shopId || binding.shopId,
        username: directCheck.username || binding.username,
        source: 'CHROME_CDP_ONE_TIME_LOGIN',
        updatedByRole: 'LOCAL_VN',
        verifiedLive: true,
      })

      const requeuedRes = await db.ledgerEntry.updateMany({
        where: {
          scope: 'CHANNEL',
          action: { in: ['OUTBOX_DEAD_LETTER', 'OUTBOX_DEFERRED'] },
        },
        data: { action: 'OUTBOX_PENDING' },
      })

      await logLedger({
        scope: 'CHANNEL',
        action: 'SHOPEE_COOKIE_IMPORTED',
        entityType: 'Channel',
        entityCode: 'SHOPEE',
        title: `Shopee (${directCheck.username || binding.username}): Đồng bộ phiên tự động từ Trình duyệt Đăng nhập 1 lần lên Kho Phiên Cloud (${Object.keys(directCheck.cookies).length} cookies)`,
        detail: {
          source: 'CHROME_CDP_ONE_TIME_LOGIN',
          cookieCount: Object.keys(directCheck.cookies).length,
          shopId: directCheck.shopId || binding.shopId,
          username: directCheck.username || binding.username,
          verifiedLive: true,
          vaultEncrypted: 'AES-256-GCM',
          requeuedOutboxCount: requeuedRes.count,
        },
        actor: 'OPERATOR',
        originSource: 'MANUAL_ADMIN',
      })

      invalidateApiCache('channels:product-links')
      broadcast('channel.session_restored', {
        key: 'SHOPEE',
        shopId: directCheck.shopId || binding.shopId,
        username: directCheck.username || binding.username,
        requeuedCount: requeuedRes.count,
      })

      const refreshed = await buildCombinedStatusPayload({
        alive: true,
        shopId: directCheck.shopId || binding.shopId,
        username: directCheck.username || binding.username,
      })
      return NextResponse.json(
        {
          ...refreshed,
          imported: true,
          verifiedLive: true,
          requeuedOutboxCount: requeuedRes.count,
          message: `Đã đồng bộ phiên Live & lưu Kho Phiên Mã Hóa Cloud 24/7 cho shop ${refreshed.username} (#${refreshed.shopId})!`,
        },
        { headers: corsHeaders }
      )
    }

    // ===== 3. KIỂM TRA PHIÊN TRỰC TUYẾN (HỖ TRỢ DAEMON + SUPABASE VAULT + AUTO-CDP) =====
    if (body.action === 'CHECK_SESSION') {
      const [daemonPre, vaultMetaPre] = await Promise.all([
        fetchDaemonStatus(bridgePort),
        readShopeeSessionVaultMetadata(),
      ])

      // Nếu đang trên Cloud Render mà Máy bán hàng VN (LOCAL_VN) đang giữ khóa Leader Lease hợp lệ kèm phiên Live:
      // tôn trọng khóa chống xung đột IP, trả về telemetry Live từ Vault mà không bắn request song song từ Singapore!
      if (
        (daemonPre?.standbyYieldedToLocal ||
          (isCloudRenderRuntime() &&
            vaultMetaPre.leaderLease.active &&
            vaultMetaPre.leaderLease.holderRole === 'LOCAL_VN')) &&
        vaultMetaPre.hasEncryptedSession &&
        vaultMetaPre.verifiedLive
      ) {
        const standbyLivePayload = await buildCombinedStatusPayload({
          alive: true,
          shopId: vaultMetaPre.shopId,
          username: vaultMetaPre.username,
        })
        return NextResponse.json(standbyLivePayload, { headers: corsHeaders })
      }

      let checkedViaDaemon = false
      if (daemonPre && !daemonPre.standbyYieldedToLocal) {
        try {
          const dRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/check-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: AbortSignal.timeout(8000),
          })
          if (dRes.ok) {
            const dJson = (await dRes.json().catch(() => ({}))) as { alive?: boolean }
            checkedViaDaemon = Boolean(dJson.alive)
          }
        } catch {
          checkedViaDaemon = false
        }
      }

      if (!checkedViaDaemon) {
        const [diskMeta, vaultSession, binding] = await Promise.all([
          readSessionDiskMetadata(),
          readDecryptedShopeeSessionFromVault(),
          resolveShopBindingAndPairingPreview(),
        ])

        // Ưu tiên kiểm tra phiên trong Kho Mã Hóa Supabase (hoặc trên đĩa cục bộ)
        const candidates = [
          vaultSession
            ? {
                cookies: vaultSession.cookies,
                spcCds: vaultSession.spcCds,
                csrfToken: vaultSession.csrfToken,
                source: vaultSession.source || 'SUPABASE_VAULT',
              }
            : null,
          diskMeta.hasSpcSt || diskMeta.hasSpcScSession || diskMeta.hasSpcEc
            ? {
                cookies: diskMeta.rawCookies,
                spcCds: diskMeta.spcCds,
                csrfToken: diskMeta.csrfToken,
                source: diskMeta.source || 'LOCAL_DISK',
              }
            : null,
        ].filter((x): x is NonNullable<typeof x> => Boolean(x))

        for (const cand of candidates) {
          const direct = await verifyDirectlyWithShopee(cand.cookies, cand.spcCds, cand.csrfToken)
          if (
            direct.alive &&
            (!binding.shopId || !direct.shopId || direct.shopId === binding.shopId)
          ) {
            if (direct.rotated || !vaultSession?.verifiedLive) {
              await saveEncryptedShopeeSessionToVault({
                cookies: direct.cookies,
                spcCds: cand.spcCds,
                csrfToken: cand.csrfToken,
                shopId: direct.shopId || binding.shopId,
                username: direct.username || binding.username,
                source: direct.rotated ? 'SUBSESSION_AUTO_REFRESH' : cand.source,
                updatedByRole: isCloudRenderRuntime() ? 'CLOUD_RENDER' : 'LOCAL_VN',
                verifiedLive: true,
              }).catch(() => null)
            }
            const refreshedOnline = await buildCombinedStatusPayload(direct)
            return NextResponse.json(refreshedOnline, { headers: corsHeaders })
          }
        }

        // Trên máy cục bộ: thử hồi phục tự động từ Trình duyệt Đăng nhập 1 lần (CDP :9222)
        if (!isCloudRenderRuntime()) {
          const fs = await import('node:fs')
          const path = await import('node:path')
          const cdpExtracted = await extractRawCookiesFromLocalCdp(fs, path, 9222)
          if (cdpExtracted.ok && cdpExtracted.cookies) {
            const cdpDirect = await verifyDirectlyWithShopee(
              cdpExtracted.cookies,
              cdpExtracted.spc_cds || '',
              cdpExtracted.csrf_token || ''
            )
            if (
              cdpDirect.alive &&
              (!binding.shopId || !cdpDirect.shopId || cdpDirect.shopId === binding.shopId)
            ) {
              persistVerifiedSessionToDisk(
                fs,
                path,
                cdpDirect.cookies,
                cdpExtracted.spc_cds || '',
                cdpExtracted.csrf_token || '',
                'CHROME_CDP_AUTO_EXTRACT'
              )
              await saveEncryptedShopeeSessionToVault({
                cookies: cdpDirect.cookies,
                spcCds: cdpExtracted.spc_cds || '',
                csrfToken: cdpExtracted.csrf_token || '',
                shopId: cdpDirect.shopId || binding.shopId,
                username: cdpDirect.username || binding.username,
                source: 'CHROME_CDP_AUTO_EXTRACT',
                updatedByRole: 'LOCAL_VN',
                verifiedLive: true,
              }).catch(() => null)
              invalidateApiCache('channels:product-links')
              broadcast('channel.session_restored', {
                key: 'SHOPEE',
                shopId: cdpDirect.shopId || binding.shopId,
                username: cdpDirect.username || binding.username,
              })
              const refreshedCdp = await buildCombinedStatusPayload(cdpDirect)
              return NextResponse.json(refreshedCdp, { headers: corsHeaders })
            }
          }
        }

        await markVaultSessionExpiredInMeta(
          'Kiểm tra trực tuyến xác nhận Cookie Shopee hiện tại đã hết hạn'
        )
        const expiredPayload = await buildCombinedStatusPayload({ alive: false })
        return NextResponse.json(expiredPayload, { headers: corsHeaders })
      }

      const refreshed = await buildCombinedStatusPayload()
      return NextResponse.json(refreshed, { headers: corsHeaders })
    }

    // ===== 4. NHẬP CURL / COOKIE / JSON TỪ OPERATOR, TRANG BETA HOẶC EXTENSION =====
    const parsed = parseShopeeCurlOrCookieInput(body.rawInput || '')
    if (!parsed.valid) {
      return NextResponse.json(
        {
          ok: false,
          code: 'PARSE_INVALID',
          error: parsed.error || 'Nội dung cURL / Cookie không hợp lệ.',
          format: parsed.format,
          cookieCount: parsed.cookieCount,
          sessionKeysFound: parsed.sessionKeysFound,
        },
        { status: 400, headers: corsHeaders }
      )
    }

    const binding = await resolveShopBindingAndPairingPreview()
    const enforceShopLock = isPublicBridgeCaller ? true : body.enforceShopLock !== false
    const expectedShopId = enforceShopLock ? binding.shopId : ''

    const spcCds =
      parsed.spcCds || parsed.cookies['SPC_CDS'] || 'c2344aba-5428-425d-bba9-04838a499109'
    const csrfToken =
      parsed.csrfToken || parsed.cookies['csrftoken'] || '0BQKllKGsakrP1WMZnz4ZKeXdP3neixB'
    const importSource = req.headers.get('origin')?.startsWith('chrome-extension://')
      ? 'CHROME_EXTENSION_CLOUD_SYNC'
      : isPublicBridgeCaller
        ? 'BETA_WEB_CLOUD_IMPORT'
        : 'MANUAL_CURL_IMPORT'

    let verifiedLive = false
    let daemonOnline = false
    let detectedShopId: string | null = null
    let detectedUsername: string | null = null
    let finalCookies: Record<string, string> = { ...parsed.cookies }

    // 4.1 Ưu tiên đẩy sang Python Sync Daemon (:51898) để vừa xác thực vừa nạp nóng RAM
    try {
      const bridgeRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: parsed.cookies,
          spc_cds: spcCds,
          csrf_token: csrfToken,
          source: importSource,
          expectedShopId,
        }),
        signal: AbortSignal.timeout(12000),
      })
      daemonOnline = true
      const bridgeData = (await bridgeRes.json().catch(() => ({}))) as {
        ok?: boolean
        code?: string
        shopId?: string
        username?: string
        error?: string
      }

      if (bridgeRes.status === 409) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SHOP_MISMATCH',
            shopId: bridgeData.shopId,
            username: bridgeData.username,
            expectedShopId,
            error:
              bridgeData.error ||
              `Tài khoản Shopee trong lệnh cURL (#${bridgeData.shopId || '?'}) không khớp với shop liên kết (#${expectedShopId}).`,
          },
          { status: 409, headers: corsHeaders }
        )
      }

      if (!bridgeRes.ok || !bridgeData.ok) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SESSION_EXPIRED_OR_INVALID',
            error:
              bridgeData.error ||
              'Cookie trong lệnh cURL đã hết hạn hoặc bị Shopee từ chối. Hãy tải lại trang banhang.shopee.vn rồi Copy as cURL mới.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      verifiedLive = true
      detectedShopId = bridgeData.shopId ? String(bridgeData.shopId) : binding.shopId
      detectedUsername = bridgeData.username ? String(bridgeData.username) : binding.username
      const diskAfterBridge = await readSessionDiskMetadata()
      if (
        diskAfterBridge.cookieCount > 0 &&
        (diskAfterBridge.hasSpcSt || diskAfterBridge.hasSpcScSession || diskAfterBridge.hasSpcEc)
      ) {
        finalCookies = diskAfterBridge.rawCookies
      }
    } catch {
      // 4.2 Daemon :51898 chưa chạy -> Node.js tự xác thực trực tiếp với Shopee API v2/login
      const directCheck = await verifyDirectlyWithShopee(parsed.cookies, spcCds, csrfToken)
      if (!directCheck.alive) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SESSION_EXPIRED_OR_INVALID',
            error:
              'Cookie trong lệnh cURL đã hết hạn hoặc không đăng nhập được vào banhang.shopee.vn. Hãy mở lại Kênh Người Bán và lấy lệnh cURL mới.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      if (expectedShopId && directCheck.shopId && directCheck.shopId !== expectedShopId) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SHOP_MISMATCH',
            shopId: directCheck.shopId,
            username: directCheck.username,
            expectedShopId,
            error: `Tài khoản Shopee trong lệnh cURL (${directCheck.username || '?'} · #${directCheck.shopId}) không khớp với shop liên kết (#${expectedShopId}).`,
          },
          { status: 409, headers: corsHeaders }
        )
      }

      verifiedLive = true
      detectedShopId = directCheck.shopId || binding.shopId
      detectedUsername = directCheck.username || binding.username
      finalCookies = directCheck.cookies

      const fs = await import('node:fs')
      const path = await import('node:path')
      persistVerifiedSessionToDisk(fs, path, finalCookies, spcCds, csrfToken, importSource)
    }

    // 4.3 Luôn mã hóa AES-256-GCM và đồng bộ ngay vào Kho Phiên Supabase để Cloud Render Singapore nuôi 24/7
    const vaultEnv = await saveEncryptedShopeeSessionToVault({
      cookies: finalCookies,
      spcCds,
      csrfToken,
      shopId: detectedShopId || binding.shopId,
      username: detectedUsername || binding.username,
      source: importSource,
      updatedByRole: isCloudRenderRuntime() ? 'CLOUD_RENDER' : 'OPERATOR',
      verifiedLive: true,
    })

    const requeuedRes = await db.ledgerEntry.updateMany({
      where: {
        scope: 'CHANNEL',
        action: { in: ['OUTBOX_DEAD_LETTER', 'OUTBOX_DEFERRED'] },
      },
      data: {
        action: 'OUTBOX_PENDING',
      },
    })

    await logLedger({
      scope: 'CHANNEL',
      action: 'SHOPEE_COOKIE_IMPORTED',
      entityType: 'Channel',
      entityCode: 'SHOPEE',
      title: `Shopee (${detectedUsername || binding.username}): Nạp phiên Cookie qua ${parsed.format} lên Kho Phiên Mã Hóa Cloud (${Object.keys(finalCookies).length} cookies)${requeuedRes.count > 0 ? ` · Tự động xếp lại ${requeuedRes.count} tác vụ Outbox` : ''}`,
      detail: {
        format: parsed.format,
        cookieCount: Object.keys(finalCookies).length,
        sessionKeysFound: parsed.sessionKeysFound,
        spcCdsMasked: maskSecretValue(spcCds),
        shopId: detectedShopId,
        username: detectedUsername,
        daemonOnline,
        verifiedLive,
        vaultVersion: vaultEnv.version,
        vaultCipher: 'AES-256-GCM',
        requeuedOutboxCount: requeuedRes.count,
      },
      actor: 'OPERATOR',
      originSource: 'MANUAL_ADMIN',
    })

    invalidateApiCache('channels:product-links')
    broadcast('channel.session_restored', {
      key: 'SHOPEE',
      shopId: detectedShopId,
      username: detectedUsername,
      requeuedCount: requeuedRes.count,
    })
    broadcast('channel.updated', {
      key: 'SHOPEE',
      sessionUpdated: true,
      verifiedLive,
      shopId: detectedShopId,
      username: detectedUsername,
    })

    const refreshed = await buildCombinedStatusPayload({
      alive: verifiedLive,
      shopId: detectedShopId,
      username: detectedUsername,
    })
    return NextResponse.json(
      {
        ...refreshed,
        imported: true,
        verifiedLive,
        format: parsed.format,
        requeuedOutboxCount: requeuedRes.count,
        message: `Đã xác thực & lưu Kho Phiên Mã Hóa AES-256-GCM trên Supabase (${Object.keys(finalCookies).length} Cookie) cho shop ${detectedUsername} (#${detectedShopId})! Cloud Render Singapore sẽ tự động nuôi phiên khi bạn tắt máy.`,
      },
      { headers: corsHeaders }
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Lỗi máy chủ khi xử lý Cookie Shopee.',
      },
      { status: 500, headers: corsHeaders }
    )
  }
}
