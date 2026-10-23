import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getInvoiceDashboard } from '@/lib/accounting'

export const dynamic = 'force-dynamic'

// GET ?year&quarter → dashboard hạch toán + trạng thái kỳ + trạng thái cấu hình Gemini
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || new Date().getFullYear()
    const quarterParam = Number(searchParams.get('quarter')) || 0
    const quarter = quarterParam >= 1 && quarterParam <= 4 ? quarterParam : null

    const dashboard = await getInvoiceDashboard({ year, quarter })

    const period = quarter
      ? await db.accountingPeriod.findUnique({ where: { year_quarter: { year, quarter } } })
      : null
    const geminiKey = await db.appSetting.findUnique({ where: { key: 'gemini_api_key' } })

    return NextResponse.json({
      ...dashboard,
      periodClosed: period?.status === 'CLOSED',
      geminiConfigured: Boolean(geminiKey?.value && geminiKey.value.trim().length > 0),
    })
  } catch (error) {
    console.error('Invoice dashboard GET error:', error)
    return NextResponse.json({ error: 'Không thể tải dashboard hạch toán' }, { status: 500 })
  }
}
