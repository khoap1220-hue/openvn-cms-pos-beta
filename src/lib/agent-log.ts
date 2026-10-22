// Ghi vĩnh viễn hoạt động của Agent vào SQLite + broadcast realtime.

import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

export interface ActivityInput {
  agent: string
  action: string
  level?: 'info' | 'success' | 'warning' | 'error'
  targetType?: string | null
  targetId?: string | null
  targetLabel?: string | null
  message: string
  detail?: string | null
}

export async function logActivity(input: ActivityInput) {
  try {
    const activity = await db.agentActivity.create({
      data: {
        agent: input.agent,
        action: input.action,
        level: input.level ?? 'info',
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        message: input.message,
        detail: input.detail ?? null,
      },
    })
    broadcast('agent.activity', activity)
    return activity
  } catch (error) {
    console.error('logActivity error:', error)
    return null
  }
}

export async function logEvent(orderId: string, type: string, actor: string, title: string, detail?: string | null) {
  try {
    const event = await db.orderEvent.create({
      data: { orderId, type, actor, title, detail: detail ?? null },
    })
    broadcast('order.event', { orderId, event })
    return event
  } catch (error) {
    console.error('logEvent error:', error)
    return null
  }
}

export interface ZaloMessageInput {
  customerId: string
  channelKey: string // ZALO_OA | ZALO_PERSONAL
  content: string
  sender?: 'AGENT' | 'OPERATOR' | 'CUSTOMER'
  agentName?: string | null
  relatedOrderId?: string | null
  isAuto?: boolean
}

export async function sendZalo(input: ZaloMessageInput) {
  try {
    const message = await db.directMessage.create({
      data: {
        customerId: input.customerId,
        channelKey: input.channelKey,
        sender: input.sender ?? 'AGENT',
        agentName: input.agentName ?? null,
        content: input.content,
        relatedOrderId: input.relatedOrderId ?? null,
        isAuto: input.isAuto ?? true,
      },
    })
    broadcast('message.new', message)
    return message
  } catch (error) {
    console.error('sendZalo error:', error)
    return null
  }
}
