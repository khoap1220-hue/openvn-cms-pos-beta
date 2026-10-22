import { NextRequest, NextResponse } from 'next/server'
import { getSettingsMap, setSetting } from '@/lib/agent-engine'
import { AUTOMATION_DEFS } from '@/lib/agents'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await getSettingsMap()
    return NextResponse.json({ settings, defs: AUTOMATION_DEFS })
  } catch (error) {
    console.error('Autopilot GET error:', error)
    return NextResponse.json({ error: 'Không thể tải cấu hình tự động hóa' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { key?: string; enabled?: boolean }
    const key = body.key
    const enabled = Boolean(body.enabled)
    if (!key || !AUTOMATION_DEFS.some((d) => d.key === key)) {
      return NextResponse.json({ error: 'Key cấu hình không hợp lệ' }, { status: 400 })
    }
    await setSetting(key, enabled)
    const settings = await getSettingsMap()
    return NextResponse.json({ ok: true, settings })
  } catch (error) {
    console.error('Autopilot PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật cấu hình' }, { status: 500 })
  }
}
