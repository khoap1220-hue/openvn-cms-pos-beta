import {
  CANONICAL_MATERIALS,
  CANONICAL_SKUS,
  DEFAULT_STOCKTAKE_DATE,
  buildBaocao1Csv,
  buildBaocao1XlsxUint8Array,
  createDefaultBaocao1State,
  isMaterialCode,
  isValidBaocaoYmd,
  recomputeBaocaoSnapshotFromBase,
  toLocalDateYmd,
  type Baocao1DataScope,
  type Baocao1FullSnapshot,
  type Baocao1PersistedState,
  type OtherCashflowRow,
  type ProductionBatchRow,
  type PurchaseLogRow,
  type SalesOrderRow,
  type StockAdjustmentRow,
} from '@/lib/baocao1-core'

const STATIC_STORAGE_KEY = '__baocao_static_demo_v1'
const utf8Encoder = new TextEncoder()

const CANONICAL_MATERIAL_SET = new Set(CANONICAL_MATERIALS.map((m) => m.code))

const ALLOWED_SALES_CHANNELS = new Set<SalesOrderRow['channel']>([
  'Shopee',
  'Lẻ Zalo / Website',
  'Sỉ',
])

const ALLOWED_SALES_STATUSES = new Set<SalesOrderRow['status']>([
  'Đã giao',
  'Đang giao',
  'Hoàn nhập kho',
  'Hoàn hỏng',
  'Đã hủy',
])

let cachedFetchRef: typeof fetch | null = null
let cachedBaseAllSnap: Baocao1FullSnapshot | null = null

interface LegacyOverlayFields {
  bulkConfirmedOpeningDate?: string | null
}

function loadStaticState(): Baocao1PersistedState {
  if (typeof window === 'undefined') return createDefaultBaocao1State()
  try {
    const raw = window.localStorage.getItem(STATIC_STORAGE_KEY)
    if (!raw) return createDefaultBaocao1State()
    const parsed = JSON.parse(raw) as Partial<Baocao1PersistedState> & LegacyOverlayFields
    const state: Baocao1PersistedState = {
      weighedMaterialCode: parsed.weighedMaterialCode || 'NVL-001',
      stocktakeCutoffOverride: parsed.stocktakeCutoffOverride ?? null,
      openingStockOverrides: { ...(parsed.openingStockOverrides ?? {}) },
      materialReorderOverrides: { ...(parsed.materialReorderOverrides ?? {}) },
      skuMinStockOverrides: { ...(parsed.skuMinStockOverrides ?? {}) },
      manualPurchases: Array.isArray(parsed.manualPurchases) ? parsed.manualPurchases : [],
      manualProductions: Array.isArray(parsed.manualProductions) ? parsed.manualProductions : [],
      manualSalesOrders: Array.isArray(parsed.manualSalesOrders) ? parsed.manualSalesOrders : [],
      salesOrderStatusOverrides: { ...(parsed.salesOrderStatusOverrides ?? {}) },
      manualAdjustments: Array.isArray(parsed.manualAdjustments) ? parsed.manualAdjustments : [],
      otherCashflows: Array.isArray(parsed.otherCashflows) ? parsed.otherCashflows : [],
      updatedAt: parsed.updatedAt,
    }

    // Migrate legacy `bulkConfirmedOpeningDate` seamlessly if present
    if (parsed.bulkConfirmedOpeningDate) {
      applyBulkOpeningConfirmToState(state, parsed.bulkConfirmedOpeningDate)
    }
    return state
  } catch {
    return createDefaultBaocao1State()
  }
}

function saveStaticState(state: Baocao1PersistedState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STATIC_STORAGE_KEY,
      JSON.stringify({ ...state, updatedAt: new Date().toISOString() })
    )
  } catch {
    // Ignore storage quota errors
  }
}

function applyBulkOpeningConfirmToState(state: Baocao1PersistedState, stocktakeDate: string): void {
  for (const m of CANONICAL_MATERIALS) {
    if (m.status.startsWith('R&D')) continue
    const key = `VT:${m.code}`
    const prev = state.openingStockOverrides[key] ?? {}
    if (!prev.status || prev.status.startsWith('Ước tính')) {
      state.openingStockOverrides[key] = {
        ...prev,
        stocktakeDate: prev.stocktakeDate || stocktakeDate,
        status: 'Đã kiểm kê',
      }
    }
  }
  for (const s of CANONICAL_SKUS) {
    const key = `TP:${s.sku}`
    const prev = state.openingStockOverrides[key] ?? {}
    if (!prev.status || prev.status.startsWith('Ước tính')) {
      state.openingStockOverrides[key] = {
        ...prev,
        stocktakeDate: prev.stocktakeDate || stocktakeDate,
        status: 'Đã kiểm kê',
      }
    }
  }
}

function isKnownStaticMaterial(rawCode: string): boolean {
  const code = rawCode.trim().toUpperCase()
  if (!code) return false
  if (CANONICAL_MATERIAL_SET.has(code)) return true
  if (cachedBaseAllSnap?.materials.some((m) => m.code === code)) return true
  return false
}

function isStaticSubpathDemo(): boolean {
  if (typeof window === 'undefined') return false
  const win = window as unknown as { __BETA_SUBPATH_SHIM__?: unknown }
  return Boolean(win.__BETA_SUBPATH_SHIM__)
}

function parseScope(raw: string | null): Baocao1DataScope {
  if (raw === 'all' || raw === 'template') return raw
  return 'from_stocktake'
}

function getDefaultYm(): string {
  return toLocalDateYmd(new Date()).slice(0, 7)
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
  while (
    idx < bytes.length &&
    (bytes[idx] === 0x20 || bytes[idx] === 0x09 || bytes[idx] === 0x0d || bytes[idx] === 0x0a)
  ) {
    idx++
  }
  if (idx >= bytes.length) return false
  // Reject HTML ('<') or JSON ('{' / '[') static fallback payloads
  return bytes[idx] !== 0x3c && bytes[idx] !== 0x7b && bytes[idx] !== 0x5b
}

async function loadStaticBaseAllSnapshot(fallbackScope: Baocao1DataScope): Promise<Baocao1FullSnapshot> {
  if (cachedBaseAllSnap && cachedFetchRef === globalThis.fetch) {
    return cachedBaseAllSnap
  }

  const resAll = await fetch('/downloads/baocao-snapshot-all.json', {
    method: 'GET',
    credentials: 'include',
  })
  if (resAll.ok) {
    const snap = (await resAll.json()) as Baocao1FullSnapshot
    cachedFetchRef = globalThis.fetch
    cachedBaseAllSnap = snap
    return snap
  }

  if (fallbackScope !== 'all') {
    const resFallback = await fetch(`/downloads/baocao-snapshot-${fallbackScope}.json`, {
      method: 'GET',
      credentials: 'include',
    })
    if (resFallback.ok) {
      return (await resFallback.json()) as Baocao1FullSnapshot
    }
  }

  throw new Error(`Không thể tải dữ liệu báo cáo (HTTP ${resAll.status})`)
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

  const baseAllSnap = await loadStaticBaseAllSnapshot(opts.scope)
  return recomputeBaocaoSnapshotFromBase(baseAllSnap, loadStaticState(), {
    reportMonth: opts.reportMonth,
    currentMonth: opts.currentMonth,
    scope: opts.scope,
  })
}

export async function fetchBaocaoExportBlob(
  format: 'xlsx' | 'csv',
  params: URLSearchParams
): Promise<Blob> {
  const mime =
    format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv; charset=utf-8'

  // 1. On Fullstack Node.js server, stream directly from `/api/reports/baocao`
  if (!isStaticSubpathDemo()) {
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
    }
  }

  // 2. On Static CDN (GitHub Pages subpath / offline fallback), dynamically render live 13-sheet
  //    `.xlsx` (OpenXML PKZIP DEFLATE) or `.csv` (UTF-8 BOM) from the exact active snapshot + mutations!
  const scope = parseScope(params.get('scope'))
  const reportMonth = params.get('reportMonth') || params.get('month') || getDefaultYm()
  const currentMonth = params.get('currentMonth') || reportMonth

  try {
    const snap = await fetchBaocaoSnapshotClient({ reportMonth, currentMonth, scope })
    if (format === 'xlsx') {
      const xlsxBytes = await buildBaocao1XlsxUint8Array(snap)
      const bufCopy = new Uint8Array(xlsxBytes.byteLength)
      bufCopy.set(xlsxBytes)
      return new Blob([bufCopy], { type: mime })
    }
    const csvText = buildBaocao1Csv(snap)
    const csvBytes = utf8Encoder.encode(csvText)
    const csvCopy = new Uint8Array(csvBytes.byteLength)
    csvCopy.set(csvBytes)
    return new Blob([csvCopy], { type: mime })
  } catch {
    // Final emergency fallback to pre-generated static binary if JSON snapshot endpoint is absent
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

  // Static CDN demo mode (GitHub Pages subpath) — exact validation parity with `/api/reports/baocao`
  const state = loadStaticState()
  const cutoffDate = state.stocktakeCutoffOverride || DEFAULT_STOCKTAKE_DATE
  const action = String(payload.action || '').toUpperCase()
  const id = `st_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
  const date = String(payload.date || '').trim()

  if (action === 'RESET_STATE') {
    saveStaticState(createDefaultBaocao1State())
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_CASHFLOW') {
    const flowType = payload.flowType === 'Thu' ? 'Thu' : 'Chi'
    const group = String(payload.group || '').trim() || 'OPEX — Chi phí vận hành khác'
    const planCostCode = String(payload.planCostCode || '').trim()
    const description = String(payload.description || '').trim()
    const rawAmount = Number(payload.amount)
    const amount = Number.isFinite(rawAmount) ? Math.round(rawAmount) : 0
    const note = String(payload.note || '').trim()

    if (!isValidBaocaoYmd(date)) {
      throw new Error('Ngày thu/chi không hợp lệ (YYYY-MM-DD)')
    }
    if (!description) {
      throw new Error('Vui lòng nhập diễn giải khoản thu/chi')
    }
    if (amount <= 0) {
      throw new Error('Số tiền phải lớn hơn 0')
    }

    const item: OtherCashflowRow = {
      id,
      date,
      flowType,
      group,
      planCostCode,
      description,
      amount,
      note,
    }
    state.otherCashflows.push(item)
    saveStaticState(state)
    return {
      ok: true,
      item,
      cutoffDate,
      hiddenInFromStocktake: date <= cutoffDate,
    } as unknown as T
  }

  if (action === 'DELETE_CASHFLOW') {
    state.otherCashflows = state.otherCashflows.filter((x) => x.id !== String(payload.id || ''))
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_PRODUCTION') {
    const batchCode =
      String(payload.batchCode || '').trim() || `ME-${Date.now().toString(36).toUpperCase()}`
    const batchType = String(payload.batchType || 'Đúc').trim()
    const sku = String(payload.sku || '').trim().toUpperCase()
    const rawStarted = Number(payload.qtyStarted)
    const rawGood = Number(payload.qtyGood)
    const qtyStarted = Number.isFinite(rawStarted) ? Math.round(rawStarted) : 0
    const qtyGood = Number.isFinite(rawGood) ? Math.round(rawGood) : -1

    const rawPlaster = payload.actualPlasterGrams
    let actualPlasterGrams: number | null = null
    if (rawPlaster !== null && rawPlaster !== undefined && String(rawPlaster).trim() !== '') {
      const parsedPlaster = Number(rawPlaster)
      if (!Number.isFinite(parsedPlaster) || parsedPlaster < 0) {
        throw new Error('Số gram thạch cao cân thực không hợp lệ')
      }
      actualPlasterGrams = parsedPlaster > 0 ? parsedPlaster : null
    }

    const rawMin = payload.actualMinutes
    let actualMinutes: number | null = null
    if (rawMin !== null && rawMin !== undefined && String(rawMin).trim() !== '') {
      const parsedMin = Number(rawMin)
      if (!Number.isFinite(parsedMin) || parsedMin < 0) {
        throw new Error('Số phút làm thực tế không hợp lệ')
      }
      actualMinutes = Math.round(parsedMin)
    }

    if (!isValidBaocaoYmd(date)) {
      throw new Error('Ngày sản xuất không hợp lệ')
    }
    if (!sku) {
      throw new Error('Vui lòng chọn Mã SKU sản xuất')
    }
    if (qtyStarted <= 0 || qtyGood < 0 || qtyGood > qtyStarted) {
      throw new Error('SL đổ khuôn phải > 0 và SL đạt phải nằm trong khoảng [0 .. SL đổ khuôn]')
    }

    const item: ProductionBatchRow = {
      id,
      date,
      batchCode,
      batchType,
      sku,
      qtyStarted,
      qtyGood,
      actualPlasterGrams,
      actualMinutes,
      operator: String(payload.operator || 'Xưởng Bơ Mộc').trim(),
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    }
    state.manualProductions.push(item)
    saveStaticState(state)
    return {
      ok: true,
      item,
      cutoffDate,
      hiddenInFromStocktake: date <= cutoffDate,
    } as unknown as T
  }

  if (action === 'DELETE_PRODUCTION') {
    state.manualProductions = state.manualProductions.filter((x) => x.id !== String(payload.id || ''))
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_PURCHASE') {
    const qty = Number(payload.qtyStandardUnit)
    const paid = Number(payload.actualTotalPaid)
    const materialCode = String(payload.materialCode || '').trim().toUpperCase()
    if (
      !isValidBaocaoYmd(date) ||
      !materialCode ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !Number.isFinite(paid) ||
      paid < 0
    ) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã VT, SL (ĐVT chuẩn > 0) và Thành tiền hợp lệ')
    }
    if (!isKnownStaticMaterial(materialCode)) {
      throw new Error(`Mã vật tư "${materialCode}" không tồn tại trong Danh mục Vật tư (01_Vat_Tu)`)
    }

    const item: PurchaseLogRow = {
      id,
      date,
      docCode: String(payload.docCode || '').trim() || `MH-${Date.now().toString(36).toUpperCase()}`,
      supplier: String(payload.supplier || '').trim() || 'Nhà cung cấp',
      materialCode,
      qtyStandardUnit: qty,
      actualTotalPaid: Math.round(paid),
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    }
    state.manualPurchases.push(item)
    saveStaticState(state)
    return {
      ok: true,
      item,
      cutoffDate,
      hiddenInFromStocktake: date <= cutoffDate,
    } as unknown as T
  }

  if (action === 'DELETE_PURCHASE') {
    state.manualPurchases = state.manualPurchases.filter((x) => x.id !== String(payload.id || ''))
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_SALES_ORDER') {
    const channelRaw = String(payload.channel || 'Shopee').trim() as SalesOrderRow['channel']
    const channel: SalesOrderRow['channel'] = ALLOWED_SALES_CHANNELS.has(channelRaw)
      ? channelRaw
      : 'Shopee'
    const ddmm = isValidBaocaoYmd(date) ? `${date.slice(8, 10)}${date.slice(5, 7)}` : ''
    const defaultPrefix = channel === 'Shopee' ? 'SHP' : channel === 'Sỉ' ? 'SI' : 'LE'
    const orderCode =
      String(payload.orderCode || '').trim() ||
      `${defaultPrefix}-${ddmm || Date.now().toString(36).toUpperCase()}`
    const customer =
      String(payload.customer || '').trim() ||
      (channel === 'Shopee' ? 'Khách Shopee' : channel === 'Sỉ' ? 'Khách sỉ' : 'Khách lẻ')
    const sku = String(payload.sku || '').trim().toUpperCase()
    const rawQty = Number(payload.qty)
    const rawPrice = Number(payload.actualUnitPrice)
    const qty = Number.isFinite(rawQty) ? Math.round(rawQty) : 0
    const actualUnitPrice = Number.isFinite(rawPrice) ? Math.round(rawPrice) : -1

    if (!isValidBaocaoYmd(date) || !sku || qty <= 0 || actualUnitPrice < 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã SKU, SL (> 0) và Đơn giá bán thực hợp lệ')
    }

    const rawShip = Number(payload.sellerShippingPaid ?? 0)
    if (!Number.isFinite(rawShip) || rawShip < 0) {
      throw new Error('Ship shop trả không được âm')
    }
    const sellerShippingPaid = Math.round(rawShip)

    const grossAmount = qty * actualUnitPrice
    let platformAndVoucherFee = 0
    if (
      payload.netReceived !== null &&
      payload.netReceived !== undefined &&
      String(payload.netReceived).trim() !== ''
    ) {
      const parsedNet = Number(payload.netReceived)
      const maxNet = grossAmount - sellerShippingPaid
      if (!Number.isFinite(parsedNet) || parsedNet < 0 || parsedNet > maxNet) {
        throw new Error(
          sellerShippingPaid > 0
            ? 'Số tiền thực nhận + Ship shop trả không được vượt quá Thành tiền'
            : 'Số tiền thực nhận phải nằm trong khoảng [0 .. Thành tiền]'
        )
      }
      platformAndVoucherFee = Math.round(grossAmount - parsedNet - sellerShippingPaid)
    } else {
      const rawFee = Number(payload.platformAndVoucherFee ?? 0)
      if (!Number.isFinite(rawFee) || rawFee < 0) {
        throw new Error('Phí sàn / COD / voucher shop không được âm')
      }
      platformAndVoucherFee = Math.round(rawFee)
    }

    const statusRaw = String(payload.status || 'Đã giao').trim() as SalesOrderRow['status']
    if (!ALLOWED_SALES_STATUSES.has(statusRaw)) {
      throw new Error('Trạng thái đơn bán không hợp lệ')
    }

    const item: SalesOrderRow = {
      id,
      date,
      orderCode,
      channel,
      customer,
      sku,
      qty,
      actualUnitPrice,
      platformAndVoucherFee,
      sellerShippingPaid,
      status: statusRaw,
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    }
    state.manualSalesOrders.push(item)
    saveStaticState(state)
    return {
      ok: true,
      item,
      cutoffDate,
      hiddenInFromStocktake: date <= cutoffDate,
    } as unknown as T
  }

  if (action === 'UPDATE_SALES_ORDER_STATUS') {
    const targetId = String(payload.id || payload.orderCode || '').trim()
    const nextStatus = String(payload.status || '').trim() as SalesOrderRow['status']
    if (!targetId || !ALLOWED_SALES_STATUSES.has(nextStatus)) {
      throw new Error('Thiếu mã dòng đơn hoặc trạng thái không hợp lệ')
    }
    state.salesOrderStatusOverrides[targetId] = nextStatus
    state.manualSalesOrders = state.manualSalesOrders.map((so) =>
      so.id === targetId ? { ...so, status: nextStatus } : so
    )
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'DELETE_SALES_ORDER') {
    const targetId = String(payload.id || '')
    state.manualSalesOrders = state.manualSalesOrders.filter((so) => so.id !== targetId)
    delete state.salesOrderStatusOverrides[targetId]
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'ADD_ADJUSTMENT') {
    const kind = payload.kind === 'TP' ? 'TP' : 'VT'
    const code = String(payload.code || '').trim().toUpperCase()
    const rawDelta = Number(payload.deltaQty)
    const deltaQty = Number.isFinite(rawDelta) ? rawDelta : 0
    if (!isValidBaocaoYmd(date) || !code || deltaQty === 0) {
      throw new Error('Vui lòng nhập đủ Ngày, Mã và Số lượng điều chỉnh khác 0')
    }
    if (kind === 'VT' && !isKnownStaticMaterial(code)) {
      throw new Error(`Mã vật tư "${code}" không tồn tại trong Danh mục Vật tư (01_Vat_Tu)`)
    }
    if (kind === 'TP' && isMaterialCode(code)) {
      throw new Error(`Mã "${code}" là Vật tư — vui lòng chọn loại mã VT`)
    }

    const item: StockAdjustmentRow = {
      id,
      date,
      kind,
      code,
      deltaQty,
      reason: String(payload.reason || '').trim() || 'Điều chỉnh kiểm kê',
      note: String(payload.note || '').trim(),
      source: 'MANUAL',
    }
    state.manualAdjustments.push(item)
    saveStaticState(state)
    return {
      ok: true,
      item,
      cutoffDate,
      hiddenInFromStocktake: date <= cutoffDate,
    } as unknown as T
  }

  if (action === 'DELETE_ADJUSTMENT') {
    state.manualAdjustments = state.manualAdjustments.filter((x) => x.id !== String(payload.id || ''))
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'UPDATE_OPENING_STOCK') {
    const kind = payload.kind === 'TP' ? 'TP' : 'VT'
    const code = String(payload.code || '').trim().toUpperCase()
    if (!code) {
      throw new Error('Thiếu mã vật tư / SKU')
    }
    if (kind === 'VT' && !isKnownStaticMaterial(code)) {
      throw new Error(`Mã vật tư "${code}" không tồn tại trong Danh mục Vật tư`)
    }
    const key = `${kind}:${code}`
    const prev = state.openingStockOverrides[key] ?? {}

    let openingQty = prev.openingQty
    if (payload.openingQty !== undefined) {
      const parsed = Number(payload.openingQty)
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('SL tồn đầu kỳ không được âm')
      }
      openingQty = parsed
    }

    let stocktakeDate = prev.stocktakeDate
    if (typeof payload.stocktakeDate === 'string' && payload.stocktakeDate.trim() !== '') {
      if (!isValidBaocaoYmd(payload.stocktakeDate)) {
        throw new Error('Ngày kiểm kê không hợp lệ (YYYY-MM-DD)')
      }
      stocktakeDate = payload.stocktakeDate.trim()
    }

    state.openingStockOverrides[key] = {
      openingQty,
      stocktakeDate,
      status:
        typeof payload.status === 'string' && payload.status.trim()
          ? payload.status.trim()
          : prev.status,
      note: typeof payload.note === 'string' ? payload.note : prev.note,
    }
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'BULK_CONFIRM_OPENING_STOCK') {
    const stDate =
      typeof payload.stocktakeDate === 'string' && isValidBaocaoYmd(payload.stocktakeDate)
        ? payload.stocktakeDate.trim()
        : cutoffDate
    applyBulkOpeningConfirmToState(state, stDate)
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  if (action === 'UPDATE_THRESHOLDS' || action === 'UPDATE_CONFIG') {
    if (payload.weighedMaterialCode !== undefined) {
      const wm = String(payload.weighedMaterialCode || '').trim().toUpperCase()
      if (!wm || !isKnownStaticMaterial(wm)) {
        throw new Error('Mã vật tư cân thực tế không tồn tại trong Danh mục Vật tư (01_Vat_Tu)')
      }
      state.weighedMaterialCode = wm
    }
    if (payload.stocktakeCutoffOverride !== undefined) {
      const rawCut = String(payload.stocktakeCutoffOverride || '').trim()
      if (rawCut === '') {
        state.stocktakeCutoffOverride = null
      } else if (isValidBaocaoYmd(rawCut)) {
        state.stocktakeCutoffOverride = rawCut
      } else {
        throw new Error('Ngày chốt kiểm kê không hợp lệ')
      }
    }
    if (payload.materialCode) {
      const mc = String(payload.materialCode).trim().toUpperCase()
      if (!isKnownStaticMaterial(mc)) {
        throw new Error(`Mã vật tư "${mc}" không tồn tại trong Danh mục Vật tư`)
      }
      if (payload.reorderPoint === null || payload.reorderPoint === '') {
        state.materialReorderOverrides[mc] = null
      } else {
        const parsedRp = Number(payload.reorderPoint)
        if (!Number.isFinite(parsedRp) || parsedRp < 0) {
          throw new Error('Điểm đặt hàng lại không được âm')
        }
        state.materialReorderOverrides[mc] = parsedRp
      }
    }
    if (payload.sku) {
      const sk = String(payload.sku).trim().toUpperCase()
      const parsedMin = Number(payload.minFinishedStock)
      if (!Number.isFinite(parsedMin) || parsedMin < 0) {
        throw new Error('Tồn tối thiểu không được âm')
      }
      state.skuMinStockOverrides[sk] = Math.round(parsedMin)
    }
    saveStaticState(state)
    return { ok: true } as unknown as T
  }

  throw new Error('Hành động không hợp lệ')
}
