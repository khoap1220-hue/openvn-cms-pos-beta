// Cầu nối đồng bộ tức thì (< 2ms) giữa Trạm POS (/pos) và Tay Quét ĐT (/pos/scanner):
// - Trên máy chủ thật (localhost / Wi-Fi LAN): phối hợp song song cùng /api/peripherals + Socket.IO.
// - Trên môi trường tĩnh Cloud / GitHub Pages Beta: đóng vai trò dự phòng tự chủ qua BroadcastChannel + localStorage
//   giúp quét mã QR / mở /pos/scanner vẫn ghép nối đúng PIN, bắn mã vạch và bấm Tính tiền + In Bill mượt 100%.

export interface MirroredStationState {
  stationId: string
  stationName: string
  pairToken: string
  warehouseName: string
  autoPrintPosBill: boolean
  autoPrintShopeeOrder: boolean
  printerTransport: string
  paperSize: string
  shopeeFormat: string
  lanIps: string[]
  connectedPhones: Array<{
    phoneId: string
    deviceName: string
    connectedAt: string
    lastSeenAt: string
    scanCount: number
    lastScannedCode: string | null
  }>
  recentScanEvents: Array<{
    id: string
    deviceName: string
    code: string
    matchedSku: string | null
    matchedName: string | null
    quantity: number
    createdAt: string
  }>
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
    paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
    autoPrintBill?: boolean
    resultOrderCode?: string
    resultTotal?: number
    resultPrintedMethod?: string
    error?: string
  } | null
}

export type PeripheralBridgeMessage =
  | { type: 'STATION_MIRROR_UPDATED'; stationId: string; station: MirroredStationState }
  | {
      type: 'PHONE_CONNECTED'
      stationId: string
      phoneId: string
      deviceName: string
    }
  | {
      type: 'PHONE_SCAN'
      stationId: string
      scanEventId: string
      phoneId: string
      deviceName: string
      code: string
      quantity: number
    }
  | {
      type: 'PHONE_CART_OP'
      stationId: string
      opId: string
      operation: 'SET_QTY' | 'REMOVE_ITEM' | 'CLEAR_CART'
      productId?: string
      quantity?: number
    }
  | {
      type: 'PHONE_CHECKOUT'
      stationId: string
      checkoutId: string
      paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
      autoPrintBill: boolean
    }
  | {
      type: 'CHECKOUT_RESULT'
      stationId: string
      checkoutId: string
      status: 'COMPLETED' | 'FAILED'
      orderCode?: string
      total?: number
      printedMethod?: string
      error?: string
    }

const CHANNEL_NAME = 'openvn_pos_peripheral_v1'
const STORAGE_PREFIX = 'openvn_pos_station_mirror_'

function storageKey(stationId: string): string {
  return `${STORAGE_PREFIX}${stationId.trim().toUpperCase()}`
}

export function readMirroredStation(stationId: string): MirroredStationState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(stationId))
    if (!raw) return null
    return JSON.parse(raw) as MirroredStationState
  } catch {
    return null
  }
}

export function writeMirroredStation(station: MirroredStationState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(station.stationId), JSON.stringify(station))
    postBridgeMessage({
      type: 'STATION_MIRROR_UPDATED',
      stationId: station.stationId,
      station,
    })
  } catch {
    // ignore storage quota errors
  }
}

export function ensureFallbackMirroredStation(
  stationId: string,
  pairToken: string
): MirroredStationState {
  const normalizedId = stationId.trim().toUpperCase() || 'POS-UUDAM-01'
  const existing = readMirroredStation(normalizedId)
  if (existing) return existing
  const created: MirroredStationState = {
    stationId: normalizedId,
    stationName: 'Quầy POS Kho Ưu Đàm #01',
    pairToken: pairToken.trim() || '160588',
    warehouseName: 'Kho Trung Tâm',
    autoPrintPosBill: true,
    autoPrintShopeeOrder: false,
    printerTransport: 'auto',
    paperSize: 'K80',
    shopeeFormat: 'A6_LABEL',
    lanIps: ['127.0.0.1'],
    connectedPhones: [],
    recentScanEvents: [],
    cartSnapshot: {
      tabLabel: 'Đơn 1',
      items: [],
      subtotal: 0,
      discountAmount: 0,
      shippingFee: 0,
      grandTotal: 0,
      totalQuantity: 0,
      paymentMethod: 'CASH',
      customerName: null,
      updatedAt: new Date().toISOString(),
    },
    lastCompletedOrder: null,
    latestCheckoutRequest: null,
  }
  writeMirroredStation(created)
  return created
}

export function postBridgeMessage(msg: PeripheralBridgeMessage): void {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return
  try {
    const bc = new BroadcastChannel(CHANNEL_NAME)
    bc.postMessage(msg)
    bc.close()
  } catch {
    // ignore unsupported environments
  }
}

export function subscribeBridgeMessages(
  handler: (msg: PeripheralBridgeMessage) => void
): () => void {
  if (typeof window === 'undefined') return () => {}

  let bc: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      bc = new BroadcastChannel(CHANNEL_NAME)
      bc.onmessage = (ev: MessageEvent<PeripheralBridgeMessage>) => {
        if (ev?.data?.type) handler(ev.data)
      }
    } catch {
      bc = null
    }
  }

  const onStorage = (ev: StorageEvent) => {
    if (!ev.key || !ev.key.startsWith(STORAGE_PREFIX) || !ev.newValue) return
    try {
      const parsed = JSON.parse(ev.newValue) as MirroredStationState
      if (parsed?.stationId) {
        handler({
          type: 'STATION_MIRROR_UPDATED',
          stationId: parsed.stationId,
          station: parsed,
        })
      }
    } catch {
      // ignore malformed storage updates
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    window.removeEventListener('storage', onStorage)
    if (bc) {
      try {
        bc.close()
      } catch {
        // ignore
      }
    }
  }
}
