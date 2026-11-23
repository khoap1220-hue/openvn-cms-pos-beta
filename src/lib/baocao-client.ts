import type {
  Baocao1DataScope,
  Baocao1FullSnapshot,
  OtherCashflowRow,
  ProductionBatchRow,
  PurchaseLogRow,
  SalesOrderRow,
  StockAdjustmentRow,
} from '@/lib/baocao1-bomoc'

const STATIC_STORAGE_KEY = '__baocao_static_demo_v1'
const DEFAULT_CUTOFF_DATE = '2026-11-22'

interface StaticBaocaoOverlayState {
  weighedMaterialCode?: string
  stocktakeCutoffOverride?: string | null
  bulkConfirmedOpeningDate?: string | null
  openingStockOverrides: Record<
    string,
    { openingQty?: number; stocktakeDate?: string; status?: string; note?: string }
  >
  materialReorderOverrides: Record<string, number | null>
  skuMinStockOverrides: Record<string, number>
  salesOrderStatusOverrides: Record<string, SalesOrderRow['status']>
  manualPurchases: PurchaseLogRow[]
  manualProductions: ProductionBatchRow[]
  manualSalesOrders: SalesOrderRow[]
  manualAdjustments: StockAdjustmentRow[]
  otherCashflows: OtherCashflowRow[]
}

function emptyOverlayState(): StaticBaocaoOverlayState {
  return {
    openingStockOverrides: {},
    materialReorderOverrides: {},
    skuMinStockOverrides: {},
    salesOrderStatusOverrides: {},
    manualPurchases: [],
    manualProductions: [],
    manualSalesOrders: [],
    manualAdjustments: [],
    otherCashflows: [],
  }
}

function loadStaticOverlay(): StaticBaocaoOverlayState {
  if (typeof window === 'undefined') return emptyOverlayState()
  try {
    const raw = window.localStorage.getItem(STATIC_STORAGE_KEY)
    if (!raw) return emptyOverlayState()
    const parsed = JSON.parse(raw) as Partial<StaticBaocaoOverlayState>
    return {
      ...emptyOverlayState(),
      ...parsed,
      openingStockOverrides: parsed.openingStockOverrides ?? {},
      materialReorderOverrides: parsed.materialReorderOverrides ?? {},
      skuMinStockOverrides: parsed.skuMinStockOverrides ?? {},
      salesOrderStatusOverrides: parsed.salesOrderStatusOverrides ?? {},
      manualPurchases: Array.isArray(parsed.manualPurchases) ? parsed.manualPurchases : [],
      manualProductions: Array.isArray(parsed.manualProductions) ? parsed.manualProductions : [],
      manualSalesOrders: Array.isArray(parsed.manualSalesOrders) ? parsed.manualSalesOrders : [],
      manualAdjustments: Array.isArray(parsed.manualAdjustments) ? parsed.manualAdjustments : [],
      otherCashflows: Array.isArray(parsed.otherCashflows) ? parsed.otherCashflows : [],
    }
  } catch {
    return emptyOverlayState()
  }
}

function saveStaticOverlay(state: StaticBaocaoOverlayState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STATIC_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage quota errors
  }
}

function isStaticSubpathDemo(): boolean {
  if (typeof window === 'undefined') return false
  const win = window as unknown as { __BETA_SUBPATH_SHIM__?: unknown }
  return Boolean(win.__BETA_SUBPATH_SHIM__)
}

function normalizeYm(raw: string): { ym: string; start: string; nextStart: string } {
  const m = /^(\d{4})-(\d{2})/.exec(raw.trim())
  const now = new Date()
  const year = m ? Number(m[1]) : now.getFullYear()
  const month = m ? Number(m[2]) : now.getMonth() + 1
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const ym = `${year}-${String(month).padStart(2, '0')}`
  return {
    ym,
    start: `${ym}-01`,
    nextStart: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  }
}

function isPkzipBuffer(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  )
}

function isValidCsvBuffer(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false
  let idx = 0
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    idx = 3
  }
  while (idx < bytes.length && (bytes[idx] === 0x20 || bytes[idx] === 0x09 || bytes[idx] === 0x0d || bytes[idx] === 0x0a)) {
    idx++
  }
  if (idx >= bytes.length) return false
  // Reject HTML ('<') or JSON ('{' / '[') static fallback payloads
  return bytes[idx] !== 0x3c && bytes[idx] !== 0x7b && bytes[idx] !== 0x5b
}

export async function fetchBaocaoExportBlob(
  format: 'xlsx' | 'csv',
  params: URLSearchParams
): Promise<Blob> {
  const mime =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8'

  let fallbackNeeded = false
  try {
    const res = await fetch(`/api/reports/baocao?${params.toString()}`, {
      method: 'GET',
      credentials: 'include',
    })
    if (res.status === 401 || res.status === 403 || res.status === 400 || res.status === 503) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(errJson.error || `HTTP ${res.status}`)
    }
    if (res.ok) {
      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      if (format === 'xlsx' ? isPkzipBuffer(bytes) : isValidCsvBuffer(bytes)) {
        return new Blob([buf], { type: mime })
      }
      fallbackNeeded = true
    } else {
      fallbackNeeded = true
    }
  } catch (err) {
    if (
      err instanceof Error &&
      !(err instanceof TypeError) &&
      !err.message.startsWith('HTTP 404') &&
      !err.message.startsWith('HTTP 405')
    ) {
      throw err
    }
    fallbackNeeded = true
  }

  if (!fallbackNeeded) {
    throw new Error(`Không thể xuất tệp baocao.${format}`)
  }

  const staticRes = await fetch(`/downloads/baocao.${format}`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!staticRes.ok) {
    throw new Error(`HTTP ${staticRes.status}`)
  }
  const staticBuf = await staticRes.arrayBuffer()
  const staticBytes = new Uint8Array(staticBuf)
  if (!(format === 'xlsx' ? isPkzipBuffer(staticBytes) : isValidCsvBuffer(staticBytes))) {
    throw new Error(`Tệp tĩnh baocao.${format} không hợp lệ`)
  }
  return new Blob([staticBuf], { type: mime })
}

function applyStaticOverlayToSnapshot(
  base: Baocao1FullSnapshot,
  ov: StaticBaocaoOverlayState,
  opts: { reportMonth: string; currentMonth: string; scope: Baocao1DataScope }
): Baocao1FullSnapshot {
  const curM = normalizeYm(opts.currentMonth)
  const repM = normalizeYm(opts.reportMonth)
  const cutoffDate = ov.stocktakeCutoffOverride || base.meta.stocktakeCutoffDate || DEFAULT_CUTOFF_DATE
  const weighedCode = ov.weighedMaterialCode || base.meta.weighedMaterialCode || 'NVL-001'
  const filterDate = (d: string) => (opts.scope === 'from_stocktake' ? d > cutoffDate : true)

  const materials = base.materials.map((m) => ({
    ...m,
    reorderPoint:
      m.code in ov.materialReorderOverrides ? ov.materialReorderOverrides[m.code] : m.reorderPoint,
  }))
  const matMap = new Map(materials.map((m) => [m.code, m]))

  const skus = base.skus.map((s) => ({
    ...s,
    minFinishedStock:
      s.sku in ov.skuMinStockOverrides ? ov.skuMinStockOverrides[s.sku] : s.minFinishedStock,
  }))
  const skuMap = new Map(skus.map((s) => [s.sku, s]))

  const openingStocks = base.openingStocks.map((row) => {
    const key = `${row.kind}:${row.code}`
    const patch = ov.openingStockOverrides[key]
    const bulkStatus =
      ov.bulkConfirmedOpeningDate && row.status.startsWith('Ước tính')
        ? 'Đã kiểm kê'
        : row.status
    const bulkDate =
      ov.bulkConfirmedOpeningDate && row.status.startsWith('Ước tính')
        ? row.stocktakeDate || ov.bulkConfirmedOpeningDate
        : row.stocktakeDate
    if (!patch) {
      return {
        ...row,
        status: bulkStatus,
        stocktakeDate: bulkDate,
      }
    }
    return {
      ...row,
      openingQty: patch.openingQty ?? row.openingQty,
      stocktakeDate: patch.stocktakeDate ?? bulkDate,
      status: patch.status ?? bulkStatus,
      note: patch.note ?? row.note,
    }
  })

  const extraPurchases =
    opts.scope === 'template'
      ? []
      : ov.manualPurchases.filter((p) => filterDate(p.date)).map((p) => {
          const m = matMap.get(p.materialCode)
          const unitCost = p.qtyStandardUnit > 0 ? p.actualTotalPaid / p.qtyStandardUnit : null
          const stdCost = m?.standardUnitCost ?? null
          return {
            ...p,
            materialName: m?.name || p.materialCode,
            unit: m?.unit || '',
            actualUnitCost: unitCost,
            standardUnitCost: stdCost,
            variancePct:
              unitCost !== null && stdCost && stdCost > 0 ? (unitCost - stdCost) / stdCost : null,
          }
        })
  const purchases = [...base.purchases, ...extraPurchases]

  const bomBySku = new Map<string, Array<{ kind: 'NVL' | 'Bao bì'; materialCode: string; qtyPerUnit: number }>>()
  for (const b of base.bom) {
    const arr = bomBySku.get(b.sku) ?? []
    arr.push(b)
    bomBySku.set(b.sku, arr)
  }

  const extraProductions =
    opts.scope === 'template'
      ? []
      : ov.manualProductions.filter((p) => filterDate(p.date)).map((p) => {
          const s = skuMap.get(p.sku)
          const weighedBom = (bomBySku.get(p.sku) ?? []).find((b) => b.materialCode === weighedCode)
          const stdPlaster = (weighedBom?.qtyPerUnit ?? 0) * p.qtyStarted
          const hasActual = p.actualPlasterGrams !== null && p.actualPlasterGrams > 0
          const deducted = hasActual ? (p.actualPlasterGrams as number) : stdPlaster
          const defectQty = Math.max(0, p.qtyStarted - p.qtyGood)
          return {
            ...p,
            skuName: s?.name || p.sku,
            defectQty,
            defectPct: p.qtyStarted > 0 ? defectQty / p.qtyStarted : null,
            standardPlasterGrams: stdPlaster,
            deductedPlasterGrams: deducted,
            plasterVarianceGrams: hasActual ? deducted - stdPlaster : null,
          }
        })
  const productions = [...base.productions, ...extraProductions]

  const mapSalesRow = (so: SalesOrderRow) => {
    const status = (so.id && ov.salesOrderStatusOverrides[so.id]) || so.status
    const s = skuMap.get(so.sku)
    const grossAmount = so.qty * so.actualUnitPrice
    const netPayout = grossAmount - so.platformAndVoucherFee - so.sellerShippingPaid
    const isDelivered = status === 'Đã giao'
    const isIntactReturn = status === 'Hoàn nhập kho'
    const isDamagedReturn = status === 'Hoàn hỏng'
    const recognizedRevenue = isDelivered ? grossAmount : 0
    const recognizedNetPayout = isDelivered
      ? netPayout
      : isIntactReturn || isDamagedReturn
        ? -(so.platformAndVoucherFee + so.sellerShippingPaid)
        : 0
    const stockOutQty = isDelivered || isDamagedReturn ? so.qty : 0
    const packagingOutQty = isDelivered || isIntactReturn || isDamagedReturn ? so.qty : 0
    const standardCogs = (isDelivered || isDamagedReturn ? so.qty : 0) * (s?.standardCost ?? 0)
    const grossProfit = recognizedNetPayout - standardCogs
    const channelStandardPrice =
      so.channel === 'Shopee'
        ? (s?.shopeeActualPrice ?? s?.retailPrice ?? 0)
        : so.channel === 'Sỉ'
          ? s?.categoryGroup === 'B'
            ? (s?.retailPrice ?? 0)
            : (s?.wholesaleB1 ?? 0)
          : (s?.retailPrice ?? 0)
    return {
      ...so,
      status,
      skuName: s?.name || so.sku,
      grossAmount,
      netPayout,
      recognizedRevenue,
      recognizedNetPayout,
      stockOutQty,
      packagingOutQty,
      standardCogs,
      grossProfit,
      channelStandardPrice,
    }
  }

  const baseSales = base.salesOrders.map((so) => mapSalesRow(so))
  const extraSales =
    opts.scope === 'template'
      ? []
      : ov.manualSalesOrders.filter((so) => filterDate(so.date)).map((so) => mapSalesRow(so))
  const salesOrders = [...baseSales, ...extraSales]

  const extraAdjustments =
    opts.scope === 'template'
      ? []
      : ov.manualAdjustments.filter((a) => filterDate(a.date)).map((a) => ({
          ...a,
          name:
            a.kind === 'VT'
              ? matMap.get(a.code)?.name || a.code
              : skuMap.get(a.code)?.name || a.code,
        }))
  const adjustments = [...base.adjustments, ...extraAdjustments]

  const otherCashflows =
    opts.scope === 'template'
      ? []
      : [...base.otherCashflows, ...ov.otherCashflows.filter((c) => filterDate(c.date))]

  const openMap = new Map(openingStocks.map((o) => [`${o.kind}:${o.code}`, o.openingQty]))

  const materialInventory = base.materialInventory.map((mi) => {
    const m = matMap.get(mi.code)
    const openingQty = openMap.get(`VT:${mi.code}`) ?? mi.openingQty
    const purchasedQty = purchases
      .filter((p) => p.materialCode === mi.code)
      .reduce((sum, p) => sum + p.qtyStandardUnit, 0)
    let productionUsedQty = 0
    for (const pr of productions) {
      if (mi.code === weighedCode) {
        productionUsedQty += pr.deductedPlasterGrams
      } else {
        const line = (bomBySku.get(pr.sku) ?? []).find(
          (b) => b.kind === 'NVL' && b.materialCode === mi.code
        )
        if (line) productionUsedQty += line.qtyPerUnit * pr.qtyStarted
      }
    }
    let packagingSoldQty = 0
    for (const so of salesOrders) {
      if (so.packagingOutQty <= 0) continue
      const line = (bomBySku.get(so.sku) ?? []).find(
        (b) => b.kind === 'Bao bì' && b.materialCode === mi.code
      )
      if (line) packagingSoldQty += line.qtyPerUnit * so.packagingOutQty
    }
    const adjustedQty = adjustments
      .filter((a) => a.kind === 'VT' && a.code === mi.code)
      .reduce((sum, a) => sum + a.deltaQty, 0)
    const currentQty = openingQty + purchasedQty - productionUsedQty - packagingSoldQty + adjustedQty
    const reorderPoint = m ? m.reorderPoint : mi.reorderPoint
    const alert: '' | 'OK' | 'CẦN ĐẶT HÀNG' | 'ÂM KHO' =
      currentQty < 0
        ? 'ÂM KHO'
        : reorderPoint !== null && currentQty <= reorderPoint
          ? 'CẦN ĐẶT HÀNG'
          : mi.status.startsWith('R&D')
            ? ''
            : 'OK'
    return {
      ...mi,
      openingQty,
      purchasedQty,
      productionUsedQty,
      packagingSoldQty,
      adjustedQty,
      currentQty,
      reorderPoint,
      alert,
      stockValue: Math.max(0, currentQty) * mi.standardUnitCost,
    }
  })

  const finishedInventory = base.finishedInventory.map((fi) => {
    const s = skuMap.get(fi.sku)
    const openingQty = openMap.get(`TP:${fi.sku}`) ?? fi.openingQty
    const producedGoodQty = productions
      .filter((p) => p.sku === fi.sku)
      .reduce((sum, p) => sum + p.qtyGood, 0)
    const soldOutQty = salesOrders
      .filter((so) => so.sku === fi.sku)
      .reduce((sum, so) => sum + so.stockOutQty, 0)
    const adjustedQty = adjustments
      .filter((a) => a.kind === 'TP' && a.code === fi.sku)
      .reduce((sum, a) => sum + a.deltaQty, 0)
    const currentQty = openingQty + producedGoodQty - soldOutQty + adjustedQty
    const minStock = s ? s.minFinishedStock : fi.minStock
    const alert: '' | 'OK' | 'CẦN ĐÚC / ĐÓNG THÊM' | 'ÂM KHO' =
      currentQty < 0 ? 'ÂM KHO' : currentQty < minStock ? 'CẦN ĐÚC / ĐÓNG THÊM' : 'OK'
    return {
      ...fi,
      openingQty,
      producedGoodQty,
      soldOutQty,
      adjustedQty,
      currentQty,
      minStock,
      alert,
      stockValue: Math.max(0, currentQty) * fi.standardCost,
    }
  })

  const inCur = (d: string) => d >= curM.start && d < curM.nextStart
  const inRep = (d: string) => d >= repM.start && d < repM.nextStart

  const curSales = salesOrders.filter((s) => inCur(s.date))
  const curProds = productions.filter((p) => inCur(p.date))
  const curPurch = purchases.filter((p) => inCur(p.date))
  const curCf = otherCashflows.filter((c) => inCur(c.date))

  const repSales = salesOrders.filter((s) => inRep(s.date))
  const repProds = productions.filter((p) => inRep(p.date))
  const repPurch = purchases.filter((p) => inRep(p.date))
  const repCf = otherCashflows.filter((c) => inRep(c.date))

  const byChannel = base.monthlyReport.byChannel.map((ch) => {
    const rows = repSales.filter((s) => s.channel === ch.channel)
    const actualQty = rows
      .filter((s) => s.status === 'Đã giao')
      .reduce((sum, s) => sum + s.qty, 0)
    const actualRevenue = rows.reduce((sum, s) => sum + s.recognizedRevenue, 0)
    const actualNetPayout = rows.reduce((sum, s) => sum + s.recognizedNetPayout, 0)
    const standardCogs = rows.reduce((sum, s) => sum + s.standardCogs, 0)
    const actualGrossProfit = rows.reduce((sum, s) => sum + s.grossProfit, 0)
    return {
      ...ch,
      actualQty,
      qtyAchievementPct: ch.planQty > 0 ? actualQty / ch.planQty : null,
      actualRevenue,
      actualNetPayout,
      standardCogs,
      actualGrossProfit,
    }
  })

  const channelTotal = {
    ...base.monthlyReport.channelTotal,
    actualQty: byChannel.reduce((s, c) => s + c.actualQty, 0),
    actualRevenue: byChannel.reduce((s, c) => s + c.actualRevenue, 0),
    actualNetPayout: byChannel.reduce((s, c) => s + c.actualNetPayout, 0),
    standardCogs: byChannel.reduce((s, c) => s + c.standardCogs, 0),
    actualGrossProfit: byChannel.reduce((s, c) => s + c.actualGrossProfit, 0),
  }
  channelTotal.qtyAchievementPct =
    channelTotal.planQty > 0 ? channelTotal.actualQty / channelTotal.planQty : null

  const actualOpex = -repCf
    .filter((c) => c.flowType === 'Chi' && c.group.startsWith('OPEX'))
    .reduce((sum, c) => sum + c.amount, 0)
  const actualNetProfit = channelTotal.actualGrossProfit + actualOpex
  const netFromSales = channelTotal.actualNetPayout
  const otherIncome = repCf
    .filter((c) => c.flowType === 'Thu')
    .reduce((sum, c) => sum + c.amount, 0)
  const materialPurchases = -repPurch.reduce((sum, p) => sum + p.actualTotalPaid, 0)
  const otherExpenses = -repCf
    .filter((c) => c.flowType === 'Chi')
    .reduce((sum, c) => sum + c.amount, 0)

  const totalQtyStarted = repProds.reduce((s, p) => s + p.qtyStarted, 0)
  const totalQtyGood = repProds.reduce((s, p) => s + p.qtyGood, 0)
  const weighedRows = repProds.filter(
    (p) => p.actualPlasterGrams !== null && p.actualPlasterGrams > 0
  )
  const weighedPlasterActualGrams = weighedRows.reduce(
    (s, p) => s + (p.actualPlasterGrams ?? 0),
    0
  )
  const weighedPlasterStandardGrams = weighedRows.reduce(
    (s, p) => s + p.standardPlasterGrams,
    0
  )

  return {
    ...base,
    meta: {
      ...base.meta,
      currentMonth: curM.start,
      currentMonthNext: curM.nextStart,
      reportMonth: repM.start,
      reportMonthNext: repM.nextStart,
      scope: opts.scope,
      stocktakeCutoffDate: cutoffDate,
      weighedMaterialCode: weighedCode,
    },
    overview: {
      thisMonth: {
        ...base.overview.thisMonth,
        recognizedRevenue: curSales.reduce((s, r) => s + r.recognizedRevenue, 0),
        netPayout: curSales.reduce((s, r) => s + r.recognizedNetPayout, 0),
        grossProfit: curSales.reduce((s, r) => s + r.grossProfit, 0),
        soldUnits: curSales
          .filter((r) => r.status === 'Đã giao')
          .reduce((s, r) => s + r.qty, 0),
        producedGoodUnits: curProds.reduce((s, p) => s + p.qtyGood, 0),
        materialPurchaseSpent: curPurch.reduce((s, p) => s + p.actualTotalPaid, 0),
        otherExpenses: curCf
          .filter((c) => c.flowType === 'Chi')
          .reduce((s, c) => s + c.amount, 0),
      },
      stockAlerts: {
        materialsNeedReorder: materialInventory.filter((m) => m.alert === 'CẦN ĐẶT HÀNG').length,
        skusNeedProduction: finishedInventory.filter((f) => f.alert === 'CẦN ĐÚC / ĐÓNG THÊM')
          .length,
        negativeStockCodes:
          materialInventory.filter((m) => m.currentQty < 0).length +
          finishedInventory.filter((f) => f.currentQty < 0).length,
        materialStockValue: materialInventory.reduce((s, m) => s + m.stockValue, 0),
        finishedStockValue: finishedInventory.reduce((s, f) => s + f.stockValue, 0),
        unverifiedOpeningCount: openingStocks.filter((o) => o.status.startsWith('Ước tính')).length,
      },
    },
    materials,
    skus,
    openingStocks,
    purchases,
    productions,
    salesOrders,
    adjustments,
    materialInventory,
    finishedInventory,
    otherCashflows,
    monthlyReport: {
      ...base.monthlyReport,
      byChannel,
      channelTotal,
      pnl: {
        ...base.monthlyReport.pnl,
        actualGrossProfit: channelTotal.actualGrossProfit,
        actualOpex,
        actualNetProfit,
        estimatedFamilyIncomeActual:
          actualNetProfit + base.monthlyReport.pnl.directLaborActual,
      },
      productionSummary: {
        batchCount: repProds.length,
        totalQtyStarted,
        totalQtyGood,
        defectRate: totalQtyStarted > 0 ? (totalQtyStarted - totalQtyGood) / totalQtyStarted : null,
        weighedPlasterActualGrams,
        weighedPlasterStandardGrams,
        plasterVarianceGrams: weighedPlasterActualGrams - weighedPlasterStandardGrams,
      },
      cashflow: {
        netFromSales,
        otherIncome,
        materialPurchases,
        otherExpenses,
        netCashflow: netFromSales + otherIncome + materialPurchases + otherExpenses,
      },
    },
  }
}

export async function fetchBaocaoSnapshotClient(opts: {
  reportMonth: string
  currentMonth: string
  scope: Baocao1DataScope
}): Promise<Baocao1FullSnapshot> {
  const params = new URLSearchParams({
    format: 'json',
    month: opts.reportMonth,
    reportMonth: opts.reportMonth,
    currentMonth: opts.currentMonth,
    scope: opts.scope,
  })

  if (!isStaticSubpathDemo()) {
    const res = await fetch(`/api/reports/baocao?${params.toString()}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'include',
    })
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 503) {
      const errJson = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(errJson.error || `Lỗi ${res.status}`)
    }
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as Baocao1FullSnapshot | null
      if (data?.meta && data.meta.scope === opts.scope) {
        return data
      }
    }
  }

  const staticRes = await fetch(`/downloads/baocao-snapshot-${opts.scope}.json`, {
    method: 'GET',
    credentials: 'include',
  })
  if (!staticRes.ok) {
    throw new Error(`Không thể tải dữ liệu báo cáo (HTTP ${staticRes.status})`)
  }
  const baseSnap = (await staticRes.json()) as Baocao1FullSnapshot
  return applyStaticOverlayToSnapshot(baseSnap, loadStaticOverlay(), opts)
}

export async function postBaocaoActionClient<T = { ok: boolean }>(
  payload: Record<string, unknown>
): Promise<T> {
  if (!isStaticSubpathDemo()) {
    try {
      const res = await fetch('/api/reports/baocao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 503) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errJson.error || `Lỗi ${res.status}`)
      }
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
        if (!json.static_demo && !json.synced_2way) {
          return json as T
        }
      }
    } catch (err) {
      if (err instanceof Error && !(err instanceof TypeError)) {
        throw err
      }
    }
  }

  // Static CDN demo mode (GitHub Pages subpath)
  const ov = loadStaticOverlay()
  const cutoffDate = ov.stocktakeCutoffOverride || DEFAULT_CUTOFF_DATE
  const action = String(payload.action || '').toUpperCase()
  const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const date = String(payload.date || '').trim()

  if (action === 'RESET_STATE') {
    saveStaticOverlay(emptyOverlayState())
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_PURCHASE') {
    const qty = Number(payload.qtyStandardUnit)
    const paid = Number(payload.actualTotalPaid)
    const materialCode = String(payload.materialCode || '').trim().toUpperCase()
    if (!date || !materialCode || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(paid) || paid < 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã VT, SL (> 0) và Thành tiền hợp lệ')
    }
    ov.manualPurchases.push({
      id,
      date,
      docCode: String(payload.docCode || '').trim() || `MH-${Date.now().toString(36).toUpperCase()}`,
      supplier: String(payload.supplier || 'Nhà cung cấp').trim(),
      materialCode,
      qtyStandardUnit: qty,
      actualTotalPaid: Math.round(paid),
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    })
  } else if (action === 'DELETE_PURCHASE') {
    ov.manualPurchases = ov.manualPurchases.filter((x) => x.id !== String(payload.id || ''))
  } else if (action === 'ADD_PRODUCTION') {
    const qtyStarted = Math.round(Number(payload.qtyStarted))
    const qtyGood = Math.round(Number(payload.qtyGood))
    const sku = String(payload.sku || '').trim().toUpperCase()
    if (!date || !sku || qtyStarted <= 0 || qtyGood < 0 || qtyGood > qtyStarted) {
      throw new Error('SL đổ khuôn phải > 0 và SL đạt phải nằm trong khoảng [0 .. SL đổ khuôn]')
    }
    const rawPlaster = payload.actualPlasterGrams
    const parsedPlaster =
      rawPlaster === null || rawPlaster === undefined || String(rawPlaster).trim() === ''
        ? null
        : Number(rawPlaster)
    const rawMin = payload.actualMinutes
    const parsedMin =
      rawMin === null || rawMin === undefined || String(rawMin).trim() === ''
        ? null
        : Math.round(Number(rawMin))
    ov.manualProductions.push({
      id,
      date,
      batchCode: String(payload.batchCode || '').trim() || `ME-${Date.now().toString(36).toUpperCase()}`,
      batchType: String(payload.batchType || 'Đúc').trim(),
      sku,
      qtyStarted,
      qtyGood,
      actualPlasterGrams: parsedPlaster && parsedPlaster > 0 ? parsedPlaster : null,
      actualMinutes: parsedMin,
      operator: String(payload.operator || 'Xưởng Bơ Mộc').trim(),
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    })
  } else if (action === 'DELETE_PRODUCTION') {
    ov.manualProductions = ov.manualProductions.filter((x) => x.id !== String(payload.id || ''))
  } else if (action === 'ADD_SALES_ORDER') {
    const qty = Math.round(Number(payload.qty))
    const actualUnitPrice = Math.round(Number(payload.actualUnitPrice))
    const sku = String(payload.sku || '').trim().toUpperCase()
    if (!date || !sku || qty <= 0 || actualUnitPrice < 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã SKU, SL (> 0) và Đơn giá bán thực hợp lệ')
    }
    const ship = Math.max(0, Math.round(Number(payload.sellerShippingPaid ?? 0)))
    const gross = qty * actualUnitPrice
    let fee = Math.max(0, Math.round(Number(payload.platformAndVoucherFee ?? 0)))
    if (
      payload.netReceived !== null &&
      payload.netReceived !== undefined &&
      String(payload.netReceived).trim() !== ''
    ) {
      const net = Number(payload.netReceived)
      if (!Number.isFinite(net) || net < 0 || net > gross - ship) {
        throw new Error('Số tiền thực nhận + Ship shop trả không được vượt quá Thành tiền')
      }
      fee = Math.round(gross - net - ship)
    }
    const channel = (payload.channel as SalesOrderRow['channel']) || 'Shopee'
    ov.manualSalesOrders.push({
      id,
      date,
      orderCode: String(payload.orderCode || '').trim() || `SHP-${Date.now().toString(36).toUpperCase()}`,
      channel,
      customer: String(payload.customer || 'Khách hàng').trim(),
      sku,
      qty,
      actualUnitPrice,
      platformAndVoucherFee: fee,
      sellerShippingPaid: ship,
      status: (payload.status as SalesOrderRow['status']) || 'Đã giao',
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    })
  } else if (action === 'UPDATE_SALES_ORDER_STATUS') {
    const targetId = String(payload.id || payload.orderCode || '').trim()
    const nextStatus = payload.status as SalesOrderRow['status']
    ov.salesOrderStatusOverrides[targetId] = nextStatus
    ov.manualSalesOrders = ov.manualSalesOrders.map((so) =>
      so.id === targetId ? { ...so, status: nextStatus } : so
    )
  } else if (action === 'DELETE_SALES_ORDER') {
    const targetId = String(payload.id || '')
    ov.manualSalesOrders = ov.manualSalesOrders.filter((so) => so.id !== targetId)
    delete ov.salesOrderStatusOverrides[targetId]
  } else if (action === 'ADD_ADJUSTMENT') {
    const deltaQty = Number(payload.deltaQty)
    const code = String(payload.code || '').trim().toUpperCase()
    if (!date || !code || !Number.isFinite(deltaQty) || deltaQty === 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã và Số lượng điều chỉnh khác 0')
    }
    ov.manualAdjustments.push({
      id,
      date,
      kind: payload.kind === 'TP' ? 'TP' : 'VT',
      code,
      deltaQty,
      reason: String(payload.reason || 'Điều chỉnh kiểm kê').trim(),
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    })
  } else if (action === 'DELETE_ADJUSTMENT') {
    ov.manualAdjustments = ov.manualAdjustments.filter((x) => x.id !== String(payload.id || ''))
  } else if (action === 'ADD_CASHFLOW') {
    const amount = Math.round(Number(payload.amount))
    const description = String(payload.description || '').trim()
    if (!date || !description || !Number.isFinite(amount) || amount <= 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Diễn giải và Số tiền > 0')
    }
    ov.otherCashflows.push({
      id,
      date,
      flowType: payload.flowType === 'Thu' ? 'Thu' : 'Chi',
      group: String(payload.group || 'OPEX — Chi phí vận hành khác').trim(),
      planCostCode: String(payload.planCostCode || 'OPEX').trim(),
      description,
      amount,
      note: String(payload.note || '').trim(),
    })
  } else if (action === 'DELETE_CASHFLOW') {
    ov.otherCashflows = ov.otherCashflows.filter((x) => x.id !== String(payload.id || ''))
  } else if (action === 'UPDATE_OPENING_STOCK') {
    const kind = payload.kind === 'TP' ? 'TP' : 'VT'
    const code = String(payload.code || '').trim().toUpperCase()
    const key = `${kind}:${code}`
    const prev = ov.openingStockOverrides[key] ?? {}
    ov.openingStockOverrides[key] = {
      openingQty: payload.openingQty !== undefined ? Number(payload.openingQty) : prev.openingQty,
      stocktakeDate:
        typeof payload.stocktakeDate === 'string' && payload.stocktakeDate.trim()
          ? payload.stocktakeDate.trim()
          : prev.stocktakeDate,
      status:
        typeof payload.status === 'string' && payload.status.trim()
          ? payload.status.trim()
          : prev.status,
      note: typeof payload.note === 'string' ? payload.note : prev.note,
    }
  } else if (action === 'BULK_CONFIRM_OPENING_STOCK') {
    ov.bulkConfirmedOpeningDate =
      typeof payload.stocktakeDate === 'string' && payload.stocktakeDate.trim()
        ? payload.stocktakeDate.trim()
        : cutoffDate
  } else if (action === 'UPDATE_CONFIG' || action === 'UPDATE_THRESHOLDS') {
    if (payload.weighedMaterialCode) {
      ov.weighedMaterialCode = String(payload.weighedMaterialCode).trim().toUpperCase()
    }
    if (payload.materialCode) {
      const mc = String(payload.materialCode).trim().toUpperCase()
      ov.materialReorderOverrides[mc] =
        payload.reorderPoint === null || payload.reorderPoint === ''
          ? null
          : Number(payload.reorderPoint)
    }
    if (payload.sku) {
      const sk = String(payload.sku).trim().toUpperCase()
      ov.skuMinStockOverrides[sk] = Math.max(0, Math.round(Number(payload.minFinishedStock || 0)))
    }
  }

  saveStaticOverlay(ov)
  return {
    ok: true,
    cutoffDate,
    hiddenInFromStocktake: Boolean(date && date <= cutoffDate),
  } as unknown as T
}
