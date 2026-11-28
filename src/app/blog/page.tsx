// src/app/blog/page.tsx
// Public Website Blog Feed — Đa CMS độc lập (đọc thương hiệu động từ getStorefrontConfigForCurrentCms)

import Link from 'next/link'
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { getStorefrontConfigForCurrentCms } from '@/lib/storefront-config'
import { formatCustomerStorefrontBrandName } from '@/lib/storefront-ux'
import { CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Calendar, Clock, ArrowRight, Sparkles, BookOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const { brandProfile, config } = await getStorefrontConfigForCurrentCms()
  const displayBrand = formatCustomerStorefrontBrandName(
    brandProfile.brandName,
    config.customDomain
  )
  const title = `Góc Tĩnh Tâm & Cảm Hứng | ${displayBrand}`
  const description = `Góc chia sẻ về không gian sống tĩnh tại, nghệ thuật bài trí thủ công, thưởng trà và nuôi dưỡng sự bình yên từ ${displayBrand}.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: displayBrand,
      type: 'website',
    },
  }
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
  const [{ brandProfile, config }, posts] = await Promise.all([
    getStorefrontConfigForCurrentCms(),
    db.socialPost.findMany({
      where: {
        channel: 'WEBSITE',
        status: 'PUBLISHED',
      },
      orderBy: {
        publishedAt: 'desc',
      },
      take: 30,
    }),
  ])

  const displayBrand = formatCustomerStorefrontBrandName(
    brandProfile.brandName,
    config.customDomain
  )
  const logoUrl = config.banners?.shopLogoUrl || ''
  const currentYear = new Date().getFullYear()

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-800 antialiased selection:bg-amber-100 selection:text-amber-900">
      {/* Header / Thanh điều hướng thương hiệu */}
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#faf8f5]/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <Link
            href="/store"
            className="group flex min-w-0 items-center gap-3 transition-opacity hover:opacity-90"
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={displayBrand}
                referrerPolicy="no-referrer"
                className="h-10 w-10 shrink-0 rounded-full border border-stone-200 object-cover shadow-xs transition-transform group-hover:scale-105"
              />
            ) : (
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#8c4f1e] text-amber-50 shadow-sm transition-transform group-hover:scale-105">
                <Sparkles className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <span className="block truncate font-serif text-lg font-bold tracking-wide text-stone-900 sm:text-xl">
                {displayBrand}
              </span>
              <p className="truncate text-[11px] font-medium tracking-wider text-stone-600 uppercase">
                Góc Tĩnh Tâm &amp; Không Gian Thủ Công
              </p>
            </div>
          </Link>
          <nav aria-label="Điều hướng Góc Tĩnh Tâm" className="flex shrink-0 items-center gap-2 text-sm font-medium text-stone-600 sm:gap-3">
            <Link
              href="/store"
              className="rounded-full px-3.5 py-1.5 transition-colors hover:bg-stone-200/70 hover:text-stone-900"
            >
              Cửa hàng
            </Link>
            <Link
              href="/blog"
              aria-current="page"
              className="rounded-full bg-[#8c4f1e] px-3.5 py-1.5 font-semibold text-white shadow-xs"
            >
              Góc Tĩnh Tâm
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero Banner trang nhã */}
      <section className="relative overflow-hidden border-b border-stone-200/60 bg-gradient-to-b from-amber-50/50 via-stone-100/50 to-transparent py-12 sm:py-16">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/80 bg-white/90 px-3.5 py-1 text-xs font-semibold text-[#7c4316]">
            <Sparkles className="h-3.5 w-3.5" />
            <span>{displayBrand} · Tạp Bút</span>
          </div>
          <h1 className="mt-4 font-serif text-3xl font-extrabold tracking-tight text-stone-900 sm:text-4xl md:text-5xl">
            Ánh Nến Ấm, Chuyện Trà &amp; Khoảnh Khắc Tĩnh Lặng
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-stone-600 sm:text-lg">
            Gợi mở những góc nhìn dung dị về nghệ thuật bài trí không gian mộc mạc, thưởng trà, thắp
            nến thư giãn và nuôi dưỡng sự bình yên trong từng nếp nhà.
          </p>
        </div>
      </section>

      {/* Danh sách bài viết */}
      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-white/70 p-10 text-center sm:p-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-50 text-[#8c4f1e]">
              <BookOpen className="h-8 w-8" />
            </div>
            <h2 className="mt-4 font-serif text-xl font-bold text-stone-800">
              Đang ươm mầm những câu chuyện mới
            </h2>
            <p className="mt-2 max-w-md text-sm text-stone-600">
              Các bài viết chia sẻ về nghệ thuật bài trí thủ công, thiền trà và đời sống an lành sẽ
              sớm được {displayBrand} xuất bản tại đây.
            </p>
            <Link
              href="/store"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#8c4f1e] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#733f16]"
            >
              Khám Phá Cửa Hàng {displayBrand}
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
                  <Link href={postUrl} className="relative block aspect-16/10 overflow-hidden bg-stone-100">
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={post.title || displayBrand}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 via-amber-50 to-stone-200">
                        <Sparkles className="h-10 w-10 text-stone-400 opacity-60" />
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <Badge className="bg-[#8c4f1e] text-white backdrop-blur-xs hover:bg-[#733f16]">
                        Cảm Hứng
                      </Badge>
                    </div>
                  </Link>

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

                    <h2 className="mt-3 font-serif text-xl font-bold tracking-tight text-stone-900 group-hover:text-[#8c4f1e]">
                      <Link href={postUrl} className="transition-colors">
                        {post.title || `Chia sẻ từ ${displayBrand}`}
                      </Link>
                    </h2>

                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-stone-600">
                      {post.excerpt || post.content.substring(0, 150) + '...'}
                    </p>

                    <div className="mt-auto pt-5">
                      <Link
                        href={postUrl}
                        className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#8c4f1e] transition-colors group-hover:text-[#6f3d15]"
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
      <footer className="mt-16 border-t border-stone-200/80 bg-white py-10 text-center text-xs text-stone-600">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="font-serif text-sm font-bold text-stone-800">{displayBrand}</p>
          <p className="mt-1">
            {brandProfile.defaultWorkshopName || 'Không gian thủ công mộc mạc & bình yên mỗi ngày.'}
          </p>
          <p className="mt-3 text-stone-500">© {currentYear} {displayBrand}. Bảo lưu mọi quyền.</p>
        </div>
      </footer>
    </div>
  )
}
