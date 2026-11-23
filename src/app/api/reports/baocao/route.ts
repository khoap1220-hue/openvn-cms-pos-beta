import { NextRequest, NextResponse } from 'next/server'
import {
  CANONICAL_MATERIALS,
  CANONICAL_SKUS,
  DEFAULT_STOCKTAKE_DATE,
  type Baocao1DataScope,
  type OtherCashflowRow,
  type ProductionBatchRow,
  type PurchaseLogRow,
  type SalesOrderRow,
  type StockAdjustmentRow,
  buildBaocao1Csv,
  buildBaocao1Snapshot,
  buildBaocao1Xlsx,
  createDefaultBaocao1State,
  isMaterialCode,
  readBaocao1State,
  withBaocao1StateLock,
  writeBaocao1State,
} from '@/lib/baocao1-bomoc'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

const CANONICAL_MATERIAL_SET = new Set(CANONICAL_MATERIALS.map((m) => m.code))

async function isKnownMaterialCode(rawCode: string): Promise<boolean> {
  const code = rawCode.trim().toUpperCase()
  if (!code) return false
  if (CANONICAL_MATERIAL_SET.has(code)) return true
  const prod = await db.product.findFirst({
    where: { sku: code },
    select: { sku: true, type: true },
  })
  return Boolean(prod && isMaterialCode(prod.sku, prod.type))
}

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

function parseScope(raw: string | null): Baocao1DataScope {
  if (raw === 'all' || raw === 'template') return raw
  return 'from_stocktake'
}

function isValidYmd(str: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim())
  if (!m) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 2020 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false
  const dt = new Date(Date.UTC(year, month - 1, day))
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() + 1 === month &&
    dt.getUTCDate() === day
  )
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const format = (searchParams.get('format') || 'json').toLowerCase()
    const reportMonth = searchParams.get('month') || searchParams.get('reportMonth')
    const currentMonth = searchParams.get('currentMonth') || reportMonth
    const scope = parseScope(searchParams.get('scope'))

    const snapshot = await buildBaocao1Snapshot({
      reportMonth,
      currentMonth,
      scope,
    })

    if (format === 'xlsx' || format === 'excel') {
      const xlsxBuf = buildBaocao1Xlsx(snapshot)
      return new NextResponse(new Uint8Array(xlsxBuf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="baocao.xlsx"',
          'Content-Length': String(xlsxBuf.byteLength),
          'Cache-Control': 'no-store',
        },
      })
    }

    if (format === 'csv') {
      const csvText = buildBaocao1Csv(snapshot)
      const csvBytes = Buffer.from(csvText, 'utf8')
      return new NextResponse(new Uint8Array(csvBytes), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="baocao.csv"',
          'Content-Length': String(csvBytes.byteLength),
          'Cache-Control': 'no-store',
        },
      })
    }

    return NextResponse.json(snapshot)
  } catch (error) {
    console.error('Baocao GET error:', error)
    return NextResponse.json(
      { error: 'Không thể tổng hợp hoặc xuất mẫu báo cáo vận hành Bơ Mộc (baocao)' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const action = String(body.action || '').toUpperCase()

    return await withBaocao1StateLock(async () => {
      const state = readBaocao1State()
      const cutoffDate = state.stocktakeCutoffOverride || DEFAULT_STOCKTAKE_DATE

      if (action === 'ADD_CASHFLOW') {
        const date = String(body.date || '').trim()
        const flowType = body.flowType === 'Thu' ? 'Thu' : 'Chi'
        const group = String(body.group || '').trim() || 'OPEX — Chi phí vận hành khác'
        const planCostCode = String(body.planCostCode || '').trim()
        const description = String(body.description || '').trim()
        const rawAmount = Number(body.amount)
        const amount = Number.isFinite(rawAmount) ? Math.round(rawAmount) : 0
        const note = String(body.note || '').trim()

        if (!isValidYmd(date)) {
          return NextResponse.json({ error: 'Ngày thu/chi không hợp lệ (YYYY-MM-DD)' }, { status: 400 })
        }
        if (!description) {
          return NextResponse.json({ error: 'Vui lòng nhập diễn giải khoản thu/chi' }, { status: 400 })
        }
        if (amount <= 0) {
          return NextResponse.json({ error: 'Số tiền phải lớn hơn 0' }, { status: 400 })
        }

        const item: OtherCashflowRow = {
          id: `cf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date,
          flowType,
          group,
          planCostCode,
          description,
          amount,
          note,
        }
        state.otherCashflows.push(item)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({
          ok: true,
          item,
          cutoffDate,
          hiddenInFromStocktake: date <= cutoffDate,
        })
      }

      if (action === 'DELETE_CASHFLOW') {
        const id = String(body.id || '')
        state.otherCashflows = state.otherCashflows.filter((c) => c.id !== id)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id })
        return NextResponse.json({ ok: true })
      }

      if (action === 'ADD_PRODUCTION') {
        const date = String(body.date || '').trim()
        const batchCode =
          String(body.batchCode || '').trim() || `ME-${Date.now().toString(36).toUpperCase()}`
        const batchType = String(body.batchType || 'Đúc').trim()
        const sku = String(body.sku || '').trim().toUpperCase()
        const rawStarted = Number(body.qtyStarted)
        const rawGood = Number(body.qtyGood)
        const qtyStarted = Number.isFinite(rawStarted) ? Math.round(rawStarted) : 0
        const qtyGood = Number.isFinite(rawGood) ? Math.round(rawGood) : -1

        const rawPlaster = body.actualPlasterGrams
        let actualPlasterGrams: number | null = null
        if (rawPlaster !== null && rawPlaster !== undefined && String(rawPlaster).trim() !== '') {
          const parsedPlaster = Number(rawPlaster)
          if (!Number.isFinite(parsedPlaster) || parsedPlaster < 0) {
            return NextResponse.json({ error: 'Số gram thạch cao cân thực không hợp lệ' }, { status: 400 })
          }
          actualPlasterGrams = parsedPlaster > 0 ? parsedPlaster : null
        }

        const rawMinutes = body.actualMinutes
        let actualMinutes: number | null = null
        if (rawMinutes !== null && rawMinutes !== undefined && String(rawMinutes).trim() !== '') {
          const parsedMin = Number(rawMinutes)
          if (!Number.isFinite(parsedMin) || parsedMin < 0) {
            return NextResponse.json({ error: 'Số phút làm thực tế không hợp lệ' }, { status: 400 })
          }
          actualMinutes = Math.round(parsedMin)
        }

        const operator = String(body.operator || 'Xưởng Bơ Mộc').trim()
        const note = String(body.note || '').trim()

        if (!isValidYmd(date)) {
          return NextResponse.json({ error: 'Ngày sản xuất không hợp lệ' }, { status: 400 })
        }
        if (!sku) {
          return NextResponse.json({ error: 'Vui lòng chọn Mã SKU sản xuất' }, { status: 400 })
        }
        if (qtyStarted <= 0 || qtyGood < 0 || qtyGood > qtyStarted) {
          return NextResponse.json(
            { error: 'SL đổ khuôn phải > 0 và SL đạt phải nằm trong khoảng [0 .. SL đổ khuôn]' },
            { status: 400 }
          )
        }

        const item: ProductionBatchRow = {
          id: `mp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date,
          batchCode,
          batchType,
          sku,
          qtyStarted,
          qtyGood,
          actualPlasterGrams,
          actualMinutes,
          operator,
          note,
          source: 'MANUAL',
        }
        state.manualProductions.push(item)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({
          ok: true,
          item,
          cutoffDate,
          hiddenInFromStocktake: date <= cutoffDate,
        })
      }

      if (action === 'DELETE_PRODUCTION') {
        const id = String(body.id || '')
        state.manualProductions = state.manualProductions.filter((p) => p.id !== id)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id })
        return NextResponse.json({ ok: true })
      }

      if (action === 'ADD_PURCHASE') {
        const date = String(body.date || '').trim()
        const docCode =
          String(body.docCode || '').trim() || `MH-${Date.now().toString(36).toUpperCase()}`
        const supplier = String(body.supplier || '').trim() || 'Nhà cung cấp'
        const materialCode = String(body.materialCode || '').trim().toUpperCase()
        const rawQty = Number(body.qtyStandardUnit)
        const rawPaid = Number(body.actualTotalPaid)
        const qtyStandardUnit = Number.isFinite(rawQty) ? rawQty : 0
        const actualTotalPaid = Number.isFinite(rawPaid) ? Math.round(rawPaid) : -1
        const note = String(body.note || '').trim()

        if (!isValidYmd(date) || !materialCode || qtyStandardUnit <= 0 || actualTotalPaid < 0) {
          return NextResponse.json(
            { error: 'Vui lòng nhập đủ Ngày, Mã VT, SL (ĐVT chuẩn > 0) và Thành tiền hợp lệ' },
            { status: 400 }
          )
        }
        if (!(await isKnownMaterialCode(materialCode))) {
          return NextResponse.json(
            { error: `Mã vật tư "${materialCode}" không tồn tại trong Danh mục Vật tư (01_Vat_Tu)` },
            { status: 400 }
          )
        }

        const item: PurchaseLogRow = {
          id: `mh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date,
          docCode,
          supplier,
          materialCode,
          qtyStandardUnit,
          actualTotalPaid,
          note,
          source: 'MANUAL',
        }
        state.manualPurchases.push(item)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({
          ok: true,
          item,
          cutoffDate,
          hiddenInFromStocktake: date <= cutoffDate,
        })
      }

      if (action === 'DELETE_PURCHASE') {
        const id = String(body.id || '')
        state.manualPurchases = state.manualPurchases.filter((p) => p.id !== id)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id })
        return NextResponse.json({ ok: true })
      }

      if (action === 'ADD_SALES_ORDER') {
        const date = String(body.date || '').trim()
        const channelRaw = String(body.channel || 'Shopee').trim() as SalesOrderRow['channel']
        const channel: SalesOrderRow['channel'] = ALLOWED_SALES_CHANNELS.has(channelRaw)
          ? channelRaw
          : 'Shopee'
        const ddmm = isValidYmd(date) ? `${date.slice(8, 10)}${date.slice(5, 7)}` : ''
        const defaultPrefix = channel === 'Shopee' ? 'SHP' : channel === 'Sỉ' ? 'SI' : 'LE'
        const orderCode =
          String(body.orderCode || '').trim() ||
          `${defaultPrefix}-${ddmm || Date.now().toString(36).toUpperCase()}`
        const customer =
          String(body.customer || '').trim() ||
          (channel === 'Shopee' ? 'Khách Shopee' : channel === 'Sỉ' ? 'Khách sỉ' : 'Khách lẻ')
        const sku = String(body.sku || '').trim().toUpperCase()
        const rawQty = Number(body.qty)
        const rawPrice = Number(body.actualUnitPrice)
        const qty = Number.isFinite(rawQty) ? Math.round(rawQty) : 0
        const actualUnitPrice = Number.isFinite(rawPrice) ? Math.round(rawPrice) : -1

        if (!isValidYmd(date) || !sku || qty <= 0 || actualUnitPrice < 0) {
          return NextResponse.json(
            { error: 'Vui lòng nhập đủ Ngày, Mã SKU, SL (> 0) và Đơn giá bán thực hợp lệ' },
            { status: 400 }
          )
        }

        const rawShip = Number(body.sellerShippingPaid ?? 0)
        const sellerShippingPaid = Number.isFinite(rawShip) && rawShip >= 0 ? Math.round(rawShip) : -1
        if (sellerShippingPaid < 0) {
          return NextResponse.json({ error: 'Ship shop trả không được âm' }, { status: 400 })
        }

        const grossAmount = qty * actualUnitPrice
        let platformAndVoucherFee = 0
        if (
          body.netReceived !== null &&
          body.netReceived !== undefined &&
          String(body.netReceived).trim() !== ''
        ) {
          // Seller Center shortcut: Thực nhận = Thành tiền − Phí sàn/voucher − Ship shop trả
          const parsedNet = Number(body.netReceived)
          const maxNet = grossAmount - sellerShippingPaid
          if (!Number.isFinite(parsedNet) || parsedNet < 0 || parsedNet > maxNet) {
            return NextResponse.json(
              {
                error:
                  sellerShippingPaid > 0
                    ? 'Số tiền thực nhận + Ship shop trả không được vượt quá Thành tiền'
                    : 'Số tiền thực nhận phải nằm trong khoảng [0 .. Thành tiền]',
              },
              { status: 400 }
            )
          }
          platformAndVoucherFee = Math.round(grossAmount - parsedNet - sellerShippingPaid)
        } else {
          const rawFee = Number(body.platformAndVoucherFee ?? 0)
          if (!Number.isFinite(rawFee) || rawFee < 0) {
            return NextResponse.json(
              { error: 'Phí sàn / COD / voucher shop không được âm' },
              { status: 400 }
            )
          }
          platformAndVoucherFee = Math.round(rawFee)
        }

        const statusRaw = String(body.status || 'Đã giao').trim() as SalesOrderRow['status']
        if (!ALLOWED_SALES_STATUSES.has(statusRaw)) {
          return NextResponse.json({ error: 'Trạng thái đơn bán không hợp lệ' }, { status: 400 })
        }
        const note = String(body.note || '').trim()

        const item: SalesOrderRow = {
          id: `so_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
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
          note,
          source: 'MANUAL',
        }
        state.manualSalesOrders.push(item)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({
          ok: true,
          item,
          cutoffDate,
          hiddenInFromStocktake: date <= cutoffDate,
        })
      }

      if (action === 'UPDATE_SALES_ORDER_STATUS') {
        const targetId = String(body.id || body.orderCode || '').trim()
        const statusRaw = String(body.status || '').trim() as SalesOrderRow['status']
        if (!targetId || !ALLOWED_SALES_STATUSES.has(statusRaw)) {
          return NextResponse.json(
            { error: 'Thiếu mã dòng đơn hoặc trạng thái không hợp lệ' },
            { status: 400 }
          )
        }
        state.salesOrderStatusOverrides[targetId] = statusRaw
        state.manualSalesOrders = state.manualSalesOrders.map((so) =>
          so.id === targetId ? { ...so, status: statusRaw } : so
        )
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id: targetId, status: statusRaw })
        return NextResponse.json({ ok: true })
      }

      if (action === 'DELETE_SALES_ORDER') {
        const id = String(body.id || '')
        state.manualSalesOrders = state.manualSalesOrders.filter((so) => so.id !== id)
        delete state.salesOrderStatusOverrides[id]
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id })
        return NextResponse.json({ ok: true })
      }

      if (action === 'ADD_ADJUSTMENT') {
        const date = String(body.date || '').trim()
        const kind = body.kind === 'TP' ? 'TP' : 'VT'
        const code = String(body.code || '').trim().toUpperCase()
        const rawDelta = Number(body.deltaQty)
        const deltaQty = Number.isFinite(rawDelta) ? rawDelta : 0
        const reason = String(body.reason || '').trim() || 'Điều chỉnh kiểm kê'
        const note = String(body.note || '').trim()

        if (!isValidYmd(date) || !code || deltaQty === 0) {
          return NextResponse.json(
            { error: 'Vui lòng nhập đủ Ngày, Mã và Số lượng điều chỉnh khác 0' },
            { status: 400 }
          )
        }
        if (kind === 'VT' && !(await isKnownMaterialCode(code))) {
          return NextResponse.json(
            { error: `Mã vật tư "${code}" không tồn tại trong Danh mục Vật tư (01_Vat_Tu)` },
            { status: 400 }
          )
        }

        const item: StockAdjustmentRow = {
          id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          date,
          kind,
          code,
          deltaQty,
          reason,
          note,
          source: 'MANUAL',
        }
        state.manualAdjustments.push(item)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({
          ok: true,
          item,
          cutoffDate,
          hiddenInFromStocktake: date <= cutoffDate,
        })
      }

      if (action === 'DELETE_ADJUSTMENT') {
        const id = String(body.id || '')
        state.manualAdjustments = state.manualAdjustments.filter((a) => a.id !== id)
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, id })
        return NextResponse.json({ ok: true })
      }

      if (action === 'UPDATE_OPENING_STOCK') {
        const kind = body.kind === 'TP' ? 'TP' : 'VT'
        const code = String(body.code || '').trim().toUpperCase()
        if (!code) {
          return NextResponse.json({ error: 'Thiếu mã vật tư / SKU' }, { status: 400 })
        }
        if (kind === 'VT' && !(await isKnownMaterialCode(code))) {
          return NextResponse.json(
            { error: `Mã vật tư "${code}" không tồn tại trong Danh mục Vật tư` },
            { status: 400 }
          )
        }
        const key = `${kind}:${code}`
        const prev = state.openingStockOverrides[key] ?? {}

        let openingQty = prev.openingQty
        if (body.openingQty !== undefined) {
          const parsed = Number(body.openingQty)
          if (!Number.isFinite(parsed) || parsed < 0) {
            return NextResponse.json({ error: 'SL tồn đầu kỳ không được âm' }, { status: 400 })
          }
          openingQty = parsed
        }

        let stocktakeDate = prev.stocktakeDate
        if (typeof body.stocktakeDate === 'string' && body.stocktakeDate.trim() !== '') {
          if (!isValidYmd(body.stocktakeDate)) {
            return NextResponse.json({ error: 'Ngày kiểm kê không hợp lệ (YYYY-MM-DD)' }, { status: 400 })
          }
          stocktakeDate = body.stocktakeDate.trim()
        }

        const status =
          typeof body.status === 'string' && body.status.trim() ? body.status.trim() : prev.status
        const note = typeof body.note === 'string' ? body.note : prev.note

        state.openingStockOverrides[key] = {
          openingQty,
          stocktakeDate,
          status,
          note,
        }
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action, key })
        return NextResponse.json({ ok: true })
      }

      if (action === 'BULK_CONFIRM_OPENING_STOCK') {
        const stocktakeDateRaw =
          typeof body.stocktakeDate === 'string' && isValidYmd(body.stocktakeDate)
            ? body.stocktakeDate.trim()
            : DEFAULT_STOCKTAKE_DATE

        for (const m of CANONICAL_MATERIALS) {
          if (m.status.startsWith('R&D')) continue
          const key = `VT:${m.code}`
          const prev = state.openingStockOverrides[key] ?? {}
          if (!prev.status || prev.status.startsWith('Ước tính')) {
            state.openingStockOverrides[key] = {
              ...prev,
              stocktakeDate: prev.stocktakeDate || stocktakeDateRaw,
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
              stocktakeDate: prev.stocktakeDate || stocktakeDateRaw,
              status: 'Đã kiểm kê',
            }
          }
        }
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({ ok: true })
      }

      if (action === 'UPDATE_THRESHOLDS' || action === 'UPDATE_CONFIG') {
        if (body.weighedMaterialCode !== undefined) {
          const wm = String(body.weighedMaterialCode || '').trim().toUpperCase()
          if (!wm || !(await isKnownMaterialCode(wm))) {
            return NextResponse.json(
              { error: 'Mã vật tư cân thực tế không tồn tại trong Danh mục Vật tư (01_Vat_Tu)' },
              { status: 400 }
            )
          }
          state.weighedMaterialCode = wm
        }
        if (body.stocktakeCutoffOverride !== undefined) {
          const rawCut = String(body.stocktakeCutoffOverride || '').trim()
          if (rawCut === '') {
            state.stocktakeCutoffOverride = null
          } else if (isValidYmd(rawCut)) {
            state.stocktakeCutoffOverride = rawCut
          } else {
            return NextResponse.json({ error: 'Ngày chốt kiểm kê không hợp lệ' }, { status: 400 })
          }
        }
        if (body.materialCode) {
          const code = String(body.materialCode).trim().toUpperCase()
          if (!(await isKnownMaterialCode(code))) {
            return NextResponse.json(
              { error: `Mã vật tư "${code}" không tồn tại trong Danh mục Vật tư` },
              { status: 400 }
            )
          }
          if (body.reorderPoint === null || body.reorderPoint === '') {
            state.materialReorderOverrides[code] = null
          } else {
            const parsedRp = Number(body.reorderPoint)
            if (!Number.isFinite(parsedRp) || parsedRp < 0) {
              return NextResponse.json({ error: 'Điểm đặt hàng lại không được âm' }, { status: 400 })
            }
            state.materialReorderOverrides[code] = parsedRp
          }
        }
        if (body.sku) {
          const sku = String(body.sku).trim().toUpperCase()
          const parsedMin = Number(body.minFinishedStock)
          if (!Number.isFinite(parsedMin) || parsedMin < 0) {
            return NextResponse.json({ error: 'Tồn tối thiểu không được âm' }, { status: 400 })
          }
          state.skuMinStockOverrides[sku] = Math.round(parsedMin)
        }
        writeBaocao1State(state)
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({ ok: true })
      }

      if (action === 'RESET_STATE') {
        writeBaocao1State(createDefaultBaocao1State())
        broadcast('reports.baocao.updated', { action })
        return NextResponse.json({ ok: true })
      }

      return NextResponse.json({ error: 'Hành động không hợp lệ' }, { status: 400 })
    })
  } catch (error) {
    console.error('Baocao POST error:', error)
    return NextResponse.json(
      { error: 'Không thể lưu cập nhật báo cáo vận hành Bơ Mộc' },
      { status: 500 }
    )
  }
}
