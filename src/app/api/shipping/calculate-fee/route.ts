import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface CalculateFeeBody {
  carrier?: string
  province?: string
  district?: string
  weightGram?: number
}

function normalizeText(str?: string): string {
  if (!str) return ''
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as CalculateFeeBody
    const carrier = (body.carrier ?? 'GHTK').toUpperCase()
    const province = body.province ?? 'Hà Nội'
    const district = body.district ?? ''
    const weightGram = Number(body.weightGram) > 0 ? Number(body.weightGram) : 500

    const normProv = normalizeText(province)
    const isInnerCity = normProv.includes('ha noi')

    // Phí cơ bản theo đơn vị vận chuyển & khu vực (Kho Ưu Đàm tại Hà Nội)
    // 0 external network calls - Safe deterministic mock
    let baseFee = 0
    if (carrier === 'GHN') {
      baseFee = isInnerCity ? 24000 : 38000
    } else {
      // GHTK / Default
      baseFee = isInnerCity ? 22000 : 35000
    }

    // Phụ phí cân nặng nếu trên 1000g: 5.000đ mỗi 500g vượt
    let weightSurcharge = 0
    if (weightGram > 1000) {
      const extraGrams = weightGram - 1000
      weightSurcharge = Math.ceil(extraGrams / 500) * 5000
    }

    const totalFee = baseFee + weightSurcharge

    return NextResponse.json({
      success: true,
      carrier,
      province,
      district,
      weightGram,
      fee: totalFee,
      baseFee,
      weightSurcharge,
      estimatedDelivery: isInnerCity ? '1 - 2 ngày' : '2 - 4 ngày',
      mock: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi tính phí vận chuyển'
    console.error('Calculate shipping fee error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
