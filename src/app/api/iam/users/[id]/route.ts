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
} from '@/lib/rbac'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// PATCH /api/iam/users/[id] — Cập nhật hồ sơ, vai trò, quyền ngoại lệ, khóa/mở tài khoản hoặc cấp lại mật khẩu/PIN
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    if (!hasDomainAccess(ctx.permissions, 'system_iam', 'FULL')) {
      return NextResponse.json(
        { error: 'Chỉ Chủ tiệm / Quản trị viên tối cao mới có quyền chỉnh sửa nhân sự & phân quyền' },
        { status: 403 }
      )
    }

    const { id } = await context.params
    const existing = await db.staffUser.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản nhân sự' }, { status: 404 })
    }

    const body = (await req.json().catch(() => ({}))) as {
      displayName?: string
      email?: string | null
      phone?: string | null
      avatarColor?: string
      role?: string
      status?: 'ACTIVE' | 'LOCKED'
      unlockBruteForce?: boolean
      newPassword?: string
      newPin?: string | null
      allowedWarehouseId?: string | null
      customPermissions?: Record<string, string> | null
      note?: string | null
    }

    // Bảo vệ an toàn: không cho phép khóa hoặc hạ quyền tài khoản Quản trị tối cao cuối cùng
    const isDemotingOrLockingAdmin =
      existing.role === 'ADMIN' &&
      ((body.role && body.role !== 'ADMIN') || body.status === 'LOCKED')

    if (isDemotingOrLockingAdmin) {
      const activeAdmins = await db.staffUser.count({
        where: { role: 'ADMIN', status: 'ACTIVE', id: { not: existing.id } },
      })
      if (activeAdmins === 0) {
        return NextResponse.json(
          {
            error:
              'Không thể khóa hoặc hạ quyền Quản trị viên tối cao duy nhất đang hoạt động của hệ thống.',
          },
          { status: 400 }
        )
      }
    }

    const updates: Record<string, unknown> = {}
    const changeNotes: string[] = []

    if (body.displayName !== undefined) {
      const dn = String(body.displayName).trim()
      if (!dn) {
        return NextResponse.json({ error: 'Họ tên hiển thị không được để trống' }, { status: 400 })
      }
      if (dn !== existing.displayName) {
        updates.displayName = dn
        changeNotes.push(`tên hiển thị → "${dn}"`)
      }
    }

    if (body.email !== undefined) updates.email = body.email?.trim() || null
    if (body.phone !== undefined) updates.phone = body.phone?.trim() || null
    if (body.avatarColor !== undefined && body.avatarColor.trim()) {
      updates.avatarColor = body.avatarColor.trim()
    }
    if (body.allowedWarehouseId !== undefined) {
      updates.allowedWarehouseId = body.allowedWarehouseId || null
    }
    if (body.note !== undefined) updates.note = body.note?.trim() || null

    let actionType = 'USER_UPDATED'
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM'

    if (body.role !== undefined && isValidRole(body.role) && body.role !== existing.role) {
      updates.role = body.role
      actionType = 'ROLE_CHANGED'
      riskLevel = 'HIGH'
      changeNotes.push(
        `vai trò ${existing.role} → ${ROLE_DEFINITIONS[body.role].shortLabel} (${body.role})`
      )
    }

    if (body.customPermissions !== undefined) {
      const clean = parseCustomPermissions(body.customPermissions as never)
      updates.customPermissions = Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
      changeNotes.push('cập nhật quyền ngoại lệ chi tiết')
    }

    if (body.status === 'ACTIVE' || body.status === 'LOCKED') {
      if (body.status !== existing.status) {
        updates.status = body.status
        if (body.status === 'LOCKED') {
          actionType = 'USER_LOCKED'
          riskLevel = 'HIGH'
          changeNotes.push('KHÓA tài khoản & thu hồi phiên')
        } else {
          updates.failedLoginCount = 0
          updates.lockedUntil = null
          changeNotes.push('MỞ KHÓA tài khoản')
        }
      }
    }

    if (body.unlockBruteForce) {
      updates.failedLoginCount = 0
      updates.lockedUntil = null
      changeNotes.push('gỡ khóa tạm đăng nhập sai')
    }

    if (body.newPassword && String(body.newPassword).trim()) {
      const pwd = String(body.newPassword).trim()
      if (pwd.length < 4) {
        return NextResponse.json(
          { error: 'Mật khẩu cấp lại phải từ 4 ký tự trở lên' },
          { status: 400 }
        )
      }
      updates.passwordHash = await hashPassword(pwd)
      updates.failedLoginCount = 0
      updates.lockedUntil = null
      changeNotes.push('đặt lại mật khẩu')
    }

    if (body.newPin !== undefined) {
      if (body.newPin === null || String(body.newPin).trim() === '') {
        updates.pinHash = null
        changeNotes.push('xóa mã PIN POS')
      } else {
        const pin = String(body.newPin).trim()
        if (!/^\d{4,6}$/.test(pin)) {
          return NextResponse.json(
            { error: 'Mã PIN ca trực phải gồm 4–6 chữ số' },
            { status: 400 }
          )
        }
        updates.pinHash = await hashPin(existing.username, pin)
        changeNotes.push('cập nhật mã PIN POS')
      }
    }

    const updated = await db.staffUser.update({
      where: { id: existing.id },
      data: updates,
    })

    // Nếu khóa tài khoản → tự động thu hồi ngay mọi phiên đang đăng nhập của nhân sự này
    let revokedSessionsCount = 0
    if (body.status === 'LOCKED') {
      const rev = await db.staffSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'ACCOUNT_LOCKED_BY_ADMIN' },
      })
      revokedSessionsCount = rev.count
    }

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''

    await recordBehaviorLog({
      userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
      sessionId: ctx.sessionId,
      username: ctx.user?.username ?? 'admin',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      actorRole: ctx.user?.role ?? 'ADMIN',
      category: 'IAM',
      action: actionType,
      module: 'iam',
      method: 'PATCH',
      path: `/api/iam/users/${existing.id}`,
      targetType: 'StaffUser',
      targetCode: updated.username,
      summary: `Cập nhật nhân sự @${updated.username} (${updated.displayName}): ${changeNotes.join(', ') || 'lưu thông tin hồ sơ'}`,
      metadata: {
        targetUsername: updated.username,
        changes: changeNotes,
        newRole: updated.role,
        newStatus: updated.status,
        revokedSessionsCount,
      },
      riskLevel,
      status: 'SUCCESS',
      statusCode: 200,
      ipAddress: ip,
      deviceType: parseDeviceFromUserAgent(ua).deviceType,
      userAgent: ua,
    })

    await logLedger({
      scope: 'SYSTEM',
      action: actionType,
      actor: 'OPERATOR',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      originSource: 'MANUAL_ADMIN',
      entityType: 'StaffUser',
      entityId: updated.id,
      entityCode: updated.username,
      title: `Cập nhật tài khoản @${updated.username}: ${changeNotes.join(', ') || 'hồ sơ nhân sự'}`,
    })

    return NextResponse.json({
      ok: true,
      revokedSessionsCount,
      user: {
        id: updated.id,
        username: updated.username,
        displayName: updated.displayName,
        role: updated.role,
        status: updated.status,
      },
    })
  } catch (error) {
    console.error('IAM user PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật tài khoản nhân sự' }, { status: 500 })
  }
}

// DELETE /api/iam/users/[id] — Xóa tài khoản nhân sự
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    await ensureIamSeeded()
    const ctx = await resolveRequestStaffContext(req)
    if (!hasDomainAccess(ctx.permissions, 'system_iam', 'FULL')) {
      return NextResponse.json(
        { error: 'Chỉ Chủ tiệm / Quản trị viên tối cao mới có quyền xóa tài khoản nhân sự' },
        { status: 403 }
      )
    }

    const { id } = await context.params
    const existing = await db.staffUser.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản nhân sự' }, { status: 404 })
    }

    if (existing.username === 'admin') {
      return NextResponse.json(
        { error: 'Không thể xóa tài khoản Quản trị viên gốc (@admin)' },
        { status: 400 }
      )
    }
    if (ctx.user?.id === existing.id) {
      return NextResponse.json(
        { error: 'Không thể tự xóa tài khoản đang đăng nhập hiện tại' },
        { status: 400 }
      )
    }

    await db.staffUser.delete({ where: { id: existing.id } })

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''

    await recordBehaviorLog({
      userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
      sessionId: ctx.sessionId,
      username: ctx.user?.username ?? 'admin',
      actorName: ctx.user?.displayName ?? 'Quản trị viên',
      actorRole: ctx.user?.role ?? 'ADMIN',
      category: 'IAM',
      action: 'USER_DELETED',
      module: 'iam',
      method: 'DELETE',
      path: `/api/iam/users/${existing.id}`,
      targetType: 'StaffUser',
      targetCode: existing.username,
      summary: `Đã xóa tài khoản nhân sự @${existing.username} (${existing.displayName})`,
      riskLevel: 'HIGH',
      status: 'SUCCESS',
      statusCode: 200,
      ipAddress: ip,
      deviceType: parseDeviceFromUserAgent(ua).deviceType,
      userAgent: ua,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('IAM user DELETE error:', error)
    return NextResponse.json({ error: 'Không thể xóa tài khoản nhân sự' }, { status: 500 })
  }
}

export const PUT = PATCH
