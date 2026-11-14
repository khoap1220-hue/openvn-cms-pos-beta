/**
 * Universal Barcode / QR Decoder & POS Scanner Utilities
 * - Tầng 1: Native Browser BarcodeDetector API (CODE128, EAN-13, EAN-8, QR, CODE39, UPC)
 * - Tầng 2: Pure-TS Multi-Scanline 1D Decoder (CODE128 Set A/B/C + Mod-103 Checksum & EAN-13 + Mod-10 Checksum)
 *           Giúp iPhone Safari, Firefox, trình duyệt máy tính và chế độ chụp ảnh qua HTTP LAN vẫn đọc tốt tem mã vạch!
 * - Tầng 3: Hỗ trợ giải mã trực tiếp ảnh chụp Camera điện thoại (<input capture="environment">) khi LAN chưa có HTTPS.
 * - Tầng 4: Âm báo tít siêu thị WebAudio (0 file âm thanh ngoài).
 */

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
  '114131', '311141', '411131', '211412', '211214', '211232',
]

const PATTERN_TO_CODE128 = new Map<string, number>(
  CODE128_PATTERNS.map((pat, idx) => [pat, idx])
)

const EAN_L_PATTERNS: Record<string, number> = {
  '3211': 0, '2221': 1, '2122': 2, '1411': 3, '1132': 4,
  '1231': 5, '1114': 6, '1312': 7, '1213': 8, '3112': 9,
}
const EAN_G_PATTERNS: Record<string, number> = {
  '1123': 0, '1222': 1, '2212': 2, '1141': 3, '2311': 4,
  '1321': 5, '4111': 6, '2131': 7, '3121': 8, '2113': 9,
}
const EAN_PARITY_FIRST_DIGIT: Record<string, number> = {
  'LLLLLL': 0,
  'LLGLGG': 1,
  'LLGGLG': 2,
  'LLGGGL': 3,
  'LGLLGG': 4,
  'LGGLLG': 5,
  'LGGGLL': 6,
  'LGLGLG': 7,
  'LGLGGL': 8,
  'LGGLGL': 9,
}

interface RunSegment {
  dark: boolean
  len: number
}

function quantizeWidths(runs: RunSegment[], startIdx: number, count: number, targetModules: number): string | null {
  if (startIdx + count > runs.length) return null
  let totalPx = 0
  for (let i = 0; i < count; i++) totalPx += runs[startIdx + i].len
  if (totalPx < targetModules) return null

  const unit = totalPx / targetModules
  const widths: number[] = []
  const errors: Array<{ idx: number; diff: number }> = []
  let sum = 0

  for (let i = 0; i < count; i++) {
    const exact = runs[startIdx + i].len / unit
    const rounded = Math.max(1, Math.min(4, Math.round(exact)))
    widths.push(rounded)
    sum += rounded
    errors.push({ idx: i, diff: exact - rounded })
  }

  // Cân bằng sai số làm tròn để tổng module luôn khớp chính xác (11 hoặc 13 hoặc 7)
  while (sum !== targetModules) {
    if (sum < targetModules) {
      errors.sort((a, b) => b.diff - a.diff)
      const best = errors.find((e) => widths[e.idx] < 4)
      if (!best) return null
      widths[best.idx]++
      best.diff -= 1
      sum++
    } else {
      errors.sort((a, b) => a.diff - b.diff)
      const best = errors.find((e) => widths[e.idx] > 1)
      if (!best) return null
      widths[best.idx]--
      best.diff += 1
      sum--
    }
  }

  return widths.join('')
}

function decodeCode128Values(codes: number[]): string | null {
  if (codes.length < 3) return null
  const startCode = codes[0]
  if (startCode !== 103 && startCode !== 104 && startCode !== 105) return null

  const checkExpected = codes[codes.length - 1]
  let checkSum = startCode
  for (let i = 1; i < codes.length - 1; i++) {
    checkSum += codes[i] * i
  }
  if (checkSum % 103 !== checkExpected) return null

  let mode: 'A' | 'B' | 'C' = startCode === 103 ? 'A' : startCode === 104 ? 'B' : 'C'
  let out = ''
  const dataCodes = codes.slice(1, -1)

  for (let i = 0; i < dataCodes.length; i++) {
    const c = dataCodes[i]
    if (mode === 'C') {
      if (c === 100) {
        mode = 'B'
      } else if (c === 101) {
        mode = 'A'
      } else if (c >= 0 && c <= 99) {
        out += String(c).padStart(2, '0')
      }
    } else if (mode === 'B') {
      if (c === 99) {
        mode = 'C'
      } else if (c === 101) {
        mode = 'A'
      } else if (c >= 0 && c <= 95) {
        out += String.fromCharCode(32 + c)
      }
    } else {
      if (c === 99) {
        mode = 'C'
      } else if (c === 100) {
        mode = 'B'
      } else if (c >= 0 && c <= 63) {
        out += String.fromCharCode(32 + c)
      } else if (c >= 64 && c <= 95) {
        out += String.fromCharCode(c - 64)
      }
    }
  }

  return out.trim() || null
}

function tryDecodeCode128FromRuns(runs: RunSegment[]): string | null {
  for (let s = 0; s + 18 < runs.length; s++) {
    if (!runs[s].dark) continue
    const startPat = quantizeWidths(runs, s, 6, 11)
    if (!startPat) continue
    const startVal = PATTERN_TO_CODE128.get(startPat)
    if (startVal !== 103 && startVal !== 104 && startVal !== 105) continue

    const codes: number[] = [startVal]
    let cursor = s + 6
    let matchedStop = false

    while (cursor + 6 <= runs.length && codes.length <= 72) {
      if (cursor + 7 <= runs.length) {
        const stopPat = quantizeWidths(runs, cursor, 7, 13)
        if (stopPat === '2331112') {
          matchedStop = true
          break
        }
      }
      const symPat = quantizeWidths(runs, cursor, 6, 11)
      if (!symPat) break
      const symVal = PATTERN_TO_CODE128.get(symPat)
      if (symVal === undefined) break
      codes.push(symVal)
      cursor += 6
    }

    if (matchedStop && codes.length >= 3) {
      const decoded = decodeCode128Values(codes)
      if (decoded) return decoded
    }
  }
  return null
}

function tryDecodeEan13FromRuns(runs: RunSegment[]): string | null {
  // EAN-13 gồm: Start(3 runs=111) + 6*4(24 runs) + Center(5 runs=11111) + 6*4(24 runs) + End(3 runs=111) = 59 runs
  for (let s = 0; s + 59 <= runs.length; s++) {
    if (!runs[s].dark) continue
    if (quantizeWidths(runs, s, 3, 3) !== '111') continue
    if (quantizeWidths(runs, s + 27, 5, 5) !== '11111') continue
    if (quantizeWidths(runs, s + 56, 3, 3) !== '111') continue

    let parity = ''
    let digits = ''
    let valid = true

    for (let i = 0; i < 6; i++) {
      // L/G bắt đầu từ space, bar, space, bar (4 runs)
      const pat = quantizeWidths(runs, s + 3 + i * 4, 4, 7)
      if (!pat) {
        valid = false
        break
      }
      if (pat in EAN_L_PATTERNS) {
        parity += 'L'
        digits += String(EAN_L_PATTERNS[pat])
      } else if (pat in EAN_G_PATTERNS) {
        parity += 'G'
        digits += String(EAN_G_PATTERNS[pat])
      } else {
        valid = false
        break
      }
    }
    if (!valid || !(parity in EAN_PARITY_FIRST_DIGIT)) continue
    const firstDigit = EAN_PARITY_FIRST_DIGIT[parity]

    for (let i = 0; i < 6; i++) {
      // R bắt đầu từ bar, space, bar, space — cùng độ rộng với L!
      const pat = quantizeWidths(runs, s + 32 + i * 4, 4, 7)
      if (!pat || !(pat in EAN_L_PATTERNS)) {
        valid = false
        break
      }
      digits += String(EAN_L_PATTERNS[pat])
    }
    if (!valid) continue

    const full = `${firstDigit}${digits}`
    let sum = 0
    for (let i = 0; i < 12; i++) {
      sum += Number(full[i]) * (i % 2 === 0 ? 1 : 3)
    }
    const check = (10 - (sum % 10)) % 10
    if (check === Number(full[12])) {
      return full
    }
  }
  return null
}

/** Giải mã 1 hàng độ sáng (0..255) thành chuỗi CODE128 hoặc EAN-13 */
export function decode1DBarcodeFromLuminanceRow(luminance: ArrayLike<number>): string | null {
  const len = luminance.length
  if (len < 60) return null

  let minL = 255
  let maxL = 0
  for (let i = 0; i < len; i++) {
    const v = luminance[i]
    if (v < minL) minL = v
    if (v > maxL) maxL = v
  }
  if (maxL - minL < 28) return null

  // Thử 2 mức ngưỡng (toàn cục + cục bộ trượt) để chống bóng đổ trên tem giấy
  const thresholds = [(minL + maxL) * 0.5, minL + (maxL - minL) * 0.42]
  for (const threshold of thresholds) {
    const runs: RunSegment[] = []
    let curDark = luminance[0] < threshold
    let curLen = 1
    for (let i = 1; i < len; i++) {
      const d = luminance[i] < threshold
      if (d === curDark) {
        curLen++
      } else {
        runs.push({ dark: curDark, len: curLen })
        curDark = d
        curLen = 1
      }
    }
    runs.push({ dark: curDark, len: curLen })

    const c128 = tryDecodeCode128FromRuns(runs)
    if (c128) return c128
    const ean13 = tryDecodeEan13FromRuns(runs)
    if (ean13) return ean13
  }

  return null
}

interface BrowserBarcodeDetectorLike {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
}

let cachedDetector: BrowserBarcodeDetectorLike | null | undefined

function getNativeBarcodeDetector(): BrowserBarcodeDetectorLike | null {
  if (typeof window === 'undefined') return null
  if (cachedDetector !== undefined) return cachedDetector
  const Ctor = (
    window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BrowserBarcodeDetectorLike
    }
  ).BarcodeDetector
  if (typeof Ctor !== 'function') {
    cachedDetector = null
    return null
  }
  try {
    cachedDetector = new Ctor({
      formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'qr_code', 'upc_a', 'upc_e'],
    })
    return cachedDetector
  } catch {
    try {
      cachedDetector = new Ctor()
      return cachedDetector
    } catch {
      cachedDetector = null
      return null
    }
  }
}

let sharedCanvas: HTMLCanvasElement | null = null

export async function detectBarcodeUniversal(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement | ImageBitmap
): Promise<string | null> {
  // 1. Ưu tiên Native BarcodeDetector (đọc được cả QR 2D + 1D tốc độ cao)
  const native = getNativeBarcodeDetector()
  if (native) {
    try {
      const found = await native.detect(source)
      const val = found[0]?.rawValue?.trim()
      if (val) return val
    } catch {
      // Rơi xuống bộ giải mã Canvas 1D thuần TypeScript bên dưới
    }
  }

  // 2. Fallback Pure-TS Multi-Scanline 1D Decoder (CODE128 + EAN-13)
  if (typeof document === 'undefined') return null
  let srcW = 0
  let srcH = 0
  if (source instanceof HTMLVideoElement) {
    if (source.readyState < 2) return null
    srcW = source.videoWidth
    srcH = source.videoHeight
  } else if (source instanceof HTMLImageElement) {
    srcW = source.naturalWidth || source.width
    srcH = source.naturalHeight || source.height
  } else {
    srcW = source.width
    srcH = source.height
  }
  if (srcW < 60 || srcH < 20) return null

  const targetW = Math.min(960, srcW)
  const targetH = Math.max(40, Math.round((srcH * targetW) / srcW))
  if (!sharedCanvas) sharedCanvas = document.createElement('canvas')
  sharedCanvas.width = targetW
  sharedCanvas.height = targetH
  const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.drawImage(source as CanvasImageSource, 0, 0, targetW, targetH)
  const scanRatios = [0.5, 0.42, 0.58, 0.34, 0.66]
  const lumRow = new Uint8Array(targetW)

  for (const ratio of scanRatios) {
    const y = Math.min(targetH - 1, Math.max(0, Math.floor(targetH * ratio)))
    const imgData = ctx.getImageData(0, y, targetW, 1).data
    for (let x = 0; x < targetW; x++) {
      const p = x * 4
      lumRow[x] = (imgData[p] * 77 + imgData[p + 1] * 150 + imgData[p + 2] * 29) >> 8
    }
    const decoded = decode1DBarcodeFromLuminanceRow(lumRow)
    if (decoded) return decoded
  }

  return null
}

/** Giải mã từ file ảnh chụp trực tiếp trên điện thoại (<input type="file" accept="image/*" capture="environment">) */
export async function decodeBarcodeFromImageFile(file: File): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file)
      try {
        return await detectBarcodeUniversal(bmp)
      } finally {
        bmp.close()
      }
    } catch {
      // fallback FileReader -> Image
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = async () => {
      try {
        const res = await detectBarcodeUniversal(img)
        resolve(res)
      } catch {
        resolve(null)
      } finally {
        URL.revokeObjectURL(url)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

/** Phát âm báo tít siêu thị chuẩn POS (0 file ngoài) */
export function playPosBeep(kind: 'scan' | 'checkout' | 'shopee' | 'error' = 'scan'): void {
  if (typeof window === 'undefined') return
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    const now = ctx.currentTime
    if (kind === 'scan') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1480, now)
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09)
      osc.start(now)
      osc.stop(now + 0.095)
    } else if (kind === 'checkout') {
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.setValueAtTime(1320, now + 0.08)
      gain.gain.setValueAtTime(0.14, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      osc.start(now)
      osc.stop(now + 0.23)
    } else if (kind === 'shopee') {
      osc.type = 'sine'
      osc.frequency.setValueAtTime(1046, now)
      osc.frequency.setValueAtTime(1568, now + 0.09)
      gain.gain.setValueAtTime(0.14, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24)
      osc.start(now)
      osc.stop(now + 0.25)
    } else {
      osc.type = 'sawtooth'
      osc.frequency.setValueAtTime(240, now)
      gain.gain.setValueAtTime(0.12, now)
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
      osc.start(now)
      osc.stop(now + 0.19)
    }
    setTimeout(() => {
      void ctx.close().catch(() => null)
    }, 350)
  } catch {
    // Trình duyệt khóa autoplay audio trước khi chạm lần đầu — bỏ qua an toàn
  }
}
