import { NextRequest, NextResponse } from 'next/server'
import { extractClientIp } from '@/lib/auth'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { broadcast, getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import {
  DEFAULT_STOREFRONT_BANNERS,
  computeWholesaleUnitPrice,
  getStorefrontConfigForCurrentCms,
  resolveActiveWholesaleTier,
} from '@/lib/storefront-config'

export const dynamic = 'force-dynamic'

function buildStorefrontCorsHeaders(req?: NextRequest): Record<string, string> {
  const origin = req?.headers.get('origin')?.trim()
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, X-Storefront-Domain',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Chống spam biểu mẫu công khai theo IP (tối đa 20 yêu cầu / 60 giây / IP)
const publicRateBucket = new Map<string, { count: number; resetAt: number }>()

function checkPublicRateLimit(ip: string): boolean {
  const now = Date.now()
  if (publicRateBucket.size > 2_000) {
    for (const [k, v] of publicRateBucket.entries()) {
      if (v.resetAt <= now) publicRateBucket.delete(k)
    }
  }
  const key = ip || 'unknown'
  const current = publicRateBucket.get(key)
  if (!current || current.resetAt <= now) {
    publicRateBucket.set(key, { count: 1, resetAt: now + 60_000 })
    return true
  }
  if (current.count >= 20) return false
  current.count += 1
  return true
}

function splitProductTitleAndVariant(fullName: string): {
  cleanTitle: string
  variantLabel: string | null
} {
  const marker = '— Phân loại:'
  const idx = fullName.indexOf(marker)
  if (idx > 0) {
    return {
      cleanTitle: fullName.slice(0, idx).trim(),
      variantLabel: fullName.slice(idx + marker.length).trim() || null,
    }
  }
  return { cleanTitle: fullName.trim(), variantLabel: null }
}

function normalizePhoneDigits(raw: string): string {
  return String(raw || '').replace(/[^\d+]/g, '').slice(0, 16)
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: buildStorefrontCorsHeaders(req),
  })
}

export async function GET(req: NextRequest) {
  const corsHeaders = buildStorefrontCorsHeaders(req)
  try {
    // 1. Tra cứu trạng thái đơn hàng / yêu cầu báo giá sỉ theo mã tham chiếu + 4 số cuối SĐT
    const lookupCode = req.nextUrl.searchParams.get('lookupCode')?.trim().toUpperCase()
    const lookupPhone = normalizePhoneDigits(req.nextUrl.searchParams.get('phone') || '')
    if (lookupCode) {
      if (lookupPhone.replace(/\D/g, '').length < 4) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Vui lòng nhập ít nhất 4 số cuối số điện thoại đặt hàng để tra cứu.',
          },
          { status: 400, headers: corsHeaders }
        )
      }

      const phoneTail = lookupPhone.replace(/\D/g, '').slice(-4)

      const [ledgerHit, orderHit] = await Promise.all([
        db.ledgerEntry.findFirst({
          where: {
            entityCode: lookupCode,
            action: {
              in: ['WEB_STOREFRONT_ORDER', 'WEB_WHOLESALE_INQUIRY', 'WEB_CONTACT_MESSAGE'],
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        db.order.findUnique({
          where: { code: lookupCode },
          include: {
            customer: { select: { phone: true, name: true } },
            shipments: { select: { carrier: true, trackingCode: true, status: true } },
          },
        }),
      ])

      if (orderHit) {
        const custTail = (orderHit.customer?.phone || '').replace(/\D/g, '').slice(-4)
        if (custTail && custTail !== phoneTail) {
          return NextResponse.json(
            { ok: false, error: 'Số điện thoại không khớp với mã đơn hàng tra cứu.' },
            { status: 404, headers: corsHeaders }
          )
        }
        return NextResponse.json(
          {
            ok: true,
            found: true,
            source: 'CMS_ORDER',
            code: orderHit.code,
            status: orderHit.status,
            paymentStatus: orderHit.paymentStatus,
            total: orderHit.total,
            createdAt: orderHit.createdAt,
            shipment: orderHit.shipments[0] ?? null,
          },
          { headers: corsHeaders }
        )
      }

      if (ledgerHit) {
        let det: Record<string, unknown> = {}
        try {
          det = JSON.parse(ledgerHit.detail || '{}') as Record<string, unknown>
        } catch {
          det = {}
        }
        const savedTail = String(det.customerPhone || '')
          .replace(/\D/g, '')
          .slice(-4)
        if (savedTail && savedTail !== phoneTail) {
          return NextResponse.json(
            { ok: false, error: 'Số điện thoại không khớp với mã yêu cầu tra cứu.' },
            { status: 404, headers: corsHeaders }
          )
        }
        return NextResponse.json(
          {
            ok: true,
            found: true,
            source: 'WEB_REQUEST',
            code: ledgerHit.entityCode,
            type: ledgerHit.action,
            title: ledgerHit.title,
            status: String(det.status || 'RECEIVED_PENDING_CONFIRM'),
            total: typeof det.grandTotal === 'number' ? det.grandTotal : null,
            tierApplied: det.wholesaleTierLabel || null,
            createdAt: ledgerHit.createdAt,
          },
          { headers: corsHeaders }
        )
      }

      return NextResponse.json(
        { ok: false, error: 'Không tìm thấy mã đơn / yêu cầu tương ứng.' },
        { status: 404, headers: corsHeaders }
      )
    }

    // 2. Đọc dữ liệu Cửa hàng Công khai (L1 Cache 15 giây, ẩn tuyệt đối 100% giá vốn & secret)
    const cached = getApiCache<Record<string, unknown>>('storefront:public')
    if (cached) {
      return NextResponse.json(cached, { headers: corsHeaders })
    }

    const [
      { cmsInstanceId, shopeeShopId, brandProfile, config },
      categories,
      websiteChannel,
      rawProducts,
      posts,
    ] = await Promise.all([
      getStorefrontConfigForCurrentCms(),
      db.category.findMany({
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      }),
      db.channel.findUnique({
        where: { key: 'WEBSITE' },
        select: { id: true },
      }),
      db.product.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ sellPrice: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          sku: true,
          name: true,
          description: true,
          categoryId: true,
          sellPrice: true,
          stock: true,
          unit: true,
          type: true,
          fragile: true,
          image: true,
          attributes: true,
          category: { select: { id: true, name: true, slug: true } },
          listings: {
            select: {
              channelId: true,
              price: true,
              status: true,
              description: true,
            },
          },
        },
      }),
      db.socialPost
        .findMany({
          where: { channel: 'WEBSITE', status: 'PUBLISHED' },
          orderBy: { publishedAt: 'desc' },
          take: 6,
          select: {
            id: true,
            slug: true,
            title: true,
            excerpt: true,
            publishedAt: true,
            mediaUrls: true,
          },
        })
        .catch(() => []),
    ])

    const webChannelId = websiteChannel?.id || ''
    const shopeeBaseUrl = config.contact.shopeeUrl.replace(/\/+$/, '')

    const publicProducts =
      config.enabled === false
        ? []
        : rawProducts
            .filter((prod) => {
              if (!webChannelId) return true
              const webListing = prod.listings.find((l) => l.channelId === webChannelId)
              return !webListing || webListing.status !== 'INACTIVE'
            })
            .map((prod) => {
              const webListing = webChannelId
                ? prod.listings.find((l) => l.channelId === webChannelId)
                : undefined
              const retailPrice =
                webListing?.price && webListing.price > 0 ? webListing.price : prod.sellPrice

              let shopeeItemId: string | null = null
              let images: string[] = prod.image ? [prod.image] : []
              if (prod.attributes) {
                try {
                  const attr = JSON.parse(prod.attributes) as {
                    shopeeItemId?: string | number
                    images?: string[]
                  }
                  if (attr.shopeeItemId) shopeeItemId = String(attr.shopeeItemId)
                  if (Array.isArray(attr.images) && attr.images.length > 0) {
                    images = attr.images.filter((u) => typeof u === 'string' && u.startsWith('http'))
                    if (prod.image && !images.includes(prod.image)) {
                      images = [prod.image, ...images]
                    }
                  }
                } catch {
                  // ignore
                }
              }

              const { cleanTitle, variantLabel } = splitProductTitleAndVariant(prod.name)

              const wholesalePrices = config.wholesaleEnabled
                ? config.wholesaleTiers.map((tier) => ({
                    tierId: tier.id,
                    minQty: tier.minQty,
                    label: tier.label,
                    badge: tier.badge,
                    discountPercent: tier.discountPercent,
                    unitPrice: computeWholesaleUnitPrice(retailPrice, tier.discountPercent),
                  }))
                : []

              return {
                id: prod.id,
                sku: prod.sku,
                name: prod.name,
                cleanTitle,
                variantLabel,
                description: webListing?.description || prod.description || '',
                categoryId: prod.categoryId,
                categoryName: prod.category?.name || 'Bộ sưu tập Thủ công',
                retailPrice,
                wholesalePrices,
                unit: prod.unit || 'sp',
                type: prod.type || 'SIMPLE',
                fragile: Boolean(prod.fragile),
                image: prod.image || images[0] || null,
                images: images.slice(0, 6),
                inStock: prod.stock > 0,
                availableToOrder: prod.stock > 0 || config.allowPreorderWhenOutOfStock,
                stockLabel:
                  prod.stock > 0
                    ? `Sẵn hàng (${prod.stock} ${prod.unit || 'sp'})`
                    : config.allowPreorderWhenOutOfStock
                      ? 'Đặt chế tác tại xưởng (Giao 1–2 ngày)'
                      : 'Tạm hết hàng',
                shopeeUrl:
                  shopeeItemId && shopeeShopId
                    ? `https://shopee.vn/product/${shopeeShopId}/${shopeeItemId}`
                    : shopeeBaseUrl,
              }
            })

    const hasBankTransfer = Boolean(
      brandProfile.invoiceBankCode && brandProfile.invoiceBankAccount
    )

    const publicConfig =
      config.enabled === false
        ? {
            ...config,
            banners: {
              ...DEFAULT_STOREFRONT_BANNERS,
              enabled: false,
              shopLogoUrl: config.banners.shopLogoUrl,
            },
          }
        : config

    const responsePayload = {
      ok: true,
      storefrontClosed: config.enabled === false,
      cmsInstanceId,
      generatedAt: new Date().toISOString(),
      brand: {
        brandName: brandProfile.brandName,
        brandShortName: brandProfile.brandShortName,
        brandBadge: brandProfile.brandBadge,
        brandSubtitle: brandProfile.brandSubtitle,
        footerTagline: brandProfile.brandFooterTagline,
        workshopName: brandProfile.defaultWorkshopName,
        companyName: brandProfile.companyName || brandProfile.brandName,
      },
      config: publicConfig,
      bankTransfer: hasBankTransfer
        ? {
            bankCode: brandProfile.invoiceBankCode,
            bankName: brandProfile.invoiceBankName || brandProfile.invoiceBankCode,
            bankAccount: brandProfile.invoiceBankAccount,
            bankHolder: brandProfile.invoiceBankHolder,
          }
        : null,
      categories,
      products: publicProducts,
      articles: posts.map((p) => {
        let thumb: string | null = null
        if (p.mediaUrls) {
          try {
            const arr = JSON.parse(p.mediaUrls) as string[]
            if (Array.isArray(arr) && arr[0]) thumb = arr[0]
          } catch {
            // ignore
          }
        }
        return {
          id: p.id,
          slug: p.slug,
          title: p.title,
          excerpt: p.excerpt,
          publishedAt: p.publishedAt,
          thumbnailUrl: thumb,
        }
      }),
    }

    setApiCache('storefront:public', responsePayload, 15_000)
    return NextResponse.json(responsePayload, { headers: corsHeaders })
  } catch (error) {
    console.error('Public Storefront GET error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể tải dữ liệu cửa hàng trực tuyến.' },
      { status: 500, headers: corsHeaders }
    )
  }
}

interface IncomingOrderItem {
  productId?: string
  sku?: string
  quantity?: number
}

export async function POST(req: NextRequest) {
  const corsHeaders = buildStorefrontCorsHeaders(req)
  try {
    const clientIp = extractClientIp(req.headers)
    if (!checkPublicRateLimit(clientIp)) {
      return NextResponse.json(
        {
          ok: false,
          code: 'RATE_LIMITED',
          error: 'Bạn gửi yêu cầu quá nhanh. Vui lòng đợi 1 phút rồi thử lại.',
        },
        { status: 429, headers: corsHeaders }
      )
    }

    const body = (await req.json().catch(() => ({}))) as {
      action?: 'SUBMIT_WEB_ORDER' | 'SUBMIT_WHOLESALE_INQUIRY' | 'SUBMIT_CONTACT'
      customerName?: string
      customerPhone?: string
      customerEmail?: string
      companyOrShopName?: string
      address?: string
      note?: string
      estimatedQty?: number
      interestedSkus?: string[]
      paymentMethod?: 'COD' | 'BANK_TRANSFER'
      items?: IncomingOrderItem[]
    }

    const action = body.action || 'SUBMIT_CONTACT'
    const customerName = String(body.customerName || '').trim().slice(0, 100)
    const customerPhone = normalizePhoneDigits(body.customerPhone || '')
    const customerEmail = String(body.customerEmail || '').trim().slice(0, 120)
    const companyOrShopName = String(body.companyOrShopName || '').trim().slice(0, 140)
    const address = String(body.address || '').trim().slice(0, 280)
    const note = String(body.note || '').trim().slice(0, 1000)

    if (!customerName || customerPhone.replace(/\D/g, '').length < 8) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Vui lòng điền Họ tên và Số điện thoại hợp lệ (tối thiểu 8 chữ số).',
        },
        { status: 400, headers: corsHeaders }
      )
    }

    const { config, brandProfile, refCodePrefix } = await getStorefrontConfigForCurrentCms()
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '')
    const randSuffix = Math.floor(1000 + Math.random() * 9000)
    const cleanPhoneKey = customerPhone.replace(/\D/g, '')
    const webThreadId = `web:${cleanPhoneKey}`
    const senderTag = `${customerName}|${customerPhone}`

    // =========================================================================
    // 1. ĐẶT HÀNG LẺ / ĐƠN SỈ TỪ GIỎ HÀNG WEBSITE
    // =========================================================================
    if (action === 'SUBMIT_WEB_ORDER') {
      if (config.enabled === false) {
        return NextResponse.json(
          {
            ok: false,
            code: 'STOREFRONT_DISABLED',
            error:
              'Website hiện đang tạm ngưng nhận đơn trực tuyến để bảo trì/cập nhật. Quý khách vui lòng liên hệ Hotline hoặc Zalo để được hỗ trợ ngay.',
          },
          { status: 503, headers: corsHeaders }
        )
      }
      if (!address) {
        return NextResponse.json(
          { ok: false, error: 'Vui lòng nhập địa chỉ giao hàng chi tiết.' },
          { status: 400, headers: corsHeaders }
        )
      }
      const rawItems = Array.isArray(body.items) ? body.items : []
      if (rawItems.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'Giỏ hàng đang trống. Vui lòng chọn ít nhất 1 sản phẩm.' },
          { status: 400, headers: corsHeaders }
        )
      }

      const prodIds = rawItems
        .map((i) => String(i.productId || '').trim())
        .filter(Boolean)
      const skus = rawItems
        .map((i) => String(i.sku || '').trim())
        .filter(Boolean)

      const [websiteChannel, dbProducts] = await Promise.all([
        db.channel.findUnique({ where: { key: 'WEBSITE' }, select: { id: true } }),
        db.product.findMany({
          where: {
            status: 'ACTIVE',
            OR: [
              ...(prodIds.length > 0 ? [{ id: { in: prodIds } }] : []),
              ...(skus.length > 0 ? [{ sku: { in: skus } }] : []),
            ],
          },
          select: {
            id: true,
            sku: true,
            name: true,
            sellPrice: true,
            stock: true,
            unit: true,
            listings: {
              select: {
                channelId: true,
                price: true,
                status: true,
              },
            },
          },
        }),
      ])

      const webChannelId = websiteChannel?.id || ''

      const resolvedLines: Array<{
        productId: string
        sku: string
        name: string
        quantity: number
        retailPrice: number
      }> = []

      for (const reqItem of rawItems.slice(0, 50)) {
        const qty = Math.max(1, Math.min(10_000, Math.floor(Number(reqItem.quantity) || 0)))
        const matched = dbProducts.find(
          (p) =>
            (reqItem.productId && p.id === reqItem.productId) ||
            (reqItem.sku && p.sku.toUpperCase() === String(reqItem.sku).trim().toUpperCase())
        )
        if (!matched) continue
        const webListing = webChannelId
          ? matched.listings.find((l) => l.channelId === webChannelId)
          : undefined
        if (webListing?.status === 'INACTIVE') continue
        if (matched.stock <= 0 && !config.allowPreorderWhenOutOfStock) {
          return NextResponse.json(
            {
              ok: false,
              code: 'OUT_OF_STOCK',
              error: `Sản phẩm "${matched.name}" (${matched.sku}) hiện tạm hết hàng.`,
            },
            { status: 400, headers: corsHeaders }
          )
        }
        const effectiveRetail =
          webListing?.price && webListing.price > 0 ? webListing.price : matched.sellPrice
        const existingIdx = resolvedLines.findIndex((x) => x.productId === matched.id)
        if (existingIdx >= 0) {
          resolvedLines[existingIdx].quantity += qty
        } else {
          resolvedLines.push({
            productId: matched.id,
            sku: matched.sku,
            name: matched.name,
            quantity: qty,
            retailPrice: effectiveRetail,
          })
        }
      }

      if (resolvedLines.length === 0) {
        return NextResponse.json(
          { ok: false, error: 'Không tìm thấy sản phẩm hợp lệ trong danh mục hiện tại.' },
          { status: 400, headers: corsHeaders }
        )
      }

      const totalQty = resolvedLines.reduce((sum, l) => sum + l.quantity, 0)
      const activeTier = resolveActiveWholesaleTier(
        totalQty,
        config.wholesaleTiers,
        config.wholesaleEnabled
      )

      const pricedLines = resolvedLines.map((l) => {
        const unitPrice = activeTier
          ? computeWholesaleUnitPrice(l.retailPrice, activeTier.discountPercent)
          : Math.round(l.retailPrice)
        return {
          ...l,
          unitPrice,
          lineTotal: unitPrice * l.quantity,
        }
      })

      const retailSubtotal = resolvedLines.reduce((s, l) => s + Math.round(l.retailPrice) * l.quantity, 0)
      const subtotal = pricedLines.reduce((s, l) => s + l.lineTotal, 0)
      const wholesaleSaved = Math.max(0, retailSubtotal - subtotal)
      const shippingFee =
        subtotal >= config.freeShipThreshold ? 0 : config.baseShippingFee
      const grandTotal = subtotal + shippingFee
      const paymentMethod = body.paymentMethod === 'BANK_TRANSFER' ? 'BANK_TRANSFER' : 'COD'
      const refCode = `${refCodePrefix}-WEB-${datePart}-${randSuffix}`

      const summaryLines = pricedLines
        .map((l) => `• ${l.sku} × ${l.quantity}: ${l.lineTotal.toLocaleString('vi-VN')} ₫`)
        .join('\n')

      const inboxContent = [
        `[ĐƠN ĐẶT WEBSITE ${refCode}] ${activeTier ? `(${activeTier.label} · -${activeTier.discountPercent}%)` : '(Bán lẻ)'}`,
        `Khách hàng: ${customerName} · SĐT: ${customerPhone}`,
        `Địa chỉ: ${address}`,
        `Thanh toán: ${paymentMethod === 'BANK_TRANSFER' ? 'Chuyển khoản VietQR' : 'COD thu hộ'} · Tổng cộng: ${grandTotal.toLocaleString('vi-VN')} ₫`,
        summaryLines,
        note ? `Ghi chú: ${note}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      await Promise.all([
        db.directMessage.create({
          data: {
            channelKey: 'WEBSITE',
            customerId: null,
            sender: 'CUSTOMER',
            agentName: senderTag,
            relatedOrderId: webThreadId,
            content: inboxContent,
            isAuto: false,
          },
        }),
        db.agentActivity.create({
          data: {
            agent: 'SUPPORT_AGENT',
            action: 'ORDER_RECEIVED',
            level: 'success',
            targetType: 'ORDER',
            targetLabel: refCode,
            message: `Website (${config.customDomain || brandProfile.brandName}): Tiếp nhận đơn đặt hàng ${refCode} từ ${customerName} (${totalQty} SP · ${grandTotal.toLocaleString('vi-VN')} ₫)`,
            detail: JSON.stringify({
              refCode,
              customerName,
              customerPhone,
              totalQty,
              grandTotal,
              wholesaleTier: activeTier?.label ?? null,
            }),
          },
        }),
        logLedger({
          scope: 'ORDER',
          action: 'WEB_STOREFRONT_ORDER',
          entityType: 'WebOrderRequest',
          entityCode: refCode,
          title: `Website (${config.customDomain || 'Storefront'}): Đơn đặt hàng ${refCode} · ${customerName} (${grandTotal.toLocaleString('vi-VN')} ₫)`,
          detail: {
            refCode,
            status: 'RECEIVED_PENDING_CONFIRM',
            customerName,
            customerPhone,
            customerEmail: customerEmail || null,
            address,
            paymentMethod,
            totalQty,
            retailSubtotal,
            wholesaleSaved,
            wholesaleTierLabel: activeTier?.label ?? null,
            subtotal,
            shippingFee,
            grandTotal,
            note: note || null,
            items: pricedLines,
          },
          actor: 'CUSTOMER',
          actorName: customerName,
          originSource: 'POS',
          sourceRefCode: refCode,
        }),
      ])

      invalidateApiCache('inbox:conversations')
      broadcast('message.new', {
        channelKey: 'WEBSITE',
        customerName,
        refCode,
      })

      return NextResponse.json(
        {
          ok: true,
          refCode,
          totalQty,
          subtotal,
          wholesaleSaved,
          wholesaleTier: activeTier,
          shippingFee,
          grandTotal,
          paymentMethod,
          message: `Đặt hàng thành công! Mã đơn của bạn là ${refCode}. ${brandProfile.brandName} sẽ liên hệ SĐT ${customerPhone} để xác nhận giao hàng sớm nhất.`,
        },
        { headers: corsHeaders }
      )
    }

    // =========================================================================
    // 2. ĐĂNG KÝ NHẬN BÁO GIÁ SỈ / ĐẠI LÝ / GIA CÔNG OEM QUÀ TẶNG DOANH NGHIỆP
    // =========================================================================
    if (action === 'SUBMIT_WHOLESALE_INQUIRY') {
      const refCode = `${refCodePrefix}-SI-${datePart}-${randSuffix}`
      const estQty = Math.max(10, Math.min(100_000, Math.floor(Number(body.estimatedQty) || 30)))
      const matchedTier = resolveActiveWholesaleTier(
        estQty,
        config.wholesaleTiers,
        config.wholesaleEnabled
      )
      const skusList = Array.isArray(body.interestedSkus)
        ? body.interestedSkus.map((s) => String(s).trim()).filter(Boolean).slice(0, 20)
        : []

      const inboxContent = [
        `[YÊU CẦU BÁO GIÁ SỈ / ĐẠI LÝ ${refCode}]`,
        `Khách sỉ: ${customerName}${companyOrShopName ? ` (${companyOrShopName})` : ''} · SĐT/Zalo: ${customerPhone}`,
        customerEmail ? `Email: ${customerEmail}` : '',
        address ? `Khu vực nhận hàng: ${address}` : '',
        `Sản lượng dự kiến: ~${estQty} SP${matchedTier ? ` → Khung chiết khấu dự kiến: ${matchedTier.label} (-${matchedTier.discountPercent}%)` : ''}`,
        skusList.length > 0 ? `Mẫu quan tâm: ${skusList.join(', ')}` : '',
        note ? `Yêu cầu chi tiết / OEM: ${note}` : '',
      ]
        .filter(Boolean)
        .join('\n')

      await Promise.all([
        db.directMessage.create({
          data: {
            channelKey: 'WEBSITE',
            customerId: null,
            sender: 'CUSTOMER',
            agentName: senderTag,
            relatedOrderId: webThreadId,
            content: inboxContent,
            isAuto: false,
          },
        }),
        db.agentActivity.create({
          data: {
            agent: 'SUPPORT_AGENT',
            action: 'MANUAL_ACTION',
            level: 'info',
            targetType: 'CONVERSATION',
            targetLabel: refCode,
            message: `Website (${config.customDomain || brandProfile.brandName}): Yêu cầu Báo giá Sỉ ${refCode} từ ${customerName} (~${estQty} SP)`,
            detail: JSON.stringify({
              refCode,
              customerName,
              customerPhone,
              companyOrShopName,
              estimatedQty: estQty,
            }),
          },
        }),
        logLedger({
          scope: 'MESSAGE',
          action: 'WEB_WHOLESALE_INQUIRY',
          entityType: 'WholesaleInquiry',
          entityCode: refCode,
          title: `Website: Yêu cầu báo giá sỉ ${refCode} · ${customerName}${companyOrShopName ? ` (${companyOrShopName})` : ''} · ~${estQty} SP`,
          detail: {
            refCode,
            status: 'RECEIVED_WHOLESALE_LEAD',
            customerName,
            customerPhone,
            customerEmail: customerEmail || null,
            companyOrShopName: companyOrShopName || null,
            address: address || null,
            estimatedQty: estQty,
            wholesaleTierLabel: matchedTier?.label ?? null,
            interestedSkus: skusList,
            note: note || null,
          },
          actor: 'CUSTOMER',
          actorName: customerName,
          originSource: 'ZALO_OA',
          sourceRefCode: refCode,
        }),
      ])

      invalidateApiCache('inbox:conversations')
      broadcast('message.new', {
        channelKey: 'WEBSITE',
        customerName,
        refCode,
      })

      return NextResponse.json(
        {
          ok: true,
          refCode,
          estimatedTier: matchedTier,
          message: `Đã gửi yêu cầu báo giá sỉ (${refCode})! Bộ phận Kinh doanh Sỉ & Xưởng ${brandProfile.brandName} sẽ phản hồi qua Zalo/SĐT ${customerPhone} trong vòng 15–30 phút.`,
        },
        { headers: corsHeaders }
      )
    }

    // =========================================================================
    // 3. LIÊN HỆ TƯ VẤN CHUNG / ĐẶT CHẾ TÁC THEO YÊU CẦU
    // =========================================================================
    if (!note) {
      return NextResponse.json(
        { ok: false, error: 'Vui lòng nhập nội dung cần tư vấn hoặc liên hệ.' },
        { status: 400, headers: corsHeaders }
      )
    }

    const refCode = `${refCodePrefix}-LH-${datePart}-${randSuffix}`
    const inboxContent = [
      `[LIÊN HỆ TỪ WEBSITE ${refCode}]`,
      `Khách hàng: ${customerName} · SĐT/Zalo: ${customerPhone}`,
      customerEmail ? `Email: ${customerEmail}` : '',
      `Nội dung: ${note}`,
    ]
      .filter(Boolean)
      .join('\n')

    await Promise.all([
      db.directMessage.create({
        data: {
          channelKey: 'WEBSITE',
          customerId: null,
          sender: 'CUSTOMER',
          agentName: senderTag,
          relatedOrderId: webThreadId,
          content: inboxContent,
          isAuto: false,
        },
      }),
      logLedger({
        scope: 'MESSAGE',
        action: 'WEB_CONTACT_MESSAGE',
        entityType: 'WebContact',
        entityCode: refCode,
        title: `Website: Liên hệ tư vấn ${refCode} từ ${customerName}`,
        detail: {
          refCode,
          status: 'RECEIVED_CONTACT',
          customerName,
          customerPhone,
          customerEmail: customerEmail || null,
          note,
        },
        actor: 'CUSTOMER',
        actorName: customerName,
        originSource: 'ZALO_OA',
        sourceRefCode: refCode,
      }),
    ])

    invalidateApiCache('inbox:conversations')
    broadcast('message.new', {
      channelKey: 'WEBSITE',
      customerName,
      refCode,
    })

    return NextResponse.json(
      {
        ok: true,
        refCode,
        message: `Cảm ơn ${customerName}! Tin nhắn (${refCode}) đã được gửi tới ${brandProfile.brandName}. Chúng tôi sẽ phản hồi sớm nhất.`,
      },
      { headers: corsHeaders }
    )
  } catch (error) {
    console.error('Public Storefront POST error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể xử lý yêu cầu lúc này. Vui lòng thử lại sau.' },
      { status: 500, headers: corsHeaders }
    )
  }
}
