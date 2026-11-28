'use client'

import { useState } from 'react'
import { Check, Share2 } from 'lucide-react'

export function BlogShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false)

  const handleShare = async () => {
    if (typeof window === 'undefined') return
    const url = window.location.href
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, url })
        return
      }
    } catch {
      // Nếu người dùng đóng native share sheet hoặc không hỗ trợ, rơi về sao chép liên kết
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-stone-700 shadow-2xs transition hover:border-amber-400 hover:bg-amber-50/70 hover:text-amber-950 focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:outline-none"
      aria-live="polite"
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-700" />
          <span className="text-emerald-800">Đã sao chép liên kết</span>
        </>
      ) : (
        <>
          <Share2 className="h-3.5 w-3.5" />
          <span>Lan tỏa an lành</span>
        </>
      )}
    </button>
  )
}
