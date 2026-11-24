import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  DEFAULT_SHOPEE_SHOP_BINDING,
  buildStoreZip,
  generateShopeeExtensionFiles,
} from '@/lib/shopee-extension-bundle'
import { resolvePublicCloudBackendOrigin } from '@/lib/shopee-session-vault'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  let shopId: string = DEFAULT_SHOPEE_SHOP_BINDING.shopId
  let username: string = DEFAULT_SHOPEE_SHOP_BINDING.username
  const shopLabel: string = DEFAULT_SHOPEE_SHOP_BINDING.shopLabel

  try {
    const shopeeCred = await db.integrationCredential.findUnique({
      where: { provider: 'SHOPEE' },
    })
    if (shopeeCred?.config) {
      const cfg = JSON.parse(shopeeCred.config) as {
        shopId?: string | number
        username?: string
      }
      if (cfg.shopId) shopId = String(cfg.shopId)
      if (cfg.username) username = String(cfg.username)
    }
  } catch {
    // Giữ cấu hình mặc định của shop
  }

  const rawOrigin = req.nextUrl.origin.replace('0.0.0.0', '127.0.0.1')
  const cloudOrigin = resolvePublicCloudBackendOrigin()
  const bridgePort = Number(process.env.SHOPEE_SYNC_PORT || DEFAULT_SHOPEE_SHOP_BINDING.bridgePort)

  // Zero-Secret Leak: Không nhúng khóa bí mật DB vào gói ZIP tải về;
  // Extension tự động xác thực qua Local Bridge (:51898) và Cloud Session Gate (/api/channels/shopee-session) khóa cứng Shop ID #197195817.
  const files = generateShopeeExtensionFiles({
    shopId,
    username,
    shopLabel,
    cmsOrigin: rawOrigin,
    cloudOrigin,
    syncToCloud: true,
    bridgePort,
    pairingToken: '',
    enforceShopLock: true,
    generatedAt: new Date().toISOString(),
  })

  const zipBytes = buildStoreZip(files)
  const safeFilename = `openvn-shopee-extension-${username}-${shopId}.zip`.replace(
    /[^a-zA-Z0-9._-]/g,
    '-'
  )

  return new NextResponse(Buffer.from(zipBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
      'Content-Length': String(zipBytes.byteLength),
      'Cache-Control': 'no-store',
    },
  })
}
