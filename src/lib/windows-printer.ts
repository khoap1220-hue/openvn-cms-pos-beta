import { execFile } from 'child_process'
import crypto from 'crypto'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { promisify } from 'util'
import { getCode128BarRuns } from '@/lib/barcode'
import type {
  ReceiptOrder,
  ShopeePrintFormat,
  ShopeeThermalSlipInput,
  ThermalPaperSize,
} from '@/lib/escpos'

const execFileAsync = promisify(execFile)

export interface WindowsPrinterInfo {
  name: string
  isDefault: boolean
  isPhysical: boolean
  kind: 'thermal_or_label' | 'office_printer' | 'virtual'
}

export interface WindowsSilentPrintRequest {
  printerName?: string
  jobType: 'POS_RECEIPT' | 'SHOPEE_SLIP' | 'SHOPEE_BATCH_SLIPS'
  paperSize?: ThermalPaperSize
  shopeeFormat?: ShopeePrintFormat
  rawEscPos?: boolean
  payloadBase64?: string
  receipt?: ReceiptOrder | Record<string, unknown>
  slip?: ShopeeThermalSlipInput
  slips?: ShopeeThermalSlipInput[]
  /** Kiểm thử render GDI+ ra bộ nhớ đệm (không tốn giấy/mực thật) */
  dryRun?: boolean
  /** Kiểm thử đẩy qua Windows Spooler thật bằng Microsoft Print to PDF ra file tạm (không tốn giấy/mực thật) */
  testPdfSpool?: boolean
}

export interface WindowsSilentPrintResult {
  ok: boolean
  printerName: string
  mode: 'WINDOWS_GDI_SILENT' | 'WINDOWS_RAW_ESCPOS' | 'WINDOWS_DRY_RUN' | 'WINDOWS_PDF_SPOOL_TEST'
  pagesPrinted: number
  bytesGenerated?: number
  durationMs: number
  error?: string
}

interface PrinterCacheState {
  expiresAt: number
  refreshing: boolean
  printers: WindowsPrinterInfo[]
}

const gPrinterCache = globalThis as unknown as {
  __openvnWinPrinterCache?: PrinterCacheState
}

const VIRTUAL_PRINTER_PATTERNS = [
  /microsoft print to pdf/i,
  /microsoft xps/i,
  /onenote/i,
  /^fax$/i,
  /shared fax/i,
  /pdfelement/i,
  /foxit/i,
  /adobe pdf/i,
  /cutepdf/i,
  /bullzip/i,
  /dopdf/i,
  /pdfcreator/i,
]

const THERMAL_PRINTER_PATTERNS = [
  /xprinter/i,
  /\bxp[-_\s]?\d+/i,
  /zywell/i,
  /hprt/i,
  /gprinter/i,
  /bixolon/i,
  /rongta/i,
  /pos[-_\s]?\d*/i,
  /80mm|58mm|k80|k58/i,
  /tm[-_\s]?t\d+/i,
  /zebra/i,
  /godex/i,
  /tsc\b/i,
]

function classifyPrinter(name: string): {
  isPhysical: boolean
  kind: 'thermal_or_label' | 'office_printer' | 'virtual'
} {
  const trimmed = name.trim()
  if (VIRTUAL_PRINTER_PATTERNS.some((re) => re.test(trimmed))) {
    return { isPhysical: false, kind: 'virtual' }
  }
  if (THERMAL_PRINTER_PATTERNS.some((re) => re.test(trimmed))) {
    return { isPhysical: true, kind: 'thermal_or_label' }
  }
  return { isPhysical: true, kind: 'office_printer' }
}

/**
 * Liệt kê danh sách máy in đã cài trong Windows Spooler (USB, Wi-Fi/Networking, LAN, PDF).
 * Ưu tiên sắp xếp máy in vật lý & máy in mặc định lên đầu danh sách.
 */
export async function listWindowsPrinters(forceRefresh = false): Promise<WindowsPrinterInfo[]> {
  if (process.platform !== 'win32') {
    return []
  }

  const now = Date.now()
  const cached = gPrinterCache.__openvnWinPrinterCache
  if (!forceRefresh && cached) {
    if (cached.expiresAt > now) {
      return cached.printers
    }
    if (!cached.refreshing) {
      cached.refreshing = true
      void listWindowsPrinters(true).finally(() => {
        if (gPrinterCache.__openvnWinPrinterCache) {
          gPrinterCache.__openvnWinPrinterCache.refreshing = false
        }
      })
    }
    return cached.printers
  }

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$defaultDoc = New-Object System.Drawing.Printing.PrintDocument
$defaultName = [string]$defaultDoc.PrinterSettings.PrinterName
$names = @([System.Drawing.Printing.PrinterSettings]::InstalledPrinters | ForEach-Object { [string]$_ })
@{ DefaultPrinter = $defaultName; Installed = $names } | ConvertTo-Json -Compress
`.trim()

  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psScript],
      { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 }
    )
    const parsed = JSON.parse(stdout.trim() || '{}') as {
      DefaultPrinter?: string
      Installed?: string[]
    }
    const defaultName = String(parsed.DefaultPrinter || '').trim()
    const installed = Array.isArray(parsed.Installed) ? parsed.Installed : []

    const list: WindowsPrinterInfo[] = installed
      .map((raw) => String(raw || '').trim())
      .filter((name) => name.length > 0 && !/^fax$/i.test(name) && !/onenote/i.test(name))
      .map((name) => {
        const cls = classifyPrinter(name)
        return {
          name,
          isDefault: name.toLowerCase() === defaultName.toLowerCase(),
          isPhysical: cls.isPhysical,
          kind: cls.kind,
        }
      })

    list.sort((a, b) => {
      if (a.isPhysical !== b.isPhysical) return a.isPhysical ? -1 : 1
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      if (a.kind !== b.kind) return a.kind === 'thermal_or_label' ? -1 : 1
      return a.name.localeCompare(b.name, 'vi')
    })

    gPrinterCache.__openvnWinPrinterCache = {
      expiresAt: Date.now() + 30_000,
      refreshing: false,
      printers: list,
    }
    return list
  } catch {
    return gPrinterCache.__openvnWinPrinterCache?.printers ?? []
  }
}

function formatVndText(n: unknown): string {
  const val = Math.round(Number(n) || 0)
  return `${val.toLocaleString('vi-VN')}đ`
}

interface NormalizedRenderPage {
  layout: 'RECEIPT' | 'A6_LABEL'
  widthUnits: number // 1/100 inch (283 = 72mm K80, 192 = 49mm K58, 394 = 100mm A6)
  heightUnits: number
  headerTitle: string
  headerSub: string
  docTitle: string
  barcodeText: string
  barcodeBars: Array<{ x: number; w: number }>
  barcodeTotalModules: number
  metaLines: Array<{ left: string; right: string; bold?: boolean }>
  recipientBlock?: {
    name: string
    phone: string
    address: string
  }
  fragileBanner?: string | null
  itemsHeaderLeft: string
  itemsHeaderRight: string
  items: Array<{
    title: string
    subLeft: string
    subRight: string
  }>
  totals: Array<{
    left: string
    right: string
    bold?: boolean
    large?: boolean
  }>
  footerLines: string[]
}

function buildReceiptRenderPage(
  rawOrder: ReceiptOrder | Record<string, any>,
  paperSize: ThermalPaperSize
): NormalizedRenderPage {
  const widthUnits = paperSize === 'K58' ? 192 : 284
  const orderCode = String(rawOrder.code || 'POS-ORDER')
  const bc = getCode128BarRuns(orderCode)

  const createdStr = rawOrder.createdAt
    ? new Date(rawOrder.createdAt as string | Date).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleString('vi-VN')

  const custName =
    String(rawOrder.customerName || rawOrder.customer?.name || 'Khách lẻ tại kho').trim()
  const custPhone = String(rawOrder.customerPhone || rawOrder.customer?.phone || '').trim()

  const metaLines: Array<{ left: string; right: string; bold?: boolean }> = [
    { left: 'Mã đơn POS:', right: orderCode, bold: true },
  ]
  if (rawOrder.invoiceCode) {
    metaLines.push({ left: 'Chứng từ XK:', right: String(rawOrder.invoiceCode) })
  }
  metaLines.push({ left: 'Thời gian:', right: createdStr })
  metaLines.push({ left: 'Khách hàng:', right: custName })
  if (custPhone) {
    metaLines.push({ left: 'Điện thoại:', right: custPhone })
  }

  const rawItems = Array.isArray(rawOrder.items) ? rawOrder.items : []
  const items = rawItems.map((it: any) => {
    const name = String(it.name || it.product?.name || 'Sản phẩm')
    const sku = String(it.sku || it.product?.sku || '')
    const qty = Number(it.quantity) || 1
    const price = Number(it.price) || 0
    const amt = it.amount != null ? Number(it.amount) : qty * price
    return {
      title: sku ? `[${sku}] ${name}` : name,
      subLeft: `${qty} x ${formatVndText(price)}`,
      subRight: formatVndText(amt),
    }
  })

  const totals: Array<{ left: string; right: string; bold?: boolean; large?: boolean }> = []
  const total = Number(rawOrder.total) || 0
  const subtotal = Number(rawOrder.subtotal) || total
  const discount = Number(rawOrder.discountAmount) || 0
  const shipFee = Number(rawOrder.shippingFee) || 0

  if (subtotal !== total) {
    totals.push({ left: 'Tạm tính:', right: formatVndText(subtotal) })
  }
  if (discount > 0) {
    totals.push({ left: 'Chiết khấu / Điểm:', right: `-${formatVndText(discount)}` })
  }
  if (shipFee > 0) {
    totals.push({ left: 'Phí vận chuyển:', right: formatVndText(shipFee) })
  }
  totals.push({ left: 'TỔNG CỘNG:', right: formatVndText(total), bold: true, large: true })

  if (rawOrder.paymentMethod) {
    totals.push({ left: 'Hình thức TT:', right: String(rawOrder.paymentMethod) })
  }
  if (Number(rawOrder.cashReceived) > 0) {
    totals.push({ left: 'Tiền khách đưa:', right: formatVndText(rawOrder.cashReceived) })
  }
  if (Number(rawOrder.changeDue) > 0) {
    totals.push({ left: 'Tiền thừa trả khách:', right: formatVndText(rawOrder.changeDue), bold: true })
  }

  return {
    layout: 'RECEIPT',
    widthUnits,
    heightUnits: Math.max(420, 260 + items.length * 38 + totals.length * 20),
    headerTitle: 'CỬA HÀNG & KHO ƯU ĐÀM',
    headerSub: 'Shop: thaimy1605 (#197195817) · OPENVN POS',
    docTitle: `HÓA ĐƠN BÁN LẺ (${paperSize})`,
    barcodeText: orderCode,
    barcodeBars: bc.bars,
    barcodeTotalModules: bc.totalModules,
    metaLines,
    itemsHeaderLeft: 'Mặt hàng / SL x Đơn giá',
    itemsHeaderRight: 'Thành tiền',
    items,
    totals,
    footerLines: [
      'Cảm ơn Quý khách & Hẹn gặp lại!',
      'In tự động từ Trạm POS Liên Kết — OPENVN',
    ],
  }
}

function buildShopeeRenderPage(
  slip: ShopeeThermalSlipInput,
  shopeeFormat: ShopeePrintFormat,
  paperSize: ThermalPaperSize
): NormalizedRenderPage {
  const isA6 = shopeeFormat === 'A6_LABEL'
  const widthUnits = isA6 ? 394 : paperSize === 'K58' ? 192 : 284 // 394 = 100mm, 284 = 72mm
  const tracking = String(slip.trackingCode || slip.orderCode || 'SHOPEE').trim()
  const bc = getCode128BarRuns(tracking)

  const metaLines: Array<{ left: string; right: string; bold?: boolean }> = [
    { left: 'Đơn vị VC:', right: slip.carrier || 'SPX Express', bold: true },
    { left: 'Mã vận đơn:', right: tracking, bold: true },
    { left: 'Mã đơn CMS:', right: slip.orderCode },
  ]
  if (slip.shopeeOrderSn) {
    metaLines.push({ left: 'Mã đơn Shopee:', right: `#${slip.shopeeOrderSn}` })
  }

  const items = (slip.items || []).map((it) => ({
    title: `[${it.sku || 'SKU'}] ${it.name}${it.fragile ? ' [Dễ vỡ]' : ''}`,
    subLeft: `Đơn giá: ${formatVndText(it.price)}`,
    subRight: `SL: x${it.quantity}`,
  }))

  const codText = slip.codAmount > 0 ? formatVndText(slip.codAmount) : '0đ (ĐÃ THANH TOÁN)'

  return {
    layout: isA6 ? 'A6_LABEL' : 'RECEIPT',
    widthUnits,
    heightUnits: isA6 ? 565 : Math.max(460, 310 + items.length * 38),
    headerTitle: `SHOPEE · ${(slip.carrier || 'SPX EXPRESS').toUpperCase()}`,
    headerSub: slip.sender?.name || 'Shop thaimy1605 — Kho Trung Tâm Ưu Đàm',
    docTitle: isA6 ? 'PHIẾU GIAO HÀNG & ĐÓNG GÓI A6' : `PHIẾU ĐÓNG GÓI SHOPEE (${paperSize})`,
    barcodeText: tracking,
    barcodeBars: bc.bars,
    barcodeTotalModules: bc.totalModules,
    metaLines,
    recipientBlock: {
      name: slip.recipient?.name || 'Khách mua Shopee',
      phone: slip.recipient?.phone || 'Che bảo mật trên Sàn',
      address: slip.recipient?.address || 'Giao qua ĐVVC Shopee',
    },
    fragileBanner: slip.hasFragile
      ? 'HÀNG DỄ VỠ (THẠCH CAO / GỐM) — XIN NHẸ TAY'
      : null,
    itemsHeaderLeft: `Danh sách nhặt hàng (${items.length} mã)`,
    itemsHeaderRight: 'Số lượng',
    items,
    totals: [
      { left: 'TIỀN THU HỘ (COD):', right: codText, bold: true, large: true },
      { left: 'Giá trị đơn hàng:', right: formatVndText(slip.total) },
    ],
    footerLines: [
      slip.note ? `Ghi chú: ${slip.note}` : 'Cho đồng kiểm ngoại quan — Không dùng thử',
      'In tự động từ Quầy POS Liên Kết — OPENVN Suite',
    ],
  }
}

const POWERSHELL_GDI_SILENT_PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing

$jobPath = $env:OPENVN_PRINT_JOB_JSON
if (-not $jobPath -or -not (Test-Path -LiteralPath $jobPath)) {
  throw "Không tìm thấy tệp cấu hình lệnh in tạm thời."
}
$rawJson = [System.IO.File]::ReadAllText($jobPath, [System.Text.Encoding]::UTF8)
$job = $rawJson | ConvertFrom-Json

if ($job.mode -eq 'RAW_ESCPOS') {
  $rawCode = @"
using System;
using System.Runtime.InteropServices;

public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In] DOCINFOW di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);

  public static int SendBytes(string printerName, byte[] bytes, string docName) {
    IntPtr hPrinter = IntPtr.Zero;
    DOCINFOW di = new DOCINFOW();
    di.pDocName = docName;
    di.pDataType = "RAW";
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) {
      throw new Exception("OpenPrinter failed for " + printerName + " (Win32=" + Marshal.GetLastWin32Error() + ")");
    }
    try {
      if (!StartDocPrinter(hPrinter, 1, di)) {
        throw new Exception("StartDocPrinter failed (Win32=" + Marshal.GetLastWin32Error() + ")");
      }
      try {
        StartPagePrinter(hPrinter);
        IntPtr pUnmanaged = Marshal.AllocCoTaskMem(bytes.Length);
        try {
          Marshal.Copy(bytes, 0, pUnmanaged, bytes.Length);
          int written = 0;
          if (!WritePrinter(hPrinter, pUnmanaged, bytes.Length, out written)) {
            throw new Exception("WritePrinter failed (Win32=" + Marshal.GetLastWin32Error() + ")");
          }
          return written;
        } finally {
          Marshal.FreeCoTaskMem(pUnmanaged);
          EndPagePrinter(hPrinter);
        }
      } finally {
        EndDocPrinter(hPrinter);
      }
    } finally {
      ClosePrinter(hPrinter);
    }
  }
}
"@
  Add-Type -TypeDefinition $rawCode -Language CSharp
  $bytes = [Convert]::FromBase64String([string]$job.payloadBase64)
  $written = [RawPrinterHelper]::SendBytes([string]$job.printerName, $bytes, "OPENVN ESC/POS Silent Print")
  @{ ok = $true; pagesPrinted = 1; bytesGenerated = $written } | ConvertTo-Json -Compress
  exit 0
}

function Draw-OpenvnPage {
  param(
    [System.Drawing.Graphics]$g,
    $page,
    [float]$originX,
    [float]$originY,
    [float]$printableW
  )

  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

  $w = [Math]::Min([float]$printableW, [float]$page.widthUnits)
  if ($w -lt 140) { $w = [float]$page.widthUnits }
  $pad = 8.0
  $innerW = $w - ($pad * 2.0)
  $x = $originX + $pad
  $y = $originY + $pad

  $fontTitle = [System.Drawing.Font]::new("Segoe UI", [float]10.5, [System.Drawing.FontStyle]::Bold)
  $fontSub = [System.Drawing.Font]::new("Segoe UI", [float]7.8, [System.Drawing.FontStyle]::Regular)
  $fontDoc = [System.Drawing.Font]::new("Segoe UI", [float]8.8, [System.Drawing.FontStyle]::Bold)
  $fontBody = [System.Drawing.Font]::new("Segoe UI", [float]8.0, [System.Drawing.FontStyle]::Regular)
  $fontBold = [System.Drawing.Font]::new("Segoe UI", [float]8.2, [System.Drawing.FontStyle]::Bold)
  $fontLarge = [System.Drawing.Font]::new("Segoe UI", [float]10.2, [System.Drawing.FontStyle]::Bold)
  $fontMono = [System.Drawing.Font]::new("Consolas", [float]7.8, [System.Drawing.FontStyle]::Bold)

  $brushBlack = [System.Drawing.Brushes]::Black
  $penSolid = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, [float]1.1)
  $penBold = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, [float]1.8)
  $penDash = [System.Drawing.Pen]::new([System.Drawing.Color]::Black, [float]0.8)
  $penDash.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

  $sfCenter = [System.Drawing.StringFormat]::new()
  $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center
  $sfRight = [System.Drawing.StringFormat]::new()
  $sfRight.Alignment = [System.Drawing.StringAlignment]::Far
  $sfLeft = [System.Drawing.StringFormat]::new()
  $sfLeft.Alignment = [System.Drawing.StringAlignment]::Near

  # 1. Header
  $rectH1 = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]18)
  $g.DrawString([string]$page.headerTitle, $fontTitle, $brushBlack, $rectH1, $sfCenter)
  $y += 17

  $rectH2 = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]14)
  $g.DrawString([string]$page.headerSub, $fontSub, $brushBlack, $rectH2, $sfCenter)
  $y += 14

  $rectH3 = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]16)
  $g.DrawString([string]$page.docTitle, $fontDoc, $brushBlack, $rectH3, $sfCenter)
  $y += 17

  $g.DrawLine($penSolid, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
  $y += 5

  # 2. Vector CODE128 Barcode
  $totalMods = [int]$page.barcodeTotalModules
  if ($totalMods -gt 0 -and $page.barcodeBars.Count -gt 0) {
    $maxBcW = $innerW - 12.0
    $modW = [Math]::Max(0.75, [Math]::Min(1.8, ($maxBcW / [float]$totalMods)))
    $actualBcW = $modW * [float]$totalMods
    $bcStartX = $x + (($innerW - $actualBcW) / 2.0)
    $bcHeight = if ($page.layout -eq 'A6_LABEL') { 34.0 } else { 24.0 }
    foreach ($bar in $page.barcodeBars) {
      $bx = [float]($bcStartX + ([float]$bar.x * $modW))
      $bw = [float]([Math]::Max(0.7, ([float]$bar.w * $modW)))
      $g.FillRectangle($brushBlack, $bx, [float]$y, $bw, [float]$bcHeight)
    }
    $y += ($bcHeight + 2)
    $rectBcTxt = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]13)
    $g.DrawString([string]$page.barcodeText, $fontMono, $brushBlack, $rectBcTxt, $sfCenter)
    $y += 15
    $g.DrawLine($penDash, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
    $y += 4
  }

  # 3. Meta lines
  foreach ($m in $page.metaLines) {
    $f = if ($m.bold) { $fontBold } else { $fontBody }
    $g.DrawString([string]$m.left, $fontBody, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]($innerW * 0.46), [float]15), $sfLeft)
    $g.DrawString([string]$m.right, $f, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + ($innerW * 0.36)), [float]$y, [float]($innerW * 0.64), [float]15), $sfRight)
    $y += 14.5
  }

  # 4. Recipient block (Shopee A6 / Shipping)
  if ($null -ne $page.recipientBlock) {
    $y += 2
    $g.DrawLine($penSolid, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
    $y += 4
    $g.DrawString(("NGƯỜI NHẬN: " + [string]$page.recipientBlock.name), $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]15), $sfLeft)
    $y += 14.5
    $g.DrawString(("SĐT: " + [string]$page.recipientBlock.phone), $fontBody, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]14), $sfLeft)
    $y += 14
    $addrRect = [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]28)
    $g.DrawString(("Đ/C: " + [string]$page.recipientBlock.address), $fontBody, $brushBlack, $addrRect, $sfLeft)
    $y += 27
  }

  # 5. Fragile warning box
  if ($page.fragileBanner) {
    $g.DrawRectangle($penBold, [float]$x, [float]$y, [float]$innerW, [float]19)
    $g.DrawString([string]$page.fragileBanner, $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]($y + 2.5), [float]$innerW, [float]15), $sfCenter)
    $y += 23
  }

  # 6. Items table
  $g.DrawLine($penSolid, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
  $y += 3
  $g.DrawString([string]$page.itemsHeaderLeft, $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]($innerW * 0.72), [float]14), $sfLeft)
  $g.DrawString([string]$page.itemsHeaderRight, $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + ($innerW * 0.65)), [float]$y, [float]($innerW * 0.35), [float]14), $sfRight)
  $y += 15
  $g.DrawLine($penDash, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
  $y += 3

  foreach ($it in $page.items) {
    $titleMeasured = $g.MeasureString([string]$it.title, $fontBold, [int]$innerW)
    $titleH = [Math]::Max(14.0, [Math]::Ceiling($titleMeasured.Height))
    $g.DrawString([string]$it.title, $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]$titleH), $sfLeft)
    $y += $titleH
    $g.DrawString([string]$it.subLeft, $fontBody, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + 4), [float]$y, [float]($innerW * 0.62), [float]14), $sfLeft)
    $g.DrawString([string]$it.subRight, $fontBold, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + ($innerW * 0.55)), [float]$y, [float]($innerW * 0.45), [float]14), $sfRight)
    $y += 15
  }

  $g.DrawLine($penSolid, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
  $y += 4

  # 7. Totals
  foreach ($tot in $page.totals) {
    if ($tot.large) {
      $g.DrawString([string]$tot.left, $fontLarge, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]($innerW * 0.56), [float]19), $sfLeft)
      $g.DrawString([string]$tot.right, $fontLarge, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + ($innerW * 0.42)), [float]$y, [float]($innerW * 0.58), [float]19), $sfRight)
      $y += 19
    } else {
      $ft = if ($tot.bold) { $fontBold } else { $fontBody }
      $g.DrawString([string]$tot.left, $fontBody, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]($innerW * 0.58), [float]15), $sfLeft)
      $g.DrawString([string]$tot.right, $ft, $brushBlack, [System.Drawing.RectangleF]::new([float]($x + ($innerW * 0.45)), [float]$y, [float]($innerW * 0.55), [float]15), $sfRight)
      $y += 15
    }
  }

  # 8. Footer
  $y += 2
  $g.DrawLine($penDash, [float]$x, [float]$y, [float]($x + $innerW), [float]$y)
  $y += 4
  foreach ($fl in $page.footerLines) {
    $g.DrawString([string]$fl, $fontSub, $brushBlack, [System.Drawing.RectangleF]::new([float]$x, [float]$y, [float]$innerW, [float]14), $sfCenter)
    $y += 13.5
  }

  # Khung viền ngoài chuẩn Tem Vận Đơn A6 (hoặc viền cắt khi in trên giấy lớn A4)
  if ($page.layout -eq 'A6_LABEL' -or $printableW -gt ($w + 40)) {
    $boxH = ($y - $originY) + 4
    $g.DrawRectangle($penBold, [float]($originX + 2), [float]($originY + 2), [float]($w - 4), [float]$boxH)
  }

  $fontTitle.Dispose()
  $fontSub.Dispose()
  $fontDoc.Dispose()
  $fontBody.Dispose()
  $fontBold.Dispose()
  $fontLarge.Dispose()
  $fontMono.Dispose()
  $penSolid.Dispose()
  $penBold.Dispose()
  $penDash.Dispose()
  $sfCenter.Dispose()
  $sfRight.Dispose()
  $sfLeft.Dispose()

  return $y
}

$pages = @($job.pages)
if ($pages.Count -eq 0) {
  throw "Không có trang nội dung nào để in."
}

if ($job.mode -eq 'DRY_RUN') {
  $first = $pages[0]
  $bmpW = [int]([Math]::Max(320, ([int]$first.widthUnits * 2)))
  $bmpH = [int]([Math]::Max(600, ([int]$first.heightUnits * 2)))
  $bmp = [System.Drawing.Bitmap]::new($bmpW, $bmpH)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $null = Draw-OpenvnPage -g $g -page $first -originX 0 -originY 0 -printableW ([float]$first.widthUnits)
  $ms = [System.IO.MemoryStream]::new()
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngSize = $ms.Length
  $ms.Dispose()
  $g.Dispose()
  $bmp.Dispose()
  @{ ok = $true; pagesPrinted = $pages.Count; bytesGenerated = $pngSize } | ConvertTo-Json -Compress
  exit 0
}

$doc = [System.Drawing.Printing.PrintDocument]::new()
$doc.DocumentName = [string]$job.documentName
$doc.PrinterSettings.PrinterName = [string]$job.printerName
if (-not $doc.PrinterSettings.IsValid) {
  throw ("Máy in Windows không hợp lệ hoặc đã ngắt kết nối: " + [string]$job.printerName)
}

if ($job.outputPdfPath) {
  $doc.PrinterSettings.PrintToFile = $true
  $doc.PrinterSettings.PrintFileName = [string]$job.outputPdfPath
}

# Tắt hoàn toàn cửa sổ tiến trình "Printing page 1..." để in ngầm 100% không hiện bất kỳ hộp thoại nào
$doc.PrintController = [System.Drawing.Printing.StandardPrintController]::new()
$doc.OriginAtMargins = $false

$script:pageIdx = 0
$doc.add_PrintPage({
  param($sender, $e)
  $curPage = $pages[$script:pageIdx]
  $bounds = $e.PageBounds
  $availW = [Math]::Max(150.0, ([float]$bounds.Width - 12.0))
  $null = Draw-OpenvnPage -g $e.Graphics -page $curPage -originX 6.0 -originY 6.0 -printableW $availW
  $script:pageIdx++
  $e.HasMorePages = ($script:pageIdx -lt $pages.Count)
})

$doc.Print()
$doc.Dispose()

$outBytes = 0
if ($job.outputPdfPath -and (Test-Path -LiteralPath ([string]$job.outputPdfPath))) {
  $outBytes = (Get-Item -LiteralPath ([string]$job.outputPdfPath)).Length
}
@{ ok = $true; pagesPrinted = $pages.Count; bytesGenerated = $outBytes } | ConvertTo-Json -Compress
`.trim()

/**
 * Đẩy lệnh in tự động ngầm 100% qua Windows Print Spooler (không hiện hộp thoại trình duyệt).
 */
export async function printSilentViaWindowsSpooler(
  req: WindowsSilentPrintRequest
): Promise<WindowsSilentPrintResult> {
  const startedAt = Date.now()
  if (process.platform !== 'win32') {
    return {
      ok: false,
      printerName: '',
      mode: 'WINDOWS_GDI_SILENT',
      pagesPrinted: 0,
      durationMs: Date.now() - startedAt,
      error: 'Máy chủ hiện tại không chạy hệ điều hành Windows.',
    }
  }

  const printers = await listWindowsPrinters()
  const requestedName = String(req.printerName || '').trim()
  let resolvedPrinterName = ''

  if (req.dryRun) {
    resolvedPrinterName = requestedName || printers[0]?.name || 'DRY-RUN-VIRTUAL-PRINTER'
  } else if (req.testPdfSpool) {
    const pdfPrinter = printers.find((p) => /microsoft print to pdf/i.test(p.name))
    if (!pdfPrinter) {
      return {
        ok: false,
        printerName: 'Microsoft Print to PDF',
        mode: 'WINDOWS_PDF_SPOOL_TEST',
        pagesPrinted: 0,
        durationMs: Date.now() - startedAt,
        error: 'Máy Windows này không bật Microsoft Print to PDF.',
      }
    }
    resolvedPrinterName = pdfPrinter.name
  } else if (!requestedName || requestedName.toUpperCase() === 'AUTO_PHYSICAL') {
    const preferredPhysical =
      printers.find((p) => p.isPhysical && p.isDefault) ??
      printers.find((p) => p.isPhysical && p.kind === 'thermal_or_label') ??
      printers.find((p) => p.isPhysical)
    if (!preferredPhysical) {
      return {
        ok: false,
        printerName: '',
        mode: 'WINDOWS_GDI_SILENT',
        pagesPrinted: 0,
        durationMs: Date.now() - startedAt,
        error: 'Chưa phát hiện máy in vật lý nào trong Windows Spooler.',
      }
    }
    resolvedPrinterName = preferredPhysical.name
  } else {
    const exact =
      printers.find((p) => p.name.toLowerCase() === requestedName.toLowerCase()) ??
      (await listWindowsPrinters(true)).find(
        (p) => p.name.toLowerCase() === requestedName.toLowerCase()
      )
    if (!exact) {
      return {
        ok: false,
        printerName: requestedName,
        mode: 'WINDOWS_GDI_SILENT',
        pagesPrinted: 0,
        durationMs: Date.now() - startedAt,
        error: `Không tìm thấy máy in "${requestedName}" trong Windows Spooler.`,
      }
    }
    resolvedPrinterName = exact.name
  }

  const paperSize: ThermalPaperSize = req.paperSize === 'K58' ? 'K58' : 'K80'
  const shopeeFormat: ShopeePrintFormat =
    req.shopeeFormat === 'THERMAL_K80' ? 'THERMAL_K80' : 'A6_LABEL'

  const pages: NormalizedRenderPage[] = []
  if (req.jobType === 'POS_RECEIPT' && req.receipt) {
    pages.push(buildReceiptRenderPage(req.receipt, paperSize))
  } else if (req.jobType === 'SHOPEE_SLIP' && req.slip) {
    pages.push(buildShopeeRenderPage(req.slip, shopeeFormat, paperSize))
  } else if (req.jobType === 'SHOPEE_BATCH_SLIPS' && Array.isArray(req.slips)) {
    for (const s of req.slips) {
      pages.push(buildShopeeRenderPage(s, shopeeFormat, paperSize))
    }
  }

  const isRaw = Boolean(req.rawEscPos && req.payloadBase64 && !req.dryRun && !req.testPdfSpool)
  if (!isRaw && pages.length === 0) {
    return {
      ok: false,
      printerName: resolvedPrinterName,
      mode: 'WINDOWS_GDI_SILENT',
      pagesPrinted: 0,
      durationMs: Date.now() - startedAt,
      error: 'Thiếu dữ liệu hóa đơn POS hoặc vận đơn Shopee để in.',
    }
  }

  const tmpId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  const tmpJobJsonPath = path.join(os.tmpdir(), `openvn-print-job-${tmpId}.json`)
  const tmpPdfPath = req.testPdfSpool
    ? path.join(os.tmpdir(), `openvn-print-spool-${tmpId}.pdf`)
    : undefined

  const jobPayload = {
    mode: req.dryRun ? 'DRY_RUN' : isRaw ? 'RAW_ESCPOS' : 'GDI_PAGE',
    printerName: resolvedPrinterName,
    documentName:
      req.jobType === 'POS_RECEIPT'
        ? `OPENVN POS Bill (${paperSize})`
        : `OPENVN Shopee Label (${shopeeFormat})`,
    payloadBase64: isRaw ? req.payloadBase64 : undefined,
    outputPdfPath: tmpPdfPath,
    pages,
  }

  try {
    await fs.writeFile(tmpJobJsonPath, JSON.stringify(jobPayload), 'utf8')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        POWERSHELL_GDI_SILENT_PRINT_SCRIPT,
      ],
      {
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          OPENVN_PRINT_JOB_JSON: tmpJobJsonPath,
        },
      }
    )

    const lastJsonLine =
      stdout
        .trim()
        .split(/\r?\n/)
        .reverse()
        .find((ln) => ln.trim().startsWith('{')) || '{}'
    const parsed = JSON.parse(lastJsonLine) as {
      ok?: boolean
      pagesPrinted?: number
      bytesGenerated?: number
    }

    return {
      ok: Boolean(parsed.ok),
      printerName: resolvedPrinterName,
      mode: req.dryRun
        ? 'WINDOWS_DRY_RUN'
        : req.testPdfSpool
          ? 'WINDOWS_PDF_SPOOL_TEST'
          : isRaw
            ? 'WINDOWS_RAW_ESCPOS'
            : 'WINDOWS_GDI_SILENT',
      pagesPrinted: Number(parsed.pagesPrinted) || pages.length || 1,
      bytesGenerated: Number(parsed.bytesGenerated) || 0,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    return {
      ok: false,
      printerName: resolvedPrinterName,
      mode: isRaw ? 'WINDOWS_RAW_ESCPOS' : 'WINDOWS_GDI_SILENT',
      pagesPrinted: 0,
      durationMs: Date.now() - startedAt,
      error:
        err instanceof Error
          ? err.message
          : 'Không thể gửi lệnh in ngầm tới Windows Print Spooler.',
    }
  } finally {
    await fs.unlink(tmpJobJsonPath).catch(() => null)
    if (tmpPdfPath) {
      await fs.unlink(tmpPdfPath).catch(() => null)
    }
  }
}
