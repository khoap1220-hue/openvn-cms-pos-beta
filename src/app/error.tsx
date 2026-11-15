'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AppErrorBoundary({
  error,
  reset,
  retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  retry?: () => void
}) {
  useEffect(() => {
    console.error('[OPENVN ErrorBoundary]', error)
  }, [error])

  const handleCleanAndReload = () => {
    try {
      const keysToClean: string[] = []
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i)
        if (k && (k.startsWith('__beta_mutations_') || k.startsWith('omni:cache:'))) {
          keysToClean.push(k)
        }
      }
      for (const k of keysToClean) {
        if (k.startsWith('omni:cache:')) {
          window.localStorage.removeItem(k)
        } else {
          const raw = window.localStorage.getItem(k)
          if (raw) {
            const parsed = JSON.parse(raw) as Record<string, unknown>
            delete parsed.peripherals
            delete parsed.settings
            window.localStorage.setItem(k, JSON.stringify(parsed))
          }
        }
      }
    } catch {
      // Bỏ qua nếu trình duyệt chặn localStorage
    }
    if (typeof retry === 'function') {
      retry()
    } else {
      reset()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-3 text-amber-600 dark:text-amber-400">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-foreground">
              Tạm ngắt hiển thị để bảo vệ dữ liệu phiên làm việc
            </h1>
            <p className="text-xs text-muted-foreground">OPENVN · An Nhiên Thạch — Tự phục hồi an toàn</p>
          </div>
        </div>

        <p className="mt-3 rounded-xl border bg-muted/40 p-3 font-mono text-xs break-words text-muted-foreground">
          {error?.message || 'Đã phát hiện dữ liệu bộ nhớ đệm không đồng nhất trên trình duyệt.'}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => window.location.reload()}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Tải lại trang
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-9 bg-[#0066CC] text-xs font-semibold text-white hover:bg-[#0055B3]"
            onClick={handleCleanAndReload}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Làm sạch đệm &amp; Khôi phục ngay
          </Button>
        </div>
      </div>
    </div>
  )
}
