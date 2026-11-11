import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractClientIp, parseDeviceFromUserAgent } from '@/lib/auth'
import {
  ensureIamSeeded,
  recordBehaviorLog,
  resolveRequestStaffContext,
} from '@/lib/behavior-server'
import { hasDomainAccess } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

function escapeCsvCell(val: unknown): string {
  const s = val === null || val === undefined ? '' : String(val)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// GET /api/behavior-logs — Truy vấn, thống kê phân tích & xuất CSV Nhật ký Hành vi Người dùng
export async function GET(req: NextRequest) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    if (!hasDomainAccess(ctx.permissions, 'system_iam', 'READ')) {
      return NextResponse.json(
        { error: 'Tài khoản của bạn không có quyền xem Nhật ký Hành vi & Bảo mật' },
        { status: 403 }
      )
    }

    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.trim() ?? ''
    const category = searchParams.get('category')?.trim() ?? ''
    const riskLevel = searchParams.get('riskLevel')?.trim() ?? ''
    const status = searchParams.get('status')?.trim() ?? ''
    const userId = searchParams.get('userId')?.trim() ?? ''
    const role = searchParams.get('role')?.trim() ?? ''
    const mod = searchParams.get('module')?.trim() ?? ''
    const days = Number(searchParams.get('days')) || 0
    const format = searchParams.get('format')?.trim() ?? 'json'
    const limit = Math.min(500, Math.max(10, Number(searchParams.get('limit')) || 150))

    const where: Record<string, unknown> = {}
    if (category && category !== 'ALL') where.category = category
    if (riskLevel && riskLevel !== 'ALL') where.riskLevel = riskLevel
    if (status && status !== 'ALL') where.status = status
    if (userId && userId !== 'ALL') where.userId = userId
    if (role && role !== 'ALL') where.actorRole = role
    if (mod && mod !== 'ALL') where.module = mod
    if (days > 0) {
      where.createdAt = { gte: new Date(Date.now() - days * 24 * 3600 * 1000) }
    }
    if (q) {
      where.OR = [
        { summary: { contains: q } },
        { actorName: { contains: q } },
        { username: { contains: q } },
        { path: { contains: q } },
        { ipAddress: { contains: q } },
        { targetCode: { contains: q } },
        { action: { contains: q } },
      ]
    }

    // Xuất CSV kèm UTF-8 BOM cho Excel tiếng Việt
    if (format === 'csv') {
      const rows = await db.behaviorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 1000,
      })

      const ip = extractClientIp(req.headers)
      const ua = req.headers.get('user-agent') ?? ''
      await recordBehaviorLog({
        userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
        sessionId: ctx.sessionId,
        username: ctx.user?.username ?? 'admin',
        actorName: ctx.user?.displayName ?? 'Quản trị viên',
        actorRole: ctx.user?.role ?? 'ADMIN',
        category: 'EXPORT',
        action: 'DATA_EXPORT',
        module: 'iam',
        method: 'GET',
        path: '/api/behavior-logs?format=csv',
        summary: `Xuất tệp CSV Nhật ký Hành vi (${rows.length} bản ghi)`,
        metadata: { exportedCount: rows.length, filterCategory: category || 'ALL' },
        riskLevel: 'LOW',
        status: 'SUCCESS',
        statusCode: 200,
        ipAddress: ip,
        deviceType: parseDeviceFromUserAgent(ua).deviceType,
        userAgent: ua,
      })

      const header = [
        'Thời gian',
        'Nhân sự',
        'Tài khoản',
        'Vai trò',
        'Nhóm hành vi',
        'Mã hành động',
        'Phân hệ',
        'Phương thức',
        'Đường dẫn',
        'Trạng thái',
        'Mức rủi ro',
        'Thời lượng (ms)',
        'Thiết bị',
        'Địa chỉ IP',
        'Mô tả hành vi',
      ].join(',')

      const csvLines = rows.map((r) =>
        [
          r.createdAt.toISOString(),
          r.actorName,
          r.username ?? '',
          r.actorRole,
          r.category,
          r.action,
          r.module ?? '',
          r.method ?? '',
          r.path ?? '',
          r.status,
          r.riskLevel,
          r.durationMs ?? '',
          r.deviceType ?? '',
          r.ipAddress ?? '',
          r.summary,
        ]
          .map(escapeCsvCell)
          .join(',')
      )

      const csvContent = `\uFEFF${header}\n${csvLines.join('\n')}`
      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="nhat-ky-hanh-vi-uudam-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    const since24h = new Date(Date.now() - 24 * 3600 * 1000)

    const [
      logs,
      totalFiltered,
      total24h,
      auth24h,
      mutations24h,
      alerts24h,
      mobile24h,
      desktop24h,
      categoryGroups,
      recentForAgg,
    ] = await Promise.all([
      db.behaviorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.behaviorLog.count({ where }),
      db.behaviorLog.count({ where: { createdAt: { gte: since24h } } }),
      db.behaviorLog.count({
        where: { createdAt: { gte: since24h }, category: 'AUTH' },
      }),
      db.behaviorLog.count({
        where: { createdAt: { gte: since24h }, category: 'MUTATION' },
      }),
      db.behaviorLog.count({
        where: {
          createdAt: { gte: since24h },
          OR: [
            { riskLevel: 'HIGH' },
            { status: 'DENIED' },
            { status: 'FAILED' },
          ],
        },
      }),
      db.behaviorLog.count({
        where: { createdAt: { gte: since24h }, deviceType: { in: ['MOBILE', 'TABLET'] } },
      }),
      db.behaviorLog.count({
        where: { createdAt: { gte: since24h }, deviceType: 'DESKTOP' },
      }),
      db.behaviorLog.groupBy({
        by: ['category'],
        _count: { _all: true },
      }),
      db.behaviorLog.findMany({
        where: { createdAt: { gte: since24h } },
        select: {
          actorName: true,
          username: true,
          actorRole: true,
          module: true,
          durationMs: true,
        },
        take: 600,
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const actorMap = new Map<
      string,
      { key: string; actorName: string; username: string | null; role: string; count: number }
    >()
    const moduleMap = new Map<
      string,
      { module: string; count: number; totalDurationMs: number }
    >()

    for (const item of recentForAgg) {
      const aKey = item.username || item.actorName
      const prevA = actorMap.get(aKey)
      if (prevA) {
        prevA.count += 1
      } else {
        actorMap.set(aKey, {
          key: aKey,
          actorName: item.actorName,
          username: item.username,
          role: item.actorRole,
          count: 1,
        })
      }

      if (item.module) {
        const prevM = moduleMap.get(item.module)
        if (prevM) {
          prevM.count += 1
          prevM.totalDurationMs += item.durationMs ?? 0
        } else {
          moduleMap.set(item.module, {
            module: item.module,
            count: 1,
            totalDurationMs: item.durationMs ?? 0,
          })
        }
      }
    }

    const byCategory: Record<string, number> = {}
    for (const cg of categoryGroups) {
      byCategory[cg.category] = cg._count._all
    }

    return NextResponse.json({
      logs,
      totalFiltered,
      stats: {
        total24h,
        auth24h,
        mutations24h,
        alerts24h,
        mobile24h,
        desktop24h,
        byCategory,
        topActors: Array.from(actorMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 5),
        topModules: Array.from(moduleMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, 6),
      },
    })
  } catch (error) {
    console.error('BehaviorLog GET error:', error)
    return NextResponse.json({ error: 'Không thể tải Nhật ký Hành vi' }, { status: 500 })
  }
}

// POST /api/behavior-logs — Nhận sự kiện hành vi giao diện (Chuyển màn hình, Tìm kiếm, Xuất file, In ấn)
export async function POST(req: NextRequest) {
  try {
    const ctx = await resolveRequestStaffContext(req)
    const body = (await req.json().catch(() => ({}))) as {
      category?: string
      action?: string
      module?: string
      path?: string
      targetType?: string
      targetCode?: string
      summary?: string
      durationMs?: number
      metadata?: Record<string, unknown>
    }

    const allowedActions = new Set([
      'VIEW_MODULE',
      'QUICK_SEARCH',
      'DATA_EXPORT',
      'PRINT_DOCUMENT',
      'ACCESS_BLOCKED_UI',
    ])
    const action = String(body.action ?? '').trim()
    if (!allowedActions.has(action)) {
      return NextResponse.json({ ok: false, skipped: true })
    }

    // Nếu quản trị tắt theo dõi chuyển màn hình thì bỏ qua VIEW_MODULE
    if (action === 'VIEW_MODULE' && !ctx.trackNavigation) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''
    const { deviceType, deviceLabel } = parseDeviceFromUserAgent(ua)

    const isBlockedUi = action === 'ACCESS_BLOCKED_UI'
    const category = isBlockedUi
      ? 'SECURITY'
      : action === 'DATA_EXPORT' || action === 'PRINT_DOCUMENT'
        ? 'EXPORT'
        : 'NAVIGATION'

    void recordBehaviorLog({
      userId:
        ctx.user && !ctx.user.id.startsWith('internal') && !ctx.user.id.startsWith('apikey:')
          ? ctx.user.id
          : null,
      sessionId: ctx.sessionId,
      username: ctx.user?.username ?? null,
      actorName: ctx.user?.displayName ?? 'Khách chưa đăng nhập',
      actorRole: ctx.user?.role ?? 'ANONYMOUS',
      category,
      action: isBlockedUi ? 'PERMISSION_DENIED' : action,
      module: body.module?.slice(0, 48) ?? null,
      method: 'UI',
      path: body.path?.slice(0, 200) ?? '/',
      targetType: body.targetType?.slice(0, 48) ?? null,
      targetCode: body.targetCode?.slice(0, 64) ?? null,
      summary: String(body.summary ?? action).slice(0, 280),
      metadata: {
        ...(body.metadata ?? {}),
        deviceLabel,
      },
      riskLevel: isBlockedUi ? 'MEDIUM' : 'LOW',
      status: isBlockedUi ? 'DENIED' : 'SUCCESS',
      statusCode: isBlockedUi ? 403 : 200,
      durationMs: body.durationMs,
      ipAddress: ip,
      deviceType,
      userAgent: ua,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
