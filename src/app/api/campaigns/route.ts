import { NextRequest, NextResponse } from 'next/server'
import {
  createCampaign,
  listCampaigns,
  type CampaignStatus,
  type CreateCampaignInput,
} from '@/lib/campaign-service'

export const dynamic = 'force-dynamic'

/**
 * GET /api/campaigns
 * Danh sách chiến dịch CRM, hỗ trợ tìm kiếm, lọc theo trạng thái động và phân trang
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search') || undefined
    const status = (searchParams.get('status') as CampaignStatus | 'ALL') || undefined
    const productId = searchParams.get('productId') || undefined
    const voucherId = searchParams.get('voucherId') || undefined
    const page = searchParams.get('page') ? parseInt(searchParams.get('page')!, 10) : 1
    const pageSize = searchParams.get('pageSize') ? parseInt(searchParams.get('pageSize')!, 10) : 20

    const result = await listCampaigns({
      search,
      status,
      productId,
      voucherId,
      page,
      pageSize,
    })

    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('[API /api/campaigns GET] Error:', err)
    const message = err instanceof Error ? err.message : 'Đã có lỗi xảy ra khi lấy danh sách chiến dịch'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/campaigns
 * Tạo mới chiến dịch khuyến mãi / sự kiện bán hàng
 */
export async function POST(req: NextRequest) {
  try {
    let body: CreateCampaignInput
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Dữ liệu JSON không hợp lệ' }, { status: 400 })
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Nội dung yêu cầu không hợp lệ' }, { status: 400 })
    }

    const name = (body.name || body.title || '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Tên chương trình không được để trống' }, { status: 400 })
    }

    if (!body.startDate) {
      return NextResponse.json({ error: 'Vui lòng cung cấp ngày bắt đầu chiến dịch' }, { status: 400 })
    }
    if (!body.endDate) {
      return NextResponse.json({ error: 'Vui lòng cung cấp ngày kết thúc chiến dịch' }, { status: 400 })
    }

    const startMs = new Date(body.startDate).getTime()
    const endMs = new Date(body.endDate).getTime()

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      return NextResponse.json({ error: 'Định dạng ngày tháng không hợp lệ' }, { status: 400 })
    }

    if (endMs <= startMs) {
      return NextResponse.json(
        { error: 'Thời gian kết thúc phải diễn ra sau thời gian bắt đầu' },
        { status: 400 }
      )
    }

    const campaign = await createCampaign(body)
    return NextResponse.json({ campaign }, { status: 201 })
  } catch (err: unknown) {
    console.error('[API /api/campaigns POST] Error:', err)
    const statusCode = (err as { statusCode?: number })?.statusCode || 500
    const message = err instanceof Error ? err.message : 'Không thể tạo chiến dịch'
    return NextResponse.json({ error: message }, { status: statusCode })
  }
}
