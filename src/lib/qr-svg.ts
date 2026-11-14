/**
 * Pure TypeScript ISO/IEC 18004 QR Code SVG Generator (Versions 1..8, Level L, Byte Mode).
 * Chạy 100% offline trên LAN nội bộ (< 1ms), không gọi API bên ngoài, không phụ thuộc thư viện npm.
 */

interface QrVersionSpec {
  version: number
  dataCodewords: number
  ecCodewordsPerBlock: number
  numBlocks: number
  alignmentCenters: number[]
  versionBits?: number
}

const QR_VERSIONS_L: QrVersionSpec[] = [
  { version: 1, dataCodewords: 19, ecCodewordsPerBlock: 7, numBlocks: 1, alignmentCenters: [] },
  { version: 2, dataCodewords: 34, ecCodewordsPerBlock: 10, numBlocks: 1, alignmentCenters: [6, 18] },
  { version: 3, dataCodewords: 55, ecCodewordsPerBlock: 15, numBlocks: 1, alignmentCenters: [6, 22] },
  { version: 4, dataCodewords: 80, ecCodewordsPerBlock: 20, numBlocks: 1, alignmentCenters: [6, 26] },
  { version: 5, dataCodewords: 108, ecCodewordsPerBlock: 26, numBlocks: 1, alignmentCenters: [6, 30] },
  { version: 6, dataCodewords: 136, ecCodewordsPerBlock: 18, numBlocks: 2, alignmentCenters: [6, 34] },
  { version: 7, dataCodewords: 156, ecCodewordsPerBlock: 20, numBlocks: 2, alignmentCenters: [6, 22, 38], versionBits: 0x07c94 },
  { version: 8, dataCodewords: 194, ecCodewordsPerBlock: 24, numBlocks: 2, alignmentCenters: [6, 24, 42], versionBits: 0x085bc },
]

// GF(256) với đa thức nguyên thủy 0x11D
const GF_EXP = new Uint8Array(512)
const GF_LOG = new Uint8Array(256)
;(() => {
  let x = 1
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x
    GF_LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255]
  }
})()

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0
  return GF_EXP[GF_LOG[a] + GF_LOG[b]]
}

function buildGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1])
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1)
    const root = GF_EXP[i]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= gfMul(poly[j], root)
    }
    poly = next
  }
  return poly
}

function reedSolomonRemainder(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = buildGeneratorPoly(ecLen)
  const rem = new Uint8Array(ecLen)
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0]
    rem.copyWithin(0, 1)
    rem[ecLen - 1] = 0
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor)
      }
    }
  }
  return rem
}

function computeFormatBits(ecLevelBits: number, mask: number): number {
  const data = ((ecLevelBits << 3) | mask) & 0x1f
  let rem = data << 10
  for (let i = 14; i >= 10; i--) {
    if ((rem >> i) & 1) {
      rem ^= 0x537 << (i - 10)
    }
  }
  return (((data << 10) | rem) ^ 0x5412) & 0x7fff
}

function placeFinderPattern(grid: (number | null)[][], reserved: boolean[][], row: number, col: number) {
  const size = grid.length
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r
      const cc = col + c
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue
      const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6
      const onBorder = r === 0 || r === 6 || c === 0 || c === 6
      const inCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4
      grid[rr][cc] = inOuter && (onBorder || inCenter) ? 1 : 0
      reserved[rr][cc] = true
    }
  }
}

function placeAlignmentPattern(grid: (number | null)[][], reserved: boolean[][], centerR: number, centerC: number) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = centerR + r
      const cc = centerC + c
      const dist = Math.max(Math.abs(r), Math.abs(c))
      grid[rr][cc] = dist === 2 || dist === 0 ? 1 : 0
      reserved[rr][cc] = true
    }
  }
}

export function encodeQrMatrix(text: string): boolean[][] {
  const payload = new TextEncoder().encode(text)
  const spec = QR_VERSIONS_L.find((s) => payload.length + 2 <= s.dataCodewords)
  if (!spec) {
    throw new Error(`Chuỗi QR vượt quá giới hạn offline (${payload.length} bytes > 192 bytes)`)
  }

  // 1. Mã hóa luồng bit Byte Mode (0100) + Length (8-bit cho V1..9) + Payload + Terminator
  const bits: number[] = []
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1)
    }
  }

  pushBits(0b0100, 4)
  pushBits(payload.length, 8)
  for (const byte of payload) {
    pushBits(byte, 8)
  }

  const maxDataBits = spec.dataCodewords * 8
  const terminatorLen = Math.min(4, maxDataBits - bits.length)
  pushBits(0, terminatorLen)
  while (bits.length % 8 !== 0) bits.push(0)

  const dataBytes = new Uint8Array(spec.dataCodewords)
  for (let i = 0; i < bits.length / 8; i++) {
    let b = 0
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j]
    }
    dataBytes[i] = b
  }
  const padBytes = [0xec, 0x11]
  for (let i = bits.length / 8, p = 0; i < spec.dataCodewords; i++, p++) {
    dataBytes[i] = padBytes[p % 2]
  }

  // 2. Chia block và tính Reed-Solomon ECC + Interleave
  const blockDataLen = Math.floor(spec.dataCodewords / spec.numBlocks)
  const dataBlocks: Uint8Array[] = []
  const ecBlocks: Uint8Array[] = []
  let offset = 0
  for (let b = 0; b < spec.numBlocks; b++) {
    const slice = dataBytes.subarray(offset, offset + blockDataLen)
    offset += blockDataLen
    dataBlocks.push(slice)
    ecBlocks.push(reedSolomonRemainder(slice, spec.ecCodewordsPerBlock))
  }

  const finalCodewords: number[] = []
  for (let i = 0; i < blockDataLen; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(dataBlocks[b][i])
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i])
    }
  }

  // 3. Khởi tạo ma trận module
  const size = spec.version * 4 + 17
  const grid: (number | null)[][] = Array.from({ length: size }, () => Array<number | null>(size).fill(null))
  const reserved: boolean[][] = Array.from({ length: size }, () => Array<boolean>(size).fill(false))

  placeFinderPattern(grid, reserved, 0, 0)
  placeFinderPattern(grid, reserved, 0, size - 7)
  placeFinderPattern(grid, reserved, size - 7, 0)

  // Alignment patterns
  const centers = spec.alignmentCenters
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      const r = centers[i]
      const c = centers[j]
      if (reserved[r][c]) continue
      placeAlignmentPattern(grid, reserved, r, c)
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) {
      grid[6][i] = i % 2 === 0 ? 1 : 0
      reserved[6][i] = true
    }
    if (!reserved[i][6]) {
      grid[i][6] = i % 2 === 0 ? 1 : 0
      reserved[i][6] = true
    }
  }

  // Dark module & Format reserved areas
  grid[size - 8][8] = 1
  reserved[size - 8][8] = true

  for (let i = 0; i < 9; i++) {
    if (i < size) {
      reserved[8][i] = true
      reserved[i][8] = true
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true
    reserved[size - 1 - i][8] = true
  }

  // Version bits (V7+)
  if (spec.version >= 7 && spec.versionBits) {
    for (let i = 0; i < 18; i++) {
      const bit = (spec.versionBits >> i) & 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      grid[b][a] = bit
      reserved[b][a] = true
      grid[a][b] = bit
      reserved[a][b] = true
    }
  }

  // 4. Điền dữ liệu theo đường zigzag chuẩn QR
  const streamBits: number[] = []
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) streamBits.push((cw >> i) & 1)
  }

  let bitIdx = 0
  let upward = true
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      const r = upward ? size - 1 - vert : vert
      for (let j = 0; j < 2; j++) {
        const c = right - j
        if (!reserved[r][c]) {
          const rawBit = bitIdx < streamBits.length ? streamBits[bitIdx++] : 0
          // Mask 0: (r + c) % 2 === 0
          const masked = (r + c) % 2 === 0 ? rawBit ^ 1 : rawBit
          grid[r][c] = masked
        }
      }
    }
    upward = !upward
  }

  // 5. Ghi 15 bit Format Info (Level L = 0b01, Mask = 0)
  const formatBits = computeFormatBits(0b01, 0)
  const fCoords1: Array<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]
  const fCoords2: Array<[number, number]> = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ]
  for (let i = 0; i < 15; i++) {
    const bit = (formatBits >> i) & 1
    const [r1, c1] = fCoords1[14 - i]
    const [r2, c2] = fCoords2[14 - i]
    grid[r1][c1] = bit
    grid[r2][c2] = bit
  }

  return grid.map((row) => row.map((cell) => cell === 1))
}

export function qrCodeSvg(
  text: string,
  options?: { size?: number; margin?: number; darkColor?: string; lightColor?: string }
): string {
  const matrix = encodeQrMatrix(text)
  const modules = matrix.length
  const margin = options?.margin ?? 3
  const totalModules = modules + margin * 2
  const pxSize = options?.size ?? 200
  const dark = options?.darkColor ?? '#0F1E36'
  const light = options?.lightColor ?? '#FFFFFF'

  const paths: string[] = []
  for (let r = 0; r < modules; r++) {
    for (let c = 0; c < modules; c++) {
      if (matrix[r][c]) {
        paths.push(`M${c + margin},${r + margin}h1v1h-1z`)
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pxSize}" height="${pxSize}" viewBox="0 0 ${totalModules} ${totalModules}" shape-rendering="crispEdges" role="img" aria-label="Mã QR ghép nối thiết bị"><rect width="${totalModules}" height="${totalModules}" fill="${light}"/><path d="${paths.join('')}" fill="${dark}"/></svg>`
}
