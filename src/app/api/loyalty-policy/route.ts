import { NextRequest, NextResponse } from 'next/server'
import { getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import {
  listLoyaltyPolicyWaves,
  getActiveLoyaltyWave,
  createLoyaltyPolicyWave,
  activateLoyaltyPolicyWave,
  updateLoyaltyPolicyWave,
} from '@/lib/loyalty-policy'

export async function GET() {
  try {
    const cached = getApiCache<Record<string, unknown>>('loyalty-policy:all')
    if (cached) {
      return NextResponse.json(cached)
    }
    const [waves, activeWave] = await Promise.all([
      listLoyaltyPolicyWaves(true),
      getActiveLoyaltyWave(),
    ])
    const payload = {
      activeWave,
      policy: activeWave.config,
      waves,
    }
    setApiCache('loyalty-policy:all', payload, 30_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/loyalty-policy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể tải cấu hình chính sách hội viên' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    invalidateApiCache()
    const body = await req.json()
    const action = String(body.action || 'CREATE_WAVE').toUpperCase()

    if (action === 'ACTIVATE_WAVE') {
      const waveIdOrCode = String(body.waveId || body.waveCode || '').trim()
      if (!waveIdOrCode) {
        return NextResponse.json({ error: 'Thiếu mã hoặc ID đợt chính sách cần kích hoạt' }, { status: 400 })
      }
      const activated = await activateLoyaltyPolicyWave(waveIdOrCode, body.actorName || 'Chủ tiệm Ưu Đàm')
      const waves = await listLoyaltyPolicyWaves(true)
      return NextResponse.json({ activeWave: activated, policy: activated.config, waves })
    }

    if (action === 'UPDATE_WAVE') {
      const waveIdOrCode = String(body.waveId || body.waveCode || '').trim()
      if (!waveIdOrCode) {
        return NextResponse.json({ error: 'Thiếu mã hoặc ID đợt chính sách cần cập nhật' }, { status: 400 })
      }
      await updateLoyaltyPolicyWave(waveIdOrCode, {
        name: body.name,
        effectiveFrom: body.effectiveFrom,
        effectiveTo: body.effectiveTo,
        changeNote: body.changeNote,
        config: body.config,
      })
      const [waves, activeWave] = await Promise.all([
        listLoyaltyPolicyWaves(true),
        getActiveLoyaltyWave(),
      ])
      return NextResponse.json({ activeWave, policy: activeWave.config, waves })
    }

    // Mặc định: Tạo một Đợt chính sách mới (CREATE_WAVE)
    const created = await createLoyaltyPolicyWave({
      name: String(body.name || 'Đợt cập nhật chính sách Hội viên'),
      effectiveFrom: body.effectiveFrom,
      effectiveTo: body.effectiveTo ?? null,
      changeNote: body.changeNote,
      activateImmediately: body.activateImmediately !== false,
      actorName: body.actorName || 'Chủ tiệm Ưu Đàm',
      config: body.config || {},
    })
    const [waves, activeWave] = await Promise.all([
      listLoyaltyPolicyWaves(true),
      getActiveLoyaltyWave(),
    ])
    return NextResponse.json({ createdWave: created, activeWave, policy: activeWave.config, waves }, { status: 201 })
  } catch (error) {
    console.error('POST /api/loyalty-policy error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể lưu đợt chính sách hội viên' },
      { status: 400 }
    )
  }
}
