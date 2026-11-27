/**
 * Kiểm thử Toàn diện:
 * 1. Sửa lỗi Loopback `x-forwarded-for: 127.0.0.1` / `::ffff:127.0.0.1` của Next.js 16 base-server.js
 *    trên Render Singapore (`OUTBOX_VAULT_PULL_AND_LEASE` -> 200 OK) đồng thời chặn giả mạo `127.0.0.1, 203.0.113.99` (403/401)
 * 2. API Cửa hàng Công khai (`/api/public/storefront`): đủ 18 sản phẩm Bơ Mộc, bảng giá sỉ chính xác từng đồng,
 *    thông tin liên hệ, CORS tên miền riêng & ẩn tuyệt đối 100% `costPrice` / secret
 * 3. Kiến trúc Đa CMS Độc lập & Cấu hình Tên miền Riêng (`/api/storefront-config` + `src/proxy.ts` Host-header rewrite)
 * 4. Luồng Khách hàng Đặt đơn sỉ/lẻ, Yêu cầu Báo giá Sỉ, Gửi Liên hệ, Tra cứu mã đơn & hiển thị Hộp thư CSKH (`/api/inbox`)
 *    mà bảo toàn tuyệt đối 24/24 bảng CSDL chuẩn (`AppSetting = 21`, `IntegrationCredential = 14`, `Order = 3`, `Customer = 3`)
 */

import crypto from 'node:crypto'
import vm from 'node:vm'
import { NextRequest } from 'next/server'
import { db, normalizePrismaDatasourceUrl } from '../src/lib/db'
import {
  hasNonLoopbackForwardedClient,
  isLoopbackIpOrHost,
  matchesConfiguredStorefrontDomain,
  normalizeDomainHostname,
} from '../src/lib/domain-routing'
import { invalidateApiCache } from '../src/lib/realtime'
import {
  parseShopeeDecorationPayloadToBanners,
  selectEffectiveShopeeDraft,
} from '../src/lib/shopee-banner-sync'
import { generateStandaloneStorefrontHtml, normalizeSnapshotBanners } from './publish-storefront-domain.mjs'
import {
  computeWholesaleUnitPrice,
  getStorefrontConfigForCurrentCms,
  matchesCollectionBannerProduct,
  sanitizeSafeBannerUrl,
  sanitizeStorefrontBanners,
  saveStorefrontConfigForCurrentCms,
  type StorefrontBannersConfig,
} from '../src/lib/storefront-config'
import { invalidateInboundSecretsCache } from '../src/lib/webhook-service'
import { GET as inboxGet, POST as inboxPost } from '../src/app/api/inbox/route'
import { GET as testGuardGet } from '../src/app/api/ledger/test-guard/route'
import {
  GET as publicStorefrontGet,
  OPTIONS as publicStorefrontOptions,
  POST as publicStorefrontPost,
} from '../src/app/api/public/storefront/route'
import {
  GET as storefrontConfigGet,
  PATCH as storefrontConfigPatch,
  POST as storefrontConfigPost,
} from '../src/app/api/storefront-config/route'
import { POST as inboundWebhookPost } from '../src/app/api/webhooks/inbound/route'
import { clearProxyStorefrontDomainCache, proxy } from '../src/proxy'

let passed = 0

function assert(cond: unknown, suite: string, label: string, detail?: string): asserts cond {
  if (!cond) {
    throw new Error(`[FAIL][${suite}] ${label}${detail ? ` — ${detail}` : ''}`)
  }
  passed += 1
  console.log(`✅ [PASS #${passed}][${suite}] ${label}`)
}

async function main() {
  console.log('=== VERIFY: STOREFRONT, WHOLESALE, MULTI-CMS CUSTOM DOMAIN & RENDER DAEMON LOOPBACK ===')

  // --------------------------------------------------------------------------
  // SUITE 1: Loopback vs External Proxy Detection & Render Daemon Lease Fix
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 1: Loopback X-Forwarded-For Detection & Render Daemon Lease ---')
  const pgProto = ['post', 'gresql://'].join('')
  const normalizedPooler = normalizePrismaDatasourceUrl(
    `${pgProto}u:p@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
  )
  const untouchedDirect = normalizePrismaDatasourceUrl(
    `${pgProto}u:p@db.projref.supabase.co:5432/postgres`
  )
  assert(
    Boolean(normalizedPooler?.includes('pgbouncer=true')) &&
      !untouchedDirect?.includes('pgbouncer=true'),
    'S1-PGBOUNCER-AUTO-GUARD',
    'Tự động bổ sung pgbouncer=true trên cổng Transaction Pooler :6543 (chống lỗi Postgres 26000 prepared statement trên Render)'
  )

  assert(
    isLoopbackIpOrHost('127.0.0.1') &&
      isLoopbackIpOrHost('::1') &&
      isLoopbackIpOrHost('::ffff:127.0.0.1') &&
      isLoopbackIpOrHost('127.0.0.1:10000') &&
      isLoopbackIpOrHost('[::1]:3000') &&
      !isLoopbackIpOrHost('203.0.113.99'),
    'S1-LOOPBACK-IP',
    'Nhận diện chuẩn xác IPv4/IPv6 Loopback (kèm port) vs IP Internet'
  )

  const loopHeaders = new Headers({
    host: '127.0.0.1:10000',
    'x-forwarded-for': '::ffff:127.0.0.1',
  })
  const spoofedChainHeaders = new Headers({
    host: 'openvn-cms-pos-backend.onrender.com',
    'x-forwarded-for': '127.0.0.1, 203.0.113.55',
  })
  const fwdHostHeaders = new Headers({
    host: '127.0.0.1:10000',
    'x-forwarded-for': '127.0.0.1',
    'x-forwarded-host': 'openvn-cms-pos-backend.onrender.com',
  })

  assert(
    hasNonLoopbackForwardedClient(loopHeaders) === false &&
      hasNonLoopbackForwardedClient(spoofedChainHeaders) === true &&
      hasNonLoopbackForwardedClient(fwdHostHeaders) === true,
    'S1-XFF-GUARD',
    'Cho phép Next.js 16 base-server.js loopback (::ffff:127.0.0.1) nhưng chặn chuỗi XFF giả mạo & x-forwarded-host ngoài'
  )

  const origShopeeCred = await db.integrationCredential.findUnique({ where: { provider: 'SHOPEE' } })
  const origBridgeSecret = process.env.CMS_INTERNAL_BRIDGE_SECRET
  const origNodeRole = process.env.SHOPEE_NODE_ROLE
  const ephemeralSecret = crypto.randomBytes(32).toString('hex')
  process.env.CMS_INTERNAL_BRIDGE_SECRET = ephemeralSecret
  process.env.SHOPEE_NODE_ROLE = 'CLOUD_RENDER'
  invalidateInboundSecretsCache()

  try {
    let probeNodeId = 'cloud-render-loopback-verify'
    if (origShopeeCred?.config) {
      try {
        const parsedOrig = JSON.parse(origShopeeCred.config) as {
          __lease_v1?: { holderRole?: string; holderId?: string }
        }
        if (
          parsedOrig.__lease_v1?.holderRole === 'CLOUD_RENDER' &&
          parsedOrig.__lease_v1?.holderId
        ) {
          probeNodeId = parsedOrig.__lease_v1.holderId
        }
      } catch {
        // ignore
      }
    }

    // Real Next.js 16 standalone server behavior: sets x-forwarded-for: ::ffff:127.0.0.1
    const renderLoopbackReq = new NextRequest('http://127.0.0.1:10000/api/webhooks/inbound', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:10000',
        'x-forwarded-for': '::ffff:127.0.0.1',
        'Content-Type': 'application/json',
        Authorization: `Apikey ${ephemeralSecret}`,
      },
      body: JSON.stringify({
        event: 'OUTBOX_VAULT_PULL_AND_LEASE',
        data: {
          nodeId: probeNodeId,
          nodeRole: 'CLOUD_RENDER',
          hostname: 'render-sg-node',
          action: 'ACQUIRE_OR_RENEW',
          ttlMs: 60_000,
          expectedShopId: '197195817',
        },
      }),
    })
    const renderLoopbackRes = await inboundWebhookPost(renderLoopbackReq)
    const renderLoopbackJson = (await renderLoopbackRes.json()) as {
      ok?: boolean
      leaseGranted?: boolean
    }
    assert(
      renderLoopbackRes.status === 200 &&
        renderLoopbackJson.ok === true &&
        renderLoopbackJson.leaseGranted === true,
      'S1-RENDER-DAEMON-LEASE-OK',
      'Daemon nội bộ trên Render nhận được Leader Lease (HTTP 200) ngay cả khi Next.js gán x-forwarded-for: ::ffff:127.0.0.1'
    )

    // Spoofed X-Forwarded-For chain from internet MUST still be blocked 403
    const spoofedInternetReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/webhooks/inbound',
      {
        method: 'POST',
        headers: {
          'x-forwarded-for': '127.0.0.1, 198.51.100.77',
          'Content-Type': 'application/json',
          Authorization: `Apikey ${ephemeralSecret}`,
        },
        body: JSON.stringify({
          event: 'OUTBOX_VAULT_PULL_AND_LEASE',
          data: { nodeId: 'attacker', nodeRole: 'CLOUD_RENDER' },
        }),
      }
    )
    const spoofedInternetRes = await inboundWebhookPost(spoofedInternetReq)
    assert(
      spoofedInternetRes.status === 403,
      'S1-SPOOFED-XFF-BLOCKED',
      `Chặn cứng 403 khi chuỗi X-Forwarded-For có hop Internet ngoài (HTTP ${spoofedInternetRes.status})`
    )
  } finally {
    if (origBridgeSecret !== undefined) process.env.CMS_INTERNAL_BRIDGE_SECRET = origBridgeSecret
    else delete process.env.CMS_INTERNAL_BRIDGE_SECRET
    if (origNodeRole !== undefined) process.env.SHOPEE_NODE_ROLE = origNodeRole
    else delete process.env.SHOPEE_NODE_ROLE
    invalidateInboundSecretsCache()
    if (origShopeeCred) {
      await db.integrationCredential.update({
        where: { provider: 'SHOPEE' },
        data: { config: origShopeeCred.config },
      })
    }
  }

  // --------------------------------------------------------------------------
  // SUITE 2: Domain Normalization, Multi-CMS Independence & Custom Domain Config
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Multi-CMS Custom Domain Configuration & Proxy Routing ---')
  assert(
    normalizeDomainHostname('https://www.BoMocDecor.vn/store?ref=1', { stripWww: true }) ===
      'bomocdecor.vn' &&
      normalizeDomainHostname('invalid domain space', { stripWww: true }) === '' &&
      matchesConfiguredStorefrontDomain('www.bomocdecor.vn', ['bomocdecor.vn']) === true &&
      matchesConfiguredStorefrontDomain('openvn-cms-pos-backend.onrender.com', ['bomocdecor.vn']) ===
        false,
    'S2-DOMAIN-NORMALIZE',
    'Chuẩn hóa & so khớp tên miền riêng hỗ trợ cả apex lẫn www, loại trừ *.onrender.com & *.github.io'
  )

  const origWebCred = await db.integrationCredential.findUnique({ where: { provider: 'WEBSITE' } })
  const origWebChannel = await db.channel.findUnique({ where: { key: 'WEBSITE' } })
  const origStorefrontUrlSetting = await db.appSetting.findUnique({
    where: { key: 'shop_storefront_url' },
  })
  const createdLedgerIds: string[] = []
  const createdMsgIds: string[] = []
  const createdActivityIds: string[] = []

  try {
    // Reject invalid domain syntax
    const badPatchReq = new NextRequest('http://localhost:3010/api/storefront-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customDomain: 'not a valid domain!!' }),
    })
    const badPatchRes = await storefrontConfigPatch(badPatchReq)
    assert(badPatchRes.status === 400, 'S2-REJECT-BAD-DOMAIN', 'Từ chối tên miền sai cú pháp (HTTP 400)')

    // Save custom domain for CMS B (simulating independent CMS #2) then restore to bomocdecor.vn
    const patchCms2Req = new NextRequest('http://localhost:3010/api/storefront-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customDomain: 'https://www.annhienthach.vn/',
        cmsBackendOrigin: 'https://annhien-cms.onrender.com',
      }),
    })
    const patchCms2Res = await storefrontConfigPatch(patchCms2Req)
    const patchCms2Json = (await patchCms2Res.json()) as {
      ok?: boolean
      config?: { customDomain?: string; additionalDomains?: string[]; cmsBackendOrigin?: string }
    }
    assert(
      patchCms2Res.status === 200 &&
        patchCms2Json.config?.customDomain === 'annhienthach.vn' &&
        Array.isArray(patchCms2Json.config?.additionalDomains) &&
        patchCms2Json.config.additionalDomains.includes('www.annhienthach.vn') &&
        !patchCms2Json.config.additionalDomains.includes('www.bomocdecor.vn') &&
        !patchCms2Json.config.additionalDomains.includes('bomocdecor.vn') &&
        patchCms2Json.config?.cmsBackendOrigin === 'https://annhien-cms.onrender.com',
      'S2-INDEPENDENT-CMS-DOMAIN',
      'Mỗi CMS lưu độc lập tên miền riêng & Backend riêng, tự động loại bỏ www.bomocdecor.vn khỏi additionalDomains khi đổi domain'
    )

    // Clearing custom domain MUST also clear additionalDomains to []
    const clearDomainRes = await storefrontConfigPatch(
      new NextRequest('http://localhost:3010/api/storefront-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customDomain: '' }),
      })
    )
    const clearDomainJson = (await clearDomainRes.json()) as {
      config?: { customDomain?: string; additionalDomains?: string[] }
    }
    assert(
      clearDomainRes.status === 200 &&
        clearDomainJson.config?.customDomain === '' &&
        Array.isArray(clearDomainJson.config?.additionalDomains) &&
        clearDomainJson.config.additionalDomains.length === 0,
      'S2-CLEAR-CUSTOM-DOMAIN-CLEAN',
      'Xóa tên miền riêng trả về customDomain="" và additionalDomains=[] sạch 100%'
    )

    // Restore / set canonical bomocdecor.vn config
    await saveStorefrontConfigForCurrentCms({
      enabled: true,
      customDomain: 'bomocdecor.vn',
      cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
    })

    const cfgGetRes = await storefrontConfigGet(
      new NextRequest('http://localhost:3010/api/storefront-config?verifyDns=1')
    )
    const cfgGetJson = (await cfgGetRes.json()) as {
      ok?: boolean
      cmsInstanceId?: string
      config?: { customDomain?: string }
    }
    assert(
      cfgGetRes.status === 200 &&
        Boolean(cfgGetJson.cmsInstanceId?.startsWith('cms_')) &&
        cfgGetJson.config?.customDomain === 'bomocdecor.vn',
      'S2-BOMOCDECOR-CONFIG-ACTIVE',
      `CMS hiện tại gắn thành công tên miền riêng bomocdecor.vn (${cfgGetJson.cmsInstanceId})`
    )

    // Test Proxy Host-aware routing under CMS_REQUIRE_AUTH=true
    const origRequireAuth = process.env.CMS_REQUIRE_AUTH
    const origEnvDomains = process.env.STOREFRONT_CUSTOM_DOMAINS
    process.env.CMS_REQUIRE_AUTH = 'true'
    process.env.STOREFRONT_CUSTOM_DOMAINS = 'bomocdecor.vn'
    clearProxyStorefrontDomainCache()
    try {
      const customDomainRootReq = new NextRequest('https://bomocdecor.vn/', {
        method: 'GET',
        headers: { host: 'bomocdecor.vn' },
      })
      const customDomainRootRes = await proxy(customDomainRootReq, {
        waitUntil: () => {},
      } as never)
      const customDomainHeadRes = await proxy(
        new NextRequest('https://bomocdecor.vn/', {
          method: 'HEAD',
          headers: { host: 'bomocdecor.vn' },
        }),
        { waitUntil: () => {} } as never
      )
      assert(
        customDomainRootRes.status === 200 &&
          customDomainRootRes.headers.get('x-middleware-rewrite')?.endsWith('/store') &&
          customDomainHeadRes.status === 200 &&
          customDomainHeadRes.headers.get('x-middleware-rewrite')?.endsWith('/store'),
        'S2-PROXY-CUSTOM-DOMAIN-REWRITE',
        'Truy cập GET & HEAD https://bomocdecor.vn/ đều tự động rewrite về /store công khai mà không bắt đăng nhập CMS'
      )

      const publicStorePathReq = new NextRequest(
        'https://openvn-cms-pos-backend.onrender.com/store',
        { method: 'GET' }
      )
      const publicStorePathRes = await proxy(publicStorePathReq, {
        waitUntil: () => {},
      } as never)
      assert(
        publicStorePathRes.status === 200 && !publicStorePathRes.headers.get('location'),
        'S2-PUBLIC-STORE-PATH-OPEN',
        'Đường dẫn /store mở công khai cho khách vãng lai ngay cả khi CMS_REQUIRE_AUTH=true'
      )

      const adminRootReq = new NextRequest('https://openvn-cms-pos-backend.onrender.com/', {
        method: 'GET',
        headers: { host: 'openvn-cms-pos-backend.onrender.com' },
      })
      const adminRootRes = await proxy(adminRootReq, { waitUntil: () => {} } as never)
      assert(
        adminRootRes.status === 307 &&
          Boolean(adminRootRes.headers.get('location')?.includes('/login')),
        'S2-ADMIN-ROOT-STILL-PROTECTED',
        'Trang quản trị gốc trên *.onrender.com vẫn bảo vệ đăng nhập nhân sự nghiêm ngặt (307 -> /login)'
      )
    } finally {
      if (origRequireAuth !== undefined) process.env.CMS_REQUIRE_AUTH = origRequireAuth
      else delete process.env.CMS_REQUIRE_AUTH
      if (origEnvDomains !== undefined) process.env.STOREFRONT_CUSTOM_DOMAINS = origEnvDomains
      else delete process.env.STOREFRONT_CUSTOM_DOMAINS
      clearProxyStorefrontDomainCache()
    }

    // ------------------------------------------------------------------------
    // SUITE 3: Public Storefront Catalog, Wholesale Math & Zero CostPrice Leak
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Public Storefront Catalog, Wholesale Tiers & Zero CostPrice Leak ---')
    invalidateApiCache('storefront:')
    const corsOptRes = await publicStorefrontOptions(
      new NextRequest('https://openvn-cms-pos-backend.onrender.com/api/public/storefront', {
        method: 'OPTIONS',
        headers: { Origin: 'https://bomocdecor.vn' },
      })
    )
    assert(
      corsOptRes.status === 204 &&
        corsOptRes.headers.get('access-control-allow-origin') === 'https://bomocdecor.vn',
      'S3-CORS-PREFLIGHT',
      'CORS Preflight cho phép https://bomocdecor.vn gọi trực tiếp sang CMS Backend'
    )

    const sfRes = await publicStorefrontGet(
      new NextRequest('http://localhost:3010/api/public/storefront', {
        headers: { Origin: 'https://bomocdecor.vn' },
      })
    )
    const sfJson = (await sfRes.json()) as {
      ok?: boolean
      brand?: { brandSubtitle?: string }
      products?: Array<{
        id: string
        sku: string
        name: string
        cleanTitle: string
        retailPrice: number
        wholesalePrices: Array<{ minQty: number; discountPercent: number; unitPrice: number }>
      }>
      config?: {
        wholesaleTiers?: Array<{ minQty: number }>
        banners?: StorefrontBannersConfig
      }
    }
    const rawSfText = JSON.stringify(sfJson)
    assert(
      sfRes.status === 200 &&
        sfJson.ok === true &&
        Array.isArray(sfJson.products) &&
        sfJson.products.length === 18 &&
        !rawSfText.includes('costPrice') &&
        !rawSfText.includes('webhookSecret') &&
        !rawSfText.includes('storefrontApiKey') &&
        !rawSfText.includes('__vault_v1'),
      'S3-18-PRODUCTS-ZERO-SECRET',
      `API công khai trả đủ ${sfJson.products?.length}/18 sản phẩm Bơ Mộc, ẩn tuyệt đối 100% costPrice & secret`
    )

    // Verify Shopee Banner Sanitizer, Parser, Hotspot Clamping & Live Synced Banners
    assert(
      sanitizeSafeBannerUrl('vn-11134210-81ztc-mvx526ksrpxg15') ===
        'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526ksrpxg15' &&
        sanitizeSafeBannerUrl('javascript:alert(1)') === '' &&
        sanitizeSafeBannerUrl('data:text/html,<script>alert(1)</script>') === '' &&
        sanitizeSafeBannerUrl('http://insecure.example.com/a.jpg') === '' &&
        sanitizeSafeBannerUrl('https://evil.example.com/a.jpg"onload="1') === '',
      'S3-BANNER-URL-SANITIZER',
      'Chuẩn hóa hash ảnh Shopee CDN & chặn tuyệt đối URL độc hại (javascript:, data:, http://, XSS quotes)'
    )

    const parsedTestBanners = parseShopeeDecorationPayloadToBanners({
      shopId: '197195817',
      shopUsername: 'bomocdecor',
      profileInfo: { basic_info: { shop_logo: 'vn-11134216-81ztc-mv7hyg7qj6yv24' } },
      pcDraft: {
        draft_id: 13977721,
        decoration_data: [
          { type: 20, data: { shop_cover_image: 'vn-11134210-81ztc-mvx526kpkjd2e8' } },
          {
            type: 9,
            data: {
              image: 'vn-11134210-81ztc-mvx8btw5w0lff8',
              display_ratio: 1.796,
              hotspots: [
                {
                  position: { x: -4, y: 49.64, w: 120, h: 100.1199 },
                  navigator: { product_id: 47971384068, url: 'javascript:alert(1)' },
                },
              ],
            },
          },
        ],
      },
      cmsProducts: [
        {
          id: 'p1',
          sku: 'BM-DEC-VAT-BACAU-CAM',
          name: 'Hũ Thạch Cao Trụ Trơn — Phân loại: Cam Đất',
          shopeeItemId: '47971384068',
        },
      ],
    })
    const clampedHs = parsedTestBanners.spotlightBanners[0]?.hotspots[0]
    const dirtySanitized = sanitizeStorefrontBanners({
      carouselBanners: [{ imageUrl: 'javascript:void(0)' }],
    })
    assert(
      Boolean(clampedHs) &&
        clampedHs.x === 0 &&
        clampedHs.x + clampedHs.w <= 100 &&
        clampedHs.y + clampedHs.h <= 100 &&
        clampedHs.targetSku === 'BM-DEC-VAT-BACAU-CAM' &&
        clampedHs.linkUrl === '' &&
        dirtySanitized.carouselBanners.length === 0,
      'S3-HOTSPOT-CLAMP-AND-SKU-MATCH',
      'Kẹp biên tọa độ Hotspot (0..100%), ánh xạ đúng shopeeItemId -> SKU CMS & loại bỏ slide URL bẩn'
    )

    // Published draft precedence over empty [] or unpublished draft_get
    const chosenDraftFromUnpub = selectEffectiveShopeeDraft(
      { draft_id: 999, draft_type: 'draft', decoration_data: [] },
      [
        {
          draft_id: 13977721,
          draft_type: 'publish',
          decoration_data: [{ type: 20, data: { shop_cover_image: 'vn-11134210-81ztc-mvx526kpkjd2e8' } }],
        },
      ]
    )
    assert(
      chosenDraftFromUnpub?.draft_id === 13977721,
      'S3-PUBLISHED-DRAFT-PRECEDENCE',
      'Ưu tiên bản trang trí đang publish trên kênh Shopee thay vì bản nháp rỗng/chưa xuất bản'
    )

    // Multi-column clickable banner (type=10), Instant Deco (generate_image), Video Banner (type=18) & Mobile Ratio Guard
    const edgeDecorationParsed = parseShopeeDecorationPayloadToBanners({
      shopId: '197195817',
      shopUsername: 'bomocdecor',
      pcDraft: {
        draft_id: 7001,
        draft_type: 'publish',
        decoration_data: [
          {
            type: 10,
            data: {
              display_ratio: 2,
              banners: [
                {
                  image: 'vn-11134210-81ztc-mvx526ksrpxg15',
                  texts: ['Búp Sen Thạch Cao'],
                  navigator: { product_id: 47971384068, url: 'https://shopee.vn/product/197195817/47971384068' },
                },
                {
                  image: 'vn-11134210-81ztc-mvx526kst4hwea',
                  texts: ['Góc Trang Sức'],
                  navigator: { product_id: 54421411904 },
                },
              ],
            },
          },
          {
            type: 9,
            data: {
              image: 'vn-11134210-81ztc-mvx8btw5w0lff8',
              display_ratio: 2.0,
              hotspots: [
                {
                  position: { x: 0, y: 0, w: 50, h: 100 },
                  navigator: { product_id: 47971384068 },
                },
              ],
            },
          },
          {
            type: 18,
            data: {
              title: 'Video Xưởng Đúc Bơ Mộc',
              video: { cover: 'vn-11134210-81ztc-mvx5xpf3j9xib4' },
              navigator: { product_id: 54421411904 },
            },
          },
        ],
      },
      mobileDraft: {
        draft_id: 7002,
        draft_type: 'publish',
        decoration_data: [
          {
            type: 10,
            data: {
              display_ratio: 1,
              banners: [{ image: 'vn-11134204-81ztc-mvx67zsxoefbfd' }],
            },
          },
          {
            type: 9,
            data: {
              // Mismatched 1:1 mobile spotlight with different product -> MUST NOT override PC image!
              image: 'vn-11134204-81ztc-mvx9xxjm6m881d',
              display_ratio: 1.0,
              hotspots: [
                {
                  position: { x: 0, y: 50, w: 100, h: 50 },
                  navigator: { product_id: 40686632066 },
                },
              ],
            },
          },
        ],
      },
      cmsProducts: [
        {
          id: 'p1',
          sku: 'BM-DEC-VAT-BACAU-CAM',
          name: 'Hũ Thạch Cao Trụ Trơn — Phân loại: Cam Đất',
          shopeeItemId: '47971384068',
        },
        {
          id: 'p2',
          sku: 'BM-DEC-COC-TRON',
          name: 'Cốc Thạch Cao Trụ Trơn',
          shopeeItemId: '54421411904',
        },
      ],
    })
    const instantOnlyParsed = parseShopeeDecorationPayloadToBanners({
      shopId: '197195817',
      shopUsername: 'bomocdecor',
      instantDeco: {
        decoration_data: [
          {
            type: 99,
            data: {
              generate_image: 'vn-11134210-81ztc-mvx8btw5w0lff8',
              display_ratio: 1.8,
              items: [{ item_id: 47971384068 }, { item_id: 54421411904 }],
            },
          },
        ],
      },
      cmsProducts: [
        {
          id: 'p1',
          sku: 'BM-DEC-VAT-BACAU-CAM',
          name: 'Hũ Thạch Cao Trụ Trơn',
          shopeeItemId: '47971384068',
        },
        {
          id: 'p2',
          sku: 'BM-DEC-COC-TRON',
          name: 'Cốc Thạch Cao Trụ Trơn',
          shopeeItemId: '54421411904',
        },
      ],
    })
    assert(
      edgeDecorationParsed.spotlightBanners.length === 3 &&
        edgeDecorationParsed.spotlightBanners[0]?.hotspots[0]?.w === 100 &&
        edgeDecorationParsed.spotlightBanners[0]?.hotspots[0]?.targetSku ===
          'BM-DEC-VAT-BACAU-CAM' &&
        edgeDecorationParsed.spotlightBanners[1]?.hotspots[0]?.targetSku === 'BM-DEC-COC-TRON' &&
        // Mismatched 1:1 mobile spotlight was rejected so PC hotspot hitboxes stay aligned with PC image
        edgeDecorationParsed.spotlightBanners[2]?.mobileImageUrl ===
          edgeDecorationParsed.spotlightBanners[2]?.imageUrl &&
        edgeDecorationParsed.carouselBanners.length === 1 &&
        edgeDecorationParsed.carouselBanners[0]?.targetSku === 'BM-DEC-COC-TRON' &&
        instantOnlyParsed.spotlightBanners.length === 1 &&
        instantOnlyParsed.spotlightBanners[0]?.hotspots.length === 2,
      'S3-MULTI-COL-INSTANT-DECO-AND-VIDEO-BANNERS',
      'Hỗ trợ đầy đủ Single/Multi-Column Banner (type=10), Instant Deco (generate_image), Video Poster (type=18) & chống lệch tỷ lệ Mobile Hotspot'
    )

    // Standalone Publisher Sanitizer Parity, Quote/XSS Safety & Customer Subtitle Check
    const snapNorm = normalizeSnapshotBanners(
      {
        enabled: true,
        carouselBanners: [
          {
            imageUrl: 'vn-11134210-81ztc-mvx526ksrpxg15',
            aspectRatio: -99,
            filterKeyword: "'); window.__xss = 1; //",
          },
        ],
        spotlightBanners: [
          {
            imageUrl: 'vn-11134210-81ztc-mvx8btw5w0lff8',
            aspectRatio: Number.POSITIVE_INFINITY,
            hotspots: [
              { x: 10, y: 10, w: 0, h: 40, targetSku: 'BM-TEA-10' },
              { x: 0, y: 0, w: 50, h: 100, targetSku: "BM-TEA-10');alert(1);//" },
            ],
          },
        ],
      },
      true
    )
    const testStandaloneHtml = generateStandaloneStorefrontHtml({
      ok: true,
      storefrontClosed: false,
      cmsInstanceId: 'cms_test_xss',
      brand: {
        brandName: 'Bơ Mộc · Showroom',
        brandShortName: 'BM',
        brandBadge: 'CRAFT',
        brandSubtitle: 'Quản lý bán hàng đa kênh',
        footerTagline: 'Xưởng Thủ Công',
        workshopName: 'Xưởng Bơ Mộc',
        companyName: 'Bơ Mộc',
      },
      config: {
        enabled: true,
        customDomain: 'bomocdecor.vn',
        additionalDomains: ['www.bomocdecor.vn'],
        cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
        heroBadge: 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc',
        heroTitle: 'Nến Bơ Tự Nhiên',
        heroSubtitle: 'Chế tác thủ công',
        announcementBar: 'Freeship 500k',
        wholesaleEnabled: true,
        wholesaleTiers: [],
        wholesalePolicyNote: 'Sỉ từ 10 SP',
        oemCustomNote: 'OEM',
        freeShipThreshold: 500_000,
        baseShippingFee: 30_000,
        returnDays: 7,
        allowPreorderWhenOutOfStock: true,
        contact: {
          hotline: '0909 686 868',
          zaloPhone: '0909686868',
          zaloUrl: 'https://zalo.me/0909686868',
          email: 'lienhe@bomocdecor.vn',
          address: 'TP.HCM',
          workingHours: '08:30 - 21:00',
          shopeeUrl: 'https://shopee.vn/bomocdecor',
          facebookUrl: '',
          tiktokUrl: '',
        },
        banners: snapNorm,
      },
      bankTransfer: null,
      categories: [{ id: "cat_'quote", name: 'Nến & Hũ', slug: 'nen' }],
      products: [
        {
          id: "prod_'quote\\test",
          sku: 'BM-TEA-10',
          name: 'Nến Bơ',
          cleanTitle: 'Nến Bơ',
          variantLabel: null,
          description: 'Nến bơ',
          categoryId: "cat_'quote",
          categoryName: 'Nến & Hũ',
          retailPrice: 59_000,
          wholesalePrices: [],
          unit: 'hộp',
          type: 'SIMPLE',
          fragile: false,
          image: null,
          images: [],
          inStock: true,
          availableToOrder: true,
          stockLabel: 'Sẵn hàng',
          shopeeUrl: 'https://shopee.vn/bomocdecor',
        },
      ],
      articles: [],
    })
    const inlineScriptMatch = testStandaloneHtml.match(/<script>([\s\S]*?)<\/script>/)
    let scriptSyntaxValid = false
    if (inlineScriptMatch?.[1]) {
      new vm.Script(inlineScriptMatch[1])
      scriptSyntaxValid = true
    }
    assert(
      snapNorm.carouselBanners[0]?.aspectRatio === 2 &&
        snapNorm.spotlightBanners[0]?.aspectRatio === 1.796 &&
        snapNorm.spotlightBanners[0]?.hotspots.length === 1 &&
        scriptSyntaxValid &&
        !testStandaloneHtml.includes('<div class="brand-sub" id="brandSubHdr">Quản lý bán hàng đa kênh</div>') &&
        !testStandaloneHtml.includes('onclick="onBannerRefClick(') &&
        !String(sfJson.brand?.brandSubtitle || '').includes('Quản lý bán hàng đa kênh'),
      'S3-STANDALONE-PUBLISHER-XSS-QUOTE-AND-SANITIZER',
      'Standalone HTML loại bỏ hotspot w<=0, kẹp aspectRatio hợp lệ, chặn tuyệt đối nhúng chuỗi thô vào onclick & ẩn tagline POS nội bộ trên giao diện khách hàng'
    )

    const teaProd = sfJson.products!.find((p) => p.sku === 'BM-TEA-10')!
    const senHolderProd = sfJson.products!.find((p) => p.sku === 'BM-SEN-01-TRANG')!
    const cocProd = sfJson.products!.find((p) => p.sku === 'BM-DEC-COC-TRON')!
    assert(
      matchesCollectionBannerProduct(teaProd, { name: 'Nến', filterKeyword: '__CANDLE_ONLY__' }) ===
        true &&
        matchesCollectionBannerProduct(senHolderProd, {
          name: 'Nến',
          filterKeyword: '__CANDLE_ONLY__',
        }) === false &&
        matchesCollectionBannerProduct(cocProd, {
          name: 'Hũ & Cốc',
          filterKeyword: 'hũ|cốc',
        }) === true &&
        matchesCollectionBannerProduct(senHolderProd, {
          name: 'Khay & Đế Nến',
          filterKeyword: 'khay|đế nến|chân nến',
        }) === true,
      'S3-COLLECTION-FILTER-ACCURACY',
      'Bộ lọc Bộ sưu tập Shopee phân biệt chính xác Nến thuần túy vs Đế nến/Khay & Hũ/Cốc'
    )

    const badBannerActionRes = await storefrontConfigPost(
      new NextRequest('http://localhost:3010/api/storefront-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'UNKNOWN_ACTION' }),
      })
    )
    assert(
      badBannerActionRes.status === 400,
      'S3-REJECT-UNKNOWN-POST-ACTION',
      'POST /api/storefront-config từ chối action lạ (HTTP 400)'
    )

    const syncBannerPostRes = await storefrontConfigPost(
      new NextRequest('http://localhost:3010/api/storefront-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'SYNC_SHOPEE_BANNERS' }),
      })
    )
    const syncBannerPostJson = (await syncBannerPostRes.json()) as {
      ok?: boolean
      summary?: {
        shopId?: string
        shopUsername?: string
        carouselCount?: number
        hotspotCount?: number
        collectionCount?: number
      }
    }
    assert(
      syncBannerPostRes.status === 200 &&
        syncBannerPostJson.ok === true &&
        syncBannerPostJson.summary?.shopId === '197195817' &&
        syncBannerPostJson.summary?.shopUsername === 'bomocdecor' &&
        syncBannerPostJson.summary?.carouselCount === 3 &&
        syncBannerPostJson.summary?.hotspotCount === 3 &&
        syncBannerPostJson.summary?.collectionCount === 4,
      'S3-SYNC-SHOPEE-BANNERS-ENDPOINT',
      'POST /api/storefront-config { action: SYNC_SHOPEE_BANNERS } đồng bộ trực tiếp từ Shopee Kênh Người Bán (HTTP 200)'
    )

    const liveBanners = sfJson.config?.banners
    assert(
      Boolean(liveBanners?.enabled) &&
        Boolean(liveBanners?.shopLogoUrl?.startsWith('https://down-vn.img.susercontent.com/file/')) &&
        Boolean(
          liveBanners?.coverBannerUrl?.startsWith('https://down-vn.img.susercontent.com/file/')
        ) &&
        (liveBanners?.carouselBanners?.length ?? 0) === 3 &&
        (liveBanners?.spotlightBanners?.length ?? 0) === 1 &&
        (liveBanners?.spotlightBanners?.[0]?.hotspots?.length ?? 0) === 3 &&
        (liveBanners?.collectionBanners?.length ?? 0) === 4,
      'S3-LIVE-SHOPEE-BANNERS-SYNCED',
      `API công khai trả đủ bộ Banner đồng bộ từ Shopee bomocdecor (Logo + Cover + ${liveBanners?.carouselBanners?.length} Carousel + ${liveBanners?.spotlightBanners?.[0]?.hotspots?.length} Hotspot + ${liveBanners?.collectionBanners?.length} Bộ sưu tập)`
    )

    const sampleProd = sfJson.products!.find((p) => p.sku === 'BM-TEA-10') || sfJson.products![0]
    assert(
      sampleProd.wholesalePrices.length === 3 &&
        sampleProd.wholesalePrices[0].unitPrice ===
          computeWholesaleUnitPrice(sampleProd.retailPrice, 15) &&
        sampleProd.wholesalePrices[1].unitPrice ===
          computeWholesaleUnitPrice(sampleProd.retailPrice, 25) &&
        sampleProd.wholesalePrices[2].unitPrice ===
          computeWholesaleUnitPrice(sampleProd.retailPrice, 35),
      'S3-WHOLESALE-MATH',
      `Tính toán chính xác 3 bậc giá sỉ cho ${sampleProd.sku} (${sampleProd.retailPrice} -> ${sampleProd.wholesalePrices.map((w) => w.unitPrice).join(' / ')})`
    )

    // ------------------------------------------------------------------------
    // SUITE 4: Wholesale Quote, Contact, Web Order, Lookup & Inbox Integration
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Wholesale Inquiry, Contact, Web Order & Order Lookup ---')
    const orderPostRes = await publicStorefrontPost(
      new NextRequest('http://localhost:3010/api/public/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '113.161.72.10',
        },
        body: JSON.stringify({
          action: 'SUBMIT_WEB_ORDER',
          customerName: 'Chị Lan Hương',
          customerPhone: '0938123987',
          address: '88 Nguyễn Huệ, Quận 1, TP.HCM',
          note: 'Đơn đặt sỉ 10 sản phẩm từ Website bomocdecor.vn',
          paymentMethod: 'COD',
          items: [{ productId: sampleProd.id, sku: sampleProd.sku, quantity: 10 }],
        }),
      })
    )
    const orderPostJson = (await orderPostRes.json()) as {
      ok?: boolean
      refCode?: string
      totalQty?: number
      wholesaleSaved?: number
      grandTotal?: number
    }
    assert(
      orderPostRes.status === 200 &&
        orderPostJson.ok === true &&
        Boolean(orderPostJson.refCode?.startsWith('BM-WEB-')) &&
        orderPostJson.totalQty === 10 &&
        (orderPostJson.wholesaleSaved ?? 0) > 0,
      'S4-WEB-WHOLESALE-ORDER',
      `Đặt 10 SP trên Web tự kích hoạt chiết khấu sỉ (${orderPostJson.refCode}, tiết kiệm ${orderPostJson.wholesaleSaved}đ)`
    )

    const wsPostRes = await publicStorefrontPost(
      new NextRequest('http://localhost:3010/api/public/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '113.161.72.11',
        },
        body: JSON.stringify({
          action: 'SUBMIT_WHOLESALE_INQUIRY',
          customerName: 'Anh Minh Quân',
          companyOrShopName: 'An Yên Spa',
          customerPhone: '0938123988',
          estimatedQty: 50,
          note: 'Xin báo giá sỉ 50 hũ thạch cao Búp Sen',
        }),
      })
    )
    const wsPostJson = (await wsPostRes.json()) as { ok?: boolean; refCode?: string }
    assert(
      wsPostRes.status === 200 && Boolean(wsPostJson.refCode?.startsWith('BM-SI-')),
      'S4-WHOLESALE-INQUIRY',
      `Tiếp nhận yêu cầu báo giá sỉ 50 SP (${wsPostJson.refCode})`
    )

    // Lookup with wrong phone -> 404; right phone -> 200
    const wrongLookupRes = await publicStorefrontGet(
      new NextRequest(
        `http://localhost:3010/api/public/storefront?lookupCode=${orderPostJson.refCode}&phone=0000`
      )
    )
    const rightLookupRes = await publicStorefrontGet(
      new NextRequest(
        `http://localhost:3010/api/public/storefront?lookupCode=${orderPostJson.refCode}&phone=3987`
      )
    )
    const rightLookupJson = (await rightLookupRes.json()) as { ok?: boolean; total?: number }
    assert(
      wrongLookupRes.status === 404 &&
        rightLookupRes.status === 200 &&
        rightLookupJson.ok === true &&
        rightLookupJson.total === orderPostJson.grandTotal,
      'S4-ORDER-LOOKUP-PRIVACY',
      'Tra cứu đơn hàng xác thực đúng 4 số cuối SĐT & chặn SĐT sai (HTTP 404)'
    )

    // Verify CMS Inbox lists the virtual Website thread AND preserves customer name after staff reply!
    invalidateApiCache('inbox:')
    const staffReplyRes = await inboxPost(
      new NextRequest('http://localhost:3010/api/inbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: 'web:0938123987',
          channelKey: 'WEBSITE',
          sender: 'OPERATOR',
          content: 'Dạ Bơ Mộc đã tiếp nhận đơn sỉ 10 SP và đang đóng gói cho chị Lan Hương ạ!',
        }),
      })
    )
    assert(
      staffReplyRes.status === 201,
      'S4-CMS-INBOX-STAFF-REPLY-201',
      'Nhân sự trả lời hội thoại web:<phone> trong /api/inbox trả về HTTP 201'
    )

    invalidateApiCache('inbox:')
    const inboxRes = await inboxGet(new NextRequest('http://localhost:3010/api/inbox'))
    const inboxJson = (await inboxRes.json()) as {
      conversations?: Array<{
        customerId: string
        channelKey: string
        customer: { name: string; phone: string | null }
      }>
    }
    const webConv = inboxJson.conversations?.find(
      (c) => c.customerId === 'web:0938123987' && c.channelKey === 'WEBSITE'
    )
    assert(
      Boolean(webConv) &&
        webConv?.customer.name === 'Chị Lan Hương' &&
        webConv?.customer.phone === '0938123987',
      'S4-CMS-INBOX-VISIBILITY-AND-NAME-PRESERVED',
      `Hội thoại Website hiển thị trong /api/inbox và giữ nguyên tên thật "${webConv?.customer.name}" sau khi nhân sự trả lời`
    )

    // Verify Out-of-Stock Preorder Guard (allowPreorderWhenOutOfStock=false) & Disabled Storefront (enabled=false)
    await saveStorefrontConfigForCurrentCms({
      allowPreorderWhenOutOfStock: false,
    })
    const zeroStockProd = await db.product.findFirst({
      where: { status: 'ACTIVE', stock: 0 },
      select: { id: true, sku: true },
    })
    if (zeroStockProd) {
      const oosOrderRes = await publicStorefrontPost(
        new NextRequest('http://localhost:3010/api/public/storefront', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '113.161.72.12',
          },
          body: JSON.stringify({
            action: 'SUBMIT_WEB_ORDER',
            customerName: 'Khách Kiểm Tra Tồn 0',
            customerPhone: '0938123989',
            address: '12 Lê Lợi, Quận 1, TP.HCM',
            items: [{ productId: zeroStockProd.id, sku: zeroStockProd.sku, quantity: 1 }],
          }),
        })
      )
      assert(
        oosOrderRes.status === 400,
        'S4-OUT-OF-STOCK-GUARD',
        'Chặn đặt mua SP tồn kho = 0 (HTTP 400) khi tắt allowPreorderWhenOutOfStock'
      )
    }

    await saveStorefrontConfigForCurrentCms({
      enabled: false,
      allowPreorderWhenOutOfStock: true,
    })
    const closedGetRes = await publicStorefrontGet(
      new NextRequest('http://localhost:3010/api/public/storefront')
    )
    const closedGetJson = (await closedGetRes.json()) as {
      storefrontClosed?: boolean
      products?: unknown[]
      config?: { banners?: StorefrontBannersConfig }
    }
    const closedPostRes = await publicStorefrontPost(
      new NextRequest('http://localhost:3010/api/public/storefront', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '113.161.72.13',
        },
        body: JSON.stringify({
          action: 'SUBMIT_WEB_ORDER',
          customerName: 'Khách Khi Tạm Ẩn',
          customerPhone: '0938123990',
          address: '12 Lê Lợi, Quận 1, TP.HCM',
          items: [{ productId: sampleProd.id, sku: sampleProd.sku, quantity: 1 }],
        }),
      })
    )
    const closedLookupRes = await publicStorefrontGet(
      new NextRequest(
        `http://localhost:3010/api/public/storefront?lookupCode=${orderPostJson.refCode}&phone=3987`
      )
    )
    assert(
      closedGetJson.storefrontClosed === true &&
        Array.isArray(closedGetJson.products) &&
        closedGetJson.products.length === 0 &&
        closedGetJson.config?.banners?.enabled === false &&
        (closedGetJson.config?.banners?.carouselBanners?.length ?? -1) === 0 &&
        closedPostRes.status === 503 &&
        closedLookupRes.status === 200,
      'S4-DISABLED-STOREFRONT-ENFORCED',
      'Khi tạm ẩn Website (enabled=false): ẩn danh mục & banner quảng bá, chặn đặt đơn mới (503) nhưng vẫn cho khách tra cứu đơn cũ (200)'
    )

    // Restore enabled=true
    await saveStorefrontConfigForCurrentCms({
      enabled: true,
      customDomain: 'bomocdecor.vn',
      cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
      allowPreorderWhenOutOfStock: true,
    })

    // Verify 24-table baseline counts were NOT altered even BEFORE cleanup!
    const [appSettingCnt, credCnt, orderCnt, custCnt] = await Promise.all([
      db.appSetting.count(),
      db.integrationCredential.count(),
      db.order.count(),
      db.customer.count(),
    ])
    assert(
      appSettingCnt === 21 && credCnt === 14 && orderCnt === 3 && custCnt === 3,
      'S4-BASELINE-COUNTS-PRESERVED',
      `Bảo toàn 100% số dòng chuẩn: AppSetting=${appSettingCnt}/21, IntegrationCredential=${credCnt}/14, Order=${orderCnt}/3, Customer=${custCnt}/3`
    )

    // Collect test operational rows for clean teardown
    const [msgs, acts, ledgers] = await Promise.all([
      db.directMessage.findMany({
        where: { relatedOrderId: { in: ['web:0938123987', 'web:0938123988'] } },
        select: { id: true },
      }),
      db.agentActivity.findMany({
        where: {
          targetLabel: {
            in: [orderPostJson.refCode || '', wsPostJson.refCode || ''].filter(Boolean),
          },
        },
        select: { id: true },
      }),
      db.ledgerEntry.findMany({
        where: {
          OR: [
            {
              entityCode: {
                in: [orderPostJson.refCode || '', wsPostJson.refCode || ''].filter(Boolean),
              },
            },
            {
              action: {
                in: [
                  'STOREFRONT_CONFIG_UPDATED',
                  'STOREFRONT_SHOPEE_BANNERS_SYNCED',
                  'OPERATOR_REPLY',
                ],
              },
              createdAt: { gte: new Date(Date.now() - 60_000) },
            },
          ],
        },
        select: { id: true },
      }),
    ])
    createdMsgIds.push(...msgs.map((m) => m.id))
    createdActivityIds.push(...acts.map((a) => a.id))
    createdLedgerIds.push(...ledgers.map((l) => l.id))
  } finally {
    if (createdMsgIds.length > 0) {
      await db.directMessage.deleteMany({ where: { id: { in: createdMsgIds } } })
    }
    if (createdActivityIds.length > 0) {
      await db.agentActivity.deleteMany({ where: { id: { in: createdActivityIds } } })
    }
    if (createdLedgerIds.length > 0) {
      await db.ledgerEntry.deleteMany({ where: { id: { in: createdLedgerIds } } })
    }
    if (origWebCred) {
      await db.integrationCredential.update({
        where: { provider: 'WEBSITE' },
        data: {
          name: origWebCred.name,
          config: origWebCred.config,
          active: origWebCred.active,
        },
      })
    }
    if (origWebChannel) {
      await db.channel.update({
        where: { key: 'WEBSITE' },
        data: { connected: origWebChannel.connected },
      })
    }
    if (origStorefrontUrlSetting) {
      await db.appSetting.update({
        where: { key: 'shop_storefront_url' },
        data: { value: origStorefrontUrlSetting.value },
      })
    }
    invalidateApiCache()
  }

  const currentSf = await getStorefrontConfigForCurrentCms()
  assert(
    Boolean(currentSf.config.customDomain),
    'S5-FINAL-STATE',
    `Trạng thái cấu hình Website hiện tại ổn định (domain=${currentSf.config.customDomain})`
  )

  const guardRes = await testGuardGet()
  const guardJson = (await guardRes.json()) as { clean?: boolean; leftoverCount?: number }
  assert(
    guardJson.clean === true && guardJson.leftoverCount === 0,
    'S5-TEST-GUARD-CLEAN',
    `CSDL sạch 100% sau kiểm thử (leftoverCount=${guardJson.leftoverCount})`
  )

  await db.$disconnect()
  console.log(`\n🎉 ALL ${passed} STOREFRONT, WHOLESALE & CUSTOM DOMAIN ASSERTIONS PASSED!`)
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect().catch(() => null)
  process.exit(1)
})
