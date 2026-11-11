import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateProductCsv } from '@/lib/csv-helper'
import { broadcast, invalidateApiCache } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    let csvContent = ''
    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') ?? formData.get('csv')
      if (file instanceof File) {
        csvContent = await file.text()
      } else if (typeof file === 'string') {
        csvContent = file
      }
    } else {
      try {
        const body = await req.json()
        if (typeof body.csv === 'string') {
          csvContent = body.csv
        } else if (typeof body.content === 'string') {
          csvContent = body.content
        }
      } catch {
        csvContent = await req.text()
      }
    }

    if (!csvContent || !csvContent.trim()) {
      return NextResponse.json(
        {
          success: false,
          totalErrors: 1,
          errors: [{ row: 1, sku: '', field: 'file', message: 'Tệp CSV không có nội dung' }],
        },
        { status: 422 }
      )
    }

    const { items, errors } = validateProductCsv(csvContent)

    // Atomic Rollback Guarantee: If there are ANY errors, return 422 immediately without DB write
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          totalErrors: errors.length,
          errors,
        },
        { status: 422 }
      )
    }

    // Pre-fetch categories for name matching
    const existingCategories = await db.category.findMany()
    const categoryMap = new Map<string, string>()
    for (const c of existingCategories) {
      categoryMap.set(c.name.trim().toLowerCase(), c.id)
      categoryMap.set(c.slug.trim().toLowerCase(), c.id)
    }

    // Auto-create any missing categories mentioned in the CSV
    const itemCategories = new Set(items.map((it) => it.category).filter(Boolean))
    for (const catName of itemCategories) {
      const lower = catName.toLowerCase()
      if (!categoryMap.has(lower)) {
        const slug = catName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/đ/g, 'd')
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
        const createdCat = await db.category.upsert({
          where: { slug: slug || `cat-${Date.now()}` },
          create: { name: catName, slug: slug || `cat-${Date.now()}` },
          update: {},
        })
        categoryMap.set(lower, createdCat.id)
      }
    }

    // Execute atomic upserts in db.$transaction
    await db.$transaction(
      items.map((item) => {
        const catId = item.category ? (categoryMap.get(item.category.toLowerCase()) ?? null) : null
        return db.product.upsert({
          where: { sku: item.sku },
          create: {
            sku: item.sku,
            name: item.name,
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
            stock: item.stock,
            unit: item.unit,
            type: item.type,
            barcode: item.barcode,
            categoryId: catId,
            status: item.status,
          },
          update: {
            name: item.name,
            costPrice: item.costPrice,
            sellPrice: item.sellPrice,
            stock: item.stock,
            unit: item.unit,
            type: item.type,
            barcode: item.barcode,
            categoryId: catId,
            status: item.status,
          },
        })
      })
    )

    invalidateApiCache('products')
    broadcast('product.updated', { imported: true, count: items.length })

    return NextResponse.json({
      success: true,
      processedCount: items.length,
      message: 'Nhập danh mục sản phẩm thành công',
    })
  } catch (error) {
    console.error('Products import POST error:', error)
    return NextResponse.json(
      {
        success: false,
        totalErrors: 1,
        errors: [{ row: 0, sku: '', field: 'system', message: 'Lỗi hệ thống khi nhập danh mục sản phẩm' }],
      },
      { status: 500 }
    )
  }
}
