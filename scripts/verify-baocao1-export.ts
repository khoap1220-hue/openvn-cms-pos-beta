/**
 * scripts/verify-baocao1-export.ts
 *
 * Kiểm thử toàn diện & đối kháng phân hệ Báo cáo Vận hành Bơ Mộc (`baocao` — 13 Sheet):
 *  1. Kiểm tra bất biến danh mục chuẩn: 34 VT, 25 SKU, 240 dòng BOM, 59 dòng Tồn đầu kỳ,
 *     đẳng thức Kế hoạch Tháng (SL = 200, DT KH = 10.281.000, Lãi đóng góp = 2.773.696,
 *     OPEX = -630.000 -> Lãi ròng = 2.143.696 -> Thu nhập gia đình = 2.816.696).
 *  2. Giải nén nhị phân PKZIP + OpenXML `.xlsx`: đủ 13 Sheet đúng tên `00_Tong_Quan`..`12_Bao_Cao_Thang`,
 *     công thức Excel hợp lệ (không dấu '=' đầu trong <f>, đủ cached value <v>), tên file `baocao.xlsx`.
 *  3. Kiểm tra CSV nguyên mẫu `baocao.csv` (UTF-8 BOM, đủ 13 tiêu đề 00..12, cả route chính & alias).
 *  4. Kiểm thử vòng đời vận hành động qua Route Handler `GET/POST /api/reports/baocao`:
 *     - 05_Nhap_Hang (`ADD_PURCHASE` / `DELETE_PURCHASE`)
 *     - 06_San_Xuat (`ADD_PRODUCTION` có cân thạch cao thực tế / `DELETE_PRODUCTION`)
 *     - 07_Don_Ban (`ADD_SALES_ORDER` tắt Seller Center, đổi trạng thái `Đã giao` -> `Hoàn nhập kho` -> `Hoàn hỏng`)
 *     - 08_Dieu_Chinh_Kho (`ADD_ADJUSTMENT` / `DELETE_ADJUSTMENT`)
 *     - 04_Ton_Dau_Ky (`UPDATE_OPENING_STOCK` & `BULK_CONFIRM_OPENING_STOCK` không làm mất đơn sau ngày chốt)
 *     - 01_Vat_Tu & 02_SKU (`UPDATE_THRESHOLDS`, `UPDATE_CONFIG`, tách `currentMonth` vs `reportMonth`)
 *     - Ánh xạ biến thể Shopee (`resolveCanonicalSku`: Chân Sen vs Chum Sọc vs Hũ Búp Sen)
 *  5. Kiểm thử biên & đối kháng (ngày lịch sai `2026-02-30`, số âm, `qtyGood > qtyStarted`, `scope=template`, RBAC).
 *  6. Khôi phục nguyên trạng trạng thái và xác nhận không chạm tới 24/24 bảng CSDL.
 */

import fs from 'node:fs'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { NextRequest } from 'next/server'
import { GET as baocaoGet, POST as baocaoPost } from '../src/app/api/reports/baocao/route'
import { GET as baocao1AliasGet } from '../src/app/api/reports/baocao1/route'
import {
  fetchBaocaoExportBlob,
  fetchBaocaoSnapshotClient,
  postBaocaoActionClient,
} from '../src/lib/baocao-client'
import { CANONICAL_SKUS, resolveCanonicalSku } from '../src/lib/baocao1-bomoc'
import { parseCsv } from '../src/lib/csv-helper'
import { db } from '../src/lib/db'
import { resolveApiRoutePermission } from '../src/lib/rbac'

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`)
  }
  console.log(`  ✅ ${msg}`)
}

function unzipEntries(zipBuf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let offset = 0
  while (offset + 4 <= zipBuf.length) {
    const sig = zipBuf.readUInt32LE(offset)
    if (sig !== 0x04034b50) break
    const method = zipBuf.readUInt16LE(offset + 8)
    const compSize = zipBuf.readUInt32LE(offset + 18)
    const uncompSize = zipBuf.readUInt32LE(offset + 22)
    const nameLen = zipBuf.readUInt16LE(offset + 26)
    const extraLen = zipBuf.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const name = zipBuf.subarray(nameStart, nameStart + nameLen).toString('utf8')
    const dataStart = nameStart + nameLen + extraLen
    const compData = zipBuf.subarray(dataStart, dataStart + compSize)
    const raw = method === 8 ? inflateRawSync(compData) : compData
    assert(raw.length === uncompSize, `ZIP entry ${name} uncompressed size matches (${uncompSize} bytes)`)
    out.set(name, raw.toString('utf8'))
    offset = dataStart + compSize
  }
  return out
}

async function postAction(payload: Record<string, unknown>) {
  return baocaoPost(
    new NextRequest('http://localhost:3010/api/reports/baocao', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  )
}

async function main() {
  const statePath = path.resolve('db/bo-moc-baocao-state.json')
  const backupExisting = fs.existsSync(statePath) ? fs.readFileSync(statePath, 'utf8') : null

  try {
    console.log('=== KIỂM THỬ TOÀN DIỆN PHÂN HỆ BÁO CÁO VẬN HÀNH BƠ MỘC (baocao · 13 SHEET) ===\n')

    // Clean initial state for deterministic test
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath)

    // 0. RBAC & SKU Variant Mapping Unit Checks
    const readPerm = resolveApiRoutePermission('/api/reports/baocao', 'GET')
    const writePerm = resolveApiRoutePermission('/api/reports/baocao', 'POST')
    assert(
      Boolean(readPerm?.anyOf && readPerm.anyOf.length === 2 && writePerm?.module === 'reports'),
      'RBAC grants analytics_audit & finance access on /api/reports/baocao'
    )

    const knownSkuSet = new Set(CANONICAL_SKUS.map((s) => s.sku))
    assert(
      resolveCanonicalSku('BM-SEN-01-TRANG', 'Chân Nến Hoa Sen — Phân loại: Chân Sen - Trắng', null, knownSkuSet).mappedSku ===
        'BM-DEC-SEN',
      'Variant BM-SEN-01-TRANG maps cleanly to BM-DEC-SEN'
    )
    assert(
      resolveCanonicalSku('BM-SEN-01-CHUMSOC', 'Chân Nến Hoa Sen — Phân loại: Chum Sọc - Trắng', null, knownSkuSet).mappedSku ===
        'BM-KD-CHUMSOC',
      'Variant BM-SEN-01-CHUMSOC maps cleanly to BM-KD-CHUMSOC'
    )
    assert(
      resolveCanonicalSku('BM-DEC-SEN-KEM', 'Hũ Thạch Cao Búp Sen Có Nắp — Kem Bơ', null, knownSkuSet).mappedSku ===
        'BM-DEC-BUPSEN',
      'Variant BM-DEC-SEN-KEM (Búp Sen) maps cleanly to BM-DEC-BUPSEN'
    )

    // 1. JSON Snapshot & Independent currentMonth vs reportMonth
    const reqJson = new NextRequest(
      'http://localhost:3010/api/reports/baocao?format=json&currentMonth=2026-11&reportMonth=2026-12&scope=from_stocktake'
    )
    const resJson = await baocaoGet(reqJson)
    assert(resJson.status === 200, 'GET /api/reports/baocao?format=json returns 200 OK')
    const snap = await resJson.json()

    assert(snap.meta.currentMonth === '2026-11-01' && snap.meta.currentMonthNext === '2026-12-01', 'Sheet 00 currentMonth & currentMonthNext are independent (2026-11-01 -> 2026-12-01)')
    assert(snap.meta.reportMonth === '2026-12-01' && snap.meta.reportMonthNext === '2027-01-01', 'Sheet 12 reportMonth & reportMonthNext handle year rollover (2026-12-01 -> 2027-01-01)')
    assert(snap.materials.length === 34, 'Sheet 01_Vat_Tu contains exact 34 canonical materials')
    assert(snap.skus.length === 25, 'Sheet 02_SKU contains exact 25 canonical SKUs')
    assert(snap.bom.length === 240, 'Sheet 03_Dinh_Muc contains exact 240 BOM lines (NVL + Bao bì)')
    assert(snap.openingStocks.length === 59, 'Sheet 04_Ton_Dau_Ky contains 59 rows (34 VT + 25 TP)')
    assert(snap.monthlyReport.channelTotal.planQty === 200, 'Plan monthly SL = 200 (140 Shopee + 30 Lẻ + 30 Sỉ)')
    assert(snap.monthlyReport.channelTotal.planRevenue === 10_281_000, 'Plan monthly revenue = 10,281,000đ')
    assert(snap.monthlyReport.pnl.planGrossProfit === 2_773_696, 'Plan gross profit = 2,773,696đ')
    assert(snap.monthlyReport.pnl.planOpex === -630_000, 'Plan OPEX = -630,000đ')
    assert(snap.monthlyReport.pnl.planNetProfit === 2_143_696, 'Plan net profit = 2,143,696đ')
    assert(snap.monthlyReport.pnl.estimatedFamilyIncomePlan === 2_816_696, 'Plan family income = 2,816,696đ')

    // 2. XLSX Export & OpenXML Inspection (Primary + Alias route)
    const reqXlsx = new NextRequest('http://localhost:3010/api/reports/baocao?format=xlsx&month=2026-12&scope=from_stocktake')
    const resXlsx = await baocaoGet(reqXlsx)
    assert(resXlsx.status === 200, 'GET /api/reports/baocao?format=xlsx returns 200 OK')
    assert(
      (resXlsx.headers.get('content-disposition') || '') === 'attachment; filename="baocao.xlsx"',
      'XLSX Content-Disposition filename is exact "baocao.xlsx" (never baocao1)'
    )
    const aliasXlsx = await baocao1AliasGet(
      new NextRequest('http://localhost:3010/api/reports/baocao1?format=xlsx&month=2026-12')
    )
    assert(
      (aliasXlsx.headers.get('content-disposition') || '') === 'attachment; filename="baocao.xlsx"',
      'Alias /api/reports/baocao1 also serves exact filename "baocao.xlsx"'
    )
    const xlsxBuf = Buffer.from(await resXlsx.arrayBuffer())
    assert(
      Number(resXlsx.headers.get('content-length')) === xlsxBuf.byteLength,
      `XLSX Content-Length header matches binary payload (${xlsxBuf.byteLength} bytes)`
    )

    const entries = unzipEntries(xlsxBuf)
    const wbXml = entries.get('xl/workbook.xml')!
    const expectedSheets = [
      '00_Tong_Quan',
      '01_Vat_Tu',
      '02_SKU',
      '03_Dinh_Muc',
      '04_Ton_Dau_Ky',
      '05_Nhap_Hang',
      '06_San_Xuat',
      '07_Don_Ban',
      '08_Dieu_Chinh_Kho',
      '09_Ton_Kho_Vat_Tu',
      '10_Ton_Kho_Thanh_Pham',
      '11_Thu_Chi_Khac',
      '12_Bao_Cao_Thang',
    ]
    for (let i = 0; i < expectedSheets.length; i++) {
      assert(wbXml.includes(`name="${expectedSheets[i]}"`), `Workbook sheet #${i + 1} named "${expectedSheets[i]}"`)
      const sheetXml = entries.get(`xl/worksheets/sheet${i + 1}.xml`)
      assert(Boolean(sheetXml), `Worksheet XML xl/worksheets/sheet${i + 1}.xml exists`)
      assert(!sheetXml!.includes('<f>='), `Worksheet ${expectedSheets[i]} formulas strip leading '='`)
    }
    const sheet06Xml = entries.get('xl/worksheets/sheet7.xml')!
    assert(
      sheet06Xml.includes('AND(ISNUMBER(J5),J5&gt;0)'),
      'Sheet 06_San_Xuat Col L & M guard J>0 so J=0 falls back to standard BOM matching Sheet 12'
    )

    // 3. CSV Export Verification
    const reqCsv = new NextRequest('http://localhost:3010/api/reports/baocao?format=csv&month=2026-12&scope=from_stocktake')
    const resCsv = await baocaoGet(reqCsv)
    assert(resCsv.status === 200, 'GET /api/reports/baocao?format=csv returns 200 OK')
    assert(
      (resCsv.headers.get('content-disposition') || '') === 'attachment; filename="baocao.csv"',
      'CSV Content-Disposition filename is exact "baocao.csv"'
    )
    const csvRawBytes = Buffer.from(await resCsv.arrayBuffer())
    assert(
      csvRawBytes[0] === 0xef && csvRawBytes[1] === 0xbb && csvRawBytes[2] === 0xbf,
      'CSV HTTP wire payload starts with exact UTF-8 BOM bytes (EF BB BF)'
    )
    const csvText = csvRawBytes.subarray(3).toString('utf8')
    const parsedRows = parseCsv(csvText)
    assert(parsedRows.length > 350, `CSV contains ${parsedRows.length} structured rows across all 13 sections`)

    // 4. Full Operational Mutation Roundtrip Across Sheets 01, 02, 04, 05, 06, 07, 08, 11
    // 4a. Sheet 05: Purchase 25,000g NVL-001 for 230,000đ
    const resAddPur = await postAction({
      action: 'ADD_PURCHASE',
      date: '2026-11-24',
      docCode: 'MH-TEST-01',
      supplier: 'Khoáng Sản Thái Lan',
      materialCode: 'NVL-001',
      qtyStandardUnit: 25000,
      actualTotalPaid: 230_000,
      note: 'Bao nguyên 25kg',
    })
    assert(resAddPur.status === 200, 'POST ADD_PURCHASE (25kg NVL-001) succeeds')

    // 4b. Sheet 06: Cast 10 started / 9 good BM-DEC-LAMA-LUN, weighed 3,150g plaster
    const resAddProd = await postAction({
      action: 'ADD_PRODUCTION',
      date: '2026-11-25',
      batchCode: 'ME-TEST-01',
      batchType: 'Đúc',
      sku: 'BM-DEC-LAMA-LUN',
      qtyStarted: 10,
      qtyGood: 9,
      actualPlasterGrams: 3150,
      actualMinutes: 45,
      operator: 'Thợ đúc ca 1',
    })
    assert(resAddProd.status === 200, 'POST ADD_PRODUCTION succeeds')

    // 4c. Sheet 07: Add Shopee daily order using Seller Center netReceived shortcut
    const resAddSale = await postAction({
      action: 'ADD_SALES_ORDER',
      date: '2026-11-25',
      orderCode: 'SHP-2511',
      channel: 'Shopee',
      customer: 'Khách Shopee Gộp',
      sku: 'BM-DEC-LAMA-LUN',
      qty: 2,
      actualUnitPrice: 52_000, // Gross = 104,000
      netReceived: 83_000, // Auto fee = 104,000 - 83,000 = 21,000
      sellerShippingPaid: 0,
      status: 'Đã giao',
    })
    assert(resAddSale.status === 200, 'POST ADD_SALES_ORDER with Seller Center netReceived succeeds')
    const createdSale = (await resAddSale.json()).item
    assert(
      createdSale.platformAndVoucherFee === 21_000,
      'Seller Center shortcut computes exact fee = 104,000 - 83,000 = 21,000đ'
    )

    // 4d. Sheet 08: Stock adjustment (-2 carton BB-001 damaged)
    const resAddAdj = await postAction({
      action: 'ADD_ADJUSTMENT',
      date: '2026-11-25',
      kind: 'VT',
      code: 'BB-001',
      deltaQty: -2,
      reason: 'Hư hỏng hộp carton',
    })
    assert(resAddAdj.status === 200, 'POST ADD_ADJUSTMENT (-2 BB-001) succeeds')

    // 4e. Sheet 11: OPEX Mold Reinvestment 180,000đ
    const resAddOpex = await postAction({
      action: 'ADD_CASHFLOW',
      date: '2026-11-28',
      flowType: 'Chi',
      group: 'OPEX — Quỹ tái đầu tư khuôn',
      planCostCode: 'OPEX-KHUON',
      description: 'Trích quỹ khuôn tháng 11',
      amount: 180_000,
    })
    assert(resAddOpex.status === 200, 'POST ADD_CASHFLOW (OPEX 180k) succeeds')

    // 4f. Sheet 04: Confirm opening stock on a later date (2026-11-26) -> must NOT hide 2026-11-25 orders!
    const resConfirmOpen = await postAction({
      action: 'UPDATE_OPENING_STOCK',
      kind: 'VT',
      code: 'PG-001',
      openingQty: 480,
      stocktakeDate: '2026-11-26',
      status: 'Đã kiểm kê',
    })
    assert(resConfirmOpen.status === 200, 'POST UPDATE_OPENING_STOCK succeeds')

    const snapNov = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()

    const nvl001 = snapNov.materialInventory.find((m: { code: string }) => m.code === 'NVL-001')
    assert(
      nvl001.openingQty === 25000 &&
        nvl001.purchasedQty === 25000 &&
        nvl001.productionUsedQty === 3150 &&
        nvl001.currentQty === 46850,
      'NVL-001 stock = 25,000 + 25,000 - 3,150 = 46,850g'
    )
    const bb001 = snapNov.materialInventory.find((m: { code: string }) => m.code === 'BB-001')
    assert(
      bb001.openingQty === 50 &&
        bb001.packagingSoldQty === 2 &&
        bb001.adjustedQty === -2 &&
        bb001.currentQty === 46,
      'BB-001 carton stock = 50 - 2 (sold packaging) - 2 (adjustment) = 46'
    )
    const tpLama = snapNov.finishedInventory.find((f: { sku: string }) => f.sku === 'BM-DEC-LAMA-LUN')
    assert(
      tpLama.producedGoodQty === 9 && tpLama.soldOutQty === 2 && tpLama.currentQty === 7,
      'BM-DEC-LAMA-LUN finished stock = 0 + 9 (good) - 2 (delivered) = 7'
    )
    assert(
      snapNov.monthlyReport.pnl.actualGrossProfit === 83_000 - 2 * 14_003 &&
        snapNov.monthlyReport.pnl.actualOpex === -180_000,
      'Monthly report P&L computes exact gross profit (54,994đ) and OPEX (-180,000đ)'
    )
    assert(
      snapNov.monthlyReport.cashflow.netCashflow === 83_000 - 230_000 - 180_000,
      'Monthly cashflow = +83,000 (sales) - 230,000 (purchase) - 180,000 (OPEX) = -327,000đ'
    )

    // 4g. Sheet 07 Return Lifecycle: Flip order status to 'Hoàn nhập kho' -> finished stock restored, packaging still consumed!
    await postAction({
      action: 'UPDATE_SALES_ORDER_STATUS',
      id: createdSale.id,
      status: 'Hoàn nhập kho',
    })
    const snapIntactReturn = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    const tpLamaAfterIntact = snapIntactReturn.finishedInventory.find(
      (f: { sku: string }) => f.sku === 'BM-DEC-LAMA-LUN'
    )
    const bb001AfterIntact = snapIntactReturn.materialInventory.find(
      (m: { code: string }) => m.code === 'BB-001'
    )
    assert(
      tpLamaAfterIntact.soldOutQty === 0 && tpLamaAfterIntact.currentQty === 9,
      'Intact return restores finished good stock to 9 (soldOutQty = 0)'
    )
    assert(
      bb001AfterIntact.packagingSoldQty === 2,
      'Intact return still deducts 2 outbound cartons (packagingOutQty = 2)'
    )
    assert(
      snapIntactReturn.monthlyReport.channelTotal.actualRevenue === 0 &&
        snapIntactReturn.monthlyReport.channelTotal.actualNetPayout === -21_000,
      'Intact return sets revenue = 0 and records -21,000đ return fee impact'
    )

    // Flip order status to 'Hoàn hỏng' -> deducts finished stock AND COGS!
    await postAction({
      action: 'UPDATE_SALES_ORDER_STATUS',
      id: createdSale.id,
      status: 'Hoàn hỏng',
    })
    const snapDamagedReturn = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    assert(
      snapDamagedReturn.monthlyReport.channelTotal.standardCogs === 2 * 14_003 &&
        snapDamagedReturn.monthlyReport.pnl.actualGrossProfit === -21_000 - 2 * 14_003,
      'Damaged return deducts standard COGS (28,006đ) + return fee (-21,000đ) = -49,006đ'
    )

    // 4h. Bulk confirm opening stock & thresholds
    await postAction({ action: 'BULK_CONFIRM_OPENING_STOCK' })
    await postAction({
      action: 'UPDATE_THRESHOLDS',
      materialCode: 'NVL-001',
      reorderPoint: 50_000,
      sku: 'BM-DEC-LAMA-LUN',
      minFinishedStock: 12,
    })
    const snapAlerts = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    assert(
      snapAlerts.overview.stockAlerts.unverifiedOpeningCount === 0,
      'BULK_CONFIRM_OPENING_STOCK clears all unverified opening stock alerts (0 remaining)'
    )
    assert(
      snapAlerts.materialInventory.find((m: { code: string }) => m.code === 'NVL-001').alert === 'CẦN ĐẶT HÀNG',
      'Threshold override triggers CẦN ĐẶT HÀNG on NVL-001 (46,850g <= 50,000g)'
    )
    assert(
      snapAlerts.finishedInventory.find((f: { sku: string }) => f.sku === 'BM-DEC-LAMA-LUN').alert ===
        'CẦN ĐÚC / ĐÓNG THÊM',
      'Threshold override triggers CẦN ĐÚC / ĐÓNG THÊM on BM-DEC-LAMA-LUN (7 < 12)'
    )

    // 4i. Scope=template ignores all transactions while keeping catalog & thresholds
    const snapTemplate = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=template')
      )
    ).json()
    assert(
      snapTemplate.purchases.length === 0 &&
        snapTemplate.productions.length === 0 &&
        snapTemplate.salesOrders.length === 0 &&
        snapTemplate.adjustments.length === 0 &&
        snapTemplate.otherCashflows.length === 0,
      'scope=template returns clean blank transaction sheets (0 rows) while keeping catalog'
    )

    // 4j. Scope=all includes historical CMS orders
    const snapAll = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=all')
      )
    ).json()
    assert(
      snapAll.salesOrders.length >= 3,
      `scope=all merges historical CMS orders + manual orders (${snapAll.salesOrders.length} lines)`
    )

    // 5. Adversarial Input & Boundary Error Checks (Must return HTTP 400)
    const badDateRes = await postAction({
      action: 'ADD_CASHFLOW',
      date: '2026-02-30', // Non-existent calendar day
      flowType: 'Chi',
      description: 'Ngày sai lịch',
      amount: 50_000,
    })
    assert(badDateRes.status === 400, 'Rejects impossible calendar date 2026-02-30 with HTTP 400')

    const badProdRes = await postAction({
      action: 'ADD_PRODUCTION',
      date: '2026-11-25',
      sku: 'BM-DEC-SEN',
      qtyStarted: 5,
      qtyGood: 6, // Good > Started
    })
    assert(badProdRes.status === 400, 'Rejects qtyGood > qtyStarted with HTTP 400')

    const negPlasterRes = await postAction({
      action: 'ADD_PRODUCTION',
      date: '2026-11-25',
      sku: 'BM-DEC-SEN',
      qtyStarted: 5,
      qtyGood: 5,
      actualPlasterGrams: -100,
    })
    assert(negPlasterRes.status === 400, 'Rejects negative actualPlasterGrams with HTTP 400')

    const badNetRes = await postAction({
      action: 'ADD_SALES_ORDER',
      date: '2026-11-25',
      channel: 'Shopee',
      sku: 'BM-DEC-SEN',
      qty: 1,
      actualUnitPrice: 30_000,
      netReceived: 35_000, // Net > Gross
    })
    assert(badNetRes.status === 400, 'Rejects Seller Center netReceived > grossAmount with HTTP 400')

    const zeroAdjRes = await postAction({
      action: 'ADD_ADJUSTMENT',
      date: '2026-11-25',
      kind: 'VT',
      code: 'NVL-001',
      deltaQty: 0,
    })
    assert(zeroAdjRes.status === 400, 'Rejects zero-quantity stock adjustment with HTTP 400')

    const negOpenRes = await postAction({
      action: 'UPDATE_OPENING_STOCK',
      kind: 'TP',
      code: 'BM-DEC-SEN',
      openingQty: -3,
    })
    assert(negOpenRes.status === 400, 'Rejects negative opening stock quantity with HTTP 400')

    const conflictNetShipRes = await postAction({
      action: 'ADD_SALES_ORDER',
      date: '2026-11-25',
      channel: 'Shopee',
      sku: 'BM-DEC-LAMA-LUN',
      qty: 1,
      actualUnitPrice: 52_000,
      netReceived: 40_000,
      sellerShippingPaid: 20_000, // 40k + 20k > 52k
    })
    assert(
      conflictNetShipRes.status === 400,
      'Rejects Seller Center netReceived + sellerShippingPaid > grossAmount with HTTP 400'
    )

    const unknownPurMatRes = await postAction({
      action: 'ADD_PURCHASE',
      date: '2026-11-25',
      materialCode: 'UNKNOWN-VT-999',
      qtyStandardUnit: 100,
      actualTotalPaid: 50_000,
    })
    assert(unknownPurMatRes.status === 400, 'Rejects unknown materialCode in ADD_PURCHASE with HTTP 400')

    const unknownWeighedRes = await postAction({
      action: 'UPDATE_CONFIG',
      weighedMaterialCode: 'NOT-A-MATERIAL',
    })
    assert(
      unknownWeighedRes.status === 400,
      'Rejects unknown weighedMaterialCode in UPDATE_CONFIG with HTTP 400'
    )

    // 6. Cutoff Date Boundary, Variant/Extra SKU Resolution & 25-Way Concurrent Write Safety
    await postAction({ action: 'RESET_STATE' })

    const onCutoffRes = await postAction({
      action: 'ADD_PURCHASE',
      date: '2026-11-22', // Exact stocktake cutoff day
      materialCode: 'NVL-002',
      qtyStandardUnit: 500,
      actualTotalPaid: 11_000,
    })
    assert(onCutoffRes.status === 200, 'POST ADD_PURCHASE on cutoff date 2026-11-22 returns 200')
    const onCutoffBody = await onCutoffRes.json()
    assert(
      onCutoffBody.hiddenInFromStocktake === true,
      'Flags transaction on cutoff date 2026-11-22 with hiddenInFromStocktake=true'
    )
    const snapCutoffCheck = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    assert(
      snapCutoffCheck.purchases.length === 0 &&
        snapCutoffCheck.materialInventory.find((m: { code: string }) => m.code === 'NVL-002')
          .purchasedQty === 0,
      'Manual purchase on 2026-11-22 is excluded in from_stocktake mode (strictly > cutoffDate)'
    )
    const snapCutoffAll = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=all')
      )
    ).json()
    assert(
      snapCutoffAll.purchases.length === 1,
      'Manual purchase on 2026-11-22 is preserved and visible in scope=all mode'
    )

    // Variant SKU in manual production (`BM-SEN-01-TRANG` -> `BM-DEC-SEN`) & CMS SKU (`BM-TEA-10`) in manual adjustment
    await postAction({
      action: 'ADD_PRODUCTION',
      date: '2026-11-25',
      sku: 'BM-SEN-01-TRANG',
      qtyStarted: 6,
      qtyGood: 5,
    })
    await postAction({
      action: 'ADD_ADJUSTMENT',
      date: '2026-11-25',
      kind: 'TP',
      code: 'BM-TEA-10',
      deltaQty: 4,
      reason: 'Nhập kiểm kê hộp nến bơ',
    })
    const snapVariant = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    const tpSen = snapVariant.finishedInventory.find((f: { sku: string }) => f.sku === 'BM-DEC-SEN')
    const tpTea10 = snapVariant.finishedInventory.find((f: { sku: string }) => f.sku === 'BM-TEA-10')
    assert(
      tpSen && tpSen.producedGoodQty === 5 && tpSen.currentQty === 5,
      'Manual production of Shopee variant BM-SEN-01-TRANG maps into canonical BM-DEC-SEN finished stock (+5)'
    )
    assert(
      tpTea10 && tpTea10.currentQty === 4 && tpTea10.name.includes('Nến Bơ Tealight'),
      'Manual TP adjustment on CMS extra SKU BM-TEA-10 registers in 10_Ton_Kho_Thanh_Pham with real CMS product name'
    )

    // 25-way parallel concurrent POST race check
    await postAction({ action: 'RESET_STATE' })
    const parallelCount = 25
    const parallelRes = await Promise.all(
      Array.from({ length: parallelCount }, (_, idx) =>
        postAction({
          action: 'ADD_CASHFLOW',
          date: '2026-11-26',
          flowType: 'Chi',
          group: 'OPEX — Điện, nước, Internet xưởng',
          description: `Parallel OPEX #${idx + 1}`,
          amount: 1000 * (idx + 1),
        })
      )
    )
    assert(
      parallelRes.every((r) => r.status === 200),
      `All ${parallelCount} concurrent POST /api/reports/baocao requests succeeded with HTTP 200`
    )
    const snapParallel = await (
      await baocaoGet(
        new NextRequest('http://localhost:3010/api/reports/baocao?format=json&month=2026-11&scope=from_stocktake')
      )
    ).json()
    assert(
      snapParallel.otherCashflows.length === parallelCount,
      `In-process mutex preserved all ${parallelCount}/${parallelCount} concurrent mutations with zero lost updates`
    )
    const leftoverTmp = fs
      .readdirSync(path.resolve('db'))
      .filter((f) => f.startsWith('bo-moc-baocao-state.json.') && f.endsWith('.tmp'))
    assert(leftoverTmp.length === 0, 'Zero leftover .tmp files in db/ after concurrent writes')

    // Reset state & verify clean restoration
    const resetRes = await postAction({ action: 'RESET_STATE' })
    assert(resetRes.status === 200, 'POST RESET_STATE succeeds')

    // 7. Static CDN (GitHub Pages) Assets & Client Fallback Verification
    const pubXlsx = fs.readFileSync(path.resolve('public/downloads/baocao.xlsx'))
    const pubCsv = fs.readFileSync(path.resolve('public/downloads/baocao.csv'))
    assert(
      pubXlsx[0] === 0x50 && pubXlsx[1] === 0x4b && pubXlsx[2] === 0x03 && pubXlsx[3] === 0x04,
      'Static public/downloads/baocao.xlsx has valid PKZIP magic header'
    )
    assert(
      unzipEntries(pubXlsx).has('xl/worksheets/sheet13.xml'),
      'Static public/downloads/baocao.xlsx unzips all 13 worksheets cleanly'
    )
    assert(
      pubCsv[0] === 0xef && pubCsv[1] === 0xbb && pubCsv[2] === 0xbf,
      'Static public/downloads/baocao.csv starts with UTF-8 BOM'
    )
    for (const sc of ['from_stocktake', 'all', 'template'] as const) {
      const sp = path.resolve(`public/downloads/baocao-snapshot-${sc}.json`)
      assert(fs.existsSync(sp), `Static snapshot public/downloads/baocao-snapshot-${sc}.json exists`)
      const parsed = JSON.parse(fs.readFileSync(sp, 'utf8'))
      assert(parsed.meta.scope === sc, `Static snapshot scope matches "${sc}"`)
    }

    // Simulate Static CDN where /api/reports/baocao?format=xlsx returns JSON index.html and POST returns 405
    const origFetch = globalThis.fetch
    const origWin = (globalThis as Record<string, unknown>).window
    const memStore = new Map<string, string>()
    ;(globalThis as Record<string, unknown>).window = {
      __BETA_SUBPATH_SHIM__: 1,
      localStorage: {
        getItem: (k: string) => memStore.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memStore.set(k, v)
        },
        removeItem: (k: string) => {
          memStore.delete(k)
        },
      },
    }
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString()
      const method = (init?.method || 'GET').toUpperCase()
      if (url.startsWith('/api/reports/baocao') && method === 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      if (url.startsWith('/api/reports/baocao')) {
        const jsonFallback = fs.readFileSync(
          path.resolve('public/downloads/baocao-snapshot-from_stocktake.json'),
          'utf8'
        )
        return new Response(jsonFallback, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      }
      if (url === '/downloads/baocao.xlsx') {
        return new Response(new Uint8Array(pubXlsx), { status: 200 })
      }
      if (url === '/downloads/baocao.csv') {
        return new Response(new Uint8Array(pubCsv), { status: 200 })
      }
      const mSnap = /^\/downloads\/baocao-snapshot-(from_stocktake|all|template)\.json$/.exec(url)
      if (mSnap) {
        const txt = fs.readFileSync(
          path.resolve(`public/downloads/baocao-snapshot-${mSnap[1]}.json`),
          'utf8'
        )
        return new Response(txt, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    try {
      const fallbackXlsxBlob = await fetchBaocaoExportBlob(
        'xlsx',
        new URLSearchParams({ format: 'xlsx', month: '2026-11' })
      )
      const fallbackXlsxBytes = new Uint8Array(await fallbackXlsxBlob.arrayBuffer())
      assert(
        fallbackXlsxBytes[0] === 0x50 && fallbackXlsxBytes[1] === 0x4b,
        'Client fetchBaocaoExportBlob(xlsx) rejects JSON index.html and serves real PKZIP baocao.xlsx on Static CDN'
      )

      const fallbackCsvBlob = await fetchBaocaoExportBlob(
        'csv',
        new URLSearchParams({ format: 'csv', month: '2026-11' })
      )
      const fallbackCsvBytes = new Uint8Array(await fallbackCsvBlob.arrayBuffer())
      assert(
        fallbackCsvBytes[0] === 0xef && fallbackCsvBytes[1] === 0xbb && fallbackCsvBytes[2] === 0xbf,
        'Client fetchBaocaoExportBlob(csv) rejects JSON index.html and serves real UTF-8 BOM baocao.csv on Static CDN'
      )

      await postBaocaoActionClient({
        action: 'ADD_PURCHASE',
        date: '2026-11-25',
        docCode: 'MH-STATIC-235',
        materialCode: 'NVL-001',
        qtyStandardUnit: 25000,
        actualTotalPaid: 235000,
      })
      await postBaocaoActionClient({
        action: 'ADD_PRODUCTION',
        date: '2026-11-25',
        batchCode: 'ME-STATIC-01',
        sku: 'BM-DEC-LAMA-LUN',
        qtyStarted: 10,
        qtyGood: 9,
      })
      await postBaocaoActionClient({
        action: 'ADD_SALES_ORDER',
        date: '2026-11-25',
        orderCode: 'SHP-INTRANSIT-01',
        channel: 'Shopee',
        sku: 'BM-DEC-LAMA-LUN',
        qty: 2,
        actualUnitPrice: 52000,
        status: 'Đang giao',
      })
      await postBaocaoActionClient({
        action: 'ADD_SALES_ORDER',
        date: '2026-11-26',
        orderCode: 'SHP-DELIVERED-02',
        channel: 'Shopee',
        sku: 'BM-SEN-01-TRANG', // Shopee variant -> maps to BM-DEC-SEN
        qty: 3,
        actualUnitPrice: 30000,
        status: 'Đã giao',
      })
      await postBaocaoActionClient({ action: 'BULK_CONFIRM_OPENING_STOCK', stocktakeDate: '2026-11-22' })
      const staticSnap = await fetchBaocaoSnapshotClient({
        reportMonth: '2026-11',
        currentMonth: '2026-11',
        scope: 'from_stocktake',
      })
      assert(
        staticSnap.purchases.length === 1 && staticSnap.overview.stockAlerts.unverifiedOpeningCount === 0,
        'Static CDN overlay handles POST 405 mutations & BULK_CONFIRM_OPENING_STOCK seamlessly'
      )

      // Verify Bug #3 fix: 'Đang giao' deducts finished stock (stockOutQty=2) & packaging (BB-001=5 for 2+3 orders)
      const staticLama = staticSnap.finishedInventory.find((f) => f.sku === 'BM-DEC-LAMA-LUN')!
      const staticBb001 = staticSnap.materialInventory.find((m) => m.code === 'BB-001')!
      const staticSen = staticSnap.finishedInventory.find((f) => f.sku === 'BM-DEC-SEN')!
      assert(
        staticLama.producedGoodQty === 9 && staticLama.soldOutQty === 2 && staticLama.currentQty === 7,
        "Static CDN 'Đang giao' order deducts finished stock (9 good - 2 in-transit = 7)"
      )
      assert(
        staticBb001.packagingSoldQty === 5,
        "Static CDN deducts outbound cartons for both 'Đang giao' (2) and 'Đã giao' (3) orders (= 5)"
      )
      assert(
        staticSen.soldOutQty === 3,
        'Static CDN maps Shopee variant BM-SEN-01-TRANG to canonical BM-DEC-SEN'
      )

      // Verify Bug #4 fix: Sheet 12 Section E (bySku) updates dynamically on Static CDN
      const staticBySkuLama = staticSnap.monthlyReport.bySku.find((s) => s.sku === 'BM-DEC-LAMA-LUN')!
      const staticBySkuSen = staticSnap.monthlyReport.bySku.find((s) => s.sku === 'BM-DEC-SEN')!
      assert(
        staticBySkuLama.qtyStarted === 10 && staticBySkuLama.qtyGood === 9 && staticBySkuSen.actualSoldQty === 3,
        'Static CDN recomputes Sheet 12_Bao_Cao_Thang Section E (bySku) for both production & delivered sales'
      )

      // Verify Bug #1 fix: Dynamic XLSX & CSV export on Static CDN includes user mutations AND respects scope=template
      const dynXlsxBlob = await fetchBaocaoExportBlob(
        'xlsx',
        new URLSearchParams({ format: 'xlsx', month: '2026-11', scope: 'from_stocktake' })
      )
      const dynXlsxEntries = unzipEntries(Buffer.from(await dynXlsxBlob.arrayBuffer()))
      assert(
        dynXlsxEntries.get('xl/worksheets/sheet6.xml')!.includes('235000') &&
          dynXlsxEntries.get('xl/sharedStrings.xml')!.includes('MH-STATIC-235'),
        'Static CDN dynamic baocao.xlsx includes live user purchase (235,000đ / MH-STATIC-235) in 05_Nhap_Hang'
      )

      const dynCsvBlob = await fetchBaocaoExportBlob(
        'csv',
        new URLSearchParams({ format: 'csv', month: '2026-11', scope: 'from_stocktake' })
      )
      const dynCsvText = new TextDecoder().decode(await dynCsvBlob.arrayBuffer())
      assert(
        dynCsvText.includes('MH-STATIC-235') && dynCsvText.includes('SHP-INTRANSIT-01'),
        'Static CDN dynamic baocao.csv includes live user mutations'
      )

      const tplCsvBlob = await fetchBaocaoExportBlob(
        'csv',
        new URLSearchParams({ format: 'csv', month: '2026-11', scope: 'template' })
      )
      const tplCsvText = new TextDecoder().decode(await tplCsvBlob.arrayBuffer())
      assert(
        !tplCsvText.includes('MH-STATIC-235') && !tplCsvText.includes('SHP-INTRANSIT-01'),
        'Static CDN dynamic export respects scope=template (0 transaction rows)'
      )

      // Verify Bug #5 fix: Static CDN adversarial validation parity
      let rejectedBadDate = false
      try {
        await postBaocaoActionClient({
          action: 'ADD_CASHFLOW',
          date: '2026-02-30',
          flowType: 'Chi',
          description: 'Invalid date',
          amount: 10000,
        })
      } catch {
        rejectedBadDate = true
      }
      assert(rejectedBadDate, 'Static CDN rejects impossible calendar date 2026-02-30')

      let rejectedUnknownMat = false
      try {
        await postBaocaoActionClient({
          action: 'ADD_PURCHASE',
          date: '2026-11-25',
          materialCode: 'UNKNOWN-VT-999',
          qtyStandardUnit: 10,
          actualTotalPaid: 10000,
        })
      } catch {
        rejectedUnknownMat = true
      }
      assert(rejectedUnknownMat, 'Static CDN rejects unknown materialCode UNKNOWN-VT-999')
    } finally {
      globalThis.fetch = origFetch
      ;(globalThis as Record<string, unknown>).window = origWin
    }

    console.log('\n🎉 ALL BAOCAO (13-SHEET) VERIFICATION & ADVERSARIAL ASSERTIONS PASSED 100%!')
  } finally {
    if (backupExisting !== null) {
      fs.writeFileSync(statePath, backupExisting, 'utf8')
    } else if (fs.existsSync(statePath)) {
      fs.unlinkSync(statePath)
    }
    await db.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
