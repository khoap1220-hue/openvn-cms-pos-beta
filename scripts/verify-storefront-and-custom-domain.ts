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
import { getApiCache, invalidateApiCache, setApiCache } from '../src/lib/realtime'
import {
  parseShopeeDecorationPayloadToBanners,
  selectEffectiveShopeeDraft,
} from '../src/lib/shopee-banner-sync'
import {
  generateStandaloneStorefrontHtml,
  generateStorefrontSitemapXml,
  normalizeSnapshotBanners,
} from './publish-storefront-domain.mjs'
import {
  buildStorefrontCartStorageKey,
  buildStorefrontProductShareUrl,
  buildStorefrontVietQrUrl,
  findSiblingVariantProducts,
  formatCustomerStorefrontBrandName,
  formatHeroShortProductLabel,
  formatStorefrontDisplayTitle,
  formatStorefrontLookupStatusLabel,
  formatWholesaleTiersSummary,
  isPlaceholderStorefrontEmail,
  isPlaceholderStorefrontPhone,
  parseStorefrontDeepLinkQuery,
  parseStorefrontProductDescription,
  reconcileActiveCartItems,
  reconcilePersistedCartWithCatalog,
  resolveCustomerHeaderSubtitle,
  resolveHeroPrimaryStage,
  resolveStorefrontHeroCopy,
  selectHeroShowcaseProducts,
  selectRelatedStorefrontProducts,
  serializeCartForStorage,
} from '../src/lib/storefront-ux'
import {
  ROLE_DEFINITIONS,
  checkApiRequirement,
  resolveApiRoutePermission,
} from '../src/lib/rbac'
import { GET as authGet } from '../src/app/api/auth/route'
import { GET as healthGet } from '../src/app/api/health/route'
import { PUT as credentialsPut } from '../src/app/api/integrations/credentials/route'
import { POST as credentialsTestPost } from '../src/app/api/integrations/credentials/test/route'
import { PATCH as settingsPatch } from '../src/app/api/settings/route'
import { GET as backupGet } from '../src/app/api/system/backup/route'
import {
  clearFailoverSpoolByCodes,
  enqueueFailoverSubmission,
  getContinuityShieldStatus,
} from '../src/lib/continuity-shield'
import {
  DEFAULT_STOREFRONT_CONFIG,
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

    // Verify VietQR Builder, CMS-Isolated Cart Persistence, Deep-Link Parser & Rich JSON-LD / Sitemap
    const validVietQr = buildStorefrontVietQrUrl({
      bankCode: ' vcb ',
      bankAccount: '0071 0012 34567',
      bankHolder: 'BƠ MỘC ĐẸP',
      amount: 501_500,
      addInfo: 'Đơn Bơ Mộc #BM-WEB-261127-1234 <script>',
    })
    const aliasVietQr = buildStorefrontVietQrUrl({
      bankCode: 'MBBank',
      bankAccount: '0905123456888',
      bankHolder: 'Nguyễn Văn Ánh',
      amount: 120_000,
    })
    const invalidVietQrEmpty = buildStorefrontVietQrUrl({
      bankCode: '',
      bankAccount: '0071001234567',
      amount: 100_000,
    })
    const invalidVietQrShortAcct = buildStorefrontVietQrUrl({
      bankCode: 'VCB',
      bankAccount: '12',
      amount: 100_000,
    })
    assert(
      validVietQr.startsWith('https://img.vietqr.io/image/VCB-0071001234567-compact2.png?') &&
        validVietQr.includes('amount=501500') &&
        validVietQr.includes('addInfo=Don+Bo+Moc+BM-WEB-261127-1234+script') &&
        validVietQr.includes('accountName=BO+MOC+DEP') &&
        aliasVietQr.startsWith('https://img.vietqr.io/image/MB-0905123456888-compact2.png?') &&
        aliasVietQr.includes('accountName=NGUYEN+VAN+ANH') &&
        invalidVietQrEmpty === '' &&
        invalidVietQrShortAcct === '',
      'S3-VIETQR-BUILDER-AND-SANITIZER',
      'Tạo URL VietQR chuẩn ngân hàng (ánh xạ MBBank -> MB, khử dấu tiếng Việt cả addInfo & accountName) & từ chối STK/mã NH sai chuẩn'
    )

    const cartKeyA = buildStorefrontCartStorageKey('cms_bomoc_01')
    const cartKeyB = buildStorefrontCartStorageKey('cms_other_02')
    const reconciledCart = reconcilePersistedCartWithCatalog(
      [
        { productId: 'p_live', sku: 'BM-TEA-10', quantity: 4, retailPrice: 1 },
        { productId: '', sku: 'bm-tea-10', quantity: 6 },
        { productId: 'p_oos', sku: 'BM-OOS', quantity: 5 },
        { productId: 'p_live', sku: 'BM-TEA-10', quantity: -3 },
        { productId: 'p_unknown', sku: 'NO-SUCH-SKU', quantity: 2 },
      ],
      [
        { id: 'p_live', sku: 'BM-TEA-10', retailPrice: 59_000, availableToOrder: true },
        { id: 'p_oos', sku: 'BM-OOS', retailPrice: 99_000, availableToOrder: false },
      ]
    )
    const refreshedLiveCart = reconcileActiveCartItems(
      reconciledCart,
      [
        { id: 'p_live', sku: 'BM-TEA-10', retailPrice: 79_000, availableToOrder: true },
        { id: 'p_oos', sku: 'BM-OOS', retailPrice: 99_000, availableToOrder: false },
      ],
      false
    )
    const closedStoreCart = reconcileActiveCartItems(reconciledCart, [], true)
    const roundtripSerialized = serializeCartForStorage(reconciledCart)
    assert(
      cartKeyA !== cartKeyB &&
        reconciledCart.length === 1 &&
        reconciledCart[0].quantity === 10 &&
        reconciledCart[0].product.retailPrice === 59_000 &&
        refreshedLiveCart.length === 1 &&
        refreshedLiveCart[0].product.retailPrice === 79_000 &&
        closedStoreCart.length === 0 &&
        roundtripSerialized.length === 1 &&
        roundtripSerialized[0].quantity === 10,
      'S3-ISOLATED-CART-PERSISTENCE-AND-RECONCILE',
      'Giỏ hàng cô lập theo cmsInstanceId, tự cập nhật giá mới khi liveData thay đổi & dọn sạch bộ nhớ khi cửa hàng đóng'
    )

    const dlProduct = parseStorefrontDeepLinkQuery('?sku=BM-SEN-01-TRANG&mode=si&q=sen')
    const dlTracking = parseStorefrontDeepLinkQuery('?code=bm-web-261127-9999')
    const shareUrl = buildStorefrontProductShareUrl(
      'https://bomocdecor.vn/?tab=WHOLESALE#top',
      'BM-SEN-01-TRANG'
    )
    assert(
      dlProduct.sku === 'BM-SEN-01-TRANG' &&
        dlProduct.priceMode === 'WHOLESALE' &&
        dlProduct.query === 'sen' &&
        dlTracking.tab === 'TRACKING' &&
        dlTracking.lookupCode === 'BM-WEB-261127-9999' &&
        shareUrl === 'https://bomocdecor.vn/?sku=BM-SEN-01-TRANG' &&
        formatStorefrontLookupStatusLabel('SHIPPING').includes('vận chuyển') &&
        formatStorefrontLookupStatusLabel('RECEIVED_CONTACT').includes('tin nhắn'),
      'S3-DEEPLINK-AND-STATUS-LABELS',
      'Hỗ trợ đầy đủ Deep-Link (?sku=, ?mode=, ?q=, ?code=), tạo link chia sẻ sản phẩm sạch & Việt hóa đủ cả RECEIVED_CONTACT'
    )

    const ldMatch = testStandaloneHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    const parsedLd = ldMatch?.[1] ? (JSON.parse(ldMatch[1]) as { '@graph'?: Array<Record<string, unknown>> }) : null
    const openSitemap = generateStorefrontSitemapXml({
      storefrontClosed: false,
      config: { customDomain: 'bomocdecor.vn', wholesaleEnabled: true },
      products: [{ sku: 'BM-TEA-10' }, { sku: 'BM-SEN-01-TRANG' }],
    })
    const retailOnlySitemap = generateStorefrontSitemapXml({
      storefrontClosed: false,
      config: { customDomain: 'bomocdecor.vn', wholesaleEnabled: false },
      products: [{ sku: 'BM-TEA-10' }],
    })
    const closedSitemap = generateStorefrontSitemapXml({
      storefrontClosed: true,
      config: { customDomain: 'bomocdecor.vn' },
      products: [{ sku: 'BM-TEA-10' }],
    })
    assert(
      Array.isArray(parsedLd?.['@graph']) &&
        parsedLd!['@graph']!.length === 3 &&
        !JSON.stringify(parsedLd).includes('costPrice') &&
        openSitemap.includes('https://bomocdecor.vn/?tab=WHOLESALE') &&
        openSitemap.includes('https://bomocdecor.vn/?sku=BM-TEA-10') &&
        !retailOnlySitemap.includes('tab=WHOLESALE') &&
        !closedSitemap.includes('tab=WHOLESALE') &&
        !closedSitemap.includes('?sku='),
      'S3-JSONLD-PRODUCT-SCHEMA-AND-SITEMAP',
      'Xuất chuẩn JSON-LD @graph (0 costPrice) & Sitemap XML tự ẩn WHOLESALE/SP khi tắt kênh sỉ hoặc đóng cửa hàng'
    )

    // Verify Hero Atelier Redesign: Diverse Showcase Selection, Dynamic Wholesale Summary & Zero Emoji Icons
    const heroPickedFromLive = selectHeroShowcaseProducts(
      (sfJson.products ?? []) as Array<{
        id: string
        sku: string
        name: string
        cleanTitle: string
        image?: string | null
        inStock?: boolean
        availableToOrder?: boolean
      }>,
      3
    )
    const uniqueHeroTitles = new Set(heroPickedFromLive.map((p) => p.cleanTitle))
    const customTierSummary = formatWholesaleTiersSummary(
      [
        { minQty: 5, discountPercent: 10 },
        { minQty: 25, discountPercent: 22 },
      ],
      false
    )
    const shortSenLabel = formatHeroShortProductLabel(
      'Hũ Búp Sen Thạch Cao Có Nắp Trắng Mộc - Decor Phòng Ngủ - Bơ Mộc — Phân loại: Trắng mộc'
    )
    const shortNoDanglingNap = formatHeroShortProductLabel(
      'Hũ Thạch Cao Sọc Lùn Nắp Chóp Trắng Mộc 8.3cm Đựng Nến Thơm'
    )
    const shortColonSplit = formatHeroShortProductLabel(
      'Combo Trà Đạo: Ấm Tử Sa Tây Thi & Chén Khải'
    )
    assert(
      heroPickedFromLive.length === 3 &&
        uniqueHeroTitles.size === 3 &&
        heroPickedFromLive.some((p) => p.sku.startsWith('BM-TEA-')) &&
        selectHeroShowcaseProducts([], 3).length === 0 &&
        customTierSummary === 'Từ 5 SP giảm 10% · Từ 25 SP giảm 22%.' &&
        shortSenLabel === 'Hũ Búp Sen Thạch Cao' &&
        shortNoDanglingNap === 'Hũ Thạch Cao Sọc Lùn' &&
        shortColonSplit === 'Combo Trà Đạo' &&
        testStandaloneHtml.includes('class="hero-promise-grid"') &&
        testStandaloneHtml.includes('-webkit-line-clamp: 2') &&
        !testStandaloneHtml.includes('🕯️') &&
        !testStandaloneHtml.includes('🛡️') &&
        !testStandaloneHtml.includes('✨'),
      'S3-HERO-ATELIER-SHOWCASE-AND-SVG-PARITY',
      'Hero Atelier chọn 3 dòng sản phẩm độc lập (Hũ/Cốc + Nến Bơ + Khay/Đế), rút gọn từ nguyên vẹn (không dư từ treo "Nắp"), clamp 2 dòng & dùng 100% icon SVG'
    )

    // Verify Multi-CMS Independence (Non-Candle CMS), No-Cover Fallback Stage (1 & 2 items) & Closed-Storefront / Truck Icon Parity
    const nonCandleCopy = resolveStorefrontHeroCopy({
      brandName: 'An Nhiên Trà Cụ',
      workshopName: 'Nghệ Nhân Gốm Nghi Hưng',
      customDomain: 'annhientra.vn',
      heroBadge: 'Nghệ Nhân Gốm Tử Sa · Sỉ & Lẻ Toàn Quốc',
      heroTitle: 'Ấm Chén Tử Sa & Trà Cụ Thủ Công Nung Củi',
      heroSubtitle: 'Tuyển chọn ấm tử sa Nghi Hưng và trà cụ gốm mộc cho bàn trà đạo.',
      returnDays: 14,
      freeShipFormatted: '800.000 ₫',
      minWholesaleQty: 20,
      isWholesaleAllowed: true,
      isStorefrontClosed: false,
      totalProductsCount: 2,
      sampleTexts: ['Ấm Tử Sa Tây Thi 220ml', 'Chén Khải Sứ Cảnh Đức'],
    })
    const stageTwoItemsNoCover = resolveHeroPrimaryStage({
      isStorefrontClosed: false,
      showShopeeBanners: false,
      brandName: 'An Nhiên Trà Cụ',
      coverBannerUrl: '',
      showcaseProducts: [
        { id: 't1', name: 'Ấm Tử Sa Tây Thi', cleanTitle: 'Ấm Tử Sa Tây Thi', image: 'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526ksrpxg15', retailPrice: 450_000 },
        { id: 't2', name: 'Chén Khải Cảnh Đức', cleanTitle: 'Chén Khải Cảnh Đức', image: 'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526kst4hwea', retailPrice: 180_000 },
      ],
    })
    const stageSingleItemNoCover = resolveHeroPrimaryStage({
      isStorefrontClosed: false,
      showShopeeBanners: false,
      brandName: 'An Nhiên Trà Cụ',
      coverBannerUrl: '',
      showcaseProducts: [
        { id: 't1', name: 'Ấm Tử Sa Tây Thi', cleanTitle: 'Ấm Tử Sa Tây Thi', image: 'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526ksrpxg15', retailPrice: 450_000 },
      ],
    })
    const nonCandleTwoItemHtml = generateStandaloneStorefrontHtml({
      ok: true,
      storefrontClosed: false,
      cmsInstanceId: 'cms_tea_02',
      brand: {
        brandName: 'An Nhiên Trà Cụ',
        brandShortName: 'ANTC',
        brandBadge: 'TEA',
        brandSubtitle: 'Nghệ Nhân Gốm Tử Sa',
        footerTagline: 'Trà Cụ Chính Hãng',
        workshopName: 'Xưởng Gốm Nghi Hưng',
        companyName: 'An Nhiên Trà Cụ',
      },
      config: {
        enabled: true,
        customDomain: 'annhientra.vn',
        additionalDomains: ['www.annhientra.vn'],
        cmsBackendOrigin: 'https://annhien-cms.onrender.com',
        heroBadge: 'Nghệ Nhân Gốm Tử Sa · Sỉ & Lẻ Toàn Quốc',
        heroTitle: 'Ấm Chén Tử Sa & Trà Cụ Thủ Công Nung Củi',
        heroSubtitle: 'Tuyển chọn ấm tử sa Nghi Hưng chính hiệu.',
        announcementBar: '',
        wholesaleEnabled: false,
        wholesaleTiers: [{ id: 't20', minQty: 20, discountPercent: 18, label: 'Sỉ 20+', badge: '-18%', description: 'Từ 20 SP' }],
        wholesalePolicyNote: 'Sỉ từ 20 SP',
        oemCustomNote: '',
        freeShipThreshold: 800_000,
        baseShippingFee: 30_000,
        returnDays: 14,
        allowPreorderWhenOutOfStock: true,
        contact: {
          hotline: '0912 345 678',
          zaloPhone: '0912345678',
          zaloUrl: 'https://zalo.me/0912345678',
          email: 'lienhe@annhientra.vn',
          address: 'Hà Nội',
          workingHours: '08:00 - 20:00',
          shopeeUrl: '',
          facebookUrl: '',
          tiktokUrl: '',
        },
        banners: normalizeSnapshotBanners({ enabled: false, coverBannerUrl: '' }, true),
      },
      bankTransfer: null,
      categories: [{ id: 'c_tea', name: 'Ấm Tử Sa', slug: 'am-tu-sa' }],
      products: [
        {
          id: 't1',
          sku: 'TEA-01',
          name: 'Ấm Tử Sa Tây Thi',
          cleanTitle: 'Ấm Tử Sa Tây Thi',
          variantLabel: null,
          description: 'Ấm tử sa',
          categoryId: 'c_tea',
          categoryName: 'Ấm Tử Sa',
          retailPrice: 450_000,
          wholesalePrices: [],
          unit: 'chiếc',
          type: 'SIMPLE',
          fragile: true,
          image: 'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526ksrpxg15',
          images: ['https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526ksrpxg15'],
          inStock: true,
          availableToOrder: true,
          stockLabel: 'Sẵn hàng',
          shopeeUrl: '',
        },
        {
          id: 't2',
          sku: 'TEA-02',
          name: 'Chén Khải Sứ Cảnh Đức',
          cleanTitle: 'Chén Khải Sứ Cảnh Đức',
          variantLabel: null,
          description: 'Chén khải',
          categoryId: 'c_tea',
          categoryName: 'Ấm Tử Sa',
          retailPrice: 180_000,
          wholesalePrices: [],
          unit: 'chiếc',
          type: 'SIMPLE',
          fragile: true,
          image: 'https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526kst4hwea',
          images: ['https://down-vn.img.susercontent.com/file/vn-11134210-81ztc-mvx526kst4hwea'],
          inStock: true,
          availableToOrder: true,
          stockLabel: 'Sẵn hàng',
          shopeeUrl: '',
        },
      ],
      articles: [],
    })
    const closedStandaloneHtml = generateStandaloneStorefrontHtml({
      ok: true,
      storefrontClosed: true,
      cmsInstanceId: 'cms_closed_03',
      brand: {
        brandName: 'Bơ Mộc · Showroom',
        brandShortName: 'BM',
        brandBadge: 'CRAFT',
        brandSubtitle: 'Xưởng Thủ Công',
        footerTagline: 'Xưởng Thủ Công',
        workshopName: 'Xưởng Bơ Mộc',
        companyName: 'Bơ Mộc',
      },
      config: {
        enabled: false,
        customDomain: 'bomocdecor.vn',
        additionalDomains: ['www.bomocdecor.vn'],
        cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
        heroBadge: 'Xưởng Thủ Công Chính Hãng',
        heroTitle: 'Nến Bơ Tự Nhiên & Thạch Cao Decor',
        heroSubtitle: 'Tạm bảo trì danh mục',
        announcementBar: '',
        wholesaleEnabled: true,
        wholesaleTiers: [],
        wholesalePolicyNote: '',
        oemCustomNote: '',
        freeShipThreshold: 500_000,
        baseShippingFee: 30_000,
        returnDays: 7,
        allowPreorderWhenOutOfStock: false,
        contact: {
          hotline: '0909 686 868',
          zaloPhone: '0909686868',
          zaloUrl: 'https://zalo.me/0909686868',
          email: 'lienhe@bomocdecor.vn',
          address: 'TP.HCM',
          workingHours: '08:30 - 21:00',
          shopeeUrl: '',
          facebookUrl: '',
          tiktokUrl: '',
        },
        banners: normalizeSnapshotBanners({}, false),
      },
      bankTransfer: null,
      categories: [],
      products: [],
      articles: [],
    })
    const nonCandleVisibleBody = nonCandleTwoItemHtml.split('<script>')[0] || ''
    const scrollFnMatch = nonCandleTwoItemHtml.match(/function scrollToCatalog\(\)\s*\{[\s\S]*?\n    \}/)
    assert(
      nonCandleCopy.isCandlePlasterAtelier === false &&
        !JSON.stringify(nonCandleCopy).toLowerCase().includes('sáp bơ') &&
        !JSON.stringify(nonCandleCopy).toLowerCase().includes('thạch cao') &&
        nonCandleCopy.highlight3.includes('20 SP') &&
        !nonCandleVisibleBody.toLowerCase().includes('sáp bơ') &&
        !nonCandleVisibleBody.toLowerCase().includes('thạch cao') &&
        stageTwoItemsNoCover.hasStageImage === true &&
        stageTwoItemsNoCover.isProductFallback === true &&
        stageTwoItemsNoCover.stripProducts.length === 2 &&
        stageSingleItemNoCover.hasStageImage === true &&
        stageSingleItemNoCover.stripProducts.length === 0 &&
        nonCandleTwoItemHtml.includes('hero-featured-grid cols-2') &&
        nonCandleTwoItemHtml.includes('circle cx="17" cy="18" r="2"') &&
        closedStandaloneHtml.includes('class="toolbar hidden" id="catalogToolbar"') &&
        closedStandaloneHtml.includes('id="heroOpenExploreBtn" class="btn-primary hidden"') &&
        closedStandaloneHtml.includes('id="heroClosedContactBtn" class="btn-primary"') &&
        Boolean(scrollFnMatch?.[0]) &&
        !scrollFnMatch![0].includes('setPriceMode'),
      'S3-MULTI-CMS-HERO-COPY-FALLBACK-STAGE-AND-CLOSED-PARITY',
      'CMS ngành hàng độc lập 0 rò rỉ chữ Nến bơ/Thạch cao, tự dựng Stage ảnh chính + cols-2 khi thiếu Cover Shopee, đổi đúng icon Truck & ẩn toolbar khi đóng cửa hàng, giữ nguyên WHOLESALE mode khi cuộn'
    )

    // Verify Credential Test accuracy (no false READY on cleared config) + enabled=false support + MARKETING RBAC
    const origGhtkRow = await db.integrationCredential.findUnique({ where: { provider: 'GHTK' } })
    try {
      const putDisabledRes = await credentialsPut(
        new NextRequest('http://localhost:3010/api/integrations/credentials', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'GHTK',
            enabled: false,
            config: { token: '', partnerCode: '' },
          }),
        })
      )
      const putDisabledJson = (await putDisabledRes.json()) as {
        credential?: { active?: boolean }
      }
      await db.ledgerEntry.deleteMany({
        where: { scope: 'SETTINGS', action: 'CREDENTIAL_SAVED', entityCode: 'GHTK' },
      })
      const emptyTestRes = await credentialsTestPost(
        new NextRequest('http://localhost:3010/api/integrations/credentials/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'GHTK' }),
        })
      )
      const emptyTestJson = (await emptyTestRes.json()) as {
        ok?: boolean
        status?: string
        configuredFieldCount?: number
      }
      const credTestReqPerm = resolveApiRoutePermission('/api/integrations/credentials/test', 'POST')
      const marketingCanTest = checkApiRequirement(
        ROLE_DEFINITIONS.MARKETING.preset,
        credTestReqPerm
      )
      assert(
        putDisabledRes.ok &&
          putDisabledJson.credential?.active === false &&
          emptyTestRes.status === 200 &&
          emptyTestJson.ok === false &&
          emptyTestJson.status === 'MISSING_CONFIG' &&
          emptyTestJson.configuredFieldCount === 0 &&
          marketingCanTest === true,
        'S3-CREDENTIAL-TEST-ACCURACY-AND-MARKETING-RBAC',
        'PUT credentials tôn trọng enabled=false, POST credentials/test báo đúng MISSING_CONFIG khi xóa rỗng token & mở quyền kiểm tra cho vai trò MARKETING'
      )
    } finally {
      if (origGhtkRow) {
        await db.integrationCredential.update({
          where: { provider: 'GHTK' },
          data: {
            name: origGhtkRow.name,
            config: origGhtkRow.config,
            active: origGhtkRow.active,
          },
        })
      }
      invalidateInboundSecretsCache()
      invalidateApiCache()
    }

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

    // ------------------------------------------------------------------------
    // SUITE 6: UX/UI Remediation Invariants (F-01 -> F-16)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 6: UX/UI Remediation, Checkout Draft, WCAG 2.2 AA & Brand Parity (F-01..F-16) ---')

    // F-02: Zero hardcoded sample phone/email in defaults + placeholder scrubbing
    assert(
      DEFAULT_STOREFRONT_CONFIG.contact.hotline === '' &&
        DEFAULT_STOREFRONT_CONFIG.contact.zaloPhone === '' &&
        DEFAULT_STOREFRONT_CONFIG.contact.zaloUrl === '' &&
        DEFAULT_STOREFRONT_CONFIG.contact.email === '' &&
        isPlaceholderStorefrontPhone('0909 686 868') === true &&
        isPlaceholderStorefrontPhone('https://zalo.me/0909686868') === true &&
        isPlaceholderStorefrontPhone('0912 345 678') === false &&
        isPlaceholderStorefrontEmail('lienhe@bomocdecor.vn') === true &&
        isPlaceholderStorefrontEmail('cskh@annhientra.vn') === false,
      'S6-UX-F02-NO-SAMPLE-PHONE-DEFAULTS',
      'Xóa cứng số mẫu giả 0909 686 868 & email giả khỏi DEFAULT_STOREFRONT_CONFIG, giữ nguyên số thật của shop khác'
    )

    await saveStorefrontConfigForCurrentCms({
      contact: {
        ...DEFAULT_STOREFRONT_CONFIG.contact,
        hotline: '0909 686 868',
        zaloPhone: '0909686868',
        zaloUrl: 'https://zalo.me/0909686868',
        email: 'lienhe@bomocdecor.vn',
        shopeeUrl: 'https://shopee.vn/bomocdecor',
      },
    })
    const scrubbedSf = await getStorefrontConfigForCurrentCms()
    const scrubbedPublicRes = await publicStorefrontGet(
      new NextRequest('http://localhost:3010/api/public/storefront')
    )
    const scrubbedPublicJson = (await scrubbedPublicRes.json()) as Record<string, unknown>
    const scrubbedHtml = generateStandaloneStorefrontHtml(scrubbedPublicJson)
    const scrubbedLdMatch = scrubbedHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
    const scrubbedLd = scrubbedLdMatch?.[1]
      ? (JSON.parse(scrubbedLdMatch[1]) as { '@graph'?: Array<Record<string, unknown>> })
      : null
    const storeLdNode = scrubbedLd?.['@graph']?.[0] || {}
    assert(
      scrubbedSf.config.contact.hotline === '' &&
        scrubbedSf.config.contact.zaloUrl === '' &&
        scrubbedSf.config.contact.email === '' &&
        !scrubbedHtml.includes('0909 686 868') &&
        !scrubbedHtml.includes('zalo.me/0909686868') &&
        !('telephone' in storeLdNode) &&
        !('email' in storeLdNode),
      'S6-UX-F02-LEGACY-PLACEHOLDER-SCRUBBED-AND-JSONLD-CLEAN',
      'Tự động lọc bỏ số mẫu cũ 0909686868 trong __storefront_v1 khi company_phone trống & lược bỏ telephone/email rỗng khỏi JSON-LD Store'
    )

    // F-03 & F-16: Storefront bankTransfer inside __storefront_v1 (0 new AppSetting rows) + settings cache invalidation
    const patchBankRes = await storefrontConfigPatch(
      new NextRequest('http://localhost:3010/api/storefront-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          announcementBar: 'Freeship toàn quốc từ 500.000 ₫',
          bankTransfer: {
            bankCode: 'VCB',
            bankName: 'Vietcombank',
            bankAccount: '0071009998888',
            bankHolder: 'BO MOC DECOR',
          },
        }),
      })
    )
    invalidateApiCache('storefront:')
    const withBankPubRes = await publicStorefrontGet(
      new NextRequest('http://localhost:3010/api/public/storefront')
    )
    const withBankPubJson = (await withBankPubRes.json()) as {
      bankTransfer?: { bankCode?: string; bankAccount?: string } | null
    }
    const appSettingCountDuringBank = await db.appSetting.count()

    // Clear bankTransfer back to null
    await storefrontConfigPatch(
      new NextRequest('http://localhost:3010/api/storefront-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankTransfer: null }),
      })
    )

    setApiCache('storefront:public', { staleMarker: true }, 60_000)
    const existingBrandSetting = await db.appSetting.findFirst({
      where: { key: { in: ['brand_name', 'shop_storefront_url'] } },
    })
    if (existingBrandSetting) {
      await settingsPatch(
        new NextRequest('http://localhost:3010/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [existingBrandSetting.key]: existingBrandSetting.value }),
        })
      )
      await new Promise((r) => setTimeout(r, 80))
    }
    const cacheAfterSettingsPatch = getApiCache('storefront:public')

    assert(
      patchBankRes.status === 200 &&
        withBankPubJson.bankTransfer?.bankCode === 'VCB' &&
        withBankPubJson.bankTransfer?.bankAccount === '0071009998888' &&
        appSettingCountDuringBank === 21 &&
        cacheAfterSettingsPatch === null,
      'S6-UX-F03-F16-VIETQR-CONFIG-ZERO-APPSETTING-AND-CACHE-INVALIDATION',
      'Lưu cấu hình VietQR vào __storefront_v1 giữ nguyên AppSetting=21/21 & PATCH /api/settings xóa sạch cache storefront:public'
    )

    // F-01, F-03, F-04, F-05, F-12: Interactive VM DOM Execution of Standalone Storefront JS
    const livePubRes = await publicStorefrontGet(
      new NextRequest('http://localhost:3010/api/public/storefront')
    )
    const livePubData = (await livePubRes.json()) as {
      ok: boolean
      cmsInstanceId: string
      brand: Record<string, unknown>
      config: Record<string, unknown>
      bankTransfer: null
      categories: Array<Record<string, unknown>>
      products: Array<{
        id: string
        sku: string
        parentSku?: string | null
        tierVariationName?: string | null
        name: string
        cleanTitle: string
        variantLabel: string | null
        description: string
        retailPrice: number
        fragile: boolean
        weightGram?: number | null
        dimensionsLabel?: string | null
        image: string | null
        images: string[]
        availableToOrder: boolean
        stockLabel: string
        unit: string
      }>
    }
    const liveStandaloneHtml = generateStandaloneStorefrontHtml(livePubData)
    const liveScriptMatch = liveStandaloneHtml.match(/<script>([\s\S]*?)<\/script>/)

    type MockDomEl = {
      id: string
      value: string
      textContent: string
      innerHTML: string
      className: string
      disabled: boolean
      href: string
      min: string
      style: Record<string, string>
      attrs: Record<string, string>
      classList: {
        add: (...tokens: string[]) => void
        remove: (...tokens: string[]) => void
        toggle: (token: string, force?: boolean) => boolean
        contains: (token: string) => boolean
      }
      setAttribute: (k: string, v: string) => void
      removeAttribute: (k: string) => void
      getAttribute: (k: string) => string | null
      focus: () => void
      reset: () => void
      scrollIntoView: () => void
      querySelectorAll: () => MockDomEl[]
    }

    const checkoutInputIds = new Set(['ordName', 'ordPhone', 'ordAddr', 'ordNote'])
    const domMap = new Map<string, MockDomEl>()
    const keydownHandlers: Array<(ev: { key: string }) => void> = []

    const createMockEl = (id: string, initialClasses = ''): MockDomEl => {
      const classes = new Set(initialClasses.split(/\s+/).filter(Boolean))
      let rawInner = ''
      const el: MockDomEl = {
        id,
        value: '',
        textContent: '',
        get innerHTML() {
          return rawInner
        },
        set innerHTML(next: string) {
          rawInner = String(next || '')
          if (id === 'cartModalContent') {
            for (const cid of checkoutInputIds) {
              const re = new RegExp(`<input[^>]*id="${cid}"[^>]*>`, 'i')
              const tagMatch = rawInner.match(re)
              if (tagMatch) {
                const valMatch = tagMatch[0].match(/value="([^"]*)"/i)
                const decoded = (valMatch?.[1] || '')
                  .replace(/&quot;/g, '"')
                  .replace(/&#39;/g, "'")
                  .replace(/&amp;/g, '&')
                const inputEl = domMap.get(cid) || createMockEl(cid)
                inputEl.value = decoded
                domMap.set(cid, inputEl)
              } else {
                domMap.delete(cid)
              }
            }
          }
        },
        get className() {
          return Array.from(classes).join(' ')
        },
        set className(v: string) {
          classes.clear()
          String(v || '')
            .split(/\s+/)
            .filter(Boolean)
            .forEach((t) => classes.add(t))
        },
        disabled: false,
        href: '',
        min: '',
        style: {},
        attrs: {},
        classList: {
          add: (...tokens: string[]) => tokens.forEach((t) => t && classes.add(t)),
          remove: (...tokens: string[]) => tokens.forEach((t) => classes.delete(t)),
          toggle: (token: string, force?: boolean) => {
            const shouldAdd = force !== undefined ? force : !classes.has(token)
            if (shouldAdd) classes.add(token)
            else classes.delete(token)
            return shouldAdd
          },
          contains: (token: string) => classes.has(token),
        },
        setAttribute(k: string, v: string) {
          this.attrs[k] = String(v)
        },
        removeAttribute(k: string) {
          delete this.attrs[k]
        },
        getAttribute(k: string) {
          return this.attrs[k] ?? null
        },
        focus() {},
        reset() {},
        scrollIntoView() {},
        querySelectorAll() {
          return []
        },
      }
      return el
    }

    domMap.set('sec-WHOLESALE', createMockEl('sec-WHOLESALE', 'hidden'))
    domMap.set('sec-CONTACT', createMockEl('sec-CONTACT', 'hidden'))
    domMap.set('sec-TRACKING', createMockEl('sec-TRACKING', 'hidden'))
    domMap.set('mobileCartBar', createMockEl('mobileCartBar', 'hidden'))
    const bodyEl = createMockEl('body')

    const storageMap = new Map<string, string>()
    const mockWindow: Record<string, unknown> = {
      location: { origin: 'https://bomocdecor.vn', search: '', pathname: '/', hash: '' },
      localStorage: {
        getItem: (k: string) => storageMap.get(k) ?? null,
        setItem: (k: string, v: string) => {
          storageMap.set(k, String(v))
        },
        removeItem: (k: string) => {
          storageMap.delete(k)
        },
      },
      history: { replaceState: () => {} },
      matchMedia: () => ({ matches: false }),
      scrollTo: () => {},
    }

    const mockDocument = {
      title: '',
      body: bodyEl,
      activeElement: bodyEl,
      getElementById(id: string) {
        if (checkoutInputIds.has(id)) {
          return domMap.get(id) ?? null
        }
        if (!domMap.has(id)) {
          domMap.set(id, createMockEl(id))
        }
        return domMap.get(id)!
      },
      addEventListener(type: string, cb: (ev: { key: string }) => void) {
        if (type === 'keydown') keydownHandlers.push(cb)
      },
    }

    const vmCtx = vm.createContext({
      window: mockWindow,
      document: mockDocument,
      navigator: { clipboard: { writeText: async () => {} } },
      fetch: async () => ({ ok: false, json: async () => null }),
      setInterval: () => 1,
      clearInterval: () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      URLSearchParams,
      encodeURIComponent,
      decodeURIComponent,
      Math,
      Number,
      String,
      Boolean,
      Array,
      Object,
      JSON,
      RegExp,
      Intl,
      alert: () => {},
    })
    mockWindow.document = mockDocument

    vm.runInContext(liveScriptMatch![1], vmCtx)

    const firstProdId = livePubData.products[0].id
    vm.runInContext(`addToCart(${JSON.stringify(firstProdId)}, 2);`, vmCtx)
    const toastOpenedAfterAdd = domMap.get('toastBox')!.classList.contains('open')
    const mobileBarVisibleBeforeModal = !domMap.get('mobileCartBar')!.classList.contains('hidden')

    vm.runInContext(`openCartModal();`, vmCtx)
    const toastHiddenOnModalOpen = !domMap.get('toastBox')!.classList.contains('open')
    const mobileBarHiddenDuringModal = domMap.get('mobileCartBar')!.classList.contains('hidden')

    // Customer fills all 4 checkout inputs BEFORE clicking BANK_TRANSFER
    domMap.get('ordName')!.value = 'Nguyễn Minh Châu'
    domMap.get('ordPhone')!.value = '0988777666'
    domMap.get('ordAddr')!.value = '120 Lê Lợi, Quận 1, TP.HCM'
    domMap.get('ordNote')!.value = 'Gói hộp quà chỉn chu'
    vm.runInContext(
      `onCheckoutDraftInput('name', 'Nguyễn Minh Châu'); onCheckoutDraftInput('phone', '0988777666'); onCheckoutDraftInput('addr', '120 Lê Lợi, Quận 1, TP.HCM'); onCheckoutDraftInput('note', 'Gói hộp quà chỉn chu');`,
      vmCtx
    )

    // Trigger payment toggle, quantity change, and background live refresh
    vm.runInContext(`setPaymentMethod('BANK_TRANSFER');`, vmCtx)
    const preservedAfterPaymentToggle =
      domMap.get('ordName')?.value === 'Nguyễn Minh Châu' &&
      domMap.get('ordPhone')?.value === '0988777666' &&
      domMap.get('ordAddr')?.value === '120 Lê Lợi, Quận 1, TP.HCM' &&
      domMap.get('ordNote')?.value === 'Gói hộp quà chỉn chu'
    const hasNullBankGuidanceInCheckout = domMap
      .get('cartModalContent')!
      .innerHTML.includes('gửi mã VietQR chính thức')

    vm.runInContext(`updateCartQty(${JSON.stringify(firstProdId)}, 1);`, vmCtx)
    vm.runInContext(`applyLiveStorefrontData(${JSON.stringify(livePubData)});`, vmCtx)
    const preservedAfterQtyAndLiveSync =
      domMap.get('ordName')?.value === 'Nguyễn Minh Châu' &&
      domMap.get('ordPhone')?.value === '0988777666' &&
      domMap.get('ordAddr')?.value === '120 Lê Lợi, Quận 1, TP.HCM' &&
      domMap.get('ordNote')?.value === 'Gói hộp quà chỉn chu'

    // Escape key closes open modal (F-12)
    keydownHandlers.forEach((fn) => fn({ key: 'Escape' }))
    const modalClosedByEscape = !domMap.get('cartModal')!.classList.contains('open')

    // Tab switching hides Hero on WHOLESALE / CONTACT / TRACKING and restores on PRODUCTS (F-04)
    vm.runInContext(`switchTab('WHOLESALE');`, vmCtx)
    const heroHiddenOnWholesale = domMap.get('heroSection')!.classList.contains('hidden')
    vm.runInContext(`switchTab('TRACKING');`, vmCtx)
    const heroHiddenOnTracking = domMap.get('heroSection')!.classList.contains('hidden')
    vm.runInContext(`switchTab('PRODUCTS');`, vmCtx)
    const heroVisibleOnProducts = !domMap.get('heroSection')!.classList.contains('hidden')

    assert(
      toastOpenedAfterAdd &&
        mobileBarVisibleBeforeModal &&
        toastHiddenOnModalOpen &&
        mobileBarHiddenDuringModal &&
        preservedAfterPaymentToggle &&
        hasNullBankGuidanceInCheckout &&
        preservedAfterQtyAndLiveSync &&
        modalClosedByEscape &&
        heroHiddenOnWholesale &&
        heroHiddenOnTracking &&
        heroVisibleOnProducts,
      'S6-UX-F01-F03-F04-F05-F12-VM-INTERACTIVE-FLOWS',
      'VM thực thi thật: giữ nguyên 100% dữ liệu Checkout khi đổi Chuyển khoản/Tăng SL/Đồng bộ nền, hiện hướng dẫn khi bankTransfer=null, tự ẩn Toast & đóng Modal bằng Escape, chỉ hiện Hero ở tab PRODUCTS'
    )

    // F-07, F-09, F-10, F-11: DIY filter accuracy, clean display titles, sibling variants & brand formatting
    const diyMatchesOnLive = livePubData.products.filter((p) =>
      matchesCollectionBannerProduct(p, {
        name: 'Nguyên Liệu DIY',
        filterKeyword: 'đổ nến|nguyên liệu|bột thạch cao|khuôn|diy',
      })
    )
    const rawDiyMaterialMatch = matchesCollectionBannerProduct(
      {
        sku: 'BM-DIY-BOT-1KG',
        name: 'Bột Thạch Cao Nguyên Liệu Đúc Khuôn DIY 1kg',
        cleanTitle: 'Bột Thạch Cao Nguyên Liệu Đúc Khuôn DIY 1kg',
      },
      { name: 'Nguyên Liệu DIY' }
    )
    const senKemProd = livePubData.products.find((p) => p.sku === 'BM-DEC-SEN-KEM')!
    const senSiblings = findSiblingVariantProducts(senKemProd, livePubData.products)
    const senNauProd = livePubData.products.find((p) => p.sku === 'BM-SEN-01-NAU')!
    const senNauSiblings = findSiblingVariantProducts(senNauProd, livePubData.products)
    const miniSenProd = livePubData.products.find((p) => p.sku === 'BM-SEN-01-TRANG')!
    const miniSenSiblings = findSiblingVariantProducts(miniSenProd, livePubData.products)
    const tea50Prod = livePubData.products.find((p) => p.sku === 'BM-TEA-50')!
    const teaSiblings = findSiblingVariantProducts(tea50Prod, livePubData.products)
    const singleCocProd = livePubData.products.find((p) => p.sku === 'BM-DEC-COC-TRON')!
    const singleSiblings = findSiblingVariantProducts(singleCocProd, livePubData.products)

    // Verify Product Detail upgrade: 18/18 products have >= 4 gallery images, structured description without #hashtags, and VM interactive detail sheet
    const allHaveRichGallery = livePubData.products.every(
      (p) => Array.isArray(p.images) && p.images.length >= 4 && new Set(p.images).size === p.images.length
    )
    const parsedSenDesc = parseStorefrontProductDescription(senKemProd.description, {
      weightGram: senKemProd.weightGram,
      dimensionsLabel: senKemProd.dimensionsLabel,
      fragile: senKemProd.fragile,
      unit: senKemProd.unit,
    })
    const parsedTeaDesc = parseStorefrontProductDescription(tea50Prod.description, {
      weightGram: tea50Prod.weightGram,
      dimensionsLabel: tea50Prod.dimensionsLabel,
      fragile: tea50Prod.fragile,
      unit: tea50Prod.unit,
    })
    const relatedForSen = selectRelatedStorefrontProducts(senKemProd, livePubData.products, 3)

    vm.runInContext(`openProdModal('${senKemProd.id}');`, vmCtx)
    const prodModalOpenedHtml = domMap.get('prodModalContent')!.innerHTML
    const hasGalleryCounter = prodModalOpenedHtml.includes(`1 / ${senKemProd.images.length}`)
    const hasNoRawHashtags = !prodModalOpenedHtml.includes('#hubupsen')
    const hasThreeTabs =
      prodModalOpenedHtml.includes('Đặc điểm &amp; Công năng') &&
      prodModalOpenedHtml.includes('Thông số kỹ thuật') &&
      prodModalOpenedHtml.includes('Bảo quản &amp; Đóng gói')

    // ArrowRight advances gallery image to 2 / N
    keydownHandlers.forEach((fn) => fn({ key: 'ArrowRight' }))
    const advancedGalleryOk = domMap
      .get('prodModalContent')!
      .innerHTML.includes(`2 / ${senKemProd.images.length}`)

    // Interactive wholesale tier button: setModalQtyDirect(10) unlocks wholesale discount & live savings
    vm.runInContext(`setModalQtyDirect(10);`, vmCtx)
    const wsCalcHtml = domMap.get('prodModalContent')!.innerHTML
    const wsCalcUnlocked =
      wsCalcHtml.includes('Đơn giá sỉ đang áp dụng') && wsCalcHtml.includes('Tiết kiệm')

    // Switch tab to SPECS
    vm.runInContext(`setModalTab('SPECS');`, vmCtx)
    const specsTabHtml = domMap.get('prodModalContent')!.innerHTML
    const specsTabRendered = specsTabHtml.includes('Kích thước phủ bì')

    // Lightbox zoom opens & first Escape closes only zoom, second Escape closes prodModal
    vm.runInContext(`openZoomModal();`, vmCtx)
    const zoomOpenedOk = domMap.get('prodZoomModal')!.classList.contains('open')
    keydownHandlers.forEach((fn) => fn({ key: 'Escape' }))
    const zoomClosedProdStillOpen =
      !domMap.get('prodZoomModal')!.classList.contains('open') &&
      domMap.get('prodModal')!.classList.contains('open')
    keydownHandlers.forEach((fn) => fn({ key: 'Escape' }))
    const prodClosedOnSecondEscape = !domMap.get('prodModal')!.classList.contains('open')

    assert(
      allHaveRichGallery &&
        senNauSiblings.length === 2 &&
        miniSenSiblings.length === 0 &&
        teaSiblings.length === 3 &&
        parsedSenDesc.sections.length >= 3 &&
        parsedSenDesc.quickSpecs.length >= 3 &&
        !parsedSenDesc.cleanPlainText.includes('#hubupsen') &&
        !parsedTeaDesc.sections.some((s) => /trên shopee/i.test(s.title)) &&
        relatedForSen.length === 3 &&
        hasGalleryCounter &&
        hasNoRawHashtags &&
        hasThreeTabs &&
        advancedGalleryOk &&
        wsCalcUnlocked &&
        specsTabRendered &&
        zoomOpenedOk &&
        zoomClosedProdStillOpen &&
        prodClosedOnSecondEscape,
      'S7-PRODUCT-DETAIL-GALLERY-SPECS-TABS-SIBLINGS-AND-LIGHTBOX',
      'Chi tiết SP đạt chuẩn: 18/18 SP có >= 4 ảnh Gallery thật, cô lập parentSku chống trộn biến thể, tách 3 Tab sạch hashtag + thông số nhanh, tính giá sỉ tức thì & Lightbox Zoom 2 cấp Escape'
    )
    const conflictingColorCards = livePubData.products.filter(
      (p) =>
        p.variantLabel &&
        /kem|xanh|cam|vàng|đen|nâu|\bbe\b/i.test(p.variantLabel) &&
        p.cleanTitle.toLowerCase().includes('trắng mộc')
    )
    const customerBrandBomoc = formatCustomerStorefrontBrandName(
      'Bơ Mộc · Showroom',
      'bomocdecor.vn'
    )
    const customerBrandOtherCms = formatCustomerStorefrontBrandName(
      'An Nhiên · Showroom',
      'annhientra.vn'
    )
    const dedupedHeaderSub = resolveCustomerHeaderSubtitle({
      brandSubtitle: 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc',
      workshopName: 'Xưởng đúc thủ công Bơ Mộc',
      heroBadge: 'Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc',
      brandName: 'Bơ Mộc Decor',
    })

    assert(
      diyMatchesOnLive.length === 0 &&
        rawDiyMaterialMatch === true &&
        senSiblings.length === 3 &&
        singleSiblings.length === 0 &&
        conflictingColorCards.length === 0 &&
        formatStorefrontDisplayTitle(
          'Hũ Búp Sen Thạch Cao Có Nắp Trắng Mộc Đựng Nến - Decor Phòng Ngủ - Bơ Mộc',
          'Kem bơ'
        ) === 'Hũ Búp Sen Thạch Cao Có Nắp' &&
        customerBrandBomoc === 'Bơ Mộc Decor' &&
        customerBrandOtherCms === 'An Nhiên' &&
        dedupedHeaderSub === 'Xưởng đúc thủ công Bơ Mộc' &&
        liveStandaloneHtml.includes('--accent: #8c4f1e;') &&
        !liveStandaloneHtml.toLowerCase().includes('#0066cc') &&
        liveStandaloneHtml.includes('<span>Sản phẩm (<span id="prodCountNav">'),
      'S6-UX-F07-F09-F10-F11-CATALOG-TITLES-VARIANTS-AND-WABISABI',
      'Bộ lọc DIY không bắt nhầm hũ/cốc "đổ nến", 0/18 thẻ lệch màu "Trắng Mộc", gom đúng 3 phân loại anh em trong Quick-View, làm sạch hậu tố "· Showroom" đa CMS & áp màu Wabi-Sabi #8c4f1e'
    )

    // F-08, F-12, F-14, F-15: Mobile tel inputs, ARIA dialogs, reduced-motion, /api/auth brand & prod password guard
    const origNodeEnv = process.env.NODE_ENV
    const origAllowDemo = process.env.CMS_ALLOW_DEMO_HINTS
    let prodAuthJson: {
      allowDemoGuide?: boolean
      brand?: { brandName?: string; brandBadge?: string }
    } = {}
    try {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      delete process.env.CMS_ALLOW_DEMO_HINTS
      const prodAuthRes = await authGet(
        new NextRequest('http://localhost:3010/api/auth?hints=1')
      )
      prodAuthJson = (await prodAuthRes.json()) as typeof prodAuthJson
    } finally {
      if (origNodeEnv !== undefined) {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = origNodeEnv
      }
      if (origAllowDemo !== undefined) process.env.CMS_ALLOW_DEMO_HINTS = origAllowDemo
    }

    assert(
      liveStandaloneHtml.includes('id="wsPhone" name="wsPhone" type="tel" inputmode="tel" autocomplete="tel"') &&
        liveStandaloneHtml.includes('id="ctPhone" name="contactPhone" type="tel" inputmode="tel" autocomplete="tel"') &&
        liveStandaloneHtml.includes('id="lkPhone" name="lookupPhone" type="tel" inputmode="tel" autocomplete="tel"') &&
        liveStandaloneHtml.includes('id="prodModal" role="dialog" aria-modal="true"') &&
        liveStandaloneHtml.includes('id="cartModal" role="dialog" aria-modal="true"') &&
        liveStandaloneHtml.includes('@media (prefers-reduced-motion: reduce)') &&
        liveStandaloneHtml.includes('.ws-mobile-cards') &&
        prodAuthJson.allowDemoGuide === false &&
        Boolean(prodAuthJson.brand?.brandName) &&
        !prodAuthJson.brand?.brandName?.includes('Ưu Đàm'),
      'S6-UX-F08-F12-F14-MOBILE-FORMS-ARIA-AND-AUTH-PROD-GUARD',
      'Đủ type="tel" inputmode="tel" trên các biểu mẫu, chuẩn WAI-ARIA Dialog + prefers-reduced-motion, /api/auth trả đúng thương hiệu CMS & khóa hộp mật khẩu Demo trên môi trường production'
    )

    // Suite 8: Always-On Continuity Shield (LKG Snapshot, Failover Order Spool, Idempotent Replay & 24-Table Cloud Backup)
    const testFailoverCode = 'BM-WEB-261128-9901'
    try {
      enqueueFailoverSubmission({
        refCode: testFailoverCode,
        action: 'SUBMIT_WEB_ORDER',
        createdAt: new Date().toISOString(),
        customerName: 'Anh Minh Dự Phòng',
        customerPhone: '0938123989',
        customerEmail: null,
        companyOrShopName: null,
        address: '88 Nguyễn Huệ, Quận 1, TP.HCM',
        paymentMethod: 'COD',
        totalQty: 2,
        retailSubtotal: 100_000,
        wholesaleSaved: 0,
        wholesaleTierLabel: null,
        subtotal: 100_000,
        shippingFee: 30_000,
        grandTotal: 130_000,
        estimatedQty: null,
        interestedSkus: [],
        note: 'Kiểm thử ContinuityShield tự phục hồi',
        items: [
          {
            productId: senKemProd.id,
            sku: senKemProd.sku,
            name: senKemProd.name,
            quantity: 2,
            retailPrice: 50_000,
            unitPrice: 50_000,
            lineTotal: 100_000,
          },
        ],
        inboxContent: `[ĐƠN ĐẶT WEBSITE ${testFailoverCode}] Anh Minh Dự Phòng`,
        customDomain: 'bomocdecor.vn',
        brandName: 'Bơ Mộc Decor',
      })

      // 1) Lookup works directly from Failover Spool BEFORE DB replay, and rejects wrong phone
      const spoolLookupOkRes = await publicStorefrontGet(
        new NextRequest(
          `http://localhost:3010/api/public/storefront?lookupCode=${testFailoverCode}&phone=3989`
        )
      )
      const spoolLookupOkJson = (await spoolLookupOkRes.json()) as {
        ok?: boolean
        source?: string
        code?: string
      }
      const spoolLookupBadRes = await publicStorefrontGet(
        new NextRequest(
          `http://localhost:3010/api/public/storefront?lookupCode=${testFailoverCode}&phone=0000`
        )
      )

      // 2) /api/health?probe=db executes anti-pause heartbeat AND replays Failover Spool into PostgreSQL
      const healthProbeRes = await healthGet(
        new NextRequest('http://localhost:3010/api/health?probe=db')
      )
      const healthProbeJson = (await healthProbeRes.json()) as {
        status?: string
        dbReachable?: boolean
        failoverReplay?: { flushed?: number; remaining?: number }
        continuity?: { lkgReady?: boolean; pendingFailoverCount?: number }
      }

      // 3) Re-submitting same clientRefCode is idempotently deduplicated (0 duplicate orders)
      const dupReplayRes = await publicStorefrontPost(
        new NextRequest('http://localhost:3010/api/public/storefront', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SUBMIT_WEB_ORDER',
            clientRefCode: testFailoverCode,
            customerName: 'Anh Minh Dự Phòng',
            customerPhone: '0938123989',
            address: '88 Nguyễn Huệ, Quận 1, TP.HCM',
            items: [{ productId: senKemProd.id, sku: senKemProd.sku, quantity: 2 }],
          }),
        })
      )
      const dupReplayJson = (await dupReplayRes.json()) as {
        ok?: boolean
        deduplicated?: boolean
      }

      // 4) Cloud 24-Table JSON Backup (/api/system/backup?format=json) with SHA-256 verification & Zero-Secret redaction
      const backupRes = await backupGet(
        new NextRequest('http://localhost:3010/api/system/backup?format=json')
      )
      const backupRawText = await backupRes.text()
      const backupJson = JSON.parse(backupRawText) as {
        schemaVersion?: string
        coreBusinessTablesCount?: number
        checksumSha256?: string
        tables?: Record<string, unknown[]>
      }
      const recomputedSha = crypto
        .createHash('sha256')
        .update(JSON.stringify(backupJson.tables || {}))
        .digest('hex')

      assert(
        spoolLookupOkRes.status === 200 &&
          spoolLookupOkJson.source === 'FAILOVER_SPOOL' &&
          spoolLookupBadRes.status === 404 &&
          healthProbeJson.status === 'ok' &&
          healthProbeJson.dbReachable === true &&
          (healthProbeJson.failoverReplay?.flushed ?? 0) >= 1 &&
          getContinuityShieldStatus().pendingFailoverCount === 0 &&
          dupReplayRes.status === 200 &&
          dupReplayJson.deduplicated === true &&
          backupRes.status === 200 &&
          backupJson.coreBusinessTablesCount === 24 &&
          Array.isArray(backupJson.tables?.Product) &&
          backupJson.tables!.Product.length === 18 &&
          backupJson.checksumSha256 === recomputedSha &&
          liveStandaloneHtml.includes('function submitWithContinuityClient(') &&
          liveStandaloneHtml.includes('function flushOfflineOutboxClient('),
        'S8-ALWAYS-ON-CONTINUITY-SHIELD-REPLAY-AND-24TABLE-BACKUP',
        'Khiên Dự Phòng 24/7 đạt chuẩn: Tra cứu Spool tức thì, /api/health?probe=db tự phát bù vào PostgreSQL + chống trùng Idempotent, xuất Backup 24 bảng khớp SHA-256 & tích hợp Offline Outbox trên Web'
      )
    } finally {
      clearFailoverSpoolByCodes([testFailoverCode])
    }

    // Restore canonical bomocdecor.vn config cleanly
    await saveStorefrontConfigForCurrentCms({
      enabled: true,
      customDomain: 'bomocdecor.vn',
      cmsBackendOrigin: 'https://openvn-cms-pos-backend.onrender.com',
      allowPreorderWhenOutOfStock: true,
      bankTransfer: null,
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
        where: { relatedOrderId: { in: ['web:0938123987', 'web:0938123988', 'web:0938123989'] } },
        select: { id: true },
      }),
      db.agentActivity.findMany({
        where: {
          targetLabel: {
            in: [orderPostJson.refCode || '', wsPostJson.refCode || '', 'BM-WEB-261128-9901'].filter(
              Boolean
            ),
          },
        },
        select: { id: true },
      }),
      db.ledgerEntry.findMany({
        where: {
          OR: [
            {
              entityCode: {
                in: [
                  orderPostJson.refCode || '',
                  wsPostJson.refCode || '',
                  'BM-WEB-261128-9901',
                ].filter(Boolean),
              },
            },
            {
              action: {
                in: [
                  'STOREFRONT_CONFIG_UPDATED',
                  'STOREFRONT_SHOPEE_BANNERS_SYNCED',
                  'SETTINGS_UPDATED',
                  'OPERATOR_REPLY',
                  'DB_BACKUP_DOWNLOADED',
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
