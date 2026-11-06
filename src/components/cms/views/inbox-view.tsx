'use client'

// Hộp thư Zalo (OA + cá nhân): hội thoại khách, Agent trả lời tự động 24/7 100% Anti-AI,
// người vận hành vào chat thay Agent; hỗ trợ ảnh khách gửi (Vision) + thẻ "Chân dung & Trí nhớ AI".

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bot, ImagePlus, Loader2, MessageSquare, RefreshCw, Send, Sparkles, Upload, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiPost } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { CHANNEL_KEY_LABELS, type Conversation, type Customer, type DirectMessage } from '@/lib/types'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export const CHANNEL_KEY_COLORS: Record<string, string> = {
  ZALO_OA: '#0084FF',
  ZALO_PERSONAL: '#45C4B0',
}

const FILTERS = [
  { key: 'ALL', label: 'Tất cả' },
  { key: 'ZALO_OA', label: 'Zalo OA' },
  { key: 'ZALO_PERSONAL', label: 'Zalo cá nhân' },
]

// Kịch bản test ảnh khách gửi (gửi đúng hội thoại đang mở)
const IMAGE_SCENARIOS = [
  { key: 'praise_burn', label: 'Ảnh khen góc đốt nến đẹp' },
  { key: 'lid_defect', label: 'Ảnh nắp hũ trà bị hở/mẻ' },
  { key: 'find_similar', label: 'Ảnh hỏi tìm mẫu tương tự' },
]

interface Reaction {
  emoji: string
  agent: string
  at?: string
}

function parseReactions(raw: string | null | undefined): Reaction[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function CustomerAvatar({ customer, className }: { customer: { name: string; avatarUrl?: string | null }; className?: string }) {
  const [broken, setBroken] = useState(false)
  const size = className ?? 'h-9 w-9'
  if (customer.avatarUrl && !broken) {
    return (
       
      <img src={customer.avatarUrl} alt={`Avatar ${customer.name}`} className={cn(size, 'shrink-0 rounded-full object-cover')} onError={() => setBroken(true)} />
    )
  }
  return (
    <span className={cn(size, 'flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary')}>
      {customer.name.charAt(0).toUpperCase()}
    </span>
  )
}

export function InboxView() {
  const { toast } = useToast()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('ALL')
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<DirectMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [scenarioSending, setScenarioSending] = useState<string | null>(null)
  const [memory, setMemory] = useState<Customer | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [pendingImage, setPendingImage] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'memory'>('chat')
  const dragCounter = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadConversations = useCallback(async () => {
    try {
      const d = await apiGet<{ conversations: Conversation[] }>('/api/inbox')
      setConversations(d.conversations)
    } catch {
      // bỏ qua lỗi load
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMessages = useCallback(async (customerId: string, channelKey: string) => {
    setMessagesLoading(true)
    try {
      const d = await apiGet<{ messages: DirectMessage[] }>(`/api/inbox?customerId=${encodeURIComponent(customerId)}&channelKey=${encodeURIComponent(channelKey)}`)
      setMessages(d.messages)
    } catch {
      setMessages([])
    } finally {
      setMessagesLoading(false)
    }
  }, [])

  const loadMemory = useCallback(async (customerId: string) => {
    setMemoryLoading(true)
    try {
      const d = await apiGet<{ customer: Customer }>(`/api/customers/${encodeURIComponent(customerId)}/memory`)
      setMemory(d.customer)
    } catch {
      setMemory(null)
    } finally {
      setMemoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useRealtime((e) => {
    if (e.type === 'message.reaction') {
      const d = e.data as { messageId: string; emoji: string }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === d.messageId
            ? { ...m, reactions: JSON.stringify([...parseReactions(m.reactions), { emoji: d.emoji, agent: 'SUPPORT_AGENT' }]) }
            : m,
        ),
      )
      return
    }
    if (e.type === 'realtime.poll') {
      // WS hỏng → polling 10s: tải lại tin nhắn của hội thoại đang mở IM LẶNG —
      // chỉ setMessages khi số lượng hoặc id tin cuối cùng đổi (tránh scroll-jump khi đang xem)
      if (selected) {
        void (async () => {
          try {
            const d = await apiGet<{ messages: DirectMessage[] }>(
              `/api/inbox?customerId=${encodeURIComponent(selected.customerId)}&channelKey=${encodeURIComponent(selected.channelKey)}`,
            )
            setMessages((prev) => {
              const lastId = prev[prev.length - 1]?.id
              const nextId = d.messages[d.messages.length - 1]?.id
              if (prev.length === d.messages.length && lastId === nextId) return prev
              return d.messages
            })
          } catch {
            // im lặng — giữ nguyên tin nhắn hiện có
          }
        })()
      }
      return
    }
    if (e.type !== 'message.new') return
    const msg = e.data as DirectMessage
    if (selected && msg.customerId === selected.customerId && msg.channelKey === selected.channelKey) {
      setMessages((prev) => [...prev.filter((m) => m.id !== msg.id), msg])
      if (msg.sender === 'CUSTOMER') {
        void apiGet(`/api/inbox?customerId=${encodeURIComponent(selected.customerId)}&channelKey=${encodeURIComponent(selected.channelKey)}`)
      }
    }
    void loadConversations()
  })

  const openConversation = (conv: Conversation) => {
    setSelected(conv)
    setMessages([])
    void loadMessages(conv.customerId, conv.channelKey)
    void loadMemory(conv.customerId)
    setConversations((prev) => prev.map((c) => (c.key === conv.key ? { ...c, unread: 0 } : c)))
  }

  const send = async () => {
    if (!selected || sending) return
    if (!input.trim() && !pendingImage) return
    setSending(true)
    try {
      const d = await apiPost<{ message: DirectMessage }>('/api/inbox', {
        customerId: selected.customerId,
        channelKey: selected.channelKey,
        content: input.trim() || '[Ảnh khách gửi]',
        imageUrl: pendingImage ?? undefined,
      })
      setMessages((prev) => [...prev, d.message])
      setInput('')
      setPendingImage(null)
    } catch (error) {
      toast({ title: 'Không gửi được tin nhắn', description: error instanceof Error ? error.message : 'Lỗi không xác định', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  // Giả lập khách gửi ảnh: nén về ≤ ~350KB rồi gửi dataURL (Agent sẽ "đọc" bằng Vision)
  const attachImage = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result)
      const img = new Image()
      img.onload = () => {
        if (src.length <= 350 * 1024) {
          setPendingImage(src)
          return
        }
        const scale = Math.min(1, 900 / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return setPendingImage(src)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        setPendingImage(canvas.toDataURL('image/jpeg', 0.72))
      }
      img.onerror = () => setPendingImage(src)
      img.src = src
    }
    reader.readAsDataURL(file)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current += 1
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current -= 1
    if (dragCounter.current <= 0) {
      setIsDragging(false)
      dragCounter.current = 0
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounter.current = 0
    const files = e.dataTransfer.files
    if (files && files.length > 0) {
      const file = files[0]
      if (file.type.startsWith('image/')) {
        attachImage(file)
        toast({ title: 'Đã đính kèm ảnh', description: file.name })
      } else {
        toast({
          title: 'Định dạng không hợp lệ',
          description: 'Chỉ hỗ trợ kéo thả tệp hình ảnh (PNG, JPG, WEBP)',
          variant: 'destructive',
        })
      }
    }
  }

  const runScenario = async (scenario: string) => {
    if (!selected || scenarioSending) return
    setScenarioSending(scenario)
    try {
      await apiPost('/api/simulate', { type: 'zalo_image', scenario, customerId: selected.customerId, channelKey: selected.channelKey })
      toast({ title: 'Khách vừa gửi ảnh kèm lời nhắn', description: 'Agent Hỗ trợ 24/7 sẽ đọc ảnh và trả lời trong giây lát.' })
      void loadMessages(selected.customerId, selected.channelKey)
      void loadMemory(selected.customerId)
    } catch (error) {
      toast({ title: 'Không gửi được kịch bản', description: error instanceof Error ? error.message : 'Lỗi không xác định', variant: 'destructive' })
    } finally {
      setScenarioSending(null)
    }
  }

  const reSummarize = async () => {
    if (!selected || summarizing) return
    setSummarizing(true)
    try {
      await apiPost(`/api/customers/${encodeURIComponent(selected.customerId)}/memory`, {})
      await loadMemory(selected.customerId)
      toast({ title: 'Đã tóm tắt lại trí nhớ', description: 'Hồ sơ khách được chắt lọc lại từ toàn bộ đơn/chat/đánh giá.' })
    } catch (error) {
      toast({ title: 'Không tóm tắt được', description: error instanceof Error ? error.message : 'Lỗi không xác định', variant: 'destructive' })
    } finally {
      setSummarizing(false)
    }
  }

  const visible = conversations.filter((c) => filter === 'ALL' || c.channelKey === filter)
  const profile = (() => {
    if (!memory?.inferredProfile) return null
    try {
      return JSON.parse(memory.inferredProfile) as { gender?: string; ageHint?: string; style?: string }
    } catch {
      return null
    }
  })()

  return (
    <Card className="border-border/70 p-0 shadow-sm">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" />
          Hộp thư Zalo — Agent trả lời 100% giọng người Ưu Đàm
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? 'default' : 'outline'} className="h-8" onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid p-0 lg:grid-cols-[320px_1fr_300px]">
        {/* Danh sách hội thoại */}
        <div className={cn('flex-col border-r', selected ? 'hidden lg:flex' : 'flex')} style={{ minHeight: 480 }}>
          <div className="lg:max-h-[62vh] lg:min-h-[430px] lg:overflow-y-auto [scrollbar-width:thin]">
            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Chưa có hội thoại khách hàng nào. Bạn có thể khởi tạo hội thoại mẫu tại Trung tâm Điều hành AI để kiểm thử.</p>
            ) : (
              visible.map((conv) => (
                <button
                  key={conv.key}
                  onClick={() => {
                    setMobilePanel('chat')
                    openConversation(conv)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60',
                    selected?.key === conv.key && 'bg-primary/5',
                  )}
                >
                  <span className="relative">
                    <CustomerAvatar customer={conv.customer} />
                    <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background" style={{ backgroundColor: CHANNEL_KEY_COLORS[conv.channelKey] ?? '#999' }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{conv.customer.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(conv.lastMessage.createdAt)}</span>
                    </span>
                    <span className={cn('mt-0.5 line-clamp-1 block text-xs', conv.unread > 0 ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {conv.lastMessage.sender === 'CUSTOMER' ? '' : conv.lastMessage.isAuto ? '🤖 ' : '👤 '}
                      {conv.lastMessage.content}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">{CHANNEL_KEY_LABELS[conv.channelKey] ?? conv.channelKey}</span>
                      {conv.unread > 0 && <Badge className="h-4 rounded-full bg-red-500 px-1.5 text-[10px] text-white">{conv.unread}</Badge>}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Khung chat */}
        <div
          className={cn('relative flex min-h-[480px] flex-col', selected ? 'flex' : 'hidden lg:flex', isDragging && 'ring-2 ring-primary ring-inset')}
          onDragEnter={selected ? handleDragEnter : undefined}
          onDragOver={selected ? handleDragOver : undefined}
          onDragLeave={selected ? handleDragLeave : undefined}
          onDrop={selected ? handleDrop : undefined}
        >
          {isDragging && selected && (
            <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 p-6 text-center backdrop-blur-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload className="h-6 w-6 animate-bounce" />
              </div>
              <p className="text-sm font-semibold text-foreground">Thả ảnh vào đây để đính kèm</p>
              <p className="text-xs text-muted-foreground">Hỗ trợ JPG, PNG, WEBP — Hệ thống sẽ nén tối ưu và gửi cho khách</p>
            </div>
          )}
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <User className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Chọn một hội thoại để xem — Agent trả lời bằng giọng chủ tiệm, có trí nhớ từng khách.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs lg:hidden"
                  onClick={() => setSelected(null)}
                  aria-label="Quay lại danh sách"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span className="hidden xs:inline">Danh sách</span>
                </Button>
                <CustomerAvatar customer={{ name: selected.customer.name, avatarUrl: memory?.avatarUrl }} className="h-9 w-9 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {selected.customer.name}
                    {memory?.salutation ? <span className="ml-2 text-xs font-normal text-muted-foreground">{memory.salutation}</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selected.customer.phone ?? '—'} · {CHANNEL_KEY_LABELS[selected.channelKey] ?? selected.channelKey}
                  </p>
                </div>
                <Button
                  variant={mobilePanel === 'memory' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 gap-1 px-2 text-xs lg:hidden"
                  onClick={() => setMobilePanel((p) => (p === 'chat' ? 'memory' : 'chat'))}
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {mobilePanel === 'chat' ? 'Trí nhớ AI' : 'Khung chat'}
                </Button>
                <Badge variant="outline" className="hidden bg-emerald-50 text-emerald-700 sm:inline-flex dark:bg-emerald-950 dark:text-emerald-400">
                  <Bot className="mr-1 h-3 w-3" /> Em (AI) đang trực
                </Badge>
              </div>

              <div ref={scrollRef} className={cn('max-h-[52vh] min-h-[280px] flex-1 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-width:thin]', mobilePanel === 'memory' && 'hidden lg:block')}>
                {messagesLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-2/3" />
                    ))}
                  </div>
                ) : messages.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Chưa có tin nhắn trong hội thoại này.</p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender !== 'CUSTOMER'
                    const reactions = parseReactions(m.reactions)
                    return (
                      <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                        <div className={cn('max-w-[85%] space-y-1 sm:max-w-[70%]', mine && 'items-end text-right')}>
                          {m.imageUrl && (
                             
                            <img
                              src={m.imageUrl}
                              alt="Ảnh khách đính kèm"
                              className="max-h-56 w-auto max-w-full rounded-xl border object-cover"
                              onError={(ev) => {
                                ;(ev.target as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          )}
                          <div
                            className={cn(
                              'rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                              m.sender === 'CUSTOMER' && 'rounded-bl-md bg-muted text-foreground',
                              m.sender === 'AGENT' && 'rounded-br-md bg-emerald-600 text-white',
                              m.sender === 'OPERATOR' && 'rounded-br-md bg-violet-600 text-white',
                            )}
                          >
                            {m.content}
                          </div>
                          {reactions.length > 0 && (
                            <div className={cn('flex gap-1', mine ? 'justify-end pr-1' : 'justify-start pl-1')}>
                              {reactions.map((r, i) => (
                                <span
                                  key={i}
                                  title={`Agent ${r.agent === 'SUPPORT_AGENT' ? 'Hỗ trợ 24/7' : r.agent} thả cảm xúc`}
                                  className="inline-flex items-center gap-0.5 rounded-full border bg-background px-1.5 py-0.5 text-[11px] shadow-sm"
                                >
                                  {r.emoji}
                                </span>
                              ))}
                            </div>
                          )}
                          {m.sender === 'CUSTOMER' && m.imageAnalysis && (
                            <p className="flex items-start gap-1 pl-1 text-left text-[11px] italic text-muted-foreground">
                              <Bot className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                              <span>AI đọc ảnh: {m.imageAnalysis}</span>
                            </p>
                          )}
                          {mine && (
                            <p className="pr-1 text-[10px] text-muted-foreground">
                              {m.sender === 'AGENT' ? `🤖 ${m.agentName ?? 'Agent'}${m.isAuto ? ' · Tự động' : ''}` : '👤 Bạn (người vận hành)'} · {timeAgo(m.createdAt)}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Kịch bản test ảnh khách gửi */}
              <div className={cn('flex flex-wrap items-center gap-1.5 border-t px-3 pt-2', mobilePanel === 'memory' && 'hidden lg:flex')}>
                <span className="text-[11px] font-medium text-muted-foreground">Giả lập khách gửi ảnh:</span>
                {IMAGE_SCENARIOS.map((sc) => (
                  <Button key={sc.key} size="sm" variant="outline" className="h-7 px-2 text-[11px]" disabled={scenarioSending !== null} onClick={() => void runScenario(sc.key)}>
                    {scenarioSending === sc.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
                    {sc.label}
                  </Button>
                ))}
              </div>

              <div className={cn('flex items-center gap-2 p-3', mobilePanel === 'memory' && 'hidden lg:flex')}>
                {pendingImage && (
                  <div className="relative shrink-0">
                    { }
                    <img src={pendingImage} alt="Ảnh sẽ gửi" className="h-10 w-10 rounded-md border object-cover" />
                    <button
                      type="button"
                      aria-label="Bỏ ảnh"
                      className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-white"
                      onClick={() => setPendingImage(null)}
                    >
                      ×
                    </button>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) attachImage(f)
                    e.target.value = ''
                  }}
                />
                <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Đính kèm ảnh" onClick={() => fileRef.current?.click()} disabled={sending}>
                  <ImagePlus className="h-4 w-4" />
                </Button>
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder={pendingImage ? 'Thêm lời nhắn kèm ảnh rồi gửi…' : 'Trả lời thay Agent (nếu cần)…'}
                  disabled={sending}
                  aria-label="Nội dung tin nhắn"
                />
                <Button onClick={() => void send()} disabled={(!input.trim() && !pendingImage) || sending} aria-label="Gửi tin nhắn">
                  {sending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Sidebar: Chân dung & Trí nhớ AI */}
        <div className={cn('border-t lg:border-l lg:border-t-0', selected && mobilePanel === 'memory' ? 'block' : 'hidden lg:block')}>
          {!selected ? (
            <p className="p-6 text-center text-xs text-muted-foreground">Chọn hội thoại để xem chân dung & trí nhớ AI của khách.</p>
          ) : memoryLoading ? (
            <div className="space-y-3 p-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : memory ? (
            <div className="space-y-3 p-4 lg:max-h-[70vh] lg:overflow-y-auto [scrollbar-width:thin]">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                  Chân dung & Trí nhớ AI
                </p>
                <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[11px]" disabled={summarizing} onClick={() => void reSummarize()}>
                  <RefreshCw className={cn('h-3 w-3', summarizing && 'animate-spin')} />
                  Tóm tắt lại
                </Button>
              </div>

              <div className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <CustomerAvatar customer={{ name: memory.name, avatarUrl: memory.avatarUrl }} className="h-12 w-12" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{memory.name}</p>
                  <p className="truncate text-xs text-emerald-700 dark:text-emerald-400">{memory.salutation ?? '—'}</p>
                  {profile && (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {profile.gender} · {profile.ageHint}
                      {profile.style ? ` · ${profile.style}` : ''}
                    </p>
                  )}
                </div>
              </div>

              {memory.contextSummary && (
                <div className="rounded-xl border bg-muted/40 p-3">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tóm tắt ngữ cảnh</p>
                  <p className="text-xs leading-relaxed">{memory.contextSummary}</p>
                </div>
              )}

              {parseJsonArray(memory.preferences).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sở thích / Nhu cầu</p>
                  <div className="flex flex-wrap gap-1.5">
                    {parseJsonArray(memory.preferences).map((p, i) => (
                      <Badge key={i} variant="outline" className="bg-emerald-50 text-[11px] font-normal text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                        {p}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {parseJsonArray(memory.painPoints).length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lưu ý / Góp ý cũ</p>
                  <div className="space-y-1.5">
                    {parseJsonArray(memory.painPoints).map((p, i) => (
                      <p key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                        {p}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {memory.nextFollowUp && (
                <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950">
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-400">Gợi ý chăm sóc tiếp theo</p>
                  <p className="text-xs leading-relaxed text-violet-900 dark:text-violet-300">{memory.nextFollowUp}</p>
                </div>
              )}

              <p className="text-[10px] text-muted-foreground">
                {memory.memoryUpdatedAt ? `Cập nhật: ${timeAgo(memory.memoryUpdatedAt)}` : 'Chưa chắt lọc'} · nguồn: đơn hàng, tin nhắn Zalo, đánh giá sao
              </p>
            </div>
          ) : (
            <p className="p-6 text-center text-xs text-muted-foreground">Không tải được trí nhớ khách hàng.</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
