import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logLedger } from '@/lib/ledger'

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

// POST: người vận hành trả lời tin nhắn (thay Agent) — hoặc giả lập khách gửi tin (kèm ảnh)
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      customerId?: string
      channelKey?: string
      content?: string
      sender?: 'OPERATOR' | 'CUSTOMER'
      imageUrl?: string
      imageAnalysis?: string
    }
    if (!body.customerId || !body.channelKey || (!body.content?.trim() && !body.imageUrl)) {
      return NextResponse.json({ error: 'Thiếu thông tin tin nhắn' }, { status: 400 })
    }
    // Giới hạn ảnh: URL http(s) hoặc dataURL ≤ 400KB
    let imageUrl: string | null = null
    if (body.imageUrl && body.imageUrl.trim()) {
      const url = body.imageUrl.trim()
      const isHttp = /^https?:\/\//.test(url) && url.length <= 500
      const isData = url.startsWith('data:image/') && url.length <= 400 * 1024
      if (!isHttp && !isData) {
        return NextResponse.json({ error: 'Ảnh không hợp lệ (URL http(s) hoặc ảnh ≤ 400KB)' }, { status: 400 })
      }
      imageUrl = url
    }

    const sender = body.sender === 'CUSTOMER' ? 'CUSTOMER' : 'OPERATOR'
    const customer = await db.customer.findUnique({ where: { id: body.customerId }, select: { id: true, name: true, phone: true } })
    if (!customer) return NextResponse.json({ error: 'Không tìm thấy khách hàng' }, { status: 404 })

    // Ảnh khách gửi → AI đọc ảnh (Vision). Ưu tiên analysis gửi sẵn (kịch bản test), nếu không thì gọi VLM.
    let imageAnalysis = body.imageAnalysis?.trim() || null
    if (imageUrl && !imageAnalysis) {
      const { llmVision } = await import('@/lib/llm')
      imageAnalysis = await llmVision(
        'Mô tả ngắn (1–2 câu tiếng Việt) bức ảnh khách gửi cho tiệm nến & trà gốm Ưu Đàm: có gì trong ảnh, sản phẩm nào, có lỗi gì (nắp hở, mẻ, vỡ, cháy xấu) hay đẹp/tổ chức góc đẹp. Nếu khách hỏi tìm sản phẩm tương tự thì ghi rõ.',
        imageUrl,
      )
    }

    const message = await db.directMessage.create({
      data: {
        customerId: body.customerId,
        channelKey: body.channelKey,
        sender,
        content: body.content?.trim() || '[Ảnh khách gửi]',
        isAuto: false,
        imageUrl,
        imageAnalysis,
      },
      include: { customer: { select: { id: true, name: true, phone: true } } },
    })
    broadcast('message.new', message)

    // Tin nhắn khách → chắt lọc trí nhớ dài hạn (pain point từ lời nhắn/ảnh)
    if (sender === 'CUSTOMER') {
      const { refreshCustomerMemory } = await import('@/lib/memory-engine')
      refreshCustomerMemory(body.customerId, 'MESSAGE', (body.content || imageAnalysis || '').slice(0, 140)).catch(() => null)
    }

    // Sổ Data
    await logLedger({
      scope: 'MESSAGE',
      action: sender === 'CUSTOMER' ? 'CUSTOMER_MESSAGE' : 'OPERATOR_REPLY',
      entityType: 'DirectMessage',
      entityId: message.id,
      entityCode: body.channelKey,
      title:
        sender === 'CUSTOMER'
          ? `${customer.name} nhắn tin${imageUrl ? ' kèm ảnh' : ''} trên ${body.channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo cá nhân'}`
          : `Người vận hành trả lời ${customer.name} trên ${body.channelKey === 'ZALO_OA' ? 'Zalo OA' : 'Zalo cá nhân'}`,
      detail: {
        customerId: body.customerId,
        channelKey: body.channelKey,
        content: (body.content ?? '').trim().slice(0, 200),
        hasImage: !!imageUrl,
        imageAnalysis,
      },
      actor: sender === 'CUSTOMER' ? 'CUSTOMER' : 'OPERATOR',
    })

    return NextResponse.json({ message }, { status: 201 })
  } catch (error) {
    console.error('Inbox POST error:', error)
    return NextResponse.json({ error: 'Không thể gửi tin nhắn' }, { status: 500 })
  }
}
