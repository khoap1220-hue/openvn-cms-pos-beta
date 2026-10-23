'use client'

// IN NHÃN MÃ VẠCH — dialog chọn sản phẩm + cấu hình nhãn, xem trước trực tiếp rồi in bằng window.print()
// Cơ chế in: sheet nhãn (.barcode-print-sheet) được portal ra document.body, ẩn ngoài màn hình;
// khi in, CSS @media print ẩn toàn trang (visibility) và chỉ hiện sheet, định vị lại góc trên trái trang.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Barcode, Printer } from 'lucide-react'

import { formatVND } from '@/lib/format'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export interface BarcodeProduct {
  id: string
  sku: string
  name: string
  barcode: string | null
  sellPrice: number
}

type LabelSizeKey = 'SMALL' | 'MEDIUM' | 'LARGE'

const LABEL_SIZES: Record<LabelSizeKey, { name: string; widthMm: number; barcodeHeight: number }> = {
  SMALL: { name: 'Nhãn nhỏ 38×25mm', widthMm: 38, barcodeHeight: 36 },
  MEDIUM: { name: 'Nhãn vừa 50×30mm', widthMm: 50, barcodeHeight: 48 },
  LARGE: { name: 'Nhãn lớn 70×40mm', widthMm: 70, barcodeHeight: 64 },
}

const SIZE_KEYS = Object.keys(LABEL_SIZES) as LabelSizeKey[]

const PRINT_CSS = `
.barcode-print-sheet {
  position: fixed;
  left: -10000px;
  top: 0;
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  gap: 2mm;
}
@media print {
  body * { visibility: hidden !important; }
  .barcode-print-sheet, .barcode-print-sheet * { visibility: visible !important; }
  .barcode-print-sheet { position: absolute !important; left: 0; top: 0; width: 100%; display: flex; flex-wrap: wrap; }
  .no-print { display: none !important; }
}
`

interface LabelData {
  product: BarcodeProduct
  code: string
  /** true nếu sản phẩm chưa có mã vạch — mã vạch được sinh tạm từ SKU */
  fromSku: boolean
}

function BarcodeLabel({
  label,
  sizeKey,
  showName,
  showPrice,
  fromSkuNote,
}: {
  label: LabelData
  sizeKey: LabelSizeKey
  showName: boolean
  showPrice: boolean
  /** ghi chú nhỏ khi mã vạch được sinh từ SKU (bản preview mô tả đầy đủ hơn) */
  fromSkuNote: string
}) {
  const size = LABEL_SIZES[sizeKey]
  return (
    <div
      className="flex flex-col items-center gap-0.5 border border-slate-400 bg-white p-1 text-black"
      style={{ width: `${size.widthMm}mm`, breakInside: 'avoid' }}
    >
      {showName && (
        <p className="w-full truncate text-center text-[9px] font-medium leading-tight" title={label.product.name}>
          {label.product.name}
        </p>
      )}
      <img
        src={`/api/barcode?text=${encodeURIComponent(label.code)}&height=${size.barcodeHeight}&showText=1`}
        alt={`Mã vạch ${label.code}`}
        className="max-w-full"
      />
      <p className="w-full truncate text-center font-mono text-[9px] leading-tight">
        {label.product.sku}
        {showPrice ? ` · ${formatVND(label.product.sellPrice)}` : ''}
      </p>
      {label.fromSku && (
        <p className="w-full truncate text-center text-[7px] uppercase leading-tight text-black/50">{fromSkuNote}</p>
      )}
    </div>
  )
}

interface LabelPrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: BarcodeProduct[]
}

export function LabelPrintDialog({ open, onOpenChange, products }: LabelPrintDialogProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [countInput, setCountInput] = useState('1')
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>('MEDIUM')
  const [showName, setShowName] = useState(true)
  const [showPrice, setShowPrice] = useState(true)

  // Mỗi lần mở dialog (hoặc đổi danh sách sản phẩm khi đang mở): chọn lại tất cả sản phẩm được truyền vào.
  // Dùng pattern "adjust state during render" thay vì effect (tránh cascading render).
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevProducts, setPrevProducts] = useState(products)
  if (open !== prevOpen || products !== prevProducts) {
    setPrevOpen(open)
    setPrevProducts(products)
    if (open) setSelectedIds(new Set(products.map((p) => p.id)))
  }

  const labelCount = Math.max(0, Math.floor(Number(countInput)) || 0)

  const selectedProducts = useMemo(() => products.filter((p) => selectedIds.has(p.id)), [products, selectedIds])

  const labels = useMemo<LabelData[]>(() => {
    const out: LabelData[] = []
    for (const p of selectedProducts) {
      const fromSku = !p.barcode
      const code = p.barcode || p.sku
      for (let i = 0; i < labelCount; i++) out.push({ product: p, code, fromSku })
    }
    return out
  }, [selectedProducts, labelCount])

  const allSelected = products.length > 0 && selectedIds.size === products.length

  const toggleProduct = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <style>{PRINT_CSS}</style>
        <DialogHeader className="no-print">
          <DialogTitle className="flex items-center gap-2">
            <Barcode className="h-5 w-5" />
            In nhãn mã vạch
          </DialogTitle>
          <DialogDescription>
            Chọn sản phẩm, cấu hình nhãn rồi in — xem trước bên phải. Nhãn chưa có mã vạch sẽ sinh tạm theo SKU.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,270px)_minmax(0,1fr)]">
          {/* Cột cấu hình */}
          <div className="no-print space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Sản phẩm in nhãn</Label>
                <span className="text-xs text-muted-foreground">
                  {selectedIds.size}/{products.length}
                </span>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border bg-muted/40 px-2 py-1.5 text-sm font-medium">
                <Checkbox
                  checked={allSelected}
                  disabled={products.length === 0}
                  onCheckedChange={(checked) =>
                    setSelectedIds(checked ? new Set(products.map((p) => p.id)) : new Set())
                  }
                  aria-label="Chọn tất cả sản phẩm"
                />
                Chọn tất cả
              </label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                {products.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Không có sản phẩm nào.</p>
                ) : (
                  products.map((p) => (
                    <label
                      key={p.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-muted/60"
                    >
                      <Checkbox
                        checked={selectedIds.has(p.id)}
                        onCheckedChange={(checked) => toggleProduct(p.id, checked === true)}
                        aria-label={`Chọn ${p.name}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {p.sku}
                          {p.barcode ? ` · ${p.barcode}` : ' · chưa có mã vạch'}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{formatVND(p.sellPrice)}</span>
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="label-count">Số nhãn mỗi sản phẩm</Label>
              <Input
                id="label-count"
                type="number"
                min={1}
                step={1}
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="label-size">Kích thước nhãn</Label>
              <Select value={sizeKey} onValueChange={(v) => setSizeKey(v as LabelSizeKey)}>
                <SelectTrigger id="label-size" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIZE_KEYS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {LABEL_SIZES[k].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch id="label-show-name" checked={showName} onCheckedChange={setShowName} />
              <div>
                <Label htmlFor="label-show-name">Hiện tên sản phẩm</Label>
                <p className="text-xs text-muted-foreground">Tên rút gọn phía trên mã vạch</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <Switch id="label-show-price" checked={showPrice} onCheckedChange={setShowPrice} />
              <div>
                <Label htmlFor="label-show-price">Hiện giá bán</Label>
                <p className="text-xs text-muted-foreground">Kèm giá bán dưới dòng SKU</p>
              </div>
            </div>
          </div>

          {/* Cột xem trước */}
          <div className="no-print rounded-lg border bg-muted/30 p-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Xem trước — {selectedProducts.length} sản phẩm · {labels.length} nhãn
            </p>
            {labels.length === 0 ? (
              <div className="flex h-56 items-center justify-center rounded-md border border-dashed bg-white">
                <p className="px-4 text-center text-sm text-muted-foreground">
                  Chọn ít nhất 1 sản phẩm và số nhãn ≥ 1 để xem trước
                </p>
              </div>
            ) : (
              <div className="flex max-h-[400px] flex-wrap gap-2 overflow-y-auto rounded-md bg-white p-2">
                {labels.map((l, i) => (
                  <BarcodeLabel
                    key={`preview-${l.product.id}-${i}`}
                    label={l}
                    sizeKey={sizeKey}
                    showName={showName}
                    showPrice={showPrice}
                    fromSkuNote="Chưa có mã vạch — dùng SKU"
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="no-print">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Đóng
          </Button>
          <Button onClick={() => window.print()} disabled={labels.length === 0}>
            <Printer className="mr-1.5 h-4 w-4" />
            In nhãn
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Sheet nhãn thật dùng khi in — portal ra body, ẩn ngoài màn hình, CSS print sẽ định vị lại */}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="barcode-print-sheet" aria-hidden="true">
            {labels.map((l, i) => (
              <BarcodeLabel
                key={`print-${l.product.id}-${i}`}
                label={l}
                sizeKey={sizeKey}
                showName={showName}
                showPrice={showPrice}
                fromSkuNote="SKU"
              />
            ))}
          </div>,
          document.body
        )}
    </Dialog>
  )
}
