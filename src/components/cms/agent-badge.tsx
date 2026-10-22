'use client'

// Badge dùng chung cho Agent + trạng thái vận chuyển

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { AGENTS, SHIPMENT_STATUS_LABELS } from '@/lib/agents'

export function AgentBadge({ agent, className }: { agent: string; className?: string }) {
  const meta = AGENTS[agent] ?? AGENTS.SYSTEM
  return (
    <Badge variant="outline" className={cn('gap-1 whitespace-nowrap text-[11px] font-semibold', meta.badgeClass, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dotClass)} />
      {meta.name}
    </Badge>
  )
}

export function AgentDot({ agent, className }: { agent: string; className?: string }) {
  const meta = AGENTS[agent] ?? AGENTS.SYSTEM
  return <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', meta.dotClass, className)} />
}

const SHIPMENT_STATUS_STYLES: Record<string, string> = {
  DISPATCHED: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900',
  PICKED_UP: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-400 dark:border-violet-900',
  IN_TRANSIT: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900',
  DELIVERED: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900',
  RETURNED: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-900',
}

export function ShipmentStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn('whitespace-nowrap font-medium', SHIPMENT_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground', className)}>
      {SHIPMENT_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
