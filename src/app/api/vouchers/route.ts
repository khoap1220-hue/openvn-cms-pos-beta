import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logLedger, recordLineageChange } from '@/lib/ledger'
import { getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import {
  calculateVoucherDiscount,
  ensureWarehousesAndVouchersSeeded,
} from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const codeParam = url.searchParams.get('code')?.trim().toUpperCase()

    if (!codeParam) {
      const cached = getApiCache<Record<string, unknown>>('vouchers:all')
      if (cached) {
        return NextResponse.json(cached)
      }
    }

    await ensureWarehousesAndVouchersSeeded()

    if (codeParam) {
      const subtotal = Math.max(0, Number(url.searchParams.get('subtotal') ?? 0) || 0)
      const shippingFee = Math.max(0, Number(url.searchParams.get('shippingFee') ?? 30000) || 0)
      const voucher = await db.voucher.findUnique({ where: { code: codeParam } })
      if (!voucher) {
        return NextResponse.json({
          valid: false,
          discountAmount: 0,
          reason: `Mã giảm giá "${codeParam}" không tồn tại`,
          voucher: null,
        })
      }
      const evalRes = calculateVoucherDiscount(voucher, subtotal, shippingFee)
      return NextResponse.json({
        valid: evalRes.valid,
        discountAmount: evalRes.discountAmount,
        reason: evalRes.reason ?? null,
        voucher,
      })
    }

    const vouchers = await db.voucher.findMany({
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    })
    const payload = { vouchers }
    setApiCache('vouchers:all', payload, 30_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Vouchers GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách mã khuyến mãi' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await ensureWarehousesAndVouchersSeeded()
    const body = await req.json()

    if (body.action === 'TOGGLE' && body.id) {
      const existing = await db.voucher.findUnique({ where: { id: String(body.id) } })
      if (!existing) {
        return NextResponse.json({ error: 'Không tìm thấy mã khuyến mãi' }, { status: 404 })
      }
      const updated = await db.voucher.update({
        where: { id: existing.id },
        data: { active: !existing.active },
      })
      await logLedger({
        scope: 'CAMPAIGN',
        action: updated.active ? 'VOUCHER_ACTIVATED' : 'VOUCHER_DEACTIVATED',
        entityType: 'Voucher',
        entityId: updated.id,
        entityCode: updated.code,
        title: `[CHƯƠNG TRÌNH] ${updated.active ? 'Kích hoạt' : 'Tạm dừng'} mã voucher ${updated.code}: ${updated.title}`,
        detail: {
          code: updated.code,
          title: updated.title,
          active: updated.active,
          discountType: updated.discountType,
          discountValue: updated.discountValue,
        },
        beforeSnapshot: { active: existing.active },
        afterSnapshot: { active: updated.active },
        changedFields: ['active'],
        actor: 'OPERATOR',
        originSource: 'MANUAL_ADMIN',
      })
      invalidateApiCache('vouchers:')
      return NextResponse.json({ voucher: updated })
    }

    const code = String(body.code ?? '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '')
    const title = String(body.title ?? '').trim()

    if (!code || !title) {
      return NextResponse.json({ error: 'Vui lòng nhập Mã giảm giá và Tên chương trình' }, { status: 400 })
    }

    const discountType = ['PERCENT', 'FIXED', 'FREESHIP'].includes(body.discountType)
      ? body.discountType
      : 'PERCENT'
    const discountValue = Math.max(1, Number(body.discountValue ?? 10) || 10)
    const maxDiscount =
      body.maxDiscount !== undefined && body.maxDiscount !== null && String(body.maxDiscount).trim() !== ''
        ? Math.max(0, Number(body.maxDiscount))
        : null
    const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0) || 0)
    const usageLimit =
      body.usageLimit !== undefined && body.usageLimit !== null && String(body.usageLimit).trim() !== ''
        ? Math.max(1, Math.floor(Number(body.usageLimit)))
        : null
    const scope = body.scope === 'ALLIANCE' ? 'ALLIANCE' : 'ALL'

    const voucher = await db.voucher.upsert({
      where: { code },
      update: {
        title,
        description: body.description ? String(body.description).trim() : null,
        discountType,
        discountValue,
        maxDiscount,
        minOrderAmount,
        usageLimit,
        scope,
        active: true,
      },
      create: {
        code,
        title,
        description: body.description ? String(body.description).trim() : null,
        discountType,
        discountValue,
        maxDiscount,
        minOrderAmount,
        usageLimit,
        scope,
        active: true,
      },
    })

    await recordLineageChange({
      scope: 'CAMPAIGN',
      action: 'VOUCHER_SAVED',
      entityType: 'Voucher',
      entityId: voucher.id,
      entityCode: voucher.code,
      title: `[CHƯƠNG TRÌNH] Lưu mã voucher ${voucher.code}: ${voucher.title} (${voucher.discountType} ${voucher.discountValue})`,
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      after: {
        code: voucher.code,
        title: voucher.title,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
        maxDiscount: voucher.maxDiscount,
        usageLimit: voucher.usageLimit,
        scope: voucher.scope,
      },
    })

    invalidateApiCache('vouchers:')
    return NextResponse.json({ voucher }, { status: 201 })
  } catch (error) {
    console.error('Vouchers POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể tạo mã khuyến mãi' },
      { status: 400 }
    )
  }
}
