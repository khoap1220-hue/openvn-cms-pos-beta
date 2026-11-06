// scripts/verify-challenger-2-m4.ts
// Empirical Adversarial Challenge Suite 2 for Milestone 4 (Boundary & Campaign Lifecycle Challenger)
// Focus:
// 1. Campaign Status Gate (Gate 2):
//    - Campaign active at schedule time, but expired (endDate in the past) or cancelled at publish time
//    - Verifying: immediate rejection to REJECTED, approvalNote explanation, AuditLog REJECT record, 0 external publish calls
//    - Inability to bypass gate via retryPublishPost while campaign remains expired/cancelled
// 2. Corrupted State Recovery:
//    - Post marked APPROVED but with approvedAt: null (Gate 1 rejection, recovery via approvePost and retryPublishPost)
//    - Post marked SCHEDULED but with scheduledAt: null (Queue runner exclusion, recovery via reschedulePost)
//    - Post crashed mid-publish (simulated hung isPublishing: true, status: PUBLISHING) and verification of retryPublishPost & rejectPost lock clearing
// 3. Absolute Cleanup & Zero Baseline Invariance (Delta = 0)

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  createPost,
  approvePost,
  rejectPost,
  reschedulePost,
  publishPostItem,
  retryPublishPost,
  processScheduledPosts,
  type PublisherFunction,
  type PublishRequest,
  type PublishResult,
} from '../src/lib/social-scheduler'
import { createCampaign, updateCampaign } from '../src/lib/campaign-service'

const prisma = new PrismaClient()

interface TestAssertion {
  name: string
  status: 'PASS' | 'FAIL'
  detail?: string
}

const assertions: TestAssertion[] = []
let passedCount = 0
let failedCount = 0

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
  console.log('🔥 EMPIRICAL CHALLENGER 2 — MILESTONE 4 ADVERSARIAL STRESS SUITE 🔥')
  console.log('🎯 Scope: Campaign Status Gate, Boundary Lifecycle & Corrupted State Recovery')
  console.log('================================================================================\n')

  const createdPostIds: string[] = []
  const createdCampaignIds: string[] = []

  // Mock / Spy publisher to strictly record external calls
  let spyPublishCalls: PublishRequest[] = []
  const spyPublisher: PublisherFunction = async (req: PublishRequest): Promise<PublishResult> => {
    spyPublishCalls.push(req)
    return {
      success: true,
      externalPostId: `spy_${Date.now()}`,
      externalPostUrl: `https://social.mock.local/posts/${Date.now()}`,
      publishedAt: new Date(),
      isMockResult: true,
    }
  }

  try {
    // -------------------------------------------------------------------------
    // BASELINE AUDIT
    // -------------------------------------------------------------------------
    console.log('▶ [PHASE 0] Pre-test 24-table database baseline audit')
    await verifyBaselineParity('PRE-TEST')

    // -------------------------------------------------------------------------
    // SUITE 1: CAMPAIGN STATUS GATE (GATE 2) ADVERSARIAL CHALLENGES
    // -------------------------------------------------------------------------
    console.log('\n▶ [SUITE 1] Adversarial Challenge: Campaign Status Gate (Gate 2)')

    // 1.1: Campaign active when post scheduled, but expired (endDate in the past) at publish time
    console.log('\n  --- [1.1] Campaign Expired at Publish Time ---')
    const now1 = new Date()
    const campaign1 = await createCampaign({
      code: `CP-ADV-EXP-${Date.now()}`,
      name: 'Chiến dịch Test Hết Hạn Biên',
      startDate: new Date(now1.getTime() - 3600_000), // Bắt đầu 1h trước
      endDate: new Date(now1.getTime() + 1800_000),  // Kết thúc sau 30m
      status: 'RUNNING',
    })
    createdCampaignIds.push(campaign1.id)

    const post1 = await createPost({
      channel: 'FACEBOOK',
      title: 'Bài viết test hết hạn chiến dịch',
      content: 'Ưu đãi đặc biệt giảm giá mùa hoa Ưu Đàm',
      campaignId: campaign1.id,
      scheduledAt: new Date(now1.getTime() + 10_000), // Lịch đăng sau 10s
    })
    createdPostIds.push(post1.id)

    await approvePost(post1.id, 'Chủ tiệm Ưu Đàm', 'Duyệt bài cho chiến dịch đang chạy')
    const approvedPost1 = await prisma.socialPost.findUnique({ where: { id: post1.id } })
    assert(approvedPost1?.status === 'SCHEDULED', '1.1.1 Post is initially SCHEDULED with approvedAt populated')
    assert(approvedPost1?.approvedAt !== null, '1.1.2 approvedAt is non-null after approval')

    // Now, simulate time passage where campaign has ended (endDate in the past)
    // We update campaign endDate to past, keeping DB status as RUNNING to test dynamic status computation!
    await prisma.campaign.update({
      where: { id: campaign1.id },
      data: {
        endDate: new Date(now1.getTime() - 600_000), // Đã hết hạn 10 phút trước
        status: 'RUNNING', // Cố tình để status trong DB là RUNNING để test dynamic computation!
      },
    })

    // Reset spy calls
    spyPublishCalls = []

    // Execute direct publish
    const publishResult1 = await publishPostItem(post1.id, {
      now: now1,
      publisher: spyPublisher,
    })

    assert(publishResult1.success === false, '1.1.3 publishPostItem returns success: false')
    assert(publishResult1.reason === 'CAMPAIGN_ENDED_OR_CANCELLED', '1.1.4 reason is CAMPAIGN_ENDED_OR_CANCELLED')
    assert(publishResult1.error === 'CAMPAIGN_ENDED_OR_CANCELLED', '1.1.5 error is CAMPAIGN_ENDED_OR_CANCELLED')
    assert(spyPublishCalls.length === 0, '1.1.6 STRICT 0 external publisher calls made for expired campaign post')

    // Inspect database state of post
    const updatedPost1 = await prisma.socialPost.findUnique({ where: { id: post1.id } })
    assert(updatedPost1?.status === 'REJECTED', '1.1.7 Post state transitioned immediately to REJECTED in database')
    assert(
      updatedPost1?.approvalNote?.includes('Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy') === true,
      '1.1.8 approvalNote contains explanation of campaign expiration rejection'
    )
    assert(updatedPost1?.approvedAt === null, '1.1.9 approvedAt cleared to null')
    assert(updatedPost1?.isPublishing === false, '1.1.10 isPublishing lock is false')

    // Inspect AuditLog entry
    const auditLogs1 = await prisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: post1.id, action: 'REJECT' },
      orderBy: { createdAt: 'desc' },
    })
    assert(auditLogs1.length >= 1, '1.1.11 AuditLog record created for rejection')
    const rejectLog1 = auditLogs1[0]
    assert(rejectLog1.actor === 'SYSTEM', '1.1.12 AuditLog actor is SYSTEM')
    assert(rejectLog1.status === 'SUCCESS', '1.1.13 AuditLog status is SUCCESS')
    const details1 = JSON.parse(rejectLog1.details || '{}')
    assert(details1.reason === 'CAMPAIGN_ENDED_OR_CANCELLED', '1.1.14 AuditLog details records CAMPAIGN_ENDED_OR_CANCELLED')
    assert(details1.campaignStatus === 'ENDED', '1.1.15 AuditLog details identifies dynamic campaignStatus as ENDED')

    // 1.2: Campaign active when post scheduled, but manually CANCELLED at publish time via Queue Runner
    console.log('\n  --- [1.2] Campaign CANCELLED at Publish Time via Queue Runner ---')
    const now2 = new Date()
    const campaign2 = await createCampaign({
      code: `CP-ADV-CNC-${Date.now()}`,
      name: 'Chiến dịch Test Hủy Khẩn Cấp',
      startDate: new Date(now2.getTime() - 3600_000),
      endDate: new Date(now2.getTime() + 7200_000), // Kết thúc sau 2h
      status: 'RUNNING',
    })
    createdCampaignIds.push(campaign2.id)

    const post2 = await createPost({
      channel: 'ZALO_OA',
      title: 'Bài Zalo thông báo ưu đãi',
      content: 'Chương trình tri ân khách hàng thân thiết Ưu Đàm',
      campaignId: campaign2.id,
      scheduledAt: new Date(now2.getTime() + 15_000), // Hẹn đăng sau 15s
    })
    createdPostIds.push(post2.id)

    await approvePost(post2.id, 'Chủ tiệm Ưu Đàm', 'Duyệt bài Zalo')
    const approvedPost2 = await prisma.socialPost.findUnique({ where: { id: post2.id } })
    assert(approvedPost2?.status === 'SCHEDULED', '1.2.1 Post 2 is SCHEDULED')

    // Operator cancels campaign before scheduled time
    await updateCampaign(campaign2.id, { status: 'CANCELLED' })

    // Reset spy calls
    spyPublishCalls = []

    // Queue runner triggers at scheduled time + 20s
    const runnerTime2 = new Date(now2.getTime() + 20_000)
    const runnerResult2 = await processScheduledPosts(runnerTime2, {
      publisher: spyPublisher,
    })

    assert(spyPublishCalls.length === 0, '1.2.2 STRICT 0 publisher calls made by queue runner on cancelled campaign post')
    assert(runnerResult2.failed >= 1, '1.2.3 Queue runner records failed/rejected item')

    const updatedPost2 = await prisma.socialPost.findUnique({ where: { id: post2.id } })
    assert(updatedPost2?.status === 'REJECTED', '1.2.4 Post 2 transitioned to REJECTED via Queue Runner')
    assert(
      updatedPost2?.approvalNote?.includes('Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy') === true,
      '1.2.5 Post 2 approvalNote contains explanation'
    )
    assert(updatedPost2?.approvedAt === null, '1.2.6 Post 2 approvedAt is null')

    const auditLogs2 = await prisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: post2.id, action: 'REJECT' },
      orderBy: { createdAt: 'desc' },
    })
    assert(auditLogs2.length >= 1, '1.2.7 AuditLog records rejection for cancelled campaign')
    const details2 = JSON.parse(auditLogs2[0].details || '{}')
    assert(details2.campaignStatus === 'CANCELLED', '1.2.8 AuditLog details confirms campaignStatus is CANCELLED')

    // Run queue runner again — post2 must NOT be queried or re-processed because it is REJECTED
    const runnerResult2Repeat = await processScheduledPosts(new Date(now2.getTime() + 40_000), {
      publisher: spyPublisher,
    })
    const post2InResults = runnerResult2Repeat.results.find((r) => r.postId === post2.id)
    assert(!post2InResults, '1.2.9 REJECTED post is permanently ignored by future scheduled queue runs')

    // 1.3: Adversarial Attempt: Can an operator bypass Gate 2 using retryPublishPost while campaign remains cancelled?
    console.log('\n  --- [1.3] Adversarial Attempt: Retry on Cancelled Campaign ---')
    spyPublishCalls = []
    let retryBlocked = false
    try {
      await retryPublishPost(post2.id, { publisher: spyPublisher })
    } catch (err: unknown) {
      retryBlocked = true
      assert(
        (err as Error).message.includes('FAILED'),
        '1.3.1 retryPublishPost strictly throws because post is in REJECTED state (not FAILED)'
      )
    }
    assert(retryBlocked, '1.3.2 retryPublishPost is blocked from retrying REJECTED post')
    assert(spyPublishCalls.length === 0, '1.3.3 STRICT 0 publisher calls made during invalid retry')

    const post2AfterRetry = await prisma.socialPost.findUnique({ where: { id: post2.id } })
    assert(post2AfterRetry?.status === 'REJECTED', '1.3.4 Post remains in REJECTED state after failed bypass attempt')

    // -------------------------------------------------------------------------
    // SUITE 2: CORRUPTED STATE RECOVERY ADVERSARIAL CHALLENGES
    // -------------------------------------------------------------------------
    console.log('\n▶ [SUITE 2] Adversarial Challenge: Corrupted State Recovery')

    // 2.1: Post marked APPROVED but approvedAt is NULL (Corrupted database state)
    console.log('\n  --- [2.1] Corrupted State: APPROVED with approvedAt = null ---')
    const postCorruptApproved = await createPost({
      channel: 'EXTERNAL_CMS',
      title: 'Bài viết CMS lỗi dữ liệu',
      content: 'Nội dung kiến thức phong thủy và năng lượng thạch cao',
    })
    createdPostIds.push(postCorruptApproved.id)

    // Force corrupted state into database
    await prisma.socialPost.update({
      where: { id: postCorruptApproved.id },
      data: {
        status: 'APPROVED',
        approvedAt: null, // Corrupted: status APPROVED but no timestamp!
      },
    })

    spyPublishCalls = []
    const publishAttemptCorrupt1 = await publishPostItem(postCorruptApproved.id, { publisher: spyPublisher })
    assert(publishAttemptCorrupt1.success === false, '2.1.1 Gate 1 blocks publishing when approvedAt is null')
    assert(publishAttemptCorrupt1.reason === 'POST_NOT_APPROVED', '2.1.2 reason is POST_NOT_APPROVED')
    assert(spyPublishCalls.length === 0, '2.1.3 STRICT 0 publisher calls made for unverified approval')

    // Recovery Method A: Owner re-approves
    await approvePost(postCorruptApproved.id, 'Chủ tiệm Ưu Đàm', 'Khôi phục phê duyệt hợp lệ')
    const healedPost1 = await prisma.socialPost.findUnique({ where: { id: postCorruptApproved.id } })
    assert(healedPost1?.status === 'APPROVED', '2.1.4 Post re-approved to APPROVED')
    assert(healedPost1?.approvedAt !== null, '2.1.5 approvedAt properly healed with valid Date')

    const healedPublishResult1 = await publishPostItem(postCorruptApproved.id, { publisher: spyPublisher })
    assert(healedPublishResult1.success === true, '2.1.6 Publishing succeeds after approval healing')
    assert(spyPublishCalls.length === 1, '2.1.7 Exactly 1 external publish call executed after heal')

    // 2.2: Post marked SCHEDULED but scheduledAt is NULL (Corrupted database state)
    console.log('\n  --- [2.2] Corrupted State: SCHEDULED with scheduledAt = null ---')
    const postCorruptScheduled = await createPost({
      channel: 'WEBSITE',
      title: 'Bài viết Website lịch đăng rỗng',
      content: 'Giới thiệu bộ sưu tập Thạch Cao Liên Hoa',
    })
    createdPostIds.push(postCorruptScheduled.id)

    // Force corrupted state: status SCHEDULED, approvedAt valid, but scheduledAt is null
    await prisma.socialPost.update({
      where: { id: postCorruptScheduled.id },
      data: {
        status: 'SCHEDULED',
        approvedAt: new Date(),
        scheduledAt: null, // Corrupted!
      },
    })

    spyPublishCalls = []
    // Scheduled queue runner must strictly ignore posts with scheduledAt = null
    const runnerCorrupt2 = await processScheduledPosts(new Date(), { publisher: spyPublisher })
    const corruptInRunner = runnerCorrupt2.results.find((r) => r.postId === postCorruptScheduled.id)
    assert(!corruptInRunner, '2.2.1 Queue runner safely excludes SCHEDULED post with scheduledAt = null')
    assert(spyPublishCalls.length === 0, '2.2.2 0 publisher calls made by queue runner on corrupted scheduled post')

    // Recovery Method: Reschedule post to a valid timestamp
    const targetScheduleTime = new Date(Date.now() + 5_000)
    await reschedulePost(postCorruptScheduled.id, targetScheduleTime, 'OPERATOR')
    const healedPost2 = await prisma.socialPost.findUnique({ where: { id: postCorruptScheduled.id } })
    assert(healedPost2?.status === 'SCHEDULED', '2.2.3 Status maintained as SCHEDULED')
    assert(healedPost2?.scheduledAt !== null, '2.2.4 scheduledAt successfully healed')

    // Now run queue runner with reference time covering targetScheduleTime
    const runnerPostHeal = await processScheduledPosts(new Date(Date.now() + 10_000), { publisher: spyPublisher })
    const healedInRunner = runnerPostHeal.results.find((r) => r.postId === postCorruptScheduled.id)
    assert(healedInRunner?.success === true, '2.2.5 Healed scheduled post processed and published successfully by runner')
    assert(spyPublishCalls.length === 1, '2.2.6 Exactly 1 publish call executed by runner')

    // 2.3: Crashed mid-publish (Simulated hung isPublishing = true, status: PUBLISHING)
    console.log('\n  --- [2.3] Crashed Mid-Publish: Simulated Hung isPublishing = true ---')
    const postHung = await createPost({
      channel: 'FACEBOOK',
      title: 'Bài viết bị crash giữa chừng',
      content: 'Thông tin livestream tư vấn chữa lành cùng Thạch Cao',
      scheduledAt: new Date(Date.now() - 60_000),
    })
    createdPostIds.push(postHung.id)

    await approvePost(postHung.id, 'Chủ tiệm Ưu Đàm')

    // Simulate fatal crash: process died while holding lock!
    await prisma.socialPost.update({
      where: { id: postHung.id },
      data: {
        status: 'PUBLISHING',
        isPublishing: true, // Hung lock!
      },
    })

    spyPublishCalls = []
    // Direct publish attempt is blocked by Gate 1 (status is PUBLISHING, not APPROVED/SCHEDULED)
    const blockedPublish = await publishPostItem(postHung.id, { publisher: spyPublisher })
    assert(blockedPublish.success === false, '2.3.1 publishPostItem blocked while post is stuck in PUBLISHING')
    assert(spyPublishCalls.length === 0, '2.3.2 0 publisher calls made while lock is hung')

    // Queue runner also skips posts with isPublishing = true
    const runnerSkipHung = await processScheduledPosts(new Date(), { publisher: spyPublisher })
    const hungInRunner = runnerSkipHung.results.find((r) => r.postId === postHung.id)
    assert(!hungInRunner, '2.3.3 Queue runner skips posts with isPublishing = true')
    assert(spyPublishCalls.length === 0, '2.3.4 0 publisher calls made by queue runner on hung lock')

    // Recovery Action 1: retryPublishPost blocks hung/in-flight post, then recovers once transitioned to FAILED
    console.log('    Testing In-Flight Protection & Recovery via retryPublishPost...')
    let hungRetryBlocked = false
    try {
      await retryPublishPost(postHung.id, { publisher: spyPublisher })
    } catch (err: unknown) {
      hungRetryBlocked = true
      assert(
        (err as Error).message.includes('tiến trình xuất bản') || (err as Error).message.includes('FAILED'),
        '2.3.5 retryPublishPost strictly blocks in-flight/hung post (isPublishing = true)'
      )
    }
    assert(hungRetryBlocked, '2.3.5b retryPublishPost threw invariant error on in-flight/hung post')

    // Supervisor marks dead process post as FAILED (retaining original approvedAt)
    await prisma.socialPost.update({
      where: { id: postHung.id },
      data: {
        status: 'FAILED',
        isPublishing: false,
        publishError: 'Process terminated unexpectedly',
      },
    })

    const retryHungResult = await retryPublishPost(postHung.id, { publisher: spyPublisher })
    assert(retryHungResult.success === true, '2.3.5c retryPublishPost successfully clears and publishes FAILED post')
    assert(spyPublishCalls.length === 1, '2.3.6 Exactly 1 publisher call executed after retry recovery')

    const postAfterRetry = await prisma.socialPost.findUnique({ where: { id: postHung.id } })
    assert(postAfterRetry?.status === 'PUBLISHED', '2.3.7 Post reached PUBLISHED status after retry recovery')
    assert(postAfterRetry?.isPublishing === false, '2.3.8 isPublishing is false (lock properly released)')
    assert(postAfterRetry?.publishedAt !== null, '2.3.9 publishedAt is populated')

    const retryLogs = await prisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: postHung.id, action: 'RETRY' },
    })
    assert(retryLogs.length >= 1, '2.3.10 RETRY action logged in AuditLog')

    // Recovery Action 2: rejectPost also successfully clears hung lock if operator decides to cancel
    console.log('    Testing Recovery via rejectPost on Hung Post...')
    const postHung2 = await createPost({
      channel: 'FACEBOOK',
      title: 'Bài viết bị treo thứ hai',
      content: 'Bài viết cần hủy bỏ khi tiến trình bị treo',
    })
    createdPostIds.push(postHung2.id)

    // Set hung lock
    await prisma.socialPost.update({
      where: { id: postHung2.id },
      data: {
        status: 'PUBLISHING',
        isPublishing: true,
      },
    })

    await rejectPost(postHung2.id, 'Quản trị viên', 'Hủy bài do tiến trình bị treo')
    const postHung2AfterReject = await prisma.socialPost.findUnique({ where: { id: postHung2.id } })
    assert(postHung2AfterReject?.status === 'REJECTED', '2.3.11 rejectPost successfully transitions hung post to REJECTED')
    assert(postHung2AfterReject?.isPublishing === false, '2.3.12 rejectPost clears isPublishing to false')
    assert(
      postHung2AfterReject?.approvalNote === 'Hủy bài do tiến trình bị treo',
      '2.3.13 approvalNote contains operator cancel reason'
    )

    // -------------------------------------------------------------------------
    // CLEANUP & BASELINE PARITY VERIFICATION (POST-TEST)
    // -------------------------------------------------------------------------
    console.log('\n▶ [PHASE 3] Absolute Cleanup of all Test Artifacts & Invariance Verification')

    if (createdPostIds.length > 0) {
      console.log(`  Cleaning up ${createdPostIds.length} test SocialPost records & their AuditLogs...`)
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

    if (createdCampaignIds.length > 0) {
      console.log(`  Cleaning up ${createdCampaignIds.length} test Campaign records & their AuditLogs...`)
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

    // SQLite WAL Flush
    await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

    // Post-test 24 core table parity
    await verifyBaselineParity('POST-TEST TEARDOWN')

    console.log('\n================================================================================')
    console.log(`🎉 HOÀN TẤT KIỂM THỬ ĐỐI KHÁNG: ${passedCount} TEST PASS, ${failedCount} FAIL! 🎉`)
    console.log('>>> TOÀN BỘ CỔNG CHIẾN DỊCH, BIÊN VÒNG ĐỜI & KHÔI PHỤC LỖI ĐẠT CHUẨN TUYỆT ĐỐI <<<')
    console.log('================================================================================\n')
  } catch (err) {
    console.error('\n❌ PHÁT HIỆN LỖI TRONG KIỂM THỬ ĐỐI KHÁNG:', err)
    // Emergency cleanup
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
      // Ignore cleanup error
    }
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
