import os from 'os'
import crypto from 'crypto'
import { broadcast } from '@/lib/realtime'
import { isSyntheticOrder } from '@/lib/synthetic-filter'

export interface PosCartSnapshotItem {
  productId: string
  sku: string
  name: string
  price: number
  quantity: number
  unitLabel?: string
}

export interface PosCartSnapshot {
  tabLabel: string
  items: PosCartSnapshotItem[]
  subtotal: number
  discountAmount: number
  shippingFee: number
  grandTotal: number
  totalQuantity: number
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
  customerName: string | null
  updatedAt: string
}

export interface ConnectedPhoneScanner {
  phoneId: string
  deviceName: string
  connectedAt: string
  lastSeenAt: string
  scanCount: number
  lastScannedCode: string | null
}

export interface RemoteScanEvent {
  seq: number
  id: string
  phoneId: string
  deviceName: string
  code: string
  matchedProductId: string | null
  matchedSku: string | null
  matchedName: string | null
  quantity: number
  createdAt: string
  consumedByPos: boolean
}

export interface RemoteCartMutationEvent {
  seq: number
  id: string
  action: 'SET_QTY' | 'CLEAR_CART'
  productId?: string
  quantity?: number
  createdAt: string
  consumedByPos: boolean
}

export interface RemoteCheckoutRequest {
  seq: number
  id: string
  phoneId: string
  deviceName: string
  paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'COD'
  cashReceived?: number
  autoPrintBill: boolean
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  resultOrderCode?: string
  resultTotal?: number
  resultPrintedMethod?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface ShopeeAutoPrintJob {
  id: string
  orderId: string
  orderCode: string
  shopeeOrderSn: string
  customerName: string
  total: number
  trackingCode: string
  carrier: string
  itemCount: number
  status: 'PENDING' | 'PRINTED' | 'SKIPPED'
  printedByStationId?: string
  printedMethod?: string
  createdAt: string
  printedAt?: string
}

export interface LinkedPosStation {
  stationId: string
  stationName: string
  pairToken: string
  warehouseName: string
  autoPrintPosBill: boolean
  autoPrintShopeeOrder: boolean
  printerTransport: string
  paperSize: string
  shopeeFormat: string
  cartSnapshot: PosCartSnapshot
  connectedPhones: Map<string, ConnectedPhoneScanner>
  scanEvents: RemoteScanEvent[]
  cartMutations: RemoteCartMutationEvent[]
  checkoutRequests: RemoteCheckoutRequest[]
  lastCompletedOrder: {
    orderCode: string
    total: number
    paymentMethod: string
    printedMethod: string
    completedAt: string
  } | null
  nextSeq: number
  createdAt: string
  updatedAt: string
}

interface PeripheralHubStore {
  stations: Map<string, LinkedPosStation>
  shopeePrintQueue: ShopeeAutoPrintJob[]
  enqueuedShopeeOrderIds: Set<string>
}

const gHub = globalThis as unknown as {
  __openvnPeripheralHub?: PeripheralHubStore
}

function getStore(): PeripheralHubStore {
  if (!gHub.__openvnPeripheralHub) {
    gHub.__openvnPeripheralHub = {
      stations: new Map<string, LinkedPosStation>(),
      shopeePrintQueue: [],
      enqueuedShopeeOrderIds: new Set<string>(),
    }
  }
  return gHub.__openvnPeripheralHub
}

function generatePairToken(): string {
  return String(crypto.randomInt(100000, 999999))
}

export function verifyStationPairToken(station: LinkedPosStation, candidateToken: string): boolean {
  const a = Buffer.from(String(station.pairToken || ''))
  const b = Buffer.from(String(candidateToken || '').trim())
  if (a.length === 0 || a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function detectServerLanIps(): string[] {
  const nets = os.networkInterfaces()
  const preferred: string[] = []
  const secondary: string[] = []

  for (const [ifName, addrs] of Object.entries(nets)) {
    if (!addrs) continue
    const lower = ifName.toLowerCase()
    const isVirtual =
      lower.includes('vethernet') ||
      lower.includes('wsl') ||
      lower.includes('docker') ||
      lower.includes('vmware') ||
      lower.includes('vbox') ||
      lower.includes('tailscale')
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue
      if (isVirtual) {
        secondary.push(addr.address)
      } else {
        preferred.push(addr.address)
      }
    }
  }
  return [...preferred, ...secondary]
}

/** Chỉ cho phép kết nối RAW TCP :9100 tới IP nội bộ RFC-1918 hoặc Loopback (chống tuyệt đối SSRF) */
export function isAllowedLanPrinterHost(host: string): boolean {
  const clean = String(host || '').trim()
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(clean)
  if (!m) return false
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false
  const [a, b] = octets
  if (a === 127) return true
  if (a === 10) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  return false
}

export function ensurePosStation(input?: {
  stationId?: string
  stationName?: string
  warehouseName?: string
  rotateToken?: boolean
}): LinkedPosStation {
  const store = getStore()
  const stationId = (input?.stationId?.trim() || 'POS-UUDAM-01').toUpperCase().slice(0, 24)
  const now = new Date().toISOString()
  let st = store.stations.get(stationId)
  if (!st) {
    st = {
      stationId,
      stationName: input?.stationName?.trim() || 'Quầy POS Kho Ưu Đàm #01',
      pairToken: generatePairToken(),
      warehouseName: input?.warehouseName?.trim() || 'Kho Trung Tâm Ưu Đàm',
      autoPrintPosBill: true,
      autoPrintShopeeOrder: false,
      printerTransport: 'auto',
      paperSize: 'K80',
      shopeeFormat: 'A6_LABEL',
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
        updatedAt: now,
      },
      connectedPhones: new Map<string, ConnectedPhoneScanner>(),
      scanEvents: [],
      cartMutations: [],
      checkoutRequests: [],
      lastCompletedOrder: null,
      nextSeq: 1,
      createdAt: now,
      updatedAt: now,
    }
    store.stations.set(stationId, st)
  } else {
    if (input?.stationName?.trim()) st.stationName = input.stationName.trim()
    if (input?.warehouseName?.trim()) st.warehouseName = input.warehouseName.trim()
    if (input?.rotateToken) st.pairToken = generatePairToken()
    st.updatedAt = now
  }
  return st
}

export function getPosStation(stationId: string): LinkedPosStation | null {
  const store = getStore()
  return store.stations.get(String(stationId || '').trim().toUpperCase()) ?? null
}

export function serializeStationForPos(st: LinkedPosStation) {
  const store = getStore()
  return {
    stationId: st.stationId,
    stationName: st.stationName,
    pairToken: st.pairToken,
    warehouseName: st.warehouseName,
    autoPrintPosBill: st.autoPrintPosBill,
    autoPrintShopeeOrder: st.autoPrintShopeeOrder,
    printerTransport: st.printerTransport,
    paperSize: st.paperSize,
    shopeeFormat: st.shopeeFormat,
    cartSnapshot: st.cartSnapshot,
    connectedPhones: Array.from(st.connectedPhones.values()),
    pendingScanEvents: st.scanEvents.filter((e) => !e.consumedByPos),
    recentScanEvents: st.scanEvents.slice(-15).reverse(),
    pendingCartMutations: st.cartMutations.filter((m) => !m.consumedByPos),
    pendingCheckoutRequests: st.checkoutRequests.filter((c) => c.status === 'PENDING'),
    lastCompletedOrder: st.lastCompletedOrder,
    shopeePrintQueue: store.shopeePrintQueue.slice(-25).reverse(),
    pendingShopeePrintJobs: store.shopeePrintQueue.filter((j) => j.status === 'PENDING'),
    lanIps: detectServerLanIps(),
    updatedAt: st.updatedAt,
  }
}

export function serializeStationForPhone(st: LinkedPosStation, currentCheckoutId?: string) {
  const checkoutReq = currentCheckoutId
    ? st.checkoutRequests.find((c) => c.id === currentCheckoutId) ?? null
    : st.checkoutRequests[st.checkoutRequests.length - 1] ?? null
  return {
    stationId: st.stationId,
    stationName: st.stationName,
    warehouseName: st.warehouseName,
    autoPrintPosBill: st.autoPrintPosBill,
    autoPrintShopeeOrder: st.autoPrintShopeeOrder,
    cartSnapshot: st.cartSnapshot,
    lastCompletedOrder: st.lastCompletedOrder,
    latestCheckoutRequest: checkoutReq,
    recentScanEvents: st.scanEvents.slice(-10).reverse(),
    updatedAt: st.updatedAt,
  }
}

export function enqueueShopeeOrderForLinkedPos(input: {
  orderId: string
  orderCode: string
  shopeeOrderSn?: string
  customerName?: string | null
  note?: string | null
  total?: number
  trackingCode?: string | null
  carrier?: string | null
  itemCount?: number
  allowSynthetic?: boolean
}): ShopeeAutoPrintJob | null {
  if (!input.orderId || !input.orderCode) return null
  if (
    !input.allowSynthetic &&
    isSyntheticOrder({
      code: input.orderCode,
      note: input.note ?? null,
      customer: input.customerName ? { name: input.customerName } : null,
    })
  ) {
    return null
  }

  const store = getStore()
  if (store.enqueuedShopeeOrderIds.has(input.orderId)) {
    const existing = store.shopeePrintQueue.find((j) => j.orderId === input.orderId) ?? null
    if (existing) {
      if (input.trackingCode?.trim()) existing.trackingCode = input.trackingCode.trim()
      if (input.carrier?.trim()) existing.carrier = input.carrier.trim()
      if (input.shopeeOrderSn?.trim()) existing.shopeeOrderSn = input.shopeeOrderSn.trim()
    }
    return existing
  }

  const snMatch =
    input.shopeeOrderSn?.trim() ||
    (/#([A-Z0-9_-]{6,})/i.exec(String(input.note || ''))?.[1] ?? input.orderCode)

  const job: ShopeeAutoPrintJob = {
    id: `shp-print-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    orderId: input.orderId,
    orderCode: input.orderCode,
    shopeeOrderSn: snMatch,
    customerName: input.customerName || 'Khách mua Shopee',
    total: Number(input.total) || 0,
    trackingCode: input.trackingCode?.trim() || input.orderCode,
    carrier: input.carrier?.trim() || 'SPX Express',
    itemCount: Number(input.itemCount) || 1,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
  }

  store.enqueuedShopeeOrderIds.add(input.orderId)
  store.shopeePrintQueue.push(job)
  if (store.shopeePrintQueue.length > 80) {
    store.shopeePrintQueue.splice(0, store.shopeePrintQueue.length - 80)
  }

  broadcast('peripheral.event', {
    subType: 'SHOPEE_ORDER_PRINT_QUEUED',
    job,
  })

  return job
}

export function ackShopeePrintJob(
  jobIdOrOrderId: string,
  stationId: string,
  printedMethod: string,
  status: 'PRINTED' | 'SKIPPED' = 'PRINTED'
): ShopeeAutoPrintJob | null {
  const store = getStore()
  const found = store.shopeePrintQueue.find(
    (j) => j.id === jobIdOrOrderId || j.orderId === jobIdOrOrderId
  )
  if (!found) return null
  found.status = status
  found.printedByStationId = stationId
  found.printedMethod = printedMethod
  found.printedAt = new Date().toISOString()

  broadcast('peripheral.event', {
    subType: 'SHOPEE_ORDER_PRINTED',
    job: found,
  })
  return found
}

export function removeShopeePrintJobForTest(orderIdOrJobId: string): boolean {
  const store = getStore()
  const idx = store.shopeePrintQueue.findIndex(
    (j) => j.id === orderIdOrJobId || j.orderId === orderIdOrJobId
  )
  if (idx === -1) return false
  const [removed] = store.shopeePrintQueue.splice(idx, 1)
  if (removed) store.enqueuedShopeeOrderIds.delete(removed.orderId)
  return true
}
