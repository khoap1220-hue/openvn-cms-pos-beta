import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  extractClientIp,
  hashPassword,
  hashPin,
  parseDeviceFromUserAgent,
} from '@/lib/auth'
import {
  ensureIamSeeded,
  recordBehaviorLog,
  resolveRequestStaffContext,
} from '@/lib/behavior-server'
import {
  ROLE_DEFINITIONS,
  hasDomainAccess,
  isValidRole,
  parseCustomPermissions,
  resolveEffectivePermissions,
} from '@/lib/rbac'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// GET /api/iam/users — Danh sách nhân sự, vai trò phân quyền & thống kê phiên hoạt động
export async function GET(req: NextRequest) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    if (!hasDomainAccess(ctx.permissions, 'system_iam', 'READ')) {
      return NextResponse.json(
        { error: 'Tài khoản của bạn không có quyền xem danh sách nhân sự & phân quyền' },
        { status: 403 }
      )
    }

    const now = new Date()
    const [users, warehouses] = await Promise.all([
      db.staffUser.findMany({
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        include: {
          sessions: {
            where: { revokedAt: null, expiresAt: { gt: now } },
            select: { id: true, deviceLabel: true, lastActiveAt: true },
          },
          _count: {
            select: { behaviorLogs: true },
          },
        },
      }),
      db.warehouse.findMany({
        where: { active: true },
        select: { id: true, code: true, name: true },
        orderBy: { isDefault: 'desc' },
      }),
    ])

    const formatted = users.map((u) => {
      const role = isValidRole(u.role) ? u.role : 'CASHIER_POS'
      const customOverrides = parseCustomPermissions(u.customPermissions)
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        email: u.email,
        phone: u.phone,
        avatarColor: u.avatarColor,
        role,
        roleLabel: ROLE_DEFINITIONS[role].shortLabel,
        hasPin: Boolean(u.pinHash),
        customPermissions: customOverrides,
        effectivePermissions: resolveEffectivePermissions(role, customOverrides),
        allowedWarehouseId: u.allowedWarehouseId,
        status: u.status,
        failedLoginCount: u.failedLoginCount,
        lockedUntil: u.lockedUntil ? u.lockedUntil.toISOString() : null,
        lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
        lastLoginIp: u.lastLoginIp,
        lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
        note: u.note,
        activeSessionsCount: u.sessions.length,
        behaviorLogsCount: u._count.behaviorLogs,
        createdAt: u.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      users: formatted,
      warehouses,
    })
  } catch (error) {
    console.error('IAM users GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách nhân sự' }, { status: 500 })
  }
}

// POST /api/iam/users — Tạo tài khoản nhân sự mới với vai trò & phân quyền tùy chỉnh
export async function POST(req: NextRequest) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    if (!hasDomainAccess(ctx.permissions, 'system_iam', 'FULL')) {
      return NextResponse.json(
        { error: 'Chỉ Chủ tiệm / Quản trị viên tối cao mới có quyền tạo tài khoản nhân sự' },
        { status: 403 }
      )
    }

    const body = (await req.json().catch(() => ({}))) as {
      username?: string
      displayName?: string
      email?: string
      phone?: string
      avatarColor?: string
      role?: string
      password?: string
      pin?: string
      allowedWarehouseId?: string | null
      customPermissions?: Record<string, string> | null
      note?: string
    }

    const username = String(body.username ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '')
    const displayName = String(body.displayName ?? '').trim()
    const password = String(body.password ?? '').trim()
    const pin = String(body.pin ?? '').trim()
    const role = isValidRole(body.role) ? body.role : 'CASHIER_POS'

    if (username.length < 3 || username.length > 32) {
      return NextResponse.json(
        { error: 'Tên đăng nhập phải từ 3–32 ký tự (chữ thường, số, dấu chấm hoặc gạch dưới)' },
        { status: 400 }
      )
    }
    if (!displayName) {
      return NextResponse.json({ error: 'Vui lòng nhập họ tên hiển thị của nhân sự' }, { status: 400 })
    }
    if (password.length < 4) {
      return NextResponse.json(
        { error: 'Mật khẩu khởi tạo phải có ít nhất 4 ký tự' },
        { status: 400 }
      )
    }
    if (pin && !/^\d{4,6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'Mã PIN ca trực phải gồm 4 đến 6 chữ số' },
        { status: 400 }
      )
    }

    const duplicate = await db.staffUser.findUnique({ where: { username } })
    if (duplicate) {
      return NextResponse.json(
        { error: `Tên đăng nhập "${username}" đã tồn tại trong hệ thống` },
        { status: 409 }
      )
    }

    const passwordHash = await hashPassword(password)
    const pinHash = pin ? await hashPin(username, pin) : null
    const cleanOverrides = parseCustomPermissions(body.customPermissions as never)
    const customPermStr =
      Object.keys(cleanOverrides).length > 0 ? JSON.stringify(cleanOverrides) : null

    const created = await db.staffUser.create({
      data: {
        username,
        displayName,
        email: body.email?.trim() || null,
        phone: body.phone?.trim() || null,
        avatarColor: body.avatarColor?.trim() || '#0066CC',
        role,
        passwordHash,
        pinHash,
        customPermissions: customPermStr,
        allowedWarehouseId: body.allowedWarehouseId || null,
        note: body.note?.trim() || null,
        status: 'ACTIVE',
      },
    })

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''

    await recordBehaviorLog({
      userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
      sessionId: ctx.sessionId,
      username: ctx.user?.username ?? 'admin',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      actorRole: ctx.user?.role ?? 'ADMIN',
      category: 'IAM',
      action: 'USER_CREATED',
      module: 'iam',
      method: 'POST',
      path: '/api/iam/users',
      targetType: 'StaffUser',
      targetCode: created.username,
      summary: `Tạo mới tài khoản nhân sự "${created.displayName}" (@${created.username}) — Vai trò: ${ROLE_DEFINITIONS[role].shortLabel}`,
      metadata: {
        createdUsername: created.username,
        displayName: created.displayName,
        role,
        hasPin: Boolean(pinHash),
        customPermissions: cleanOverrides,
      },
      riskLevel: 'MEDIUM',
      status: 'SUCCESS',
      statusCode: 201,
      ipAddress: ip,
      deviceType: parseDeviceFromUserAgent(ua).deviceType,
      userAgent: ua,
    })

    await logLedger({
      scope: 'SYSTEM',
      action: 'STAFF_USER_CREATED',
      actor: 'OPERATOR',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      entityType: 'StaffUser',
      entityId: created.id,
      entityCode: created.username,
      title: `Tạo tài khoản nhân sự ${created.displayName} (@${created.username} · ${ROLE_DEFINITIONS[role].shortLabel})`,
    })

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: created.id,
          username: created.username,
          displayName: created.displayName,
          role,
        },
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('IAM users POST error:', error)
    return NextResponse.json({ error: 'Không thể tạo tài khoản nhân sự' }, { status: 500 })
  }
}
