'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
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
  Info,
  KeyRound,
  Loader2,
  LockKeyhole,
  LockOpen,
  Percent,
  Save,
  Sparkles,
  WifiOff,
} from 'lucide-react'

interface SettingsData {
  company_name: string
  company_tax: string
  company_address: string
  vat_default: string
  geminiConfigured: boolean
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
