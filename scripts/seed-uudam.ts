/**
 * Seed sản phẩm THẬT của shop ƯU ĐÀM (uudam.vn — Shopee) vào app.
 * Nguồn dữ liệu: ảnh sản phẩm có brand "ƯU ĐÀM" index từ Shopee (image-search + VLM).
 * Chạy: bun scripts/seed-uudam.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/** Kiểm tra chữ số EAN-13 */
function ean13(base12: string): string {
  const digits = base12.split('').map(Number)
  let sum = 0
  digits.forEach((d, i) => (sum += i % 2 === 0 ? d : d * 3))
  const check = (10 - (sum % 10)) % 10
  return base12 + String(check)
}

const NEN = 'Nến & Xông hương'
const TRA = 'Trà & Ấm trà'
const QUA = 'Quà tặng & Tranh'

type SeedProduct = {
  sku: string
  name: string
  category: string
  unit: string
  cost: number
  sell: number
  stock: number
  barcodeBase: string // 12 số, tự tính check digit
  image?: string | null
  description: string
  attributes: string
}

const PRODUCTS: SeedProduct[] = [
  {
    sku: 'UD-NEN-001',
    name: 'Nến bơ Udumbara hũ thủy tinh (Butter Candle)',
    category: NEN,
    unit: 'cái',
    cost: 55000,
    sell: 129000,
    stock: 120,
    barcodeBase: '893604400001',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f1f9aa4fc950.jpg',
    description: 'Nến bơ Udumbara đặc trưng của shop, sáp bơ mịn đốt sạch, hũ thủy tinh tái sử dụng.',
    attributes: 'Sáp bơ tự nhiên / hũ thủy tinh / thời gian đốt ~20h',
  },
  {
    sku: 'UD-NEN-002',
    name: 'Hũ nến thủy tinh hoa sen (ly đựng nến)',
    category: NEN,
    unit: 'cái',
    cost: 22000,
    sell: 45000,
    stock: 260,
    barcodeBase: '893604400002',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a1aaeeb81709.jpg',
    description: 'Hũ thủy tinh trong họa tiết hoa sen, dùng đựng nến thơm hoặc trang trí bàn thờ, bàn trà.',
    attributes: 'Thủy tinh trong / hoa văn hoa sen / chịu nhiệt',
  },
  {
    sku: 'UD-SAP-001',
    name: 'Hạt sáp nến đậu nành Soy Wax (nguyên liệu)',
    category: NEN,
    unit: 'kg',
    cost: 52000,
    sell: 85000,
    stock: 85,
    barcodeBase: '893604400003',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/278762f8ee38.jpg',
    description: 'Hạt sáp đậu nành 100% tự nhiên, làm nến thơm thủ công, đốt sạch ít bồ hóng.',
    attributes: 'Soy wax 100% / dạng hạt / điểm chảy thấp',
  },
  {
    sku: 'UD-SAP-002',
    name: 'Sáp nến tinh khiết dạng khối (nguyên liệu)',
    category: NEN,
    unit: 'kg',
    cost: 58000,
    sell: 95000,
    stock: 40,
    barcodeBase: '893604400004',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f90f2496af1b.jpg',
    description: 'Sáp nến tinh khiết dạng khối kết tinh đẹp, dành cho nến nghệ thuật và nến cứng.',
    attributes: 'Sáp tinh khiết / dạng khối / kết tinh trong',
  },
  {
    sku: 'UD-DEN-001',
    name: 'Đèn xông tinh dầu nến thủy tinh cổ điển',
    category: NEN,
    unit: 'cái',
    cost: 105000,
    sell: 189000,
    stock: 45,
    barcodeBase: '893604400005',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/f0df95c573a3.jpg',
    description: 'Đèn xông tinh dầu bằng nến tea-light, thân thủy tinh khói sang trọng, đế gỗ tự nhiên.',
    attributes: 'Thủy tinh khói / đế gỗ / dùng nến tea-light',
  },
  {
    sku: 'UD-TRA-001',
    name: 'Bộ ấm trà gốm men lam hoa văn cổ điển',
    category: TRA,
    unit: 'bộ',
    cost: 195000,
    sell: 350000,
    stock: 25,
    barcodeBase: '893604400006',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/4869e1f68625.jpg',
    description: 'Ấm trà gốm men lam trắng hoa văn cổ điển, quai dây rattan chống nóng, nắp đậy kín.',
    attributes: 'Gốm men lam / quai dây / ~600ml',
  },
  {
    sku: 'UD-TRA-002',
    name: 'Bình pha trà thủy tinh có lọc và nắp đậy',
    category: TRA,
    unit: 'cái',
    cost: 140000,
    sell: 250000,
    stock: 30,
    barcodeBase: '893604400007',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d41c0085c9a8.jpg',
    description: 'Bình pha trà thủy tinh trong suốt, lót lọc thép không gỉ, ngắm lá trà tỏa đẹp.',
    attributes: 'Thủy tinh chịu nhiệt / lọc inox / ~750ml',
  },
  {
    sku: 'UD-TRA-003',
    name: 'Hũ trà gốm nắp gỗ chữ Hán phong cách Zen',
    category: TRA,
    unit: 'cái',
    cost: 48000,
    sell: 89000,
    stock: 60,
    barcodeBase: '893604400008',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ecba3f9b86ea.jpg',
    description: 'Hũ đựng trà gốm thủ công nắp gỗ, đề chữ Hán tùy chọn (Zen, Thanh Hưu, Thiền Trà...).',
    attributes: 'Gốm thủ công / nắp gỗ / nhiều mẫu chữ',
  },
  {
    sku: 'UD-QT-001',
    name: 'Hộp quà tặng trà sơn thủy kèm 2 hũ gốm',
    category: QUA,
    unit: 'bộ',
    cost: 260000,
    sell: 450000,
    stock: 15,
    barcodeBase: '893604400009',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/a5e94cf6b087.jpg',
    description: 'Bộ quà tặng trà cao cấp: túi giấy sơn thủy, hộp gỗ và 2 hũ gốm đựng trà — biếu tặng sang trọng.',
    attributes: 'Bộ gồm túi giấy + hộp gỗ + 2 hũ gốm',
  },
  {
    sku: 'UD-QT-002',
    name: 'Tranh gốm hoa mẫu đơn chim vàng treo tường',
    category: QUA,
    unit: 'cái',
    cost: 190000,
    sell: 350000,
    stock: 12,
    barcodeBase: '893604400010',
    image: 'https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/86e41413d827.jpg',
    description: 'Tranh gốm sứ phủ relief hoa mẫu đơn chim vàng, khung gỗ treo tường — quà tặng, trang trí nhà.',
    attributes: 'Gốm sứ relief / khung gỗ / ~40x60cm',
  },
  {
    sku: 'UD-VL-001',
    name: 'Dây bấc nến cotton có sáp (bó 100 cây)',
    category: NEN,
    unit: 'bó',
    cost: 18000,
    sell: 32000,
    stock: 150,
    barcodeBase: '893604400011',
    image: null,
    description: 'Dây bấc cotton tẩm sáp sẵn, cháy đều không khói, dùng làm nến thủ công.',
    attributes: 'Cotton tẩm sáp / bó 100 cây / nhiều cỡ',
  },
]

async function main() {
  console.log('== Seed Ưu Đàm (uudam.vn) ==')

  // 1) Danh mục
  const catMap = new Map<string, string>()
  for (const name of [NEN, TRA, QUA]) {
    const slug =
      name === NEN ? 'nen-xong-huong' : name === TRA ? 'tra-am-tra' : 'qua-tang-tranh'
    const cat = await db.category.upsert({
      where: { slug },
      update: { name },
      create: { name, slug },
    })
    catMap.set(name, cat.id)
    console.log('category:', cat.name, cat.id)
  }

  // 2) Sản phẩm
  for (const p of PRODUCTS) {
    const barcode = ean13(p.barcodeBase)
    const data = {
      name: p.name,
      description: p.description,
      categoryId: catMap.get(p.category)!,
      costPrice: p.cost,
      sellPrice: p.sell,
      stock: p.stock,
      lowStockThreshold: 10,
      image: p.image,
      attributes: p.attributes,
      unit: p.unit,
      barcode,
      status: 'ACTIVE',
    }
    const existing = await db.product.findUnique({ where: { sku: p.sku } })
    if (existing) {
      await db.product.update({ where: { sku: p.sku }, data })
      console.log('updated product:', p.sku, '|', p.name)
      continue
    }
    const created = await db.product.create({ data: { sku: p.sku, ...data } })
    await db.stockMovement.create({
      data: {
        productId: created.id,
        type: 'IMPORT',
        quantity: p.stock,
        stockAfter: p.stock,
        note: 'Nhập tồn đầu kỳ — seed danh mục shop Ưu Đàm (uudam.vn)',
      },
    })
    console.log('created product:', p.sku, '| barcode', barcode, '|', p.name)
  }

  // 3) BOM định mức: 1 Nến bơ Udumbara = 0.25kg sáp hạt + 1 hũ sen + 1 dây bấc
  const fin = await db.product.findUnique({ where: { sku: 'UD-NEN-001' } })
  const sap = await db.product.findUnique({ where: { sku: 'UD-SAP-001' } })
  const hu = await db.product.findUnique({ where: { sku: 'UD-NEN-002' } })
  const bac = await db.product.findUnique({ where: { sku: 'UD-VL-001' } })
  if (fin && sap && hu && bac) {
    const bom = [
      { componentProductId: sap.id, quantity: 0.25 },
      { componentProductId: hu.id, quantity: 1 },
      { componentProductId: bac.id, quantity: 1 },
    ]
    for (const b of bom) {
      await db.bomComponent.upsert({
        where: {
          productId_componentProductId: { productId: fin.id, componentProductId: b.componentProductId },
        },
        update: { quantity: b.quantity },
        create: { productId: fin.id, componentProductId: b.componentProductId, quantity: b.quantity },
      })
    }
    console.log('BOM: 1 x UD-NEN-001 = 0.25kg UD-SAP-001 + 1 UD-NEN-002 + 1 UD-VL-001')
  }

  // 4) Thông tin đơn vị trên hóa đơn = shop của khách
  await db.appSetting.upsert({
    where: { key: 'company_name' },
    update: { value: 'Hộ kinh doanh Ưu Đàm (uudam.vn)' },
    create: { key: 'company_name', value: 'Hộ kinh doanh Ưu Đàm (uudam.vn)' },
  })
  console.log('company_name -> Hộ kinh doanh Ưu Đàm (uudam.vn)')

  console.log('== DONE ==')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
