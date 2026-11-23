'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchBaocaoExportBlob,
  fetchBaocaoSnapshotClient,
  postBaocaoActionClient,
} from '@/lib/baocao-client'
import { formatNumber, formatVND } from '@/lib/format'
import { trackClientBehavior } from '@/lib/behavior-client'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import type {
  Baocao1DataScope,
  Baocao1FullSnapshot,
  SalesOrderRow,
  SkuCatalogItem,
} from '@/lib/baocao1-bomoc'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertTriangle,
  ArrowRight,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  Loader2,
  PackagePlus,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Scale,
  Search,
  ShoppingCart,
  Sparkles,
  Trash2,
} from 'lucide-react'

type SheetTabId =
  | '00'
  | '12'
  | '09'
  | '10'
  | '07'
  | '06'
  | '05'
  | '11'
  | '08'
  | '04'
  | '01'
  | '02'
  | '03'

const SHEET_TABS: Array<{ id: SheetTabId; code: string; label: string }> = [
  { id: '00', code: '00_Tong_Quan', label: '00. Tổng quan' },
  { id: '12', code: '12_Bao_Cao_Thang', label: '12. Báo cáo tháng' },
  { id: '09', code: '09_Ton_Kho_Vat_Tu', label: '09. Tồn vật tư' },
  { id: '10', code: '10_Ton_Kho_Thanh_Pham', label: '10. Tồn thành phẩm' },
  { id: '07', code: '07_Don_Ban', label: '07. Đơn bán' },
  { id: '06', code: '06_San_Xuat', label: '06. Sản xuất (Mẻ đúc)' },
  { id: '05', code: '05_Nhap_Hang', label: '05. Nhập vật tư' },
  { id: '11', code: '11_Thu_Chi_Khac', label: '11. Thu / Chi OPEX' },
  { id: '08', code: '08_Dieu_Chinh_Kho', label: '08. Điều chỉnh kho' },
  { id: '04', code: '04_Ton_Dau_Ky', label: '04. Tồn đầu kỳ' },
  { id: '01', code: '01_Vat_Tu', label: '01. DM Vật tư' },
  { id: '02', code: '02_SKU', label: '02. DM SKU & Giá' },
  { id: '03', code: '03_Dinh_Muc', label: '03. Định mức BOM' },
]

const OPEX_GROUPS = [
  'OPEX — Quỹ tái đầu tư khuôn',
  'OPEX — Điện, nước, Internet xưởng',
  'OPEX — Quảng cáo & Tiếp thị sàn',
  'OPEX — Phần mềm, tên miền, vận hành',
  'Mua dụng cụ / Khuôn mẫu mới',
  'Rút tiền / Phân phối chủ shop',
  'Thu khác',
]

const SALES_CHANNELS: Array<SalesOrderRow['channel']> = [
  'Shopee',
  'Lẻ Zalo / Website',
  'Sỉ',
]

const SALES_STATUSES: Array<SalesOrderRow['status']> = [
  'Đã giao',
  'Đang giao',
  'Hoàn nhập kho',
  'Hoàn hỏng',
  'Đã hủy',
]

const OPENING_STATUS_OPTIONS = [
  'Đã kiểm kê',
  'Ước tính — cần cân/đếm lại',
  'Chưa có hàng',
]

const ADJUSTMENT_REASONS = [
  'Hư hỏng / Bể vỡ khi thao tác',
  'Làm mẫu thử R&D / Chụp ảnh',
  'Quà tặng KOC / Tặng kèm khách',
  'Đóng đơn sỉ khác định mức bao bì',
  'Chênh lệch kiểm kê thực tế',
]

const WORKFLOW_GUIDE: Array<{
  when: string
  sheetLabel: string
  targetSheet: SheetTabId
  todo: string
}> = [
  {
    when: 'Lần đầu',
    sheetLabel: '04_Ton_Dau_Ky',
    targetSheet: '04',
    todo: "Cân/đếm vật tư & thành phẩm đang có, sửa số ô vàng, đổi tình trạng 'Đã kiểm kê'.",
  },
  {
    when: 'Khi mua hàng',
    sheetLabel: '05_Nhap_Hang',
    targetSheet: '05',
    todo: '1 dòng / mặt hàng, SL theo ĐVT chuẩn, thành tiền thực trả.',
  },
  {
    when: 'Sau mỗi mẻ đúc / đóng gói',
    sheetLabel: '06_San_Xuat',
    targetSheet: '06',
    todo: 'SL đổ khuôn, SL đạt; cân thạch cao nếu được.',
  },
  {
    when: 'Mỗi ngày (hoặc mỗi đơn)',
    sheetLabel: '07_Don_Ban',
    targetSheet: '07',
    todo: 'Shopee: lấy số thực nhận ở Seller Center. Cập nhật trạng thái khi giao xong / hoàn.',
  },
  {
    when: 'Khi hư hỏng, tặng, kiểm kê lệch',
    sheetLabel: '08_Dieu_Chinh_Kho',
    targetSheet: '08',
    todo: 'SL âm = trừ kho, SL dương = cộng kho.',
  },
  {
    when: 'Khi trả điện, web, rút tiền...',
    sheetLabel: '11_Thu_Chi_Khac',
    targetSheet: '11',
    todo: "Cuối tháng ghi 'OPEX — Quỹ tái đầu tư khuôn' (180.000đ).",
  },
  {
    when: 'Cuối tháng',
    sheetLabel: '12_Bao_Cao_Thang',
    targetSheet: '12',
    todo: 'Chọn tháng → xem thực tế vs kế hoạch; tỷ lệ phế phẩm & giá nhập mới đưa về file kế hoạch.',
  },
  {
    when: 'Khi đổi ngưỡng đặt hàng / tồn tối thiểu',
    sheetLabel: '01, 02, 03',
    targetSheet: '01',
    todo: 'Cập nhật Điểm đặt hàng lại (01 cột H) và Tồn TP tối thiểu (02 cột N).',
  },
]

function getDefaultMonthYm(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function getTodayYmd(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${(Math.round(v * 1000) / 10).toFixed(1)}%`
}

function defaultPriceForChannel(
  skuObj: SkuCatalogItem | undefined,
  channel: SalesOrderRow['channel']
): number {
  if (!skuObj) return 0
  if (channel === 'Shopee') return skuObj.shopeeActualPrice ?? skuObj.retailPrice
  if (channel === 'Sỉ') {
    return skuObj.categoryGroup === 'B' ? skuObj.retailPrice : skuObj.wholesaleB1
  }
  return skuObj.retailPrice
}

function AlertBadge({ alert }: { alert: string }) {
  if (!alert) return <span className="text-xs text-muted-foreground">—</span>
  if (alert === 'ÂM KHO') {
    return (
      <Badge
        variant="outline"
        className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
      >
        ÂM KHO
      </Badge>
    )
  }
  if (alert.startsWith('CẦN')) {
    return (
      <Badge
        variant="outline"
        className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-300"
      >
        {alert}
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
    >
      {alert}
    </Badge>
  )
}

interface OpeningRowEdit {
  qty?: string
  date?: string
  status?: string
  note?: string
}

export function Baocao1BoMocPanel() {
  const { toast } = useToast()
  const [currentMonth, setCurrentMonth] = useState<string>(getDefaultMonthYm)
  const [reportMonth, setReportMonth] = useState<string>(getDefaultMonthYm)
  const [scope, setScope] = useState<Baocao1DataScope>('from_stocktake')
  const [activeSheet, setActiveSheet] = useState<SheetTabId>('00')
  const [snap, setSnap] = useState<Baocao1FullSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloadingFormat, setDownloadingFormat] = useState<'xlsx' | 'csv' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  // Quick search & filters inside sheets
  const [sheetSearch, setSheetSearch] = useState<string>('')
  const [bomKindFilter, setBomKindFilter] = useState<'ALL' | 'NVL' | 'Bao bì'>('ALL')
  const [openingFilter, setOpeningFilter] = useState<'ALL' | 'UNVERIFIED' | 'VT' | 'TP'>('ALL')
  const [invAlertFilter, setInvAlertFilter] = useState<'ALL' | 'ALERT' | 'NEGATIVE'>('ALL')

  // 05_Nhap_Hang form states
  const [mhDate, setMhDate] = useState<string>(getTodayYmd)
  const [mhDocCode, setMhDocCode] = useState<string>('')
  const [mhSupplier, setMhSupplier] = useState<string>('Nhà cung cấp vật tư')
  const [mhMatCode, setMhMatCode] = useState<string>('NVL-001')
  const [mhQty, setMhQty] = useState<string>('25000')
  const [mhTotalPaid, setMhTotalPaid] = useState<string>('235000')
  const [mhNote, setMhNote] = useState<string>('')

  // 06_San_Xuat form states
  const [prDate, setPrDate] = useState<string>(getTodayYmd)
  const [prBatchCode, setPrBatchCode] = useState<string>('')
  const [prSku, setPrSku] = useState<string>('BM-DEC-LAMA-LUN')
  const [prStarted, setPrStarted] = useState<string>('10')
  const [prGood, setPrGood] = useState<string>('10')
  const [prPlaster, setPrPlaster] = useState<string>('')
  const [prMinutes, setPrMinutes] = useState<string>('')
  const [prOperator, setPrOperator] = useState<string>('Xưởng Bơ Mộc')
  const [prNote, setPrNote] = useState<string>('')

  // 07_Don_Ban form states
  const [soDate, setSoDate] = useState<string>(getTodayYmd)
  const [soCode, setSoCode] = useState<string>('')
  const [soChannel, setSoChannel] = useState<SalesOrderRow['channel']>('Shopee')
  const [soCustomer, setSoCustomer] = useState<string>('Khách Shopee')
  const [soSku, setSoSku] = useState<string>('BM-DEC-LAMA-LUN')
  const [soQty, setSoQty] = useState<string>('1')
  const [soUnitPrice, setSoUnitPrice] = useState<string>('52000')
  const [soNetReceived, setSoNetReceived] = useState<string>('')
  const [soFee, setSoFee] = useState<string>('0')
  const [soShipPaid, setSoShipPaid] = useState<string>('0')
  const [soStatus, setSoStatus] = useState<SalesOrderRow['status']>('Đã giao')
  const [soNote, setSoNote] = useState<string>('')

  // 08_Dieu_Chinh_Kho form states
  const [adjDate, setAdjDate] = useState<string>(getTodayYmd)
  const [adjKind, setAdjKind] = useState<'VT' | 'TP'>('VT')
  const [adjCode, setAdjCode] = useState<string>('NVL-001')
  const [adjDelta, setAdjDelta] = useState<string>('-500')
  const [adjReason, setAdjReason] = useState<string>(ADJUSTMENT_REASONS[0])
  const [adjNote, setAdjNote] = useState<string>('')

  // 11_Thu_Chi_Khac form states
  const [cfDate, setCfDate] = useState<string>(getTodayYmd)
  const [cfFlow, setCfFlow] = useState<'Chi' | 'Thu'>('Chi')
  const [cfGroup, setCfGroup] = useState<string>('OPEX — Quỹ tái đầu tư khuôn')
  const [cfDesc, setCfDesc] = useState<string>('')
  const [cfAmount, setCfAmount] = useState<string>('')
  const [cfNote, setCfNote] = useState<string>('')

  // Inline edits for 04_Ton_Dau_Ky, 01_Vat_Tu, 02_SKU
  const [openingEdits, setOpeningEdits] = useState<Record<string, OpeningRowEdit>>({})
  const [weighedCodeEdit, setWeighedCodeEdit] = useState<string>('')
  const [reorderEdits, setReorderEdits] = useState<Record<string, string>>({})
  const [minStockEdits, setMinStockEdits] = useState<Record<string, string>>({})

  const loadSnapshot = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const data = await fetchBaocaoSnapshotClient({
          reportMonth,
          currentMonth,
          scope,
        })
        setSnap(data)
        setWeighedCodeEdit(data.meta.weighedMaterialCode)
      } catch (err) {
        if (!silent) {
          toast({
            title: 'Không thể tải báo cáo Bơ Mộc',
            description: err instanceof Error ? err.message : 'Lỗi kết nối máy chủ',
            variant: 'destructive',
          })
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [currentMonth, reportMonth, scope, toast]
  )

  useEffect(() => {
    void loadSnapshot(false)
  }, [loadSnapshot])

  useRealtime((event) => {
    if (
      [
        'reports.baocao.updated',
        'order.created',
        'order.updated',
        'shipment.updated',
        'inventory.updated',
        'invoice.created',
        'product.updated',
        'realtime.poll',
      ].includes(event.type)
    ) {
      void loadSnapshot(true)
    }
  })

  // Keep default unit price synced when user changes channel or SKU in 07_Don_Ban form
  const handleSelectSalesSkuOrChannel = (
    nextChannel: SalesOrderRow['channel'],
    nextSku: string
  ) => {
    setSoChannel(nextChannel)
    setSoSku(nextSku)
    const found = snap?.skus.find((s) => s.sku === nextSku)
    const suggested = defaultPriceForChannel(found, nextChannel)
    if (suggested > 0) {
      setSoUnitPrice(String(suggested))
    }
    if (nextChannel === 'Shopee' && (soCustomer === 'Khách lẻ' || soCustomer === 'Khách sỉ')) {
      setSoCustomer('Khách Shopee')
    } else if (nextChannel === 'Sỉ' && soCustomer === 'Khách Shopee') {
      setSoCustomer('Khách sỉ')
    } else if (nextChannel === 'Lẻ Zalo / Website' && soCustomer === 'Khách Shopee') {
      setSoCustomer('Khách lẻ')
    }
  }

  const handleDownload = async (format: 'xlsx' | 'csv') => {
    setDownloadingFormat(format)
    try {
      const params = new URLSearchParams({
        format,
        month: reportMonth,
        reportMonth,
        currentMonth,
        scope,
      })
      const blob = await fetchBaocaoExportBlob(format, params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `baocao.${format}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      trackClientBehavior({
        category: 'EXPORT',
        action: 'DATA_EXPORT',
        module: 'reports',
        targetType: 'BaocaoWorkbook',
        targetCode: `baocao.${format}`,
        summary: `Xuất mẫu Báo cáo Vận hành Bơ Mộc (baocao.${format}, tháng BC ${reportMonth}, phạm vi ${scope})`,
      })

      toast({
        title:
          format === 'xlsx'
            ? 'Đã xuất Excel 13 Sheet (baocao.xlsx)'
            : 'Đã xuất CSV nguyên mẫu (baocao.csv)',
        description: `Tệp baocao.${format} đã sẵn sàng mở trên Excel / Google Sheets.`,
      })
    } catch (err) {
      toast({
        title: 'Xuất báo cáo thất bại',
        description: err instanceof Error ? err.message : 'Không thể tải tệp báo cáo',
        variant: 'destructive',
      })
    } finally {
      setDownloadingFormat(null)
    }
  }

  const handleAddPurchase = async () => {
    setSubmitting(true)
    try {
      const res = await postBaocaoActionClient<{
        ok: boolean
        cutoffDate?: string
        hiddenInFromStocktake?: boolean
      }>({
        action: 'ADD_PURCHASE',
        date: mhDate,
        docCode: mhDocCode,
        supplier: mhSupplier,
        materialCode: mhMatCode,
        qtyStandardUnit: Number(mhQty),
        actualTotalPaid: Number(mhTotalPaid),
        note: mhNote,
      })
      setMhDocCode('')
      setMhNote('')
      toast({
        title: 'Đã ghi phiếu mua vật tư (05_Nhap_Hang)',
        description:
          res.hiddenInFromStocktake && scope === 'from_stocktake'
            ? `Ngày ${mhDate} thuộc hoặc trước ngày kiểm kê (${res.cutoffDate}) nên đang ẩn ở phạm vi "Sau ngày kiểm kê".`
            : 'Tồn kho vật tư (09) và dòng tiền tháng (00, 12) đã cập nhật.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu dòng nhập vật tư',
        description: err instanceof Error ? err.message : 'Vui lòng kiểm tra SL và thành tiền',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddProduction = async () => {
    setSubmitting(true)
    try {
      const res = await postBaocaoActionClient<{
        ok: boolean
        cutoffDate?: string
        hiddenInFromStocktake?: boolean
      }>({
        action: 'ADD_PRODUCTION',
        date: prDate,
        batchCode: prBatchCode,
        batchType:
          prSku.includes('-NL-') || prSku.includes('-BB-') || prSku.includes('-SI-TC')
            ? 'Chiết / Đóng gói'
            : 'Đúc',
        sku: prSku,
        qtyStarted: Number(prStarted),
        qtyGood: Number(prGood),
        actualPlasterGrams: prPlaster.trim() === '' ? null : Number(prPlaster),
        actualMinutes: prMinutes.trim() === '' ? null : Number(prMinutes),
        operator: prOperator,
        note: prNote,
      })
      setPrBatchCode('')
      setPrPlaster('')
      setPrNote('')
      toast({
        title: 'Đã ghi nhật ký mẻ đúc (06_San_Xuat)',
        description:
          res.hiddenInFromStocktake && scope === 'from_stocktake'
            ? `Ngày ${prDate} thuộc hoặc trước ngày kiểm kê (${res.cutoffDate}) nên đang ẩn ở phạm vi "Sau ngày kiểm kê".`
            : 'Tồn kho vật tư (09), thành phẩm (10) và hao hụt thạch cao (12) đã cập nhật.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể ghi mẻ sản xuất',
        description: err instanceof Error ? err.message : 'Vui lòng kiểm tra lại SL',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddSalesOrder = async () => {
    setSubmitting(true)
    try {
      const res = await postBaocaoActionClient<{
        ok: boolean
        cutoffDate?: string
        hiddenInFromStocktake?: boolean
      }>({
        action: 'ADD_SALES_ORDER',
        date: soDate,
        orderCode: soCode,
        channel: soChannel,
        customer: soCustomer,
        sku: soSku,
        qty: Number(soQty),
        actualUnitPrice: Number(soUnitPrice),
        netReceived: soNetReceived.trim() === '' ? null : Number(soNetReceived),
        platformAndVoucherFee: Number(soFee || 0),
        sellerShippingPaid: Number(soShipPaid || 0),
        status: soStatus,
        note: soNote,
      })
      setSoCode('')
      setSoNetReceived('')
      setSoNote('')
      toast({
        title: 'Đã ghi đơn bán hàng (07_Don_Ban)',
        description:
          res.hiddenInFromStocktake && scope === 'from_stocktake'
            ? `Ngày ${soDate} thuộc hoặc trước ngày kiểm kê (${res.cutoffDate}) nên đang ẩn ở phạm vi "Sau ngày kiểm kê".`
            : 'Doanh thu, thực nhận, kho thành phẩm (10) và bao bì (09) đã tự tính lại.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể ghi đơn bán',
        description: err instanceof Error ? err.message : 'Vui lòng kiểm tra dữ liệu đơn',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleUpdateSalesStatus = async (
    targetId: string,
    nextStatus: SalesOrderRow['status']
  ) => {
    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'UPDATE_SALES_ORDER_STATUS',
        id: targetId,
        status: nextStatus,
      })
      toast({
        title: 'Đã cập nhật trạng thái đơn bán',
        description: `Trạng thái mới: ${nextStatus} — tồn kho & doanh thu đã tự tính lại.`,
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể đổi trạng thái đơn',
        description: err instanceof Error ? err.message : 'Lỗi cập nhật',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddAdjustment = async () => {
    setSubmitting(true)
    try {
      const res = await postBaocaoActionClient<{
        ok: boolean
        cutoffDate?: string
        hiddenInFromStocktake?: boolean
      }>({
        action: 'ADD_ADJUSTMENT',
        date: adjDate,
        kind: adjKind,
        code: adjCode,
        deltaQty: Number(adjDelta),
        reason: adjReason,
        note: adjNote,
      })
      setAdjNote('')
      toast({
        title: 'Đã ghi phiếu điều chỉnh kho (08_Dieu_Chinh_Kho)',
        description:
          res.hiddenInFromStocktake && scope === 'from_stocktake'
            ? `Ngày ${adjDate} thuộc hoặc trước ngày kiểm kê (${res.cutoffDate}) nên đang ẩn ở phạm vi "Sau ngày kiểm kê".`
            : `Đã điều chỉnh ${adjDelta} cho mã ${adjCode}.`,
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu điều chỉnh kho',
        description: err instanceof Error ? err.message : 'SL điều chỉnh phải khác 0',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleAddCashflow = async (presetMoldFund = false) => {
    setSubmitting(true)
    try {
      const targetDate = presetMoldFund ? `${reportMonth}-28` : cfDate
      const payload = presetMoldFund
        ? {
            action: 'ADD_CASHFLOW',
            date: targetDate,
            flowType: 'Chi',
            group: 'OPEX — Quỹ tái đầu tư khuôn',
            planCostCode: 'OPEX-KHUON',
            description: 'Trích quỹ tái đầu tư khuôn silicon định kỳ tháng',
            amount: 180000,
            note: 'Chuyển sang tiết kiệm theo kế hoạch định giá Bơ Mộc',
          }
        : {
            action: 'ADD_CASHFLOW',
            date: targetDate,
            flowType: cfFlow,
            group: cfGroup,
            planCostCode: cfGroup.startsWith('OPEX') ? 'OPEX' : 'KHAC',
            description: cfDesc,
            amount: Number(cfAmount),
            note: cfNote,
          }

      const res = await postBaocaoActionClient<{
        ok: boolean
        cutoffDate?: string
        hiddenInFromStocktake?: boolean
      }>(payload)
      if (!presetMoldFund) {
        setCfDesc('')
        setCfAmount('')
        setCfNote('')
      }
      toast({
        title: 'Đã ghi vào 11_Thu_Chi_Khac',
        description:
          res.hiddenInFromStocktake && scope === 'from_stocktake'
            ? `Ngày ${targetDate} thuộc hoặc trước ngày kiểm kê (${res.cutoffDate}) nên đang ẩn ở phạm vi "Sau ngày kiểm kê".`
            : 'Số liệu OPEX và dòng tiền tháng đã được tự động tính lại.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu khoản thu/chi',
        description: err instanceof Error ? err.message : 'Dữ liệu không hợp lệ',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteRow = async (
    action:
      | 'DELETE_CASHFLOW'
      | 'DELETE_PRODUCTION'
      | 'DELETE_PURCHASE'
      | 'DELETE_SALES_ORDER'
      | 'DELETE_ADJUSTMENT',
    id?: string
  ) => {
    if (!id) return
    setSubmitting(true)
    try {
      await postBaocaoActionClient({ action, id })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể xóa dòng',
        description: err instanceof Error ? err.message : 'Đã có lỗi xảy ra',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleConfirmOpeningStock = async (
    kind: 'VT' | 'TP',
    code: string,
    currentQty: number,
    currentDate: string,
    currentNote: string
  ) => {
    const key = `${kind}:${code}`
    const edit = openingEdits[key] ?? {}
    const nextQty = edit.qty !== undefined ? Number(edit.qty) : currentQty
    const nextDate = edit.date !== undefined ? edit.date : currentDate
    const nextStatus = edit.status !== undefined ? edit.status : 'Đã kiểm kê'
    const nextNote = edit.note !== undefined ? edit.note : currentNote

    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'UPDATE_OPENING_STOCK',
        kind,
        code,
        openingQty: nextQty,
        stocktakeDate: nextDate,
        status: nextStatus,
        note: nextNote,
      })
      toast({
        title: `Đã lưu kiểm kê ${code}`,
        description: `Tồn đầu kỳ = ${formatNumber(nextQty)} · Trạng thái: ${nextStatus}`,
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể cập nhật kiểm kê',
        description: err instanceof Error ? err.message : 'Lỗi lưu dữ liệu',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleBulkConfirmOpeningStock = async () => {
    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'BULK_CONFIRM_OPENING_STOCK',
        stocktakeDate: snap?.meta.stocktakeCutoffDate || '2026-11-22',
      })
      toast({
        title: 'Đã chốt kiểm kê toàn bộ mã ước tính',
        description: "Tất cả vật tư & thành phẩm đang dùng đã chuyển sang trạng thái 'Đã kiểm kê'.",
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể chốt kiểm kê hàng loạt',
        description: err instanceof Error ? err.message : 'Lỗi lưu dữ liệu',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveWeighedMaterial = async () => {
    if (!weighedCodeEdit.trim()) return
    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'UPDATE_CONFIG',
        weighedMaterialCode: weighedCodeEdit.trim().toUpperCase(),
      })
      toast({
        title: 'Đã cập nhật Mã VT cân thực tế (01_Vat_Tu!C3)',
        description: `Mã ${weighedCodeEdit.trim().toUpperCase()} sẽ trừ kho theo gram cân thực ở 06_San_Xuat.`,
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu cấu hình mã cân',
        description: err instanceof Error ? err.message : 'Lỗi lưu dữ liệu',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveReorderPoint = async (code: string, currentRp: number | null) => {
    const rawVal = reorderEdits[code] !== undefined ? reorderEdits[code] : (currentRp ?? '')
    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'UPDATE_THRESHOLDS',
        materialCode: code,
        reorderPoint: String(rawVal).trim() === '' ? null : Number(rawVal),
      })
      toast({
        title: `Đã lưu Điểm đặt hàng lại cho ${code}`,
        description: 'Cảnh báo kho vật tư tại Sheet 00 & 09 đã được tính lại.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu điểm đặt lại',
        description: err instanceof Error ? err.message : 'Giá trị không hợp lệ',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleSaveMinSkuStock = async (sku: string, currentMin: number) => {
    const rawVal = minStockEdits[sku] !== undefined ? minStockEdits[sku] : String(currentMin)
    setSubmitting(true)
    try {
      await postBaocaoActionClient({
        action: 'UPDATE_THRESHOLDS',
        sku,
        minFinishedStock: Number(rawVal || 0),
      })
      toast({
        title: `Đã lưu Tồn tối thiểu cho ${sku}`,
        description: 'Cảnh báo cần đúc/đóng thêm tại Sheet 00 & 10 đã cập nhật.',
      })
      await loadSnapshot(true)
    } catch (err) {
      toast({
        title: 'Không thể lưu tồn tối thiểu',
        description: err instanceof Error ? err.message : 'Giá trị không hợp lệ',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleResetState = async () => {
    setSubmitting(true)
    try {
      await postBaocaoActionClient({ action: 'RESET_STATE' })
      setOpeningEdits({})
      setReorderEdits({})
      setMinStockEdits({})
      setWeighedCodeEdit('NVL-001')
      setResetConfirmOpen(false)
      toast({
        title: 'Đã khôi phục Sổ Vận hành về mặc định gốc',
        description: 'Các dòng nhập thủ công và ghi đè kiểm kê đã được làm sạch an toàn.',
      })
      await loadSnapshot(false)
    } catch (err) {
      toast({
        title: 'Không thể đặt lại trạng thái',
        description: err instanceof Error ? err.message : 'Lỗi kết nối',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const qLower = sheetSearch.trim().toLowerCase()

  const filteredMaterials = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.materials
    return snap.materials.filter(
      (m) =>
        m.code.toLowerCase().includes(qLower) ||
        m.name.toLowerCase().includes(qLower) ||
        m.group.toLowerCase().includes(qLower)
    )
  }, [snap, qLower])

  const filteredSkus = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.skus
    return snap.skus.filter(
      (s) =>
        s.sku.toLowerCase().includes(qLower) ||
        s.name.toLowerCase().includes(qLower) ||
        s.pricingGroup.toLowerCase().includes(qLower)
    )
  }, [snap, qLower])

  const filteredBom = useMemo(() => {
    if (!snap) return []
    return snap.bom.filter((b) => {
      if (bomKindFilter !== 'ALL' && b.kind !== bomKindFilter) return false
      if (!qLower) return true
      return (
        b.sku.toLowerCase().includes(qLower) ||
        b.materialCode.toLowerCase().includes(qLower) ||
        b.materialName.toLowerCase().includes(qLower)
      )
    })
  }, [snap, bomKindFilter, qLower])

  const filteredOpening = useMemo(() => {
    if (!snap) return []
    return snap.openingStocks.filter((o) => {
      if (openingFilter === 'UNVERIFIED' && !o.status.startsWith('Ước tính')) return false
      if (openingFilter === 'VT' && o.kind !== 'VT') return false
      if (openingFilter === 'TP' && o.kind !== 'TP') return false
      if (!qLower) return true
      return o.code.toLowerCase().includes(qLower) || o.name.toLowerCase().includes(qLower)
    })
  }, [snap, openingFilter, qLower])

  const filteredMatInv = useMemo(() => {
    if (!snap) return []
    return snap.materialInventory.filter((m) => {
      if (invAlertFilter === 'ALERT' && m.alert !== 'CẦN ĐẶT HÀNG' && m.alert !== 'ÂM KHO') {
        return false
      }
      if (invAlertFilter === 'NEGATIVE' && m.currentQty >= 0) return false
      if (!qLower) return true
      return m.code.toLowerCase().includes(qLower) || m.name.toLowerCase().includes(qLower)
    })
  }, [snap, invAlertFilter, qLower])

  const filteredTpInv = useMemo(() => {
    if (!snap) return []
    return snap.finishedInventory.filter((f) => {
      if (invAlertFilter === 'ALERT' && f.alert !== 'CẦN ĐÚC / ĐÓNG THÊM' && f.alert !== 'ÂM KHO') {
        return false
      }
      if (invAlertFilter === 'NEGATIVE' && f.currentQty >= 0) return false
      if (!qLower) return true
      return f.sku.toLowerCase().includes(qLower) || f.name.toLowerCase().includes(qLower)
    })
  }, [snap, invAlertFilter, qLower])

  const filteredPurchases = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.purchases
    return snap.purchases.filter(
      (p) =>
        p.materialCode.toLowerCase().includes(qLower) ||
        p.materialName.toLowerCase().includes(qLower) ||
        p.docCode.toLowerCase().includes(qLower) ||
        p.supplier.toLowerCase().includes(qLower) ||
        p.note.toLowerCase().includes(qLower) ||
        p.date.includes(qLower)
    )
  }, [snap, qLower])

  const filteredProductions = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.productions
    return snap.productions.filter(
      (pr) =>
        pr.sku.toLowerCase().includes(qLower) ||
        pr.skuName.toLowerCase().includes(qLower) ||
        pr.batchCode.toLowerCase().includes(qLower) ||
        pr.operator.toLowerCase().includes(qLower) ||
        pr.note.toLowerCase().includes(qLower) ||
        pr.date.includes(qLower)
    )
  }, [snap, qLower])

  const filteredSalesOrders = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.salesOrders
    return snap.salesOrders.filter(
      (so) =>
        so.orderCode.toLowerCase().includes(qLower) ||
        so.sku.toLowerCase().includes(qLower) ||
        so.skuName.toLowerCase().includes(qLower) ||
        so.customer.toLowerCase().includes(qLower) ||
        so.channel.toLowerCase().includes(qLower) ||
        so.note.toLowerCase().includes(qLower) ||
        so.date.includes(qLower)
    )
  }, [snap, qLower])

  const filteredAdjustments = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.adjustments
    return snap.adjustments.filter(
      (ad) =>
        ad.code.toLowerCase().includes(qLower) ||
        ad.name.toLowerCase().includes(qLower) ||
        ad.reason.toLowerCase().includes(qLower) ||
        ad.note.toLowerCase().includes(qLower) ||
        ad.date.includes(qLower)
    )
  }, [snap, qLower])

  const filteredCashflows = useMemo(() => {
    if (!snap) return []
    if (!qLower) return snap.otherCashflows
    return snap.otherCashflows.filter(
      (cf) =>
        cf.group.toLowerCase().includes(qLower) ||
        cf.planCostCode.toLowerCase().includes(qLower) ||
        cf.description.toLowerCase().includes(qLower) ||
        cf.note.toLowerCase().includes(qLower) ||
        cf.date.includes(qLower)
    )
  }, [snap, qLower])

  const selectedPurchaseMat = snap?.materials.find((m) => m.code === mhMatCode)
  const previewSalesGross = Math.max(0, (Number(soQty) || 0) * (Number(soUnitPrice) || 0))
  const previewSalesShip = Math.max(0, Number(soShipPaid) || 0)
  const previewNetConflict =
    soNetReceived.trim() !== '' &&
    ((Number(soNetReceived) || 0) < 0 ||
      (Number(soNetReceived) || 0) + previewSalesShip > previewSalesGross)
  const previewSalesNet =
    soNetReceived.trim() !== ''
      ? Number(soNetReceived) || 0
      : previewSalesGross - (Number(soFee) || 0) - previewSalesShip

  return (
    <div className="space-y-4" data-testid="baocao1-bomoc-panel">
      {/* Control Banner */}
      <Card className="border-emerald-200/80 bg-gradient-to-r from-emerald-50/70 via-background to-sky-50/60 dark:border-emerald-900/50 dark:from-emerald-950/25 dark:via-background dark:to-sky-950/20">
        <CardHeader className="pb-3">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                  Chuẩn Bơ Mộc · 13 Sheet Tự Tính
                </Badge>
                <span className="text-xs font-medium text-muted-foreground">
                  Đồng bộ trực tiếp Đơn bán (07) · Nhập kho (05) · Sản xuất BOM (06) · Điều chỉnh (08) · Tồn kho &amp; Báo cáo tháng (09, 10, 12)
                </span>
              </div>
              <CardTitle className="mt-1.5 text-lg md:text-xl">
                TỔNG QUAN VẬN HÀNH — BƠ MỘC (<code className="text-base font-semibold">baocao</code>)
              </CardTitle>
              <CardDescription className="mt-0.5">
                Xuất trực tiếp tệp <code>baocao.xlsx</code> đủ 13 Sheet có sẵn công thức sống (<code>SUMIFS</code>, <code>INDEX/MATCH</code>, <code>SUMPRODUCT</code>, <code>EDATE</code>), ô vàng nhập liệu và cảnh báo kho tự động.
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void handleDownload('xlsx')}
                disabled={downloadingFormat !== null}
                className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-700"
                data-testid="btn-export-baocao-xlsx"
              >
                {downloadingFormat === 'xlsx' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-1.5 h-4 w-4" />
                )}
                Xuất Excel baocao (.xlsx)
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleDownload('csv')}
                disabled={downloadingFormat !== null}
                data-testid="btn-export-baocao-csv"
              >
                {downloadingFormat === 'csv' ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-4 w-4" />
                )}
                Xuất CSV baocao (.csv)
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void loadSnapshot(false)}
                disabled={loading}
                title="Làm mới số liệu"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setResetConfirmOpen(true)}
                disabled={submitting}
                title="Khôi phục dữ liệu nhập tay về mặc định"
                className="text-muted-foreground hover:text-rose-600"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="border-t bg-background/60 pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1">
              <Label htmlFor="baocao-current-month" className="text-xs font-semibold">
                Tháng hiện tại (Ô vàng 00!B3)
              </Label>
              <Input
                id="baocao-current-month"
                type="month"
                value={currentMonth}
                onChange={(e) => {
                  if (e.target.value) {
                    setCurrentMonth(e.target.value)
                    if (reportMonth === currentMonth) {
                      setReportMonth(e.target.value)
                    }
                  }
                }}
                className="h-9 bg-amber-50/70 font-medium dark:bg-amber-950/30"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="baocao-report-month" className="text-xs font-semibold">
                Tháng báo cáo (Ô vàng 12!C3)
              </Label>
              <Input
                id="baocao-report-month"
                type="month"
                value={reportMonth}
                onChange={(e) => {
                  if (e.target.value) setReportMonth(e.target.value)
                }}
                className="h-9 bg-amber-50/70 font-medium dark:bg-amber-950/30"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Phạm vi nạp giao dịch từ CMS</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as Baocao1DataScope)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="from_stocktake">
                    Sau ngày kiểm kê ({snap?.meta.stocktakeCutoffDate ?? '2026-11-22'}) — Chuẩn Sheet 04
                  </SelectItem>
                  <SelectItem value="all">Toàn bộ lịch sử giao dịch trên CMS</SelectItem>
                  <SelectItem value="template">
                    Biểu mẫu trắng (0 giao dịch, giữ nguyên danh mục &amp; công thức)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Tìm nhanh trên các Sheet</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={sheetSearch}
                  onChange={(e) => setSheetSearch(e.target.value)}
                  placeholder="Mã VT, SKU, tên mặt hàng..."
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground">
            <span>
              Kế hoạch chuẩn: <strong className="text-foreground">200 SP/tháng</strong> · Doanh thu KH:{' '}
              <strong className="text-foreground">{formatVND(10_281_000)}</strong> · Lãi đóng góp KH:{' '}
              <strong className="text-foreground">{formatVND(2_773_696)}</strong> · OPEX KH:{' '}
              <strong className="text-rose-600 dark:text-rose-400">{formatVND(-630_000)}</strong>
            </span>
            <span>
              Lãi ròng KH:{' '}
              <strong className="text-emerald-600 dark:text-emerald-400">{formatVND(2_143_696)}</strong> · Thu nhập gia đình KH:{' '}
              <strong className="text-foreground">{formatVND(2_816_696)}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      {/* 13-Sheet Selector Pills */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border bg-card p-2">
        {SHEET_TABS.map((t) => {
          const active = activeSheet === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveSheet(t.id)}
              data-testid={`baocao-sheet-tab-${t.id}`}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-[#0066CC] text-white shadow-xs'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {loading || !snap ? (
        <div className="space-y-3">
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          {/* ================= 00. TỔNG QUAN ================= */}
          {activeSheet === '00' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      A. THÁNG NÀY ({snap.meta.currentMonth} → trước {snap.meta.currentMonthNext})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Doanh thu ghi nhận</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVND(snap.overview.thisMonth.recognizedRevenue)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Thực nhận</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVND(snap.overview.thisMonth.netPayout)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-semibold">
                            Lãi gộp (thực nhận − giá vốn)
                          </TableCell>
                          <TableCell className="text-right font-bold text-emerald-600 tabular-nums dark:text-emerald-400">
                            {formatVND(snap.overview.thisMonth.grossProfit)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>SL sản phẩm đã bán</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(snap.overview.thisMonth.soldUnits)} SP
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>SL đã sản xuất đạt</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(snap.overview.thisMonth.producedGoodUnits)} SP
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Chi mua vật tư (05)</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.overview.thisMonth.materialPurchaseSpent)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Chi khác (OPEX, dụng cụ... - 11)</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.overview.thisMonth.otherExpenses)}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/30">
                          <TableCell className="text-muted-foreground">Kế hoạch: SL / tháng</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatNumber(snap.overview.thisMonth.planMonthlyUnits)} SP
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-muted/30">
                          <TableCell className="text-muted-foreground">
                            Kế hoạch: Lãi ròng / tháng
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">
                            {formatVND(snap.overview.thisMonth.planMonthlyNetProfit)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">B. CẢNH BÁO KHO &amp; KIỂM KÊ</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setInvAlertFilter(
                              snap.overview.stockAlerts.materialsNeedReorder > 0 ? 'ALERT' : 'ALL'
                            )
                            setActiveSheet('09')
                          }}
                        >
                          <TableCell>Số vật tư CẦN ĐẶT HÀNG</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                snap.overview.stockAlerts.materialsNeedReorder > 0
                                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              )}
                            >
                              {snap.overview.stockAlerts.materialsNeedReorder} mã
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setInvAlertFilter(
                              snap.overview.stockAlerts.skusNeedProduction > 0 ? 'ALERT' : 'ALL'
                            )
                            setActiveSheet('10')
                          }}
                        >
                          <TableCell>Số SKU CẦN ĐÚC / ĐÓNG THÊM</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                snap.overview.stockAlerts.skusNeedProduction > 0
                                  ? 'border-amber-300 bg-amber-50 text-amber-800'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              )}
                            >
                              {snap.overview.stockAlerts.skusNeedProduction} SKU
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            const hasNegVt = snap.materialInventory.some((m) => m.currentQty < 0)
                            const hasNegTp = snap.finishedInventory.some((f) => f.currentQty < 0)
                            setInvAlertFilter(hasNegVt || hasNegTp ? 'NEGATIVE' : 'ALL')
                            setActiveSheet(hasNegVt || !hasNegTp ? '09' : '10')
                          }}
                        >
                          <TableCell>Số mã ÂM KHO (ghi chép thiếu)</TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant="outline"
                              className={cn(
                                snap.overview.stockAlerts.negativeStockCodes > 0
                                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              )}
                            >
                              {snap.overview.stockAlerts.negativeStockCodes} mã
                            </Badge>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Giá trị tồn vật tư (09)</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVND(snap.overview.stockAlerts.materialStockValue)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Giá trị tồn thành phẩm (10)</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatVND(snap.overview.stockAlerts.finishedStockValue)}
                          </TableCell>
                        </TableRow>
                        <TableRow
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => {
                            setOpeningFilter(
                              snap.overview.stockAlerts.unverifiedOpeningCount > 0
                                ? 'UNVERIFIED'
                                : 'ALL'
                            )
                            setActiveSheet('04')
                          }}
                        >
                          <TableCell>Tồn đầu kỳ chưa kiểm kê (04)</TableCell>
                          <TableCell className="text-right">
                            <Badge variant="secondary">
                              {snap.overview.stockAlerts.unverifiedOpeningCount} mã ước tính
                            </Badge>
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              {/* Section C: Quy trình ghi chép */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    C. QUY TRÌNH GHI CHÉP VẬN HÀNH CHUẨN BƠ MỘC (Bấm để mở nhanh từng Sheet)
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56">Khi nào</TableHead>
                        <TableHead className="w-44">Sheet</TableHead>
                        <TableHead>Việc cần làm</TableHead>
                        <TableHead className="w-24 text-right">Mở nhanh</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {WORKFLOW_GUIDE.map((wg) => (
                        <TableRow
                          key={wg.sheetLabel}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => setActiveSheet(wg.targetSheet)}
                        >
                          <TableCell className="font-semibold text-xs">{wg.when}</TableCell>
                          <TableCell className="font-mono text-xs text-primary">
                            {wg.sheetLabel}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{wg.todo}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                              Mở <ArrowRight className="ml-1 h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 12. BÁO CÁO THÁNG ================= */}
          {activeSheet === '12' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    12A. Bán hàng theo kênh ({snap.meta.reportMonth} → trước {snap.meta.reportMonthNext})
                  </CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kênh</TableHead>
                        <TableHead className="text-right">SL bán thực</TableHead>
                        <TableHead className="text-right">SL KH</TableHead>
                        <TableHead className="text-right">% đạt SL</TableHead>
                        <TableHead className="text-right">Doanh thu thực</TableHead>
                        <TableHead className="text-right">Doanh thu KH</TableHead>
                        <TableHead className="text-right">Thực nhận</TableHead>
                        <TableHead className="text-right">Giá vốn chuẩn</TableHead>
                        <TableHead className="text-right">Lãi gộp thực</TableHead>
                        <TableHead className="text-right">Lãi đóng góp KH</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.monthlyReport.byChannel.map((ch) => (
                        <TableRow key={ch.channel}>
                          <TableCell className="font-semibold">{ch.channel}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(ch.actualQty)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatNumber(ch.planQty)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {fmtPct(ch.qtyAchievementPct)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(ch.actualRevenue)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(ch.planRevenue)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(ch.actualNetPayout)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(ch.standardCogs)}
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                            {formatVND(ch.actualGrossProfit)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(ch.planContributionProfit)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-emerald-50/60 font-bold dark:bg-emerald-950/25">
                        <TableCell>TỔNG</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(snap.monthlyReport.channelTotal.actualQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(snap.monthlyReport.channelTotal.planQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtPct(snap.monthlyReport.channelTotal.qtyAchievementPct)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(snap.monthlyReport.channelTotal.actualRevenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(snap.monthlyReport.channelTotal.planRevenue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(snap.monthlyReport.channelTotal.actualNetPayout)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(snap.monthlyReport.channelTotal.standardCogs)}
                        </TableCell>
                        <TableCell className="text-right text-emerald-700 tabular-nums dark:text-emerald-300">
                          {formatVND(snap.monthlyReport.channelTotal.actualGrossProfit)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(snap.monthlyReport.channelTotal.planContributionProfit)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">12B. Lãi / Lỗ thực tế vs Kế hoạch</CardTitle>
                  </CardHeader>
                  <CardContent className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Chỉ tiêu</TableHead>
                          <TableHead className="text-right">Thực tế</TableHead>
                          <TableHead className="text-right">Kế hoạch</TableHead>
                          <TableHead className="text-right">Chênh lệch</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <TableRow>
                          <TableCell>Lãi gộp</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.actualGrossProfit)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.planGrossProfit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(
                              snap.monthlyReport.pnl.actualGrossProfit -
                                snap.monthlyReport.pnl.planGrossProfit
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>(−) OPEX thực</TableCell>
                          <TableCell className="text-right text-rose-600 tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.actualOpex)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.planOpex)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(
                              snap.monthlyReport.pnl.actualOpex - snap.monthlyReport.pnl.planOpex
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-emerald-50/50 font-semibold dark:bg-emerald-950/20">
                          <TableCell>➜ LÃI RÒNG THÁNG</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.actualNetProfit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.planNetProfit)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(
                              snap.monthlyReport.pnl.actualNetProfit -
                                snap.monthlyReport.pnl.planNetProfit
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>(+) Công trực tiếp</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.directLaborActual)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.directLaborPlan)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(
                              snap.monthlyReport.pnl.directLaborActual -
                                snap.monthlyReport.pnl.directLaborPlan
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow className="font-bold">
                          <TableCell>➜ THU NHẬP GIA ĐÌNH</TableCell>
                          <TableCell className="text-right text-emerald-600 tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.estimatedFamilyIncomeActual)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.pnl.estimatedFamilyIncomePlan)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(
                              snap.monthlyReport.pnl.estimatedFamilyIncomeActual -
                                snap.monthlyReport.pnl.estimatedFamilyIncomePlan
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">12C. Sản xuất &amp; Hao hụt thạch cao</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>Số mẻ trong tháng</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {snap.monthlyReport.productionSummary.batchCount}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Tổng SL đổ khuôn / đóng</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(snap.monthlyReport.productionSummary.totalQtyStarted)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Tổng SL đạt</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(snap.monthlyReport.productionSummary.totalQtyGood)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Tỷ lệ phế phẩm thực</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {fmtPct(snap.monthlyReport.productionSummary.defectRate)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Thạch cao cân thực (g)</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumber(
                              snap.monthlyReport.productionSummary.weighedPlasterActualGrams
                            )}{' '}
                            g
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>Thạch cao ĐM các mẻ có cân (g)</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatNumber(
                              snap.monthlyReport.productionSummary.weighedPlasterStandardGrams
                            )}{' '}
                            g
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell className="font-medium">Chênh vs định mức</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {formatNumber(snap.monthlyReport.productionSummary.plasterVarianceGrams)}{' '}
                            g
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">12D. Dòng tiền thực trong tháng</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableBody>
                        <TableRow>
                          <TableCell>(+) Thực nhận từ đơn bán</TableCell>
                          <TableCell className="text-right text-emerald-600 tabular-nums">
                            {formatVND(snap.monthlyReport.cashflow.netFromSales)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>(+) Thu khác (11)</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.cashflow.otherIncome)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>(−) Mua vật tư (05)</TableCell>
                          <TableCell className="text-right text-rose-600 tabular-nums">
                            {formatVND(snap.monthlyReport.cashflow.materialPurchases)}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell>(−) Chi khác (11: OPEX, rút tiền...)</TableCell>
                          <TableCell className="text-right text-rose-600 tabular-nums">
                            {formatVND(snap.monthlyReport.cashflow.otherExpenses)}
                          </TableCell>
                        </TableRow>
                        <TableRow className="bg-emerald-50/50 font-bold dark:bg-emerald-950/20">
                          <TableCell>➜ DÒNG TIỀN RÒNG</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(snap.monthlyReport.cashflow.netCashflow)}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    12E. Hiệu quả theo từng SKU (Thực tế vs Kế hoạch)
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mã SKU</TableHead>
                        <TableHead className="text-right">SL bán thực</TableHead>
                        <TableHead className="text-right">SL KH</TableHead>
                        <TableHead className="text-right">% đạt</TableHead>
                        <TableHead className="text-right">Giá BQ thực</TableHead>
                        <TableHead className="text-right">Giá chuẩn BQ</TableHead>
                        <TableHead className="text-right">Chênh giá</TableHead>
                        <TableHead className="text-right">SL làm</TableHead>
                        <TableHead className="text-right">SL đạt</TableHead>
                        <TableHead className="text-right">% lỗi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snap.monthlyReport.bySku
                        .filter(
                          (sk) =>
                            !qLower ||
                            sk.sku.toLowerCase().includes(qLower) ||
                            sk.name.toLowerCase().includes(qLower)
                        )
                        .map((sk) => (
                          <TableRow key={sk.sku}>
                            <TableCell className="font-mono text-xs font-semibold" title={sk.name}>
                              {sk.sku}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(sk.actualSoldQty)}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {formatNumber(sk.planMonthlyQty)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtPct(sk.achievementPct)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {sk.actualAvgPrice !== null ? formatVND(sk.actualAvgPrice) : '—'}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {sk.standardAvgPrice !== null ? formatVND(sk.standardAvgPrice) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {sk.priceVariance !== null ? formatVND(sk.priceVariance) : '—'}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(sk.qtyStarted)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(sk.qtyGood)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtPct(sk.defectPct)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 09. TỒN KHO VẬT TƯ ================= */}
          {activeSheet === '09' && (
            <Card>
              <CardHeader className="flex flex-col justify-between gap-2 pb-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="text-base">
                    09. TỒN KHO VẬT TƯ (TỰ TÍNH — {filteredMatInv.length}/{snap.materialInventory.length} MÃ)
                  </CardTitle>
                  <CardDescription>
                    Tồn = Đầu kỳ (04) + Nhập (05) − Xuất SX theo BOM (06) − Xuất bao bì theo đơn bán (07) ± Điều chỉnh (08)
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'ALERT', 'NEGATIVE'] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={invAlertFilter === f ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setInvAlertFilter(f)}
                    >
                      {f === 'ALL' ? 'Tất cả' : f === 'ALERT' ? 'Cần đặt / Cảnh báo' : 'Âm kho'}
                    </Button>
                  ))}
                  <Badge className="bg-teal-600 text-white">
                    Tổng giá trị tồn: {formatVND(snap.overview.stockAlerts.materialStockValue)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="max-h-[540px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã VT</TableHead>
                      <TableHead>Tên vật tư</TableHead>
                      <TableHead className="text-center">ĐVT</TableHead>
                      <TableHead className="text-right">Đầu kỳ</TableHead>
                      <TableHead className="text-right">Nhập</TableHead>
                      <TableHead className="text-right">Xuất SX</TableHead>
                      <TableHead className="text-right">Xuất bao bì</TableHead>
                      <TableHead className="text-right">ĐC</TableHead>
                      <TableHead className="text-right font-bold">TỒN HIỆN TẠI</TableHead>
                      <TableHead className="text-right">Điểm đặt lại</TableHead>
                      <TableHead className="text-center">Cảnh báo</TableHead>
                      <TableHead className="text-right">Giá trị tồn</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMatInv.map((m) => (
                      <TableRow key={m.code}>
                        <TableCell className="font-mono text-xs font-semibold">{m.code}</TableCell>
                        <TableCell className="max-w-[240px] truncate" title={m.name}>
                          {m.name}
                        </TableCell>
                        <TableCell className="text-center text-xs">{m.unit}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(m.openingQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(m.purchasedQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(m.productionUsedQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(m.packagingSoldQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(m.adjustedQty)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-bold tabular-nums',
                            m.currentQty < 0 && 'text-rose-600'
                          )}
                        >
                          {formatNumber(m.currentQty)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {m.reorderPoint !== null ? formatNumber(m.reorderPoint) : '—'}
                        </TableCell>
                        <TableCell className="text-center">
                          <AlertBadge alert={m.alert} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(m.stockValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ================= 10. TỒN KHO THÀNH PHẨM ================= */}
          {activeSheet === '10' && (
            <Card>
              <CardHeader className="flex flex-col justify-between gap-2 pb-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="text-base">
                    10. TỒN KHO THÀNH PHẨM (TỰ TÍNH — {filteredTpInv.length}/{snap.finishedInventory.length} SKU)
                  </CardTitle>
                  <CardDescription>
                    Tồn = Đầu kỳ (04) + SL đạt (06) − Xuất bán (07: đã giao, đang giao, hoàn hỏng) ± Điều chỉnh (08)
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'ALERT', 'NEGATIVE'] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={invAlertFilter === f ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setInvAlertFilter(f)}
                    >
                      {f === 'ALL' ? 'Tất cả' : f === 'ALERT' ? 'Cần đúc / Đóng thêm' : 'Âm kho'}
                    </Button>
                  ))}
                  <Badge className="bg-teal-600 text-white">
                    Tổng giá trị tồn: {formatVND(snap.overview.stockAlerts.finishedStockValue)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="max-h-[540px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã SKU</TableHead>
                      <TableHead>Tên SKU</TableHead>
                      <TableHead className="text-right">Đầu kỳ</TableHead>
                      <TableHead className="text-right">SX đạt</TableHead>
                      <TableHead className="text-right">Xuất bán</TableHead>
                      <TableHead className="text-right">ĐC</TableHead>
                      <TableHead className="text-right font-bold">TỒN HIỆN TẠI</TableHead>
                      <TableHead className="text-right">Tồn tối thiểu</TableHead>
                      <TableHead className="text-center">Cảnh báo</TableHead>
                      <TableHead className="text-right">Giá trị tồn</TableHead>
                      <TableHead className="text-right">Bán 30 ngày</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredTpInv.map((f) => (
                      <TableRow key={f.sku}>
                        <TableCell className="font-mono text-xs font-semibold">{f.sku}</TableCell>
                        <TableCell className="max-w-[260px] truncate" title={f.name}>
                          {f.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.openingQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.producedGoodQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.soldOutQty)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.adjustedQty)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-bold tabular-nums',
                            f.currentQty < 0 && 'text-rose-600'
                          )}
                        >
                          {formatNumber(f.currentQty)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {formatNumber(f.minStock)}
                        </TableCell>
                        <TableCell className="text-center">
                          <AlertBadge alert={f.alert} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatVND(f.stockValue)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(f.soldLast30Days)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ================= 07. ĐƠN BÁN ================= */}
          {activeSheet === '07' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingCart className="h-4 w-4 text-emerald-600" />
                    Ghi Đơn Bán Hàng / Đơn Gộp Shopee Theo Ngày (07_Don_Ban)
                  </CardTitle>
                  <CardDescription>
                    Shopee: nhập trực tiếp <strong>Số tiền thực nhận</strong> trên Seller Center để hệ thống tự tính Phí sàn/voucher = Thành tiền − Thực nhận. Các đơn từ POS &amp; Shopee Sync cũng tự động đổ về bên dưới.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
                    <div className="space-y-1">
                      <Label className="text-xs">Ngày</Label>
                      <Input
                        type="date"
                        value={soDate}
                        onChange={(e) => setSoDate(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Mã đơn</Label>
                      <Input
                        placeholder="SHP-2311 (tự sinh)"
                        value={soCode}
                        onChange={(e) => setSoCode(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Kênh bán</Label>
                      <Select
                        value={soChannel}
                        onValueChange={(v) =>
                          handleSelectSalesSkuOrChannel(v as SalesOrderRow['channel'], soSku)
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SALES_CHANNELS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <Label className="text-xs">Mã SKU</Label>
                      <Select
                        value={soSku}
                        onValueChange={(v) => handleSelectSalesSkuOrChannel(soChannel, v)}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {snap.skus.map((s) => (
                            <SelectItem key={s.sku} value={s.sku}>
                              {s.sku} — {s.name.slice(0, 32)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SL</Label>
                      <Input
                        type="number"
                        min={1}
                        value={soQty}
                        onChange={(e) => setSoQty(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Đơn giá bán</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1000}
                        value={soUnitPrice}
                        onChange={(e) => setSoUnitPrice(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => void handleAddSalesOrder()}
                        disabled={submitting}
                        className="h-9 w-full bg-emerald-600 text-white hover:bg-emerald-700"
                        data-testid="btn-add-sales-order"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Ghi đơn
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                    <Input
                      placeholder="Thực nhận Seller Center (tự tính phí)"
                      type="number"
                      min={0}
                      value={soNetReceived}
                      onChange={(e) => setSoNetReceived(e.target.value)}
                      className="h-8 bg-amber-50/60 text-xs dark:bg-amber-950/25"
                    />
                    <Input
                      placeholder="Hoặc nhập Phí sàn/COD/voucher"
                      type="number"
                      min={0}
                      disabled={soNetReceived.trim() !== ''}
                      value={soFee}
                      onChange={(e) => setSoFee(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Ship shop trả (đ)"
                      type="number"
                      min={0}
                      value={soShipPaid}
                      onChange={(e) => setSoShipPaid(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Select
                      value={soStatus}
                      onValueChange={(v) => setSoStatus(v as SalesOrderRow['status'])}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SALES_STATUSES.map((st) => (
                          <SelectItem key={st} value={st}>
                            {st}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Tên khách hàng"
                      value={soCustomer}
                      onChange={(e) => setSoCustomer(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Ghi chú đơn..."
                      value={soNote}
                      onChange={(e) => setSoNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Tạm tính dòng đơn: Thành tiền <strong>{formatVND(previewSalesGross)}</strong> → Thực nhận dự kiến{' '}
                    <strong
                      className={cn(
                        previewNetConflict
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      )}
                    >
                      {formatVND(previewSalesNet)}
                    </strong>
                    {previewNetConflict && (
                      <span className="ml-2 font-medium text-rose-600 dark:text-rose-400">
                        (Thực nhận + Ship shop trả đang vượt Thành tiền)
                      </span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    07. ĐƠN BÁN HÀNG ({filteredSalesOrders.length}/{snap.salesOrders.length} dòng SKU)
                  </CardTitle>
                  <CardDescription>
                    Đổi trạng thái trực tiếp tại cột <strong>Trạng thái</strong> khi đơn giao xong hoặc hoàn hàng để kho thành phẩm, bao bì và doanh thu tự tính lại.
                  </CardDescription>
                </CardHeader>
                <CardContent className="max-h-[520px] overflow-auto">
                  {filteredSalesOrders.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Chưa có dòng đơn bán nào khớp bộ lọc / phạm vi đang chọn (có thể ghi đơn mới ở trên hoặc đổi phạm vi sang &ldquo;Toàn bộ lịch sử giao dịch trên CMS&rdquo;).
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Mã đơn</TableHead>
                          <TableHead>Kênh</TableHead>
                          <TableHead>Mã SKU</TableHead>
                          <TableHead className="text-right">SL</TableHead>
                          <TableHead className="text-right">Thành tiền</TableHead>
                          <TableHead className="text-right">Phí + Ship</TableHead>
                          <TableHead className="text-right">Thực nhận</TableHead>
                          <TableHead className="w-40">Trạng thái</TableHead>
                          <TableHead className="text-right">Giá vốn chuẩn</TableHead>
                          <TableHead className="text-right">Lãi gộp</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredSalesOrders.map((so, idx) => {
                            const rowKey = so.id ?? `${so.orderCode}-${idx}`
                            return (
                              <TableRow key={rowKey}>
                                <TableCell className="text-xs tabular-nums">{so.date}</TableCell>
                                <TableCell className="font-mono text-xs font-semibold">
                                  {so.orderCode}
                                </TableCell>
                                <TableCell className="text-xs">{so.channel}</TableCell>
                                <TableCell className="font-mono text-xs" title={so.skuName}>
                                  {so.sku}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{so.qty}</TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatVND(so.grossAmount)}
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground tabular-nums">
                                  {formatVND(so.platformAndVoucherFee + so.sellerShippingPaid)}
                                </TableCell>
                                <TableCell className="text-right font-medium tabular-nums">
                                  {formatVND(so.recognizedNetPayout)}
                                </TableCell>
                                <TableCell>
                                  <Select
                                    value={so.status}
                                    onValueChange={(v) =>
                                      void handleUpdateSalesStatus(
                                        so.id || so.orderCode,
                                        v as SalesOrderRow['status']
                                      )
                                    }
                                    disabled={submitting}
                                  >
                                    <SelectTrigger className="h-7 bg-amber-50/70 text-xs dark:bg-amber-950/30">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {SALES_STATUSES.map((st) => (
                                        <SelectItem key={st} value={st}>
                                          {st}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                                <TableCell className="text-right text-muted-foreground tabular-nums">
                                  {formatVND(so.standardCogs)}
                                </TableCell>
                                <TableCell
                                  className={cn(
                                    'text-right font-semibold tabular-nums',
                                    so.grossProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'
                                  )}
                                >
                                  {formatVND(so.grossProfit)}
                                </TableCell>
                                <TableCell>
                                  {so.source === 'MANUAL' && so.id && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-rose-600"
                                      onClick={() =>
                                        void handleDeleteRow('DELETE_SALES_ORDER', so.id)
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 06. SẢN XUẤT (MẺ ĐÚC) ================= */}
          {activeSheet === '06' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Scale className="h-4 w-4 text-amber-600" />
                    Ghi nhanh Mẻ Đúc / Chiết Đóng Gói kèm Cân Thạch Cao Thực Tế
                  </CardTitle>
                  <CardDescription>
                    Ngoài các Lệnh sản xuất tạo ở phân hệ Kho &amp; BOM, bạn có thể ghi chi tiết SL đổ khuôn, SL lỗi và số gram thạch cao cân thực ({snap.meta.weighedMaterialCode}) tại đây.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                    <div className="space-y-1">
                      <Label className="text-xs">Ngày đúc</Label>
                      <Input
                        type="date"
                        value={prDate}
                        onChange={(e) => setPrDate(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <Label className="text-xs">Mã SKU</Label>
                      <Select value={prSku} onValueChange={setPrSku}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {snap.skus.map((s) => (
                            <SelectItem key={s.sku} value={s.sku}>
                              {s.sku} — {s.name.slice(0, 34)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SL đổ khuôn</Label>
                      <Input
                        type="number"
                        min={1}
                        value={prStarted}
                        onChange={(e) => setPrStarted(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SL đạt</Label>
                      <Input
                        type="number"
                        min={0}
                        value={prGood}
                        onChange={(e) => setPrGood(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Thạch cao cân (g)</Label>
                      <Input
                        type="number"
                        placeholder="Trống = định mức"
                        value={prPlaster}
                        onChange={(e) => setPrPlaster(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => void handleAddProduction()}
                        disabled={submitting}
                        className="h-9 w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                        data-testid="btn-add-production"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Ghi mẻ
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <Input
                      placeholder="Mã mẻ (tuỳ chọn, tự sinh ME-...)"
                      value={prBatchCode}
                      onChange={(e) => setPrBatchCode(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Phút làm thực tế (tuỳ chọn)"
                      type="number"
                      value={prMinutes}
                      onChange={(e) => setPrMinutes(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Người làm"
                      value={prOperator}
                      onChange={(e) => setPrOperator(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Ghi chú lỗi / bọt khí / cải tiến..."
                      value={prNote}
                      onChange={(e) => setPrNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    06. NHẬT KÝ SẢN XUẤT ({filteredProductions.length}/{snap.productions.length} mẻ)
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[420px] overflow-auto">
                  {filteredProductions.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Chưa có mẻ sản xuất nào khớp bộ lọc trong kỳ.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Mã mẻ</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead>Mã SKU</TableHead>
                          <TableHead className="text-right">SL làm</TableHead>
                          <TableHead className="text-right">SL đạt</TableHead>
                          <TableHead className="text-right">% lỗi</TableHead>
                          <TableHead className="text-right">TC cân thực (g)</TableHead>
                          <TableHead className="text-right">TC định mức (g)</TableHead>
                          <TableHead className="text-right">TC trừ kho (g)</TableHead>
                          <TableHead className="text-right">Chênh TC</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredProductions.map((pr, idx) => (
                          <TableRow key={pr.id ?? idx}>
                            <TableCell className="text-xs tabular-nums">{pr.date}</TableCell>
                            <TableCell className="font-mono text-xs">{pr.batchCode}</TableCell>
                            <TableCell className="text-xs">{pr.batchType}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold" title={pr.skuName}>
                              {pr.sku}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{pr.qtyStarted}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {pr.qtyGood}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {fmtPct(pr.defectPct)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {pr.actualPlasterGrams !== null
                                ? `${formatNumber(pr.actualPlasterGrams)} g`
                                : '—'}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground tabular-nums">
                              {formatNumber(pr.standardPlasterGrams)} g
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatNumber(pr.deductedPlasterGrams)} g
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {pr.plasterVarianceGrams !== null
                                ? `${formatNumber(pr.plasterVarianceGrams)} g`
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {pr.source === 'MANUAL' && pr.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-rose-600"
                                  onClick={() => void handleDeleteRow('DELETE_PRODUCTION', pr.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 11. THU / CHI KHÁC (OPEX) ================= */}
          {activeSheet === '11' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="flex flex-col justify-between gap-2 pb-2 sm:flex-row sm:items-center">
                  <div>
                    <CardTitle className="text-base">
                      11. GHI NHẬN THU / CHI KHÁC &amp; OPEX THÁNG
                    </CardTitle>
                    <CardDescription>
                      Tiền bán hàng (07) và mua vật tư (05) đã tự tính — chỉ ghi OPEX, mua dụng cụ, rút tiền hoặc thu khác tại đây.
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleAddCashflow(true)}
                    disabled={submitting}
                    className="border-amber-300 bg-amber-50/70 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                    data-testid="btn-preset-mold-opex"
                  >
                    <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                    + Trích nhanh Quỹ tái đầu tư khuôn (180.000đ)
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <div className="space-y-1">
                      <Label className="text-xs">Ngày</Label>
                      <Input
                        type="date"
                        value={cfDate}
                        onChange={(e) => setCfDate(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Thu / Chi</Label>
                      <Select value={cfFlow} onValueChange={(v) => setCfFlow(v as 'Chi' | 'Thu')}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Chi">Chi</SelectItem>
                          <SelectItem value="Thu">Thu</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <Label className="text-xs">Nhóm khoản mục</Label>
                      <Select value={cfGroup} onValueChange={setCfGroup}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {OPEX_GROUPS.map((g) => (
                            <SelectItem key={g} value={g}>
                              {g}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Số tiền (đ)</Label>
                      <Input
                        type="number"
                        min={1000}
                        step={1000}
                        placeholder="180000"
                        value={cfAmount}
                        onChange={(e) => setCfAmount(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => void handleAddCashflow(false)}
                        disabled={submitting}
                        className="h-9 w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Lưu khoản mục
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Diễn giải chi tiết (VD: Tiền điện xưởng tháng 11, mua cốc đong silicon...)"
                      value={cfDesc}
                      onChange={(e) => setCfDesc(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Ghi chú (tuỳ chọn)"
                      value={cfNote}
                      onChange={(e) => setCfNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    11. DANH SÁCH THU / CHI KHÁC ({filteredCashflows.length}/{snap.otherCashflows.length} khoản)
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {filteredCashflows.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      Chưa có khoản Thu / Chi khác nào khớp bộ lọc.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead>Nhóm</TableHead>
                          <TableHead>Mã CP</TableHead>
                          <TableHead>Diễn giải</TableHead>
                          <TableHead className="text-right">Số tiền</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCashflows.map((cf) => (
                          <TableRow key={cf.id}>
                            <TableCell className="text-xs tabular-nums">{cf.date}</TableCell>
                            <TableCell>
                              <Badge variant={cf.flowType === 'Thu' ? 'default' : 'secondary'}>
                                {cf.flowType}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs font-medium">{cf.group}</TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {cf.planCostCode || '—'}
                            </TableCell>
                            <TableCell className="text-sm">{cf.description}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {formatVND(cf.amount)}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-rose-600"
                                onClick={() => void handleDeleteRow('DELETE_CASHFLOW', cf.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 05. NHẬP HÀNG ================= */}
          {activeSheet === '05' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PackagePlus className="h-4 w-4 text-emerald-600" />
                    Ghi Phiếu Mua Vật Tư Mới (05_Nhap_Hang)
                  </CardTitle>
                  <CardDescription>
                    Nhập SL theo <strong>ĐVT chuẩn</strong> (ví dụ mua bao 25kg thạch cao → nhập <code>25000</code> g). Các hóa đơn mua hàng POSTED ở phân hệ Nhập kho CMS cũng tự động đồng bộ vào bảng dưới.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
                    <div className="space-y-1">
                      <Label className="text-xs">Ngày mua</Label>
                      <Input
                        type="date"
                        value={mhDate}
                        onChange={(e) => setMhDate(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <Label className="text-xs">Mã vật tư</Label>
                      <Select value={mhMatCode} onValueChange={setMhMatCode}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {snap.materials.map((m) => (
                            <SelectItem key={m.code} value={m.code}>
                              {m.code} ({m.unit}) — {m.name.slice(0, 30)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">
                        SL chuẩn ({selectedPurchaseMat?.unit || 'ĐVT'})
                      </Label>
                      <Input
                        type="number"
                        min={0.01}
                        step="any"
                        value={mhQty}
                        onChange={(e) => setMhQty(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Thực trả (gồm ship)</Label>
                      <Input
                        type="number"
                        min={0}
                        step={1000}
                        value={mhTotalPaid}
                        onChange={(e) => setMhTotalPaid(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Nhà cung cấp</Label>
                      <Input
                        value={mhSupplier}
                        onChange={(e) => setMhSupplier(e.target.value)}
                        className="h-9"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => void handleAddPurchase()}
                        disabled={submitting}
                        className="h-9 w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                        data-testid="btn-add-purchase"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Ghi nhập
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Mã đơn / chứng từ mua (tuỳ chọn, tự sinh MH-...)"
                      value={mhDocCode}
                      onChange={(e) => setMhDocCode(e.target.value)}
                      className="h-8 text-xs"
                    />
                    <Input
                      placeholder="Ghi chú quy cách mua (VD: Bao nguyên 25kg + voucher freeship...)"
                      value={mhNote}
                      onChange={(e) => setMhNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    05. NHẬP HÀNG / MUA VẬT TƯ ({filteredPurchases.length}/{snap.purchases.length} dòng)
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[480px] overflow-auto">
                  {filteredPurchases.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Chưa phát sinh dòng mua vật tư khớp bộ lọc sau ngày kiểm kê.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Chứng từ</TableHead>
                          <TableHead>Nhà cung cấp</TableHead>
                          <TableHead>Mã VT</TableHead>
                          <TableHead>Tên VT</TableHead>
                          <TableHead className="text-right">SL chuẩn</TableHead>
                          <TableHead className="text-right">Thực trả</TableHead>
                          <TableHead className="text-right">Đơn giá thực</TableHead>
                          <TableHead className="text-right">Lệch chuẩn</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPurchases.map((p, idx) => (
                          <TableRow key={p.id ?? idx}>
                            <TableCell className="text-xs tabular-nums">{p.date}</TableCell>
                            <TableCell className="font-mono text-xs">{p.docCode}</TableCell>
                            <TableCell className="text-xs">{p.supplier}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">
                              {p.materialCode}
                            </TableCell>
                            <TableCell className="max-w-[220px] truncate text-xs">
                              {p.materialName}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatNumber(p.qtyStandardUnit)} {p.unit}
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {formatVND(p.actualTotalPaid)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {p.actualUnitCost !== null
                                ? formatNumber(Math.round(p.actualUnitCost * 100) / 100)
                                : '—'}
                            </TableCell>
                            <TableCell
                              className={cn(
                                'text-right tabular-nums',
                                p.variancePct !== null &&
                                  Math.abs(p.variancePct) > 0.1 &&
                                  'font-semibold text-amber-600'
                              )}
                            >
                              {fmtPct(p.variancePct)}
                            </TableCell>
                            <TableCell>
                              {p.source === 'MANUAL' && p.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-rose-600"
                                  onClick={() => void handleDeleteRow('DELETE_PURCHASE', p.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 08. ĐIỀU CHỈNH KHO ================= */}
          {activeSheet === '08' && (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ClipboardCheck className="h-4 w-4 text-violet-600" />
                    Ghi Phiếu Điều Chỉnh Kho (08_Dieu_Chinh_Kho)
                  </CardTitle>
                  <CardDescription>
                    SL dương (<code>+</code>) = cộng kho, SL âm (<code>−</code>) = trừ kho (hư hỏng, dùng thử R&amp;D, tặng KOC, đóng sỉ khác định mức, chênh kiểm kê).
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                    <div className="space-y-1">
                      <Label className="text-xs">Ngày</Label>
                      <Input
                        type="date"
                        value={adjDate}
                        onChange={(e) => setAdjDate(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Loại mã</Label>
                      <Select
                        value={adjKind}
                        onValueChange={(v) => {
                          const nextKind = v as 'VT' | 'TP'
                          setAdjKind(nextKind)
                          setAdjCode(
                            nextKind === 'VT'
                              ? (snap.materials[0]?.code ?? 'NVL-001')
                              : (snap.skus[0]?.sku ?? 'BM-DEC-LAMA-LUN')
                          )
                        }}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="VT">VT — Vật tư / Bao bì</SelectItem>
                          <SelectItem value="TP">TP — Thành phẩm SKU</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1 lg:col-span-2">
                      <Label className="text-xs">Mã VT / SKU</Label>
                      <Select value={adjCode} onValueChange={setAdjCode}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {adjKind === 'VT'
                            ? snap.materials.map((m) => (
                                <SelectItem key={m.code} value={m.code}>
                                  {m.code} ({m.unit}) — {m.name.slice(0, 30)}
                                </SelectItem>
                              ))
                            : snap.skus.map((s) => (
                                <SelectItem key={s.sku} value={s.sku}>
                                  {s.sku} — {s.name.slice(0, 32)}
                                </SelectItem>
                              ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">SL (+/−)</Label>
                      <Input
                        type="number"
                        step="any"
                        value={adjDelta}
                        onChange={(e) => setAdjDelta(e.target.value)}
                        className="h-9 bg-amber-50/60 dark:bg-amber-950/25"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        onClick={() => void handleAddAdjustment()}
                        disabled={submitting}
                        className="h-9 w-full bg-[#0066CC] text-white hover:bg-[#0055B3]"
                        data-testid="btn-add-adjustment"
                      >
                        <Plus className="mr-1 h-4 w-4" />
                        Ghi điều chỉnh
                      </Button>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Select value={adjReason} onValueChange={setAdjReason}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ADJUSTMENT_REASONS.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Ghi chú chi tiết (tuỳ chọn)..."
                      value={adjNote}
                      onChange={(e) => setAdjNote(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    08. ĐIỀU CHỈNH KHO ({filteredAdjustments.length}/{snap.adjustments.length} dòng)
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-[460px] overflow-auto">
                  {filteredAdjustments.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      Chưa phát sinh điều chỉnh kho khớp bộ lọc.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Ngày</TableHead>
                          <TableHead>Loại</TableHead>
                          <TableHead>Mã</TableHead>
                          <TableHead>Tên</TableHead>
                          <TableHead className="text-right">SL (+/−)</TableHead>
                          <TableHead>Lý do</TableHead>
                          <TableHead>Ghi chú</TableHead>
                          <TableHead className="w-10" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredAdjustments.map((ad, idx) => (
                          <TableRow key={ad.id ?? idx}>
                            <TableCell className="text-xs tabular-nums">{ad.date}</TableCell>
                            <TableCell className="text-xs font-medium">{ad.kind}</TableCell>
                            <TableCell className="font-mono text-xs font-semibold">
                              {ad.code}
                            </TableCell>
                            <TableCell className="text-xs">{ad.name}</TableCell>
                            <TableCell
                              className={cn(
                                'text-right font-semibold tabular-nums',
                                ad.deltaQty > 0 ? 'text-emerald-600' : 'text-rose-600'
                              )}
                            >
                              {ad.deltaQty > 0 ? `+${formatNumber(ad.deltaQty)}` : formatNumber(ad.deltaQty)}
                            </TableCell>
                            <TableCell className="text-xs">{ad.reason}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{ad.note}</TableCell>
                            <TableCell>
                              {ad.source === 'MANUAL' && ad.id && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-rose-600"
                                  onClick={() => void handleDeleteRow('DELETE_ADJUSTMENT', ad.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ================= 04. TỒN ĐẦU KỲ ================= */}
          {activeSheet === '04' && (
            <Card>
              <CardHeader className="flex flex-col justify-between gap-2 pb-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="text-base">
                    04. TỒN ĐẦU KỲ — KIỂM KÊ LẦN ĐẦU ({filteredOpening.length}/{snap.openingStocks.length} mã)
                  </CardTitle>
                  <CardDescription>
                    Cân/đếm thực tế vật tư &amp; thành phẩm, nhập số vào ô vàng rồi bấm <strong>Chốt kiểm kê</strong>. Chỉ ghi giao dịch ở các sheet khác từ sau ngày kiểm kê ({snap.meta.stocktakeCutoffDate}).
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['ALL', 'UNVERIFIED', 'VT', 'TP'] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant={openingFilter === f ? 'default' : 'outline'}
                      className="h-8 px-2.5 text-xs"
                      onClick={() => setOpeningFilter(f)}
                    >
                      {f === 'ALL'
                        ? 'Tất cả'
                        : f === 'UNVERIFIED'
                          ? `Chưa kiểm kê (${snap.overview.stockAlerts.unverifiedOpeningCount})`
                          : f}
                    </Button>
                  ))}
                  {snap.overview.stockAlerts.unverifiedOpeningCount > 0 && (
                    <Button
                      size="sm"
                      onClick={() => void handleBulkConfirmOpeningStock()}
                      disabled={submitting}
                      className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                      data-testid="btn-bulk-confirm-opening"
                    >
                      <CheckCheck className="mr-1 h-3.5 w-3.5" />
                      Chốt kiểm kê tất cả
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="max-h-[540px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Loại</TableHead>
                      <TableHead>Mã</TableHead>
                      <TableHead>Tên</TableHead>
                      <TableHead className="text-center">ĐVT</TableHead>
                      <TableHead className="w-32 text-right">SL tồn đầu kỳ</TableHead>
                      <TableHead className="w-36 text-center">Ngày kiểm kê</TableHead>
                      <TableHead className="w-48">Tình trạng</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOpening.map((o) => {
                      const key = `${o.kind}:${o.code}`
                      const edit = openingEdits[key] ?? {}
                      const editQty = edit.qty !== undefined ? edit.qty : String(o.openingQty)
                      const editDate = edit.date !== undefined ? edit.date : o.stocktakeDate
                      const editStatus = edit.status !== undefined ? edit.status : o.status
                      const isVerified = o.status === 'Đã kiểm kê'
                      return (
                        <TableRow key={key}>
                          <TableCell className="text-xs font-medium">{o.kind}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{o.code}</TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs" title={o.name}>
                            {o.name}
                          </TableCell>
                          <TableCell className="text-center text-xs">{o.unit}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              value={editQty}
                              onChange={(e) =>
                                setOpeningEdits((prev) => ({
                                  ...prev,
                                  [key]: { ...prev[key], qty: e.target.value },
                                }))
                              }
                              className="ml-auto h-8 w-28 bg-amber-50/80 text-right tabular-nums dark:bg-amber-950/30"
                            />
                          </TableCell>
                          <TableCell className="text-center">
                            <Input
                              type="date"
                              value={editDate}
                              onChange={(e) =>
                                setOpeningEdits((prev) => ({
                                  ...prev,
                                  [key]: { ...prev[key], date: e.target.value },
                                }))
                              }
                              className="h-8 w-34 bg-amber-50/80 text-xs tabular-nums dark:bg-amber-950/30"
                            />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={editStatus}
                              onValueChange={(v) =>
                                setOpeningEdits((prev) => ({
                                  ...prev,
                                  [key]: { ...prev[key], status: v },
                                }))
                              }
                            >
                              <SelectTrigger
                                className={cn(
                                  'h-8 text-xs',
                                  isVerified
                                    ? 'border-emerald-300 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                                    : 'border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                                )}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {OPENING_STATUS_OPTIONS.map((st) => (
                                  <SelectItem key={st} value={st}>
                                    {st}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant={isVerified ? 'outline' : 'default'}
                              className={cn(
                                'h-7 text-xs',
                                !isVerified && 'bg-emerald-600 text-white hover:bg-emerald-700'
                              )}
                              disabled={submitting}
                              onClick={() =>
                                void handleConfirmOpeningStock(
                                  o.kind,
                                  o.code,
                                  o.openingQty,
                                  o.stocktakeDate,
                                  o.note
                                )
                              }
                            >
                              {isVerified ? (
                                <>
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> Lưu lại
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="mr-1 h-3 w-3" /> Chốt kiểm kê
                                </>
                              )}
                            </Button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ================= 01. DANH MỤC VẬT TƯ ================= */}
          {activeSheet === '01' && (
            <Card>
              <CardHeader className="flex flex-col justify-between gap-2 pb-2 lg:flex-row lg:items-center">
                <div>
                  <CardTitle className="text-base">
                    01. DANH MỤC VẬT TƯ CHUẨN ({filteredMaterials.length}/{snap.materials.length} mã)
                  </CardTitle>
                  <CardDescription>
                    Cột A–F copy từ file kế hoạch. Ô vàng <strong>C3</strong> (Mã VT cân thực tế) và cột H <strong>Điểm đặt hàng lại</strong> chỉnh trực tiếp tại đây.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2 rounded-lg border bg-amber-50/70 px-3 py-1.5 dark:bg-amber-950/25">
                  <span className="text-xs font-medium">Mã VT cân thực khi đúc (C3):</span>
                  <Select value={weighedCodeEdit} onValueChange={setWeighedCodeEdit}>
                    <SelectTrigger className="h-7 w-28 bg-background font-mono text-xs font-bold">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {snap.materials
                        .filter((m) => m.code.startsWith('NVL-') || m.code === weighedCodeEdit)
                        .map((m) => (
                          <SelectItem key={m.code} value={m.code}>
                            {m.code}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={submitting}
                    onClick={() => void handleSaveWeighedMaterial()}
                  >
                    <Save className="mr-1 h-3 w-3" /> Lưu C3
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã VT</TableHead>
                      <TableHead>Nhóm VT</TableHead>
                      <TableHead>Tên vật tư</TableHead>
                      <TableHead className="text-center">ĐVT</TableHead>
                      <TableHead className="text-right">Đơn giá chuẩn</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead className="text-right">Nhu cầu KH/tháng</TableHead>
                      <TableHead className="w-40 text-right">Điểm đặt lại (Ô vàng)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredMaterials.map((m) => {
                      const editRp =
                        reorderEdits[m.code] !== undefined
                          ? reorderEdits[m.code]
                          : m.reorderPoint !== null
                            ? String(m.reorderPoint)
                            : ''
                      return (
                        <TableRow key={m.code}>
                          <TableCell className="font-mono text-xs font-semibold">{m.code}</TableCell>
                          <TableCell className="text-xs">{m.group}</TableCell>
                          <TableCell className="text-sm">{m.name}</TableCell>
                          <TableCell className="text-center text-xs">{m.unit}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {m.standardUnitCost !== null
                              ? formatNumber(Math.round(m.standardUnitCost * 10000) / 10000)
                              : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{m.status}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {m.monthlyPlanDemand !== null ? formatNumber(m.monthlyPlanDemand) : '—'}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                min={0}
                                placeholder="—"
                                value={editRp}
                                onChange={(e) =>
                                  setReorderEdits((prev) => ({
                                    ...prev,
                                    [m.code]: e.target.value,
                                  }))
                                }
                                className="h-7 w-24 bg-amber-50/80 text-right text-xs tabular-nums dark:bg-amber-950/30"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Lưu điểm đặt hàng lại"
                                disabled={submitting}
                                onClick={() => void handleSaveReorderPoint(m.code, m.reorderPoint)}
                              >
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ================= 02. DANH MỤC SKU ================= */}
          {activeSheet === '02' && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  02. DANH MỤC SKU ĐANG BÁN &amp; GIÁ CHUẨN ({filteredSkus.length}/{snap.skus.length} SKU)
                </CardTitle>
                <CardDescription>
                  Cột N <strong>Tồn TP tối thiểu</strong> là ô vàng — dưới mức này Sheet 10 báo <code>CẦN ĐÚC / ĐÓNG THÊM</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã SKU</TableHead>
                      <TableHead>Tên SKU</TableHead>
                      <TableHead className="text-center">Nhóm</TableHead>
                      <TableHead className="text-right">Giá vốn chuẩn</TableHead>
                      <TableHead className="text-right">Shopee thực</TableHead>
                      <TableHead className="text-right">Shopee thường</TableHead>
                      <TableHead className="text-right">Giá lẻ Zalo/Web</TableHead>
                      <TableHead className="text-right">Giá sỉ B1</TableHead>
                      <TableHead className="text-right">Giá sỉ B2</TableHead>
                      <TableHead className="text-right">KH Shopee</TableHead>
                      <TableHead className="text-right">KH Lẻ</TableHead>
                      <TableHead className="text-right">KH Sỉ</TableHead>
                      <TableHead className="w-36 text-right">Tồn tối thiểu</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSkus.map((s) => {
                      const editMin =
                        minStockEdits[s.sku] !== undefined
                          ? minStockEdits[s.sku]
                          : String(s.minFinishedStock)
                      return (
                        <TableRow key={s.sku}>
                          <TableCell className="font-mono text-xs font-semibold">{s.sku}</TableCell>
                          <TableCell className="max-w-[240px] truncate text-xs" title={s.name}>
                            {s.name}
                          </TableCell>
                          <TableCell className="text-center text-xs">
                            {s.categoryGroup} · {s.pricingGroup}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(s.standardCost)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.shopeeActualPrice !== null ? formatVND(s.shopeeActualPrice) : '—'}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {s.shopeeRegularPrice !== null ? formatVND(s.shopeeRegularPrice) : '—'}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(s.retailPrice)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatVND(s.wholesaleB1)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">
                            {formatVND(s.wholesaleB2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.planQtyShopee}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.planQtyRetail}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {s.planQtyWholesale}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Input
                                type="number"
                                min={0}
                                value={editMin}
                                onChange={(e) =>
                                  setMinStockEdits((prev) => ({
                                    ...prev,
                                    [s.sku]: e.target.value,
                                  }))
                                }
                                className="h-7 w-18 bg-amber-50/80 text-right text-xs tabular-nums dark:bg-amber-950/30"
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="Lưu tồn tối thiểu"
                                disabled={submitting}
                                onClick={() => void handleSaveMinSkuStock(s.sku, s.minFinishedStock)}
                              >
                                <Save className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* ================= 03. ĐỊNH MỨC BOM ================= */}
          {activeSheet === '03' && (
            <Card>
              <CardHeader className="flex flex-col justify-between gap-2 pb-2 sm:flex-row sm:items-center">
                <div>
                  <CardTitle className="text-base">
                    03. ĐỊNH MỨC CHUẨN / 1 SP ({filteredBom.length}/{snap.bom.length} dòng NVL &amp; Bao bì)
                  </CardTitle>
                  <CardDescription>
                    Dòng <code>NVL</code> trừ khi sản xuất (06), dòng <code>Bao bì</code> trừ khi xuất bán (07).
                  </CardDescription>
                </div>
                <div className="flex items-center gap-1.5">
                  {(['ALL', 'NVL', 'Bao bì'] as const).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={bomKindFilter === k ? 'default' : 'outline'}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => setBomKindFilter(k)}
                    >
                      {k === 'ALL' ? 'Tất cả (240)' : k}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="max-h-[520px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mã SKU</TableHead>
                      <TableHead className="text-center">Loại trừ kho</TableHead>
                      <TableHead>Mã VT</TableHead>
                      <TableHead className="text-right">Định mức / 1 SP</TableHead>
                      <TableHead>Tên vật tư (tự tra)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredBom.map((b, idx) => (
                      <TableRow key={`${b.sku}-${b.kind}-${b.materialCode}-${idx}`}>
                        <TableCell className="font-mono text-xs font-semibold">{b.sku}</TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={b.kind === 'NVL' ? 'default' : 'outline'}
                            className="text-[10px]"
                          >
                            {b.kind}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{b.materialCode}</TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {b.qtyPerUnit}
                        </TableCell>
                        <TableCell className="text-xs">{b.materialName}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Khôi phục Sổ Vận hành Bơ Mộc về mặc định?"
        description="Thao tác này xóa các dòng nhập thủ công trên Sổ Vận hành (mẻ đúc tay, đơn gộp tay, OPEX, điều chỉnh tay) và trả tồn đầu kỳ về mức ước tính gốc. Dữ liệu đơn hàng & kho trên CSDL CMS hoàn toàn không bị ảnh hưởng."
        confirmText="Khôi phục mặc định"
        destructive
        loading={submitting}
        onConfirm={() => void handleResetState()}
      />
    </div>
  )
}
