import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

// PATCH: kết nối / ngắt kết nối / đồng bộ kênh / cấu hình % phí sàn TMĐT
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { connected, sync } = body as { connected?: boolean; sync?: boolean }

    const channel = await db.channel.findUnique({ where: { id } })
    if (!channel) return NextResponse.json({ error: 'Không tìm thấy kênh' }, { status: 404 })

    const data: { connected?: boolean; syncedAt?: Date; feePercent?: number } = {}
    if (typeof connected === 'boolean') data.connected = connected
    if (sync) data.syncedAt = new Date()

    // Cấu hình % phí sàn: tự động trừ khi đối soát đơn hàng (snapshot trên từng đơn mới)
    if (body.feePercent !== undefined) {
      const fee = Number(body.feePercent)
      if (!Number.isFinite(fee) || fee < 0 || fee > 100) {
        return NextResponse.json({ error: 'Phí sàn phải là số từ 0 đến 100 (%)' }, { status: 400 })
      }
      data.feePercent = Math.round(fee * 10) / 10
    }

    const updated = await db.channel.update({ where: { id }, data })

    // Khi kết nối lại HOẶC bấm Đồng bộ (sync = true): tự động đồng bộ toàn bộ sản phẩm ACTIVE lên kênh
    let syncedListings = 0
    if (data.connected === true || sync === true) {
      const products = await db.product.findMany({ where: { status: 'ACTIVE' }, select: { id: true } })
      const existingListings = await db.channelListing.findMany({ where: { channelId: id }, select: { productId: true } })
      const existingIds = new Set(existingListings.map((l) => l.productId))
      const toAdd = products.filter((p) => !existingIds.has(p.id))
      if (toAdd.length > 0) {
        await db.channelListing.createMany({ data: toAdd.map((p) => ({ productId: p.id, channelId: id })) })
      }
      syncedListings = products.length

      if (sync === true) {
        let sessionAlive = true
        let daemonOnline = false
        if (updated.key === 'SHOPEE') {
          const bridgeBase = process.env.SHOPEE_SYNC_PORT
            ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}`
            : 'http://127.0.0.1:51898'
          try {
            const stRes = await fetch(`${bridgeBase}/shopee/status`, {
              method: 'GET',
              signal: AbortSignal.timeout(1500),
              cache: 'no-store',
            })
            if (stRes.ok) {
              const stJson = (await stRes.json()) as { ok?: boolean; alive?: boolean; dryRun?: boolean }
              daemonOnline = Boolean(stJson.ok)
              sessionAlive = Boolean(stJson.alive || stJson.dryRun)
            } else {
              sessionAlive = false
            }
          } catch {
            daemonOnline = false
            sessionAlive = false
          }

          if (daemonOnline) {
            void fetch(`${bridgeBase}/shopee/trigger-sync`, {
              method: 'POST',
              signal: AbortSignal.timeout(8000),
            }).catch(() => null)
          }
        }
        await logLedger({
          scope: 'SETTINGS',
          action: 'CHANNEL_SYNCED',
          entityType: 'Channel',
          entityId: updated.id,
          entityCode: updated.key,
          title: `Đồng bộ kênh bán «${updated.name}» (${syncedListings} sản phẩm ACTIVE, thêm mới ${toAdd.length})${updated.key === 'SHOPEE' && !sessionAlive ? ' [Phiên Cookie hết hạn — Xếp hàng đợi bất đồng bộ]' : ''}`,
          detail: { channelKey: updated.key, syncedListings, addedListings: toAdd.length, sessionAlive },
          actor: 'OPERATOR',
        })
        broadcast('channel.updated', {
          id: updated.id,
          key: updated.key,
          connected: updated.connected,
          sessionAlive,
        })
        broadcast('product.updated', { channelId: updated.id, connected: updated.connected })
        return NextResponse.json({
          channel: updated,
          syncedListings,
          sessionAlive,
          daemonOnline,
          queuedAsync: updated.key === 'SHOPEE' && !sessionAlive,
        })
      }
    } else if (data.connected === false) {
      // Khi ngắt kết nối / tắt bán kênh: tự động gỡ toàn bộ listings của kênh này để đồng bộ tức thì
      const removed = await db.channelListing.deleteMany({ where: { channelId: id } })
      await logLedger({
        scope: 'SETTINGS',
        action: 'CHANNEL_DISCONNECTED',
        entityType: 'Channel',
        entityId: updated.id,
        entityCode: updated.key,
        title: `Tắt bán / Ngắt kết nối kênh «${updated.name}» (đã gỡ ${removed.count} sản phẩm khỏi kênh)`,
        detail: { channelKey: updated.key, removedListings: removed.count },
        actor: 'OPERATOR',
      })
      broadcast('product.updated', { channelId: id, disconnected: true })
    }

    broadcast('channel.updated', { id: updated.id, key: updated.key, connected: updated.connected })
    broadcast('product.updated', { channelId: updated.id, connected: updated.connected })
    return NextResponse.json({ channel: updated, syncedListings })
  } catch (error) {
    console.error('Channel PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật kênh' }, { status: 500 })
  }
}

export const PUT = PATCH
