import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 40))
    const agent = searchParams.get('agent')

    const where: Record<string, unknown> = {}
    if (agent && agent !== 'ALL') where.agent = agent

    const activities = await db.agentActivity.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    const byAgent = await db.agentActivity.groupBy({
      by: ['agent'],
      _count: { _all: true },
      where: { createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
    })

    return NextResponse.json({ activities, byAgent })
  } catch (error) {
    console.error('AgentActivities GET error:', error)
    return NextResponse.json({ error: 'Không thể tải nhật ký Agent' }, { status: 500 })
  }
}
