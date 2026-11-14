// Bộ lọc nhận diện bản ghi kiểm thử tổng hợp (synthetic test artifacts).
// Dùng chung giữa Sổ Data (test-guard) và Autopilot Engine (agent-engine)
// để tránh trùng lặp logic và đảm bảo Autopilot không can thiệp vào dữ liệu E2E đang test.

const SYNTHETIC_SKU_PREFIXES = [
  'SP-TEST-',
  'QA-',
  'TEST-',
  'R1-',
  'R2-',
  'R3-',
  'R4-',
  'R5-',
  'T-COMPA-',
  'T-COMPB-',
  'T-COMBO-',
  'UD-SYN-',
  'UD-EXTREME',
  'UD-CHALLENGE',
  'CSV-TEST-',
  'VALID-ROW',
] as const

const SYNTHETIC_SKU_SUBSTRINGS = [
  '[QA',
  '[TEST',
  'ERR-NEGSELL',
  'ERR-NEGCOST',
  'ERR-NONAME',
  'ERR-BADTYPE',
] as const

const SYNTHETIC_PRODUCT_NAME_SUBSTRINGS = [
  '[QA',
  '[TEST',
  'KIỂM ĐỊNH',
  'THỬ NGHIỆM',
  'PRE-DEDUCTED',
] as const

const DUMMY_PHONES = new Set([
  '0900111222',
  '0900111333',
  '0911222333',
  '0900888777',
  '0900666555',
  '0999888777',
  '0909888777',
  '0912345678',
  '0900000000',
])

const SYNTHETIC_PHONE_PREFIXES = ['0900', '097999', '098888'] as const

const SYNTHETIC_ORDER_CODE_PREFIXES = [
  'DH-R1-',
  'DH-R2-',
  'DH-R3-',
  'DH-R4-',
  'DH-R5-',
  'DH-TEST-',
  'ORD-R1-',
  'ORD-R2-',
  'ORD-TEST-',
  'TEST-',
  'QA-',
  'DH-K80-TEST',
] as const

const SYNTHETIC_ORDER_NOTE_SUBSTRINGS = [
  '[TEST',
  '[QA',
  'R2_TEST',
  'TEST_',
  'PRE-DEDUCTION',
  'KIỂM ĐỊNH',
  'TEST R1',
  'TEST R2',
] as const

const SYNTHETIC_CUSTOMER_NAME_SUBSTRINGS = [
  'KIỂM ĐỊNH',
  'QA KHÁCH',
  'HỘI VIÊN TEST',
  'KHÁCH THỬ NGHIỆM',
  'NGƯỜI MUA ALPHA',
  'NGƯỜI MUA BETA',
  'KHÁCH SHOPEE #',
  'KHÁCH HỦY TRƯỚC KHI SYNC',
  'KHÁCH TEST',
  'KHÁCH VẬN ĐƠN',
  'KHÁCH SHOPEE ADV',
] as const

export interface SyntheticOrderLike {
  code?: string | null
  note?: string | null
  customer?: {
    name?: string | null
    phone?: string | null
  } | null
  items?: Array<{
    product?: {
      sku?: string | null
      name?: string | null
    } | null
  }> | null
}

/** Kiểm tra mã SKU có thuộc bộ dữ liệu kiểm thử tự động hay không. */
export function isSyntheticSku(sku: unknown, protectedSkus?: ReadonlySet<string>): boolean {
  if (!sku || typeof sku !== 'string') return false
  const normalized = sku.trim().toUpperCase()
  if (protectedSkus?.has(normalized)) return false
  return (
    SYNTHETIC_SKU_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    SYNTHETIC_SKU_SUBSTRINGS.some((token) => normalized.includes(token))
  )
}

/** Kiểm tra số điện thoại có phải số giả lập dùng trong test E2E hay không. */
export function isSyntheticPhone(phone: unknown): boolean {
  if (!phone || typeof phone !== 'string') return false
  const trimmed = phone.trim()
  return (
    DUMMY_PHONES.has(trimmed) ||
    SYNTHETIC_PHONE_PREFIXES.some((prefix) => trimmed.startsWith(prefix))
  )
}

/** Kiểm tra tên khách hàng có thuộc nhóm khách giả lập kiểm thử hay không. */
export function isSyntheticCustomerName(name: unknown): boolean {
  if (!name || typeof name !== 'string') return false
  const upper = name.trim().toUpperCase()
  return SYNTHETIC_CUSTOMER_NAME_SUBSTRINGS.some((token) => upper.includes(token))
}

/** Kiểm tra đơn hàng có phải artifact kiểm thử tự động (theo mã, ghi chú, khách hoặc SKU) hay không. */
export function isSyntheticOrder(
  order: SyntheticOrderLike | null | undefined,
  options?: { protectedOrderCodes?: ReadonlySet<string>; protectedSkus?: ReadonlySet<string> }
): boolean {
  if (!order) return false
  const code = (order.code ?? '').trim().toUpperCase()
  if (code && options?.protectedOrderCodes?.has(code)) return false

  if (
    code &&
    (SYNTHETIC_ORDER_CODE_PREFIXES.some((prefix) => code.startsWith(prefix)) ||
      code.includes('-TEST-') ||
      code.includes('SYNTHETIC') ||
      code.includes('CHALLENGE'))
  ) {
    return true
  }

  const note = (order.note ?? '').toUpperCase()
  if (note && SYNTHETIC_ORDER_NOTE_SUBSTRINGS.some((token) => note.includes(token))) {
    return true
  }

  if (order.customer) {
    if (isSyntheticPhone(order.customer.phone) || isSyntheticCustomerName(order.customer.name)) {
      return true
    }
  }

  if (order.items?.length) {
    for (const item of order.items) {
      const prod = item.product
      if (!prod) continue
      if (isSyntheticSku(prod.sku, options?.protectedSkus)) return true
      const pName = (prod.name ?? '').toUpperCase()
      if (pName && SYNTHETIC_PRODUCT_NAME_SUBSTRINGS.some((token) => pName.includes(token))) {
        return true
      }
    }
  }

  return false
}
