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
  Cloud,
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

export interface ShopeeCloudVaultInfo {
  enabled: boolean
  cipher: string
  provider: string
  region: string
  cloudBackendOrigin: string
  hasEncryptedSession: boolean
  verifiedLive: boolean
  cookieCount: number
  updatedAt: string | null
  updatedByRole: string | null
  source: string | null
  version: number
  standbyYieldedToLocal?: boolean
  leaderLease?: {
    active: boolean
    holderRole: 'LOCAL_VN' | 'CLOUD_RENDER' | null
    holderLabel: string
    hostname: string | null
    expiresAt: string | null
    remainingSec: number
    epoch: number
  }
}

export interface ShopeeSessionStatus {
  ok: boolean
  daemonOnline: boolean
  cdpOnline?: boolean
  nodeRole?: 'LOCAL_VN' | 'CLOUD_RENDER'
  authMode?: string
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
  cloudVault?: ShopeeCloudVaultInfo
  extensionInfo?: {
    shopId: string
    username: string
    shopLabel: string
    bridgePort: number
    cdpPort?: number
    cloudOrigin?: string
    downloadUrl: string
    unpackedDir: string
    launcherScript?: string
    pairingKeyPreview: string
  }
}

export function isStaticBetaRuntime(): boolean {
  if (typeof window === 'undefined') return false
  const win = window as unknown as { __BETA_SUBPATH_SHIM__?: unknown }
  const host = window.location.hostname.toLowerCase()
  return (
    host.includes('github.io') ||
    host === 'khoaphan.dev' ||
    host.endsWith('.khoaphan.dev') ||
    Boolean(win.__BETA_SUBPATH_SHIM__)
  )
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
  BETA_WEB_CLOUD_IMPORT: 'Trang Beta đẩy thẳng Cloud',
  CHROME_EXTENSION_BRIDGE: 'Extension riêng của Shop',
  CHROME_EXTENSION_AUTO_SYNC: 'Extension tự động',
  CHROME_EXTENSION_CLOUD_SYNC: 'Extension đồng bộ Cloud 24/7',
  SUPABASE_VAULT: 'Kho Phiên Mã Hóa Supabase',
  HEARTBEAT_KEEP_ALIVE: 'Tự động gia hạn ngầm',
  SUBSESSION_AUTO_REFRESH: 'Tự làm mới phiên phụ Seller',
  PRODUCT_LIST_RESPONSE: 'Đồng bộ danh sách SP',
  PRODUCT_INFO_RESPONSE: 'Đồng bộ chi tiết SP',
  CDP_RECOVERY: 'Tự hồi phục Hồ sơ 1-Lần',
  CHROME_CDP_AUTO_EXTRACT: 'Hồ sơ Chrome Đăng nhập 1 lần',
  CHROME_CDP_ONE_TIME_LOGIN: 'Đăng nhập 1 lần (CDP :9222)',
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
  const [launchingBrowser, setLaunchingBrowser] = useState(false)
  const [syncingCdp, setSyncingCdp] = useState(false)
  const [awaitingBrowserLogin, setAwaitingBrowserLogin] = useState(false)

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab)
    } else {
      setAwaitingBrowserLogin(false)
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
  const cloudBackendOrigin = (
    sessionStatus?.cloudVault?.cloudBackendOrigin ||
    sessionStatus?.extensionInfo?.cloudOrigin ||
    DEFAULT_SHOPEE_SHOP_BINDING.cloudOrigin
  ).replace(/\/+$/, '')

  const parsed = useMemo(() => parseShopeeCurlOrCookieInput(rawInput), [rawInput])

  const handleCheckLiveSession = useCallback(async () => {
    setChecking(true)
    try {
      const isStaticHost = isStaticBetaRuntime()

      if (isStaticHost) {
        // 1. Thử kết nối trực tiếp cầu nối Python cục bộ (:51898) nếu máy bán hàng đang bật
        try {
          const localRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/check-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expectedShopId: enforceShopLock ? shopId : '' }),
            signal: AbortSignal.timeout(2200),
          })
          const localData = (await localRes.json().catch(() => ({}))) as {
            ok?: boolean
            alive?: boolean
            shopId?: string
            username?: string
            cookieCount?: number
          }
          if (localRes.ok && localData.ok && localData.alive) {
            toast({
              title: `Phiên Shopee đang hoạt động (${localData.username || username})`,
              description: `Máy bán hàng cục bộ (:${bridgePort}) đang giữ quyền ưu tiên — ${localData.cookieCount || 0} cookies.`,
            })
            if (sessionStatus) {
              onSessionUpdated({
                ...sessionStatus,
                daemonOnline: true,
                alive: true,
                shopId: localData.shopId || shopId,
                username: localData.username || username,
                cookieCount: localData.cookieCount ?? sessionStatus.cookieCount,
                updatedAt: new Date().toISOString(),
              })
            } else {
              onSessionUpdated()
            }
            return
          }
        } catch {
          // Máy cục bộ đang tắt -> kiểm tra trực tiếp trên Trạm Cloud Render Singapore bên dưới
        }

        // 2. Kiểm tra trực tiếp trên Trạm Cloud 24/7 (Render Singapore + Supabase AES-256-GCM Vault)
        const cloudCheckRes = await fetch(`${cloudBackendOrigin}/api/channels/shopee-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'CHECK_SESSION' }),
          signal: AbortSignal.timeout(65000),
        })
        const cloudData = (await cloudCheckRes.json().catch(() => null)) as ShopeeSessionStatus | null
        if (cloudCheckRes.ok && cloudData && cloudData.ok) {
          onSessionUpdated(cloudData)
          toast({
            title: cloudData.alive
              ? `Cloud 24/7 đang giữ phiên Live (${cloudData.username} · #${cloudData.shopId})`
              : 'Kho Phiên Cloud cần nạp Cookie mới',
            description: cloudData.alive
              ? `Render Singapore + Supabase AES-256-GCM đang duy trì ${cloudData.cookieCount} cookies hợp lệ.`
              : 'Cookie trên Kênh Người Bán đã hết hạn. Hãy dán lệnh cURL ngay bên dưới để đẩy thẳng lên Cloud.',
            variant: cloudData.alive ? 'default' : 'destructive',
          })
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
          ? `Đang duy trì ${refreshed.cookieCount} cookies hợp lệ (đã đồng bộ Kho Mã Hóa Supabase).`
          : 'Cookie đã hết hạn trên Kênh Người Bán. Hãy dùng Trình duyệt Đăng nhập 1 lần hoặc dán cURL.',
        variant: refreshed.alive ? 'default' : 'destructive',
      })
    } catch {
      try {
        const fallbackStatus = await apiGet<ShopeeSessionStatus>('/api/channels/shopee-session')
        onSessionUpdated(fallbackStatus)
      } catch {
        // Bỏ qua nếu ngoại tuyến
      }
      toast({
        title: 'Chưa kết nối được Trạm Cloud hoặc Daemon cục bộ',
        description:
          'Trạm Render Free có thể đang khởi động lại (~40s). Vui lòng bấm Kiểm tra phiên lại sau ít giây.',
        variant: 'destructive',
      })
    } finally {
      setChecking(false)
    }
  }, [
    bridgePort,
    cloudBackendOrigin,
    enforceShopLock,
    onSessionUpdated,
    sessionStatus,
    shopId,
    toast,
    username,
  ])

  const handleLaunchOneTimeBrowser = async () => {
    setLaunchingBrowser(true)
    try {
      if (isStaticBetaRuntime()) {
        await navigator.clipboard.writeText('launch-chrome-shopee.bat').catch(() => null)
        toast({
          title: 'Chạy file launch-chrome-shopee.bat trên máy Windows của bạn',
          description:
            'Đã sao chép tên lệnh launch-chrome-shopee.bat — mở 1 lần để lưu hồ sơ đăng nhập bền vững kèm Extension tự động.',
        })
        return
      }
      const res = await apiPost<ShopeeSessionStatus & { message?: string }>(
        '/api/channels/shopee-session',
        { action: 'LAUNCH_ONE_TIME_BROWSER' }
      )
      setAwaitingBrowserLogin(true)
      onSessionUpdated(res)
      toast({
        title: 'Đã mở Trình duyệt Đăng nhập 1 lần!',
        description:
          res.message ||
          'Hãy đăng nhập banhang.shopee.vn trên cửa sổ vừa mở — hệ thống sẽ tự động nhận phiên ngay khi bạn đăng nhập xong.',
      })
    } catch (err) {
      toast({
        title: 'Chưa thể tự mở trình duyệt từ xa',
        description:
          err instanceof Error
            ? err.message
            : 'Bạn hãy chạy trực tiếp file launch-chrome-shopee.bat trong thư mục dự án.',
        variant: 'destructive',
      })
    } finally {
      setLaunchingBrowser(false)
    }
  }

  const handleSyncFromCdp = async () => {
    setSyncingCdp(true)
    try {
      if (isStaticBetaRuntime()) {
        const cdpRes = await fetch(`http://127.0.0.1:${bridgePort}/shopee/sync-cdp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expectedShopId: enforceShopLock ? shopId : '' }),
        })
        const cdpData = (await cdpRes.json().catch(() => ({}))) as {
          ok?: boolean
          alive?: boolean
          shopId?: string
          username?: string
          cookieCount?: number
          error?: string
        }
        if (!cdpRes.ok || !cdpData.ok) {
          throw new Error(
            cdpData.error ||
              'Chưa phát hiện phiên đăng nhập trên Trình duyệt Hồ sơ Bền vững (:9222).'
          )
        }
        toast({
          title: 'Đã hút phiên tự động thành công!',
          description: `Shop ${cdpData.username || username} (#${cdpData.shopId || shopId}) · ${cdpData.cookieCount || 0} cookies.`,
        })
        if (sessionStatus) {
          onSessionUpdated({
            ...sessionStatus,
            daemonOnline: true,
            cdpOnline: true,
            alive: true,
            shopId: cdpData.shopId || shopId,
            username: cdpData.username || username,
            cookieCount: cdpData.cookieCount ?? sessionStatus.cookieCount,
            source: 'CHROME_CDP_ONE_TIME_LOGIN',
            updatedAt: new Date().toISOString(),
          })
        } else {
          onSessionUpdated()
        }
        onOpenChange(false)
        return
      }

      const res = await apiPost<ShopeeSessionStatus & { message?: string }>(
        '/api/channels/shopee-session',
        {
          action: 'SYNC_FROM_CDP',
          enforceShopLock,
        }
      )
      onSessionUpdated(res)
      toast({
        title: 'Đồng bộ phiên Đăng nhập 1 lần thành công!',
        description:
          res.message ||
          `Đã kết nối Live cho shop ${res.username} (#${res.shopId}) không cần Partner ID.`,
      })
      onOpenChange(false)
    } catch (err) {
      toast({
        title: 'Chưa hút được phiên từ Trình duyệt (:9222)',
        description:
          err instanceof Error
            ? err.message
            : 'Hãy bấm «Mở Trình duyệt Đăng nhập 1 lần» và đăng nhập Kênh Người Bán trước.',
        variant: 'destructive',
      })
    } finally {
      setSyncingCdp(false)
    }
  }

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
      const isStaticHost = isStaticBetaRuntime()

      if (isStaticHost) {
        let localOk = false
        let localShopId = shopId
        let localUsername = username

        // 1. Thử nạp song song vào Python Daemon cục bộ (:51898) nếu máy bán hàng đang bật
        try {
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
            signal: AbortSignal.timeout(3000),
          })
          const bridgeData = (await bridgeRes.json().catch(() => ({}))) as {
            ok?: boolean
            shopId?: string
            username?: string
            error?: string
          }
          if (bridgeRes.status === 409) {
            throw new Error(
              bridgeData.error ||
                `Tài khoản Shopee trong lệnh cURL không khớp với shop liên kết (#${shopId}).`
            )
          }
          if (bridgeRes.ok && bridgeData.ok) {
            localOk = true
            localShopId = bridgeData.shopId || shopId
            localUsername = bridgeData.username || username
          }
        } catch (localErr) {
          if (localErr instanceof Error && localErr.message.includes('không khớp')) {
            throw localErr
          }
          // Máy cục bộ đang tắt -> tiếp tục đẩy thẳng lên Trạm Cloud 24/7 (Render Singapore)
        }

        // 2. Luôn đẩy thẳng lên Kho Phiên Mã Hóa Cloud 24/7 (Supabase AES-256-GCM + Render Singapore)
        const cloudRes = await fetch(`${cloudBackendOrigin}/api/channels/shopee-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'IMPORT_CURL',
            rawInput,
            enforceShopLock,
          }),
          signal: AbortSignal.timeout(65000),
        }).catch(() => null)

        if (cloudRes) {
          const cloudJson = (await cloudRes.json().catch(() => ({}))) as ShopeeSessionStatus & {
            error?: string
            message?: string
          }
          if (cloudRes.ok && cloudJson.ok) {
            toast({
              title: localOk
                ? 'Đã đồng bộ Kép: Máy bán hàng + Cloud 24/7!'
                : 'Đã đẩy phiên thẳng lên Cloud 24/7 thành công!',
              description:
                cloudJson.message ||
                `Shop ${cloudJson.username || localUsername} (#${cloudJson.shopId || localShopId}) · Kho Supabase AES-256-GCM + Render Singapore.`,
            })
            setRawInput('')
            onSessionUpdated({
              ...cloudJson,
              daemonOnline: localOk || cloudJson.daemonOnline,
              alive: true,
            })
            onOpenChange(false)
            return
          }
          if (!localOk) {
            throw new Error(
              cloudJson.error ||
                'Cookie đã hết hạn hoặc bị Shopee từ chối. Hãy tải lại banhang.shopee.vn rồi lấy lệnh cURL mới.'
            )
          }
        }

        if (localOk) {
          toast({
            title: 'Đã xác thực & nạp Cookie cục bộ thành công!',
            description: `Shop ${localUsername} (#${localShopId}) · ${parsed.cookieCount} cookies (Daemon tự đồng bộ lên Supabase Vault).`,
          })
          setRawInput('')
          if (sessionStatus) {
            onSessionUpdated({
              ...sessionStatus,
              daemonOnline: true,
              alive: true,
              shopId: localShopId,
              username: localUsername,
              cookieCount: parsed.cookieCount,
              source: 'MANUAL_CURL_IMPORT',
              updatedAt: new Date().toISOString(),
            })
          } else {
            onSessionUpdated()
          }
          onOpenChange(false)
          return
        }

        throw new Error(
          'Không kết nối được Trạm Cloud Render Singapore (có thể đang thức dậy sau ngủ đông ~40s). Hãy bấm Xác thực & Nạp lại ngay!'
        )
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
      typeof window !== 'undefined' && !isStaticBetaRuntime()
        ? window.location.origin
        : 'http://127.0.0.1:3010'

    const files = generateShopeeExtensionFiles({
      shopId,
      username,
      shopLabel: DEFAULT_SHOPEE_SHOP_BINDING.shopLabel,
      cmsOrigin: origin,
      cloudOrigin: cloudBackendOrigin,
      syncToCloud: true,
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
  }, [bridgePort, cloudBackendOrigin, shopId, username])

  const handleDownloadShopExtension = async () => {
    setDownloadingZip(true)
    try {
      const isStaticHost = isStaticBetaRuntime()

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

  // Tự động thăm dò ngầm cổng CDP (:9222) mỗi 5 giây sau khi mở Trình duyệt Đăng nhập 1 lần
  // (hoạt động mượt ngay cả trên Chrome v137+/v157 nơi Google tắt cờ --load-extension)
  useEffect(() => {
    if (!open || isLive || isStaticBetaRuntime()) return
    if (!awaitingBrowserLogin && !sessionStatus?.cdpOnline) return

    let cancelled = false
    const timer = setInterval(async () => {
      if (cancelled || syncingCdp || submitting) return
      try {
        const res = await fetch('/api/channels/shopee-session', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'SYNC_FROM_CDP',
            enforceShopLock,
          }),
        })
        if (!res.ok) return
        const data = (await res.json().catch(() => null)) as
          | (ShopeeSessionStatus & { message?: string })
          | null
        if (!cancelled && data && data.ok && data.alive) {
          setAwaitingBrowserLogin(false)
          onSessionUpdated(data)
          toast({
            title: 'Đã tự động kết nối phiên Đăng nhập 1 lần!',
            description:
              data.message ||
              `Shop ${data.username} (#${data.shopId}) đã lên đèn xanh Live không cần Partner ID.`,
          })
          onOpenChange(false)
        }
      } catch {
        // Bỏ qua im lặng khi người dùng đang quét QR / nhập mật khẩu trên banhang.shopee.vn
      }
    }, 5000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [
    awaitingBrowserLogin,
    enforceShopLock,
    isLive,
    onOpenChange,
    onSessionUpdated,
    open,
    sessionStatus?.cdpOnline,
    submitting,
    syncingCdp,
    toast,
  ])

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

        {/* Khối Trạng thái Kho Phiên Mã Hóa Cloud ($0 Supabase AES-256-GCM + Leader Lease Render Singapore) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200/90 bg-sky-50/60 px-3.5 py-2 text-[11px] text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-200">
          <div className="flex items-center gap-2">
            <Cloud className="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <div>
              <span className="font-semibold">
                Kho Phiên Cloud 24/7 ($0 · Supabase AES-256-GCM + Render Singapore):
              </span>{' '}
              {sessionStatus?.cloudVault?.hasEncryptedSession ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  Đã lưu mã hóa ({sessionStatus.cloudVault.cookieCount} cookies · v
                  {sessionStatus.cloudVault.version})
                </span>
              ) : (
                <span className="opacity-80">
                  Tự động lưu mã hóa ngay khi bạn nạp cURL hoặc bật Extension
                </span>
              )}
              <div className="opacity-85">
                Khóa chống xung đột (Leader Lease):{' '}
                <b>
                  {sessionStatus?.cloudVault?.leaderLease?.holderLabel ||
                    'Máy bán hàng VN ưu tiên khi bật · Cloud Singapore tự tiếp quản khi tắt máy'}
                </b>
              </div>
            </div>
          </div>
          <Badge variant="outline" className="border-sky-300 bg-background/80 text-[10px] font-mono">
            region: singapore
          </Badge>
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
              Đăng nhập 1 lần &amp; Extension
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

          {/* ==================== TAB 2: ĐĂNG NHẬP 1 LẦN & EXTENSION RIÊNG CỦA SHOP ==================== */}
          <TabsContent value="extension" className="mt-3 space-y-3.5">
            {/* Khối Đăng Nhập 1 Lần (Không cần Partner ID / Partner Key) */}
            <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/85 via-background to-teal-50/40 p-4 dark:border-emerald-900/60 dark:from-emerald-950/30 dark:to-background">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                    Khuyên dùng · Không cần Partner ID
                  </Badge>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Hồ sơ Bền vững + CDP :9222{' '}
                    {sessionStatus?.cdpOnline ? '· Đang mở sẵn' : ''}
                  </span>
                </div>
              </div>
              <h4 className="mt-1.5 text-sm font-bold">
                Đăng nhập 1 lần Kênh Người Bán Shopee (0 Partner Key · 0 Copy cURL)
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Mở hồ sơ trình duyệt riêng biệt của <b>{username}</b> đã nạp sẵn Extension và cổng
                hồi phục ngầm <code>127.0.0.1:9222</code>. Bạn chỉ cần quét QR / đăng nhập{' '}
                <code>banhang.shopee.vn</code> <b>đúng 1 lần duy nhất</b> — hệ thống tự động gia hạn
                phiên phụ <code>SPC_SC_SESSION</code> và tự hút lại Cookie mỗi khi cần.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={launchingBrowser}
                  onClick={() => void handleLaunchOneTimeBrowser()}
                >
                  {launchingBrowser ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Mở Trình duyệt Đăng nhập 1 lần
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={syncingCdp}
                  onClick={() => void handleSyncFromCdp()}
                >
                  {syncingCdp ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                  )}
                  Hút phiên tự động từ Trình duyệt (:9222)
                </Button>
              </div>
            </div>

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
