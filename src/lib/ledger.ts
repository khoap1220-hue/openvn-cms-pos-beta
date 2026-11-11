// SỔ DATA — sổ cái tổng của toàn hệ thống.
// Nguyên tắc: BẤT KỲ dữ liệu & thao tác gì cũng phải ghi vào đây.
// Fire-and-forget an toàn: lỗi ghi sổ không được làm hỏng nghiệp vụ chính.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { ACTOR_NAME_DEFAULTS, type OriginSource } from '@/lib/lineage'

export type LedgerScope =
  | 'ORDER'
  | 'INVOICE'
  | 'INVENTORY'
  | 'AGENT'
  | 'WEBHOOK'
  | 'PARTNER'
  | 'BOM'
  | 'AFTERSALES'
  | 'PERIOD'
  | 'SETTINGS'
  | 'CHANNEL'
  | 'MESSAGE'
  | 'CUSTOMER'
  | 'CAMPAIGN'
  | 'SYSTEM'

export interface LedgerInput {
  scope: LedgerScope
  action: string
  title: string
  entityType?: string
  entityId?: string
  entityCode?: string
  detail?: unknown
  actor?: 'AGENT' | 'OPERATOR' | 'SYSTEM' | 'CUSTOMER' | 'API'
  // ===== DATA PROVENANCE (tùy chọn — recordLineageChange sẽ tự điền) =====
  originSource?: OriginSource
  actorName?: string
  sourceRefCode?: string
  beforeSnapshot?: Record<string, unknown> | null
  afterSnapshot?: Record<string, unknown> | null
  changedFields?: string[] | null
}

async function resolveRequestMeta(): Promise<{ operatorLabel: string | null; isAutomatedTest: boolean }> {
  try {
    const mod = await import('next/headers')
    const h = await mod.headers()
    const isTest = h.get('x-test-run') === 'true' || h.get('x-non-human-test') === 'true'
    const rawName = h.get('x-staff-name')
    const rawRole = h.get('x-staff-role')
    if (rawName) {
      const decoded = decodeURIComponent(rawName)
      return { operatorLabel: rawRole ? `${decoded} [${rawRole}]` : decoded, isAutomatedTest: isTest }
    }
    return { operatorLabel: null, isAutomatedTest: isTest }
  } catch {
    // Đang chạy ngoài ngữ cảnh Next.js HTTP Request (VD: Agent timer hoặc CLI script)
  }
  return { operatorLabel: null, isAutomatedTest: false }
}

export async function logLedger(input: LedgerInput): Promise<void> {
  try {
    const reqMeta = await resolveRequestMeta()
    let resolvedActorName = input.actorName ?? null
    if (
      (!resolvedActorName ||
        resolvedActorName === 'Người vận hành' ||
        resolvedActorName === 'Quản trị viên') &&
      (input.actor === 'OPERATOR' || !input.actor)
    ) {
      if (reqMeta.operatorLabel) resolvedActorName = reqMeta.operatorLabel
    }

    // Tự động gắn direction = 'CMS_TO_CMS' cho các thao tác nội bộ trên CMS chưa có direction
    let finalDetail = input.detail
    const titleUpper = (input.title || '').toUpperCase()
    const isCrossChannelTitle =
      titleUpper.includes('SÀN SHOPEE ➔ CMS') ||
      titleUpper.includes('CMS ➔ SÀN') ||
      titleUpper.includes('CMS ➔ SHOPEE') ||
      titleUpper.includes('SÀN ➔ SÀN') ||
      titleUpper.includes('SÀN SHOPEE ➔ SÀN SHOPEE')
    if (
      !isCrossChannelTitle &&
      (input.actor === 'OPERATOR' ||
        input.originSource === 'MANUAL_ADMIN' ||
        input.originSource === 'POS' ||
        input.originSource === 'BARCODE_SCAN' ||
        input.scope === 'INVENTORY' ||
        input.scope === 'INVOICE' ||
        input.scope === 'CAMPAIGN' ||
        input.scope === 'SETTINGS' ||
        input.scope === 'PERIOD')
    ) {
      if (finalDetail && typeof finalDetail === 'object' && !Array.isArray(finalDetail)) {
        const dObj = finalDetail as Record<string, unknown>
        if (!dObj.direction) {
          finalDetail = { direction: 'CMS_TO_CMS', ...dObj }
        }
      } else if (finalDetail == null) {
        finalDetail = { direction: 'CMS_TO_CMS' }
      }
    }

    const finalActor = reqMeta.isAutomatedTest ? 'TEST' : (input.actor ?? 'SYSTEM')

    await db.ledgerEntry.create({
      data: {
        scope: input.scope,
        action: input.action,
        title: input.title,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        entityCode: input.entityCode ?? null,
        detail: finalDetail != null ? JSON.stringify(finalDetail) : null,
        actor: finalActor,
        originSource: input.originSource ?? null,
        actorName: resolvedActorName,
        sourceRefCode: input.sourceRefCode ?? null,
        beforeSnapshot: input.beforeSnapshot ? JSON.stringify(input.beforeSnapshot) : null,
        afterSnapshot: input.afterSnapshot ? JSON.stringify(input.afterSnapshot) : null,
        changedFields: input.changedFields && input.changedFields.length ? JSON.stringify(input.changedFields) : null,
      },
    })
    broadcast('ledger.new', {
      scope: input.scope,
      action: input.action,
      title: input.title,
      actor: input.actor ?? 'SYSTEM',
      at: new Date().toISOString(),
    })
  } catch {
    // Sổ Data lỗi ghi tạm thời — không chặn nghiệp vụ (dev/DB busy).
  }
}

// Bản ghi bất đồng bộ không cần chờ (dùng trong hot-path như Agent engine)
export function logLedgerAsync(input: LedgerInput): void {
  void logLedger(input)
}

// ============================================================
// DATA PROVENANCE — chụp beforeSnapshot → afterSnapshot tự động
// ============================================================

export interface LineageChangeInput {
  scope: LedgerScope
  action: string
  title: string
  entityType: string
  entityId: string
  entityCode?: string
  /** Trạng thái trước khi sửa — null/undefined = bản ghi khởi tạo (Nguyên bản) */
  before?: Record<string, unknown> | null
  /** Trạng thái sau khi sửa / trạng thái gốc khi tạo mới */
  after?: Record<string, unknown> | null
  actor?: LedgerInput['actor']
  actorName?: string
  originSource?: OriginSource
  /** Mã chứng từ gốc liên kết (mặc định = entityCode) */
  sourceRefCode?: string
  detail?: unknown
  /** Không tự suy luận nguồn gốc khi đã truyền originSource */
}

/** So sánh 2 snapshot → danh sách trường thay đổi (union các key có giá trị khác nhau) */
export function diffChangedFields(
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null
): string[] {
  if (!before || !after) return []
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  const changed: string[] = []
  for (const key of keys) {
    const a = before[key]
    const b = after[key]
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changed.push(key)
  }
  return changed
}

/** Suy luận nguồn gốc dữ liệu từ actor + ngữ cảnh khi caller không chỉ định */
export function inferOriginSource(opts: {
  actor?: LedgerInput['actor']
  action?: string
  channelKey?: string
}): OriginSource {
  const action = (opts.action ?? '').toUpperCase()
  if (opts.channelKey) {
    const ck = opts.channelKey.toUpperCase()
    if (ck.includes('SHOPEE')) return 'SHOPEE_SYNC'
    if (ck.includes('ZALO')) return 'ZALO_OA'
    if (ck === 'POS' || ck.includes('POS')) return 'POS'
    if (ck === 'WEBSITE' || ck.includes('FACEBOOK') || ck.includes('APP')) return 'MARKETPLACE_SYNC'
    // LAZADA / TIKTOK / TIKI / sàn khác
    if (ck) return 'MARKETPLACE_SYNC'
  }
  if (action.includes('SEED') || action.includes('MIGRAT') || action.includes('RECALC') || action.includes('CLEAN')) {
    return 'SYSTEM_SEED'
  }
  if (opts.actor === 'AGENT') return 'AGENT_AUTOPILOT'
  if (opts.actor === 'API') return 'SHOPEE_SYNC'
  if (opts.actor === 'OPERATOR') return 'MANUAL_ADMIN'
  return 'SYSTEM_SEED'
}

/** Tên hiển thị của actor — dùng khi caller không truyền actorName */
export function defaultActorName(actor?: string, action?: string): string {
  const a = (action ?? '').toUpperCase()
  if (actor === 'AGENT') {
    if (a.includes('CONFIRM')) return 'Agent Tư vấn'
    if (a.includes('CARRIER') || a.includes('PICKUP') || a.includes('TRANSIT') || a.includes('SHIP') || a.includes('COD') || a.includes('STOCK')) return 'Agent Kho vận'
    if (a.includes('CARE') || a.includes('DELIVERY')) return 'Agent CSKH'
    if (a.includes('REVIEW')) return 'Agent Đánh giá'
    if (a.includes('REPLY') || a.includes('MESSAGE') || a.includes('REACTION')) return 'Agent Hỗ trợ 24/7'
    return ACTOR_NAME_DEFAULTS.AGENT
  }
  if (actor === 'OPERATOR') return ACTOR_NAME_DEFAULTS.OPERATOR
  if (actor === 'API') return ACTOR_NAME_DEFAULTS.API
  if (actor === 'CUSTOMER') return ACTOR_NAME_DEFAULTS.CUSTOMER
  return ACTOR_NAME_DEFAULTS.SYSTEM
}

/**
 * Ghi một bản ghi lineage vào Sổ Data: tự diff before → after,
 * tự suy luận originSource / actorName / sourceRefCode khi không truyền.
 * - before = null → bản ghi khởi tạo (changedFields = null, hiển thị 'Nguyên bản')
 * - before & after giống nhau → không ghi (tránh nhiễu sổ)
 */
export async function recordLineageChange(input: LineageChangeInput): Promise<void> {
  try {
    const isCreation = !input.before
    const changedFields = isCreation ? null : diffChangedFields(input.before, input.after)
    if (!isCreation && input.after && changedFields && changedFields.length === 0) return // không có gì thay đổi

    const originSource = input.originSource ?? inferOriginSource({ actor: input.actor, action: input.action })
    const actorName = input.actorName ?? defaultActorName(input.actor, input.action)
    await logLedger({
      scope: input.scope,
      action: input.action,
      title: input.title,
      entityType: input.entityType,
      entityId: input.entityId,
      entityCode: input.entityCode,
      detail: input.detail,
      actor: input.actor,
      originSource,
      actorName,
      sourceRefCode: input.sourceRefCode ?? input.entityCode,
      beforeSnapshot: isCreation ? null : input.before ?? null,
      afterSnapshot: input.after ?? null,
      changedFields,
    })
  } catch {
    // lineage lỗi — không chặn nghiệp vụ
  }
}

export function recordLineageChangeAsync(input: LineageChangeInput): void {
  void recordLineageChange(input)
}
