/**
 * BACKFILL DATA LINEAGE — Truy xuất nguồn gốc & Kiểm toán thay đổi
 * =================================================================
 * Cho toàn bộ dữ liệu hiện có:
 *   Pass A: gán originSource / actorName / sourceRefCode cho MỌI LedgerEntry còn thiếu
 *           + chuẩn hoá entityType casing (PRODUCT → Product, STOCK_MOVEMENT → StockMovement)
 *   Pass B: bổ sung beforeSnapshot → afterSnapshot cho các entry hiện có đã có ngữ cảnh
 *           (ORDER_CREATED, STATUS_CHANGED, COD_RECEIVED, COD_RECONCILED, MEMBER_REGISTERED, STOCK_*)
 *   Pass C: tạo snapshot lịch sử thay đổi cho entity chưa có vết:
 *           - Đơn hàng:  bản gốc (origin) + chuỗi trạng thái từ OrderEvent (timestamp thật),
 *                        đơn không có event → 1 entry tổng hợp PENDING → trạng thái hiện tại
 *           - Vận đơn:   bản gốc + chuỗi trạng thái (từ event của đơn) + chuỗi đối soát COD
 *           - Biến động kho: 1 entry lineage / movement (before = stockAfter - qty)
 *           - Khách hàng: bản gốc + nâng cấp thành viên
 * Idempotent: mọi entry tạo mới gắn detail."lineage-backfill":"v1" — chạy lại không nhân đôi.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const TAG = '"lineage-backfill":"v1"'
const seedTag = (extra: Record<string, unknown> = {}) => JSON.stringify({ ...extra, 'lineage-backfill': 'v1' })

function originFromChannelKey(channelKey?: string | null): string {
  const ck = (channelKey ?? '').toUpperCase()
  if (ck.includes('SHOPEE')) return 'SHOPEE_SYNC'
  if (ck.includes('ZALO')) return 'ZALO_OA'
  if (ck === 'POS') return 'POS'
  if (ck === 'WEBSITE' || ck.includes('FACEBOOK') || ck.includes('APP') || ck) return 'MARKETPLACE_SYNC'
  return 'MANUAL_ADMIN'
}

function actorNameOf(actor: string, action: string): string {
  const a = action.toUpperCase()
  if (actor === 'AGENT') {
    if (a.includes('CONFIRM')) return 'Agent Tư vấn'
    if (a.includes('CARRIER') || a.includes('PICKUP') || a.includes('TRANSIT') || a.includes('SHIP') || a.includes('COD') || a.includes('STOCK') || a.includes('INBOUND')) return 'Agent Kho vận'
    if (a.includes('CARE') || a.includes('DELIVERY')) return 'Agent CSKH'
    if (a.includes('REVIEW')) return 'Agent Đánh giá'
    if (a.includes('REPLY') || a.includes('MESSAGE') || a.includes('REACTION') || a.includes('AUTO')) return 'Agent Hỗ trợ 24/7'
    return 'Agent Tự động'
  }
  if (actor === 'OPERATOR') return 'Người vận hành'
  if (actor === 'API') return 'API tích hợp'
  if (actor === 'CUSTOMER') return 'Khách hàng'
  return 'Hệ thống'
}

function originOfEntry(e: { actor: string; action: string; scope: string }): string {
  const action = e.action.toUpperCase()
  if (action.includes('SEED') || action.includes('MIGRAT') || action.includes('RECALC') || action.includes('CLEAN') || action.includes('SAMPLE')) return 'SYSTEM_SEED'
  if (action.includes('SIMULAT') || action.includes('INBOUND') || e.actor === 'API') return 'SHOPEE_SYNC'
  if (e.actor === 'AGENT') return 'AGENT_AUTOPILOT'
  if (e.actor === 'OPERATOR') return 'MANUAL_ADMIN'
  if (e.actor === 'CUSTOMER') return 'ZALO_OA'
  return 'SYSTEM_SEED'
}

// Chuỗi trạng thái lý thuyết của đơn hàng
const ORDER_FLOW = ['PENDING', 'CONFIRMED', 'PACKING', 'SHIPPED', 'DELIVERED', 'COMPLETED']
function flowUpTo(final: string): string[] {
  const idx = ORDER_FLOW.indexOf(final)
  if (idx < 0) return ['PENDING', 'CANCELLED']
  return ORDER_FLOW.slice(0, idx + 1)
}
const SHIPMENT_FLOW = ['DISPATCHED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED']

async function main() {
  console.log('=== BACKFILL LINEAGE v1 ===')
  const stats = { passA: 0, passB: 0, passC: 0, skipped: 0 }

  // ============ PASS A — gán nguồn gốc cho entry hiện có ============
  const entries = await db.ledgerEntry.findMany()
  for (const e of entries) {
    const patch: Record<string, unknown> = {}
    if (!e.originSource) patch.originSource = originOfEntry(e)
    if (!e.actorName) patch.actorName = actorNameOf(e.actor, e.action)
    if (!e.sourceRefCode && e.entityCode) patch.sourceRefCode = e.entityCode
    // chuẩn hoá casing entityType
    if (e.entityType === 'PRODUCT') patch.entityType = 'Product'
    if (e.entityType === 'STOCK_MOVEMENT') patch.entityType = 'StockMovement'
    if (Object.keys(patch).length > 0) {
      await db.ledgerEntry.update({ where: { id: e.id }, data: patch })
      stats.passA++
    } else {
      stats.skipped++
    }
  }
  console.log(`Pass A: cập nhật ${stats.passA} entry (bỏ qua ${stats.skipped} đã đủ)`)

  // ============ PASS B — bổ sung snapshot cho entry hiện có ============
  // B1. ORDER_CREATED: sau = trạng thái khởi tạo
  const orderCreated = await db.ledgerEntry.findMany({ where: { action: 'ORDER_CREATED' } })
  for (const e of orderCreated) {
    if (e.afterSnapshot) continue
    const order = e.entityId ? await db.order.findUnique({ where: { id: e.entityId }, include: { items: true, channel: true } }) : null
    if (!order) continue
    await db.ledgerEntry.update({
      where: { id: e.id },
      data: {
        afterSnapshot: JSON.stringify({
          status: 'PENDING', paymentMethod: order.paymentMethod, paymentStatus: 'UNPAID',
          subtotal: order.subtotal, total: order.total, itemCount: order.items.length,
          customer: order.customerId ? undefined : 'Khách lẻ',
        }),
        originSource: e.originSource ?? originFromChannelKey(order.channel?.key),
        actorName: e.actorName ?? actorNameOf(e.actor, e.action),
        sourceRefCode: e.entityCode ?? order.code,
      },
    })
    stats.passB++
  }

  // B2. STATUS_CHANGED: detail chứa from/to
  const statusChanged = await db.ledgerEntry.findMany({ where: { action: 'STATUS_CHANGED', entityType: 'Order' } })
  for (const e of statusChanged) {
    if (e.beforeSnapshot && e.changedFields) continue
    let from = '', to = ''
    try { const d = JSON.parse(e.detail ?? '{}'); from = d.from ?? ''; to = d.to ?? '' } catch { /* noop */ }
    if (!from || !to) continue
    await db.ledgerEntry.update({
      where: { id: e.id },
      data: {
        beforeSnapshot: JSON.stringify({ status: from }),
        afterSnapshot: JSON.stringify({ status: to }),
        changedFields: JSON.stringify(['status']),
      },
    })
    stats.passB++
  }

  // B3. COD_RECEIVED / COD_RECONCILED
  const codEntries = await db.ledgerEntry.findMany({ where: { action: { in: ['COD_RECEIVED', 'COD_RECONCILED'] } } })
  for (const e of codEntries) {
    if (e.beforeSnapshot && e.changedFields) continue
    const shipment = e.entityId ? await db.shipment.findUnique({ where: { id: e.entityId } }) : null
    const amount = shipment?.codReceived || shipment?.codAmount || 0
    const before = e.action === 'COD_RECEIVED' ? 'PENDING' : 'RECEIVED'
    const after = e.action === 'COD_RECEIVED' ? 'RECEIVED' : 'RECONCILED'
    await db.ledgerEntry.update({
      where: { id: e.id },
      data: {
        beforeSnapshot: JSON.stringify({ codStatus: before }),
        afterSnapshot: JSON.stringify({ codStatus: after, codReceived: amount }),
        changedFields: JSON.stringify(['codStatus']),
        entityType: e.entityType ?? 'Shipment',
        entityId: e.entityId ?? shipment?.id,
      },
    })
    stats.passB++
  }

  // B4. MEMBER_REGISTERED
  const memberEntries = await db.ledgerEntry.findMany({ where: { action: 'MEMBER_REGISTERED' } })
  for (const e of memberEntries) {
    if (e.beforeSnapshot && e.changedFields) continue
    const cust = e.entityId ? await db.customer.findUnique({ where: { id: e.entityId } }) : null
    if (!cust) continue
    await db.ledgerEntry.update({
      where: { id: e.id },
      data: {
        beforeSnapshot: JSON.stringify({ isMember: false, points: 0 }),
        afterSnapshot: JSON.stringify({ isMember: true, memberCode: cust.memberCode, points: cust.points }),
        changedFields: JSON.stringify(['isMember', 'memberCode']),
      },
    })
    stats.passB++
  }

  // B5. STOCK_* manual: bám theo detail.stockAfter nếu có; thiếu before → tra StockMovement cùng thời điểm
  const stockEntries = await db.ledgerEntry.findMany({ where: { action: { in: ['STOCK_IMPORT', 'STOCK_EXPORT', 'STOCK_ADJUST'] } } })
  for (const e of stockEntries) {
    if (e.beforeSnapshot && e.changedFields) continue
    let stockAfter: number | null = null
    let qty: number | null = null
    try { const d = JSON.parse(e.detail ?? '{}'); stockAfter = typeof d.stockAfter === 'number' ? d.stockAfter : null; qty = typeof d.quantity === 'number' ? d.quantity : null } catch { /* noop */ }
    // detail cũ không có số liệu → tìm movement cùng SP ±5s
    if (stockAfter === null && e.entityId) {
      const m = await db.stockMovement.findFirst({
        where: { productId: e.entityId, createdAt: { gte: new Date(e.createdAt.getTime() - 5000), lte: new Date(e.createdAt.getTime() + 5000) } },
      })
      if (m) { stockAfter = m.stockAfter; qty = m.quantity }
    }
    if (stockAfter === null) continue
    const before = qty !== null ? stockAfter - qty : null
    await db.ledgerEntry.update({
      where: { id: e.id },
      data: {
        beforeSnapshot: before !== null ? JSON.stringify({ stock: before }) : e.beforeSnapshot ?? null,
        afterSnapshot: JSON.stringify({ stock: stockAfter }),
        changedFields: JSON.stringify(['stock']),
      },
    })
    stats.passB++
  }
  console.log(`Pass B: bổ sung snapshot cho ${stats.passB} entry hiện có`)

  // ============ PASS C — tạo snapshot lịch sử cho entity ============
  const hasTag = (detail: string | null) => !!detail && detail.includes(TAG)
  const channels = await db.channel.findMany()
  const chKey = new Map(channels.map((c) => [c.id, c.key]))

  // C1. ĐƠN HÀNG
  const orders = await db.order.findMany({ include: { events: { orderBy: { createdAt: 'asc' } }, items: true } })
  // entry gốc sẵn có theo orderId (kể cả ORDER_CREATED đã snapshot ở B1)
  const existingOrderEntries = await db.ledgerEntry.findMany({ where: { entityType: 'Order' } })
  const orderHasOrigin = new Set<string>()
  const orderHasChange = new Map<string, number>()
  for (const e of existingOrderEntries) {
    if (!e.entityId) continue
    if (e.afterSnapshot && !e.changedFields) orderHasOrigin.add(e.entityId)
    if (e.changedFields) orderHasChange.set(e.entityId, (orderHasChange.get(e.entityId) ?? 0) + 1)
  }
  // map event type → chuyển trạng thái
  const EVENT_STATUS: Record<string, [string, string] | null> = {
    CREATED: null,
    CONFIRMED: ['PENDING', 'CONFIRMED'],
    PACKING: ['CONFIRMED', 'PACKING'],
    CARRIER_DISPATCHED: ['PACKING', 'SHIPPED'],
    PICKED_UP: null,
    IN_TRANSIT: null,
    DELIVERED: ['SHIPPED', 'DELIVERED'],
    CANCELLED: ['PENDING', 'CANCELLED'],
    STATUS_CHANGED: null, // dùng detail from/to
    CARE_SENT: null,
    REVIEW_REQUESTED: null,
    REVIEW_RECEIVED: null,
  }
  // guard idempotent: (orderId, createdAt) đã có entry chuyển trạng thái thì bỏ qua
  const statusChangeEntries = await db.ledgerEntry.findMany({ where: { entityType: 'Order', action: { in: ['ORDER_STATUS_CHANGED', 'ORDER_STATUS_SUMMARY'] } }, select: { entityId: true, createdAt: true } })
  const statusChangeKeys = new Set(statusChangeEntries.map((e) => `${e.entityId}::${e.createdAt.toISOString()}`))
  for (const o of orders) {
    const snapshot = {
      status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
      total: o.total, itemCount: o.items.length,
    }
    if (!orderHasOrigin.has(o.id)) {
      const origin = originFromChannelKey(chKey.get(o.channelId))
      await db.ledgerEntry.create({
        data: {
          scope: 'ORDER', action: 'ORDER_ORIGINAL', title: `Đơn ${o.code} khởi tạo từ ${origin === 'SHOPEE_SYNC' ? 'Shopee' : origin === 'ZALO_OA' ? 'Zalo OA' : origin === 'POS' ? 'quầy POS' : 'kênh online'}`,
          entityType: 'Order', entityId: o.id, entityCode: o.code, sourceRefCode: o.code,
          afterSnapshot: JSON.stringify({ status: 'PENDING', paymentMethod: o.paymentMethod, paymentStatus: 'UNPAID', subtotal: o.subtotal, total: o.total, itemCount: o.items.length }),
          originSource: origin, actorName: origin === 'AGENT_AUTOPILOT' ? 'Agent Tự động' : origin === 'SYSTEM_SEED' ? 'Hệ thống' : 'Kênh bán',
          actor: 'SYSTEM', detail: seedTag({ channel: chKey.get(o.channelId) ?? '' }), createdAt: o.createdAt,
        },
      })
      stats.passC++
    }
    // chuỗi trạng thái từ event (timestamp thật)
    const prevChangeCount = orderHasChange.get(o.id) ?? 0
    let synthCount = 0
    for (const ev of o.events) {
      let transition: [string, string] | null = EVENT_STATUS[ev.type] ?? null
      if (ev.type === 'STATUS_CHANGED') {
        try { const d = JSON.parse(ev.detail ?? '{}'); if (d.from && d.to) transition = [d.from, d.to] } catch { /* noop */ }
      }
      if (!transition) continue
      const evKey = `${o.id}::${ev.createdAt.toISOString()}`
      if (statusChangeKeys.has(evKey)) { synthCount++; continue } // đã backfill lần trước — idempotent
      statusChangeKeys.add(evKey)
      await db.ledgerEntry.create({
        data: {
          scope: 'ORDER', action: 'ORDER_STATUS_CHANGED',
          title: `Đơn ${o.code}: ${transition[0]} → ${transition[1]} (${ev.title})`,
          entityType: 'Order', entityId: o.id, entityCode: o.code, sourceRefCode: o.code,
          beforeSnapshot: JSON.stringify({ status: transition[0] }),
          afterSnapshot: JSON.stringify({ status: transition[1] }),
          changedFields: JSON.stringify(['status']),
          originSource: ev.actor === 'AGENT' ? 'AGENT_AUTOPILOT' : ev.actor === 'OPERATOR' ? 'MANUAL_ADMIN' : 'SYSTEM_SEED',
          actorName: actorNameOf(ev.actor, ev.type), actor: ev.actor as 'AGENT', detail: seedTag({ eventId: ev.id }),
          createdAt: ev.createdAt,
        },
      })
      synthCount++
      stats.passC++
    }
    // đơn không có event trạng thái → 1 entry tổng hợp PENDING → hiện tại
    if (synthCount === 0 && prevChangeCount === 0 && o.status !== 'PENDING' && !orderHasChange.has(o.id)) {
      const hasOrigin = await db.ledgerEntry.count({ where: { entityType: 'Order', entityId: o.id, action: 'ORDER_STATUS_SUMMARY' } })
      if (hasOrigin === 0) {
        await db.ledgerEntry.create({
          data: {
            scope: 'ORDER', action: 'ORDER_STATUS_SUMMARY',
            title: `Đơn ${o.code}: PENDING → ${o.status} (tổng hợp từ lịch sử)`,
            entityType: 'Order', entityId: o.id, entityCode: o.code, sourceRefCode: o.code,
            beforeSnapshot: JSON.stringify({ status: 'PENDING', paymentStatus: 'UNPAID' }),
            afterSnapshot: JSON.stringify({ status: o.status, paymentStatus: o.paymentStatus }),
            changedFields: JSON.stringify(['status']),
            originSource: 'AGENT_AUTOPILOT', actorName: 'Agent Tự động', actor: 'SYSTEM',
            detail: seedTag({ reconstructed: true, note: 'Tổng hợp từ trạng thái hiện tại của đơn' }),
            createdAt: o.updatedAt,
          },
        })
        stats.passC++
      }
    }
  }
  console.log(`Pass C1: đơn hàng — đã bảo đảm origin + lịch sử trạng thái`)

  // C2. VẬN ĐƠN
  const shipments = await db.shipment.findMany({ include: { order: { include: { events: { orderBy: { createdAt: 'asc' } } } } } })
  const existingShipmentEntries = await db.ledgerEntry.findMany({ where: { entityType: 'Shipment' } })
  const shipHasOrigin = new Set(existingShipmentEntries.filter((e) => e.afterSnapshot && !e.changedFields).map((e) => e.entityId))
  for (const s of shipments) {
    if (!shipHasOrigin.has(s.id)) {
      await db.ledgerEntry.create({
        data: {
          scope: 'ORDER', action: 'SHIPMENT_ORIGINAL',
          title: `Vận đơn ${s.trackingCode} tạo — báo ${s.carrier} lấy hàng đơn ${s.order.code}`,
          entityType: 'Shipment', entityId: s.id, entityCode: s.trackingCode, sourceRefCode: s.trackingCode,
          afterSnapshot: JSON.stringify({ status: 'DISPATCHED', codStatus: 'PENDING', carrier: s.carrier, trackingCode: s.trackingCode, fee: s.fee, codAmount: s.codAmount }),
          originSource: s.dispatchedBy === 'AGENT' ? 'AGENT_AUTOPILOT' : 'MANUAL_ADMIN',
          actorName: s.dispatchedBy === 'AGENT' ? 'Agent Kho vận' : 'Người vận hành',
          actor: s.dispatchedBy === 'AGENT' ? 'AGENT' : 'OPERATOR',
          detail: seedTag({ orderCode: s.order.code }), createdAt: s.createdAt,
        },
      })
      stats.passC++
    }
    // chuỗi trạng thái vận đơn từ event của đơn (timestamp thật)
    const shipStatusEntries = await db.ledgerEntry.count({ where: { entityType: 'Shipment', entityId: s.id, action: 'SHIPMENT_STATUS_CHANGED' } })
    if (shipStatusEntries === 0) {
      const idxFinal = SHIPMENT_FLOW.indexOf(s.status)
      const chain = idxFinal > 0 ? SHIPMENT_FLOW.slice(1, idxFinal + 1) : s.status !== 'DISPATCHED' ? [s.status] : []
      for (const st of chain) {
        const ev = s.order.events.find((e) => e.type === st)
        await db.ledgerEntry.create({
          data: {
            scope: 'ORDER', action: 'SHIPMENT_STATUS_CHANGED',
            title: `Vận đơn ${s.trackingCode}: ${st === 'PICKED_UP' ? 'DISPATCHED → PICKED_UP' : st === 'IN_TRANSIT' ? 'PICKED_UP → IN_TRANSIT' : st === 'DELIVERED' ? 'IN_TRANSIT → DELIVERED' : `→ ${st}`}`,
            entityType: 'Shipment', entityId: s.id, entityCode: s.trackingCode, sourceRefCode: s.order.code,
            beforeSnapshot: JSON.stringify({ status: st === 'PICKED_UP' ? 'DISPATCHED' : st === 'IN_TRANSIT' ? 'PICKED_UP' : st === 'DELIVERED' ? 'IN_TRANSIT' : 'DISPATCHED' }),
            afterSnapshot: JSON.stringify({ status: st }),
            changedFields: JSON.stringify(['status']),
            originSource: 'AGENT_AUTOPILOT', actorName: 'Agent Kho vận', actor: 'AGENT',
            detail: seedTag({ reconstructed: !ev, note: ev ? 'Theo sự kiện vận đơn' : 'Tổng hợp từ trạng thái hiện tại' }),
            createdAt: ev?.createdAt ?? s.updatedAt,
          },
        })
        stats.passC++
      }
    }
    // chuỗi COD: nếu codStatus RECEIVED/RECONCILED mà chưa có entry lineage thì tạo (bù cho shipment không có entry COD)
    const hasCodLineage = await db.ledgerEntry.count({ where: { entityType: 'Shipment', entityId: s.id, changedFields: { not: null }, OR: [{ action: 'COD_RECEIVED' }, { action: 'COD_RECONCILED' }] } })
    const neededCod = s.codStatus === 'RECEIVED' ? 1 : s.codStatus === 'RECONCILED' ? 2 : 0
    if (neededCod > 0 && hasCodLineage === 0) {
      const codBefore = s.codReceivedAt ?? s.updatedAt
      await db.ledgerEntry.create({
        data: {
          scope: 'ORDER', action: 'COD_RECEIVED',
          title: `COD ${s.order.code}: Chờ đối soát → Đã nhận ${Math.round(s.codAmount).toLocaleString('vi-VN')} ₫`,
          entityType: 'Shipment', entityId: s.id, entityCode: s.trackingCode, sourceRefCode: s.order.code,
          beforeSnapshot: JSON.stringify({ codStatus: 'PENDING' }),
          afterSnapshot: JSON.stringify({ codStatus: 'RECEIVED', codReceived: s.codReceived || s.codAmount }),
          changedFields: JSON.stringify(['codStatus']),
          originSource: 'MANUAL_ADMIN', actorName: 'Người vận hành', actor: 'OPERATOR',
          detail: seedTag({ reconstructed: true }), createdAt: codBefore,
        },
      })
      stats.passC++
      if (s.codStatus === 'RECONCILED') {
        await db.ledgerEntry.create({
          data: {
            scope: 'ORDER', action: 'COD_RECONCILED',
            title: `COD ${s.order.code}: Đã nhận → Đã đối soát vào sổ`,
            entityType: 'Shipment', entityId: s.id, entityCode: s.trackingCode, sourceRefCode: s.order.code,
            beforeSnapshot: JSON.stringify({ codStatus: 'RECEIVED' }),
            afterSnapshot: JSON.stringify({ codStatus: 'RECONCILED', codReceived: s.codReceived || s.codAmount }),
            changedFields: JSON.stringify(['codStatus']),
            originSource: 'MANUAL_ADMIN', actorName: 'Người vận hành', actor: 'OPERATOR',
            detail: seedTag({ reconstructed: true }), createdAt: s.updatedAt,
          },
        })
        stats.passC++
      }
    }
  }
  console.log('Pass C2: vận đơn — origin + chuỗi trạng thái + chuỗi COD')

  // C3. BIẾN ĐỘNG KHO — 1 entry lineage / movement (bỏ qua movement đã có entry cùng thời điểm)
  const movements = await db.stockMovement.findMany({ include: { product: { select: { id: true, sku: true, name: true } } } })
  const stockLedger = await db.ledgerEntry.findMany({
    where: { entityType: 'Product', action: { in: ['STOCK_IMPORT', 'STOCK_EXPORT', 'STOCK_ADJUST'] } },
    select: { entityId: true, action: true, createdAt: true },
  })
  const movementEntries = await db.ledgerEntry.findMany({ where: { detail: { contains: TAG }, entityType: 'Product', action: 'MOVEMENT_LINEAGE' }, select: { entityId: true } })
  const movementDone = new Set(movementEntries.map((e) => e.entityId).filter(Boolean) as string[])
  for (const m of movements) {
    if (!m.product) continue
    if (movementDone.has(m.id)) continue
    // trùng entry STOCK_* tay (cùng SP ±5s) → đã có lineage thật, bỏ qua
    const dup = stockLedger.some((l) => l.entityId === m.productId && Math.abs(l.createdAt.getTime() - m.createdAt.getTime()) < 5000)
    if (dup) continue
    const before = m.stockAfter - m.quantity
    const note = (m.note ?? '').toLowerCase()
    let origin = 'MANUAL_ADMIN'
    let actor: 'AGENT' | 'OPERATOR' | 'SYSTEM' = 'OPERATOR'
    let actorName = 'Người vận hành'
    if (note.includes('tồn đầu kỳ') || note.includes('seed')) { origin = 'SYSTEM_SEED'; actor = 'SYSTEM'; actorName = 'Hệ thống' }
    else if (note.includes('đơn dh') || m.type === 'COMBO_ISSUE' || note.includes('combo')) { origin = 'AGENT_AUTOPILOT'; actor = 'AGENT'; actorName = 'Agent Kho vận' }
    await db.ledgerEntry.create({
      data: {
        scope: 'INVENTORY',
        action: m.type === 'IMPORT' ? 'STOCK_IMPORT' : m.type === 'EXPORT' ? 'STOCK_EXPORT' : 'STOCK_ADJUST',
        title: `${m.type === 'IMPORT' ? 'Nhập kho' : m.type === 'EXPORT' ? 'Xuất kho' : 'Điều chỉnh kho'} ${m.product.sku} ${m.quantity >= 0 ? '+' : ''}${m.quantity} — ${m.note ?? 'Biến động kho'}`,
        entityType: 'Product', entityId: m.productId, entityCode: m.product.sku, sourceRefCode: m.note ?? m.product.sku,
        beforeSnapshot: JSON.stringify({ stock: before }),
        afterSnapshot: JSON.stringify({ stock: m.stockAfter }),
        changedFields: JSON.stringify(['stock']),
        originSource: origin, actorName, actor, detail: seedTag({ movementId: m.id, type: m.type }),
        createdAt: m.createdAt,
      },
    })
    stats.passC++
  }
  console.log('Pass C3: biến động kho — lineage cho từng movement')

  // C4. KHÁCH HÀNG
  const customers = await db.customer.findMany()
  const custOrigin = await db.ledgerEntry.findMany({ where: { entityType: 'Customer', action: 'CUSTOMER_ORIGINAL' }, select: { entityId: true } })
  const custOriginSet = new Set(custOrigin.map((e) => e.entityId))
  for (const c of customers) {
    if (!custOriginSet.has(c.id)) {
      await db.ledgerEntry.create({
        data: {
          scope: 'CUSTOMER', action: 'CUSTOMER_ORIGINAL',
          title: `Hồ sơ khách hàng ${c.name} khởi tạo`,
          entityType: 'Customer', entityId: c.id, entityCode: c.memberCode ?? c.phone ?? c.name, sourceRefCode: c.memberCode ?? c.phone ?? undefined,
          afterSnapshot: JSON.stringify({ name: c.name, phone: c.phone, isMember: false, points: 0 }),
          originSource: 'SYSTEM_SEED', actorName: 'Hệ thống', actor: 'SYSTEM', detail: seedTag({}),
          createdAt: c.createdAt,
        },
      })
      stats.passC++
    }
    if (c.isMember && c.memberAt) {
      const hasUpgrade = await db.ledgerEntry.count({ where: { entityType: 'Customer', entityId: c.id, action: { in: ['MEMBER_REGISTERED', 'MEMBER_UPGRADED'] } } })
      if (hasUpgrade === 0) {
        await db.ledgerEntry.create({
          data: {
            scope: 'CUSTOMER', action: 'MEMBER_UPGRADED',
            title: `${c.name} nâng cấp thành viên — mã ${c.memberCode}`,
            entityType: 'Customer', entityId: c.id, entityCode: c.memberCode, sourceRefCode: c.memberCode ?? undefined,
            beforeSnapshot: JSON.stringify({ isMember: false, points: 0 }),
            afterSnapshot: JSON.stringify({ isMember: true, memberCode: c.memberCode, points: c.points }),
            changedFields: JSON.stringify(['isMember', 'memberCode']),
            originSource: 'MANUAL_ADMIN', actorName: 'Người vận hành', actor: 'OPERATOR', detail: seedTag({}),
            createdAt: c.memberAt,
          },
        })
        stats.passC++
      }
    }
  }
  console.log('Pass C4: khách hàng — origin + nâng cấp thành viên')

  // C5. HÓA ĐƠN BÁN/MUA thiếu origin
  const salesInvoices = await db.salesInvoice.findMany({ include: { items: true } })
  const salesOrigin = new Set((await db.ledgerEntry.findMany({ where: { entityType: 'SalesInvoice', action: 'INVOICE_ORIGINAL' }, select: { entityId: true } })).map((e) => e.entityId))
  for (const inv of salesInvoices) {
    if (salesOrigin.has(inv.id)) continue
    const hasAny = await db.ledgerEntry.count({ where: { entityType: 'SalesInvoice', entityId: inv.id } })
    if (hasAny > 0) continue // đã có SALES_CREATED — Pass A đã gán nguồn gốc
    await db.ledgerEntry.create({
      data: {
        scope: 'INVOICE', action: 'INVOICE_ORIGINAL',
        title: `Hóa đơn bán ${inv.code} khởi tạo`,
        entityType: 'SalesInvoice', entityId: inv.id, entityCode: inv.code, sourceRefCode: inv.code,
        afterSnapshot: JSON.stringify({ status: inv.status, subtotal: inv.subtotal, total: inv.total, itemCount: inv.items.length }),
        originSource: 'MANUAL_ADMIN', actorName: 'Người vận hành', actor: 'OPERATOR', detail: seedTag({}),
        createdAt: inv.createdAt,
      },
    })
    stats.passC++
  }
  const purchaseInvoices = await db.purchaseInvoice.findMany({ include: { items: true } })
  const purOrigin = new Set((await db.ledgerEntry.findMany({ where: { entityType: 'PurchaseInvoice', action: 'INVOICE_ORIGINAL' }, select: { entityId: true } })).map((e) => e.entityId))
  for (const inv of purchaseInvoices) {
    if (purOrigin.has(inv.id)) continue
    const hasAny = await db.ledgerEntry.count({ where: { entityType: 'PurchaseInvoice', entityId: inv.id } })
    if (hasAny > 0) continue
    await db.ledgerEntry.create({
      data: {
        scope: 'INVOICE', action: 'INVOICE_ORIGINAL',
        title: `Hóa đơn mua ${inv.code} khởi tạo`,
        entityType: 'PurchaseInvoice', entityId: inv.id, entityCode: inv.code, sourceRefCode: inv.code,
        afterSnapshot: JSON.stringify({ status: inv.status, subtotal: inv.subtotal, total: inv.total, itemCount: inv.items.length }),
        originSource: 'MANUAL_ADMIN', actorName: 'Người vận hành', actor: 'OPERATOR', detail: seedTag({}),
        createdAt: inv.createdAt,
      },
    })
    stats.passC++
  }

  // ============ VERIFY ============
  const total = await db.ledgerEntry.count()
  const withOrigin = await db.ledgerEntry.count({ where: { originSource: { not: null } } })
  const withSnap = await db.ledgerEntry.count({ where: { afterSnapshot: { not: null } } })
  const withChanged = await db.ledgerEntry.count({ where: { changedFields: { not: null } } })
  const ordersNoOrigin: string[] = []
  for (const o of orders) {
    const n = await db.ledgerEntry.count({ where: { entityType: 'Order', entityId: o.id } })
    if (n === 0) ordersNoOrigin.push(o.code)
  }
  console.log('=== VERIFY ===')
  console.log(`Pass C tạo mới: ${stats.passC}`)
  console.log(`Tổng entry: ${total} | có originSource: ${withOrigin} | có afterSnapshot: ${withSnap} | có changedFields: ${withChanged}`)
  console.log(`Đơn hàng chưa có vết: ${ordersNoOrigin.length ? ordersNoOrigin.join(', ') : '0 — OK'}`)
  if (ordersNoOrigin.length > 0) process.exit(1)
}

main()
  .then(() => console.log('DONE'))
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
