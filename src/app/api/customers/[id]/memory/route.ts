import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getMemorySnapshot, refreshCustomerMemory } from '@/lib/memory-engine'

export const dynamic = 'force-dynamic'

// GET: hồ sơ trí nhớ dài hạn của khách (Chân dung & Trí nhớ AI)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const snapshot = await getMemorySnapshot(id)
    if (!snapshot) return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })

    const customer = await db.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        salutation: true,
        inferredProfile: true,
        contextSummary: true,
        preferences: true,
        painPoints: true,
        nextFollowUp: true,
        memoryUpdatedAt: true,
      },
    })
    return NextResponse.json({ customer, memory: snapshot })
  } catch (error) {
    console.error('Customer memory GET error:', error)
    return NextResponse.json({ error: 'Không thể tải trí nhớ khách hàng' }, { status: 500 })
  }
}

// POST: "Tóm tắt lại" — chạy lại memory engine cho khách này
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const snapshot = await getMemorySnapshot(id)
    if (!snapshot) return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })

    const refreshed = await refreshCustomerMemory(id, 'MANUAL', 'Người vận hành bấm Tóm tắt lại')
    if (!refreshed) return NextResponse.json({ error: 'Không thể cập nhật trí nhớ' }, { status: 500 })

    return NextResponse.json({
      ok: true,
      customer: {
        contextSummary: refreshed.contextSummary,
        preferences: refreshed.preferences,
        painPoints: refreshed.painPoints,
        nextFollowUp: refreshed.nextFollowUp,
        memoryUpdatedAt: refreshed.memoryUpdatedAt,
      },
    })
  } catch (error) {
    console.error('Customer memory POST error:', error)
    return NextResponse.json({ error: 'Không thể tóm tắt lại' }, { status: 500 })
  }
}
