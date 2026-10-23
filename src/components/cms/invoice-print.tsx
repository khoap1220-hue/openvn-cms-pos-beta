'use client'

// IN HÓA ĐƠN GTGT — dialog xem trước bản in hóa đơn bán (khổ A4, đen trắng trên nền trắng).
// • Khi dialog mở → tự GET /api/settings lấy tiêu đề, mẫu số, ký hiệu, ngân hàng, logo, ghi chú cuối.
// • Nút "In hóa đơn" → window.print(): CSS @media print ẩn toàn trang, chỉ hiện .invoice-print-area.
// • Hóa đơn trạng thái CANCELLED in kèm watermark "HÓA ĐƠN ĐÃ HỦY".
// Lưu ý: GET /api/settings hiện có thể không trả invoice_bank_* (backend cũ) → mọi trường bank coi là tùy chọn.

import { useEffect, useState } from 'react'
import { apiGet } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { docSoTienBangChu } from '@/lib/vietnamese'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Printer } from 'lucide-react'

export interface InvoicePrintItem {
  quantity: number
  unitPrice: number
  amount: number
  product: { sku: string; name: string; unit: string }
}

export interface InvoicePrintData {
  id: string
  code: string
  invoiceDate: string
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  status: 'POSTED' | 'CANCELLED'
  note: string | null
  partner: { name: string; taxCode: string | null; address?: string | null; phone?: string | null } | null
  order?: { code: string } | null
  items: InvoicePrintItem[]
}

interface InvoiceSettings {
  companyName: string
  companyTax: string
  companyAddress: string
  title: string
  templateCode: string
  series: string
  bankName: string
  bankAccount: string
  bankHolder: string
  footerNote: string
  logo: string
}

const SETTINGS_FALLBACK: InvoiceSettings = {
  companyName: '',
  companyTax: '',
  companyAddress: '',
  title: 'HÓA ĐƠN BÁN HÀNG',
  templateCode: '01GTKT0/001',
  series: 'AA/26E',
  bankName: '',
  bankAccount: '',
  bankHolder: '',
  footerNote: '',
  logo: '',
}

/** Chuẩn hóa payload /api/settings (key string, thiếu key nào dùng giá trị mặc định) */
function normalizeSettings(raw: Record<string, unknown> | null): InvoiceSettings {
  const src = raw ?? {}
  const str = (key: string, fallback = '') =>
    typeof src[key] === 'string' ? (src[key] as string) : fallback
  return {
    companyName: str('company_name'),
    companyTax: str('company_tax'),
    companyAddress: str('company_address'),
    title: str('invoice_title', SETTINGS_FALLBACK.title) || SETTINGS_FALLBACK.title,
    templateCode: str('invoice_template_code', SETTINGS_FALLBACK.templateCode) || SETTINGS_FALLBACK.templateCode,
    series: str('invoice_series', SETTINGS_FALLBACK.series) || SETTINGS_FALLBACK.series,
    bankName: str('invoice_bank_name'),
    bankAccount: str('invoice_bank_account'),
    bankHolder: str('invoice_bank_holder'),
    footerNote: str('invoice_footer_note'),
    logo: str('invoice_logo'),
  }
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .invoice-print-area, .invoice-print-area * { visibility: visible !important; }
  .invoice-print-area {
    position: absolute !important;
    left: 0;
    top: 0;
    width: 100%;
    padding: 10mm;
    background: white;
    color: black;
  }
  .no-print { display: none !important; }
  /* Chỉ giữ subtree dialog in hóa đơn — ẩn hẳn app shell để không in trang trắng thừa */
  body > *:not([data-invoice-print-root]) { display: none !important; }
  [data-slot="dialog-content"] > :not(.invoice-print-shell):not(style) { display: none !important; }
  .invoice-print-shell {
    padding: 0 !important;
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: transparent !important;
    box-shadow: none !important;
    max-width: none !important;
  }
  /* Neo bản in về góc trên bên trái trang: vô hiệu hóa fixed + translate của Radix Dialog */
  [data-slot="dialog-overlay"],
  [data-slot="dialog-content"] {
    position: static !important;
    inset: auto !important;
    transform: none !important;
    translate: none !important;
    animation: none !important;
    width: auto !important;
    max-width: none !important;
    max-height: none !important;
    overflow: visible !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: transparent !important;
  }
  [data-slot="dialog-close"] { display: none !important; }
}
`

export function InvoicePrintDialog({
  open,
  onOpenChange,
  invoice,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoicePrintData | null
}) {
  const [settings, setSettings] = useState<InvoiceSettings | null>(null)

  // Tải cấu hình hóa đơn mỗi lần mở dialog — giữ kết quả lần trước làm cache trong khi refetch
  useEffect(() => {
    if (!open) return
    let cancelled = false
    apiGet<Record<string, unknown>>('/api/settings')
      .then((res) => {
        if (!cancelled) setSettings(normalizeSettings(res))
      })
      .catch(() => {
        // Không tải được cấu hình: lần đầu tiên → dùng giá trị mặc định; đã có cache → giữ nguyên
        if (!cancelled) setSettings((prev) => prev ?? normalizeSettings(null))
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const dateLine = (() => {
    if (!invoice) return ''
    const d = new Date(invoice.invoiceDate)
    if (Number.isNaN(d.getTime())) return ''
    return `Ngày ${d.getDate()} tháng ${d.getMonth() + 1} năm ${d.getFullYear()}`
  })()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-invoice-print-root="true"
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
      >
        <DialogHeader className="no-print">
          <DialogTitle>In hóa đơn bán</DialogTitle>
          <DialogDescription>
            Xem trước bản in hóa đơn GTGT khổ A4 — cấu hình mẫu in lấy từ &quot;Thiết lập hóa đơn&quot; ở module Hệ
            thống.
          </DialogDescription>
        </DialogHeader>

        {!invoice ? (
          <div className="no-print flex h-40 items-center justify-center text-sm text-muted-foreground">
            Không có dữ liệu hóa đơn để in.
          </div>
        ) : (
          <div className="invoice-print-shell rounded-xl border bg-muted/40 p-3 sm:p-4">
            <div className="invoice-print-area relative mx-auto w-full max-w-[820px] bg-white p-6 text-slate-900 shadow-sm sm:p-10">
              {/* Watermark hóa đơn đã hủy */}
              {invoice.status === 'CANCELLED' && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden">
                  <span className="rotate-12 text-5xl font-black tracking-widest text-rose-600 opacity-20 sm:text-6xl">
                    HÓA ĐƠN ĐÃ HỦY
                  </span>
                </div>
              )}

              {!settings ? (
                <div className="flex h-64 flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <p className="text-sm">Đang tải thiết lập hóa đơn...</p>
                </div>
              ) : (
                <>
                  {/* Header: logo | thông tin đơn vị | tiêu đề + mẫu số/ký hiệu/số */}
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-[220px] flex-1 items-start gap-3">
                      {settings.logo ? (
                        <img
                          src={settings.logo}
                          alt="Logo đơn vị"
                          className="h-14 w-auto max-w-[120px] object-contain"
                        />
                      ) : null}
                      <div className="text-sm leading-relaxed">
                        <p className="font-bold uppercase">{settings.companyName || '(Tên đơn vị)'}</p>
                        <p>Mã số thuế: {settings.companyTax || '………………………………'}</p>
                        <p>Địa chỉ: {settings.companyAddress || '………………………………'}</p>
                      </div>
                    </div>
                    <div className="min-w-[200px] text-center">
                      <p className="text-lg font-bold uppercase leading-tight sm:text-xl">{settings.title}</p>
                      <p className="mt-1 text-sm">Mẫu số: {settings.templateCode}</p>
                      <p className="text-sm">Ký hiệu: {settings.series}</p>
                      <p className="text-sm font-semibold">Số: {invoice.code}</p>
                    </div>
                  </div>

                  <p className="mt-4 text-center text-sm font-medium">{dateLine}</p>

                  {/* Bên bán / bên mua */}
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <p className="font-semibold">Đơn bán: {settings.companyName || '(Khách lẻ)'}</p>
                    </div>
                    <div className="leading-relaxed">
                      <p>
                        Họ tên người mua hàng: <span className="font-medium">{invoice.partner?.name ?? 'Khách lẻ'}</span>
                      </p>
                      <p>Mã số thuế: {invoice.partner?.taxCode ?? ''}</p>
                      <p>Địa chỉ: {invoice.partner?.address ?? ''}</p>
                      <p>Điện thoại: {invoice.partner?.phone ?? ''}</p>
                      <p>Hình thức thanh toán: Tiền mặt / Chuyển khoản</p>
                      {invoice.order ? <p>Theo đơn hàng: {invoice.order.code}</p> : null}
                    </div>
                  </div>

                  {/* Bảng hàng hóa */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead>
                        <tr>
                          <th className="border border-black px-2 py-1.5 text-center font-bold">STT</th>
                          <th className="border border-black px-2 py-1.5 text-left font-bold">Tên hàng hóa, dịch vụ</th>
                          <th className="border border-black px-2 py-1.5 text-center font-bold">ĐVT</th>
                          <th className="border border-black px-2 py-1.5 text-right font-bold">Số lượng</th>
                          <th className="border border-black px-2 py-1.5 text-right font-bold">Đơn giá</th>
                          <th className="border border-black px-2 py-1.5 text-right font-bold">Thành tiền</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.items.map((item, i) => (
                          <tr key={`${invoice.id}-${i}`}>
                            <td className="border border-black px-2 py-1 text-center">{i + 1}</td>
                            <td className="border border-black px-2 py-1">
                              <p className="font-medium">{item.product.name}</p>
                              <p className="text-xs text-slate-600">{item.product.unit}</p>
                            </td>
                            <td className="border border-black px-2 py-1 text-center">{item.product.unit}</td>
                            <td className="border border-black px-2 py-1 text-right tabular-nums">
                              {formatNumber(item.quantity)}
                            </td>
                            <td className="border border-black px-2 py-1 text-right tabular-nums">
                              {formatNumber(item.unitPrice)}
                            </td>
                            <td className="border border-black px-2 py-1 text-right tabular-nums">
                              {formatNumber(item.amount)}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td colSpan={5} className="border border-black px-2 py-1 text-right font-medium">
                            Cộng tiền hàng:
                          </td>
                          <td className="border border-black px-2 py-1 text-right tabular-nums">
                            {formatNumber(invoice.subtotal)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-black px-2 py-1 text-right font-medium">
                            Thuế GTGT ({invoice.vatRate}%):
                          </td>
                          <td className="border border-black px-2 py-1 text-right tabular-nums">
                            {formatNumber(invoice.vatAmount)}
                          </td>
                        </tr>
                        <tr>
                          <td colSpan={5} className="border border-black px-2 py-1 text-right font-bold">
                            Tổng cộng tiền thanh toán:
                          </td>
                          <td className="border border-black px-2 py-1 text-right font-bold tabular-nums">
                            {formatNumber(invoice.total)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <p className="mt-3 text-sm font-semibold italic">
                    Số tiền viết bằng chữ: {docSoTienBangChu(invoice.total)}
                  </p>

                  {settings.bankAccount ? (
                    <p className="mt-2 text-sm">
                      Ngân hàng: {settings.bankName || '—'} — Số TK: {settings.bankAccount}
                      {settings.bankHolder ? ` — Chủ TK: ${settings.bankHolder}` : ''}
                    </p>
                  ) : null}

                  {invoice.note ? <p className="mt-2 text-sm">Ghi chú: {invoice.note}</p> : null}
                  {settings.footerNote ? <p className="mt-1 text-sm">{settings.footerNote}</p> : null}

                  {/* Chữ ký */}
                  <div className="mt-8 grid grid-cols-2 gap-6 text-center text-sm">
                    <div>
                      <p className="font-bold uppercase">Người bán</p>
                      <p className="text-xs italic">(Ký, ghi rõ họ tên)</p>
                      <div className="h-20" />
                    </div>
                    <div>
                      <p className="font-bold uppercase">Người mua</p>
                      <p className="text-xs italic">(Ký, ghi rõ họ tên)</p>
                      <div className="h-20" />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        <style>{PRINT_CSS}</style>

        <DialogFooter className="no-print">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button onClick={() => window.print()} disabled={!settings || !invoice}>
            {settings ? <Printer className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
            In hóa đơn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
