'use client'

// IN PHIẾU GỬI HÀNG khổ A6 (105×148mm) — tem vận đơn dán mặt ngoài kiện hàng:
// mã vạch mã vận đơn + người nhận + tiền thu hộ COD + cảnh báo hàng dễ vỡ (gốm/nến/thủy tinh).
// Cơ chế in giống label-print-dialog: sheet portal ra document.body, ẩn ngoài màn hình;
// khi in, @media print ẩn toàn trang và chỉ hiện đúng 1 trang khổ A6 (@page riêng).

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'

import { apiGet } from '@/lib/api'
import { CARRIERS } from '@/lib/agents'
import { formatDateTime, formatVND } from '@/lib/format'
import type { Shipment } from '@/lib/types'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const PRINT_CSS = `
.shipment-a6-sheet {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 105mm;
}
@media print {
  @page { size: 105mm 148mm; margin: 0; }
  body * { visibility: hidden !important; }
  .shipment-a6-sheet, .shipment-a6-sheet * { visibility: visible !important; }
  /* Chỉ giữ subtree sheet — ẩn hẳn app shell + dialog để không in trang thừa */
  body > *:not(.shipment-a6-sheet) { display: none !important; }
  .shipment-a6-sheet { position: absolute !important; left: 0 !important; top: 0 !important; }
  .no-print { display: none !important; }
}
`

// Tem phiếu gửi hàng — dùng chung cho preview (trong dialog) và bản in (portal ra body).
// Nền trắng chữ đen viền đen cố định: bản in không theo dark mode.
function ShipmentLabelContent({
  shipment,
  companyName,
  companyPhone,
  printedAt,
}: {
  shipment: Shipment
  companyName: string
  companyPhone: string
  printedAt: Date
}) {
  const order = shipment.order
  const items = (order?.items ?? []).flatMap((it) => (it ? [it] : []))
  const hasFragile = items.some((it) => it.product?.fragile)
  const visibleItems = items.slice(0, 5)
  const hiddenCount = items.length - visibleItems.length
  const carrier = CARRIERS.find((c) => c.key === shipment.carrier)
  const codDue = order?.paymentMethod === 'COD' && shipment.codAmount > 0

  return (
    <div
      className="flex flex-col overflow-hidden border-2 border-black bg-white p-3 text-black"
      style={{ width: '105mm', height: '148mm' }}
    >
      {/* Header: đơn vị gửi | tiêu đề */}
      <div className="flex items-start justify-between gap-2 border-b-2 border-black pb-1.5">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold uppercase leading-tight">{companyName || 'OmniSales'}</p>
          {companyPhone ? <p className="text-[9px] leading-tight">ĐT: {companyPhone}</p> : null}
        </div>
        <p className="shrink-0 text-sm font-extrabold tracking-wider">PHIẾU GỬI HÀNG</p>
      </div>

      {/* Mã đơn + kênh bán */}
      <div className="flex items-center justify-between gap-2 pt-1.5">
        <p className="font-mono text-[11px] font-bold">{order?.code ?? '—'}</p>
        {order?.channel ? <p className="text-[9px] text-black/60">Kênh: {order.channel.name}</p> : null}
      </div>

      {/* Người nhận */}
      <div className="mt-1.5 rounded border border-black/60 px-2 py-1.5">
        <p className="text-[8px] font-semibold uppercase tracking-widest text-black/50">Người nhận</p>
        <p className="text-[13px] font-bold leading-snug">{order?.customer?.name ?? '—'}</p>
        <p className="text-[10px]">ĐT: {order?.customer?.phone ?? '—'}</p>
        <p className="text-[10px] leading-snug">{order?.address ?? '—'}</p>
      </div>

      {/* Mã vạch vận đơn — ĐVVC quét tra cứu hành trình */}
      <div className="mt-2 flex flex-col items-center">
        <img
          src={`/api/barcode?text=${encodeURIComponent(shipment.trackingCode)}&height=72&showText=1`}
          alt={`Mã vạch vận đơn ${shipment.trackingCode}`}
          className="max-w-full"
        />
        <p className="font-mono text-[10px] font-bold tracking-widest">{shipment.trackingCode}</p>
        <p className="text-[9px] uppercase text-black/60">ĐVVC: {carrier?.name ?? shipment.carrier}</p>
      </div>

      {/* Tiền thu hộ COD */}
      {codDue ? (
        <div className="mt-2 rounded border-2 border-black bg-black/[0.04] px-2 py-1.5">
          <p className="text-[12px] font-extrabold uppercase tracking-wide">
            Tiền thu hộ (COD): {formatVND(shipment.codAmount)}
          </p>
        </div>
      ) : (
        <p className="mt-2 text-center text-[9px] text-black/45">Không thu hộ — đơn đã thanh toán</p>
      )}

      {/* Cảnh báo hàng dễ vỡ */}
      {hasFragile ? (
        <div className="mt-2 flex items-start gap-1.5 rounded border-2 border-red-700 bg-red-50 px-2 py-1.5 text-red-800">
          <span
            aria-hidden="true"
            className="mt-[1px] flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] bg-red-700 text-[9px] font-black leading-none text-white"
          >
            !
          </span>
          <p className="text-[9.5px] font-extrabold uppercase leading-snug tracking-wide">
            Hàng dễ vỠ — gốm sứ / nến / thủy tinh — xử lý nhẹ nhàng, không đổ xếp
          </p>
        </div>
      ) : (
        <p className="mt-2 text-center text-[8px] uppercase tracking-wide text-black/40">Hàng thông thường</p>
      )}

      {/* Danh sách sản phẩm (tối đa 5 dòng) */}
      <div className="mt-2 border-t border-black/40 pt-1.5">
        {visibleItems.map((it, idx) => (
          <p key={`${it.product.sku}-${idx}`} className="text-[9.5px] leading-snug">
            <span className="font-bold">{it.quantity} ×</span> {it.product.name}{' '}
            <span className="font-mono text-[7.5px] text-black/45">({it.product.sku})</span>
          </p>
        ))}
        {hiddenCount > 0 && <p className="text-[9px] font-medium italic text-black/60">+{hiddenCount} món nữa</p>}
      </div>

      <p className="mt-auto border-t border-black/30 pt-1 text-center text-[8px] text-black/50">
        In lúc {formatDateTime(printedAt)} · OmniSales
      </p>
    </div>
  )
}

interface ShipmentLabelDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shipment: Shipment | null
}

export function ShipmentLabelDialog({ open, onOpenChange, shipment }: ShipmentLabelDialogProps) {
  const [settings, setSettings] = useState({ companyName: '', companyPhone: '' })

  // Tải tên + điện thoại đơn vị mỗi lần mở dialog — giữ kết quả lần trước làm cache trong khi refetch
  useEffect(() => {
    if (!open) return
    let cancelled = false
    apiGet<Record<string, unknown>>('/api/settings')
      .then((res) => {
        if (cancelled) return
        setSettings({
          companyName: typeof res.company_name === 'string' ? res.company_name : '',
          companyPhone: typeof res.company_phone === 'string' ? res.company_phone : '',
        })
      })
      .catch(() => {
        // Không tải được cấu hình — dùng tên mặc định, vẫn in được
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // Mốc "In lúc ..." — cập nhật mỗi lần mở dialog hoặc đổi vận đơn
  const printedAt = useMemo(() => new Date(), [open, shipment])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="no-print">
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            In phiếu gửi hàng
          </DialogTitle>
          <DialogDescription>
            Tem vận đơn khổ A6 (105×148mm) dán mặt ngoài kiện: mã vạch tra cứu của ĐVVC, tiền thu hộ COD và cảnh báo hàng
            dễ vỡ.
          </DialogDescription>
        </DialogHeader>

        {shipment && (
          <div className="no-print overflow-x-auto rounded-lg border bg-muted/30 p-3">
            <div className="mx-auto w-fit shadow-sm">
              <ShipmentLabelContent
                shipment={shipment}
                companyName={settings.companyName}
                companyPhone={settings.companyPhone}
                printedAt={printedAt}
              />
            </div>
          </div>
        )}

        <DialogFooter className="no-print">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button onClick={() => window.print()} disabled={!shipment}>
            <Printer className="mr-1.5 h-4 w-4" />
            In phiếu gửi hàng
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Bản in thật — portal ra body, ẩn ngoài màn hình, CSS @media print định vị thành 1 trang A6 */}
      {open &&
        shipment &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="shipment-a6-sheet" aria-hidden="true">
            <style>{PRINT_CSS}</style>
            <ShipmentLabelContent
              shipment={shipment}
              companyName={settings.companyName}
              companyPhone={settings.companyPhone}
              printedAt={printedAt}
            />
          </div>,
          document.body
        )}
    </Dialog>
  )
}
