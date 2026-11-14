import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  DEFAULT_SHOPEE_SHOP_BINDING,
  buildStoreZip,
  generateShopeeExtensionFiles,
} from '@/lib/shopee-extension-bundle'

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

  let pairingToken = ''
  try {
    const activeKey = await db.apiKey.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    })
    if (activeKey?.secret) {
      pairingToken = activeKey.secret
    }
  } catch {
    // Không chặn tải nếu chưa cấu hình khóa
  }

  const rawOrigin = req.nextUrl.origin.replace('0.0.0.0', '127.0.0.1')
  const bridgePort = Number(process.env.SHOPEE_SYNC_PORT || DEFAULT_SHOPEE_SHOP_BINDING.bridgePort)

  const files = generateShopeeExtensionFiles({
    shopId,
    username,
    shopLabel,
    cmsOrigin: rawOrigin,
    bridgePort,
    pairingToken,
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
