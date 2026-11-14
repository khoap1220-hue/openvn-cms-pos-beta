'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bluetooth,
  CheckCircle2,
  Copy,
  ExternalLink,
  Network,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  ShoppingBag,
  Smartphone,
  Usb,
  Volume2,
  Wifi,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { useToast } from '@/hooks/use-toast'
import { qrCodeSvg } from '@/lib/qr-svg'
import {
  listPairedHardwareDevices,
  type PairedHardwareSummary,
  type PeripheralPrinterConfig,
  requestWebSerialPrinter,
  requestWebUsbPrinter,
  type ShopeePrintFormat,
  type ThermalPaperSize,
  type ThermalTransportMode,
  type WindowsPrinterClientItem,
} from '@/lib/escpos'

export interface PosStationClientView {
  stationId: string
  stationName: string
  pairToken: string
  warehouseName: string
  autoPrintPosBill: boolean
  autoPrintShopeeOrder: boolean
  printerTransport: string
  paperSize: string
  shopeeFormat: string
  connectedPhones: Array<{
    phoneId: string
    deviceName: string
    connectedAt: string
    lastSeenAt: string
    scanCount: number
    lastScannedCode: string | null
  }>
  recentScanEvents: Array<{
    id: string
    deviceName: string
    code: string
    matchedSku: string | null
    matchedName: string | null
    quantity: number
    createdAt: string
  }>
  shopeePrintQueue: Array<{
    id: string
    orderId: string
    orderCode: string
    shopeeOrderSn: string
    customerName: string
    total: number
    trackingCode: string
    carrier: string
    itemCount: number
    status: 'PENDING' | 'PRINTED' | 'SKIPPED'
    printedMethod?: string
    createdAt: string
    printedAt?: string
  }>
  lanIps: string[]
}

export interface RecentShopeeOrderSummary {
  id: string
  code: string
  status: string
  total: number
  customerName: string
  trackingCode: string
  carrier: string
  itemCount: number
  createdAt: string
}

export interface PosPeripheralsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: 'phone' | 'printer' | 'shopee'
  station: PosStationClientView | null
  recentShopeeOrders: RecentShopeeOrderSummary[]
  windowsPrinters?: WindowsPrinterClientItem[]
  onRefreshWindowsPrinters?: () => Promise<void>
  printerConfig: PeripheralPrinterConfig
  onUpdatePrinterConfig: (patch: Partial<PeripheralPrinterConfig>) => void
  onRotatePairToken: () => Promise<void>
  onRefreshStation: () => Promise<void>
  onTestPrintPosBill: () => Promise<void>
  onTestPrintShopeeSlip: () => Promise<void>
  onPrintShopeeOrderById: (orderId: string) => Promise<void>
}

export function PosPeripheralsDialog({
  open,
  onOpenChange,
  initialTab,
  station,
  recentShopeeOrders,
  windowsPrinters = [],
  onRefreshWindowsPrinters,
  printerConfig,
  onUpdatePrinterConfig,
  onRotatePairToken,
  onRefreshStation,
  onTestPrintPosBill,
  onTestPrintShopeeSlip,
  onPrintShopeeOrderById,
}: PosPeripheralsDialogProps) {
  const [activeTab, setActiveTab] = useState<'phone' | 'printer' | 'shopee'>(initialTab || 'phone')
  const [selectedHost, setSelectedHost] = useState<string>('')
  const [hardwareSummary, setHardwareSummary] = useState<PairedHardwareSummary>({
    usbPrinters: [],
    serialPortsCount: 0,
    camerasCount: 0,
    webUsbSupported: false,
    webSerialSupported: false,
  })
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const { toast } = useToast()

  const defaultPhysicalPrinter = useMemo(() => {
    return (
      windowsPrinters.find((p) => p.isPhysical && p.isDefault) ??
      windowsPrinters.find((p) => p.isPhysical) ??
      null
    )
  }, [windowsPrinters])

  const activeSilentWindowsPrinterName = useMemo(() => {
    if (printerConfig.windowsPrinterName) return printerConfig.windowsPrinterName
    return defaultPhysicalPrinter?.name || ''
  }, [defaultPhysicalPrinter, printerConfig.windowsPrinterName])

  const refreshHardwareList = async () => {
    const info = await listPairedHardwareDevices()
    setHardwareSummary(info)
  }

  useEffect(() => {
    if (!open) return
    if (initialTab) setActiveTab(initialTab)
    void refreshHardwareList()
  }, [open, initialTab])

  const hostCandidates = useMemo(() => {
    const list: string[] = []
    if (typeof window !== 'undefined') {
      const currentHost = window.location.hostname
      // Trên Cloud / GitHub Pages ưu tiên domain HTTPS hiện tại lên đầu để quét QR không lỗi 404
      if (currentHost && currentHost.endsWith('.github.io')) {
        list.push(currentHost)
      }
    }
    if (station?.lanIps?.length) {
      for (const ip of station.lanIps) {
        if (ip && !list.includes(ip)) list.push(ip)
      }
    }
    if (typeof window !== 'undefined') {
      const h = window.location.hostname
      if (h && !list.includes(h)) list.push(h)
    }
    if (list.length === 0) list.push('localhost')
    return list
  }, [station])

  const effectiveHost =
    selectedHost && hostCandidates.includes(selectedHost) ? selectedHost : hostCandidates[0]

  const mobileScannerUrl = useMemo(() => {
    if (typeof window === 'undefined' || !station) return ''
    const qs = `s=${encodeURIComponent(station.stationId)}&t=${encodeURIComponent(station.pairToken)}`
    if (effectiveHost.endsWith('.github.io')) {
      const cleanBasePath = window.location.pathname
        .replace(/\/pos(\/.*)?$/, '')
        .replace(/\/$/, '')
      return `${window.location.origin}${cleanBasePath}/pos/scanner?${qs}`
    }
    const portPart = window.location.port
      ? `:${window.location.port}`
      : window.location.hostname.endsWith('.github.io')
        ? ':3010'
        : ''
    const proto = effectiveHost.endsWith('.github.io') ? 'https:' : 'http:'
    return `${proto}//${effectiveHost}${portPart}/pos/scanner?${qs}`
  }, [effectiveHost, station])

  const qrSvgMarkup = useMemo(() => {
    if (!mobileScannerUrl) return ''
    return qrCodeSvg(mobileScannerUrl, { size: 188, margin: 3 })
  }, [mobileScannerUrl])

  const handleCopyUrl = async () => {
    if (!mobileScannerUrl) return
    try {
      await navigator.clipboard.writeText(mobileScannerUrl)
      toast({
        title: 'Đã sao chép liên kết Tay Quét Điện Thoại',
        description: mobileScannerUrl,
      })
    } catch {
      toast({
        title: 'Liên kết Tay Quét Điện Thoại',
        description: mobileScannerUrl,
      })
    }
  }

  const handlePairUsb = async () => {
    setBusyAction('usb')
    const res = await requestWebUsbPrinter()
    await refreshHardwareList()
    setBusyAction(null)
    if (res.ok) {
      onUpdatePrinterConfig({ transport: 'webusb' })
      toast({ title: 'Đã ghép máy in USB thành công', description: res.name })
    } else {
      toast({ title: 'Chưa ghép máy in USB', description: res.error, variant: 'destructive' })
    }
  }

  const handlePairSerial = async () => {
    setBusyAction('serial')
    const res = await requestWebSerialPrinter()
    await refreshHardwareList()
    setBusyAction(null)
    if (res.ok) {
      onUpdatePrinterConfig({ transport: 'webserial' })
      toast({ title: 'Đã ghép cổng COM / Bluetooth SPP', description: res.name })
    } else {
      toast({ title: 'Chưa ghép cổng Serial', description: res.error, variant: 'destructive' })
    }
  }

  const connectedCount = station?.connectedPhones?.length || 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl gap-0 overflow-y-auto p-0 sm:p-0">
        {/* Header sáng đồng bộ hệ thống OPENVN — chừa khoảng phải pr-28 cho nút Mở rộng & Đóng (X) */}
        <div className="border-b bg-muted/30 px-5 pt-5 pb-4 sm:px-6">
          <DialogHeader className="space-y-1.5 pr-28 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground sm:text-lg">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0066CC]/10 text-[#0066CC]">
                  <Printer className="h-4 w-4" />
                </span>
                <span>Thiết Bị Ngoại Vi, Điện Thoại Quét Mã &amp; Tự Động In</span>
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs leading-relaxed text-muted-foreground">
              Liên kết điện thoại làm tay quét mã vạch &amp; bấm tính tiền từ xa, kết nối súng mã vạch USB/Bluetooth, tự động in Bill K80 và tự động in vận đơn Shopee ngay tại quầy POS.
            </DialogDescription>
          </DialogHeader>

          {/* Hàng huy hiệu trạng thái trực quan */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="border-[#0066CC]/30 bg-[#0066CC]/8 font-mono text-xs font-semibold text-[#0066CC] dark:text-sky-300"
            >
              Trạm: {station?.stationId || 'POS-UUDAM-01'}
            </Badge>
            <Badge
              variant="outline"
              className={
                connectedCount > 0
                  ? 'border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-border bg-background text-xs text-muted-foreground'
              }
            >
              <Smartphone className="mr-1 h-3 w-3" />
              {connectedCount} điện thoại đang kết nối
            </Badge>
            <Badge
              variant="outline"
              className={
                printerConfig.autoPrintPosBill
                  ? 'border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-border bg-background text-xs text-muted-foreground'
              }
            >
              In Bill POS: {printerConfig.autoPrintPosBill ? `BẬT (${printerConfig.paperSize})` : 'TẮT'}
            </Badge>
            <Badge
              variant="outline"
              className={
                printerConfig.autoPrintShopeeOrder
                  ? 'border-orange-300 bg-orange-50 text-xs font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300'
                  : 'border-border bg-background text-xs text-muted-foreground'
              }
            >
              Auto-Print Shopee: {printerConfig.autoPrintShopeeOrder ? 'BẬT' : 'TẮT'}
            </Badge>
            {activeSilentWindowsPrinterName && printerConfig.transport !== 'browser_print' && (
              <Badge
                variant="outline"
                className="border-emerald-400/60 bg-emerald-50 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <Printer className="mr-1 h-3 w-3" />
                In ngầm 0 hộp thoại: {activeSilentWindowsPrinterName}
              </Badge>
            )}
          </div>

          {/* Thanh chuyển 3 phân mục chuẩn Segmented Control */}
          <div
            role="tablist"
            aria-label="Phân mục cấu hình thiết bị POS"
            className="mt-3.5 grid grid-cols-1 gap-1.5 rounded-xl border bg-muted/60 p-1 sm:grid-cols-3"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'phone'}
              onClick={() => setActiveTab('phone')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === 'phone'
                  ? 'bg-card text-[#0066CC] shadow-xs ring-1 ring-border dark:text-sky-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span>Điện thoại Quét mã ({connectedCount})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'printer'}
              onClick={() => setActiveTab('printer')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === 'printer'
                  ? 'bg-card text-[#0066CC] shadow-xs ring-1 ring-border dark:text-sky-300'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Printer className="h-3.5 w-3.5 shrink-0" />
              <span>Súng Mã vạch &amp; In Bill ({printerConfig.autoPrintPosBill ? 'BẬT' : 'TẮT'})</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'shopee'}
              onClick={() => setActiveTab('shopee')}
              className={`flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-all ${
                activeTab === 'shopee'
                  ? 'bg-card text-orange-600 shadow-xs ring-1 ring-orange-200 dark:text-orange-300 dark:ring-orange-900'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <ShoppingBag className="h-3.5 w-3.5 shrink-0" />
              <span>Tự động in Đơn Shopee ({printerConfig.autoPrintShopeeOrder ? 'BẬT' : 'TẮT'})</span>
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6">
          {/* ================================================================= */}
          {/* TAB 1: ĐIỆN THOẠI QUÉT MÃ <-> MÁY POS ĐANG LIÊN KẾT              */}
          {/* ================================================================= */}
          {activeTab === 'phone' && (
            <div className="grid gap-5 md:grid-cols-[232px_1fr]">
              <div className="flex flex-col items-center rounded-xl border bg-muted/25 p-4 text-center">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[#0066CC] dark:text-sky-300">
                  <QrCode className="h-4 w-4 shrink-0" />
                  <span>Quét QR bằng Điện thoại</span>
                </div>
                {qrSvgMarkup ? (
                  <div
                    className="overflow-hidden rounded-xl border bg-white p-2 shadow-2xs"
                    dangerouslySetInnerHTML={{ __html: qrSvgMarkup }}
                  />
                ) : (
                  <div className="flex h-[188px] w-[188px] items-center justify-center rounded-xl border bg-white text-xs text-muted-foreground">
                    Đang tạo mã QR...
                  </div>
                )}
                <div className="mt-3 w-full space-y-1.5 text-left text-xs">
                  <div className="flex items-center justify-between rounded-lg border bg-card px-2.5 py-1.5">
                    <span className="text-muted-foreground">Mã trạm:</span>
                    <span className="font-mono font-bold text-foreground">
                      {station?.stationId || 'POS-UUDAM-01'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-card px-2.5 py-1.5">
                    <span className="text-muted-foreground">Mã PIN ghép:</span>
                    <span className="font-mono text-sm font-extrabold tracking-widest text-emerald-600 dark:text-emerald-400">
                      {station?.pairToken || '------'}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2.5 h-8 w-full text-xs"
                  disabled={busyAction === 'rotate'}
                  onClick={async () => {
                    setBusyAction('rotate')
                    await onRotatePairToken()
                    setBusyAction(null)
                  }}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Đổi mã PIN mới
                </Button>
              </div>

              <div className="min-w-0 space-y-4">
                <div className="rounded-xl border border-sky-200/80 bg-sky-50/50 p-4 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-foreground">
                      <Wifi className="h-4 w-4 text-[#0066CC]" />
                      <span>Liên kết Tay Quét Điện Thoại Thời Gian Thực (&lt; 10ms)</span>
                    </div>
                    {hostCandidates.length > 1 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Địa chỉ kết nối:</span>
                        <select
                          aria-label="Chọn địa chỉ kết nối"
                          className="h-7 rounded-md border bg-card px-2 font-mono text-xs text-foreground"
                          value={effectiveHost}
                          onChange={(e) => setSelectedHost(e.target.value)}
                        >
                          {hostCandidates.map((ip) => (
                            <option key={ip} value={ip}>
                              {ip}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    Mở liên kết dưới đây trên điện thoại để dùng <strong>Camera sau</strong> hoặc{' '}
                    <strong>Chụp ảnh mã vạch</strong> bắn thẳng sản phẩm vào giỏ hàng POS và bấm{' '}
                    <strong>Tính tiền &amp; In Bill</strong> ngay từ điện thoại.
                  </p>

                  {/* Hiển thị trọn vẹn URL không bị cắt cụt đuôi PIN */}
                  <div className="mt-2.5 rounded-lg border bg-card px-3 py-2 font-mono text-xs break-all text-foreground select-all">
                    {mobileScannerUrl || 'Đang khởi tạo đường dẫn ghép nối...'}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-card text-xs"
                      onClick={() => void handleCopyUrl()}
                    >
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Sao chép liên kết
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-[#0066CC] text-xs font-semibold text-white hover:bg-[#0055B3]"
                      onClick={() => {
                        if (mobileScannerUrl) {
                          window.open(mobileScannerUrl, '_blank', 'noopener,noreferrer')
                        }
                      }}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Mở Tay Quét ĐT
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border bg-card p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Điện Thoại Đang Liên Kết ({connectedCount})
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => void onRefreshStation()}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Làm mới
                    </Button>
                  </div>

                  {!connectedCount ? (
                    <p className="rounded-lg border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
                      Chưa có điện thoại nào đang mở phiên quét. Quét mã QR bên trái hoặc bấm{' '}
                      <strong>&ldquo;Mở Tay Quét ĐT&rdquo;</strong> để kiểm tra ngay.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {station!.connectedPhones.map((ph) => (
                        <div
                          key={ph.phoneId}
                          className="flex items-center justify-between gap-2 rounded-lg border bg-muted/25 px-3 py-2 text-xs"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-foreground">{ph.deviceName}</div>
                              <div className="truncate text-[11px] text-muted-foreground">
                                Mã gần nhất:{' '}
                                <span className="font-mono font-medium text-foreground">
                                  {ph.lastScannedCode || 'Chưa quét'}
                                </span>{' '}
                                · {new Date(ph.lastSeenAt).toLocaleTimeString('vi-VN')}
                              </div>
                            </div>
                          </div>
                          <Badge variant="secondary" className="shrink-0 font-mono">
                            {ph.scanCount} lần quét
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {Boolean(station?.recentScanEvents?.length) && (
                  <div className="rounded-xl border bg-card p-3.5">
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Nhật Ký Mã Vạch Nhận Từ Điện Thoại Gần Nhất
                    </h4>
                    <div className="max-h-36 space-y-1.5 overflow-y-auto">
                      {station!.recentScanEvents.slice(0, 6).map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between gap-2 rounded-lg border bg-muted/15 px-2.5 py-1.5 text-xs"
                        >
                          <div className="min-w-0 flex-1 truncate">
                            <span className="font-mono font-bold text-[#0066CC] dark:text-sky-300">
                              {ev.code}
                            </span>{' '}
                            <span className="text-muted-foreground">→</span>{' '}
                            <span>{ev.matchedName || 'Chưa khớp SKU trong kho'}</span>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                            x{ev.quantity} · {new Date(ev.createdAt).toLocaleTimeString('vi-VN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: SÚNG QUÉT MÃ VẠCH & MÁY IN HÓA ĐƠN NHIỆT K80               */}
          {/* ================================================================= */}
          {activeTab === 'printer' && (
            <div className="space-y-4">
              <div className="grid gap-3.5 md:grid-cols-2">
                <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                  <div className="space-y-1">
                    <Label className="text-sm font-bold text-foreground">
                      Tự động in Bill K80 ngay khi Tính Tiền
                    </Label>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Khi bấm Thanh toán (F9) tại quầy hoặc bấm <strong>Tính tiền</strong> từ Điện thoại liên kết, máy POS tự đẩy lệnh in hóa đơn (kèm xung mở két tiền RJ11).
                    </p>
                  </div>
                  <Switch
                    aria-label="Tự động in Bill K80 ngay khi tính tiền"
                    checked={printerConfig.autoPrintPosBill}
                    onCheckedChange={(checked) => onUpdatePrinterConfig({ autoPrintPosBill: checked })}
                  />
                </div>

                <div className="flex flex-col justify-between rounded-xl border bg-card p-4">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ScanLine className="h-4 w-4 text-[#0066CC]" />
                      <span className="text-sm font-bold text-foreground">
                        Súng Mã Vạch USB / Bluetooth HID
                      </span>
                      <Badge className="bg-emerald-600 px-1.5 py-0 text-[10px] text-white">
                        Đang trực chiến
                      </Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Tự động bắt xung phím tốc độ cao (&lt; 85ms/ký tự + Enter) trên toàn màn hình POS mà không cần đặt chuột vào ô tìm kiếm.
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Âm báo Bíp khi quét mã &amp; thanh toán</span>
                    </div>
                    <Switch
                      aria-label="Âm báo Bíp khi quét mã và thanh toán"
                      checked={printerConfig.soundEnabled}
                      onCheckedChange={(checked) => onUpdatePrinterConfig({ soundEnabled: checked })}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      Cổng Kết Nối Máy In Nhiệt Hóa Đơn POS
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      Tương thích Xprinter, Zywell, HPRT, Epson, Sunmi qua Mạng LAN :9100, Cáp USB (WebUSB), COM/Bluetooth (WebSerial) hoặc Trình duyệt khổ K80.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Khổ giấy:</span>
                    {(['K80', 'K58'] as ThermalPaperSize[]).map((sz) => (
                      <Button
                        key={sz}
                        type="button"
                        size="sm"
                        variant={printerConfig.paperSize === sz ? 'default' : 'outline'}
                        className={
                          printerConfig.paperSize === sz
                            ? 'h-7 bg-[#0066CC] px-2.5 text-xs text-white hover:bg-[#0055B3]'
                            : 'h-7 px-2.5 text-xs'
                        }
                        onClick={() => onUpdatePrinterConfig({ paperSize: sz })}
                      >
                        {sz === 'K80' ? 'K80 (80mm)' : 'K58 (58mm)'}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      {
                        id: 'auto',
                        label: 'Tự động thông minh (Khuyên dùng)',
                        sub: activeSilentWindowsPrinterName
                          ? `In ngầm Windows: ${activeSilentWindowsPrinterName}`
                          : 'USB/COM → Windows Spooler → Khung in',
                      },
                      {
                        id: 'windows_spooler',
                        label: 'Máy in Windows (In ngầm 100%)',
                        sub: `${windowsPrinters.length} máy in cài trên Windows · 0 hộp thoại`,
                      },
                      { id: 'lan_tcp', label: 'Mạng LAN :9100', sub: 'In thẳng IP Wi-Fi/Ethernet' },
                      {
                        id: 'webusb',
                        label: 'Cáp USB (WebUSB)',
                        sub: `${hardwareSummary.usbPrinters.length} thiết bị đã cấp quyền`,
                      },
                      {
                        id: 'webserial',
                        label: 'COM / Bluetooth',
                        sub: `${hardwareSummary.serialPortsCount} cổng Serial`,
                      },
                      {
                        id: 'browser_print',
                        label: 'Hộp thoại Trình duyệt',
                        sub: 'Xem trước thủ công @page K80/A6',
                      },
                    ] as Array<{ id: ThermalTransportMode; label: string; sub: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onUpdatePrinterConfig({ transport: opt.id })}
                      className={`rounded-xl border p-2.5 text-left transition ${
                        printerConfig.transport === opt.id
                          ? 'border-[#0066CC] bg-[#0066CC]/8 ring-1 ring-[#0066CC]'
                          : 'bg-background hover:bg-muted/50'
                      }`}
                    >
                      <div className="text-xs font-bold text-foreground">{opt.label}</div>
                      <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={opt.sub}>
                        {opt.sub}
                      </div>
                    </button>
                  ))}
                </div>

                {(printerConfig.transport === 'auto' ||
                  printerConfig.transport === 'windows_spooler') && (
                  <div className="space-y-2.5 rounded-xl border border-emerald-300/80 bg-emerald-50/40 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Label className="text-xs font-bold text-foreground">
                          Máy in Windows nhận lệnh In Tự Động Ngầm (Không hiện hộp thoại trình duyệt)
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Hỗ trợ mọi máy in USB / Wi-Fi / Networking đã cài trên Windows (Epson, Xprinter, Zywell, HPRT, Canon...).
                        </p>
                      </div>
                      {onRefreshWindowsPrinters && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 bg-card px-2.5 text-xs"
                          disabled={busyAction === 'refresh-win-printers'}
                          onClick={async () => {
                            setBusyAction('refresh-win-printers')
                            await onRefreshWindowsPrinters()
                            setBusyAction(null)
                          }}
                        >
                          <RefreshCw className="mr-1 h-3 w-3" />
                          Quét lại máy in
                        </Button>
                      )}
                    </div>

                    {windowsPrinters.length > 0 ? (
                      <div className="grid gap-2.5 sm:grid-cols-[1fr_auto]">
                        <select
                          aria-label="Chọn máy in Windows in tự động ngầm"
                          className="h-9 w-full rounded-lg border bg-card px-3 text-xs font-semibold text-foreground"
                          value={printerConfig.windowsPrinterName}
                          onChange={(e) =>
                            onUpdatePrinterConfig({ windowsPrinterName: e.target.value })
                          }
                        >
                          <option value="">
                            Tự động dùng máy in vật lý mặc định (
                            {defaultPhysicalPrinter?.name || windowsPrinters[0]?.name})
                          </option>
                          {windowsPrinters.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.name}
                              {p.isDefault ? ' — [Mặc định Windows]' : ''}
                              {p.isPhysical ? ' · Máy in thật' : ' · In ra tệp ảo / PDF'}
                            </option>
                          ))}
                        </select>
                        <Badge
                          variant="outline"
                          className="h-9 justify-center border-emerald-300 bg-card px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                          Sẵn sàng in ngầm
                        </Badge>
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
                        Chưa phát hiện dịch vụ Windows Spooler (đang mở trên môi trường Cloud tĩnh hoặc chưa cài driver máy in Windows). Hệ thống sẽ tự động chuyển sang khung in cô lập chuẩn khổ giấy.
                      </p>
                    )}

                    <label className="flex cursor-pointer items-center gap-2 pt-0.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border accent-[#0066CC]"
                        checked={printerConfig.rawEscPosOnWindows}
                        onChange={(e) =>
                          onUpdatePrinterConfig({ rawEscPosOnWindows: e.target.checked })
                        }
                      />
                      <span>
                        Chế độ RAW ESC/POS + mở ngăn kéo tiền RJ11 (chỉ bật khi dùng máy in hóa đơn nhiệt cuộn K80/K58 chuyên dụng; tắt khi dùng Epson L805 / Canon / HP / A6)
                      </span>
                    </label>
                  </div>
                )}

                {printerConfig.transport === 'lan_tcp' && (
                  <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[1fr_140px]">
                    <div>
                      <Label className="text-xs">Địa chỉ IP nội bộ của Máy in nhiệt LAN (RFC-1918)</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <Network className="h-4 w-4 text-muted-foreground" />
                        <Input
                          value={printerConfig.lanHost}
                          onChange={(e) => onUpdatePrinterConfig({ lanHost: e.target.value })}
                          placeholder="192.168.1.200"
                          className="h-8 bg-card font-mono text-xs"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Cổng RAW TCP</Label>
                      <Input
                        type="number"
                        value={printerConfig.lanPort}
                        onChange={(e) =>
                          onUpdatePrinterConfig({ lanPort: Number(e.target.value) || 9100 })
                        }
                        className="mt-1 h-8 bg-card font-mono text-xs"
                      />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={!hardwareSummary.webUsbSupported || busyAction === 'usb'}
                      onClick={() => void handlePairUsb()}
                    >
                      <Usb className="mr-1.5 h-3.5 w-3.5" />
                      Ghép Máy In USB ({hardwareSummary.usbPrinters.length})
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={!hardwareSummary.webSerialSupported || busyAction === 'serial'}
                      onClick={() => void handlePairSerial()}
                    >
                      <Bluetooth className="mr-1.5 h-3.5 w-3.5" />
                      Ghép Cổng COM / Bluetooth ({hardwareSummary.serialPortsCount})
                    </Button>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    className="h-8 bg-[#0066CC] text-xs font-semibold text-white hover:bg-[#0055B3]"
                    disabled={busyAction === 'test-pos'}
                    onClick={async () => {
                      setBusyAction('test-pos')
                      await onTestPrintPosBill()
                      setBusyAction(null)
                    }}
                  >
                    <Printer className="mr-1.5 h-3.5 w-3.5" />
                    In Thử Hóa Đơn POS ({printerConfig.paperSize})
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: TỰ ĐỘNG IN ĐƠN SHOPEE TẠI MÁY POS ĐANG LIÊN KẾT            */}
          {/* ================================================================= */}
          {activeTab === 'shopee' && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50/50 p-4 dark:border-orange-900/50 dark:bg-orange-950/20">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 shrink-0 text-orange-600" />
                    <Label className="text-sm font-bold text-foreground">
                      Tự Động In Đơn Hàng Shopee Mới Trên Máy POS Đang Liên Kết
                    </Label>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Khi có đơn hàng Shopee mới đổ về hoặc chuyển sang trạng thái Xác nhận đóng gói (
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                      INBOUND_SHOPEE_ORDER_SYNC
                    </code>
                    ), máy POS đang mở sẽ tự động nhận sự kiện thời gian thực và phát lệnh in Tem vận đơn / Phiếu nhặt hàng một lần duy nhất (chống in trùng 100%).
                  </p>
                </div>
                <Switch
                  aria-label="Tự động in đơn hàng Shopee mới trên máy POS"
                  checked={printerConfig.autoPrintShopeeOrder}
                  onCheckedChange={(checked) =>
                    onUpdatePrinterConfig({ autoPrintShopeeOrder: checked })
                  }
                  className="data-[state=checked]:bg-orange-600"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    {
                      id: 'A6_LABEL',
                      title: 'Tem Vận Đơn Chuẩn Sàn A6 (105 × 148mm)',
                      desc: 'In tem dán thùng chuẩn Shopee Express / GHN / GHTK gồm Mã vạch CODE128, Người nhận, COD và khung cảnh báo Hàng Dễ Vỡ.',
                    },
                    {
                      id: 'THERMAL_K80',
                      title: 'Phiếu Nhặt Hàng & Giao Hàng Nhiệt ESC/POS K80',
                      desc: 'Đẩy thẳng byte ESC/POS ra máy in hóa đơn nhiệt 80mm tại quầy POS (LAN :9100 / USB / COM) kèm cắt giấy tự động.',
                    },
                  ] as Array<{ id: ShopeePrintFormat; title: string; desc: string }>
                ).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    onClick={() => onUpdatePrinterConfig({ shopeeFormat: fmt.id })}
                    className={`rounded-xl border p-3.5 text-left transition ${
                      printerConfig.shopeeFormat === fmt.id
                        ? 'border-orange-500 bg-orange-50/40 ring-1 ring-orange-500 dark:bg-orange-950/20'
                        : 'bg-card hover:bg-muted/40'
                    }`}
                  >
                    <div className="text-xs font-bold text-foreground">{fmt.title}</div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {fmt.desc}
                    </p>
                  </button>
                ))}
              </div>

              <div className="space-y-3 rounded-xl border bg-card p-3.5">
                {windowsPrinters.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                    <div className="text-xs">
                      <span className="font-bold text-foreground">
                        Máy in nhận lệnh tự động in đơn Shopee:
                      </span>{' '}
                      <span className="text-muted-foreground">(In ngầm Windows — không hiện hộp thoại)</span>
                    </div>
                    <select
                      aria-label="Chọn máy in Windows cho đơn Shopee"
                      className="h-8 max-w-full rounded-lg border bg-background px-2.5 text-xs font-semibold text-foreground sm:min-w-[260px]"
                      value={printerConfig.windowsPrinterName}
                      onChange={(e) => {
                        const val = e.target.value
                        onUpdatePrinterConfig({
                          windowsPrinterName: val,
                          ...(printerConfig.transport === 'browser_print'
                            ? { transport: 'auto' }
                            : {}),
                        })
                      }}
                    >
                      <option value="">
                        Tự động ({defaultPhysicalPrinter?.name || windowsPrinters[0]?.name})
                      </option>
                      {windowsPrinters.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                          {p.isDefault ? ' [Mặc định]' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs">
                    <span className="font-semibold text-foreground">Kiểm tra mẫu in Shopee ngay:</span>{' '}
                    <span className="text-muted-foreground">
                      Xuất thử ngầm mẫu vận đơn Shop <code>thaimy1605</code> theo định dạng đang chọn (không tạo dữ liệu rác trong DB).
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 bg-orange-600 text-xs font-semibold text-white hover:bg-orange-500"
                    disabled={busyAction === 'test-shopee'}
                    onClick={async () => {
                      setBusyAction('test-shopee')
                      await onTestPrintShopeeSlip()
                      setBusyAction(null)
                    }}
                  >
                    <Printer className="mr-1.5 h-3.5 w-3.5" />
                    In Thử Đơn Shopee Mẫu
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-card p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Hàng Đợi Tự Động In Đơn Shopee ({station?.shopeePrintQueue?.length || 0}) &amp; Đơn Sàn Gần Đây ({recentShopeeOrders.length})
                  </h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void onRefreshStation()}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Đồng bộ
                  </Button>
                </div>

                {!station?.shopeePrintQueue?.length && !recentShopeeOrders.length ? (
                  <p className="rounded-lg border border-dashed bg-muted/20 py-5 text-center text-xs text-muted-foreground">
                    Hiện chưa có đơn Shopee mới chờ in. Ngay khi Shop <code>thaimy1605</code> phát sinh đơn hàng mới, máy POS này sẽ tự động in nếu công tắc phía trên đang BẬT.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {(station?.shopeePrintQueue || []).map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between gap-2 rounded-lg border bg-orange-50/30 px-3 py-2 text-xs dark:bg-slate-900"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-semibold">
                            <span className="font-mono">{job.orderCode}</span>
                            <Badge
                              variant={job.status === 'PRINTED' ? 'secondary' : 'default'}
                              className={job.status === 'PENDING' ? 'bg-orange-600 text-white' : ''}
                            >
                              {job.status === 'PRINTED'
                                ? `Đã in (${job.printedMethod || 'AUTO'})`
                                : 'Đang chờ tự động in'}
                            </Badge>
                          </div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            Shopee #{job.shopeeOrderSn} · {job.customerName} · {job.carrier} (
                            {job.trackingCode}) · {job.total.toLocaleString('vi-VN')}đ
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 shrink-0 text-xs"
                          onClick={() => void onPrintShopeeOrderById(job.orderId)}
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          In lại
                        </Button>
                      </div>
                    ))}

                    {recentShopeeOrders
                      .filter(
                        (o) => !(station?.shopeePrintQueue || []).some((j) => j.orderId === o.id)
                      )
                      .map((ord) => (
                        <div
                          key={ord.id}
                          className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-semibold">{ord.code}</div>
                            <div className="truncate text-[11px] text-muted-foreground">
                              {ord.customerName} · {ord.carrier} ({ord.trackingCode}) ·{' '}
                              {ord.itemCount} SP · {ord.total.toLocaleString('vi-VN')}đ
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            onClick={() => void onPrintShopeeOrderById(ord.id)}
                          >
                            <Printer className="mr-1 h-3.5 w-3.5" />
                            In đơn
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
