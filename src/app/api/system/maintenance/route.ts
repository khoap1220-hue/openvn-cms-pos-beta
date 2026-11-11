import { NextRequest, NextResponse } from 'next/server'
import {
  broadcast,
  invalidateApiCache,
  setMaintenanceMemoryState,
} from '@/lib/realtime'
import {
  ensureMaintenanceStateHydrated,
  writeMaintenanceStateFile,
} from '@/lib/settings'

export const dynamic = 'force-dynamic'

const DEFAULT_REASON =
  'Hệ thống đang trong chế độ Bảo trì Nâng cấp An toàn (Read-Only). Vui lòng thử lại sau ít phút.'

// GET /api/system/maintenance — Kiểm tra trạng thái Chế độ Bảo trì Nâng cấp An toàn (Read-Only Drain)
export async function GET() {
  const state = await ensureMaintenanceStateHydrated()
  return NextResponse.json({
    ok: true,
    enabled: state.enabled,
    reason: state.reason,
    retryAfterSec: state.retryAfterSec,
    updatedAt: state.updatedAt,
  })
}

// POST / PATCH /api/system/maintenance — Bật / Tắt Chế độ Bảo trì Read-Only trên nhánh chính (Zero DB Lock)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      enabled?: boolean
      reason?: string
      retryAfterSec?: number
    }

    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: 'Trường enabled (boolean) là bắt buộc' },
        { status: 400 }
      )
    }

    const enabled = body.enabled
    const reason = String(body.reason ?? DEFAULT_REASON).trim().slice(0, 300) || DEFAULT_REASON
    const retryAfterSec = Math.max(10, Math.min(3600, Math.floor(Number(body.retryAfterSec) || 120)))
    const updatedAt = new Date().toISOString()

    writeMaintenanceStateFile({ enabled, reason, retryAfterSec, updatedAt })

    const nextState = setMaintenanceMemoryState({
      enabled,
      reason,
      retryAfterSec,
      updatedAt,
      hydrated: true,
    })
    invalidateApiCache('settings:')
    broadcast('settings.updated', {
      reason: 'maintenance',
      maintenanceMode: enabled,
      retryAfterSec,
      updatedAt,
    })

    return NextResponse.json({
      ok: true,
      enabled: nextState.enabled,
      reason: nextState.reason,
      retryAfterSec: nextState.retryAfterSec,
      updatedAt: nextState.updatedAt,
    })
  } catch (error) {
    console.error('Maintenance mode toggle error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể cập nhật trạng thái bảo trì hệ thống' },
      { status: 500 }
    )
  }
}

export const PATCH = POST
export const PUT = POST
