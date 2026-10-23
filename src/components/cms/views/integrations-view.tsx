'use client'

// API & WEBHOOK — tích hợp hai chiều: API Keys, Webhook endpoints, Credentials, Hướng dẫn

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react'

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api'
import { formatDate, formatDateTime, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/cms/confirm-dialog'
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/cms/page-header'
import { StatCard } from '@/components/cms/stat-card'

// ===== Types =====

interface ApiKeyItem {
  id: string
  name: string
  key: string
  secret: string
  active: boolean
  createdAt: string
}

interface WebhookDeliveryItem {
  id: string
  event: string
  status: string
  responseCode: number | null
  error: string | null
  createdAt: string
}

interface WebhookEndpointItem {
  id: string
  name: string
  url: string
  secret: string
  events: string
  active: boolean
  createdAt: string
  deliveries: WebhookDeliveryItem[]
}

interface CredentialItem {
  provider: string
  label: string
  name: string
  config: unknown
  active: boolean
  updatedAt: string | null
}

interface IntegrationsData {
  apiKeys: ApiKeyItem[]
  webhooks: WebhookEndpointItem[]
  credentials: CredentialItem[]
  events: string[]
  inboundUrl: string
  stats: {
    deliveriesSuccess: number
    deliveriesFailed: number
    endpoints: number
    keysActive: number
  }
}

// ===== Hằng số hiển thị =====

const DEFAULT_EVENT = 'order.created'

const CREDENTIAL_PLACEHOLDERS: Record<string, string> = {
  GHN: '{\n  "shopId": "...",\n  "token": "..."\n}',
  GHTK: '{\n  "token": "..."\n}',
  VIETTEL: '{\n  "token": "..."\n}',
  JT: '{\n  "apiUser": "...",\n  "apiKey": "..."\n}',
  NINJA: '{\n  "clientId": "...",\n  "clientSecret": "..."\n}',
  ZALO_OA: '{\n  "oaId": "...",\n  "oaSecret": "...",\n  "znsToken": "..."\n}',
  PAYOS: '{\n  "clientId": "...",\n  "apiKey": "...",\n  "checksumKey": "...",\n  "webhookSecret": "..."\n}',
  GEMINI: '{\n  "apiKey": "...",\n  "model": "gemini-2.0-flash"\n}',
}

const DELIVERY_STATUS_STYLES: Record<string, { icon: typeof CheckCircle2; className: string }> = {
  SUCCESS: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400' },
  FAILED: { icon: XCircle, className: 'text-rose-600 dark:text-rose-400' },
  PENDING: { icon: Clock, className: 'text-muted-foreground' },
}

// ===== Helpers =====

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Đã xảy ra lỗi'
}

function splitEvents(events: string): string[] {
  return events === '*' ? [] : events.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Chuẩn hóa config credential (object hoặc JSON string) thành text JSON pretty cho Textarea */
function credentialConfigText(config: unknown): string {
  if (typeof config === 'string' && config.trim()) {
    try {
      const parsed: unknown = JSON.parse(config)
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed, null, 2)
      }
      return config
    } catch {
      return config
    }
  }
  if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
    return JSON.stringify(config, null, 2)
  }
  return '{}'
}

// ===== Component =====

export function IntegrationsView() {
  const { toast } = useToast()

  const [data, setData] = useState<IntegrationsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const refetch = useCallback(() => setRefreshKey((k) => k + 1), [])

  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: `Đã sao chép ${label}` })
      } catch {
        toast({ title: 'Không thể sao chép', description: 'Trình duyệt chặn clipboard.', variant: 'destructive' })
      }
    },
    [toast]
  )

  // ===== Load toàn bộ dữ liệu tích hợp =====
  const fetchIntegrations = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiGet<IntegrationsData>('/api/integrations')
      setData(res)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [refreshKey])

  useEffect(() => {
    void fetchIntegrations()
  }, [fetchIntegrations])

  // ===== API Keys =====
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [keyCreating, setKeyCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<{ key: string; secret: string } | null>(null)
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, boolean>>({})
  const [deleteKeyId, setDeleteKeyId] = useState<string | null>(null)
  const [keyDeleting, setKeyDeleting] = useState(false)

  const submitCreateKey = async () => {
    if (!keyName.trim()) {
      toast({ title: 'Vui lòng nhập tên API key', variant: 'destructive' })
      return
    }
    setKeyCreating(true)
    try {
      const res = await apiPost<{ apiKey: ApiKeyItem }>('/api/integrations/api-keys', {
        name: keyName.trim(),
      })
      toast({ title: 'Đã tạo API key', description: 'Sao chép key và secret ngay — chỉ hiển thị một lần.' })
      setCreatedKey({ key: res.apiKey.key, secret: res.apiKey.secret })
      setCreateKeyOpen(false)
      setKeyName('')
      refetch()
    } catch (err) {
      toast({ title: 'Không thể tạo API key', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setKeyCreating(false)
    }
  }

  const submitDeleteKey = async () => {
    if (!deleteKeyId) return
    setKeyDeleting(true)
    try {
      await apiDelete(`/api/integrations/api-keys?id=${deleteKeyId}`)
      toast({ title: 'Đã thu hồi API key' })
      setDeleteKeyId(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể thu hồi API key', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setKeyDeleting(false)
    }
  }

  // ===== Webhooks =====
  const [addWebhookOpen, setAddWebhookOpen] = useState(false)
  const [webhookName, setWebhookName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [webhookEvents, setWebhookEvents] = useState<string[]>(['*'])
  const [webhookCreating, setWebhookCreating] = useState(false)
  const [testEvent, setTestEvent] = useState<Record<string, string>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deleteWebhookId, setDeleteWebhookId] = useState<string | null>(null)
  const [webhookDeleting, setWebhookDeleting] = useState(false)

  const openAddWebhook = () => {
    setWebhookName('')
    setWebhookUrl('')
    setWebhookSecret('')
    setWebhookEvents(['*'])
    setAddWebhookOpen(true)
  }

  const toggleWebhookEvent = (event: string, checked: boolean | 'indeterminate') => {
    setWebhookEvents((prev) => {
      if (event === '*') {
        return checked ? ['*'] : prev.filter((e) => e !== '*')
      }
      const withoutAll = prev.filter((e) => e !== '*')
      if (checked) return [...withoutAll, event]
      return withoutAll.filter((e) => e !== event)
    })
  }

  const submitCreateWebhook = async () => {
    if (!webhookName.trim()) {
      toast({ title: 'Vui lòng nhập tên webhook', variant: 'destructive' })
      return
    }
    if (!/^https?:\/\//i.test(webhookUrl.trim())) {
      toast({ title: 'URL không hợp lệ', description: 'URL phải bắt đầu bằng http:// hoặc https://', variant: 'destructive' })
      return
    }
    setWebhookCreating(true)
    try {
      await apiPost<{ webhook: WebhookEndpointItem }>('/api/integrations/webhooks', {
        name: webhookName.trim(),
        url: webhookUrl.trim(),
        secret: webhookSecret.trim() || undefined,
        events: webhookEvents.includes('*') || webhookEvents.length === 0 ? '*' : webhookEvents.join(','),
      })
      toast({ title: 'Đã thêm webhook', description: 'Hệ thống sẽ gửi sự kiện tới endpoint này.' })
      setAddWebhookOpen(false)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể thêm webhook', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setWebhookCreating(false)
    }
  }

  const toggleWebhookActive = async (endpoint: WebhookEndpointItem, active: boolean) => {
    try {
      await apiPatch<{ webhook: WebhookEndpointItem }>(`/api/integrations/webhooks?id=${endpoint.id}`, { active })
      toast({ title: active ? `Đã bật «${endpoint.name}»` : `Đã tắt «${endpoint.name}»` })
      refetch()
    } catch (err) {
      toast({ title: 'Không thể cập nhật webhook', description: errorMessage(err), variant: 'destructive' })
    }
  }

  const runWebhookTest = async (endpoint: WebhookEndpointItem) => {
    const available = endpoint.events === '*' ? (data?.events ?? []) : splitEvents(endpoint.events)
    const event = testEvent[endpoint.id] ?? available[0] ?? DEFAULT_EVENT
    setTestingId(endpoint.id)
    try {
      const res = await apiPost<{
        status: string
        responseCode: number | null
        error: string | null
        event: string
      }>('/api/integrations/webhooks/test', { id: endpoint.id, event })
      if (res.status === 'SUCCESS') {
        toast({
          title: `Test OK — HTTP ${res.responseCode ?? '?'}`,
          description: `Sự kiện ${res.event} đã được gửi tới ${endpoint.name}.`,
        })
      } else {
        toast({
          title: `Test FAILED${res.responseCode != null ? ` — HTTP ${res.responseCode}` : ''}`,
          description: res.error ?? 'Endpoint không phản hồi thành công.',
          variant: 'destructive',
        })
      }
      refetch()
    } catch (err) {
      toast({ title: 'Không thể gửi test', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setTestingId(null)
    }
  }

  const submitDeleteWebhook = async () => {
    if (!deleteWebhookId) return
    setWebhookDeleting(true)
    try {
      await apiDelete(`/api/integrations/webhooks?id=${deleteWebhookId}`)
      toast({ title: 'Đã xóa webhook' })
      setDeleteWebhookId(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể xóa webhook', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setWebhookDeleting(false)
    }
  }

  // ===== Credentials =====
  const [credProvider, setCredProvider] = useState<string | null>(null)
  const [credText, setCredText] = useState('{}')
  const [credActive, setCredActive] = useState(true)
  const [credSaving, setCredSaving] = useState(false)

  const credentialInEdit = useMemo(
    () => data?.credentials.find((c) => c.provider === credProvider) ?? null,
    [data, credProvider]
  )

  const openCredential = (credential: CredentialItem) => {
    setCredProvider(credential.provider)
    setCredText(credential.config == null ? '{}' : credentialConfigText(credential.config))
    setCredActive(credential.config != null ? credential.active : true)
  }

  const submitCredential = async () => {
    if (!credProvider || !credentialInEdit) return
    let config: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(credText)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Config phải là JSON object')
      }
      config = parsed as Record<string, unknown>
    } catch {
      toast({ title: 'JSON cấu hình không hợp lệ', variant: 'destructive' })
      return
    }
    setCredSaving(true)
    try {
      await apiPost<{ credential: unknown }>('/api/integrations/credentials', {
        provider: credProvider,
        name: credentialInEdit.name,
        config,
        active: credActive,
      })
      toast({ title: `Đã lưu credential ${credProvider}`, description: 'Cấu hình được ghi vào Sổ Data.' })
      setCredProvider(null)
      refetch()
    } catch (err) {
      toast({ title: 'Không thể lưu credential', description: errorMessage(err), variant: 'destructive' })
    } finally {
      setCredSaving(false)
    }
  }

  // ===== Derived =====
  const apiKeys = data?.apiKeys ?? []
  const webhooks = data?.webhooks ?? []
  const credentials = data?.credentials ?? []
  const events = data?.events ?? []
  const activeEndpoints = webhooks.filter((w) => w.active).length

  return (
    <div>
      <PageHeader
        title="API & Webhook"
        description="Tích hợp hai chiều với hệ thống ngoài — API key, webhook sự kiện và credentials đối tác"
      />

      {/* Stats hàng đầu */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Endpoint đang bật"
          value={loading ? '' : formatNumber(activeEndpoints)}
          icon={Webhook}
          loading={loading}
          hint={`${formatNumber(webhooks.length)} endpoint đã đăng ký`}
        />
        <StatCard
          title="API key hoạt động"
          value={loading ? '' : formatNumber(data?.stats.keysActive ?? 0)}
          icon={KeyRound}
          loading={loading}
          hint={`${formatNumber(apiKeys.length)} key đã tạo`}
        />
        <StatCard
          title="Gửi thành công"
          value={loading ? '' : formatNumber(data?.stats.deliveriesSuccess ?? 0)}
          icon={CheckCircle2}
          loading={loading}
          iconClassName="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
        />
        <StatCard
          title="Gửi lỗi"
          value={loading ? '' : formatNumber(data?.stats.deliveriesFailed ?? 0)}
          icon={XCircle}
          loading={loading}
          iconClassName={
            (data?.stats.deliveriesFailed ?? 0) > 0
              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400'
              : 'bg-primary/10 text-primary'
          }
          hint={(data?.stats.deliveriesFailed ?? 0) > 0 ? 'Cần kiểm tra endpoint lỗi' : undefined}
        />
      </div>

      {loading && !data ? (
        <TableSkeleton rows={5} />
      ) : error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : (
        <Tabs defaultValue="keys">
          <TabsList className="mb-4">
            <TabsTrigger value="keys">API Keys</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
            <TabsTrigger value="credentials">Credentials</TabsTrigger>
            <TabsTrigger value="guide">Hướng dẫn</TabsTrigger>
          </TabsList>

          {/* ===== TAB 1: API KEYS ===== */}
          <TabsContent value="keys" className="mt-0">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-base">API Keys</CardTitle>
                  <CardDescription>Key để hệ thống ngoài gọi API nội bộ (header X-API-Key / X-API-Secret)</CardDescription>
                </div>
                <Button onClick={() => setCreateKeyOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" /> Tạo API Key
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {apiKeys.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      icon={KeyRound}
                      title="Chưa có API key nào"
                      description="Tạo API key để cấp quyền truy cập API cho hệ thống ngoài."
                      action={
                        <Button onClick={() => setCreateKeyOpen(true)}>
                          <Plus className="mr-1.5 h-4 w-4" /> Tạo API Key
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">Tên</th>
                          <th className="px-4 py-2.5 font-medium">Key</th>
                          <th className="px-4 py-2.5 font-medium">Secret</th>
                          <th className="px-4 py-2.5 font-medium">Trạng thái</th>
                          <th className="px-4 py-2.5 font-medium">Ngày tạo</th>
                          <th className="px-4 py-2.5 text-right font-medium">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {apiKeys.map((apiKey) => (
                          <tr key={apiKey.id} className="border-b last:border-0">
                            <td className="px-4 py-2.5 font-medium">{apiKey.name}</td>
                            <td className="max-w-[200px] px-4 py-2.5">
                              <span className="block truncate font-mono text-xs" title={apiKey.key}>
                                {apiKey.key}
                              </span>
                            </td>
                            <td className="max-w-[160px] px-4 py-2.5">
                              <div className="flex items-center gap-1.5">
                                <span className="block truncate font-mono text-xs" title={apiKey.secret}>
                                  {revealedSecrets[apiKey.id] ? apiKey.secret : '••••••••••••'}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() =>
                                    setRevealedSecrets((prev) => ({ ...prev, [apiKey.id]: !prev[apiKey.id] }))
                                  }
                                  aria-label={revealedSecrets[apiKey.id] ? 'Ẩn secret' : 'Hiện secret'}
                                >
                                  {revealedSecrets[apiKey.id] ? (
                                    <EyeOff className="h-3.5 w-3.5" />
                                  ) : (
                                    <Eye className="h-3.5 w-3.5" />
                                  )}
                                </Button>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {apiKey.active ? (
                                <Badge className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                                  Hoạt động
                                </Badge>
                              ) : (
                                <Badge variant="outline">Đã thu hồi</Badge>
                              )}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                              {formatDate(apiKey.createdAt)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setDeleteKeyId(apiKey.id)}
                                aria-label="Thu hồi API key"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB 2: WEBHOOKS ===== */}
          <TabsContent value="webhooks" className="mt-0">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {formatNumber(webhooks.length)} endpoint nhận sự kiện realtime từ hệ thống
              </p>
              <Button onClick={openAddWebhook}>
                <Plus className="mr-1.5 h-4 w-4" /> Thêm webhook
              </Button>
            </div>

            {webhooks.length === 0 ? (
              <EmptyState
                icon={Webhook}
                title="Chưa có webhook nào"
                description="Đăng ký endpoint để nhận sự kiện order.*, invoice.*, stock.movement tự động."
                action={
                  <Button onClick={openAddWebhook}>
                    <Plus className="mr-1.5 h-4 w-4" /> Thêm webhook
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {webhooks.map((endpoint) => {
                  const isAll = endpoint.events === '*'
                  const endpointEvents = isAll ? [] : splitEvents(endpoint.events)
                  const available = isAll ? events : endpointEvents
                  const selectedTest = testEvent[endpoint.id] ?? available[0] ?? DEFAULT_EVENT
                  return (
                    <Card key={endpoint.id} className="shadow-sm">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <CardTitle className="flex items-center gap-2 text-base">
                              {endpoint.name}
                              {!endpoint.active && <Badge variant="outline">Tắt</Badge>}
                            </CardTitle>
                            <CardDescription className="mt-1 flex items-center gap-1.5">
                              <span className="block max-w-[280px] truncate font-mono text-xs" title={endpoint.url}>
                                {endpoint.url}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 shrink-0"
                                onClick={() => void copyText(endpoint.url, 'URL')}
                                aria-label="Sao chép URL"
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </CardDescription>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Switch
                              checked={endpoint.active}
                              onCheckedChange={(checked) => void toggleWebhookActive(endpoint, checked)}
                              aria-label="Bật/tắt webhook"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeleteWebhookId(endpoint.id)}
                              aria-label="Xóa webhook"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {isAll ? (
                            <Badge className="border-transparent bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-400">
                              Tất cả sự kiện (*)
                            </Badge>
                          ) : (
                            endpointEvents.map((ev) => (
                              <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                                {ev}
                              </Badge>
                            ))
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {/* 5 delivery gần nhất */}
                        {endpoint.deliveries.length > 0 ? (
                          <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-md border bg-muted/30 p-2">
                            {endpoint.deliveries.map((delivery) => {
                              const style =
                                DELIVERY_STATUS_STYLES[delivery.status] ?? DELIVERY_STATUS_STYLES.PENDING
                              const Icon = style.icon
                              return (
                                <div key={delivery.id} className="flex items-center gap-2 text-xs">
                                  <Icon className={cn('h-3.5 w-3.5 shrink-0', style.className)} />
                                  <span className="min-w-0 flex-1 truncate font-mono">{delivery.event}</span>
                                  {delivery.responseCode != null && (
                                    <span className="shrink-0 font-mono text-muted-foreground">
                                      HTTP {delivery.responseCode}
                                    </span>
                                  )}
                                  <span className="shrink-0 text-muted-foreground">
                                    {formatDateTime(delivery.createdAt)}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="rounded-md border border-dashed p-2 text-center text-xs text-muted-foreground">
                            Chưa có lần gửi nào
                          </p>
                        )}

                        {/* Gửi test */}
                        <div className="flex gap-2">
                          <Select
                            value={selectedTest}
                            onValueChange={(v) => setTestEvent((prev) => ({ ...prev, [endpoint.id]: v }))}
                          >
                            <SelectTrigger className="h-9 flex-1 font-mono text-xs" aria-label="Chọn sự kiện test">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {available.map((ev) => (
                                <SelectItem key={ev} value={ev}>
                                  {ev}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="secondary"
                            size="sm"
                            className="h-9"
                            disabled={testingId === endpoint.id}
                            onClick={() => void runWebhookTest(endpoint)}
                          >
                            {testingId === endpoint.id ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="mr-1 h-4 w-4" />
                            )}
                            Gửi test
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ===== TAB 3: CREDENTIALS ===== */}
          <TabsContent value="credentials" className="mt-0">
            <p className="mb-4 text-sm text-muted-foreground">
              Thông tin xác thực với đối tác vận chuyển, thanh toán và AI — lưu encrypted trong hệ thống
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              {credentials.map((credential) => {
                const configured = credential.config !== null && credential.config !== undefined
                return (
                  <Card key={credential.provider} className="shadow-sm">
                    <CardContent className="flex items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{credential.label}</p>
                          <Badge
                            className={cn(
                              'border-transparent',
                              configured
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                                : 'bg-muted text-muted-foreground'
                            )}
                          >
                            {configured ? 'Đã cấu hình' : 'Chưa cấu hình'}
                          </Badge>
                        </div>
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {credential.provider}
                          {credential.updatedAt ? ` · cập nhật ${formatDateTime(credential.updatedAt)}` : ''}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => openCredential(credential)}>
                        Cấu hình
                      </Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </TabsContent>

          {/* ===== TAB 4: HƯỚNG DẪN ===== */}
          <TabsContent value="guide" className="mt-0 space-y-4">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowUpCircle className="h-5 w-5 text-primary" />
                  1. Outbound — hệ thống gửi sự kiện ra ngoài
                </CardTitle>
                <CardDescription>
                  Khi dữ liệu thay đổi, hệ thống POST tới mọi webhook endpoint đang bật với payload ký sẵn.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  {events.map((ev) => (
                    <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                      {ev}
                    </Badge>
                  ))}
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Headers</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`Content-Type: application/json
X-Event: order.created
X-Signature: <HMAC-SHA256(toàn bộ JSON body, secret của endpoint)>`}</pre>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Ví dụ payload</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(
                    {
                      event: 'order.created',
                      sentAt: new Date().toISOString(),
                      data: {
                        id: 'clx…',
                        code: 'DH261023-8147',
                        channel: 'ZALO_OA',
                        total: 1250000,
                        customer: 'Nguyễn Văn A',
                        items: [{ sku: 'PK-DAY-001', name: 'Sản phẩm A', quantity: 2, price: 625000 }],
                      },
                    },
                    null,
                    2
                  )}</pre>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ArrowDownCircle className="h-5 w-5 text-primary" />
                  2. Inbound — hệ thống nhận yêu cầu từ ngoài vào
                </CardTitle>
                <CardDescription>
                  Gửi POST tới <span className="font-mono">{data?.inboundUrl ?? '/api/webhooks/inbound'}</span> với chữ ký
                  HMAC-SHA256 lấy secret từ credential <span className="font-mono">PAYOS.webhookSecret</span>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="mb-1 text-sm font-medium">Headers</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`Content-Type: application/json
X-Signature: <HMAC-SHA256(raw body, credential PAYOS.webhookSecret)>`}</pre>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Sự kiện hỗ trợ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {['INBOUND_PING', 'INBOUND_ORDER_CREATE', 'INBOUND_STOCK_UPDATE'].map((ev) => (
                      <Badge key={ev} variant="outline" className="font-mono text-[11px]">
                        {ev}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium">Ví dụ body từng sự kiện</p>
                  <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{`{ "event": "INBOUND_PING" }

{ "event": "INBOUND_ORDER_CREATE",
  "data": {
    "channelKey": "WEBSITE",
    "customerName": "Nguyễn Văn A",
    "customerPhone": "0901234567",
    "address": "12 Nguyễn Trãi, Q1, TP.HCM",
    "items": [{ "productId": "<id sản phẩm>", "quantity": 1 }]
  } }

{ "event": "INBOUND_STOCK_UPDATE",
  "data": { "productId": "<id sản phẩm>", "delta": 10, "note": "Nhập hàng từ nhà máy" } }`}</pre>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  3. Lưu ý bảo mật
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                  <li>Không bao giờ chia sẻ secret của API key / webhook / credential ra công khai (log, screenshot, repo).</li>
                  <li>Endpoint webhook bắt buộc HTTPS; hệ thống luôn kiểm tra chữ ký X-Signature trước khi xử lý.</li>
                  <li>Với inbound, chữ ký phải tính trên đúng raw body — không parse rồi serialize lại.</li>
                  <li>Khi nghi lộ key: thu hồi ngay tại tab API Keys và tạo key mới thay thế.</li>
                  <li>PayOS cần trường <span className="font-mono">webhookSecret</span> trong credential để xác thực webhook hai chiều.</li>
                </ul>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Dialog tạo API key */}
      <Dialog
        open={createKeyOpen}
        onOpenChange={(open) => {
          if (!keyCreating) setCreateKeyOpen(open)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tạo API Key</DialogTitle>
            <DialogDescription>Cấp key + secret để hệ thống ngoài gọi API nội bộ.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="apikey-name">
              Tên key <span className="text-destructive">*</span>
            </Label>
            <Input
              id="apikey-name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="VD: Kênh Shopee, App đối tác logistics..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateKeyOpen(false)} disabled={keyCreating}>
              Hủy
            </Button>
            <Button onClick={() => void submitCreateKey()} disabled={keyCreating}>
              {keyCreating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Tạo key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog hiển thị key + secret sau khi tạo (chỉ 1 lần) */}
      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>API key đã được tạo</DialogTitle>
            <DialogDescription className="font-medium text-destructive">
              Chỉ hiển thị một lần — hãy sao chép ngay và lưu ở nơi an toàn.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">API Key</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdKey?.key}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => void copyText(createdKey?.key ?? '', 'API key')}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">API Secret</p>
              <div className="flex items-center gap-2 rounded-md border bg-muted/40 p-2">
                <code className="min-w-0 flex-1 break-all font-mono text-xs">{createdKey?.secret}</code>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0"
                  onClick={() => void copyText(createdKey?.secret ?? '', 'secret')}
                >
                  <Copy className="mr-1 h-3 w-3" /> Copy
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog thêm webhook */}
      <Dialog
        open={addWebhookOpen}
        onOpenChange={(open) => {
          if (!webhookCreating) setAddWebhookOpen(open)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Thêm webhook</DialogTitle>
            <DialogDescription>
              Hệ thống sẽ POST payload ký HMAC-SHA256 tới endpoint này mỗi khi có sự kiện.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-name">
                Tên <span className="text-destructive">*</span>
              </Label>
              <Input
                id="webhook-name"
                value={webhookName}
                onChange={(e) => setWebhookName(e.target.value)}
                placeholder="VD: Endpoint đối tác logistics"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">
                URL <span className="text-destructive">*</span>
              </Label>
              <Input
                id="webhook-url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/webhooks/omnisales"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-secret">Secret (trống = tự sinh)</Label>
              <Input
                id="webhook-secret"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="Để trống để hệ thống sinh secret ngẫu nhiên"
              />
            </div>
            <div className="space-y-2">
              <Label>Sự kiện nhận</Label>
              <label className="flex items-center gap-2 rounded-md border p-2 text-sm">
                <Checkbox
                  checked={webhookEvents.includes('*')}
                  onCheckedChange={(checked) => toggleWebhookEvent('*', checked)}
                />
                Tất cả sự kiện (*)
              </label>
              <div className="grid gap-1.5 rounded-md border p-2 sm:grid-cols-2">
                {events.map((ev) => (
                  <label key={ev} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      checked={webhookEvents.includes(ev)}
                      onCheckedChange={(checked) => toggleWebhookEvent(ev, checked)}
                      disabled={webhookEvents.includes('*')}
                    />
                    <span className="font-mono">{ev}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddWebhookOpen(false)} disabled={webhookCreating}>
              Hủy
            </Button>
            <Button onClick={() => void submitCreateWebhook()} disabled={webhookCreating}>
              {webhookCreating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Thêm webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cấu hình credential */}
      <Dialog
        open={credProvider !== null}
        onOpenChange={(open) => {
          if (!credSaving && !open) setCredProvider(null)
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cấu hình {credentialInEdit?.label ?? credProvider}</DialogTitle>
            <DialogDescription>
              Nhà cung cấp <span className="font-mono">{credProvider}</span>
              {credentialInEdit?.updatedAt ? ` · cập nhật ${formatDateTime(credentialInEdit.updatedAt)}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {credProvider === 'PAYOS' && (
              <p className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-400">
                PayOS cần trường <span className="font-mono font-semibold">webhookSecret</span> trong cấu hình để nhận
                webhook hai chiều (hệ thống dùng nó để xác thực chữ ký X-Signature inbound).
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="cred-config">JSON cấu hình</Label>
              <Textarea
                id="cred-config"
                rows={9}
                className="font-mono text-xs"
                value={credText}
                onChange={(e) => setCredText(e.target.value)}
                placeholder={CREDENTIAL_PLACEHOLDERS[credProvider ?? ''] ?? '{}'}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Kích hoạt</p>
                <p className="text-xs text-muted-foreground">Credential tắt sẽ không được dùng trong luồng tự động.</p>
              </div>
              <Switch checked={credActive} onCheckedChange={setCredActive} aria-label="Kích hoạt credential" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredProvider(null)} disabled={credSaving}>
              Hủy
            </Button>
            <Button onClick={() => void submitCredential()} disabled={credSaving}>
              {credSaving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Lưu cấu hình
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm xóa API key */}
      <ConfirmDialog
        open={deleteKeyId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteKeyId(null)
        }}
        title="Thu hồi API key này?"
        description="Mọi hệ thống ngoài đang dùng key này sẽ mất quyền truy cập ngay lập tức. Hành động không thể hoàn tác."
        confirmText="Thu hồi key"
        destructive
        loading={keyDeleting}
        onConfirm={() => void submitDeleteKey()}
      />

      {/* Confirm xóa webhook */}
      <ConfirmDialog
        open={deleteWebhookId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteWebhookId(null)
        }}
        title="Xóa webhook endpoint này?"
        description="Endpoint sẽ ngừng nhận mọi sự kiện từ hệ thống. Hành động không thể hoàn tác."
        confirmText="Xóa webhook"
        destructive
        loading={webhookDeleting}
        onConfirm={() => void submitDeleteWebhook()}
      />
    </div>
  )
}
