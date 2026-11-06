import { NextRequest, NextResponse } from 'next/server'
import { listCampaignWaves, activateCampaignWave } from '@/lib/campaign-service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const waves = await listCampaignWaves(id)
    return NextResponse.json({ waves })
  } catch (error) {
    console.error('GET /api/campaigns/[id]/waves error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể tải lịch sử các đợt chương trình' },
      { status: 500 }
    )
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const waveId = String(body.waveId || body.waveCode || '').trim()
    if (!waveId) {
      return NextResponse.json({ error: 'Thiếu mã hoặc ID đợt chương trình cần kích hoạt' }, { status: 400 })
    }
    const result = await activateCampaignWave(id, waveId, body.actorName || 'Chủ tiệm Ưu Đàm')
    return NextResponse.json(result)
  } catch (error) {
    console.error('POST /api/campaigns/[id]/waves error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể kích hoạt đợt chương trình' },
      { status: 400 }
    )
  }
}
