// API & WEBHOOK — lớp tích hợp hai chiều.
// Outbound: dispatchWebhook ký HMAC-SHA256 rồi POST tới mọi endpoint đăng ký sự kiện (fire-and-forget).
// Inbound: verifyInboundWebhook xác thực chữ ký X-Signature từ hệ thống ngoài.
// Sự kiện INBOUND_* là nội bộ — không bao giờ dispatch ra endpoint bên ngoài.

import crypto from 'crypto'
import { db } from '@/lib/db'

// 9 sự kiện outbound chuẩn của hệ thống
export const WEBHOOK_EVENTS = [
  'order.created',
  'order.confirmed',
  'order.packing',
  'order.shipping',
  'order.completed',
  'order.cancelled',
  'invoice.sales.created',
  'invoice.purchase.created',
  'stock.movement',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | string

export function signPayload(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

export function randomKey(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`
}

export function randomSecret(): string {
  return crypto.randomBytes(24).toString('hex')
}

/**
 * Đẩy sự kiện tới TẤT CẢ webhook endpoint đang active có đăng ký sự kiện này.
 * Fire-and-forget: ghi delivery log, không chặn nghiệp vụ, không bao giờ throw.
 * Sự kiện INBOUND_* chỉ nội bộ — bị lọc bỏ tại đây.
 */
export function dispatchWebhook(event: WebhookEvent, payload: unknown): void {
  try {
    if (event.startsWith('INBOUND_')) return // nội bộ, không phát ra ngoài
    void (async () => {
      const endpoints = await db.webhookEndpoint.findMany({ where: { active: true } })
      const targets = endpoints.filter((e) => e.events === '*' || e.events.split(',').map((s) => s.trim()).includes(event))
      if (targets.length === 0) return
      const body = JSON.stringify({
        event,
        sentAt: new Date().toISOString(),
        data: payload,
      })
      await Promise.all(
        targets.map(async (endpoint) => {
          const signature = signPayload(endpoint.secret, body)
          let status = 'FAILED'
          let responseCode: number | null = null
          let error: string | null = null
          try {
            const res = await fetch(endpoint.url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Event': event,
                'X-Signature': signature,
              },
              body,
              signal: AbortSignal.timeout(8000),
            })
            responseCode = res.status
            status = res.ok ? 'SUCCESS' : 'FAILED'
            if (!res.ok) error = `HTTP ${res.status}`
          } catch (e) {
            error = e instanceof Error ? e.message : 'Lỗi kết nối'
          }
          try {
            await db.webhookDelivery.create({
              data: {
                endpointId: endpoint.id,
                event,
                payload: body.slice(0, 20000),
                signature,
                status,
                attempts: 1,
                responseCode,
                error,
              },
            })
          } catch {
            // không chặn
          }
        }),
      )
    })()
  } catch {
    // không bao giờ làm hỏng nghiệp vụ chính
  }
}

/**
 * Xác thực inbound webhook từ hệ thống ngoài.
 * Trả về payload đã parse, hoặc null nếu chữ ký không hợp lệ.
 */
export async function verifyInboundWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ ok: true; payload: Record<string, unknown> } | { ok: false; reason: string }> {
  if (!signature) return { ok: false, reason: 'Thiếu header X-Signature' }
  const credentials = await db.integrationCredential.findMany({ where: { provider: 'PAYOS', active: true } })
  const secrets = credentials
    .map((c) => {
      try {
        return (JSON.parse(c.config) as { webhookSecret?: string }).webhookSecret as string | undefined
      } catch {
        return undefined
      }
    })
    .filter((s): s is string => Boolean(s))
  if (secrets.length === 0) return { ok: false, reason: 'Chưa cấu hình credential PAYOS (webhookSecret)' }
  const valid = secrets.some((s) => signPayload(s, rawBody) === signature)
  if (!valid) return { ok: false, reason: 'Chữ ký HMAC không hợp lệ' }
  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>
    if (!payload.event || typeof payload.event !== 'string' || !payload.event.startsWith('INBOUND_')) {
      return { ok: false, reason: 'Sự kiện inbound phải có tiền tố INBOUND_' }
    }
    return { ok: true, payload }
  } catch {
    return { ok: false, reason: 'Body không phải JSON hợp lệ' }
  }
}
