'use client'

// Vận chuyển: theo dõi hành trình đơn hàng với các đơn vị vận chuyển,
// Agent Kho vận tự báo shipper khi đóng gói xong + đối soát tiền COD với ĐVVC.

import { useCallback, useEffect, useState } from 'react'
import {
  Banknote,
  CalendarClock,
  CheckCheck,
  HandCoins,
  Loader2,
  PackageCheck,
  Printer,
  Truck,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StatCard } from '@/components/cms/stat-card'
import { ChannelBadge } from '@/components/cms/channel-badge'
import { AgentBadge, ShipmentStatusBadge } from '@/components/cms/agent-badge'
import { ShipmentLabelDialog } from '@/components/cms/shipment-label-dialog'
import { apiGet, apiPatch } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { CARRIERS, SHIPMENT_STATUS_LABELS } from '@/lib/agents'
import type { Shipment } from '@/lib/types'
import { formatDateTime, formatVND, timeAgo } from '@/lib/format'

interface ShipmentsData {
  shipments: Shipment[]
  stats: {
    active: number
    deliveredToday: number
    dispatchedToday: number
    codPendingCount: number
    codPendingAmount: number
    codReceivedToday: number
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

// Badge đối soát COD: màu theo trạng thái, chỉ hiện tiền khi có thu hộ
const COD_BADGE_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  RECEIVED: 'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-400 dark:border-sky-900',
  RECONCILED:
    'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
}

function CodBadge({ shipment }: { shipment: Shipment }) {
  if (shipment.codAmount <= 0) {
    return (
      <Badge variant="outline" className="whitespace-nowrap text-[11px] text-muted-foreground">
        Không thu hộ
      </Badge>
    )
  }
  const amount = formatVND(shipment.codAmount)
  const label =
    shipment.codStatus === 'PENDING'
      ? `Chờ đối soát · ${amount}`
      : shipment.codStatus === 'RECEIVED'
        ? `Đã nhận ${amount}`
        : shipment.codStatus === 'RECONCILED'
          ? `Đã đối soát ${amount}`
          : shipment.codStatus
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-medium ${COD_BADGE_STYLES[shipment.codStatus] ?? ''}`}>
      {label}
    </Badge>
  )
}

export function ShipmentsView() {
  const { toast } = useToast()
  const [data, setData] = useState<ShipmentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('ALL')
  const [codStatus, setCodStatus] = useState('ALL')
  const [labelShipment, setLabelShipment] = useState<Shipment | null>(null)
  const [codBusyId, setCodBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ShipmentsData>(`/api/shipments?status=${status}&codStatus=${codStatus}`)
      setData(d)
    } catch {
      // giữ dữ liệu cũ
    } finally {
      setLoading(false)
    }
  }, [status, codStatus])

  useEffect(() => {
    void load()
  }, [load])

  useRealtime((e) => {
    if (['shipment.updated', 'order.updated'].includes(e.type)) {
      void load()
    }
  })

  // Ghi nhận ĐVVC đã thu hộ tiền COD (backend tự nhận đủ codAmount + ghi Sổ Data)
  const markCodReceived = async (s: Shipment) => {
    setCodBusyId(s.id)
    try {
      await apiPatch<{ shipment: Shipment }>(`/api/shipments/${s.id}`, { codStatus: 'RECEIVED' })
      toast({
        title: `Đã ghi nhận nhận COD ${formatVND(s.codAmount)} — đơn ${s.order?.code ?? '—'}`,
        description: 'ĐVVC đã thu hộ — chờ tiền về và bấm "Đối soát xong" để chốt sổ.',
      })
      await load()
    } catch (err) {
      toast({ title: 'Không thể ghi nhận COD', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setCodBusyId(null)
    }
  }

  // Chốt sổ: tiền COD đã về — backend ghi COD_RECONCILED vào Sổ Data
  const reconcileCod = async (s: Shipment) => {
    setCodBusyId(s.id)
    try {
      await apiPatch<{ shipment: Shipment }>(`/api/shipments/${s.id}`, { codStatus: 'RECONCILED' })
      toast({
        title: `Đã đối soát COD đơn ${s.order?.code ?? '—'}`,
        description: `${formatVND(s.codReceived || s.codAmount)} đã về — chốt vào Sổ Data.`,
      })
      await load()
    } catch (err) {
      toast({ title: 'Không thể đối soát COD', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setCodBusyId(null)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard title="Đang vận chuyển" value={String(data?.stats.active ?? 0)} icon={Truck} loading={loading} iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950" />
        <StatCard title="Đã giao hôm nay" value={String(data?.stats.deliveredToday ?? 0)} icon={PackageCheck} loading={loading} iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950" />
        <StatCard title="Đã báo ĐVVC hôm nay" value={String(data?.stats.dispatchedToday ?? 0)} icon={CalendarClock} loading={loading} hint="Agent tự báo khi đóng gói xong" iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-950" />
        <StatCard
          title="COD chờ đối soát"
          value={formatVND(data?.stats.codPendingAmount ?? 0)}
          icon={Banknote}
          loading={loading}
          hint={`${data?.stats.codPendingCount ?? 0} vận đơn chờ ĐVVC chuyển về`}
          iconClassName="bg-amber-100 text-amber-600 dark:bg-amber-950"
        />
        <StatCard
          title="COD nhận hôm nay"
          value={formatVND(data?.stats.codReceivedToday ?? 0)}
          icon={HandCoins}
          loading={loading}
          iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950"
        />
      </div>

      <Card className="border-border/70 p-0 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-semibold">Hành trình vận chuyển</h3>
              <p className="text-xs text-muted-foreground">Cập nhật realtime từ các đơn vị vận chuyển: GHN · GHTK · Viettel Post · J&T · Ninja Van</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-full sm:w-44" aria-label="Lọc trạng thái vận chuyển">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
                  {Object.entries(SHIPMENT_STATUS_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={codStatus} onValueChange={setCodStatus}>
                <SelectTrigger className="w-full sm:w-40" aria-label="Lọc đối soát COD">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Mọi đối soát COD</SelectItem>
                  <SelectItem value="PENDING">Chờ đối soát</SelectItem>
                  <SelectItem value="RECEIVED">Đã nhận COD</SelectItem>
                  <SelectItem value="RECONCILED">Đã đối soát</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã đơn</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead className="hidden md:table-cell">Kênh</TableHead>
                  <TableHead>Đơn vị vận chuyển</TableHead>
                  <TableHead className="hidden sm:table-cell">Mã vận đơn</TableHead>
                  <TableHead className="hidden lg:table-cell">Phí ship</TableHead>
                  <TableHead>Báo bởi</TableHead>
                  <TableHead>Trạng thái</TableHead>
                  <TableHead className="hidden md:table-cell">Đối soát COD</TableHead>
                  <TableHead className="hidden md:table-cell">Cập nhật</TableHead>
                  <TableHead>Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={11}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (data?.shipments ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="h-32 text-center text-sm text-muted-foreground">
                      Chưa có vận đơn nào. Agent sẽ tự báo ĐVVC ngay khi đơn được đóng gói.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.shipments.map((s) => {
                    const carrier = CARRIERS.find((c) => c.key === s.carrier)
                    const codBusy = codBusyId !== null
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs font-medium">{s.order?.code ?? '—'}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{s.order?.customer?.name ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">{s.order?.customer?.phone ?? ''}</p>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <ChannelBadge channel={s.order?.channel ?? null} />
                        </TableCell>
                        <TableCell>
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: carrier?.color ?? '#999' }} />
                            {carrier?.name ?? s.carrier}
                          </span>
                        </TableCell>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{s.trackingCode}</TableCell>
                        <TableCell className="hidden lg:table-cell text-sm">{formatVND(s.fee)}</TableCell>
                        <TableCell>
                          {s.dispatchedBy === 'AGENT' ? (
                            <AgentBadge agent="LOGISTICS_AGENT" />
                          ) : (
                            <Badge variant="outline" className="text-[11px]">Người vận hành</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <ShipmentStatusBadge status={s.status} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <CodBadge shipment={s} />
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <p className="text-xs text-muted-foreground">{formatDateTime(s.updatedAt)}</p>
                          <p className="text-[11px] text-muted-foreground/70">{timeAgo(s.updatedAt)}</p>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                              title="In phiếu gửi hàng"
                              aria-label="In phiếu gửi hàng"
                              onClick={() => setLabelShipment(s)}
                            >
                              <Printer className="h-4 w-4" />
                            </Button>
                            {s.codAmount > 0 && s.codStatus === 'PENDING' && (
                              <Button
                                size="sm"
                                className="h-8 gap-1.5 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
                                disabled={codBusy}
                                onClick={() => void markCodReceived(s)}
                              >
                                {codBusyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <HandCoins className="h-3.5 w-3.5" />}
                                Nhận COD
                              </Button>
                            )}
                            {s.codAmount > 0 && s.codStatus === 'RECEIVED' && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 gap-1.5 px-2.5 text-xs"
                                disabled={codBusy}
                                onClick={() => void reconcileCod(s)}
                              >
                                {codBusyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                                Đối soát xong
                              </Button>
                            )}
                            {(s.codAmount <= 0 || s.codStatus === 'RECONCILED') && (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Dialog in phiếu gửi hàng A6 — giữ vận đơn đang mở để realtime reload không đóng dialog */}
      <ShipmentLabelDialog
        open={!!labelShipment}
        onOpenChange={(o) => {
          if (!o) setLabelShipment(null)
        }}
        shipment={labelShipment}
      />
    </div>
  )
}
