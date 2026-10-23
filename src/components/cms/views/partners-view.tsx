'use client'

import { useCallback, useEffect, useState } from 'react'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader, EmptyState, ErrorState, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
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
import { Building2, Loader2, MoreHorizontal, Pencil, Search, Trash2, Truck, Users } from 'lucide-react'

type PartnerType = 'SUPPLIER' | 'CUSTOMER' | 'BOTH'

interface Partner {
  id: string
  code: string
  name: string
  taxCode: string | null
  address: string | null
  phone: string | null
  email: string | null
  type: PartnerType
  note: string | null
  _count: { purchaseInvoices: number; salesInvoices: number }
}

const TYPE_BADGES: Record<PartnerType, { label: string; className: string }> = {
  SUPPLIER: {
    label: 'Nhà cung cấp',
    className: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  },
  CUSTOMER: {
    label: 'Khách hàng',
    className: 'border-transparent bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  },
  BOTH: {
    label: 'Cả hai',
    className: 'border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  },
}

const TYPE_OPTIONS: PartnerType[] = ['SUPPLIER', 'CUSTOMER', 'BOTH']

interface PartnerFormState {
  name: string
  type: PartnerType
  taxCode: string
  address: string
  phone: string
  email: string
  note: string
}

const EMPTY_FORM: PartnerFormState = {
  name: '',
  type: 'SUPPLIER',
  taxCode: '',
  address: '',
  phone: '',
  email: '',
  note: '',
}

// MST hợp lệ: 10 số (doanh nghiệp) hoặc 13 số (chi nhánh) — chỉ cảnh báo mềm
function isTaxCodeWarn(taxCode: string): boolean {
  return taxCode.trim() !== '' && !/^\d{10}$|^\d{13}$/.test(taxCode.trim())
}

export function PartnersView() {
  const [partners, setPartners] = useState<Partner[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'ALL' | PartnerType>('ALL')

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Partner | null>(null)
  const [form, setForm] = useState<PartnerFormState>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null)
  const [deleting, setDeleting] = useState(false)
  const { toast } = useToast()

  // Debounce search 400ms
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (search) params.set('q', search)
      const res = await apiGet<{ partners: Partner[] }>(`/api/partners?${params.toString()}`)
      setPartners(res.partners)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tải danh sách đối tác'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [search])

  useEffect(() => {
    void load()
  }, [load])

  // Lọc type phía client để luôn gộp BOTH vào cả 2 nhóm
  const filtered = (partners ?? []).filter((p) => {
    if (typeFilter === 'ALL') return true
    if (typeFilter === 'SUPPLIER') return p.type === 'SUPPLIER' || p.type === 'BOTH'
    return p.type === 'CUSTOMER' || p.type === 'BOTH'
  })

  const totalPartners = partners?.length ?? 0
  const supplierCount = (partners ?? []).filter((p) => p.type === 'SUPPLIER' || p.type === 'BOTH').length
  const customerCount = (partners ?? []).filter((p) => p.type === 'CUSTOMER' || p.type === 'BOTH').length

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }

  const openEdit = (partner: Partner) => {
    setEditing(partner)
    setForm({
      name: partner.name,
      type: partner.type,
      taxCode: partner.taxCode ?? '',
      address: partner.address ?? '',
      phone: partner.phone ?? '',
      email: partner.email ?? '',
      note: partner.note ?? '',
    })
    setDialogOpen(true)
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast({ title: 'Vui lòng nhập tên đơn vị', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const body = {
        name: form.name.trim(),
        type: form.type,
        taxCode: form.taxCode.trim() || undefined,
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        note: form.note.trim() || undefined,
      }
      if (editing) {
        await apiPatch<{ partner: Partner }>(`/api/partners/${editing.id}`, body)
        toast({ title: 'Đã cập nhật đối tác', description: body.name })
      } else {
        await apiPost<{ partner: Partner }>('/api/partners', body)
        toast({ title: 'Đã thêm đối tác mới', description: `${body.name} — mã đối tác được tự sinh` })
      }
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      setEditing(null)
      await load()
    } catch (e) {
      toast({
        title: editing ? 'Cập nhật đối tác thất bại' : 'Thêm đối tác thất bại',
        description: e instanceof Error ? e.message : 'Vui lòng thử lại',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiDelete(`/api/partners/${deleteTarget.id}`)
      toast({ title: 'Đã xóa đối tác', description: deleteTarget.name })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể xóa đối tác'
      const isConflict = message.includes('hóa đơn')
      toast({
        title: isConflict ? 'Đối tác đã có hóa đơn — không thể xóa' : 'Xóa đối tác thất bại',
        description: message,
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Đối tác"
        description="Danh mục nhà cung cấp và khách hàng xuất hóa đơn"
      >
        <Button onClick={openCreate}>
          <Building2 className="h-4 w-4" />
          Thêm đối tác
        </Button>
      </PageHeader>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title="Tổng đối tác"
          value={loading ? '' : String(totalPartners)}
          icon={Users}
          loading={loading}
          hint="Nhà cung cấp + khách hàng"
        />
        <StatCard
          title="Nhà cung cấp"
          value={loading ? '' : String(supplierCount)}
          icon={Truck}
          loading={loading}
          hint="Gồm cả đối tác loại Cả hai"
          iconClassName="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        />
        <StatCard
          title="Khách hàng"
          value={loading ? '' : String(customerCount)}
          icon={Users}
          loading={loading}
          hint="Gồm cả đối tác loại Cả hai"
          iconClassName="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400"
        />
      </div>

      {/* Toolbar: search + lọc loại */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Tìm tên, mã số thuế, mã đối tác..."
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'ALL' | PartnerType)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả loại</SelectItem>
            <SelectItem value="SUPPLIER">Nhà cung cấp</SelectItem>
            <SelectItem value="CUSTOMER">Khách hàng</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border/70 shadow-sm">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4">
              <TableSkeleton rows={6} />
            </div>
          ) : error ? (
            <div className="p-4">
              <ErrorState message={error} onRetry={() => void load()} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={Users}
                title="Chưa có đối tác nào"
                description="Thêm nhà cung cấp hoặc khách hàng để bắt đầu xuất hóa đơn."
                action={
                  <Button onClick={openCreate}>
                    <Building2 className="h-4 w-4" />
                    Thêm đối tác
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background">
                  <TableRow>
                    <TableHead>Mã</TableHead>
                    <TableHead>Tên đơn vị</TableHead>
                    <TableHead className="hidden md:table-cell">MST</TableHead>
                    <TableHead className="hidden lg:table-cell">Điện thoại</TableHead>
                    <TableHead>Loại</TableHead>
                    <TableHead className="text-right">HĐ mua / HĐ bán</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-medium">{p.code}</TableCell>
                      <TableCell>
                        <p className="max-w-[220px] truncate font-semibold">{p.name}</p>
                        {p.email && <p className="truncate text-xs text-muted-foreground">{p.email}</p>}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap font-mono text-xs md:table-cell">
                        {p.taxCode ?? '—'}
                      </TableCell>
                      <TableCell className="hidden whitespace-nowrap text-sm lg:table-cell">{p.phone ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('border-transparent', TYPE_BADGES[p.type].className)}>
                          {TYPE_BADGES[p.type].label}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                        <span className="font-medium text-amber-700 dark:text-amber-400">{p._count.purchaseInvoices}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="font-medium text-emerald-700 dark:text-emerald-400">{p._count.salesInvoices}</span>
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEdit(p)}>
                              <Pencil className="h-4 w-4" />
                              Sửa
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleteTarget(p)}>
                              <Trash2 className="h-4 w-4" />
                              Xóa
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog thêm / sửa đối tác */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Sửa đối tác' : 'Thêm đối tác mới'}</DialogTitle>
            <DialogDescription>
              {editing ? `Cập nhật thông tin ${editing.name} (${editing.code})` : 'Mã đối tác sẽ được tự sinh theo loại (NCC/KH).'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="partner-name">
                Tên đơn vị <span className="text-destructive">*</span>
              </Label>
              <Input
                id="partner-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ví dụ: Công ty TNHH Vật tư Minh Phát"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-tax">Mã số thuế</Label>
              <Input
                id="partner-tax"
                value={form.taxCode}
                onChange={(e) => setForm({ ...form, taxCode: e.target.value })}
                placeholder="10 hoặc 13 số"
              />
              {isTaxCodeWarn(form.taxCode) && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  MST thường gồm 10 số (hoặc 13 số nếu có chi nhánh) — vui lòng kiểm tra lại.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-address">Địa chỉ</Label>
              <Input
                id="partner-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Địa chỉ xuất hóa đơn"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="partner-phone">Số điện thoại</Label>
                <Input
                  id="partner-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="09xx xxx xxx"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="partner-email">Email</Label>
                <Input
                  id="partner-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="ketoan@congty.vn"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-type">Loại đối tác</Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as PartnerType })}>
                <SelectTrigger id="partner-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_BADGES[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="partner-note">Ghi chú</Label>
              <Textarea
                id="partner-note"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="Ghi chú thêm về đối tác..."
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
              {editing ? 'Lưu thay đổi' : 'Thêm đối tác'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm xóa đối tác */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Xóa đối tác "${deleteTarget?.name ?? ''}"?`}
        description="Đối tác đã có hóa đơn sẽ không thể xóa. Hành động này không thể hoàn tác."
        confirmText="Xóa đối tác"
        destructive
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  )
}
