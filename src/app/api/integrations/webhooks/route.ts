import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { randomSecret, WEBHOOK_EVENTS } from '@/lib/webhook-service'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// GET /api/integrations/webhooks — danh sách endpoint kèm 5 lần gửi mới nhất mỗi endpoint
export async function GET() {
  try {
    const webhooks = await db.webhookEndpoint.findMany({
      orderBy: { createdAt: 'desc' },
      include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 5 } },
    })
    return NextResponse.json({ webhooks })
  } catch (error) {
    console.error('Webhooks GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách webhook' }, { status: 500 })
  }
}

// POST /api/integrations/webhooks { name, url, events, secret? } — đăng ký endpoint
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; url?: string; events?: string; secret?: string }
    const name = body.name?.trim()
    const url = body.url?.trim()
    const events = body.events?.trim() || '*'
    if (!name) return NextResponse.json({ error: 'Vui lòng nhập tên webhook' }, { status: 400 })
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'URL webhook không hợp lệ (phải bắt đầu bằng http/https)' }, { status: 400 })
    }

    const secret = body.secret?.trim() || randomSecret()
    const webhook = await db.webhookEndpoint.create({ data: { name, url, events, secret } })

    await logLedger({
      scope: 'WEBHOOK',
      action: 'WEBHOOK_CREATED',
      entityType: 'WebhookEndpoint',
      entityId: webhook.id,
      title: `Đăng ký webhook «${name}»`,
      detail: { url, events },
      actor: 'OPERATOR',
    })

    return NextResponse.json({ webhook }, { status: 201 })
  } catch (error) {
    console.error('Webhooks POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo webhook' }, { status: 500 })
  }
}

// PATCH /api/integrations/webhooks?id= { active?, events?, url?, name? }
export async function PATCH(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Thiếu id webhook' }, { status: 400 })

    const existing = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Webhook không tồn tại' }, { status: 404 })

    const body = (await req.json()) as { active?: boolean; events?: string; url?: string; name?: string }
    const data: { active?: boolean; events?: string; url?: string; name?: string } = {}
    if (typeof body.active === 'boolean') data.active = body.active
    if (body.events !== undefined) {
      const events = String(body.events).trim() || '*'
      const parts = events.split(',').map((s) => s.trim()).filter(Boolean)
      const valid = events === '*' || parts.every((p) => (WEBHOOK_EVENTS as readonly string[]).includes(p))
      if (!valid) return NextResponse.json({ error: 'Danh sách sự kiện không hợp lệ' }, { status: 400 })
      data.events = parts.length > 0 ? parts.join(',') : '*'
    }
    if (body.url !== undefined) {
      const url = body.url.trim()
      if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: 'URL webhook không hợp lệ' }, { status: 400 })
      data.url = url
    }
    if (body.name !== undefined) {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Tên webhook không được để trống' }, { status: 400 })
      data.name = name
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    const webhook = await db.webhookEndpoint.update({ where: { id }, data })

    await logLedger({
      scope: 'WEBHOOK',
      action: 'WEBHOOK_UPDATED',
      entityType: 'WebhookEndpoint',
      entityId: id,
      title: `Cập nhật webhook «${webhook.name}»`,
      detail: data,
      actor: 'OPERATOR',
    })

    return NextResponse.json({ webhook })
  } catch (error) {
    console.error('Webhooks PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật webhook' }, { status: 500 })
  }
}

// DELETE /api/integrations/webhooks?id= — gỡ endpoint
export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Thiếu id webhook' }, { status: 400 })

    const existing = await db.webhookEndpoint.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Webhook không tồn tại' }, { status: 404 })

    await db.webhookEndpoint.delete({ where: { id } })

    await logLedger({
      scope: 'WEBHOOK',
      action: 'WEBHOOK_DELETED',
      entityType: 'WebhookEndpoint',
      entityId: id,
      title: `Gỡ webhook «${existing.name}»`,
      detail: { url: existing.url },
      actor: 'OPERATOR',
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhooks DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa webhook' }, { status: 500 })
  }
}

export const PUT = PATCH
