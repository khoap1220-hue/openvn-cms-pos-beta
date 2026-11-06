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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.category.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Danh mục không tồn tại' }, { status: 404 })
    }

    const body = (await req.json()) as {
      name?: string
      slug?: string
      assignProductIds?: string[]
      removeProductIds?: string[]
    }

    const nextName = body.name !== undefined ? body.name.trim() : existing.name
    if (!nextName) {
      return NextResponse.json({ error: 'Tên danh mục không được để trống' }, { status: 400 })
    }

    const rawSlug = body.slug !== undefined ? body.slug.trim() : body.name !== undefined ? nextName : existing.slug
    const nextSlug = slugifyCategory(rawSlug || nextName)
    if (!nextSlug) {
      return NextResponse.json({ error: 'Mã đường dẫn (slug) không hợp lệ' }, { status: 400 })
    }

    if (nextSlug !== existing.slug) {
      const conflict = await db.category.findUnique({ where: { slug: nextSlug } })
      if (conflict && conflict.id !== id) {
        return NextResponse.json(
          { error: `Mã đường dẫn "${nextSlug}" đã được dùng bởi danh mục "${conflict.name}"` },
          { status: 409 }
        )
      }
    }

    const updated = await db.category.update({
      where: { id },
      data: { name: nextName, slug: nextSlug },
    })

    if (Array.isArray(body.assignProductIds) && body.assignProductIds.length > 0) {
      const validIds = body.assignProductIds.filter((pid): pid is string => typeof pid === 'string' && pid.trim() !== '')
      if (validIds.length > 0) {
        await db.product.updateMany({
          where: { id: { in: validIds } },
          data: { categoryId: id },
        })
      }
    }

    if (Array.isArray(body.removeProductIds) && body.removeProductIds.length > 0) {
      const validIds = body.removeProductIds.filter((pid): pid is string => typeof pid === 'string' && pid.trim() !== '')
      if (validIds.length > 0) {
        await db.product.updateMany({
          where: { id: { in: validIds }, categoryId: id },
          data: { categoryId: null },
        })
      }
    }

    const productCount = await db.product.count({ where: { categoryId: id } })

    await logLedger({
      scope: 'INVENTORY',
      action: 'CATEGORY_UPDATED',
      actor: 'OPERATOR',
      entityType: 'Category',
      entityId: updated.id,
      entityCode: updated.slug,
      title: `Cập nhật danh mục sản phẩm: ${updated.name}`,
      detail: {
        before: { name: existing.name, slug: existing.slug },
        after: { name: updated.name, slug: updated.slug, productCount },
      },
    })

    return NextResponse.json({
      category: {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        createdAt: updated.createdAt.toISOString(),
        productCount,
      },
    })
  } catch (error) {
    console.error('Categories PUT error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật danh mục' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Danh mục không tồn tại' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const reassignToId = searchParams.get('reassignTo')?.trim() || null

    if (reassignToId && reassignToId !== 'NONE') {
      const targetCat = await db.category.findUnique({ where: { id: reassignToId } })
      if (!targetCat) {
        return NextResponse.json({ error: 'Danh mục đích để chuyển sản phẩm không tồn tại' }, { status: 400 })
      }
      await db.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: reassignToId },
      })
    } else {
      await db.product.updateMany({
        where: { categoryId: id },
        data: { categoryId: null },
      })
    }

    await db.category.delete({ where: { id } })

    await logLedger({
      scope: 'INVENTORY',
      action: 'CATEGORY_DELETED',
      actor: 'OPERATOR',
      entityType: 'Category',
      entityId: id,
      entityCode: existing.slug,
      title: `Xóa danh mục sản phẩm: ${existing.name}`,
      detail: {
        deletedName: existing.name,
        deletedSlug: existing.slug,
        affectedProducts: existing._count.products,
        reassignedTo: reassignToId,
      },
    })

    return NextResponse.json({
      success: true,
      affectedProducts: existing._count.products,
    })
  } catch (error) {
    console.error('Categories DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa danh mục' }, { status: 500 })
  }
}

export const PATCH = PUT
