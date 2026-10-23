import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// 8 provider tích hợp cố định của hệ thống
const PROVIDERS: Array<{ provider: string; label: string }> = [
  { provider: 'GHN', label: 'Giao Hàng Nhanh' },
  { provider: 'GHTK', label: 'Giao Hàng Tiết Kiệm' },
  { provider: 'VIETTEL', label: 'Viettel Post' },
  { provider: 'JT', label: 'J&T Express' },
  { provider: 'NINJA', label: 'Ninja Van' },
  { provider: 'ZALO_OA', label: 'Zalo OA / ZNS' },
  { provider: 'PAYOS', label: 'PayOS (Thanh toán + Webhook)' },
  { provider: 'GEMINI', label: 'Gemini AI' },
]

interface CredentialView {
  provider: string
  label: string
  name: string
  config: Record<string, unknown> | null
  active: boolean
  updatedAt: Date | null
}

function parseConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// GET /api/integrations/credentials — 8 provider cố định, chưa cấu hình → config null
export async function GET() {
  try {
    const rows = await db.integrationCredential.findMany()
    const credentials: CredentialView[] = PROVIDERS.map(({ provider, label }) => {
      const row = rows.find((r) => r.provider === provider)
      return {
        provider,
        label,
        name: row?.name ?? label,
        config: row ? parseConfig(row.config) : null,
        active: row?.active ?? false,
        updatedAt: row?.updatedAt ?? null,
      }
    })
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
  const provider = body.provider?.trim()
  if (!provider || !PROVIDERS.some((p) => p.provider === provider)) {
    return { error: 'Provider không hợp lệ', status: 400 as const }
  }
  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    return { error: 'Cấu hình (config) phải là object', status: 400 as const }
  }

  const label = PROVIDERS.find((p) => p.provider === provider)?.label ?? provider
  const credential = await db.integrationCredential.upsert({
    where: { provider },
    update: {
      name: body.name?.trim() || label,
      config: JSON.stringify(body.config),
      active: typeof body.active === 'boolean' ? body.active : true,
    },
    create: {
      provider,
      name: body.name?.trim() || label,
      config: JSON.stringify(body.config),
      active: typeof body.active === 'boolean' ? body.active : true,
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
