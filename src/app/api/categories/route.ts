import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const categories = await db.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    })
    return NextResponse.json({
      categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug, productCount: c._count.products })),
    })
  } catch (error) {
    console.error('Categories GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh mục' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const name = body.name?.trim()
    if (!name) return NextResponse.json({ error: 'Vui lòng nhập tên danh mục' }, { status: 400 })

    const slug =
      body.slug?.trim() ||
      name
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')

    const existing = await db.category.findUnique({ where: { slug } })
    if (existing) return NextResponse.json({ error: 'Danh mục đã tồn tại' }, { status: 409 })

    const category = await db.category.create({ data: { name, slug } })
    return NextResponse.json({ category }, { status: 201 })
  } catch (error) {
    console.error('Categories POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo danh mục' }, { status: 500 })
  }
}
