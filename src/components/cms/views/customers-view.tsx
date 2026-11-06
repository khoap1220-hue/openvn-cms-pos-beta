'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatNumber, formatVND, formatDate } from '@/lib/format'
import type { Customer, MemberTier, MemberTierInfo, VoucherInfo } from '@/lib/types'
import { MEMBER_TIERS, POINTS_VND_RATE } from '@/lib/types'
import type {
  LoyaltyPolicyConfig,
  LoyaltyPolicyWave,
  CustomizableTierConfig,
  TierKey,
} from '@/lib/loyalty-policy-shared'
import { DEFAULT_LOYALTY_CONFIG, simulateLoyaltyOrderImpact } from '@/lib/loyalty-policy-shared'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { OrderStatusBadge } from '@/components/cms/status-badge'
import { DataLineageBadge, LineageInspectorDialog } from '@/components/cms/lineage'
import type { LineageInspectorTarget } from '@/components/cms/lineage'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
import {
  Users,
  Wallet,
  Crown,
  Trophy,
  Sparkles,
  Search,
  UserPlus,
  Loader2,
  UserX,
  ChevronRight,
  Coins,
  Plus,
  Minus,
  History,
  BadgeCheck,
  Gift,
  RefreshCw,
  Brain,
  Settings2,
  Layers,
  ArrowRight,
  CheckCircle2,
  Edit3,
} from 'lucide-react'

interface CustomerFormState {
  name: string
  phone: string
  email: string
  address: string
}

const EMPTY_FORM: CustomerFormState = { name: '', phone: '', email: '', address: '' }

interface CustomersStats {
  totalCustomers: number
  memberCount: number
  customerCount: number
  pointsIssued: number
}

interface DetailOrder {
  id: string
  code: string
  status: string
  total: number
  paymentMethod: string
  createdAt: string
}

interface CustomerDetail {
  customer: Customer
  orders: DetailOrder[]
}

/** Khách hàng + 2 field nguồn gốc (GET /api/customers trả kèm) — cho Badge Nguồn gốc & Lịch sử */
type CustomerWithLineage = Customer & { originSource?: string | null; changeCount?: number }

// Tra cấu hình hạng (badge/bar class) theo key — server trả MemberTierInfo (key/label/ngưỡng)
const TIER_BY_KEY = Object.fromEntries(MEMBER_TIERS.map((t) => [t.key, t])) as Record<string, MemberTier>
const tierBar = (key: string): string => TIER_BY_KEY[key]?.bar ?? 'bg-stone-400'

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function parseJsonObject(raw: string | null | undefined): { gender?: string; ageHint?: string; style?: string; note?: string } | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Avatar khách: ưu tiên avatarUrl (DiceBear) — lỗi/ẩn thì về chữ cái đầu
function CustomerAvatar({ name, avatarUrl, className }: { name: string; avatarUrl?: string | null; className?: string }) {
  const [broken, setBroken] = useState(false)
  if (avatarUrl && !broken) {
    return (
       
      <img src={avatarUrl} alt={`Avatar ${name}`} className={`${className ?? 'h-9 w-9'} shrink-0 rounded-full object-cover`} onError={() => setBroken(true)} />
    )
  }
  return <ProductAvatar name={name} className={className} />
}

// ===== Badge hạng thành viên (cục bộ) =====
function TierBadge({ tier, className }: { tier?: MemberTierInfo | null; className?: string }) {
  if (!tier) return null
  const config = TIER_BY_KEY[tier.key]
  return (
    <Badge variant="outline" className={`gap-1 font-semibold ${config?.badge ?? ''} ${className ?? ''}`}>
      <Crown className="h-3 w-3" />
      {tier.label}
    </Badge>
  )
}

export function CustomersView() {
  const [customers, setCustomers] = useState<CustomerWithLineage[] | null>(null)
  const [stats, setStats] = useState<CustomersStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState<'ALL' | 'MEMBER' | 'CUSTOMER'>('ALL')

  // Dialog thêm khách hàng
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  // Dialog chi tiết khách hàng / thành viên
  const [detail, setDetail] = useState<CustomerDetail | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  // Dialog cộng / trừ điểm
  const [pointsMode, setPointsMode] = useState<'EARN' | 'REDEEM' | null>(null)
  const [pointsInput, setPointsInput] = useState('')
  const [pointsNote, setPointsNote] = useState('')
  const [pointsSubmitting, setPointsSubmitting] = useState(false)

  // Tóm tắt lại trí nhớ khách
  const [memorySummarizing, setMemorySummarizing] = useState(false)

  // Quản lý Chương trình Khuyến mãi & Mã Voucher
  const [vouchers, setVouchers] = useState<VoucherInfo[]>([])
  const [voucherDialogOpen, setVoucherDialogOpen] = useState(false)
  const [voucherForm, setVoucherForm] = useState({
    code: '',
    title: '',
    discountType: 'PERCENT',
    discountValue: '10',
    maxDiscount: '50000',
    minOrderAmount: '200000',
    scope: 'ALL',
  })
  const [voucherSubmitting, setVoucherSubmitting] = useState(false)

  // Quản lý Tùy biến Chính sách Điểm & Lịch sử các Đợt thay đổi (Policy Waves)
  const [activeWave, setActiveWave] = useState<LoyaltyPolicyWave | null>(null)
  const [policyWaves, setPolicyWaves] = useState<LoyaltyPolicyWave[]>([])
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false)
  const [wavesDialogOpen, setWavesDialogOpen] = useState(false)
  const [policySaving, setPolicySaving] = useState(false)
  const [waveActivating, setWaveActivating] = useState<string | null>(null)
  const [policySaveMode, setPolicySaveMode] = useState<'NEW_WAVE' | 'UPDATE_CURRENT'>('NEW_WAVE')
  const [policyTab, setPolicyTab] = useState<'RULES' | 'TIERS' | 'SCHEDULE'>('RULES')
  const [simOrderAmount, setSimOrderAmount] = useState<number>(500_000)
  const [simTierKey, setSimTierKey] = useState<TierKey>('GOLD')
  const [policyForm, setPolicyForm] = useState<{
    targetWaveCode: string
    name: string
    changeNote: string
    effectiveFrom: string
    effectiveTo: string
    activateImmediately: boolean
    config: LoyaltyPolicyConfig
  }>({
    targetWaveCode: 'DOT-2026-01',
    name: 'Đợt mới · Tùy biến Chính sách Hội viên & Điểm thưởng',
    changeNote: 'Điều chỉnh tỷ lệ tích điểm, tiêu điểm và ngưỡng hạng hội viên theo đợt kinh doanh mới.',
    effectiveFrom: new Date().toISOString().slice(0, 16),
    effectiveTo: '',
    activateImmediately: true,
    config: DEFAULT_LOYALTY_CONFIG,
  })

  // Truy xuất nguồn gốc & lịch sử thay đổi (Sổ Data) — 1 dialog dùng chung, mở từ badge trên từng dòng
  const [lineageTarget, setLineageTarget] = useState<LineageInspectorTarget | null>(null)
  const openLineage = (c: CustomerWithLineage) =>
    setLineageTarget({
      entityType: 'Customer',
      entityId: c.id,
      entityCode: c.memberCode ?? c.phone ?? c.name,
      label: c.name,
    })

  // Debounce ô tìm kiếm 400ms
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(
    async (keyword: string, scope: 'ALL' | 'MEMBER' | 'CUSTOMER') => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (keyword) params.set('search', keyword)
        if (scope !== 'ALL') params.set('scope', scope)
        const qs = params.toString()
        const [data, vchRes, polRes] = await Promise.all([
          apiGet<{ customers: CustomerWithLineage[]; stats: CustomersStats }>(`/api/customers${qs ? `?${qs}` : ''}`),
          apiGet<{ vouchers: VoucherInfo[] }>('/api/vouchers').catch(() => ({ vouchers: [] })),
          apiGet<{ activeWave: LoyaltyPolicyWave; policy: LoyaltyPolicyConfig; waves: LoyaltyPolicyWave[] }>(
            '/api/loyalty-policy'
          ).catch(() => null),
        ])
        setCustomers(data.customers)
        setStats(data.stats)
        setVouchers(vchRes.vouchers)
        if (polRes) {
          setActiveWave(polRes.activeWave)
          setPolicyWaves(polRes.waves)
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Không thể tải khách hàng'
        setError(message)
        toast({ title: 'Lỗi tải dữ liệu', description: message, variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void load(search, scopeFilter)
  }, [load, search, scopeFilter])

  const handleCreateVoucher = async () => {
    if (!voucherForm.code.trim() || !voucherForm.title.trim()) {
      toast({ title: 'Vui lòng nhập Mã giảm giá và Tên chương trình', variant: 'destructive' })
      return
    }
    setVoucherSubmitting(true)
    try {
      await apiPost('/api/vouchers', {
        code: voucherForm.code.trim().toUpperCase(),
        title: voucherForm.title.trim(),
        discountType: voucherForm.discountType,
        discountValue: Number(voucherForm.discountValue) || 10,
        maxDiscount: voucherForm.discountType === 'PERCENT' ? Number(voucherForm.maxDiscount) || null : null,
        minOrderAmount: Number(voucherForm.minOrderAmount) || 0,
        scope: voucherForm.scope,
      })
      toast({ title: `Đã lưu mã khuyến mãi ${voucherForm.code.toUpperCase()}` })
      setVoucherDialogOpen(false)
      setVoucherForm({
        code: '',
        title: '',
        discountType: 'PERCENT',
        discountValue: '10',
        maxDiscount: '50000',
        minOrderAmount: '200000',
        scope: 'ALL',
      })
      const vchRes = await apiGet<{ vouchers: VoucherInfo[] }>('/api/vouchers')
      setVouchers(vchRes.vouchers)
    } catch (e) {
      toast({
        title: 'Không thể lưu mã khuyến mãi',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setVoucherSubmitting(false)
    }
  }

  const handleToggleVoucher = async (id: string) => {
    try {
      await apiPost('/api/vouchers', { action: 'TOGGLE', id })
      const vchRes = await apiGet<{ vouchers: VoucherInfo[] }>('/api/vouchers')
      setVouchers(vchRes.vouchers)
    } catch {
      toast({ title: 'Không thể đổi trạng thái mã giảm giá', variant: 'destructive' })
    }
  }

  const openEditVoucher = (v: VoucherInfo) => {
    setVoucherForm({
      code: v.code,
      title: v.title,
      discountType: v.discountType,
      discountValue: String(v.discountValue),
      maxDiscount: v.maxDiscount ? String(v.maxDiscount) : '',
      minOrderAmount: String(v.minOrderAmount ?? 0),
      scope: v.scope || 'ALL',
    })
    setVoucherDialogOpen(true)
  }

  const openPolicyDialog = (wave?: LoyaltyPolicyWave, mode: 'NEW_WAVE' | 'UPDATE_CURRENT' = 'NEW_WAVE') => {
    const baseWave = wave ?? activeWave
    const nextWaveNum = (policyWaves.reduce((m, w) => Math.max(m, w.waveNumber), 0) || 1) + 1
    setPolicySaveMode(mode)
    setPolicyForm({
      targetWaveCode: baseWave?.waveCode || 'DOT-2026-01',
      name:
        mode === 'NEW_WAVE'
          ? `Đợt ${nextWaveNum} · Tùy biến Chính sách Hội viên & Điểm thưởng`
          : baseWave?.name || 'Đợt 1 · Chính sách Hội viên Tiêu chuẩn',
      changeNote:
        mode === 'NEW_WAVE'
          ? `Tùy biến tỷ lệ tích/tiêu điểm và quyền lợi 4 hạng hội viên cho Đợt ${nextWaveNum}.`
          : baseWave?.changeNote || '',
      effectiveFrom: (baseWave?.effectiveFrom || new Date().toISOString()).slice(0, 16),
      effectiveTo: baseWave?.effectiveTo ? baseWave.effectiveTo.slice(0, 16) : '',
      activateImmediately: true,
      config: structuredClone(baseWave?.config ?? DEFAULT_LOYALTY_CONFIG),
    })
    setPolicyDialogOpen(true)
  }

  const applyPolicyPreset = (preset: 'STANDARD' | 'AN_NHIEN_THACH' | 'VIP_YEAR_END') => {
    if (preset === 'STANDARD') {
      setPolicyForm((prev) => ({
        ...prev,
        name: 'Đợt Chính sách Hội viên Tiêu chuẩn Ưu Đàm (1đ/10k · Đổi 1đ=1k)',
        changeNote: 'Áp dụng quy chế tiêu chuẩn: tích 1 điểm / 10.000đ, tiêu 1 điểm = 1.000đ, ngưỡng Bạc 1tr / Vàng 3tr / Kim cương 6tr.',
        config: structuredClone(DEFAULT_LOYALTY_CONFIG),
      }))
    } else if (preset === 'AN_NHIEN_THACH') {
      setPolicyForm((prev) => ({
        ...prev,
        name: 'Đợt Lễ Hội An Nhiên Thạch — Nhân Hệ Số Điểm Hạng (x1.2–x2.0) & Tặng 15đ Mở Thẻ',
        changeNote: 'Kích cầu bộ sưu tập Thạch Cao & Nến Bấc Gỗ: Tặng +15 điểm mở thẻ, hạ ngưỡng Vàng (2.5tr) & Kim cương (5tr), nhân hệ số điểm x1.2–x2.0 theo hạng.',
        config: {
          earnVndPerPoint: 10_000,
          redeemVndPerPoint: 1_000,
          maxRedeemPct: 50,
          minOrderForRedeem: 200_000,
          welcomeBonusPoints: 15,
          freeShippingThreshold: 400_000,
          pointExpiryMonths: 12,
          tiers: [
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[0],
              pointsMultiplier: 1.0,
              tierDiscountPct: 0,
              perks: 'Tặng +15 điểm mở thẻ · Tích 1đ/10k · Đổi điểm giảm tới 50% đơn',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[1],
              threshold: 1_000_000,
              pointsMultiplier: 1.2,
              tierDiscountPct: 2,
              perks: 'Nhân x1.2 điểm tích lũy · Ưu đãi -2% dòng Thạch Cao & Nến Bấc Gỗ',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[2],
              threshold: 2_500_000,
              pointsMultiplier: 1.5,
              tierDiscountPct: 5,
              perks: 'Hạ ngưỡng lên hạng còn 2,5 triệu · Nhân x1.5 điểm · Tặng tinh dầu xông thạch cao',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[3],
              threshold: 5_000_000,
              pointsMultiplier: 2.0,
              tierDiscountPct: 8,
              perks: 'Hạ ngưỡng Kim cương còn 5 triệu · Nhân đôi x2.0 điểm · Ưu đãi VIP -8% & Freeship mọi đơn',
            },
          ],
        },
      }))
    } else if (preset === 'VIP_YEAR_END') {
      setPolicyForm((prev) => ({
        ...prev,
        name: 'Đợt Tri Ân VIP Cuối Năm — Tích Nhanh 1đ/5.000đ & Nâng Giá Trị Điểm 1đ=1.500đ',
        changeNote: 'Đợt tri ân khách hàng thân thiết cuối năm: tăng gấp đôi tốc độ tích điểm (5.000đ = 1 điểm), nâng giá trị đổi điểm lên 1.500đ/điểm và tặng 30 điểm mở thẻ.',
        config: {
          earnVndPerPoint: 5_000,
          redeemVndPerPoint: 1_500,
          maxRedeemPct: 60,
          minOrderForRedeem: 150_000,
          welcomeBonusPoints: 30,
          freeShippingThreshold: 350_000,
          pointExpiryMonths: 18,
          tiers: [
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[0],
              pointsMultiplier: 1.0,
              tierDiscountPct: 0,
              perks: 'Tặng +30 điểm mở thẻ · Tích điểm 1đ/5.000đ · Đổi 1đ = 1.500đ',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[1],
              threshold: 800_000,
              pointsMultiplier: 1.3,
              tierDiscountPct: 3,
              perks: 'Hạ ngưỡng Bạc 800k · Nhân x1.3 điểm · Giảm trực tiếp 3%',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[2],
              threshold: 2_000_000,
              pointsMultiplier: 1.6,
              tierDiscountPct: 6,
              perks: 'Hạ ngưỡng Vàng 2 triệu · Nhân x1.6 điểm · Giảm 6% + Quà tặng nến bấc gỗ',
            },
            {
              ...DEFAULT_LOYALTY_CONFIG.tiers[3],
              threshold: 4_500_000,
              pointsMultiplier: 2.5,
              tierDiscountPct: 10,
              perks: 'Hạ ngưỡng Kim cương 4.5 triệu · Nhân x2.5 điểm · Đặc quyền VIP -10%',
            },
          ],
        },
      }))
    }
  }

  const updateTierField = (
    idx: number,
    field: keyof CustomizableTierConfig,
    value: string | number
  ) => {
    setPolicyForm((prev) => {
      const nextTiers = [...prev.config.tiers]
      nextTiers[idx] = {
        ...nextTiers[idx],
        [field]: value,
      }
      return {
        ...prev,
        config: {
          ...prev.config,
          tiers: nextTiers,
        },
      }
    })
  }

  const handleSavePolicyWave = async () => {
    if (!policyForm.name.trim()) {
      toast({ title: 'Vui lòng nhập tên Đợt chính sách', variant: 'destructive' })
      return
    }
    setPolicySaving(true)
    try {
      const payload =
        policySaveMode === 'UPDATE_CURRENT'
          ? {
              action: 'UPDATE_WAVE',
              waveCode: policyForm.targetWaveCode,
              name: policyForm.name.trim(),
              changeNote: policyForm.changeNote.trim(),
              effectiveFrom: policyForm.effectiveFrom ? new Date(policyForm.effectiveFrom).toISOString() : undefined,
              effectiveTo: policyForm.effectiveTo ? new Date(policyForm.effectiveTo).toISOString() : null,
              config: policyForm.config,
            }
          : {
              action: 'CREATE_WAVE',
              name: policyForm.name.trim(),
              changeNote: policyForm.changeNote.trim(),
              effectiveFrom: policyForm.effectiveFrom ? new Date(policyForm.effectiveFrom).toISOString() : undefined,
              effectiveTo: policyForm.effectiveTo ? new Date(policyForm.effectiveTo).toISOString() : null,
              activateImmediately: policyForm.activateImmediately,
              config: policyForm.config,
            }

      const res = await apiPost<{
        activeWave: LoyaltyPolicyWave
        waves: LoyaltyPolicyWave[]
      }>('/api/loyalty-policy', payload)
      setActiveWave(res.activeWave)
      setPolicyWaves(res.waves)
      setPolicyDialogOpen(false)
      toast({
        title:
          policySaveMode === 'UPDATE_CURRENT'
            ? `Đã cập nhật cấu hình ${policyForm.targetWaveCode}`
            : `Đã lưu & áp dụng đợt chính sách mới (${res.activeWave.waveCode})`,
        description: res.activeWave.name,
      })
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Không thể lưu cấu hình đợt chính sách',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setPolicySaving(false)
    }
  }

  const handleActivatePolicyWave = async (waveCode: string) => {
    setWaveActivating(waveCode)
    try {
      const res = await apiPost<{
        activeWave: LoyaltyPolicyWave
        waves: LoyaltyPolicyWave[]
      }>('/api/loyalty-policy', {
        action: 'ACTIVATE_WAVE',
        waveCode,
      })
      setActiveWave(res.activeWave)
      setPolicyWaves(res.waves)
      toast({
        title: `Đã kích hoạt áp dụng ${res.activeWave.waveCode}`,
        description: res.activeWave.name,
      })
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Không thể kích hoạt đợt chính sách',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setWaveActivating(null)
    }
  }

  const openAddDialog = () => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Vui lòng nhập tên khách hàng', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      await apiPost<{ customer: Customer }>('/api/customers', {
        name: form.name,
        phone: form.phone,
        email: form.email,
        address: form.address,
      })
      toast({ title: 'Đã thêm khách hàng', description: form.name.trim() })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Thêm khách hàng thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // ===== Chi tiết khách hàng =====
  const refreshDetail = useCallback(async (customerId: string) => {
    const data = await apiGet<CustomerDetail>(`/api/customers/${customerId}`)
    setDetail(data)
    return data
  }, [])

  const openDetail = async (customerId: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    try {
      await refreshDetail(customerId)
    } catch (e) {
      toast({
        title: 'Không thể tải chi tiết khách hàng',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
      setDetailOpen(false)
    } finally {
      setDetailLoading(false)
    }
  }

  // ===== Tóm tắt lại trí nhớ (memory engine chạy lại cho khách này) =====
  const handleSummarizeMemory = async () => {
    if (!detail || memorySummarizing) return
    setMemorySummarizing(true)
    try {
      await apiPost(`/api/customers/${detail.customer.id}/memory`, {})
      await refreshDetail(detail.customer.id)
      toast({ title: 'Đã tóm tắt lại trí nhớ', description: `Hồ sơ của ${detail.customer.name} được chắt lọc lại từ toàn bộ đơn/chat/đánh giá.` })
    } catch (e) {
      toast({
        title: 'Không tóm tắt được trí nhớ',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setMemorySummarizing(false)
    }
  }

  // ===== Nâng cấp thành viên =====
  const [inlineUpgradingId, setInlineUpgradingId] = useState<string | null>(null)

  const handleQuickUpgradeInline = async (customerId: string) => {
    setInlineUpgradingId(customerId)
    try {
      const res = await apiPost<{ customer: Customer }>(`/api/customers/${customerId}/member`, {})
      toast({
        title: `Đã mở thẻ Hội viên ${res.customer.memberCode}`,
        description: `${res.customer.name} · Điểm hiện tại: ${res.customer.points ?? 0} điểm`,
      })
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Nâng cấp thành viên thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setInlineUpgradingId(null)
    }
  }

  const handleUpgrade = async () => {
    if (!detail) return
    setUpgrading(true)
    try {
      const res = await apiPost<{ customer: Customer }>(`/api/customers/${detail.customer.id}/member`, {})
      toast({
        title: 'Đã nâng cấp thành viên',
        description: `${res.customer.name} — mã thành viên ${res.customer.memberCode}`,
      })
      setUpgradeOpen(false)
      await refreshDetail(detail.customer.id)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Nâng cấp thành viên thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setUpgrading(false)
    }
  }

  // ===== Cộng / trừ điểm =====
  const openPointsDialog = (mode: 'EARN' | 'REDEEM') => {
    setPointsMode(mode)
    setPointsInput('')
    setPointsNote('')
  }

  const handlePoints = async () => {
    if (!detail || !pointsMode) return
    const amount = Number(pointsInput)
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({ title: 'Số điểm phải là số nguyên dương', variant: 'destructive' })
      return
    }
    if (pointsMode === 'REDEEM' && amount > (detail.customer.points ?? 0)) {
      toast({
        title: 'Vượt số điểm hiện có',
        description: `Thành viên chỉ còn ${detail.customer.points ?? 0} điểm`,
        variant: 'destructive',
      })
      return
    }
    setPointsSubmitting(true)
    try {
      const res = await apiPost<{ customer: Customer }>(`/api/customers/${detail.customer.id}/points`, {
        mode: pointsMode,
        points: amount,
        note: pointsNote,
      })
      toast({
        title: pointsMode === 'EARN' ? `Đã cộng ${amount} điểm` : `Đã trừ ${amount} điểm`,
        description: `${res.customer.name} — hiện có ${res.customer.points} điểm`,
      })
      setPointsMode(null)
      await refreshDetail(detail.customer.id)
      await load(search, scopeFilter)
    } catch (e) {
      toast({
        title: 'Cập nhật điểm thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setPointsSubmitting(false)
    }
  }

  const totals = useMemo(() => {
    const list = customers ?? []
    const totalSpent = list.reduce((s, c) => s + (c.stats?.totalSpent ?? 0), 0)
    const top = list.reduce<Customer | null>((best, c) => {
      if (!c.stats) return best
      if (!best?.stats || c.stats.totalSpent > best.stats.totalSpent) return c
      return best
    }, null)
    return { totalSpent, top }
  }, [customers])

  const memberPct = stats && stats.totalCustomers > 0 ? Math.round((stats.memberCount / stats.totalCustomers) * 100) : 0
  const detailTier = detail?.customer.isMember ? detail.customer.tier : null

  // % tiến độ tới hạng kế của 1 dòng trong bảng (member)
  const tierProgress = (c: Customer): { pct: number; bar: string } | null => {
    if (!c.isMember || !c.tier) return null
    return { pct: c.tier.progressPct ?? 0, bar: tierBar(c.tier.key) }
  }

  return (
    <div>
      <PageHeader
        title="Khách hàng"
        description="Khách hàng ⇒ Thành viên: quản lý hồ sơ, nâng cấp thành viên, tích điểm và hạng thân thiết"
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Tổng khách hàng"
          value={loading ? '' : formatNumber(stats?.totalCustomers ?? 0)}
          icon={Users}
          loading={loading}
          hint="Toàn bộ khách hàng trong hệ thống"
        />
        <StatCard
          title="Thành viên"
          value={loading ? '' : formatNumber(stats?.memberCount ?? 0)}
          icon={Crown}
          loading={loading}
          hint={`+${formatNumber(stats?.customerCount ?? 0)} khách hàng thường · ${memberPct}% chuyển đổi`}
        />
        <StatCard
          title="Tổng doanh thu từ khách"
          value={loading ? '' : formatVND(totals.totalSpent)}
          icon={Wallet}
          loading={loading}
          hint="Không tính đơn đã hủy"
        />
        <StatCard
          title="Điểm đã phát hành"
          value={loading ? '' : formatNumber(stats?.pointsIssued ?? 0)}
          icon={Sparkles}
          loading={loading}
          hint={`Quy đổi 1 điểm / ${formatNumber(activeWave?.config.earnVndPerPoint ?? POINTS_VND_RATE)}₫`}
        />
        <StatCard
          title="Khách chi tiêu cao nhất"
          value={loading ? '' : totals.top?.name ?? '—'}
          icon={Trophy}
          loading={loading}
          hint={totals.top?.stats ? `Đã chi ${formatVND(totals.top.stats.totalSpent)}` : 'Chưa có dữ liệu'}
        />
      </div>

      {/* Thanh Quy chế 4 Hạng Hội viên & Quản lý Tùy biến theo Đợt */}
      <Card className="mb-5 border-border/80 bg-muted/20 shadow-xs">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <Gift className="h-4 w-4 text-primary" />
                  Quy chế 4 Hạng Hội Viên &amp; Chương trình Khuyến mãi / Voucher
                </p>
                {activeWave && (
                  <Badge
                    variant="outline"
                    className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
                  >
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Đang áp dụng: {activeWave.waveCode} · {activeWave.name}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Tích lũy tự động{' '}
                <strong>
                  1 điểm / {formatNumber(activeWave?.config.earnVndPerPoint ?? POINTS_VND_RATE)}₫
                </strong>{' '}
                khi đơn hoàn tất · Tiêu điểm tại POS/Đơn hàng:{' '}
                <strong>
                  1 điểm = {formatNumber(activeWave?.config.redeemVndPerPoint ?? 1000)}₫
                </strong>{' '}
                (Tối đa {activeWave?.config.maxRedeemPct ?? 100}%/đơn)
                {(activeWave?.config.welcomeBonusPoints ?? 0) > 0 && (
                  <>
                    {' '}
                    · Mở thẻ tặng <strong>+{activeWave?.config.welcomeBonusPoints} điểm</strong>
                  </>
                )}{' '}
                · Tự động{' '}
                <strong>
                  Freeship cho đơn ≥ {formatVND(activeWave?.config.freeShippingThreshold ?? 500000)}
                </strong>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  setPolicyTab('RULES')
                  openPolicyDialog(activeWave ?? undefined, 'NEW_WAVE')
                }}
              >
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                Tùy biến Chính sách &amp; Tạo Đợt mới
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setWavesDialogOpen(true)}
              >
                <Layers className="mr-1 h-3.5 w-3.5" />
                Quản lý các Đợt thay đổi ({policyWaves.length || 2} đợt)
              </Button>
              <Button size="sm" variant="outline" onClick={() => setVoucherDialogOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Tạo Mã Khuyến Mãi (Voucher)
              </Button>
            </div>
          </div>

          {/* Thanh Chuyển Đợt Chính Sách (Quick Wave Switcher) ngay ngoài màn hình chính */}
          {policyWaves.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background/80 px-2.5 py-1.5">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Chuyển đợt chính sách:
              </span>
              {policyWaves.map((w) => {
                const isAct = w.status === 'ACTIVE'
                return (
                  <button
                    key={w.waveCode}
                    type="button"
                    disabled={isAct || waveActivating === w.waveCode}
                    onClick={() => void handleActivatePolicyWave(w.waveCode)}
                    title={w.name}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-all ${
                      isAct
                        ? 'border-emerald-500 bg-emerald-600 font-semibold text-white shadow-xs'
                        : 'border-border bg-muted/60 text-foreground hover:border-primary/50 hover:bg-primary/10'
                    }`}
                  >
                    {waveActivating === w.waveCode ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isAct ? (
                      <CheckCircle2 className="h-3 w-3" />
                    ) : null}
                    <span className="font-mono font-bold">{w.waveCode}</span>
                    <span className="max-w-[200px] truncate">{w.name.replace(/^Đợt\s*\d+\s*·\s*/i, '')}</span>
                    <span className="opacity-80">
                      (1đ/{formatNumber(w.config.earnVndPerPoint / 1000)}k · x
                      {w.config.tiers[3]?.pointsMultiplier ?? 1})
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(activeWave?.config.tiers ?? DEFAULT_LOYALTY_CONFIG.tiers).map((t) => (
              <div key={t.key} className="rounded-lg border bg-card p-2.5 text-xs">
                <div className="flex items-center justify-between gap-1">
                  <Badge variant="outline" className={`font-semibold ${t.badge}`}>
                    <Crown className="mr-1 h-3 w-3" />
                    {t.label}
                  </Badge>
                  <span className="font-mono text-[11px] font-semibold text-muted-foreground">
                    {t.threshold === 0 ? 'Mặc định' : `≥ ${formatVND(t.threshold)}`}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                    Tích điểm x{t.pointsMultiplier}
                  </Badge>
                  {t.tierDiscountPct > 0 && (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                    >
                      Ưu đãi hạng -{t.tierDiscountPct}%
                    </Badge>
                  )}
                </div>
                {t.perks && (
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground" title={t.perks}>
                    {t.perks}
                  </p>
                )}
              </div>
            ))}
          </div>

          {vouchers.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
              <span className="text-xs font-semibold text-muted-foreground">Voucher đang chạy:</span>
              {vouchers.map((v) => (
                <div
                  key={v.id}
                  className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-all ${
                    v.active
                      ? 'border-emerald-300 bg-emerald-50/80 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                      : 'border-border bg-muted text-muted-foreground opacity-60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleToggleVoucher(v.id)}
                    title="Bấm để Bật / Tạm ngưng mã này"
                    className={`flex items-center gap-1.5 ${!v.active ? 'line-through' : ''}`}
                  >
                    <span className="font-mono font-bold">{v.code}</span>
                    <span>· {v.title}</span>
                    <span className="text-[10px] opacity-80">(Đã dùng: {v.usedCount})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditVoucher(v)}
                    title={`Chỉnh sửa cấu hình mã ${v.code}`}
                    className="ml-1 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Toolbar: tìm kiếm + lọc thành viên + thêm khách hàng */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Tìm tên, SĐT, email, mã TV..."
              className="pl-9"
              aria-label="Tìm kiếm khách hàng"
            />
          </div>
          <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as 'ALL' | 'MEMBER' | 'CUSTOMER')}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Lọc loại khách hàng">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tất cả</SelectItem>
              <SelectItem value="MEMBER">Thành viên</SelectItem>
              <SelectItem value="CUSTOMER">Khách hàng thường</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={openAddDialog} className="shrink-0">
          <UserPlus className="h-4 w-4" />
          Thêm khách hàng
        </Button>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={() => void load(search, scopeFilter)} />
          ) : !customers || customers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={search || scopeFilter !== 'ALL' ? UserX : Users}
                title={search || scopeFilter !== 'ALL' ? 'Không tìm thấy khách hàng nào' : 'Chưa có khách hàng nào'}
                description={
                  search || scopeFilter !== 'ALL'
                    ? 'Không có kết quả phù hợp với bộ lọc hiện tại. Thử từ khóa hoặc bộ lọc khác.'
                    : 'Thêm khách hàng đầu tiên để bắt đầu quản lý đơn hàng.'
                }
                action={
                  <Button onClick={openAddDialog}>
                    <UserPlus className="h-4 w-4" />
                    Thêm khách hàng
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table tableId="customers-main">
                <TableHeader>
                  <TableRow>
                    <TableHead locked>Khách hàng</TableHead>
                    <TableHead>Hạng thành viên</TableHead>
                    <TableHead defaultHidden>Mã Hội viên</TableHead>
                    <TableHead className="hidden md:table-cell">Nguồn gốc &amp; Lịch sử</TableHead>
                    <TableHead>Số điện thoại</TableHead>
                    <TableHead defaultHidden>Email</TableHead>
                    <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
                    <TableHead className="text-right">Số đơn</TableHead>
                    <TableHead className="text-right">Tổng chi tiêu</TableHead>
                    <TableHead defaultHidden className="text-right">Giá trị TB/Đơn</TableHead>
                    <TableHead className="w-32 text-right">Điểm</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Đơn cuối</TableHead>
                    <TableHead defaultHidden className="text-right">Ngày tham gia</TableHead>
                    <TableHead locked aria-label="Chi tiết" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => {
                    const progress = tierProgress(c)
                    const orderCount = c.stats?.orderCount ?? 0
                    const totalSpent = c.stats?.totalSpent ?? 0
                    const aov = orderCount > 0 ? Math.round(totalSpent / orderCount) : 0
                    return (
                      <TableRow
                        key={c.id}
                        className="cursor-pointer"
                        onClick={() => void openDetail(c.id)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ProductAvatar name={c.name} className="h-9 w-9" />
                            <div className="min-w-0">
                              <p className="truncate font-medium">{c.name}</p>
                              <p className="truncate text-xs text-muted-foreground">{c.email || 'Chưa có email'}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => !c.isMember && e.stopPropagation()}>
                          {c.isMember ? (
                            <div className="flex flex-col items-start gap-1">
                              <TierBadge tier={c.tier} />
                              <span className="font-mono text-[10px] text-muted-foreground">{c.memberCode}</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-1">
                              <span className="text-xs text-muted-foreground">Khách thường</span>
                              <button
                                type="button"
                                disabled={inlineUpgradingId === c.id}
                                onClick={() => void handleQuickUpgradeInline(c.id)}
                                title="Mở thẻ Hội viên (tự cấp mã TV & cộng điểm thưởng mở thẻ)"
                                className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50/80 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200"
                              >
                                {inlineUpgradingId === c.id ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                ) : (
                                  <Sparkles className="h-2.5 w-2.5" />
                                )}
                                + Mở thẻ TV
                              </button>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {c.memberCode || '—'}
                        </TableCell>
                        {/* stopPropagation: bấm badge không mở dialog chi tiết (cả dòng đang có onClick mở chi tiết) */}
                        <TableCell className="hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                          <DataLineageBadge
                            originSource={c.originSource}
                            changeCount={c.changeCount}
                            onInspect={() => openLineage(c)}
                            compact
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">{c.phone || '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.email || '—'}</TableCell>
                        <TableCell className="hidden max-w-[220px] md:table-cell">
                          <span className="block truncate text-sm text-muted-foreground" title={c.address ?? undefined}>
                            {c.address || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{formatNumber(orderCount)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatVND(totalSpent)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {aov > 0 ? formatVND(aov) : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {c.isMember ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className="font-mono text-sm font-semibold tabular-nums">
                                {formatNumber(c.points ?? 0)} điểm
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                ≈ {formatVND((c.points ?? 0) * (activeWave?.config.redeemVndPerPoint ?? 1000))}
                              </span>
                              {progress && (
                                <div className="h-1 w-20 overflow-hidden rounded-full bg-muted" title={`Tiến độ tới hạng kế: ${progress.pct}%`}>
                                  <div className={`h-full rounded-full ${progress.bar}`} style={{ width: `${progress.pct}%` }} />
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                          {c.stats?.lastOrderAt ? formatDate(c.stats.lastOrderAt) : '—'}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {c.createdAt ? formatDate(c.createdAt) : '—'}
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
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

      {/* Dialog thêm khách hàng */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm khách hàng</DialogTitle>
            <DialogDescription>Điền thông tin khách hàng mới. Chỉ tên là bắt buộc.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="customer-name">
                Tên khách hàng <span className="text-destructive">*</span>
              </Label>
              <Input
                id="customer-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nguyễn Văn A"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="customer-phone">Số điện thoại</Label>
                <Input
                  id="customer-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="0901234567"
                  inputMode="tel"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="customer-email">Email</Label>
                <Input
                  id="customer-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="khach@email.com"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-address">Địa chỉ</Label>
              <Textarea
                id="customer-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={submitting || !form.name.trim()}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Thêm khách hàng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog chi tiết khách hàng / thành viên — Bố cục 2 cột rộng rãi trên màn hình lớn */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl">
          {detailLoading || !detail ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="sr-only">Chi tiết khách hàng</DialogTitle>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-3 pt-1">
                  <div className="flex items-start gap-3">
                    <CustomerAvatar name={detail.customer.name} avatarUrl={detail.customer.avatarUrl} className="h-12 w-12 text-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-lg font-bold leading-tight">{detail.customer.name}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {detail.customer.phone || 'Chưa có SĐT'}
                        {detail.customer.email ? ` · ${detail.customer.email}` : ''}
                        {detail.customer.address ? ` · ${detail.customer.address}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {detail.customer.salutation && (
                          <Badge variant="outline" className="border-emerald-300 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                            {detail.customer.salutation}
                          </Badge>
                        )}
                        {detail.customer.isMember ? (
                          <>
                            <TierBadge tier={detailTier} />
                            <span className="font-mono text-xs font-semibold text-muted-foreground">{detail.customer.memberCode}</span>
                          </>
                        ) : (
                          <Badge variant="outline" className="font-medium text-muted-foreground">Khách hàng thường</Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Thanh thao tác nhanh ngay góc trên của Chi tiết khách hàng */}
                  <div className="flex flex-wrap items-center gap-2">
                    {detail.customer.isMember ? (
                      <>
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => openPointsDialog('EARN')}>
                          <Plus className="h-3.5 w-3.5 text-emerald-600" />
                          Cộng điểm thưởng
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 text-xs"
                          onClick={() => openPointsDialog('REDEEM')}
                          disabled={(detail.customer.points ?? 0) <= 0}
                        >
                          <Minus className="h-3.5 w-3.5 text-amber-600" />
                          Trừ điểm (đổi quà)
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setUpgradeOpen(true)}>
                        <Sparkles className="h-3.5 w-3.5" />
                        Nâng cấp Hội viên ngay
                      </Button>
                    )}
                  </div>
                </div>
              </DialogHeader>

              {/* Lưới 2 cột trên màn hình lớn: Cột trái (5 phần) = Hạng & Điểm + Chân dung AI | Cột phải (7 phần) = KPI + Lịch sử đơn hàng */}
              <div className="grid gap-5 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-5">
                  {/* Khối thành viên: điểm + hạng / mời gia nhập */}
                  {detail.customer.isMember ? (
                    <div className="rounded-xl border bg-card p-4 shadow-xs">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Điểm tích lũy</p>
                          <p className="mt-0.5 flex items-baseline gap-1.5">
                            <Coins className="h-5 w-5 text-amber-500" aria-hidden />
                            <span className="text-3xl font-bold tabular-nums">{formatNumber(detail.customer.points ?? 0)}</span>
                            <span className="text-sm text-muted-foreground">điểm</span>
                          </p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>Tham gia: {detail.customer.memberAt ? formatDate(detail.customer.memberAt) : '—'}</p>
                          <p className="mt-0.5">1 điểm / {formatNumber(POINTS_VND_RATE)}₫ đơn hoàn tất</p>
                        </div>
                      </div>

                      {/* Tiến độ hạng */}
                      {detailTier && (
                        <div className="mt-3">
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-medium">{detailTier.label}</span>
                            <span className="text-muted-foreground">
                              {detailTier.nextLabel
                                ? `Cần thêm ${formatVND(Math.max(0, (detailTier.nextThreshold ?? 0) - (detail.customer.stats?.totalSpent ?? 0)))} nữa để lên ${detailTier.nextLabel}`
                                : 'Hạng cao nhất của chương trình'}
                            </span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${tierBar(detailTier.key)}`}
                              style={{ width: `${detailTier.progressPct ?? 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        <Button variant="outline" size="sm" className="flex-1" onClick={() => openPointsDialog('EARN')}>
                          <Plus className="h-4 w-4" />
                          Cộng điểm
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          onClick={() => openPointsDialog('REDEEM')}
                          disabled={(detail.customer.points ?? 0) <= 0}
                        >
                          <Minus className="h-4 w-4" />
                          Trừ điểm (đổi quà)
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-muted/40 p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
                          <Gift className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold">Nâng cấp thành chương trình thành viên</p>
                          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            <li>• Tích 1 điểm / {formatNumber(POINTS_VND_RATE)}₫ mỗi đơn hoàn tất — đổi quà, giảm giá</li>
                            <li>• Hạng tự động: Bạc ({formatVND(1_000_000)}) → Vàng ({formatVND(3_000_000)}) → Kim cương ({formatVND(6_000_000)})</li>
                            <li>• Cấp mã thành viên riêng, ghi nhận vào Sổ Data</li>
                          </ul>
                          <Button size="sm" className="mt-3" onClick={() => setUpgradeOpen(true)}>
                            <Sparkles className="h-4 w-4" />
                            Nâng cấp thành viên
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ===== Chân dung & Trí nhớ AI (Long-term Context Summary) ===== */}
                  <div className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-transparent p-4 dark:border-emerald-900 dark:from-emerald-950/30">
                    <div className="mb-2.5 flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                        <Brain className="h-3.5 w-3.5" aria-hidden />
                        Chân dung & Trí nhớ AI
                      </p>
                      <Button size="sm" variant="outline" className="h-7 gap-1 border-emerald-300 px-2 text-[11px] dark:border-emerald-800" disabled={memorySummarizing} onClick={() => void handleSummarizeMemory()}>
                        <RefreshCw className={memorySummarizing ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                        Tóm tắt lại
                      </Button>
                    </div>

                    {(() => {
                      const profile = parseJsonObject(detail.customer.inferredProfile)
                      const prefs = parseJsonArray(detail.customer.preferences)
                      const pains = parseJsonArray(detail.customer.painPoints)
                      return (
                        <div className="space-y-2.5">
                          {profile && (profile.gender || profile.ageHint || profile.style) && (
                            <div className="flex flex-wrap gap-1.5">
                              {profile.gender && <Badge variant="outline" className="text-[11px] font-normal">{profile.gender}</Badge>}
                              {profile.ageHint && <Badge variant="outline" className="text-[11px] font-normal">{profile.ageHint}</Badge>}
                              {profile.style && <Badge variant="outline" className="text-[11px] font-normal">{profile.style}</Badge>}
                            </div>
                          )}

                          {detail.customer.contextSummary ? (
                            <p className="text-xs leading-relaxed text-foreground/90">{detail.customer.contextSummary}</p>
                          ) : (
                            <p className="text-xs italic text-muted-foreground">Chưa có tóm tắt — bấm «Tóm tắt lại» để AI chắt lọc từ toàn bộ đơn/chat/đánh giá.</p>
                          )}

                          {prefs.length > 0 && (
                            <div>
                              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Sở thích / Nhu cầu</p>
                              <div className="flex flex-wrap gap-1.5">
                                {prefs.map((p, i) => (
                                  <Badge key={i} variant="outline" className="bg-background text-[11px] font-normal">{p}</Badge>
                                ))}
                              </div>
                            </div>
                          )}

                          {pains.length > 0 && (
                            <div>
                              <p className="mb-1 text-[11px] font-semibold text-muted-foreground">Lưu ý / Góp ý cũ</p>
                              <div className="space-y-1">
                                {pains.map((p, i) => (
                                  <p key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">{p}</p>
                                ))}
                              </div>
                            </div>
                          )}

                          {detail.customer.nextFollowUp && (
                            <div className="rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-2 dark:border-violet-900 dark:bg-violet-950">
                              <p className="text-[11px] font-semibold text-violet-700 dark:text-violet-400">Gợi ý chăm sóc tiếp theo</p>
                              <p className="mt-0.5 text-xs leading-relaxed text-violet-900 dark:text-violet-300">{detail.customer.nextFollowUp}</p>
                            </div>
                          )}

                          <p className="text-[10px] text-muted-foreground">
                            {detail.customer.memoryUpdatedAt ? `Chắt lọc lần cuối: ${formatDate(detail.customer.memoryUpdatedAt)}` : 'Chưa chắt lọc'} · tự chạy khi có đơn mới, tin nhắn Zalo, đánh giá sao
                          </p>
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {/* Cột phải (7 phần): Thống kê chi tiêu + Bảng Lịch sử đơn hàng rộng rãi */}
                <div className="space-y-4 lg:col-span-7">
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3 sm:gap-3">
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-[11px] text-muted-foreground">Tổng số đơn</p>
                      <p className="mt-1 text-lg font-bold tabular-nums">
                        {formatNumber(detail.customer.stats?.orderCount ?? detail.orders.length)} đơn
                      </p>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-[11px] text-muted-foreground">Tổng chi tiêu</p>
                      <p className="mt-1 text-lg font-bold tabular-nums text-primary">
                        {formatVND(detail.customer.stats?.totalSpent ?? 0)}
                      </p>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-3">
                      <p className="text-[11px] text-muted-foreground">Giá trị TB / đơn</p>
                      <p className="mt-1 text-lg font-bold tabular-nums">
                        {(detail.customer.stats?.orderCount ?? 0) > 0
                          ? formatVND(
                              Math.round(
                                (detail.customer.stats?.totalSpent ?? 0) /
                                  (detail.customer.stats?.orderCount ?? 1)
                              )
                            )
                          : '0 ₫'}
                      </p>
                    </div>
                  </div>

                  {/* Lịch sử đơn hàng */}
                  <div className="rounded-xl border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <History className="h-4 w-4 text-muted-foreground" aria-hidden />
                        Lịch sử đơn hàng của khách
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(detail.customer.stats?.orderCount ?? 0)} đơn · {formatVND(detail.customer.stats?.totalSpent ?? 0)}
                      </p>
                    </div>
                    {detail.orders.length === 0 ? (
                      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        Khách hàng chưa có đơn hàng nào
                      </p>
                    ) : (
                      <div className="max-h-[420px] overflow-y-auto rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="h-9 text-xs">Mã đơn</TableHead>
                              <TableHead className="h-9 text-xs">Trạng thái</TableHead>
                              <TableHead className="h-9 text-right text-xs">Tổng tiền</TableHead>
                              <TableHead className="h-9 text-right text-xs">Ngày đặt</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.orders.map((o) => (
                              <TableRow key={o.id}>
                                <TableCell className="py-2 font-mono text-xs font-semibold">{o.code}</TableCell>
                                <TableCell className="py-2">
                                  <OrderStatusBadge status={o.status} className="text-[10px]" />
                                </TableCell>
                                <TableCell className="py-2 text-right font-mono text-xs font-semibold tabular-nums">{formatVND(o.total)}</TableCell>
                                <TableCell className="py-2 text-right text-xs text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog xác nhận nâng cấp thành viên */}
      <Dialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="h-5 w-5 text-amber-500" aria-hidden />
              Nâng cấp thành viên
            </DialogTitle>
            <DialogDescription>
              Xác nhận nâng cấp <span className="font-semibold text-foreground">{detail?.customer.name}</span> thành thành viên của chương trình khách hàng thân thiết?
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            <li>• Cấp mã thành viên (TV…) và ngày tham gia</li>
            <li>• Tích 1 điểm / {formatNumber(POINTS_VND_RATE)}₫ cho mỗi đơn hoàn tất từ thời điểm này</li>
            <li>• Hạng Bạc / Vàng / Kim cương tự động theo tổng chi tiêu</li>
            <li>• Thao tác ghi vào Sổ Data (MEMBER_REGISTERED)</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpgradeOpen(false)} disabled={upgrading}>
              Hủy
            </Button>
            <Button onClick={() => void handleUpgrade()} disabled={upgrading}>
              {upgrading && <Loader2 className="h-4 w-4 animate-spin" />}
              Xác nhận nâng cấp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cộng / trừ điểm */}
      <Dialog open={pointsMode !== null} onOpenChange={(open) => !open && setPointsMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pointsMode === 'EARN' ? 'Cộng điểm (bù điểm)' : 'Trừ điểm (đổi quà / giảm giá)'}</DialogTitle>
            <DialogDescription>
              {detail?.customer.name} — hiện có{' '}
              <span className="font-semibold text-foreground">
                {formatNumber(detail?.customer.points ?? 0)} điểm
              </span>{' '}
              (≈{' '}
              {formatVND(
                (detail?.customer.points ?? 0) * (activeWave?.config.redeemVndPerPoint ?? 1000)
              )}
              )
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3.5 py-1">
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="points-amount">
                  Số điểm <span className="text-destructive">*</span>
                </Label>
                <span className="font-mono text-xs font-bold text-emerald-600">
                  = {formatVND((Number(pointsInput) || 0) * (activeWave?.config.redeemVndPerPoint ?? 1000))}
                </span>
              </div>
              <Input
                id="points-amount"
                type="number"
                min={1}
                value={pointsInput}
                onChange={(e) => setPointsInput(e.target.value)}
                placeholder={pointsMode === 'EARN' ? 'VD: 50' : 'VD: 20'}
                autoFocus
                className="font-mono"
              />
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] text-muted-foreground">Chọn nhanh:</span>
                {pointsMode === 'EARN'
                  ? [10, 20, 50, 100].map((pts) => (
                      <button
                        key={pts}
                        type="button"
                        onClick={() => setPointsInput(String(pts))}
                        className="rounded border bg-muted/60 px-2 py-0.5 font-mono text-xs font-semibold hover:bg-primary/10 hover:text-primary"
                      >
                        +{pts}đ ({formatNumber((pts * (activeWave?.config.redeemVndPerPoint ?? 1000)) / 1000)}k)
                      </button>
                    ))
                  : [
                      { label: '-10đ', val: Math.min(10, detail?.customer.points ?? 0) },
                      { label: '-20đ', val: Math.min(20, detail?.customer.points ?? 0) },
                      { label: '50% số dư', val: Math.max(1, Math.floor((detail?.customer.points ?? 0) / 2)) },
                      { label: 'Tất cả', val: detail?.customer.points ?? 0 },
                    ].map((chip) => (
                      <button
                        key={chip.label}
                        type="button"
                        onClick={() => setPointsInput(String(chip.val))}
                        className="rounded border bg-muted/60 px-2 py-0.5 font-mono text-xs font-semibold hover:bg-primary/10 hover:text-primary"
                      >
                        {chip.label} ({chip.val}đ)
                      </button>
                    ))}
              </div>
              {pointsMode === 'REDEEM' && (
                <p className="text-xs text-muted-foreground">Tối đa {formatNumber(detail?.customer.points ?? 0)} điểm.</p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="points-note">Lý do (Chọn mẫu gợi ý hoặc tự nhập)</Label>
              <div className="flex flex-wrap gap-1.5">
                {(pointsMode === 'EARN'
                  ? [
                      'Tặng điểm sinh nhật Hội viên Ưu Đàm',
                      'Thưởng đánh giá 5 sao & ảnh thực tế sản phẩm',
                      'Bù điểm đơn hàng thiếu tại quầy',
                      'Tặng điểm tri ân khách hàng thân thiết',
                    ]
                  : [
                      'Đổi quà tinh dầu xông thạch cao tại quầy',
                      'Đổi nến bấc gỗ mini tri ân Hội viên',
                      'Đổi điểm giảm giá trực tiếp đơn hàng',
                    ]
                ).map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setPointsNote(tpl)}
                    className={`rounded border px-2 py-0.5 text-[11px] transition-all ${
                      pointsNote === tpl
                        ? 'border-primary bg-primary/10 font-semibold text-primary'
                        : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    {tpl}
                  </button>
                ))}
              </div>
              <Textarea
                id="points-note"
                value={pointsNote}
                onChange={(e) => setPointsNote(e.target.value)}
                placeholder={pointsMode === 'EARN' ? 'VD: Bù điểm do sự cố đơn hàng' : 'VD: Đổi voucher giảm 50.000₫'}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPointsMode(null)} disabled={pointsSubmitting}>
              Hủy
            </Button>
            <Button
              onClick={() => void handlePoints()}
              disabled={pointsSubmitting || !pointsInput}
            >
              {pointsSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {pointsMode === 'EARN' ? 'Cộng điểm' : 'Trừ điểm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog Tạo Mã Khuyến Mãi / Voucher */}
      <Dialog open={voucherDialogOpen} onOpenChange={setVoucherDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo Mã Khuyến Mãi (Voucher)</DialogTitle>
            <DialogDescription>
              Mã khuyến mãi sẽ hiển thị trên Quầy POS và màn hình Tạo đơn hàng để nhân viên áp dụng nhanh.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="voucher-code">Mã Voucher *</Label>
                <Input
                  id="voucher-code"
                  value={voucherForm.code}
                  onChange={(e) => setVoucherForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="VD: RAMTHANG7"
                  className="mt-1 font-mono uppercase"
                />
              </div>
              <div>
                <Label>Loại ưu đãi</Label>
                <Select
                  value={voucherForm.discountType}
                  onValueChange={(v) => setVoucherForm((f) => ({ ...f, discountType: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Giảm theo %</SelectItem>
                    <SelectItem value="FIXED">Giảm tiền mặt (đ)</SelectItem>
                    <SelectItem value="FREESHIP">Miễn phí giao hàng</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="voucher-title">Tên chương trình *</Label>
              <Input
                id="voucher-title"
                value={voucherForm.title}
                onChange={(e) => setVoucherForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="VD: Ưu đãi Đại lễ Vu Lan — Giảm 10%"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="voucher-val">
                  {voucherForm.discountType === 'PERCENT' ? 'Mức giảm (%)' : 'Số tiền giảm (đ)'}
                </Label>
                <Input
                  id="voucher-val"
                  type="number"
                  min={1}
                  value={voucherForm.discountValue}
                  onChange={(e) => setVoucherForm((f) => ({ ...f, discountValue: e.target.value }))}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="voucher-min">Đơn tối thiểu (đ)</Label>
                <Input
                  id="voucher-min"
                  type="number"
                  min={0}
                  step={50000}
                  value={voucherForm.minOrderAmount}
                  onChange={(e) => setVoucherForm((f) => ({ ...f, minOrderAmount: e.target.value }))}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {voucherForm.discountType === 'PERCENT' && (
                <div>
                  <Label htmlFor="voucher-max">Giảm tối đa (đ)</Label>
                  <Input
                    id="voucher-max"
                    type="number"
                    min={0}
                    step={10000}
                    value={voucherForm.maxDiscount}
                    onChange={(e) => setVoucherForm((f) => ({ ...f, maxDiscount: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              )}
              <div>
                <Label>Phạm vi áp dụng</Label>
                <Select
                  value={voucherForm.scope}
                  onValueChange={(v) => setVoucherForm((f) => ({ ...f, scope: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">Toàn hệ thống</SelectItem>
                    <SelectItem value="ALLIANCE">Bán chéo Liên Shop</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoucherDialogOpen(false)} disabled={voucherSubmitting}>
              Hủy
            </Button>
            <Button onClick={() => void handleCreateVoucher()} disabled={voucherSubmitting}>
              {voucherSubmitting && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu Mã Khuyến Mãi
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog 1: Tùy biến Chính sách Điểm & Hạng Hội Viên theo Đợt */}
      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Tùy biến Chính sách Điểm &amp; Hạng Hội viên theo Đợt
            </DialogTitle>
            <DialogDescription>
              Thiết lập linh hoạt theo 3 Tab gọn gàng (không cần cuộn dài), có Bộ mô phỏng lợi ích &amp; biên lợi nhuận trực tiếp và tự động định dạng tiền tệ chống nhầm số 0.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {/* Bộ mẫu cấu hình gợi ý */}
            <div className="rounded-lg border bg-muted/30 p-2.5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  Áp dụng mẫu cấu hình:
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={policySaveMode === 'NEW_WAVE' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setPolicySaveMode('NEW_WAVE')}
                  >
                    Lưu thành Đợt mới
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={policySaveMode === 'UPDATE_CURRENT' ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setPolicySaveMode('UPDATE_CURRENT')}
                  >
                    Cập nhật {policyForm.targetWaveCode}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => applyPolicyPreset('STANDARD')}
                >
                  Mẫu Tiêu Chuẩn (1đ/10k · Đổi 1đ=1k · Hệ số 1x)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-emerald-300 bg-emerald-50/70 text-xs text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                  onClick={() => applyPolicyPreset('AN_NHIEN_THACH')}
                >
                  Mẫu Lễ Hội An Nhiên Thạch (Nhân điểm x1.2–x2.0 · Mở thẻ +15đ)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 border-amber-300 bg-amber-50/70 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                  onClick={() => applyPolicyPreset('VIP_YEAR_END')}
                >
                  Mẫu Tri Ân VIP Cuối Năm (Tích nhanh 1đ/5k · Đổi 1đ=1.5k)
                </Button>
              </div>
            </div>

            {/* BỘ MÔ PHỎNG TRỰC TIẾP (LIVE PROFIT & POINT SIMULATOR) */}
            {(() => {
              const sim = simulateLoyaltyOrderImpact(simOrderAmount, simTierKey, policyForm.config)
              const safetyColor =
                sim.marginSafetyStatus === 'SAFE'
                  ? 'border-emerald-300 bg-emerald-50/80 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : sim.marginSafetyStatus === 'MODERATE'
                    ? 'border-amber-300 bg-amber-50/80 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'border-rose-300 bg-rose-50/80 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
              const safetyLabel =
                sim.marginSafetyStatus === 'SAFE'
                  ? 'An toàn biên lợi nhuận (≤15%)'
                  : sim.marginSafetyStatus === 'MODERATE'
                    ? 'Cân đối kích cầu (15–25%)'
                    : 'Cảnh báo ưu đãi cao (>25%)'
              return (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                      <span className="font-bold">Mô phỏng thử đơn hàng trực tiếp:</span>
                      {[390_000, 500_000, 1_000_000].map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setSimOrderAmount(amt)}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${
                            simOrderAmount === amt
                              ? 'border-primary bg-primary font-bold text-primary-foreground'
                              : 'bg-background hover:bg-muted'
                          }`}
                        >
                          Đơn {formatNumber(amt / 1000)}k
                        </button>
                      ))}
                      <span className="mx-0.5 text-muted-foreground">·</span>
                      {policyForm.config.tiers.map((t) => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setSimTierKey(t.key)}
                          className={`rounded border px-1.5 py-0.5 text-[11px] ${
                            simTierKey === t.key
                              ? 'border-primary bg-primary font-bold text-primary-foreground'
                              : 'bg-background hover:bg-muted'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${safetyColor}`}>
                      Chi phí ưu đãi: {sim.effectiveBenefitPct}% · {safetyLabel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded border bg-background/90 px-2 py-1">
                      <span className="text-[10px] text-muted-foreground">Giảm trực tiếp hạng ({sim.tierDiscountPct}%)</span>
                      <p className="font-mono font-bold text-amber-600">
                        -{formatVND(sim.tierDiscountVnd)}
                      </p>
                    </div>
                    <div className="rounded border bg-background/90 px-2 py-1">
                      <span className="text-[10px] text-muted-foreground">Điểm tích mới cho khách</span>
                      <p className="font-mono font-bold text-emerald-600">
                        +{sim.earnedPoints}đ (≈ {formatVND(sim.earnedPointsValueVnd)})
                      </p>
                    </div>
                    <div className="rounded border bg-background/90 px-2 py-1">
                      <span className="text-[10px] text-muted-foreground">Trần được đổi điểm</span>
                      <p className="font-mono font-semibold">
                        Tối đa {sim.maxRedeemAllowedPoints}đ ({formatVND(sim.maxRedeemAllowedVnd)})
                      </p>
                    </div>
                    <div className="rounded border bg-background/90 px-2 py-1">
                      <span className="text-[10px] text-muted-foreground">Tổng lợi ích khách nhận</span>
                      <p className="font-mono font-bold text-primary">
                        {formatVND(sim.totalBenefitValueVnd)} {sim.isFreeshipEligible ? '+ Freeship' : ''}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* THANH CHUYỂN 3 TAB NGANG (KHÔNG CẦN CUỘN DỌC) */}
            <div className="grid grid-cols-3 gap-1.5 rounded-lg border bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setPolicyTab('RULES')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-all ${
                  policyTab === 'RULES'
                    ? 'bg-background text-primary shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                1. Quy tắc Tích &amp; Đổi điểm (6 mục)
              </button>
              <button
                type="button"
                onClick={() => setPolicyTab('TIERS')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-all ${
                  policyTab === 'TIERS'
                    ? 'bg-background text-primary shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                2. Bảng 4 Hạng Hội viên (x{policyForm.config.tiers[3]?.pointsMultiplier ?? 1})
              </button>
              <button
                type="button"
                onClick={() => setPolicyTab('SCHEDULE')}
                className={`rounded-md py-1.5 text-xs font-semibold transition-all ${
                  policyTab === 'SCHEDULE'
                    ? 'bg-background text-primary shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                3. Tên Đợt &amp; Lịch hẹn áp dụng
              </button>
            </div>

            {/* TAB 1: THÔNG SỐ TÍCH ĐIỂM & TIÊU ĐIỂM (KÈM NHÃN VNĐ CHỐNG NHẦM SỐ 0 & CHIP CHỌN NHANH) */}
            {policyTab === 'RULES' && (
              <div className="rounded-lg border p-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-earn">Chi tiêu tích 1 điểm</Label>
                      <span className="font-mono text-[11px] font-bold text-emerald-600">
                        = {formatVND(policyForm.config.earnVndPerPoint)}
                      </span>
                    </div>
                    <Input
                      id="cfg-earn"
                      type="number"
                      min={1000}
                      step={1000}
                      value={policyForm.config.earnVndPerPoint}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, earnVndPerPoint: Number(e.target.value) || 10000 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[5_000, 10_000, 20_000].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, earnVndPerPoint: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          {v / 1000}k/1đ
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-redeem">Giá trị đổi 1 điểm</Label>
                      <span className="font-mono text-[11px] font-bold text-emerald-600">
                        = {formatVND(policyForm.config.redeemVndPerPoint)}
                      </span>
                    </div>
                    <Input
                      id="cfg-redeem"
                      type="number"
                      min={100}
                      step={100}
                      value={policyForm.config.redeemVndPerPoint}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, redeemVndPerPoint: Number(e.target.value) || 1000 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[500, 1_000, 1_500, 2_000].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, redeemVndPerPoint: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          {formatNumber(v)}đ
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-max-pct">Trần dùng điểm / đơn</Label>
                      <span className="font-mono text-[11px] font-bold text-primary">
                        Tối đa {policyForm.config.maxRedeemPct}%
                      </span>
                    </div>
                    <Input
                      id="cfg-max-pct"
                      type="number"
                      min={5}
                      max={100}
                      value={policyForm.config.maxRedeemPct}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, maxRedeemPct: Number(e.target.value) || 100 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[30, 50, 70, 100].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, maxRedeemPct: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          {v}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-min-order">Đơn tối thiểu đổi điểm</Label>
                      <span className="font-mono text-[11px] font-bold text-emerald-600">
                        = {formatVND(policyForm.config.minOrderForRedeem)}
                      </span>
                    </div>
                    <Input
                      id="cfg-min-order"
                      type="number"
                      min={0}
                      step={50000}
                      value={policyForm.config.minOrderForRedeem}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, minOrderForRedeem: Number(e.target.value) || 0 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[0, 200_000, 350_000, 500_000].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, minOrderForRedeem: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          {v === 0 ? '0đ (Mọi đơn)' : `${v / 1000}k`}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-welcome">Điểm thưởng mở thẻ</Label>
                      <span className="font-mono text-[11px] font-bold text-amber-600">
                        +{policyForm.config.welcomeBonusPoints}đ (≈{' '}
                        {formatVND(policyForm.config.welcomeBonusPoints * policyForm.config.redeemVndPerPoint)})
                      </span>
                    </div>
                    <Input
                      id="cfg-welcome"
                      type="number"
                      min={0}
                      value={policyForm.config.welcomeBonusPoints}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, welcomeBonusPoints: Number(e.target.value) || 0 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[0, 10, 15, 30, 50].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, welcomeBonusPoints: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          +{v}đ
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="cfg-freeship">Ngưỡng Freeship</Label>
                      <span className="font-mono text-[11px] font-bold text-emerald-600">
                        = {formatVND(policyForm.config.freeShippingThreshold)}
                      </span>
                    </div>
                    <Input
                      id="cfg-freeship"
                      type="number"
                      min={0}
                      step={50000}
                      value={policyForm.config.freeShippingThreshold}
                      onChange={(e) =>
                        setPolicyForm((p) => ({
                          ...p,
                          config: { ...p.config, freeShippingThreshold: Number(e.target.value) || 0 },
                        }))
                      }
                      className="mt-1 font-mono"
                    />
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[300_000, 400_000, 500_000].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() =>
                            setPolicyForm((p) => ({ ...p, config: { ...p.config, freeShippingThreshold: v } }))
                          }
                          className="rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                        >
                          ≥ {v / 1000}k
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: BẢNG CẤU HÌNH 4 HẠNG HỘI VIÊN */}
            {policyTab === 'TIERS' && (
              <div className="rounded-lg border p-3">
                <div className="space-y-2">
                  {policyForm.config.tiers.map((t, idx) => (
                    <div
                      key={t.key}
                      className="grid grid-cols-1 gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-12 sm:items-center"
                    >
                      <div className="sm:col-span-3">
                        <Label className="text-[11px] text-muted-foreground">Tên hạng ({t.key})</Label>
                        <Input
                          value={t.label}
                          onChange={(e) => updateTierField(idx, 'label', e.target.value)}
                          className="mt-0.5 h-8 text-xs font-semibold"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] text-muted-foreground">Ngưỡng chi tiêu</Label>
                          <span className="font-mono text-[10px] font-bold text-emerald-600">
                            {t.threshold === 0 ? 'Mặc định' : formatVND(t.threshold)}
                          </span>
                        </div>
                        <Input
                          type="number"
                          min={0}
                          step={100000}
                          disabled={t.key === 'MEMBER'}
                          value={t.threshold}
                          onChange={(e) => updateTierField(idx, 'threshold', Number(e.target.value) || 0)}
                          className="mt-0.5 h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Hệ số nhân điểm</Label>
                        <Input
                          type="number"
                          min={0.5}
                          max={5}
                          step={0.1}
                          value={t.pointsMultiplier}
                          onChange={(e) => updateTierField(idx, 'pointsMultiplier', Number(e.target.value) || 1)}
                          className="mt-0.5 h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Giảm giá hạng (%)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={50}
                          value={t.tierDiscountPct}
                          onChange={(e) => updateTierField(idx, 'tierDiscountPct', Number(e.target.value) || 0)}
                          className="mt-0.5 h-8 font-mono text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Label className="text-[11px] text-muted-foreground">Mô tả đặc quyền</Label>
                        <Input
                          value={t.perks}
                          onChange={(e) => updateTierField(idx, 'perks', e.target.value)}
                          className="mt-0.5 h-8 text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 3: TÊN ĐỢT & LỊCH HẸN ÁP DỤNG */}
            {policyTab === 'SCHEDULE' && (
              <div className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="policy-wave-name">Tên Đợt chính sách *</Label>
                  <Input
                    id="policy-wave-name"
                    value={policyForm.name}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="VD: Đợt 3 · Lễ Hội Cuối Năm — Nhân Đôi Điểm Tích Lũy"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="policy-from">Hiệu lực từ thời điểm</Label>
                  <Input
                    id="policy-from"
                    type="datetime-local"
                    value={policyForm.effectiveFrom}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, effectiveFrom: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="policy-to">Đến thời điểm (để trống = không thời hạn)</Label>
                  <Input
                    id="policy-to"
                    type="datetime-local"
                    value={policyForm.effectiveTo}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, effectiveTo: e.target.value }))}
                    className="mt-1"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="policy-note">Ghi chú / Lý do điều chỉnh của đợt này</Label>
                  <Input
                    id="policy-note"
                    value={policyForm.changeNote}
                    onChange={(e) => setPolicyForm((p) => ({ ...p, changeNote: e.target.value }))}
                    placeholder="VD: Tăng hệ số điểm cho Hạng Vàng/Kim cương và tặng 15 điểm chào mừng"
                    className="mt-1"
                  />
                </div>
                {policySaveMode === 'NEW_WAVE' && (
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-2.5 text-xs">
                    <span className="font-semibold">Chế độ kích hoạt sau khi Lưu:</span>
                    <button
                      type="button"
                      onClick={() => setPolicyForm((p) => ({ ...p, activateImmediately: true }))}
                      className={`rounded border px-2.5 py-1 font-semibold ${
                        policyForm.activateImmediately
                          ? 'border-emerald-500 bg-emerald-600 text-white'
                          : 'bg-background'
                      }`}
                    >
                      Kích hoạt áp dụng ngay lập tức
                    </button>
                    <button
                      type="button"
                      onClick={() => setPolicyForm((p) => ({ ...p, activateImmediately: false }))}
                      className={`rounded border px-2.5 py-1 font-semibold ${
                        !policyForm.activateImmediately
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'bg-background'
                      }`}
                    >
                      Lưu làm Đợt lên lịch sẵn (SCHEDULED)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t pt-3">
            <Button variant="outline" onClick={() => setPolicyDialogOpen(false)} disabled={policySaving}>
              Hủy
            </Button>
            <Button onClick={() => void handleSavePolicyWave()} disabled={policySaving}>
              {policySaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {policySaveMode === 'UPDATE_CURRENT'
                ? `Lưu cập nhật ${policyForm.targetWaveCode}`
                : policyForm.activateImmediately
                  ? 'Lưu & Áp dụng Đợt chính sách mới'
                  : 'Lưu Đợt lên lịch sẵn (SCHEDULED)'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog 2: Quản lý & So sánh Lịch sử các Đợt Chính sách Hội viên */}
      <Dialog open={wavesDialogOpen} onOpenChange={setWavesDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-primary" />
              Quản lý &amp; So sánh Sự thay đổi theo từng Đợt Chính sách Hội viên
            </DialogTitle>
            <DialogDescription>
              Theo dõi toàn bộ các đợt thay đổi quy chế tích điểm &amp; hạng thành viên theo thời gian, đối chiếu sự khác biệt Trước/Sau và chuyển đổi đợt chính sách đang áp dụng.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Tổng cộng <strong>{policyWaves.length} đợt chính sách</strong> được lưu trữ trong Sổ Data (LedgerEntry)
              </span>
              <Button
                size="sm"
                onClick={() => {
                  setWavesDialogOpen(false)
                  openPolicyDialog(activeWave ?? undefined, 'NEW_WAVE')
                }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Tạo Đợt chính sách mới
              </Button>
            </div>

            {policyWaves.map((w) => {
              const isCurrent = w.status === 'ACTIVE'
              return (
                <div
                  key={w.id}
                  className={`rounded-lg border p-3.5 transition-all ${
                    isCurrent
                      ? 'border-emerald-400 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-primary">{w.waveCode}</span>
                        <span className="text-sm font-bold">{w.name}</span>
                        {isCurrent ? (
                          <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">
                            ĐANG ÁP DỤNG
                          </Badge>
                        ) : w.status === 'SCHEDULED' ? (
                          <Badge variant="outline" className="border-violet-400 text-violet-700 dark:text-violet-300">
                            ĐÃ LÊN LỊCH
                          </Badge>
                        ) : (
                          <Badge variant="secondary">ĐÃ LƯU TRỮ</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Hiệu lực từ: <strong>{formatDate(w.effectiveFrom)}</strong>
                        {w.effectiveTo ? ` → ${formatDate(w.effectiveTo)}` : ' → Hiện tại'} · Người lập:{' '}
                        <strong>{w.actorName}</strong>
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!isCurrent && (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 text-xs"
                          disabled={waveActivating === w.waveCode}
                          onClick={() => void handleActivatePolicyWave(w.waveCode)}
                        >
                          {waveActivating === w.waveCode && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                          Kích hoạt áp dụng Đợt này
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setWavesDialogOpen(false)
                          openPolicyDialog(w, 'UPDATE_CURRENT')
                        }}
                      >
                        <Edit3 className="mr-1 h-3 w-3" /> Sửa đợt này
                      </Button>
                    </div>
                  </div>

                  {w.changeNote && (
                    <p className="mt-2 rounded bg-muted/50 px-2.5 py-1.5 text-xs italic text-muted-foreground">
                      “{w.changeNote}”
                    </p>
                  )}

                  {/* Thông số cốt lõi của Đợt */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Tỷ lệ tích điểm</span>
                      <p className="font-semibold">1đ / {formatNumber(w.config.earnVndPerPoint)}₫</p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Giá trị đổi điểm</span>
                      <p className="font-semibold">
                        1đ = {formatNumber(w.config.redeemVndPerPoint)}₫ (≤{w.config.maxRedeemPct}%)
                      </p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Ngưỡng Bạc / Vàng / KC</span>
                      <p className="font-mono text-[11px] font-semibold">
                        {formatNumber((w.config.tiers[1]?.threshold ?? 1000000) / 1000)}k /{' '}
                        {formatNumber((w.config.tiers[2]?.threshold ?? 3000000) / 1000)}k /{' '}
                        {formatNumber((w.config.tiers[3]?.threshold ?? 6000000) / 1000)}k
                      </p>
                    </div>
                    <div className="rounded border bg-background/80 p-2">
                      <span className="text-[10px] text-muted-foreground">Hệ số nhân điểm hạng</span>
                      <p className="font-mono text-[11px] font-semibold">
                        {w.config.tiers.map((t) => `x${t.pointsMultiplier}`).join(' · ')}
                      </p>
                    </div>
                  </div>

                  {/* Bảng Diff so với Đợt liền trước */}
                  {w.changedSummary && w.changedSummary.length > 0 && (
                    <div className="mt-2.5 space-y-1">
                      <p className="text-[11px] font-semibold text-muted-foreground">
                        Sự thay đổi so với đợt trước ({w.changedSummary.length} mục):
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {w.changedSummary.map((d, i) => (
                          <span
                            key={`${w.id}-diff-${i}`}
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

                  {/* Thống kê kết quả thực tế trong đợt */}
                  {w.stats && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-4 border-t pt-2 text-[11px] text-muted-foreground">
                      <span>
                        Đơn hàng trong đợt: <strong className="text-foreground">{w.stats.ordersInWave} đơn</strong>
                      </span>
                      <span>
                        Điểm phát hành: <strong className="text-emerald-600">+{w.stats.pointsEarnedInWave} điểm</strong>
                      </span>
                      <span>
                        Điểm khách đã đổi: <strong className="text-amber-600">-{w.stats.pointsRedeemedInWave} điểm</strong>
                      </span>
                      <span>
                        Hội viên đăng ký mới: <strong className="text-foreground">{w.stats.newMembersInWave} TV</strong>
                      </span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setWavesDialogOpen(false)}>
              Đóng
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Truy xuất nguồn gốc & lịch sử thay đổi (Sổ Data) — dùng chung cho mọi dòng khách hàng */}
      <LineageInspectorDialog
        open={!!lineageTarget}
        onOpenChange={(o) => !o && setLineageTarget(null)}
        target={lineageTarget}
      />
    </div>
  )
}
