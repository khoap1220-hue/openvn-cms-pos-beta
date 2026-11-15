'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import {
  DEFAULT_INVENTORY_SYNC_POLICY,
  type InventoryMarketplaceSyncMode,
  type InventorySyncPolicy,
  type NegativeStockScope,
  parseInventorySyncPolicy,
} from '@/lib/inventory-policy-shared'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { cn } from '@/lib/utils'
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  Save,
  ShieldCheck,
  TrendingDown,
  Zap,
} from 'lucide-react'

interface InventoryPolicyCardProps {
  /** Chế độ thu gọn khi nhúng ở đầu trang Kênh bán hoặc đầu tab Danh mục Cài đặt */
  compact?: boolean
  defaultExpanded?: boolean
  onPolicySaved?: (next: InventorySyncPolicy) => void
}

export function InventoryPolicyCard({
  compact = false,
  defaultExpanded = !compact,
  onPolicySaved,
}: InventoryPolicyCardProps) {
  const { toast } = useToast()
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyingVirtual, setApplyingVirtual] = useState(false)

  const [savedPolicy, setSavedPolicy] = useState<InventorySyncPolicy>(DEFAULT_INVENTORY_SYNC_POLICY)
  const [syncMode, setSyncMode] = useState<InventoryMarketplaceSyncMode>(
    DEFAULT_INVENTORY_SYNC_POLICY.syncMode
  )
  const [virtualStockQty, setVirtualStockQty] = useState<string>(
    String(DEFAULT_INVENTORY_SYNC_POLICY.virtualStockQty)
  )
  const [virtualMinThreshold, setVirtualMinThreshold] = useState<string>(
    String(DEFAULT_INVENTORY_SYNC_POLICY.virtualMinThreshold)
  )
  const [virtualAutoRefill, setVirtualAutoRefill] = useState<boolean>(
    DEFAULT_INVENTORY_SYNC_POLICY.virtualAutoRefill
  )
  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(
    DEFAULT_INVENTORY_SYNC_POLICY.allowNegativeStock
  )
  const [negativeStockScope, setNegativeStockScope] = useState<NegativeStockScope>(
    DEFAULT_INVENTORY_SYNC_POLICY.negativeStockScope
  )

  const hydrateFromPolicy = useCallback((pol: InventorySyncPolicy) => {
    setSavedPolicy(pol)
    setSyncMode(pol.syncMode)
    setVirtualStockQty(String(pol.virtualStockQty))
    setVirtualMinThreshold(String(pol.virtualMinThreshold))
    setVirtualAutoRefill(pol.virtualAutoRefill)
    setAllowNegativeStock(pol.allowNegativeStock)
    setNegativeStockScope(pol.negativeStockScope)
  }, [])

  const loadPolicy = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const raw = await apiGet<Record<string, unknown>>('/api/settings')
        const parsed = parseInventorySyncPolicy(raw)
        hydrateFromPolicy(parsed)
      } catch {
        // Giữ cấu hình mặc định an toàn nếu mạng tạm gián đoạn
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [hydrateFromPolicy]
  )

  useEffect(() => {
    void loadPolicy()
  }, [loadPolicy])

  useRealtime((ev) => {
    if (ev.type === 'settings.updated') {
      void loadPolicy(true)
    }
  })

  const parsedQty = Math.max(1, Math.min(999_999, Math.round(Number(virtualStockQty) || 100)))
  const parsedThreshold = Math.max(
    0,
    Math.min(Math.max(0, parsedQty - 1), Math.round(Number(virtualMinThreshold) || 10))
  )

  const isDirty =
    syncMode !== savedPolicy.syncMode ||
    parsedQty !== savedPolicy.virtualStockQty ||
    parsedThreshold !== savedPolicy.virtualMinThreshold ||
    virtualAutoRefill !== savedPolicy.virtualAutoRefill ||
    allowNegativeStock !== savedPolicy.allowNegativeStock ||
    negativeStockScope !== savedPolicy.negativeStockScope

  const handleSave = async () => {
    setSaving(true)
    try {
      const updatedRaw = await apiPatch<Record<string, unknown>>('/api/settings', {
        inventory_sync_mode: syncMode,
        inventory_virtual_stock_qty: String(parsedQty),
        inventory_virtual_min_threshold: String(parsedThreshold),
        inventory_virtual_auto_refill: String(virtualAutoRefill),
        inventory_allow_negative_stock: String(allowNegativeStock),
        inventory_negative_stock_scope: negativeStockScope,
      })
      const nextPol = parseInventorySyncPolicy(updatedRaw)
      hydrateFromPolicy(nextPol)
      onPolicySaved?.(nextPol)
      toast({
        title: 'Đã lưu chính sách Tồn kho Thật CMS & Đồng bộ Sàn',
        description:
          nextPol.syncMode === 'SYNC_CMS_TO_MARKETPLACE'
            ? `Chế độ 1: Đồng bộ tồn kho thật CMS ➔ Sàn · Bán âm CMS: ${nextPol.allowNegativeStock ? 'BẬT' : 'TẮT'}`
            : `Chế độ 2: Sàn chạy tồn ảo (${nextPol.virtualStockQty}) chống ghi đè tồn thật CMS · Bán âm CMS: ${nextPol.allowNegativeStock ? 'BẬT' : 'TẮT'}`,
      })
    } catch (e) {
      toast({
        title: 'Không thể lưu cấu hình tồn kho',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleApplyVirtualStockNow = async () => {
    setApplyingVirtual(true)
    try {
      // Nếu người dùng vừa đổi số lượng tồn ảo hoặc chế độ mà chưa bấm Lưu, lưu trước để đồng nhất
      if (isDirty) {
        const updatedRaw = await apiPatch<Record<string, unknown>>('/api/settings', {
          inventory_sync_mode: syncMode,
          inventory_virtual_stock_qty: String(parsedQty),
          inventory_virtual_min_threshold: String(parsedThreshold),
          inventory_virtual_auto_refill: String(virtualAutoRefill),
          inventory_allow_negative_stock: String(allowNegativeStock),
          inventory_negative_stock_scope: negativeStockScope,
        })
        const nextPol = parseInventorySyncPolicy(updatedRaw)
        hydrateFromPolicy(nextPol)
        onPolicySaved?.(nextPol)
      }

      const res = await apiPost<{
        ok: boolean
        queuedCount?: number
        virtualStockQty?: number
        message?: string
      }>('/api/channels/product-links', {
        action: 'APPLY_VIRTUAL_STOCK_TO_MARKETPLACE',
        virtualStockQty: parsedQty,
      })
      toast({
        title: `Đã xếp lệnh áp mức tồn ảo (${res.virtualStockQty ?? parsedQty}) lên Sàn`,
        description:
          res.message ||
          `Đã xếp hàng đợi đẩy tồn ảo cho ${res.queuedCount ?? 0} SKU mà không chạm vào Kho thật CMS.`,
      })
    } catch (e) {
      toast({
        title: 'Không thể áp mức tồn ảo lên Sàn',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setApplyingVirtual(false)
    }
  }

  return (
    <Card
      id="inventory-policy-settings-card"
      className={cn(
        'border-emerald-200/90 shadow-sm dark:border-emerald-900/60',
        compact ? 'mb-4 bg-card/95' : ''
      )}
    >
      <CardHeader className={cn(compact ? 'py-3' : 'pb-3')}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
                <Database className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Chính sách Tồn kho Thật CMS &amp; Đồng bộ Tồn kho Sàn
              </CardTitle>
              <Badge
                variant="outline"
                className="border-emerald-300 bg-emerald-50/80 text-[10px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <ShieldCheck className="mr-1 h-3 w-3" />
                CMS = 100% Dữ liệu kho thật
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold',
                  savedPolicy.syncMode === 'SYNC_CMS_TO_MARKETPLACE'
                    ? 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300'
                    : 'border-orange-300 bg-orange-50 text-orange-800 dark:border-orange-800 dark:bg-orange-950/50 dark:text-orange-300'
                )}
              >
                {savedPolicy.syncMode === 'SYNC_CMS_TO_MARKETPLACE'
                  ? '1. Đồng bộ CMS ➔ Sàn'
                  : `2. Sàn luôn tồn ảo (${savedPolicy.virtualStockQty}) · Chống ghi đè CMS`}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold',
                  savedPolicy.allowNegativeStock
                    ? 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-300'
                    : 'border-border bg-muted/60 text-muted-foreground'
                )}
              >
                {savedPolicy.allowNegativeStock
                  ? `3. Bán âm CMS: BẬT (${savedPolicy.negativeStockScope === 'ALL_CHANNELS' ? 'Mọi kênh' : 'Chỉ đơn Sàn'})`
                  : '3. Bán âm CMS: TẮT'}
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Sàn TMĐT có thể chạy tồn kho ảo để chốt đơn liên tục (kể cả khi đang Live), nhưng tồn kho trên CMS bắt buộc là dữ liệu vật lý thật tại kho và không bao giờ bị tồn ảo từ Sàn ghi đè.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            {compact && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold"
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    Thu gọn
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    Tùy chỉnh 3 chế độ tồn kho
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4 pt-0">
          {/* Lựa chọn 1 vs 2: Quan hệ giữa Kho thật CMS và Tồn kho Sàn */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* TÙY CHỌN 1 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSyncMode('SYNC_CMS_TO_MARKETPLACE')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSyncMode('SYNC_CMS_TO_MARKETPLACE')
                }
              }}
              className={cn(
                'cursor-pointer rounded-xl border p-3.5 text-left transition-all',
                syncMode === 'SYNC_CMS_TO_MARKETPLACE'
                  ? 'border-[#0066CC] bg-sky-50/60 ring-1 ring-[#0066CC]/30 dark:border-sky-500 dark:bg-sky-950/30'
                  : 'border-border/80 bg-background hover:border-sky-300/80'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-[#0066CC] dark:text-sky-400" />
                  <span className="text-xs font-bold text-foreground sm:text-sm">
                    1. Đồng bộ tồn kho thật từ CMS lên Sàn
                  </span>
                </div>
                {syncMode === 'SYNC_CMS_TO_MARKETPLACE' && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0066CC] dark:text-sky-400" />
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Mọi biến động tại Kho thật CMS (Nhập kho, Xuất kho, Bán POS, Huỷ đơn) tự động đồng bộ số tồn thực tế{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">max(0, Tồn CMS)</code> lên Sàn Shopee để khóa bán lố theo tồn vật lý.
              </p>
            </div>

            {/* TÙY CHỌN 2 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSyncMode('VIRTUAL_ALWAYS_IN_STOCK')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setSyncMode('VIRTUAL_ALWAYS_IN_STOCK')
                }
              }}
              className={cn(
                'cursor-pointer rounded-xl border p-3.5 text-left transition-all',
                syncMode === 'VIRTUAL_ALWAYS_IN_STOCK'
                  ? 'border-orange-500 bg-orange-50/60 ring-1 ring-orange-500/30 dark:border-orange-500 dark:bg-orange-950/30'
                  : 'border-border/80 bg-background hover:border-orange-300/80'
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                  <span className="text-xs font-bold text-foreground sm:text-sm">
                    2. Sàn luôn tồn hàng ở mức ảo — Chống ghi đè tồn thật
                  </span>
                </div>
                {syncMode === 'VIRTUAL_ALWAYS_IN_STOCK' && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                Sàn duy trì tồn kho ảo để luôn còn hàng bán (đặc biệt khi Livestream / Pre-order / Sản xuất theo đơn). Chặn 100% việc tồn ảo từ Sàn ghi đè vào Kho thật CMS và không đẩy tồn{' '}
                <code className="rounded bg-muted px-1 py-0.5 text-[11px]">0</code> lên làm tắt hàng trên Sàn.
              </p>
            </div>
          </div>

          {/* Tham số chi tiết khi chọn Tùy chọn 2 (Tồn ảo trên Sàn) */}
          {syncMode === 'VIRTUAL_ALWAYS_IN_STOCK' && (
            <div className="rounded-xl border border-orange-200/80 bg-orange-50/35 p-3.5 dark:border-orange-900/60 dark:bg-orange-950/20">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="inv-virtual-qty" className="text-xs font-semibold">
                    Mức tồn ảo trên Sàn
                  </Label>
                  <Input
                    id="inv-virtual-qty"
                    type="number"
                    min={1}
                    max={999999}
                    value={virtualStockQty}
                    onChange={(e) => setVirtualStockQty(e.target.value)}
                    className="h-8 bg-background font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Số lượng hiển thị còn hàng trên Sàn (VD: 100)
                  </p>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inv-virtual-min" className="text-xs font-semibold">
                    Ngưỡng tự bù tồn ảo
                  </Label>
                  <Input
                    id="inv-virtual-min"
                    type="number"
                    min={0}
                    max={Math.max(0, parsedQty - 1)}
                    value={virtualMinThreshold}
                    onChange={(e) => setVirtualMinThreshold(e.target.value)}
                    className="h-8 bg-background font-mono text-xs"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Khi tồn Sàn ≤ ngưỡng này sẽ tự bơm lại lên {parsedQty}
                  </p>
                </div>

                <div className="flex flex-col justify-between rounded-lg border border-orange-200/70 bg-background/90 px-3 py-2 dark:border-orange-900/50">
                  <div className="flex items-center justify-between gap-2">
                    <Label
                      htmlFor="inv-virtual-autorefill"
                      className="cursor-pointer text-xs font-semibold"
                    >
                      Tự động bù tồn ảo Sàn
                    </Label>
                    <Switch
                      id="inv-virtual-autorefill"
                      checked={virtualAutoRefill}
                      onCheckedChange={setVirtualAutoRefill}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {virtualAutoRefill
                      ? `Tự động bơm lên ${parsedQty} khi Sàn tụt ≤ ${parsedThreshold}`
                      : 'Chỉ bảo vệ tồn Sàn hiện có, không tự sửa số trên Sàn'}
                  </p>
                </div>

                <div className="flex flex-col justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={applyingVirtual || loading}
                    onClick={() => void handleApplyVirtualStockNow()}
                    className="h-9 w-full gap-1.5 border-orange-400 bg-background text-xs font-semibold text-orange-700 hover:bg-orange-100/70 dark:border-orange-800 dark:text-orange-300"
                  >
                    {applyingVirtual ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Áp mức tồn ảo ({parsedQty}) lên Sàn
                  </Button>
                  <p className="mt-1 text-center text-[10px] text-muted-foreground">
                    Không thay đổi Kho thật CMS
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TÙY CHỌN 3: Cho phép bán âm Kho thật CMS */}
          <div
            className={cn(
              'rounded-xl border p-3.5 transition-colors',
              allowNegativeStock
                ? 'border-violet-300 bg-violet-50/45 dark:border-violet-800/80 dark:bg-violet-950/25'
                : 'border-border/80 bg-muted/25'
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  <Label
                    htmlFor="inv-allow-negative"
                    className="cursor-pointer text-xs font-bold text-foreground sm:text-sm"
                  >
                    3. Cho phép bán âm Kho thật CMS (Ghi nhận âm kho vật lý thật)
                  </Label>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Khi bật: Đơn bán vượt tồn vẫn được tiếp nhận &amp; in phiếu bình thường, đồng thời trừ thẳng Kho thật CMS xuống số âm (VD:{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">0 ➔ -3</code>). Khi xưởng sản xuất / nhập kho thực tế{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">+20</code>, tồn kho thật tự động bù trừ chuẩn xác thành{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">+17</code>.
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {allowNegativeStock && (
                  <div className="w-56">
                    <Select
                      value={negativeStockScope}
                      onValueChange={(val) => setNegativeStockScope(val as NegativeStockScope)}
                    >
                      <SelectTrigger className="h-8 bg-background text-xs">
                        <SelectValue placeholder="Phạm vi bán âm" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ALL_CHANNELS">
                          Mọi kênh (Sàn + POS + Nội bộ)
                        </SelectItem>
                        <SelectItem value="MARKETPLACE_ONLY">
                          Chỉ đơn từ Sàn (POS vẫn chặn ≤ 0)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Switch
                  id="inv-allow-negative"
                  checked={allowNegativeStock}
                  onCheckedChange={setAllowNegativeStock}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
            <p className="text-[11px] text-muted-foreground">
              {isDirty
                ? 'Bạn có thay đổi chưa lưu — bấm «Lưu chính sách tồn kho» để áp dụng tức thì trên toàn hệ thống.'
                : 'Đang áp dụng đồng bộ thời gian thực cho Kho CMS, Quầy POS và Trạm đồng bộ Sàn Shopee.'}
            </p>
            <Button
              type="button"
              size="sm"
              disabled={saving || loading || !isDirty}
              onClick={() => void handleSave()}
              className="h-8 gap-1.5 bg-[#0066CC] text-xs font-semibold text-white hover:bg-[#0055B3]"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Lưu chính sách tồn kho
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
