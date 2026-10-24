'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// Avatar sản phẩm: hiển thị ảnh thật khi có (SP shop Ưu Đàm), lỗi ảnh thì fallback chữ cái — UI nhẹ & nhất quán
export function ProductAvatar({
  name,
  image,
  className,
}: {
  name: string
  image?: string | null
  className?: string
}) {
  const [imgOk, setImgOk] = useState(true)
  const showImage = Boolean(image) && imgOk

  const words = name.trim().split(/\s+/)
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase()

  if (showImage) {
    return (
      <img
        src={image!}
        alt={name}
        loading="lazy"
        onError={() => setImgOk(false)}
        className={cn(
          'h-10 w-10 shrink-0 select-none rounded-lg border border-border/60 object-cover',
          className
        )}
      />
    )
  }

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
