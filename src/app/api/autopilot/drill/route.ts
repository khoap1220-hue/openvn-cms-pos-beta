import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { logActivity } from '@/lib/agent-log'
import { logLedgerAsync } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

interface DrillBody {
  channel?: string
  customerName?: string
  itemSku?: string
  quantity?: number
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as DrillBody
    const rawChannel = body.channel || 'SHOPEE'
    const channelKey = rawChannel.trim().toUpperCase()

    // 1. Tìm hoặc khởi tạo kênh bán đa kênh
    let channel = await db.channel.findFirst({
      where: { key: channelKey },
    })

    if (!channel) {
      channel = await db.channel.findFirst({
        where: { key: { contains: channelKey } },
      })
    }

    if (!channel) {
      channel = await db.channel.create({
        data: {
          key: channelKey,
          name: channelKey === 'SHOPEE' ? 'Shopee' : channelKey === 'TIKTOK' ? 'TikTok Shop' : channelKey,
          color: channelKey === 'SHOPEE' ? '#EE4D2D' : channelKey === 'TIKTOK' ? '#FE2C55' : '#10B981',
          connected: true,
          feePercent: channelKey === 'SHOPEE' ? 8.5 : channelKey === 'TIKTOK' ? 6 : 0,
        },
      })
    }

    // 2. Tìm sản phẩm theo SKU hoặc lấy sản phẩm active
    let product: any = null
    if (body.itemSku?.trim()) {
      product = await db.product.findUnique({
        where: { sku: body.itemSku.trim() },
      })
    }

    if (!product) {
      product = await db.product.findFirst({
        where: { status: 'ACTIVE', stock: { gt: 0 } },
      })
    }

    if (!product) {
      product = await db.product.findFirst()
    }

    if (!product) {
      return NextResponse.json({ error: 'Không tìm thấy sản phẩm khả dụng để diễn tập' }, { status: 400 })
    }

    // 3. Khách hàng diễn tập
    const custName = body.customerName?.trim() || `Khách Diễn Tập ${channel.name}`
    let customer = await db.customer.findFirst({
      where: { name: custName },
    })

    if (!customer) {
      customer = await db.customer.create({
        data: {
          name: custName,
          phone: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
          address: '123 Phố Diễn Tập Đa Kênh, Hoàn Kiếm, Hà Nội',
        },
      })
    }

    // 4. Giá & Tổng tiền
    const qty = Math.max(1, Math.floor(Number(body.quantity) || 1))
    const listing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: product.id, channelId: channel.id } },
    })
    const unitPrice = listing?.price ?? product.sellPrice
    const subtotal = unitPrice * qty
    const shippingFee = 25000
    const total = subtotal + shippingFee
    const platformFeePct = channel.feePercent
    const platformFee = Math.round((subtotal * platformFeePct) / 100)

    // Tạo mã đơn có chứa test prefix nếu có để dọn dẹp an toàn
    const prefixMatch = body.customerName?.match(/(R5-[A-Za-z0-9_-]+)/)
    const prefixTag = prefixMatch ? `${prefixMatch[1]}-` : ''
    const code = `DRILL-${channel.key}-${prefixTag}${Date.now().toString().slice(-6)}`

    // 5. Tạo đơn hàng và chi tiết trong transaction
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          code,
          channelId: channel.id,
          customerId: customer.id,
          status: 'PENDING',
          paymentMethod: 'COD',
          paymentStatus: 'UNPAID',
          subtotal,
          shippingFee,
          total,
          platformFeePct,
          platformFee,
          address: customer.address || 'Hà Nội',
          items: {
            create: [
              {
                productId: product.id,
                quantity: qty,
                price: unitPrice,
              },
            ],
          },
        },
        include: {
          customer: true,
          channel: true,
          items: {
            include: { product: true },
          },
        },
      })

      return created
    })

    // Ghi log hoạt động và sổ cái
    logLedgerAsync({
      scope: 'ORDER',
      action: 'SIMULATED',
      entityType: 'Order',
      entityId: order.id,
      entityCode: order.code,
      title: `Diễn tập đơn hàng đa kênh ${order.code} qua ${channel.name}`,
      detail: { channelKey: channel.key, customer: customer.name, itemSku: product.sku },
      actor: 'SYSTEM',
    })

    logActivity({
      agent: 'DISPATCHER',
      action: 'DRILL',
      message: `Diễn tập đơn hàng đa kênh: tiếp nhận đơn ${order.code} từ sàn ${channel.name}`,
      detail: `Khách hàng: ${customer.name} · SP: ${product.name} (x${qty})`,
    })

    broadcast('order.created', order)

    return NextResponse.json({
      success: true,
      order,
    })
  } catch (error) {
    console.error('Lỗi khi diễn tập đơn hàng đa kênh:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi nội bộ khi diễn tập đơn hàng' },
      { status: 500 }
    )
  }
}
