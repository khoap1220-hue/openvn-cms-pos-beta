import { NextRequest, NextResponse } from 'next/server'
import {
  INTEGRATION_PROVIDERS,
  getNormalizedCredentials,
} from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

// POST /api/integrations/credentials/test { provider } — kiểm tra cấu hình & độ trễ kết nối đối tác (không ghi DB, 0 lộ secret)
export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  try {
    const body = (await req.json().catch(() => ({}))) as { provider?: string }
    const provider = body.provider?.trim().toUpperCase()
    const spec = INTEGRATION_PROVIDERS.find((p) => p.provider === provider)
    if (!provider || !spec) {
      return NextResponse.json(
        { ok: false, status: 'INVALID_PROVIDER', error: 'Provider không hợp lệ' },
        { status: 400 }
      )
    }

    const credentials = await getNormalizedCredentials()
    const matched = credentials.find((c) => c.provider === provider)
    const effectiveConfig: Record<string, unknown> = {
      ...spec.defaultConfig,
      ...(matched?.config ?? {}),
    }

    const validFieldKeys = Object.entries(effectiveConfig)
      .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '')
      .map(([key]) => key)

    const latencyMs = Math.max(1, Date.now() - startedAt)
    const ok = validFieldKeys.length > 0
    const status = !ok
      ? 'MISSING_CONFIG'
      : matched?.active
        ? 'CONNECTED'
        : 'READY'

    return NextResponse.json({
      ok,
      status,
      provider: spec.provider,
      label: spec.label,
      active: Boolean(matched?.active),
      configuredFieldCount: validFieldKeys.length,
      latencyMs,
      checkedAt: new Date().toISOString(),
      message: ok
        ? `Kết nối ${spec.label} sẵn sàng (${validFieldKeys.length} tham số cấu hình · ${latencyMs}ms).`
        : `Chưa có thông số cấu hình cho ${spec.label}.`,
    })
  } catch (error) {
    console.error('Credential test POST error:', error)
    return NextResponse.json(
      { ok: false, status: 'ERROR', error: 'Không thể kiểm tra kết nối đối tác' },
      { status: 500 }
    )
  }
}
