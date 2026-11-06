'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatDateTime, formatNumber, formatVND } from '@/lib/format'
import {
  MOVEMENT_TYPE_LABELS,
  type CrossSellSettlement,
  type Product,
  type StockMovement,
  type WarehouseInfo,
} from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpFromLine,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  History,
  Layers,
  Loader2,
  Minus,
  MoreHorizontal,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  RotateCcw,
  ScanLine,
  Search,
  Star,
  Store,
  Wallet,
  Warehouse,
} from 'lucide-react'

import { BarcodeScanner } from '@/components/cms/barcode-scanner'
import { FastStockTerminal } from '@/components/cms/views/fast-stock-terminal'
import { WarehouseModuleNav } from '@/components/cms/warehouse-module-nav'
import type { ViewId } from '@/components/cms/app-sidebar'
import { DataLineageBadge, LineageInspectorDialog, type LineageInspectorTarget } from '@/components/cms/lineage'
import { PeriodFilterBar, PeriodSummaryBar } from '@/components/cms/period-filter-bar'
import { EMPTY_PERIOD, type PeriodRange } from '@/lib/lineage'

type LowStockProduct = Pick<
  Product,
  'id' | 'sku' | 'name' | 'stock' | 'lowStockThreshold' | 'sellPrice' | 'image'
>

/** Product của lib/types chưa có barcode — mở rộng cục bộ cho đến khi lib cập nhật */
type ProductWithBarcode = Product & { barcode?: string | null }

type MovementType = 'IMPORT' | 'EXPORT' | 'ADJUST'

const MOVEMENT_TYPE_OPTIONS: MovementType[] = ['IMPORT', 'EXPORT', 'ADJUST']

const MOVEMENT_BADGE_CLASSES: Record<string, string> = {
  IMPORT: 'border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  EXPORT: 'border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  ADJUST: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
}

interface MovementFormState {
  productId: string
  warehouseId: string
  type: MovementType
  quantity: string
  note: string
  conversionRate: string
  inputUnit: string
}

const EMPTY_MOVEMENT_FORM: MovementFormState = {
  productId: '',
  warehouseId: '',
  type: 'IMPORT',
  quantity: '',
  note: '',
  conversionRate: '1',
  inputUnit: 'cái',
}

type WarehouseWithStocks = WarehouseInfo & {
  stocks?: Array<{
    id?: string
    warehouseId: string
    productId: string
    quantity: number
  }>
}

// ===== Data Provenance: movement trả thêm nguồn gốc + API trả thêm đối chiếu kỳ =====
type MovementWithOrigin = StockMovement & { originSource?: string | null }

interface InventoryPeriodSummary {
  opening: number
  importQty: number
  exportQty: number
  adjustQty: number
  closing: number
  movementCount: number
  fromDate: string | null
  toDate: string | null
}

export type InventoryModuleMode = 'STOCK' | 'EXPORT' | 'BALANCE'

function isRawMaterialProduct(p: ProductWithBarcode): boolean {
  if (p.type === 'COMBO') return false
  if (p.type === 'MATERIAL' || p.type === 'WEIGHT_BULK') return true
  const sku = (p.sku || '').toUpperCase()
  const baseUnit = (p.unitConfig?.baseUnit || p.unit || '').toLowerCase()
  return (
    sku.includes('-SAP-') ||
    sku.includes('-TINH-') ||
    sku.includes('-VL-') ||
    sku === 'UD-NEN-002' ||
    ['gr', 'kg', 'ml', 'lít', 'bó'].includes(baseUnit)
  )
}

function getNormalizedUnitCost(p: ProductWithBarcode): number {
  const rate = p.unitConfig?.purchaseRate ?? 1
  if (rate > 1 && p.costPrice >= rate) {
    return Math.round(p.costPrice / rate)
  }
  return p.costPrice || 0
}

export function InventoryView({
  initialModule = 'STOCK',
  onNavigate,
}: {
  initialModule?: InventoryModuleMode
  onNavigate?: (view: ViewId) => void
} = {}) {
  const [lowStock, setLowStock] = useState<LowStockProduct[] | null>(null)
  const [movements, setMovements] = useState<MovementWithOrigin[] | null>(null)
  const [products, setProducts] = useState<ProductWithBarcode[] | null>(null)
  const [warehouses, setWarehouses] = useState<WarehouseWithStocks[]>([])
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string>('ALL')
  const [editingWhId, setEditingWhId] = useState<string | null>(null)
  const [settlements, setSettlements] = useState<CrossSellSettlement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const qtyInputRef = useRef<HTMLInputElement | null>(null)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<MovementFormState>(EMPTY_MOVEMENT_FORM)
  const [submitting, setSubmitting] = useState(false)

  // Sub-tabs theo từng phân hệ: Tồn kho (STOCK) | Xuất kho (EXPORT) | Cân bằng kho (BALANCE)
  const [stockSubTab, setStockSubTab] = useState<'STOCK_TABLE' | 'LOW_STOCK' | 'LEDGER' | 'MULTI_WH'>('STOCK_TABLE')
  const [exportSubTab, setExportSubTab] = useState<'TERMINAL' | 'TRANSFER' | 'HISTORY'>('TERMINAL')
  const [balanceSubTab, setBalanceSubTab] = useState<'QUICK_SHEET' | 'TERMINAL' | 'HISTORY'>('QUICK_SHEET')

  // Bộ lọc cho Bảng Tồn kho chi tiết
  const [stockSearch, setStockSearch] = useState('')
  const [stockFilterType, setStockFilterType] = useState<'ALL' | 'RAW' | 'FINISHED' | 'COMBO' | 'LOW'>('ALL')
  const [ledgerTypeFilter, setLedgerTypeFilter] = useState<'ALL' | 'IMPORT' | 'EXPORT' | 'ADJUST'>('ALL')

  // Bảng Kiểm kê & Cân bằng kho nhanh (Quick Reconciliation Sheet)
  const [balanceSearch, setBalanceSearch] = useState('')
  const [balanceFilterType, setBalanceFilterType] = useState<'ALL' | 'RAW' | 'FINISHED' | 'DIFF_ONLY'>('ALL')
  const [actualStockMap, setActualStockMap] = useState<Record<string, string>>({})
  const [balanceNote, setBalanceNote] = useState('Kiểm kê thực tế & cân bằng định kỳ tại kho')
  const [balanceSubmitting, setBalanceSubmitting] = useState(false)

  // Điều chuyển kho (Kho A -> Kho B) & Thêm Kho / Shop liên kết
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferForm, setTransferForm] = useState({
    productId: '',
    fromWarehouseId: '',
    toWarehouseId: '',
    quantity: '5',
    note: '',
  })
  const [transferSubmitting, setTransferSubmitting] = useState(false)

  const [addWhOpen, setAddWhOpen] = useState(false)
  const [addWhForm, setAddWhForm] = useState({
    code: '',
    name: '',
    type: 'PARTNER_SHOP',
    managerName: '',
    phone: '',
    address: '',
    commissionPct: '15',
  })
  const [addWhSubmitting, setAddWhSubmitting] = useState(false)
  const [settlingWhId, setSettlingWhId] = useState<string | null>(null)
  const [settledCodes, setSettledCodes] = useState<Record<string, string>>({})
  const { toast } = useToast()

  // ===== Bộ lọc Kỳ kế toán + Truy xuất nguồn gốc (Data Provenance) =====
  const [period, setPeriod] = useState<PeriodRange>(EMPTY_PERIOD)
  const [periodSummary, setPeriodSummary] = useState<InventoryPeriodSummary | null>(null)
  const [lineageTarget, setLineageTarget] = useState<LineageInspectorTarget | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const movParams = new URLSearchParams({ view: 'movements' })
      if (period.preset !== 'ALL') movParams.set('preset', period.preset)
      if (period.preset === 'CUSTOM') {
        if (period.from) movParams.set('from', period.from)
        if (period.to) movParams.set('to', period.to)
      }
      const [lowStockRes, movementsRes, productsRes, whRes] = await Promise.all([
        apiGet<{ products: ProductWithBarcode[] }>('/api/inventory?view=lowstock'),
        apiGet<{ movements: MovementWithOrigin[]; period?: InventoryPeriodSummary }>(
          `/api/inventory?${movParams.toString()}`
        ),
        apiGet<{ products: ProductWithBarcode[] }>('/api/products'),
        apiGet<{ warehouses: WarehouseWithStocks[]; settlements: CrossSellSettlement[] }>('/api/warehouses').catch(
          () => ({ warehouses: [], settlements: [] })
        ),
      ])
      setLowStock(lowStockRes.products)
      setMovements(movementsRes.movements)
      setPeriodSummary(movementsRes.period ?? null)
      setProducts(productsRes.products)
      setWarehouses(whRes.warehouses)
      setSettlements(whRes.settlements)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải dữ liệu kho'
      setError(message)
      toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast, period])

  useEffect(() => {
    void load()
  }, [load])

  const selectedProduct = useMemo(
    () => products?.find((p) => p.id === form.productId) ?? null,
    [products, form.productId]
  )

  const qtyNum = Number(form.quantity)
  const hasQty = form.quantity !== '' && !Number.isNaN(qtyNum) && Number.isFinite(qtyNum)
  const effectiveConvRate = form.type === 'ADJUST' ? 1 : Math.max(1, Number(form.conversionRate) || 1)
  const convertedQty = hasQty ? Math.round(qtyNum * effectiveConvRate) : 0
  const baseUnitLabel = selectedProduct?.unitConfig?.baseUnit || selectedProduct?.unit || 'cái'

  // Preview tồn kho sau thao tác (tự động nhân hệ số quy đổi VD: 10 kg x 1000 = 10.000 gr)
  const preview = useMemo(() => {
    if (!selectedProduct || !hasQty) return null
    const current = selectedProduct.stock
    if (form.type === 'IMPORT') return { current, next: current + convertedQty, delta: convertedQty }
    if (form.type === 'EXPORT') return { current, next: current - convertedQty, delta: -convertedQty }
    return { current, next: qtyNum, delta: qtyNum - current }
  }, [selectedProduct, form.type, qtyNum, convertedQty, hasQty])

  const submitDisabled =
    !form.productId ||
    !hasQty ||
    (form.type !== 'ADJUST' && qtyNum <= 0) ||
    (form.type === 'EXPORT' && preview !== null && preview.next < 0)

  const openDialog = useCallback(
    (prefill?: { productId: string; type: MovementType; warehouseId?: string }) => {
      const defWh =
        prefill?.warehouseId ||
        (selectedWarehouseId !== 'ALL' ? selectedWarehouseId : warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || '')
      if (prefill) {
        const prod = products?.find((p) => p.id === prefill.productId)
        const uc = prod?.unitConfig
        const defaultRate = prefill.type === 'IMPORT' && uc?.purchaseRate && uc.purchaseRate > 1 ? String(uc.purchaseRate) : '1'
        const defaultUnit =
          prefill.type === 'IMPORT' && uc?.purchaseUnit ? uc.purchaseUnit : uc?.baseUnit || prod?.unit || 'cái'
        setForm({
          ...EMPTY_MOVEMENT_FORM,
          productId: prefill.productId,
          warehouseId: defWh,
          type: prefill.type,
          quantity: prefill.type === 'ADJUST' && prod ? String(prod.stock) : '',
          conversionRate: defaultRate,
          inputUnit: defaultUnit,
        })
      } else {
        setForm({ ...EMPTY_MOVEMENT_FORM, warehouseId: defWh })
      }
      setDialogOpen(true)
    },
    [products, selectedWarehouseId, warehouses]
  )

  // Quét mã vạch → tự mở phiếu nhập/xuất cho sản phẩm tương ứng
  const handleBarcodeScan = useCallback(
    async (code: string) => {
      // Ưu tiên tra trong state đã tải; không thấy thì hỏi server theo barcode chính xác
      let found = (products ?? []).find((p) => p.barcode === code) ?? null
      if (!found) {
        try {
          const res = await apiGet<{ products: ProductWithBarcode[] }>(
            `/api/products?barcode=${encodeURIComponent(code)}`
          )
          found = res.products[0] ?? null
        } catch {
          found = null
        }
      }
      if (!found) {
        toast({ title: `Không tìm thấy sản phẩm với mã vạch ${code}`, variant: 'destructive' })
        return
      }
      const product = found
      // Nếu SP tra từ server chưa có trong state, bổ sung để Select hiển thị đúng
      setProducts((prev) => (prev && !prev.some((p) => p.id === product.id) ? [...prev, product] : prev))
      openDialog({ productId: product.id, type: 'IMPORT' })
      toast({ title: `Đã chọn sản phẩm ${product.sku} — ${product.name}` })
      setTimeout(() => qtyInputRef.current?.focus(), 100)
    },
    [products, openDialog, toast]
  )

  const handleSubmit = async () => {
    if (!form.productId) {
      toast({ title: 'Vui lòng chọn sản phẩm', variant: 'destructive' })
      return
    }
    if (!hasQty) {
      toast({ title: 'Vui lòng nhập số lượng', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      await apiPost<{ movement: StockMovement }>('/api/inventory', {
        productId: form.productId,
        warehouseId: form.warehouseId || (selectedWarehouseId !== 'ALL' ? selectedWarehouseId : warehouses[0]?.id) || undefined,
        type: form.type,
        quantity: qtyNum,
        conversionRate: effectiveConvRate,
        inputUnit: form.inputUnit || baseUnitLabel,
        note: form.note.trim() || undefined,
      })
      toast({
        title: `Đã ${MOVEMENT_TYPE_LABELS[form.type].toLowerCase()} thành công`,
        description: selectedProduct
          ? effectiveConvRate > 1
            ? `${selectedProduct.name}: ${qtyNum} ${form.inputUnit} × ${formatNumber(effectiveConvRate)} = ${formatNumber(convertedQty)} ${baseUnitLabel}`
            : `${selectedProduct.name} — ${MOVEMENT_TYPE_LABELS[form.type]} ${formatNumber(qtyNum)} ${baseUnitLabel}`
          : undefined,
      })
      setDialogOpen(false)
      setForm(EMPTY_MOVEMENT_FORM)
      await load()
    } catch (e) {
      toast({
        title: 'Thao tác kho thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleTransferSubmit = async () => {
    if (!transferForm.productId || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      toast({ title: 'Vui lòng chọn Sản phẩm, Kho xuất và Kho nhận', variant: 'destructive' })
      return
    }
    setTransferSubmitting(true)
    try {
      const res = await apiPost<{
        transfer: {
          sku: string
          productName: string
          fromWarehouseName: string
          toWarehouseName: string
          quantity: number
        }
      }>('/api/warehouses', {
        action: 'TRANSFER',
        productId: transferForm.productId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: Number(transferForm.quantity) || 1,
        note: transferForm.note,
      })
      toast({
        title: `Đã điều chuyển ${res.transfer.quantity} × ${res.transfer.sku}`,
        description: `${res.transfer.fromWarehouseName} ➔ ${res.transfer.toWarehouseName}`,
      })
      setTransferOpen(false)
      await load()
    } catch (e) {
      toast({
        title: 'Điều chuyển kho thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại tồn kho',
        variant: 'destructive',
      })
    } finally {
      setTransferSubmitting(false)
    }
  }

  const handleAddWarehouse = async () => {
    if (!addWhForm.name.trim()) {
      toast({ title: 'Vui lòng nhập tên Kho hoặc Shop liên kết', variant: 'destructive' })
      return
    }
    setAddWhSubmitting(true)
    try {
      await apiPost('/api/warehouses', {
        action: editingWhId ? 'UPDATE_WAREHOUSE' : undefined,
        warehouseId: editingWhId || undefined,
        code: addWhForm.code,
        name: addWhForm.name,
        type: addWhForm.type,
        managerName: addWhForm.managerName,
        phone: addWhForm.phone,
        address: addWhForm.address,
        commissionPct: Number(addWhForm.commissionPct) || 0,
      })
      toast({ title: editingWhId ? `Đã cập nhật ${addWhForm.name}` : `Đã thêm ${addWhForm.name}` })
      setAddWhOpen(false)
      setEditingWhId(null)
      setAddWhForm({
        code: '',
        name: '',
        type: 'PARTNER_SHOP',
        managerName: '',
        phone: '',
        address: '',
        commissionPct: '15',
      })
      await load()
    } catch (e) {
      toast({
        title: 'Không thể lưu kho / shop liên kết',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setAddWhSubmitting(false)
    }
  }

  const handleSetDefaultWarehouse = async (wh: WarehouseWithStocks) => {
    try {
      await apiPost('/api/warehouses', {
        action: 'SET_DEFAULT',
        warehouseId: wh.id,
      })
      toast({ title: `Đã đặt "${wh.name}" làm Kho mặc định` })
      await load()
    } catch (e) {
      toast({
        title: 'Không thể đổi kho mặc định',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    }
  }

  const openEditWarehouse = (wh: WarehouseWithStocks) => {
    setEditingWhId(wh.id)
    setAddWhForm({
      code: wh.code,
      name: wh.name,
      type: wh.type || 'INTERNAL',
      managerName: wh.managerName || '',
      phone: wh.phone || '',
      address: wh.address || '',
      commissionPct: String(wh.commissionPct ?? 0),
    })
    setAddWhOpen(true)
  }

  const openQuickTransferForProduct = (productId: string, preferredFromWhId?: string) => {
    const defaultFrom =
      preferredFromWhId ||
      (selectedWarehouseId !== 'ALL' ? selectedWarehouseId : warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || '')
    const defaultTo = warehouses.find((w) => w.id !== defaultFrom)?.id || ''
    setTransferForm({
      productId,
      fromWarehouseId: defaultFrom,
      toWarehouseId: defaultTo,
      quantity: '5',
      note: '',
    })
    setTransferOpen(true)
  }

  const handleSettleCrossSell = async (warehouseId: string, shopName: string) => {
    setSettlingWhId(warehouseId)
    try {
      const res = await apiPost<{
        settlement: {
          settlementCode: string
          netPayableToPartner: number
          commissionAmount: number
        }
      }>('/api/warehouses', {
        action: 'SETTLE_CROSS_SELL',
        warehouseId,
      })
      setSettledCodes((prev) => ({ ...prev, [warehouseId]: res.settlement.settlementCode }))
      toast({
        title: `Đã lập phiếu quyết toán ${res.settlement.settlementCode}`,
        description: `Ghi sổ thực trả ${formatVND(res.settlement.netPayableToPartner)} cho ${shopName} & bắn Webhook đối tác.`,
      })
    } catch (e) {
      toast({
        title: 'Không thể quyết toán công nợ',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSettlingWhId(null)
    }
  }

  // Mở Dialog Truy xuất nguồn gốc: toàn bộ lịch sử tồn kho (chuỗi stock before → after) của sản phẩm
  const openMovementLineage = (m: MovementWithOrigin) => {
    if (!m.productId) return
    setLineageTarget({
      entityType: 'Product',
      entityId: m.productId,
      entityCode: m.product?.sku ?? null,
      label: m.product ? `${m.product.name} (${m.product.sku})` : 'Sản phẩm',
    })
  }

  const openProductLineage = (p: ProductWithBarcode) => {
    setLineageTarget({
      entityType: 'Product',
      entityId: p.id,
      entityCode: p.sku,
      label: `${p.name} (${p.sku})`,
    })
  }

  // Bản đồ tồn kho chi tiết từng mặt hàng tại từng kho: productId -> { [warehouseId]: quantity }
  const whStockByProduct = useMemo(() => {
    const map: Record<string, Record<string, number>> = {}
    const defaultWhId = warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || ''
    for (const wh of warehouses) {
      for (const st of wh.stocks ?? []) {
        if (!map[st.productId]) map[st.productId] = {}
        map[st.productId][wh.id] = st.quantity
      }
    }
    // Nếu mặt hàng chưa có dòng phân bổ chi tiết trong WarehouseStock thì mặc định nằm ở Kho chính
    if (defaultWhId && products) {
      for (const p of products) {
        if (p.type === 'COMBO') continue
        const row = map[p.id]
        const sumAllocated = row ? Object.values(row).reduce((s, q) => s + q, 0) : 0
        if (!row || sumAllocated === 0) {
          map[p.id] = { ...(row || {}), [defaultWhId]: Math.max(0, p.stock) }
        }
      }
    }
    return map
  }, [warehouses, products])

  const selectedWarehouseObj = useMemo(
    () => (selectedWarehouseId === 'ALL' ? null : warehouses.find((w) => w.id === selectedWarehouseId) ?? null),
    [selectedWarehouseId, warehouses]
  )

  const getProductStockInSelectedWh = useCallback(
    (p: ProductWithBarcode): number => {
      if (selectedWarehouseId === 'ALL' || p.type === 'COMBO') return p.stock
      return whStockByProduct[p.id]?.[selectedWarehouseId] ?? 0
    },
    [selectedWarehouseId, whStockByProduct]
  )

  // Thống kê Bảng Tồn kho chi tiết (Tự động tính theo Kho đang chọn hoặc Toàn hệ thống)
  const stockStats = useMemo(() => {
    const all = products ?? []
    let rawCount = 0
    let finishedCount = 0
    let comboCount = 0
    let totalCostValue = 0
    for (const p of all) {
      const qty = getProductStockInSelectedWh(p)
      if (selectedWarehouseId !== 'ALL' && p.type !== 'COMBO' && qty <= 0) continue
      if (p.type === 'COMBO') {
        comboCount += 1
      } else if (isRawMaterialProduct(p)) {
        rawCount += 1
        totalCostValue += Math.max(0, qty) * getNormalizedUnitCost(p)
      } else {
        finishedCount += 1
        totalCostValue += Math.max(0, qty) * getNormalizedUnitCost(p)
      }
    }
    return {
      totalCount: selectedWarehouseId === 'ALL' ? all.length : rawCount + finishedCount,
      rawCount,
      finishedCount,
      comboCount,
      totalCostValue,
    }
  }, [products, selectedWarehouseId, getProductStockInSelectedWh])

  const filteredStockProducts = useMemo(() => {
    const all = products ?? []
    const q = stockSearch.trim().toLowerCase()
    return all.filter((p) => {
      const whQty = getProductStockInSelectedWh(p)
      if (selectedWarehouseId !== 'ALL' && p.type !== 'COMBO' && whQty <= 0 && !q) return false
      if (stockFilterType === 'RAW' && !isRawMaterialProduct(p)) return false
      if (stockFilterType === 'FINISHED' && (p.type === 'COMBO' || isRawMaterialProduct(p))) return false
      if (stockFilterType === 'COMBO' && p.type !== 'COMBO') return false
      if (stockFilterType === 'LOW' && (p.type === 'COMBO' || whQty > p.lowStockThreshold)) return false
      if (!q) return true
      return (
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.category?.name ?? '').toLowerCase().includes(q)
      )
    })
  }, [products, stockSearch, stockFilterType, selectedWarehouseId, getProductStockInSelectedWh])

  // Bảng Kiểm kê & Cân bằng kho nhanh (Quick Reconciliation Sheet)
  const physicalProducts = useMemo(
    () => (products ?? []).filter((p) => p.type !== 'COMBO'),
    [products]
  )

  const getActualCountValue = useCallback(
    (p: ProductWithBarcode): number => {
      const raw = actualStockMap[p.id]
      if (raw === undefined || raw === '') return p.stock
      const num = Number(raw)
      return Number.isFinite(num) && num >= 0 ? num : p.stock
    },
    [actualStockMap]
  )

  const discrepancyRows = useMemo(() => {
    return physicalProducts
      .map((p) => {
        const actual = getActualCountValue(p)
        const diff = actual - p.stock
        return { product: p, actual, diff }
      })
      .filter((r) => r.diff !== 0)
  }, [physicalProducts, getActualCountValue])

  const filteredBalanceRows = useMemo(() => {
    const q = balanceSearch.trim().toLowerCase()
    return physicalProducts
      .map((p) => {
        const actual = getActualCountValue(p)
        const diff = actual - p.stock
        return { product: p, actual, diff }
      })
      .filter((r) => {
        if (balanceFilterType === 'RAW' && !isRawMaterialProduct(r.product)) return false
        if (balanceFilterType === 'FINISHED' && isRawMaterialProduct(r.product)) return false
        if (balanceFilterType === 'DIFF_ONLY' && r.diff === 0) return false
        if (!q) return true
        return (
          r.product.sku.toLowerCase().includes(q) ||
          r.product.name.toLowerCase().includes(q) ||
          (r.product.category?.name ?? '').toLowerCase().includes(q)
        )
      })
  }, [physicalProducts, getActualCountValue, balanceSearch, balanceFilterType])

  const handleBatchBalanceSubmit = async () => {
    if (discrepancyRows.length === 0) {
      toast({
        title: 'Chưa có mặt hàng nào lệch tồn',
        description: 'Nhập số lượng kiểm đếm thực tế khác với tồn sổ sách để cân bằng kho.',
        variant: 'destructive',
      })
      return
    }
    setBalanceSubmitting(true)
    try {
      const targetWhId =
        selectedWarehouseId !== 'ALL'
          ? selectedWarehouseId
          : warehouses.find((w) => w.isDefault)?.id || warehouses[0]?.id || undefined
      const res = await apiPost<{ batchCode: string; count: number }>('/api/inventory', {
        type: 'ADJUST',
        mode: 'ADJUST',
        warehouseId: targetWhId,
        note: balanceNote.trim() || 'Phiếu cân bằng kho thực tế',
        items: discrepancyRows.map((r) => ({
          productId: r.product.id,
          quantity: r.actual,
          conversionRate: 1,
          inputUnit: r.product.unitConfig?.baseUnit || r.product.unit || 'cái',
          note: `Cân bằng kho: Sổ sách ${r.product.stock} -> Thực tế ${r.actual} (${r.diff > 0 ? '+' : ''}${r.diff})`,
        })),
      })
      toast({
        title: `Đã cân bằng kho thành công (${res.batchCode})`,
        description: `Đã cập nhật tồn thực tế cho ${res.count} mặt hàng có chênh lệch.`,
      })
      setActualStockMap({})
      await load()
    } catch (e) {
      toast({
        title: 'Không thể cân bằng kho',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setBalanceSubmitting(false)
    }
  }

  const exportMovements = useMemo(
    () => (movements ?? []).filter((m) => m.type === 'EXPORT'),
    [movements]
  )
  const adjustMovements = useMemo(
    () => (movements ?? []).filter((m) => m.type === 'ADJUST'),
    [movements]
  )
  const filteredLedgerMovements = useMemo(() => {
    const all = movements ?? []
    if (ledgerTypeFilter === 'ALL') return all
    return all.filter((m) => m.type === ledgerTypeFilter)
  }, [movements, ledgerTypeFilter])

  const activeNavModule =
    initialModule === 'EXPORT'
      ? 'stock-export'
      : initialModule === 'BALANCE'
        ? 'stock-balance'
        : 'inventory'

  const renderMovementsTable = (rows: MovementWithOrigin[], emptyTitle: string) => {
    if (loading) {
      return (
        <div className="p-4">
          <TableSkeleton rows={6} />
        </div>
      )
    }
    if (rows.length === 0) {
      return (
        <div className="p-6">
          <EmptyState
            icon={ArrowLeftRight}
            title={emptyTitle}
            description="Các bút toán kho phát sinh sẽ được ghi nhận đầy đủ tại đây."
          />
        </div>
      )
    }
    return (
      <div className="max-h-[480px] overflow-auto">
        <Table tableId={`inventory-movements-${initialModule.toLowerCase()}`} className="min-w-[720px]">
          <TableHeader className="sticky top-0 bg-background">
            <TableRow>
              <TableHead defaultHidden>Mã phiếu</TableHead>
              <TableHead>Thời gian</TableHead>
              <TableHead locked>Mặt hàng</TableHead>
              <TableHead defaultHidden>Mã SKU</TableHead>
              <TableHead>Loại phiếu</TableHead>
              <TableHead className="text-right">Tồn trước</TableHead>
              <TableHead className="text-right">Biến động</TableHead>
              <TableHead className="text-right">Tồn sau</TableHead>
              <TableHead>Nguồn gốc</TableHead>
              <TableHead className="hidden lg:table-cell">Diễn giải / Ghi chú</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  #{m.id.slice(0, 8).toUpperCase()}
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                  {formatDateTime(m.createdAt)}
                </TableCell>
                <TableCell>
                  <p className="max-w-[220px] truncate font-medium">
                    {m.product?.name ?? 'Sản phẩm đã xóa'}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{m.product?.sku ?? '—'}</p>
                </TableCell>
                <TableCell className="font-mono text-xs font-medium">{m.product?.sku ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn('border-transparent', MOVEMENT_BADGE_CLASSES[m.type])}>
                    {MOVEMENT_TYPE_LABELS[m.type] ?? m.type}
                  </Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono text-xs text-muted-foreground">
                  {formatNumber((m.stockAfter ?? 0) - (m.quantity ?? 0))}
                </TableCell>
                <TableCell
                  className={cn(
                    'whitespace-nowrap text-right font-mono font-semibold',
                    m.quantity > 0 && 'text-emerald-600 dark:text-emerald-400',
                    m.quantity < 0 && 'text-red-600 dark:text-red-400',
                    m.quantity === 0 && 'text-muted-foreground'
                  )}
                >
                  {m.quantity > 0 ? '+' : ''}
                  {formatNumber(m.quantity)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right font-mono font-semibold">
                  {formatNumber(m.stockAfter)}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <DataLineageBadge
                    originSource={m.originSource}
                    onInspect={m.productId ? () => openMovementLineage(m) : undefined}
                  />
                </TableCell>
                <TableCell className="hidden max-w-[260px] lg:table-cell">
                  <span className="block truncate text-sm text-muted-foreground" title={m.note ?? undefined}>
                    {m.note ?? '—'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  return (
    <div>
      <WarehouseModuleNav
        active={activeNavModule}
        onNavigate={onNavigate}
        lowStockCount={lowStock?.length ?? 0}
      />

      {/* ===== THANH ĐIỀU PHỐI & CHUYỂN ĐỔI ĐA KHO NHANH (TỐI ƯU ĐA THIẾT BỊ) ===== */}
      <div className="mb-4 rounded-xl border border-border/80 bg-card p-2.5 shadow-xs sm:mb-5 sm:p-3">
        {/* Giao diện gọn 1 dòng cho Điện thoại & Tablet (< lg): Select chọn kho + 2 nút tác vụ chính */}
        <div className="flex flex-wrap items-center justify-between gap-2 lg:hidden">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Warehouse className="h-4 w-4" />
            </div>
            <Select value={selectedWarehouseId} onValueChange={setSelectedWarehouseId}>
              <SelectTrigger className="h-9 min-w-[170px] flex-1 text-xs font-semibold">
                <SelectValue placeholder="Chọn phạm vi kho..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">
                  Tất cả các kho ({warehouses.length} kho)
                </SelectItem>
                {warehouses.map((wh) => (
                  <SelectItem key={wh.id} value={wh.id}>
                    {wh.name} ({formatNumber(wh.totalStock ?? 0)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {selectedWarehouseObj && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 px-2.5 text-xs"
                onClick={() => openEditWarehouse(selectedWarehouseObj)}
                title="Sửa thông tin kho đang chọn"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 px-2.5 text-xs"
              onClick={() => {
                const firstProd = products?.find((p) => p.type !== 'COMBO')?.id ?? ''
                openQuickTransferForProduct(firstProd)
              }}
            >
              <ArrowLeftRight className="mr-1 h-3.5 w-3.5 text-[#0066CC]" />
              <span>Chuyển kho</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 px-2.5 text-xs"
              onClick={() => {
                setEditingWhId(null)
                setAddWhForm({
                  code: '',
                  name: '',
                  type: 'INTERNAL',
                  managerName: '',
                  phone: '',
                  address: '',
                  commissionPct: '0',
                })
                setAddWhOpen(true)
              }}
            >
              <Plus className="mr-0.5 h-3.5 w-3.5 text-emerald-600" />
              <span>Kho</span>
            </Button>
          </div>
        </div>

        {/* Giao diện đầy đủ trên Laptop/Desktop (>= lg) */}
        <div className="hidden lg:block">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Warehouse className="h-4 w-4" />
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground">
                  Phạm vi Kho lưu trữ ({warehouses.length} kho hoạt động)
                </span>
                {selectedWarehouseObj ? (
                  <Badge variant="outline" className="border-sky-300 bg-sky-50 text-[10px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300">
                    Đang lọc: {selectedWarehouseObj.name} ({selectedWarehouseObj.code})
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    Toàn hệ thống ({warehouses.length} kho)
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {selectedWarehouseObj && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => openEditWarehouse(selectedWarehouseObj)}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                    Sửa kho
                  </Button>
                  {!selectedWarehouseObj.isDefault && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void handleSetDefaultWarehouse(selectedWarehouseObj)}
                    >
                      <Star className="mr-1 h-3.5 w-3.5 text-amber-500" />
                      Đặt mặc định
                    </Button>
                  )}
                </>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  const firstProd = products?.find((p) => p.type !== 'COMBO')?.id ?? ''
                  openQuickTransferForProduct(firstProd)
                }}
              >
                <ArrowLeftRight className="mr-1 h-3.5 w-3.5 text-[#0066CC]" />
                Điều chuyển kho
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setEditingWhId(null)
                  setAddWhForm({
                    code: '',
                    name: '',
                    type: 'INTERNAL',
                    managerName: '',
                    phone: '',
                    address: '',
                    commissionPct: '0',
                  })
                  setAddWhOpen(true)
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                Thêm Kho
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto border-t pt-2">
            <button
              type="button"
              onClick={() => setSelectedWarehouseId('ALL')}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                selectedWarehouseId === 'ALL'
                  ? 'border-[#0066CC] bg-[#0066CC] text-white'
                  : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Tất cả các kho</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 font-mono text-[10px]',
                  selectedWarehouseId === 'ALL' ? 'bg-white/20 text-white' : 'bg-background text-muted-foreground'
                )}
              >
                {warehouses.length}
              </span>
            </button>

            {warehouses.map((wh) => {
              const active = selectedWarehouseId === wh.id
              const isPartner = wh.type === 'PARTNER_SHOP'
              const WhIcon = isPartner ? Store : Building2
              return (
                <button
                  key={wh.id}
                  type="button"
                  onClick={() => setSelectedWarehouseId(active ? 'ALL' : wh.id)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors',
                    active
                      ? 'border-[#0066CC] bg-[#0066CC] text-white'
                      : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <WhIcon className="h-3.5 w-3.5 shrink-0" />
                  <span className="max-w-[180px] truncate">{wh.name}</span>
                  {wh.isDefault && (
                    <Star
                      className={cn(
                        'h-3 w-3 shrink-0 fill-current',
                        active ? 'text-amber-300' : 'text-amber-500'
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      'rounded-full px-1.5 py-0.2 font-mono text-[10px]',
                      active ? 'bg-white/20 text-white' : 'bg-background text-muted-foreground'
                    )}
                  >
                    {formatNumber(wh.totalStock ?? 0)}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* =====================================================================
          PHÂN HỆ 1: XUẤT KHO & ĐIỀU CHUYỂN NỘI BỘ (initialModule === 'EXPORT')
         ===================================================================== */}
      {initialModule === 'EXPORT' && (
        <>
          <PageHeader
            title="Xuất kho & Điều chuyển nội bộ"
            description="Lập phiếu xuất nguyên vật liệu, xuất sử dụng nội bộ, xuất mẫu thử, xuất hủy hao hụt hoặc điều chuyển hàng giữa các kho"
          >
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setExportSubTab('TERMINAL')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  exportSubTab === 'TERMINAL'
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ArrowUpFromLine className="h-3.5 w-3.5" />
                1. Lập phiếu Xuất kho
              </button>
              <button
                type="button"
                onClick={() => setExportSubTab('TRANSFER')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  exportSubTab === 'TRANSFER'
                    ? 'bg-[#0066CC] text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                2. Điều chuyển kho
              </button>
              <button
                type="button"
                onClick={() => setExportSubTab('HISTORY')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  exportSubTab === 'HISTORY'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <History className="h-3.5 w-3.5" />
                3. Lịch sử ({exportMovements.length})
              </button>
            </div>
          </PageHeader>

          {exportSubTab === 'TERMINAL' && (
            <div className="mb-8">
              <FastStockTerminal
                key="stock-export-terminal"
                defaultMode="EXPORT"
                allowedModes={['EXPORT']}
                onCompleted={() => void load()}
              />
            </div>
          )}

          {exportSubTab === 'TRANSFER' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <Card className="border-border/70 shadow-sm lg:col-span-5">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ArrowLeftRight className="h-5 w-5 text-[#0066CC]" />
                    Lập Phiếu Điều Chuyển Kho (Kho A ➔ Kho B)
                  </CardTitle>
                  <CardDescription>
                    Chuyển nguyên vật liệu hoặc thành phẩm giữa các kho nội bộ và điểm bán liên kết
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label>Mặt hàng điều chuyển *</Label>
                    <Select
                      value={transferForm.productId}
                      onValueChange={(v) => setTransferForm((f) => ({ ...f, productId: v }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Chọn mặt hàng..." />
                      </SelectTrigger>
                      <SelectContent>
                        {physicalProducts.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.sku} — {p.name} (Tồn: {formatNumber(p.stock)} {p.unitConfig?.baseUnit || p.unit || 'cái'})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Từ Kho xuất (Nguồn) *</Label>
                      <Select
                        value={transferForm.fromWarehouseId}
                        onValueChange={(v) => setTransferForm((f) => ({ ...f, fromWarehouseId: v }))}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Chọn kho xuất" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses.map((wh) => (
                            <SelectItem key={wh.id} value={wh.id}>
                              {wh.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Đến Kho nhận (Đích) *</Label>
                      <Select
                        value={transferForm.toWarehouseId}
                        onValueChange={(v) => setTransferForm((f) => ({ ...f, toWarehouseId: v }))}
                      >
                        <SelectTrigger className="mt-1">
                          <SelectValue placeholder="Chọn kho nhận" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouses.map((wh) => (
                            <SelectItem key={wh.id} value={wh.id}>
                              {wh.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Số lượng chuyển *</Label>
                      <Input
                        type="number"
                        min={1}
                        value={transferForm.quantity}
                        onChange={(e) => setTransferForm((f) => ({ ...f, quantity: e.target.value }))}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label>Ghi chú điều chuyển</Label>
                      <Input
                        value={transferForm.note}
                        onChange={(e) => setTransferForm((f) => ({ ...f, note: e.target.value }))}
                        placeholder="VD: Chuyển hàng sang showroom..."
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                    onClick={() => void handleTransferSubmit()}
                    disabled={transferSubmitting}
                  >
                    {transferSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Xác nhận Điều chuyển Kho
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-border/70 shadow-sm lg:col-span-7">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Warehouse className="h-5 w-5 text-[#0066CC]" />
                    Danh sách Kho nhận &amp; Điểm Liên kết hiện có
                  </CardTitle>
                  <CardDescription>Số lượng mã hàng và tổng tồn đang lưu trữ tại từng kho</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {warehouses.map((wh) => (
                    <div
                      key={wh.id}
                      className="flex flex-col justify-between rounded-xl border bg-muted/20 p-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="font-mono text-[10px] font-bold text-muted-foreground">
                            {wh.code}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {wh.type === 'PARTNER_SHOP' ? `Shop Liên kết · HH ${wh.commissionPct}%` : 'Kho nội bộ'}
                          </Badge>
                        </div>
                        <p className="mt-1 font-bold text-foreground">{wh.name}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {wh.managerName ? `Phụ trách: ${wh.managerName}` : ''}
                          {wh.address ? ` · ${wh.address}` : ''}
                        </p>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t pt-2">
                        <span className="text-muted-foreground">
                          Đang lưu: <strong className="text-foreground">{wh.skuCount ?? 0} mã</strong>
                        </span>
                        <span className="font-mono text-sm font-bold text-[#0066CC] dark:text-sky-400">
                          {formatNumber(wh.totalStock ?? 0)} ĐV
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {exportSubTab === 'HISTORY' && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowUpFromLine className="h-5 w-5 text-orange-600" />
                      Sổ Lịch sử Phiếu Xuất kho ({exportMovements.length} bút toán)
                    </CardTitle>
                    <CardDescription>
                      Bao gồm phiếu xuất kho nội bộ, xuất nguyên vật liệu cho lệnh sản xuất và xuất bán hàng
                    </CardDescription>
                  </div>
                  <PeriodFilterBar value={period} onChange={setPeriod} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderMovementsTable(exportMovements, 'Chưa có phiếu xuất kho nào trong kỳ')}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* =====================================================================
          PHÂN HỆ 2: CÂN BẰNG KHO & KIỂM KÊ THỰC TẾ (initialModule === 'BALANCE')
         ===================================================================== */}
      {initialModule === 'BALANCE' && (
        <>
          <PageHeader
            title="Cân bằng kho & Kiểm kê thực tế"
            description="Đối chiếu tồn kho sổ sách với số lượng kiểm đếm thực tế tại kệ, tự động tính chênh lệch thừa/thiếu và cân bằng tồn kho"
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap rounded-lg border bg-muted/50 p-1">
                <button
                  type="button"
                  onClick={() => setBalanceSubTab('QUICK_SHEET')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    balanceSubTab === 'QUICK_SHEET'
                      ? 'bg-violet-600 text-white shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  1. Bảng Kiểm kê &amp; Cân bằng nhanh
                  {discrepancyRows.length > 0 && (
                    <span className="rounded-full bg-white px-1.5 py-0.2 text-[10px] font-bold text-violet-700">
                      {discrepancyRows.length} lệch
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceSubTab('TERMINAL')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    balanceSubTab === 'TERMINAL'
                      ? 'bg-[#0066CC] text-white shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  2. Kiểm kê theo mã vạch (Quét kệ)
                </button>
                <button
                  type="button"
                  onClick={() => setBalanceSubTab('HISTORY')}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition',
                    balanceSubTab === 'HISTORY'
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <History className="h-3.5 w-3.5" />
                  3. Lịch sử Cân bằng kho ({adjustMovements.length})
                </button>
              </div>
            </div>
          </PageHeader>

          {balanceSubTab === 'QUICK_SHEET' && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="border-b pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardCheck className="h-5 w-5 text-violet-600" />
                      Bảng Đối Chiếu Tồn Sổ Sách &amp; Kiểm Đếm Thực Tế Toàn Kho
                    </CardTitle>
                    <CardDescription>
                      Nhập số lượng thực đếm tại kệ vào cột &ldquo;Tồn thực tế&rdquo; — hệ thống tự động tính lệch Thừa (+) / Thiếu (-) và cân bằng kho hàng loạt
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {discrepancyRows.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActualStockMap({})}
                        disabled={balanceSubmitting}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Đặt lại ({discrepancyRows.length})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="bg-violet-600 text-white hover:bg-violet-700"
                      disabled={discrepancyRows.length === 0 || balanceSubmitting}
                      onClick={() => void handleBatchBalanceSubmit()}
                    >
                      {balanceSubmitting ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-1.5 h-4 w-4" />
                      )}
                      Hoàn tất Cân bằng kho ({discrepancyRows.length} mã lệch)
                    </Button>
                  </div>
                </div>

                {/* Thanh lọc & Ghi chú đợt kiểm kê */}
                <div className="mt-3 grid grid-cols-1 gap-2.5 lg:grid-cols-12">
                  <div className="relative lg:col-span-4">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={balanceSearch}
                      onChange={(e) => setBalanceSearch(e.target.value)}
                      placeholder="Tìm mã SKU, tên nguyên vật liệu, thành phẩm..."
                      className="h-9 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 lg:col-span-5">
                    {(
                      [
                        { id: 'ALL', label: `Tất cả (${physicalProducts.length})` },
                        { id: 'RAW', label: `Nguyên vật liệu (${stockStats.rawCount})` },
                        { id: 'FINISHED', label: `Thành phẩm (${stockStats.finishedCount})` },
                        { id: 'DIFF_ONLY', label: `Đang có lệch (${discrepancyRows.length})` },
                      ] as const
                    ).map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setBalanceFilterType(chip.id)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                          balanceFilterType === chip.id
                            ? 'border-violet-600 bg-violet-600 text-white'
                            : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                  <div className="lg:col-span-3">
                    <Input
                      value={balanceNote}
                      onChange={(e) => setBalanceNote(e.target.value)}
                      placeholder="Ghi chú biên bản kiểm kê..."
                      className="h-9 text-xs"
                    />
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {loading ? (
                  <div className="p-4">
                    <TableSkeleton rows={6} />
                  </div>
                ) : (
                  <div className="max-h-[540px] overflow-auto">
                    <Table tableId="inventory-quick-reconcile" className="min-w-[780px]">
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead>Mã SKU</TableHead>
                          <TableHead locked>Mặt hàng kiểm kê</TableHead>
                          <TableHead>Phân loại</TableHead>
                          <TableHead className="text-center">ĐVT</TableHead>
                          <TableHead className="text-right">Tồn sổ sách</TableHead>
                          <TableHead className="w-[210px] text-center">Tồn thực tế (Kiểm đếm)</TableHead>
                          <TableHead className="text-right">Chênh lệch</TableHead>
                          <TableHead className="text-right">Thao tác</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredBalanceRows.map(({ product: p, actual, diff }) => {
                          const baseUnit = p.unitConfig?.baseUnit || p.unit || 'cái'
                          const isRaw = isRawMaterialProduct(p)
                          return (
                            <TableRow
                              key={p.id}
                              className={cn(
                                diff > 0 && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                                diff < 0 && 'bg-rose-50/50 dark:bg-rose-950/20'
                              )}
                            >
                              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                                {p.sku}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <ProductAvatar name={p.name} image={p.image} className="h-8 w-8 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="max-w-[260px] truncate text-xs font-semibold">{p.name}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {p.category?.name ?? 'Chưa phân nhóm'}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    isRaw
                                      ? 'border-amber-300 bg-amber-50 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                      : 'border-sky-300 bg-sky-50 text-[10px] text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                  }
                                >
                                  {isRaw ? 'Nguyên vật liệu' : 'Thành phẩm'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center font-mono text-xs font-medium">
                                {baseUnit}
                              </TableCell>
                              <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                                {formatNumber(p.stock)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center justify-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={() =>
                                      setActualStockMap((prev) => ({
                                        ...prev,
                                        [p.id]: String(Math.max(0, actual - 1)),
                                      }))
                                    }
                                  >
                                    <Minus className="h-3 w-3" />
                                  </Button>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={actualStockMap[p.id] !== undefined ? actualStockMap[p.id] : String(p.stock)}
                                    onChange={(e) =>
                                      setActualStockMap((prev) => ({
                                        ...prev,
                                        [p.id]: e.target.value,
                                      }))
                                    }
                                    className={cn(
                                      'h-7 w-24 text-center font-mono text-xs font-bold',
                                      diff !== 0 && 'border-violet-500 ring-1 ring-violet-500/30'
                                    )}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-7 w-7 shrink-0"
                                    onClick={() =>
                                      setActualStockMap((prev) => ({
                                        ...prev,
                                        [p.id]: String(actual + 1),
                                      }))
                                    }
                                  >
                                    <Plus className="h-3 w-3" />
                                  </Button>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                {diff === 0 ? (
                                  <span className="text-muted-foreground">Khớp (0)</span>
                                ) : diff > 0 ? (
                                  <span className="text-emerald-600 dark:text-emerald-400">
                                    +{formatNumber(diff)} {baseUnit} (Thừa)
                                  </span>
                                ) : (
                                  <span className="text-rose-600 dark:text-rose-400">
                                    {formatNumber(diff)} {baseUnit} (Thiếu)
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {diff !== 0 ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                    onClick={() =>
                                      setActualStockMap((prev) => {
                                        const next = { ...prev }
                                        delete next[p.id]
                                        return next
                                      })
                                    }
                                  >
                                    Hoàn tác
                                  </Button>
                                ) : (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => openDialog({ productId: p.id, type: 'ADJUST' })}
                                  >
                                    Phiếu lẻ
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {balanceSubTab === 'TERMINAL' && (
            <div className="mb-8">
              <FastStockTerminal
                key="stock-balance-terminal"
                defaultMode="ADJUST"
                allowedModes={['ADJUST']}
                onCompleted={() => void load()}
              />
            </div>
          )}

          {balanceSubTab === 'HISTORY' && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardCheck className="h-5 w-5 text-violet-600" />
                      Lịch sử Phiếu Cân bằng kho &amp; Kiểm kê ({adjustMovements.length} bút toán)
                    </CardTitle>
                    <CardDescription>
                      Biên bản điều chỉnh chênh lệch tồn kho thực tế qua các đợt kiểm kê
                    </CardDescription>
                  </div>
                  <PeriodFilterBar value={period} onChange={setPeriod} />
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {renderMovementsTable(adjustMovements, 'Chưa có phiếu cân bằng kho nào trong kỳ')}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* =====================================================================
          PHÂN HỆ 3: QUẢN LÝ TỒN KHO & SỔ THẺ KHO (initialModule === 'STOCK')
         ===================================================================== */}
      {initialModule === 'STOCK' && (
        <>
          <PageHeader
            title="Quản lý Tồn kho & Sổ Thẻ kho"
            description="Tra cứu số lượng tồn thực tế theo từng mặt hàng, định lượng quy đổi (Kg ⇄ Gr, Lít ⇄ ml), giá trị vốn tồn kho và cảnh báo tồn tối thiểu"
          >
            <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setStockSubTab('STOCK_TABLE')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  stockSubTab === 'STOCK_TABLE'
                    ? 'bg-[#0066CC] text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Package className="h-3.5 w-3.5" />
                1. Bảng Tồn kho ({stockStats.totalCount})
              </button>
              <button
                type="button"
                onClick={() => setStockSubTab('LOW_STOCK')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  stockSubTab === 'LOW_STOCK'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                2. Sắp hết ({lowStock?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStockSubTab('LEDGER')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  stockSubTab === 'LEDGER'
                    ? 'bg-primary text-primary-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <History className="h-3.5 w-3.5" />
                3. Sổ Nhật ký XNT ({movements?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setStockSubTab('MULTI_WH')}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition',
                  stockSubTab === 'MULTI_WH'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Warehouse className="h-3.5 w-3.5" />
                4. Đa kho ({warehouses.length})
              </button>
            </div>
          </PageHeader>

          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Danh mục Hàng lưu kho"
              value={loading ? '' : `${formatNumber(stockStats.totalCount)} mã`}
              icon={Package}
              loading={loading}
              hint={`${stockStats.rawCount} NVL · ${stockStats.finishedCount} Thành phẩm · ${stockStats.comboCount} Combo`}
            />
            <StatCard
              title="Tổng giá trị vốn Tồn kho"
              value={loading ? '' : formatVND(stockStats.totalCostValue)}
              icon={Wallet}
              loading={loading}
              iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
              hint="Đã chuẩn hóa theo tỷ lệ ĐVT gốc"
            />
            <StatCard
              title="Mặt hàng sắp hết / hết hàng"
              value={loading ? '' : formatNumber(lowStock?.length ?? 0)}
              icon={AlertTriangle}
              loading={loading}
              iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
              hint="Chạm hoặc dưới định mức tối thiểu"
            />
            <StatCard
              title="Mạng lưới Kho & Liên kết"
              value={loading ? '' : formatNumber(warehouses.length)}
              icon={Warehouse}
              loading={loading}
              hint={`${warehouses.filter((w) => w.type === 'INTERNAL').length} kho nội bộ · ${
                warehouses.filter((w) => w.type === 'PARTNER_SHOP').length
              } shop bán chéo`}
            />
          </div>

          {/* SUB-TAB 1: BẢNG TỒN KHO CHI TIẾT THEO MẶT HÀNG */}
          {stockSubTab === 'STOCK_TABLE' && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="border-b pb-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Warehouse className="h-5 w-5 text-[#0066CC]" />
                      Bảng Tồn Kho Hiện Tại Theo Mặt Hàng ({filteredStockProducts.length} mã)
                    </CardTitle>
                    <CardDescription>
                      Hiển thị số lượng tồn theo đơn vị gốc, tự động quy đổi ra đơn vị mua lớn (Kg, Lít) và tính giá trị vốn tồn kho
                    </CardDescription>
                  </div>
                  <div className="hidden items-center gap-2 xl:flex">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigate?.('purchase')}
                    >
                      <PackagePlus className="h-4 w-4 text-emerald-600" />
                      Đi tới Nhập kho
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onNavigate?.('stock-balance')}
                    >
                      <ClipboardCheck className="h-4 w-4 text-violet-600" />
                      Đi tới Cân bằng kho
                    </Button>
                  </div>
                </div>

                <div className="mt-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={stockSearch}
                      onChange={(e) => setStockSearch(e.target.value)}
                      placeholder="Tìm theo SKU, tên mặt hàng, danh mục..."
                      className="h-9 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:pb-0">
                    {(
                      [
                        { id: 'ALL', label: `Tất cả (${stockStats.totalCount})` },
                        { id: 'RAW', label: `NVL (${stockStats.rawCount})` },
                        { id: 'FINISHED', label: `Thành phẩm (${stockStats.finishedCount})` },
                        { id: 'COMBO', label: `Combo (${stockStats.comboCount})` },
                        { id: 'LOW', label: `Sắp hết (${lowStock?.length ?? 0})` },
                      ] as const
                    ).map((chip) => (
                      <button
                        key={chip.id}
                        type="button"
                        onClick={() => setStockFilterType(chip.id)}
                        className={cn(
                          'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors',
                          stockFilterType === chip.id
                            ? 'border-[#0066CC] bg-[#0066CC] text-white'
                            : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                        )}
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                {loading ? (
                  <div className="p-4">
                    <TableSkeleton rows={6} />
                  </div>
                ) : (
                  <div className="max-h-[540px] overflow-auto">
                    <Table tableId="inventory-stock-balance" className="min-w-[820px]">
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead>Mã SKU</TableHead>
                          <TableHead locked>Mặt hàng &amp; Phân bổ Đa Kho</TableHead>
                          <TableHead>Phân loại</TableHead>
                          <TableHead className="text-right">
                            {selectedWarehouseObj ? `Tồn tại ${selectedWarehouseObj.name}` : 'Tồn kho hiện tại'}
                          </TableHead>
                          <TableHead className="text-right">Ngưỡng tối thiểu</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead className="text-right">Đơn giá vốn</TableHead>
                          <TableHead className="text-right">Giá trị tồn kho</TableHead>
                          <TableHead className="text-right">Thao tác nhanh</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredStockProducts.map((p) => {
                          const baseUnit = p.unitConfig?.baseUnit || p.unit || 'cái'
                          const purchaseUnit = p.unitConfig?.purchaseUnit
                          const purchaseRate = p.unitConfig?.purchaseRate ?? 1
                          const isCombo = p.type === 'COMBO'
                          const isRaw = isRawMaterialProduct(p)
                          const displayStock = getProductStockInSelectedWh(p)
                          const unitCost = getNormalizedUnitCost(p)
                          const totalVal = isCombo ? 0 : Math.max(0, displayStock) * unitCost
                          const isOut = displayStock <= 0
                          const isLow = !isOut && !isCombo && displayStock <= p.lowStockThreshold
                          const perWhMap = whStockByProduct[p.id] || {}
                          const activeWhList = warehouses.filter(
                            (wh) => (perWhMap[wh.id] ?? 0) > 0 || selectedWarehouseId === wh.id
                          )
                          const shownWhList = activeWhList.slice(0, 2)
                          const extraWhCount = Math.max(0, activeWhList.length - shownWhList.length)

                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                                {p.sku}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2.5">
                                  <ProductAvatar name={p.name} image={p.image} className="h-8 w-8 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="max-w-[260px] truncate text-xs font-semibold">{p.name}</p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {p.category?.name ?? 'Chưa phân nhóm'}
                                    </p>
                                    {!isCombo && shownWhList.length > 0 && (
                                      <div className="mt-1 flex flex-wrap items-center gap-1">
                                        {shownWhList.map((wh) => {
                                          const q = perWhMap[wh.id] ?? 0
                                          const isSel = selectedWarehouseId === wh.id
                                          return (
                                            <button
                                              key={wh.id}
                                              type="button"
                                              onClick={() => setSelectedWarehouseId(isSel ? 'ALL' : wh.id)}
                                              title={`Bấm để lọc kho ${wh.name}`}
                                              className={cn(
                                                'inline-flex items-center gap-1 rounded border px-1.5 py-0.2 text-[10px] font-medium transition',
                                                isSel
                                                  ? 'border-[#0066CC] bg-[#0066CC] text-white'
                                                  : 'border-border/80 bg-muted/50 text-muted-foreground hover:border-sky-400 hover:text-foreground'
                                              )}
                                            >
                                              <span className="max-w-[110px] truncate">{wh.name.replace('Shop Liên kết: ', 'Shop ')}:</span>
                                              <strong className={cn('font-mono', isSel ? 'text-white' : 'text-foreground')}>
                                                {formatNumber(q)}
                                              </strong>
                                            </button>
                                          )
                                        })}
                                        {extraWhCount > 0 && (
                                          <span
                                            className="inline-flex items-center rounded border border-border/70 bg-muted/30 px-1.5 py-0.2 text-[10px] font-medium text-muted-foreground"
                                            title={`Còn ${extraWhCount} kho khác đang có tồn`}
                                          >
                                            +{extraWhCount} kho
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={
                                    isCombo
                                      ? 'border-violet-300 bg-violet-50 text-[10px] text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300'
                                      : isRaw
                                        ? 'border-amber-300 bg-amber-50 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                        : 'border-sky-300 bg-sky-50 text-[10px] text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                  }
                                >
                                  {isCombo ? 'Gói Combo' : isRaw ? 'Nguyên vật liệu' : 'Thành phẩm'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="font-mono text-sm font-bold tabular-nums">
                                  {formatNumber(displayStock)} <span className="text-xs font-normal text-muted-foreground">{baseUnit}</span>
                                </div>
                                {selectedWarehouseObj && !isCombo && (
                                  <div className="text-[10px] text-muted-foreground">
                                    Toàn hệ thống: {formatNumber(p.stock)} {baseUnit}
                                  </div>
                                )}
                                {purchaseRate > 1 && purchaseUnit && (
                                  <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                                    ≈ {(displayStock / purchaseRate).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} {purchaseUnit}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                                {isCombo ? 'Theo BOM' : `${formatNumber(p.lowStockThreshold)} ${baseUnit}`}
                              </TableCell>
                              <TableCell>
                                {isOut ? (
                                  <Badge className="border-transparent bg-rose-100 text-[10px] text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                                    Hết hàng
                                  </Badge>
                                ) : isLow ? (
                                  <Badge className="border-transparent bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    Sắp hết
                                  </Badge>
                                ) : (
                                  <Badge className="border-transparent bg-emerald-100 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                    Đủ tồn
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">
                                {formatVND(unitCost)} <span className="text-[10px] text-muted-foreground">/{baseUnit}</span>
                              </TableCell>
                              <TableCell className="text-right font-mono text-xs font-bold tabular-nums">
                                {isCombo ? '—' : formatVND(totalVal)}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="inline-flex items-center gap-1">
                                  {isCombo ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-7 px-2 text-xs"
                                      onClick={() => openProductLineage(p)}
                                    >
                                      Thẻ kho
                                    </Button>
                                  ) : (
                                    <>
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => openDialog({ productId: p.id, type: 'IMPORT' })}
                                      >
                                        + Nhập
                                      </Button>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-7 p-0"
                                            aria-label={`Thêm thao tác cho ${p.name}`}
                                          >
                                            <MoreHorizontal className="h-4 w-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                          <DropdownMenuItem
                                            onClick={() => openProductLineage(p)}
                                            className="cursor-pointer gap-2 text-xs"
                                          >
                                            <History className="h-3.5 w-3.5 text-muted-foreground" />
                                            <span>Xem Sổ Thẻ kho</span>
                                          </DropdownMenuItem>
                                          <DropdownMenuItem
                                            onClick={() => openQuickTransferForProduct(p.id)}
                                            className="cursor-pointer gap-2 text-xs"
                                          >
                                            <ArrowLeftRight className="h-3.5 w-3.5 text-[#0066CC]" />
                                            <span>Điều chuyển kho</span>
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem
                                            onClick={() => openDialog({ productId: p.id, type: 'ADJUST' })}
                                            className="cursor-pointer gap-2 text-xs"
                                          >
                                            <ClipboardCheck className="h-3.5 w-3.5 text-violet-600" />
                                            <span>Cân bằng tồn thực tế</span>
                                          </DropdownMenuItem>
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </>
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
              </CardContent>
            </Card>
          )}

          {/* SUB-TAB 2: CẢNH BÁO TỒN KHO THẤP */}
          {stockSubTab === 'LOW_STOCK' && (
            <Card className="border-amber-200/70 shadow-sm dark:border-amber-900/50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Danh sách Mặt hàng chạm hoặc dưới ngưỡng tồn tối thiểu
                </CardTitle>
                <CardDescription>
                  Cần lập phiếu nhập kho nguyên vật liệu hoặc lập lệnh sản xuất bổ sung
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <TableSkeleton rows={3} />
                ) : error ? (
                  <ErrorState message={error} onRetry={() => void load()} />
                ) : !lowStock || lowStock.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="Tồn kho ổn định"
                    description="Tất cả mặt hàng đều đang trên ngưỡng tồn tối thiểu."
                  />
                ) : (
                  <div className="divide-y">
                    {lowStock.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <ProductAvatar name={p.name} image={p.image} className="h-9 w-9" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{p.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">{p.sku}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge className="border-transparent bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                            Còn {formatNumber(p.stock)}
                          </Badge>
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            / tối thiểu {formatNumber(p.lowStockThreshold)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openDialog({ productId: p.id, type: 'IMPORT' })}
                          >
                            <PackagePlus className="h-4 w-4" />
                            Nhập thêm
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* SUB-TAB 3: SỔ NHẬT KÝ XUẤT - NHẬP - TỒN */}
          {stockSubTab === 'LEDGER' && (
            <Card className="border-border/70 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="shrink-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <History className="h-5 w-5 text-primary" />
                      Sổ Nhật ký Xuất - Nhập - Tồn
                    </CardTitle>
                    <CardDescription>
                      Đối chiếu Tồn đầu kỳ + Nhập trong kỳ − Xuất/Cân bằng = Tồn cuối kỳ
                    </CardDescription>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-xs">
                      {(
                        [
                          { id: 'ALL', label: 'Tất cả' },
                          { id: 'IMPORT', label: 'Nhập kho' },
                          { id: 'EXPORT', label: 'Xuất kho' },
                          { id: 'ADJUST', label: 'Cân bằng kho' },
                        ] as const
                      ).map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setLedgerTypeFilter(t.id)}
                          className={cn(
                            'rounded-md px-2.5 py-1 font-semibold transition',
                            ledgerTypeFilter === t.id
                              ? 'bg-background text-foreground shadow-2xs'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <PeriodFilterBar value={period} onChange={setPeriod} />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {periodSummary && (
                  <div className="px-4 pt-4">
                    <PeriodSummaryBar
                      segments={[
                        {
                          label: 'Tồn đầu kỳ',
                          sub: 'Toàn bộ mặt hàng',
                          value: formatNumber(periodSummary.opening),
                          tone: 'default',
                        },
                        {
                          label: 'Nhập trong kỳ',
                          value: `+${formatNumber(periodSummary.importQty)}`,
                          tone: 'green',
                          operator: '+',
                        },
                        {
                          label: 'Xuất/Cân bằng trong kỳ',
                          value: formatNumber(periodSummary.exportQty + Math.max(0, -periodSummary.adjustQty)),
                          sub:
                            periodSummary.adjustQty !== 0
                              ? `gồm cân bằng kiểm kê ${formatNumber(Math.abs(periodSummary.adjustQty))}`
                              : undefined,
                          tone: 'red',
                          operator: '−',
                        },
                        {
                          label: 'Tồn cuối kỳ',
                          sub: `${formatNumber(periodSummary.movementCount)} biến động`,
                          value: formatNumber(periodSummary.closing),
                          tone: 'emerald',
                          operator: '=',
                        },
                      ]}
                    />
                  </div>
                )}
                {renderMovementsTable(filteredLedgerMovements, 'Chưa có biến động kho nào')}
              </CardContent>
            </Card>
          )}

          {/* SUB-TAB 4: ĐA KHO & LIÊN KẾT BÁN CHÉO */}
          {stockSubTab === 'MULTI_WH' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <Card className="border-border/70 shadow-sm lg:col-span-6">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Warehouse className="h-5 w-5 text-[#0066CC]" />
                          Mạng lưới Kho hàng &amp; Điểm Liên kết Bán chéo
                        </CardTitle>
                        <CardDescription>
                          Bấm trực tiếp vào từng Kho để lọc xem tồn kho, sửa thông tin hoặc điều chuyển hàng hóa 1-Click
                        </CardDescription>
                      </div>
                      <Button
                        size="sm"
                        className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                        onClick={() => {
                          setEditingWhId(null)
                          setAddWhOpen(true)
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Thêm Kho mới
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {warehouses.map((wh) => (
                      <div
                        key={wh.id}
                        className={cn(
                          'flex flex-col justify-between rounded-xl border p-3 text-xs transition-all',
                          selectedWarehouseId === wh.id
                            ? 'border-[#0066CC] bg-sky-50/60 ring-1 ring-[#0066CC]/30 dark:bg-sky-950/30'
                            : 'bg-muted/20 hover:border-sky-300'
                        )}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="font-mono text-[10px] font-bold text-muted-foreground">
                              {wh.code}
                            </span>
                            <div className="flex items-center gap-1">
                              {wh.isDefault && (
                                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-[9px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                  Mặc định
                                </Badge>
                              )}
                              <Badge
                                variant="outline"
                                className={
                                  wh.type === 'PARTNER_SHOP'
                                    ? 'border-amber-300 bg-amber-50 text-[10px] font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                    : 'border-sky-300 bg-sky-50 text-[10px] font-semibold text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300'
                                }
                              >
                                {wh.type === 'PARTNER_SHOP'
                                  ? `Shop Liên kết · HH ${wh.commissionPct}%`
                                  : 'Kho nội bộ'}
                              </Badge>
                            </div>
                          </div>
                          <p className="mt-1 font-bold text-foreground">{wh.name}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {wh.managerName ? `Phụ trách: ${wh.managerName}` : ''}
                            {wh.address ? ` · ${wh.address}` : ''}
                          </p>
                        </div>
                        <div className="mt-3 flex items-center justify-between border-t pt-2">
                          <span className="text-muted-foreground">
                            Đang lưu kho: <strong className="text-foreground">{wh.skuCount ?? 0} mã</strong>
                          </span>
                          <span className="font-mono text-sm font-bold text-[#0066CC] dark:text-sky-400">
                            {formatNumber(wh.totalStock ?? 0)} ĐV
                          </span>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t pt-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 flex-1 px-2 text-[11px] font-semibold text-[#0066CC]"
                            onClick={() => {
                              setSelectedWarehouseId(wh.id)
                              setStockSubTab('STOCK_TABLE')
                            }}
                          >
                            <Package className="mr-1 h-3 w-3" />
                            Xem hàng tại kho
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              const firstProd = products?.find((p) => p.type !== 'COMBO')?.id ?? ''
                              openQuickTransferForProduct(firstProd, wh.id)
                            }}
                          >
                            <ArrowLeftRight className="mr-1 h-3 w-3" />
                            Chuyển đi
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => openEditWarehouse(wh)}
                          >
                            <Pencil className="mr-1 h-3 w-3" />
                            Sửa
                          </Button>
                          {!wh.isDefault && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-amber-600"
                              title="Đặt làm kho mặc định"
                              onClick={() => void handleSetDefaultWarehouse(wh)}
                            >
                              <Star className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <Card className="border-border/70 shadow-sm lg:col-span-6">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ArrowLeftRight className="h-5 w-5 text-emerald-600" />
                      Đối soát Hoa hồng &amp; Công nợ Bán chéo Liên Shop
                    </CardTitle>
                    <CardDescription>
                      Tự động bóc tách doanh thu bán hộ (kể cả sản phẩm lẻ &amp; thành phần trong bộ Combo)
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2.5">
                    {settlements.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Chưa có Shop đối tác liên kết nào.</p>
                    ) : (
                      settlements.map((st) => (
                        <div key={st.warehouseId} className="rounded-xl border bg-muted/20 p-3 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-bold text-foreground">{st.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Mã đối tác: <span className="font-mono">{st.code}</span> · Đã bán chéo:{' '}
                                <strong>{formatNumber(st.unitsSold)} SP</strong> · Hoa hồng thỏa thuận:{' '}
                                <strong>{st.commissionPct}%</strong>
                              </p>
                            </div>
                            <div className="flex items-center gap-2.5 text-right">
                              <div>
                                <p className="text-[11px] text-muted-foreground">Cần chuyển trả Shop bạn:</p>
                                <p className="font-mono text-sm font-extrabold text-amber-700 dark:text-amber-400">
                                  {formatVND(st.netPayableToPartner)}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant={settledCodes[st.warehouseId] ? 'outline' : 'secondary'}
                                className="h-8 text-[11px]"
                                disabled={settlingWhId === st.warehouseId || st.netPayableToPartner <= 0}
                                onClick={() => void handleSettleCrossSell(st.warehouseId, st.name)}
                              >
                                {settlingWhId === st.warehouseId ? (
                                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                                )}
                                {settledCodes[st.warehouseId] ? `Đã chốt (${settledCodes[st.warehouseId]})` : 'Quyết toán'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* BẢNG MA TRẬN PHÂN BỔ TỒN KHO ĐA CHI NHÁNH (MULTI-WAREHOUSE STOCK MATRIX) */}
              <Card className="border-border/70 shadow-sm">
                <CardHeader className="border-b pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Warehouse className="h-5 w-5 text-[#0066CC]" />
                        Ma Trận Tồn Kho Đa Chi Nhánh ({physicalProducts.length} mặt hàng × {warehouses.length} kho)
                      </CardTitle>
                      <CardDescription>
                        Theo dõi trực quan số lượng từng mặt hàng đang nằm ở kho nào và bấm điều chuyển / nhập bổ sung ngay trên cùng 1 bảng
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const firstProd = physicalProducts[0]?.id ?? ''
                        openQuickTransferForProduct(firstProd)
                      }}
                    >
                      <ArrowLeftRight className="mr-1.5 h-4 w-4 text-[#0066CC]" />
                      Lập phiếu Điều chuyển Kho
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[520px] overflow-auto">
                    <Table tableId="multi-warehouse-matrix" className="min-w-[820px]">
                      <TableHeader className="sticky top-0 z-10 bg-background">
                        <TableRow>
                          <TableHead>Mã SKU</TableHead>
                          <TableHead locked>Mặt hàng</TableHead>
                          {warehouses.map((wh) => (
                            <TableHead key={wh.id} className="text-right">
                              <div className="font-bold text-foreground">{wh.name.replace('Shop Liên kết: ', 'Shop ')}</div>
                              <div className="font-mono text-[10px] font-normal text-muted-foreground">{wh.code}</div>
                            </TableHead>
                          ))}
                          <TableHead className="text-right font-bold">Tổng tồn</TableHead>
                          <TableHead className="text-right">Điều phối nhanh</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {physicalProducts.map((p) => {
                          const baseUnit = p.unitConfig?.baseUnit || p.unit || 'cái'
                          const perWh = whStockByProduct[p.id] || {}
                          return (
                            <TableRow key={p.id}>
                              <TableCell className="font-mono text-xs font-semibold text-muted-foreground">
                                {p.sku}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <ProductAvatar name={p.name} image={p.image} className="h-7 w-7 shrink-0" />
                                  <div className="min-w-0">
                                    <p className="max-w-[220px] truncate text-xs font-semibold">{p.name}</p>
                                    <p className="text-[10px] text-muted-foreground">{baseUnit}</p>
                                  </div>
                                </div>
                              </TableCell>
                              {warehouses.map((wh) => {
                                const q = perWh[wh.id] ?? 0
                                return (
                                  <TableCell key={wh.id} className="text-right font-mono text-xs tabular-nums">
                                    {q > 0 ? (
                                      <span className="inline-flex items-center rounded-md bg-sky-50 px-2 py-0.5 font-bold text-[#0066CC] dark:bg-sky-950/60 dark:text-sky-300">
                                        {formatNumber(q)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground/50">0</span>
                                    )}
                                  </TableCell>
                                )
                              })}
                              <TableCell className="text-right font-mono text-sm font-extrabold tabular-nums">
                                {formatNumber(p.stock)} <span className="text-[10px] font-normal text-muted-foreground">{baseUnit}</span>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="inline-flex items-center gap-1">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-[#0066CC]"
                                    onClick={() => openQuickTransferForProduct(p.id)}
                                  >
                                    <ArrowLeftRight className="mr-1 h-3 w-3" />
                                    Chuyển kho
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs"
                                    onClick={() => openDialog({ productId: p.id, type: 'IMPORT' })}
                                  >
                                    + Nhập
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Dialog thao tác kho (Nhập / Xuất / Điều chỉnh + Quy đổi Định lượng tự động) */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Thao tác kho &amp; Quy đổi Định lượng</DialogTitle>
            <DialogDescription>
              Nhập kho, xuất kho hoặc kiểm kê. Hỗ trợ tự động quy đổi định lượng (VD: nhập 10 kg → +10.000 gr).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="movement-product">
                Sản phẩm <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.productId || undefined}
                onValueChange={(value) => {
                  const prod = products?.find((p) => p.id === value)
                  const uc = prod?.unitConfig
                  const defaultRate =
                    form.type === 'IMPORT' && uc?.purchaseRate && uc.purchaseRate > 1 ? String(uc.purchaseRate) : '1'
                  const defaultUnit =
                    form.type === 'IMPORT' && uc?.purchaseUnit ? uc.purchaseUnit : uc?.baseUnit || prod?.unit || 'cái'
                  setForm({
                    ...form,
                    productId: value,
                    quantity: '',
                    conversionRate: defaultRate,
                    inputUnit: defaultUnit,
                  })
                }}
              >
                <SelectTrigger id="movement-product" className="w-full">
                  <SelectValue placeholder="Chọn sản phẩm" />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.sku}) — Tồn: {formatNumber(p.stock)} {p.unitConfig?.baseUnit || p.unit || 'cái'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="movement-warehouse">
                  Kho thực hiện <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.warehouseId || warehouses[0]?.id || undefined}
                  onValueChange={(value) => setForm({ ...form, warehouseId: value })}
                >
                  <SelectTrigger id="movement-warehouse" className="w-full">
                    <SelectValue placeholder="Chọn kho..." />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name} ({wh.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="movement-type">
                  Loại thao tác <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={form.type}
                  onValueChange={(value) => {
                    const nextType = value as MovementType
                    const uc = selectedProduct?.unitConfig
                    const defaultRate =
                      nextType === 'IMPORT' && uc?.purchaseRate && uc.purchaseRate > 1 ? String(uc.purchaseRate) : '1'
                    const defaultUnit =
                      nextType === 'IMPORT' && uc?.purchaseUnit
                        ? uc.purchaseUnit
                        : uc?.baseUnit || selectedProduct?.unit || 'cái'
                    setForm({ ...form, type: nextType, conversionRate: defaultRate, inputUnit: defaultUnit })
                  }}
                >
                  <SelectTrigger id="movement-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPE_OPTIONS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {MOVEMENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.type !== 'ADJUST' && (
              <div className="space-y-2 rounded-lg border border-emerald-300/70 bg-emerald-50/40 p-3 dark:border-emerald-900 dark:bg-emerald-950/20">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <Label className="text-xs font-semibold text-emerald-900 dark:text-emerald-300">
                    Đơn vị &amp; Hệ số quy đổi sang tồn gốc ({baseUnitLabel})
                  </Label>
                  <div className="flex flex-wrap gap-1">
                    {[
                      { label: `ĐV Gốc (×1 ${baseUnitLabel})`, unit: baseUnitLabel, rate: '1' },
                      { label: '1 Kg = 1.000 Gr', unit: 'kg', rate: '1000' },
                      { label: '1 Lít = 1.000 Ml', unit: 'lít', rate: '1000' },
                      { label: '1 Thùng = 24', unit: 'thùng', rate: '24' },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, inputUnit: preset.unit, conversionRate: preset.rate }))}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                          form.conversionRate === preset.rate && form.inputUnit === preset.unit
                            ? 'border-emerald-600 bg-emerald-600 text-white'
                            : 'border-emerald-300 bg-background text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-300'
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Đơn vị thao tác</Label>
                    <Input
                      value={form.inputUnit}
                      onChange={(e) => setForm({ ...form, inputUnit: e.target.value })}
                      placeholder="VD: kg, thùng..."
                      className="mt-0.5 h-8 bg-background text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] text-muted-foreground">
                      Hệ số (1 {form.inputUnit || 'ĐV'} = ? {baseUnitLabel})
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      value={form.conversionRate}
                      onChange={(e) => setForm({ ...form, conversionRate: e.target.value })}
                      placeholder="VD: 1000"
                      className="mt-0.5 h-8 bg-background font-mono text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="movement-quantity">
                {form.type === 'ADJUST'
                  ? `Số tồn mới theo ${baseUnitLabel} (kiểm kê)`
                  : `Số lượng (${form.inputUnit || baseUnitLabel})`}
                <span className="text-destructive"> *</span>
              </Label>
              <Input
                id="movement-quantity"
                ref={qtyInputRef}
                type="number"
                min={0}
                step="any"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
                placeholder={form.type === 'ADJUST' ? 'Nhập số tồn mới' : 'VD: 10'}
              />
              {preview && (
                <div className="space-y-1 rounded-lg border bg-muted/30 p-2.5 text-xs">
                  {effectiveConvRate > 1 && form.type !== 'ADJUST' && (
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                      Quy đổi tự động: {qtyNum} {form.inputUnit} × {formatNumber(effectiveConvRate)} ={' '}
                      {form.type === 'IMPORT' ? '+' : '-'}
                      {formatNumber(convertedQty)} {baseUnitLabel}
                    </p>
                  )}
                  <p
                    className={cn(
                      preview.next < 0 ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'
                    )}
                  >
                    Tồn hiện tại: {formatNumber(preview.current)} {baseUnitLabel} → sau thao tác:{' '}
                    <span
                      className={cn(
                        preview.next < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'font-semibold text-emerald-600 dark:text-emerald-400'
                      )}
                    >
                      {formatNumber(preview.next)} {baseUnitLabel}
                    </span>
                    {form.type === 'ADJUST' && (
                      <span>
                        {' '}
                        (biến động: {preview.delta > 0 ? '+' : ''}
                        {formatNumber(preview.delta)} {baseUnitLabel})
                      </span>
                    )}
                    {preview.next < 0 && ' — vượt quá tồn hiện tại, không thể xuất'}
                  </p>
                </div>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="movement-note">Ghi chú</Label>
              <Textarea
                id="movement-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Ví dụ: Nhập 10kg sáp nến tự quy đổi 10.000gr..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitDisabled || submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Điều chuyển kho (Kho A ➔ Kho B) */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Phiếu Điều Chuyển Kho &amp; Hàng Ký Gửi (Kho A ➔ Kho B)</DialogTitle>
            <DialogDescription>
              Chuyển hàng giữa các kho chi nhánh hoặc nhận/xuất hàng ký gửi bán chéo với Shop liên kết.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div>
              <Label>Sản phẩm điều chuyển *</Label>
              <Select
                value={transferForm.productId}
                onValueChange={(v) => setTransferForm((f) => ({ ...f, productId: v }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Chọn sản phẩm..." />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? [])
                    .filter((p) => p.type !== 'COMBO')
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.sku} — {p.name} (Tổng tồn: {p.stock})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Từ Kho xuất (Nguồn) *</Label>
                <Select
                  value={transferForm.fromWarehouseId}
                  onValueChange={(v) => setTransferForm((f) => ({ ...f, fromWarehouseId: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Chọn kho xuất" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Đến Kho nhận (Đích) *</Label>
                <Select
                  value={transferForm.toWarehouseId}
                  onValueChange={(v) => setTransferForm((f) => ({ ...f, toWarehouseId: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Chọn kho nhận" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="transfer-qty">Số lượng chuyển *</Label>
                <Input
                  id="transfer-qty"
                  type="number"
                  min={1}
                  value={transferForm.quantity}
                  onChange={(e) => setTransferForm((f) => ({ ...f, quantity: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="transfer-note">Ghi chú phiếu chuyển</Label>
                <Input
                  id="transfer-note"
                  value={transferForm.note}
                  onChange={(e) => setTransferForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="VD: Gửi hàng trưng bày bán chéo"
                  className="mt-1"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferSubmitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleTransferSubmit()} disabled={transferSubmitting}>
              {transferSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Xác nhận Điều chuyển
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Thêm / Sửa Kho chi nhánh hoặc Shop Liên kết Bán chéo */}
      <Dialog open={addWhOpen} onOpenChange={(o) => { setAddWhOpen(o); if (!o) setEditingWhId(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingWhId ? 'Cập nhật Thông tin Kho / Shop Liên kết' : 'Thêm Kho hàng / Shop Liên kết Bán chéo'}
            </DialogTitle>
            <DialogDescription>
              Mở rộng thêm kho chi nhánh nội bộ hoặc kết nối thêm Shop đối tác để bán chéo sản phẩm và chia sẻ hoa hồng.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Loại hình *</Label>
                <Select
                  value={addWhForm.type}
                  onValueChange={(v) => setAddWhForm((f) => ({ ...f, type: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PARTNER_SHOP">Shop Liên kết Bán chéo</SelectItem>
                    <SelectItem value="INTERNAL">Kho Chi nhánh Nội bộ</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="wh-code">Mã Kho / Shop</Label>
                <Input
                  id="wh-code"
                  value={addWhForm.code}
                  onChange={(e) => setAddWhForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="VD: SHOP-SEN-VIET"
                  className="mt-1 font-mono uppercase"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="wh-name">Tên Kho / Shop Liên kết *</Label>
              <Input
                id="wh-name"
                value={addWhForm.name}
                onChange={(e) => setAddWhForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="VD: Shop Liên kết: Hương Sen Việt"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="wh-mgr">Người phụ trách / Chủ shop</Label>
                <Input
                  id="wh-mgr"
                  value={addWhForm.managerName}
                  onChange={(e) => setAddWhForm((f) => ({ ...f, managerName: e.target.value }))}
                  placeholder="VD: Anh Minh Quân"
                  className="mt-1"
                />
              </div>
              {addWhForm.type === 'PARTNER_SHOP' && (
                <div>
                  <Label htmlFor="wh-comm">% Hoa hồng Bán chéo</Label>
                  <Input
                    id="wh-comm"
                    type="number"
                    min={0}
                    max={80}
                    value={addWhForm.commissionPct}
                    onChange={(e) => setAddWhForm((f) => ({ ...f, commissionPct: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="wh-addr">Địa chỉ Kho / Showroom</Label>
              <Input
                id="wh-addr"
                value={addWhForm.address}
                onChange={(e) => setAddWhForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Số nhà, đường, quận/huyện..."
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWhOpen(false)} disabled={addWhSubmitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleAddWarehouse()} disabled={addWhSubmitting}>
              {addWhSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu Kho / Shop Liên kết
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Truy xuất nguồn gốc & Lịch sử thay đổi (chuỗi tồn kho before → after) */}
      <LineageInspectorDialog
        open={lineageTarget !== null}
        onOpenChange={(o) => {
          if (!o) setLineageTarget(null)
        }}
        target={lineageTarget}
      />
    </div>
  )
}
