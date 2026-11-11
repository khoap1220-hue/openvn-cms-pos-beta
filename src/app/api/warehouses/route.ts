import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordLineageChange } from '@/lib/ledger'
import { getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import {
  computeCrossSellSettlements,
  ensureWarehousesAndVouchersSeeded,
  settlePartnerCrossSell,
  transferStockBetweenWarehouses,
} from '@/lib/warehouse-service'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const cached = getApiCache<Record<string, unknown>>('warehouses:all')
    if (cached) {
      return NextResponse.json(cached)
    }

    await ensureWarehousesAndVouchersSeeded()

    const [warehouses, settlements] = await Promise.all([
      db.warehouse.findMany({
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: {
          stocks: {
            include: {
              product: {
                select: { id: true, sku: true, name: true, stock: true, sellPrice: true, type: true, unit: true },
              },
            },
          },
        },
      }),
      computeCrossSellSettlements(),
    ])

    const enriched = warehouses.map((wh) => {
      const activeStocks = wh.stocks.filter((s) => s.quantity > 0)
      const totalStock = activeStocks.reduce((sum, s) => sum + s.quantity, 0)
      return {
        ...wh,
        totalStock,
        skuCount: activeStocks.length,
      }
    })

    const payload = {
      warehouses: enriched,
      settlements,
    }
    setApiCache('warehouses:all', payload, 20_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Warehouses GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách kho & shop liên kết' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    invalidateApiCache()
    await ensureWarehousesAndVouchersSeeded()
    const body = await req.json()

    if (body.action === 'TRANSFER') {
      const result = await transferStockBetweenWarehouses({
        productId: String(body.productId ?? ''),
        fromWarehouseId: String(body.fromWarehouseId ?? ''),
        toWarehouseId: String(body.toWarehouseId ?? ''),
        quantity: Number(body.quantity ?? 0),
        note: body.note ? String(body.note) : undefined,
      })
      return NextResponse.json({ transfer: result })
    }

    if (body.action === 'SETTLE_CROSS_SELL') {
      const settlement = await settlePartnerCrossSell({
        warehouseId: String(body.warehouseId ?? ''),
        note: body.note ? String(body.note) : undefined,
      })
      return NextResponse.json({ settlement })
    }

    if (body.action === 'SET_DEFAULT') {
      const warehouseId = String(body.warehouseId ?? '').trim()
      if (!warehouseId) {
        return NextResponse.json({ error: 'Thiếu mã kho cần đặt mặc định' }, { status: 400 })
      }
      await db.$transaction([
        db.warehouse.updateMany({ data: { isDefault: false } }),
        db.warehouse.update({ where: { id: warehouseId }, data: { isDefault: true, active: true } }),
      ])
      return NextResponse.json({ ok: true, warehouseId })
    }

    if (body.action === 'UPDATE_WAREHOUSE') {
      const warehouseId = String(body.warehouseId ?? '').trim()
      if (!warehouseId) {
        return NextResponse.json({ error: 'Thiếu ID kho cần cập nhật' }, { status: 400 })
      }
      const updated = await db.warehouse.update({
        where: { id: warehouseId },
        data: {
          name: body.name ? String(body.name).trim() : undefined,
          code: body.code ? String(body.code).trim().toUpperCase() : undefined,
          type: body.type === 'PARTNER_SHOP' ? 'PARTNER_SHOP' : body.type === 'INTERNAL' ? 'INTERNAL' : undefined,
          managerName: body.managerName !== undefined ? (String(body.managerName).trim() || null) : undefined,
          phone: body.phone !== undefined ? (String(body.phone).trim() || null) : undefined,
          address: body.address !== undefined ? (String(body.address).trim() || null) : undefined,
          commissionPct:
            body.commissionPct !== undefined
              ? Math.max(0, Math.min(80, Number(body.commissionPct) || 0))
              : undefined,
          active: typeof body.active === 'boolean' ? body.active : undefined,
        },
      })
      return NextResponse.json({ warehouse: updated })
    }

    const name = String(body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'Vui lòng nhập tên Kho hoặc Shop liên kết' }, { status: 400 })
    }

    const type = body.type === 'PARTNER_SHOP' ? 'PARTNER_SHOP' : 'INTERNAL'
    const rawCode = String(body.code ?? '').trim().toUpperCase()
    const code =
      rawCode ||
      `${type === 'PARTNER_SHOP' ? 'SHOP' : 'KHO'}-${Date.now().toString().slice(-4)}`

    const commissionPct = Math.max(0, Math.min(80, Number(body.commissionPct ?? (type === 'PARTNER_SHOP' ? 15 : 0)) || 0))

    const warehouse = await db.warehouse.create({
      data: {
        code,
        name,
        type,
        address: body.address ? String(body.address).trim() : null,
        phone: body.phone ? String(body.phone).trim() : null,
        managerName: body.managerName ? String(body.managerName).trim() : null,
        commissionPct,
        isDefault: false,
        active: true,
      },
    })

    await recordLineageChange({
      scope: 'INVENTORY',
      action: 'CREATE_WAREHOUSE',
      entityType: 'Warehouse',
      entityId: warehouse.id,
      entityCode: warehouse.code,
      title: `Thêm ${type === 'PARTNER_SHOP' ? 'Shop liên kết bán chéo' : 'Kho nội bộ'}: ${warehouse.name} (${warehouse.code})`,
      actor: 'OPERATOR',
      actorName: 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      after: {
        code: warehouse.code,
        name: warehouse.name,
        type: warehouse.type,
        commissionPct: warehouse.commissionPct,
      },
    })

    return NextResponse.json({ warehouse }, { status: 201 })
  } catch (error) {
    console.error('Warehouses POST error:', error)
    const msg = error instanceof Error ? error.message : 'Không thể xử lý yêu cầu kho'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
