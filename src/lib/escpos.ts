/**
 * ESC/POS K80 Thermal Receipt Encoder & WebUSB/WebSerial Driver with window.print() Fallback
 * Hỗ trợ máy in nhiệt khổ K80 (80mm, 48 cột ký tự).
 * Lệnh chuẩn:
 *  - Khởi tạo: ESC @ (0x1B 0x40)
 *  - Cắt giấy: GS V (0x1D 0x56 0x00)
 */

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  amount?: number
}

export interface ReceiptOrder {
  code: string
  createdAt?: string | Date
  customerName?: string
  customerPhone?: string
  items: ReceiptItem[]
  subtotal?: number
  discountAmount?: number
  shippingFee?: number
  total: number
  paymentMethod?: string
  cashReceived?: number
  changeDue?: number
}

// Byte commands
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a

export const ESC_POS_COMMANDS = {
  INIT: [ESC, 0x40], // ESC @ — Khởi tạo máy in
  CUT_FULL: [GS, 0x56, 0x00], // GS V 0 — Cắt giấy toàn phần
  CUT_PARTIAL: [GS, 0x56, 0x01], // GS V 1 — Cắt giấy một phần
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

/** Chuyển tiếng Việt có dấu thành chuỗi không dấu an toàn cho máy in nhiệt thuần ASCII */
export function removeVietnameseDiacritics(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
}

/** Căn 2 cột trái - phải trên dòng K80 (độ rộng 48 ký tự) */
function formatTwoColumns(left: string, right: string, width = 48): string {
  const cleanLeft = left.trim()
  const cleanRight = right.trim()
  const spaceNeeded = width - cleanLeft.length - cleanRight.length
  if (spaceNeeded <= 0) {
    return `${cleanLeft}\n${cleanRight.padStart(width, ' ')}`
  }
  return `${cleanLeft}${' '.repeat(spaceNeeded)}${cleanRight}`
}

function formatVndNumber(n: number): string {
  return `${Math.round(n).toLocaleString('vi-VN')}d`
}

/**
 * Mã hóa đơn hàng thành mảng byte ESC/POS K80
 */
export function encodeReceipt(order: ReceiptOrder | any): Uint8Array {
  const bytes: number[] = []

  const append = (...arr: number[]) => {
    bytes.push(...arr)
  }

  const appendText = (text: string) => {
    const encoder = new TextEncoder()
    const raw = encoder.encode(text)
    for (const b of raw) {
      bytes.push(b)
    }
  }

  const appendLine = (text = '') => {
    if (text) appendText(text)
    append(LF)
  }

  // 1. Khởi tạo máy in (ESC @)
  append(...ESC_POS_COMMANDS.INIT)

  // 2. Tiêu đề cửa hàng (Căn giữa, In đậm, Double Size)
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE)
  appendLine('UU DAM SUITE')
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  append(...ESC_POS_COMMANDS.BOLD_OFF)
  appendLine('KHO HANG & BAN LE OPENVN')
  appendLine('Hotline: 0988.xxx.xxx - uudamsuite.vn')
  appendLine('------------------------------------------------')

  // 3. Thông tin đơn hàng (Căn trái)
  append(...ESC_POS_COMMANDS.ALIGN_LEFT)
  append(...ESC_POS_COMMANDS.BOLD_ON)
  appendLine(`PHIEU BAN HANG TAI KHO: ${order.code || 'POS-ORDER'}`)
  append(...ESC_POS_COMMANDS.BOLD_OFF)

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
  if (order.customerName) {
    appendLine(`Khach hang: ${order.customerName}`)
  }
  if (order.customerPhone) {
    appendLine(`Dien thoai: ${order.customerPhone}`)
  }
  appendLine('================================================')

  // 4. Bảng sản phẩm
  appendLine(formatTwoColumns('Mat hang / Don gia', 'Thanh tien'))
  appendLine('------------------------------------------------')

  const items = Array.isArray(order.items) ? order.items : []
  for (const it of items) {
    const name = it.name || it.product?.name || 'San pham'
    const qty = it.quantity || 1
    const price = it.price || 0
    const amt = it.amount ?? qty * price

    append(...ESC_POS_COMMANDS.BOLD_ON)
    appendLine(name)
    append(...ESC_POS_COMMANDS.BOLD_OFF)
    appendLine(
      formatTwoColumns(
        `  ${qty} x ${formatVndNumber(price)}`,
        formatVndNumber(amt)
      )
    )
  }

  appendLine('================================================')

  // 5. Tổng kết thanh toán
  if (order.subtotal && order.subtotal !== order.total) {
    appendLine(formatTwoColumns('Tam tinh:', formatVndNumber(order.subtotal)))
  }
  if (order.discountAmount && order.discountAmount > 0) {
    appendLine(formatTwoColumns('Chiet khau/Voucher:', `-${formatVndNumber(order.discountAmount)}`))
  }
  if (order.shippingFee && order.shippingFee > 0) {
    appendLine(formatTwoColumns('Phi van chuyen:', formatVndNumber(order.shippingFee)))
  }

  append(...ESC_POS_COMMANDS.BOLD_ON)
  append(...ESC_POS_COMMANDS.TEXT_DOUBLE_HEIGHT)
  appendLine(formatTwoColumns('TONG TIEN:', formatVndNumber(order.total || 0)))
  append(...ESC_POS_COMMANDS.TEXT_NORMAL)
  append(...ESC_POS_COMMANDS.BOLD_OFF)

  if (order.paymentMethod) {
    appendLine(formatTwoColumns('Hinh thuc TT:', String(order.paymentMethod)))
  }
  if (order.cashReceived != null && order.cashReceived > 0) {
    appendLine(formatTwoColumns('Tien khach dua:', formatVndNumber(order.cashReceived)))
  }
  if (order.changeDue != null && order.changeDue > 0) {
    appendLine(formatTwoColumns('Tien thua tra:', formatVndNumber(order.changeDue)))
  }

  // 6. Lời cảm ơn (Căn giữa)
  appendLine('------------------------------------------------')
  append(...ESC_POS_COMMANDS.ALIGN_CENTER)
  appendLine('Cam on Quy khach & Hen gap lai!')
  appendLine('Kiem tra hang hoa & hoa don truoc khi roi quay')

  // 7. Feed 4 dòng và cắt giấy (GS V 0)
  append(LF, LF, LF, LF)
  append(...ESC_POS_COMMANDS.CUT_FULL)

  return new Uint8Array(bytes)
}

/**
 * In trực tiếp qua WebUSB hoặc WebSerial; tự động fallback sang window.print() khi không hỗ trợ.
 */
export async function printReceipt(
  order: ReceiptOrder | any,
  options?: { fallbackToWindowPrint?: boolean }
): Promise<{ success: boolean; method: 'webusb' | 'webserial' | 'window.print'; error?: string }> {
  const fallback = options?.fallbackToWindowPrint ?? true
  const encoded = encodeReceipt(order)

  // 1. Thử WebUSB nếu trình duyệt hỗ trợ
  if (typeof navigator !== 'undefined' && 'usb' in navigator) {
    try {
      const usb = (navigator as any).usb
      const devices = await usb.getDevices()
      if (devices.length > 0) {
        const device = devices[0]
        await device.open()
        if (device.configuration === null) await device.selectConfiguration(1)
        await device.claimInterface(0)
        // Tìm endpoint OUT
        const endpoint = device.configuration?.interfaces?.[0]?.alternate?.endpoints?.find(
          (ep: any) => ep.direction === 'out'
        )
        const endpointNumber = endpoint?.endpointNumber ?? 1
        await device.transferOut(endpointNumber, encoded)
        return { success: true, method: 'webusb' }
      }
    } catch (usbErr) {
      console.warn('WebUSB printing unavailable:', usbErr)
    }
  }

  // 2. Thử WebSerial nếu trình duyệt hỗ trợ
  if (typeof navigator !== 'undefined' && 'serial' in navigator) {
    try {
      const serial = (navigator as any).serial
      const ports = await serial.getPorts()
      if (ports.length > 0) {
        const port = ports[0]
        await port.open({ baudRate: 9600 })
        const writer = port.writable.getWriter()
        await writer.write(encoded)
        writer.releaseLock()
        await port.close()
        return { success: true, method: 'webserial' }
      }
    } catch (serialErr) {
      console.warn('WebSerial printing unavailable:', serialErr)
    }
  }

  // 3. Fallback sang window.print()
  if (fallback && typeof window !== 'undefined') {
    try {
      window.print()
      return { success: true, method: 'window.print' }
    } catch (printErr: any) {
      return { success: false, method: 'window.print', error: printErr?.message }
    }
  }

  return { success: false, method: 'window.print', error: 'No printable device or window context' }
}
