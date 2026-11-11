import { NextRequest, NextResponse } from 'next/server'
import { logLedger } from '@/lib/ledger'
import {
  getApiCache,
  invalidateApiCache,
  setApiCache,
  setMaintenanceMemoryState,
} from '@/lib/realtime'
import {
  ensureMaintenanceStateHydrated,
  getSettings,
  setSettingsBatch,
  writeMaintenanceStateFile,
} from '@/lib/settings'

export const dynamic = 'force-dynamic'

// Các setting công khai (không bao giờ trả raw API key)
const PUBLIC_KEYS = [
  'company_name',
  'company_tax',
  'company_address',
  'company_phone', // SĐT đơn vị — in trên header hóa đơn
  'vat_default',
  // THIẾT LẬP HÓA ĐƠN — mẫu in hóa đơn bán GTGT
  'invoice_title', // tiêu đề HÓA ĐƠN BÁN HÀNG
  'invoice_template_code', // Mẫu số (vd 01GTKT0/001)
  'invoice_series', // Ký hiệu (vd AA/26E)
  'invoice_number_start', // Số bắt đầu ghi số hóa đơn bán (tăng dần, không dùng lại)
  'invoice_payment_method', // hình thức thanh toán mặc định in trên hóa đơn
  'invoice_bank_name', // tên ngân hàng
  'invoice_bank_account', // số tài khoản
  'invoice_bank_holder', // chủ tài khoản
  'invoice_bank_code', // mã ngân hàng VietQR (vd VCB) — tạo mã QR chuyển khoản trên bản in hóa đơn bán
  'invoice_footer_note', // ghi chú cuối hóa đơn
  'invoice_default_note', // ghi chú mặc định khi tạo hóa đơn
  // THIẾT LẬP THƯƠNG HIỆU & TÙY BIẾN THEO TỪNG SHOP (Sidebar, Topbar, Xưởng SX, Kho mặc định)
  'brand_name',
  'brand_short_name',
  'brand_badge',
  'brand_subtitle',
  'brand_footer_tagline',
  'shop_default_workshop',
  'shop_workshop_presets',
  'shop_default_warehouse_label',
  'shop_storefront_url',
] as const

const DEFAULTS: Record<string, string> = {
  invoice_title: 'HÓA ĐƠN BÁN HÀNG',
  invoice_template_code: '01GTKT0/001',
  invoice_series: 'AA/26E',
  invoice_number_start: '1',
  invoice_payment_method: 'Tiền mặt / Chuyển khoản',
  invoice_bank_code: '',
  invoice_footer_note: 'Cảm ơn Quý khách đã mua hàng!',
  invoice_default_note: '',
  brand_name: 'OPENVN · Ưu Đàm',
  brand_short_name: 'OPENVN',
  brand_badge: 'OMNI',
  brand_subtitle: 'Quản lý bán hàng đa kênh',
  brand_footer_tagline: 'Quản lý bán hàng đa kênh · Agent Autopilot 100% · Invoice Pro · Offline-first',
  shop_default_workshop: 'Xưởng đúc thủ công',
  shop_workshop_presets: 'Xưởng đúc thủ công, Tổ đổ nến bơ tự nhiên, Tổ hoàn thiện & đóng gói',
  shop_default_warehouse_label: 'Kho Trung Tâm',
  shop_storefront_url: '/store',
}

/** giới hạn độ dài từng trường để chống nhồi dữ liệu */
const MAX_LENGTHS: Record<string, number> = {
  company_phone: 40,
  invoice_title: 120,
  invoice_template_code: 60,
  invoice_series: 40,
  invoice_payment_method: 120,
  invoice_bank_name: 120,
  invoice_bank_account: 60,
  invoice_bank_holder: 120,
  invoice_bank_code: 20,
  invoice_footer_note: 500,
  invoice_default_note: 500,
  invoice_logo: 600_000, // data URL ảnh logo (≈450KB ảnh gốc)
  brand_name: 80,
  brand_short_name: 30,
  brand_badge: 20,
  brand_subtitle: 120,
  brand_footer_tagline: 240,
  shop_default_workshop: 120,
  shop_workshop_presets: 600,
  shop_default_warehouse_label: 120,
  shop_storefront_url: 240,
}

async function buildPublicSettings(): Promise<Record<string, string | boolean>> {
  const [values, maintenance] = await Promise.all([
    getSettings([...PUBLIC_KEYS, 'invoice_logo', 'gemini_api_key']),
    ensureMaintenanceStateHydrated(),
  ])
  const geminiKey = values.gemini_api_key ?? null
  const out: Record<string, string | boolean> = {
    company_name: values.company_name ?? '',
    company_tax: values.company_tax ?? '',
    company_address: values.company_address ?? '',
    company_phone: values.company_phone ?? '',
    vat_default: values.vat_default ?? '8',
    invoice_logo: values.invoice_logo ?? '',
    geminiConfigured: Boolean(geminiKey && geminiKey.trim().length > 0),
    maintenance_mode: maintenance.enabled,
  }
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = values[key] ?? DEFAULTS[key]
  }
  // ngân hàng + logo: không có giá trị mặc định, trả chuỗi rỗng khi chưa cấu hình
  for (const key of ['invoice_bank_name', 'invoice_bank_account', 'invoice_bank_holder']) {
    out[key] = values[key] ?? ''
  }
  return out
}

export async function GET() {
  try {
    const cached = getApiCache<Record<string, string | boolean>>('settings:public')
    if (cached) {
      return NextResponse.json(cached)
    }
    const payload = await buildPublicSettings()
    setApiCache('settings:public', payload, 60_000)
    return NextResponse.json(payload)
  } catch (error) {
    console.error('Settings GET error:', error)
    return NextResponse.json({ error: 'Không thể tải cấu hình hệ thống' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const updates: Array<{ key: string; value: string }> = []

    if (body.company_name !== undefined) updates.push({ key: 'company_name', value: String(body.company_name).trim() })
    if (body.company_tax !== undefined) updates.push({ key: 'company_tax', value: String(body.company_tax).trim() })
    if (body.company_address !== undefined) updates.push({ key: 'company_address', value: String(body.company_address).trim() })
    if (body.company_phone !== undefined) {
      const value = String(body.company_phone).trim()
      if (value.length > (MAX_LENGTHS.company_phone ?? 40)) {
        return NextResponse.json({ error: 'Điện thoại đơn vị tối đa 40 ký tự' }, { status: 400 })
      }
      updates.push({ key: 'company_phone', value })
    }
    if (body.vat_default !== undefined) {
      const vat = Number(body.vat_default)
      if (!Number.isFinite(vat) || vat < 0 || vat > 100) {
        return NextResponse.json({ error: 'VAT mặc định phải là số từ 0 đến 100' }, { status: 400 })
      }
      updates.push({ key: 'vat_default', value: String(vat) })
    }
    if (body.gemini_api_key !== undefined) {
      // cho phép truyền chuỗi rỗng để xóa key
      updates.push({ key: 'gemini_api_key', value: String(body.gemini_api_key).trim() })
    }
    let maintenanceToggled: boolean | null = null
    if (body.maintenance_mode !== undefined) {
      const enabled = body.maintenance_mode === true || body.maintenance_mode === 'true' || body.maintenance_mode === '1'
      const updatedAt = new Date().toISOString()
      const currentMaint = await ensureMaintenanceStateHydrated()
      writeMaintenanceStateFile({
        enabled,
        reason: currentMaint.reason,
        retryAfterSec: currentMaint.retryAfterSec,
        updatedAt,
      })
      setMaintenanceMemoryState({ enabled, updatedAt, hydrated: true })
      maintenanceToggled = enabled
    }

    // THIẾT LẬP HÓA ĐƠN
    if (body.invoice_number_start !== undefined) {
      const start = Math.floor(Number(body.invoice_number_start))
      if (!Number.isFinite(start) || start < 1) {
        return NextResponse.json({ error: 'Số bắt đầu hóa đơn phải là số nguyên từ 1 trở lên' }, { status: 400 })
      }
      updates.push({ key: 'invoice_number_start', value: String(start) })
    }
    for (const key of [
      'invoice_title',
      'invoice_template_code',
      'invoice_series',
      'invoice_payment_method',
      'invoice_bank_name',
      'invoice_bank_account',
      'invoice_bank_holder',
      'invoice_bank_code',
      'invoice_footer_note',
      'invoice_default_note',
      'brand_name',
      'brand_short_name',
      'brand_badge',
      'brand_subtitle',
      'brand_footer_tagline',
      'shop_default_workshop',
      'shop_workshop_presets',
      'shop_default_warehouse_label',
      'shop_storefront_url',
    ]) {
      if (body[key] === undefined) continue
      const value = String(body[key]).trim()
      const max = MAX_LENGTHS[key] ?? 200
      if (value.length > max) {
        return NextResponse.json({ error: `Trường ${key} tối đa ${max} ký tự` }, { status: 400 })
      }
      updates.push({ key, value })
    }
    if (body.invoice_logo !== undefined) {
      const value = String(body.invoice_logo).trim()
      if (value && !/^data:image\/(png|jpe?g|webp|gif);base64,/.test(value)) {
        return NextResponse.json({ error: 'Logo phải là ảnh data URL (png/jpg/webp/gif)' }, { status: 400 })
      }
      if (value.length > (MAX_LENGTHS.invoice_logo ?? 600_000)) {
        return NextResponse.json({ error: 'Logo quá lớn — dùng ảnh dưới 400KB' }, { status: 400 })
      }
      updates.push({ key: 'invoice_logo', value })
    }

    if (updates.length === 0 && maintenanceToggled === null) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    const prevCached = getApiCache<Record<string, string | boolean>>('settings:public')
    if (updates.length > 0) {
      await setSettingsBatch(updates, prevCached)
    }

    void logLedger({
      scope: 'SETTINGS',
      action: 'SETTINGS_UPDATED',
      actor: 'OPERATOR',
      title: `Cập nhật cấu hình hệ thống: ${updates.map((u) => u.key).join(', ')}`,
      detail: {
        keys: updates.map((u) => u.key),
        // không bao giờ log giá trị raw của API key
        gemini_api_key: updates.some((u) => u.key === 'gemini_api_key') ? '***đã thay đổi***' : undefined,
        invoice_logo: updates.some((u) => u.key === 'invoice_logo') ? (updates.find((u) => u.key === 'invoice_logo')?.value ? '***ảnh logo***' : '***đã xóa logo***') : undefined,
      },
    })

    invalidateApiCache('settings:')
    let fresh: Record<string, string | boolean>
    if (prevCached) {
      fresh = { ...prevCached }
      for (const u of updates) {
        if (u.key === 'gemini_api_key') {
          fresh.geminiConfigured = Boolean(u.value && u.value.trim().length > 0)
        } else {
          fresh[u.key] = u.value
        }
      }
      if (maintenanceToggled !== null) {
        fresh.maintenance_mode = maintenanceToggled
      }
    } else {
      fresh = await buildPublicSettings()
    }
    setApiCache('settings:public', fresh, 60_000)
    return NextResponse.json(fresh)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu cấu hình'
    console.error('Settings PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export const PUT = PATCH
export const POST = PATCH
