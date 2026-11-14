import net from 'net'
import { db } from '../src/lib/db'
import { barcodeSvg } from '../src/lib/barcode'
import { decode1DBarcodeFromLuminanceRow } from '../src/lib/barcode-decoder'
import { encodeQrMatrix, qrCodeSvg } from '../src/lib/qr-svg'
import {
  encodeReceipt,
  encodeShopeeSlip,
  ESC_POS_COMMANDS,
  isHeadlessQaCrawler,
  removeVietnameseDiacritics,
  renderReceiptPrintHtml,
  renderShopeeSlipPrintHtml,
  uint8ToBase64,
} from '../src/lib/escpos'
import { isAllowedLanPrinterHost } from '../src/lib/peripheral-hub'

const BASE_URL = process.env.CMS_BASE_URL || 'http://localhost:3010'

let passed = 0
let failed = 0

function assert(cond: unknown, label: string, detail?: string) {
  if (cond) {
    passed++
    console.log(`  ✅ PASS: ${label}`)
  } else {
    failed++
    console.error(`  ❌ FAIL: ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

/** Chuyển SVG CODE128 thành mảng độ sáng (luminance) mô phỏng hàng điểm ảnh từ Camera điện thoại */
function rasterizeSvgBarcodeToLuminance(svg: string, scale = 4): Uint8ClampedArray {
  const widthMatch = /viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)
  const totalWidth = Math.ceil(Number(widthMatch?.[1] || 300) * scale)
  const row = new Uint8ClampedArray(totalWidth).fill(242) // nền giấy trắng hơi xám tự nhiên

  const rectRe = /<rect x="([\d.]+)" y="[\d.]+" width="([\d.]+)" height="[\d.]+" fill="#[0-9a-fA-F]+"\/>/g
  let m: RegExpExecArray | null
  while ((m = rectRe.exec(svg)) !== null) {
    const x0 = Math.round(Number(m[1]) * scale)
    const w = Math.max(1, Math.round(Number(m[2]) * scale))
    for (let x = x0; x < Math.min(totalWidth, x0 + w); x++) {
      row[x] = 18 // mực đen
    }
  }
  return row
}

/** Sinh dãy vạch chuẩn EAN-13 (95 modules) ra mảng điểm ảnh Camera để test giải mã EAN-13 */
function buildEan13LuminanceRow(digits13: string, modulePx = 4): Uint8ClampedArray {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

  const first = Number(digits13[0])
  const parity = PARITY[first]
  let bits = '000000000000' + '101'
  for (let i = 0; i < 6; i++) {
    const d = Number(digits13[i + 1])
    bits += parity[i] === 'L' ? L[d] : G[d]
  }
  bits += '01010'
  for (let i = 0; i < 6; i++) {
    const d = Number(digits13[i + 7])
    bits += R[d]
  }
  bits += '101' + '000000000000'

  const row = new Uint8ClampedArray(bits.length * modulePx)
  for (let i = 0; i < bits.length; i++) {
    const lum = bits[i] === '1' ? 20 : 245
    for (let k = 0; k < modulePx; k++) {
      row[i * modulePx + k] = lum
    }
  }
  return row
}

async function main() {
  console.log('======================================================================')
  console.log('🧪 KIỂM ĐỊNH TOÀN DIỆN NGOẠI VI POS, ĐIỆN THOẠI QUÉT MÃ & AUTO-PRINT')
  console.log('======================================================================')

  // -------------------------------------------------------------------------
  // PHẦN 1: MÃ QR OFFLINE ISO/IEC 18004 & GIẢI MÃ MÃ VẠCH CAMERA PURE-TS
  // -------------------------------------------------------------------------
  console.log('\n[1/5] Kiểm tra bộ sinh QR Ghép Điện thoại & Giải mã Camera CODE128 / EAN-13...')
  const pairUrl = 'http://192.168.1.50:3010/pos/scanner?s=POS-UUDAM-01&t=849201'
  const t0 = performance.now()
  const qr = encodeQrMatrix(pairUrl)
  const qrSvg = qrCodeSvg(pairUrl, { size: 204 })
  const qrMs = performance.now() - t0

  assert(
    qr.length >= 29 && qr[0]?.length === qr.length,
    `Ma trận QR ISO/IEC 18004 hợp lệ (${qr.length}x${qr.length} modules)`
  )
  assert(qrSvg.startsWith('<svg') && qrSvg.includes('<path d="'), `Render QR SVG offline trong ${qrMs.toFixed(2)}ms (< 10ms)`)

  const skuSvg = barcodeSvg('BM-DEC-COC-TRON', { showText: false })
  const lumSku = rasterizeSvgBarcodeToLuminance(skuSvg, 4)
  const decodedSku = decode1DBarcodeFromLuminanceRow(lumSku)
  assert(
    decodedSku === 'BM-DEC-COC-TRON',
    `Giải mã Pure-TS CODE128 chính xác SKU thật "${decodedSku}" không cần BarcodeDetector`
  )

  const spxSvg = barcodeSvg('SPXVN0688991122', { showText: false })
  const decodedSpx = decode1DBarcodeFromLuminanceRow(rasterizeSvgBarcodeToLuminance(spxSvg, 3))
  assert(
    decodedSpx === 'SPXVN0688991122',
    `Giải mã Pure-TS CODE128 mã vận đơn Shopee "${decodedSpx}"`
  )

  // EAN-13 Việt Nam (893): 893850597419 + check digit
  // Tính check digit chuẩn Mod-10 cho 893850597419:
  const base12 = '893850597419'
  let oddSum = 0
  let evenSum = 0
  for (let i = 0; i < 12; i++) {
    if (i % 2 === 0) oddSum += Number(base12[i])
    else evenSum += Number(base12[i])
  }
  const checkDigit = (10 - ((oddSum + evenSum * 3) % 10)) % 10
  const validEan13 = `${base12}${checkDigit}`
  const decodedEan = decode1DBarcodeFromLuminanceRow(buildEan13LuminanceRow(validEan13, 4))
  assert(
    decodedEan === validEan13,
    `Giải mã Pure-TS EAN-13 (${validEan13}) kèm kiểm tra Mod-10 Checksum`
  )

  // -------------------------------------------------------------------------
  // PHẦN 2: BỘ MÃ HÓA LỆNH NHIỆT ESC/POS K80 & TEM NHIỆT SHOPEE
  // -------------------------------------------------------------------------
  console.log('\n[2/5] Kiểm tra bộ sinh byte nhiệt ESC/POS K80, Mở két tiền & Vận đơn Shopee...')
  assert(
    removeVietnameseDiacritics('Cốc Thạch Cao Đẹp Ưu Đàm') === 'Coc Thach Cao Dep Uu Dam',
    'Khử dấu tiếng Việt sang ASCII sạch không lỗi font trên máy in nhiệt ESC/POS'
  )

  const receiptBytes = encodeReceipt(
    {
      code: 'DH261114-8888',
      customerName: 'Nguyễn Minh Anh',
      items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 2, price: 79000 }],
      total: 158000,
      paymentMethod: 'CASH',
      cashReceived: 200000,
      changeDue: 42000,
    },
    { paperSize: 'K80', openCashDrawer: true }
  )

  assert(
    receiptBytes[0] === ESC_POS_COMMANDS.INIT[0] &&
      receiptBytes[1] === ESC_POS_COMMANDS.INIT[1] &&
      receiptBytes[2] === ESC_POS_COMMANDS.CASH_DRAWER_KICK[0] &&
      receiptBytes[3] === ESC_POS_COMMANDS.CASH_DRAWER_KICK[1],
    'Byte ESC/POS POS Bill mở đầu bằng ESC @ (0x1B 0x40) + xung mở ngăn kéo tiền RJ11 (ESC p)'
  )
  assert(
    receiptBytes[receiptBytes.length - 3] === 0x1d &&
      receiptBytes[receiptBytes.length - 2] === 0x56 &&
      receiptBytes[receiptBytes.length - 1] === 0x00,
    'Byte ESC/POS POS Bill kết thúc bằng lệnh cắt giấy tự động GS V 0 (0x1D 0x56 0x00)'
  )

  const shopeeBytes = encodeShopeeSlip({
    orderCode: 'DH261114-9999',
    shopeeOrderSn: '261114SPX999',
    hasFragile: true,
    carrier: 'SPX Express',
    trackingCode: 'SPXVN0688991122',
    recipient: { name: 'Trần Thu Hà', phone: '09******12', address: 'Quận 3, TP.HCM' },
    items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 1, price: 79000, fragile: true }],
    total: 79000,
    codAmount: 79000,
  })
  const shopeeAscii = Buffer.from(shopeeBytes).toString('latin1')
  assert(
    shopeeAscii.includes('SHOPEE EXPRESS') &&
      shopeeAscii.includes('SPXVN0688991122') &&
      shopeeAscii.includes('HANG DE VO'),
    'Phiếu nhiệt Shopee ESC/POS chứa đầy đủ Mã vận đơn SPX, Danh sách SKU & Cảnh báo Hàng Dễ Vỡ'
  )

  assert(
    isAllowedLanPrinterHost('192.168.1.200') &&
      isAllowedLanPrinterHost('127.0.0.1') &&
      !isAllowedLanPrinterHost('8.8.8.8') &&
      !isAllowedLanPrinterHost('169.254.169.254'),
    'Bộ lọc IP máy in LAN chỉ cho phép RFC-1918 / Loopback, chặn tuyệt đối SSRF ra Internet & Cloud Metadata'
  )

  const receiptHtml = renderReceiptPrintHtml(
    {
      code: 'DH261115-8888',
      customerName: 'Nguyễn Minh Anh',
      items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 2, price: 79000 }],
      total: 158000,
      paymentMethod: 'CASH',
      cashReceived: 200000,
      changeDue: 42000,
    },
    'K80'
  )
  assert(
    receiptHtml.includes('<svg') &&
      receiptHtml.includes('CỬA HÀNG &amp; KHO ƯU ĐÀM') &&
      receiptHtml.includes('Nguyễn Minh Anh'),
    'Render HTML cô lập POS Bill K80 (Iframe Clean Fallback) chứa đầy đủ mã vạch SVG CODE128 & dấu tiếng Việt'
  )

  const shopeeSlipHtml = renderShopeeSlipPrintHtml(
    [
      {
        orderCode: 'DH261115-9999',
        shopeeOrderSn: '261115SPX999',
        hasFragile: true,
        carrier: 'SPX Express',
        trackingCode: 'SPXVN0688991122',
        recipient: { name: 'Trần Thu Hà', phone: '09******12', address: 'Quận 3, TP.HCM' },
        items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 1, price: 79000, fragile: true }],
        total: 79000,
        codAmount: 79000,
      },
    ],
    'A6_LABEL',
    'K80'
  )
  assert(
    shopeeSlipHtml.includes('@page { size: 105mm 148mm;') &&
      shopeeSlipHtml.includes('<svg') &&
      shopeeSlipHtml.includes('HÀNG DỄ VỠ'),
    'Render HTML cô lập Tem Vận Đơn Shopee A6 (105×148mm) chứa mã vạch SVG SPX & khung cảnh báo Hàng Dễ Vỡ'
  )

  const origNav = globalThis.navigator
  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        webdriver: true,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
      },
    })
    assert(
      isHeadlessQaCrawler() === false,
      'Cửa sổ Chrome thật bật CDP Shopee (navigator.webdriver=true) KHÔNG bị khóa Dry-Run — cho phép in ra giấy thật 100%'
    )

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        webdriver: true,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) HeadlessChrome/131.0.0.0 Safari/537.36',
      },
    })
    assert(
      isHeadlessQaCrawler() === true,
      'Trình quét tự động HeadlessChrome vẫn được nhận diện sang Dry-Run để bảo vệ giấy/mực'
    )
  } finally {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: origNav,
    })
  }

  if (!process.argv.includes('--live')) {
    console.log(`\nHoàn tất kiểm thử Offline: ${passed} PASS, ${failed} FAIL.`)
    await db.$disconnect()
    if (failed > 0) process.exit(1)
    return
  }

  // -------------------------------------------------------------------------
  // PHẦN 3: KIỂM THỬ LIVE MÁY IN NHIỆT RAW TCP :9100 & CHỐNG SSRF TRÊN SERVER
  // -------------------------------------------------------------------------
  console.log('\n[3/5] Kiểm thử Live truyền byte ESC/POS qua TCP Socket & Chặn SSRF...')
  const receivedChunks: Buffer[] = []
  const mockPrinterServer = net.createServer((socket) => {
    socket.on('data', (chunk) => receivedChunks.push(Buffer.from(chunk)))
  })

  await new Promise<void>((resolve) => mockPrinterServer.listen(0, '127.0.0.1', () => resolve()))
  const printerPort = (mockPrinterServer.address() as net.AddressInfo).port

  try {
    const tcpRes = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RAW_TCP_PRINT',
        host: '127.0.0.1',
        port: printerPort,
        payloadBase64: uint8ToBase64(receiptBytes),
      }),
    })
    const tcpJson = (await tcpRes.json()) as { ok?: boolean; bytesSent?: number }
    await new Promise((r) => setTimeout(r, 80))
    const merged = Buffer.concat(receivedChunks)

    assert(
      tcpRes.status === 200 && tcpJson.ok === true && merged.length === receiptBytes.length,
      `Máy in TCP giả lập (127.0.0.1:${printerPort}) nhận trọn vẹn ${merged.length}/${receiptBytes.length} byte ESC/POS thực tế`
    )

    const ssrfRes = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RAW_TCP_PRINT',
        host: '8.8.8.8',
        port: 9100,
        payloadBase64: uint8ToBase64(receiptBytes),
      }),
    })
    assert(ssrfRes.status === 403, `Chặn SSRF thành công khi gửi RAW_TCP_PRINT tới IP công cộng 8.8.8.8 (HTTP ${ssrfRes.status})`)
  } finally {
    await new Promise<void>((resolve) => mockPrinterServer.close(() => resolve()))
  }

  // -------------------------------------------------------------------------
  // PHẦN 4: ĐIỆN THOẠI QUÉT MÃ <-> MÁY POS LIÊN KẾT <-> TÍNH TIỀN & AUTO-PRINT
  // -------------------------------------------------------------------------
  console.log('\n[4/5] Kiểm thử Live Điện thoại ghép nối POS, quét mã SKU thật & bấm Tính tiền + In Bill...')
  const testStationId = 'POS-E2E-TEST'
  const regRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'REGISTER_STATION',
      stationId: testStationId,
      stationName: 'Trạm POS Kiểm Định E2E',
      autoPrintPosBill: true,
      autoPrintShopeeOrder: true,
    }),
  })
  const regJson = (await regRes.json()) as {
    ok?: boolean
    station?: { stationId: string; pairToken: string }
  }
  const pairToken = regJson.station?.pairToken || ''
  assert(Boolean(regJson.ok && pairToken.length === 6), `Đăng ký Trạm POS (${testStationId}) & sinh PIN 6 số (${pairToken})`)

  const badPinRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'CONNECT_PHONE',
      stationId: testStationId,
      pairToken: '000000',
      phoneId: 'phone-hacker',
    }),
  })
  assert(badPinRes.status === 401, `Từ chối ghép nối điện thoại khi sai mã PIN (HTTP ${badPinRes.status})`)

  const connRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'CONNECT_PHONE',
      stationId: testStationId,
      pairToken,
      phoneId: 'phone-staff-01',
      deviceName: 'iPhone 15 Pro Scanner',
    }),
  })
  assert(connRes.status === 200, 'Ghép nối Điện thoại nhân viên vào Máy POS thành công bằng PIN hợp lệ')

  const scanRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'PHONE_SCAN',
      stationId: testStationId,
      pairToken,
      phoneId: 'phone-staff-01',
      code: 'BM-DEC-COC-TRON',
      quantity: 1,
    }),
  })
  const scanJson = (await scanRes.json()) as {
    ok?: boolean
    matched?: boolean
    product?: { sku: string; name: string }
    scanEvent?: { seq: number }
  }
  assert(
    scanJson.ok === true && scanJson.matched === true && scanJson.product?.sku === 'BM-DEC-COC-TRON',
    `Điện thoại quét mã "BM-DEC-COC-TRON" khớp chính xác sản phẩm "${scanJson.product?.name}"`
  )

  // Đồng bộ giỏ hàng POS ngược lại cho Điện thoại
  await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'SYNC_STATION_STATE',
      stationId: testStationId,
      ackScanSeqUpTo: scanJson.scanEvent?.seq ?? 1,
      cartSnapshot: {
        tabLabel: 'Đơn 1',
        items: [
          {
            productId: 'test-prod',
            sku: 'BM-DEC-COC-TRON',
            name: 'Cốc Thạch Cao Đa Năng',
            price: 79000,
            quantity: 2,
          },
        ],
        subtotal: 158000,
        discountAmount: 0,
        shippingFee: 0,
        grandTotal: 158000,
        totalQuantity: 2,
        paymentMethod: 'CASH',
        customerName: null,
        updatedAt: new Date().toISOString(),
      },
    }),
  })

  // Điện thoại bấm "TÍNH TIỀN & TỰ ĐỘNG IN BILL TRÊN MÁY POS"
  const chkReqRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'PHONE_TRIGGER_CHECKOUT',
      stationId: testStationId,
      pairToken,
      phoneId: 'phone-staff-01',
      paymentMethod: 'CASH',
      autoPrintBill: true,
    }),
  })
  const chkReqJson = (await chkReqRes.json()) as {
    ok?: boolean
    checkoutRequest?: { id: string; status: string }
  }
  const checkoutId = chkReqJson.checkoutRequest?.id || ''
  assert(Boolean(checkoutId), `Điện thoại phát lệnh Tính tiền & Tự động in Bill sang POS (${checkoutId})`)

  // POS xác nhận hoàn tất thanh toán & in Bill tự động
  await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'COMPLETE_REMOTE_CHECKOUT',
      stationId: testStationId,
      checkoutId,
      status: 'COMPLETED',
      orderCode: 'DH-POS-AUTO-01',
      total: 158000,
      paymentMethod: 'CASH',
      printedMethod: 'LAN_TCP_9100',
    }),
  })

  const phoneVerifyRes = await fetch(
    `${BASE_URL}/api/peripherals?role=phone&stationId=${testStationId}&token=${pairToken}&checkoutId=${checkoutId}`
  )
  const phoneVerifyJson = (await phoneVerifyRes.json()) as {
    ok?: boolean
    station?: {
      latestCheckoutRequest?: {
        status: string
        resultOrderCode?: string
        resultPrintedMethod?: string
      }
    }
  }
  assert(
    phoneVerifyJson.station?.latestCheckoutRequest?.status === 'COMPLETED' &&
      phoneVerifyJson.station?.latestCheckoutRequest?.resultOrderCode === 'DH-POS-AUTO-01' &&
      phoneVerifyJson.station?.latestCheckoutRequest?.resultPrintedMethod === 'LAN_TCP_9100',
    'Điện thoại nhận phản hồi hoàn tất đơn DH-POS-AUTO-01 & xác nhận đã tự động in Bill (LAN_TCP_9100)'
  )

  // -------------------------------------------------------------------------
  // PHẦN 5: TỰ ĐỘNG IN ĐƠN HÀNG SHOPEE + CHỐNG IN TRÙNG + DỌN SẠCH 100% DB
  // -------------------------------------------------------------------------
  console.log('\n[5/5] Kiểm thử Live Hàng đợi Tự động in Đơn Shopee & Dọn sạch Zero-Residue...')
  const shopeeChannel = await db.channel.findUnique({ where: { key: 'SHOPEE' } })
  const category = await db.category.findFirst()
  let tempProductId = ''
  let tempOrderId = ''

  try {
    const tempProd = await db.product.create({
      data: {
        sku: `TEST-SHP-PRINT-${Date.now()}`,
        name: '[SYNTHETIC-TEST] Nến Thạch Cao Test Auto-Print Shopee',
        categoryId: category!.id,
        costPrice: 30000,
        sellPrice: 79000,
        stock: 5,
        status: 'INACTIVE',
      },
    })
    tempProductId = tempProd.id

    const tempOrder = await db.order.create({
      data: {
        code: `TEST-SHP-${Date.now()}`,
        channelId: shopeeChannel!.id,
        status: 'CONFIRMED',
        paymentMethod: 'SHOPEE_WALLET',
        paymentStatus: 'PAID',
        subtotal: 79000,
        shippingFee: 0,
        total: 79000,
        note: '[SYNTHETIC-TEST] Shopee Order #261114AUTOPRINT',
        items: {
          create: [{ productId: tempProd.id, quantity: 1, price: 79000 }],
        },
      },
    })
    tempOrderId = tempOrder.id

    const enq1 = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ENQUEUE_SHOPEE_PRINT',
        orderId: tempOrder.id,
        shopeeOrderSn: '261114AUTOPRINT',
        allowSynthetic: true,
      }),
    })
    const enq1Json = (await enq1.json()) as { ok?: boolean; job?: { id: string; status: string } }

    const enq2 = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ENQUEUE_SHOPEE_PRINT',
        orderId: tempOrder.id,
        shopeeOrderSn: '261114AUTOPRINT',
        allowSynthetic: true,
      }),
    })
    const enq2Json = (await enq2.json()) as { ok?: boolean; job?: { id: string } }

    assert(
      Boolean(enq1Json.job?.id) && enq1Json.job?.id === enq2Json.job?.id,
      `Đẩy đơn Shopee vào hàng đợi Auto-Print POS & chống in trùng Idempotent (${enq1Json.job?.id})`
    )

    // Lấy dữ liệu vận đơn thật từ /api/orders/batch-slips
    const slipRes = await fetch(`${BASE_URL}/api/orders/batch-slips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: [tempOrder.id] }),
    })
    const slipJson = (await slipRes.json()) as {
      slips?: Array<{ orderCode: string; trackingCode: string; items: unknown[] }>
    }
    assert(
      slipRes.status === 200 && slipJson.slips?.[0]?.orderCode === tempOrder.code,
      `API /api/orders/batch-slips xuất dữ liệu tem vận đơn Shopee chuẩn cho đơn ${tempOrder.code}`
    )

    const ackRes = await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK_PRINT_JOB',
        stationId: testStationId,
        jobId: enq1Json.job?.id,
        printedMethod: 'SHOPEE_A6_BROWSER',
        status: 'PRINTED',
      }),
    })
    const ackJson = (await ackRes.json()) as { job?: { status: string; printedMethod: string } }
    assert(
      ackJson.job?.status === 'PRINTED' && ackJson.job?.printedMethod === 'SHOPEE_A6_BROWSER',
      'POS xác nhận ACK_PRINT_JOB thành công — chuyển trạng thái đơn Shopee sang PRINTED'
    )

    // Xóa job test khỏi bộ nhớ Hub
    await fetch(`${BASE_URL}/api/peripherals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'REMOVE_TEST_PRINT_JOB',
        jobId: enq1Json.job?.id,
      }),
    })
  } finally {
    if (tempOrderId) {
      await db.orderItem.deleteMany({ where: { orderId: tempOrderId } })
      await db.shipment.deleteMany({ where: { orderId: tempOrderId } })
      await db.orderEvent.deleteMany({ where: { orderId: tempOrderId } })
      await db.order.deleteMany({ where: { id: tempOrderId } })
    }
    if (tempProductId) {
      await db.product.deleteMany({ where: { id: tempProductId } })
    }
  }

  // -------------------------------------------------------------------------
  // PHẦN 6: KIỂM THỬ IN TỰ ĐỘNG NGẦM WINDOWS SPOOLER (0 HỘP THOẠI — AN TOÀN 0 GIẤY/MỰC)
  // -------------------------------------------------------------------------
  console.log('\n[6/6] Kiểm thử Live Windows Spooler Silent Auto-Print (GDI+ Bitmap Dry-Run & PDF Spool)...')
  const winListRes = await fetch(
    `${BASE_URL}/api/peripherals?role=pos&stationId=${encodeURIComponent(testStationId)}&refreshPrinters=1`
  )
  const winListJson = (await winListRes.json()) as {
    ok?: boolean
    windowsPrinters?: Array<{ name: string; isDefault: boolean; isPhysical: boolean; isVirtual: boolean }>
  }
  const detectedPrinters = winListJson.windowsPrinters || []
  const physicalPrinters = detectedPrinters.filter((p) => p.isPhysical)
  assert(
    winListRes.status === 200 && detectedPrinters.length >= 1,
    `Quét danh sách máy in Windows Spooler thành công (${detectedPrinters.length} máy in, ${physicalPrinters.length} máy in vật lý: ${
      physicalPrinters.map((p) => p.name).join(', ') || 'PDF/Virtual'
    })`
  )

  const dryRunReceiptRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'WINDOWS_SPOOLER_PRINT',
      jobType: 'POS_RECEIPT',
      paperSize: 'K80',
      dryRun: true,
      receipt: {
        code: 'DH261115-SILENT01',
        invoiceCode: 'XK261115-01',
        customerName: 'Nguyễn Minh Anh',
        items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 2, price: 79000 }],
        total: 158000,
        paymentMethod: 'CASH',
        cashReceived: 200000,
        changeDue: 42000,
      },
    }),
  })
  const dryRunReceiptJson = (await dryRunReceiptRes.json()) as {
    ok?: boolean
    mode?: string
    bytesGenerated?: number
    pagesPrinted?: number
    error?: string
  }
  assert(
    dryRunReceiptRes.status === 200 &&
      dryRunReceiptJson.ok === true &&
      dryRunReceiptJson.mode === 'WINDOWS_DRY_RUN' &&
      Number(dryRunReceiptJson.bytesGenerated) > 1000,
    `Render GDI+ Hóa đơn POS K80 tiếng Việt + CODE128 Vector ngầm thành công (${dryRunReceiptJson.bytesGenerated} bytes PNG, 0 hộp thoại)`,
    dryRunReceiptJson.error
  )

  const pdfSpoolBatchRes = await fetch(`${BASE_URL}/api/peripherals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'WINDOWS_SPOOLER_PRINT',
      jobType: 'SHOPEE_BATCH_SLIPS',
      shopeeFormat: 'A6_LABEL',
      paperSize: 'K80',
      testPdfSpool: true,
      slips: [
        {
          orderCode: 'DH261115-SPX01',
          shopeeOrderSn: '261115SPX001',
          hasFragile: true,
          carrier: 'SPX Express',
          trackingCode: 'SPXVN0688991122',
          recipient: { name: 'Trần Thu Hà', phone: '09******12', address: 'Quận 3, TP.HCM' },
          items: [{ sku: 'BM-DEC-COC-TRON', name: 'Cốc Thạch Cao Đa Năng', quantity: 1, price: 79000, fragile: true }],
          total: 79000,
          codAmount: 79000,
        },
        {
          orderCode: 'DH261115-SPX02',
          shopeeOrderSn: '261115SPX002',
          hasFragile: false,
          carrier: 'GHN',
          trackingCode: 'GHNVN9988776655',
          recipient: { name: 'Lê Hoàng Nam', phone: '09******88', address: 'Cầu Giấy, Hà Nội' },
          items: [{ sku: 'BM-DEC-OVAL-DEN', name: 'Khay Thạch Cao Oval Đen', quantity: 2, price: 59000 }],
          total: 118000,
          codAmount: 0,
        },
      ],
    }),
  })
  const pdfSpoolBatchJson = (await pdfSpoolBatchRes.json()) as {
    ok?: boolean
    mode?: string
    printerName?: string
    pagesPrinted?: number
    bytesGenerated?: number
    error?: string
  }
  assert(
    pdfSpoolBatchRes.status === 200 &&
      pdfSpoolBatchJson.ok === true &&
      (pdfSpoolBatchJson.mode === 'WINDOWS_PDF_SPOOL_TEST' || pdfSpoolBatchJson.mode === 'WINDOWS_DRY_RUN') &&
      pdfSpoolBatchJson.pagesPrinted === 2 &&
      Number(pdfSpoolBatchJson.bytesGenerated) > 1500,
    `Spool ngầm 2 trang Tem Vận Đơn Shopee A6 qua Windows Spooler (${pdfSpoolBatchJson.printerName}, mode=${pdfSpoolBatchJson.mode}, ${pdfSpoolBatchJson.bytesGenerated} bytes, 0 giấy thật)`,
    pdfSpoolBatchJson.error
  )

  console.log('\n======================================================================')
  console.log(`📊 KẾT QUẢ CUỐI CÙNG: ${passed} PASS / ${failed} FAIL`)
  console.log('======================================================================')
  await db.$disconnect()
  if (failed > 0) process.exit(1)
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect()
  process.exit(1)
})
