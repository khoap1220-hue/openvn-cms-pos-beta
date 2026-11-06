// ĐỌC SỐ TIỀN BẰNG CHỮ TIẾNG VIỆT — dùng cho dòng "Số tiền viết bằng chữ" trên hóa đơn.
// Ví dụ: 1234500 → "Một triệu hai trăm ba mươi bốn nghìn năm trăm đồng chẵn"

const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']
const SCALES = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ']

/** Đọc 1 nhóm 3 chữ số (0..999), trả về chuỗi có thể rỗng nếu group = 0 */
function readGroup3(n: number): string {
  const hundreds = Math.floor(n / 100)
  const tens = Math.floor((n % 100) / 10)
  const units = n % 10
  const parts: string[] = []

  if (hundreds > 0) {
    parts.push(`${DIGITS[hundreds]} trăm`)
  }

  if (tens === 0) {
    if (units > 0) parts.push(hundreds > 0 ? `lẻ ${DIGITS[units]}` : DIGITS[units])
  } else if (tens === 1) {
    parts.push('mười')
    if (units === 5) parts.push('lăm')
    else if (units > 0) parts.push(DIGITS[units])
  } else {
    parts.push(`${DIGITS[tens]} mươi`)
    if (units === 1) parts.push('mốt')
    else if (units === 5) parts.push('lăm')
    else if (units > 0) parts.push(DIGITS[units])
  }

  return parts.join(' ')
}

/** Đọc số nguyên (hỗ trợ tới nghìn tỷ) thành chữ thường, không đơn vị */
export function docSoNguyen(value: number): string {
  if (!Number.isFinite(value)) return 'không'
  const n = Math.floor(Math.abs(value))
  if (n === 0) return 'không'
  if (n >= 10_000_000_000_000) return n.toLocaleString('vi-VN') // quá nghìn tỷ — trả dạng số

  const groups: number[] = []
  let rest = n
  while (rest > 0) {
    groups.push(rest % 1000)
    rest = Math.floor(rest / 1000)
  }

  const parts: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i]
    if (g === 0) continue
    const scale = SCALES[i] ?? ''
    let chunk = readGroup3(g)
    // nhóm trăm = 0 nhưng nhóm không phải đầu tiên → cần "không trăm" khi có hàng trăm ẩn
    if (Math.floor(g / 100) === 0 && i < groups.length - 1 && i > 0) chunk = `không trăm ${chunk}`
    parts.push(`${chunk}${scale}`)
  }
  return parts.join(' ')
}

/** Số tiền (VNĐ) → chữ viết trên hóa đơn. Ví dụ 105000 → "Một trăm lẻ năm nghìn đồng chẵn" */
export function docSoTienBangChu(amount: number): string {
  const rounded = Math.round(Number(amount) || 0)
  if (rounded === 0) return 'Không đồng'
  const words = docSoNguyen(rounded)
  const text = words.charAt(0).toUpperCase() + words.slice(1)
  return `${text} đồng chẵn`
}
