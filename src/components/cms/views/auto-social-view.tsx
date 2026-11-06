'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Share2,
  FolderOpen,
  Sparkles,
  CalendarCheck,
  ShieldCheck,
  RefreshCw,
  Plus,
  Search,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Play,
  RotateCw,
  FileText,
  FileSpreadsheet,
  Image as ImageIcon,
  Video as VideoIcon,
  Folder,
  Send,
  Eye,
  Edit,
  Trash2,
  Check,
  X,
  Facebook,
  Instagram,
  Globe,
  MessagesSquare,
  Laptop,
  AtSign,
  Film,
  Calendar,
  Lock,
  ChevronRight,
  Info,
  BadgeAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { FanpageTestPublishDialog } from '@/components/cms/fanpage-test-publish-dialog'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api'
import { formatDateTime, formatDate, timeAgo } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import type { ViewId } from '@/components/cms/app-sidebar'

// ==========================================
// TYPES & CONSTANTS
// ==========================================

export const PUBLIC_TEST_DRIVE_URL =
  'https://drive.google.com/drive/folders/1FYLaoscxWBV_BU5sFouf7XCrv7cKktBY'

export type SocialChannel =
  | 'FACEBOOK'
  | 'ZALO_OA'
  | 'WEBSITE'
  | 'EXTERNAL_CMS'
  | 'INSTAGRAM'
  | 'TIKTOK'
  | 'THREADS'

export type PostStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SCHEDULED'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'FAILED'
  | 'REJECTED'

export interface DriveItem {
  id: string
  name: string
  mimeType: string
  fileType: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'SHEET' | 'FOLDER' | 'OTHER'
  sizeBytes?: number | null
  webViewLink?: string
  downloadUrl?: string
  thumbnailUrl?: string
  folderPath?: string
  textContent?: string | null
}

export interface DriveTreeNode {
  id: string
  name: string
  path: string
  mimeType: string
  fileType: string
  webViewLink?: string
  thumbnailUrl?: string
  children?: DriveTreeNode[]
}

export interface ContentSourceItem {
  id: string
  name: string
  description?: string | null
  driveFolderUrl: string
  folderId: string
  syncStatus: string
  lastSyncAt?: string | null
  errorMessage?: string | null
  campaignId?: string | null
  fileTree?: string | null
  createdAt: string
  updatedAt: string
  campaign?: {
    id: string
    code: string
    name: string
    title: string
    status: string
  } | null
  _count?: {
    items: number
  }
}

export interface SocialPlanItem {
  id: string
  title: string
  campaignId: string
  status: string
  platforms: string
  postsCount: number
  summary?: string | null
  createdAt: string
  campaign?: {
    id: string
    code: string
    name: string
    title: string
  } | null
  posts?: SocialPostItem[]
}

export interface SocialPostItem {
  id: string
  campaignId?: string | null
  planId?: string | null
  channel: SocialChannel
  title?: string | null
  content: string
  excerpt?: string | null
  slug?: string | null
  hashtags?: string | null
  mediaUrls?: string[]
  mediaType?: string | null
  scheduledAt: string
  publishedAt?: string | null
  status: PostStatus
  approvalStatus?: string | null
  approver?: string | null
  approvedAt?: string | null
  rejectionReason?: string | null
  isMockPublish?: boolean
  externalPostUrl?: string | null
  errorMessage?: string | null
  generatorSource?: string | null
  crmInvariantValid?: boolean
  createdAt: string
  updatedAt: string
  campaign?: {
    id: string
    code: string
    name: string
    title: string
  } | null
}

interface CampaignOption {
  id: string
  code: string
  name: string
  title: string
  status: string
  discountPercent?: number | null
  voucherCode?: string | null
}

const PLATFORMS_INFO: Record<
  SocialChannel,
  {
    name: string
    icon: typeof Facebook
    limitDesc: string
    color: string
    badgeClass: string
    requiresMedia?: boolean
  }
> = {
  FACEBOOK: {
    name: 'Facebook Fanpage',
    icon: Facebook,
    limitDesc: 'Bài viết đầy đủ, hình ảnh, liên kết kèm hashtag',
    color: '#1877F2',
    badgeClass: 'border-blue-500/30 text-blue-700 bg-blue-500/10 dark:text-blue-400',
  },
  ZALO_OA: {
    name: 'Zalo Official Account',
    icon: MessagesSquare,
    limitDesc: 'Bài viết chính thức, gửi broadcast hội viên Ưu Đàm',
    color: '#0068FF',
    badgeClass: 'border-sky-500/30 text-sky-700 bg-sky-500/10 dark:text-sky-400',
  },
  WEBSITE: {
    name: 'Website Shop Blog (/blog)',
    icon: Globe,
    limitDesc: 'Trang tin tức bài viết công khai, chuẩn SEO, Rich Text',
    color: '#10B981',
    badgeClass: 'border-emerald-500/30 text-emerald-700 bg-emerald-500/10 dark:text-emerald-400',
  },
  EXTERNAL_CMS: {
    name: 'Website ngoài (WP/Haravan)',
    icon: Laptop,
    limitDesc: 'Xuất bản qua Webhook REST API tới WordPress / Haravan / Sapo',
    color: '#8B5CF6',
    badgeClass: 'border-purple-500/30 text-purple-700 bg-purple-500/10 dark:text-purple-400',
  },
  INSTAGRAM: {
    name: 'Instagram',
    icon: Instagram,
    limitDesc: 'Bắt buộc có hình ảnh/video, chú thích thanh tao, hashtags',
    color: '#E4405F',
    badgeClass: 'border-pink-500/30 text-pink-700 bg-pink-500/10 dark:text-pink-400',
    requiresMedia: true,
  },
  TIKTOK: {
    name: 'TikTok',
    icon: Film,
    limitDesc: 'Bắt buộc có video clip ngắn, caption ngắn gọn có hook',
    color: '#000000',
    badgeClass: 'border-neutral-500/30 text-neutral-800 bg-neutral-500/10 dark:text-neutral-200',
    requiresMedia: true,
  },
  THREADS: {
    name: 'Threads',
    icon: AtSign,
    limitDesc: 'Giới hạn nghiêm ngặt tối đa 500 ký tự, ngắn gọn súc tích',
    color: '#000000',
    badgeClass: 'border-amber-500/30 text-amber-700 bg-amber-500/10 dark:text-amber-400',
  },
}

const CHANNEL_PROVIDER_MAP: Record<SocialChannel, string> = {
  FACEBOOK: 'FACEBOOK',
  ZALO_OA: 'ZALO_OA',
  WEBSITE: 'WEBSITE',
  EXTERNAL_CMS: 'EXTERNAL_CMS',
  INSTAGRAM: 'INSTAGRAM',
  TIKTOK: 'TIKTOK_CONTENT',
  THREADS: 'THREADS',
}

const SOCIAL_PROVIDER_FIELDS: Record<
  string,
  {
    title: string
    methodSummary: string
    fields: Array<{ key: string; label: string; placeholder: string; secret?: boolean }>
  }
> = {
  FACEBOOK: {
    title: 'Facebook Fanpage (Graph API v20.0 / Make Bridge)',
    methodSummary: 'Cách 1: Facebook Graph API (/page-id/feed) hoặc Cách 2: Make.com / n8n Webhook',
    fields: [
      { key: 'pageId', label: 'Facebook Page ID', placeholder: '1049281920192' },
      { key: 'pageAccessToken', label: 'Page Access Token (Không hết hạn)', placeholder: 'EAAGm0PX4ZCpsBA...', secret: true },
      { key: 'appSecret', label: 'App Secret', placeholder: 'fb_app_secret_...', secret: true },
    ],
  },
  ZALO_OA: {
    title: 'Zalo Official Account (Open API v3.0)',
    methodSummary: 'Cách 1: Zalo OA Article & Broadcast API (/v2.0/article/create)',
    fields: [
      { key: 'oaId', label: 'Zalo OA ID', placeholder: '40918230918230192' },
      { key: 'accessToken', label: 'OA Access Token', placeholder: 'zalo_oa_access_token_...', secret: true },
      { key: 'refreshToken', label: 'OA Refresh Token', placeholder: 'zalo_oa_refresh_token_...', secret: true },
    ],
  },
  WEBSITE: {
    title: 'Website Shop Blog (/blog nội bộ & Webhook)',
    methodSummary: 'Cách 3: Xuất bản trực tiếp lên /blog nội bộ (0 cần key) + bắn Webhook đồng bộ',
    fields: [
      { key: 'domain', label: 'Domain Website', placeholder: 'https://uudam.vn' },
      { key: 'apiBaseUrl', label: 'Endpoint nhận bài Blog', placeholder: 'https://uudam.vn/api/social/posts' },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'web_whsec_...', secret: true },
    ],
  },
  EXTERNAL_CMS: {
    title: 'Website ngoài (WordPress / Haravan / Sapo REST API)',
    methodSummary: 'Cách 3: Đăng bài chuẩn SEO sang WordPress (/wp-json/wp/v2/posts) hoặc Haravan/Sapo',
    fields: [
      { key: 'cmsType', label: 'Nền tảng (WORDPRESS / HARAVAN / SAPO)', placeholder: 'WORDPRESS' },
      { key: 'endpointUrl', label: 'REST API Endpoint', placeholder: 'https://blog.uudam.vn/wp-json/wp/v2/posts' },
      { key: 'username', label: 'Username / Email quản trị', placeholder: 'editor_uudam' },
      { key: 'appPassword', label: 'Application Password / Admin API Token', placeholder: 'uudam_wp_app_password_2026', secret: true },
      { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'whsec_ext_cms_uudam_2026', secret: true },
    ],
  },
  INSTAGRAM: {
    title: 'Instagram Business (Graph API / Make Bridge)',
    methodSummary: 'Cách 1: Meta Instagram Graph API (/{ig-user-id}/media) hoặc Cách 2: Make.com Webhook',
    fields: [
      { key: 'igUserId', label: 'Instagram Business User ID', placeholder: '17841405829102938' },
      { key: 'pageId', label: 'Facebook Page ID liên kết', placeholder: '109283746519283' },
      { key: 'accessToken', label: 'Meta Graph Access Token', placeholder: 'EAAGm0PX4ZCps_uudam_ig_graph_token', secret: true },
      { key: 'connectMode', label: 'Phương thức (GRAPH_API / WEBHOOK_BRIDGE)', placeholder: 'GRAPH_API' },
    ],
  },
  TIKTOK_CONTENT: {
    title: 'TikTok Content Posting API v2 (Reels / Video)',
    methodSummary: 'Cách 1: TikTok Content Posting API (/v2/post/publish/video/init/) hoặc Cách 2: Make.com / Repurpose.io',
    fields: [
      { key: 'openId', label: 'TikTok Creator Open ID', placeholder: 'uudam_tiktok_creator_openid_2026' },
      { key: 'clientKey', label: 'TikTok App Client Key', placeholder: 'aw91827364551029' },
      { key: 'clientSecret', label: 'TikTok App Client Secret', placeholder: 'tt_content_secret_uudam_2026', secret: true },
      { key: 'accessToken', label: 'Creator Access Token', placeholder: 'act.uudam_tiktok_content_token_2026', secret: true },
    ],
  },
  THREADS: {
    title: 'Meta Threads API v1.0 (/{threads-user-id}/threads)',
    methodSummary: 'Cách 1: Meta Threads Publishing API hoặc Cách 2: Make.com / n8n Webhook Bridge',
    fields: [
      { key: 'threadsUserId', label: 'Threads User ID', placeholder: '25491827364551029' },
      { key: 'accessToken', label: 'Threads Long-Lived Access Token', placeholder: 'THQVJ_uudam_threads_live_token_2026', secret: true },
      { key: 'connectMode', label: 'Phương thức (THREADS_GRAPH_API / WEBHOOK_BRIDGE)', placeholder: 'THREADS_GRAPH_API' },
    ],
  },
  SOCIAL_WEBHOOK_HUB: {
    title: 'Cầu nối Đa kênh Make.com / n8n / Zapier (SOCIAL_WEBHOOK_HUB)',
    methodSummary: 'Cách 2 (Khuyên dùng): Bắn 1 JSON chuẩn từ CMS sang Make.com / n8n để tự đăng đồng loạt 7 kênh',
    fields: [
      { key: 'bridgePlatform', label: 'Nền tảng (MAKE_N8N_ZAPIER / CUSTOM)', placeholder: 'MAKE_N8N_ZAPIER' },
      { key: 'bridgeWebhookUrl', label: 'URL Webhook nhận bài đã duyệt', placeholder: 'https://hook.eu2.make.com/uudam-social-publisher-bridge' },
      { key: 'bridgeSecret', label: 'Header Secret (X-Social-Secret)', placeholder: 'whsec_social_bridge_uudam_2026', secret: true },
      { key: 'enabledChannels', label: 'Các kênh định tuyến qua Bridge', placeholder: 'FACEBOOK,INSTAGRAM,TIKTOK,THREADS,ZALO_OA,EXTERNAL_CMS' },
    ],
  },
}

interface SocialIntegrationCred {
  provider: string
  label: string
  category: string
  enabled: boolean
  status: string
  config: Record<string, string>
  lastTestedAt?: string | null
  lastTestMessage?: string | null
}

interface AutoSocialViewProps {
  initialCampaignId?: string
  onNavigate?: (view: ViewId, param?: string) => void
}

export function AutoSocialView({ initialCampaignId, onNavigate }: AutoSocialViewProps) {
  const { toast } = useToast()

  // Tabs
  const [activeTab, setActiveTab] = useState<'drive' | 'planning' | 'review' | 'gateway'>('drive')

  // Global auxiliary data
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([])

  // ==========================================
  // TAB 1: GOOGLE DRIVE STATE
  // ==========================================
  const [driveSources, setDriveSources] = useState<ContentSourceItem[]>([])
  const [loadingDrive, setLoadingDrive] = useState(false)
  const [syncingDrive, setSyncingDrive] = useState(false)

  // Drive sync form
  const [driveUrlInput, setDriveUrlInput] = useState(PUBLIC_TEST_DRIVE_URL)
  const [driveNameInput, setDriveNameInput] = useState('Tư liệu Marketing Ưu Đàm (Drive Công Khai)')
  const [driveCampaignInput, setDriveCampaignInput] = useState(initialCampaignId || '')

  // Drive Inspector Modal
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [selectedSourceDetail, setSelectedSourceDetail] = useState<{
    source: ContentSourceItem
    items: DriveItem[]
    fileTree: DriveTreeNode | null
  } | null>(null)
  const [loadingSourceDetail, setLoadingSourceDetail] = useState(false)
  const [selectedDocContent, setSelectedDocContent] = useState<string | null>(null)
  const [selectedDocTitle, setSelectedDocTitle] = useState<string | null>(null)

  // ==========================================
  // TAB 2: AI PLANNING STATE
  // ==========================================
  const [planningCampaignId, setPlanningCampaignId] = useState(initialCampaignId || '')
  const [planningSourceId, setPlanningSourceId] = useState('')
  const [planningPlatforms, setPlanningPlatforms] = useState<SocialChannel[]>([
    'FACEBOOK',
    'ZALO_OA',
    'WEBSITE',
    'INSTAGRAM',
    'TIKTOK',
    'THREADS',
    'EXTERNAL_CMS',
  ])
  const [planningPostsCount, setPlanningPostsCount] = useState(7)
  const [planningCustomPrompt, setPlanningCustomPrompt] = useState(
    'Văn phong nhẹ nhàng, an yên, chuẩn thiền trà và trầm hương tự nhiên Ưu Đàm. Tôn vinh lối sống chánh niệm, thông điệp an lành, tuyệt đối không dùng từ ngữ giật gân rẻ tiền, kèm lời kêu gọi hành động tinh tế.'
  )
  const [generatingPlan, setGeneratingPlan] = useState(false)
  const [latestPlan, setLatestPlan] = useState<SocialPlanItem | null>(null)

  // ==========================================
  // TAB 3: CALENDAR & REVIEW STATE
  // ==========================================
  const [posts, setPosts] = useState<SocialPostItem[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [channelFilter, setChannelFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  // Post Action Modals
  const [rejectModalOpen, setRejectModalOpen] = useState(false)
  const [targetPostForReject, setTargetPostForReject] = useState<SocialPostItem | null>(null)
  const [rejectReasonInput, setRejectReasonInput] = useState('')
  const [rejecting, setRejecting] = useState(false)

  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false)
  const [targetPostForReschedule, setTargetPostForReschedule] = useState<SocialPostItem | null>(null)
  const [newScheduleInput, setNewScheduleInput] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  const [postDetailModalOpen, setPostDetailModalOpen] = useState(false)
  const [selectedPostDetail, setSelectedPostDetail] = useState<SocialPostItem | null>(null)
  const [isEditingPost, setIsEditingPost] = useState(false)
  const [editPostContent, setEditPostContent] = useState('')
  const [editPostTitle, setEditPostTitle] = useState('')
  const [savingPostEdit, setSavingPostEdit] = useState(false)

  // ==========================================
  // TAB 4: PUBLISHING GATEWAY STATE
  // ==========================================
  const [runningSchedule, setRunningSchedule] = useState(false)
  const [scheduleRunnerResult, setScheduleRunnerResult] = useState<{
    scannedCount: number
    publishedCount: number
    failedCount: number
    referenceTime: string
  } | null>(null)
  const [socialCredentials, setSocialCredentials] = useState<Record<string, SocialIntegrationCred>>({})
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [configProviderModal, setConfigProviderModal] = useState<string | null>(null)
  const [configFormValues, setConfigFormValues] = useState<Record<string, string>>({})
  const [configEnabledValue, setConfigEnabledValue] = useState<boolean>(true)
  const [savingProviderConfig, setSavingProviderConfig] = useState(false)

  // ==========================================
  // DATA LOADERS
  // ==========================================

  // Load social integration credentials
  const loadSocialCredentials = useCallback(async () => {
    try {
      const res = await apiGet<{ credentials: SocialIntegrationCred[] }>('/api/integrations')
      if (res && Array.isArray(res.credentials)) {
        const map: Record<string, SocialIntegrationCred> = {}
        for (const cred of res.credentials) {
          map[cred.provider] = cred
        }
        setSocialCredentials(map)
      }
    } catch {
      // Non-blocking
    }
  }, [])

  // Load campaigns list
  const loadCampaigns = useCallback(async () => {
    try {
      const res = await apiGet<{ campaigns: CampaignOption[] }>('/api/campaigns?pageSize=50')
      if (res && Array.isArray(res.campaigns)) {
        setCampaigns(res.campaigns)
        if (!planningCampaignId && res.campaigns.length > 0) {
          setPlanningCampaignId(res.campaigns[0].id)
        }
      }
    } catch {
      // Non-blocking
    }
  }, [planningCampaignId])

  // Load drive sources
  const loadDriveSources = useCallback(async () => {
    setLoadingDrive(true)
    try {
      const res = await apiGet<{ sources: ContentSourceItem[] }>('/api/social/drive')
      if (res && Array.isArray(res.sources)) {
        setDriveSources(res.sources)
        if (!planningSourceId && res.sources.length > 0) {
          setPlanningSourceId(res.sources[0].id)
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách nguồn dữ liệu Drive'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    } finally {
      setLoadingDrive(false)
    }
  }, [planningSourceId, toast])

  // Load posts
  const loadPosts = useCallback(async () => {
    setLoadingPosts(true)
    try {
      const params = new URLSearchParams()
      if (channelFilter !== 'ALL') params.set('channel', channelFilter)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)
      if (searchQuery.trim()) params.set('search', searchQuery.trim())
      params.set('pageSize', '50')

      const res = await apiGet<{ posts: SocialPostItem[]; total: number }>(
        `/api/social/posts?${params.toString()}`
      )
      if (res && Array.isArray(res.posts)) {
        setPosts(res.posts)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách bài viết'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    } finally {
      setLoadingPosts(false)
    }
  }, [channelFilter, statusFilter, searchQuery, toast])

  useEffect(() => {
    loadCampaigns()
    loadDriveSources()
    loadPosts()
    loadSocialCredentials()
  }, [loadCampaigns, loadDriveSources, loadPosts, loadSocialCredentials])

  // ==========================================
  // TAB 1 ACTIONS (GOOGLE DRIVE)
  // ==========================================

  const handleSyncDrive = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!driveUrlInput.trim()) {
      toast({ title: 'Thiếu đường dẫn', description: 'Vui lòng nhập link thư mục Google Drive', variant: 'destructive' })
      return
    }

    setSyncingDrive(true)
    try {
      const res = await apiPost<{ success: boolean; totalItems: number; source: ContentSourceItem }>(
        '/api/social/drive',
        {
          folderUrl: driveUrlInput.trim(),
          name: driveNameInput.trim() || 'Tư liệu Marketing Ưu Đàm (Drive Công Khai)',
          campaignId: driveCampaignInput || undefined,
        }
      )

      toast({
        title: 'Đồng bộ Drive thành công!',
        description: `Đã kết nối và nạp ${res.totalItems || 0} tài liệu từ Google Drive công khai.`,
      })

      loadDriveSources()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Đồng bộ Drive thất bại'
      toast({ title: 'Lỗi đồng bộ Drive', description: msg, variant: 'destructive' })
    } finally {
      setSyncingDrive(false)
    }
  }

  const handleInspectSource = async (sourceId: string) => {
    setLoadingSourceDetail(true)
    setSelectedDocContent(null)
    setSelectedDocTitle(null)
    setInspectorOpen(true)
    try {
      const data = await apiGet<{
        source: ContentSourceItem
        items: DriveItem[]
        fileTree: DriveTreeNode | null
      }>(`/api/social/drive/${sourceId}`)
      setSelectedSourceDetail(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải chi tiết nguồn tư liệu'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
      setInspectorOpen(false)
    } finally {
      setLoadingSourceDetail(false)
    }
  }

  const handleReSyncSource = async (sourceId: string) => {
    try {
      toast({ title: 'Đang tái đồng bộ...', description: 'Đang kiểm tra và cập nhật file mới từ Drive.' })
      await apiPut(`/api/social/drive/${sourceId}`, {})
      toast({ title: 'Hoàn tất', description: 'Tái đồng bộ thành công!' })
      loadDriveSources()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Tái đồng bộ thất bại'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    }
  }

  const handleDeleteSource = async (sourceId: string) => {
    if (!confirm('Bạn có chắc muốn xóa nguồn tư liệu này? Các file đã nạp sẽ bị xóa khỏi kho tư liệu.')) return
    try {
      await apiDelete(`/api/social/drive/${sourceId}`)
      toast({ title: 'Đã xóa', description: 'Đã xóa nguồn dữ liệu thành công' })
      loadDriveSources()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xóa nguồn tư liệu'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    }
  }

  // ==========================================
  // TAB 2 ACTIONS (AI PLANNING)
  // ==========================================

  const togglePlatform = (p: SocialChannel) => {
    setPlanningPlatforms((prev) =>
      prev.includes(p) ? prev.filter((item) => item !== p) : [...prev, p]
    )
  }

  const handleGenerateAiPlan = async () => {
    if (!planningCampaignId) {
      toast({ title: 'Thiếu chiến dịch', description: 'Vui lòng chọn Chiến dịch CRM cần lên bài', variant: 'destructive' })
      return
    }
    if (planningPlatforms.length === 0) {
      toast({ title: 'Thiếu nền tảng', description: 'Vui lòng chọn ít nhất một kênh mạng xã hội', variant: 'destructive' })
      return
    }

    setGeneratingPlan(true)
    try {
      const result = await apiPost<SocialPlanItem>('/api/social/ai-plan', {
        campaignId: planningCampaignId,
        contentSourceId: planningSourceId || undefined,
        platforms: planningPlatforms,
        postsCount: planningPostsCount,
        customPrompt: planningCustomPrompt,
        autoSave: true,
      })

      setLatestPlan(result)
      toast({
        title: 'AI Lên kế hoạch thành công!',
        description: `Đã sinh ${result.posts?.length || planningPostsCount} bài viết nháp chuẩn giọng Ưu Đàm cho các kênh.`,
      })

      // Reload posts
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi AI tạo kế hoạch'
      toast({ title: 'AI Planning thất bại', description: msg, variant: 'destructive' })
    } finally {
      setGeneratingPlan(false)
    }
  }

  // ==========================================
  // TAB 3 ACTIONS (CALENDAR & APPROVAL)
  // ==========================================

  // Approve
  const [batchApproving, setBatchApproving] = useState(false)
  const [fanpageTestOpen, setFanpageTestOpen] = useState(false)

  const handleBatchApproveAllPending = async () => {
    const pendingList = posts.filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'DRAFT')
    if (pendingList.length === 0) {
      toast({ title: 'Không có bài chờ duyệt', description: 'Tất cả bài viết trong danh sách đã được duyệt.' })
      return
    }
    setBatchApproving(true)
    try {
      let okCount = 0
      for (const post of pendingList) {
        await apiPut(`/api/social/posts/${post.id}`, {
          action: 'APPROVE',
          approver: 'Chủ tiệm Ưu Đàm',
          note: 'Duyệt hàng loạt các bài đạt chuẩn Rubric ≥ 8.0',
        })
        okCount += 1
      }
      toast({
        title: `Đã duyệt nhanh ${okCount} bài viết!`,
        description: 'Toàn bộ bài chờ duyệt đã sẵn sàng xuất bản theo lịch.',
      })
      await loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể duyệt hàng loạt'
      toast({ title: 'Lỗi duyệt hàng loạt', description: msg, variant: 'destructive' })
    } finally {
      setBatchApproving(false)
    }
  }

  const handleApprovePost = async (post: SocialPostItem) => {
    try {
      await apiPut(`/api/social/posts/${post.id}`, {
        action: 'APPROVE',
        approver: 'Chủ tiệm Ưu Đàm',
        note: 'Duyệt xuất bản qua giao diện quản trị',
      })
      toast({
        title: 'Đã duyệt bài viết!',
        description: `Bài viết "${post.title || post.id}" đã được duyệt và lên lịch xuất bản.`,
      })
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể duyệt bài viết'
      toast({ title: 'Lỗi duyệt bài', description: msg, variant: 'destructive' })
    }
  }

  // Open Reject Modal
  const handleOpenReject = (post: SocialPostItem) => {
    setTargetPostForReject(post)
    setRejectReasonInput('Nội dung chưa đúng giọng văn Ưu Đàm / Cần sửa lại giá ưu đãi')
    setRejectModalOpen(true)
  }

  // Confirm Reject
  const handleConfirmReject = async () => {
    if (!targetPostForReject) return
    if (!rejectReasonInput.trim()) {
      toast({ title: 'Thiếu lý do', description: 'Vui lòng nhập lý do từ chối bài viết', variant: 'destructive' })
      return
    }

    setRejecting(true)
    try {
      await apiPut(`/api/social/posts/${targetPostForReject.id}`, {
        action: 'REJECT',
        approver: 'Chủ tiệm Ưu Đàm',
        reason: rejectReasonInput.trim(),
      })
      toast({
        title: 'Đã từ chối bài viết',
        description: `Bài viết đã chuyển sang trạng thái REJECTED.`,
      })
      setRejectModalOpen(false)
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể từ chối bài viết'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    } finally {
      setRejecting(false)
    }
  }

  // Open Reschedule Modal
  const handleOpenReschedule = (post: SocialPostItem) => {
    setTargetPostForReschedule(post)
    const d = new Date(post.scheduledAt)
    const pad = (n: number) => String(n).padStart(2, '0')
    const formatted = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    setNewScheduleInput(formatted)
    setRescheduleModalOpen(true)
  }

  // Confirm Reschedule
  const handleConfirmReschedule = async () => {
    if (!targetPostForReschedule || !newScheduleInput) return

    setRescheduling(true)
    try {
      await apiPut(`/api/social/posts/${targetPostForReschedule.id}`, {
        action: 'RESCHEDULE',
        scheduledAt: new Date(newScheduleInput).toISOString(),
      })
      toast({
        title: 'Đã đổi giờ đăng!',
        description: `Bài viết đã được hẹn lại vào ${formatDateTime(newScheduleInput)}.`,
      })
      setRescheduleModalOpen(false)
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể đổi giờ đăng'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    } finally {
      setRescheduling(false)
    }
  }

  // Publish Now
  const handlePublishNow = async (post: SocialPostItem) => {
    try {
      toast({ title: 'Đang xuất bản...', description: 'Đang phát lệnh tới cổng xuất bản mạng xã hội.' })
      const res = await apiPut<{ success: boolean; externalPostUrl?: string; isMockResult?: boolean }>(
        `/api/social/posts/${post.id}`,
        { action: 'PUBLISH' }
      )
      toast({
        title: 'Xuất bản thành công!',
        description: res.isMockResult
          ? `[Safe Mock Mode] Bài viết đã hoàn tất kiểm định an toàn (0 external call).`
          : `Bài viết đã đăng thật thành công!`,
      })
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xuất bản bài viết'
      toast({ title: 'Lỗi xuất bản', description: msg, variant: 'destructive' })
    }
  }

  // Retry Failed Post
  const handleRetryPost = async (post: SocialPostItem) => {
    try {
      toast({ title: 'Đang thử lại...', description: 'Đang phát lại yêu cầu xuất bản.' })
      await apiPut(`/api/social/posts/${post.id}`, { action: 'RETRY' })
      toast({ title: 'Hoàn tất', description: 'Đã gửi lại yêu cầu xuất bản thành công!' })
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể thử lại'
      toast({ title: 'Lỗi thử lại', description: msg, variant: 'destructive' })
    }
  }

  // Delete Post
  const handleDeletePost = async (post: SocialPostItem) => {
    if (!confirm('Bạn có chắc muốn xóa bài viết này?')) return
    try {
      await apiDelete(`/api/social/posts/${post.id}`)
      toast({ title: 'Đã xóa bài viết', description: 'Bài viết đã được dọn sạch.' })
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xóa bài viết'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    }
  }

  // Open Full Detail / Edit Post
  const handleOpenPostDetail = (post: SocialPostItem) => {
    setSelectedPostDetail(post)
    setEditPostContent(post.content)
    setEditPostTitle(post.title || '')
    setIsEditingPost(false)
    setPostDetailModalOpen(true)
  }

  // Save Post Edit
  const handleSavePostEdit = async () => {
    if (!selectedPostDetail) return
    setSavingPostEdit(true)
    try {
      await apiPut(`/api/social/posts/${selectedPostDetail.id}`, {
        title: editPostTitle,
        content: editPostContent,
      })
      toast({ title: 'Đã lưu thay đổi', description: 'Nội dung bài viết đã được cập nhật.' })
      setIsEditingPost(false)
      loadPosts()
      // update local
      setSelectedPostDetail({
        ...selectedPostDetail,
        title: editPostTitle,
        content: editPostContent,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể lưu bài viết'
      toast({ title: 'Lỗi', description: msg, variant: 'destructive' })
    } finally {
      setSavingPostEdit(false)
    }
  }

  // ==========================================
  // TAB 4 ACTIONS (GATEWAY & RUNNER)
  // ==========================================

  const handleRunScheduleQueue = async () => {
    setRunningSchedule(true)
    try {
      const res = await apiPost<{
        success: boolean
        scannedCount: number
        publishedCount: number
        failedCount: number
        referenceTime: string
      }>('/api/social/schedule', {})

      setScheduleRunnerResult(res)
      toast({
        title: 'Quét hàng đợi thành công!',
        description: `Đã quét ${res.scannedCount} bài viết tới hạn. Đã xuất bản: ${res.publishedCount}, Lỗi: ${res.failedCount}.`,
      })
      loadPosts()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi kích hoạt quét lịch đăng'
      toast({ title: 'Lỗi quét hàng đợi', description: msg, variant: 'destructive' })
    } finally {
      setRunningSchedule(false)
    }
  }

  const handleTestSocialProvider = async (providerKey: string) => {
    setTestingProvider(providerKey)
    try {
      const res = await apiPost<{
        ok: boolean
        status: string
        message: string
      }>('/api/integrations/credentials/test', { provider: providerKey })
      toast({
        title: res.ok ? `Kết nối ${providerKey} sẵn sàng!` : `Cần bổ sung cấu hình ${providerKey}`,
        description: res.message,
        variant: res.ok ? 'default' : 'destructive',
      })
      loadSocialCredentials()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kiểm tra kết nối'
      toast({ title: 'Lỗi kiểm tra', description: msg, variant: 'destructive' })
    } finally {
      setTestingProvider(null)
    }
  }

  const handleOpenSocialConfig = (providerKey: string) => {
    const existing = socialCredentials[providerKey]
    const spec = SOCIAL_PROVIDER_FIELDS[providerKey]
    const nextForm: Record<string, string> = { ...(existing?.config || {}) }
    if (spec) {
      for (const f of spec.fields) {
        if (nextForm[f.key] === undefined) {
          nextForm[f.key] = f.placeholder
        }
      }
    }
    setConfigFormValues(nextForm)
    setConfigEnabledValue(existing ? existing.enabled : true)
    setConfigProviderModal(providerKey)
  }

  const handleSaveSocialConfig = async () => {
    if (!configProviderModal) return
    setSavingProviderConfig(true)
    try {
      await apiPut('/api/integrations/credentials', {
        provider: configProviderModal,
        enabled: configEnabledValue,
        config: configFormValues,
        status: configEnabledValue ? 'CONNECTED' : 'PENDING',
      })
      toast({
        title: 'Đã lưu cấu hình kết nối Social!',
        description: `Đã cập nhật thông số đăng bài cho ${configProviderModal}.`,
      })
      setConfigProviderModal(null)
      loadSocialCredentials()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể lưu cấu hình'
      toast({ title: 'Lỗi lưu cấu hình', description: msg, variant: 'destructive' })
    } finally {
      setSavingProviderConfig(false)
    }
  }

  // Helper for Status Badge
  const renderPostStatusBadge = (status: PostStatus) => {
    switch (status) {
      case 'DRAFT':
        return (
          <Badge variant="outline" className="border-border text-muted-foreground bg-muted/40 font-normal">
            Bản nháp
          </Badge>
        )
      case 'PENDING_APPROVAL':
        return (
          <Badge className="border-amber-400 bg-amber-500/15 text-amber-700 dark:text-amber-400 font-medium">
            Chờ chủ duyệt
          </Badge>
        )
      case 'APPROVED':
        return (
          <Badge className="border-blue-300 bg-blue-500/15 text-blue-700 dark:text-blue-400 font-medium">
            Đã duyệt
          </Badge>
        )
      case 'SCHEDULED':
        return (
          <Badge className="border-purple-300 bg-purple-500/15 text-purple-700 dark:text-purple-400 font-medium gap-1">
            <Clock className="h-3 w-3" /> Đã lên lịch
          </Badge>
        )
      case 'PUBLISHED':
        return (
          <Badge className="border-emerald-300 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-semibold gap-1">
            <CheckCircle2 className="h-3 w-3" /> Đã đăng
          </Badge>
        )
      case 'FAILED':
        return (
          <Badge variant="destructive" className="bg-destructive/15 text-destructive border-destructive/30 gap-1">
            <AlertTriangle className="h-3 w-3" /> Lỗi đăng
          </Badge>
        )
      case 'REJECTED':
        return (
          <Badge variant="outline" className="border-red-300 text-red-600 bg-red-500/10 font-normal">
            Bị từ chối
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Auto Social — Tiếp thị AI & Lịch Đăng Đa Kênh"
        description="AI tự đọc tư liệu Google Drive và chiến dịch CRM, lên kế hoạch viết bài và tự động đăng bài theo phê duyệt của chủ tiệm"
      >
        <Button variant="outline" size="sm" onClick={() => { loadDriveSources(); loadPosts(); }}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> Làm mới
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="border-[#1877F2]/40 bg-[#1877F2]/10 font-semibold text-[#1877F2] hover:bg-[#1877F2]/20"
          onClick={() => setFanpageTestOpen(true)}
        >
          <Facebook className="mr-1.5 h-4 w-4" /> Đăng bài Test lên Fanpage
        </Button>
        <Button
          size="sm"
          className="bg-primary text-primary-foreground font-medium"
          onClick={() => setActiveTab('planning')}
        >
          <Sparkles className="mr-1.5 h-4 w-4" /> Tạo Kế Hoạch AI
        </Button>
      </PageHeader>

      {/* 4 Tabs Container */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full space-y-4">
        {/* Tabs navigation list with horizontal scrolling for 390px mobile */}
        <div className="overflow-x-auto pb-1">
          <TabsList className="h-10 w-full sm:w-auto inline-flex justify-start border bg-muted/60 p-1">
            <TabsTrigger value="drive" className="text-xs sm:text-sm gap-1.5 px-3">
              <FolderOpen className="h-4 w-4 text-amber-500" />
              <span>1. Nguồn Drive Công Khai</span>
              {driveSources.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {driveSources.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="planning" className="text-xs sm:text-sm gap-1.5 px-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>2. AI Lên Kế Hoạch</span>
            </TabsTrigger>
            <TabsTrigger value="review" className="text-xs sm:text-sm gap-1.5 px-3">
              <CalendarCheck className="h-4 w-4 text-emerald-500" />
              <span>3. Duyệt & Lịch Đăng</span>
              {posts.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">
                  {posts.length}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="gateway" className="text-xs sm:text-sm gap-1.5 px-3">
              <ShieldCheck className="h-4 w-4 text-blue-500" />
              <span>4. Cổng 7 Nền Tảng & An Toàn</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ======================================================== */}
        {/* TAB 1: GOOGLE DRIVE SOURCES                             */}
        {/* ======================================================== */}
        <TabsContent value="drive" className="space-y-5">
          {/* Card Form: Connect New Public Drive */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-amber-500" />
                Kết nối Thư mục Google Drive công khai
              </CardTitle>
              <CardDescription>
                Nhập đường dẫn thư mục Google Drive công khai chứa hình ảnh, video, Google Docs (kịch bản/bài viết) và Google Sheets (bảng giá/kế hoạch).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSyncDrive} className="space-y-4">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="drive-url">Đường dẫn Thư mục Google Drive công khai *</Label>
                    <div className="flex gap-2">
                      <Input
                        id="drive-url"
                        placeholder="https://drive.google.com/drive/folders/..."
                        value={driveUrlInput}
                        onChange={(e) => setDriveUrlInput(e.target.value)}
                        className="font-mono text-xs"
                        required
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setDriveUrlInput('E:\\Thạch Cao\\assets\\images')
                          setDriveNameInput('An Nhiên Thạch — Bộ Ảnh & KOL Dòng Thạch Cao Thật')
                        }}
                        title="Nạp bộ ảnh gốc, 4 KOL Châu Á & ảnh cận cảnh từ E:\Thạch Cao\assets\images"
                        className="shrink-0 text-xs font-medium"
                      >
                        Kho ảnh Thạch Cao
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setDriveUrlInput(PUBLIC_TEST_DRIVE_URL)}
                        title="Dùng link thư mục công khai mẫu Ưu Đàm"
                        className="shrink-0 text-xs"
                      >
                        Dùng link mẫu
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="drive-name">Tên nguồn tư liệu</Label>
                    <Input
                      id="drive-name"
                      placeholder="VD: Bộ sưu tập Trầm Hương Mùa Thu 2026"
                      value={driveNameInput}
                      onChange={(e) => setDriveNameInput(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="drive-camp">Gắn với Chiến dịch CRM (Tùy chọn)</Label>
                    <select
                      id="drive-camp"
                      className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:text-sm"
                      value={driveCampaignInput}
                      onChange={(e) => setDriveCampaignInput(e.target.value)}
                    >
                      <option value="">-- Không liên kết chiến dịch --</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name || c.title} ({c.status})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Info className="h-4 w-4 text-blue-500 shrink-0" />
                    <span>Hệ thống tự động duyệt tệp, trích xuất text từ Google Docs và Google Sheets mà không cần khóa API.</span>
                  </div>
                  <Button type="submit" disabled={syncingDrive} className="gap-1.5">
                    <RefreshCw className={`h-4 w-4 ${syncingDrive ? 'animate-spin' : ''}`} />
                    {syncingDrive ? 'Đang đồng bộ...' : 'Đồng bộ thư mục Drive'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* List of Synced Sources */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center justify-between">
              <span>Các nguồn dữ liệu Drive đã đồng bộ ({driveSources.length})</span>
            </h3>

            {loadingDrive ? (
              <TableSkeleton rows={3} />
            ) : driveSources.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="Chưa có thư mục Google Drive nào"
                description="Hãy kết nối thư mục Google Drive công khai ở trên để AI có tư liệu ảnh, video và văn bản viết bài."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {driveSources.map((source) => (
                  <Card key={source.id} className="border-border/70 shadow-sm hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                            <span>{source.name}</span>
                          </div>
                          <a
                            href={source.driveFolderUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary underline truncate max-w-[280px]"
                          >
                            {source.driveFolderUrl} <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            source.syncStatus === 'SYNCED'
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-500/10'
                              : 'border-amber-300 text-amber-700 bg-amber-500/10'
                          }
                        >
                          {source.syncStatus === 'SYNCED' ? 'Đã đồng bộ' : source.syncStatus}
                        </Badge>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">
                          {source._count?.items ?? 0} tài liệu / tệp tin
                        </span>
                        <span>•</span>
                        <span>Đồng bộ: {source.lastSyncAt ? timeAgo(source.lastSyncAt) : 'Chưa có'}</span>
                        {source.campaign && (
                          <>
                            <span>•</span>
                            <Badge variant="secondary" className="text-[10px]">
                              {source.campaign.name || source.campaign.code}
                            </Badge>
                          </>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t text-xs">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 gap-1 text-xs"
                          onClick={() => handleInspectSource(source.id)}
                        >
                          <Eye className="h-3.5 w-3.5" /> Xem cây tệp & Text trích xuất
                        </Button>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleReSyncSource(source.id)}
                            title="Tái đồng bộ"
                          >
                            <RotateCw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                            onClick={() => handleDeleteSource(source.id)}
                            title="Xóa nguồn"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 2: AI PLANNING                                      */}
        {/* ======================================================== */}
        <TabsContent value="planning" className="space-y-5">
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                Cấu hình AI Lên Kế Hoạch & Viết Bài Đa Kênh
              </CardTitle>
              <CardDescription>
                AI phân tích thông điệp chiến dịch CRM, sản phẩm ưu đãi và tư liệu Drive để sinh nội dung phù hợp cho từng nền tảng theo chuẩn giọng Ưu Đàm.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Chọn Chiến dịch */}
                <div className="space-y-1.5">
                  <Label htmlFor="plan-campaign">1. Chiến dịch CRM mục tiêu *</Label>
                  <select
                    id="plan-campaign"
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:text-sm"
                    value={planningCampaignId}
                    onChange={(e) => setPlanningCampaignId(e.target.value)}
                  >
                    <option value="">-- Chọn chiến dịch CRM --</option>
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} — {c.name || c.title} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Chọn Nguồn Drive */}
                <div className="space-y-1.5">
                  <Label htmlFor="plan-source">2. Nguồn tư liệu Drive (Ảnh, Video, Docs)</Label>
                  <select
                    id="plan-source"
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:text-sm"
                    value={planningSourceId}
                    onChange={(e) => setPlanningSourceId(e.target.value)}
                  >
                    <option value="">-- Tất cả nguồn tư liệu --</option>
                    {driveSources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s._count?.items ?? 0} files)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 7 Nền tảng */}
              <div className="space-y-2">
                <Label>3. Chọn các kênh mạng xã hội mục tiêu ({planningPlatforms.length}/7 nền tảng)</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                  {(Object.keys(PLATFORMS_INFO) as SocialChannel[]).map((platform) => {
                    const info = PLATFORMS_INFO[platform]
                    const Icon = info.icon
                    const selected = planningPlatforms.includes(platform)
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => togglePlatform(platform)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2.5 text-xs transition-all ${
                          selected
                            ? 'border-primary bg-primary/10 text-primary font-semibold shadow-xs'
                            : 'border-border/70 bg-card text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <Icon className="h-5 w-5" style={{ color: selected ? info.color : undefined }} />
                        <span className="text-center truncate w-full">{info.name.split(' ')[0]}</span>
                        <div className="flex items-center gap-1">
                          {selected ? (
                            <Check className="h-3 w-3 stroke-[3]" />
                          ) : (
                            <span className="h-3 w-3" />
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Số lượng bài & Giọng văn */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="space-y-1.5 md:col-span-1">
                  <Label htmlFor="plan-count">Số bài viết cần sinh</Label>
                  <select
                    id="plan-count"
                    className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:text-sm"
                    value={planningPostsCount}
                    onChange={(e) => setPlanningPostsCount(parseInt(e.target.value, 10))}
                  >
                    <option value={3}>3 bài (Nhỏ gọn)</option>
                    <option value={5}>5 bài (Tiêu chuẩn tuần)</option>
                    <option value={7}>7 bài (Toàn diện các kênh)</option>
                    <option value={10}>10 bài (Chiến dịch cao điểm)</option>
                    <option value={14}>14 bài (2 tuần)</option>
                  </select>
                </div>

                <div className="space-y-1.5 md:col-span-3">
                  <Label htmlFor="plan-prompt">Yêu cầu văn phong & Quy tắc thương hiệu Ưu Đàm</Label>
                  <Textarea
                    id="plan-prompt"
                    value={planningCustomPrompt}
                    onChange={(e) => setPlanningCustomPrompt(e.target.value)}
                    rows={2}
                    className="text-xs"
                  />
                </div>
              </div>

              {/* Invariant & Action Button */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 border-t">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  <span>Bất biến CRM: Giá bán, % giảm giá, mã voucher và hạn dùng được đối chiếu chính xác từ cơ sở dữ liệu.</span>
                </div>
                <Button
                  onClick={handleGenerateAiPlan}
                  disabled={generatingPlan}
                  className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground font-semibold"
                >
                  <Sparkles className={`h-4 w-4 ${generatingPlan ? 'animate-spin' : ''}`} />
                  {generatingPlan ? 'AI Đang viết bài...' : 'AI Tạo Kế Hoạch & Viết Bài'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Generated Plan Result Preview */}
          {latestPlan && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    Kế hoạch vừa tạo: {latestPlan.title}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Đã sinh {latestPlan.posts?.length || 0} bài viết nháp. Hãy chuyển sang Tab 3 "Duyệt & Lịch Đăng" để xem chi tiết và phê duyệt.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('review')}
                  className="gap-1.5 text-xs"
                >
                  Sang Tab Duyệt Bài <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Preview Grid */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {latestPlan.posts?.map((post) => {
                  const platInfo = PLATFORMS_INFO[post.channel] || PLATFORMS_INFO.WEBSITE
                  const Icon = platInfo.icon
                  return (
                    <Card key={post.id} className="border-border/70 shadow-xs hover:border-primary/50 transition-colors">
                      <CardContent className="p-3.5 space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className={`gap-1 text-xs font-semibold ${platInfo.badgeClass}`}>
                            <Icon className="h-3.5 w-3.5" />
                            {platInfo.name.split(' ')[0]}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {formatDateTime(post.scheduledAt)}
                          </span>
                        </div>

                        {post.title && (
                          <div className="font-semibold text-xs line-clamp-1 text-foreground">
                            {post.title}
                          </div>
                        )}

                        <div className="text-xs text-muted-foreground line-clamp-3 italic">
                          "{post.content}"
                        </div>

                        <div className="flex flex-wrap items-center gap-1 pt-1 border-t text-[10px]">
                          <Badge variant="outline" className="border-emerald-300 text-emerald-600 bg-emerald-500/10">
                            Khớp CRM 100%
                          </Badge>
                          <Badge variant="secondary" className="text-muted-foreground">
                            {post.generatorSource?.includes('LLM') ? 'LLM Gemini' : 'Mẫu Ưu Đàm'}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )}
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 3: CALENDAR & REVIEW (POST APPROVAL WORKFLOW)         */}
        {/* ======================================================== */}
        <TabsContent value="review" className="space-y-4">
          {/* Filters Bar */}
          <Card className="border-border/70 shadow-sm">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                {/* Search */}
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo nội dung, tiêu đề bài viết..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-9"
                  />
                </div>

                {/* Channel Filter */}
                <select
                  className="flex h-10 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-[180px] sm:text-xs"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                >
                  <option value="ALL">Tất cả kênh (7 nền tảng)</option>
                  {(Object.keys(PLATFORMS_INFO) as SocialChannel[]).map((p) => (
                    <option key={p} value={p}>
                      {PLATFORMS_INFO[p].name}
                    </option>
                  ))}
                </select>

                {/* Status Filter */}
                <select
                  className="flex h-10 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:w-[160px] sm:text-xs"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="ALL">Tất cả trạng thái</option>
                  <option value="PENDING_APPROVAL">Chờ duyệt</option>
                  <option value="APPROVED">Đã duyệt</option>
                  <option value="SCHEDULED">Đã lên lịch</option>
                  <option value="PUBLISHED">Đã đăng</option>
                  <option value="FAILED">Lỗi đăng</option>
                  <option value="REJECTED">Bị từ chối</option>
                  <option value="DRAFT">Bản nháp</option>
                </select>
              </div>

              {/* Thanh Thao tác & Lọc nhanh (Quick Chips + Batch Approve) */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-[11px] font-semibold text-muted-foreground">Lọc nhanh:</span>
                  {[
                    { label: 'Tất cả', status: 'ALL', q: '' },
                    { label: 'Chờ duyệt', status: 'PENDING_APPROVAL', q: '' },
                    { label: 'Đã duyệt', status: 'APPROVED', q: '' },
                    { label: 'Đã đăng', status: 'PUBLISHED', q: '' },
                    { label: 'Góc KOL Châu Á', status: 'ALL', q: 'KOL' },
                    { label: 'Mã UUDAM10', status: 'ALL', q: 'UUDAM10' },
                  ].map((chip) => {
                    const active = statusFilter === chip.status && searchQuery === chip.q
                    return (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => {
                          setStatusFilter(chip.status)
                          setSearchQuery(chip.q)
                        }}
                        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all ${
                          active
                            ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                            : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        {chip.label}
                      </button>
                    )
                  })}
                </div>

                <Button
                  size="sm"
                  variant="default"
                  disabled={
                    batchApproving ||
                    !posts.some((p) => p.status === 'PENDING_APPROVAL' || p.status === 'DRAFT')
                  }
                  onClick={() => void handleBatchApproveAllPending()}
                  className="h-7 bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700"
                >
                  {batchApproving ? (
                    <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                  )}
                  ✓ Duyệt nhanh toàn bộ bài Chờ duyệt (
                  {posts.filter((p) => p.status === 'PENDING_APPROVAL' || p.status === 'DRAFT').length})
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Posts List / Table */}
          {loadingPosts ? (
            <TableSkeleton rows={5} />
          ) : posts.length === 0 ? (
            <EmptyState
              icon={CalendarCheck}
              title="Chưa có bài viết nào trong lịch"
              description="Hãy sang Tab 2 'AI Lên Kế Hoạch' để sinh các bài viết nháp tự động từ chiến dịch CRM và Google Drive."
              action={
                <Button size="sm" onClick={() => setActiveTab('planning')}>
                  <Sparkles className="mr-1.5 h-4 w-4" /> Đi tới AI Lên Kế Hoạch
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm">
              <Table className="min-w-[900px]">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[140px]">Kênh & Lịch đăng</TableHead>
                    <TableHead className="w-[280px]">Nội dung & Media</TableHead>
                    <TableHead className="w-[120px]">Chiến dịch</TableHead>
                    <TableHead className="w-[130px]">Trạng thái</TableHead>
                    <TableHead className="w-[230px] text-right">Phê duyệt & Hành động</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post) => {
                    const platInfo = PLATFORMS_INFO[post.channel] || PLATFORMS_INFO.WEBSITE
                    const Icon = platInfo.icon
                    const isOverLimit = post.channel === 'THREADS' && post.content.length > 500
                    return (
                      <TableRow key={post.id} className="hover:bg-muted/30 transition-colors">
                        {/* Kênh & Lịch */}
                        <TableCell className="align-top py-3">
                          <div className="space-y-1">
                            <Badge variant="outline" className={`gap-1 text-[11px] font-semibold ${platInfo.badgeClass}`}>
                              <Icon className="h-3 w-3" />
                              {platInfo.name.split(' ')[0]}
                            </Badge>
                            <div className="text-xs font-mono text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span>{formatDateTime(post.scheduledAt)}</span>
                            </div>
                          </div>
                        </TableCell>

                        {/* Nội dung */}
                        <TableCell className="align-top py-3 whitespace-normal max-w-[380px]">
                          <div className="space-y-1 text-xs">
                            {post.title && (
                              <div className="font-semibold text-foreground line-clamp-1">
                                {post.title}
                              </div>
                            )}
                            <div className="text-muted-foreground line-clamp-2">
                              {post.content}
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px]">
                              <span className={`font-mono ${isOverLimit ? 'text-destructive font-bold' : 'text-muted-foreground'}`}>
                                {post.content.length} ký tự {post.channel === 'THREADS' && '/ max 500'}
                              </span>
                              {post.mediaUrls && post.mediaUrls.length > 0 && (
                                <Badge variant="secondary" className="gap-1 text-[10px]">
                                  <ImageIcon className="h-2.5 w-2.5" /> {post.mediaUrls.length} media
                                </Badge>
                              )}
                              {post.rejectionReason && (
                                <span className="text-destructive italic">
                                  Lý do từ chối: {post.rejectionReason}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>

                        {/* Chiến dịch */}
                        <TableCell className="align-top py-3 whitespace-normal max-w-[180px]">
                          <div className="text-xs space-y-1">
                            <div className="font-medium text-foreground line-clamp-2">
                              {post.campaign?.name || post.campaign?.title || 'Chung'}
                            </div>
                            {post.campaign?.code && (
                              <div className="text-muted-foreground font-mono text-[11px]">
                                {post.campaign.code}
                              </div>
                            )}
                          </div>
                        </TableCell>

                        {/* Trạng thái */}
                        <TableCell className="align-top py-3">
                          {renderPostStatusBadge(post.status)}
                        </TableCell>

                        {/* Phê duyệt & Hành động */}
                        <TableCell className="align-top py-3 text-right">
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {/* Phê duyệt (Chủ tiệm) */}
                            {post.status === 'PENDING_APPROVAL' && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                                  onClick={() => handleApprovePost(post)}
                                  title="Duyệt xuất bản bài viết này"
                                >
                                  <Check className="h-3 w-3 stroke-[3]" /> Duyệt
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-destructive border-destructive/40 hover:bg-destructive/10 gap-1"
                                  onClick={() => handleOpenReject(post)}
                                  title="Từ chối duyệt"
                                >
                                  <X className="h-3 w-3" /> Từ chối
                                </Button>
                              </>
                            )}

                            {/* Đăng ngay khi đã duyệt */}
                            {(post.status === 'APPROVED' || post.status === 'SCHEDULED') && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-7 px-2 text-xs bg-primary text-primary-foreground gap-1"
                                onClick={() => handlePublishNow(post)}
                                title="Xuất bản ngay lập tức"
                              >
                                <Send className="h-3 w-3" /> Đăng ngay
                              </Button>
                            )}

                            {/* Thử lại khi lỗi */}
                            {post.status === 'FAILED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs text-amber-600 border-amber-300 hover:bg-amber-500/10 gap-1"
                                onClick={() => handleRetryPost(post)}
                                title="Thử lại xuất bản"
                              >
                                <RotateCw className="h-3 w-3" /> Thử lại
                              </Button>
                            )}

                            {/* Đổi giờ */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleOpenReschedule(post)}
                              title="Đổi giờ đăng"
                            >
                              <Clock className="h-3.5 w-3.5" />
                            </Button>

                            {/* Xem / Sửa chi tiết */}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleOpenPostDetail(post)}
                              title="Xem & Chỉnh sửa nội dung"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>

                            {/* Xóa bài */}
                            {post.status !== 'PUBLISHED' && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                                onClick={() => handleDeletePost(post)}
                                title="Xóa bài viết"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ======================================================== */}
        {/* TAB 4: PUBLISHING GATEWAY & SAFETY                       */}
        {/* ======================================================== */}
        <TabsContent value="gateway" className="space-y-5">
          {/* Invariant Banner */}
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900 dark:bg-blue-950/40">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500 text-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-1 text-xs">
                <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2">
                  <span>Chế độ Giả Lập An Toàn (Safe Mock Mode) Đang Hoạt Động</span>
                  <Badge variant="outline" className="border-blue-400 bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                    0 External Socket Calls
                  </Badge>
                </div>
                <p className="text-blue-800 dark:text-blue-300">
                  Hệ thống kiểm soát nghiêm ngặt qua <strong>Ba Cổng Thép</strong>: Chỉ bài viết đã được <strong>Chủ tiệm duyệt (APPROVED)</strong>, thuộc <strong>Chiến dịch đang hoạt động</strong> và <strong>Đúng giờ hẹn</strong> mới được chuyển sang bộ xuất bản. Khi chưa cấu hình Token thật, hệ thống tự động chạy giả lập an toàn và xác thực đầy đủ lược đồ API của từng nền tảng.
                </p>
              </div>
            </div>
          </div>

          {/* Schedule Queue Trigger Card */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Play className="h-5 w-5 text-emerald-500" />
                  Kích hoạt Trình Quét Hàng Đợi (Schedule Runner)
                </span>
                <Button
                  onClick={handleRunScheduleQueue}
                  disabled={runningSchedule}
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
                >
                  <RefreshCw className={`h-4 w-4 ${runningSchedule ? 'animate-spin' : ''}`} />
                  {runningSchedule ? 'Đang quét...' : 'Quét & Đăng bài tới hạn ngay'}
                </Button>
              </CardTitle>
              <CardDescription>
                Background Runner tự động quét cơ sở dữ liệu tìm các bài viết ở trạng thái APPROVED có scheduledAt &le; thời gian hiện tại để xuất bản đa kênh và ghi nhận nhật ký kiểm toán.
              </CardDescription>
            </CardHeader>
            {scheduleRunnerResult && (
              <CardContent className="pt-0">
                <div className="rounded-lg bg-muted/60 p-3 text-xs space-y-1">
                  <div className="font-semibold text-foreground">Kết quả quét hàng đợi vừa thực thi:</div>
                  <div className="flex flex-wrap gap-4 text-muted-foreground">
                    <span>Số bài quét: <strong>{scheduleRunnerResult.scannedCount}</strong></span>
                    <span>Đã xuất bản: <strong className="text-emerald-600">{scheduleRunnerResult.publishedCount}</strong></span>
                    <span>Lỗi: <strong className={scheduleRunnerResult.failedCount > 0 ? 'text-destructive' : ''}>{scheduleRunnerResult.failedCount}</strong></span>
                    <span>Mốc thời gian: {formatDateTime(scheduleRunnerResult.referenceTime)}</span>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* 3 Cách kết nối để đăng bài lên 7 kênh Social */}
          <Card className="border-amber-200/80 bg-amber-50/40 dark:border-amber-900/50 dark:bg-amber-950/20 shadow-xs">
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Share2 className="h-4 w-4 text-amber-600" />
                    <span>3 Phương Thức Kết Nối Để Đăng Bài Lên 7 Kênh Social</span>
                    <Badge className="bg-amber-600 text-white text-[10px]">Mới nâng cấp</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Chọn 1 trong 3 cách kết nối phù hợp với quy mô cửa hàng: Kết nối Official API trực tiếp, Cầu nối Make.com/n8n không cần duyệt App, hoặc REST API Blog.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-500/10"
                    onClick={() => handleOpenSocialConfig('SOCIAL_WEBHOOK_HUB')}
                  >
                    Cấu hình Make.com / n8n Bridge
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => handleTestSocialProvider('SOCIAL_WEBHOOK_HUB')}
                    disabled={testingProvider === 'SOCIAL_WEBHOOK_HUB'}
                  >
                    {testingProvider === 'SOCIAL_WEBHOOK_HUB' ? 'Đang test...' : 'Test Bridge'}
                  </Button>
                  {onNavigate && (
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => onNavigate('integrations')}
                    >
                      Mở Trung tâm Key Đối tác
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3 text-xs">
                <div className="rounded-lg border bg-card p-3 space-y-1">
                  <div className="font-bold text-primary">Cách 1: Official Graph / Open API</div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Dùng Page Access Token (Facebook, Instagram Business), Threads Token, TikTok Content Posting API v2, Zalo OA Open API v3.0 để xuất bản trực tiếp.
                  </p>
                </div>
                <div className="rounded-lg border border-amber-300/80 bg-card p-3 space-y-1">
                  <div className="font-bold text-amber-700 dark:text-amber-300 flex items-center justify-between">
                    <span>Cách 2: Make.com / n8n / Zapier Bridge</span>
                    <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">Khuyên dùng</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Không cần tự xin quyền App Developer Meta/TikTok. CMS bắn 1 gói JSON bài đã duyệt sang Webhook Make.com / n8n để tự đăng đồng loạt lên cả 7 kênh.
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3 space-y-1">
                  <div className="font-bold text-emerald-700 dark:text-emerald-300">Cách 3: Website /blog & WP/Haravan REST</div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Tự động xuất bản bài viết chuẩn SEO lên trang <code className="font-mono">/blog</code> nội bộ (0 cần key) và đồng bộ qua REST API sang WordPress, Haravan, Sapo.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 7 Platform Cards */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Trạng thái kết nối & Cấu hình Key 7 Nền tảng Xuất bản</h3>
              <span className="text-xs text-muted-foreground">
                Đồng bộ trực tiếp với Trung tâm Cấu hình Key Đối tác
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(PLATFORMS_INFO) as SocialChannel[]).map((channel) => {
                const info = PLATFORMS_INFO[channel]
                const Icon = info.icon
                const providerKey = CHANNEL_PROVIDER_MAP[channel]
                const cred = socialCredentials[providerKey]
                const spec = SOCIAL_PROVIDER_FIELDS[providerKey]
                const isConnected = cred?.enabled && cred?.status === 'CONNECTED'
                return (
                  <Card key={channel} className="border-border/70 shadow-xs">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
                            style={{ backgroundColor: info.color }}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-bold text-xs text-foreground">{info.name}</div>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              {channel} • {providerKey}
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${
                            isConnected
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-500/10'
                              : 'border-amber-300 text-amber-700 bg-amber-500/10'
                          }`}
                        >
                          {isConnected ? 'Đã kết nối Key' : 'Safe Mock'}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground min-h-[32px]">
                        {info.limitDesc}
                      </p>

                      {spec && (
                        <div className="rounded-md bg-muted/50 p-2 text-[11px] space-y-1">
                          <div className="font-medium text-foreground truncate">{spec.methodSummary}</div>
                          <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground font-mono">
                            {spec.fields.slice(0, 2).map((f) => {
                              const val = cred?.config?.[f.key]
                              const displayVal = val
                                ? f.secret
                                  ? `${val.slice(0, 8)}...`
                                  : val
                                : 'Chưa điền'
                              return (
                                <span key={f.key} className="rounded border bg-background px-1.5 py-0.5">
                                  {f.key}: {displayVal}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t flex items-center justify-between gap-2 text-[11px]">
                        {channel === 'WEBSITE' ? (
                          <a
                            href="/blog"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                          >
                            Xem Trang Blog (/blog) <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-emerald-600 font-medium">Sẵn sàng xuất bản</span>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => handleTestSocialProvider(providerKey)}
                            disabled={testingProvider === providerKey}
                          >
                            {testingProvider === providerKey ? 'Đang test...' : 'Kiểm tra'}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-8 px-2.5 text-xs"
                            onClick={() => handleOpenSocialConfig(providerKey)}
                          >
                            Cấu hình Key
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* ======================================================== */}
      {/* MODAL 1: DRIVE INSPECTOR & EXTRACTED TEXT VIEWER        */}
      {/* ======================================================== */}
      <Dialog open={inspectorOpen} onOpenChange={setInspectorOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-amber-500" />
              Chi tiết Tệp tin & Văn bản Trích xuất từ Drive
            </DialogTitle>
            <DialogDescription>
              {selectedSourceDetail?.source.name} ({selectedSourceDetail?.items.length || 0} tệp)
            </DialogDescription>
          </DialogHeader>

          {loadingSourceDetail ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              <RefreshCw className="mx-auto h-6 w-6 animate-spin text-primary mb-2" />
              Đang tải danh sách tệp và nội dung trích xuất...
            </div>
          ) : selectedSourceDetail && (
            <div className="space-y-4 text-xs">
              {/* Document Text Inspector Box */}
              {selectedDocContent && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-primary flex items-center gap-1.5">
                      <FileText className="h-4 w-4" /> Nội dung trích xuất: {selectedDocTitle}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs"
                      onClick={() => setSelectedDocContent(null)}
                    >
                      Đóng xem trước
                    </Button>
                  </div>
                  <pre className="max-h-48 overflow-y-auto rounded bg-card p-2 font-mono text-[11px] whitespace-pre-wrap leading-relaxed text-foreground border">
                    {selectedDocContent}
                  </pre>
                </div>
              )}

              {/* Items List */}
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Tên tệp</TableHead>
                      <TableHead className="w-[100px]">Loại tệp</TableHead>
                      <TableHead className="w-[120px] text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedSourceDetail.items.map((item) => (
                      <TableRow key={item.id} className="hover:bg-muted/30">
                        <TableCell className="font-medium text-xs">
                          <div className="flex items-center gap-2">
                            {item.fileType === 'IMAGE' && <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />}
                            {item.fileType === 'VIDEO' && <VideoIcon className="h-4 w-4 text-purple-500 shrink-0" />}
                            {item.fileType === 'DOCUMENT' && <FileText className="h-4 w-4 text-amber-500 shrink-0" />}
                            {item.fileType === 'SHEET' && <FileSpreadsheet className="h-4 w-4 text-emerald-500 shrink-0" />}
                            {item.fileType === 'FOLDER' && <Folder className="h-4 w-4 text-amber-400 shrink-0" />}
                            <span className="truncate max-w-[320px]">{item.name}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {item.fileType}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {item.textContent ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-6 px-2 text-[10px]"
                                onClick={() => {
                                  setSelectedDocTitle(item.name)
                                  setSelectedDocContent(item.textContent || '')
                                }}
                              >
                                Đọc text
                              </Button>
                            ) : null}
                            {item.webViewLink && (
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-6 items-center px-1.5 text-[10px] text-muted-foreground hover:text-primary"
                              >
                                Mở Drive <ExternalLink className="h-3 w-3 ml-0.5" />
                              </a>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setInspectorOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================== */}
      {/* MODAL 2: REJECT POST REASON MODAL                       */}
      {/* ======================================================== */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <XCircle className="h-5 w-5" /> Từ chối duyệt bài viết
            </DialogTitle>
            <DialogDescription>
              Vui lòng nêu rõ lý do từ chối để người vận hành hoặc AI có thể viết lại phù hợp hơn.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2">
            <Label htmlFor="reject-reason">Lý do từ chối *</Label>
            <Textarea
              id="reject-reason"
              rows={3}
              value={rejectReasonInput}
              onChange={(e) => setRejectReasonInput(e.target.value)}
              placeholder="VD: Thiếu thông tin voucher, câu mở đầu chưa đủ trang nhã..."
              className="text-xs"
            />
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" size="sm" onClick={() => setRejectModalOpen(false)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmReject}
              disabled={rejecting}
            >
              {rejecting && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
              Xác nhận từ chối
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================== */}
      {/* MODAL 3: RESCHEDULE POST MODAL                          */}
      {/* ======================================================== */}
      <Dialog open={rescheduleModalOpen} onOpenChange={setRescheduleModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" /> Đổi thời gian xuất bản bài viết
            </DialogTitle>
            <DialogDescription>
              Chọn thời gian mới để hệ thống tự động đăng bài lên kênh đúng giờ.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-2">
            <Label htmlFor="new-schedule">Ngày giờ đăng mới *</Label>
            <Input
              id="new-schedule"
              type="datetime-local"
              value={newScheduleInput}
              onChange={(e) => setNewScheduleInput(e.target.value)}
              className="text-xs"
            />
          </div>
          <DialogFooter className="mt-4">
            <Button variant="outline" size="sm" onClick={() => setRescheduleModalOpen(false)}>
              Hủy
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmReschedule}
              disabled={rescheduling}
            >
              {rescheduling && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu thời gian mới
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ======================================================== */}
      {/* MODAL 4: POST DETAIL & FULL EDITOR                      */}
      {/* ======================================================== */}
      <Dialog open={postDetailModalOpen} onOpenChange={setPostDetailModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedPostDetail && (
            <div>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-base font-bold flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    Chi tiết Bài viết Mạng Xã Hội
                  </DialogTitle>
                  {renderPostStatusBadge(selectedPostDetail.status)}
                </div>
                <DialogDescription className="font-mono text-xs">
                  Kênh: {selectedPostDetail.channel} • Lịch: {formatDateTime(selectedPostDetail.scheduledAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4 text-xs">
                {/* Channel & Invariant Badges */}
                <div className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-muted/40">
                  <Badge variant="outline" className="border-emerald-300 text-emerald-600 bg-emerald-500/10">
                    Bất biến CRM: Đã xác thực
                  </Badge>
                  <Badge variant="secondary">
                    Nguồn sinh: {selectedPostDetail.generatorSource || 'LLM Gemini'}
                  </Badge>
                  {selectedPostDetail.channel === 'THREADS' && (
                    <Badge variant={editPostContent.length > 500 ? 'destructive' : 'outline'}>
                      Độ dài Threads: {editPostContent.length} / 500 ký tự
                    </Badge>
                  )}
                </div>

                {/* Edit Form */}
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label htmlFor="edit-title">Tiêu đề bài viết (dùng cho Website / Facebook)</Label>
                    <Input
                      id="edit-title"
                      value={editPostTitle}
                      onChange={(e) => setEditPostTitle(e.target.value)}
                      placeholder="Tiêu đề bài viết..."
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="edit-content">Nội dung bài viết *</Label>
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {editPostContent.length} ký tự
                      </span>
                    </div>
                    <Textarea
                      id="edit-content"
                      rows={8}
                      value={editPostContent}
                      onChange={(e) => setEditPostContent(e.target.value)}
                      className="text-xs leading-relaxed"
                    />
                  </div>

                  {selectedPostDetail.hashtags && (
                    <div className="space-y-1">
                      <Label>Hashtags</Label>
                      <div className="p-2 rounded bg-muted/30 font-mono text-primary text-[11px]">
                        {selectedPostDetail.hashtags}
                      </div>
                    </div>
                  )}

                  {selectedPostDetail.mediaUrls && selectedPostDetail.mediaUrls.length > 0 && (
                    <div className="space-y-1">
                      <Label>Media đính kèm ({selectedPostDetail.mediaUrls.length})</Label>
                      <div className="flex flex-wrap gap-2">
                        {selectedPostDetail.mediaUrls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] text-muted-foreground hover:text-primary"
                          >
                            <ImageIcon className="h-3 w-3" /> Media #{i + 1}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="mt-5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPostDetailModalOpen(false)}
                >
                  Đóng
                </Button>
                <Button
                  size="sm"
                  onClick={handleSavePostEdit}
                  disabled={savingPostEdit}
                >
                  {savingPostEdit && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
                  Lưu thay đổi bài viết
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ======================================================== */}
      {/* MODAL 5: SOCIAL CHANNEL CREDENTIAL QUICK CONFIG          */}
      {/* ======================================================== */}
      <Dialog open={!!configProviderModal} onOpenChange={(open) => !open && setConfigProviderModal(null)}>
        <DialogContent className="max-w-lg">
          {configProviderModal && SOCIAL_PROVIDER_FIELDS[configProviderModal] && (
            <div>
              <DialogHeader>
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <Share2 className="h-5 w-5 text-primary" />
                  Cấu hình Key Đăng bài: {SOCIAL_PROVIDER_FIELDS[configProviderModal].title}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {SOCIAL_PROVIDER_FIELDS[configProviderModal].methodSummary}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-3 text-xs">
                <div className="flex items-center justify-between rounded-lg border bg-muted/40 p-2.5">
                  <div>
                    <div className="font-semibold">Kích hoạt kết nối ({configProviderModal})</div>
                    <div className="text-[11px] text-muted-foreground">
                      Tự động đồng bộ với Trung tâm Cấu hình Key Đối tác
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={configEnabledValue}
                    onChange={(e) => setConfigEnabledValue(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                </div>

                {SOCIAL_PROVIDER_FIELDS[configProviderModal].fields.map((field) => (
                  <div key={field.key} className="space-y-1">
                    <Label htmlFor={`social-cfg-${field.key}`} className="text-xs">
                      {field.label} (<code className="font-mono text-[10px]">{field.key}</code>)
                    </Label>
                    <Input
                      id={`social-cfg-${field.key}`}
                      value={configFormValues[field.key] || ''}
                      onChange={(e) =>
                        setConfigFormValues((prev) => ({
                          ...prev,
                          [field.key]: e.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>

              <DialogFooter className="mt-5 flex flex-wrap items-center justify-between gap-2">
                {onNavigate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-xs text-primary"
                    onClick={() => {
                      setConfigProviderModal(null)
                      onNavigate('integrations')
                    }}
                  >
                    Mở Trung tâm Key Đối tác
                  </Button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setConfigProviderModal(null)}>
                    Đóng
                  </Button>
                  <Button size="sm" onClick={handleSaveSocialConfig} disabled={savingProviderConfig}>
                    {savingProviderConfig && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
                    Lưu Key Kết nối
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <FanpageTestPublishDialog
        open={fanpageTestOpen}
        onOpenChange={setFanpageTestOpen}
        onPublishedSuccess={() => {
          loadPosts()
          loadSocialCredentials()
        }}
      />
    </div>
  )
}
