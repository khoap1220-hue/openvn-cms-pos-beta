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

const ALLOWED_INBOUND_SIMULATE_EVENTS = new Set<string>([
  'INBOUND_PING',
  'INBOUND_SEPAY_TRANSACTION',
  'INBOUND_VOUCHER_VALIDATE',
  'INBOUND_ALLIANCE_STOCK_SYNC',
  'INBOUND_STOCK_UPDATE',
  'INBOUND_ORDER_CREATE',
  'INBOUND_SHIPMENT_UPDATE',
  'INBOUND_ZALO_MESSAGE',
  'INBOUND_PAYMENT_CONFIRM',
])

// POST /api/integrations/webhooks/test
// Hỗ trợ 2 chế độ:
//   1. { mode: 'INBOUND_SIMULATE', event, data } — tự ký HMAC-SHA256 cho sự kiện đối tác cho phép (chặn tuyệt đối OUTBOX_* & INBOUND_SHOPEE_*)
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
      const event = String(body.event || 'INBOUND_PING')
        .trim()
        .toUpperCase()
      if (event.startsWith('OUTBOX_') || event.startsWith('INBOUND_SHOPEE_')) {
        return NextResponse.json(
          {
            ok: false,
            code: 'FORBIDDEN_INTERNAL_EVENT',
            error:
              'Sự kiện nội bộ Kho Phiên Mã Hóa Shopee & Hàng đợi Outbox không được phép gọi qua trình giả lập.',
          },
          { status: 403 }
        )
      }
      if (!ALLOWED_INBOUND_SIMULATE_EVENTS.has(event)) {
        return NextResponse.json(
          {
            ok: false,
            code: 'UNSUPPORTED_SIMULATE_EVENT',
            error: `Sự kiện giả lập «${event}» không nằm trong danh mục cho phép.`,
          },
          { status: 400 }
        )
      }

      const activeSecrets = await getActiveInboundSecrets()
      const preferredSecret =
        activeSecrets.find((s) => !isPublicDemoSecret(s)) ||
        getOrCreateLocalBridgeToken() ||
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
      const incomingFwd = req.headers.get('x-forwarded-for')?.trim()
      const simHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Signature': signature,
      }
      if (incomingFwd || !isPublicDemoSecret(preferredSecret)) {
        simHeaders['X-Forwarded-For'] = incomingFwd || '127.0.0.1'
      }

      const simReq = new NextRequest('http://127.0.0.1:3010/api/webhooks/inbound', {
        method: 'POST',
        headers: simHeaders,
        body: rawPayload,
      })

      const inboundRes = await inboundWebhookPost(simReq)
      const responseJson = (await inboundRes.json().catch(() => ({}))) as Record<string, unknown>
      const safeResponse: Record<string, unknown> = { ...responseJson }
      delete safeResponse.vault
      delete safeResponse.cookies
      delete safeResponse.spc_cds
      delete safeResponse.csrf_token

      return NextResponse.json({
        ok: inboundRes.ok,
        status: inboundRes.status,
        event,
        signature: `${signature.slice(0, 8)}...${signature.slice(-6)}`,
        response: safeResponse,
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
