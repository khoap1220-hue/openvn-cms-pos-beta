import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getApiCache, setApiCache } from '@/lib/realtime'
import {
  WEBHOOK_EVENTS,
  ensureIntegrationsSeeded,
  getNormalizedCredentials,
} from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

function maskSecretText(val: unknown): string {
  const s = typeof val === 'string' ? val.trim() : ''
  if (!s) return ''
  if (s.length <= 6) return '••••••••'
  return `${s.slice(0, 3)}••••••••${s.slice(-3)}`
}

function maskCredentialConfig(cfg: unknown): unknown {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return cfg
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg as Record<string, unknown>)) {
    if (
      typeof v === 'string' &&
      v.trim() !== '' &&
      /(secret|token|key|password|cookie|spc_|cipher)/i.test(k)
    ) {
      out[k] = maskSecretText(v)
    } else {
      out[k] = v
    }
  }
  return out
}

// GET /api/integrations — tổng hợp một lần toàn bộ cấu hình tích hợp (đã che mặt nạ các khóa bí mật)
export async function GET() {
  try {
    const cached = getApiCache<Record<string, unknown>>('integrations:main')
    if (cached) {
      return NextResponse.json(cached)
    }

    await ensureIntegrationsSeeded()

    const [apiKeys, webhooks, credentials, deliveriesSuccess, deliveriesFailed] = await Promise.all([
      db.apiKey.findMany({ orderBy: { createdAt: 'desc' } }),
      db.webhookEndpoint.findMany({
        orderBy: { createdAt: 'desc' },
        include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5 } },
      }),
      getNormalizedCredentials(),
      db.webhookDelivery.count({ where: { status: 'SUCCESS' } }),
      db.webhookDelivery.count({ where: { status: 'FAILED' } }),
    ])

    const safeApiKeys = apiKeys.map((k) => ({
      ...k,
      key: maskSecretText(k.key),
      secret: maskSecretText(k.secret),
    }))
    const safeWebhooks = webhooks.map((w) => ({
      ...w,
      secret: maskSecretText(w.secret),
    }))
    const safeCredentials = credentials.map((c) => ({
      ...c,
      config: maskCredentialConfig(c.config),
    }))

    const payload = {
      apiKeys: safeApiKeys,
      webhooks: safeWebhooks,
      credentials: safeCredentials,
      events: WEBHOOK_EVENTS,
      inboundUrl: '/api/webhooks/inbound',
      stats: {
        deliveriesSuccess,
        deliveriesFailed,
        endpoints: webhooks.length,
        keysActive: apiKeys.filter((k) => k.active).length,
      },
    }
    setApiCache('integrations:main', payload, 30_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Integrations GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu tích hợp' }, { status: 500 })
  }
}
