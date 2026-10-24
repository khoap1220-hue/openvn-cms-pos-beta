// SỔ DATA — sổ cái tổng của toàn hệ thống.
// Nguyên tắc: BẤT KỲ dữ liệu & thao tác gì cũng phải ghi vào đây.
// Fire-and-forget an toàn: lỗi ghi sổ không được làm hỏng nghiệp vụ chính.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

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
}

export async function logLedger(input: LedgerInput): Promise<void> {
  try {
    await db.ledgerEntry.create({
      data: {
        scope: input.scope,
        action: input.action,
        title: input.title,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        entityCode: input.entityCode ?? null,
        detail: input.detail != null ? JSON.stringify(input.detail) : null,
        actor: input.actor ?? 'SYSTEM',
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
