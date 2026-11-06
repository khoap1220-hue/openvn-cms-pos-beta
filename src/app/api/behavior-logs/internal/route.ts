import { NextRequest, NextResponse } from 'next/server'
import { verifyInternalAuditPayload } from '@/lib/auth'
import {
  type BehaviorLogInput,
  ensureIamSeeded,
  recordBehaviorLog,
} from '@/lib/behavior-server'

export const dynamic = 'force-dynamic'

// POST /api/behavior-logs/internal — Endpoint nội bộ nhận nhật ký API Mutation & 403 RBAC từ src/proxy.ts (bảo vệ bằng chữ ký HMAC)
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text()
    const sig = req.headers.get('x-internal-audit-sig')
    const valid = await verifyInternalAuditPayload(rawBody, sig)
    if (!valid) {
      return NextResponse.json({ error: 'Chữ ký kiểm toán nội bộ không hợp lệ' }, { status: 403 })
    }

    await ensureIamSeeded()
    const payload = JSON.parse(rawBody) as BehaviorLogInput
    await recordBehaviorLog(payload)

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Internal behavior-log POST error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
