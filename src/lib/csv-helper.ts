/**
 * Standard CSV Helper (RFC 4180 compliant)
 * Handles UTF-8 BOM, quoted cells with commas, quotes, and newlines.
 */

export interface ProductImportError {
  row: number
  sku: string
  field: string
  message: string
}

export interface ValidatedProductItem {
  row: number
  sku: string
  name: string
  costPrice: number
  sellPrice: number
  stock: number
  unit: string
  type: string
  barcode: string | null
  category: string
  status: string
}

export const EXPORT_CSV_HEADERS = [
  'sku',
  'name',
  'costPrice',
  'sellPrice',
  'stock',
  'unit',
  'type',
  'barcode',
  'category',
  'status',
] as const

const ALLOWED_TYPES = new Set(['SIMPLE', 'COMBO', 'SERVICE', 'MANUFACTURED'])

/**
 * Escapes a single CSV value according to RFC 4180.
 * If the value contains commas, quotes, or newlines, encloses in double quotes
 * and doubles any internal double quotes.
 */
export function escapeCsvCell(val: unknown): string {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Formats headers and data rows into a CSV string with \uFEFF UTF-8 BOM.
 */
export function stringifyCsv(
  headers: readonly string[] | string[],
  rows: unknown[][]
): string {
  const headerLine = headers.map(escapeCsvCell).join(',')
  const dataLines = rows.map((row) => row.map(escapeCsvCell).join(','))
  return '\uFEFF\uFEFF\uFEFF' + [headerLine, ...dataLines].join('\r\n')
}

/**
 * Parses raw CSV string into a 2D array of string cells.
 * Strips \uFEFF BOM if present.
 * Properly parses RFC 4180 quotes, escaped quotes (""), commas, and CRLF / LF.
 */
export function parseCsv(text: string): string[][] {
  let input = text
  while (input.charCodeAt(0) === 0xfeff) {
    input = input.slice(1)
  }

  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < input.length && input[i + 1] === '"') {
          // Escaped quote
          currentField += '"'
          i++
        } else {
          // Closing quote
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentRow.push(currentField)
        currentField = ''
      } else if (char === '\r') {
        // Handle \r\n or standalone \r
        if (i + 1 < input.length && input[i + 1] === '\n') {
          i++
        }
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else if (char === '\n') {
        currentRow.push(currentField)
        rows.push(currentRow)
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }

  // Push remaining field and row
  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
  }

  // Trim trailing empty rows (e.g. empty line at EOF)
  while (rows.length > 0) {
    const lastRow = rows[rows.length - 1]
    if (lastRow.length === 0 || (lastRow.length === 1 && lastRow[0].trim() === '')) {
      rows.pop()
    } else {
      break
    }
  }

  return rows
}

/**
 * Normalizes a header cell to standard internal field name.
 */
export function normalizeHeaderKey(header: string): string {
  const clean = header.trim().toLowerCase().replace(/[\s_\-]+/g, '')
  if (clean === 'sku' || clean === 'mãsku' || clean === 'masku') return 'sku'
  if (clean === 'name' || clean === 'tensanpham' || clean === 'tênsảnphẩm' || clean === 'ten' || clean === 'tên') return 'name'
  if (clean === 'costprice' || clean === 'giavon' || clean === 'giávốn' || clean === 'cost') return 'costPrice'
  if (clean === 'sellprice' || clean === 'giaban' || clean === 'giábán' || clean === 'price' || clean === 'retailprice') return 'sellPrice'
  if (clean === 'stock' || clean === 'tonkho' || clean === 'tồnkho' || clean === 'ton' || clean === 'tồn' || clean === 'quantity' || clean === 'soluong' || clean === 'sốlượng') return 'stock'
  if (clean === 'unit' || clean === 'donvi' || clean === 'đơnvị' || clean === 'dvt' || clean === 'đvt') return 'unit'
  if (clean === 'type' || clean === 'loai' || clean === 'loại' || clean === 'loaisp' || clean === 'loạisp') return 'type'
  if (clean === 'barcode' || clean === 'mavach' || clean === 'mãvạch') return 'barcode'
  if (clean === 'category' || clean === 'danhmuc' || clean === 'danhmục' || clean === 'nhomhang' || clean === 'nhómhàng') return 'category'
  if (clean === 'status' || clean === 'trangthai' || clean === 'trạngthái') return 'status'
  return clean
}

/**
 * Parses CSV raw text into validated product items or validation errors.
 */
export function validateProductCsv(csvText: string): {
  items: ValidatedProductItem[]
  errors: ProductImportError[]
} {
  const rawRows = parseCsv(csvText)
  if (rawRows.length === 0) {
    return {
      items: [],
      errors: [{ row: 1, sku: '', field: 'file', message: 'Tệp CSV không có dữ liệu' }],
    }
  }

  const headerRow = rawRows[0]
  const headerMap: Record<string, number> = {}
  headerRow.forEach((col, idx) => {
    const key = normalizeHeaderKey(col)
    headerMap[key] = idx
  })

  // Verify mandatory columns exist in header
  const requiredFields = ['sku', 'name', 'costPrice', 'sellPrice', 'stock']
  const missingHeaders = requiredFields.filter((f) => headerMap[f] === undefined)
  if (missingHeaders.length > 0) {
    return {
      items: [],
      errors: [
        {
          row: 1,
          sku: '',
          field: 'header',
          message: `Tiêu đề cột thiếu các trường bắt buộc: ${missingHeaders.join(', ')}`,
        },
      ],
    }
  }

  const errors: ProductImportError[] = []
  const items: ValidatedProductItem[] = []

  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i]
    const rowNumber = i + 1

    // If completely empty line, skip
    if (row.length === 0 || row.every((c) => !c.trim())) {
      continue
    }

    const rawSku = headerMap.sku !== undefined ? (row[headerMap.sku] ?? '') : ''
    const rawName = headerMap.name !== undefined ? (row[headerMap.name] ?? '') : ''
    const rawCostPrice = headerMap.costPrice !== undefined ? (row[headerMap.costPrice] ?? '') : ''
    const rawSellPrice = headerMap.sellPrice !== undefined ? (row[headerMap.sellPrice] ?? '') : ''
    const rawStock = headerMap.stock !== undefined ? (row[headerMap.stock] ?? '') : ''
    const rawUnit = headerMap.unit !== undefined ? (row[headerMap.unit] ?? '') : ''
    const rawType = headerMap.type !== undefined ? (row[headerMap.type] ?? '') : ''
    const rawBarcode = headerMap.barcode !== undefined ? (row[headerMap.barcode] ?? '') : ''
    const rawCategory = headerMap.category !== undefined ? (row[headerMap.category] ?? '') : ''
    const rawStatus = headerMap.status !== undefined ? (row[headerMap.status] ?? '') : ''

    const sku = rawSku.trim()
    const name = rawName.trim()

    const initialErrorCount = errors.length

    // 1. SKU validation
    if (!sku) {
      errors.push({ row: rowNumber, sku: '', field: 'sku', message: 'Mã SKU không được để trống' })
    }

    // 2. Name validation
    if (!name) {
      errors.push({ row: rowNumber, sku, field: 'name', message: 'Tên sản phẩm không được để trống' })
    }

    // 3. CostPrice validation
    let costPrice = 0
    if (rawCostPrice !== undefined && rawCostPrice.trim() !== '') {
      const parsedCost = Number(rawCostPrice.trim())
      if (Number.isNaN(parsedCost) || parsedCost < 0) {
        errors.push({ row: rowNumber, sku, field: 'costPrice', message: 'Giá vốn không được nhỏ hơn 0' })
      } else {
        costPrice = parsedCost
      }
    }

    // 4. SellPrice validation
    let sellPrice = 0
    if (rawSellPrice === undefined || rawSellPrice.trim() === '') {
      errors.push({ row: rowNumber, sku, field: 'sellPrice', message: 'Giá bán không được nhỏ hơn 0' })
    } else {
      const parsedSell = Number(rawSellPrice.trim())
      if (Number.isNaN(parsedSell) || parsedSell < 0) {
        errors.push({ row: rowNumber, sku, field: 'sellPrice', message: 'Giá bán không được nhỏ hơn 0' })
      } else {
        sellPrice = parsedSell
      }
    }

    // 5. Type validation
    let productType = 'SIMPLE'
    const trimmedType = rawType.trim()
    if (trimmedType) {
      const upperType = trimmedType.toUpperCase()
      if (!ALLOWED_TYPES.has(upperType)) {
        errors.push({ row: rowNumber, sku, field: 'type', message: 'Loại sản phẩm không hợp lệ' })
      } else {
        productType = upperType
      }
    }

    // Stock
    const parsedStock = Number(rawStock.trim())
    const stock = !Number.isNaN(parsedStock) && parsedStock >= 0 ? Math.floor(parsedStock) : 0

    // Unit
    const unit = rawUnit.trim() || 'sp'

    // Barcode
    const barcode = rawBarcode.trim() || null

    // Category
    const category = rawCategory.trim()

    // Status
    const status = rawStatus.trim().toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'

    if (errors.length === initialErrorCount) {
      items.push({
        row: rowNumber,
        sku,
        name,
        costPrice,
        sellPrice,
        stock,
        unit,
        type: productType,
        barcode,
        category,
        status,
      })
    }
  }

  if (errors.length > 0) {
    return { items: [], errors }
  }

  return { items, errors }
}
