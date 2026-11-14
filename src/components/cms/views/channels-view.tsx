'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatCompactVND, formatNumber, formatVND } from '@/lib/format'
import type { Channel } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ChannelBadge, ConnectedDot, SyncInfo } from '@/components/cms/channel-badge'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import {
  ShopeeCookieSyncDialog,
  type ShopeeSessionStatus,
} from '@/components/cms/shopee-cookie-sync-dialog'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { useRealtime } from '@/hooks/use-realtime'
import {
  AlertTriangle,
  ArrowLeftRight,
  Calculator,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Loader2,
  PackagePlus,
  Puzzle,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Store,
  ShoppingCart,
  Unlink,
  Wallet,
  Zap,
} from 'lucide-react'

interface SuggestedCmsProduct {
  id: string
  sku: string
  name: string
  sellPrice: number
  stock: number
  score: number
  reason: string
}

interface UnlinkedMarketplaceItem {
  id: string
  channelKey: string
  shopeeItemId: string
  shopeeModelId: string
  shopeeSku: string
  parentSku: string
  name: string
  modelName: string
  description?: string
  sellPrice: number
  stock: number
  image: string | null
  images: string[]
  isUnlisted: boolean
  shopId: string
  shopUsername: string
  detectedAt: string
  suggestedCmsProducts: SuggestedCmsProduct[]
}

interface LinkedMarketplaceItem {
  cmsProductId: string
  cmsSku: string
  cmsName: string
  cmsStock: number
  cmsSellPrice: number
  cmsImage: string | null
  channelKey: string
  shopeeItemId: string
  shopeeModelId: string
  shopeeModelSku: string
  shopeeModelName: string
  lastSyncedShopeeStock: number
  lastSyncedShopeePrice: number
  liveShopeeStock?: number
  openingStockOrigin?: 'SHOPEE_MARKETPLACE' | 'CMS_WAREHOUSE'
  openingStockOriginLabel?: string
  openingStockQty?: number
  shopeeSoldQty?: number
  posSoldQty?: number
  shopeeAdjustDelta?: number
  manualDelta?: number
  expectedStockByFormula?: number
  unreconciledShopeeDelta?: number
  reconciliationStatus?:
    | 'RECONCILED_OK'
    | 'PENDING_SHOPEE_ORDER'
    | 'WAREHOUSE_EMPTY_MARKETPLACE_HAS_STOCK'
    | 'SHOPEE_DIRECT_ADJUSTED'
    | 'STOCK_DRIFT'
  lastReconcileDecision?: string
  lastReconcileDecisionLabel?: string
  lastReconcileReason?: string
  lastReconcileAt?: string
  reconciledOrders?: Array<{
    code: string
    channelKey: string
    shopeeOrderSn?: string
    quantity: number
    createdAt: string
  }>
  linkMode: string
  lastSyncedAt: string | null
  syncStatus: 'IN_SYNC' | 'STOCK_DRIFT' | 'PRICE_DRIFT'
  isUnlisted?: boolean
  lowStockThreshold?: number
  pendingOutboxSync?: boolean
}

interface CmsProductOption {
  id: string
  sku: string
  name: string
  sellPrice: number
  stock: number
  image: string | null
  linkedShopeeModelId: string | null
}

interface ProductLinksResponse {
  ok: boolean
  stats: {
    totalMarketplaceItems: number
    linkedCount: number
    unlinkedCount: number
    driftCount: number
    unlistedCount?: number
    oversellRiskCount?: number
    lowStockRiskCount?: number
    pendingOutboxCount?: number
  }
  linkedItems: LinkedMarketplaceItem[]
  unlinkedItems: UnlinkedMarketplaceItem[]
  cmsProducts: CmsProductOption[]
}

export function ChannelsView() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [pendingDisconnect, setPendingDisconnect] = useState<Channel | null>(null)
  const [feeDrafts, setFeeDrafts] = useState<Record<string, string>>({})
  const [savingFeeId, setSavingFeeId] = useState<string | null>(null)

  // State cho Trung tâm Liên kết Sản phẩm Sàn <-> Hàng hóa CMS
  const [linkData, setLinkData] = useState<ProductLinksResponse | null>(null)
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [linkTab, setLinkTab] = useState<'ALL' | 'UNLINKED' | 'LINKED' | 'DRIFT' | 'UNLISTED'>('ALL')
  const [linkSearch, setLinkSearch] = useState('')
  const [linkingBusyId, setLinkingBusyId] = useState<string | null>(null)

  // Dialog Liên kết với Hàng hóa CMS có sẵn
  const [linkModalItem, setLinkModalItem] = useState<UnlinkedMarketplaceItem | null>(null)
  const [selectedCmsProductId, setSelectedCmsProductId] = useState<string>('')
  const [cmsModalSearch, setCmsModalSearch] = useState<string>('')
  const [syncDirection, setSyncDirection] = useState<'CMS_TO_SHOPEE' | 'SHOPEE_TO_CMS'>('CMS_TO_SHOPEE')

  // Dialog Tạo mới Hàng hóa CMS & Liên kết
  const [createModalItem, setCreateModalItem] = useState<UnlinkedMarketplaceItem | null>(null)
  const [customSkuDraft, setCustomSkuDraft] = useState<string>('')
  const [createStockInitMode, setCreateStockInitMode] = useState<'TAKE_FROM_MARKETPLACE' | 'KEEP_WAREHOUSE_STOCK'>(
    'TAKE_FROM_MARKETPLACE'
  )

  // Dialog Ghi chú Lý do khi Xác nhận Tồn Sàn hoặc Giữ Tồn Kho CMS
  const [reconcileModalItem, setReconcileModalItem] = useState<LinkedMarketplaceItem | null>(null)
  const [reconcileModalMode, setReconcileModalMode] = useState<
    'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT' | 'KEEP_WAREHOUSE_AND_PUSH' | 'TAKE_OPENING_FROM_MARKETPLACE'
  >('ACCEPT_SHOPEE_DIRECT_ADJUSTMENT')
  const [reconcileReasonDraft, setReconcileReasonDraft] = useState<string>('')

  // Thao tác hàng loạt (Bulk Actions) cho bảng Đã liên kết & Chưa liên kết
  const [selectedLinkedIds, setSelectedLinkedIds] = useState<string[]>([])
  const [selectedUnlinkedKeys, setSelectedUnlinkedKeys] = useState<string[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkPriceMode, setBulkPriceMode] = useState<'NONE' | 'SET' | 'ADD_AMOUNT' | 'ADD_PERCENT'>('NONE')
  const [bulkPriceValue, setBulkPriceValue] = useState<string>('')
  const [bulkStockMode, setBulkStockMode] = useState<'NONE' | 'SET' | 'ADD_DELTA'>('NONE')
  const [bulkStockValue, setBulkStockValue] = useState<string>('')
  const [shopeeSession, setShopeeSession] = useState<ShopeeSessionStatus | null>(null)
  const [cookieDialogOpen, setCookieDialogOpen] = useState(false)
  const [cookieDialogTab, setCookieDialogTab] = useState<'curl' | 'extension'>('curl')

  const { toast } = useToast()

  const openCookieSyncDialog = useCallback((tab: 'curl' | 'extension' = 'curl') => {
    setCookieDialogTab(tab)
    setCookieDialogOpen(true)
  }, [])

  const loadShopeeSession = useCallback(async () => {
    try {
      const res = await apiGet<ShopeeSessionStatus>('/api/channels/shopee-session')
      setShopeeSession(res)
    } catch {
      // ignore silent error when offline
    }
  }, [])

  const loadLinks = useCallback(async (silent = false) => {
    if (!silent) setLoadingLinks(true)
    try {
      const res = await apiGet<ProductLinksResponse>('/api/channels/product-links')
      setLinkData(res)
    } catch {
      // ignore silent error
    } finally {
      if (!silent) setLoadingLinks(false)
    }
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const [data] = await Promise.all([
        apiGet<{ channels: Channel[] }>('/api/channels'),
        loadLinks(silent),
        loadShopeeSession(),
      ])
      setChannels(data.channels)
    } catch (e) {
      if (!silent) {
        const message = e instanceof Error ? e.message : 'Không thể tải kênh bán'
        setError(message)
        toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [toast, loadLinks])

  useEffect(() => {
    void load()
  }, [load])

  // Đồng bộ ngầm tức thì qua WebSocket / Realtime mà không chớp Skeleton
  useRealtime((e) => {
    if (
      [
        'channel.updated',
        'channel.unlinked_item',
        'channel.product_linked',
        'inventory.updated',
        'product.updated',
        'order.created',
        'marketplace.unlisted_alert',
      ].includes(e.type)
    ) {
      void load(true)
    }
  })

  const handleConnect = async (channel: Channel) => {
    setTogglingId(channel.id)
    setChannels((prev) =>
      prev ? prev.map((c) => (c.id === channel.id ? { ...c, connected: true } : c)) : null
    )
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { connected: true })
      toast({
        title: `Đã kết nối kênh ${channel.name}`,
        description: 'Sản phẩm đang bán đã được đẩy lên kênh.',
      })
      await load()
    } catch (e) {
      setChannels((prev) =>
        prev ? prev.map((c) => (c.id === channel.id ? { ...c, connected: false } : c)) : null
      )
      toast({
        title: 'Kết nối thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const handleConfirmDisconnect = async () => {
    if (!pendingDisconnect) return
    const channel = pendingDisconnect
    setTogglingId(channel.id)
    setChannels((prev) =>
      prev ? prev.map((c) => (c.id === channel.id ? { ...c, connected: false } : c)) : null
    )
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { connected: false })
      toast({
        title: `Đã tắt bán / ngắt kết nối kênh ${channel.name}`,
        description: 'Toàn bộ sản phẩm đã được đồng bộ gỡ khỏi danh sách bán trên kênh.',
      })
      setPendingDisconnect(null)
      await load()
    } catch (e) {
      setChannels((prev) =>
        prev ? prev.map((c) => (c.id === channel.id ? { ...c, connected: true } : c)) : null
      )
      toast({
        title: 'Ngắt kết nối thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setTogglingId(null)
    }
  }

  const handleSync = async (channel: Channel) => {
    setSyncingId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { sync: true })
      toast({ title: `Đã đồng bộ kênh ${channel.name}`, description: 'Dữ liệu kênh & liên kết SKU đã được cập nhật.' })
      await load()
    } catch (e) {
      toast({
        title: 'Đồng bộ thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSyncingId(null)
    }
  }

  // ===== Thao tác Liên kết Sản phẩm Sàn <-> Hàng hóa CMS =====
  const openLinkModal = (item: UnlinkedMarketplaceItem, preselectId?: string) => {
    setLinkModalItem(item)
    const highConfidenceMatch = item.suggestedCmsProducts.find((s) => s.score >= 80)
    const targetId = preselectId || highConfidenceMatch?.id || ''
    setSelectedCmsProductId(targetId)
    setCmsModalSearch('')
    const matchedProd = linkData?.cmsProducts.find((cp) => cp.id === targetId)
    // Nếu Kho trống = 0 mà Sàn có tồn > 0, gợi ý mặc định lấy số tồn từ Sàn làm Tồn đầu kỳ
    if (matchedProd && matchedProd.stock === 0 && item.stock > 0) {
      setSyncDirection('SHOPEE_TO_CMS')
    } else {
      setSyncDirection('CMS_TO_SHOPEE')
    }
  }

  const openCreateModal = (item: UnlinkedMarketplaceItem) => {
    setCreateModalItem(item)
    setCreateStockInitMode('KEEP_WAREHOUSE_STOCK')
    const suggestedSku =
      item.shopeeSku ||
      (item.parentSku && item.modelName.toLowerCase().includes('combo')
        ? `BM-COMBO-SEN-01-TRANG`
        : item.parentSku
          ? `${item.parentSku}-${item.shopeeModelId.slice(-4)}`
          : `SP-${item.shopeeModelId || item.shopeeItemId}`)
    setCustomSkuDraft(suggestedSku.toUpperCase())
  }

  const handleExecuteLinkToExisting = async (
    item: UnlinkedMarketplaceItem,
    targetCmsId: string,
    direction: 'CMS_TO_SHOPEE' | 'SHOPEE_TO_CMS'
  ) => {
    if (!targetCmsId) {
      toast({ title: 'Vui lòng chọn sản phẩm CMS để liên kết', variant: 'destructive' })
      return
    }
    setLinkingBusyId(`${item.shopeeItemId}_${item.shopeeModelId}`)
    try {
      const stockInitMode = direction === 'SHOPEE_TO_CMS' ? 'TAKE_FROM_MARKETPLACE' : 'KEEP_WAREHOUSE_STOCK'
      const res = await apiPost<{ ok: boolean; product?: { sku?: string; name?: string; stock?: number } }>(
        '/api/channels/product-links',
        {
          action: 'LINK_TO_EXISTING',
          cmsProductId: targetCmsId,
          shopeeItemId: item.shopeeItemId,
          shopeeModelId: item.shopeeModelId,
          shopeeSku: item.shopeeSku,
          parentSku: item.parentSku,
          name: item.name,
          modelName: item.modelName,
          description: item.description,
          sellPrice: item.sellPrice,
          stock: item.stock,
          image: item.image,
          images: item.images,
          isUnlisted: item.isUnlisted,
          shopId: item.shopId,
          shopUsername: item.shopUsername,
          syncDirection: direction,
          stockInitMode,
        }
      )
      const fallbackProd = linkData?.cmsProducts.find((cp) => cp.id === targetCmsId)
      const linkedSku = res.product?.sku || fallbackProd?.sku || targetCmsId
      const linkedStock =
        typeof res.product?.stock === 'number'
          ? res.product.stock
          : direction === 'SHOPEE_TO_CMS'
            ? item.stock
            : (fallbackProd?.stock ?? 0)
      toast({
        title: `Đã liên kết thành công với [${linkedSku}]`,
        description:
          direction === 'SHOPEE_TO_CMS'
            ? `Đã lấy số tồn từ Sàn (${linkedStock} bộ) làm Tồn đầu kỳ và ghi chú rõ gốc tồn đầu từ Sàn Shopee.`
            : `Đã liên kết theo tồn tại Kho CMS (${linkedStock} bộ) và đẩy đồng bộ lên Sàn Shopee.`,
      })
      setLinkModalItem(null)
      await loadLinks()
    } catch (e) {
      toast({
        title: 'Liên kết thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const handleExecuteCreateAndLink = async () => {
    if (!createModalItem || !customSkuDraft.trim()) return
    const item = createModalItem
    const draftSku = customSkuDraft.trim().toUpperCase()
    setLinkingBusyId(`${item.shopeeItemId}_${item.shopeeModelId}`)
    try {
      const res = await apiPost<{ ok: boolean; product?: { sku?: string; name?: string; stock?: number } }>(
        '/api/channels/product-links',
        {
          action: 'CREATE_AND_LINK',
          customSku: draftSku,
          shopeeItemId: item.shopeeItemId,
          shopeeModelId: item.shopeeModelId,
          shopeeSku: item.shopeeSku,
          parentSku: item.parentSku,
          name: item.name,
          modelName: item.modelName,
          description: item.description,
          sellPrice: item.sellPrice,
          stock: item.stock,
          image: item.image,
          images: item.images,
          isUnlisted: item.isUnlisted,
          shopId: item.shopId,
          shopUsername: item.shopUsername,
          stockInitMode: createStockInitMode,
          syncDirection: createStockInitMode === 'TAKE_FROM_MARKETPLACE' ? 'SHOPEE_TO_CMS' : 'CMS_TO_SHOPEE',
        }
      )
      const createdSku = res.product?.sku || draftSku
      const createdStock =
        typeof res.product?.stock === 'number'
          ? res.product.stock
          : createStockInitMode === 'TAKE_FROM_MARKETPLACE'
            ? item.stock
            : 0
      toast({
        title: `Đã tạo mới & liên kết [${createdSku}]`,
        description:
          createStockInitMode === 'TAKE_FROM_MARKETPLACE'
            ? `Khởi tạo [${createdSku}] với Tồn đầu kỳ = ${createdStock} bộ (Gốc tồn đầu từ Sàn Shopee).`
            : `Khởi tạo [${createdSku}] tại Kho trống = 0 bộ và liên kết với Sàn Shopee.`,
      })
      setCreateModalItem(null)
      await loadLinks()
    } catch (e) {
      toast({
        title: 'Tạo & Liên kết thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const getDefaultReasonForMode = (
    mode: 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT' | 'KEEP_WAREHOUSE_AND_PUSH' | 'TAKE_OPENING_FROM_MARKETPLACE'
  ) => {
    if (mode === 'TAKE_OPENING_FROM_MARKETPLACE') {
      return 'Chốt tồn đầu kỳ từ Sàn Shopee khi kho CMS đang trống (= 0)'
    }
    if (mode === 'KEEP_WAREHOUSE_AND_PUSH') {
      return 'Thao tác sửa nhầm trên Sàn — Giữ nguyên số tồn chuẩn tại Kho CMS & đẩy lại lên Sàn'
    }
    return 'Kiểm đếm thực tế tại kệ khớp với số tồn đã điều chỉnh trên Sàn Shopee'
  }

  const openReconcileReasonModal = (
    item: LinkedMarketplaceItem,
    mode: 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT' | 'KEEP_WAREHOUSE_AND_PUSH' | 'TAKE_OPENING_FROM_MARKETPLACE'
  ) => {
    setReconcileModalItem(item)
    setReconcileModalMode(mode)
    setReconcileReasonDraft(item.lastReconcileReason || getDefaultReasonForMode(mode))
  }

  const handleResolveOpeningOrReconcile = async (
    linked: LinkedMarketplaceItem,
    resolveMode:
      | 'TAKE_OPENING_FROM_MARKETPLACE'
      | 'KEEP_WAREHOUSE_AND_PUSH'
      | 'RECONCILE_SHOPEE_ORDERS'
      | 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT',
    customReason?: string
  ) => {
    setLinkingBusyId(linked.cmsProductId)
    try {
      const adjustReason = (customReason ?? reconcileReasonDraft).trim()
      const res = await apiPost<{
        ok: boolean
        message: string
        reconciliation?: { unexplainedShopeeDelta?: number }
      }>('/api/channels/product-links', {
        action: 'RESOLVE_OPENING_OR_RECONCILE',
        cmsProductId: linked.cmsProductId,
        shopeeItemId: linked.shopeeItemId,
        shopeeModelId: linked.shopeeModelId,
        stock: linked.liveShopeeStock ?? linked.lastSyncedShopeeStock,
        resolveMode,
        adjustReason: adjustReason || undefined,
      })
      toast({
        title:
          resolveMode === 'TAKE_OPENING_FROM_MARKETPLACE'
            ? `Đã chốt Gốc tồn đầu từ Sàn cho [${linked.cmsSku}]`
            : resolveMode === 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'
              ? `Đã đối soát nhận ĐC từ Sàn cho [${linked.cmsSku}]`
              : resolveMode === 'KEEP_WAREHOUSE_AND_PUSH'
                ? `Đã giữ tồn Kho CMS cho [${linked.cmsSku}]`
                : `Kết quả đối chiếu đơn Sàn ↔ Kho CMS [${linked.cmsSku}]`,
        description: res.message || `Đã cập nhật đối soát tồn kho cho [${linked.cmsSku}].`,
      })
      setReconcileModalItem(null)
      await loadLinks(true)
      // Nếu vừa bấm "Đối chiếu đơn" mà phát hiện lệch do điều chỉnh trực tiếp trên Sàn, mở luôn hộp thoại ghi lý do đối soát
      if (
        resolveMode === 'RECONCILE_SHOPEE_ORDERS' &&
        res.reconciliation?.unexplainedShopeeDelta &&
        res.reconciliation.unexplainedShopeeDelta !== 0
      ) {
        openReconcileReasonModal(linked, 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT')
      }
    } catch (e) {
      toast({
        title: 'Thao tác đối chiếu thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const handleUnlinkProduct = async (linked: LinkedMarketplaceItem) => {
    setLinkingBusyId(linked.cmsProductId)
    try {
      await apiPost('/api/channels/product-links', {
        action: 'UNLINK',
        cmsProductId: linked.cmsProductId,
      })
      toast({
        title: `Đã gỡ liên kết [${linked.cmsSku}]`,
        description: `Phân loại Shopee (${linked.shopeeModelName || linked.shopeeModelId}) đã chuyển về danh sách "Chưa liên kết" để bạn ghép nối lại.`,
      })
      await loadLinks()
    } catch (e) {
      toast({
        title: 'Hủy liên kết thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const handleQuickPushStock = async (linked: LinkedMarketplaceItem) => {
    setLinkingBusyId(linked.cmsProductId)
    const shopeeChannelId = channels?.find((c) => c.key === 'SHOPEE')?.id
    try {
      const res = await apiPost<{
        ok: boolean
        sku?: string
        targetStock?: number
        targetPrice?: number
      }>('/api/channels/product-links', {
        action: 'PUSH_STOCK_TO_CHANNEL',
        productId: linked.cmsProductId,
        channelId: shopeeChannelId,
        channelKey: 'SHOPEE',
      })
      const pushedSku = res.sku || linked.cmsSku
      const pushedStock = typeof res.targetStock === 'number' ? res.targetStock : linked.cmsStock
      const pushedPrice = typeof res.targetPrice === 'number' ? res.targetPrice : linked.cmsSellPrice
      toast({
        title: `Đã đẩy đồng bộ [${pushedSku}] lên sàn Shopee`,
        description: `Tồn kho: ${pushedStock} · Giá bán: ${formatVND(pushedPrice)}`,
      })
      void loadLinks(true)
    } catch (e) {
      toast({
        title: 'Đẩy đồng bộ thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const handleQuickToggleVisibility = async (linked: LinkedMarketplaceItem) => {
    setLinkingBusyId(linked.cmsProductId)
    const nextStatus = linked.isUnlisted ? 'ACTIVE' : 'UNLISTED'
    const shopeeChannelId = channels?.find((c) => c.key === 'SHOPEE')?.id
    try {
      await apiPost('/api/channels/product-links', {
        action: 'TOGGLE_CHANNEL_STATUS',
        productId: linked.cmsProductId,
        channelId: shopeeChannelId,
        channelKey: 'SHOPEE',
        nextStatus,
      })
      setLinkData((prev) => {
        if (!prev) return prev
        const nextIsUnlisted = nextStatus === 'UNLISTED'
        const updatedItems = prev.linkedItems.map((it) =>
          it.cmsProductId === linked.cmsProductId ? { ...it, isUnlisted: nextIsUnlisted } : it
        )
        const nextUnlistedCount = updatedItems.filter((it) => it.isUnlisted).length
        return {
          ...prev,
          linkedItems: updatedItems,
          stats: {
            ...prev.stats,
            unlistedCount: nextUnlistedCount,
          },
        }
      })
      toast({
        title: nextStatus === 'ACTIVE' ? `Đã mở bán lại [${linked.cmsSku}] trên sàn` : `Đã tạm ẩn [${linked.cmsSku}] trên sàn`,
        description: `Phân loại: ${linked.shopeeModelName || linked.cmsName}`,
      })
      void loadLinks(true)
    } catch (e) {
      toast({
        title: 'Đổi trạng thái hiển thị thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setLinkingBusyId(null)
    }
  }

  const handleExecuteBulkLinkedAction = async (
    bulkType: 'PUSH_STOCK_AND_PRICE' | 'SET_ACTIVE' | 'SET_UNLISTED' | 'UPDATE_PRICE_AND_STOCK' | 'UNLINK',
    extraPayload?: Record<string, unknown>
  ) => {
    if (selectedLinkedIds.length === 0) return
    setBulkBusy(true)
    try {
      const res = await apiPost<{ ok: boolean; processedCount?: number; message?: string }>(
        '/api/channels/product-links',
        {
          action: 'BULK_CHANNEL_ACTION',
          bulkType,
          productIds: selectedLinkedIds,
          ...extraPayload,
        }
      )
      const processedCount =
        typeof res.processedCount === 'number' ? res.processedCount : selectedLinkedIds.length
      toast({
        title: `Thao tác hàng loạt hoàn tất (${processedCount} sản phẩm)`,
        description: res.message || `Đã cập nhật thành công ${processedCount} sản phẩm trên kênh bán.`,
      })
      setSelectedLinkedIds([])
      setBulkEditOpen(false)
      await loadLinks(true)
    } catch (e) {
      toast({
        title: 'Thao tác hàng loạt thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setBulkBusy(false)
    }
  }

  const handleExecuteBulkCreateAndLink = async (
    stockInitMode: 'KEEP_WAREHOUSE_STOCK' | 'TAKE_FROM_MARKETPLACE' = 'KEEP_WAREHOUSE_STOCK'
  ) => {
    const selectedItems = filteredUnlinked.filter((it) =>
      selectedUnlinkedKeys.includes(`${it.shopeeItemId}_${it.shopeeModelId}`)
    )
    if (selectedItems.length === 0) return
    setBulkBusy(true)
    try {
      const itemsWithMode = selectedItems.map((it) => ({
        ...it,
        stockInitMode,
        syncDirection: stockInitMode === 'TAKE_FROM_MARKETPLACE' ? 'SHOPEE_TO_CMS' : 'CMS_TO_SHOPEE',
      }))
      const res = await apiPost<{ ok: boolean; createdCount?: number; message?: string }>(
        '/api/channels/product-links',
        {
          action: 'BULK_CREATE_AND_LINK',
          stockInitMode,
          items: itemsWithMode,
        }
      )
      const createdCount =
        typeof res.createdCount === 'number' ? res.createdCount : selectedItems.length
      const fallbackSkus = selectedItems
        .map((it) => (it.shopeeSku || `SP-${it.shopeeModelId || it.shopeeItemId}`).toUpperCase())
        .join(', ')
      const stockModeNote =
        stockInitMode === 'KEEP_WAREHOUSE_STOCK'
          ? 'Giữ tồn Kho CMS = 0 bộ (Chưa nhập kho vật lý)'
          : 'Lấy số tồn khai trên Sàn làm Tồn đầu kỳ'
      toast({
        title: `Đã khởi tạo & liên kết ${createdCount} sản phẩm`,
        description:
          res.message ||
          `Đã khởi tạo và liên kết ${createdCount} mã SKU (${stockModeNote}): ${fallbackSkus}`,
      })
      setSelectedUnlinkedKeys([])
      await loadLinks(true)
    } catch (e) {
      toast({
        title: 'Khởi tạo hàng loạt thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setBulkBusy(false)
    }
  }

  const connectedCount = channels?.filter((c) => c.connected).length ?? 0
  const totalOrders = channels?.reduce((s, c) => s + (c.stats?.orders ?? 0), 0) ?? 0
  const totalRevenue = channels?.reduce((s, c) => s + (c.stats?.revenue ?? 0), 0) ?? 0

  const feeDraftFor = (channel: Channel) => feeDrafts[channel.id] ?? String(channel.feePercent)
  const feeChanged = (channel: Channel) => {
    const raw = feeDraftFor(channel).trim()
    if (raw === '') return false
    const value = Number(raw)
    return Number.isFinite(value) && value !== channel.feePercent
  }

  const handleSaveFee = async (channel: Channel) => {
    const raw = feeDraftFor(channel).trim()
    const value = Number(raw)
    if (raw === '' || !Number.isFinite(value)) return
    setSavingFeeId(channel.id)
    try {
      await apiPatch<{ channel: Channel }>(`/api/channels/${channel.id}`, { feePercent: value })
      toast({
        title: `Đã lưu phí sàn ${channel.name}: ${value}%`,
        description: 'Đơn hàng mới trên kênh này sẽ được ghi nhận phí sàn này.',
      })
      setFeeDrafts((prev) => {
        const next = { ...prev }
        delete next[channel.id]
        return next
      })
      await load()
    } catch (e) {
      toast({
        title: 'Lưu phí sàn thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingFeeId(null)
    }
  }

  const reconChannels = (channels ?? [])
    .filter((c) => c.feePercent > 0)
    .sort((a, b) => (b.stats?.platformFee ?? 0) - (a.stats?.platformFee ?? 0))
  const reconTotals = reconChannels.reduce(
    (acc, c) => ({
      orders: acc.orders + (c.stats?.orders ?? 0),
      revenue: acc.revenue + (c.stats?.revenue ?? 0),
      platformFee: acc.platformFee + (c.stats?.platformFee ?? 0),
      netRevenue: acc.netRevenue + (c.stats?.netRevenue ?? 0),
    }),
    { orders: 0, revenue: 0, platformFee: 0, netRevenue: 0 }
  )

  const normalizedLinkSearch = linkSearch.trim().toLowerCase()
  const filteredUnlinked =
    !linkData?.unlinkedItems ||
    linkTab === 'LINKED' ||
    linkTab === 'DRIFT' ||
    linkTab === 'UNLISTED'
      ? []
      : !normalizedLinkSearch
        ? linkData.unlinkedItems
        : linkData.unlinkedItems.filter(
            (i) =>
              i.name.toLowerCase().includes(normalizedLinkSearch) ||
              i.modelName.toLowerCase().includes(normalizedLinkSearch) ||
              i.shopeeSku.toLowerCase().includes(normalizedLinkSearch) ||
              i.shopeeModelId.toLowerCase().includes(normalizedLinkSearch) ||
              i.shopeeItemId.toLowerCase().includes(normalizedLinkSearch)
          )

  const filteredLinked =
    !linkData?.linkedItems || linkTab === 'UNLINKED'
      ? []
      : linkData.linkedItems.filter((i) => {
          if (linkTab === 'DRIFT' && i.syncStatus === 'IN_SYNC') return false
          if (linkTab === 'UNLISTED' && !i.isUnlisted) return false
          if (!normalizedLinkSearch) return true
          return (
            i.cmsSku.toLowerCase().includes(normalizedLinkSearch) ||
            i.cmsName.toLowerCase().includes(normalizedLinkSearch) ||
            i.shopeeModelSku.toLowerCase().includes(normalizedLinkSearch) ||
            i.shopeeModelName.toLowerCase().includes(normalizedLinkSearch) ||
            i.shopeeModelId.toLowerCase().includes(normalizedLinkSearch)
          )
        })

  const normalizedModalSearch = cmsModalSearch.trim().toLowerCase()
  const filteredModalCmsProducts = useMemo(() => {
    const base = !normalizedModalSearch
      ? (linkData?.cmsProducts ?? [])
      : (linkData?.cmsProducts ?? []).filter(
          (p) =>
            p.sku.toLowerCase().includes(normalizedModalSearch) ||
            p.name.toLowerCase().includes(normalizedModalSearch)
        )
    // Ưu tiên hiển thị các hàng hóa CMS chưa gắn Shopee lên đầu để tránh ghép đè nhầm
    return [...base].sort((a, b) => Number(Boolean(a.linkedShopeeModelId)) - Number(Boolean(b.linkedShopeeModelId)))
  }, [linkData?.cmsProducts, normalizedModalSearch])

  return (
    <div>
      <PageHeader title="Kênh bán" description="Kết nối, đồng bộ tồn kho bất đồng bộ và liên kết mã SKU sản phẩm giữa Sàn TMĐT ↔ Kho CMS" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Kênh đang kết nối"
          value={loading ? '' : `${connectedCount}/${channels?.length ?? 0}`}
          icon={Store}
          loading={loading}
          hint="Sẵn sàng nhận đơn từ các sàn"
        />
        <StatCard
          title="Tổng đơn hàng"
          value={loading ? '' : formatNumber(totalOrders)}
          icon={ShoppingCart}
          loading={loading}
          hint="Gộp từ tất cả các kênh"
        />
        <StatCard
          title="Tổng doanh thu"
          value={loading ? '' : formatCompactVND(totalRevenue)}
          icon={Wallet}
          loading={loading}
          hint={formatVND(totalRevenue)}
        />
      </div>

      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !channels || channels.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Chưa có kênh bán nào"
          description="Thêm kênh bán trong hệ thống để bắt đầu bán hàng đa kênh."
          action={<Button onClick={() => void load()}>Tải lại</Button>}
        />
      ) : (
        <>
          {/* ===== TRUNG TÂM LIÊN KẾT SẢN PHẨM SÀN TMĐT <-> HÀNG HÓA CMS (ƯU TIÊN SỐ 1) ===== */}
          <Card id="sku-linking-hub" className="mb-6 border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ArrowLeftRight className="h-5 w-5 text-orange-500" />
                    Liên kết Sản phẩm Sàn TMĐT ↔ Hàng hóa Kho CMS
                    {(linkData?.stats?.unlinkedCount ?? 0) > 0 && (
                      <Badge variant="destructive" className="ml-1 animate-pulse">
                        {linkData?.stats.unlinkedCount} sản phẩm Sàn chưa khớp SKU
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Khi sản phẩm hoặc phân loại trên Sàn (Shopee) không trùng mã SKU với Kho CMS (hoặc bỏ trống SKU trên Sàn), hệ thống tự động giữ tại đây để bạn liên kết thủ công hoặc khởi tạo mã mới.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(linkData?.stats?.driftCount ?? 0) > 0 && (
                    <Button
                      size="sm"
                      className="bg-orange-600 text-white hover:bg-orange-700"
                      disabled={bulkBusy}
                      onClick={() => {
                        const driftedIds = (linkData?.linkedItems ?? [])
                          .filter((i) => i.syncStatus !== 'IN_SYNC')
                          .map((i) => i.cmsProductId)
                        if (driftedIds.length > 0) {
                          setSelectedLinkedIds(driftedIds)
                          setTimeout(() => void handleExecuteBulkLinkedAction('PUSH_STOCK_AND_PRICE'), 0)
                        }
                      }}
                    >
                      {bulkBusy ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Đồng bộ tất cả lệch ({linkData?.stats.driftCount})
                    </Button>
                  )}
                  <Button
                    variant={shopeeSession?.alive ? 'outline' : 'default'}
                    size="sm"
                    className={
                      shopeeSession?.alive
                        ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/80 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                        : 'bg-orange-600 text-white hover:bg-orange-700'
                    }
                    onClick={() => openCookieSyncDialog('curl')}
                  >
                    <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                    {shopeeSession?.alive
                      ? `Cookie Shopee Live (${shopeeSession.username || 'thaimy1605'})`
                      : 'Nhập cURL / Extension Cookie'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCookieSyncDialog('extension')}
                  >
                    <Puzzle className="mr-1.5 h-3.5 w-3.5 text-orange-600" />
                    Extension Shop
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void loadLinks()} disabled={loadingLinks}>
                    <RefreshCw className={loadingLinks ? 'mr-1.5 h-4 w-4 animate-spin' : 'mr-1.5 h-4 w-4'} />
                    Làm mới liên kết
                  </Button>
                </div>
              </div>

              {shopeeSession && !shopeeSession.alive && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-amber-300 bg-amber-50/80 px-3.5 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      Phiên Cookie Kênh Người Bán Shopee (
                      <b>
                        {shopeeSession.username || 'thaimy1605'} · #
                        {shopeeSession.shopId || '197195817'}
                      </b>
                      ) đã hết hạn — hãy dán lệnh cURL mới hoặc cài Extension liên kết riêng của
                      Shop để đồng bộ trực tiếp.
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 bg-orange-600 px-2.5 text-xs text-white hover:bg-orange-700"
                      onClick={() => openCookieSyncDialog('curl')}
                    >
                      <KeyRound className="mr-1 h-3 w-3" />
                      Dán lệnh cURL
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 bg-background px-2.5 text-xs"
                      onClick={() => openCookieSyncDialog('extension')}
                    >
                      <Puzzle className="mr-1 h-3 w-3 text-orange-600" />
                      Tải Extension Shop
                    </Button>
                  </div>
                </div>
              )}

              {/* Thanh Radar Kiểm soát Rủi ro & Sức khỏe Đồng bộ 2 Chiều */}
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    (linkData?.stats?.oversellRiskCount ?? 0) > 0
                      ? 'border-red-300 bg-red-50/70 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                      : 'border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  }`}
                >
                  <div>
                    <div className="font-semibold">Chống bán lố (Oversell)</div>
                    <div className="text-[11px] opacity-80">
                      {(linkData?.stats?.oversellRiskCount ?? 0) > 0
                        ? `${linkData?.stats.oversellRiskCount} SP hết hàng đang mở bán!`
                        : 'An toàn 100% (0 SP bán lố)'}
                    </div>
                  </div>
                  <CheckCircle2 className="h-4 w-4 shrink-0 opacity-80" />
                </div>

                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    (linkData?.stats?.driftCount ?? 0) > 0
                      ? 'border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                      : 'border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  }`}
                >
                  <div>
                    <div className="font-semibold">Đồng bộ Giá & Tồn 2 chiều</div>
                    <div className="text-[11px] opacity-80">
                      {(linkData?.stats?.driftCount ?? 0) > 0
                        ? `${linkData?.stats.driftCount} SP đang lệch với Sàn`
                        : `${linkData?.stats?.linkedCount ?? 0}/${linkData?.stats?.linkedCount ?? 0} SP khớp tuyệt đối`}
                    </div>
                  </div>
                  <ArrowLeftRight className="h-4 w-4 shrink-0 opacity-80" />
                </div>

                <div
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                    (linkData?.stats?.unlinkedCount ?? 0) > 0
                      ? 'border-amber-300 bg-amber-50/70 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
                      : 'border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                  }`}
                >
                  <div>
                    <div className="font-semibold">Độ phủ Liên kết SKU</div>
                    <div className="text-[11px] opacity-80">
                      {linkData?.stats?.linkedCount ?? 0}/{linkData?.stats?.totalMarketplaceItems ?? 0} phân loại đã ghép
                    </div>
                  </div>
                  <Link2 className="h-4 w-4 shrink-0 opacity-80" />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2 text-xs text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300">
                  <div>
                    <div className="font-semibold">Hàng đợi Outbox & TTL</div>
                    <div className="text-[11px] opacity-80">
                      {(linkData?.stats?.pendingOutboxCount ?? 0) > 0
                        ? `Đang đẩy ${linkData?.stats.pendingOutboxCount} SP lên Sàn...`
                        : '0 nghẽn · Tự giải phóng khóa 180s'}
                    </div>
                  </div>
                  <Zap className="h-4 w-4 shrink-0 opacity-80" />
                </div>
              </div>

              {/* Thanh lọc & Tìm kiếm */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    variant={linkTab === 'ALL' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLinkTab('ALL')}
                  >
                    Tất cả ({linkData?.stats.totalMarketplaceItems ?? 0})
                  </Button>
                  <Button
                    variant={linkTab === 'UNLINKED' ? 'default' : 'outline'}
                    size="sm"
                    className={(linkData?.stats.unlinkedCount ?? 0) > 0 && linkTab !== 'UNLINKED' ? 'border-amber-500/60 text-amber-600 dark:text-amber-400' : ''}
                    onClick={() => setLinkTab('UNLINKED')}
                  >
                    <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
                    Chưa liên kết ({linkData?.stats.unlinkedCount ?? 0})
                  </Button>
                  <Button
                    variant={linkTab === 'LINKED' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLinkTab('LINKED')}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                    Đã liên kết ({linkData?.stats.linkedCount ?? 0})
                  </Button>
                  <Button
                    variant={linkTab === 'DRIFT' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setLinkTab('DRIFT')}
                  >
                    Lệch tồn / giá ({linkData?.stats.driftCount ?? 0})
                  </Button>
                  <Button
                    variant={linkTab === 'UNLISTED' ? 'default' : 'outline'}
                    size="sm"
                    className={
                      (linkData?.stats.unlistedCount ?? 0) > 0 && linkTab !== 'UNLISTED'
                        ? 'border-amber-500/60 text-amber-600 dark:text-amber-400'
                        : ''
                    }
                    onClick={() => setLinkTab('UNLISTED')}
                  >
                    <EyeOff className="mr-1.5 h-3.5 w-3.5 text-amber-500" />
                    Sàn đang ẩn ({linkData?.stats.unlistedCount ?? 0})
                  </Button>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Tìm tên, phân loại, SKU, Model ID..."
                    className="h-9 pl-8 text-sm"
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {/* 1. DANH SÁCH SẢN PHẨM SÀN CHƯA TÌM THẤY CÙNG SKU (CẦN LIÊN KẾT) */}
              {filteredUnlinked.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        checked={
                          filteredUnlinked.length > 0 &&
                          filteredUnlinked.every((it) =>
                            selectedUnlinkedKeys.includes(`${it.shopeeItemId}_${it.shopeeModelId}`)
                          )
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedUnlinkedKeys(
                              filteredUnlinked.map((it) => `${it.shopeeItemId}_${it.shopeeModelId}`)
                            )
                          } else {
                            setSelectedUnlinkedKeys([])
                          }
                        }}
                        aria-label="Chọn tất cả sản phẩm sàn chưa liên kết"
                      />
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        Sản phẩm Sàn chưa tìm thấy cùng SKU trong CMS ({filteredUnlinked.length})
                      </h4>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedUnlinkedKeys.length > 0 ? (
                        <>
                          <Badge variant="secondary" className="font-semibold">
                            Đã chọn {selectedUnlinkedKeys.length} phân loại
                          </Badge>
                          <Button
                            size="sm"
                            className="h-7 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                            disabled={bulkBusy}
                            onClick={() => void handleExecuteBulkCreateAndLink('KEEP_WAREHOUSE_STOCK')}
                            title="Tạo mã hàng trong CMS với Tồn kho = 0 bộ (vì chưa có phiếu nhập kho vật lý) và liên kết với phân loại Shopee"
                          >
                            {bulkBusy ? (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <PackagePlus className="mr-1.5 h-3.5 w-3.5" />
                            )}
                            Tạo &amp; Liên kết · Giữ Kho CMS = 0 ({selectedUnlinkedKeys.length})
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 border-amber-500/50 bg-amber-500/10 text-xs text-amber-900 hover:bg-amber-500/20 dark:text-amber-300"
                            disabled={bulkBusy}
                            onClick={() => void handleExecuteBulkCreateAndLink('TAKE_FROM_MARKETPLACE')}
                            title="Tạo mã hàng và lấy số lượng khai báo trên Sàn Shopee làm Tồn đầu kỳ trong CMS"
                          >
                            Lấy tồn Sàn làm Tồn đầu ({selectedUnlinkedKeys.length})
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={bulkBusy}
                            onClick={() => setSelectedUnlinkedKeys([])}
                          >
                            Bỏ chọn
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Tick chọn nhiều mục để tạo mã mới hàng loạt hoặc liên kết từng sản phẩm
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3">
                    {filteredUnlinked.map((item) => {
                      const rowKey = `${item.shopeeItemId}_${item.shopeeModelId}`
                      const isBusy = linkingBusyId === rowKey || bulkBusy
                      const isChecked = selectedUnlinkedKeys.includes(rowKey)
                      return (
                        <div
                          key={rowKey}
                          className={`flex flex-col justify-between gap-4 rounded-lg border bg-background p-4 shadow-xs transition-colors lg:flex-row lg:items-center ${
                            isChecked ? 'border-primary/60 bg-primary/5' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={isChecked}
                              className="mt-1"
                              onCheckedChange={(checked) => {
                                setSelectedUnlinkedKeys((prev) =>
                                  checked ? [...prev, rowKey] : prev.filter((k) => k !== rowKey)
                                )
                              }}
                              aria-label={`Chọn ${item.name}`}
                            />
                            {item.image ? (
                              <img
                                src={item.image}
                                alt={item.name}
                                className="h-14 w-14 shrink-0 rounded-md border object-cover"
                              />
                            ) : (
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-xs font-bold">
                                SP
                              </div>
                            )}
                            <div className="min-w-0 space-y-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge className="bg-[#EE4D2D] text-white hover:bg-[#EE4D2D]">Shopee</Badge>
                                {item.isUnlisted ? (
                                  <Badge
                                    variant="outline"
                                    className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                    title="Sản phẩm đang ở trạng thái Đang tạm ẩn (Unlisted / status=8) trên Shopee Seller Center"
                                  >
                                    <EyeOff className="mr-1 h-3 w-3 text-amber-600 dark:text-amber-400" />
                                    Sàn đang tạm ẩn
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  >
                                    Sàn đang mở bán
                                  </Badge>
                                )}
                                {item.modelName && (
                                  <Badge variant="outline" className="font-medium">
                                    Phân loại: {item.modelName}
                                  </Badge>
                                )}
                                {item.shopeeSku ? (
                                  <Badge variant="secondary" className="font-mono text-xs">
                                    SKU Sàn: {item.shopeeSku}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
                                    Chưa điền SKU phân loại trên Sàn
                                  </Badge>
                                )}
                              </div>
                              <p className="line-clamp-1 text-sm font-medium">{item.name}</p>
                              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                                <span>Item ID: {item.shopeeItemId}</span>
                                <span>·</span>
                                <span>Model ID: {item.shopeeModelId || 'Mặc định'}</span>
                                <span>·</span>
                                <span className="font-medium text-foreground">Giá sàn: {formatVND(item.sellPrice)}</span>
                                <span>·</span>
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  Tồn khai trên Sàn: {item.stock} bộ
                                </span>
                                <span>·</span>
                                <span className="font-medium text-muted-foreground">
                                  Kho CMS: 0 bộ (Chưa nhập)
                                </span>
                              </div>

                              {/* Chỉ hiển thị gợi ý khi có mã CMS chưa liên kết đạt độ trùng khớp cao (>= 80%), mở hộp thoại xác nhận thay vì ghép mù 1-click */}
                              {(() => {
                                const topMatch = item.suggestedCmsProducts.find((s) => {
                                  if (s.score < 80) return false
                                  const cp = linkData?.cmsProducts.find((p) => p.id === s.id)
                                  return !cp?.linkedShopeeModelId
                                })
                                if (!topMatch) {
                                  return (
                                    <p className="pt-1 text-xs text-muted-foreground">
                                      Chưa có mã SKU này trong Kho CMS — bấm{' '}
                                      <strong className="font-medium text-foreground">Tạo hàng hóa mới &amp; Liên kết</strong>{' '}
                                      để khởi tạo tự động (hoặc ghép thủ công nếu dùng mã khác).
                                    </p>
                                  )
                                }
                                return (
                                  <div className="mt-2 flex flex-wrap items-center gap-2 pt-1">
                                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                      <Sparkles className="h-3.5 w-3.5" />
                                      Phát hiện mã CMS tương ứng:
                                    </span>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="h-7 border-emerald-500/40 bg-emerald-500/5 px-2.5 text-xs hover:bg-emerald-500/15"
                                      disabled={isBusy}
                                      onClick={() => openLinkModal(item, topMatch.id)}
                                      title={topMatch.reason}
                                    >
                                      <Link2 className="mr-1 h-3 w-3 text-emerald-600" />
                                      Xem &amp; ghép với [{topMatch.sku}] ({topMatch.score}%)
                                    </Button>
                                  </div>
                                )
                              })()}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              className="bg-emerald-600 text-white hover:bg-emerald-700"
                              disabled={isBusy}
                              onClick={() => openCreateModal(item)}
                            >
                              {isBusy ? (
                                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                              ) : (
                                <PackagePlus className="mr-1.5 h-4 w-4" />
                              )}
                              Tạo hàng hóa mới &amp; Liên kết
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => openLinkModal(item)}
                            >
                              <Link2 className="mr-1.5 h-4 w-4" />
                              Ghép với hàng CMS có sẵn
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* 2. BẢNG SẢN PHẨM ĐÃ LIÊN KẾT (SÀN SHOPEE <-> KHO CMS) */}
              {linkTab !== 'UNLINKED' && (
                <div className="space-y-3">
                  {/* THANH THAO TÁC HÀNG LOẠT TRÊN NHIỀU SẢN PHẨM KÊNH BÁN */}
                  {selectedLinkedIds.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3.5 py-2.5 shadow-xs">
                      <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                        <CheckSquare className="h-4 w-4" />
                        <span>Đã chọn {selectedLinkedIds.length} sản phẩm liên kết</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          className="h-7 bg-amber-600 px-2.5 text-xs text-white hover:bg-amber-700"
                          disabled={bulkBusy}
                          onClick={() => void handleExecuteBulkLinkedAction('PUSH_STOCK_AND_PRICE')}
                        >
                          {bulkBusy ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Zap className="mr-1 h-3.5 w-3.5" />
                          )}
                          Đồng bộ Tồn &amp; Giá ({selectedLinkedIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-emerald-500/50 bg-emerald-500/10 px-2.5 text-xs text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
                          disabled={bulkBusy}
                          onClick={() => void handleExecuteBulkLinkedAction('SET_ACTIVE')}
                        >
                          <Eye className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                          Mở bán Sàn ({selectedLinkedIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-amber-500/50 bg-amber-500/10 px-2.5 text-xs text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
                          disabled={bulkBusy}
                          onClick={() => void handleExecuteBulkLinkedAction('SET_UNLISTED')}
                        >
                          <EyeOff className="mr-1 h-3.5 w-3.5 text-amber-600" />
                          Tạm ẩn Sàn ({selectedLinkedIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={bulkBusy}
                          onClick={() => {
                            setBulkPriceMode('NONE')
                            setBulkPriceValue('')
                            setBulkStockMode('NONE')
                            setBulkStockValue('')
                            setBulkEditOpen(true)
                          }}
                        >
                          <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                          Sửa Giá / Tồn hàng loạt
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 border-destructive/40 px-2.5 text-xs text-destructive hover:bg-destructive/10"
                          disabled={bulkBusy}
                          onClick={() => void handleExecuteBulkLinkedAction('UNLINK')}
                        >
                          <Unlink className="mr-1 h-3.5 w-3.5" />
                          Gỡ liên kết ({selectedLinkedIds.length})
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={bulkBusy}
                          onClick={() => setSelectedLinkedIds([])}
                        >
                          Bỏ chọn
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-9 pr-0" locked>
                            <Checkbox
                              checked={
                                filteredLinked.length > 0 &&
                                filteredLinked.every((it) => selectedLinkedIds.includes(it.cmsProductId))
                              }
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedLinkedIds(
                                    Array.from(new Set(filteredLinked.map((it) => it.cmsProductId)))
                                  )
                                } else {
                                  setSelectedLinkedIds([])
                                }
                              }}
                              aria-label="Chọn tất cả sản phẩm đã liên kết"
                            />
                          </TableHead>
                          <TableHead>Sản phẩm &amp; Phân loại Sàn</TableHead>
                          <TableHead>Trạng thái Liên kết</TableHead>
                          <TableHead>Hàng hóa Kho CMS</TableHead>
                          <TableHead className="text-right">Giá bán</TableHead>
                          <TableHead className="text-right">Tồn (CMS/Sàn)</TableHead>
                          <TableHead className="text-right">Thao tác nhanh</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLinked.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                              Không có sản phẩm đã liên kết nào khớp bộ lọc hiện tại.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredLinked.map((item) => {
                            const isBusy = linkingBusyId === item.cmsProductId || bulkBusy
                            const isChecked = selectedLinkedIds.includes(item.cmsProductId)
                            return (
                              <TableRow
                                key={`${item.cmsProductId}_${item.shopeeModelId}`}
                                className={isChecked ? 'bg-primary/5' : undefined}
                              >
                                <TableCell className="w-9 pr-0">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => {
                                      setSelectedLinkedIds((prev) =>
                                        checked
                                          ? Array.from(new Set([...prev, item.cmsProductId]))
                                          : prev.filter((id) => id !== item.cmsProductId)
                                      )
                                    }}
                                    aria-label={`Chọn ${item.cmsSku}`}
                                  />
                                </TableCell>
                                <TableCell className="max-w-[230px] whitespace-normal">
                                <div className="flex items-center gap-2.5">
                                  {item.cmsImage ? (
                                    <img
                                      src={item.cmsImage}
                                      alt={item.cmsName}
                                      className="h-9 w-9 shrink-0 rounded border object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded border bg-muted text-xs font-bold">
                                      SP
                                    </div>
                                  )}
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-1">
                                      <Badge variant="outline" className="max-w-[140px] truncate text-[11px]">
                                        {item.shopeeModelName || 'Mặc định'}
                                      </Badge>
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        #{item.shopeeModelId.slice(-6)}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      SKU Sàn:{' '}
                                      <span className="font-mono font-medium text-foreground">
                                        {item.shopeeModelSku || 'Theo Model ID'}
                                      </span>
                                    </p>
                                  </div>
                                </div>
                              </TableCell>

                              <TableCell className="whitespace-normal">
                                <div className="flex flex-col gap-1">
                                  <div className="flex flex-wrap items-center gap-1">
                                    {item.isUnlisted && (
                                      <Badge
                                        variant="outline"
                                        className="w-fit border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                      >
                                        <EyeOff className="mr-1 h-2.5 w-2.5 text-amber-600" />
                                        Sàn đang ẩn
                                      </Badge>
                                    )}
                                    {item.syncStatus === 'IN_SYNC' ? (
                                      <Badge variant="secondary" className="w-fit bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="mr-1 h-2.5 w-2.5" />
                                        Khớp 2 chiều
                                      </Badge>
                                    ) : (
                                      <Badge variant="secondary" className="w-fit bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-600 dark:text-amber-400">
                                        <AlertTriangle className="mr-1 h-2.5 w-2.5" />
                                        Chờ Outbox
                                      </Badge>
                                    )}
                                  </div>
                                  <span className="text-[11px] text-muted-foreground">
                                    {item.linkMode === 'MANUAL_LINKED'
                                      ? 'Liên kết thủ công'
                                      : item.linkMode === 'CREATED_AND_LINKED'
                                        ? 'Tạo từ Sàn & Liên kết'
                                        : 'Tự động khớp cùng SKU'}
                                  </span>
                                </div>
                              </TableCell>

                              <TableCell className="max-w-[260px] whitespace-normal">
                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-1">
                                    <Badge variant="outline" className="font-mono text-[11px] font-semibold">
                                      {item.cmsSku}
                                    </Badge>
                                    {item.openingStockOrigin === 'CMS_WAREHOUSE' ? (
                                      <Badge
                                        variant="secondary"
                                        className="bg-blue-500/10 px-1.5 py-0 text-[10px] text-blue-700 dark:text-blue-300"
                                        title={item.openingStockOriginLabel || 'Gốc tồn đầu tại Kho CMS'}
                                      >
                                        Gốc Kho: {item.openingStockQty ?? item.cmsStock}
                                      </Badge>
                                    ) : (
                                      <Badge
                                        variant="secondary"
                                        className="bg-orange-500/15 px-1.5 py-0 text-[10px] text-orange-700 dark:text-orange-300"
                                        title={
                                          item.openingStockOriginLabel ||
                                          'Gốc tồn đầu từ Sàn Shopee (thaimy1605) — Mọi biến động bán hàng đối chiếu đơn Sàn về CMS'
                                        }
                                      >
                                        Gốc Sàn: {item.openingStockQty ?? item.cmsStock}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="line-clamp-1 text-xs text-muted-foreground" title={item.cmsName}>
                                    {item.cmsName}
                                  </p>
                                  <div className="text-[10px] text-muted-foreground">
                                    Đầu kỳ <strong className="text-foreground">{item.openingStockQty ?? item.cmsStock}</strong>
                                    {' − '}Đơn Sàn <strong className="text-orange-600 dark:text-orange-400">{item.shopeeSoldQty ?? 0}</strong>
                                    {' − '}Đơn Kho <strong className="text-blue-600 dark:text-blue-400">{item.posSoldQty ?? 0}</strong>
                                    {item.shopeeAdjustDelta ? (
                                      <>
                                        {' + '}ĐC Sàn{' '}
                                        <strong className="text-violet-600 dark:text-violet-400">
                                          {item.shopeeAdjustDelta > 0 ? `+${item.shopeeAdjustDelta}` : item.shopeeAdjustDelta}
                                        </strong>
                                      </>
                                    ) : null}
                                    {item.manualDelta ? ` + ĐC Kho ${item.manualDelta}` : ''}
                                    {' = '}
                                    <strong className="text-emerald-600 dark:text-emerald-400">{item.cmsStock}</strong>
                                    {item.reconciledOrders && item.reconciledOrders.length > 0 && (
                                      <span className="ml-1 font-mono text-[10px] text-emerald-700 dark:text-emerald-300">
                                        ({item.reconciledOrders.map((o) => o.code).join(', ')})
                                      </span>
                                    )}
                                  </div>
                                  {item.lastReconcileReason && (
                                    <div
                                      className="mt-0.5 flex items-center gap-1 rounded border border-violet-200/70 bg-violet-50/60 px-1.5 py-0.5 text-[10px] text-violet-900 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200"
                                      title={`Lý do đối soát (${item.lastReconcileDecisionLabel || 'Ghi chú'}): ${item.lastReconcileReason}`}
                                    >
                                      <span className="shrink-0 font-semibold">
                                        {item.lastReconcileDecisionLabel || 'Lý do'}:
                                      </span>
                                      <span className="truncate">“{item.lastReconcileReason}”</span>
                                    </div>
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-right tabular-nums">
                                <div className="text-xs font-semibold text-foreground">
                                  {formatVND(item.cmsSellPrice)}
                                </div>
                                {item.lastSyncedShopeePrice > 0 &&
                                  item.lastSyncedShopeePrice !== item.cmsSellPrice && (
                                    <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                      Sàn: {formatVND(item.lastSyncedShopeePrice)}
                                    </div>
                                  )}
                              </TableCell>

                              <TableCell className="text-right tabular-nums">
                                <div className="flex flex-col items-end gap-1">
                                  <div className="inline-flex items-center justify-end gap-1 text-xs">
                                    <span className="font-semibold text-foreground">{item.cmsStock}</span>
                                    <span className="text-muted-foreground">/</span>
                                    <span
                                      className={
                                        item.cmsStock === (item.liveShopeeStock ?? item.lastSyncedShopeeStock)
                                          ? 'font-medium text-emerald-600 dark:text-emerald-400'
                                          : 'font-semibold text-amber-600 dark:text-amber-400'
                                      }
                                    >
                                      {item.liveShopeeStock ?? item.lastSyncedShopeeStock}
                                    </span>
                                  </div>
                                  {item.reconciliationStatus === 'PENDING_SHOPEE_ORDER' && (
                                    <Badge
                                      variant="outline"
                                      className="border-amber-400 bg-amber-50 px-1 py-0 text-[9px] text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                      title="Sàn giảm tồn — Hệ thống đang chờ đối chiếu đơn từ Sàn về CMS để trừ tồn chính xác"
                                    >
                                      Chờ đơn Sàn về CMS ({item.unreconciledShopeeDelta})
                                    </Badge>
                                  )}
                                  {item.reconciliationStatus === 'SHOPEE_DIRECT_ADJUSTED' && (
                                    <Badge
                                      variant="outline"
                                      className="border-violet-400 bg-violet-50 px-1 py-0 text-[9px] text-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
                                      title="Số tồn trên Sàn thay đổi trực tiếp không qua đơn hàng — Chờ xác nhận đối soát"
                                    >
                                      ĐC trực tiếp trên Sàn ({(item.unreconciledShopeeDelta ?? 0) > 0 ? `+${item.unreconciledShopeeDelta}` : item.unreconciledShopeeDelta})
                                    </Badge>
                                  )}
                                  {item.cmsStock === 0 && (item.liveShopeeStock ?? item.lastSyncedShopeeStock) > 0 ? (
                                    <div className="flex flex-wrap justify-end gap-1 pt-0.5">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 border-orange-300 bg-orange-50 px-1.5 text-[10px] text-orange-800 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/60 dark:text-orange-300"
                                        disabled={isBusy}
                                        onClick={() => openReconcileReasonModal(item, 'TAKE_OPENING_FROM_MARKETPLACE')}
                                        title="Kho trống = 0 nhưng Sàn có tồn: Lấy số tồn từ Sàn làm Tồn đầu kỳ (có ghi chú rõ lý do & gốc tồn đầu)"
                                      >
                                        Lấy tồn Sàn ({item.liveShopeeStock ?? item.lastSyncedShopeeStock}) làm Tồn đầu
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 border-violet-300 bg-violet-50 px-1.5 text-[10px] text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
                                        disabled={isBusy}
                                        onClick={() =>
                                          openReconcileReasonModal(item, 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT')
                                        }
                                        title="Nếu số tồn trên Sàn là chính xác do điều chỉnh trực tiếp: Ghi lý do & lập phiếu cân bằng kho"
                                      >
                                        Nhận ĐC Sàn ({item.liveShopeeStock ?? item.lastSyncedShopeeStock})
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-6 px-1.5 text-[10px]"
                                        disabled={isBusy}
                                        onClick={() => openReconcileReasonModal(item, 'KEEP_WAREHOUSE_AND_PUSH')}
                                        title="Ghi lý do giữ nguyên Kho trống = 0 tại Kho CMS và đồng bộ lên Sàn"
                                      >
                                        Giữ Kho = 0
                                      </Button>
                                    </div>
                                  ) : (
                                    item.cmsStock !== (item.liveShopeeStock ?? item.lastSyncedShopeeStock) && (
                                      <div className="flex flex-wrap justify-end gap-1 pt-0.5">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-6 border-violet-300 bg-violet-50 px-1.5 text-[10px] text-violet-800 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
                                          disabled={isBusy}
                                          onClick={() =>
                                            openReconcileReasonModal(item, 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT')
                                          }
                                          title="Xác nhận số tồn điều chỉnh trên Sàn là chính xác: Mở hộp thoại ghi lý do & lập phiếu cân bằng kho CMS"
                                        >
                                          Nhận ĐC Sàn ({item.liveShopeeStock ?? item.lastSyncedShopeeStock}) là đúng
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-6 px-1.5 text-[10px]"
                                          disabled={isBusy}
                                          onClick={() => openReconcileReasonModal(item, 'KEEP_WAREHOUSE_AND_PUSH')}
                                          title="Nếu bấm nhầm trên Sàn: Mở hộp thoại ghi lý do giữ tồn Kho CMS và đẩy đè lên Sàn"
                                        >
                                          Giữ Kho ({item.cmsStock})
                                        </Button>
                                      </div>
                                    )
                                  )}
                                </div>
                              </TableCell>

                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    disabled={isBusy}
                                    onClick={() =>
                                      openReconcileReasonModal(
                                        item,
                                        item.cmsStock === 0 && (item.liveShopeeStock ?? item.lastSyncedShopeeStock) > 0
                                          ? 'TAKE_OPENING_FROM_MARKETPLACE'
                                          : item.cmsStock !== (item.liveShopeeStock ?? item.lastSyncedShopeeStock)
                                            ? 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'
                                            : 'KEEP_WAREHOUSE_AND_PUSH'
                                      )
                                    }
                                    title="Mở bảng đối soát Sàn ↔ Kho CMS và ghi lý do xác nhận tồn Sàn hoặc giữ tồn Kho"
                                  >
                                    <ClipboardCheck className="mr-1 h-3.5 w-3.5 text-violet-600" />
                                    Đối soát &amp; Ghi lý do
                                  </Button>
                                  <Button
                                    variant={item.syncStatus === 'IN_SYNC' ? 'outline' : 'default'}
                                    size="sm"
                                    className={
                                      item.syncStatus === 'IN_SYNC'
                                        ? 'h-7 px-2 text-[11px]'
                                        : 'h-7 bg-amber-600 px-2 text-[11px] text-white hover:bg-amber-700'
                                    }
                                    disabled={isBusy}
                                    onClick={() => void handleQuickPushStock(item)}
                                    title="Đẩy ngay tồn kho & giá hiện tại của CMS lên sàn Shopee"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                    ) : (
                                      <Zap className="mr-1 h-3 w-3" />
                                    )}
                                    Đồng bộ
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className={
                                      item.isUnlisted
                                        ? 'h-7 border-amber-300 bg-amber-50 px-2 text-[11px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                        : 'h-7 px-2 text-[11px]'
                                    }
                                    disabled={isBusy}
                                    onClick={() => void handleQuickToggleVisibility(item)}
                                    title={
                                      item.isUnlisted
                                        ? 'Sản phẩm đang tạm ẩn trên Shopee. Bấm để mở bán lại.'
                                        : 'Tạm ẩn sản phẩm này trên sàn Shopee.'
                                    }
                                  >
                                    {item.isUnlisted ? (
                                      <>
                                        <Eye className="mr-1 h-3 w-3 text-emerald-600" />
                                        Mở bán
                                      </>
                                    ) : (
                                      <>
                                        <EyeOff className="mr-1 h-3 w-3 text-amber-600" />
                                        Tạm ẩn
                                      </>
                                    )}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
                                    disabled={isBusy}
                                    onClick={() => void handleUnlinkProduct(item)}
                                    title="Gỡ liên kết để chọn lại hàng hóa CMS khác"
                                  >
                                    <Unlink className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })
                      )}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ===== DANH SÁCH KÊNH BÁN (SẮP XẾP KÊNH ĐANG KẾT NỐI LÊN ĐẦU) ===== */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[...channels]
              .sort((a, b) => {
                if (a.key === 'SHOPEE') return -1
                if (b.key === 'SHOPEE') return 1
                return Number(b.connected) - Number(a.connected)
              })
              .map((channel) => {
              const busy = togglingId === channel.id
              const syncing = syncingId === channel.id
              return (
                <Card key={channel.id} className="border-border/70 shadow-sm">
                  <CardContent className="flex h-full flex-col gap-4 p-5">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-lg text-base font-bold text-white shadow-sm"
                        style={{ backgroundColor: channel.color }}
                        aria-hidden
                      >
                        {channel.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">{channel.name}</span>
                          <ConnectedDot connected={channel.connected} />
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">
                            {channel.connected ? 'Đang hoạt động' : 'Chưa kết nối'}
                          </span>
                          {channel.feePercent > 0 && (
                            <Badge variant="secondary" className="text-[11px]">
                              Phí {channel.feePercent}%
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-dashed p-3">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={`channel-fee-${channel.id}`}
                          className="shrink-0 text-xs font-medium text-muted-foreground"
                        >
                          Phí sàn (%)
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`channel-fee-${channel.id}`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={100}
                            step={0.5}
                            className="h-8 w-20 text-right text-sm"
                            value={feeDraftFor(channel)}
                            onChange={(e) =>
                              setFeeDrafts((prev) => ({ ...prev, [channel.id]: e.target.value }))
                            }
                            aria-label={`Phí sàn (%) của kênh ${channel.name}`}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-3"
                            disabled={!feeChanged(channel) || savingFeeId === channel.id}
                            onClick={() => void handleSaveFee(channel)}
                          >
                            {savingFeeId === channel.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="h-4 w-4" />
                            )}
                            Lưu
                          </Button>
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Tự động trừ khi đối soát đơn hàng mới trên kênh này
                      </p>
                    </div>

                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-3 text-center">
                      <div className="min-w-0">
                        <p className="truncate text-xs text-muted-foreground">Sản phẩm đang bán</p>
                        <p className="mt-0.5 text-sm font-semibold">{formatNumber(channel.stats?.listings ?? 0)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-muted-foreground">Đơn hàng</p>
                        <p className="mt-0.5 text-sm font-semibold">{formatNumber(channel.stats?.orders ?? 0)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-muted-foreground">Doanh thu</p>
                        <p className="mt-0.5 truncate text-sm font-semibold" title={formatVND(channel.stats?.revenue ?? 0)}>
                          {formatCompactVND(channel.stats?.revenue ?? 0)}
                        </p>
                      </div>
                    </div>

                    {channel.key === 'SHOPEE' && (
                      <div className="rounded-lg border border-orange-200/80 bg-orange-50/40 p-2.5 text-xs dark:border-orange-900/50 dark:bg-orange-950/20">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">
                            Phiên Cookie ({shopeeSession?.username || 'thaimy1605'})
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              shopeeSession?.alive
                                ? 'border-emerald-300 bg-emerald-50 text-[10px] text-emerald-700'
                                : 'border-amber-300 bg-amber-50 text-[10px] text-amber-700'
                            }
                          >
                            {shopeeSession?.alive ? 'Live' : 'Cần nạp lại'}
                          </Badge>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 bg-background px-2 text-[11px]"
                            onClick={() => openCookieSyncDialog('curl')}
                          >
                            <KeyRound className="mr-1 h-3 w-3 text-orange-600" />
                            Nhập cURL
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 bg-background px-2 text-[11px]"
                            onClick={() => openCookieSyncDialog('extension')}
                          >
                            <Puzzle className="mr-1 h-3 w-3 text-orange-600" />
                            Extension Shop
                          </Button>
                        </div>
                      </div>
                    )}

                    <div className="mt-auto">
                      <Separator className="mb-3" />
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <SyncInfo syncedAt={channel.syncedAt} />
                        <div className="flex items-center gap-3">
                          <label className="flex cursor-pointer items-center gap-2 text-sm">
                            <Switch
                              checked={channel.connected}
                              disabled={busy}
                              aria-label={`Kết nối kênh ${channel.name}`}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  void handleConnect(channel)
                                } else {
                                  setPendingDisconnect(channel)
                                }
                              }}
                            />
                            <span className="text-muted-foreground">Kết nối</span>
                          </label>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!channel.connected || busy || syncing}
                            onClick={() => void handleSync(channel)}
                          >
                            <RefreshCw className={syncing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                            Đồng bộ
                          </Button>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Đối soát sàn TMĐT — các kênh có cấu hình phí > 0 */}
          <Card className="mt-6 border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="h-5 w-5 text-emerald-500" />
                Đối soát sàn TMĐT
              </CardTitle>
              <CardDescription>
                Phí sàn được snapshot trên từng đơn lúc tạo — tự động trừ khi đối soát để tính đúng lợi nhuận thực nhận.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reconChannels.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Chưa cấu hình phí sàn cho kênh nào.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kênh</TableHead>
                        <TableHead className="text-right">Đơn hàng</TableHead>
                        <TableHead className="text-right">Doanh thu</TableHead>
                        <TableHead className="text-right">Phí sàn</TableHead>
                        <TableHead className="text-right">Thực nhận</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reconChannels.map((channel) => (
                        <TableRow key={channel.id}>
                          <TableCell>
                            <ChannelBadge channel={channel} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(channel.stats?.orders ?? 0)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(channel.stats?.revenue ?? 0)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-right tabular-nums">
                            <span className="text-xs text-muted-foreground">{channel.feePercent}%</span>{' '}
                            <span className="font-medium text-rose-600 dark:text-rose-400">
                              −{formatVND(channel.stats?.platformFee ?? 0)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatVND(channel.stats?.netRevenue ?? 0)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell>Tổng cộng</TableCell>
                        <TableCell className="text-right tabular-nums">{formatNumber(reconTotals.orders)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatVND(reconTotals.revenue)}</TableCell>
                        <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                          −{formatVND(reconTotals.platformFee)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatVND(reconTotals.netRevenue)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* DIALOG 1: CHỌN HÀNG HÓA CMS ĐỂ LIÊN KẾT VỚI SẢN PHẨM SÀN */}
      <Dialog open={linkModalItem !== null} onOpenChange={(open) => !open && setLinkModalItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-orange-500" />
              Liên kết Sản phẩm Sàn với Hàng hóa Kho CMS
            </DialogTitle>
            <DialogDescription>
              Ghép nối phân loại trên Sàn với đúng hàng hóa trong Kho CMS để tự động trừ kho khi có đơn và đồng bộ tồn kho 2 chiều.
            </DialogDescription>
          </DialogHeader>

          {linkModalItem && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="text-xs font-medium text-muted-foreground">Sản phẩm trên Sàn Shopee:</p>
                <p className="mt-0.5 text-sm font-semibold">{linkModalItem.name}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">Phân loại: {linkModalItem.modelName || 'Mặc định'}</Badge>
                  <Badge variant="secondary" className="font-mono">
                    Model ID: {linkModalItem.shopeeModelId}
                  </Badge>
                  <span>Giá sàn: {formatVND(linkModalItem.sellPrice)}</span>
                  <span>·</span>
                  <span>Tồn sàn: {linkModalItem.stock}</span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Tìm và chọn Hàng hóa trong Kho CMS</Label>
                <Input
                  placeholder="Nhập mã SKU hoặc tên hàng hóa CMS..."
                  value={cmsModalSearch}
                  onChange={(e) => setCmsModalSearch(e.target.value)}
                />
                <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border p-2">
                  {filteredModalCmsProducts.map((cp) => {
                    const isSelected = selectedCmsProductId === cp.id
                    return (
                      <div
                        key={cp.id}
                        onClick={() => setSelectedCmsProductId(cp.id)}
                        className={`flex cursor-pointer items-center justify-between rounded-md border p-2.5 text-sm transition-colors ${
                          isSelected
                            ? 'border-primary bg-primary/10 font-medium'
                            : 'border-transparent hover:bg-muted/70'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-xs">
                              {cp.sku}
                            </Badge>
                            {cp.linkedShopeeModelId && (
                              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                                (Đang gắn Model {cp.linkedShopeeModelId})
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{cp.name}</p>
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          <p className="font-semibold">{formatVND(cp.sellPrice)}</p>
                          <p className="text-muted-foreground">Tồn CMS: {cp.stock}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-xs font-semibold">
                  Chọn gốc Tồn đầu kỳ &amp; phương thức liên kết kho (Sàn: {linkModalItem.stock} bộ · Kho CMS đang chọn:{' '}
                  {linkData?.cmsProducts.find((cp) => cp.id === selectedCmsProductId)?.stock ?? 0} bộ):
                </Label>
                {linkData?.cmsProducts.find((cp) => cp.id === selectedCmsProductId)?.stock === 0 &&
                  linkModalItem.stock > 0 && (
                    <div className="rounded-md border border-orange-300 bg-orange-50/80 p-2 text-[11px] text-orange-900 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-200">
                      <strong>Phát hiện Kho trống = 0 nhưng Sàn có {linkModalItem.stock} cái tồn đầu kỳ:</strong> Bạn
                      có thể chọn <strong>Lấy số tồn từ Sàn làm Tồn đầu kỳ</strong> (ghi chú rõ gốc tồn đầu từ Sàn) hoặc{' '}
                      <strong>Liên kết giữ tồn tại Kho (= 0)</strong>.
                    </div>
                  )}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setSyncDirection('SHOPEE_TO_CMS')}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      syncDirection === 'SHOPEE_TO_CMS'
                        ? 'border-orange-500 bg-orange-500/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold text-orange-700 dark:text-orange-300">
                      Lấy số tồn từ Sàn ({linkModalItem.stock} bộ) làm Tồn đầu kỳ
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Chốt tồn đầu kỳ = {linkModalItem.stock} bộ tại Kho CMS và ghi chú rõ{' '}
                      <strong>[GỐC TỒN ĐẦU TỪ SÀN SHOPEE]</strong>. Khi Sàn bán sẽ đối chiếu đơn về CMS để trừ tồn.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSyncDirection('CMS_TO_SHOPEE')}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      syncDirection === 'CMS_TO_SHOPEE'
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold">
                      Liên kết sản phẩm tại Kho CMS (Giữ tồn Kho ={' '}
                      {linkData?.cmsProducts.find((cp) => cp.id === selectedCmsProductId)?.stock ?? 0} bộ)
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Giữ nguyên số tồn thực tế tại Kho CMS làm gốc và đẩy lên Sàn Shopee qua hàng đợi Outbox.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkModalItem(null)}>
              Hủy
            </Button>
            <Button
              disabled={!selectedCmsProductId || linkingBusyId !== null}
              onClick={() =>
                linkModalItem &&
                void handleExecuteLinkToExisting(linkModalItem, selectedCmsProductId, syncDirection)
              }
            >
              {linkingBusyId ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              Xác nhận Liên kết
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2: TẠO MỚI HÀNG HÓA CMS TỪ SẢN PHẨM SÀN & LIÊN KẾT NGAY */}
      <Dialog open={createModalItem !== null} onOpenChange={(open) => !open && setCreateModalItem(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-500" />
              Tạo Hàng hóa CMS mới &amp; Liên kết
            </DialogTitle>
            <DialogDescription>
              Khởi tạo mặt hàng mới trong Kho Trung Tâm từ thông tin Sàn Shopee và chọn nguồn chốt Tồn đầu kỳ.
            </DialogDescription>
          </DialogHeader>

          {createModalItem && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1">
                <p className="font-semibold text-sm text-foreground">{createModalItem.name}</p>
                <p>
                  Phân loại Sàn: <strong>{createModalItem.modelName || 'Mặc định'}</strong>
                </p>
                <p>
                  Giá bán: <strong>{formatVND(createModalItem.sellPrice)}</strong> · Tồn hiện tại trên Sàn:{' '}
                  <strong>{createModalItem.stock} bộ</strong>
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="custom-cms-sku">Mã SKU Hàng hóa mới trong Kho CMS</Label>
                <Input
                  id="custom-cms-sku"
                  value={customSkuDraft}
                  onChange={(e) => setCustomSkuDraft(e.target.value.toUpperCase())}
                  placeholder="VD: BM-COMBO-SEN-01-TRANG"
                  className="font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  Mã SKU này sẽ dùng để quản lý tồn kho tại CMS và tự động ánh xạ với Model ID{' '}
                  {createModalItem.shopeeModelId} trên Shopee.
                </p>
              </div>

              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-xs font-semibold">
                  Chốt Tồn đầu kỳ khi Kho CMS đang trống (= 0) và Sàn có {createModalItem.stock} bộ:
                </Label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateStockInitMode('TAKE_FROM_MARKETPLACE')}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      createStockInitMode === 'TAKE_FROM_MARKETPLACE'
                        ? 'border-orange-500 bg-orange-500/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold text-orange-700 dark:text-orange-300">
                      Lấy số tồn từ Sàn ({createModalItem.stock} bộ) làm Tồn đầu kỳ (Khuyên dùng)
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Ghi nhận rõ <strong>[GỐC TỒN ĐẦU TỪ SÀN SHOPEE]</strong> vào Sổ Kho &amp; Sổ Data. Khi Sàn bán sẽ
                      đối chiếu các đơn trên Sàn về CMS để theo dõi và trừ tồn chính xác.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateStockInitMode('KEEP_WAREHOUSE_STOCK')}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      createStockInitMode === 'KEEP_WAREHOUSE_STOCK'
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold">Liên kết sản phẩm tại Kho trống (= 0 bộ)</p>
                    <p className="mt-0.5 text-muted-foreground">
                      Khởi tạo tồn tại Kho CMS = 0 bộ làm gốc và đẩy đồng bộ lên Sàn Shopee.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateModalItem(null)}>
              Hủy
            </Button>
            <Button
              disabled={!customSkuDraft.trim() || linkingBusyId !== null}
              onClick={() => void handleExecuteCreateAndLink()}
            >
              {linkingBusyId ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <PackagePlus className="mr-1.5 h-4 w-4" />
              )}
              Tạo mới & Liên kết ngay
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 2B: ĐỐI SOÁT SÀN ↔ KHO CMS & GHI CHÚ LÝ DO XÁC NHẬN HOẶC GIỮ TỒN */}
      <Dialog open={reconcileModalItem !== null} onOpenChange={(open) => !open && setReconcileModalItem(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-violet-600" />
              Đối soát Tồn kho Sàn Shopee ↔ Kho CMS &amp; Ghi chú Lý do
            </DialogTitle>
            <DialogDescription>
              Chọn phương án xử lý và ghi rõ lý do để lưu vào Sổ Thẻ Kho, Sổ Data và hiển thị trực tiếp trên bảng CMS.
            </DialogDescription>
          </DialogHeader>

          {reconcileModalItem && (
            <div className="space-y-4">
              {/* Tóm tắt số liệu đối chiếu của sản phẩm */}
              <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs font-semibold">
                      {reconcileModalItem.cmsSku}
                    </Badge>
                    <span className="font-semibold text-sm text-foreground line-clamp-1">
                      {reconcileModalItem.cmsName}
                    </span>
                  </div>
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    Model #{reconcileModalItem.shopeeModelId.slice(-6)}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="rounded border bg-background p-2">
                    <p className="text-[10px] text-muted-foreground">Gốc tồn đầu kỳ</p>
                    <p className="text-sm font-bold text-foreground">
                      {reconcileModalItem.openingStockQty ?? reconcileModalItem.cmsStock} bộ
                    </p>
                    <p className="text-[10px] text-orange-600 dark:text-orange-400">
                      {reconcileModalItem.openingStockOrigin === 'CMS_WAREHOUSE' ? 'Tại Kho CMS' : 'Từ Sàn Shopee'}
                    </p>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <p className="text-[10px] text-muted-foreground">Tồn Kho CMS hiện tại</p>
                    <p className="text-sm font-bold text-blue-600 dark:text-blue-400">
                      {reconcileModalItem.cmsStock} bộ
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      Đơn Sàn: {reconcileModalItem.shopeeSoldQty ?? 0} · Đơn Kho: {reconcileModalItem.posSoldQty ?? 0}
                    </p>
                  </div>
                  <div className="rounded border bg-background p-2">
                    <p className="text-[10px] text-muted-foreground">Tồn trên Sàn Shopee</p>
                    <p className="text-sm font-bold text-orange-600 dark:text-orange-400">
                      {reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock} bộ
                    </p>
                    <p className="text-[10px] text-violet-600 dark:text-violet-400">
                      Lệch:{' '}
                      {(reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock) -
                        reconcileModalItem.cmsStock >
                      0
                        ? `+${(reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock) - reconcileModalItem.cmsStock}`
                        : (reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock) -
                          reconcileModalItem.cmsStock}{' '}
                      bộ
                    </p>
                  </div>
                </div>
              </div>

              {/* Chọn quyết định: Xác nhận Tồn Sàn hay Giữ Tồn Kho CMS */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">1. Chọn phương án đối soát:</Label>
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReconcileModalMode('ACCEPT_SHOPEE_DIRECT_ADJUSTMENT')
                      setReconcileReasonDraft(getDefaultReasonForMode('ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'))
                    }}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      reconcileModalMode === 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'
                        ? 'border-violet-500 bg-violet-500/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold text-violet-700 dark:text-violet-300">
                      Xác nhận số liệu trên Sàn ({reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock} bộ) là chính xác (Nhận ĐC từ Sàn)
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Lập phiếu Cân bằng kho CMS ({reconcileModalItem.cmsStock} ➔{' '}
                      {reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock} bộ) và{' '}
                      <strong>giữ nguyên Gốc tồn đầu ({reconcileModalItem.openingStockQty ?? reconcileModalItem.cmsStock} bộ) &amp; lịch sử đơn</strong>.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setReconcileModalMode('KEEP_WAREHOUSE_AND_PUSH')
                      setReconcileReasonDraft(getDefaultReasonForMode('KEEP_WAREHOUSE_AND_PUSH'))
                    }}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      reconcileModalMode === 'KEEP_WAREHOUSE_AND_PUSH'
                        ? 'border-primary bg-primary/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold">
                      Giữ nguyên số tồn tại Kho CMS ({reconcileModalItem.cmsStock} bộ) &amp; đẩy đè lên Sàn Shopee
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Dùng khi thao tác sửa nhầm trên Sàn Shopee — Hệ thống giữ tồn Kho CMS làm chuẩn và đồng bộ lại lên Sàn.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setReconcileModalMode('TAKE_OPENING_FROM_MARKETPLACE')
                      setReconcileReasonDraft(getDefaultReasonForMode('TAKE_OPENING_FROM_MARKETPLACE'))
                    }}
                    className={`rounded-md border p-2.5 text-left text-xs transition-colors ${
                      reconcileModalMode === 'TAKE_OPENING_FROM_MARKETPLACE'
                        ? 'border-orange-500 bg-orange-500/10 font-medium'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    <p className="font-semibold text-orange-700 dark:text-orange-300">
                      Lấy số tồn trên Sàn ({reconcileModalItem.liveShopeeStock ?? reconcileModalItem.lastSyncedShopeeStock} bộ) làm mốc Tồn đầu kỳ mới
                    </p>
                    <p className="mt-0.5 text-muted-foreground">
                      Dùng khi Kho CMS đang trống (= 0) hoặc muốn đặt lại Gốc tồn đầu kỳ theo số hiện có trên Sàn Shopee.
                    </p>
                  </button>
                </div>
              </div>

              {/* Nhập lý do & Gợi ý lý do nhanh */}
              <div className="space-y-2 rounded-lg border p-3">
                <Label htmlFor="reconcile-reason-input" className="text-xs font-semibold">
                  2. Ghi rõ lý do xác nhận / giữ tồn (Hiển thị trên bảng CMS, Sổ Kho &amp; Sổ Data):
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {(reconcileModalMode === 'ACCEPT_SHOPEE_DIRECT_ADJUSTMENT'
                    ? [
                        'Kiểm đếm thực tế tại kệ khớp với số tồn đã điều chỉnh trên Sàn Shopee',
                        'Nhập bổ sung hàng thực tế lên Sàn trước khi lập phiếu nhập CMS',
                        'Trừ hàng lỗi/vỡ/hao hụt phát hiện khi đóng gói tại kho',
                        'Xuất hàng mẫu / quà tặng ngoại lệ đã trừ trực tiếp trên Sàn',
                      ]
                    : reconcileModalMode === 'KEEP_WAREHOUSE_AND_PUSH'
                      ? [
                          'Thao tác sửa nhầm trên Sàn — Giữ nguyên số tồn chuẩn tại Kho CMS & đẩy lại lên Sàn',
                          'Tồn tại Kho Trung Tâm đã kiểm đếm thực tế chính xác 100%',
                          'Khôi phục số tồn Sàn theo sổ sách CMS chuẩn',
                        ]
                      : [
                          'Chốt tồn đầu kỳ từ Sàn Shopee khi kho CMS đang trống (= 0)',
                          'Đồng bộ mốc tồn đầu kỳ theo số thực tế đang mở bán trên Sàn',
                        ]
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setReconcileReasonDraft(preset)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                        reconcileReasonDraft === preset
                          ? 'border-violet-600 bg-violet-600 text-white font-medium'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <Input
                  id="reconcile-reason-input"
                  value={reconcileReasonDraft}
                  onChange={(e) => setReconcileReasonDraft(e.target.value)}
                  placeholder="Nhập lý do chi tiết để dễ theo dõi trên CMS (VD: Kiểm kệ thực tế còn 15 bộ, 1 bộ nứt vỡ)..."
                  className="text-xs"
                />
              </div>
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!reconcileModalItem || linkingBusyId !== null}
              onClick={() =>
                reconcileModalItem &&
                void handleResolveOpeningOrReconcile(reconcileModalItem, 'RECONCILE_SHOPEE_ORDERS')
              }
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Quét kiểm tra Đơn Sàn trước
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setReconcileModalItem(null)}>
                Hủy
              </Button>
              <Button
                disabled={!reconcileModalItem || !reconcileReasonDraft.trim() || linkingBusyId !== null}
                onClick={() =>
                  reconcileModalItem &&
                  void handleResolveOpeningOrReconcile(
                    reconcileModalItem,
                    reconcileModalMode,
                    reconcileReasonDraft
                  )
                }
              >
                {linkingBusyId ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                )}
                Xác nhận &amp; Lưu lý do
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DIALOG 3: SỬA GIÁ BÁN & TỒN KHO HÀNG LOẠT TRÊN NHIỀU SẢN PHẨM KÊNH BÁN */}
      <Dialog open={bulkEditOpen} onOpenChange={setBulkEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-primary" />
              Điều chỉnh Giá bán &amp; Tồn kho hàng loạt ({selectedLinkedIds.length} sản phẩm)
            </DialogTitle>
            <DialogDescription>
              Cập nhật đồng thời Kho CMS và đẩy tự động lên Sàn Shopee qua hàng đợi Outbox cho tất cả sản phẩm đang chọn.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Khối điều chỉnh Giá bán */}
            <div className="space-y-2 rounded-lg border p-3.5">
              <Label className="text-xs font-semibold">1. Điều chỉnh Giá bán lẻ (VNĐ / %)</Label>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {(
                  [
                    { key: 'NONE', label: 'Giữ nguyên' },
                    { key: 'SET', label: 'Đặt giá mới' },
                    { key: 'ADD_AMOUNT', label: '+/- Số tiền' },
                    { key: 'ADD_PERCENT', label: '+/- Phần trăm (%)' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setBulkPriceMode(opt.key)}
                    className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                      bulkPriceMode === opt.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {bulkPriceMode !== 'NONE' && (
                <div className="pt-1">
                  <Input
                    type="number"
                    placeholder={
                      bulkPriceMode === 'SET'
                        ? 'Nhập giá bán mới (VD: 159000)'
                        : bulkPriceMode === 'ADD_AMOUNT'
                          ? 'Nhập số tiền tăng/giảm (VD: 10000 hoặc -5000)'
                          : 'Nhập % tăng/giảm (VD: 10 hoặc -5)'
                    }
                    value={bulkPriceValue}
                    onChange={(e) => setBulkPriceValue(e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Khối điều chỉnh Tồn kho */}
            <div className="space-y-2 rounded-lg border p-3.5">
              <Label className="text-xs font-semibold">2. Điều chỉnh Tồn kho khả dụng</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { key: 'NONE', label: 'Giữ nguyên' },
                    { key: 'SET', label: 'Đặt mức tồn mới' },
                    { key: 'ADD_DELTA', label: '+/- Cộng trừ tồn' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setBulkStockMode(opt.key)}
                    className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                      bulkStockMode === opt.key
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'hover:bg-muted/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {bulkStockMode !== 'NONE' && (
                <div className="pt-1">
                  <Input
                    type="number"
                    placeholder={
                      bulkStockMode === 'SET'
                        ? 'Nhập số lượng tồn kho mới (VD: 30)'
                        : 'Nhập số lượng cộng/trừ (VD: 10 hoặc -5)'
                    }
                    value={bulkStockValue}
                    onChange={(e) => setBulkStockValue(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkEditOpen(false)}>
              Hủy
            </Button>
            <Button
              disabled={
                bulkBusy ||
                (bulkPriceMode === 'NONE' && bulkStockMode === 'NONE') ||
                (bulkPriceMode !== 'NONE' && bulkPriceValue.trim() === '') ||
                (bulkStockMode !== 'NONE' && bulkStockValue.trim() === '')
              }
              onClick={() =>
                void handleExecuteBulkLinkedAction('UPDATE_PRICE_AND_STOCK', {
                  priceMode: bulkPriceMode,
                  priceValue: Number(bulkPriceValue || 0),
                  stockMode: bulkStockMode,
                  stockValue: Number(bulkStockValue || 0),
                })
              }
            >
              {bulkBusy ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Zap className="mr-1.5 h-4 w-4" />
              )}
              Cập nhật &amp; Đồng bộ Sàn ({selectedLinkedIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopeeCookieSyncDialog
        open={cookieDialogOpen}
        onOpenChange={setCookieDialogOpen}
        initialTab={cookieDialogTab}
        sessionStatus={shopeeSession}
        onSessionUpdated={(nextStatus) => {
          if (nextStatus) {
            setShopeeSession(nextStatus)
          }
          void load(true)
        }}
      />

      <ConfirmDialog
        open={pendingDisconnect !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDisconnect(null)
        }}
        title={`Ngắt kết nối kênh ${pendingDisconnect?.name ?? ''}?`}
        description="Đơn hàng mới từ kênh này sẽ không còn được đồng bộ về hệ thống. Bạn có thể kết nối lại bất cứ lúc nào."
        confirmText="Ngắt kết nối"
        destructive
        loading={pendingDisconnect !== null && togglingId === pendingDisconnect.id}
        onConfirm={() => void handleConfirmDisconnect()}
      />
    </div>
  )
}
