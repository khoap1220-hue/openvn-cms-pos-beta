'use client'

// Hộp thư Zalo (OA + cá nhân): hội thoại khách, Agent trả lời tự động 24/7,
// người vận hành có thể vào chat thay Agent bất cứ lúc nào.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bot, MessageSquare, Send, User } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { apiGet, apiPost } from '@/lib/api'
import { useRealtime } from '@/hooks/use-realtime'
import { useToast } from '@/hooks/use-toast'
import { CHANNEL_KEY_LABELS, type Conversation, type DirectMessage } from '@/lib/types'
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

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useRealtime((e) => {
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
    setConversations((prev) => prev.map((c) => (c.key === conv.key ? { ...c, unread: 0 } : c)))
  }

  const send = async () => {
    if (!selected || !input.trim() || sending) return
    setSending(true)
    try {
      const d = await apiPost<{ message: DirectMessage }>('/api/inbox', {
        customerId: selected.customerId,
        channelKey: selected.channelKey,
        content: input.trim(),
      })
      setMessages((prev) => [...prev, d.message])
      setInput('')
    } catch (error) {
      toast({ title: 'Không gửi được tin nhắn', description: error instanceof Error ? error.message : 'Lỗi không xác định', variant: 'destructive' })
    } finally {
      setSending(false)
    }
  }

  const visible = conversations.filter((c) => filter === 'ALL' || c.channelKey === filter)

  return (
    <Card className="border-border/70 p-0 shadow-sm">
      <CardHeader className="border-b pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="h-4 w-4 text-primary" />
          Hộp thư Zalo — Agent trả lời tự động 24/7
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? 'default' : 'outline'} className="h-8" onClick={() => setFilter(f.key)}>
              {f.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="grid p-0 lg:grid-cols-[340px_1fr]">
        {/* Danh sách hội thoại */}
        <div className={cn('flex-col border-r', selected ? 'hidden lg:flex' : 'flex')} style={{ minHeight: 480 }}>
          <div className="max-h-[62vh] min-h-[430px] overflow-y-auto [scrollbar-width:thin]">
            {loading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">Chưa có hội thoại nào. Dùng «Mô phỏng khách nhắn tin» ở Buồng lái để thử.</p>
            ) : (
              visible.map((conv) => (
                <button
                  key={conv.key}
                  onClick={() => openConversation(conv)}
                  className={cn(
                    'flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors hover:bg-muted/60',
                    selected?.key === conv.key && 'bg-primary/5',
                  )}
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                    {conv.customer.name.charAt(0).toUpperCase()}
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
        <div className={cn('flex min-h-[480px] flex-col', selected ? 'flex' : 'hidden lg:flex')}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
              <User className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Chọn một hội thoại để xem — tin nhắn Agent được trả lời tự động bởi AI.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden" onClick={() => setSelected(null)} aria-label="Quay lại danh sách">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  {selected.customer.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{selected.customer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {selected.customer.phone ?? '—'} · {CHANNEL_KEY_LABELS[selected.channelKey] ?? selected.channelKey}
                  </p>
                </div>
                <Badge variant="outline" className="hidden bg-emerald-50 text-emerald-700 sm:inline-flex dark:bg-emerald-950 dark:text-emerald-400">
                  <Bot className="mr-1 h-3 w-3" /> AI đang trực
                </Badge>
              </div>

              <div ref={scrollRef} className="max-h-[46vh] min-h-[320px] flex-1 space-y-3 overflow-y-auto px-4 py-4 [scrollbar-width:thin]">
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
                    return (
                      <div key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                        <div className={cn('max-w-[85%] space-y-1 sm:max-w-[70%]', mine && 'items-end text-right')}>
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

              <div className="flex items-center gap-2 border-t p-3">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder="Trả lời thay Agent (nếu cần)…"
                  disabled={sending}
                  aria-label="Nội dung tin nhắn"
                />
                <Button onClick={() => void send()} disabled={!input.trim() || sending} aria-label="Gửi tin nhắn">
                  {sending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
