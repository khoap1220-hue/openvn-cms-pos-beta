// scripts/cleanup-test-campaigns.ts
// Utility script to purge all test campaigns, social plans, posts, and audit logs
// while verifying that all 24 core baseline tables remain perfectly invariant (Delta = 0).

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('--- [CLEANUP] Bắt đầu dọn dẹp các chiến dịch thử nghiệm và dữ liệu liên quan ---')

  // 1. Tìm các chiến dịch test hoặc demo
  const testCampaigns = await prisma.campaign.findMany({
    where: {
      OR: [
        { code: { startsWith: 'CP-TEST' } },
        { code: { startsWith: 'CP-EMPTY' } },
        { code: { startsWith: 'TEST-' } },
        { name: { contains: 'Test' } },
        { name: { contains: 'Thử nghiệm' } },
      ],
    },
    select: { id: true, code: true, name: true },
  })

  console.log(`Tìm thấy ${testCampaigns.length} chiến dịch test cần dọn dẹp:`, testCampaigns.map((c) => c.code))

  const testCampaignIds = testCampaigns.map((c) => c.id)

  if (testCampaignIds.length > 0) {
    // Xóa SocialPost thuộc về các chiến dịch này
    const deletedPosts = await prisma.socialPost.deleteMany({
      where: { campaignId: { in: testCampaignIds } },
    })
    console.log(`Đã xóa ${deletedPosts.count} SocialPost liên kết`)

    // Xóa SocialPlan thuộc về các chiến dịch này
    const deletedPlans = await prisma.socialPlan.deleteMany({
      where: { campaignId: { in: testCampaignIds } },
    })
    console.log(`Đã xóa ${deletedPlans.count} SocialPlan liên kết`)

    // Xóa AuditLog liên kết
    const deletedAudit = await prisma.auditLog.deleteMany({
      where: {
        entityType: 'Campaign',
        entityId: { in: testCampaignIds },
      },
    })
    console.log(`Đã xóa ${deletedAudit.count} AuditLog liên kết`)

    // Xóa Campaign
    const deletedCampaigns = await prisma.campaign.deleteMany({
      where: { id: { in: testCampaignIds } },
    })
    console.log(`Đã xóa ${deletedCampaigns.count} Campaign test`)
  }

  // Dọn dẹp bất kỳ SocialPost hoặc SocialPlan mồ côi nếu có
  const orphanPosts = await prisma.socialPost.deleteMany({
    where: {
      AND: [
        { campaignId: null },
        { planId: null },
      ],
    },
  })
  if (orphanPosts.count > 0) {
    console.log(`Đã xóa ${orphanPosts.count} SocialPost mồ côi`)
  }

  // Ép WAL checkpoint
  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
  console.log('Đã thực hiện WAL checkpoint FULL')

  // Kiểm tra đối soát 24 bảng baseline
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
  ]

  let hasError = false
  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    if (count !== baseline[model]) {
      console.error(`❌ LỆCH BASELINE: ${model}: actual=${count} !== baseline=${baseline[model]}`)
      hasError = true
    }
  }

  if (!hasError) {
    console.log('✅ 100% 24 bảng cốt lõi khớp chuẩn xác tuyệt đối với baseline-counts.json (Delta = 0)!')
  } else {
    throw new Error('Phát hiện chênh lệch dữ liệu bảng cốt lõi sau khi dọn dẹp!')
  }
}

main()
  .catch((err) => {
    console.error('Lỗi khi chạy cleanup:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
