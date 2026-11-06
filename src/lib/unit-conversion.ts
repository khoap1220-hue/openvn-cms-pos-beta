// Hệ thống Quản lý Loại Sản phẩm & Quy đổi Định lượng Đồng bộ (Unit & Quantitative Conversion Engine)
// Ví dụ: Nhập kho 10 kg -> tự động quy đổi ×1.000 = +10.000 gr vào kho gốc.
// Khi bán (POS / Đơn hàng / Hóa đơn) -> tự động quy đổi định lượng (VD: gói 200gr, 500gr, 1kg = 1.000gr) và trừ kho đồng bộ.

import { db } from '@/lib/db'
import type { Prisma, PrismaClient } from '@prisma/client'

type DbClient = PrismaClient | Prisma.TransactionClient

export const PRODUCT_TYPES_SETTING_KEY = 'product_types_catalog_v1'
export const UNIT_CONVERSIONS_SETTING_KEY = 'product_unit_conversions_v1'

export interface ProductTypeInfo {
  code: string
  name: string
  description: string
  badgeColor: string
  /** Cho phép cấu hình quy đổi định lượng Nhập (kg/thùng/lít) ⇄ Kho gốc (gr/ml/cái) ⇄ Bán */
  supportsConversion: boolean
  /** Tự động trừ từ kho nguyên liệu liên kết khi bán */
  deductLinkedBaseOnSale?: boolean
  isSystem?: boolean
}

export interface ProductUnitConfig {
  productId: string
  /** Đơn vị lưu kho cơ sở nhỏ nhất (VD: 'gr', 'ml', 'cây', 'cái', 'hộp') */
  baseUnit: string
  /** Đơn vị khi nhập kho chẵn (VD: 'kg', 'lít', 'bó', 'thùng') */
  purchaseUnit: string
  /** Hệ số quy đổi khi nhập: 1 purchaseUnit = purchaseRate baseUnit (VD: 1 kg = 1000 gr) */
  purchaseRate: number
  /** Đơn vị hiển thị khi bán mặc định (VD: 'kg', 'gói 500gr', 'hộp 250gr', 'bó 100 cây') */
  sellUnit: string
  /** Định lượng trừ kho cơ sở cho 1 đơn vị bán: 1 sellUnit = sellRate baseUnit (VD: 1 kg = 1000 gr, 1 gói = 500 gr) */
  sellRate: number
  /** Các mức định lượng bán nhanh tại quầy POS (tính theo baseUnit, VD: [100, 250, 500, 1000] gr) */
  posQuickQuantities: number[]
  /** Liên kết đồng bộ tới Sản phẩm Kho Nguyên liệu gốc (nếu là phân loại đóng gói rút từ kho tổng) */
  linkedBaseProductId?: string | null
  updatedAt?: string
}

export const DEFAULT_PRODUCT_TYPES: ProductTypeInfo[] = [
  {
    code: 'SIMPLE',
    name: 'Thành phẩm tiêu chuẩn',
    description: 'Sản phẩm quản lý tồn kho theo chiếc, bộ, hộp, lọ; có thể bật quy đổi thùng/kiện khi nhập kho.',
    badgeColor: 'blue',
    supportsConversion: true,
    isSystem: true,
  },
  {
    code: 'WEIGHT_BULK',
    name: 'Hàng định lượng / Cân ký (Kg ⇄ Gram)',
    description: 'Nhập kho theo đơn vị lớn (Kg, Lít, Bó) tự quy đổi ra đơn vị nhỏ (Gram, ml, Cây); khi bán tự trừ theo định lượng đồng bộ.',
    badgeColor: 'emerald',
    supportsConversion: true,
    isSystem: true,
  },
  {
    code: 'PACKAGED_VARIANT',
    name: 'Phân loại đóng gói (Trừ kho nguyên liệu gốc)',
    description: 'Túi/Hộp định lượng (100gr, 250gr, 500gr) liên kết trực tiếp với 1 Kho nguyên liệu gốc; bán ra tự trừ gram ở kho gốc và đồng bộ các cỡ gói khác.',
    badgeColor: 'amber',
    supportsConversion: true,
    deductLinkedBaseOnSale: true,
    isSystem: true,
  },
  {
    code: 'MATERIAL',
    name: 'Nguyên vật liệu / Bán thành phẩm',
    description: 'Nguyên liệu sản xuất (sáp nến, tinh dầu, bấc nến, trà thô) nhập theo Kg/Lít/Bó, lưu kho theo Gram/ml/Cây để trừ định mức chính xác.',
    badgeColor: 'cyan',
    supportsConversion: true,
    isSystem: true,
  },
  {
    code: 'COMBO',
    name: 'Combo / Bộ quà tặng',
    description: 'Set quà tặng gộp nhiều thành phẩm theo Định mức (BOM); khi bán tự trừ kho từng thành phần.',
    badgeColor: 'violet',
    supportsConversion: false,
    isSystem: true,
  },
]

export const PRESET_CONVERSION_TEMPLATES = [
  {
    key: 'KG_TO_GR_1000',
    label: 'Nhập Kg ➔ Kho Gram (1 kg = 1.000 gr)',
    baseUnit: 'gr',
    purchaseUnit: 'kg',
    purchaseRate: 1000,
    sellUnit: 'kg (1.000gr)',
    sellRate: 1000,
    posQuickQuantities: [100, 200, 500, 1000],
  },
  {
    key: 'KG_TO_GR_PACK500',
    label: 'Nhập Kg (1.000gr) ➔ Bán Gói 500gr',
    baseUnit: 'gr',
    purchaseUnit: 'kg',
    purchaseRate: 1000,
    sellUnit: 'gói 500gr',
    sellRate: 500,
    posQuickQuantities: [100, 250, 500, 1000],
  },
  {
    key: 'KG_TO_GR_PACK200',
    label: 'Nhập Kg (1.000gr) ➔ Bán Gói 200gr',
    baseUnit: 'gr',
    purchaseUnit: 'kg',
    purchaseRate: 1000,
    sellUnit: 'gói 200gr',
    sellRate: 200,
    posQuickQuantities: [100, 200, 500, 1000],
  },
  {
    key: 'KG_TO_GR_PACK100',
    label: 'Nhập Kg (1.000gr) ➔ Bán Hộp 100gr',
    baseUnit: 'gr',
    purchaseUnit: 'kg',
    purchaseRate: 1000,
    sellUnit: 'hộp 100gr',
    sellRate: 100,
    posQuickQuantities: [100, 200, 500, 1000],
  },
  {
    key: 'LITER_TO_ML',
    label: 'Nhập Lít ➔ Kho ml (1 lít = 1.000 ml)',
    baseUnit: 'ml',
    purchaseUnit: 'lít',
    purchaseRate: 1000,
    sellUnit: 'lọ 100ml',
    sellRate: 100,
    posQuickQuantities: [50, 100, 250, 500, 1000],
  },
  {
    key: 'BUNDLE_TO_PIECE_100',
    label: 'Nhập Bó ➔ Kho Cây/Cái (1 bó = 100 cây)',
    baseUnit: 'cây',
    purchaseUnit: 'bó',
    purchaseRate: 100,
    sellUnit: 'bó (100 cây)',
    sellRate: 100,
    posQuickQuantities: [10, 50, 100],
  },
  {
    key: 'BOX_TO_ITEM_24',
    label: 'Nhập Thùng ➔ Kho Hộp/Cái (1 thùng = 24 cái)',
    baseUnit: 'cái',
    purchaseUnit: 'thùng',
    purchaseRate: 24,
    sellUnit: 'cái',
    sellRate: 1,
    posQuickQuantities: [1, 6, 12, 24],
  },
]

let seededPromise: Promise<void> | null = null

/**
 * Khởi tạo tự động danh mục Loại sản phẩm & Cấu hình quy đổi mẫu cho các SP nguyên liệu/định lượng
 * (VD: UD-SAP-001 và UD-SAP-002 chuyển từ 82 kg -> 82.000 gr để sẵn sàng nhập 10kg = +10.000gr và bán trừ đồng bộ).
 */
export async function ensureUnitConversionsSeeded(): Promise<void> {
  if (seededPromise) return seededPromise
  seededPromise = (async () => {
    try {
      // 1. Đảm bảo danh mục Loại sản phẩm đã có trong AppSetting
      const existingTypes = await db.appSetting.findUnique({ where: { key: PRODUCT_TYPES_SETTING_KEY } })
      if (!existingTypes) {
        await db.appSetting.create({
          data: {
            key: PRODUCT_TYPES_SETTING_KEY,
            value: JSON.stringify(DEFAULT_PRODUCT_TYPES),
          },
        })
      }

      // 2. Đảm bảo bảng cấu hình quy đổi định lượng đã được khởi tạo cho các SP định lượng có sẵn
      const existingConv = await db.appSetting.findUnique({ where: { key: UNIT_CONVERSIONS_SETTING_KEY } })
      if (!existingConv) {
        const initialMap: Record<string, ProductUnitConfig> = {}
        const sapProducts = await db.product.findMany({
          where: { sku: { in: ['UD-SAP-001', 'UD-SAP-002', 'UD-VL-001'] } },
        })

        for (const p of sapProducts) {
          if (p.sku === 'UD-SAP-001' || p.sku === 'UD-SAP-002') {
            // Nếu đang lưu đơn vị 'kg' và stock nhỏ (< 1000), quy đổi sang 'gr' (×1000) để quản lý chính xác từng gram
            const needsScale = p.unit === 'kg' && p.stock < 1000
            const newStock = needsScale ? p.stock * 1000 : p.stock
            const newThreshold = needsScale ? p.lowStockThreshold * 1000 : p.lowStockThreshold
            await db.product.update({
              where: { id: p.id },
              data: {
                unit: 'gr',
                type: 'WEIGHT_BULK',
                stock: newStock,
                lowStockThreshold: newThreshold,
              },
            })
            if (needsScale) {
              const whRows = await db.warehouseStock.findMany({ where: { productId: p.id } })
              for (const wr of whRows) {
                await db.warehouseStock.update({
                  where: { id: wr.id },
                  data: { quantity: Math.round(wr.quantity * 1000) },
                })
              }
              // Nếu BomComponent đang để 0.25 (kg) thì chuyển sang 250 (gr)
              const bomRows = await db.bomComponent.findMany({ where: { componentProductId: p.id } })
              for (const b of bomRows) {
                if (b.quantity > 0 && b.quantity < 10) {
                  await db.bomComponent.update({
                    where: { id: b.id },
                    data: { quantity: Math.round(b.quantity * 1000) },
                  })
                }
              }
            }
            initialMap[p.id] = {
              productId: p.id,
              baseUnit: 'gr',
              purchaseUnit: 'kg',
              purchaseRate: 1000,
              sellUnit: 'kg (1.000gr)',
              sellRate: 1000,
              posQuickQuantities: [100, 200, 500, 1000],
              linkedBaseProductId: null,
              updatedAt: new Date().toISOString(),
            }
          } else if (p.sku === 'UD-VL-001') {
            initialMap[p.id] = {
              productId: p.id,
              baseUnit: 'bó',
              purchaseUnit: 'thùng (10 bó)',
              purchaseRate: 10,
              sellUnit: 'bó',
              sellRate: 1,
              posQuickQuantities: [1, 5, 10],
              linkedBaseProductId: null,
              updatedAt: new Date().toISOString(),
            }
          }
        }

        await db.appSetting.create({
          data: {
            key: UNIT_CONVERSIONS_SETTING_KEY,
            value: JSON.stringify(initialMap),
          },
        })
      }
    } catch (err) {
      console.error('ensureUnitConversionsSeeded error:', err)
    }
  })()
  return seededPromise
}

export async function getProductTypesCatalog(): Promise<ProductTypeInfo[]> {
  await ensureUnitConversionsSeeded()
  const row = await db.appSetting.findUnique({ where: { key: PRODUCT_TYPES_SETTING_KEY } })
  if (!row?.value) return DEFAULT_PRODUCT_TYPES
  try {
    const parsed = JSON.parse(row.value)
    if (Array.isArray(parsed) && parsed.length > 0) {
      const byCode = new Map<string, ProductTypeInfo>()
      for (const def of DEFAULT_PRODUCT_TYPES) byCode.set(def.code, def)
      for (const item of parsed) {
        if (item && typeof item.code === 'string') {
          byCode.set(item.code, {
            ...byCode.get(item.code),
            ...item,
          })
        }
      }
      return Array.from(byCode.values())
    }
  } catch {
    // ignore parse error
  }
  return DEFAULT_PRODUCT_TYPES
}

export async function saveProductTypesCatalog(types: ProductTypeInfo[]): Promise<ProductTypeInfo[]> {
  await db.appSetting.upsert({
    where: { key: PRODUCT_TYPES_SETTING_KEY },
    create: { key: PRODUCT_TYPES_SETTING_KEY, value: JSON.stringify(types) },
    update: { value: JSON.stringify(types) },
  })
  return types
}

export async function getAllUnitConfigs(tx?: DbClient): Promise<Record<string, ProductUnitConfig>> {
  await ensureUnitConversionsSeeded()
  const client = (tx ?? db) as PrismaClient
  const row = await client.appSetting.findUnique({ where: { key: UNIT_CONVERSIONS_SETTING_KEY } })
  if (!row?.value) return {}
  try {
    const parsed = JSON.parse(row.value)
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, ProductUnitConfig>
    }
  } catch {
    // ignore
  }
  return {}
}

export async function getProductUnitConfig(productId: string, tx?: DbClient): Promise<ProductUnitConfig | null> {
  const all = await getAllUnitConfigs(tx)
  return all[productId] ?? null
}

export async function saveProductUnitConfig(
  productId: string,
  config: Partial<ProductUnitConfig> & { baseUnit?: string }
): Promise<ProductUnitConfig> {
  const all = await getAllUnitConfigs()
  const prev = all[productId]
  const baseUnit = (config.baseUnit ?? prev?.baseUnit ?? 'sp').trim() || 'sp'
  const purchaseUnit = (config.purchaseUnit ?? prev?.purchaseUnit ?? baseUnit).trim() || baseUnit
  const purchaseRate = Math.max(1, Number(config.purchaseRate ?? prev?.purchaseRate ?? 1) || 1)
  const sellUnit = (config.sellUnit ?? prev?.sellUnit ?? baseUnit).trim() || baseUnit
  const sellRate = Math.max(1, Number(config.sellRate ?? prev?.sellRate ?? 1) || 1)
  const posQuickQuantities = Array.isArray(config.posQuickQuantities)
    ? config.posQuickQuantities.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : prev?.posQuickQuantities ?? (baseUnit === 'gr' ? [100, 200, 500, 1000] : [1])

  const next: ProductUnitConfig = {
    productId,
    baseUnit,
    purchaseUnit,
    purchaseRate,
    sellUnit,
    sellRate,
    posQuickQuantities,
    linkedBaseProductId:
      config.linkedBaseProductId !== undefined ? config.linkedBaseProductId : (prev?.linkedBaseProductId ?? null),
    updatedAt: new Date().toISOString(),
  }

  all[productId] = next
  await db.appSetting.upsert({
    where: { key: UNIT_CONVERSIONS_SETTING_KEY },
    create: { key: UNIT_CONVERSIONS_SETTING_KEY, value: JSON.stringify(all) },
    update: { value: JSON.stringify(all) },
  })

  // Đồng bộ trường unit gốc trên bảng Product
  await db.product.updateMany({
    where: { id: productId },
    data: { unit: baseUnit },
  })

  return next
}

export async function deleteProductUnitConfig(productId: string): Promise<void> {
  const all = await getAllUnitConfigs()
  if (all[productId]) {
    delete all[productId]
    await db.appSetting.upsert({
      where: { key: UNIT_CONVERSIONS_SETTING_KEY },
      create: { key: UNIT_CONVERSIONS_SETTING_KEY, value: JSON.stringify(all) },
      update: { value: JSON.stringify(all) },
    })
  }
}

/**
 * Đồng bộ tồn kho hiển thị của mọi sản phẩm PACKAGED_VARIANT có liên kết tới kho nguyên liệu gốc `baseProductIds`.
 * Ví dụ: Kho gốc còn 9.500 gr -> Hộp 100gr tự nhảy thành 95 hộp; Túi 500gr tự nhảy thành 19 túi.
 */
export async function syncLinkedVariantStocks(tx: DbClient, baseProductIds: string[]): Promise<void> {
  const uniqueBaseIds = Array.from(new Set(baseProductIds.filter(Boolean)))
  if (uniqueBaseIds.length === 0) return
  const client = (tx ?? db) as PrismaClient
  const allConfigs = await getAllUnitConfigs(client)

  for (const baseId of uniqueBaseIds) {
    const baseProd = await client.product.findUnique({
      where: { id: baseId },
      select: { id: true, stock: true },
    })
    if (!baseProd) continue

    const linkedVariants = Object.values(allConfigs).filter(
      (cfg) => cfg.linkedBaseProductId === baseId && cfg.productId !== baseId
    )
    for (const variantCfg of linkedVariants) {
      const rate = Math.max(1, variantCfg.sellRate || 1)
      const availablePackages = Math.max(0, Math.floor(baseProd.stock / rate))
      await client.product.updateMany({
        where: { id: variantCfg.productId },
        data: { stock: availablePackages },
      })
    }
  }
}
