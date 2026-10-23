import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

const PARTNER_TYPES = ['SUPPLIER', 'CUSTOMER', 'BOTH'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await req.json()) as Record<string, unknown>

    const partner = await db.partner.findUnique({ where: { id } })
    if (!partner) return NextResponse.json({ error: 'Không tìm thấy đối tác' }, { status: 404 })

    const data: {
      name?: string
      taxCode?: string | null
      address?: string | null
      phone?: string | null
      email?: string | null
      type?: string
      note?: string | null
      code?: string
    } = {}

    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: 'Tên đơn vị không được để trống' }, { status: 400 })
      data.name = name
    }
    if (body.code !== undefined) {
      const code = String(body.code).trim()
      if (!code) return NextResponse.json({ error: 'Mã đối tác không được để trống' }, { status: 400 })
      const existed = await db.partner.findUnique({ where: { code } })
      if (existed && existed.id !== id) {
        return NextResponse.json({ error: `Mã đối tác "${code}" đã tồn tại` }, { status: 400 })
      }
      data.code = code
    }
    if (body.taxCode !== undefined) data.taxCode = String(body.taxCode).trim() || null
    if (body.address !== undefined) data.address = String(body.address).trim() || null
    if (body.phone !== undefined) data.phone = String(body.phone).trim() || null
    if (body.email !== undefined) data.email = String(body.email).trim() || null
    if (body.type !== undefined) {
      const type = String(body.type)
      if (!(PARTNER_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json({ error: 'Loại đối tác không hợp lệ' }, { status: 400 })
      }
      data.type = type
    }
    if (body.note !== undefined) data.note = String(body.note).trim() || null

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    const updated = await db.partner.update({ where: { id }, data })

    await logLedger({
      scope: 'PARTNER',
      action: 'PARTNER_UPDATED',
      actor: 'OPERATOR',
      entityType: 'Partner',
      entityId: id,
      entityCode: updated.code,
      title: `Cập nhật đối tác ${updated.code} — ${updated.name}`,
      detail: { fields: Object.keys(data) },
    })

    return NextResponse.json({ partner: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật đối tác'
    console.error('Partner PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const partner = await db.partner.findUnique({ where: { id } })
    if (!partner) return NextResponse.json({ error: 'Không tìm thấy đối tác' }, { status: 404 })

    const [purchaseCount, salesCount] = await Promise.all([
      db.purchaseInvoice.count({ where: { partnerId: id } }),
      db.salesInvoice.count({ where: { partnerId: id } }),
    ])
    if (purchaseCount + salesCount > 0) {
      return NextResponse.json(
        {
          error: `Không thể xóa đối tác đã có hóa đơn (${purchaseCount} hóa đơn mua, ${salesCount} hóa đơn bán). Vui lòng giữ đối tác này.`,
        },
        { status: 409 },
      )
    }

    await db.partner.delete({ where: { id } })

    await logLedger({
      scope: 'PARTNER',
      action: 'PARTNER_DELETED',
      actor: 'OPERATOR',
      entityType: 'Partner',
      entityId: id,
      entityCode: partner.code,
      title: `Xóa đối tác ${partner.code} — ${partner.name}`,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể xóa đối tác'
    console.error('Partner DELETE error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
