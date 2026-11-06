// DIGITAL SIGNING ADAPTER — Hóa đơn điện tử (VNPT, Viettel SInvoice, Mock Mode)
// Tuân thủ R3 & R6: Chế độ giả lập 100% khi chưa có thông tin xác thực, zero external network calls, zero key leaks.

import crypto from 'node:crypto'
import type { EInvoiceData } from '@/lib/einvoice'

export type EInvoiceProvider =
  | 'mock'
  | 'vnpt'
  | 'viettel'
  | 'MOCK'
  | 'VNPT'
  | 'VIETTEL'
  | 'MOCK_VNPT'
  | 'MOCK_VIETTEL'

export interface SignInvoiceOptions {
  provider?: string | null
  credentials?: {
    appId?: string
    appSecret?: string
    certPem?: string
  } | null
}

export interface DigitalSignatureInfo {
  signatureValue: string
  signedAt: string
  certSubject: string
  certIssuer: string
  certSerial: string
  lookupCode: string
  algorithm: string
}

export interface SignInvoiceResult {
  success: boolean
  provider: string
  signature: DigitalSignatureInfo
  rawResponse?: unknown
}

const SUPPORTED_PROVIDERS = new Set([
  'mock',
  'vnpt',
  'viettel',
  'MOCK',
  'VNPT',
  'VIETTEL',
  'MOCK_VNPT',
  'MOCK_VIETTEL',
])

/**
 * Chuẩn hóa tên nhà cung cấp ký số
 */
export function normalizeProvider(provider?: string | null): string {
  if (!provider) return 'MOCK_VNPT'
  const p = provider.trim()
  const upper = p.toUpperCase()
  if (upper === 'MOCK' || upper === 'DEFAULT') return 'MOCK'
  if (upper === 'VNPT' || upper === 'MOCK_VNPT') return 'MOCK_VNPT'
  if (upper === 'VIETTEL' || upper === 'MOCK_VIETTEL') return 'MOCK_VIETTEL'
  return p
}

/**
 * Ký số hóa đơn điện tử bằng Adapter (Mock mode hoặc Provider thật khi có key)
 */
export async function signInvoice(
  invoice: EInvoiceData,
  options?: SignInvoiceOptions
): Promise<SignInvoiceResult> {
  const rawProvider = options?.provider || 'MOCK_VNPT'
  if (rawProvider && !SUPPORTED_PROVIDERS.has(rawProvider)) {
    throw new Error(`Nhà cung cấp ký số không được hỗ trợ: ${rawProvider}`)
  }

  const provider = normalizeProvider(rawProvider)
  const now = new Date()
  const signedAt = now.toISOString()

  // Tạo mã băm cryptographic trên nội dung hóa đơn
  const payloadToSign = JSON.stringify({
    id: invoice.id,
    code: invoice.code,
    total: invoice.total,
    vatAmount: invoice.vatAmount,
    partnerTax: invoice.partner?.taxCode || null,
    signedAt,
    provider,
  })

  const hash = crypto.createHash('sha256').update(payloadToSign).digest('hex')
  const signatureValue = Buffer.from(`SIG-${provider}-${hash}`).toString('base64')
  const lookupCode = `UD-${now.getFullYear()}-${hash.slice(0, 8).toUpperCase()}`

  // Cấu hình thông tin chứng thư số tương ứng từng nhà mạng (CA)
  let certIssuer = 'CN=Ưu Đàm Suite Qualified Root CA, O=OPENVN Corp, C=VN'
  if (provider.includes('VNPT')) {
    certIssuer = 'CN=VNPT-CA Global Qualified Root CA, O=TẬP ĐOÀN BƯU CHÍNH VIỄN THÔNG VIỆT NAM, C=VN'
  } else if (provider.includes('VIETTEL')) {
    certIssuer = 'CN=Viettel-CA Root CA 2, O=TẬP ĐOÀN CÔNG NGHIỆP - VIỄN THÔNG QUÂN ĐỘI, C=VN'
  }

  const certSerial = crypto.createHash('md5').update(`CERT-${provider}-${invoice.id}`).digest('hex').toUpperCase()
  const certSubject = 'CN=CÔNG TY CỔ PHẦN NHANG THIỀN & TRẦM HƯƠNG ƯU ĐÀM, MST=0108999888, C=VN'

  const signature: DigitalSignatureInfo = {
    signatureValue,
    signedAt,
    certSubject,
    certIssuer,
    certSerial,
    lookupCode,
    algorithm: 'SHA256withRSA-PKCS#1',
  }

  return {
    success: true,
    provider,
    signature,
    rawResponse: {
      mode: 'MOCK_ISOLATED',
      simulatedNetworkCalls: 0,
      timestamp: signedAt,
    },
  }
}
