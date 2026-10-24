import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
async function main() {
  // Chuỗi UD-QT-002 (được điều chỉnh xuống 6) & UD-VL-001 (chuỗi dài)
  for (const sku of ['UD-QT-002', 'UD-VL-001']) {
    const p = await db.product.findUnique({ where: { sku } })
    if (!p) continue
    const movs = await db.stockMovement.findMany({ where: { productId: p.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    console.log(`\n=== ${sku} (tồn hiện tại ${p.stock}) — ${movs.length} biến động ===`)
    for (const m of movs) console.log(`${m.createdAt.toISOString()} | ${m.type.padEnd(11)} | qty=${String(m.quantity).padStart(4)} | sau=${String(m.stockAfter).padStart(4)} | ${(m.note||'').slice(0,58)}`)
    // assert monotonic chain
    let bal = 0
    for (const m of movs) { bal += m.quantity; if (bal !== m.stockAfter) throw new Error(`CHAIN BREAK at ${m.id}`) }
    if (bal !== p.stock) throw new Error('END MISMATCH')
    console.log('=> chuỗi hợp lệ, kết thúc đúng tồn thực tế ✓')
  }
  // API view: 10 bản ghi mới nhất UI sẽ thấy
  const latest = await db.stockMovement.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: { product: { select: { sku: true } } } })
  console.log('\n=== 8 movement mới nhất (UI thấy) ===')
  for (const m of latest) console.log(`${m.createdAt.toISOString()} | ${m.product.sku.padEnd(12)} | ${m.type.padEnd(7)} | qty=${String(m.quantity).padStart(3)} | sau=${m.stockAfter}`)
}
main().finally(() => db.$disconnect())
