import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const MAX_MICRO_DATA_URL_LEN = 12_000 // ~8KB nén chuẩn Micro-WebP 128x128px

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      dataUrl?: string
      microDataUrl?: string
      filename?: string
      shopeeItemId?: string
      shopeeModelId?: string
      syncToShopee?: boolean
    }

    const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl.trim() : ''
    const microDataUrl = typeof body.microDataUrl === 'string' ? body.microDataUrl.trim() : ''
    const filename = typeof body.filename === 'string' && body.filename.trim() ? body.filename.trim() : 'product.webp'
    const shopeeItemId = typeof body.shopeeItemId === 'string' ? body.shopeeItemId.trim() : ''
    const shopeeModelId = typeof body.shopeeModelId === 'string' ? body.shopeeModelId.trim() : ''
    const syncToShopee = Boolean(body.syncToShopee)

    if (!dataUrl && !microDataUrl) {
      return NextResponse.json({ error: 'Thiếu dữ liệu ảnh tải lên' }, { status: 400 })
    }

    // TẦNG 1: Đẩy thẳng lên Kho Media CDN Shopee qua cổng Bridge :51898 (0 byte lưu trên ổ cứng/DB, chỉ trả về URL ~75 ký tự)
    // Hỗ trợ cho CẢ sản phẩm đã liên kết Shopee LẪN sản phẩm nội bộ không liên kết sàn (POS/BOM/Combo)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 7000)
      const bridgeRes = await fetch(`${process.env.SHOPEE_SYNC_PORT ? `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT}` : 'http://127.0.0.1:51898'}/shopee/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dataUrl: dataUrl || microDataUrl,
          filename,
          shopeeItemId,
          shopeeModelId,
          syncToShopee,
        }),
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (bridgeRes.ok) {
        const bridgeJson = (await bridgeRes.json()) as {
          ok?: boolean
          url?: string
          imageId?: string
          syncedToShopee?: boolean
        }
        if (bridgeJson.ok && bridgeJson.url && /^https?:\/\//i.test(bridgeJson.url)) {
          return NextResponse.json({
            ok: true,
            url: bridgeJson.url,
            imageId: bridgeJson.imageId || null,
            storageMode: 'SHOPEE_CDN',
            bytesInDb: bridgeJson.url.length,
            syncedToShopee: Boolean(bridgeJson.syncedToShopee),
            pendingCdnOffload: false,
          })
        }
      }
    } catch {
      // Nếu Daemon Shopee tắt hoặc mạng nội bộ tạm ngắt -> Tự động chuyển sang Tầng 3 (Micro-WebP Fallback)
    }

    // TẦNG 3: Chế độ Dự phòng Siêu nhẹ (Micro-WebP <= 8KB hoặc URL con trỏ http(s) <= 2048B) khi daemon offline
    const isDataUrlHttp = /^https?:\/\//i.test(dataUrl) && dataUrl.length <= 2048
    const isMicroUrlHttp = /^https?:\/\//i.test(microDataUrl) && microDataUrl.length <= 2048
    const isHttpFallback = isDataUrlHttp || isMicroUrlHttp
    const httpPointerUrl = isDataUrlHttp ? dataUrl : isMicroUrlHttp ? microDataUrl : ''
    const fallbackUrl =
      isHttpFallback
        ? httpPointerUrl
        : microDataUrl && microDataUrl.length <= MAX_MICRO_DATA_URL_LEN
          ? microDataUrl
          : dataUrl.length <= MAX_MICRO_DATA_URL_LEN
            ? dataUrl
            : ''

    const isMicroDataFallback =
      /^data:image\/(webp|jpeg|jpg|png|gif);base64,/i.test(fallbackUrl) &&
      fallbackUrl.length <= MAX_MICRO_DATA_URL_LEN

    if (!isHttpFallback && !isMicroDataFallback) {
      return NextResponse.json(
        {
          error:
            'Không thể kết nối Shopee CDN và ảnh dự phòng không hợp lệ (phải là URL http(s) ≤ 2048 ký tự hoặc ảnh siêu nhẹ Micro-WebP ≤ 8KB).',
        },
        { status: 413 }
      )
    }

    return NextResponse.json({
      ok: true,
      url: fallbackUrl,
      imageId: null,
      storageMode: isHttpFallback ? 'EXTERNAL_HTTP_FALLBACK' : 'MICRO_WEBP_FALLBACK',
      bytesInDb: fallbackUrl.length,
      syncedToShopee: false,
      pendingCdnOffload: !isHttpFallback,
    })
  } catch (error) {
    console.error('POST /api/products/upload-image error:', error)
    return NextResponse.json({ error: 'Không thể xử lý ảnh sản phẩm' }, { status: 500 })
  }
}
