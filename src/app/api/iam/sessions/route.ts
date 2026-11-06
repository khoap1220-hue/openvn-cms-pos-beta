import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractClientIp, parseDeviceFromUserAgent } from '@/lib/auth'
import {
  ensureIamSeeded,
  recordBehaviorLog,
  resolveRequestStaffContext,
} from '@/lib/behavior-server'
import { ROLE_DEFINITIONS, hasDomainAccess, isValidRole } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

// GET /api/iam/sessions — Danh sách các phiên đăng nhập đang hoạt động & gần đây
export async function GET(req: NextRequest) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    const canViewAll = hasDomainAccess(ctx.permissions, 'system_iam', 'READ')

    if (!canViewAll && !ctx.authenticated) {
      return NextResponse.json({ error: 'Vui lòng đăng nhập để xem phiên hoạt động' }, { status: 401 })
    }

    const where = canViewAll
      ? {}
      : { userId: ctx.user?.id ?? '__none__' }

    const sessions = await db.staffSession.findMany({
      where,
      orderBy: [{ revokedAt: 'asc' }, { lastActiveAt: 'desc' }],
      take: 80,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            avatarColor: true,
            status: true,
          },
        },
      },
    })

    const now = Date.now()
    const formatted = sessions.map((s) => {
      const role = isValidRole(s.user.role) ? s.user.role : 'CASHIER_POS'
      const isExpired = s.expiresAt.getTime() < now
      const isActive = !s.revokedAt && !isExpired && s.user.status === 'ACTIVE'
      return {
        id: s.id,
        userId: s.userId,
        username: s.user.username,
        displayName: s.user.displayName,
        role,
        roleLabel: ROLE_DEFINITIONS[role].shortLabel,
        avatarColor: s.user.avatarColor,
        ipAddress: s.ipAddress ?? '127.0.0.1',
        deviceType: s.deviceType,
        deviceLabel: s.deviceLabel ?? 'Trình duyệt Web',
        isCurrent: s.id === ctx.sessionId,
        isActive,
        revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
        revokedReason: s.revokedReason,
        lastActiveAt: s.lastActiveAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        createdAt: s.createdAt.toISOString(),
      }
    })

    return NextResponse.json({
      sessions: formatted,
      activeCount: formatted.filter((s) => s.isActive).length,
    })
  } catch (error) {
    console.error('IAM sessions GET error:', error)
    return NextResponse.json({ error: 'Không thể tải danh sách phiên đăng nhập' }, { status: 500 })
  }
}

// DELETE /api/iam/sessions?id=... | ?scope=others — Thu hồi phiên đăng nhập từ xa
export async function DELETE(req: NextRequest) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    const canManageAll = hasDomainAccess(ctx.permissions, 'system_iam', 'FULL')

    if (!canManageAll && !ctx.authenticated) {
      return NextResponse.json({ error: 'Không có quyền thu hồi phiên' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const targetSessionId = searchParams.get('id')
    const scope = searchParams.get('scope')

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''

    if (scope === 'others') {
      const where = canManageAll
        ? {
            revokedAt: null,
            ...(ctx.sessionId ? { id: { not: ctx.sessionId } } : {}),
          }
        : {
            userId: ctx.user?.id ?? '__none__',
            revokedAt: null,
            ...(ctx.sessionId ? { id: { not: ctx.sessionId } } : {}),
          }

      const res = await db.staffSession.updateMany({
        where,
        data: { revokedAt: new Date(), revokedReason: 'REVOKE_OTHER_DEVICES' },
      })

      await recordBehaviorLog({
        userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
        sessionId: ctx.sessionId,
        username: ctx.user?.username ?? 'admin',
        actorName: ctx.user?.displayName ?? 'Quản trị viên',
        actorRole: ctx.user?.role ?? 'ADMIN',
        category: 'SECURITY',
        action: 'SESSION_REVOKED',
        module: 'iam',
        method: 'DELETE',
        path: '/api/iam/sessions?scope=others',
        summary: `Thu hồi từ xa ${res.count} phiên đăng nhập trên các thiết bị khác`,
        metadata: { revokedCount: res.count },
        riskLevel: 'MEDIUM',
        status: 'SUCCESS',
        statusCode: 200,
        ipAddress: ip,
        deviceType: parseDeviceFromUserAgent(ua).deviceType,
        userAgent: ua,
      })

      return NextResponse.json({ ok: true, revokedCount: res.count })
    }

    if (!targetSessionId) {
      return NextResponse.json({ error: 'Thiếu mã phiên cần thu hồi' }, { status: 400 })
    }

    const target = await db.staffSession.findUnique({
      where: { id: targetSessionId },
      include: { user: { select: { username: true, displayName: true } } },
    })
    if (!target) {
      return NextResponse.json({ error: 'Không tìm thấy phiên đăng nhập' }, { status: 404 })
    }

    if (!canManageAll && target.userId !== ctx.user?.id) {
      return NextResponse.json(
        { error: 'Bạn chỉ có thể thu hồi phiên đăng nhập của chính mình' },
        { status: 403 }
      )
    }

    await db.staffSession.update({
      where: { id: target.id },
      data: { revokedAt: new Date(), revokedReason: 'REMOTE_ADMIN_REVOKE' },
    })

    await recordBehaviorLog({
      userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
      sessionId: ctx.sessionId,
      username: ctx.user?.username ?? 'admin',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      actorRole: ctx.user?.role ?? 'ADMIN',
      category: 'SECURITY',
      action: 'SESSION_REVOKED',
      module: 'iam',
      method: 'DELETE',
      path: `/api/iam/sessions?id=${target.id}`,
      targetType: 'StaffSession',
      targetCode: target.user.username,
      summary: `Thu hồi phiên đăng nhập của ${target.user.displayName} (@${target.user.username} · ${target.deviceLabel ?? 'Web'})`,
      metadata: {
        revokedSessionId: target.id,
        targetUsername: target.user.username,
        deviceLabel: target.deviceLabel,
      },
      riskLevel: 'MEDIUM',
      status: 'SUCCESS',
      statusCode: 200,
      ipAddress: ip,
      deviceType: parseDeviceFromUserAgent(ua).deviceType,
      userAgent: ua,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('IAM sessions DELETE error:', error)
    return NextResponse.json({ error: 'Không thể thu hồi phiên đăng nhập' }, { status: 500 })
  }
}
