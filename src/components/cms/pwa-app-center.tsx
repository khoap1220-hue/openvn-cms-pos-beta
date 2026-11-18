'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  Download,
  ExternalLink,
  MessageSquare,
  MonitorSmartphone,
  Package,
  Share,
  ShoppingBag,
  Smartphone,
  Store,
  Trash2,
  Unlink,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import { timeAgo } from '@/lib/format'
import {
  type AppNotificationItem,
  type NotificationCategory,
  resolveSubpathAssetUrl,
  usePwaAppCenter,
} from '@/lib/pwa-notifications'
import { cn } from '@/lib/utils'

const CATEGORY_META: Record<
  NotificationCategory,
  { label: string; desc: string; icon: typeof ShoppingBag; colorClass: string }
> = {
  orders: {
    label: 'Đơn hàng mới & Quầy POS',
    desc: 'Chuông báo tức thì khi có đơn Shopee, TikTok, Website hoặc thanh toán tại kho',
    icon: ShoppingBag,
    colorClass: 'text-[#0066CC] bg-sky-50 border-sky-200 dark:bg-sky-950/50 dark:border-sky-900 dark:text-sky-300',
  },
  inventory: {
    label: 'Cảnh báo Tồn kho Thật CMS',
    desc: 'Báo ngay khi SKU chạm ngưỡng sắp hết hoặc phát sinh bán âm kho thật',
    icon: Package,
    colorClass: 'text-rose-600 bg-rose-50 border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 dark:text-rose-300',
  },
  channels: {
    label: 'Phiên Cookie & Đồng bộ Sàn',
    desc: 'Cảnh báo mất phiên Shopee, đứt liên kết Model ID hoặc hàng đợi bất đồng bộ',
    icon: Unlink,
    colorClass:
      'text-amber-700 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:border-amber-900 dark:text-amber-300',
  },
  inbox: {
    label: 'Tin nhắn Khách hàng & Đánh giá',
    desc: 'Thông báo tin nhắn Zalo OA / Chat Sàn chưa đọc và đánh giá mới từ người mua',
    icon: MessageSquare,
    colorClass:
      'text-emerald-700 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:border-emerald-900 dark:text-emerald-300',
  },
  system: {
    label: 'Hệ thống & Kiểm tra chuông',
    desc: 'Thông báo trạng thái kết nối, sao lưu và kiểm tra chuông đẩy',
    icon: BellRing,
    colorClass:
      'text-indigo-700 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/50 dark:border-indigo-900 dark:text-indigo-300',
  },
}

export interface PwaHeaderControlsProps {
  variant?: 'cms' | 'pos'
  onNavigateView?: (view: string) => void
  onModalOpen?: () => void
  externalOpenRequest?: { nonce: number; panel: 'notifications' | 'install' } | null
}

export function PwaHeaderControls({
  variant = 'cms',
  onNavigateView,
  onModalOpen,
  externalOpenRequest,
}: PwaHeaderControlsProps) {
  const router = useRouter()
  const { toast } = useToast()
  const pwa = usePwaAppCenter()
  const [activePanel, setActivePanel] = useState<'none' | 'notifications' | 'install'>('none')
  const [showSettingsInline, setShowSettingsInline] = useState(false)
  const [testingPush, setTestingPush] = useState(false)

  useEffect(() => {
    const closeHandler = () => setActivePanel('none')
    window.addEventListener('openvn:close-pos-dialogs', closeHandler)
    return () => window.removeEventListener('openvn:close-pos-dialogs', closeHandler)
  }, [])

  useEffect(() => {
    if (!externalOpenRequest) return
    const timer = setTimeout(() => {
      setActivePanel(externalOpenRequest.panel)
    }, 0)
    return () => clearTimeout(timer)
  }, [externalOpenRequest])

  const openSinglePanel = useCallback(
    (panel: 'notifications' | 'install') => {
      if (variant === 'pos' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('openvn:close-pos-dialogs'))
      }
      onModalOpen?.()
      setActivePanel(panel)
    },
    [onModalOpen, variant]
  )

  const handleNativeInstallConfirm = async () => {
    if (!pwa.canPromptInstall) return
    const outcome = await pwa.promptInstall()
    if (outcome === 'accepted') {
      setActivePanel('none')
      toast({
        title: 'Đã cài đặt ứng dụng OPENVN POS',
        description: 'Biểu tượng ứng dụng đã được thêm vào màn hình chính / thanh tác vụ của thiết bị.',
      })
    }
  }

  const handleEnableOsPush = async () => {
    const res = await pwa.requestPermission()
    if (res === 'granted') {
      toast({
        title: 'Đã bật Thông báo Đẩy như App',
        description: 'Thiết bị sẽ hiển thị thông báo nổi và phát chuông ngay khi có đơn hàng hoặc cảnh báo kho.',
      })
    } else if (res === 'denied') {
      toast({
        title: 'Quyền thông báo đang bị chặn trên trình duyệt',
        description: 'Hãy bấm vào biểu tượng ổ khóa trên thanh địa chỉ trình duyệt và chọn "Cho phép Thông báo".',
        variant: 'destructive',
      })
    }
  }

  const handleTestNotification = async () => {
    setTestingPush(true)
    try {
      const res = await pwa.sendTestNotification()
      toast({
        title: res.osDelivered
          ? 'Đã gửi Thông báo Hệ điều hành & Âm báo!'
          : 'Đã phát chuông & ghi nhận Thông báo thử nghiệm',
        description: res.osDelivered
          ? 'Kiểm tra góc màn hình / Trung tâm thông báo của điện thoại hoặc máy tính.'
          : 'Bấm "Bật thông báo đẩy" để nhận thêm hộp thoại nổi ngoài màn hình nền.',
      })
    } finally {
      setTestingPush(false)
    }
  }

  const handleSelectNotification = (item: AppNotificationItem) => {
    pwa.markRead(item.id)
    setActivePanel('none')
    if (item.view && onNavigateView) {
      onNavigateView(item.view)
      return
    }
    if (item.targetUrl) {
      router.push(item.targetUrl)
    }
  }

  const isPos = variant === 'pos'

  return (
    <>
      {/* Nút Cài đặt như App (PWA Install) */}
      {!pwa.isStandalone ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openSinglePanel('install')}
          aria-label="Cài đặt OPENVN như ứng dụng trên thiết bị"
          title="Cài đặt OPENVN như App ra Màn hình chính / Máy tính"
          className={cn(
            'h-10 min-w-10 shrink-0 gap-1.5 px-2.5 text-xs font-semibold',
            isPos
              ? 'border-sky-400/40 bg-sky-500/20 text-white hover:bg-sky-500/30 hover:text-white'
              : 'border-sky-200 bg-sky-50/80 text-[#0066CC] hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300'
          )}
        >
          <Download className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden xl:inline">Cài App</span>
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => openSinglePanel('install')}
          aria-label="Đang chạy ở chế độ App độc lập"
          title="Đang chạy ở chế độ Ứng dụng độc lập (PWA)"
          className={cn(
            'hidden h-10 min-w-10 shrink-0 gap-1.5 px-2.5 text-xs font-semibold 2xl:inline-flex',
            isPos
              ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 hover:text-white'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
          )}
        >
          <Smartphone className="h-3.5 w-3.5 shrink-0" />
          <span>App Độc lập</span>
        </Button>
      )}

      {/* Nút Chuông Thông báo Thời gian thực */}
      <Button
        type="button"
        variant={isPos ? 'outline' : 'ghost'}
        size="icon"
        onClick={() => openSinglePanel('notifications')}
        aria-label={
          pwa.unreadCount > 0
            ? `Trung tâm thông báo (${pwa.unreadCount} chưa đọc)`
            : 'Trung tâm thông báo & cài đặt chuông báo'
        }
        title="Thông báo đơn hàng, tồn kho & chuông báo như App"
        className={cn(
          'relative h-10 w-10 shrink-0',
          isPos && 'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white'
        )}
      >
        {pwa.permission === 'granted' && pwa.prefs.osPushEnabled ? (
          <BellRing className="h-[1.15rem] w-[1.15rem]" />
        ) : (
          <Bell className="h-[1.15rem] w-[1.15rem]" />
        )}
        {pwa.unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-background">
            {pwa.unreadCount > 99 ? '99+' : pwa.unreadCount}
          </span>
        )}
      </Button>

      {/* Hộp thoại 1: Trung tâm Thông báo & Chuông báo như App */}
      <Dialog
        open={activePanel === 'notifications'}
        onOpenChange={(open) => setActivePanel(open ? 'notifications' : 'none')}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <BellRing className="h-4 w-4 text-[#0066CC]" />
              Trung tâm Thông báo &amp; Chuông báo như App
            </DialogTitle>
            <DialogDescription>
              Nhận thông báo nổi trên màn hình điện thoại / máy tính và âm báo tức thì khi có đơn Shopee, POS, cảnh báo tồn kho hoặc tin nhắn mới.
            </DialogDescription>
          </DialogHeader>

          {/* Khối kích hoạt Thông báo Đẩy Hệ điều hành */}
          <div
            className={cn(
              'rounded-xl border p-3 text-xs',
              pwa.permission === 'granted' && pwa.prefs.osPushEnabled
                ? 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                : 'border-sky-200 bg-sky-50/70 dark:border-sky-900/60 dark:bg-sky-950/30'
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  {pwa.permission === 'granted' && pwa.prefs.osPushEnabled ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span>Thông báo đẩy Hệ điều hành: ĐANG BẬT</span>
                    </>
                  ) : pwa.permission === 'denied' ? (
                    <>
                      <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
                      <span>Trình duyệt đang chặn quyền thông báo</span>
                    </>
                  ) : (
                    <>
                      <Bell className="h-4 w-4 shrink-0 text-[#0066CC]" />
                      <span>Bật thông báo nổi như App gốc</span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {pwa.permission === 'granted'
                    ? 'Hỗ trợ Windows Action Center, macOS, Android & iOS (khi đã thêm vào Màn hình chính).'
                    : pwa.permission === 'denied'
                      ? 'Mở Cài đặt trang web trên thanh địa chỉ trình duyệt → Cho phép "Thông báo" (Notifications).'
                      : 'Cho phép hiển thị thông báo nổi ngay cả khi bạn đang mở tab khác hoặc thu nhỏ cửa sổ.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pwa.permission !== 'granted' && pwa.permission !== 'unsupported' && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 bg-[#0066CC] px-3 text-xs font-semibold text-white hover:bg-[#0055B3]"
                    onClick={() => void handleEnableOsPush()}
                  >
                    <BellRing className="mr-1.5 h-3.5 w-3.5" />
                    Bật thông báo đẩy
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testingPush}
                  className="h-10 px-3 text-xs font-medium"
                  onClick={() => void handleTestNotification()}
                >
                  <Volume2 className="mr-1.5 h-3.5 w-3.5 text-[#0066CC]" />
                  {testingPush ? 'Đang gửi...' : 'Gửi thông báo thử'}
                </Button>
              </div>
            </div>
          </div>

          {/* Thanh công cụ Tùy chỉnh nhanh & Cài đặt như App */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-10 px-3 text-xs"
                onClick={() => setShowSettingsInline((v) => !v)}
              >
                {pwa.prefs.soundEnabled ? (
                  <Volume2 className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <VolumeX className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                )}
                {showSettingsInline ? 'Ẩn tùy chỉnh kênh báo' : 'Tùy chỉnh chuông & kênh báo'}
              </Button>
              {!pwa.isStandalone && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10 border-sky-200 bg-sky-50/60 px-3 text-xs font-semibold text-[#0066CC] hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
                  onClick={() => setActivePanel('install')}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Cài đặt như App
                </Button>
              )}
            </div>

            {pwa.feed.length > 0 && (
              <div className="flex items-center gap-1.5">
                {pwa.unreadCount > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-10 px-2.5 text-xs"
                    onClick={() => pwa.markAllRead()}
                  >
                    <CheckCheck className="mr-1 h-3.5 w-3.5" />
                    Đọc tất cả
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-10 px-2.5 text-xs text-muted-foreground hover:text-rose-600"
                  onClick={() => pwa.clearFeed()}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  Xóa
                </Button>
              </div>
            )}
          </div>

          {showSettingsInline && (
            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-2 py-1">
                <div>
                  <p className="text-xs font-semibold">Thông báo nổi Hệ điều hành (OS Push)</p>
                  <p className="text-[11px] text-muted-foreground">Hiển thị hộp thoại thông báo ngoài trình duyệt</p>
                </div>
                <Switch
                  checked={pwa.prefs.osPushEnabled}
                  onCheckedChange={(checked) => pwa.setPrefs({ osPushEnabled: checked })}
                  aria-label="Bật/tắt thông báo nổi hệ điều hành"
                />
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-2">
                <div>
                  <p className="text-xs font-semibold">Âm báo chuông (Ting-Ting)</p>
                  <p className="text-[11px] text-muted-foreground">Phát chuông điện tử rõ ràng khi có đơn mới hoặc cảnh báo</p>
                </div>
                <Switch
                  checked={pwa.prefs.soundEnabled}
                  onCheckedChange={(checked) => pwa.setPrefs({ soundEnabled: checked })}
                  aria-label="Bật/tắt âm báo chuông"
                />
              </div>
              <div className="grid gap-2 border-t pt-2 sm:grid-cols-2">
                {(['orders', 'inventory', 'channels', 'inbox'] as NotificationCategory[]).map((cat) => {
                  const meta = CATEGORY_META[cat]
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-card px-2.5 py-2"
                    >
                      <span className="text-xs font-medium">{meta.label}</span>
                      <Switch
                        checked={pwa.prefs.categories[cat]}
                        onCheckedChange={(checked) => pwa.toggleCategory(cat, checked)}
                        aria-label={`Bật/tắt ${meta.label}`}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Danh sách Thông báo gần đây */}
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {pwa.feed.length === 0 ? (
              <div className="rounded-xl border border-dashed py-8 text-center text-xs text-muted-foreground">
                <Bell className="mx-auto mb-2 h-6 w-6 opacity-40" />
                <p className="font-medium text-foreground">Chưa có thông báo mới</p>
                <p className="mt-0.5 text-[11px]">
                  Bấm <strong>“Gửi thông báo thử”</strong> ở trên để kiểm tra chuông báo trên thiết bị của bạn.
                </p>
              </div>
            ) : (
              pwa.feed.map((item) => {
                const meta = CATEGORY_META[item.category] ?? CATEGORY_META.system
                const Icon = meta.icon
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNotification(item)}
                    className={cn(
                      'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors hover:bg-muted/60',
                      item.read ? 'bg-card opacity-80' : 'border-sky-200/90 bg-sky-50/40 dark:border-sky-900/60 dark:bg-sky-950/25'
                    )}
                  >
                    <div
                      className={cn(
                        'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                        meta.colorClass
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-foreground">{item.title}</p>
                        {!item.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[#0066CC]" aria-label="Chưa đọc" />
                        )}
                      </div>
                      <p className="line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                      <p className="text-[10.5px] text-muted-foreground/80">{timeAgo(item.createdAt)}</p>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Hộp thoại 2: Cài đặt OPENVN · Ưu Đàm như Ứng dụng (PWA Native-Like App) */}
      <Dialog
        open={activePanel === 'install'}
        onOpenChange={(open) => setActivePanel(open ? 'install' : 'none')}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <MonitorSmartphone className="h-5 w-5 text-[#0066CC]" />
              Cài đặt OPENVN · Ưu Đàm như Ứng dụng (App)
            </DialogTitle>
            <DialogDescription>
              Mở toàn màn hình không thanh địa chỉ, ghim biểu tượng ra Desktop / Màn hình chính điện thoại và nhận thông báo đẩy như phần mềm gốc.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 text-xs">
            {/* Nhận diện biểu tượng App */}
            <div className="flex items-center gap-3 rounded-xl border bg-gradient-to-r from-[#0F1E36] via-[#004A99] to-[#0066CC] p-3.5 text-white shadow-xs">
              <img
                src={resolveSubpathAssetUrl('/icons/icon-192.png')}
                alt="OPENVN POS Icon"
                className="h-12 w-12 shrink-0 rounded-xl border border-white/20 bg-[#0F1E36] shadow-sm"
              />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-bold">OPENVN POS · Ưu Đàm</p>
                  <Badge className="bg-emerald-500 px-1.5 py-0 text-[10px] text-white">PWA v3.0</Badge>
                </div>
                <p className="text-[11px] text-sky-100">
                  Hỗ trợ Windows · macOS · Android · iPhone / iPad · Quầy Thu ngân Cảm ứng
                </p>
              </div>
            </div>

            {pwa.isStandalone ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <p className="flex items-center gap-1.5 font-semibold text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  Thiết bị đang chạy OPENVN ở chế độ Ứng dụng Độc lập!
                </p>
                <p className="mt-1 text-[11.5px] text-emerald-900/80 dark:text-emerald-200/80">
                  Bạn có thể nhấn chuột phải (hoặc nhấn giữ) vào biểu tượng <strong>OPENVN POS</strong> ngoài màn hình để mở nhanh <em>Quầy POS</em>, <em>Đơn hàng</em>, <em>Tồn kho Thật</em> hoặc <em>Kênh Shopee</em>.
                </p>
              </div>
            ) : pwa.canPromptInstall ? (
              <div className="space-y-2.5 rounded-xl border border-sky-200 bg-sky-50/70 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
                <p className="font-semibold text-foreground">
                  Trình duyệt của bạn hỗ trợ cài đặt trực tiếp 1-Chạm:
                </p>
                <Button
                  type="button"
                  className="h-11 w-full bg-[#0066CC] text-sm font-bold text-white hover:bg-[#0055B3]"
                  onClick={() => void handleNativeInstallConfirm()}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Cài đặt OPENVN POS ngay bây giờ (1-Chạm)
                </Button>
              </div>
            ) : pwa.platform === 'ios' ? (
              <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
                <p className="font-semibold text-foreground">
                  Hướng dẫn cài như App trên iPhone / iPad (Safari):
                </p>
                <ol className="list-decimal space-y-1.5 pl-4 text-[11.5px] leading-relaxed text-foreground/90">
                  <li>
                    Chạm vào nút <strong>Chia sẻ</strong> (<Share className="inline h-3.5 w-3.5 text-[#0066CC]" />) ở thanh dưới cùng hoặc góc trên trình duyệt Safari.
                  </li>
                  <li>
                    Cuộn xuống và chọn <strong>“Thêm vào Màn hình chính” (Add to Home Screen)</strong>.
                  </li>
                  <li>
                    Nhấn <strong>“Thêm” (Add)</strong> ở góc phải trên cùng — ứng dụng <strong>OPENVN POS</strong> sẽ mở toàn màn hình và nhận được thông báo đẩy iOS!
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/60 p-3.5 dark:border-sky-900/60 dark:bg-sky-950/30">
                <p className="font-semibold text-foreground">
                  Hướng dẫn cài đặt nhanh thành App trên Máy tính / Android:
                </p>
                <ol className="list-decimal space-y-1.5 pl-4 text-[11.5px] leading-relaxed text-foreground/90">
                  <li>
                    <strong>Trên Chrome / Microsoft Edge (Windows &amp; Mac):</strong> Nhấn biểu tượng{' '}
                    <strong>Cài đặt ứng dụng (⊕ / màn hình có mũi tên xuống)</strong> ở góc phải thanh địa chỉ URL, hoặc mở menu <strong>⋮ → Lưu và chia sẻ → Cài đặt trang làm ứng dụng</strong>.
                  </li>
                  <li>
                    <strong>Trên Điện thoại Android (Chrome):</strong> Nhấn menu <strong>⋮</strong> ở góc trên bên phải → chọn <strong>“Cài đặt ứng dụng” (Install app)</strong> hoặc <strong>“Thêm vào Màn hình chính”</strong>.
                  </li>
                </ol>
              </div>
            )}

            {/* 4 Lối tắt nhanh (App Shortcuts) tích hợp sẵn sau khi cài */}
            <div className="space-y-2">
              <p className="font-semibold text-foreground">
                Lối tắt tích hợp sẵn khi nhấn giữ biểu tượng App:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Quầy POS Bán tại kho', sub: 'Thu ngân & VietQR', icon: Store, href: '/pos', view: 'pos' },
                  { label: 'Quản lý Đơn hàng', sub: 'Shopee & Đa kênh', icon: ShoppingBag, href: '/?view=orders', view: 'orders' },
                  { label: 'Tồn kho Thật CMS', sub: 'Thẻ kho & Tồn ảo', icon: Package, href: '/?view=inventory', view: 'inventory' },
                  { label: 'Liên kết Kênh Sàn', sub: 'Cookie & Hàng đợi', icon: ExternalLink, href: '/?view=channels', view: 'channels' },
                ].map((sc) => {
                  const Icon = sc.icon
                  return (
                    <button
                      key={sc.label}
                      type="button"
                      onClick={() => {
                        setActivePanel('none')
                        if (onNavigateView && sc.view !== 'pos') {
                          onNavigateView(sc.view)
                        } else {
                          router.push(sc.href)
                        }
                      }}
                      className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/60"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[#0066CC]" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{sc.label}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{sc.sub}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function PwaSettingsCard() {
  const { toast } = useToast()
  const pwa = usePwaAppCenter()
  const [testing, setTesting] = useState(false)

  const handleInstall = async () => {
    if (pwa.canPromptInstall) {
      const outcome = await pwa.promptInstall()
      if (outcome === 'accepted') {
        toast({
          title: 'Đã cài đặt ứng dụng OPENVN POS',
          description: 'Ứng dụng đã sẵn sàng trên màn hình thiết bị của bạn.',
        })
      }
      return
    }
    toast({
      title: pwa.isStandalone
        ? 'Thiết bị đang chạy chế độ App Độc lập'
        : pwa.platform === 'ios'
          ? 'Trên iPhone/iPad: Nhấn nút Chia sẻ (⬆️) → "Thêm vào Màn hình chính"'
          : 'Nhấn biểu tượng Cài đặt App ở thanh địa chỉ Chrome/Edge (hoặc nút "Cài App" trên thanh trên cùng)',
      description: 'OPENVN POS đã cấu hình đầy đủ Web App Manifest, biểu tượng chuẩn HD & Service Worker v3.0.',
    })
  }

  const handleRequestPermission = async () => {
    const perm = await pwa.requestPermission()
    if (perm === 'granted') {
      toast({
        title: 'Đã cấp quyền Thông báo Đẩy Hệ điều hành',
        description: 'Mọi biến động đơn hàng, tồn kho thật và phiên Shopee sẽ thông báo trực tiếp như App.',
      })
    } else if (perm === 'denied') {
      toast({
        title: 'Trình duyệt đang chặn quyền thông báo',
        description: 'Vui lòng mở biểu tượng ổ khóa cạnh thanh địa chỉ URL và chuyển Thông báo sang "Cho phép".',
        variant: 'destructive',
      })
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const res = await pwa.sendTestNotification()
      toast({
        title: res.osDelivered
          ? 'Đã bắn Thông báo Đẩy & Chuông báo thành công!'
          : 'Đã phát chuông báo & ghi vào Trung tâm Thông báo',
        description: res.osDelivered
          ? 'Thông báo đã hiển thị trên hệ điều hành thiết bị của bạn.'
          : 'Hãy bấm "Cấp quyền Thông báo Hệ điều hành" để hiển thị cả hộp thoại nổi ngoài màn hình.',
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card className="border-sky-200/90 bg-gradient-to-br from-sky-50/40 via-background to-background shadow-sm dark:border-sky-900/60 dark:from-sky-950/20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorSmartphone className="h-5 w-5 text-[#0066CC]" />
            Ứng dụng Độc lập (Cài đặt như App) &amp; Thông báo Đẩy Thời gian thực
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                pwa.isStandalone
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-sky-300 bg-sky-50 text-[#0066CC] dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
              )}
            >
              {pwa.isStandalone ? 'Đang chạy App Độc lập' : pwa.swReady ? 'Sẵn sàng cài App (PWA)' : 'Web App Chuẩn'}
            </Badge>
            <Badge
              variant="outline"
              className={cn(
                pwa.permission === 'granted' && pwa.prefs.osPushEnabled
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
              )}
            >
              {pwa.permission === 'granted' && pwa.prefs.osPushEnabled
                ? 'Thông báo OS: Đang bật'
                : 'Thông báo OS: Chưa bật'}
            </Badge>
          </div>
        </div>
        <CardDescription>
          Cài đặt OPENVN · Ưu Đàm ra màn hình Desktop / Điện thoại để mở nhanh không thanh địa chỉ và nhận chuông báo đơn hàng Shopee, POS, tồn kho thật CMS ngay lập tức
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cụm nút hành động chính */}
        <div className="flex flex-wrap items-center gap-2.5">
          {!pwa.isStandalone && (
            <Button
              type="button"
              className="h-10 bg-[#0066CC] text-white hover:bg-[#0055B3]"
              onClick={() => void handleInstall()}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {pwa.canPromptInstall ? 'Cài đặt ứng dụng ngay (1-Chạm)' : 'Hướng dẫn Cài đặt như App'}
            </Button>
          )}
          {pwa.permission !== 'granted' && pwa.permission !== 'unsupported' && (
            <Button
              type="button"
              variant="outline"
              className="h-10 border-sky-300 text-[#0066CC] hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300"
              onClick={() => void handleRequestPermission()}
            >
              <BellRing className="mr-1.5 h-4 w-4" />
              Cấp quyền Thông báo Hệ điều hành
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={testing}
            className="h-10"
            onClick={() => void handleTest()}
          >
            <Volume2 className="mr-1.5 h-4 w-4 text-emerald-600" />
            {testing ? 'Đang gửi thử...' : 'Gửi thông báo & Chuông thử nghiệm'}
          </Button>
        </div>

        {/* Công tắc tổng & từng nhóm nghiệp vụ */}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between rounded-xl border bg-card px-3.5 py-2.5">
            <div className="space-y-0.5 pr-2">
              <p className="text-sm font-medium">Thông báo nổi ngoài màn hình (OS Push)</p>
              <p className="text-xs text-muted-foreground">
                Hiển thị thông báo hệ điều hành ngay cả khi thu nhỏ cửa sổ hoặc chuyển tab
              </p>
            </div>
            <Switch
              checked={pwa.prefs.osPushEnabled}
              onCheckedChange={(checked) => pwa.setPrefs({ osPushEnabled: checked })}
              aria-label="Bật/tắt thông báo nổi hệ điều hành"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl border bg-card px-3.5 py-2.5">
            <div className="space-y-0.5 pr-2">
              <p className="text-sm font-medium">Âm báo chuông đơn mới &amp; Rung di động</p>
              <p className="text-xs text-muted-foreground">
                Phát tiếng chuông báo rõ ràng cho thu ngân / kho khi phát sinh đơn hoặc cảnh báo
              </p>
            </div>
            <Switch
              checked={pwa.prefs.soundEnabled}
              onCheckedChange={(checked) =>
                pwa.setPrefs({ soundEnabled: checked, vibrateEnabled: checked })
              }
              aria-label="Bật/tắt âm báo chuông và rung"
            />
          </div>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {(['orders', 'inventory', 'channels', 'inbox'] as NotificationCategory[]).map((cat) => {
            const meta = CATEGORY_META[cat]
            const Icon = meta.icon
            return (
              <div
                key={cat}
                className="flex items-start justify-between gap-3 rounded-xl border bg-card/80 p-3"
              >
                <div className="flex min-w-0 items-start gap-2.5">
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                      meta.colorClass
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">{meta.label}</p>
                    <p className="text-[11px] leading-snug text-muted-foreground">{meta.desc}</p>
                  </div>
                </div>
                <Switch
                  checked={pwa.prefs.categories[cat]}
                  onCheckedChange={(checked) => pwa.toggleCategory(cat, checked)}
                  aria-label={`Bật/tắt ${meta.label}`}
                />
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
