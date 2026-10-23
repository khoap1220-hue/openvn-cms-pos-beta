'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/lib/types'

const ORDER_STATUS_STYLES: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  CONFIRMED: 'bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-400 dark:border-teal-900',
  PACKING: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900',
  SHIPPING: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900',
  COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
  CANCELLED: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
}

export function OrderStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('font-medium', ORDER_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground', className)}>
      {ORDER_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const paid = status === 'PAID'
  return (
    <Badge variant="outline" className={cn('font-medium', paid ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900' : 'bg-muted text-muted-foreground')}>
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

export function ProductStatusBadge({ status }: { status: string }) {
  const active = status === 'ACTIVE'
  return (
    <Badge variant="outline" className={cn('font-medium', active ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900' : 'bg-muted text-muted-foreground')}>
      {active ? 'Đang bán' : 'Ngừng bán'}
    </Badge>
  )
}
