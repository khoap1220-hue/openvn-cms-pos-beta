// src/app/blog/[slug]/page.tsx
// Public Single Article View — Đa CMS độc lập (Next.js 16 async params)

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { getStorefrontConfigForCurrentCms } from '@/lib/storefront-config'
import { formatCustomerStorefrontBrandName } from '@/lib/storefront-ux'
import { BlogShareButton } from '@/components/cms/blog-share-button'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, ArrowLeft, ExternalLink, Sparkles, Store } from 'lucide-react'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ slug: string }>
}

function parseMediaUrls(mediaUrlsRaw: string | null): string[] {
  if (!mediaUrlsRaw) return []
  try {
    const parsed = JSON.parse(mediaUrlsRaw)
    if (Array.isArray(parsed)) {
      return parsed.filter((url): url is string => typeof url === 'string')
    }
  } catch {
    if (mediaUrlsRaw.startsWith('http')) {
      return [mediaUrlsRaw]
    }
  }
  return []
}

function parseHashtags(hashtagsRaw: string | null): string[] {
  if (!hashtagsRaw) return []
  try {
    const parsed = JSON.parse(hashtagsRaw)
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string')
    }
  } catch {
    // Tách theo khoảng trắng nếu là chuỗi thuần
  }
  return hashtagsRaw
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

function formatDateVietnamese(date: Date | null): string {
  if (!date) return 'Hôm nay'
  return new Intl.DateTimeFormat('vi-VN', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const [{ slug }, { brandProfile, config }] = await Promise.all([
    params,
    getStorefrontConfigForCurrentCms(),
  ])
  const displayBrand = formatCustomerStorefrontBrandName(
    brandProfile.brandName,
    config.customDomain
  )

  const post = await db.socialPost.findFirst({
    where: {
      channel: 'WEBSITE',
      status: 'PUBLISHED',
      slug,
    },
  })

  if (!post) {
    return {
      title: `Bài viết không tìm thấy | ${displayBrand}`,
      description: 'Bài viết không tồn tại hoặc đã được chuyển sang chế độ lưu trữ.',
    }
  }

  const mediaList = parseMediaUrls(post.mediaUrls)
  const description = post.excerpt || post.content.substring(0, 160)

  return {
    title: `${post.title || 'Bài viết'} | ${displayBrand}`,
    description,
    openGraph: {
      title: post.title || `Bài viết ${displayBrand}`,
      description,
      siteName: displayBrand,
      type: 'article',
      publishedTime: post.publishedAt?.toISOString(),
      images: mediaList.length > 0 ? [mediaList[0]] : [],
    },
  }
}

export default async function BlogPostPage({ params }: PageProps) {
  const [{ slug }, { brandProfile, config }] = await Promise.all([
    params,
    getStorefrontConfigForCurrentCms(),
  ])

  const post = await db.socialPost.findFirst({
    where: {
      channel: 'WEBSITE',
      status: 'PUBLISHED',
      slug,
    },
  })

  if (!post) {
    notFound()
  }

  const displayBrand = formatCustomerStorefrontBrandName(
    brandProfile.brandName,
    config.customDomain
  )
  const mediaUrls = parseMediaUrls(post.mediaUrls)
  const hashtags = parseHashtags(post.hashtags)
  const paragraphs = post.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-800 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Header thanh điều hướng */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf8f5]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link
            href="/blog"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium text-stone-600 transition-colors hover:text-[#8c4f1e]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Tất cả bài viết</span>
          </Link>
          <Link
            href="/store"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3.5 py-1 text-sm font-bold tracking-wide text-stone-900 shadow-2xs transition hover:border-amber-400 hover:text-[#8c4f1e]"
          >
            <Store className="h-3.5 w-3.5 text-[#8c4f1e]" />
            <span>{displayBrand}</span>
          </Link>
        </div>
      </header>

      {/* Thân bài viết */}
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-[#8c4f1e] text-white hover:bg-[#733f16]">
            {displayBrand} · Góc Tĩnh Tâm
          </Badge>
          <span className="text-xs text-stone-400">•</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-600">
            <Calendar className="h-3.5 w-3.5" />
            {formatDateVietnamese(post.publishedAt)}
          </span>
          <span className="text-xs text-stone-400">•</span>
          <span className="inline-flex items-center gap-1 text-xs text-stone-600">
            <Clock className="h-3.5 w-3.5" />
            3 phút đọc
          </span>
        </div>

        <h1 className="mt-5 font-serif text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl md:text-5xl md:leading-tight">
          {post.title || `Chia sẻ từ ${displayBrand}`}
        </h1>

        {post.excerpt && (
          <div className="mt-6 border-l-4 border-[#8c4f1e] bg-stone-100/70 p-4 text-base leading-relaxed text-stone-700 italic sm:text-lg">
            {post.excerpt}
          </div>
        )}

        {mediaUrls.length > 0 && (
          <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200/80 shadow-xs">
            <img
              src={mediaUrls[0]}
              alt={post.title || displayBrand}
              className="max-h-[500px] w-full object-cover"
            />
          </div>
        )}

        <div className="mt-10 space-y-6 text-base leading-relaxed text-stone-700 sm:text-lg sm:leading-8">
          {paragraphs.map((para, idx) => (
            <p key={idx} className="whitespace-pre-line">
              {para}
            </p>
          ))}
        </div>

        {mediaUrls.length > 1 && (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mediaUrls.slice(1).map((url, idx) => (
              <div key={idx} className="overflow-hidden rounded-xl border border-stone-200 shadow-xs">
                <img src={url} alt={`Minh họa ${idx + 2}`} className="h-64 w-full object-cover" />
              </div>
            ))}
          </div>
        )}

        {hashtags.length > 0 && (
          <div className="mt-10 flex flex-wrap gap-2 border-t border-stone-200/80 pt-6">
            {hashtags.map((tag, idx) => (
              <span
                key={idx}
                className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-200"
              >
                {tag.startsWith('#') ? tag : `#${tag}`}
              </span>
            ))}
          </div>
        )}

        {post.targetUrl && (
          <div className="mt-12 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/80 via-white to-stone-50 p-6 shadow-xs sm:p-8">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-[#7c4316] uppercase">
                  <Sparkles className="h-4 w-4" />
                  Không gian thủ công
                </span>
                <h2 className="mt-1 font-serif text-xl font-bold text-stone-900">
                  Đồng hành cùng {displayBrand} trong từng nếp sống
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  Khám phá bộ sưu tập sản phẩm chế tác tỉ mỉ cho góc thiền, bàn trà và quà tặng tinh tế.
                </p>
              </div>
              <a
                href={post.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-[#8c4f1e] px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#733f16]"
              >
                <span>Khám phá ngay</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

        {/* Chân bài viết điều hướng + Nút sao chép/chia sẻ thật */}
        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200/80 pt-6">
          <Link
            href="/blog"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-[#8c4f1e] hover:text-[#6f3d15]"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Trở về Góc Tĩnh Tâm</span>
          </Link>
          <BlogShareButton title={post.title || displayBrand} />
        </div>
      </article>

      {/* Footer */}
      <footer className="mt-16 border-t border-stone-200/80 bg-white py-10 text-center text-xs text-stone-600">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="font-serif text-sm font-bold text-stone-800">{displayBrand}</p>
          <p className="mt-1">
            {brandProfile.defaultWorkshopName || 'Góc Tĩnh Tâm — Bình yên trong từng khoảnh khắc.'}
          </p>
        </div>
      </footer>
    </div>
  )
}
