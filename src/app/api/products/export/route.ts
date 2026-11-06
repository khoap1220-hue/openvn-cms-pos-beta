import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { EXPORT_CSV_HEADERS, stringifyCsv } from '@/lib/csv-helper'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const products = await db.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        category: { select: { name: true } },
      },
    })

    const rows = products.map((p) => [
      p.sku,
      p.name,
      p.costPrice,
      p.sellPrice,
      p.stock,
      p.unit,
      p.type,
      p.barcode ?? '',
      p.category?.name ?? '',
      p.status,
    ])

    const csvContent = stringifyCsv(EXPORT_CSV_HEADERS, rows)

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="danh-muc-san-pham.csv"',
      },
    })
  } catch (error) {
    console.error('Products export GET error:', error)
    return NextResponse.json({ error: 'Không thể xuất danh mục sản phẩm' }, { status: 500 })
  }
}
