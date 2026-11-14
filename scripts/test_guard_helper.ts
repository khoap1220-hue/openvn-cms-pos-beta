/**
 * scripts/test_guard_helper.ts
 *
 * UNIFIED TEST-GUARD HELPER MODULE — OPENVN · ƯU ĐÀM SUITE
 * Tuân thủ nghiêm ngặt điều kiện R2 (ORIGINAL_REQUEST.md):
 * - SNAPSHOT trước kiểm thử
 * - RESTORE_AND_CLEAN ngay sau kiểm thử
 * - Đảm bảo Delta = 0 trên 18 sản phẩm thật của shop thaimy1605
 * - Chống crash / ngắt đột ngột bằng Hook an toàn đa tầng
 */

import { execSync } from 'node:child_process'

// ============================================================================
// 1. CÁC HẰNG SỐ & BẢNG THAM CHIẾU THẨM QUYỀN
// ============================================================================

export const DEFAULT_BASE_URL = (process.env.TEST_BASE_URL || 'http://127.0.0.1:3010').trim()
export const DEFAULT_TIMEOUT_MS = 120000 // 120s cho các thao tác Supabase qua mạng
export const DEFAULT_CENTRAL_WAREHOUSE_ID = 'cmvnybfk10004veegeksmstwz'

export interface AuthoritativeProduct {
  sku: string
  id: string
  stock: number
  sellPrice: number
  costPrice: number
  name: string
}

export const AUTHORITATIVE_13_PRODUCTS: readonly AuthoritativeProduct[] = [
  {
    sku: 'BM-DEC-LAMA-LUN',
    id: 'cmw6jt82b002hvedgdzf7wxnd',
    stock: 0,
    sellPrice: 65000,
    costPrice: 29250,
    name: 'Hũ Thạch Cao Xi Măng Vân Sọc Có Nắp Chóp, Đựng Đồ Trang Sức, Phụ Kiện, Đổ Nến Decor - Bơ Mộc',
  },
  {
    sku: 'BM-DEC-SEN-KEM',
    id: 'cmw6m4nuf0033velo2urrcxfw',
    stock: 0,
    sellPrice: 50000,
    costPrice: 22500,
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Kem Bơ',
  },
  {
    sku: 'BM-DEC-SEN-TRANG',
    id: 'cmw6m4qpl003dvelog1xj3oae',
    stock: 0,
    sellPrice: 50000,
    costPrice: 22500,
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Trắng mộc',
  },
  {
    sku: 'BM-DEC-SEN-XANHSAGE',
    id: 'cmw6m4kxi002tvelohordb5zu',
    stock: 0,
    sellPrice: 50000,
    costPrice: 22500,
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Xanh Sage',
  },
  {
    sku: 'BM-DEC-VAT-BACAU-CAM',
    id: 'cmw6m4zdf0047velo5jmacnn5',
    stock: 0,
    sellPrice: 85000,
    costPrice: 38250,
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Cốc Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộ — Phân loại: Cam',
  },
  {
    sku: 'BM-DEC-VAT-BACAU-TRANG',
    id: 'cmw6m4tk3003nvelorlzhibs2',
    stock: 0,
    sellPrice: 85000,
    costPrice: 38250,
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Cốc Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộ — Phân loại: Trắng',
  },
  {
    sku: 'BM-DEC-VAT-BACAU-VANG',
    id: 'cmw6m4wh4003xveloqlyfl619',
    stock: 0,
    sellPrice: 85000,
    costPrice: 38250,
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Cốc Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộ — Phân loại: Vàng',
  },
  {
    sku: 'BM-SEN-01-TRANG',
    id: 'cmw4r4cks000tveqgqrz0rxlf',
    stock: 0,
    sellPrice: 59000,
    costPrice: 25000,
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Trắng',
  },
  {
    sku: 'BM-SEN-01-VANG',
    id: 'cmw83kwhu002xveygxxa8sr85',
    stock: 0,
    sellPrice: 59000,
    costPrice: 26550,
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Vàng',
  },
  {
    sku: 'BM-SEN-01-NAU',
    id: 'cmw83ktaf002lveygdbwrh3g0',
    stock: 0,
    sellPrice: 59000,
    costPrice: 26550,
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Nâu',
  },
  {
    sku: 'BM-TEA-10',
    id: 'cmw4s4s5u000jvegolc1atjvl',
    stock: 0,
    sellPrice: 59000,
    costPrice: 25000,
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 10 viên',
  },
  {
    sku: 'BM-TEA-100',
    id: 'cmw4rj5ts000nvez49mu7b1zt',
    stock: 0,
    sellPrice: 289000,
    costPrice: 121380,
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 100 viên',
  },
  {
    sku: 'BM-TEA-50',
    id: 'cmw4rj3g6000cvez4n2geiqqc',
    stock: 0,
    sellPrice: 169000,
    costPrice: 70980,
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 50 viên',
  },
  {
    sku: 'BM-DEC-LAMA-CAO',
    id: 'cmw7n6dfk0040ve74bpjhgynp',
    stock: 0,
    sellPrice: 79000,
    costPrice: 33180,
    name: 'Hũ Thạch Cao Xi Măng Vân Sọc Có Nắp Chóp, Đựng Đồ Trang Sức, Phụ Kiện, Đổ Nến Decor - Bơ Mộc — Phân loại: Trắng Vân Sọc Cao',
  },
  {
    sku: 'BM-DEC-COC-TRON',
    id: 'cmwbz3xj00003veqcpub40ldz',
    stock: 0,
    sellPrice: 79000,
    costPrice: 35550,
    name: 'Cốc Thạch Cao Xi Măng Trụ Trơn Đa Năng, Chịu Nhiệt Đổ Nến, Cắm Bút, Cọ Trang Điểm, Decor Bàn Làm Việc - Bơ Mộc',
  },
  {
    sku: 'BM-DEC-OVAL-DEN',
    id: 'cmwbz3zw4000bveqcip1y2334',
    stock: 0,
    sellPrice: 59000,
    costPrice: 26550,
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Đen',
  },
  {
    sku: 'BM-DEC-OVAL-BE',
    id: 'cmwbz428a000jveqcwlq0b45c',
    stock: 0,
    sellPrice: 59000,
    costPrice: 26550,
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Be',
  },
  {
    sku: 'BM-DEC-OVAL-TRANG',
    id: 'cmwbz44k4000rveqc9zs51chz',
    stock: 0,
    sellPrice: 59000,
    costPrice: 26550,
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Trắng',
  },
] as const

export const AUTHORITATIVE_TOTAL_STOCK = AUTHORITATIVE_13_PRODUCTS.reduce((sum, p) => sum + p.stock, 0)
export const AUTHORITATIVE_PRODUCT_COUNT = AUTHORITATIVE_13_PRODUCTS.length

// ============================================================================
// 2. TYPES VÀ INTERFACES
// ============================================================================

export interface SnapshotResponse {
  ok: boolean
  action: 'SNAPSHOT_CREATED'
  createdAt: string
  productCount: number
  message?: string
}

export interface RestoreCleanResponse {
  ok: boolean
  action: 'RESTORED_AND_CLEANED'
  restoredProductsCount: number
  removedTestArtifactsCount: number
  message?: string
}

export interface TestGuardStatusResponse {
  ok: boolean
  clean: boolean
  leftoverCount: number
  hasSnapshot: boolean
  snapshot: {
    createdAt: string
    productCount: number
  } | null
  breakdown: {
    products: number
    orders: number
    customers: number
    partners?: number
    salesInvoices?: number
    purchaseInvoices?: number
    campaigns: number
    vouchers: number
    socialPosts?: number
    socialPlans?: number
    contentSources?: number
    activities: number
    messages: number
    ledgers: number
    auditLogs?: number
    behaviorLogs?: number
    staffUsers?: number
    dlqSpool: number
  }
}

export interface ProductDelta {
  sku: string
  expectedStock: number
  actualStock: number
  stockDelta: number
  expectedPrice: number
  actualPrice: number
  priceDelta: number
  status: 'MATCH' | 'MISMATCH' | 'MISSING'
}

export interface InvariantAuditResult {
  passed: boolean
  expectedCount: number
  actualCount: number
  deltaCount: number
  totalExpectedStock: number
  totalActualStock: number
  deltas: ProductDelta[]
  summary: string
}

export interface HelperOptions {
  baseUrl?: string
  timeoutMs?: number
  silent?: boolean
}

// ============================================================================
// 3. CORE API CLIENT FUNCTIONS (NETWORK-RESILIENT TIMEOUT)
// ============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    return res
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 1. Chụp ảnh đóng băng trạng thái trước khi test (action: 'SNAPSHOT')
 */
export async function takeSnapshot(
  options: HelperOptions & { autoCleanFirst?: boolean } = {}
): Promise<SnapshotResponse> {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS

  if (options.autoCleanFirst !== false) {
    try {
      const statusRes = await fetchWithTimeout(
        `${baseUrl}/api/ledger/test-guard`,
        { method: 'GET' },
        15000
      )
      if (statusRes.ok) {
        const statusJson = (await statusRes.json()) as TestGuardStatusResponse
        if (!statusJson.clean || statusJson.leftoverCount > 0) {
          if (!options.silent) {
            console.log(
              `[TEST GUARD] Phát hiện ${statusJson.leftoverCount} bản ghi rác từ phiên test trước, đang tự động dọn dẹp...`
            )
          }
          await restoreAndClean({ baseUrl, timeoutMs, silent: true })
        }
      }
    } catch {
      // Bỏ qua lỗi pre-flight nếu server đang khởi động
    }
  }

  const res = await fetchWithTimeout(
    `${baseUrl}/api/ledger/test-guard`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'SNAPSHOT' }),
    },
    timeoutMs
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`[TEST GUARD] takeSnapshot failed with HTTP ${res.status}: ${errText}`)
  }

  const json = (await res.json()) as SnapshotResponse
  if (!json.ok || json.action !== 'SNAPSHOT_CREATED') {
    throw new Error(`[TEST GUARD] takeSnapshot returned invalid payload: ${JSON.stringify(json)}`)
  }

  if (!options.silent) {
    console.log(
      `📸 [TEST GUARD] Snapshot thành công: Đã đóng băng ${json.productCount} sản phẩm thật lúc ${json.createdAt}`
    )
  }

  return json
}

/**
 * 2. Phục hồi nguyên trạng và dọn sạch dữ liệu test (action: 'RESTORE_AND_CLEAN')
 */
export async function restoreAndClean(
  options: HelperOptions = {}
): Promise<RestoreCleanResponse> {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS

  const res = await fetchWithTimeout(
    `${baseUrl}/api/ledger/test-guard`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }),
    },
    timeoutMs
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`[TEST GUARD] restoreAndClean failed with HTTP ${res.status}: ${errText}`)
  }

  const json = (await res.json()) as RestoreCleanResponse
  if (!json.ok || json.action !== 'RESTORED_AND_CLEANED') {
    throw new Error(`[TEST GUARD] restoreAndClean returned invalid payload: ${JSON.stringify(json)}`)
  }

  if (!options.silent) {
    console.log(
      `🧹 [TEST GUARD] Hoàn tất phục hồi: Khôi phục ${json.restoredProductsCount} sản phẩm, dọn sạch ${json.removedTestArtifactsCount} bản ghi rác.`
    )
  }

  return json
}

/**
 * 3. Kiểm tra khẳng định hệ sinh thái sạch 100% (clean: true, leftoverCount: 0)
 */
export async function verifyCleanState(
  options: HelperOptions = {}
): Promise<TestGuardStatusResponse> {
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const timeoutMs = options.timeoutMs || 15000

  let res = await fetchWithTimeout(
    `${baseUrl}/api/ledger/test-guard`,
    { method: 'GET' },
    timeoutMs
  )

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`[TEST GUARD] verifyCleanState failed with HTTP ${res.status}: ${errText}`)
  }

  let json = (await res.json()) as TestGuardStatusResponse
  if (!json.clean || json.leftoverCount > 0) {
    // Cho phép 800ms để các background task AI (Zalo auto-reply, confirm order) ổn định rồi kiểm tra lại
    await new Promise((r) => setTimeout(r, 800))
    res = await fetchWithTimeout(`${baseUrl}/api/ledger/test-guard`, { method: 'GET' }, timeoutMs)
    if (res.ok) {
      json = (await res.json()) as TestGuardStatusResponse
    }
  }

  if (!json.clean || json.leftoverCount > 0) {
    const breakdownStr = JSON.stringify(json.breakdown)
    throw new Error(
      `[TEST GUARD VIOLATION] Dữ liệu CSDL chưa sạch tuyệt đối! Leftover count: ${json.leftoverCount}. Chi tiết: ${breakdownStr}`
    )
  }

  if (!options.silent) {
    console.log(`✨ [TEST GUARD] Xác nhận dữ liệu sạch 100% (clean=true, leftoverCount=0).`)
  }

  return json
}

// ============================================================================
// 4. KIỂM TOÁN BẤT BIẾN SẢN PHẨM THẬT (DELTA = 0)
// ============================================================================

/**
 * 4. Kiểm toán bất biến sản phẩm chuẩn của shop thaimy1605 (Stock Delta = 0, Price Delta = 0)
 */
export async function assert13RealProductsInvariant(
  dbOrBaseUrl?: any,
  options: { silent?: boolean } = {}
): Promise<InvariantAuditResult> {
  let productsList: Array<{ sku: string; stock: number; sellPrice: number }> = []

  // Nhánh 1: Truy vấn trực tiếp qua PrismaClient nếu được truyền vào
  if (dbOrBaseUrl && typeof dbOrBaseUrl.product?.findMany === 'function') {
    productsList = await dbOrBaseUrl.product.findMany({
      select: { sku: true, stock: true, sellPrice: true },
      orderBy: { sku: 'asc' },
    })
  } else {
    // Nhánh 2: Truy vấn qua REST API
    const baseUrl = typeof dbOrBaseUrl === 'string' ? dbOrBaseUrl : DEFAULT_BASE_URL
    const res = await fetchWithTimeout(`${baseUrl}/api/products`, { method: 'GET' }, 15000)
    if (!res.ok) {
      throw new Error(`[INVARIANT AUDIT] Không thể lấy danh sách sản phẩm qua API: HTTP ${res.status}`)
    }
    const data = await res.json()
    productsList = Array.isArray(data) ? data : data.products || []
  }

  const deltas: ProductDelta[] = []
  let passed = true

  if (productsList.length !== AUTHORITATIVE_13_PRODUCTS.length) {
    passed = false
  }

  let totalActualStock = 0

  for (const exp of AUTHORITATIVE_13_PRODUCTS) {
    const act = productsList.find((p) => p.sku === exp.sku)
    if (!act) {
      deltas.push({
        sku: exp.sku,
        expectedStock: exp.stock,
        actualStock: -1,
        stockDelta: -exp.stock,
        expectedPrice: exp.sellPrice,
        actualPrice: -1,
        priceDelta: -exp.sellPrice,
        status: 'MISSING',
      })
      passed = false
      continue
    }

    totalActualStock += act.stock
    const stockDelta = act.stock - exp.stock
    const priceDelta = act.sellPrice - exp.sellPrice
    const isMatch = stockDelta === 0 && priceDelta === 0

    if (!isMatch) passed = false

    deltas.push({
      sku: exp.sku,
      expectedStock: exp.stock,
      actualStock: act.stock,
      stockDelta,
      expectedPrice: exp.sellPrice,
      actualPrice: act.sellPrice,
      priceDelta,
      status: isMatch ? 'MATCH' : 'MISMATCH',
    })
  }

  const summary = `Kiểm toán ${AUTHORITATIVE_13_PRODUCTS.length} sản phẩm shop thaimy1605: ${
    passed ? 'ĐẠT 100% (DELTA = 0)' : 'VI PHẠM BẤT BIẾN'
  }`

  if (!options.silent) {
    if (passed) {
      console.log(
        `🛡️ [INVARIANT AUDIT] ${summary} — Tồn kho ${totalActualStock}/${AUTHORITATIVE_TOTAL_STOCK}, Giá bán chính xác ${AUTHORITATIVE_13_PRODUCTS.length}/${AUTHORITATIVE_13_PRODUCTS.length} SKU ✓`
      )
    } else {
      console.error(`❌ [INVARIANT AUDIT] ${summary}`)
      for (const d of deltas.filter((x) => x.status !== 'MATCH')) {
        console.error(
          `   - ${d.sku}: stockDelta=${d.stockDelta} (act=${d.actualStock}, exp=${d.expectedStock}), priceDelta=${d.priceDelta}`
        )
      }
    }
  }

  if (!passed) {
    throw new Error(`[INVARIANT ERROR] Dữ liệu ${AUTHORITATIVE_13_PRODUCTS.length} sản phẩm thật bị biến dạng sau kiểm thử! Delta != 0.`)
  }

  return {
    passed,
    expectedCount: AUTHORITATIVE_13_PRODUCTS.length,
    actualCount: productsList.length,
    deltaCount: productsList.length - AUTHORITATIVE_13_PRODUCTS.length,
    totalExpectedStock: AUTHORITATIVE_TOTAL_STOCK,
    totalActualStock,
    deltas,
    summary,
  }
}

// ============================================================================
// 5. HOOK PROTOCOL: CRASH-PROOF PROCESS & TEST HOOKS
// ============================================================================

export interface ProcessGuardOptions {
  baseUrl?: string
  timeoutMs?: number
  onCleanSuccess?: () => void
}

let isGlobalGuardRegistered = false
let isCleanedUp = false

/**
 * Đăng ký bộ lắng nghe sự kiện tiến trình đa tầng:
 * - process.on('exit'): Chạy fallback đồng bộ qua execSync
 * - process.on('SIGINT'): Chặn Ctrl+C, dọn dẹp async rồi thoát mã 130
 * - process.on('SIGTERM'): Dọn dẹp async rồi thoát mã 143
 * - process.on('uncaughtException'): Dọn dẹp async rồi thoát mã 1
 * - process.on('unhandledRejection'): Dọn dẹp async rồi thoát mã 1
 */
export function registerProcessGuard(options: ProcessGuardOptions = {}): () => void {
  if (isGlobalGuardRegistered) {
    return () => {}
  }
  isGlobalGuardRegistered = true
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL

  const doAsyncCleanupAndExit = async (reason: string, exitCode: number) => {
    if (isCleanedUp) process.exit(exitCode)
    isCleanedUp = true
    console.warn(`\n⚠️ [TEST GUARD PROCESS HOOK] Phát hiện sự kiện '${reason}'. Đang thực hiện dọn dẹp khẩn cấp...`)
    try {
      await restoreAndClean({ baseUrl, silent: false })
      if (options.onCleanSuccess) options.onCleanSuccess()
    } catch (err: any) {
      console.error(`❌ [TEST GUARD PROCESS HOOK] Dọn dẹp khẩn cấp thất bại: ${err.message}`)
    } finally {
      process.exit(exitCode)
    }
  }

  const sigintHandler = () => {
    doAsyncCleanupAndExit('SIGINT (Ctrl+C)', 130)
  }

  const sigtermHandler = () => {
    doAsyncCleanupAndExit('SIGTERM', 143)
  }

  const uncaughtHandler = (err: Error) => {
    console.error(`💥 [UNCAUGHT EXCEPTION]:`, err)
    doAsyncCleanupAndExit('uncaughtException', 1)
  }

  const unhandledHandler = (reason: any) => {
    console.error(`💥 [UNHANDLED REJECTION]:`, reason)
    doAsyncCleanupAndExit('unhandledRejection', 1)
  }

  // Fallback đồng bộ cuối cùng khi process.exit được gọi mà chưa kịp qua khối finally
  const exitHandler = () => {
    if (isCleanedUp) return
    isCleanedUp = true
    try {
      execSync(
        `curl -s -X POST ${baseUrl}/api/ledger/test-guard -H "Content-Type: application/json" -d "{\\"action\\":\\"RESTORE_AND_CLEAN\\"}"`,
        { timeout: 60000, stdio: 'ignore' }
      )
    } catch {
      // Bỏ qua lỗi trong exit handler
    }
  }

  process.on('SIGINT', sigintHandler)
  process.on('SIGTERM', sigtermHandler)
  process.on('uncaughtException', uncaughtHandler)
  process.on('unhandledRejection', unhandledHandler)
  process.on('exit', exitHandler)

  // Trả về hàm unregister để hủy đăng ký khi kết thúc
  return () => {
    process.removeListener('SIGINT', sigintHandler)
    process.removeListener('SIGTERM', sigtermHandler)
    process.removeListener('uncaughtException', uncaughtHandler)
    process.removeListener('unhandledRejection', unhandledHandler)
    process.removeListener('exit', exitHandler)
    isGlobalGuardRegistered = false
  }
}

/**
 * 6. Hàm bao bọc cấp cao (High-Order Test Runner)
 * Dành cho các tệp script độc lập như scripts/verify-*.ts
 */
export async function runGuardedSuite(
  suiteName: string,
  suiteFn: () => Promise<void>,
  options: HelperOptions = {}
): Promise<void> {
  console.log(`\n================================================================================`)
  console.log(`🛡️ KHỞI CHẠY BỘ KIỂM THỬ ĐƯỢC BẢO VỆ: ${suiteName}`)
  console.log(`================================================================================`)

  const unregisterHooks = registerProcessGuard(options)
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL
  const start = Date.now()

  try {
    // 1. Chụp Snapshot nguyên trạng (kèm tự động dọn rác cũ nếu có)
    await takeSnapshot({ baseUrl, autoCleanFirst: true })

    // 2. Thực thi kịch bản kiểm thử
    await suiteFn()

    console.log(`✅ [${suiteName}] Kiểm thử thành công!`)
  } finally {
    // 3. Khôi phục và dọn dẹp triệt để trong mọi trường hợp (PASS lẫn FAIL)
    try {
      await restoreAndClean({ baseUrl })
      await assert13RealProductsInvariant(baseUrl)
      await verifyCleanState({ baseUrl })
    } finally {
      unregisterHooks()
      const durationSec = ((Date.now() - start) / 1000).toFixed(2)
      console.log(`⏱️ Thời gian thực thi bộ test: ${durationSec}s`)
      console.log(`================================================================================\n`)
    }
  }
}

/**
 * 7. Adapter cho các khung kiểm thử tiêu chuẩn (Jest, Vitest, node:test)
 */
export function setupTestGuardHooks(options: HelperOptions = {}) {
  let unregister: (() => void) | null = null
  return {
    async beforeAll() {
      unregister = registerProcessGuard(options)
      await takeSnapshot({ ...options, autoCleanFirst: true })
    },
    async afterAll(dbInstance?: any) {
      try {
        await restoreAndClean(options)
        await assert13RealProductsInvariant(dbInstance || options.baseUrl)
        await verifyCleanState(options)
      } finally {
        if (unregister) unregister()
      }
    },
  }
}
