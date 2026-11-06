// ============================================================
// AUTH & SESSION CRYPTO — Xác thực Web UI (Signed Cookie) & External API (X-API-Key)
// Tương thích 100% cả Edge/Proxy Runtime lẫn Node.js Runtime nhờ Web Crypto API.
// ============================================================

import {
  type PermissionMap,
  type RoleKey,
  isValidRole,
  parseCustomPermissions,
} from '@/lib/rbac'

export const SESSION_COOKIE_NAME = 'omnisales_session'
export const AUTH_LOCK_COOKIE_NAME = 'omnisales_auth_enforced'

export interface SessionClaims {
  sid: string // ID bản ghi StaffSession
  uid: string // ID bản ghi StaffUser
  usr: string // username
  nam: string // displayName
  rol: RoleKey
  ovr?: Partial<PermissionMap>
  exp: number // Epoch ms
}

function getSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.CMS_ADMIN_PASSWORD ||
    'omnisales-uudam-secret-key-2026'
  )
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(input: string): string | null {
  try {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`omnisales_salt_v1:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

export async function hashPin(username: string, pin: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`omnisales_pin_v1:${username.toLowerCase()}:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return toHex(digest)
}

export async function hmacSign(message: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return toHex(sig)
}

/**
 * Ký token phiên đăng nhập v2 (mang đầy đủ định danh nhân sự, vai trò & ghi đè quyền)
 * Đồng thời hỗ trợ gọi kiểu cũ `signSessionToken('ADMIN')` để tương thích ngược.
 */
export async function signSessionToken(
  input:
    | RoleKey
    | string
    | {
        sessionId: string
        userId: string
        username: string
        displayName: string
        role: RoleKey | string
        customPermissions?: string | Partial<PermissionMap> | null
      } = 'ADMIN',
  ttlMs = 14 * 24 * 3600 * 1000
): Promise<string> {
  const exp = Date.now() + ttlMs
  const claims: SessionClaims =
    typeof input === 'string'
      ? {
          sid: 'legacy-admin',
          uid: 'admin',
          usr: 'admin',
          nam: 'Quản trị viên',
          rol: isValidRole(input) ? input : 'ADMIN',
          exp,
        }
      : {
          sid: input.sessionId,
          uid: input.userId,
          usr: input.username,
          nam: input.displayName,
          rol: isValidRole(input.role) ? input.role : 'CASHIER_POS',
          ovr: parseCustomPermissions(input.customPermissions),
          exp,
        }

  const encoded = encodeBase64Url(JSON.stringify(claims))
  const payload = `v2.${encoded}`
  const sig = await hmacSign(payload)
  return `${payload}.${sig}`
}

export async function verifySessionToken(
  token: string | undefined | null
): Promise<{
  valid: boolean
  role?: RoleKey
  claims?: SessionClaims
}> {
  if (!token) return { valid: false }
  const parts = token.split('.')

  // Định dạng v2: v2.<base64url>.<sig>
  if (parts.length === 3 && parts[0] === 'v2') {
    const [, encoded, sig] = parts
    const expected = await hmacSign(`v2.${encoded}`)
    if (expected !== sig) return { valid: false }
    const json = decodeBase64Url(encoded)
    if (!json) return { valid: false }
    try {
      const parsed = JSON.parse(json) as SessionClaims
      if (!parsed || !Number.isFinite(parsed.exp) || Date.now() > parsed.exp) {
        return { valid: false }
      }
      const role: RoleKey = isValidRole(parsed.rol) ? parsed.rol : 'CASHIER_POS'
      return {
        valid: true,
        role,
        claims: { ...parsed, rol: role },
      }
    } catch {
      return { valid: false }
    }
  }

  // Định dạng v1 tương thích ngược: <ROLE>.<exp>.<sig>
  if (parts.length === 3) {
    const [rawRole, expStr, sig] = parts
    const exp = Number(expStr)
    if (!Number.isFinite(exp) || Date.now() > exp) return { valid: false }
    const expected = await hmacSign(`${rawRole}.${expStr}`)
    if (expected !== sig) return { valid: false }
    const role: RoleKey = isValidRole(rawRole) ? rawRole : 'ADMIN'
    return {
      valid: true,
      role,
      claims: {
        sid: 'legacy-session',
        uid: 'admin',
        usr: 'admin',
        nam: 'Quản trị viên',
        rol: role,
        exp,
      },
    }
  }

  return { valid: false }
}

export async function signInternalAuditPayload(rawJson: string): Promise<string> {
  return hmacSign(`internal_audit_v1:${rawJson}`)
}

export async function verifyInternalAuditPayload(
  rawJson: string,
  signature: string | null | undefined
): Promise<boolean> {
  if (!signature) return false
  const expected = await signInternalAuditPayload(rawJson)
  return expected === signature
}

export function extractApiKeyFromHeaders(headers: Headers): string | null {
  const xKey = headers.get('x-api-key')?.trim()
  if (xKey && xKey.startsWith('omni_')) return xKey
  const auth = headers.get('authorization')?.trim()
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    if (token.startsWith('omni_')) return token
  }
  return null
}

export function extractClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const realIp = headers.get('x-real-ip')
  if (realIp) return realIp.trim()
  return '127.0.0.1'
}

export function parseDeviceFromUserAgent(uaRaw?: string | null): {
  deviceType: 'MOBILE' | 'TABLET' | 'DESKTOP'
  deviceLabel: string
} {
  const ua = uaRaw ?? ''
  if (!ua) return { deviceType: 'DESKTOP', deviceLabel: 'Thiết bị nội bộ' }

  const isTablet = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)
  const isMobile =
    !isTablet && /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|mobile/i.test(ua)
  const deviceType: 'MOBILE' | 'TABLET' | 'DESKTOP' = isTablet
    ? 'TABLET'
    : isMobile
      ? 'MOBILE'
      : 'DESKTOP'

  let os = 'Máy tính'
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/windows/i.test(ua)) os = 'Windows'
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua)) os = 'Linux'

  let browser = 'Trình duyệt'
  if (/edg\//i.test(ua)) browser = 'Edge'
  else if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome'
  else if (/firefox\//i.test(ua)) browser = 'Firefox'
  else if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) browser = 'Safari'

  const kindLabel =
    deviceType === 'MOBILE' ? 'Điện thoại' : deviceType === 'TABLET' ? 'Máy tính bảng' : 'Máy tính'
  return {
    deviceType,
    deviceLabel: `${os} · ${browser} (${kindLabel})`,
  }
}
