// scripts/test-m1-adversarial.ts
// Empirical Adversarial Stress Test Suite for Milestone 1 (M1: CRM Campaigns & DB Safety)
// Tests: Extreme Boundary ms, Inverted/Equal Dates, Timezone Resilience (UTC & GMT+7),
//        Concurrency Stress & Collision Rejection, Audit Logging, Pricing Clamping, DB Baseline Parity.

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  computeCampaignStatus,
  validateCampaignDates,
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  deleteCampaign,
  enrichCampaignData,
  generateCampaignCode,
} from '../src/lib/campaign-service'

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

async function main() {
  console.log('======================================================================')
  console.log('🔥 BẮT ĐẦU ADVERSARIAL STRESS TEST SUITE — MILESTONE 1 (CHALLENGER 1) 🔥')
  console.log('======================================================================\n')

  const testCampaignIdsToClean: string[] = []

  try {
    // ------------------------------------------------------------------
    // SUITE 1: EXTREME BOUNDARY & MILLISECOND PRECISION TESTS
    // ------------------------------------------------------------------
    console.log('--- [SUITE 1] Kiểm tra biên chính xác mili-giây & ngày cực trị ---')

    const tStart = new Date('2026-11-01T10:00:00.000Z')
    const tEnd = new Date('2026-11-15T22:00:00.000Z')
    const boundaryCamp = { startDate: tStart, endDate: tEnd, status: 'UPCOMING' }

    // Boundary 1: now == startDate - 1ms
    assert(
      computeCampaignStatus(boundaryCamp, new Date(tStart.getTime() - 1)) === 'UPCOMING',
      'Boundary: now = tStart - 1ms -> UPCOMING'
    )

    // Boundary 2: now == startDate
    assert(
      computeCampaignStatus(boundaryCamp, tStart) === 'RUNNING',
      'Boundary: now = tStart -> RUNNING'
    )

    // Boundary 3: now == startDate + 1ms
    assert(
      computeCampaignStatus(boundaryCamp, new Date(tStart.getTime() + 1)) === 'RUNNING',
      'Boundary: now = tStart + 1ms -> RUNNING'
    )

    // Boundary 4: now == endDate - 1ms
    assert(
      computeCampaignStatus(boundaryCamp, new Date(tEnd.getTime() - 1)) === 'RUNNING',
      'Boundary: now = tEnd - 1ms -> RUNNING'
    )

    // Boundary 5: now == endDate
    assert(
      computeCampaignStatus(boundaryCamp, tEnd) === 'RUNNING',
      'Boundary: now = tEnd -> RUNNING'
    )

    // Boundary 6: now == endDate + 1ms
    assert(
      computeCampaignStatus(boundaryCamp, new Date(tEnd.getTime() + 1)) === 'ENDED',
      'Boundary: now = tEnd + 1ms -> ENDED'
    )

    // Equal dates: startDate == endDate (duration 0 ms)
    const eqCheck = validateCampaignDates(tStart, tStart)
    assert(!eqCheck.valid, 'Equal dates: validateCampaignDates rejects startDate == endDate')

    let eqCreateFailed = false
    try {
      await createCampaign({
        name: 'Equal Dates Test',
        startDate: tStart,
        endDate: tStart,
      })
    } catch {
      eqCreateFailed = true
    }
    assert(eqCreateFailed, 'Equal dates: createCampaign throws error on equal start/end')

    // Inverted dates: startDate > endDate
    const invCheck = validateCampaignDates('2026-12-01T00:00:00Z', '2026-11-01T00:00:00Z')
    assert(!invCheck.valid, 'Inverted dates: validateCampaignDates rejects startDate > endDate')

    let invCreateFailed = false
    try {
      await createCampaign({
        name: 'Inverted Dates Test',
        startDate: '2026-12-01T00:00:00Z',
        endDate: '2026-11-01T00:00:00Z',
      })
    } catch {
      invCreateFailed = true
    }
    assert(invCreateFailed, 'Inverted dates: createCampaign throws error on inverted dates')

    // Far future dates (2050+)
    const futureStart = '2050-01-01T00:00:00.000Z'
    const futureEnd = '2060-12-31T23:59:59.999Z'
    assert(validateCampaignDates(futureStart, futureEnd).valid, 'Far-future: valid dates for 2050-2060')
    const futureCamp = { startDate: futureStart, endDate: futureEnd }
    assert(computeCampaignStatus(futureCamp, '2026-10-26T00:00:00.000Z') === 'UPCOMING', 'Far-future: UPCOMING in 2026')
    assert(computeCampaignStatus(futureCamp, '2055-06-01T00:00:00.000Z') === 'RUNNING', 'Far-future: RUNNING in 2055')
    assert(computeCampaignStatus(futureCamp, '2061-01-01T00:00:00.000Z') === 'ENDED', 'Far-future: ENDED in 2061')

    // Far past dates (1980s)
    const pastStart = '1980-01-01T00:00:00.000Z'
    const pastEnd = '1985-12-31T23:59:59.999Z'
    assert(validateCampaignDates(pastStart, pastEnd).valid, 'Far-past: valid dates for 1980-1985')
    const pastCamp = { startDate: pastStart, endDate: pastEnd }
    assert(computeCampaignStatus(pastCamp, '2026-10-26T00:00:00.000Z') === 'ENDED', 'Far-past: ENDED in 2026')
    assert(computeCampaignStatus(pastCamp, '1982-06-01T00:00:00.000Z') === 'RUNNING', 'Far-past: RUNNING in 1982')

    // Status CANCELLED invariance across all time points
    const cancelledCamp = { startDate: tStart, endDate: tEnd, status: 'CANCELLED' }
    assert(computeCampaignStatus(cancelledCamp, new Date(tStart.getTime() - 86400000)) === 'CANCELLED', 'Cancelled invariant: before start')
    assert(computeCampaignStatus(cancelledCamp, tStart) === 'CANCELLED', 'Cancelled invariant: at start')
    assert(computeCampaignStatus(cancelledCamp, new Date(tEnd.getTime() + 86400000)) === 'CANCELLED', 'Cancelled invariant: after end')

    // Malformed & NaN dates handling
    assert(!validateCampaignDates('invalid-date', tEnd).valid, 'Malformed: rejects invalid startDate')
    assert(!validateCampaignDates(tStart, 'bad-end-date').valid, 'Malformed: rejects invalid endDate')
    assert(computeCampaignStatus({ startDate: 'bad', endDate: 'bad' }, tStart) === 'ENDED', 'Malformed: computeStatus safely falls back to ENDED')

    // ------------------------------------------------------------------
    // SUITE 2: TIMEZONE RESILIENCE (UTC vs GMT+7 ASIA/HO_CHI_MINH)
    // ------------------------------------------------------------------
    console.log('\n--- [SUITE 2] Kiểm tra khả năng kháng lệch múi giờ (UTC vs GMT+7) ---')

    // Vietnam is UTC+7 (420 minutes offset)
    // 2026-11-01 07:00:00 GMT+7 is EXACTLY 2026-11-01 00:00:00 UTC
    const gmt7StartStr = '2026-11-01T07:00:00.000+07:00'
    const utcStartStr = '2026-11-01T00:00:00.000Z'
    const usStartStr = '2026-10-31T20:00:00.000-04:00' // EDT

    const gmt7EndStr = '2026-11-10T19:00:00.000+07:00'
    const utcEndStr = '2026-11-10T12:00:00.000Z'

    assert(
      new Date(gmt7StartStr).getTime() === new Date(utcStartStr).getTime(),
      'Timezone: GMT+7 string and UTC string have identical epoch milliseconds'
    )
    assert(
      new Date(gmt7StartStr).getTime() === new Date(usStartStr).getTime(),
      'Timezone: US EDT string and UTC string have identical epoch milliseconds'
    )

    const tzCampGMT7 = { startDate: gmt7StartStr, endDate: gmt7EndStr }
    const tzCampUTC = { startDate: utcStartStr, endDate: utcEndStr }

    // Test status evaluation with UTC 'now' vs GMT+7 'now'
    // Before start by 1ms
    const nowBefore1MsUTC = '2026-10-31T23:59:59.999Z'
    const nowBefore1MsGMT7 = '2026-11-01T06:59:59.999+07:00'
    assert(computeCampaignStatus(tzCampGMT7, nowBefore1MsUTC) === 'UPCOMING', 'Timezone: GMT+7 camp with UTC now-1ms -> UPCOMING')
    assert(computeCampaignStatus(tzCampUTC, nowBefore1MsGMT7) === 'UPCOMING', 'Timezone: UTC camp with GMT+7 now-1ms -> UPCOMING')

    // Exactly at start
    assert(computeCampaignStatus(tzCampGMT7, utcStartStr) === 'RUNNING', 'Timezone: GMT+7 camp at exact UTC start -> RUNNING')
    assert(computeCampaignStatus(tzCampUTC, gmt7StartStr) === 'RUNNING', 'Timezone: UTC camp at exact GMT+7 start -> RUNNING')

    // Exactly at end
    assert(computeCampaignStatus(tzCampGMT7, utcEndStr) === 'RUNNING', 'Timezone: GMT+7 camp at exact UTC end -> RUNNING')
    assert(computeCampaignStatus(tzCampUTC, gmt7EndStr) === 'RUNNING', 'Timezone: UTC camp at exact GMT+7 end -> RUNNING')

    // After end by 1ms
    const nowAfter1MsUTC = '2026-11-10T12:00:00.001Z'
    const nowAfter1MsGMT7 = '2026-11-10T19:00:00.001+07:00'
    assert(computeCampaignStatus(tzCampGMT7, nowAfter1MsUTC) === 'ENDED', 'Timezone: GMT+7 camp after UTC end+1ms -> ENDED')
    assert(computeCampaignStatus(tzCampUTC, nowAfter1MsGMT7) === 'ENDED', 'Timezone: UTC camp after GMT+7 end+1ms -> ENDED')

    // Persist GMT+7 campaign in DB and retrieve
    const dbTzCamp = await createCampaign({
      code: 'CP-ADV-TZ-01',
      name: 'Chiến Dịch Thử Nghiệm Múi Giờ GMT+7',
      startDate: gmt7StartStr,
      endDate: gmt7EndStr,
    })
    testCampaignIdsToClean.push(dbTzCamp.id)

    const fetchedTz = await getCampaign(dbTzCamp.id)
    assert(fetchedTz !== null, 'Timezone DB: retrieved campaign created with GMT+7')
    assert(
      new Date(fetchedTz!.startDate).getTime() === new Date(utcStartStr).getTime(),
      'Timezone DB: stored startDate matches exact UTC epoch timestamp'
    )
    assert(
      new Date(fetchedTz!.endDate).getTime() === new Date(utcEndStr).getTime(),
      'Timezone DB: stored endDate matches exact UTC epoch timestamp'
    )

    // ------------------------------------------------------------------
    // SUITE 3: CONCURRENCY STRESS, CODE UNIQUENESS & AUDIT LOGGING
    // ------------------------------------------------------------------
    console.log('\n--- [SUITE 3] Thử nghiệm tải đồng thời (Concurrency), Tính duy nhất & Audit Log ---')

    // 1. Rapid parallel creation of 20 campaigns with auto-generated codes
    const parallelCount = 20
    const createPromises = Array.from({ length: parallelCount }, (_, i) =>
      createCampaign({
        name: `Chiến dịch đồng thời #${i + 1}`,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-10T00:00:00Z',
      })
    )

    const createdCampaigns = await Promise.all(createPromises)
    assert(createdCampaigns.length === parallelCount, `Concurrency: successfully created ${parallelCount} campaigns in parallel`)
    for (const c of createdCampaigns) {
      testCampaignIdsToClean.push(c.id)
    }

    const uniqueCodes = new Set(createdCampaigns.map((c) => c.code))
    assert(uniqueCodes.size === parallelCount, `Code uniqueness: All ${parallelCount} auto-generated codes are distinct`)

    // Verify all 20 have CREATE AuditLog records
    const auditLogsForCreated = await prisma.auditLog.findMany({
      where: {
        entityType: 'Campaign',
        entityId: { in: createdCampaigns.map((c) => c.id) },
        action: 'CREATE',
      },
    })
    assert(auditLogsForCreated.length === parallelCount, `Audit Log: Found exactly ${parallelCount} CREATE audit logs for parallel batch`)

    // 2. Race condition test: 10 parallel requests attempting to create the SAME code
    const collisionCode = 'CP-ADV-COLLISION-01'
    const collisionAttempts = Array.from({ length: 10 }, (_, i) =>
      createCampaign({
        code: collisionCode,
        name: `Collision Candidate #${i + 1}`,
        startDate: '2026-11-01T00:00:00Z',
        endDate: '2026-11-10T00:00:00Z',
      })
        .then((res) => ({ success: true, id: res.id, err: null }))
        .catch((err) => ({ success: false, id: null, err: (err as Error).message }))
    )

    const collisionResults = await Promise.all(collisionAttempts)
    const successCount = collisionResults.filter((r) => r.success).length
    const failCount = collisionResults.filter((r) => !r.success).length

    assert(successCount === 1, `Collision defense: Exactly 1 creation succeeded out of 10 concurrent requests (got ${successCount})`)
    assert(failCount === 9, `Collision defense: Exactly 9 creations failed with code conflict (got ${failCount})`)

    const winner = collisionResults.find((r) => r.success)
    if (winner?.id) {
      testCampaignIdsToClean.push(winner.id)
    }

    // 3. Rapid sequential updates to the same campaign
    const targetCamp = createdCampaigns[0]
    for (let u = 1; u <= 5; u++) {
      await updateCampaign(targetCamp.id, {
        name: `Tên cập nhật vòng ${u}`,
        discountPercent: u * 5,
      })
    }

    const updatedCamp = await getCampaign(targetCamp.id)
    assert(updatedCamp?.name === 'Tên cập nhật vòng 5', 'Rapid updates: final campaign name matches 5th update')
    assert(updatedCamp?.discountPercent === 25, 'Rapid updates: final discountPercent is 25%')

    const auditLogsForTarget = await prisma.auditLog.findMany({
      where: {
        entityType: 'Campaign',
        entityId: targetCamp.id,
      },
    })
    // 1 CREATE + 5 UPDATEs = 6 logs
    assert(auditLogsForTarget.length === 6, `Audit Log completeness: target campaign has 1 CREATE + 5 UPDATE = 6 audit records (found ${auditLogsForTarget.length})`)

    // ------------------------------------------------------------------
    // SUITE 4: ADVERSARIAL PRICING, OVERRIDES & INPUT RESILIENCE
    // ------------------------------------------------------------------
    console.log('\n--- [SUITE 4] Thử nghiệm tính giá đối kháng & tính bền vững dữ liệu đầu vào ---')

    // Find sample product
    const sampleProd = await prisma.product.findFirst({ where: { sellPrice: { gt: 0 } } })
    assert(!!sampleProd, 'Found sample product with sellPrice > 0')

    // Adversarial pricing 1: discountPercent > 100% (e.g. 150%)
    const clampedCamp1 = await createCampaign({
      code: 'CP-ADV-CLAMP-150',
      name: 'Chiến dịch giảm 150%',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      discountPercent: 150,
      appliedProductIds: [sampleProd!.id],
    })
    testCampaignIdsToClean.push(clampedCamp1.id)

    const prodResult1 = clampedCamp1.products[0]
    assert(prodResult1.price === 0, 'Pricing clamp: 150% discount clamps price to 0 (cannot be negative)')
    assert(prodResult1.discountAmount === sampleProd!.sellPrice, 'Pricing clamp: discountAmount cannot exceed originalPrice')

    // Adversarial pricing 2: negative specialPrice (e.g. -50000₫)
    const clampedCamp2 = await createCampaign({
      code: 'CP-ADV-CLAMP-NEG',
      name: 'Chiến dịch override âm',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      appliedProductIds: [sampleProd!.id],
      productOverrides: {
        [sampleProd!.id]: { specialPrice: -50000 },
      },
    })
    testCampaignIdsToClean.push(clampedCamp2.id)

    const prodResult2 = clampedCamp2.products[0]
    assert(prodResult2.price === 0, 'Pricing clamp: negative specialPrice clamps price to 0')

    // Adversarial pricing 3: referencing non-existent product IDs and voucher IDs
    const phantomCamp = await createCampaign({
      code: 'CP-ADV-PHANTOM-01',
      name: 'Chiến dịch trỏ ID không tồn tại',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      appliedProductIds: ['phantom_prod_9999', 'ghost_prod_8888'],
      appliedVoucherIds: ['phantom_vouch_9999'],
    })
    testCampaignIdsToClean.push(phantomCamp.id)

    assert(phantomCamp.products.length === 0, 'Phantom reference: non-existent product IDs gracefully resolve to empty list')
    assert(phantomCamp.vouchers.length === 0, 'Phantom reference: non-existent voucher IDs gracefully resolve to empty list')

    // Adversarial input 4: Corrupt JSON strings in fields
    const corruptCamp = await createCampaign({
      code: 'CP-ADV-CORRUPT-01',
      name: 'Chiến dịch chuỗi JSON hỏng',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
      appliedProductIds: '{invalid-json[',
      appliedVoucherIds: 'not-valid-json',
      productOverrides: '{bad:json:syntax}',
      tags: '["unclosed-json',
    })
    testCampaignIdsToClean.push(corruptCamp.id)

    assert(corruptCamp.appliedProductIds.length === 0, 'Corrupt JSON: appliedProductIds safely falls back to []')
    assert(corruptCamp.appliedVoucherIds.length === 0, 'Corrupt JSON: appliedVoucherIds safely falls back to []')
    assert(Object.keys(corruptCamp.productOverrides || {}).length === 0, 'Corrupt JSON: productOverrides safely falls back to {}')
    assert(corruptCamp.tags?.length === 0, 'Corrupt JSON: tags safely falls back to []')

    // Adversarial filtering 5: SQL injection & regex search in listCampaigns
    const sqliSearch = "'; DROP TABLE Campaign; --"
    const sqliResult = await listCampaigns({ search: sqliSearch })
    assert(Array.isArray(sqliResult.campaigns), 'Search robustness: SQL injection payload safely parameterized')

    const regexSearch = ".*+?^${}()|[]\\"
    const regexResult = await listCampaigns({ search: regexSearch })
    assert(Array.isArray(regexResult.campaigns), 'Search robustness: regex special chars handled gracefully')

    // Adversarial pagination 6: boundary page numbers
    const negPageResult = await listCampaigns({ page: -10, pageSize: 0 })
    assert(negPageResult.page === 1, 'Pagination: negative page clamped to 1')
    assert(negPageResult.pageSize >= 1, 'Pagination: 0 pageSize clamped to >= 1')

    const giantPageSizeResult = await listCampaigns({ pageSize: 5000 })
    assert(giantPageSizeResult.pageSize === 100, 'Pagination: giant pageSize clamped to maximum 100')

  } finally {
    // ------------------------------------------------------------------
    // SUITE 5: RIGOROUS CLEAN TEARDOWN & BASELINE PARITY VERIFICATION
    // ------------------------------------------------------------------
    console.log('\n--- [SUITE 5] Dọn dẹp dữ liệu kiểm thử đối kháng & Đối soát an toàn tuyệt đối ---')

    // Delete all test campaigns created
    const deletedCampaigns = await prisma.campaign.deleteMany({
      where: {
        OR: [
          { id: { in: testCampaignIdsToClean } },
          { code: { startsWith: 'CP-ADV-' } },
          { code: { startsWith: 'TEST-' } },
        ],
      },
    })
    console.log(`🧹 Đã dọn dẹp ${deletedCampaigns.count} bản ghi Campaign thử nghiệm đối kháng`)

    // Delete all AuditLogs created for these campaigns
    const deletedAudit = await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Campaign',
      },
    })
    console.log(`🧹 Đã dọn dẹp ${deletedAudit.count} bản ghi AuditLog phát sinh từ thử nghiệm`)

    // Flush SQLite WAL checkpoint
    const rawCheckpoint = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>(
      'PRAGMA wal_checkpoint(FULL);'
    )
    const busy = Number(rawCheckpoint[0]?.busy ?? BigInt(0))
    assert(busy === 0, 'WAL Checkpoint: FULL checkpoint completed with busy=0')

    // Verify 0 residual campaigns
    const residualCount = await prisma.campaign.count()
    assert(residualCount === 0, `Residual check: 0 residual rows in Campaign table (got ${residualCount})`)

    // Run baseline check on all 24 core business tables
    const baselinePath = path.resolve('db/baseline-counts.json')
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    const coreTables = [
      'Product', 'Category', 'Order', 'OrderItem', 'Customer',
      'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
      'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
      'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
      'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
    ]

    let allBaselineMatch = true
    for (const model of coreTables) {
      const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
      const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
      const count = await delegate.count()
      if (count !== baseline[model]) {
        allBaselineMatch = false
        console.error(`❌ Baseline mismatch: ${model} actual=${count} expected=${baseline[model]}`)
      } else {
        assert(count === baseline[model], `Baseline Parity: ${model.padEnd(22)} actual=${count} baseline=${baseline[model]}`)
      }
    }
    assert(allBaselineMatch, 'Final Parity: 100% of 24 core business tables match baseline perfectly (Delta = 0)')
  }

  console.log('\n======================================================================')
  console.log(`🏆 ADVERSARIAL STRESS TEST THÀNH CÔNG RỰC RỠ! ${passedTests} PASSED, ${failedTests} FAILED 🏆`)
  console.log('======================================================================')
}

main()
  .catch((err) => {
    console.error('Fatal adversarial stress test failure:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
