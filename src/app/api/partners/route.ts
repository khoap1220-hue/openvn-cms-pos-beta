import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

const PARTNER_TYPES = ['SUPPLIER', 'CUSTOMER', 'BOTH'] as const

/** Sinh mã đối tác tự tăng: NCC-001 / KH-001 */
async function nextPartnerCode(type: string): Promise<string> {
  const prefix = type === 'CUSTOMER' ? 'KH-' : 'NCC-'
  const rows = await db.partner.findMany({ where: { code: { startsWith: prefix } }, select: { code: true } })
  let max = 0
  for (const row of rows) {
    const seq = Number(row.code.slice(prefix.length))
    if (Number.isFinite(seq) && seq > max) max = seq
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const cacheKey = `partners:${searchParams.toString()}`
    const cached = getApiCache<Record<string, unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const q = searchParams.get('q')?.trim()
    const type = searchParams.get('type')

    const where: Record<string, unknown> = {}
    if (type && (PARTNER_TYPES as readonly string[]).includes(type)) where.type = type
    if (q) {
      where.OR = [
        { name: { contains: q } },
        { code: { contains: q } },
        { taxCode: { contains: q } },
        { phone: { contains: q } },
      ]
    }

    const partners = await db.partner.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 500,
      include: {
        _count: { select: { purchaseInvoices: true, salesInvoices: true } },
      },
    })

    const payload = { partners }
    setApiCache(cacheKey, payload, 20_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Partners GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách đối tác' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    invalidateApiCache()
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    if (!name) return NextResponse.json({ error: 'Vui lòng nhập tên đơn vị' }, { status: 400 })

    const type = String(body.type ?? 'SUPPLIER')
    if (!(PARTNER_TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: 'Loại đối tác không hợp lệ (SUPPLIER | CUSTOMER | BOTH)' }, { status: 400 })
    }

    let code = String(body.code ?? '').trim()
    if (code) {
      const existed = await db.partner.findUnique({ where: { code } })
      if (existed) return NextResponse.json({ error: `Mã đối tác "${code}" đã tồn tại` }, { status: 400 })
    } else {
      code = await nextPartnerCode(type)
    }

    const partner = await db.partner.create({
      data: {
        code,
        name,
        taxCode: body.taxCode != null ? String(body.taxCode).trim() || null : null,
        address: body.address != null ? String(body.address).trim() || null : null,
        phone: body.phone != null ? String(body.phone).trim() || null : null,
        email: body.email != null ? String(body.email).trim() || null : null,
        type,
        note: body.note != null ? String(body.note).trim() || null : null,
      },
    })

    await logLedger({
      scope: 'PARTNER',
      action: 'PARTNER_CREATED',
      actor: 'OPERATOR',
      entityType: 'Partner',
      entityId: partner.id,
      entityCode: partner.code,
      title: `Thêm đối tác ${partner.code} — ${partner.name}`,
      detail: { type: partner.type, taxCode: partner.taxCode },
    })

    return NextResponse.json({ partner }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo đối tác'
    console.error('Partners POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
