'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BadgePercent,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe,
  Images,
  Landmark,
  Loader2,
  Phone,
  RefreshCw,
  Save,
  Server,
  Truck,
} from 'lucide-react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import {
  hasAnySyncedShopeeBanners,
  type StorefrontBannersConfig,
} from '@/lib/storefront-banners'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

interface WholesaleTierRow {
  id: string
  minQty: number
  discountPercent: number
  label: string
  badge: string
  description: string
}

interface DnsStatusView {
  domain: string
  validSyntax: boolean
  aRecords: string[]
  wwwCnameRecords: string[]
  nsRecords: string[]
  ready: boolean
  checkedAt: string
}

interface StorefrontConfigResponse {
  ok: boolean
  cmsInstanceId: string
  brandProfile?: {
    invoiceBankCode?: string
    invoiceBankName?: string
    invoiceBankAccount?: string
    invoiceBankHolder?: string
  }
  config: {
    enabled: boolean
    customDomain: string
    additionalDomains: string[]
    domainRoutingMode: 'STOREFRONT_ON_CUSTOM_DOMAIN' | 'MANUAL_STORE_PATH'
    cmsBackendOrigin: string
    heroBadge: string
    heroTitle: string
    heroSubtitle: string
    announcementBar: string
    wholesaleEnabled: boolean
    wholesaleTiers: WholesaleTierRow[]
    wholesalePolicyNote: string
    oemCustomNote: string
    freeShipThreshold: number
    baseShippingFee: number
    returnDays: number
    allowPreorderWhenOutOfStock?: boolean
    contact: {
      hotline: string
      zaloPhone: string
      zaloUrl: string
      email: string
      address: string
      workingHours: string
      shopeeUrl: string
      facebookUrl: string
      tiktokUrl: string
    }
    bankTransfer?: {
      bankCode: string
      bankName: string
      bankAccount: string
      bankHolder: string
    } | null
    banners?: StorefrontBannersConfig
  }
  dnsStatus?: DnsStatusView | null
}

export function StorefrontDomainCard() {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkingDns, setCheckingDns] = useState(false)
  const [syncingBanners, setSyncingBanners] = useState(false)

  const [cmsInstanceId, setCmsInstanceId] = useState('')
  const [banners, setBanners] = useState<StorefrontBannersConfig | null>(null)
  const [bannersEnabled, setBannersEnabled] = useState(true)
  const [enabled, setEnabled] = useState(true)
  const [customDomain, setCustomDomain] = useState('')
  const [cmsBackendOrigin, setCmsBackendOrigin] = useState(
    'https://openvn-cms-pos-backend.onrender.com'
  )

  // Hero & Announcement
  const [heroBadge, setHeroBadge] = useState('')
  const [heroTitle, setHeroTitle] = useState('')
  const [heroSubtitle, setHeroSubtitle] = useState('')
  const [announcementBar, setAnnouncementBar] = useState('')

  // Wholesale & OEM
  const [wholesaleEnabled, setWholesaleEnabled] = useState(true)
  const [tiers, setTiers] = useState<WholesaleTierRow[]>([
    {
      id: 'tier_10',
      minQty: 10,
      discountPercent: 15,
      label: 'Sỉ Khởi Nghiệp (Từ 10 SP)',
      badge: '-15%',
      description: 'Áp dụng đơn gộp từ 10 sản phẩm bất kỳ.',
    },
    {
      id: 'tier_30',
      minQty: 30,
      discountPercent: 25,
      label: 'Sỉ Đại Lý / Spa (Từ 30 SP)',
      badge: '-25%',
      description: 'Chiết khấu 25% tại xưởng.',
    },
    {
      id: 'tier_100',
      minQty: 100,
      discountPercent: 35,
      label: 'Nhà Phân Phối / OEM (100+ SP)',
      badge: '-35%',
      description: 'Giá xuất xưởng tốt nhất & hỗ trợ in logo OEM.',
    },
  ])
  const [wholesalePolicyNote, setWholesalePolicyNote] = useState('')
  const [oemCustomNote, setOemCustomNote] = useState('')
  const [allowPreorderWhenOutOfStock, setAllowPreorderWhenOutOfStock] = useState(true)

  // Shipping & Return Policies
  const [freeShipThreshold, setFreeShipThreshold] = useState('500000')
  const [baseShippingFee, setBaseShippingFee] = useState('30000')
  const [returnDays, setReturnDays] = useState('7')

  // Contact & Channels
  const [hotline, setHotline] = useState('')
  const [zaloUrl, setZaloUrl] = useState('')
  const [email, setEmail] = useState('')
  const [shopeeUrl, setShopeeUrl] = useState('')
  const [facebookUrl, setFacebookUrl] = useState('')
  const [tiktokUrl, setTiktokUrl] = useState('')
  const [address, setAddress] = useState('')
  const [workingHours, setWorkingHours] = useState('')

  // Bank Transfer / VietQR inside __storefront_v1
  const [bankCode, setBankCode] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankAccount, setBankAccount] = useState('')
  const [bankHolder, setBankHolder] = useState('')
  const [invoiceFallbackHint, setInvoiceFallbackHint] = useState('')

  const [dnsStatus, setDnsStatus] = useState<DnsStatusView | null>(null)

  const applyConfigToForm = useCallback(
    (
      c: StorefrontConfigResponse['config'],
      instanceId?: string,
      bp?: StorefrontConfigResponse['brandProfile']
    ) => {
      if (instanceId) setCmsInstanceId(instanceId)
      setEnabled(c.enabled)
      setCustomDomain(c.customDomain || '')
      setCmsBackendOrigin(c.cmsBackendOrigin || '')
      setHeroBadge(c.heroBadge || '')
      setHeroTitle(c.heroTitle || '')
      setHeroSubtitle(c.heroSubtitle || '')
      setAnnouncementBar(c.announcementBar || '')
      setWholesaleEnabled(c.wholesaleEnabled)
      if (Array.isArray(c.wholesaleTiers) && c.wholesaleTiers.length > 0) {
        setTiers(c.wholesaleTiers)
      }
      setWholesalePolicyNote(c.wholesalePolicyNote || '')
      setOemCustomNote(c.oemCustomNote || '')
      if (typeof c.allowPreorderWhenOutOfStock === 'boolean') {
        setAllowPreorderWhenOutOfStock(c.allowPreorderWhenOutOfStock)
      }
      setFreeShipThreshold(String(c.freeShipThreshold ?? 500_000))
      setBaseShippingFee(String(c.baseShippingFee ?? 30_000))
      setReturnDays(String(c.returnDays ?? 7))

      setHotline(c.contact?.hotline || '')
      setZaloUrl(c.contact?.zaloUrl || '')
      setEmail(c.contact?.email || '')
      setShopeeUrl(c.contact?.shopeeUrl || '')
      setFacebookUrl(c.contact?.facebookUrl || '')
      setTiktokUrl(c.contact?.tiktokUrl || '')
      setAddress(c.contact?.address || '')
      setWorkingHours(c.contact?.workingHours || '')

      if (c.bankTransfer && c.bankTransfer.bankCode && c.bankTransfer.bankAccount) {
        setBankCode(c.bankTransfer.bankCode)
        setBankName(c.bankTransfer.bankName || '')
        setBankAccount(c.bankTransfer.bankAccount)
        setBankHolder(c.bankTransfer.bankHolder || '')
      } else {
        setBankCode('')
        setBankName('')
        setBankAccount('')
        setBankHolder('')
      }

      if (bp !== undefined) {
        if (bp?.invoiceBankCode && bp?.invoiceBankAccount) {
          setInvoiceFallbackHint(
            `${bp.invoiceBankName || bp.invoiceBankCode} · ${bp.invoiceBankAccount}`
          )
        } else {
          setInvoiceFallbackHint('')
        }
      }

      if (c.banners) {
        setBanners(c.banners)
        setBannersEnabled(c.banners.enabled !== false)
      }
    },
    []
  )

  const loadConfig = useCallback(
    async (withDns = false) => {
      try {
        const url = withDns
          ? '/api/storefront-config?verifyDns=1'
          : '/api/storefront-config'
        const res = await apiGet<StorefrontConfigResponse>(url)
        if (res?.config) {
          applyConfigToForm(res.config, res.cmsInstanceId, res.brandProfile)
          if (res.dnsStatus) setDnsStatus(res.dnsStatus)
          return
        }
      } catch {
        // Khi mở CMS từ Static Beta CDN (khoaphan.dev / github.io), đồng bộ trực tiếp cấu hình từ Cloud Backend
      }

      try {
        const fallbackOrigin = (
          process.env.NEXT_PUBLIC_CLOUD_BACKEND_URL ||
          'https://openvn-cms-pos-backend.onrender.com'
        ).replace(/\/+$/, '')
        const pubRes = await fetch(`${fallbackOrigin}/api/public/storefront`, {
          cache: 'no-store',
        })
        if (pubRes.ok) {
          const pubJson = (await pubRes.json()) as StorefrontConfigResponse
          if (pubJson?.config) {
            applyConfigToForm(pubJson.config, pubJson.cmsInstanceId)
          }
        }
      } catch {
        // Bỏ qua nếu đang ngoại tuyến hoàn toàn
      } finally {
        setLoading(false)
      }
    },
    [applyConfigToForm]
  )

  useEffect(() => {
    void loadConfig(false).finally(() => setLoading(false))
  }, [loadConfig])

  const handleCheckDns = async () => {
    const cleanDom = customDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/^www\./, '')
    if (!cleanDom) return
    setCheckingDns(true)
    try {
      let resolvedView: DnsStatusView | null = null
      try {
        const res = await apiGet<StorefrontConfigResponse>(
          `/api/storefront-config?verifyDns=1&domain=${encodeURIComponent(cleanDom)}`
        )
        if (res?.dnsStatus) resolvedView = res.dnsStatus
      } catch {
        const [aResp, cnameResp] = await Promise.all([
          fetch(`https://dns.google/resolve?name=${encodeURIComponent(cleanDom)}&type=A`).then((r) =>
            r.ok ? r.json() : null
          ),
          fetch(
            `https://dns.google/resolve?name=${encodeURIComponent(`www.${cleanDom}`)}&type=CNAME`
          ).then((r) => (r.ok ? r.json() : null)),
        ])
        const aRecords = Array.isArray(aResp?.Answer)
          ? aResp.Answer.filter((x: { type?: number }) => x.type === 1).map((x: { data: string }) =>
              String(x.data).replace(/\.$/, '')
            )
          : []
        const wwwCnameRecords = Array.isArray(cnameResp?.Answer)
          ? cnameResp.Answer.filter((x: { type?: number }) => x.type === 5).map(
              (x: { data: string }) => String(x.data).replace(/\.$/, '')
            )
          : []
        resolvedView = {
          domain: cleanDom,
          validSyntax: true,
          aRecords,
          wwwCnameRecords,
          nsRecords: [],
          ready: aRecords.length > 0 || wwwCnameRecords.length > 0,
          checkedAt: new Date().toISOString(),
        }
      }

      if (resolvedView) {
        setDnsStatus(resolvedView)
        toast({
          title: resolvedView.ready
            ? `Tên miền ${resolvedView.domain} đã trỏ DNS thành công!`
            : `Tên miền ${resolvedView.domain} chưa có bản ghi A/CNAME`,
          description: resolvedView.ready
            ? `A: ${resolvedView.aRecords.join(', ') || '—'} · CNAME(www): ${resolvedView.wwwCnameRecords.join(', ') || '—'}`
            : 'Hãy cấu hình bản ghi A (@) và CNAME (www) theo hướng dẫn bên dưới.',
        })
      }
    } catch (e) {
      toast({
        title: 'Không thể kiểm tra DNS',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại sau.',
        variant: 'destructive',
      })
    } finally {
      setCheckingDns(false)
    }
  }

  const updateTierField = (
    idx: number,
    field: 'minQty' | 'discountPercent' | 'label',
    value: string
  ) => {
    setTiers((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row
        if (field === 'minQty') {
          const q = Math.max(2, Math.floor(Number(value) || 2))
          return { ...row, minQty: q }
        }
        if (field === 'discountPercent') {
          const pct = Math.min(85, Math.max(1, Number(value) || 1))
          return { ...row, discountPercent: pct, badge: `-${pct}%` }
        }
        return { ...row, label: value }
      })
    )
  }

  const handleSyncShopeeBanners = async () => {
    setSyncingBanners(true)
    try {
      const res = await apiPost<{
        ok: boolean
        config: StorefrontConfigResponse['config']
        banners: StorefrontBannersConfig
        summary: {
          shopUsername: string
          carouselCount: number
          spotlightCount: number
          hotspotCount: number
          collectionCount: number
        }
      }>('/api/storefront-config', { action: 'SYNC_SHOPEE_BANNERS' })
      if (res?.banners) {
        setBanners(res.banners)
        setBannersEnabled(res.banners.enabled !== false)
      }
      toast({
        title: `Đã đồng bộ Banner từ Shopee (${res?.summary?.shopUsername || 'Shop'})`,
        description: `${res?.summary?.carouselCount ?? 0} slide Carousel · ${res?.summary?.spotlightCount ?? 0} Banner điểm chạm (${res?.summary?.hotspotCount ?? 0} SP) · ${res?.summary?.collectionCount ?? 0} Bộ sưu tập.`,
      })
    } catch (e) {
      toast({
        title: 'Không thể đồng bộ Banner từ Shopee',
        description:
          e instanceof Error
            ? e.message
            : 'Vui lòng kiểm tra kết nối phiên Shopee của CMS hiện tại.',
        variant: 'destructive',
      })
    } finally {
      setSyncingBanners(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const cleanBankCode = bankCode.trim()
      const cleanBankAccount = bankAccount.trim()
      const bankTransferPayload =
        cleanBankCode && cleanBankAccount
          ? {
              bankCode: cleanBankCode,
              bankName: bankName.trim() || cleanBankCode,
              bankAccount: cleanBankAccount,
              bankHolder: bankHolder.trim(),
            }
          : null

      const cleanHotline = hotline.trim()
      const cleanHotlineDigits = cleanHotline.replace(/\D/g, '')
      const cleanZaloUrl =
        zaloUrl.trim() ||
        (cleanHotlineDigits.length >= 8 ? `https://zalo.me/${cleanHotlineDigits}` : '')

      const res = await apiPatch<{
        ok: boolean
        config: StorefrontConfigResponse['config']
        dnsStatus?: DnsStatusView | null
      }>('/api/storefront-config', {
        enabled,
        customDomain: customDomain.trim(),
        cmsBackendOrigin: cmsBackendOrigin.trim(),
        heroBadge: heroBadge.trim(),
        heroTitle: heroTitle.trim(),
        heroSubtitle: heroSubtitle.trim(),
        announcementBar: announcementBar.trim(),
        wholesaleEnabled,
        wholesaleTiers: tiers,
        wholesalePolicyNote: wholesalePolicyNote.trim(),
        oemCustomNote: oemCustomNote.trim(),
        freeShipThreshold:
          freeShipThreshold.trim() === ''
            ? 500_000
            : Math.max(0, Math.round(Number(freeShipThreshold) || 0)),
        baseShippingFee:
          baseShippingFee.trim() === ''
            ? 30_000
            : Math.max(0, Math.round(Number(baseShippingFee) || 0)),
        returnDays:
          returnDays.trim() === ''
            ? 7
            : Math.max(0, Math.min(90, Math.floor(Number(returnDays) || 0))),
        allowPreorderWhenOutOfStock,
        contact: {
          hotline: cleanHotline,
          zaloPhone: cleanHotlineDigits,
          zaloUrl: cleanZaloUrl,
          email: email.trim(),
          shopeeUrl: shopeeUrl.trim(),
          facebookUrl: facebookUrl.trim(),
          tiktokUrl: tiktokUrl.trim(),
          address: address.trim(),
          workingHours: workingHours.trim(),
        },
        bankTransfer: bankTransferPayload,
        banners: {
          enabled: bannersEnabled,
        },
      })
      if (res?.config) {
        applyConfigToForm(res.config)
      }
      if (res?.dnsStatus) {
        setDnsStatus(res.dnsStatus)
      }
      toast({
        title: 'Đã lưu cấu hình Website Khách hàng & Tên miền riêng',
        description: res?.config?.customDomain
          ? `Mọi thay đổi sản phẩm, giá sỉ, VietQR & liên hệ đã đồng bộ tức thì lên https://${res.config.customDomain}`
          : 'Đã cập nhật giao diện Cửa hàng Trực tuyến (/store).',
      })
    } catch (e) {
      toast({
        title: 'Lỗi lưu cấu hình Website',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại định dạng tên miền.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const liveStoreHref = customDomain.trim()
    ? `https://${customDomain.trim().replace(/^https?:\/\//i, '')}`
    : '/store'

  return (
    <Card className="border-emerald-200/90 shadow-sm lg:col-span-2 dark:border-emerald-900/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                Website Khách Hàng, Bảng Giá Sỉ &amp; Tên Miền Riêng (Độc Lập Từng CMS)
              </CardTitle>
              {cmsInstanceId && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  ID Độc lập: {cmsInstanceId}
                </Badge>
              )}
            </div>
            <CardDescription>
              Mỗi hệ thống CMS vận hành kho dữ liệu, tên miền riêng (Custom Domain), danh mục sản phẩm, bảng chiết khấu giá sỉ, tài khoản VietQR và thông tin liên hệ hoàn toàn độc lập.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-1.5 text-xs">
              <Switch checked={enabled} onCheckedChange={setEnabled} id="sf-enabled-switch" />
              <Label htmlFor="sf-enabled-switch" className="cursor-pointer text-xs font-semibold">
                {enabled ? 'Đang mở Website' : 'Tạm ẩn'}
              </Label>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-semibold">
              <a href="/api/system/backup?format=json" download>
                <Download className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Sao lưu 24 Bảng (.json)</span>
              </a>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5 text-xs font-semibold">
              <Link href="/store" target="_blank" rel="noopener noreferrer">
                <span>Xem thử /store</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </Button>
            {customDomain.trim() && (
              <Button
                asChild
                size="sm"
                className="h-9 gap-1.5 bg-emerald-600 text-xs font-semibold text-white hover:bg-emerald-700"
              >
                <a href={liveStoreHref} target="_blank" rel="noopener noreferrer">
                  <Globe className="h-3.5 w-3.5" />
                  <span>Mở {customDomain.trim()}</span>
                </a>
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted/40" />
        ) : (
          <>
            {/* Khối 1: Tên miền riêng & Định tuyến độc lập từng CMS */}
            <div className="space-y-3 rounded-xl border border-emerald-200/70 bg-emerald-50/30 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/15">
              <div className="grid gap-3 md:grid-cols-12">
                <div className="space-y-1.5 md:col-span-5">
                  <Label htmlFor="sf-custom-domain">
                    Tên miền riêng (Custom Domain) của CMS này
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="sf-custom-domain"
                      name="customDomain"
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      placeholder="VD: bomocdecor.vn hoặc shopcuaban.vn"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleCheckDns()}
                      disabled={checkingDns || !customDomain.trim()}
                      className="shrink-0 gap-1.5 text-xs font-semibold"
                    >
                      {checkingDns ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Kiểm tra DNS
                    </Button>
                  </div>
                </div>

                <div className="space-y-1.5 md:col-span-7">
                  <Label htmlFor="sf-backend-origin" className="flex items-center gap-1.5">
                    <Server className="h-3.5 w-3.5 text-[#0066CC]" />
                    Máy chủ API Backend riêng của CMS này (Cô lập dữ liệu 100%)
                  </Label>
                  <Input
                    id="sf-backend-origin"
                    name="cmsBackendOrigin"
                    value={cmsBackendOrigin}
                    onChange={(e) => setCmsBackendOrigin(e.target.value)}
                    placeholder="https://openvn-cms-pos-backend.onrender.com"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  Hướng dẫn trỏ DNS tên miền riêng: Bản ghi <strong>A (@)</strong> trỏ tới{' '}
                  <code className="rounded bg-muted px-1">185.199.108.153 .. 111.153</code> (Static CDN) hoặc IP VPS/Proxy của CMS; Bản ghi{' '}
                  <strong>CNAME (www)</strong> trỏ tới tên miền CDN/Backend tương ứng. Khi bấm <strong>Lưu Cấu Hình</strong>, trang tên miền riêng tự động đồng bộ tức thì qua API trực tiếp; nếu đổi thẻ tiêu đề SEO <code>&lt;head&gt;</code> tĩnh, chạy <code>node scripts/publish-storefront-domain.mjs</code> để làm mới bản chụp HTML CDN.
                </span>
                {dnsStatus && (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {dnsStatus.ready
                      ? `DNS Sẵn sàng (${dnsStatus.aRecords.length} A · ${dnsStatus.wwwCnameRecords.length} CNAME)`
                      : 'Chưa phát hiện bản ghi A/CNAME'}
                  </span>
                )}
              </div>
            </div>

            {/* Khối 1B: Đồng bộ Banner Trang trí Gian hàng từ Shopee */}
            <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/25 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/15">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Images className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                    <span className="text-xs font-bold text-foreground">
                      Banner Trang Trí Đồng Bộ Từ Gian Hàng Shopee
                    </span>
                    {banners?.sourceShopUsername && (
                      <Badge variant="outline" className="text-[10px] font-semibold">
                        shopee.vn/{banners.sourceShopUsername}
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Tự động lấy Logo, Ảnh bìa, Carousel xoay vòng, Banner điểm chạm gắn sản phẩm và Ảnh danh mục từ Kênh Người Bán Shopee của riêng CMS này.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={bannersEnabled}
                      onCheckedChange={setBannersEnabled}
                      id="sf-banners-switch"
                    />
                    <Label htmlFor="sf-banners-switch" className="cursor-pointer text-xs">
                      Hiển thị trên Website
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleSyncShopeeBanners()}
                    disabled={syncingBanners}
                    className="h-8 gap-1.5 border-amber-400/80 bg-background text-xs font-semibold text-amber-900 hover:bg-amber-100/60 dark:border-amber-800 dark:text-amber-200"
                  >
                    {syncingBanners ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Đồng bộ Banner từ Shopee
                  </Button>
                </div>
              </div>

              {hasAnySyncedShopeeBanners(banners) && banners && (
                <div className="space-y-2 border-t border-amber-200/60 pt-2.5 dark:border-amber-900/40">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span>
                      Đã đồng bộ:{' '}
                      <strong className="text-foreground">
                        {banners.carouselBanners.length} Banner Carousel
                      </strong>{' '}
                      ·{' '}
                      <strong className="text-foreground">
                        {banners.spotlightBanners.length} Banner Điểm chạm
                      </strong>{' '}
                      (
                      {banners.spotlightBanners.reduce((s, b) => s + b.hotspots.length, 0)} SP gắn link) ·{' '}
                      <strong className="text-foreground">
                        {banners.collectionBanners.length} Bộ sưu tập
                      </strong>
                    </span>
                    {banners.syncedAt && (
                      <span>
                        Cập nhật: {new Date(banners.syncedAt).toLocaleString('vi-VN')}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                    {banners.coverBannerUrl && (
                      <div className="overflow-hidden rounded-lg border bg-background p-1">
                        <img
                          src={banners.coverBannerUrl}
                          alt="Ảnh bìa Shopee"
                          referrerPolicy="no-referrer"
                          className="aspect-[2/1] w-full rounded object-cover"
                        />
                        <p className="mt-1 truncate px-1 text-[10px] font-medium text-muted-foreground">
                          Ảnh bìa Hero
                        </p>
                      </div>
                    )}
                    {banners.spotlightBanners.map((sb) => (
                      <div
                        key={sb.id}
                        className="overflow-hidden rounded-lg border bg-background p-1"
                      >
                        <img
                          src={sb.imageUrl}
                          alt="Banner điểm chạm"
                          referrerPolicy="no-referrer"
                          className="aspect-[2/1] w-full rounded object-cover"
                        />
                        <p className="mt-1 truncate px-1 text-[10px] font-medium text-muted-foreground">
                          Điểm chạm ({sb.hotspots.length} SP)
                        </p>
                      </div>
                    ))}
                    {banners.carouselBanners.slice(0, 3).map((cb, idx) => (
                      <div
                        key={cb.id}
                        className="overflow-hidden rounded-lg border bg-background p-1"
                      >
                        <img
                          src={cb.imageUrl}
                          alt={cb.title || `Carousel #${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="aspect-[2/1] w-full rounded object-cover"
                        />
                        <p className="mt-1 truncate px-1 text-[10px] font-medium text-muted-foreground">
                          Carousel #{idx + 1}
                        </p>
                      </div>
                    ))}
                    {!banners.coverBannerUrl &&
                      banners.spotlightBanners.length === 0 &&
                      banners.carouselBanners.length === 0 &&
                      banners.collectionBanners.slice(0, 4).map((col) => (
                        <div
                          key={col.id}
                          className="overflow-hidden rounded-lg border bg-background p-1"
                        >
                          <img
                            src={col.imageUrl}
                            alt={col.name}
                            referrerPolicy="no-referrer"
                            className="aspect-[2/1] w-full rounded object-cover"
                          />
                          <p className="mt-1 truncate px-1 text-[10px] font-medium text-muted-foreground">
                            Bộ sưu tập: {col.name}
                          </p>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>

            {/* Khối 2: Bảng Giá Sỉ 3 Bậc & Gia Công OEM */}
            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BadgePercent className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-bold text-foreground">
                    Cấu hình Bảng Giá Sỉ Tự Động Theo Mốc Số Lượng &amp; Gia Công OEM
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={wholesaleEnabled}
                    onCheckedChange={setWholesaleEnabled}
                    id="sf-ws-switch"
                  />
                  <Label htmlFor="sf-ws-switch" className="text-xs">
                    Hiển thị tab Bảng Giá Sỉ cho khách hàng
                  </Label>
                </div>
              </div>

              {wholesaleEnabled && (
                <div className="grid gap-3 md:grid-cols-3">
                  {tiers.map((tier, idx) => (
                    <div
                      key={tier.id}
                      className="space-y-2 rounded-lg border bg-muted/20 p-2.5 text-xs"
                    >
                      <div className="space-y-1">
                        <Label htmlFor={`sf-tier-label-${idx}`} className="text-[11px]">
                          Tên mức sỉ #{idx + 1}
                        </Label>
                        <Input
                          id={`sf-tier-label-${idx}`}
                          value={tier.label}
                          onChange={(e) => updateTierField(idx, 'label', e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`sf-tier-qty-${idx}`} className="text-[11px]">
                            Từ số lượng (SP)
                          </Label>
                          <Input
                            id={`sf-tier-qty-${idx}`}
                            type="number"
                            min={2}
                            value={tier.minQty}
                            onChange={(e) => updateTierField(idx, 'minQty', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`sf-tier-pct-${idx}`} className="text-[11px]">
                            Chiết khấu (%)
                          </Label>
                          <Input
                            id={`sf-tier-pct-${idx}`}
                            type="number"
                            min={1}
                            max={85}
                            value={tier.discountPercent}
                            onChange={(e) =>
                              updateTierField(idx, 'discountPercent', e.target.value)
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="sf-ws-note" className="text-xs">
                    Ghi chú chính sách sỉ &amp; hỗ trợ đại lý
                  </Label>
                  <Textarea
                    id="sf-ws-note"
                    rows={2}
                    value={wholesalePolicyNote}
                    onChange={(e) => setWholesalePolicyNote(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-oem-note" className="text-xs">
                    Chính sách Gia công OEM / Khắc in Hộp quà Doanh nghiệp
                  </Label>
                  <Textarea
                    id="sf-oem-note"
                    rows={2}
                    value={oemCustomNote}
                    onChange={(e) => setOemCustomNote(e.target.value)}
                    placeholder="VD: Nhận phối màu riêng, khắc/in logo hộp quà từ 100 SP..."
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={allowPreorderWhenOutOfStock}
                    onCheckedChange={setAllowPreorderWhenOutOfStock}
                    id="sf-preorder-switch"
                  />
                  <Label htmlFor="sf-preorder-switch" className="cursor-pointer text-xs">
                    Cho phép đặt chế tác trước tại xưởng khi tồn kho sản phẩm = 0
                  </Label>
                </div>
              </div>
            </div>

            {/* Khối 3: Chính sách Vận chuyển, Đổi trả & Ngân hàng VietQR */}
            <div className="grid gap-4 lg:grid-cols-12">
              <div className="space-y-3 rounded-xl border p-3.5 lg:col-span-5">
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-emerald-600" />
                  <span className="text-xs font-bold text-foreground">
                    Chính sách Phí giao hàng, Freeship &amp; Đổi trả
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                  <div className="space-y-1">
                    <Label htmlFor="sf-freeship" className="text-xs">
                      Ngưỡng Miễn phí vận chuyển (₫)
                    </Label>
                    <Input
                      id="sf-freeship"
                      type="number"
                      min={0}
                      step={10000}
                      value={freeShipThreshold}
                      onChange={(e) => setFreeShipThreshold(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sf-shipfee" className="text-xs">
                      Phí giao hàng cơ bản dưới ngưỡng (₫)
                    </Label>
                    <Input
                      id="sf-shipfee"
                      type="number"
                      min={0}
                      step={1000}
                      value={baseShippingFee}
                      onChange={(e) => setBaseShippingFee(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sf-returndays" className="text-xs">
                      Số ngày hỗ trợ đổi trả / bảo hành bể vỡ
                    </Label>
                    <Input
                      id="sf-returndays"
                      type="number"
                      min={0}
                      max={90}
                      value={returnDays}
                      onChange={(e) => setReturnDays(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-sky-200/80 bg-sky-50/25 p-3.5 lg:col-span-7 dark:border-sky-900/50 dark:bg-sky-950/15">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-[#0066CC]" />
                    <span className="text-xs font-bold text-foreground">
                      Tài Khoản Ngân Hàng Nhận Chuyển Khoản &amp; Sinh Mã VietQR Tự Động
                    </span>
                  </div>
                  {invoiceFallbackHint && !bankAccount.trim() && (
                    <Badge variant="outline" className="text-[10px]">
                      Đang kế thừa Hóa đơn: {invoiceFallbackHint}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Lưu riêng cho Website (0 ảnh hưởng cấu hình Hóa đơn nếu muốn tách STK). Nếu để trống cả ở đây lẫn mục Hóa đơn, khách chọn Chuyển khoản sẽ nhận thông báo Xưởng gửi mã VietQR xác nhận qua SĐT/Zalo.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="sf-bank-code" className="text-xs">
                      Mã Ngân hàng VietQR (VD: VCB, MB, TCB, ACB)
                    </Label>
                    <Input
                      id="sf-bank-code"
                      value={bankCode}
                      onChange={(e) => setBankCode(e.target.value)}
                      placeholder="VD: VCB hoặc MBBank"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sf-bank-account" className="text-xs">
                      Số tài khoản nhận tiền
                    </Label>
                    <Input
                      id="sf-bank-account"
                      value={bankAccount}
                      onChange={(e) => setBankAccount(e.target.value)}
                      placeholder="VD: 0071001234567"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sf-bank-name" className="text-xs">
                      Tên hiển thị Ngân hàng
                    </Label>
                    <Input
                      id="sf-bank-name"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      placeholder="VD: Vietcombank — CN TP.HCM"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="sf-bank-holder" className="text-xs">
                      Chủ tài khoản (Không dấu hoặc Có dấu)
                    </Label>
                    <Input
                      id="sf-bank-holder"
                      value={bankHolder}
                      onChange={(e) => setBankHolder(e.target.value)}
                      placeholder="VD: NGUYEN VAN A"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Khối 4: Thông điệp Trang chủ, Thanh ưu đãi & Thông tin Liên hệ */}
            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-[#0066CC]" />
                <span className="text-xs font-bold text-foreground">
                  Thông điệp Trang chủ, Thanh Ưu Đãi Đầu Trang &amp; Kênh Liên Hệ Chính Thức
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                  <Label htmlFor="sf-announce" className="text-xs">
                    Thanh thông báo ưu đãi đầu trang (Announcement Bar)
                  </Label>
                  <Input
                    id="sf-announce"
                    value={announcementBar}
                    onChange={(e) => setAnnouncementBar(e.target.value)}
                    placeholder="VD: Miễn phí vận chuyển toàn quốc đơn lẻ từ 500.000 ₫ · Chiết khấu Giá Sỉ từ 10 SP"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sf-hero-badge" className="text-xs">
                    Nhãn nổi bật trên Hero (Hero Badge)
                  </Label>
                  <Input
                    id="sf-hero-badge"
                    value={heroBadge}
                    onChange={(e) => setHeroBadge(e.target.value)}
                    placeholder="Xưởng Thủ Công Chính Hãng · Sỉ & Lẻ Toàn Quốc"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="sf-hero" className="text-xs">
                    Tiêu đề chính trên Banner Website (H1)
                  </Label>
                  <Input
                    id="sf-hero"
                    value={heroTitle}
                    onChange={(e) => setHeroTitle(e.target.value)}
                  />
                </div>

                <div className="space-y-1 sm:col-span-2 lg:col-span-3">
                  <Label htmlFor="sf-hero-sub" className="text-xs">
                    Mô tả ngắn giới thiệu cửa hàng dưới tiêu đề Hero
                  </Label>
                  <Textarea
                    id="sf-hero-sub"
                    rows={2}
                    value={heroSubtitle}
                    onChange={(e) => setHeroSubtitle(e.target.value)}
                    className="text-xs"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="sf-hotline" className="text-xs">
                    Hotline / SĐT Zalo chính thức (Để trống nếu chưa công bố)
                  </Label>
                  <Input
                    id="sf-hotline"
                    type="tel"
                    inputMode="tel"
                    value={hotline}
                    onChange={(e) => setHotline(e.target.value)}
                    placeholder="VD: 0938 xxx xxx"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-zalo" className="text-xs">
                    Đường dẫn Chat Zalo
                  </Label>
                  <Input
                    id="sf-zalo"
                    value={zaloUrl}
                    onChange={(e) => setZaloUrl(e.target.value)}
                    placeholder="VD: https://zalo.me/..."
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-email" className="text-xs">
                    Email liên hệ
                  </Label>
                  <Input
                    id="sf-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="VD: cskh@tenmiencuaban.vn"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-shopee" className="text-xs">
                    Link Gian hàng Shopee
                  </Label>
                  <Input
                    id="sf-shopee"
                    value={shopeeUrl}
                    onChange={(e) => setShopeeUrl(e.target.value)}
                    placeholder="https://shopee.vn/..."
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-facebook" className="text-xs">
                    Link Fanpage Facebook (tùy chọn)
                  </Label>
                  <Input
                    id="sf-facebook"
                    value={facebookUrl}
                    onChange={(e) => setFacebookUrl(e.target.value)}
                    placeholder="https://facebook.com/..."
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-tiktok" className="text-xs">
                    Link Kênh TikTok (tùy chọn)
                  </Label>
                  <Input
                    id="sf-tiktok"
                    value={tiktokUrl}
                    onChange={(e) => setTiktokUrl(e.target.value)}
                    placeholder="https://tiktok.com/@..."
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-hours" className="text-xs">
                    Giờ làm việc
                  </Label>
                  <Input
                    id="sf-hours"
                    value={workingHours}
                    onChange={(e) => setWorkingHours(e.target.value)}
                    placeholder="08:30 – 21:00 (Thứ 2 – Chủ Nhật)"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="sf-address" className="text-xs">
                    Địa chỉ Xưởng / Showroom hiển thị cho khách hàng
                  </Label>
                  <Input
                    id="sf-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Cấu hình này lưu cô lập trong <code>IntegrationCredential(WEBSITE)</code> của riêng CMS hiện tại (0 sinh thêm dòng AppSetting) — các CMS khác hoàn toàn độc lập.
              </p>
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Lưu Cấu Hình Website &amp; Domain Riêng
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
