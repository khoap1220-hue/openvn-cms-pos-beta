import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getInvoiceDashboard } from '@/lib/accounting'
import { getSetting } from '@/lib/settings'
import { llmChat } from '@/lib/llm'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = [
  'Bạn là chuyên gia phân tích tài chính - kế toán - chuỗi cung ứng cho một doanh nghiệp bán hàng Việt Nam.',
  'Hãy phân tích dữ liệu kinh doanh được cung cấp và trả về DUY NHẤT một JSON object hợp lệ (không markdown, không giải thích thêm) với cấu trúc:',
  '{"cashForecast": string (markdown ngắn dự báo dòng tiền 3 tháng tới), "stockRisks": string (cảnh báo tồn kho: hàng chậm luân chuyển, thiếu hàng), "profitStrategy": string (chiến lược tối ưu lợi nhuận chuỗi cung ứng)}',
  'Các chuỗi viết tiếng Việt, dùng markdown ngắn gọn (gạch đầu dòng), số liệu có trích dẫn từ dữ liệu.',
].join(' ')

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const year = Number(body.year) || new Date().getFullYear()
    const quarterParam = Number(body.quarter) || 0
    const quarter = quarterParam >= 1 && quarterParam <= 4 ? quarterParam : null

    const geminiKey = await getSetting('gemini_api_key')
    if (!geminiKey || geminiKey.trim().length === 0) {
      return NextResponse.json({ error: 'Chưa cấu hình Gemini API Key trong module Hệ thống' }, { status: 400 })
    }

    const dashboard = await getInvoiceDashboard({ year, quarter })
    const compact = {
      ky: quarter ? `Q${quarter}/${year}` : `Cả năm ${year}`,
      doanhThu: Math.round(dashboard.revenue),
      soHoaDonBan: dashboard.revenueCount,
      vatOutput: Math.round(dashboard.vatOutput),
      chiPhiMuaHang: Math.round(dashboard.expense),
      soHoaDonMua: dashboard.expenseCount,
      vatInput: Math.round(dashboard.vatInput),
      loiNhuanGop: Math.round(dashboard.profit),
      bienLoiNhuanPercent: Math.round(dashboard.profitMargin * 10) / 10,
      tonKhoHienTai: dashboard.stockNow,
      nhapTrongKy: dashboard.stockIn,
      xuatTrongKy: dashboard.stockOut,
      bienDongTonKho: dashboard.stockChange,
      dongTienTheoThang: dashboard.cashFlow.map((c) => ({
        thang: c.month,
        thu: Math.round(c.in),
        chi: Math.round(c.out),
        rong: Math.round(c.net),
      })),
      tonKhoSanPham: dashboard.inventory.slice(0, 12).map((p) => ({
        sku: p.sku,
        ten: p.name,
        donVi: p.unit,
        ton: p.stock,
        nhapTrongKy: p.in,
        xuatTrongKy: p.out,
        tonCuoiKy: p.closing,
      })),
    }

    const userPrompt = [
      'Dữ liệu kinh doanh (JSON):',
      JSON.stringify(compact),
      '',
      'Yêu cầu: phân tích và trả về DUY NHẤT một JSON object dạng {"cashForecast": "...", "stockRisks": "...", "profitStrategy": "..."}.',
    ].join('\n')

    const text = await llmChat(SYSTEM_PROMPT, userPrompt, 45000)
    if (!text) {
      return NextResponse.json({ error: 'AI không phản hồi, thử lại' }, { status: 502 })
    }

    const parsed = extractJson(text)
    if (!parsed) {
      return NextResponse.json({ error: 'AI không phản hồi, thử lại' }, { status: 502 })
    }

    const cashForecast = typeof parsed.cashForecast === 'string' ? parsed.cashForecast : ''
    const stockRisks = typeof parsed.stockRisks === 'string' ? parsed.stockRisks : ''
    const profitStrategy = typeof parsed.profitStrategy === 'string' ? parsed.profitStrategy : ''
    if (!cashForecast && !stockRisks && !profitStrategy) {
      return NextResponse.json({ error: 'AI không phản hồi, thử lại' }, { status: 502 })
    }

    await logLedger({
      scope: 'SYSTEM',
      action: 'AI_ANALYSIS_RUN',
      actor: 'SYSTEM',
      title: `Phân tích AI kỳ ${compact.ky}`,
      detail: {
        revenue: compact.doanhThu,
        profit: compact.loiNhuanGop,
        cashForecastLength: cashForecast.length,
        stockRisksLength: stockRisks.length,
        profitStrategyLength: profitStrategy.length,
      },
    })

    return NextResponse.json({ cashForecast, stockRisks, profitStrategy, generatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('AI analysis POST error:', error)
    return NextResponse.json({ error: 'AI không phản hồi, thử lại' }, { status: 502 })
  }
}
