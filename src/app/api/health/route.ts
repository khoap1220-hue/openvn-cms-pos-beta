import { NextRequest, NextResponse } from 'next/server'
import {
  flushFailoverSpoolToDatabase,
  getContinuityShieldStatus,
} from '@/lib/continuity-shield'
import { db } from '@/lib/db'
import { ensureMaintenanceStateHydrated } from '@/lib/settings'

export const dynamic = 'force-dynamic'

function buildHealthCorsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')?.trim()
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildHealthCorsHeaders(req),
  })
}

export async function GET(req: NextRequest) {
  const headers = buildHealthCorsHeaders(req)
  const maintenance = await ensureMaintenanceStateHydrated()
  const probeDb = req.nextUrl.searchParams.get('probe') === 'db'

  let dbReachable: boolean | null = null
  let failoverReplay: { flushed: number; remaining: number } | null = null

  if (probeDb) {
    try {
      // Nhịp tim siêu nhẹ (< 100 bytes) chống Supabase Free tự động Pause sau 7 ngày không hoạt động
      await db.$queryRawUnsafe('SELECT 1 AS alive')
      dbReachable = true
      const statusBefore = getContinuityShieldStatus()
      if (statusBefore.pendingFailoverCount > 0) {
        failoverReplay = await flushFailoverSpoolToDatabase()
      }
    } catch {
      dbReachable = false
    }
  }

  const continuity = getContinuityShieldStatus()

  return NextResponse.json(
    {
      status: dbReachable === false ? 'degraded_failover_ready' : 'ok',
      timestamp: new Date().toISOString(),
      service: 'openvn-cms-backend',
      uptime: process.uptime(),
      maintenanceMode: maintenance.enabled,
      ...(probeDb ? { dbReachable } : {}),
      ...(failoverReplay ? { failoverReplay } : {}),
      continuity,
    },
    { headers }
  )
}
