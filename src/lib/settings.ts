// SETTINGS — cấu hình hệ thống lưu tại bảng AppSetting (key-value).
// Mọi thay đổi đều broadcast 'settings.updated' để UI refresh realtime.

import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import {
  type MaintenanceMemoryState,
  broadcast,
  getMaintenanceMemoryState,
  setMaintenanceMemoryState,
} from '@/lib/realtime'

const DEFAULT_MAINTENANCE_REASON =
  'Hệ thống đang trong chế độ Bảo trì Nâng cấp An toàn (Read-Only). Vui lòng thử lại sau ít phút.'

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  const twoUp = path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..')
  if (fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ twoUp, 'db', 'custom.db'))) return twoUp
  return cwd
}

const MAINTENANCE_STATE_FILE = path.join(/*turbopackIgnore: true*/ resolveWorkspaceRoot(), 'db', '.maintenance_state.json')

export function writeMaintenanceStateFile(state: {
  enabled: boolean
  reason: string
  retryAfterSec: number
  updatedAt: string
}): void {
  try {
    const dir = path.dirname(MAINTENANCE_STATE_FILE)
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
    const tmp = `${MAINTENANCE_STATE_FILE}.tmp`
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ MAINTENANCE_STATE_FILE)
  } catch {
    // Bỏ qua nếu hệ thống tệp tin chỉ đọc trên môi trường serverless
  }
}

/** Đồng bộ trạng thái bảo trì từ tệp trạng thái db/.maintenance_state.json lên bộ nhớ RAM L1 (không gây khóa CSDL khi nâng cấp) */
export async function ensureMaintenanceStateHydrated(): Promise<MaintenanceMemoryState> {
  const current = getMaintenanceMemoryState()
  if (current.hydrated) return current
  try {
    if (fs.existsSync(/*turbopackIgnore: true*/ MAINTENANCE_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ MAINTENANCE_STATE_FILE, 'utf8')) as Partial<MaintenanceMemoryState>
      const enabled = Boolean(parsed.enabled) || process.env.CMS_MAINTENANCE_MODE === 'true'
      const retryAfterSec = Math.max(10, Math.min(3600, Number(parsed.retryAfterSec) || 120))
      return setMaintenanceMemoryState({
        enabled,
        reason: typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : DEFAULT_MAINTENANCE_REASON,
        retryAfterSec,
        updatedAt: parsed.updatedAt ?? null,
        hydrated: true,
      })
    }
    return setMaintenanceMemoryState({
      enabled: process.env.CMS_MAINTENANCE_MODE === 'true',
      reason: DEFAULT_MAINTENANCE_REASON,
      retryAfterSec: 120,
      hydrated: true,
    })
  } catch {
    return setMaintenanceMemoryState({ hydrated: true })
  }
}

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

/** Ghi hàng loạt nhiều setting: chỉ ghi các key thực sự thay đổi song song (Promise.all) + broadcast 1 lần */
export async function setSettingsBatch(
  updates: Array<{ key: string; value: string }>,
  existingValues?: Record<string, string | boolean> | null
): Promise<void> {
  if (updates.length === 0) return
  const changed = existingValues
    ? updates.filter((u) => u.key === 'gemini_api_key' || String(existingValues[u.key] ?? '') !== u.value)
    : updates
  if (changed.length > 0) {
    await Promise.all(
      changed.map((u) =>
        db.appSetting.upsert({
          where: { key: u.key },
          create: { key: u.key, value: u.value },
          update: { value: u.value },
        })
      )
    )
  }
  broadcast('settings.updated', { reason: 'settings', keys: updates.map((u) => u.key) })
}
