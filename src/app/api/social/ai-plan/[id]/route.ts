import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/ai-plan/[id]
 * Lấy chi tiết kế hoạch mạng xã hội kèm các bài viết con và kết quả chấm điểm Rubric
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID kế hoạch không hợp lệ' }, { status: 400 })
    }

    const plan = await db.socialPlan.findUnique({
      where: { id },
      include: {
        campaign: true,
        posts: {
          orderBy: { scheduledAt: 'asc' },
        },
      },
    })

    if (!plan) {
      return NextResponse.json({ error: 'Không tìm thấy kế hoạch mạng xã hội' }, { status: 404 })
    }

    // Giải mã snapshot rubricEvaluation, generationSource, generationMeta nếu có trong payloadSnapshot của từng post
    const postsWithMeta = plan.posts.map((post) => {
      let rubricEvaluation = null
      let generationSource: 'LLM' | 'TEMPLATE_FALLBACK' = 'TEMPLATE_FALLBACK'
      let generationMeta = null
      if (post.payloadSnapshot) {
        try {
          const snapshot = JSON.parse(post.payloadSnapshot)
          rubricEvaluation = snapshot.rubricEvaluation || null
          generationSource = snapshot.generationSource || 'TEMPLATE_FALLBACK'
          generationMeta = snapshot.generationMeta || null
        } catch {
          // Bỏ qua nếu parse lỗi
        }
      }
      return {
        ...post,
        rubricEvaluation,
        generationSource,
        generationMeta,
      }
    })

    return NextResponse.json({
      plan: {
        ...plan,
        posts: postsWithMeta,
      },
    })
  } catch (err: unknown) {
    console.error('[API /api/social/ai-plan/[id] GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy chi tiết kế hoạch'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * DELETE /api/social/ai-plan/[id]
 * Xóa một kế hoạch mạng xã hội (tự động xóa kèm các bài viết con theo quan hệ cascade)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID kế hoạch không hợp lệ' }, { status: 400 })
    }

    const existing = await db.socialPlan.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Không tìm thấy kế hoạch mạng xã hội' }, { status: 404 })
    }

    await db.socialPlan.delete({ where: { id } })

    return NextResponse.json({
      success: true,
      message: `Đã xóa kế hoạch "${existing.title}" thành công`,
    })
  } catch (err: unknown) {
    console.error('[API /api/social/ai-plan/[id] DELETE] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể xóa kế hoạch mạng xã hội'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
