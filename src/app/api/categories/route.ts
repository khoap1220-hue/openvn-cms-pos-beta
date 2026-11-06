import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

function slugifyCategory(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function GET() {
  try {
    const categories = await db.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    })
    return NextResponse.json({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        createdAt: c.createdAt.toISOString(),
        productCount: c._count.products,
      })),
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

    const slug = slugifyCategory(body.slug?.trim() || name)
    if (!slug) return NextResponse.json({ error: 'Mã đường dẫn (slug) danh mục không hợp lệ' }, { status: 400 })

    const existing = await db.category.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json({ error: `Danh mục "${existing.name}" (slug: ${slug}) đã tồn tại` }, { status: 409 })
    }

    const category = await db.category.create({ data: { name, slug } })

    if (Array.isArray(body.assignProductIds) && body.assignProductIds.length > 0) {
      const validIds = body.assignProductIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim() !== '')
      if (validIds.length > 0) {
        await db.product.updateMany({
          where: { id: { in: validIds } },
          data: { categoryId: category.id },
        })
      }
    }

    const count = await db.product.count({ where: { categoryId: category.id } })

    await logLedger({
      scope: 'INVENTORY',
      action: 'CATEGORY_CREATED',
      actor: 'OPERATOR',
      entityType: 'Category',
      entityId: category.id,
      entityCode: category.slug,
      title: `Tạo danh mục sản phẩm: ${category.name}`,
      detail: { name: category.name, slug: category.slug, assignedProducts: count },
    })

    return NextResponse.json(
      {
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
          createdAt: category.createdAt.toISOString(),
          productCount: count,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Categories POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo danh mục' }, { status: 500 })
  }
}
