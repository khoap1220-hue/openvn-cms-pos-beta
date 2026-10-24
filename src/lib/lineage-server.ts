// Helper phía server cho DATA PROVENANCE — tính metadata lineage cho 1 loạt entity
// (changeCount = số lần từng sửa theo Sổ Data, originSource = nguồn gốc của bản gốc).

import { db } from '@/lib/db'

export interface LineageMeta {
  changeCount: number
  originSource: string | null
}

/**
 * Trả về Map entityId → { changeCount, originSource } cho các entity cùng loại.
 * - changeCount: số LedgerEntry có changedFields của entity đó
 * - originSource: originSource của bản gốc (entry khởi tạo có afterSnapshot, không có changedFields);
 *   nếu không có bản gốc thì lấy của entry sớm nhất.
 */
export async function getLineageMeta(entityType: string, entityIds: string[]): Promise<Map<string, LineageMeta>> {
  const result = new Map<string, LineageMeta>()
  if (entityIds.length === 0) return result

  const entries = await db.ledgerEntry.findMany({
    where: { entityType, entityId: { in: entityIds } },
    orderBy: { createdAt: 'asc' },
    select: { entityId: true, originSource: true, changedFields: true, afterSnapshot: true },
  })

  for (const id of entityIds) result.set(id, { changeCount: 0, originSource: null })

  for (const e of entries) {
    if (!e.entityId) continue
    const meta = result.get(e.entityId)
    if (!meta) continue
    if (e.changedFields) meta.changeCount += 1
    if (!meta.originSource && e.originSource) meta.originSource = e.originSource
  }

  // Ưu tiên originSource của BẢN GỐC (entry khởi tạo) thay vì entry sớm nhất bất kỳ
  for (const e of entries) {
    if (!e.entityId || !e.originSource || e.changedFields || !e.afterSnapshot) continue
    const meta = result.get(e.entityId)
    if (meta) meta.originSource = e.originSource
  }

  return result
}
