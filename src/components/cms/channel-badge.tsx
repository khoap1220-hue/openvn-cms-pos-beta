'use client'

import { cn } from '@/lib/utils'
import { formatDateTime } from '@/lib/format'

export function ChannelBadge({
  channel,
  showName = true,
  className,
}: {
  channel: { name: string; color: string } | null | undefined
  showName?: boolean
  className?: string
}) {
  if (!channel) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm', className)}>
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: channel.color }} />
      {showName && <span className="truncate">{channel.name}</span>}
    </span>
  )
}

export function ConnectedDot({ connected }: { connected: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
    </span>
  )
}

export function SyncInfo({ syncedAt }: { syncedAt: string | null | undefined }) {
  return <span className="text-xs text-muted-foreground">{syncedAt ? `Đồng bộ ${formatDateTime(syncedAt)}` : 'Chưa đồng bộ'}</span>
}
