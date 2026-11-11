import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getInvoiceDashboard } from '@/lib/accounting'
import { getApiCache, setApiCache } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

// GET ?year&quarter → dashboard hạch toán + trạng thái kỳ + trạng thái cấu hình Gemini
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const quarterParam = Number(searchParams.get('quarter')) || 0
    const quarter = quarterParam >= 1 && quarterParam <= 4 ? quarterParam : null

    const cacheKey = `invoice-dashboard:${year}:${quarter ?? 0}`
    const cached = getApiCache<Record<string, unknown>>(cacheKey)
    if (cached) {
      return NextResponse.json(cached)
    }

    const [dashboard, period, geminiKey] = await Promise.all([
      getInvoiceDashboard({ year, quarter }),
      quarter
        ? db.accountingPeriod.findUnique({ where: { year_quarter: { year, quarter } } })
        : Promise.resolve(null),
      db.appSetting.findUnique({ where: { key: 'gemini_api_key' } }),
    ])

    const payload = {
      ...dashboard,
      periodClosed: period?.status === 'CLOSED',
      geminiConfigured: Boolean(geminiKey?.value && geminiKey.value.trim().length > 0),
    }
    setApiCache(cacheKey, payload, 15_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Invoice dashboard GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dashboard hạch toán' }, { status: 500 })
  }
}
