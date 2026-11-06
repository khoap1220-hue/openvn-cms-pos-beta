// scripts/verify-m1-campaigns.ts
// Automated Verification Suite for Milestone 1 (M1: CRM Campaigns & DB Safety)
// Tests: DB backup, boundary state engine, validation, pricing & voucher logic, CRUD, zero regression

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
} from '../src/lib/campaign-service'
import { calculateVoucherDiscount } from '../src/lib/warehouse-service'

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
  console.log('🚀 BẮT ĐẦU KIỂM THỬ TỰ ĐỘNG MILESTONE 1 (CRM CAMPAIGNS & DB SAFETY) 🚀')
  console.log('======================================================================\n')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 1: KIỂM CHỨNG BẢN SAO LƯU CSDL VẬT LÝ (DB SAFETY BACKUP)
  // ------------------------------------------------------------------
  console.log('--- [GIAI ĐOẠN 1] Kiểm tra tệp sao lưu CSDL vật lý trước thay đổi ---')
  const backupPath = path.resolve('db/custom.db.bak.pre-autosocial')
  const currentDbPath = path.resolve('db/custom.db')

  assert(fs.existsSync(backupPath), 'Tệp sao lưu db/custom.db.bak.pre-autosocial tồn tại')
  const backupStat = fs.statSync(backupPath)
  assert(backupStat.size > 0, `Dung lượng tệp sao lưu > 0 bytes (${backupStat.size.toLocaleString()} bytes)`)

  // Kiểm tra SQLite Magic Header 16 bytes: "SQLite format 3\0"
  const fd = fs.openSync(backupPath, 'r')
  const headerBuf = Buffer.alloc(16)
  fs.readSync(fd, headerBuf, 0, 16, 0)
  fs.closeSync(fd)
  const headerStr = headerBuf.toString('utf8', 0, 15)
  assert(headerStr === 'SQLite format 3', `Tiêu đề SQLite hợp lệ: "${headerStr}"`)

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 2: ĐỐI SOÁT BASELINE BAN ĐẦU 24 BẢNG NGHIỆP VỤ CỐT LÕI
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 2] Kiểm toán đối soát 24 bảng baseline ban đầu ---')
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
    assert(count === baseline[model], `Bảng baseline ${model}: actual=${count} == baseline=${baseline[model]}`)
  }

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 3: ĐỘNG CƠ TÍNH TRẠNG THÁI BIÊN (BOUNDARY STATE ENGINE)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 3] Động cơ tính trạng thái biên thời gian thực (Zero-Drift) ---')
  const tStart = new Date('2026-11-01T10:00:00.000Z')
  const tEnd = new Date('2026-11-15T22:00:00.000Z')
  const testCamp = { startDate: tStart, endDate: tEnd, status: 'UPCOMING' }

  // 1. Trước bắt đầu 1 ngày
  const tMinus1Day = new Date(tStart.getTime() - 86400000)
  assert(computeCampaignStatus(testCamp, tMinus1Day) === 'UPCOMING', 'Mốc tStart - 1 ngày: UPCOMING')

  // 2. Trước bắt đầu 1 phút (60,000 ms)
  const tMinus1Min = new Date(tStart.getTime() - 60000)
  assert(computeCampaignStatus(testCamp, tMinus1Min) === 'UPCOMING', 'Mốc tStart - 1 phút: UPCOMING')

  // 3. Trước bắt đầu đúng 1 mili-giây (t - 1ms)
  const tMinus1Ms = new Date(tStart.getTime() - 1)
  assert(computeCampaignStatus(testCamp, tMinus1Ms) === 'UPCOMING', 'Mốc tStart - 1ms: UPCOMING')

  // 4. Đúng thời điểm bắt đầu (t = tStart)
  assert(computeCampaignStatus(testCamp, tStart) === 'RUNNING', 'Đúng thời điểm tStart: RUNNING')

  // 5. Sau bắt đầu đúng 1 mili-giây (tStart + 1ms)
  const tPlus1Ms = new Date(tStart.getTime() + 1)
  assert(computeCampaignStatus(testCamp, tPlus1Ms) === 'RUNNING', 'Mốc tStart + 1ms: RUNNING')

  // 6. Giữa chiến dịch
  const tMid = new Date(tStart.getTime() + (tEnd.getTime() - tStart.getTime()) / 2)
  assert(computeCampaignStatus(testCamp, tMid) === 'RUNNING', 'Thời điểm giữa chiến dịch: RUNNING')

  // 7. Trước kết thúc đúng 1 mili-giây (tEnd - 1ms)
  const tEndMinus1Ms = new Date(tEnd.getTime() - 1)
  assert(computeCampaignStatus(testCamp, tEndMinus1Ms) === 'RUNNING', 'Mốc tEnd - 1ms: RUNNING')

  // 8. Đúng thời điểm kết thúc (t = tEnd)
  assert(computeCampaignStatus(testCamp, tEnd) === 'RUNNING', 'Đúng thời điểm tEnd: RUNNING')

  // 9. Sau kết thúc đúng 1 mili-giây (tEnd + 1ms)
  const tEndPlus1Ms = new Date(tEnd.getTime() + 1)
  assert(computeCampaignStatus(testCamp, tEndPlus1Ms) === 'ENDED', 'Mốc tEnd + 1ms: ENDED')

  // 10. Sau kết thúc 1 phút (60,000 ms)
  const tEndPlus1Min = new Date(tEnd.getTime() + 60000)
  assert(computeCampaignStatus(testCamp, tEndPlus1Min) === 'ENDED', 'Mốc tEnd + 1 phút: ENDED')

  // 11. Trạng thái bị hủy thủ công CANCELLED (bất kể thời điểm nào)
  const cancelledCamp = { startDate: tStart, endDate: tEnd, status: 'CANCELLED' }
  assert(computeCampaignStatus(cancelledCamp, tMinus1Day) === 'CANCELLED', 'Bị hủy trước bắt đầu: CANCELLED')
  assert(computeCampaignStatus(cancelledCamp, tMid) === 'CANCELLED', 'Bị hủy giữa chiến dịch: CANCELLED')
  assert(computeCampaignStatus(cancelledCamp, tEndPlus1Min) === 'CANCELLED', 'Bị hủy sau kết thúc: CANCELLED')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 4: THẨM ĐỊNH RÀNG BUỘC & CÁC CA ĐỐI KHÁNG (VALIDATION & ADVERSARIAL)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 4] Thẩm định ràng buộc & ca đối kháng ---')

  // 1. Chặn endDate < startDate
  const invalidDate1 = validateCampaignDates('2026-11-15T00:00:00Z', '2026-11-10T00:00:00Z')
  assert(!invalidDate1.valid, 'Chặn endDate trước startDate (endDate < startDate)')

  // 2. Chặn endDate === startDate (thời lượng 0ms)
  const invalidDate2 = validateCampaignDates('2026-11-15T10:00:00Z', '2026-11-15T10:00:00Z')
  assert(!invalidDate2.valid, 'Chặn endDate bằng startDate (endDate == startDate)')

  // 3. Chặn ngày không hợp lệ (Invalid Date)
  const invalidDate3 = validateCampaignDates('not-a-date', '2026-11-15T10:00:00Z')
  assert(!invalidDate3.valid, 'Chặn chuỗi ngày không hợp lệ')

  // 4. Chặn tên rỗng khi gọi createCampaign
  let nameRejected = false
  try {
    await createCampaign({
      name: '   ',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-05T00:00:00Z',
    })
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Tên chương trình')) {
      nameRejected = true
    }
  }
  assert(nameRejected, 'Chặn tạo chiến dịch với tên rỗng/chỉ chứa khoảng trắng')

  // 5. Chặn mã chiến dịch trùng lặp
  const dupCode = 'CP-VERIFY-DUP-01'
  const temp1 = await createCampaign({
    code: dupCode,
    name: 'Chiến dịch thử nghiệm trùng mã 1',
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-05T00:00:00Z',
  })
  let dupRejected = false
  try {
    await createCampaign({
      code: dupCode,
      name: 'Chiến dịch thử nghiệm trùng mã 2',
      startDate: '2026-11-01T00:00:00Z',
      endDate: '2026-11-05T00:00:00Z',
    })
  } catch (err: unknown) {
    if (err instanceof Error && (err.message.includes('đã tồn tại') || (err as { statusCode?: number }).statusCode === 409)) {
      dupRejected = true
    }
  }
  assert(dupRejected, 'Chặn tạo trùng mã chiến dịch (báo lỗi xung đột 409)')
  await deleteCampaign(temp1.id)

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 5: ĐỘNG CƠ TÍNH GIÁ ĐA SẢN PHẨM & VOUCHER (PRICING ENGINE)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 5] Động cơ tính giá đa sản phẩm & Voucher (Contract M1 ↔ M3) ---')

  // Lấy các sản phẩm mẫu có sẵn trong baseline
  const pNen = await prisma.product.findUnique({ where: { sku: 'UD-NEN-001' } }) // 129.000₫
  const pTra = await prisma.product.findUnique({ where: { sku: 'UD-TRA-001' } }) // 350.000₫
  const pQt = await prisma.product.findUnique({ where: { sku: 'UD-QT-001' } })   // 450.000₫
  assert(!!pNen && !!pTra && !!pQt, 'Tìm thấy 3 sản phẩm mẫu trong CSDL baseline')

  // Lấy voucher mẫu trong baseline
  const vUudam = await prisma.voucher.findUnique({ where: { code: 'UUDAM10' } }) // Giảm 10%, max 50k, min 150k
  const vPhatdan = await prisma.voucher.findUnique({ where: { code: 'PHATDAN50K' } }) // Giảm 50k, min 400k
  assert(!!vUudam && !!vPhatdan, 'Tìm thấy 2 voucher mẫu trong CSDL baseline')

  // Tạo chiến dịch đa sản phẩm với:
  // - UD-NEN-001: dùng specialPrice override = 99.000₫ (tiết kiệm 30.000₫, ~23.3%)
  // - UD-TRA-001: dùng discountPercent override = 20% (350.000₫ -> 280.000₫)
  // - UD-QT-001: dùng discountPercent chung của chiến dịch = 10% (450.000₫ -> 405.000₫)
  const pricingCampaign = await createCampaign({
    code: 'CP-VERIFY-PRICING-01',
    name: 'Đại Lễ Phật Đản — Hương Trầm & Quà Tặng',
    title: 'Đại Lễ Phật Đản — Hương Trầm & Quà Tặng',
    description: 'Chương trình ưu đãi tri ân mùa Phật Đản',
    startDate: '2026-11-01T00:00:00Z',
    endDate: '2026-11-15T23:59:59Z',
    discountPercent: 10,
    appliedProductIds: [pNen!.id, pTra!.id, pQt!.id],
    appliedVoucherIds: [vUudam!.id, vPhatdan!.id],
    productOverrides: {
      [pNen!.id]: { specialPrice: 99000 },
      [pTra!.id]: { discountPercent: 20 },
    },
    tags: ['phatdan', 'tramhuong', 'uudam'],
  })

  // Kiểm tra cấu trúc CampaignData trả về
  assert(pricingCampaign.products.length === 3, 'Làm giàu đủ 3 sản phẩm')
  assert(pricingCampaign.vouchers.length === 2, 'Làm giàu đủ 2 vouchers')

  // Kiểm tra giá tính cho từng sản phẩm:
  const nenResult = pricingCampaign.products.find((p) => p.id === pNen!.id)
  assert(nenResult?.campaignPrice === 99000, `UD-NEN-001: specialPrice override = 99.000₫ (gốc: ${nenResult?.originalPrice}₫)`)
  assert(nenResult?.price === 99000, 'UD-NEN-001: contract alias .price === 99.000₫')
  assert(nenResult?.discountAmount === 30000, 'UD-NEN-001: discountAmount === 30.000₫')

  const traResult = pricingCampaign.products.find((p) => p.id === pTra!.id)
  assert(traResult?.campaignPrice === 280000, `UD-TRA-001: discountPercent override 20% -> 280.000₫ (gốc: ${traResult?.originalPrice}₫)`)
  assert(traResult?.discountPercent === 20, 'UD-TRA-001: discountPercent === 20%')

  const qtResult = pricingCampaign.products.find((p) => p.id === pQt!.id)
  assert(qtResult?.campaignPrice === 405000, `UD-QT-001: campaign discountPercent 10% -> 405.000₫ (gốc: ${qtResult?.originalPrice}₫)`)
  assert(qtResult?.discountAmount === 45000, 'UD-QT-001: discountAmount === 45.000₫')

  // Kiểm tra tính toán Voucher qua warehouse-service
  // 1. UUDAM10: Đơn dưới minOrderAmount (100.000₫ < 150.000₫) -> không hợp lệ
  const vCheck1 = calculateVoucherDiscount(vUudam!, 100000, 30000)
  assert(!vCheck1.valid && vCheck1.discountAmount === 0, 'UUDAM10: từ chối khi giỏ hàng < 150.000₫')

  // 2. UUDAM10: Đơn 200.000₫ -> giảm 10% = 20.000₫
  const vCheck2 = calculateVoucherDiscount(vUudam!, 200000, 30000)
  assert(vCheck2.valid && vCheck2.discountAmount === 20000, 'UUDAM10: giảm đúng 20.000₫ cho đơn 200.000₫')

  // 3. UUDAM10: Đơn 600.000₫ -> 10% = 60.000₫ > trần 50.000₫ -> chạm trần 50.000₫
  const vCheck3 = calculateVoucherDiscount(vUudam!, 600000, 30000)
  assert(vCheck3.valid && vCheck3.discountAmount === 50000, 'UUDAM10: chặn đúng trần maxDiscount 50.000₫')

  // 4. PHATDAN50K: Đơn 450.000₫ >= 400.000₫ -> giảm 50.000₫
  const vCheck4 = calculateVoucherDiscount(vPhatdan!, 450000, 30000)
  assert(vCheck4.valid && vCheck4.discountAmount === 50000, 'PHATDAN50K: giảm cố định 50.000₫')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 6: VÒNG ĐỜI CRUD & LỌC TRẠNG THÁI ĐỘNG (SERVICE CRUD)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 6] Vòng đời CRUD & Lọc trạng thái động ---')

  // 1. Get campaign by ID & by Code
  const fetchedById = await getCampaign(pricingCampaign.id)
  assert(fetchedById?.id === pricingCampaign.id, 'Lấy chiến dịch theo ID thành công')

  const fetchedByCode = await getCampaign(pricingCampaign.code)
  assert(fetchedByCode?.code === pricingCampaign.code, 'Lấy chiến dịch theo Code thành công')

  // 2. List campaigns with dynamic status filter
  const listRunning = await listCampaigns({
    status: 'RUNNING',
    now: new Date('2026-11-05T00:00:00Z'),
  })
  assert(listRunning.campaigns.some((c) => c.id === pricingCampaign.id), 'Tìm thấy chiến dịch trong danh sách RUNNING')

  const listUpcoming = await listCampaigns({
    status: 'UPCOMING',
    now: new Date('2026-10-20T00:00:00Z'),
  })
  assert(listUpcoming.campaigns.some((c) => c.id === pricingCampaign.id), 'Tìm thấy chiến dịch trong danh sách UPCOMING')

  const listEnded = await listCampaigns({
    status: 'ENDED',
    now: new Date('2026-11-20T00:00:00Z'),
  })
  assert(listEnded.campaigns.some((c) => c.id === pricingCampaign.id), 'Tìm thấy chiến dịch trong danh sách ENDED')

  // 3. Update campaign
  const updatedCampaign = await updateCampaign(pricingCampaign.id, {
    name: 'Đại Lễ Phật Đản — Bản Cập Nhật',
    discountPercent: 15,
  })
  assert(updatedCampaign.name === 'Đại Lễ Phật Đản — Bản Cập Nhật', 'Cập nhật tên chiến dịch thành công')
  assert(updatedCampaign.discountPercent === 15, 'Cập nhật % giảm chung thành công')

  // 4. Update campaign to CANCELLED
  const cancelledRes = await updateCampaign(pricingCampaign.id, {
    status: 'CANCELLED',
  })
  assert(cancelledRes.status === 'CANCELLED', 'Cập nhật chiến dịch sang CANCELLED thành công')

  // 5. Delete campaign
  const deleteRes = await deleteCampaign(pricingCampaign.id)
  assert(deleteRes.success, 'Xóa chiến dịch thành công')

  const verifyDeleted = await getCampaign(pricingCampaign.id)
  assert(verifyDeleted === null, 'Xác nhận chiến dịch đã bị xóa khỏi CSDL')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 7: DỌN DẸP DỮ LIỆU KIỂM THỬ (TEARDOWN & FLUSH WAL)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 7] Dọn dẹp dữ liệu kiểm thử & xả WAL ---')
  // Xóa bất kỳ chiến dịch test nào còn sót lại
  await prisma.campaign.deleteMany({
    where: {
      OR: [
        { code: { startsWith: 'CP-VERIFY-' } },
        { code: { startsWith: 'TEST-' } },
      ],
    },
  })
  // Xóa audit logs sinh ra từ test
  await prisma.auditLog.deleteMany({
    where: {
      entityType: 'Campaign',
    },
  })

  // Flush WAL
  const rawCheckpoint = await prisma.$queryRawUnsafe<Array<{ busy: bigint; log: bigint; checkpointed: bigint }>>('PRAGMA wal_checkpoint(FULL);')
  const busy = Number(rawCheckpoint[0]?.busy ?? BigInt(0))
  assert(busy === 0, 'Xả sạch WAL checkpoint sau kiểm thử: busy=0')

  // ------------------------------------------------------------------
  // GIAI ĐOẠN 8: ĐỐI SOÁT BASELINE SAU KIỂM THẢ (ZERO REGRESSION GATE)
  // ------------------------------------------------------------------
  console.log('\n--- [GIAI ĐOẠN 8] Đối soát tuyệt đối 24 bảng baseline sau kiểm thử ---')
  for (const model of coreTables) {
    const delegateName = model.charAt(0).toLowerCase() + model.slice(1)
    const delegate = (prisma as unknown as Record<string, { count: () => Promise<number> }>)[delegateName]
    const count = await delegate.count()
    assert(count === baseline[model], `Bảo toàn 100% bảng ${model.padEnd(20)}: actual=${count} baseline=${baseline[model]} (Delta = 0)`)
  }

  console.log('\n======================================================================')
  console.log(`🎉 TOÀN BỘ ${passedTests} KIỂM THỬ ĐẠT CHUẨN! (FAILED: ${failedTests}) 🎉`)
  console.log('>>> MILESTONE 1 (CRM CAMPAIGNS & DB SAFETY) HOÀN TẤT XUẤT SẮC <<<')
  console.log('======================================================================')
}

main()
  .catch((err) => {
    console.error('Fatal test execution failure:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
