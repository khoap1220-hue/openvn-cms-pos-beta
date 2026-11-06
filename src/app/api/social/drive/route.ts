// src/app/api/social/drive/route.ts
// Milestone 2: Google Drive Content Source Engine API Route
// GET: Liệt kê các nguồn tư liệu Google Drive đã đồng bộ
// POST: Thêm mới hoặc kích hoạt đồng bộ thư mục Google Drive công khai

import { NextRequest, NextResponse } from 'next/server'
import {
  listContentSources,
  syncDriveFolderToDb,
  type SyncDriveFolderInput,
} from '@/lib/drive-parser'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/drive
 * Lấy danh sách các nguồn dữ liệu Google Drive, lọc theo trạng thái, từ khóa hoặc chiến dịch
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || undefined
    const status = searchParams.get('status') || undefined
    const campaignId = searchParams.get('campaignId') || undefined

    const sources = await listContentSources({ search, status, campaignId })
    return NextResponse.json({ sources })
  } catch (err: unknown) {
    console.error('[API /api/social/drive GET] Lỗi:', err)
    const message =
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy danh sách nguồn dữ liệu'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/social/drive
 * Khởi tạo đồng bộ một thư mục Google Drive công khai
 */
export async function POST(req: NextRequest) {
  try {
    let body: SyncDriveFolderInput
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Nội dung yêu cầu không hợp lệ' }, { status: 400 })
    }

    if (!body.folderUrl || typeof body.folderUrl !== 'string' || body.folderUrl.trim().length === 0) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp đường dẫn thư mục Google Drive' },
        { status: 400 }
      )
    }

    const result = await syncDriveFolderToDb({
      folderUrl: body.folderUrl.trim(),
      name: body.name?.trim(),
      campaignId: body.campaignId,
      productId: body.productId,
      description: body.description?.trim(),
    })

    return NextResponse.json(
      {
        success: true,
        source: result.contentSource,
        items: result.items,
        isUpdated: result.isUpdated,
      },
      { status: result.isUpdated ? 200 : 201 }
    )
  } catch (err: unknown) {
    console.error('[API /api/social/drive POST] Lỗi đồng bộ:', err)
    const message =
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi đồng bộ thư mục Google Drive'

    if (message.includes('không tồn tại')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message.includes('quyền công khai') || message.includes('chưa được mở')) {
      return NextResponse.json({ error: message }, { status: 403 })
    }
    if (message.includes('không hợp lệ') || message.includes('Định dạng')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
