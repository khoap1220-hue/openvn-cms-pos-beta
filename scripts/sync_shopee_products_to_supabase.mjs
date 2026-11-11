import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('=== ĐỒNG BỘ SẢN PHẨM SHOPEE SELLER CENTER (thaimy1605 - ShopID 197195817) VÀO SUPABASE ===')

  const category = await prisma.category.findFirst({
    where: { slug: 'an-nhien-thach-thach-cao' },
  })
  if (!category) throw new Error('Không tìm thấy danh mục an-nhien-thach-thach-cao')

  const defaultWh = await prisma.warehouse.findFirst({
    where: { isDefault: true },
  })

  const shopeeImages = [
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71nwdv7mdd40',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71ibnlp5ah66',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71iqnwqr5w02',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71ixhm11j73a',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71izoxse8a7c',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71j3dd0tu123',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv71j5k2nqiv6c',
    'https://down-vn.img.susercontent.com/file/vn-11134207-81ztc-mv72ncoff0n531',
  ]

  const description = `Chân nến hoa sen đĩa đựng nến Tealight được đúc thủ công từ composite khoáng, mang lại không gian ấm cúng, thanh tịnh và an tâm khi sử dụng. Hương thơm bơ mộc mạc dịu nhẹ, không khói đen, phù hợp để thư giãn, đọc sách, thưởng trà, dâng hương hoặc thiền định.

Điểm nổi bật 
- Sáp tự nhiên lành tính: Viên nến làm từ bơ thực vật tự nhiên và sáp đậu nành, không pha hương liệu tổng hợp hay chất tạo màu hóa học.
- Hương bơ dịu nhẹ: Mùi thơm béo dịu tự nhiên từ bơ thực vật khi đốt, không gây đau đầu, dễ chịu khi dùng trong phòng kín.
- Bấc cotton không khói đen: Ngọn lửa cháy êm, ổn định, không tạo muội than đen làm bẩn không gian.
- Hũ đúc composite chịu nhiệt: Gia công thủ công từ hỗn hợp khoáng (xi măng trắng SCG, cát thạch anh mịn và thạch cao Hydrostone), lòng hũ phủ 3 lớp Sealer kháng dầu chống thấm ố.

Thiết kế vừa vặn & tiện dụng 
- Lòng hũ đường kính 4.5 cm vừa khít viên Tealight tiêu chuẩn.
- Đốt hết chỉ cần nhấc vỏ nhôm ra thay viên mới; hũ sen sạch đẹp.
- Kích thước phủ bì: đường kính ngoài 9.0 cm x chiều cao 4.5 cm.
- Kích thước lòng hũ: đường kính 4.5 cm x độ sâu 2.5 cm (vừa nến Tealight 3.8 cm).

Thành phần & thông số sản phẩm 
- Thành phần nến: Bơ thực vật tự nhiên + sáp đậu nành (tặng kèm 01 viên).
- Chất liệu chân nến: Composite khoáng chịu nhiệt (xi măng trắng + cát thạch anh + thạch cao).
- Khối lượng sáp: 13 gram (tổng trọng lượng chân sen: ~125 gram).
- Thời gian thắp sáng: Khoảng 3.5 – 4.5 giờ liên tục/viên nến.`

  const attributesJson = JSON.stringify({
    brandLine: 'An Nhiên Thạch · Shopee Sync',
    shopeeItemId: '50521234295',
    shopeeModelId: '431706555933',
    shopeeModelSku: 'BM-SEN-01-TRANG',
    shopeeModelName: 'Trắng Mộc Tự Nhiên',
    shopId: '197195817',
    shopUsername: 'thaimy1605',
    isUnlistedOnShopee: true,
    shopeeStatus: 8,
    dimensions: 'Đường kính ngoài 9.0cm × Cao 4.5cm (Lòng hũ 4.5cm × 2.5cm)',
    weight: '250g (tổng trọng lượng chân sen ~125g + đóng gói)',
    material: 'Composite khoáng chịu nhiệt (xi măng trắng SCG + cát thạch anh + thạch cao Hydrostone)',
    gallery: shopeeImages,
  })

  const sku = 'BM-SEN-01'
  const name =
    'Chân Nến Hoa Sen Đĩa Đựng Nến Tealight Khoáng Composite Đúc Thủ Công Decor Bàn Trà Cúng Phật Thiền Định (Tặng 1 Nến Bơ)'
  const sellPrice = 59000
  const costPrice = 25000
  const stock = 16

  const product = await prisma.product.upsert({
    where: { sku },
    update: {
      name,
      description,
      sellPrice,
      costPrice,
      stock,
      image: shopeeImages[0],
      attributes: attributesJson,
      status: 'ACTIVE',
    },
    create: {
      sku,
      barcode: '8938509934295',
      name,
      description,
      categoryId: category.id,
      costPrice,
      sellPrice,
      stock,
      lowStockThreshold: 5,
      image: shopeeImages[0],
      status: 'ACTIVE',
      attributes: attributesJson,
      unit: 'bộ',
      type: 'SIMPLE',
      fragile: true,
      ownerWarehouseId: defaultWh?.id ?? null,
    },
  })

  console.log(`✅ Đã đồng bộ Product [${product.sku}] (ID: ${product.id}) — Giá: ${product.sellPrice.toLocaleString('vi-VN')}đ — Tồn: ${product.stock}`)

  if (defaultWh) {
    await prisma.warehouseStock.upsert({
      where: {
        warehouseId_productId: {
          warehouseId: defaultWh.id,
          productId: product.id,
        },
      },
      update: { quantity: stock },
      create: {
        warehouseId: defaultWh.id,
        productId: product.id,
        quantity: stock,
      },
    })
    console.log(`✅ Đã đồng bộ WarehouseStock tại ${defaultWh.code} (${defaultWh.name}): ${stock} bộ`)
  }

  const channels = await prisma.channel.findMany({
    where: { key: { in: ['SHOPEE', 'FACEBOOK', 'POS'] } },
  })
  for (const ch of channels) {
    const listingStatus = ch.key === 'SHOPEE' ? 'UNLISTED' : 'ACTIVE'
    await prisma.channelListing.upsert({
      where: {
        productId_channelId: {
          productId: product.id,
          channelId: ch.id,
        },
      },
      update: {
        price: sellPrice,
        status: listingStatus,
        description,
        descriptionSyncedAt: new Date(),
      },
      create: {
        productId: product.id,
        channelId: ch.id,
        price: sellPrice,
        status: listingStatus,
        description,
        descriptionSyncedAt: new Date(),
      },
    })
    if (ch.key === 'SHOPEE') {
      await prisma.channel.update({
        where: { id: ch.id },
        data: { connected: true, syncedAt: new Date() },
      })
    }
  }
  console.log(`✅ Đã tạo/cập nhật ChannelListing cho ${channels.length} kênh (SHOPEE: UNLISTED, FACEBOOK: ACTIVE, POS: ACTIVE)`)

  await prisma.ledgerEntry.create({
    data: {
      scope: 'INVENTORY',
      action: 'SHOPEE_PRODUCT_SYNCED',
      entityType: 'Product',
      entityId: product.id,
      entityCode: product.sku,
      title: `Đồng bộ sản phẩm Shopee [BM-SEN-01] từ Shop thaimy1605 (ID: 197195817)`,
      detail: JSON.stringify({
        shopeeItemId: 50521234295,
        shopeeModelId: 431706555933,
        modelSku: 'BM-SEN-01-TRANG',
        sellPrice,
        stock,
        shopeeStatus: 'UNLISTED (status=8)',
      }),
      actor: 'SYSTEM',
      originSource: 'MARKETPLACE_SYNC',
    },
  })
  console.log('✅ Đã ghi LedgerEntry kiểm toán trên Supabase PostgreSQL!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
