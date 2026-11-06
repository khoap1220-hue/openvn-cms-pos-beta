import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateInvoiceXml } from '@/lib/einvoice'
import { getSettings } from '@/lib/settings'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const invoice = await db.salesInvoice.findUnique({
      where: { id },
      include: {
        partner: true,
        items: {
          include: {
            product: {
              select: { id: true, sku: true, name: true, unit: true },
            },
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: 'Không tìm thấy hóa đơn bán' }, { status: 404 })
    }

    if (invoice.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Hóa đơn đã bị hủy, không thể xuất XML' },
        { status: 400 }
      )
    }

    // Đọc cấu hình thông tin đơn vị bán từ CSDL
    const sellerSettings = await getSettings([
      'company_name',
      'company_tax',
      'company_address',
      'company_phone',
    ])

    // Tìm chữ ký số trong Sổ Data (nếu hóa đơn đã từng ký)
    let signatureValue: string | null = null
    const signLog = await db.ledgerEntry.findFirst({
      where: {
        entityType: 'SalesInvoice',
        entityId: invoice.id,
        action: 'SIGN_INVOICE',
      },
      orderBy: { createdAt: 'desc' },
    })

    if (signLog?.detail) {
      try {
        const parsed = JSON.parse(signLog.detail)
        signatureValue = parsed.signature?.signatureValue || null
      } catch {
        // bỏ qua nếu parse lỗi
      }
    }

    const xml = generateInvoiceXml(invoice, {
      companyName: sellerSettings.company_name,
      companyTax: sellerSettings.company_tax,
      companyAddress: sellerSettings.company_address,
      companyPhone: sellerSettings.company_phone,
      signature: signatureValue,
    })

    return new Response(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${invoice.code}.xml"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi xuất hóa đơn XML'
    console.error('XML export error:', error)
    if (message.includes('đã bị hủy')) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
