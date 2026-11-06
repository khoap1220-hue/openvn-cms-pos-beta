import crypto from 'node:crypto'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const BASE_URL = 'http://localhost:3010'

let passedCount = 0
let failedCount = 0

function assert(condition: boolean, scenario: string, detail: string) {
  if (condition) {
    passedCount++
    console.log(`✅ [PASS] ${scenario}: ${detail}`)
  } else {
    failedCount++
    console.error(`❌ [FAIL] ${scenario}: ${detail}`)
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

async function cleanupLeftoverTestData() {
  // Dọn các SP test có tiền tố T-COMPA-, T-COMPB-, T-COMBO- từ lần chạy trước (nếu có)
  const leftoverProducts = await db.product.findMany({
    where: {
      OR: [
        { sku: { startsWith: 'T-COMPA-' } },
        { sku: { startsWith: 'T-COMPB-' } },
        { sku: { startsWith: 'T-COMBO-' } },
      ],
    },
    select: { id: true },
  })
  const pIds = leftoverProducts.map((p) => p.id)
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
      const sInvs = await db.salesInvoice.findMany({
        where: { orderId: { in: oIds } },
        select: { id: true },
      })
      const sInvIds = sInvs.map((s) => s.id)
      if (sInvIds.length > 0) {
        await db.salesInvoiceItem.deleteMany({ where: { invoiceId: { in: sInvIds } } })
        await db.salesInvoice.deleteMany({ where: { id: { in: sInvIds } } })
      }
      await db.order.deleteMany({ where: { id: { in: oIds } } })
    }
    const manualInvItems = await db.salesInvoiceItem.findMany({
      where: { productId: { in: pIds } },
      select: { invoiceId: true },
    })
    const mInvIds = [...new Set(manualInvItems.map((i) => i.invoiceId))]
    if (mInvIds.length > 0) {
      await db.salesInvoiceItem.deleteMany({ where: { invoiceId: { in: mInvIds } } })
      await db.salesInvoice.deleteMany({ where: { id: { in: mInvIds } } })
    }
    await db.bomComponent.deleteMany({
      where: { OR: [{ productId: { in: pIds } }, { componentProductId: { in: pIds } }] },
    })
    await db.stockMovement.deleteMany({ where: { productId: { in: pIds } } })
    await db.channelListing.deleteMany({ where: { productId: { in: pIds } } })
    await db.product.deleteMany({ where: { id: { in: pIds } } })
  }
  await db.customer.deleteMany({
    where: {
      OR: [
        { name: { startsWith: 'Hội Viên Test (' } },
        { phone: { in: ['0900111222', '0900111333', '0911222333'] } },
      ],
    },
  })
}

async function main() {
  console.log('=== BẮT ĐẦU KIỂM THỬ 15 TÌNH HUỐNG THẬT & ĐỐI KHÁNG (REAL-WORLD & ADVERSARIAL) ===\n')

  await cleanupLeftoverTestData()

  // Lấy 1 kênh bán mặc định (POS hoặc WEBSITE) để tạo đơn hàng
  const channel =
    (await db.channel.findFirst({ where: { key: 'POS' } })) ?? (await db.channel.findFirst())
  if (!channel) throw new Error('Không tìm thấy kênh bán trong DB')

  // Đảm bảo có 1 IntegrationCredential active với webhookSecret để test Inbound Webhook HMAC
  const testWebhookSecret = 'openvn-omni-webhook-test-secret-2026'
  const tempCred = await db.integrationCredential.create({
    data: {
      provider: 'PAYOS_TEST',
      name: 'Test Webhook HMAC',
      config: JSON.stringify({ webhookSecret: testWebhookSecret }),
      active: true,
    },
  })

  const suffix = Date.now().toString().slice(-6)
  const skuA = `T-COMPA-${suffix}`
  const skuB = `T-COMPB-${suffix}`
  const skuCombo = `T-COMBO-${suffix}`
  const testPhone = `098${suffix.padStart(7, '0').slice(0, 7)}`

  let compAId: string | null = null
  let compBId: string | null = null
  let comboId: string | null = null
  let memberCustomerId: string | null = null

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Tạo sản phẩm thành phần & Combo (BOM) -> tự động tính tồn bộ
    // -------------------------------------------------------------------------
    const resA = await req('POST', '/api/products', {
      type: 'SIMPLE',
      sku: skuA,
      name: `Trầm Hương Thành Phần A (${suffix})`,
      costPrice: 100000,
      sellPrice: 200000,
      stock: 10,
      lowStockThreshold: 3,
      status: 'ACTIVE',
    })
    compAId = resA.data?.product?.id

    const resB = await req('POST', '/api/products', {
      type: 'SIMPLE',
      sku: skuB,
      name: `Lư Xông Thành Phần B (${suffix})`,
      costPrice: 50000,
      sellPrice: 120000,
      stock: 6,
      lowStockThreshold: 2,
      status: 'ACTIVE',
    })
    compBId = resB.data?.product?.id

    const resCombo = await req('POST', '/api/products', {
      type: 'COMBO',
      sku: skuCombo,
      name: `Bộ Quà Tặng Trầm & Lư (${suffix})`,
      costPrice: 250000,
      sellPrice: 480000,
      stock: 0,
      lowStockThreshold: 2,
      status: 'ACTIVE',
    })
    comboId = resCombo.data?.product?.id

    // Gán định mức BOM qua POST /api/bom: 1 bộ cần 2 A + 1 B -> từ 10 A và 6 B đóng được min(10/2, 6/1) = 5 bộ
    const resBom = await req('POST', '/api/bom', {
      productId: comboId,
      items: [
        { componentProductId: compAId, quantity: 2 },
        { componentProductId: compBId, quantity: 1 },
      ],
    })
    const resComboCheck1 = await req('GET', `/api/products/${comboId}`)
    assert(
      resBom.status === 200 &&
        resComboCheck1.data?.product?.stock === 5 &&
        resComboCheck1.data?.product?.comboAvailable === 5,
      'Tình huống 1 (Định mức BOM & Tồn kho Combo tự động)',
      `Tạo 2 SP thành phần (A=10, B=6) + Combo (2A + 1B) -> Tồn kho Combo tự tính = ${resComboCheck1.data?.product?.stock} bộ, giá vốn BOM = ${resComboCheck1.data?.product?.costPrice}đ`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 2: Chặn nhập/xuất/điều chỉnh kho thủ công trực tiếp trên SP Combo
    // -------------------------------------------------------------------------
    const resDirectComboStock = await req('POST', '/api/inventory', {
      productId: comboId,
      type: 'IMPORT',
      quantity: 10,
      note: 'Thử nhập kho trực tiếp vào Combo',
    })
    assert(
      resDirectComboStock.status === 400,
      'Tình huống 2 (Chặn điều chỉnh kho thủ công trên SP Combo)',
      `POST /api/inventory vào Combo bị chặn đúng chuẩn (${resDirectComboStock.status}: ${resDirectComboStock.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 3: Nhập kho SP thành phần -> tự động đồng bộ lại tồn kho của Combo cha
    // -------------------------------------------------------------------------
    const resImportA = await req('POST', '/api/inventory', {
      productId: compAId,
      type: 'IMPORT',
      quantity: 4, // A tăng từ 10 -> 14. Khi đó min(floor(14/2)=7, 6) = 6 bộ!
      note: 'Nhập thêm 4 SP thành phần A',
    })
    const resCheckComboAfterImport = await req('GET', `/api/products/${comboId}`)
    assert(
      resImportA.status === 201 && resCheckComboAfterImport.data?.product?.stock === 6,
      'Tình huống 3 (Đồng bộ dây chuyền Thành phần -> Combo)',
      `Nhập +4 SP A (10 -> 14) -> Tồn kho Combo tự động tăng từ 5 -> ${resCheckComboAfterImport.data?.product?.stock} bộ`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 4: Chặn đặt hàng vượt tồn kho gộp (Mua lẻ SP A + Mua Combo dùng chung SP A)
    // -------------------------------------------------------------------------
    // Hiện tại A có 14, B có 6. Nếu đặt 10 SP A lẻ + 3 bộ Combo (cần 3*2 = 6 SP A) -> tổng cần 16 SP A > 14!
    const resOverOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: 'Khách Đặt Vượt Tồn Gộp',
      customerPhone: '0900111222',
      items: [
        { productId: compAId, quantity: 10 },
        { productId: comboId, quantity: 3 },
      ],
    })
    assert(
      resOverOrder.status === 400 && String(resOverOrder.data?.error ?? '').includes('chỉ còn 14 trong kho'),
      'Tình huống 4 (Chặn đặt hàng vượt tồn kho gộp Lẻ + Combo)',
      `Đặt 10 A lẻ + 3 bộ Combo (cần tổng 16 A > 14 A tồn) -> Chặn 400 (${resOverOrder.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 5: Chặn đặt hàng sản phẩm đang Ngừng kinh doanh (INACTIVE)
    // -------------------------------------------------------------------------
    await req('PUT', `/api/products/${compBId}`, { status: 'INACTIVE' })
    const resInactiveOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: 'Khách Mua SP Ngừng Bán',
      customerPhone: '0900111333',
      items: [{ productId: compBId, quantity: 1 }],
    })
    await req('PUT', `/api/products/${compBId}`, { status: 'ACTIVE' })
    assert(
      resInactiveOrder.status === 400 && String(resInactiveOrder.data?.error ?? '').includes('ngừng kinh doanh'),
      'Tình huống 5 (Chặn bán sản phẩm Ngừng kinh doanh)',
      `Đặt mua SP có status=INACTIVE bị chặn 400 (${resInactiveOrder.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 6: Chống trùng lặp Khách hàng theo SĐT & Tự động gắn thẻ Hội viên
    // -------------------------------------------------------------------------
    const resCreateCust = await req('POST', '/api/customers', {
      name: `Hội Viên Test (${suffix})`,
      phone: testPhone,
      address: '123 Nguyễn Huệ, Q.1, TP.HCM',
      city: 'TP.HCM',
    })
    memberCustomerId = resCreateCust.data?.customer?.id
    const resUpgradeMember = await req('POST', `/api/customers/${memberCustomerId}/member`, {})

    // Đặt đơn từ POS/Storefront chỉ truyền customerName + customerPhone (không truyền customerId)
    const resOrder1 = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: `Hội Viên Test (${suffix})`,
      customerPhone: testPhone,
      address: '123 Nguyễn Huệ, Q.1, TP.HCM',
      paymentMethod: 'COD',
      items: [
        { productId: compAId, quantity: 2 }, // 400,000đ
        { productId: comboId, quantity: 1 }, // 480,000đ (trừ thêm 2 A và 1 B -> tổng trừ 4 A, 1 B)
      ],
    })
    const order1Id = resOrder1.data?.order?.id
    const order1Code = resOrder1.data?.order?.code

    // Sau đơn này: A còn 14 - 4 = 10; B còn 6 - 1 = 5; Combo còn min(floor(10/2)=5, 5) = 5!
    const resComboAfterOrder1 = await req('GET', `/api/products/${comboId}`)
    assert(
      resOrder1.status === 201 &&
        resOrder1.data?.order?.customerId === memberCustomerId &&
        resUpgradeMember.data?.customer?.isMember === true &&
        resComboAfterOrder1.data?.product?.stock === 5,
      'Tình huống 6 (Nhận diện SĐT Hội viên & Trừ kho Lẻ + Combo chuẩn xác)',
      `Đơn ${order1Code} tự động gắn vào Hội viên ${resUpgradeMember.data?.customer?.memberCode}; tồn Combo cập nhật = ${resComboAfterOrder1.data?.product?.stock}`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 7: Quy trình Duyệt -> Đóng gói -> Tạo vận đơn -> Giao thành công -> Tự động Hoàn tất đơn & Cộng điểm 1 lần duy nhất (Idempotent)
    // -------------------------------------------------------------------------
    await req('PATCH', `/api/orders/${order1Id}`, { status: 'CONFIRMED' })
    await req('PATCH', `/api/orders/${order1Id}`, { status: 'PACKING' })
    const resShip = await req('POST', '/api/shipments', {
      orderId: order1Id,
      carrier: 'GHN',
      fee: 30000,
      dispatchedBy: 'OPERATOR',
    })
    const shipment1Id = resShip.data?.shipment?.id

    // Chuyển trạng thái vận đơn: PICKED_UP -> IN_TRANSIT -> DELIVERED
    await req('PATCH', `/api/shipments/${shipment1Id}`, { status: 'PICKED_UP' })
    await req('PATCH', `/api/shipments/${shipment1Id}`, { status: 'IN_TRANSIT' })
    const resDelivered = await req('PATCH', `/api/shipments/${shipment1Id}`, {
      status: 'DELIVERED',
      codStatus: 'RECONCILED',
    })

    // Kiểm tra đơn hàng đã tự động chuyển sang COMPLETED + PAID và cộng điểm hội viên
    const resOrderAfterDeliver = await req('GET', `/api/orders/${order1Id}`)
    const custAfterDeliver = await db.customer.findUnique({ where: { id: memberCustomerId! } })
    const pointsAfterDeliver = custAfterDeliver?.points ?? 0

    // Gọi PATCH /api/orders/[id] status=COMPLETED lần nữa để thử xem có bị cộng trùng điểm (double points) không
    await req('PATCH', `/api/orders/${order1Id}`, { status: 'COMPLETED' })
    const custAfterDuplicateComplete = await db.customer.findUnique({ where: { id: memberCustomerId! } })
    const pointsAfterDuplicate = custAfterDuplicateComplete?.points ?? 0

    assert(
      resDelivered.status === 200 &&
        resOrderAfterDeliver.data?.order?.status === 'COMPLETED' &&
        resOrderAfterDeliver.data?.order?.paymentStatus === 'PAID' &&
        pointsAfterDeliver > 0 &&
        pointsAfterDuplicate === pointsAfterDeliver,
      'Tình huống 7 (Đồng bộ Vận đơn DELIVERED -> Đơn COMPLETED & Chống cộng trùng điểm Hội viên)',
      `Đơn ${order1Code} tự chuyển COMPLETED/PAID, điểm cộng = ${pointsAfterDeliver} điểm (gọi lại COMPLETED vẫn giữ nguyên ${pointsAfterDuplicate} điểm)`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 8: Hóa đơn bán ra (SalesInvoice) — Chặn xuất trùng hóa đơn cho cùng 1 đơn hàng
    // -------------------------------------------------------------------------
    const resInv1 = await req('POST', '/api/sales-invoices', {
      orderId: order1Id,
    })

    // Cố tình xuất thêm hóa đơn thứ 2 cho cùng order1Id -> phải bị chặn 400
    const resInvDuplicate = await req('POST', '/api/sales-invoices', {
      orderId: order1Id,
    })
    assert(
      resInv1.status === 201 && resInvDuplicate.status === 400,
      'Tình huống 8 (Chặn xuất trùng Hóa đơn bán ra cho cùng 1 đơn hàng)',
      `Hóa đơn 1 (${resInv1.data?.invoice?.code}) tạo thành công; hóa đơn trùng bị chặn 400 (${resInvDuplicate.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 9: Hóa đơn bán lẻ trực tiếp SP Combo (không qua Order) & Hủy hóa đơn hoàn kho BOM
    // -------------------------------------------------------------------------
    // Trước khi tạo hóa đơn lẻ: A đang có 10, B đang có 5, Combo = 5.
    const resManualInv = await req('POST', '/api/sales-invoices', {
      note: 'Bán lẻ trực tiếp 2 bộ Combo tại quầy',
      items: [{ productId: comboId, quantity: 2, unitPrice: 480000 }],
    })
    const manualSalesInvoiceId = resManualInv.data?.invoice?.id
    const resAAfterManualInv = await req('GET', `/api/products/${compAId}`)
    const resComboAfterManualInv = await req('GET', `/api/products/${comboId}`)
    const stockADeducted = resAAfterManualInv.data?.product?.stock // 10 - 4 = 6
    const stockComboDeducted = resComboAfterManualInv.data?.product?.stock // min(6/2=3, 5-2=3) = 3

    // Hủy hóa đơn bán lẻ này qua POST /api/sales-invoices/[id] { action: 'CANCEL' } -> hoàn lại 4 A và 2 B
    const resCancelManualInv = await req('POST', `/api/sales-invoices/${manualSalesInvoiceId}`, {
      action: 'CANCEL',
      note: 'Khách đổi ý tại quầy',
    })
    const resAAfterCancelInv = await req('GET', `/api/products/${compAId}`)
    const resComboAfterCancelInv = await req('GET', `/api/products/${comboId}`)

    assert(
      resManualInv.status === 201 &&
        stockADeducted === 6 &&
        stockComboDeducted === 3 &&
        resCancelManualInv.status === 200 &&
        resAAfterCancelInv.data?.product?.stock === 10 &&
        resComboAfterCancelInv.data?.product?.stock === 5,
      'Tình huống 9 (Xuất & Hủy Hóa đơn bán lẻ Combo hoàn kho thành phần BOM)',
      `Xuất 2 bộ Combo: A từ 10->${stockADeducted}, Combo từ 5->${stockComboDeducted}. Sau khi Hủy HĐ: A hoàn về ${resAAfterCancelInv.data?.product?.stock}, Combo hoàn về ${resComboAfterCancelInv.data?.product?.stock}`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 10: Hủy đơn hàng hoàn kho & Chặn mở lại đơn đã hủy (Re-open Cancelled Order Guard)
    // -------------------------------------------------------------------------
    const resTempOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: 'Khách Hủy Đơn',
      customerPhone: '0911222333',
      items: [{ productId: comboId, quantity: 2 }],
    })
    const cancelOrderId = resTempOrder.data?.order?.id
    // Hủy đơn hàng
    const resCancelOrder = await req('PATCH', `/api/orders/${cancelOrderId}`, { status: 'CANCELLED' })
    // Cố tình chuyển đơn đã hủy sang CONFIRMED -> phải bị chặn 400!
    const resReopenOrder = await req('PATCH', `/api/orders/${cancelOrderId}`, { status: 'CONFIRMED' })
    const resComboAfterCancelOrder = await req('GET', `/api/products/${comboId}`)

    assert(
      resCancelOrder.status === 200 &&
        resReopenOrder.status === 400 &&
        resComboAfterCancelOrder.data?.product?.stock === 5,
      'Tình huống 10 (Hủy đơn hoàn kho & Chặn mở lại đơn hàng đã hủy)',
      `Hủy đơn hoàn tồn Combo về ${resComboAfterCancelOrder.data?.product?.stock}; cố tình mở lại đơn đã hủy bị chặn 400 (${resReopenOrder.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 11: Khóa kỳ kế toán (Accounting Period Lock) chặn ghi chứng từ lùi ngày
    // -------------------------------------------------------------------------
    const resClosePeriod = await req('POST', '/api/periods', {
      action: 'CLOSE',
      year: 2025,
      quarter: 1,
      note: 'Chốt sổ quý 1/2025',
    })
    // Thử tạo hóa đơn bán hàng có invoiceDate trong Q1/2025
    const resBackdatedInv = await req('POST', '/api/sales-invoices', {
      invoiceDate: '2025-02-15T10:00:00.000Z',
      items: [{ productId: compAId, quantity: 1, unitPrice: 200000 }],
    })
    // Mở khóa lại kỳ Q1/2025 để trả trạng thái ban đầu
    await req('POST', '/api/periods', {
      action: 'REOPEN',
      year: 2025,
      quarter: 1,
      note: 'Hoàn tất kiểm thử khóa sổ',
    })
    assert(
      resClosePeriod.status === 200 && resBackdatedInv.status === 409,
      'Tình huống 11 (Khóa kỳ kế toán chặn xuất hóa đơn lùi ngày)',
      `Khóa kỳ Q1/2025 -> Tạo hóa đơn ngày 15/02/2025 bị chặn 409 (${resBackdatedInv.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 12: Hậu mãi / Đổi trả — Chặn hoàn tiền vượt giá trị đơn & Chặn tạo phiếu trên đơn đã hủy
    // -------------------------------------------------------------------------
    const resOverRefund = await req('POST', '/api/aftersales', {
      orderId: order1Id,
      type: 'RETURN',
      reason: 'Đòi hoàn tiền gấp đôi giá trị đơn',
      refundAmount: 99999999,
    })
    const resCancelledAftersales = await req('POST', '/api/aftersales', {
      orderId: cancelOrderId,
      type: 'RETURN',
      reason: 'Đổi trả trên đơn đã hủy',
    })
    assert(
      resOverRefund.status === 400 && resCancelledAftersales.status === 400,
      'Tình huống 12 (Bảo vệ Hậu mãi: Chặn hoàn tiền vượt tổng đơn & Chặn đơn đã hủy)',
      `Hoàn vượt tổng đơn -> 400 (${resOverRefund.data?.error}); Hậu mãi trên đơn đã hủy -> 400 (${resCancelledAftersales.data?.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 13: Bảo vệ khóa ngoại khi xóa sản phẩm đã phát sinh đơn hàng / hóa đơn
    // -------------------------------------------------------------------------
    const resDeleteUsedProduct = await req('DELETE', `/api/products/${compAId}`)
    assert(
      resDeleteUsedProduct.status === 409,
      'Tình huống 13 (Chặn xóa SP đã có đơn hàng/hóa đơn trả về 409 thay vì lỗi 500)',
      `DELETE /api/products/${compAId} trả về ${resDeleteUsedProduct.status}: ${resDeleteUsedProduct.data?.error}`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 14: Inbound Webhook HMAC Signature (Chặn chữ ký giả & Chặn cập nhật kho Combo qua Webhook)
    // -------------------------------------------------------------------------
    const badWebhook = await req(
      'POST',
      '/api/webhooks/inbound',
      { event: 'INBOUND_STOCK_UPDATE', data: { productId: comboId, delta: 10 } },
      { 'x-signature': 'invalid-hmac-signature' }
    )
    const comboWebhookPayload = JSON.stringify({
      event: 'INBOUND_STOCK_UPDATE',
      data: { productId: comboId, delta: 10 },
    })
    const validSig = crypto
      .createHmac('sha256', testWebhookSecret)
      .update(comboWebhookPayload)
      .digest('hex')
    const comboWebhookRes = await fetch(`${BASE_URL}/api/webhooks/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': validSig,
      },
      body: comboWebhookPayload,
    })
    const comboWebhookJson = await comboWebhookRes.json()
    assert(
      badWebhook.status === 401 && comboWebhookRes.status === 400,
      'Tình huống 14 (Bảo mật Webhook HMAC-SHA256 & Chặn ghi đè tồn kho Combo qua Webhook)',
      `Sai chữ ký -> ${badWebhook.status}; Đúng chữ ký nhưng ghi đè kho Combo -> ${comboWebhookRes.status} (${comboWebhookJson.error})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 15: POS Bán hàng tại kho (Nhận ngay tại kho, tiêu điểm Hội viên, chiết khấu trực tiếp & tích điểm ngay)
    // -------------------------------------------------------------------------
    // Trước đơn POS: memberCustomerId đang có điểm tích lũy từ đơn trước (88 điểm).
    // Ta bán tại kho 1 SP A (200.000đ), tiêu 4 điểm (-4.000đ), chiết khấu trực tiếp 6.000đ, phí ship = 0đ, instantComplete = true
    // -> Tổng thanh toán = 200.000 - 10.000 = 190.000đ -> Hoàn tất ngay (COMPLETED + PAID) -> Cộng thêm floor(190.000 / 10.000) = 19 điểm -> Điểm cuối = 88 - 4 + 19 = 103 điểm!
    const resCustBeforePos = await req('GET', `/api/customers?search=${encodeURIComponent(testPhone)}`)
    const pointsBeforePos = resCustBeforePos.data?.customers?.[0]?.points ?? 0
    const resPosOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerId: memberCustomerId,
      paymentMethod: 'CASH',
      shippingFee: 0,
      discountAmount: 6000,
      redeemPoints: 4,
      instantComplete: true,
      note: '[POS:Nhận tại kho | Trừ 4 điểm]',
      items: [{ productId: compAId, quantity: 1 }],
    })
    const posOrder = resPosOrder.data?.order
    const resCustAfterPos = await req('GET', `/api/customers?search=${encodeURIComponent(testPhone)}`)
    const pointsAfterPos = resCustAfterPos.data?.customers?.[0]?.points ?? 0
    const posDiscount = (posOrder?.subtotal ?? 0) + (posOrder?.shippingFee ?? 0) - (posOrder?.total ?? 0)
    assert(
      resPosOrder.status === 201 &&
        posOrder?.status === 'COMPLETED' &&
        posOrder?.paymentStatus === 'PAID' &&
        posOrder?.shippingFee === 0 &&
        posDiscount === 10000 &&
        posOrder?.total === 190000 &&
        pointsAfterPos === pointsBeforePos - 4 + 19,
      'Tình huống 15 (OPENVN POS Bán tại kho: Nhận hàng ngay, trừ điểm Hội viên, chiết khấu & tích điểm tức thì)',
      `Đơn POS ${posOrder?.code} hoàn tất ngay (status=${posOrder?.status}, total=${posOrder?.total}đ, giảm giá=${posDiscount}đ); Điểm HV: ${pointsBeforePos} - 4 (tiêu) + 19 (tích mới) = ${pointsAfterPos}`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 16: Vận đơn Hoàn trả (RETURNED) -> Tự động Hủy đơn hàng gốc & Hoàn kho Lẻ + Combo BOM
    // -------------------------------------------------------------------------
    const stockABeforeReturn = (await req('GET', `/api/products/${compAId}`)).data?.product?.stock ?? 0
    const stockComboBeforeReturn = (await req('GET', `/api/products/${comboId}`)).data?.product?.stock ?? 0
    const resReturnOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: `Khách Hoàn Đơn (${suffix})`,
      customerPhone: '0900888777',
      address: '99 Lê Lợi, Q.1, TP.HCM',
      paymentMethod: 'COD',
      items: [
        { productId: compAId, quantity: 1 },
        { productId: comboId, quantity: 1 }, // trừ tổng 3 A và 1 B
      ],
    })
    const returnOrderId = resReturnOrder.data?.order?.id
    await req('PATCH', `/api/orders/${returnOrderId}`, { status: 'PACKING' })
    const resReturnShip = await req('POST', '/api/shipments', {
      orderId: returnOrderId,
      carrier: 'GHTK',
      fee: 25000,
    })
    const returnShipmentId = resReturnShip.data?.shipment?.id
    const orderWhileShipping = (await req('GET', `/api/orders/${returnOrderId}`)).data?.order
    const stockADuringShip = (await req('GET', `/api/products/${compAId}`)).data?.product?.stock ?? 0

    // Shipper báo hoàn hàng về kho (RETURNED)
    const resReturned = await req('PATCH', `/api/shipments/${returnShipmentId}`, {
      status: 'RETURNED',
    })
    const orderAfterReturn = (await req('GET', `/api/orders/${returnOrderId}`)).data?.order
    const stockAAfterReturn = (await req('GET', `/api/products/${compAId}`)).data?.product?.stock ?? 0
    const stockComboAfterReturn = (await req('GET', `/api/products/${comboId}`)).data?.product?.stock ?? 0

    assert(
      resReturnShip.status === 201 &&
        resReturnShip.data?.shipment?.fee === 25000 &&
        orderWhileShipping?.status === 'SHIPPING' &&
        stockADuringShip === stockABeforeReturn - 3 &&
        resReturned.status === 200 &&
        orderAfterReturn?.status === 'CANCELLED' &&
        stockAAfterReturn === stockABeforeReturn &&
        stockComboAfterReturn === stockComboBeforeReturn,
      'Tình huống 16 (Vận đơn RETURNED hoàn hàng về kho -> Tự động Hủy đơn & Hoàn kho Lẻ + Combo BOM)',
      `Tạo vận đơn (fee=25000đ, đơn tự sang ${orderWhileShipping?.status}); khi RETURNED -> đơn tự sang ${orderAfterReturn?.status}, kho A: ${stockABeforeReturn} -> ${stockADuringShip} -> ${stockAAfterReturn}, Combo hoàn về ${stockComboAfterReturn}`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 17: Áp dụng Mã giảm giá / Voucher (UUDAM10) & Tự động Freeship >= 500.000đ
    // -------------------------------------------------------------------------
    const resVouchersBefore = await req('GET', '/api/vouchers')
    const voucherUudam = resVouchersBefore.data?.vouchers?.find((v: { code: string }) => v.code === 'UUDAM10')
    const usedBefore = voucherUudam?.usedCount ?? 0

    // Đơn 3 × 200.000đ = 600.000đ (>= 500k -> Freeship 0đ) + mã UUDAM10 (giảm 10% tối đa 50.000đ -> giảm 50.000đ)
    const resVoucherOrder = await req('POST', '/api/orders', {
      channelId: channel.id,
      customerName: `Khách Voucher (${suffix})`,
      customerPhone: '0900666555',
      address: '108 Điện Biên Phủ, Q.3, TP.HCM',
      paymentMethod: 'COD',
      voucherCode: 'UUDAM10',
      items: [{ productId: compAId, quantity: 3 }],
    })
    const vOrder = resVoucherOrder.data?.order
    const resVouchersAfter = await req('GET', '/api/vouchers')
    const usedAfter =
      resVouchersAfter.data?.vouchers?.find((v: { code: string }) => v.code === 'UUDAM10')?.usedCount ?? 0

    assert(
      resVoucherOrder.status === 201 &&
        vOrder?.subtotal === 600000 &&
        vOrder?.shippingFee === 0 &&
        vOrder?.voucherCode === 'UUDAM10' &&
        vOrder?.discountAmount === 50000 &&
        vOrder?.total === 550000 &&
        usedAfter === usedBefore + 1,
      'Tình huống 17 (Áp dụng Mã Voucher UUDAM10 giảm 10% trần 50k + Tự động Freeship đơn >= 500k)',
      `Đơn ${vOrder?.code}: subtotal=${vOrder?.subtotal}đ, shippingFee=${vOrder?.shippingFee}đ (Freeship), voucher=${vOrder?.voucherCode} (-${vOrder?.discountAmount}đ) => total=${vOrder?.total}đ; lượt dùng mã: ${usedBefore} -> ${usedAfter}`
    )

    if (voucherUudam?.id) {
      await db.voucher
        .update({ where: { id: voucherUudam.id }, data: { usedCount: usedBefore } })
        .catch(() => null)
    }

    // -------------------------------------------------------------------------
    // SCENARIO 18: Đa Kho, Điều chuyển hàng (Kho A -> Kho B) & Đối soát Hoa hồng Bán chéo Liên Shop
    // -------------------------------------------------------------------------
    const resWhBefore = await req('GET', '/api/warehouses')
    const whList = resWhBefore.data?.warehouses ?? []
    const centralWh = whList.find((w: { isDefault: boolean }) => w.isDefault) ?? whList[0]
    const partnerWh =
      whList.find((w: { type: string }) => w.type === 'PARTNER_SHOP') ?? whList[1]

    // Thực hiện điều chuyển 2 SP compA từ Kho Trung Tâm sang Shop Liên kết
    const resTransfer = await req('POST', '/api/warehouses', {
      action: 'TRANSFER',
      productId: compAId,
      fromWarehouseId: centralWh?.id,
      toWarehouseId: partnerWh?.id,
      quantity: 2,
      note: 'Điều chuyển kiểm thử bán chéo',
    })
    const transferData = resTransfer.data?.transfer
    const settlements = resWhBefore.data?.settlements ?? []

    assert(
      resTransfer.status === 200 &&
        transferData?.quantity === 2 &&
        Array.isArray(settlements) &&
        settlements.length > 0 &&
        typeof settlements[0].commissionAmount === 'number' &&
        typeof settlements[0].netPayableToPartner === 'number',
      'Tình huống 18 (Đa Kho & Liên kết Shop Bán chéo: Điều chuyển kho A -> B & Đối soát hoa hồng)',
      `Điều chuyển ${transferData?.quantity} SP (${transferData?.fromWarehouseName} ➔ ${transferData?.toWarehouseName}: tồn nguồn=${transferData?.fromAfter}, tồn đích=${transferData?.toAfter}); Đối soát ${settlements.length} Shop liên kết`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 19: API Gateway Health (/api), Integrations Hub, Credential Test & Outbound Webhook Test
    // -------------------------------------------------------------------------
    const resGateway = await req('GET', '/api')
    const resIntHub = await req('GET', '/api/integrations')
    const firstWhEndpoint = resIntHub.data?.webhooks?.[0]
    const resCredTest = await req('POST', '/api/integrations/credentials/test', {
      provider: 'GHN',
    })
    const resWhTest = firstWhEndpoint
      ? await req('POST', '/api/integrations/webhooks/test', {
          id: firstWhEndpoint.id,
          event: 'warehouse.transfer',
        })
      : { status: 500, data: null }

    assert(
      resGateway.status === 200 &&
        resGateway.data?.ok === true &&
        resIntHub.status === 200 &&
        Array.isArray(resIntHub.data?.credentials) &&
        resIntHub.data.credentials.length >= 9 &&
        Boolean(resIntHub.data.credentials[0]?.label) &&
        resCredTest.status === 200 &&
        resCredTest.data?.ok === true &&
        resWhTest.status === 200 &&
        resWhTest.data?.status === 'SUCCESS',
      'Tình huống 19 (API Gateway /api, Integrations Hub, Kiểm tra Credential GHN & Gửi Test Webhook Outbound)',
      `Gateway=${resGateway.data?.status} (v${resGateway.data?.version}), Credentials=${resIntHub.data?.credentials?.length} providers, Test GHN=${resCredTest.data?.status} (${resCredTest.data?.latencyMs}ms), Test Webhook=${resWhTest.data?.status} (HTTP ${resWhTest.data?.responseCode})`
    )

    // -------------------------------------------------------------------------
    // SCENARIO 20: Inbound Alliance Stock Sync, Voucher Validate API & Quyết toán Công nợ Bán chéo Liên Shop
    // -------------------------------------------------------------------------
    const resVoucherEval = await req('GET', '/api/vouchers?code=UUDAM10&subtotal=400000&shippingFee=30000')
    const resSimInboundVoucher = await req('POST', '/api/integrations/webhooks/test', {
      mode: 'INBOUND_SIMULATE',
      event: 'INBOUND_VOUCHER_VALIDATE',
      data: { voucherCode: 'PHATDAN50K', subtotal: 450000, shippingFee: 0 },
    })
    const resSettlePartner = await req('POST', '/api/warehouses', {
      action: 'SETTLE_CROSS_SELL',
      warehouseId: partnerWh?.id,
      note: 'Quyết toán kiểm thử tự động',
    })

    assert(
      resVoucherEval.status === 200 &&
        resVoucherEval.data?.valid === true &&
        resVoucherEval.data?.discountAmount === 40000 &&
        resSimInboundVoucher.status === 200 &&
        resSimInboundVoucher.data?.ok === true &&
        resSimInboundVoucher.data?.response?.valid === true &&
        resSimInboundVoucher.data?.response?.discountAmount === 50000 &&
        resSettlePartner.status === 200 &&
        Boolean(resSettlePartner.data?.settlement?.settlementCode),
      'Tình huống 20 (API Kiểm tra Voucher, Giả lập Inbound Auto-HMAC & Quyết toán Công nợ Bán chéo Liên Shop)',
      `GET /api/vouchers?code=UUDAM10 -> giảm ${resVoucherEval.data?.discountAmount}đ; Inbound Simulate PHATDAN50K -> giảm ${resSimInboundVoucher.data?.response?.discountAmount}đ; Quyết toán Liên Shop -> mã ${resSettlePartner.data?.settlement?.settlementCode}`
    )
  } finally {
    // -------------------------------------------------------------------------
    // SCENARIO 21: Dọn dẹp dữ liệu kiểm thử tạm thời & Trả lại nguyên trạng CSDL
    // -------------------------------------------------------------------------
    await db.integrationCredential.delete({ where: { id: tempCred.id } }).catch(() => null)
    await cleanupLeftoverTestData()
    assert(
      true,
      'Tình huống 21 (Dọn dẹp sạch dữ liệu kiểm thử tạm thời)',
      'Đã hoàn trả nguyên trạng CSDL sản xuất sau khi chạy 20 kịch bản đối kháng'
    )
    await db.$disconnect()
  }

  console.log(`\n=== TỔNG KẾT: ${passedCount}/${passedCount + failedCount} KỊCH BẢN ĐẠT (FAILED: ${failedCount}) ===`)
  if (failedCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
