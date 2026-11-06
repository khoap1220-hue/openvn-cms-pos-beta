// scripts/verify-challenger-2-m1.ts
// Empirical Adversarial Challenge Suite 2 for Milestone 1 (M1: CRM Campaigns & DB Safety)
// Focus: DB Safety, Physical Backup Integrity, Pricing Calculation Extreme Inputs, Voucher Boundary Invariants, and Zero Baseline Regression.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import {
  createCampaign,
  getCampaign,
  deleteCampaign,
  enrichCampaignData,
  computeCampaignStatus,
} from '../src/lib/campaign-service'
import { calculateVoucherDiscount } from '../src/lib/warehouse-service'

const prisma = new PrismaClient()

interface TestSummary {
  passed: number
  failed: number
  tests: Array<{ name: string; status: 'PASS' | 'FAIL'; error?: string }>
}

const summary: TestSummary = {
  passed: 0,
  failed: 0,
  tests: [],
}

function expect(condition: boolean, testName: string, errorDetail?: string) {
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`)
    summary.passed++
    summary.tests.push({ name: testName, status: 'PASS' })
  } else {
    console.error(`  ❌ [FAIL] ${testName}${errorDetail ? ` -> ${errorDetail}` : ''}`)
    summary.failed++
    summary.tests.push({ name: testName, status: 'FAIL', error: errorDetail })
    throw new Error(`Challenge failure: ${testName} (${errorDetail || 'Condition not met'})`)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('🔥 EMPIRICAL CHALLENGER 2 — MILESTONE 1 ADVERSARIAL STRESS SUITE 🔥')
  console.log('================================================================================\n')

  const createdCampaignIds: string[] = []
  const coreTables: string[] = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
  ]

  try {
    // ==========================================================================
    // SUITE 1: PHYSICAL BACKUP INTEGRITY & SQLITE DEEP VERIFICATION
    // ==========================================================================
    console.log('▶ [SUITE 1] Physical Backup Integrity & SQLite Deep Inspection')
    const bakPath = path.resolve('db/custom.db.bak.pre-autosocial')
    const liveDbPath = path.resolve('db/custom.db')

    // 1.1 Tệp sao lưu tồn tại và dung lượng chuẩn
    expect(fs.existsSync(bakPath), '1.1 Backup file exists at db/custom.db.bak.pre-autosocial')
    const bakStat = fs.statSync(bakPath)
    expect(bakStat.size === 4890624, `1.2 Backup file size is exactly 4,890,624 bytes (actual: ${bakStat.size})`)

    // 1.2 SQLite Magic Header (16 bytes)
    const fd = fs.openSync(bakPath, 'r')
    const headerBuf = Buffer.alloc(16)
    fs.readSync(fd, headerBuf, 0, 16, 0)
    fs.closeSync(fd)
    const headerStr = headerBuf.toString('utf8', 0, 15)
    expect(headerStr === 'SQLite format 3', `1.3 Backup SQLite format 3 header match (got: "${headerStr}")`)

    // 1.3 SHA-256 Cryptographic Match
    const expectedSha256 = 'b58dea1e7fbae0856f6d1409478f45b721b151ea002200df3589d2304f9569d1'
    const actualSha256 = crypto.createHash('sha256').update(fs.readFileSync(bakPath)).digest('hex')
    expect(actualSha256 === expectedSha256, `1.4 Backup SHA-256 checksum matches recorded pre-autosocial hash: ${actualSha256}`)

    // 1.4 Direct SQLite Connection to Backup
    const bakPrismaUrl = 'file:' + bakPath.replace(/\\/g, '/')
    const bakPrisma = new PrismaClient({
      datasources: {
        db: { url: bakPrismaUrl },
      },
    })

    try {
      // 1.5 SQLite PRAGMA integrity_check
      const integrityCheck = await bakPrisma.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check;')
      const integrityResult = integrityCheck[0]?.integrity_check
      expect(integrityResult === 'ok', `1.5 Backup PRAGMA integrity_check === 'ok' (got: ${integrityResult})`)

      // 1.6 SQLite PRAGMA quick_check
      const quickCheck = await bakPrisma.$queryRawUnsafe<Array<{ quick_check: string }>>('PRAGMA quick_check;')
      const quickResult = quickCheck[0]?.quick_check
      expect(quickResult === 'ok', `1.6 Backup PRAGMA quick_check === 'ok' (got: ${quickResult})`)

      // 1.7 Verify tables in backup: Must have all baseline tables, must NOT have new autosocial tables
      const bakTables = await bakPrisma.$queryRawUnsafe<Array<{ name: string }>>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';"
      )
      const bakTableNames = new Set(bakTables.map((t) => t.name))
      expect(bakTableNames.has('Product'), '1.7a Backup contains baseline Product table')
      expect(bakTableNames.has('Order'), '1.7b Backup contains baseline Order table')
      expect(bakTableNames.has('Voucher'), '1.7c Backup contains baseline Voucher table')
      expect(!bakTableNames.has('Campaign'), '1.7d Backup does NOT contain Campaign (proves pre-autosocial snapshot)')
      expect(!bakTableNames.has('ContentSource'), '1.7e Backup does NOT contain ContentSource (pure frozen state)')

    // 1.8 Verify all 24 baseline tables in backup match db/baseline-counts.json
    const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))


      for (const table of coreTables) {
        const delegateName = table.charAt(0).toLowerCase() + table.slice(1)
        const delegate = (bakPrisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
        if (delegate && typeof delegate.count === 'function') {
          const count = await delegate.count()
          expect(count === baseline[table], `1.8 Backup table ${table} exact count match: ${count} == ${baseline[table]}`)
        }
      }
    } finally {
      await bakPrisma.$disconnect()
    }

    // 1.9 Compare live db: must contain Campaign, ContentSource, etc.
    const liveTables = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';"
    )
    const liveTableNames = new Set(liveTables.map((t) => t.name))
    const expectedNewTables = ['Campaign', 'ContentSource', 'ContentSourceItem', 'SocialPlan', 'SocialPost', 'SocialChannelConfig', 'AuditLog']
    for (const newTable of expectedNewTables) {
      expect(liveTableNames.has(newTable), `1.9 Live DB contains additive model: ${newTable}`)
    }

    // ==========================================================================
    // SUITE 2: PRICING CALCULATIONS & EXTREME INPUT INVARIANTS
    // ==========================================================================
    console.log('\n▶ [SUITE 2] Pricing Calculations with Extreme Inputs & Invariants')

    // Find baseline products to test with
    const pNen = await prisma.product.findUnique({ where: { sku: 'UD-NEN-001' } }) // sellPrice: 129,000₫
    const pTra = await prisma.product.findUnique({ where: { sku: 'UD-TRA-001' } }) // sellPrice: 350,000₫
    expect(!!pNen && !!pTra, '2.0 Found sample baseline products UD-NEN-001 (129k) and UD-TRA-001 (350k)')
    const nenPrice = pNen!.sellPrice // 129,000
    const traPrice = pTra!.sellPrice // 350,000

    // 2.1 EXTREME INPUT: 0% Discount
    console.log('  --- Case 2.1: 0% Discount (No price alteration) ---')
    const camp0Pct = await createCampaign({
      code: 'TEST-CHALLENGE-0PCT',
      name: 'Adversarial 0% Discount Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      discountPercent: 0,
      appliedProductIds: [pNen!.id],
      productOverrides: {
        [pNen!.id]: { discountPercent: 0 },
      },
    })
    createdCampaignIds.push(camp0Pct.id)

    const prod0Pct = camp0Pct.products.find((p) => p.id === pNen!.id)
    expect(prod0Pct?.campaignPrice === nenPrice, `2.1a 0% discount preserves original price: ${prod0Pct?.campaignPrice} === ${nenPrice}`)
    expect(prod0Pct?.price === nenPrice, `2.1b 0% discount alias price === original price: ${prod0Pct?.price}`)
    expect(prod0Pct?.discountAmount === undefined, `2.1c 0% discount results in undefined/zero discountAmount`)
    expect(prod0Pct?.discountPercent === undefined, `2.1d 0% discount results in undefined discountPercent`)

    // 2.2 EXTREME INPUT: 100% Discount (100% Free Campaign)
    console.log('  --- Case 2.2: 100% Discount (Zero Price) ---')
    const camp100Pct = await createCampaign({
      code: 'TEST-CHALLENGE-100PCT',
      name: 'Adversarial 100% Discount Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      discountPercent: 100,
      appliedProductIds: [pNen!.id, pTra!.id],
      productOverrides: {
        [pTra!.id]: { discountPercent: 100 },
      },
    })
    createdCampaignIds.push(camp100Pct.id)

    const prod100PctNen = camp100Pct.products.find((p) => p.id === pNen!.id)
    expect(prod100PctNen?.campaignPrice === 0, `2.2a Campaign 100% discount produces 0 campaignPrice`)
    expect(prod100PctNen?.price === 0, `2.2b Campaign 100% discount alias price === 0`)
    expect(prod100PctNen?.discountAmount === nenPrice, `2.2c Campaign 100% discountAmount equals originalPrice (${nenPrice}₫)`)
    expect(prod100PctNen?.discountPercent === 100, `2.2d Campaign 100% discountPercent === 100`)

    const prod100PctTra = camp100Pct.products.find((p) => p.id === pTra!.id)
    expect(prod100PctTra?.campaignPrice === 0, `2.2e Override 100% discount produces 0 campaignPrice`)
    expect(prod100PctTra?.discountAmount === traPrice, `2.2f Override 100% discountAmount equals originalPrice (${traPrice}₫)`)
    expect(prod100PctTra?.discountPercent === 100, `2.2g Override 100% discountPercent === 100`)

    // 2.3 EXTREME INPUT: specialPrice = 0 (Free Gift Promotion)
    console.log('  --- Case 2.3: specialPrice = 0 (Free Item Promotion) ---')
    const campSpecialZero = await createCampaign({
      code: 'TEST-CHALLENGE-SPECIAL-0',
      name: 'Adversarial specialPrice = 0 Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      appliedProductIds: [pNen!.id],
      productOverrides: {
        [pNen!.id]: { specialPrice: 0 },
      },
    })
    createdCampaignIds.push(campSpecialZero.id)

    const prodSpecialZero = campSpecialZero.products.find((p) => p.id === pNen!.id)
    expect(prodSpecialZero?.campaignPrice === 0, `2.3a specialPrice = 0 produces campaignPrice = 0`)
    expect(prodSpecialZero?.price === 0, `2.3b specialPrice = 0 contract alias price = 0`)
    expect(prodSpecialZero?.discountAmount === nenPrice, `2.3c specialPrice = 0 discountAmount === ${nenPrice}₫`)
    expect(prodSpecialZero?.discountPercent === 100, `2.3d specialPrice = 0 discountPercent === 100%`)

    // 2.4 ADVERSARIAL INPUT: Negative specialPrice (should be clamped to 0, never negative)
    console.log('  --- Case 2.4: Adversarial specialPrice < 0 ---')
    const campSpecialNeg = await createCampaign({
      code: 'TEST-CHALLENGE-SPECIAL-NEG',
      name: 'Adversarial specialPrice < 0 Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      appliedProductIds: [pNen!.id],
      productOverrides: {
        [pNen!.id]: { specialPrice: -50000 },
      },
    })
    createdCampaignIds.push(campSpecialNeg.id)

    const prodSpecialNeg = campSpecialNeg.products.find((p) => p.id === pNen!.id)
    expect(prodSpecialNeg?.campaignPrice === 0, `2.4a Negative specialPrice (-50k) is clamped to 0: ${prodSpecialNeg?.campaignPrice}`)
    expect(prodSpecialNeg?.price === 0, `2.4b Negative specialPrice alias price clamped to 0`)
    expect(prodSpecialNeg?.discountAmount === nenPrice, `2.4c Negative specialPrice discountAmount clamped to original price`)

    // 2.5 ADVERSARIAL INPUT: Discount Amount > Original Sell Price (e.g. 500k discount on 129k item)
    console.log('  --- Case 2.5: discountAmount > originalSellPrice ---')
    const campHugeDiscount = await createCampaign({
      code: 'TEST-CHALLENGE-HUGE-DISC',
      name: 'Adversarial Huge discountAmount Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      discountAmount: 500000, // 500k discount on 129k item
      appliedProductIds: [pNen!.id],
    })
    createdCampaignIds.push(campHugeDiscount.id)

    const prodHuge = campHugeDiscount.products.find((p) => p.id === pNen!.id)
    expect(prodHuge?.campaignPrice === 0, `2.5a Huge discountAmount (500k > 129k) clamps campaignPrice to 0: ${prodHuge?.campaignPrice}`)
    expect(prodHuge?.discountAmount === nenPrice, `2.5b discountAmount capped at originalPrice: ${prodHuge?.discountAmount}`)
    expect(prodHuge?.discountPercent === 100, `2.5c discountPercent reaches 100%`)

    // 2.6 ADVERSARIAL INPUT: Discount Percent > 100% (e.g. 150%) and < 0% (e.g. -25%)
    console.log('  --- Case 2.6: discountPercent > 100% and < 0% ---')
    const campOutOfBounds = await createCampaign({
      code: 'TEST-CHALLENGE-OOB-PCT',
      name: 'Adversarial Out of Bounds discountPercent',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      appliedProductIds: [pNen!.id, pTra!.id],
      productOverrides: {
        [pNen!.id]: { discountPercent: 150 }, // > 100%
        [pTra!.id]: { discountPercent: -25 }, // < 0%
      },
    })
    createdCampaignIds.push(campOutOfBounds.id)

    const prod150 = campOutOfBounds.products.find((p) => p.id === pNen!.id)
    expect(prod150?.campaignPrice === 0, `2.6a discountPercent 150% is clamped to 100%, price = 0`)
    expect(prod150?.discountPercent === 100, `2.6b discountPercent is capped at 100`)

    const prodNeg25 = campOutOfBounds.products.find((p) => p.id === pTra!.id)
    expect(prodNeg25?.campaignPrice === traPrice, `2.6c discountPercent -25% is clamped to 0%, price unchanged (${traPrice}₫)`)

    // 2.7 OVERRIDE PRECEDENCE HIERARCHY
    console.log('  --- Case 2.7: Override Precedence Hierarchy ---')
    // Test: specialPrice should beat discountPercent override, which beats campaign discountPercent, which beats discountAmount
    const campPrecedence = await createCampaign({
      code: 'TEST-CHALLENGE-PRECEDENCE',
      name: 'Adversarial Precedence Test',
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000),
      discountPercent: 10,
      discountAmount: 20000,
      appliedProductIds: [pNen!.id, pTra!.id],
      productOverrides: {
        [pNen!.id]: { specialPrice: 77000, discountPercent: 50 }, // specialPrice should win over 50%
        [pTra!.id]: { discountPercent: 30 },                     // override 30% should win over campaign 10%
      },
    })
    createdCampaignIds.push(campPrecedence.id)

    const prodPrec1 = campPrecedence.products.find((p) => p.id === pNen!.id)
    expect(prodPrec1?.campaignPrice === 77000, `2.7a specialPrice (77k) takes precedence over discountPercent override (50%): ${prodPrec1?.campaignPrice}`)

    const prodPrec2 = campPrecedence.products.find((p) => p.id === pTra!.id)
    // 350,000 * (1 - 0.3) = 245,000
    expect(prodPrec2?.campaignPrice === 245000, `2.7b override discountPercent (30%) takes precedence over campaign discountPercent (10%): ${prodPrec2?.campaignPrice}`)

    // ==========================================================================
    // SUITE 3: VOUCHER MINIMUM ORDER VALUE BOUNDARY CONDITIONS
    // ==========================================================================
    console.log('\n▶ [SUITE 3] Voucher Minimum Order Value Boundary Stress Testing')

    const vUudam = await prisma.voucher.findUnique({ where: { code: 'UUDAM10' } }) // PERCENT 10%, max 50k, min 150k
    const vPhatdan = await prisma.voucher.findUnique({ where: { code: 'PHATDAN50K' } }) // FIXED 50k, min 400k
    expect(!!vUudam && !!vPhatdan, '3.0 Found baseline vouchers UUDAM10 and PHATDAN50K')

    // 3.1 EXACT BOUNDARY: minOrderAmount - 1 vs minOrderAmount vs minOrderAmount + 1
    const min1 = vUudam!.minOrderAmount // 150,000
    console.log(`  --- Testing UUDAM10 minOrderAmount boundary: ${min1.toLocaleString('vi-VN')}₫ ---`)

    // Boundary: minOrderAmount - 1 (149,999₫) -> REJECTED
    const resUnder1 = calculateVoucherDiscount(vUudam!, min1 - 1, 30000)
    expect(!resUnder1.valid, `3.1a subtotal = minOrderAmount - 1 (149,999₫) is INVALID: valid=${resUnder1.valid}`)
    expect(resUnder1.discountAmount === 0, `3.1b subtotal = minOrderAmount - 1 yields 0 discountAmount`)
    expect(Boolean(resUnder1.reason?.includes('Đơn tối thiểu')), `3.1c rejection reason explains minimum requirement: "${resUnder1.reason}"`)

    // Boundary: minOrderAmount (150,000₫) -> ACCEPTED
    const resExact1 = calculateVoucherDiscount(vUudam!, min1, 30000)
    expect(resExact1.valid, `3.1d subtotal = minOrderAmount exactly (150,000₫) is VALID`)
    expect(resExact1.discountAmount === 15000, `3.1e subtotal 150,000₫ gives 10% = 15,000₫ discount (got: ${resExact1.discountAmount})`)

    // Boundary: minOrderAmount + 1 (150,001₫) -> ACCEPTED
    const resOver1 = calculateVoucherDiscount(vUudam!, min1 + 1, 30000)
    expect(resOver1.valid, `3.1f subtotal = minOrderAmount + 1 (150,001₫) is VALID`)
    expect(resOver1.discountAmount === 15000, `3.1g subtotal 150,001₫ gives 10% = 15,000₫ (rounded)`)

    // 3.2 FIXED VOUCHER BOUNDARY: PHATDAN50K minOrderAmount = 400,000₫
    const min2 = vPhatdan!.minOrderAmount // 400,000
    console.log(`  --- Testing PHATDAN50K minOrderAmount boundary: ${min2.toLocaleString('vi-VN')}₫ ---`)

    const resUnder2 = calculateVoucherDiscount(vPhatdan!, min2 - 1, 30000)
    expect(!resUnder2.valid && resUnder2.discountAmount === 0, `3.2a subtotal = 399,999₫ is INVALID for 400k voucher`)

    const resExact2 = calculateVoucherDiscount(vPhatdan!, min2, 30000)
    expect(resExact2.valid && resExact2.discountAmount === 50000, `3.2b subtotal = 400,000₫ gives exactly 50,000₫ discount`)

    // 3.3 PERCENT VOUCHER MAX DISCOUNT BOUNDARY
    console.log('  --- Case 3.3: PERCENT maxDiscount ceiling boundary ---')
    // UUDAM10: 10%, maxDiscount = 50,000₫
    // Threshold is 50,000 / 0.10 = 500,000₫
    const resCapBelow = calculateVoucherDiscount(vUudam!, 499990, 30000) // 10% = 49,999₫
    expect(resCapBelow.discountAmount === 49999, `3.3a subtotal = 499,990₫ gives 49,999₫ (< 50,000 ceiling)`)

    const resCapExact = calculateVoucherDiscount(vUudam!, 500000, 30000) // 10% = 50,000₫
    expect(resCapExact.discountAmount === 50000, `3.3b subtotal = 500,000₫ hits exact 50,000 ceiling`)

    const resCapAbove = calculateVoucherDiscount(vUudam!, 500010, 30000) // 10% = 50,001₫ -> capped at 50,000₫
    expect(resCapAbove.discountAmount === 50000, `3.3c subtotal = 500,010₫ is capped at 50,000 ceiling`)

    const resCapHuge = calculateVoucherDiscount(vUudam!, 10000000, 30000) // 10M -> capped at 50,000₫
    expect(resCapHuge.discountAmount === 50000, `3.3d subtotal = 10,000,000₫ strictly capped at 50,000 ceiling`)

    // 3.4 ADVERSARIAL VOUCHER: FIXED voucher discount exceeding subtotal
    console.log('  --- Case 3.4: FIXED voucher exceeding subtotal ---')
    const mockFixedVoucher = {
      discountType: 'FIXED',
      discountValue: 100000, // 100k
      minOrderAmount: 50000,  // min 50k
      usedCount: 0,
      active: true,
    }
    // Subtotal 70k: discount cannot be 100k (cannot create negative total), must cap at 70k!
    const resExceed = calculateVoucherDiscount(mockFixedVoucher, 70000, 0)
    expect(resExceed.valid, `3.4a Voucher valid at subtotal 70k >= 50k`)
    expect(resExceed.discountAmount === 70000, `3.4b Discount amount capped at subtotal 70,000₫ (not 100,000₫) to prevent negative order totals: ${resExceed.discountAmount}`)

    // 3.5 ADVERSARIAL VOUCHER: Inactive, Expired, and Usage Limit Reached
    console.log('  --- Case 3.5: Voucher state invariants ---')
    const inactiveVoucher = { ...vUudam!, active: false }
    const resInactive = calculateVoucherDiscount(inactiveVoucher, 200000, 0)
    expect(!resInactive.valid && Boolean(resInactive.reason?.includes('tạm ngưng')), `3.5a Inactive voucher rejected`)

    const expiredVoucher = { ...vUudam!, expiresAt: new Date(Date.now() - 60000) }
    const resExpired = calculateVoucherDiscount(expiredVoucher, 200000, 0)
    expect(!resExpired.valid && Boolean(resExpired.reason?.includes('hết hạn')), `3.5b Expired voucher rejected`)

    const limitReachedVoucher = { ...vUudam!, usageLimit: 5, usedCount: 5 }
    const resLimit = calculateVoucherDiscount(limitReachedVoucher, 200000, 0)
    expect(!resLimit.valid && Boolean(resLimit.reason?.includes('hết lượt')), `3.5c Usage limit reached voucher rejected`)

    // ==========================================================================
    // SUITE 4: ZERO-DRIFT BOUNDARY STATE RESILIENCE
    // ==========================================================================
    console.log('\n▶ [SUITE 4] Zero-Drift Boundary State Adversarial Scenarios')
    const start = new Date('2026-12-01T08:00:00.000Z')
    const end = new Date('2026-12-31T23:59:59.999Z')
    const sampleCamp = { startDate: start, endDate: end, status: 'UPCOMING' }

    // 1ms precision checks
    expect(computeCampaignStatus(sampleCamp, new Date(start.getTime() - 1)) === 'UPCOMING', '4.1 tStart - 1ms is UPCOMING')
    expect(computeCampaignStatus(sampleCamp, start) === 'RUNNING', '4.2 tStart exact is RUNNING')
    expect(computeCampaignStatus(sampleCamp, end) === 'RUNNING', '4.3 tEnd exact is RUNNING')
    expect(computeCampaignStatus(sampleCamp, new Date(end.getTime() + 1)) === 'ENDED', '4.4 tEnd + 1ms is ENDED')

    // Far future date (Year 2060)
    const farFutureCamp = {
      startDate: new Date('2060-01-01T00:00:00Z'),
      endDate: new Date('2060-12-31T00:00:00Z'),
    }
    expect(computeCampaignStatus(farFutureCamp, new Date('2026-10-26T00:00:00Z')) === 'UPCOMING', '4.5 Year 2060 campaign is UPCOMING in 2026')

    // Far past date (Year 2010)
    const farPastCamp = {
      startDate: new Date('2010-01-01T00:00:00Z'),
      endDate: new Date('2010-12-31T00:00:00Z'),
    }
    expect(computeCampaignStatus(farPastCamp, new Date('2026-10-26T00:00:00Z')) === 'ENDED', '4.6 Year 2010 campaign is ENDED in 2026')

    // ==========================================================================
    // SUITE 5: CLEAN TEARDOWN & REVERSION
    // ==========================================================================
    console.log('\n▶ [SUITE 5] Clean Teardown & Purge of Test Data')
    for (const cid of createdCampaignIds) {
      await deleteCampaign(cid)
    }
    console.log(`  Purged ${createdCampaignIds.length} test campaigns successfully.`)

    // Purge any lingering TEST- audit logs
    await prisma.campaign.deleteMany({
      where: {
        code: { startsWith: 'TEST-CHALLENGE-' },
      },
    })
    await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Campaign',
      },
    })
    console.log('  Cleaned all test campaigns and audit logs.')

    // WAL flush
    const walCheck = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>('PRAGMA wal_checkpoint(FULL);')
    const busy = Number(walCheck[0]?.busy ?? BigInt(0))
    expect(busy === 0, `5.1 WAL checkpoint successful after teardown (busy: ${busy})`)


    // ==========================================================================
    // SUITE 6: ZERO REGRESSION BASELINE COUNT AUDIT (DELTA = 0)
    // ==========================================================================
    console.log('\n▶ [SUITE 6] Strict 24-Table Baseline Audit vs db/baseline-counts.json')
    const baselineAudit = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
    let deltaCount = 0

    for (const table of coreTables) {
      const delegateName = table.charAt(0).toLowerCase() + table.slice(1)
      const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
      const count = await delegate.count()
      const expected = baselineAudit[table]
      const delta = count - expected
      if (delta !== 0) {
        deltaCount++
        console.error(`  ❌ REGRESSION DETECTED on ${table}: expected ${expected}, got ${count} (Delta: ${delta})`)
      } else {
        expect(delta === 0, `6.x Table ${table.padEnd(22)}: actual=${count} expected=${expected} (Delta = 0)`)
      }
    }

    expect(deltaCount === 0, `6.FINAL All 24 core business tables maintain Delta = 0 (Total regressions: ${deltaCount})`)

    console.log('\n================================================================================')
    console.log(`🏆 CHALLENGER 2 VERIFICATION COMPLETE: ${summary.passed} PASSED, ${summary.failed} FAILED 🏆`)
    console.log('================================================================================')
  } catch (err) {
    console.error('\n❌ CHALLENGER 2 STRESS TEST FAILED WITH ERROR:', err)
    process.exit(1)
  } finally {
    // Failsafe cleanup
    try {
      await prisma.campaign.deleteMany({
        where: { code: { startsWith: 'TEST-CHALLENGE-' } },
      })
      await prisma.auditLog.deleteMany({
        where: { entityType: 'Campaign' },
      })
    } catch {
      // Ignore
    }
    await prisma.$disconnect()
  }
}

main()
