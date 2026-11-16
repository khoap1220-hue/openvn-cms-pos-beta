'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, theme, setTheme } = useTheme()
  const isDark = (resolvedTheme ?? theme) === 'dark'

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="Đổi giao diện sáng/tối"
      aria-pressed={isDark}
      data-theme-mode={isDark ? 'dark' : 'light'}
      title={isDark ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative h-10 w-10"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
