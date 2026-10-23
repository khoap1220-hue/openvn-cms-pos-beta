'use client'

// Hook realtime dùng chung: 1 kết nối socket.io duy nhất tới mini-service (port 3003)
// Mọi view đăng ký nhận event 'cms' để tự cập nhật dữ liệu.

import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

export interface CmsEvent {
  type: string
  at: string
  data: unknown
}

let socket: Socket | null = null
let socketRefCount = 0
let connected = false

const eventListeners = new Set<(e: CmsEvent) => void>()
const statusListeners = new Set<(connected: boolean) => void>()

function setConnected(value: boolean) {
  if (connected === value) return
  connected = value
  statusListeners.forEach((listener) => listener(value))
}

function ensureSocket() {
  if (socket) return
  // KHÔNG đổi path '/': Caddy gateway dùng nó để forward tới đúng port
  socket = io('/?XTransformPort=3003', {
    transports: ['websocket', 'polling'],
    forceNew: true,
    reconnection: true,
    reconnectionAttempts: 30,
    reconnectionDelay: 1500,
    timeout: 10000,
  })
  socket.on('connect', () => setConnected(true))
  socket.on('disconnect', () => setConnected(false))
  socket.on('connect_error', () => setConnected(false))
  socket.on('cms', (payload: CmsEvent) => {
    eventListeners.forEach((listener) => listener(payload))
  })
}

function releaseSocket() {
  if (socketRefCount <= 0 && socket) {
    socket.disconnect()
    socket = null
    setConnected(false)
  }
}

/** Đăng ký nhận event realtime. Handler luôn đọc bản mới nhất qua ref. */
export function useRealtime(handler: (e: CmsEvent) => void) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    socketRefCount++
    ensureSocket()
    const listener = (e: CmsEvent) => ref.current(e)
    eventListeners.add(listener)
    return () => {
      eventListeners.delete(listener)
      socketRefCount--
      releaseSocket()
    }
  }, [])
}

/** Trạng thái kết nối realtime (để hiện chip Live ở header). */
export function useRealtimeStatus(): boolean {
  const [state, setState] = useState<boolean>(() => connected)
  useEffect(() => {
    socketRefCount++
    ensureSocket()
    const listener = (value: boolean) => setState(value)
    statusListeners.add(listener)
    return () => {
      statusListeners.delete(listener)
      socketRefCount--
      releaseSocket()
    }
  }, [])
  return state
}
