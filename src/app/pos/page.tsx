'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, LogOut, ShieldAlert, ShoppingBag, UserCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeToggle } from '@/components/cms/theme-toggle'
import { PosView } from '@/components/cms/views/pos-view'
import { trackClientBehavior } from '@/lib/behavior-client'
import {
  canAccessView,
  resolveEffectivePermissions,
  resolveFirstAllowedView,
  type PermissionMap,
} from '@/lib/rbac'

interface PosStaffInfo {
  username: string
  displayName: string
  role: string
  roleLabel: string
  avatarColor: string
}

export default function StandalonePosPage() {
  const router = useRouter()
  const [staff, setStaff] = useState<PosStaffInfo | null>(null)
  const [permissions, setPermissions] = useState<PermissionMap>(() =>
    resolveEffectivePermissions('ADMIN')
  )

  useEffect(() => {
    trackClientBehavior({
      category: 'NAVIGATION',
      action: 'VIEW_MODULE',
      module: 'pos',
      path: '/pos',
      summary: 'Mở Quầy POS Độc lập (/pos)',
    })

    void fetch('/api/auth')
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (!res) return
        if (res.revokedOrLocked) {
          router.push('/login?reason=revoked&next=/pos')
          return
        }
        if (res.user) setStaff(res.user as PosStaffInfo)
        if (res.permissions) setPermissions(res.permissions as PermissionMap)
      })
      .catch(() => null)
  }, [router])

  const handleSwitchShift = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' })
    } catch {
      // ignore
    }
    router.push('/login?next=/pos')
  }

  const allowedPos = canAccessView(permissions, 'pos')
  const fallbackCmsView = resolveFirstAllowedView(staff?.role, permissions)

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-13 shrink-0 items-center justify-between gap-2 border-b bg-[#0F1E36] px-3 text-white shadow-xs sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0066CC] text-white">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-bold tracking-tight whitespace-nowrap">
              OPENVN POS · Ưu Đàm
            </span>
            <span className="hidden shrink-0 rounded bg-[#0066CC] px-1.5 py-0.5 text-[10px] font-semibold text-white sm:inline-block">
              QUẦY BÁN TẠI KHO
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {staff && (
            <div className="hidden items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs md:flex">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: staff.avatarColor || '#38BDF8' }}
              />
              <span className="max-w-[140px] truncate font-medium text-white">
                {staff.displayName}
              </span>
              <span className="text-slate-300">· {staff.roleLabel}</span>
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleSwitchShift()}
            className="h-9 border-white/20 bg-white/10 px-2.5 text-xs text-white hover:bg-white/20 hover:text-white sm:h-8 sm:px-3"
            title="Đổi tài khoản / Chuyển ca thu ngân bằng PIN"
          >
            <LogOut className="mr-1 h-3.5 w-3.5 shrink-0" />
            <span>Đổi ca</span>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-9 border-white/20 bg-white/10 px-2.5 text-xs text-white hover:bg-white/20 hover:text-white sm:h-8 sm:px-3"
          >
            <Link href={fallbackCmsView === 'dashboard' ? '/' : `/?view=${fallbackCmsView}`}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5 shrink-0" />
              <span className="sm:hidden">Quản trị</span>
              <span className="hidden sm:inline">Về trang Quản trị CMS</span>
            </Link>
          </Button>
          <ThemeToggle />
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px] flex-1 p-2.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4 md:p-5">
        {allowedPos ? (
          <PosView standalone />
        ) : (
          <div className="mx-auto my-12 max-w-lg">
            <Card className="border-amber-200 shadow-sm dark:border-amber-900">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-300">
                  <ShieldAlert className="h-5 w-5" />
                  Vai trò hiện tại không có quyền đứng Quầy POS
                </CardTitle>
                <CardDescription>
                  Tài khoản <strong>{staff?.displayName ?? 'hiện tại'}</strong> ({staff?.roleLabel ?? 'Nhân viên'}) không được cấp quyền vận hành Quầy POS Bán tại kho.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={`/?view=${fallbackCmsView}`}>
                    <ArrowLeft className="mr-1.5 h-4 w-4" />
                    Về phân hệ được phép
                  </Link>
                </Button>
                <Button
                  className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                  onClick={() => void handleSwitchShift()}
                >
                  <UserCheck className="mr-1.5 h-4 w-4" />
                  Đổi sang tài khoản Thu ngân POS
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
