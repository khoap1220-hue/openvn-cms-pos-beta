import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, invalidateApiCache, patchProductInApiCache } from '@/lib/realtime'
import { DEFAULT_SHOPEE_SHOP_BINDING } from '@/lib/shopee-extension-bundle'

export const dynamic = 'force-dynamic'

export type AsyncQueueItemStatus =
  | 'PENDING'
  | 'WAITING_SESSION'
  | 'RETRYING'
  | 'DEAD_LETTER'
  | 'BROKEN_LINK'

export interface AsyncQueueItem {
  productId: string
  sku: string
  name: string
  image: string | null
  shopeeItemId: string
  shopeeModelId: string
  shopeeModelName: string
  cmsStock: number
  targetStock: number
  lastSyncedStock: number
  cmsSellPrice: number
  targetPrice: number
  lastSyncedPrice: number
  targetUnlisted: boolean
  status: AsyncQueueItemStatus
  changeSummary: string
  reason: string | null
  queuedAt: string
}

export interface AsyncChannelAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  ctaType: 'RECONNECT_COOKIE' | 'OPEN_ASYNC_QUEUE'
}

interface DaemonBridgeStatus {
  ok?: boolean
  alive?: boolean
  paused?: boolean
  dryRun?: boolean
  shopId?: string
  username?: string
  lastSync?: number | string | null
  deferredOutboxCount?: number
  lastAlertReason?: string
  asyncQueue?: {
    inboundPending?: number
    dlqCount?: number
    deferredOutboxCount?: number
  }
}

async function fetchBridgeStatus(bridgePort: string): Promise<DaemonBridgeStatus | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/shopee/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(1500),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as DaemonBridgeStatus
    return data?.ok ? data : null
  } catch {
    return null
  }
}

async function buildAsyncQueueSnapshot() {
  const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'
  const [shopeeChannel, shopeeCred, daemon, activeProducts, ledgerRows] = await Promise.all([
    db.channel.findUnique({ where: { key: 'SHOPEE' } }),
    db.integrationCredential.findUnique({ where: { provider: 'SHOPEE' } }),
    fetchBridgeStatus(bridgePort),
    db.product.findMany({
      where: { status: { not: 'INACTIVE' } },
      include: { listings: { include: { channel: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    db.ledgerEntry.findMany({
      where: {
        scope: 'CHANNEL',
        action: {
          in: [
            'OUTBOX_PENDING',
            'OUTBOX_DEAD_LETTER',
            'OUTBOX_BROKEN_LINK',
            'UNLINKED_MARKETPLACE_ITEM',
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 250,
    }),
  ])

  let configuredShopId: string = DEFAULT_SHOPEE_SHOP_BINDING.shopId
  let configuredUsername: string = DEFAULT_SHOPEE_SHOP_BINDING.username
  if (shopeeCred?.config) {
    try {
      const cfg = JSON.parse(shopeeCred.config) as { shopId?: string | number; username?: string }
      if (cfg.shopId) configuredShopId = String(cfg.shopId)
      if (cfg.username) configuredUsername = String(cfg.username)
    } catch {
      // Giữ thông tin shop mặc định
    }
  }

  const shopId = String(daemon?.shopId || configuredShopId)
  const username = String(daemon?.username || configuredUsername)
  const shopeeChannelEnabled = Boolean(shopeeChannel?.connected ?? true)
  const daemonOnline = Boolean(daemon)
  const sessionAlive = Boolean(daemon?.alive || daemon?.dryRun)

  const connectionState: 'CONNECTED' | 'SESSION_EXPIRED' | 'DAEMON_OFFLINE' | 'CHANNEL_DISABLED' =
    !shopeeChannelEnabled
      ? 'CHANNEL_DISABLED'
      : sessionAlive
        ? 'CONNECTED'
        : daemonOnline
          ? 'SESSION_EXPIRED'
          : 'DAEMON_OFFLINE'

  const latestOutboxByProduct = new Map<
    string,
    { action: string; createdAt: string; error?: string }
  >()
  const unlinkedModelKeys = new Set<string>()

  for (const row of ledgerRows) {
    if (row.action === 'UNLINKED_MARKETPLACE_ITEM') {
      if (row.entityCode) unlinkedModelKeys.add(row.entityCode)
      continue
    }
    if (!row.entityId || latestOutboxByProduct.has(row.entityId)) continue
    let parsedErr: string | undefined
    if (row.detail) {
      try {
        const d = JSON.parse(row.detail) as { error?: string }
        if (d.error) parsedErr = String(d.error)
      } catch {
        // ignore
      }
    }
    latestOutboxByProduct.set(row.entityId, {
      action: row.action,
      createdAt: row.createdAt.toISOString(),
      error: parsedErr,
    })
  }

  const items: AsyncQueueItem[] = []

  for (const p of activeProducts) {
    let attrs: Record<string, unknown> = {}
    if (p.attributes) {
      try {
        attrs = JSON.parse(p.attributes) as Record<string, unknown>
      } catch {
        attrs = {}
      }
    }

    const shopeeItemId = String(attrs.shopeeItemId || '').trim()
    const shopeeModelId = String(attrs.shopeeModelId || '').trim()
    const shopeeModelName = String(attrs.shopeeModelName || attrs.modelName || '').trim()
    const ledgerState = latestOutboxByProduct.get(p.id)
    const isLinked = Boolean(shopeeItemId && shopeeItemId !== '0')

    if (!isLinked && !ledgerState) continue

    const shopeeListing = p.listings.find((l) => l.channel.key === 'SHOPEE')
    const targetStock = typeof attrs.cmsTargetStock === 'number' ? attrs.cmsTargetStock : p.stock
    const targetPrice =
      typeof attrs.cmsTargetPrice === 'number'
        ? attrs.cmsTargetPrice
        : shopeeListing?.price ?? p.sellPrice
    const targetUnlisted =
      typeof attrs.cmsTargetUnlisted === 'boolean'
        ? attrs.cmsTargetUnlisted
        : Boolean(attrs.isUnlistedOnShopee)

    const lastSyncedStock =
      typeof attrs.lastSyncedShopeeStock === 'number' ? attrs.lastSyncedShopeeStock : p.stock
    const lastSyncedPrice =
      typeof attrs.lastSyncedShopeePrice === 'number' ? attrs.lastSyncedShopeePrice : targetPrice
    const lastSyncedUnlisted =
      typeof attrs.lastSyncedShopeeUnlisted === 'boolean' ? attrs.lastSyncedShopeeUnlisted : null

    const hasPendingLedger = ledgerState?.action === 'OUTBOX_PENDING'
    const hasDeadLetterLedger = ledgerState?.action === 'OUTBOX_DEAD_LETTER'
    const hasBrokenLinkLedger = ledgerState?.action === 'OUTBOX_BROKEN_LINK'
    const brokenFlag = Boolean(attrs.brokenMarketplaceLink) || hasBrokenLinkLedger

    const suppressedKey = `${targetStock}_${targetPrice}_${targetUnlisted ? 1 : 0}`
    const isSuppressed =
      !hasPendingLedger &&
      typeof attrs.outboxSuppressedKey === 'string' &&
      attrs.outboxSuppressedKey === suppressedKey

    const stockDrifted = isLinked && lastSyncedStock !== targetStock
    const priceDrifted = isLinked && lastSyncedPrice > 0 && lastSyncedPrice !== targetPrice
    const unlistedDrifted =
      isLinked &&
      (typeof attrs.cmsTargetUnlisted === 'boolean' ||
        (lastSyncedUnlisted !== null && lastSyncedUnlisted !== targetUnlisted))
    const imageDrifted = Boolean(
      (typeof attrs.cmsTargetImage === 'string' && attrs.cmsTargetImage.trim()) ||
        attrs.pendingCdnOffload
    )

    const needsOutbox =
      !isSuppressed &&
      (hasPendingLedger ||
        Boolean(attrs.pendingOutboxSync) ||
        stockDrifted ||
        priceDrifted ||
        unlistedDrifted ||
        imageDrifted)

    if (!brokenFlag && !hasDeadLetterLedger && attrs.outboxState !== 'DEAD_LETTER' && !needsOutbox) {
      continue
    }

    let status: AsyncQueueItemStatus = 'PENDING'
    if (brokenFlag) {
      status = 'BROKEN_LINK'
    } else if (hasDeadLetterLedger || attrs.outboxState === 'DEAD_LETTER') {
      status = 'DEAD_LETTER'
    } else if (!sessionAlive || attrs.outboxState === 'WAITING_SESSION') {
      status = 'WAITING_SESSION'
    } else if (attrs.outboxState === 'RETRYING') {
      status = 'RETRYING'
    } else {
      status = 'PENDING'
    }

    const changes: string[] = []
    if (stockDrifted || typeof attrs.cmsTargetStock === 'number') {
      changes.push(`Tồn: ${lastSyncedStock} ➔ ${targetStock}`)
    }
    if (priceDrifted || typeof attrs.cmsTargetPrice === 'number') {
      changes.push(
        `Giá: ${lastSyncedPrice.toLocaleString('vi-VN')}₫ ➔ ${targetPrice.toLocaleString('vi-VN')}₫`
      )
    }
    if (unlistedDrifted) {
      changes.push(targetUnlisted ? 'Tạm ẩn trên Sàn' : 'Mở bán lại trên Sàn')
    }
    if (imageDrifted) {
      changes.push('Đồng bộ ảnh CDN')
    }
    if (changes.length === 0) {
      changes.push(`Đồng bộ tồn (${targetStock}) & giá (${targetPrice.toLocaleString('vi-VN')}₫)`)
    }

    const reason =
      status === 'BROKEN_LINK'
        ? String(
            attrs.brokenLinkReason ||
              ledgerState?.error ||
              'Mã sản phẩm / phân loại trên Shopee không còn khớp'
          )
        : status === 'DEAD_LETTER' || status === 'RETRYING'
          ? String(attrs.outboxError || ledgerState?.error || 'Lỗi kết nối tạm thời khi gọi Shopee API')
          : status === 'WAITING_SESSION'
            ? 'Đang giữ an toàn trong hàng đợi — tự động đẩy ngay khi khôi phục Cookie Shopee'
            : null

    items.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      image: p.image,
      shopeeItemId,
      shopeeModelId,
      shopeeModelName,
      cmsStock: p.stock,
      targetStock,
      lastSyncedStock,
      cmsSellPrice: p.sellPrice,
      targetPrice,
      lastSyncedPrice,
      targetUnlisted,
      status,
      changeSummary: changes.join(' · '),
      reason,
      queuedAt: String(
        attrs.lastOutboxSyncAt ||
          attrs.lastCmsEditAt ||
          ledgerState?.createdAt ||
          p.updatedAt.toISOString()
      ),
    })
  }

  const pendingCount = items.filter((i) => i.status === 'PENDING' || i.status === 'RETRYING').length
  const waitingSessionCount = items.filter((i) => i.status === 'WAITING_SESSION').length
  const itemDeadLetterCount = items.filter((i) => i.status === 'DEAD_LETTER').length
  const daemonDlqCount = Number(daemon?.asyncQueue?.dlqCount ?? 0)
  const deadLetterCount = Math.max(itemDeadLetterCount, daemonDlqCount)
  const brokenLinkCount = items.filter((i) => i.status === 'BROKEN_LINK').length
  const inboundSpoolPending = Number(daemon?.asyncQueue?.inboundPending ?? 0)
  const unlinkedMarketplaceCount = unlinkedModelKeys.size

  const alerts: AsyncChannelAlert[] = []

  if (shopeeChannelEnabled && !sessionAlive) {
    const queuedTotal = waitingSessionCount + pendingCount
    alerts.push({
      id: 'SHOPEE_SESSION_DISCONNECTED',
      severity: queuedTotal > 0 || deadLetterCount > 0 ? 'critical' : 'warning',
      title: !daemonOnline
        ? `Mất kết nối Trạm đồng bộ Shopee (${username} · #${shopId})`
        : `Mất liên kết phiên Cookie Shopee (${username} · #${shopId})`,
      description:
        queuedTotal > 0
          ? `Hệ thống đang bảo toàn ${queuedTotal} thay đổi giá/tồn trong Hàng đợi Bất đồng bộ (0 mất dữ liệu, 0 đốt lượt thử). Hãy dán lệnh cURL hoặc bật Extension Shop để tự động đồng bộ ngay.`
          : `Phiên Cookie Kênh Người Bán đã hết hạn. Bạn vẫn có thể bán hàng POS và sửa giá/tồn bình thường — mọi thay đổi sẽ được xếp vào Hàng đợi Bất đồng bộ và tự đẩy lên Sàn khi kết nối lại.`,
      ctaType: 'RECONNECT_COOKIE',
    })
  }

  if (brokenLinkCount > 0) {
    alerts.push({
      id: 'SHOPEE_BROKEN_PRODUCT_LINKS',
      severity: 'critical',
      title: `Cảnh báo: ${brokenLinkCount} sản phẩm bị đứt liên kết mã Item/Model trên Sàn Shopee`,
      description:
        'Phân loại hoặc sản phẩm tương ứng trên Shopee đã bị xóa / thay đổi Model ID. Hãy mở Hàng đợi Bất đồng bộ để kiểm tra và liên kết lại.',
      ctaType: 'OPEN_ASYNC_QUEUE',
    })
  }

  if (deadLetterCount > 0) {
    alerts.push({
      id: 'SHOPEE_OUTBOX_DEAD_LETTER',
      severity: 'warning',
      title: `Có ${deadLetterCount} tác vụ đồng bộ tạm dừng trong Hàng đợi Lỗi (DLQ)`,
      description:
        'Các tác vụ này gặp lỗi mạng quá số lần thử tự động. Bạn có thể bấm «Thử lại mục lỗi» để xếp hàng đồng bộ lại.',
      ctaType: 'OPEN_ASYNC_QUEUE',
    })
  }

  return {
    ok: true,
    connection: {
      shopeeChannelEnabled,
      daemonOnline,
      sessionAlive,
      state: connectionState,
      shopId,
      username,
      lastSync: daemon?.lastSync ?? null,
      lastAlertReason: daemon?.lastAlertReason || null,
    },
    summary: {
      totalActionable: pendingCount + waitingSessionCount + deadLetterCount + brokenLinkCount,
      pendingCount,
      waitingSessionCount,
      deadLetterCount,
      brokenLinkCount,
      inboundSpoolPending,
      unlinkedMarketplaceCount,
    },
    alerts,
    items,
  }
}

export async function GET() {
  try {
    const snapshot = await buildAsyncQueueSnapshot()
    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('GET /api/channels/async-queue error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể tải trạng thái Hàng đợi Bất đồng bộ' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'FLUSH_NOW' | 'RETRY_FAILED' | 'CANCEL_ITEM'
      productId?: string
    }
    const action = body.action || 'FLUSH_NOW'
    const bridgePort = process.env.SHOPEE_SYNC_PORT || '51898'

    if (action === 'FLUSH_NOW') {
      await db.ledgerEntry.updateMany({
        where: {
          scope: 'CHANNEL',
          action: 'OUTBOX_DEFERRED',
        },
        data: {
          action: 'OUTBOX_PENDING',
        },
      })

      let triggered = false
      try {
        const tr = await fetch(`http://127.0.0.1:${bridgePort}/shopee/trigger-sync`, {
          method: 'POST',
          signal: AbortSignal.timeout(4000),
        })
        triggered = tr.ok
      } catch {
        triggered = false
      }

      invalidateApiCache('channels:product-links')
      broadcast('outbox.updated', { action: 'FLUSH_NOW', triggered })
      const snapshot = await buildAsyncQueueSnapshot()
      return NextResponse.json({
        ...snapshot,
        triggered,
        message: snapshot.connection.sessionAlive
          ? 'Đã kích hoạt xả Hàng đợi Bất đồng bộ lên Sàn Shopee!'
          : 'Phiên Cookie Shopee hiện chưa kết nối — Hàng đợi vẫn được giữ an toàn và sẽ tự động xả ngay khi bạn nạp lại Cookie.',
      })
    }

    if (action === 'RETRY_FAILED') {
      const targetProductId = body.productId ? String(body.productId).trim() : undefined
      const daemon = await fetchBridgeStatus(bridgePort)
      const sessionAlive = Boolean(daemon?.alive || daemon?.dryRun)

      const targetEntries = await db.ledgerEntry.findMany({
        where: {
          scope: 'CHANNEL',
          action: { in: ['OUTBOX_DEAD_LETTER', 'OUTBOX_BROKEN_LINK', 'OUTBOX_DEFERRED'] },
          ...(targetProductId ? { entityId: targetProductId } : {}),
        },
        select: { id: true, entityId: true },
      })

      const affectedProductIds = new Set<string>()
      if (targetProductId) affectedProductIds.add(targetProductId)
      for (const e of targetEntries) {
        if (e.entityId) affectedProductIds.add(e.entityId)
      }

      if (targetEntries.length > 0) {
        await db.ledgerEntry.updateMany({
          where: { id: { in: targetEntries.map((e) => e.id) } },
          data: { action: 'OUTBOX_PENDING' },
        })
      }

      for (const pid of affectedProductIds) {
        const prod = await db.product.findUnique({ where: { id: pid } })
        if (!prod) continue
        let attrs: Record<string, unknown> = {}
        try {
          attrs = prod.attributes ? (JSON.parse(prod.attributes) as Record<string, unknown>) : {}
        } catch {
          attrs = {}
        }
        attrs.pendingOutboxSync = true
        attrs.outboxState = sessionAlive ? 'PENDING' : 'WAITING_SESSION'
        delete attrs.outboxError
        delete attrs.brokenMarketplaceLink
        delete attrs.brokenLinkReason
        delete attrs.brokenLinkDetectedAt
        delete attrs.outboxSuppressedKey
        const nextJson = JSON.stringify(attrs)
        await db.product.update({
          where: { id: prod.id },
          data: { attributes: nextJson },
        })
        patchProductInApiCache(prod.id, { attributes: nextJson })

        const hasPending = await db.ledgerEntry.count({
          where: { scope: 'CHANNEL', action: 'OUTBOX_PENDING', entityId: prod.id },
        })
        if (hasPending === 0) {
          await logLedger({
            scope: 'CHANNEL',
            action: 'OUTBOX_PENDING',
            entityType: 'Product',
            entityId: prod.id,
            entityCode: prod.sku,
            title: `[THỬ LẠI HÀNG ĐỢI BẤT ĐỒNG BỘ] Xếp lại đồng bộ [${prod.sku}] lên Sàn Shopee`,
            detail: {
              direction: 'CMS_TO_SHOPEE',
              sku: prod.sku,
              targetStock: prod.stock,
              targetPrice: prod.sellPrice,
              reason: 'MANUAL_RETRY_FROM_ASYNC_QUEUE',
            },
            actor: 'OPERATOR',
            originSource: 'MANUAL_ADMIN',
          })
        }
      }

      try {
        await fetch(`http://127.0.0.1:${bridgePort}/shopee/retry-dlq`, {
          method: 'POST',
          signal: AbortSignal.timeout(4000),
        })
      } catch {
        // Bỏ qua nếu daemon chưa bật
      }

      invalidateApiCache('channels:product-links')
      invalidateApiCache('products')
      broadcast('outbox.updated', { action: 'RETRY_FAILED', count: affectedProductIds.size })

      const snapshot = await buildAsyncQueueSnapshot()
      return NextResponse.json({
        ...snapshot,
        retriedCount: affectedProductIds.size,
        message: sessionAlive
          ? `Đã xếp lại ${affectedProductIds.size || 1} tác vụ vào hàng đợi và đang đồng bộ lên Sàn Shopee.`
          : `Đã chuyển tác vụ về trạng thái Chờ kết nối — hệ thống sẽ tự động đẩy ngay khi nạp lại Cookie Shopee.`,
      })
    }

    if (action === 'CANCEL_ITEM') {
      const productId = String(body.productId || '').trim()
      if (!productId) {
        return NextResponse.json({ ok: false, error: 'Thiếu productId cần hủy' }, { status: 400 })
      }
      const prod = await db.product.findUnique({
        where: { id: productId },
        include: { listings: { include: { channel: true } } },
      })
      if (!prod) {
        return NextResponse.json({ ok: false, error: 'Không tìm thấy sản phẩm' }, { status: 404 })
      }

      let attrs: Record<string, unknown> = {}
      try {
        attrs = prod.attributes ? (JSON.parse(prod.attributes) as Record<string, unknown>) : {}
      } catch {
        attrs = {}
      }

      const shopeeListing = prod.listings.find((l) => l.channel.key === 'SHOPEE')
      const effPrice = shopeeListing?.price ?? prod.sellPrice
      const effUnlisted = Boolean(attrs.isUnlistedOnShopee)
      const lastSyncedStock =
        typeof attrs.lastSyncedShopeeStock === 'number' ? attrs.lastSyncedShopeeStock : prod.stock
      const lastSyncedPrice =
        typeof attrs.lastSyncedShopeePrice === 'number' ? attrs.lastSyncedShopeePrice : effPrice

      attrs.pendingOutboxSync = false
      delete attrs.cmsTargetStock
      delete attrs.cmsTargetPrice
      delete attrs.cmsTargetUnlisted
      delete attrs.cmsTargetImage
      delete attrs.outboxState
      delete attrs.outboxError
      delete attrs.lastOutboxDeferredAt
      delete attrs.brokenMarketplaceLink
      delete attrs.brokenLinkReason
      delete attrs.brokenLinkDetectedAt

      if (lastSyncedStock !== prod.stock || lastSyncedPrice !== effPrice) {
        attrs.outboxSuppressedKey = `${prod.stock}_${effPrice}_${effUnlisted ? 1 : 0}`
      } else {
        delete attrs.outboxSuppressedKey
      }

      const nextJson = JSON.stringify(attrs)
      await Promise.all([
        db.product.update({
          where: { id: prod.id },
          data: { attributes: nextJson },
        }),
        db.ledgerEntry.updateMany({
          where: {
            scope: 'CHANNEL',
            action: {
              in: ['OUTBOX_PENDING', 'OUTBOX_DEAD_LETTER', 'OUTBOX_BROKEN_LINK', 'OUTBOX_DEFERRED'],
            },
            entityId: prod.id,
          },
          data: {
            action: 'OUTBOX_CANCELLED',
          },
        }),
      ])
      patchProductInApiCache(prod.id, { attributes: nextJson })
      invalidateApiCache('channels:product-links')
      invalidateApiCache('products')
      broadcast('outbox.updated', { action: 'CANCEL_ITEM', productId: prod.id, sku: prod.sku })

      const snapshot = await buildAsyncQueueSnapshot()
      return NextResponse.json({
        ...snapshot,
        cancelledSku: prod.sku,
        message: `Đã hủy yêu cầu đồng bộ chờ của mã [${prod.sku}].`,
      })
    }

    return NextResponse.json({ ok: false, error: 'Hành động không hợp lệ' }, { status: 400 })
  } catch (error) {
    console.error('POST /api/channels/async-queue error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể xử lý thao tác Hàng đợi Bất đồng bộ' },
      { status: 500 }
    )
  }
}
