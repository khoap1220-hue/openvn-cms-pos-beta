/**
 * Dọn lịch sử biến động kho của SP demo cũ (không phải Ưu Đàm) và sinh lại
 * movement XUẤT kho cho các đơn hàng đã chuyển sang SP Ưu Đàm — để Dashboard
 * (FR-DB-08 Chi tiết biến động sản phẩm) đúng ngữ cảnh ngành hàng nến/trà/gốm.
 *
 * Lưu ý: Sổ Data (LedgerEntry) vẫn giữ nguyên toàn bộ dấu vết audit.
 * Chạy: bun scripts/migrate-movements-uudam.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('== Dọn lịch sử kho demo cũ + sinh lại xuất kho UD ==')

  // 1) Xóa movement của SP demo cũ (ngoài UD-)
  const del = await db.stockMovement.deleteMany({ where: { product: { sku: { not: { startsWith: 'UD-' } } } } })
  console.log('1) Đã xóa', del.count, 'movement cũ')

  // 2) Với mỗi đơn hàng (items = UD): nếu chưa có movement "Xuất kho cho đơn {code}" cho SP trong đơn → sinh lại
  const orders = await db.order.findMany({ include: { items: true } })
  let created = 0
  for (const o of orders) {
    if (o.items.length === 0) continue
    const existing = await db.stockMovement.findMany({
      where: { note: `Xuất kho cho đơn ${o.code}` },
      select: { productId: true, quantity: true },
    })
    const have = new Set(existing.map((m) => `${m.productId}:${m.quantity}`))
    const missing = o.items.filter((it) => !have.has(`${it.productId}:${-it.quantity}`))
    for (const it of missing) {
      const p = await db.product.findUnique({ where: { id: it.productId }, select: { stock: true } })
      if (!p) continue
      await db.stockMovement.create({
        data: {
          productId: it.productId,
          type: 'EXPORT',
          quantity: -it.quantity,
          stockAfter: p.stock,
          note: `Xuất kho cho đơn ${o.code}`,
          createdAt: o.createdAt,
        },
      })
      created++
    }
  }
  console.log('2) Đã sinh lại', created, 'movement xuất kho cho đơn UD')

  // 3) Sổ Data
  await db.ledgerEntry.create({
    data: {
      scope: 'INVENTORY',
      action: 'MOVEMENT_HISTORY_MIGRATED',
      title: `Đồng bộ lịch sử kho với danh mục Ưu Đàm: xóa ${del.count} movement SP demo cũ, sinh lại ${created} movement xuất kho`,
      entityType: 'MIGRATION',
      entityCode: 'UUDAM.VN',
      detail: JSON.stringify({ deleted: del.count, recreated: created }),
      actor: 'OPERATOR',
    },
  })
  console.log('== DONE ==')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
