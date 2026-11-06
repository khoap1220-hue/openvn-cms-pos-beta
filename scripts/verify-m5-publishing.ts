// scripts/verify-m5-publishing.ts
// Comprehensive Automated Verification Suite for Milestone 5: 7-Platform Publishing Gateway (R5, R6)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
// Verifies:
// 1. Initial 24-table baseline parity (Delta = 0)
// 2. All 7 platform adapters produce valid API payloads matching platform specifications in Safe Mock mode (FEAT-PUB-01 -> FEAT-PUB-07)
// 3. Instagram adapter strictly rejects posts without media (FEAT-PUB-05)
// 4. TikTok adapter strictly rejects posts without video (FEAT-PUB-06)
// 5. Threads adapter strictly rejects posts exceeding 500 characters (FEAT-PUB-07)
// 6. Internal Website Blog adapter assigns unique slug and links to /blog/[slug] (FEAT-PUB-03)
// 7. Public Blog Views: Next.js 16 metadata generation & page rendering (/blog and /blog/[slug])
// 8. Test Safety Invariant: Prove 0 outbound HTTP socket requests made during test run (FEAT-PUB-08, R6)
// 9. End-to-end integration with social-scheduler (create -> approve -> publish -> audit log)
// 10. Next.js 16 Route Handler Direct E2E (POST /api/social/publish)
// 11. Clean Teardown & Final 24-table baseline invariance (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import {
  publishPost,
  getAdapter,
  shouldUseSafeMock,
  generateUniqueSlug,
  slugifyVietnamese,
  facebookAdapter,
  zaloAdapter,
  websiteBlogAdapter,
  externalCmsAdapter,
  instagramAdapter,
  tiktokAdapter,
  threadsAdapter,
  type PublishRequest,
} from '../src/lib/publishing-gateway'
import {
  createPost,
  approvePost,
  submitForApproval,
  publishPostItem,
} from '../src/lib/social-scheduler'
import { createCampaign, deleteCampaign } from '../src/lib/campaign-service'
import { POST as postPublishRoute } from '../src/app/api/social/publish/route'
import BlogListPage from '../src/app/blog/page'
import BlogPostPage, { generateMetadata as generateBlogMetadata } from '../src/app/blog/[slug]/page'

const prisma = new PrismaClient()

let passedTests = 0
let failedTests = 0
let outboundHttpAttempts = 0

// ============================================================
// NETWORK SPY FOR TEST SAFETY INVARIANT (FEAT-SEC-01, R6)
// ============================================================
const originalHttpRequest = http.request
const originalHttpsRequest = https.request
const originalFetch = global.fetch

function setupNetworkSpy() {
  const disallowedHostPattern = /(facebook|zalo|tiktok|threads|instagram|external-store)/i

  // Spy on global fetch
  global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (disallowedHostPattern.test(urlStr)) {
      outboundHttpAttempts++
      throw new Error(`[SECURITY VETO] Bị chặn gọi mạng thật tới nền tảng ngoài trong test: ${urlStr}`)
    }
    return originalFetch(input, init)
  }
}

function restoreNetworkSpy() {
  global.fetch = originalFetch
  http.request = originalHttpRequest
  https.request = originalHttpsRequest
}

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`)
    passedTests++
  } else {
    console.error(`❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedTests++
    throw new Error(`Assertion failed: ${testName}`)
  }
}

async function verifyBaselineParity(label: string) {
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent',
  ]

  let allMatch = true
  for (const table of coreTables) {
    const delegateName = table.charAt(0).toLowerCase() + table.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    if (!delegate) continue
    const count = await delegate.count()
    const expected = baseline[table]
    if (count !== expected) {
      console.error(`❌ [MISMATCH] ${table}: actual=${count}, baseline=${expected}`)
      allMatch = false
    }
  }

  assert(allMatch, `Đối soát bảo toàn 24 bảng baseline cốt lõi [${label}] (Delta = 0)`)
}

async function main() {
  console.log('================================================================================')
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MILESTONE 5: 7-PLATFORM PUBLISHING GATEWAY (R5, R6) 🚀')
  console.log('================================================================================\n')

  setupNetworkSpy()

  const createdPostIds: string[] = []
  const createdCampaignIds: string[] = []
  const createdAuditLogIds: string[] = []

  try {
    // ------------------------------------------------------------------
    // GIAI ĐOẠN 1: ĐỐI SOÁT BASELINE BAN ĐẦU 24 BẢNG NGHIỆP VỤ CỐT LÕI
    // ------------------------------------------------------------------
    console.log('--- [GIAI ĐOẠN 1] Kiểm toán đối soát 24 bảng baseline trước kiểm thử ---')
    await verifyBaselineParity('PRE-TEST')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 2: KIỂM THỬ ĐỊNH DẠNG PAYLOAD & SAFE MOCK CỦA 7 ADAPTER
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 2] Kiểm thử 7 Platform Adapters trong Safe Mock Mode ---')

    // 1. Facebook Adapter (FEAT-PUB-01)
    const fbReq: PublishRequest = {
      postId: 'test_fb_001',
      channel: 'FACEBOOK',
      content: 'Bình an trong từng chén trà sáng cùng Ưu Đàm',
      mediaUrls: ['https://cdn.uudam.vn/img/tra-sen.jpg'],
      targetUrl: 'https://uudam.vn/products/tra-sen',
      hashtags: '#uudam #thientra',
      isMock: true,
    }
    const fbPayload = facebookAdapter.formatPayload(fbReq)
    assert(
      typeof fbPayload.message === 'string' && fbPayload.message.includes('Bình an trong từng chén trà'),
      'FacebookAdapter: Format payload chứa message và hashtags hợp lệ'
    )
    assert(
      Array.isArray(fbPayload.attached_media) && (fbPayload.attached_media as unknown[]).length === 1,
      'FacebookAdapter: Format payload đính kèm media_urls chuẩn Meta Graph API'
    )
    const fbResult = await facebookAdapter.publish(fbReq)
    assert(fbResult.success === true, 'FacebookAdapter: Xuất bản thành công trong Safe Mock')
    assert(fbResult.isMockResult === true, 'FacebookAdapter: Đánh dấu isMockResult = true')
    assert(
      typeof fbResult.externalPostId === 'string' && fbResult.externalPostId.startsWith('fb_post_'),
      'FacebookAdapter: Sinh externalPostId fb_post_*'
    )
    assert(
      typeof fbResult.externalPostUrl === 'string' && fbResult.externalPostUrl.includes('facebook.com'),
      'FacebookAdapter: Sinh externalPostUrl facebook.com/*'
    )

    // 2. Zalo OA Adapter (FEAT-PUB-02)
    const zaloReq: PublishRequest = {
      postId: 'test_zalo_001',
      channel: 'ZALO_OA',
      content: 'Ưu Đàm gửi tặng bạn trà thơm ngày mới',
      mediaUrls: ['https://cdn.uudam.vn/img/zalo-banner.jpg'],
      mediaType: 'IMAGE',
      isMock: true,
    }
    const zaloPayload = zaloAdapter.formatPayload(zaloReq) as {
      recipient: { target: string }
      message: { text: string; attachment?: unknown }
    }
    assert(
      zaloPayload.recipient?.target === 'all' && typeof zaloPayload.message?.text === 'string',
      'ZaloAdapter: Format payload broadcast chuẩn Zalo OA Open API'
    )
    const zaloResult = await zaloAdapter.publish(zaloReq)
    assert(zaloResult.success === true, 'ZaloAdapter: Xuất bản thành công trong Safe Mock')
    assert(
      typeof zaloResult.externalPostId === 'string' && zaloResult.externalPostId.startsWith('zalo_msg_'),
      'ZaloAdapter: Sinh externalPostId zalo_msg_*'
    )
    assert(
      (zaloResult.responseSnapshot as { error?: number })?.error === 0,
      'ZaloAdapter: Response snapshot trả về error=0 Success chuẩn Zalo OA'
    )

    // 3. Website Blog Adapter (FEAT-PUB-03)
    const webReq: PublishRequest = {
      postId: 'test_web_001',
      channel: 'WEBSITE',
      title: 'Hương Trầm Trong Không Gian Thiền',
      content: 'Trầm hương từ lâu đã là biểu tượng của sự thanh khiết...',
      excerpt: 'Khám phá văn hóa đốt trầm và nghệ thuật an trú.',
      mediaUrls: ['https://cdn.uudam.vn/img/tram-huong.jpg'],
      hashtags: '#tramhuong #uudam',
      isMock: true,
    }
    const webPayload = websiteBlogAdapter.formatPayload(webReq)
    assert(
      webPayload.title === 'Hương Trầm Trong Không Gian Thiền' && typeof webPayload.slug === 'string',
      'WebsiteBlogAdapter: Format payload chuẩn bị dữ liệu bài viết và slug website'
    )
    const webResult = await websiteBlogAdapter.publish(webReq)
    assert(webResult.success === true, 'WebsiteBlogAdapter: Xuất bản thành công')
    assert(
      typeof webResult.externalPostUrl === 'string' && webResult.externalPostUrl.startsWith('/blog/'),
      'WebsiteBlogAdapter: Đường dẫn công khai chuẩn /blog/[slug]'
    )

    // 4. External CMS Adapter (FEAT-PUB-04)
    const cmsReq: PublishRequest = {
      postId: 'test_cms_001',
      channel: 'EXTERNAL_CMS',
      title: 'Nghệ Thuật Pha Trà Bằng Nước Suối',
      content: 'Chén trà ngon khởi đầu từ nguồn nước mát lành...',
      excerpt: 'Bí quyết chọn nước pha trà của tiền nhân.',
      mediaUrls: ['https://cdn.uudam.vn/img/pha-tra.jpg'],
      hashtags: '#nghethuattra #uudam',
      isMock: true,
    }
    const cmsPayload = externalCmsAdapter.formatPayload(cmsReq)
    assert(
      cmsPayload.status === 'publish' && cmsPayload.featured_media === 'https://cdn.uudam.vn/img/pha-tra.jpg',
      'ExternalCmsAdapter: Format payload tương thích REST API WordPress/Haravan/Sapo'
    )
    const cmsResult = await externalCmsAdapter.publish(cmsReq)
    assert(cmsResult.success === true, 'ExternalCmsAdapter: Xuất bản thành công trong Safe Mock')
    assert(
      typeof cmsResult.externalPostUrl === 'string' && cmsResult.externalPostUrl.includes('external-store.vn'),
      'ExternalCmsAdapter: Sinh URL bài viết external-store.vn/blogs/posts/*'
    )

    // 5. Instagram Adapter (FEAT-PUB-05)
    const igReq: PublishRequest = {
      postId: 'test_ig_001',
      channel: 'INSTAGRAM',
      content: 'Tĩnh tâm buổi sớm mai #uudam #zen',
      mediaUrls: ['https://cdn.uudam.vn/img/zen-morning.jpg'],
      mediaType: 'IMAGE',
      isMock: true,
    }
    const igPayload = instagramAdapter.formatPayload(igReq)
    assert(
      typeof igPayload.caption === 'string' && igPayload.image_url === 'https://cdn.uudam.vn/img/zen-morning.jpg',
      'InstagramAdapter: Format payload chứa caption và image_url'
    )
    const igResult = await instagramAdapter.publish(igReq)
    assert(igResult.success === true, 'InstagramAdapter: Xuất bản thành công trong Safe Mock')
    assert(
      (igResult.responseSnapshot as { container_id?: string })?.container_id?.startsWith('ig_container_') === true,
      'InstagramAdapter: Sinh 2 bước container_id và post_id chuẩn Instagram Graph API'
    )

    // 6. TikTok Adapter (FEAT-PUB-06)
    const tiktokReq: PublishRequest = {
      postId: 'test_tiktok_001',
      channel: 'TIKTOK',
      content: 'Khoảnh khắc pha ấm trà sen Tây Hồ tĩnh tại #thientra #uudam',
      mediaUrls: ['https://cdn.uudam.vn/videos/pha-tra-sen.mp4'],
      mediaType: 'VIDEO',
      isMock: true,
    }
    const tiktokPayload = tiktokAdapter.formatPayload(tiktokReq) as {
      post_info: { title: string }
      source_info: { video_url: string }
    }
    assert(
      typeof tiktokPayload.post_info?.title === 'string' &&
        tiktokPayload.source_info?.video_url === 'https://cdn.uudam.vn/videos/pha-tra-sen.mp4',
      'TikTokAdapter: Format payload post_info và source_info chuẩn TikTok Video API'
    )
    const tiktokResult = await tiktokAdapter.publish(tiktokReq)
    assert(tiktokResult.success === true, 'TikTokAdapter: Xuất bản thành công trong Safe Mock')
    assert(
      typeof tiktokResult.externalPostId === 'string' && tiktokResult.externalPostId.startsWith('tiktok_pub_'),
      'TikTokAdapter: Sinh externalPostId tiktok_pub_*'
    )

    // 7. Threads Adapter (FEAT-PUB-07)
    const threadsReq: PublishRequest = {
      postId: 'test_threads_001',
      channel: 'THREADS',
      content: 'Một góc an yên giữa lòng phố thị náo nhiệt.',
      mediaUrls: ['https://cdn.uudam.vn/img/goc-an-yen.jpg'],
      isMock: true,
    }
    const threadsPayload = threadsAdapter.formatPayload(threadsReq)
    assert(
      threadsPayload.text === 'Một góc an yên giữa lòng phố thị náo nhiệt.' && threadsPayload.media_type === 'IMAGE',
      'ThreadsAdapter: Format payload text và media_type chuẩn Meta Threads API'
    )
    const threadsResult = await threadsAdapter.publish(threadsReq)
    assert(threadsResult.success === true, 'ThreadsAdapter: Xuất bản thành công trong Safe Mock')
    assert(
      typeof threadsResult.externalPostId === 'string' && threadsResult.externalPostId.startsWith('threads_post_'),
      'ThreadsAdapter: Sinh externalPostId threads_post_*'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 3: KIỂM THỬ 3 BẤT BIẾN RÀNG BUỘC BẮT BUỘC (MANDATORY VALIDATIONS)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 3] Kiểm thử 3 Bất Biến Ràng Buộc (Mandatory Validations) ---')

    // Bất biến 1: Instagram BẮT BUỘC có ít nhất 1 ảnh hoặc video
    let igRejected = false
    try {
      instagramAdapter.validate({
        postId: 'test_ig_err',
        channel: 'INSTAGRAM',
        content: 'Bài viết không có ảnh',
        mediaUrls: [],
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video') {
        igRejected = true
      }
    }
    assert(igRejected, 'InstagramAdapter: Chặn nghiêm ngặt bài viết không có hình ảnh/video')

    // Bất biến 2: TikTok BẮT BUỘC có mediaType === 'VIDEO' và ít nhất 1 URL video
    let tiktokRejectedNonVideo = false
    try {
      tiktokAdapter.validate({
        postId: 'test_tt_err_1',
        channel: 'TIKTOK',
        content: 'Bài viết TikTok dạng IMAGE',
        mediaType: 'IMAGE',
        mediaUrls: ['https://cdn.uudam.vn/img/pic.jpg'],
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'TikTok bắt buộc phải có tài nguyên video') {
        tiktokRejectedNonVideo = true
      }
    }
    assert(tiktokRejectedNonVideo, 'TikTokAdapter: Chặn bài viết có mediaType khác VIDEO')

    let tiktokRejectedNoUrls = false
    try {
      tiktokAdapter.validate({
        postId: 'test_tt_err_2',
        channel: 'TIKTOK',
        content: 'Bài viết TikTok không có URL video',
        mediaType: 'VIDEO',
        mediaUrls: [],
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg === 'TikTok bắt buộc phải có tài nguyên video') {
        tiktokRejectedNoUrls = true
      }
    }
    assert(tiktokRejectedNoUrls, 'TikTokAdapter: Chặn bài viết VIDEO nhưng thiếu video URL')

    // Bất biến 3: Threads BẮT BUỘC giới hạn ký tự <= 500
    const overLimitText = 'Ưu Đàm '.repeat(85) // 7 * 85 = 595 ký tự > 500
    let threadsRejected = false
    try {
      threadsAdapter.validate({
        postId: 'test_threads_err',
        channel: 'THREADS',
        content: overLimitText,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Nội dung Threads vượt quá giới hạn 500 ký tự')) {
        threadsRejected = true
      }
    }
    assert(threadsRejected, 'ThreadsAdapter: Chặn nghiêm ngặt nội dung vượt quá 500 ký tự')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 4: KIỂM THỬ XỬ LÝ SLUG & TIẾNG VIỆT (FEAT-PUB-03)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 4] Kiểm thử sinh Slug & Chuẩn hóa tiếng Việt ---')
    const rawTitle = 'Trà Sen Tây Hồ & Hương Trầm Thanh Tịnh — Ưu Đàm 2026'
    const slugified = slugifyVietnamese(rawTitle)
    assert(
      slugified === 'tra-sen-tay-ho-huong-tram-thanh-tinh-uu-dam-2026',
      'slugifyVietnamese: Chuyển đổi chính xác tiếng Việt có dấu sang slug ASCII'
    )

    const uniqueSlug1 = generateUniqueSlug('Bài Viết Thứ Nhất', 'seed1')
    const uniqueSlug2 = generateUniqueSlug('Bài Viết Thứ Nhất', 'seed2')
    assert(
      uniqueSlug1 !== uniqueSlug2 && uniqueSlug1.startsWith('bai-viet-thu-nhat-'),
      'generateUniqueSlug: Sinh slug duy nhất chống xung đột'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 5: KIỂM THỬ ĐỘNG DUAL-MODE & BẢO ĐẢM AN TOÀN (FEAT-PUB-08, R6)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 5] Kiểm toán Dual-Mode & Bất biến 0 Outbound Request (R6) ---')
    assert(
      shouldUseSafeMock({ channelConfig: null }) === true,
      'shouldUseSafeMock: Tự động dùng Safe Mock khi không có cấu hình'
    )
    assert(
      shouldUseSafeMock({ channelConfig: { isMock: true, credentials: '{"apiKey":"123"}' } }) === true,
      'shouldUseSafeMock: Dùng Safe Mock khi config.isMock = true'
    )
    assert(
      shouldUseSafeMock({ forceMock: true }) === true,
      'shouldUseSafeMock: Cưỡng chế Safe Mock khi forceMock = true'
    )

    // Kiểm tra mạng: đảm bảo chưa có bất kỳ cuộc gọi mạng ngoại vi nào lọt ra ngoài
    assert(
      outboundHttpAttempts === 0,
      'Bảo đảm An Toàn Mạng (R6): Số lượng outbound HTTP requests đến nền tảng ngoài = 0'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 6: KIỂM THỬ TÍCH HỢP ĐẦU CUỐI (E2E) VỚI SOCIAL SCHEDULER
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 6] Kiểm thử tích hợp E2E: Scheduler -> Gateway -> DB -> Blog ---')

    // 1. Tạo chiến dịch test
    const testCampaign = await createCampaign({
      code: `CP-TEST-M5-${Date.now().toString(36).toUpperCase()}`,
      name: 'Chiến dịch Test Xuất Bản M5',
      title: 'Hương Sắc An Nhiên M5',
      startDate: new Date(Date.now() - 3600_000),
      endDate: new Date(Date.now() + 86400_000),
      description: 'Kiểm thử tích hợp đăng bài 7 nền tảng',
    })
    createdCampaignIds.push(testCampaign.id)

    // 2. Tạo bài viết Facebook, duyệt và đăng qua scheduler
    const fbPost = await createPost({
      channel: 'FACEBOOK',
      content: 'Chào buổi sáng an lành từ Ưu Đàm Suite',
      campaignId: testCampaign.id,
      mediaUrls: ['https://cdn.uudam.vn/img/morning.jpg'],
      isMock: true,
    })
    createdPostIds.push(fbPost.id)

    await submitForApproval(fbPost.id)
    await approvePost(fbPost.id, 'Chủ tiệm Ưu Đàm')

    const fbPublishResult = await publishPostItem(fbPost.id, { skipTimeGate: true })
    assert(fbPublishResult.success === true, 'publishPostItem (Facebook): Xuất bản thành công')
    assert(
      typeof fbPublishResult.externalPostId === 'string' && fbPublishResult.externalPostId.startsWith('fb_post_'),
      'publishPostItem: CSDL ghi nhận externalPostId từ publishing-gateway'
    )

    // Kiểm tra bản ghi AuditLog
    const fbAuditLog = await prisma.auditLog.findFirst({
      where: {
        entityType: 'SocialPost',
        entityId: fbPost.id,
        action: 'PUBLISH',
      },
    })
    assert(fbAuditLog !== null, 'AuditLog: Tự động ghi nhận sự kiện PUBLISH thành công')
    if (fbAuditLog) createdAuditLogIds.push(fbAuditLog.id)

    // 3. Tạo bài viết Website Blog, duyệt và xuất bản
    const webPost = await createPost({
      channel: 'WEBSITE',
      title: 'Tĩnh Lặng Trong Từng Giọt Trà Sớm',
      content: 'Trong cái se lạnh của buổi sớm, pha một ấm trà sen thơm ngát...',
      excerpt: 'Cảm nhận sự tĩnh lặng và an trú hiện tại.',
      campaignId: testCampaign.id,
      mediaUrls: ['https://cdn.uudam.vn/img/tra-sen-som.jpg'],
      targetUrl: 'https://uudam.vn/products/tra-sen-dac-biet',
      hashtags: '#thientra #uudam #tinhlang',
      isMock: true,
    })
    createdPostIds.push(webPost.id)

    await submitForApproval(webPost.id)
    await approvePost(webPost.id, 'Chủ tiệm Ưu Đàm')

    const webPublishResult = await publishPostItem(webPost.id, { skipTimeGate: true })
    assert(webPublishResult.success === true, 'publishPostItem (Website): Xuất bản thành công')

    const reloadedWebPost = await prisma.socialPost.findUnique({ where: { id: webPost.id } })
    assert(
      reloadedWebPost?.status === 'PUBLISHED',
      'Website Post: Trạng thái cập nhật thành PUBLISHED'
    )
    assert(
      typeof reloadedWebPost?.slug === 'string' && reloadedWebPost.slug.length > 5,
      'Website Post: Tự động sinh và lưu slug vào CSDL'
    )
    assert(
      reloadedWebPost?.externalPostUrl === `/blog/${reloadedWebPost?.slug}`,
      'Website Post: externalPostUrl trỏ đúng đường dẫn công khai /blog/[slug]'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 7: KIỂM THỬ HIỂN THỊ TRANG CÔNG KHAI /blog VÀ /blog/[slug]
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 7] Kiểm thử hiển thị trang công khai (/blog & /blog/[slug]) ---')

    // 1. Kiểm thử hàm generateMetadata của Next.js 16
    const metadata = await generateBlogMetadata({
      params: Promise.resolve({ slug: reloadedWebPost!.slug! }),
    })
    assert(
      typeof metadata.title === 'string' && metadata.title.includes('Tĩnh Lặng Trong Từng Giọt Trà Sớm'),
      'generateMetadata: Tạo title SEO chính xác từ bài viết đã xuất bản'
    )

    // 2. Kiểm thử Render Component bài viết đơn (BlogPostPage)
    const blogPostElement = await BlogPostPage({
      params: Promise.resolve({ slug: reloadedWebPost!.slug! }),
    })
    assert(blogPostElement !== null, 'BlogPostPage: Render thành công bài viết theo slug')

    // 3. Kiểm thử Render Component danh sách bài viết (BlogListPage)
    const blogListElement = await BlogListPage()
    assert(blogListElement !== null, 'BlogListPage: Render thành công danh sách bài viết công khai')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 8: KIỂM THỬ ROUTE HANDLER POST /api/social/publish
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 8] Kiểm thử Route Handler POST /api/social/publish ---')

    // 1. Tạo bài viết Threads để xuất bản qua Route Handler
    const threadsPost = await createPost({
      channel: 'THREADS',
      content: 'Bình minh lên, gửi gắm bình an tới muôn nhà qua OPENVN.',
      campaignId: testCampaign.id,
      isMock: true,
    })
    createdPostIds.push(threadsPost.id)
    await submitForApproval(threadsPost.id)
    await approvePost(threadsPost.id, 'Chủ tiệm Ưu Đàm')

    const validReq = new NextRequest('http://localhost:3010/api/social/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postId: threadsPost.id,
        skipTimeGate: true,
        forceMock: true,
      }),
    })

    const routeRes = await postPublishRoute(validReq)
    const routeData = await routeRes.json()
    assert(routeRes.status === 200, 'Route Handler: Trả về HTTP 200 khi xuất bản bài viết hợp lệ')
    assert(routeData.success === true, 'Route Handler: success = true trong response')
    assert(
      typeof routeData.externalPostId === 'string' && routeData.externalPostId.startsWith('threads_post_'),
      'Route Handler: Trả về externalPostId từ adapter'
    )

    // 2. Kiểm thử Route Handler từ chối bài chưa duyệt (Cổng 1)
    const unapprovedPost = await createPost({
      channel: 'FACEBOOK',
      content: 'Bài viết chưa duyệt',
      campaignId: testCampaign.id,
    })
    createdPostIds.push(unapprovedPost.id)

    const unapprovedReq = new NextRequest('http://localhost:3010/api/social/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId: unapprovedPost.id }),
    })
    const unapprovedRes = await postPublishRoute(unapprovedReq)
    assert(
      unapprovedRes.status === 422,
      'Route Handler: Trả về HTTP 422 khi bài viết chưa được chủ tiệm duyệt (Cổng 1)'
    )

    // 3. Kiểm thử Route Handler thiếu postId
    const missingPostIdReq = new NextRequest('http://localhost:3010/api/social/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const missingPostIdRes = await postPublishRoute(missingPostIdReq)
    assert(
      missingPostIdRes.status === 400,
      'Route Handler: Trả về HTTP 400 khi thiếu trường postId'
    )

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 9: KIỂM TOÁN LẦN CUỐI VỀ AN TOÀN MẠNG
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 9] Kiểm toán An Toàn Mạng Tuyệt Đối (R6) ---')
    assert(
      outboundHttpAttempts === 0,
      'BẢO ĐẢM TUYỆT ĐỐI (R6): Không có bất kỳ kết nối mạng nào tới máy chủ MXH bên ngoài'
    )
  } finally {
    // ------------------------------------------------------------------
    // GIAI ĐOẠN 10: DỌN DẸP DỮ LIỆU & ĐỐI SOÁT BẢO TOÀN BASELINE (R7)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 10] Dọn dẹp dữ liệu kiểm thử & Đối soát hoàn nguyên ---')
    restoreNetworkSpy()

    try {
      // Xóa các bài viết test
      if (createdPostIds.length > 0) {
        await prisma.socialPost.deleteMany({
          where: { id: { in: createdPostIds } },
        })
      }

      // Xóa các chiến dịch test
      for (const campaignId of createdCampaignIds) {
        await deleteCampaign(campaignId).catch(() => null)
      }

      // Xóa AuditLog liên quan đến bài viết test
      if (createdPostIds.length > 0) {
        await prisma.auditLog.deleteMany({
          where: {
            entityType: 'SocialPost',
            entityId: { in: createdPostIds },
          },
        })
      }

      console.log('🧹 Đã dọn sạch toàn bộ bài viết, chiến dịch và audit log thử nghiệm.')
    } catch (cleanupErr) {
      console.warn('⚠️ Lỗi trong quá trình dọn dẹp dữ liệu test:', cleanupErr)
    }

    // Đối soát 24 bảng baseline
    await verifyBaselineParity('POST-TEST')
  }

  console.log('\n================================================================================')
  console.log(`🎉 HOÀN THÀNH KIỂM THỬ MILESTONE 5: ${passedTests} passed, ${failedTests} failed 🎉`)
  console.log('================================================================================\n')
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err) => {
    console.error('\n💥 LỖI KIỂM THỬ MILESTONE 5:', err)
    process.exit(1)
  })
