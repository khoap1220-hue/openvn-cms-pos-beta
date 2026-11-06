// VAT E-INVOICE GENERATOR & FORMATTER — Quyết định 1450/QĐ-TCT (Nghị định 123/2020/NĐ-CP, Thông tư 78/2021/TT-BTC)
// Hỗ trợ xuất XML chuẩn hóa đơn điện tử cơ quan thuế và đọc số tiền bằng chữ tiếng Việt.

export interface EInvoicePartner {
  name: string
  taxCode?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
}

export interface EInvoiceItem {
  id?: string
  productId?: string
  quantity: number
  unitPrice: number
  amount: number
  product?: {
    sku?: string | null
    name: string
    unit?: string | null
  } | null
}

export interface EInvoiceData {
  id: string
  code: string
  status: string
  invoiceDate?: Date | string | null
  invoiceNo?: number | null
  series?: string | null
  templateCode?: string | null
  paymentMethod?: string | null
  subtotal: number
  vatRate: number
  vatAmount: number
  total: number
  partner?: EInvoicePartner | null
  items?: EInvoiceItem[]
}

export interface SellerInfo {
  companyName?: string | null
  companyTax?: string | null
  companyAddress?: string | null
  companyPhone?: string | null
  signature?: string | null
}

const DEFAULT_SELLER: Required<Omit<SellerInfo, 'signature'>> = {
  companyName: 'CÔNG TY CỔ PHẦN NHANG THIỀN & TRẦM HƯƠNG ƯU ĐÀM',
  companyTax: '0108999888',
  companyAddress: 'Tầng 3, Tòa nhà Ưu Đàm, 68 Phố Huế, P. Hàng Bài, Q. Hoàn Kiếm, Hà Nội',
  companyPhone: '0901234567',
}

/**
 * Escape an toàn các ký tự đặc biệt theo chuẩn XML
 */
export function escapeXml(unsafe: string | null | undefined): string {
  if (unsafe == null) return ''
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Đọc số tiền thành chữ tiếng Việt chuẩn xác & tự nhiên
 * Ví dụ:
 *  - 150000 -> "Một trăm năm mươi nghìn đồng chẵn"
 *  - 756000 -> "Bảy trăm năm mươi sáu nghìn đồng chẵn"
 *  - 0 -> "Không đồng"
 */
export function numberToWordsVietnamese(inputNum: number): string {
  const num = Math.round(Math.abs(inputNum))
  if (num === 0) return 'Không đồng'

  const unitsScale = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']
  const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

  function readTriple(h: number, t: number, u: number, showZeroHundreds: boolean): string[] {
    const res: string[] = []
    if (h > 0 || showZeroHundreds) {
      res.push(`${DIGITS[h]} trăm`)
    }

    if (t === 0) {
      if (u > 0 && (h > 0 || showZeroHundreds)) {
        res.push('lẻ')
      }
    } else if (t === 1) {
      res.push('mười')
    } else {
      res.push(`${DIGITS[t]} mươi`)
    }

    if (u === 1) {
      res.push(t > 1 ? 'mốt' : 'một')
    } else if (u === 5) {
      res.push(t > 0 ? 'lăm' : 'năm')
    } else if (u > 0) {
      res.push(DIGITS[u])
    }

    return res
  }

  // Chia số thành các cụm 3 chữ số từ phải qua trái
  const chunks: number[] = []
  let temp = num
  while (temp > 0) {
    chunks.push(temp % 1000)
    temp = Math.floor(temp / 1000)
  }

  const words: string[] = []
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]
    if (chunk === 0) continue

    const h = Math.floor(chunk / 100)
    const t = Math.floor((chunk % 100) / 10)
    const u = chunk % 10
    const showZeroHundreds = i < chunks.length - 1

    const chunkWords = readTriple(h, t, u, showZeroHundreds)
    if (chunkWords.length > 0) {
      words.push(...chunkWords)
      const scale = unitsScale[i]
      if (scale) words.push(scale)
    }
  }

  const sign = inputNum < 0 ? 'Âm ' : ''
  const fullText = `${sign}${words.join(' ')} đồng chẵn`.trim()
  return fullText.charAt(0).toUpperCase() + fullText.slice(1)
}

/**
 * Sinh XML hóa đơn điện tử theo chuẩn QĐ 1450/QĐ-TCT (Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC)
 * Bắt buộc 7 thẻ cấu trúc gốc:
 * <HDon>
 *   <DLHDon id="...">
 *     <TTChung>...</TTChung>
 *     <NDHDon>
 *       <NBan>...</NBan>
 *       <NMua>...</NMua>
 *       <DSHangHoa>...</DSHangHoa>
 *       <TToan>...</TToan>
 *     </NDHDon>
 *   </DLHDon>
 *   <DSCKS>...</DSCKS>
 * </HDon>
 */
export function generateInvoiceXml(invoice: EInvoiceData, seller?: SellerInfo): string {
  if (invoice.status === 'CANCELLED') {
    throw new Error('Hóa đơn đã bị hủy, không thể xuất XML')
  }

  const sellerName = seller?.companyName?.trim() || DEFAULT_SELLER.companyName
  const sellerTax = seller?.companyTax?.trim() || DEFAULT_SELLER.companyTax
  const sellerAddress = seller?.companyAddress?.trim() || DEFAULT_SELLER.companyAddress
  const sellerPhone = seller?.companyPhone?.trim() || DEFAULT_SELLER.companyPhone

  const invoiceDate = invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date()
  const invoiceDateIso = invoiceDate.toISOString().slice(0, 10)

  const templateCode = invoice.templateCode?.trim() || '1'
  const series = invoice.series?.trim() || 'C26TUU'
  const invoiceNo = invoice.invoiceNo != null ? String(invoice.invoiceNo) : invoice.code
  const paymentMethod = invoice.paymentMethod?.trim() || 'TM/CK'

  const buyerName = invoice.partner?.name?.trim() || 'Người mua không lấy hóa đơn'
  const buyerTax = invoice.partner?.taxCode?.trim() || ''
  const buyerAddress = invoice.partner?.address?.trim() || ''
  const buyerPhone = invoice.partner?.phone?.trim() || ''
  const buyerEmail = invoice.partner?.email?.trim() || ''

  const items = invoice.items && invoice.items.length > 0 ? invoice.items : []
  const subtotal = Math.round(invoice.subtotal)
  const vatRate = invoice.vatRate
  const vatAmount = Math.round(invoice.vatAmount)
  const total = Math.round(invoice.total)
  const amountInWords = numberToWordsVietnamese(total)

  const xmlId = `HDon_${invoice.id || invoice.code.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  const itemsXml = items
    .map((item, index) => {
      const stt = index + 1
      const sku = escapeXml(item.product?.sku || '')
      const name = escapeXml(item.product?.name || 'Sản phẩm')
      const unit = escapeXml(item.product?.unit || 'hộp')
      const qty = item.quantity
      const unitPrice = Math.round(item.unitPrice)
      const amount = Math.round(item.amount)

      return `      <HHoa>
        <STT>${stt}</STT>
        <TCStt>${stt}</TCStt>
        <MHHoa>${sku}</MHHoa>
        <THHoa>${name}</THHoa>
        <DVTinh>${unit}</DVTinh>
        <SLuong>${qty}</SLuong>
        <DGia>${unitPrice}</DGia>
        <Tien>${amount}</Tien>
        <TSuat>${vatRate}%</TSuat>
        <ThTien>${amount}</ThTien>
      </HHoa>`
    })
    .join('\n')

  const signatureNode = seller?.signature
    ? `<KSCKS>${seller.signature}</KSCKS>`
    : `<KSCKS/>`

  return `<?xml version="1.0" encoding="utf-8"?>
<HDon xmlns="http://hoadondientu.gdt.gov.vn/2021">
  <DLHDon id="${xmlId}">
    <TTChung>
      <PBan>2.0.0</PBan>
      <THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon>
      <KHMSHDon>${escapeXml(templateCode)}</KHMSHDon>
      <KHHDon>${escapeXml(series)}</KHHDon>
      <SHDon>${escapeXml(invoiceNo)}</SHDon>
      <NLap>${invoiceDateIso}</NLap>
      <DVTTe>VND</DVTTe>
      <TGia>1</TGia>
      <HTTToan>${escapeXml(paymentMethod)}</HTTToan>
      <MSTTCGP>${escapeXml(sellerTax)}</MSTTCGP>
    </TTChung>
    <NDHDon>
      <NBan>
        <Ten>${escapeXml(sellerName)}</Ten>
        <MST>${escapeXml(sellerTax)}</MST>
        <DChi>${escapeXml(sellerAddress)}</DChi>
        <SDThoai>${escapeXml(sellerPhone)}</SDThoai>
      </NBan>
      <NMua>
        <Ten>${escapeXml(buyerName)}</Ten>
        <MST>${escapeXml(buyerTax)}</MST>
        <DChi>${escapeXml(buyerAddress)}</DChi>
        <SDThoai>${escapeXml(buyerPhone)}</SDThoai>
        <DCTDTu>${escapeXml(buyerEmail)}</DCTDTu>
        <HThucTT>${escapeXml(paymentMethod)}</HThucTT>
      </NMua>
      <DSHangHoa>
${itemsXml}
      </DSHangHoa>
      <TToan>
        <THTTLTSuat>
          <LTSuat>
            <TSuat>${vatRate}%</TSuat>
            <ThTien>${subtotal}</ThTien>
            <TThue>${vatAmount}</TThue>
          </LTSuat>
        </THTTLTSuat>
        <TgTCThue>${subtotal}</TgTCThue>
        <TgTThue>${vatAmount}</TgTThue>
        <TgTTTBSo>${total}</TgTTTBSo>
        <TgTTTBChu>${escapeXml(amountInWords)}</TgTTTBChu>
      </TToan>
    </NDHDon>
  </DLHDon>
  <DSCKS>
    <NBan>
      ${signatureNode}
    </NBan>
  </DSCKS>
</HDon>`
}
