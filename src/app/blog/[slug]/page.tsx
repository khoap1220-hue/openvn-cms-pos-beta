// src/app/blog/[slug]/page.tsx
// Milestone 5: Public Single Article View (FEAT-PUB-03, FEAT-UI-02, R5)
// Next.js 16 App Router compliant: params is a Promise<{ slug: string }>

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, ArrowLeft, ExternalLink, Sparkles, Share2 } from 'lucide-react'

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

/**
 * Sinh metadata động cho SEO & OpenGraph (Next.js 16 async params)
 */
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params

  const post = await db.socialPost.findFirst({
    where: {
      channel: 'WEBSITE',
      status: 'PUBLISHED',
      slug,
    },
  })

  if (!post) {
    return {
      title: 'Bài viết không tìm thấy | Ưu Đàm',
      description: 'Bài viết không tồn tại hoặc đã được chuyển sang chế độ lưu trữ.',
    }
  }

  const mediaList = parseMediaUrls(post.mediaUrls)
  const description = post.excerpt || post.content.substring(0, 160)

  return {
    title: `${post.title || 'Bài viết'} | Ưu Đàm Blog`,
    description,
    openGraph: {
      title: post.title || 'Bài viết Ưu Đàm',
      description,
      type: 'article',
      publishedTime: post.publishedAt?.toISOString(),
      images: mediaList.length > 0 ? [mediaList[0]] : [],
    },
  }
}

/**
 * Trang chi tiết bài viết công khai
 */
export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params

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

  const mediaUrls = parseMediaUrls(post.mediaUrls)
  const hashtags = parseHashtags(post.hashtags)
  const paragraphs = post.content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-800 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Header thanh điều hướng */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf8f5]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-medium text-stone-600 transition-colors hover:text-emerald-900"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Tất cả bài viết</span>
          </Link>
          <Link href="/" className="font-serif text-lg font-bold tracking-wide text-stone-900">
            ƯU ĐÀM
          </Link>
        </div>
      </header>

      {/* Thân bài viết */}
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        {/* Breadcrumb & Thể loại */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge className="bg-emerald-800 text-white hover:bg-emerald-800">Ưu Đàm Blog</Badge>
          <span className="text-xs text-stone-400">•</span>
          <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
            <Calendar className="h-3.5 w-3.5" />
            {formatDateVietnamese(post.publishedAt)}
          </span>
          <span className="text-xs text-stone-400">•</span>
          <span className="inline-flex items-center gap-1 text-xs text-stone-500">
            <Clock className="h-3.5 w-3.5" />
            3 phút đọc
          </span>
        </div>

        {/* Tiêu đề bài viết */}
        <h1 className="mt-6 font-serif text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl md:text-5xl md:leading-tight">
          {post.title || 'Thông điệp an lạc từ Ưu Đàm'}
        </h1>

        {/* Lời dẫn (Excerpt) */}
        {post.excerpt && (
          <div className="mt-6 border-l-4 border-emerald-800/80 bg-stone-100/60 p-4 text-base italic leading-relaxed text-stone-700 sm:text-lg">
            {post.excerpt}
          </div>
        )}

        {/* Ảnh bìa chính */}
        {mediaUrls.length > 0 && (
          <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200/80 shadow-xs">
            <img
              src={mediaUrls[0]}
              alt={post.title || 'Ưu Đàm'}
              className="w-full object-cover max-h-[500px]"
            />
          </div>
        )}

        {/* Nội dung bài viết */}
        <div className="mt-10 space-y-6 text-base leading-relaxed text-stone-700 sm:text-lg sm:leading-8">
          {paragraphs.map((para, idx) => (
            <p key={idx} className="whitespace-pre-line">
              {para}
            </p>
          ))}
        </div>

        {/* Bộ sưu tập ảnh phụ (nếu có nhiều hơn 1 ảnh) */}
        {mediaUrls.length > 1 && (
          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mediaUrls.slice(1).map((url, idx) => (
              <div key={idx} className="overflow-hidden rounded-xl border border-stone-200 shadow-xs">
                <img src={url} alt={`Minh họa ${idx + 2}`} className="h-64 w-full object-cover" />
              </div>
            ))}
          </div>
        )}

        {/* Hashtags */}
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

        {/* Lời kêu gọi hành động (CTA Box) nếu có targetUrl */}
        {post.targetUrl && (
          <div className="mt-12 rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/80 via-white to-stone-50 p-6 sm:p-8 shadow-xs">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-800">
                  <Sparkles className="h-4 w-4" />
                  Trải nghiệm an lành
                </span>
                <h3 className="mt-1 font-serif text-xl font-bold text-stone-900">
                  Đồng hành cùng Ưu Đàm trong từng nếp sống
                </h3>
                <p className="mt-1 text-sm text-stone-600">
                  Khám phá thêm các phẩm vật thiền trà và trầm hương thanh lọc không gian.
                </p>
              </div>
              <a
                href={post.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-emerald-800 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-900"
              >
                <span>Khám phá ngay</span>
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        )}

        {/* Chân bài viết điều hướng */}
        <div className="mt-12 flex items-center justify-between border-t border-stone-200/80 pt-6">
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-950"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Trở về Thư Viện Tĩnh Tại</span>
          </Link>
          <div className="flex items-center gap-2 text-xs text-stone-500">
            <Share2 className="h-4 w-4" />
            <span>Lan tỏa an lành</span>
          </div>
        </div>
      </article>

      {/* Footer */}
      <footer className="mt-20 border-t border-stone-200/80 bg-white py-12 text-center text-xs text-stone-500">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <p className="font-serif text-sm font-semibold text-stone-700">OPENVN · Ưu Đàm Suite</p>
          <p className="mt-1">Góc Tĩnh Tâm — An trú trong từng hơi thở và tách trà thơm.</p>
        </div>
      </footer>
    </div>
  )
}
