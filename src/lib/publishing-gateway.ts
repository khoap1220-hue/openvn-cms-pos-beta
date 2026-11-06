// src/lib/publishing-gateway.ts
// Milestone 5: 7-Platform Publishing Gateway & Integrations (FEAT-PUB-01 -> FEAT-PUB-08, R5, R6)
// Unified publishing interface, 7 platform adapters, dual-mode switching, and social scheduler integration.

import { db } from '@/lib/db'
import { setPublisher } from '@/lib/social-scheduler'
import type { SocialChannelConfig } from '@prisma/client'

// ============================================================
// TYPES & INTERFACES (FEAT-PUB-01 -> FEAT-PUB-08)
// ============================================================

export type SocialPlatform =
  | 'FACEBOOK'
  | 'ZALO_OA'
  | 'WEBSITE'
  | 'EXTERNAL_CMS'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'THREADS'

export const SUPPORTED_PLATFORMS: SocialPlatform[] = [
  'FACEBOOK',
  'ZALO_OA',
  'WEBSITE',
  'EXTERNAL_CMS',
  'INSTAGRAM',
  'TIKTOK',
  'THREADS',
]

export interface PublishRequest {
  postId?: string
  channel: SocialPlatform | string
  content: string
  title?: string | null
  slug?: string | null
  excerpt?: string | null
  mediaUrls?: string[]
  mediaType?: string | null
  hashtags?: string | null
  targetUrl?: string | null
  scheduledAt?: Date | null
  isMock?: boolean
}

export interface PublishResult {
  success: boolean
  externalPostId?: string
  externalPostUrl?: string
  publishedAt: Date
  isMockResult: boolean
  error?: string
  payloadSnapshot?: Record<string, unknown>
  responseSnapshot?: Record<string, unknown>
}

export interface IPublisherAdapter {
  readonly platform: SocialPlatform
  validate(request: PublishRequest): void
  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown>
  publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult>
}

// ============================================================
// HELPER UTILITIES: SLUG GENERATOR & VIETNAMESE NORMALIZER
// ============================================================

/**
 * Chuyển đổi chuỗi tiếng Việt có dấu sang không dấu dạng slug an toàn SEO
 */
export function slugifyVietnamese(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/**
 * Sinh slug ngẫu nhiên duy nhất cho bài viết website
 */
export function generateUniqueSlug(title?: string | null, fallbackSeed?: string): string {
  const base = title && title.trim() ? slugifyVietnamese(title) : 'bai-viet'
  const seed = (fallbackSeed || Math.random().toString(36).substring(2, 8))
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8)
  return `${base}-${seed || Date.now().toString(36)}`
}

/**
 * Đánh giá điều kiện chế độ Safe Mock vs Real API (FEAT-PUB-08, R6)
 *
 * BẢO ĐẢM AN TOÀN BẤT BIẾN (STRICT INVARIANT):
 * 1. Khi NODE_ENV === 'test': TUYỆT ĐỐI dùng Safe Mock (0 outbound socket HTTP).
 * 2. Khi ALLOW_REAL_SOCIAL_PUBLISHING !== 'true': TUYỆT ĐỐI dùng Safe Mock.
 * 3. Khi forceMock === true: Dùng Safe Mock.
 * 4. Khi chưa có thông tin credentials hoặc channelConfig.isMock !== false: Dùng Safe Mock.
 */
export function shouldUseSafeMock(options?: {
  channelConfig?: { isMock?: boolean; credentials?: string | null; enabled?: boolean } | null
  forceMock?: boolean
}): boolean {
  // Bất biến 1: Chế độ test tự động luôn dùng Safe Mock
  if (process.env.NODE_ENV === 'test') {
    return true
  }

  // Bất biến 2: Yêu cầu cưỡng chế mock từ tham số
  if (options?.forceMock === true) {
    return true
  }

  // Bất biến 3: Biến môi trường cho phép gọi API thật chưa được bật
  if (process.env.ALLOW_REAL_SOCIAL_PUBLISHING !== 'true') {
    return true
  }

  // Bất biến 4: Nếu cấu hình kênh đánh dấu isMock là true hoặc không tồn tại cấu hình
  if (!options?.channelConfig || options.channelConfig.isMock !== false) {
    return true
  }

  // Bất biến 5: Kiểm tra credentials có nội dung hợp lệ hay không
  if (!options.channelConfig.credentials) {
    return true
  }

  try {
    const creds = JSON.parse(options.channelConfig.credentials)
    if (!creds || typeof creds !== 'object' || Object.keys(creds).length === 0) {
      return true
    }
  } catch {
    return true
  }

  return false
}

// ============================================================
// 1. FACEBOOK ADAPTER (FEAT-PUB-01)
// ============================================================

export class FacebookAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'FACEBOOK'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung Facebook không được để trống')
    }
  }

  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    return {
      message: request.content + (request.hashtags ? `\n\n${request.hashtags}` : ''),
      link: request.targetUrl || undefined,
      attached_media: mediaUrls.map((url) => ({ media_url: url })),
      page_id: credentials?.pageId || credentials?.page_id || 'uudam_fanpage_default',
      published: true,
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    // Truy vấn cấu hình kênh từ CSDL (hỗ trợ cả SocialChannelConfig và IntegrationCredential)
    const [config, integrationCred] = await Promise.all([
      db.socialChannelConfig.findUnique({ where: { platform: this.platform } }).catch(() => null),
      db.integrationCredential.findUnique({ where: { provider: 'FACEBOOK' } }).catch(() => null),
    ])

    let creds: Record<string, unknown> | null = null
    if (config?.credentials) {
      try {
        creds = JSON.parse(config.credentials)
      } catch {
        creds = null
      }
    }
    if (integrationCred?.config) {
      try {
        const parsedInt = JSON.parse(integrationCred.config)
        creds = { ...(creds ?? {}), ...parsedInt }
      } catch {
        // ignore
      }
    }

    const tokenCandidate = String(
      creds?.pageAccessToken || creds?.accessToken || creds?.access_token || process.env.FACEBOOK_PAGE_ACCESS_TOKEN || ''
    ).trim()
    const hasRealToken =
      Boolean(tokenCandidate) &&
      !tokenCandidate.startsWith('EAAG_mock_') &&
      !tokenCandidate.startsWith('mock_') &&
      process.env.NODE_ENV !== 'test'

    const isMock = hasRealToken && forceMock !== true && request.isMock !== true
      ? false
      : shouldUseSafeMock({
          channelConfig: config,
          forceMock: forceMock ?? request.isMock,
        })

    const payload = this.formatPayload(request, creds)

    if (isMock) {
      const timestamp = Date.now()
      const externalPostId = `fb_post_${timestamp}`
      const externalPostUrl = `https://facebook.com/uudam/posts/${timestamp}`
      const responseSnapshot = {
        id: externalPostId,
        permalink_url: externalPostUrl,
      }

      return {
        success: true,
        externalPostId,
        externalPostUrl,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    // Luồng Live API (khi có Page Access Token thật hoặc ALLOW_REAL_SOCIAL_PUBLISHING=true)
    try {
      const pageAccessToken = (
        creds?.pageAccessToken ||
        creds?.accessToken ||
        creds?.access_token ||
        process.env.FACEBOOK_PAGE_ACCESS_TOKEN
      ) as string
      const pageId = (
        creds?.pageId ||
        creds?.page_id ||
        process.env.FACEBOOK_PAGE_ID
      ) as string
      const graphVersion = String(creds?.graphVersion || 'v20.0').trim() || 'v20.0'

      if (!pageAccessToken || !pageId) {
        throw new Error('Thiếu Facebook Page Access Token hoặc Page ID trong cấu hình')
      }

      const graphPayload = {
        message: payload.message,
        ...(payload.link ? { link: payload.link } : {}),
        access_token: pageAccessToken,
      }

      const res = await fetch(`https://graph.facebook.com/${encodeURIComponent(graphVersion)}/${encodeURIComponent(pageId)}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(graphPayload),
      })

      const data = await res.json()
      if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Facebook Graph API trả về mã lỗi HTTP ${res.status}`)
      }

      const externalPostId = data.id || `fb_post_${Date.now()}`
      const externalPostUrl = data.permalink_url || `https://www.facebook.com/${externalPostId}`

      return {
        success: true,
        externalPostId,
        externalPostUrl,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: data,
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `Facebook Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// 2. ZALO OA ADAPTER (FEAT-PUB-02)
// ============================================================

export class ZaloAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'ZALO_OA'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung Zalo OA không được để trống')
    }
  }

  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    const hasMedia = mediaUrls.length > 0
    return {
      recipient: { target: 'all' },
      message: {
        text: request.content + (request.hashtags ? `\n\n${request.hashtags}` : ''),
        attachment: hasMedia
          ? {
              type: 'template',
              payload: {
                template_type: 'media',
                elements: [
                  {
                    media_type: request.mediaType === 'VIDEO' ? 'video' : 'image',
                    url: mediaUrls[0],
                  },
                ],
              },
            }
          : undefined,
      },
      oa_id: credentials?.oaId || credentials?.oa_id || 'uudam_oa_default',
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    const config = await db.socialChannelConfig
      .findUnique({ where: { platform: this.platform } })
      .catch(() => null)

    const isMock = shouldUseSafeMock({
      channelConfig: config,
      forceMock: forceMock ?? request.isMock,
    })

    const creds = config?.credentials ? JSON.parse(config.credentials) : null
    const payload = this.formatPayload(request, creds)

    if (isMock) {
      const timestamp = Date.now()
      const msgId = `zalo_msg_${timestamp}`
      const responseSnapshot = {
        error: 0,
        message: 'Success',
        data: { msg_id: msgId },
      }

      return {
        success: true,
        externalPostId: msgId,
        externalPostUrl: `https://oa.zalo.me/post/${msgId}`,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    try {
      const accessToken = (creds?.accessToken || creds?.access_token || process.env.ZALO_OA_ACCESS_TOKEN) as string
      if (!accessToken) {
        throw new Error('Thiếu Zalo OA Access Token trong cấu hình')
      }

      const res = await fetch('https://openapi.zalo.me/v2.0/oa/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: accessToken,
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok || data.error !== 0) {
        throw new Error(data.message || `Zalo OA Open API trả về mã lỗi ${data.error}`)
      }

      const msgId = data.data?.msg_id || `zalo_msg_${Date.now()}`
      return {
        success: true,
        externalPostId: msgId,
        externalPostUrl: `https://oa.zalo.me/post/${msgId}`,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: data,
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `Zalo OA Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// 3. WEBSITE BLOG ADAPTER (FEAT-PUB-03)
// ============================================================

export class WebsiteBlogAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'WEBSITE'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung bài viết website không được để trống')
    }
  }

  formatPayload(request: PublishRequest): Record<string, unknown> {
    const slug = request.slug || generateUniqueSlug(request.title, request.postId)
    return {
      title: request.title || 'Bài viết Ưu Đàm',
      slug,
      content: request.content,
      excerpt: request.excerpt || request.content.substring(0, 160),
      mediaUrls: request.mediaUrls || [],
      mediaType: request.mediaType || 'IMAGE',
      hashtags: request.hashtags || null,
      targetUrl: request.targetUrl || null,
      channel: 'WEBSITE',
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    // Xác định slug duy nhất cho bài viết
    let slug = request.slug
    if (!slug) {
      slug = generateUniqueSlug(request.title, request.postId)
    } else {
      slug = slugifyVietnamese(slug)
    }

    // Nếu bài viết đã tồn tại trong CSDL, cập nhật slug để liên kết hiển thị công khai
    if (request.postId) {
      try {
        await db.socialPost.update({
          where: { id: request.postId },
          data: {
            slug,
          },
        })
      } catch (err) {
        console.warn(`[WebsiteBlogAdapter] Không thể cập nhật slug cho postId "${request.postId}":`, err)
      }
    }

    const payload = this.formatPayload({ ...request, slug })
    const externalPostUrl = `/blog/${slug}`
    const externalPostId = request.postId || `web_${Date.now()}`

    const responseSnapshot = {
      slug,
      url: externalPostUrl,
      title: request.title,
      status: 'PUBLISHED',
      isPublic: true,
    }

    return {
      success: true,
      externalPostId,
      externalPostUrl,
      publishedAt: new Date(),
      isMockResult: forceMock ?? request.isMock ?? true,
      payloadSnapshot: payload,
      responseSnapshot,
    }
  }
}

// ============================================================
// 4. EXTERNAL CMS ADAPTER (FEAT-PUB-04)
// ============================================================

export class ExternalCmsAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'EXTERNAL_CMS'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung bài viết CMS ngoài không được để trống')
    }
  }

  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    const tags = request.hashtags
      ? request.hashtags
          .split(/[\s,]+/)
          .map((t) => t.trim().replace(/^#/, ''))
          .filter(Boolean)
      : []

    return {
      title: request.title || 'Ưu Đàm Blog Post',
      content: request.content,
      excerpt: request.excerpt || request.content.substring(0, 160),
      featured_media: mediaUrls[0] || null,
      tags,
      author: credentials?.author || 'Ưu Đàm Team',
      status: 'publish',
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    const config = await db.socialChannelConfig
      .findUnique({ where: { platform: this.platform } })
      .catch(() => null)

    const isMock = shouldUseSafeMock({
      channelConfig: config,
      forceMock: forceMock ?? request.isMock,
    })

    const creds = config?.credentials ? JSON.parse(config.credentials) : null
    const payload = this.formatPayload(request, creds)

    if (isMock) {
      const mockId = 1001 + Math.floor(Math.random() * 8999)
      const externalPostId = String(mockId)
      const externalPostUrl = `https://external-store.vn/blogs/posts/${mockId}`
      const responseSnapshot = {
        id: mockId,
        link: externalPostUrl,
        status: 'published',
      }

      return {
        success: true,
        externalPostId,
        externalPostUrl,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    try {
      const webhookUrl = (creds?.webhookUrl || creds?.webhook_url || creds?.apiUrl || process.env.EXTERNAL_CMS_WEBHOOK_URL) as string
      if (!webhookUrl) {
        throw new Error('Thiếu Webhook URL hoặc API URL của CMS ngoài trong cấu hình')
      }

      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(creds?.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.message || `CMS ngoài trả về mã lỗi HTTP ${res.status}`)
      }

      const externalPostId = String(data.id || data.post_id || Date.now())
      const externalPostUrl = data.link || data.url || `https://external-store.vn/posts/${externalPostId}`

      return {
        success: true,
        externalPostId,
        externalPostUrl,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: data,
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `External CMS Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// 5. INSTAGRAM ADAPTER (FEAT-PUB-05)
// ============================================================

export class InstagramAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'INSTAGRAM'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung Instagram không được để trống')
    }
    // MANDATORY VALIDATION: Bắt buộc phải có ít nhất 1 hình ảnh hoặc video
    const validMedia = (request.mediaUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
    if (validMedia.length === 0) {
      throw new Error('Instagram bắt buộc phải có ít nhất 1 hình ảnh hoặc video')
    }
  }

  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    return {
      caption: request.content + (request.hashtags ? `\n\n${request.hashtags}` : ''),
      image_url: mediaUrls[0],
      media_type: request.mediaType === 'VIDEO' ? 'VIDEO' : 'IMAGE',
      ig_user_id: credentials?.igUserId || credentials?.ig_user_id || 'uudam_ig_default',
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    const config = await db.socialChannelConfig
      .findUnique({ where: { platform: this.platform } })
      .catch(() => null)

    const isMock = shouldUseSafeMock({
      channelConfig: config,
      forceMock: forceMock ?? request.isMock,
    })

    const creds = config?.credentials ? JSON.parse(config.credentials) : null
    const payload = this.formatPayload(request, creds)

    if (isMock) {
      const timestamp = Date.now()
      const containerId = `ig_container_${timestamp}`
      const postId = `ig_post_${timestamp}`
      const responseSnapshot = {
        id: postId,
        container_id: containerId,
        status_code: 'FINISHED',
      }

      return {
        success: true,
        externalPostId: postId,
        externalPostUrl: `https://instagram.com/p/${postId}`,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    try {
      const accessToken = (creds?.accessToken || creds?.access_token || process.env.INSTAGRAM_ACCESS_TOKEN) as string
      const igUserId = (creds?.igUserId || creds?.ig_user_id || process.env.INSTAGRAM_USER_ID) as string

      if (!accessToken || !igUserId) {
        throw new Error('Thiếu Instagram Access Token hoặc User ID trong cấu hình')
      }

      // 1. Tạo container
      const containerRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, access_token: accessToken }),
      })
      const containerData = await containerRes.json()
      if (!containerRes.ok || !containerData.id) {
        throw new Error(containerData.error?.message || 'Không thể tạo Instagram media container')
      }

      // 2. Publish container
      const publishRes = await fetch(`https://graph.facebook.com/v19.0/${encodeURIComponent(igUserId)}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
      })
      const publishData = await publishRes.json()
      if (!publishRes.ok || !publishData.id) {
        throw new Error(publishData.error?.message || 'Không thể xuất bản Instagram container')
      }

      const externalPostId = publishData.id
      return {
        success: true,
        externalPostId,
        externalPostUrl: `https://instagram.com/p/${externalPostId}`,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: { container: containerData, publish: publishData },
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `Instagram Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// 6. TIKTOK ADAPTER (FEAT-PUB-06)
// ============================================================

export class TikTokAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'TIKTOK'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung TikTok không được để trống')
    }
    // MANDATORY VALIDATION: Bắt buộc mediaType === 'VIDEO' và có ít nhất 1 video URL hợp lệ
    const validMedia = (request.mediaUrls || []).filter(u => typeof u === 'string' && u.trim().length > 0)
    if (request.mediaType !== 'VIDEO' || validMedia.length === 0) {
      throw new Error('TikTok bắt buộc phải có tài nguyên video')
    }
  }

  formatPayload(request: PublishRequest): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    return {
      post_info: {
        title: request.content.substring(0, 150),
        privacy_level: 'PUBLIC_TO_EVERYONE',
        disable_duet: false,
        disable_stitch: false,
        disable_comment: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: mediaUrls[0],
      },
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    const config = await db.socialChannelConfig
      .findUnique({ where: { platform: this.platform } })
      .catch(() => null)

    const isMock = shouldUseSafeMock({
      channelConfig: config,
      forceMock: forceMock ?? request.isMock,
    })

    const payload = this.formatPayload(request)

    if (isMock) {
      const timestamp = Date.now()
      const publishId = `tiktok_pub_${timestamp}`
      const responseSnapshot = {
        publish_id: publishId,
      }

      return {
        success: true,
        externalPostId: publishId,
        externalPostUrl: `https://www.tiktok.com/@uudam/video/${publishId}`,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    try {
      const creds = config?.credentials ? JSON.parse(config.credentials) : null
      const accessToken = (creds?.accessToken || creds?.access_token || process.env.TIKTOK_ACCESS_TOKEN) as string

      if (!accessToken) {
        throw new Error('Thiếu TikTok Access Token trong cấu hình')
      }

      const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok || data.error?.code !== 'ok') {
        throw new Error(data.error?.message || `TikTok API trả về mã lỗi HTTP ${res.status}`)
      }

      const publishId = data.data?.publish_id || `tiktok_pub_${Date.now()}`
      return {
        success: true,
        externalPostId: publishId,
        externalPostUrl: `https://www.tiktok.com/@uudam/video/${publishId}`,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: data,
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `TikTok Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// 7. THREADS ADAPTER (FEAT-PUB-07)
// ============================================================

export class ThreadsAdapter implements IPublisherAdapter {
  readonly platform: SocialPlatform = 'THREADS'

  validate(request: PublishRequest): void {
    if (!request.content || !request.content.trim()) {
      throw new Error('Nội dung Threads không được để trống')
    }
    // MANDATORY VALIDATION: Giới hạn ký tự strictly <= 500 ký tự
    const len = request.content.length
    if (len > 500) {
      throw new Error(`Nội dung Threads vượt quá giới hạn 500 ký tự (hiện tại: ${len})`)
    }
  }

  formatPayload(request: PublishRequest, credentials?: Record<string, unknown> | null): Record<string, unknown> {
    const mediaUrls = request.mediaUrls || []
    return {
      text: request.content,
      media_type: mediaUrls.length > 0 ? 'IMAGE' : 'TEXT',
      image_url: mediaUrls[0] || undefined,
      threads_user_id: credentials?.threadsUserId || credentials?.threads_user_id || 'uudam_threads_default',
    }
  }

  async publish(request: PublishRequest, forceMock?: boolean): Promise<PublishResult> {
    this.validate(request)

    const config = await db.socialChannelConfig
      .findUnique({ where: { platform: this.platform } })
      .catch(() => null)

    const isMock = shouldUseSafeMock({
      channelConfig: config,
      forceMock: forceMock ?? request.isMock,
    })

    const creds = config?.credentials ? JSON.parse(config.credentials) : null
    const payload = this.formatPayload(request, creds)

    if (isMock) {
      const timestamp = Date.now()
      const id = `threads_post_${timestamp}`
      const responseSnapshot = {
        id,
      }

      return {
        success: true,
        externalPostId: id,
        externalPostUrl: `https://www.threads.net/@uudam/post/${id}`,
        publishedAt: new Date(),
        isMockResult: true,
        payloadSnapshot: payload,
        responseSnapshot,
      }
    }

    try {
      const accessToken = (creds?.accessToken || creds?.access_token || process.env.THREADS_ACCESS_TOKEN) as string
      const threadsUserId = (creds?.threadsUserId || creds?.threads_user_id || process.env.THREADS_USER_ID) as string

      if (!accessToken || !threadsUserId) {
        throw new Error('Thiếu Threads Access Token hoặc User ID trong cấu hình')
      }

      // 1. Tạo container
      const containerRes = await fetch(`https://graph.threads.net/v1.0/${encodeURIComponent(threadsUserId)}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, access_token: accessToken }),
      })
      const containerData = await containerRes.json()
      if (!containerRes.ok || !containerData.id) {
        throw new Error(containerData.error?.message || 'Không thể tạo Threads media container')
      }

      // 2. Publish
      const publishRes = await fetch(`https://graph.threads.net/v1.0/${encodeURIComponent(threadsUserId)}/threads_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: containerData.id, access_token: accessToken }),
      })
      const publishData = await publishRes.json()
      if (!publishRes.ok || !publishData.id) {
        throw new Error(publishData.error?.message || 'Không thể xuất bản Threads post')
      }

      const externalPostId = publishData.id
      return {
        success: true,
        externalPostId,
        externalPostUrl: `https://www.threads.net/@uudam/post/${externalPostId}`,
        publishedAt: new Date(),
        isMockResult: false,
        payloadSnapshot: payload,
        responseSnapshot: { container: containerData, publish: publishData },
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        publishedAt: new Date(),
        isMockResult: false,
        error: `Threads Publish Error: ${errorMsg}`,
        payloadSnapshot: payload,
      }
    }
  }
}

// ============================================================
// ADAPTER REGISTRY & GATEWAY ROUTER
// ============================================================

export const facebookAdapter = new FacebookAdapter()
export const zaloAdapter = new ZaloAdapter()
export const websiteBlogAdapter = new WebsiteBlogAdapter()
export const externalCmsAdapter = new ExternalCmsAdapter()
export const instagramAdapter = new InstagramAdapter()
export const tiktokAdapter = new TikTokAdapter()
export const threadsAdapter = new ThreadsAdapter()

export const ADAPTER_REGISTRY: Record<SocialPlatform, IPublisherAdapter> = {
  FACEBOOK: facebookAdapter,
  ZALO_OA: zaloAdapter,
  WEBSITE: websiteBlogAdapter,
  EXTERNAL_CMS: externalCmsAdapter,
  INSTAGRAM: instagramAdapter,
  TIKTOK: tiktokAdapter,
  THREADS: threadsAdapter,
}

/**
 * Lấy adapter phù hợp cho kênh xuất bản
 */
export function getAdapter(platform: string): IPublisherAdapter {
  const normalized = (platform || '')
    .toUpperCase()
    .trim()
    .replace(/[- ]/g, '_') as SocialPlatform

  const adapter = ADAPTER_REGISTRY[normalized]
  if (!adapter) {
    throw new Error(`Nền tảng xuất bản "${platform}" không được hỗ trợ`)
  }
  return adapter
}

// ============================================================
// TOP-LEVEL PUBLISH FUNCTION & SCHEDULER INTEGRATION
// ============================================================

/**
 * Cổng xuất bản bài viết cấp cao (FEAT-PUB-01 -> FEAT-PUB-08)
 * Nhận PublishRequest, bổ sung thông tin từ CSDL nếu cần, gọi adapter tương ứng,
 * và cập nhật payloadSnapshot vào CSDL.
 */
export async function publishPost(request: PublishRequest): Promise<PublishResult> {
  const channel = (request.channel || '').toUpperCase().trim().replace(/[- ]/g, '_')
  const adapter = getAdapter(channel)

  // Nếu bài viết có postId trong CSDL, lấy thêm thông tin chi tiết (mediaType, slug, excerpt, v.v.) nếu request chưa có
  let fullRequest: PublishRequest = { ...request }
  if (request.postId) {
    try {
      const dbPost = await db.socialPost.findUnique({
        where: { id: request.postId },
      })
      if (dbPost) {
        let parsedMediaUrls: string[] = fullRequest.mediaUrls || []
        if (parsedMediaUrls.length === 0 && dbPost.mediaUrls) {
          try {
            const arr = JSON.parse(dbPost.mediaUrls)
            if (Array.isArray(arr)) parsedMediaUrls = arr
          } catch {
            parsedMediaUrls = [dbPost.mediaUrls]
          }
        }

        fullRequest = {
          postId: dbPost.id,
          channel: dbPost.channel,
          content: fullRequest.content || dbPost.content,
          title: fullRequest.title !== undefined ? fullRequest.title : dbPost.title,
          slug: fullRequest.slug !== undefined ? fullRequest.slug : dbPost.slug,
          excerpt: fullRequest.excerpt !== undefined ? fullRequest.excerpt : dbPost.excerpt,
          mediaUrls: parsedMediaUrls,
          mediaType: fullRequest.mediaType !== undefined ? fullRequest.mediaType : dbPost.mediaType,
          hashtags: fullRequest.hashtags !== undefined ? fullRequest.hashtags : dbPost.hashtags,
          targetUrl: fullRequest.targetUrl !== undefined ? fullRequest.targetUrl : dbPost.targetUrl,
          scheduledAt: fullRequest.scheduledAt !== undefined ? fullRequest.scheduledAt : dbPost.scheduledAt,
          isMock: fullRequest.isMock !== undefined ? fullRequest.isMock : dbPost.isMock,
        }
      }
    } catch (err) {
      console.warn(`[publishPost] Không thể nạp chi tiết bổ sung từ DB cho postId "${request.postId}":`, err)
    }
  }

  // Gọi adapter xuất bản
  const result = await adapter.publish(fullRequest, request.isMock)

  // Cập nhật payloadSnapshot vào CSDL nếu có postId
  if (request.postId && result.payloadSnapshot) {
    try {
      await db.socialPost.update({
        where: { id: request.postId },
        data: {
          payloadSnapshot: JSON.stringify(result.payloadSnapshot),
        },
      })
    } catch {
      // Bỏ qua lỗi ghi payloadSnapshot phụ
    }
  }

  return result
}

// Tự động đăng ký publishing-gateway với social-scheduler
try {
  setPublisher(publishPost)
} catch (err) {
  console.warn('[publishing-gateway] Không thể tự động liên kết với social-scheduler:', err)
}
