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
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            {loading ? (
              <div className="mt-2 h-8 w-28 animate-pulse rounded-md bg-muted" />
            ) : (
              <p className="mt-1 truncate text-2xl font-bold tracking-tight">{value}</p>
            )}
            {trend?.value != null && !loading && (
              <p className="mt-1.5 flex items-center gap-1 text-xs">
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
                {trend.label && <span className="text-muted-foreground">{trend.label}</span>}
              </p>
            )}
            {hint && !loading && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary',
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
