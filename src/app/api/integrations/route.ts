import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getApiCache, setApiCache } from '@/lib/realtime'
import {
  WEBHOOK_EVENTS,
  ensureIntegrationsSeeded,
  getNormalizedCredentials,
} from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

// GET /api/integrations — tổng hợp một lần toàn bộ cấu hình tích hợp
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

    const payload = {
      apiKeys,
      webhooks,
      credentials,
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
