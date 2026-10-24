/**
 * Dọn sạch sản phẩm demo cũ (không thuộc danh mục Ưu Đàm UD-) và tính lại
 * chuỗi "Tồn sau" (stockAfter) của lịch sử biến động kho theo đúng trình tự thời gian.
 *
 * Các bước:
 *  1) Điều chỉnh tồn kho 2 SP UD xuống dưới ngưỡng để test cảnh báo tồn kho thấp:
 *     UD-QT-002 (Tranh gốm) 12 → 6, UD-QT-001 (Hộp quà) 15 → 8 (movement ADJUST + Sổ Data).
 *  2) Trỏ lại 6 dòng hàng hóa đơn mua/bán đang tham chiếu SP demo → SP UD thật,
 *     tính lại subtotal/VAT/total cho khớp (giữ nguyên hóa đơn, không mất chứng từ).
 *  3) Xóa toàn bộ SP demo non-UD (cascade: ChannelListing, StockMovement, BomComponent)
 *     + dọn danh mục trống sau khi xóa.
 *  4) Tính lại chuỗi tồn sau: đẩy movement "Nhập tồn đầu kỳ" về trước biến động sớm nhất
 *     của từng SP, hiệu chỉnh số lượng nhập đầu kỳ = tồn hiện tại − Σ(các biến động khác),
 *     rồi đi tuần theo thời gian để stockAfter kết thúc đúng bằng tồn kho thực tế.
 *  5) Ghi Sổ Data (LedgerEntry) cho toàn bộ thao tác.
 *
 * Chạy: bun scripts/cleanup-demo-and-recalc.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  const now = new Date()

  // ============ PHASE 1: Điều chỉnh tồn kho 2 SP UD để test cảnh báo ============
  console.log('== PHASE 1: Điều chỉnh tồn kho UD-QT-002 / UD-QT-001 xuống dưới ngưỡng ==')
  const adjustments: Array<{ sku: string; newStock: number; reason: string }> = [
    { sku: 'UD-QT-002', newStock: 6, reason: 'Điều chỉnh kiểm kê — phát hiện hư hỏng khi vận chuyển, hạ 6/tranh' },
    { sku: 'UD-QT-001', newStock: 8, reason: 'Điều chỉnh kiểm kê — đối chiếu quét kho thiếu 8/hộp quà' },
  ]
  for (const adj of adjustments) {
    const p = await db.product.findUnique({ where: { sku: adj.sku } })
    if (!p) throw new Error(`Không tìm thấy ${adj.sku}`)
    const delta = adj.newStock - p.stock
    if (delta === 0) {
      console.log(`   ${adj.sku} đã ở ${p.stock}, bỏ qua`)
      continue
    }
    await db.product.update({ where: { id: p.id }, data: { stock: adj.newStock } })
    await db.stockMovement.create({
      data: {
        productId: p.id,
        type: 'ADJUST',
        quantity: delta,
        stockAfter: adj.newStock,
        note: adj.reason,
        createdAt: now,
      },
    })
    const qtyText = delta >= 0 ? `+${delta}` : `${delta}`
    await db.ledgerEntry.create({
      data: {
        scope: 'INVENTORY',
        action: 'STOCK_ADJUST',
        entityType: 'Product',
        entityId: p.id,
        entityCode: p.sku,
        title: `Điều chỉnh kho ${p.sku} ${qtyText}`,
        detail: JSON.stringify({ stockAfter: adj.newStock, note: adj.reason, prevStock: p.stock }),
        actor: 'OPERATOR',
        createdAt: now,
      },
    })
    console.log(`   ${adj.sku}: ${p.stock} → ${adj.newStock} (movement ADJUST ${qtyText})`)
  }

  // ============ PHASE 2: Trỏ lại dòng hàng hóa đơn demo → SP UD thật ============
  console.log('== PHASE 2: Trỏ lại 6 dòng hàng hóa đơn mua/bán từ SP demo → SP Ưu Đàm ==')
  const repointPlan: Array<{
    code: string
    kind: 'sales' | 'purchase'
    fromSku: string
    toSku: string
  }> = [
    { code: 'PXK261023-0001', kind: 'sales', fromSku: 'AO-NU-004', toSku: 'UD-QT-001' },
    { code: 'PXK261024-0001', kind: 'sales', fromSku: 'VLT-NUT-001', toSku: 'UD-SAP-002' },
    { code: 'PXK261024-0002', kind: 'sales', fromSku: 'VLT-NUT-001', toSku: 'UD-SAP-001' },
    { code: 'PXK261024-0004', kind: 'sales', fromSku: 'AO-NU-001', toSku: 'UD-DEN-001' },
    { code: 'PMM261023-0001', kind: 'purchase', fromSku: 'GY-NAM-002', toSku: 'UD-TRA-001' },
    { code: 'PMM261023-0002', kind: 'purchase', fromSku: 'MP-TT-001', toSku: 'UD-SAP-001' },
  ]
  for (const rp of repointPlan) {
    const from = await db.product.findUnique({ where: { sku: rp.fromSku }, select: { id: true } })
    if (!from) throw new Error(`Không tìm thấy SP nguồn ${rp.fromSku}`)
    const to = await db.product.findUnique({ where: { sku: rp.toSku } })
    if (!to) throw new Error(`Không tìm thấy SP đích ${rp.toSku}`)
    const newPrice = rp.kind === 'sales' ? to.sellPrice : to.costPrice

    if (rp.kind === 'sales') {
      const inv = await db.salesInvoice.findUnique({ where: { code: rp.code }, include: { items: true } })
      if (!inv) throw new Error(`Không tìm thấy hóa đơn bán ${rp.code}`)
      const items = inv.items.map((it) => {
        if (it.productId !== from.id) return it
        return { ...it, productId: to.id, unitPrice: newPrice, amount: Math.round(it.quantity * newPrice) }
      })
      const repointed = items.some((it, i) => it !== inv.items[i])
      if (!repointed) {
        console.log(`   ${inv.code}: đã trỏ từ trước, bỏ qua`)
        continue
      }
      const subtotal = Math.round(items.reduce((s, i) => s + i.amount, 0))
      const vatAmount = Math.round((subtotal * inv.vatRate) / 100)
      const total = subtotal + vatAmount
      for (const it of items) {
        await db.salesInvoiceItem.update({ where: { id: it.id }, data: { productId: it.productId, unitPrice: it.unitPrice, amount: it.amount } })
      }
      await db.salesInvoice.update({ where: { id: inv.id }, data: { subtotal, vatAmount, total } })
      await db.ledgerEntry.create({
        data: {
          scope: 'INVOICE',
          action: 'SALES_INVOICE_REPOINTED',
          entityType: 'SalesInvoice',
          entityId: inv.id,
          entityCode: inv.code,
          title: `Hóa đơn bán ${inv.code} chuyển sang hàng Ưu Đàm (${rp.fromSku} → ${rp.toSku})`,
          detail: JSON.stringify({ subtotal, vatRate: inv.vatRate, vatAmount, total }),
          actor: 'OPERATOR',
          createdAt: now,
        },
      })
      console.log(`   ${inv.code}: ${rp.fromSku} → ${rp.toSku} @${newPrice} | total ${total.toLocaleString('vi-VN')}₫`)
    } else {
      const inv = await db.purchaseInvoice.findUnique({ where: { code: rp.code }, include: { items: true } })
      if (!inv) throw new Error(`Không tìm thấy hóa đơn mua ${rp.code}`)
      const items = inv.items.map((it) => {
        if (it.productId !== from.id) return it
        return { ...it, productId: to.id, unitPrice: newPrice, amount: Math.round(it.quantity * newPrice) }
      })
      const repointed = items.some((it, i) => it !== inv.items[i])
      if (!repointed) {
        console.log(`   ${inv.code}: đã trỏ từ trước, bỏ qua`)
        continue
      }
      const subtotal = Math.round(items.reduce((s, i) => s + i.amount, 0))
      const vatAmount = Math.round((subtotal * inv.vatRate) / 100)
      const total = subtotal + vatAmount
      for (const it of items) {
        await db.purchaseInvoiceItem.update({ where: { id: it.id }, data: { productId: it.productId, unitPrice: it.unitPrice, amount: it.amount } })
      }
      await db.purchaseInvoice.update({ where: { id: inv.id }, data: { subtotal, vatAmount, total } })
      await db.ledgerEntry.create({
        data: {
          scope: 'INVOICE',
          action: 'PURCHASE_INVOICE_REPOINTED',
          entityType: 'PurchaseInvoice',
          entityId: inv.id,
          entityCode: inv.code,
          title: `Hóa đơn mua ${inv.code} chuyển sang hàng Ưu Đàm (${rp.fromSku} → ${rp.toSku})`,
          detail: JSON.stringify({ subtotal, vatRate: inv.vatRate, vatAmount, total }),
          actor: 'OPERATOR',
          createdAt: now,
        },
      })
      console.log(`   ${inv.code}: ${rp.fromSku} → ${rp.toSku} @${newPrice} | total ${total.toLocaleString('vi-VN')}₫`)
    }
  }

  // ============ PHASE 3: Xóa SP demo non-UD + danh mục trống ============
  console.log('== PHASE 3: Xóa sản phẩm demo cũ (non-UD) ==')
  const nonUD = await db.product.findMany({
    where: { sku: { not: { startsWith: 'UD-' } } },
    select: { id: true, sku: true, name: true },
    orderBy: { sku: 'asc' },
  })
  const nonUDIds = nonUD.map((p) => p.id)
  // chốt an toàn: không được còn tham chiếu nào ngoài cascade
  const oi = await db.orderItem.count({ where: { productId: { in: nonUDIds } } })
  const sii = await db.salesInvoiceItem.count({ where: { productId: { in: nonUDIds } } })
  const pii = await db.purchaseInvoiceItem.count({ where: { productId: { in: nonUDIds } } })
  if (oi + sii + pii > 0) throw new Error(`Vẫn còn tham chiếu chặn xóa: orderItem=${oi} salesItem=${sii} purchaseItem=${pii}`)
  await db.product.deleteMany({ where: { id: { in: nonUDIds } } })
  console.log(`   Đã xóa ${nonUD.length} sản phẩm demo`)
  const emptyCats = await db.category.findMany({ include: { _count: { select: { products: true } } } })
  const toDelCats = emptyCats.filter((c) => c._count.products === 0)
  if (toDelCats.length > 0) {
    await db.category.deleteMany({ where: { id: { in: toDelCats.map((c) => c.id) } } })
    console.log(`   Đã xóa ${toDelCats.length} danh mục trống: ${toDelCats.map((c) => c.name).join(', ')}`)
  }
  await db.ledgerEntry.create({
    data: {
      scope: 'INVENTORY',
      action: 'PRODUCT_CATALOG_CLEANED',
      entityType: 'PRODUCT_CATALOG',
      entityCode: 'UUDAM.VN',
      title: `Xóa ${nonUD.length} sản phẩm demo cũ ngoài danh mục Ưu Đàm`,
      detail: JSON.stringify({
        deleted: nonUD.map((p) => p.sku),
        deletedEmptyCategories: toDelCats.map((c) => c.name),
      }),
      actor: 'OPERATOR',
      createdAt: now,
    },
  })

  // ============ PHASE 4: Tính lại chuỗi "Tồn sau" theo trình tự thời gian ============
  console.log('== PHASE 4: Tính lại chuỗi stockAfter cho toàn bộ biến động kho Ưu Đàm ==')
  const udProducts = await db.product.findMany({
    where: { sku: { startsWith: 'UD-' }, type: { not: 'COMBO' } },
    orderBy: { sku: 'asc' },
  })
  const recalcSummary: Array<Record<string, unknown>> = []
  let updatedCount = 0
  for (const p of udProducts) {
    const movs = await db.stockMovement.findMany({
      where: { productId: p.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    if (movs.length === 0) continue
    // 1) Tách nhập tồn đầu kỳ (seed) khỏi chuỗi
    const openingIdx = movs.findIndex((m) => m.type === 'IMPORT' && (m.note || '').includes('Nhập tồn đầu kỳ'))
    if (openingIdx === -1) throw new Error(`${p.sku}: thiếu movement nhập tồn đầu kỳ`)
    const opening = movs[openingIdx]
    const others = movs.filter((_, i) => i !== openingIdx)
    // 2) Đưa nhập đầu kỳ về trước biến động sớm nhất 24h
    if (others.length > 0) {
      const earliest = others.reduce((min, m) => (m.createdAt < min ? m.createdAt : min), others[0].createdAt)
      const newDate = new Date(earliest.getTime() - 24 * 3600 * 1000)
      if (opening.createdAt.getTime() !== newDate.getTime()) {
        await db.stockMovement.update({ where: { id: opening.id }, data: { createdAt: newDate } })
        opening.createdAt = newDate
      }
    }
    // 3) Hiệu chỉnh số lượng nhập đầu kỳ để chuỗi kết thúc đúng tồn hiện tại
    const sumOthers = others.reduce((s, m) => s + m.quantity, 0)
    const openingQty = p.stock - sumOthers
    if (openingQty < 0) throw new Error(`${p.sku}: chuỗi không thể hợp lệ (opening ${openingQty} < 0)`)
    if (opening.quantity !== openingQty) {
      await db.stockMovement.update({ where: { id: opening.id }, data: { quantity: openingQty } })
      opening.quantity = openingQty
    }
    // 4) Đi tuần theo thời gian, ghi lại stockAfter
    let balance = 0
    for (const m of movs.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))) {
      balance += m.quantity
      if (m.stockAfter !== balance) {
        await db.stockMovement.update({ where: { id: m.id }, data: { stockAfter: balance } })
        updatedCount++
      }
      m.stockAfter = balance
    }
    if (balance !== p.stock) throw new Error(`${p.sku}: chuỗi kết thúc ${balance} ≠ tồn hiện tại ${p.stock}`)
    recalcSummary.push({ sku: p.sku, openingQty, movements: movs.length, finalStock: p.stock })
    console.log(`   ${p.sku}: đầu kỳ ${openingQty} → ${movs.length} biến động → tồn ${balance} ✓`)
  }
  await db.ledgerEntry.create({
    data: {
      scope: 'INVENTORY',
      action: 'STOCK_CHAIN_RECALCULATED',
      entityType: 'STOCK_MOVEMENT',
      entityCode: 'UUDAM.VN',
      title: `Tính lại chuỗi "Tồn sau" theo trình tự thời gian cho ${updatedCount} biến động kho (${recalcSummary.length} SP Ưu Đàm)`,
      detail: JSON.stringify({ products: recalcSummary, updatedMovements: updatedCount }),
      actor: 'OPERATOR',
      createdAt: now,
    },
  })
  console.log(`   Đã cập nhật ${updatedCount} dòng stockAfter`)

  // ============ VERIFY ============
  console.log('== VERIFY ==')
  const remainNonUD = await db.product.count({ where: { sku: { not: { startsWith: 'UD-' } } } })
  const low = await db.product.findMany({
    where: { stock: { lte: db.product.fields.lowStockThreshold } },
    orderBy: { stock: 'asc' },
    select: { sku: true, stock: true, lowStockThreshold: true },
  })
  const totalMov = await db.stockMovement.count()
  const cats = await db.category.findMany({ select: { name: true, _count: { select: { products: true } } } })
  console.log(`   Sản phẩm non-UD còn lại: ${remainNonUD}`)
  console.log(`   Cảnh báo tồn thấp: ${low.map((p) => `${p.sku}(${p.stock}/${p.lowStockThreshold})`).join(', ') || 'không'}`)
  console.log(`   Tổng movement: ${totalMov}; Danh mục: ${cats.map((c) => `${c.name}(${c._count.products})`).join(', ')}`)
  console.log('DONE ✔')
}

main()
  .catch((e) => {
    console.error('FAILED:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
