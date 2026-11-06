import { NextRequest, NextResponse } from 'next/server'
import {
  getPost,
  updatePost,
  deletePost,
  approvePost,
  rejectPost,
  reschedulePost,
  retryPublishPost,
  publishPostItem,
  submitForApproval,
  type UpdatePostInput,
} from '@/lib/social-scheduler'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/posts/[id]
 * Lấy chi tiết bài viết mạng xã hội kèm chiến dịch, kế hoạch và lịch sử kiểm toán
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID bài viết không hợp lệ' }, { status: 400 })
    }

    const post = await getPost(id)
    if (!post) {
      return NextResponse.json({ error: `Không tìm thấy bài viết với ID "${id}"` }, { status: 404 })
    }

    return NextResponse.json(post, { status: 200 })
  } catch (err: unknown) {
    console.error('[API /api/social/posts/[id] GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy chi tiết bài viết'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT /api/social/posts/[id]
 * Cập nhật bài viết hoặc điều phối các hành động nghiệp vụ (APPROVE, REJECT, RESCHEDULE, RETRY, PUBLISH, SUBMIT_FOR_APPROVAL)
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID bài viết không hợp lệ' }, { status: 400 })
    }

    let body: (UpdatePostInput & {
      action?: 'APPROVE' | 'REJECT' | 'RESCHEDULE' | 'RETRY' | 'PUBLISH' | 'SUBMIT_FOR_APPROVAL'
      approver?: string
      note?: string
      reason?: string
    }) = {}

    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    if (body.action === 'APPROVE') {
      const updated = await approvePost(id, body.approver || 'Chủ tiệm Ưu Đàm', body.note)
      return NextResponse.json(updated, { status: 200 })
    }

    if (body.action === 'REJECT') {
      const reason = (body.reason || body.note || '').trim()
      if (!reason) {
        return NextResponse.json({ error: 'Vui lòng cung cấp lý do từ chối bài viết (reason)' }, { status: 400 })
      }
      const updated = await rejectPost(id, body.approver || 'Chủ tiệm Ưu Đàm', reason)
      return NextResponse.json(updated, { status: 200 })
    }

    if (body.action === 'RESCHEDULE') {
      if (!body.scheduledAt) {
        return NextResponse.json({ error: 'Vui lòng cung cấp thời gian hẹn giờ mới (scheduledAt)' }, { status: 400 })
      }
      const updated = await reschedulePost(id, body.scheduledAt)
      return NextResponse.json(updated, { status: 200 })
    }

    if (body.action === 'RETRY') {
      try {
        const result = await retryPublishPost(id)
        return NextResponse.json(result, { status: 200 })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Không thể thử lại xuất bản bài viết'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    if (body.action === 'PUBLISH') {
      const result = await publishPostItem(id)
      return NextResponse.json(result, { status: 200 })
    }

    if (body.action === 'SUBMIT_FOR_APPROVAL') {
      const updated = await submitForApproval(id)
      return NextResponse.json(updated, { status: 200 })
    }

    // Mặc định: Cập nhật thông tin thông thường của bài viết
    const updated = await updatePost(id, body)
    return NextResponse.json(updated, { status: 200 })
  } catch (err: unknown) {
    console.error('[API /api/social/posts/[id] PUT] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể cập nhật bài viết'
    const statusCode = (err as { statusCode?: number })?.statusCode || (message.includes('Không tìm thấy') ? 404 : 400)
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}

/**
 * DELETE /api/social/posts/[id]
 * Xóa một bài viết (chỉ cho phép đối với bài viết chưa xuất bản)
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID bài viết không hợp lệ' }, { status: 400 })
    }

    const result = await deletePost(id)
    return NextResponse.json(result, { status: 200 })
  } catch (err: unknown) {
    console.error('[API /api/social/posts/[id] DELETE] Error:', err)
    const message = err instanceof Error ? err.message : 'Không thể xóa bài viết'
    const statusCode = (err as { statusCode?: number })?.statusCode || (message.includes('Không tìm thấy') ? 404 : 400)
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}

export const PATCH = PUT
