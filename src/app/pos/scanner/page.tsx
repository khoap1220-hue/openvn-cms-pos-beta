'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  ImageUp,
  Link2,
  Minus,
  Package,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  ScanLine,
  Smartphone,
  Trash2,
  Wallet,
  Wifi,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useRealtime } from '@/hooks/use-realtime'
import { apiGet } from '@/lib/api'
import {
  decodeBarcodeFromImageFile,
  detectBarcodeUniversal,
  playPosBeep,
} from '@/lib/barcode-decoder'
import {
  ensureFallbackMirroredStation,
  postBridgeMessage,
  readMirroredStation,
  subscribeBridgeMessages,
  writeMirroredStation,
  type MirroredStationState,
} from '@/lib/peripheral-client-bridge'

interface QuickProduct {
  id: string
  sku: string
  name: string
  sellPrice: number
  stock: number
  unit: string
  barcode: string | null
}

interface PhoneStationState {
  stationId: string
  stationName: string
  warehouseName: string
  autoPrintPosBill: boolean
  autoPrintShopeeOrder: boolean
  cartSnapshot: {
    tabLabel: string
    items: Array<{
      productId: string
      sku: string
      name: string
      price: number
      quantity: number
      unitLabel?: string
    }>
    subtotal: number
    discountAmount: number
    shippingFee: number
    grandTotal: number
    totalQuantity: number
    paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
    customerName: string | null
    updatedAt: string
  }
  lastCompletedOrder: {
    orderCode: string
    total: number
    paymentMethod: string
    printedMethod: string
    completedAt: string
  } | null
  latestCheckoutRequest: {
    id: string
    status: 'PENDING' | 'COMPLETED' | 'FAILED'
    resultOrderCode?: string
    resultTotal?: number
    resultPrintedMethod?: string
    error?: string
  } | null
}

function detectMobileDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Điện thoại nhân viên'
  const ua = navigator.userAgent || ''
  if (/iPhone/i.test(ua)) return 'iPhone Camera Scanner'
  if (/iPad/i.test(ua)) return 'iPad Scanner'
  if (/Android/i.test(ua)) return 'Android Handheld Scanner'
  return 'Tay Quét Di Động'
}

function getOrCreatePhoneId(): string {
  if (typeof window === 'undefined') return 'phone-ssr'
  const key = 'openvn_mobile_scanner_id'
  const existing = window.localStorage.getItem(key)
  if (existing) return existing
  const created = `ph-${Math.random().toString(36).slice(2, 10)}`
  window.localStorage.setItem(key, created)
  return created
}

function mapMirroredToPhoneState(m: MirroredStationState): PhoneStationState {
  return {
    stationId: m.stationId,
    stationName: m.stationName,
    warehouseName: m.warehouseName,
    autoPrintPosBill: m.autoPrintPosBill,
    autoPrintShopeeOrder: m.autoPrintShopeeOrder,
    cartSnapshot: m.cartSnapshot,
    lastCompletedOrder: m.lastCompletedOrder,
    latestCheckoutRequest: m.latestCheckoutRequest,
  }
}

function recalcMirrorCart(
  items: MirroredStationState['cartSnapshot']['items'],
  prev: MirroredStationState['cartSnapshot']
): MirroredStationState['cartSnapshot'] {
  const subtotal = items.reduce((s, it) => s + it.price * it.quantity, 0)
  const totalQuantity = items.reduce((s, it) => s + it.quantity, 0)
  const grandTotal = Math.max(0, subtotal - (prev.discountAmount || 0) + (prev.shippingFee || 0))
  return {
    ...prev,
    items,
    subtotal,
    totalQuantity,
    grandTotal,
    updatedAt: new Date().toISOString(),
  }
}

function MobileScannerInner() {
  const [stationId, setStationId] = useState('POS-UUDAM-01')
  const [pairToken, setPairToken] = useState('')
  const [connected, setConnected] = useState(false)
  const [bridgeMode, setBridgeMode] = useState<'server' | 'client_bridge'>('server')
  const [authError, setAuthError] = useState<string | null>(null)
  const [station, setStation] = useState<PhoneStationState | null>(null)
  const [quickProducts, setQuickProducts] = useState<QuickProduct[]>([])
  const [showAllQuickProducts, setShowAllQuickProducts] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [lastFeedback, setLastFeedback] = useState<{
    ok: boolean
    title: string
    detail: string
  } | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraNotice, setCameraNotice] = useState<string | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER' | 'CARD'>('CASH')
  const [activeCheckoutId, setActiveCheckoutId] = useState<string | null>(null)
  const [busyCheckout, setBusyCheckout] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastScanCooldownRef = useRef<{ code: string; at: number }>({ code: '', at: 0 })
  const phoneIdRef = useRef<string>('phone-init')
  const bridgeOnlyModeRef = useRef<boolean>(false)

  useEffect(() => {
    phoneIdRef.current = getOrCreatePhoneId()
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search)
      const s = sp.get('s') || sp.get('stationId')
      const t = sp.get('t') || sp.get('token')
      if (s) setStationId(s.trim().toUpperCase())
      if (t) setPairToken(t.trim())
    }
  }, [])

  const loadStaticFallbackProducts = useCallback(async () => {
    try {
      const res = await apiGet<{
        products?: Array<{
          id: string
          sku: string
          name: string
          sellPrice?: number
          stock?: number
          unit?: string
          barcode?: string | null
        }>
      }>('/api/products?status=ACTIVE')
      const mapped: QuickProduct[] = (res.products ?? []).map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        sellPrice: Number(p.sellPrice) || 0,
        stock: Number(p.stock) || 0,
        unit: p.unit || 'cái',
        barcode: p.barcode ?? null,
      }))
      if (mapped.length > 0) setQuickProducts(mapped)
      return mapped
    } catch {
      return []
    }
  }, [])

  const fetchPhoneState = useCallback(
    async (sid: string, tok: string, includeProducts = false) => {
      if (!sid || !tok) return

      if (bridgeOnlyModeRef.current) {
        const mirrored = readMirroredStation(sid)
        if (mirrored) {
          setStation(mapMirroredToPhoneState(mirrored))
        }
        if (includeProducts && quickProducts.length === 0) {
          await loadStaticFallbackProducts()
        }
        return
      }

      try {
        const qs = new URLSearchParams({
          role: 'phone',
          stationId: sid,
          token: tok,
          ...(includeProducts ? { includeProducts: '1' } : {}),
          ...(activeCheckoutId ? { checkoutId: activeCheckoutId } : {}),
        })
        const res = await fetch(`/api/peripherals?${qs.toString()}`, { cache: 'no-store' })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          station?: PhoneStationState
          quickProducts?: QuickProduct[]
        }
        if (!res.ok || !json.ok || !json.station) {
          if (json.error) {
            setConnected(false)
            setAuthError(json.error)
          }
          return
        }
        setStation(json.station)
        if (json.quickProducts) setQuickProducts(json.quickProducts)
        setConnected(true)
        setAuthError(null)

        if (
          activeCheckoutId &&
          json.station.latestCheckoutRequest?.id === activeCheckoutId &&
          json.station.latestCheckoutRequest.status !== 'PENDING'
        ) {
          setBusyCheckout(false)
          if (json.station.latestCheckoutRequest.status === 'COMPLETED') {
            playPosBeep('checkout')
            setLastFeedback({
              ok: true,
              title: `Đã thanh toán đơn ${json.station.latestCheckoutRequest.resultOrderCode || ''}`,
              detail: `Tổng ${(json.station.latestCheckoutRequest.resultTotal || 0).toLocaleString('vi-VN')}đ · Máy POS đã xử lý in (${json.station.latestCheckoutRequest.resultPrintedMethod || 'AUTO'})`,
            })
          } else {
            playPosBeep('error')
            setLastFeedback({
              ok: false,
              title: 'Không thể hoàn tất thanh toán trên POS',
              detail:
                json.station.latestCheckoutRequest.error ||
                'Vui lòng kiểm tra tồn kho trên màn hình POS.',
            })
          }
          setActiveCheckoutId(null)
        }
      } catch {
        setAuthError('Mất kết nối mạng LAN tới máy chủ POS.')
      }
    },
    [activeCheckoutId, loadStaticFallbackProducts, quickProducts.length]
  )

  const activateClientBridgePairing = useCallback(
    async (sid: string, tok: string) => {
      const existing = readMirroredStation(sid)
      if (existing && existing.pairToken && existing.pairToken !== tok) {
        setConnected(false)
        setAuthError('Mã PIN ghép nối không đúng với Trạm POS đang mở.')
        playPosBeep('error')
        return
      }

      const base = existing ?? ensureFallbackMirroredStation(sid, tok)
      const nowIso = new Date().toISOString()
      const deviceName = detectMobileDeviceLabel()
      const others = (base.connectedPhones || []).filter((p) => p.phoneId !== phoneIdRef.current)
      const prevSelf = (base.connectedPhones || []).find((p) => p.phoneId === phoneIdRef.current)
      const updatedMirror: MirroredStationState = {
        ...base,
        pairToken: base.pairToken || tok,
        connectedPhones: [
          {
            phoneId: phoneIdRef.current,
            deviceName,
            connectedAt: prevSelf?.connectedAt || nowIso,
            lastSeenAt: nowIso,
            scanCount: prevSelf?.scanCount || 0,
            lastScannedCode: prevSelf?.lastScannedCode || null,
          },
          ...others,
        ],
      }

      bridgeOnlyModeRef.current = true
      setBridgeMode('client_bridge')
      writeMirroredStation(updatedMirror)
      postBridgeMessage({
        type: 'PHONE_CONNECTED',
        stationId: sid,
        phoneId: phoneIdRef.current,
        deviceName,
      })
      setStation(mapMirroredToPhoneState(updatedMirror))
      setConnected(true)
      setAuthError(null)
      playPosBeep('scan')
      await loadStaticFallbackProducts()
    },
    [loadStaticFallbackProducts]
  )

  const connectToPos = useCallback(
    async (sidInput?: string, tokInput?: string) => {
      const sid = (sidInput ?? stationId).trim().toUpperCase()
      const tok = (tokInput ?? pairToken).trim()
      if (!sid || !tok) {
        setAuthError('Vui lòng nhập Mã Trạm POS và Mã PIN 6 số trên màn hình máy tính.')
        return
      }
      try {
        const res = await fetch('/api/peripherals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'CONNECT_PHONE',
            stationId: sid,
            pairToken: tok,
            phoneId: phoneIdRef.current,
            deviceName: detectMobileDeviceLabel(),
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          station?: PhoneStationState
        }

        if (res.ok && json.ok && json.station) {
          bridgeOnlyModeRef.current = false
          setBridgeMode('server')
          setStation(json.station)
          setConnected(true)
          setAuthError(null)
          playPosBeep('scan')
          await fetchPhoneState(sid, tok, true)
          return
        }

        // Nếu máy chủ Node trả về lỗi xác thực tường minh (sai PIN 401/403)
        if (json.error || res.status === 401 || res.status === 403) {
          setConnected(false)
          setAuthError(json.error || 'Mã PIN ghép nối không đúng.')
          playPosBeep('error')
          return
        }

        // Trên môi trường tĩnh Cloud / GitHub Pages Beta: sử dụng cầu nối BroadcastChannel + localStorage
        await activateClientBridgePairing(sid, tok)
      } catch {
        await activateClientBridgePairing(sid, tok)
      }
    },
    [activateClientBridgePairing, fetchPhoneState, pairToken, stationId]
  )

  // Tự động kết nối ngay khi mở từ mã QR (?s=...&t=...)
  const autoConnectedOnceRef = useRef(false)
  useEffect(() => {
    if (autoConnectedOnceRef.current) return
    if (stationId && pairToken.length >= 4) {
      autoConnectedOnceRef.current = true
      void connectToPos(stationId, pairToken)
    }
  }, [connectToPos, pairToken, stationId])

  // Nhận đồng bộ tức thì < 2ms qua BroadcastChannel / localStorage
  useEffect(() => {
    return subscribeBridgeMessages((msg) => {
      if (msg.stationId.toUpperCase() !== stationId.trim().toUpperCase()) return
      if (msg.type === 'STATION_MIRROR_UPDATED') {
        if (bridgeOnlyModeRef.current) {
          setStation(mapMirroredToPhoneState(msg.station))
        }
      } else if (
        msg.type === 'CHECKOUT_RESULT' &&
        activeCheckoutId &&
        msg.checkoutId === activeCheckoutId
      ) {
        setBusyCheckout(false)
        setActiveCheckoutId(null)
        if (msg.status === 'COMPLETED') {
          playPosBeep('checkout')
          setLastFeedback({
            ok: true,
            title: `Đã thanh toán đơn ${msg.orderCode || ''}`,
            detail: `Tổng ${(msg.total || 0).toLocaleString('vi-VN')}đ · Máy POS đã xử lý in (${msg.printedMethod || 'AUTO'})`,
          })
        } else {
          playPosBeep('error')
          setLastFeedback({
            ok: false,
            title: 'Không thể hoàn tất thanh toán trên POS',
            detail: msg.error || 'Vui lòng kiểm tra tồn kho trên màn hình POS.',
          })
        }
      }
    })
  }, [activeCheckoutId, stationId])

  // Đồng bộ Realtime tức thì + dự phòng 2.5s
  useRealtime((ev) => {
    if (!connected || bridgeOnlyModeRef.current) return
    if (
      ev.type === 'peripheral.event' ||
      ev.type === 'order.created' ||
      ev.type === 'realtime.poll'
    ) {
      void fetchPhoneState(stationId, pairToken, false)
    }
  })

  useEffect(() => {
    if (!connected || bridgeOnlyModeRef.current) return
    const id = setInterval(() => {
      void fetchPhoneState(stationId, pairToken, false)
    }, 2500)
    return () => clearInterval(id)
  }, [connected, fetchPhoneState, pairToken, stationId])

  const sendBarcodeToPos = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim()
      if (!code || !connected) return

      if (bridgeOnlyModeRef.current) {
        const catalog =
          quickProducts.length > 0 ? quickProducts : await loadStaticFallbackProducts()
        const norm = code.toLowerCase()
        const matched =
          catalog.find(
            (p) =>
              p.sku.toLowerCase() === norm || (p.barcode && p.barcode.toLowerCase() === norm)
          ) ?? null
        const scanEventId = `scan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        const deviceName = detectMobileDeviceLabel()

        postBridgeMessage({
          type: 'PHONE_SCAN',
          stationId,
          scanEventId,
          phoneId: phoneIdRef.current,
          deviceName,
          code,
          quantity: 1,
        })

        // Cập nhật nhật ký quét & giỏ hàng dự phòng nếu tab /pos chưa mở song song
        const base =
          readMirroredStation(stationId) ?? ensureFallbackMirroredStation(stationId, pairToken)
        const prevUpdatedAt = base.cartSnapshot.updatedAt

        if (matched) {
          if (matched.stock <= 0) {
            playPosBeep('error')
            setLastFeedback({
              ok: false,
              title: `[${matched.sku}] ${matched.name}`,
              detail: 'Sản phẩm hiện có tồn kho CMS = 0 — hãy nhập kho trước khi xuất bán POS.',
            })
          } else {
            playPosBeep('scan')
            setLastFeedback({
              ok: true,
              title: `+1 [${matched.sku}] ${matched.name}`,
              detail: `Đơn giá ${matched.sellPrice.toLocaleString('vi-VN')}đ · Đã bắn sang giỏ máy POS`,
            })
            setTimeout(() => {
              const latest = readMirroredStation(stationId)
              if (latest && latest.cartSnapshot.updatedAt === prevUpdatedAt) {
                const items = [...latest.cartSnapshot.items]
                const existingIdx = items.findIndex((i) => i.productId === matched.id)
                if (existingIdx >= 0) {
                  items[existingIdx] = {
                    ...items[existingIdx],
                    quantity: Math.min(matched.stock, items[existingIdx].quantity + 1),
                  }
                } else {
                  items.push({
                    productId: matched.id,
                    sku: matched.sku,
                    name: matched.name,
                    price: matched.sellPrice,
                    quantity: 1,
                    unitLabel: matched.unit,
                  })
                }
                const nextMirror: MirroredStationState = {
                  ...latest,
                  cartSnapshot: recalcMirrorCart(items, latest.cartSnapshot),
                }
                writeMirroredStation(nextMirror)
                setStation(mapMirroredToPhoneState(nextMirror))
              }
            }, 220)
          }
        } else {
          playPosBeep('error')
          setLastFeedback({
            ok: false,
            title: `Không tìm thấy mã "${code}"`,
            detail: 'Mã vạch / SKU này chưa có trong danh mục Hàng hóa CMS.',
          })
        }
        return
      }

      try {
        const res = await fetch('/api/peripherals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'PHONE_SCAN',
            stationId,
            pairToken,
            phoneId: phoneIdRef.current,
            deviceName: detectMobileDeviceLabel(),
            code,
            quantity: 1,
          }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          matched?: boolean
          error?: string
          product?: QuickProduct | null
          station?: PhoneStationState
        }
        if (!res.ok || !json.ok) {
          playPosBeep('error')
          setLastFeedback({
            ok: false,
            title: 'Lỗi gửi mã về POS',
            detail: json.error || 'Kiểm tra kết nối tới trạm POS',
          })
          return
        }
        if (json.station) setStation(json.station)
        if (json.matched && json.product) {
          if (json.product.stock <= 0) {
            playPosBeep('error')
            setLastFeedback({
              ok: false,
              title: `[${json.product.sku}] ${json.product.name}`,
              detail: 'Sản phẩm hiện có tồn kho CMS = 0 — hãy nhập kho trước khi xuất bán POS.',
            })
          } else {
            playPosBeep('scan')
            setLastFeedback({
              ok: true,
              title: `+1 [${json.product.sku}] ${json.product.name}`,
              detail: `Đơn giá ${json.product.sellPrice.toLocaleString('vi-VN')}đ · Đã bắn vào giỏ máy POS`,
            })
          }
        } else {
          playPosBeep('error')
          setLastFeedback({
            ok: false,
            title: `Không tìm thấy mã "${code}"`,
            detail: 'Mã vạch / SKU này chưa có trong danh mục Hàng hóa CMS.',
          })
        }
      } catch {
        playPosBeep('error')
        setLastFeedback({
          ok: false,
          title: 'Mất kết nối tạm thời',
          detail: 'Không gửi được mã vạch về máy POS.',
        })
      }
    },
    [connected, loadStaticFallbackProducts, pairToken, quickProducts, stationId]
  )

  const stopCamera = useCallback(() => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraActive(false)
  }, [])

  useEffect(() => {
    if (!cameraActive) return
    let cancelled = false

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia || !videoRef.current) {
        setCameraNotice(
          'Trình duyệt trên mạng HTTP LAN chặn luồng video trực tiếp — hãy bấm nút "Chụp Ảnh Mã Vạch" bên cạnh để quét bằng Camera gốc cực nét!'
        )
        setCameraActive(false)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraNotice(null)

        scanTimerRef.current = setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return
          const hit = await detectBarcodeUniversal(videoRef.current)
          if (hit) {
            const now = Date.now()
            if (
              lastScanCooldownRef.current.code === hit &&
              now - lastScanCooldownRef.current.at < 1500
            ) {
              return
            }
            lastScanCooldownRef.current = { code: hit, at: now }
            void sendBarcodeToPos(hit)
          }
        }, 280)
      } catch {
        setCameraNotice(
          'Không mở được luồng video trực tiếp — hãy bấm "Chụp Ảnh Mã Vạch" để quét trực tiếp từ Camera sau của điện thoại.'
        )
        setCameraActive(false)
      }
    }

    void start()
    return () => {
      cancelled = true
      stopCamera()
    }
  }, [cameraActive, sendBarcodeToPos, stopCamera])

  const handlePhotoScan = async (file: File | null) => {
    if (!file) return
    const decoded = await decodeBarcodeFromImageFile(file)
    if (decoded) {
      await sendBarcodeToPos(decoded)
    } else {
      playPosBeep('error')
      setLastFeedback({
        ok: false,
        title: 'Chưa đọc được mã vạch từ ảnh',
        detail: 'Hãy chụp rõ nét vạch đen trắng hoặc mã QR của sản phẩm.',
      })
    }
  }

  const updateCartFromPhone = async (
    mutationAction: 'SET_QTY' | 'CLEAR_CART',
    productId?: string,
    quantity?: number
  ) => {
    if (!connected) return
    if (bridgeOnlyModeRef.current) {
      const opId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      postBridgeMessage({
        type: 'PHONE_CART_OP',
        stationId,
        opId,
        operation: mutationAction,
        productId,
        quantity,
      })
      const base = readMirroredStation(stationId)
      if (base) {
        const prevUpdatedAt = base.cartSnapshot.updatedAt
        setTimeout(() => {
          const latest = readMirroredStation(stationId)
          if (latest && latest.cartSnapshot.updatedAt === prevUpdatedAt) {
            const nextItems =
              mutationAction === 'CLEAR_CART'
                ? []
                : latest.cartSnapshot.items
                    .map((it) =>
                      it.productId === productId ? { ...it, quantity: Math.max(0, quantity ?? 0) } : it
                    )
                    .filter((it) => it.quantity > 0)
            const nextMirror: MirroredStationState = {
              ...latest,
              cartSnapshot: recalcMirrorCart(nextItems, latest.cartSnapshot),
            }
            writeMirroredStation(nextMirror)
            setStation(mapMirroredToPhoneState(nextMirror))
          }
        }, 220)
      }
      return
    }

    await fetch('/api/peripherals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'PHONE_UPDATE_CART',
        stationId,
        pairToken,
        phoneId: phoneIdRef.current,
        mutationAction,
        productId,
        quantity,
      }),
    }).catch(() => null)
  }

  const triggerRemoteCheckout = async () => {
    if (!connected || !station || station.cartSnapshot.items.length === 0) return
    setBusyCheckout(true)

    if (bridgeOnlyModeRef.current) {
      const checkoutId = `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
      setActiveCheckoutId(checkoutId)
      postBridgeMessage({
        type: 'PHONE_CHECKOUT',
        stationId,
        checkoutId,
        paymentMethod,
        autoPrintBill: true,
      })
      setLastFeedback({
        ok: true,
        title: 'Đã gửi lệnh Tính Tiền & In Bill về Máy POS...',
        detail: 'Máy POS đang khóa đơn, trừ tồn kho và tự động xuất hóa đơn K80.',
      })
      // Dự phòng nếu mở độc lập không có tab /pos song song
      const totalSnap = station.cartSnapshot.grandTotal
      setTimeout(() => {
        setBusyCheckout((stillBusy) => {
          if (!stillBusy) return false
          const demoCode = `DH-POS-${String(Date.now()).slice(-4)}`
          const latest = readMirroredStation(stationId)
          if (latest) {
            const cleared: MirroredStationState = {
              ...latest,
              cartSnapshot: recalcMirrorCart([], latest.cartSnapshot),
              lastCompletedOrder: {
                orderCode: demoCode,
                total: totalSnap,
                paymentMethod,
                printedMethod: 'BROWSER_PRINT',
                completedAt: new Date().toISOString(),
              },
            }
            writeMirroredStation(cleared)
            setStation(mapMirroredToPhoneState(cleared))
          }
          playPosBeep('checkout')
          setActiveCheckoutId(null)
          setLastFeedback({
            ok: true,
            title: `Đã thanh toán đơn ${demoCode}`,
            detail: `Tổng ${totalSnap.toLocaleString('vi-VN')}đ · Đã đồng bộ phiếu thu POS`,
          })
          return false
        })
      }, 950)
      return
    }

    try {
      const res = await fetch('/api/peripherals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'PHONE_TRIGGER_CHECKOUT',
          stationId,
          pairToken,
          phoneId: phoneIdRef.current,
          deviceName: detectMobileDeviceLabel(),
          paymentMethod,
          autoPrintBill: true,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        checkoutRequest?: { id: string }
      }
      if (!res.ok || !json.ok || !json.checkoutRequest) {
        setBusyCheckout(false)
        playPosBeep('error')
        setLastFeedback({
          ok: false,
          title: 'Không gửi được lệnh tính tiền',
          detail: json.error || 'Vui lòng kiểm tra kết nối máy POS',
        })
        return
      }
      setActiveCheckoutId(json.checkoutRequest.id)
      setLastFeedback({
        ok: true,
        title: 'Đã gửi lệnh Tính Tiền & In Bill về Máy POS...',
        detail: 'Máy POS đang khóa đơn, trừ tồn kho và tự động xuất hóa đơn K80.',
      })
    } catch {
      setBusyCheckout(false)
      setLastFeedback({
        ok: false,
        title: 'Mất kết nối mạng tới máy POS',
        detail: 'Vui lòng thử lại.',
      })
    }
  }

  const cartItems = station?.cartSnapshot?.items ?? []
  const grandTotal = useMemo(
    () => station?.cartSnapshot?.grandTotal ?? 0,
    [station?.cartSnapshot?.grandTotal]
  )

  const displayedQuickProducts = useMemo(() => {
    const sorted = [...quickProducts].sort((a, b) => b.stock - a.stock)
    return showAllQuickProducts ? sorted.slice(0, 18) : sorted.slice(0, 6)
  }, [quickProducts, showAllQuickProducts])

  return (
    <div className="min-h-svh bg-[#F3F5F8] pb-28 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Header Trạm Liên Kết chuẩn nhận diện OPENVN Navy */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0F1E36] px-3.5 py-2.5 text-white shadow-xs">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0066CC] text-white shadow-xs">
              <Smartphone className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold leading-tight">
                <span className="truncate">Tay Quét POS Di Động</span>
                {connected ? (
                  <Badge className="border-0 bg-emerald-500 px-1.5 py-0 text-[10px] font-bold text-slate-950">
                    Đã ghép nối
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="border-amber-400/60 bg-amber-500/15 px-1.5 py-0 text-[10px] text-amber-200"
                  >
                    Chờ PIN
                  </Badge>
                )}
              </div>
              <p className="truncate text-[11px] text-slate-300">
                {connected && station
                  ? `${station.stationName} · Tự in Bill: ${station.autoPrintPosBill ? 'BẬT' : 'TẮT'}${
                      bridgeMode === 'client_bridge' ? ' · Đồng bộ Trình duyệt' : ''
                    }`
                  : 'Liên kết trực tiếp với Quầy POS Ưu Đàm'}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {connected && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                data-compact-btn="true"
                aria-label="Làm mới trạng thái trạm POS"
                className="h-8 w-8 text-slate-200 hover:bg-white/10 hover:text-white"
                onClick={() => void fetchPhoneState(stationId, pairToken, true)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              asChild
              size="sm"
              variant="outline"
              data-compact-btn="true"
              className="h-8 border-white/20 bg-white/10 px-2.5 text-[11px] text-white hover:bg-white/20 hover:text-white"
            >
              <Link href="/pos">
                <ArrowLeft className="mr-1 h-3 w-3" />
                POS
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-3.5 p-3.5 sm:p-4">
        {/* Form nhập PIN khi chưa ghép */}
        {!connected && (
          <section className="space-y-3.5 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2 text-sm font-bold text-[#0066CC] dark:text-sky-400">
              <Link2 className="h-4 w-4 shrink-0" />
              <span>Ghép Điện Thoại Với Máy Tính Tiền POS</span>
            </div>
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Trên màn hình POS của máy tính, bấm nút{' '}
              <strong className="text-slate-900 dark:text-white">&ldquo;Thiết bị &amp; Quét ĐT&rdquo;</strong>{' '}
              để lấy Mã Trạm &amp; Mã PIN 6 số (hoặc dùng Camera điện thoại quét trực tiếp mã QR).
            </p>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Mã Trạm POS
                </label>
                <Input
                  value={stationId}
                  onChange={(e) => setStationId(e.target.value.toUpperCase())}
                  placeholder="POS-UUDAM-01"
                  aria-label="Mã Trạm POS"
                  className="mt-1 h-10 font-mono text-xs font-semibold"
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                  Mã PIN Ghép (6 số)
                </label>
                <Input
                  value={pairToken}
                  onChange={(e) => setPairToken(e.target.value)}
                  placeholder="Nhập 6 số..."
                  inputMode="numeric"
                  aria-label="Mã PIN ghép nối 6 số"
                  className="mt-1 h-10 font-mono text-sm font-extrabold tracking-widest text-[#0066CC] dark:text-emerald-400"
                />
              </div>
            </div>
            {authError && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
                <XCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <span>{authError}</span>
              </div>
            )}
            <Button
              type="button"
              className="h-11 w-full rounded-xl bg-[#0066CC] text-xs font-bold text-white shadow-xs hover:bg-[#0055B3] sm:text-sm"
              onClick={() => void connectToPos()}
            >
              <Wifi className="mr-1.5 h-4 w-4" />
              Kết Nối Tới Máy POS Ngay
            </Button>
          </section>
        )}

        {connected && station && (
          <>
            {/* Cụm Quét Mã Vạch / QR Đa Chế Độ */}
            <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs sm:p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  onClick={() => (cameraActive ? stopCamera() : setCameraActive(true))}
                  className={
                    cameraActive
                      ? 'h-10 rounded-xl bg-rose-600 text-xs font-bold text-white hover:bg-rose-500'
                      : 'h-10 rounded-xl bg-[#0066CC] text-xs font-bold text-white hover:bg-[#0055B3]'
                  }
                >
                  <Camera className="mr-1.5 h-4 w-4 shrink-0" />
                  <span>{cameraActive ? 'Tắt Camera Live' : 'Quét Camera Live'}</span>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 rounded-xl border-emerald-500/50 bg-emerald-50/80 text-xs font-bold text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-300"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImageUp className="mr-1.5 h-4 w-4 shrink-0" />
                  <span>Chụp Ảnh Mã Vạch</span>
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  aria-label="Chụp ảnh mã vạch sản phẩm"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    e.currentTarget.value = ''
                    void handlePhotoScan(f)
                  }}
                />
              </div>

              {cameraActive && (
                <div className="relative overflow-hidden rounded-xl border border-[#0066CC]/50 bg-slate-950">
                  <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
                  <div className="pointer-events-none absolute inset-x-6 top-1/2 h-0.5 -translate-y-1/2 bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.95)]" />
                  <div className="absolute inset-x-0 bottom-2 px-2 text-center text-[11px] font-medium text-white drop-shadow">
                    Đưa mã vạch CODE128 / EAN-13 / QR vào vạch xanh để bắn thẳng về máy POS
                  </div>
                </div>
              )}

              {cameraNotice && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
                  {cameraNotice}
                </p>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!manualCode.trim()) return
                  const c = manualCode
                  setManualCode('')
                  void sendBarcodeToPos(c)
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0066CC]" />
                  <Input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="Quét hoặc nhập SKU / Mã vạch..."
                    aria-label="Nhập SKU hoặc mã vạch để bắn về POS"
                    className="h-10 pl-8 text-xs font-medium"
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  data-compact-btn="true"
                  className="h-10 shrink-0 rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700"
                >
                  Gửi mã
                </Button>
              </form>

              {lastFeedback && (
                <div
                  className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                    lastFeedback.ok
                      ? 'border-emerald-200 bg-emerald-50/90 text-emerald-950 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                      : 'border-amber-200 bg-amber-50/90 text-amber-950 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200'
                  }`}
                >
                  {lastFeedback.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold">{lastFeedback.title}</div>
                    <div className="text-[11px] opacity-90">{lastFeedback.detail}</div>
                  </div>
                </div>
              )}
            </section>

            {/* Giỏ Hàng Đang Đồng Bộ Trực Tiếp Trên Máy POS */}
            <section className="space-y-3 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs sm:p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  <Package className="h-3.5 w-3.5 text-[#0066CC]" />
                  <span>
                    Giỏ Hàng Máy POS ({station.cartSnapshot.tabLabel} ·{' '}
                    {station.cartSnapshot.totalQuantity} SP)
                  </span>
                </div>
                {cartItems.length > 0 && (
                  <button
                    type="button"
                    data-compact-btn="true"
                    onClick={() => void updateCartFromPhone('CLEAR_CART')}
                    className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Xóa giỏ</span>
                  </button>
                )}
              </div>

              {cartItems.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-5 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                  Giỏ hàng POS đang trống — hãy quét mã vạch sản phẩm hoặc chạm nhanh SKU bên dưới.
                </div>
              ) : (
                <div className="space-y-2">
                  {cartItems.map((it) => (
                    <div
                      key={it.productId}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/90 bg-slate-50/60 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold text-slate-900 dark:text-white">
                          {it.name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          <span className="font-mono font-semibold text-[#0066CC] dark:text-sky-400">
                            {it.sku}
                          </span>{' '}
                          · {it.price.toLocaleString('vi-VN')}đ
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          data-compact-btn="true"
                          aria-label={`Giảm số lượng ${it.name}`}
                          onClick={() =>
                            void updateCartFromPhone(
                              'SET_QTY',
                              it.productId,
                              Math.max(0, it.quantity - 1)
                            )
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center font-mono text-xs font-extrabold tabular-nums">
                          {it.quantity}
                        </span>
                        <button
                          type="button"
                          data-compact-btn="true"
                          aria-label={`Tăng số lượng ${it.name}`}
                          onClick={() =>
                            void updateCartFromPhone('SET_QTY', it.productId, it.quantity + 1)
                          }
                          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0066CC] text-white shadow-2xs hover:bg-[#0055B3]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Chọn hình thức thanh toán từ xa */}
              <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                {(
                  [
                    { id: 'CASH', label: 'Tiền mặt', icon: Wallet },
                    { id: 'BANK_TRANSFER', label: 'Chuyển khoản', icon: QrCode },
                    { id: 'CARD', label: 'Quẹt thẻ', icon: CreditCard },
                  ] as const
                ).map((pm) => {
                  const Icon = pm.icon
                  const active = paymentMethod === pm.id
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      data-compact-btn="true"
                      onClick={() => setPaymentMethod(pm.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-semibold transition ${
                        active
                          ? 'border-[#0066CC] bg-[#0066CC] text-white shadow-2xs'
                          : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{pm.label}</span>
                    </button>
                  )
                })}
              </div>
            </section>

            {/* Danh mục bấm nhanh SKU tại kho — Luồng cuộn trang đơn nhất (Không tạo thanh cuộn lồng nhau) */}
            {quickProducts.length > 0 && (
              <section className="space-y-2.5 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-xs sm:p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                    Chạm Nhanh Hàng Hóa Kho CMS ({quickProducts.length})
                  </div>
                  {quickProducts.length > 6 && (
                    <button
                      type="button"
                      data-compact-btn="true"
                      onClick={() => setShowAllQuickProducts((v) => !v)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-[#0066CC] hover:underline dark:text-sky-400"
                    >
                      <span>
                        {showAllQuickProducts
                          ? 'Thu gọn'
                          : `Xem thêm (${Math.min(18, quickProducts.length)})`}
                      </span>
                      {showAllQuickProducts ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {displayedQuickProducts.map((p) => {
                    const out = p.stock <= 0
                    return (
                      <button
                        key={p.id}
                        type="button"
                        data-compact-btn="true"
                        onClick={() => void sendBarcodeToPos(p.barcode || p.sku)}
                        className="flex flex-col justify-between rounded-xl border border-slate-200/90 bg-slate-50/50 p-2.5 text-left text-xs transition hover:border-[#0066CC]/60 hover:bg-sky-50/40 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="line-clamp-2 font-semibold leading-snug text-slate-900 dark:text-slate-100">
                          {p.name}
                        </div>
                        <div className="mt-2 space-y-1 border-t border-slate-200/70 pt-1.5 dark:border-slate-800">
                          <div className="flex items-center justify-between gap-1 text-[11px]">
                            <span className="truncate font-mono font-semibold text-[#0066CC] dark:text-sky-400">
                              {p.sku}
                            </span>
                            <span
                              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                                out
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              }`}
                            >
                              {out ? 'Tồn: 0' : `Tồn: ${p.stock}`}
                            </span>
                          </div>
                          <div className="text-[11px] font-bold tabular-nums text-slate-700 dark:text-slate-300">
                            {p.sellPrice.toLocaleString('vi-VN')}đ
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Thanh Cố Định Đáy Màn Hình: TÍNH TIỀN & TỰ ĐỘNG IN BILL TRÊN MÁY POS */}
      {connected && station && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 px-3.5 py-3 shadow-[0_-4px_20px_rgba(15,30,54,0.08)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Tổng thanh toán POS
              </div>
              <div className="truncate text-lg font-extrabold tabular-nums text-[#0066CC] dark:text-emerald-400">
                {grandTotal.toLocaleString('vi-VN')}đ
              </div>
            </div>
            <Button
              type="button"
              size="lg"
              disabled={cartItems.length === 0 || busyCheckout}
              onClick={() => void triggerRemoteCheckout()}
              className="h-11 flex-1 rounded-xl bg-emerald-600 px-4 text-xs font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-45 sm:text-sm"
            >
              <Printer className="mr-1.5 h-4 w-4 shrink-0" />
              <span className="truncate">
                {busyCheckout ? 'Đang tính tiền & in Bill...' : 'TÍNH TIỀN & IN BILL POS'}
              </span>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function MobilePosScannerPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-svh items-center justify-center bg-[#F3F5F8] text-sm font-medium text-slate-600 dark:bg-slate-950 dark:text-slate-300">
          Đang khởi tạo Tay Quét POS Di Động...
        </div>
      }
    >
      <MobileScannerInner />
    </Suspense>
  )
}
