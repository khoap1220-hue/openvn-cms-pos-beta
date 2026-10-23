// SETTINGS — cấu hình hệ thống lưu tại bảng AppSetting (key-value).
// Mọi thay đổi đều broadcast 'settings.updated' để UI refresh realtime.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

/** Đọc 1 setting theo key — trả về null nếu chưa có */
export async function getSetting(key: string): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } })
  return row?.value ?? null
}

/** Đọc nhiều setting một lần — trả về map { key: value } (thiếu key nào thì không có trong map) */
export async function getSettings(keys: string[]): Promise<Record<string, string>> {
  if (keys.length === 0) return {}
  const rows = await db.appSetting.findMany({ where: { key: { in: keys } } })
  const out: Record<string, string> = {}
  for (const row of rows) out[row.key] = row.value
  return out
}

/** Ghi (upsert) 1 setting + broadcast để client refresh */
export async function setSetting(key: string, value: string): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
  broadcast('settings.updated', { reason: 'settings', keys: [key] })
}
