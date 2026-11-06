import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PeriodClosedError, createPurchaseInvoice } from '@/lib/invoice-service'
import { quarterRange } from '@/lib/accounting'
import { getLineageMeta } from '@/lib/lineage-server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const year = Number(searchParams.get('year')) || 0
    const quarter = Number(searchParams.get('quarter')) || 0
    const q = searchParams.get('q')?.trim()

    const where: Record<string, unknown> = {}
    if (year > 0) {
      where.invoiceDate =
        quarter >= 1 && quarter <= 4
          ? { gte: quarterRange(year, quarter).start, lt: quarterRange(year, quarter).end }
          : { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) }
    }
    if (q) {
      where.OR = [{ code: { contains: q } }, { partner: { is: { name: { contains: q } } } }]
    }

    const invoices = await db.purchaseInvoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        partner: { select: { id: true, code: true, name: true, taxCode: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
      },
    })

    // DATA PROVENANCE — số lần sửa + nguồn gốc theo Sổ Data
    const lineageMeta = await getLineageMeta('PurchaseInvoice', invoices.map((inv) => inv.id))
    return NextResponse.json({
      invoices: invoices.map((inv) => ({
        ...inv,
        originSource: lineageMeta.get(inv.id)?.originSource ?? null,
        changeCount: lineageMeta.get(inv.id)?.changeCount ?? 0,
      })),
    })
  } catch (error) {
    console.error('Purchase invoices GET error:', error)
    return NextResponse.json({ error: 'Không thể tải hóa đơn mua' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const invoice = await createPurchaseInvoice({
      partnerId: body.partnerId ? String(body.partnerId) : null,
      items: (body.items as Array<{ productId: string; quantity: number; unitPrice: number }>) ?? [],
      vatRate: body.vatRate != null ? Number(body.vatRate) : undefined,
      invoiceDate: body.invoiceDate != null ? String(body.invoiceDate) : undefined,
      note: body.note != null ? String(body.note) : undefined,
      status: body.status != null ? String(body.status) : undefined,
    })
    return NextResponse.json({ invoice }, { status: 201 })
  } catch (error) {
    if (error instanceof PeriodClosedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    const message = error instanceof Error ? error.message : 'Không thể tạo hóa đơn mua'
    console.error('Purchase invoices POST error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
