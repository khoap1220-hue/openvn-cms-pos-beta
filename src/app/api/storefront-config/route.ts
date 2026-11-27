import dns from 'node:dns/promises'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeDomainHostname } from '@/lib/domain-routing'
import { logLedger } from '@/lib/ledger'
import { syncShopeeBannersForCurrentCms } from '@/lib/shopee-banner-sync'
import {
  getStorefrontConfigForCurrentCms,
  saveStorefrontConfigForCurrentCms,
} from '@/lib/storefront-config'

export const dynamic = 'force-dynamic'

interface DnsVerificationResult {
  domain: string
  validSyntax: boolean
  aRecords: string[]
  wwwCnameRecords: string[]
  nsRecords: string[]
  ready: boolean
  checkedAt: string
}

async function verifyCustomDomainDns(rawDomain: string): Promise<DnsVerificationResult> {
  const domain = normalizeDomainHostname(rawDomain, { stripWww: true })
  if (!domain) {
    return {
      domain: '',
      validSyntax: false,
      aRecords: [],
      wwwCnameRecords: [],
      nsRecords: [],
      ready: false,
      checkedAt: new Date().toISOString(),
    }
  }

  const [aRecords, wwwCnameRecords, nsRecords] = await Promise.all([
    dns.resolve4(domain).catch(() => [] as string[]),
    dns.resolveCname(`www.${domain}`).catch(() => [] as string[]),
    dns.resolveNs(domain).catch(() => [] as string[]),
  ])

  return {
    domain,
    validSyntax: true,
    aRecords,
    wwwCnameRecords,
    nsRecords,
    ready: aRecords.length > 0 || wwwCnameRecords.length > 0,
    checkedAt: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  try {
    const data = await getStorefrontConfigForCurrentCms()
    const verifyParam = req.nextUrl.searchParams.get('verifyDns')
    const domainOverride = req.nextUrl.searchParams.get('domain')
    const dnsStatus =
      verifyParam === '1'
        ? await verifyCustomDomainDns(domainOverride || data.config.customDomain)
        : null

    return NextResponse.json({
      ok: true,
      cmsInstanceId: data.cmsInstanceId,
      brandProfile: data.brandProfile,
      config: data.config,
      dnsStatus,
    })
  } catch (error) {
    console.error('Storefront config GET error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể tải cấu hình Website & Tên miền riêng.' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.customDomain === 'string' && body.customDomain.trim().length > 0) {
      const cleaned = normalizeDomainHostname(body.customDomain, { stripWww: true })
      if (!cleaned) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Định dạng tên miền riêng không hợp lệ (ví dụ hợp lệ: bomocdecor.vn hoặc shopcuaban.com).',
          },
          { status: 400 }
        )
      }
      body.customDomain = cleaned
    }

    const saved = await saveStorefrontConfigForCurrentCms(body)

    await logLedger({
      scope: 'SETTINGS',
      action: 'STOREFRONT_CONFIG_UPDATED',
      entityType: 'IntegrationCredential',
      entityCode: 'WEBSITE',
      title: `Cập nhật cấu hình Website Khách hàng & Tên miền riêng (${saved.customDomain || '/store'})`,
      detail: {
        customDomain: saved.customDomain,
        domainRoutingMode: saved.domainRoutingMode,
        wholesaleEnabled: saved.wholesaleEnabled,
        tierCount: saved.wholesaleTiers.length,
        hotline: saved.contact.hotline,
      },
      actor: 'OPERATOR',
      originSource: 'MANUAL_ADMIN',
    })

    const dnsStatus = saved.customDomain
      ? await verifyCustomDomainDns(saved.customDomain)
      : null

    return NextResponse.json({
      ok: true,
      config: saved,
      dnsStatus,
    })
  } catch (error) {
    console.error('Storefront config PATCH error:', error)
    return NextResponse.json(
      { ok: false, error: 'Không thể lưu cấu hình Website & Tên miền riêng.' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    if (body.action !== 'SYNC_SHOPEE_BANNERS') {
      return NextResponse.json(
        { ok: false, error: 'Thao tác không hợp lệ (yêu cầu action=SYNC_SHOPEE_BANNERS).' },
        { status: 400 }
      )
    }

    const result = await syncShopeeBannersForCurrentCms()

    await logLedger({
      scope: 'SETTINGS',
      action: 'STOREFRONT_SHOPEE_BANNERS_SYNCED',
      entityType: 'IntegrationCredential',
      entityCode: 'WEBSITE',
      title: `Đồng bộ Banner trang trí từ Shopee (${result.summary.shopUsername} · #${result.summary.shopId}) về Website`,
      detail: result.summary,
      actor: 'OPERATOR',
      originSource: 'MARKETPLACE_SYNC',
    })

    return NextResponse.json({
      ok: true,
      config: result.config,
      banners: result.banners,
      summary: result.summary,
    })
  } catch (error) {
    console.error('Storefront config POST sync banners error:', error)
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Không thể đồng bộ Banner từ Shopee lúc này.',
      },
      { status: 500 }
    )
  }
}
