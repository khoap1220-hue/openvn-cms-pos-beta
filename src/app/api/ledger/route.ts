import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ORIGIN_SOURCE_KEYS, type PeriodRange, resolvePeriodRange } from '@/lib/lineage'
import { getApiCache, setApiCache } from '@/lib/realtime'

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
  'CAMPAIGN',
  'SYSTEM',
] as const

// GET /api/ledger?scope=&q=&from=&to=&originSource=&onlyChanged=&limit=
// — Sổ Data toàn hệ thống + Bộ lọc Thời gian chuẩn Kế toán (Đầu kỳ → Trong kỳ → Cuối kỳ)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const cacheKey = `ledger:${searchParams.toString()}`
    const cached = getApiCache<Record<string, unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const scope = searchParams.get('scope')
    const q = searchParams.get('q')?.trim()
    const action = searchParams.get('action')?.trim()
    const category = searchParams.get('category')?.trim()
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
    if (action) where.action = action

    // Bộ lọc nghiệp vụ nhanh (Giá bán / Chương trình / 4 Chiều thay đổi dữ liệu)
    if (category === 'PRICE') {
      where.OR = [
        { action: { in: ['PRODUCT_PRICE_CHANGED', 'CHANNEL_PRICE_CHANGED'] } },
        { title: { contains: 'GIÁ BÁN', mode: 'insensitive' } },
      ]
    } else if (category === 'SAN_TO_SAN') {
      where.OR = [
        { title: { contains: 'SÀN SHOPEE ➔ SÀN SHOPEE' } },
        { title: { contains: 'SÀN ➔ SÀN' } },
        { action: { in: ['SHOPEE_INTERNAL_CHANGED', 'SHOPEE_INTERNAL_CREATED'] } },
        { detail: { contains: '"direction":"SHOPEE_TO_SHOPEE"' } },
      ]
    } else if (category === 'CMS_TO_CMS') {
      where.OR = [
        { title: { contains: 'CMS ➔ CMS' } },
        { detail: { contains: '"direction":"CMS_TO_CMS"' } },
        {
          AND: [
            { actor: 'OPERATOR' },
            { NOT: { title: { contains: 'CMS ➔ SÀN' } } },
            { NOT: { title: { contains: 'CMS ➔ Shopee' } } },
            { NOT: { title: { contains: 'SÀN SHOPEE ➔' } } },
          ],
        },
        { scope: { in: ['INVENTORY', 'INVOICE', 'CAMPAIGN', 'SETTINGS', 'PERIOD'] } },
      ]
    } else if (category === 'INBOUND') {
      where.OR = [
        { title: { contains: 'SÀN SHOPEE ➔ CMS' } },
        { action: { startsWith: 'SHOPEE_INBOUND' } },
        { detail: { contains: '"direction":"SHOPEE_TO_CMS"' } },
      ]
    } else if (category === 'OUTBOUND') {
      where.OR = [
        { title: { contains: 'CMS ➔ SÀN SHOPEE' } },
        { title: { contains: 'CMS ➔ Shopee' } },
        { action: { startsWith: 'SHOPEE_OUTBOX' } },
        { action: { startsWith: 'OUTBOX_' } },
        { detail: { contains: '"direction":"CMS_TO_SHOPEE"' } },
      ]
    }

    if (q) {
      const qCondition = [
        { title: { contains: q, mode: 'insensitive' } },
        { entityCode: { contains: q, mode: 'insensitive' } },
        { action: { contains: q, mode: 'insensitive' } },
      ]
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: qCondition }]
        delete where.OR
      } else {
        where.OR = qCondition
      }
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

    const cachedScopeCounts = getApiCache<Record<string, number>>('ledger:global_scope_counts')

    const [entries, groups, beforeCount, originalCount, changedCount] = await Promise.all([
      db.ledgerEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      // Thống kê theo scope trên TOÀN BỘ sổ (dùng cache 20s để tránh quét lại bảng khi đổi bộ lọc nhanh)
      cachedScopeCounts
        ? Promise.resolve(null)
        : db.ledgerEntry.groupBy({ by: ['scope'], _count: { _all: true } }),
      // Đối chiếu kỳ: số bản ghi TRƯỚC kỳ (đầu kỳ)
      fromDate ? db.ledgerEntry.count({ where: { ...statWhere, createdAt: { lt: fromDate } } }) : Promise.resolve(0),
      // Nguyên bản / Đã thay đổi trong kỳ
      db.ledgerEntry.count({ where: { ...statWhere, changedFields: null } }),
      db.ledgerEntry.count({ where: { ...statWhere, changedFields: { not: null } } }),
    ])

    let counts: Record<string, number> = cachedScopeCounts ?? {}
    if (groups) {
      counts = {}
      for (const gItem of groups) {
        counts[gItem.scope] = gItem._count._all
      }
      setApiCache('ledger:global_scope_counts', counts, 20_000)
    }

    const inCount = fromDate || toDate ? originalCount + changedCount : 0

    const payload = {
      entries,
      counts,
      period: {
        beforeCount, // Đầu kỳ (trước from)
        inCount, // Phát sinh trong kỳ
        originalCount, // Nguyên bản
        changedCount, // Đã thay đổi
      },
    }
    setApiCache(cacheKey, payload, 15_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Ledger GET error:', error)
    return NextResponse.json({ error: 'Không thể tải Sổ Data' }, { status: 500 })
  }
}
