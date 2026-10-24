import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/lineage?entityType=Order&entityId=xxx — lịch sử nguồn gốc & thay đổi của 1 dòng dữ liệu
// Trả về entry theo thời gian tăng dần để UI dựng timeline + bảng Diff Trước/Sau.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const entityType = searchParams.get('entityType')?.trim()
    const entityId = searchParams.get('entityId')?.trim()
    const entityCode = searchParams.get('entityCode')?.trim()

    if (!entityType || (!entityId && !entityCode)) {
      return NextResponse.json({ error: 'Thiếu entityType hoặc entityId/entityCode' }, { status: 400 })
    }

    const where: Record<string, unknown> = { entityType }
    if (entityId) where.entityId = entityId
    else if (entityCode) where.entityCode = entityCode

    const entries = await db.ledgerEntry.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 120,
    })

    // Bản gốc = entry đầu tiên có afterSnapshot mà không có changedFields (snapshot khởi tạo)
    // Nếu không có (vd sản phẩm nhập kho ngay từ đầu kỳ) → dùng entry sớm nhất làm "Thông tin gốc"
    // nhưng vẫn giữ nó trong timeline (originIsFallback).
    let origin = entries.find((e) => e.afterSnapshot && !e.changedFields) ?? null
    const originIsFallback = !origin && entries.length > 0
    if (originIsFallback) origin = entries[0]
    const changes = originIsFallback ? entries : entries.filter((e) => e.id !== origin?.id)
    const changeCount = entries.filter((e) => e.changedFields).length

    return NextResponse.json({
      entityType,
      entityId: entityId ?? origin?.entityId ?? null,
      entityCode: entries[0]?.entityCode ?? entityCode ?? null,
      origin,
      originIsFallback,
      changes,
      changeCount,
      total: entries.length,
    })
  } catch (error) {
    console.error('Lineage GET error:', error)
    return NextResponse.json({ error: 'Không thể tải lịch sử nguồn gốc dữ liệu' }, { status: 500 })
  }
}
