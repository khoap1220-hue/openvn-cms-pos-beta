'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

export type NotificationCategory = 'orders' | 'inventory' | 'channels' | 'inbox' | 'system'
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical'
export type PwaPlatform = 'ios' | 'android' | 'desktop'

export interface PwaNotificationPrefs {
  osPushEnabled: boolean
  soundEnabled: boolean
  vibrateEnabled: boolean
  categories: Record<NotificationCategory, boolean>
}

export interface AppNotificationItem {
  id: string
  title: string
  body: string
  category: NotificationCategory
  severity: NotificationSeverity
  targetUrl: string
  view?: string
  createdAt: string
  read: boolean
}

export interface DispatchNotificationInput {
  title: string
  body: string
  category: NotificationCategory
  severity?: NotificationSeverity
  targetUrl?: string
  view?: string
  dedupeKey?: string
  dedupeWindowMs?: number
  urgent?: boolean
  force?: boolean
}

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

export interface PwaStoreSnapshot {
  hydrated: boolean
  isStandalone: boolean
  canPromptInstall: boolean
  swReady: boolean
  platform: PwaPlatform
  permission: NotificationPermission | 'unsupported'
  prefs: PwaNotificationPrefs
  feed: AppNotificationItem[]
  unreadCount: number
}

const PREFS_STORAGE_KEY = 'openvn:pwa:prefs:v1'
const FEED_STORAGE_KEY = 'openvn:pwa:feed:v1'
const BROADCAST_CHANNEL_NAME = 'openvn-pwa-sync-v1'
const MAX_FEED_ITEMS = 50

const DEFAULT_PREFS: PwaNotificationPrefs = {
  osPushEnabled: true,
  soundEnabled: true,
  vibrateEnabled: true,
  categories: {
    orders: true,
    inventory: true,
    channels: true,
    inbox: true,
    system: true,
  },
}

const SERVER_SNAPSHOT: PwaStoreSnapshot = {
  hydrated: false,
  isStandalone: false,
  canPromptInstall: false,
  swReady: false,
  platform: 'desktop',
  permission: 'default',
  prefs: DEFAULT_PREFS,
  feed: [],
  unreadCount: 0,
}

let runtimeBooted = false
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null
let swReadyFlag = false
let broadcastBus: BroadcastChannel | null = null
const listeners = new Set<() => void>()
const dedupeMap = new Map<string, number>()

let cachedPrefsRaw: string | null = null
let cachedPrefsVal: PwaNotificationPrefs = DEFAULT_PREFS
let cachedFeedRaw: string | null = null
let cachedFeedVal: AppNotificationItem[] = []
let cachedSnapshot: PwaStoreSnapshot = SERVER_SNAPSHOT

function emitChange(broadcastCrossTab = false) {
  rebuildClientSnapshot()
  syncAppBadge(cachedSnapshot.unreadCount)
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      // ignore listener errors
    }
  }
  if (broadcastCrossTab && broadcastBus) {
    try {
      broadcastBus.postMessage({ type: 'SYNC', at: Date.now() })
    } catch {
      // ignore closed channel
    }
  }
}

export function resolveSubpathAssetUrl(relPath: string): string {
  if (typeof window === 'undefined') return relPath
  const cleanRel = relPath.startsWith('/') ? relPath : `/${relPath}`
  const betaCfg = (window as Window & { __BETA_SUBPATH_CFG__?: { basePath?: string } })
    .__BETA_SUBPATH_CFG__
  let basePath = (betaCfg?.basePath || '').replace(/\/+$/, '')
  if (!basePath && typeof document !== 'undefined') {
    const mfHref = document.querySelector('link[rel="manifest"]')?.getAttribute('href') || ''
    if (mfHref.endsWith('/manifest.webmanifest') && mfHref !== '/manifest.webmanifest') {
      basePath = mfHref.slice(0, -'/manifest.webmanifest'.length)
    }
  }
  if (basePath && !cleanRel.startsWith(`${basePath}/`) && cleanRel !== basePath) {
    return `${basePath}${cleanRel}`
  }
  return cleanRel
}

function detectPlatform(): PwaPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent || ''
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  if (isIOS) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    if (window.matchMedia('(display-mode: window-controls-overlay)').matches) return true
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  } catch {
    // ignore matchMedia error
  }
  return false
}

function detectNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  return Notification.permission
}

function readPrefsFromStorage(): PwaNotificationPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY)
    if (raw === cachedPrefsRaw) return cachedPrefsVal
    cachedPrefsRaw = raw
    if (!raw) {
      cachedPrefsVal = DEFAULT_PREFS
      return cachedPrefsVal
    }
    const parsed = JSON.parse(raw) as Partial<PwaNotificationPrefs>
    cachedPrefsVal = {
      osPushEnabled: parsed.osPushEnabled ?? true,
      soundEnabled: parsed.soundEnabled ?? true,
      vibrateEnabled: parsed.vibrateEnabled ?? true,
      categories: {
        orders: parsed.categories?.orders ?? true,
        inventory: parsed.categories?.inventory ?? true,
        channels: parsed.categories?.channels ?? true,
        inbox: parsed.categories?.inbox ?? true,
        system: parsed.categories?.system ?? true,
      },
    }
    return cachedPrefsVal
  } catch {
    return DEFAULT_PREFS
  }
}

function writePrefsToStorage(next: PwaNotificationPrefs) {
  if (typeof window === 'undefined') return
  try {
    const raw = JSON.stringify(next)
    window.localStorage.setItem(PREFS_STORAGE_KEY, raw)
    cachedPrefsRaw = raw
    cachedPrefsVal = next
  } catch {
    // ignore quota error
  }
  emitChange(true)
}

function readFeedFromStorage(): AppNotificationItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(FEED_STORAGE_KEY)
    if (raw === cachedFeedRaw) return cachedFeedVal
    cachedFeedRaw = raw
    if (!raw) {
      cachedFeedVal = []
      return cachedFeedVal
    }
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      cachedFeedVal = []
      return cachedFeedVal
    }
    cachedFeedVal = parsed
      .filter((x): x is AppNotificationItem => Boolean(x && typeof x.id === 'string' && typeof x.title === 'string'))
      .slice(0, MAX_FEED_ITEMS)
    return cachedFeedVal
  } catch {
    return []
  }
}

function writeFeedToStorage(next: AppNotificationItem[]) {
  if (typeof window === 'undefined') return
  const capped = next.slice(0, MAX_FEED_ITEMS)
  try {
    const raw = JSON.stringify(capped)
    window.localStorage.setItem(FEED_STORAGE_KEY, raw)
    cachedFeedRaw = raw
    cachedFeedVal = capped
  } catch {
    // ignore quota error
  }
  emitChange(true)
}

function syncAppBadge(unreadCount: number) {
  if (typeof navigator === 'undefined') return
  const nav = navigator as Navigator & {
    setAppBadge?: (contents?: number) => Promise<void>
    clearAppBadge?: () => Promise<void>
  }
  try {
    if (unreadCount > 0 && typeof nav.setAppBadge === 'function') {
      void nav.setAppBadge(unreadCount).catch(() => undefined)
    } else if (unreadCount <= 0 && typeof nav.clearAppBadge === 'function') {
      void nav.clearAppBadge().catch(() => undefined)
    }
  } catch {
    // ignore unsupported platform error
  }
}

function rebuildClientSnapshot(): PwaStoreSnapshot {
  if (typeof window === 'undefined') return SERVER_SNAPSHOT
  const prefs = readPrefsFromStorage()
  const feed = readFeedFromStorage()
  const unreadCount = feed.reduce((acc, item) => (item.read ? acc : acc + 1), 0)
  const isStandalone = detectStandalone()
  const canPromptInstall = !isStandalone && Boolean(deferredInstallPrompt)
  const platform = detectPlatform()
  const permission = detectNotificationPermission()

  if (
    cachedSnapshot.hydrated &&
    cachedSnapshot.isStandalone === isStandalone &&
    cachedSnapshot.canPromptInstall === canPromptInstall &&
    cachedSnapshot.swReady === swReadyFlag &&
    cachedSnapshot.platform === platform &&
    cachedSnapshot.permission === permission &&
    cachedSnapshot.prefs === prefs &&
    cachedSnapshot.feed === feed &&
    cachedSnapshot.unreadCount === unreadCount
  ) {
    return cachedSnapshot
  }

  cachedSnapshot = {
    hydrated: true,
    isStandalone,
    canPromptInstall,
    swReady: swReadyFlag,
    platform,
    permission,
    prefs,
    feed,
    unreadCount,
  }
  return cachedSnapshot
}

export function initPwaClientRuntime(): void {
  if (typeof window === 'undefined' || runtimeBooted) return
  runtimeBooted = true

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault()
    deferredInstallPrompt = e as BeforeInstallPromptEvent
    emitChange(false)
  })

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null
    emitChange(true)
  })

  try {
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener('change', () => emitChange(false))
  } catch {
    // ignore legacy browser
  }

  window.addEventListener('storage', (ev) => {
    if (ev.key === PREFS_STORAGE_KEY || ev.key === FEED_STORAGE_KEY) {
      emitChange(false)
    }
  })

  window.addEventListener('focus', () => {
    emitChange(false)
  })

  if ('BroadcastChannel' in window) {
    try {
      broadcastBus = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      broadcastBus.onmessage = () => {
        emitChange(false)
      }
    } catch {
      broadcastBus = null
    }
  }

  if ('serviceWorker' in navigator) {
    const swUrl = resolveSubpathAssetUrl('/sw.js')
    const swScope = resolveSubpathAssetUrl('/')
    navigator.serviceWorker
      .register(swUrl, { scope: swScope.endsWith('/') ? swScope : `${swScope}/` })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        swReadyFlag = true
        emitChange(false)
      })
      .catch(() => {
        // không chặn ứng dụng nếu trình duyệt tắt SW
      })

    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; url?: string; view?: string | null } | null
      if (!data || data.type !== 'OPENVN_NOTIFICATION_CLICK') return
      window.dispatchEvent(
        new CustomEvent('openvn:navigate-from-notification', {
          detail: { url: data.url || '/', view: data.view || null },
        })
      )
    })
  }

  rebuildClientSnapshot()
  syncAppBadge(cachedSnapshot.unreadCount)
}

export function playNotificationChime(severity: NotificationSeverity = 'info'): void {
  if (typeof window === 'undefined') return
  const AudioCtx =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  try {
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.11, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36)

    const osc1 = ctx.createOscillator()
    const osc2 = ctx.createOscillator()
    osc1.type = 'sine'
    osc2.type = 'triangle'

    if (severity === 'critical' || severity === 'warning') {
      osc1.frequency.setValueAtTime(659.25, now)
      osc1.frequency.setValueAtTime(523.25, now + 0.14)
      osc2.frequency.setValueAtTime(329.63, now)
    } else {
      osc1.frequency.setValueAtTime(880, now)
      osc1.frequency.setValueAtTime(1318.51, now + 0.12)
      osc2.frequency.setValueAtTime(440, now)
    }

    osc1.connect(gain)
    osc2.connect(gain)
    osc1.start(now)
    osc2.start(now)
    osc1.stop(now + 0.38)
    osc2.stop(now + 0.38)
    setTimeout(() => {
      void ctx.close().catch(() => undefined)
    }, 500)
  } catch {
    // Trình duyệt chặn tự phát âm thanh khi chưa có tương tác chuột — bỏ qua an toàn
  }
}

async function triggerNativeOsNotification(item: AppNotificationItem, urgent = false): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  if (Notification.permission !== 'granted') return false

  const icon = resolveSubpathAssetUrl('/icons/icon-192.png')
  const targetUrl = resolveSubpathAssetUrl(item.targetUrl || '/')

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(item.title, {
          body: item.body,
          icon,
          badge: icon,
          tag: item.id,
          requireInteraction: urgent,
          data: {
            url: targetUrl,
            view: item.view ?? null,
            category: item.category,
          },
        })
        return true
      }
    }
  } catch {
    // Fallback xuống Notification constructor trên Desktop bên dưới
  }

  try {
    const n = new Notification(item.title, {
      body: item.body,
      icon,
      tag: item.id,
    })
    n.onclick = () => {
      window.focus()
      window.dispatchEvent(
        new CustomEvent('openvn:navigate-from-notification', {
          detail: { url: targetUrl, view: item.view ?? null },
        })
      )
      n.close()
    }
    return true
  } catch {
    return false
  }
}

export async function dispatchAppNotification(
  input: DispatchNotificationInput
): Promise<AppNotificationItem | null> {
  if (typeof window === 'undefined') return null
  initPwaClientRuntime()

  const prefs = readPrefsFromStorage()
  if (!input.force && !prefs.categories[input.category]) {
    return null
  }

  if (input.dedupeKey && !input.force) {
    const now = Date.now()
    const windowMs = input.dedupeWindowMs ?? 60_000
    const prevAt = dedupeMap.get(input.dedupeKey)
    if (prevAt && now - prevAt < windowMs) {
      return null
    }
    dedupeMap.set(input.dedupeKey, now)
  }

  const item: AppNotificationItem = {
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    body: input.body,
    category: input.category,
    severity: input.severity ?? 'info',
    targetUrl: input.targetUrl ?? (input.view ? `/?view=${input.view}` : '/'),
    view: input.view,
    createdAt: new Date().toISOString(),
    read: false,
  }

  const currentFeed = readFeedFromStorage()
  writeFeedToStorage([item, ...currentFeed])

  if (prefs.soundEnabled || input.force) {
    playNotificationChime(item.severity)
  }

  if ((prefs.vibrateEnabled || input.force) && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([160, 70, 160])
    } catch {
      // ignore
    }
  }

  if (prefs.osPushEnabled || input.force) {
    await triggerNativeOsNotification(item, Boolean(input.urgent))
  }

  return item
}

export async function requestOsNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
  initPwaClientRuntime()
  try {
    const result = await Notification.requestPermission()
    if (result === 'granted') {
      const prefs = readPrefsFromStorage()
      if (!prefs.osPushEnabled) {
        writePrefsToStorage({ ...prefs, osPushEnabled: true })
      } else {
        emitChange(true)
      }
    } else {
      emitChange(false)
    }
    return result
  } catch {
    return Notification.permission
  }
}

export async function sendTestAppNotification(): Promise<{
  item: AppNotificationItem | null
  osDelivered: boolean
  permission: NotificationPermission | 'unsupported'
}> {
  const initialPerm = detectNotificationPermission()
  const item = await dispatchAppNotification({
    title: 'OPENVN · Ưu Đàm — Thông báo đẩy hoạt động!',
    body: 'Thiết bị đã sẵn sàng nhận chuông báo đơn hàng Shopee/POS mới, cảnh báo tồn kho thật CMS và tin nhắn khách hàng như App gốc.',
    category: 'system',
    severity: 'success',
    view: 'orders',
    targetUrl: '/?view=orders',
    force: true,
  })

  if (initialPerm === 'default' && item) {
    void requestOsNotificationPermission().then((nextPerm) => {
      if (nextPerm === 'granted') {
        void triggerNativeOsNotification(item, false)
      }
    })
  }

  return {
    item,
    osDelivered: initialPerm === 'granted',
    permission: initialPerm,
  }
}

export async function triggerNativeInstallPrompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstallPrompt) return 'unavailable'
  const promptEvent = deferredInstallPrompt
  try {
    await promptEvent.prompt()
    const choice = await promptEvent.userChoice
    if (choice.outcome === 'accepted') {
      deferredInstallPrompt = null
    }
    emitChange(false)
    return choice.outcome
  } catch {
    emitChange(false)
    return 'unavailable'
  }
}

export function updatePwaNotificationPrefs(patch: Partial<PwaNotificationPrefs>): void {
  const current = readPrefsFromStorage()
  const next: PwaNotificationPrefs = {
    ...current,
    ...patch,
    categories: {
      ...current.categories,
      ...(patch.categories ?? {}),
    },
  }
  writePrefsToStorage(next)
}

export function markNotificationRead(id: string): void {
  const current = readFeedFromStorage()
  let changed = false
  const next = current.map((item) => {
    if (item.id === id && !item.read) {
      changed = true
      return { ...item, read: true }
    }
    return item
  })
  if (changed) writeFeedToStorage(next)
}

export function markAllNotificationsRead(): void {
  const current = readFeedFromStorage()
  if (!current.some((x) => !x.read)) return
  writeFeedToStorage(current.map((item) => (item.read ? item : { ...item, read: true })))
}

export function clearNotificationFeed(): void {
  writeFeedToStorage([])
}

function subscribePwaStore(listener: () => void): () => void {
  initPwaClientRuntime()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getPwaClientSnapshot(): PwaStoreSnapshot {
  initPwaClientRuntime()
  return rebuildClientSnapshot()
}

function getPwaServerSnapshot(): PwaStoreSnapshot {
  return SERVER_SNAPSHOT
}

export function usePwaAppCenter() {
  const snapshot = useSyncExternalStore(
    subscribePwaStore,
    getPwaClientSnapshot,
    getPwaServerSnapshot
  )

  useEffect(() => {
    initPwaClientRuntime()
  }, [])

  const setPrefs = useCallback((patch: Partial<PwaNotificationPrefs>) => {
    updatePwaNotificationPrefs(patch)
  }, [])

  const toggleCategory = useCallback(
    (cat: NotificationCategory, enabled: boolean) => {
      const current = readPrefsFromStorage()
      updatePwaNotificationPrefs({
        categories: {
          ...current.categories,
          [cat]: enabled,
        },
      })
    },
    []
  )

  return {
    ...snapshot,
    setPrefs,
    toggleCategory,
    requestPermission: requestOsNotificationPermission,
    sendTestNotification: sendTestAppNotification,
    promptInstall: triggerNativeInstallPrompt,
    markRead: markNotificationRead,
    markAllRead: markAllNotificationsRead,
    clearFeed: clearNotificationFeed,
  }
}
