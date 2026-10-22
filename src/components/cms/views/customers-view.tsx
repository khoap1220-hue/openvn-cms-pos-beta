'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { formatNumber, formatVND, formatDate } from '@/lib/format'
import type { Customer } from '@/lib/types'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ProductAvatar } from '@/components/cms/product-avatar'
import { Card, CardContent } from '@/components/ui/card'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { Users, Wallet, Crown, Search, UserPlus, Loader2, UserX } from 'lucide-react'

interface CustomerFormState {
  name: string
  phone: string
  email: string
  address: string
}

const EMPTY_FORM: CustomerFormState = { name: '', phone: '', email: '', address: '' }

export function CustomersView() {
  const [customers, setCustomers] = useState<Customer[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<CustomerFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const { toast } = useToast()

  // Debounce ô tìm kiếm 400ms
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(timer)
  }, [searchInput])

  const load = useCallback(
    async (keyword: string) => {
      setLoading(true)
      setError(null)
      try {
        const query = keyword ? `?search=${encodeURIComponent(keyword)}` : ''
        const data = await apiGet<{ customers: Customer[] }>(`/api/customers${query}`)
        setCustomers(data.customers)
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
    void load(search)
  }, [load, search])

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
      await load(search)
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

  const totals = useMemo(() => {
    const list = customers ?? []
    const totalSpent = list.reduce((s, c) => s + (c.stats?.totalSpent ?? 0), 0)
    const top = list.reduce<Customer | null>((best, c) => {
      if (!c.stats) return best
      if (!best?.stats || c.stats.totalSpent > best.stats.totalSpent) return c
      return best
    }, null)
    return { count: list.length, totalSpent, top }
  }, [customers])

  return (
    <div>
      <PageHeader title="Khách hàng" description="Quản lý thông tin và lịch sử mua hàng của khách hàng" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Tổng khách hàng" value={loading ? '' : formatNumber(totals.count)} icon={Users} loading={loading} hint="Toàn bộ khách hàng trong hệ thống" />
        <StatCard
          title="Tổng doanh thu từ khách"
          value={loading ? '' : formatVND(totals.totalSpent)}
          icon={Wallet}
          loading={loading}
          hint="Không tính đơn đã hủy"
        />
        <StatCard
          title="Khách chi tiêu cao nhất"
          value={loading ? '' : totals.top?.name ?? '—'}
          icon={Crown}
          loading={loading}
          hint={totals.top?.stats ? `Đã chi ${formatVND(totals.top.stats.totalSpent)}` : 'Chưa có dữ liệu'}
        />
      </div>

      {/* Toolbar: tìm kiếm + thêm khách hàng */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm theo tên, SĐT hoặc email..."
            className="pl-9"
            aria-label="Tìm kiếm khách hàng"
          />
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
            <ErrorState message={error} onRetry={() => void load(search)} />
          ) : !customers || customers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={search ? UserX : Users}
                title={search ? 'Không tìm thấy khách hàng nào' : 'Chưa có khách hàng nào'}
                description={
                  search
                    ? `Không có kết quả phù hợp với từ khóa "${search}". Thử từ khóa khác.`
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Khách hàng</TableHead>
                    <TableHead>Số điện thoại</TableHead>
                    <TableHead className="hidden md:table-cell">Địa chỉ</TableHead>
                    <TableHead className="text-right">Số đơn</TableHead>
                    <TableHead className="text-right">Tổng chi tiêu</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Đơn cuối</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <ProductAvatar name={c.name} className="h-9 w-9" />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.name}</p>
                            <p className="truncate text-xs text-muted-foreground">{c.email || 'Chưa có email'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{c.phone || '—'}</TableCell>
                      <TableCell className="hidden max-w-[220px] md:table-cell">
                        <span className="block truncate text-sm text-muted-foreground" title={c.address ?? undefined}>
                          {c.address || '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatNumber(c.stats?.orderCount ?? 0)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatVND(c.stats?.totalSpent ?? 0)}</TableCell>
                      <TableCell className="hidden text-right text-sm text-muted-foreground sm:table-cell">
                        {c.stats?.lastOrderAt ? formatDate(c.stats.lastOrderAt) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
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
    </div>
  )
}
