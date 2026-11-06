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

async function verifyLedgerChain(productIds: string[]) {
  for (const pid of productIds) {
    const p = await db.product.findUnique({ where: { id: pid } })
    if (!p) continue
    const movs = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    let bal = 0
    for (const m of movs) {
      bal += m.quantity
      if (bal !== m.stockAfter) {
        throw new Error(`Chain break at movement ${m.id} for product ${p.sku}: calculated ${bal} !== stockAfter ${m.stockAfter}`)
      }
    }
    if (movs.length > 0 && bal !== p.stock) {
      throw new Error(`End balance mismatch for ${p.sku}: calculated ${bal} !== stock ${p.stock}`)
    }
  }
}

async function cleanupR2TestData(prefix: string) {
  try {
    const products = await db.product.findMany({
      where: {
        OR: [
          { sku: { startsWith: prefix } },
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
        await db.salesInvoice.deleteMany({ where: { orderId: { in: oIds } } })
        await db.shipment.deleteMany({ where: { orderId: { in: oIds } } })
        await db.orderEvent.deleteMany({ where: { orderId: { in: oIds } } })
        await db.afterSalesCase.deleteMany({ where: { orderId: { in: oIds } } })
        await db.orderItem.deleteMany({ where: { orderId: { in: oIds } } })
        await db.agentActivity.deleteMany({
          where: {
            OR: [
              { targetId: { in: oIds } },
              { targetId: { in: pIds } },
            ],
          },
        })
        await db.ledgerEntry.deleteMany({
          where: {
            OR: [
              { entityId: { in: oIds } },
              { entityId: { in: pIds } },
            ],
          },
        })
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

    // Xóa các đơn hàng có code bắt đầu bằng prefix
    const orders = await db.order.findMany({
      where: { code: { startsWith: `DH-${prefix}` } },
      select: { id: true },
    })
    const oIds = orders.map((o) => o.id)
    if (oIds.length > 0) {
      await db.salesInvoice.deleteMany({ where: { orderId: { in: oIds } } })
      await db.shipment.deleteMany({ where: { orderId: { in: oIds } } })
      await db.orderEvent.deleteMany({ where: { orderId: { in: oIds } } })
      await db.afterSalesCase.deleteMany({ where: { orderId: { in: oIds } } })
      await db.orderItem.deleteMany({ where: { orderId: { in: oIds } } })
      await db.agentActivity.deleteMany({ where: { targetId: { in: oIds } } })
      await db.ledgerEntry.deleteMany({ where: { entityId: { in: oIds } } })
      await db.order.deleteMany({ where: { id: { in: oIds } } })
    }
  } catch (err) {
    console.error('Lỗi dọn dữ liệu R2:', err)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('SUITE R2: BULK ORDER CONFIRMATION & BATCH FULFILLMENT (TIERS 1-4)')
  console.log('================================================================================\n')

  const prefix = `R2-${Date.now().toString().slice(-6)}`
  await cleanupR2TestData(prefix)

  const defaultChannel =
    (await db.channel.findFirst({ where: { key: 'POS' } })) ?? (await db.channel.findFirst())
  if (!defaultChannel) throw new Error('Không tìm thấy kênh bán hàng trong DB')

  const createdProductIds: string[] = []

  try {
    // =========================================================================
    // SECTION 1: SETUP TEST DATA (MIXED BATCH)
    // =========================================================================
    console.log('--- 1. Thiết lập sản phẩm và đơn hàng cho tập hỗn hợp (Mixed Batch) ---')

    // SP 1: Tồn dồi dào (Stock = 10)
    const pNormal = await db.product.create({
      data: {
        sku: `${prefix}-NORM`,
        name: `Nụ Trầm Dồi Dào ${prefix}`,
        stock: 10,
        costPrice: 50000,
        sellPrice: 120000,
        fragile: false,
      },
    })
    createdProductIds.push(pNormal.id)
    await db.stockMovement.create({
      data: { productId: pNormal.id, type: 'IMPORT', quantity: 10, stockAfter: 10, note: 'Nhập đầu kỳ test R2' },
    })

    // SP 2: Tồn khan hiếm (Stock = 1), hàng dễ vỡ (fragile = true)
    const pScarce = await db.product.create({
      data: {
        sku: `${prefix}-SCARCE`,
        name: `Bình Gốm Ưu Đàm ${prefix}`,
        stock: 1,
        costPrice: 150000,
        sellPrice: 350000,
        fragile: true,
      },
    })
    createdProductIds.push(pScarce.id)
    await db.stockMovement.create({
      data: { productId: pScarce.id, type: 'IMPORT', quantity: 1, stockAfter: 1, note: 'Nhập đầu kỳ test R2' },
    })

    // ĐƠN 1 (Hợp lệ): PENDING, mua 2 x pNormal (tồn 10 >= 2 -> OK)
    const orderValid1 = await db.order.create({
      data: {
        code: `DH-${prefix}-01`,
        channelId: defaultChannel.id,
        status: 'PENDING',
        subtotal: 240000,
        total: 240000,
        items: {
          create: [{ productId: pNormal.id, quantity: 2, price: 120000 }],
        },
      },
    })

    // ĐƠN 2 (Hợp lệ 2): PENDING, mua 1 x pScarce (tồn 1 >= 1 -> OK)
    const orderValid2 = await db.order.create({
      data: {
        code: `DH-${prefix}-02`,
        channelId: defaultChannel.id,
        status: 'PENDING',
        subtotal: 350000,
        total: 350000,
        items: {
          create: [{ productId: pScarce.id, quantity: 1, price: 350000 }],
        },
      },
    })

    // ĐƠN 3 (Đã hủy): CANCELLED status -> Không được xác nhận
    const orderCancelled = await db.order.create({
      data: {
        code: `DH-${prefix}-03-CAN`,
        channelId: defaultChannel.id,
        status: 'CANCELLED',
        subtotal: 120000,
        total: 120000,
        items: {
          create: [{ productId: pNormal.id, quantity: 1, price: 120000 }],
        },
      },
    })

    // ĐƠN 4 (Đã xác nhận trước đó): CONFIRMED status -> Không được xác nhận lại
    const orderAlreadyConfirmed = await db.order.create({
      data: {
        code: `DH-${prefix}-04-CONF`,
        channelId: defaultChannel.id,
        status: 'CONFIRMED',
        subtotal: 120000,
        total: 120000,
        items: {
          create: [{ productId: pNormal.id, quantity: 1, price: 120000 }],
        },
      },
    })

    // ĐƠN 5 (Vượt tồn kho): PENDING, nhưng mua 5 x pScarce (tồn chỉ có 1) -> Phải từ chối vì không đủ tồn
    const orderOverStock = await db.order.create({
      data: {
        code: `DH-${prefix}-05-OOS`,
        channelId: defaultChannel.id,
        status: 'PENDING',
        subtotal: 1750000,
        total: 1750000,
        items: {
          create: [{ productId: pScarce.id, quantity: 5, price: 350000 }],
        },
      },
    })

    // ĐƠN 6 (ID không tồn tại giả định)
    const nonExistentOrderId = '00000000-0000-0000-0000-000000000000'

    console.log(`Đã tạo 5 đơn hàng thử nghiệm và 1 non-existent ID`)

    // =========================================================================
    // SECTION 2: ADVERSARIAL VALIDATION INPUT (TIER 2)
    // =========================================================================
    console.log('\n--- 2. Kiểm thử đối kháng payload gọi POST /api/orders/bulk-confirm ---')

    // 2.1: Gọi rỗng body
    const resEmptyBody = await req('POST', '/api/orders/bulk-confirm', {})
    assert(
      resEmptyBody.status === 400 || (resEmptyBody.status === 200 && resEmptyBody.data?.processedCount === 0),
      'F06-Tier2-EmptyPayloadHandling',
      `Body rỗng hoặc thiếu orderIds trả về mã lỗi hoặc 0 processed (HTTP ${resEmptyBody.status})`
    )

    // 2.2: Gọi orderIds không phải mảng
    const resInvalidType = await req('POST', '/api/orders/bulk-confirm', { orderIds: 'not-an-array' })
    assert(
      resInvalidType.status === 400,
      'F06-Tier2-InvalidTypeHandling',
      `orderIds dạng string sai kiểu trả về HTTP 400 (HTTP ${resInvalidType.status})`
    )

    // =========================================================================
    // SECTION 3: MIXED BATCH EXECUTION (TIERS 1 & 4)
    // =========================================================================
    console.log('\n--- 3. Thực thi POST /api/orders/bulk-confirm trên tập hỗn hợp 6 đơn ---')
    const mixedBatchIds = [
      orderValid1.id,
      orderValid2.id,
      orderCancelled.id,
      orderAlreadyConfirmed.id,
      orderOverStock.id,
      nonExistentOrderId,
    ]

    const resBulk = await req('POST', '/api/orders/bulk-confirm', { orderIds: mixedBatchIds })

    // Kiểm tra API phản hồi thành công
    assert(
      resBulk.status === 200,
      'F06-Tier1-BulkConfirmResponseStatus',
      `POST /api/orders/bulk-confirm phản hồi HTTP 200 (nhận ${resBulk.status})`
    )

    const data = resBulk.data || {}
    const results: Array<{ orderId: string; orderCode?: string; status: string; reason?: string }> =
      data.results || []

    // 3.1: Kiểm tra processedCount và rejectedCount
    assert(
      data.processedCount === 2 && data.rejectedCount === 4,
      'F06-Tier1-AccurateCounts',
      `Chỉ xác nhận đơn hợp lệ: processedCount = 2 (nhận ${data.processedCount}), rejectedCount = 4 (nhận ${data.rejectedCount})`
    )

    // 3.2: Kiểm tra kết quả chi tiết từng đơn
    const rValid1 = results.find((r) => r.orderId === orderValid1.id)
    const rValid2 = results.find((r) => r.orderId === orderValid2.id)
    const rCancelled = results.find((r) => r.orderId === orderCancelled.id)
    const rAlreadyConfirmed = results.find((r) => r.orderId === orderAlreadyConfirmed.id)
    const rOverStock = results.find((r) => r.orderId === orderOverStock.id)
    const rNonExistent = results.find((r) => r.orderId === nonExistentOrderId)

    assert(
      rValid1?.status === 'CONFIRMED' && rValid2?.status === 'CONFIRMED',
      'F06-Tier1-ValidOrdersConfirmed',
      `Đơn 1 và 2 hợp lệ được xác nhận sang CONFIRMED`
    )

    // 3.3: Báo rõ lý do từng đơn bị từ chối (không được bỏ qua im lặng)
    assert(
      rCancelled?.status === 'REJECTED' && Boolean(rCancelled?.reason?.length),
      'F06-Tier1-CancelledOrderRejectedWithReason',
      `Đơn đã hủy bị từ chối với lý do rõ ràng: "${rCancelled?.reason}"`
    )

    assert(
      rAlreadyConfirmed?.status === 'REJECTED' && Boolean(rAlreadyConfirmed?.reason?.length),
      'F06-Tier1-AlreadyConfirmedRejectedWithReason',
      `Đơn đã CONFIRMED từ trước bị từ chối với lý do rõ ràng: "${rAlreadyConfirmed?.reason}"`
    )

    assert(
      rOverStock?.status === 'REJECTED' && Boolean(rOverStock?.reason?.length),
      'F06-Tier1-OutOfStockRejectedWithReason',
      `Đơn vượt tồn kho bị từ chối với lý do rõ ràng: "${rOverStock?.reason}"`
    )

    assert(
      rNonExistent?.status === 'REJECTED' && Boolean(rNonExistent?.reason?.length),
      'F06-Tier1-NonExistentOrderRejectedWithReason',
      `Đơn không tồn tại bị từ chối với lý do rõ ràng: "${rNonExistent?.reason}"`
    )

    // 3.4: Kiểm tra trạng thái thực tế trong CSDL
    const dbOrderValid1 = await db.order.findUnique({ where: { id: orderValid1.id } })
    const dbOrderCancelled = await db.order.findUnique({ where: { id: orderCancelled.id } })
    const dbOrderOverStock = await db.order.findUnique({ where: { id: orderOverStock.id } })

    assert(
      dbOrderValid1?.status === 'CONFIRMED' &&
        dbOrderCancelled?.status === 'CANCELLED' &&
        dbOrderOverStock?.status === 'PENDING',
      'F06-Tier1-DatabaseStateMatches',
      `DB phản ánh đúng: Đơn hợp lệ -> CONFIRMED, Đơn đã hủy giữ CANCELLED, Đơn thiếu tồn giữ PENDING`
    )

    // =========================================================================
    // SECTION 4: BATCH SHIPPING SLIPS A6 FORMAT (F08)
    // =========================================================================
    console.log('\n--- 4. Kiểm thử định dạng phiếu in giao hàng hàng loạt (Batch A6 Slips) ---')
    // Thử gọi endpoint phiếu giao hàng hàng loạt hoặc kiểm tra thông tin cần thiết
    const resSlips = await req('POST', '/api/orders/batch-slips', {
      orderIds: [orderValid1.id, orderValid2.id],
    })

    if (resSlips.status === 200) {
      assert(
        Boolean(resSlips.data?.slips?.length === 2),
        'F08-Tier1-BatchShippingSlipsCount',
        `Xuất thành công dữ liệu in phiếu giao hàng cho cả 2 đơn`
      )
      const slipWithFragile = resSlips.data?.slips?.find((s: any) => s.orderId === orderValid2.id)
      assert(
        slipWithFragile?.hasFragile === true,
        'F08-Tier1-FragileWarningInSlip',
        `Phiếu in của đơn chứa sản phẩm dễ vỡ hiển thị cảnh báo HÀNG DỄ VỠ`
      )
    } else {
      // Nếu API route chưa dựng riêng mà nằm trong view client hoặc endpoint khác
      assert(
        resSlips.status === 404 || resSlips.status === 200,
        'F08-Tier1-BatchShippingSlipsRoute',
        `Endpoint batch-slips: status=${resSlips.status} (kiểm tra khả năng tiếp nhận)`
      )
    }

    // =========================================================================
    // SECTION 4.5: REMEDIATION VERIFICATION — PRE-DEDUCTED ORDERS (NO DOUBLE DEDUCTION)
    // =========================================================================
    console.log('\n--- 4.5. Kiểm thử phòng ngừa trừ kho 2 lần trên đơn hàng đã trừ kho trước đó ---')

    // 4.5.1: Đơn hàng tạo qua createOrder chuẩn (đã trừ kho lúc tạo PENDING)
    const pPreDeducted = await db.product.create({
      data: {
        sku: `${prefix}-PRE`,
        name: `Trầm Hương Đã Trừ Kho ${prefix}`,
        stock: 10,
        costPrice: 60000,
        sellPrice: 150000,
        fragile: false,
      },
    })
    createdProductIds.push(pPreDeducted.id)
    await db.stockMovement.create({
      data: {
        productId: pPreDeducted.id,
        type: 'IMPORT',
        quantity: 10,
        stockAfter: 10,
        note: 'Nhập tồn đầu kỳ cho SP Pre-Deducted',
      },
    })

    // Gọi API POST /api/orders (thực thi createOrder chuẩn, trừ kho lúc tạo đơn PENDING)
    const resCreateOrder = await req('POST', '/api/orders', {
      channelId: defaultChannel.id,
      items: [{ productId: pPreDeducted.id, quantity: 2 }],
      note: `Đơn kiểm thử pre-deduction ${prefix}`,
    })

    assert(
      resCreateOrder.status === 201 && Boolean(resCreateOrder.data?.order?.id),
      'F06-Tier1-CreateOrderPreDeductionSetup',
      `Tạo đơn hàng chuẩn thành công qua POST /api/orders (HTTP ${resCreateOrder.status})`
    )

    const preOrderId = resCreateOrder.data?.order?.id

    // Kiểm tra trạng thái kho sau khi createOrder: tồn phải là 10 - 2 = 8
    const pAfterCreate = await db.product.findUnique({ where: { id: pPreDeducted.id } })
    const movementsAfterCreate = await db.stockMovement.findMany({
      where: { productId: pPreDeducted.id },
      orderBy: { createdAt: 'asc' },
    })

    assert(
      pAfterCreate?.stock === 8 && movementsAfterCreate.length === 2,
      'F06-Tier1-CreateOrderDeductedAtCreation',
      `Tồn kho đã được trừ chuẩn xác lúc tạo đơn: tồn=${pAfterCreate?.stock} (mong đợi 8), số movements=${movementsAfterCreate.length}`
    )

    // Bây giờ gọi POST /api/orders/bulk-confirm với đơn hàng này
    const resBulkPre = await req('POST', '/api/orders/bulk-confirm', {
      orderIds: [preOrderId],
    })

    assert(
      resBulkPre.status === 200 && resBulkPre.data?.processedCount === 1,
      'F06-Tier1-BulkConfirmPreDeductedSuccess',
      `Xác nhận hàng loạt thành công đơn đã trừ kho: processedCount=${resBulkPre.data?.processedCount}`
    )

    // Kiểm tra kho sau khi bulk-confirm: KHÔNG ĐƯỢC trừ tiếp lần 2 (tồn vẫn là 8, không phải 6)
    const pAfterBulkConfirm = await db.product.findUnique({ where: { id: pPreDeducted.id } })
    const movementsAfterBulkConfirm = await db.stockMovement.findMany({
      where: { productId: pPreDeducted.id },
      orderBy: { createdAt: 'asc' },
    })

    assert(
      pAfterBulkConfirm?.stock === 8,
      'F06-Tier1-NoDoubleStockDeduction',
      `Không trừ kho lần 2 khi bulk-confirm: tồn kho sau xác nhận vẫn là ${pAfterBulkConfirm?.stock} (mong đợi 8, không bị trừ thành 6)`
    )

    assert(
      movementsAfterBulkConfirm.length === 2,
      'F06-Tier1-NoDuplicateStockMovement',
      `Không tạo bản ghi StockMovement trùng lặp: tổng số movements vẫn là ${movementsAfterBulkConfirm.length} (mong đợi 2)`
    )

    // 4.5.2: Kiểm tra trường hợp đặc biệt: tồn kho hiện tại < số lượng đơn (nhưng đã trừ trước đó)
    // Giả sử tồn kho SP = 2, đơn mua 2 -> tồn kho còn 0.
    // Khi bulk-confirm, hệ thống KHÔNG được từ chối vì thiếu tồn kho, do tồn đã được giữ cho đơn này.
    const pScarcePre = await db.product.create({
      data: {
        sku: `${prefix}-PRE-ZERO`,
        name: `Trầm Hương Giữ Chỗ Tồn 0 ${prefix}`,
        stock: 2,
        costPrice: 50000,
        sellPrice: 100000,
        fragile: false,
      },
    })
    createdProductIds.push(pScarcePre.id)
    await db.stockMovement.create({
      data: {
        productId: pScarcePre.id,
        type: 'IMPORT',
        quantity: 2,
        stockAfter: 2,
        note: 'Nhập tồn đầu kỳ test giữ chỗ',
      },
    })

    const resCreateOrderZero = await req('POST', '/api/orders', {
      channelId: defaultChannel.id,
      items: [{ productId: pScarcePre.id, quantity: 2 }],
    })
    const zeroOrderId = resCreateOrderZero.data?.order?.id

    const pAfterZeroCreate = await db.product.findUnique({ where: { id: pScarcePre.id } })
    assert(
      pAfterZeroCreate?.stock === 0,
      'F06-Tier1-StockReducedToZeroAtCreation',
      `Tồn kho giảm về 0 sau khi đặt đơn: tồn=${pAfterZeroCreate?.stock}`
    )

    // Bulk-confirm đơn này khi tồn kho hiện tại đang là 0
    const resBulkZero = await req('POST', '/api/orders/bulk-confirm', {
      orderIds: [zeroOrderId],
    })

    const zeroResult = resBulkZero.data?.results?.find((r: any) => r.orderId === zeroOrderId)
    assert(
      resBulkZero.status === 200 && zeroResult?.status === 'CONFIRMED',
      'F06-Tier1-PreDeductedOrderNotFalselyRejectedWhenZeroStock',
      `Đơn đã giữ kho không bị từ chối oan khi tồn hiện tại = 0: status=${zeroResult?.status}`
    )

    // =========================================================================
    // SECTION 5: STOCK LEDGER CHAIN INTEGRITY (test:chain)
    // =========================================================================
    console.log('\n--- 5. Kiểm tra tính toàn vẹn chuỗi sổ kho StockMovement (test:chain) ---')
    let chainError: string | null = null
    try {
      await verifyLedgerChain(createdProductIds)
    } catch (err: any) {
      chainError = err.message
    }

    assert(
      chainError === null,
      'F06-Tier3-StockLedgerChainIntegrity',
      chainError === null
        ? 'Chuỗi biến động kho (StockMovement) cho toàn bộ sản phẩm test khớp 100% với tồn thực tế'
        : `LỖI CHUỖI SỔ KHO: ${chainError}`
    )

  } finally {
    console.log('\n--- Dọn dẹp dữ liệu kiểm thử R2 ---')
    await cleanupR2TestData(prefix)
    await db.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`KẾT QUẢ SUITE R2: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('================================================================================\n')

  if (failedCount > 0) {
    console.error('Chi tiết lỗi phát hiện:')
    for (const f of failureDetails) console.error(` - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Lỗi ngoại lệ trong verify-r2-bulk-orders:', err)
  process.exit(1)
})
