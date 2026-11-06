import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import {
  BASE_DB_PROVIDER_KEYS,
  INTEGRATION_PROVIDERS,
  getNormalizedCredentials,
} from '@/lib/webhook-service'

export const dynamic = 'force-dynamic'

// GET /api/integrations/credentials — danh sách provider tích hợp chuẩn của OPENVN
export async function GET() {
  try {
    const credentials = await getNormalizedCredentials()
    return NextResponse.json({ credentials })
  } catch (error) {
    console.error('Credentials GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách credential' }, { status: 500 })
  }
}

// POST/PATCH /api/integrations/credentials { provider, name?, config, active? } — upsert theo provider
async function upsertCredential(req: NextRequest) {
  const body = (await req.json()) as {
    provider?: string
    name?: string
    config?: Record<string, unknown>
    active?: boolean
  }
  const provider = body.provider?.trim().toUpperCase()
  if (!provider || !INTEGRATION_PROVIDERS.some((p) => p.provider === provider)) {
    return { error: 'Provider không hợp lệ', status: 400 as const }
  }
  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    return { error: 'Cấu hình (config) phải là object', status: 400 as const }
  }

  const label = INTEGRATION_PROVIDERS.find((p) => p.provider === provider)?.label ?? provider
  const nextActive = typeof body.active === 'boolean' ? body.active : true
  const nextName = body.name?.trim() || label

  if (BASE_DB_PROVIDER_KEYS.has(provider)) {
    const credential = await db.integrationCredential.upsert({
      where: { provider },
      update: {
        name: nextName,
        config: JSON.stringify(body.config),
        active: nextActive,
      },
      create: {
        provider,
        name: nextName,
        config: JSON.stringify(body.config),
        active: nextActive,
      },
    })

    await logLedger({
      scope: 'SETTINGS',
      action: 'CREDENTIAL_SAVED',
      entityType: 'IntegrationCredential',
      entityId: credential.id,
      entityCode: provider,
      title: `Credential ${provider}`,
      detail: { provider, fields: Object.keys(body.config), active: credential.active },
      actor: 'OPERATOR',
    })

    return { credential, status: 200 as const }
  }

  // Với các provider mở rộng (SEPAY, INSTAGRAM, THREADS, TIKTOK_CONTENT, EXTERNAL_CMS, SOCIAL_WEBHOOK_HUB)
  // Lưu vào LedgerEntry (scope = INTEGRATION_CREDENTIAL_EXT) để giữ nguyên số dòng bảng IntegrationCredential (14 dòng)
  const extEntry = await db.ledgerEntry.create({
    data: {
      scope: 'INTEGRATION_CREDENTIAL_EXT',
      action: 'CREDENTIAL_EXT_SAVED',
      entityType: 'IntegrationCredentialExt',
      entityId: provider,
      entityCode: provider,
      title: `Lưu cấu hình kết nối ${nextName} (${provider})`,
      detail: JSON.stringify({ provider, fields: Object.keys(body.config), active: nextActive }),
      afterSnapshot: JSON.stringify({
        provider,
        name: nextName,
        config: body.config,
        active: nextActive,
      }),
      actor: 'OPERATOR',
    },
  })

  return {
    credential: {
      id: extEntry.id,
      provider,
      name: nextName,
      config: JSON.stringify(body.config),
      active: nextActive,
      updatedAt: extEntry.createdAt,
    },
    status: 200 as const,
  }
}

export async function POST(req: NextRequest) {
  try {
    const result = await upsertCredential(req)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ credential: result.credential }, { status: 201 })
  } catch (error) {
    console.error('Credentials POST error:', error)
    return NextResponse.json({ error: 'Không thể lưu credential' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const result = await upsertCredential(req)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ credential: result.credential })
  } catch (error) {
    console.error('Credentials PATCH error:', error)
    return NextResponse.json({ error: 'Không thể lưu credential' }, { status: 500 })
  }
}

export const PUT = PATCH
