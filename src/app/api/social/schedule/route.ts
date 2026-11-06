import { NextRequest, NextResponse } from 'next/server'
import { processScheduledPosts } from '@/lib/social-scheduler'
import '@/lib/publishing-gateway'

export const dynamic = 'force-dynamic'

/**
 * POST /api/social/schedule
 * Kích hoạt trình quét hàng đợi tự động xuất bản các bài viết đã được duyệt đến giờ hẹn
 */
export async function POST(req: NextRequest) {
  try {
    let body: { referenceTime?: string } = {}
    try {
      body = await req.json()
    } catch {
      // Body rỗng được chấp nhận, mặc định lấy thời gian hiện tại
    }

    const refTime = body?.referenceTime ? new Date(body.referenceTime) : new Date()
    const summary = await processScheduledPosts(refTime)

    return NextResponse.json(
      {
        success: true,
        referenceTime: refTime.toISOString(),
        ...summary,
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    console.error('[API /api/social/schedule POST] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể thực thi quét lịch xuất bản bài viết'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
