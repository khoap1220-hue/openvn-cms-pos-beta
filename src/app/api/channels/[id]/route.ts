import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, invalidateApiCache } from '@/lib/realtime'

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

    // Khi kết nối lại HOẶC bấm Đồng bộ (sync = true): tự động đồng bộ toàn bộ sản phẩm ACTIVE lên kênh (bảo toàn 100% giá riêng kênh)
    let syncedListings = 0
    if (data.connected === true || sync === true) {
      const products = await db.product.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, attributes: true },
      })
      const existingListings = await db.channelListing.findMany({
        where: { channelId: id },
        select: { id: true, productId: true, status: true },
      })
      const existingByProdId = new Map(existingListings.map((l) => [l.productId, l]))
      const toAdd = products.filter((p) => !existingByProdId.has(p.id))
      if (toAdd.length > 0) {
        await db.channelListing.createMany({ data: toAdd.map((p) => ({ productId: p.id, channelId: id })) })
      }
      // Khôi phục trạng thái ACTIVE/UNLISTED cho các ChannelListing đã tạm dừng (INACTIVE) mà KHÔNG xóa hay ghi đè cột price
      const reactivateActiveIds: string[] = []
      const reactivateUnlistedIds: string[] = []
      for (const p of products) {
        const ex = existingByProdId.get(p.id)
        if (!ex || ex.status !== 'INACTIVE') continue
        let shouldBeUnlisted = false
        if (updated.key === 'SHOPEE' && p.attributes) {
          try {
            const a = JSON.parse(p.attributes) as Record<string, unknown>
            shouldBeUnlisted = Boolean(a.isUnlistedOnShopee)
          } catch {
            shouldBeUnlisted = false
          }
        }
        if (shouldBeUnlisted) reactivateUnlistedIds.push(ex.id)
        else reactivateActiveIds.push(ex.id)
      }
      if (reactivateActiveIds.length > 0) {
        await db.channelListing.updateMany({
          where: { id: { in: reactivateActiveIds } },
          data: { status: 'ACTIVE' },
        })
      }
      if (reactivateUnlistedIds.length > 0) {
        await db.channelListing.updateMany({
          where: { id: { in: reactivateUnlistedIds } },
          data: { status: 'UNLISTED' },
        })
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
      // Khi ngắt kết nối / tắt bán kênh: chuyển trạng thái listings sang INACTIVE thay vì deleteMany để bảo toàn 100% bảng giá riêng theo kênh (VD: 18 giá Shopee)
      const paused = await db.channelListing.updateMany({
        where: { channelId: id, status: { not: 'INACTIVE' } },
        data: { status: 'INACTIVE' },
      })
      await logLedger({
        scope: 'SETTINGS',
        action: 'CHANNEL_DISCONNECTED',
        entityType: 'Channel',
        entityId: updated.id,
        entityCode: updated.key,
        title: `Tắt bán / Ngắt kết nối kênh «${updated.name}» (tạm dừng ${paused.count} sản phẩm, bảo toàn giá riêng kênh)`,
        detail: { channelKey: updated.key, pausedListings: paused.count, pricesPreserved: true },
        actor: 'OPERATOR',
      })
      broadcast('product.updated', { channelId: id, disconnected: true })
    }

    invalidateApiCache('channels')
    invalidateApiCache('products')
    broadcast('channel.updated', { id: updated.id, key: updated.key, connected: updated.connected })
    broadcast('product.updated', { channelId: updated.id, connected: updated.connected })
    return NextResponse.json({ channel: updated, syncedListings })
  } catch (error) {
    console.error('Channel PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật kênh' }, { status: 500 })
  }
}

export const PUT = PATCH
