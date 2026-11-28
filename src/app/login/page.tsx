'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  Delete,
  Eye,
  EyeOff,
  Fingerprint,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  ShieldCheck,
  ShoppingBag,
  UserCheck,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useShopProfile, type ShopProfileConfig } from '@/lib/shop-profile'
import { cn } from '@/lib/utils'

interface AccountHint {
  username: string
  displayName: string
  role: string
  roleLabel: string
  avatarColor: string
  hasPin: boolean
  status: string
}

const ALLOW_DEMO_HINTS_CLIENT =
  process.env.NODE_ENV !== 'production' ||
  process.env.NEXT_PUBLIC_ALLOW_DEMO_HINTS === '1'

const DEMO_DEFAULT_PASSWORDS: Record<string, { pwd: string; pin: string }> = {
  admin: { pwd: 'admin', pin: '1111' },
  quanly: { pwd: 'quanly123', pin: '2222' },
  thungan: { pwd: 'thungan123', pin: '3333' },
  thukho: { pwd: 'thukho123', pin: '4444' },
  ketoan: { pwd: 'ketoan123', pin: '5555' },
  marketing: { pwd: 'marketing123', pin: '6666' },
}

function srgbChannelToLinear(ch255: number): number {
  const c = Math.max(0, Math.min(255, ch255)) / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

function computeLuminance(r: number, g: number, b: number): number {
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  )
}

/**
 * Bảo đảm màu nền Avatar chữ trắng luôn đạt tương phản WCAG 2.2 AA >= 4.8:1
 * (tự động hạ độ chói cho các mã màu sáng như #D97706, #059669, #0284C7).
 */
function ensureAccessibleAvatarBg(rawHex?: string | null): string {
  const cleaned = String(rawHex || '')
    .trim()
    .replace(/^#/, '')
  let r = 0
  let g = 91
  let b = 181

  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    r = parseInt(cleaned[0] + cleaned[0], 16)
    g = parseInt(cleaned[1] + cleaned[1], 16)
    b = parseInt(cleaned[2] + cleaned[2], 16)
  } else if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    r = parseInt(cleaned.slice(0, 2), 16)
    g = parseInt(cleaned.slice(2, 4), 16)
    b = parseInt(cleaned.slice(4, 6), 16)
  } else {
    return '#005BB5'
  }

  let lum = computeLuminance(r, g, b)
  let guard = 0
  while (lum > 0.165 && guard < 24) {
    r = Math.floor(r * 0.9)
    g = Math.floor(g * 0.9)
    b = Math.floor(b * 0.9)
    lum = computeLuminance(r, g, b)
    guard += 1
  }

  const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function getInitials(name: string): string {
  const words = name.replace(/\(.*\)/g, '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'NV'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase()
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { profile: shopProfile, updateProfileCache } = useShopProfile()

  const [mode, setMode] = useState<'password' | 'pin'>('password')
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [showDemoGuide, setShowDemoGuide] = useState(false)
  const [serverAllowDemoGuide, setServerAllowDemoGuide] = useState(ALLOW_DEMO_HINTS_CLIENT)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hints, setHints] = useState<AccountHint[]>([])
  const [showHints, setShowHints] = useState(true)

  const canShowDemoGuide = ALLOW_DEMO_HINTS_CLIENT && serverAllowDemoGuide

  const revokedReason = searchParams.get('reason') === 'revoked'
  const preselectedUser = searchParams.get('user')

  useEffect(() => {
    if (preselectedUser) {
      setUsername(preselectedUser.trim().toLowerCase())
    }
  }, [preselectedUser])

  useEffect(() => {
    if (shopProfile.brandName) {
      document.title = `Đăng nhập Ca trực — ${shopProfile.brandName}`
    }
  }, [shopProfile.brandName])

  useEffect(() => {
    let active = true
    fetch('/api/auth?hints=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (data: {
          showQuickLoginHints?: boolean
          accountHints?: AccountHint[]
          allowDemoGuide?: boolean
          brand?: Partial<ShopProfileConfig>
        }) => {
          if (!active) return
          setShowHints(data.showQuickLoginHints !== false)
          if (typeof data.allowDemoGuide === 'boolean') {
            setServerAllowDemoGuide(data.allowDemoGuide)
          }
          if (Array.isArray(data.accountHints)) {
            setHints(data.accountHints)
          }
          if (data.brand?.brandName) {
            updateProfileCache({
              ...shopProfile,
              brandName: data.brand.brandName.trim() || shopProfile.brandName,
              brandShortName: data.brand.brandShortName?.trim() || shopProfile.brandShortName,
              brandBadge:
                typeof data.brand.brandBadge === 'string'
                  ? data.brand.brandBadge.trim()
                  : shopProfile.brandBadge,
              brandSubtitle: data.brand.brandSubtitle?.trim() || shopProfile.brandSubtitle,
              storefrontUrl: data.brand.storefrontUrl?.trim() || shopProfile.storefrontUrl,
            })
          }
        }
      )
      .catch(() => null)
    return () => {
      active = false
    }
  }, [])

  const selectedHint = useMemo(
    () => hints.find((h) => h.username === username.trim().toLowerCase()) ?? null,
    [hints, username]
  )

  const performLogin = async (overridePin?: string) => {
    const cleanUser = username.trim().toLowerCase()
    const activePin = overridePin ?? pin

    if (!cleanUser) {
      setError('Vui lòng nhập tên đăng nhập hoặc chọn nhân viên ca trực')
      return
    }
    if (mode === 'password' && !password.trim()) {
      setError('Vui lòng nhập mật khẩu đăng nhập')
      return
    }
    if (mode === 'pin' && activePin.length < 4) {
      setError('Vui lòng nhập đủ mã PIN ca trực (4–6 chữ số)')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'pin'
            ? { mode: 'pin', username: cleanUser, pin: activePin }
            : { mode: 'password', username: cleanUser, password }
        ),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        defaultView?: string
      }

      if (!res.ok || !data.ok) {
        setError(data.error || 'Thông tin đăng nhập không chính xác')
        if (mode === 'pin') setPin('')
        return
      }

      const nextParam = searchParams.get('next') ?? ''
      let safeTarget =
        nextParam.startsWith('/') && !nextParam.startsWith('//')
          ? nextParam
          : '/'

      if (safeTarget === '/' && data.defaultView && data.defaultView !== 'dashboard') {
        safeTarget = `/?view=${encodeURIComponent(data.defaultView)}`
      }

      router.push(safeTarget)
      router.refresh()
    } catch {
      setError('Lỗi kết nối máy chủ, vui lòng thử lại')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void performLogin()
  }

  const handlePinDigit = (digit: string) => {
    if (loading) return
    setError(null)
    setPin((prev) => {
      if (prev.length >= 6) return prev
      return `${prev}${digit}`
    })
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-gradient-to-br from-sky-50/80 via-background to-slate-100/70 px-4 py-1.5 sm:py-2 dark:from-slate-950 dark:via-background dark:to-slate-900">
      <div className="mb-2 flex flex-col items-center text-center">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0066CC] to-[#004494] text-white shadow-md">
          <ShoppingBag className="h-4.5 w-4.5" />
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {shopProfile.brandName}
          </h1>
          <Badge className="bg-[#005BB5] text-[10px] font-semibold text-white">
            {shopProfile.brandBadge || 'RBAC'}
          </Badge>
        </div>
        <p className="mt-0.5 max-w-lg text-balance text-xs text-muted-foreground sm:text-[13px]">
          {shopProfile.brandSubtitle} · Cổng Đăng nhập Nhân sự &amp; Phân quyền&nbsp;Vai trò
        </p>
      </div>

      <Card className="w-full max-w-[500px] gap-2.5 border-border/80 py-3 shadow-xl">
        <CardHeader className="space-y-1.5 pb-0.5">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
              <ShieldCheck className="h-5 w-5 text-[#005BB5] dark:text-sky-400" />
              Đăng nhập Ca trực
            </CardTitle>
            {selectedHint && (
              <Badge
                variant="outline"
                className="border-sky-200 bg-sky-50/80 text-xs text-[#005BB5] dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"
              >
                {selectedHint.roleLabel}
              </Badge>
            )}
          </div>
          <CardDescription className="text-pretty text-xs">
            Đăng nhập bằng tài khoản phân quyền hoặc bấm Mã PIN nhanh tại quầy&nbsp;POS.
          </CardDescription>

          {/* Chuyển đổi 2 phương thức đăng nhập */}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('password')
                setError(null)
              }}
              className={cn(
                'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all',
                mode === 'password'
                  ? 'bg-[#005BB5] text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Tài khoản &amp; Mật khẩu</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('pin')
                setError(null)
              }}
              className={cn(
                'flex min-h-9 items-center justify-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-all',
                mode === 'pin'
                  ? 'bg-[#005BB5] text-white shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" />
              <span>Mã PIN Nhanh (POS)</span>
            </button>
          </div>
        </CardHeader>

        <CardContent className="space-y-2.5">
          {revokedReason && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Phiên làm việc trước đó đã được đăng xuất hoặc bị Quản trị viên thu hồi từ xa. Vui lòng đăng nhập lại.
              </span>
            </div>
          )}

          {/* Dải chọn nhanh tài khoản nhân viên ca trực */}
          {showHints && hints.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Chọn nhanh nhân sự ca trực
                </span>
                {canShowDemoGuide && (
                  <button
                    type="button"
                    onClick={() => setShowDemoGuide((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#005BB5] hover:underline dark:text-sky-400"
                  >
                    <Info className="h-3 w-3" />
                    {showDemoGuide ? 'Ẩn thông tin thử vai trò' : 'Tài khoản mẫu 6 vai trò'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {hints
                  .filter((h) => (mode === 'pin' ? h.hasPin : true))
                  .map((h) => {
                    const active = username.trim().toLowerCase() === h.username
                    const accessibleBg = ensureAccessibleAvatarBg(h.avatarColor)
                    return (
                      <button
                        key={h.username}
                        type="button"
                        onClick={() => {
                          setUsername(h.username)
                          setError(null)
                          if (canShowDemoGuide && showDemoGuide && DEMO_DEFAULT_PASSWORDS[h.username]) {
                            if (mode === 'password') {
                              setPassword(DEMO_DEFAULT_PASSWORDS[h.username].pwd)
                            } else {
                              setPin(DEMO_DEFAULT_PASSWORDS[h.username].pin)
                            }
                          }
                        }}
                        className={cn(
                          'flex min-h-11 items-center gap-2 rounded-xl border px-2 py-1 text-left transition-all',
                          active
                            ? 'border-[#005BB5] bg-sky-50/80 ring-1 ring-[#005BB5]/30 dark:border-sky-500 dark:bg-sky-950/40'
                            : 'border-border/80 bg-card hover:bg-muted/60'
                        )}
                      >
                        <span
                          className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
                          style={{ backgroundColor: accessibleBg }}
                        >
                          {getInitials(h.displayName)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs leading-tight font-semibold text-foreground">
                            @{h.username}
                          </span>
                          <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
                            {h.roleLabel}
                          </span>
                        </span>
                      </button>
                    )
                  })}
              </div>

              {canShowDemoGuide && showDemoGuide && (
                <div className="rounded-xl border border-sky-200/80 bg-sky-50/60 p-2 text-[11px] text-slate-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-slate-300">
                  <p className="mb-1 font-semibold text-[#005BB5] dark:text-sky-300">
                    Chế độ thử nghiệm cục bộ — Chạm vào nhân sự phía trên để tự điền:
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10.5px]">
                    <span>• admin / admin (PIN 1111)</span>
                    <span>• quanly / quanly123 (PIN 2222)</span>
                    <span>• thungan / thungan123 (PIN 3333)</span>
                    <span>• thukho / thukho123 (PIN 4444)</span>
                    <span>• ketoan / ketoan123 (PIN 5555)</span>
                    <span>• marketing / marketing123 (PIN 6666)</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'password' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="staff-username">Tên đăng nhập / Email / SĐT</Label>
                  <Input
                    id="staff-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="VD: admin, thungan, thukho, ketoan..."
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="staff-password">Mật khẩu phân quyền</Label>
                  <div className="relative">
                    <Input
                      id="staff-password"
                      name="password"
                      type={showPwd ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Nhập mật khẩu tài khoản..."
                      autoFocus
                      className="pr-11"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPwd((s) => !s)}
                      className="absolute top-1/2 right-1.5 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={showPwd ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2.5">
                <div className="space-y-1">
                  <Label htmlFor="pin-username">Tài khoản ca trực</Label>
                  <Input
                    id="pin-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Nhập mã nhân sự (vd: thungan)"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="staff-pin-input">Mã PIN (4–6 chữ số)</Label>
                    <span className="text-[11px] text-muted-foreground">
                      {pin.length}/6 số
                    </span>
                  </div>
                  <Input
                    id="staff-pin-input"
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••"
                    className="h-10 text-center font-mono text-lg tracking-[0.5em]"
                  />

                  {/* Bàn phím số cảm ứng gọn gàng (vừa khít 1440×900 không tràn dọc, vẫn đạt >= 40px vùng chạm) */}
                  <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                    {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => handlePinDigit(d)}
                        className="flex h-10 items-center justify-center rounded-xl border border-border bg-card font-mono text-base font-bold text-foreground shadow-2xs transition-colors hover:bg-muted active:scale-95 active:bg-primary/10"
                      >
                        {d}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setPin('')}
                      className="flex h-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-xs font-semibold text-muted-foreground hover:bg-muted"
                    >
                      Xóa hết
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePinDigit('0')}
                      className="flex h-10 items-center justify-center rounded-xl border border-border bg-card font-mono text-base font-bold text-foreground shadow-2xs transition-colors hover:bg-muted active:scale-95"
                    >
                      0
                    </button>
                    <button
                      type="button"
                      onClick={() => setPin((p) => p.slice(0, -1))}
                      aria-label="Xóa 1 số"
                      className="flex h-10 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Delete className="h-4.5 w-4.5" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
              >
                <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button
              type="submit"
              className="h-10.5 w-full gap-2 bg-[#005BB5] text-sm font-semibold text-white hover:bg-[#004A94]"
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <UserCheck className="h-4 w-4" />
              )}
              Đăng nhập vào không gian được phân quyền
            </Button>

            <p className="text-center text-[10.5px] leading-snug text-muted-foreground">
              Mọi phiên đăng nhập, thao tác dữ liệu và cảnh báo truy cập vượt quyền đều được ghi nhận tự động vào{' '}
              <strong className="text-foreground">Nhật ký Hành vi &amp; Bảo mật</strong>.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[#005BB5]" />
        </div>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
