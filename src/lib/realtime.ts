// Broadcast realtime event qua mini-service socket.io (port 3003).
// Fire-and-forget: lỗi kết nối không ảnh hưởng nghiệp vụ chính.

const REALTIME_URL = process.env.REALTIME_URL || `http://localhost:${process.env.REALTIME_PORT || '3013'}`

export type CmsEventType =
  | 'order.created'
  | 'order.updated'
  | 'order.event'
  | 'agent.activity'
  | 'shipment.updated'
  | 'message.new'
  | 'message.reaction'
  | 'review.received'
  | 'settings.updated'
  | 'ledger.new'
  | 'customer.updated'
  | 'product.updated'
  | 'inventory.updated'
  | 'channel.updated'
  | 'loyalty.policy.updated'
  | 'campaign.wave.updated'
  | 'behavior.new'

export function broadcast(type: CmsEventType, payload?: unknown): void {
  const body = JSON.stringify({
    event: 'cms',
    payload: { type, at: new Date().toISOString(), data: payload ?? null },
  })
  fetch(`${REALTIME_URL}/emit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {
    // realtime service tạm mất — bỏ qua, client sẽ tự refetch định kỳ
  })
}
