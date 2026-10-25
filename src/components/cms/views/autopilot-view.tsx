'use client'

// Trung tâm điều khiển đội Agent: bật/tắt từng nhiệm vụ + nhật ký hoạt động đầy đủ.

import { useCallback, useEffect, useState } from 'react'
import { Bot, ScrollText, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AgentBadge } from '@/components/cms/agent-badge'
import { apiGet, apiPatch } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { AGENT_ORDER, AGENTS, AUTOMATION_DEFS } from '@/lib/agents'
import { AGENT_ACTION_LABELS, type AgentActivity } from '@/lib/types'
import { timeAgo } from '@/lib/format'

interface AutopilotData {
  settings: Record<string, boolean>
  defs: typeof AUTOMATION_DEFS
}

interface ActivitiesData {
  activities: AgentActivity[]
  byAgent: Array<{ agent: string; _count: { _all: number } }>
}

export function AutopilotView() {
  const { toast } = useToast()
  const [data, setData] = useState<AutopilotData | null>(null)
  const [log, setLog] = useState<ActivitiesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [agentFilter, setAgentFilter] = useState('ALL')

  const loadSettings = useCallback(async () => {
    try {
      const d = await apiGet<AutopilotData>('/api/autopilot')
      setData(d)
    } catch {
      // bỏ qua
    } finally {
      setLoading(false)
    }
  }, [])

  const loadLog = useCallback(async () => {
    try {
      const d = await apiGet<ActivitiesData>(`/api/agent-activities?limit=100&agent=${agentFilter}`)
      setLog(d)
    } catch {
      // bỏ qua
    }
  }, [agentFilter])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  useEffect(() => {
    void loadLog()
  }, [loadLog])

  useRealtime((e) => {
    if (e.type === 'agent.activity') {
      const activity = e.data as AgentActivity
      if (agentFilter === 'ALL' || activity.agent === agentFilter) {
        setLog((prev) => (prev ? { ...prev, activities: [activity, ...prev.activities].slice(0, 100) } : prev))
      }
    } else if (e.type === 'settings.updated') {
      void loadSettings()
      void loadLog()
    } else if (e.type === 'realtime.poll') {
      // WS hỏng → polling 10s: nạp lại nhật ký Agent im lặng (không loading flash)
      void loadLog()
    }
  })

  const toggle = async (key: string, enabled: boolean, label: string) => {
    try {
      const res = await apiPatch<{ settings: Record<string, boolean> }>('/api/autopilot', { key, enabled })
      setData((prev) => (prev ? { ...prev, settings: res.settings } : prev))
      toast({ title: `${enabled ? 'Đã bật' : 'Đã tắt'} «${label}»`, description: enabled ? 'Agent tiếp quản nhiệm vụ này.' : 'Nhiệm vụ chuyển về xử lý thủ công.' })
    } catch (error) {
      toast({ title: 'Lỗi', description: error instanceof Error ? error.message : 'Không thể cập nhật', variant: 'destructive' })
    }
  }

  const master = data?.settings.master ?? false
  const activeAgents = AGENT_ORDER.filter((a) => master && (data?.settings[mapAgentToSetting(a)] ?? false))

  return (
    <div className="space-y-5">
      {/* Tổng quan */}
      <Card className={master ? 'border-emerald-200 bg-gradient-to-r from-emerald-50 to-background shadow-sm dark:border-emerald-900 dark:from-emerald-950/40' : 'border-amber-200 bg-gradient-to-r from-amber-50 to-background shadow-sm dark:border-amber-900 dark:from-amber-950/40'}>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-bold">Đội Agent tự vận hành</h2>
                {master ? <Badge className="bg-emerald-600 text-white">5/5 trực 24/7</Badge> : <Badge className="bg-amber-500 text-white">TẮT TOÀN BỘ</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">Công tắc tổng điều khiển mọi Agent. Tắt nghĩa là bạn phải tự làm tất cả.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {activeAgents.map((a) => (
              <AgentBadge key={a} agent={a} />
            ))}
            <Switch
              checked={master}
              onCheckedChange={(v) => toggle('master', v, 'Agent Autopilot')}
              aria-label="Bật/tắt toàn bộ Agent"
              className="scale-125"
            />
          </div>
        </CardContent>
      </Card>

      {/* Danh sách nhiệm vụ */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
          : AUTOMATION_DEFS.filter((d) => d.key !== 'master').map((def) => {
              const enabled = data?.settings[def.key] ?? false
              return (
                <Card key={def.key} className="flex flex-col border-border/70 shadow-sm">
                  <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base leading-snug">{def.label}</CardTitle>
                      {def.agent && <AgentBadge agent={def.agent} className="mt-2" />}
                    </div>
                    <Switch checked={enabled} onCheckedChange={(v) => toggle(def.key, v, def.label)} aria-label={`Bật/tắt ${def.label}`} />
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm text-muted-foreground">{def.desc}</p>
                    <p className="mt-3 text-xs">
                      {enabled ? (
                        <span className="font-medium text-emerald-600">● Agent đang phụ trách nhiệm vụ này</span>
                      ) : (
                        <span className="font-medium text-amber-600">○ Đang xử lý thủ công</span>
                      )}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
      </div>

      {/* Nhật ký Agent */}
      <Card className="border-border/70 p-0 shadow-sm">
        <CardHeader className="border-b pb-4">
          <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
            <span className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-primary" />
              Nhật ký hoạt động Agent — lưu vĩnh viễn
            </span>
            <div className="flex items-center gap-2">
              {log?.byAgent
                .filter((b) => b.agent !== 'SYSTEM')
                .map((b) => (
                  <Badge key={b.agent} variant="outline" className="text-[11px]">
                    {AGENTS[b.agent]?.short ?? b.agent}: {b._count._all}
                  </Badge>
                ))}
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="h-8 w-44 text-xs" aria-label="Lọc theo Agent">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tất cả Agent</SelectItem>
                  {AGENT_ORDER.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AGENTS[a].name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[560px] overflow-y-auto p-4 pt-4 [scrollbar-width:thin]">
          {!log || log.activities.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Chưa có hoạt động nào được ghi nhận.</p>
          ) : (
            <div className="space-y-1">
              {log.activities.map((a) => (
                <div key={a.id} className="flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${AGENTS[a.agent]?.dotClass ?? 'bg-slate-400'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-snug">{a.message}</p>
                    {a.detail && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.detail}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <AgentBadge agent={a.agent} />
                      <span className="text-[11px] text-muted-foreground">{AGENT_ACTION_LABELS[a.action] ?? a.action}</span>
                      {a.targetLabel && (
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{a.targetLabel}</span>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(a.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2 pb-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5" />
        Mọi thao tác của Agent đều được lưu trữ vĩnh viễn trong cơ sở dữ liệu — kiểm toán đầy đủ, không mất dữ liệu.
      </div>
    </div>
  )
}

function mapAgentToSetting(agent: string): string {
  const map: Record<string, string> = {
    CONFIRM_AGENT: 'auto_confirm',
    LOGISTICS_AGENT: 'auto_carrier',
    CARE_AGENT: 'auto_care',
    REVIEW_AGENT: 'auto_review',
    SUPPORT_AGENT: 'auto_reply',
  }
  return map[agent] ?? ''
}
