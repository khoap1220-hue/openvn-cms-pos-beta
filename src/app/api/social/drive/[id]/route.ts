// src/app/api/social/drive/[id]/route.ts
// Milestone 2: Google Drive Content Source Engine Detail & Re-sync API Route
// GET: Xem chi tiết nguồn tư liệu kèm danh sách tệp và cây thư mục phân cấp
// POST / PUT: Tái đồng bộ (Re-sync) thư mục, bảo toàn liên kết Product & Campaign
// DELETE: Xóa nguồn tư liệu và dọn dẹp các tệp liên kết (cascade)

import { NextRequest, NextResponse } from 'next/server'
import {
  getContentSource,
  deleteContentSource,
  syncDriveFolderToDb,
  type SyncDriveFolderInput,
} from '@/lib/drive-parser'

export const dynamic = 'force-dynamic'

/**
 * GET /api/social/drive/[id]
 * Lấy chi tiết nguồn tư liệu Google Drive kèm các tệp con và cấu trúc cây thư mục
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID nguồn dữ liệu không hợp lệ' }, { status: 400 })
    }

    const source = await getContentSource(id)
    if (!source) {
      return NextResponse.json({ error: 'Không tìm thấy nguồn dữ liệu' }, { status: 404 })
    }

    let parsedFileTree = null
    if (source.fileTree) {
      try {
        parsedFileTree = JSON.parse(source.fileTree)
      } catch {
        parsedFileTree = null
      }
    }

    return NextResponse.json({
      source,
      items: source.items,
      fileTree: parsedFileTree,
    })
  } catch (err: unknown) {
    console.error('[API /api/social/drive/[id] GET] Lỗi:', err)
    const message =
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy chi tiết nguồn dữ liệu'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT /api/social/drive/[id]
 * Tái đồng bộ (Re-sync) nguồn tư liệu Google Drive
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID nguồn dữ liệu không hợp lệ' }, { status: 400 })
    }

    const existingSource = await getContentSource(id)
    if (!existingSource) {
      return NextResponse.json({ error: 'Không tìm thấy nguồn dữ liệu để đồng bộ' }, { status: 404 })
    }

    let body: Partial<SyncDriveFolderInput> = {}
    try {
      body = await req.json()
    } catch {
      // Body rỗng được chấp nhận khi re-sync từ URL sẵn có
      body = {}
    }

    const folderUrl = body.folderUrl?.trim() || existingSource.driveFolderUrl

    const result = await syncDriveFolderToDb({
      contentSourceId: id,
      folderUrl,
      name: body.name?.trim() || existingSource.name,
      campaignId: body.campaignId !== undefined ? body.campaignId : existingSource.campaignId,
      productId: body.productId !== undefined ? body.productId : existingSource.productId,
      description: body.description !== undefined ? body.description : existingSource.description,
    })

    return NextResponse.json({
      success: true,
      source: result.contentSource,
      items: result.items,
    })
  } catch (err: unknown) {
    console.error('[API /api/social/drive/[id] PUT] Lỗi tái đồng bộ:', err)
    const message =
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi tái đồng bộ nguồn dữ liệu'

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

/**
 * POST /api/social/drive/[id]
 * Hỗ trợ alias POST cho thao tác re-sync
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return PUT(req, { params })
}

/**
 * DELETE /api/social/drive/[id]
 * Xóa nguồn tư liệu Google Drive và cascade dọn dẹp các tệp liên kết
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID nguồn dữ liệu không hợp lệ' }, { status: 400 })
    }

    await deleteContentSource(id)
    return NextResponse.json({
      success: true,
      message: 'Đã xóa nguồn dữ liệu thành công',
    })
  } catch (err: unknown) {
    console.error('[API /api/social/drive/[id] DELETE] Lỗi:', err)
    const message =
      err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi xóa nguồn dữ liệu'
    if (message.includes('không tồn tại')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export const PATCH = PUT
