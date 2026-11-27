'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  BadgePercent,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Phone,
  RefreshCw,
  Save,
  Server,
} from 'lucide-react'
import { apiGet, apiPatch } from '@/lib/api'
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
  }
  dnsStatus?: DnsStatusView | null
}

export function StorefrontDomainCard() {
  const { toast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [checkingDns, setCheckingDns] = useState(false)

  const [cmsInstanceId, setCmsInstanceId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [customDomain, setCustomDomain] = useState('bomocdecor.vn')
  const [cmsBackendOrigin, setCmsBackendOrigin] = useState(
    'https://openvn-cms-pos-backend.onrender.com'
  )
  const [heroTitle, setHeroTitle] = useState('')
  const [announcementBar, setAnnouncementBar] = useState('')
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
  const [allowPreorderWhenOutOfStock, setAllowPreorderWhenOutOfStock] = useState(true)
  const [hotline, setHotline] = useState('')
  const [zaloUrl, setZaloUrl] = useState('')
  const [email, setEmail] = useState('')
  const [shopeeUrl, setShopeeUrl] = useState('')
  const [address, setAddress] = useState('')
  const [workingHours, setWorkingHours] = useState('')
  const [dnsStatus, setDnsStatus] = useState<DnsStatusView | null>(null)

  const applyConfigToForm = useCallback(
    (c: StorefrontConfigResponse['config'], instanceId?: string) => {
      if (instanceId) setCmsInstanceId(instanceId)
      setEnabled(c.enabled)
      setCustomDomain(c.customDomain || '')
      setCmsBackendOrigin(c.cmsBackendOrigin || '')
      setHeroTitle(c.heroTitle || '')
      setAnnouncementBar(c.announcementBar || '')
      setWholesaleEnabled(c.wholesaleEnabled)
      if (Array.isArray(c.wholesaleTiers) && c.wholesaleTiers.length > 0) {
        setTiers(c.wholesaleTiers)
      }
      setWholesalePolicyNote(c.wholesalePolicyNote || '')
      if (typeof c.allowPreorderWhenOutOfStock === 'boolean') {
        setAllowPreorderWhenOutOfStock(c.allowPreorderWhenOutOfStock)
      }
      setHotline(c.contact?.hotline || '')
      setZaloUrl(c.contact?.zaloUrl || '')
      setEmail(c.contact?.email || '')
      setShopeeUrl(c.contact?.shopeeUrl || '')
      setAddress(c.contact?.address || '')
      setWorkingHours(c.contact?.workingHours || '')
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
          applyConfigToForm(res.config, res.cmsInstanceId)
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
        // Fallback DNS-over-HTTPS trực tiếp khi kiểm tra trên Static CDN
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

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await apiPatch<{
        ok: boolean
        config: StorefrontConfigResponse['config']
        dnsStatus?: DnsStatusView | null
      }>('/api/storefront-config', {
        enabled,
        customDomain: customDomain.trim(),
        cmsBackendOrigin: cmsBackendOrigin.trim(),
        heroTitle: heroTitle.trim(),
        announcementBar: announcementBar.trim(),
        wholesaleEnabled,
        wholesaleTiers: tiers,
        wholesalePolicyNote: wholesalePolicyNote.trim(),
        allowPreorderWhenOutOfStock,
        contact: {
          hotline: hotline.trim(),
          zaloPhone: hotline.replace(/\D/g, ''),
          zaloUrl: zaloUrl.trim(),
          email: email.trim(),
          shopeeUrl: shopeeUrl.trim(),
          address: address.trim(),
          workingHours: workingHours.trim(),
        },
      })
      if (res?.config) {
        setCustomDomain(res.config.customDomain)
      }
      if (res?.dnsStatus) {
        setDnsStatus(res.dnsStatus)
      }
      toast({
        title: 'Đã lưu cấu hình Website Khách hàng & Tên miền riêng',
        description: res?.config?.customDomain
          ? `Tên miền độc lập của CMS này: https://${res.config.customDomain}`
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
              Mỗi hệ thống CMS vận hành kho dữ liệu, tên miền riêng (Custom Domain), danh mục sản phẩm, bảng chiết khấu giá sỉ và thông tin liên hệ hoàn toàn độc lập.
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
                  <strong>CNAME (www)</strong> trỏ tới tên miền CDN/Backend tương ứng.
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

            {/* Khối 2: Bảng Giá Sỉ 3 Bậc */}
            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <BadgePercent className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-bold text-foreground">
                    Cấu hình Bảng Giá Sỉ Tự Động Theo Mốc Số Lượng
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
                        <Label className="text-[11px]">Tên mức sỉ #{idx + 1}</Label>
                        <Input
                          value={tier.label}
                          onChange={(e) => updateTierField(idx, 'label', e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Từ số lượng (SP)</Label>
                          <Input
                            type="number"
                            min={2}
                            value={tier.minQty}
                            onChange={(e) => updateTierField(idx, 'minQty', e.target.value)}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Chiết khấu (%)</Label>
                          <Input
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

            {/* Khối 3: Thông tin Liên hệ & Tiêu đề Trang chủ */}
            <div className="space-y-3 rounded-xl border p-3.5">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-[#0066CC]" />
                <span className="text-xs font-bold text-foreground">
                  Thông tin Liên hệ, Xưởng &amp; Thông điệp Website
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="sf-hotline" className="text-xs">
                    Hotline / SĐT Zalo
                  </Label>
                  <Input
                    id="sf-hotline"
                    value={hotline}
                    onChange={(e) => setHotline(e.target.value)}
                    placeholder="0909 686 868"
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
                    placeholder="https://zalo.me/0909686868"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="sf-email" className="text-xs">
                    Email liên hệ
                  </Label>
                  <Input
                    id="sf-email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="lienhe@bomocdecor.vn"
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
                    placeholder="https://shopee.vn/bomocdecor"
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
                <div className="space-y-1">
                  <Label htmlFor="sf-hero" className="text-xs">
                    Tiêu đề chính trên Banner Website
                  </Label>
                  <Input
                    id="sf-hero"
                    value={heroTitle}
                    onChange={(e) => setHeroTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2 lg:col-span-3">
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
                Cấu hình này chỉ lưu riêng trong CSDL của CMS hiện tại — các CMS khác hoàn toàn độc lập và có thể gắn tên miền riêng khác nhau.
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
