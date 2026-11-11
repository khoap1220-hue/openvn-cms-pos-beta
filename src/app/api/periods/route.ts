import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, getApiCache, setApiCache } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

// GET ?year → 4 quý kèm trạng thái (tự tạo 4 quý OPEN nếu chưa có)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const cacheKey = `periods:${year}`
    const cached = getApiCache<Record<string, unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    let periods = await db.accountingPeriod.findMany({ where: { year }, orderBy: { quarter: 'asc' } })
    if (periods.length < 4) {
      await Promise.all(
        [1, 2, 3, 4].map((quarter) =>
          db.accountingPeriod.upsert({
            where: { year_quarter: { year, quarter } },
            create: { year, quarter, status: 'OPEN' },
            update: {},
          })
        )
      )
      periods = await db.accountingPeriod.findMany({ where: { year }, orderBy: { quarter: 'asc' } })
    }

    const payload = { year, periods }
    setApiCache(cacheKey, payload, 30_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Periods GET error:', error)
    return NextResponse.json({ error: 'Không thể tải kỳ kế toán' }, { status: 500 })
  }
}

// POST { action: 'CLOSE' | 'REOPEN', year, quarter, note? }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action ?? '')
    if (action !== 'CLOSE' && action !== 'REOPEN') {
      return NextResponse.json({ error: 'Hành động không hợp lệ (CLOSE | REOPEN)' }, { status: 400 })
    }
    const year = Number(body.year)
    const quarter = Number(body.quarter)
    if (!Number.isInteger(year) || year < 2000 || year > 3000) {
      return NextResponse.json({ error: 'Năm không hợp lệ' }, { status: 400 })
    }
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) {
      return NextResponse.json({ error: 'Quý không hợp lệ (1..4)' }, { status: 400 })
    }
    const note = body.note != null ? String(body.note).trim() || null : null

    const closing = action === 'CLOSE'
    const period = await db.accountingPeriod.upsert({
      where: { year_quarter: { year, quarter } },
      create: { year, quarter, status: closing ? 'CLOSED' : 'OPEN', closedAt: closing ? new Date() : null, note },
      update: closing
        ? { status: 'CLOSED', closedAt: new Date(), ...(note ? { note } : {}) }
        : { status: 'OPEN', closedAt: null, ...(note ? { note } : {}) },
    })

    await logLedger({
      scope: 'PERIOD',
      action: closing ? 'PERIOD_CLOSED' : 'PERIOD_REOPENED',
      actor: 'OPERATOR',
      entityType: 'AccountingPeriod',
      entityId: period.id,
      entityCode: `Q${quarter}/${year}`,
      title: closing ? `Chốt sổ kỳ Q${quarter}/${year}` : `Mở lại sổ kỳ Q${quarter}/${year}`,
      detail: { note },
    })
    broadcast('settings.updated', { reason: 'period' })

    return NextResponse.json({ period })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật kỳ kế toán'
    console.error('Periods POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
