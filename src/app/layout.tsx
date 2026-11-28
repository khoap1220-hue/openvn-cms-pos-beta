import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Lora } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "@/components/cms/theme-provider";
import { ShopProfileProvider, type ShopProfileConfig } from "@/lib/shop-profile";
import { getStorefrontConfigForCurrentCms } from "@/lib/storefront-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin", "vietnamese"],
});

const loraSerif = Lora({
  variable: "--font-lora",
  subsets: ["latin", "vietnamese"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0066CC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1E36" },
  ],
};

const NEUTRAL_FALLBACK_PROFILE: ShopProfileConfig = {
  brandName: "Hệ Thống Bán Hàng Đa Kênh",
  brandShortName: "CMS",
  brandBadge: "OMNI",
  brandSubtitle: "Quản lý bán hàng đa kênh",
  brandFooterTagline:
    "Hệ thống quản trị bán hàng đa kênh · Quản lý Kho, Đơn hàng & Sổ quỹ",
  defaultWorkshopName: "Xưởng sản xuất & Đóng gói",
  workshopPresets: [
    "Xưởng sản xuất & Đóng gói",
    "Tổ gia công thành phẩm",
    "Kho đóng gói đơn sàn",
  ],
  defaultWarehouseLabel: "Kho Trung Tâm",
  storefrontUrl: "/store",
};

async function resolveInitialShopProfileServer(): Promise<ShopProfileConfig> {
  try {
    const { brandProfile } = await getStorefrontConfigForCurrentCms();
    const cleanedName =
      brandProfile.brandName && !brandProfile.brandName.includes("Ưu Đàm")
        ? brandProfile.brandName
        : brandProfile.brandName || NEUTRAL_FALLBACK_PROFILE.brandName;
    return {
      brandName: cleanedName,
      brandShortName: brandProfile.brandShortName || NEUTRAL_FALLBACK_PROFILE.brandShortName,
      brandBadge: brandProfile.brandBadge,
      brandSubtitle: brandProfile.brandSubtitle || NEUTRAL_FALLBACK_PROFILE.brandSubtitle,
      brandFooterTagline:
        brandProfile.brandFooterTagline || NEUTRAL_FALLBACK_PROFILE.brandFooterTagline,
      defaultWorkshopName:
        brandProfile.defaultWorkshopName || NEUTRAL_FALLBACK_PROFILE.defaultWorkshopName,
      workshopPresets:
        brandProfile.workshopPresets?.length > 0
          ? brandProfile.workshopPresets
          : NEUTRAL_FALLBACK_PROFILE.workshopPresets,
      defaultWarehouseLabel:
        brandProfile.defaultWarehouseLabel || NEUTRAL_FALLBACK_PROFILE.defaultWarehouseLabel,
      storefrontUrl: brandProfile.storefrontUrl || NEUTRAL_FALLBACK_PROFILE.storefrontUrl,
    };
  } catch {
    return NEUTRAL_FALLBACK_PROFILE;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const initialProfile = await resolveInitialShopProfileServer();
  const appTitle = `${initialProfile.brandShortName} POS`;
  return {
    applicationName: appTitle,
    title: `${initialProfile.brandName} — CMS Bán hàng Đa kênh & POS`,
    description: `${initialProfile.brandName}: Quản trị bán hàng đa kênh Shopee, Lazada, TikTok Shop, Website và Quầy POS tại kho đồng bộ thời gian thực.`,
    keywords: [
      "CMS",
      "bán hàng đa kênh",
      "Shopee",
      "Lazada",
      "TikTok Shop",
      "quản lý đơn hàng",
      "quản lý kho",
      "POS",
    ],
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: appTitle,
    },
    formatDetection: {
      telephone: false,
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { url: "/logo.svg", type: "image/svg+xml" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
      shortcut: ["/icons/icon-192.png"],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialProfile = await resolveInitialShopProfileServer();
  return (
    <html lang="vi" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${loraSerif.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <ShopProfileProvider initialProfile={initialProfile}>
            {children}
          </ShopProfileProvider>
        </ThemeProvider>
        <Toaster />
      </body>
    </html>
  );
}
