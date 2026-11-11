import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  AUTH_LOCK_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  extractClientIp,
  hashPassword,
  hashPin,
  parseDeviceFromUserAgent,
  signSessionToken,
} from '@/lib/auth'
import {
  ensureIamSeeded,
  getCachedSecurityPolicy,
  invalidateStaffContextCache,
  recordBehaviorLog,
  resolveRequestStaffContext,
} from '@/lib/behavior-server'
import { getApiCache, invalidateApiCache, setApiCache } from '@/lib/realtime'
import {
  ROLE_DEFINITIONS,
  type RoleKey,
  hasDomainAccess,
  isValidRole,
  resolveEffectivePermissions,
  resolveFirstAllowedView,
} from '@/lib/rbac'
import { logLedger } from '@/lib/ledger'

export const dynamic = 'force-dynamic'

// GET /api/auth — Kiểm tra phiên đăng nhập, quyền RBAC hiện hành & gợi ý danh sách tài khoản ca trực
export async function GET(req: NextRequest) {
  try {
    const ctx = await resolveRequestStaffContext(req)
    const { searchParams } = new URL(req.url)

    // Chế độ kiểm tra phiên siêu tốc cho src/proxy.ts
    if (req.headers.get('x-session-check') === '1') {
      return NextResponse.json({
        valid: ctx.authenticated && !ctx.revokedOrLocked,
        revokedOrLocked: ctx.revokedOrLocked,
        authRequired: ctx.authRequired,
        role: ctx.user?.role ?? null,
        permissions: ctx.permissions,
      })
    }

    let accountHints: Array<{
      username: string
      displayName: string
      role: string
      roleLabel: string
      avatarColor: string
      hasPin: boolean
      status: string
    }> = []

    if (searchParams.get('hints') === '1' && ctx.showQuickLoginHints) {
      const cachedHints = getApiCache<typeof accountHints>('auth:hints')
      if (cachedHints) {
        accountHints = cachedHints
      } else {
        const users = await db.staffUser.findMany({
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 12,
          select: {
            username: true,
            displayName: true,
            role: true,
            avatarColor: true,
            pinHash: true,
            status: true,
          },
        })
        accountHints = users.map((u) => ({
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          roleLabel: isValidRole(u.role) ? ROLE_DEFINITIONS[u.role].shortLabel : u.role,
          avatarColor: u.avatarColor,
          hasPin: Boolean(u.pinHash),
          status: u.status,
        }))
        setApiCache('auth:hints', accountHints, 45_000)
      }
    }

    const policy = await getCachedSecurityPolicy()
    let hasLegacyPwd = getApiCache<boolean>('auth:legacyPwd')
    if (hasLegacyPwd === null) {
      const legacyPwdRow = await db.appSetting
        .findUnique({ where: { key: 'admin_password_hash' } })
        .catch(() => null)
      hasLegacyPwd = Boolean(legacyPwdRow?.value)
      setApiCache('auth:legacyPwd', hasLegacyPwd, 60_000)
    }

    const payload = {
      authenticated: ctx.authenticated,
      revokedOrLocked: ctx.revokedOrLocked,
      mode: ctx.mode,
      sessionId: ctx.sessionId,
      role: ctx.user?.role ?? null,
      user: ctx.user
        ? {
            id: ctx.user.id,
            username: ctx.user.username,
            displayName: ctx.user.displayName,
            role: ctx.user.role,
            roleLabel: ROLE_DEFINITIONS[ctx.user.role].shortLabel,
            avatarColor: ctx.user.avatarColor,
            email: ctx.user.email,
            phone: ctx.user.phone,
            allowedWarehouseId: ctx.user.allowedWarehouseId,
          }
        : null,
      permissions: ctx.permissions,
      hasCustomPassword: hasLegacyPwd || ctx.authenticated,
      authRequired: ctx.authRequired,
      trackNavigation: ctx.trackNavigation,
      showQuickLoginHints: ctx.showQuickLoginHints,
      policy: policy
        ? {
            authRequired: policy.authRequired,
            maxFailedAttempts: policy.maxFailedAttempts,
            lockoutMinutes: policy.lockoutMinutes,
            sessionTtlDays: policy.sessionTtlDays,
            showQuickLoginHints: policy.showQuickLoginHints,
            trackNavigation: policy.trackNavigation,
          }
        : null,
      accountHints,
    }

    if (!ctx.revokedOrLocked) {
      const sessionToken = req.cookies.get(SESSION_COOKIE_NAME)?.value || '__anon__'
      const authKey = `auth:${sessionToken}:${searchParams.toString()}`
      setApiCache(authKey, payload, 30_000)
    }

    const res = NextResponse.json(payload)

    if (ctx.revokedOrLocked) {
      res.cookies.delete(SESSION_COOKIE_NAME)
    }

    return res
  } catch (error) {
    console.error('Auth GET error:', error)
    return NextResponse.json({ error: 'Không thể kiểm tra xác thực' }, { status: 500 })
  }
}

// POST /api/auth — Đăng nhập bằng Tài khoản + Mật khẩu hoặc Mã PIN Ca trực (POS)
export async function POST(req: NextRequest) {
  try {
    invalidateStaffContextCache()
    await ensureIamSeeded()

    const body = (await req.json().catch(() => ({}))) as {
      mode?: 'password' | 'pin'
      username?: string
      password?: string
      pin?: string
    }

    const loginMode = body.mode === 'pin' ? 'pin' : 'password'
    // Giữ tương thích ngược: nếu chỉ truyền { password } thì mặc định đăng nhập tài khoản 'admin'
    const rawIdentifier = String(body.username ?? 'admin').trim().toLowerCase()
    const password = String(body.password ?? '').trim()
    const pin = String(body.pin ?? '').trim()

    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''
    const { deviceType, deviceLabel } = parseDeviceFromUserAgent(ua)

    if (!rawIdentifier) {
      return NextResponse.json({ error: 'Vui lòng nhập tên đăng nhập hoặc chọn nhân viên' }, { status: 400 })
    }
    if (loginMode === 'password' && !password) {
      return NextResponse.json({ error: 'Vui lòng nhập mật khẩu đăng nhập' }, { status: 400 })
    }
    if (loginMode === 'pin' && !pin) {
      return NextResponse.json({ error: 'Vui lòng nhập mã PIN ca trực (4–6 số)' }, { status: 400 })
    }

    const policy = await db.securityPolicy.findUnique({ where: { id: 'default' } })
    const maxFailed = policy?.maxFailedAttempts ?? 5
    const lockoutMinutes = policy?.lockoutMinutes ?? 10
    const sessionTtlDays = policy?.sessionTtlDays ?? 14

    const user = await db.staffUser.findFirst({
      where: {
        OR: [
          { username: rawIdentifier },
          { email: rawIdentifier },
          { phone: rawIdentifier },
        ],
      },
    })

    if (!user) {
      await recordBehaviorLog({
        username: rawIdentifier,
        actorName: `Chưa xác định (${rawIdentifier})`,
        actorRole: 'ANONYMOUS',
        category: 'SECURITY',
        action: 'LOGIN_FAILED',
        module: 'auth',
        method: 'POST',
        path: '/api/auth',
        summary: `Đăng nhập thất bại: Không tồn tại tài khoản "${rawIdentifier}"`,
        metadata: { identifier: rawIdentifier, loginMode, deviceLabel },
        riskLevel: 'MEDIUM',
        status: 'FAILED',
        statusCode: 401,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })
      return NextResponse.json(
        { error: 'Tài khoản hoặc thông tin đăng nhập không chính xác' },
        { status: 401 }
      )
    }

    if (user.status !== 'ACTIVE') {
      await recordBehaviorLog({
        userId: user.id,
        username: user.username,
        actorName: user.displayName,
        actorRole: user.role,
        category: 'SECURITY',
        action: 'LOGIN_LOCKED',
        module: 'auth',
        method: 'POST',
        path: '/api/auth',
        summary: `Chặn đăng nhập: Tài khoản "${user.username}" đang bị khóa bởi Quản trị viên`,
        metadata: { loginMode, deviceLabel },
        riskLevel: 'HIGH',
        status: 'DENIED',
        statusCode: 403,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })
      return NextResponse.json(
        { error: 'Tài khoản này đã bị tạm khóa. Vui lòng liên hệ Chủ tiệm / Quản trị viên.' },
        { status: 403 }
      )
    }

    // Kiểm tra khóa tạm chống dò mật khẩu (Brute-force Lockout)
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const remainMin = Math.max(
        1,
        Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
      )
      await recordBehaviorLog({
        userId: user.id,
        username: user.username,
        actorName: user.displayName,
        actorRole: user.role,
        category: 'SECURITY',
        action: 'LOGIN_LOCKED',
        module: 'auth',
        method: 'POST',
        path: '/api/auth',
        summary: `Tài khoản "${user.username}" đang bị khóa tạm thời (${remainMin} phút còn lại)`,
        metadata: { remainMinutes: remainMin, loginMode, deviceLabel },
        riskLevel: 'HIGH',
        status: 'DENIED',
        statusCode: 429,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })
      return NextResponse.json(
        {
          error: `Tài khoản tạm khóa bảo vệ trong ${remainMin} phút nữa do nhập sai quá ${maxFailed} lần.`,
        },
        { status: 429 }
      )
    }

    let validCredential = false
    if (loginMode === 'pin') {
      if (!user.pinHash) {
        return NextResponse.json(
          { error: 'Tài khoản này chưa thiết lập Mã PIN ca trực. Vui lòng đăng nhập bằng mật khẩu.' },
          { status: 400 }
        )
      }
      const candidatePinHash = await hashPin(user.username, pin)
      validCredential = candidatePinHash === user.pinHash
    } else {
      const candidatePwdHash = await hashPassword(password)
      validCredential = candidatePwdHash === user.passwordHash
      // Tương thích với mật khẩu admin cũ trong AppSetting nếu có
      if (!validCredential && user.username === 'admin') {
        const legacyRow = await db.appSetting
          .findUnique({ where: { key: 'admin_password_hash' } })
          .catch(() => null)
        if (legacyRow?.value && candidatePwdHash === legacyRow.value) {
          validCredential = true
        }
      }
    }

    if (!validCredential) {
      const nextFailed = user.failedLoginCount + 1
      const shouldLock = nextFailed >= maxFailed
      const lockedUntil = shouldLock
        ? new Date(Date.now() + lockoutMinutes * 60_000)
        : null

      await db.staffUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: nextFailed,
          lockedUntil,
        },
      })

      await recordBehaviorLog({
        userId: user.id,
        username: user.username,
        actorName: user.displayName,
        actorRole: user.role,
        category: 'SECURITY',
        action: shouldLock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
        module: 'auth',
        method: 'POST',
        path: '/api/auth',
        summary: shouldLock
          ? `Khóa tạm ${lockoutMinutes} phút tài khoản "${user.username}" do sai ${loginMode === 'pin' ? 'mã PIN' : 'mật khẩu'} ${nextFailed} lần liên tiếp`
          : `Nhập sai ${loginMode === 'pin' ? 'mã PIN' : 'mật khẩu'} tài khoản "${user.username}" (lần ${nextFailed}/${maxFailed})`,
        metadata: { failedCount: nextFailed, maxFailed, loginMode, deviceLabel },
        riskLevel: shouldLock ? 'HIGH' : 'MEDIUM',
        status: 'FAILED',
        statusCode: shouldLock ? 429 : 401,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })

      if (shouldLock) {
        return NextResponse.json(
          {
            error: `Nhập sai ${nextFailed} lần liên tiếp — Tài khoản đã bị khóa bảo vệ ${lockoutMinutes} phút.`,
          },
          { status: 429 }
        )
      }

      return NextResponse.json(
        {
          error: `${loginMode === 'pin' ? 'Mã PIN' : 'Mật khẩu'} không chính xác (còn ${maxFailed - nextFailed} lần thử)`,
        },
        { status: 401 }
      )
    }

    // Đăng nhập hợp lệ → tạo phiên StaffSession & cấp Cookie chữ ký HMAC
    const ttlMs = sessionTtlDays * 24 * 3600 * 1000
    const expiresAt = new Date(Date.now() + ttlMs)
    const role: RoleKey = isValidRole(user.role) ? user.role : 'CASHIER_POS'

    const [session] = await Promise.all([
      db.staffSession.create({
        data: {
          userId: user.id,
          ipAddress: ip,
          userAgent: ua.slice(0, 300),
          deviceType,
          deviceLabel,
          expiresAt,
        },
      }),
      db.staffUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: new Date(),
          lastLoginIp: ip,
          lastSeenAt: new Date(),
        },
      }),
    ])

    const permissions = resolveEffectivePermissions(role, user.customPermissions)
    const defaultView = resolveFirstAllowedView(role, permissions)

    const token = await signSessionToken(
      {
        sessionId: session.id,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        role,
        customPermissions: user.customPermissions,
      },
      ttlMs
    )

    await recordBehaviorLog({
      userId: user.id,
      sessionId: session.id,
      username: user.username,
      actorName: user.displayName,
      actorRole: role,
      category: 'AUTH',
      action: 'LOGIN_SUCCESS',
      module: 'auth',
      method: 'POST',
      path: '/api/auth',
      summary: `${user.displayName} đăng nhập thành công (${ROLE_DEFINITIONS[role].shortLabel} · ${loginMode === 'pin' ? 'Mã PIN' : 'Mật khẩu'})`,
      metadata: {
        loginMode,
        deviceLabel,
        defaultView,
        expiresAt: expiresAt.toISOString(),
      },
      riskLevel: 'LOW',
      status: 'SUCCESS',
      statusCode: 200,
      ipAddress: ip,
      deviceType,
      userAgent: ua,
    })

    const res = NextResponse.json({
      ok: true,
      role,
      defaultView,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role,
        roleLabel: ROLE_DEFINITIONS[role].shortLabel,
        avatarColor: user.avatarColor,
      },
      permissions,
    })

    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: sessionTtlDays * 24 * 3600,
    })

    invalidateApiCache('auth:')
    return res
  } catch (error) {
    console.error('Auth POST error:', error)
    return NextResponse.json({ error: 'Không thể xử lý đăng nhập' }, { status: 500 })
  }
}

// PATCH /api/auth — Cập nhật chính sách bảo mật hệ thống HOẶC đổi mật khẩu/mã PIN cá nhân
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await resolveRequestStaffContext(req)
    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''
    const { deviceType } = parseDeviceFromUserAgent(ua)

    const body = (await req.json().catch(() => ({}))) as {
      currentPassword?: string
      newPassword?: string
      newPin?: string
      authRequired?: boolean
      trackNavigation?: boolean
      showQuickLoginHints?: boolean
      maxFailedAttempts?: number
      lockoutMinutes?: number
      sessionTtlDays?: number
    }

    const isPolicyUpdate =
      body.newPassword === undefined &&
      body.newPin === undefined &&
      (typeof body.authRequired === 'boolean' ||
        typeof body.trackNavigation === 'boolean' ||
        typeof body.showQuickLoginHints === 'boolean' ||
        typeof body.maxFailedAttempts === 'number' ||
        typeof body.lockoutMinutes === 'number' ||
        typeof body.sessionTtlDays === 'number')

    if (isPolicyUpdate) {
      if (!hasDomainAccess(ctx.permissions, 'system_iam', 'FULL')) {
        return NextResponse.json(
          { error: 'Chỉ Chủ tiệm / Quản trị viên tối cao mới có quyền thay đổi chính sách bảo mật' },
          { status: 403 }
        )
      }

      const updateData: Record<string, unknown> = {}
      if (typeof body.authRequired === 'boolean') updateData.authRequired = body.authRequired
      if (typeof body.trackNavigation === 'boolean') updateData.trackNavigation = body.trackNavigation
      if (typeof body.showQuickLoginHints === 'boolean') {
        updateData.showQuickLoginHints = body.showQuickLoginHints
      }
      if (typeof body.maxFailedAttempts === 'number') {
        updateData.maxFailedAttempts = Math.min(20, Math.max(3, Math.round(body.maxFailedAttempts)))
      }
      if (typeof body.lockoutMinutes === 'number') {
        updateData.lockoutMinutes = Math.min(120, Math.max(1, Math.round(body.lockoutMinutes)))
      }
      if (typeof body.sessionTtlDays === 'number') {
        updateData.sessionTtlDays = Math.min(90, Math.max(1, Math.round(body.sessionTtlDays)))
      }

      const updatedPolicy = await db.securityPolicy.upsert({
        where: { id: 'default' },
        update: updateData,
        create: {
          id: 'default',
          authRequired: Boolean(body.authRequired),
          maxFailedAttempts: 5,
          lockoutMinutes: 10,
          sessionTtlDays: 14,
          showQuickLoginHints: true,
          trackNavigation: true,
          ...updateData,
        },
      })

      // Chỉ cập nhật auth_required trong AppSetting nếu key đã tồn tại sẵn (tránh làm lệch số dòng baseline AppSetting = 16)
      if (typeof body.authRequired === 'boolean') {
        const existingAppRow = await db.appSetting.findUnique({ where: { key: 'auth_required' } })
        if (existingAppRow) {
          await db.appSetting.update({
            where: { key: 'auth_required' },
            data: { value: body.authRequired ? 'true' : 'false' },
          })
        }
      }

      await recordBehaviorLog({
        userId: ctx.user && !ctx.user.id.startsWith('internal') ? ctx.user.id : null,
        sessionId: ctx.sessionId,
        username: ctx.user?.username ?? 'admin',
        actorName: ctx.user?.displayName ?? 'Quản trị viên',
        actorRole: ctx.user?.role ?? 'ADMIN',
        category: 'IAM',
        action: 'POLICY_UPDATED',
        module: 'iam',
        method: 'PATCH',
        path: '/api/auth',
        summary: `Cập nhật chính sách bảo mật (Bắt buộc đăng nhập: ${updatedPolicy.authRequired ? 'BẬT' : 'TẮT'}, Theo dõi hành vi: ${updatedPolicy.trackNavigation ? 'BẬT' : 'TẮT'})`,
        metadata: updateData,
        riskLevel: 'MEDIUM',
        status: 'SUCCESS',
        statusCode: 200,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })

      await logLedger({
        scope: 'SETTINGS',
        action: 'AUTH_POLICY_UPDATED',
        actor: 'OPERATOR',
        actorName: ctx.user?.displayName ?? 'Quản trị viên',
        originSource: 'MANUAL_ADMIN',
        title: `Cập nhật chính sách bảo mật & phân quyền hệ thống`,
        detail: updateData,
      })

      // Nếu bật Bắt buộc đăng nhập mà người thao tác chưa có cookie phiên thì cấp luôn phiên Admin để không bị văng ra
      const res = NextResponse.json({
        ok: true,
        authRequired: updatedPolicy.authRequired,
        policy: updatedPolicy,
      })
      res.cookies.set(AUTH_LOCK_COOKIE_NAME, updatedPolicy.authRequired ? 'true' : 'false', {
        path: '/',
        maxAge: 365 * 24 * 3600,
      })

      if (updatedPolicy.authRequired && !ctx.authenticated) {
        const adminAcc = await db.staffUser.findUnique({ where: { username: 'admin' } })
        if (adminAcc) {
          const ttlMs = updatedPolicy.sessionTtlDays * 24 * 3600 * 1000
          const sess = await db.staffSession.create({
            data: {
              userId: adminAcc.id,
              ipAddress: ip,
              userAgent: ua.slice(0, 300),
              deviceType,
              deviceLabel: parseDeviceFromUserAgent(ua).deviceLabel,
              expiresAt: new Date(Date.now() + ttlMs),
            },
          })
          const token = await signSessionToken(
            {
              sessionId: sess.id,
              userId: adminAcc.id,
              username: adminAcc.username,
              displayName: adminAcc.displayName,
              role: adminAcc.role,
              customPermissions: adminAcc.customPermissions,
            },
            ttlMs
          )
          res.cookies.set(SESSION_COOKIE_NAME, token, {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: updatedPolicy.sessionTtlDays * 24 * 3600,
          })
        }
      }

      return res
    }

    // Đổi mật khẩu hoặc mã PIN của tài khoản đang đăng nhập (hoặc admin mặc định)
    const targetUsername =
      ctx.authenticated && ctx.user && !ctx.user.id.startsWith('internal')
        ? ctx.user.username
        : 'admin'

    const targetUser = await db.staffUser.findUnique({ where: { username: targetUsername } })
    if (!targetUser) {
      return NextResponse.json({ error: 'Không tìm thấy tài khoản cần đổi mật khẩu' }, { status: 404 })
    }

    const currentPassword = String(body.currentPassword ?? '').trim()
    if (currentPassword) {
      const currentHash = await hashPassword(currentPassword)
      if (currentHash !== targetUser.passwordHash) {
        return NextResponse.json({ error: 'Mật khẩu hiện tại không chính xác' }, { status: 401 })
      }
    } else if (ctx.authRequired) {
      return NextResponse.json(
        { error: 'Vui lòng nhập mật khẩu hiện tại để xác minh' },
        { status: 400 }
      )
    }

    const updates: Record<string, unknown> = {}
    const changedLabels: string[] = []

    if (body.newPassword !== undefined && String(body.newPassword).trim() !== '') {
      const newPassword = String(body.newPassword).trim()
      if (newPassword.length < 4 || newPassword.length > 100) {
        return NextResponse.json(
          { error: 'Mật khẩu mới phải từ 4 đến 100 ký tự' },
          { status: 400 }
        )
      }
      updates.passwordHash = await hashPassword(newPassword)
      changedLabels.push('mật khẩu')
    }

    if (body.newPin !== undefined && String(body.newPin).trim() !== '') {
      const newPin = String(body.newPin).trim()
      if (!/^\d{4,6}$/.test(newPin)) {
        return NextResponse.json(
          { error: 'Mã PIN ca trực phải gồm 4 đến 6 chữ số' },
          { status: 400 }
        )
      }
      updates.pinHash = await hashPin(targetUser.username, newPin)
      changedLabels.push('mã PIN POS')
    }

    if (changedLabels.length === 0) {
      return NextResponse.json(
        { error: 'Vui lòng nhập mật khẩu mới hoặc mã PIN mới' },
        { status: 400 }
      )
    }

    await db.staffUser.update({
      where: { id: targetUser.id },
      data: updates,
    })
    invalidateStaffContextCache()

    // Nếu đổi mật khẩu admin ở màn Cấu hình Hệ thống thì bật luôn chế độ bảo vệ đăng nhập
    let nextAuthRequired = ctx.authRequired
    if (targetUser.username === 'admin' && !ctx.authenticated) {
      await db.securityPolicy.update({
        where: { id: 'default' },
        data: { authRequired: true },
      })
      nextAuthRequired = true
    }

    await recordBehaviorLog({
      userId: targetUser.id,
      sessionId: ctx.sessionId,
      username: targetUser.username,
      actorName: targetUser.displayName,
      actorRole: targetUser.role,
      category: 'AUTH',
      action: 'PASSWORD_CHANGED',
      module: 'iam',
      method: 'PATCH',
      path: '/api/auth',
      summary: `${targetUser.displayName} đã cập nhật ${changedLabels.join(' & ')} cá nhân`,
      metadata: { updatedFields: changedLabels },
      riskLevel: 'MEDIUM',
      status: 'SUCCESS',
      statusCode: 200,
      ipAddress: ip,
      deviceType,
      userAgent: ua,
    })

    const res = NextResponse.json({
      ok: true,
      hasCustomPassword: true,
      authRequired: nextAuthRequired,
    })

    if (!ctx.authenticated) {
      const sess = await db.staffSession.create({
        data: {
          userId: targetUser.id,
          ipAddress: ip,
          userAgent: ua.slice(0, 300),
          deviceType,
          deviceLabel: parseDeviceFromUserAgent(ua).deviceLabel,
          expiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        },
      })
      const token = await signSessionToken({
        sessionId: sess.id,
        userId: targetUser.id,
        username: targetUser.username,
        displayName: targetUser.displayName,
        role: targetUser.role,
        customPermissions: targetUser.customPermissions,
      })
      res.cookies.set(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 14 * 24 * 3600,
      })
      res.cookies.set(AUTH_LOCK_COOKIE_NAME, 'true', { path: '/', maxAge: 365 * 24 * 3600 })
    }

    return res
  } catch (error) {
    console.error('Auth PATCH error:', error)
    return NextResponse.json({ error: 'Không thể cập nhật thông tin bảo mật' }, { status: 500 })
  }
}

// DELETE /api/auth — Đăng xuất & Khóa phiên làm việc hiện tại
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await resolveRequestStaffContext(req)
    invalidateStaffContextCache()
    const ip = extractClientIp(req.headers)
    const ua = req.headers.get('user-agent') ?? ''
    const { deviceType } = parseDeviceFromUserAgent(ua)

    if (ctx.sessionId && !ctx.sessionId.startsWith('legacy-')) {
      await db.staffSession
        .update({
          where: { id: ctx.sessionId },
          data: { revokedAt: new Date(), revokedReason: 'USER_LOGOUT' },
        })
        .catch(() => null)
    }

    if (ctx.user) {
      await recordBehaviorLog({
        userId: ctx.user.id.startsWith('internal') ? null : ctx.user.id,
        sessionId: ctx.sessionId,
        username: ctx.user.username,
        actorName: ctx.user.displayName,
        actorRole: ctx.user.role,
        category: 'AUTH',
        action: 'LOGOUT',
        module: 'auth',
        method: 'DELETE',
        path: '/api/auth',
        summary: `${ctx.user.displayName} đã đăng xuất & khóa phiên làm việc`,
        riskLevel: 'LOW',
        status: 'SUCCESS',
        statusCode: 200,
        ipAddress: ip,
        deviceType,
        userAgent: ua,
      })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.delete(SESSION_COOKIE_NAME)
    res.cookies.set(AUTH_LOCK_COOKIE_NAME, 'true', { path: '/', maxAge: 365 * 24 * 3600 })
    invalidateApiCache('auth:')
    return res
  } catch {
    const res = NextResponse.json({ ok: true })
    res.cookies.delete(SESSION_COOKIE_NAME)
    res.cookies.set(AUTH_LOCK_COOKIE_NAME, 'true', { path: '/', maxAge: 365 * 24 * 3600 })
    invalidateApiCache('auth:')
    return res
  }
}
