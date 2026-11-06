import { NextRequest, NextResponse } from 'next/server'
import {
  createPost,
  listPosts,
  type CreatePostInput,
  type PostFilterParams,
} from '@/lib/social-scheduler'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/posts
 * Lấy danh sách các bài viết mạng xã hội có tìm kiếm, lọc theo chiến dịch, nền tảng, trạng thái & phân trang
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const campaignId = searchParams.get('campaignId') || undefined
    const planId = searchParams.get('planId') || undefined
    const channel = searchParams.get('channel') || undefined
    const status = searchParams.get('status') || undefined
    const search = searchParams.get('search') || undefined
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10)))

    const params: PostFilterParams = {
      campaignId,
      planId,
      channel,
      status,
      search,
      page,
      pageSize,
    }

    const result = await listPosts(params)

    return NextResponse.json(result, { status: 200 })
  } catch (err: unknown) {
    console.error('[API /api/social/posts GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy danh sách bài viết'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/social/posts
 * Tạo mới một bài viết mạng xã hội (bản nháp hoặc lên lịch trực tiếp)
 */
export async function POST(req: NextRequest) {
  try {
    let body: CreatePostInput
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON yêu cầu không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Nội dung yêu cầu không hợp lệ' }, { status: 400 })
    }

    if (!body.channel || !body.channel.trim()) {
      return NextResponse.json({ error: 'Vui lòng cung cấp nền tảng xuất bản (channel)' }, { status: 400 })
    }

    if (!body.content || !body.content.trim()) {
      return NextResponse.json({ error: 'Vui lòng cung cấp nội dung bài viết (content)' }, { status: 400 })
    }

    const created = await createPost(body)

    return NextResponse.json(created, { status: 201 })
  } catch (err: unknown) {
    console.error('[API /api/social/posts POST] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể tạo bài viết mới'
    const status = message.includes('không được để trống') ? 400 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
