/**
 * ESC/POS Thermal Receipt & Shopee Shipping Label Driver
 * Hỗ trợ:
 *  1. Máy in nhiệt mạng LAN / Wi-Fi RAW TCP :9100 (Xprinter, Zywell, HPRT, Epson) qua /api/peripherals
 *  2. Máy in nhiệt cáp USB trực tiếp (WebUSB API — requestDevice + transferOut)
 *  3. Máy in nhiệt cổng COM / Bluetooth SPP (WebSerial API — requestPort + writable)
 *  4. In trình duyệt chuẩn khổ K80 (80mm), K58 (58mm) và Tem vận đơn Shopee A6 (105×148mm)
 *
 * Lệnh chuẩn ESC/POS:
 *  - Khởi tạo: ESC @ (0x1B 0x40)
 *  - Cắt giấy: GS V (0x1D 0x56 0x00)
 */

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

export type ThermalTransportMode = 'auto' | 'lan_tcp' | 'webusb' | 'webserial' | 'browser_print'
export type ThermalPaperSize = 'K80' | 'K58'
export type ShopeePrintFormat = 'A6_LABEL' | 'THERMAL_K80'

export interface PeripheralPrinterConfig {
  transport: ThermalTransportMode
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
  paperSize: 'K80',
  shopeeFormat: 'A6_LABEL',
  lanHost: '192.168.1.200',
  lanPort: 9100,
  serialBaudRate: 9600,
  autoPrintPosBill: true,
  autoPrintShopeeOrder: false,
  soundEnabled: true,
}

const PRINTER_CFG_STORAGE_KEY = 'openvn_pos_printer_cfg_v1'

export function loadPrinterConfig(): PeripheralPrinterConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_PRINTER_CONFIG }
  try {
    const raw = window.localStorage.getItem(PRINTER_CFG_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_PRINTER_CONFIG }
    const parsed = JSON.parse(raw) as Partial<PeripheralPrinterConfig>
    return {
      transport:
        parsed.transport && ['auto', 'lan_tcp', 'webusb', 'webserial', 'browser_print'].includes(parsed.transport)
          ? parsed.transport
          : DEFAULT_PRINTER_CONFIG.transport,
      paperSize: parsed.paperSize === 'K58' ? 'K58' : 'K80',
      shopeeFormat: parsed.shopeeFormat === 'THERMAL_K80' ? 'THERMAL_K80' : 'A6_LABEL',
      lanHost: typeof parsed.lanHost === 'string' && parsed.lanHost.trim() ? parsed.lanHost.trim() : '192.168.1.200',
      lanPort: Number.isFinite(Number(parsed.lanPort)) && Number(parsed.lanPort) >= 1024 ? Number(parsed.lanPort) : 9100,
      serialBaudRate:
        Number.isFinite(Number(parsed.serialBaudRate)) && Number(parsed.serialBaudRate) >= 2400
          ? Number(parsed.serialBaudRate)
          : 9600,
      autoPrintPosBill: parsed.autoPrintPosBill ?? true,
      autoPrintShopeeOrder: parsed.autoPrintShopeeOrder ?? false,
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
  method: 'lan_tcp' | 'webusb' | 'webserial' | 'window.print'
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
 * In trực tiếp Hóa đơn POS qua LAN/WebUSB/WebSerial; tự động fallback sang window.print().
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
  method: 'lan_tcp' | 'webusb' | 'webserial' | 'window.print'
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  const encoded = encodeReceipt(order, {
    paperSize: cfg.paperSize,
    openCashDrawer: String(order?.paymentMethod || '').toUpperCase() === 'CASH',
  })
  return printThermalBytes(encoded, {
    config: cfg,
    fallbackToWindowPrint: options?.fallbackToWindowPrint ?? true,
    onWindowPrint: options?.onWindowPrint,
  })
}

/**
 * In trực tiếp Đơn hàng / Vận đơn Shopee qua LAN/WebUSB/WebSerial hoặc Tem A6.
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
  method: 'lan_tcp' | 'webusb' | 'webserial' | 'window.print'
  error?: string
}> {
  const cfg = options?.config ?? loadPrinterConfig()
  // Nếu chọn khổ A6_LABEL và không ép cổng phần cứng ESC/POS cuộn K80, ưu tiên in sheet A6 chuẩn vận đơn
  if (cfg.shopeeFormat === 'A6_LABEL' && (cfg.transport === 'browser_print' || cfg.transport === 'auto')) {
    const hw = await listPairedHardwareDevices()
    if (cfg.transport === 'browser_print' || (hw.usbPrinters.length === 0 && hw.serialPortsCount === 0)) {
      if (typeof window !== 'undefined') {
        if (options?.onWindowPrint) options.onWindowPrint()
        else window.print()
        return { success: true, method: 'window.print' }
      }
    }
  }

  const encoded = encodeShopeeSlip(slip, { paperSize: cfg.paperSize })
  return printThermalBytes(encoded, {
    config: cfg,
    fallbackToWindowPrint: options?.fallbackToWindowPrint ?? true,
    onWindowPrint: options?.onWindowPrint,
  })
}
