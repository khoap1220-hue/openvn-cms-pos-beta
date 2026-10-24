import { NextRequest, NextResponse } from 'next/server'
import { barcodeSvg } from '@/lib/barcode'

export const dynamic = 'force-dynamic'

// GET /api/barcode?text=SKU123&height=60&moduleWidth=2&showText=1
// Trả về image/svg+xml — dùng trực tiếp trong <img src> cho in nhãn & hiển thị.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const text = searchParams.get('text') ?? ''

  if (!text.trim()) {
    return NextResponse.json({ error: 'Thiếu tham số text' }, { status: 400 })
  }
  // CODE128 set B: ASCII 32..126, giới hạn 64 ký tự để nhãn không quá dài
  if (!/^[\x20-\x7E]{1,64}$/.test(text)) {
    return NextResponse.json({ error: 'Mã vạch chỉ hỗ trợ 1–64 ký tự ASCII in được' }, { status: 400 })
  }

  const height = Number(searchParams.get('height')) || 60
  const moduleWidth = Number(searchParams.get('moduleWidth')) || 2
  const showText = searchParams.get('showText') === '1'
  const color = searchParams.get('color') ?? '#000000'

  const svg = barcodeSvg(text, {
    height,
    moduleWidth,
    showText,
    color: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#000000',
    quietZone: 10,
  })

  return new NextResponse(svg, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
