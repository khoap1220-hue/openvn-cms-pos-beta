'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiGet, apiPatch, apiPost } from '@/lib/api'
import { trackClientBehavior } from '@/lib/behavior-client'
import { formatDateTime } from '@/lib/format'
import type { ViewId } from '@/components/cms/app-sidebar'
import { ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
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
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Building2,
  Database,
  Download,
  FolderKanban,
  Gem,
  ImageUp,
  Info,
  KeyRound,
  Layers,
  Loader2,
  LockKeyhole,
  LockOpen,
  LogOut,
  Percent,
  ReceiptText,
  Rocket,
  Save,
  Scale,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Users,
  WifiOff,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SystemCatalogSettings, type CatalogSettingsSubTab } from '@/components/cms/views/system-catalog-settings'
import {
  DEFAULT_SHOP_PROFILE,
  SHOP_PROFILE_PRESETS,
  extractShopProfileFromSettings,
  writeShopProfileCache,
} from '@/lib/shop-profile'

export type SystemSectionTab = 'CATALOG_MASTER' | 'COMPANY_INVOICE' | 'SECURITY_AI_DATA' | 'ALL'

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
  invoice_bank_code?: string
  invoice_footer_note: string
  invoice_default_note: string
  invoice_logo: string
  // Trường mới từ Task 20-a — GET luôn trả nhưng giữ optional phòng backend cũ
  company_phone?: string
  invoice_number_start?: string
  invoice_payment_method?: string
  // Thiết lập Thương hiệu & Tùy biến theo từng Shop
  brand_name?: string
  brand_short_name?: string
  brand_badge?: string
  brand_subtitle?: string
  brand_footer_tagline?: string
  shop_default_workshop?: string
  shop_workshop_presets?: string
  shop_default_warehouse_label?: string
  shop_storefront_url?: string
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

/** Giá trị "chưa chọn" của Select mã ngân hàng (Radix Select không nhận SelectItem value rỗng) */
const BANK_CODE_EMPTY = '__none__'

/** Mã ngân hàng phổ biến cho VietQR — value = mã ngắn img.vietqr.io (đã verify trả ảnh HTTP 200) */
const BANK_CODE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'VCB', label: 'VCB — Vietcombank' },
  { code: 'MB', label: 'MB — MB Bank' },
  { code: 'TCB', label: 'TCB — Techcombank' },
  { code: 'ICB', label: 'ICB — VietinBank' },
  { code: 'BIDV', label: 'BIDV' },
  { code: 'ACB', label: 'ACB' },
  { code: 'VPB', label: 'VPB — VPBank' },
  { code: 'STB', label: 'STB — Sacombank' },
  { code: 'SHB', label: 'SHB' },
  { code: 'HDB', label: 'HDB — HDBank' },
  { code: 'MSB', label: 'MSB — Maritime Bank' },
  { code: 'OCB', label: 'OCB' },
  { code: 'TPB', label: 'TPB — TPBank' },
  { code: 'VIB', label: 'VIB' },
  { code: 'SEAB', label: 'SEAB — SeABank' },
  { code: 'LPB', label: 'LPB — LienVietPostBank' },
  { code: 'VBA', label: 'VBA — Agribank' },
]

export function SystemView({
  onNavigate,
  initialSection = 'CATALOG_MASTER',
  initialCatalogSubTab = 'CATEGORIES',
  onSectionChange,
}: {
  onNavigate?: (view: ViewId) => void
  initialSection?: SystemSectionTab
  initialCatalogSubTab?: CatalogSettingsSubTab
  onSectionChange?: (section: SystemSectionTab) => void
} = {}) {
  const router = useRouter()
  const [activeSection, setActiveSectionState] = useState<SystemSectionTab>(initialSection)
  const setActiveSection = (next: SystemSectionTab) => {
    setActiveSectionState(next)
    onSectionChange?.(next)
  }
  const [catalogSubTab, setCatalogSubTab] = useState<CatalogSettingsSubTab>(initialCatalogSubTab)
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setActiveSectionState(initialSection)
  }, [initialSection])

  useEffect(() => {
    setCatalogSubTab(initialCatalogSubTab)
  }, [initialCatalogSubTab])

  // Form thông tin đơn vị
  const [companyName, setCompanyName] = useState('')
  const [companyTax, setCompanyTax] = useState('')
  const [companyAddress, setCompanyAddress] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [savingCompany, setSavingCompany] = useState(false)

  // Thiết lập Thương hiệu & Tùy biến theo từng Shop (Sidebar, Topbar, Xưởng SX, Kho mặc định)
  const [brandName, setBrandName] = useState(DEFAULT_SHOP_PROFILE.brandName)
  const [brandShortName, setBrandShortName] = useState(DEFAULT_SHOP_PROFILE.brandShortName)
  const [brandBadge, setBrandBadge] = useState(DEFAULT_SHOP_PROFILE.brandBadge)
  const [brandSubtitle, setBrandSubtitle] = useState(DEFAULT_SHOP_PROFILE.brandSubtitle)
  const [brandFooterTagline, setBrandFooterTagline] = useState(DEFAULT_SHOP_PROFILE.brandFooterTagline)
  const [defaultWorkshopName, setDefaultWorkshopName] = useState(DEFAULT_SHOP_PROFILE.defaultWorkshopName)
  const [workshopPresetsInput, setWorkshopPresetsInput] = useState(
    DEFAULT_SHOP_PROFILE.workshopPresets.join(', ')
  )
  const [defaultWarehouseLabel, setDefaultWarehouseLabel] = useState(
    DEFAULT_SHOP_PROFILE.defaultWarehouseLabel
  )
  const [storefrontUrl, setStorefrontUrl] = useState(DEFAULT_SHOP_PROFILE.storefrontUrl)
  const [savingBrand, setSavingBrand] = useState(false)

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

  // Bảo mật & Đăng nhập
  const [authRequired, setAuthRequired] = useState(false)
  const [hasCustomPassword, setHasCustomPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  // Go-Live Reset (Làm sạch dữ liệu mẫu)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetConfirmCode, setResetConfirmCode] = useState('')
  const [resetClearCustomers, setResetClearCustomers] = useState(false)
  const [resetStockZero, setResetStockZero] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // Thiết lập hóa đơn (mẫu in hóa đơn bán ở module Xuất hàng + hóa đơn mua ở module Nhập hàng)
  const [invoiceTitle, setInvoiceTitle] = useState('HÓA ĐƠN BÁN HÀNG')
  const [invoiceTemplateCode, setInvoiceTemplateCode] = useState('01GTKT0/001')
  const [invoiceSeries, setInvoiceSeries] = useState('AA/26E')
  const [invoiceNumberStart, setInvoiceNumberStart] = useState('1')
  const [invoicePaymentMethod, setInvoicePaymentMethod] = useState('Tiền mặt / Chuyển khoản')
  const [invoiceBankName, setInvoiceBankName] = useState('')
  const [invoiceBankAccount, setInvoiceBankAccount] = useState('')
  const [invoiceBankHolder, setInvoiceBankHolder] = useState('')
  const [invoiceBankCode, setInvoiceBankCode] = useState('')
  // URL VietQR xem trước vừa lỗi tải — null = chưa lỗi; đổi mã ngân hàng/số TK/chủ TK → URL mới → tự thử lại
  const [qrPreviewFailedUrl, setQrPreviewFailedUrl] = useState<string | null>(null)
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
      setCompanyPhone(res.company_phone ?? '')
      setVatDefault(String(Number(res.vat_default) || 8))
      // Thiết lập hóa đơn — thiếu key (vd invoice_bank_*) → giữ giá trị mặc định rỗng
      setInvoiceTitle(res.invoice_title || 'HÓA ĐƠN BÁN HÀNG')
      setInvoiceTemplateCode(res.invoice_template_code || '01GTKT0/001')
      setInvoiceSeries(res.invoice_series || 'AA/26E')
      setInvoiceNumberStart(res.invoice_number_start ?? '1')
      setInvoicePaymentMethod(res.invoice_payment_method ?? 'Tiền mặt / Chuyển khoản')
      setInvoiceBankName(res.invoice_bank_name ?? '')
      setInvoiceBankAccount(res.invoice_bank_account ?? '')
      setInvoiceBankHolder(res.invoice_bank_holder ?? '')
      setInvoiceBankCode(res.invoice_bank_code ?? '')
      bankKnownRef.current = new Set(
        (['invoice_bank_name', 'invoice_bank_account', 'invoice_bank_holder', 'invoice_bank_code'] as const).filter(
          (key) => res[key] !== undefined
        )
      )
      bankDirtyRef.current = new Set()
      setInvoiceFooterNote(res.invoice_footer_note ?? '')
      setInvoiceDefaultNote(res.invoice_default_note ?? '')
      setInvoiceLogo(res.invoice_logo ?? '')
      // Thiết lập Thương hiệu & Tùy biến theo từng Shop
      const parsedProfile = extractShopProfileFromSettings(res as unknown as Record<string, unknown>)
      setBrandName(parsedProfile.brandName)
      setBrandShortName(parsedProfile.brandShortName)
      setBrandBadge(parsedProfile.brandBadge)
      setBrandSubtitle(parsedProfile.brandSubtitle)
      setBrandFooterTagline(parsedProfile.brandFooterTagline)
      setDefaultWorkshopName(parsedProfile.defaultWorkshopName)
      setWorkshopPresetsInput(parsedProfile.workshopPresets.join(', '))
      setDefaultWarehouseLabel(parsedProfile.defaultWarehouseLabel)
      setStorefrontUrl(parsedProfile.storefrontUrl)
      writeShopProfileCache(parsedProfile)
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
    void apiGet<{ authRequired: boolean; hasCustomPassword: boolean }>('/api/auth')
      .then((res) => {
        setAuthRequired(Boolean(res.authRequired))
        setHasCustomPassword(Boolean(res.hasCustomPassword))
      })
      .catch(() => null)
  }, [load])

  const handleToggleAuthRequired = async (checked: boolean) => {
    setAuthRequired(checked)
    try {
      await apiPatch('/api/auth', { authRequired: checked })
      toast({
        title: checked ? 'Đã bật khóa mật khẩu khi vào CMS' : 'Đã tắt khóa mật khẩu tự động',
        description: checked
          ? 'Mọi truy cập mới sẽ cần nhập mật khẩu quản trị tại /login.'
          : 'Truy cập nội bộ không cần đăng nhập lại.',
      })
    } catch (e) {
      setAuthRequired(!checked)
      toast({
        title: 'Không thể cập nhật chính sách bảo mật',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    }
  }

  const handleSavePassword = async () => {
    if (newPassword.trim().length < 4) {
      toast({ title: 'Mật khẩu quá ngắn', description: 'Mật khẩu mới phải từ 4 ký tự trở lên.', variant: 'destructive' })
      return
    }
    setSavingPassword(true)
    try {
      await apiPatch('/api/auth', {
        currentPassword: currentPassword.trim(),
        newPassword: newPassword.trim(),
      })
      setHasCustomPassword(true)
      setAuthRequired(true)
      setCurrentPassword('')
      setNewPassword('')
      toast({
        title: 'Đã cập nhật mật khẩu Quản trị viên',
        description: 'Mật khẩu mới đã có hiệu lực và chế độ bảo vệ đăng nhập đã được bật.',
      })
    } catch (e) {
      toast({
        title: 'Đổi mật khẩu thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng kiểm tra lại mật khẩu hiện tại',
        variant: 'destructive',
      })
    } finally {
      setSavingPassword(false)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', { method: 'DELETE' })
      router.push('/login')
    } catch {
      router.push('/login')
    }
  }

  const handleDownloadBackup = () => {
    trackClientBehavior({
      category: 'EXPORT',
      action: 'DATA_EXPORT',
      module: 'system',
      summary: 'Tải bản sao lưu cơ sở dữ liệu SQLite (.db)',
    })
    window.open('/api/system/backup', '_blank')
    toast({
      title: 'Đang tải bản sao lưu Database (.db)',
      description: 'Tệp sao lưu SQLite đã được xuất về máy tính của bạn.',
    })
  }

  const handleGoLiveReset = async () => {
    if (resetConfirmCode.trim().toUpperCase() !== 'GO-LIVE') {
      toast({
        title: 'Mã xác nhận chưa đúng',
        description: 'Vui lòng nhập chính xác chữ GO-LIVE để xác nhận.',
        variant: 'destructive',
      })
      return
    }
    setResetLoading(true)
    try {
      const res = await apiPost<{ message: string; cleared: { orders: number; shipments: number } }>('/api/system/reset', {
        confirmCode: resetConfirmCode.trim(),
        clearCustomers: resetClearCustomers,
        resetStockZero,
      })
      setResetDialogOpen(false)
      setResetConfirmCode('')
      toast({
        title: 'Hệ thống đã sẵn sàng Vận hành Thực tế!',
        description: `${res.message} (Đã dọn ${res.cleared.orders} đơn mẫu & ${res.cleared.shipments} vận đơn mẫu).`,
      })
      void loadPeriods()
    } catch (e) {
      toast({
        title: 'Không thể làm sạch dữ liệu mẫu',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setResetLoading(false)
    }
  }

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
        company_phone: companyPhone.trim(),
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

  const saveShopBranding = async () => {
    const cleanBrandName = brandName.trim() || DEFAULT_SHOP_PROFILE.brandName
    const cleanShortName = brandShortName.trim() || DEFAULT_SHOP_PROFILE.brandShortName
    const cleanBadge = brandBadge.trim()
    const cleanSubtitle = brandSubtitle.trim() || DEFAULT_SHOP_PROFILE.brandSubtitle
    const cleanFooter = brandFooterTagline.trim() || DEFAULT_SHOP_PROFILE.brandFooterTagline
    const cleanWorkshop = defaultWorkshopName.trim() || DEFAULT_SHOP_PROFILE.defaultWorkshopName
    const cleanPresets =
      workshopPresetsInput.trim() || DEFAULT_SHOP_PROFILE.workshopPresets.join(', ')
    const cleanWhLabel = defaultWarehouseLabel.trim() || DEFAULT_SHOP_PROFILE.defaultWarehouseLabel
    const cleanStoreUrl = storefrontUrl.trim() || '/store'

    setSavingBrand(true)
    try {
      const res = await apiPatch<SettingsData>('/api/settings', {
        brand_name: cleanBrandName,
        brand_short_name: cleanShortName,
        brand_badge: cleanBadge,
        brand_subtitle: cleanSubtitle,
        brand_footer_tagline: cleanFooter,
        shop_default_workshop: cleanWorkshop,
        shop_workshop_presets: cleanPresets,
        shop_default_warehouse_label: cleanWhLabel,
        shop_storefront_url: cleanStoreUrl,
      })
      setSettings(res)
      const nextProfile = extractShopProfileFromSettings(res as unknown as Record<string, unknown>)
      writeShopProfileCache(nextProfile)
      toast({
        title: `Đã lưu thiết lập Shop "${nextProfile.brandName}"`,
        description:
          'Tên thương hiệu trên Sidebar, Topbar, chân trang và tên Xưởng sản xuất mặc định đã được cập nhật tức thì.',
      })
    } catch (e) {
      toast({
        title: 'Lưu tùy biến Shop thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSavingBrand(false)
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
      const body: Record<string, string | number> = {
        invoice_title: invoiceTitle.trim() || 'HÓA ĐƠN BÁN HÀNG',
        invoice_template_code: invoiceTemplateCode.trim(),
        invoice_series: invoiceSeries.trim(),
        // Số bắt đầu hóa đơn: gửi số nguyên (fallback 1 khi rỗng/không hợp lệ); server trả 400 nếu < 1
        invoice_number_start: Math.floor(Number(invoiceNumberStart)) || 1,
        invoice_payment_method: invoicePaymentMethod.trim(),
        invoice_footer_note: invoiceFooterNote.trim(),
        invoice_default_note: invoiceDefaultNote.trim(),
        invoice_logo: invoiceLogo,
      }
      const bankValues: Record<string, string> = {
        invoice_bank_name: invoiceBankName.trim(),
        invoice_bank_account: invoiceBankAccount.trim(),
        invoice_bank_holder: invoiceBankHolder.trim(),
        invoice_bank_code: invoiceBankCode.trim(),
      }
      for (const [key, value] of Object.entries(bankValues)) {
        if (bankKnownRef.current.has(key) || bankDirtyRef.current.has(key)) body[key] = value
      }
      const res = await apiPatch<SettingsData>('/api/settings', body)
      setSettings(res)
      setInvoiceLogo(res.invoice_logo ?? invoiceLogo)
      setInvoiceNumberStart(res.invoice_number_start ?? String(Math.floor(Number(invoiceNumberStart)) || 1))
      setInvoicePaymentMethod(res.invoice_payment_method ?? invoicePaymentMethod.trim())
      toast({
        title: 'Đã lưu thiết lập hóa đơn',
        description: 'Bản in hóa đơn bán ở module Xuất hàng và hóa đơn mua ở module Nhập hàng sẽ dùng cấu hình mới.',
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

  // URL xem trước VietQR (mẫu cố định 100.000đ — UUDAM TEST) — cần đủ mã ngân hàng + số tài khoản
  const qrPreviewUrl =
    invoiceBankCode.trim() && invoiceBankAccount.trim()
      ? `https://img.vietqr.io/image/${invoiceBankCode.trim()}-${invoiceBankAccount.trim()}-compact.png?amount=100000&addInfo=UUDAM%20TEST&accountName=${encodeURIComponent(
          invoiceBankHolder.trim()
        )}`
      : ''

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trung tâm Cấu hình Hệ thống"
        description="Quản lý tập trung Thương hiệu & Tùy biến theo từng Shop (Sidebar, Topbar, Xưởng SX), Danh mục hàng hóa, Quy đổi định lượng (Kg ⇄ Gr), Hóa đơn VAT, AI & Bảo mật"
      />

      {/* Thanh phân nhóm Cấu hình Hệ thống mở rộng (Modular Settings Hub) */}
      <div className="overflow-x-auto rounded-xl border bg-card p-1.5 shadow-xs">
        <div className="flex min-w-max items-center gap-1.5">
          {(
            [
              {
                id: 'CATALOG_MASTER' as const,
                label: 'Danh mục, Loại SP & Quy đổi ĐVT',
                sub: 'Danh mục · Kg⇄Gr · Đơn vị tính · Đặc tính',
                icon: Scale,
              },
              {
                id: 'COMPANY_INVOICE' as const,
                label: 'Thương hiệu Shop, Đơn vị & Hóa đơn',
                sub: 'Tên Shop Sidebar · Xưởng SX · Mẫu HĐ VietQR · Chốt sổ',
                icon: Store,
              },
              {
                id: 'SECURITY_AI_DATA' as const,
                label: 'Bảo mật, AI & Dữ liệu Go-Live',
                sub: 'Gemini AI · Mật khẩu · Nhân sự RBAC · Sao lưu .db',
                icon: ShieldCheck,
              },
              {
                id: 'ALL' as const,
                label: 'Toàn bộ cấu hình',
                sub: 'Xem tất cả trên 1 trang',
                icon: Layers,
              },
            ]
          ).map((tab) => {
            const Icon = tab.icon
            const active = activeSection === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-3.5 py-2 text-left transition-all',
                  active
                    ? 'bg-[#0066CC] text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-white' : 'text-[#0066CC] dark:text-sky-400')} />
                <div>
                  <p className="text-xs font-bold leading-tight">{tab.label}</p>
                  <p className={cn('text-[10px] leading-tight', active ? 'text-sky-100' : 'text-muted-foreground')}>
                    {tab.sub}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Thanh tóm tắt nhanh Thương hiệu Shop khi đang ở tab Danh mục */}
      {activeSection === 'CATALOG_MASTER' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200/80 bg-sky-50/40 px-3.5 py-2.5 dark:border-sky-900/60 dark:bg-sky-950/20">
          <div className="flex flex-wrap items-center gap-2.5 text-xs">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0066CC] text-white">
              <ShoppingBag className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold text-foreground">{brandName}</span>
                {brandBadge && (
                  <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px] font-semibold text-[#0066CC]">
                    {brandBadge}
                  </Badge>
                )}
                <span className="text-muted-foreground">·</span>
                <span className="text-muted-foreground">{brandSubtitle}</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Topbar: <strong className="text-foreground">{brandShortName}</strong> · Xưởng SX mặc định:{' '}
                <strong className="text-foreground">{defaultWorkshopName}</strong>
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 border-sky-300 bg-background text-xs font-semibold text-[#0066CC] hover:bg-sky-50 dark:border-sky-800 dark:text-sky-300"
            onClick={() => setActiveSection('COMPANY_INVOICE')}
          >
            <Store className="h-3.5 w-3.5" />
            Tùy biến Thương hiệu &amp; Thiết lập Shop
          </Button>
        </div>
      )}

      {/* Nhóm 1: Cấu hình Danh mục, Loại sản phẩm, Quy đổi Định lượng & Đặc tính */}
      {(activeSection === 'CATALOG_MASTER' || activeSection === 'ALL') && (
        <SystemCatalogSettings activeSubTab={catalogSubTab} onSubTabChange={setCatalogSubTab} />
      )}

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        (activeSection === 'COMPANY_INVOICE' || activeSection === 'SECURITY_AI_DATA' || activeSection === 'ALL') && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {(activeSection === 'COMPANY_INVOICE' || activeSection === 'ALL') && (
              <>
          {/* Tùy biến Thương hiệu & Thiết lập theo từng Shop (Sidebar · Topbar · Xưởng SX) */}
          <Card className="border-sky-200/90 shadow-sm lg:col-span-2 dark:border-sky-900/60">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="h-5 w-5 text-[#0066CC] dark:text-sky-400" />
                    Tùy biến Thương hiệu &amp; Thiết lập theo từng Shop
                  </CardTitle>
                  <CardDescription>
                    Tùy chỉnh tên thương hiệu hiển thị góc trái Sidebar, nhãn huy hiệu, dòng mô tả phụ, tên viết tắt trên Topbar và tên Tổ / Xưởng sản xuất mặc định của từng Shop
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">Mẫu nhanh:</span>
                  {SHOP_PROFILE_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setBrandName(preset.config.brandName)
                        setBrandShortName(preset.config.brandShortName)
                        setBrandBadge(preset.config.brandBadge)
                        setBrandSubtitle(preset.config.brandSubtitle)
                        setBrandFooterTagline(preset.config.brandFooterTagline)
                        setDefaultWorkshopName(preset.config.defaultWorkshopName)
                        setWorkshopPresetsInput(preset.config.workshopPresets.join(', '))
                        setDefaultWarehouseLabel(preset.config.defaultWarehouseLabel)
                        setStorefrontUrl(preset.config.storefrontUrl)
                      }}
                      title={preset.description}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                        brandName.trim() === preset.config.brandName
                          ? 'border-[#0066CC] bg-[#0066CC] text-white'
                          : 'border-border bg-muted/40 text-foreground hover:border-[#0066CC]/50 hover:bg-sky-50/60 dark:hover:bg-sky-950/30'
                      )}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <TableSkeleton rows={3} />
              ) : (
                <>
                  {/* Xem trước trực tiếp Header Sidebar & Topbar */}
                  <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Xem trước góc trên bên trái Sidebar
                      </span>
                      <div className="flex items-center gap-2.5 rounded-xl bg-[#0F1E36] px-3 py-2.5 text-white shadow-xs">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0088FF] to-[#0055CC] text-white shadow-md">
                          <ShoppingBag className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="truncate text-sm font-bold tracking-tight text-white">
                              {brandName.trim() || DEFAULT_SHOP_PROFILE.brandName}
                            </p>
                            {brandBadge.trim() && (
                              <span className="shrink-0 rounded bg-[#0066CC]/35 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                                {brandBadge.trim()}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-[11px] text-slate-300">
                            {brandSubtitle.trim() || DEFAULT_SHOP_PROFILE.brandSubtitle}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        Xem trước Thanh định vị Topbar &amp; Xưởng mặc định
                      </span>
                      <div className="flex h-[58px] flex-col justify-center gap-1 rounded-xl border bg-card px-3.5 py-2 shadow-2xs">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-bold text-[#0066CC] dark:text-sky-400">
                            {brandShortName.trim() || DEFAULT_SHOP_PROFILE.brandShortName}
                          </span>
                          <span className="text-muted-foreground">/</span>
                          <span className="font-semibold text-foreground">Quản lý Tồn kho &amp; Sổ Thẻ kho</span>
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          Xưởng SX mặc định:{' '}
                          <strong className="text-foreground">
                            {defaultWorkshopName.trim() || DEFAULT_SHOP_PROFILE.defaultWorkshopName}
                          </strong>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Các trường tùy biến */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="shop-brand-name">Tên Thương hiệu / Shop trên Sidebar *</Label>
                      <Input
                        id="shop-brand-name"
                        value={brandName}
                        onChange={(e) => setBrandName(e.target.value)}
                        placeholder="VD: Bơ Mộc · Showroom hoặc OPENVN · Ưu Đàm"
                        maxLength={80}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="shop-brand-badge">Nhãn huy hiệu (Badge)</Label>
                      <Input
                        id="shop-brand-badge"
                        value={brandBadge}
                        onChange={(e) => setBrandBadge(e.target.value)}
                        placeholder="VD: OMNI, PRO (để trống nếu ẩn)"
                        maxLength={20}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="shop-brand-short">Tên viết tắt trên Topbar</Label>
                      <Input
                        id="shop-brand-short"
                        value={brandShortName}
                        onChange={(e) => setBrandShortName(e.target.value)}
                        placeholder="VD: BƠ MỘC hoặc OPENVN"
                        maxLength={30}
                      />
                    </div>

                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="shop-brand-subtitle">Dòng mô tả phụ dưới tên Shop (Sidebar)</Label>
                      <Input
                        id="shop-brand-subtitle"
                        value={brandSubtitle}
                        onChange={(e) => setBrandSubtitle(e.target.value)}
                        placeholder="VD: Quản lý bán hàng đa kênh"
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="shop-default-workshop">Tên Tổ / Xưởng sản xuất mặc định</Label>
                      <Input
                        id="shop-default-workshop"
                        value={defaultWorkshopName}
                        onChange={(e) => setDefaultWorkshopName(e.target.value)}
                        placeholder="VD: Xưởng đúc thủ công Bơ Mộc"
                        maxLength={120}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="shop-default-wh-label">Nhãn Kho mặc định</Label>
                      <Input
                        id="shop-default-wh-label"
                        value={defaultWarehouseLabel}
                        onChange={(e) => setDefaultWarehouseLabel(e.target.value)}
                        placeholder="VD: Kho Trung Tâm"
                        maxLength={120}
                      />
                    </div>

                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="shop-workshop-presets">
                        Danh sách gợi ý Tổ / Xưởng trong Lệnh sản xuất (cách nhau dấu phẩy)
                      </Label>
                      <Input
                        id="shop-workshop-presets"
                        value={workshopPresetsInput}
                        onChange={(e) => setWorkshopPresetsInput(e.target.value)}
                        placeholder="Xưởng đúc thủ công, Tổ đổ nến bơ tự nhiên, Tổ hoàn thiện & đóng gói"
                        maxLength={600}
                      />
                    </div>
                    <div className="grid gap-1.5 sm:col-span-2">
                      <Label htmlFor="shop-footer-tagline">Dòng giới thiệu chân trang (Footer)</Label>
                      <Input
                        id="shop-footer-tagline"
                        value={brandFooterTagline}
                        onChange={(e) => setBrandFooterTagline(e.target.value)}
                        placeholder="Quản lý bán hàng đa kênh · Đồng bộ Sàn & Xưởng thủ công"
                        maxLength={240}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <p className="text-xs text-muted-foreground">
                      Mọi thay đổi sẽ áp dụng ngay trên Sidebar, Topbar, chân trang và hộp thoại Sản xuất tồn kho mà không cần tải lại trang.
                    </p>
                    <Button
                      onClick={() => void saveShopBranding()}
                      disabled={savingBrand}
                      className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                    >
                      {savingBrand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Lưu tùy biến Shop
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

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
                  <div className="grid gap-2">
                    <Label htmlFor="company-phone">Điện thoại</Label>
                    <Input
                      id="company-phone"
                      value={companyPhone}
                      onChange={(e) => setCompanyPhone(e.target.value)}
                      placeholder="0901234567"
                      maxLength={40}
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
                Tiêu đề, mẫu số, ký hiệu, số hóa đơn, hình thức thanh toán, ngân hàng và ghi chú hiển thị trên bản in
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
                      <Label htmlFor="invoice-number-start">Số bắt đầu hóa đơn</Label>
                      <Input
                        id="invoice-number-start"
                        type="number"
                        min={1}
                        step={1}
                        value={invoiceNumberStart}
                        onChange={(e) => setInvoiceNumberStart(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Số hóa đơn bán tiếp theo — tăng dần, không dùng lại (áp dụng từ hóa đơn mới).
                      </p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="invoice-payment-method">Hình thức thanh toán mặc định</Label>
                      <Input
                        id="invoice-payment-method"
                        value={invoicePaymentMethod}
                        onChange={(e) => setInvoicePaymentMethod(e.target.value)}
                        placeholder="Tiền mặt / Chuyển khoản"
                        maxLength={120}
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
                    {/* Mã ngân hàng VietQR + xem trước mã QR chuyển khoản in trên hóa đơn bán */}
                    <div className="grid gap-2 sm:col-span-2">
                      <Label htmlFor="invoice-bank-code">Mã ngân hàng (VietQR)</Label>
                      <div className="flex flex-wrap items-start gap-4">
                        <div className="grid w-full gap-1 sm:w-64">
                          <Select
                            value={invoiceBankCode || BANK_CODE_EMPTY}
                            onValueChange={(value) => {
                              setInvoiceBankCode(value === BANK_CODE_EMPTY ? '' : value)
                              bankDirtyRef.current.add('invoice_bank_code')
                            }}
                          >
                            <SelectTrigger id="invoice-bank-code">
                              <SelectValue placeholder="Chọn mã ngân hàng" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={BANK_CODE_EMPTY}>(chưa chọn)</SelectItem>
                              {BANK_CODE_OPTIONS.map((b) => (
                                <SelectItem key={b.code} value={b.code}>
                                  {b.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Dùng tạo mã QR chuyển khoản tự động in ở góc dưới phải hóa đơn bán hàng.
                          </p>
                        </div>
                        {qrPreviewUrl ? (
                          qrPreviewFailedUrl === qrPreviewUrl ? (
                            <p className="self-center text-xs text-muted-foreground">
                              Không tải được xem trước VietQR
                            </p>
                          ) : (
                            <div className="flex flex-col items-center gap-1">
                              <img
                                key={qrPreviewUrl}
                                src={qrPreviewUrl}
                                alt="Xem trước VietQR"
                                className="h-28 w-28 rounded-md border bg-white object-contain"
                                onError={() => setQrPreviewFailedUrl(qrPreviewUrl)}
                              />
                              <p className="text-xs text-muted-foreground">
                                Xem trước VietQR (mẫu: 100.000đ — UUDAM TEST)
                              </p>
                            </div>
                          )
                        ) : null}
                      </div>
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
                      aria-label="Tải lên tệp logo hóa đơn"
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
                      Áp dụng cho bản in hóa đơn bán ở module Xuất hàng và hóa đơn mua ở module Nhập hàng.
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
                  <Table disableColumnCustomizer>
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
              </>
            )}

            {(activeSection === 'SECURITY_AI_DATA' || activeSection === 'ALL') && (
              <>
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

          {/* Bảo mật & Mật khẩu Quản trị */}
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  Bảo mật & Đăng nhập Quản trị
                </CardTitle>
                <Badge variant={authRequired ? 'default' : 'outline'} className={authRequired ? 'bg-emerald-600 text-white' : ''}>
                  {authRequired ? 'Đang bảo vệ' : 'Mở nội bộ'}
                </Badge>
              </div>
              <CardDescription>
                Cấu hình mật khẩu truy cập CMS và khóa bảo vệ phiên làm việc
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {onNavigate && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3 dark:border-sky-900/60 dark:bg-sky-950/30">
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-sky-900 dark:text-sky-200">
                      <Users className="h-4 w-4 text-[#0066CC]" />
                      Quản trị Đa Tài khoản, Phân quyền RBAC &amp; Nhật ký Hành vi
                    </p>
                    <p className="text-xs text-sky-800/80 dark:text-sky-300/80">
                      Phân quyền 6 vai trò (Chủ tiệm, Quản lý, Thu ngân POS, Thủ kho, Kế toán, Marketing), cấp mã PIN 4–6 số &amp; giám sát hành vi thời gian thực.
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-[#0066CC] text-white hover:bg-[#0055B3]"
                    onClick={() => onNavigate('iam')}
                  >
                    Mở Nhân sự &amp; Hành vi Log
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Yêu cầu đăng nhập khi mở CMS</p>
                  <p className="text-xs text-muted-foreground">
                    Bật để bắt buộc nhập mật khẩu tại trang <code>/login</code>
                  </p>
                </div>
                <Switch
                  checked={authRequired}
                  onCheckedChange={(checked) => void handleToggleAuthRequired(checked)}
                  aria-label="Bật/tắt yêu cầu đăng nhập"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {hasCustomPassword && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="current-admin-pwd">Mật khẩu hiện tại</Label>
                    <Input
                      id="current-admin-pwd"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Nhập mật khẩu hiện tại"
                    />
                  </div>
                )}
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="new-admin-pwd">
                    {hasCustomPassword ? 'Mật khẩu mới' : 'Đặt mật khẩu quản trị mới (mặc định: admin)'}
                  </Label>
                  <Input
                    id="new-admin-pwd"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Tối thiểu 4 ký tự..."
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button onClick={() => void handleSavePassword()} disabled={savingPassword || !newPassword.trim()}>
                  {savingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Lưu mật khẩu
                </Button>
                <Button variant="outline" onClick={() => void handleLogout()}>
                  <LogOut className="h-4 w-4" />
                  Khóa phiên / Đăng xuất
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Quản trị Dữ liệu & Đưa vào Vận hành (Go-Live) */}
          <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/40 via-background to-background shadow-sm dark:border-emerald-900/60 dark:from-emerald-950/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Rocket className="h-5 w-5 text-emerald-600" />
                Sao lưu & Đưa vào Vận hành Thực tế (Go-Live)
              </CardTitle>
              <CardDescription>
                Sao lưu toàn bộ cơ sở dữ liệu SQLite hoặc dọn sạch dữ liệu giao dịch mẫu để bắt đầu bán hàng thật
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-card p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Trước khi chính thức vận hành:</p>
                <p>• Tải bản sao lưu <code>.db</code> về máy để lưu trữ an toàn mọi dữ liệu hiện tại.</p>
                <p>• Khi bấm <strong>Làm sạch dữ liệu mẫu (Go-Live)</strong>, hệ thống sẽ xóa đơn hàng/vận đơn/hóa đơn mẫu, tắt chế độ giả lập 30s, nhưng <strong>giữ nguyên 100% sản phẩm Ưu Đàm, BOM, kênh bán & mẫu hóa đơn VietQR</strong>.</p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <Button variant="outline" onClick={handleDownloadBackup}>
                  <Download className="h-4 w-4 text-emerald-600" />
                  Tải bản sao lưu Database (.db)
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setResetConfirmCode('')
                    setResetDialogOpen(true)
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Làm sạch dữ liệu mẫu (Go-Live)
                </Button>
              </div>
            </CardContent>
          </Card>
              </>
            )}
          </div>
        )
      )}

      {/* Dialog xác nhận Làm sạch dữ liệu mẫu (Go-Live) */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-rose-600">
              <Rocket className="h-5 w-5" />
              Khởi tạo Vận hành Thực tế (Go-Live Reset)
            </DialogTitle>
            <DialogDescription>
              Thao tác này sẽ xóa toàn bộ đơn hàng, vận đơn, hóa đơn mua/bán, tin nhắn và nhật ký mẫu để tiệm bắt đầu hạch toán từ con số thật. Danh mục sản phẩm Ưu Đàm, BOM, kênh bán và cấu hình hóa đơn được giữ nguyên.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-start gap-2.5">
              <Checkbox
                id="reset-clear-customers"
                checked={resetClearCustomers}
                onCheckedChange={(v) => setResetClearCustomers(Boolean(v))}
              />
              <Label htmlFor="reset-clear-customers" className="text-sm font-normal leading-snug cursor-pointer">
                Xóa luôn danh sách khách hàng mẫu (nếu bỏ chọn: giữ hồ sơ khách nhưng đặt lại điểm thưởng = 0)
              </Label>
            </div>

            <div className="flex items-start gap-2.5">
              <Checkbox
                id="reset-stock-zero"
                checked={resetStockZero}
                onCheckedChange={(v) => setResetStockZero(Boolean(v))}
              />
              <Label htmlFor="reset-stock-zero" className="text-sm font-normal leading-snug cursor-pointer">
                Đặt lại tồn kho tất cả sản phẩm về 0 (nếu bỏ chọn: giữ nguyên số tồn hiện tại làm Tồn đầu kỳ Go-Live)
              </Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="golive-confirm-input">
                Nhập chữ <strong className="font-mono text-rose-600">GO-LIVE</strong> để xác nhận:
              </Label>
              <Input
                id="golive-confirm-input"
                value={resetConfirmCode}
                onChange={(e) => setResetConfirmCode(e.target.value)}
                placeholder="GO-LIVE"
                className="font-mono uppercase"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setResetDialogOpen(false)} disabled={resetLoading}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleGoLiveReset()}
              disabled={resetLoading || resetConfirmCode.trim().toUpperCase() !== 'GO-LIVE'}
            >
              {resetLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Xác nhận Go-Live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
