import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { broadcast } from '@/lib/realtime'

export const dynamic = 'force-dynamic'

interface BirthdayJobBody {
  testCustomerId?: string
  date?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as BirthdayJobBody
    const targetDate = body.date ? new Date(body.date) : new Date()
    const year = targetDate.getFullYear()
    const targetMmDd = `${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`

    let customersToProcess: Array<{
      id: string
      name: string
      phone: string | null
      isMember: boolean
      points: number
      preferences: string | null
    }> = []

    if (body.testCustomerId) {
      const cust = await db.customer.findUnique({
        where: { id: body.testCustomerId },
        select: { id: true, name: true, phone: true, isMember: true, points: true, preferences: true },
      })
      if (!cust) {
        return NextResponse.json({ error: 'Không tìm thấy khách hàng chỉ định' }, { status: 404 })
      }
      customersToProcess = [cust]
    } else {
      // Tìm tất cả khách VIP (hội viên hoặc >= 100 điểm)
      customersToProcess = await db.customer.findMany({
        where: {
          OR: [{ isMember: true }, { points: { gte: 100 } }],
        },
        select: { id: true, name: true, phone: true, isMember: true, points: true, preferences: true },
      })
    }

    const issuedVouchers: Array<{ customerId: string; name: string; voucher: any }> = []
    const skippedCustomers: Array<{ customerId: string; name: string; voucherCode?: string; reason: string }> = []

    for (const cust of customersToProcess) {
      let bday = ''
      try {
        const prefs = JSON.parse(cust.preferences || '{}')
        bday = String(prefs.birthday || '')
      } catch {
        bday = ''
      }

      // Kiểm tra xem sinh nhật có trùng với ngày hôm nay không (hoặc nếu là testCustomerId thì ưu tiên xử lý)
      const isBirthdayToday = bday.endsWith(targetMmDd) || Boolean(body.testCustomerId)
      if (!isBirthdayToday) {
        continue
      }

      const custSuffix = cust.id.slice(-6)
      const expectedCode = `BDAY-${year}-${custSuffix}`

      // Idempotency guard: kiểm tra xem năm nay đã phát voucher sinh nhật cho khách này chưa
      const existingVoucher = await db.voucher.findFirst({
        where: {
          code: { contains: custSuffix },
          createdAt: {
            gte: new Date(year, 0, 1),
            lt: new Date(year + 1, 0, 1),
          },
        },
      })

      if (existingVoucher) {
        skippedCustomers.push({
          customerId: cust.id,
          name: cust.name,
          voucherCode: existingVoucher.code,
          reason: 'Voucher sinh nhật đã được cấp trước đó (Idempotent Guard)',
        })
        continue
      }

      // Tạo voucher sinh nhật VIP mới
      const newVoucher = await db.voucher.create({
        data: {
          code: expectedCode,
          title: `Voucher Sinh Nhật Khách VIP - ${cust.name}`,
          description: `Ưu đãi sinh nhật 20% tri ân khách hàng thân thiết Ưu Đàm (${year})`,
          discountType: 'PERCENT',
          discountValue: 20,
          maxDiscount: 100000,
          minOrderAmount: 0,
          usageLimit: 1,
          active: true,
          expiresAt: new Date(targetDate.getTime() + 30 * 86400000), // Hạn dùng 30 ngày
        },
      })

      await recordLineageChange({
        scope: 'CUSTOMER',
        action: 'BIRTHDAY_VOUCHER_ISSUED',
        actor: 'SYSTEM',
        actorName: 'Agent Chăm sóc khách hàng (VIP Birthday Job)',
        originSource: 'AGENT_AUTOPILOT',
        entityType: 'Voucher',
        entityId: newVoucher.id,
        entityCode: newVoucher.code,
        title: `Phát voucher sinh nhật VIP ${newVoucher.code} cho ${cust.name}`,
        after: { code: newVoucher.code, customerId: cust.id, discountValue: 20 },
      })

      issuedVouchers.push({
        customerId: cust.id,
        name: cust.name,
        voucher: newVoucher,
      })
    }

    broadcast('customer.updated', { reason: 'birthday_job' })

    return NextResponse.json({
      success: true,
      date: targetDate.toISOString().slice(0, 10),
      issuedCount: issuedVouchers.length,
      skippedCount: skippedCustomers.length,
      issued: issuedVouchers,
      skipped: skippedCustomers,
      idempotent: skippedCustomers.length > 0 && issuedVouchers.length === 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lỗi tác vụ phát voucher sinh nhật'
    console.error('Birthday voucher job error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
