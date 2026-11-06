// scripts/generate-rubric-evaluation.ts
// Independent Rubric Evaluation Generator for Milestone 3 (M3: AI Planning & Copywriting)
// Reviewer: Independent Reviewer Rubric Agent

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import {
  generatePlatformDraft,
  detectBannedPhrases,
  validateCrmInvariants,
  formatVnd,
  type SocialPlatform,
  type PlatformDraft,
} from '../src/lib/social-ai'
import {
  createCampaign,
  deleteCampaign,
  type CampaignData,
} from '../src/lib/campaign-service'

const prisma = new PrismaClient()

interface GeneratedPostReviewData {
  index: number
  campaignCode: string
  campaignTitle: string
  campaignDiscount: number
  campaignVoucherCode: string
  platform: SocialPlatform
  productId: string
  productSku: string
  productName: string
  productPrice: number
  productPriceFormatted: string
  voucherCode: string
  scheduledAt: string
  draft: {
    title: string | null
    slug: string | null
    content: string
    excerpt: string | null
    hashtags: string | null
    mediaType: string
    mediaUrls: string[]
    targetUrl: string | null
    charCount: number
    wordCount: number
  }
  automatedChecks: {
    bannedPhrasesFound: string[]
    matchedPrice: boolean
    matchedDiscount: boolean
    matchedVoucher: boolean
    engineRubric: {
      crmScore: number
      voiceScore: number
      fmtScore: number
      ctaScore: number
      overallScore: number
    }
  }
}

async function verifyBaselineParity(label: string) {
  const baseline = JSON.parse(fs.readFileSync(path.resolve('db/baseline-counts.json'), 'utf8'))
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent'
  ]

  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    if (count !== baseline[model]) {
      throw new Error(`[${label}] DRIFT DETECTED on ${model}: actual=${count} != baseline=${baseline[model]}`)
    }
  }
  console.log(`✅ [Baseline Invariance] All 24 core tables matched baseline counts (${label}).`)
}

async function main() {
  console.log('--- Checking Initial Baseline Parity ---')
  await verifyBaselineParity('Pre-generation')

  const createdCampaignIds: string[] = []
  const generatedPosts: GeneratedPostReviewData[] = []

  try {
    // 1. Fetch available products and vouchers from DB
    const allProducts = await prisma.product.findMany({ where: { status: 'ACTIVE' } })
    const allVouchers = await prisma.voucher.findMany({ where: { active: true } })

    const prodBySku = new Map(allProducts.map((p) => [p.sku, p]))
    const voucherByCode = new Map(allVouchers.map((v) => [v.code, v]))

    // 2. Setup 4 Campaigns
    console.log('--- Setting up 4 realistic campaigns ---')
    const c1 = await createCampaign({
      code: 'CP-VULAN-2026',
      name: 'Chiến Dịch Vu Lan Báo Hiếu 2026',
      title: 'Vu Lan Báo Hiếu - Mùa Tri Ân Đấng Sinh Thành',
      description: 'Gửi trao chút an yên, hương thơm thanh tịnh và trà ấm thay lời tri ân cha mẹ.',
      startDate: new Date('2026-08-15T00:00:00.000Z'),
      endDate: new Date('2026-08-30T23:59:59.000Z'),
      discountPercent: 15,
      voucherCode: 'UUDAM10',
      appliedProductIds: [
        prodBySku.get('UD-QT-001')!.id,
        prodBySku.get('UD-DEN-001')!.id,
      ],
    })
    createdCampaignIds.push(c1.id)

    const c2 = await createCampaign({
      code: 'CP-PHATDAN-2026',
      name: 'Chiến Dịch Đại Lễ Phật Đản 2026',
      title: 'Đại Lễ Phật Đản - Ánh Sen Từ Bi',
      description: 'Thắp sáng tâm từ bi, gieo duyên lành cùng nến bơ hoa sen thuần khiết.',
      startDate: new Date('2026-05-10T00:00:00.000Z'),
      endDate: new Date('2026-05-25T23:59:59.000Z'),
      discountPercent: 20,
      voucherCode: 'PHATDAN50K',
      appliedProductIds: [
        prodBySku.get('UD-NEN-002')!.id,
        prodBySku.get('UD-NEN-001')!.id,
      ],
    })
    createdCampaignIds.push(c2.id)

    const c3 = await createCampaign({
      code: 'CP-TRANGRAM-2026',
      name: 'Chiến Dịch Trăng Rằm Tháng Tám 2026',
      title: 'Trăng Rằm Tháng Tám - Đêm Thiền Trà An Nhiên',
      description: 'Hương trà thơm quyện trăng thanh, thưởng thức khoảnh khắc an lạc bên bạn hữu.',
      startDate: new Date('2026-09-15T00:00:00.000Z'),
      endDate: new Date('2026-09-30T23:59:59.000Z'),
      discountPercent: 10,
      voucherCode: 'LIENKET15',
      appliedProductIds: [
        prodBySku.get('UD-COMBO-001')!.id,
        prodBySku.get('UD-TRA-001')!.id,
        prodBySku.get('UD-TRA-003')!.id,
      ],
    })
    createdCampaignIds.push(c3.id)

    const c4 = await createCampaign({
      code: 'CP-GOCTHAN-2026',
      name: 'Chiến Dịch Góc Nhỏ Thân Tâm 2026',
      title: 'Góc Nhỏ Thân Tâm - Tinh Hoa Thủ Công',
      description: 'Chăm sóc không gian sống thiền định với nguyên liệu tự nhiên và tranh gốm mộc mạc.',
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-20T23:59:59.000Z'),
      discountPercent: 12,
      voucherCode: 'FREESHIP0D',
      appliedProductIds: [
        prodBySku.get('UD-QT-002')!.id,
        prodBySku.get('UD-SAP-001')!.id,
      ],
    })
    createdCampaignIds.push(c4.id)

    // 3. Define the 10 Posts Matrix
    const postConfigs: Array<{
      campaign: CampaignData
      platform: SocialPlatform
      prodSku: string
      voucherCode: string
      scheduledAt: Date
      customPrompt?: string
    }> = [
      // Post 1: Campaign 1, Facebook
      {
        campaign: c1,
        platform: 'FACEBOOK',
        prodSku: 'UD-QT-001',
        voucherCode: 'UUDAM10',
        scheduledAt: new Date('2026-08-16T09:00:00.000Z'),
      },
      // Post 2: Campaign 1, Zalo OA
      {
        campaign: c1,
        platform: 'ZALO_OA',
        prodSku: 'UD-DEN-001',
        voucherCode: 'UUDAM10',
        scheduledAt: new Date('2026-08-18T14:30:00.000Z'),
      },
      // Post 3: Campaign 2, TikTok
      {
        campaign: c2,
        platform: 'TIKTOK',
        prodSku: 'UD-NEN-002',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-12T19:00:00.000Z'),
      },
      // Post 4: Campaign 2, Instagram
      {
        campaign: c2,
        platform: 'INSTAGRAM',
        prodSku: 'UD-NEN-001',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-14T11:00:00.000Z'),
      },
      // Post 5: Campaign 2, Website Blog
      {
        campaign: c2,
        platform: 'WEBSITE',
        prodSku: 'UD-NEN-001',
        voucherCode: 'PHATDAN50K',
        scheduledAt: new Date('2026-05-16T08:00:00.000Z'),
      },
      // Post 6: Campaign 3, Threads
      {
        campaign: c3,
        platform: 'THREADS',
        prodSku: 'UD-COMBO-001',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-17T20:00:00.000Z'),
      },
      // Post 7: Campaign 3, External CMS
      {
        campaign: c3,
        platform: 'EXTERNAL_CMS',
        prodSku: 'UD-TRA-001',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-19T10:00:00.000Z'),
      },
      // Post 8: Campaign 3, Facebook
      {
        campaign: c3,
        platform: 'FACEBOOK',
        prodSku: 'UD-TRA-003',
        voucherCode: 'LIENKET15',
        scheduledAt: new Date('2026-09-22T15:00:00.000Z'),
      },
      // Post 9: Campaign 4, TikTok
      {
        campaign: c4,
        platform: 'TIKTOK',
        prodSku: 'UD-QT-002',
        voucherCode: 'FREESHIP0D',
        scheduledAt: new Date('2026-10-05T18:30:00.000Z'),
      },
      // Post 10: Campaign 4, Threads
      {
        campaign: c4,
        platform: 'THREADS',
        prodSku: 'UD-SAP-001',
        voucherCode: 'FREESHIP0D',
        scheduledAt: new Date('2026-10-08T12:00:00.000Z'),
      },
    ]

    console.log(`--- Generating ${postConfigs.length} Live Social Posts via social-ai.ts ---`)

    for (let i = 0; i < postConfigs.length; i++) {
      const cfg = postConfigs[i]
      const prod = cfg.campaign.products.find((p) => p.sku === cfg.prodSku)
      const voucher = cfg.campaign.vouchers.find((v) => v.code === cfg.voucherCode) || cfg.campaign.vouchers[0]

      console.log(`Generating Post #${i + 1} (${cfg.platform}) for Campaign ${cfg.campaign.code}...`)

      const draft = await generatePlatformDraft({
        channel: cfg.platform,
        campaign: cfg.campaign,
        product: prod,
        voucher,
        scheduledAt: cfg.scheduledAt,
        customPrompt: cfg.customPrompt,
      })

      const content = draft.content
      const banned = detectBannedPhrases(content)
      const crmCheck = validateCrmInvariants(content, cfg.campaign, prod, voucher)

      generatedPosts.push({
        index: i + 1,
        campaignCode: cfg.campaign.code,
        campaignTitle: cfg.campaign.title,
        campaignDiscount: prod?.discountPercent ?? cfg.campaign.discountPercent ?? 0,
        campaignVoucherCode: voucher.code,
        platform: cfg.platform,
        productId: prod?.id || '',
        productSku: cfg.prodSku,
        productName: prod?.name || '',
        productPrice: prod?.price || 0,
        productPriceFormatted: prod?.price ? formatVnd(prod.price) : '',
        voucherCode: voucher.code,
        scheduledAt: cfg.scheduledAt.toISOString(),
        draft: {
          title: draft.title || null,
          slug: draft.slug || null,
          content: draft.content,
          excerpt: draft.excerpt || null,
          hashtags: draft.hashtags || null,
          mediaType: draft.mediaType,
          mediaUrls: draft.mediaUrls,
          targetUrl: draft.targetUrl || null,
          charCount: draft.content.length,
          wordCount: draft.content.trim().split(/\s+/).length,
        },
        automatedChecks: {
          bannedPhrasesFound: banned,
          matchedPrice: crmCheck.matchedPrice,
          matchedDiscount: crmCheck.matchedDiscount,
          matchedVoucher: crmCheck.matchedVoucher,
          engineRubric: {
            crmScore: draft.rubricEvaluation.crmAccuracy.score,
            voiceScore: draft.rubricEvaluation.brandVoice.score,
            fmtScore: draft.rubricEvaluation.platformFormatting.score,
            ctaScore: draft.rubricEvaluation.callToAction.score,
            overallScore: draft.rubricEvaluation.overallScore,
          },
        },
      })
    }

    const outputPath = path.resolve('.agents/teamwork/reviewer_rubric_m3/raw_generated_posts.json')
    fs.writeFileSync(outputPath, JSON.stringify(generatedPosts, null, 2), 'utf8')
    console.log(`Saved ${generatedPosts.length} posts data to ${outputPath}`)
  } finally {
    // Clean up created campaigns
    console.log('--- Cleaning up created test campaigns ---')
    for (const cid of createdCampaignIds) {
      try {
        await deleteCampaign(cid)
      } catch (err) {
        console.error(`Error deleting campaign ${cid}:`, err)
      }
    }
  }

  console.log('--- Checking Final Baseline Parity ---')
  await verifyBaselineParity('Post-generation')
  console.log('🎉 Generation and parity check completed successfully!')
}

main().catch((err) => {
  console.error('Fatal error in main:', err)
  process.exit(1)
})
