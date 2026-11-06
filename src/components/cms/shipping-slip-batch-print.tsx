'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, Printer } from 'lucide-react'

import { apiPost } from '@/lib/api'
import { formatDateTime, formatVND } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'

export interface SlipItem {
  productId: string
  name: string
  sku: string
  barcode?: string | null
  quantity: number
  price: number
  fragile?: boolean
}

export interface ShippingSlipData {
  orderId: string
  orderCode: string
  createdAt: string
  hasFragile: boolean
  sender: {
    name: string
    phone: string
    address: string
  }
  recipient: {
    name: string
    phone: string
    address: string
  }
  carrier: string
  trackingCode: string
  items: SlipItem[]
  subtotal: number
  shippingFee: number
  discountAmount: number
  total: number
  codAmount: number
  paymentMethod: string
  paymentStatus: string
  note?: string | null
}

const BATCH_PRINT_CSS = `
.batch-slips-a6-sheet {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 105mm;
}
@media print {
  @page {
    size: 105mm 148mm;
    margin: 0;
  }
  body * {
    visibility: hidden !important;
  }
  .batch-slips-a6-sheet,
  .batch-slips-a6-sheet * {
    visibility: visible !important;
  }
  body > *:not(.batch-slips-a6-sheet) {
    display: none !important;
  }
  .batch-slips-a6-sheet {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 105mm !important;
  }
  .a6-slip-page {
    width: 105mm !important;
    min-height: 148mm !important;
    max-height: 148mm !important;
    page-break-after: always !important;
    break-after: page !important;
    overflow: hidden !important;
    box-sizing: border-box !important;
  }
  .no-print {
    display: none !important;
  }
}
`

function SingleA6SlipContent({ slip }: { slip: ShippingSlipData }) {
  const isCod = slip.codAmount > 0

  return (
    <div
      className="a6-slip-page flex flex-col justify-between border-2 border-black bg-white p-2.5 text-black"
      style={{ width: '105mm', height: '148mm', boxSizing: 'border-box' }}
    >
      <div>
        {/* Header: Đơn vị gửi + Tiêu đề */}
        <div className="flex items-start justify-between border-b-2 border-black pb-1">
          <div className="min-w-0 pr-1">
            <p className="truncate text-[11px] font-extrabold uppercase leading-tight">
              {slip.sender.name || 'OPENVN · Kho Ưu Đàm'}
            </p>
            <p className="text-[8.5px] leading-tight text-neutral-800">
              ĐT: {slip.sender.phone} · {slip.sender.address}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-black tracking-wider text-black">PHIẾU GIAO HÀNG</p>
            <p className="font-mono text-[9px] font-bold">{slip.orderCode}</p>
          </div>
        </div>

        {/* Thông tin người nhận & ĐVVC */}
        <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded border border-black/80 p-1.5">
          <div>
            <p className="text-[7.5px] font-bold uppercase tracking-wider text-black/60">Người nhận</p>
            <p className="truncate text-[11px] font-bold leading-tight">{slip.recipient.name}</p>
            <p className="text-[9.5px] font-semibold text-black">{slip.recipient.phone}</p>
            <p className="line-clamp-2 text-[8.5px] leading-snug text-neutral-800" title={slip.recipient.address}>
              {slip.recipient.address}
            </p>
          </div>
          <div className="border-l border-black/40 pl-1.5">
            <p className="text-[7.5px] font-bold uppercase tracking-wider text-black/60">Vận chuyển</p>
            <p className="truncate text-[10px] font-bold leading-tight">{slip.carrier}</p>
            <p className="font-mono text-[9px] font-bold text-black">{slip.trackingCode}</p>
            <p className="text-[8px] text-black/70">
              {slip.note ? `Ghi chú: ${slip.note}` : 'Cho xem hàng, không cho thử'}
            </p>
          </div>
        </div>

        {/* Mã vạch vận đơn */}
        <div className="mt-1 flex flex-col items-center justify-center">
          <img
            src={`/api/barcode?text=${encodeURIComponent(slip.trackingCode)}&height=56&showText=1`}
            alt={`Mã vạch ${slip.trackingCode}`}
            className="h-10 max-w-[85mm] object-contain"
          />
        </div>

        {/* Cảnh báo hàng dễ vỡ (nếu có) */}
        {slip.hasFragile ? (
          <div className="mt-1 flex items-center justify-center gap-1 rounded border-2 border-red-700 bg-red-100 py-1 px-1.5 text-center text-red-900">
            <span className="text-[10px] font-black">⚠️ HÀNG DỄ VỠ</span>
            <span className="text-[8px] font-bold uppercase tracking-tight">
              (Gốm sứ/Nến/Thủy tinh - Nhẹ tay)
            </span>
          </div>
        ) : (
          <div className="mt-1 rounded border border-dashed border-neutral-300 py-0.5 text-center text-[7.5px] uppercase tracking-wide text-neutral-500">
            Kiện hàng tiêu chuẩn Ưu Đàm
          </div>
        )}

        {/* Bảng sản phẩm */}
        <div className="mt-1 overflow-hidden rounded border border-black/60 text-[8.5px]">
          <div className="grid grid-cols-12 bg-neutral-200 px-1 py-0.5 font-bold text-black">
            <span className="col-span-8">Sản phẩm</span>
            <span className="col-span-2 text-center">SL</span>
            <span className="col-span-2 text-right">Đơn giá</span>
          </div>
          <div className="divide-y divide-black/20">
            {slip.items.slice(0, 4).map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 px-1 py-0.5 leading-tight">
                <span className="col-span-8 truncate font-medium">
                  {it.name} {it.fragile && <span className="font-bold text-red-600">[Dễ vỡ]</span>}
                </span>
                <span className="col-span-2 text-center font-bold">{it.quantity}</span>
                <span className="col-span-2 text-right">{formatVND(it.price)}</span>
              </div>
            ))}
            {slip.items.length > 4 && (
              <div className="px-1 py-0.5 text-[8px] italic text-neutral-600">
                + còn {slip.items.length - 4} sản phẩm khác trong đơn...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer: COD / Chữ ký */}
      <div>
        {/* Thu tiền COD */}
        <div
          className={`mt-1 rounded border-2 p-1 text-center ${
            isCod ? 'border-black bg-neutral-100 text-black' : 'border-neutral-400 bg-neutral-50 text-neutral-700'
          }`}
        >
          {isCod ? (
            <p className="text-[11px] font-black uppercase tracking-wider">
              TIỀN THU NGƯỜI NHẬN (COD): {formatVND(slip.codAmount)}
            </p>
          ) : (
            <p className="text-[9.5px] font-bold uppercase tracking-wider text-neutral-600">
              ĐÃ THANH TOÁN TRƯỚC ({slip.paymentMethod}) — KHÔNG THU TIỀN
            </p>
          )}
        </div>

        {/* Khung chữ ký */}
        <div className="mt-1 grid grid-cols-2 text-center text-[7.5px] text-black">
          <div>
            <p className="font-bold uppercase">Chữ ký người nhận</p>
            <p className="mt-5 text-[6.5px] italic text-neutral-500">(Xác nhận nguyên vẹn)</p>
          </div>
          <div>
            <p className="font-bold uppercase">Người giao hàng</p>
            <p className="mt-5 text-[6.5px] italic text-neutral-500">(Ký & ghi rõ họ tên)</p>
          </div>
        </div>

        <div className="mt-1 flex items-center justify-between border-t border-black/30 pt-0.5 text-[6.5px] text-neutral-500">
          <span>In ngày {formatDateTime(slip.createdAt)}</span>
          <span>Hệ thống quản lý bán hàng OPENVN · Ưu Đàm Suite</span>
        </div>
      </div>
    </div>
  )
}

interface ShippingSlipBatchPrintProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderIds: string[]
}

export function ShippingSlipBatchPrint({
  open,
  onOpenChange,
  orderIds,
}: ShippingSlipBatchPrintProps) {
  const [slips, setSlips] = useState<ShippingSlipData[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (!open || orderIds.length === 0) {
      setSlips([])
      setError(null)
      setCurrentIndex(0)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    apiPost<{ success: boolean; slips: ShippingSlipData[] }>('/api/orders/batch-slips', { orderIds })
      .then((res) => {
        if (!isMounted) return
        setSlips(res.slips || [])
        setCurrentIndex(0)
      })
      .catch((err) => {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu phiếu in hàng loạt')
      })
      .finally(() => {
        if (isMounted) setLoading(false)
      })

    return () => {
      isMounted = false
    }
  }, [open, orderIds])

  const currentSlip = slips[currentIndex] ?? null

  const handlePrint = () => {
    window.print()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader className="no-print">
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Printer className="h-5 w-5 text-primary" />
              In phiếu giao hàng hàng loạt khổ A6 (105×148mm)
            </DialogTitle>
            <DialogDescription>
              Xem trước và in tem phiếu gửi hàng đồng loạt cho {orderIds.length} đơn hàng đã chọn.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-3 text-sm text-muted-foreground">Đang tổng hợp dữ liệu phiếu in...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {error}
            </div>
          ) : slips.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Không tìm thấy thông tin phiếu in cho các đơn hàng đã chọn.
            </div>
          ) : (
            <div className="no-print space-y-3">
              {/* Thanh điều hướng preview */}
              <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-xs">
                <span className="font-medium text-foreground">
                  Phiếu {currentIndex + 1} / {slips.length} ({currentSlip?.orderCode})
                </span>
                <div className="flex items-center gap-1.5">
                  {currentSlip?.hasFragile && (
                    <Badge variant="destructive" className="h-5 text-[10px]">
                      Hàng dễ vỡ
                    </Badge>
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentIndex <= 0}
                    onClick={() => setCurrentIndex((prev) => prev - 1)}
                    aria-label="Phiếu trước"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={currentIndex >= slips.length - 1}
                    onClick={() => setCurrentIndex((prev) => prev + 1)}
                    aria-label="Phiếu tiếp theo"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Khung xem trước A6 */}
              <div className="flex justify-center overflow-x-auto rounded-lg border bg-neutral-100 p-3 shadow-inner dark:bg-neutral-900">
                {currentSlip && (
                  <div className="shadow-lg">
                    <SingleA6SlipContent slip={currentSlip} />
                  </div>
                )}
              </div>
            </div>
          )}

          <DialogFooter className="no-print mt-2 flex sm:justify-between">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button
              className="bg-[#0066CC] font-semibold text-white hover:bg-[#0055B3]"
              disabled={loading || slips.length === 0}
              onClick={handlePrint}
            >
              <Printer className="mr-1.5 h-4 w-4" />
              In toàn bộ ({slips.length} phiếu A6)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bản in thật: Portal ra document.body khi dialog mở và có slips */}
      {open && slips.length > 0 && typeof document !== 'undefined' && (
        createPortal(
          <div className="batch-slips-a6-sheet" aria-hidden="true">
            <style>{BATCH_PRINT_CSS}</style>
            {slips.map((slip) => (
              <SingleA6SlipContent key={slip.orderId} slip={slip} />
            ))}
          </div>,
          document.body
        )
      )}
    </>
  )
}
