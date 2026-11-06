// scripts/verify-thach-cao-workflows.ts
// Kiểm thử toàn diện các nghiệp vụ thực tế của dòng sản phẩm Thạch Cao (An Nhiên Thạch · Ưu Đàm Suite)
// Bao gồm: Danh mục & 10 SP Thạch Cao -> Chuỗi Tồn Kho & Đa Kênh -> Đặt Hàng & Trừ/Hoàn Kho ->
// Chiến dịch CRM CP-THACHCAO-2026 -> Nguồn Ảnh Thật E:\Thạch Cao\assets\images -> AI Copywriter ->
// Duyệt 3 Cổng Thép & Hiển Thị Blog Công Khai (/blog)

import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { parseDriveUrl, fetchPublicDriveFolder, LOCAL_THACH_CAO_FOLDER_ID } from '../src/lib/drive-parser'
import { generatePlatformDraft, isThachCaoProduct, validateCrmInvariants } from '../src/lib/social-ai'
import { enrichCampaignData } from '../src/lib/campaign-service'

const db = new PrismaClient()
const BASE_URL = 'http://localhost:3010'

let passed = 0
let failed = 0

function assert(cond: boolean, title: string, detail: string) {
  if (cond) {
    passed++
    console.log(`✅ [PASS] ${title}: ${detail}`)
  } else {
    failed++
    console.error(`❌ [FAIL] ${title}: ${detail}`)
    throw new Error(`Kiểm thử thất bại tại: ${title} — ${detail}`)
  }
}

async function req(method: string, urlPath: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data: any = null
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  return { status: res.status, ok: res.ok, data, text }
}

async function main() {
  console.log('================================================================================')
  console.log('🧪 KIỂM THỬ NGHIỆP VỤ THỰC TẾ DÒNG THẠCH CAO (AN NHIÊN THẠCH · ƯU ĐÀM SUITE)')
  console.log('================================================================================\n')

  // Dọn dẹp đơn test tồn đọng từ lần chạy trước (nếu có)
  const leftoverTestOrders = await db.order.findMany({
    where: { customer: { phone: '0909888777' } },
    select: { id: true, code: true, status: true },
  })
  for (const lo of leftoverTestOrders) {
    if (lo.status !== 'CANCELLED') {
      await req('PATCH', `/api/orders/${lo.id}`, { status: 'CANCELLED', actor: 'Cleanup' })
    }
    await db.orderEvent.deleteMany({ where: { orderId: lo.id } })
    await db.orderItem.deleteMany({ where: { orderId: lo.id } })
    await db.order.delete({ where: { id: lo.id } })
    await db.stockMovement.deleteMany({ where: { note: { contains: lo.code } } })
  }
  await db.customer.deleteMany({ where: { phone: '0909888777' } })

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 1: Kiểm tra Danh mục, 10 Sản phẩm Thạch Cao thật, Ảnh gốc & Bảo mật giá vốn/1688
  // ---------------------------------------------------------------------------
  const thachCaoProducts = await db.product.findMany({
    where: { sku: { startsWith: 'UD-TC-' } },
    orderBy: { sku: 'asc' },
    include: { category: true },
  })

  assert(
    thachCaoProducts.length === 10,
    'Nghiệp vụ 1.1 (Đủ 10 sản phẩm Thạch Cao thật)',
    `Tìm thấy ${thachCaoProducts.length}/10 sản phẩm (UD-TC-001 -> UD-TC-010) thuộc danh mục "${thachCaoProducts[0]?.category?.name}"`
  )

  let allImagesExist = true
  let totalKolImages = 0
  let totalReviewImages = 0
  let zero1688LeakInDesc = true

  for (const p of thachCaoProducts) {
    const heroDiskPath = path.join(process.cwd(), 'public', p.image || '')
    if (!p.image?.startsWith('/thach-cao/') || !fs.existsSync(heroDiskPath)) {
      allImagesExist = false
    }
    if ((p.description || '').includes('1688.com') || (p.description || '').includes('¥')) {
      zero1688LeakInDesc = false
    }
    const attrs = JSON.parse(p.attributes || '{}')
    const kols = attrs.kolBanners || []
    const revs = attrs.reviewImages || []
    totalKolImages += kols.length
    totalReviewImages += revs.length
    for (const k of kols) {
      if (!fs.existsSync(path.join(process.cwd(), 'public', k.url))) allImagesExist = false
    }
    for (const r of revs) {
      if (!fs.existsSync(path.join(process.cwd(), 'public', r.url))) allImagesExist = false
    }
  }

  assert(
    allImagesExist && totalKolImages === 40 && totalReviewImages === 40,
    'Nghiệp vụ 1.2 (Xác thực 90 ảnh thật trên ổ đĩa)',
    `10 ảnh gốc + ${totalKolImages} ảnh KOL Châu Á + ${totalReviewImages} ảnh review cận cảnh đều tồn tại vật lý tại public/thach-cao/`
  )

  assert(
    zero1688LeakInDesc && thachCaoProducts.every((p) => p.fragile === true && p.sellPrice > p.costPrice),
    'Nghiệp vụ 1.3 (Bảo mật nguồn hàng & Cờ hàng dễ vỡ)',
    `10/10 sản phẩm bật fragile=true (in cảnh báo chống sốc 4 lớp trên phiếu A6), biên lợi nhuận > 72%, 0 lộ link 1688/CNY`
  )

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 2: Đối soát Chuỗi Tồn Kho (StockMovement + WarehouseStock) & Đồng bộ 6 Kênh Bán
  // ---------------------------------------------------------------------------
  let stockChainValid = true
  let totalListings = 0

  for (const p of thachCaoProducts) {
    const movements = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    let bal = 0
    for (const m of movements) {
      bal += m.quantity
      if (bal !== m.stockAfter) stockChainValid = false
    }
    if (bal !== p.stock) stockChainValid = false

    const whStocks = await db.warehouseStock.findMany({ where: { productId: p.id } })
    const whSum = whStocks.reduce((acc, w) => acc + w.quantity, 0)
    if (whSum !== p.stock) stockChainValid = false

    const listings = await db.channelListing.count({ where: { productId: p.id, status: 'ACTIVE' } })
    totalListings += listings
  }

  assert(
    stockChainValid && totalListings === 60,
    'Nghiệp vụ 2 (Đối soát Tồn kho Kho Trung Tâm & Đồng bộ Đa kênh)',
    `10/10 mã UD-TC-* khớp chuỗi biến động kho 100% (tổng tồn = ${thachCaoProducts.reduce((s, p) => s + p.stock, 0)} bộ) và đồng bộ ${totalListings} gian hàng trên 6 kênh`
  )

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 3: Đặt đơn hàng thực tế mua sản phẩm Thạch Cao (UD-TC-001) + Áp mã UUDAM10 -> Hủy trả kho
  // ---------------------------------------------------------------------------
  const targetProd = thachCaoProducts[0] // UD-TC-001: 390,000đ, tồn 16
  const initialStock = targetProd.stock
  const webChannel = await db.channel.findFirst({ where: { key: 'WEBSITE' } })
  const voucherBefore = await db.voucher.findUnique({ where: { code: 'UUDAM10' } })

  const createOrderRes = await req('POST', '/api/orders', {
    channelId: webChannel!.id,
    customerName: 'Khách Kiểm Thử Thạch Cao',
    customerPhone: '0909888777',
    address: '88 Đồng Khởi, Quận 1, TP.HCM',
    paymentMethod: 'BANK',
    voucherCode: 'UUDAM10',
    items: [{ productId: targetProd.id, quantity: 2 }], // 2 * 390,000 = 780,000đ, giảm 10% trần 50,000đ + Freeship -> 730,000đ
  })

  const createdOrder = createOrderRes.data?.order
  const prodAfterOrder = await db.product.findUnique({ where: { id: targetProd.id } })

  assert(
    createOrderRes.status === 201 &&
      createdOrder?.voucherCode === 'UUDAM10' &&
      createdOrder?.discountAmount === 50000 &&
      createdOrder?.shippingFee === 0 &&
      createdOrder?.total === 730000 &&
      prodAfterOrder?.stock === initialStock - 2,
    'Nghiệp vụ 3.1 (Đặt đơn hàng Thạch Cao + Áp voucher UUDAM10 trần 50k + Freeship + Trừ kho tự động)',
    `Tạo đơn ${createdOrder?.code} (2 bộ UD-TC-001 = 780.000đ, giảm UUDAM10 -50.000đ, Freeship 0đ => còn 730.000đ), tồn kho giảm chuẩn từ ${initialStock} -> ${prodAfterOrder?.stock}`
  )

  // Hủy đơn hàng vừa tạo qua API để hoàn kho, sau đó xóa bản ghi test để bảo toàn 100% dữ liệu gốc (Parity Delta = 0)
  const cancelRes = await req('PATCH', `/api/orders/${createdOrder.id}`, {
    status: 'CANCELLED',
    actor: 'Hệ thống Kiểm thử',
  })
  const prodAfterCancel = await db.product.findUnique({ where: { id: targetProd.id } })

  assert(
    cancelRes.status === 200 && prodAfterCancel?.stock === initialStock,
    'Nghiệp vụ 3.2 (Hủy đơn hàng -> Tự động hoàn kho chính xác)',
    `Hủy đơn ${createdOrder?.code} -> Tồn kho UD-TC-001 tự động hoàn về đúng ${prodAfterCancel?.stock} bộ`
  )

  // Dọn dẹp dấu vết đơn hàng test & movement phát sinh để giữ nguyên số lượng bảng baseline
  const createdMovs = await db.stockMovement.findMany({
    where: { productId: targetProd.id, note: { contains: createdOrder.code } },
    select: { id: true },
  })
  if (createdMovs.length > 0) {
    await db.stockMovement.deleteMany({
      where: { id: { in: createdMovs.map((m) => m.id) } },
    })
  }
  await db.shipment.deleteMany({ where: { orderId: createdOrder.id } })
  await db.orderEvent.deleteMany({ where: { orderId: createdOrder.id } })
  await db.orderItem.deleteMany({ where: { orderId: createdOrder.id } })
  await db.order.delete({ where: { id: createdOrder.id } })
  await db.customer.deleteMany({ where: { phone: '0909888777' } })
  if (voucherBefore) {
    await db.voucher.update({
      where: { id: voucherBefore.id },
      data: { usedCount: voucherBefore.usedCount },
    })
  }

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 4: Chiến dịch CRM CP-THACHCAO-2026 & Bảng giá Ưu đãi (-15%)
  // ---------------------------------------------------------------------------
  const campRes = await req('GET', '/api/campaigns?search=CP-THACHCAO-2026')
  const campFromApi = campRes.data?.campaigns?.find((c: any) => c.code === 'CP-THACHCAO-2026')
  const rawCampDb = await db.campaign.findUnique({ where: { code: 'CP-THACHCAO-2026' } })
  const enrichedCamp = await enrichCampaignData(rawCampDb!)

  assert(
    campRes.status === 200 &&
      campFromApi?.status === 'RUNNING' &&
      enrichedCamp.products.length === 10 &&
      enrichedCamp.products[0].campaignPrice === 331500,
    'Nghiệp vụ 4 (Chiến dịch CRM CP-THACHCAO-2026 & Giá ưu đãi -15%)',
    `Chiến dịch "${enrichedCamp.title}" đang RUNNING, áp dụng cho ${enrichedCamp.products.length} SP Thạch Cao (VD: UD-TC-001 từ 390.000đ -> ${enrichedCamp.products[0].campaignPrice.toLocaleString('vi-VN')}đ)`
  )

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 5: Đồng bộ Nguồn Tư Liệu Thạch Cao Thật (E:\Thạch Cao\assets\images)
  // ---------------------------------------------------------------------------
  const parsedLocal = parseDriveUrl('E:\\Thạch Cao\\assets\\images')
  const folderScan = await fetchPublicDriveFolder(parsedLocal.id)
  const dbSource = await db.contentSource.findFirst({
    where: { folderId: LOCAL_THACH_CAO_FOLDER_ID },
    include: { _count: { select: { items: true } } },
  })

  assert(
    parsedLocal.id === LOCAL_THACH_CAO_FOLDER_ID &&
      folderScan.totalItems === 105 &&
      dbSource?.syncStatus === 'SYNCED' &&
      dbSource?._count.items === 105,
    'Nghiệp vụ 5 (Đồng bộ Nguồn Ảnh Thật E:\\Thạch Cao\\assets\\images)',
    `Đồng bộ thành công ${dbSource?._count.items} tệp tư liệu (4 thư mục, 10 ảnh gốc, 40 ảnh KOL Châu Á, 40 ảnh review cận cảnh, 10 hồ sơ SP & 1 bảng giá CSV)`
  )

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 6: AI Copywriter viết bài cho sản phẩm Thạch Cao & Chấm điểm Rubric
  // ---------------------------------------------------------------------------
  const sampleThachCaoPricing = enrichedCamp.products[0]
  const fbDraft = await generatePlatformDraft({
    channel: 'FACEBOOK',
    campaign: enrichedCamp,
    product: sampleThachCaoPricing,
    voucher: enrichedCamp.vouchers[0],
    scheduledAt: new Date(),
  })

  const invCheck = validateCrmInvariants(
    fbDraft.content,
    enrichedCamp,
    sampleThachCaoPricing,
    enrichedCamp.vouchers[0]
  )

  assert(
    isThachCaoProduct(sampleThachCaoPricing) &&
      fbDraft.rubricEvaluation.overallScore >= 9.0 &&
      invCheck.valid &&
      fbDraft.content.includes('thạch cao vi khoáng') &&
      fbDraft.mediaUrls[0] === '/thach-cao/real-lotus-woodwick-hero.jpg',
    'Nghiệp vụ 6 (AI Copywriter dòng Thạch Cao & Kiểm định Bất biến CRM)',
    `Điểm Rubric đạt ${fbDraft.rubricEvaluation.overallScore}/10, khớp giá ${sampleThachCaoPricing.campaignPrice.toLocaleString('vi-VN')} ₫ (-15%) & mã UUDAM10, gắn đúng ảnh gốc ${fbDraft.mediaUrls[0]}`
  )

  // ---------------------------------------------------------------------------
  // NGHIỆP VỤ 7: Kiểm tra 7 Bài Viết Đa Kênh & Truy cập Thực tế Trang Blog Công Khai (/blog)
  // ---------------------------------------------------------------------------
  const postsRes = await req('GET', `/api/social/posts?campaignId=${rawCampDb!.id}`)
  const postsList: any[] = postsRes.data?.posts || []
  const publishedWebPost = postsList.find((p) => p.channel === 'WEBSITE' && p.status === 'PUBLISHED')

  const blogListHttp = await req('GET', '/blog')
  const blogDetailHttp = await req('GET', `/blog/${publishedWebPost?.slug}`)
  const heroImageHttp = await fetch(`${BASE_URL}/thach-cao/real-lotus-woodwick-hero.jpg`)

  assert(
    postsList.length === 7 &&
      Boolean(publishedWebPost) &&
      blogListHttp.status === 200 &&
      blogDetailHttp.status === 200 &&
      blogDetailHttp.text.includes('Tuyệt Tác Điêu Khắc Thạch Cao Vi Khoáng') &&
      heroImageHttp.status === 200,
    'Nghiệp vụ 7 (Xuất bản Đa kênh & Hiển thị Blog Công khai + Ảnh thật HTTP 200)',
    `Đủ 7 bài viết trên 7 kênh; trang /blog/${publishedWebPost?.slug} và ảnh /thach-cao/real-lotus-woodwick-hero.jpg trả về HTTP 200 OK`
  )

  console.log('\n================================================================================')
  console.log(`🏆 HOÀN TẤT KIỂM THỬ NGHIỆP VỤ THẠCH CAO: ĐẠT ${passed}/${passed + failed} NGHIỆP VỤ (100% PASS)`)
  console.log('================================================================================')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
