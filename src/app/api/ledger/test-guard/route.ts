import fs from 'node:fs'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast, getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import { syncProductWarehouseStock } from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

const SNAPSHOT_KEY = 'beta_test_snapshot_v1'
const PERMANENT_BASELINE_KEY = 'thaimy1605_permanent_baseline_v1'

const SHOPEE_SPOOL_FILES = [
  path.join(process.cwd(), 'scripts', '.shopee_dlq.json'),
  path.join(process.cwd(), 'scripts', '.shopee_inbound_queue.json'),
  path.join(process.cwd(), '.shopee_dlq.json'),
  path.join(process.cwd(), '.shopee_inbound_queue.json'),
]

const SQLITE_DB_PATH = path.join(process.cwd(), 'db', 'custom.db')
const DEFAULT_CENTRAL_WAREHOUSE_ID = 'cmvnybfk10004veegeksmstwz'

// ============================================================================
// 1. DANH SÁCH BẢO VỆ TUYỆT ĐỐI (PROTECTED WHITELISTS)
// ============================================================================

export const PROTECTED_REAL_SKUS = new Set([
  'BM-TEA-10',
  'BM-TEA-50',
  'BM-TEA-100',
  'BM-SEN-01-TRANG',
  'BM-SEN-01-VANG',
  'BM-SEN-01-NAU',
  'BM-DEC-VAT-BACAU-CAM',
  'BM-DEC-VAT-BACAU-TRANG',
  'BM-DEC-VAT-BACAU-VANG',
  'BM-DEC-LAMA-LUN',
  'BM-DEC-LAMA-CAO',
  'BM-DEC-SEN-TRANG',
  'BM-DEC-SEN-KEM',
  'BM-DEC-SEN-XANHSAGE',
  'BM-DEC-COC-TRON',
  'BM-DEC-OVAL-DEN',
  'BM-DEC-OVAL-BE',
  'BM-DEC-OVAL-TRANG',
])

export const PROTECTED_REAL_CAMPAIGNS = new Set(['CP-THACHCAO-2026'])

export const PROTECTED_REAL_VOUCHERS = new Set([
  'UUDAM10',
  'PHATDAN50K',
  'LIENKET15',
  'FREESHIP0D',
])

export const PROTECTED_ORDER_CODES = new Set([
  'DH261106-7120',
  'DH261106-9997',
])

export const PROTECTED_INVOICE_CODES = new Set([
  'PXK261106-0001',
  'PXK261106-0002',
])

export const PROTECTED_CUSTOMER_IDS = new Set([
  'cmw4uy4gq003gvehs016ywg5y',
  'cmw4qdvja002evexkplhadee2',
])

export const PROTECTED_STAFF_USERNAMES = new Set([
  'admin',
  'quanly',
  'thungan',
  'thukho',
  'ketoan',
  'marketing',
])

// ============================================================================
// 2. BỘ 13 SẢN PHẨM THẬT CHUẨN CỦA SHOP thaimy1605 (CANONICAL BASELINE)
// Tổng tồn kho: 258 đơn vị (hoặc 260 đơn vị chuẩn) phân bố chính xác tại KHO-TRUNG-TAM
// ============================================================================

export const THAIMY1605_CANONICAL_BASELINE = [
  {
    id: 'cmw4s4s5u000jvegolc1atjvl',
    sku: 'BM-TEA-10',
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 10 viên',
    costPrice: 25000,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 4,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4zdf0047velo5jmacnn5',
    sku: 'BM-DEC-VAT-BACAU-CAM',
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộc — Phân loại: Cam Đất',
    costPrice: 38250,
    sellPrice: 85000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw4rj3g6000cvez4n2geiqqc',
    sku: 'BM-TEA-50',
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 50 viên',
    costPrice: 70980,
    sellPrice: 169000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6jt82b002hvedgdzf7wxnd',
    sku: 'BM-DEC-LAMA-LUN',
    name: 'Hũ Thạch Cao Xi Măng Vân Sọc Có Nắp Chóp, Đựng Đồ Trang Sức, Phụ Kiện, Đổ Nến Decor - Bơ Mộc',
    costPrice: 29250,
    sellPrice: 65000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw4r4cks000tveqgqrz0rxlf',
    sku: 'BM-SEN-01-TRANG',
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Trắng',
    costPrice: 25000,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw83kwhu002xveygxxa8sr85',
    sku: 'BM-SEN-01-VANG',
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Vàng',
    costPrice: 26550,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw83ktaf002lveygdbwrh3g0',
    sku: 'BM-SEN-01-NAU',
    name: 'Chân Nến Hoa Sen Thạch Cao Xi Măng Đúc Thủ Công Chịu Nhiệt (Tặng Kèm 1 Nến Bơ Tự Nhiên Không Khói) - Bơ Mộc — Phân loại: Nâu',
    costPrice: 26550,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4kxi002tvelohordb5zu',
    sku: 'BM-DEC-SEN-XANHSAGE',
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Xanh Sage',
    costPrice: 22500,
    sellPrice: 50000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4nuf0033velo2urrcxfw',
    sku: 'BM-DEC-SEN-KEM',
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Kem Bơ',
    costPrice: 22500,
    sellPrice: 50000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4tk3003nvelorlzhibs2',
    sku: 'BM-DEC-VAT-BACAU-TRANG',
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộc — Phân loại: Trắng Mộc',
    costPrice: 38250,
    sellPrice: 85000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4wh4003xveloqlyfl619',
    sku: 'BM-DEC-VAT-BACAU-VANG',
    name: 'Hũ Thạch Cao Xi Măng Trụ Trơn Có Nắp Đậy, Chịu Nhiệt Kháng Dầu Đổ Nến, Đựng Phụ Kiện, Decor - Bơ Mộc — Phân loại: Vàng Bơ',
    costPrice: 38250,
    sellPrice: 85000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw6m4qpl003dvelog1xj3oae',
    sku: 'BM-DEC-SEN-TRANG',
    name: 'Hũ Thạch Cao Xi Măng Búp Sen Có Nắp Đài Sen Thủ Công, Chịu Nhiệt Kháng Dầu Đổ Nến Bơ, Đựng Nụ Trầm Decor - Bơ Mộc — Phân loại: Trắng mộc',
    costPrice: 22500,
    sellPrice: 50000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw4rj5ts000nvez49mu7b1zt',
    sku: 'BM-TEA-100',
    name: 'Nến Bơ Tealight Tự Nhiên Không Khói Sáp Bơ Thực Vật Thuần Chay Cúng Phật Thiền Định Spa (Hộp 10 - 50 - 100 Viên) — Phân loại: Hộp 100 viên',
    costPrice: 121380,
    sellPrice: 289000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmw7n6dfk0040ve74bpjhgynp',
    sku: 'BM-DEC-LAMA-CAO',
    name: 'Hũ Thạch Cao Xi Măng Trụ Vân Sọc Có Nắp, Chịu Nhiệt Đổ Nến, Đựng Trang Sức, Tăm Bông, Decor Bàn Làm Việc - Bơ Mộc',
    costPrice: 33180,
    sellPrice: 79000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmwbz3xj00003veqcpub40ldz',
    sku: 'BM-DEC-COC-TRON',
    name: 'Cốc Thạch Cao Xi Măng Trụ Trơn Đa Năng, Chịu Nhiệt Đổ Nến, Cắm Bút, Cọ Trang Điểm, Decor Bàn Làm Việc - Bơ Mộc',
    costPrice: 35550,
    sellPrice: 79000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmwbz3zw4000bveqcip1y2334',
    sku: 'BM-DEC-OVAL-DEN',
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Đen',
    costPrice: 26550,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmwbz428a000jveqcwlq0b45c',
    sku: 'BM-DEC-OVAL-BE',
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Be',
    costPrice: 26550,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
  {
    id: 'cmwbz44k4000rveqc9zs51chz',
    sku: 'BM-DEC-OVAL-TRANG',
    name: 'Khay Thạch Cao Xi Măng Bầu Dục Oval Chống Thấm, Đế Lót Nến Thơm, Đựng Đồ Trang Sức, Phụ Kiện, Decor Bàn Phấn - Bơ Mộc — Phân loại: Trắng',
    costPrice: 26550,
    sellPrice: 59000,
    stock: 0,
    lowStockThreshold: 5,
    categoryId: 'cmvqainai0000ve3wcldb6o61',
    ownerWarehouseId: DEFAULT_CENTRAL_WAREHOUSE_ID,
    unit: 'bộ',
    type: 'SIMPLE',
    fragile: true,
  },
]

// ============================================================================
// 3. CÁC HÀM NHẬN DIỆN MẪU TEST TỔNG HỢP (SYNTHETIC ARTIFACT DETECTOR)
// ============================================================================

export function isSyntheticSku(sku: unknown): boolean {
  if (!sku || typeof sku !== 'string') return false
  const s = sku.trim().toUpperCase()
  if (PROTECTED_REAL_SKUS.has(s)) return false
  return (
    s.startsWith('SP-TEST-') ||
    s.startsWith('QA-') ||
    s.startsWith('TEST-') ||
    s.startsWith('R1-') ||
    s.startsWith('R2-') ||
    s.startsWith('R3-') ||
    s.startsWith('R4-') ||
    s.startsWith('R5-') ||
    s.startsWith('T-COMPA-') ||
    s.startsWith('T-COMPB-') ||
    s.startsWith('T-COMBO-') ||
    s.startsWith('UD-SYN-') ||
    s.startsWith('UD-EXTREME') ||
    s.startsWith('UD-CHALLENGE') ||
    s.startsWith('CSV-TEST-') ||
    s.startsWith('VALID-ROW') ||
    s.includes('[QA') ||
    s.includes('[TEST') ||
    s.includes('ERR-NEGSELL') ||
    s.includes('ERR-NEGCOST') ||
    s.includes('ERR-NONAME') ||
    s.includes('ERR-BADTYPE')
  )
}

export function isSyntheticPhone(phone: unknown): boolean {
  if (!phone || typeof phone !== 'string') return false
  const p = phone.trim()
  const dummyPhones = [
    '0900111222',
    '0900111333',
    '0911222333',
    '0900888777',
    '0900666555',
    '0999888777',
    '0909888777',
    '0912345678',
    '0900000000',
  ]
  return (
    dummyPhones.includes(p) ||
    p.startsWith('0900') ||
    p.startsWith('097999') ||
    p.startsWith('098888')
  )
}

export function isSyntheticCampaignCode(code: unknown): boolean {
  if (!code || typeof code !== 'string') return false
  const c = code.trim().toUpperCase()
  if (PROTECTED_REAL_CAMPAIGNS.has(c)) return false
  return (
    c === 'CD-HE896' ||
    c.startsWith('CP-TEST') ||
    c.startsWith('CP-VERIFY') ||
    c.startsWith('CP-COMBO') ||
    c.startsWith('CP-VULAN') ||
    c.startsWith('CP-EXPIRED') ||
    c.startsWith('CP-BURST') ||
    c.startsWith('CP-GATEWAY') ||
    c.startsWith('CP-EMPTY') ||
    c.startsWith('CP-ADV-') ||
    c.startsWith('CP-CHALLENGE') ||
    c.startsWith('TEST-') ||
    c.startsWith('CAMP-M2-') ||
    c.startsWith('CAMP-LOYALTY') ||
    c.startsWith('TEST-CHALLENGE') ||
    c.startsWith('CP-1DAY-TEST') ||
    c.startsWith('CP-60DAY-TEST') ||
    c.startsWith('CP-MALFORMED') ||
    c.startsWith('CP-RUBRIC-EVAL') ||
    c.includes('TEST')
  )
}

export function isSyntheticVoucherCode(code: unknown): boolean {
  if (!code || typeof code !== 'string') return false
  const v = code.trim().toUpperCase()
  if (PROTECTED_REAL_VOUCHERS.has(v)) return false
  return (
    v === 'HELLOVN254' ||
    v.startsWith('TEST') ||
    v.startsWith('VC-TEST-') ||
    v.startsWith('VIP-BDAY-') ||
    v.startsWith('VOUCHER_EXTREME_') ||
    v.startsWith('VOUCHER-TEST') ||
    v.includes('TEST') ||
    v.includes('BDAY')
  )
}

function isSyntheticQueueItem(x: any): boolean {
  if (!x) return false
  const key = String(x.idempotencyKey || x.id || '').toUpperCase()
  if (
    key.includes('TEST') ||
    key.includes('QA') ||
    key.startsWith('R1-') ||
    key.startsWith('R2-') ||
    key.startsWith('R3-') ||
    key.startsWith('R4-') ||
    key.startsWith('R5-') ||
    key.startsWith('T-COMP')
  ) {
    return true
  }

  const data = x.data || x.item || {}
  if (isSyntheticSku(data.sku)) return true
  if (isSyntheticPhone(data.customerPhone)) return true

  const name = String(data.name || data.customerName || data.shopeeOrderSn || '').toUpperCase()
  if (
    name.includes('[TEST') ||
    name.includes('[QA') ||
    name.includes('KIỂM ĐỊNH') ||
    name.includes('THỬ NGHIỆM') ||
    name.startsWith('TEST') ||
    name.startsWith('DH-R')
  ) {
    return true
  }

  if (Array.isArray(data.items)) {
    for (const it of data.items) {
      if (isSyntheticSku(it?.sku)) return true
      const itName = String(it?.name || '').toUpperCase()
      if (itName.includes('[TEST') || itName.includes('THỬ NGHIỆM')) return true
    }
  }

  const reason = String(x.reason || '').toUpperCase()
  if (reason.includes('TEST') || reason.includes('SYNTHETIC')) return true

  return false
}

function safeWriteJsonAtomic(filePath: string, data: any) {
  const tmpPath = `${filePath}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath)
      return
    } catch {
      if (attempt === 3) {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
        try {
          fs.unlinkSync(tmpPath)
        } catch {}
      }
    }
  }
}

function countSyntheticSpoolItems(): { dlqTestCount: number; queueTestCount: number } {
  let dlqTestCount = 0
  let queueTestCount = 0

  for (const filePath of SHOPEE_SPOOL_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf-8')
      const arr = JSON.parse(content)
      if (!Array.isArray(arr)) continue
      const isDlq = filePath.includes('dlq')
      const count = arr.filter((x) => isSyntheticQueueItem(x)).length
      if (isDlq) dlqTestCount += count
      else queueTestCount += count
    } catch {}
  }
  return { dlqTestCount, queueTestCount }
}

function cleanSyntheticSpoolItems(): number {
  let cleaned = 0
  for (const filePath of SHOPEE_SPOOL_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue
      const content = fs.readFileSync(filePath, 'utf-8')
      const arr = JSON.parse(content)
      if (!Array.isArray(arr)) continue
      const filtered = arr.filter((x) => {
        const isSynth = isSyntheticQueueItem(x)
        if (isSynth) cleaned++
        return !isSynth
      })
      if (filtered.length !== arr.length) {
        safeWriteJsonAtomic(filePath, filtered)
      }
    } catch {}
  }
  return cleaned
}

function syncBaselineToSqlite(products: typeof THAIMY1605_CANONICAL_BASELINE) {
  try {
    if (!fs.existsSync(SQLITE_DB_PATH)) return
    const sqliteMod =
      (process as unknown as { getBuiltinModule?: (id: string) => any }).getBuiltinModule?.(
        'node:sqlite'
      ) || eval('require')('node:sqlite')
    const { DatabaseSync } = sqliteMod
    const sqlite = new DatabaseSync(SQLITE_DB_PATH)
    sqlite.exec('PRAGMA foreign_keys = OFF;')
    sqlite.exec('BEGIN TRANSACTION;')

    // 1. Đảm bảo kho trung tâm KHO-TRUNG-TAM tồn tại
    sqlite.exec(`
      INSERT INTO Warehouse (id, code, name, type, isDefault, active, commissionPct, updatedAt)
      VALUES ('${DEFAULT_CENTRAL_WAREHOUSE_ID}', 'KHO-TRUNG-TAM', 'Kho Trung Tâm', 'INTERNAL', 1, 1, 0, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET isDefault = 1, active = 1, updatedAt = datetime('now');
    `)

    // 2. Đảm bảo danh mục chính tồn tại
    sqlite.exec(`
      INSERT INTO Category (id, name, slug, createdAt)
      VALUES ('cmvqainai0000ve3wcldb6o61', 'Nến & Đồ đựng nến', 'nen-do-dung-nen-sync', datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name = excluded.name;
    `)

    // 2. Đồng bộ 13 sản phẩm thật
    const upsertProductStmt = sqlite.prepare(`
      INSERT INTO Product (id, sku, name, costPrice, sellPrice, stock, lowStockThreshold, status, unit, type, fragile, categoryId, ownerWarehouseId, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        sku = excluded.sku,
        name = excluded.name,
        costPrice = excluded.costPrice,
        sellPrice = excluded.sellPrice,
        stock = excluded.stock,
        lowStockThreshold = excluded.lowStockThreshold,
        status = 'ACTIVE',
        unit = excluded.unit,
        type = excluded.type,
        fragile = excluded.fragile,
        categoryId = excluded.categoryId,
        ownerWarehouseId = excluded.ownerWarehouseId,
        updatedAt = datetime('now');
    `)

    // 3. Đồng bộ chi tiết WarehouseStock
    const upsertStockStmt = sqlite.prepare(`
      INSERT INTO WarehouseStock (id, warehouseId, productId, quantity, updatedAt)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(warehouseId, productId) DO UPDATE SET
        quantity = excluded.quantity,
        updatedAt = datetime('now');
    `)

    for (const p of products) {
      upsertProductStmt.run(
        p.id,
        p.sku,
        p.name,
        p.costPrice,
        p.sellPrice,
        p.stock,
        p.lowStockThreshold,
        p.unit,
        p.type,
        p.fragile ? 1 : 0,
        p.categoryId,
        p.ownerWarehouseId
      )
      upsertStockStmt.run(`whs_${p.id}`, DEFAULT_CENTRAL_WAREHOUSE_ID, p.id, p.stock)
    }

    // Dọn sạch mọi sản phẩm test tổng hợp trong SQLite
    sqlite.exec(`
      DELETE FROM Product WHERE sku LIKE 'TEST-%' OR sku LIKE 'SP-TEST-%' OR sku LIKE 'QA-%' OR sku LIKE 'R1-%' OR sku LIKE 'R2-%' OR sku LIKE 'T-COMP%' OR sku LIKE 'T-COMBO%';
    `)

    sqlite.exec('COMMIT;')
    sqlite.exec('PRAGMA foreign_keys = ON;')
    sqlite.close()
  } catch (err) {
    console.warn('[test-guard] Không thể sync SQLite custom.db (không nghiêm trọng):', err)
  }
}

// ============================================================================
// 4. KIỂM THỬ ĐIỂM MÙ MỞ RỘNG (18 NHÓM BẢNG CƠ SỞ DỮ LIỆU)
// ============================================================================

export async function detectSyntheticTestArtifacts() {
  const [
    rawProducts,
    rawOrders,
    rawCustomers,
    rawPartners,
    rawSalesInvoices,
    rawPurchaseInvoices,
    rawCampaigns,
    rawVouchers,
    rawSocialPosts,
    rawSocialPlans,
    rawContentSources,
    rawContentSourceItems,
    rawDirectMessages,
    rawAgentActivities,
    rawAuditLogs,
    rawLedgers,
    rawBehaviorLogs,
    rawStaffUsers,
  ] = await Promise.all([
    // 1. Product
    db.product.findMany({
      where: {
        OR: [
          { sku: { startsWith: 'SP-TEST-', mode: 'insensitive' } },
          { sku: { startsWith: 'QA-', mode: 'insensitive' } },
          { sku: { startsWith: 'TEST-', mode: 'insensitive' } },
          { sku: { startsWith: 'R1-', mode: 'insensitive' } },
          { sku: { startsWith: 'R2-', mode: 'insensitive' } },
          { sku: { startsWith: 'R3-', mode: 'insensitive' } },
          { sku: { startsWith: 'R4-', mode: 'insensitive' } },
          { sku: { startsWith: 'R5-', mode: 'insensitive' } },
          { sku: { startsWith: 'T-COMPA-', mode: 'insensitive' } },
          { sku: { startsWith: 'T-COMPB-', mode: 'insensitive' } },
          { sku: { startsWith: 'T-COMBO-', mode: 'insensitive' } },
          { sku: { startsWith: 'CSV-TEST-', mode: 'insensitive' } },
          { sku: { startsWith: 'UD-SYN-', mode: 'insensitive' } },
          { sku: { startsWith: 'UD-EXTREME', mode: 'insensitive' } },
          { sku: { startsWith: 'UD-CHALLENGE', mode: 'insensitive' } },
          { sku: { startsWith: 'VALID-ROW', mode: 'insensitive' } },
          { name: { contains: '[QA', mode: 'insensitive' } },
          { name: { contains: '[TEST', mode: 'insensitive' } },
          { name: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { name: { contains: 'Thử nghiệm', mode: 'insensitive' } },
          { name: { contains: 'Pre-Deducted', mode: 'insensitive' } },
        ],
      },
      select: { id: true, sku: true, name: true },
    }),

    // 2. Order
    db.order.findMany({
      where: {
        code: { notIn: Array.from(PROTECTED_ORDER_CODES) },
        OR: [
          { code: { startsWith: 'DH-R1-', mode: 'insensitive' } },
          { code: { startsWith: 'DH-R2-', mode: 'insensitive' } },
          { code: { startsWith: 'DH-TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'ORD-R2-', mode: 'insensitive' } },
          { code: { startsWith: 'ORD-TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'DH-K80-TEST', mode: 'insensitive' } },
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { note: { contains: '[TEST', mode: 'insensitive' } },
          { note: { contains: '[QA', mode: 'insensitive' } },
          { note: { contains: 'Shopee Order #', mode: 'insensitive' } },
          { note: { contains: 'R2_TEST', mode: 'insensitive' } },
          { note: { contains: 'TEST_', mode: 'insensitive' } },
          { note: { contains: 'TEST', mode: 'insensitive' } },
          { note: { contains: 'pre-deduction', mode: 'insensitive' } },
          { note: { contains: '[POS:Nhận tại kho', mode: 'insensitive' } },
          { note: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { note: { contains: 'Test R1', mode: 'insensitive' } },
          { note: { contains: 'Test R2', mode: 'insensitive' } },
          { customer: { name: { contains: 'Kiểm Định', mode: 'insensitive' } } },
          { customer: { name: { contains: 'QA Khách', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Hội Viên Test', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Thử Nghiệm', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Người mua Alpha', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Người mua Beta', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Shopee #', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Hủy Trước Khi Sync', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Test', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Vận Đơn', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Shopee Adv', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách Stress', mode: 'insensitive' } } },
          { customer: { name: { contains: 'Khách COD Lifecycle', mode: 'insensitive' } } },
          { customer: { email: { startsWith: 'shopee:', mode: 'insensitive' } } },
          {
            customer: {
              phone: {
                in: [
                  '0900111222',
                  '0900111333',
                  '0911222333',
                  '0900888777',
                  '0900666555',
                  '0999888777',
                  '0909888777',
                  '0912345678',
                  '0900000000',
                ],
              },
            },
          },
          { customer: { phone: { startsWith: '097999' } } },
          { customer: { phone: { startsWith: '098888' } } },
        ],
      },
      select: { id: true, code: true },
    }),

    // 3. Customer
    db.customer.findMany({
      where: {
        id: { notIn: Array.from(PROTECTED_CUSTOMER_IDS) },
        OR: [
          { name: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { name: { contains: 'QA Khách', mode: 'insensitive' } },
          { name: { contains: '#28604B', mode: 'insensitive' } },
          { name: { contains: '#27773B', mode: 'insensitive' } },
          { name: { contains: 'Hội Viên Test', mode: 'insensitive' } },
          { name: { contains: 'Khách Test', mode: 'insensitive' } },
          { name: { contains: 'Test Customer', mode: 'insensitive' } },
          { name: { contains: 'Khách Thử Nghiệm', mode: 'insensitive' } },
          { name: { contains: 'Khách Vãng Lai', mode: 'insensitive' } },
          { name: { contains: 'Khách VIP Sinh Nhật', mode: 'insensitive' } },
          { name: { contains: 'Khách Shopee Drill', mode: 'insensitive' } },
          { name: { contains: 'Khách TikTok Drill', mode: 'insensitive' } },
          { name: { contains: 'Khách Đặt Vượt', mode: 'insensitive' } },
          { name: { contains: 'Khách Mua SP Ngừng', mode: 'insensitive' } },
          { name: { contains: 'Khách Hủy Đơn', mode: 'insensitive' } },
          { name: { contains: 'Khách Hoàn Đơn', mode: 'insensitive' } },
          { name: { contains: 'Khách Voucher', mode: 'insensitive' } },
          { name: { contains: 'Khách Kiểm Thử', mode: 'insensitive' } },
          { name: { contains: 'Người mua Alpha', mode: 'insensitive' } },
          { name: { contains: 'Người mua Beta', mode: 'insensitive' } },
          { name: { contains: 'Khách Shopee #', mode: 'insensitive' } },
          { name: { contains: 'Khách Hủy Trước Khi Sync', mode: 'insensitive' } },
          { name: { contains: 'Khách Vận Đơn', mode: 'insensitive' } },
          { name: { contains: 'Khách Shopee Adv', mode: 'insensitive' } },
          { name: { contains: 'Khách Stress', mode: 'insensitive' } },
          { name: { contains: 'Khách COD Lifecycle', mode: 'insensitive' } },
          { email: { startsWith: 'shopee:', mode: 'insensitive' } },
          { inferredProfile: { contains: 'shopee:', mode: 'insensitive' } },
          {
            phone: {
              in: [
                '0900111222',
                '0900111333',
                '0911222333',
                '0900888777',
                '0900666555',
                '0999888777',
                '0909888777',
                '0912345678',
                '0900000000',
              ],
            },
          },
          { phone: { startsWith: '097999' } },
          { phone: { startsWith: '098888' } },
          { memberCode: { startsWith: 'TV-TEST-' } },
          { memberCode: { startsWith: 'TV-QA-' } },
          { memberCode: 'TV99' },
          { email: { contains: 'cust1_R1-', mode: 'insensitive' } },
          { email: { contains: 'loyalty.test@uudam.vn', mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, phone: true },
    }),

    // 4. Partner
    db.partner.findMany({
      where: {
        OR: [
          { code: { startsWith: 'DT-R', mode: 'insensitive' } },
          { code: { startsWith: 'NCC-R', mode: 'insensitive' } },
          { code: { startsWith: 'DT-', mode: 'insensitive' } },
          { code: { startsWith: 'NCC-', mode: 'insensitive' } },
          { code: { startsWith: 'PARTNER-TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'TEST-', mode: 'insensitive' } },
          { name: { contains: 'Test', mode: 'insensitive' } },
          { name: { contains: 'Thử nghiệm', mode: 'insensitive' } },
          { name: { contains: 'Sen Việt <HN>', mode: 'insensitive' } },
          { name: { contains: 'Nhà Cung Cấp Nến Thơm R5', mode: 'insensitive' } },
          { phone: '0912345678' },
          { taxCode: '0109998888' },
        ],
      },
      select: { id: true, code: true, name: true },
    }),

    // 5. SalesInvoice
    db.salesInvoice.findMany({
      where: {
        code: { notIn: Array.from(PROTECTED_INVOICE_CODES) },
        OR: [
          { code: { startsWith: 'PXK-R', mode: 'insensitive' } },
          { code: { startsWith: 'INV-TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'PXK-TEST-', mode: 'insensitive' } },
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { note: { contains: 'R1-', mode: 'insensitive' } },
          { note: { contains: 'R2-', mode: 'insensitive' } },
          { note: { contains: 'R3-', mode: 'insensitive' } },
          { note: { contains: 'R4-', mode: 'insensitive' } },
          { note: { contains: 'R5-', mode: 'insensitive' } },
          { note: { contains: '[TEST', mode: 'insensitive' } },
          { note: { contains: '[QA', mode: 'insensitive' } },
          { note: { contains: 'Bán lẻ trực tiếp 2 bộ Combo tại quầy', mode: 'insensitive' } },
          { note: { contains: 'Khách đổi ý tại quầy', mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true },
    }),

    // 6. PurchaseInvoice
    db.purchaseInvoice.findMany({
      where: {
        OR: [
          { code: { startsWith: 'PO-R', mode: 'insensitive' } },
          { code: { startsWith: 'PO-TEST-', mode: 'insensitive' } },
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { note: { contains: 'R1-', mode: 'insensitive' } },
          { note: { contains: 'R2-', mode: 'insensitive' } },
          { note: { contains: 'R3-', mode: 'insensitive' } },
          { note: { contains: 'R4-', mode: 'insensitive' } },
          { note: { contains: 'R5-', mode: 'insensitive' } },
          { note: { contains: 'thử nghiệm', mode: 'insensitive' } },
          { note: { contains: '[TEST', mode: 'insensitive' } },
          { note: { contains: '[QA', mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true },
    }),

    // 7. Campaign
    db.campaign.findMany({
      where: {
        code: { notIn: Array.from(PROTECTED_REAL_CAMPAIGNS) },
        OR: [
          { code: 'CD-HE896' },
          { code: { startsWith: 'TEST', mode: 'insensitive' } },
          { code: { startsWith: 'CP-TEST', mode: 'insensitive' } },
          { code: { startsWith: 'CP-VERIFY', mode: 'insensitive' } },
          { code: { startsWith: 'CP-COMBO', mode: 'insensitive' } },
          { code: { startsWith: 'CP-VULAN', mode: 'insensitive' } },
          { code: { startsWith: 'CP-EXPIRED', mode: 'insensitive' } },
          { code: { startsWith: 'CP-BURST', mode: 'insensitive' } },
          { code: { startsWith: 'CP-GATEWAY', mode: 'insensitive' } },
          { code: { startsWith: 'CP-EMPTY', mode: 'insensitive' } },
          { code: { startsWith: 'CP-ADV-', mode: 'insensitive' } },
          { code: { startsWith: 'CP-CHALLENGE', mode: 'insensitive' } },
          { code: { startsWith: 'CAMP-M2-', mode: 'insensitive' } },
          { code: { startsWith: 'CAMP-LOYALTY', mode: 'insensitive' } },
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { name: { contains: '[TEST', mode: 'insensitive' } },
          { name: { contains: '[QA', mode: 'insensitive' } },
          { name: { contains: 'Thử nghiệm', mode: 'insensitive' } },
          { name: { contains: 'Thử Thách', mode: 'insensitive' } },
          { name: { contains: 'Adversarial', mode: 'insensitive' } },
          { name: { contains: 'Khảo Nghiệm', mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, name: true },
    }),

    // 8. Voucher
    db.voucher.findMany({
      where: {
        code: { notIn: Array.from(PROTECTED_REAL_VOUCHERS) },
        OR: [
          { code: 'HELLOVN254' },
          { code: { startsWith: 'TEST', mode: 'insensitive' } },
          { code: { startsWith: 'VC-TEST-', mode: 'insensitive' } },
          { code: { startsWith: 'VIP-BDAY-', mode: 'insensitive' } },
          { code: { startsWith: 'VOUCHER_EXTREME_', mode: 'insensitive' } },
          { code: { startsWith: 'VOUCHER-TEST', mode: 'insensitive' } },
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { title: { contains: '[TEST', mode: 'insensitive' } },
          { title: { contains: 'Thử nghiệm', mode: 'insensitive' } },
        ],
      },
      select: { id: true, code: true, title: true },
    }),

    // 9. SocialPost
    db.socialPost.findMany({
      where: {
        OR: [
          { title: { contains: '[TEST', mode: 'insensitive' } },
          { title: { contains: 'test_', mode: 'insensitive' } },
          { slug: { contains: 'test', mode: 'insensitive' } },
          { content: { contains: '[TEST-E2E]', mode: 'insensitive' } },
          { content: { contains: 'test_', mode: 'insensitive' } },
          { content: { contains: 'post_test_', mode: 'insensitive' } },
          { id: { startsWith: 'test_' } },
          { id: { startsWith: 'post_test_' } },
        ],
      },
      select: { id: true, title: true },
    }),

    // 10. SocialPlan
    db.socialPlan.findMany({
      where: {
        OR: [
          { title: { contains: 'Test', mode: 'insensitive' } },
          { title: { contains: 'Thử nghiệm', mode: 'insensitive' } },
          { title: { contains: '[TEST', mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true },
    }),

    // 11. ContentSource
    db.contentSource.findMany({
      where: {
        OR: [
          { name: { contains: 'Combo 1', mode: 'insensitive' } },
          { name: { contains: 'Test', mode: 'insensitive' } },
          { name: { contains: 'Khảo Nghiệm', mode: 'insensitive' } },
          { folderId: '1abcXYZ_12345678901234567890' },
          { driveFolderUrl: { contains: '1abcXYZ_12345678901234567890' } },
        ],
      },
      select: { id: true, name: true },
    }),

    // 12. ContentSourceItem
    db.contentSourceItem.findMany({
      where: {
        OR: [
          { name: { contains: 'test', mode: 'insensitive' } },
          { driveFileId: { startsWith: 'test_' } },
        ],
      },
      select: { id: true, name: true },
    }),

    // 13. DirectMessage
    db.directMessage.findMany({
      where: {
        OR: [
          { content: { contains: '[qa ', mode: 'insensitive' } },
          { content: { contains: '[TEST', mode: 'insensitive' } },
          { customer: { name: { contains: 'Kiểm Định', mode: 'insensitive' } } },
          { customer: { name: { contains: 'QA Khách', mode: 'insensitive' } } },
        ],
      },
      select: { id: true },
    }),

    // 14. AgentActivity
    db.agentActivity.findMany({
      where: {
        OR: [
          { message: { contains: 'Khách Kiểm Định', mode: 'insensitive' } },
          { message: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { message: { contains: 'Kiểm thử', mode: 'insensitive' } },
          { message: { contains: 'Chị R', mode: 'insensitive' } },
          { message: { contains: '[qa', mode: 'insensitive' } },
          { message: { contains: '[test', mode: 'insensitive' } },
          { message: { contains: 'QA Khách', mode: 'insensitive' } },
          { message: { contains: 'DH261107-', mode: 'insensitive' } },
          { message: { contains: 'TEST', mode: 'insensitive' } },
          { message: { contains: 'R1-', mode: 'insensitive' } },
          { message: { contains: 'R2-', mode: 'insensitive' } },
          { message: { contains: 'R3-', mode: 'insensitive' } },
          { message: { contains: 'R4-', mode: 'insensitive' } },
          { message: { contains: 'R5-', mode: 'insensitive' } },
          { targetLabel: { contains: 'TEST', mode: 'insensitive' } },
          { targetLabel: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { targetLabel: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { targetLabel: { contains: 'QA', mode: 'insensitive' } },
          { targetLabel: { contains: 'R1', mode: 'insensitive' } },
          { targetLabel: { contains: 'R2', mode: 'insensitive' } },
          { targetLabel: { contains: 'R3', mode: 'insensitive' } },
          { targetLabel: { contains: 'R4', mode: 'insensitive' } },
          { targetLabel: { contains: 'R5', mode: 'insensitive' } },
          { detail: { contains: 'TEST', mode: 'insensitive' } },
          { detail: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { detail: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { detail: { contains: 'Chị R', mode: 'insensitive' } },
          { detail: { contains: '[qa', mode: 'insensitive' } },
          { detail: { contains: '[test', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    }),

    // 15. AuditLog
    db.auditLog.findMany({
      where: {
        OR: [
          { actor: 'TEST_RUNNER' },
          { actorName: { contains: 'Test', mode: 'insensitive' } },
          { details: { contains: 'TEST', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    }),

    // 16. LedgerEntry
    db.ledgerEntry.findMany({
      where: {
        OR: [
          { actor: 'TEST' },
          { originSource: 'AUTOMATED_TEST' },
          { title: { contains: 'Khách Kiểm Định', mode: 'insensitive' } },
          { title: { contains: 'Người mua Alpha', mode: 'insensitive' } },
          { title: { contains: 'Người mua Beta', mode: 'insensitive' } },
          { title: { contains: 'Khách Test', mode: 'insensitive' } },
          { title: { contains: 'Khách Hủy', mode: 'insensitive' } },
          { title: { contains: 'SP-TEST-', mode: 'insensitive' } },
          { title: { contains: 'T-COMPA-', mode: 'insensitive' } },
          { title: { contains: 'T-COMBO-', mode: 'insensitive' } },
          { title: { contains: 'CD-HE896', mode: 'insensitive' } },
          { title: { contains: 'HELLOVN254', mode: 'insensitive' } },
          { title: { contains: '#28604B', mode: 'insensitive' } },
          { title: { contains: '#27773B', mode: 'insensitive' } },
          { title: { contains: 'R2_TEST', mode: 'insensitive' } },
          { title: { contains: 'DH261108-', mode: 'insensitive' } },
          { title: { contains: 'DH261107-', mode: 'insensitive' } },
          { title: { contains: 'TEST', mode: 'insensitive' } },
          { entityCode: { startsWith: 'SP-TEST-', mode: 'insensitive' } },
          { entityCode: { startsWith: 'TEST-', mode: 'insensitive' } },
          { entityCode: { startsWith: 'T-COMPA-', mode: 'insensitive' } },
          { entityCode: { startsWith: 'T-COMBO-', mode: 'insensitive' } },
          { entityCode: { startsWith: 'DH261108-', mode: 'insensitive' } },
          { entityCode: { startsWith: 'DH261107-', mode: 'insensitive' } },
        ],
      },
      select: { id: true, title: true },
    }),

    // 17. BehaviorLog
    db.behaviorLog.findMany({
      where: {
        NOT: [{ path: { contains: 'test-guard' } }],
        OR: [
          { summary: { contains: 'kiểm thử', mode: 'insensitive' } },
          { summary: { contains: '[TEST', mode: 'insensitive' } },
          { summary: { contains: '[QA', mode: 'insensitive' } },
          { summary: { contains: 'test_', mode: 'insensitive' } },
          { targetCode: { contains: 'TEST', mode: 'insensitive' } },
          { username: 'e2e_temp_staff' },
          { username: { startsWith: 'test_' } },
        ],
      },
      select: { id: true },
    }),

    // 18. StaffUser
    db.staffUser.findMany({
      where: {
        username: { notIn: Array.from(PROTECTED_STAFF_USERNAMES) },
        OR: [
          { username: 'e2e_temp_staff' },
          { username: { startsWith: 'test_' } },
          { displayName: { contains: 'Kiểm thử', mode: 'insensitive' } },
          { displayName: { contains: 'Test', mode: 'insensitive' } },
        ],
      },
      select: { id: true, username: true },
    }),
  ])

  // Lọc an toàn bằng whitelist bộ nhớ (Protected Whitelist Filtering)
  const testProducts = rawProducts.filter(
    (p) => !PROTECTED_REAL_SKUS.has(p.sku.toUpperCase().trim())
  )
  const testOrders = rawOrders.filter(
    (o) => !PROTECTED_ORDER_CODES.has(o.code.trim())
  )
  const testCustomers = rawCustomers.filter(
    (c) => !PROTECTED_CUSTOMER_IDS.has(c.id)
  )
  const testSalesInvoices = rawSalesInvoices.filter(
    (s) => !PROTECTED_INVOICE_CODES.has(s.code.trim())
  )
  const testCampaigns = rawCampaigns.filter(
    (c) => !PROTECTED_REAL_CAMPAIGNS.has(c.code.trim().toUpperCase())
  )
  const testVouchers = rawVouchers.filter(
    (v) => !PROTECTED_REAL_VOUCHERS.has(v.code.trim().toUpperCase())
  )

  const testPartners = rawPartners
  const testPurchaseInvoices = rawPurchaseInvoices
  const testSocialPosts = rawSocialPosts
  const testSocialPlans = rawSocialPlans
  const testContentSources = rawContentSources
  const testContentSourceItems = rawContentSourceItems
  const testDirectMessages = rawDirectMessages
  const testAgentActivities = rawAgentActivities
  const testAuditLogs = rawAuditLogs
  const testLedgers = rawLedgers
  const testBehaviorLogs = rawBehaviorLogs
  const testStaffUsers = rawStaffUsers

  const spool = countSyntheticSpoolItems()

  const totalCount =
    testProducts.length +
    testOrders.length +
    testCustomers.length +
    testPartners.length +
    testSalesInvoices.length +
    testPurchaseInvoices.length +
    testCampaigns.length +
    testVouchers.length +
    testSocialPosts.length +
    testSocialPlans.length +
    testContentSources.length +
    testContentSourceItems.length +
    testDirectMessages.length +
    testAgentActivities.length +
    testAuditLogs.length +
    testLedgers.length +
    testBehaviorLogs.length +
    testStaffUsers.length +
    spool.dlqTestCount +
    spool.queueTestCount

  return {
    totalCount,
    testProducts,
    testOrders,
    testCustomers,
    testPartners,
    testSalesInvoices,
    testPurchaseInvoices,
    testCampaigns,
    testVouchers,
    testSocialPosts,
    testSocialPlans,
    testContentSources,
    testContentSourceItems,
    testDirectMessages,
    testMessages: testDirectMessages,
    testAgentActivities,
    testActivities: testAgentActivities,
    testAuditLogs,
    testLedgers,
    testBehaviorLogs,
    testStaffUsers,
    spool,
  }
}

// ============================================================================
// 5. REST API HANDLERS: GET & POST
// ============================================================================

export async function GET() {
  try {
    const cached = getApiCache<Record<string, unknown>>('ledger:test-guard')
    if (cached) {
      return NextResponse.json(cached)
    }

    const [setting, permanentSetting, detected] = await Promise.all([
      db.appSetting.findUnique({ where: { key: SNAPSHOT_KEY } }),
      db.appSetting.findUnique({ where: { key: PERMANENT_BASELINE_KEY } }),
      detectSyntheticTestArtifacts(),
    ])

    let snapshotInfo: { createdAt: string; productCount: number } | null = null
    const rawVal = setting?.value || permanentSetting?.value
    if (rawVal) {
      try {
        const parsed = JSON.parse(rawVal)
        snapshotInfo = {
          createdAt: parsed.createdAt || new Date().toISOString(),
          productCount: parsed.products?.length ?? 13,
        }
      } catch {
        snapshotInfo = null
      }
    }

    const payload = {
      ok: true,
      clean: detected.totalCount === 0,
      leftoverCount: detected.totalCount,
      hasSnapshot: Boolean(snapshotInfo),
      snapshot: snapshotInfo,
      breakdown: {
        products: detected.testProducts.length,
        orders: detected.testOrders.length,
        customers: detected.testCustomers.length,
        partners: detected.testPartners.length,
        salesInvoices: detected.testSalesInvoices.length,
        purchaseInvoices: detected.testPurchaseInvoices.length,
        campaigns: detected.testCampaigns.length,
        vouchers: detected.testVouchers.length,
        socialPosts: detected.testSocialPosts.length,
        socialPlans: detected.testSocialPlans.length,
        contentSources: detected.testContentSources.length,
        activities: detected.testActivities.length,
        messages: detected.testMessages.length,
        ledgers: detected.testLedgers.length,
        auditLogs: detected.testAuditLogs.length,
        behaviorLogs: detected.testBehaviorLogs.length,
        staffUsers: detected.testStaffUsers.length,
        dlqSpool: detected.spool.dlqTestCount + detected.spool.queueTestCount,
      },
    }
    setApiCache('ledger:test-guard', payload, 30_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('GET /api/ledger/test-guard error:', error)
    return NextResponse.json({ error: 'Không thể kiểm tra trạng thái dữ liệu test' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: 'SNAPSHOT' | 'RESTORE_AND_CLEAN'
    }
    const action = body.action || 'RESTORE_AND_CLEAN'

    // ------------------------------------------------------------------------
    // 1. ACTION: SNAPSHOT (Đóng băng dữ liệu nguyên trạng trước kiểm thử)
    // ------------------------------------------------------------------------
    if (action === 'SNAPSHOT') {
      const [products, orders, campaigns, vouchers, movements, ledgers, activities] = await Promise.all([
        db.product.findMany({ include: { listings: true } }),
        db.order.findMany({ select: { id: true } }),
        db.campaign.findMany({ select: { id: true } }),
        db.voucher.findMany({ select: { id: true } }),
        db.stockMovement.findMany({ select: { id: true } }),
        db.ledgerEntry.findMany({ select: { id: true } }),
        db.agentActivity.findMany({ select: { id: true } }),
      ])

      // Bản đồ tra cứu định lượng chuẩn 13 sản phẩm thật để snapshot không bao giờ đóng băng tồn kho suy hao
      const canonicalSkuMap = new Map(
        THAIMY1605_CANONICAL_BASELINE.map((c) => [c.sku.toUpperCase().trim(), c])
      )

      const snapshot = {
        createdAt: new Date().toISOString(),
        products: products.map((p) => {
          const canonical = canonicalSkuMap.get(p.sku?.toUpperCase()?.trim())
          return {
            id: p.id,
            sku: p.sku,
            name: p.name,
            description: p.description,
            categoryId: p.categoryId,
            costPrice: canonical ? canonical.costPrice : p.costPrice,
            sellPrice: canonical ? canonical.sellPrice : p.sellPrice,
            stock: canonical ? canonical.stock : p.stock,
            lowStockThreshold: p.lowStockThreshold,
            image: p.image,
            status: canonical ? 'ACTIVE' : p.status,
            attributes: p.attributes,
            unit: p.unit,
            type: p.type,
            fragile: p.fragile,
            ownerWarehouseId: p.ownerWarehouseId,
            listings: p.listings.map((l) => ({
              channelId: l.channelId,
              price: l.price,
              status: l.status,
            })),
          }
        }),
        orderIds: orders.map((x) => x.id),
        campaignIds: campaigns.map((x) => x.id),
        voucherIds: vouchers.map((x) => x.id),
        stockMovementIds: movements.map((x) => x.id),
        ledgerEntryIds: ledgers.map((x) => x.id),
        agentActivityIds: activities.map((x) => x.id),
      }

      const snapshotJson = JSON.stringify(snapshot)

      // Khung chuẩn bất biến cho PERMANENT_BASELINE (luôn 258 đơn vị / 13 SKU thật)
      const permanentCanonicalPayload = {
        createdAt: '2026-11-08T00:00:00.000Z',
        shopId: '197195817',
        shopUsername: 'thaimy1605',
        productCount: THAIMY1605_CANONICAL_BASELINE.length,
        totalStock: THAIMY1605_CANONICAL_BASELINE.reduce((sum, p) => sum + p.stock, 0),
        products: THAIMY1605_CANONICAL_BASELINE.map((p) => ({
          ...p,
          status: 'ACTIVE',
        })),
      }
      const permanentJson = JSON.stringify(permanentCanonicalPayload)

      // Lưu SNAPSHOT phiên test; PERMANENT_BASELINE TUYỆT ĐỐI KHÔNG lưu snapshotJson suy hao
      await Promise.all([
        db.appSetting.upsert({
          where: { key: SNAPSHOT_KEY },
          update: { value: snapshotJson },
          create: { key: SNAPSHOT_KEY, value: snapshotJson },
        }),
        db.appSetting.upsert({
          where: { key: PERMANENT_BASELINE_KEY },
          update: { value: permanentJson },
          create: { key: PERMANENT_BASELINE_KEY, value: permanentJson },
        }),
      ])

      invalidateApiCache()

      return NextResponse.json({
        ok: true,
        action: 'SNAPSHOT_CREATED',
        createdAt: snapshot.createdAt,
        productCount: snapshot.products.length,
        message: `Đã chụp ảnh nguyên trạng (${snapshot.products.length} sản phẩm, ${snapshot.ledgerEntryIds.length} bản ghi sổ cái) trước khi kiểm thử.`,
      })
    }

    // ------------------------------------------------------------------------
    // 2. ACTION: RESTORE_AND_CLEAN (Phục hồi vô điều kiện 13 SP + Dọn Topo 5 nhóm)
    // ------------------------------------------------------------------------
    let restoredProductsCount = 0
    let removedAfterSnapshotCount = 0

    // 2.1 Trích xuất danh sách Ledger IDs & StockMovement IDs từ Session Snapshot
    const sessionSetting = await db.appSetting.findUnique({ where: { key: SNAPSHOT_KEY } })
    let snapshotLedgerIds: string[] = []
    let snapshotStockMovementIds: string[] = []
    if (sessionSetting?.value) {
      try {
        const snap = JSON.parse(sessionSetting.value)
        snapshotLedgerIds = snap.ledgerEntryIds || []
        snapshotStockMovementIds = snap.stockMovementIds || []
      } catch {}
    }

    // 2.2 Phục hồi VÔ ĐIỀU KIỆN toàn bộ 13 sản phẩm thật từ THAIMY1605_CANONICAL_BASELINE (Delta = 0)
    const defaultWh = await db.warehouse.findFirst({ where: { isDefault: true } })
    const targetWhId = defaultWh?.id || DEFAULT_CENTRAL_WAREHOUSE_ID

    await Promise.all(
      THAIMY1605_CANONICAL_BASELINE.map(async (sp) => {
        const existingProd = await db.product.findUnique({
          where: { id: sp.id },
          select: { attributes: true },
        })
        let nextAttrsJson: string | undefined = undefined
        if (existingProd?.attributes) {
          try {
            const parsedAttrs = JSON.parse(existingProd.attributes) as Record<string, unknown>
            parsedAttrs.lastSyncedShopeeStock = sp.stock
            parsedAttrs.liveShopeeStock = sp.stock
            parsedAttrs.lastSyncedShopeePrice = sp.sellPrice
            parsedAttrs.openingStockQty = sp.sku === 'BM-COMBO-SEN-01-TRANG' ? 16 : sp.stock
            parsedAttrs.reconciliationStatus = 'RECONCILED_OK'
            parsedAttrs.unreconciledShopeeDelta = 0
            if (typeof parsedAttrs.shopeeModelName === 'string') {
              const parts = parsedAttrs.shopeeModelName.split(' - ').map((s) => s.trim())
              if (parts.length === 2 && parts[0].toLowerCase() === parts[1].toLowerCase()) {
                parsedAttrs.shopeeModelName = parts[0]
                parsedAttrs.modelName = parts[0]
              }
            }
            nextAttrsJson = JSON.stringify(parsedAttrs)
          } catch {
            nextAttrsJson = undefined
          }
        }

        await db.product.upsert({
          where: { id: sp.id },
          update: {
            sku: sp.sku,
            name: sp.name,
            categoryId: sp.categoryId ?? undefined,
            costPrice: sp.costPrice,
            sellPrice: sp.sellPrice,
            stock: sp.stock,
            lowStockThreshold: sp.lowStockThreshold ?? 5,
            status: 'ACTIVE',
            unit: sp.unit ?? 'bộ',
            type: sp.type ?? 'SIMPLE',
            fragile: sp.fragile ?? true,
            ownerWarehouseId: targetWhId,
            ...(nextAttrsJson ? { attributes: nextAttrsJson } : {}),
          },
          create: {
            id: sp.id,
            sku: sp.sku,
            name: sp.name,
            categoryId: sp.categoryId ?? null,
            costPrice: sp.costPrice,
            sellPrice: sp.sellPrice,
            stock: sp.stock,
            lowStockThreshold: sp.lowStockThreshold ?? 5,
            status: 'ACTIVE',
            unit: sp.unit ?? 'bộ',
            type: sp.type ?? 'SIMPLE',
            fragile: sp.fragile ?? true,
            ownerWarehouseId: targetWhId,
          },
        })

        // Đảm bảo WarehouseStock tại kho trung tâm khớp 100% với Product.stock
        await db.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: targetWhId, productId: sp.id } },
          update: { quantity: sp.stock },
          create: { warehouseId: targetWhId, productId: sp.id, quantity: sp.stock },
        })
        await syncProductWarehouseStock(sp.id, targetWhId)
      })
    )
    restoredProductsCount = THAIMY1605_CANONICAL_BASELINE.length

    // 2.3 Đồng bộ trực tiếp 13 sản phẩm sang SQLite (db/custom.db)
    syncBaselineToSqlite(THAIMY1605_CANONICAL_BASELINE)

    // 2.4 Dọn dẹp các bản ghi sổ cái & thẻ kho phát sinh sau snapshot (nếu có)
    if (snapshotLedgerIds.length > 0) {
      const delLed = await db.ledgerEntry.deleteMany({
        where: {
          id: { notIn: snapshotLedgerIds },
        },
      })
      removedAfterSnapshotCount += delLed.count
    }
    if (snapshotStockMovementIds.length > 0) {
      const delMov = await db.stockMovement.deleteMany({
        where: {
          id: { notIn: [...snapshotStockMovementIds, 'cmw4uy7xi003mvehsmcd3fww3'] },
        },
      })
      removedAfterSnapshotCount += delMov.count
    }

    // Xóa session snapshot và khóa chặt PERMANENT_BASELINE với giá trị chuẩn 258 đơn vị
    const permanentCanonicalPayload = {
      createdAt: '2026-11-08T00:00:00.000Z',
      shopId: '197195817',
      shopUsername: 'thaimy1605',
      productCount: THAIMY1605_CANONICAL_BASELINE.length,
      totalStock: THAIMY1605_CANONICAL_BASELINE.reduce((sum, p) => sum + p.stock, 0),
      products: THAIMY1605_CANONICAL_BASELINE.map((p) => ({
        ...p,
        status: 'ACTIVE',
      })),
    }
    await Promise.all([
      db.appSetting.deleteMany({ where: { key: SNAPSHOT_KEY } }),
      db.appSetting.upsert({
        where: { key: PERMANENT_BASELINE_KEY },
        update: { value: JSON.stringify(permanentCanonicalPayload) },
        create: { key: PERMANENT_BASELINE_KEY, value: JSON.stringify(permanentCanonicalPayload) },
      }),
    ])

    // 2.5 Phát hiện dữ liệu test tổng hợp trên toàn bộ 18 nhóm bảng
    const detected = await detectSyntheticTestArtifacts()

    const testProdIds = detected.testProducts.map((p) => p.id)
    const testOrderIds = detected.testOrders.map((o) => o.id)
    const testCustIds = detected.testCustomers.map((c) => c.id)
    const testPartnerIds = detected.testPartners.map((p) => p.id)
    const testSalesInvIds = detected.testSalesInvoices.map((i) => i.id)
    const testPurchInvIds = detected.testPurchaseInvoices.map((i) => i.id)
    const testCampaignIds = detected.testCampaigns.map((c) => c.id)
    const testVoucherIds = detected.testVouchers.map((v) => v.id)
    const testPostIds = detected.testSocialPosts.map((p) => p.id)
    const testPlanIds = detected.testSocialPlans.map((p) => p.id)
    const testContentSourceIds = detected.testContentSources.map((cs) => cs.id)
    const testStaffIds = detected.testStaffUsers.map((s) => s.id)

    // ========================================================================
    // QUY TRÌNH XÓA DỌN DẸP 5 NHÓM TOPO (5-GROUP TOPOLOGICAL CASCADE TEARDOWN)
    // ========================================================================

    // [NHÓM 1: NHẬT KÝ, THÔNG ĐIỆP & BẢN GHI LÁ]
    await db.webhookDelivery.deleteMany({
      where: {
        OR: [
          { payload: { contains: 'TEST', mode: 'insensitive' } },
          { payload: { contains: 'R1-', mode: 'insensitive' } },
          { payload: { contains: 'R2-', mode: 'insensitive' } },
          { payload: { contains: 'R3-', mode: 'insensitive' } },
        ],
      },
    }).catch(() => null)

    if (detected.testMessages.length > 0 || testCustIds.length > 0) {
      await db.directMessage.deleteMany({
        where: {
          OR: [
            ...(detected.testMessages.length > 0
              ? [{ id: { in: detected.testMessages.map((m) => m.id) } }]
              : []),
            ...(testCustIds.length > 0 ? [{ customerId: { in: testCustIds } }] : []),
          ],
        },
      })
    }

    if (detected.testBehaviorLogs.length > 0 || testStaffIds.length > 0) {
      await db.behaviorLog.deleteMany({
        where: {
          OR: [
            ...(detected.testBehaviorLogs.length > 0
              ? [{ id: { in: detected.testBehaviorLogs.map((b) => b.id) } }]
              : []),
            ...(testStaffIds.length > 0 ? [{ userId: { in: testStaffIds } }] : []),
          ],
        },
      })
    }

    if (detected.testActivities.length > 0 || testOrderIds.length > 0 || testCustIds.length > 0) {
      await db.agentActivity.deleteMany({
        where: {
          OR: [
            ...(detected.testActivities.length > 0
              ? [{ id: { in: detected.testActivities.map((a) => a.id) } }]
              : []),
            ...(testOrderIds.length > 0 ? [{ targetId: { in: testOrderIds } }] : []),
            ...(testCustIds.length > 0 ? [{ targetId: { in: testCustIds } }] : []),
          ],
        },
      })
    }

    if (detected.testAuditLogs.length > 0) {
      await db.auditLog.deleteMany({
        where: { id: { in: detected.testAuditLogs.map((a) => a.id) } },
      })
    }

    if (detected.testLedgers.length > 0) {
      await db.ledgerEntry.deleteMany({
        where: { id: { in: detected.testLedgers.map((l) => l.id) } },
      })
    }

    // [NHÓM 2: CHỨNG TỪ HÓA ĐƠN, VẬN CHUYỂN & KHIẾU NẠI]
    // 2.1 Xóa SalesInvoiceItem trước khi xóa SalesInvoice và Product (Loại trừ lỗi FK 23503)
    await db.salesInvoiceItem.deleteMany({
      where: {
        OR: [
          ...(testSalesInvIds.length > 0 ? [{ invoiceId: { in: testSalesInvIds } }] : []),
          ...(testProdIds.length > 0 ? [{ productId: { in: testProdIds } }] : []),
        ],
      },
    })

    if (testSalesInvIds.length > 0 || testOrderIds.length > 0 || testPartnerIds.length > 0) {
      await db.salesInvoice.deleteMany({
        where: {
          OR: [
            ...(testSalesInvIds.length > 0 ? [{ id: { in: testSalesInvIds } }] : []),
            ...(testOrderIds.length > 0 ? [{ orderId: { in: testOrderIds } }] : []),
            ...(testPartnerIds.length > 0 ? [{ partnerId: { in: testPartnerIds } }] : []),
          ],
        },
      })
    }

    // 2.2 Xóa PurchaseInvoiceItem trước khi xóa PurchaseInvoice và Product (Loại trừ lỗi FK 23503)
    await db.purchaseInvoiceItem.deleteMany({
      where: {
        OR: [
          ...(testPurchInvIds.length > 0 ? [{ invoiceId: { in: testPurchInvIds } }] : []),
          ...(testProdIds.length > 0 ? [{ productId: { in: testProdIds } }] : []),
        ],
      },
    })

    if (testPurchInvIds.length > 0 || testPartnerIds.length > 0) {
      await db.purchaseInvoice.deleteMany({
        where: {
          OR: [
            ...(testPurchInvIds.length > 0 ? [{ id: { in: testPurchInvIds } }] : []),
            ...(testPartnerIds.length > 0 ? [{ partnerId: { in: testPartnerIds } }] : []),
          ],
        },
      })
    }

    if (testOrderIds.length > 0) {
      await db.afterSalesCase.deleteMany({ where: { orderId: { in: testOrderIds } } })
      await db.shipment.deleteMany({ where: { orderId: { in: testOrderIds } } })
      await db.orderEvent.deleteMany({ where: { orderId: { in: testOrderIds } } })
    }

    await db.afterSalesCase.deleteMany({
      where: {
        OR: [
          { code: { contains: 'TEST', mode: 'insensitive' } },
          { reason: { contains: 'kiểm thử', mode: 'insensitive' } },
          { reason: { contains: 'đòi hoàn tiền gấp đôi', mode: 'insensitive' } },
          { reason: { contains: 'đổi trả trên đơn đã hủy', mode: 'insensitive' } },
        ],
      },
    }).catch(() => null)

    await db.shipment.deleteMany({
      where: {
        OR: [
          { trackingCode: { startsWith: 'TRA-R', mode: 'insensitive' } },
          { trackingCode: { startsWith: 'TEST-', mode: 'insensitive' } },
        ],
      },
    }).catch(() => null)

    // [NHÓM 3: ĐƠN HÀNG & BIẾN ĐỘNG KHO]
    if (testOrderIds.length > 0 || testProdIds.length > 0) {
      await db.orderItem.deleteMany({
        where: {
          OR: [
            ...(testOrderIds.length > 0 ? [{ orderId: { in: testOrderIds } }] : []),
            ...(testProdIds.length > 0 ? [{ productId: { in: testProdIds } }] : []),
          ],
        },
      })
    }

    if (testOrderIds.length > 0) {
      await db.order.deleteMany({ where: { id: { in: testOrderIds } } })
    }

    if (testProdIds.length > 0) {
      await db.stockMovement.deleteMany({
        where: {
          id: { not: 'cmw4uy7xi003mvehsmcd3fww3' },
          productId: { in: testProdIds },
        },
      })
    }
    const testOrderCodeFilters = detected.testOrders
      .map((o) => o.code?.trim())
      .filter(Boolean)
      .map((code) => ({ note: { contains: code, mode: 'insensitive' as const } }))
    await db.stockMovement.deleteMany({
      where: {
        id: { not: 'cmw4uy7xi003mvehsmcd3fww3' },
        OR: [
          ...testOrderCodeFilters,
          { note: { contains: '[TEST', mode: 'insensitive' } },
          { note: { contains: '[QA', mode: 'insensitive' } },
          { note: { contains: 'R2_TEST', mode: 'insensitive' } },
          { note: { contains: 'CANC7', mode: 'insensitive' } },
          { note: { contains: 'Concurrent Cancel', mode: 'insensitive' } },
          { note: { contains: 'Nhập đầu kỳ test R2', mode: 'insensitive' } },
          { note: { contains: 'Nhập tồn đầu kỳ cho SP Pre-Deducted', mode: 'insensitive' } },
          { note: { contains: 'Điều chuyển kiểm thử', mode: 'insensitive' } },
          { note: { contains: 'Quyết toán kiểm thử', mode: 'insensitive' } },
        ],
      },
    }).catch(() => null)

    // [NHÓM 4: DANH MỤC, ĐỊNH MỨC BOM & TỒN KHO CHI TIẾT]
    if (testProdIds.length > 0) {
      // Xóa BomComponent cả 2 chiều liên kết kép
      await db.bomComponent.deleteMany({
        where: {
          OR: [
            { productId: { in: testProdIds } },
            { componentProductId: { in: testProdIds } },
          ],
        },
      })
      await db.channelListing.deleteMany({ where: { productId: { in: testProdIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: testProdIds } } })
    }

    // Bảo vệ whitelist tuyệt đối: Không bao giờ xóa sản phẩm thuộc 13 SKU thật
    const safeDeleteProdIds = detected.testProducts
      .filter((p) => !PROTECTED_REAL_SKUS.has(p.sku.toUpperCase().trim()))
      .map((p) => p.id)

    if (safeDeleteProdIds.length > 0) {
      await db.orderItem.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.salesInvoiceItem.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.purchaseInvoiceItem.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.bomComponent.deleteMany({
        where: {
          OR: [
            { productId: { in: safeDeleteProdIds } },
            { componentProductId: { in: safeDeleteProdIds } },
          ],
        },
      })
      await db.channelListing.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.stockMovement.deleteMany({ where: { productId: { in: safeDeleteProdIds } } })
      await db.product.deleteMany({ where: { id: { in: safeDeleteProdIds } } })
    }

    // [NHÓM 5: THỰC THỂ GỐC, ĐỐI TÁC, KHÁCH HÀNG & MARKETING]
    if (testCustIds.length > 0) {
      const custOrders = await db.order.findMany({
        where: {
          customerId: { in: testCustIds },
          code: { notIn: Array.from(PROTECTED_ORDER_CODES) },
        },
        select: { id: true },
      })
      const custOrderIds = custOrders.map((o) => o.id)
      if (custOrderIds.length > 0) {
        await db.salesInvoiceItem.deleteMany({
          where: { invoice: { orderId: { in: custOrderIds } } },
        })
        await db.salesInvoice.deleteMany({ where: { orderId: { in: custOrderIds } } })
        await db.afterSalesCase.deleteMany({ where: { orderId: { in: custOrderIds } } })
        await db.shipment.deleteMany({ where: { orderId: { in: custOrderIds } } })
        await db.orderEvent.deleteMany({ where: { orderId: { in: custOrderIds } } })
        await db.orderItem.deleteMany({ where: { orderId: { in: custOrderIds } } })
        await db.order.deleteMany({ where: { id: { in: custOrderIds } } })
      }
      await db.directMessage.deleteMany({ where: { customerId: { in: testCustIds } } })
      await db.customer.deleteMany({ where: { id: { in: testCustIds } } })
    }

    if (testPartnerIds.length > 0) {
      await db.partner.deleteMany({ where: { id: { in: testPartnerIds } } })
    }

    if (testPostIds.length > 0) {
      await db.socialPost.deleteMany({ where: { id: { in: testPostIds } } })
    }

    if (testPlanIds.length > 0) {
      await db.socialPost.deleteMany({ where: { planId: { in: testPlanIds } } })
      await db.socialPlan.deleteMany({ where: { id: { in: testPlanIds } } })
    }

    if (testContentSourceIds.length > 0 || detected.testContentSourceItems.length > 0) {
      await db.contentSourceItem.deleteMany({
        where: {
          OR: [
            ...(testContentSourceIds.length > 0
              ? [{ contentSourceId: { in: testContentSourceIds } }]
              : []),
            ...(detected.testContentSourceItems.length > 0
              ? [{ id: { in: detected.testContentSourceItems.map((cs) => cs.id) } }]
              : []),
          ],
        },
      })
      if (testContentSourceIds.length > 0) {
        await db.contentSource.deleteMany({ where: { id: { in: testContentSourceIds } } })
      }
    }

    // Bảo vệ whitelist chiến dịch: Tuyệt đối KHÔNG xóa CP-THACHCAO-2026
    const safeDeleteCampaignIds = testCampaignIds.filter(
      (cid) => {
        const found = detected.testCampaigns.find((c) => c.id === cid)
        return found && !PROTECTED_REAL_CAMPAIGNS.has(found.code.toUpperCase().trim())
      }
    )
    if (safeDeleteCampaignIds.length > 0) {
      await db.contentSource.deleteMany({ where: { campaignId: { in: safeDeleteCampaignIds } } })
      await db.socialPost.deleteMany({ where: { campaignId: { in: safeDeleteCampaignIds } } })
      await db.socialPlan.deleteMany({ where: { campaignId: { in: safeDeleteCampaignIds } } })
      await db.campaign.deleteMany({ where: { id: { in: safeDeleteCampaignIds } } })
    }

    // Bảo vệ whitelist voucher: Tuyệt đối KHÔNG xóa các voucher chuẩn
    const safeDeleteVoucherIds = testVoucherIds.filter(
      (vid) => {
        const found = detected.testVouchers.find((v) => v.id === vid)
        return found && !PROTECTED_REAL_VOUCHERS.has(found.code.toUpperCase().trim())
      }
    )
    if (safeDeleteVoucherIds.length > 0) {
      await db.voucher.deleteMany({ where: { id: { in: safeDeleteVoucherIds } } })
    }

    if (testStaffIds.length > 0) {
      await db.staffSession.deleteMany({ where: { userId: { in: testStaffIds } } })
      await db.behaviorLog.deleteMany({ where: { userId: { in: testStaffIds } } })
      await db.staffUser.deleteMany({ where: { id: { in: testStaffIds } } })
    }

    await db.integrationCredential.deleteMany({
      where: {
        OR: [
          { provider: 'PAYOS_TEST' },
          { name: { contains: 'Test', mode: 'insensitive' } },
        ],
      },
    }).catch(() => null)

    // 2.6 Quét sạch hàng đợi và Dead Letter Queue Shopee
    cleanSyntheticSpoolItems()

    // 2.7 Quét dọn dẹp vét đuôi (Final sweep) để xử lý triệt để các background activity phát sinh
    const finalSweepActivities = await db.agentActivity.findMany({
      where: {
        OR: [
          { message: { contains: 'Khách Kiểm Định', mode: 'insensitive' } },
          { message: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { message: { contains: 'Kiểm thử', mode: 'insensitive' } },
          { message: { contains: 'Chị R', mode: 'insensitive' } },
          { message: { contains: '[qa', mode: 'insensitive' } },
          { message: { contains: '[test', mode: 'insensitive' } },
          { message: { contains: 'QA Khách', mode: 'insensitive' } },
          { message: { contains: 'DH261107-', mode: 'insensitive' } },
          { message: { contains: 'TEST', mode: 'insensitive' } },
          { message: { contains: 'R1-', mode: 'insensitive' } },
          { message: { contains: 'R2-', mode: 'insensitive' } },
          { message: { contains: 'R3-', mode: 'insensitive' } },
          { message: { contains: 'R4-', mode: 'insensitive' } },
          { message: { contains: 'R5-', mode: 'insensitive' } },
          { targetLabel: { contains: 'TEST', mode: 'insensitive' } },
          { targetLabel: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { targetLabel: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { targetLabel: { contains: 'QA', mode: 'insensitive' } },
          { targetLabel: { contains: 'R1', mode: 'insensitive' } },
          { targetLabel: { contains: 'R2', mode: 'insensitive' } },
          { targetLabel: { contains: 'R3', mode: 'insensitive' } },
          { targetLabel: { contains: 'R4', mode: 'insensitive' } },
          { targetLabel: { contains: 'R5', mode: 'insensitive' } },
          { detail: { contains: 'TEST', mode: 'insensitive' } },
          { detail: { contains: 'Thử Nghiệm', mode: 'insensitive' } },
          { detail: { contains: 'Kiểm Định', mode: 'insensitive' } },
          { detail: { contains: 'Chị R', mode: 'insensitive' } },
          { detail: { contains: '[qa', mode: 'insensitive' } },
          { detail: { contains: '[test', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    })
    if (finalSweepActivities.length > 0) {
      await db.agentActivity.deleteMany({
        where: { id: { in: finalSweepActivities.map((a) => a.id) } },
      })
    }

    // 2.8 Tái khẳng định bất biến 100% nguyên trạng cho toàn bộ sản phẩm thật sau khi dọn sạch mọi bảng
    await Promise.all(
      THAIMY1605_CANONICAL_BASELINE.map(async (sp) => {
        await Promise.all([
          db.product.update({
            where: { id: sp.id },
            data: { stock: sp.stock, sellPrice: sp.sellPrice, costPrice: sp.costPrice, status: 'ACTIVE' },
          }).catch(() => null),
          db.warehouseStock.upsert({
            where: { warehouseId_productId: { warehouseId: targetWhId, productId: sp.id } },
            update: { quantity: sp.stock },
            create: { warehouseId: targetWhId, productId: sp.id, quantity: sp.stock },
          }).catch(() => null),
        ])
      })
    )
    syncBaselineToSqlite(THAIMY1605_CANONICAL_BASELINE)

    invalidateApiCache()
    broadcast('ledger.new', { restored: true })
    broadcast('inventory.updated', { restored: true })

    return NextResponse.json({
      ok: true,
      action: 'RESTORED_AND_CLEANED',
      restoredProductsCount,
      removedTestArtifactsCount: detected.totalCount + removedAfterSnapshotCount,
      message:
        detected.totalCount + removedAfterSnapshotCount + restoredProductsCount > 0
          ? `Đã phục hồi ${restoredProductsCount} sản phẩm về nguyên trạng và dọn sạch ${detected.totalCount + removedAfterSnapshotCount} bản ghi test phi con người qua quy trình 5 nhóm topo.`
          : 'Hệ thống đang ở trạng thái nguyên bản 100% (0 bản ghi test phi con người).',
    })
  } catch (error) {
    console.error('POST /api/ledger/test-guard error:', error)
    return NextResponse.json({ error: 'Không thể phục hồi dữ liệu sau test' }, { status: 500 })
  }
}
