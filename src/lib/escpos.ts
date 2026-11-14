/**
 * ESC/POS Thermal Receipt, Windows Silent Spooler & Shopee Shipping Label Driver
 * Hỗ trợ 5 tầng kết nối in tự động:
 *  1. Windows Print Spooler In Ngầm 100% (0 hộp thoại) cho mọi máy in USB / Wi-Fi / Networking cài trên Windows (Epson, Xprinter, Zywell, HPRT, Canon...)
 *  2. Máy in nhiệt mạng LAN / Wi-Fi RAW TCP :9100 qua /api/peripherals
 *  3. Máy in nhiệt cáp USB trực tiếp (WebUSB API — requestDevice + transferOut)
 *  4. Máy in nhiệt cổng COM / Bluetooth SPP (WebSerial API — requestPort + writable)
 *  5. Khung in cô lập Iframe chuẩn khổ K80 (80mm), K58 (58mm) và Tem vận đơn Shopee A6 (105×148mm)
 *
 * Lệnh chuẩn ESC/POS:
 *  - Khởi tạo: ESC @ (0x1B 0x40)
 *  - Cắt giấy: GS V (0x1D 0x56 0x00)
 */

import { barcodeSvg } from '@/lib/barcode'

export interface ReceiptItem {
  name: string
  sku?: string
  quantity: number
  price: number
  amount?: number
}

export interface ReceiptOrder {
  code: string
  invoiceCode?: string | null
  createdAt?: string | Date
  customerName?: string
  customerPhone?: string
  customer?: { name?: string | null; phone?: string | null } | null
  items: ReceiptItem[]
  subtotal?: number
  discountAmount?: number
  shippingFee?: number
  total: number
  paymentMethod?: string
  cashReceived?: number
  changeDue?: number
}

export interface ShopeeThermalSlipInput {
  orderId?: string
  orderCode: string
  shopeeOrderSn?: string
  createdAt?: string | Date
  hasFragile?: boolean
  carrier: string
  trackingCode: string
  sender?: {
    name: string
    phone: string
    address: string
  }
  recipient: {
    name: string
    phone: string
    address: string
  }
  items: Array<{
    name: string
    sku: string
    quantity: number
    price: number
    fragile?: boolean
  }>
  total: number
  codAmount: number
  paymentMethod?: string
  note?: string | null
}

export type ThermalTransportMode =
  | 'auto'
  | 'windows_spooler'
  | 'lan_tcp'
  | 'webusb'
  | 'webserial'
  | 'browser_print'
export type ThermalPaperSize = 'K80' | 'K58'
export type ShopeePrintFormat = 'A6_LABEL' | 'THERMAL_K80'

export interface WindowsPrinterClientItem {
  name: string
  isDefault: boolean
  isPhysical: boolean
  kind: 'thermal_or_label' | 'office_printer' | 'virtual'
}

export interface PeripheralPrinterConfig {
  transport: ThermalTransportMode
  /** Tên máy in trong Windows Spooler (rỗng = tự động chọn máy in vật lý mặc định của Windows) */
  windowsPrinterName: string
  /** Gửi byte ESC/POS thô (kèm xung mở két tiền RJ11) thay vì trang đồ họa GDI+ */
  rawEscPosOnWindows: boolean
  paperSize: ThermalPaperSize
  shopeeFormat: ShopeePrintFormat
  lanHost: string
  lanPort: number
  serialBaudRate: number
  autoPrintPosBill: boolean
  autoPrintShopeeOrder: boolean
  soundEnabled: boolean
}

export const DEFAULT_PRINTER_CONFIG: PeripheralPrinterConfig = {
  transport: 'auto',
  windowsPrinterName: '',
  rawEscPosOnWindows: false,
  paperSize: 'K80',
  shopeeFormat: 'A6_LABEL',
  lanHost: '192.168.1.200',
  lanPort: 9100,
  serialBaudRate: 9600,
  autoPrintPosBill: true,
  autoPrintShopeeOrder: true,
  soundEnabled: true,
}

const PRINTER_CFG_STORAGE_KEY = 'openvn_pos_printer_cfg_v2'
const LEGACY_PRINTER_CFG_STORAGE_KEY = 'openvn_pos_printer_cfg_v1'

export function loadPrinterConfig(): PeripheralPrinterConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_PRINTER_CONFIG }
  try {
    const rawV2 = window.localStorage.getItem(PRINTER_CFG_STORAGE_KEY)
    if (!rawV2) {
      const rawV1 = window.localStorage.getItem(LEGACY_PRINTER_CFG_STORAGE_KEY)
      if (!rawV1) return { ...DEFAULT_PRINTER_CONFIG }
      const legacy = JSON.parse(rawV1) as Partial<PeripheralPrinterConfig>
      const migrated: PeripheralPrinterConfig = {
        ...DEFAULT_PRINTER_CONFIG,
        paperSize: legacy.paperSize === 'K58' ? 'K58' : 'K80',
        shopeeFormat: legacy.shopeeFormat === 'THERMAL_K80' ? 'THERMAL_K80' : 'A6_LABEL',
        lanHost:
          typeof legacy.lanHost === 'string' && legacy.lanHost.trim()
            ? legacy.lanHost.trim()
            : '192.168.1.200',
        lanPort:
          Number.isFinite(Number(legacy.lanPort)) && Number(legacy.lanPort) >= 1024
            ? Number(legacy.lanPort)
            : 9100,
        soundEnabled: legacy.soundEnabled ?? true,
        autoPrintPosBill: true,
        autoPrintShopeeOrder: true,
      }
      window.localStorage.setItem(PRINTER_CFG_STORAGE_KEY, JSON.stringify(migrated))
      return migrated
    }

    const parsed = JSON.parse(rawV2) as Partial<PeripheralPrinterConfig>
    const validTransports: ThermalTransportMode[] = [
      'auto',
      'windows_spooler',
      'lan_tcp',
      'webusb',
      'webserial',
      'browser_print',
    ]
    return {
      transport:
        parsed.transport && validTransports.includes(parsed.transport)
          ? parsed.transport
          : DEFAULT_PRINTER_CONFIG.transport,
      windowsPrinterName:
        typeof parsed.windowsPrinterName === 'string' ? parsed.windowsPrinterName.trim() : '',
      rawEscPosOnWindows: Boolean(parsed.rawEscPosOnWindows),
      paperSize: parsed.paperSize === 'K58' ? 'K58' : 'K80',
      shopeeFormat: parsed.shopeeFormat === 'THERMAL_K80' ? 'THERMAL_K80' : 'A6_LABEL',
      lanHost:
        typeof parsed.lanHost === 'string' && parsed.lanHost.trim()
          ? parsed.lanHost.trim()
          : '192.168.1.200',
      lanPort:
        Number.isFinite(Number(parsed.lanPort)) && Number(parsed.lanPort) >= 1024
          ? Number(parsed.lanPort)
          : 9100,
      serialBaudRate:
        Number.isFinite(Number(parsed.serialBaudRate)) && Number(parsed.serialBaudRate) >= 2400
          ? Number(parsed.serialBaudRate)
          : 9600,
      autoPrintPosBill: parsed.autoPrintPosBill ?? true,
      autoPrintShopeeOrder: parsed.autoPrintShopeeOrder ?? true,
      soundEnabled: parsed.soundEnabled ?? true,
    }
  } catch {
    return { ...DEFAULT_PRINTER_CONFIG }
  }
}

export function savePrinterConfig(cfg: PeripheralPrinterConfig): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PRINTER_CFG_STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    // ignore storage quota errors
  }
}

// Byte commands
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export const ESC_POS_COMMANDS = {
  INIT: [ESC, 0x40], // ESC @ — Khởi tạo máy in
  CUT_FULL: [GS, 0x56, 0x00], // GS V 0 — Cắt giấy toàn phần
  CUT_PARTIAL: [GS, 0x56, 0x01], // GS V 1 — Cắt giấy một phần
  CASH_DRAWER_KICK: [ESC, 0x70, 0x00, 0x19, 0xfa], // ESC p — Mở ngăn kéo đựng tiền RJ11
  ALIGN_LEFT: [ESC, 0x61, 0x00],
  ALIGN_CENTER: [ESC, 0x61, 0x01],
  ALIGN_RIGHT: [ESC, 0x61, 0x02],
  BOLD_ON: [ESC, 0x45, 0x01],
  BOLD_OFF: [ESC, 0x45, 0x00],
  TEXT_NORMAL: [GS, 0x21, 0x00],
  TEXT_DOUBLE_HEIGHT: [GS, 0x21, 0x01],
  TEXT_DOUBLE_WIDTH: [GS, 0x21, 0x10],
  TEXT_DOUBLE: [GS, 0x21, 0x11],
  LINE_FEED: [LF],
}

/** Chuyển tiếng Việt có dấu thành chuỗi ASCII sạch để không bị lỗi font trên mọi máy in nhiệt ESC/POS */
export function removeVietnameseDiacritics(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ngắt dòng an toàn theo khổ giấy K80 (48 cột) hoặc K58 (32 cột) */
function wrapAsciiLines(text: string, width: number): string[] {
  const clean = removeVietnameseDiacritics(text)
  if (!clean) return ['']
  if (clean.length <= width) return [clean]
  const words = clean.split(' ')
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (!cur) {
      cur = w.slice(0, width)
    } else if (cur.length + 1 + w.length <= width) {
      cur += ` ${w}`
    } else {
      lines.push(cur)
      cur = w.slice(0, width)
    }
  }
  if (cur) lines.push(cur)
  return lines
}

/** Căn 2 cột trái - phải trên dòng K80 (48 ký tự) hoặc K58 (32 ký tự) */
function formatTwoColumns(left: string, right: string, width = 48): string {
  const cleanLeft = removeVietnameseDiacritics(left)
  const cleanRight = removeVietnameseDiacritics(right)
  const spaceNeeded = width - cleanLeft.length - cleanRight.length
  if (spaceNeeded <= 0) {
    return `${cleanLeft}\n${cleanRight.padStart(width, ' ')}`
  }
  return `${cleanLeft}${' '.repeat(spaceNeeded)}${cleanRight}`
}

function formatVndNumber(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString('en-US').replace(/,/g, '.')}d`
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/**
 * Mã hóa đơn hàng POS thành mảng byte ESC/POS K80 / K58
 */
export function encodeReceipt(
  order: ReceiptOrder | Record<string, any>,
  options?: { paperSize?: ThermalPaperSize; openCashDrawer?: boolean }
): Uint8Array {
  const cols = options?.paperSize === 'K58' ? 32 : 48
  const sepDash = '-'.repeat(cols)
  const sepEq = '='.repeat(cols)
  const bytes: number[] = []

  const append = (...arr: number[]) => {
    bytes.push(...arr)
  }

  const appendAscii = (text: string) => {
    const clean = removeVietnameseDiacritics(text)
    for (let i = 0; i < clean.length; i++) {
      bytes.push(clean.charCodeAt(i) & 0x7f)
    }
  }

  const appendRawLine = (raw: string) => {
    for (const part of raw.split('\n')) {
      for (let i = 0; i < part.length; i++) {
        const code = part.charCodeAt(i)
        bytes.push(code >= 32 && code <= 126 ? code : 32)
      }
      append(LF)
    }
  }

  const appendLine = (text = '') => {
    if (text) appendAscii(text)
    append(LF)
  }

  // 1. Khởi tạo máy in (ESC @) + mở két tiền nếu thanh toán tiền mặt
  append(...ESC_POS_COMMANDS.INIT)
  if (options?.openCashDrawer) {
    append(...ESC_POS_COMMANDS.CASH_DRAWER_KICK)
  }

  // 2. Tiêu đề cửa hàng
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE)
  appendLine('UU DAM SUITE')
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendLine('KHO HANG & QUAY POS OPENVN')
  appendLine('Shop: thaimy1605 (#197195817)')
  appendRawLine(sepDash)

  // 3. Thông tin đơn hàng
  append(...ESC_POS_COMMANDS.ALIGN_LEFT)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  appendLine(`HOA DON POS: ${order.code || 'POS-ORDER'}`)
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  if (order.invoiceCode) {
    appendLine(`Chung tu XK: ${order.invoiceCode}`)
  }

  const dateStr = order.createdAt
    ? new Date(order.createdAt).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : new Date().toLocaleString('vi-VN')

  appendLine(`Thoi gian : ${dateStr}`)
  const custName = order.customerName || order.customer?.name
  const custPhone = order.customerPhone || order.customer?.phone
  if (custName) {
    for (const ln of wrapAsciiLines(`Khach hang: ${custName}`, cols)) appendLine(ln)
  }
  if (custPhone) {
    appendLine(`Dien thoai: ${custPhone}`)
  }
  appendRawLine(sepEq)

  // 4. Bảng sản phẩm
  appendRawLine(formatTwoColumns('Mat hang / SL x Don gia', 'Thanh tien', cols))
  appendRawLine(sepDash)

  const items = Array.isArray(order.items) ? order.items : []
  for (const it of items) {
    const name = it.name || it.product?.name || 'San pham'
    const sku = it.sku || it.product?.sku || ''
    const qty = Number(it.quantity) || 1
    const price = Number(it.price) || 0
    const amt = it.amount ?? qty * price

    append(...ESC_POS_COMMANDS.BOLD_ON)
    for (const ln of wrapAsciiLines(sku ? `[${sku}] ${name}` : name, cols)) {
      appendLine(ln)
    }
    append(...ESC_POS_COMMANDS.BOLD_OFF)
    appendRawLine(formatTwoColumns(`  ${qty} x ${formatVndNumber(price)}`, formatVndNumber(amt), cols))
  }

  appendRawLine(sepEq)

  // 5. Tổng kết thanh toán
  if (order.subtotal && order.subtotal !== order.total) {
    appendRawLine(formatTwoColumns('Tam tinh:', formatVndNumber(order.subtotal), cols))
  }
  if (order.discountAmount && order.discountAmount > 0) {
    appendRawLine(formatTwoColumns('Chiet khau/Voucher:', `-${formatVndNumber(order.discountAmount)}`, cols))
  }
  if (order.shippingFee && order.shippingFee > 0) {
    appendRawLine(formatTwoColumns('Phi van chuyen:', formatVndNumber(order.shippingFee), cols))
  }

  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE_HEIGHT)
  appendRawLine(formatTwoColumns('TONG TIEN:', formatVndNumber(order.total || 0), cols))
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  append(...ESC_POS_COMMANDS.BOLD_OFF)

  if (order.paymentMethod) {
    appendRawLine(formatTwoColumns('Hinh thuc TT:', String(order.paymentMethod), cols))
  }
  if (order.cashReceived != null && order.cashReceived > 0) {
    appendRawLine(formatTwoColumns('Tien khach dua:', formatVndNumber(order.cashReceived), cols))
  }
  if (order.changeDue != null && order.changeDue > 0) {
    appendRawLine(formatTwoColumns('Tien thua tra:', formatVndNumber(order.changeDue), cols))
  }

  // 6. Lời cảm ơn
  appendRawLine(sepDash)
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  appendLine('Cam on Quy khach & Hen gap lai!')
  appendLine('Kiem tra hang hoa truoc khi roi quay')

  // 7. Feed 4 dòng và cắt giấy (GS V 0)
  append(LF, LF, LF, LF)
  append(...ESC_POS_COMMANDS.CUT_FULL)

  return new Uint8Array(bytes)
}

/**
 * Mã hóa Phiếu Đóng Gói / Vận Đơn Sàn Shopee ra mảng byte nhiệt ESC/POS K80 / K58
 */
export function encodeShopeeSlip(
  slip: ShopeeThermalSlipInput,
  options?: { paperSize?: ThermalPaperSize }
): Uint8Array {
  const cols = options?.paperSize === 'K58' ? 32 : 48
  const sepDash = '-'.repeat(cols)
  const sepEq = '='.repeat(cols)
  const bytes: number[] = []

  const append = (...arr: number[]) => bytes.push(...arr)
  const appendRawLine = (raw: string) => {
    for (const part of raw.split('\n')) {
      for (let i = 0; i < part.length; i++) {
        const code = part.charCodeAt(i)
        bytes.push(code >= 32 && code <= 126 ? code : 32)
      }
      append(LF)
    }
  }
  const appendLine = (text = '') => {
    const clean = removeVietnameseDiacritics(text)
    for (let i = 0; i < clean.length; i++) {
      bytes.push(clean.charCodeAt(i) & 0x7f)
    }
    append(LF)
  }

  append(...ESC_POS_COMMANDS.INIT)
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE)
  appendLine('SHOPEE EXPRESS')
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  appendLine('PHIEU DONG GOI & GIAO HANG')
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendLine('Shop: thaimy1605 (#197195817)')
  appendRawLine(sepEq)

  append(...ESC_POS_COMMANDS.ALIGN_LEFT)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  appendRawLine(formatTwoColumns('DVVC:', slip.carrier || 'SPX Express', cols))
  appendRawLine(formatTwoColumns('MA VAN DON:', slip.trackingCode || slip.orderCode, cols))
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendRawLine(formatTwoColumns('Ma don CMS:', slip.orderCode, cols))
  if (slip.shopeeOrderSn) {
    appendRawLine(formatTwoColumns('Shopee SN:', `#${slip.shopeeOrderSn}`, cols))
  }
  appendRawLine(sepDash)

  append(...ESC_POS_COMMANDS.BOLD_ON)
  appendLine(`NGUOI NHAN: ${slip.recipient.name || 'Khach Shopee'}`)
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendLine(`SDT: ${slip.recipient.phone || 'Che bao mat tren San'}`)
  for (const ln of wrapAsciiLines(`DC: ${slip.recipient.address || 'Giao qua Shopee'}`, cols)) {
    appendLine(ln)
  }

  if (slip.hasFragile) {
    appendRawLine(sepDash)
    append(...ESC_POS_COMMANDS.ALIGN_CENTER)
    append(...ESC_POS_COMMANDS.BOLD_ON)
    appendLine('*** CANH BAO: HANG DE VO (GOM / THACH CAO) ***')
    append(...ESC_POS_COMMANDS.BOLD_OFF)
    append(...ESC_POS_COMMANDS.ALIGN_LEFT)
  }

  appendRawLine(sepEq)
  appendRawLine(formatTwoColumns('DANH SACH NHAT HANG (SKU)', 'SL', cols))
  appendRawLine(sepDash)

  for (const it of slip.items || []) {
    append(...ESC_POS_COMMANDS.BOLD_ON)
    appendRawLine(formatTwoColumns(`[${it.sku || 'SKU'}]`, `x${it.quantity}`, cols))
    append(...ESC_POS_COMMANDS.BOLD_OFF)
    for (const ln of wrapAsciiLines(`  ${it.name}${it.fragile ? ' [De vo]' : ''}`, cols)) {
      appendLine(ln)
    }
  }

  appendRawLine(sepEq)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE_HEIGHT)
  if (slip.codAmount > 0) {
    appendRawLine(formatTwoColumns('THU HO COD:', formatVndNumber(slip.codAmount), cols))
  } else {
    appendRawLine(formatTwoColumns('THU HO COD:', '0d (DA TT)', cols))
  }
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendRawLine(formatTwoColumns('Gia tri don:', formatVndNumber(slip.total), cols))

  if (slip.note) {
    appendRawLine(sepDash)
    for (const ln of wrapAsciiLines(`Ghi chu: ${slip.note}`, cols)) appendLine(ln)
  }

  appendRawLine(sepDash)
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  appendLine('In tu dong tu Quay POS Lien Ket - OPENVN')
  append(LF, LF, LF, LF)
  append(...ESC_POS_COMMANDS.CUT_FULL)

  return new Uint8Array(bytes)
}

export interface PairedHardwareSummary {
  webUsbSupported: boolean
  webSerialSupported: boolean
  usbPrinters: Array<{ name: string; vendorId: number; productId: number }>
  serialPortsCount: number
  camerasCount: number
}

/** Liệt kê thiết bị phần cứng đã cấp quyền trên trình duyệt POS hiện tại */
export async function listPairedHardwareDevices(): Promise<PairedHardwareSummary> {
  const summary: PairedHardwareSummary = {
    webUsbSupported: typeof navigator !== 'undefined' && 'usb' in navigator,
    webSerialSupported: typeof navigator !== 'undefined' && 'serial' in navigator,
    usbPrinters: [],
    serialPortsCount: 0,
    camerasCount: 0,
  }
  if (typeof navigator === 'undefined') return summary

  if (summary.webUsbSupported) {
    try {
      const devices = await (navigator as any).usb.getDevices()
      summary.usbPrinters = (devices || []).map((d: any) => ({
        name: d.productName || `USB Printer (${d.vendorId}:${d.productId})`,
        vendorId: d.vendorId || 0,
        productId: d.productId || 0,
      }))
    } catch {
      // ignore
    }
  }

  if (summary.webSerialSupported) {
    try {
      const ports = await (navigator as any).serial.getPorts()
      summary.serialPortsCount = Array.isArray(ports) ? ports.length : 0
    } catch {
      // ignore
    }
  }

  if (navigator.mediaDevices?.enumerateDevices) {
    try {
      const media = await navigator.mediaDevices.enumerateDevices()
      summary.camerasCount = media.filter((m) => m.kind === 'videoinput').length
    } catch {
      // ignore
    }
  }

  return summary
}

/** Mở hộp thoại trình duyệt để ghép nối máy in nhiệt cáp USB (WebUSB) */
export async function requestWebUsbPrinter(): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    return { ok: false, error: 'Trình duyệt này không hỗ trợ WebUSB (hãy dùng Chrome hoặc Edge trên máy POS).' }
  }
  try {
    const device = await (navigator as any).usb.requestDevice({ filters: [] })
    return {
      ok: true,
      name: device?.productName || `USB Thermal (${device?.vendorId}:${device?.productId})`,
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Đã hủy chọn máy in USB' }
  }
}

/** Mở hộp thoại trình duyệt để ghép nối máy in cổng COM / Bluetooth SPP (WebSerial) */
export async function requestWebSerialPrinter(): Promise<{ ok: boolean; name?: string; error?: string }> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) {
    return { ok: false, error: 'Trình duyệt này không hỗ trợ WebSerial (hãy dùng Chrome hoặc Edge trên máy POS).' }
  }
  try {
    await (navigator as any).serial.requestPort()
    return { ok: true, name: 'Cổng COM / Bluetooth SPP' }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Đã hủy chọn cổng COM Serial' }
  }
}

async function sendViaWebUsb(encoded: Uint8Array): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) return false
  try {
    const usb = (navigator as any).usb
    const devices = await usb.getDevices()
    if (!devices || devices.length === 0) return false
    const device = devices[0]
    await device.open()
    if (device.configuration === null) await device.selectConfiguration(1)
    await device.claimInterface(0)
    const endpoint = device.configuration?.interfaces?.[0]?.alternate?.endpoints?.find(
      (ep: any) => ep.direction === 'out'
    )
    const endpointNumber = endpoint?.endpointNumber ?? 1
    await device.transferOut(endpointNumber, encoded)
    return true
  } catch (err) {
    console.warn('WebUSB printing unavailable:', err)
    return false
  }
}

async function sendViaWebSerial(encoded: Uint8Array, baudRate = 9600): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return false
  try {
    const serial = (navigator as any).serial
    const ports = await serial.getPorts()
    if (!ports || ports.length === 0) return false
    const port = ports[0]
    await port.open({ baudRate })
    const writer = port.writable.getWriter()
    await writer.write(encoded)
    writer.releaseLock()
    await port.close()
    return true
  } catch (err) {
    console.warn('WebSerial printing unavailable:', err)
    return false
  }
}

async function sendViaLanTcp(
  encoded: Uint8Array,
  host: string,
  port: number
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/peripherals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RAW_TCP_PRINT',
        host,
        port,
        payloadBase64: uint8ToBase64(encoded),
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    return { ok: Boolean(res.ok && data.ok), error: data.error }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Không kết nối được máy in LAN :9100' }
  }
}

async function sendViaWindowsSpooler(input: {
  printerName?: string
  jobType: 'POS_RECEIPT' | 'SHOPEE_SLIP' | 'SHOPEE_BATCH_SLIPS'
  paperSize: ThermalPaperSize
  shopeeFormat: ShopeePrintFormat
  rawEscPos?: boolean
  payloadBase64?: string
  receipt?: ReceiptOrder | Record<string, any>
  slip?: ShopeeThermalSlipInput
  slips?: ShopeeThermalSlipInput[]
}): Promise<{ ok: boolean; printerName?: string; mode?: string; error?: string }> {
  try {
    const isAutomatedWebdriver =
      typeof navigator !== 'undefined' &&
      Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver)
    const res = await fetch('/api/peripherals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'WINDOWS_SPOOLER_PRINT',
        printerName: input.printerName || 'AUTO_PHYSICAL',
        jobType: input.jobType,
        paperSize: input.paperSize,
        shopeeFormat: input.shopeeFormat,
        rawEscPos: Boolean(input.rawEscPos),
        payloadBase64: input.payloadBase64,
        receipt: input.receipt,
        slip: input.slip,
        slips: input.slips,
        // An toàn phần cứng: trình duyệt kiểm thử tự động (WebDriver) chạy chế độ render GDI+ Dry-Run, không làm tốn giấy/mực thật
        dryRun: isAutomatedWebdriver,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      printerName?: string
      mode?: string
      error?: string
    }
    if (res.ok && data.ok) {
      return { ok: true, printerName: data.printerName, mode: data.mode }
    }
    return { ok: false, error: data.error || 'Windows Spooler không sẵn sàng' }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Không kết nối được dịch vụ in ngầm Windows' }
  }
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatVndVi(n: unknown): string {
  return `${Math.round(Number(n) || 0).toLocaleString('vi-VN')}đ`
}

/** Sinh HTML cô lập chuẩn khổ K80 / K58 cho trình duyệt dự phòng (không phụ thuộc Radix Dialog đang mở) */
export function renderReceiptPrintHtml(
  order: ReceiptOrder | Record<string, any>,
  paperSize: ThermalPaperSize = 'K80'
): string {
  const widthMm = paperSize === 'K58' ? '58mm' : '80mm'
  const code = String(order.code || 'POS-ORDER')
  const svgBarcode = barcodeSvg(code, { height: 34, moduleWidth: 1.6, showText: true, quietZone: 6 })
  const dateStr = order.createdAt
    ? new Date(order.createdAt).toLocaleString('vi-VN')
    : new Date().toLocaleString('vi-VN')
  const custName = order.customerName || order.customer?.name || 'Khách lẻ tại kho'
  const custPhone = order.customerPhone || order.customer?.phone || ''
  const items = Array.isArray(order.items) ? order.items : []

  const itemRows = items
    .map((it: any) => {
      const name = it.name || it.product?.name || 'Sản phẩm'
      const sku = it.sku || it.product?.sku || ''
      const qty = Number(it.quantity) || 1
      const price = Number(it.price) || 0
      const amt = it.amount ?? qty * price
      return `<div style="padding:3px 0;border-bottom:1px dashed #ccc;">
        <div style="font-weight:700;">${escapeHtml(sku ? `[${sku}] ${name}` : name)}</div>
        <div style="display:flex;justify-content:space-between;font-size:11px;">
          <span>${qty} x ${escapeHtml(formatVndVi(price))}</span>
          <strong>${escapeHtml(formatVndVi(amt))}</strong>
        </div>
      </div>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"/><title>POS ${escapeHtml(code)}</title>
  <style>
    @page { size: ${widthMm} auto; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 3mm; width: ${widthMm}; font-family: 'Segoe UI', Arial, sans-serif; font-size: 11.5px; line-height: 1.35; color: #000; background: #fff; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    svg { max-width: 100%; height: auto; }
  </style></head><body>
    <div style="text-align:center;border-bottom:1.5px solid #000;padding-bottom:4px;">
      <div style="font-size:14px;font-weight:800;">CỬA HÀNG &amp; KHO ƯU ĐÀM</div>
      <div style="font-size:10px;">Shop: thaimy1605 (#197195817)</div>
      <div style="font-weight:700;margin-top:2px;">HÓA ĐƠN BÁN LẺ POS (${paperSize})</div>
    </div>
    <div style="text-align:center;padding:5px 0;border-bottom:1px dashed #000;">${svgBarcode}</div>
    <div style="padding:4px 0;border-bottom:1px solid #000;font-size:11px;">
      <div class="row"><span>Mã đơn:</span><strong>${escapeHtml(code)}</strong></div>
      ${order.invoiceCode ? `<div class="row"><span>Chứng từ XK:</span><span>${escapeHtml(order.invoiceCode)}</span></div>` : ''}
      <div class="row"><span>Thời gian:</span><span>${escapeHtml(dateStr)}</span></div>
      <div class="row"><span>Khách hàng:</span><span>${escapeHtml(custName)}</span></div>
      ${custPhone ? `<div class="row"><span>Điện thoại:</span><span>${escapeHtml(custPhone)}</span></div>` : ''}
    </div>
    <div>${itemRows}</div>
    <div style="padding-top:5px;border-top:1.5px solid #000;">
      <div class="row" style="font-size:13px;font-weight:800;"><span>TỔNG CỘNG:</span><span>${escapeHtml(formatVndVi(order.total))}</span></div>
      ${order.paymentMethod ? `<div class="row"><span>Thanh toán:</span><span>${escapeHtml(order.paymentMethod)}</span></div>` : ''}
      ${Number(order.cashReceived) > 0 ? `<div class="row"><span>Khách đưa:</span><span>${escapeHtml(formatVndVi(order.cashReceived))}</span></div>` : ''}
      ${Number(order.changeDue) > 0 ? `<div class="row" style="font-weight:700;"><span>Tiền thừa:</span><span>${escapeHtml(formatVndVi(order.changeDue))}</span></div>` : ''}
    </div>
    <div style="text-align:center;margin-top:8px;font-size:10px;border-top:1px dashed #000;padding-top:4px;">
      Cảm ơn Quý khách &amp; Hẹn gặp lại!
    </div>
  </body></html>`
}

/** Sinh HTML cô lập cho 1 hoặc nhiều Tem Vận Đơn Shopee A6 (105×148mm) / K80 */
export function renderShopeeSlipPrintHtml(
  slips: ShopeeThermalSlipInput[],
  shopeeFormat: ShopeePrintFormat = 'A6_LABEL',
  paperSize: ThermalPaperSize = 'K80'
): string {
  const isA6 = shopeeFormat === 'A6_LABEL'
  const pageSize = isA6 ? '105mm 148mm' : paperSize === 'K58' ? '58mm auto' : '80mm auto'
  const widthCss = isA6 ? '105mm' : paperSize === 'K58' ? '58mm' : '80mm'

  const pagesHtml = slips
    .map((slip, idx) => {
      const tracking = slip.trackingCode || slip.orderCode
      const svgBc = barcodeSvg(tracking, { height: 42, moduleWidth: 1.8, showText: true, quietZone: 6 })
      const itemsHtml = (slip.items || [])
        .map(
          (it) =>
            `<div style="display:flex;justify-content:space-between;gap:6px;padding:2px 0;border-bottom:1px dashed #ddd;">
              <span><strong>[${escapeHtml(it.sku)}]</strong> ${escapeHtml(it.name)}${it.fragile ? ' <b>[Dễ vỡ]</b>' : ''}</span>
              <strong style="white-space:nowrap;">x${Number(it.quantity) || 1}</strong>
            </div>`
        )
        .join('')

      return `<div class="slip-page" style="${idx < slips.length - 1 ? 'page-break-after:always;break-after:page;' : ''}">
        <div style="border:2px solid #000;padding:2.5mm;${isA6 ? 'min-height:142mm;' : ''}display:flex;flex-direction:column;justify-content:space-between;">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:4px;">
              <div style="font-size:13px;font-weight:900;text-transform:uppercase;">SHOPEE · ${escapeHtml(slip.carrier || 'SPX Express')}</div>
              <div style="border:1.5px solid #000;padding:1px 5px;font-size:10px;font-weight:800;">
                ${slip.codAmount > 0 ? 'COD THU HỘ' : 'ĐÃ THANH TOÁN'}
              </div>
            </div>
            <div style="text-align:center;padding:5px 0;border-bottom:1px dashed #000;">
              ${svgBc}
              <div style="font-size:10px;margin-top:2px;">Đơn CMS: <strong>${escapeHtml(slip.orderCode)}</strong>${slip.shopeeOrderSn ? ` · Shopee #${escapeHtml(slip.shopeeOrderSn)}` : ''}</div>
            </div>
            <div style="padding:4px 0;border-bottom:1.5px solid #000;font-size:11px;">
              <div style="font-weight:800;text-transform:uppercase;">NGƯỜI NHẬN: ${escapeHtml(slip.recipient?.name || 'Khách Shopee')}</div>
              <div>SĐT: <strong>${escapeHtml(slip.recipient?.phone || 'Che bảo mật trên Sàn')}</strong></div>
              <div>Đ/C: ${escapeHtml(slip.recipient?.address || 'Giao qua ĐVVC Shopee')}</div>
            </div>
            ${
              slip.hasFragile
                ? `<div style="margin:5px 0;border:2px solid #000;padding:3px;text-align:center;font-weight:900;font-size:11px;">HÀNG DỄ VỠ (THẠCH CAO / GỐM) — XIN NHẸ TAY</div>`
                : ''
            }
            <div style="padding:4px 0;font-size:10.5px;">
              <div style="font-weight:800;margin-bottom:2px;">Danh sách đóng gói (${(slip.items || []).length} mã):</div>
              ${itemsHtml}
            </div>
          </div>
          <div style="border-top:2px solid #000;padding-top:4px;">
            <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:900;">
              <span>TIỀN THU HỘ (COD):</span>
              <span>${escapeHtml(formatVndVi(slip.codAmount))}</span>
            </div>
            <div style="font-size:9.5px;text-align:center;margin-top:3px;">Shop thaimy1605 · OPENVN Auto-Print Suite</div>
          </div>
        </div>
      </div>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Shopee Print</title>
  <style>
    @page { size: ${pageSize}; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 2mm; width: ${widthCss}; font-family: 'Segoe UI', Arial, sans-serif; color: #000; background: #fff; }
    svg { max-width: 100%; height: auto; }
  </style></head><body>${pagesHtml}</body></html>`
}

/** In HTML qua Iframe ẩn cô lập hoàn toàn — không xung đột Radix Dialog, không in trang trắng */
export function printHtmlViaCleanIframe(html: string): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  const isAutomatedWebdriver =
    typeof navigator !== 'undefined' &&
    Boolean((navigator as Navigator & { webdriver?: boolean }).webdriver)
  if (isAutomatedWebdriver) {
    return true
  }

  try {
    const existing = document.getElementById('openvn-clean-print-iframe')
    if (existing) existing.remove()

    const iframe = document.createElement('iframe')
    iframe.id = 'openvn-clean-print-iframe'
    iframe.setAttribute('aria-hidden', 'true')
    iframe.style.cssText =
      'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;z-index:-1;'
    document.body.appendChild(iframe)

    const win = iframe.contentWindow
    const doc = iframe.contentDocument || win?.document
    if (!win || !doc) {
      iframe.remove()
      return false
    }

    doc.open()
    doc.write(html)
    doc.close()

    const cleanup = () => {
      setTimeout(() => {
        try {
          iframe.remove()
        } catch {
          // ignore
        }
      }, 1500)
    }

    win.onafterprint = cleanup
    setTimeout(() => {
      try {
        win.focus()
        win.print()
      } finally {
        setTimeout(cleanup, 15_000)
      }
    }, 80)
    return true
  } catch {
    return false
  }
}

export type PrintExecutionMethod =
  | 'windows_spooler'
  | 'lan_tcp'
  | 'webusb'
  | 'webserial'
  | 'window.print'

/**
 * Gửi mảng byte ESC/POS qua cổng phần cứng đang cấu hình (LAN TCP :9100 / WebUSB / WebSerial)
 * hoặc gọi callback in trình duyệt (@media print K80 / A6).
 */
export async function printThermalBytes(
  encoded: Uint8Array,
  options?: {
    config?: PeripheralPrinterConfig
    fallbackToWindowPrint?: boolean
    onWindowPrint?: () => void
  }
): Promise<{
  success: boolean
  method: PrintExecutionMethod
  printerName?: string
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  const fallback = options?.fallbackToWindowPrint ?? true

  // 1. Nếu chỉ định rõ LAN TCP :9100
  if (cfg.transport === 'lan_tcp') {
    const tcp = await sendViaLanTcp(encoded, cfg.lanHost, cfg.lanPort)
    if (tcp.ok) return { success: true, method: 'lan_tcp' }
    if (!fallback) return { success: false, method: 'lan_tcp', error: tcp.error }
  }

  // 2. WebUSB (khi chọn 'webusb' hoặc 'auto')
  if (cfg.transport === 'webusb' || cfg.transport === 'auto') {
    const okUsb = await sendViaWebUsb(encoded)
    if (okUsb) return { success: true, method: 'webusb' }
    if (cfg.transport === 'webusb' && !fallback) {
      return { success: false, method: 'webusb', error: 'Chưa ghép nối máy in USB' }
    }
  }

  // 3. WebSerial (khi chọn 'webserial' hoặc 'auto')
  if (cfg.transport === 'webserial' || cfg.transport === 'auto') {
    const okSerial = await sendViaWebSerial(encoded, cfg.serialBaudRate)
    if (okSerial) return { success: true, method: 'webserial' }
    if (cfg.transport === 'webserial' && !fallback) {
      return { success: false, method: 'webserial', error: 'Chưa ghép nối cổng COM Serial' }
    }
  }

  // 4. Fallback sang trình duyệt (@media print K80 / A6)
  if (fallback && typeof window !== 'undefined') {
    try {
      if (options?.onWindowPrint) {
        options.onWindowPrint()
      } else {
        window.print()
      }
      return { success: true, method: 'window.print' }
    } catch (printErr: any) {
      return { success: false, method: 'window.print', error: printErr?.message }
    }
  }

  return { success: false, method: 'window.print', error: 'No printable device or window context' }
}

/**
 * In tự động Hóa đơn POS:
 * Ưu tiên: WebUSB/WebSerial đã ghép -> Windows Spooler In Ngầm 100% (0 hộp thoại) -> LAN :9100 -> Clean Iframe Print.
 */
export async function printReceipt(
  order: ReceiptOrder | Record<string, any>,
  options?: {
    fallbackToWindowPrint?: boolean
    config?: PeripheralPrinterConfig
    onWindowPrint?: () => void
  }
): Promise<{
  success: boolean
  method: PrintExecutionMethod
  printerName?: string
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  const fallback = options?.fallbackToWindowPrint ?? true
  const encoded = encodeReceipt(order, {
    paperSize: cfg.paperSize,
    openCashDrawer: String(order?.paymentMethod || '').toUpperCase() === 'CASH',
  })

  // A. Nếu người dùng chọn tường minh Windows Spooler hoặc chế độ Tự động thông minh ('auto')
  if (cfg.transport === 'windows_spooler' || cfg.transport === 'auto') {
    if (cfg.transport === 'auto') {
      const okUsb = await sendViaWebUsb(encoded)
      if (okUsb) return { success: true, method: 'webusb' }
      const okSerial = await sendViaWebSerial(encoded, cfg.serialBaudRate)
      if (okSerial) return { success: true, method: 'webserial' }
    }

    const winRes = await sendViaWindowsSpooler({
      printerName: cfg.windowsPrinterName || 'AUTO_PHYSICAL',
      jobType: 'POS_RECEIPT',
      paperSize: cfg.paperSize,
      shopeeFormat: cfg.shopeeFormat,
      rawEscPos: cfg.rawEscPosOnWindows,
      payloadBase64: cfg.rawEscPosOnWindows ? uint8ToBase64(encoded) : undefined,
      receipt: order,
    })
    if (winRes.ok) {
      return {
        success: true,
        method: 'windows_spooler',
        printerName: winRes.printerName,
      }
    }
    if (cfg.transport === 'windows_spooler' && !fallback) {
      return { success: false, method: 'windows_spooler', error: winRes.error }
    }
  }

  // B. Nếu chọn in trình duyệt hoặc các cổng phần cứng khác cần fallback sạch qua Iframe
  if (cfg.transport === 'browser_print') {
    const html = renderReceiptPrintHtml(order, cfg.paperSize)
    if (printHtmlViaCleanIframe(html)) {
      return { success: true, method: 'window.print' }
    }
  }

  return printThermalBytes(encoded, {
    config: cfg,
    fallbackToWindowPrint: fallback,
    onWindowPrint: () => {
      const html = renderReceiptPrintHtml(order, cfg.paperSize)
      if (!printHtmlViaCleanIframe(html)) {
        if (options?.onWindowPrint) options.onWindowPrint()
        else if (typeof window !== 'undefined') window.print()
      }
    },
  })
}

/**
 * In tự động Đơn hàng / Vận đơn Shopee:
 * Ưu tiên: Windows Spooler In Ngầm 100% (Tem A6 có mã vạch CODE128 hoặc K80) -> LAN/USB/COM -> Clean Iframe Print.
 */
export async function printShopeeOrderSlip(
  slip: ShopeeThermalSlipInput,
  options?: {
    config?: PeripheralPrinterConfig
    fallbackToWindowPrint?: boolean
    onWindowPrint?: () => void
  }
): Promise<{
  success: boolean
  method: PrintExecutionMethod
  printerName?: string
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  const fallback = options?.fallbackToWindowPrint ?? true
  const encoded = encodeShopeeSlip(slip, { paperSize: cfg.paperSize })

  if (cfg.transport === 'windows_spooler' || cfg.transport === 'auto') {
    if (cfg.transport === 'auto' && cfg.shopeeFormat === 'THERMAL_K80') {
      const okUsb = await sendViaWebUsb(encoded)
      if (okUsb) return { success: true, method: 'webusb' }
      const okSerial = await sendViaWebSerial(encoded, cfg.serialBaudRate)
      if (okSerial) return { success: true, method: 'webserial' }
    }

    const useRawOnWin = cfg.rawEscPosOnWindows && cfg.shopeeFormat === 'THERMAL_K80'
    const winRes = await sendViaWindowsSpooler({
      printerName: cfg.windowsPrinterName || 'AUTO_PHYSICAL',
      jobType: 'SHOPEE_SLIP',
      paperSize: cfg.paperSize,
      shopeeFormat: cfg.shopeeFormat,
      rawEscPos: useRawOnWin,
      payloadBase64: useRawOnWin ? uint8ToBase64(encoded) : undefined,
      slip,
    })
    if (winRes.ok) {
      return {
        success: true,
        method: 'windows_spooler',
        printerName: winRes.printerName,
      }
    }
    if (cfg.transport === 'windows_spooler' && !fallback) {
      return { success: false, method: 'windows_spooler', error: winRes.error }
    }
  }

  if (cfg.transport === 'browser_print') {
    const html = renderShopeeSlipPrintHtml([slip], cfg.shopeeFormat, cfg.paperSize)
    if (printHtmlViaCleanIframe(html)) {
      return { success: true, method: 'window.print' }
    }
  }

  return printThermalBytes(encoded, {
    config: cfg,
    fallbackToWindowPrint: fallback,
    onWindowPrint: () => {
      const html = renderShopeeSlipPrintHtml([slip], cfg.shopeeFormat, cfg.paperSize)
      if (!printHtmlViaCleanIframe(html)) {
        if (options?.onWindowPrint) options.onWindowPrint()
        else if (typeof window !== 'undefined') window.print()
      }
    },
  })
}

/** In hàng loạt nhiều phiếu giao hàng A6 / Shopee ngầm qua Windows Spooler (hoặc fallback Iframe sạch) */
export async function printShopeeBatchSlips(
  slips: ShopeeThermalSlipInput[],
  options?: {
    config?: PeripheralPrinterConfig
    printerNameOverride?: string
    forceBrowserDialog?: boolean
  }
): Promise<{
  success: boolean
  method: PrintExecutionMethod
  printerName?: string
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  if (!options?.forceBrowserDialog && cfg.transport !== 'browser_print') {
    const winRes = await sendViaWindowsSpooler({
      printerName: options?.printerNameOverride || cfg.windowsPrinterName || 'AUTO_PHYSICAL',
      jobType: 'SHOPEE_BATCH_SLIPS',
      paperSize: cfg.paperSize,
      shopeeFormat: 'A6_LABEL',
      slips,
    })
    if (winRes.ok) {
      return {
        success: true,
        method: 'windows_spooler',
        printerName: winRes.printerName,
      }
    }
  }

  const html = renderShopeeSlipPrintHtml(slips, 'A6_LABEL', cfg.paperSize)
  if (printHtmlViaCleanIframe(html)) {
    return { success: true, method: 'window.print' }
  }
  return { success: false, method: 'window.print', error: 'Không thể mở khung in phiếu giao hàng' }
}
