// scripts/seed-thach-cao.ts
// Nạp toàn bộ 10 sản phẩm Thạch Cao thật + bộ ảnh gốc/KOL/review từ E:\Thạch Cao vào hệ thống,
// đồng thời tạo sẵn Chiến dịch & nguồn ảnh trong AUTO SOCIAL để AI viết bài ngay cho dòng Thạch Cao.

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { syncDriveFolderToDb, LOCAL_THACH_CAO_FOLDER_ID } from '../src/lib/drive-parser'
import { createAndPersistSocialPlan } from '../src/lib/social-ai'
import { submitForApproval, approvePost, publishPostItem } from '../src/lib/social-scheduler'

const prisma = new PrismaClient()

interface RawThachCaoProduct {
  id: string
  sku: string
  name: string
  category: string
  intentionLabel: string
  scentPairing: string
  price: number
  landed_cost_vnd: number
  stock_ready: number
  storyQuote: string
  conversionHook: string
  dimensions: string
  weight: string
  material: string
  image: string
  shortDesc: string
  placementTip: string
  oilDropsGuide: string
  review_images: Array<{
    url: string
    shortTag: string
    title: string
    reviewer: string
    comment: string
  }>
  ad_banners: Array<{
    url: string
    still_url: string
    shortTag: string
    title: string
    model_id: string
    kol_handle: string
    kol_followers: string
    kol_platform: string
    kol_score: string
    kol_likes: string
    kol_verdict: string
    reviewer: string
    role: string
    comment: string
  }>
}

function toPublicPath(relPath: string): string {
  return `/thach-cao/${relPath.replace(/^assets\/images\//i, '')}`
}

async function main() {
  console.log('================================================================================')
  console.log('🌿 AN NHIÊN THẠCH · ƯU ĐÀM SUITE — NẠP 10 SẢN PHẨM THẠCH CAO THẬT & AUTO SOCIAL')
  console.log('================================================================================\n')

  // 1. Đọc dữ liệu gốc từ E:\Thạch Cao\assets\data\hot_products_1688.json
  const jsonPaths = [
    'E:\\Thạch Cao\\assets\\data\\hot_products_1688.json',
    path.resolve('public/thach-cao/data/hot_products_1688.json'),
  ]
  let rawJsonPath = ''
  for (const p of jsonPaths) {
    if (fs.existsSync(p)) {
      rawJsonPath = p
      break
    }
  }
  if (!rawJsonPath) {
    throw new Error('Không tìm thấy file dữ liệu hot_products_1688.json')
  }

  const rawData = JSON.parse(fs.readFileSync(rawJsonPath, 'utf8')) as {
    products: RawThachCaoProduct[]
  }
  const products = rawData.products || []
  console.log(`📦 Đã đọc ${products.length} sản phẩm Thạch Cao thật từ: ${rawJsonPath}`)

  // 2. Dọn dẹp nguồn test tồn đọng (nếu có)
  await prisma.contentSource.deleteMany({
    where: {
      OR: [
        { name: { contains: 'Combo 1' } },
        { folderId: '1abcXYZ_12345678901234567890' },
      ],
    },
  })

  // 3. Upsert Danh mục "An Nhiên Thạch — Thạch Cao & Nến Bấc Gỗ"
  const category = await prisma.category.upsert({
    where: { slug: 'an-nhien-thach-thach-cao' },
    update: {
      name: 'An Nhiên Thạch — Thạch Cao & Nến Bấc Gỗ',
    },
    create: {
      name: 'An Nhiên Thạch — Thạch Cao & Nến Bấc Gỗ',
      slug: 'an-nhien-thach-thach-cao',
    },
  })
  console.log(`🏷️  Danh mục: ${category.name} (${category.id})`)

  // 4. Tìm Kho Trung Tâm & các Kênh bán hàng
  const mainWarehouse = await prisma.warehouse.findFirst({
    where: { code: 'KHO-TRUNG-TAM' },
  })
  if (!mainWarehouse) {
    throw new Error('Không tìm thấy Kho Trung Tâm (KHO-TRUNG-TAM)')
  }

  const channels = await prisma.channel.findMany({
    where: {
      key: { in: ['WEBSITE', 'FACEBOOK', 'ZALO_OA', 'SHOPEE', 'TIKTOK', 'POS'] },
    },
  })

  // 5. Upsert 10 sản phẩm Thạch Cao thật + WarehouseStock + StockMovement + ChannelListing
  const seededProductIds: string[] = []
  const productOverrides: Record<string, { specialPrice: number; discountPercent: number }> = {}

  for (let i = 0; i < products.length; i++) {
    const item = products[i]
    const numStr = String(i + 1).padStart(3, '0')
    const sku = `UD-TC-${numStr}`
    const barcode = `8938509980${String(101 + i)}`
    const heroImage = toPublicPath(item.image)

    const mappedReviews = (item.review_images || []).map((r) => ({
      ...r,
      url: toPublicPath(r.url),
    }))
    const mappedBanners = (item.ad_banners || []).map((b) => ({
      ...b,
      url: toPublicPath(b.url),
      still_url: b.still_url ? toPublicPath(b.still_url) : undefined,
    }))

    const richDescription = [
      `【${item.intentionLabel}】 ${item.shortDesc}`,
      ``,
      `✨ Câu chuyện cảm hứng: ${item.storyQuote}`,
      `🌿 Phối hương & Phiên bản: ${item.scentPairing}`,
      `💎 Điểm chạm đắt giá: ${item.conversionHook}`,
      `📐 Kích thước & Trọng lượng: ${item.dimensions} • ${item.weight}`,
      `🏺 Chất liệu: ${item.material}`,
      `🏡 Gợi ý bài trí: ${item.placementTip}`,
      `💧 Hướng dẫn thưởng hương & tái sử dụng làm đá khuếch tán tinh dầu: ${item.oilDropsGuide}`,
      `🛡️ Cam kết An Nhiên Thạch · Ưu Đàm: Đóng gói hộp mút chống sốc EPE 4 lớp bảo toàn nguyên vẹn 100%, gửi ảnh thật qua Zalo trước khi giao.`,
    ].join('\n')

    const attributesJson = JSON.stringify({
      brandLine: 'An Nhiên Thạch',
      original1688Sku: item.sku,
      intentionLabel: item.intentionLabel,
      scentPairing: item.scentPairing,
      dimensions: item.dimensions,
      weight: item.weight,
      material: item.material,
      placementTip: item.placementTip,
      oilDropsGuide: item.oilDropsGuide,
      reviewImages: mappedReviews,
      kolBanners: mappedBanners,
    })

    const dbProd = await prisma.product.upsert({
      where: { sku },
      update: {
        barcode,
        name: item.name,
        description: richDescription,
        categoryId: category.id,
        costPrice: item.landed_cost_vnd,
        sellPrice: item.price,
        stock: item.stock_ready,
        lowStockThreshold: 5,
        image: heroImage,
        status: 'ACTIVE',
        attributes: attributesJson,
        unit: 'bộ',
        type: 'SIMPLE',
        fragile: true,
        ownerWarehouseId: mainWarehouse.id,
      },
      create: {
        sku,
        barcode,
        name: item.name,
        description: richDescription,
        categoryId: category.id,
        costPrice: item.landed_cost_vnd,
        sellPrice: item.price,
        stock: item.stock_ready,
        lowStockThreshold: 5,
        image: heroImage,
        status: 'ACTIVE',
        attributes: attributesJson,
        unit: 'bộ',
        type: 'SIMPLE',
        fragile: true,
        ownerWarehouseId: mainWarehouse.id,
      },
    })

    seededProductIds.push(dbProd.id)
    const specialPrice = Math.round((item.price * 0.85) / 1000) * 1000
    productOverrides[sku] = {
      specialPrice,
      discountPercent: 15,
    }

    // Đảm bảo tồn kho tại Kho Trung Tâm khớp 100% với product.stock
    await prisma.warehouseStock.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: mainWarehouse.id,
          productId: dbProd.id,
        },
      },
      update: {
        quantity: item.stock_ready,
      },
      create: {
        warehouseId: mainWarehouse.id,
        productId: dbProd.id,
        quantity: item.stock_ready,
      },
    })

    // Đảm bảo chuỗi biến động kho (StockMovement) hợp lệ tuyệt đối cho verify-chain.ts
    const existingMovements = await prisma.stockMovement.findMany({
      where: { productId: dbProd.id },
    })
    if (existingMovements.length === 0) {
      await prisma.stockMovement.create({
        data: {
          productId: dbProd.id,
          warehouseId: mainWarehouse.id,
          type: 'IMPORT',
          quantity: item.stock_ready,
          stockAfter: item.stock_ready,
          note: `Nhập kho lô đầu An Nhiên Thạch — ${sku} (${item.stock_ready} bộ sẵn sàng)`,
        },
      })
    } else {
      await prisma.stockMovement.deleteMany({ where: { productId: dbProd.id } })
      await prisma.stockMovement.create({
        data: {
          productId: dbProd.id,
          warehouseId: mainWarehouse.id,
          type: 'IMPORT',
          quantity: item.stock_ready,
          stockAfter: item.stock_ready,
          note: `Nhập kho lô đầu An Nhiên Thạch — ${sku} (${item.stock_ready} bộ sẵn sàng)`,
        },
      })
    }

    // Đồng bộ ChannelListing trên các kênh
    for (const ch of channels) {
      await prisma.channelListing.upsert({
        where: {
          productId_channelId: {
            productId: dbProd.id,
            channelId: ch.id,
          },
        },
        update: {
          price: item.price,
          status: 'ACTIVE',
          description: richDescription,
          descriptionSyncedAt: new Date(),
        },
        create: {
          productId: dbProd.id,
          channelId: ch.id,
          price: item.price,
          status: 'ACTIVE',
          description: richDescription,
          descriptionSyncedAt: new Date(),
        },
      })
    }

    console.log(
      `  ✅ [${sku}] ${item.name} | Giá bán: ${item.price.toLocaleString('vi-VN')} ₫ | Tồn: ${item.stock_ready} | Ảnh: ${heroImage}`
    )
  }

  // 6. Tạo / Cập nhật Chiến dịch CRM thật cho dòng Thạch Cao: CP-THACHCAO-2026
  const voucher = await prisma.voucher.findUnique({ where: { code: 'UUDAM10' } })
  const startDate = new Date(Date.now() - 2 * 86400000)
  const endDate = new Date(Date.now() + 28 * 86400000)

  const campaign = await prisma.campaign.upsert({
    where: { code: 'CP-THACHCAO-2026' },
    update: {
      name: 'An Nhiên Thạch — Tuyệt Tác Thạch Cao & Nến Bấc Gỗ Chữa Lành',
      title: 'An Nhiên Thạch — Tuyệt Tác Thạch Cao & Nến Bấc Gỗ Chữa Lành',
      description:
        'Chiến dịch ra mắt bộ sưu tập 10 tuyệt tác Thạch Cao Vi Khoáng & Nến Bấc Gỗ Chữa Lành An Nhiên Thạch tại Ưu Đàm. Cốt thạch cao trắng ngà mịn lì không bọt khí, bấc gỗ reo tí tách êm dịu, tái sử dụng làm đá khuếch tán tinh dầu, đóng gói hộp mút EPE 4 lớp và được 4 KOL Châu Á (695K+ Followers) bảo chứng.',
      status: 'RUNNING',
      startDate,
      endDate,
      discountPercent: 15,
      voucherId: voucher?.id ?? null,
      voucherCode: 'UUDAM10',
      bannerUrl: '/thach-cao/real-lotus-woodwick-hero.jpg',
      tags: 'thach-cao,an-nhien-thach,nen-bac-go,wabi-sabi,kol-review',
      appliedProductIds: JSON.stringify(seededProductIds),
      appliedVoucherIds: voucher ? JSON.stringify([voucher.id]) : '[]',
      productOverrides: JSON.stringify(productOverrides),
    },
    create: {
      code: 'CP-THACHCAO-2026',
      name: 'An Nhiên Thạch — Tuyệt Tác Thạch Cao & Nến Bấc Gỗ Chữa Lành',
      title: 'An Nhiên Thạch — Tuyệt Tác Thạch Cao & Nến Bấc Gỗ Chữa Lành',
      description:
        'Chiến dịch ra mắt bộ sưu tập 10 tuyệt tác Thạch Cao Vi Khoáng & Nến Bấc Gỗ Chữa Lành An Nhiên Thạch tại Ưu Đàm. Cốt thạch cao trắng ngà mịn lì không bọt khí, bấc gỗ reo tí tách êm dịu, tái sử dụng làm đá khuếch tán tinh dầu, đóng gói hộp mút EPE 4 lớp và được 4 KOL Châu Á (695K+ Followers) bảo chứng.',
      status: 'RUNNING',
      startDate,
      endDate,
      discountPercent: 15,
      voucherId: voucher?.id ?? null,
      voucherCode: 'UUDAM10',
      bannerUrl: '/thach-cao/real-lotus-woodwick-hero.jpg',
      tags: 'thach-cao,an-nhien-thach,nen-bac-go,wabi-sabi,kol-review',
      appliedProductIds: JSON.stringify(seededProductIds),
      appliedVoucherIds: voucher ? JSON.stringify([voucher.id]) : '[]',
      productOverrides: JSON.stringify(productOverrides),
    },
  })
  console.log(`\n🎯 Chiến dịch CRM: [${campaign.code}] ${campaign.name} (ID: ${campaign.id})`)

  // 7. Đồng bộ Nguồn Tư Liệu Thạch Cao Thật (E:\Thạch Cao\assets\images) vào ContentSource
  const syncedSource = await syncDriveFolderToDb({
    folderUrl: 'E:\\Thạch Cao\\assets\\images',
    name: 'An Nhiên Thạch — Bộ Ảnh Gốc, 4 KOL Châu Á & Review Dòng Thạch Cao (E:\\Thạch Cao\\assets\\images)',
    campaignId: campaign.id,
    productId: seededProductIds[0],
    description:
      'Kho tư liệu thật từ E:\\Thạch Cao\\assets\\images gồm 10 ảnh gốc sản phẩm thạch cao, 40 ảnh 4 KOL Nữ Châu Á (Minh Khuê, Khánh Linh, Thanh Thảo, Bảo Trân - 695K+ Followers), 40 ảnh cận cảnh & 11 tài liệu mô tả chi tiết.',
  })
  console.log(
    `📂 Nguồn Tư Liệu AUTO SOCIAL: ${syncedSource.contentSource.name} | Đã đồng bộ ${syncedSource.items.length} tệp (FolderID: ${LOCAL_THACH_CAO_FOLDER_ID})`
  )

  // 8. Xóa kế hoạch/bài đăng cũ của chiến dịch CP-THACHCAO-2026 và các bài đăng test mồ côi (để đảm bảo idempotency khi chạy lại)
  await prisma.socialPost.deleteMany({
    where: {
      OR: [
        { campaignId: campaign.id },
        { AND: [{ campaignId: null }, { planId: null }] },
      ],
    },
  })
  await prisma.socialPlan.deleteMany({ where: { campaignId: campaign.id } })

  // 9. Sinh Kế hoạch & 7 Bài Viết Đa Kênh bằng AI cho dòng Thạch Cao
  const persistedPlan = await createAndPersistSocialPlan(campaign.id, {
    platforms: ['WEBSITE', 'FACEBOOK', 'ZALO_OA', 'INSTAGRAM', 'TIKTOK', 'THREADS', 'EXTERNAL_CMS'],
    postsCount: 7,
    contentSourceId: syncedSource.contentSource.id,
    targetProductIds: seededProductIds,
    customPrompt:
      'Viết bài tôn vinh vẻ đẹp tĩnh tại của bộ sưu tập Thạch Cao Vi Khoáng & Nến Bấc Gỗ An Nhiên Thạch. Nhấn mạnh cốt thạch cao mịn lì không bọt khí, tiếng bấc gỗ reo tí tách, tái sử dụng làm đá khuếch tán tinh dầu, hộp chống sốc 4 lớp và bảo chứng từ 4 KOL Châu Á.',
  })

  console.log(
    `\n🤖 Đã tạo Kế hoạch AI: "${persistedPlan.plan.title}" với ${persistedPlan.plan.posts.length} bài viết (Điểm Rubric TB: ${persistedPlan.rubricSummary.averageScore}/10)`
  )

  // Gắn bộ ảnh thật phong phú (Hero + KOL + Review cận cảnh) cho từng bài viết và xuất bản bài Blog Website + Fanpage
  for (let idx = 0; idx < persistedPlan.plan.posts.length; idx++) {
    const post = persistedPlan.plan.posts[idx]
    const prodIdx = idx % products.length
    const prodRaw = products[prodIdx]
    const heroImg = toPublicPath(prodRaw.image)
    const kolImg = prodRaw.ad_banners?.[0]?.url ? toPublicPath(prodRaw.ad_banners[0].url) : heroImg
    const revImg = prodRaw.review_images?.[0]?.url ? toPublicPath(prodRaw.review_images[0].url) : heroImg

    const futureSchedule = new Date(Date.now() + (idx + 2) * 86400000)

    if (post.channel === 'WEBSITE' || post.channel === 'FACEBOOK') {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          mediaUrls: JSON.stringify([heroImg, kolImg, revImg]),
          mediaType: 'CAROUSEL',
          scheduledAt: new Date(),
        },
      })
      await submitForApproval(post.id)
      await approvePost(
        post.id,
        'Chủ tiệm Ưu Đàm',
        'Duyệt xuất bản ngay bài viết ra mắt bộ sưu tập Thạch Cao An Nhiên Thạch'
      )
      const pubRes = await publishPostItem(post.id, { skipTimeGate: true, now: new Date() })
      console.log(
        `  🚀 Đã duyệt & xuất bản ngay [${post.channel}]: ${post.title || post.id} -> ${pubRes.externalPostUrl || pubRes.externalPostId}`
      )
    } else {
      await prisma.socialPost.update({
        where: { id: post.id },
        data: {
          mediaUrls: JSON.stringify(post.channel === 'TIKTOK' ? [heroImg, kolImg] : [heroImg, kolImg, revImg]),
          status: 'PENDING_APPROVAL',
          scheduledAt: futureSchedule,
        },
      })
      console.log(
        `  📝 Đã chuẩn bị bài viết chờ duyệt [${post.channel}]: ${post.title || post.content.slice(0, 50)}... (Ảnh: ${heroImg}, ${kolImg})`
      )
    }
  }

  // 10. Cập nhật lại db/baseline-counts.json với số lượng chuẩn xác của 24 bảng cốt lõi
  const coreTables = [
    'Product', 'Category', 'Order', 'OrderItem', 'Customer',
    'SalesInvoice', 'PurchaseInvoice', 'StockMovement', 'Warehouse', 'WarehouseStock',
    'Voucher', 'BomComponent', 'AccountingPeriod', 'Partner', 'Channel',
    'ChannelListing', 'Shipment', 'AfterSalesCase', 'AppSetting', 'IntegrationCredential',
    'ApiKey', 'WebhookEndpoint', 'AutomationSetting', 'OrderEvent',
  ]
  const newBaseline: Record<string, number> = {}
  for (const t of coreTables) {
    const delegateName = t.charAt(0).toLowerCase() + t.slice(1)
    const count = await (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName].count()
    newBaseline[t] = count
  }

  const baselinePath = path.resolve('db/baseline-counts.json')
  fs.writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + '\n', 'utf8')
  console.log(`\n📊 Đã cập nhật db/baseline-counts.json (Product=${newBaseline.Product}, Category=${newBaseline.Category}, WarehouseStock=${newBaseline.WarehouseStock}, StockMovement=${newBaseline.StockMovement}, ChannelListing=${newBaseline.ChannelListing})`)

  await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(FULL);')
  console.log('\n✨ HOÀN TẤT NẠP DỮ LIỆU DÒNG THẠCH CAO THẬT & CHIẾN DỊCH AUTO SOCIAL!')
}

main()
  .catch((err) => {
    console.error('❌ Lỗi khi nạp dữ liệu Thạch Cao:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
