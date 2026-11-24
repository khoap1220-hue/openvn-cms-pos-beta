/**
 * Pure Isomorphic Bơ Mộc 13-Sheet Operational Workbook Core (`baocao`)
 * Runs identically in Node.js (API Route Handlers) and Web Browsers (Static CDN / Offline-First).
 * Zero Node-only (`fs`, `path`) or Prisma (`db`) imports.
 */

import { escapeCsvCell } from '@/lib/csv-helper'
import {
  buildXlsxUint8Array,
  type XlsxCellInput,
  type XlsxSheetSpec,
  type XlsxStyleKey,
} from '@/lib/xlsx-writer'

// 1. Types & Interfaces
// ============================================================================

export type Baocao1DataScope = 'from_stocktake' | 'all' | 'template'

export interface MaterialCatalogItem {
  code: string
  group: string
  name: string
  unit: string
  standardUnitCost: number | null
  status: string
  monthlyPlanDemand: number | null
  reorderPoint: number | null
  note: string
}

export interface SkuCatalogItem {
  sku: string
  name: string
  categoryGroup: 'A' | 'B'
  pricingGroup: string
  standardCost: number
  shopeeActualPrice: number | null
  shopeeRegularPrice: number | null
  retailPrice: number
  wholesaleB1: number
  wholesaleB2: number
  planQtyShopee: number
  planQtyRetail: number
  planQtyWholesale: number
  minFinishedStock: number
}

export interface BomStandardLine {
  sku: string
  kind: 'NVL' | 'Bao bì'
  materialCode: string
  qtyPerUnit: number
}

export interface OpeningStockRow {
  kind: 'VT' | 'TP'
  code: string
  openingQty: number
  stocktakeDate: string // YYYY-MM-DD
  status: string // 'Đã kiểm kê' | 'Ước tính — cần cân/đếm lại' | 'Chưa có hàng'
  note: string
}

export interface PurchaseLogRow {
  id?: string
  date: string // YYYY-MM-DD
  docCode: string
  supplier: string
  materialCode: string
  qtyStandardUnit: number
  actualTotalPaid: number
  note: string
  source?: 'CMS_INVOICE' | 'CMS_MOVEMENT' | 'MANUAL'
}

export interface ProductionBatchRow {
  id?: string
  date: string // YYYY-MM-DD
  batchCode: string
  batchType: string // 'Đúc' | 'Chiết / Đóng gói'
  sku: string
  qtyStarted: number
  qtyGood: number
  actualPlasterGrams: number | null
  actualMinutes: number | null
  operator: string
  note: string
  source?: 'CMS_PRODUCTION' | 'MANUAL'
}

export interface SalesOrderRow {
  id?: string
  date: string // YYYY-MM-DD
  orderCode: string
  channel: 'Shopee' | 'Lẻ Zalo / Website' | 'Sỉ'
  customer: string
  sku: string
  qty: number
  actualUnitPrice: number
  platformAndVoucherFee: number
  sellerShippingPaid: number
  status: 'Đã giao' | 'Đang giao' | 'Hoàn nhập kho' | 'Hoàn hỏng' | 'Đã hủy'
  note: string
  source?: 'CMS_ORDER' | 'MANUAL'
}

export interface StockAdjustmentRow {
  id?: string
  date: string // YYYY-MM-DD
  kind: 'VT' | 'TP'
  code: string
  deltaQty: number
  reason: string
  note: string
  source?: 'CMS_MOVEMENT' | 'MANUAL'
}

export interface OtherCashflowRow {
  id: string
  date: string // YYYY-MM-DD
  flowType: 'Thu' | 'Chi'
  group: string // e.g. 'OPEX — Quỹ tái đầu tư khuôn'
  planCostCode: string
  description: string
  amount: number
  note: string
}

export interface Baocao1PersistedState {
  weighedMaterialCode: string
  stocktakeCutoffOverride?: string | null
  openingStockOverrides: Record<
    string,
    { openingQty?: number; stocktakeDate?: string; status?: string; note?: string }
  >
  materialReorderOverrides: Record<string, number | null>
  skuMinStockOverrides: Record<string, number>
  manualPurchases: PurchaseLogRow[]
  manualProductions: ProductionBatchRow[]
  manualSalesOrders: SalesOrderRow[]
  salesOrderStatusOverrides: Record<string, SalesOrderRow['status']>
  manualAdjustments: StockAdjustmentRow[]
  otherCashflows: OtherCashflowRow[]
  updatedAt?: string
}

export interface ComputedMaterialStockRow {
  code: string
  name: string
  unit: string
  status: string
  standardUnitCost: number
  openingQty: number
  purchasedQty: number
  productionUsedQty: number
  packagingSoldQty: number
  adjustedQty: number
  currentQty: number
  reorderPoint: number | null
  alert: '' | 'OK' | 'CẦN ĐẶT HÀNG' | 'ÂM KHO'
  stockValue: number
}

export interface ComputedFinishedStockRow {
  sku: string
  name: string
  standardCost: number
  openingQty: number
  producedGoodQty: number
  soldOutQty: number
  adjustedQty: number
  currentQty: number
  minStock: number
  alert: '' | 'OK' | 'CẦN ĐÚC / ĐÓNG THÊM' | 'ÂM KHO'
  stockValue: number
  soldLast30Days: number
}

export interface ChannelReportRow {
  channel: 'Shopee' | 'Lẻ Zalo / Website' | 'Sỉ'
  actualQty: number
  planQty: number
  qtyAchievementPct: number | null
  actualRevenue: number
  planRevenue: number
  actualNetPayout: number
  standardCogs: number
  actualGrossProfit: number
  planContributionProfit: number
}

export interface SkuMonthlyReportRow {
  sku: string
  name: string
  actualSoldQty: number
  planMonthlyQty: number
  achievementPct: number | null
  actualAvgPrice: number | null
  standardAvgPrice: number | null
  priceVariance: number | null
  qtyStarted: number
  qtyGood: number
  defectPct: number | null
}

export interface Baocao1FullSnapshot {
  meta: {
    currentMonth: string // YYYY-MM-01
    currentMonthNext: string // YYYY-MM-01
    reportMonth: string // YYYY-MM-01
    reportMonthNext: string // YYYY-MM-01
    scope: Baocao1DataScope
    stocktakeCutoffDate: string // YYYY-MM-DD
    weighedMaterialCode: string
    generatedAt: string
  }
  overview: {
    thisMonth: {
      recognizedRevenue: number
      netPayout: number
      grossProfit: number
      soldUnits: number
      producedGoodUnits: number
      materialPurchaseSpent: number
      otherExpenses: number
      planMonthlyUnits: number
      planMonthlyNetProfit: number
    }
    stockAlerts: {
      materialsNeedReorder: number
      skusNeedProduction: number
      negativeStockCodes: number
      materialStockValue: number
      finishedStockValue: number
      unverifiedOpeningCount: number
    }
  }
  materials: MaterialCatalogItem[]
  skus: SkuCatalogItem[]
  bom: Array<BomStandardLine & { materialName: string }>
  openingStocks: Array<OpeningStockRow & { name: string; unit: string }>
  purchases: Array<
    PurchaseLogRow & {
      materialName: string
      unit: string
      actualUnitCost: number | null
      standardUnitCost: number | null
      variancePct: number | null
    }
  >
  productions: Array<
    ProductionBatchRow & {
      skuName: string
      defectQty: number
      defectPct: number | null
      standardPlasterGrams: number
      deductedPlasterGrams: number
      plasterVarianceGrams: number | null
    }
  >
  salesOrders: Array<
    SalesOrderRow & {
      skuName: string
      grossAmount: number
      netPayout: number
      recognizedRevenue: number
      recognizedNetPayout: number
      stockOutQty: number
      packagingOutQty: number
      standardCogs: number
      grossProfit: number
      channelStandardPrice: number
    }
  >
  adjustments: Array<StockAdjustmentRow & { name: string }>
  materialInventory: ComputedMaterialStockRow[]
  finishedInventory: ComputedFinishedStockRow[]
  otherCashflows: OtherCashflowRow[]
  monthlyReport: {
    byChannel: ChannelReportRow[]
    channelTotal: Omit<ChannelReportRow, 'channel'>
    pnl: {
      actualGrossProfit: number
      planGrossProfit: number
      actualOpex: number // negative or 0
      planOpex: number // -630000
      actualNetProfit: number
      planNetProfit: number // 2143696
      directLaborActual: number // 673000
      directLaborPlan: number // 673000
      estimatedFamilyIncomeActual: number
      estimatedFamilyIncomePlan: number
    }
    productionSummary: {
      batchCount: number
      totalQtyStarted: number
      totalQtyGood: number
      defectRate: number | null
      weighedPlasterActualGrams: number
      weighedPlasterStandardGrams: number
      plasterVarianceGrams: number
    }
    cashflow: {
      netFromSales: number
      otherIncome: number
      materialPurchases: number // negative or 0
      otherExpenses: number // negative or 0
      netCashflow: number
    }
    bySku: SkuMonthlyReportRow[]
  }
}

// ============================================================================
// 2. Canonical Bơ Mộc Master Catalog (`Ke_Hoach_Dinh_Gia_Bo_Moc.xlsx` -> `baocao1`)
// ============================================================================

export const DEFAULT_STOCKTAKE_DATE = '2026-11-22'
export const PLAN_MONTHLY_SL = 200
export const PLAN_MONTHLY_OPEX = -630_000
export const PLAN_DIRECT_LABOR = 673_000
export const PLAN_CHANNEL_TARGETS: Record<
  'Shopee' | 'Lẻ Zalo / Website' | 'Sỉ',
  { qty: number; revenue: number; contributionProfit: number }
> = {
  Shopee: { qty: 140, revenue: 6_979_000, contributionProfit: 1_287_056 },
  'Lẻ Zalo / Website': { qty: 30, revenue: 1_288_000, contributionProfit: 673_078 },
  Sỉ: { qty: 30, revenue: 2_014_000, contributionProfit: 813_562 },
}
export const PLAN_MONTHLY_GROSS_PROFIT = 2_773_696 // 1287056 + 673078 + 813562
export const PLAN_MONTHLY_NET_PROFIT = 2_143_696 // 2773696 - 630000

export const CANONICAL_MATERIALS: MaterialCatalogItem[] = [
  { code: 'NVL-001', group: 'Vỏ khoáng', name: 'Thạch cao đúc mịn TA-P3C (Hemi Hydrate)', unit: 'g', standardUnitCost: 9.3944, status: 'Đang dùng', monthlyPlanDemand: 51600, reorderPoint: 26000, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'NVL-002', group: 'Vỏ khoáng', name: 'Cát thạch anh mịn (0.1 - 0.3mm)', unit: 'g', standardUnitCost: 22, status: 'Đang dùng', monthlyPlanDemand: 2330, reorderPoint: 2000, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'NVL-003', group: 'Vỏ khoáng', name: 'Xi măng trắng Portland', unit: 'g', standardUnitCost: 17.48, status: 'Đang dùng', monthlyPlanDemand: 11650, reorderPoint: 6000, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'NVL-004', group: 'Vỏ khoáng', name: 'Thạch cao Long Vu Resin (Lô thử nghiệm R&D)', unit: 'g', standardUnitCost: 27.6, status: 'Ngừng dùng', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'NVL-005', group: 'Sáp & Tinh dầu', name: 'Sáp bơ thực vật / Sáp đậu nành', unit: 'g', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'NVL-006', group: 'Sáp & Tinh dầu', name: 'Tinh dầu thơm làm nến (Fragrance Oil)', unit: 'ml', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'PG-001', group: 'Phụ gia & Màu & Phủ', name: 'Bột tăng trắng Titanium Dioxide (TiO2)', unit: 'g', standardUnitCost: 312, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'PG-002', group: 'Phụ gia & Màu & Phủ', name: 'Bột màu Oxit sắt (Đen 722, Đỏ Y101, Vàng M35)', unit: 'g', standardUnitCost: 78, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'PG-003', group: 'Phụ gia & Màu & Phủ', name: 'Phụ gia phá bọt Deformer AX 406', unit: 'g', standardUnitCost: 219.0608, status: 'Đang dùng', monthlyPlanDemand: 446.6, reorderPoint: 300, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'PG-004', group: 'Phụ gia & Màu & Phủ', name: 'Chất độn cao lanh Metakaolin MKA 11', unit: 'g', standardUnitCost: 46.118, status: 'Đang dùng', monthlyPlanDemand: 4398, reorderPoint: 3000, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'PG-005', group: 'Phụ gia & Màu & Phủ', name: 'Phủ bóng chống thấm Acrylic Sealer HUNGACOLOR', unit: 'ml', standardUnitCost: 144, status: 'Đang dùng', monthlyPlanDemand: 1398, reorderPoint: 700, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'PG-006', group: 'Phụ gia & Màu & Phủ', name: 'Phụ gia siêu dẻo Polycarboxylate PCE-PPC 1201', unit: 'g', standardUnitCost: 160, status: 'Đang dùng', monthlyPlanDemand: 693.2, reorderPoint: 400, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-001', group: 'Bao bì & Tem nhãn', name: 'Hộp carton 20x15x10 sóng B', unit: 'cái', standardUnitCost: 1880.94, status: 'Đang dùng', monthlyPlanDemand: 205, reorderPoint: 110, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-002', group: 'Bao bì & Tem nhãn', name: 'Hộp carton lớn 30x20x15 sóng B', unit: 'cái', standardUnitCost: 3729.05, status: 'Đang dùng', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'BB-003', group: 'Bao bì & Tem nhãn', name: 'Cuộn xốp nổ bọc hàng 30cm x 100m', unit: 'm', standardUnitCost: 899.58, status: 'Đang dùng', monthlyPlanDemand: 102, reorderPoint: 60, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-004', group: 'Bao bì & Tem nhãn', name: 'Giấy tổ ong gói hàng Zimbi 30cm x 100m', unit: 'm', standardUnitCost: 1470, status: 'Đang dùng', monthlyPlanDemand: 94.5, reorderPoint: 50, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-005', group: 'Bao bì & Tem nhãn', name: 'Băng keo dán thùng Trắng Trong 1kg', unit: 'g', standardUnitCost: 63.789, status: 'Đang dùng', monthlyPlanDemand: 983, reorderPoint: 500, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-006', group: 'Bao bì & Tem nhãn', name: 'Giấy rơm sợi 3mm vàng nhạt', unit: 'g', standardUnitCost: 60, status: 'Đang dùng', monthlyPlanDemand: 378, reorderPoint: 200, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-007', group: 'Bao bì & Tem nhãn', name: 'Giấy bìa Kraft Nhật A4 180gsm (thiệp/tag)', unit: 'tờ', standardUnitCost: 700, status: 'Đang dùng', monthlyPlanDemand: 91, reorderPoint: 50, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-008', group: 'Bao bì & Tem nhãn', name: 'Túi Zip chỉ đỏ PE 20x30cm', unit: 'túi', standardUnitCost: 1033.8, status: 'Đang dùng', monthlyPlanDemand: 27, reorderPoint: 20, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-009', group: 'Bao bì & Tem nhãn', name: 'Túi Zip chỉ đỏ PE 18x25cm', unit: 'túi', standardUnitCost: 603.864, status: 'Đang dùng', monthlyPlanDemand: 2, reorderPoint: 1, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-010', group: 'Bao bì & Tem nhãn', name: 'Túi Zip chỉ đỏ PE 12x17cm', unit: 'túi', standardUnitCost: 301.928, status: 'Đang dùng', monthlyPlanDemand: 8, reorderPoint: 4, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-011', group: 'Bao bì & Tem nhãn', name: 'Dây thừng trang trí 2mm', unit: 'm', standardUnitCost: 144.95121951219511, status: 'Đang dùng', monthlyPlanDemand: 147, reorderPoint: 80, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'BB-012', group: 'Bấc & Phụ kiện nến', name: 'Bấc cotton + Đế dán bấc', unit: 'cái', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'BB-013', group: 'Bấc & Phụ kiện nến', name: 'Bấc gỗ + Chân đế kẹp', unit: 'cái', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'BB-014', group: 'Bấc & Phụ kiện nến', name: 'Cốc nhôm / Polycarbonate đựng nến Tealight', unit: 'cái', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'BB-015', group: 'Bấc & Phụ kiện nến', name: 'Lọ diêm gỗ dài 10cm (lọ 20 que)', unit: 'lọ', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'BB-016', group: 'Bao bì & Tem nhãn', name: 'Nhãn dán Decal A4 90x65mm (túi nguyên liệu)', unit: 'cái', standardUnitCost: 112.5, status: 'Đang dùng', monthlyPlanDemand: 17, reorderPoint: 9, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
  { code: 'TH-001', group: 'Tiêu hao & Bảo hộ', name: 'Găng tay Nitrile không bột Đen (Size M)', unit: 'chiếc', standardUnitCost: 745.51, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'TH-002', group: 'Tiêu hao & Bảo hộ', name: 'Găng tay Nitrile không bột Trắng (Size L)', unit: 'chiếc', standardUnitCost: 499.99, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'TH-003', group: 'Tiêu hao & Bảo hộ', name: 'Giấy nhám nước RIKEN C35P (400 & 1000)', unit: 'tờ', standardUnitCost: 3610, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'TH-004', group: 'Tiêu hao & Bảo hộ', name: 'Khăn lau đa năng Microfiber 30x30cm', unit: 'khăn', standardUnitCost: 6145.6, status: 'Có hàng — chưa dùng trong BOM', monthlyPlanDemand: null, reorderPoint: null, note: 'Chưa dùng trong BOM — không cần cảnh báo' },
  { code: 'HH-001', group: 'Hàng nhập bán sẵn', name: 'Nến bơ Tealight nhập bán sẵn (Chờ chọn NCC)', unit: 'viên', standardUnitCost: null, status: 'R&D — chưa mua', monthlyPlanDemand: null, reorderPoint: null, note: 'R&D — chưa mua' },
  { code: 'BB-017', group: 'Bao bì & Tem nhãn', name: 'Giấy nến lót sản phẩm trong hộp', unit: 'tờ', standardUnitCost: 200, status: 'Đang dùng', monthlyPlanDemand: 189, reorderPoint: 100, note: 'Đề xuất = nhu cầu ~15 ngày theo kế hoạch' },
]

export const CANONICAL_SKUS: SkuCatalogItem[] = [
  { sku: 'BM-DEC-LAMA-LUN', name: 'Hũ Thạch Cao Vân Sọc Lùn, Nắp Chóp (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 14003, shopeeActualPrice: 52000, shopeeRegularPrice: 58000, retailPrice: 46000, wholesaleB1: 30000, wholesaleB2: 25000, planQtyShopee: 20, planQtyRetail: 3, planQtyWholesale: 4, minFinishedStock: 7 },
  { sku: 'BM-DEC-BUPSEN', name: 'Hũ Thạch Cao Búp Sen, Có Nắp (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 14503, shopeeActualPrice: 56000, shopeeRegularPrice: 62000, retailPrice: 49000, wholesaleB1: 32000, wholesaleB2: 27000, planQtyShopee: 20, planQtyRetail: 3, planQtyWholesale: 4, minFinishedStock: 7 },
  { sku: 'BM-DEC-LAMA-CAO', name: 'Hũ Thạch Cao Trụ Sọc Cao, Có Nắp (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 14503, shopeeActualPrice: 56000, shopeeRegularPrice: 62000, retailPrice: 49000, wholesaleB1: 32000, wholesaleB2: 27000, planQtyShopee: 15, planQtyRetail: 2, planQtyWholesale: 3, minFinishedStock: 5 },
  { sku: 'BM-DEC-VAT-BACAU', name: 'Hũ Thạch Cao Trụ Trơn, Nắp Đĩa (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 14503, shopeeActualPrice: 56000, shopeeRegularPrice: 62000, retailPrice: 49000, wholesaleB1: 32000, wholesaleB2: 27000, planQtyShopee: 15, planQtyRetail: 2, planQtyWholesale: 3, minFinishedStock: 5 },
  { sku: 'BM-DEC-SOC-PHANG', name: 'Hũ Thạch Cao Sọc Đứng Nắp Phẳng (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 14003, shopeeActualPrice: 52000, shopeeRegularPrice: 58000, retailPrice: 46000, wholesaleB1: 30000, wholesaleB2: 25000, planQtyShopee: 15, planQtyRetail: 2, planQtyWholesale: 3, minFinishedStock: 5 },
  { sku: 'BM-DEC-SEN', name: 'Đế Nến Hoa Sen Thạch Cao Size Nhỏ (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 8781, shopeeActualPrice: 30000, shopeeRegularPrice: 33000, retailPrice: 26000, wholesaleB1: 17000, wholesaleB2: 14000, planQtyShopee: 12, planQtyRetail: 2, planQtyWholesale: 2, minFinishedStock: 4 },
  { sku: 'BM-DEC-SEN-L', name: 'Đế Nến Hoa Sen Thạch Cao Size Lớn (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 12393, shopeeActualPrice: 50000, shopeeRegularPrice: 55000, retailPrice: 44000, wholesaleB1: 29000, wholesaleB2: 24000, planQtyShopee: 10, planQtyRetail: 2, planQtyWholesale: 2, minFinishedStock: 4 },
  { sku: 'BM-DEC-OVAL', name: 'Khay Thạch Cao Oval / Bầu Dục Decor (Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 11393, shopeeActualPrice: 40000, shopeeRegularPrice: 44000, retailPrice: 35000, wholesaleB1: 23000, wholesaleB2: 19000, planQtyShopee: 10, planQtyRetail: 2, planQtyWholesale: 2, minFinishedStock: 4 },
  { sku: 'BM-DEC-TRAITIM', name: 'Khay / Đế Thạch Cao Hình Trái Tim (Trắng — Khuôn Thô)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 8781, shopeeActualPrice: 30000, shopeeRegularPrice: 33000, retailPrice: 26000, wholesaleB1: 17000, wholesaleB2: 14000, planQtyShopee: 8, planQtyRetail: 1, planQtyWholesale: 2, minFinishedStock: 3 },
  { sku: 'BM-NL-THACHCAO', name: 'Bột Thạch Cao Trắng Siêu Mịn Thái Lan TA-P3C (Túi 1kg)', categoryGroup: 'A', pricingGroup: 'NGUYENLIEU', standardCost: 14691, shopeeActualPrice: 43000, shopeeRegularPrice: 48000, retailPrice: 30000, wholesaleB1: 17000, wholesaleB2: 15000, planQtyShopee: 2, planQtyRetail: 3, planQtyWholesale: 0, minFinishedStock: 2 },
  { sku: 'BM-NL-PHABOT', name: 'Phụ Gia Phá Bọt Khí Đúc Thạch Cao, Xi Măng AX406 (Gói 100g)', categoryGroup: 'A', pricingGroup: 'NGUYENLIEU', standardCost: 26471, shopeeActualPrice: 69000, shopeeRegularPrice: 76000, retailPrice: 57000, wholesaleB1: 38000, wholesaleB2: 35000, planQtyShopee: 1, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 1 },
  { sku: 'BM-NL-SIEUDEO', name: 'Phụ Gia Siêu Dẻo Giảm Nước PCE PPC1201 (Gói 100g)', categoryGroup: 'A', pricingGroup: 'NGUYENLIEU', standardCost: 20565, shopeeActualPrice: 45000, shopeeRegularPrice: 50000, retailPrice: 40000, wholesaleB1: 26000, wholesaleB2: 23000, planQtyShopee: 1, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 1 },
  { sku: 'BM-NL-METAKAOLIN', name: 'Bột Tăng Cứng Thạch Cao & XM Trắng Metakaolin MKA11 (Túi 500g)', categoryGroup: 'A', pricingGroup: 'NGUYENLIEU', standardCost: 27926, shopeeActualPrice: 59000, shopeeRegularPrice: 65000, retailPrice: 51000, wholesaleB1: 35000, wholesaleB2: 32000, planQtyShopee: 1, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 1 },
  { sku: 'BM-BB-ZIP-2030', name: 'Túi Zip Chỉ Đỏ PE 20x30cm (Xấp Đóng Gói)', categoryGroup: 'A', pricingGroup: 'BAOBI', standardCost: 21867, shopeeActualPrice: 37000, shopeeRegularPrice: 41000, retailPrice: 30000, wholesaleB1: 25000, wholesaleB2: 23000, planQtyShopee: 0, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 1 },
  { sku: 'BM-BB-ZIP-1825', name: 'Túi Zip Chỉ Đỏ PE 18x25cm (Xấp Đóng Gói)', categoryGroup: 'A', pricingGroup: 'BAOBI', standardCost: 16288, shopeeActualPrice: 28000, shopeeRegularPrice: 31000, retailPrice: 23000, wholesaleB1: 19000, wholesaleB2: 18000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
  { sku: 'BM-BB-ZIP-1217', name: 'Túi Zip Chỉ Đỏ PE 12x17cm (Xấp Đóng Gói)', categoryGroup: 'A', pricingGroup: 'BAOBI', standardCost: 16287, shopeeActualPrice: 28000, shopeeRegularPrice: 31000, retailPrice: 23000, wholesaleB1: 19000, wholesaleB2: 18000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
  { sku: 'BM-BB-CT-201510', name: 'Combo Hộp Carton Sóng B 20x15x10cm (Gói 10 Hộp)', categoryGroup: 'A', pricingGroup: 'BAOBI', standardCost: 20128, shopeeActualPrice: 34000, shopeeRegularPrice: 38000, retailPrice: 28000, wholesaleB1: 23000, wholesaleB2: 21000, planQtyShopee: 0, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 1 },
  { sku: 'BM-BB-CT-302015', name: 'Combo Hộp Carton Sóng B 30x20x15cm (Gói 10 Hộp)', categoryGroup: 'A', pricingGroup: 'BAOBI', standardCost: 38610, shopeeActualPrice: 61000, shopeeRegularPrice: 68000, retailPrice: 50000, wholesaleB1: 43000, wholesaleB2: 40000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
  { sku: 'BM-SET-HUKHAY', name: 'Set Combo Hũ + Khay Thạch Cao Decor (Mộc Trắng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 20259, shopeeActualPrice: 89000, shopeeRegularPrice: 99000, retailPrice: 78000, wholesaleB1: 51000, wholesaleB2: 43000, planQtyShopee: 5, planQtyRetail: 2, planQtyWholesale: 0, minFinishedStock: 2 },
  { sku: 'BM-KD-CHUMSOC', name: 'Chum Sọc Thạch Cao Đặt Nến Tealight (Chờ Kiểm Khuôn Riêng)', categoryGroup: 'A', pricingGroup: 'DECOR', standardCost: 9281, shopeeActualPrice: 31000, shopeeRegularPrice: 34000, retailPrice: 27000, wholesaleB1: 18000, wholesaleB2: 15000, planQtyShopee: 5, planQtyRetail: 1, planQtyWholesale: 0, minFinishedStock: 2 },
  { sku: 'BM-SI-TC-5KG', name: 'Combo Sỉ 5kg Bột Thạch Cao Thái Lan TA-P3C (5 Túi Zip 1kg — Đóng Chung Thùng Sỉ)', categoryGroup: 'B', pricingGroup: 'SI-NL', standardCost: 60071, shopeeActualPrice: null, shopeeRegularPrice: null, retailPrice: 89000, wholesaleB1: 81000, wholesaleB2: 75000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
  { sku: 'BM-SI-TC-25KG', name: 'Bao Sỉ Nguyên 25kg Bột Thạch Cao Thái Lan TA-P3C (Nguyên Bao Nhà Máy — Giao Xưởng)', categoryGroup: 'B', pricingGroup: 'SI-NL', standardCost: 237542, shopeeActualPrice: null, shopeeRegularPrice: null, retailPrice: 330000, wholesaleB1: 307000, wholesaleB2: 287000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 3, minFinishedStock: 1 },
  { sku: 'BM-SI-PG-COMBO', name: 'Combo Sỉ Phụ Gia Đúc Thạch Cao Xưởng (1kg Metakaolin + 200g Siêu Dẻo + 100g Phá Bọt)', categoryGroup: 'B', pricingGroup: 'SI-NL', standardCost: 108100, shopeeActualPrice: null, shopeeRegularPrice: null, retailPrice: 161000, wholesaleB1: 148000, wholesaleB2: 138000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 2, minFinishedStock: 1 },
  { sku: 'BM-SI-HU-LO10', name: 'Thùng Sỉ 10 Phôi Hũ Thạch Cao Trắng Mix Mẫu (Đóng Thùng Lớn + Xốp Nổ — Không Hộp Lẻ)', categoryGroup: 'B', pricingGroup: 'PHOI-SI', standardCost: 100937, shopeeActualPrice: null, shopeeRegularPrice: null, retailPrice: 289000, wholesaleB1: 250000, wholesaleB2: 230000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
  { sku: 'BM-SI-KHAY-LO10', name: 'Thùng Sỉ 10 Khay / Đế Nến Thạch Cao Trắng Mix Mẫu (Sen / Oval / Tim — Đóng Thùng Sỉ)', categoryGroup: 'B', pricingGroup: 'PHOI-SI', standardCost: 73011, shopeeActualPrice: null, shopeeRegularPrice: null, retailPrice: 200000, wholesaleB1: 173000, wholesaleB2: 159000, planQtyShopee: 0, planQtyRetail: 0, planQtyWholesale: 0, minFinishedStock: 0 },
]

function buildDecorBom(
  sku: string,
  plasterG: number,
  cementG: number,
  sandG: number,
  pceG: number,
  defoamerG: number,
  metakaolinG: number,
  sealerMl: number
): BomStandardLine[] {
  return [
    { sku, kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: plasterG },
    { sku, kind: 'NVL', materialCode: 'NVL-003', qtyPerUnit: cementG },
    { sku, kind: 'NVL', materialCode: 'NVL-002', qtyPerUnit: sandG },
    { sku, kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: pceG },
    { sku, kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: defoamerG },
    { sku, kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: metakaolinG },
    { sku, kind: 'NVL', materialCode: 'PG-005', qtyPerUnit: sealerMl },
    { sku, kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
    { sku, kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 0.5 },
    { sku, kind: 'Bao bì', materialCode: 'BB-004', qtyPerUnit: 0.5 },
    { sku, kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
    { sku, kind: 'Bao bì', materialCode: 'BB-006', qtyPerUnit: 2 },
    { sku, kind: 'Bao bì', materialCode: 'BB-007', qtyPerUnit: 0.5 },
    { sku, kind: 'Bao bì', materialCode: 'BB-011', qtyPerUnit: 0.8 },
    { sku, kind: 'Bao bì', materialCode: 'BB-017', qtyPerUnit: 1 },
  ]
}

export const CANONICAL_BOM: BomStandardLine[] = [
  ...buildDecorBom('BM-DEC-LAMA-LUN', 300, 75, 15, 0.6, 0.3, 9, 9),
  ...buildDecorBom('BM-DEC-BUPSEN', 300, 75, 15, 0.6, 0.3, 9, 9),
  ...buildDecorBom('BM-DEC-LAMA-CAO', 300, 75, 15, 0.6, 0.3, 9, 9),
  ...buildDecorBom('BM-DEC-VAT-BACAU', 300, 75, 15, 0.6, 0.3, 9, 9),
  ...buildDecorBom('BM-DEC-SOC-PHANG', 300, 75, 15, 0.6, 0.3, 9, 9),
  ...buildDecorBom('BM-DEC-SEN', 100, 25, 5, 0.2, 0.1, 3, 3),
  ...buildDecorBom('BM-DEC-SEN-L', 200, 50, 10, 0.4, 0.2, 6, 6),
  ...buildDecorBom('BM-DEC-OVAL', 200, 50, 10, 0.4, 0.2, 6, 6),
  ...buildDecorBom('BM-DEC-TRAITIM', 100, 25, 5, 0.2, 0.1, 3, 3),
  // BM-SET-HUKHAY
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 500 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'NVL-003', qtyPerUnit: 125 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'NVL-002', qtyPerUnit: 25 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: 1 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: 0.5 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: 15 },
  { sku: 'BM-SET-HUKHAY', kind: 'NVL', materialCode: 'PG-005', qtyPerUnit: 15 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 1 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-004', qtyPerUnit: 1 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-006', qtyPerUnit: 4 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-007', qtyPerUnit: 0.5 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-011', qtyPerUnit: 1 },
  { sku: 'BM-SET-HUKHAY', kind: 'Bao bì', materialCode: 'BB-017', qtyPerUnit: 2 },
  // BM-KD-CHUMSOC
  ...buildDecorBom('BM-KD-CHUMSOC', 100, 25, 5, 0.2, 0.1, 3, 3),
  // Nguyên liệu đóng lẻ
  { sku: 'BM-NL-THACHCAO', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 1000 },
  { sku: 'BM-NL-THACHCAO', kind: 'Bao bì', materialCode: 'BB-008', qtyPerUnit: 1 },
  { sku: 'BM-NL-THACHCAO', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
  { sku: 'BM-NL-THACHCAO', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-NL-THACHCAO', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 0.5 },
  { sku: 'BM-NL-THACHCAO', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-NL-PHABOT', kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: 100 },
  { sku: 'BM-NL-PHABOT', kind: 'Bao bì', materialCode: 'BB-010', qtyPerUnit: 1 },
  { sku: 'BM-NL-PHABOT', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
  { sku: 'BM-NL-PHABOT', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-NL-PHABOT', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 0.5 },
  { sku: 'BM-NL-PHABOT', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-NL-SIEUDEO', kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: 100 },
  { sku: 'BM-NL-SIEUDEO', kind: 'Bao bì', materialCode: 'BB-010', qtyPerUnit: 1 },
  { sku: 'BM-NL-SIEUDEO', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
  { sku: 'BM-NL-SIEUDEO', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-NL-SIEUDEO', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 0.5 },
  { sku: 'BM-NL-SIEUDEO', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: 500 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'Bao bì', materialCode: 'BB-009', qtyPerUnit: 1 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 0.5 },
  { sku: 'BM-NL-METAKAOLIN', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  // Bao bì bán lẻ
  { sku: 'BM-BB-CT-201510', kind: 'NVL', materialCode: 'BB-001', qtyPerUnit: 10 },
  { sku: 'BM-BB-CT-201510', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-BB-CT-302015', kind: 'NVL', materialCode: 'BB-002', qtyPerUnit: 10 },
  { sku: 'BM-BB-CT-302015', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-BB-ZIP-2030', kind: 'NVL', materialCode: 'BB-008', qtyPerUnit: 20 },
  { sku: 'BM-BB-ZIP-2030', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 3 },
  { sku: 'BM-BB-ZIP-1825', kind: 'NVL', materialCode: 'BB-009', qtyPerUnit: 25 },
  { sku: 'BM-BB-ZIP-1825', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 3 },
  { sku: 'BM-BB-ZIP-1217', kind: 'NVL', materialCode: 'BB-010', qtyPerUnit: 50 },
  { sku: 'BM-BB-ZIP-1217', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 3 },
  // Sỉ
  { sku: 'BM-SI-TC-5KG', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 5000 },
  { sku: 'BM-SI-TC-5KG', kind: 'Bao bì', materialCode: 'BB-008', qtyPerUnit: 5 },
  { sku: 'BM-SI-TC-5KG', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 5 },
  { sku: 'BM-SI-TC-5KG', kind: 'Bao bì', materialCode: 'BB-002', qtyPerUnit: 1 },
  { sku: 'BM-SI-TC-5KG', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 10 },
  { sku: 'BM-SI-TC-25KG', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 25000 },
  { sku: 'BM-SI-TC-25KG', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 2 },
  { sku: 'BM-SI-TC-25KG', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 15 },
  { sku: 'BM-SI-PG-COMBO', kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: 1000 },
  { sku: 'BM-SI-PG-COMBO', kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: 200 },
  { sku: 'BM-SI-PG-COMBO', kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: 100 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-008', qtyPerUnit: 1 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-010', qtyPerUnit: 2 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 3 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-001', qtyPerUnit: 1 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 1 },
  { sku: 'BM-SI-PG-COMBO', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 5 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 3000 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'NVL-003', qtyPerUnit: 750 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'NVL-002', qtyPerUnit: 150 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: 90 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: 6 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: 3 },
  { sku: 'BM-SI-HU-LO10', kind: 'NVL', materialCode: 'PG-005', qtyPerUnit: 90 },
  { sku: 'BM-SI-HU-LO10', kind: 'Bao bì', materialCode: 'BB-002', qtyPerUnit: 1 },
  { sku: 'BM-SI-HU-LO10', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 5 },
  { sku: 'BM-SI-HU-LO10', kind: 'Bao bì', materialCode: 'BB-006', qtyPerUnit: 50 },
  { sku: 'BM-SI-HU-LO10', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 20 },
  { sku: 'BM-SI-HU-LO10', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'NVL-001', qtyPerUnit: 2000 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'NVL-003', qtyPerUnit: 500 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'NVL-002', qtyPerUnit: 100 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'PG-004', qtyPerUnit: 60 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'PG-006', qtyPerUnit: 4 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'PG-003', qtyPerUnit: 2 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'NVL', materialCode: 'PG-005', qtyPerUnit: 60 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'Bao bì', materialCode: 'BB-002', qtyPerUnit: 1 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'Bao bì', materialCode: 'BB-003', qtyPerUnit: 4 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'Bao bì', materialCode: 'BB-006', qtyPerUnit: 40 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'Bao bì', materialCode: 'BB-005', qtyPerUnit: 15 },
  { sku: 'BM-SI-KHAY-LO10', kind: 'Bao bì', materialCode: 'BB-016', qtyPerUnit: 1 },
]

export const DEFAULT_VT_OPENING: Record<string, { qty: number; status: string; note: string }> = {
  'NVL-001': { qty: 25000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'NVL-002': { qty: 2000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'NVL-003': { qty: 2000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'NVL-004': { qty: 5000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'NVL-005': { qty: 0, status: 'Chưa có hàng', note: '' },
  'NVL-006': { qty: 0, status: 'Chưa có hàng', note: '' },
  'PG-001': { qty: 500, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'PG-002': { qty: 1500, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'PG-003': { qty: 5000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'PG-004': { qty: 2000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'PG-005': { qty: 1000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'PG-006': { qty: 2000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-001': { qty: 50, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-002': { qty: 20, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-003': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-004': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-005': { qty: 1000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-006': { qty: 2000, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-007': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-008': { qty: 75, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-009': { qty: 125, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-010': { qty: 250, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-011': { qty: 410, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'BB-012': { qty: 0, status: 'Chưa có hàng', note: '' },
  'BB-013': { qty: 0, status: 'Chưa có hàng', note: '' },
  'BB-014': { qty: 0, status: 'Chưa có hàng', note: '' },
  'BB-015': { qty: 0, status: 'Chưa có hàng', note: '' },
  'BB-016': { qty: 800, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'TH-001': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'TH-002': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'TH-003': { qty: 10, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'TH-004': { qty: 5, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
  'HH-001': { qty: 0, status: 'Chưa có hàng', note: '' },
  'BB-017': { qty: 100, status: 'Ước tính — cần cân/đếm lại', note: 'Ước tính theo 1 lần mua; đã dùng thử bao nhiêu thì trừ đi.' },
}

export const CARRIER_FEE_ESTIMATES: Record<string, number> = {
  SPX: 20_000,
  GHN: 22_000,
  GHTK: 22_000,
  JT: 20_000,
  VIETTEL: 15_000,
  VNPOST: 18_000,
  NINJA: 18_000,
}

export function createDefaultBaocao1State(): Baocao1PersistedState {
  return {
    weighedMaterialCode: 'NVL-001',
    stocktakeCutoffOverride: null,
    openingStockOverrides: {},
    materialReorderOverrides: {},
    skuMinStockOverrides: {},
    manualPurchases: [],
    manualProductions: [],
    manualSalesOrders: [],
    salesOrderStatusOverrides: {},
    manualAdjustments: [],
    otherCashflows: [],
  }
}

export function isValidBaocaoYmd(str: string): boolean {
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

const MATERIAL_PREFIX_RE = /^(NVL|PG|BB|TH|HH)-\d+/i

export function isMaterialCode(sku: string, productType?: string | null): boolean {
  if (productType === 'MATERIAL') return true
  return MATERIAL_PREFIX_RE.test(sku.trim())
}

/**
 * Maps CMS Shopee 18-variant SKUs (e.g. `BM-DEC-VAT-BACAU-VANG`, `BM-DEC-SEN-TRANG`, `BM-SEN-01-TRANG`)
 * cleanly to the 25 canonical Bơ Mộc SKU codes in `02_SKU`, preserving variant detail for notes.
 */
export function resolveCanonicalSku(
  rawSku: string,
  rawName: string,
  rawAttrs: string | null | undefined,
  knownSkus: Set<string>
): { mappedSku: string; variantNote: string | null } {
  const clean = rawSku.trim().toUpperCase()
  if (knownSkus.has(clean)) {
    return { mappedSku: clean, variantNote: null }
  }

  let parentSku = ''
  let attrModelName = ''
  if (rawAttrs) {
    try {
      const parsed = JSON.parse(rawAttrs) as Record<string, unknown>
      if (typeof parsed.parentSku === 'string') parentSku = parsed.parentSku.trim().toUpperCase()
      if (typeof parsed.shopeeModelName === 'string') {
        attrModelName = parsed.shopeeModelName.trim()
      } else if (typeof parsed.modelName === 'string') {
        attrModelName = parsed.modelName.trim()
      }
    } catch {
      // ignore invalid JSON
    }
  }

  const lowerName = rawName.toLowerCase()
  const lowerModelName = attrModelName.toLowerCase()

  // `BM-DEC-SEN-TRANG / KEM / XANHSAGE` in shop `thaimy1605` is "Hũ Thạch Cao Búp Sen Có Nắp" -> `BM-DEC-BUPSEN`
  // Bảo toàn ánh xạ BOM 300g kể cả khi chủ shop đổi tiêu đề sản phẩm trên Shopee (không còn chữ "búp sen"),
  // đồng thời không lấn sang dòng `BM-DEC-SEN-L-*` (Đế Nến Hoa Sen Size Lớn).
  if (
    parentSku === 'BM-DEC-BUPSEN' ||
    (clean.startsWith('BM-DEC-SEN-') &&
      !clean.startsWith('BM-DEC-SEN-L-') &&
      (lowerName.includes('búp sen') ||
        lowerName.includes('hũ') ||
        (!lowerName.includes('chân nến') && !lowerName.includes('đế nến'))))
  ) {
    return { mappedSku: 'BM-DEC-BUPSEN', variantNote: `Phân loại gốc: ${rawSku}` }
  }
  // `BM-SEN-01-*` is "Chân Nến Hoa Sen, Chum Sọc & Đế Trái Tim" -> distinguish Trái Tim vs Chum Sọc vs Chân Sen (kể cả khi đổi tên sản phẩm trên Shopee)
  if (clean.startsWith('BM-SEN-01')) {
    if (
      /(^|-)TIM(-|$)|TRAITIM|TRAI-TIM/.test(clean) ||
      lowerName.includes('phân loại: trái tim') ||
      lowerName.includes('phân loại: tim') ||
      lowerModelName.includes('trái tim') ||
      lowerModelName.includes('trai tim')
    ) {
      return { mappedSku: 'BM-DEC-TRAITIM', variantNote: `Phân loại gốc: ${rawSku}` }
    }
    if (
      clean.includes('CHUM') ||
      lowerName.includes('phân loại: chum') ||
      lowerModelName.includes('chum')
    ) {
      return { mappedSku: 'BM-KD-CHUMSOC', variantNote: `Phân loại gốc: ${rawSku}` }
    }
    return { mappedSku: 'BM-DEC-SEN', variantNote: `Phân loại gốc: ${rawSku}` }
  }
  // `BM-DEC-COC-TRON` -> `BM-DEC-SOC-PHANG` (or direct if added)
  if (clean === 'BM-DEC-COC-TRON') {
    return { mappedSku: 'BM-DEC-SOC-PHANG', variantNote: `Mã gốc CMS: ${rawSku}` }
  }

  if (parentSku && knownSkus.has(parentSku)) {
    return { mappedSku: parentSku, variantNote: `Phân loại gốc: ${rawSku}` }
  }

  const sortedCandidates = Array.from(knownSkus).sort((a, b) => b.length - a.length)
  for (const candidate of sortedCandidates) {
    if (clean.startsWith(`${candidate}-`)) {
      return { mappedSku: candidate, variantNote: `Phân loại gốc: ${rawSku}` }
    }
  }

  return { mappedSku: clean, variantNote: null }
}

export function toLocalDateYmd(date: Date): string {
  // Vietnam timezone UTC+7 deterministic date formatting
  const vnMs = date.getTime() + 7 * 3600_000
  const vn = new Date(vnMs)
  const y = vn.getUTCFullYear()
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0')
  const d = String(vn.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function normalizeMonthStart(monthInput?: string | null, fallbackYmd?: string): string {
  if (monthInput) {
    const m = /^(\d{4})-(\d{2})/.exec(monthInput.trim())
    if (m) {
      const year = Number(m[1])
      const month = Number(m[2])
      if (year >= 2020 && year <= 2100 && month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}-01`
      }
    }
  }
  if (fallbackYmd) return `${fallbackYmd.slice(0, 7)}-01`
  const today = toLocalDateYmd(new Date())
  return `${today.slice(0, 7)}-01`
}

export function nextMonthStart(monthStartYmd: string): string {
  const [yStr, mStr] = monthStartYmd.split('-')
  let y = Number(yStr)
  let m = Number(mStr) + 1
  if (m > 12) {
    m = 1
    y += 1
  }
  return `${y}-${String(m).padStart(2, '0')}-01`
}

export function subtractDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

export function channelStandardPriceForSku(
  skuItem: SkuCatalogItem | undefined,
  channel: 'Shopee' | 'Lẻ Zalo / Website' | 'Sỉ'
): number {
  if (!skuItem) return 0
  if (channel === 'Shopee') return skuItem.shopeeActualPrice ?? skuItem.retailPrice
  if (channel === 'Sỉ') {
    return skuItem.categoryGroup === 'B' ? skuItem.retailPrice : skuItem.wholesaleB1
  }
  return skuItem.retailPrice
}

export function weightedPlanPriceForSku(skuItem: SkuCatalogItem): number | null {
  const totalPlanQty = skuItem.planQtyShopee + skuItem.planQtyRetail + skuItem.planQtyWholesale
  const siPrice = skuItem.categoryGroup === 'B' ? skuItem.retailPrice : skuItem.wholesaleB1
  if (totalPlanQty > 0) {
    const totalRev =
      (skuItem.shopeeActualPrice ?? 0) * skuItem.planQtyShopee +
      skuItem.retailPrice * skuItem.planQtyRetail +
      siPrice * skuItem.planQtyWholesale
    return Math.round(totalRev / totalPlanQty)
  }
  return skuItem.shopeeActualPrice ?? skuItem.retailPrice ?? null
}

export interface AssembleBaocao1Input {
  scope: Baocao1DataScope
  currentMonth: string
  currentMonthNext: string
  reportMonth: string
  reportMonthNext: string
  stocktakeCutoffDate: string
  weighedCode: string
  todayYmd: string
  materials: MaterialCatalogItem[]
  skus: SkuCatalogItem[]
  bomLines: BomStandardLine[]
  openingStocks: Array<OpeningStockRow & { name: string; unit: string }>
  rawPurchases: PurchaseLogRow[]
  rawProductions: ProductionBatchRow[]
  rawSales: SalesOrderRow[]
  rawAdjustments: StockAdjustmentRow[]
  otherCashflows: OtherCashflowRow[]
}

export function assembleBaocao1Snapshot(input: AssembleBaocao1Input): Baocao1FullSnapshot {
  const {
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
    rawPurchases,
    rawProductions,
    rawSales,
    rawAdjustments,
    otherCashflows,
  } = input
  const openingStocks = [...input.openingStocks]
  const materialMap = new Map(materials.map((m) => [m.code, m]))
  const skuMap = new Map(skus.map((s) => [s.sku, s]))

  // Ensure any dynamically added SKUs also exist in openingStocks
  const openingTpSet = new Set(openingStocks.filter((o) => o.kind === 'TP').map((o) => o.code))
  for (const s of skus) {
    if (!openingTpSet.has(s.sku)) {
      openingStocks.push({
        kind: 'TP',
        code: s.sku,
        name: s.name,
        unit: 'sp',
        openingQty: 0,
        stocktakeDate: DEFAULT_STOCKTAKE_DATE,
        status: 'Đã kiểm kê',
        note: 'Mã CMS phát sinh bổ sung',
      })
    }
  }

  // 9. Enrich rows with exact Excel-equivalent calculated columns
  const bomWithNames = bomLines.map((b) => ({
    ...b,
    materialName: materialMap.get(b.materialCode)?.name ?? '',
  }))

  // Lookup BOM per SKU
  const nvlBomBySku = new Map<string, BomStandardLine[]>()
  const packBomBySku = new Map<string, BomStandardLine[]>()
  for (const b of bomLines) {
    if (b.kind === 'NVL') {
      const arr = nvlBomBySku.get(b.sku) ?? []
      arr.push(b)
      nvlBomBySku.set(b.sku, arr)
    } else {
      const arr = packBomBySku.get(b.sku) ?? []
      arr.push(b)
      packBomBySku.set(b.sku, arr)
    }
  }

  const purchases = rawPurchases.map((p) => {
    const mat = materialMap.get(p.materialCode)
    const actualUnitCost = p.qtyStandardUnit > 0 ? p.actualTotalPaid / p.qtyStandardUnit : null
    const stdCost = mat?.standardUnitCost ?? null
    const variancePct =
      actualUnitCost !== null && stdCost !== null && stdCost > 0
        ? (actualUnitCost - stdCost) / stdCost
        : null
    return {
      ...p,
      materialName: mat?.name ?? '',
      unit: mat?.unit ?? '',
      actualUnitCost,
      standardUnitCost: stdCost,
      variancePct,
    }
  })

  const productions = rawProductions.map((pr) => {
    const skuObj = skuMap.get(pr.sku)
    const defectQty = pr.qtyStarted - pr.qtyGood
    const defectPct = pr.qtyStarted > 0 ? defectQty / pr.qtyStarted : null
    const plasterPerUnit = (nvlBomBySku.get(pr.sku) ?? [])
      .filter((b) => b.materialCode === weighedCode)
      .reduce((acc, b) => acc + b.qtyPerUnit, 0)
    const standardPlasterGrams = pr.qtyStarted * plasterPerUnit
    const hasWeighed =
      typeof pr.actualPlasterGrams === 'number' &&
      Number.isFinite(pr.actualPlasterGrams) &&
      pr.actualPlasterGrams > 0
    const deductedPlasterGrams = hasWeighed ? (pr.actualPlasterGrams as number) : standardPlasterGrams
    const plasterVarianceGrams = hasWeighed ? (pr.actualPlasterGrams as number) - standardPlasterGrams : null
    return {
      ...pr,
      skuName: skuObj?.name ?? '',
      defectQty,
      defectPct,
      standardPlasterGrams,
      deductedPlasterGrams,
      plasterVarianceGrams,
    }
  })

  const salesOrders = rawSales.map((so) => {
    const skuObj = skuMap.get(so.sku)
    const grossAmount = so.qty * so.actualUnitPrice
    const netPayout = grossAmount - so.platformAndVoucherFee - so.sellerShippingPaid
    const isDelivered = so.status === 'Đã giao'
    const isDamagedReturn = so.status === 'Hoàn hỏng'
    const isIntactReturn = so.status === 'Hoàn nhập kho'
    const isInTransit = so.status === 'Đang giao'

    const recognizedRevenue = isDelivered ? grossAmount : 0
    const recognizedNetPayout = isDelivered
      ? netPayout
      : isDamagedReturn || isIntactReturn
        ? -(so.platformAndVoucherFee + so.sellerShippingPaid)
        : 0
    const stockOutQty = isDelivered || isInTransit || isDamagedReturn ? so.qty : 0
    const packagingOutQty =
      isDelivered || isInTransit || isIntactReturn || isDamagedReturn ? so.qty : 0
    const standardCogs =
      isDelivered || isDamagedReturn ? so.qty * (skuObj?.standardCost ?? 0) : 0
    const grossProfit = recognizedNetPayout - standardCogs
    const channelStandardPrice = channelStandardPriceForSku(skuObj, so.channel)

    return {
      ...so,
      skuName: skuObj?.name ?? '',
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
  })

  const adjustments = rawAdjustments.map((ad) => ({
    ...ad,
    name:
      ad.kind === 'VT'
        ? (materialMap.get(ad.code)?.name ?? '')
        : (skuMap.get(ad.code)?.name ?? ''),
  }))


  // 10. Compute 09_Ton_Kho_Vat_Tu
  const materialInventory: ComputedMaterialStockRow[] = materials.map((m) => {
    const openingQty = openingStocks
      .filter((o) => o.kind === 'VT' && o.code === m.code)
      .reduce((acc, o) => acc + o.openingQty, 0)
    const purchasedQty = purchases
      .filter((p) => p.materialCode === m.code)
      .reduce((acc, p) => acc + p.qtyStandardUnit, 0)

    let productionUsedQty = 0
    if (m.code === weighedCode) {
      productionUsedQty = productions.reduce((acc, pr) => acc + pr.deductedPlasterGrams, 0)
    } else {
      for (const pr of productions) {
        const lines = nvlBomBySku.get(pr.sku) ?? []
        for (const l of lines) {
          if (l.materialCode === m.code) {
            productionUsedQty += pr.qtyStarted * l.qtyPerUnit
          }
        }
      }
    }

    let packagingSoldQty = 0
    for (const so of salesOrders) {
      if (so.packagingOutQty <= 0) continue
      const lines = packBomBySku.get(so.sku) ?? []
      for (const l of lines) {
        if (l.materialCode === m.code) {
          packagingSoldQty += so.packagingOutQty * l.qtyPerUnit
        }
      }
    }

    const adjustedQty = adjustments
      .filter((a) => a.kind === 'VT' && a.code === m.code)
      .reduce((acc, a) => acc + a.deltaQty, 0)

    const currentQty = Math.round((openingQty + purchasedQty - productionUsedQty - packagingSoldQty + adjustedQty) * 10000) / 10000
    const unitCost = m.standardUnitCost ?? 0
    const stockValue = Math.round(Math.max(0, currentQty) * unitCost)

    let alert: ComputedMaterialStockRow['alert'] = ''
    if (currentQty < 0) {
      alert = 'ÂM KHO'
    } else if (m.status === 'Đang dùng' && m.reorderPoint !== null && m.reorderPoint > 0) {
      alert = currentQty <= m.reorderPoint ? 'CẦN ĐẶT HÀNG' : 'OK'
    } else if (m.status === 'Đang dùng') {
      alert = 'OK'
    }

    return {
      code: m.code,
      name: m.name,
      unit: m.unit,
      status: m.status,
      standardUnitCost: unitCost,
      openingQty,
      purchasedQty,
      productionUsedQty: Math.round(productionUsedQty * 10000) / 10000,
      packagingSoldQty: Math.round(packagingSoldQty * 10000) / 10000,
      adjustedQty,
      currentQty,
      reorderPoint: m.reorderPoint,
      alert,
      stockValue,
    }
  })

  // 11. Compute 10_Ton_Kho_Thanh_Pham
  const thirtyDaysAgoYmd = subtractDaysYmd(todayYmd, 30)
  const finishedInventory: ComputedFinishedStockRow[] = skus.map((s) => {
    const openingQty = openingStocks
      .filter((o) => o.kind === 'TP' && o.code === s.sku)
      .reduce((acc, o) => acc + o.openingQty, 0)
    const producedGoodQty = productions
      .filter((pr) => pr.sku === s.sku)
      .reduce((acc, pr) => acc + pr.qtyGood, 0)
    const soldOutQty = salesOrders
      .filter((so) => so.sku === s.sku)
      .reduce((acc, so) => acc + so.stockOutQty, 0)
    const adjustedQty = adjustments
      .filter((a) => a.kind === 'TP' && a.code === s.sku)
      .reduce((acc, a) => acc + a.deltaQty, 0)

    const currentQty = openingQty + producedGoodQty - soldOutQty + adjustedQty
    const stockValue = Math.round(Math.max(0, currentQty) * s.standardCost)
    const soldLast30Days = salesOrders
      .filter((so) => so.sku === s.sku && so.date >= thirtyDaysAgoYmd)
      .reduce((acc, so) => acc + so.stockOutQty, 0)

    let alert: ComputedFinishedStockRow['alert'] = ''
    if (currentQty < 0) {
      alert = 'ÂM KHO'
    } else if (s.minFinishedStock > 0 && currentQty < s.minFinishedStock) {
      alert = 'CẦN ĐÚC / ĐÓNG THÊM'
    } else if (s.minFinishedStock > 0 || currentQty > 0) {
      alert = 'OK'
    }

    return {
      sku: s.sku,
      name: s.name,
      standardCost: s.standardCost,
      openingQty,
      producedGoodQty,
      soldOutQty,
      adjustedQty,
      currentQty,
      minStock: s.minFinishedStock,
      alert,
      stockValue,
      soldLast30Days,
    }
  })

  // 12. Compute 00_Tong_Quan (for currentMonth)
  const inCurrentMonth = (ymd: string) => ymd >= currentMonth && ymd < currentMonthNext
  const curSales = salesOrders.filter((s) => inCurrentMonth(s.date))
  const curProds = productions.filter((p) => inCurrentMonth(p.date))
  const curPurchases = purchases.filter((p) => inCurrentMonth(p.date))
  const curOtherChi = otherCashflows.filter((c) => c.flowType === 'Chi' && inCurrentMonth(c.date))

  const overview = {
    thisMonth: {
      recognizedRevenue: curSales.reduce((a, s) => a + s.recognizedRevenue, 0),
      netPayout: curSales.reduce((a, s) => a + s.recognizedNetPayout, 0),
      grossProfit: curSales.reduce((a, s) => a + s.grossProfit, 0),
      soldUnits: curSales
        .filter((s) => s.status === 'Đã giao')
        .reduce((a, s) => a + s.qty, 0),
      producedGoodUnits: curProds.reduce((a, p) => a + p.qtyGood, 0),
      materialPurchaseSpent: curPurchases.reduce((a, p) => a + p.actualTotalPaid, 0),
      otherExpenses: curOtherChi.reduce((a, c) => a + c.amount, 0),
      planMonthlyUnits: PLAN_MONTHLY_SL,
      planMonthlyNetProfit: PLAN_MONTHLY_NET_PROFIT,
    },
    stockAlerts: {
      materialsNeedReorder: materialInventory.filter((m) => m.alert === 'CẦN ĐẶT HÀNG').length,
      skusNeedProduction: finishedInventory.filter((f) => f.alert === 'CẦN ĐÚC / ĐÓNG THÊM').length,
      negativeStockCodes:
        materialInventory.filter((m) => m.currentQty < 0).length +
        finishedInventory.filter((f) => f.currentQty < 0).length,
      materialStockValue: materialInventory.reduce((a, m) => a + m.stockValue, 0),
      finishedStockValue: finishedInventory.reduce((a, f) => a + f.stockValue, 0),
      unverifiedOpeningCount: openingStocks.filter((o) => o.status.startsWith('Ước tính')).length,
    },
  }

  // 13. Compute 12_Bao_Cao_Thang (for reportMonth)
  const inReportMonth = (ymd: string) => ymd >= reportMonth && ymd < reportMonthNext
  const repSales = salesOrders.filter((s) => inReportMonth(s.date))
  const repProds = productions.filter((p) => inReportMonth(p.date))
  const repPurchases = purchases.filter((p) => inReportMonth(p.date))
  const repCashflows = otherCashflows.filter((c) => inReportMonth(c.date))

  const channelsOrder: Array<'Shopee' | 'Lẻ Zalo / Website' | 'Sỉ'> = [
    'Shopee',
    'Lẻ Zalo / Website',
    'Sỉ',
  ]
  const byChannel: ChannelReportRow[] = channelsOrder.map((ch) => {
    const chSales = repSales.filter((s) => s.channel === ch)
    const actualQty = chSales.filter((s) => s.status === 'Đã giao').reduce((a, s) => a + s.qty, 0)
    const plan = PLAN_CHANNEL_TARGETS[ch]
    return {
      channel: ch,
      actualQty,
      planQty: plan.qty,
      qtyAchievementPct: plan.qty > 0 ? actualQty / plan.qty : null,
      actualRevenue: chSales.reduce((a, s) => a + s.recognizedRevenue, 0),
      planRevenue: plan.revenue,
      actualNetPayout: chSales.reduce((a, s) => a + s.recognizedNetPayout, 0),
      standardCogs: chSales.reduce((a, s) => a + s.standardCogs, 0),
      actualGrossProfit: chSales.reduce((a, s) => a + s.grossProfit, 0),
      planContributionProfit: plan.contributionProfit,
    }
  })

  const totalActualQty = byChannel.reduce((a, c) => a + c.actualQty, 0)
  const totalPlanQty = byChannel.reduce((a, c) => a + c.planQty, 0)
  const channelTotal: Omit<ChannelReportRow, 'channel'> = {
    actualQty: totalActualQty,
    planQty: totalPlanQty,
    qtyAchievementPct: totalPlanQty > 0 ? totalActualQty / totalPlanQty : null,
    actualRevenue: byChannel.reduce((a, c) => a + c.actualRevenue, 0),
    planRevenue: byChannel.reduce((a, c) => a + c.planRevenue, 0),
    actualNetPayout: byChannel.reduce((a, c) => a + c.actualNetPayout, 0),
    standardCogs: byChannel.reduce((a, c) => a + c.standardCogs, 0),
    actualGrossProfit: byChannel.reduce((a, c) => a + c.actualGrossProfit, 0),
    planContributionProfit: byChannel.reduce((a, c) => a + c.planContributionProfit, 0),
  }

  const opexSpentPositive = repCashflows
    .filter((c) => c.flowType === 'Chi' && c.group.toUpperCase().startsWith('OPEX'))
    .reduce((a, c) => a + c.amount, 0)
  const actualOpex = -opexSpentPositive
  const actualGrossProfit = channelTotal.actualGrossProfit
  const actualNetProfit = actualGrossProfit + actualOpex

  const weighedBatches = repProds.filter(
    (p) =>
      typeof p.actualPlasterGrams === 'number' &&
      Number.isFinite(p.actualPlasterGrams) &&
      p.actualPlasterGrams > 0
  )
  const totalQtyStarted = repProds.reduce((a, p) => a + p.qtyStarted, 0)
  const totalQtyGood = repProds.reduce((a, p) => a + p.qtyGood, 0)
  const weighedActualG = weighedBatches.reduce((a, p) => a + (p.actualPlasterGrams ?? 0), 0)
  const weighedStdG = weighedBatches.reduce((a, p) => a + p.standardPlasterGrams, 0)

  const otherIncome = repCashflows
    .filter((c) => c.flowType === 'Thu')
    .reduce((a, c) => a + c.amount, 0)
  const materialPurchasesNeg = -repPurchases.reduce((a, p) => a + p.actualTotalPaid, 0)
  const otherExpensesNeg = -repCashflows
    .filter((c) => c.flowType === 'Chi')
    .reduce((a, c) => a + c.amount, 0)
  const netFromSales = channelTotal.actualNetPayout
  const netCashflow = netFromSales + otherIncome + materialPurchasesNeg + otherExpensesNeg

  const bySku: SkuMonthlyReportRow[] = skus.map((s) => {
    const skuSales = repSales.filter((so) => so.sku === s.sku && so.status === 'Đã giao')
    const actualSoldQty = skuSales.reduce((a, so) => a + so.qty, 0)
    const skuRev = skuSales.reduce((a, so) => a + so.recognizedRevenue, 0)
    const planMonthlyQty = s.planQtyShopee + s.planQtyRetail + s.planQtyWholesale
    const actualAvgPrice = actualSoldQty > 0 ? Math.round(skuRev / actualSoldQty) : null
    const standardAvgPrice = weightedPlanPriceForSku(s)
    const priceVariance =
      actualAvgPrice !== null && standardAvgPrice !== null
        ? actualAvgPrice - standardAvgPrice
        : null

    const skuProds = repProds.filter((pr) => pr.sku === s.sku)
    const qtyStarted = skuProds.reduce((a, pr) => a + pr.qtyStarted, 0)
    const qtyGood = skuProds.reduce((a, pr) => a + pr.qtyGood, 0)
    const defectPct = qtyStarted > 0 ? (qtyStarted - qtyGood) / qtyStarted : null

    return {
      sku: s.sku,
      name: s.name,
      actualSoldQty,
      planMonthlyQty,
      achievementPct: planMonthlyQty > 0 ? actualSoldQty / planMonthlyQty : null,
      actualAvgPrice,
      standardAvgPrice,
      priceVariance,
      qtyStarted,
      qtyGood,
      defectPct,
    }
  })

  return {
    meta: {
      currentMonth,
      currentMonthNext,
      reportMonth,
      reportMonthNext,
      scope,
      stocktakeCutoffDate,
      weighedMaterialCode: weighedCode,
      generatedAt: new Date().toISOString(),
    },
    overview,
    materials,
    skus,
    bom: bomWithNames,
    openingStocks,
    purchases,
    productions,
    salesOrders,
    adjustments,
    materialInventory,
    finishedInventory,
    otherCashflows,
    monthlyReport: {
      byChannel,
      channelTotal,
      pnl: {
        actualGrossProfit,
        planGrossProfit: PLAN_MONTHLY_GROSS_PROFIT,
        actualOpex,
        planOpex: PLAN_MONTHLY_OPEX,
        actualNetProfit,
        planNetProfit: PLAN_MONTHLY_NET_PROFIT,
        directLaborActual: PLAN_DIRECT_LABOR,
        directLaborPlan: PLAN_DIRECT_LABOR,
        estimatedFamilyIncomeActual: actualNetProfit + PLAN_DIRECT_LABOR,
        estimatedFamilyIncomePlan: PLAN_MONTHLY_NET_PROFIT + PLAN_DIRECT_LABOR,
      },
      productionSummary: {
        batchCount: repProds.length,
        totalQtyStarted,
        totalQtyGood,
        defectRate: totalQtyStarted > 0 ? (totalQtyStarted - totalQtyGood) / totalQtyStarted : null,
        weighedPlasterActualGrams: weighedActualG,
        weighedPlasterStandardGrams: weighedStdG,
        plasterVarianceGrams: weighedActualG - weighedStdG,
      },
      cashflow: {
        netFromSales,
        otherIncome,
        materialPurchases: materialPurchasesNeg,
        otherExpenses: otherExpensesNeg,
        netCashflow,
      },
      bySku,
    },
  }
}

export interface RecomputeBaocaoOptions {
  reportMonth?: string | null
  currentMonth?: string | null
  scope?: Baocao1DataScope
  todayYmd?: string
}

/**
 * Recomputes a complete 13-sheet `Baocao1FullSnapshot` in memory from a baseline `all`-scope snapshot
 * plus a client/persisted `Baocao1PersistedState` overlay, preserving 100% formula parity with the server.
 */
export function recomputeBaocaoSnapshotFromBase(
  baseAllSnap: Baocao1FullSnapshot,
  state: Baocao1PersistedState,
  options: RecomputeBaocaoOptions = {}
): Baocao1FullSnapshot {
  const scope: Baocao1DataScope =
    options.scope === 'all' || options.scope === 'template' ? options.scope : 'from_stocktake'
  const todayYmd = options.todayYmd || toLocalDateYmd(new Date())
  const currentMonth = normalizeMonthStart(options.currentMonth, todayYmd)
  const reportMonth = options.reportMonth ? normalizeMonthStart(options.reportMonth) : currentMonth
  const currentMonthNext = nextMonthStart(currentMonth)
  const reportMonthNext = nextMonthStart(reportMonth)

  const stocktakeCutoffDate =
    state.stocktakeCutoffOverride || baseAllSnap.meta.stocktakeCutoffDate || DEFAULT_STOCKTAKE_DATE
  const weighedCode =
    state.weighedMaterialCode || baseAllSnap.meta.weighedMaterialCode || 'NVL-001'

  const isDateInScope = (ymd: string): boolean => {
    if (scope === 'template') return false
    if (scope === 'all') return true
    return ymd > stocktakeCutoffDate
  }

  const materials: MaterialCatalogItem[] = baseAllSnap.materials.map((m) => ({
    ...m,
    reorderPoint:
      m.code in state.materialReorderOverrides ? state.materialReorderOverrides[m.code] : m.reorderPoint,
  }))

  const skus: SkuCatalogItem[] = CANONICAL_SKUS.map((s) => ({
    ...s,
    minFinishedStock:
      s.sku in state.skuMinStockOverrides ? state.skuMinStockOverrides[s.sku] : s.minFinishedStock,
  }))
  const knownSkuSet = new Set(skus.map((s) => s.sku))
  const skuMap = new Map(skus.map((s) => [s.sku, s]))
  const baseSkuLookup = new Map(baseAllSnap.skus.map((s) => [s.sku.trim().toUpperCase(), s]))

  const ensureSkuInCatalog = (
    skuCode: string,
    fallbackName: string,
    fallbackCost: number,
    fallbackSell: number
  ) => {
    if (skuMap.has(skuCode)) return
    const fromBase = baseSkuLookup.get(skuCode)
    const minOverride =
      skuCode in state.skuMinStockOverrides
        ? state.skuMinStockOverrides[skuCode]
        : (fromBase?.minFinishedStock ?? 0)
    const added: SkuCatalogItem = fromBase
      ? { ...fromBase, minFinishedStock: minOverride }
      : {
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
          minFinishedStock: minOverride,
        }
    skus.push(added)
    skuMap.set(skuCode, added)
    knownSkuSet.add(skuCode)
  }

  const bomLines: BomStandardLine[] = baseAllSnap.bom.map((b) => ({
    sku: b.sku,
    kind: b.kind,
    materialCode: b.materialCode,
    qtyPerUnit: b.qtyPerUnit,
  }))

  const baseOpenMap = new Map(baseAllSnap.openingStocks.map((o) => [`${o.kind}:${o.code}`, o]))
  const openingStocks: Array<OpeningStockRow & { name: string; unit: string }> = []

  for (const m of materials) {
    const key = `VT:${m.code}`
    const baseRow = baseOpenMap.get(key)
    const def = DEFAULT_VT_OPENING[m.code] ?? { qty: 0, status: 'Chưa có hàng', note: '' }
    const ov = state.openingStockOverrides[key]
    openingStocks.push({
      kind: 'VT',
      code: m.code,
      name: m.name,
      unit: m.unit,
      openingQty: ov?.openingQty !== undefined ? ov.openingQty : (baseRow?.openingQty ?? def.qty),
      stocktakeDate: ov?.stocktakeDate || baseRow?.stocktakeDate || DEFAULT_STOCKTAKE_DATE,
      status: ov?.status || baseRow?.status || def.status,
      note: ov?.note !== undefined ? ov.note : (baseRow?.note ?? def.note),
    })
  }

  for (const s of CANONICAL_SKUS) {
    const key = `TP:${s.sku}`
    const baseRow = baseOpenMap.get(key)
    const ov = state.openingStockOverrides[key]
    openingStocks.push({
      kind: 'TP',
      code: s.sku,
      name: s.name,
      unit: 'sp',
      openingQty: ov?.openingQty !== undefined ? ov.openingQty : (baseRow?.openingQty ?? 0),
      stocktakeDate: ov?.stocktakeDate || baseRow?.stocktakeDate || DEFAULT_STOCKTAKE_DATE,
      status: ov?.status || baseRow?.status || 'Ước tính — cần cân/đếm lại',
      note:
        ov?.note !== undefined
          ? ov.note
          : (baseRow?.note ?? 'Thành phẩm đã đúc sẵn (nếu có) thì nhập số đếm được.'),
    })
  }

  const rawPurchases: PurchaseLogRow[] = []
  const rawProductions: ProductionBatchRow[] = []
  const rawSales: SalesOrderRow[] = []
  const rawAdjustments: StockAdjustmentRow[] = []
  const otherCashflows: OtherCashflowRow[] = []

  if (scope !== 'template') {
    for (const bp of baseAllSnap.purchases) {
      if (bp.source === 'MANUAL' || !isDateInScope(bp.date)) continue
      rawPurchases.push({
        id: bp.id,
        date: bp.date,
        docCode: bp.docCode,
        supplier: bp.supplier,
        materialCode: bp.materialCode,
        qtyStandardUnit: bp.qtyStandardUnit,
        actualTotalPaid: bp.actualTotalPaid,
        note: bp.note,
        source: bp.source,
      })
    }
    for (const mp of state.manualPurchases) {
      if (isDateInScope(mp.date)) {
        rawPurchases.push({ ...mp, source: 'MANUAL' })
      }
    }
    rawPurchases.sort((a, b) => a.date.localeCompare(b.date) || a.docCode.localeCompare(b.docCode))

    for (const bpr of baseAllSnap.productions) {
      if (bpr.source === 'MANUAL' || !isDateInScope(bpr.date)) continue
      const baseSku = baseSkuLookup.get(bpr.sku)
      ensureSkuInCatalog(bpr.sku, bpr.skuName || bpr.sku, baseSku?.standardCost ?? 0, baseSku?.retailPrice ?? 0)
      rawProductions.push({
        id: bpr.id,
        date: bpr.date,
        batchCode: bpr.batchCode,
        batchType: bpr.batchType,
        sku: bpr.sku,
        qtyStarted: bpr.qtyStarted,
        qtyGood: bpr.qtyGood,
        actualPlasterGrams: bpr.actualPlasterGrams,
        actualMinutes: bpr.actualMinutes,
        operator: bpr.operator,
        note: bpr.note,
        source: bpr.source,
      })
    }
    for (const mb of state.manualProductions) {
      if (isDateInScope(mb.date)) {
        const baseSku = baseSkuLookup.get(mb.sku.trim().toUpperCase())
        const { mappedSku, variantNote } = resolveCanonicalSku(
          mb.sku,
          baseSku?.name ?? mb.sku,
          null,
          knownSkuSet
        )
        ensureSkuInCatalog(
          mappedSku,
          baseSku?.name ?? mappedSku,
          baseSku?.standardCost ?? 0,
          baseSku?.retailPrice ?? 0
        )
        rawProductions.push({
          ...mb,
          sku: mappedSku,
          note: [variantNote, mb.note].filter(Boolean).join(' · '),
          source: 'MANUAL',
        })
      }
    }
    rawProductions.sort((a, b) => a.date.localeCompare(b.date) || a.batchCode.localeCompare(b.batchCode))

    for (const bso of baseAllSnap.salesOrders) {
      if (bso.source === 'MANUAL' || !isDateInScope(bso.date)) continue
      const baseSku = baseSkuLookup.get(bso.sku)
      ensureSkuInCatalog(bso.sku, bso.skuName || bso.sku, baseSku?.standardCost ?? 0, bso.actualUnitPrice)
      const overriddenStatus =
        (bso.id && state.salesOrderStatusOverrides[bso.id]) ||
        state.salesOrderStatusOverrides[bso.orderCode] ||
        bso.status
      rawSales.push({
        id: bso.id,
        date: bso.date,
        orderCode: bso.orderCode,
        channel: bso.channel,
        customer: bso.customer,
        sku: bso.sku,
        qty: bso.qty,
        actualUnitPrice: bso.actualUnitPrice,
        platformAndVoucherFee: bso.platformAndVoucherFee,
        sellerShippingPaid: bso.sellerShippingPaid,
        status: overriddenStatus,
        note: bso.note,
        source: bso.source,
      })
    }
    for (const ms of state.manualSalesOrders) {
      if (isDateInScope(ms.date)) {
        const baseSku = baseSkuLookup.get(ms.sku.trim().toUpperCase())
        const { mappedSku, variantNote } = resolveCanonicalSku(
          ms.sku,
          baseSku?.name ?? ms.sku,
          null,
          knownSkuSet
        )
        ensureSkuInCatalog(
          mappedSku,
          baseSku?.name ?? mappedSku,
          baseSku?.standardCost ?? 0,
          baseSku?.retailPrice || ms.actualUnitPrice
        )
        const finalStatus = (ms.id && state.salesOrderStatusOverrides[ms.id]) || ms.status
        rawSales.push({
          ...ms,
          sku: mappedSku,
          status: finalStatus,
          note: [variantNote, ms.note].filter(Boolean).join(' · '),
          source: 'MANUAL',
        })
      }
    }
    rawSales.sort((a, b) => a.date.localeCompare(b.date) || a.orderCode.localeCompare(b.orderCode))

    for (const bad of baseAllSnap.adjustments) {
      if (bad.source === 'MANUAL' || !isDateInScope(bad.date)) continue
      if (bad.kind === 'TP') {
        const baseSku = baseSkuLookup.get(bad.code)
        ensureSkuInCatalog(bad.code, bad.name || bad.code, baseSku?.standardCost ?? 0, baseSku?.retailPrice ?? 0)
      }
      rawAdjustments.push({
        id: bad.id,
        date: bad.date,
        kind: bad.kind,
        code: bad.code,
        deltaQty: bad.deltaQty,
        reason: bad.reason,
        note: bad.note,
        source: bad.source,
      })
    }
    for (const ma of state.manualAdjustments) {
      if (isDateInScope(ma.date)) {
        if (ma.kind === 'TP') {
          const baseSku = baseSkuLookup.get(ma.code.trim().toUpperCase())
          const { mappedSku, variantNote } = resolveCanonicalSku(
            ma.code,
            baseSku?.name ?? ma.code,
            null,
            knownSkuSet
          )
          ensureSkuInCatalog(
            mappedSku,
            baseSku?.name ?? mappedSku,
            baseSku?.standardCost ?? 0,
            baseSku?.retailPrice ?? 0
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
    rawAdjustments.sort((a, b) => a.date.localeCompare(b.date))

    for (const bcf of baseAllSnap.otherCashflows) {
      if (isDateInScope(bcf.date)) otherCashflows.push(bcf)
    }
    for (const mcf of state.otherCashflows) {
      if (isDateInScope(mcf.date)) otherCashflows.push(mcf)
    }
    otherCashflows.sort((a, b) => a.date.localeCompare(b.date))
  }

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

// ============================================================================
// 6. Multi-Sheet OpenXML `.xlsx` Sheet Spec & Universal Builder (13 Sheets)
// ============================================================================

export function buildBaocao1Sheets(snap: Baocao1FullSnapshot): XlsxSheetSpec[] {
  const matEndRow = 4 + snap.materials.length
  const skuEndRow = 4 + snap.skus.length
  const bomEndRow = 4 + snap.bom.length
  const openEndRow = 4 + snap.openingStocks.length
  // Reserve generous formula range in transaction sheets so users can add rows directly in Excel
  const purTemplateExtra = 30
  const prodTemplateExtra = 30
  const saleTemplateExtra = 60
  const adjTemplateExtra = 25
  const cashTemplateExtra = 25

  const purMaxRow = Math.max(500, 4 + snap.purchases.length + purTemplateExtra)
  const prodMaxRow = Math.max(500, 4 + snap.productions.length + prodTemplateExtra)
  const saleMaxRow = Math.max(2000, 4 + snap.salesOrders.length + saleTemplateExtra)
  const adjMaxRow = Math.max(500, 4 + snap.adjustments.length + adjTemplateExtra)
  const cashMaxRow = Math.max(500, 4 + snap.otherCashflows.length + cashTemplateExtra)
  const invVtEndRow = 4 + snap.materialInventory.length
  const invTpEndRow = 4 + snap.finishedInventory.length

  // ---------------- 00_Tong_Quan ----------------
  const s00Rows: XlsxCellInput[][] = [
    [{ v: '00. TỔNG QUAN VẬN HÀNH — BƠ MỘC', s: 'title' }],
    [
      {
        v: 'File VẬN HÀNH: ghi chép hằng ngày (nhập hàng, mẻ đúc, đơn bán, thu chi). Tồn kho & báo cáo tự tính. Danh mục/giá chuẩn copy từ Ke_Hoach_Dinh_Gia_Bo_Moc.xlsx.',
        s: 'subtitle',
      },
    ],
    [
      { v: 'Tháng hiện tại:', s: 'textBold' },
      { v: snap.meta.currentMonth, s: 'yellowDate', isDate: true },
      { v: '→ đến trước ngày:', s: 'textMuted' },
      {
        v: nextMonthStart(snap.meta.currentMonth),
        f: 'EDATE(B3,1)',
        s: 'formulaDate',
        isDate: true,
      },
    ],
    [],
    [
      { v: 'A. THÁNG NÀY (TỪ NGÀY 1 ĐẾN HÔM NAY)', s: 'section' },
      { v: '', s: 'section' },
      null,
      null,
      { v: 'B. CẢNH BÁO KHO', s: 'section' },
      { v: '', s: 'section' },
      { v: 'Hướng dẫn xử lý', s: 'section' },
    ],
    [
      { v: 'Doanh thu ghi nhận', s: 'text' },
      {
        v: snap.overview.thisMonth.recognizedRevenue,
        f: `SUMIFS('07_Don_Ban'!$N$5:$N$${saleMaxRow},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$B$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$D$3)`,
        s: 'formulaCurrency',
      },
      null,
      null,
      { v: 'Số vật tư CẦN ĐẶT HÀNG', s: 'text' },
      {
        v: snap.overview.stockAlerts.materialsNeedReorder,
        f: `COUNTIF('09_Ton_Kho_Vat_Tu'!$K$5:$K$${invVtEndRow},"CẦN ĐẶT HÀNG")`,
        s: snap.overview.stockAlerts.materialsNeedReorder > 0 ? 'alertWarn' : 'formulaNumber',
      },
      { v: 'Xem 09_Ton_Kho_Vat_Tu', s: 'textMuted' },
    ],
    [
      { v: 'Thực nhận', s: 'text' },
      {
        v: snap.overview.thisMonth.netPayout,
        f: `SUMIFS('07_Don_Ban'!$O$5:$O$${saleMaxRow},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$B$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$D$3)`,
        s: 'formulaCurrency',
      },
      null,
      null,
      { v: 'Số SKU CẦN ĐÚC / ĐÓNG THÊM', s: 'text' },
      {
        v: snap.overview.stockAlerts.skusNeedProduction,
        f: `COUNTIF('10_Ton_Kho_Thanh_Pham'!$I$5:$I$${invTpEndRow},"CẦN ĐÚC / ĐÓNG THÊM")`,
        s: snap.overview.stockAlerts.skusNeedProduction > 0 ? 'alertWarn' : 'formulaNumber',
      },
      { v: 'Xem 10_Ton_Kho_Thanh_Pham', s: 'textMuted' },
    ],
    [
      { v: 'Lãi gộp (thực nhận − giá vốn)', s: 'textBold' },
      {
        v: snap.overview.thisMonth.grossProfit,
        f: `SUMIFS('07_Don_Ban'!$S$5:$S$${saleMaxRow},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$B$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$D$3)`,
        s: 'formulaCurrency',
      },
      null,
      null,
      { v: 'Số mã ÂM KHO (ghi chép thiếu)', s: 'text' },
      {
        v: snap.overview.stockAlerts.negativeStockCodes,
        f: `COUNTIF('09_Ton_Kho_Vat_Tu'!$I$5:$I$${invVtEndRow},"<0")+COUNTIF('10_Ton_Kho_Thanh_Pham'!$G$5:$G$${invTpEndRow},"<0")`,
        s: snap.overview.stockAlerts.negativeStockCodes > 0 ? 'alertDanger' : 'formulaNumber',
      },
      { v: 'Thường do quên ghi nhập hàng hoặc tồn đầu kỳ sai', s: 'textMuted' },
    ],
    [
      { v: 'SL sản phẩm đã bán', s: 'text' },
      {
        v: snap.overview.thisMonth.soldUnits,
        f: `SUMIFS('07_Don_Ban'!$G$5:$G$${saleMaxRow},'07_Don_Ban'!$M$5:$M$${saleMaxRow},"Đã giao",'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$B$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$D$3)`,
        s: 'formulaNumber',
      },
      null,
      null,
      { v: 'Giá trị tồn vật tư', s: 'text' },
      {
        v: snap.overview.stockAlerts.materialStockValue,
        f: `'09_Ton_Kho_Vat_Tu'!$L$3`,
        s: 'formulaCurrency',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'SL đã sản xuất đạt', s: 'text' },
      {
        v: snap.overview.thisMonth.producedGoodUnits,
        f: `SUMIFS('06_San_Xuat'!$G$5:$G$${prodMaxRow},'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$B$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$D$3)`,
        s: 'formulaNumber',
      },
      null,
      null,
      { v: 'Giá trị tồn thành phẩm', s: 'text' },
      {
        v: snap.overview.stockAlerts.finishedStockValue,
        f: `'10_Ton_Kho_Thanh_Pham'!$J$3`,
        s: 'formulaCurrency',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Chi mua vật tư', s: 'text' },
      {
        v: snap.overview.thisMonth.materialPurchaseSpent,
        f: `SUMIFS('05_Nhap_Hang'!$H$5:$H$${purMaxRow},'05_Nhap_Hang'!$A$5:$A$${purMaxRow},">="&$B$3,'05_Nhap_Hang'!$A$5:$A$${purMaxRow},"<"&$D$3)`,
        s: 'formulaCurrency',
      },
      null,
      null,
      { v: 'Tồn đầu kỳ chưa kiểm kê (số mã)', s: 'text' },
      {
        v: snap.overview.stockAlerts.unverifiedOpeningCount,
        f: `COUNTIF('04_Ton_Dau_Ky'!$G$5:$G$${openEndRow},"Ước tính*")`,
        s: snap.overview.stockAlerts.unverifiedOpeningCount > 0 ? 'alertWarn' : 'formulaNumber',
      },
      { v: "Cân/đếm thực tế rồi đổi thành 'Đã kiểm kê'", s: 'textMuted' },
    ],
    [
      { v: 'Chi khác (OPEX, dụng cụ...)', s: 'text' },
      {
        v: snap.overview.thisMonth.otherExpenses,
        f: `SUMIFS('11_Thu_Chi_Khac'!$F$5:$F$${cashMaxRow},'11_Thu_Chi_Khac'!$B$5:$B$${cashMaxRow},"Chi",'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},">="&$B$3,'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},"<"&$D$3)`,
        s: 'formulaCurrency',
      },
    ],
    [
      { v: 'Kế hoạch: SL / tháng', s: 'textMuted' },
      { v: PLAN_MONTHLY_SL, f: `'12_Bao_Cao_Thang'!C10`, s: 'formulaNumber' },
    ],
    [
      { v: 'Kế hoạch: Lãi ròng / tháng', s: 'textMuted' },
      { v: PLAN_MONTHLY_NET_PROFIT, f: `'12_Bao_Cao_Thang'!C16`, s: 'formulaCurrency' },
    ],
    [],
    [],
    [
      { v: 'C. QUY TRÌNH GHI CHÉP', s: 'section' },
      { v: '', s: 'section' },
      { v: '', s: 'section' },
    ],
    [
      { v: 'Khi nào', s: 'header' },
      { v: 'Sheet', s: 'header' },
      { v: 'Việc cần làm', s: 'header' },
    ],
    [
      { v: 'Lần đầu', s: 'textBold' },
      { v: '04_Ton_Dau_Ky', s: 'textCenter' },
      { v: "Cân/đếm vật tư & thành phẩm đang có, sửa số ô vàng, đổi tình trạng 'Đã kiểm kê'.", s: 'text' },
    ],
    [
      { v: 'Khi mua hàng', s: 'textBold' },
      { v: '05_Nhap_Hang', s: 'textCenter' },
      { v: '1 dòng / mặt hàng, SL theo ĐVT chuẩn, thành tiền thực trả.', s: 'text' },
    ],
    [
      { v: 'Sau mỗi mẻ đúc / đóng gói', s: 'textBold' },
      { v: '06_San_Xuat', s: 'textCenter' },
      { v: 'SL đổ khuôn, SL đạt; cân thạch cao nếu được.', s: 'text' },
    ],
    [
      { v: 'Mỗi ngày (hoặc mỗi đơn)', s: 'textBold' },
      { v: '07_Don_Ban', s: 'textCenter' },
      { v: 'Shopee: lấy số thực nhận ở Seller Center. Cập nhật trạng thái khi giao xong / hoàn.', s: 'text' },
    ],
    [
      { v: 'Khi hư hỏng, tặng, kiểm kê lệch', s: 'textBold' },
      { v: '08_Dieu_Chinh_Kho', s: 'textCenter' },
      { v: 'SL âm = trừ kho.', s: 'text' },
    ],
    [
      { v: 'Khi trả điện, web, rút tiền...', s: 'textBold' },
      { v: '11_Thu_Chi_Khac', s: 'textCenter' },
      { v: "Cuối tháng ghi 'OPEX — Quỹ tái đầu tư khuôn'.", s: 'text' },
    ],
    [
      { v: 'Cuối tháng', s: 'textBold' },
      { v: '12_Bao_Cao_Thang', s: 'textCenter' },
      { v: 'Chọn tháng → xem thực tế vs kế hoạch; tỷ lệ phế phẩm & giá nhập mới đưa về file kế hoạch.', s: 'text' },
    ],
    [
      { v: 'Khi file kế hoạch đổi giá / mã', s: 'textBold' },
      { v: '01, 02, 03', s: 'textCenter' },
      { v: 'Dán lại giá trị từ file kế hoạch (hoặc nhờ trợ lý đồng bộ).', s: 'text' },
    ],
  ]

  // ---------------- 01_Vat_Tu ----------------
  const s01Rows: XlsxCellInput[][] = [
    [{ v: '01. DANH MỤC VẬT TƯ (COPY TỪ FILE KẾ HOẠCH 03_Vat_Tu)', s: 'title' }],
    [
      {
        v: "Cột A–F là bản copy giá trị từ file kế hoạch (không sửa tay ở đây). Cột H 'Điểm đặt hàng lại' là ô vàng anh/chị tự chỉnh.",
        s: 'subtitle',
      },
    ],
    [
      { v: 'Mã VT được cân thực tế khi đúc:', s: 'textBold' },
      null,
      { v: snap.meta.weighedMaterialCode, s: 'yellowCenter' },
      { v: '(thạch cao — nhập số gram cân thực ở 06_San_Xuat cột J để trừ kho đúng thực tế)', s: 'textMuted' },
    ],
    [
      { v: 'Mã VT', s: 'header' },
      { v: 'Nhóm VT', s: 'header' },
      { v: 'Tên vật tư', s: 'header' },
      { v: 'ĐVT chuẩn', s: 'headerCenter' },
      { v: 'Đơn giá chuẩn (đ/ĐVT)', s: 'headerRight' },
      { v: 'Trạng thái', s: 'header' },
      { v: 'Nhu cầu KH / tháng', s: 'headerRight' },
      { v: 'Điểm đặt hàng lại', s: 'headerRight' },
      { v: 'Ghi chú', s: 'header' },
    ],
    ...snap.materials.map((m): XlsxCellInput[] => [
      { v: m.code, s: 'textBold' },
      { v: m.group, s: 'text' },
      { v: m.name, s: 'text' },
      { v: m.unit, s: 'textCenter' },
      { v: m.standardUnitCost, s: 'decimal' },
      { v: m.status, s: 'text' },
      { v: m.monthlyPlanDemand, s: 'decimal' },
      { v: m.reorderPoint, s: 'yellowDecimal' },
      { v: m.note, s: 'textMuted' },
    ]),
  ]

  // ---------------- 02_SKU ----------------
  const s02Rows: XlsxCellInput[][] = [
    [{ v: '02. DANH MỤC SKU ĐANG BÁN & GIÁ CHUẨN (COPY TỪ FILE KẾ HOẠCH 09, 11, 12)', s: 'title' }],
    [
      {
        v: "Giá vốn chuẩn, giá bán chốt và sản lượng kế hoạch là bản copy giá trị. Cột N 'Tồn tối thiểu' là ô vàng — dưới mức này sheet 10 báo cần đúc/đóng thêm.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Mã SKU', s: 'header' },
      { v: 'Tên SKU', s: 'header' },
      { v: 'Nhóm DM', s: 'headerCenter' },
      { v: 'Nhóm định giá', s: 'headerCenter' },
      { v: 'Giá vốn chuẩn', s: 'headerRight' },
      { v: 'Shopee giá thực tế', s: 'headerRight' },
      { v: 'Shopee giá bán thường', s: 'headerRight' },
      { v: 'Giá lẻ Zalo/Web', s: 'headerRight' },
      { v: 'Giá sỉ B1', s: 'headerRight' },
      { v: 'Giá sỉ B2', s: 'headerRight' },
      { v: 'KH SL Shopee / tháng', s: 'headerRight' },
      { v: 'KH SL lẻ / tháng', s: 'headerRight' },
      { v: 'KH SL sỉ / tháng', s: 'headerRight' },
      { v: 'Tồn TP tối thiểu', s: 'headerRight' },
    ],
    ...snap.skus.map((s): XlsxCellInput[] => [
      { v: s.sku, s: 'textBold' },
      { v: s.name, s: 'text' },
      { v: s.categoryGroup, s: 'textCenter' },
      { v: s.pricingGroup, s: 'textCenter' },
      { v: s.standardCost, s: 'currency' },
      { v: s.shopeeActualPrice, s: 'currency' },
      { v: s.shopeeRegularPrice, s: 'currency' },
      { v: s.retailPrice, s: 'currency' },
      { v: s.wholesaleB1, s: 'currency' },
      { v: s.wholesaleB2, s: 'currency' },
      { v: s.planQtyShopee, s: 'number' },
      { v: s.planQtyRetail, s: 'number' },
      { v: s.planQtyWholesale, s: 'number' },
      { v: s.minFinishedStock, s: 'yellowNumber' },
    ]),
  ]

  // ---------------- 03_Dinh_Muc ----------------
  const s03Rows: XlsxCellInput[][] = [
    [{ v: '03. ĐỊNH MỨC CHUẨN / 1 SP (COPY TỪ FILE KẾ HOẠCH 08_BOM — ĐÃ NHÂN HỆ SỐ MẺ)', s: 'title' }],
    [
      {
        v: "Dùng để tự trừ kho: dòng 'NVL' trừ khi sản xuất (06), dòng 'Bao bì' trừ khi xuất bán (07). Không sửa tay — cập nhật bằng cách dán lại từ file kế hoạch.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Mã SKU', s: 'header' },
      { v: 'Loại', s: 'headerCenter' },
      { v: 'Mã VT', s: 'header' },
      { v: 'Định mức / 1 SP', s: 'headerRight' },
      { v: 'Tên vật tư (tự tra)', s: 'header' },
    ],
    ...snap.bom.map((b, idx): XlsxCellInput[] => {
      const r = 5 + idx
      return [
        { v: b.sku, s: 'textBold' },
        { v: b.kind, s: 'textCenter' },
        { v: b.materialCode, s: 'text' },
        { v: b.qtyPerUnit, s: 'decimal' },
        {
          v: b.materialName,
          f: `IF(C${r}="","",IFERROR(INDEX('01_Vat_Tu'!$C$5:$C$${matEndRow},MATCH(C${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""))`,
          s: 'formulaText',
        },
      ]
    }),
  ]

  // ---------------- 04_Ton_Dau_Ky ----------------
  const s04Rows: XlsxCellInput[][] = [
    [{ v: '04. TỒN ĐẦU KỲ (KIỂM KÊ LẦN ĐẦU)', s: 'title' }],
    [
      {
        v: "Số vàng hiện là ƯỚC TÍNH = lượng đã mua theo chứng từ, CHƯA trừ phần đã dùng thử. Hãy cân/đếm thực tế, sửa số, đổi tình trạng thành 'Đã kiểm kê'. Chỉ ghi giao dịch ở các sheet khác từ sau ngày kiểm kê.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Loại mã', s: 'headerCenter' },
      { v: 'Mã', s: 'header' },
      { v: 'Tên (tự tra)', s: 'header' },
      { v: 'ĐVT', s: 'headerCenter' },
      { v: 'SL tồn đầu kỳ', s: 'headerRight' },
      { v: 'Ngày kiểm kê', s: 'headerCenter' },
      { v: 'Tình trạng', s: 'header' },
      { v: 'Ghi chú', s: 'header' },
    ],
    ...snap.openingStocks.map((o, idx): XlsxCellInput[] => {
      const r = 5 + idx
      return [
        { v: o.kind, s: 'textCenter' },
        { v: o.code, s: 'textBold' },
        {
          v: o.name,
          f: `IF(B${r}="","",IF(A${r}="VT",IFERROR(INDEX('01_Vat_Tu'!$C$5:$C$${matEndRow},MATCH(B${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""),IFERROR(INDEX('02_SKU'!$B$5:$B$${skuEndRow},MATCH(B${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),"")))`,
          s: 'formulaText',
        },
        {
          v: o.unit,
          f: `IF(B${r}="","",IF(A${r}="VT",IFERROR(INDEX('01_Vat_Tu'!$D$5:$D$${matEndRow},MATCH(B${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""),"sp"))`,
          s: 'formulaCenter',
        },
        { v: o.openingQty, s: 'yellowDecimal' },
        { v: o.stocktakeDate, s: 'yellowDate', isDate: true },
        { v: o.status, s: 'yellowText' },
        { v: o.note, s: 'textMuted' },
      ]
    }),
  ]

  // ---------------- 05_Nhap_Hang ----------------
  const s05DataRows: XlsxCellInput[][] = []
  const totalPurRows = snap.purchases.length + purTemplateExtra
  for (let idx = 0; idx < totalPurRows; idx++) {
    const r = 5 + idx
    const p = snap.purchases[idx]
    s05DataRows.push([
      p ? { v: p.date, s: 'yellowDate', isDate: true } : { v: null, s: 'yellowDate' },
      { v: p?.docCode ?? '', s: 'yellowText' },
      { v: p?.supplier ?? '', s: 'yellowText' },
      { v: p?.materialCode ?? '', s: 'yellowText' },
      {
        v: p ? p.materialName : '',
        f: `IF(D${r}="","",IFERROR(INDEX('01_Vat_Tu'!$C$5:$C$${matEndRow},MATCH(D${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""))`,
        s: 'formulaText',
      },
      {
        v: p ? p.unit : '',
        f: `IF(D${r}="","",IFERROR(INDEX('01_Vat_Tu'!$D$5:$D$${matEndRow},MATCH(D${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""))`,
        s: 'formulaCenter',
      },
      p ? { v: p.qtyStandardUnit, s: 'yellowDecimal' } : { v: null, s: 'yellowDecimal' },
      p ? { v: p.actualTotalPaid, s: 'yellowCurrency' } : { v: null, s: 'yellowCurrency' },
      {
        v: p?.actualUnitCost ?? '',
        f: `IF(OR(D${r}="",G${r}="",G${r}=0),"",H${r}/G${r})`,
        s: 'formulaDecimal',
      },
      {
        v: p?.standardUnitCost ?? '',
        f: `IF(D${r}="","",IFERROR(INDEX('01_Vat_Tu'!$E$5:$E$${matEndRow},MATCH(D${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""))`,
        s: 'formulaDecimal',
      },
      {
        v: p?.variancePct ?? '',
        f: `IF(OR(I${r}="",J${r}="",J${r}=0),"",(I${r}-J${r})/J${r})`,
        s: 'formulaPercent',
      },
      { v: p?.note ?? '', s: 'yellowText' },
    ])
  }

  const s05Rows: XlsxCellInput[][] = [
    [{ v: '05. NHẬP HÀNG / MUA VẬT TƯ (MỖI DÒNG = 1 MẶT HÀNG)', s: 'title' }],
    [
      {
        v: 'Ghi SL theo ĐVT chuẩn (vd bao 25kg → 25000 g). Thành tiền = số thực trả sau voucher, gồm ship phân bổ. Đơn giá thực lệch >10% so với chuẩn → cập nhật lại file kế hoạch 03_Vat_Tu.',
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Ngày', s: 'headerCenter' },
      { v: 'Mã đơn / chứng từ', s: 'header' },
      { v: 'Nhà cung cấp', s: 'header' },
      { v: 'Mã VT', s: 'header' },
      { v: 'Tên VT (tự tra)', s: 'header' },
      { v: 'ĐVT', s: 'headerCenter' },
      { v: 'SL (ĐVT chuẩn)', s: 'headerRight' },
      { v: 'Thành tiền thực trả', s: 'headerRight' },
      { v: 'Đơn giá thực / ĐVT', s: 'headerRight' },
      { v: 'Đơn giá chuẩn', s: 'headerRight' },
      { v: 'Lệch so với chuẩn', s: 'headerRight' },
      { v: 'Ghi chú (quy cách mua...)', s: 'header' },
    ],
    ...s05DataRows,
  ]

  // ---------------- 06_San_Xuat ----------------
  const s06DataRows: XlsxCellInput[][] = []
  const totalProdRows = snap.productions.length + prodTemplateExtra
  for (let idx = 0; idx < totalProdRows; idx++) {
    const r = 5 + idx
    const pr = snap.productions[idx]
    s06DataRows.push([
      pr ? { v: pr.date, s: 'yellowDate', isDate: true } : { v: null, s: 'yellowDate' },
      { v: pr?.batchCode ?? '', s: 'yellowText' },
      { v: pr?.batchType ?? '', s: 'yellowCenter' },
      { v: pr?.sku ?? '', s: 'yellowText' },
      {
        v: pr ? pr.skuName : '',
        f: `IF(D${r}="","",IFERROR(INDEX('02_SKU'!$B$5:$B$${skuEndRow},MATCH(D${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),""))`,
        s: 'formulaText',
      },
      pr ? { v: pr.qtyStarted, s: 'yellowNumber' } : { v: null, s: 'yellowNumber' },
      pr ? { v: pr.qtyGood, s: 'yellowNumber' } : { v: null, s: 'yellowNumber' },
      {
        v: pr ? pr.defectQty : '',
        f: `IF(F${r}="","",F${r}-N(G${r}))`,
        s: 'formulaNumber',
      },
      {
        v: pr?.defectPct ?? '',
        f: `IF(OR(F${r}="",F${r}=0),"",H${r}/F${r})`,
        s: 'formulaPercent',
      },
      pr && pr.actualPlasterGrams !== null
        ? { v: pr.actualPlasterGrams, s: 'yellowDecimal' }
        : { v: null, s: 'yellowDecimal' },
      {
        v: pr ? pr.standardPlasterGrams : '',
        f: `IF(OR(D${r}="",F${r}=""),"",F${r}*SUMIFS('03_Dinh_Muc'!$D$5:$D$${bomEndRow},'03_Dinh_Muc'!$A$5:$A$${bomEndRow},D${r},'03_Dinh_Muc'!$B$5:$B$${bomEndRow},"NVL",'03_Dinh_Muc'!$C$5:$C$${bomEndRow},'01_Vat_Tu'!$C$3))`,
        s: 'formulaDecimal',
      },
      {
        v: pr ? pr.deductedPlasterGrams : '',
        f: `IF(D${r}="","",IF(AND(ISNUMBER(J${r}),J${r}>0),J${r},N(K${r})))`,
        s: 'formulaDecimal',
      },
      {
        v: pr && pr.plasterVarianceGrams !== null ? pr.plasterVarianceGrams : '',
        f: `IF(AND(ISNUMBER(J${r}),J${r}>0),J${r}-N(K${r}),"")`,
        s: 'formulaDecimal',
      },
      pr && pr.actualMinutes !== null
        ? { v: pr.actualMinutes, s: 'yellowNumber' }
        : { v: null, s: 'yellowNumber' },
      { v: pr?.operator ?? '', s: 'yellowText' },
      { v: pr?.note ?? '', s: 'yellowText' },
    ])
  }

  const s06Rows: XlsxCellInput[][] = [
    [{ v: '06. NHẬT KÝ SẢN XUẤT — MẺ ĐÚC & CHIẾT / ĐÓNG GÓI', s: 'title' }],
    [
      {
        v: "Mỗi dòng = 1 mẻ của 1 SKU. 'SL làm' = số đổ khuôn (gồm cả hỏng) → trừ NVL theo định mức; 'SL đạt' → cộng kho thành phẩm. Cân thạch cao thực (cột J) để biết hao hụt thật; bỏ trống thì trừ theo định mức.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Ngày', s: 'headerCenter' },
      { v: 'Mã mẻ', s: 'header' },
      { v: 'Loại', s: 'headerCenter' },
      { v: 'Mã SKU', s: 'header' },
      { v: 'Tên SKU (tự tra)', s: 'header' },
      { v: 'SL làm (đổ khuôn / đóng)', s: 'headerRight' },
      { v: 'SL đạt', s: 'headerRight' },
      { v: 'SL lỗi / phế', s: 'headerRight' },
      { v: '% lỗi', s: 'headerRight' },
      { v: 'Thạch cao cân thực (g)', s: 'headerRight' },
      { v: 'Thạch cao theo định mức (g)', s: 'headerRight' },
      { v: 'Thạch cao trừ kho (g)', s: 'headerRight' },
      { v: 'Chênh thạch cao vs định mức', s: 'headerRight' },
      { v: 'Phút làm thực tế', s: 'headerRight' },
      { v: 'Người làm', s: 'header' },
      { v: 'Ghi chú lỗi / cải tiến', s: 'header' },
    ],
    ...s06DataRows,
  ]

  // ---------------- 07_Don_Ban ----------------
  const s07DataRows: XlsxCellInput[][] = []
  const totalSaleRows = snap.salesOrders.length + saleTemplateExtra
  for (let idx = 0; idx < totalSaleRows; idx++) {
    const r = 5 + idx
    const so = snap.salesOrders[idx]
    s07DataRows.push([
      so ? { v: so.date, s: 'yellowDate', isDate: true } : { v: null, s: 'yellowDate' },
      { v: so?.orderCode ?? '', s: 'yellowText' },
      { v: so?.channel ?? '', s: 'yellowText' },
      { v: so?.customer ?? '', s: 'yellowText' },
      { v: so?.sku ?? '', s: 'yellowText' },
      {
        v: so ? so.skuName : '',
        f: `IF(E${r}="","",IFERROR(INDEX('02_SKU'!$B$5:$B$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),""))`,
        s: 'formulaText',
      },
      so ? { v: so.qty, s: 'yellowNumber' } : { v: null, s: 'yellowNumber' },
      so ? { v: so.actualUnitPrice, s: 'yellowCurrency' } : { v: null, s: 'yellowCurrency' },
      {
        v: so ? so.grossAmount : '',
        f: `IF(OR(E${r}="",G${r}=""),"",G${r}*N(H${r}))`,
        s: 'formulaCurrency',
      },
      so ? { v: so.platformAndVoucherFee, s: 'yellowCurrency' } : { v: null, s: 'yellowCurrency' },
      so ? { v: so.sellerShippingPaid, s: 'yellowCurrency' } : { v: null, s: 'yellowCurrency' },
      {
        v: so ? so.netPayout : '',
        f: `IF(I${r}="","",I${r}-N(J${r})-N(K${r}))`,
        s: 'formulaCurrency',
      },
      { v: so?.status ?? '', s: 'yellowCenter' },
      {
        v: so ? so.recognizedRevenue : 0,
        f: `IF(M${r}="Đã giao",N(I${r}),0)`,
        s: 'formulaCurrency',
      },
      {
        v: so ? so.recognizedNetPayout : 0,
        f: `IF(M${r}="Đã giao",N(L${r}),IF(OR(M${r}="Hoàn nhập kho",M${r}="Hoàn hỏng"),-N(J${r})-N(K${r}),0))`,
        s: 'formulaCurrency',
      },
      {
        v: so ? so.stockOutQty : 0,
        f: `IF(OR(M${r}="Đã giao",M${r}="Đang giao",M${r}="Hoàn hỏng"),N(G${r}),0)`,
        s: 'formulaNumber',
      },
      {
        v: so ? so.packagingOutQty : 0,
        f: `IF(OR(M${r}="Đã giao",M${r}="Đang giao",M${r}="Hoàn nhập kho",M${r}="Hoàn hỏng"),N(G${r}),0)`,
        s: 'formulaNumber',
      },
      {
        v: so ? so.standardCogs : 0,
        f: `IF(OR(M${r}="Đã giao",M${r}="Hoàn hỏng"),N(G${r})*IFERROR(INDEX('02_SKU'!$E$5:$E$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),0),0)`,
        s: 'formulaCurrency',
      },
      {
        v: so ? so.grossProfit : 0,
        f: `O${r}-R${r}`,
        s: 'formulaCurrency',
      },
      {
        v: so ? so.channelStandardPrice : '',
        f: `IF(E${r}="","",IF(C${r}="Shopee",IFERROR(INDEX('02_SKU'!$F$5:$F$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),0),IF(C${r}="Sỉ",IF(IFERROR(INDEX('02_SKU'!$C$5:$C$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),"A")="B",IFERROR(INDEX('02_SKU'!$H$5:$H$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),0),IFERROR(INDEX('02_SKU'!$I$5:$I$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),0)),IFERROR(INDEX('02_SKU'!$H$5:$H$${skuEndRow},MATCH(E${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),0))))`,
        s: 'formulaCurrency',
      },
      { v: so?.note ?? '', s: 'yellowText' },
    ])
  }

  const s07Rows: XlsxCellInput[][] = [
    [{ v: '07. ĐƠN BÁN HÀNG (MỖI DÒNG = 1 SKU TRONG ĐƠN)', s: 'title' }],
    [
      {
        v: "Shopee: lấy 'Số tiền thực nhận' trong Seller Center; Phí = Thành tiền − Thực nhận (nhập ở 1 dòng của đơn). Có thể ghi gộp theo ngày (mã đơn SHP-ddmm). Lẻ/Sỉ: phí = phí COD + phần ship shop trả.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Ngày', s: 'headerCenter' },
      { v: 'Mã đơn', s: 'header' },
      { v: 'Kênh', s: 'header' },
      { v: 'Khách hàng', s: 'header' },
      { v: 'Mã SKU', s: 'header' },
      { v: 'Tên SKU (tự tra)', s: 'header' },
      { v: 'SL', s: 'headerRight' },
      { v: 'Đơn giá bán thực', s: 'headerRight' },
      { v: 'Thành tiền', s: 'headerRight' },
      { v: 'Phí sàn / COD / voucher shop', s: 'headerRight' },
      { v: 'Ship shop trả', s: 'headerRight' },
      { v: 'Thực nhận', s: 'headerRight' },
      { v: 'Trạng thái', s: 'headerCenter' },
      { v: 'Doanh thu ghi nhận', s: 'headerRight' },
      { v: 'Thực nhận ghi nhận', s: 'headerRight' },
      { v: 'SL xuất kho TP', s: 'headerRight' },
      { v: 'SL trừ bao bì', s: 'headerRight' },
      { v: 'Giá vốn chuẩn', s: 'headerRight' },
      { v: 'Lãi gộp', s: 'headerRight' },
      { v: 'Giá chuẩn kênh', s: 'headerRight' },
      { v: 'Ghi chú', s: 'header' },
    ],
    ...s07DataRows,
  ]

  // ---------------- 08_Dieu_Chinh_Kho ----------------
  const s08DataRows: XlsxCellInput[][] = []
  const totalAdjRows = snap.adjustments.length + adjTemplateExtra
  for (let idx = 0; idx < totalAdjRows; idx++) {
    const r = 5 + idx
    const ad = snap.adjustments[idx]
    s08DataRows.push([
      ad ? { v: ad.date, s: 'yellowDate', isDate: true } : { v: null, s: 'yellowDate' },
      { v: ad?.kind ?? '', s: 'yellowCenter' },
      { v: ad?.code ?? '', s: 'yellowText' },
      {
        v: ad ? ad.name : '',
        f: `IF(C${r}="","",IF(B${r}="VT",IFERROR(INDEX('01_Vat_Tu'!$C$5:$C$${matEndRow},MATCH(C${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),""),IFERROR(INDEX('02_SKU'!$B$5:$B$${skuEndRow},MATCH(C${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),"")))`,
        s: 'formulaText',
      },
      ad ? { v: ad.deltaQty, s: 'yellowDecimal' } : { v: null, s: 'yellowDecimal' },
      { v: ad?.reason ?? '', s: 'yellowText' },
      { v: ad?.note ?? '', s: 'yellowText' },
    ])
  }

  const s08Rows: XlsxCellInput[][] = [
    [{ v: '08. ĐIỀU CHỈNH KHO (HƯ HỎNG, DÙNG THỬ, QUÀ TẶNG, CHÊNH KIỂM KÊ...)', s: 'title' }],
    [
      {
        v: 'SL dương = cộng kho, âm = trừ kho. Dùng khi đóng đơn sỉ khác định mức, làm mẫu thử, tặng KOC, hoặc khi kiểm kê thấy chênh.',
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Ngày', s: 'headerCenter' },
      { v: 'Loại mã', s: 'headerCenter' },
      { v: 'Mã', s: 'header' },
      { v: 'Tên (tự tra)', s: 'header' },
      { v: 'SL (+/−)', s: 'headerRight' },
      { v: 'Lý do', s: 'header' },
      { v: 'Ghi chú', s: 'header' },
    ],
    ...s08DataRows,
  ]

  // ---------------- 09_Ton_Kho_Vat_Tu ----------------
  const s09Rows: XlsxCellInput[][] = [
    [{ v: '09. TỒN KHO VẬT TƯ (TỰ TÍNH — KHÔNG NHẬP)', s: 'title' }],
    [
      {
        v: 'Tồn = Đầu kỳ (04) + Nhập (05) − Xuất sản xuất theo định mức NVL (06) − Xuất bao bì theo đơn bán (07) ± Điều chỉnh (08). Thạch cao trừ theo số cân thực nếu có.',
        s: 'subtitle',
      },
    ],
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { v: 'Tổng giá trị tồn:', s: 'totalLabel' },
      {
        v: snap.overview.stockAlerts.materialStockValue,
        f: `SUM(L5:L${invVtEndRow})`,
        s: 'totalCurrency',
      },
    ],
    [
      { v: 'Mã VT', s: 'header' },
      { v: 'Tên vật tư', s: 'header' },
      { v: 'ĐVT', s: 'headerCenter' },
      { v: 'Tồn đầu kỳ', s: 'headerRight' },
      { v: 'Nhập', s: 'headerRight' },
      { v: 'Xuất sản xuất', s: 'headerRight' },
      { v: 'Xuất bao bì (bán)', s: 'headerRight' },
      { v: 'Điều chỉnh', s: 'headerRight' },
      { v: 'TỒN HIỆN TẠI', s: 'headerRight' },
      { v: 'Điểm đặt hàng lại', s: 'headerRight' },
      { v: 'Cảnh báo', s: 'headerCenter' },
      { v: 'Giá trị tồn (đ)', s: 'headerRight' },
    ],
    ...snap.materialInventory.map((m, idx): XlsxCellInput[] => {
      const r = 5 + idx
      const alertStyle: XlsxStyleKey =
        m.alert === 'ÂM KHO'
          ? 'alertDanger'
          : m.alert === 'CẦN ĐẶT HÀNG'
            ? 'alertWarn'
            : m.alert === 'OK'
              ? 'alertOk'
              : 'formulaCenter'
      return [
        { v: m.code, s: 'textBold' },
        {
          v: m.name,
          f: `IFERROR(INDEX('01_Vat_Tu'!$C$5:$C$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),"")`,
          s: 'formulaText',
        },
        {
          v: m.unit,
          f: `IFERROR(INDEX('01_Vat_Tu'!$D$5:$D$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)),"")`,
          s: 'formulaCenter',
        },
        {
          v: m.openingQty,
          f: `SUMIFS('04_Ton_Dau_Ky'!$E$5:$E$${openEndRow},'04_Ton_Dau_Ky'!$A$5:$A$${openEndRow},"VT",'04_Ton_Dau_Ky'!$B$5:$B$${openEndRow},A${r})`,
          s: 'formulaDecimal',
        },
        {
          v: m.purchasedQty,
          f: `SUMIFS('05_Nhap_Hang'!$G$5:$G$${purMaxRow},'05_Nhap_Hang'!$D$5:$D$${purMaxRow},A${r})`,
          s: 'formulaDecimal',
        },
        {
          v: m.productionUsedQty,
          f: `IF(A${r}='01_Vat_Tu'!$C$3,SUM('06_San_Xuat'!$L$5:$L$${prodMaxRow}),SUMPRODUCT(('03_Dinh_Muc'!$B$5:$B$${bomEndRow}="NVL")*('03_Dinh_Muc'!$C$5:$C$${bomEndRow}=A${r})*'03_Dinh_Muc'!$D$5:$D$${bomEndRow}*SUMIFS('06_San_Xuat'!$F$5:$F$${prodMaxRow},'06_San_Xuat'!$D$5:$D$${prodMaxRow},'03_Dinh_Muc'!$A$5:$A$${bomEndRow})))`,
          s: 'formulaDecimal',
        },
        {
          v: m.packagingSoldQty,
          f: `SUMPRODUCT(('03_Dinh_Muc'!$B$5:$B$${bomEndRow}="Bao bì")*('03_Dinh_Muc'!$C$5:$C$${bomEndRow}=A${r})*'03_Dinh_Muc'!$D$5:$D$${bomEndRow}*SUMIFS('07_Don_Ban'!$Q$5:$Q$${saleMaxRow},'07_Don_Ban'!$E$5:$E$${saleMaxRow},'03_Dinh_Muc'!$A$5:$A$${bomEndRow}))`,
          s: 'formulaDecimal',
        },
        {
          v: m.adjustedQty,
          f: `SUMIFS('08_Dieu_Chinh_Kho'!$E$5:$E$${adjMaxRow},'08_Dieu_Chinh_Kho'!$B$5:$B$${adjMaxRow},"VT",'08_Dieu_Chinh_Kho'!$C$5:$C$${adjMaxRow},A${r})`,
          s: 'formulaDecimal',
        },
        {
          v: m.currentQty,
          f: `D${r}+E${r}-F${r}-G${r}+H${r}`,
          s: 'formulaDecimal',
        },
        {
          v: m.reorderPoint ?? '',
          f: `IF(INDEX('01_Vat_Tu'!$H$5:$H$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0))="","",INDEX('01_Vat_Tu'!$H$5:$H$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0)))`,
          s: 'formulaDecimal',
        },
        {
          v: m.alert,
          f: `IF(I${r}<0,"ÂM KHO",IF(INDEX('01_Vat_Tu'!$F$5:$F$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0))="Đang dùng",IF(AND(ISNUMBER(J${r}),J${r}>0,I${r}<=J${r}),"CẦN ĐẶT HÀNG","OK"),""))`,
          s: alertStyle,
        },
        {
          v: m.stockValue,
          f: `ROUND(MAX(0,I${r})*N(INDEX('01_Vat_Tu'!$E$5:$E$${matEndRow},MATCH(A${r},'01_Vat_Tu'!$A$5:$A$${matEndRow},0))),0)`,
          s: 'formulaCurrency',
        },
      ]
    }),
  ]

  // ---------------- 10_Ton_Kho_Thanh_Pham ----------------
  const s10Rows: XlsxCellInput[][] = [
    [{ v: '10. TỒN KHO THÀNH PHẨM (TỰ TÍNH — KHÔNG NHẬP)', s: 'title' }],
    [
      {
        v: 'Tồn = Đầu kỳ (04) + SL đạt (06) − SL xuất bán (07: đã giao, đang giao, hoàn hỏng) ± Điều chỉnh (08). Hoàn nhập lại kho thì không trừ.',
        s: 'subtitle',
      },
    ],
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { v: 'Tổng giá trị tồn:', s: 'totalLabel' },
      {
        v: snap.overview.stockAlerts.finishedStockValue,
        f: `SUM(J5:J${invTpEndRow})`,
        s: 'totalCurrency',
      },
    ],
    [
      { v: 'Mã SKU', s: 'header' },
      { v: 'Tên SKU', s: 'header' },
      { v: 'Tồn đầu kỳ', s: 'headerRight' },
      { v: 'Sản xuất đạt', s: 'headerRight' },
      { v: 'Xuất bán', s: 'headerRight' },
      { v: 'Điều chỉnh', s: 'headerRight' },
      { v: 'TỒN HIỆN TẠI', s: 'headerRight' },
      { v: 'Tồn tối thiểu', s: 'headerRight' },
      { v: 'Cảnh báo', s: 'headerCenter' },
      { v: 'Giá trị tồn (giá vốn)', s: 'headerRight' },
      { v: 'Bán 30 ngày gần nhất', s: 'headerRight' },
    ],
    ...snap.finishedInventory.map((fItem, idx): XlsxCellInput[] => {
      const r = 5 + idx
      const alertStyle: XlsxStyleKey =
        fItem.alert === 'ÂM KHO'
          ? 'alertDanger'
          : fItem.alert === 'CẦN ĐÚC / ĐÓNG THÊM'
            ? 'alertWarn'
            : fItem.alert === 'OK'
              ? 'alertOk'
              : 'formulaCenter'
      return [
        { v: fItem.sku, s: 'textBold' },
        {
          v: fItem.name,
          f: `IFERROR(INDEX('02_SKU'!$B$5:$B$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)),"")`,
          s: 'formulaText',
        },
        {
          v: fItem.openingQty,
          f: `SUMIFS('04_Ton_Dau_Ky'!$E$5:$E$${openEndRow},'04_Ton_Dau_Ky'!$A$5:$A$${openEndRow},"TP",'04_Ton_Dau_Ky'!$B$5:$B$${openEndRow},A${r})`,
          s: 'formulaNumber',
        },
        {
          v: fItem.producedGoodQty,
          f: `SUMIFS('06_San_Xuat'!$G$5:$G$${prodMaxRow},'06_San_Xuat'!$D$5:$D$${prodMaxRow},A${r})`,
          s: 'formulaNumber',
        },
        {
          v: fItem.soldOutQty,
          f: `SUMIFS('07_Don_Ban'!$P$5:$P$${saleMaxRow},'07_Don_Ban'!$E$5:$E$${saleMaxRow},A${r})`,
          s: 'formulaNumber',
        },
        {
          v: fItem.adjustedQty,
          f: `SUMIFS('08_Dieu_Chinh_Kho'!$E$5:$E$${adjMaxRow},'08_Dieu_Chinh_Kho'!$B$5:$B$${adjMaxRow},"TP",'08_Dieu_Chinh_Kho'!$C$5:$C$${adjMaxRow},A${r})`,
          s: 'formulaNumber',
        },
        {
          v: fItem.currentQty,
          f: `C${r}+D${r}-E${r}+F${r}`,
          s: 'formulaNumber',
        },
        {
          v: fItem.minStock,
          f: `N(INDEX('02_SKU'!$N$5:$N$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))`,
          s: 'formulaNumber',
        },
        {
          v: fItem.alert,
          f: `IF(G${r}<0,"ÂM KHO",IF(AND(H${r}>0,G${r}<H${r}),"CẦN ĐÚC / ĐÓNG THÊM",IF(OR(H${r}>0,G${r}>0),"OK","")))`,
          s: alertStyle,
        },
        {
          v: fItem.stockValue,
          f: `ROUND(MAX(0,G${r})*N(INDEX('02_SKU'!$E$5:$E$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))),0)`,
          s: 'formulaCurrency',
        },
        {
          v: fItem.soldLast30Days,
          f: `SUMIFS('07_Don_Ban'!$P$5:$P$${saleMaxRow},'07_Don_Ban'!$E$5:$E$${saleMaxRow},A${r},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&(TODAY()-30))`,
          s: 'formulaNumber',
        },
      ]
    }),
  ]

  // ---------------- 11_Thu_Chi_Khac ----------------
  const s11DataRows: XlsxCellInput[][] = []
  const totalCashRows = snap.otherCashflows.length + cashTemplateExtra
  for (let idx = 0; idx < totalCashRows; idx++) {
    const cf = snap.otherCashflows[idx]
    s11DataRows.push([
      cf ? { v: cf.date, s: 'yellowDate', isDate: true } : { v: null, s: 'yellowDate' },
      { v: cf?.flowType ?? '', s: 'yellowCenter' },
      { v: cf?.group ?? '', s: 'yellowText' },
      { v: cf?.planCostCode ?? '', s: 'yellowText' },
      { v: cf?.description ?? '', s: 'yellowText' },
      cf ? { v: cf.amount, s: 'yellowCurrency' } : { v: null, s: 'yellowCurrency' },
      { v: cf?.note ?? '', s: 'yellowText' },
    ])
  }

  const s11Rows: XlsxCellInput[][] = [
    [{ v: '11. THU / CHI KHÁC (OPEX THỰC TẾ, MUA DỤNG CỤ, RÚT TIỀN...)', s: 'title' }],
    [
      {
        v: "Tiền bán hàng (07) và tiền mua vật tư (05) đã tự tính — KHÔNG ghi lại ở đây. Mỗi tháng nhớ ghi dòng 'OPEX — Quỹ tái đầu tư khuôn' (180.000đ, chuyển sang tiết kiệm) để so đúng với kế hoạch.",
        s: 'subtitle',
      },
    ],
    [],
    [
      { v: 'Ngày', s: 'headerCenter' },
      { v: 'Thu / Chi', s: 'headerCenter' },
      { v: 'Nhóm', s: 'header' },
      { v: 'Mã CP kế hoạch', s: 'header' },
      { v: 'Diễn giải', s: 'header' },
      { v: 'Số tiền', s: 'headerRight' },
      { v: 'Ghi chú', s: 'header' },
    ],
    ...s11DataRows,
  ]

  // ---------------- 12_Bao_Cao_Thang ----------------
  const rep = snap.monthlyReport
  const s12ChannelRows: XlsxCellInput[][] = rep.byChannel.map((ch, idx) => {
    const r = 7 + idx
    return [
      { v: ch.channel, s: 'textBold' },
      {
        v: ch.actualQty,
        f: `SUMIFS('07_Don_Ban'!$G$5:$G$${saleMaxRow},'07_Don_Ban'!$C$5:$C$${saleMaxRow},A${r},'07_Don_Ban'!$M$5:$M$${saleMaxRow},"Đã giao",'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      { v: ch.planQty, s: 'number' },
      {
        v: ch.qtyAchievementPct ?? '',
        f: `IF(C${r}=0,"",B${r}/C${r})`,
        s: 'formulaPercent',
      },
      {
        v: ch.actualRevenue,
        f: `SUMIFS('07_Don_Ban'!$N$5:$N$${saleMaxRow},'07_Don_Ban'!$C$5:$C$${saleMaxRow},A${r},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
      { v: ch.planRevenue, s: 'currency' },
      {
        v: ch.actualNetPayout,
        f: `SUMIFS('07_Don_Ban'!$O$5:$O$${saleMaxRow},'07_Don_Ban'!$C$5:$C$${saleMaxRow},A${r},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
      {
        v: ch.standardCogs,
        f: `SUMIFS('07_Don_Ban'!$R$5:$R$${saleMaxRow},'07_Don_Ban'!$C$5:$C$${saleMaxRow},A${r},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
      {
        v: ch.actualGrossProfit,
        f: `G${r}-H${r}`,
        s: 'formulaCurrency',
      },
      { v: ch.planContributionProfit, s: 'currency' },
    ]
  })

  const s12SkuRows: XlsxCellInput[][] = rep.bySku.map((sk, idx) => {
    const r = 40 + idx
    return [
      { v: sk.sku, s: 'textBold' },
      {
        v: sk.actualSoldQty,
        f: `SUMIFS('07_Don_Ban'!$G$5:$G$${saleMaxRow},'07_Don_Ban'!$E$5:$E$${saleMaxRow},A${r},'07_Don_Ban'!$M$5:$M$${saleMaxRow},"Đã giao",'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      {
        v: sk.planMonthlyQty,
        f: `N(INDEX('02_SKU'!$K$5:$K$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))+N(INDEX('02_SKU'!$L$5:$L$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))+N(INDEX('02_SKU'!$M$5:$M$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))`,
        s: 'formulaNumber',
      },
      {
        v: sk.achievementPct ?? '',
        f: `IF(C${r}=0,"",B${r}/C${r})`,
        s: 'formulaPercent',
      },
      {
        v: sk.actualAvgPrice ?? '',
        f: `IF(B${r}=0,"",ROUND(SUMIFS('07_Don_Ban'!$N$5:$N$${saleMaxRow},'07_Don_Ban'!$E$5:$E$${saleMaxRow},A${r},'07_Don_Ban'!$A$5:$A$${saleMaxRow},">="&$C$3,'07_Don_Ban'!$A$5:$A$${saleMaxRow},"<"&$E$3)/B${r},0))`,
        s: 'formulaCurrency',
      },
      {
        v: sk.standardAvgPrice ?? '',
        f: `IF(C${r}>0,ROUND((N(INDEX('02_SKU'!$F$5:$F$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))*N(INDEX('02_SKU'!$K$5:$K$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))+N(INDEX('02_SKU'!$H$5:$H$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))*N(INDEX('02_SKU'!$L$5:$L$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))+IF(INDEX('02_SKU'!$C$5:$C$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))="B",N(INDEX('02_SKU'!$H$5:$H$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))),N(INDEX('02_SKU'!$I$5:$I$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))))*N(INDEX('02_SKU'!$M$5:$M$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))))/C${r},0),IF(N(INDEX('02_SKU'!$F$5:$F$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))>0,N(INDEX('02_SKU'!$F$5:$F$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0))),N(INDEX('02_SKU'!$H$5:$H$${skuEndRow},MATCH(A${r},'02_SKU'!$A$5:$A$${skuEndRow},0)))))`,
        s: 'formulaCurrency',
      },
      {
        v: sk.priceVariance ?? '',
        f: `IF(OR(E${r}="",F${r}=""),"",E${r}-F${r})`,
        s: 'formulaCurrency',
      },
      {
        v: sk.qtyStarted,
        f: `SUMIFS('06_San_Xuat'!$F$5:$F$${prodMaxRow},'06_San_Xuat'!$D$5:$D$${prodMaxRow},A${r},'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      {
        v: sk.qtyGood,
        f: `SUMIFS('06_San_Xuat'!$G$5:$G$${prodMaxRow},'06_San_Xuat'!$D$5:$D$${prodMaxRow},A${r},'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      {
        v: sk.defectPct ?? '',
        f: `IF(H${r}=0,"",(H${r}-I${r})/H${r})`,
        s: 'formulaPercent',
      },
    ]
  })

  const s12Rows: XlsxCellInput[][] = [
    [{ v: '12. BÁO CÁO THÁNG — THỰC TẾ SO VỚI KẾ HOẠCH', s: 'title' }],
    [
      {
        v: 'Chọn tháng ở ô vàng C3 (nhập ngày 1 của tháng). Số kế hoạch là bản copy từ file kế hoạch tại thời điểm dựng file.',
        s: 'subtitle',
      },
    ],
    [
      { v: 'Tháng báo cáo (ngày 1):', s: 'textBold' },
      null,
      { v: snap.meta.reportMonth, s: 'yellowDate', isDate: true },
      { v: '→ đến trước ngày:', s: 'textMuted' },
      {
        v: snap.meta.reportMonthNext,
        f: 'EDATE(C3,1)',
        s: 'formulaDate',
        isDate: true,
      },
    ],
    [],
    [{ v: 'A. BÁN HÀNG THEO KÊNH', s: 'section' }],
    [
      { v: 'Kênh', s: 'header' },
      { v: 'SL bán thực', s: 'headerRight' },
      { v: 'SL kế hoạch', s: 'headerRight' },
      { v: '% đạt SL', s: 'headerRight' },
      { v: 'Doanh thu thực', s: 'headerRight' },
      { v: 'Doanh thu KH', s: 'headerRight' },
      { v: 'Thực nhận', s: 'headerRight' },
      { v: 'Giá vốn chuẩn', s: 'headerRight' },
      { v: 'Lãi gộp thực', s: 'headerRight' },
      { v: 'Lãi đóng góp KH', s: 'headerRight' },
    ],
    ...s12ChannelRows,
    [
      { v: 'TỔNG', s: 'totalLabel' },
      { v: rep.channelTotal.actualQty, f: 'SUM(B7:B9)', s: 'totalNumber' },
      { v: rep.channelTotal.planQty, f: 'SUM(C7:C9)', s: 'totalNumber' },
      { v: rep.channelTotal.qtyAchievementPct ?? '', f: 'IF(C10=0,"",B10/C10)', s: 'totalPercent' },
      { v: rep.channelTotal.actualRevenue, f: 'SUM(E7:E9)', s: 'totalCurrency' },
      { v: rep.channelTotal.planRevenue, f: 'SUM(F7:F9)', s: 'totalCurrency' },
      { v: rep.channelTotal.actualNetPayout, f: 'SUM(G7:G9)', s: 'totalCurrency' },
      { v: rep.channelTotal.standardCogs, f: 'SUM(H7:H9)', s: 'totalCurrency' },
      { v: rep.channelTotal.actualGrossProfit, f: 'SUM(I7:I9)', s: 'totalCurrency' },
      { v: rep.channelTotal.planContributionProfit, f: 'SUM(J7:J9)', s: 'totalCurrency' },
    ],
    [],
    [{ v: 'B. LÃI / LỖ THỰC TẾ THÁNG', s: 'section' }],
    [
      { v: 'Chỉ tiêu', s: 'header' },
      { v: 'Thực tế', s: 'headerRight' },
      { v: 'Kế hoạch', s: 'headerRight' },
      { v: 'Chênh lệch', s: 'headerRight' },
    ],
    [
      { v: 'Lãi gộp (thực nhận − giá vốn chuẩn)', s: 'text' },
      { v: rep.pnl.actualGrossProfit, f: 'I10', s: 'formulaCurrency' },
      { v: rep.pnl.planGrossProfit, f: 'J10', s: 'formulaCurrency' },
      { v: rep.pnl.actualGrossProfit - rep.pnl.planGrossProfit, f: 'B14-C14', s: 'formulaCurrency' },
    ],
    [
      { v: "(−) OPEX thực (11: nhóm 'OPEX — ...')", s: 'text' },
      {
        v: rep.pnl.actualOpex,
        f: `-SUMIFS('11_Thu_Chi_Khac'!$F$5:$F$${cashMaxRow},'11_Thu_Chi_Khac'!$B$5:$B$${cashMaxRow},"Chi",'11_Thu_Chi_Khac'!$C$5:$C$${cashMaxRow},"OPEX*",'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},">="&$C$3,'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
      { v: rep.pnl.planOpex, s: 'currency' },
      { v: rep.pnl.actualOpex - rep.pnl.planOpex, f: 'B15-C15', s: 'formulaCurrency' },
    ],
    [
      { v: '➜ LÃI RÒNG THÁNG', s: 'totalLabel' },
      { v: rep.pnl.actualNetProfit, f: 'B14+B15', s: 'totalCurrency' },
      { v: rep.pnl.planNetProfit, f: 'C14+C15', s: 'totalCurrency' },
      { v: rep.pnl.actualNetProfit - rep.pnl.planNetProfit, f: 'B16-C16', s: 'totalCurrency' },
    ],
    [
      { v: '(+) Công trực tiếp (theo kế hoạch)', s: 'text' },
      { v: rep.pnl.directLaborActual, s: 'currency' },
      { v: rep.pnl.directLaborPlan, s: 'currency' },
      { v: rep.pnl.directLaborActual - rep.pnl.directLaborPlan, f: 'B17-C17', s: 'formulaCurrency' },
    ],
    [
      { v: '➜ THU NHẬP GIA ĐÌNH (ước)', s: 'totalLabel' },
      { v: rep.pnl.estimatedFamilyIncomeActual, f: 'B16+B17', s: 'totalCurrency' },
      { v: rep.pnl.estimatedFamilyIncomePlan, f: 'C16+C17', s: 'totalCurrency' },
      {
        v: rep.pnl.estimatedFamilyIncomeActual - rep.pnl.estimatedFamilyIncomePlan,
        f: 'B18-C18',
        s: 'totalCurrency',
      },
    ],
    [],
    [{ v: 'C. SẢN XUẤT & HAO HỤT THỰC TẾ (→ đưa về file kế hoạch làm tham số hao hụt)', s: 'section' }],
    [
      { v: 'Chỉ tiêu', s: 'header' },
      { v: 'Giá trị', s: 'headerRight' },
      { v: 'Ghi chú', s: 'header' },
    ],
    [
      { v: 'Số mẻ trong tháng', s: 'text' },
      {
        v: rep.productionSummary.batchCount,
        f: `COUNTIFS('06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3,'06_San_Xuat'!$D$5:$D$${prodMaxRow},"<>")`,
        s: 'formulaNumber',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Tổng SL làm (đổ khuôn / đóng)', s: 'text' },
      {
        v: rep.productionSummary.totalQtyStarted,
        f: `SUMIFS('06_San_Xuat'!$F$5:$F$${prodMaxRow},'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Tổng SL đạt', s: 'text' },
      {
        v: rep.productionSummary.totalQtyGood,
        f: `SUMIFS('06_San_Xuat'!$G$5:$G$${prodMaxRow},'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaNumber',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Tỷ lệ phế phẩm thực', s: 'text' },
      {
        v: rep.productionSummary.defectRate ?? '',
        f: 'IF(B23=0,"",(B23-B24)/B23)',
        s: 'formulaPercent',
      },
      { v: 'Kế hoạch hiện coi = 0%', s: 'textMuted' },
    ],
    [
      { v: 'Thạch cao cân thực (g)', s: 'text' },
      {
        v: rep.productionSummary.weighedPlasterActualGrams,
        f: `SUMIFS('06_San_Xuat'!$J$5:$J$${prodMaxRow},'06_San_Xuat'!$J$5:$J$${prodMaxRow},">0",'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaDecimal',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Thạch cao theo định mức của các mẻ có cân (g)', s: 'text' },
      {
        v: rep.productionSummary.weighedPlasterStandardGrams,
        f: `SUMIFS('06_San_Xuat'!$K$5:$K$${prodMaxRow},'06_San_Xuat'!$J$5:$J$${prodMaxRow},">0",'06_San_Xuat'!$A$5:$A$${prodMaxRow},">="&$C$3,'06_San_Xuat'!$A$5:$A$${prodMaxRow},"<"&$E$3)`,
        s: 'formulaDecimal',
      },
      { v: '', s: 'textMuted' },
    ],
    [
      { v: 'Chênh thạch cao thực vs định mức', s: 'textBold' },
      {
        v: rep.productionSummary.plasterVarianceGrams,
        f: 'B26-B27',
        s: 'formulaDecimal',
      },
      { v: 'Dương = dùng nhiều hơn định mức', s: 'textMuted' },
    ],
    [],
    [{ v: 'D. DÒNG TIỀN THỰC TRONG THÁNG', s: 'section' }],
    [
      { v: 'Khoản', s: 'header' },
      { v: 'Số tiền', s: 'headerRight' },
    ],
    [
      { v: '(+) Thực nhận từ đơn bán', s: 'text' },
      { v: rep.cashflow.netFromSales, f: 'G10', s: 'formulaCurrency' },
    ],
    [
      { v: '(+) Thu khác (11)', s: 'text' },
      {
        v: rep.cashflow.otherIncome,
        f: `SUMIFS('11_Thu_Chi_Khac'!$F$5:$F$${cashMaxRow},'11_Thu_Chi_Khac'!$B$5:$B$${cashMaxRow},"Thu",'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},">="&$C$3,'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
    ],
    [
      { v: '(−) Mua vật tư (05)', s: 'text' },
      {
        v: rep.cashflow.materialPurchases,
        f: `-SUMIFS('05_Nhap_Hang'!$H$5:$H$${purMaxRow},'05_Nhap_Hang'!$A$5:$A$${purMaxRow},">="&$C$3,'05_Nhap_Hang'!$A$5:$A$${purMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
    ],
    [
      { v: '(−) Chi khác (11, gồm OPEX, dụng cụ, rút tiền)', s: 'text' },
      {
        v: rep.cashflow.otherExpenses,
        f: `-SUMIFS('11_Thu_Chi_Khac'!$F$5:$F$${cashMaxRow},'11_Thu_Chi_Khac'!$B$5:$B$${cashMaxRow},"Chi",'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},">="&$C$3,'11_Thu_Chi_Khac'!$A$5:$A$${cashMaxRow},"<"&$E$3)`,
        s: 'formulaCurrency',
      },
    ],
    [
      { v: '➜ DÒNG TIỀN RÒNG THÁNG', s: 'totalLabel' },
      { v: rep.cashflow.netCashflow, f: 'SUM(B32:B35)', s: 'totalCurrency' },
    ],
    [],
    [{ v: 'E. THEO SKU — SL BÁN THỰC VS KẾ HOẠCH, GIÁ BÁN BQ THỰC VS GIÁ CHUẨN, % LỖI ĐÚC', s: 'section' }],
    [
      { v: 'Mã SKU', s: 'header' },
      { v: 'SL bán thực', s: 'headerRight' },
      { v: 'SL KH / tháng', s: 'headerRight' },
      { v: '% đạt', s: 'headerRight' },
      { v: 'Giá BQ thực', s: 'headerRight' },
      { v: 'Giá chuẩn BQ', s: 'headerRight' },
      { v: 'Chênh giá', s: 'headerRight' },
      { v: 'SL làm', s: 'headerRight' },
      { v: 'SL đạt', s: 'headerRight' },
      { v: '% lỗi', s: 'headerRight' },
    ],
    ...s12SkuRows,
  ]

  const sheets: XlsxSheetSpec[] = [
    {
      name: '00_Tong_Quan',
      tabColor: '0284C7',
      colWidths: [34, 18, 22, 16, 32, 16, 44],
      rows: s00Rows,
    },
    {
      name: '01_Vat_Tu',
      tabColor: '475569',
      freezeRows: 4,
      colWidths: [12, 22, 46, 12, 20, 26, 18, 18, 40],
      rows: s01Rows,
    },
    {
      name: '02_SKU',
      tabColor: '475569',
      freezeRows: 4,
      freezeCols: 2,
      colWidths: [20, 56, 10, 14, 15, 16, 16, 16, 14, 14, 16, 14, 14, 15],
      rows: s02Rows,
    },
    {
      name: '03_Dinh_Muc',
      tabColor: '475569',
      freezeRows: 4,
      colWidths: [20, 12, 12, 16, 46],
      rows: s03Rows,
    },
    {
      name: '04_Ton_Dau_Ky',
      tabColor: 'D97706',
      freezeRows: 4,
      colWidths: [10, 20, 48, 10, 16, 15, 28, 52],
      rows: s04Rows,
    },
    {
      name: '05_Nhap_Hang',
      tabColor: 'D97706',
      freezeRows: 4,
      colWidths: [14, 20, 26, 12, 42, 10, 16, 20, 18, 16, 16, 36],
      rows: s05Rows,
    },
    {
      name: '06_San_Xuat',
      tabColor: 'D97706',
      freezeRows: 4,
      colWidths: [14, 16, 16, 20, 42, 18, 12, 12, 10, 20, 22, 18, 20, 16, 18, 36],
      rows: s06Rows,
    },
    {
      name: '07_Don_Ban',
      tabColor: '059669',
      freezeRows: 4,
      colWidths: [14, 18, 18, 24, 20, 40, 10, 16, 16, 20, 15, 16, 16, 18, 18, 14, 14, 16, 16, 16, 36],
      rows: s07Rows,
    },
    {
      name: '08_Dieu_Chinh_Kho',
      tabColor: 'D97706',
      freezeRows: 4,
      colWidths: [14, 12, 20, 44, 14, 28, 38],
      rows: s08Rows,
    },
    {
      name: '09_Ton_Kho_Vat_Tu',
      tabColor: '0D9488',
      freezeRows: 4,
      colWidths: [12, 44, 10, 14, 14, 16, 16, 14, 16, 18, 18, 18],
      rows: s09Rows,
    },
    {
      name: '10_Ton_Kho_Thanh_Pham',
      tabColor: '0D9488',
      freezeRows: 4,
      colWidths: [20, 48, 13, 14, 13, 13, 16, 14, 22, 20, 18],
      rows: s10Rows,
    },
    {
      name: '11_Thu_Chi_Khac',
      tabColor: '7C3AED',
      freezeRows: 4,
      colWidths: [14, 12, 30, 16, 40, 18, 34],
      rows: s11Rows,
    },
    {
      name: '12_Bao_Cao_Thang',
      tabColor: '0284C7',
      colWidths: [34, 16, 16, 14, 18, 18, 18, 18, 18, 18],
      rows: s12Rows,
    },
  ]

  return sheets
}

export async function buildBaocao1XlsxUint8Array(snap: Baocao1FullSnapshot): Promise<Uint8Array> {
  return buildXlsxUint8Array(buildBaocao1Sheets(snap))
}

// 7. Consolidated `baocao1.csv` Builder (Exact 13-Section Layout)
// ============================================================================

function padCsvRow(cells: unknown[], totalCols: number): string {
  const out: string[] = []
  for (let i = 0; i < totalCols; i++) {
    out.push(escapeCsvCell(cells[i] ?? ''))
  }
  return out.join(',')
}

function fmtPctCsv(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return ''
  return `${Math.round(val * 1000) / 10}%`
}

export function buildBaocao1Csv(snap: Baocao1FullSnapshot): string {
  const lines: string[] = []
  const rep = snap.monthlyReport

  // 00. TỔNG QUAN (7 cols)
  lines.push(padCsvRow(['00. TỔNG QUAN VẬN HÀNH — BƠ MỘC'], 7))
  lines.push(
    padCsvRow(
      [
        'File VẬN HÀNH: ghi chép hằng ngày (nhập hàng, mẻ đúc, đơn bán, thu chi). Tồn kho & báo cáo tự tính. Danh mục/giá chuẩn copy từ Ke_Hoach_Dinh_Gia_Bo_Moc.xlsx.',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      ['Tháng hiện tại:', snap.meta.currentMonth, '→ đến trước ngày:', snap.meta.currentMonthNext],
      7
    )
  )
  lines.push(padCsvRow([], 7))
  lines.push(padCsvRow(['A. THÁNG NÀY (TỪ NGÀY 1 ĐẾN HÔM NAY)', '', '', '', 'B. CẢNH BÁO KHO'], 7))
  lines.push(
    padCsvRow(
      [
        'Doanh thu ghi nhận',
        snap.overview.thisMonth.recognizedRevenue,
        '',
        '',
        'Số vật tư CẦN ĐẶT HÀNG',
        snap.overview.stockAlerts.materialsNeedReorder,
        'Xem 09_Ton_Kho_Vat_Tu',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Thực nhận',
        snap.overview.thisMonth.netPayout,
        '',
        '',
        'Số SKU CẦN ĐÚC / ĐÓNG THÊM',
        snap.overview.stockAlerts.skusNeedProduction,
        'Xem 10_Ton_Kho_Thanh_Pham',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Lãi gộp (thực nhận − giá vốn)',
        snap.overview.thisMonth.grossProfit,
        '',
        '',
        'Số mã ÂM KHO (ghi chép thiếu)',
        snap.overview.stockAlerts.negativeStockCodes,
        'Thường do quên ghi nhập hàng hoặc tồn đầu kỳ sai',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'SL sản phẩm đã bán',
        snap.overview.thisMonth.soldUnits,
        '',
        '',
        'Giá trị tồn vật tư',
        snap.overview.stockAlerts.materialStockValue,
        '',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'SL đã sản xuất đạt',
        snap.overview.thisMonth.producedGoodUnits,
        '',
        '',
        'Giá trị tồn thành phẩm',
        snap.overview.stockAlerts.finishedStockValue,
        '',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Chi mua vật tư',
        snap.overview.thisMonth.materialPurchaseSpent,
        '',
        '',
        'Tồn đầu kỳ chưa kiểm kê (số mã)',
        snap.overview.stockAlerts.unverifiedOpeningCount,
        "Cân/đếm thực tế rồi đổi thành 'Đã kiểm kê'",
      ],
      7
    )
  )
  lines.push(padCsvRow(['Chi khác (OPEX, dụng cụ...)', snap.overview.thisMonth.otherExpenses], 7))
  lines.push(padCsvRow(['Kế hoạch: SL / tháng', PLAN_MONTHLY_SL], 7))
  lines.push(padCsvRow(['Kế hoạch: Lãi ròng / tháng', PLAN_MONTHLY_NET_PROFIT], 7))
  lines.push(padCsvRow([], 7))
  lines.push(padCsvRow([], 7))
  lines.push(padCsvRow(['C. QUY TRÌNH GHI CHÉP'], 7))
  lines.push(padCsvRow(['Khi nào', 'Sheet', 'Việc cần làm'], 7))
  lines.push(
    padCsvRow(
      [
        'Lần đầu',
        '04_Ton_Dau_Ky',
        "Cân/đếm vật tư & thành phẩm đang có, sửa số ô vàng, đổi tình trạng 'Đã kiểm kê'.",
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      ['Khi mua hàng', '05_Nhap_Hang', '1 dòng / mặt hàng, SL theo ĐVT chuẩn, thành tiền thực trả.'],
      7
    )
  )
  lines.push(
    padCsvRow(
      ['Sau mỗi mẻ đúc / đóng gói', '06_San_Xuat', 'SL đổ khuôn, SL đạt; cân thạch cao nếu được.'],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Mỗi ngày (hoặc mỗi đơn)',
        '07_Don_Ban',
        'Shopee: lấy số thực nhận ở Seller Center. Cập nhật trạng thái khi giao xong / hoàn.',
      ],
      7
    )
  )
  lines.push(padCsvRow(['Khi hư hỏng, tặng, kiểm kê lệch', '08_Dieu_Chinh_Kho', 'SL âm = trừ kho.'], 7))
  lines.push(
    padCsvRow(
      ['Khi trả điện, web, rút tiền...', '11_Thu_Chi_Khac', "Cuối tháng ghi 'OPEX — Quỹ tái đầu tư khuôn'."],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Cuối tháng',
        '12_Bao_Cao_Thang',
        'Chọn tháng → xem thực tế vs kế hoạch; tỷ lệ phế phẩm & giá nhập mới đưa về file kế hoạch.',
      ],
      7
    )
  )
  lines.push(
    padCsvRow(
      [
        'Khi file kế hoạch đổi giá / mã',
        '01, 02, 03',
        'Dán lại giá trị từ file kế hoạch (hoặc nhờ trợ lý đồng bộ).',
      ],
      7
    )
  )

  // 01. DANH MỤC VẬT TƯ (9 cols)
  lines.push(padCsvRow(['01. DANH MỤC VẬT TƯ (COPY TỪ FILE KẾ HOẠCH 03_Vat_Tu)'], 9))
  lines.push(
    padCsvRow(
      [
        "Cột A–F là bản copy giá trị từ file kế hoạch (không sửa tay ở đây). Cột H 'Điểm đặt hàng lại' là ô vàng anh/chị tự chỉnh.",
      ],
      9
    )
  )
  lines.push(
    padCsvRow(
      [
        'Mã VT được cân thực tế khi đúc:',
        '',
        snap.meta.weighedMaterialCode,
        '(thạch cao — nhập số gram cân thực ở 06_San_Xuat cột J để trừ kho đúng thực tế)',
      ],
      9
    )
  )
  lines.push(
    padCsvRow(
      [
        'Mã VT',
        'Nhóm VT',
        'Tên vật tư',
        'ĐVT chuẩn',
        'Đơn giá chuẩn (đ/ĐVT)',
        'Trạng thái',
        'Nhu cầu KH / tháng',
        'Điểm đặt hàng lại',
        'Ghi chú',
      ],
      9
    )
  )
  for (const m of snap.materials) {
    lines.push(
      padCsvRow(
        [
          m.code,
          m.group,
          m.name,
          m.unit,
          m.standardUnitCost ?? '',
          m.status,
          m.monthlyPlanDemand ?? '',
          m.reorderPoint ?? '',
          m.note,
        ],
        9
      )
    )
  }

  // 02. DANH MỤC SKU (14 cols)
  lines.push(padCsvRow(['02. DANH MỤC SKU ĐANG BÁN & GIÁ CHUẨN (COPY TỪ FILE KẾ HOẠCH 09, 11, 12)'], 14))
  lines.push(
    padCsvRow(
      [
        "Giá vốn chuẩn, giá bán chốt và sản lượng kế hoạch là bản copy giá trị. Cột N 'Tồn tối thiểu' là ô vàng — dưới mức này sheet 10 báo cần đúc/đóng thêm.",
      ],
      14
    )
  )
  lines.push(padCsvRow([], 14))
  lines.push(
    padCsvRow(
      [
        'Mã SKU',
        'Tên SKU',
        'Nhóm DM',
        'Nhóm định giá',
        'Giá vốn chuẩn',
        'Shopee giá thực tế',
        'Shopee giá bán thường',
        'Giá lẻ Zalo/Web',
        'Giá sỉ B1',
        'Giá sỉ B2',
        'KH SL Shopee / tháng',
        'KH SL lẻ / tháng',
        'KH SL sỉ / tháng',
        'Tồn TP tối thiểu',
      ],
      14
    )
  )
  for (const s of snap.skus) {
    lines.push(
      padCsvRow(
        [
          s.sku,
          s.name,
          s.categoryGroup,
          s.pricingGroup,
          s.standardCost,
          s.shopeeActualPrice ?? '',
          s.shopeeRegularPrice ?? '',
          s.retailPrice,
          s.wholesaleB1,
          s.wholesaleB2,
          s.planQtyShopee,
          s.planQtyRetail,
          s.planQtyWholesale,
          s.minFinishedStock,
        ],
        14
      )
    )
  }

  // 03. ĐỊNH MỨC CHUẨN (5 cols)
  lines.push(padCsvRow(['03. ĐỊNH MỨC CHUẨN / 1 SP (COPY TỪ FILE KẾ HOẠCH 08_BOM — ĐÃ NHÂN HỆ SỐ MẺ)'], 5))
  lines.push(
    padCsvRow(
      [
        "Dùng để tự trừ kho: dòng 'NVL' trừ khi sản xuất (06), dòng 'Bao bì' trừ khi xuất bán (07). Không sửa tay — cập nhật bằng cách dán lại từ file kế hoạch.",
      ],
      5
    )
  )
  lines.push(padCsvRow([], 5))
  lines.push(padCsvRow(['Mã SKU', 'Loại', 'Mã VT', 'Định mức / 1 SP', 'Tên vật tư (tự tra)'], 5))
  for (const b of snap.bom) {
    lines.push(padCsvRow([b.sku, b.kind, b.materialCode, b.qtyPerUnit, b.materialName], 5))
  }

  // 04. TỒN ĐẦU KỲ (8 cols)
  lines.push(padCsvRow(['04. TỒN ĐẦU KỲ (KIỂM KÊ LẦN ĐẦU)'], 8))
  lines.push(
    padCsvRow(
      [
        "Số vàng hiện là ƯỚC TÍNH = lượng đã mua theo chứng từ, CHƯA trừ phần đã dùng thử. Hãy cân/đếm thực tế, sửa số, đổi tình trạng thành 'Đã kiểm kê'. Chỉ ghi giao dịch ở các sheet khác từ sau ngày kiểm kê.",
      ],
      8
    )
  )
  lines.push(padCsvRow([], 8))
  lines.push(
    padCsvRow(
      ['Loại mã', 'Mã', 'Tên (tự tra)', 'ĐVT', 'SL tồn đầu kỳ', 'Ngày kiểm kê', 'Tình trạng', 'Ghi chú'],
      8
    )
  )
  for (const o of snap.openingStocks) {
    lines.push(
      padCsvRow([o.kind, o.code, o.name, o.unit, o.openingQty, o.stocktakeDate, o.status, o.note], 8)
    )
  }

  // 05. NHẬP HÀNG (12 cols)
  lines.push(padCsvRow(['05. NHẬP HÀNG / MUA VẬT TƯ (MỖI DÒNG = 1 MẶT HÀNG)'], 12))
  lines.push(
    padCsvRow(
      [
        'Ghi SL theo ĐVT chuẩn (vd bao 25kg → 25000 g). Thành tiền = số thực trả sau voucher, gồm ship phân bổ. Đơn giá thực lệch >10% so với chuẩn → cập nhật lại file kế hoạch 03_Vat_Tu.',
      ],
      12
    )
  )
  lines.push(padCsvRow([], 12))
  lines.push(
    padCsvRow(
      [
        'Ngày',
        'Mã đơn / chứng từ',
        'Nhà cung cấp',
        'Mã VT',
        'Tên VT (tự tra)',
        'ĐVT',
        'SL (ĐVT chuẩn)',
        'Thành tiền thực trả',
        'Đơn giá thực / ĐVT',
        'Đơn giá chuẩn',
        'Lệch so với chuẩn',
        'Ghi chú (quy cách mua...)',
      ],
      12
    )
  )
  for (const p of snap.purchases) {
    lines.push(
      padCsvRow(
        [
          p.date,
          p.docCode,
          p.supplier,
          p.materialCode,
          p.materialName,
          p.unit,
          p.qtyStandardUnit,
          p.actualTotalPaid,
          p.actualUnitCost !== null ? Math.round(p.actualUnitCost * 10000) / 10000 : '',
          p.standardUnitCost ?? '',
          fmtPctCsv(p.variancePct),
          p.note,
        ],
        12
      )
    )
  }

  // 06. NHẬT KÝ SẢN XUẤT (16 cols)
  lines.push(padCsvRow(['06. NHẬT KÝ SẢN XUẤT — MẺ ĐÚC & CHIẾT / ĐÓNG GÓI'], 16))
  lines.push(
    padCsvRow(
      [
        "Mỗi dòng = 1 mẻ của 1 SKU. 'SL làm' = số đổ khuôn (gồm cả hỏng) → trừ NVL theo định mức; 'SL đạt' → cộng kho thành phẩm. Cân thạch cao thực (cột J) để biết hao hụt thật; bỏ trống thì trừ theo định mức.",
      ],
      16
    )
  )
  lines.push(padCsvRow([], 16))
  lines.push(
    padCsvRow(
      [
        'Ngày',
        'Mã mẻ',
        'Loại',
        'Mã SKU',
        'Tên SKU (tự tra)',
        'SL làm (đổ khuôn / đóng)',
        'SL đạt',
        'SL lỗi / phế',
        '% lỗi',
        'Thạch cao cân thực (g)',
        'Thạch cao theo định mức (g)',
        'Thạch cao trừ kho (g)',
        'Chênh thạch cao vs định mức',
        'Phút làm thực tế',
        'Người làm',
        'Ghi chú lỗi / cải tiến',
      ],
      16
    )
  )
  for (const pr of snap.productions) {
    lines.push(
      padCsvRow(
        [
          pr.date,
          pr.batchCode,
          pr.batchType,
          pr.sku,
          pr.skuName,
          pr.qtyStarted,
          pr.qtyGood,
          pr.defectQty,
          fmtPctCsv(pr.defectPct),
          pr.actualPlasterGrams ?? '',
          pr.standardPlasterGrams,
          pr.deductedPlasterGrams,
          pr.plasterVarianceGrams ?? '',
          pr.actualMinutes ?? '',
          pr.operator,
          pr.note,
        ],
        16
      )
    )
  }

  // 07. ĐƠN BÁN HÀNG (21 cols)
  lines.push(padCsvRow(['07. ĐƠN BÁN HÀNG (MỖI DÒNG = 1 SKU TRONG ĐƠN)'], 21))
  lines.push(
    padCsvRow(
      [
        "Shopee: lấy 'Số tiền thực nhận' trong Seller Center; Phí = Thành tiền − Thực nhận (nhập ở 1 dòng của đơn). Có thể ghi gộp theo ngày (mã đơn SHP-ddmm). Lẻ/Sỉ: phí = phí COD + phần ship shop trả.",
      ],
      21
    )
  )
  lines.push(padCsvRow([], 21))
  lines.push(
    padCsvRow(
      [
        'Ngày',
        'Mã đơn',
        'Kênh',
        'Khách hàng',
        'Mã SKU',
        'Tên SKU (tự tra)',
        'SL',
        'Đơn giá bán thực',
        'Thành tiền',
        'Phí sàn / COD / voucher shop',
        'Ship shop trả',
        'Thực nhận',
        'Trạng thái',
        'Doanh thu ghi nhận',
        'Thực nhận ghi nhận',
        'SL xuất kho TP',
        'SL trừ bao bì',
        'Giá vốn chuẩn',
        'Lãi gộp',
        'Giá chuẩn kênh',
        'Ghi chú',
      ],
      21
    )
  )
  for (const so of snap.salesOrders) {
    lines.push(
      padCsvRow(
        [
          so.date,
          so.orderCode,
          so.channel,
          so.customer,
          so.sku,
          so.skuName,
          so.qty,
          so.actualUnitPrice,
          so.grossAmount,
          so.platformAndVoucherFee,
          so.sellerShippingPaid,
          so.netPayout,
          so.status,
          so.recognizedRevenue,
          so.recognizedNetPayout,
          so.stockOutQty,
          so.packagingOutQty,
          so.standardCogs,
          so.grossProfit,
          so.channelStandardPrice,
          so.note,
        ],
        21
      )
    )
  }

  // 08. ĐIỀU CHỈNH KHO (7 cols)
  lines.push(padCsvRow(['08. ĐIỀU CHỈNH KHO (HƯ HỎNG, DÙNG THỬ, QUÀ TẶNG, CHÊNH KIỂM KÊ...)'], 7))
  lines.push(
    padCsvRow(
      [
        'SL dương = cộng kho, âm = trừ kho. Dùng khi đóng đơn sỉ khác định mức, làm mẫu thử, tặng KOC, hoặc khi kiểm kê thấy chênh.',
      ],
      7
    )
  )
  lines.push(padCsvRow([], 7))
  lines.push(padCsvRow(['Ngày', 'Loại mã', 'Mã', 'Tên (tự tra)', 'SL (+/−)', 'Lý do', 'Ghi chú'], 7))
  for (const ad of snap.adjustments) {
    lines.push(padCsvRow([ad.date, ad.kind, ad.code, ad.name, ad.deltaQty, ad.reason, ad.note], 7))
  }

  // 09. TỒN KHO VẬT TƯ (12 cols)
  lines.push(padCsvRow(['09. TỒN KHO VẬT TƯ (TỰ TÍNH — KHÔNG NHẬP)'], 12))
  lines.push(
    padCsvRow(
      [
        'Tồn = Đầu kỳ (04) + Nhập (05) − Xuất sản xuất theo định mức NVL (06) − Xuất bao bì theo đơn bán (07) ± Điều chỉnh (08). Thạch cao trừ theo số cân thực nếu có.',
      ],
      12
    )
  )
  lines.push(
    padCsvRow(
      ['', '', '', '', '', '', '', '', '', '', 'Tổng giá trị tồn:', snap.overview.stockAlerts.materialStockValue],
      12
    )
  )
  lines.push(
    padCsvRow(
      [
        'Mã VT',
        'Tên vật tư',
        'ĐVT',
        'Tồn đầu kỳ',
        'Nhập',
        'Xuất sản xuất',
        'Xuất bao bì (bán)',
        'Điều chỉnh',
        'TỒN HIỆN TẠI',
        'Điểm đặt hàng lại',
        'Cảnh báo',
        'Giá trị tồn (đ)',
      ],
      12
    )
  )
  for (const m of snap.materialInventory) {
    lines.push(
      padCsvRow(
        [
          m.code,
          m.name,
          m.unit,
          m.openingQty,
          m.purchasedQty,
          m.productionUsedQty,
          m.packagingSoldQty,
          m.adjustedQty,
          m.currentQty,
          m.reorderPoint ?? '',
          m.alert,
          m.stockValue,
        ],
        12
      )
    )
  }

  // 10. TỒN KHO THÀNH PHẨM (11 cols)
  lines.push(padCsvRow(['10. TỒN KHO THÀNH PHẨM (TỰ TÍNH — KHÔNG NHẬP)'], 11))
  lines.push(
    padCsvRow(
      [
        'Tồn = Đầu kỳ (04) + SL đạt (06) − SL xuất bán (07: đã giao, đang giao, hoàn hỏng) ± Điều chỉnh (08). Hoàn nhập lại kho thì không trừ.',
      ],
      11
    )
  )
  lines.push(
    padCsvRow(
      ['', '', '', '', '', '', '', '', 'Tổng giá trị tồn:', snap.overview.stockAlerts.finishedStockValue, ''],
      11
    )
  )
  lines.push(
    padCsvRow(
      [
        'Mã SKU',
        'Tên SKU',
        'Tồn đầu kỳ',
        'Sản xuất đạt',
        'Xuất bán',
        'Điều chỉnh',
        'TỒN HIỆN TẠI',
        'Tồn tối thiểu',
        'Cảnh báo',
        'Giá trị tồn (giá vốn)',
        'Bán 30 ngày gần nhất',
      ],
      11
    )
  )
  for (const f of snap.finishedInventory) {
    lines.push(
      padCsvRow(
        [
          f.sku,
          f.name,
          f.openingQty,
          f.producedGoodQty,
          f.soldOutQty,
          f.adjustedQty,
          f.currentQty,
          f.minStock,
          f.alert,
          f.stockValue,
          f.soldLast30Days,
        ],
        11
      )
    )
  }

  // 11. THU / CHI KHÁC (7 cols)
  lines.push(padCsvRow(['11. THU / CHI KHÁC (OPEX THỰC TẾ, MUA DỤNG CỤ, RÚT TIỀN...)'], 7))
  lines.push(
    padCsvRow(
      [
        "Tiền bán hàng (07) và tiền mua vật tư (05) đã tự tính — KHÔNG ghi lại ở đây. Mỗi tháng nhớ ghi dòng 'OPEX — Quỹ tái đầu tư khuôn' (180.000đ, chuyển sang tiết kiệm) để so đúng với kế hoạch.",
      ],
      7
    )
  )
  lines.push(padCsvRow([], 7))
  lines.push(
    padCsvRow(['Ngày', 'Thu / Chi', 'Nhóm', 'Mã CP kế hoạch', 'Diễn giải', 'Số tiền', 'Ghi chú'], 7)
  )
  for (const cf of snap.otherCashflows) {
    lines.push(
      padCsvRow(
        [cf.date, cf.flowType, cf.group, cf.planCostCode, cf.description, cf.amount, cf.note],
        7
      )
    )
  }

  // 12. BÁO CÁO THÁNG (10 cols)
  lines.push(padCsvRow(['12. BÁO CÁO THÁNG — THỰC TẾ SO VỚI KẾ HOẠCH'], 10))
  lines.push(
    padCsvRow(
      [
        'Chọn tháng ở ô vàng C3 (nhập ngày 1 của tháng). Số kế hoạch là bản copy từ file kế hoạch tại thời điểm dựng file.',
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      ['Tháng báo cáo (ngày 1):', '', snap.meta.reportMonth, '→ đến trước ngày:', snap.meta.reportMonthNext],
      10
    )
  )
  lines.push(padCsvRow([], 10))
  lines.push(padCsvRow(['A. BÁN HÀNG THEO KÊNH'], 10))
  lines.push(
    padCsvRow(
      [
        'Kênh',
        'SL bán thực',
        'SL kế hoạch',
        '% đạt SL',
        'Doanh thu thực',
        'Doanh thu KH',
        'Thực nhận',
        'Giá vốn chuẩn',
        'Lãi gộp thực',
        'Lãi đóng góp KH',
      ],
      10
    )
  )
  for (const ch of rep.byChannel) {
    lines.push(
      padCsvRow(
        [
          ch.channel,
          ch.actualQty,
          ch.planQty,
          fmtPctCsv(ch.qtyAchievementPct),
          ch.actualRevenue,
          ch.planRevenue,
          ch.actualNetPayout,
          ch.standardCogs,
          ch.actualGrossProfit,
          ch.planContributionProfit,
        ],
        10
      )
    )
  }
  lines.push(
    padCsvRow(
      [
        'TỔNG',
        rep.channelTotal.actualQty,
        rep.channelTotal.planQty,
        fmtPctCsv(rep.channelTotal.qtyAchievementPct),
        rep.channelTotal.actualRevenue,
        rep.channelTotal.planRevenue,
        rep.channelTotal.actualNetPayout,
        rep.channelTotal.standardCogs,
        rep.channelTotal.actualGrossProfit,
        rep.channelTotal.planContributionProfit,
      ],
      10
    )
  )
  lines.push(padCsvRow([], 10))
  lines.push(padCsvRow(['B. LÃI / LỖ THỰC TẾ THÁNG'], 10))
  lines.push(padCsvRow(['Chỉ tiêu', 'Thực tế', 'Kế hoạch', 'Chênh lệch'], 10))
  lines.push(
    padCsvRow(
      [
        'Lãi gộp (thực nhận − giá vốn chuẩn)',
        rep.pnl.actualGrossProfit,
        rep.pnl.planGrossProfit,
        rep.pnl.actualGrossProfit - rep.pnl.planGrossProfit,
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      [
        "(−) OPEX thực (11: nhóm 'OPEX — ...')",
        rep.pnl.actualOpex,
        rep.pnl.planOpex,
        rep.pnl.actualOpex - rep.pnl.planOpex,
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      [
        '➜ LÃI RÒNG THÁNG',
        rep.pnl.actualNetProfit,
        rep.pnl.planNetProfit,
        rep.pnl.actualNetProfit - rep.pnl.planNetProfit,
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      [
        '(+) Công trực tiếp (theo kế hoạch)',
        rep.pnl.directLaborActual,
        rep.pnl.directLaborPlan,
        rep.pnl.directLaborActual - rep.pnl.directLaborPlan,
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      [
        '➜ THU NHẬP GIA ĐÌNH (ước)',
        rep.pnl.estimatedFamilyIncomeActual,
        rep.pnl.estimatedFamilyIncomePlan,
        rep.pnl.estimatedFamilyIncomeActual - rep.pnl.estimatedFamilyIncomePlan,
      ],
      10
    )
  )
  lines.push(padCsvRow([], 10))
  lines.push(
    padCsvRow(['C. SẢN XUẤT & HAO HỤT THỰC TẾ (→ đưa về file kế hoạch làm tham số hao hụt)'], 10)
  )
  lines.push(padCsvRow(['Chỉ tiêu', 'Giá trị', 'Ghi chú'], 10))
  lines.push(padCsvRow(['Số mẻ trong tháng', rep.productionSummary.batchCount, ''], 10))
  lines.push(
    padCsvRow(['Tổng SL làm (đổ khuôn / đóng)', rep.productionSummary.totalQtyStarted, ''], 10)
  )
  lines.push(padCsvRow(['Tổng SL đạt', rep.productionSummary.totalQtyGood, ''], 10))
  lines.push(
    padCsvRow(
      ['Tỷ lệ phế phẩm thực', fmtPctCsv(rep.productionSummary.defectRate), 'Kế hoạch hiện coi = 0%'],
      10
    )
  )
  lines.push(
    padCsvRow(['Thạch cao cân thực (g)', rep.productionSummary.weighedPlasterActualGrams, ''], 10)
  )
  lines.push(
    padCsvRow(
      [
        'Thạch cao theo định mức của các mẻ có cân (g)',
        rep.productionSummary.weighedPlasterStandardGrams,
        '',
      ],
      10
    )
  )
  lines.push(
    padCsvRow(
      [
        'Chênh thạch cao thực vs định mức',
        rep.productionSummary.plasterVarianceGrams,
        'Dương = dùng nhiều hơn định mức',
      ],
      10
    )
  )
  lines.push(padCsvRow([], 10))
  lines.push(padCsvRow(['D. DÒNG TIỀN THỰC TRONG THÁNG'], 10))
  lines.push(padCsvRow(['Khoản', 'Số tiền'], 10))
  lines.push(padCsvRow(['(+) Thực nhận từ đơn bán', rep.cashflow.netFromSales], 10))
  lines.push(padCsvRow(['(+) Thu khác (11)', rep.cashflow.otherIncome], 10))
  lines.push(padCsvRow(['(−) Mua vật tư (05)', rep.cashflow.materialPurchases], 10))
  lines.push(
    padCsvRow(['(−) Chi khác (11, gồm OPEX, dụng cụ, rút tiền)', rep.cashflow.otherExpenses], 10)
  )
  lines.push(padCsvRow(['➜ DÒNG TIỀN RÒNG THÁNG', rep.cashflow.netCashflow], 10))
  lines.push(padCsvRow([], 10))
  lines.push(
    padCsvRow(['E. THEO SKU — SL BÁN THỰC VS KẾ HOẠCH, GIÁ BÁN BQ THỰC VS GIÁ CHUẨN, % LỖI ĐÚC'], 10)
  )
  lines.push(
    padCsvRow(
      [
        'Mã SKU',
        'SL bán thực',
        'SL KH / tháng',
        '% đạt',
        'Giá BQ thực',
        'Giá chuẩn BQ',
        'Chênh giá',
        'SL làm',
        'SL đạt',
        '% lỗi',
      ],
      10
    )
  )
  for (const sk of rep.bySku) {
    lines.push(
      padCsvRow(
        [
          sk.sku,
          sk.actualSoldQty,
          sk.planMonthlyQty,
          fmtPctCsv(sk.achievementPct),
          sk.actualAvgPrice ?? '',
          sk.standardAvgPrice ?? '',
          sk.priceVariance ?? '',
          sk.qtyStarted,
          sk.qtyGood,
          fmtPctCsv(sk.defectPct),
        ],
        10
      )
    )
  }

  return '\uFEFF' + lines.join('\r\n')
}
