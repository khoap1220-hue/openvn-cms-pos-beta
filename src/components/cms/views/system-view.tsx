'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import {
  BadgeCheck,
  BookOpenCheck,
  Building2,
  Database,
  Gem,
  ImageUp,
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  LockOpen,
  Percent,
  ReceiptText,
  Save,
  Sparkles,
  Trash2,
  WifiOff,
} from 'lucide-react'

interface SettingsData {
  company_name: string
  company_tax: string
  company_address: string
  vat_default: string
  geminiConfigured: boolean
  // THIẾT LẬP HÓA ĐƠN — invoice_bank_* có thể vắng mặt ở GET (backend chưa trả) → coi là tùy chọn
  invoice_title: string
  invoice_template_code: string
  invoice_series: string
  invoice_bank_name?: string
  invoice_bank_account?: string
  invoice_bank_holder?: string
  invoice_footer_note: string
  invoice_default_note: string
  invoice_logo: string
}

interface Period {
  year: number
  quarter: number
  status: 'OPEN' | 'CLOSED'
  closedAt: string | null
  note: string | null
}

const FIRST_YEAR = 2024
const CURRENT_YEAR = new Date().getFullYear()
const CURRENT_QUARTER = Math.floor(new Date().getMonth() / 3) + 1
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR + 2 - FIRST_YEAR }, (_, i) => FIRST_YEAR + i)
const VAT_RATES = [0, 5, 8, 10]

export function SystemView() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Form thông tin đơn vị
  const [companyName, setCompanyName] = useState('')
  const [companyTax, setCompanyTax] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [savingCompany, setSavingCompany] = useState(false)

  // Chốt sổ
  const [periodsYear, setPeriodsYear] = useState<number>(CURRENT_YEAR)
  const [periods, setPeriods] = useState<Period[] | null>(null)
  const [periodsLoading, setPeriodsLoading] = useState(true)
  const [closeQuarter, setCloseQuarter] = useState<number | null>(null)
  const [reopenQuarter, setReopenQuarter] = useState<number | null>(null)
  const [periodActionLoading, setPeriodActionLoading] = useState(false)

  // Gemini AI
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savingKey, setSavingKey] = useState(false)
  const [testingAi, setTestingAi] = useState(false)

  // VAT mặc định
  const [vatDefault, setVatDefault] = useState('8')
  const [savingVat, setSavingVat] = useState(false)

  // Thiết lập hóa đơn (mẫu in hóa đơn bán ở module Xuất hàng)
  const [invoiceTitle, setInvoiceTitle] = useState('HÓA ĐƠN BÁN HÀNG')
  const [invoiceTemplateCode, setInvoiceTemplateCode] = useState('01GTKT0/001')
  const [invoiceSeries, setInvoiceSeries] = useState('AA/26E')
  const [invoiceBankName, setInvoiceBankName] = useState('')
  const [invoiceBankAccount, setInvoiceBankAccount] = useState('')
  const [invoiceBankHolder, setInvoiceBankHolder] = useState('')
  const [invoiceFooterNote, setInvoiceFooterNote] = useState('')
  const [invoiceDefaultNote, setInvoiceDefaultNote] = useState('')
  const [invoiceLogo, setInvoiceLogo] = useState('')
  const [savingInvoice, setSavingInvoice] = useState(false)
  const invoiceLogoInputRef = useRef<HTMLInputElement | null>(null)
  // GET /api/settings hiện CHƯA trả invoice_bank_* (đã lưu DB nhưng thiếu ở response).
  // Chỉ gửi lên PATCH những trường bank mà (a) GET đã trả về hoặc (b) người dùng vừa sửa —
  // tránh việc bấm Lưu vô tình xóa sạch giá trị bank đã lưu trước đó.
  const bankKnownRef = useRef<Set<string>>(new Set())
  const bankDirtyRef = useRef<Set<string>>(new Set())
  const { toast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<SettingsData>('/api/settings')
      setSettings(res)
      setCompanyName(res.company_name)
      setCompanyTax(res.company_tax)
      setCompanyAddress(res.company_address)
      setVatDefault(String(Number(res.vat_default) || 8))
      // Thiết lập hóa đơn — thiếu key (vd invoice_bank_*) → giữ giá trị mặc định rỗng
      setInvoiceTitle(res.invoice_title || 'HÓA ĐƠN BÁN HÀNG')
      setInvoiceTemplateCode(res.invoice_template_code || '01GTKT0/001')
      setInvoiceSeries(res.invoice_series || 'AA/26E')
      setInvoiceBankName(res.invoice_bank_name ?? '')
      setInvoiceBankAccount(res.invoice_bank_account ?? '')
      setInvoiceBankHolder(res.invoice_bank_holder ?? '')
      bankKnownRef.current = new Set(
        (['invoice_bank_name', 'invoice_bank_account', 'invoice_bank_holder'] as const).filter(
          (key) => res[key] !== undefined
        )
      )
      bankDirtyRef.current = new Set()
      setInvoiceFooterNote(res.invoice_footer_note ?? '')
      setInvoiceDefaultNote(res.invoice_default_note ?? '')
      setInvoiceLogo(res.invoice_logo ?? '')
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải cấu hình hệ thống'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true)
    try {
      const res = await apiGet<{ year: number; periods: Period[] }>(`/api/periods?year=${periodsYear}`)
      setPeriods(res.periods)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải kỳ kế toán'
      toast({ title: 'Lỗi tải kỳ kế toán', description: message, variant: 'destructive' })
    } finally {
      setPeriodsLoading(false)
    }
  }, [periodsYear, toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadPeriods()
  }, [loadPeriods])

  const saveCompany = async () => {
    setSavingCompany(true)
    try {
      const res = await apiPatch<SettingsData>('/api/settings', {
        company_name: companyName.trim(),
        company_tax: companyTax.trim(),
        company_address: companyAddress.trim(),
      })
      setSettings(res)
      toast({ title: 'Đã lưu thông tin đơn vị', description: 'Thông tin sẽ dùng cho header hóa đơn.' })
    } catch (e) {
      toast({
        title: 'Lưu thông tin thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingCompany(false)
    }
  }

  /** Chọn logo từ máy — chỉ đọc thành data URL và xem trước, KHÔNG upload; chỉ PATCH khi bấm Lưu */
  const handleLogoFile = (file: File | undefined) => {
    if (!file) return
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) {
      toast({
        title: 'Định dạng logo không hợp lệ',
        description: 'Chỉ hỗ trợ ảnh PNG, JPG, WebP hoặc GIF.',
        variant: 'destructive',
      })
      return
    }
    if (file.size > 400 * 1024) {
      toast({ title: 'Logo quá lớn', description: 'Dung lượng tối đa 400KB — hãy nén ảnh trước khi tải lên.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/') || dataUrl.length > 600000) {
        toast({ title: 'Không đọc được ảnh logo', description: 'Ảnh lỗi hoặc vượt giới hạn 600.000 ký tự data URL.', variant: 'destructive' })
        return
      }
      setInvoiceLogo(dataUrl)
      toast({ title: 'Đã chọn logo', description: 'Nhớ bấm "Lưu thiết lập hóa đơn" để áp dụng.' })
    }
    reader.onerror = () => {
      toast({ title: 'Không đọc được tệp logo', variant: 'destructive' })
    }
    reader.readAsDataURL(file)
  }

  const saveInvoiceSettings = async () => {
    setSavingInvoice(true)
    try {
      const body: Record<string, string> = {
        invoice_title: invoiceTitle.trim() || 'HÓA ĐƠN BÁN HÀNG',
        invoice_template_code: invoiceTemplateCode.trim(),
        invoice_series: invoiceSeries.trim(),
        invoice_footer_note: invoiceFooterNote.trim(),
        invoice_default_note: invoiceDefaultNote.trim(),
        invoice_logo: invoiceLogo,
      }
      const bankValues: Record<string, string> = {
        invoice_bank_name: invoiceBankName.trim(),
        invoice_bank_account: invoiceBankAccount.trim(),
        invoice_bank_holder: invoiceBankHolder.trim(),
      }
      for (const [key, value] of Object.entries(bankValues)) {
        if (bankKnownRef.current.has(key) || bankDirtyRef.current.has(key)) body[key] = value
      }
      const res = await apiPatch<SettingsData>('/api/settings', body)
      setSettings(res)
      setInvoiceLogo(res.invoice_logo ?? invoiceLogo)
      toast({
        title: 'Đã lưu thiết lập hóa đơn',
        description: 'Bản in hóa đơn bán ở module Xuất hàng sẽ dùng cấu hình mới.',
      })
    } catch (e) {
      toast({
        title: 'Lưu thiết lập hóa đơn thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingInvoice(false)
    }
  }

  const saveApiKey = async () => {
    if (!apiKeyInput.trim()) {
      toast({ title: 'Vui lòng nhập API Key', description: 'Lấy key tại Google AI Studio.', variant: 'destructive' })
      return
    }
    setSavingKey(true)
    try {
      const res = await apiPatch<SettingsData>('/api/settings', { gemini_api_key: apiKeyInput.trim() })
      setSettings(res)
      setApiKeyInput('')
      toast({ title: 'Đã lưu Gemini API Key', description: 'Có thể dùng "Phân tích chuyên sâu AI" ở Bảng điều khiển.' })
    } catch (e) {
      toast({
        title: 'Lưu API Key thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingKey(false)
    }
  }

  const testAi = async () => {
    setTestingAi(true)
    try {
      const res = await apiPost<{ cashForecast: string }>('/api/ai-analysis', {
        year: CURRENT_YEAR,
        quarter: CURRENT_QUARTER,
      })
      toast({
        title: `AI hoạt động tốt — Q${CURRENT_QUARTER}/${CURRENT_YEAR}`,
        description: res.cashForecast.slice(0, 200),
      })
    } catch (e) {
      toast({
        title: 'Kiểm tra AI thất bại',
        description: e instanceof Error ? e.message : 'AI không phản hồi',
        variant: 'destructive',
      })
    } finally {
      setTestingAi(false)
    }
  }

  const changeVatDefault = async (value: string) => {
    setVatDefault(value)
    setSavingVat(true)
    try {
      const res = await apiPatch<SettingsData>('/api/settings', { vat_default: Number(value) })
      setSettings(res)
      toast({ title: 'Đã lưu VAT mặc định', description: `Hóa đơn mới mặc định thuế suất ${value}%.` })
    } catch (e) {
      toast({
        title: 'Lưu VAT mặc định thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingVat(false)
    }
  }

  const handlePeriodAction = async (action: 'CLOSE' | 'REOPEN', q: number) => {
    setPeriodActionLoading(true)
    try {
      await apiPost<{ period: Period }>('/api/periods', { action, year: periodsYear, quarter: q })
      toast({
        title: action === 'CLOSE' ? `Đã chốt sổ Q${q}/${periodsYear}` : `Đã mở lại sổ Q${q}/${periodsYear}`,
        description:
          action === 'CLOSE'
            ? 'Mọi hóa đơn & biến động kho trong kỳ này đã bị khóa.'
            : 'Kỳ đã mở lại — có thể thêm/sửa/hủy hóa đơn bình thường.',
      })
      await loadPeriods()
    } catch (e) {
      toast({
        title: 'Thao tác kỳ kế toán thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setPeriodActionLoading(false)
      setCloseQuarter(null)
      setReopenQuarter(null)
    }
  }

  const currentQuarterPeriod = useMemo(
    () => (periods ?? []).find((p) => p.quarter === CURRENT_QUARTER && p.year === CURRENT_YEAR) ?? null,
    [periods]
  )
  const currentQuarterClosed = currentQuarterPeriod?.status === 'CLOSED'

  return (
    <div>
      <PageHeader
        title="Hệ thống"
        description="Thông tin đơn vị, kỳ kế toán, AI và giá trị mặc định của Invoice Pro"
      />

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Thông tin đơn vị */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="h-5 w-5 text-sky-500" />
                Thông tin đơn vị
              </CardTitle>
              <CardDescription>Hiển thị trên header hóa đơn bán và báo cáo hạch toán</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <TableSkeleton rows={3} />
              ) : (
                <>
                  <div className="grid gap-2">
                    <Label htmlFor="company-name">Tên đơn vị</Label>
                    <Input
                      id="company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="CÔNG TY TNHH THƯƠNG MẠI ABC"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="company-tax">Mã số thuế</Label>
                    <Input
                      id="company-tax"
                      value={companyTax}
                      onChange={(e) => setCompanyTax(e.target.value)}
                      placeholder="0312345678 (10 số) hoặc 0312345678-001 (13 số)"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="company-address">Địa chỉ</Label>
                    <Input
                      id="company-address"
                      value={companyAddress}
                      onChange={(e) => setCompanyAddress(e.target.value)}
                      placeholder="123 Nguyễn Trãi, Q.1, TP. Hồ Chí Minh"
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button onClick={() => void saveCompany()} disabled={savingCompany}>
                      {savingCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Lưu thông tin
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Thiết lập hóa đơn — áp dụng cho bản in ở module Xuất hàng */}
          <Card className="border-border/70 shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ReceiptText className="h-5 w-5 text-emerald-500" />
                Thiết lập hóa đơn
              </CardTitle>
              <CardDescription>
                Tiêu đề, mẫu số, ký hiệu, thông tin ngân hàng và ghi chú hiển thị trên bản in hóa đơn bán GTGT
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <TableSkeleton rows={4} />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-title">Tiêu đề hóa đơn</Label>
                      <Input
                        id="invoice-title"
                        value={invoiceTitle}
                        onChange={(e) => setInvoiceTitle(e.target.value)}
                        placeholder="HÓA ĐƠN BÁN HÀNG"
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-template-code">Mẫu số</Label>
                      <Input
                        id="invoice-template-code"
                        value={invoiceTemplateCode}
                        onChange={(e) => setInvoiceTemplateCode(e.target.value)}
                        placeholder="01GTKT0/001"
                        maxLength={60}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-series">Ký hiệu</Label>
                      <Input
                        id="invoice-series"
                        value={invoiceSeries}
                        onChange={(e) => setInvoiceSeries(e.target.value)}
                        placeholder="AA/26E"
                        maxLength={40}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-bank-name">Tên ngân hàng</Label>
                      <Input
                        id="invoice-bank-name"
                        value={invoiceBankName}
                        onChange={(e) => {
                          setInvoiceBankName(e.target.value)
                          bankDirtyRef.current.add('invoice_bank_name')
                        }}
                        placeholder="Vietcombank — CN Tân Bình"
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-bank-account">Số tài khoản</Label>
                      <Input
                        id="invoice-bank-account"
                        value={invoiceBankAccount}
                        onChange={(e) => {
                          setInvoiceBankAccount(e.target.value)
                          bankDirtyRef.current.add('invoice_bank_account')
                        }}
                        placeholder="0071000123456"
                        maxLength={60}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-bank-holder">Chủ tài khoản</Label>
                      <Input
                        id="invoice-bank-holder"
                        value={invoiceBankHolder}
                        onChange={(e) => {
                          setInvoiceBankHolder(e.target.value)
                          bankDirtyRef.current.add('invoice_bank_holder')
                        }}
                        placeholder="CÔNG TY TNHH THƯƠNG MẠI ABC"
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-footer-note">Ghi chú cuối hóa đơn</Label>
                      <Textarea
                        id="invoice-footer-note"
                        rows={2}
                        value={invoiceFooterNote}
                        onChange={(e) => setInvoiceFooterNote(e.target.value)}
                        placeholder="Cảm ơn Quý khách đã mua hàng!"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-default-note">Ghi chú mặc định khi tạo hóa đơn</Label>
                      <Textarea
                        id="invoice-default-note"
                        rows={2}
                        value={invoiceDefaultNote}
                        onChange={(e) => setInvoiceDefaultNote(e.target.value)}
                        placeholder="Ví dụ: Hàng đã giao đủ — bảo hành 12 tháng"
                      />
                    </div>
                  </div>

                  {/* Logo in trên hóa đơn — chỉ đọc trước, lưu khi bấm Lưu thiết lập */}
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 p-3">
                    {invoiceLogo ? (
                      <img
                        src={invoiceLogo}
                        alt="Logo hóa đơn"
                        className="h-12 w-12 rounded-md border bg-white object-contain p-0.5"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                        <ImageUp className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-[200px] flex-1">
                      <p className="text-sm font-medium">Logo in trên hóa đơn</p>
                      <p className="text-xs text-muted-foreground">
                        PNG/JPG/WebP/GIF, tối đa 400KB — chỉ được lưu khi bấm &quot;Lưu thiết lập hóa đơn&quot;.
                      </p>
                    </div>
                    <input
                      ref={invoiceLogoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => {
                        handleLogoFile(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => invoiceLogoInputRef.current?.click()}
                    >
                      <ImageUp className="h-4 w-4" />
                      Tải logo
                    </Button>
                    {invoiceLogo && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setInvoiceLogo('')}
                      >
                        <Trash2 className="h-4 w-4" />
                        Xóa logo
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      Áp dụng cho bản in hóa đơn bán ở module Xuất hàng.
                    </p>
                    <Button onClick={() => void saveInvoiceSettings()} disabled={savingInvoice}>
                      {savingInvoice ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Lưu thiết lập hóa đơn
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Chốt sổ kế toán */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <BookOpenCheck className="h-5 w-5 text-emerald-500" />
                  Chốt sổ kế toán
                </span>
                {currentQuarterClosed && (
                  <Badge className="border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                    <LockKeyhole className="h-3 w-3" />
                    Q{CURRENT_QUARTER}/{CURRENT_YEAR} đã chốt
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Sau khi chốt, mọi hóa đơn & biến động kho trong quý sẽ bị khóa — không thể thêm/sửa/hủy
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={String(periodsYear)} onValueChange={(value) => setPeriodsYear(Number(value))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_OPTIONS.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      Năm {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {periodsLoading ? (
                <TableSkeleton rows={4} />
              ) : (
                <div className="overflow-hidden rounded-xl border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kỳ</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Chốt lúc</TableHead>
                        <TableHead className="text-right">Thao tác</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[1, 2, 3, 4].map((q) => {
                        const period = (periods ?? []).find((p) => p.quarter === q)
                        const closed = period?.status === 'CLOSED'
                        return (
                          <TableRow key={q}>
                            <TableCell className="whitespace-nowrap font-medium">
                              Quý {q}/{periodsYear}
                            </TableCell>
                            <TableCell>
                              {closed ? (
                                <Badge className="border-transparent bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                                  <LockKeyhole className="h-3 w-3" />
                                  ĐÃ CHỐT
                                </Badge>
                              ) : (
                                <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                  ĐANG MỞ
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                              {period?.closedAt ? formatDateTime(period.closedAt) : '—'}
                            </TableCell>
                            <TableCell className="text-right">
                              {closed ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setReopenQuarter(q)}
                                  disabled={periodActionLoading}
                                >
                                  <LockOpen className="h-4 w-4" />
                                  Mở lại
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCloseQuarter(q)}
                                  disabled={periodActionLoading}
                                >
                                  <LockKeyhole className="h-4 w-4" />
                                  Chốt sổ
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

          {/* Gemini AI — card nền tối */}
          <Card className="border-slate-800 bg-slate-900 text-slate-100 lg:col-span-2 dark:bg-slate-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Gem className="h-5 w-5 text-sky-400" />
                Gemini AI
              </CardTitle>
              <CardDescription className="text-slate-400">
                API Key dùng cho &quot;Phân tích chuyên sâu AI&quot; — dự báo dòng tiền, cảnh báo tồn kho, chiến lược lợi
                nhuận. Key đã lưu không bao giờ hiển thị lại.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <Label htmlFor="gemini-key" className="text-slate-300">
                    Gemini API Key
                  </Label>
                  <div className="relative mt-1.5">
                    <KeyRound className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      id="gemini-key"
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder={
                        settings?.geminiConfigured ? '•••••••••••••••• (đã lưu)' : 'AIza... dán API Key vào đây'
                      }
                      className="border-slate-700 bg-slate-800 pl-8 text-slate-100 placeholder:text-slate-500"
                    />
                  </div>
                </div>
                <Button
                  onClick={() => void saveApiKey()}
                  disabled={savingKey || !apiKeyInput.trim()}
                  className="bg-white text-slate-900 hover:bg-slate-200"
                >
                  {savingKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Lưu key
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void testAi()}
                  disabled={testingAi}
                  className="border-slate-700 bg-transparent text-slate-200 hover:bg-slate-800 hover:text-white"
                >
                  {testingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  Kiểm tra AI
                </Button>
                {settings?.geminiConfigured && (
                  <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400">
                    <BadgeCheck className="h-3 w-3" />
                    Đã cấu hình
                  </Badge>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Kiểm tra AI sẽ chạy phân tích nhanh cho kỳ hiện tại Q{CURRENT_QUARTER}/{CURRENT_YEAR} và hiển thị đoạn
                xem trước 200 ký tự của dự báo dòng tiền.
              </p>
            </CardContent>
          </Card>

          {/* Giá trị mặc định */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Percent className="h-5 w-5 text-sky-500" />
                Giá trị mặc định
              </CardTitle>
              <CardDescription>Áp dụng cho hóa đơn mới tạo ở module Nhập hàng / Xuất hàng</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
              ) : (
                <div className="flex items-center gap-3">
                  <Select value={vatDefault} onValueChange={(value) => void changeVatDefault(value)}>
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_RATES.map((rate) => (
                        <SelectItem key={rate} value={String(rate)}>
                          VAT {rate}%
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {savingVat && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <p className="text-xs text-muted-foreground">Thuế suất VAT điền sẵn khi tạo hóa đơn</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Về hệ thống */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Info className="h-5 w-5 text-violet-500" />
                Về hệ thống
              </CardTitle>
              <CardDescription>Hệ thống Quản trị Hạch toán Nội bộ & Quản lý Hóa đơn AI</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  <span className="font-medium">OmniSales + Invoice Pro</span> — CMS bán hàng đa kênh tích hợp hạch toán
                  nội bộ, quản lý hóa đơn mua/bán và định mức BOM trong một ứng dụng duy nhất.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  <span className="font-medium">Offline-first</span> — dữ liệu mặt hàng & khách hàng lưu tại máy, hoạt
                  động cả khi mất mạng và đồng bộ khi có kết nối.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  <span className="font-medium">Sổ Data</span> — mọi thao tác (đơn hàng, kho, hóa đơn, chốt sổ, cấu
                  hình...) đều ghi nhật ký bất biến phục vụ truy vết và đối soát.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <BookOpenCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p>
                  <span className="font-medium">Chốt sổ theo quý</span> — khóa dữ liệu kế toán từng kỳ, bảo đảm số liệu
                  báo cáo không bị thay đổi sau khi phát hành.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirm chốt sổ */}
      <ConfirmDialog
        open={closeQuarter !== null}
        onOpenChange={(open) => !open && setCloseQuarter(null)}
        title={`Chốt sổ Quý ${closeQuarter ?? ''}/${periodsYear}?`}
        description={`Sau khi chốt, mọi hóa đơn & biến động kho trong quý ${closeQuarter ?? ''}/${periodsYear} sẽ bị khóa, không thể thêm/sửa/hủy. Cần mở lại sổ nếu muốn thay đổi.`}
        confirmText="Chốt sổ"
        destructive
        loading={periodActionLoading}
        onConfirm={() => closeQuarter !== null && void handlePeriodAction('CLOSE', closeQuarter)}
      />

      {/* Confirm mở lại sổ */}
      <ConfirmDialog
        open={reopenQuarter !== null}
        onOpenChange={(open) => !open && setReopenQuarter(null)}
        title={`Mở lại sổ Quý ${reopenQuarter ?? ''}/${periodsYear}?`}
        description="Kỳ sẽ mở lại hoàn toàn — có thể thêm/sửa/hủy hóa đơn và biến động kho trong kỳ này."
        confirmText="Mở lại sổ"
        loading={periodActionLoading}
        onConfirm={() => reopenQuarter !== null && void handlePeriodAction('REOPEN', reopenQuarter)}
      />
    </div>
  )
}
