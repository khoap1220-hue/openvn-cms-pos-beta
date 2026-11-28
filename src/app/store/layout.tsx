import type { Metadata, Viewport } from 'next'
import { getStorefrontConfigForCurrentCms } from '@/lib/storefront-config'
import { formatCustomerStorefrontBrandName } from '@/lib/storefront-ux'

export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#1c1917' },
  ],
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { brandProfile, config } = await getStorefrontConfigForCurrentCms()
    const displayBrand = formatCustomerStorefrontBrandName(
      brandProfile.brandName,
      config.customDomain
    )
    const title = `${displayBrand} — ${
      config.heroTitle || 'Sản phẩm Thủ công, Bảng Giá Sỉ & Liên hệ Chính thức'
    }`
    const description =
      config.heroSubtitle ||
      `Cửa hàng trực tuyến chính thức của ${displayBrand} — Sản phẩm chính hãng, bảng giá sỉ xưởng và tra cứu đơn hàng.`
    const coverImg =
      config.banners?.coverBannerUrl || config.banners?.carouselBanners?.[0]?.imageUrl || ''

    return {
      applicationName: displayBrand,
      title,
      description,
      openGraph: {
        type: 'website',
        locale: 'vi_VN',
        siteName: displayBrand,
        title,
        description,
        ...(config.customDomain ? { url: `https://${config.customDomain}/` } : {}),
        ...(coverImg ? { images: [coverImg] } : {}),
      },
      twitter: {
        card: 'summary_large_image',
        title,
        description,
        ...(coverImg ? { images: [coverImg] } : {}),
      },
      ...(config.banners?.shopLogoUrl
        ? {
            icons: {
              icon: [{ url: config.banners.shopLogoUrl }],
            },
          }
        : {}),
    }
  } catch {
    return {
      title: 'Cửa hàng Trực tuyến Chính thức',
      description: 'Danh mục sản phẩm, bảng giá sỉ xưởng và liên hệ đặt hàng trực tuyến.',
    }
  }
}

export default function StorefrontLayout({ children }: { children: React.ReactNode }) {
  return children
}
