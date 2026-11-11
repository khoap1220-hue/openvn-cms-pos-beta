import { NextResponse } from 'next/server'
import { ensureMaintenanceStateHydrated } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  const maintenance = await ensureMaintenanceStateHydrated()
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'openvn-cms-backend',
    uptime: process.uptime(),
    maintenanceMode: maintenance.enabled,
  })
}
