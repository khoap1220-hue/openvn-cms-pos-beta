import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaign,
  updateCampaign,
  deleteCampaign,
  validateCampaignDates,
  type UpdateCampaignInput,
} from '@/lib/campaign-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/campaigns/[id]
 * Lấy chi tiết chiến dịch kèm thông tin làm giàu sản phẩm và voucher
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID chiến dịch không hợp lệ' }, { status: 400 })
    }

    const campaign = await getCampaign(id)
    if (!campaign) {
      return NextResponse.json({ error: 'Không tìm thấy chiến dịch' }, { status: 404 })
    }

    return NextResponse.json({ campaign })
  } catch (err: unknown) {
    console.error('[API /api/campaigns/[id] GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy chi tiết chiến dịch'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * PUT /api/campaigns/[id]
 * Cập nhật thông tin, thời gian, sản phẩm hoặc trạng thái chiến dịch
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID chiến dịch không hợp lệ' }, { status: 400 })
    }

    let body: UpdateCampaignInput
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Nội dung cập nhật không hợp lệ' }, { status: 400 })
    }

    // Nếu cập nhật cả hai ngày bắt đầu và kết thúc, thẩm định ràng buộc endDate > startDate
    if (body.startDate !== undefined && body.endDate !== undefined) {
      const dateCheck = validateCampaignDates(body.startDate, body.endDate)
      if (!dateCheck.valid) {
        return NextResponse.json({ error: dateCheck.error }, { status: 400 })
      }
    }

    const updated = await updateCampaign(id, body)
    return NextResponse.json({ campaign: updated })
  } catch (err: unknown) {
    console.error('[API /api/campaigns/[id] PUT] Error:', err)
    const statusCode = (err as { statusCode?: number })?.statusCode || 500
    const message = err instanceof Error ? err.message : 'Không thể cập nhật chiến dịch'
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}

/**
 * DELETE /api/campaigns/[id]
 * Xóa chiến dịch
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'ID chiến dịch không hợp lệ' }, { status: 400 })
    }

    const result = await deleteCampaign(id)
    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('[API /api/campaigns/[id] DELETE] Error:', err)
    const statusCode = (err as { statusCode?: number })?.statusCode || 500
    const message = err instanceof Error ? err.message : 'Không thể xóa chiến dịch'
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}

export const PATCH = PUT
