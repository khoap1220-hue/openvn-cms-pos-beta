// BARCODE — sinh mã vạch CODE128 (auto B/C) ra SVG thuần.
// Không dùng thư viện ngoài: bảng pattern chuẩn CODE128, chạy được cả server & client.
// Dùng cho: in nhãn sản phẩm, quét tìm nhanh, phiếu nhập/xuất kho.

/** Bảng pattern CODE128 chuẩn — 107 giá trị (0..105 + stop 106), mỗi ký tự là chuỗi độ rộng bar/space */
const CODE128_PATTERNS: string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

const START_B = 104
const START_C = 105
const CODE_C = 99 // chuyển sang set C (cặp số)
const CODE_B = 100 // chuyển sang set B (ký tự ASCII 32..126)
const STOP = 106

/** Chuyển text (ASCII 32..126) thành danh sách giá trị CODE128 — tự tối ưu chạy số sang set C */
export function encodeCode128(text: string): number[] {
  const clean = Array.from(text).map((ch) => {
    const code = ch.charCodeAt(0)
    return code >= 32 && code <= 126 ? ch : ' '
  })

  const codes: number[] = []
  const allDigits = /^\d+$/.test(clean.join(''))

  if (allDigits && clean.length >= 2) {
    // Toàn số: START C + các cặp số; nếu lẻ 1 số cuối thì nhảy B
    codes.push(START_C)
    let i = 0
    for (; i + 1 < clean.length; i += 2) codes.push(Number(clean.slice(i, i + 2).join('')))
    if (i < clean.length) {
      codes.push(CODE_B)
      codes.push(clean[i].charCodeAt(0) - 32)
    }
    return codes
  }

  codes.push(START_B)
  let i = 0
  while (i < clean.length) {
    // đếm chuỗi số liên tiếp
    let j = i
    while (j < clean.length && clean[j] >= '0' && clean[j] <= '9') j++
    const runLen = j - i
    // chuỗi số ≥ 4 ký tự (chẵn sau khi chia cặp) → set C tiết kiệm diện tích
    if (i > 0 && runLen >= 4) {
      codes.push(CODE_C)
      let k = i
      const pairEnd = i + (runLen - (runLen % 2))
      for (; k + 1 < pairEnd; k += 2) codes.push(Number(clean.slice(k, k + 2).join('')))
      if (runLen % 2 === 1) {
        // số lẻ còn dư → quay lại B cho 1 ký tự cuối
        codes.push(CODE_B)
        codes.push(clean[pairEnd].charCodeAt(0) - 32)
      }
    } else {
      for (let k = i; k < j; k++) codes.push(clean[k].charCodeAt(0) - 32)
    }
    i = j
    // phần ký tự không phải số
    while (i < clean.length && !(clean[i] >= '0' && clean[i] <= '9')) {
      codes.push(clean[i].charCodeAt(0) - 32)
      i++
    }
  }
  return codes
}

export interface BarcodeSvgOptions {
  /** chiều cao vùng bar (px) */
  height?: number
  /** độ rộng module tối thiểu (px) */
  moduleWidth?: number
  /** hiển thị text dưới mã vạch */
  showText?: boolean
  /** lề yên tĩnh 2 bên (px) */
  quietZone?: number
  /** màu bar */
  color?: string
}

export interface Code128BarRuns {
  totalModules: number
  bars: Array<{ x: number; w: number }>
}

/** Tính danh sách vạch đen (tọa độ module x, độ rộng module w) chuẩn CODE128 để vẽ vector lên GDI+/Canvas/SVG */
export function getCode128BarRuns(text: string): Code128BarRuns {
  const safeText = String(text || '').trim() || 'OPENVN'
  const codes = encodeCode128(safeText)
  let sum = codes[0]
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i
  const check = sum % 103
  const sequence = [...codes, check, STOP]
  const patterns = sequence.map((v) => CODE128_PATTERNS[v] ?? CODE128_PATTERNS[0])

  const bars: Array<{ x: number; w: number }> = []
  let x = 0
  for (const p of patterns) {
    let isBar = true
    for (const d of p) {
      const w = Number(d)
      if (isBar && w > 0) {
        bars.push({ x, w })
      }
      x += w
      isBar = !isBar
    }
  }
  return { totalModules: x, bars }
}

/** Sinh chuỗi SVG cho mã vạch CODE128 từ text */
export function barcodeSvg(text: string, options: BarcodeSvgOptions = {}): string {
  const height = Math.min(400, Math.max(10, Math.round(options.height ?? 60)))
  const moduleWidth = Math.min(8, Math.max(1, options.moduleWidth ?? 2))
  const quietZone = Math.min(80, Math.max(0, Math.round(options.quietZone ?? 10)))
  const showText = options.showText ?? false
  const color = options.color ?? '#000000'

  const codes = encodeCode128(text)

  // checksum: codes[0] + Σ codes[i] × i, mod 103
  let sum = codes[0]
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i
  const check = sum % 103

  const sequence = [...codes, check, STOP]
  const patterns = sequence.map((v) => CODE128_PATTERNS[v] ?? CODE128_PATTERNS[0])

  let widthModules = 0
  for (const p of patterns) {
    for (const d of p) widthModules += Number(d)
  }

  const totalWidth = widthModules * moduleWidth + quietZone * 2
  const textHeight = showText ? 14 : 0
  const totalHeight = height + textHeight

  const rects: string[] = []
  let x = quietZone
  for (const p of patterns) {
    let isBar = true
    for (const d of p) {
      const w = Number(d) * moduleWidth
      if (isBar) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}" fill="${color}"/>`)
      x += w
      isBar = !isBar
    }
  }

  const textEl = showText
    ? `<text x="${totalWidth / 2}" y="${height + 12}" text-anchor="middle" font-family="ui-monospace, 'SFMono-Regular', Menlo, monospace" font-size="12" fill="${color}">${escapeXml(text)}</text>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" role="img" aria-label="Mã vạch ${escapeXml(text)}">${rects.join('')}${textEl}</svg>`
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
