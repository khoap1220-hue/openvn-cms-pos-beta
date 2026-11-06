// src/lib/campaign-service.ts
// Milestone 1 (M1: CRM Campaigns & DB Safety)
// Phân hệ quản lý Chiến dịch / Chương trình khuyến mãi (CRM Campaigns)
// Hợp đồng giao tiếp M1 ↔ M3, tính trạng thái biên thời gian thực, CRUD & làm giàu dữ liệu

import { db } from '@/lib/db'
import { calculateVoucherDiscount } from '@/lib/warehouse-service'
import type { Campaign } from '@prisma/client'

// ============================================================
// TYPES & INTERFACES (M1 ↔ M3 CONTRACT)
// ============================================================

export type CampaignStatus = 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'

export interface EnrichedProductPricing {
  id: string
  sku: string
  name: string
  /** Giá khuyến mãi áp dụng trong chiến dịch (alias cho contract M1 ↔ M3) */
  price: number
  /** Giá niêm yết bán lẻ gốc từ Product.sellPrice */
  originalPrice: number
  /** Giá sau khi áp dụng chiết khấu chiến dịch */
  campaignPrice: number
  /** Tỷ lệ % giảm giá thực tế (làm tròn 1 chữ số thập phân nếu lẻ) */
  discountPercent?: number
  /** Số tiền giảm giá thực tế trên mỗi sản phẩm */
  discountAmount?: number
  /** Giá vốn sản phẩm (Product.costPrice) phục vụ kiểm soát biên lợi nhuận */
  costPrice?: number
  image?: string | null
  status?: string
}

export interface EnrichedVoucherInfo {
  id: string
  code: string
  title: string
  discountType: string // PERCENT | FIXED | FREESHIP
  discountValue: number
  /** % giảm nếu là loại PERCENT */
  discountPercent?: number
  /** Tiền giảm cố định nếu là loại FIXED */
  discountAmount?: number
  /** Giá trị đơn hàng tối thiểu áp dụng */
  minOrderValue?: number
  /** Trần giảm tối đa cho voucher PERCENT */
  maxDiscount?: number | null
  active?: boolean
  expiresAt?: string | null
}

export interface CampaignData {
  id: string
  code: string
  name: string
  title: string
  description: string
  startDate: string // ISO string
  endDate: string   // ISO string
  status: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds: string[]
  appliedVoucherIds: string[]
  productOverrides?: Record<string, { specialPrice?: number; discountPercent?: number }>
  bannerUrl?: string | null
  tags?: string[]
  products: EnrichedProductPricing[]
  vouchers: EnrichedVoucherInfo[]
  createdAt: string
  updatedAt: string
}

export interface CampaignWaveDiff {
  field: string
  label: string
  before: string
  after: string
}

export interface CampaignWaveSnapshot {
  name: string
  title?: string | null
  description?: string | null
  startDate: string
  endDate: string
  status: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds: string[]
  appliedVoucherIds: string[]
  productOverrides: Record<string, { specialPrice?: number; discountPercent?: number }>
}

export interface CampaignWave {
  id: string
  campaignId: string
  campaignCode: string
  waveNumber: number
  waveCode: string
  waveName: string
  waveNote: string
  actorName: string
  isActive: boolean
  createdAt: string
  snapshot: CampaignWaveSnapshot
  changedSummary: CampaignWaveDiff[]
}

export interface CreateCampaignInput {
  code?: string
  name?: string
  title?: string
  description?: string | null
  startDate: string | Date
  endDate: string | Date
  status?: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds?: string[] | string
  appliedVoucherIds?: string[] | string
  productOverrides?: Record<string, { specialPrice?: number; discountPercent?: number }> | string
  bannerUrl?: string | null
  tags?: string[] | string | null
  waveName?: string
  waveNote?: string
}

export interface UpdateCampaignInput {
  code?: string
  name?: string
  title?: string
  description?: string | null
  startDate?: string | Date
  endDate?: string | Date
  status?: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherId?: string | null
  voucherCode?: string | null
  appliedProductIds?: string[] | string | null
  appliedVoucherIds?: string[] | string | null
  productOverrides?: Record<string, { specialPrice?: number; discountPercent?: number }> | string | null
  bannerUrl?: string | null
  tags?: string[] | string | null
  waveName?: string
  waveNote?: string
}

export interface CampaignFilterParams {
  search?: string
  status?: CampaignStatus | 'ALL'
  productId?: string
  voucherId?: string
  page?: number
  pageSize?: number
  now?: Date | string | number
}

// ============================================================
// PURE FUNCTION: BOUNDARY STATE ENGINE
// ============================================================

/**
 * Tính toán trạng thái động của Campaign theo ranh giới thời gian thực (Zero-Drift Boundary Engine).
 * - CANCELLED: Nếu status được đánh dấu hủy thủ công
 * - UPCOMING: now < startDate
 * - RUNNING: startDate <= now <= endDate
 * - ENDED: now > endDate
 *
 * @param campaign Đối tượng chứa startDate, endDate và status
 * @param now Mốc thời gian đối chiếu (mặc định là Date.now())
 */
export function computeCampaignStatus(
  campaign: {
    startDate: Date | string | number
    endDate: Date | string | number
    status?: string | null
  },
  now: Date | string | number = new Date()
): CampaignStatus {
  if (campaign.status === 'CANCELLED') {
    return 'CANCELLED'
  }

  const startMs = new Date(campaign.startDate).getTime()
  const endMs = new Date(campaign.endDate).getTime()
  const nowMs = new Date(now).getTime()

  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    return 'ENDED'
  }

  if (nowMs < startMs) {
    return 'UPCOMING'
  }
  if (nowMs >= startMs && nowMs <= endMs) {
    return 'RUNNING'
  }
  return 'ENDED'
}

// ============================================================
// VALIDATION & HELPERS
// ============================================================

/**
 * Kiểm tra tính hợp lệ của khoảng thời gian chiến dịch.
 * Chặn trường hợp endDate <= startDate.
 */
export function validateCampaignDates(
  startDate: Date | string | number,
  endDate: Date | string | number
): { valid: boolean; error?: string } {
  const startMs = new Date(startDate).getTime()
  const endMs = new Date(endDate).getTime()

  if (Number.isNaN(startMs)) {
    return { valid: false, error: 'Thời gian bắt đầu không hợp lệ' }
  }
  if (Number.isNaN(endMs)) {
    return { valid: false, error: 'Thời gian kết thúc không hợp lệ' }
  }
  if (endMs <= startMs) {
    return { valid: false, error: 'Thời gian kết thúc phải diễn ra sau thời gian bắt đầu' }
  }

  return { valid: true }
}

/**
 * Sinh mã chiến dịch mặc định duy nhất: CP-YYYYMMDD-XXXX
 */
export function generateCampaignCode(): string {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const randomPart = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `CP-${dateStr}-${randomPart}`
}

function parseJsonArray<T = string>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function parseJsonObject<T = Record<string, unknown>>(raw: unknown): T {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as T
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : ({} as T)
    } catch {
      return {} as T
    }
  }
  return {} as T
}

// ============================================================
// DATA ENRICHMENT (M1 ↔ M3 PRICING & VOUCHER ENGINE)
// ============================================================

/**
 * Làm giàu dữ liệu chiến dịch: tính giá ưu đãi cho từng sản phẩm và lấy thông tin chi tiết voucher.
 */
export async function enrichCampaignData(
  campaign: Campaign,
  options?: { now?: Date | string | number }
): Promise<CampaignData> {
  const now = options?.now ?? new Date()
  const productIds = parseJsonArray<string>(campaign.appliedProductIds)
  const voucherIds = parseJsonArray<string>(campaign.appliedVoucherIds)
  const productOverrides = parseJsonObject<Record<string, { specialPrice?: number; discountPercent?: number }>>(
    campaign.productOverrides
  )
  const tags = parseJsonArray<string>(campaign.tags)

  // 1. Phân giải danh sách sản phẩm & tính toán giá
  const products = productIds.length > 0
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          sku: true,
          name: true,
          sellPrice: true,
          costPrice: true,
          image: true,
          status: true,
        },
      })
    : []

  const enrichedProducts: EnrichedProductPricing[] = products.map((prod) => {
    const override = productOverrides[prod.id]
    let campaignPrice = prod.sellPrice
    let discountPercent: number | undefined = undefined

    if (override?.specialPrice !== undefined && override.specialPrice !== null) {
      campaignPrice = Math.max(0, override.specialPrice)
      if (prod.sellPrice > 0) {
        discountPercent = Math.round(((prod.sellPrice - campaignPrice) / prod.sellPrice) * 1000) / 10
      }
    } else if (override?.discountPercent !== undefined && override.discountPercent !== null) {
      const pct = Math.min(100, Math.max(0, override.discountPercent))
      campaignPrice = Math.round(prod.sellPrice * (1 - pct / 100))
      discountPercent = pct
    } else if (campaign.discountPercent && campaign.discountPercent > 0) {
      const pct = Math.min(100, campaign.discountPercent)
      campaignPrice = Math.round(prod.sellPrice * (1 - pct / 100))
      discountPercent = pct
    } else if (campaign.discountAmount && campaign.discountAmount > 0) {
      campaignPrice = Math.max(0, prod.sellPrice - campaign.discountAmount)
      if (prod.sellPrice > 0) {
        discountPercent = Math.round(((prod.sellPrice - campaignPrice) / prod.sellPrice) * 1000) / 10
      }
    }

    const discountAmount = Math.max(0, prod.sellPrice - campaignPrice)

    return {
      id: prod.id,
      sku: prod.sku,
      name: prod.name,
      price: campaignPrice, // Contract M1 ↔ M3
      originalPrice: prod.sellPrice,
      campaignPrice,
      discountPercent: discountPercent && discountPercent > 0 ? discountPercent : undefined,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      costPrice: prod.costPrice,
      image: prod.image,
      status: prod.status,
    }
  })

  // 2. Phân giải danh sách Voucher
  const voucherQueryOr: Array<{ id?: { in: string[] }; code?: string } | { id: string }> = []
  if (voucherIds.length > 0) {
    voucherQueryOr.push({ id: { in: voucherIds } })
  }
  if (campaign.voucherId) {
    voucherQueryOr.push({ id: campaign.voucherId })
  }
  if (campaign.voucherCode) {
    voucherQueryOr.push({ code: campaign.voucherCode })
  }

  const rawVouchers = voucherQueryOr.length > 0
    ? await db.voucher.findMany({
        where: { OR: voucherQueryOr },
      })
    : []

  // Deduplicate vouchers by ID
  const voucherMap = new Map<string, (typeof rawVouchers)[0]>()
  for (const v of rawVouchers) {
    voucherMap.set(v.id, v)
  }

  const enrichedVouchers: EnrichedVoucherInfo[] = Array.from(voucherMap.values()).map((v) => ({
    id: v.id,
    code: v.code,
    title: v.title,
    discountType: v.discountType,
    discountValue: v.discountValue,
    discountPercent: v.discountType === 'PERCENT' ? v.discountValue : undefined,
    discountAmount: v.discountType === 'FIXED' ? v.discountValue : undefined,
    minOrderValue: v.minOrderAmount,
    maxDiscount: v.maxDiscount,
    active: v.active,
    expiresAt: v.expiresAt ? v.expiresAt.toISOString() : null,
  }))

  const computedStatus = computeCampaignStatus(campaign, now)

  return {
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    title: campaign.title || campaign.name,
    description: campaign.description || '',
    startDate: campaign.startDate.toISOString(),
    endDate: campaign.endDate.toISOString(),
    status: computedStatus,
    discountPercent: campaign.discountPercent,
    discountAmount: campaign.discountAmount,
    voucherId: campaign.voucherId,
    voucherCode: campaign.voucherCode,
    appliedProductIds: productIds,
    appliedVoucherIds: voucherIds,
    productOverrides,
    bannerUrl: campaign.bannerUrl,
    tags,
    products: enrichedProducts,
    vouchers: enrichedVouchers,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  }
}

// ============================================================
// AUDIT LOG HELPER
// ============================================================

async function logCampaignAudit(
  campaignId: string,
  action: 'CREATE' | 'UPDATE' | 'DELETE',
  details?: unknown,
  actor = 'OPERATOR'
) {
  try {
    await db.auditLog.create({
      data: {
        entityType: 'Campaign',
        entityId: campaignId,
        action,
        actor,
        details: details ? JSON.stringify(details) : null,
        status: 'SUCCESS',
      },
    })
  } catch (err) {
    console.warn('[AuditLog] Failed to record Campaign audit:', err)
  }
}

// ============================================================
// CRUD SERVICES
// ============================================================

/**
 * Tạo mới chiến dịch (Campaign)
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignData> {
  const name = (input.name || input.title || '').trim()
  if (!name) {
    throw new Error('Tên chương trình không được để trống')
  }

  const dateCheck = validateCampaignDates(input.startDate, input.endDate)
  if (!dateCheck.valid) {
    throw new Error(dateCheck.error)
  }

  const startDate = new Date(input.startDate)
  const endDate = new Date(input.endDate)
  const code = (input.code || '').trim() || generateCampaignCode()

  // Kiểm tra mã chiến dịch duy nhất
  const existing = await db.campaign.findUnique({ where: { code } })
  if (existing) {
    const err = new Error(`Mã chiến dịch "${code}" đã tồn tại`)
    ;(err as unknown as { statusCode: number }).statusCode = 409
    throw err
  }

  // Chuẩn hóa JSON fields
  const appliedProductIds = Array.isArray(input.appliedProductIds)
    ? JSON.stringify(input.appliedProductIds)
    : typeof input.appliedProductIds === 'string'
      ? input.appliedProductIds
      : null

  const appliedVoucherIds = Array.isArray(input.appliedVoucherIds)
    ? JSON.stringify(input.appliedVoucherIds)
    : typeof input.appliedVoucherIds === 'string'
      ? input.appliedVoucherIds
      : null

  const productOverrides = input.productOverrides
    ? typeof input.productOverrides === 'string'
      ? input.productOverrides
      : JSON.stringify(input.productOverrides)
    : null

  const tags = Array.isArray(input.tags)
    ? JSON.stringify(input.tags)
    : typeof input.tags === 'string'
      ? input.tags
      : null

  const computedStatus = input.status === 'CANCELLED'
    ? 'CANCELLED'
    : computeCampaignStatus({ startDate, endDate, status: input.status })

  const created = await db.campaign.create({
    data: {
      code,
      name,
      title: input.title?.trim() || name,
      description: input.description?.trim() || null,
      startDate,
      endDate,
      status: computedStatus,
      discountPercent: input.discountPercent !== undefined && input.discountPercent !== null ? Number(input.discountPercent) : null,
      discountAmount: input.discountAmount !== undefined && input.discountAmount !== null ? Number(input.discountAmount) : null,
      voucherId: input.voucherId || null,
      voucherCode: input.voucherCode?.trim() || null,
      appliedProductIds,
      appliedVoucherIds,
      productOverrides,
      bannerUrl: input.bannerUrl?.trim() || null,
      tags,
    },
  })

  await logCampaignAudit(created.id, 'CREATE', { code: created.code, name: created.name })
  await recordCampaignWave(
    created,
    null,
    input.waveName?.trim() || 'Đợt 1 · Khởi tạo & Mở bán chương trình',
    input.waveNote?.trim() || 'Thiết lập thông số ưu đãi, danh sách sản phẩm và mã Voucher khởi điểm cho chiến dịch.'
  ).catch(() => null)

  return enrichCampaignData(created)
}

/**
 * Lấy chi tiết chiến dịch theo ID hoặc Code (kèm tính giá và làm giàu dữ liệu)
 */
export async function getCampaign(
  idOrCode: string,
  options?: { now?: Date | string | number }
): Promise<CampaignData | null> {
  const campaign = await db.campaign.findFirst({
    where: {
      OR: [{ id: idOrCode }, { code: idOrCode }],
    },
  })

  if (!campaign) return null
  return enrichCampaignData(campaign, options)
}

/**
 * Lấy danh sách chiến dịch có tìm kiếm, lọc theo trạng thái động và phân trang
 */
export async function listCampaigns(params?: CampaignFilterParams): Promise<{
  campaigns: CampaignData[]
  total: number
  page: number
  pageSize: number
}> {
  const page = Math.max(1, params?.page ?? 1)
  const pageSize = Math.max(1, Math.min(100, params?.pageSize ?? 20))
  const now = params?.now ?? new Date()
  const search = params?.search?.trim()

  const whereClause: Record<string, unknown> = {}

  if (search) {
    whereClause.OR = [
      { name: { contains: search } },
      { title: { contains: search } },
      { code: { contains: search } },
      { description: { contains: search } },
    ]
  }

  // Lấy toàn bộ hoặc lọc theo Prisma
  const allCampaigns = await db.campaign.findMany({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  })

  // Áp dụng tính toán trạng thái động và lọc theo status nếu có yêu cầu
  const filterStatus = params?.status && params.status !== 'ALL' ? params.status : null

  const enrichedList = await Promise.all(
    allCampaigns.map((c) => enrichCampaignData(c, { now }))
  )

  const filtered = filterStatus
    ? enrichedList.filter((c) => c.status === filterStatus)
    : enrichedList

  // Phân trang trên mảng kết quả đã làm giàu và lọc động
  const total = filtered.length
  const startIndex = (page - 1) * pageSize
  const paginated = filtered.slice(startIndex, startIndex + pageSize)

  return {
    campaigns: paginated,
    total,
    page,
    pageSize,
  }
}

/**
 * Cập nhật chiến dịch
 */
export async function updateCampaign(
  id: string,
  input: UpdateCampaignInput
): Promise<CampaignData> {
  const existing = await db.campaign.findUnique({ where: { id } })
  if (!existing) {
    const err = new Error(`Không tìm thấy chiến dịch có ID "${id}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  // Xác định ngày bắt đầu / kết thúc mới
  const newStartDate = input.startDate !== undefined ? new Date(input.startDate) : existing.startDate
  const newEndDate = input.endDate !== undefined ? new Date(input.endDate) : existing.endDate

  const dateCheck = validateCampaignDates(newStartDate, newEndDate)
  if (!dateCheck.valid) {
    throw new Error(dateCheck.error)
  }

  // Nếu cập nhật mã code, kiểm tra không bị trùng với bản ghi khác
  if (input.code && input.code !== existing.code) {
    const codeConflict = await db.campaign.findFirst({
      where: { code: input.code, id: { not: id } },
    })
    if (codeConflict) {
      const err = new Error(`Mã chiến dịch "${input.code}" đã được sử dụng`)
      ;(err as unknown as { statusCode: number }).statusCode = 409
      throw err
    }
  }

  const updateData: Record<string, unknown> = {
    startDate: newStartDate,
    endDate: newEndDate,
  }

  if (input.code !== undefined) updateData.code = input.code.trim()
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.title !== undefined) updateData.title = input.title.trim()
  if (input.description !== undefined) updateData.description = input.description ? input.description.trim() : null
  if (input.bannerUrl !== undefined) updateData.bannerUrl = input.bannerUrl ? input.bannerUrl.trim() : null
  if (input.voucherId !== undefined) updateData.voucherId = input.voucherId || null
  if (input.voucherCode !== undefined) updateData.voucherCode = input.voucherCode ? input.voucherCode.trim() : null

  if (input.discountPercent !== undefined) {
    updateData.discountPercent = input.discountPercent !== null ? Number(input.discountPercent) : null
  }
  if (input.discountAmount !== undefined) {
    updateData.discountAmount = input.discountAmount !== null ? Number(input.discountAmount) : null
  }

  if (input.appliedProductIds !== undefined) {
    updateData.appliedProductIds = Array.isArray(input.appliedProductIds)
      ? JSON.stringify(input.appliedProductIds)
      : input.appliedProductIds
  }
  if (input.appliedVoucherIds !== undefined) {
    updateData.appliedVoucherIds = Array.isArray(input.appliedVoucherIds)
      ? JSON.stringify(input.appliedVoucherIds)
      : input.appliedVoucherIds
  }
  if (input.productOverrides !== undefined) {
    updateData.productOverrides = input.productOverrides
      ? typeof input.productOverrides === 'string'
        ? input.productOverrides
        : JSON.stringify(input.productOverrides)
      : null
  }
  if (input.tags !== undefined) {
    updateData.tags = Array.isArray(input.tags)
      ? JSON.stringify(input.tags)
      : input.tags
  }

  // Xử lý status
  if (input.status === 'CANCELLED') {
    updateData.status = 'CANCELLED'
  } else if (input.status) {
    updateData.status = computeCampaignStatus({
      startDate: newStartDate,
      endDate: newEndDate,
      status: input.status,
    })
  } else {
    // Tự động tính toán lại status theo ngày mới
    updateData.status = computeCampaignStatus({
      startDate: newStartDate,
      endDate: newEndDate,
      status: existing.status,
    })
  }

  const updated = await db.campaign.update({
    where: { id },
    data: updateData,
  })

  await logCampaignAudit(id, 'UPDATE', { changes: Object.keys(updateData) })
  await recordCampaignWave(
    updated,
    existing,
    input.waveName?.trim() || undefined,
    input.waveNote?.trim() || undefined
  ).catch(() => null)

  return enrichCampaignData(updated)
}

/**
 * Xóa chiến dịch
 */
export async function deleteCampaign(id: string): Promise<{ success: boolean; message: string }> {
  const existing = await db.campaign.findUnique({ where: { id } })
  if (!existing) {
    const err = new Error(`Không tìm thấy chiến dịch có ID "${id}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  await db.ledgerEntry
    .deleteMany({
      where: { scope: 'CAMPAIGN_WAVE', entityId: id },
    })
    .catch(() => null)
  await db.campaign.delete({ where: { id } })
  await logCampaignAudit(id, 'DELETE', { code: existing.code, name: existing.name })

  return { success: true, message: `Đã xóa chiến dịch "${existing.name}" (${existing.code})` }
}

// ============================================================
// QUẢN LÝ SỰ THAY ĐỔI TỪNG ĐỢT CỦA CHƯƠNG TRÌNH (CAMPAIGN WAVES)
// ============================================================

function buildCampaignSnapshot(c: Campaign): CampaignWaveSnapshot {
  return {
    name: c.name,
    title: c.title,
    description: c.description,
    startDate: c.startDate.toISOString(),
    endDate: c.endDate.toISOString(),
    status: computeCampaignStatus(c),
    discountPercent: c.discountPercent,
    discountAmount: c.discountAmount,
    voucherId: c.voucherId,
    voucherCode: c.voucherCode,
    appliedProductIds: parseJsonArray<string>(c.appliedProductIds),
    appliedVoucherIds: parseJsonArray<string>(c.appliedVoucherIds),
    productOverrides: parseJsonObject<Record<string, { specialPrice?: number; discountPercent?: number }>>(
      c.productOverrides
    ),
  }
}

export function diffCampaignSnapshots(
  prev: CampaignWaveSnapshot | null | undefined,
  next: CampaignWaveSnapshot
): CampaignWaveDiff[] {
  const fmtVnd = (n: number) => `${n.toLocaleString('vi-VN')}₫`
  if (!prev) {
    return [
      {
        field: 'init',
        label: 'Khởi tạo chương trình',
        before: 'Chưa có',
        after: `${next.discountPercent ? `Giảm ${next.discountPercent}%` : next.discountAmount ? `Giảm ${fmtVnd(next.discountAmount)}` : 'Giá niêm yết'}${next.voucherCode ? ` · Voucher ${next.voucherCode}` : ''} · ${next.appliedProductIds.length} sản phẩm`,
      },
    ]
  }

  const diffs: CampaignWaveDiff[] = []
  if (prev.name !== next.name) {
    diffs.push({ field: 'name', label: 'Tên chương trình', before: prev.name, after: next.name })
  }
  if ((prev.discountPercent ?? 0) !== (next.discountPercent ?? 0)) {
    diffs.push({
      field: 'discountPercent',
      label: '% Giảm giá chung',
      before: prev.discountPercent ? `${prev.discountPercent}%` : '0%',
      after: next.discountPercent ? `${next.discountPercent}%` : '0%',
    })
  }
  if ((prev.discountAmount ?? 0) !== (next.discountAmount ?? 0)) {
    diffs.push({
      field: 'discountAmount',
      label: 'Mức giảm tiền trực tiếp',
      before: prev.discountAmount ? fmtVnd(prev.discountAmount) : '0₫',
      after: next.discountAmount ? fmtVnd(next.discountAmount) : '0₫',
    })
  }
  if ((prev.voucherCode || '') !== (next.voucherCode || '')) {
    diffs.push({
      field: 'voucherCode',
      label: 'Mã Voucher đính kèm',
      before: prev.voucherCode || 'Không dùng',
      after: next.voucherCode || 'Không dùng',
    })
  }
  if (prev.startDate.slice(0, 16) !== next.startDate.slice(0, 16) || prev.endDate.slice(0, 16) !== next.endDate.slice(0, 16)) {
    diffs.push({
      field: 'dates',
      label: 'Khung thời gian diễn ra',
      before: `${prev.startDate.slice(0, 10)} → ${prev.endDate.slice(0, 10)}`,
      after: `${next.startDate.slice(0, 10)} → ${next.endDate.slice(0, 10)}`,
    })
  }
  if (prev.appliedProductIds.length !== next.appliedProductIds.length) {
    diffs.push({
      field: 'appliedProductIds',
      label: 'Số sản phẩm áp dụng',
      before: `${prev.appliedProductIds.length} SP`,
      after: `${next.appliedProductIds.length} SP`,
    })
  }
  const prevOverridesStr = JSON.stringify(prev.productOverrides || {})
  const nextOverridesStr = JSON.stringify(next.productOverrides || {})
  if (prevOverridesStr !== nextOverridesStr) {
    const prevCount = Object.keys(prev.productOverrides || {}).length
    const nextCount = Object.keys(next.productOverrides || {}).length
    diffs.push({
      field: 'productOverrides',
      label: 'Ghi đè giá đặc biệt từng SP',
      before: `${prevCount} SP có giá riêng`,
      after: `${nextCount} SP có giá riêng`,
    })
  }

  return diffs
}

export async function recordCampaignWave(
  campaign: Campaign,
  prevCampaign: Campaign | null,
  waveName?: string,
  waveNote?: string,
  actorName = 'Chủ tiệm Ưu Đàm'
): Promise<CampaignWave> {
  const existingEntries = await db.ledgerEntry.findMany({
    where: { scope: 'CAMPAIGN_WAVE', entityId: campaign.id },
    orderBy: { createdAt: 'asc' },
  })

  for (const e of existingEntries) {
    try {
      const parsed = JSON.parse(e.detail || '{}') as CampaignWave
      if (parsed.isActive) {
        parsed.isActive = false
        await db.ledgerEntry.update({
          where: { id: e.id },
          data: { detail: JSON.stringify(parsed) },
        })
      }
    } catch {
      // ignore
    }
  }

  const nextWaveNumber = existingEntries.length + 1
  const waveCode = `${campaign.code}#DOT-${String(nextWaveNumber).padStart(2, '0')}`
  const prevSnap = prevCampaign ? buildCampaignSnapshot(prevCampaign) : null
  const nextSnap = buildCampaignSnapshot(campaign)
  const changedSummary = diffCampaignSnapshots(prevSnap, nextSnap)
  const nowIso = new Date().toISOString()

  const payload: Omit<CampaignWave, 'id'> = {
    campaignId: campaign.id,
    campaignCode: campaign.code,
    waveNumber: nextWaveNumber,
    waveCode,
    waveName: waveName || `Đợt ${nextWaveNumber} · Điều chỉnh cấu hình chương trình`,
    waveNote:
      waveNote ||
      (changedSummary.length > 0
        ? changedSummary.map((d) => `${d.label}: ${d.before} → ${d.after}`).join('; ')
        : 'Cập nhật cấu hình chương trình khuyến mãi'),
    actorName,
    isActive: true,
    createdAt: nowIso,
    snapshot: nextSnap,
    changedSummary,
  }

  const created = await db.ledgerEntry.create({
    data: {
      scope: 'CAMPAIGN_WAVE',
      action: 'CAMPAIGN_WAVE_SAVED',
      entityType: 'Campaign',
      entityId: campaign.id,
      entityCode: waveCode,
      sourceRefCode: campaign.code,
      title: payload.waveName,
      detail: JSON.stringify(payload),
      actor: 'OPERATOR',
      actorName,
      originSource: 'MANUAL_ADMIN',
      beforeSnapshot: prevSnap ? JSON.stringify(prevSnap) : null,
      afterSnapshot: JSON.stringify(nextSnap),
      changedFields: JSON.stringify(changedSummary.map((d) => d.field)),
    },
  })

  return { id: created.id, ...payload }
}

/** Lấy danh sách các Đợt thay đổi của 1 chiến dịch (tự động khởi tạo Đợt 1 & Đợt 2 mẫu nếu chưa có) */
export async function listCampaignWaves(campaignIdOrCode: string): Promise<CampaignWave[]> {
  const campaign = await db.campaign.findFirst({
    where: { OR: [{ id: campaignIdOrCode }, { code: campaignIdOrCode }] },
  })
  if (!campaign) return []

  let entries = await db.ledgerEntry.findMany({
    where: { scope: 'CAMPAIGN_WAVE', entityId: campaign.id },
    orderBy: { createdAt: 'asc' },
  })

  if (entries.length === 0) {
    const snapCurrent = buildCampaignSnapshot(campaign)
    // Nếu là chiến dịch CP-THACHCAO-2026, khởi tạo lịch sử Đợt 1 (Ra mắt sớm -10%) -> Đợt 2 (Đang chạy -15% + UUDAM10)
    if (campaign.code === 'CP-THACHCAO-2026') {
      const snapWave1: CampaignWaveSnapshot = {
        ...snapCurrent,
        discountPercent: 10,
        voucherCode: null,
        voucherId: null,
        startDate: new Date(campaign.startDate.getTime() - 7 * 86400_000).toISOString(),
      }
      const wave1Payload: Omit<CampaignWave, 'id'> = {
        campaignId: campaign.id,
        campaignCode: campaign.code,
        waveNumber: 1,
        waveCode: `${campaign.code}#DOT-01`,
        waveName: 'Đợt 1 · Mở bán Sớm (Early Bird) Bộ sưu tập Thạch Cao An Nhiên Thạch (-10%)',
        waveNote: 'Đợt mở bán thăm dò tuần đầu tiên: ưu đãi giảm 10% trên toàn bộ 10 sản phẩm Thạch Cao & Nến Bấc Gỗ.',
        actorName: 'Chủ tiệm Ưu Đàm',
        isActive: false,
        createdAt: new Date(campaign.startDate.getTime() - 7 * 86400_000).toISOString(),
        snapshot: snapWave1,
        changedSummary: diffCampaignSnapshots(null, snapWave1),
      }
      const wave2Payload: Omit<CampaignWave, 'id'> = {
        campaignId: campaign.id,
        campaignCode: campaign.code,
        waveNumber: 2,
        waveCode: `${campaign.code}#DOT-02`,
        waveName: 'Đợt 2 · Chính thức Ra Mắt & Đồng hành 4 KOL Châu Á (-15% + Mã UUDAM10)',
        waveNote: 'Nâng mức chiết khấu toàn chiến dịch từ 10% lên 15% và kích hoạt mã Voucher UUDAM10 (-10% tối đa 50k) khi 4 KOL lên bài bảo chứng.',
        actorName: 'Chủ tiệm Ưu Đàm',
        isActive: true,
        createdAt: campaign.startDate.toISOString(),
        snapshot: snapCurrent,
        changedSummary: diffCampaignSnapshots(snapWave1, snapCurrent),
      }

      await db.ledgerEntry.create({
        data: {
          scope: 'CAMPAIGN_WAVE',
          action: 'CAMPAIGN_WAVE_SAVED',
          entityType: 'Campaign',
          entityId: campaign.id,
          entityCode: wave1Payload.waveCode,
          sourceRefCode: campaign.code,
          title: wave1Payload.waveName,
          detail: JSON.stringify(wave1Payload),
          actor: 'OPERATOR',
          actorName: wave1Payload.actorName,
          originSource: 'SYSTEM_SEED',
          afterSnapshot: JSON.stringify(snapWave1),
          createdAt: new Date(wave1Payload.createdAt),
        },
      })
      await db.ledgerEntry.create({
        data: {
          scope: 'CAMPAIGN_WAVE',
          action: 'CAMPAIGN_WAVE_SAVED',
          entityType: 'Campaign',
          entityId: campaign.id,
          entityCode: wave2Payload.waveCode,
          sourceRefCode: campaign.code,
          title: wave2Payload.waveName,
          detail: JSON.stringify(wave2Payload),
          actor: 'OPERATOR',
          actorName: wave2Payload.actorName,
          originSource: 'MANUAL_ADMIN',
          beforeSnapshot: JSON.stringify(snapWave1),
          afterSnapshot: JSON.stringify(snapCurrent),
          createdAt: new Date(wave2Payload.createdAt),
        },
      })
    } else {
      await recordCampaignWave(
        campaign,
        null,
        'Đợt 1 · Khởi tạo chương trình khuyến mãi',
        'Thiết lập cấu hình gốc của chương trình.'
      )
    }

    entries = await db.ledgerEntry.findMany({
      where: { scope: 'CAMPAIGN_WAVE', entityId: campaign.id },
      orderBy: { createdAt: 'asc' },
    })
  }

  const waves: CampaignWave[] = []
  for (const e of entries) {
    try {
      const parsed = JSON.parse(e.detail || '{}') as CampaignWave
      waves.push({
        ...parsed,
        id: e.id,
      })
    } catch {
      // ignore
    }
  }

  return waves.sort((a, b) => b.waveNumber - a.waveNumber)
}

/** Kích hoạt / Khôi phục cấu hình của một Đợt bất kỳ cho Chiến dịch */
export async function activateCampaignWave(
  campaignIdOrCode: string,
  waveIdOrCode: string,
  actorName = 'Chủ tiệm Ưu Đàm'
): Promise<{ campaign: CampaignData; waves: CampaignWave[] }> {
  const campaign = await db.campaign.findFirst({
    where: { OR: [{ id: campaignIdOrCode }, { code: campaignIdOrCode }] },
  })
  if (!campaign) {
    throw new Error(`Không tìm thấy chiến dịch: ${campaignIdOrCode}`)
  }

  const wavesAsc = (await listCampaignWaves(campaign.id)).sort((a, b) => a.waveNumber - b.waveNumber)
  const targetWave = wavesAsc.find((w) => w.id === waveIdOrCode || w.waveCode === waveIdOrCode)
  if (!targetWave) {
    throw new Error(`Không tìm thấy đợt điều chỉnh: ${waveIdOrCode}`)
  }

  const snap = targetWave.snapshot
  const updatedCampaign = await db.campaign.update({
    where: { id: campaign.id },
    data: {
      name: snap.name || campaign.name,
      title: snap.title ?? campaign.title,
      description: snap.description ?? campaign.description,
      discountPercent: snap.discountPercent ?? null,
      discountAmount: snap.discountAmount ?? null,
      voucherId: snap.voucherId ?? null,
      voucherCode: snap.voucherCode ?? null,
      appliedProductIds: JSON.stringify(snap.appliedProductIds ?? []),
      appliedVoucherIds: JSON.stringify(snap.appliedVoucherIds ?? []),
      productOverrides: JSON.stringify(snap.productOverrides ?? {}),
    },
  })

  const entries = await db.ledgerEntry.findMany({
    where: { scope: 'CAMPAIGN_WAVE', entityId: campaign.id },
  })
  for (const e of entries) {
    try {
      const parsed = JSON.parse(e.detail || '{}') as CampaignWave
      parsed.isActive = e.id === targetWave.id
      await db.ledgerEntry.update({
        where: { id: e.id },
        data: { detail: JSON.stringify(parsed) },
      })
    } catch {
      // ignore
    }
  }

  await logCampaignAudit(
    campaign.id,
    'UPDATE',
    { action: 'ACTIVATE_WAVE', waveCode: targetWave.waveCode, waveName: targetWave.waveName },
    actorName
  )

  const [enriched, refreshedWaves] = await Promise.all([
    enrichCampaignData(updatedCampaign),
    listCampaignWaves(campaign.id),
  ])

  return { campaign: enriched, waves: refreshedWaves }
}
