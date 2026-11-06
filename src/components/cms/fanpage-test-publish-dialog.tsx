'use client'

import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Globe,
  Info,
  KeyRound,
  Loader2,
  MessageCircle,
  Send,
  Share2,
  Sparkles,
  ThumbsUp,
  Webhook,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

export interface FanpageTestPublishDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPageId?: string
  initialPageAccessToken?: string
  initialBridgeWebhookUrl?: string
  onPublishedSuccess?: () => void
}

const SAMPLE_FANPAGE_POSTS = [
  {
    id: 'sp01',
    label: 'Mẫu 1: Tượng Chú Tiểu An Nhiên',
    title: 'Góc Bình Yên Giữa Ngày Bận Rộn — Bộ Tượng Thạch Cao Chú Tiểu An Nhiên',
    content:
      '🌿 Giữa nhịp sống hối hả, đôi khi chỉ cần một góc nhỏ tĩnh lặng với hương tinh dầu dịu nhẹ lan tỏa từ Bộ Tượng Thạch Cao Chú Tiểu An Nhiên.\n\n✨ Chất thạch cao mịn cao cấp giữ hương tự nhiên từ 3–6 tháng, thích hợp đặt bàn trà, bàn làm việc hoặc taplo xe hơi.\n👉 Nhắn tin ngay cho Ưu Đàm để nhận ưu đãi quà tặng tinh dầu thiên nhiên hôm nay!',
    hashtags: '#AnNhienThach #UuDam #ThachCaoThom #ChuTieuAnNhien #QuaTangChuaLanh',
    imageUrl: '/thach-cao/hot-monk-tea-pet.jpg',
    targetUrl: 'https://uudam.vn/store',
  },
  {
    id: 'sp02',
    label: 'Mẫu 2: Khuếch Tán Hoa Trà Trắng',
    title: 'Thẻ Thạch Cao Khuếch Tán Tinh Dầu Hoa Trà Trắng — Hương Thơm Tinh Khiết',
    content:
      '🤍 Từng cánh hoa trà trắng được chế tác thủ công tỉ mỉ từ thạch cao khoáng tự nhiên, thẩm thấu tinh dầu nguyên chất giúp tủ quần áo và phòng ngủ luôn thoảng hương thanh khiết.\n\n🎁 Có sẵn hộp quà sang trọng — Món quà tinh tế dành tặng người thương và đối tác.',
    hashtags: '#AnNhienThach #HoaTraTrang #ThachCaoKhuêchTan #TinhDauThienNhien #UuDamStudio',
    imageUrl: '/thach-cao/product-lotus-diffuser.jpg',
    targetUrl: 'https://uudam.vn/store',
  },
  {
    id: 'sp10',
    label: 'Mẫu 3: Nến Liên Hoa Bấc Gỗ',
    title: 'Bộ Đôi Nến Liên Hoa Bấc Gỗ — Tiếng Lách Tách Chữa Lành Đêm Thiền',
    content:
      '🕯️ Thắp một ánh nến Liên Hoa bấc gỗ, lắng nghe tiếng gỗ cháy lách tách dịu êm như bếp lửa nhỏ và tận hưởng hương gỗ đàn hương ấm áp.\n\n🌸 Kết hợp cốc thạch cao nghệ thuật tái sử dụng làm chậu sen đá hoặc hộp đựng trang sức sau khi dùng.',
    hashtags: '#NenBacGo #LienHoaThien #AnNhienThach #ChuaLanhTamHon #UuDam',
    imageUrl: '/thach-cao/product-gift-set.jpg',
    targetUrl: 'https://uudam.vn/store',
  },
]

export function FanpageTestPublishDialog({
  open,
  onOpenChange,
  initialPageId,
  initialPageAccessToken,
  initialBridgeWebhookUrl,
  onPublishedSuccess,
}: FanpageTestPublishDialogProps) {
  const { toast } = useToast()

  const [mode, setMode] = useState<'SANDBOX' | 'GRAPH_API' | 'WEBHOOK_BRIDGE'>('SANDBOX')
  const [title, setTitle] = useState(SAMPLE_FANPAGE_POSTS[0].title)
  const [content, setContent] = useState(SAMPLE_FANPAGE_POSTS[0].content)
  const [hashtags, setHashtags] = useState(SAMPLE_FANPAGE_POSTS[0].hashtags)
  const [imageUrl, setImageUrl] = useState(SAMPLE_FANPAGE_POSTS[0].imageUrl)
  const [targetUrl, setTargetUrl] = useState(SAMPLE_FANPAGE_POSTS[0].targetUrl)

  const [pageId, setPageId] = useState(initialPageId || '10889922334455')
  const [pageAccessToken, setPageAccessToken] = useState(initialPageAccessToken || '')
  const [bridgeWebhookUrl, setBridgeWebhookUrl] = useState(
    initialBridgeWebhookUrl || 'https://hook.eu2.make.com/uudam-social-router-demo'
  )
  const [saveCredentials, setSaveCredentials] = useState(true)
  const [saveToPostQueue, setSaveToPostQueue] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{
    ok: boolean
    mode?: string
    isRealPublish?: boolean
    latencyMs?: number
    externalPostId?: string
    externalPostUrl?: string
    message?: string
    error?: string
    payloadSnapshot?: Record<string, unknown>
    responseSnapshot?: Record<string, unknown>
  } | null>(null)

  // Tự động tải thông tin cấu hình FACEBOOK và SOCIAL_WEBHOOK_HUB hiện tại khi mở hộp thoại
  useEffect(() => {
    if (!open) return
    let mounted = true
    fetch('/api/integrations')
      .then((r) => r.json())
      .then((data) => {
        if (!mounted || !Array.isArray(data?.credentials)) return
        const fb = data.credentials.find((c: { provider: string }) => c.provider === 'FACEBOOK')
        const hub = data.credentials.find(
          (c: { provider: string }) => c.provider === 'SOCIAL_WEBHOOK_HUB'
        )
        if (fb?.config?.pageId) setPageId(String(fb.config.pageId))
        if (fb?.config?.pageAccessToken) setPageAccessToken(String(fb.config.pageAccessToken))
        if (hub?.config?.bridgeWebhookUrl) setBridgeWebhookUrl(String(hub.config.bridgeWebhookUrl))
      })
      .catch(() => null)
    return () => {
      mounted = false
    }
  }, [open])

  const handleApplySample = (sample: (typeof SAMPLE_FANPAGE_POSTS)[number]) => {
    setTitle(sample.title)
    setContent(sample.content)
    setHashtags(sample.hashtags)
    setImageUrl(sample.imageUrl)
    setTargetUrl(sample.targetUrl)
    setResult(null)
  }

  const handlePublishTest = async () => {
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/social/test-fanpage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          title,
          content,
          hashtags,
          imageUrl,
          targetUrl,
          pageId,
          pageAccessToken,
          bridgeWebhookUrl,
          saveCredentials,
          saveToPostQueue,
        }),
      })
      const data = await res.json()
      setResult(data)

      if (res.ok && data.ok) {
        toast({
          title: data.isRealPublish
            ? '🎉 Đã đăng bài THẬT lên Fanpage thành công!'
            : '✅ Đã chạy đăng bài Test Fanpage thành công!',
          description: data.message,
        })
        onPublishedSuccess?.()
      } else {
        toast({
          title: 'Chưa thể đăng bài lên Fanpage',
          description: data.error || 'Vui lòng kiểm tra lại cấu hình Token hoặc Webhook.',
          variant: 'destructive',
        })
      }
    } catch (err) {
      toast({
        title: 'Lỗi kết nối',
        description: err instanceof Error ? err.message : 'Không thể gọi API đăng bài test',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const isMockToken =
    !pageAccessToken ||
    pageAccessToken.startsWith('EAAG_mock_') ||
    pageAccessToken.startsWith('mock_')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#1877F2] text-xs font-bold text-white">
              f
            </span>
            <span>Đăng bài Test lên Facebook Fanpage (Test Publish Studio)</span>
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950 dark:text-blue-200">
              Hỗ trợ 3 cách đăng: Sandbox · Graph API Thật · Make/n8n Webhook
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Chọn mẫu bài viết hoặc tự soạn nội dung, xem trước giao diện hiển thị trên Facebook và bấm{' '}
            <strong>Đăng bài Test ngay</strong>.
          </DialogDescription>
        </DialogHeader>

        {/* Chọn 1 trong 3 chế độ đăng bài Test */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              setMode('SANDBOX')
              setResult(null)
            }}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
              mode === 'SANDBOX'
                ? 'border-[#0066CC] bg-blue-50/70 ring-1 ring-[#0066CC] dark:bg-blue-950/40'
                : 'border-border hover:bg-muted/50'
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0066CC]">
                <Sparkles className="h-3.5 w-3.5" />
                1. Chế độ kiểm thử (Sandbox)
              </span>
              <Badge variant="outline" className="text-[10px]">
                Khuyên dùng thử ngay
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Không cần Token. Kiểm thử toàn bộ khung bài đăng, ảnh, hashtag và ghi vào danh sách Đã Xuất Bản.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('GRAPH_API')
              setResult(null)
            }}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
              mode === 'GRAPH_API'
                ? 'border-emerald-600 bg-emerald-50/70 ring-1 ring-emerald-600 dark:bg-emerald-950/40'
                : 'border-border hover:bg-muted/50'
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                <KeyRound className="h-3.5 w-3.5" />
                2. Đăng Thật qua Graph API
              </span>
              <Badge className="bg-emerald-600 text-[10px] text-white">Live Meta API</Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Dùng Page ID + Page Access Token (`EAA...`) để đăng bài thật trực tiếp lên trang Fanpage của bạn.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setMode('WEBHOOK_BRIDGE')
              setResult(null)
            }}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
              mode === 'WEBHOOK_BRIDGE'
                ? 'border-violet-600 bg-violet-50/70 ring-1 ring-violet-600 dark:bg-violet-950/40'
                : 'border-border hover:bg-muted/50'
            )}
          >
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-violet-700 dark:text-violet-400">
                <Webhook className="h-3.5 w-3.5" />
                3. Đăng qua Make.com / n8n
              </span>
              <Badge variant="outline" className="border-violet-300 text-[10px] text-violet-700">
                Không cần duyệt App
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Bắn gói tin JSON sang kịch bản Make.com / n8n để tự động đăng lên Fanpage & Instagram.
            </p>
          </button>
        </div>

        {/* Bố cục 2 cột: Trái = Cấu hình & Soạn bài | Phải = Xem trước bài đăng Facebook Fanpage */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* CỘT TRÁI (7 phần): Cấu hình kết nối + Nội dung bài test */}
          <div className="space-y-4 lg:col-span-7">
            {/* Hộp cấu hình theo chế độ */}
            {mode === 'GRAPH_API' && (
              <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    Thông tin xác thực Facebook Fanpage (Meta Graph API v20.0)
                  </p>
                  <a
                    href="https://developers.facebook.com/tools/explorer/"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 underline hover:text-blue-800"
                  >
                    Mở Meta Graph API Explorer lấy Token <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="rounded-md border border-emerald-200/80 bg-white/90 p-2.5 text-[11px] leading-relaxed text-muted-foreground dark:bg-slate-900">
                  <p className="font-semibold text-foreground">
                    💡 Hướng dẫn lấy Token đăng thật trong 30 giây:
                  </p>
                  <ol className="ml-4 mt-1 list-decimal space-y-0.5">
                    <li>
                      Truy cập{' '}
                      <span className="font-mono text-foreground">
                        developers.facebook.com/tools/explorer
                      </span>
                      , ở mục <strong>User or Page</strong> chọn <strong>Get Page Access Token</strong>.
                    </li>
                    <li>
                      Cấp 2 quyền: <code className="rounded bg-muted px-1">pages_manage_posts</code> và{' '}
                      <code className="rounded bg-muted px-1">pages_read_engagement</code>.
                    </li>
                    <li>
                      Copy <strong>Page ID</strong> và chuỗi <strong>Access Token (bắt đầu bằng EAA...)</strong> dán vào 2 ô dưới đây:
                    </li>
                  </ol>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">Facebook Page ID</Label>
                    <Input
                      value={pageId}
                      onChange={(e) => setPageId(e.target.value)}
                      placeholder="VD: 10889922334455"
                      className="mt-1 h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Page Access Token (EAA...)</Label>
                      {isMockToken && (
                        <span className="text-[10px] font-medium text-amber-600">
                          Đang chứa Token mẫu — Hãy dán Token thật để đăng Live
                        </span>
                      )}
                    </div>
                    <Input
                      value={pageAccessToken}
                      onChange={(e) => setPageAccessToken(e.target.value)}
                      placeholder="Dán chuỗi EAA... từ Graph API Explorer vào đây"
                      className="mt-1 h-8 font-mono text-xs"
                    />
                  </div>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={saveCredentials}
                    onChange={(e) => setSaveCredentials(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-emerald-600"
                  />
                  <span>Tự động lưu Page ID &amp; Token này vào Trung tâm Cấu hình Key cho các lần đăng sau</span>
                </label>
              </div>
            )}

            {mode === 'WEBHOOK_BRIDGE' && (
              <div className="space-y-2.5 rounded-lg border border-violet-200 bg-violet-50/40 p-3.5 dark:border-violet-900 dark:bg-violet-950/20">
                <p className="text-xs font-bold text-violet-900 dark:text-violet-200">
                  Kết nối qua Webhook Make.com / n8n / Zapier (Không cần duyệt App Meta)
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Tạo 1 kịch bản trên <strong>Make.com</strong>: Module 1 là <em>Custom Webhook</em> nhận JSON từ Ưu Đàm → Module 2 là <em>Facebook Pages: Create a Post</em>. Dán URL Webhook vào ô dưới:
                </p>
                <div>
                  <Label className="text-xs">Webhook URL nhận bài (Make.com / n8n)</Label>
                  <Input
                    value={bridgeWebhookUrl}
                    onChange={(e) => setBridgeWebhookUrl(e.target.value)}
                    placeholder="https://hook.eu2.make.com/..."
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
              </div>
            )}

            {/* Chọn nhanh 3 mẫu bài viết An Nhiên Thạch */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <Label className="text-xs font-semibold">Chọn nhanh mẫu bài viết Test:</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SAMPLE_FANPAGE_POSTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleApplySample(s)}
                      className="rounded-md border border-blue-200 bg-blue-50/80 px-2 py-1 text-[11px] font-medium text-blue-800 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-200"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Tiêu đề quản lý nội bộ</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 h-8 text-xs"
                />
              </div>

              <div>
                <Label className="text-xs">Nội dung bài đăng lên Fanpage (Caption)</Label>
                <Textarea
                  rows={5}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  className="mt-1 text-xs leading-relaxed"
                />
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Hashtags</Label>
                  <Input
                    value={hashtags}
                    onChange={(e) => setHashtags(e.target.value)}
                    className="mt-1 h-8 text-xs text-[#1877F2]"
                  />
                </div>
                <div>
                  <Label className="text-xs">Đường dẫn ảnh đính kèm</Label>
                  <Input
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="mt-1 h-8 font-mono text-xs"
                  />
                </div>
              </div>

              <label className="inline-flex cursor-pointer items-center gap-2 pt-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={saveToPostQueue}
                  onChange={(e) => setSaveToPostQueue(e.target.checked)}
                  className="h-3.5 w-3.5 rounded accent-[#0066CC]"
                />
                <span>Lưu bản ghi bài test này vào danh sách Bài Viết Auto Social (trạng thái Đã xuất bản)</span>
              </label>
            </div>
          </div>

          {/* CỘT PHẢI (5 phần): Bản xem trước Facebook Fanpage trực quan */}
          <div className="space-y-3 lg:col-span-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">
                Xem trước hiển thị trên Facebook Fanpage:
              </span>
              <Badge variant="outline" className="text-[10px]">
                Chuẩn Meta Feed
              </Badge>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              {/* Header bài viết Facebook */}
              <div className="flex items-center gap-2.5 p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1877F2] font-bold text-white">
                  ƯĐ
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                    Ưu Đàm — An Nhiên Thạch Fanpage
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-slate-500">
                    <span>Vừa xong</span>
                    <span>·</span>
                    <Globe className="h-3 w-3" />
                  </p>
                </div>
              </div>

              {/* Nội dung Caption + Hashtag */}
              <div className="px-3 pb-2.5 text-xs whitespace-pre-line leading-relaxed text-slate-800 dark:text-slate-200">
                {content}
                {hashtags && (
                  <p className="mt-2 font-medium text-[#1877F2]">{hashtags}</p>
                )}
              </div>

              {/* Hình ảnh bài đăng */}
              {imageUrl && (
                <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <img
                    src={imageUrl}
                    alt="Facebook post preview"
                    className="h-full w-full object-cover"
                    onError={(e) => {
                      ;(e.target as HTMLImageElement).src =
                        '/thach-cao/hot-monk-tea-pet.jpg'
                    }}
                  />
                </div>
              )}

              {/* Thanh tương tác Like / Comment / Share */}
              <div className="grid grid-cols-3 border-t border-slate-100 px-2 py-1.5 text-center text-[11px] font-medium text-slate-600 dark:border-slate-800 dark:text-slate-400">
                <div className="flex items-center justify-center gap-1.5 rounded py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <ThumbsUp className="h-3.5 w-3.5" /> Thích
                </div>
                <div className="flex items-center justify-center gap-1.5 rounded py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <MessageCircle className="h-3.5 w-3.5" /> Bình luận
                </div>
                <div className="flex items-center justify-center gap-1.5 rounded py-1 hover:bg-slate-50 dark:hover:bg-slate-800">
                  <Share2 className="h-3.5 w-3.5" /> Chia sẻ
                </div>
              </div>
            </div>

            {/* Khung kết quả sau khi bấm Đăng Test */}
            {result && (
              <div
                className={cn(
                  'rounded-lg border p-3 text-xs',
                  result.ok
                    ? 'border-emerald-300 bg-emerald-50/90 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-100'
                    : 'border-red-300 bg-red-50/90 text-red-950 dark:border-red-800 dark:bg-red-950/50 dark:text-red-100'
                )}
              >
                <div className="flex items-start gap-2">
                  {result.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="font-bold">
                      {result.ok
                        ? `Thành công (${result.latencyMs ?? 20}ms) · Mã bài: ${result.externalPostId}`
                        : 'Chưa thể đăng bài'}
                    </p>
                    <p className="text-[11px] leading-relaxed">
                      {result.message || result.error}
                    </p>
                    {result.ok && result.externalPostUrl && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <a
                          href={result.externalPostUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-[#1877F2] px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-[#166FE5]"
                        >
                          Mở đường dẫn bài viết <ExternalLink className="h-3 w-3" />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(
                              JSON.stringify(result.payloadSnapshot ?? {}, null, 2)
                            )
                            toast({ title: 'Đã copy JSON Payload chuẩn Meta Graph API' })
                          }}
                          className="inline-flex items-center gap-1 rounded border bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Copy className="h-3 w-3" /> Copy JSON Payload
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex flex-wrap items-center justify-between gap-2 sm:justify-between">
          <div className="text-[11px] text-muted-foreground">
            Chế độ đang chọn:{' '}
            <strong className="text-foreground">
              {mode === 'SANDBOX'
                ? '1. Giả lập Sandbox (An toàn 100%)'
                : mode === 'GRAPH_API'
                  ? '2. Đăng Thật qua Facebook Graph API'
                  : '3. Đăng qua Make.com / n8n Webhook'}
            </strong>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Đóng
            </Button>
            <Button
              size="sm"
              disabled={submitting || !content.trim()}
              onClick={() => void handlePublishTest()}
              className="bg-[#1877F2] text-white hover:bg-[#166FE5]"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Đang gửi lên Fanpage...
                </>
              ) : (
                <>
                  <Send className="mr-1.5 h-4 w-4" />
                  {mode === 'SANDBOX'
                    ? 'Đăng bài Test ngay (Sandbox)'
                    : mode === 'GRAPH_API'
                      ? 'Đăng Thật lên Fanpage ngay'
                      : 'Bắn bài Test qua Webhook'}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
