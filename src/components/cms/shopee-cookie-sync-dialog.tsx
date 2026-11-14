'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import {
  parseShopeeCurlOrCookieInput,
  type MaskedCookiePreview,
  type ShopeeCookieInputFormat,
} from '@/lib/shopee-curl-parser'
import {
  DEFAULT_SHOPEE_SHOP_BINDING,
  buildStoreZip,
  generateShopeeExtensionFiles,
} from '@/lib/shopee-extension-bundle'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
} from 'lucide-react'

export interface ShopeeSessionStatus {
  ok: boolean
  daemonOnline: boolean
  alive: boolean
  paused: boolean
  shopId: string
  username: string
  cookieCount: number
  hasSpcSt: boolean
  hasSpcScSession: boolean
  hasSpcEc?: boolean
  sessionKeysFound: string[]
  maskedPreview: MaskedCookiePreview[]
  updatedAt: string | null
  source: string | null
  lastSync: string | null
  trackedProducts: number
  dlqCount: number
  extensionInfo?: {
    shopId: string
    username: string
    shopLabel: string
    bridgePort: number
    downloadUrl: string
    unpackedDir: string
    pairingKeyPreview: string
  }
}

interface ShopeeCookieSyncDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTab?: 'curl' | 'extension'
  sessionStatus: ShopeeSessionStatus | null
  onSessionUpdated: (nextStatus?: ShopeeSessionStatus) => void
}

const FORMAT_LABELS: Record<ShopeeCookieInputFormat, string> = {
  EMPTY: 'Chưa nhập',
  CURL_BASH: 'cURL (Bash / Chrome)',
  CURL_CMD: 'cURL (Windows CMD)',
  POWERSHELL: 'PowerShell',
  FETCH_JS: 'Fetch (JavaScript)',
  COOKIE_JSON: 'JSON (Cookie-Editor)',
  COOKIE_HEADER: 'Chuỗi Cookie thô',
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL_CURL_IMPORT: 'Nhập cURL thủ công',
  CHROME_EXTENSION_BRIDGE: 'Extension riêng của Shop',
  CHROME_EXTENSION_AUTO_SYNC: 'Extension tự động',
  HEARTBEAT_KEEP_ALIVE: 'Tự động gia hạn ngầm',
  PRODUCT_LIST_RESPONSE: 'Đồng bộ danh sách SP',
  CDP_RECOVERY: 'Khôi phục trình duyệt',
  INITIAL_FALLBACK: 'Khởi tạo mặc định',
}

export function ShopeeCookieSyncDialog({
  open,
  onOpenChange,
  initialTab = 'curl',
  sessionStatus,
  onSessionUpdated,
}: ShopeeCookieSyncDialogProps) {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<'curl' | 'extension'>(initialTab)
  const [rawInput, setRawInput] = useState('')
  const [enforceShopLock, setEnforceShopLock] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [checking, setChecking] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    }
  }, [open, initialTab])

  const shopId =
    sessionStatus?.extensionInfo?.shopId ||
    sessionStatus?.shopId ||
    DEFAULT_SHOPEE_SHOP_BINDING.shopId
  const username =
    sessionStatus?.extensionInfo?.username ||
    sessionStatus?.username ||
    DEFAULT_SHOPEE_SHOP_BINDING.username
  const bridgePort =
    sessionStatus?.extensionInfo?.bridgePort || DEFAULT_SHOPEE_SHOP_BINDING.bridgePort

  const parsed = useMemo(() => parseShopeeCurlOrCookieInput(rawInput), [rawInput])

  const handleCheckLiveSession = useCallback(async () => {
    setChecking(true)
    try {
      const isStaticHost =
        typeof window !== 'undefined' && window.location.hostname.includes('github.io')

      if (isStaticHost) {
        // Thử kết nối trực tiếp cầu nối Python cục bộ (:51898) nếu người dùng mở Beta trên cùng máy
        const localRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/check-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
        const localData = (await localRes.json()) as {
          ok?: boolean
          alive?: boolean
          shopId?: string
          username?: string
          cookieCount?: number
        }
        if (localRes.ok && localData.ok) {
          toast({
            title: localData.alive
              ? `Phiên Shopee đang hoạt động (${localData.username || username})`
              : 'Phiên Cookie hiện tại đã hết hạn',
            description: localData.alive
              ? `Kết nối trực tiếp qua Python Daemon (:${bridgePort}) — ${localData.cookieCount || 0} cookies.`
              : 'Hãy dán lệnh cURL mới hoặc mở banhang.shopee.vn kèm Extension.',
            variant: localData.alive ? 'default' : 'destructive',
          })
          onSessionUpdated()
          return
        }
      }

      const refreshed = await apiPost<ShopeeSessionStatus>('/api/channels/shopee-session', {
        action: 'CHECK_SESSION',
      })
      onSessionUpdated(refreshed)
      toast({
        title: refreshed.alive
          ? `Kết nối Shopee Live (${refreshed.username} · #${refreshed.shopId})`
          : 'Phiên Cookie Shopee cần làm mới',
        description: refreshed.alive
          ? `Đang duy trì ${refreshed.cookieCount} cookies hợp lệ trên hệ thống.`
          : 'Cookie đã hết hạn trên Kênh Người Bán. Hãy dán cURL hoặc đồng bộ qua Extension.',
        variant: refreshed.alive ? 'default' : 'destructive',
      })
    } catch {
      try {
        const fallbackStatus = await apiGet<ShopeeSessionStatus>('/api/channels/shopee-session')
        onSessionUpdated(fallbackStatus)
      } catch {
        // Bỏ qua nếu môi trường tĩnh không có daemon cục bộ
      }
      toast({
        title: 'Không thể kiểm tra trực tuyến từ trang tĩnh',
        description:
          'Hãy đảm bảo OPENVN CMS (localhost:3010) hoặc Python Shopee Daemon (:51898) đang bật trên máy của bạn.',
        variant: 'destructive',
      })
    } finally {
      setChecking(false)
    }
  }, [bridgePort, onSessionUpdated, toast, username])

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setRawInput(text)
      } else {
        toast({
          title: 'Bộ nhớ tạm đang trống',
          description: 'Hãy Copy as cURL từ tab Network (F12) trên banhang.shopee.vn trước.',
        })
      }
    } catch {
      toast({
        title: 'Trình duyệt chặn đọc tự động bộ nhớ tạm',
        description: 'Bạn hãy nhấn trực tiếp Ctrl+V vào ô nhập liệu bên dưới.',
      })
    }
  }

  const handleImportCurl = async () => {
    if (!parsed.valid) return
    setSubmitting(true)
    try {
      const isStaticHost =
        typeof window !== 'undefined' && window.location.hostname.includes('github.io')

      if (isStaticHost) {
        // Nếu đang xem bản Beta trên GitHub Pages, thử đẩy thẳng vào Python Daemon cục bộ (:51898)
        const bridgeRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cookies: parsed.cookies,
            spc_cds: parsed.spcCds,
            csrf_token: parsed.csrfToken,
            source: 'MANUAL_CURL_IMPORT',
            expectedShopId: enforceShopLock ? shopId : '',
          }),
        })
        const bridgeData = (await bridgeRes.json().catch(() => ({}))) as {
          ok?: boolean
          shopId?: string
          username?: string
          error?: string
        }
        if (!bridgeRes.ok || !bridgeData.ok) {
          throw new Error(
            bridgeData.error ||
              'Cookie đã hết hạn hoặc không hợp lệ đối với Kênh Người Bán Shopee.'
          )
        }
        toast({
          title: 'Đã xác thực & nạp Cookie thành công!',
          description: `Shop ${bridgeData.username || username} (#${bridgeData.shopId || shopId}) · ${parsed.cookieCount} cookies.`,
        })
        setRawInput('')
        onSessionUpdated()
        onOpenChange(false)
        return
      }

      const res = await apiPost<ShopeeSessionStatus & { message?: string }>(
        '/api/channels/shopee-session',
        {
          action: 'IMPORT_CURL',
          rawInput,
          enforceShopLock,
        }
      )

      toast({
        title: 'Nạp Cookie Shopee thành công!',
        description:
          res.message ||
          `Đã kết nối phiên Live cho shop ${res.username} (#${res.shopId}) với ${res.cookieCount} cookies.`,
      })
      setRawInput('')
      onSessionUpdated(res)
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Không thể nạp Cookie Shopee',
        description:
          err instanceof Error
            ? err.message
            : 'Vui lòng kiểm tra lại lệnh cURL hoặc bật OPENVN CMS cục bộ.',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const triggerClientSideZipDownload = useCallback(() => {
    const origin =
      typeof window !== 'undefined' && !window.location.hostname.includes('github.io')
        ? window.location.origin
        : 'http://127.0.0.1:3010'

    const files = generateShopeeExtensionFiles({
      shopId,
      username,
      shopLabel: DEFAULT_SHOPEE_SHOP_BINDING.shopLabel,
      cmsOrigin: origin,
      bridgePort,
      pairingToken: '',
      enforceShopLock: true,
      generatedAt: new Date().toISOString(),
    })
    const zipBytes = buildStoreZip(files)
    const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `openvn-shopee-extension-${username}-${shopId}.zip`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 3000)
  }, [bridgePort, shopId, username])

  const handleDownloadShopExtension = async () => {
    setDownloadingZip(true)
    try {
      const isStaticHost =
        typeof window !== 'undefined' && window.location.hostname.includes('github.io')

      if (isStaticHost) {
        triggerClientSideZipDownload()
        toast({
          title: 'Đã tải gói Extension riêng của Shop',
          description: `File openvn-shopee-extension-${username}-${shopId}.zip đã sẵn sàng giải nén.`,
        })
        return
      }

      const res = await fetch('/api/channels/shopee-extension', {
        method: 'GET',
        credentials: 'include',
      })
      const contentType = res.headers.get('content-type') || ''
      if (!res.ok || !contentType.includes('zip')) {
        triggerClientSideZipDownload()
      } else {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `openvn-shopee-extension-${username}-${shopId}.zip`
        document.body.appendChild(link)
        link.click()
        link.remove()
        setTimeout(() => URL.revokeObjectURL(url), 3000)
      }

      toast({
        title: 'Đã tải gói Extension liên kết riêng của Shop!',
        description: `Đã nhúng sẵn cấu hình cho shop ${username} (#${shopId}). Hãy giải nén và nạp vào Chrome.`,
      })
    } catch {
      triggerClientSideZipDownload()
      toast({
        title: 'Đã tạo & tải gói Extension cục bộ',
        description: `File openvn-shopee-extension-${username}-${shopId}.zip đã được tải xuống.`,
      })
    } finally {
      setDownloadingZip(false)
    }
  }

  const copyQuickText = async (val: string, label: string) => {
    try {
      await navigator.clipboard.writeText(val)
      toast({
        title: `Đã sao chép ${label}`,
        description: val,
      })
    } catch {
      toast({
        title: 'Không thể sao chép tự động',
        description: val,
      })
    }
  }

  const isLive = Boolean(sessionStatus?.alive)
  const sourceText = sessionStatus?.source
    ? SOURCE_LABELS[sessionStatus.source] || sessionStatus.source
    : 'Chưa ghi nhận'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <KeyRound className="h-5 w-5 text-orange-600" />
            Kết nối Cookie Kênh Người Bán Shopee ({username} · #{shopId})
          </DialogTitle>
          <DialogDescription>
            Chọn 1 trong 2 cách: dán nhanh lệnh <b>cURL / Cookie</b> để dùng ngay, hoặc cài đặt{' '}
            <b>Chrome Extension liên kết riêng của Shop</b> để tự động đồng bộ & gia hạn ngầm.
          </DialogDescription>
        </DialogHeader>

        {/* Thanh Trạng thái Phiên Hiện Tại */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs ${
            isLive
              ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
              : 'border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {isLive ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            )}
            <div>
              <div className="font-semibold">
                {isLive
                  ? `Phiên Shopee đang hoạt động Live — ${sessionStatus?.username || username} (#${sessionStatus?.shopId || shopId})`
                  : `Phiên Cookie hết hạn hoặc chưa kết nối — cần nạp lại cho shop ${username} (#${shopId})`}
              </div>
              <div className="mt-0.5 text-[11px] opacity-85">
                Daemon đồng bộ:{' '}
                <b>{sessionStatus?.daemonOnline ? 'Đang bật (:51898)' : 'Chưa bật'}</b> · Cookie đã
                lưu: <b>{sessionStatus?.cookieCount ?? 0}</b> · Nguồn: <b>{sourceText}</b>
                {sessionStatus?.updatedAt ? ` · Cập nhật: ${sessionStatus.updatedAt}` : ''}
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 bg-background/90 px-2.5 text-xs"
            disabled={checking}
            onClick={() => void handleCheckLiveSession()}
          >
            <RefreshCw className={checking ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'} />
            Kiểm tra phiên
          </Button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as 'curl' | 'extension')}
          className="mt-1"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="curl" className="gap-1.5 text-xs sm:text-sm">
              <Terminal className="h-4 w-4" />
              Nhập lệnh cURL / Cookie
            </TabsTrigger>
            <TabsTrigger value="extension" className="gap-1.5 text-xs sm:text-sm">
              <Puzzle className="h-4 w-4" />
              Extension riêng của Shop
            </TabsTrigger>
          </TabsList>

          {/* ==================== TAB 1: NHẬP LỆNH CURL / COOKIE ==================== */}
          <TabsContent value="curl" className="mt-3 space-y-3">
            <div className="rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
              <p className="font-semibold text-foreground">
                Cách lấy lệnh cURL từ Kênh Người Bán (15 giây):
              </p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>
                  Mở{' '}
                  <a
                    href="https://banhang.shopee.vn"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-orange-600 underline hover:text-orange-700"
                  >
                    banhang.shopee.vn <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  (đảm bảo đang đăng nhập tài khoản <b>{username}</b>), nhấn phím <b>F12</b> → mở
                  tab <b>Network</b>.
                </li>
                <li>
                  Tải lại trang (F5), bấm chuột phải vào 1 dòng request bất kỳ tới{' '}
                  <code>banhang.shopee.vn</code> → chọn <b>Copy</b> →{' '}
                  <b>Copy as cURL (bash)</b> hoặc <b>Copy as cURL (cmd)</b>.
                </li>
                <li>
                  Dán toàn bộ vào ô dưới đây — hệ thống hỗ trợ cả <i>cURL Bash, cURL CMD, PowerShell, Fetch JS, JSON</i> và <i>Cookie thô</i>.
                </li>
              </ol>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  Nội dung lệnh cURL hoặc chuỗi Cookie Shopee
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => void handlePasteFromClipboard()}
                  >
                    <ClipboardPaste className="mr-1 h-3.5 w-3.5" />
                    Dán nhanh
                  </Button>
                  {rawInput.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => setRawInput('')}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Xóa
                    </Button>
                  )}
                </div>
              </div>

              <Textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder={`Ví dụ:\ncurl 'https://banhang.shopee.vn/api/v2/login/?SPC_CDS=...' -b 'SPC_ST=...; SPC_EC=...; csrftoken=...'`}
                className="max-h-48 min-h-[128px] font-mono text-xs leading-relaxed"
                spellCheck={false}
              />
            </div>

            {/* Hộp Xem Trước Kết Quả Bóc Tách Tức Thì */}
            {rawInput.trim().length > 0 && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  parsed.valid
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/60 dark:bg-emerald-950/25'
                    : 'border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/25'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="bg-background text-[11px]">
                      Định dạng: {FORMAT_LABELS[parsed.format]}
                    </Badge>
                    <Badge
                      variant={parsed.valid ? 'default' : 'destructive'}
                      className={parsed.valid ? 'bg-emerald-600 text-[11px] text-white' : 'text-[11px]'}
                    >
                      {parsed.cookieCount} cookies
                    </Badge>
                  </div>
                  {parsed.valid && (
                    <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Đủ khóa phiên đăng nhập
                    </span>
                  )}
                </div>

                {parsed.maskedPreview.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {parsed.maskedPreview.map((item) => (
                      <span
                        key={item.key}
                        className="inline-flex items-center rounded border bg-background px-2 py-0.5 font-mono text-[11px]"
                      >
                        <b className="mr-1 text-orange-600">{item.key}:</b>
                        {item.maskedValue}
                      </span>
                    ))}
                  </div>
                )}

                {parsed.error && (
                  <p className="mt-2 font-medium text-red-700 dark:text-red-300">{parsed.error}</p>
                )}
                {parsed.warning && !parsed.error && (
                  <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    {parsed.warning}
                  </p>
                )}
              </div>
            )}

            <label className="flex cursor-pointer items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-xs">
              <Checkbox
                checked={enforceShopLock}
                onCheckedChange={(v) => setEnforceShopLock(Boolean(v))}
              />
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Khóa an toàn Shop: Chỉ cho phép lưu nếu đúng tài khoản{' '}
                <b>
                  {username} (Shop ID #{shopId})
                </b>
              </span>
            </label>

            <DialogFooter className="pt-1">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
              <Button
                type="button"
                className="bg-orange-600 text-white hover:bg-orange-700"
                disabled={!parsed.valid || submitting}
                onClick={() => void handleImportCurl()}
              >
                {submitting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="mr-1.5 h-4 w-4" />
                )}
                Xác thực & Nạp Cookie ngay
              </Button>
            </DialogFooter>
          </TabsContent>

          {/* ==================== TAB 2: EXTENSION LIÊN KẾT RIÊNG CỦA SHOP ==================== */}
          <TabsContent value="extension" className="mt-3 space-y-3.5">
            <div className="rounded-xl border border-orange-200 bg-gradient-to-br from-orange-50/80 via-background to-amber-50/40 p-4 dark:border-orange-900/50 dark:from-orange-950/30 dark:to-background">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-orange-600 text-white hover:bg-orange-600">
                      Liên kết riêng
                    </Badge>
                    <span className="text-xs font-semibold text-muted-foreground">
                      Manifest V3 · Tự động 100%
                    </span>
                  </div>
                  <h4 className="mt-1.5 text-sm font-bold">
                    OPENVN Shopee Auto-Sync — {username} (#{shopId})
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Gói tiện ích đã được đóng gói riêng cho gian hàng <b>{username}</b>: tự động
                    đồng bộ Cookie ngay khi bạn mở <code>banhang.shopee.vn</code>, tự làm mới mỗi 10
                    phút và khóa cứng Shop ID <code>#{shopId}</code> tránh nhầm tài khoản.
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border bg-background/80 p-2.5 text-xs sm:grid-cols-3">
                <div>
                  <span className="text-[11px] text-muted-foreground">Gian hàng gắn kết</span>
                  <p className="font-semibold">
                    {username} (#{shopId})
                  </p>
                </div>
                <div>
                  <span className="text-[11px] text-muted-foreground">Cổng Daemon cục bộ</span>
                  <p className="font-mono font-semibold">127.0.0.1:{bridgePort}</p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[11px] text-muted-foreground">Khóa ghép nối API</span>
                  <p className="font-mono font-semibold">
                    {sessionStatus?.extensionInfo?.pairingKeyPreview || 'Tự động nhúng sẵn'}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  className="bg-orange-600 text-white hover:bg-orange-700"
                  disabled={downloadingZip}
                  onClick={() => void handleDownloadShopExtension()}
                >
                  {downloadingZip ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  Tải gói Extension riêng của Shop (.zip)
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={checking}
                  onClick={() => void handleCheckLiveSession()}
                >
                  <RefreshCw
                    className={checking ? 'mr-1.5 h-3.5 w-3.5 animate-spin' : 'mr-1.5 h-3.5 w-3.5'}
                  />
                  Kiểm tra kết nối từ Extension
                </Button>
              </div>
            </div>

            <div className="rounded-lg border p-3.5 text-xs">
              <p className="font-semibold text-foreground">
                Hướng dẫn cài đặt vào Chrome / Edge / Cốc Cốc (chỉ làm 1 lần):
              </p>
              <ol className="mt-2 list-decimal space-y-2 pl-4 text-muted-foreground">
                <li>
                  Nhấn nút <b>Tải gói Extension riêng của Shop (.zip)</b> ở trên và giải nén ra một
                  thư mục cố định trên máy (hoặc trỏ trực tiếp tới thư mục có sẵn trong mã nguồn:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-foreground">
                    extensions/shopee-sync-extension
                  </code>
                  ).
                </li>
                <li>
                  Mở trình duyệt bạn dùng để quản lý Shopee, truy cập trang quản lý tiện ích:{' '}
                  <button
                    type="button"
                    onClick={() => void copyQuickText('chrome://extensions', 'địa chỉ trang Extension')}
                    className="inline-flex items-center gap-1 rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground hover:bg-muted"
                  >
                    chrome://extensions <Copy className="h-3 w-3" />
                  </button>
                </li>
                <li>
                  Bật công tắc <b>Chế độ dành cho nhà phát triển (Developer mode)</b> ở góc trên bên
                  phải, sau đó bấm <b>Tải tiện ích đã giải nén (Load unpacked)</b> và chọn thư mục
                  đã giải nén ở Bước 1.
                </li>
                <li>
                  Mở tab{' '}
                  <a
                    href="https://banhang.shopee.vn"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-orange-600 underline"
                  >
                    banhang.shopee.vn <ExternalLink className="h-3 w-3" />
                  </a>{' '}
                  — Extension sẽ tự động đẩy Cookie về OPENVN CMS và giữ phiên luôn xanh!
                </li>
              </ol>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Đóng
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
