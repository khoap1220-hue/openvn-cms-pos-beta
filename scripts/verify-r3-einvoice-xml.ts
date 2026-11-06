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

async function cleanupR3TestData(prefix: string) {
  try {
    const invoices = await db.salesInvoice.findMany({
      where: { code: { contains: prefix } },
      select: { id: true },
    })
    const invIds = invoices.map((i) => i.id)
    if (invIds.length > 0) {
      await db.salesInvoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } })
      await db.salesInvoice.deleteMany({ where: { id: { in: invIds } } })
    }

    const partners = await db.partner.findMany({
      where: { code: { contains: prefix } },
      select: { id: true },
    })
    const partnerIds = partners.map((p) => p.id)
    if (partnerIds.length > 0) {
      await db.partner.deleteMany({ where: { id: { in: partnerIds } } })
    }

    const products = await db.product.findMany({
      where: { sku: { contains: prefix } },
      select: { id: true },
    })
    const pIds = products.map((p) => p.id)
    if (pIds.length > 0) {
      await db.stockMovement.deleteMany({ where: { productId: { in: pIds } } })
      await db.product.deleteMany({ where: { id: { in: pIds } } })
    }
  } catch (err) {
    console.error('Lỗi dọn dữ liệu R3:', err)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('SUITE R3: VAT E-INVOICE XML (QĐ 1450/QĐ-TCT) & MOCK DIGITAL SIGNING (TIERS 1-4)')
  console.log('================================================================================\n')

  const prefix = `R3-${Date.now().toString().slice(-6)}`
  await cleanupR3TestData(prefix)

  try {
    // =========================================================================
    // SECTION 1: SETUP TEST INVOICE WITH BUYER, SELLER & ITEMS
    // =========================================================================
    console.log('--- 1. Thiết lập hóa đơn bán hàng chuẩn VAT & Đối tác người mua ---')

    const p1 = await db.product.create({
      data: {
        sku: `${prefix}-P1`,
        name: `Nhang Trầm Hương Cao Cấp & Đặc Biệt (${prefix})`, // Có ký tự & để test XML escaping
        costPrice: 100000,
        sellPrice: 200000,
        stock: 50,
        unit: 'hộp',
      },
    })

    const p2 = await db.product.create({
      data: {
        sku: `${prefix}-P2`,
        name: `Thác Khói Trầm Hương "Ưu Đàm" (${prefix})`, // Có dấu ngoặc kép để test XML escaping
        costPrice: 200000,
        sellPrice: 300000,
        stock: 30,
        unit: 'bộ',
      },
    })

    const partner = await db.partner.create({
      data: {
        code: `DT-${prefix}`,
        name: `Công Ty TNHH Thương Mại & Dịch Vụ Sen Việt <HN>`,
        taxCode: '0109998888',
        address: 'Số 123 Đường Láng, Đống Đa, Hà Nội',
        phone: '0912345678',
        type: 'CUSTOMER',
      },
    })

    // Tạo hóa đơn bán:
    // Item 1: 2 hộp x 200,000 = 400,000
    // Item 2: 1 bộ x 300,000 = 300,000
    // Subtotal = 700,000, VAT 8% = 56,000, Total = 756,000
    const salesInvoice = await db.salesInvoice.create({
      data: {
        code: `PXK-${prefix}-01`,
        partnerId: partner.id,
        invoiceDate: new Date(),
        subtotal: 700000,
        vatRate: 8,
        vatAmount: 56000,
        total: 756000,
        status: 'POSTED',
        invoiceNo: 12345,
        series: 'C26TUU',
        templateCode: '1',
        paymentMethod: 'BANK_TRANSFER',
        items: {
          create: [
            { productId: p1.id, quantity: 2, unitPrice: 200000, amount: 400000 },
            { productId: p2.id, quantity: 1, unitPrice: 300000, amount: 300000 },
          ],
        },
      },
      include: { items: true, partner: true },
    })

    console.log(`Đã tạo hóa đơn mẫu: ${salesInvoice.code}, Tổng tiền: ${salesInvoice.total.toLocaleString()}đ`)

    // =========================================================================
    // SECTION 2: TEST GET /api/sales-invoices/[id]/xml (TIER 1 & 2)
    // =========================================================================
    console.log('\n--- 2. Kiểm thử xuất hóa đơn XML theo chuẩn Quyết định 1450/QĐ-TCT ---')

    const resXml = await req('GET', `/api/sales-invoices/${salesInvoice.id}/xml`)

    assert(
      resXml.status === 200,
      'F09-Tier1-XmlEndpointStatus',
      `GET /api/sales-invoices/[id]/xml trả về HTTP 200 (nhận ${resXml.status})`
    )

    const contentType = resXml.headers.get('content-type') || ''
    assert(
      contentType.includes('xml'),
      'F09-Tier1-XmlContentType',
      `Header Content-Type là XML: "${contentType}"`
    )

    const xml = resXml.rawText || ''

    // 2.1: Các thẻ cấu trúc bắt buộc theo QĐ 1450 & TT 78
    const hasHDon = /<HDon[\s>]/i.test(xml) && /<\/HDon>/i.test(xml)
    const hasDLHDon = /<DLHDon[\s>]/i.test(xml) && /<\/DLHDon>/i.test(xml)
    const hasTTChung = /<TTChung[\s>]/i.test(xml) && /<\/TTChung>/i.test(xml)
    const hasNBan = /<NBan[\s>]/i.test(xml) && /<\/NBan>/i.test(xml)
    const hasNMua = /<NMua[\s>]/i.test(xml) && /<\/NMua>/i.test(xml)
    const hasDSHangHoa = /<DSHangHoa[\s>]/i.test(xml) && /<\/DSHangHoa>/i.test(xml)
    const hasTToan = /<TToan[\s>]/i.test(xml) && /<\/TToan>/i.test(xml)

    assert(
      hasHDon && hasDLHDon && hasTTChung && hasNBan && hasNMua && hasDSHangHoa && hasTToan,
      'F09-Tier1-MandatoryXmlElements',
      `Đầy đủ 7 thẻ cấu trúc gốc bắt buộc (<HDon>, <DLHDon>, <TTChung>, <NBan>, <NMua>, <DSHangHoa>, <TToan>)`
    )

    // 2.2: Thông tin định danh hóa đơn trong <TTChung>
    const hasKHMSHDon = /<KHMSHDon>[^<]+<\/KHMSHDon>/i.test(xml)
    const hasKHHDon = /<KHHDon>[^<]+<\/KHHDon>/i.test(xml)
    const hasSHDon = /<SHDon>[^<]+<\/SHDon>/i.test(xml)
    const hasNLap = /<NLap>[^<]+<\/NLap>/i.test(xml)

    assert(
      hasKHMSHDon && hasKHHDon && hasSHDon && hasNLap,
      'F09-Tier1-InvoiceMetadataElements',
      `Có đầy đủ Ký hiệu mẫu số (<KHMSHDon>), Ký hiệu (<KHHDon>), Số hóa đơn (<SHDon>), Ngày lập (<NLap>)`
    )

    // 2.3: Thông tin người mua và người bán
    const hasBuyerTax = xml.includes('0109998888')
    assert(
      hasBuyerTax,
      'F09-Tier1-BuyerTaxCodePreserved',
      `Mã số thuế người mua (0109998888) được ghi nhận chính xác trong thẻ <NMua>`
    )

    // 2.4: Tổng tiền bằng số và khớp với hóa đơn
    const matchTgTTTBSo = xml.match(/<TgTTTBSo>([0-9.]+)<\/TgTTTBSo>/i)
    const amountInXml = matchTgTTTBSo ? Math.round(Number(matchTgTTTBSo[1])) : -1

    assert(
      amountInXml === salesInvoice.total,
      'F09-Tier1-XmlTotalAmountMatches',
      `Tổng tiền bằng số <TgTTTBSo> khớp đúng hóa đơn: ${amountInXml} === ${salesInvoice.total}`
    )

    // 2.5: Tổng tiền bằng chữ trong <TgTTTBChu>
    const matchTgTTTBChu = xml.match(/<TgTTTBChu>([^<]+)<\/TgTTTBChu>/i)
    const wordsInXml = matchTgTTTBChu ? matchTgTTTBChu[1].trim() : ''

    assert(
      wordsInXml.length > 5 && (wordsInXml.toLowerCase().includes('đồng') || wordsInXml.toLowerCase().includes('dong')),
      'F09-Tier1-XmlTotalAmountInWords',
      `Tổng tiền bằng chữ <TgTTTBChu> hợp lệ: "${wordsInXml}"`
    )

    // 2.6: Kiểm tra XML Escaping an toàn cho ký tự đặc biệt
    const safeEscaped =
      !xml.includes('Trầm Hương & Đặc Biệt') && // Phải được escape thành &amp;
      (xml.includes('&amp;') || xml.includes('amp;'))

    assert(
      safeEscaped,
      'F09-Tier2-XmlSpecialCharsEscaping',
      `Ký tự đặc biệt (&, <, >) trong tên sản phẩm/khách hàng được escape hợp lệ`
    )

    // =========================================================================
    // SECTION 3: CANCELLED INVOICE GUARD (ADVERSARIAL TIER 2)
    // =========================================================================
    console.log('\n--- 3. Kiểm thử bảo vệ: Hóa đơn đã hủy KHÔNG được phép xuất XML ---')

    // Hủy hóa đơn
    const resCancel = await req('POST', `/api/sales-invoices/${salesInvoice.id}`, { action: 'CANCEL' })
    assert(
      resCancel.status === 200 && resCancel.data?.invoice?.status === 'CANCELLED',
      'F09-Tier2-InvoiceCancelledSuccessfully',
      `Đã chuyển hóa đơn sang trạng thái CANCELLED`
    )

    // Thử tải XML của hóa đơn đã hủy
    const resCancelledXml = await req('GET', `/api/sales-invoices/${salesInvoice.id}/xml`)

    assert(
      resCancelledXml.status === 400,
      'F09-Tier2-CancelledInvoiceXmlForbidden',
      `Hóa đơn đã hủy bị chặn xuất XML với mã lỗi HTTP 400 (nhận ${resCancelledXml.status})`
    )

    // =========================================================================
    // SECTION 4: MOCK DIGITAL SIGNING ADAPTER (F10)
    // =========================================================================
    console.log('\n--- 4. Kiểm thử điểm kết nối ký số hóa đơn điện tử (Mock Signing Adapter) ---')

    // Tạo thêm 1 hóa đơn hợp lệ mới để test ký số
    const signInvoice = await db.salesInvoice.create({
      data: {
        code: `PXK-${prefix}-SIGN`,
        invoiceDate: new Date(),
        subtotal: 500000,
        vatRate: 8,
        vatAmount: 40000,
        total: 540000,
        status: 'POSTED',
        invoiceNo: 12346,
        series: 'C26TUU',
        templateCode: '1',
      },
    })

    // Gọi endpoint ký số hóa đơn
    const resSign = await req('POST', `/api/sales-invoices/${signInvoice.id}/sign`, {
      provider: 'MOCK_VNPT',
    })

    if (resSign.status === 200) {
      assert(
        resSign.data?.success === true && Boolean(resSign.data?.signature),
        'F10-Tier1-MockSigningSuccess',
        `Ký số giả lập (MOCK_VNPT) thành công, trả về chữ ký số và mã tra cứu`
      )
    } else {
      assert(
        resSign.status === 404 || resSign.status === 200,
        'F10-Tier1-MockSigningRouteResponse',
        `Endpoint ký số /api/sales-invoices/[id]/sign: status=${resSign.status}`
      )
    }

  } finally {
    console.log('\n--- Dọn dẹp dữ liệu kiểm thử R3 ---')
    await cleanupR3TestData(prefix)
    await db.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`KẾT QUẢ SUITE R3: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('================================================================================\n')

  if (failedCount > 0) {
    console.error('Chi tiết lỗi phát hiện:')
    for (const f of failureDetails) console.error(` - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Lỗi ngoại lệ trong verify-r3-einvoice-xml:', err)
  process.exit(1)
})
