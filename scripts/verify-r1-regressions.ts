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
  return { status: res.status, ok: res.ok, data: json }
}

async function cleanupR1TestData(testPrefix: string) {
  try {
    // 1. Tìm các sản phẩm test theo prefix
    const testProducts = await db.product.findMany({
      where: {
        OR: [
          { sku: { startsWith: testPrefix } },
          { name: { contains: testPrefix } },
        ],
      },
      select: { id: true },
    })
    const pIds = testProducts.map((p) => p.id)

    if (pIds.length > 0) {
      // Tìm các order liên quan
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

      await db.bomComponent.deleteMany({
        where: { OR: [{ productId: { in: pIds } }, { componentProductId: { in: pIds } }] },
      })
      await db.stockMovement.deleteMany({ where: { productId: { in: pIds } } })
      await db.channelListing.deleteMany({ where: { productId: { in: pIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: pIds } } })
      await db.product.deleteMany({ where: { id: { in: pIds } } })
    }

    // 2. Dọn khách hàng test
    await db.customer.deleteMany({
      where: {
        OR: [
          { name: { contains: testPrefix } },
          { email: { contains: testPrefix } },
          { phone: { startsWith: '097999' } },
        ],
      },
    })
  } catch (err) {
    console.error('Lỗi dọn dữ liệu test R1:', err)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('SUITE R1: REGRESSION GUARDS & TRANSACTION ATOMICITY (TIERS 1-3)')
  console.log('================================================================================\n')

  const testPrefix = `R1-${Date.now().toString().slice(-6)}`
  await cleanupR1TestData(testPrefix)

  const defaultChannel =
    (await db.channel.findFirst({ where: { key: 'POS' } })) ?? (await db.channel.findFirst())
  if (!defaultChannel) throw new Error('Không tìm thấy kênh bán hàng trong DB')

  try {
    // =========================================================================
    // FEATURE 1: TRANSACTION ATOMICITY ON ORDER CANCELLATION (F02)
    // =========================================================================
    console.log('--- Test 1.1: Cancel đơn hàng hoàn tồn kho sản phẩm đơn lẻ (Happy path) ---')
    const skuSimple = `${testPrefix}-SIM`
    const pSimple = await db.product.create({
      data: {
        sku: skuSimple,
        name: `SP Test Đơn Lẻ ${testPrefix}`,
        costPrice: 50000,
        sellPrice: 100000,
        stock: 20,
        type: 'SIMPLE',
      },
    })

    // Tạo đơn mua 3 sản phẩm
    const orderSimple = await db.order.create({
      data: {
        code: `DH-${testPrefix}-01`,
        channelId: defaultChannel.id,
        status: 'PENDING',
        subtotal: 300000,
        total: 300000,
        items: {
          create: [{ productId: pSimple.id, quantity: 3, price: 100000 }],
        },
      },
      include: { items: true },
    })

    // Giảm tồn thủ công giả lập lúc tạo đơn
    await db.product.update({ where: { id: pSimple.id }, data: { stock: 17 } })
    await db.stockMovement.create({
      data: {
        productId: pSimple.id,
        type: 'EXPORT',
        quantity: -3,
        stockAfter: 17,
        note: `Xuất kho đơn ${orderSimple.code}`,
      },
    })

    // Thực hiện hủy đơn qua API
    const resCancelSimple = await req('PATCH', `/api/orders/${orderSimple.id}`, { status: 'CANCELLED' })
    const pSimpleAfterCancel = await db.product.findUnique({ where: { id: pSimple.id } })
    const movSimple = await db.stockMovement.findMany({
      where: { productId: pSimple.id, type: 'IMPORT' },
      orderBy: { createdAt: 'desc' },
      take: 1,
    })

    assert(
      resCancelSimple.status === 200 &&
        resCancelSimple.data?.order?.status === 'CANCELLED' &&
        pSimpleAfterCancel?.stock === 20 &&
        movSimple.length === 1 &&
        movSimple[0].quantity === 3 &&
        movSimple[0].stockAfter === 20,
      'F02-Tier1-SimpleOrderCancel',
      `Hủy đơn thành công: status=CANCELLED, tồn kho hoàn lại đúng 20 (ban đầu 20 -> trừ 3 còn 17 -> hoàn 3 thành ${pSimpleAfterCancel?.stock})`
    )

    console.log('\n--- Test 1.2: Cancel đơn hàng combo hoàn tồn từng thành phần và đồng bộ combo (Happy path) ---')
    const skuCompA = `${testPrefix}-CA`
    const skuCompB = `${testPrefix}-CB`
    const skuCombo = `${testPrefix}-CMB`

    const compA = await db.product.create({
      data: { sku: skuCompA, name: `Thành phần A ${testPrefix}`, stock: 15, costPrice: 30000, sellPrice: 50000 },
    })
    const compB = await db.product.create({
      data: { sku: skuCompB, name: `Thành phần B ${testPrefix}`, stock: 30, costPrice: 20000, sellPrice: 40000 },
    })
    // Combo gồm: 1 compA + 2 compB. Tồn ban đầu = min(15/1, 30/2) = 15
    const combo = await db.product.create({
      data: { sku: skuCombo, name: `Combo Bộ Quà ${testPrefix}`, type: 'COMBO', stock: 15, costPrice: 70000, sellPrice: 150000 },
    })
    await db.bomComponent.createMany({
      data: [
        { productId: combo.id, componentProductId: compA.id, quantity: 1 },
        { productId: combo.id, componentProductId: compB.id, quantity: 2 },
      ],
    })

    // Tạo đơn mua 2 Combo -> thành phần A trừ 2 (còn 13), thành phần B trừ 4 (còn 26)
    const orderCombo = await db.order.create({
      data: {
        code: `DH-${testPrefix}-02`,
        channelId: defaultChannel.id,
        status: 'PENDING',
        subtotal: 300000,
        total: 300000,
        items: {
          create: [{ productId: combo.id, quantity: 2, price: 150000 }],
        },
      },
    })
    await db.product.update({ where: { id: compA.id }, data: { stock: 13 } })
    await db.product.update({ where: { id: compB.id }, data: { stock: 26 } })
    await db.product.update({ where: { id: combo.id }, data: { stock: 13 } }) // min(13/1, 26/2) = 13

    // Hủy đơn combo qua API
    const resCancelCombo = await req('PATCH', `/api/orders/${orderCombo.id}`, { status: 'CANCELLED' })
    const compAAfter = await db.product.findUnique({ where: { id: compA.id } })
    const compBAfter = await db.product.findUnique({ where: { id: compB.id } })
    const comboAfter = await db.product.findUnique({ where: { id: combo.id } })

    assert(
      resCancelCombo.status === 200 &&
        resCancelCombo.data?.order?.status === 'CANCELLED' &&
        compAAfter?.stock === 15 &&
        compBAfter?.stock === 30 &&
        comboAfter?.stock === 15,
      'F02-Tier1-ComboOrderCancelSync',
      `Hủy đơn Combo: Thành phần A=15, Thành phần B=30, Combo tồn tự động sync về 15`
    )

    console.log('\n--- Test 1.3: Chặn hủy lại đơn đã hủy & Chặn mở lại đơn đã hủy (Boundary & Adversarial) ---')
    // Hủy lại đơn đã hủy -> phải trả về lỗi 400
    const resCancelAgain = await req('PATCH', `/api/orders/${orderSimple.id}`, { status: 'CANCELLED' })
    const pSimpleAfterDoubleCancel = await db.product.findUnique({ where: { id: pSimple.id } })

    assert(
      resCancelAgain.status === 400 &&
        pSimpleAfterDoubleCancel?.stock === 20,
      'F02-Tier2-DoubleCancelRejection',
      `Chặn hủy lại đơn đã hủy (HTTP ${resCancelAgain.status}), tồn kho không bị cộng lặp (vẫn là ${pSimpleAfterDoubleCancel?.stock})`
    )

    // Thử chuyển đơn đã hủy về CONFIRMED/PENDING -> phải trả về lỗi 400
    const resReopen = await req('PATCH', `/api/orders/${orderSimple.id}`, { status: 'PENDING' })
    assert(
      resReopen.status === 400,
      'F02-Tier2-ReopenCancelledOrderBlocked',
      `Chặn mở lại đơn đã hủy sang PENDING/CONFIRMED (HTTP ${resReopen.status})`
    )

    // Thử hủy đơn hàng đã hoàn tất (COMPLETED) -> phải trả về lỗi 400
    const orderCompleted = await db.order.create({
      data: {
        code: `DH-${testPrefix}-COMPLETED`,
        channelId: defaultChannel.id,
        status: 'COMPLETED',
        subtotal: 100000,
        total: 100000,
        items: {
          create: [{ productId: pSimple.id, quantity: 1, price: 100000 }],
        },
      },
    })
    const resCancelCompleted = await req('PATCH', `/api/orders/${orderCompleted.id}`, { status: 'CANCELLED' })
    assert(
      resCancelCompleted.status === 400,
      'F02-Tier2-CancelCompletedOrderBlocked',
      `Chặn hủy đơn hàng đã hoàn tất (HTTP ${resCancelCompleted.status})`
    )

    // =========================================================================
    // FEATURE 2: TRANSACTION ATOMICITY ON SHIPMENT RETURNED (F03)
    // =========================================================================
    console.log('\n--- Test 2.1: Vận đơn hoàn hàng RETURNED tự động hủy đơn & hoàn kho (Happy path) ---')
    const skuReturn = `${testPrefix}-RET`
    const pReturn = await db.product.create({
      data: { sku: skuReturn, name: `SP Test Hoàn ${testPrefix}`, stock: 8, costPrice: 40000, sellPrice: 90000 },
    })

    const orderReturn = await db.order.create({
      data: {
        code: `DH-${testPrefix}-03`,
        channelId: defaultChannel.id,
        status: 'SHIPPING',
        subtotal: 180000,
        total: 180000,
        items: {
          create: [{ productId: pReturn.id, quantity: 2, price: 90000 }],
        },
      },
    })

    const trackingCode = `TRA-${testPrefix}-99`
    const shipment = await db.shipment.create({
      data: {
        orderId: orderReturn.id,
        carrier: 'GHTK',
        trackingCode,
        status: 'DISPATCHED',
        fee: 25000,
        codAmount: 180000,
      },
    })

    // Đánh dấu vận đơn RETURNED qua API
    const resShipmentReturn = await req('PATCH', `/api/shipments/${shipment.id}`, { status: 'RETURNED' })
    const orderReturnAfter = await db.order.findUnique({ where: { id: orderReturn.id } })
    const pReturnAfter = await db.product.findUnique({ where: { id: pReturn.id } })

    assert(
      resShipmentReturn.status === 200 &&
        resShipmentReturn.data?.shipment?.status === 'RETURNED' &&
        orderReturnAfter?.status === 'CANCELLED' &&
        pReturnAfter?.stock === 10,
      'F03-Tier1-ShipmentReturnedAtomicRestock',
      `Vận đơn RETURNED: đơn hàng tự động CANCELLED, tồn kho hoàn lại đúng 10 (8 + 2 = ${pReturnAfter?.stock})`
    )

    console.log('\n--- Test 2.2: Idempotency khi gọi lại RETURNED trên vận đơn đã hoàn (Boundary) ---')
    const resShipmentReturnAgain = await req('PATCH', `/api/shipments/${shipment.id}`, { status: 'RETURNED' })
    const pReturnAfterSecond = await db.product.findUnique({ where: { id: pReturn.id } })

    assert(
      resShipmentReturnAgain.status === 200 &&
        pReturnAfterSecond?.stock === 10,
      'F03-Tier2-ShipmentReturnedIdempotency',
      `Gọi lại RETURNED trên vận đơn đã hoàn không làm sai lệch tồn kho (tồn vẫn là ${pReturnAfterSecond?.stock})`
    )

    // =========================================================================
    // FEATURE 3: CUSTOMER PHONE DEDUPLICATION GUARD (F04)
    // =========================================================================
    console.log('\n--- Test 3.1: Chặn tạo trùng lặp số điện thoại khách hàng (F04 Guard) ---')
    const phoneTest = `097999${Date.now().toString().slice(-4)}`

    // Tạo khách hàng thứ nhất với số điện thoại này
    const resCust1 = await req('POST', '/api/customers', {
      name: `Khách Thử Nghiệm 1 (${testPrefix})`,
      phone: phoneTest,
      email: `cust1_${testPrefix}@gmail.com`,
    })

    assert(
      resCust1.status === 201 && Boolean(resCust1.data?.customer?.id),
      'F04-Tier1-CustomerCreationSuccess',
      `Tạo khách hàng thứ nhất thành công với SĐT ${phoneTest}`
    )

    // Thử tạo khách hàng thứ hai với CÙNG số điện thoại
    const resCust2 = await req('POST', '/api/customers', {
      name: `Khách Thử Nghiệm 2 (${testPrefix})`,
      phone: phoneTest,
      email: `cust2_${testPrefix}@gmail.com`,
    })

    const duplicateCustomersInDb = await db.customer.count({ where: { phone: phoneTest } })

    assert(
      (resCust2.status === 400 || resCust2.status === 409) && duplicateCustomersInDb === 1,
      'F04-Tier2-CustomerDuplicatePhonePrevented',
      `Chặn tạo khách hàng trùng SĐT (HTTP ${resCust2.status}, số bản ghi trong DB = ${duplicateCustomersInDb})`
    )

    // Tạo khách hàng không có SĐT (khách vãng lai) -> vẫn cho phép
    const resCustNoPhone = await req('POST', '/api/customers', {
      name: `Khách Vãng Lai (${testPrefix})`,
      phone: '',
      email: '',
    })

    assert(
      resCustNoPhone.status === 201 && Boolean(resCustNoPhone.data?.customer?.id),
      'F04-Tier2-CustomerNoPhoneAllowed',
      `Cho phép tạo khách hàng vãng lai không có SĐT (HTTP ${resCustNoPhone.status})`
    )

    // =========================================================================
    // FEATURE 4: BACKUP ROUTE TURBOPACK & INTEGRITY GUARD (F05)
    // =========================================================================
    console.log('\n--- Test 4.1: API Sao lưu DB trả về file SQLite hợp lệ (F05) ---')
    const resBackup = await fetch(`${BASE_URL}/api/system/backup`)
    const backupBuf = await resBackup.arrayBuffer()
    const headerStr = Buffer.from(backupBuf.slice(0, 16)).toString('utf8')

    assert(
      resBackup.status === 200 &&
        headerStr.startsWith('SQLite format 3'),
      'F05-Tier1-DatabaseBackupIntegrity',
      `Tải bản sao lưu CSDL thành công: HTTP 200, header='${headerStr}'`
    )

  } finally {
    console.log('\n--- Dọn dẹp dữ liệu kiểm thử R1 ---')
    await cleanupR1TestData(testPrefix)
    await db.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`KẾT QUẢ SUITE R1: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('================================================================================\n')

  if (failedCount > 0) {
    console.error('Chi tiết lỗi phát hiện:')
    for (const f of failureDetails) console.error(` - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Lỗi ngoại lệ trong verify-r1-regressions:', err)
  process.exit(1)
})
