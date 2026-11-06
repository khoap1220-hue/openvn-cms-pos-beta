// src/app/api/social/publish/route.ts
// Milestone 5: Publishing Gateway Route Handler
// Kích hoạt xuất bản bài viết mạng xã hội qua Ba Cổng Thép và Khóa Chống Trùng Lặp

import { NextRequest, NextResponse } from 'next/server'
import { publishPostItem } from '@/lib/social-scheduler'
import { publishPost } from '@/lib/publishing-gateway'

export const dynamic = 'force-dynamic'

interface PublishBody {
  postId?: string
  skipTimeGate?: boolean
  forceMock?: boolean
  actor?: string
  actorName?: string
}

/**
 * POST /api/social/publish
 * Phát lệnh xuất bản trực tiếp bài viết đã được duyệt
 */
export async function POST(req: NextRequest) {
  try {
    let body: PublishBody
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON yêu cầu không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object' || !body.postId || !body.postId.trim()) {
      return NextResponse.json(
        { error: 'Mã bài viết (postId) là bắt buộc' },
        { status: 400 }
      )
    }

    const postId = body.postId.trim()
    const skipTimeGate = body.skipTimeGate ?? true
    const actor = body.actor || 'OPERATOR'
    const actorName = body.actorName || 'Chủ tiệm Ưu Đàm'

    // Thực thi qua Three Iron Gates & Concurrency Lock của social-scheduler
    const result = await publishPostItem(postId, {
      skipTimeGate,
      actor,
      actorName,
      publisher: body.forceMock
        ? (reqData) => publishPost({ ...reqData, isMock: true })
        : publishPost,
    })

    if (!result.success) {
      const statusCode =
        result.reason === 'POST_NOT_FOUND'
          ? 404
          : result.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS'
          ? 409
          : 422

      return NextResponse.json(
        {
          ...result,
          error: result.error || result.reason || 'Xuất bản bài viết thất bại',
        },
        { status: statusCode }
      )
    }

    return NextResponse.json(
      {
        ...result,
        message: 'Xuất bản bài viết thành công',
      },
      { status: 200 }
    )
  } catch (err: unknown) {
    console.error('[API /api/social/publish POST] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra trong quá trình xuất bản'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
