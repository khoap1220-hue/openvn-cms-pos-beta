// src/lib/social-scheduler.ts
// Milestone 4 (M4: Review & Scheduling Engine - R4)
// State machine, Three Iron Publishing Gates, Concurrency Idempotency Lock, Pluggable Publisher, and Queue Runner.

import { db } from '@/lib/db'
import { computeCampaignStatus } from '@/lib/campaign-service'
import type { SocialPost, Campaign } from '@prisma/client'

// ============================================================
// TYPES & INTERFACES
// ============================================================

export type PostStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'REJECTED'

export type SocialPlatform =
  | 'FACEBOOK'
  | 'ZALO_OA'
  | 'WEBSITE'
  | 'EXTERNAL_CMS'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'THREADS'

export const VALID_PLATFORMS: SocialPlatform[] = [
  'FACEBOOK',
  'ZALO_OA',
  'WEBSITE',
  'EXTERNAL_CMS',
  'INSTAGRAM',
  'TIKTOK',
  'THREADS',
]

export interface CreatePostInput {
  channel: string
  content: string
  title?: string | null
  campaignId?: string | null
  planId?: string | null
  slug?: string | null
  excerpt?: string | null
  mediaUrls?: string[] | string | null
  mediaType?: 'NONE' | 'IMAGE' | 'VIDEO' | 'CAROUSEL' | string | null
  hashtags?: string[] | string | null
  targetUrl?: string | null
  scheduledAt?: Date | string | null
  status?: PostStatus
  isMock?: boolean
}

export interface UpdatePostInput {
  channel?: string
  content?: string
  title?: string | null
  campaignId?: string | null
  planId?: string | null
  slug?: string | null
  excerpt?: string | null
  mediaUrls?: string[] | string | null
  mediaType?: string | null
  hashtags?: string[] | string | null
  targetUrl?: string | null
  scheduledAt?: Date | string | null
  status?: PostStatus
  approvalNote?: string | null
  isMock?: boolean
}

export interface PostFilterParams {
  campaignId?: string
  planId?: string
  channel?: string
  status?: string
  search?: string
  page?: number
  pageSize?: number
}

export interface PublishRequest {
  postId: string
  channel: string
  content: string
  title?: string | null
  mediaUrls?: string[]
  scheduledAt?: Date | null
  isMock: boolean
}

export interface PublishResult {
  success: boolean
  externalPostId?: string
  externalPostUrl?: string
  publishedAt?: Date
  error?: string
  isMockResult?: boolean
}

export type PublisherFunction = (request: PublishRequest) => Promise<PublishResult>

export interface PublishOptions {
  now?: Date | string | number
  actor?: string
  actorName?: string
  publisher?: PublisherFunction
  skipTimeGate?: boolean
}

export interface PublishItemResult {
  success: boolean
  postId: string
  skipped?: boolean
  error?: string
  reason?: string
  externalPostId?: string
  externalPostUrl?: string
  publishedAt?: Date
  isMockResult?: boolean
}

export interface ProcessScheduledOptions {
  referenceTime?: Date | string | number
  actor?: string
  publisher?: PublisherFunction
}

export interface ProcessScheduledResult {
  processed: number
  published: number
  skipped: number
  failed: number
  results: PublishItemResult[]
}

// ============================================================
// DEFAULT SAFE MOCK PUBLISHER & PLUGGABLE ADAPTER
// ============================================================

export const defaultMockPublisher: PublisherFunction = async (req: PublishRequest): Promise<PublishResult> => {
  // Validate basic payload requirements
  if (!req.content || !req.content.trim()) {
    return {
      success: false,
      error: 'Nội dung bài viết không được rỗng',
      isMockResult: true,
    }
  }

  const channelSlug = req.channel.toLowerCase().replace(/_/g, '-')
  const timestamp = Date.now()

  return {
    success: true,
    externalPostId: `mock_${channelSlug}_${timestamp}`,
    externalPostUrl: `https://${channelSlug}.mock-social.local/p/${timestamp}`,
    publishedAt: new Date(),
    isMockResult: true,
  }
}

let activePublisher: PublisherFunction = defaultMockPublisher

/**
 * Cấu hình adapter xuất bản tùy biến (dùng cho tích hợp Milestone 5 hoặc mock trong test)
 */
export function setPublisher(publisher: PublisherFunction | null) {
  activePublisher = publisher || defaultMockPublisher
}

export function getPublisher(): PublisherFunction {
  return activePublisher
}

// ============================================================
// AUDIT LOG HELPER
// ============================================================

async function logPostAudit({
  postId,
  action,
  actor = 'OPERATOR',
  actorName,
  details,
  status = 'SUCCESS',
  errorMessage,
}: {
  postId: string
  action: string
  actor?: string
  actorName?: string
  details?: unknown
  status?: 'SUCCESS' | 'FAILED' | 'WARNING'
  errorMessage?: string
}) {
  try {
    return await db.auditLog.create({
      data: {
        entityType: 'SocialPost',
        entityId: postId,
        action,
        actor,
        actorName,
        details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
        status,
        errorMessage,
      },
    })
  } catch (err) {
    console.warn(`[AuditLog] Failed to log SocialPost action "${action}":`, err)
    return null
  }
}

// ============================================================
// POST CRUD & LIFECYCLE STATE MACHINE (FEAT-REV-01)
// ============================================================

/**
 * Tạo mới bài viết mạng xã hội (mặc định DRAFT)
 */
export async function createPost(input: CreatePostInput, actor = 'OPERATOR') {
  const channel = (input.channel || '').toUpperCase().trim()
  if (!channel) {
    throw new Error('Nền tảng xuất bản (channel) không được để trống')
  }

  const content = (input.content || '').trim()
  if (!content) {
    throw new Error('Nội dung bài viết không được để trống')
  }

  const mediaUrls = Array.isArray(input.mediaUrls)
    ? JSON.stringify(input.mediaUrls)
    : typeof input.mediaUrls === 'string'
      ? input.mediaUrls
      : null

  const hashtags = Array.isArray(input.hashtags)
    ? JSON.stringify(input.hashtags)
    : typeof input.hashtags === 'string'
      ? input.hashtags
      : null

  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
  const initialStatus: PostStatus = input.status || 'DRAFT'

  const created = await db.socialPost.create({
    data: {
      channel,
      content,
      title: input.title?.trim() || null,
      campaignId: input.campaignId || null,
      planId: input.planId || null,
      slug: input.slug?.trim() || null,
      excerpt: input.excerpt?.trim() || null,
      mediaUrls,
      mediaType: input.mediaType || (mediaUrls ? 'IMAGE' : 'NONE'),
      hashtags,
      targetUrl: input.targetUrl?.trim() || null,
      scheduledAt,
      status: initialStatus,
      isMock: input.isMock !== undefined ? input.isMock : true,
    },
  })

  await logPostAudit({
    postId: created.id,
    action: 'CREATE',
    actor,
    details: { channel, title: created.title, status: created.status },
  })

  return created
}

/**
 * Cập nhật thông tin bài viết
 */
export async function updatePost(postId: string, input: UpdatePostInput, actor = 'OPERATOR') {
  const existing = await db.socialPost.findUnique({ where: { id: postId } })
  if (!existing) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  const updateData: Record<string, unknown> = {}

  if (input.channel !== undefined) updateData.channel = input.channel.toUpperCase().trim()
  if (input.content !== undefined) updateData.content = input.content.trim()
  if (input.title !== undefined) updateData.title = input.title ? input.title.trim() : null
  if (input.slug !== undefined) updateData.slug = input.slug ? input.slug.trim() : null
  if (input.excerpt !== undefined) updateData.excerpt = input.excerpt ? input.excerpt.trim() : null
  if (input.targetUrl !== undefined) updateData.targetUrl = input.targetUrl ? input.targetUrl.trim() : null
  if (input.mediaType !== undefined) updateData.mediaType = input.mediaType
  if (input.campaignId !== undefined) updateData.campaignId = input.campaignId || null
  if (input.planId !== undefined) updateData.planId = input.planId || null
  if (input.approvalNote !== undefined) updateData.approvalNote = input.approvalNote
  if (input.isMock !== undefined) updateData.isMock = input.isMock

  if (input.mediaUrls !== undefined) {
    updateData.mediaUrls = Array.isArray(input.mediaUrls)
      ? JSON.stringify(input.mediaUrls)
      : input.mediaUrls
  }

  if (input.hashtags !== undefined) {
    updateData.hashtags = Array.isArray(input.hashtags)
      ? JSON.stringify(input.hashtags)
      : input.hashtags
  }

  if (input.scheduledAt !== undefined) {
    updateData.scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null
  }

  if (input.status !== undefined) {
    updateData.status = input.status
    if (input.status === 'DRAFT' || input.status === 'PENDING_APPROVAL') {
      updateData.approvedAt = null
    }
  }

  const updated = await db.socialPost.update({
    where: { id: postId },
    data: updateData,
  })

  await logPostAudit({
    postId,
    action: 'UPDATE',
    actor,
    details: { changes: Object.keys(updateData) },
  })

  return updated
}

/**
 * Lấy chi tiết bài viết kèm thông tin chiến dịch, kế hoạch và nhật ký kiểm toán gần nhất
 */
export async function getPost(postId: string) {
  const post = await db.socialPost.findUnique({
    where: { id: postId },
    include: {
      campaign: true,
      plan: true,
    },
  })
  if (!post) return null

  const auditLogs = await db.auditLog.findMany({
    where: {
      entityType: 'SocialPost',
      entityId: postId,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  return {
    ...post,
    auditLogs,
  }
}

/**
 * Lấy danh sách bài viết theo bộ lọc và phân trang
 */
export async function listPosts(params?: PostFilterParams) {
  const page = Math.max(1, params?.page ?? 1)
  const pageSize = Math.max(1, Math.min(100, params?.pageSize ?? 20))
  const search = params?.search?.trim()

  const where: Record<string, unknown> = {}
  if (params?.campaignId) where.campaignId = params.campaignId
  if (params?.planId) where.planId = params.planId
  if (params?.channel) where.channel = params.channel.toUpperCase()
  if (params?.status && params.status !== 'ALL') where.status = params.status

  if (search) {
    where.OR = [
      { title: { contains: search } },
      { content: { contains: search } },
      { slug: { contains: search } },
    ]
  }

  const [total, posts] = await Promise.all([
    db.socialPost.count({ where }),
    db.socialPost.findMany({
      where,
      orderBy: [
        { scheduledAt: 'asc' },
        { createdAt: 'desc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        campaign: {
          select: { id: true, code: true, name: true, title: true, status: true },
        },
        plan: {
          select: { id: true, title: true },
        },
      },
    }),
  ])

  return {
    posts,
    total,
    page,
    pageSize,
  }
}

/**
 * Xóa bài viết (chỉ cho phép bài chưa xuất bản)
 */
export async function deletePost(postId: string, actor = 'OPERATOR') {
  const existing = await db.socialPost.findUnique({ where: { id: postId } })
  if (!existing) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  if (existing.status === 'PUBLISHED') {
    const err = new Error('Không thể xóa bài viết đã xuất bản công khai')
    ;(err as unknown as { statusCode: number }).statusCode = 400
    throw err
  }

  await db.socialPost.delete({ where: { id: postId } })

  await logPostAudit({
    postId,
    action: 'DELETE',
    actor,
    details: { channel: existing.channel, title: existing.title, previousStatus: existing.status },
  })

  return { success: true, message: `Đã xóa bài viết ${postId}` }
}

/**
 * Nộp bài để chờ duyệt: chuyển DRAFT hoặc REJECTED -> PENDING_APPROVAL
 */
export async function submitForApproval(postId: string, actor = 'OPERATOR') {
  const post = await db.socialPost.findUnique({ where: { id: postId } })
  if (!post) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  if (post.status === 'PUBLISHED') {
    throw new Error('Không thể nộp duyệt bài viết đã xuất bản')
  }

  const updated = await db.socialPost.update({
    where: { id: postId },
    data: {
      status: 'PENDING_APPROVAL',
      approvedAt: null,
    },
  })

  await logPostAudit({
    postId,
    action: 'UPDATE',
    actor,
    details: { transition: 'SUBMIT_FOR_APPROVAL', from: post.status, to: 'PENDING_APPROVAL' },
  })

  return updated
}

/**
 * Phê duyệt bài viết bởi chủ tiệm (FEAT-REV-01)
 * Chuyển status -> APPROVED (hoặc SCHEDULED nếu đã có scheduledAt)
 * Ghi nhận approvedBy, approvedAt, approvalNote và AuditLog
 */
export async function approvePost(
  postId: string,
  approver = 'Chủ tiệm Ưu Đàm',
  note?: string
) {
  const post = await db.socialPost.findUnique({ where: { id: postId } })
  if (!post) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  if (post.status === 'PUBLISHED') {
    throw new Error('Bài viết đã xuất bản thành công, không cần duyệt lại')
  }

  const targetStatus: PostStatus = post.scheduledAt ? 'SCHEDULED' : 'APPROVED'
  const approvedAt = new Date()

  const updated = await db.socialPost.update({
    where: { id: postId },
    data: {
      status: targetStatus,
      approvedBy: approver,
      approvedAt,
      approvalNote: note ? note.trim() : null,
    },
  })

  await logPostAudit({
    postId,
    action: 'APPROVE',
    actor: 'OPERATOR',
    actorName: approver,
    status: 'SUCCESS',
    details: {
      previousStatus: post.status,
      newStatus: targetStatus,
      note: note || null,
      approvedAt: approvedAt.toISOString(),
    },
  })

  return updated
}

/**
 * Từ chối duyệt bài viết (FEAT-REV-01)
 * Chuyển status -> REJECTED, ghi nhận approvalNote = reason, xóa approvedAt và ghi AuditLog
 */
export async function rejectPost(
  postId: string,
  approver = 'Chủ tiệm Ưu Đàm',
  reason: string
) {
  const post = await db.socialPost.findUnique({ where: { id: postId } })
  if (!post) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  if (post.status === 'PUBLISHED') {
    throw new Error('Không thể từ chối bài viết đã xuất bản công khai')
  }

  const reasonText = (reason || '').trim() || 'Từ chối bởi chủ tiệm'

  const updated = await db.socialPost.update({
    where: { id: postId },
    data: {
      status: 'REJECTED',
      approvalNote: reasonText,
      approvedAt: null,
      isPublishing: false,
    },
  })

  await logPostAudit({
    postId,
    action: 'REJECT',
    actor: 'OPERATOR',
    actorName: approver,
    status: 'SUCCESS',
    details: {
      reason: reasonText,
      previousStatus: post.status,
    },
  })

  return updated
}

/**
 * Cập nhật thời gian hẹn giờ đăng bài (FEAT-REV-01)
 * Nếu bài viết đã APPROVED, tự động nâng cấp sang SCHEDULED
 */
export async function reschedulePost(
  postId: string,
  scheduledAt: Date | string,
  actor = 'OPERATOR'
) {
  const post = await db.socialPost.findUnique({ where: { id: postId } })
  if (!post) {
    const err = new Error(`Không tìm thấy bài viết ID "${postId}"`)
    ;(err as unknown as { statusCode: number }).statusCode = 404
    throw err
  }

  if (post.status === 'PUBLISHED') {
    throw new Error('Không thể thay đổi lịch đăng cho bài viết đã xuất bản')
  }

  const targetDate = new Date(scheduledAt)
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error('Thời gian hẹn giờ đăng bài không hợp lệ')
  }

  const newStatus: PostStatus = post.status === 'APPROVED' ? 'SCHEDULED' : (post.status as PostStatus)

  const updated = await db.socialPost.update({
    where: { id: postId },
    data: {
      scheduledAt: targetDate,
      status: newStatus,
    },
  })

  await logPostAudit({
    postId,
    action: 'RESCHEDULE',
    actor,
    details: {
      previousScheduledAt: post.scheduledAt ? post.scheduledAt.toISOString() : null,
      scheduledAt: targetDate.toISOString(),
      status: newStatus,
    },
  })

  return updated
}

// ============================================================
// THE THREE IRON PUBLISHING GATES & CONCURRENCY LOCK (R4 INVARIANTS)
// ============================================================

/**
 * Xuất bản một bài viết cụ thể qua Ba Cổng Thép (The Three Iron Gates) & Khóa Chống Trùng Lặp (Concurrency Lock)
 *
 * Cổng 1: Cổng phê duyệt của chủ tiệm (Owner Approval Gate)
 * Cổng 2: Cổng trạng thái chiến dịch CRM (Campaign Status Gate)
 * Cổng 3: Cổng dung sai thời gian hẹn giờ (Scheduled Time Gate <= 1 phút)
 */
export async function publishPostItem(
  postId: string,
  options?: PublishOptions
): Promise<PublishItemResult> {
  const now = options?.now ? new Date(options.now) : new Date()

  // 1. Lấy thông tin bài viết hiện tại
  const post = await db.socialPost.findUnique({
    where: { id: postId },
    include: { campaign: true },
  })

  if (!post) {
    return {
      success: false,
      postId,
      error: 'Không tìm thấy bài viết',
      reason: 'POST_NOT_FOUND',
    }
  }

  // --- CỔNG 1: CỔNG PHÊ DUYỆT CỦA CHỦ TIỆM (Owner Approval Gate) ---
  // Điều kiện bắt buộc: status in ['APPROVED', 'SCHEDULED'] VÀ approvedAt != null
  const isApprovedState = post.status === 'APPROVED' || post.status === 'SCHEDULED'
  if (!isApprovedState || !post.approvedAt) {
    return {
      success: false,
      postId,
      error: 'POST_NOT_APPROVED',
      reason: 'POST_NOT_APPROVED',
    }
  }

  // --- CỔNG 2: CỔNG TRẠNG THÁI CHIẾN DỊCH CRM (Campaign Status Gate) ---
  // Nếu bài viết gắn với chiến dịch: kiểm tra trạng thái biên động
  // Nếu chiến dịch đã ENDED hoặc CANCELLED: tự động chuyển REJECTED và chặn vĩnh viễn
  if (post.campaignId) {
    let campaign: Campaign | null = post.campaign
    if (!campaign) {
      campaign = await db.campaign.findUnique({ where: { id: post.campaignId } })
    }

    if (campaign) {
      const dynamicStatus = computeCampaignStatus(campaign, now)
      if (dynamicStatus === 'ENDED' || dynamicStatus === 'CANCELLED') {
        const rejectionNote = 'Tự động từ chối: Chiến dịch đã kết thúc hoặc bị hủy'

        await db.socialPost.update({
          where: { id: postId },
          data: {
            status: 'REJECTED',
            approvalNote: rejectionNote,
            approvedAt: null,
            isPublishing: false,
          },
        })

        await logPostAudit({
          postId,
          action: 'REJECT',
          actor: 'SYSTEM',
          status: 'SUCCESS',
          details: {
            reason: 'CAMPAIGN_ENDED_OR_CANCELLED',
            campaignStatus: dynamicStatus,
            campaignId: campaign.id,
          },
        })

        return {
          success: false,
          postId,
          error: 'CAMPAIGN_ENDED_OR_CANCELLED',
          reason: 'CAMPAIGN_ENDED_OR_CANCELLED',
        }
      }
    }
  }

  // --- CỔNG 3: CỔNG DUNG SAI THỜI GIAN HẸN GIỜ (Scheduled Time Gate) ---
  // Nếu bài viết có scheduledAt: thời điểm hiện tại `now` phải >= scheduledAt - 60s
  // Nếu chưa tới thời điểm: bỏ qua (giữ nguyên SCHEDULED)
  if (!options?.skipTimeGate && post.scheduledAt) {
    const scheduledAtMs = new Date(post.scheduledAt).getTime()
    const nowMs = now.getTime()
    const earliestAllowedMs = scheduledAtMs - 60_000 // Dung sai 1 phút (60,000 ms)

    if (nowMs < earliestAllowedMs) {
      return {
        success: false,
        postId,
        skipped: true,
        reason: 'SCHEDULED_TIME_NOT_REACHED',
      }
    }
  }

  // --- KHÓA CHỐNG TRÙNG LẶP NGUYÊN TỬ (Concurrency Idempotency Lock - FEAT-REV-03) ---
  // Thực thi updateMany nguyên tử trong SQLite: kiểm tra isPublishing == false và status in ['APPROVED', 'SCHEDULED']
  const lockResult = await db.socialPost.updateMany({
    where: {
      id: postId,
      isPublishing: false,
      status: { in: ['APPROVED', 'SCHEDULED'] },
    },
    data: {
      isPublishing: true,
      status: 'PUBLISHING',
    },
  })

  if (lockResult.count === 0) {
    // Đã có tiến trình khác đang chiếm giữ khóa, hoặc bài viết không còn ở trạng thái hợp lệ
    return {
      success: false,
      postId,
      reason: 'CONCURRENCY_LOCK_ACTIVE_OR_INVALID_STATUS',
    }
  }

  // --- THỰC THI XUẤT BẢN QUA PUBLISHER ADAPTER ---
  const publisher = options?.publisher || activePublisher || defaultMockPublisher

  let mediaUrlsParsed: string[] = []
  if (post.mediaUrls) {
    try {
      const parsed = JSON.parse(post.mediaUrls)
      if (Array.isArray(parsed)) mediaUrlsParsed = parsed
    } catch {
      mediaUrlsParsed = [post.mediaUrls]
    }
  }

  const publishReq: PublishRequest = {
    postId: post.id,
    channel: post.channel,
    content: post.content,
    title: post.title,
    mediaUrls: mediaUrlsParsed,
    scheduledAt: post.scheduledAt,
    isMock: post.isMock,
  }

  try {
    const pubResult = await publisher(publishReq)

    if (!pubResult || !pubResult.success) {
      const errorMsg = pubResult?.error || 'Publisher adapter trả về thất bại'

      await db.socialPost.update({
        where: { id: postId },
        data: {
          isPublishing: false,
          status: 'FAILED',
          publishError: errorMsg,
          retryCount: { increment: 1 },
          responseSnapshot: pubResult ? JSON.stringify(pubResult) : null,
        },
      })

      await logPostAudit({
        postId,
        action: 'ERROR',
        actor: options?.actor || 'SYSTEM',
        status: 'FAILED',
        errorMessage: errorMsg,
        details: { error: errorMsg, result: pubResult },
      })

      return {
        success: false,
        postId,
        error: errorMsg,
        reason: 'PUBLISHER_FAILED',
      }
    }

    const publishedAt = pubResult.publishedAt || new Date()

    await db.socialPost.update({
      where: { id: postId },
      data: {
        isPublishing: false,
        status: 'PUBLISHED',
        publishedAt,
        externalPostId: pubResult.externalPostId || null,
        externalPostUrl: pubResult.externalPostUrl || null,
        publishError: null,
        isMock: pubResult.isMockResult ?? true,
        responseSnapshot: JSON.stringify(pubResult),
      },
    })

    await logPostAudit({
      postId,
      action: 'PUBLISH',
      actor: options?.actor || 'SYSTEM',
      actorName: options?.actorName,
      status: 'SUCCESS',
      details: pubResult,
    })

    return {
      success: true,
      postId,
      externalPostId: pubResult.externalPostId,
      externalPostUrl: pubResult.externalPostUrl,
      publishedAt,
      isMockResult: pubResult.isMockResult ?? true,
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)

    await db.socialPost.update({
      where: { id: postId },
      data: {
        isPublishing: false,
        status: 'FAILED',
        publishError: errorMsg,
        retryCount: { increment: 1 },
      },
    })

    await logPostAudit({
      postId,
      action: 'ERROR',
      actor: options?.actor || 'SYSTEM',
      status: 'FAILED',
      errorMessage: errorMsg,
      details: { error: errorMsg },
    })

    return {
      success: false,
      postId,
      error: errorMsg,
      reason: 'PUBLISHER_EXCEPTION',
    }
  }
}

// ============================================================
// RETRY & FAILURE HANDLING (FEAT-REV-05)
// ============================================================

/**
 * Thử lại đăng bài viết thất bại (FEAT-REV-05)
 * Đưa trạng thái về APPROVED, giải phóng khóa và phát lệnh xuất bản lại
 */
export async function retryPublishPost(
  postId: string,
  options?: PublishOptions
): Promise<PublishItemResult> {
  const post = await db.socialPost.findUnique({ where: { id: postId } })
  if (!post) {
    throw new Error(`Không tìm thấy bài viết ID "${postId}"`)
  }

  if (post.status !== 'FAILED') {
    throw new Error(
      `Chỉ có thể thử lại bài viết ở trạng thái FAILED (trạng thái hiện tại: "${post.status}"). Bài viết chưa duyệt, đang chờ duyệt hoặc đã bị từ chối không thể thử lại.`
    )
  }

  if (post.isPublishing) {
    throw new Error('Bài viết đang trong tiến trình xuất bản, không thể thử lại.')
  }

  if (!post.approvedAt) {
    throw new Error('Bài viết chưa có sự phê duyệt hợp lệ của chủ tiệm, không thể thử lại.')
  }

  // Khôi phục trạng thái về APPROVED để vượt qua Cổng 1 (bảo tồn approvedAt gốc của chủ tiệm)
  await db.socialPost.update({
    where: { id: postId },
    data: {
      status: 'APPROVED',
      isPublishing: false,
      publishError: null,
      approvedAt: post.approvedAt,
    },
  })

  await logPostAudit({
    postId,
    action: 'RETRY',
    actor: options?.actor || 'OPERATOR',
    actorName: options?.actorName,
    status: 'SUCCESS',
    details: {
      previousStatus: post.status,
      retryCount: post.retryCount,
    },
  })

  // Gọi lại xuất bản (bỏ qua cổng thời gian khi chủ động retry thủ công)
  return publishPostItem(postId, {
    ...options,
    skipTimeGate: options?.skipTimeGate !== false,
  })
}

// ============================================================
// SCHEDULED QUEUE RUNNER (FEAT-REV-02)
// ============================================================

/**
 * Trình chạy hàng đợi định kỳ (Scheduled Queue Runner)
 * Quét các bài viết APPROVED/SCHEDULED có lịch hẹn <= referenceTime + 60s
 * Thực thi lần lượt qua Ba Cổng Thép & Khóa Concurrency
 */
export async function processScheduledPosts(
  referenceTime: Date | string | number = new Date(),
  options?: ProcessScheduledOptions
): Promise<ProcessScheduledResult> {
  const refDate = new Date(referenceTime)
  const toleranceDate = new Date(refDate.getTime() + 60_000)

  // Tìm tất cả các bài viết đủ điều kiện giờ hẹn
  const candidates = await db.socialPost.findMany({
    where: {
      status: { in: ['APPROVED', 'SCHEDULED'] },
      isPublishing: false,
      scheduledAt: {
        not: null,
        lte: toleranceDate,
      },
    },
    orderBy: { scheduledAt: 'asc' },
  })

  let processed = 0
  let published = 0
  let skipped = 0
  let failed = 0
  const results: PublishItemResult[] = []

  for (const post of candidates) {
    processed++
    const itemResult = await publishPostItem(post.id, {
      now: refDate,
      actor: options?.actor || 'CRON',
      actorName: 'Scheduled Queue Runner',
      publisher: options?.publisher,
    })

    results.push(itemResult)

    if (itemResult.success) {
      published++
    } else if (itemResult.skipped) {
      skipped++
    } else {
      failed++
    }
  }

  return {
    processed,
    published,
    skipped,
    failed,
    results,
  }
}
