import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ORIGIN_SOURCE_KEYS, type PeriodRange, resolvePeriodRange } from '@/lib/lineage'

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
  'CUSTOMER',
  'SYSTEM',
] as const

// GET /api/ledger?scope=&q=&from=&to=&originSource=&onlyChanged=&limit=
// — Sổ Data toàn hệ thống + Bộ lọc Thời gian chuẩn Kế toán (Đầu kỳ → Trong kỳ → Cuối kỳ)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const scope = searchParams.get('scope')
    const q = searchParams.get('q')?.trim()
    const days = Number(searchParams.get('days')) || 0
    const limit = Math.min(500, Math.max(1, Number(searchParams.get('limit')) || 200))

    // ===== Bộ lọc kỳ kế toán (PeriodFilterBar) =====
    const period: PeriodRange = {
      preset: (searchParams.get('preset') as PeriodRange['preset']) || 'ALL',
      from: searchParams.get('from') ?? '',
      to: searchParams.get('to') ?? '',
    }
    const { fromDate, toDate } = resolvePeriodRange(period)
    const originSource = searchParams.get('originSource')
    const onlyChanged = searchParams.get('onlyChanged') // ALL | CHANGED | ORIGINAL

    const where: Record<string, unknown> = {}
    if (scope && (VALID_SCOPES as readonly string[]).includes(scope)) where.scope = scope
    if (q) {
      where.OR = [{ title: { contains: q } }, { entityCode: { contains: q } }]
    }
    if (days > 0) {
      where.createdAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) }
    } else if (fromDate || toDate) {
      const created: Record<string, Date> = {}
      if (fromDate) created.gte = fromDate
      if (toDate) created.lt = toDate
      where.createdAt = created
    }
    if (originSource && (ORIGIN_SOURCE_KEYS as string[]).includes(originSource)) {
      where.originSource = originSource
    }
    if (onlyChanged === 'CHANGED') where.changedFields = { not: null }
    else if (onlyChanged === 'ORIGINAL') where.changedFields = null

    // Khoảng thống kê đối chiếu: dùng cùng bộ lọc (trừ onlyChanged để tách Nguyên bản / Đã đổi)
    const statWhere = { ...where }
    delete statWhere.changedFields

    const [entries, groups, beforeCount, inCount, originalCount, changedCount] = await Promise.all([
      db.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      // Thống kê theo scope trên TOÀN BỘ sổ (không áp filter scope)
      db.ledgerEntry.groupBy({ by: ['scope'], _count: { _all: true } }),
      // Đối chiếu kỳ: số bản ghi TRƯỚC kỳ (đầu kỳ)
      fromDate ? db.ledgerEntry.count({ where: { ...statWhere, createdAt: { lt: fromDate } } }) : Promise.resolve(0),
      // Phát sinh trong kỳ
      fromDate || toDate ? db.ledgerEntry.count({ where: statWhere }) : Promise.resolve(0),
      // Nguyên bản / Đã thay đổi trong kỳ
      db.ledgerEntry.count({ where: { ...statWhere, changedFields: null } }),
      db.ledgerEntry.count({ where: { ...statWhere, changedFields: { not: null } } }),
    ])

    const counts: Record<string, number> = {}
    for (const gItem of groups) {
      counts[gItem.scope] = gItem._count._all
    }

    return NextResponse.json({
      entries,
      counts,
      period: {
        beforeCount, // Đầu kỳ (trước from)
        inCount, // Phát sinh trong kỳ
        originalCount, // Nguyên bản
        changedCount, // Đã thay đổi
      },
    })
  } catch (error) {
    console.error('Ledger GET error:', error)
    return NextResponse.json({ error: 'Không thể tải Sổ Data' }, { status: 500 })
  }
}
