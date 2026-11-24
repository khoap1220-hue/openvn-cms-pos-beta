import crypto from 'node:crypto'
import { db } from '@/lib/db'
import { maskSecretValue, type MaskedCookiePreview } from '@/lib/shopee-curl-parser'
import { DEFAULT_SHOPEE_SHOP_BINDING } from '@/lib/shopee-extension-bundle'

export const DEFAULT_CLOUD_BACKEND_ORIGIN = 'https://openvn-cms-pos-backend.onrender.com'

export const VAULT_SESSION_WATCH_KEYS = [
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

export type ShopeeNodeRole = 'LOCAL_VN' | 'CLOUD_RENDER'

export interface ShopeeDecryptedSessionPayload {
  cookies: Record<string, string>
  spcCds: string
  csrfToken: string
  shopId: string
  username: string
  source: string
  updatedAt: string
  updatedAtMs: number
  version: number
}

export interface EncryptedVaultEnvelopeV1 {
  v: 1
  alg: 'AES-256-GCM'
  kd: 'ENV_VAULT_KEY' | 'DB_CREDENTIAL_HKDF' | 'CUSTOM_SECRET'
  iv: string
  authTag: string
  ciphertext: string
  shopId: string
  username: string
  cookieCount: number
  hasSpcSt: boolean
  hasSpcScSession: boolean
  hasSpcEc: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  source: string
  updatedByRole: ShopeeNodeRole | 'OPERATOR'
  verifiedLive: boolean
  lastError?: string | null
  version: number
  updatedAt: string
  updatedAtMs: number
}

export interface ShopeeLeaderLeaseV1 {
  v: 1
  holderId: string
  holderRole: ShopeeNodeRole
  hostname: string
  acquiredAt: string
  renewedAt: string
  expiresAt: string
  expiresAtMs: number
  releasedAt?: string | null
  epoch: number
}

export interface ShopeePublicLeaderLeaseView {
  active: boolean
  holderRole: ShopeeNodeRole | null
  holderLabel: string
  hostname: string | null
  expiresAt: string | null
  remainingSec: number
  epoch: number
}

export interface ShopeeVaultPublicMetadata {
  hasEncryptedSession: boolean
  verifiedLive: boolean
  shopId: string
  username: string
  cookieCount: number
  hasSpcSt: boolean
  hasSpcScSession: boolean
  hasSpcEc: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  source: string | null
  updatedByRole: ShopeeNodeRole | 'OPERATOR' | null
  updatedAt: string | null
  updatedAtMs: number
  version: number
  lastError: string | null
  leaderLease: ShopeePublicLeaderLeaseView
}

const HKDF_SALT = Buffer.from('openvn-uudam-shopee-session-vault-salt-v1', 'utf8')

export function resolvePublicCloudBackendOrigin(): string {
  const raw =
    process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL?.trim() ||
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    DEFAULT_CLOUD_BACKEND_ORIGIN
  return raw.replace(/\/+$/, '')
}

export function isCloudRenderRuntime(): boolean {
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

const TRUSTED_SHOPEE_BRIDGE_EXACT_ORIGINS = new Set([
  'https://khoaphan.dev',
  'https://www.khoaphan.dev',
  'https://khoap1220-hue.github.io',
  'https://openvn-cms-pos-backend.onrender.com',
  'http://localhost:3010',
  'http://127.0.0.1:3010',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
])

export function isTrustedShopeeCloudBridgeOrigin(originHeader: string | null | undefined): boolean {
  const origin = (originHeader || '').trim().replace(/\/+$/, '').toLowerCase()
  if (!origin) return false
  if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
    return true
  }
  const configuredCloud = resolvePublicCloudBackendOrigin().toLowerCase()
  if (configuredCloud && origin === configuredCloud) {
    return true
  }
  return TRUSTED_SHOPEE_BRIDGE_EXACT_ORIGINS.has(origin)
}

/**
 * Loại bỏ hoàn toàn mọi trường nội bộ bắt đầu bằng `__` (`__vault_v1`, `__lease_v1`)
 * để tuyệt đối không bao giờ lộ ciphertext/lease ra API công khai hoặc snapshot tĩnh `gh-pages`.
 */
export function stripInternalCredentialFields(
  cfg: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(cfg)) {
    if (key.startsWith('__')) continue
    cleaned[key] = value
  }
  return Object.keys(cleaned).length > 0 ? cleaned : null
}

/**
 * Bảo toàn các trường nội bộ `__vault_v1`, `__lease_v1` và các giá trị bí mật đang bị che mờ (`••••`)
 * khi người vận hành lưu cấu hình tích hợp từ giao diện.
 */
export function mergePreservingInternalVaultFields(
  existingRawConfig: string | null | undefined,
  incomingPublicConfig: Record<string, unknown>
): Record<string, unknown> {
  const sanitizedIncoming = stripInternalCredentialFields(incomingPublicConfig) ?? {}
  if (!existingRawConfig) return sanitizedIncoming
  try {
    const existingObj = JSON.parse(existingRawConfig) as Record<string, unknown>
    if (existingObj && typeof existingObj === 'object' && !Array.isArray(existingObj)) {
      const preserved: Record<string, unknown> = { ...sanitizedIncoming }
      for (const [k, v] of Object.entries(existingObj)) {
        if (k.startsWith('__') && v !== undefined) {
          preserved[k] = v
          continue
        }
        const incomingVal = preserved[k]
        if (
          typeof incomingVal === 'string' &&
          (incomingVal.includes('••••') || incomingVal.includes('[REDACTED')) &&
          typeof v === 'string' &&
          v.trim() !== '' &&
          !v.includes('••••')
        ) {
          preserved[k] = v
        }
      }
      return preserved
    }
  } catch {
    // ignore malformed legacy config
  }
  return sanitizedIncoming
}

function safeDecodeUriComponent(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

function extractDatabaseSecretMaterial(): string {
  const candidates = [
    process.env.DATABASE_URL?.trim(),
    process.env.DIRECT_URL?.trim(),
  ].filter((v): v is string => Boolean(v))

  for (const uri of candidates) {
    try {
      const parsed = new URL(uri)
      if (parsed.password) {
        return `supabase-db-pwd:${safeDecodeUriComponent(parsed.password)}`
      }
    } catch {
      const match = uri.match(/^[a-z0-9+.-]+:\/\/[^:/?#]+:(.+)@[^@/?#]+/i)
      if (match?.[1]) {
        return `supabase-db-pwd:${safeDecodeUriComponent(match[1])}`
      }
    }
  }
  return `fallback-db-uri:${candidates[0] || 'local-dev-ephemeral'}`
}

function deriveHkdfKey(secretMaterial: string, contextLabel: string): Buffer {
  return Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(secretMaterial, 'utf8'),
      HKDF_SALT,
      Buffer.from(`openvn-aes-256-gcm:${contextLabel}`, 'utf8'),
      32
    )
  )
}

interface CandidateKeyEntry {
  kd: EncryptedVaultEnvelopeV1['kd']
  key: Buffer
}

function resolveCandidateKeys(customSecretOverride?: string): CandidateKeyEntry[] {
  if (customSecretOverride && customSecretOverride.trim()) {
    return [
      {
        kd: 'CUSTOM_SECRET',
        key: deriveHkdfKey(customSecretOverride.trim(), 'custom-secret'),
      },
    ]
  }

  const out: CandidateKeyEntry[] = []
  const envVaultKey = process.env.SHOPEE_SESSION_VAULT_KEY?.trim()
  if (envVaultKey && envVaultKey.length >= 16) {
    out.push({
      kd: 'ENV_VAULT_KEY',
      key: deriveHkdfKey(envVaultKey, 'env-vault-key'),
    })
  }

  const dbMaterial = extractDatabaseSecretMaterial()
  out.push({
    kd: 'DB_CREDENTIAL_HKDF',
    key: deriveHkdfKey(dbMaterial, 'db-credential-hkdf'),
  })

  return out
}

function buildVaultAad(shopId: string): Buffer {
  return Buffer.from(`openvn-shopee-vault:${shopId.trim()}:v1`, 'utf8')
}

export function encryptShopeeSessionPayload(input: {
  cookies: Record<string, string>
  spcCds: string
  csrfToken: string
  shopId?: string
  username?: string
  source?: string
  updatedByRole?: ShopeeNodeRole | 'OPERATOR'
  verifiedLive?: boolean
  version?: number
  preferredKd?: EncryptedVaultEnvelopeV1['kd']
  customSecretOverride?: string
}): EncryptedVaultEnvelopeV1 {
  const cookies = input.cookies || {}
  if (
    Object.keys(cookies).length === 0 ||
    String(cookies['SPC_U'] || '') === '3813970' ||
    cookies['SPC_ST'] === 'test_token'
  ) {
    throw new Error('Dữ liệu Cookie Shopee trống hoặc là Cookie mẫu bị chặn.')
  }
  if (!cookies['SPC_ST'] && !cookies['SPC_SC_SESSION'] && !cookies['SPC_EC']) {
    throw new Error('Thiếu khóa phiên cốt lõi (SPC_ST / SPC_SC_SESSION / SPC_EC).')
  }

  const shopId = String(input.shopId || DEFAULT_SHOPEE_SHOP_BINDING.shopId).trim()
  const username = String(input.username || DEFAULT_SHOPEE_SHOP_BINDING.username).trim()
  const spcCds = String(input.spcCds || cookies['SPC_CDS'] || '').trim()
  const csrfToken = String(input.csrfToken || cookies['csrftoken'] || '').trim()
  const source = String(input.source || 'VAULT_SYNC').trim()
  const updatedByRole = input.updatedByRole || (isCloudRenderRuntime() ? 'CLOUD_RENDER' : 'LOCAL_VN')
  const nowMs = Date.now()
  const updatedAt = new Date(nowMs).toISOString()
  const version = Math.max(1, Math.floor(Number(input.version) || 1))

  const candidates = resolveCandidateKeys(input.customSecretOverride)
  const primary =
    (input.preferredKd ? candidates.find((c) => c.kd === input.preferredKd) : undefined) ||
    candidates[0]
  const iv = crypto.randomBytes(12)
  const aad = buildVaultAad(shopId)

  const plaintextJson = JSON.stringify({
    cookies,
    spcCds,
    csrfToken,
    shopId,
    username,
    source,
    updatedAt,
    updatedAtMs: nowMs,
    version,
  })

  const cipher = crypto.createCipheriv('aes-256-gcm', primary.key, iv, {
    authTagLength: 16,
  })
  cipher.setAAD(aad)
  const encrypted = Buffer.concat([cipher.update(plaintextJson, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  const sessionKeysFound = VAULT_SESSION_WATCH_KEYS.filter((k) => Boolean(cookies[k]))
  const maskedPreview: MaskedCookiePreview[] = sessionKeysFound.map((k) => ({
    key: k,
    maskedValue: maskSecretValue(String(cookies[k] || '')),
  }))

  return {
    v: 1,
    alg: 'AES-256-GCM',
    kd: primary.kd,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    shopId,
    username,
    cookieCount: Object.keys(cookies).length,
    hasSpcSt: Boolean(cookies['SPC_ST']),
    hasSpcScSession: Boolean(cookies['SPC_SC_SESSION']),
    hasSpcEc: Boolean(cookies['SPC_EC']),
    sessionKeysFound: [...sessionKeysFound],
    maskedPreview,
    source,
    updatedByRole,
    verifiedLive: input.verifiedLive !== false,
    lastError: null,
    version,
    updatedAt,
    updatedAtMs: nowMs,
  }
}

export function decryptShopeeSessionPayload(
  envelope: EncryptedVaultEnvelopeV1,
  options?: { expectedShopId?: string; customSecretOverride?: string }
): ShopeeDecryptedSessionPayload {
  if (
    !envelope ||
    envelope.v !== 1 ||
    envelope.alg !== 'AES-256-GCM' ||
    !envelope.iv ||
    !envelope.authTag ||
    !envelope.ciphertext
  ) {
    throw new Error('Phong bì Kho Phiên Mã Hóa không hợp lệ.')
  }

  const targetShopId = String(options?.expectedShopId || envelope.shopId || '').trim()
  if (options?.expectedShopId && envelope.shopId && envelope.shopId !== targetShopId) {
    throw new Error(`Shop ID trong Vault (#${envelope.shopId}) không khớp (#${targetShopId}).`)
  }

  const iv = Buffer.from(envelope.iv, 'base64')
  const authTag = Buffer.from(envelope.authTag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  if (iv.byteLength !== 12 || authTag.byteLength !== 16 || ciphertext.byteLength === 0) {
    throw new Error('Tham số mật mã IV / AuthTag của AES-256-GCM bị hỏng.')
  }

  const aad = buildVaultAad(targetShopId)
  const candidates = resolveCandidateKeys(options?.customSecretOverride)
  const ordered = [
    ...candidates.filter((c) => c.kd === envelope.kd),
    ...candidates.filter((c) => c.kd !== envelope.kd),
  ]

  let lastErr: unknown = null
  for (const cand of ordered) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', cand.key, iv, {
        authTagLength: 16,
      })
      decipher.setAAD(aad)
      decipher.setAuthTag(authTag)
      const decryptedBuf = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      const parsed = JSON.parse(decryptedBuf.toString('utf8')) as {
        cookies?: Record<string, string>
        spcCds?: string
        csrfToken?: string
        shopId?: string
        username?: string
        source?: string
        updatedAt?: string
        updatedAtMs?: number
        version?: number
      }
      const cookies = parsed.cookies && typeof parsed.cookies === 'object' ? parsed.cookies : {}
      if (
        Object.keys(cookies).length === 0 ||
        String(cookies['SPC_U'] || '') === '3813970' ||
        cookies['SPC_ST'] === 'test_token'
      ) {
        throw new Error('Cookie sau giải mã rỗng hoặc là Cookie mẫu bị chặn.')
      }
      return {
        cookies,
        spcCds: String(parsed.spcCds || cookies['SPC_CDS'] || ''),
        csrfToken: String(parsed.csrfToken || cookies['csrftoken'] || ''),
        shopId: String(parsed.shopId || envelope.shopId),
        username: String(parsed.username || envelope.username),
        source: String(parsed.source || envelope.source || 'VAULT_SYNC'),
        updatedAt: String(parsed.updatedAt || envelope.updatedAt),
        updatedAtMs: Number(parsed.updatedAtMs || envelope.updatedAtMs || Date.now()),
        version: Number(parsed.version || envelope.version || 1),
      }
    } catch (err) {
      lastErr = err
    }
  }

  throw new Error(
    `Giải mã AES-256-GCM thất bại (xác thực toàn vẹn GCM bị từ chối): ${
      lastErr instanceof Error ? lastErr.message : 'Unknown error'
    }`
  )
}

function formatPublicLeaderLease(
  rawLease: ShopeeLeaderLeaseV1 | null | undefined,
  nowMs = Date.now()
): ShopeePublicLeaderLeaseView {
  if (!rawLease || typeof rawLease !== 'object' || !rawLease.holderId) {
    return {
      active: false,
      holderRole: null,
      holderLabel: 'Chưa có trạm giữ khóa (Sẵn sàng tiếp quản)',
      hostname: null,
      expiresAt: null,
      remainingSec: 0,
      epoch: 0,
    }
  }
  const expiresAtMs = Number(rawLease.expiresAtMs || 0)
  const active = expiresAtMs > nowMs
  const remainingSec = active ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000)) : 0
  const role = rawLease.holderRole === 'CLOUD_RENDER' ? 'CLOUD_RENDER' : 'LOCAL_VN'
  const holderLabel = !active
    ? `Đã hết hạn (${role === 'LOCAL_VN' ? 'Máy bán hàng VN' : 'Cloud Render Singapore'})`
    : role === 'LOCAL_VN'
      ? 'Máy bán hàng tại tiệm (Mạng VN · Ưu tiên #1)'
      : 'Cloud 24/7 (Render Singapore · Tiếp quản tự động)'

  return {
    active,
    holderRole: active ? role : null,
    holderLabel,
    hostname: rawLease.hostname || null,
    expiresAt: rawLease.expiresAt || null,
    remainingSec,
    epoch: Number(rawLease.epoch || 0),
  }
}

async function readRawShopeeCredentialConfig(): Promise<Record<string, unknown>> {
  const row = await db.integrationCredential.findUnique({
    where: { provider: 'SHOPEE' },
    select: { config: true },
  })
  if (!row?.config) return {}
  try {
    const parsed = JSON.parse(row.config) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return {}
}

/**
 * Cập nhật nguyên tử các trường JSON cấp cao trong `IntegrationCredential(provider='SHOPEE').config`
 * bằng khóa hàng `SELECT ... FOR UPDATE` trên PostgreSQL (bảo toàn 100% chuẩn 24 bảng `check-counts.mjs`).
 */
async function mutateShopeeCredentialConfigAtomic<T>(
  mutator: (currentConfig: Record<string, unknown>, nowMs: number) => {
    patch: Record<string, unknown>
    result: T
  }
): Promise<T> {
  return db.$transaction(async (tx) => {
    let currentCfg: Record<string, unknown> = {}
    let rowExists = false

    try {
      const lockedRows = await tx.$queryRaw<Array<{ id: string; config: string | null }>>`
        SELECT "id", "config"
        FROM "IntegrationCredential"
        WHERE "provider" = 'SHOPEE'
        FOR UPDATE
      `
      if (lockedRows.length > 0) {
        rowExists = true
        const rawStr = lockedRows[0].config
        if (rawStr) {
          const parsed = JSON.parse(rawStr) as unknown
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            currentCfg = parsed as Record<string, unknown>
          }
        }
      }
    } catch {
      const existing = await tx.integrationCredential.findUnique({
        where: { provider: 'SHOPEE' },
      })
      if (existing) {
        rowExists = true
        try {
          currentCfg = JSON.parse(existing.config) as Record<string, unknown>
        } catch {
          currentCfg = {}
        }
      }
    }

    // Lấy mốc thời gian chính xác SAU khi đã giành được khóa hàng FOR UPDATE trên PostgreSQL
    const nowMs = Date.now()
    const { patch, result } = mutator(currentCfg, nowMs)
    if (Object.keys(patch).length > 0) {
      const merged = { ...currentCfg, ...patch }
      if (rowExists) {
        await tx.integrationCredential.update({
          where: { provider: 'SHOPEE' },
          data: { config: JSON.stringify(merged) },
        })
      } else {
        await tx.integrationCredential.create({
          data: {
            provider: 'SHOPEE',
            name: 'Shopee Seller Center (thaimy1605 - ID 197195817)',
            config: JSON.stringify({
              shopId: DEFAULT_SHOPEE_SHOP_BINDING.shopId,
              username: DEFAULT_SHOPEE_SHOP_BINDING.username,
              mode: 'SELLER_CENTER_V3_SESSION',
              connected: true,
              ...merged,
            }),
            active: true,
          },
        })
      }
    }

    return result
  })
}

export async function upsertBaseCredentialPreservingInternalFieldsAtomic(params: {
  provider: string
  name: string
  publicConfig: Record<string, unknown>
  active: boolean
}) {
  return db.$transaction(async (tx) => {
    let existingRawConfig: string | null = null
    try {
      const locked = await tx.$queryRaw<Array<{ id: string; config: string | null }>>`
        SELECT "id", "config"
        FROM "IntegrationCredential"
        WHERE "provider" = ${params.provider}
        FOR UPDATE
      `
      if (locked.length > 0) {
        existingRawConfig = locked[0].config
      }
    } catch {
      const existing = await tx.integrationCredential.findUnique({
        where: { provider: params.provider },
        select: { config: true },
      })
      existingRawConfig = existing?.config ?? null
    }

    const mergedDbConfig = mergePreservingInternalVaultFields(
      existingRawConfig,
      params.publicConfig
    )
    const publicReturnedConfig = stripInternalCredentialFields(mergedDbConfig) ?? {}

    const credential = await tx.integrationCredential.upsert({
      where: { provider: params.provider },
      update: {
        name: params.name,
        config: JSON.stringify(mergedDbConfig),
        active: params.active,
      },
      create: {
        provider: params.provider,
        name: params.name,
        config: JSON.stringify(mergedDbConfig),
        active: params.active,
      },
    })

    return {
      credential,
      publicReturnedConfig,
    }
  })
}

export async function saveEncryptedShopeeSessionToVault(input: {
  cookies: Record<string, string>
  spcCds: string
  csrfToken: string
  shopId?: string
  username?: string
  source?: string
  updatedByRole?: ShopeeNodeRole | 'OPERATOR'
  verifiedLive?: boolean
}): Promise<EncryptedVaultEnvelopeV1> {
  return mutateShopeeCredentialConfigAtomic((currentCfg) => {
    const prevVault = currentCfg.__vault_v1 as EncryptedVaultEnvelopeV1 | undefined
    const nextVersion = (Number(prevVault?.version) || 0) + 1
    // Bảo toàn cơ chế dẫn xuất khóa DB_CREDENTIAL_HKDF khi trạm nền xoay vòng Cookie để tránh lệch khóa bất đối xứng giữa Local & Cloud
    const preferredKd =
      prevVault?.kd === 'DB_CREDENTIAL_HKDF' ? ('DB_CREDENTIAL_HKDF' as const) : undefined
    const envelope = encryptShopeeSessionPayload({
      ...input,
      version: nextVersion,
      preferredKd,
    })
    return {
      patch: { __vault_v1: envelope },
      result: envelope,
    }
  })
}

export async function markVaultSessionExpiredInMeta(reason?: string | null): Promise<void> {
  try {
    await mutateShopeeCredentialConfigAtomic((currentCfg, nowMs) => {
      const prevVault = currentCfg.__vault_v1 as EncryptedVaultEnvelopeV1 | undefined
      if (!prevVault || typeof prevVault !== 'object') {
        return { patch: {}, result: undefined }
      }
      const nextVault: EncryptedVaultEnvelopeV1 = {
        ...prevVault,
        verifiedLive: false,
        lastError: reason ? String(reason).slice(0, 240) : 'Phiên Cookie Shopee đã hết hạn',
        updatedAt: new Date(nowMs).toISOString(),
        updatedAtMs: nowMs,
      }
      return {
        patch: { __vault_v1: nextVault },
        result: undefined,
      }
    })
  } catch {
    // Non-fatal
  }
}

export async function readShopeeSessionVaultMetadata(): Promise<ShopeeVaultPublicMetadata> {
  try {
    const cfg = await readRawShopeeCredentialConfig()
    const vault = cfg.__vault_v1 as EncryptedVaultEnvelopeV1 | undefined
    const lease = cfg.__lease_v1 as ShopeeLeaderLeaseV1 | undefined
    const defaultShopId = String(cfg.shopId || DEFAULT_SHOPEE_SHOP_BINDING.shopId)
    const defaultUsername = String(cfg.username || DEFAULT_SHOPEE_SHOP_BINDING.username)

    if (!vault || vault.v !== 1 || !vault.ciphertext) {
      return {
        hasEncryptedSession: false,
        verifiedLive: false,
        shopId: defaultShopId,
        username: defaultUsername,
        cookieCount: 0,
        hasSpcSt: false,
        hasSpcScSession: false,
        hasSpcEc: false,
        sessionKeysFound: [],
        maskedPreview: [],
        source: null,
        updatedByRole: null,
        updatedAt: null,
        updatedAtMs: 0,
        version: 0,
        lastError: null,
        leaderLease: formatPublicLeaderLease(lease),
      }
    }

    return {
      hasEncryptedSession: true,
      verifiedLive: Boolean(vault.verifiedLive),
      shopId: String(vault.shopId || defaultShopId),
      username: String(vault.username || defaultUsername),
      cookieCount: Number(vault.cookieCount || 0),
      hasSpcSt: Boolean(vault.hasSpcSt),
      hasSpcScSession: Boolean(vault.hasSpcScSession),
      hasSpcEc: Boolean(vault.hasSpcEc),
      sessionKeysFound: Array.isArray(vault.sessionKeysFound) ? vault.sessionKeysFound : [],
      maskedPreview: Array.isArray(vault.maskedPreview) ? vault.maskedPreview : [],
      source: vault.source || null,
      updatedByRole: vault.updatedByRole || null,
      updatedAt: vault.updatedAt || null,
      updatedAtMs: Number(vault.updatedAtMs || 0),
      version: Number(vault.version || 1),
      lastError: vault.lastError || null,
      leaderLease: formatPublicLeaderLease(lease),
    }
  } catch {
    return {
      hasEncryptedSession: false,
      verifiedLive: false,
      shopId: DEFAULT_SHOPEE_SHOP_BINDING.shopId,
      username: DEFAULT_SHOPEE_SHOP_BINDING.username,
      cookieCount: 0,
      hasSpcSt: false,
      hasSpcScSession: false,
      hasSpcEc: false,
      sessionKeysFound: [],
      maskedPreview: [],
      source: null,
      updatedByRole: null,
      updatedAt: null,
      updatedAtMs: 0,
      version: 0,
      lastError: null,
      leaderLease: formatPublicLeaderLease(null),
    }
  }
}

export async function readDecryptedShopeeSessionFromVault(
  expectedShopId?: string
): Promise<(ShopeeDecryptedSessionPayload & { verifiedLive: boolean }) | null> {
  try {
    const cfg = await readRawShopeeCredentialConfig()
    const vault = cfg.__vault_v1 as EncryptedVaultEnvelopeV1 | undefined
    if (!vault || vault.v !== 1 || !vault.ciphertext) {
      return null
    }
    const decrypted = decryptShopeeSessionPayload(vault, { expectedShopId })
    return {
      ...decrypted,
      verifiedLive: Boolean(vault.verifiedLive),
    }
  } catch {
    return null
  }
}

export async function acquireOrRenewShopeeLeaderLease(params: {
  nodeId: string
  nodeRole: ShopeeNodeRole
  hostname?: string
  action?: 'ACQUIRE_OR_RENEW' | 'RELEASE' | 'PEEK'
  ttlMs?: number
}): Promise<{
  leaseGranted: boolean
  preemptedCloud: boolean
  yieldedToLocal: boolean
  lease: ShopeePublicLeaderLeaseView
  rawLease: ShopeeLeaderLeaseV1 | null
}> {
  const nodeId = String(params.nodeId || '').trim()
  if (!nodeId) {
    throw new Error('Thiếu định danh nodeId khi yêu cầu Leader Lease.')
  }
  const nodeRole: ShopeeNodeRole =
    params.nodeRole === 'CLOUD_RENDER' ? 'CLOUD_RENDER' : 'LOCAL_VN'
  const hostname = String(params.hostname || nodeRole).trim().slice(0, 120)
  const action = params.action || 'ACQUIRE_OR_RENEW'
  const ttlMs = Math.min(300_000, Math.max(20_000, Math.floor(Number(params.ttlMs) || 90_000)))

  return mutateShopeeCredentialConfigAtomic<{
    leaseGranted: boolean
    preemptedCloud: boolean
    yieldedToLocal: boolean
    lease: ShopeePublicLeaderLeaseView
    rawLease: ShopeeLeaderLeaseV1 | null
  }>((currentCfg, nowMs) => {
    const existing = (currentCfg.__lease_v1 as ShopeeLeaderLeaseV1 | undefined) ?? null
    const isActive = Boolean(existing && existing.holderId && Number(existing.expiresAtMs) > nowMs)
    const nowIso = new Date(nowMs).toISOString()

    if (action === 'PEEK') {
      const granted = Boolean(isActive && existing?.holderId === nodeId)
      return {
        patch: {},
        result: {
          leaseGranted: granted,
          preemptedCloud: false,
          yieldedToLocal: Boolean(
            isActive && nodeRole === 'CLOUD_RENDER' && existing?.holderRole === 'LOCAL_VN'
          ),
          lease: formatPublicLeaderLease(existing, nowMs),
          rawLease: existing,
        },
      }
    }

    if (action === 'RELEASE') {
      if (existing && existing.holderId === nodeId) {
        const released: ShopeeLeaderLeaseV1 = {
          ...existing,
          expiresAt: nowIso,
          expiresAtMs: 0,
          releasedAt: nowIso,
        }
        return {
          patch: { __lease_v1: released },
          result: {
            leaseGranted: false,
            preemptedCloud: false,
            yieldedToLocal: false,
            lease: formatPublicLeaderLease(released, nowMs),
            rawLease: released,
          },
        }
      }
      return {
        patch: {},
        result: {
          leaseGranted: false,
          preemptedCloud: false,
          yieldedToLocal: Boolean(
            isActive && nodeRole === 'CLOUD_RENDER' && existing?.holderRole === 'LOCAL_VN'
          ),
          lease: formatPublicLeaderLease(existing, nowMs),
          rawLease: existing,
        },
      }
    }

    // ACTION: ACQUIRE_OR_RENEW
    // Quy tắc ưu tiên:
    // 1. LOCAL_VN (Máy bán hàng mạng Việt Nam) có quyền ưu tiên cao nhất -> được phép preempt CLOUD_RENDER ngay khi bật máy!
    // 2. CLOUD_RENDER chỉ tiếp quản khi chưa có trạm giữ khóa, chính nó đang giữ khóa, hoặc khóa của LOCAL_VN đã hết hạn/giải phóng.
    const sameHolder = Boolean(existing && existing.holderId === nodeId)
    const canPreemptCloud =
      nodeRole === 'LOCAL_VN' && isActive && existing?.holderRole === 'CLOUD_RENDER'

    if (!isActive || sameHolder || canPreemptCloud) {
      const expiresAtMs = nowMs + ttlMs
      const nextEpoch = sameHolder && isActive
        ? Number(existing?.epoch || 1)
        : (Number(existing?.epoch) || 0) + 1
      const nextLease: ShopeeLeaderLeaseV1 = {
        v: 1,
        holderId: nodeId,
        holderRole: nodeRole,
        hostname,
        acquiredAt: sameHolder && isActive ? existing!.acquiredAt : nowIso,
        renewedAt: nowIso,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresAtMs,
        releasedAt: null,
        epoch: nextEpoch,
      }
      return {
        patch: { __lease_v1: nextLease },
        result: {
          leaseGranted: true,
          preemptedCloud: canPreemptCloud,
          yieldedToLocal: false,
          lease: formatPublicLeaderLease(nextLease, nowMs),
          rawLease: nextLease,
        },
      }
    }

    // Khóa đang được giữ hợp lệ bởi trạm khác có quyền >= trạm hiện tại (VD: LOCAL_VN đang chạy trong khi CLOUD_RENDER hỏi)
    return {
      patch: {},
      result: {
        leaseGranted: false,
        preemptedCloud: false,
        yieldedToLocal: Boolean(nodeRole === 'CLOUD_RENDER' && existing?.holderRole === 'LOCAL_VN'),
        lease: formatPublicLeaderLease(existing, nowMs),
        rawLease: existing,
      },
    }
  })
}
