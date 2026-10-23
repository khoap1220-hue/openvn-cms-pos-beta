import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { WEBHOOK_EVENTS } from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

// GET /api/integrations — tổng hợp một lần toàn bộ cấu hình tích hợp
export async function GET() {
  try {
    const [apiKeys, webhooks, credentials, deliveriesSuccess, deliveriesFailed] = await Promise.all([
      db.apiKey.findMany({ orderBy: { createdAt: 'desc' } }),
      db.webhookEndpoint.findMany({
        orderBy: { createdAt: 'desc' },
        include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5 } },
      }),
      db.integrationCredential.findMany({ orderBy: { provider: 'asc' } }),
      db.webhookDelivery.count({ where: { status: 'SUCCESS' } }),
      db.webhookDelivery.count({ where: { status: 'FAILED' } }),
    ])

    return NextResponse.json({
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
    })
  } catch (error) {
    console.error('Integrations GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dữ liệu tích hợp' }, { status: 500 })
  }
}
