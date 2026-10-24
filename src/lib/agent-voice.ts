// ===== BỘ LỌC NGÔN NGỮ "100% ANTI-AI" — GIỌNG CHỦ TIỆM ƯU ĐÀM =====
// Toàn bộ 5 Agent (Tư vấn, Kho vận, CSKH, Đánh giá, Hỗ trợ 24/7) phải đi qua lớp này.
// Quy tắc vàng:
//  1. Tự xưng "tụi em / em / Ưu Đàm" — TUYỆT ĐỐI không "shop OmniSales", "quý khách", "kính chào".
//  2. CẤM văn mẫu AI sáo rỗng (BANNED_PHRASES) — lọc ngay cả khi LLM lỡ viết.
//  3. Không đọc mã đơn DH261024-xxxx trong lời thoại (chỉ giữ mã vận đơn). Gọi tên món rút gọn: "2 hũ trà Zen".
//  4. Giọng nhắn Zalo đời thường, câu ngắn, "dạ/nha/nhé/đó ạ", tối đa 1 emoji.

export const BANNED_PHRASES: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /vô cùng quý giá/gi, replace: 'quý ạ' },
  { pattern: /nguồn động lực quý báu/gi, replace: 'động lực để tụi em cố gắng' },
  { pattern: /động lực quý báu/gi, replace: 'động lực để tụi em cố gắng' },
  { pattern: /cải thiện chất lượng dịch vụ/gi, replace: 'làm tốt hơn' },
  { pattern: /nâng cao chất lượng (dịch vụ|sản phẩm)/gi, replace: 'làm tốt hơn' },
  { pattern: /trải nghiệm tuyệt vời/gi, replace: 'kỳ nghỉ nhỏ thoải mái' },
  { pattern: /hân hạnh phục vụ/gi, replace: 'rất vui được phục vụ mình' },
  { pattern: /mong sớm được phục vụ/gi, replace: 'lần sau tụi em phục vụ mình tiếp nhé' },
  { pattern: /rất mong nhận được sự (ủng hộ|phản hồi)/gi, replace: 'mong nghe mình nói thêm' },
  { pattern: /sự ủng hộ (quý báu|của quý)/gi, replace: 'sự ủng hộ' },
  { pattern: /kính (chào|gửi|thưa)/gi, replace: 'chào' },
  { pattern: /quý khách( hàng)?/gi, replace: 'mình' },
  { pattern: /thân ái(!|\.)/gi, replace: '' },
  { pattern: /trân trọng,/gi, replace: '' },
  { pattern: /Niềm vui của (chúng tôi|shop) là/gi, replace: 'Tụi em vui khi' },
  { pattern: /giá trị (cao đẹp|to lớn)/gi, replace: 'nhiều giá trị' },
  { pattern: /chúc (quý khách|anh\/chị) một ngày (tốt lành|vui vẻ|absolutely)/gi, replace: 'chúc mình một ngày dễ chịu' },
  { pattern: /shop OmniSales/gi, replace: 'Ưu Đàm' },
  { pattern: /OmniSales/gi, replace: 'Ưu Đàm' },
  { pattern: /\bShop\b/g, replace: 'Tụi em' },
  { pattern: /\bshop\b/g, replace: 'tụi em' },
  { pattern: /\bCửa hàng\b/g, replace: 'Tiệm' },
]

const EMOJI_RE = /\p{Extended_Pictographic}/gu

/** Lọc và "người hóa" một tin nhắn trước khi gửi khách. */
export function sanitizeVoice(text: string, opts?: { keepOrderCodes?: boolean }): string {
  let t = text.trim()
  for (const { pattern, replace } of BANNED_PHRASES) t = t.replace(pattern, replace)
  // Mã đơn dài dòng → bỏ (mã vận đơn khác, không khớp pattern DHxxxxxx-xxxx nên giữ nguyên)
  if (!opts?.keepOrderCodes) {
    t = t.replace(/\bDH\d{6}-\d{4}\b/g, 'đơn mình vừa chốt')
    t = t.replace(/\bDH\d{6}-\d{4}\b/g, '').replace(/đơn mình vừa chốt của mình/g, 'đơn mình vừa chốt')
  }
  // Giới hạn 1 emoji: xóa các emoji vượt mức
  const emojis = t.match(EMOJI_RE) ?? []
  if (emojis.length > 1) {
    let removed = 0
    t = t.replace(EMOJI_RE, (m) => {
      removed += 1
      return removed <= 1 ? m : ''
    })
  }
  // Dọn khoảng trắng thừa do xóa mã/emoji
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.,!?,])/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/^[,.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t
}

// ===== TÊN MÓN HÀNG RÚT GỌN — gọi gần gũi như chủ tiệm =====

const FRIENDLY_BY_SKU: Record<string, string> = {
  'UD-NEN-001': 'nến bơ',
  'UD-NEN-002': 'hũ nến hoa sen',
  'UD-SAP-001': 'bịch sáp đậu nành',
  'UD-SAP-002': 'khối sáp tinh khiết',
  'UD-DEN-001': 'đèn xông tinh dầu',
  'UD-TRA-001': 'bộ ấm trà gốm',
  'UD-TRA-002': 'bình pha trà',
  'UD-TRA-003': 'hũ trà Zen',
  'UD-QT-001': 'set quà trà sơn thủy',
  'UD-QT-002': 'tranh gốm mẫu đơn',
  'UD-VL-001': 'bó bấc cotton',
  'UD-COMBO-001': 'set quà nến bơ',
}

const FRIENDLY_BY_KEYWORD: Array<[RegExp, string]> = [
  [/nến bơ|butter/i, 'nến bơ'],
  [/hoa sen/i, 'hũ nến hoa sen'],
  [/sáp nến đậu nành|soy wax/i, 'bịch sáp đậu nành'],
  [/sáp nến tinh khiết|dạng khối/i, 'khối sáp tinh khiết'],
  [/đèn xông/i, 'đèn xông tinh dầu'],
  [/ấm trà gốm|men lam/i, 'bộ ấm trà gốm'],
  [/bình pha trà/i, 'bình pha trà'],
  [/hũ trà gốm|zen/i, 'hũ trà Zen'],
  [/hộp quà|sơn thủy/i, 'set quà trà sơn thủy'],
  [/tranh gốm|mẫu đơn/i, 'tranh gốm mẫu đơn'],
  [/bấc/i, 'bó bấc cotton'],
  [/set quà tặng Ưu Đàm|combo/i, 'set quà nến bơ'],
]

export function friendlyProductName(name: string, sku?: string | null): string {
  if (sku && FRIENDLY_BY_SKU[sku]) return FRIENDLY_BY_SKU[sku]
  for (const [re, label] of FRIENDLY_BY_KEYWORD) if (re.test(name)) return label
  const clean = name.replace(/\([^)]*\)/g, '').trim()
  return clean.split(/\s+/).slice(0, 3).join(' ').toLowerCase()
}

/** "2× Hũ trà gốm nắp gỗ chữ Hán phong cách Zen" → "2 hũ trà Zen" */
export function friendlyItemsText(items: Array<{ quantity: number; product?: { name: string; sku?: string | null } | null }>): string {
  return items
    .map((i) => `${i.quantity} ${friendlyProductName(i.product?.name ?? '', i.product?.sku)}`)
    .join(', ')
}

// ===== NHẬN DIỆN TÊN → XƯNG HÔ + CHÂN DUNG =====

const FEMALE_RAW = new Set(['thị', 'ngọc', 'thu', 'trang', 'trân', 'linh', 'duyên', 'vy', 'hương', 'mỹ', 'my', 'nhung', 'lan', 'hằng', 'oanh', 'diệp', 'mai', 'hạnh', 'vân', 'thảo', 'tâm', 'uyên', 'chi', 'tiên', 'ngân', 'nhi', 'trâm', 'hường', 'trinh', 'quỳnh', 'phương', 'hoa', 'hà', 'nương', 'yến', 'tú', 'kinh', 'khánh vy', 'thảo'])
const MALE_RAW = new Set(['văn', 'công', 'hữu', 'tuấn', 'nam', 'quân', 'sơn', 'dũng', 'kiệt', 'phước', 'trọng', 'quốc', 'đức', 'thắng', 'mạnh', 'việt', 'trung', 'hùng', 'long', 'thịnh', 'vinh', 'phong', 'hải', 'toàn', 'khang', 'cường', 'dương', 'quyết'])
// Dự phòng khi khách gõ tên thiếu dấu — loại trừ cặp va chạm "van" (Văn♂ / Vân♀)
const FEMALE_ACC = new Set([...FEMALE_RAW].map(deaccent).filter((x) => x !== 'van'))
const MALE_ACC = new Set([...MALE_RAW].map(deaccent).filter((x) => x !== 'van'))
const FEMALE_PAIRS = new Set(['minh anh', 'thu anh', 'ngọc anh', 'thanh anh', 'hải anh', 'kim anh', 'như anh', 'bảo trân', 'khánh vy', 'mỹ duyên', 'gia linh'].map(deaccent))
const MALE_PAIRS = new Set(['gia bảo', 'thanh bảo', 'quốc bảo', 'hữu bảo', 'minh bảo', 'đức bảo'].map(deaccent))
const AMBIG = new Set(['anh', 'bảo', 'minh', 'thanh', 'khánh', 'hồng', 'gia', 'tài', 'phúc', 'sáng'])

function deaccent(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase()
}

export interface NameProfile {
  gender: 'nữ' | 'nam' | 'không rõ'
  givenName: string // tên gọi dùng khi xưng hô: "Trân", "Quân", "Mỹ Linh"
  title: 'Chị' | 'Anh'
  salutation: string // "Em - Chị Trân"
  ageHint: string
}

/** Phân tích tên khách Việt Nam → cách xưng hô + chân dung ước lượng. */
export function analyzeCustomerName(fullName: string): NameProfile {
  const words = fullName.trim().split(/\s+/).filter(Boolean)
  const last = deaccent(words[words.length - 1] ?? '')
  const last2 = deaccent(words.slice(-2).join(' '))
  const givenAccent = words.length >= 2 ? words.slice(-2).join(' ') : fullName

  let score = 0
  for (const w of words.slice(1)) {
    const lw = w.toLowerCase()
    const dw = deaccent(w)
    // Ưu tiên đối chiếu tên CÓ dấu (tránh va chạm Văn♂/Vân♀ khi mất dấu)
    const isFemale = FEMALE_RAW.has(lw) || (dw !== 'van' && FEMALE_ACC.has(dw))
    const isMale = MALE_RAW.has(lw) || (dw !== 'van' && MALE_ACC.has(dw))
    if (isFemale && !isMale) score -= 2
    else if (isMale && !isFemale) score += 2
    else if (AMBIG.has(dw)) score += dw === 'anh' ? -1 : 0
  }
  if (FEMALE_PAIRS.has(last2)) score -= 3
  if (MALE_PAIRS.has(last2)) score += 3
  if (last === 'anh' && words.length >= 3 && !FEMALE_PAIRS.has(last2)) {
    // "…Gia Bảo / …Thanh Sơn" — từ áp chót quyết định
    const prev = deaccent(words[words.length - 2])
    if (FEMALE_ACC.has(prev) || FEMALE_RAW.has(words[words.length - 2].toLowerCase())) score -= 2
    else if (MALE_ACC.has(prev) || MALE_RAW.has(words[words.length - 2].toLowerCase())) score += 2
  }

  const gender: NameProfile['gender'] = score < 0 ? 'nữ' : score > 0 ? 'nam' : 'không rõ'
  const title: 'Chị' | 'Anh' = gender === 'nam' ? 'Anh' : 'Chị'
  // Tên gọi: nếu từ cuối là "Anh" và cặp 2 từ có nghĩa (Minh Anh) → lấy 2 từ, ngược lại lấy từ cuối
  const useTwo = last === 'anh' && FEMALE_PAIRS.has(last2)
  const givenName = useTwo ? words.slice(-2).join(' ') : words[words.length - 1] ?? fullName
  const buckets = ['~22–28', '~25–32', '~28–35', '~30–40']
  let hash = 0
  for (const ch of deaccent(fullName)) hash = (hash * 31 + ch.charCodeAt(0)) % 9973
  const ageHint = `${buckets[hash % buckets.length]} (ước lượng)`
  return { gender, givenName, title, salutation: `Em - ${title} ${givenName}`, ageHint }
}

/** Avatar mặc định (DiceBear — ổn định theo tên, dễ người hóa) */
export function defaultAvatarUrl(name: string): string {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${encodeURIComponent(name)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&radius=50`
}

// ===== PHÂN LOẠI TIN NHẮN KHÁCH → REACTION TỰ ĐỘNG =====

export type Sentiment = 'positive' | 'complaint' | 'neutral'

const POSITIVE_RE = /(nhận được|đã nhận|đẹp|khen|tuyệt|yêu|ok|ổn|thích|cảm ơn|xinh|cháy thơm|thơm|đạt|hài lòng|5 sao|năm sao|giàu cảm xúc|quá đáng|ưng|dễ thương|bóng đẹp|góc đốt)/i
const COMPLAINT_RE = /(lỗi|nắp|khít|hở|sứt mẻ|bị mẻ|mẻ ở|vỡ|nứt|chậm|hư|sai|thiếu|bẩn|không giống|không đạt|kém|đổi hàng|trả hàng|khiếu nại)/i

export function classifySentiment(text: string, imageAnalysis?: string | null): Sentiment {
  const combined = `${text ?? ''} ${imageAnalysis ?? ''}`
  if (COMPLAINT_RE.test(combined)) return 'complaint'
  if (POSITIVE_RE.test(combined)) return 'positive'
  return 'neutral'
}

export function reactionForSentiment(s: Sentiment): { emoji: string; note: string } {
  if (s === 'complaint') return { emoji: '😢', note: 'Thả 😢 vào tin khách — xin lỗi trước rồi mới xử lý' }
  if (s === 'positive') return { emoji: '❤️', note: 'Thả ❤️ vào tin khách cho ấm áp như chủ tiệm' }
  return { emoji: '🙏', note: 'Thả 🙏 vào tin khách cho lịch sự tự nhiên' }
}

// ===== NGỮ CẢNH GIỌNG VĂN DÙNG CHUNG CHO TEMPLATE + LLM =====

export interface VoiceContext {
  displayName: string // "chị Trân", "anh Quân"
  firstName: string
  isReturning: boolean
  orderCount: number
  itemsText: string // "2 hũ trà Zen, 1 set quà trà sơn thủy"
  lastItem: string // món chính của đơn gần nhất
  preferences: string[]
  painPoints: string[]
}

export function buildVoiceContext(input: {
  name: string
  salutation?: string | null
  orderCount: number
  items?: Array<{ quantity: number; product?: { name: string; sku?: string | null } | null } | null>
  preferences?: string[]
  painPoints?: string[]
}): VoiceContext {
  const profile = analyzeCustomerName(input.name)
  const titleLower = profile.title === 'Anh' ? 'anh' : 'chị'
  const displayName = input.salutation ? input.salutation.replace(/^Em\s*-\s*/i, '') : `${titleLower} ${profile.givenName}`
  const friendly = (input.items ?? []).filter((i): i is NonNullable<typeof i> => !!i && !!i.product)
  const itemsText = friendlyItemsText(friendly)
  return {
    displayName,
    firstName: profile.givenName,
    isReturning: input.orderCount > 1,
    orderCount: input.orderCount,
    itemsText,
    lastItem: friendly.length > 0 ? friendlyProductName(friendly[0].product?.name ?? '', friendly[0].product?.sku) : '',
    preferences: input.preferences ?? [],
    painPoints: input.painPoints ?? [],
  }
}

/** Gợi ý câu hỏi thăm dựa trên trí nhớ — lồng ghép tự nhiên vào tin nhắn. */
export function memoryHook(ctx: VoiceContext): string {
  const pain = ctx.painPoints[0]
  if (pain) {
    if (/nắp|khít|hở/i.test(pain)) return `Nghe nói lần trước nắp gỗ chưa khít đúng không ${ctx.displayName} — tụi em đã đổi thợ bịt nắp kỹ hơn rồi, hũ này chốt chắc lắm luôn nha.`
    if (/chậm/i.test(pain)) return `Lần trước giao hơi chậm làm ${ctx.displayName} đợi lâu, lần này tụi em đẩy sớm hơn nha.`
    return `Đợt trước mình góp ý "${pain}" — tụi em đã rút kinh nghiệm rồi ${ctx.displayName} nha.`
  }
  if (ctx.preferences.some((p) => /DIY|tự đổ/i.test(p))) return `Mẻ nến tự đổ của ${ctx.displayName} dạo này thế nào rồi? Có cần thêm sáp hay bấc thì báo tụi em một tiếng nha.`
  if (ctx.isReturning) return `Khách quen của tiệm rồi nên tụi em giữ đơn gọn gàng cẩn thận hơn bình thường nha.`
  return ''
}

// ===== MẪU TIN NHẮN GIỌNG NGƯỜI (fallback khi LLM quá tải) =====

function vnd(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value) + 'đ'
}

const OPENERS = ['Dạ', 'Dạ vâng', 'Ôi chào', 'Chào']

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

export function vConfirm(ctx: VoiceContext, total: number): string {
  const hook = memoryHook(ctx)
  const parts = [
    `${pick(OPENERS)} ${ctx.displayName} ơi, đơn mình chốt ${ctx.itemsText} tổng ${vnd(total)} nha.`,
    `Tụi em gói xong là giao bên ship luôn đó ạ.`,
  ]
  if (hook) parts.push(hook)
  return sanitizeVoice(parts.join(' '))
}

export function vCarrier(ctx: VoiceContext, carrier: string, tracking: string): string {
  return sanitizeVoice(
    `${ctx.displayName} ơi, ${ctx.itemsText} của mình đã gói cẩn thận (nến/gốm thì bọc mút kỹ nha) và giao cho ${carrier} rồi 📦 Mã theo dõi: ${tracking}. Có gì báo tụi em một tiếng nhé!`,
  )
}

export function vPickup(ctx: VoiceContext, carrier: string): string {
  return sanitizeVoice(`Dạ ${carrier} qua lấy ${ctx.itemsText} rồi đó ạ. ${ctx.displayName} để ý điện thoại trong hôm nay với ngày mai là shipper gọi, nghe máy giúp tụi em nha 🙏`)
}

export function vTransit(ctx: VoiceContext): string {
  return sanitizeVoice(`${ctx.itemsText} đang trên đường tới nhà mình rồi nha ${ctx.displayName}. Gần tới tụi em báo ngay đó ạ 🚚`)
}

export function vCare(ctx: VoiceContext): string {
  const hook = memoryHook(ctx)
  const base = `Dạ ${ctx.itemsText} đã tới nhà mình rồi ${ctx.displayName}. Thích ghê — thắp nến hay pha trà cũng ấm cả nhà đó ạ. Dùng thấy ổn thì kể tụi em nghe với nha ❤️`
  return sanitizeVoice(hook && !/nắp/i.test(hook) ? `${base} ${hook}` : base)
}

export function vReviewRequest(ctx: VoiceContext): string {
  return sanitizeVoice(
    `${ctx.displayName} ơi, ${ctx.itemsText} ổn không mình nhỉ? Nếu tiện thì chấm vài sao + viết vài chữ cho tụi em với nha 🙏 — mấy dòng của mình là gạch vàng để tiệm giữ lửa làm hàng đẹp hơn đó ạ.`,
  )
}

export function vReviewReply(name: string, rating: number): string {
  if (rating >= 4) return sanitizeVoice(`Dạ ${name} thả ${rating} sao khen xanh rêu luôn, tụi em hớn hở cả ngày luôn đó ạ ❤️ Hẹn mình lô nến mới thơm hơn nữa nha!`)
  return sanitizeVoice(`Dạ ${rating} sao của mình tụi em đọc kỹ rồi, lần sau sẽ sửa cho chuốt nha. Cảm ơn mình đã góp ý thật lòng ạ 🙏`)
}

export function vAutoReplyByKind(
  kind: 'order' | 'stock' | 'promo' | 'return' | 'image_praise' | 'image_defect' | 'image_similar' | 'general',
  ctx: VoiceContext,
  extra?: { analysis?: string | null; productName?: string },
): string {
  switch (kind) {
    case 'order':
      return sanitizeVoice(`Dạ đơn ${ctx.itemsText} tụi em đã nhận và đang gói ngay đây ạ ${ctx.displayName}. ${memoryHook(ctx)} Có gì cập nhật là nhắn mình liền nha!`)
    case 'stock':
      return sanitizeVoice(`Dạ ${extra?.productName ?? 'món mình hỏi'} vẫn còn hàng đầy đủ đó ${ctx.displayName} ạ. Chốt đơn là tụi em gói gửi ngay trong hôm nay nha!`)
    case 'promo':
      return sanitizeVoice(`Dạ đơn từ 500k tụi em freeship luôn nha ${ctx.displayName}. Thêm hũ nến hay bình trà nữa là được miễn phí giao hàng liền đó ạ 📦`)
    case 'return':
      return sanitizeVoice(`Dạ trong 7 ngày kể từ ngày nhận hàng tụi em hỗ trợ đổi/đổi mẫu hết nha ${ctx.displayName}. Mình nhắn kèm ảnh món hàng để tụi em xem rồi xử ngay cho nhanh ạ 🙏`)
    case 'image_praise':
      return sanitizeVoice(`Trời ơi góc đốt nến của mình đẹp xuất sắc luôn ${ctx.displayName} 😍 Bóng nến lan trên mặt gốm nhìn ấm hết người rồi. Cho tụi em xin phép lưu ảnh làm nguồn cảm hứng với nha!`)
    case 'image_defect':
      return sanitizeVoice(`Dạ tụi em nhìn ảnh là thấy lỗi ngay — xin lỗi mình thật lòng ${ctx.displayName} 🙏 Ảnh mình chụp rõ quá nên nhờ đấy. Tụi em gửi bù 1 hũ mới khít nắp + quà nhỏ cho lần sau, đơn bù đi trong hôm nay luôn nha.`)
    case 'image_similar':
      return sanitizeVoice(`Dạ theo mẫu trong ảnh thì bên tiệm có ${extra?.productName ?? 'bộ ấm trà gốm men lam'} gần giống nhất đó ${ctx.displayName}. Mình gửi thêm vài tấm để mình chọn kỹ hơn nha!`)
    default:
      return sanitizeVoice(`Dạ ${ctx.displayName} cần tư vấn mùi hương, trà gốm hay kiểm tra đơn thì nói rõ giúp tụi em, em hỗ trợ liền nha 🙏`)
  }
}

/** Từ khóa chọn kind cho auto-reply (khi LLM không khả dụng) */
export function detectReplyKind(text: string, imageAnalysis?: string | null): 'order' | 'stock' | 'promo' | 'return' | 'image_praise' | 'image_defect' | 'image_similar' | 'general' {
  const c = `${text ?? ''} ${imageAnalysis ?? ''}`.toLowerCase()
  const deacc = deaccent(c)
  if (/hở|mẻ|khít|vỡ|nứt|lỗi|hư/.test(deacc) && /ảnh|photo|nắp|gốm|hũ/.test(deacc)) return 'image_defect'
  if (/góc đốt|decor|đẹp quá|ánh nến|bóng nến/.test(deacc)) return 'image_praise'
  if (/tương tự|giống mẫu|tìm mẫu|như trong ảnh/.test(deacc)) return 'image_similar'
  if (/đơn|giao|nhận/.test(deacc)) return 'order'
  if (/còn không|hàng không|size|mẫu/.test(deacc)) return 'stock'
  if (/freeship|giảm giá|khuyến mãi|voucher/.test(deacc)) return 'promo'
  if (/đổi|trả/.test(deacc)) return 'return'
  return 'general'
}
