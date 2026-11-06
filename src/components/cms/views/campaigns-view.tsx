'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Megaphone,
  Plus,
  Search,
  RefreshCw,
  Calendar,
  CalendarClock,
  Flame,
  CheckCircle2,
  XCircle,
  Trash2,
  Edit3,
  Sparkles,
  Share2,
  Tag,
  ShoppingBag,
  Percent,
  Clock,
  AlertCircle,
  Check,
  Eye,
  Layers,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api'
import { formatVND, formatDateTime, formatDate } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import type { ViewId } from '@/components/cms/app-sidebar'

export type CampaignStatus = 'UPCOMING' | 'RUNNING' | 'ENDED' | 'CANCELLED'

export interface EnrichedProduct {
  id: string
  name: string
  sku: string
  price: number
  originalPrice?: number
  campaignPrice?: number
  discountPercent?: number
  discountAmount?: number
  image?: string | null
  status?: string
}

export interface EnrichedVoucher {
  id: string
  code: string
  title: string
  discountType: string
  discountValue: number
  discountPercent?: number
  discountAmount?: number
  minOrderValue?: number
  active?: boolean
}

export interface CampaignItem {
  id: string
  code: string
  name: string
  title: string
  description?: string | null
  startDate: string
  endDate: string
  status: CampaignStatus
  discountPercent?: number | null
  discountAmount?: number | null
  voucherCode?: string | null
  appliedProductIds?: string[]
  appliedVoucherIds?: string[]
  productOverrides?: Record<string, { specialPrice?: number; discountPercent?: number }>
  bannerUrl?: string | null
  tags?: string[]
  products?: EnrichedProduct[]
  vouchers?: EnrichedVoucher[]
  createdAt?: string
  updatedAt?: string
}

interface CampaignWaveItem {
  id: string
  campaignId: string
  campaignCode: string
  waveNumber: number
  waveCode: string
  waveName: string
  waveNote: string
  actorName: string
  isActive: boolean
  createdAt: string
  snapshot: {
    name: string
    discountPercent?: number | null
    discountAmount?: number | null
    voucherCode?: string | null
    startDate: string
    endDate: string
    appliedProductIds: string[]
    productOverrides: Record<string, { specialPrice?: number; discountPercent?: number }>
  }
  changedSummary: Array<{ field: string; label: string; before: string; after: string }>
}

interface ProductOption {
  id: string
  name: string
  sku: string
  sellPrice: number
  status: string
}

interface VoucherOption {
  id: string
  code: string
  title: string
  discountType: string
  discountValue: number
  active: boolean
}

interface CampaignsViewProps {
  onNavigate?: (view: ViewId, param?: string) => void
}

const DEFAULT_FORM = {
  id: '',
  name: '',
  code: '',
  description: '',
  startDate: '',
  endDate: '',
  discountPercent: '',
  discountAmount: '',
  voucherCode: '',
  bannerUrl: '',
  tags: '',
  selectedProductIds: [] as string[],
  productOverrides: {} as Record<string, { specialPrice?: number; discountPercent?: number }>,
  waveName: '',
  waveNote: '',
}

export function CampaignsView({ onNavigate }: CampaignsViewProps) {
  const { toast } = useToast()

  const [campaigns, setCampaigns] = useState<CampaignItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // Available options
  const [productsList, setProductsList] = useState<ProductOption[]>([])
  const [vouchersList, setVouchersList] = useState<VoucherOption[]>([])

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [formData, setFormData] = useState(DEFAULT_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formTab, setFormTab] = useState<'GENERAL' | 'PRODUCTS'>('GENERAL')

  // Detail Modal
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignItem | null>(null)

  // Delete Confirm Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [campaignToDelete, setCampaignToDelete] = useState<CampaignItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Campaign Waves (Lịch sử & Quản lý từng Đợt điều chỉnh chiến dịch)
  const [wavesModalOpen, setWavesModalOpen] = useState(false)
  const [wavesCampaign, setWavesCampaign] = useState<CampaignItem | null>(null)
  const [campaignWaves, setCampaignWaves] = useState<CampaignWaveItem[]>([])
  const [wavesLoading, setWavesLoading] = useState(false)
  const [waveActivating, setWaveActivating] = useState<string | null>(null)

  // Fetch campaigns
  const loadCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const queryParams = new URLSearchParams()
      if (statusFilter && statusFilter !== 'ALL') {
        queryParams.set('status', statusFilter)
      }
      if (search.trim()) {
        queryParams.set('search', search.trim())
      }
      queryParams.set('pageSize', '50')

      const res = await apiGet<{ campaigns: CampaignItem[]; total: number }>(
        `/api/campaigns?${queryParams.toString()}`
      )
      setCampaigns(res.campaigns || [])
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể tải danh sách chương trình'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, search])

  // Load auxiliary data for modal
  const loadOptions = useCallback(async () => {
    try {
      const [prodsRes, vchs] = await Promise.all([
        apiGet<{ products?: ProductOption[] } | ProductOption[]>('/api/products').catch(() => []),
        apiGet<{ vouchers: VoucherOption[] }>('/api/vouchers').catch(() => ({ vouchers: [] })),
      ])
      if (Array.isArray(prodsRes)) {
        setProductsList(prodsRes)
      } else if (prodsRes && Array.isArray(prodsRes.products)) {
        setProductsList(prodsRes.products)
      }
      if (vchs && Array.isArray(vchs.vouchers)) setVouchersList(vchs.vouchers)
    } catch {
      // Non-blocking
    }
  }, [])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  useEffect(() => {
    loadOptions()
  }, [loadOptions])

  // Computed stats
  const stats = useMemo(() => {
    const total = campaigns.length
    let running = 0
    let upcoming = 0
    let ended = 0
    campaigns.forEach((c) => {
      if (c.status === 'RUNNING') running++
      else if (c.status === 'UPCOMING') upcoming++
      else if (c.status === 'ENDED' || c.status === 'CANCELLED') ended++
    })
    return { total, running, upcoming, ended }
  }, [campaigns])

  // Filtered campaigns
  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
      if (search.trim()) {
        const q = search.trim().toLowerCase()
        const matchName = (c.name || c.title || '').toLowerCase().includes(q)
        const matchCode = (c.code || '').toLowerCase().includes(q)
        const matchDesc = (c.description || '').toLowerCase().includes(q)
        return matchName || matchCode || matchDesc
      }
      return true
    })
  }, [campaigns, statusFilter, search])

  // Format datetime for input type="datetime-local"
  const toDateTimeLocal = (iso?: string) => {
    if (!iso) return ''
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    const YYYY = d.getFullYear()
    const MM = pad(d.getMonth() + 1)
    const DD = pad(d.getDate())
    const hh = pad(d.getHours())
    const mm = pad(d.getMinutes())
    return `${YYYY}-${MM}-${DD}T${hh}:${mm}`
  }

  // Open create modal
  const handleOpenCreate = () => {
    setIsEditing(false)
    const now = new Date()
    const future = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    setFormData({
      ...DEFAULT_FORM,
      code: `CP-${Date.now().toString(36).toUpperCase()}`,
      startDate: toDateTimeLocal(now.toISOString()),
      endDate: toDateTimeLocal(future.toISOString()),
    })
    setFormError(null)
    setFormModalOpen(true)
  }

  // Open edit modal
  const handleOpenEdit = (c: CampaignItem) => {
    setIsEditing(true)
    setFormData({
      id: c.id,
      name: c.name || c.title || '',
      code: c.code || '',
      description: c.description || '',
      startDate: toDateTimeLocal(c.startDate),
      endDate: toDateTimeLocal(c.endDate),
      discountPercent: c.discountPercent != null ? String(c.discountPercent) : '',
      discountAmount: c.discountAmount != null ? String(c.discountAmount) : '',
      voucherCode: c.voucherCode || '',
      bannerUrl: c.bannerUrl || '',
      tags: Array.isArray(c.tags) ? c.tags.join(', ') : '',
      selectedProductIds: c.appliedProductIds || (c.products ? c.products.map((p) => p.id) : []),
      productOverrides: c.productOverrides ? { ...c.productOverrides } : {},
      waveName: '',
      waveNote: '',
    })
    setFormError(null)
    setFormModalOpen(true)
  }

  // Open Campaign Waves History modal
  const handleOpenWaves = async (c: CampaignItem) => {
    setWavesCampaign(c)
    setWavesModalOpen(true)
    setWavesLoading(true)
    try {
      const res = await apiGet<{ waves: CampaignWaveItem[] }>(`/api/campaigns/${c.id}/waves`)
      setCampaignWaves(res.waves || [])
    } catch (e) {
      toast({
        title: 'Không thể tải lịch sử đợt chương trình',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setWavesLoading(false)
    }
  }

  const handleQuickSwitchCampaignWave = async (campaignId: string, waveCode: string) => {
    setWaveActivating(waveCode)
    try {
      const res = await apiPost<{ campaign: CampaignItem; waves: CampaignWaveItem[] }>(
        `/api/campaigns/${campaignId}/waves`,
        { waveCode }
      )
      toast({
        title: `Đã chuyển nhanh sang ${waveCode}`,
        description: `${res.campaign.name} · Giảm ${res.campaign.discountPercent ?? 0}%${
          res.campaign.voucherCode ? ` + Mã ${res.campaign.voucherCode}` : ''
        }`,
      })
      await loadCampaigns()
    } catch (e) {
      toast({
        title: 'Không thể chuyển đợt chương trình',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setWaveActivating(null)
    }
  }

  const handleActivateCampaignWave = async (waveIdOrCode: string) => {
    if (!wavesCampaign) return
    setWaveActivating(waveIdOrCode)
    try {
      const res = await apiPost<{ campaign: CampaignItem; waves: CampaignWaveItem[] }>(
        `/api/campaigns/${wavesCampaign.id}/waves`,
        { waveCode: waveIdOrCode }
      )
      setCampaignWaves(res.waves || [])
      setWavesCampaign(res.campaign)
      toast({
        title: `Đã khôi phục & áp dụng ${waveIdOrCode}`,
        description: `Chương trình "${res.campaign.name}" đã cập nhật theo cấu hình đợt đã chọn.`,
      })
      await loadCampaigns()
    } catch (e) {
      toast({
        title: 'Không thể kích hoạt đợt chương trình',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setWaveActivating(null)
    }
  }

  const setProductSpecialPrice = (productId: string, val: string) => {
    setFormData((prev) => {
      const nextOverrides = { ...prev.productOverrides }
      const num = Number(val)
      if (!val.trim() || !Number.isFinite(num) || num <= 0) {
        delete nextOverrides[productId]
      } else {
        nextOverrides[productId] = { ...nextOverrides[productId], specialPrice: Math.round(num) }
      }
      return { ...prev, productOverrides: nextOverrides }
    })
  }

  // Công cụ tính giá nhanh hàng loạt cho toàn bộ sản phẩm đã chọn (Làm tròn .000đ / 9.000đ / Xóa ghi đè)
  const applyBatchProductPricing = (mode: 'ROUND_1K' | 'PSYCH_9K' | 'CLEAR') => {
    if (mode === 'CLEAR') {
      setFormData((prev) => ({ ...prev, productOverrides: {} }))
      return
    }
    const pct = Number(formData.discountPercent) || 0
    const amt = Number(formData.discountAmount) || 0
    setFormData((prev) => {
      const nextOverrides: Record<string, { specialPrice?: number; discountPercent?: number }> = {}
      for (const pid of prev.selectedProductIds) {
        const prod = productsList.find((p) => p.id === pid)
        if (!prod) continue
        let base = prod.sellPrice
        if (pct > 0) base = prod.sellPrice * (1 - pct / 100)
        else if (amt > 0) base = Math.max(0, prod.sellPrice - amt)

        let specialPrice = Math.round(base / 1000) * 1000
        if (mode === 'PSYCH_9K' && specialPrice >= 20_000) {
          // Làm tròn về đuôi 9.000đ gần nhất (VD: 331.500 -> 329.000)
          specialPrice = Math.max(9_000, Math.floor(specialPrice / 10_000) * 10_000 - 1_000)
        }
        nextOverrides[pid] = { specialPrice }
      }
      return { ...prev, productOverrides: nextOverrides }
    })
  }

  // Submit create / edit
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const name = formData.name.trim()
    if (!name) {
      setFormError('Vui lòng nhập tên chương trình / chiến dịch')
      return
    }

    if (!formData.startDate || !formData.endDate) {
      setFormError('Vui lòng chọn thời gian bắt đầu và kết thúc')
      return
    }

    const startMs = new Date(formData.startDate).getTime()
    const endMs = new Date(formData.endDate).getTime()

    if (isNaN(startMs) || isNaN(endMs)) {
      setFormError('Định dạng thời gian không hợp lệ')
      return
    }

    if (endMs <= startMs) {
      setFormError('Thời gian kết thúc phải diễn ra sau thời gian bắt đầu')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        name,
        title: name,
        code: formData.code.trim() || undefined,
        description: formData.description.trim() || null,
        startDate: new Date(formData.startDate).toISOString(),
        endDate: new Date(formData.endDate).toISOString(),
        discountPercent: formData.discountPercent ? parseFloat(formData.discountPercent) : null,
        discountAmount: formData.discountAmount ? parseFloat(formData.discountAmount) : null,
        voucherCode: formData.voucherCode.trim() || null,
        bannerUrl: formData.bannerUrl.trim() || null,
        tags: formData.tags
          ? formData.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
        appliedProductIds: formData.selectedProductIds,
        productOverrides: formData.productOverrides,
        waveName: formData.waveName.trim() || undefined,
        waveNote: formData.waveNote.trim() || undefined,
      }

      if (isEditing && formData.id) {
        await apiPut(`/api/campaigns/${formData.id}`, payload)
        toast({
          title: 'Cập nhật thành công',
          description: `Chiến dịch "${name}" đã được cập nhật`,
        })
      } else {
        await apiPost('/api/campaigns', payload)
        toast({
          title: 'Tạo thành công',
          description: `Chiến dịch "${name}" đã được tạo mới`,
        })
      }

      setFormModalOpen(false)
      loadCampaigns()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi khi lưu chiến dịch'
      setFormError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // Handle delete campaign
  const handleConfirmDelete = async () => {
    if (!campaignToDelete) return
    setDeleting(true)
    try {
      await apiDelete(`/api/campaigns/${campaignToDelete.id}`)
      toast({
        title: 'Đã xóa chiến dịch',
        description: `Chiến dịch "${campaignToDelete.name}" đã được xóa khỏi hệ thống`,
      })
      setDeleteModalOpen(false)
      setCampaignToDelete(null)
      loadCampaigns()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể xóa chiến dịch'
      toast({
        title: 'Lỗi',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  // Toggle product selection in modal
  const toggleProduct = (productId: string) => {
    setFormData((prev) => {
      const exists = prev.selectedProductIds.includes(productId)
      return {
        ...prev,
        selectedProductIds: exists
          ? prev.selectedProductIds.filter((id) => id !== productId)
          : [...prev.selectedProductIds, productId],
      }
    })
  }

  // Quick action: jump to Auto Social AI with this campaign
  const handleTriggerAutoSocial = (campaignId: string) => {
    if (onNavigate) {
      onNavigate('auto-social', campaignId)
    } else {
      toast({
        title: 'Tiếp thị AI Auto Social',
        description: `Đã chọn chiến dịch ${campaignId} cho kế hoạch nội dung mạng xã hội`,
      })
    }
  }

  // Render status badge
  const renderStatusBadge = (status: CampaignStatus) => {
    switch (status) {
      case 'RUNNING':
        return (
          <Badge className="border-emerald-300 bg-emerald-500/15 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400 font-semibold gap-1">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Đang chạy
          </Badge>
        )
      case 'UPCOMING':
        return (
          <Badge variant="outline" className="border-blue-400 bg-blue-500/10 text-blue-700 dark:text-blue-400 font-medium gap-1">
            <Clock className="h-3 w-3" /> Sắp diễn ra
          </Badge>
        )
      case 'ENDED':
        return (
          <Badge variant="secondary" className="bg-muted text-muted-foreground font-normal">
            Đã kết thúc
          </Badge>
        )
      case 'CANCELLED':
        return (
          <Badge variant="destructive" className="bg-destructive/15 text-destructive border border-destructive/30">
            Đã hủy
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Chương trình & Khuyến mãi (CRM)"
        description="Quản lý các sự kiện bán hàng, chính sách ưu đãi và nguồn dữ liệu chiến dịch cho Tiếp thị Auto Social AI"
      >
        <Button variant="outline" size="sm" onClick={loadCampaigns} disabled={loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Làm mới
        </Button>
        <Button size="sm" onClick={handleOpenCreate} className="bg-primary text-primary-foreground font-medium">
          <Plus className="mr-1.5 h-4 w-4" />
          Tạo chương trình
        </Button>
      </PageHeader>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Tổng chiến dịch"
          value={String(stats.total)}
          icon={Megaphone}
          hint="Toàn bộ chiến dịch CRM trong hệ thống"
          loading={loading}
        />
        <StatCard
          title="Đang diễn ra"
          value={String(stats.running)}
          icon={Flame}
          iconClassName="text-emerald-500"
          hint="Đang mở bán ưu đãi thực tế"
          loading={loading}
        />
        <StatCard
          title="Sắp diễn ra"
          value={String(stats.upcoming)}
          icon={CalendarClock}
          iconClassName="text-blue-500"
          hint="Đã lên lịch đón sự kiện mới"
          loading={loading}
        />
        <StatCard
          title="Đã hoàn tất / Kết thúc"
          value={String(stats.ended)}
          icon={CheckCircle2}
          iconClassName="text-muted-foreground"
          hint="Lưu trữ lịch sử & hiệu quả"
          loading={loading}
        />
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Search Input */}
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm theo tên chương trình, mã hoặc mô tả..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>

            {/* Status Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { key: 'ALL', label: 'Tất cả' },
                { key: 'RUNNING', label: 'Đang chạy' },
                { key: 'UPCOMING', label: 'Sắp tới' },
                { key: 'ENDED', label: 'Đã kết thúc' },
                { key: 'CANCELLED', label: 'Đã hủy' },
              ].map((tab) => (
                <Button
                  key={tab.key}
                  size="sm"
                  variant={statusFilter === tab.key ? 'default' : 'outline'}
                  onClick={() => setStatusFilter(tab.key)}
                  className="h-8 text-xs font-medium"
                >
                  {tab.label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Table or State */}
      {error ? (
        <ErrorState message={error} onRetry={loadCampaigns} />
      ) : loading ? (
        <TableSkeleton rows={5} />
      ) : filteredCampaigns.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Chưa có chương trình khuyến mãi nào"
          description={
            search || statusFilter !== 'ALL'
              ? 'Không tìm thấy chiến dịch nào khớp với bộ lọc hiện tại.'
              : 'Hãy tạo chiến dịch bán hàng đầu tiên để đồng bộ sản phẩm, voucher và lên kế hoạch Auto Social AI.'
          }
          action={
            <Button size="sm" onClick={handleOpenCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> Tạo chương trình mới
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card shadow-sm">
          <Table className="min-w-[850px]">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[180px]">Mã & Tên chương trình</TableHead>
                <TableHead className="w-[130px]">Trạng thái</TableHead>
                <TableHead className="w-[200px]">Thời gian diễn ra</TableHead>
                <TableHead className="w-[160px]">Sản phẩm & Voucher</TableHead>
                <TableHead className="w-[140px]">Chính sách ưu đãi</TableHead>
                <TableHead className="w-[180px] text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCampaigns.map((c) => {
                const prodCount = c.appliedProductIds?.length || c.products?.length || 0
                return (
                  <TableRow key={c.id} className="hover:bg-muted/40 transition-colors">
                    {/* Tên & Mã */}
                    <TableCell className="align-top py-3 whitespace-normal max-w-[280px]">
                      <div className="space-y-1">
                        <div className="font-semibold text-foreground text-sm line-clamp-1">
                          {c.name || c.title}
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                          <Tag className="h-3 w-3" />
                          {c.code}
                        </div>
                        {c.description && (
                          <div className="text-xs text-muted-foreground line-clamp-2 italic">
                            {c.description}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Trạng thái */}
                    <TableCell className="align-top py-3">
                      {renderStatusBadge(c.status)}
                    </TableCell>

                    {/* Thời gian */}
                    <TableCell className="align-top py-3">
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Calendar className="h-3 w-3 text-emerald-600" />
                          <span>Bắt đầu: {formatDateTime(c.startDate)}</span>
                        </div>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Clock className="h-3 w-3 text-amber-600" />
                          <span>Kết thúc: {formatDateTime(c.endDate)}</span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Sản phẩm & Voucher */}
                    <TableCell className="align-top py-3">
                      <div className="space-y-1 text-xs">
                        <div className="flex items-center gap-1 font-medium">
                          <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                          <span>{prodCount} sản phẩm liên kết</span>
                        </div>
                        {c.voucherCode ? (
                          <div className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-400 font-mono text-[11px]">
                            Voucher: {c.voucherCode}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">Không kèm voucher</span>
                        )}
                      </div>
                    </TableCell>

                    {/* Ưu đãi & Chuyển nhanh Đợt 1 chạm */}
                    <TableCell className="align-top py-3">
                      <div className="text-xs space-y-1.5">
                        {c.discountPercent ? (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700 dark:text-emerald-400 font-semibold text-[11px] gap-0.5">
                            <Percent className="h-3 w-3" /> Giảm {c.discountPercent}%
                          </Badge>
                        ) : c.discountAmount ? (
                          <span className="font-semibold text-emerald-600">
                            Giảm {formatVND(c.discountAmount)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Theo từng sản phẩm</span>
                        )}
                        <div className="flex flex-wrap items-center gap-1 pt-0.5">
                          <button
                            type="button"
                            disabled={c.discountPercent === 10 || waveActivating === `${c.code || c.id}#DOT-01`}
                            onClick={() =>
                              void handleQuickSwitchCampaignWave(c.id, `${c.code || c.id}#DOT-01`)
                            }
                            title="Chuyển sang Đợt 1 (Early Bird -10%)"
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-all ${
                              c.discountPercent === 10
                                ? 'border-emerald-500 bg-emerald-600 font-bold text-white'
                                : 'bg-muted/60 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                            }`}
                          >
                            #DOT-01 (-10%)
                          </button>
                          <button
                            type="button"
                            disabled={c.discountPercent === 15 || waveActivating === `${c.code || c.id}#DOT-02`}
                            onClick={() =>
                              void handleQuickSwitchCampaignWave(c.id, `${c.code || c.id}#DOT-02`)
                            }
                            title="Chuyển sang Đợt 2 (Chính thức -15% + UUDAM10)"
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] transition-all ${
                              c.discountPercent === 15
                                ? 'border-emerald-500 bg-emerald-600 font-bold text-white'
                                : 'bg-muted/60 text-muted-foreground hover:border-primary/50 hover:text-foreground'
                            }`}
                          >
                            #DOT-02 (-15%)
                          </button>
                        </div>
                      </div>
                    </TableCell>

                    {/* Thao tác */}
                    <TableCell className="align-top py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Auto Social fast trigger */}
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 px-2 text-xs font-medium text-primary hover:bg-primary/10 gap-1"
                          onClick={() => handleTriggerAutoSocial(c.id)}
                          title="Lên lịch viết bài AI Auto Social"
                        >
                          <Sparkles className="h-3.5 w-3.5 text-primary" />
                          <span className="hidden sm:inline">AI Post</span>
                        </Button>

                        {/* Waves History */}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2 text-xs gap-1"
                          onClick={() => void handleOpenWaves(c)}
                          title="Quản lý & So sánh các Đợt thay đổi chương trình"
                        >
                          <Layers className="h-3.5 w-3.5 text-amber-600" />
                          <span className="hidden sm:inline">Các đợt</span>
                        </Button>

                        {/* View Detail */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => {
                            setSelectedCampaign(c)
                            setDetailModalOpen(true)
                          }}
                          title="Xem chi tiết"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        {/* Edit */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => handleOpenEdit(c)}
                          title="Chỉnh sửa"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>

                        {/* Delete */}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setCampaignToDelete(c)
                            setDeleteModalOpen(true)
                          }}
                          title="Xóa chương trình"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* CREATE / EDIT DIALOG */}
      <Dialog open={formModalOpen} onOpenChange={setFormModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSubmitForm}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold">
                {isEditing ? 'Chỉnh sửa chương trình khuyến mãi' : 'Tạo chương trình khuyến mãi mới'}
              </DialogTitle>
              <DialogDescription>
                Cung cấp thông tin chiến dịch để làm giàu dữ liệu giá bán và tạo ngữ cảnh cho AI Auto Social
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="mt-3 space-y-3 text-sm">
              {/* THANH CHUYỂN 2 TAB NGANG (KHÔNG CẦN CUỘN DỌC) */}
              <div className="grid grid-cols-2 gap-1.5 rounded-lg border bg-muted/40 p-1">
                <button
                  type="button"
                  onClick={() => setFormTab('GENERAL')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-all ${
                    formTab === 'GENERAL'
                      ? 'bg-background text-primary shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  1. Thông tin, Ưu đãi &amp; Định danh Đợt
                </button>
                <button
                  type="button"
                  onClick={() => setFormTab('PRODUCTS')}
                  className={`rounded-md py-1.5 text-xs font-semibold transition-all ${
                    formTab === 'PRODUCTS'
                      ? 'bg-background text-primary shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  2. Sản phẩm &amp; Giá riêng từng SP ({formData.selectedProductIds.length} đã chọn)
                </button>
              </div>

              {formTab === 'GENERAL' && (
                <div className="space-y-3">
                  {/* Quản lý Đợt điều chỉnh (Campaign Wave / Revision) — Đặt ngay đầu Modal để dễ thao tác */}
                  <div className="rounded-lg border border-amber-300/70 bg-amber-50/40 p-2.5 dark:border-amber-800/60 dark:bg-amber-950/20">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
                      <p className="flex items-center gap-1.5 text-xs font-bold text-amber-900 dark:text-amber-200">
                        <Layers className="h-3.5 w-3.5" />
                        Định danh Đợt thay đổi chương trình (Lưu vào Lịch sử các Đợt)
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((p) => ({
                              ...p,
                              discountPercent: '10',
                              voucherCode: '',
                              waveName: 'Đợt Mở bán Sớm (Early Bird -10%)',
                              waveNote: 'Áp dụng chiết khấu mở bán sớm 10% toàn bộ sản phẩm trong chiến dịch.',
                            }))
                          }
                          className="rounded border border-amber-300 bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-amber-100/50"
                        >
                          Mẫu Early Bird (-10%)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((p) => ({
                              ...p,
                              discountPercent: '15',
                              voucherCode: 'UUDAM10',
                              waveName: 'Đợt Chính thức Ra Mắt (-15% + Mã UUDAM10)',
                              waveNote: 'Nâng ưu đãi lên 15% kèm mã Voucher UUDAM10 giảm thêm 10% (tối đa 50k).',
                            }))
                          }
                          className="rounded border border-emerald-300 bg-emerald-50/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900 hover:bg-emerald-100/60 dark:bg-emerald-950/40 dark:text-emerald-200"
                        >
                          Mẫu Chính thức (-15% + UUDAM10)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setFormData((p) => ({
                              ...p,
                              discountPercent: '20',
                              voucherCode: 'PHATDAN50K',
                              waveName: 'Đợt Cao điểm Cuối Tuần (-20% + PHATDAN50K)',
                              waveNote: 'Kích cầu cuối tuần: nâng mức giảm chung lên 20% kết hợp mã PHATDAN50K.',
                            }))
                          }
                          className="rounded border border-violet-300 bg-violet-50/70 px-1.5 py-0.5 text-[10px] font-medium text-violet-900 hover:bg-violet-100/60 dark:bg-violet-950/40 dark:text-violet-200"
                        >
                          Mẫu Cao điểm (-20% + 50k)
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="camp-wave-name" className="text-xs">
                          Tên Đợt áp dụng (tùy chọn)
                        </Label>
                        <Input
                          id="camp-wave-name"
                          placeholder="VD: Đợt 3 · Tăng ưu đãi Cuối tuần -20%"
                          value={formData.waveName}
                          onChange={(e) => setFormData({ ...formData, waveName: e.target.value })}
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                      <div>
                        <Label htmlFor="camp-wave-note" className="text-xs">
                          Lý do / Ghi chú thay đổi đợt này
                        </Label>
                        <Input
                          id="camp-wave-note"
                          placeholder="VD: Điều chỉnh giá đặc biệt cho Chén Liên Hoa UD-TC-001"
                          value={formData.waveNote}
                          onChange={(e) => setFormData({ ...formData, waveNote: e.target.value })}
                          className="mt-1 h-8 text-xs bg-background"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Tên & Mã */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2 space-y-1">
                      <Label htmlFor="camp-name">Tên chương trình / Sự kiện *</Label>
                      <Input
                        id="camp-name"
                        placeholder="VD: Hội Trà Trăng Rằm Ưu Đàm 2026"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="camp-code">Mã chương trình</Label>
                      <Input
                        id="camp-code"
                        placeholder="VD: CP-TRANGRAM"
                        value={formData.code}
                        onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Mô tả */}
                  <div className="space-y-1">
                    <Label htmlFor="camp-desc">Mô tả thông điệp chiến dịch</Label>
                    <Textarea
                      id="camp-desc"
                      placeholder="Mô tả ý nghĩa, thông điệp an yên, thiền trà, thanh lọc tâm trí..."
                      rows={2}
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    />
                  </div>

                  {/* Thời gian */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="camp-start">Ngày bắt đầu *</Label>
                      <Input
                        id="camp-start"
                        type="datetime-local"
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        required
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="camp-end">Ngày kết thúc *</Label>
                      <Input
                        id="camp-end"
                        type="datetime-local"
                        value={formData.endDate}
                        onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                        required
                      />
                    </div>
                  </div>

                  {/* Chính sách ưu đãi & Voucher */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="camp-discount-pct">% Giảm giá chung</Label>
                        {Number(formData.discountPercent) > 0 && (
                          <span className="font-mono text-[11px] font-bold text-emerald-600">
                            -{formData.discountPercent}%
                          </span>
                        )}
                      </div>
                      <Input
                        id="camp-discount-pct"
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        placeholder="VD: 15"
                        value={formData.discountPercent}
                        onChange={(e) => setFormData({ ...formData, discountPercent: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="camp-discount-amt">Hoặc số tiền giảm</Label>
                        {Number(formData.discountAmount) > 0 && (
                          <span className="font-mono text-[11px] font-bold text-emerald-600">
                            = {formatVND(Number(formData.discountAmount))}
                          </span>
                        )}
                      </div>
                      <Input
                        id="camp-discount-amt"
                        type="number"
                        min="0"
                        step="1000"
                        placeholder="VD: 50000"
                        value={formData.discountAmount}
                        onChange={(e) => setFormData({ ...formData, discountAmount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="camp-voucher">Mã Voucher kèm theo</Label>
                      <select
                        id="camp-voucher"
                        className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:h-9 sm:text-sm"
                        value={formData.voucherCode}
                        onChange={(e) => setFormData({ ...formData, voucherCode: e.target.value })}
                      >
                        <option value="">-- Không kèm voucher --</option>
                        {vouchersList.map((v) => (
                          <option key={v.id} value={v.code}>
                            {v.code} — {v.title} ({v.discountType === 'PERCENT' ? `${v.discountValue}%` : formatVND(v.discountValue)})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Banner URL & Tags */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="camp-banner">Đường dẫn Banner (nếu có)</Label>
                      <Input
                        id="camp-banner"
                        placeholder="https://example.com/banner.jpg"
                        value={formData.bannerUrl}
                        onChange={(e) => setFormData({ ...formData, bannerUrl: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="camp-tags">Thẻ phân loại (ngăn cách bởi dấu phẩy)</Label>
                      <Input
                        id="camp-tags"
                        placeholder="tra, huong-tram, thien, tet"
                        value={formData.tags}
                        onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SẢN PHẨM ÁP DỤNG & CÔNG CỤ TÍNH GIÁ HÀNG LOẠT */}
              {formTab === 'PRODUCTS' && (
                <div className="space-y-2.5">
                  {/* Thanh Tóm tắt Doanh thu & Mức tiết kiệm toàn chiến dịch */}
                  {(() => {
                    const selectedProds = productsList.filter((p) =>
                      formData.selectedProductIds.includes(p.id)
                    )
                    const pct = Number(formData.discountPercent) || 0
                    const amt = Number(formData.discountAmount) || 0
                    let totalOrig = 0
                    let totalCamp = 0
                    for (const p of selectedProds) {
                      totalOrig += p.sellPrice
                      const ov = formData.productOverrides[p.id]?.specialPrice
                      const eff =
                        ov ??
                        (pct > 0
                          ? Math.round(p.sellPrice * (1 - pct / 100))
                          : amt > 0
                            ? Math.max(0, p.sellPrice - amt)
                            : p.sellPrice)
                      totalCamp += eff
                    }
                    const savedVnd = Math.max(0, totalOrig - totalCamp)
                    const savedPct =
                      totalOrig > 0 ? Number(((savedVnd / totalOrig) * 100).toFixed(1)) : 0
                    return (
                      <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs sm:grid-cols-4">
                        <div className="rounded border bg-background/90 px-2 py-1">
                          <span className="text-[10px] text-muted-foreground">Số SP trong đợt</span>
                          <p className="font-mono font-bold">{selectedProds.length} sản phẩm</p>
                        </div>
                        <div className="rounded border bg-background/90 px-2 py-1">
                          <span className="text-[10px] text-muted-foreground">Tổng giá gốc (1 bộ)</span>
                          <p className="font-mono font-semibold">{formatVND(totalOrig)}</p>
                        </div>
                        <div className="rounded border bg-background/90 px-2 py-1">
                          <span className="text-[10px] text-muted-foreground">Tổng giá sau ưu đãi</span>
                          <p className="font-mono font-bold text-emerald-600">{formatVND(totalCamp)}</p>
                        </div>
                        <div className="rounded border bg-background/90 px-2 py-1">
                          <span className="text-[10px] text-muted-foreground">Mức giảm thực tế TB</span>
                          <p className="font-mono font-bold text-amber-600">
                            -{formatVND(savedVnd)} (-{savedPct}%)
                          </p>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold">Công cụ tính giá nhanh hàng loạt:</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => applyBatchProductPricing('ROUND_1K')}
                      >
                        Làm tròn .000đ (-{formData.discountPercent || 0}%)
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 border-emerald-300 bg-emerald-50/70 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        onClick={() => applyBatchProductPricing('PSYCH_9K')}
                      >
                        Làm tròn giá đẹp 9.000đ (VD: 329.000đ)
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => applyBatchProductPricing('CLEAR')}
                      >
                        Xóa ghi đè (Dùng % chung)
                      </Button>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-primary"
                        onClick={() => setFormData({ ...formData, selectedProductIds: productsList.map((p) => p.id) })}
                      >
                        Chọn tất cả
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-muted-foreground"
                        onClick={() => setFormData({ ...formData, selectedProductIds: [] })}
                      >
                        Bỏ chọn
                      </Button>
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto rounded-lg border border-border p-2 space-y-1.5 bg-muted/20">
                    {productsList.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground">Đang tải danh sách sản phẩm...</div>
                    ) : (
                      productsList.map((prod) => {
                        const selected = formData.selectedProductIds.includes(prod.id)
                        const overridePrice = formData.productOverrides[prod.id]?.specialPrice
                        const pct = Number(formData.discountPercent) || 0
                        const amt = Number(formData.discountAmount) || 0
                        const effectivePrice =
                          overridePrice ??
                          (pct > 0
                            ? Math.round(prod.sellPrice * (1 - pct / 100))
                            : amt > 0
                              ? Math.max(0, prod.sellPrice - amt)
                              : prod.sellPrice)
                        const savedPct =
                          prod.sellPrice > 0
                            ? Math.max(0, Math.round(((prod.sellPrice - effectivePrice) / prod.sellPrice) * 100))
                            : 0
                        return (
                          <div
                            key={prod.id}
                            className={`flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                              selected
                                ? 'bg-primary/10 text-primary border border-primary/30 font-medium'
                                : 'hover:bg-muted text-foreground'
                            }`}
                          >
                            <div
                              onClick={() => toggleProduct(prod.id)}
                              className="flex flex-1 items-center gap-2 cursor-pointer"
                            >
                              <div className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'bg-primary border-primary text-white' : 'border-muted-foreground'}`}>
                                {selected && <Check className="h-3 w-3 stroke-[3]" />}
                              </div>
                              <span>{prod.name}</span>
                              <span className="text-muted-foreground font-mono">({prod.sku})</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-muted-foreground">
                                Gốc: {formatVND(prod.sellPrice)}
                              </span>
                              {selected && (
                                <>
                                  <Input
                                    type="number"
                                    min={0}
                                    step={5000}
                                    value={overridePrice ?? ''}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setProductSpecialPrice(prod.id, e.target.value)}
                                    placeholder="Giá riêng đợt (đ)"
                                    className="h-7 w-32 bg-background font-mono text-xs text-foreground"
                                    title="Nhập giá ưu đãi đặc biệt riêng cho sản phẩm này trong đợt hiện tại (để trống = dùng % giảm chung)"
                                  />
                                  <Badge
                                    variant="outline"
                                    className="border-emerald-300 bg-emerald-50 font-mono text-[11px] font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                                  >
                                    = {formatVND(effectivePrice)} (-{savedPct}%)
                                  </Badge>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setFormModalOpen(false)}>
                Hủy bỏ
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
                {isEditing ? 'Lưu thay đổi' : 'Tạo chiến dịch'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DETAIL MODAL */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          {selectedCampaign && (
            <div>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-lg font-bold">{selectedCampaign.name || selectedCampaign.title}</DialogTitle>
                  {renderStatusBadge(selectedCampaign.status)}
                </div>
                <DialogDescription className="font-mono text-xs">
                  Mã: {selectedCampaign.code}
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 space-y-4 text-xs">
                {selectedCampaign.description && (
                  <div className="rounded-lg bg-muted/40 p-3 text-muted-foreground italic">
                    "{selectedCampaign.description}"
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 rounded-lg border p-3">
                  <div>
                    <span className="text-muted-foreground block">Bắt đầu:</span>
                    <span className="font-semibold">{formatDateTime(selectedCampaign.startDate)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Kết thúc:</span>
                    <span className="font-semibold">{formatDateTime(selectedCampaign.endDate)}</span>
                  </div>
                </div>

                {/* Pricing / Voucher */}
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="font-semibold text-sm">Chính sách ưu đãi CRM:</div>
                  <div className="flex flex-wrap gap-2">
                    {selectedCampaign.discountPercent && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                        Giảm {selectedCampaign.discountPercent}%
                      </Badge>
                    )}
                    {selectedCampaign.discountAmount && (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                        Giảm {formatVND(selectedCampaign.discountAmount)}
                      </Badge>
                    )}
                    {selectedCampaign.voucherCode && (
                      <Badge variant="outline" className="text-amber-600 border-amber-300">
                        Voucher: {selectedCampaign.voucherCode}
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Products list */}
                {selectedCampaign.products && selectedCampaign.products.length > 0 && (
                  <div className="space-y-2">
                    <div className="font-semibold text-sm">
                      Sản phẩm áp dụng ({selectedCampaign.products.length}):
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border p-2 bg-muted/20">
                      {selectedCampaign.products.map((p) => (
                        <div key={p.id} className="flex items-center justify-between py-1 border-b last:border-0">
                          <div>
                            <span className="font-medium">{p.name}</span>
                            <span className="ml-1 text-muted-foreground font-mono">({p.sku})</span>
                          </div>
                          <div className="text-right">
                            {p.campaignPrice && p.originalPrice && p.campaignPrice < p.originalPrice ? (
                              <div className="flex items-center gap-1.5">
                                <span className="line-through text-muted-foreground">{formatVND(p.originalPrice)}</span>
                                <span className="font-bold text-emerald-600">{formatVND(p.campaignPrice)}</span>
                              </div>
                            ) : (
                              <span className="font-bold">{formatVND(p.price)}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter className="mt-5 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDetailModalOpen(false)
                    void handleOpenWaves(selectedCampaign)
                  }}
                  className="gap-1.5"
                >
                  <Layers className="h-4 w-4 text-amber-600" /> Lịch sử các Đợt thay đổi
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setDetailModalOpen(false)
                    handleTriggerAutoSocial(selectedCampaign.id)
                  }}
                  className="gap-1.5"
                >
                  <Sparkles className="h-4 w-4" /> Tạo bài viết AI Auto Social
                </Button>
                <Button variant="outline" size="sm" onClick={() => setDetailModalOpen(false)}>
                  Đóng
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* CAMPAIGN WAVES HISTORY & ROLLBACK MODAL */}
      <Dialog open={wavesModalOpen} onOpenChange={setWavesModalOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Layers className="h-5 w-5 text-amber-600" />
              Quản lý &amp; So sánh Sự thay đổi từng Đợt — {wavesCampaign?.name || wavesCampaign?.code}
            </DialogTitle>
            <DialogDescription>
              Mỗi lần điều chỉnh % chiết khấu, mã Voucher, thời gian hoặc giá đặc biệt từng sản phẩm đều được lưu thành một Đợt độc lập để đối chiếu Trước/Sau và khôi phục tức thì.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {wavesLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Đang tải lịch sử các đợt chương trình...
              </div>
            ) : campaignWaves.length === 0 ? (
              <div className="rounded-lg border p-6 text-center text-xs text-muted-foreground">
                Chưa có đợt điều chỉnh nào được ghi nhận cho chương trình này.
              </div>
            ) : (
              campaignWaves.map((w) => (
                <div
                  key={w.id}
                  className={`rounded-lg border p-3.5 transition-all ${
                    w.isActive
                      ? 'border-emerald-400 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{w.waveCode}</span>
                        <span className="text-sm font-bold">{w.waveName}</span>
                        {w.isActive ? (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                            ĐANG ÁP DỤNG
                          </Badge>
                        ) : (
                          <Badge variant="secondary">ĐỢT LỊCH SỬ</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Thời điểm ghi nhận: <strong>{formatDateTime(w.createdAt)}</strong> · Người lập:{' '}
                        <strong>{w.actorName}</strong>
                      </p>
                    </div>

                    {!w.isActive && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7 text-xs"
                        disabled={waveActivating === w.waveCode}
                        onClick={() => void handleActivateCampaignWave(w.waveCode)}
                      >
                        {waveActivating === w.waveCode && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                        Khôi phục &amp; Áp dụng Đợt này
                      </Button>
                    )}
                  </div>

                  {w.waveNote && (
                    <p className="mt-2 rounded bg-muted/50 px-2.5 py-1.5 text-xs italic text-muted-foreground">
                      “{w.waveNote}”
                    </p>
                  )}

                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Ưu đãi chung</span>
                      <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                        {w.snapshot.discountPercent
                          ? `Giảm ${w.snapshot.discountPercent}%`
                          : w.snapshot.discountAmount
                            ? `Giảm ${formatVND(w.snapshot.discountAmount)}`
                            : 'Theo từng SP'}
                      </p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Mã Voucher</span>
                      <p className="font-mono font-semibold">{w.snapshot.voucherCode || 'Không kèm'}</p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Số SP áp dụng</span>
                      <p className="font-semibold">{w.snapshot.appliedProductIds?.length || 0} sản phẩm</p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Giá đặc biệt riêng</span>
                      <p className="font-semibold">
                        {Object.keys(w.snapshot.productOverrides || {}).length} SP ghi đè
                      </p>
                    </div>
                  </div>

                  {w.changedSummary && w.changedSummary.length > 0 && (
                    <div className="mt-2.5 space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        Sự thay đổi trong đợt này ({w.changedSummary.length} mục):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {w.changedSummary.map((d, idx) => (
                          <span
                            key={`${w.id}-diff-${idx}`}
                            className="inline-flex items-center gap-1 rounded border border-amber-300/80 bg-amber-50/70 px-2 py-0.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                          >
                            <strong>{d.label}:</strong>
                            <span className="opacity-75">{d.before}</span>
                            <ArrowRight className="h-3 w-3 shrink-0" />
                            <strong className="text-emerald-700 dark:text-emerald-300">{d.after}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setWavesModalOpen(false)
                if (wavesCampaign) handleOpenEdit(wavesCampaign)
              }}
            >
              <Edit3 className="mr-1.5 h-3.5 w-3.5" /> Tạo Đợt điều chỉnh mới cho chương trình này
            </Button>
            <Button variant="outline" size="sm" onClick={() => setWavesModalOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* DELETE CONFIRM DIALOG */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> Xác nhận xóa chương trình
            </DialogTitle>
            <DialogDescription>
              Bạn có chắc chắn muốn xóa chương trình "{campaignToDelete?.name}"? Thao tác này sẽ xóa các liên kết chiến dịch và không thể hoàn tác.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4">
            <Button variant="outline" size="sm" onClick={() => setDeleteModalOpen(false)}>
              Hủy
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={deleting}
            >
              {deleting && <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />}
              Xác nhận xóa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
