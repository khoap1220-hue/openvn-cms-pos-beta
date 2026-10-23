import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Các scope hợp lệ của Sổ Data (đồng bộ với LedgerScope trong lib/ledger.ts)
const VALID_SCOPES = [
  'ORDER',
  'INVOICE',
  'INVENTORY',
  'AGENT',
  'WEBHOOK',
  'PARTNER',
  'BOM',
  'AFTERSALES',
  'PERIOD',
  'SETTINGS',
  'CHANNEL',
  'MESSAGE',
  'SYSTEM',
] as const

// GET /api/ledger?scope=&q=&days=&limit= — Sổ Data toàn hệ thống
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const scope = searchParams.get('scope')
    const q = searchParams.get('q')?.trim()
    const days = Number(searchParams.get('days')) || 0
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 200))

    const where: Record<string, unknown> = {}
    if (scope && (VALID_SCOPES as readonly string[]).includes(scope)) where.scope = scope
    if (q) {
      where.OR = [{ title: { contains: q } }, { entityCode: { contains: q } }]
    }
    if (days > 0) {
      where.createdAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) }
    }

    const [entries, groups] = await Promise.all([
      db.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      // Thống kê theo scope trên TOÀN BỘ sổ (không áp filter scope)
      db.ledgerEntry.groupBy({ by: ['scope'], _count: { _all: true } }),
    ])

    const counts: Record<string, number> = {}
    for (const gItem of groups) {
      counts[gItem.scope] = gItem._count._all
    }

    return NextResponse.json({ entries, counts })
  } catch (error) {
    console.error('Ledger GET error:', error)
    return NextResponse.json({ error: 'Không thể tải Sổ Data' }, { status: 500 })
  }
}
