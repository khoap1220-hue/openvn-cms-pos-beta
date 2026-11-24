/**
 * BÁO CÁO VẬN HÀNH BƠ MỘC — MẪU CHUẨN `baocao` (13 SHEET TỰ TÍNH CÔNG THỨC)
 *
 * Kết nối trực tiếp dữ liệu vận hành thực tế của hệ thống OPENVN · Ưu Đàm / Bơ Mộc Suite
 * (Order, OrderItem, Shipment, PurchaseInvoice, StockMovement, BomComponent, Product)
 * kèm kho lưu trữ trạng thái kiểm kê / OPEX cô lập (`db/bo-moc-baocao-state.json` — bảo toàn
 * tuyệt đối `db/baseline-counts.json` 24/24 bảng CSDL).
 */

import fs from 'node:fs'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { db } from '@/lib/db'
import { getAllUnitConfigs } from '@/lib/unit-conversion'
import { buildXlsxBuffer } from '@/lib/xlsx-writer'
import {
  CANONICAL_BOM,
  CANONICAL_MATERIALS,
  CANONICAL_SKUS,
  CARRIER_FEE_ESTIMATES,
  DEFAULT_STOCKTAKE_DATE,
  DEFAULT_VT_OPENING,
  assembleBaocao1Snapshot,
  buildBaocao1Sheets,
  createDefaultBaocao1State,
  isMaterialCode,
  nextMonthStart,
  normalizeMonthStart,
  resolveCanonicalSku,
  toLocalDateYmd,
  type Baocao1DataScope,
  type Baocao1FullSnapshot,
  type Baocao1PersistedState,
  type BomStandardLine,
  type MaterialCatalogItem,
  type OpeningStockRow,
  type ProductionBatchRow,
  type PurchaseLogRow,
  type SalesOrderRow,
  type SkuCatalogItem,
  type StockAdjustmentRow,
} from '@/lib/baocao1-core'

export * from '@/lib/baocao1-core'

// ============================================================================
// 3. Persistent Operational State (Zero Impact on 24 Baseline DB Tables)
// ============================================================================

function resolveWorkspaceRoot(): string {
  const cwd = process.cwd()
  const twoUp = path.resolve(/*turbopackIgnore: true*/ cwd, '..', '..')
  if (fs.existsSync(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ twoUp, 'db', 'custom.db'))) {
    return twoUp
  }
  return cwd
}

const BAOCAO1_STATE_FILE = path.join(
  /*turbopackIgnore: true*/ resolveWorkspaceRoot(),
  'db',
  'bo-moc-baocao-state.json'
)

const gBaocaoMutex = globalThis as unknown as {
  __baocao1StateLock?: Promise<void>
}

/**
 * Serializes all state read-modify-write mutations inside the Node.js process
 * so concurrent HTTP requests never overwrite each other's delta.
 */
export async function withBaocao1StateLock<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = gBaocaoMutex.__baocao1StateLock ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  gBaocaoMutex.__baocao1StateLock = prev.then(() => current, () => current)
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}


export function readBaocao1State(): Baocao1PersistedState {
  const fallback = createDefaultBaocao1State()
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ BAOCAO1_STATE_FILE)) return fallback
    const raw = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ BAOCAO1_STATE_FILE, 'utf8')
    ) as Partial<Baocao1PersistedState>
    return {
      weighedMaterialCode: raw.weighedMaterialCode || 'NVL-001',
      stocktakeCutoffOverride: raw.stocktakeCutoffOverride ?? null,
      openingStockOverrides: raw.openingStockOverrides ?? {},
      materialReorderOverrides: raw.materialReorderOverrides ?? {},
      skuMinStockOverrides: raw.skuMinStockOverrides ?? {},
      manualPurchases: Array.isArray(raw.manualPurchases) ? raw.manualPurchases : [],
      manualProductions: Array.isArray(raw.manualProductions) ? raw.manualProductions : [],
      manualSalesOrders: Array.isArray(raw.manualSalesOrders) ? raw.manualSalesOrders : [],
      salesOrderStatusOverrides: raw.salesOrderStatusOverrides ?? {},
      manualAdjustments: Array.isArray(raw.manualAdjustments) ? raw.manualAdjustments : [],
      otherCashflows: Array.isArray(raw.otherCashflows) ? raw.otherCashflows : [],
      updatedAt: raw.updatedAt,
    }
  } catch {
    return fallback
  }
}

export function writeBaocao1State(next: Baocao1PersistedState): Baocao1PersistedState {
  const payload: Baocao1PersistedState = {
    ...next,
    updatedAt: new Date().toISOString(),
  }
  const serialized = JSON.stringify(payload, null, 2)
  const dir = path.dirname(BAOCAO1_STATE_FILE)
  const tmp = `${BAOCAO1_STATE_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`

  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
      fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true })
    }
    fs.writeFileSync(/*turbopackIgnore: true*/ tmp, serialized, 'utf8')

    let renamed = false
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ BAOCAO1_STATE_FILE)
        renamed = true
        break
      } catch (renameErr) {
        const code = (renameErr as NodeJS.ErrnoException)?.code
        if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') {
          throw renameErr
        }
      }
    }
    if (!renamed) {
      // Fallback for Windows NTFS transient destination lock (Defender / concurrent reader)
      fs.writeFileSync(/*turbopackIgnore: true*/ BAOCAO1_STATE_FILE, serialized, 'utf8')
      if (fs.existsSync(/*turbopackIgnore: true*/ tmp)) {
        fs.unlinkSync(/*turbopackIgnore: true*/ tmp)
      }
    }
  } catch (err) {
    try {
      if (fs.existsSync(/*turbopackIgnore: true*/ tmp)) {
        fs.unlinkSync(/*turbopackIgnore: true*/ tmp)
      }
    } catch {
      // ignore temp cleanup error
    }
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'EROFS') {
      throw err
    }
  }
  return payload
}

// ============================================================================
// 5. Core Aggregation Engine: CMS Database + Persisted State -> Snapshot
// ============================================================================

export interface BuildBaocao1Options {
  reportMonth?: string | null // 'YYYY-MM' or 'YYYY-MM-01' (defaults to next/selected month or current)
  currentMonth?: string | null // 'YYYY-MM' or 'YYYY-MM-01' for Sheet 00
  scope?: Baocao1DataScope
}

export async function buildBaocao1Snapshot(
  options: BuildBaocao1Options = {}
): Promise<Baocao1FullSnapshot> {
  const scope: Baocao1DataScope =
    options.scope === 'all' || options.scope === 'template' ? options.scope : 'from_stocktake'

  const state = readBaocao1State()
  const todayYmd = toLocalDateYmd(new Date())
  const currentMonth = normalizeMonthStart(options.currentMonth, todayYmd)
  // In original `baocao1`, Sheet 12 C3 defaults to `2026-12-01` if unspecified, or user-chosen month
  const reportMonth = options.reportMonth
    ? normalizeMonthStart(options.reportMonth)
    : currentMonth

  const reportMonthNext = nextMonthStart(reportMonth)
  const currentMonthNext = nextMonthStart(currentMonth)

  const [dbProducts, dbBom, dbPurchases, dbMovements, dbOrders, unitMap] = await Promise.all([
    db.product.findMany({ orderBy: { sku: 'asc' } }),
    db.bomComponent.findMany({
      include: {
        product: { select: { sku: true, name: true, attributes: true } },
        componentProduct: { select: { sku: true, name: true, unit: true, costPrice: true, type: true } },
      },
    }),
    db.purchaseInvoice.findMany({
      where: { status: 'POSTED' },
      orderBy: { invoiceDate: 'asc' },
      include: {
        partner: { select: { name: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true, unit: true, type: true } } } },
      },
    }),
    db.stockMovement.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, type: true, costPrice: true, attributes: true } },
      },
    }),
    db.order.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        channel: { select: { key: true, name: true, feePercent: true } },
        customer: { select: { name: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true, costPrice: true, sellPrice: true, attributes: true } } } },
        shipments: { select: { carrier: true, fee: true, status: true } },
        afterSalesCases: { select: { type: true, status: true, reason: true, resolution: true } },
      },
    }),
    getAllUnitConfigs(),
  ])

  // 1. Build 01_Vat_Tu (34 canonical + any extra MATERIAL products in CMS)
  const materials: MaterialCatalogItem[] = CANONICAL_MATERIALS.map((m) => ({
    ...m,
    reorderPoint:
      m.code in state.materialReorderOverrides
        ? state.materialReorderOverrides[m.code]
        : m.reorderPoint,
  }))
  const materialMap = new Map(materials.map((m) => [m.code, m]))

  for (const p of dbProducts) {
    const code = p.sku.trim().toUpperCase()
    if (isMaterialCode(code, p.type) && !materialMap.has(code)) {
      const uCfg = unitMap[p.id]
      const rate = Math.max(1, Number(uCfg?.purchaseRate) || 1)
      const unitCost = rate > 1 && p.costPrice >= rate ? p.costPrice / rate : p.costPrice
      const extra: MaterialCatalogItem = {
        code,
        group: 'Vật tư CMS bổ sung',
        name: p.name,
        unit: uCfg?.baseUnit || p.unit || 'đv',
        standardUnitCost: unitCost > 0 ? unitCost : null,
        status: p.status === 'ACTIVE' ? 'Đang dùng' : 'Ngừng dùng',
        monthlyPlanDemand: null,
        reorderPoint: p.lowStockThreshold > 0 ? p.lowStockThreshold : null,
        note: 'Đồng bộ tự động từ Danh mục Sản phẩm CMS',
      }
      materials.push(extra)
      materialMap.set(code, extra)
    }
  }

  // 2. Build 02_SKU (25 canonical + any custom non-material SKUs not covered by variant mapping)
  const skus: SkuCatalogItem[] = CANONICAL_SKUS.map((s) => ({
    ...s,
    minFinishedStock:
      s.sku in state.skuMinStockOverrides ? state.skuMinStockOverrides[s.sku] : s.minFinishedStock,
  }))
  const knownSkuSet = new Set(skus.map((s) => s.sku))
  const skuMap = new Map(skus.map((s) => [s.sku, s]))
  const dbProductBySku = new Map(dbProducts.map((p) => [p.sku.trim().toUpperCase(), p]))

  for (const p of dbProducts) {
    const code = p.sku.trim().toUpperCase()
    if (isMaterialCode(code, p.type)) continue
    const { mappedSku } = resolveCanonicalSku(code, p.name, p.attributes, knownSkuSet)
    if (!skuMap.has(mappedSku)) {
      // Custom finished SKU (e.g. BM-TEA-10/50/100 only when sold or explicitly added if needed)
      // Wait: keep 02_SKU strictly clean to the 25 Bơ Mộc SKUs unless an active order/movement references an unmapped SKU in scope!
      void mappedSku
    }
  }

  const ensureSkuInCatalog = (
    skuCode: string,
    fallbackName: string,
    fallbackCost: number,
    fallbackSell: number
  ) => {
    if (skuMap.has(skuCode)) return
    const added: SkuCatalogItem = {
      sku: skuCode,
      name: fallbackName,
      categoryGroup: skuCode.includes('-SI-') ? 'B' : 'A',
      pricingGroup: 'CMS-EXTRA',
      standardCost: Math.round(fallbackCost),
      shopeeActualPrice: Math.round(fallbackSell),
      shopeeRegularPrice: Math.round(fallbackSell),
      retailPrice: Math.round(fallbackSell),
      wholesaleB1: Math.round(fallbackSell * 0.75),
      wholesaleB2: Math.round(fallbackSell * 0.65),
      planQtyShopee: 0,
      planQtyRetail: 0,
      planQtyWholesale: 0,
      minFinishedStock: 0,
    }
    skus.push(added)
    skuMap.set(skuCode, added)
    knownSkuSet.add(skuCode)
  }

  // 3. Build 03_Dinh_Muc (196 canonical + any extra BomComponent in CMS)
  const bomLines: BomStandardLine[] = [...CANONICAL_BOM]
  const bomKeySet = new Set(bomLines.map((b) => `${b.sku}::${b.kind}::${b.materialCode}`))
  for (const b of dbBom) {
    const matCode = b.componentProduct.sku.trim().toUpperCase()
    if (!materialMap.has(matCode)) continue
    const { mappedSku } = resolveCanonicalSku(
      b.product.sku,
      b.product.name,
      b.product.attributes,
      knownSkuSet
    )
    const kind: 'NVL' | 'Bao bì' = matCode.startsWith('BB-') ? 'Bao bì' : 'NVL'
    const key = `${mappedSku}::${kind}::${matCode}`
    if (!bomKeySet.has(key)) {
      bomKeySet.add(key)
      bomLines.push({
        sku: mappedSku,
        kind,
        materialCode: matCode,
        qtyPerUnit: b.quantity,
      })
    }
  }

  // 4. Build 04_Ton_Dau_Ky (34 VT + 25 TP)
  const openingStocks: Array<OpeningStockRow & { name: string; unit: string }> = []

  for (const m of materials) {
    const def = DEFAULT_VT_OPENING[m.code] ?? {
      qty: 0,
      status: 'Chưa có hàng',
      note: '',
    }
    const ovKey = `VT:${m.code}`
    const ov = state.openingStockOverrides[ovKey]
    const stDate = ov?.stocktakeDate || DEFAULT_STOCKTAKE_DATE
    openingStocks.push({
      kind: 'VT',
      code: m.code,
      name: m.name,
      unit: m.unit,
      openingQty: ov?.openingQty !== undefined ? ov.openingQty : def.qty,
      stocktakeDate: stDate,
      status: ov?.status || def.status,
      note: ov?.note !== undefined ? ov.note : def.note,
    })
  }

  for (const s of CANONICAL_SKUS) {
    const ovKey = `TP:${s.sku}`
    const ov = state.openingStockOverrides[ovKey]
    const stDate = ov?.stocktakeDate || DEFAULT_STOCKTAKE_DATE
    openingStocks.push({
      kind: 'TP',
      code: s.sku,
      name: s.name,
      unit: 'sp',
      openingQty: ov?.openingQty !== undefined ? ov.openingQty : 0,
      stocktakeDate: stDate,
      status: ov?.status || 'Ước tính — cần cân/đếm lại',
      note:
        ov?.note !== undefined
          ? ov.note
          : 'Thành phẩm đã đúc sẵn (nếu có) thì nhập số đếm được.',
    })
  }

  const stocktakeCutoffDate = state.stocktakeCutoffOverride || DEFAULT_STOCKTAKE_DATE
  const isDateInScope = (ymd: string): boolean => {
    if (scope === 'template') return false
    if (scope === 'all') return true
    // "Chỉ ghi giao dịch ở các sheet khác từ sau ngày kiểm kê" (> stocktakeCutoffDate)
    return ymd > stocktakeCutoffDate
  }

  // 5. Build 05_Nhap_Hang
  const rawPurchases: PurchaseLogRow[] = []
  if (scope !== 'template') {
    const invoiceCodesSeen = new Set<string>()
    for (const inv of dbPurchases) {
      const ymd = toLocalDateYmd(inv.invoiceDate)
      if (!isDateInScope(ymd)) continue
      invoiceCodesSeen.add(inv.code)
      const invSubtotal = inv.subtotal > 0 ? inv.subtotal : 1
      for (const it of inv.items) {
        const code = it.product.sku.trim().toUpperCase()
        if (!materialMap.has(code) && !isMaterialCode(code, it.product.type)) continue
        const uCfg = unitMap[it.product.id]
        const rate = Math.max(1, Number(uCfg?.purchaseRate) || 1)
        const stdQty = it.quantity * rate
        const share = inv.subtotal > 0 ? it.amount / invSubtotal : 1 / Math.max(1, inv.items.length)
        const paid = Math.round(inv.total * share)
        rawPurchases.push({
          id: `${inv.id}:${it.id}`,
          date: ymd,
          docCode: inv.code,
          supplier: inv.partner?.name || 'Nhà cung cấp',
          materialCode: code,
          qtyStandardUnit: stdQty,
          actualTotalPaid: paid,
          note: inv.note || '',
          source: 'CMS_INVOICE',
        })
      }
    }

    // Standalone IMPORT movements on material items (not linked to PurchaseInvoice or Opening Stock)
    for (const mov of dbMovements) {
      if (mov.type !== 'IMPORT' || mov.quantity <= 0) continue
      const noteUpper = (mov.note || '').toUpperCase()
      if (
        noteUpper.includes('[GỐC TỒN ĐẦU') ||
        noteUpper.includes('TỒN KHO ĐẦU KỲ') ||
        noteUpper.includes('(GO-LIVE)') ||
        noteUpper.includes('NHẬP THÀNH PHẨM SẢN XUẤT')
      ) {
        continue
      }
      const ymd = toLocalDateYmd(mov.createdAt)
      if (!isDateInScope(ymd)) continue
      const code = mov.product.sku.trim().toUpperCase()
      if (!materialMap.has(code)) continue
      const matchedInv = [...invoiceCodesSeen].some((ic) => (mov.note || '').includes(ic))
      if (matchedInv) continue

      const batchMatch = /^\[([^\]]+)\]/.exec(mov.note || '')
      const docCode = batchMatch ? batchMatch[1] : `PNK-${mov.id.slice(-6).toUpperCase()}`
      const nccMatch = /NCC:\s*([^·(]+)/i.exec(mov.note || '')
      const mat = materialMap.get(code)
      const estCost = Math.round(mov.quantity * (mat?.standardUnitCost ?? mov.product.costPrice ?? 0))

      rawPurchases.push({
        id: mov.id,
        date: ymd,
        docCode,
        supplier: nccMatch ? nccMatch[1].trim() : 'Nhập kho trực tiếp',
        materialCode: code,
        qtyStandardUnit: mov.quantity,
        actualTotalPaid: estCost,
        note: mov.note || '',
        source: 'CMS_MOVEMENT',
      })
    }

    for (const mp of state.manualPurchases) {
      if (isDateInScope(mp.date)) {
        rawPurchases.push({ ...mp, source: 'MANUAL' })
      }
    }
  }
  rawPurchases.sort((a, b) => a.date.localeCompare(b.date) || a.docCode.localeCompare(b.docCode))

  // 6. Build 06_San_Xuat
  const rawProductions: ProductionBatchRow[] = []
  if (scope !== 'template') {
    // Group LSX movements by batchCode to extract weighed plaster (`NVL-001`) if customized
    const lsxPlasterByBatch = new Map<string, number>()
    const lsxFinishedMovements: typeof dbMovements = []

    for (const mov of dbMovements) {
      const note = mov.note || ''
      const lsxMatch = /^\[(LSX-[^\]]+)\]/.exec(note)
      if (!lsxMatch) continue
      const batchCode = lsxMatch[1]
      if (mov.type === 'EXPORT' && mov.product.sku.trim().toUpperCase() === state.weighedMaterialCode) {
        lsxPlasterByBatch.set(batchCode, Math.abs(mov.quantity))
      } else if (mov.type === 'IMPORT' && mov.quantity > 0) {
        lsxFinishedMovements.push(mov)
      }
    }

    // Count how many finished items share the same LSX batch
    const lsxSkuCount = new Map<string, number>()
    for (const mov of lsxFinishedMovements) {
      const m = /^\[(LSX-[^\]]+)\]/.exec(mov.note || '')
      if (m) lsxSkuCount.set(m[1], (lsxSkuCount.get(m[1]) ?? 0) + 1)
    }

    for (const mov of lsxFinishedMovements) {
      const ymd = toLocalDateYmd(mov.createdAt)
      if (!isDateInScope(ymd)) continue
      const note = mov.note || ''
      const lsxMatch = /^\[(LSX-[^\]]+)\]/.exec(note)
      const batchCode = lsxMatch ? lsxMatch[1] : `LSX-${mov.id.slice(-6).toUpperCase()}`
      const { mappedSku, variantNote } = resolveCanonicalSku(
        mov.product.sku,
        mov.product.name,
        mov.product.attributes,
        knownSkuSet
      )
      ensureSkuInCatalog(mappedSku, mov.product.name, mov.product.costPrice, mov.product.costPrice * 2)
      const skuInfo = skuMap.get(mappedSku)
      const isCast = skuInfo?.pricingGroup === 'DECOR' || skuInfo?.pricingGroup === 'PHOI-SI'
      const opMatch = /Tổ SX:\s*([^·(]+)/i.exec(note)
      const singleSkuBatch = (lsxSkuCount.get(batchCode) ?? 1) === 1
      const consumedPlaster = singleSkuBatch ? (lsxPlasterByBatch.get(batchCode) ?? null) : null

      rawProductions.push({
        id: mov.id,
        date: ymd,
        batchCode,
        batchType: isCast ? 'Đúc' : 'Chiết / Đóng gói',
        sku: mappedSku,
        qtyStarted: mov.quantity,
        qtyGood: mov.quantity,
        actualPlasterGrams: consumedPlaster,
        actualMinutes: null,
        operator: opMatch ? opMatch[1].trim() : 'Xưởng Bơ Mộc',
        note: [variantNote, note.replace(/\s*\(Đã trừ NVL:.*\)$/i, '').trim()].filter(Boolean).join(' · '),
        source: 'CMS_PRODUCTION',
      })
    }

    for (const mb of state.manualProductions) {
      if (isDateInScope(mb.date)) {
        const dbProd = dbProductBySku.get(mb.sku.trim().toUpperCase())
        const { mappedSku, variantNote } = resolveCanonicalSku(
          mb.sku,
          dbProd?.name ?? mb.sku,
          dbProd?.attributes ?? null,
          knownSkuSet
        )
        ensureSkuInCatalog(
          mappedSku,
          dbProd?.name ?? mappedSku,
          dbProd?.costPrice ?? 0,
          dbProd?.sellPrice ?? (dbProd?.costPrice ? dbProd.costPrice * 2 : 0)
        )
        rawProductions.push({
          ...mb,
          sku: mappedSku,
          note: [variantNote, mb.note].filter(Boolean).join(' · '),
          source: 'MANUAL',
        })
      }
    }
  }
  rawProductions.sort((a, b) => a.date.localeCompare(b.date) || a.batchCode.localeCompare(b.batchCode))

  // 7. Build 07_Don_Ban
  const rawSales: SalesOrderRow[] = []
  if (scope !== 'template') {
    for (const ord of dbOrders) {
      const ymd = toLocalDateYmd(ord.createdAt)
      if (!isDateInScope(ymd)) continue
      if (ord.items.length === 0) continue

      const chKey = (ord.channel?.key || '').toUpperCase()
      const noteUpper = (ord.note || '').toUpperCase()

      // Determine order status in `baocao1` taxonomy
      const returnCase = ord.afterSalesCases.find(
        (c) => c.type === 'RETURN' && (c.status === 'RESOLVED' || c.status === 'PROCESSING')
      )
      let rowStatus: SalesOrderRow['status'] = 'Đang giao'
      if (ord.status === 'CANCELLED') {
        rowStatus = 'Đã hủy'
      } else if (returnCase) {
        const resText = `${returnCase.reason} ${returnCase.resolution || ''}`.toLowerCase()
        rowStatus = resText.includes('vỡ') || resText.includes('hỏng') ? 'Hoàn hỏng' : 'Hoàn nhập kho'
      } else if (
        ord.status === 'COMPLETED' ||
        ord.shipments.some((sh) => sh.status === 'DELIVERED')
      ) {
        rowStatus = 'Đã giao'
      }

      // Order-level fees: platformFee + voucher/discount + seller shipping subsidy
      const platformFee =
        ord.platformFee > 0
          ? Math.round(ord.platformFee)
          : Math.round((ord.subtotal * (ord.channel?.feePercent ?? 0)) / 100)
      const totalPlatformAndDiscount = platformFee + Math.round(ord.discountAmount || 0)

      const sh = ord.shipments[0]
      const isMarketplaceShipment =
        chKey === 'SHOPEE' ||
        chKey === 'TIKTOK' ||
        chKey === 'LAZADA' ||
        chKey === 'TIKI' ||
        sh?.carrier === 'SPX'
      let sellerShipPaid = 0
      if (sh) {
        const carrierFee =
          sh.fee > 0
            ? Math.round(sh.fee)
            : isMarketplaceShipment
              ? 0
              : (CARRIER_FEE_ESTIMATES[sh.carrier] ?? 20_000)
        sellerShipPaid = Math.max(0, carrierFee - Math.round(ord.shippingFee || 0))
      }

      const itemsSubtotal = ord.items.reduce((s, it) => s + it.price * it.quantity, 0)
      let remainingFee = totalPlatformAndDiscount
      let remainingShip = sellerShipPaid
      let lastAllocIdx = ord.items.length - 1
      if (itemsSubtotal > 0) {
        for (let k = ord.items.length - 1; k >= 0; k--) {
          if (ord.items[k].price * ord.items[k].quantity > 0) {
            lastAllocIdx = k
            break
          }
        }
      }

      ord.items.forEach((it, idx) => {
        const { mappedSku, variantNote } = resolveCanonicalSku(
          it.product.sku,
          it.product.name,
          it.product.attributes,
          knownSkuSet
        )
        ensureSkuInCatalog(mappedSku, it.product.name, it.product.costPrice, it.product.sellPrice)
        const skuObj = skuMap.get(mappedSku)

        let channelLabel: SalesOrderRow['channel'] = 'Lẻ Zalo / Website'
        if (chKey === 'SHOPEE' || chKey === 'TIKTOK' || chKey === 'LAZADA' || chKey === 'TIKI') {
          channelLabel = 'Shopee'
        } else if (skuObj?.categoryGroup === 'B' || noteUpper.includes('[SỈ]') || noteUpper.includes('ĐƠN SỈ')) {
          channelLabel = 'Sỉ'
        }

        const isLastAlloc = idx === lastAllocIdx
        const lineGross = Math.round(it.price * it.quantity)
        const share = itemsSubtotal > 0 ? lineGross / itemsSubtotal : 1 / ord.items.length
        const allocFee =
          itemsSubtotal > 0 && lineGross === 0
            ? 0
            : isLastAlloc
              ? remainingFee
              : Math.round(totalPlatformAndDiscount * share)
        const allocShip =
          itemsSubtotal > 0 && lineGross === 0
            ? 0
            : isLastAlloc
              ? remainingShip
              : Math.round(sellerShipPaid * share)
        remainingFee -= allocFee
        remainingShip -= allocShip

        const overriddenStatus =
          state.salesOrderStatusOverrides[it.id] ||
          state.salesOrderStatusOverrides[ord.code] ||
          rowStatus

        rawSales.push({
          id: it.id,
          date: ymd,
          orderCode: ord.code,
          channel: channelLabel,
          customer: ord.customer?.name || 'Khách lẻ',
          sku: mappedSku,
          qty: it.quantity,
          actualUnitPrice: Math.round(it.price),
          platformAndVoucherFee: allocFee,
          sellerShippingPaid: allocShip,
          status: overriddenStatus,
          note: [variantNote, ord.note].filter(Boolean).join(' · '),
          source: 'CMS_ORDER',
        })
      })
    }

    for (const ms of state.manualSalesOrders) {
      if (isDateInScope(ms.date)) {
        const dbProd = dbProductBySku.get(ms.sku.trim().toUpperCase())
        const { mappedSku, variantNote } = resolveCanonicalSku(
          ms.sku,
          dbProd?.name ?? ms.sku,
          dbProd?.attributes ?? null,
          knownSkuSet
        )
        ensureSkuInCatalog(
          mappedSku,
          dbProd?.name ?? mappedSku,
          dbProd?.costPrice ?? 0,
          dbProd?.sellPrice || ms.actualUnitPrice
        )
        const finalStatus =
          (ms.id && state.salesOrderStatusOverrides[ms.id]) || ms.status
        rawSales.push({
          ...ms,
          sku: mappedSku,
          status: finalStatus,
          note: [variantNote, ms.note].filter(Boolean).join(' · '),
          source: 'MANUAL',
        })
      }
    }
  }
  rawSales.sort((a, b) => a.date.localeCompare(b.date) || a.orderCode.localeCompare(b.orderCode))

  // 8. Build 08_Dieu_Chinh_Kho
  const rawAdjustments: StockAdjustmentRow[] = []
  if (scope !== 'template') {
    for (const mov of dbMovements) {
      if (mov.type !== 'ADJUST' && mov.type !== 'EXPORT') continue
      if (mov.quantity === 0) continue
      const note = mov.note || ''
      const noteUpper = note.toUpperCase()
      if (
        noteUpper.includes('[GỐC TỒN ĐẦU') ||
        noteUpper.includes('TỒN KHO ĐẦU KỲ') ||
        noteUpper.includes('(GO-LIVE)') ||
        noteUpper.includes('[LSX-') ||
        noteUpper.includes('XUẤT NVL SẢN XUẤT') ||
        noteUpper.includes('ĐƠN DH') ||
        noteUpper.includes('HÓA ĐƠN')
      ) {
        continue
      }
      const ymd = toLocalDateYmd(mov.createdAt)
      if (!isDateInScope(ymd)) continue

      const rawCode = mov.product.sku.trim().toUpperCase()
      const isMat = materialMap.has(rawCode) || isMaterialCode(rawCode, mov.product.type)
      if (isMat) {
        rawAdjustments.push({
          id: mov.id,
          date: ymd,
          kind: 'VT',
          code: rawCode,
          deltaQty: mov.quantity,
          reason: mov.type === 'ADJUST' ? 'Kiểm kê / Cân bằng kho' : 'Xuất khác / Dùng thử',
          note,
          source: 'CMS_MOVEMENT',
        })
      } else {
        const { mappedSku, variantNote } = resolveCanonicalSku(
          rawCode,
          mov.product.name,
          mov.product.attributes,
          knownSkuSet
        )
        ensureSkuInCatalog(mappedSku, mov.product.name, mov.product.costPrice, mov.product.costPrice * 2)
        rawAdjustments.push({
          id: mov.id,
          date: ymd,
          kind: 'TP',
          code: mappedSku,
          deltaQty: mov.quantity,
          reason: mov.type === 'ADJUST' ? 'Kiểm kê / Cân bằng kho' : 'Hư hỏng / Quà tặng / Dùng thử',
          note: [variantNote, note].filter(Boolean).join(' · '),
          source: 'CMS_MOVEMENT',
        })
      }
    }

    for (const ma of state.manualAdjustments) {
      if (isDateInScope(ma.date)) {
        if (ma.kind === 'TP') {
          const dbProd = dbProductBySku.get(ma.code.trim().toUpperCase())
          const { mappedSku, variantNote } = resolveCanonicalSku(
            ma.code,
            dbProd?.name ?? ma.code,
            dbProd?.attributes ?? null,
            knownSkuSet
          )
          ensureSkuInCatalog(
            mappedSku,
            dbProd?.name ?? mappedSku,
            dbProd?.costPrice ?? 0,
            dbProd?.sellPrice ?? (dbProd?.costPrice ? dbProd.costPrice * 2 : 0)
          )
          rawAdjustments.push({
            ...ma,
            code: mappedSku,
            note: [variantNote, ma.note].filter(Boolean).join(' · '),
            source: 'MANUAL',
          })
        } else {
          rawAdjustments.push({ ...ma, code: ma.code.trim().toUpperCase(), source: 'MANUAL' })
        }
      }
    }
  }
  rawAdjustments.sort((a, b) => a.date.localeCompare(b.date))

  const weighedCode = state.weighedMaterialCode || 'NVL-001'
  const otherCashflows =
    scope === 'template'
      ? []
      : state.otherCashflows
          .filter((cf) => isDateInScope(cf.date))
          .sort((a, b) => a.date.localeCompare(b.date))

  return assembleBaocao1Snapshot({
    scope,
    currentMonth,
    currentMonthNext,
    reportMonth,
    reportMonthNext,
    stocktakeCutoffDate,
    weighedCode,
    todayYmd,
    materials,
    skus,
    bomLines,
    openingStocks,
    rawPurchases,
    rawProductions,
    rawSales,
    rawAdjustments,
    otherCashflows,
  })
}

export function buildBaocao1Xlsx(snap: Baocao1FullSnapshot): Buffer {
  return buildXlsxBuffer(buildBaocao1Sheets(snap), (b) => deflateRawSync(b, { level: 6 }))
}
