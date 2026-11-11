'use client'

// API & WEBHOOK — tích hợp hai chiều: API Keys, Webhook endpoints, Credentials, Hướng dẫn

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react'

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { FanpageTestPublishDialog } from '@/components/cms/fanpage-test-publish-dialog'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'

// ===== Types =====

interface ApiKeyItem {
  id: string
  name: string
  key: string
  secret: string
  active: boolean
  createdAt: string
}

interface WebhookDeliveryItem {
  id: string
  event: string
  status: string
  responseCode: number | null
  error: string | null
  createdAt: string
}

interface WebhookEndpointItem {
  id: string
  name: string
  url: string
  secret: string
  events: string
  active: boolean
  createdAt: string
  deliveries: WebhookDeliveryItem[]
}

interface CredentialItem {
  provider: string
  label: string
  name: string
  config: unknown
  active: boolean
  updatedAt: string | null
}

interface IntegrationsData {
  apiKeys: ApiKeyItem[]
  webhooks: WebhookEndpointItem[]
  credentials: CredentialItem[]
  events: string[]
  inboundUrl: string
  stats: {
    deliveriesSuccess: number
    deliveriesFailed: number
    endpoints: number
    keysActive: number
  }
}

// ===== Hằng số hiển thị =====

const DEFAULT_EVENT = 'order.created'

const CREDENTIAL_PLACEHOLDERS: Record<string, string> = {
  GHN: '{\n  "shopId": "...",\n  "token": "..."\n}',
  GHTK: '{\n  "token": "..."\n}',
  VIETTEL: '{\n  "token": "..."\n}',
  JT: '{\n  "apiUser": "...",\n  "apiKey": "..."\n}',
  NINJA: '{\n  "clientId": "...",\n  "clientSecret": "..."\n}',
  ZALO_OA: '{\n  "oaId": "...",\n  "appId": "...",\n  "oaSecret": "...",\n  "znsToken": "...",\n  "miniAppId": "..."\n}',
  SHOPEE:
    '{\n  "partnerId": "...",\n  "partnerKey": "...",\n  "shopId": "...",\n  "accessToken": "...",\n  "webhookSecret": "..."\n}',
  TIKTOK_SHOP:
    '{\n  "appKey": "...",\n  "appSecret": "...",\n  "shopId": "...",\n  "shopCipher": "...",\n  "accessToken": "..."\n}',
  LAZADA:
    '{\n  "appKey": "...",\n  "appSecret": "...",\n  "sellerId": "...",\n  "accessToken": "..."\n}',
  WEBSITE:
    '{\n  "siteUrl": "https://uudam.vn",\n  "storefrontApiKey": "opvn_live_...",\n  "webhookUrl": "https://uudam.vn/api/openvn-sync",\n  "webhookSecret": "whsec_..."\n}',
  FACEBOOK:
    '{\n  "pageId": "...",\n  "pageAccessToken": "...",\n  "appSecret": "...",\n  "verifyToken": "..."\n}',
  INSTAGRAM:
    '{\n  "igUserId": "17841405829102938",\n  "pageId": "109283746519283",\n  "accessToken": "EAAGm0PX4ZCps_...",\n  "connectMode": "GRAPH_API",\n  "autoPublishReels": "true"\n}',
  THREADS:
    '{\n  "threadsUserId": "25491827364551029",\n  "accessToken": "THQVJ_...",\n  "connectMode": "THREADS_GRAPH_API",\n  "autoReplyFirstComment": "true"\n}',
  TIKTOK_CONTENT:
    '{\n  "openId": "uudam_tiktok_creator_openid",\n  "clientKey": "aw918273...",\n  "clientSecret": "tt_content_secret_...",\n  "accessToken": "act.uudam_...",\n  "defaultPrivacy": "PUBLIC_TO_EVERYONE"\n}',
  EXTERNAL_CMS:
    '{\n  "cmsType": "WORDPRESS",\n  "endpointUrl": "https://blog.uudam.vn/wp-json/wp/v2/posts",\n  "username": "editor_uudam",\n  "appPassword": "xxxx xxxx xxxx xxxx",\n  "webhookSecret": "whsec_ext_cms_..."\n}',
  SOCIAL_WEBHOOK_HUB:
    '{\n  "bridgePlatform": "MAKE_N8N_ZAPIER",\n  "bridgeWebhookUrl": "https://hook.eu2.make.com/uudam-social-publisher-bridge",\n  "bridgeSecret": "whsec_social_bridge_...",\n  "enabledChannels": "FACEBOOK,INSTAGRAM,TIKTOK,THREADS,ZALO_OA,EXTERNAL_CMS"\n}',
  PAYOS: '{\n  "clientId": "...",\n  "apiKey": "...",\n  "checksumKey": "...",\n  "webhookSecret": "..."\n}',
  SEPAY:
    '{\n  "bankName": "MBBank",\n  "accountNumber": "0905123456888",\n  "accountHolder": "UU DAM AN NHIEN THACH",\n  "vaPrefix": "DH",\n  "apiToken": "sepay_live_...",\n  "webhookSecret": "whsec_sepay_uudam_2026",\n  "webhookAuthType": "Apikey"\n}',
  ALLIANCE_HUB:
    '{\n  "hubCode": "OPENVN-ALLIANCE-HCM",\n  "partnerToken": "...",\n  "webhookSecret": "...",\n  "autoSyncStock": true\n}',
  GEMINI: '{\n  "apiKey": "...",\n  "model": "gemini-2.0-flash"\n}',
}

interface ProviderFieldSpec {
  key: string
  label: string
  placeholder: string
  required?: boolean
  hint?: string
}

interface ProviderConfigSpec {
  category: 'SOCIAL_WEB' | 'SOCIAL_PUBLISH' | 'ECOMMERCE' | 'SHIPPING' | 'PAYMENT_AI'
  portalName: string
  portalUrl: string
  summary: string
  steps: string[]
  fields: ProviderFieldSpec[]
}

const CREDENTIAL_CATEGORIES: Array<{
  id: ProviderConfigSpec['category']
  shortLabel: string
  title: string
  description: string
}> = [
  {
    id: 'SOCIAL_WEB',
    shortLabel: '1. Zalo, Website & FB',
    title: '1. Zalo OA / Mini App, Website Storefront & Facebook Fanpage',
    description: 'Nhận đơn hàng từ Website, Zalo Mini App, Fanpage, gửi thông báo ZNS và đăng bài trực tiếp lên Fanpage / Zalo OA / Website.',
  },
  {
    id: 'SOCIAL_PUBLISH',
    shortLabel: '2. Đăng bài Social (7 Kênh & Bridge)',
    title: '2. Các Cách Kết Nối Đăng Bài Social Đa Kênh (Instagram, Threads, TikTok, WordPress/Haravan & Make/n8n Bridge)',
    description: 'Hỗ trợ 3 cách kết nối xuất bản tự động cho module Auto Social: (1) Official Graph/Open API trực tiếp, (2) Cầu nối Webhook Make.com / n8n / Zapier không cần duyệt App, (3) REST API sang WordPress / Haravan / Sapo.',
  },
  {
    id: 'ECOMMERCE',
    shortLabel: '3. Sàn TMĐT',
    title: '3. Sàn Thương Mại Điện Tử (Shopee, TikTok Shop, Lazada)',
    description: 'Đồng bộ đơn hàng đa sàn, trừ tồn kho tức thì và đối soát phí sàn tự động.',
  },
  {
    id: 'SHIPPING',
    shortLabel: '4. Vận chuyển & COD',
    title: '4. Hãng Vận Chuyển & Đối Soát COD (GHN, GHTK, Viettel Post, J&T, Ninja Van)',
    description: 'Đẩy vận đơn tự động, lấy mã tracking và nhận trạng thái giao hàng / tiền thu hộ COD.',
  },
  {
    id: 'PAYMENT_AI',
    shortLabel: '5. SePay, VietQR & AI',
    title: '5. Cổng Thanh Toán Ngân Hàng & VietQR (SePay, PayOS), Liên Minh Kho & Trợ Lý AI Gemini',
    description: 'Tự động nhận biến động số dư ngân hàng SePay (gạch nợ đơn VietQR trong 1–3s), xác thực chữ ký PayOS, bán chéo liên kho và kích hoạt AI Autopilot.',
  },
]

const PROVIDER_CONFIG_SPECS: Record<string, ProviderConfigSpec> = {
  ZALO_OA: {
    category: 'SOCIAL_WEB',
    portalName: 'Zalo for Developers & OA Manager',
    portalUrl: 'https://developers.zalo.me/',
    summary: 'Đồng bộ tin nhắn Zalo OA, đơn hàng Zalo Mini App, bắn thông báo ZNS và đăng bài viết (Article/Broadcast) lên Zalo OA.',
    steps: [
      'Vào oa.zalo.me/manage/oa → Quản lý → Thông tin tài khoản để copy OA ID.',
      'Vào developers.zalo.me → Chọn Ứng dụng → Cài đặt để lấy App ID (Ứng dụng ID) và App Secret Key (oaSecret).',
      'Vào Công cụ API → OAuth Access Token (OA) cấp quyền Quản lý bài viết (Article API) & ZNS để lấy znsToken.',
      'Nếu có Zalo Mini App bán hàng: vào mini.zalo.me copy Mini App ID và cấu hình Webhook về /api/webhooks/inbound.',
    ],
    fields: [
      { key: 'oaId', label: 'OA ID (Mã Zalo Official Account)', placeholder: 'VD: 4092837461829301234', required: true },
      { key: 'appId', label: 'App ID (Ứng dụng ID trên Zalo Developer)', placeholder: 'VD: 3819203948172635412' },
      { key: 'oaSecret', label: 'App Secret Key (Khóa bí mật ứng dụng)', placeholder: 'VD: zsec_9a8b7c6d5e4f...', required: true },
      { key: 'znsToken', label: 'OA / ZNS Access Token (Gửi ZNS & Đăng bài OA)', placeholder: 'VD: zns_live_token_...' },
      { key: 'miniAppId', label: 'Zalo Mini App ID (nếu dùng Mini App)', placeholder: 'VD: 2938475610293847561' },
    ],
  },
  WEBSITE: {
    category: 'SOCIAL_WEB',
    portalName: 'OPENVN API Keys & Shop Blog (/blog)',
    portalUrl: '/blog',
    summary: 'Kết nối 2 chiều giữa Website bán hàng (uudam.vn / WooCommerce / Next.js) và tự động xuất bản bài chuẩn SEO lên trang /blog.',
    steps: [
      'Tại màn hình này, mở tab "API Keys" → bấm "+ Tạo API Key" để sinh cặp Key (opvn_live_...) và Secret (whsec_...).',
      'Dán cặp Key & Secret đó vào cấu hình biến môi trường trên Website của bạn và lưu đối chiếu vào các ô bên dưới.',
      'Khi xuất bản bài viết kênh WEBSITE trong module Auto Social, bài viết sẽ hiển thị ngay lập tức trên /blog kèm đẩy Webhook ra Website ngoài.',
    ],
    fields: [
      { key: 'siteUrl', label: 'Địa chỉ Website (Site URL)', placeholder: 'https://uudam.vn', required: true },
      { key: 'storefrontApiKey', label: 'API Key cấp cho Website (Inbound)', placeholder: 'opvn_live_...', required: true },
      { key: 'webhookUrl', label: 'URL nhận đồng bộ trên Website (Outbound)', placeholder: 'https://uudam.vn/api/openvn-sync' },
      { key: 'webhookSecret', label: 'Webhook Secret ký HMAC-SHA256', placeholder: 'whsec_...' },
    ],
  },
  FACEBOOK: {
    category: 'SOCIAL_WEB',
    portalName: 'Meta for Developers (Graph API)',
    portalUrl: 'https://developers.facebook.com/apps/',
    summary: 'Đăng bài tự động lên Facebook Fanpage (/{page-id}/feed & /photos), đồng bộ đơn Messenger và gửi Meta Conversions API.',
    steps: [
      'Vào developers.facebook.com/apps → Chọn App kiểu Business → thêm sản phẩm Messenger, Webhooks & quyền pages_manage_posts, pages_read_engagement.',
      'Tại mục Graph API Explorer hoặc System Users (Business Settings), tạo Page Access Token dài hạn (Never Expire) cho Fanpage.',
      'Copy Facebook Page ID và Page Access Token dán vào bên dưới để module Auto Social tự động đăng bài + ảnh/video.',
    ],
    fields: [
      { key: 'pageId', label: 'Facebook Page ID', placeholder: 'VD: 109283746519283', required: true },
      { key: 'pageAccessToken', label: 'Page Access Token (Có quyền pages_manage_posts)', placeholder: 'EAAGm0PX4ZCpsBA...', required: true },
      { key: 'appSecret', label: 'Meta App Secret', placeholder: 'fb_app_secret_...' },
      { key: 'verifyToken', label: 'Webhook Verify Token', placeholder: 'openvn_fb_verify_2026' },
    ],
  },
  INSTAGRAM: {
    category: 'SOCIAL_PUBLISH',
    portalName: 'Meta Graph API — Instagram Content Publishing',
    portalUrl: 'https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/content-publishing/',
    summary: 'Cách 1 (Official API): Đăng ảnh đơn, Carousel nhiều ảnh và Reels tự động lên tài khoản Instagram Business / Creator.',
    steps: [
      'Chuyển tài khoản Instagram của tiệm sang chế độ Chuyên nghiệp (Business / Creator) và liên kết với Facebook Fanpage.',
      'Trong Meta for Developers → cấp quyền instagram_basic và instagram_content_publish cho System User / Access Token.',
      'Gọi GET /me/accounts?fields=instagram_business_account để lấy igUserId (178414...) và dán cùng Access Token vào bên dưới.',
    ],
    fields: [
      { key: 'igUserId', label: 'Instagram Business Account ID (igUserId)', placeholder: 'VD: 17841405829102938', required: true },
      { key: 'pageId', label: 'Facebook Page ID liên kết', placeholder: 'VD: 109283746519283' },
      { key: 'accessToken', label: 'Meta Graph Access Token (instagram_content_publish)', placeholder: 'EAAGm0PX4ZCps_...', required: true },
      { key: 'connectMode', label: 'Phương thức kết nối (GRAPH_API / WEBHOOK_BRIDGE)', placeholder: 'GRAPH_API' },
      { key: 'autoPublishReels', label: 'Tự động đăng Video dạng Reels (true/false)', placeholder: 'true' },
    ],
  },
  THREADS: {
    category: 'SOCIAL_PUBLISH',
    portalName: 'Meta Threads API Portal',
    portalUrl: 'https://developers.facebook.com/docs/threads/',
    summary: 'Cách 1 (Official API): Đăng bài viết ngắn (≤ 500 ký tự) kèm ảnh/video tự động lên Threads qua graph.threads.net.',
    steps: [
      'Mở developers.facebook.com/apps → Tạo App có Use Case "Access the Threads API".',
      'Thêm quyền threads_basic và threads_content_publish, sau đó thêm tài khoản Threads của tiệm vào mục Threads Tester.',
      'Lấy Threads User ID và Long-lived Access Token (60 ngày, tự động gia hạn) tại mục User Token Generator.',
    ],
    fields: [
      { key: 'threadsUserId', label: 'Threads User ID', placeholder: 'VD: 25491827364551029', required: true },
      { key: 'accessToken', label: 'Threads Access Token (threads_content_publish)', placeholder: 'THQVJ_...', required: true },
      { key: 'connectMode', label: 'Phương thức (THREADS_GRAPH_API / WEBHOOK_BRIDGE)', placeholder: 'THREADS_GRAPH_API' },
      { key: 'autoReplyFirstComment', label: 'Tự gắn link mua hàng ở bình luận đầu (true/false)', placeholder: 'true' },
    ],
  },
  TIKTOK_CONTENT: {
    category: 'SOCIAL_PUBLISH',
    portalName: 'TikTok for Developers — Content Posting API v2',
    portalUrl: 'https://developers.tiktok.com/products/content-posting-api/',
    summary: 'Cách 1 (Official API): Đăng video ngắn TikTok và bộ ảnh Photo Carousel trực tiếp lên kênh TikTok của tiệm.',
    steps: [
      'Đăng nhập developers.tiktok.com → Manage Apps → kết nối sản phẩm "Content Posting API" (Direct Post).',
      'Bật quyền video.publish và video.upload, sau đó ủy quyền OAuth2 với tài khoản TikTok của tiệm để nhận openId và accessToken.',
      'Nếu chưa duyệt App Direct Post trên TikTok, bạn có thể dùng Cách 2 (Make.com / n8n Bridge hoặc gửi bản nháp vào TikTok Inbox).',
    ],
    fields: [
      { key: 'openId', label: 'TikTok Creator Open ID', placeholder: 'VD: uudam_tiktok_creator_openid', required: true },
      { key: 'clientKey', label: 'TikTok Client Key', placeholder: 'VD: aw91827364551029' },
      { key: 'clientSecret', label: 'TikTok Client Secret', placeholder: 'tt_content_secret_...' },
      { key: 'accessToken', label: 'OAuth2 Access Token (video.publish)', placeholder: 'act.uudam_...', required: true },
      { key: 'defaultPrivacy', label: 'Chế độ hiển thị (PUBLIC_TO_EVERYONE / SELF_ONLY)', placeholder: 'PUBLIC_TO_EVERYONE' },
    ],
  },
  SOCIAL_WEBHOOK_HUB: {
    category: 'SOCIAL_PUBLISH',
    portalName: 'Make.com / n8n / Zapier Social Bridge',
    portalUrl: 'https://www.make.com/',
    summary: 'Cách 2 (Khuyên dùng — Không cần xin duyệt App): Bắn bài đã duyệt qua 1 URL Webhook sang Make.com / n8n / Zapier để tự đăng lên 7 kênh.',
    steps: [
      'Tạo một Scenario mới trên Make.com (hoặc Workflow trên n8n / Zap trên Zapier) bắt đầu bằng module "Custom Webhook".',
      'Copy địa chỉ Webhook URL (VD: https://hook.eu2.make.com/...) dán vào ô bridgeWebhookUrl bên dưới.',
      'Trong Make.com / n8n, nối module Router rẽ nhánh theo trường "channel" (FACEBOOK, INSTAGRAM, TIKTOK, THREADS, ZALO_OA) tới các module mạng xã hội đã đăng nhập sẵn bằng 1 click.',
      'Khi bạn bấm "Đăng ngay" hoặc chạy Lịch hẹn giờ trong Auto Social, CMS sẽ ký HMAC-SHA256 và đẩy toàn bộ nội dung, ảnh/video sang Bridge.',
    ],
    fields: [
      { key: 'bridgePlatform', label: 'Nền tảng trung gian (MAKE_N8N_ZAPIER)', placeholder: 'MAKE_N8N_ZAPIER' },
      { key: 'bridgeWebhookUrl', label: 'Webhook URL của Make.com / n8n / Zapier', placeholder: 'https://hook.eu2.make.com/...', required: true },
      { key: 'bridgeSecret', label: 'Secret ký HMAC-SHA256 (Header X-Signature)', placeholder: 'whsec_social_bridge_...' },
      { key: 'enabledChannels', label: 'Các kênh uỷ quyền qua Bridge (cách nhau dấu phẩy)', placeholder: 'FACEBOOK,INSTAGRAM,TIKTOK,THREADS,ZALO_OA' },
    ],
  },
  EXTERNAL_CMS: {
    category: 'SOCIAL_PUBLISH',
    portalName: 'WordPress REST API / Haravan / Sapo Blog',
    portalUrl: 'https://developer.wordpress.org/rest-api/',
    summary: 'Cách 3 (CMS / Blog ngoài): Xuất bản bài viết chuẩn SEO từ Auto Social sang WordPress, Haravan hoặc Sapo.',
    steps: [
      'Với WordPress: vào WP Admin → Users → Profile → cuộn xuống mục "Application Passwords" → tạo mật khẩu ứng dụng mới.',
      'Điền Endpoint URL (VD: https://blog.uudam.vn/wp-json/wp/v2/posts), tên đăng nhập (username) và mật khẩu ứng dụng (appPassword).',
      'Với Haravan / Sapo: điền URL API Articles của gian hàng và Private Access Token vào ô appPassword.',
    ],
    fields: [
      { key: 'cmsType', label: 'Loại nền tảng (WORDPRESS / HARAVAN / SAPO)', placeholder: 'WORDPRESS' },
      { key: 'endpointUrl', label: 'REST API Endpoint URL', placeholder: 'https://blog.uudam.vn/wp-json/wp/v2/posts', required: true },
      { key: 'username', label: 'Username / API User (WordPress)', placeholder: 'editor_uudam' },
      { key: 'appPassword', label: 'Application Password / Bearer Token', placeholder: 'xxxx xxxx xxxx xxxx' },
      { key: 'webhookSecret', label: 'Webhook Secret xác thực', placeholder: 'whsec_ext_cms_...' },
    ],
  },
  SHOPEE: {
    category: 'ECOMMERCE',
    portalName: 'Shopee Open Platform (Guide 718 — Sensitive Data)',
    portalUrl: 'https://open.shopee.com/developer-guide/718',
    summary: 'Đồng bộ đơn hàng Shopee v2, tự động giữ/trừ tồn kho, mở khóa PII khách mua (Guide 718) và đối soát phí sàn Shopee.',
    steps: [
      'Đăng nhập open.shopee.com → Console → App Management → App List → chọn App của bạn.',
      'Copy Partner ID và Partner Key (Live hoặc Sandbox).',
      'Bấm Authorize Shop → đăng nhập tài khoản người bán Shopee để lấy Shop ID và Access Token.',
      'Tại mục Push Mechanism (Webhook), dán URL nhận /api/webhooks/inbound và bật sự kiện order_status_push.',
      'Mở khóa dữ liệu nhạy cảm (Developer Guide 718): Vào Go Live → PII Necessity Declaration → bật Toggle ON ("Does this App require buyer PII access?") và khai báo IP tĩnh của máy chủ (IP Whitelist) để nhận tên, SĐT, địa chỉ người nhận không bị che (****).',
      'Đối với ISV đa quốc gia: Nộp báo cáo kiểm thử xâm nhập hộp đen (Black-box Penetration Test Report) tại Personal Center → Account Information → Security Reports & Certifications (hiệu lực 2 năm).',
    ],
    fields: [
      { key: 'partnerId', label: 'Partner ID (Mã đối tác)', placeholder: 'VD: 2008912', required: true },
      { key: 'partnerKey', label: 'Partner Key (Khóa bí mật HMAC)', placeholder: 'shpk_7f8e9d6c5b4a...', required: true },
      { key: 'shopId', label: 'Shop ID (Mã gian hàng Shopee)', placeholder: 'VD: 492817365', required: true },
      { key: 'accessToken', label: 'Shop Access Token (OAuth2)', placeholder: 'shpat_...' },
      { key: 'webhookSecret', label: 'Push Webhook Secret (mặc định = Partner Key)', placeholder: 'shpk_...' },
      { key: 'whitelistedIps', label: 'IP Máy chủ Whitelist (PII Necessity Declaration — Guide 718)', placeholder: 'VD: 103.110.85.12, 45.119.82.10' },
    ],
  },
  TIKTOK_SHOP: {
    category: 'ECOMMERCE',
    portalName: 'TikTok Shop Partner Center',
    portalUrl: 'https://partner.tiktokshop.com/',
    summary: 'Nhận đơn hàng từ TikTok Shop / Livestream, đồng bộ tồn kho SKU và đối soát doanh thu thực nhận.',
    steps: [
      'Đăng nhập partner.tiktokshop.com → App & Service → chọn App đang phát triển.',
      'Copy App Key và App Secret trong phần Basic Information.',
      'Ủy quyền gian hàng (Authorize) để lấy Shop ID, Shop Cipher (bắt buộc cho API v202309+) và Access Token.',
    ],
    fields: [
      { key: 'appKey', label: 'App Key', placeholder: 'VD: 6a8b9c0d1e2f3g', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: 'tts_secret_...', required: true },
      { key: 'shopId', label: 'Shop ID (Mã gian hàng TikTok)', placeholder: 'VD: 7492817364829102', required: true },
      { key: 'shopCipher', label: 'Shop Cipher (Mã định danh API v2)', placeholder: 'ROW_9a8b7c6d5e4f...' },
      { key: 'accessToken', label: 'Access Token', placeholder: 'TTP_...' },
    ],
  },
  LAZADA: {
    category: 'ECOMMERCE',
    portalName: 'Lazada Open Platform',
    portalUrl: 'https://open.lazada.com/',
    summary: 'Đồng bộ sản phẩm, tồn kho và đơn hàng từ Lazada Seller Center về OPENVN CMS.',
    steps: [
      'Đăng nhập open.lazada.com → App Console → tạo hoặc chọn App → copy App Key và App Secret.',
      'Mở Lazada Seller Center → Thông tin tài khoản để lấy Seller ID (Short Code VN...).',
      'Thực hiện ủy quyền gian hàng qua OAuth để lấy Access Token.',
    ],
    fields: [
      { key: 'appKey', label: 'App Key', placeholder: 'VD: 129384', required: true },
      { key: 'appSecret', label: 'App Secret', placeholder: 'lzd_sec_...', required: true },
      { key: 'sellerId', label: 'Seller ID / Short Code', placeholder: 'VD: VN10928374', required: true },
      { key: 'accessToken', label: 'Access Token', placeholder: '50000901...' },
    ],
  },
  GHN: {
    category: 'SHIPPING',
    portalName: 'GHN Express Portal',
    portalUrl: 'https://khachhang.ghn.vn/',
    summary: 'Tạo vận đơn Giao Hàng Nhanh tự động, lấy phí ship và nhận webhook đối soát COD.',
    steps: [
      'Đăng nhập khachhang.ghn.vn → bấm vào tên tài khoản góc phải → Thông tin tài khoản.',
      'Copy Mã cửa hàng (Shop ID) và bấm Xem API Token để copy Token.',
    ],
    fields: [
      { key: 'shopId', label: 'Shop ID (Mã cửa hàng GHN)', placeholder: 'VD: 1928374', required: true },
      { key: 'token', label: 'API Token GHN', placeholder: '8a9b0c1d-2e3f-4a5b-...', required: true },
    ],
  },
  GHTK: {
    category: 'SHIPPING',
    portalName: 'GHTK Chủ Shop',
    portalUrl: 'https://khachhang.giaohangtietkiem.vn/',
    summary: 'Đẩy đơn sang Giao Hàng Tiết Kiệm và đồng bộ trạng thái hành trình vận đơn.',
    steps: [
      'Đăng nhập khachhang.giaohangtietkiem.vn → Thông tin tài khoản → Cài đặt API.',
      'Copy chuỗi API Token và cấu hình Webhook URL trỏ về /api/webhooks/inbound.',
    ],
    fields: [
      { key: 'token', label: 'API Token GHTK', placeholder: '9f8e7d6c5b4a3f2e1d...', required: true },
    ],
  },
  VIETTEL: {
    category: 'SHIPPING',
    portalName: 'ViettelPost',
    portalUrl: 'https://viettelpost.vn/',
    summary: 'Kết nối tạo vận đơn và tra cứu cước vận chuyển Viettel Post toàn quốc.',
    steps: [
      'Đăng nhập viettelpost.vn → Cấu hình tài khoản → Kết nối API đối tác.',
      'Lấy Token xác thực dài hạn (JWT Token) và dán vào ô bên dưới.',
    ],
    fields: [
      { key: 'token', label: 'ViettelPost API Token', placeholder: 'eyJhbGciOiJIUzI1NiIs...', required: true },
    ],
  },
  JT: {
    category: 'SHIPPING',
    portalName: 'J&T Express VIP Platform',
    portalUrl: 'https://jtexpress.vn/',
    summary: 'Kết nối tạo vận đơn J&T Express và theo dõi đối soát tiền thu hộ COD.',
    steps: [
      'Liên hệ quản lý tài khoản VIP J&T hoặc vào cổng đối tác J&T để nhận API User (Customer Code) và API Key.',
    ],
    fields: [
      { key: 'apiUser', label: 'API User / Customer Code', placeholder: 'VD: 028LC019283', required: true },
      { key: 'apiKey', label: 'API Key (Private Key)', placeholder: 'jt_live_...', required: true },
    ],
  },
  NINJA: {
    category: 'SHIPPING',
    portalName: 'Ninja Van Dashboard',
    portalUrl: 'https://dashboard.ninjavan.co/',
    summary: 'Kết nối OAuth2 với Ninja Van để tạo đơn giao hàng và nhận webhook trạng thái.',
    steps: [
      'Đăng nhập dashboard.ninjavan.co → Cài đặt → IT Settings / API Keys.',
      'Tạo cặp Client ID và Client Secret và dán vào cấu hình bên dưới.',
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'nv_client_...', required: true },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'nv_secret_...', required: true },
    ],
  },
  SEPAY: {
    category: 'PAYMENT_AI',
    portalName: 'SePay — Cổng VietQR & Biến Động Số Dư Ngân Hàng',
    portalUrl: 'https://my.sepay.vn/',
    summary: 'Nhận thông báo biến động số dư trực tiếp từ tài khoản ngân hàng (MBBank, VCB, ACB, BIDV, Techcombank...), tự động bóc tách mã đơn DH... và gạch nợ PAID trong 1–3 giây.',
    steps: [
      'Đăng nhập my.sepay.vn → mục "Ngân hàng" → Thêm và liên kết tài khoản ngân hàng hoặc tài khoản ảo (VA) của tiệm.',
      'Vào "Cấu hình Công ty" → "API Access" để tạo API Token (apiToken).',
      'Vào "Tích hợp Webhooks" → "Thêm Webhook": điền URL nhận là https://<ten-mien>/api/webhooks/inbound, chọn sự kiện "Có tiền vào (In)".',
      'Tại mục Kiểu chứng thực của SePay: chọn "API Key" (Header Authorization: Apikey <webhookSecret>) hoặc ký chữ ký HMAC X-Signature bằng mã webhookSecret bên dưới.',
    ],
    fields: [
      { key: 'bankName', label: 'Ngân hàng thụ hưởng (Brand Name)', placeholder: 'MBBank / Vietcombank / ACB / BIDV', required: true },
      { key: 'accountNumber', label: 'Số tài khoản nhận tiền / Số VA', placeholder: 'VD: 0905123456888', required: true },
      { key: 'accountHolder', label: 'Tên chủ tài khoản (In hoa không dấu)', placeholder: 'UU DAM AN NHIEN THACH' },
      { key: 'vaPrefix', label: 'Tiền tố nhận diện mã đơn trong nội dung CK', placeholder: 'DH' },
      { key: 'apiToken', label: 'SePay API Token (Tra cứu giao dịch)', placeholder: 'sepay_live_...' },
      { key: 'webhookSecret', label: 'SePay Webhook API Key / Secret (Bắt buộc)', placeholder: 'whsec_sepay_uudam_2026', required: true },
      { key: 'webhookAuthType', label: 'Kiểu xác thực (Apikey hoặc HMAC)', placeholder: 'Apikey' },
    ],
  },
  PAYOS: {
    category: 'PAYMENT_AI',
    portalName: 'PayOS — Cổng VietQR',
    portalUrl: 'https://my.payos.vn/',
    summary: 'Tạo mã VietQR động theo từng đơn và xác thực chữ ký HMAC-SHA256 cho toàn bộ Webhook Inbound.',
    steps: [
      'Đăng nhập my.payos.vn → Kênh thanh toán → Tạo kênh mới → copy Client ID, API Key và Checksum Key.',
      'Trường webhookSecret dùng để xác thực chữ ký X-Signature khi hệ thống ngoài gọi vào /api/webhooks/inbound.',
    ],
    fields: [
      { key: 'clientId', label: 'PayOS Client ID', placeholder: 'payos_client_...' },
      { key: 'apiKey', label: 'PayOS API Key', placeholder: 'payos_api_...' },
      { key: 'checksumKey', label: 'Checksum Key', placeholder: 'payos_checksum_...' },
      { key: 'webhookSecret', label: 'Inbound Webhook Secret (Bắt buộc)', placeholder: 'whsec_openvn_...', required: true },
    ],
  },
  ALLIANCE_HUB: {
    category: 'PAYMENT_AI',
    portalName: 'OPENVN Alliance Network',
    portalUrl: '/api',
    summary: 'Liên kết tồn kho thời gian thực và đối soát hoa hồng bán chéo giữa nhiều kho / shop liên minh.',
    steps: [
      'Đặt Mã cụm liên minh (hubCode) thống nhất giữa các cửa hàng trong nhóm.',
      'Cấp Partner Token để các shop đối tác gửi sự kiện INBOUND_ALLIANCE_STOCK_SYNC cập nhật tồn kho chéo.',
    ],
    fields: [
      { key: 'hubCode', label: 'Mã Cụm Liên Minh (Hub Code)', placeholder: 'OPENVN-ALLIANCE-HCM', required: true },
      { key: 'partnerToken', label: 'Partner Token xác thực liên kho', placeholder: 'all_tok_...', required: true },
      { key: 'webhookSecret', label: 'Webhook Secret Liên Minh', placeholder: 'whsec_alliance_...' },
    ],
  },
  GEMINI: {
    category: 'PAYMENT_AI',
    portalName: 'Google AI Studio',
    portalUrl: 'https://aistudio.google.com/app/apikey',
    summary: 'Trí tuệ nhân tạo phân tích đơn hàng, gợi ý phản hồi khách hàng trên Zalo OA và vận hành Trung tâm Điều hành AI.',
    steps: [
      'Truy cập aistudio.google.com/app/apikey bằng tài khoản Google.',
      'Bấm "Create API key" → copy chuỗi bắt đầu bằng AIzaSy... và dán vào ô API Key.',
    ],
    fields: [
      { key: 'apiKey', label: 'Gemini API Key', placeholder: 'AIzaSy...', required: true },
      { key: 'model', label: 'Model mặc định', placeholder: 'gemini-2.0-flash' },
    ],
  },
}

const INBOUND_SIMULATOR_PRESETS: Record<string, Record<string, unknown>> = {
  INBOUND_SEPAY_TRANSACTION: {
    gateway: 'MBBank',
    accountNumber: '0905123456888',
    transferType: 'in',
    transferAmount: 390000,
    content: 'Chuyen khoan DH261028-8899 An Nhien Thach',
    referenceCode: 'FT2630198821',
  },
  INBOUND_PING: {},
  INBOUND_VOUCHER_VALIDATE: {
    voucherCode: 'UUDAM10',
    subtotal: 350000,
    shippingFee: 30000,
  },
  INBOUND_ALLIANCE_STOCK_SYNC: {
    warehouseCode: 'SHOP-GOM-ZEN',
    note: 'Đồng bộ tồn kho định kỳ từ Showroom Gốm Trà Zen',
    items: [{ sku: 'UD-TRA-001', delta: 2 }],
  },
  INBOUND_STOCK_UPDATE: {
    sku: 'UD-NEN-001',
    warehouseCode: 'KHO-TRUNG-TAM',
    delta: 5,
    note: 'Nhập bổ sung từ xưởng nến bơ Ưu Đàm',
  },
  INBOUND_ORDER_CREATE: {
    channelKey: 'WEBSITE',
    warehouseCode: 'KHO-TRUNG-TAM',
    voucherCode: 'UUDAM10',
    customerName: 'Nguyễn Minh An (Đơn Webhook)',
    customerPhone: '0908112233',
    address: '88 Nguyễn Huệ, Quận 1, TP.HCM',
    items: [{ sku: 'UD-NEN-001', quantity: 2 }],
  },
}

const DELIVERY_STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  FAILED: { icon: XCircle, className: 'text-rose-600 dark:text-rose-400' },
  PENDING: { icon: Clock, className: 'text-muted-foreground' },
}

// ===== Helpers =====

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

function splitEvents(events: string): string[] {
  return events === '*' ? [] : events.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Chuẩn hóa config credential (object hoặc JSON string) thành text JSON pretty cho Textarea */
function credentialConfigText(config: unknown): string {
  if (typeof config === 'string' && config.trim()) {
    try {
      const parsed: unknown = JSON.parse(config)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed, null, 2)
      }
      return config
    } catch {
      return config
    }
  }
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    return JSON.stringify(config, null, 2)
  }
  return '{}'
}

// ===== Component =====

export function IntegrationsView() {
  const { toast } = useToast()

  const [data, setData] = useState<IntegrationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), [])

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: `Đã sao chép ${label}` })
      } catch {
        toast({ title: 'Không thể sao chép', description: 'Trình duyệt chặn clipboard.', variant: 'destructive' })
      }
    },
    [toast]
  )

  // ===== Load toàn bộ dữ liệu tích hợp =====
  const fetchIntegrations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<IntegrationsData>('/api/integrations')
      setData(res)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [refreshKey])

  useEffect(() => {
    void fetchIntegrations()
  }, [fetchIntegrations])

  // ===== API Keys =====
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyCreating, setKeyCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<{ key: string; secret: string } | null>(null)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({})
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)
  const [keyDeleting, setKeyDeleting] = useState(false)
  const [fanpageTestOpen, setFanpageTestOpen] = useState(false)

  const submitCreateKey = async () => {
    if (!keyName.trim()) {
      toast({ title: 'Vui lòng nhập tên API key', variant: 'destructive' })
      return
    }
    setKeyCreating(true)
    try {
      const res = await apiPost<{ apiKey: ApiKeyItem }>('/api/integrations/api-keys', {
        name: keyName.trim(),
      })
      toast({ title: 'Đã tạo API key', description: 'Sao chép key và secret ngay — chỉ hiển thị một lần.' })
      setCreatedKey({ key: res.apiKey.key, secret: res.apiKey.secret })
      setCreateKeyOpen(false)
      setKeyName('')
      refetch()
    } catch (err) {
      toast({ title: 'Không thể tạo API key', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setKeyCreating(false)
    }
  }

  const submitDeleteKey = async () => {
    if (!deleteKeyId) return
    setKeyDeleting(true)
    try {
      await apiDelete(`/api/integrations/api-keys?id=${deleteKeyId}`)
      toast({ title: 'Đã thu hồi API key' })
      setDeleteKeyId(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể thu hồi API key', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setKeyDeleting(false)
    }
  }

  // ===== Webhooks =====
  const [addWebhookOpen, setAddWebhookOpen] = useState(false)
  const [webhookName, setWebhookName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['*'])
  const [webhookCreating, setWebhookCreating] = useState(false)
  const [testEvent, setTestEvent] = useState<Record<string, string>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deleteWebhookId, setDeleteWebhookId] = useState<string | null>(null)
  const [webhookDeleting, setWebhookDeleting] = useState(false)

  const openAddWebhook = () => {
    setWebhookName('')
    setWebhookUrl('')
    setWebhookSecret('')
    setWebhookEvents(['*'])
    setAddWebhookOpen(true)
  }

  const toggleWebhookEvent = (event: string, checked: boolean | 'indeterminate') => {
    setWebhookEvents((prev) => {
      if (event === '*') {
        return checked ? ['*'] : prev.filter((e) => e !== '*')
      }
      const withoutAll = prev.filter((e) => e !== '*')
      if (checked) return [...withoutAll, event]
      return withoutAll.filter((e) => e !== event)
    })
  }

  const submitCreateWebhook = async () => {
    if (!webhookName.trim()) {
      toast({ title: 'Vui lòng nhập tên webhook', variant: 'destructive' })
      return
    }
    if (!/^https?:\/\//i.test(webhookUrl.trim())) {
      toast({ title: 'URL không hợp lệ', description: 'URL phải bắt đầu bằng http:// hoặc https://', variant: 'destructive' })
      return
    }
    setWebhookCreating(true)
    try {
      await apiPost<{ webhook: WebhookEndpointItem }>('/api/integrations/webhooks', {
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        secret: webhookSecret.trim() || undefined,
        events: webhookEvents.includes('*') || webhookEvents.length === 0 ? '*' : webhookEvents.join(','),
      })
      toast({ title: 'Đã thêm webhook', description: 'Hệ thống sẽ gửi sự kiện tới endpoint này.' })
      setAddWebhookOpen(false)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể thêm webhook', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setWebhookCreating(false)
    }
  }

  const toggleWebhookActive = async (endpoint: WebhookEndpointItem, active: boolean) => {
    try {
      await apiPatch<{ webhook: WebhookEndpointItem }>(`/api/integrations/webhooks?id=${endpoint.id}`, { active })
      toast({ title: active ? `Đã bật «${endpoint.name}»` : `Đã tắt «${endpoint.name}»` })
      refetch()
    } catch (err) {
      toast({ title: 'Không thể cập nhật webhook', description: errorMessage(err), variant: 'destructive' })
    }
  }

  const runWebhookTest = async (endpoint: WebhookEndpointItem) => {
    const available = endpoint.events === '*' ? (data?.events ?? []) : splitEvents(endpoint.events)
    const event = testEvent[endpoint.id] ?? available[0] ?? DEFAULT_EVENT
    setTestingId(endpoint.id)
    try {
      const res = await apiPost<{
        status: string
        responseCode: number | null
        error: string | null
        event: string
      }>('/api/integrations/webhooks/test', { id: endpoint.id, event })
      if (res.status === 'SUCCESS') {
        toast({
          title: `Test OK — HTTP ${res.responseCode ?? '?'}`,
          description: `Sự kiện ${res.event} đã được gửi tới ${endpoint.name}.`,
        })
      } else {
        toast({
          title: `Test FAILED${res.responseCode != null ? ` — HTTP ${res.responseCode}` : ''}`,
          description: res.error ?? 'Endpoint không phản hồi thành công.',
          variant: 'destructive',
        })
      }
      refetch()
    } catch (err) {
      toast({ title: 'Không thể gửi test', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setTestingId(null)
    }
  }

  const submitDeleteWebhook = async () => {
    if (!deleteWebhookId) return
    setWebhookDeleting(true)
    try {
      await apiDelete(`/api/integrations/webhooks?id=${deleteWebhookId}`)
      toast({ title: 'Đã xóa webhook' })
      setDeleteWebhookId(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể xóa webhook', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setWebhookDeleting(false)
    }
  }

  // ===== Credentials =====
  const [credProvider, setCredProvider] = useState<string | null>(null)
  const [credText, setCredText] = useState('{}')
  const [credActive, setCredActive] = useState(true)
  const [credSaving, setCredSaving] = useState(false)
  const [testingCred, setTestingCred] = useState<string | null>(null)
  const [testingAllCreds, setTestingAllCreds] = useState(false)
  const [credTestResults, setCredTestResults] = useState<Record<string, { ok: boolean; latencyMs: number }>>({})
  const [credCategoryFilter, setCredCategoryFilter] = useState<'ALL' | ProviderConfigSpec['category']>('ALL')
  const [credSearchQuery, setCredSearchQuery] = useState('')

  // ===== Inbound Webhook Simulator =====
  const [simInboundEvent, setSimInboundEvent] = useState<string>('INBOUND_SEPAY_TRANSACTION')
  const [simInboundLoading, setSimInboundLoading] = useState(false)
  const [simInboundResult, setSimInboundResult] = useState<Record<string, unknown> | null>(null)

  const testCredentialConnection = async (provider: string) => {
    setTestingCred(provider)
    try {
      const res = await apiPost<{
        ok: boolean
        provider: string
        label: string
        latencyMs: number
        message: string
      }>('/api/integrations/credentials/test', { provider })
      setCredTestResults((prev) => ({
        ...prev,
        [provider]: { ok: res.ok, latencyMs: res.latencyMs },
      }))
      toast({
        title: `Kết nối ${res.provider} thành công (${res.latencyMs}ms)`,
        description: res.message,
      })
    } catch (err) {
      setCredTestResults((prev) => ({
        ...prev,
        [provider]: { ok: false, latencyMs: 0 },
      }))
      toast({
        title: `Kiểm tra kết nối ${provider} thất bại`,
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setTestingCred(null)
    }
  }

  const testAllCredentialConnections = async () => {
    const list = data?.credentials ?? []
    if (list.length === 0) return
    setTestingAllCreds(true)
    try {
      let passCount = 0
      const nextMap: Record<string, { ok: boolean; latencyMs: number }> = {}
      await Promise.all(
        list.map(async (item) => {
          try {
            const res = await apiPost<{ ok: boolean; latencyMs: number }>(
              '/api/integrations/credentials/test',
              { provider: item.provider }
            )
            nextMap[item.provider] = { ok: res.ok, latencyMs: res.latencyMs }
            if (res.ok) passCount += 1
          } catch {
            nextMap[item.provider] = { ok: false, latencyMs: 0 }
          }
        })
      )
      setCredTestResults((prev) => ({ ...prev, ...nextMap }))
      toast({
        title: `Đã kiểm tra ${passCount}/${list.length} đối tác sẵn sàng`,
        description: 'Toàn bộ khóa xác thực đối tác đã được kiểm tra phản hồi.',
      })
    } finally {
      setTestingAllCreds(false)
    }
  }

  const runInboundSimulation = async (eventKey?: string) => {
    const targetEvent = eventKey ?? simInboundEvent
    setSimInboundLoading(true)
    try {
      const presetData = INBOUND_SIMULATOR_PRESETS[targetEvent] ?? {}
      const res = await apiPost<Record<string, unknown>>('/api/integrations/webhooks/test', {
        mode: 'INBOUND_SIMULATE',
        event: targetEvent,
        data: presetData,
      })
      setSimInboundResult(res)
      if (res.ok) {
        toast({
          title: `Inbound ${targetEvent} — HTTP ${String(res.status ?? 200)} OK`,
          description: 'Hệ thống đã xác thực chữ ký HMAC-SHA256 và xử lý sự kiện thành công.',
        })
      } else {
        toast({
          title: `Inbound ${targetEvent} trả lỗi`,
          description: JSON.stringify(res.response ?? {}),
          variant: 'destructive',
        })
      }
      refetch()
    } catch (err) {
      toast({
        title: 'Không thể chạy giả lập Inbound',
        description: errorMessage(err),
        variant: 'destructive',
      })
    } finally {
      setSimInboundLoading(false)
    }
  }

  const credentialInEdit = useMemo(
    () => data?.credentials.find((c) => c.provider === credProvider) ?? null,
    [data, credProvider]
  )

  const parsedCredObj = useMemo<Record<string, unknown>>(() => {
    try {
      const parsed: unknown = JSON.parse(credText)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // ignore invalid JSON while typing raw text
    }
    return {}
  }, [credText])

  const updateCredFieldValue = (fieldKey: string, value: string) => {
    const nextObj: Record<string, unknown> = { ...parsedCredObj, [fieldKey]: value }
    setCredText(JSON.stringify(nextObj, null, 2))
  }

  const openCredential = (credential: CredentialItem) => {
    setCredProvider(credential.provider)
    setCredText(
      credential.config == null
        ? (CREDENTIAL_PLACEHOLDERS[credential.provider] ?? '{}')
        : credentialConfigText(credential.config)
    )
    setCredActive(credential.config != null ? credential.active : true)
  }

  const openCredentialByProvider = (providerKey: string) => {
    const found = data?.credentials.find((c) => c.provider === providerKey)
    if (found) {
      openCredential(found)
    }
  }

  const submitCredential = async () => {
    if (!credProvider || !credentialInEdit) return
    let config: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(credText)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config phải là JSON object')
      }
      config = parsed as Record<string, unknown>
    } catch {
      toast({ title: 'JSON cấu hình không hợp lệ', variant: 'destructive' })
      return
    }
    setCredSaving(true)
    try {
      await apiPost<{ credential: unknown }>('/api/integrations/credentials', {
        provider: credProvider,
        name: credentialInEdit.name,
        config,
        active: credActive,
      })
      toast({ title: `Đã lưu credential ${credProvider}`, description: 'Cấu hình được ghi vào Sổ Data.' })
      setCredProvider(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể lưu credential', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setCredSaving(false)
    }
  }

  // ===== Derived =====
  const apiKeys = data?.apiKeys ?? []
  const webhooks = data?.webhooks ?? []
  const credentials = data?.credentials ?? []
  const events = data?.events ?? []
  const activeEndpoints = webhooks.filter((w) => w.active).length

  return (
    <div>
      <PageHeader
        title="API & Webhook"
        description="Tích hợp hai chiều với hệ thống ngoài — API key, webhook sự kiện và credentials đối tác"
      />

      {/* Stats hàng đầu */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Endpoint đang bật"
          value={loading ? '' : formatNumber(activeEndpoints)}
          icon={Webhook}
          loading={loading}
          hint={`${formatNumber(webhooks.length)} endpoint đã đăng ký`}
        />
        <StatCard
          title="API key hoạt động"
          value={loading ? '' : formatNumber(data?.stats.keysActive ?? 0)}
          icon={KeyRound}
          loading={loading}
          hint={`${formatNumber(apiKeys.length)} key đã tạo`}
        />
        <StatCard
          title="Gửi thành công"
          value={loading ? '' : formatNumber(data?.stats.deliveriesSuccess ?? 0)}
          icon={CheckCircle2}
          loading={loading}
          iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        />
        <StatCard
          title="Gửi lỗi"
          value={loading ? '' : formatNumber(data?.stats.deliveriesFailed ?? 0)}
          icon={XCircle}
          loading={loading}
          iconClassName={
            (data?.stats.deliveriesFailed ?? 0) > 0
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
              : 'bg-primary/10 text-primary'
          }
          hint={(data?.stats.deliveriesFailed ?? 0) > 0 ? 'Cần kiểm tra endpoint lỗi' : undefined}
        />
      </div>

      {loading && !data ? (
        <TableSkeleton rows={5} />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <Tabs defaultValue="keys">
          <TabsList className="mb-4">
            <TabsTrigger value="keys">API Keys</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="guide">Hướng dẫn</TabsTrigger>
          </TabsList>

          {/* ===== TAB 1: API KEYS ===== */}
          <TabsContent value="keys" className="mt-0">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">API Keys</CardTitle>
                  <CardDescription>Key để hệ thống ngoài gọi API nội bộ (header X-API-Key / X-API-Secret)</CardDescription>
                </div>
                <Button onClick={() => setCreateKeyOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Tạo API Key
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {apiKeys.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      icon={KeyRound}
                      title="Chưa có API key nào"
                      description="Tạo API key để cấp quyền truy cập API cho hệ thống ngoài."
                      action={
                        <Button onClick={() => setCreateKeyOpen(true)}>
                          <Plus className="mr-1.5 h-4 w-4" /> Tạo API Key
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">Tên</th>
                          <th className="px-4 py-2.5 font-medium">Key</th>
                          <th className="px-4 py-2.5 font-medium">Secret</th>
                          <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                          <th className="px-4 py-2.5 font-medium">Ngày tạo</th>
                          <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys.map((apiKey) => (
                          <tr key={apiKey.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5 font-medium">{apiKey.name}</td>
                            <td className="max-w-[200px] px-4 py-2.5">
                              <span className="block truncate font-mono text-xs" title={apiKey.key}>
                                {apiKey.key}
                              </span>
                            </td>
                            <td className="max-w-[160px] px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="block truncate font-mono text-xs" title={apiKey.secret}>
                                  {revealedSecrets[apiKey.id] ? apiKey.secret : '••••••••••••'}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() =>
                                    setRevealedSecrets((prev) => ({ ...prev, [apiKey.id]: !prev[apiKey.id] }))
                                  }
                                  aria-label={revealedSecrets[apiKey.id] ? 'Ẩn secret' : 'Hiện secret'}
                                >
                                  {revealedSecrets[apiKey.id] ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {apiKey.active ? (
                                <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                  Hoạt động
                                </Badge>
                              ) : (
                                <Badge variant="outline">Đã thu hồi</Badge>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                              {formatDate(apiKey.createdAt)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteKeyId(apiKey.id)}
                                aria-label="Thu hồi API key"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB 2: WEBHOOKS ===== */}
          <TabsContent value="webhooks" className="mt-0">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {formatNumber(webhooks.length)} endpoint nhận sự kiện realtime từ hệ thống
              </p>
              <Button onClick={openAddWebhook}>
                <Plus className="mr-1.5 h-4 w-4" /> Thêm webhook
              </Button>
            </div>

            {webhooks.length === 0 ? (
              <EmptyState
                icon={Webhook}
                title="Chưa có webhook nào"
                description="Đăng ký endpoint để nhận sự kiện order.*, invoice.*, stock.movement tự động."
                action={
                  <Button onClick={openAddWebhook}>
                    <Plus className="mr-1.5 h-4 w-4" /> Thêm webhook
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {webhooks.map((endpoint) => {
                  const isAll = endpoint.events === '*'
                  const endpointEvents = isAll ? [] : splitEvents(endpoint.events)
                  const available = isAll ? events : endpointEvents
                  const selectedTest = testEvent[endpoint.id] ?? available[0] ?? DEFAULT_EVENT
                  return (
                    <Card key={endpoint.id} className="shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CardTitle className="flex items-center gap-2 text-base">
                              {endpoint.name}
                              {!endpoint.active && <Badge variant="outline">Tắt</Badge>}
                            </CardTitle>
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              <span className="block max-w-[280px] truncate font-mono text-xs" title={endpoint.url}>
                                {endpoint.url}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                onClick={() => void copyText(endpoint.url, 'URL')}
                                aria-label="Sao chép URL"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </CardDescription>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Switch
                              checked={endpoint.active}
                              onCheckedChange={(checked) => void toggleWebhookActive(endpoint, checked)}
                              aria-label="Bật/tắt webhook"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteWebhookId(endpoint.id)}
                              aria-label="Xóa webhook"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {isAll ? (
                            <Badge className="border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400">
                              Tất cả sự kiện (*)
                            </Badge>
                          ) : (
                            endpointEvents.map((ev) => (
                              <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                                {ev}
                              </Badge>
                            ))
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* 5 delivery gần nhất */}
                        {endpoint.deliveries.length > 0 ? (
                          <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md border bg-muted/30 p-2">
                            {endpoint.deliveries.map((delivery) => {
                              const style =
                                DELIVERY_STATUS_STYLES[delivery.status] ?? DELIVERY_STATUS_STYLES.PENDING
                              const Icon = style.icon
                              return (
                                <div key={delivery.id} className="flex items-center gap-2 text-xs">
                                  <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} />
                                  <span className="min-w-0 flex-1 truncate font-mono">{delivery.event}</span>
                                  {delivery.responseCode != null && (
                                    <span className="shrink-0 font-mono text-muted-foreground">
                                      HTTP {delivery.responseCode}
                                    </span>
                                  )}
                                  <span className="shrink-0 text-muted-foreground">
                                    {formatDateTime(delivery.createdAt)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
                            Chưa có lần gửi nào
                          </p>
                        )}

                        {/* Gửi test */}
                        <div className="flex gap-2">
                          <Select
                            value={selectedTest}
                            onValueChange={(v) => setTestEvent((prev) => ({ ...prev, [endpoint.id]: v }))}
                          >
                            <SelectTrigger className="h-9 flex-1 font-mono text-xs" aria-label="Chọn sự kiện test">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((ev) => (
                                <SelectItem key={ev} value={ev}>
                                  {ev}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-9"
                            disabled={testingId === endpoint.id}
                            onClick={() => void runWebhookTest(endpoint)}
                          >
                            {testingId === endpoint.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="mr-1 h-4 w-4" />
                            )}
                            Gửi test
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ===== TAB 3: CREDENTIALS ===== */}
          <TabsContent value="credentials" className="mt-0 space-y-6">
            <div className="rounded-lg border bg-muted/30 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    Trung tâm Cấu hình Key Đối tác (Zalo, Đăng bài Social 7 Kênh, Sàn TMĐT, Website, Vận chuyển, SePay/VietQR &amp; AI)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Bấm <strong>Cấu hình &amp; Hướng dẫn</strong> ở từng thẻ để xem từng bước lấy Key và nhập theo biểu mẫu có sẵn, sau đó bấm <strong>Kiểm tra</strong> để xác thực kết nối.
                  </p>
                </div>
                <Badge variant="secondary" className="font-mono text-xs">
                  {credentials.filter((c) => c.config !== null && c.config !== undefined).length}/{credentials.length} đã cấu hình
                </Badge>
              </div>

              {/* Khối nổi bật: SePay VietQR & 3 Cách Kết Nối Đăng Bài Social */}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/25">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                        SePay — Tự động xác nhận chuyển khoản Ngân hàng &amp; VietQR (sepay.vn)
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Nhận biến động số dư MBBank / VCB / ACB / BIDV qua Webhook, tự bóc tách mã đơn <code className="font-mono">DH...</code> và gạch nợ <code className="font-mono">PAID</code> trong 1–3s.
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-emerald-300 bg-background text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        onClick={() => openCredentialByProvider('SEPAY')}
                      >
                        Cấu hình SePay
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                        disabled={simInboundLoading}
                        onClick={() => void runInboundSimulation('INBOUND_SEPAY_TRANSACTION')}
                      >
                        {simInboundLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                        Test nhận +390k
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-900/60 dark:bg-sky-950/25">
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-sky-900 dark:text-sky-300">
                      3 Cách Kết Nối Để Đăng Bài Tự Động Lên 7 Kênh Social (Auto Social)
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 bg-background text-xs"
                        onClick={() => {
                          setCredCategoryFilter('SOCIAL_PUBLISH')
                          openCredentialByProvider('INSTAGRAM')
                        }}
                      >
                        Cách 1: Official API (FB/IG/Threads/TikTok)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 border-sky-300 bg-background text-xs font-semibold text-sky-700"
                        onClick={() => openCredentialByProvider('SOCIAL_WEBHOOK_HUB')}
                      >
                        Cách 2: Make.com / n8n Bridge
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 bg-background text-xs"
                        onClick={() => openCredentialByProvider('EXTERNAL_CMS')}
                      >
                        Cách 3: WordPress / Haravan API
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 bg-[#1877F2] text-xs font-semibold text-white hover:bg-[#166FE5]"
                        onClick={() => setFanpageTestOpen(true)}
                      >
                        <Send className="mr-1 h-3 w-3" /> Đăng bài Test Fanpage ngay
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Thanh tìm kiếm nhanh + Kiểm tra đồng loạt 20 đối tác + Lọc nhóm */}
              <div className="flex flex-col gap-2.5 border-t pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-1 items-center gap-2 min-w-[240px]">
                    <Input
                      value={credSearchQuery}
                      onChange={(e) => setCredSearchQuery(e.target.value)}
                      placeholder="Tìm nhanh đối tác (VD: SePay, Make.com, TikTok, Instagram, GHN, Zalo)..."
                      className="h-9 max-w-md bg-background text-xs"
                    />
                    {credSearchQuery && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => setCredSearchQuery('')}
                      >
                        Xóa lọc
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-9 gap-1.5 text-xs font-semibold"
                    disabled={testingAllCreds}
                    onClick={() => void testAllCredentialConnections()}
                  >
                    {testingAllCreds ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                    {testingAllCreds
                      ? 'Đang kiểm tra 20 đối tác...'
                      : `Kiểm tra đồng loạt (${credentials.length} đối tác)`}
                  </Button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-muted-foreground">Lọc nhóm:</span>
                  <button
                    type="button"
                    onClick={() => setCredCategoryFilter('ALL')}
                    className={cn(
                      'min-h-[34px] rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                      credCategoryFilter === 'ALL'
                        ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    Tất cả ({credentials.length})
                  </button>
                  {CREDENTIAL_CATEGORIES.map((cat) => {
                    const count = credentials.filter(
                      (c) => (PROVIDER_CONFIG_SPECS[c.provider]?.category ?? 'PAYMENT_AI') === cat.id
                    ).length
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCredCategoryFilter(cat.id)}
                        className={cn(
                          'min-h-[34px] rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
                          credCategoryFilter === cat.id
                            ? 'border-primary bg-primary text-primary-foreground shadow-2xs'
                            : 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {cat.shortLabel} ({count})
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {CREDENTIAL_CATEGORIES.filter((cat) => credCategoryFilter === 'ALL' || credCategoryFilter === cat.id).map((cat) => {
              const q = credSearchQuery.trim().toLowerCase()
              const items = credentials.filter((c) => {
                const matchCat = (PROVIDER_CONFIG_SPECS[c.provider]?.category ?? 'PAYMENT_AI') === cat.id
                if (!matchCat) return false
                if (!q) return true
                const spec = PROVIDER_CONFIG_SPECS[c.provider]
                return (
                  c.provider.toLowerCase().includes(q) ||
                  c.label.toLowerCase().includes(q) ||
                  (spec?.summary ?? '').toLowerCase().includes(q)
                )
              })
              if (items.length === 0) return null
              return (
                <div key={cat.id} className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold">{cat.title}</h3>
                    <p className="text-xs text-muted-foreground">{cat.description}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    {items.map((credential) => {
                      const configured = credential.config !== null && credential.config !== undefined
                      const spec = PROVIDER_CONFIG_SPECS[credential.provider]
                      const testInfo = credTestResults[credential.provider]
                      const cfgObj =
                        configured && typeof credential.config === 'object' && !Array.isArray(credential.config)
                          ? (credential.config as Record<string, unknown>)
                          : null
                      const configuredKeys = cfgObj
                        ? Object.keys(cfgObj).filter((k) => String(cfgObj[k] ?? '').trim() !== '')
                        : []

                      return (
                        <Card key={credential.provider} className="shadow-sm">
                          <CardContent className="flex h-full flex-col justify-between gap-3 p-4">
                            <div className="space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-semibold">{credential.label}</p>
                                    <Badge
                                      className={cn(
                                        'border-transparent',
                                        configured
                                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                                          : 'bg-muted text-muted-foreground'
                                      )}
                                    >
                                      {configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                                    </Badge>
                                    {testInfo && (
                                      <Badge
                                        variant="outline"
                                        className={cn(
                                          'font-mono text-[10px]',
                                          testInfo.ok
                                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                            : 'border-rose-300 bg-rose-50 text-rose-700'
                                        )}
                                      >
                                        {testInfo.ok ? `✓ Sẵn sàng (${testInfo.latencyMs}ms)` : '✕ Lỗi key'}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                                    {credential.provider}
                                    {credential.updatedAt ? ` · cập nhật ${formatDateTime(credential.updatedAt)}` : ''}
                                  </p>
                                </div>
                                {spec?.portalUrl && spec.portalUrl.startsWith('http') && (
                                  <a
                                    href={spec.portalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted"
                                  >
                                    Lấy key <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>

                              {spec?.summary && (
                                <p className="text-xs text-muted-foreground">{spec.summary}</p>
                              )}

                              {configuredKeys.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {configuredKeys.map((k) => (
                                    <Badge key={k} variant="outline" className="font-mono text-[10px]">
                                      {k}: ••••
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
                              {configured && (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  disabled={testingCred === credential.provider}
                                  onClick={() => void testCredentialConnection(credential.provider)}
                                >
                                  {testingCred === credential.provider ? (
                                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                                  )}
                                  Kiểm tra
                                </Button>
                              )}
                              <Button variant="outline" size="sm" onClick={() => openCredential(credential)}>
                                Cấu hình &amp; Hướng dẫn
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </TabsContent>

          {/* ===== TAB 4: HƯỚNG DẪN ===== */}
          <TabsContent value="guide" className="mt-0 space-y-4">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpCircle className="h-5 w-5 text-primary" />
                  1. Outbound — hệ thống gửi sự kiện ra ngoài
                </CardTitle>
                <CardDescription>
                  Khi dữ liệu thay đổi, hệ thống POST tới mọi webhook endpoint đang bật với payload ký sẵn.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {events.map((ev) => (
                    <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                      {ev}
                    </Badge>
                  ))}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Headers</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`Content-Type: application/json
X-Event: order.created
X-Signature: <HMAC-SHA256(toàn bộ JSON body, secret của endpoint)>`}</pre>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Ví dụ payload</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(
                    {
                      event: 'order.created',
                      sentAt: new Date().toISOString(),
                      data: {
                        id: 'clx…',
                        code: 'DH261023-8147',
                        channel: 'ZALO_OA',
                        total: 1250000,
                        customer: 'Nguyễn Văn A',
                        items: [{ sku: 'PK-DAY-001', name: 'Sản phẩm A', quantity: 2, price: 625000 }],
                      },
                    },
                    null,
                    2
                  )}</pre>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowDownCircle className="h-5 w-5 text-primary" />
                  2. Inbound — hệ thống nhận yêu cầu từ ngoài vào
                </CardTitle>
                <CardDescription>
                  Gửi POST tới <span className="font-mono">{data?.inboundUrl ?? '/api/webhooks/inbound'}</span> với chữ ký
                  HMAC-SHA256 lấy secret từ credential <span className="font-mono">PAYOS.webhookSecret</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="mb-1 text-sm font-medium">Headers</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`Content-Type: application/json
X-Signature: <HMAC-SHA256(raw body, credential PAYOS.webhookSecret)>`}</pre>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Sự kiện hỗ trợ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      'INBOUND_SEPAY_TRANSACTION',
                      'INBOUND_PING',
                      'INBOUND_ORDER_CREATE',
                      'INBOUND_STOCK_UPDATE',
                      'INBOUND_ALLIANCE_STOCK_SYNC',
                      'INBOUND_VOUCHER_VALIDATE',
                      'INBOUND_SHIPMENT_UPDATE',
                      'INBOUND_ZALO_MESSAGE',
                      'INBOUND_PAYMENT_CONFIRM',
                    ].map((ev) => (
                      <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-sky-900 dark:text-sky-300">
                        Trình giả lập &amp; Kiểm thử Webhook Inbound (Auto HMAC-SHA256)
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        Tự động ký chữ ký X-Signature bằng secret đang bật và gửi thẳng vào /api/webhooks/inbound
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={simInboundEvent} onValueChange={setSimInboundEvent}>
                        <SelectTrigger className="h-8 w-56 bg-background font-mono text-xs" aria-label="Chọn sự kiện giả lập Inbound">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(INBOUND_SIMULATOR_PRESETS).map((ev) => (
                            <SelectItem key={ev} value={ev} className="font-mono text-xs">
                              {ev}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-8 bg-[#0066CC] text-xs text-white hover:bg-[#0052A3]"
                        disabled={simInboundLoading}
                        onClick={() => void runInboundSimulation()}
                      >
                        {simInboundLoading ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="mr-1 h-3.5 w-3.5" />
                        )}
                        Gửi thử Inbound
                      </Button>
                    </div>
                  </div>
                  {simInboundResult && (
                    <pre className="mt-2.5 max-h-40 overflow-auto rounded border bg-background p-2 font-mono text-[11px]">
                      {JSON.stringify(simInboundResult, null, 2)}
                    </pre>
                  )}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Ví dụ body từng sự kiện</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`{ "event": "INBOUND_PING" }

{ "event": "INBOUND_ORDER_CREATE",
  "data": {
    "channelKey": "WEBSITE",
    "customerName": "Nguyễn Văn A",
    "customerPhone": "0901234567",
    "address": "12 Nguyễn Trãi, Q1, TP.HCM",
    "items": [{ "productId": "<id sản phẩm>", "quantity": 1 }]
  } }

{ "event": "INBOUND_STOCK_UPDATE",
  "data": { "productId": "<id sản phẩm>", "delta": 10, "note": "Nhập hàng từ nhà máy" } }

{ "event": "INBOUND_SHIPMENT_UPDATE",
  "data": { "trackingCode": "GHN261025123456", "status": "DELIVERED", "codStatus": "RECEIVED" } }

{ "event": "INBOUND_ZALO_MESSAGE",
  "data": { "customerName": "Chị Lan", "customerPhone": "0909123456", "channelKey": "ZALO_OA", "content": "Shop còn nến bơ không ạ?" } }

{ "event": "INBOUND_PAYMENT_CONFIRM",
  "data": { "orderCode": "DH261025-1234", "amount": 219000, "reference": "FT26298123" } }`}</pre>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-5 w-5 text-primary" />
                  3. Cẩm nang lấy Key &amp; Cấu hình: Zalo, Sàn TMĐT (Shopee / TikTok / Lazada), Website &amp; Vận chuyển
                </CardTitle>
                <CardDescription>
                  Hướng dẫn từng bước lấy thông tin xác thực trên cổng đối tác và bấm cấu hình nhanh ngay tại đây.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Nhóm 1: Zalo OA / ZNS / Mini App */}
                <div className="rounded-lg border p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-[#0068FF]">
                        A. Kết nối Zalo Official Account, ZNS &amp; Zalo Mini App (ZALO_OA)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Dùng để nhận đơn từ Zalo Mini App / Chat OA và gửi thông báo ZNS tự động theo SĐT khách hàng.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href="https://developers.zalo.me/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        Zalo Developers <ExternalLink className="h-3 w-3" />
                      </a>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('ZALO_OA')}>
                        Mở Cấu hình Zalo OA
                      </Button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[600px] text-xs">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left font-medium text-muted-foreground">
                          <th className="px-2.5 py-1.5">Trường cấu hình</th>
                          <th className="px-2.5 py-1.5">Lấy ở đâu?</th>
                          <th className="px-2.5 py-1.5">Vai trò trong OPENVN CMS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        <tr>
                          <td className="px-2.5 py-1.5 font-mono font-semibold">oaId *</td>
                          <td className="px-2.5 py-1.5">oa.zalo.me/manage/oa → Quản lý → Thông tin tài khoản → OA ID</td>
                          <td className="px-2.5 py-1.5">Định danh tài khoản Zalo OA của cửa hàng</td>
                        </tr>
                        <tr>
                          <td className="px-2.5 py-1.5 font-mono font-semibold">appId</td>
                          <td className="px-2.5 py-1.5">developers.zalo.me → Chọn App → Cài đặt → Ứng dụng ID</td>
                          <td className="px-2.5 py-1.5">Liên kết ứng dụng Zalo với OA và Mini App</td>
                        </tr>
                        <tr>
                          <td className="px-2.5 py-1.5 font-mono font-semibold">oaSecret *</td>
                          <td className="px-2.5 py-1.5">developers.zalo.me → Chọn App → Cài đặt → Khóa bí mật của ứng dụng</td>
                          <td className="px-2.5 py-1.5">Ký kiểm tra chữ ký Webhook từ Zalo gửi về &amp; làm mới token</td>
                        </tr>
                        <tr>
                          <td className="px-2.5 py-1.5 font-mono font-semibold">znsToken</td>
                          <td className="px-2.5 py-1.5">developers.zalo.me → Công cụ API → OAuth Access Token (OA) / cloud.zalo.me</td>
                          <td className="px-2.5 py-1.5">Gửi tin ZNS báo xác nhận đơn, mã vận đơn &amp; tích điểm</td>
                        </tr>
                        <tr>
                          <td className="px-2.5 py-1.5 font-mono font-semibold">miniAppId</td>
                          <td className="px-2.5 py-1.5">mini.zalo.me → Chọn Zalo Mini App → Mini App ID</td>
                          <td className="px-2.5 py-1.5">Nhận đơn đặt hàng trực tiếp từ Zalo Mini App</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Nhóm 2: Sàn TMĐT Shopee, TikTok Shop, Lazada */}
                <div className="rounded-lg border p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-orange-600 dark:text-orange-400">
                        B. Kết nối Sàn TMĐT: Shopee (SHOPEE), TikTok Shop (TIKTOK_SHOP) &amp; Lazada (LAZADA)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Đồng bộ đơn hàng tự động về CMS, giữ/trừ tồn kho đa kênh tức thì và đối soát phí sàn.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('SHOPEE')}>
                        Cấu hình Shopee
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('TIKTOK_SHOP')}>
                        Cấu hình TikTok Shop
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('LAZADA')}>
                        Cấu hình Lazada
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-xs">
                    <div className="rounded border bg-muted/20 p-2.5 space-y-1">
                      <p className="font-semibold">1. Shopee Open Platform (open.shopee.com/developer-guide/718)</p>
                      <p className="text-muted-foreground">
                        Vào <strong>App Management → App List</strong> để lấy <code className="font-mono">partnerId</code> và{' '}
                        <code className="font-mono">partnerKey</code>. Bấm <strong>Authorize Shop</strong> để lấy{' '}
                        <code className="font-mono">shopId</code>, <code className="font-mono">accessToken</code>, đồng thời bật{' '}
                        <strong>PII Necessity Declaration + IP Whitelist (Guide 718)</strong> để mở khóa tên/SĐT người mua.
                      </p>
                    </div>
                    <div className="rounded border bg-muted/20 p-2.5 space-y-1">
                      <p className="font-semibold">2. TikTok Shop Partner (partner.tiktokshop.com)</p>
                      <p className="text-muted-foreground">
                        Vào <strong>App &amp; Service</strong> để lấy <code className="font-mono">appKey</code> và{' '}
                        <code className="font-mono">appSecret</code>. Ủy quyền gian hàng để nhận{' '}
                        <code className="font-mono">shopId</code>, <code className="font-mono">shopCipher</code> và{' '}
                        <code className="font-mono">accessToken</code>.
                      </p>
                    </div>
                    <div className="rounded border bg-muted/20 p-2.5 space-y-1">
                      <p className="font-semibold">3. Lazada Open Platform (open.lazada.com)</p>
                      <p className="text-muted-foreground">
                        Vào <strong>App Console</strong> lấy <code className="font-mono">appKey</code> và{' '}
                        <code className="font-mono">appSecret</code>. Lấy <code className="font-mono">sellerId</code> (VD:{' '}
                        <code className="font-mono">VN109283</code>) trong Lazada Seller Center.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Nhóm 3: Website Storefront & Facebook */}
                <div className="rounded-lg border p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        C. Kết nối Website Bán Hàng (WEBSITE) &amp; Facebook Fanpage (FACEBOOK)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Cấp Key cho Website (uudam.vn / WooCommerce / Next.js) gọi vào CMS và đồng bộ đơn từ Fanpage.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('WEBSITE')}>
                        Cấu hình Website
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('FACEBOOK')}>
                        Cấu hình Facebook
                      </Button>
                    </div>
                  </div>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>
                      <strong>Chiều Website gọi vào CMS (Inbound):</strong> Vào tab <strong>API Keys</strong> bấm{' '}
                      <strong>+ Tạo API Key</strong> để nhận <code className="font-mono">opvn_live_...</code> và{' '}
                      <code className="font-mono">whsec_...</code>. Đặt vào biến môi trường của Website để gọi{' '}
                      <code className="font-mono">GET /api/vouchers?code=...</code> (kiểm tra mã giảm giá) và{' '}
                      <code className="font-mono">POST /api/webhooks/inbound</code> (tạo đơn <code className="font-mono">channelKey: &quot;WEBSITE&quot;</code>).
                    </li>
                    <li>
                      <strong>Chiều CMS bắn ra Website (Outbound):</strong> Vào tab <strong>Webhooks</strong> bấm{' '}
                      <strong>+ Thêm webhook</strong> và nhập URL nhận của Website (VD:{' '}
                      <code className="font-mono">https://uudam.vn/api/openvn-sync</code>) để Website tự cập nhật giá bán và tồn kho tức thì.
                    </li>
                  </ul>
                </div>

                {/* Nhóm 4: SePay — Cổng Thanh Toán Ngân Hàng & VietQR Tự Động */}
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5 space-y-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                        D. Kết nối SePay (SEPAY) — Biến động Số dư Ngân hàng &amp; Tự động gạch nợ VietQR
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Kết nối trực tiếp tài khoản ngân hàng (MBBank, Vietcombank, ACB, BIDV, Techcombank, VPBank...) để xác nhận đơn chuyển khoản trong 1–3 giây mà không cần đối soát thủ công.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <a
                        href="https://my.sepay.vn/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded border bg-background px-2.5 py-1 text-xs font-medium hover:bg-muted"
                      >
                        my.sepay.vn <ExternalLink className="h-3 w-3" />
                      </a>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('SEPAY')}>
                        Mở Cấu hình SePay
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-xs">
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold">Bước 1: Liên kết Ngân hàng / VA</p>
                      <p className="text-muted-foreground">
                        Đăng nhập <strong>my.sepay.vn → Ngân hàng</strong>, liên kết số tài khoản nhận tiền của tiệm và khai báo <code className="font-mono">bankName</code>, <code className="font-mono">accountNumber</code>.
                      </p>
                    </div>
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold">Bước 2: Cài đặt Webhook SePay</p>
                      <p className="text-muted-foreground">
                        Vào <strong>Tích hợp Webhooks → Thêm Webhook</strong>, trỏ URL về <code className="font-mono">/api/webhooks/inbound</code>, chọn kiểu chứng thực <strong>API Key</strong> (<code className="font-mono">Authorization: Apikey ...</code>) hoặc HMAC.
                      </p>
                    </div>
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold">Bước 3: Tự động bóc tách Mã đơn</p>
                      <p className="text-muted-foreground">
                        Khi khách chuyển khoản có nội dung chứa mã đơn <code className="font-mono">DH261028-xxxx</code>, hệ thống tự động khớp số tiền và chuyển đơn sang <strong>Đã thanh toán (PAID)</strong>.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Nhóm 5: 3 Cách kết nối để đăng bài lên 7 kênh Social */}
                <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3.5 space-y-2.5 dark:border-sky-900/60 dark:bg-sky-950/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-sky-800 dark:text-sky-300">
                        E. 3 Cách Kết Nối Để Đăng Bài Tự Động Lên 7 Kênh Social (Module Auto Social &amp; Lịch AI)
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Linh hoạt chọn phương thức phù hợp nhất với từng kênh (Facebook, Instagram, TikTok, Threads, Zalo OA, Website Blog, WordPress/Haravan).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('SOCIAL_WEBHOOK_HUB')}>
                        Cấu hình Make/n8n Bridge
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('INSTAGRAM')}>
                        Cấu hình Instagram
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('THREADS')}>
                        Cấu hình Threads
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('TIKTOK_CONTENT')}>
                        Cấu hình TikTok
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => openCredentialByProvider('EXTERNAL_CMS')}>
                        Cấu hình WordPress/Haravan
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3 text-xs">
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold text-primary">Cách 1: Official Graph / Open API trực tiếp</p>
                      <p className="text-muted-foreground">
                        Nhập trực tiếp <code className="font-mono">pageAccessToken</code> (Facebook), <code className="font-mono">igUserId</code> (Instagram), <code className="font-mono">threadsUserId</code> (Threads), <code className="font-mono">openId</code> (TikTok Content API v2) và <code className="font-mono">znsToken</code> (Zalo OA Article API).
                      </p>
                    </div>
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold text-emerald-700 dark:text-emerald-400">Cách 2: Make.com / n8n / Zapier Bridge (Nhanh nhất)</p>
                      <p className="text-muted-foreground">
                        Không cần xin duyệt App trên Meta/TikTok: chỉ cần tạo 1 kịch bản <strong>Custom Webhook</strong> trên Make.com hoặc n8n, dán URL vào <code className="font-mono">SOCIAL_WEBHOOK_HUB</code> để tự động đăng đồng loạt 7 kênh.
                      </p>
                    </div>
                    <div className="rounded border bg-background p-2.5 space-y-1">
                      <p className="font-semibold text-purple-700 dark:text-purple-400">Cách 3: Website Blog (/blog) &amp; WordPress / Haravan</p>
                      <p className="text-muted-foreground">
                        Bài kênh <code className="font-mono">WEBSITE</code> tự lên trang <code className="font-mono">/blog</code> nội bộ; bài kênh <code className="font-mono">EXTERNAL_CMS</code> đẩy qua WordPress Application Password (<code className="font-mono">/wp-json/wp/v2/posts</code>) hoặc Haravan.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  4. Lưu ý bảo mật
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>Không bao giờ chia sẻ secret của API key / webhook / credential ra công khai (log, screenshot, repo).</li>
                  <li>Endpoint webhook bắt buộc HTTPS; hệ thống luôn kiểm tra chữ ký X-Signature trước khi xử lý.</li>
                  <li>Với inbound, chữ ký phải tính trên đúng raw body — không parse rồi serialize lại.</li>
                  <li>Khi nghi lộ key: thu hồi ngay tại tab API Keys và tạo key mới thay thế.</li>
                  <li>PayOS cần trường <span className="font-mono">webhookSecret</span> trong credential để xác thực webhook hai chiều.</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Dialog tạo API key */}
      <Dialog
        open={createKeyOpen}
        onOpenChange={(open) => {
          if (!keyCreating) setCreateKeyOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo API Key</DialogTitle>
            <DialogDescription>Cấp key + secret để hệ thống ngoài gọi API nội bộ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="apikey-name">
              Tên key <span className="text-destructive">*</span>
            </Label>
            <Input
              id="apikey-name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="VD: Kênh Shopee, App đối tác logistics..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateKeyOpen(false)} disabled={keyCreating}>
              Hủy
            </Button>
            <Button onClick={() => void submitCreateKey()} disabled={keyCreating}>
              {keyCreating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Tạo key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog hiển thị key + secret sau khi tạo (chỉ 1 lần) */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>API key đã được tạo</DialogTitle>
            <DialogDescription className="font-medium text-destructive">
              Chỉ hiển thị một lần — hãy sao chép ngay và lưu ở nơi an toàn.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">API Key</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdKey?.key}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => void copyText(createdKey?.key ?? '', 'API key')}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">API Secret</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdKey?.secret}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => void copyText(createdKey?.secret ?? '', 'secret')}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog thêm webhook */}
      <Dialog
        open={addWebhookOpen}
        onOpenChange={(open) => {
          if (!webhookCreating) setAddWebhookOpen(open)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm webhook</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ POST payload ký HMAC-SHA256 tới endpoint này mỗi khi có sự kiện.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-name">
                Tên <span className="text-destructive">*</span>
              </Label>
              <Input
                id="webhook-name"
                value={webhookName}
                onChange={(e) => setWebhookName(e.target.value)}
                placeholder="VD: Endpoint đối tác logistics"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">
                URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhooks/omnisales"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-secret">Secret (trống = tự sinh)</Label>
              <Input
                id="webhook-secret"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Để trống để hệ thống sinh secret ngẫu nhiên"
              />
            </div>
            <div className="space-y-2">
              <Label>Sự kiện nhận</Label>
              <label className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={webhookEvents.includes('*')}
                  onCheckedChange={(checked) => toggleWebhookEvent('*', checked)}
                />
                Tất cả sự kiện (*)
              </label>
              <div className="grid gap-1.5 rounded-md border p-2 sm:grid-cols-2">
                {events.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={webhookEvents.includes(ev)}
                      onCheckedChange={(checked) => toggleWebhookEvent(ev, checked)}
                      disabled={webhookEvents.includes('*')}
                    />
                    <span className="font-mono">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWebhookOpen(false)} disabled={webhookCreating}>
              Hủy
            </Button>
            <Button onClick={() => void submitCreateWebhook()} disabled={webhookCreating}>
              {webhookCreating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Thêm webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cấu hình credential */}
      <Dialog
        open={credProvider !== null}
        onOpenChange={(open) => {
          if (!credSaving && !open) setCredProvider(null)
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Cấu hình &amp; Hướng dẫn: {credentialInEdit?.label ?? credProvider}</DialogTitle>
            <DialogDescription>
              Nhà cung cấp <span className="font-mono">{credProvider}</span>
              {credentialInEdit?.updatedAt ? ` · cập nhật ${formatDateTime(credentialInEdit.updatedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {credProvider && PROVIDER_CONFIG_SPECS[credProvider] && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs space-y-2 dark:border-sky-900/60 dark:bg-sky-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-sky-900 dark:text-sky-300">
                    Hướng dẫn lấy Key — {PROVIDER_CONFIG_SPECS[credProvider].portalName}
                  </p>
                  {PROVIDER_CONFIG_SPECS[credProvider].portalUrl.startsWith('http') && (
                    <a
                      href={PROVIDER_CONFIG_SPECS[credProvider].portalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded border border-sky-300 bg-background px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-800 dark:text-sky-300"
                    >
                      Mở cổng lấy Key <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
                  {PROVIDER_CONFIG_SPECS[credProvider].steps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>
            )}

            {credProvider === 'PAYOS' && (
              <p className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                PayOS cần trường <span className="font-mono font-semibold">webhookSecret</span> trong cấu hình để nhận
                webhook hai chiều (hệ thống dùng nó để xác thực chữ ký X-Signature inbound).
              </p>
            )}

            {credProvider === 'SEPAY' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs space-y-2.5 dark:border-emerald-900/60 dark:bg-emerald-950/25">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-emerald-900 dark:text-emerald-300">
                      Thông số Webhook dán vào my.sepay.vn (Tích hợp Webhooks)
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      URL: {data?.inboundUrl ?? '/api/webhooks/inbound'} · Header: Authorization: Apikey {String(parsedCredObj.webhookSecret ?? 'whsec_sepay_uudam_2026')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-background text-xs"
                      onClick={() => void copyText(data?.inboundUrl ?? '/api/webhooks/inbound', 'SePay Webhook URL')}
                    >
                      <Copy className="mr-1 h-3 w-3" /> Copy URL
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 bg-background text-xs"
                      onClick={() =>
                        void copyText(
                          `Authorization: Apikey ${String(parsedCredObj.webhookSecret ?? 'whsec_sepay_uudam_2026')}`,
                          'Header Authorization SePay'
                        )
                      }
                    >
                      <Copy className="mr-1 h-3 w-3" /> Copy Header Apikey
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                      disabled={simInboundLoading}
                      onClick={() => void runInboundSimulation('INBOUND_SEPAY_TRANSACTION')}
                    >
                      {simInboundLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Send className="mr-1 h-3 w-3" />}
                      Giả lập nhận +390k
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-emerald-200/70 pt-2">
                  <span className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-300">
                    Chọn nhanh Ngân hàng:
                  </span>
                  {['MBBank', 'Vietcombank', 'ACB', 'BIDV', 'Techcombank', 'VPBank'].map((bank) => (
                    <button
                      key={bank}
                      type="button"
                      onClick={() => updateCredFieldValue('bankName', bank)}
                      className={cn(
                        'min-h-[28px] rounded border px-2 py-0.5 text-[11px] font-medium transition-colors',
                        String(parsedCredObj.bankName ?? '') === bank
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : 'bg-background text-foreground hover:bg-emerald-100/70'
                      )}
                    >
                      {bank}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {credProvider === 'SOCIAL_WEBHOOK_HUB' && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/60 p-3 text-xs space-y-2 dark:border-sky-900/60 dark:bg-sky-950/25">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sky-900 dark:text-sky-300">
                      Mẫu JSON Payload CMS bắn sang Make.com / n8n / Zapier khi bài viết được duyệt
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Dùng nút bên cạnh để copy cấu trúc JSON mẫu và dán vào module &quot;Custom Webhook → Determine Data Structure&quot; trên Make.com / n8n.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 bg-background text-xs font-semibold text-sky-700"
                    onClick={() =>
                      void copyText(
                        JSON.stringify(
                          {
                            event: 'social.post.publish',
                            channel: 'INSTAGRAM',
                            title: 'Tượng Thạch Cao An Nhiên Thạch — Chữa lành không gian sống',
                            content: 'Thưởng lãm nghệ thuật thạch cao thủ công tinh khiết...',
                            hashtags: '#AnNhienThach #UuDam #ThachCaoChuaLanh',
                            mediaUrls: ['https://uudam.vn/thach-cao/UD-TC-001/main.jpg'],
                            campaignCode: 'CP-THACHCAO-2026',
                            voucherCode: 'UUDAM10',
                          },
                          null,
                          2
                        ),
                        'Mẫu JSON Payload Make.com / n8n'
                      )
                    }
                  >
                    <Copy className="mr-1 h-3 w-3" /> Copy Mẫu JSON Make/n8n
                  </Button>
                </div>
              </div>
            )}

            {/* Biểu mẫu nhập nhanh từng trường */}
            {credProvider && PROVIDER_CONFIG_SPECS[credProvider]?.fields.length ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Nhập nhanh theo từng trường
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setCredText(CREDENTIAL_PLACEHOLDERS[credProvider] ?? '{}')}
                  >
                    Điền mẫu chuẩn
                  </Button>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {PROVIDER_CONFIG_SPECS[credProvider].fields.map((field) => (
                    <div key={field.key} className="space-y-1">
                      <Label htmlFor={`cred-field-${field.key}`} className="text-xs">
                        {field.label}{' '}
                        <span className="font-mono text-[10px] text-muted-foreground">({field.key})</span>
                        {field.required && <span className="ml-0.5 text-destructive">*</span>}
                      </Label>
                      <Input
                        id={`cred-field-${field.key}`}
                        className="h-8 font-mono text-xs"
                        placeholder={field.placeholder}
                        value={String(parsedCredObj[field.key] ?? '')}
                        onChange={(e) => updateCredFieldValue(field.key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="cred-config" className="text-xs">
                JSON cấu hình (Tự động đồng bộ với các ô bên trên)
              </Label>
              <Textarea
                id="cred-config"
                rows={6}
                className="font-mono text-xs"
                value={credText}
                onChange={(e) => setCredText(e.target.value)}
                placeholder={CREDENTIAL_PLACEHOLDERS[credProvider ?? ''] ?? '{}'}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Kích hoạt</p>
                <p className="text-xs text-muted-foreground">Credential tắt sẽ không được dùng trong luồng tự động.</p>
              </div>
              <Switch checked={credActive} onCheckedChange={setCredActive} aria-label="Kích hoạt credential" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredProvider(null)} disabled={credSaving}>
              Hủy
            </Button>
            <Button onClick={() => void submitCredential()} disabled={credSaving}>
              {credSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu cấu hình
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm xóa API key */}
      <ConfirmDialog
        open={deleteKeyId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteKeyId(null)
        }}
        title="Thu hồi API key này?"
        description="Mọi hệ thống ngoài đang dùng key này sẽ mất quyền truy cập ngay lập tức. Hành động không thể hoàn tác."
        confirmText="Thu hồi key"
        destructive
        loading={keyDeleting}
        onConfirm={() => void submitDeleteKey()}
      />

      {/* Confirm xóa webhook */}
      <ConfirmDialog
        open={deleteWebhookId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteWebhookId(null)
        }}
        title="Xóa webhook endpoint này?"
        description="Endpoint sẽ ngừng nhận mọi sự kiện từ hệ thống. Hành động không thể hoàn tác."
        confirmText="Xóa webhook"
        destructive
        loading={webhookDeleting}
        onConfirm={() => void submitDeleteWebhook()}
      />

      <FanpageTestPublishDialog
        open={fanpageTestOpen}
        onOpenChange={setFanpageTestOpen}
        onPublishedSuccess={() => void refetch()}
      />
    </div>
  )
}
