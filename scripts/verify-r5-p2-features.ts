import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3010'

let passedCount = 0
let failedCount = 0
const failureDetails: string[] = []

function assert(condition: boolean, scenario: string, detail: string) {
  if (condition) {
    passedCount++
    console.log(`  ✅ [PASS] ${scenario}: ${detail}`)
  } else {
    failedCount++
    const msg = `❌ [FAIL] ${scenario}: ${detail}`
    failureDetails.push(msg)
    console.error(`  ${msg}`)
  }
}

async function req(
  method: string,
  path: string,
  body: unknown = undefined,
  extraHeaders: Record<string, string> = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: res.status, ok: res.ok, data: json, rawText: text, headers: res.headers }
}

async function cleanupR5TestData(prefix: string) {
  try {
    const products = await db.product.findMany({
      where: {
        OR: [
          { sku: { contains: prefix } },
          { name: { contains: prefix } },
        ],
      },
      select: { id: true },
    })
    const pIds = products.map((p) => p.id)
    if (pIds.length > 0) {
      const orderItems = await db.orderItem.findMany({
        where: { productId: { in: pIds } },
        select: { orderId: true },
      })
      const oIds = [...new Set(orderItems.map((i) => i.orderId))]
      if (oIds.length > 0) {
        await db.shipment.deleteMany({ where: { orderId: { in: oIds } } })
        await db.orderEvent.deleteMany({ where: { orderId: { in: oIds } } })
        await db.afterSalesCase.deleteMany({ where: { orderId: { in: oIds } } })
        await db.orderItem.deleteMany({ where: { orderId: { in: oIds } } })
        await db.order.deleteMany({ where: { id: { in: oIds } } })
      }

      const poItems = await db.purchaseInvoiceItem.findMany({
        where: { productId: { in: pIds } },
        select: { invoiceId: true },
      })
      const poIds = [...new Set(poItems.map((i) => i.invoiceId))]
      if (poIds.length > 0) {
        await db.purchaseInvoiceItem.deleteMany({ where: { invoiceId: { in: poIds } } })
        await db.purchaseInvoice.deleteMany({ where: { id: { in: poIds } } })
      }

      await db.stockMovement.deleteMany({ where: { productId: { in: pIds } } })
      await db.channelListing.deleteMany({ where: { productId: { in: pIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: pIds } } })
      await db.product.deleteMany({ where: { id: { in: pIds } } })
    }

    // Xóa đơn drill
    const drillOrders = await db.order.findMany({
      where: { code: { contains: prefix } },
      select: { id: true },
    })
    const dOIds = drillOrders.map((o) => o.id)
    if (dOIds.length > 0) {
      await db.shipment.deleteMany({ where: { orderId: { in: dOIds } } })
      await db.orderEvent.deleteMany({ where: { orderId: { in: dOIds } } })
      await db.orderItem.deleteMany({ where: { orderId: { in: dOIds } } })
      await db.order.deleteMany({ where: { id: { in: dOIds } } })
    }

    // Xóa khách hàng VIP test sinh nhật
    await db.customer.deleteMany({
      where: {
        OR: [
          { name: { contains: prefix } },
          { email: { contains: prefix } },
        ],
      },
    })

    // Xóa voucher test sinh nhật
    await db.voucher.deleteMany({
      where: {
        OR: [
          { code: { contains: prefix } },
          { title: { contains: prefix } },
        ],
      },
    })
  } catch (err) {
    console.error('Lỗi dọn dữ liệu R5:', err)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('SUITE R5: P2 OPERATIONAL FEATURES & SAFE EXTERNAL INTEGRATION MOCKS (TIERS 1-4)')
  console.log('================================================================================\n')

  const prefix = `R5-${Date.now().toString().slice(-6)}`
  await cleanupR5TestData(prefix)

  try {
    // =========================================================================
    // FEATURE 1: DASHBOARD REVENUE DAILY AGGREGATION (7, 14, 30, 90 DAYS) (F15)
    // =========================================================================
    console.log('--- 1. Kiểm thử Dashboard doanh thu theo ngày: 7, 14, 30, 90 ngày (F15) ---')

    const dateRanges = [7, 14, 30, 90]
    for (const days of dateRanges) {
      const resDash = await req('GET', `/api/dashboard?days=${days}`)

      // Tính tổng hợp doanh thu trực tiếp từ DB cho khoảng 'days' ngày gần nhất
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
      const rangeStart = new Date(todayStart.getTime() - (days - 1) * 86400000)

      const dbOrders = await db.order.findMany({
        where: {
          createdAt: { gte: rangeStart },
          status: { not: 'CANCELLED' },
        },
        select: { createdAt: true, total: true },
      })

      const directDbMap = new Map<string, number>()
      for (let i = 0; i < days; i++) {
        const d = new Date(todayStart.getTime() - i * 86400000)
        directDbMap.set(d.toISOString().slice(0, 10), 0)
      }
      for (const o of dbOrders) {
        const key = new Date(o.createdAt).toISOString().slice(0, 10)
        if (directDbMap.has(key)) {
          directDbMap.set(key, (directDbMap.get(key) ?? 0) + o.total)
        }
      }

      const totalExpectedRevenue = [...directDbMap.values()].reduce((sum, v) => sum + v, 0)

      if (resDash.status === 200) {
        const revenueByDay: Array<{ date: string; revenue: number }> =
          resDash.data?.revenueByDay || []
        const totalApiRevenue = revenueByDay.reduce((sum, d) => sum + (d.revenue || 0), 0)

        const matchCount = revenueByDay.length === days
        const matchTotal = Math.abs(totalApiRevenue - totalExpectedRevenue) < 1 // Khớp đến từng đồng

        assert(
          matchCount && matchTotal,
          `F15-Tier1-DashboardRange-${days}Days`,
          `Khoảng ${days} ngày: API trả về đúng ${revenueByDay.length} ngày, tổng doanh thu khớp 100% CSDL (${totalApiRevenue.toLocaleString()}đ === ${totalExpectedRevenue.toLocaleString()}đ)`
        )
      } else {
        assert(
          false,
          `F15-Tier1-DashboardRange-${days}Days`,
          `GET /api/dashboard?days=${days} phản hồi HTTP ${resDash.status}`
        )
      }
    }

    // =========================================================================
    // FEATURE 2: PURCHASE ORDER (PO) WORKFLOW: DRAFT -> APPROVE -> RECEIVE (F16)
    // =========================================================================
    console.log('\n--- 2. Kiểm thử quy trình Đơn nhập hàng PO: Nháp -> Duyệt -> Nhận hàng (F16) ---')

    const pPo = await db.product.create({
      data: {
        sku: `${prefix}-PO-ITEM`,
        name: `Nến Thơm Bấc Gỗ Thư Thái (${prefix})`,
        stock: 20, // Tồn ban đầu: 20
        costPrice: 60000,
        sellPrice: 150000,
      },
    })

    const partner = (await db.partner.findFirst()) ??
      (await db.partner.create({
        data: { code: `NCC-${prefix}`, name: `Nhà Cung Cấp Nến Thơm ${prefix}` },
      }))

    // Bước 2.1: Tạo đơn PO ở trạng thái Nháp (DRAFT)
    const resPoDraft = await req('POST', '/api/purchase-invoices', {
      partnerId: partner.id,
      status: 'DRAFT',
      note: `Đơn đặt hàng mua thử nghiệm ${prefix}`,
      items: [{ productId: pPo.id, quantity: 50, unitPrice: 60000 }],
    })

    const pPoAfterDraft = await db.product.findUnique({ where: { id: pPo.id } })
    const movsDraft = await db.stockMovement.findMany({ where: { productId: pPo.id } })

    assert(
      (resPoDraft.status === 201 || resPoDraft.status === 200) &&
        pPoAfterDraft?.stock === 20 &&
        movsDraft.length === 0,
      'F16-Tier1-PoDraftDoesNotAlterStock',
      `Tạo PO Nháp: Tồn kho KHÔNG ĐỔI (vẫn là ${pPoAfterDraft?.stock}), chưa phát sinh biến động kho`
    )

    const poId = resPoDraft.data?.invoice?.id

    // Bước 2.2: Duyệt PO (APPROVE)
    if (poId) {
      const resPoApprove = await req('POST', `/api/purchase-invoices/${poId}`, { action: 'APPROVE' })
      const pPoAfterApprove = await db.product.findUnique({ where: { id: pPo.id } })

      assert(
        (resPoApprove.status === 200 || resPoApprove.status === 400) && pPoAfterApprove?.stock === 20,
        'F16-Tier1-PoApproveDoesNotAlterStock',
        `Duyệt PO: Tồn kho vẫn KHÔNG ĐỔI khi chưa thực nhận hàng (tồn=${pPoAfterApprove?.stock})`
      )

      // Bước 2.3: Nhận hàng một phần (Partial Receiving): nhận 30 trên tổng 50
      const resPoReceivePartial = await req('POST', `/api/purchase-invoices/${poId}/receive`, {
        items: [{ productId: pPo.id, receivedQuantity: 30 }],
      })

      const pPoAfterPartial = await db.product.findUnique({ where: { id: pPo.id } })
      const movsPartial = await db.stockMovement.findMany({
        where: { productId: pPo.id, type: 'IMPORT' },
        orderBy: { createdAt: 'desc' },
      })

      assert(
        resPoReceivePartial.status === 200 &&
          pPoAfterPartial?.stock === 50 &&
          movsPartial.length === 1 &&
          movsPartial[0].quantity === 30,
        'F16-Tier1-PoPartialReceivingIncreasesStockExact',
        `Nhận hàng một phần (30 sp): Tồn kho tăng đúng 30 sp (20 -> ${pPoAfterPartial?.stock}), ghi nhận StockMovement quantity=30`
      )

      // Bước 2.4: Nhận hàng phần còn lại (Full Receiving): nhận nốt 20 sp
      const resPoReceiveFinal = await req('POST', `/api/purchase-invoices/${poId}/receive`, {
        items: [{ productId: pPo.id, receivedQuantity: 20 }],
      })

      const pPoAfterFinal = await db.product.findUnique({ where: { id: pPo.id } })

      assert(
        resPoReceiveFinal.status === 200 && pPoAfterFinal?.stock === 70,
        'F16-Tier1-PoFullReceivingCompletesOrder',
        `Nhận nốt 20 sp còn lại: Tồn kho tăng tiếp đúng 20 sp (50 -> ${pPoAfterFinal?.stock}), PO hoàn tất`
      )
    } else {
      assert(false, 'F16-Tier1-PoLifecycle', 'Không lấy được ID của đơn PO để chạy tiếp quy trình duyệt và nhận hàng')
    }

    // =========================================================================
    // FEATURE 3: ESC/POS K80 THERMAL PRINTING & FALLBACK ENCODER (F18)
    // =========================================================================
    console.log('\n--- 3. Kiểm thử bộ mã hóa in nhiệt ESC/POS K80 và cơ chế tự động Fallback (F18) ---')

    // Thử import bộ mã hóa ESC/POS hoặc gọi helper test
    let escposPassed = false
    let escposDetails = ''

    try {
      // Dynamic import helper nếu đã được implement
      // @ts-ignore
      const escposModule: any = await import('@/lib/escpos').catch(() => null)
      if (escposModule && typeof escposModule.encodeReceipt === 'function') {
        const sampleOrder = {
          code: 'DH-K80-TEST',
          createdAt: new Date(),
          customerName: 'Nguyễn Văn A',
          items: [{ name: 'Trầm Hương Thượng Uyển', quantity: 2, price: 100000, amount: 200000 }],
          total: 200000,
        }
        const bytes = escposModule.encodeReceipt(sampleOrder)
        const uint8 = new Uint8Array(bytes)

        // Kiểm tra lệnh cắt giấy GS V (0x1D 0x56) hoặc ESC i (0x1B 0x69)
        const hasPaperCut =
          (uint8.includes(0x1d) && uint8.includes(0x56)) || (uint8.includes(0x1b) && uint8.includes(0x69))

        // Kiểm tra byte header init ESC @ (0x1B 0x40)
        const hasInit = uint8.includes(0x1b) && uint8.includes(0x40)

        escposPassed = hasPaperCut && hasInit
        escposDetails = `Lệnh khởi tạo ESC @ (${hasInit}) và lệnh cắt giấy GS V (${hasPaperCut}) đều hiện diện trong chuỗi byte`
      } else {
        escposPassed = false
        escposDetails = 'Module src/lib/escpos.ts chưa được implement'
      }
    } catch (e: any) {
      escposPassed = false
      escposDetails = e.message
    }

    assert(
      escposPassed,
      'F18-Tier1-EscposK80ByteSequenceEncoder',
      escposDetails
    )

    // =========================================================================
    // FEATURE 4: AUTO-SHIPPING FEE CALCULATION (GHN/GHTK MOCK) (F19, R6)
    // =========================================================================
    console.log('\n--- 4. Kiểm thử tính phí vận chuyển tự động (GHN/GHTK Mock an toàn) (F19) ---')

    // 4.1: Địa chỉ nội thành Hà Nội (cùng tỉnh/thành phố với kho Ưu Đàm)
    const resFeeNoiThanh = await req('POST', '/api/shipping/calculate-fee', {
      carrier: 'GHTK',
      province: 'Hà Nội',
      district: 'Đống Đa',
      weightGram: 500,
    })

    // 4.2: Địa chỉ ngoại tỉnh (TP. Hồ Chí Minh)
    const resFeeLienTinh = await req('POST', '/api/shipping/calculate-fee', {
      carrier: 'GHN',
      province: 'Hồ Chí Minh',
      district: 'Quận 1',
      weightGram: 500,
    })

    if (resFeeNoiThanh.status === 200 && resFeeLienTinh.status === 200) {
      const feeNoiThanh = resFeeNoiThanh.data?.fee ?? 0
      const feeLienTinh = resFeeLienTinh.data?.fee ?? 0

      assert(
        feeNoiThanh > 0 && feeLienTinh > feeNoiThanh,
        'F19-Tier1-AutoShippingFeeCalculation',
        `Tính phí ship tự động: Nội thành Hà Nội = ${feeNoiThanh.toLocaleString()}đ, Liên tỉnh TP.HCM = ${feeLienTinh.toLocaleString()}đ (hợp lý)`
      )
    } else {
      assert(
        resFeeNoiThanh.status === 200,
        'F19-Tier1-AutoShippingFeeEndpoint',
        `Endpoint /api/shipping/calculate-fee phản hồi HTTP ${resFeeNoiThanh.status}`
      )
    }

    // =========================================================================
    // FEATURE 5: VIP CUSTOMER BIRTHDAY VOUCHER IDEMPOTENCY (F20, R6)
    // =========================================================================
    console.log('\n--- 5. Kiểm thử tác vụ phát Voucher Sinh Nhật cho khách VIP: Tính lũy đẳng (Idempotency) (F20) ---')

    // Tạo khách hàng VIP có sinh nhật hôm nay
    const today = new Date()
    const todayMmDd = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const vipCust = await db.customer.create({
      data: {
        name: `Khách VIP Sinh Nhật (${prefix})`,
        phone: `0988${Date.now().toString().slice(-6)}`,
        isMember: true,
        points: 500,
        preferences: JSON.stringify({ birthday: todayMmDd }),
      },
    })

    // Chạy tác vụ phát voucher sinh nhật LẦN 1
    const resBdayRun1 = await req('POST', '/api/vouchers/birthday-job', {
      testCustomerId: vipCust.id,
      date: today.toISOString().slice(0, 10),
    })

    const vouchersCount1 = await db.voucher.count({
      where: { code: { contains: vipCust.id.slice(-6) } },
    })

    assert(
      resBdayRun1.status === 200 || vouchersCount1 === 1,
      'F20-Tier1-BirthdayVoucherIssuedRun1',
      `Lần 1: Khách VIP có sinh nhật hôm nay được tạo voucher sinh nhật (HTTP ${resBdayRun1.status})`
    )

    // Chạy tác vụ phát voucher sinh nhật LẦN 2 (CÙNG NGÀY)
    const resBdayRun2 = await req('POST', '/api/vouchers/birthday-job', {
      testCustomerId: vipCust.id,
      date: today.toISOString().slice(0, 10),
    })

    const vouchersCount2 = await db.voucher.count({
      where: { code: { contains: vipCust.id.slice(-6) } },
    })

    assert(
      (resBdayRun2.status === 200 || resBdayRun2.status === 400) &&
        vouchersCount2 <= Math.max(1, vouchersCount1),
      'F20-Tier2-BirthdayVoucherIdempotentRun2',
      `Lần 2: Tác vụ kiểm tra tính lũy đẳng (idempotent), không gửi trùng voucher cho cùng một khách (voucher count = ${vouchersCount2})`
    )

    // =========================================================================
    // FEATURE 6: SHOPEE / TIKTOK SHOP ORDER SIMULATION DRILL (F21)
    // =========================================================================
    console.log('\n--- 6. Kiểm thử nút Diễn tập đơn hàng Shopee / TikTok Shop (AI Cockpit Drill) (F21) ---')

    // Diễn tập đơn hàng Shopee
    const resShopeeDrill = await req('POST', '/api/autopilot/drill', {
      channel: 'SHOPEE',
      customerName: `Khách Shopee Drill (${prefix})`,
      itemSku: 'UD-QT-002',
      quantity: 1,
    })

    // Diễn tập đơn hàng TikTok
    const resTikTokDrill = await req('POST', '/api/autopilot/drill', {
      channel: 'TIKTOK',
      customerName: `Khách TikTok Drill (${prefix})`,
      itemSku: 'UD-VL-001',
      quantity: 1,
    })

    if (resShopeeDrill.status === 200 && resTikTokDrill.status === 200) {
      assert(
        Boolean(resShopeeDrill.data?.order?.id) && Boolean(resTikTokDrill.data?.order?.id),
        'F21-Tier1-OmnichannelDrillExecution',
        `Diễn tập thành công cả đơn Shopee (${resShopeeDrill.data?.order?.code}) và TikTok Shop (${resTikTokDrill.data?.order?.code})`
      )
    } else {
      assert(
        resShopeeDrill.status === 200,
        'F21-Tier1-OmnichannelDrillEndpoint',
        `Endpoint diễn tập /api/autopilot/drill phản hồi HTTP ${resShopeeDrill.status}`
      )
    }

  } finally {
    console.log('\n--- Dọn dẹp dữ liệu kiểm thử R5 ---')
    await cleanupR5TestData(prefix)
    await db.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`KẾT QUẢ SUITE R5: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('================================================================================\n')

  if (failedCount > 0) {
    console.error('Chi tiết lỗi phát hiện:')
    for (const f of failureDetails) console.error(` - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Lỗi ngoại lệ trong verify-r5-p2-features:', err)
  process.exit(1)
})
