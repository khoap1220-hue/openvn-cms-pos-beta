/**
 * Pure-TypeScript Isomorphic OpenXML (.xlsx) Workbook Writer (Node.js + Browser)
 * Zero external dependencies — supports synchronous Node.js DEFLATE (`zlib.deflateRawSync`)
 * and browser/edge Web Standard `CompressionStream('deflate-raw')` + IEEE 802.3 CRC-32.
 * Supports multi-sheet workbooks, live Excel formulas (<f>) with precomputed cached values (<v>),
 * Excel serial dates (yyyy-mm-dd), styles (headers, yellow input cells "ô vàng", alerts, totals),
 * column widths, merged cells, and freeze panes.
 */

export type XlsxStyleKey =
  | 'default'
  | 'title'
  | 'subtitle'
  | 'section'
  | 'header'
  | 'headerRight'
  | 'headerCenter'
  | 'text'
  | 'textCenter'
  | 'textMuted'
  | 'textBold'
  | 'number'
  | 'decimal'
  | 'currency'
  | 'currencyBold'
  | 'percent'
  | 'percentBold'
  | 'date'
  | 'yellowText'
  | 'yellowCenter'
  | 'yellowNumber'
  | 'yellowDecimal'
  | 'yellowCurrency'
  | 'yellowDate'
  | 'formulaText'
  | 'formulaCenter'
  | 'formulaNumber'
  | 'formulaDecimal'
  | 'formulaCurrency'
  | 'formulaPercent'
  | 'formulaDate'
  | 'totalLabel'
  | 'totalNumber'
  | 'totalCurrency'
  | 'totalPercent'
  | 'alertWarn'
  | 'alertDanger'
  | 'alertOk'

export interface XlsxCellSpec {
  /** Scalar value (or cached result when `formula` is provided) */
  v?: string | number | boolean | null
  /** Excel formula (leading '=' is stripped automatically, XML-escaped on write) */
  f?: string
  /** Named style preset */
  s?: XlsxStyleKey
  /** Force value to be stored as Excel serial date (accepts 'YYYY-MM-DD' or Date) */
  isDate?: boolean
}

export type XlsxCellInput = string | number | boolean | null | undefined | XlsxCellSpec

export interface XlsxMergeRange {
  startRow: number // 1-based
  startCol: number // 1-based
  endRow: number // 1-based
  endCol: number // 1-based
}

export interface XlsxSheetSpec {
  /** Excel sheet tab name (max 31 chars) */
  name: string
  /** Tab accent color hex (6-char RGB, e.g. '0066CC') */
  tabColor?: string
  /** Column widths in character units */
  colWidths?: number[]
  /** Freeze rows from top (e.g. 4 freezes rows 1..4) */
  freezeRows?: number
  /** Freeze columns from left */
  freezeCols?: number
  /** Merged cell ranges */
  merges?: XlsxMergeRange[]
  /** 2D array of rows -> cells */
  rows: XlsxCellInput[][]
}

// ============================================================================
// Helpers: Column letters, Excel date serial, XML escaping
// ============================================================================

const utf8Encoder = new TextEncoder()

export function colIndexToLetter(col1Based: number): string {
  let n = col1Based
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

export function cellRef(row1Based: number, col1Based: number): string {
  return `${colIndexToLetter(col1Based)}${row1Based}`
}

/**
 * Converts 'YYYY-MM-DD' (or ISO timestamp / Date) into Excel 1900-system serial day number.
 * Returns null if invalid.
 */
export function toExcelDateSerial(input: string | Date | null | undefined): number | null {
  if (!input) return null
  let y: number
  let m: number
  let d: number
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null
    y = input.getFullYear()
    m = input.getMonth() + 1
    d = input.getDate()
  } else {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(input.trim())
    if (!match) return null
    y = Number(match[1])
    m = Number(match[2])
    d = Number(match[3])
  }
  const utcMs = Date.UTC(y, m - 1, d)
  const excelEpochMs = Date.UTC(1899, 11, 30)
  return Math.round((utcMs - excelEpochMs) / 86_400_000)
}

function escapeXml(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function sanitizeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*\[\]]/g, '_').trim()
  return cleaned.slice(0, 31) || 'Sheet'
}

// ============================================================================
// Stylesheet Registry (xl/styles.xml)
// ============================================================================

const STYLE_INDEX: Record<XlsxStyleKey, number> = {
  default: 0,
  title: 1,
  subtitle: 2,
  section: 3,
  header: 4,
  headerRight: 5,
  headerCenter: 6,
  text: 7,
  textCenter: 8,
  textMuted: 9,
  textBold: 10,
  number: 11,
  decimal: 12,
  currency: 13,
  currencyBold: 14,
  percent: 15,
  percentBold: 16,
  date: 17,
  yellowText: 18,
  yellowCenter: 19,
  yellowNumber: 20,
  yellowDecimal: 21,
  yellowCurrency: 22,
  yellowDate: 23,
  formulaText: 24,
  formulaCenter: 25,
  formulaNumber: 26,
  formulaDecimal: 27,
  formulaCurrency: 28,
  formulaPercent: 29,
  formulaDate: 30,
  totalLabel: 31,
  totalNumber: 32,
  totalCurrency: 33,
  totalPercent: 34,
  alertWarn: 35,
  alertDanger: 36,
  alertOk: 37,
}

function buildStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="#,##0;(#,##0);&quot;-&quot;"/>
    <numFmt numFmtId="165" formatCode="0.0%"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <fonts count="10">
    <font><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><b/><sz val="13"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><i/><sz val="9.5"/><color rgb="FF475569"/><name val="Arial"/></font>
    <font><b/><sz val="10.5"/><color rgb="FF0369A1"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Arial"/></font>
    <font><sz val="9.5"/><color rgb="FF64748B"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFB45309"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FFBE123C"/><name val="Arial"/></font>
    <font><b/><sz val="10"/><color rgb="FF047857"/><name val="Arial"/></font>
  </fonts>
  <fills count="9">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFEF9C3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFECFDF5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFBEB"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF1F2"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="3">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFCBD5E1"/></left>
      <right style="thin"><color rgb="FFCBD5E1"/></right>
      <top style="thin"><color rgb="FFCBD5E1"/></top>
      <bottom style="thin"><color rgb="FFCBD5E1"/></bottom>
      <diagonal/>
    </border>
    <border>
      <left style="thin"><color rgb="FF94A3B8"/></left>
      <right style="thin"><color rgb="FF94A3B8"/></right>
      <top style="medium"><color rgb="FF475569"/></top>
      <bottom style="double"><color rgb="FF475569"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="38">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <!-- 1: title -->
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 2: subtitle -->
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <!-- 3: section -->
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <!-- 4: header -->
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <!-- 5: headerRight -->
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center" wrapText="1"/></xf>
    <!-- 6: headerCenter -->
    <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <!-- 7: text -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 8: textCenter -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 9: textMuted -->
    <xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 10: textBold -->
    <xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 11: number -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 12: decimal -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 13: currency -->
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 14: currencyBold -->
    <xf numFmtId="164" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 15: percent -->
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 16: percentBold -->
    <xf numFmtId="165" fontId="5" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 17: date -->
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 18: yellowText -->
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 19: yellowCenter -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 20: yellowNumber -->
    <xf numFmtId="164" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 21: yellowDecimal -->
    <xf numFmtId="0" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 22: yellowCurrency -->
    <xf numFmtId="164" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 23: yellowDate -->
    <xf numFmtId="166" fontId="5" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 24: formulaText -->
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 25: formulaCenter -->
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 26: formulaNumber -->
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 27: formulaDecimal -->
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 28: formulaCurrency -->
    <xf numFmtId="164" fontId="5" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 29: formulaPercent -->
    <xf numFmtId="165" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 30: formulaDate -->
    <xf numFmtId="166" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 31: totalLabel -->
    <xf numFmtId="0" fontId="5" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <!-- 32: totalNumber -->
    <xf numFmtId="164" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 33: totalCurrency -->
    <xf numFmtId="164" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 34: totalPercent -->
    <xf numFmtId="165" fontId="5" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <!-- 35: alertWarn -->
    <xf numFmtId="0" fontId="7" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 36: alertDanger -->
    <xf numFmtId="0" fontId="8" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <!-- 37: alertOk -->
    <xf numFmtId="0" fontId="9" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1">
    <cellStyle name="Normal" xfId="0" builtinId="0"/>
  </cellStyles>
</styleSheet>`
}

// ============================================================================
// Worksheet & SharedStrings Builder
// ============================================================================

class SharedStringsTable {
  private map = new Map<string, number>()
  private list: string[] = []
  public totalRefs = 0

  public intern(str: string): number {
    this.totalRefs++
    const existing = this.map.get(str)
    if (existing !== undefined) return existing
    const idx = this.list.length
    this.list.push(str)
    this.map.set(str, idx)
    return idx
  }

  public toXml(): string {
    const items = this.list
      .map((s) => {
        const preserve = /^\s|\s$|\n|\r|\t/.test(s) ? ' xml:space="preserve"' : ''
        return `<si><t${preserve}>${escapeXml(s)}</t></si>`
      })
      .join('')
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.totalRefs}" uniqueCount="${this.list.length}">${items}</sst>`
  }
}

function normalizeCell(raw: XlsxCellInput): XlsxCellSpec | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
    return { v: raw }
  }
  return raw
}

function buildWorksheetXml(sheet: XlsxSheetSpec, sst: SharedStringsTable): string {
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`,
  ]

  if (sheet.tabColor) {
    const rgb = sheet.tabColor.replace(/^#/, '').toUpperCase()
    const argb = rgb.length === 6 ? `FF${rgb}` : rgb
    parts.push(`<sheetPr><tabColor rgb="${argb}"/></sheetPr>`)
  }

  // SheetViews (freeze panes)
  const fRows = sheet.freezeRows ?? 0
  const fCols = sheet.freezeCols ?? 0
  if (fRows > 0 || fCols > 0) {
    const topLeft = cellRef(fRows + 1, fCols + 1)
    const activePane = fRows > 0 && fCols > 0 ? 'bottomRight' : fRows > 0 ? 'bottomLeft' : 'topRight'
    const xSplitAttr = fCols > 0 ? ` xSplit="${fCols}"` : ''
    const ySplitAttr = fRows > 0 ? ` ySplit="${fRows}"` : ''
    parts.push(
      `<sheetViews><sheetView workbookViewId="0"><pane${xSplitAttr}${ySplitAttr} topLeftCell="${topLeft}" activePane="${activePane}" state="frozen"/><selection pane="${activePane}" activeCell="${topLeft}" sqref="${topLeft}"/></sheetView></sheetViews>`
    )
  } else {
    parts.push(`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`)
  }

  parts.push(`<sheetFormatPr defaultRowHeight="19"/>`)

  // Column widths
  if (sheet.colWidths && sheet.colWidths.length > 0) {
    parts.push(`<cols>`)
    sheet.colWidths.forEach((w, idx) => {
      const cIdx = idx + 1
      parts.push(`<col min="${cIdx}" max="${cIdx}" width="${Math.max(4, w)}" customWidth="1"/>`)
    })
    parts.push(`</cols>`)
  }

  // SheetData
  parts.push(`<sheetData>`)
  for (let rIdx = 0; rIdx < sheet.rows.length; rIdx++) {
    const row = sheet.rows[rIdx]
    if (!row || row.length === 0) continue
    const rowNum = rIdx + 1
    const rowCells: string[] = []
    let customHeight = ''
    if (rowNum === 1) customHeight = ' ht="26" customHeight="1"'
    else if (rowNum === 2) customHeight = ' ht="24" customHeight="1"'
    else if (sheet.freezeRows && rowNum === sheet.freezeRows) customHeight = ' ht="26" customHeight="1"'

    for (let cIdx = 0; cIdx < row.length; cIdx++) {
      const cell = normalizeCell(row[cIdx])
      if (!cell) continue
      const ref = cellRef(rowNum, cIdx + 1)
      const styleIdx = cell.s ? STYLE_INDEX[cell.s] ?? 0 : 0
      const sAttr = styleIdx > 0 ? ` s="${styleIdx}"` : ''

      let val = cell.v
      if (cell.isDate && typeof val === 'string' && val.trim() !== '') {
        const serial = toExcelDateSerial(val)
        if (serial !== null) val = serial
      }

      if (cell.f !== undefined && cell.f !== '') {
        const cleanFormula = cell.f.startsWith('=') ? cell.f.slice(1) : cell.f
        if (typeof val === 'number' && Number.isFinite(val)) {
          rowCells.push(`<c r="${ref}"${sAttr}><f>${escapeXml(cleanFormula)}</f><v>${val}</v></c>`)
        } else if (typeof val === 'boolean') {
          rowCells.push(`<c r="${ref}" t="b"${sAttr}><f>${escapeXml(cleanFormula)}</f><v>${val ? 1 : 0}</v></c>`)
        } else if (typeof val === 'string') {
          rowCells.push(`<c r="${ref}" t="str"${sAttr}><f>${escapeXml(cleanFormula)}</f><v>${escapeXml(val)}</v></c>`)
        } else {
          rowCells.push(`<c r="${ref}"${sAttr}><f>${escapeXml(cleanFormula)}</f></c>`)
        }
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        rowCells.push(`<c r="${ref}"${sAttr}><v>${val}</v></c>`)
      } else if (typeof val === 'boolean') {
        rowCells.push(`<c r="${ref}" t="b"${sAttr}><v>${val ? 1 : 0}</v></c>`)
      } else if (typeof val === 'string' && val !== '') {
        const sstIdx = sst.intern(val)
        rowCells.push(`<c r="${ref}" t="s"${sAttr}><v>${sstIdx}</v></c>`)
      } else if (styleIdx > 0) {
        rowCells.push(`<c r="${ref}"${sAttr}/>`)
      }
    }

    if (rowCells.length > 0) {
      parts.push(`<row r="${rowNum}"${customHeight}>${rowCells.join('')}</row>`)
    }
  }
  parts.push(`</sheetData>`)

  // Merged ranges
  if (sheet.merges && sheet.merges.length > 0) {
    parts.push(`<mergeCells count="${sheet.merges.length}">`)
    for (const m of sheet.merges) {
      parts.push(`<mergeCell ref="${cellRef(m.startRow, m.startCol)}:${cellRef(m.endRow, m.endCol)}"/>`)
    }
    parts.push(`</mergeCells>`)
  }

  parts.push(`</worksheet>`)
  return parts.join('')
}

// ============================================================================
// ZIP Packaging (PKZIP 2.0 + Raw Deflate / Store + IEEE 802.3 CRC-32)
// ============================================================================

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipEntryInput {
  path: string
  data: Uint8Array
}

interface PreparedZipEntry {
  path: string
  uncompressed: Uint8Array
  compressed: Uint8Array
  method: 0 | 8
  crc: number
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (const c of chunks) total += c.byteLength
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function assembleZipArchive(entries: PreparedZipEntry[]): Uint8Array {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const nameBuf = utf8Encoder.encode(entry.path)
    const { uncompressed, compressed, method, crc } = entry

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30)
    const lv = new DataView(localHeader.buffer)
    lv.setUint32(0, 0x04034b50, true) // signature
    lv.setUint16(4, 20, true) // version needed (2.0)
    lv.setUint16(6, 0, true) // general purpose bit flag
    lv.setUint16(8, method, true) // 8 = DEFLATE, 0 = STORE
    lv.setUint16(10, 0, true) // mod time
    lv.setUint16(12, 0x5776, true) // mod date (2026-11-22)
    lv.setUint32(14, crc, true) // crc-32
    lv.setUint32(18, compressed.byteLength, true) // compressed size
    lv.setUint32(22, uncompressed.byteLength, true) // uncompressed size
    lv.setUint16(26, nameBuf.byteLength, true) // file name length
    lv.setUint16(28, 0, true) // extra field length

    localChunks.push(localHeader, nameBuf, compressed)

    // Central directory file header (46 bytes + filename)
    const centralHeader = new Uint8Array(46)
    const cv = new DataView(centralHeader.buffer)
    cv.setUint32(0, 0x02014b50, true) // signature
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0, true) // flags
    cv.setUint16(10, method, true) // compression method
    cv.setUint16(12, 0, true) // mod time
    cv.setUint16(14, 0x5776, true) // mod date
    cv.setUint32(16, crc, true)
    cv.setUint32(20, compressed.byteLength, true)
    cv.setUint32(24, uncompressed.byteLength, true)
    cv.setUint16(28, nameBuf.byteLength, true)
    cv.setUint16(30, 0, true) // extra length
    cv.setUint16(32, 0, true) // comment length
    cv.setUint16(34, 0, true) // disk number start
    cv.setUint16(36, 0, true) // internal attrs
    cv.setUint32(38, 0, true) // external attrs
    cv.setUint32(42, localOffset, true) // relative offset of local header

    centralChunks.push(centralHeader, nameBuf)
    localOffset += localHeader.byteLength + nameBuf.byteLength + compressed.byteLength
  }

  const centralDirSize = centralChunks.reduce((acc, b) => acc + b.byteLength, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true) // EOCD signature
  ev.setUint16(4, 0, true) // disk number
  ev.setUint16(6, 0, true) // start disk
  ev.setUint16(8, entries.length, true) // entries on disk
  ev.setUint16(10, entries.length, true) // total entries
  ev.setUint32(12, centralDirSize, true) // size of central dir
  ev.setUint32(16, localOffset, true) // offset of central dir
  ev.setUint16(20, 0, true) // comment length

  return concatUint8Arrays([...localChunks, ...centralChunks, eocd])
}

async function deflateRawAsync(data: Uint8Array): Promise<{ method: 0 | 8; compressed: Uint8Array }> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('deflate-raw')
      const writer = cs.writable.getWriter()
      const writePromise = writer.write(new Uint8Array(data)).then(() => writer.close())
      const reader = cs.readable.getReader()
      const chunks: Uint8Array[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) chunks.push(value)
      }
      await writePromise
      return { method: 8, compressed: concatUint8Arrays(chunks) }
    } catch {
      // Fallback to uncompressed PKZIP STORE (method 0) if deflate-raw unsupported
    }
  }
  return { method: 0, compressed: data }
}

function prepareXlsxXmlEntries(sheets: XlsxSheetSpec[]): ZipEntryInput[] {
  if (sheets.length === 0) {
    throw new Error('Workbook must contain at least 1 sheet')
  }

  const sst = new SharedStringsTable()
  const safeNames: string[] = []
  const usedNames = new Set<string>()

  for (const s of sheets) {
    let candidate = sanitizeSheetName(s.name)
    let suffix = 2
    while (usedNames.has(candidate.toLowerCase())) {
      const base = candidate.slice(0, 28)
      candidate = `${base}_${suffix++}`
    }
    usedNames.add(candidate.toLowerCase())
    safeNames.push(candidate)
  }

  const worksheetXmlBuffers = sheets.map((s) => utf8Encoder.encode(buildWorksheetXml(s, sst)))

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
${sheets
  .map(
    (_, idx) =>
      `  <Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )
  .join('\n')}
</Types>`

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
${safeNames
  .map((name, idx) => `    <sheet name="${escapeXml(name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`)
  .join('\n')}
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1"/>
</workbook>`

  const stylesRelId = sheets.length + 1
  const sstRelId = sheets.length + 2
  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, idx) =>
      `  <Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
  )
  .join('\n')}
  <Relationship Id="rId${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId${sstRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`

  return [
    { path: '[Content_Types].xml', data: utf8Encoder.encode(contentTypesXml) },
    { path: '_rels/.rels', data: utf8Encoder.encode(rootRelsXml) },
    { path: 'xl/workbook.xml', data: utf8Encoder.encode(workbookXml) },
    { path: 'xl/_rels/workbook.xml.rels', data: utf8Encoder.encode(workbookRelsXml) },
    { path: 'xl/styles.xml', data: utf8Encoder.encode(buildStylesXml()) },
    { path: 'xl/sharedStrings.xml', data: utf8Encoder.encode(sst.toXml()) },
    ...worksheetXmlBuffers.map((buf, idx) => ({
      path: `xl/worksheets/sheet${idx + 1}.xml`,
      data: buf,
    })),
  ]
}

/**
 * Browser + Node.js universal async OpenXML `.xlsx` builder.
 * Uses Web Standard `CompressionStream('deflate-raw')` (PKZIP method 8 DEFLATE).
 */
export async function buildXlsxUint8Array(sheets: XlsxSheetSpec[]): Promise<Uint8Array> {
  const xmlEntries = prepareXlsxXmlEntries(sheets)
  const prepared: PreparedZipEntry[] = await Promise.all(
    xmlEntries.map(async (e) => {
      const { method, compressed } = await deflateRawAsync(e.data)
      return {
        path: e.path,
        uncompressed: e.data,
        compressed,
        method,
        crc: crc32(e.data),
      }
    })
  )
  return assembleZipArchive(prepared)
}

/**
 * Synchronous Node.js OpenXML `.xlsx` builder returning `Buffer`.
 */
export function buildXlsxBuffer(
  sheets: XlsxSheetSpec[],
  deflateRawFn?: (data: Uint8Array) => Uint8Array
): Buffer {
  const xmlEntries = prepareXlsxXmlEntries(sheets)
  const builtinZlib =
    !deflateRawFn && typeof process !== 'undefined'
      ? (
          process as unknown as {
            getBuiltinModule?: (id: string) => {
              deflateRawSync?: (buf: Uint8Array, opts?: { level?: number }) => Uint8Array
            }
          }
        ).getBuiltinModule?.('node:zlib')
      : undefined
  const effDeflate =
    deflateRawFn ??
    (builtinZlib?.deflateRawSync
      ? (b: Uint8Array) => builtinZlib.deflateRawSync!(b, { level: 6 })
      : undefined)

  const prepared: PreparedZipEntry[] = xmlEntries.map((e) => {
    const compressed = effDeflate ? effDeflate(e.data) : e.data
    return {
      path: e.path,
      uncompressed: e.data,
      compressed,
      method: effDeflate ? 8 : 0,
      crc: crc32(e.data),
    }
  })

  const zipped = assembleZipArchive(prepared)
  return Buffer.from(zipped.buffer, zipped.byteOffset, zipped.byteLength)
}
