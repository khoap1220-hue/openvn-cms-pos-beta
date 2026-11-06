import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger } from '@/lib/ledger'
import { signInvoice } from '@/lib/integrations/einvoice-signer'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const provider = typeof body.provider === 'string' ? body.provider : 'MOCK_VNPT'

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
      return NextResponse.json({ error: 'Không tìm thấy hóa đơn' }, { status: 404 })
    }

    if (invoice.status === 'CANCELLED') {
      return NextResponse.json(
        { error: 'Không thể ký số hóa đơn đã bị hủy' },
        { status: 400 }
      )
    }

    // Thực hiện ký số qua adapter (100% Mock isolated mode khi chưa có live cert)
    const signResult = await signInvoice(invoice, { provider })

    // Ghi nhận chứng thư và mã tra cứu vào thông tin hóa đơn
    const signedTag = `[KÝ SỐ: ${signResult.provider} | Tra cứu: ${signResult.signature.lookupCode} | Ký: ${signResult.signature.signedAt}]`
    const updatedNote = invoice.note ? `${invoice.note}\n${signedTag}` : signedTag

    await db.salesInvoice.update({
      where: { id: invoice.id },
      data: { note: updatedNote },
    })

    // Ghi vào Sổ Data (logLedger tự động phát sự kiện realtime 'ledger.new')
    await logLedger({
      scope: 'INVOICE',
      action: 'SIGN_INVOICE',
      title: `Ký số điện tử hóa đơn ${invoice.code} (${signResult.provider})`,
      entityType: 'SalesInvoice',
      entityId: invoice.id,
      entityCode: invoice.code,
      detail: {
        provider: signResult.provider,
        signature: signResult.signature,
      },
      actor: 'OPERATOR',
    })

    return NextResponse.json({
      success: true,
      provider: signResult.provider,
      signature: signResult.signature,
      lookupCode: signResult.signature.lookupCode,
      invoiceCode: invoice.code,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi ký số hóa đơn'
    console.error('Invoice sign error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
