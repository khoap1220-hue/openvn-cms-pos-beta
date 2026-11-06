import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// PATCH { id, attributes?, unit? } — cập nhật ĐẶC TÍNH + đơn vị tính của sản phẩm (không đụng trường khác)
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!id) return NextResponse.json({ error: 'Thiếu id sản phẩm' }, { status: 400 })

    const product = await db.product.findUnique({ where: { id } })
    if (!product) return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 })

    const data: { attributes?: string | null; unit?: string } = {}
    if (body.attributes !== undefined) {
      const nextRaw = body.attributes === null ? null : String(body.attributes).trim() || null
      const prevRaw = (product.attributes ?? '').trim()
      if (prevRaw.startsWith('{') && prevRaw.endsWith('}')) {
        try {
          const parsedPrev = JSON.parse(prevRaw) as Record<string, unknown>
          if (nextRaw && nextRaw.startsWith('{') && nextRaw.endsWith('}')) {
            data.attributes = nextRaw
          } else if (nextRaw) {
            parsedPrev.customSummary = nextRaw
            data.attributes = JSON.stringify(parsedPrev)
          } else {
            delete parsedPrev.customSummary
            data.attributes = JSON.stringify(parsedPrev)
          }
        } catch {
          data.attributes = nextRaw
        }
      } else {
        data.attributes = nextRaw
      }
    }
    if (body.unit !== undefined) {
      const unit = String(body.unit).trim()
      if (!unit) return NextResponse.json({ error: 'Đơn vị tính không được để trống' }, { status: 400 })
      data.unit = unit
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật (attributes | unit)' }, { status: 400 })
    }

    const updated = await db.product.update({ where: { id }, data })

    await logLedger({
      scope: 'INVENTORY',
      action: 'PRODUCT_ATTR_UPDATED',
      actor: 'OPERATOR',
      entityType: 'Product',
      entityId: id,
      entityCode: updated.sku,
      title: `Cập nhật đặc tính ${updated.name}`,
      detail: { attributes: updated.attributes, unit: updated.unit },
    })

    return NextResponse.json({ product: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật đặc tính sản phẩm'
    console.error('Product attributes PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export const PUT = PATCH
export const POST = PATCH
