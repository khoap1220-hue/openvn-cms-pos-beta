// src/app/blog/page.tsx
// Milestone 5: Public Website Blog Feed (FEAT-PUB-03, R5)
// Trang tin tức, bài viết công khai của Ưu Đàm (không yêu cầu đăng nhập)

import Link from 'next/link'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, ArrowRight, Sparkles, BookOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Blog & Tin Tức | Ưu Đàm — Không Gian Tĩnh Tại & Chữa Lành',
  description:
    'Góc chia sẻ về phong cách sống an nhiên, văn hóa thưởng trà, trầm hương và những thông điệp nuôi dưỡng tâm hồn từ Ưu Đàm.',
  openGraph: {
    title: 'Ưu Đàm Blog — Chuyện Trà, Trầm & Tĩnh Tại',
    description: 'Khám phá những câu chuyện văn hóa, bí quyết thưởng trà và tĩnh tâm mỗi ngày.',
    type: 'website',
  },
}

function parseFirstMediaUrl(mediaUrlsRaw: string | null): string | null {
  if (!mediaUrlsRaw) return null
  try {
    const parsed = JSON.parse(mediaUrlsRaw)
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
      return parsed[0]
    }
  } catch {
    if (mediaUrlsRaw.startsWith('http')) {
      return mediaUrlsRaw
    }
  }
  return null
}

function formatDateVietnamese(date: Date | null): string {
  if (!date) return 'Gần đây'
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

export default async function BlogListPage() {
  // Lấy các bài viết website đã xuất bản
  const posts = await db.socialPost.findMany({
    where: {
      channel: 'WEBSITE',
      status: 'PUBLISHED',
    },
    orderBy: {
      publishedAt: 'desc',
    },
    take: 30,
  })

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-800 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Header / Thanh điều hướng thương hiệu */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf8f5]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-3 transition-opacity hover:opacity-90">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-800 text-amber-100 shadow-sm transition-transform group-hover:scale-105">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <span className="font-serif text-xl font-bold tracking-wide text-stone-900">ƯU ĐÀM</span>
              <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500">
                Thư Viện Tĩnh Tại & Chữa Lành
              </p>
            </div>
          </Link>
          <div className="flex items-center gap-4 text-sm font-medium text-stone-600">
            <Link
              href="/"
              className="rounded-full px-4 py-1.5 transition-colors hover:bg-stone-200/60 hover:text-stone-900"
            >
              Cửa hàng
            </Link>
            <Link
              href="/blog"
              className="rounded-full bg-stone-200 px-4 py-1.5 font-semibold text-emerald-950 shadow-xs"
            >
              Góc Tĩnh Tâm
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Banner trang nhã */}
      <section className="relative overflow-hidden border-b border-stone-200/60 bg-gradient-to-b from-stone-100/60 to-transparent py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-800/20 bg-emerald-50/80 px-3.5 py-1 text-xs font-semibold text-emerald-900">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Ưu Đàm Tạp Bút</span>
          </div>
          <h1 className="mt-4 font-serif text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl md:text-5xl">
            Chuyện Trà, Trầm &amp; Bước Chân Tĩnh Lặng
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
            Gợi mở những góc nhìn dung dị về nghệ thuật sống an trú hiện tại, nuôi dưỡng tâm hồn và
            lan tỏa năng lượng từ bi thuần khiết trong từng nếp nhà.
          </p>
        </div>
      </section>

      {/* Danh sách bài viết */}
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/60 p-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-amber-700">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="mt-4 font-serif text-xl font-bold text-stone-800">
              Đang ươm mầm những câu chuyện mới
            </h2>
            <p className="mt-2 max-w-md text-sm text-stone-500">
              Các bài viết chia sẻ về văn hóa thiền trà và đời sống an lành sẽ sớm được xuất bản. Quý
              bạn vui lòng quay lại sau ít phút.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-900"
            >
              Về Trang Chủ Ưu Đàm
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => {
              const coverUrl = parseFirstMediaUrl(post.mediaUrls)
              const postSlug = post.slug || `bai-viet-${post.id}`
              const postUrl = `/blog/${postSlug}`

              return (
                <article
                  key={post.id}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-stone-200/90 bg-white shadow-xs transition duration-300 hover:-translate-y-1 hover:shadow-md"
                >
                  {/* Thumbnail bài viết */}
                  <Link href={postUrl} className="relative block aspect-16/10 overflow-hidden bg-stone-100">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={post.title || 'Ưu Đàm Blog'}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 via-amber-50 to-stone-200">
                        <Sparkles className="h-10 w-10 text-stone-400 opacity-60" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <Badge className="bg-emerald-800/90 text-white backdrop-blur-xs hover:bg-emerald-800">
                        Tin Tức
                      </Badge>
                    </div>
                  </Link>

                  {/* Thẻ nội dung */}
                  <CardContent className="flex flex-1 flex-col p-6">
                    <div className="flex items-center gap-4 text-xs font-medium text-stone-500">
                      <span className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {formatDateVietnamese(post.publishedAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        3 phút đọc
                      </span>
                    </div>

                    <h2 className="mt-3 font-serif text-xl font-bold tracking-tight text-stone-900 group-hover:text-emerald-800">
                      <Link href={postUrl} className="transition-colors">
                        {post.title || 'Thông điệp an lạc từ Ưu Đàm'}
                      </Link>
                    </h2>

                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-stone-600">
                      {post.excerpt || post.content.substring(0, 150) + '...'}
                    </p>

                    <div className="mt-auto pt-5">
                      <Link
                        href={postUrl}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-800 transition-colors group-hover:text-emerald-950"
                      >
                        <span>Đọc tiếp</span>
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                      </Link>
                    </div>
                  </CardContent>
                </article>
              )
            })}
          </div>
        )}
      </main>

      {/* Footer công khai */}
      <footer className="mt-16 border-t border-stone-200/80 bg-white py-12 text-center text-xs text-stone-500">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="font-serif text-sm font-semibold text-stone-700">OPENVN · Ưu Đàm Suite</p>
          <p className="mt-1">Hương sắc an lành — Trọn vẹn từng khoảnh khắc tĩnh tâm.</p>
          <p className="mt-4 text-stone-400">© 2026 Ưu Đàm. Bảo lưu mọi quyền.</p>
        </div>
      </footer>
    </div>
  )
}
