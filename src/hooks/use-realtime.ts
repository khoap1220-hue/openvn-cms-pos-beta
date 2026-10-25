'use client'

// Hook realtime dùng chung: 1 kết nối socket.io duy nhất tới mini-service (port 3003).
// Mọi view đăng ký nhận event 'cms' để tự cập nhật dữ liệu.
//
// Tự chữa khi WebSocket hỏng: mất kết nối → tự hạ cấp sang polling 10s, bắn event
// 'realtime.poll' cho MỌI eventListener (views tự reload im lặng — không loading flash);
// kết nối lại được → quay về 'live' và dừng polling.

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

export interface CmsEvent {
  type: string
  at: string
  data: unknown
}

/** Trạng thái realtime: live = WebSocket đang kết nối, polling = fallback 10s, offline = chưa kết nối. */
export type RealtimeMode = 'live' | 'polling' | 'offline'

const FALLBACK_POLL_MS = 10_000

let socket: Socket | null = null
let socketRefCount = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let mode: RealtimeMode = 'offline'

const eventListeners = new Set<(e: CmsEvent) => void>()
const modeListeners = new Set<(m: RealtimeMode) => void>()

function setMode(next: RealtimeMode) {
  if (mode === next) return
  mode = next
  modeListeners.forEach((listener) => listener(next))
}

/** Polling dự phòng: bắn event 'realtime.poll' cho mọi listener mỗi 10s cho tới khi WS sống lại. */
function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    const event: CmsEvent = { type: 'realtime.poll', at: new Date().toISOString(), data: null }
    eventListeners.forEach((listener) => listener(event))
  }, FALLBACK_POLL_MS)
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

function ensureSocket() {
  if (socket) return
  // KHÔNG đổi path '/': Caddy gateway dùng nó để forward tới đúng port
  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 10_000,
    timeout: 10000,
  })
  socket.on('connect', () => {
    stopPolling()
    setMode('live')
  })
  socket.on('disconnect', () => {
    startPolling()
    setMode('polling')
  })
  // connect_error cũng bắn trong lúc đang cố reconnect — cứ hạ cấp sang polling
  socket.on('connect_error', () => {
    startPolling()
    setMode('polling')
  })
  socket.on('cms', (payload: CmsEvent) => {
    eventListeners.forEach((listener) => listener(payload))
  })
}

function releaseSocket() {
  if (socketRefCount <= 0 && socket) {
    socket.disconnect() // có thể bắn 'disconnect' → startPolling + setMode('polling')
    socket = null
    stopPolling()
    setMode('offline')
  }
}

/** Đăng ký nhận event realtime. Handler luôn đọc bản mới nhất qua ref. */
export function useRealtime(handler: (e: CmsEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    socketRefCount++
    // QUAN TRỌNG: đăng ký listener TRƯỚC khi ensureSocket() — nếu không component
    // mount đầu sẽ bỏ lỡ các chuyển mode/poll ngay lúc socket mới được tạo.
    const listener = (e: CmsEvent) => ref.current(e)
    eventListeners.add(listener)
    ensureSocket()
    return () => {
      eventListeners.delete(listener)
      socketRefCount--
      releaseSocket()
    }
  }, [])
}

/**
 * Chế độ realtime hiện tại (live / polling / offline) để hiện badge 3 trạng thái ở header.
 * Sync state với mode module-level + đăng ký modeListener TRƯỚC ensureSocket()
 * (đúng thứ tự như useRealtime) để không bỏ lỡ chuyển mode lúc socket vừa tạo.
 */
export function useRealtimeStatus(): RealtimeMode {
  const [state, setState] = useState<RealtimeMode>(() => mode)
  useEffect(() => {
    socketRefCount++
    // Đồng bộ state với mode HIỆN TẠI ngay sau khi đăng ký listener, trước ensureSocket()
    // — gọi qua listener chính là "setStateSync(mode)" của spec (né rule set-state-in-effect).
    const listener = (m: RealtimeMode) => setState(m)
    modeListeners.add(listener)
    listener(mode)
    ensureSocket()
    return () => {
      modeListeners.delete(listener)
      socketRefCount--
      releaseSocket()
    }
  }, [])
  return state
}
