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
  station: PosStationClientView | null
  recentShopeeOrders: RecentShopeeOrderSummary[]
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
  station,
  recentShopeeOrders,
  printerConfig,
  onUpdatePrinterConfig,
  onRotatePairToken,
  onRefreshStation,
  onTestPrintPosBill,
  onTestPrintShopeeSlip,
  onPrintShopeeOrderById,
}: PosPeripheralsDialogProps) {
  const [activeTab, setActiveTab] = useState<'phone' | 'printer' | 'shopee'>('phone')
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

  const refreshHardwareList = async () => {
    const info = await listPairedHardwareDevices()
    setHardwareSummary(info)
  }

  useEffect(() => {
    if (!open) return
    void refreshHardwareList()
  }, [open])

  const hostCandidates = useMemo(() => {
    const list: string[] = []
    if (station?.lanIps?.length) {
      for (const ip of station.lanIps) {
        if (!list.includes(ip)) list.push(ip)
      }
    }
    if (typeof window !== 'undefined') {
      const h = window.location.hostname
      if (h && !list.includes(h)) list.push(h)
    }
    if (list.length === 0) list.push('localhost')
    return list
  }, [station])

  const effectiveHost = selectedHost && hostCandidates.includes(selectedHost) ? selectedHost : hostCandidates[0]

  const mobileScannerUrl = useMemo(() => {
    if (typeof window === 'undefined' || !station) return ''
    const isGitHubPages = window.location.hostname.endsWith('.github.io')
    if (isGitHubPages) {
      return `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}/pos/scanner?s=${encodeURIComponent(station.stationId)}&t=${encodeURIComponent(station.pairToken)}`
    }
    const portPart = window.location.port ? `:${window.location.port}` : ''
    return `${window.location.protocol}//${effectiveHost}${portPart}/pos/scanner?s=${encodeURIComponent(station.stationId)}&t=${encodeURIComponent(station.pairToken)}`
  }, [effectiveHost, station])

  const qrSvgMarkup = useMemo(() => {
    if (!mobileScannerUrl) return ''
    return qrCodeSvg(mobileScannerUrl, { size: 204, margin: 3 })
  }, [mobileScannerUrl])

  const handleCopyUrl = async () => {
    if (!mobileScannerUrl) return
    try {
      await navigator.clipboard.writeText(mobileScannerUrl)
      toast({
        title: 'Đã sao chép liên kết Máy Quét Điện Thoại',
        description: mobileScannerUrl,
      })
    } catch {
      toast({
        title: 'Không thể tự sao chép',
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-0">
        <div className="border-b bg-slate-950 px-6 py-4 text-white">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DialogTitle className="flex items-center gap-2 text-lg font-bold text-white">
                <Printer className="h-5 w-5 text-emerald-400" />
                Trung Tâm Thiết Bị Ngoại Vi, Điện Thoại Quét Mã & Tự Động In POS / Shopee
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
                  Trạm: {station?.stationId || 'POS-UUDAM-01'}
                </Badge>
                <Badge className="border-sky-500/40 bg-sky-500/15 text-sky-300">
                  {station?.connectedPhones?.length || 0} ĐT đang kết nối
                </Badge>
              </div>
            </div>
            <DialogDescription className="text-xs text-slate-300">
              Liên kết điện thoại làm tay quét mã vạch & bấm tính tiền từ xa, kết nối súng mã vạch USB/Bluetooth, tự động in Bill K80 và tự động in vận đơn Shopee ngay tại quầy POS.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('phone')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'phone'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Smartphone className="h-4 w-4" />
              1. Điện Thoại Quét Mã & Tính Tiền ({station?.connectedPhones?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('printer')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'printer'
                  ? 'bg-emerald-500 text-slate-950 shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Printer className="h-4 w-4" />
              2. Súng Mã Vạch & Tự Động In Bill {printerConfig.autoPrintPosBill ? '(BẬT)' : '(TẮT)'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('shopee')}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                activeTab === 'shopee'
                  ? 'bg-orange-500 text-white shadow'
                  : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <ShoppingBag className="h-4 w-4" />
              3. Tự Động In Đơn Shopee {printerConfig.autoPrintShopeeOrder ? '(BẬT)' : '(TẮT)'}
            </button>
          </div>
        </div>

        <div className="p-6">
          {/* ================================================================= */}
          {/* TAB 1: ĐIỆN THOẠI QUÉT MÃ <-> MÁY POS ĐANG LIÊN KẾT              */}
          {/* ================================================================= */}
          {activeTab === 'phone' && (
            <div className="grid gap-5 md:grid-cols-[240px_1fr]">
              <div className="flex flex-col items-center rounded-xl border bg-slate-50 p-4 text-center dark:bg-slate-900/50">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  <QrCode className="h-4 w-4" />
                  Quét QR bằng Camera Điện Thoại
                </div>
                {qrSvgMarkup ? (
                  <div
                    className="overflow-hidden rounded-xl border bg-white p-2 shadow-sm"
                    dangerouslySetInnerHTML={{ __html: qrSvgMarkup }}
                  />
                ) : (
                  <div className="flex h-[204px] w-[204px] items-center justify-center rounded-xl border bg-white text-xs text-muted-foreground">
                    Đang khởi tạo mã QR...
                  </div>
                )}
                <div className="mt-3 w-full space-y-1.5 text-left text-xs">
                  <div className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 border dark:bg-slate-950">
                    <span className="text-muted-foreground">Mã trạm:</span>
                    <span className="font-mono font-bold">{station?.stationId || 'POS-UUDAM-01'}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-md bg-white px-2.5 py-1.5 border dark:bg-slate-950">
                    <span className="text-muted-foreground">Mã PIN ghép:</span>
                    <span className="font-mono text-sm font-extrabold tracking-widest text-emerald-600">
                      {station?.pairToken || '------'}
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2.5 w-full text-xs"
                  disabled={busyAction === 'rotate'}
                  onClick={async () => {
                    setBusyAction('rotate')
                    await onRotatePairToken()
                    setBusyAction(null)
                  }}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Đổi mã PIN ghép mới
                </Button>
              </div>

              <div className="space-y-4">
                <div className="rounded-xl border bg-emerald-50/60 p-3.5 dark:bg-emerald-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900 dark:text-emerald-300">
                      <Wifi className="h-4 w-4 text-emerald-600" />
                      Liên kết Wi-Fi LAN Thời Gian Thực (&lt; 10ms)
                    </div>
                    {hostCandidates.length > 1 && (
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">IP Mạng LAN:</span>
                        <select
                          aria-label="Chọn IP LAN"
                          className="rounded border bg-white px-2 py-1 font-mono text-xs dark:bg-slate-900"
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
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Điện thoại kết nối chung Wi-Fi với máy POS, mở link dưới đây để dùng Camera sau quét mã vạch sản phẩm bắn thẳng vào giỏ hàng POS và bấm <strong>Tính tiền + Tự động in Bill</strong> ngay trên điện thoại.
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <Input
                      readOnly
                      value={mobileScannerUrl}
                      className="h-8 flex-1 bg-white font-mono text-xs dark:bg-slate-950"
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyUrl()}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />
                      Sao chép
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="bg-emerald-600 text-white hover:bg-emerald-500"
                      onClick={() => {
                        if (mobileScannerUrl) window.open(mobileScannerUrl, '_blank', 'noopener,noreferrer')
                      }}
                    >
                      <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                      Mở Máy Quét ĐT
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border p-3.5">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Thiết Bị Điện Thoại Đang Liên Kết ({station?.connectedPhones?.length || 0})
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void onRefreshStation()}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" />
                      Làm mới
                    </Button>
                  </div>

                  {!station?.connectedPhones?.length ? (
                    <p className="rounded-lg border border-dashed py-4 text-center text-xs text-muted-foreground">
                      Chưa có điện thoại nào đang mở phiên quét. Quét mã QR bên trái hoặc bấm &ldquo;Mở Máy Quét ĐT&rdquo; để kết nối ngay.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {station.connectedPhones.map((ph) => (
                        <div
                          key={ph.phoneId}
                          className="flex items-center justify-between rounded-lg border bg-slate-50/70 px-3 py-2 text-xs dark:bg-slate-900"
                        >
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            <div>
                              <div className="font-semibold">{ph.deviceName}</div>
                              <div className="text-[11px] text-muted-foreground">
                                Mã gần nhất: {ph.lastScannedCode || 'Chưa quét'} · Hoạt động lúc{' '}
                                {new Date(ph.lastSeenAt).toLocaleTimeString('vi-VN')}
                              </div>
                            </div>
                          </div>
                          <Badge variant="secondary">{ph.scanCount} lần quét</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {Boolean(station?.recentScanEvents?.length) && (
                  <div className="rounded-xl border p-3.5">
                    <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Nhật Ký Mã Vạch Nhận Từ Điện Thoại Gần Nhất
                    </h4>
                    <div className="max-h-36 space-y-1.5 overflow-y-auto">
                      {station!.recentScanEvents.slice(0, 6).map((ev) => (
                        <div
                          key={ev.id}
                          className="flex items-center justify-between rounded border px-2.5 py-1.5 text-xs"
                        >
                          <div>
                            <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                              {ev.code}
                            </span>{' '}
                            <span className="text-muted-foreground">→</span>{' '}
                            <span>{ev.matchedName || 'Chưa khớp SKU trong kho'}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
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
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-start justify-between rounded-xl border bg-emerald-50/50 p-3.5 dark:bg-emerald-950/20">
                  <div className="space-y-1 pr-3">
                    <Label className="text-sm font-bold">
                      Tự động in Bill K80 ngay khi Tính Tiền
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Khi bấm Thanh toán (F9) trên máy POS hoặc bấm <strong>Tính tiền</strong> từ Điện thoại đang liên kết, máy POS lập tức đẩy lệnh in hóa đơn K80 tự động (kèm mở ngăn kéo tiền mặt RJ11).
                    </p>
                  </div>
                  <Switch
                    checked={printerConfig.autoPrintPosBill}
                    onCheckedChange={(checked) => onUpdatePrinterConfig({ autoPrintPosBill: checked })}
                  />
                </div>

                <div className="flex items-start justify-between rounded-xl border p-3.5">
                  <div className="space-y-1 pr-3">
                    <div className="flex items-center gap-1.5">
                      <ScanLine className="h-4 w-4 text-emerald-600" />
                      <span className="text-sm font-bold">Súng Mã Vạch USB / Bluetooth HID</span>
                      <Badge className="bg-emerald-600 text-[10px] text-white">Đang trực chiến</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Tự động bắt xung phím tốc độ cao (&lt; 50ms/ký tự + Enter) trên toàn màn hình POS ngay cả khi con trỏ chuột không đặt trong ô tìm kiếm.
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Volume2 className="h-3.5 w-3.5 text-slate-500" />
                      <span className="text-xs">Âm báo Bíp khi quét mã / thanh toán:</span>
                      <Switch
                        checked={printerConfig.soundEnabled}
                        onCheckedChange={(checked) => onUpdatePrinterConfig({ soundEnabled: checked })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold">Cổng Kết Nối Máy In Nhiệt Hóa Đơn POS</h4>
                    <p className="text-xs text-muted-foreground">
                      Hỗ trợ Xprinter, Zywell, HPRT, Epson, Sunmi qua Mạng LAN :9100, Cáp USB (WebUSB), Cổng COM/Bluetooth (WebSerial) hoặc Trình duyệt khổ K80.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium">Khổ giấy:</span>
                    {(['K80', 'K58'] as ThermalPaperSize[]).map((sz) => (
                      <Button
                        key={sz}
                        type="button"
                        size="sm"
                        variant={printerConfig.paperSize === sz ? 'default' : 'outline'}
                        className="h-7 px-2.5 text-xs"
                        onClick={() => onUpdatePrinterConfig({ paperSize: sz })}
                      >
                        {sz === 'K80' ? 'K80 (80mm)' : 'K58 (58mm)'}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2.5 sm:grid-cols-5">
                  {(
                    [
                      { id: 'auto', label: 'Tự động thông minh', sub: 'USB/COM -> Hộp thoại K80' },
                      { id: 'lan_tcp', label: 'Mạng LAN :9100', sub: 'In qua IP Wi-Fi/Ethernet' },
                      { id: 'webusb', label: 'Cáp USB (WebUSB)', sub: `${hardwareSummary.usbPrinters.length} thiết bị đã cấp` },
                      { id: 'webserial', label: 'COM / Bluetooth', sub: `${hardwareSummary.serialPortsCount} cổng Serial` },
                      { id: 'browser_print', label: 'Trình duyệt K80', sub: 'Chuẩn @page 80mm' },
                    ] as Array<{ id: ThermalTransportMode; label: string; sub: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => onUpdatePrinterConfig({ transport: opt.id })}
                      className={`rounded-lg border p-2.5 text-left transition ${
                        printerConfig.transport === opt.id
                          ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600 dark:bg-emerald-950/30'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{opt.sub}</div>
                    </button>
                  ))}
                </div>

                {printerConfig.transport === 'lan_tcp' && (
                  <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 sm:grid-cols-[1fr_140px] dark:bg-slate-900">
                    <div>
                      <Label className="text-xs">Địa chỉ IP nội bộ của Máy in nhiệt LAN (RFC-1918)</Label>
                      <div className="mt-1 flex items-center gap-2">
                        <Network className="h-4 w-4 text-slate-500" />
                        <Input
                          value={printerConfig.lanHost}
                          onChange={(e) => onUpdatePrinterConfig({ lanHost: e.target.value })}
                          placeholder="192.168.1.200"
                          className="h-8 font-mono text-xs"
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
                        className="mt-1 h-8 font-mono text-xs"
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
                    className="bg-slate-900 text-white hover:bg-slate-800 dark:bg-emerald-600"
                    disabled={busyAction === 'test-pos'}
                    onClick={async () => {
                      setBusyAction('test-pos')
                      await onTestPrintPosBill()
                      setBusyAction(null)
                    }}
                  >
                    <Printer className="mr-1.5 h-4 w-4" />
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
              <div className="flex items-start justify-between rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/50 dark:bg-orange-950/20">
                <div className="space-y-1 pr-4">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-orange-600" />
                    <Label className="text-sm font-bold text-orange-950 dark:text-orange-200">
                      Tự Động In Đơn Hàng Shopee Mới Trên Máy POS Đang Liên Kết
                    </Label>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Khi có đơn hàng Shopee mới đổ về hoặc chuyển sang trạng thái Xác nhận đóng gói (<code>INBOUND_SHOPEE_ORDER_SYNC</code>), máy POS đang mở sẽ tự động nhận sự kiện thời gian thực và phát lệnh in Tem vận đơn / Phiếu nhặt hàng một lần duy nhất (chống in trùng 100%).
                  </p>
                </div>
                <Switch
                  checked={printerConfig.autoPrintShopeeOrder}
                  onCheckedChange={(checked) => onUpdatePrinterConfig({ autoPrintShopeeOrder: checked })}
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
                        ? 'border-orange-500 bg-orange-50/50 ring-1 ring-orange-500 dark:bg-orange-950/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-900'
                    }`}
                  >
                    <div className="text-xs font-bold">{fmt.title}</div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{fmt.desc}</p>
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3.5">
                <div className="text-xs">
                  <span className="font-semibold">Kiểm tra mẫu in Shopee ngay:</span>{' '}
                  <span className="text-muted-foreground">
                    Xuất thử mẫu vận đơn Shop <code>thaimy1605</code> theo định dạng đang chọn (không tạo dữ liệu rác trong DB).
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="bg-orange-600 text-white hover:bg-orange-500"
                  disabled={busyAction === 'test-shopee'}
                  onClick={async () => {
                    setBusyAction('test-shopee')
                    await onTestPrintShopeeSlip()
                    setBusyAction(null)
                  }}
                >
                  <Printer className="mr-1.5 h-4 w-4" />
                  In Thử Đơn Shopee Mẫu
                </Button>
              </div>

              <div className="rounded-xl border p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Hàng Đợi Tự Động In Đơn Shopee ({station?.shopeePrintQueue?.length || 0}) & Đơn Sàn Gần Đây ({recentShopeeOrders.length})
                  </h4>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => void onRefreshStation()}
                  >
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Đồng bộ
                  </Button>
                </div>

                {!station?.shopeePrintQueue?.length && !recentShopeeOrders.length ? (
                  <p className="rounded-lg border border-dashed py-5 text-center text-xs text-muted-foreground">
                    Hiện chưa có đơn Shopee mới chờ in. Ngay khi Shop <code>thaimy1605</code> phát sinh đơn hàng mới, máy POS này sẽ tự động in nếu công tắc phía trên đang BẬT.
                  </p>
                ) : (
                  <div className="max-h-52 space-y-2 overflow-y-auto">
                    {(station?.shopeePrintQueue || []).map((job) => (
                      <div
                        key={job.id}
                        className="flex items-center justify-between rounded-lg border bg-orange-50/30 px-3 py-2 text-xs dark:bg-slate-900"
                      >
                        <div>
                          <div className="flex items-center gap-2 font-semibold">
                            <span className="font-mono">{job.orderCode}</span>
                            <Badge
                              variant={job.status === 'PRINTED' ? 'secondary' : 'default'}
                              className={job.status === 'PENDING' ? 'bg-orange-600 text-white' : ''}
                            >
                              {job.status === 'PRINTED' ? `Đã in (${job.printedMethod || 'AUTO'})` : 'Đang chờ tự động in'}
                            </Badge>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Shopee #{job.shopeeOrderSn} · {job.customerName} · {job.carrier} ({job.trackingCode}) ·{' '}
                            {job.total.toLocaleString('vi-VN')}đ
                          </div>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => void onPrintShopeeOrderById(job.orderId)}
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" />
                          In lại
                        </Button>
                      </div>
                    ))}

                    {recentShopeeOrders
                      .filter((o) => !(station?.shopeePrintQueue || []).some((j) => j.orderId === o.id))
                      .map((ord) => (
                        <div
                          key={ord.id}
                          className="flex items-center justify-between rounded-lg border px-3 py-2 text-xs"
                        >
                          <div>
                            <div className="font-mono font-semibold">{ord.code}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {ord.customerName} · {ord.carrier} ({ord.trackingCode}) · {ord.itemCount} SP ·{' '}
                              {ord.total.toLocaleString('vi-VN')}đ
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
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
