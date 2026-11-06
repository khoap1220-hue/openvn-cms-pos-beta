import { NextRequest, NextResponse } from 'next/server'
import { getInvoiceDashboard } from '@/lib/accounting'
import { llmChat, resolveGeminiApiKey } from '@/lib/llm'
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

function buildFallbackAnalysis(compact: {
  ky: string
  doanhThu: number
  soHoaDonBan: number
  vatOutput: number
  chiPhiMuaHang: number
  soHoaDonMua: number
  vatInput: number
  loiNhuanGop: number
  bienLoiNhuanPercent: number
  tonKhoHienTai: number
  nhapTrongKy: number
  xuatTrongKy: number
  tonKhoSanPham: Array<{ sku: string; ten: string; ton: number; xuatTrongKy: number }>
}) {
  const fmt = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} ₫`
  const netVat = compact.vatOutput - compact.vatInput
  const lowItems = compact.tonKhoSanPham.filter((p) => p.ton <= 10)
  const fastItems = [...compact.tonKhoSanPham].sort((a, b) => b.xuatTrongKy - a.xuatTrongKy).slice(0, 3)

  const cashForecast = [
    `- **Kỳ ${compact.ky}**: Doanh thu ghi nhận **${fmt(compact.doanhThu)}** (${compact.soHoaDonBan} HĐ bán) so với chi phí mua hàng **${fmt(compact.chiPhiMuaHang)}** (${compact.soHoaDonMua} HĐ mua).`,
    `- **Dòng tiền ròng & Thuế GTGT**: Thặng dư gộp đạt **${fmt(compact.loiNhuanGop)}**; nghĩa vụ VAT ròng dự kiến **${fmt(netVat)}** (VAT đầu ra ${fmt(compact.vatOutput)} − VAT đầu vào ${fmt(compact.vatInput)}).`,
    `- **Dự báo 3 tháng tới**: Duy trì quỹ dự phòng nhập nguyên vật liệu khoảng **35–40% doanh thu** trước mùa cao điểm lễ Tết.`,
  ].join('\n')

  const stockRisks = [
    `- **Tổng tồn kho hiện tại**: **${compact.tonKhoHienTai.toLocaleString('vi-VN')} đơn vị** (nhập +${compact.nhapTrongKy}, xuất −${compact.xuatTrongKy} trong kỳ).`,
    lowItems.length > 0
      ? `- **Cảnh báo sắp chạm đáy**: ${lowItems.map((p) => `${p.ten} (${p.sku}: còn ${p.ton})`).join(', ')} — cần lên đơn nhập bổ sung ngay để tránh đứt hàng.`
      : `- **An toàn tồn kho**: Các mặt hàng chủ lực đều trên ngưỡng an toàn tối thiểu.`,
    fastItems.length > 0
      ? `- **Nhóm luân chuyển nhanh**: ${fastItems.map((p) => `${p.ten} (xuất ${p.xuatTrongKy})`).join(', ')}.`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  const profitStrategy = [
    `- **Biên lợi nhuận gộp kỳ ${compact.ky}** đạt **${compact.bienLoiNhuanPercent}%** (${fmt(compact.loiNhuanGop)}).`,
    `- **Tối ưu phí sàn TMĐT & Combo**: Đẩy mạnh bán theo **Set quà tặng / Combo** và dịch chuyển khách mua lặp lại về kênh **Zalo OA / Website (0% phí sàn)** để tăng 6–8,5% biên lợi nhuận thực nhận.`,
    `- **Kiểm soát định mức BOM**: Chuẩn hóa định mức nguyên vật liệu sáp/bấc/hũ gốm và gom đơn nhập NCC để giảm 5–7% giá vốn đầu vào.`,
  ].join('\n')

  return { cashForecast, stockRisks, profitStrategy }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const year = Number(body.year) || new Date().getFullYear()
    const quarterParam = Number(body.quarter) || 0
    const quarter = quarterParam >= 1 && quarterParam <= 4 ? quarterParam : null

    const geminiKey = await resolveGeminiApiKey()
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

    const text = await llmChat(SYSTEM_PROMPT, userPrompt, 35000)
    const parsed = text ? extractJson(text) : null

    const fallback = buildFallbackAnalysis(compact)
    const cashForecast =
      parsed && typeof parsed.cashForecast === 'string' && parsed.cashForecast.trim().length > 0
        ? parsed.cashForecast
        : fallback.cashForecast
    const stockRisks =
      parsed && typeof parsed.stockRisks === 'string' && parsed.stockRisks.trim().length > 0
        ? parsed.stockRisks
        : fallback.stockRisks
    const profitStrategy =
      parsed && typeof parsed.profitStrategy === 'string' && parsed.profitStrategy.trim().length > 0
        ? parsed.profitStrategy
        : fallback.profitStrategy

    await logLedger({
      scope: 'SYSTEM',
      action: 'AI_ANALYSIS_RUN',
      actor: 'SYSTEM',
      title: `Phân tích AI kỳ ${compact.ky}`,
      detail: {
        revenue: compact.doanhThu,
        profit: compact.loiNhuanGop,
        source: parsed ? 'gemini' : 'deterministic_fallback',
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
