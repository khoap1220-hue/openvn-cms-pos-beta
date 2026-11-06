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

async function cleanupR4TestData(prefix: string) {
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
      await db.bomComponent.deleteMany({
        where: { OR: [{ productId: { in: pIds } }, { componentProductId: { in: pIds } }] },
      })
      await db.stockMovement.deleteMany({ where: { productId: { in: pIds } } })
      await db.channelListing.deleteMany({ where: { productId: { in: pIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: pIds } } })
      await db.product.deleteMany({ where: { id: { in: pIds } } })
    }
  } catch (err) {
    console.error('Lỗi dọn dữ liệu R4:', err)
  }
}

async function main() {
  console.log('================================================================================')
  console.log('SUITE R4: PRODUCT CATALOG CSV/EXCEL IMPORT/EXPORT & VALIDATION (TIERS 1-4)')
  console.log('================================================================================\n')

  const prefix = `R4-${Date.now().toString().slice(-6)}`
  await cleanupR4TestData(prefix)

  try {
    // =========================================================================
    // SECTION 1: EXPORT CSV VERIFICATION (F12)
    // =========================================================================
    console.log('--- 1. Kiểm thử xuất danh mục sản phẩm CSV (GET /api/products/export) ---')

    // Tạo sẵn 2 sản phẩm mẫu tiếng Việt có dấu, giá đặc thù
    const sampleSku1 = `${prefix}-EXP1`
    const sampleSku2 = `${prefix}-EXP2`

    await db.product.create({
      data: {
        sku: sampleSku1,
        name: `Nụ Trầm Hương Thượng Uyển (${prefix})`,
        costPrice: 45000,
        sellPrice: 150000,
        stock: 25,
        unit: 'hộp',
        status: 'ACTIVE',
        type: 'SIMPLE',
      },
    })

    await db.product.create({
      data: {
        sku: sampleSku2,
        name: `Trầm Ổ Đốt Xông Trầm Ưu Đàm (${prefix})`,
        costPrice: 85000,
        sellPrice: 220000,
        stock: 12,
        unit: 'bộ',
        status: 'ACTIVE',
        type: 'SIMPLE',
      },
    })

    const resExport = await req('GET', '/api/products/export')

    assert(
      resExport.status === 200,
      'F12-Tier1-ExportEndpointStatus',
      `GET /api/products/export phản hồi HTTP 200 (nhận ${resExport.status})`
    )

    const csvText = resExport.rawText || ''

    // 1.1: Kiểm tra UTF-8 BOM cho Excel Việt Nam
    const hasUtf8Bom = csvText.startsWith('\uFEFF') || csvText.charCodeAt(0) === 0xfeff
    assert(
      hasUtf8Bom,
      'F12-Tier1-ExportUtf8Bom',
      `File CSV có tiền tố UTF-8 BOM (\\uFEFF) giúp mở tiếng Việt không lỗi font trên Excel`
    )

    // 1.2: Tiêu đề cột chuẩn
    const lines = csvText.replace(/^\uFEFF/, '').trim().split('\n')
    const headerLine = lines[0] || ''
    const requiredColumns = ['sku', 'name', 'costPrice', 'sellPrice', 'stock']
    const hasAllCols = requiredColumns.every((col) => headerLine.toLowerCase().includes(col.toLowerCase()))

    assert(
      hasAllCols,
      'F12-Tier1-ExportHeaderColumns',
      `Header CSV chứa đầy đủ các cột bắt buộc: ${requiredColumns.join(', ')}`
    )

    // 1.3: Dữ liệu sản phẩm mẫu có mặt trong CSV
    const containsSample1 = csvText.includes(sampleSku1) && csvText.includes('150000')
    const containsSample2 = csvText.includes(sampleSku2) && csvText.includes('220000')

    assert(
      containsSample1 && containsSample2,
      'F12-Tier1-ExportDataMatchesDatabase',
      `Dữ liệu sản phẩm mẫu xuất ra CSV đầy đủ và khớp giá bán trong CSDL`
    )

    // =========================================================================
    // SECTION 2: ROUND-TRIP EXPORT -> RE-IMPORT PRESERVATION (F12 + F13)
    // =========================================================================
    console.log('\n--- 2. Kiểm thử bảo toàn Round-Trip: Xuất -> Nhập lại dữ liệu nguyên vẹn ---')

    // Dùng file CSV vừa xuất, gọi POST /api/products/import
    const resReimport = await req('POST', '/api/products/import', { csv: csvText })

    assert(
      resReimport.status === 200 && resReimport.data?.success === true,
      'F13-Tier1-RoundTripReimportStatus',
      `Nhập lại toàn bộ file CSV xuất khẩu thành công (HTTP ${resReimport.status})`
    )

    // Kiểm tra dữ liệu sau khi re-import: Giá và tồn kho vẫn giữ nguyên
    const p1After = await db.product.findUnique({ where: { sku: sampleSku1 } })
    const p2After = await db.product.findUnique({ where: { sku: sampleSku2 } })

    assert(
      p1After?.sellPrice === 150000 &&
        p1After?.costPrice === 45000 &&
        p2After?.sellPrice === 220000 &&
        p2After?.costPrice === 85000,
      'F13-Tier1-RoundTripDataIntegrity',
      `Dữ liệu và giá bán sau round-trip xuất -> nhập lại hoàn toàn giống hệt 100%`
    )

    // =========================================================================
    // SECTION 3: LINE-BY-LINE ERROR REPORTING FOR N INVALID ROWS (F13 TIER 2)
    // =========================================================================
    console.log('\n--- 3. Kiểm thử báo lỗi chi tiết theo từng dòng cho file có N dòng lỗi ---')

    // Chuẩn bị 1 file CSV có header + 1 dòng hợp lệ + đúng 5 dòng lỗi cụ thể:
    // Dòng 2: Hợp lệ
    // Dòng 3 (Lỗi 1): Thiếu SKU (sku rỗng)
    // Dòng 4 (Lỗi 2): Giá bán âm (sellPrice = -50000)
    // Dòng 5 (Lỗi 3): Giá vốn âm (costPrice = -10000)
    // Dòng 6 (Lỗi 4): Thiếu tên sản phẩm (name rỗng)
    // Dòng 7 (Lỗi 5): Loại sản phẩm không hợp lệ (type = 'ALIEN_SPACESHIP')
    const invalidBatchSkuValid = `${prefix}-VALID-ROW`
    const invalidBatchCsv = `\uFEFFsku,name,costPrice,sellPrice,stock,unit,type
${invalidBatchSkuValid},Sản Phẩm Hợp Lệ Hàng Đầu,50000,100000,20,sp,SIMPLE
,Sản Phẩm Thiếu SKU,40000,80000,10,sp,SIMPLE
${prefix}-ERR-NEGSELL,Sản Phẩm Giá Bán Âm,40000,-50000,10,sp,SIMPLE
${prefix}-ERR-NEGCOST,Sản Phẩm Giá Vốn Âm,-10000,80000,10,sp,SIMPLE
${prefix}-ERR-NONAME,,40000,80000,10,sp,SIMPLE
${prefix}-ERR-BADTYPE,Sản Phẩm Sai Loại,40000,80000,10,sp,ALIEN_SPACESHIP`

    const resImportErrors = await req('POST', '/api/products/import', { csv: invalidBatchCsv })

    // Phải trả về mã lỗi 422 Unprocessable Entity (hoặc 400 Bad Request)
    assert(
      resImportErrors.status === 422 || resImportErrors.status === 400,
      'F13-Tier2-InvalidBatchReturnsErrorCode',
      `File có dòng lỗi trả về HTTP ${resImportErrors.status} (Unprocessable Entity)`
    )

    const errorData = resImportErrors.data || {}
    const errorsList: Array<{ row: number; sku?: string; field?: string; message: string }> =
      errorData.errors || []

    // 3.1: Đúng chính xác N = 5 lỗi
    assert(
      errorData.totalErrors === 5 || errorsList.length === 5,
      'F13-Tier2-ExactErrorCountN',
      `Báo cáo đúng chính xác N=5 dòng lỗi (nhận totalErrors=${errorData.totalErrors}, length=${errorsList.length})`
    )

    // 3.2: Có đánh số dòng tương ứng từng lỗi
    const errorRows = errorsList.map((e) => e.row).sort((a, b) => a - b)
    const hasRowNumbers = errorRows.length > 0 && errorRows.every((r) => typeof r === 'number' && r >= 2)

    assert(
      hasRowNumbers,
      'F13-Tier2-LineNumberedErrors',
      `Mỗi lỗi đều gắn kèm số dòng cụ thể trong file: [${errorRows.join(', ')}]`
    )

    // =========================================================================
    // SECTION 4: ATOMIC ROLLBACK / ZERO CORRUPTED DATA WRITTEN (R7 & F13)
    // =========================================================================
    console.log('\n--- 4. Kiểm thử tính nguyên tử (Atomic Rollback): Không ghi dữ liệu hỏng vào DB ---')

    // Kiểm tra dòng hợp lệ (invalidBatchSkuValid) có bị ghi vào DB khi cả file bị lỗi không
    const validRowInDb = await db.product.findUnique({ where: { sku: invalidBatchSkuValid } })
    const errSellInDb = await db.product.findUnique({ where: { sku: `${prefix}-ERR-NEGSELL` } })

    assert(
      validRowInDb === null && errSellInDb === null,
      'F13-Tier3-AtomicRollbackNoCorruption',
      `Tính nguyên tử bảo đảm: Khi file có lỗi, không ghi dữ liệu rác hay dữ liệu dở dang vào DB (validRowInDb=${Boolean(validRowInDb)})`
    )

  } finally {
    console.log('\n--- Dọn dẹp dữ liệu kiểm thử R4 ---')
    await cleanupR4TestData(prefix)
    await db.$disconnect()
  }

  console.log('\n================================================================================')
  console.log(`KẾT QUẢ SUITE R4: ${passedCount} PASS, ${failedCount} FAIL`)
  console.log('================================================================================\n')

  if (failedCount > 0) {
    console.error('Chi tiết lỗi phát hiện:')
    for (const f of failureDetails) console.error(` - ${f}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Lỗi ngoại lệ trong verify-r4-catalog-csv-excel:', err)
  process.exit(1)
})
