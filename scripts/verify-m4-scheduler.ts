// scripts/verify-m4-scheduler.ts
// Automated Verification Suite for Milestone 4 (M4: Post Review, Approval Workflow & Scheduling Engine - R4)
// OPENVN · Ưu Đàm Suite - AUTO SOCIAL
// Tests:
// 1. Initial 24-table core baseline parity (Delta = 0)
// 2. Post Lifecycle State Machine (FEAT-REV-01): DRAFT -> PENDING_APPROVAL -> APPROVED / REJECTED -> SCHEDULED
// 3. Gate 1: Owner Approval Gate (CRITICAL R4 INVARIANT - DRAFT, PENDING, REJECTED blocked)
// 4. Gate 2: Campaign Status Gate (CRITICAL R4 INVARIANT - ENDED / CANCELLED campaigns blocked & rejected)
// 5. Gate 3: Scheduled Time Gate (CRITICAL R4 INVARIANT - future posts skipped, <= 1 min window published)
// 6. Concurrency Idempotency Lock (FEAT-REV-03 - atomic SQLite lock prevents duplicate publishing)
// 7. Publishing Retry & Failure Handling (FEAT-REV-05 - failure tracking, audit log, retryPublishPost)
// 8. Next.js 16 Route Handlers Direct E2E (POST, GET, PUT approve/reject/reschedule/retry, DELETE)
// 9. Clean Teardown & Final 24-table baseline invariance (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { NextRequest } from 'next/server'
import {
  createPost,
  updatePost,
  getPost,
  listPosts,
  deletePost,
  submitForApproval,
  approvePost,
  rejectPost,
  reschedulePost,
  publishPostItem,
  retryPublishPost,
  processScheduledPosts,
  defaultMockPublisher,
  type PublisherFunction,
} from '../src/lib/social-scheduler'
import { createCampaign, deleteCampaign } from '../src/lib/campaign-service'
import { GET as getPostsRoute, POST as postPostsRoute } from '../src/app/api/social/posts/route'
import {
  GET as getPostByIdRoute,
  PUT as putPostByIdRoute,
  DELETE as deletePostByIdRoute,
} from '../src/app/api/social/posts/[id]/route'
import { POST as postScheduleRoute } from '../src/app/api/social/schedule/route'

const prisma = new PrismaClient()

let passedTests = 0
let failedTests = 0

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
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MILESTONE 4: REVIEW & SCHEDULING ENGINE (R4) 🚀')
  console.log('================================================================================\n')

  // Mảng lưu ID các bản ghi tạo trong lúc kiểm thử để dọn dẹp sạch sẽ
  const createdPostIds: string[] = []
  const createdCampaignIds: string[] = []

  try {
    // ------------------------------------------------------------------
    // GIAI ĐOẠN 1: ĐỐI SOÁT BASELINE BAN ĐẦU 24 BẢNG NGHIỆP VỤ CỐT LÕI
    // ------------------------------------------------------------------
    console.log('--- [GIAI ĐOẠN 1] Kiểm toán đối soát 24 bảng baseline trước kiểm thử ---')
    await verifyBaselineParity('PRE-TEST')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 2: POST LIFECYCLE STATE MACHINE (FEAT-REV-01)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 2] Kiểm thử máy trạng thái vòng đời bài viết (FEAT-REV-01) ---')

    // 2.1 Tạo bài viết nháp
    const postDraft = await createPost({
      channel: 'FACEBOOK',
      content: 'Trầm hương cao cấp Ưu Đàm mừng đại lễ Vu Lan',
      title: 'Khuyến mãi Vu Lan 2026',
    })
    createdPostIds.push(postDraft.id)
    assert(postDraft.status === 'DRAFT', 'Tạo bài viết mới mặc định ở trạng thái DRAFT')
    assert(postDraft.approvedAt === null, 'Bài viết mới có approvedAt là null')

    // 2.2 Nộp bài để chờ duyệt: DRAFT -> PENDING_APPROVAL
    const submittedPost = await submitForApproval(postDraft.id)
    assert(submittedPost.status === 'PENDING_APPROVAL', 'Nộp duyệt chuyển trạng thái sang PENDING_APPROVAL')

    // 2.3 Từ chối duyệt: PENDING_APPROVAL -> REJECTED
    const rejectedPost = await rejectPost(postDraft.id, 'Chủ tiệm Ưu Đàm', 'Nội dung chưa đủ trang nhã')
    assert(rejectedPost.status === 'REJECTED', 'Từ chối bài viết chuyển trạng thái sang REJECTED')
    assert(rejectedPost.approvalNote === 'Nội dung chưa đủ trang nhã', 'Lưu đúng lý do từ chối vào approvalNote')
    assert(rejectedPost.approvedAt === null, 'approvedAt được đặt về null khi bị từ chối')

    // 2.4 Nộp lại duyệt sau khi sửa: REJECTED -> PENDING_APPROVAL
    const resubmittedPost = await submitForApproval(postDraft.id)
    assert(resubmittedPost.status === 'PENDING_APPROVAL', 'Nộp lại bài viết chuyển từ REJECTED sang PENDING_APPROVAL')

    // 2.5 Phê duyệt bài viết (không có scheduledAt): PENDING_APPROVAL -> APPROVED
    const approvedPost = await approvePost(postDraft.id, 'Chủ tiệm Ưu Đàm', 'Duyệt bài đăng ngay')
    assert(approvedPost.status === 'APPROVED', 'Phê duyệt bài không có lịch hẹn chuyển sang APPROVED')
    assert(approvedPost.approvedBy === 'Chủ tiệm Ưu Đàm', 'Ghi nhận đúng approvedBy')
    assert(approvedPost.approvedAt !== null, 'Ghi nhận timestamp approvedAt')
    assert(approvedPost.approvalNote === 'Duyệt bài đăng ngay', 'Ghi nhận approvalNote khi duyệt')

    // 2.6 Đổi lịch đăng bài (reschedule): APPROVED -> SCHEDULED
    const targetFutureDate = new Date(Date.now() + 3600_000) // 1 giờ sau
    const rescheduledPost = await reschedulePost(postDraft.id, targetFutureDate)
    assert(rescheduledPost.status === 'SCHEDULED', 'Đổi lịch hẹn của bài APPROVED chuyển sang SCHEDULED')
    assert(
      new Date(rescheduledPost.scheduledAt!).getTime() === targetFutureDate.getTime(),
      'scheduledAt được cập nhật chính xác'
    )

    // 2.7 Phê duyệt bài viết đã có sẵn scheduledAt: chuyển thẳng sang SCHEDULED
    const scheduledDraft = await createPost({
      channel: 'ZALO_OA',
      content: 'Bản tin Zalo OA Ưu Đàm phát hành định kỳ',
      scheduledAt: targetFutureDate,
    })
    createdPostIds.push(scheduledDraft.id)
    const approvedWithSchedule = await approvePost(scheduledDraft.id, 'Chủ tiệm Ưu Đàm')
    assert(
      approvedWithSchedule.status === 'SCHEDULED',
      'Phê duyệt bài có sẵn scheduledAt chuyển thẳng sang trạng thái SCHEDULED'
    )

    // 2.8 Kiểm tra lịch sử AuditLog của bài viết
    const postWithAudit = await getPost(postDraft.id)
    assert(postWithAudit !== null, 'Lấy chi tiết bài viết kèm AuditLog thành công')
    assert(postWithAudit!.auditLogs.length >= 4, 'AuditLog ghi nhận đầy đủ các bước chuyển trạng thái (>= 4 bản ghi)')
    const auditActions = postWithAudit!.auditLogs.map((a) => a.action)
    assert(auditActions.includes('CREATE'), 'AuditLog ghi nhận CREATE')
    assert(auditActions.includes('UPDATE'), 'AuditLog ghi nhận UPDATE')
    assert(auditActions.includes('REJECT'), 'AuditLog ghi nhận REJECT')
    assert(auditActions.includes('APPROVE'), 'AuditLog ghi nhận APPROVE')
    assert(auditActions.includes('RESCHEDULE'), 'AuditLog ghi nhận RESCHEDULE')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 3: CỔNG 1 - OWNER APPROVAL GATE (CRITICAL R4 INVARIANT)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 3] Kiểm thử Cổng 1: Owner Approval Gate (CRITICAL R4 INVARIANT) ---')

    // 3.1 Bài viết DRAFT không bao giờ được xuất bản
    const unapprovedDraft = await createPost({
      channel: 'INSTAGRAM',
      content: 'Ảnh nến thơm hoa sen Ưu Đàm',
    })
    createdPostIds.push(unapprovedDraft.id)
    const draftPubResult = await publishPostItem(unapprovedDraft.id)
    assert(draftPubResult.success === false, 'Bài viết DRAFT bị chặn xuất bản (success === false)')
    assert(draftPubResult.reason === 'POST_NOT_APPROVED', 'Mã lỗi chặn đúng: POST_NOT_APPROVED')

    // 3.2 Bài viết PENDING_APPROVAL không bao giờ được xuất bản
    await submitForApproval(unapprovedDraft.id)
    const pendingPubResult = await publishPostItem(unapprovedDraft.id)
    assert(pendingPubResult.success === false, 'Bài viết PENDING_APPROVAL bị chặn xuất bản (success === false)')
    assert(pendingPubResult.reason === 'POST_NOT_APPROVED', 'Mã lỗi chặn đúng: POST_NOT_APPROVED')

    // 3.3 Bài viết REJECTED không bao giờ được xuất bản
    await rejectPost(unapprovedDraft.id, 'Chủ tiệm Ưu Đàm', 'Ảnh chưa đạt độ nét')
    const rejectedPubResult = await publishPostItem(unapprovedDraft.id)
    assert(rejectedPubResult.success === false, 'Bài viết REJECTED bị chặn xuất bản (success === false)')
    assert(rejectedPubResult.reason === 'POST_NOT_APPROVED', 'Mã lỗi chặn đúng: POST_NOT_APPROVED')

    // 3.4 Bài viết có status APPROVED nhưng approvedAt = null cũng bị chặn
    const corruptedPost = await prisma.socialPost.create({
      data: {
        channel: 'WEBSITE',
        content: 'Bài viết blog giả mạo',
        status: 'APPROVED',
        approvedAt: null, // Thiếu timestamp duyệt thật
      },
    })
    createdPostIds.push(corruptedPost.id)
    const corruptedPubResult = await publishPostItem(corruptedPost.id)
    assert(corruptedPubResult.success === false, 'Bài APPROVED nhưng approvedAt null bị chặn xuất bản')
    assert(corruptedPubResult.reason === 'POST_NOT_APPROVED', 'Mã lỗi chặn đúng: POST_NOT_APPROVED')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 4: CỔNG 2 - CAMPAIGN STATUS GATE (CRITICAL R4 INVARIANT)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 4] Kiểm thử Cổng 2: Campaign Status Gate (CRITICAL R4 INVARIANT) ---')

    // 4.1 Chiến dịch đã kết thúc (ENDED) -> Chặn xuất bản & tự động chuyển bài sang REJECTED
    const endedCampaign = await createCampaign({
      code: `CP-ENDED-${Date.now()}`,
      name: 'Chiến dịch Tết Nguyên Đán đã qua',
      startDate: new Date(Date.now() - 10 * 86400_000), // 10 ngày trước
      endDate: new Date(Date.now() - 2 * 86400_000),    // 2 ngày trước (đã kết thúc)
    })
    createdCampaignIds.push(endedCampaign.id)

    const postForEndedCampaign = await createPost({
      campaignId: endedCampaign.id,
      channel: 'FACEBOOK',
      content: 'Bài viết khuyến mãi Tết Nguyên Đán',
      status: 'APPROVED',
    })
    createdPostIds.push(postForEndedCampaign.id)
    // Set approvedAt hợp lệ để bài qua được Cổng 1
    await prisma.socialPost.update({
      where: { id: postForEndedCampaign.id },
      data: { approvedAt: new Date() },
    })

    const endedPubResult = await publishPostItem(postForEndedCampaign.id)
    assert(endedPubResult.success === false, 'Bài của chiến dịch ENDED bị chặn xuất bản')
    assert(endedPubResult.reason === 'CAMPAIGN_ENDED_OR_CANCELLED', 'Lý do trả về CAMPAIGN_ENDED_OR_CANCELLED')

    // Kiểm tra DB: Bài viết phải tự động chuyển sang REJECTED
    const dbPostAfterEnded = await prisma.socialPost.findUnique({ where: { id: postForEndedCampaign.id } })
    assert(dbPostAfterEnded!.status === 'REJECTED', 'Bài viết tự động chuyển sang REJECTED khi chiến dịch ENDED')
    assert(
      dbPostAfterEnded!.approvalNote === 'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy',
      'approvalNote ghi nhận lý do từ chối tự động của hệ thống'
    )
    assert(dbPostAfterEnded!.approvedAt === null, 'approvedAt bị reset về null để ngăn duyệt lậu')

    // 4.2 Chiến dịch bị hủy (CANCELLED) -> Chặn xuất bản & tự động chuyển bài sang REJECTED
    const cancelledCampaign = await createCampaign({
      code: `CP-CANCEL-${Date.now()}`,
      name: 'Chiến dịch tạm hoãn do nhà cung cấp',
      startDate: new Date(Date.now() - 86400_000),
      endDate: new Date(Date.now() + 86400_000),
      status: 'CANCELLED',
    })
    createdCampaignIds.push(cancelledCampaign.id)

    const postForCancelledCampaign = await createPost({
      campaignId: cancelledCampaign.id,
      channel: 'TIKTOK',
      content: 'Kịch bản TikTok chiến dịch bị hủy',
      status: 'APPROVED',
    })
    createdPostIds.push(postForCancelledCampaign.id)
    await prisma.socialPost.update({
      where: { id: postForCancelledCampaign.id },
      data: { approvedAt: new Date() },
    })

    const cancelledPubResult = await publishPostItem(postForCancelledCampaign.id)
    assert(cancelledPubResult.success === false, 'Bài của chiến dịch CANCELLED bị chặn xuất bản')
    assert(cancelledPubResult.reason === 'CAMPAIGN_ENDED_OR_CANCELLED', 'Lý do trả về CAMPAIGN_ENDED_OR_CANCELLED')

    const dbPostAfterCancelled = await prisma.socialPost.findUnique({ where: { id: postForCancelledCampaign.id } })
    assert(dbPostAfterCancelled!.status === 'REJECTED', 'Bài viết tự động chuyển sang REJECTED khi chiến dịch CANCELLED')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 5: CỔNG 3 - SCHEDULED TIME GATE (CRITICAL R4 INVARIANT)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 5] Kiểm thử Cổng 3: Scheduled Time Gate (Dung sai 1 phút) ---')

    const now = new Date()

    // 5.1 Bài viết hẹn giờ ở tương lai xa (> 60s) -> Bỏ qua, giữ nguyên SCHEDULED
    const futurePost = await createPost({
      channel: 'THREADS',
      content: 'Bài viết Threads cho chiều mai',
      scheduledAt: new Date(now.getTime() + 10 * 60_000), // 10 phút nữa
      status: 'APPROVED',
    })
    createdPostIds.push(futurePost.id)
    await prisma.socialPost.update({
      where: { id: futurePost.id },
      data: { status: 'SCHEDULED', approvedAt: new Date() },
    })

    const futurePubResult = await publishPostItem(futurePost.id, { now })
    assert(futurePubResult.success === false, 'Bài hẹn giờ tương lai xa không được xuất bản')
    assert(futurePubResult.skipped === true, 'Kết quả đánh dấu skipped = true')
    assert(futurePubResult.reason === 'SCHEDULED_TIME_NOT_REACHED', 'Lý do: SCHEDULED_TIME_NOT_REACHED')

    const dbFuturePost = await prisma.socialPost.findUnique({ where: { id: futurePost.id } })
    assert(dbFuturePost!.status === 'SCHEDULED', 'Trạng thái bài viết tương lai vẫn là SCHEDULED')

    // 5.2 Trình quét processScheduledPosts(now) quét không chọn bài tương lai > 60s
    const queueFutureRun = await processScheduledPosts(now)
    assert(
      !queueFutureRun.results.some((r) => r.postId === futurePost.id && r.success),
      'processScheduledPosts không xuất bản bài tương lai > 60s'
    )

    // 5.3 Bài viết hẹn giờ nằm trong dung sai 60 giây (now + 30s) -> Được xuất bản thành công!
    const withinTolerancePost = await createPost({
      channel: 'WEBSITE',
      title: 'Bài viết blog công khai',
      slug: `bai-viet-dung-sai-${Date.now()}`,
      content: 'Nội dung bài viết thử nghiệm dung sai xuất bản 60 giây',
      scheduledAt: new Date(now.getTime() + 30_000), // 30 giây nữa (nằm trong dung sai <= 60s)
    })
    createdPostIds.push(withinTolerancePost.id)
    await approvePost(withinTolerancePost.id, 'Chủ tiệm Ưu Đàm')

    const queueToleranceRun = await processScheduledPosts(now)
    const matchToleranceResult = queueToleranceRun.results.find((r) => r.postId === withinTolerancePost.id)
    assert(matchToleranceResult !== undefined, 'Bài viết trong dung sai 60s được quét trong hàng đợi')
    assert(matchToleranceResult!.success === true, 'Bài viết trong dung sai 60s xuất bản thành công')

    const dbTolerancePost = await prisma.socialPost.findUnique({ where: { id: withinTolerancePost.id } })
    assert(dbTolerancePost!.status === 'PUBLISHED', 'Trạng thái bài viết chuyển sang PUBLISHED')
    assert(dbTolerancePost!.publishedAt !== null, 'Thời gian publishedAt được ghi nhận')

    // 5.4 Bài viết hẹn giờ trong quá khứ (now - 5 phút) -> Được xuất bản thành công!
    const pastPost = await createPost({
      channel: 'FACEBOOK',
      content: 'Bài viết bị tồn đọng 5 phút trước',
      scheduledAt: new Date(now.getTime() - 5 * 60_000),
    })
    createdPostIds.push(pastPost.id)
    await approvePost(pastPost.id, 'Chủ tiệm Ưu Đàm')

    const queuePastRun = await processScheduledPosts(now)
    const matchPastResult = queuePastRun.results.find((r) => r.postId === pastPost.id)
    assert(matchPastResult !== undefined && matchPastResult.success === true, 'Bài viết quá hạn được xuất bản bù thành công')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 6: CONCURRENCY IDEMPOTENCY LOCK (FEAT-REV-03)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 6] Kiểm thử Khóa chống xuất bản trùng lặp đồng thời (FEAT-REV-03) ---')

    const concurrentPost = await createPost({
      channel: 'ZALO_OA',
      content: 'Tin nhắn Zalo OA gửi đồng thời',
      scheduledAt: new Date(now.getTime() - 1000),
    })
    createdPostIds.push(concurrentPost.id)
    await approvePost(concurrentPost.id, 'Chủ tiệm Ưu Đàm')

    // Bắn 2 lệnh publishPostItem song song trong cùng một millisecond
    console.log('⚡ Kích hoạt 2 tác vụ xuất bản song song trên cùng một bài viết...')
    const [call1, call2] = await Promise.all([
      publishPostItem(concurrentPost.id, { now }),
      publishPostItem(concurrentPost.id, { now }),
    ])

    const successCount = (call1.success ? 1 : 0) + (call2.success ? 1 : 0)
    const lockBlockedCount =
      (call1.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS' ? 1 : 0) +
      (call2.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS' ? 1 : 0)

    assert(successCount === 1, 'Chính xác 1 cuộc gọi xuất bản thành công (successCount === 1)')
    assert(lockBlockedCount === 1, 'Cuộc gọi còn lại bị khóa Concurrency chặn lại (lockBlockedCount === 1)')

    const dbConcurrentPost = await prisma.socialPost.findUnique({ where: { id: concurrentPost.id } })
    assert(dbConcurrentPost!.status === 'PUBLISHED', 'Trạng thái bài viết cuối cùng là PUBLISHED')
    assert(dbConcurrentPost!.isPublishing === false, 'Cờ isPublishing được giải phóng về false')

    // Kiểm tra số lần ghi nhận AuditLog hành động PUBLISH cho bài viết này
    const publishAudits = await prisma.auditLog.count({
      where: {
        entityType: 'SocialPost',
        entityId: concurrentPost.id,
        action: 'PUBLISH',
      },
    })
    assert(publishAudits === 1, 'AuditLog chỉ ghi nhận chính xác 1 lần PUBLISH thành công (không nhân đôi)')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 7: PUBLISHING RETRY & FAILURE HANDLING (FEAT-REV-05)
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 7] Kiểm thử Xử lý lỗi xuất bản và Thử lại (FEAT-REV-05) ---')

    const failPost = await createPost({
      channel: 'INSTAGRAM',
      content: 'Bài đăng Instagram sẽ gặp lỗi API giả lập',
    })
    createdPostIds.push(failPost.id)
    await approvePost(failPost.id, 'Chủ tiệm Ưu Đàm')

    // Mock publisher trả về lỗi thất bại
    const failingPublisher: PublisherFunction = async () => ({
      success: false,
      error: 'Simulated API Quota Exceeded (HTTP 429)',
      isMockResult: true,
    })

    const failResult = await publishPostItem(failPost.id, {
      publisher: failingPublisher,
      skipTimeGate: true,
    })

    assert(failResult.success === false, 'Tác vụ xuất bản thất bại trả về success = false')
    assert(failResult.reason === 'PUBLISHER_FAILED', 'Lý do: PUBLISHER_FAILED')

    const dbFailPost = await prisma.socialPost.findUnique({ where: { id: failPost.id } })
    assert(dbFailPost!.status === 'FAILED', 'Trạng thái bài viết chuyển sang FAILED')
    assert(
      dbFailPost!.publishError === 'Simulated API Quota Exceeded (HTTP 429)',
      'Ghi nhận chi tiết thông báo lỗi vào publishError'
    )
    assert(dbFailPost!.retryCount === 1, 'Số lần thử lại retryCount tăng lên 1')
    assert(dbFailPost!.isPublishing === false, 'Cờ isPublishing được hoàn trả về false')

    // Kiểm tra AuditLog có bản ghi ERROR
    const errorAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'SocialPost',
        entityId: failPost.id,
        action: 'ERROR',
      },
    })
    assert(errorAudit !== null, 'AuditLog ghi nhận hành động ERROR khi xuất bản lỗi')
    assert(errorAudit!.status === 'FAILED', 'AuditLog ghi nhận status = FAILED')

    // Thử lại bài viết bằng retryPublishPost với publisher thành công
    console.log('🔄 Thực hiện thử lại đăng bài (retryPublishPost)...')
    const retryResult = await retryPublishPost(failPost.id, {
      publisher: defaultMockPublisher,
    })

    assert(retryResult.success === true, 'Thử lại đăng bài thành công')
    const dbRetriedPost = await prisma.socialPost.findUnique({ where: { id: failPost.id } })
    assert(dbRetriedPost!.status === 'PUBLISHED', 'Trạng thái bài viết sau khi retry thành công là PUBLISHED')
    assert(dbRetriedPost!.publishError === null, 'publishError được dọn sạch về null')
    assert(dbRetriedPost!.externalPostId !== null, 'externalPostId được tạo lập đầy đủ')

    const retryAudit = await prisma.auditLog.findFirst({
      where: {
        entityType: 'SocialPost',
        entityId: failPost.id,
        action: 'RETRY',
      },
    })
    assert(retryAudit !== null, 'AuditLog ghi nhận hành động RETRY')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 7.2: KIỂM THỬ BẤT BIẾN RETRY VÀ PHÒNG CHỐNG VƯỢT RÀO PHÊ DUYỆT
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 7.2] Kiểm thử Bất biến retryPublishPost (Chặn DRAFT, PENDING, REJECTED, HTTP 400) ---')

    // 7.2.1: retryPublishPost phải ném lỗi khi gọi trên bài viết REJECTED
    const rejectedPostForRetry = await createPost({
      channel: 'FACEBOOK',
      content: 'Bài viết bị từ chối thử retry',
    })
    createdPostIds.push(rejectedPostForRetry.id)
    await rejectPost(rejectedPostForRetry.id, 'Chủ tiệm Ưu Đàm', 'Nội dung phản cảm cấm đăng')

    let rejectedRetryThrew = false
    try {
      await retryPublishPost(rejectedPostForRetry.id)
    } catch (err: unknown) {
      rejectedRetryThrew = true
      assert(
        (err as Error).message.includes('FAILED'),
        'retryPublishPost ném lỗi mô tả rõ chỉ cho phép FAILED khi gọi trên bài REJECTED'
      )
    }
    assert(rejectedRetryThrew, 'retryPublishPost chặn triệt để bài viết REJECTED')

    // 7.2.2: retryPublishPost phải ném lỗi khi gọi trên bài viết DRAFT
    const draftPostForRetry = await createPost({
      channel: 'INSTAGRAM',
      content: 'Bài viết nháp chưa duyệt',
    })
    createdPostIds.push(draftPostForRetry.id)

    let draftRetryThrew = false
    try {
      await retryPublishPost(draftPostForRetry.id)
    } catch (err: unknown) {
      draftRetryThrew = true
      assert(
        (err as Error).message.includes('FAILED'),
        'retryPublishPost ném lỗi mô tả rõ chỉ cho phép FAILED khi gọi trên bài DRAFT'
      )
    }
    assert(draftRetryThrew, 'retryPublishPost chặn triệt để bài viết DRAFT')

    // 7.2.3: retryPublishPost phải ném lỗi khi gọi trên bài viết PENDING_APPROVAL
    const pendingPostForRetry = await createPost({
      channel: 'TIKTOK',
      content: 'Bài viết đang chờ duyệt',
    })
    createdPostIds.push(pendingPostForRetry.id)
    await submitForApproval(pendingPostForRetry.id)

    let pendingRetryThrew = false
    try {
      await retryPublishPost(pendingPostForRetry.id)
    } catch (err: unknown) {
      pendingRetryThrew = true
      assert(
        (err as Error).message.includes('FAILED'),
        'retryPublishPost ném lỗi mô tả rõ chỉ cho phép FAILED khi gọi trên bài PENDING_APPROVAL'
      )
    }
    assert(pendingRetryThrew, 'retryPublishPost chặn triệt để bài viết PENDING_APPROVAL')

    // 7.2.4: PUT /api/social/posts/[id] với { action: 'RETRY' } trả về HTTP 400 khi bài viết là REJECTED
    const apiRetryReq = new NextRequest(`http://localhost:3010/api/social/posts/${rejectedPostForRetry.id}`, {
      method: 'PUT',
      body: JSON.stringify({ action: 'RETRY' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const apiRetryRes = await putPostByIdRoute(apiRetryReq, {
      params: Promise.resolve({ id: rejectedPostForRetry.id }),
    })
    assert(apiRetryRes.status === 400, 'PUT /api/social/posts/[id] RETRY bài REJECTED trả về HTTP 400 Bad Request')
    const apiRetryErrorData = await apiRetryRes.json()
    assert(
      typeof apiRetryErrorData.error === 'string' && apiRetryErrorData.error.includes('FAILED'),
      'Thông báo lỗi API chứa nội dung chỉ cho phép trạng thái FAILED'
    )

    // 7.2.5: retryPublishPost thành công và xuất bản khi bài viết thực sự ở trạng thái FAILED (bảo tồn approvedAt gốc)
    const validFailedPost = await createPost({
      channel: 'WEBSITE',
      title: 'Bài viết hợp lệ từng duyệt nhưng lỗi mạng',
      content: 'Nội dung chia sẻ thiền định và trà đạo',
    })
    createdPostIds.push(validFailedPost.id)
    const originalApprovedPost = await approvePost(validFailedPost.id, 'Chủ tiệm Ưu Đàm', 'Duyệt bài chuẩn')
    const originalApprovedAtTime = new Date(originalApprovedPost.approvedAt!).getTime()

    // Giả lập lỗi xuất bản để đưa về trạng thái FAILED
    const failPublishRes = await publishPostItem(validFailedPost.id, {
      publisher: async () => ({ success: false, error: 'Network timeout (504)', isMockResult: true }),
      skipTimeGate: true,
    })
    assert(failPublishRes.success === false, 'Bài viết xuất bản lỗi chuyển thành công sang FAILED')

    const dbPreRetry = await prisma.socialPost.findUnique({ where: { id: validFailedPost.id } })
    assert(dbPreRetry!.status === 'FAILED', 'Xác nhận trạng thái DB là FAILED trước retry')
    assert(
      new Date(dbPreRetry!.approvedAt!).getTime() === originalApprovedAtTime,
      'approvedAt gốc của chủ tiệm vẫn được bảo toàn khi lỗi'
    )

    // Retry bài viết FAILED hợp lệ
    const validRetryResult = await retryPublishPost(validFailedPost.id, {
      publisher: defaultMockPublisher,
    })
    assert(validRetryResult.success === true, 'retryPublishPost thành công khi bài viết thực sự là FAILED')

    const dbPostAfterValidRetry = await prisma.socialPost.findUnique({ where: { id: validFailedPost.id } })
    assert(dbPostAfterValidRetry!.status === 'PUBLISHED', 'Trạng thái bài viết sau retry thành công là PUBLISHED')
    assert(
      new Date(dbPostAfterValidRetry!.approvedAt!).getTime() === originalApprovedAtTime,
      'approvedAt sau retry được bảo tồn tuyệt đối (không bị làm giả timestamp mới)'
    )
    assert(dbPostAfterValidRetry!.publishError === null, 'publishError được xóa sạch về null')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 8: KIỂM THỬ TRỰC TIẾP ROUTE HANDLERS NEXT.JS 16
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 8] Kiểm thử các Next.js 16 Route Handlers (API E2E) ---')

    // 8.1 POST /api/social/posts
    const postReq = new NextRequest('http://localhost:3010/api/social/posts', {
      method: 'POST',
      body: JSON.stringify({
        channel: 'TIKTOK',
        content: 'Video ngắn hướng dẫn đốt trầm hương an yên',
        title: 'Video TikTok Mẫu',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const postRes = await postPostsRoute(postReq)
    assert(postRes.status === 201, 'POST /api/social/posts trả về HTTP 201 Created')
    const postCreatedData = await postRes.json()
    assert(postCreatedData.id !== undefined, 'Dữ liệu trả về có id bài viết')
    assert(postCreatedData.channel === 'TIKTOK', 'Nền tảng TIKTOK khớp')
    createdPostIds.push(postCreatedData.id)

    // 8.2 GET /api/social/posts (có query param)
    const getReq = new NextRequest('http://localhost:3010/api/social/posts?channel=TIKTOK&page=1&pageSize=10')
    const getRes = await getPostsRoute(getReq)
    assert(getRes.status === 200, 'GET /api/social/posts trả về HTTP 200 OK')
    const getListData = await getRes.json()
    assert(Array.isArray(getListData.posts), 'Trả về mảng posts')
    assert(getListData.total >= 1, 'Tổng số bài viết >= 1')

    // 8.3 GET /api/social/posts/[id]
    const getByIdReq = new NextRequest(`http://localhost:3010/api/social/posts/${postCreatedData.id}`)
    const getByIdRes = await getPostByIdRoute(getByIdReq, {
      params: Promise.resolve({ id: postCreatedData.id }),
    })
    assert(getByIdRes.status === 200, 'GET /api/social/posts/[id] trả về HTTP 200 OK')
    const postDetailData = await getByIdRes.json()
    assert(postDetailData.id === postCreatedData.id, 'Chi tiết bài viết khớp ID')
    assert(Array.isArray(postDetailData.auditLogs), 'Chi tiết bài viết kèm mảng auditLogs')

    // 8.4 PUT /api/social/posts/[id] với action = APPROVE
    const approveReq = new NextRequest(`http://localhost:3010/api/social/posts/${postCreatedData.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        action: 'APPROVE',
        approver: 'Quản lý kho Ưu Đàm',
        note: 'Duyệt bài qua API route',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const approveRes = await putPostByIdRoute(approveReq, {
      params: Promise.resolve({ id: postCreatedData.id }),
    })
    assert(approveRes.status === 200, 'PUT /api/social/posts/[id] APPROVE trả về HTTP 200 OK')
    const approveData = await approveRes.json()
    assert(approveData.status === 'APPROVED', 'Bài viết chuyển sang APPROVED qua API')
    assert(approveData.approvedBy === 'Quản lý kho Ưu Đàm', 'approvedBy khớp qua API')

    // 8.5 PUT /api/social/posts/[id] với action = RESCHEDULE
    const newScheduleTime = new Date(Date.now() + 7200_000).toISOString()
    const rescheduleReq = new NextRequest(`http://localhost:3010/api/social/posts/${postCreatedData.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        action: 'RESCHEDULE',
        scheduledAt: newScheduleTime,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const rescheduleRes = await putPostByIdRoute(rescheduleReq, {
      params: Promise.resolve({ id: postCreatedData.id }),
    })
    assert(rescheduleRes.status === 200, 'PUT /api/social/posts/[id] RESCHEDULE trả về HTTP 200 OK')
    const rescheduleData = await rescheduleRes.json()
    assert(rescheduleData.status === 'SCHEDULED', 'Bài viết chuyển sang SCHEDULED sau khi đổi lịch')

    // 8.6 PUT /api/social/posts/[id] với action = REJECT
    const rejectReq = new NextRequest(`http://localhost:3010/api/social/posts/${postCreatedData.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        action: 'REJECT',
        approver: 'Chủ tiệm Ưu Đàm',
        reason: 'Thay đổi kế hoạch nội dung tuần này',
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const rejectRes = await putPostByIdRoute(rejectReq, {
      params: Promise.resolve({ id: postCreatedData.id }),
    })
    assert(rejectRes.status === 200, 'PUT /api/social/posts/[id] REJECT trả về HTTP 200 OK')
    const rejectData = await rejectRes.json()
    assert(rejectData.status === 'REJECTED', 'Bài viết chuyển sang REJECTED qua API')

    // 8.7 POST /api/social/schedule
    const scheduleReq = new NextRequest('http://localhost:3010/api/social/schedule', {
      method: 'POST',
      body: JSON.stringify({ referenceTime: new Date().toISOString() }),
      headers: { 'Content-Type': 'application/json' },
    })
    const scheduleRes = await postScheduleRoute(scheduleReq)
    assert(scheduleRes.status === 200, 'POST /api/social/schedule trả về HTTP 200 OK')
    const scheduleData = await scheduleRes.json()
    assert(scheduleData.success === true, 'Kích hoạt quét hàng đợi thành công')
    assert(typeof scheduleData.processed === 'number', 'Trả về thống kê processed')

    // 8.8 DELETE /api/social/posts/[id]
    // Xóa bài viết REJECTED thành công
    const deleteReq = new NextRequest(`http://localhost:3010/api/social/posts/${postCreatedData.id}`, {
      method: 'DELETE',
    })
    const deleteRes = await deletePostByIdRoute(deleteReq, {
      params: Promise.resolve({ id: postCreatedData.id }),
    })
    assert(deleteRes.status === 200, 'DELETE /api/social/posts/[id] bài chưa xuất bản trả về HTTP 200 OK')

    // Xác nhận không cho phép xóa bài đã PUBLISHED
    const deletePublishedReq = new NextRequest(`http://localhost:3010/api/social/posts/${withinTolerancePost.id}`, {
      method: 'DELETE',
    })
    const deletePublishedRes = await deletePostByIdRoute(deletePublishedReq, {
      params: Promise.resolve({ id: withinTolerancePost.id }),
    })
    assert(deletePublishedRes.status === 400, 'DELETE /api/social/posts/[id] bài PUBLISHED bị chặn (HTTP 400)')

    // ------------------------------------------------------------------
    // GIAI ĐOẠN 9: DỌN DẸP DỮ LIỆU TEST & ĐỐI SOÁT BASELINE TUYỆT ĐỐI
    // ------------------------------------------------------------------
    console.log('\n--- [GIAI ĐOẠN 9] Dọn dẹp toàn bộ dữ liệu kiểm thử & đối soát Baseline ---')

    // Xóa các bài viết tạo trong test
    if (createdPostIds.length > 0) {
      // Xóa AuditLog liên quan trước
      await prisma.auditLog.deleteMany({
        where: {
          entityType: 'SocialPost',
          entityId: { in: createdPostIds },
        },
      })
      await prisma.socialPost.deleteMany({
        where: { id: { in: createdPostIds } },
      })
    }

    // Xóa các chiến dịch tạo trong test
    if (createdCampaignIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: {
          entityType: 'Campaign',
          entityId: { in: createdCampaignIds },
        },
      })
      await prisma.campaign.deleteMany({
        where: { id: { in: createdCampaignIds } },
      })
    }

    // Xả WAL SQLite sạch sẽ
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

    // Đối soát 24 bảng cốt lõi sau dọn dẹp
    await verifyBaselineParity('POST-TEST TEARDOWN')

    console.log('\n================================================================================')
    console.log(`🎉 HOÀN TẤT KIỂM THỬ: ${passedTests} TEST PASS, ${failedTests} FAIL! 🎉`)
    console.log('>>> TOÀN BỘ CÁC CỔNG THÉP R4 & KHÓA CONCURRENCY ĐẠT CHUẨN TUYỆT ĐỐI <<<')
    console.log('================================================================================\n')
  } catch (err) {
    console.error('\n❌ PHÁT HIỆN LỖI TRONG QUÁ TRÌNH KIỂM THỬ:', err)
    // Dọn dẹp khẩn cấp nếu gặp lỗi
    try {
      if (createdPostIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { entityType: 'SocialPost', entityId: { in: createdPostIds } } })
        await prisma.socialPost.deleteMany({ where: { id: { in: createdPostIds } } })
      }
      if (createdCampaignIds.length > 0) {
        await prisma.auditLog.deleteMany({ where: { entityType: 'Campaign', entityId: { in: createdCampaignIds } } })
        await prisma.campaign.deleteMany({ where: { id: { in: createdCampaignIds } } })
      }
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
    } catch {
      // Bỏ qua lỗi dọn dẹp khẩn cấp
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
