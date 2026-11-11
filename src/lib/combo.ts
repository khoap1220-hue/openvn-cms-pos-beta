// COMBO/SET QUÀ TẶNG — helper dùng chung cho order-service, invoice-service, API sản phẩm.
// Combo là sản phẩm "gộp nhiều thành phẩm": thành phần khai báo ở Định mức (BomComponent).
// Xuất bán combo → KHÔNG trừ kho của combo, mà trừ kho từng thành phần × định mức;
// giá vốn gộp = Σ costPrice thành phần × định mức.

import { db } from '@/lib/db'
import type { PrismaClient, Prisma } from '@prisma/client'
import { patchProductInApiCache, invalidateApiCache } from '@/lib/realtime'

type DbClient = PrismaClient | Prisma.TransactionClient

/** Giá vốn gộp của combo = Σ costPrice thành phần × định mức (0 nếu chưa khai báo thành phần) */
export function comboCostFromRows(
  rows: Array<{ quantity: number; componentProduct: { costPrice: number } }>
): number {
  return Math.round(rows.reduce((s, r) => s + r.quantity * r.componentProduct.costPrice, 0))
}

/** Số combo có thể đóng được = min(floor(stock thành phần / định mức)) — 0 nếu chưa khai báo */
export function comboAvailableFromRows(
  rows: Array<{ quantity: number; componentProduct: { stock: number } }>
): number {
  if (rows.length === 0) return 0
  return Math.min(...rows.map((r) => Math.floor(r.componentProduct.stock / Math.max(r.quantity, 0.0001))))
}

/** Nạp thành phần combo (kèm thông tin SP thành phần) */
export async function getComboRows(tx: DbClient, comboProductId: string) {
  const client = tx ?? db
  return (client as PrismaClient).bomComponent.findMany({
    where: { productId: comboProductId },
    include: { componentProduct: { select: { id: true, sku: true, name: true, unit: true, costPrice: true, stock: true } } },
  })
}

/** Đồng bộ tồn kho hiển thị của combo = số combo đóng được từ tồn thành phần hiện tại */
export async function syncComboStock(tx: DbClient, comboProductId: string): Promise<void> {
  const client = tx ?? db
  const rows = await (client as PrismaClient).bomComponent.findMany({
    where: { productId: comboProductId },
    include: { componentProduct: { select: { stock: true } } },
  })
  const available = comboAvailableFromRows(rows)
  await (client as PrismaClient).product.update({ where: { id: comboProductId }, data: { stock: available } })
  patchProductInApiCache(comboProductId, { stock: available, comboAvailable: available })
  invalidateApiCache('products:static_meta')
}

/**
 * Khi tồn kho của 1 hoặc nhiều sản phẩm thành phần thay đổi (nhập/xuất/điều chỉnh/mua/bán/hoàn kho),
 * tự động tìm mọi sản phẩm COMBO có chứa thành phần đó và đồng bộ lại tồn kho hiển thị của combo.
 */
export async function syncCombosUsingComponents(tx: DbClient, componentProductIds: string[]): Promise<void> {
  const uniqueIds = Array.from(new Set(componentProductIds.filter(Boolean)))
  if (uniqueIds.length === 0) return
  const client = (tx ?? db) as PrismaClient
  const parentRows = await client.bomComponent.findMany({
    where: {
      componentProductId: { in: uniqueIds },
      product: { type: 'COMBO' },
    },
    select: { productId: true },
  })
  const comboIds = Array.from(new Set(parentRows.map((r) => r.productId)))
  for (const comboId of comboIds) {
    await syncComboStock(client, comboId)
  }
}

/**
 * Kiểm tra & trừ kho thành phần khi xuất bán combo.
 * demands: Map componentProductId → tổng số lượng thành phần cần (đã × số combo).
 * Trả về danh sách kết quả trừ kho (nếu thiếu vẫn trừ tối đa về 0 kèm warning, như BOM định mức).
 */
export async function issueComboComponents(
  tx: Prisma.TransactionClient,
  demands: Map<string, number>,
  noteOf: (componentName: string, qty: number) => string
): Promise<Array<{ componentProductId: string; componentName: string; required: number; deducted: number; warning?: string }>> {
  const results: Array<{ componentProductId: string; componentName: string; required: number; deducted: number; warning?: string }> = []
  for (const [componentProductId, required] of demands) {
    if (required <= 0) continue
    const component = await tx.product.findUnique({ where: { id: componentProductId } })
    if (!component) continue
    const after = Math.max(0, component.stock - required)
    const actualDelta = after - component.stock
    if (actualDelta === 0) {
      results.push({ componentProductId, componentName: component.name, required, deducted: 0, warning: `Kho "${component.name}" đã hết` })
      continue
    }
    await tx.product.update({ where: { id: componentProductId }, data: { stock: after } })
    await tx.stockMovement.create({
      data: { productId: componentProductId, type: 'COMBO_ISSUE', quantity: actualDelta, stockAfter: after, note: noteOf(component.name, Math.abs(actualDelta)) },
    })
    const deducted = Math.abs(actualDelta)
    results.push({
      componentProductId,
      componentName: component.name,
      required,
      deducted,
      ...(deducted < required ? { warning: `Kho "${component.name}" không đủ — chỉ trừ được ${deducted}/${required}` } : {}),
    })
  }
  return results
}
