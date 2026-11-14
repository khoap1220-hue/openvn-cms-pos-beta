import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, invalidateApiCache } from '@/lib/realtime'
import {
  maskSecretValue,
  parseShopeeCurlOrCookieInput,
  type MaskedCookiePreview,
} from '@/lib/shopee-curl-parser'
import { DEFAULT_SHOPEE_SHOP_BINDING } from '@/lib/shopee-extension-bundle'

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

interface SessionDiskMeta {
  cookieCount: number
  hasSpcSt: boolean
  hasSpcScSession: boolean
  hasSpcEc: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  updatedAt: string | null
  source: string | null
}

function resolveShopeeSessionPath(
  fsMod: typeof import('node:fs'),
  pathMod: typeof import('node:path')
): string {
  const envRoot = process.env.OPENVN_PROJECT_ROOT?.trim()
  if (envRoot) {
    return pathMod.join(/* turbopackIgnore: true */ envRoot, 'scripts', '.shopee_session.json')
  }
  const candidates = [
    pathMod.join(/* turbopackIgnore: true */ process.cwd(), 'scripts', '.shopee_session.json'),
    pathMod.join(
      /* turbopackIgnore: true */ process.cwd(),
      '..',
      '..',
      'scripts',
      '.shopee_session.json'
    ),
  ]
  for (const candidate of candidates) {
    if (fsMod.existsSync(/* turbopackIgnore: true */ pathMod.dirname(candidate))) {
      return candidate
    }
  }
  return candidates[0]
}

async function readSessionDiskMetadata(): Promise<SessionDiskMeta> {
  try {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const sessionPath = resolveShopeeSessionPath(fs, path)
    if (!fs.existsSync(sessionPath)) {
      return {
        cookieCount: 0,
        hasSpcSt: false,
        hasSpcScSession: false,
        hasSpcEc: false,
        sessionKeysFound: [],
        maskedPreview: [],
        updatedAt: null,
        source: null,
      }
    }
    const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as {
      cookies?: Record<string, string>
      updated_at?: string
      source?: string
    }
    const cookies = raw.cookies && typeof raw.cookies === 'object' ? raw.cookies : {}
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
    }
  } catch {
    return {
      cookieCount: 0,
      hasSpcSt: false,
      hasSpcScSession: false,
      hasSpcEc: false,
      sessionKeysFound: [],
      maskedPreview: [],
      updatedAt: null,
      source: null,
    }
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

  let pairingKeyPreview = '—'
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

async function fetchDaemonStatus(bridgePort: string) {
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/shopee/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      ok?: boolean
      alive?: boolean
      paused?: boolean
      shopId?: string
      username?: string
      cookieCount?: number
      hasSpcSt?: boolean
      hasSpcScSession?: boolean
      lastSync?: string | null
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

async function verifyDirectlyWithShopee(
  cookies: Record<string, string>,
  spcCds: string,
  csrfToken: string
): Promise<{ alive: boolean; shopId: string | null; username: string | null }> {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
  const url = `https://banhang.shopee.vn/api/v2/login/?SPC_CDS=${encodeURIComponent(spcCds)}&SPC_CDS_VER=2`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Cookie: cookieHeader,
        Accept: 'application/json, text/plain, */*',
        Referer: 'https://banhang.shopee.vn/portal/sale/order',
        'X-CSRFToken': csrfToken,
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return { alive: false, shopId: null, username: null }
    const data = (await res.json()) as { shopid?: number | string; username?: string }
    if (data && data.shopid) {
      return {
        alive: true,
        shopId: String(data.shopid),
        username: data.username ? String(data.username) : null,
      }
    }
    return { alive: false, shopId: null, username: null }
  } catch {
    return { alive: false, shopId: null, username: null }
  }
}

async function buildCombinedStatusPayload() {
  const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'
  const [daemon, diskMeta, binding] = await Promise.all([
    fetchDaemonStatus(bridgePort),
    readSessionDiskMetadata(),
    resolveShopBindingAndPairingPreview(),
  ])

  const daemonOnline = Boolean(daemon)
  return {
    ok: true,
    daemonOnline,
    alive: Boolean(daemon?.alive),
    paused: Boolean(daemon?.paused),
    shopId: daemon?.shopId || binding.shopId,
    username: daemon?.username || binding.username,
    cookieCount: daemon?.cookieCount || diskMeta.cookieCount,
    hasSpcSt: Boolean(daemon?.hasSpcSt ?? diskMeta.hasSpcSt),
    hasSpcScSession: Boolean(daemon?.hasSpcScSession ?? diskMeta.hasSpcScSession),
    hasSpcEc: diskMeta.hasSpcEc,
    sessionKeysFound: diskMeta.sessionKeysFound,
    maskedPreview: diskMeta.maskedPreview,
    updatedAt: diskMeta.updatedAt,
    source: diskMeta.source,
    lastSync: daemon?.lastSync || null,
    trackedProducts: daemon?.asyncQueue?.trackedProducts ?? 0,
    dlqCount: daemon?.asyncQueue?.dlqCount ?? 0,
    extensionInfo: {
      shopId: binding.shopId,
      username: binding.username,
      shopLabel: binding.shopLabel,
      bridgePort: Number(bridgePort),
      downloadUrl: '/api/channels/shopee-extension',
      unpackedDir: 'extensions/shopee-sync-extension',
      pairingKeyPreview: binding.pairingKeyPreview,
    },
  }
}

export async function GET() {
  const payload = await buildCombinedStatusPayload()
  return NextResponse.json(payload)
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'CHECK_SESSION' | 'IMPORT_CURL'
      rawInput?: string
      enforceShopLock?: boolean
    }

    const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'

    if (body.action === 'CHECK_SESSION') {
      try {
        await fetch(`http://127.0.0.1:${bridgePort}/shopee/check-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(10000),
        })
      } catch {
        // Nếu daemon ngoại tuyến, vẫn trả về trạng thái tổng hợp hiện tại
      }
      const refreshed = await buildCombinedStatusPayload()
      return NextResponse.json(refreshed)
    }

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
        { status: 400 }
      )
    }

    const binding = await resolveShopBindingAndPairingPreview()
    const enforceShopLock = body.enforceShopLock !== false
    const expectedShopId = enforceShopLock ? binding.shopId : ''

    const spcCds =
      parsed.spcCds || parsed.cookies['SPC_CDS'] || 'c2344aba-5428-425d-bba9-04838a499109'
    const csrfToken =
      parsed.csrfToken || parsed.cookies['csrftoken'] || '0BQKllKGsakrP1WMZnz4ZKeXdP3neixB'

    let verifiedLive = false
    let daemonOnline = false
    let detectedShopId: string | null = null
    let detectedUsername: string | null = null

    // 1. Ưu tiên đẩy sang Python Sync Daemon (:51898) để vừa xác thực vừa nạp nóng RAM
    try {
      const bridgeRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: parsed.cookies,
          spc_cds: spcCds,
          csrf_token: csrfToken,
          source: 'MANUAL_CURL_IMPORT',
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
          { status: 409 }
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
          { status: 400 }
        )
      }

      verifiedLive = true
      detectedShopId = bridgeData.shopId ? String(bridgeData.shopId) : binding.shopId
      detectedUsername = bridgeData.username ? String(bridgeData.username) : binding.username
    } catch {
      // 2. Daemon :51898 chưa chạy -> Node.js tự xác thực trực tiếp với Shopee API v2/login
      const directCheck = await verifyDirectlyWithShopee(parsed.cookies, spcCds, csrfToken)
      if (!directCheck.alive) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SESSION_EXPIRED_OR_INVALID',
            error:
              'Cookie trong lệnh cURL đã hết hạn hoặc không đăng nhập được vào banhang.shopee.vn. Hãy mở lại Kênh Người Bán và lấy lệnh cURL mới.',
          },
          { status: 400 }
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
          { status: 409 }
        )
      }

      verifiedLive = true
      detectedShopId = directCheck.shopId || binding.shopId
      detectedUsername = directCheck.username || binding.username

      const fs = await import('node:fs')
      const path = await import('node:path')
      const sessionPath = resolveShopeeSessionPath(fs, path)
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(
          {
            cookies: parsed.cookies,
            spc_cds: spcCds,
            csrf_token: csrfToken,
            updated_at: new Date().toISOString(),
            source: 'MANUAL_CURL_IMPORT',
          },
          null,
          2
        ),
        'utf-8'
      )
    }

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
      title: `Shopee (${detectedUsername || binding.username}): Nạp phiên Cookie qua ${parsed.format} (${parsed.cookieCount} cookies)${requeuedRes.count > 0 ? ` · Tự động xếp lại ${requeuedRes.count} tác vụ Outbox` : ''}`,
      detail: {
        format: parsed.format,
        cookieCount: parsed.cookieCount,
        sessionKeysFound: parsed.sessionKeysFound,
        spcCdsMasked: maskSecretValue(spcCds),
        shopId: detectedShopId,
        username: detectedUsername,
        daemonOnline,
        verifiedLive,
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

    const refreshed = await buildCombinedStatusPayload()
    return NextResponse.json({
      ...refreshed,
      imported: true,
      verifiedLive,
      format: parsed.format,
      requeuedOutboxCount: requeuedRes.count,
      message: `Đã xác thực & nạp thành công ${parsed.cookieCount} Cookie cho shop ${detectedUsername} (#${detectedShopId})! Hàng đợi bất đồng bộ đang tự động đồng bộ.`,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Lỗi máy chủ khi xử lý Cookie Shopee.',
      },
      { status: 500 }
    )
  }
}
