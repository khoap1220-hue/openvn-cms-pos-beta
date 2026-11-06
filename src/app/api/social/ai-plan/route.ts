import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  generateSocialPlan,
  createAndPersistSocialPlan,
  type SocialPlatform,
} from '@/lib/social-ai'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/ai-plan
 * Danh sách các kế hoạch nội dung mạng xã hội
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get('campaignId') || undefined
    const status = searchParams.get('status') || undefined
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10)))

    const where: Record<string, unknown> = {}
    if (campaignId) where.campaignId = campaignId
    if (status) where.status = status

    const [total, plans] = await Promise.all([
      db.socialPlan.count({ where }),
      db.socialPlan.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          campaign: {
            select: {
              id: true,
              code: true,
              name: true,
              title: true,
            },
          },
          _count: {
            select: { posts: true },
          },
        },
      }),
    ])

    return NextResponse.json({
      plans,
      total,
      page,
      pageSize,
    })
  } catch (err: unknown) {
    console.error('[API /api/social/ai-plan GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy danh sách kế hoạch'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/social/ai-plan
 * Tự động tạo kế hoạch nội dung và viết bài bằng AI cho chiến dịch CRM
 */
export async function POST(req: NextRequest) {
  try {
    let body: {
      campaignId?: string
      platforms?: SocialPlatform[]
      postsCount?: number
      contentSourceId?: string
      customPrompt?: string
      autoSave?: boolean
    }

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Nội dung yêu cầu không hợp lệ' }, { status: 400 })
    }

    const campaignId = body.campaignId?.trim()
    if (!campaignId) {
      return NextResponse.json({ error: 'Vui lòng cung cấp mã hoặc ID chiến dịch (campaignId)' }, { status: 400 })
    }

    const autoSave = body.autoSave !== false

    if (autoSave) {
      const persisted = await createAndPersistSocialPlan(campaignId, {
        platforms: body.platforms,
        postsCount: body.postsCount,
        contentSourceId: body.contentSourceId,
        customPrompt: body.customPrompt,
      })
      return NextResponse.json(persisted, { status: 201 })
    } else {
      const generated = await generateSocialPlan(campaignId, {
        platforms: body.platforms,
        postsCount: body.postsCount,
        contentSourceId: body.contentSourceId,
        customPrompt: body.customPrompt,
      })
      return NextResponse.json(generated, { status: 200 })
    }
  } catch (err: unknown) {
    console.error('[API /api/social/ai-plan POST] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể tạo kế hoạch nội dung mạng xã hội'
    const status = message.includes('Không tìm thấy') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
