import { NextRequest, NextResponse } from 'next/server'
import { adjustPoints, type PointsMode } from '@/lib/member'

export const dynamic = 'force-dynamic'

// POST: cộng / trừ điểm thành viên (bù điểm hoặc đổi quà) — ghi Sổ Data
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const mode = body.mode as PointsMode
    if (mode !== 'EARN' && mode !== 'REDEEM') {
      return NextResponse.json({ error: 'Chế độ điểm không hợp lệ (EARN hoặc REDEEM)' }, { status: 400 })
    }
    const customer = await adjustPoints(id, mode, Number(body.points), body.note, 'OPERATOR')
    return NextResponse.json({ customer })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật điểm'
    const status = message.includes('Không tìm thấy') ? 404 : 400
    console.error('Points adjust error:', error)
    return NextResponse.json({ error: message }, { status })
  }
}
