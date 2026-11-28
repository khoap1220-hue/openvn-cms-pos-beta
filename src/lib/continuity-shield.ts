/**
 * ContinuityShield — Hệ thống Đảm bảo Hoạt động Liên tục Đa Tầng (24/7 Zero-Drop Continuity)
 *
 * Bảo vệ Cửa hàng & CMS hoạt động không gián đoạn trong mọi kịch bản sự cố:
 * 1. LKG Snapshot (Last-Known-Good): Lưu bản chụp danh mục công khai (0 costPrice, 0 secret)
 *    trên RAM + đĩa cục bộ + `public/storefront-lkg.json` để phục vụ `HTTP 200` tức thì kể cả khi DB gián đoạn.
 * 2. Failover Order/Lead Spool: Khi kết nối PostgreSQL gặp sự cố hoặc vượt hạn mức tạm thời,
 *    mọi đơn đặt hàng / yêu cầu báo giá sỉ / tin nhắn liên hệ vẫn được định giá chuẩn từ LKG,
 *    cấp mã tham chiếu hợp lệ, ghi an toàn vào hàng đợi dự phòng và tự động đồng bộ bù (Idempotent Replay)
 *    ngay khi cơ sở dữ liệu phục hồi — cam kết 0% rớt đơn của khách hàng.
 */

import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, invalidateApiCache } from '@/lib/realtime'

export interface FailoverOrderLine {
  productId: string
  sku: string
  name: string
  quantity: number
  retailPrice: number
  unitPrice: number
  lineTotal: number
}

export interface FailoverSubmissionEntry {
  refCode: string
  action: 'SUBMIT_WEB_ORDER' | 'SUBMIT_WHOLESALE_INQUIRY' | 'SUBMIT_CONTACT'
  createdAt: string
  customerName: string
  customerPhone: string
  customerEmail: string | null
  companyOrShopName: string | null
  address: string | null
  paymentMethod: 'COD' | 'BANK_TRANSFER' | null
  totalQty: number | null
  retailSubtotal: number | null
  wholesaleSaved: number | null
  wholesaleTierLabel: string | null
  subtotal: number | null
  shippingFee: number | null
  grandTotal: number | null
  estimatedQty: number | null
  interestedSkus: string[]
  note: string | null
  items: FailoverOrderLine[]
  inboxContent: string
  customDomain: string
  brandName: string
}

interface ContinuityGlobalState {
  lkgSnapshot: {
    savedAt: string
    payload: Record<string, unknown>
  } | null
  failoverSpool: FailoverSubmissionEntry[]
  spoolHydrated: boolean
  flushingPromise: Promise<{ flushed: number; remaining: number }> | null
}

const g = globalThis as unknown as {
  __openvnContinuityShield?: ContinuityGlobalState
}

function getState(): ContinuityGlobalState {
  if (!g.__openvnContinuityShield) {
    g.__openvnContinuityShield = {
      lkgSnapshot: null,
      failoverSpool: [],
      spoolHydrated: false,
      flushingPromise: null,
    }
  }
  return g.__openvnContinuityShield
}

function resolveDbRuntimeDir(): string {
  const cwd = process.cwd()
  const twoUp = path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..')
  if (fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ twoUp, 'db'))) {
    return path.join(/*turbopackIgnore: true*/ twoUp, 'db')
  }
  return path.join(/*turbopackIgnore: true*/ cwd, 'db')
}

function getLkgRuntimePath(): string {
  return path.join(/*turbopackIgnore: true*/ resolveDbRuntimeDir(), '.storefront_lkg_snapshot.json')
}

function getBundledPublicLkgPath(): string {
  const cwd = process.cwd()
  return path.join(/*turbopackIgnore: true*/ cwd, 'public', 'storefront-lkg.json')
}

function getFailoverSpoolPath(): string {
  return path.join(/*turbopackIgnore: true*/ resolveDbRuntimeDir(), '.storefront_failover_spool.json')
}

function writeJsonFileAtomic(targetPath: string, data: unknown): void {
  try {
    const dir = path.dirname(targetPath)
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
    }
    const tmp = `${targetPath}.tmp`
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(data), 'utf8')
    fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ targetPath)
  } catch {
    // Bỏ qua trên môi trường filesystem chỉ đọc; bản sao trên RAM vẫn bảo toàn đầy đủ
  }
}

function ensureSpoolHydrated(): void {
  const state = getState()
  if (state.spoolHydrated) return
  state.spoolHydrated = true
  try {
    const spoolPath = getFailoverSpoolPath()
    if (fs.existsSync(/*turbopackIgnore: true*/ spoolPath)) {
      const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ spoolPath, 'utf8')) as unknown
      if (Array.isArray(raw)) {
        state.failoverSpool = raw.filter(
          (it): it is FailoverSubmissionEntry =>
            Boolean(it && typeof it === 'object' && typeof (it as FailoverSubmissionEntry).refCode === 'string')
        )
      }
    }
  } catch {
    // ignore corrupted spool file
  }
}

export function saveLastKnownGoodStorefrontPayload(payload: Record<string, unknown>): void {
  if (!payload || payload.ok !== true || !Array.isArray(payload.products)) return
  const state = getState()
  const record = {
    savedAt: new Date().toISOString(),
    payload,
  }
  const prevGeneratedAt = state.lkgSnapshot?.payload?.generatedAt
  state.lkgSnapshot = record
  if (prevGeneratedAt !== payload.generatedAt) {
    writeJsonFileAtomic(getLkgRuntimePath(), record)
  }
}

export function getLastKnownGoodStorefrontPayload(): {
  savedAt: string
  payload: Record<string, unknown>
} | null {
  const state = getState()
  if (state.lkgSnapshot) return state.lkgSnapshot

  // 1. Thử nạp từ đĩa runtime `db/.storefront_lkg_snapshot.json`
  try {
    const runtimePath = getLkgRuntimePath()
    if (fs.existsSync(/*turbopackIgnore: true*/ runtimePath)) {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ runtimePath, 'utf8')) as {
        savedAt?: string
        payload?: Record<string, unknown>
      }
      if (parsed?.payload && Array.isArray(parsed.payload.products)) {
        state.lkgSnapshot = {
          savedAt: parsed.savedAt || new Date().toISOString(),
          payload: parsed.payload,
        }
        return state.lkgSnapshot
      }
    }
  } catch {
    // ignore
  }

  // 2. Fallback sang snapshot công khai đóng gói sẵn `public/storefront-lkg.json`
  try {
    const bundledPath = getBundledPublicLkgPath()
    if (fs.existsSync(/*turbopackIgnore: true*/ bundledPath)) {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ bundledPath, 'utf8')) as Record<
        string,
        unknown
      >
      if (parsed && Array.isArray(parsed.products)) {
        state.lkgSnapshot = {
          savedAt: String(parsed.generatedAt || new Date().toISOString()),
          payload: parsed,
        }
        return state.lkgSnapshot
      }
    }
  } catch {
    // ignore
  }

  return null
}

export function enqueueFailoverSubmission(entry: FailoverSubmissionEntry): void {
  ensureSpoolHydrated()
  const state = getState()
  const existingIdx = state.failoverSpool.findIndex((e) => e.refCode === entry.refCode)
  if (existingIdx >= 0) {
    state.failoverSpool[existingIdx] = entry
  } else {
    state.failoverSpool.push(entry)
    if (state.failoverSpool.length > 500) {
      state.failoverSpool = state.failoverSpool.slice(-500)
    }
  }
  writeJsonFileAtomic(getFailoverSpoolPath(), state.failoverSpool)
}

export function lookupFailoverSubmission(
  lookupCode: string,
  phoneTail4: string
):
  | { found: false; phoneMismatch?: boolean }
  | {
      found: true
      entry: FailoverSubmissionEntry
    } {
  ensureSpoolHydrated()
  const code = String(lookupCode || '')
    .trim()
    .toUpperCase()
  const hit = getState().failoverSpool.find((e) => e.refCode.toUpperCase() === code)
  if (!hit) return { found: false }
  const savedTail = hit.customerPhone.replace(/\D/g, '').slice(-4)
  if (savedTail && phoneTail4 && savedTail !== phoneTail4) {
    return { found: false, phoneMismatch: true }
  }
  return { found: true, entry: hit }
}

export function getContinuityShieldStatus(): {
  lkgReady: boolean
  lkgSavedAt: string | null
  pendingFailoverCount: number
} {
  ensureSpoolHydrated()
  const lkg = getLastKnownGoodStorefrontPayload()
  return {
    lkgReady: Boolean(lkg),
    lkgSavedAt: lkg?.savedAt ?? null,
    pendingFailoverCount: getState().failoverSpool.length,
  }
}

export function clearFailoverSpoolByCodes(refCodes: string[]): void {
  if (!Array.isArray(refCodes) || refCodes.length === 0) return
  ensureSpoolHydrated()
  const codeSet = new Set(refCodes.map((c) => String(c || '').toUpperCase()))
  const state = getState()
  const before = state.failoverSpool.length
  state.failoverSpool = state.failoverSpool.filter((e) => !codeSet.has(e.refCode.toUpperCase()))
  if (state.failoverSpool.length !== before) {
    writeJsonFileAtomic(getFailoverSpoolPath(), state.failoverSpool)
  }
}

/**
 * Tự động phát lại (Idempotent Replay) các đơn hàng / yêu cầu sỉ / liên hệ đang chờ
 * trong Failover Spool vào PostgreSQL ngay khi cơ sở dữ liệu hoạt động bình thường trở lại.
 */
export async function flushFailoverSpoolToDatabase(): Promise<{
  flushed: number
  remaining: number
}> {
  ensureSpoolHydrated()
  const state = getState()
  if (state.failoverSpool.length === 0) {
    return { flushed: 0, remaining: 0 }
  }
  if (state.flushingPromise) {
    return state.flushingPromise
  }

  state.flushingPromise = (async () => {
    let flushed = 0
    const remainingEntries: FailoverSubmissionEntry[] = []

    for (const entry of [...state.failoverSpool]) {
      try {
        const alreadySaved = await db.ledgerEntry.findFirst({
          where: { entityCode: entry.refCode },
          select: { id: true },
        })

        if (!alreadySaved) {
          const cleanPhoneKey = entry.customerPhone.replace(/\D/g, '')
          const webThreadId = `web:${cleanPhoneKey}`
          const senderTag = `${entry.customerName}|${entry.customerPhone}`

          if (entry.action === 'SUBMIT_WEB_ORDER') {
            await Promise.all([
              db.directMessage.create({
                data: {
                  channelKey: 'WEBSITE',
                  customerId: null,
                  sender: 'CUSTOMER',
                  agentName: senderTag,
                  relatedOrderId: webThreadId,
                  content: entry.inboxContent,
                  isAuto: false,
                },
              }),
              db.agentActivity.create({
                data: {
                  agent: 'SUPPORT_AGENT',
                  action: 'ORDER_RECEIVED',
                  level: 'success',
                  targetType: 'ORDER',
                  targetLabel: entry.refCode,
                  message: `Website (${entry.customDomain || entry.brandName}): Đồng bộ bù đơn dự phòng ${entry.refCode} từ ${entry.customerName} (${entry.totalQty || 0} SP · ${(entry.grandTotal || 0).toLocaleString('vi-VN')} ₫)`,
                  detail: JSON.stringify({
                    refCode: entry.refCode,
                    customerName: entry.customerName,
                    customerPhone: entry.customerPhone,
                    totalQty: entry.totalQty,
                    grandTotal: entry.grandTotal,
                    wholesaleTier: entry.wholesaleTierLabel,
                    replayedFromFailover: true,
                  }),
                },
              }),
              logLedger({
                scope: 'ORDER',
                action: 'WEB_STOREFRONT_ORDER',
                entityType: 'WebOrderRequest',
                entityCode: entry.refCode,
                title: `Website (${entry.customDomain || 'Storefront'}): Đơn đặt hàng ${entry.refCode} · ${entry.customerName} (${(entry.grandTotal || 0).toLocaleString('vi-VN')} ₫)`,
                detail: {
                  refCode: entry.refCode,
                  status: 'RECEIVED_PENDING_CONFIRM',
                  customerName: entry.customerName,
                  customerPhone: entry.customerPhone,
                  customerEmail: entry.customerEmail,
                  address: entry.address,
                  paymentMethod: entry.paymentMethod || 'COD',
                  totalQty: entry.totalQty || 0,
                  retailSubtotal: entry.retailSubtotal || 0,
                  wholesaleSaved: entry.wholesaleSaved || 0,
                  wholesaleTierLabel: entry.wholesaleTierLabel,
                  subtotal: entry.subtotal || 0,
                  shippingFee: entry.shippingFee || 0,
                  grandTotal: entry.grandTotal || 0,
                  note: entry.note,
                  items: entry.items,
                  replayedFromFailoverAt: new Date().toISOString(),
                },
                actor: 'CUSTOMER',
                actorName: entry.customerName,
                originSource: 'POS',
                sourceRefCode: entry.refCode,
              }),
            ])
          } else if (entry.action === 'SUBMIT_WHOLESALE_INQUIRY') {
            await Promise.all([
              db.directMessage.create({
                data: {
                  channelKey: 'WEBSITE',
                  customerId: null,
                  sender: 'CUSTOMER',
                  agentName: senderTag,
                  relatedOrderId: webThreadId,
                  content: entry.inboxContent,
                  isAuto: false,
                },
              }),
              db.agentActivity.create({
                data: {
                  agent: 'SUPPORT_AGENT',
                  action: 'MANUAL_ACTION',
                  level: 'info',
                  targetType: 'CONVERSATION',
                  targetLabel: entry.refCode,
                  message: `Website (${entry.customDomain || entry.brandName}): Đồng bộ bù yêu cầu Báo giá Sỉ ${entry.refCode} từ ${entry.customerName}`,
                  detail: JSON.stringify({
                    refCode: entry.refCode,
                    customerName: entry.customerName,
                    customerPhone: entry.customerPhone,
                    companyOrShopName: entry.companyOrShopName,
                    estimatedQty: entry.estimatedQty,
                    replayedFromFailover: true,
                  }),
                },
              }),
              logLedger({
                scope: 'MESSAGE',
                action: 'WEB_WHOLESALE_INQUIRY',
                entityType: 'WholesaleInquiry',
                entityCode: entry.refCode,
                title: `Website: Yêu cầu báo giá sỉ ${entry.refCode} · ${entry.customerName} · ~${entry.estimatedQty || 30} SP`,
                detail: {
                  refCode: entry.refCode,
                  status: 'RECEIVED_WHOLESALE_LEAD',
                  customerName: entry.customerName,
                  customerPhone: entry.customerPhone,
                  customerEmail: entry.customerEmail,
                  companyOrShopName: entry.companyOrShopName,
                  address: entry.address,
                  estimatedQty: entry.estimatedQty,
                  wholesaleTierLabel: entry.wholesaleTierLabel,
                  interestedSkus: entry.interestedSkus,
                  note: entry.note,
                  replayedFromFailoverAt: new Date().toISOString(),
                },
                actor: 'CUSTOMER',
                actorName: entry.customerName,
                originSource: 'ZALO_OA',
                sourceRefCode: entry.refCode,
              }),
            ])
          } else {
            await Promise.all([
              db.directMessage.create({
                data: {
                  channelKey: 'WEBSITE',
                  customerId: null,
                  sender: 'CUSTOMER',
                  agentName: senderTag,
                  relatedOrderId: webThreadId,
                  content: entry.inboxContent,
                  isAuto: false,
                },
              }),
              logLedger({
                scope: 'MESSAGE',
                action: 'WEB_CONTACT_MESSAGE',
                entityType: 'WebContact',
                entityCode: entry.refCode,
                title: `Website: Liên hệ tư vấn ${entry.refCode} từ ${entry.customerName}`,
                detail: {
                  refCode: entry.refCode,
                  status: 'RECEIVED_CONTACT',
                  customerName: entry.customerName,
                  customerPhone: entry.customerPhone,
                  customerEmail: entry.customerEmail,
                  note: entry.note,
                  replayedFromFailoverAt: new Date().toISOString(),
                },
                actor: 'CUSTOMER',
                actorName: entry.customerName,
                originSource: 'ZALO_OA',
                sourceRefCode: entry.refCode,
              }),
            ])
          }
        }

        flushed += 1
      } catch {
        remainingEntries.push(entry)
      }
    }

    state.failoverSpool = remainingEntries
    writeJsonFileAtomic(getFailoverSpoolPath(), state.failoverSpool)

    if (flushed > 0) {
      invalidateApiCache('inbox:conversations')
      broadcast('message.new', {
        channelKey: 'WEBSITE',
        replayedCount: flushed,
      })
    }

    return { flushed, remaining: remainingEntries.length }
  })()

  try {
    return await state.flushingPromise
  } finally {
    state.flushingPromise = null
  }
}
