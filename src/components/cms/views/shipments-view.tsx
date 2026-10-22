'use client'

// Vận chuyển: theo dõi hành trình đơn hàng với các đơn vị vận chuyển,
// Agent Kho vận tự báo shipper khi đóng gói xong.

import { useCallback, useEffect, useState } from 'react'
import { PackageCheck, Truck, CalendarClock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { apiGet } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { CARRIERS, SHIPMENT_STATUS_LABELS } from '@/lib/agents'
import type { Shipment } from '@/lib/types'
import { formatDateTime, formatVND, timeAgo } from '@/lib/format'

interface ShipmentsData {
  shipments: Shipment[]
  stats: { active: number; deliveredToday: number; dispatchedToday: number }
}

export function ShipmentsView() {
  const [data, setData] = useState<ShipmentsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState('ALL')

  const load = useCallback(async () => {
    try {
      const d = await apiGet<ShipmentsData>(`/api/shipments?status=${status}`)
      setData(d)
    } catch {
      // giữ dữ liệu cũ
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  useRealtime((e) => {
    if (['shipment.updated', 'order.updated'].includes(e.type)) {
      void load()
    }
  })

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard title="Đang vận chuyển" value={String(data?.stats.active ?? 0)} icon={Truck} loading={loading} iconClassName="bg-orange-100 text-orange-600 dark:bg-orange-950" />
        <StatCard title="Đã giao hôm nay" value={String(data?.stats.deliveredToday ?? 0)} icon={PackageCheck} loading={loading} iconClassName="bg-emerald-100 text-emerald-600 dark:bg-emerald-950" />
        <StatCard title="Đã báo ĐVVC hôm nay" value={String(data?.stats.dispatchedToday ?? 0)} icon={CalendarClock} loading={loading} hint="Agent tự báo khi đóng gói xong" iconClassName="bg-violet-100 text-violet-600 dark:bg-violet-950" />
      </div>

      <Card className="border-border/70 p-0 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold">Hành trình vận chuyển</h3>
              <p className="text-xs text-muted-foreground">Cập nhật realtime từ các đơn vị vận chuyển: GHN · GHTK · Viettel Post · J&T · Ninja Van</p>
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-full sm:w-48" aria-label="Lọc trạng thái vận chuyển">
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
                  <TableHead className="hidden md:table-cell">Cập nhật</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : (data?.shipments ?? []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-32 text-center text-sm text-muted-foreground">
                      Chưa có vận đơn nào. Agent sẽ tự báo ĐVVC ngay khi đơn được đóng gói.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.shipments.map((s) => {
                    const carrier = CARRIERS.find((c) => c.key === s.carrier)
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
                          <p className="text-xs text-muted-foreground">{formatDateTime(s.updatedAt)}</p>
                          <p className="text-[11px] text-muted-foreground/70">{timeAgo(s.updatedAt)}</p>
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
    </div>
  )
}
