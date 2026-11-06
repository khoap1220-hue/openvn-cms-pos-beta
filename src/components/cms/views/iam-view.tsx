'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  Fingerprint,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  LogIn,
  MonitorSmartphone,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlock,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
} from 'lucide-react'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import {
  ACCESS_LEVEL_LABELS,
  type AccessLevel,
  PERMISSION_DOMAINS,
  type PermissionDomain,
  type PermissionMap,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  type RoleKey,
  hasDomainAccess,
  isValidRole,
  resolveEffectivePermissions,
} from '@/lib/rbac'
import { PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface StaffUserRow {
  id: string
  username: string
  displayName: string
  email: string | null
  phone: string | null
  avatarColor: string
  role: RoleKey
  roleLabel: string
  hasPin: boolean
  customPermissions: Partial<PermissionMap>
  effectivePermissions: PermissionMap
  allowedWarehouseId: string | null
  status: 'ACTIVE' | 'LOCKED'
  failedLoginCount: number
  lockedUntil: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  lastSeenAt: string | null
  note: string | null
  activeSessionsCount: number
  behaviorLogsCount: number
  createdAt: string
}

interface WarehouseOption {
  id: string
  code: string
  name: string
}

interface BehaviorLogRow {
  id: string
  userId: string | null
  sessionId: string | null
  username: string | null
  actorName: string
  actorRole: string
  category: 'AUTH' | 'NAVIGATION' | 'MUTATION' | 'EXPORT' | 'SECURITY' | 'IAM'
  action: string
  module: string | null
  method: string | null
  path: string | null
  targetType: string | null
  targetCode: string | null
  summary: string
  metadata: string | null
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  status: 'SUCCESS' | 'DENIED' | 'FAILED'
  statusCode: number | null
  durationMs: number | null
  ipAddress: string | null
  deviceType: string | null
  userAgent: string | null
  createdAt: string
}

interface BehaviorStats {
  total24h: number
  auth24h: number
  mutations24h: number
  alerts24h: number
  mobile24h: number
  desktop24h: number
  byCategory: Record<string, number>
  topActors: Array<{
    key: string
    actorName: string
    username: string | null
    role: string
    count: number
  }>
  topModules: Array<{
    module: string
    count: number
    totalDurationMs: number
  }>
}

interface StaffSessionRow {
  id: string
  userId: string
  username: string
  displayName: string
  role: RoleKey
  roleLabel: string
  avatarColor: string
  ipAddress: string
  deviceType: string
  deviceLabel: string
  isCurrent: boolean
  isActive: boolean
  revokedAt: string | null
  revokedReason: string | null
  lastActiveAt: string
  expiresAt: string
  createdAt: string
}

interface SecurityPolicyState {
  authRequired: boolean
  maxFailedAttempts: number
  lockoutMinutes: number
  sessionTtlDays: number
  showQuickLoginHints: boolean
  trackNavigation: boolean
}

const CATEGORY_META: Record<string, { label: string; badgeClass: string }> = {
  AUTH: {
    label: 'Đăng nhập / Phiên',
    badgeClass:
      'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/60 dark:text-sky-300',
  },
  NAVIGATION: {
    label: 'Xem trang / Điều hướng',
    badgeClass:
      'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300',
  },
  MUTATION: {
    label: 'Thao tác Nghiệp vụ',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  EXPORT: {
    label: 'Xuất file / In ấn',
    badgeClass:
      'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  SECURITY: {
    label: 'Cảnh báo Bảo mật',
    badgeClass:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300',
  },
  IAM: {
    label: 'Quản trị Phân quyền',
    badgeClass:
      'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300',
  },
}

const RISK_META: Record<string, { label: string; badgeClass: string }> = {
  LOW: {
    label: 'Bình thường',
    badgeClass:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  MEDIUM: {
    label: 'Chú ý',
    badgeClass:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300',
  },
  HIGH: {
    label: 'Cảnh báo cao',
    badgeClass:
      'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300',
  },
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: 'Tổng quan',
  liveops: 'Điều hành AI',
  pos: 'Quầy POS',
  orders: 'Đơn hàng',
  inbox: 'Chat Zalo',
  shipments: 'Vận chuyển & COD',
  products: 'Sản phẩm',
  inventory: 'Tồn kho',
  bom: 'Định mức BOM',
  purchase: 'Nhập hàng NCC',
  sales: 'Hóa đơn bán VAT',
  accounting: 'Sổ quỹ Kế toán',
  customers: 'Khách hàng',
  campaigns: 'Khuyến mãi',
  'auto-social': 'Auto Social',
  partners: 'Đối tác',
  channels: 'Kênh bán',
  reports: 'Báo cáo Lãi lỗ',
  ledger: 'Sổ Data',
  autopilot: 'Autopilot AI',
  integrations: 'Kết nối API',
  iam: 'Nhân sự & Phân quyền',
  system: 'Hệ thống',
  auth: 'Cổng Đăng nhập',
}

const AVATAR_COLORS = [
  '#0066CC',
  '#4F46E5',
  '#0284C7',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DC2626',
  '#0F766E',
]

const SAMPLE_ROLE_USER: Record<RoleKey, string> = {
  ADMIN: 'admin',
  MANAGER: 'quanly',
  CASHIER_POS: 'thungan',
  WAREHOUSE: 'thukho',
  ACCOUNTANT: 'ketoan',
  MARKETING: 'marketing',
}

function getInitials(name: string): string {
  const words = name.replace(/\(.*\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'NV'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function formatDurationMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  return remSec > 0 ? `${min}p ${remSec}s` : `${min}p`
}

function prettyJson(raw: string | null): string {
  if (!raw) return 'Không có dữ liệu bổ sung'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function IamView({
  initialTab = 'users',
  currentPermissions,
}: {
  initialTab?: 'users' | 'roles' | 'logs' | 'sessions'
  currentPermissions?: PermissionMap
}) {
  const router = useRouter()
  const { toast } = useToast()

  const canManageIam = useMemo(
    () => (currentPermissions ? hasDomainAccess(currentPermissions, 'system_iam', 'FULL') : true),
    [currentPermissions]
  )

  const [activeTab, setActiveTab] = useState<'users' | 'roles' | 'logs' | 'sessions'>(initialTab)

  // Dữ liệu Nhân sự
  const [users, setUsers] = useState<StaffUserRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [userSearch, setUserSearch] = useState('')
  const [userRoleFilter, setUserRoleFilter] = useState('ALL')

  // Form Tạo / Sửa Nhân sự
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<StaffUserRow | null>(null)
  const [formUsername, setFormUsername] = useState('')
  const [formDisplayName, setFormDisplayName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formPhone, setFormPhone] = useState('')
  const [formAvatarColor, setFormAvatarColor] = useState('#0066CC')
  const [formRole, setFormRole] = useState<RoleKey>('CASHIER_POS')
  const [formPassword, setFormPassword] = useState('')
  const [formPin, setFormPin] = useState('')
  const [formWarehouseId, setFormWarehouseId] = useState('__all__')
  const [formNote, setFormNote] = useState('')
  const [formOverrides, setFormOverrides] = useState<
    Partial<Record<PermissionDomain, AccessLevel | 'DEFAULT'>>
  >({})
  const [savingUser, setSavingUser] = useState(false)
  const [deletingUser, setDeletingUser] = useState<StaffUserRow | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // Dữ liệu Nhật ký Hành vi
  const [logs, setLogs] = useState<BehaviorLogRow[]>([])
  const [stats, setStats] = useState<BehaviorStats | null>(null)
  const [totalFilteredLogs, setTotalFilteredLogs] = useState(0)
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [logSearch, setLogSearch] = useState('')
  const [logCategory, setLogCategory] = useState('ALL')
  const [logRisk, setLogRisk] = useState('ALL')
  const [logUserFilter, setLogUserFilter] = useState('ALL')
  const [logDays, setLogDays] = useState('7')
  const [selectedLog, setSelectedLog] = useState<BehaviorLogRow | null>(null)

  // Dữ liệu Phiên đăng nhập & Chính sách Bảo mật
  const [sessions, setSessions] = useState<StaffSessionRow[]>([])
  const [activeSessionsTotal, setActiveSessionsTotal] = useState(0)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [policy, setPolicy] = useState<SecurityPolicyState>({
    authRequired: false,
    maxFailedAttempts: 5,
    lockoutMinutes: 10,
    sessionTtlDays: 14,
    showQuickLoginHints: true,
    trackNavigation: true,
  })
  const [savingPolicy, setSavingPolicy] = useState(false)

  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true)
    try {
      const res = await apiGet<{ users: StaffUserRow[]; warehouses: WarehouseOption[] }>(
        '/api/iam/users'
      )
      setUsers(res.users)
      setWarehouses(res.warehouses)
    } catch (e) {
      toast({
        title: 'Không thể tải danh sách nhân sự',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLoadingUsers(false)
    }
  }, [toast])

  const loadLogs = useCallback(
    async (silent = false) => {
      if (!silent) setLoadingLogs(true)
      try {
        const params = new URLSearchParams()
        if (logSearch.trim()) params.set('q', logSearch.trim())
        if (logCategory !== 'ALL') params.set('category', logCategory)
        if (logRisk !== 'ALL') params.set('riskLevel', logRisk)
        if (logUserFilter !== 'ALL') params.set('userId', logUserFilter)
        if (logDays !== 'ALL') params.set('days', logDays)
        params.set('limit', '150')

        const res = await apiGet<{
          logs: BehaviorLogRow[]
          totalFiltered: number
          stats: BehaviorStats
        }>(`/api/behavior-logs?${params.toString()}`)

        setLogs(res.logs)
        setTotalFilteredLogs(res.totalFiltered)
        setStats(res.stats)
      } catch (e) {
        if (!silent) {
          toast({
            title: 'Không thể tải nhật ký hành vi',
            description: e instanceof Error ? e.message : 'Vui lòng thử lại',
            variant: 'destructive',
          })
        }
      } finally {
        if (!silent) setLoadingLogs(false)
      }
    },
    [logSearch, logCategory, logRisk, logUserFilter, logDays, toast]
  )

  const loadSessionsAndPolicy = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const [sessRes, authRes] = await Promise.all([
        apiGet<{ sessions: StaffSessionRow[]; activeCount: number }>('/api/iam/sessions'),
        apiGet<{ policy: SecurityPolicyState | null; authRequired: boolean }>('/api/auth'),
      ])
      setSessions(sessRes.sessions)
      setActiveSessionsTotal(sessRes.activeCount)
      if (authRes.policy) {
        setPolicy(authRes.policy)
      } else {
        setPolicy((p) => ({ ...p, authRequired: Boolean(authRes.authRequired) }))
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    void loadUsers()
    void loadSessionsAndPolicy()
  }, [loadUsers, loadSessionsAndPolicy])

  useEffect(() => {
    const t = setTimeout(() => void loadLogs(), 150)
    return () => clearTimeout(t)
  }, [loadLogs])

  // Nhận luồng nhật ký hành vi thời gian thực qua WebSocket
  useRealtime((evt) => {
    if (evt.type !== 'behavior.new') return
    if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current)
    realtimeDebounce.current = setTimeout(() => {
      void loadLogs(true)
      if (activeTab === 'sessions') void loadSessionsAndPolicy()
    }, 900)
  })

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase()
    return users.filter((u) => {
      if (userRoleFilter !== 'ALL' && u.role !== userRoleFilter) return false
      if (!q) return true
      return (
        u.username.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q)
      )
    })
  }, [users, userSearch, userRoleFilter])

  const openCreateUserModal = () => {
    setEditingUser(null)
    setFormUsername('')
    setFormDisplayName('')
    setFormEmail('')
    setFormPhone('')
    setFormAvatarColor('#0066CC')
    setFormRole('CASHIER_POS')
    setFormPassword('')
    setFormPin('')
    setFormWarehouseId('__all__')
    setFormNote('')
    setFormOverrides({})
    setEditorOpen(true)
  }

  const openEditUserModal = (u: StaffUserRow) => {
    setEditingUser(u)
    setFormUsername(u.username)
    setFormDisplayName(u.displayName)
    setFormEmail(u.email ?? '')
    setFormPhone(u.phone ?? '')
    setFormAvatarColor(u.avatarColor || '#0066CC')
    setFormRole(u.role)
    setFormPassword('')
    setFormPin('')
    setFormWarehouseId(u.allowedWarehouseId ?? '__all__')
    setFormNote(u.note ?? '')
    const ovr: Partial<Record<PermissionDomain, AccessLevel | 'DEFAULT'>> = {}
    for (const d of PERMISSION_DOMAINS) {
      ovr[d.key] = u.customPermissions[d.key] ?? 'DEFAULT'
    }
    setFormOverrides(ovr)
    setEditorOpen(true)
  }

  const handleSaveUser = async () => {
    if (!formDisplayName.trim()) {
      toast({ title: 'Vui lòng nhập họ tên hiển thị', variant: 'destructive' })
      return
    }
    if (!editingUser && formUsername.trim().length < 3) {
      toast({ title: 'Tên đăng nhập phải từ 3 ký tự trở lên', variant: 'destructive' })
      return
    }
    if (!editingUser && formPassword.trim().length < 4) {
      toast({ title: 'Mật khẩu khởi tạo phải từ 4 ký tự trở lên', variant: 'destructive' })
      return
    }

    const customPermissionsPayload: Record<string, AccessLevel> = {}
    if (formRole !== 'ADMIN') {
      for (const d of PERMISSION_DOMAINS) {
        const val = formOverrides[d.key]
        if (val && val !== 'DEFAULT') {
          customPermissionsPayload[d.key] = val
        }
      }
    }

    setSavingUser(true)
    try {
      if (editingUser) {
        await apiPatch(`/api/iam/users/${editingUser.id}`, {
          displayName: formDisplayName.trim(),
          email: formEmail.trim() || null,
          phone: formPhone.trim() || null,
          avatarColor: formAvatarColor,
          role: formRole,
          allowedWarehouseId: formWarehouseId === '__all__' ? null : formWarehouseId,
          customPermissions: customPermissionsPayload,
          note: formNote.trim() || null,
          ...(formPassword.trim() ? { newPassword: formPassword.trim() } : {}),
          ...(formPin.trim() ? { newPin: formPin.trim() } : {}),
        })
        toast({
          title: `Đã cập nhật phân quyền cho ${formDisplayName}`,
          description: `Vai trò: ${ROLE_DEFINITIONS[formRole].shortLabel}`,
        })
      } else {
        await apiPost('/api/iam/users', {
          username: formUsername.trim().toLowerCase(),
          displayName: formDisplayName.trim(),
          email: formEmail.trim() || undefined,
          phone: formPhone.trim() || undefined,
          avatarColor: formAvatarColor,
          role: formRole,
          password: formPassword.trim(),
          pin: formPin.trim() || undefined,
          allowedWarehouseId: formWarehouseId === '__all__' ? null : formWarehouseId,
          customPermissions: customPermissionsPayload,
          note: formNote.trim() || undefined,
        })
        toast({
          title: `Đã tạo tài khoản @${formUsername.trim().toLowerCase()}`,
          description: `Nhân sự ${formDisplayName} đã sẵn sàng đăng nhập.`,
        })
      }
      setEditorOpen(false)
      void loadUsers()
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Không thể lưu tài khoản nhân sự',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại dữ liệu',
        variant: 'destructive',
      })
    } finally {
      setSavingUser(false)
    }
  }

  const handleToggleLockUser = async (u: StaffUserRow) => {
    const nextStatus = u.status === 'ACTIVE' ? 'LOCKED' : 'ACTIVE'
    try {
      const res = await apiPatch<{ revokedSessionsCount?: number }>(`/api/iam/users/${u.id}`, {
        status: nextStatus,
        unlockBruteForce: true,
      })
      toast({
        title:
          nextStatus === 'LOCKED'
            ? `Đã khóa tài khoản @${u.username}`
            : `Đã mở khóa tài khoản @${u.username}`,
        description:
          nextStatus === 'LOCKED'
            ? `Đã thu hồi ngay ${res.revokedSessionsCount ?? 0} phiên đang đăng nhập của nhân sự này.`
            : 'Nhân sự có thể đăng nhập trở lại bình thường.',
      })
      void loadUsers()
      void loadSessionsAndPolicy()
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Không thể đổi trạng thái tài khoản',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    }
  }

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return
    setDeleteLoading(true)
    try {
      await apiDelete(`/api/iam/users/${deletingUser.id}`)
      toast({
        title: `Đã xóa tài khoản @${deletingUser.username}`,
      })
      setDeletingUser(null)
      void loadUsers()
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Xóa tài khoản thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await apiDelete(`/api/iam/sessions?id=${encodeURIComponent(sessionId)}`)
      toast({
        title: 'Đã thu hồi phiên đăng nhập từ xa',
        description: 'Thiết bị đó sẽ phải xác thực lại ở thao tác kế tiếp.',
      })
      void loadSessionsAndPolicy()
      void loadUsers()
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Không thể thu hồi phiên',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    }
  }

  const handleRevokeOtherSessions = async () => {
    try {
      const res = await apiDelete<{ revokedCount: number }>('/api/iam/sessions?scope=others')
      toast({
        title: `Đã đăng xuất ${res.revokedCount} thiết bị khác`,
      })
      void loadSessionsAndPolicy()
      void loadUsers()
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Không thể thu hồi các phiên khác',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    }
  }

  const handleSavePolicy = async (patch?: Partial<SecurityPolicyState>) => {
    const next = { ...policy, ...(patch ?? {}) }
    setPolicy(next)
    setSavingPolicy(true)
    try {
      await apiPatch('/api/auth', next)
      toast({
        title: 'Đã lưu chính sách bảo mật & theo dõi hành vi',
        description: next.authRequired
          ? 'Hệ thống đang bật khóa Bắt buộc đăng nhập khi mở CMS & POS.'
          : 'Chế độ Mở Nội Bộ đang bật (vẫn phân quyền chặt khi nhân viên đăng nhập).',
      })
      void loadLogs(true)
    } catch (e) {
      toast({
        title: 'Không thể lưu chính sách bảo mật',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingPolicy(false)
    }
  }

  const handleExportLogsCsv = () => {
    const params = new URLSearchParams()
    if (logSearch.trim()) params.set('q', logSearch.trim())
    if (logCategory !== 'ALL') params.set('category', logCategory)
    if (logRisk !== 'ALL') params.set('riskLevel', logRisk)
    if (logUserFilter !== 'ALL') params.set('userId', logUserFilter)
    if (logDays !== 'ALL') params.set('days', logDays)
    params.set('format', 'csv')
    window.open(`/api/behavior-logs?${params.toString()}`, '_blank')
    toast({
      title: 'Đang xuất tệp CSV Nhật ký Hành vi',
      description: 'Tệp chuẩn UTF-8 BOM mở trực tiếp được trên Microsoft Excel.',
    })
  }

  const previewPermissionsInEditor = useMemo(() => {
    const overridesClean: Partial<PermissionMap> = {}
    for (const d of PERMISSION_DOMAINS) {
      const v = formOverrides[d.key]
      if (v && v !== 'DEFAULT') overridesClean[d.key] = v
    }
    return resolveEffectivePermissions(formRole, overridesClean)
  }, [formRole, formOverrides])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Nhân sự, Phân quyền & Nhật ký Hành vi"
        description="Quản trị tài khoản đa vai trò (RBAC), kiểm soát phiên đăng nhập thiết bị và giám sát hành vi thao tác thời gian thực"
      >
        {canManageIam && (
          <Button
            onClick={openCreateUserModal}
            className="bg-[#0066CC] text-white hover:bg-[#0052A3]"
          >
            <UserPlus className="h-4 w-4" />
            Thêm nhân sự mới
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            void loadUsers()
            void loadLogs()
            void loadSessionsAndPolicy()
          }}
        >
          <RefreshCw className="h-4 w-4" />
          Làm mới
        </Button>
      </PageHeader>

      {/* 4 Thẻ KPI Giám sát Bảo mật & Hành vi (Bấm để chuyển thẳng tới Tab tương ứng) */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className="rounded-xl border bg-card p-3.5 text-left shadow-2xs transition-all hover:border-[#0066CC]/50 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Tài khoản Nhân sự</span>
            <Users className="h-4 w-4 text-[#0066CC]" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{users.length}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {users.filter((u) => u.status === 'ACTIVE').length} đang mở ·{' '}
            {users.filter((u) => u.status === 'LOCKED').length} đã khóa
          </p>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          className="rounded-xl border bg-card p-3.5 text-left shadow-2xs transition-all hover:border-emerald-500/50 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Phiên Đang Online</span>
            <MonitorSmartphone className="h-4 w-4 text-emerald-600" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {activeSessionsTotal}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Chế độ:{' '}
            <strong className="text-foreground">
              {policy.authRequired ? 'Bắt buộc đăng nhập' : 'Mở nội bộ'}
            </strong>
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setLogRisk('ALL')
            setActiveTab('logs')
          }}
          className="rounded-xl border bg-card p-3.5 text-left shadow-2xs transition-all hover:border-indigo-500/50 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Hành vi 24 giờ qua</span>
            <Activity className="h-4 w-4 text-indigo-600" />
          </div>
          <p className="mt-1.5 text-2xl font-bold tabular-nums">{stats?.total24h ?? 0}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {stats?.mutations24h ?? 0} thao tác API · {stats?.mobile24h ?? 0} Mobile /{' '}
            {stats?.desktop24h ?? 0} PC
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setLogRisk('HIGH')
            setActiveTab('logs')
          }}
          className="rounded-xl border bg-card p-3.5 text-left shadow-2xs transition-all hover:border-rose-500/50 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Cảnh báo Bảo mật 24h</span>
            <ShieldAlert className="h-4 w-4 text-rose-600" />
          </div>
          <p
            className={cn(
              'mt-1.5 text-2xl font-bold tabular-nums',
              (stats?.alerts24h ?? 0) > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            )}
          >
            {stats?.alerts24h ?? 0}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Chặn vượt quyền 403 &amp; sai mật khẩu
          </p>
        </button>
      </div>

      {/* 4 Tab Chức năng Chính */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="space-y-4"
      >
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex h-auto min-h-11 w-max min-w-full justify-start gap-1 rounded-xl p-1 sm:min-w-0">
            <TabsTrigger value="users" className="min-h-9 gap-1.5 px-3 text-xs sm:text-sm">
              <UserCog className="h-4 w-4" />
              <span>Nhân sự &amp; Tài khoản ({users.length})</span>
            </TabsTrigger>
            <TabsTrigger value="roles" className="min-h-9 gap-1.5 px-3 text-xs sm:text-sm">
              <Shield className="h-4 w-4" />
              <span>Ma trận Phân quyền (6 Vai trò)</span>
            </TabsTrigger>
            <TabsTrigger value="logs" className="min-h-9 gap-1.5 px-3 text-xs sm:text-sm">
              <Activity className="h-4 w-4" />
              <span>Theo dõi Hành vi &amp; Log ({totalFilteredLogs})</span>
            </TabsTrigger>
            <TabsTrigger value="sessions" className="min-h-9 gap-1.5 px-3 text-xs sm:text-sm">
              <Lock className="h-4 w-4" />
              <span>Phiên &amp; Chính sách Bảo mật</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ============================================================ */}
        {/* TAB 1: QUẢN LÝ TÀI KHOẢN NHÂN SỰ */}
        {/* ============================================================ */}
        <TabsContent value="users" className="space-y-4">
          <Card className="border-border/80 shadow-xs">
            <CardContent className="pt-4">
              <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 sm:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Tìm tên nhân viên, @username, SĐT..."
                    className="pl-9"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Select value={userRoleFilter} onValueChange={setUserRoleFilter}>
                    <SelectTrigger className="w-full sm:w-52" aria-label="Lọc theo vai trò">
                      <SelectValue placeholder="Tất cả vai trò" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">Tất cả 6 vai trò</SelectItem>
                      {ROLE_KEYS.map((rk) => (
                        <SelectItem key={rk} value={rk}>
                          {ROLE_DEFINITIONS[rk].shortLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {loadingUsers ? (
                <TableSkeleton rows={5} />
              ) : (
                <Table tableId="iam-staff-users">
                  <TableHeader>
                    <TableRow>
                      <TableHead locked>Nhân sự &amp; Tài khoản</TableHead>
                      <TableHead>Vai trò Phân quyền</TableHead>
                      <TableHead>Mã PIN POS</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Đăng nhập gần nhất</TableHead>
                      <TableHead>Số Log</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredUsers.map((u) => {
                      const roleDef = ROLE_DEFINITIONS[u.role]
                      const overrideCount = Object.keys(u.customPermissions).length
                      const isTempLocked =
                        Boolean(u.lockedUntil) && new Date(u.lockedUntil!).getTime() > Date.now()
                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <span
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white shadow-2xs"
                                style={{ backgroundColor: u.avatarColor || '#0066CC' }}
                              >
                                {getInitials(u.displayName)}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate font-semibold text-foreground">
                                  {u.displayName}
                                </p>
                                <p className="truncate font-mono text-xs text-muted-foreground">
                                  @{u.username}
                                  {u.phone ? ` · ${u.phone}` : ''}
                                </p>
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className={roleDef.badgeClass}>
                                {roleDef.shortLabel}
                              </Badge>
                              {overrideCount > 0 && (
                                <Badge variant="outline" className="text-[10px]">
                                  +{overrideCount} tùy chỉnh
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell>
                            {u.hasPin ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                              >
                                <Fingerprint className="h-3 w-3" />
                                Đã bật PIN
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Chưa đặt</span>
                            )}
                          </TableCell>

                          <TableCell>
                            {u.status === 'LOCKED' ? (
                              <Badge variant="destructive" className="gap-1">
                                <Lock className="h-3 w-3" />
                                Đã khóa
                              </Badge>
                            ) : isTempLocked ? (
                              <Badge
                                variant="outline"
                                className="gap-1 border-amber-300 bg-amber-50 text-amber-800"
                              >
                                <AlertTriangle className="h-3 w-3" />
                                Khóa tạm (sai MK)
                              </Badge>
                            ) : (
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300"
                                >
                                  Hoạt động
                                </Badge>
                                {u.activeSessionsCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                    {u.activeSessionsCount} online
                                  </span>
                                )}
                              </div>
                            )}
                          </TableCell>

                          <TableCell>
                            {u.lastLoginAt ? (
                              <div className="text-xs">
                                <p className="font-medium text-foreground">
                                  {formatDateTime(u.lastLoginAt)}
                                </p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  IP: {u.lastLoginIp ?? '127.0.0.1'}
                                </p>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Chưa đăng nhập</span>
                            )}
                          </TableCell>

                          <TableCell>
                            <button
                              type="button"
                              onClick={() => {
                                setLogUserFilter(u.id)
                                setActiveTab('logs')
                              }}
                              className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-xs font-semibold text-[#0066CC] hover:bg-muted dark:text-sky-400"
                            >
                              <Activity className="h-3 w-3" />
                              {u.behaviorLogsCount} log
                            </button>
                          </TableCell>

                          <TableCell className="text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setLogUserFilter(u.id)
                                  setActiveTab('logs')
                                }}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Hành vi
                              </Button>

                              {canManageIam && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => openEditUserModal(u)}
                                  >
                                    <UserCog className="h-3.5 w-3.5" />
                                    Phân quyền
                                  </Button>

                                  {u.username !== 'admin' && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => void handleToggleLockUser(u)}
                                      className={
                                        u.status === 'ACTIVE'
                                          ? 'text-amber-700 hover:text-amber-800'
                                          : 'text-emerald-700 hover:text-emerald-800'
                                      }
                                    >
                                      {u.status === 'ACTIVE' ? (
                                        <>
                                          <Lock className="h-3.5 w-3.5" />
                                          Khóa
                                        </>
                                      ) : (
                                        <>
                                          <Unlock className="h-3.5 w-3.5" />
                                          Mở
                                        </>
                                      )}
                                    </Button>
                                  )}

                                  {u.username !== 'admin' && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      aria-label={`Xóa tài khoản ${u.username}`}
                                      className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                      onClick={() => setDeletingUser(u)}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: MA TRẬN PHÂN QUYỀN 6 VAI TRÒ CHUẨN */}
        {/* ============================================================ */}
        <TabsContent value="roles" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROLE_KEYS.map((rk) => {
              const def = ROLE_DEFINITIONS[rk]
              const sampleUser = SAMPLE_ROLE_USER[rk]
              return (
                <Card key={rk} className="border-border/80 shadow-2xs">
                  <CardHeader className="pb-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className={def.badgeClass}>
                        {def.shortLabel}
                      </Badge>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        Màn chính: {MODULE_LABELS[def.defaultView] ?? def.defaultView}
                      </span>
                    </div>
                    <CardTitle className="mt-1 text-sm">{def.label}</CardTitle>
                    <CardDescription className="text-xs leading-relaxed">
                      {def.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full gap-1.5 text-xs"
                      onClick={() => router.push(`/login?user=${sampleUser}`)}
                    >
                      <LogIn className="h-3.5 w-3.5 text-[#0066CC]" />
                      Chuyển sang đăng nhập thử @{sampleUser}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <Card className="border-border/80 shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Bảng Ma trận Phân quyền Mặc định (6 Vai trò × 10 Nhóm Nghiệp vụ)
              </CardTitle>
              <CardDescription>
                Được kiểm soát đồng thời tại tầng giao diện Menu/Sidebar và tầng cổng máy chủ Next.js Proxy (HTTP 403 Forbidden).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-xl border">
                <Table disableColumnCustomizer>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nhóm Nghiệp vụ Hệ thống</TableHead>
                      {ROLE_KEYS.map((rk) => (
                        <TableHead key={rk} className="text-center">
                          {ROLE_DEFINITIONS[rk].shortLabel}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PERMISSION_DOMAINS.map((dom) => (
                      <TableRow key={dom.key}>
                        <TableCell className="whitespace-normal min-w-[210px]">
                          <p className="font-semibold text-foreground">{dom.label}</p>
                          <p className="text-[11px] text-muted-foreground">{dom.description}</p>
                        </TableCell>
                        {ROLE_KEYS.map((rk) => {
                          const lv = ROLE_DEFINITIONS[rk].preset[dom.key]
                          const meta = ACCESS_LEVEL_LABELS[lv]
                          return (
                            <TableCell key={rk} className="text-center">
                              <Badge variant="outline" className={cn('text-[11px]', meta.badgeClass)}>
                                {meta.shortLabel}
                              </Badge>
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 3: THEO DÕI HÀNH VI & NHẬT KÝ BẢO MẬT THỜI GIAN THỰC */}
        {/* ============================================================ */}
        <TabsContent value="logs" className="space-y-4">
          {/* Thống kê Top Nhân sự & Top Phân hệ Truy cập 24h */}
          {stats && (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card className="border-border/80 shadow-2xs">
                <CardHeader className="pb-2.5">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>Top Nhân sự Hoạt động (24 giờ qua)</span>
                    <Badge variant="outline" className="text-[11px]">
                      Realtime WebSocket
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stats.topActors.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Chưa có dữ liệu trong 24h qua.</p>
                  ) : (
                    stats.topActors.map((a) => (
                      <div
                        key={a.key}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-foreground">{a.actorName}</span>
                          {a.username && (
                            <span className="ml-1.5 font-mono text-muted-foreground">
                              @{a.username}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {isValidRole(a.role) ? ROLE_DEFINITIONS[a.role].shortLabel : a.role}
                          </Badge>
                          <span className="font-mono font-bold text-[#0066CC] dark:text-sky-400">
                            {a.count} sự kiện
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="border-border/80 shadow-2xs">
                <CardHeader className="pb-2.5">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span>Phân hệ Truy cập Nhiều Nhất &amp; Thời lượng (24h)</span>
                    <span className="text-xs font-normal text-muted-foreground">
                      <Smartphone className="mr-1 inline h-3.5 w-3.5" />
                      {stats.mobile24h} Mobile ·{' '}
                      <Laptop className="mx-1 inline h-3.5 w-3.5" />
                      {stats.desktop24h} Desktop
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {stats.topModules.map((m) => (
                      <button
                        key={m.module}
                        type="button"
                        onClick={() => setLogSearch(m.module)}
                        className="rounded-lg border bg-muted/25 p-2.5 text-left transition-colors hover:border-[#0066CC]/50 hover:bg-muted/50"
                      >
                        <p className="truncate text-xs font-semibold text-foreground">
                          {MODULE_LABELS[m.module] ?? m.module}
                        </p>
                        <p className="mt-0.5 font-mono text-xs font-bold text-[#0066CC] dark:text-sky-400">
                          {m.count} lượt
                        </p>
                        {m.totalDurationMs > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            Lưu trang: {formatDurationMs(m.totalDurationMs)}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Bộ lọc đa chiều & Xuất CSV Nhật ký Hành vi */}
          <Card className="border-border/80 shadow-xs">
            <CardContent className="space-y-4 pt-4">
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-6">
                <div className="relative sm:col-span-2">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    placeholder="Tìm hành vi, @user, đường dẫn API, IP..."
                    className="pl-9"
                  />
                </div>

                <Select value={logUserFilter} onValueChange={setLogUserFilter}>
                  <SelectTrigger aria-label="Lọc theo nhân sự">
                    <SelectValue placeholder="Mọi nhân sự" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Mọi nhân sự</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        @{u.username} — {u.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={logCategory} onValueChange={setLogCategory}>
                  <SelectTrigger aria-label="Lọc theo nhóm hành vi">
                    <SelectValue placeholder="Mọi nhóm hành vi" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Mọi nhóm hành vi</SelectItem>
                    <SelectItem value="AUTH">Đăng nhập &amp; Phiên</SelectItem>
                    <SelectItem value="NAVIGATION">Xem trang &amp; Điều hướng</SelectItem>
                    <SelectItem value="MUTATION">Thao tác Nghiệp vụ API</SelectItem>
                    <SelectItem value="EXPORT">Xuất dữ liệu &amp; In ấn</SelectItem>
                    <SelectItem value="SECURITY">Cảnh báo Bảo mật (401/403)</SelectItem>
                    <SelectItem value="IAM">Quản trị Phân quyền</SelectItem>
                  </SelectContent>
                </Select>

                <Select value={logRisk} onValueChange={setLogRisk}>
                  <SelectTrigger aria-label="Lọc theo mức độ rủi ro">
                    <SelectValue placeholder="Mọi mức độ" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Mọi mức độ rủi ro</SelectItem>
                    <SelectItem value="HIGH">Cảnh báo cao (HIGH)</SelectItem>
                    <SelectItem value="MEDIUM">Chú ý (MEDIUM)</SelectItem>
                    <SelectItem value="LOW">Bình thường (LOW)</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <Select value={logDays} onValueChange={setLogDays}>
                    <SelectTrigger className="flex-1" aria-label="Khoảng thời gian">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">24 giờ qua</SelectItem>
                      <SelectItem value="7">7 ngày qua</SelectItem>
                      <SelectItem value="30">30 ngày qua</SelectItem>
                      <SelectItem value="ALL">Toàn bộ lịch sử</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button
                    variant="outline"
                    size="icon"
                    title="Xuất CSV Nhật ký Hành vi"
                    aria-label="Xuất CSV Nhật ký Hành vi"
                    onClick={handleExportLogsCsv}
                  >
                    <Download className="h-4 w-4 text-[#0066CC]" />
                  </Button>
                </div>
              </div>

              {(logSearch ||
                logCategory !== 'ALL' ||
                logRisk !== 'ALL' ||
                logUserFilter !== 'ALL') && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5 text-xs">
                  <span className="text-muted-foreground">
                    Đang hiển thị <strong>{logs.length}</strong> / <strong>{totalFilteredLogs}</strong> sự kiện khớp bộ lọc
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setLogSearch('')
                      setLogCategory('ALL')
                      setLogRisk('ALL')
                      setLogUserFilter('ALL')
                    }}
                    className="font-semibold text-[#0066CC] hover:underline"
                  >
                    Xóa bộ lọc
                  </button>
                </div>
              )}

              {loadingLogs ? (
                <TableSkeleton rows={8} />
              ) : (
                <Table tableId="iam-behavior-logs">
                  <TableHeader>
                    <TableRow>
                      <TableHead locked>Thời gian</TableHead>
                      <TableHead>Nhân sự &amp; Vai trò</TableHead>
                      <TableHead>Nhóm hành vi</TableHead>
                      <TableHead>Mô tả Hành vi &amp; Đường dẫn</TableHead>
                      <TableHead>Thiết bị / IP</TableHead>
                      <TableHead>Mức độ</TableHead>
                      <TableHead className="text-right">Chi tiết</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                          Chưa có sự kiện hành vi nào khớp với bộ lọc hiện tại.
                        </TableCell>
                      </TableRow>
                    ) : (
                      logs.map((row) => {
                        const catMeta = CATEGORY_META[row.category] ?? CATEGORY_META.NAVIGATION
                        const riskMeta = RISK_META[row.riskLevel] ?? RISK_META.LOW
                        const roleShort = isValidRole(row.actorRole)
                          ? ROLE_DEFINITIONS[row.actorRole].shortLabel
                          : row.actorRole

                        return (
                          <TableRow
                            key={row.id}
                            className={cn(
                              row.status === 'DENIED' || row.riskLevel === 'HIGH'
                                ? 'bg-rose-50/35 dark:bg-rose-950/15'
                                : ''
                            )}
                          >
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              <div>{formatDateTime(row.createdAt)}</div>
                              {row.durationMs ? (
                                <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400">
                                  <Clock className="h-2.5 w-2.5" />
                                  {formatDurationMs(row.durationMs)}
                                </span>
                              ) : null}
                            </TableCell>

                            <TableCell>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-foreground">
                                  {row.actorName}
                                </p>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                  {row.username && (
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                      @{row.username}
                                    </span>
                                  )}
                                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                                    {roleShort}
                                  </Badge>
                                </div>
                              </div>
                            </TableCell>

                            <TableCell>
                              <div className="flex flex-col items-start gap-1">
                                <Badge variant="outline" className={cn('text-[11px]', catMeta.badgeClass)}>
                                  {catMeta.label}
                                </Badge>
                                {row.module && (
                                  <span className="text-[11px] text-muted-foreground">
                                    {MODULE_LABELS[row.module] ?? row.module}
                                  </span>
                                )}
                              </div>
                            </TableCell>

                            <TableCell className="max-w-md whitespace-normal">
                              <p className="text-xs font-medium leading-snug text-foreground">
                                {row.summary}
                              </p>
                              {row.path && (
                                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                  {row.method ? `${row.method} ` : ''}
                                  {row.path}
                                  {row.statusCode ? ` · HTTP ${row.statusCode}` : ''}
                                </p>
                              )}
                            </TableCell>

                            <TableCell>
                              <div className="text-xs">
                                <span className="inline-flex items-center gap-1 font-medium">
                                  {row.deviceType === 'MOBILE' || row.deviceType === 'TABLET' ? (
                                    <Smartphone className="h-3.5 w-3.5 text-sky-600" />
                                  ) : (
                                    <Laptop className="h-3.5 w-3.5 text-slate-500" />
                                  )}
                                  {row.deviceType ?? 'WEB'}
                                </span>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  {row.ipAddress ?? '127.0.0.1'}
                                </p>
                              </div>
                            </TableCell>

                            <TableCell>
                              <Badge variant="outline" className={cn('text-[11px]', riskMeta.badgeClass)}>
                                {row.status === 'DENIED'
                                  ? 'Chặn 403'
                                  : row.status === 'FAILED'
                                    ? 'Thất bại'
                                    : riskMeta.label}
                              </Badge>
                            </TableCell>

                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedLog(row)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Xem
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 4: PHIÊN ĐĂNG NHẬP THIẾT BỊ & CHÍNH SÁCH BẢO MẬT */}
        {/* ============================================================ */}
        <TabsContent value="sessions" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-12">
            {/* Chính sách bảo mật hệ thống */}
            <Card className="border-border/80 shadow-xs lg:col-span-5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-[#0066CC]" />
                  Chính sách Đăng nhập &amp; Theo dõi Hành vi
                </CardTitle>
                <CardDescription>
                  Kiểm soát cổng bảo vệ <code>/login</code>, ngưỡng chống dò mật khẩu và mức độ thu thập hành vi
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Bắt buộc đăng nhập khi mở CMS &amp; POS</p>
                    <p className="text-xs text-muted-foreground">
                      Chặn mọi truy cập chưa đăng nhập và chuyển về <code>/login</code>
                    </p>
                  </div>
                  <Switch
                    checked={policy.authRequired}
                    disabled={!canManageIam || savingPolicy}
                    onCheckedChange={(checked) => void handleSavePolicy({ authRequired: checked })}
                    aria-label="Bắt buộc đăng nhập"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Ghi nhận chuyển màn hình &amp; thời lượng lưu trang</p>
                    <p className="text-xs text-muted-foreground">
                      Theo dõi nhân sự mở phân hệ nào và thao tác bao lâu (<code>VIEW_MODULE</code>)
                    </p>
                  </div>
                  <Switch
                    checked={policy.trackNavigation}
                    disabled={!canManageIam || savingPolicy}
                    onCheckedChange={(checked) =>
                      void handleSavePolicy({ trackNavigation: checked })
                    }
                    aria-label="Theo dõi chuyển màn hình"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3">
                  <div className="space-y-0.5">
                    <p className="text-sm font-semibold">Gợi ý chọn nhanh nhân sự ca trực tại /login</p>
                    <p className="text-xs text-muted-foreground">
                      Hiển thị thẻ chọn nhanh tên nhân viên trên điện thoại &amp; màn cảm ứng POS
                    </p>
                  </div>
                  <Switch
                    checked={policy.showQuickLoginHints}
                    disabled={!canManageIam || savingPolicy}
                    onCheckedChange={(checked) =>
                      void handleSavePolicy({ showQuickLoginHints: checked })
                    }
                    aria-label="Gợi ý chọn nhanh nhân sự"
                  />
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor="pol-max-fail" className="text-xs">
                      Sai tối đa (lần)
                    </Label>
                    <Input
                      id="pol-max-fail"
                      type="number"
                      min={3}
                      max={20}
                      disabled={!canManageIam}
                      value={policy.maxFailedAttempts}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          maxFailedAttempts: Number(e.target.value) || 5,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pol-lock-min" className="text-xs">
                      Khóa tạm (phút)
                    </Label>
                    <Input
                      id="pol-lock-min"
                      type="number"
                      min={1}
                      max={120}
                      disabled={!canManageIam}
                      value={policy.lockoutMinutes}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          lockoutMinutes: Number(e.target.value) || 10,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pol-ttl-days" className="text-xs">
                      Hạn phiên (ngày)
                    </Label>
                    <Input
                      id="pol-ttl-days"
                      type="number"
                      min={1}
                      max={90}
                      disabled={!canManageIam}
                      value={policy.sessionTtlDays}
                      onChange={(e) =>
                        setPolicy((p) => ({
                          ...p,
                          sessionTtlDays: Number(e.target.value) || 14,
                        }))
                      }
                    />
                  </div>
                </div>

                {canManageIam && (
                  <Button
                    onClick={() => void handleSavePolicy()}
                    disabled={savingPolicy}
                    className="w-full gap-1.5 bg-[#0066CC] text-white hover:bg-[#0052A3]"
                  >
                    {savingPolicy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    Lưu thông số bảo mật
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Danh sách phiên thiết bị đang đăng nhập */}
            <Card className="border-border/80 shadow-xs lg:col-span-7">
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      Phiên Đăng nhập Thiết bị ({activeSessionsTotal} đang mở)
                    </CardTitle>
                    <CardDescription>
                      Thu hồi phiên từ xa khi nhân viên đổi ca hoặc quên đăng xuất trên điện thoại cá nhân
                    </CardDescription>
                  </div>
                  {activeSessionsTotal > 1 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRevokeOtherSessions()}
                    >
                      Thu hồi mọi thiết bị khác
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {loadingSessions ? (
                  <TableSkeleton rows={4} />
                ) : sessions.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Chưa có phiên đăng nhập nào được ghi nhận.
                  </p>
                ) : (
                  <Table tableId="iam-staff-sessions">
                    <TableHeader>
                      <TableRow>
                        <TableHead locked>Nhân sự</TableHead>
                        <TableHead>Thiết bị &amp; IP</TableHead>
                        <TableHead>Hoạt động cuối</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead className="text-right">Thao tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell>
                            <div className="font-semibold text-foreground">{s.displayName}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              @{s.username} · {s.roleLabel}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5 text-xs font-medium">
                              {s.deviceType === 'MOBILE' || s.deviceType === 'TABLET' ? (
                                <Smartphone className="h-3.5 w-3.5 text-sky-600" />
                              ) : (
                                <Laptop className="h-3.5 w-3.5 text-slate-500" />
                              )}
                              <span>{s.deviceLabel}</span>
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              IP: {s.ipAddress}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDateTime(s.lastActiveAt)}
                          </TableCell>
                          <TableCell>
                            {s.isCurrent ? (
                              <Badge className="bg-[#0066CC] text-white">Phiên hiện tại</Badge>
                            ) : s.isActive ? (
                              <Badge
                                variant="outline"
                                className="border-emerald-200 bg-emerald-50 text-emerald-700"
                              >
                                Đang online
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                Đã kết thúc
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {s.isActive && !s.isCurrent ? (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-rose-600 hover:text-rose-700"
                                onClick={() => void handleRevokeSession(s.id)}
                              >
                                Thu hồi
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* ============================================================ */}
      {/* DIALOG / BOTTOM SHEET: TẠO MỚI HOẶC PHÂN QUYỀN CHI TIẾT NHÂN SỰ */}
      {/* ============================================================ */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-[#0066CC]" />
              {editingUser
                ? `Phân quyền & Hồ sơ Nhân sự: ${editingUser.displayName} (@${editingUser.username})`
                : 'Tạo Tài khoản Nhân sự & Phân quyền Mới'}
            </DialogTitle>
            <DialogDescription>
              Gán vai trò chuẩn hoặc tùy chỉnh quyền ngoại lệ (Xem / Thao tác / Toàn quyền / Chặn) cho từng nhóm nghiệp vụ.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="iam-username">Tên đăng nhập *</Label>
                <Input
                  id="iam-username"
                  disabled={Boolean(editingUser)}
                  value={formUsername}
                  onChange={(e) =>
                    setFormUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))
                  }
                  placeholder="VD: thungan_ca2"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iam-display-name">Họ tên &amp; Chức danh hiển thị *</Label>
                <Input
                  id="iam-display-name"
                  value={formDisplayName}
                  onChange={(e) => setFormDisplayName(e.target.value)}
                  placeholder="VD: Nguyễn Thu Trang (Thu ngân Ca chiều)"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iam-phone">Số điện thoại</Label>
                <Input
                  id="iam-phone"
                  type="tel"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="VD: 0903555888"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iam-email">Email liên hệ</Label>
                <Input
                  id="iam-email"
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="VD: trang@uudam.vn"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Vai trò Phân quyền Chuẩn *</Label>
                <Select value={formRole} onValueChange={(v) => setFormRole(v as RoleKey)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_KEYS.map((rk) => (
                      <SelectItem key={rk} value={rk}>
                        {ROLE_DEFINITIONS[rk].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {ROLE_DEFINITIONS[formRole].description}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>Kho / Điểm bán phụ trách</Label>
                <Select value={formWarehouseId} onValueChange={setFormWarehouseId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Tất cả kho &amp; điểm bán</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-muted-foreground">Màu Avatar:</span>
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormAvatarColor(c)}
                      aria-label={`Chọn màu ${c}`}
                      className={cn(
                        'h-5 w-5 rounded-full border-2 transition-transform',
                        formAvatarColor === c ? 'scale-115 border-foreground' : 'border-transparent'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 rounded-xl border bg-muted/25 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="iam-pwd">
                  {editingUser ? 'Cấp lại Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu khởi tạo *'}
                </Label>
                <Input
                  id="iam-pwd"
                  type="password"
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  placeholder={editingUser ? 'Nhập để đặt lại mật khẩu...' : 'Tối thiểu 4 ký tự...'}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="iam-pin">
                  Mã PIN Ca trực 4–6 số (Đăng nhập nhanh POS / Điện thoại)
                </Label>
                <Input
                  id="iam-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={formPin}
                  onChange={(e) => setFormPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={
                    editingUser?.hasPin
                      ? '•••• (Đã có PIN — nhập số mới nếu muốn đổi)'
                      : 'VD: 3333'
                  }
                />
              </div>
            </div>

            {/* Bảng Tùy chỉnh Quyền Ngoại lệ Chi tiết trên 10 Nhóm Nghiệp vụ */}
            {formRole !== 'ADMIN' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Tùy chỉnh Quyền Chi tiết theo Nhóm Nghiệp vụ (Ghi đè lên vai trò{' '}
                    {ROLE_DEFINITIONS[formRole].shortLabel})
                  </Label>
                  <button
                    type="button"
                    onClick={() => setFormOverrides({})}
                    className="text-xs font-medium text-[#0066CC] hover:underline"
                  >
                    Đặt lại theo mặc định vai trò
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {PERMISSION_DOMAINS.map((dom) => {
                    const presetLevel = ROLE_DEFINITIONS[formRole].preset[dom.key]
                    const currentOvr = formOverrides[dom.key] ?? 'DEFAULT'
                    const effectiveLv = previewPermissionsInEditor[dom.key]
                    return (
                      <div
                        key={dom.key}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{dom.label}</p>
                          <p className="text-[10.5px] text-muted-foreground">
                            Hiệu lực:{' '}
                            <strong className="text-foreground">
                              {ACCESS_LEVEL_LABELS[effectiveLv].shortLabel}
                            </strong>
                          </p>
                        </div>
                        <Select
                          value={currentOvr}
                          onValueChange={(val) =>
                            setFormOverrides((prev) => ({
                              ...prev,
                              [dom.key]: val as AccessLevel | 'DEFAULT',
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="DEFAULT">
                              Mặc định ({ACCESS_LEVEL_LABELS[presetLevel].shortLabel})
                            </SelectItem>
                            <SelectItem value="FULL">Toàn quyền</SelectItem>
                            <SelectItem value="WRITE">Thao tác</SelectItem>
                            <SelectItem value="READ">Chỉ xem</SelectItem>
                            <SelectItem value="NONE">Chặn truy cập</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="iam-note">Ghi chú ca trực / phạm vi trách nhiệm</Label>
              <Textarea
                id="iam-note"
                rows={2}
                value={formNote}
                onChange={(e) => setFormNote(e.target.value)}
                placeholder="VD: Phụ trách ca sáng 08:00 - 15:00 tại Kho Trung Tâm..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)} disabled={savingUser}>
              Hủy
            </Button>
            <Button
              onClick={() => void handleSaveUser()}
              disabled={savingUser}
              className="bg-[#0066CC] text-white hover:bg-[#0052A3]"
            >
              {savingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editingUser ? 'Lưu phân quyền & hồ sơ' : 'Tạo tài khoản nhân sự'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* DIALOG / BOTTOM SHEET: CHI TIẾT BẢN GHI HÀNH VI & BẢO MẬT */}
      {/* ============================================================ */}
      <Dialog open={Boolean(selectedLog)} onOpenChange={(o) => !o && setSelectedLog(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#0066CC]" />
              Chi tiết Nhật ký Hành vi &amp; Ngữ cảnh Kỹ thuật
            </DialogTitle>
            <DialogDescription>
              Mọi mật khẩu, mã PIN và khóa bí mật đều được hệ thống tự động ẩn trước khi lưu trữ.
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <div className="space-y-3 text-xs">
              <div className="rounded-xl border bg-muted/30 p-3">
                <p className="text-sm font-semibold text-foreground">{selectedLog.summary}</p>
                <p className="mt-1 font-mono text-muted-foreground">
                  {formatDateTime(selectedLog.createdAt)} · Mã Log: {selectedLog.id}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2.5 rounded-xl border p-3">
                <div>
                  <span className="text-muted-foreground">Nhân sự thực hiện:</span>
                  <p className="font-semibold text-foreground">
                    {selectedLog.actorName}{' '}
                    {selectedLog.username ? `(@${selectedLog.username})` : ''}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Vai trò lúc thao tác:</span>
                  <p className="font-semibold text-foreground">
                    {isValidRole(selectedLog.actorRole)
                      ? ROLE_DEFINITIONS[selectedLog.actorRole].label
                      : selectedLog.actorRole}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Nhóm / Hành động:</span>
                  <p className="font-mono font-semibold">
                    {selectedLog.category} / {selectedLog.action}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Trạng thái &amp; Rủi ro:</span>
                  <p className="font-semibold">
                    {selectedLog.status} ({selectedLog.statusCode ?? 200}) · Rủi ro:{' '}
                    {selectedLog.riskLevel}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Đường dẫn &amp; Phân hệ:</span>
                  <p className="break-all font-mono">
                    {selectedLog.method ? `${selectedLog.method} ` : ''}
                    {selectedLog.path ?? '—'} ({selectedLog.module ?? '—'})
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Thiết bị &amp; Địa chỉ IP:</span>
                  <p className="font-mono">
                    {selectedLog.deviceType ?? 'WEB'} · IP {selectedLog.ipAddress ?? '127.0.0.1'}
                    {selectedLog.durationMs
                      ? ` · Lưu trang ${formatDurationMs(selectedLog.durationMs)}`
                      : ''}
                  </p>
                </div>
              </div>

              {selectedLog.userAgent && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground">User-Agent trình duyệt:</span>
                  <p className="break-all rounded-lg border bg-muted/25 p-2 font-mono text-[11px] text-muted-foreground">
                    {selectedLog.userAgent}
                  </p>
                </div>
              )}

              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground">
                  Metadata ngữ cảnh (đã che thông tin nhạy cảm):
                </span>
                <pre className="max-h-52 overflow-auto rounded-xl border bg-slate-950 p-3 font-mono text-[11px] text-slate-100">
                  {prettyJson(selectedLog.metadata)}
                </pre>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedLog(null)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Xác nhận xóa tài khoản nhân sự */}
      <ConfirmDialog
        open={Boolean(deletingUser)}
        onOpenChange={(o) => !o && setDeletingUser(null)}
        title={`Xóa tài khoản @${deletingUser?.username ?? ''}?`}
        description={`Tài khoản của "${deletingUser?.displayName ?? ''}" và các phiên đăng nhập đang mở sẽ bị xóa vĩnh viễn. Nhật ký hành vi lịch sử vẫn được giữ lại để kiểm toán.`}
        confirmText="Xóa tài khoản"
        destructive
        loading={deleteLoading}
        onConfirm={() => void handleConfirmDeleteUser()}
      />
    </div>
  )
}
