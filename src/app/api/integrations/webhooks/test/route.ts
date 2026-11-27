import { NextRequest, NextResponse } from 'next/server'
import { POST as inboundWebhookPost } from '@/app/api/webhooks/inbound/route'
import { db } from '@/lib/db'
import {
  WEBHOOK_EVENTS,
  deliverWebhookToEndpoint,
  getActiveInboundSecrets,
  getOrCreateLocalBridgeToken,
  isPublicDemoSecret,
  signPayload,
} from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

// POST /api/integrations/webhooks/test
// Hỗ trợ 2 chế độ:
//   1. { mode: 'INBOUND_SIMULATE', event, data } — tự ký HMAC-SHA256 nội bộ & chạy thử /api/webhooks/inbound
//   2. { id, event? } — gửi sự kiện kiểm thử Outbound tới WebhookEndpoint đã đăng ký
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mode?: string
      id?: string
      event?: string
      data?: Record<string, unknown>
    }

    if (body.mode === 'INBOUND_SIMULATE') {
      const event = String(body.event || 'INBOUND_PING').trim()
      if (!event.startsWith('INBOUND_') && !event.startsWith('OUTBOX_')) {
        return NextResponse.json(
          { ok: false, error: 'Sự kiện giả lập phải bắt đầu bằng INBOUND_ hoặc OUTBOX_' },
          { status: 400 }
        )
      }

      const activeSecrets = await getActiveInboundSecrets()
      const preferredSecret =
        getOrCreateLocalBridgeToken() ||
        activeSecrets.find((s) => !isPublicDemoSecret(s)) ||
        activeSecrets[0]

      if (!preferredSecret) {
        return NextResponse.json(
          { ok: false, error: 'Chưa có khóa bí mật Inbound hoạt động để ký HMAC' },
          { status: 500 }
        )
      }

      const rawPayload = JSON.stringify({
        event,
        sentAt: new Date().toISOString(),
        data: body.data ?? {},
      })
      const signature = signPayload(preferredSecret, rawPayload)

      const simReq = new NextRequest('http://127.0.0.1:3010/api/webhooks/inbound', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Signature': signature,
        },
        body: rawPayload,
      })

      const inboundRes = await inboundWebhookPost(simReq)
      const responseJson = (await inboundRes.json().catch(() => ({}))) as Record<string, unknown>

      return NextResponse.json({
        ok: inboundRes.ok,
        status: inboundRes.status,
        event,
        signature: `${signature.slice(0, 8)}...${signature.slice(-6)}`,
        response: responseJson,
      })
    }

    const id = String(body.id || '').trim()
    if (!id) {
      return NextResponse.json({ error: 'Thiếu id webhook endpoint' }, { status: 400 })
    }

    const endpoint = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!endpoint) {
      return NextResponse.json({ error: 'Webhook endpoint không tồn tại' }, { status: 404 })
    }

    const event = String(body.event || WEBHOOK_EVENTS[0]).trim() || WEBHOOK_EVENTS[0]
    const samplePayload = {
      test: true,
      endpointName: endpoint.name,
      event,
      timestamp: new Date().toISOString(),
      sampleOrderCode: 'DH-WEBHOOK-TEST',
    }

    const delivery = await deliverWebhookToEndpoint(endpoint, event, samplePayload)

    return NextResponse.json({
      ok: delivery.status === 'SUCCESS',
      status: delivery.status,
      responseCode: delivery.responseCode,
      error: delivery.error,
      event,
      durationMs: delivery.durationMs,
    })
  } catch (error) {
    console.error('Webhook test POST error:', error)
    return NextResponse.json(
      { ok: false, status: 'FAILED', error: 'Không thể gửi kiểm thử webhook' },
      { status: 500 }
    )
  }
}
