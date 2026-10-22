import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

// GET: danh sách hội thoại Zalo, hoặc tin nhắn của 1 hội thoại (?customerId=&channelKey=)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerId = searchParams.get('customerId')
    const channelKey = searchParams.get('channelKey')

    if (customerId && channelKey) {
      const messages = await db.directMessage.findMany({
        where: { customerId, channelKey },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { customer: { select: { id: true, name: true, phone: true } } },
      })
      await db.directMessage.updateMany({
        where: { customerId, channelKey, sender: 'CUSTOMER', readAt: null },
        data: { readAt: new Date() },
      })
      return NextResponse.json({ messages })
    }

    const recent = await db.directMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { customer: { select: { id: true, name: true, phone: true } } },
    })

    const map = new Map<
      string,
      {
        key: string
        customerId: string
        channelKey: string
        customer: { id: string; name: string; phone: string | null }
        lastMessage: { content: string; createdAt: Date; sender: string; agentName: string | null; isAuto: boolean }
        unread: number
        total: number
      }
    >()

    for (const m of recent) {
      if (!m.customerId) continue
      const key = `${m.customerId}|${m.channelKey}`
      const entry = map.get(key)
      if (!entry) {
        map.set(key, {
          key,
          customerId: m.customerId,
          channelKey: m.channelKey,
          customer: m.customer ?? { id: m.customerId, name: 'Khách hàng', phone: null },
          lastMessage: { content: m.content, createdAt: m.createdAt, sender: m.sender, agentName: m.agentName, isAuto: m.isAuto },
          unread: m.sender === 'CUSTOMER' && !m.readAt ? 1 : 0,
          total: 1,
        })
      } else {
        entry.total += 1
        if (m.sender === 'CUSTOMER' && !m.readAt) entry.unread += 1
      }
    }

    const conversations = [...map.values()].sort(
      (a, b) => new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime(),
    )

    return NextResponse.json({ conversations })
  } catch (error) {
    console.error('Inbox GET error:', error)
    return NextResponse.json({ error: 'Không thể tải hộp thư' }, { status: 500 })
  }
}

// POST: người vận hành trả lời tin nhắn (thay Agent)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { customerId?: string; channelKey?: string; content?: string }
    if (!body.customerId || !body.channelKey || !body.content?.trim()) {
      return NextResponse.json({ error: 'Thiếu thông tin tin nhắn' }, { status: 400 })
    }
    const message = await db.directMessage.create({
      data: {
        customerId: body.customerId,
        channelKey: body.channelKey,
        sender: 'OPERATOR',
        content: body.content.trim(),
        isAuto: false,
      },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    })
    broadcast('message.new', message)
    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error('Inbox POST error:', error)
    return NextResponse.json({ error: 'Không thể gửi tin nhắn' }, { status: 500 })
  }
}
