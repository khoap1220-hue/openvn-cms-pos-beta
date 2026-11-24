import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  invalidateInboundSecretsCache,
  maskSecretText,
  randomKey,
  randomSecret,
} from '@/lib/webhook-service'
import { invalidateApiCache } from '@/lib/realtime'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// GET /api/integrations/api-keys — danh sách API key (đã che mờ key & secret theo chuẩn Zero-Secret Leak)
export async function GET() {
  try {
    const apiKeys = await db.apiKey.findMany({ orderBy: { createdAt: 'desc' } })
    const safeApiKeys = apiKeys.map((k) => ({
      ...k,
      key: maskSecretText(k.key),
      secret: maskSecretText(k.secret),
    }))
    return NextResponse.json({ apiKeys: safeApiKeys })
  } catch (error) {
    console.error('ApiKeys GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách API key' }, { status: 500 })
  }
}

// POST /api/integrations/api-keys { name } — tạo API key mới (chỉ trả secret dạng rõ đúng 1 lần khi khởi tạo)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string }
    const name = body.name?.trim()
    if (!name) return NextResponse.json({ error: 'Vui lòng nhập tên API key' }, { status: 400 })

    const apiKey = await db.apiKey.create({
      data: { name, key: randomKey('omni'), secret: randomSecret() },
    })

    invalidateInboundSecretsCache()
    invalidateApiCache('integrations:')

    await logLedger({
      scope: 'WEBHOOK',
      action: 'API_KEY_CREATED',
      entityType: 'ApiKey',
      entityId: apiKey.id,
      entityCode: apiKey.key,
      title: `Tạo API key «${name}»`,
      detail: { key: maskSecretText(apiKey.key) },
      actor: 'OPERATOR',
    })

    return NextResponse.json({ apiKey }, { status: 201 })
  } catch (error) {
    console.error('ApiKeys POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo API key' }, { status: 500 })
  }
}

// DELETE /api/integrations/api-keys?id= — thu hồi (xóa hẳn) API key
export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Thiếu id API key' }, { status: 400 })

    const existing = await db.apiKey.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'API key không tồn tại' }, { status: 404 })

    await db.apiKey.delete({ where: { id } })
    invalidateInboundSecretsCache()
    invalidateApiCache('integrations:')

    await logLedger({
      scope: 'WEBHOOK',
      action: 'API_KEY_REVOKED',
      entityType: 'ApiKey',
      entityId: id,
      entityCode: existing.key,
      title: `Thu hồi API key «${existing.name}»`,
      detail: { key: maskSecretText(existing.key) },
      actor: 'OPERATOR',
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('ApiKeys DELETE error:', error)
    return NextResponse.json({ error: 'Không thể thu hồi API key' }, { status: 500 })
  }
}
