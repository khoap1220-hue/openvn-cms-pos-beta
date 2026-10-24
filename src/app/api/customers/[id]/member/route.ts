import { NextRequest, NextResponse } from 'next/server'
import { registerMember } from '@/lib/member'

export const dynamic = 'force-dynamic'

// POST: nâng cấp khách hàng ⇒ thành viên (cấp mã TV + ngày tham gia + ghi Sổ Data)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const customer = await registerMember(id, 'OPERATOR')
    return NextResponse.json({ customer })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể đăng ký thành viên'
    const status = message.includes('Không tìm thấy') ? 404 : message.includes('đã là thành viên') ? 409 : 400
    console.error('Member register error:', error)
    return NextResponse.json({ error: message }, { status })
  }
}
