// .agents/teamwork/auditor_m1/adversarial-stress-test.ts
// Adversarial Integrity & Edge Case Stress Test by Forensic Auditor

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
} from '../../../src/lib/campaign-service'
import { NextRequest } from 'next/server'
import { GET as apiGetCampaigns, POST as apiPostCampaign } from '../../../src/app/api/campaigns/route'
import {
  GET as apiGetCampaignDetail,
  PUT as apiPutCampaignDetail,
  DELETE as apiDeleteCampaignDetail,
} from '../../../src/app/api/campaigns/[id]/route'

const prisma = new PrismaClient()

let passed = 0
let failed = 0

function verify(condition: boolean, name: string) {
  if (condition) {
    console.log(`🛡️ [PASS] ${name}`)
    passed++
  } else {
    console.error(`💥 [FAIL] ${name}`)
    failed++
    throw new Error(`Adversarial test failure: ${name}`)
  }
}

async function runAdversarialAudit() {
  console.log('=== [ADVERSARIAL STRESS TEST] START ===\n')

  // --- 1. Extreme Date & Leap Year Boundaries ---
  console.log('1. Testing extreme dates and epoch boundaries...')
  const epochStart = new Date(0) // 1970-01-01
  const epochEnd = new Date(1000)
  verify(computeCampaignStatus({ startDate: epochStart, endDate: epochEnd }, new Date(500)) === 'RUNNING', 'Epoch timestamp range computes RUNNING')
  verify(computeCampaignStatus({ startDate: epochStart, endDate: epochEnd }, new Date(2000)) === 'ENDED', 'Epoch timestamp post-end computes ENDED')

  // Distant future: year 2099
  const futStart = new Date('2099-01-01T00:00:00Z')
  const futEnd = new Date('2099-12-31T23:59:59Z')
  verify(computeCampaignStatus({ startDate: futStart, endDate: futEnd }, new Date()) === 'UPCOMING', 'Year 2099 is UPCOMING')

  // --- 2. SQL Injection / Malformed ID Resilience ---
  console.log('\n2. Testing SQL injection and malicious payload resistance...')
  const maliciousInput = {
    code: 'CP-INJECT-TEST-01',
    name: "Tết An Lạc '; DROP TABLE Campaign; --",
    startDate: '2026-12-01T00:00:00Z',
    endDate: '2026-12-15T00:00:00Z',
    appliedProductIds: ["' OR '1'='1", '"><script>alert(1)</script>'],
    appliedVoucherIds: ["' UNION SELECT * FROM Voucher --"],
    productOverrides: {
      "non-existent-product-id": { specialPrice: -50000, discountPercent: 999 },
    },
    tags: ['<svg onload=alert(1)>', "'; DELETE FROM Product; --"],
  }

  const createdMalicious = await createCampaign(maliciousInput)
  verify(createdMalicious.name === "Tết An Lạc '; DROP TABLE Campaign; --", 'Campaign name preserved literally without SQL injection execution')
  verify(createdMalicious.products.length === 0, 'Non-existent / injection product IDs safely ignored without throwing or leaking')
  verify(createdMalicious.vouchers.length === 0, 'Non-existent / injection voucher IDs safely ignored')

  // Verify database tables still intact
  const campaignCount = await prisma.campaign.count()
  verify(campaignCount > 0, 'Campaign table was NOT dropped')
  const productCount = await prisma.product.count()
  verify(productCount === 12, 'Product table remained untouched at 12 rows')

  // Clean up malicious campaign
  await deleteCampaign(createdMalicious.id)

  // --- 3. Extreme Pricing & Discount Calculations ---
  console.log('\n3. Testing pricing calculations under extreme conditions...')
  // Get real product
  const realProd = await prisma.product.findFirst()
  if (!realProd) throw new Error('No product found')

  // Campaign with discountPercent = 150% (should cap at 100% discount, price = 0)
  const overDiscountCamp = await createCampaign({
    code: 'CP-OVERDISCOUNT-01',
    name: 'Xả hàng 150%',
    startDate: '2026-12-01T00:00:00Z',
    endDate: '2026-12-15T00:00:00Z',
    discountPercent: 150,
    appliedProductIds: [realProd.id],
  })

  const prodResult = overDiscountCamp.products[0]
  verify(prodResult.campaignPrice === 0, 'Over 100% discount clamps price to 0 (no negative prices)')
  verify(prodResult.price === 0, 'Contract price is 0')
  await deleteCampaign(overDiscountCamp.id)

  // Campaign with discountAmount > product price (should floor at 0)
  const overAmountCamp = await createCampaign({
    code: 'CP-OVERAMOUNT-01',
    name: 'Giảm 10 triệu đồng',
    startDate: '2026-12-01T00:00:00Z',
    endDate: '2026-12-15T00:00:00Z',
    discountAmount: 10000000, // 10 million > 129k
    appliedProductIds: [realProd.id],
  })

  const prodResult2 = overAmountCamp.products[0]
  verify(prodResult2.campaignPrice === 0, 'Discount amount exceeding price clamps to 0')
  await deleteCampaign(overAmountCamp.id)

  // --- 4. Route Handler Stress Testing (HTTP API level) ---
  console.log('\n4. Testing Route Handlers directly via simulated NextRequest...')

  // POST /api/campaigns with invalid JSON / empty
  const reqEmpty = new NextRequest('http://localhost:3010/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  const resEmpty = await apiPostCampaign(reqEmpty)
  verify(resEmpty.status === 400, 'POST /api/campaigns with empty payload returns HTTP 400')

  // POST /api/campaigns with endDate <= startDate
  const reqBadDates = new NextRequest('http://localhost:3010/api/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Test Bad Dates',
      startDate: '2026-11-20T00:00:00Z',
      endDate: '2026-11-10T00:00:00Z',
    }),
  })
  const resBadDates = await apiPostCampaign(reqBadDates)
  verify(resBadDates.status === 400, 'POST /api/campaigns with endDate < startDate returns HTTP 400')

  // GET /api/campaigns/[id] with non-existent ID
  const reqNonExistent = new NextRequest('http://localhost:3010/api/campaigns/non-existent-id')
  const resNonExistent = await apiGetCampaignDetail(reqNonExistent, {
    params: Promise.resolve({ id: 'non-existent-id-cuid-999' }),
  })
  verify(resNonExistent.status === 404, 'GET /api/campaigns/[id] for missing ID returns HTTP 404')

  // PUT /api/campaigns/[id] with invalid dates
  const dummyCamp = await createCampaign({
    code: 'CP-API-TEST-01',
    name: 'API Route Test',
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-10T00:00:00Z',
  })

  const reqPutBad = new NextRequest(`http://localhost:3010/api/campaigns/${dummyCamp.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      startDate: '2026-11-20T00:00:00Z',
      endDate: '2026-11-15T00:00:00Z',
    }),
  })
  const resPutBad = await apiPutCampaignDetail(reqPutBad, {
    params: Promise.resolve({ id: dummyCamp.id }),
  })
  verify(resPutBad.status === 400, 'PUT /api/campaigns/[id] with bad dates returns HTTP 400')

  // DELETE /api/campaigns/[id] via API
  const reqDel = new NextRequest(`http://localhost:3010/api/campaigns/${dummyCamp.id}`, {
    method: 'DELETE',
  })
  const resDel = await apiDeleteCampaignDetail(reqDel, {
    params: Promise.resolve({ id: dummyCamp.id }),
  })
  verify(resDel.status === 200, 'DELETE /api/campaigns/[id] returns HTTP 200')

  // DELETE non-existent returns 404
  const resDel404 = await apiDeleteCampaignDetail(reqDel, {
    params: Promise.resolve({ id: dummyCamp.id }),
  })
  verify(resDel404.status === 404, 'DELETE already-deleted campaign returns HTTP 404')

  // --- 5. Clean Teardown & Baseline Re-check ---
  console.log('\n5. Teardown and Final Baseline Check...')
  await prisma.auditLog.deleteMany({ where: { entityType: 'Campaign' } })
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')

  console.log(`\n🎉 ALL ${passed} ADVERSARIAL AUDIT ASSERTIONS PASSED (FAILED: ${failed})!`)
}

runAdversarialAudit()
  .catch((err) => {
    console.error('Fatal adversarial test error:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
