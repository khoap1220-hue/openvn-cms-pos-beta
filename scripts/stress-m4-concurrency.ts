// scripts/stress-m4-concurrency.ts
// Empirical Adversarial Stress Test Suite for Milestone 4 (Concurrency Lock & Time Boundaries)
// Challenger 1 - Milestone 4

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

// Pre-initialize silent Prisma instance on globalThis before dynamic module imports
const silentPrisma = new PrismaClient({ log: ['error', 'warn'] })
;(globalThis as unknown as { prisma: PrismaClient }).prisma = silentPrisma

let passedAssertions = 0
let failedAssertions = 0

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`)
    passedAssertions++
  } else {
    console.error(`  ❌ [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`)
    failedAssertions++
    throw new Error(`Assertion failed: ${testName}`)
  }
}

async function verifyCoreBaselineParity(label: string) {
  const baselinePath = path.resolve('db/baseline-counts.json')
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
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
    const delegate = (silentPrisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    if (!delegate) continue
    const count = await delegate.count()
    const expected = baseline[table]
    if (count !== expected) {
      console.error(`❌ [MISMATCH] ${table}: actual=${count}, baseline=${expected}`)
      allMatch = false
    }
  }

  assert(allMatch, `Core 24 Tables Parity [${label}] (Delta = 0)`)
}

async function runStressTests() {
  // Dynamically import social-scheduler so that @/lib/db uses our pre-initialized silentPrisma
  const {
    createPost,
    approvePost,
    publishPostItem,
    processScheduledPosts,
  } = await import('../src/lib/social-scheduler')

  console.log('================================================================================')
  console.log('🔥 EMPIRICAL ADVERSARIAL STRESS TEST: CONCURRENCY LOCK & TIME BOUNDARIES 🔥')
  console.log('================================================================================\n')

  const createdPostIds: string[] = []

  // Pre-test counts
  const initialSocialPostCount = await silentPrisma.socialPost.count()
  const initialAuditLogCount = await silentPrisma.auditLog.count()
  console.log(`[Pre-test] SocialPost count: ${initialSocialPostCount}, AuditLog count: ${initialAuditLogCount}`)

  console.log('\n--- Step 0: Pre-test 24-Table Baseline Audit ---')
  await verifyCoreBaselineParity('PRE-TEST')

  try {
    // =========================================================================
    // SUITE 1: CONCURRENCY LOCK UNDER 10 PARALLEL REQUESTS (Zero Latency)
    // =========================================================================
    console.log('\n--- SUITE 1: Concurrency Lock under 10 parallel requests (Promise.all) ---')
    const post1 = await createPost({
      channel: 'FACEBOOK',
      content: 'Challenger 1 Stress Post #1 - 10 Parallel Requests',
      title: 'Stress Test Concurrency 10x',
    })
    createdPostIds.push(post1.id)
    await approvePost(post1.id, 'Chủ tiệm Ưu Đàm', 'Phê duyệt cho stress test 10x')

    const CONCURRENCY_COUNT_1 = 10
    console.log(`  Launching ${CONCURRENCY_COUNT_1} simultaneous publish attempts via Promise.all...`)
    const attempts1 = Array.from({ length: CONCURRENCY_COUNT_1 }, (_, i) =>
      publishPostItem(post1.id, { actor: `CALLER_${i + 1}`, skipTimeGate: true })
    )
    const results1 = await Promise.all(attempts1)

    const success1 = results1.filter((r) => r.success)
    const blocked1 = results1.filter((r) => r.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS')

    console.log(`  Result Summary: Success = ${success1.length}, Lock Blocked = ${blocked1.length}`)

    assert(results1.length === CONCURRENCY_COUNT_1, '10 publish attempts finished')
    assert(success1.length === 1, 'EXACTLY 1 attempt published successfully (successCount === 1)')
    assert(blocked1.length === 9, 'EXACTLY 9 attempts were blocked with concurrency lock active')

    const dbPost1 = await silentPrisma.socialPost.findUnique({ where: { id: post1.id } })
    assert(dbPost1 !== null, 'Post 1 exists in DB')
    assert(dbPost1!.status === 'PUBLISHED', 'Post 1 status is PUBLISHED')
    assert(dbPost1!.isPublishing === false, 'Post 1 isPublishing flag is released (false)')
    assert(dbPost1!.publishedAt !== null, 'Post 1 publishedAt is written')
    assert(dbPost1!.externalPostId !== null, 'Post 1 externalPostId is written')
    assert(dbPost1!.externalPostId!.startsWith('mock_facebook_'), 'Post 1 externalPostId format valid')

    const audits1 = await silentPrisma.auditLog.findMany({
      where: { entityType: 'SocialPost', entityId: post1.id },
    })
    const publishAudits1 = audits1.filter((a) => a.action === 'PUBLISH')
    assert(publishAudits1.length === 1, 'AuditLog has EXACTLY 1 PUBLISH record (no duplicate writes)')

    // =========================================================================
    // SUITE 2: HIGH CONTENTION & LATENCY (20 Parallel Requests with 40ms Delay)
    // =========================================================================
    console.log('\n--- SUITE 2: Concurrency Lock under 20 parallel requests with Latency ---')
    const post2 = await createPost({
      channel: 'ZALO_OA',
      content: 'Challenger 1 Stress Post #2 - 20 Parallel Requests with Latency',
      title: 'Stress Test Concurrency 20x Latency',
    })
    createdPostIds.push(post2.id)
    await approvePost(post2.id, 'Chủ tiệm Ưu Đàm', 'Phê duyệt cho stress test 20x')

    // Mock publisher with 40ms simulated network latency
    const delayedPublisher = async (req: { postId: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 40))
      return {
        success: true,
        externalPostId: `mock_zalo_delayed_${Date.now()}`,
        externalPostUrl: `https://zalo.oa.mock.local/${req.postId}`,
        publishedAt: new Date(),
        isMockResult: true,
      }
    }

    const CONCURRENCY_COUNT_2 = 20
    console.log(`  Launching ${CONCURRENCY_COUNT_2} simultaneous delayed publish attempts via Promise.all...`)
    const attempts2 = Array.from({ length: CONCURRENCY_COUNT_2 }, (_, i) =>
      publishPostItem(post2.id, {
        actor: `WORKER_SLOT_${i + 1}`,
        publisher: delayedPublisher,
        skipTimeGate: true,
      })
    )
    const results2 = await Promise.all(attempts2)

    const success2 = results2.filter((r) => r.success)
    const blocked2 = results2.filter((r) => r.reason === 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS')

    console.log(`  Result Summary: Success = ${success2.length}, Lock Blocked = ${blocked2.length}`)

    assert(results2.length === CONCURRENCY_COUNT_2, '20 publish attempts finished')
    assert(success2.length === 1, 'EXACTLY 1 attempt published successfully (successCount === 1)')
    assert(blocked2.length === 19, 'EXACTLY 19 attempts were blocked with concurrency lock active')

    const dbPost2 = await silentPrisma.socialPost.findUnique({ where: { id: post2.id } })
    assert(dbPost2!.status === 'PUBLISHED', 'Post 2 status is PUBLISHED')
    assert(dbPost2!.isPublishing === false, 'Post 2 isPublishing flag is released (false)')
    assert(dbPost2!.publishedAt !== null, 'Post 2 publishedAt is written')
    assert(dbPost2!.externalPostId !== null, 'Post 2 externalPostId is written')

    const publishAudits2 = await silentPrisma.auditLog.count({
      where: { entityType: 'SocialPost', entityId: post2.id, action: 'PUBLISH' },
    })
    assert(publishAudits2 === 1, 'AuditLog has EXACTLY 1 PUBLISH record for Post 2')

    // =========================================================================
    // SUITE 3: MIXED RACE: Cron Runner vs Manual Publish Collisions
    // =========================================================================
    console.log('\n--- SUITE 3: Mixed Concurrency: Cron Runner vs Manual Trigger Collisions ---')
    const post3Time = new Date('2026-10-28T10:00:00.000Z')
    const post3 = await createPost({
      channel: 'INSTAGRAM',
      content: 'Challenger 1 Stress Post #3 - Cron vs Manual Race',
      scheduledAt: post3Time,
    })
    createdPostIds.push(post3.id)
    await approvePost(post3.id, 'Chủ tiệm Ưu Đàm')

    const refNow = post3Time

    console.log('  Firing 5 processScheduledPosts + 5 manual publishPostItem concurrently...')
    const mixedAttempts = [
      ...Array.from({ length: 5 }, () => processScheduledPosts(refNow)),
      ...Array.from({ length: 5 }, () => publishPostItem(post3.id, { now: refNow })),
    ]
    await Promise.all(mixedAttempts)

    const dbPost3 = await silentPrisma.socialPost.findUnique({ where: { id: post3.id } })
    assert(dbPost3!.status === 'PUBLISHED', 'Post 3 status is PUBLISHED')
    assert(dbPost3!.isPublishing === false, 'Post 3 isPublishing is false')

    const publishAudits3 = await silentPrisma.auditLog.count({
      where: { entityType: 'SocialPost', entityId: post3.id, action: 'PUBLISH' },
    })
    assert(publishAudits3 === 1, 'AuditLog has EXACTLY 1 PUBLISH record in Cron vs Manual race')

    // =========================================================================
    // SUITE 4: SCHEDULED TIME BOUNDARY STRESS TESTS
    // Exact boundaries: scheduledAt - 61s, scheduledAt - 60s, scheduledAt - 59s
    // Using distinct schedule timestamps to guarantee clean isolation
    // =========================================================================
    console.log('\n--- SUITE 4: Scheduled Time Boundary Stress Tests ---')

    // -------------------------------------------------------------------------
    // Boundary 4.1: EXACTLY scheduledAt - 61s (Must be SKIPPED)
    // -------------------------------------------------------------------------
    console.log('\n  [Boundary 4.1] Test at scheduledAt - 61s (MUST BE SKIPPED)')
    const scheduleTime1 = new Date('2026-11-01T12:00:00.000Z')
    const postBound61 = await createPost({
      channel: 'TIKTOK',
      content: 'Boundary Test 61s before schedule',
      scheduledAt: scheduleTime1,
    })
    createdPostIds.push(postBound61.id)
    await approvePost(postBound61.id, 'Chủ tiệm Ưu Đàm')

    const timeAt61sBefore = new Date(scheduleTime1.getTime() - 61_000) // scheduledAt - 61s
    const result61 = await publishPostItem(postBound61.id, { now: timeAt61sBefore })

    assert(result61.success === false, 'scheduledAt - 61s: publishPostItem returns success: false')
    assert(result61.skipped === true, 'scheduledAt - 61s: publishPostItem returns skipped: true')
    assert(
      result61.reason === 'SCHEDULED_TIME_NOT_REACHED',
      'scheduledAt - 61s: reason is SCHEDULED_TIME_NOT_REACHED'
    )

    const dbPost61 = await silentPrisma.socialPost.findUnique({ where: { id: postBound61.id } })
    assert(dbPost61!.status === 'SCHEDULED', 'scheduledAt - 61s: Post remains in SCHEDULED status')
    assert(dbPost61!.publishedAt === null, 'scheduledAt - 61s: publishedAt remains null')
    assert(dbPost61!.externalPostId === null, 'scheduledAt - 61s: externalPostId remains null')

    const publishAudit61 = await silentPrisma.auditLog.count({
      where: { entityType: 'SocialPost', entityId: postBound61.id, action: 'PUBLISH' },
    })
    assert(publishAudit61 === 0, 'scheduledAt - 61s: No PUBLISH audit log created')

    // -------------------------------------------------------------------------
    // Boundary 4.2: EXACTLY scheduledAt - 60s (MUST BE PUBLISHED)
    // -------------------------------------------------------------------------
    console.log('\n  [Boundary 4.2] Test at scheduledAt - 60s (MUST BE PUBLISHED)')
    const scheduleTime2 = new Date('2026-11-02T12:00:00.000Z')
    const postBound60 = await createPost({
      channel: 'THREADS',
      content: 'Boundary Test 60s before schedule',
      scheduledAt: scheduleTime2,
    })
    createdPostIds.push(postBound60.id)
    await approvePost(postBound60.id, 'Chủ tiệm Ưu Đàm')

    const timeAt60sBefore = new Date(scheduleTime2.getTime() - 60_000) // scheduledAt - 60s (exact threshold)
    const result60 = await publishPostItem(postBound60.id, { now: timeAt60sBefore })

    assert(result60.success === true, 'scheduledAt - 60s: publishPostItem returns success: true')
    assert(result60.skipped === undefined || !result60.skipped, 'scheduledAt - 60s: not skipped')

    const dbPost60 = await silentPrisma.socialPost.findUnique({ where: { id: postBound60.id } })
    assert(dbPost60!.status === 'PUBLISHED', 'scheduledAt - 60s: Post transitions to PUBLISHED')
    assert(dbPost60!.publishedAt !== null, 'scheduledAt - 60s: publishedAt is set')
    assert(dbPost60!.externalPostId !== null, 'scheduledAt - 60s: externalPostId is set')

    const publishAudit60 = await silentPrisma.auditLog.count({
      where: { entityType: 'SocialPost', entityId: postBound60.id, action: 'PUBLISH' },
    })
    assert(publishAudit60 === 1, 'scheduledAt - 60s: EXACTLY 1 PUBLISH audit log created')

    // -------------------------------------------------------------------------
    // Boundary 4.3: EXACTLY scheduledAt - 59s (MUST BE PUBLISHED)
    // -------------------------------------------------------------------------
    console.log('\n  [Boundary 4.3] Test at scheduledAt - 59s (MUST BE PUBLISHED)')
    const scheduleTime3 = new Date('2026-11-03T12:00:00.000Z')
    const postBound59 = await createPost({
      channel: 'WEBSITE',
      content: 'Boundary Test 59s before schedule',
      scheduledAt: scheduleTime3,
    })
    createdPostIds.push(postBound59.id)
    await approvePost(postBound59.id, 'Chủ tiệm Ưu Đàm')

    const timeAt59sBefore = new Date(scheduleTime3.getTime() - 59_000) // scheduledAt - 59s (inside tolerance window)
    const result59 = await publishPostItem(postBound59.id, { now: timeAt59sBefore })

    assert(result59.success === true, 'scheduledAt - 59s: publishPostItem returns success: true')
    assert(result59.skipped === undefined || !result59.skipped, 'scheduledAt - 59s: not skipped')

    const dbPost59 = await silentPrisma.socialPost.findUnique({ where: { id: postBound59.id } })
    assert(dbPost59!.status === 'PUBLISHED', 'scheduledAt - 59s: Post transitions to PUBLISHED')
    assert(dbPost59!.publishedAt !== null, 'scheduledAt - 59s: publishedAt is set')
    assert(dbPost59!.externalPostId !== null, 'scheduledAt - 59s: externalPostId is set')

    const publishAudit59 = await silentPrisma.auditLog.count({
      where: { entityType: 'SocialPost', entityId: postBound59.id, action: 'PUBLISH' },
    })
    assert(publishAudit59 === 1, 'scheduledAt - 59s: EXACTLY 1 PUBLISH audit log created')

    // -------------------------------------------------------------------------
    // Boundary 4.4: processScheduledPosts Queue Runner Boundary Verification
    // -------------------------------------------------------------------------
    console.log('\n  [Boundary 4.4] processScheduledPosts Queue Runner Boundary Verification')

    // Post Q1 scheduled at T_Q1. Runner runs at T_Q1 - 60s. Must pick and publish Q1.
    const queueTime1 = new Date('2026-11-04T08:00:00.000Z')
    const postQ1 = await createPost({
      channel: 'EXTERNAL_CMS',
      content: 'Queue Runner Boundary Post at -60s',
      scheduledAt: queueTime1,
    })
    createdPostIds.push(postQ1.id)
    await approvePost(postQ1.id, 'Chủ tiệm Ưu Đàm')

    const runnerResult60 = await processScheduledPosts(new Date(queueTime1.getTime() - 60_000))
    const dbPostQ1 = await silentPrisma.socialPost.findUnique({ where: { id: postQ1.id } })
    assert(dbPostQ1!.status === 'PUBLISHED', 'Queue runner at T - 60s publishes scheduled post')

    // Post Q2 scheduled at T_Q2. Runner runs at T_Q2 - 61s. Must NOT pick Q2.
    const queueTime2 = new Date('2026-11-05T08:00:00.000Z')
    const postQ2 = await createPost({
      channel: 'FACEBOOK',
      content: 'Queue Runner Boundary Post at -61s',
      scheduledAt: queueTime2,
    })
    createdPostIds.push(postQ2.id)
    await approvePost(postQ2.id, 'Chủ tiệm Ưu Đàm')

    const runnerResult61 = await processScheduledPosts(new Date(queueTime2.getTime() - 61_000))
    const dbPostQ2 = await silentPrisma.socialPost.findUnique({ where: { id: postQ2.id } })
    assert(dbPostQ2!.status === 'SCHEDULED', 'Queue runner at T - 61s leaves post as SCHEDULED')
  } finally {
    // =========================================================================
    // STEP 5: TEARDOWN & REVERIFICATION
    // =========================================================================
    console.log('\n--- Step 5: Teardown Test Records & Parity Invariance ---')
    if (createdPostIds.length > 0) {
      console.log(`  Deleting AuditLog records for ${createdPostIds.length} test posts...`)
      await silentPrisma.auditLog.deleteMany({
        where: {
          entityType: 'SocialPost',
          entityId: { in: createdPostIds },
        },
      })

      console.log(`  Deleting ${createdPostIds.length} test SocialPost records...`)
      await silentPrisma.socialPost.deleteMany({
        where: { id: { in: createdPostIds } },
      })
    }

    console.log('  Executing PRAGMA wal_checkpoint(FULL)...')
    await silentPrisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

    const postSocialPostCount = await silentPrisma.socialPost.count()
    const postAuditLogCount = await silentPrisma.auditLog.count()
    console.log(`[Post-test] SocialPost count: ${postSocialPostCount}, AuditLog count: ${postAuditLogCount}`)

    assert(
      postSocialPostCount === initialSocialPostCount,
      `SocialPost table fully restored to initial count (${initialSocialPostCount})`
    )
    assert(
      postAuditLogCount === initialAuditLogCount,
      `AuditLog table fully restored to initial count (${initialAuditLogCount})`
    )

    console.log('\n--- Step 6: Post-test 24-Table Baseline Audit ---')
    await verifyCoreBaselineParity('POST-TEST TEARDOWN')

    await silentPrisma.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`🏆 STRESS TEST COMPLETE: ${passedAssertions} PASSED, ${failedAssertions} FAILED! 🏆`)
  console.log('================================================================================\n')
}

runStressTests().catch((err) => {
  console.error('\n❌ STRESS TEST EXECUTION FAILED:', err)
  process.exit(1)
})
