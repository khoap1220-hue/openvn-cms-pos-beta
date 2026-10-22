import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// Deterministic PRNG for reproducible seeds
let seedState = 42
function rand() {
  seedState = (seedState * 1103515245 + 12345) % 2147483648
  return seedState / 2147483648
}
function randInt(min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)]
}

const CHANNELS = [
  { key: 'SHOPEE', name: 'Shopee', color: '#EE4D2D', feePercent: 8.5, connected: true },
  { key: 'LAZADA', name: 'Lazada', color: '#0F146D', feePercent: 7.0, connected: true },
  { key: 'TIKTOK', name: 'TikTok Shop', color: '#FE2C55', feePercent: 6.0, connected: true },
  { key: 'TIKI', name: 'Tiki', color: '#189D0E', feePercent: 7.5, connected: true },
  { key: 'WEBSITE', name: 'Website riêng', color: '#10B981', feePercent: 0, connected: true },
  { key: 'FACEBOOK', name: 'Facebook', color: '#1877F2', feePercent: 0, connected: false },
  { key: 'POS', name: 'Cửa hàng (POS)', color: '#F59E0B', feePercent: 0, connected: true },
]

const CATEGORIES = [
  { name: 'Thời trang nữ', slug: 'thoi-trang-nu' },
  { name: 'Thời trang nam', slug: 'thoi-trang-nam' },
  { name: 'Phụ kiện', slug: 'phu-kien' },
  { name: 'Mỹ phẩm', slug: 'my-pham' },
  { name: 'Giày dép', slug: 'giay-dep' },
  { name: 'Nhà cửa & Đời sống', slug: 'nha-cua-doi-song' },
]

const PRODUCTS: Array<{
  sku: string
  name: string
  category: string
  costPrice: number
  sellPrice: number
  stock: number
  lowStockThreshold?: number
  description?: string
}> = [
  { sku: 'AO-NU-001', name: 'Áo sơ mi lụa nữ tay phồng', category: 'thoi-trang-nu', costPrice: 145000, sellPrice: 289000, stock: 142, description: 'Áo sơ mi lụa cao cấp, thiết kế thanh lịch phù hợp đi làm.' },
  { sku: 'AO-NU-002', name: 'Đầm voan hoa tiểu thư', category: 'thoi-trang-nu', costPrice: 260000, sellPrice: 489000, stock: 67 },
  { sku: 'AO-NU-003', name: 'Áo thun cotton nữ basic', category: 'thoi-trang-nu', costPrice: 68000, sellPrice: 145000, stock: 320 },
  { sku: 'QUAN-NU-001', name: 'Quần jeans nữ ống suông cao cấp', category: 'thoi-trang-nu', costPrice: 198000, sellPrice: 369000, stock: 88 },
  { sku: 'QUAN-NU-002', name: 'Chân váy tennis nữ', category: 'thoi-trang-nu', costPrice: 120000, sellPrice: 249000, stock: 12 },
  { sku: 'AO-NAM-001', name: 'Áo polo pique nam cao cấp', category: 'thoi-trang-nam', costPrice: 155000, sellPrice: 299000, stock: 176 },
  { sku: 'AO-NAM-002', name: 'Áo sơ mi nam kẻ sọc công sở', category: 'thoi-trang-nam', costPrice: 175000, sellPrice: 329000, stock: 95 },
  { sku: 'AO-NAM-003', name: 'Áo thun nam form rộng unisex', category: 'thoi-trang-nam', costPrice: 72000, sellPrice: 159000, stock: 8 },
  { sku: 'QUAN-NAM-001', name: 'Quần kaki nam slim fit', category: 'thoi-trang-nam', costPrice: 168000, sellPrice: 315000, stock: 74 },
  { sku: 'PK-TUI-001', name: 'Túi xách da nữ thời thượng', category: 'phu-kien', costPrice: 285000, sellPrice: 559000, stock: 45 },
  { sku: 'PK-TUI-002', name: 'Balo laptop chống nước', category: 'phu-kien', costPrice: 195000, sellPrice: 389000, stock: 63 },
  { sku: 'PK-VOI-001', name: 'Ví da nam cầm tay', category: 'phu-kien', costPrice: 135000, sellPrice: 279000, stock: 4 },
  { sku: 'PK-MK-001', name: 'Mắt kính thời trang unisex', category: 'phu-kien', costPrice: 89000, sellPrice: 219000, stock: 110 },
  { sku: 'PK-DOC-001', name: 'Đồng hồ nữ dây da sang trọng', category: 'phu-kien', costPrice: 320000, sellPrice: 689000, stock: 28 },
  { sku: 'PK-NON-001', name: 'Nón len tai thỏ nữ', category: 'phu-kien', costPrice: 45000, sellPrice: 119000, stock: 156 },
  { sku: 'MP-SON-001', name: 'Son kem lì hoàn mỹ', category: 'my-pham', costPrice: 85000, sellPrice: 189000, stock: 240 },
  { sku: 'MP-KCN-001', name: 'Kem chống nắng SPF50+PA++++', category: 'my-pham', costPrice: 128000, sellPrice: 265000, stock: 182 },
  { sku: 'MP-TT-001', name: 'Serum vitamin C dưỡng sáng da', category: 'my-pham', costPrice: 155000, sellPrice: 329000, stock: 3 },
  { sku: 'MP-NM-001', name: 'Nước hoa hồng làm dịu da', category: 'my-pham', costPrice: 95000, sellPrice: 199000, stock: 97 },
  { sku: 'GY-NU-001', name: 'Sneaker nữ cổ thấp dễ thương', category: 'giay-dep', costPrice: 225000, sellPrice: 449000, stock: 58 },
  { sku: 'GY-NAM-001', name: 'Giày thể thao nam chạy bộ', category: 'giay-dep', costPrice: 265000, sellPrice: 519000, stock: 41 },
  { sku: 'GY-DEP-001', name: 'Dép sandal nam mùa hè', category: 'giay-dep', costPrice: 65000, sellPrice: 145000, stock: 203 },
  { sku: 'GY-CAO-001', name: 'Giày cao gót mũi nhọn nữ', category: 'giay-dep', costPrice: 245000, sellPrice: 489000, stock: 33 },
  { sku: 'NC-DEP-001', name: 'Bộ chăn ga gối cotton chống khuẩn', category: 'nha-cua-doi-song', costPrice: 385000, sellPrice: 749000, stock: 25 },
  { sku: 'NC-GOM-001', name: 'Bộ 4 ly thuỷ tinh cao cấp', category: 'nha-cua-doi-song', costPrice: 115000, sellPrice: 239000, stock: 82 },
  { sku: 'NC-DEN-001', name: 'Đèn bàn LED thông minh 3 chế độ', category: 'nha-cua-doi-song', costPrice: 145000, sellPrice: 299000, stock: 9 },
  { sku: 'NC-LO-001', name: 'Lọ hoa thuỷ tinh trang trí', category: 'nha-cua-doi-song', costPrice: 75000, sellPrice: 165000, stock: 64 },
  { sku: 'AO-NU-004', name: 'Áo cardigan len nữ mùa đông', category: 'thoi-trang-nu', costPrice: 185000, sellPrice: 359000, stock: 51 },
  { sku: 'PK-DAY-001', name: 'Dây chuyền bạc nữ đính đá', category: 'phu-kien', costPrice: 165000, sellPrice: 349000, stock: 39 },
  { sku: 'GY-NAM-002', name: 'Giày lười da nam công sở', category: 'giay-dep', costPrice: 285000, sellPrice: 569000, stock: 22 },
]

const CUSTOMERS = [
  'Nguyễn Thị Hương', 'Trần Văn Nam', 'Lê Minh Anh', 'Phạm Thu Trang', 'Hoàng Gia Bảo',
  'Vũ Ngọc Linh', 'Đặng Quốc Huy', 'Bùi Mai Phương', 'Ngô Thanh Tùng', 'Dương Thùy Dung',
  'Lý Tuấn Kiệt', 'Phan Ngọc Diệp', 'Trịnh Công Dũng', 'Chu Khánh Vy', 'Tạ Đức Anh',
  'Cao Mỹ Duyên', 'Đỗ Hữu Phước', 'Bùi Thanh Hà',
]

const STREETS = ['Nguyễn Huệ', 'Lê Lợi', 'Trần Hưng Đạo', 'Bạch Đằng', 'Nguyễn Trãi', 'Phạm Ngũ Lão', 'Võ Văn Tần', 'Cách Mạng Tháng Tám']
const CITIES = ['Hà Nội', 'TP. Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Cần Thơ', 'Bình Dương', 'Đồng Nai', 'Khánh Hoà']
const PAYMENTS = ['COD', 'BANKING', 'MOMO', 'CARD']
const PAYMENT_WEIGHT = ['COD', 'COD', 'BANKING', 'BANKING', 'MOMO', 'CARD']
const NOTE_POOL = ['Giao giờ hành chính', 'Gọi xác nhận trước khi giao', 'Đổi size nếu không vừa', 'Quà tặng, xin gói đẹp', '']

async function main() {
  console.log('🌱 Seeding OmniSales CMS...')

  // Clean existing data (order matters for FK)
  await db.stockMovement.deleteMany()
  await db.orderItem.deleteMany()
  await db.order.deleteMany()
  await db.channelListing.deleteMany()
  await db.product.deleteMany()
  await db.category.deleteMany()
  await db.channel.deleteMany()
  await db.customer.deleteMany()

  // 1. Channels
  const channels = await Promise.all(
    CHANNELS.map((c) =>
      db.channel.create({
        data: { key: c.key, name: c.name, color: c.color, feePercent: c.feePercent, connected: c.connected, syncedAt: new Date() },
      })
    )
  )
  const activeChannels = channels.filter((c) => c.connected)

  // 2. Categories
  const catMap = new Map<string, string>()
  for (const c of CATEGORIES) {
    const cat = await db.category.create({ data: c })
    catMap.set(c.slug, cat.id)
  }

  // 3. Products + initial stock movements
  const productIds: string[] = []
  for (const p of PRODUCTS) {
    const prod = await db.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        description: p.description ?? `${p.name} — sản phẩm chất lượng cao, nguồn gốc rõ ràng, bảo hành chính hãng.`,
        categoryId: catMap.get(p.category),
        costPrice: p.costPrice,
        sellPrice: p.sellPrice,
        stock: p.stock,
        lowStockThreshold: p.lowStockThreshold ?? 10,
        status: 'ACTIVE',
      },
    })
    productIds.push(prod.id)
    await db.stockMovement.create({
      data: {
        productId: prod.id,
        type: 'IMPORT',
        quantity: p.stock,
        stockAfter: p.stock,
        note: 'Nhập kho đầu kỳ',
        createdAt: new Date(Date.now() - 31 * 86400000),
      },
    })
  }

  // 4. Channel listings: each product listed on 3-5 connected channels with price variance
  for (const pid of productIds) {
    const shuffled = [...activeChannels].sort(() => rand() - 0.5)
    const count = randInt(3, Math.min(5, shuffled.length))
    for (const ch of shuffled.slice(0, count)) {
      const product = PRODUCTS[productIds.indexOf(pid)]
      const variance = ch.key === 'SHOPEE' || ch.key === 'TIKTOK' ? [0, 0, 0.03, 0.05][randInt(0, 3)] : [0, 0.02, -0.02][randInt(0, 2)]
      await db.channelListing.create({
        data: {
          productId: pid,
          channelId: ch.id,
          price: Math.round((product.sellPrice * (1 + variance)) / 1000) * 1000,
          status: 'ACTIVE',
        },
      })
    }
  }

  // 5. Customers
  const customers = await Promise.all(
    CUSTOMERS.map((name, i) =>
      db.customer.create({
        data: {
          name,
          phone: `09${randInt(10000000, 99999999)}`,
          email: `khach${i + 1}@gmail.com`,
          address: `${randInt(1, 200)} ${pick(STREETS)}, ${pick(CITIES)}`,
        },
      })
    )
  )

  // 6. Orders across last 30 days (growth trend: recent days more orders)
  const statuses = ['COMPLETED', 'COMPLETED', 'COMPLETED', 'COMPLETED', 'SHIPPING', 'SHIPPING', 'PACKING', 'CONFIRMED', 'PENDING', 'CANCELLED']
  let orderSeq = 0
  const now = Date.now()

  for (let dayAgo = 30; dayAgo >= 0; dayAgo--) {
    // Trend: 1-3 orders/day 30 days ago → 4-8 orders/day recent
    const base = 1 + Math.round(((30 - dayAgo) / 30) * 5)
    const ordersToday = randInt(base, base + 3)
    for (let j = 0; j < ordersToday; j++) {
      orderSeq++
      const createdAt = new Date(now - dayAgo * 86400000 + randInt(7, 21) * 3600000 + randInt(0, 59) * 60000)
      if (createdAt > new Date()) continue

      const channel = pick(activeChannels)
      const itemCount = randInt(1, 3)
      const chosen = [...productIds].sort(() => rand() - 0.5).slice(0, itemCount)
      let subtotal = 0
      const items: Array<{ productId: string; quantity: number; price: number }> = []
      for (const pid of chosen) {
        const product = PRODUCTS[productIds.indexOf(pid)]
        const qty = randInt(1, 3)
        // channel-specific price when available
        const listing = await db.channelListing.findFirst({ where: { productId: pid, channelId: channel.id } })
        const price = listing?.price ?? product.sellPrice
        subtotal += price * qty
        items.push({ productId: pid, quantity: qty, price })
      }
      const shippingFee = subtotal >= 500000 ? 0 : randInt(1, 6) * 5000
      const status = dayAgo === 0 ? pick(['PENDING', 'PENDING', 'CONFIRMED', 'PACKING', 'SHIPPING']) : pick(statuses)
      const paymentMethod = pick(PAYMENT_WEIGHT)
      const customer = pick(customers)
      const d = createdAt
      const code = `DH${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(orderSeq).padStart(4, '0')}`

      const order = await db.order.create({
        data: {
          code,
          customerId: customer.id,
          channelId: channel.id,
          status,
          paymentMethod,
          paymentStatus: status === 'COMPLETED' ? 'PAID' : paymentMethod === 'COD' ? 'UNPAID' : pick(['PAID', 'UNPAID']),
          subtotal,
          shippingFee,
          total: subtotal + shippingFee,
          address: customer.address,
          note: pick(NOTE_POOL),
          createdAt,
          updatedAt: createdAt,
          items: { create: items },
        },
      })

      // Stock movements for some orders (simulate export)
      if (status !== 'CANCELLED' && rand() > 0.5) {
        for (const it of items) {
          const prod = await db.product.findUnique({ where: { id: it.productId } })
          if (prod && prod.stock >= it.quantity) {
            const after = prod.stock - it.quantity
            await db.product.update({ where: { id: prod.id }, data: { stock: after } })
            await db.stockMovement.create({
              data: { productId: prod.id, type: 'EXPORT', quantity: -it.quantity, stockAfter: after, note: `Xuất kho cho đơn ${code}`, createdAt },
            })
          }
        }
      }
    }
  }

  const counts = {
    channels: await db.channel.count(),
    categories: await db.category.count(),
    products: await db.product.count(),
    listings: await db.channelListing.count(),
    customers: await db.customer.count(),
    orders: await db.order.count(),
    movements: await db.stockMovement.count(),
  }
  console.log('✅ Seed hoàn tất:', counts)
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
