import type { Metadata } from 'next'
import { getStorefrontConfigForCurrentCms } from '@/lib/storefront-config'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { brandProfile } = await getStorefrontConfigForCurrentCms()
    const brandName = brandProfile.brandName || 'Hệ thống Quản trị'
    return {
      title: `Đăng nhập Ca trực — ${brandName}`,
      description: `Cổng đăng nhập nhân sự & phân quyền vai trò của ${brandName}.`,
    }
  } catch {
    return {
      title: 'Đăng nhập Ca trực & Phân quyền Vai trò',
    }
  }
}

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children
}
