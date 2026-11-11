// ============================================================
// IAM & BEHAVIOR AUDIT SERVER ENGINE
// - Tự động khởi tạo 6 tài khoản vai trò mẫu (idempotent, không đụng 24 bảng baseline)
// - Kiểm tra phiên đăng nhập sống (StaffSession chưa thu hồi & StaffUser ACTIVE)
// - Ghi nhật ký hành vi (BehaviorLog) + tự động che giấu 100% mật khẩu / PIN / token / secret
// ============================================================

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import {
  SESSION_COOKIE_NAME,
  extractApiKeyFromHeaders,
  extractClientIp,
  hashPassword,
  hashPin,
  parseDeviceFromUserAgent,
  verifySessionToken,
} from '@/lib/auth'
import {
  type PermissionMap,
  ROLE_DEFINITIONS,
  type RoleKey,
  isValidRole,
  resolveEffectivePermissions,
} from '@/lib/rbac'

const SENSITIVE_KEY_RE =
  /password|pwd|pass|pin|secret|token|apikey|api_key|credential|hash|authorization|cookie|private/i

export function sanitizeAuditMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value
  }
  if (typeof value !== 'object') return value
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAuditMetadata(item, depth + 1))
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k)) {
      out[k] = '[ĐÃ ẨN BẢO MẬT]'
    } else {
      out[k] = sanitizeAuditMetadata(v, depth + 1)
    }
  }
  return out
}

let seedPromise: Promise<void> | null = null
let seededConfirmed = false

const gIamCache = globalThis as unknown as {
  __cmsPolicyCache?: {
    data: {
      authRequired: boolean
      maxFailedAttempts: number
      lockoutMinutes: number
      sessionTtlDays: number
      showQuickLoginHints: boolean
      trackNavigation: boolean
    } | null
    expiresAt: number
  }
  __cmsStaffCtxCache?: Map<string, { data: RequestStaffContext; expiresAt: number }>
}

const staffCtxCache =
  gIamCache.__cmsStaffCtxCache ?? (gIamCache.__cmsStaffCtxCache = new Map())

export function invalidateStaffContextCache(): void {
  gIamCache.__cmsPolicyCache = undefined
  staffCtxCache.clear()
}

export async function getCachedSecurityPolicy() {
  const now = Date.now()
  if (gIamCache.__cmsPolicyCache && gIamCache.__cmsPolicyCache.expiresAt > now) {
    return gIamCache.__cmsPolicyCache.data
  }
  const policy = await db.securityPolicy.findUnique({ where: { id: 'default' } })
  gIamCache.__cmsPolicyCache = {
    data: policy,
    expiresAt: now + 45_000,
  }
  return policy
}

export async function ensureIamSeeded(): Promise<void> {
  if (seededConfirmed) return
  if (seedPromise) return seedPromise

  seedPromise = (async () => {
    try {
      const existingCount = await db.staffUser.count()
      const existingPolicy = await db.securityPolicy.findUnique({ where: { id: 'default' } })

      if (!existingPolicy) {
        const legacyAuthRow = await db.appSetting
          .findUnique({ where: { key: 'auth_required' } })
          .catch(() => null)
        await db.securityPolicy.upsert({
          where: { id: 'default' },
          update: {},
          create: {
            id: 'default',
            authRequired:
              legacyAuthRow?.value === 'true' || process.env.CMS_REQUIRE_AUTH === 'true',
            maxFailedAttempts: 5,
            lockoutMinutes: 10,
            sessionTtlDays: 14,
            showQuickLoginHints: true,
            trackNavigation: true,
          },
        })
      }

      if (existingCount === 0) {
        const legacyPwdRow = await db.appSetting
          .findUnique({ where: { key: 'admin_password_hash' } })
          .catch(() => null)
        const defaultAdminPwd = process.env.CMS_ADMIN_PASSWORD || 'admin'
        const adminPwdHash = legacyPwdRow?.value || (await hashPassword(defaultAdminPwd))

        const defaultAccounts: Array<{
          username: string
          displayName: string
          email: string
          phone: string
          avatarColor: string
          role: RoleKey
          passwordPlain?: string
          passwordHashOverride?: string
          pinPlain: string
          note: string
        }> = [
          {
            username: 'admin',
            displayName: 'Nguyễn Khoa (Chủ tiệm)',
            email: 'admin@uudam.vn',
            phone: '0901888999',
            avatarColor: '#0066CC',
            role: 'ADMIN',
            passwordHashOverride: adminPwdHash,
            pinPlain: '1111',
            note: 'Tài khoản Chủ tiệm / Quản trị tối cao toàn hệ thống OPENVN · Ưu Đàm',
          },
          {
            username: 'quanly',
            displayName: 'Lê Minh Tâm (Quản lý ca)',
            email: 'quanly@uudam.vn',
            phone: '0902666888',
            avatarColor: '#4F46E5',
            role: 'MANAGER',
            passwordPlain: 'quanly123',
            pinPlain: '2222',
            note: 'Điều phối đơn hàng đa sàn, kho vận, chiến dịch và kiểm tra báo cáo',
          },
          {
            username: 'thungan',
            displayName: 'Trần Thu Ngân (Quầy POS)',
            email: 'pos@uudam.vn',
            phone: '0903555777',
            avatarColor: '#0284C7',
            role: 'CASHIER_POS',
            passwordPlain: 'thungan123',
            pinPlain: '3333',
            note: 'Thu ngân bán hàng tại kho (/pos), chốt đơn Zalo & tích điểm hội viên',
          },
          {
            username: 'thukho',
            displayName: 'Phạm Quốc Bảo (Thủ kho)',
            email: 'kho@uudam.vn',
            phone: '0904333666',
            avatarColor: '#D97706',
            role: 'WAREHOUSE',
            passwordPlain: 'thukho123',
            pinPlain: '4444',
            note: 'Kiểm kê đa kho, quét mã vạch đóng gói đơn, bàn giao ĐVVC & nhập hàng NCC',
          },
          {
            username: 'ketoan',
            displayName: 'Đỗ Thanh Hà (Kế toán)',
            email: 'ketoan@uudam.vn',
            phone: '0905222555',
            avatarColor: '#059669',
            role: 'ACCOUNTANT',
            passwordPlain: 'ketoan123',
            pinPlain: '5555',
            note: 'Phát hành Hóa đơn điện tử VAT, đối soát COD, Sổ quỹ & Chốt sổ quý',
          },
          {
            username: 'marketing',
            displayName: 'Vũ Thảo Vy (Auto Social)',
            email: 'social@uudam.vn',
            phone: '0906111444',
            avatarColor: '#7C3AED',
            role: 'MARKETING',
            passwordPlain: 'marketing123',
            pinPlain: '6666',
            note: 'Vận hành Chương trình khuyến mãi, Auto Social 7 kênh & nội dung sản phẩm',
          },
        ]

        for (const acc of defaultAccounts) {
          const pwdHash =
            acc.passwordHashOverride ?? (await hashPassword(acc.passwordPlain || 'uudam123'))
          const pHash = await hashPin(acc.username, acc.pinPlain)
          await db.staffUser.upsert({
            where: { username: acc.username },
            update: {},
            create: {
              username: acc.username,
              displayName: acc.displayName,
              email: acc.email,
              phone: acc.phone,
              avatarColor: acc.avatarColor,
              role: acc.role,
              passwordHash: pwdHash,
              pinHash: pHash,
              status: 'ACTIVE',
              note: acc.note,
            },
          })
        }

        const logCount = await db.behaviorLog.count()
        if (logCount === 0) {
          const adminUser = await db.staffUser.findUnique({ where: { username: 'admin' } })
          await db.behaviorLog.create({
            data: {
              userId: adminUser?.id ?? null,
              username: 'admin',
              actorName: adminUser?.displayName ?? 'Nguyễn Khoa (Chủ tiệm)',
              actorRole: 'ADMIN',
              category: 'IAM',
              action: 'POLICY_UPDATED',
              module: 'iam',
              method: 'SYSTEM',
              path: '/api/iam/users',
              summary:
                'Khởi tạo Hệ thống Phân quyền RBAC 6 vai trò & Trung tâm Theo dõi Hành vi Nhân sự',
              metadata: JSON.stringify({
                rolesInitialized: ['ADMIN', 'MANAGER', 'CASHIER_POS', 'WAREHOUSE', 'ACCOUNTANT', 'MARKETING'],
              }),
              riskLevel: 'LOW',
              status: 'SUCCESS',
              statusCode: 200,
              ipAddress: '127.0.0.1',
              deviceType: 'DESKTOP',
            },
          })
        }
      }

      seededConfirmed = true
    } catch (err) {
      console.error('ensureIamSeeded error:', err)
    } finally {
      seedPromise = null
    }
  })()

  return seedPromise
}

export interface BehaviorLogInput {
  userId?: string | null
  sessionId?: string | null
  username?: string | null
  actorName: string
  actorRole?: string
  category: 'AUTH' | 'NAVIGATION' | 'MUTATION' | 'EXPORT' | 'SECURITY' | 'IAM'
  action: string
  module?: string | null
  method?: string | null
  path?: string | null
  targetType?: string | null
  targetCode?: string | null
  summary: string
  metadata?: unknown
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH'
  status?: 'SUCCESS' | 'DENIED' | 'FAILED'
  statusCode?: number | null
  durationMs?: number | null
  ipAddress?: string | null
  deviceType?: string | null
  userAgent?: string | null
}

export async function recordBehaviorLog(input: BehaviorLogInput): Promise<void> {
  try {
    const cleanMeta =
      input.metadata !== undefined && input.metadata !== null
        ? JSON.stringify(sanitizeAuditMetadata(input.metadata))
        : null

    const created = await db.behaviorLog.create({
      data: {
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        username: input.username ?? null,
        actorName: input.actorName || 'Người vận hành',
        actorRole: input.actorRole || 'ANONYMOUS',
        category: input.category,
        action: input.action,
        module: input.module ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        targetType: input.targetType ?? null,
        targetCode: input.targetCode ?? null,
        summary: input.summary,
        metadata: cleanMeta,
        riskLevel: input.riskLevel ?? 'LOW',
        status: input.status ?? 'SUCCESS',
        statusCode: input.statusCode ?? null,
        durationMs:
          typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
            ? Math.max(0, Math.round(input.durationMs))
            : null,
        ipAddress: input.ipAddress ?? null,
        deviceType: input.deviceType ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      },
    })

    broadcast('behavior.new', {
      id: created.id,
      actorName: created.actorName,
      actorRole: created.actorRole,
      category: created.category,
      action: created.action,
      module: created.module,
      summary: created.summary,
      riskLevel: created.riskLevel,
      status: created.status,
      createdAt: created.createdAt.toISOString(),
    })
  } catch (err) {
    console.error('recordBehaviorLog error:', err)
  }
}

export interface RequestStaffContext {
  authenticated: boolean
  revokedOrLocked: boolean
  mode: 'session' | 'api_key' | 'internal_open' | 'unauthenticated'
  sessionId: string | null
  user: {
    id: string
    username: string
    displayName: string
    role: RoleKey
    avatarColor: string
    email: string | null
    phone: string | null
    allowedWarehouseId: string | null
    customPermissions: string | null
  } | null
  permissions: PermissionMap
  authRequired: boolean
  trackNavigation: boolean
  showQuickLoginHints: boolean
}

export async function resolveRequestStaffContext(
  req: NextRequest
): Promise<RequestStaffContext> {
  const apiKey = extractApiKeyFromHeaders(req.headers)
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value
  const cacheKey = apiKey ? `key:${apiKey}` : token ? `tok:${token}` : '__anon__'
  const nowTs = Date.now()
  const cachedCtx = staffCtxCache.get(cacheKey)
  if (cachedCtx && cachedCtx.expiresAt > nowTs) {
    return cachedCtx.data
  }

  const computed = await resolveRequestStaffContextUncached(req, apiKey, token)
  staffCtxCache.set(cacheKey, { data: computed, expiresAt: nowTs + 30_000 })
  return computed
}

async function resolveRequestStaffContextUncached(
  req: NextRequest,
  apiKey: string | null,
  token: string | undefined
): Promise<RequestStaffContext> {
  await ensureIamSeeded()

  const policy = await getCachedSecurityPolicy()
  const authRequired =
    Boolean(policy?.authRequired) || process.env.CMS_REQUIRE_AUTH === 'true'
  const trackNavigation = policy?.trackNavigation ?? true
  const showQuickLoginHints = policy?.showQuickLoginHints ?? true

  // 1. Xác thực qua X-API-Key
  if (apiKey) {
    const keyRow = await db.apiKey.findUnique({ where: { key: apiKey } })
    if (keyRow && keyRow.active) {
      void db.apiKey
        .update({ where: { id: keyRow.id }, data: { lastUsedAt: new Date() } })
        .catch(() => null)
      return {
        authenticated: true,
        revokedOrLocked: false,
        mode: 'api_key',
        sessionId: null,
        user: {
          id: `apikey:${keyRow.id}`,
          username: 'api_key',
          displayName: `API Key: ${keyRow.name}`,
          role: 'ADMIN',
          avatarColor: '#0891B2',
          email: null,
          phone: null,
          allowedWarehouseId: null,
          customPermissions: null,
        },
        permissions: resolveEffectivePermissions('ADMIN'),
        authRequired,
        trackNavigation,
        showQuickLoginHints,
      }
    }
  }

  // 2. Xác thực qua Cookie phiên đăng nhập
  const verified = await verifySessionToken(token)

  if (verified.valid && verified.claims) {
    const { sid, uid, usr } = verified.claims

    // Phiên chuẩn v2 gắn với StaffSession & StaffUser trong SQLite
    if (sid && !sid.startsWith('legacy-')) {
      const sessionRow = await db.staffSession.findUnique({
        where: { id: sid },
        include: { user: true },
      })

      if (
        !sessionRow ||
        sessionRow.revokedAt !== null ||
        sessionRow.expiresAt.getTime() < Date.now() ||
        !sessionRow.user ||
        sessionRow.user.status !== 'ACTIVE'
      ) {
        return {
          authenticated: false,
          revokedOrLocked: true,
          mode: 'unauthenticated',
          sessionId: null,
          user: null,
          permissions: resolveEffectivePermissions('CASHIER_POS', {
            pos: 'NONE',
            orders: 'NONE',
            logistics: 'NONE',
            catalog: 'NONE',
            crm_marketing: 'NONE',
          }),
          authRequired,
          trackNavigation,
          showQuickLoginHints,
        }
      }

      const u = sessionRow.user
      const role: RoleKey = isValidRole(u.role) ? u.role : 'CASHIER_POS'
      const now = Date.now()

      // Cập nhật lastActiveAt tối đa mỗi 45 giây để giảm ghi đĩa SQLite
      if (now - sessionRow.lastActiveAt.getTime() > 45_000) {
        const ip = extractClientIp(req.headers)
        void Promise.all([
          db.staffSession.update({
            where: { id: sessionRow.id },
            data: { lastActiveAt: new Date(), ipAddress: ip },
          }),
          db.staffUser.update({
            where: { id: u.id },
            data: { lastSeenAt: new Date() },
          }),
        ]).catch(() => null)
      }

      return {
        authenticated: true,
        revokedOrLocked: false,
        mode: 'session',
        sessionId: sessionRow.id,
        user: {
          id: u.id,
          username: u.username,
          displayName: u.displayName,
          role,
          avatarColor: u.avatarColor,
          email: u.email,
          phone: u.phone,
          allowedWarehouseId: u.allowedWarehouseId,
          customPermissions: u.customPermissions,
        },
        permissions: resolveEffectivePermissions(role, u.customPermissions),
        authRequired,
        trackNavigation,
        showQuickLoginHints,
      }
    }

    // Phiên legacy-admin tương thích ngược
    const fallbackUser = await db.staffUser
      .findFirst({
        where: { OR: [{ id: uid }, { username: usr || 'admin' }] },
      })
      .catch(() => null)

    const role: RoleKey = fallbackUser && isValidRole(fallbackUser.role)
      ? fallbackUser.role
      : verified.role ?? 'ADMIN'

    return {
      authenticated: true,
      revokedOrLocked: false,
      mode: 'session',
      sessionId: sid,
      user: {
        id: fallbackUser?.id ?? 'admin',
        username: fallbackUser?.username ?? 'admin',
        displayName: fallbackUser?.displayName ?? 'Nguyễn Khoa (Chủ tiệm)',
        role,
        avatarColor: fallbackUser?.avatarColor ?? '#0066CC',
        email: fallbackUser?.email ?? null,
        phone: fallbackUser?.phone ?? null,
        allowedWarehouseId: fallbackUser?.allowedWarehouseId ?? null,
        customPermissions: fallbackUser?.customPermissions ?? null,
      },
      permissions: resolveEffectivePermissions(role, fallbackUser?.customPermissions),
      authRequired,
      trackNavigation,
      showQuickLoginHints,
    }
  }

  // 3. Nếu chưa đăng nhập và hệ thống đang ở chế độ Mở Nội Bộ (!authRequired)
  if (!authRequired) {
    return {
      authenticated: false,
      revokedOrLocked: false,
      mode: 'internal_open',
      sessionId: null,
      user: {
        id: 'internal-operator',
        username: 'internal',
        displayName: 'Ca trực Nội bộ (Mở)',
        role: 'ADMIN',
        avatarColor: '#0066CC',
        email: null,
        phone: null,
        allowedWarehouseId: null,
        customPermissions: null,
      },
      permissions: resolveEffectivePermissions('ADMIN'),
      authRequired,
      trackNavigation,
      showQuickLoginHints,
    }
  }

  return {
    authenticated: false,
    revokedOrLocked: false,
    mode: 'unauthenticated',
    sessionId: null,
    user: null,
    permissions: resolveEffectivePermissions('CASHIER_POS', {
      pos: 'NONE',
      orders: 'NONE',
      logistics: 'NONE',
      catalog: 'NONE',
      crm_marketing: 'NONE',
    }),
    authRequired,
    trackNavigation,
    showQuickLoginHints,
  }
}

export function describeApiMutationVietnamese(
  methodInput: string,
  pathname: string
): { module: string; summary: string; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' } {
  const method = methodInput.toUpperCase()
  const verb =
    method === 'POST'
      ? 'Tạo / thực thi'
      : method === 'DELETE'
        ? 'Xóa / hủy'
        : 'Cập nhật'

  if (pathname.startsWith('/api/orders/bulk-confirm')) {
    return { module: 'orders', summary: 'Duyệt hàng loạt đơn hàng', riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/orders')) {
    return {
      module: 'orders',
      summary: `${verb} đơn hàng (${method} ${pathname})`,
      riskLevel: method === 'DELETE' ? 'MEDIUM' : 'LOW',
    }
  }
  if (pathname.startsWith('/api/products/import')) {
    return { module: 'products', summary: 'Nhập danh mục sản phẩm từ CSV/Excel', riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/products')) {
    return {
      module: 'products',
      summary: `${verb} sản phẩm (${method} ${pathname})`,
      riskLevel: method === 'DELETE' ? 'HIGH' : 'LOW',
    }
  }
  if (pathname.startsWith('/api/inventory') || pathname.startsWith('/api/warehouses')) {
    return { module: 'inventory', summary: `${verb} tồn kho / kho hàng`, riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/sales-invoices')) {
    return {
      module: 'sales',
      summary: pathname.includes('/sign')
        ? 'Ký số Hóa đơn điện tử VAT'
        : `${verb} hóa đơn bán hàng`,
      riskLevel: 'MEDIUM',
    }
  }
  if (pathname.startsWith('/api/purchase-invoices')) {
    return { module: 'purchase', summary: `${verb} hóa đơn nhập hàng NCC`, riskLevel: 'MEDIUM' }
  }
  if (pathname.startsWith('/api/periods')) {
    return { module: 'accounting', summary: 'Chốt / Mở lại kỳ sổ sách kế toán quý', riskLevel: 'HIGH' }
  }
  if (pathname.startsWith('/api/customers')) {
    return { module: 'customers', summary: `${verb} hồ sơ khách hàng / hội viên`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/campaigns') || pathname.startsWith('/api/vouchers')) {
    return { module: 'campaigns', summary: `${verb} chiến dịch khuyến mãi / voucher`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/social')) {
    return { module: 'auto-social', summary: `${verb} lịch bài đăng Auto Social`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/shipments') || pathname.startsWith('/api/aftersales')) {
    return { module: 'shipments', summary: `${verb} vận đơn / đối soát COD / đổi trả`, riskLevel: 'LOW' }
  }
  if (pathname.startsWith('/api/settings') || pathname.startsWith('/api/integrations')) {
    return {
      module: 'system',
      summary: `${verb} cấu hình hệ thống / kết nối đối tác`,
      riskLevel: 'HIGH',
    }
  }
  if (pathname.startsWith('/api/system/reset')) {
    return {
      module: 'system',
      summary: 'Thực thi Khởi tạo Vận hành Thực tế (Go-Live Reset)',
      riskLevel: 'HIGH',
    }
  }

  return {
    module: 'system',
    summary: `${verb} dữ liệu qua API (${method} ${pathname})`,
    riskLevel: method === 'DELETE' ? 'HIGH' : 'LOW',
  }
}

export function formatRoleLabel(role?: string | null): string {
  if (!role) return 'Chưa xác định'
  if (isValidRole(role)) return ROLE_DEFINITIONS[role].shortLabel
  if (role === 'API_KEY') return 'External API Key'
  return role
}

export { extractClientIp, parseDeviceFromUserAgent }
