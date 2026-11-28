import type { Metadata } from 'next'
import { getStorefrontConfigForCurrentCms } from '@/lib/storefront-config'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { brandProfile } = await getStorefrontConfigForCurrentCms()
    const brandName = brandProfile.brandName || 'Quầy POS'
    return {
      title: `POS Bán hàng tại kho — ${brandName}`,
      description: `Quầy bán hàng tại kho trực tiếp (${brandName}).`,
    }
  } catch {
    return {
      title: 'POS Bán hàng tại kho',
    }
  }
}

export default function PosLayout({ children }: { children: React.ReactNode }) {
  return children
}
