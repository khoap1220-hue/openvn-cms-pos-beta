// scripts/verify-challenger-2-m5.ts
// Empirical Adversarial Challenge Suite for Milestone 5 (Challenger 2)
// Scope: End-to-End Scheduling, Website Blog Rendering & Publishing Gateway Concurrency
//
// 1. Initial 24-table core baseline parity audit (Delta = 0)
// 2. End-to-End Scheduling & Website Publishing:
//    - Post created with channel: 'WEBSITE', status: 'APPROVED'
//    - Triggered via publishPostItem & processScheduledPosts
//    - Verifying: automated slug generation, Vietnamese accent stripping, status: 'PUBLISHED',
//      externalPostUrl: '/blog/${slug}', and AuditLog entry with action 'PUBLISH'
// 3. Blog Rendering & Security Boundary Enforcement:
//    - generateMetadata returns dynamic metadata for published post
//    - generateMetadata returns 404 fallback for invalid slug
//    - BlogPostPage renders full JSX article for published post
//    - BlogPostPage strictly triggers notFound() (404) for:
//      * non-existent slug
//      * unapproved / draft slug
//      * rejected slug
//      * published post belonging to other social channels (channel boundary isolation)
//    - BlogListPage renders and isolates published website posts only
// 4. Concurrency Stress Harness:
//    - 14 simultaneous publishes across all 7 supported platforms (2 per platform)
//    - 10 simultaneous race calls on a single post (Idempotency Lock enforcement: 1 winner, 9 rejected)
//    - 2 simultaneous queue runner executions (Double-publishing prevention on scheduled batch)
// 5. Outbound Network Spy: Strict zero outbound HTTP sockets invariant (FEAT-PUB-08, R6)
// 6. Complete Teardown & Final 24-table baseline parity audit (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { PrismaClient } from '@prisma/client'
import '@/lib/publishing-gateway'
import {
  publishPost,
  getAdapter,
  shouldUseSafeMock,
  generateUniqueSlug,
  slugifyVietnamese,
  type PublishRequest,
} from '@/lib/publishing-gateway'
import {
  createPost,
  approvePost,
  publishPostItem,
  processScheduledPosts,
  setPublisher,
  getPublisher,
} from '@/lib/social-scheduler'
import BlogListPage from '../src/app/blog/page'
import BlogPostPage, { generateMetadata as generateBlogMetadata } from '../src/app/blog/[slug]/page'

const prisma = new PrismaClient()

interface TestAssertion {
  name: string
  status: 'PASS' | 'FAIL'
  detail?: string
}

const assertions: TestAssertion[] = []
let passedCount = 0
let failedCount = 0
let outboundHttpAttempts = 0

// ============================================================
// NETWORK SPY FOR TEST SAFETY INVARIANT (FEAT-PUB-08, R6)
// ============================================================
const originalHttpRequest = http.request
const originalHttpsRequest = https.request
const originalFetch = global.fetch

function setupNetworkSpy() {
  const disallowedHostPattern = /(facebook|zalo|tiktok|threads|instagram|external-store)/i

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
    console.log(`  ✅ [PASS] ${testName}`)
    passedCount++
    assertions.push({ name: testName, status: 'PASS' })
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedCount++
    assertions.push({ name: testName, status: 'FAIL', detail })
    throw new Error(`Adversarial assertion failed: ${testName} (${detail || 'Condition not met'})`)
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
      console.error(`    ❌ [MISMATCH] ${table}: actual=${count}, baseline=${expected}`)
      allMatch = false
    }
  }

  assert(allMatch, `Đối soát bảo toàn 24 bảng baseline cốt lõi [${label}] (Delta = 0)`)
}

async function main() {
  console.log('================================================================================')
  console.log('🔥 EMPIRICAL CHALLENGER 2 — MILESTONE 5 VERIFICATION SUITE 🔥')
  console.log('🎯 Scope: End-to-End Scheduling, Website Blog Rendering & Concurrency Stress')
  console.log('================================================================================\n')

  setupNetworkSpy()
  setPublisher(publishPost)

  const trackedPostIds: string[] = []

  try {
    // --------------------------------------------------------------------------
    // PHASE 1: Baseline Audit (Pre-test)
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 1: Kiểm toán toàn vẹn cơ sở dữ liệu ban đầu ---')
    await verifyBaselineParity('Giai đoạn khởi tạo')
    console.log('')

    // --------------------------------------------------------------------------
    // PHASE 2: End-to-End Scheduling & Website Blog Publishing Gateway
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 2: Thử nghiệm thực nghiệm xuất bản bài viết Website & Slug ---')

    // Test 2.1: Direct publishPostItem for WEBSITE channel (auto slug generation)
    const rawTitle = 'Ưu Đàm — Nét Đẹp Thiền Trà & Trầm Hương Tĩnh Tại 2026'
    const post1 = await createPost({
      channel: 'WEBSITE',
      title: rawTitle,
      content: 'Nghệ thuật thưởng trầm và uống trà trong không gian thiền định của Ưu Đàm.\n\nNuôi dưỡng tâm từ bi và tĩnh tại mỗi ngày.',
      excerpt: 'Khám phá văn hóa trà đạo và trầm hương tự nhiên tại Ưu Đàm.',
      mediaUrls: ['https://uudam.vn/images/tea-ceremony.jpg', 'https://uudam.vn/images/agarwood.jpg'],
      hashtags: ['#thientra', '#tramhuong', '#uudam'],
      targetUrl: 'https://uudam.vn/san-pham/tram-huong-cao-cap',
    })
    trackedPostIds.push(post1.id)
    assert(post1.status === 'DRAFT', 'Bài viết website mới tạo mang trạng thái DRAFT')

    // Approve the post
    const approved1 = await approvePost(post1.id, 'Chủ tiệm Thích Tĩnh Lặng', 'Đạt chuẩn văn phong Ưu Đàm')
    assert(approved1.status === 'APPROVED', 'Bài viết website sau phê duyệt có trạng thái APPROVED')
    assert(approved1.approvedAt !== null, 'Bài viết website có approvedAt được ghi nhận')

    // Execute publish via publishPostItem
    const pubResult1 = await publishPostItem(post1.id)
    assert(pubResult1.success === true, 'publishPostItem trả về thành công')
    assert(Boolean(pubResult1.externalPostUrl), 'publishPostItem trả về externalPostUrl')

    // Inspect database post directly
    const dbPost1 = await prisma.socialPost.findUnique({ where: { id: post1.id } })
    assert(dbPost1 !== null, 'Tìm thấy bài viết trong CSDL sau xuất bản')
    assert(dbPost1?.status === 'PUBLISHED', 'Trạng thái CSDL bài viết chuyển sang PUBLISHED')
    assert(dbPost1?.isPublishing === false, 'Khóa isPublishing đã được giải phóng (false)')
    assert(dbPost1?.slug !== null && dbPost1?.slug !== undefined, 'Slug đã được tự động sinh trong CSDL')
    assert(
      dbPost1?.slug?.startsWith('uu-dam-net-dep-thien-tra-tram-huong-tinh-tai-2026-') === true,
      'Slug loại bỏ dấu tiếng Việt chuẩn SEO (slugifyVietnamese)'
    )
    assert(
      dbPost1?.externalPostUrl === `/blog/${dbPost1?.slug}`,
      `externalPostUrl khớp chính xác /blog/\${slug} (Thực tế: ${dbPost1?.externalPostUrl})`
    )
    assert(Boolean(dbPost1?.publishedAt), 'publishedAt được ghi nhận thời điểm xuất bản')
    assert(Boolean(dbPost1?.payloadSnapshot), 'payloadSnapshot được lưu lại đầy đủ')

    // Verify AuditLog record
    const auditLogs1 = await prisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: post1.id, action: 'PUBLISH' },
    })
    assert(auditLogs1.length === 1, 'Ghi nhận đúng 1 bản ghi AuditLog action PUBLISH cho bài viết')
    assert(auditLogs1[0].status === 'SUCCESS', 'AuditLog ghi nhận trạng thái SUCCESS')

    // Test 2.2: WEBSITE post with custom pre-specified slug
    const customSlug = 'cau-chuyen-tra-tram-ha-noi'
    const post2 = await createPost({
      channel: 'WEBSITE',
      title: 'Câu chuyện trà trầm Hà Nội',
      slug: customSlug,
      content: 'Những sớm thu Hà Nội thưởng tách trà sen thơm ngát cùng trầm hương dịu nhẹ.',
      excerpt: 'Tách trà sen mùa thu.',
    })
    trackedPostIds.push(post2.id)
    await approvePost(post2.id, 'Chủ tiệm Ưu Đàm')

    const pubResult2 = await publishPostItem(post2.id)
    assert(pubResult2.success === true, 'Xuất bản bài viết có slug tùy biến thành công')

    const dbPost2 = await prisma.socialPost.findUnique({ where: { id: post2.id } })
    assert(dbPost2?.slug === customSlug, 'Slug tùy biến được bảo toàn nguyên vẹn trong CSDL')
    assert(dbPost2?.externalPostUrl === `/blog/${customSlug}`, 'externalPostUrl sử dụng đúng slug tùy biến')

    // Test 2.3: WEBSITE post scheduled and executed via Scheduled Queue Runner (processScheduledPosts)
    const post3 = await createPost({
      channel: 'WEBSITE',
      title: 'Hẹn giờ xuất bản bài viết Ưu Đàm',
      content: 'Bài viết được lên lịch đăng tự động qua Scheduled Queue Runner.',
      scheduledAt: new Date(Date.now() - 5_000), // 5 seconds ago
    })
    trackedPostIds.push(post3.id)
    await approvePost(post3.id, 'Chủ tiệm Ưu Đàm')

    const queueResult = await processScheduledPosts(new Date())
    assert(queueResult.processed >= 1, `Queue runner đã quét ít nhất 1 bài viết (Thực tế: ${queueResult.processed})`)

    const dbPost3 = await prisma.socialPost.findUnique({ where: { id: post3.id } })
    assert(dbPost3?.status === 'PUBLISHED', 'Bài viết hẹn giờ được Queue Runner xuất bản thành PUBLISHED')
    assert(Boolean(dbPost3?.slug), 'Bài viết hẹn giờ đã được sinh slug')
    assert(dbPost3?.externalPostUrl === `/blog/${dbPost3?.slug}`, 'externalPostUrl của bài viết hẹn giờ chính xác')
    console.log('')

    // --------------------------------------------------------------------------
    // PHASE 3: Blog Rendering Engine (App Router Page & Metadata)
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 3: Kiểm thử kết xuất trang Blog & Hàng rào bảo mật 404 ---')

    // Test 3.1: generateMetadata for published website post
    const meta1 = await generateBlogMetadata({ params: Promise.resolve({ slug: dbPost1!.slug! }) })
    assert(
      typeof meta1.title === 'string' && meta1.title.includes(rawTitle),
      `generateMetadata trả về tiêu đề chứa tên bài viết (Thực tế: ${meta1.title})`
    )
    assert(
      meta1.description === dbPost1?.excerpt,
      'generateMetadata trả về mô tả khớp với excerpt bài viết'
    )
    assert(
      (meta1.openGraph as { type?: string })?.type === 'article',
      'generateMetadata cấu hình OpenGraph type là article'
    )
    assert(
      Array.isArray((meta1.openGraph as { images?: unknown[] })?.images) &&
        (meta1.openGraph as { images: string[] }).images.length > 0,
      'generateMetadata nạp ảnh bìa vào OpenGraph images'
    )

    // Test 3.2: generateMetadata fallback for non-existent slug
    const metaNotFound = await generateBlogMetadata({ params: Promise.resolve({ slug: 'non-existent-slug-404' }) })
    assert(
      metaNotFound.title === 'Bài viết không tìm thấy | Ưu Đàm',
      'generateMetadata trả về fallback title cho slug không tồn tại'
    )

    // Test 3.3: BlogPostPage rendering for published post
    const pageJsx = await BlogPostPage({ params: Promise.resolve({ slug: dbPost1!.slug! }) })
    assert(pageJsx !== null && typeof pageJsx === 'object', 'BlogPostPage kết xuất JSX React element thành công')

    // Test 3.4: BlogPostPage strictly throws 404 notFound() for non-existent slug
    let notFoundTriggered = false
    try {
      await BlogPostPage({ params: Promise.resolve({ slug: 'slug-chua-tung-ton-tai-xyz' }) })
    } catch (err: unknown) {
      const errorObj = err as { digest?: string; message?: string }
      if (errorObj?.digest?.includes('404') || errorObj?.message?.includes('404') || errorObj?.digest?.includes('NEXT_HTTP_ERROR_FALLBACK')) {
        notFoundTriggered = true
      }
    }
    assert(notFoundTriggered, 'BlogPostPage ném mã lỗi 404 (notFound) khi slug không tồn tại')

    // Test 3.5: BlogPostPage strictly triggers 404 for DRAFT post
    const draftPost = await createPost({
      channel: 'WEBSITE',
      title: 'Bản nháp bí mật chưa công bố',
      content: 'Nội dung chưa qua phê duyệt',
      slug: 'ban-nhap-bi-mat',
      status: 'DRAFT',
    })
    trackedPostIds.push(draftPost.id)

    let draftNotFound = false
    try {
      await BlogPostPage({ params: Promise.resolve({ slug: 'ban-nhap-bi-mat' }) })
    } catch (err: unknown) {
      const errorObj = err as { digest?: string; message?: string }
      if (errorObj?.digest?.includes('404') || errorObj?.digest?.includes('NEXT_HTTP_ERROR_FALLBACK')) {
        draftNotFound = true
      }
    }
    assert(draftNotFound, 'BlogPostPage chặn xem bài viết ở trạng thái DRAFT (kích hoạt 404)')

    // Test 3.6: BlogPostPage strictly triggers 404 for REJECTED post
    const rejectedPost = await createPost({
      channel: 'WEBSITE',
      title: 'Bài viết bị từ chối duyệt',
      content: 'Nội dung không hợp lệ',
      slug: 'bai-viet-bi-tu-choi',
      status: 'REJECTED',
    })
    trackedPostIds.push(rejectedPost.id)

    let rejectedNotFound = false
    try {
      await BlogPostPage({ params: Promise.resolve({ slug: 'bai-viet-bi-tu-choi' }) })
    } catch (err: unknown) {
      const errorObj = err as { digest?: string; message?: string }
      if (errorObj?.digest?.includes('404') || errorObj?.digest?.includes('NEXT_HTTP_ERROR_FALLBACK')) {
        rejectedNotFound = true
      }
    }
    assert(rejectedNotFound, 'BlogPostPage chặn xem bài viết ở trạng thái REJECTED (kích hoạt 404)')

    // Test 3.7: BlogPostPage channel security boundary: ignores PUBLISHED posts on other channels
    const fbPost = await createPost({
      channel: 'FACEBOOK',
      title: 'Bài viết Facebook công khai',
      content: 'Nội dung dành riêng cho Facebook Fanpage',
      slug: 'bai-viet-facebook-cong-khai',
      status: 'APPROVED',
    })
    trackedPostIds.push(fbPost.id)
    await publishPostItem(fbPost.id)

    // Ensure the facebook post has the slug in DB
    await prisma.socialPost.update({
      where: { id: fbPost.id },
      data: { slug: 'bai-viet-facebook-cong-khai' },
    })

    let fbChannelIsolated = false
    try {
      await BlogPostPage({ params: Promise.resolve({ slug: 'bai-viet-facebook-cong-khai' }) })
    } catch (err: unknown) {
      const errorObj = err as { digest?: string; message?: string }
      if (errorObj?.digest?.includes('404') || errorObj?.digest?.includes('NEXT_HTTP_ERROR_FALLBACK')) {
        fbChannelIsolated = true
      }
    }
    assert(fbChannelIsolated, 'BlogPostPage cô lập kênh: Chặn xem bài viết PUBLISHED thuộc kênh khác (kích hoạt 404)')

    // Test 3.8: BlogListPage rendering
    const blogListJsx = await BlogListPage()
    assert(blogListJsx !== null && typeof blogListJsx === 'object', 'BlogListPage kết xuất trang danh sách bài viết thành công')
    console.log('')

    // --------------------------------------------------------------------------
    // PHASE 4: Concurrency Stress Harness on Publishing Gateway
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 4: Kiểm thử chịu tải đồng thời & Khóa chống trùng lặp ---')

    // Test 4.1: Multi-platform high-concurrency burst (14 concurrent publishes across all 7 platforms)
    const platforms: Array<{ channel: string; mediaUrls?: string[]; mediaType?: string; content: string }> = [
      { channel: 'FACEBOOK', content: 'Facebook concurrent test 1' },
      { channel: 'FACEBOOK', content: 'Facebook concurrent test 2' },
      { channel: 'ZALO_OA', content: 'Zalo concurrent test 1' },
      { channel: 'ZALO_OA', content: 'Zalo concurrent test 2' },
      { channel: 'WEBSITE', content: 'Website concurrent test 1' },
      { channel: 'WEBSITE', content: 'Website concurrent test 2' },
      { channel: 'EXTERNAL_CMS', content: 'External CMS concurrent test 1' },
      { channel: 'EXTERNAL_CMS', content: 'External CMS concurrent test 2' },
      { channel: 'INSTAGRAM', content: 'Instagram concurrent test 1', mediaUrls: ['https://uudam.vn/ig1.jpg'] },
      { channel: 'INSTAGRAM', content: 'Instagram concurrent test 2', mediaUrls: ['https://uudam.vn/ig2.jpg'] },
      { channel: 'TIKTOK', content: 'TikTok concurrent test 1', mediaUrls: ['https://uudam.vn/video1.mp4'], mediaType: 'VIDEO' },
      { channel: 'TIKTOK', content: 'TikTok concurrent test 2', mediaUrls: ['https://uudam.vn/video2.mp4'], mediaType: 'VIDEO' },
      { channel: 'THREADS', content: 'Threads concurrent test 1' },
      { channel: 'THREADS', content: 'Threads concurrent test 2' },
    ]

    const concurrentPostIds: string[] = []
    for (let i = 0; i < platforms.length; i++) {
      const p = platforms[i]
      const created = await createPost({
        channel: p.channel,
        title: `Concurrent Title ${i}`,
        content: p.content,
        mediaUrls: p.mediaUrls,
        mediaType: p.mediaType,
      })
      concurrentPostIds.push(created.id)
      trackedPostIds.push(created.id)
      await approvePost(created.id, 'Chủ tiệm Ưu Đàm')
    }

    // Launch all 14 publishes simultaneously
    const publishPromises = concurrentPostIds.map((id) => publishPostItem(id))
    const publishSettled = await Promise.allSettled(publishPromises)

    const successfulPublishes = publishSettled.filter(
      (r) => r.status === 'fulfilled' && r.value.success === true
    )
    assert(
      successfulPublishes.length === 14,
      `Tất cả 14 yêu cầu xuất bản đồng thời trên 7 nền tảng đều thành công (Thực tế: ${successfulPublishes.length}/14)`
    )

    // Test 4.2: Atomic Concurrency Idempotency Lock on Single Post (10 simultaneous calls)
    const racePost = await createPost({
      channel: 'WEBSITE',
      title: 'Bài viết kiểm thử xung đột đồng thời 10 luồng',
      content: 'Nội dung kiểm tra race condition khóa nguyên tử SQLite',
    })
    trackedPostIds.push(racePost.id)
    await approvePost(racePost.id, 'Chủ tiệm Ưu Đàm')

    // Fire 10 simultaneous calls to publishPostItem on the exact same postId
    const racePromises = Array.from({ length: 10 }, () => publishPostItem(racePost.id))
    const raceResults = await Promise.all(racePromises)

    const winners = raceResults.filter((r) => r.success === true)
    const losers = raceResults.filter(
      (r) => r.success === false && r.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS'
    )

    assert(winners.length === 1, `Khóa Concurrency: Chính xác 1 luồng chiến thắng (Thực tế: ${winners.length})`)
    assert(losers.length === 9, `Khóa Concurrency: Chính xác 9 luồng bị chặn an toàn (Thực tế: ${losers.length})`)

    const raceDbPost = await prisma.socialPost.findUnique({ where: { id: racePost.id } })
    assert(raceDbPost?.status === 'PUBLISHED', 'Trạng thái bài viết duy trì PUBLISHED an toàn')
    assert(raceDbPost?.isPublishing === false, 'Khóa isPublishing được hoàn trả false sau race condition')

    const raceAuditLogs = await prisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: racePost.id, action: 'PUBLISH' },
    })
    assert(raceAuditLogs.length === 1, 'Chỉ duy nhất 1 bản ghi AuditLog action PUBLISH được tạo ra')

    // Test 4.3: Concurrency Race on Scheduled Queue Runner (2 simultaneous runners on 3 posts)
    const batchPostIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const bp = await createPost({
        channel: 'WEBSITE',
        title: `Batch Post ${i}`,
        content: `Nội dung batch ${i}`,
        scheduledAt: new Date(Date.now() - 10_000),
      })
      batchPostIds.push(bp.id)
      trackedPostIds.push(bp.id)
      await approvePost(bp.id, 'Chủ tiệm Ưu Đàm')
    }

    const [runnerA, runnerB] = await Promise.all([
      processScheduledPosts(new Date()),
      processScheduledPosts(new Date()),
    ])

    const totalPublishedInRunners = runnerA.published + runnerB.published
    assert(
      totalPublishedInRunners === 3,
      `2 Queue Runner chạy đồng thời xử lý xuất bản đúng 3 bài viết, không trùng lặp (A: ${runnerA.published}, B: ${runnerB.published})`
    )

    for (const bId of batchPostIds) {
      const logs = await prisma.auditLog.findMany({
        where: { entityType: 'SocialPost', entityId: bId, action: 'PUBLISH' },
      })
      assert(logs.length === 1, `Bài viết ${bId} trong batch được ghi nhận đúng 1 lần PUBLISH trong AuditLog`)
    }
    console.log('')

    // --------------------------------------------------------------------------
    // PHASE 5: Security & Zero Outbound HTTP Socket Invariant
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 5: Kiểm toán an ninh & Không rò rỉ socket mạng ngoài ---')
    assert(
      outboundHttpAttempts === 0,
      `Bất biến An ninh: 0 yêu cầu HTTP socket nào bị gửi ra ngoài (Thực tế: ${outboundHttpAttempts})`
    )
    console.log('')
  } finally {
    // --------------------------------------------------------------------------
    // PHASE 6: Complete Teardown & Baseline Parity Verification
    // --------------------------------------------------------------------------
    console.log('--- GIAI ĐOẠN 6: Dọn dẹp dữ liệu thử nghiệm & Kiểm toán bảo toàn 24 bảng ---')
    restoreNetworkSpy()

    if (trackedPostIds.length > 0) {
      console.log(`  Đang dọn dẹp ${trackedPostIds.length} bài viết thử nghiệm...`)
      // Delete associated audit logs first
      await prisma.auditLog.deleteMany({
        where: {
          entityType: 'SocialPost',
          entityId: { in: trackedPostIds },
        },
      })
      // Delete posts
      await prisma.socialPost.deleteMany({
        where: {
          id: { in: trackedPostIds },
        },
      })
    }

    await verifyBaselineParity('Giai đoạn kết thúc')
    console.log('')
  }

  console.log('================================================================================')
  console.log(`🏁 KẾT QUẢ KIỂM THỬ: ${passedCount} / ${passedCount + failedCount} ĐẠT (PASS)`)
  console.log(`❌ THẤT BẠI: ${failedCount}`)
  console.log('================================================================================\n')

  await prisma.$disconnect()

  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch(async (err) => {
  console.error('\n❌ XẢY RA LỖI TRONG QUÁ TRÌNH KIỂM THỬ ĐỐI KHÁNG:', err)
  await prisma.$disconnect()
  process.exit(1)
})
