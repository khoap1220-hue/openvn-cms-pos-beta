'use client'

import { cn } from '@/lib/utils'

// Avatar chữ cái cho sản phẩm (không dùng ảnh, giữ UI nhẹ & nhất quán)
export function ProductAvatar({ name, className }: { name: string; className?: string }) {
  const words = name.trim().split(/\s+/)
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase()
  return (
    <div
      className={cn(
        'flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-lg bg-emerald-100 text-xs font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
        className
      )}
    >
      {initials}
    </div>
  )
}
