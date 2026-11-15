'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'

interface StatCardProps {
  title: string
  value: string
  icon: LucideIcon
  trend?: { value: number | null; label?: string }
  hint?: string
  iconClassName?: string
  loading?: boolean
}

export function StatCard({ title, value, icon: Icon, trend, hint, iconClassName, loading }: StatCardProps) {
  const trendUp = trend?.value != null && trend.value > 0
  const trendDown = trend?.value != null && trend.value < 0

  return (
    <Card className="border-border/70 shadow-xs">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2 sm:gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-muted-foreground sm:text-sm">{title}</p>
            {loading ? (
              <div className="mt-1.5 h-7 w-20 animate-pulse rounded-md bg-muted sm:w-28" />
            ) : (
              <p className="mt-0.5 truncate text-lg font-bold tracking-tight tabular-nums sm:mt-1 sm:text-2xl">
                {value}
              </p>
            )}
            {trend?.value != null && !loading && (
              <p className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
                    trendUp && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
                    trendDown && 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
                    !trendUp && !trendDown && 'bg-muted text-muted-foreground'
                  )}
                >
                  {trendUp && <TrendingUp className="h-3 w-3" />}
                  {trendDown && <TrendingDown className="h-3 w-3" />}
                  {trend.value > 0 ? '+' : ''}
                  {trend.value}%
                </span>
                {trend.label && <span className="hidden text-muted-foreground sm:inline">{trend.label}</span>}
              </p>
            )}
            {hint && !loading && (
              <p className="mt-1 truncate text-[11px] text-muted-foreground sm:text-xs" title={hint}>
                {hint}
              </p>
            )}
          </div>
          <div
            className={cn(
              'hidden shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex sm:h-10 sm:w-10',
              iconClassName
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
