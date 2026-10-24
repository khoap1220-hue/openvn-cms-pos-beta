// ===== MEMORY ENGINE — TRÍ NHỚ DÀI HẠN CỦA KHÁCH HÀNG (Long-term Context Summary) =====
// Mỗi khi có đơn hàng mới / tin nhắn Zalo mới / đánh giá sao mới → tự chạy chắt lọc lại:
//   contextSummary (ngữ cảnh tích lũy) · preferences (sở thích) · painPoints (lưu ý cũ)
//   nextFollowUp (gợi ý chăm sóc tiếp) · salutation + inferredProfile (nhận diện tên & avatar)
// Mọi lần chắt lọc đều ghi Sổ Data (scope CUSTOMER) — 1 người vận hành vẫn nhớ từng khách.

import { db } from '@/lib/db'
import { analyzeCustomerName, defaultAvatarUrl, friendlyProductName } from '@/lib/agent-voice'
import { logLedgerAsync } from '@/lib/ledger'

export interface CustomerProfileJson {
  gender: string
  ageHint: string
  style: string
  note: string
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

/** Đảm bảo mỗi khách có salutation + avatar + inferredProfile (từ tên & avatar) — luôn cập nhật theo phân tích mới nhất. */
export async function ensureCustomerProfile(customerId: string) {
  const c = await db.customer.findUnique({ where: { id: customerId } })
  if (!c) return null
  const profile = analyzeCustomerName(c.name)
  const existing = parseJsonObject<CustomerProfileJson>(c.inferredProfile)
  const inferred: CustomerProfileJson = {
    gender: profile.gender,
    ageHint: profile.ageHint,
    style: existing?.style ?? '',
    note: `Nhận diện từ tên & avatar: giới tính ${profile.gender}, độ tuổi ${profile.ageHint}. Cách gọi quen thuộc: "${profile.title} ${profile.givenName}".`,
  }
  const data = {
    salutation: profile.salutation,
    avatarUrl: c.avatarUrl ?? defaultAvatarUrl(c.name),
    inferredProfile: JSON.stringify(inferred),
  }
  // salutation/profile luôn đồng bộ phân tích tên; avatar chỉ set khi thiếu
  if (c.salutation === data.salutation && c.inferredProfile === data.inferredProfile && c.avatarUrl) return c
  return db.customer.update({ where: { id: customerId }, data })
}

const PAIN_KEYWORDS = /(nắp|khít|hở|sứt mẻ|bị mẻ|mẻ ở|vỡ|nứt|chậm|lỗi|hư|sai|thiếu|bẩn|không giống|không đạt|kém|đổi hàng|trả hàng|khiếu nại)/i

function extractPainFromText(text: string): string[] {
  if (!text || !PAIN_KEYWORDS.test(text)) return []
  // Tách theo dấu câu, giữ mảnh chứa từ khóa, gọn ≤ 90 ký tự
  return text
    .split(/[.!?\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8 && PAIN_KEYWORDS.test(s))
    .map((s) => (s.length > 90 ? s.slice(0, 87) + '…' : s))
    .slice(0, 2)
}

function extractPainFromMessages(messages: Array<{ sender: string; content: string }>): string[] {
  const out: string[] = []
  for (const m of messages) {
    if (m.sender !== 'CUSTOMER') continue
    out.push(...extractPainFromText(m.content))
  }
  return out
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} triệu`
  return `${Math.round(n / 1000)}k`
}

/** Chắt lọc lại toàn bộ trí nhớ của 1 khách — gọi mỗi khi có đơn/chat/đánh giá mới. */
export async function refreshCustomerMemory(
  customerId: string,
  trigger: 'ORDER' | 'MESSAGE' | 'REVIEW' | 'MANUAL',
  triggerNote?: string,
) {
  const customer = await db.customer.findUnique({ where: { id: customerId } })
  if (!customer) return null

  await ensureCustomerProfile(customerId)

  const [orders, messages, afterSales] = await Promise.all([
    db.order.findMany({
      where: { customerId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'asc' },
      include: { items: { include: { product: { select: { name: true, sku: true } } } } },
    }),
    db.directMessage.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: 40,
      select: { sender: true, content: true },
    }),
    db.afterSalesCase.findMany({ where: { orderId: { in: await db.order.findMany({ where: { customerId }, select: { id: true } }).then((os) => os.map((o) => o.id)) } }, select: { reason: true } }),
  ])

  const skus = new Set<string>()
  const productNames = new Set<string>()
  for (const o of orders) for (const it of o.items) {
    if (it.product?.sku) skus.add(it.product.sku)
    if (it.product?.name) productNames.add(it.product.name)
  }
  const hasSku = (prefix: string) => [...skus].some((s) => s.startsWith(prefix))

  // --- Sở thích / nhu cầu ---
  const prefs: string[] = []
  const msgText = messages.map((m) => m.content).join(' ')
  if (hasSku('UD-SAP') || hasSku('UD-VL') || /tự đổ|diy|mẻ nến|làm nến/i.test(msgText)) prefs.push('Tự đổ nến tại nhà (DIY) — hay mua sáp & bấc')
  if (hasSku('UD-QT')) prefs.push('Mua quà tặng/biếu (set quà, tranh gốm)')
  if (hasSku('UD-TRA')) prefs.push('Mê trà & ấm gốm men lam')
  if (hasSku('UD-NEN') || hasSku('UD-DEN')) prefs.push('Yêu thích nến thơm & đèn xông hương nhà cửa')
  const biggest = orders.reduce((m, o) => Math.max(m, o.total), 0)
  if (biggest >= 800_000) prefs.push('Không ngại chi cho bộ quà cao cấp')
  if (orders.length >= 3) prefs.push('Khách quen — mua lại nhiều lần')
  const prefList = prefs.slice(0, 5)

  // --- Lưu ý / góp ý cũ ---
  const pains = new Set<string>()
  for (const o of orders) {
    for (const p of extractPainFromText(o.reviewComment ?? '')) pains.add(p)
  }
  for (const p of extractPainFromMessages(messages)) pains.add(p)
  for (const a of afterSales) for (const p of extractPainFromText(a.reason)) pains.add(p)
  const painList = [...pains].filter(Boolean).slice(0, 4)

  // --- Tóm tắt ngữ cảnh ---
  const first = orders[0]
  const last = orders[orders.length - 1]
  const totalSpent = orders.reduce((s, o) => s + o.total, 0)
  const reviews = orders.filter((o) => o.reviewRating != null)
  const avgReview = reviews.length > 0 ? (reviews.reduce((s, o) => s + (o.reviewRating ?? 0), 0) / reviews.length).toFixed(1) : null
  const month = first ? new Date(first.createdAt).toLocaleDateString('vi-VN', { month: 'numeric', year: '2-digit' }) : null
  const lastItems = last ? last.items.slice(0, 3).map((i) => `${i.quantity} ${friendlyProductName(i.product?.name ?? '', i.product?.sku)}`).join(', ') : ''

  const summaryParts: string[] = []
  if (orders.length === 0) {
    summaryParts.push(`Khách mới — chưa có đơn. ${messages.length > 0 ? `Đã nhắn tin hỏi thăm ${messages.length} lần qua Zalo.` : ''}`.trim())
  } else {
    summaryParts.push(
      orders.length === 1
        ? `Khách mới mua 1 đơn (tháng ${month}) — ${lastItems}, tổng ${fmtMoney(totalSpent)}.`
        : `Khách quen — ${orders.length} đơn từ tháng ${month}, chi tiêu ~${fmtMoney(totalSpent)} (trung bình ${fmtMoney(totalSpent / orders.length)}/đơn).`,
    )
    if (last && last.reviewRating != null) summaryParts.push(`Đơn gần nhất: ${lastItems}, khách đánh giá ${last.reviewRating}⭐${avgReview ? ` (trung bình ${avgReview}⭐/${reviews.length} lượt)` : ''}.`)
    else if (last) summaryParts.push(`Đơn gần nhất: ${lastItems}.`)
    if (painList[0]) summaryParts.push(`Từng góp ý: "${painList[0]}" — lần nhắn sau cần hỏi thăm trước.`)
  }
  const contextSummary = summaryParts.filter(Boolean).join(' ')

  // --- Gợi ý chăm sóc tiếp theo ---
  let nextFollowUp = ''
  if (painList[0]) {
    if (/nắp|khít|hở/i.test(painList[0])) nextFollowUp = `Hỏi thăm nắp hũ trà sau góp ý "${painList[0]}" + báo tiệm đã bịt nắp kỹ hơn, gửi kèm quà bù nhỏ`
    else nextFollowUp = `Hỏi thăm về góp ý cũ "${painList[0]}" và xin ảnh để xử lý bù`
  } else if (prefList.some((p) => /DIY/i.test(p))) {
    nextFollowUp = 'Hỏi mẻ nến tự đổ gần đây + nhắc mua sáp/bấc khi sắp hết (~2 tuần nữa)'
  } else if (prefList.some((p) => /quà tặng/i.test(p))) {
    nextFollowUp = 'Gợi ý set quà sạc dịp 20/10, 8/3, Tết — gói sẵn thiệp viết tay'
  } else if (last) {
    const days = Math.floor((Date.now() - new Date(last.createdAt).getTime()) / 86_400_000)
    nextFollowUp =
      days >= 14
        ? `Nhắc mua lại ${lastItems || 'món quen'} — đơn cuối đã ${days} ngày`
        : `Nhắn thăm trải nghiệm sau khi dùng ${lastItems || 'hàng'}, mời đánh giá nếu chưa`
  } else {
    nextFollowUp = 'Nhắn chào khách mới, gợi ý mẫu bán chạy của tiệm'
  }

  const profileNow = analyzeCustomerName(customer.name)
  const style =
    prefList.find((p) => /DIY/i.test(p)) !== undefined
      ? 'Khách làm nến DIY — thiên nguyên liệu'
      : prefList.some((p) => /quà tặng/i.test(p))
        ? 'Sành set quà tặng — ưu tiên đóng gói đẹp'
        : prefList.some((p) => /trà/i.test(p))
          ? 'Nghiện trà & gốm — phong cách Zen'
          : 'Mê hương nhà cửa — phong cách ấm cúng'
  const inferred: CustomerProfileJson = {
    gender: profileNow.gender,
    ageHint: profileNow.ageHint,
    style: `${style}.`,
    note: `Nhận diện từ tên & avatar: giới tính ${profileNow.gender}, độ tuổi ${profileNow.ageHint}. Cách gọi quen thuộc: "${profileNow.title} ${profileNow.givenName}".`,
  }

  const updated = await db.customer.update({
    where: { id: customerId },
    data: {
      contextSummary,
      preferences: JSON.stringify(prefList),
      painPoints: JSON.stringify(painList),
      nextFollowUp,
      inferredProfile: JSON.stringify(inferred),
      memoryUpdatedAt: new Date(),
    },
  })

  logLedgerAsync({
    scope: 'CUSTOMER',
    action: 'MEMORY_REFRESH',
    entityType: 'Customer',
    entityId: customerId,
    entityCode: customer.name,
    title: `Chắt lọc trí nhớ khách ${customer.salutation ?? customer.name} (nguồn: ${trigger === 'ORDER' ? 'đơn hàng mới' : trigger === 'MESSAGE' ? 'tin nhắn Zalo' : trigger === 'REVIEW' ? 'đánh giá sao' : 'người vận hành'})`,
    detail: {
      trigger,
      triggerNote: triggerNote ?? null,
      contextSummary,
      preferences: prefList,
      painPoints: painList,
      nextFollowUp,
    },
    actor: trigger === 'MANUAL' ? 'OPERATOR' : 'AGENT',
  })

  return updated
}

// ===== Trí nhớ dùng cho prompt LLM / template voice =====

export interface MemorySnapshot {
  salutation: string
  displayName: string
  profile: CustomerProfileJson | null
  contextSummary: string
  preferences: string[]
  painPoints: string[]
  nextFollowUp: string
  isReturning: boolean
}

export async function getMemorySnapshot(customerId: string): Promise<MemorySnapshot | null> {
  const c = await db.customer.findUnique({ where: { id: customerId } })
  if (!c) return null
  return {
    salutation: c.salutation ?? '',
    displayName: (c.salutation ?? c.name).replace(/^Em\s*-\s*/i, ''),
    profile: parseJsonObject<CustomerProfileJson>(c.inferredProfile),
    contextSummary: c.contextSummary ?? '',
    preferences: parseJsonArray(c.preferences),
    painPoints: parseJsonArray(c.painPoints),
    nextFollowUp: c.nextFollowUp ?? '',
    isReturning: (await db.order.count({ where: { customerId, status: { not: 'CANCELLED' } } })) > 1,
  }
}

export function parseMemoryArrays(c: { preferences: string | null; painPoints: string | null }) {
  return { preferences: parseJsonArray(c.preferences), painPoints: parseJsonArray(c.painPoints) }
}
