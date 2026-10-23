import { NextRequest, NextResponse } from 'next/server'
import { logLedger } from '@/lib/ledger'
import { getSetting, getSettings, setSetting } from '@/lib/settings'

export const dynamic = 'force-dynamic'

// Các setting công khai (không bao giờ trả raw API key)
const PUBLIC_KEYS = ['company_name', 'company_tax', 'company_address', 'vat_default'] as const

async function buildPublicSettings(): Promise<Record<string, string | boolean>> {
  const values = await getSettings([...PUBLIC_KEYS])
  const geminiKey = await getSetting('gemini_api_key')
  return {
    company_name: values.company_name ?? '',
    company_tax: values.company_tax ?? '',
    company_address: values.company_address ?? '',
    vat_default: values.vat_default ?? '8',
    geminiConfigured: Boolean(geminiKey && geminiKey.trim().length > 0),
  }
}

export async function GET() {
  try {
    return NextResponse.json(await buildPublicSettings())
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

    if (updates.length === 0) {
      return NextResponse.json({ error: 'Không có gì để cập nhật' }, { status: 400 })
    }

    for (const update of updates) {
      await setSetting(update.key, update.value)
    }

    await logLedger({
      scope: 'SETTINGS',
      action: 'SETTINGS_UPDATED',
      actor: 'OPERATOR',
      title: `Cập nhật cấu hình hệ thống: ${updates.map((u) => u.key).join(', ')}`,
      detail: {
        keys: updates.map((u) => u.key),
        // không bao giờ log giá trị raw của API key
        gemini_api_key: updates.some((u) => u.key === 'gemini_api_key') ? '***đã thay đổi***' : undefined,
      },
    })

    return NextResponse.json(await buildPublicSettings())
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu cấu hình'
    console.error('Settings PATCH error:', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
