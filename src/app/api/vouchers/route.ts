import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import {
  calculateVoucherDiscount,
  ensureWarehousesAndVouchersSeeded,
} from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await ensureWarehousesAndVouchersSeeded()
    const url = new URL(req.url)
    const codeParam = url.searchParams.get('code')?.trim().toUpperCase()

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
    return NextResponse.json({ vouchers })
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
      scope: 'SETTINGS',
      action: 'CREATE_VOUCHER',
      entityType: 'Voucher',
      entityId: voucher.id,
      entityCode: voucher.code,
      title: `Tạo / cập nhật mã khuyến mãi ${voucher.code}: ${voucher.title}`,
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      after: {
        code: voucher.code,
        discountType: voucher.discountType,
        discountValue: voucher.discountValue,
        minOrderAmount: voucher.minOrderAmount,
      },
    })

    return NextResponse.json({ voucher }, { status: 201 })
  } catch (error) {
    console.error('Vouchers POST error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Không thể tạo mã khuyến mãi' },
      { status: 400 }
    )
  }
}
