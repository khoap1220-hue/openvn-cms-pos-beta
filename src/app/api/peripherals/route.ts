import net from 'net'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { broadcast } from '@/lib/realtime'
import { isSyntheticOrder } from '@/lib/synthetic-filter'
import { resolveRequestStaffContext } from '@/lib/behavior-server'
import {
  ackShopeePrintJob,
  type ConnectedPhoneScanner,
  enqueueShopeeOrderForLinkedPos,
  ensurePosStation,
  getPosStation,
  isAllowedLanPrinterHost,
  type PosCartSnapshot,
  type RemoteCartMutationEvent,
  type RemoteCheckoutRequest,
  type RemoteScanEvent,
  removeShopeePrintJobForTest,
  serializeStationForPhone,
  serializeStationForPos,
  verifyStationPairToken,
} from '@/lib/peripheral-hub'

export const dynamic = 'force-dynamic'

async function isAuthorizedPosCaller(req: NextRequest): Promise<boolean> {
  const ctx = await resolveRequestStaffContext(req)
  if (ctx.authenticated && !ctx.revokedOrLocked) return true
  if (!ctx.authRequired) return true
  return false
}

function sendRawBytesToTcpPrinter(host: string, port: number, payload: Buffer, timeoutMs = 3500): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      if (err) reject(err)
      else resolve()
    }

    socket.setTimeout(timeoutMs)
    socket.once('timeout', () => finish(new Error(`Quá thời gian kết nối máy in LAN ${host}:${port} (${timeoutMs}ms)`)))
    socket.once('error', (err) => finish(new Error(`Không thể kết nối máy in LAN ${host}:${port}: ${err.message}`)))
    socket.connect(port, host, () => {
      socket.write(payload, (writeErr) => {
        if (writeErr) {
          finish(new Error(`Lỗi gửi dữ liệu ESC/POS tới ${host}:${port}: ${writeErr.message}`))
          return
        }
        socket.end(() => finish())
      })
    })
  })
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const role = (sp.get('role') || 'pos').toLowerCase()
  const stationId = (sp.get('stationId') || 'POS-UUDAM-01').trim().toUpperCase()

  if (role === 'phone') {
    const st = getPosStation(stationId)
    if (!st) {
      return NextResponse.json(
        { ok: false, error: `Trạm POS ${stationId} chưa mở phiên kết nối. Hãy mở màn hình POS trên máy tính trước.` },
        { status: 404 }
      )
    }
    const token = sp.get('token') || req.headers.get('x-pos-pair-token') || ''
    if (!verifyStationPairToken(st, token)) {
      return NextResponse.json(
        { ok: false, error: 'Mã PIN ghép nối điện thoại không hợp lệ hoặc đã được làm mới trên máy POS.' },
        { status: 401 }
      )
    }

    const checkoutId = sp.get('checkoutId') || undefined
    const includeProducts = sp.get('includeProducts') === '1'
    const quickProducts = includeProducts
      ? await db.product.findMany({
          where: { status: { not: 'INACTIVE' } },
          orderBy: [{ stock: 'desc' }, { updatedAt: 'desc' }],
          take: 24,
          select: {
            id: true,
            sku: true,
            name: true,
            sellPrice: true,
            stock: true,
            unit: true,
            barcode: true,
          },
        })
      : undefined

    return NextResponse.json({
      ok: true,
      station: serializeStationForPhone(st, checkoutId),
      ...(quickProducts ? { quickProducts } : {}),
    })
  }

  if (!(await isAuthorizedPosCaller(req))) {
    return NextResponse.json({ ok: false, error: 'Chưa xác thực phiên vận hành POS' }, { status: 401 })
  }

  const st = ensurePosStation({ stationId })
  const rawShopeeOrders = await db.order.findMany({
    where: {
      channel: { key: 'SHOPEE' },
      status: { not: 'CANCELLED' },
    },
    orderBy: { createdAt: 'desc' },
    take: 16,
    include: {
      customer: { select: { name: true, phone: true } },
      items: { select: { quantity: true } },
      shipments: { select: { trackingCode: true, carrier: true }, take: 1 },
    },
  })

  const recentShopeeOrders = rawShopeeOrders
    .filter((o) => !isSyntheticOrder({ code: o.code, note: o.note, customer: o.customer }))
    .slice(0, 8)
    .map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      total: o.total,
      customerName: o.customer?.name || 'Khách Shopee',
      trackingCode: o.shipments[0]?.trackingCode || o.code,
      carrier: o.shipments[0]?.carrier || 'SPX Express',
      itemCount: o.items.reduce((s, it) => s + it.quantity, 0),
      createdAt: o.createdAt.toISOString(),
    }))

  return NextResponse.json({
    ok: true,
    station: serializeStationForPos(st),
    recentShopeeOrders,
  })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'Body JSON không hợp lệ' }, { status: 400 })
  }

  const action = String(body.action || '').trim().toUpperCase()
  const stationId = String(body.stationId || 'POS-UUDAM-01').trim().toUpperCase()

  // =========================================================================
  // NHÓM 1: ĐIỆN THOẠI CẦM TAY QUÉT MÃ / ĐIỀU KHIỂN TÍNH TIỀN MÁY POS LIÊN KẾT
  // =========================================================================
  if (
    action === 'CONNECT_PHONE' ||
    action === 'PHONE_SCAN' ||
    action === 'PHONE_UPDATE_CART' ||
    action === 'PHONE_TRIGGER_CHECKOUT'
  ) {
    const st = getPosStation(stationId)
    if (!st) {
      return NextResponse.json(
        { ok: false, error: `Trạm POS ${stationId} chưa trực tuyến. Vui lòng mở màn hình POS trên máy tính.` },
        { status: 404 }
      )
    }

    const pairToken = String(body.pairToken || req.headers.get('x-pos-pair-token') || '')
    if (!verifyStationPairToken(st, pairToken)) {
      return NextResponse.json(
        { ok: false, error: 'Mã PIN ghép nối không đúng hoặc đã hết hạn.' },
        { status: 401 }
      )
    }

    const now = new Date().toISOString()
    const phoneId = String(body.phoneId || 'phone-default').trim().slice(0, 48)
    const deviceName = String(body.deviceName || 'Điện thoại nhân viên').trim().slice(0, 64)

    const existingPhone = st.connectedPhones.get(phoneId)
    const phoneRecord: ConnectedPhoneScanner = existingPhone
      ? { ...existingPhone, deviceName: deviceName || existingPhone.deviceName, lastSeenAt: now }
      : {
          phoneId,
          deviceName,
          connectedAt: now,
          lastSeenAt: now,
          scanCount: 0,
          lastScannedCode: null,
        }
    st.connectedPhones.set(phoneId, phoneRecord)
    st.updatedAt = now

    if (action === 'CONNECT_PHONE') {
      broadcast('peripheral.event', {
        subType: 'PHONE_CONNECTED',
        stationId: st.stationId,
        phone: phoneRecord,
      })
      return NextResponse.json({
        ok: true,
        phone: phoneRecord,
        station: serializeStationForPhone(st),
      })
    }

    if (action === 'PHONE_SCAN') {
      const rawCode = String(body.code || '').trim()
      if (!rawCode) {
        return NextResponse.json({ ok: false, error: 'Thiếu mã vạch / SKU quét được' }, { status: 400 })
      }
      const quantity = Math.max(1, Math.min(999, Math.floor(Number(body.quantity) || 1)))

      const activeProducts = await db.product.findMany({
        where: { status: { not: 'INACTIVE' } },
        select: {
          id: true,
          sku: true,
          name: true,
          sellPrice: true,
          stock: true,
          unit: true,
          barcode: true,
        },
      })

      const upper = rawCode.toUpperCase()
      const matched =
        activeProducts.find(
          (p) =>
            (p.barcode && p.barcode.trim().toUpperCase() === upper) ||
            p.sku.trim().toUpperCase() === upper ||
            p.id === rawCode
        ) ?? null

      const scanEvent: RemoteScanEvent = {
        seq: st.nextSeq++,
        id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        phoneId,
        deviceName: phoneRecord.deviceName,
        code: rawCode,
        matchedProductId: matched?.id ?? null,
        matchedSku: matched?.sku ?? null,
        matchedName: matched?.name ?? null,
        quantity,
        createdAt: now,
        consumedByPos: false,
      }

      phoneRecord.scanCount += 1
      phoneRecord.lastScannedCode = rawCode
      st.connectedPhones.set(phoneId, phoneRecord)
      st.scanEvents.push(scanEvent)
      if (st.scanEvents.length > 60) {
        st.scanEvents.splice(0, st.scanEvents.length - 60)
      }

      broadcast('peripheral.event', {
        subType: 'PHONE_SCAN',
        stationId: st.stationId,
        scanEvent,
        product: matched,
      })

      return NextResponse.json({
        ok: true,
        matched: Boolean(matched),
        scanEvent,
        product: matched,
        station: serializeStationForPhone(st),
      })
    }

    if (action === 'PHONE_UPDATE_CART') {
      const mutationAction = body.mutationAction === 'CLEAR_CART' ? 'CLEAR_CART' : 'SET_QTY'
      const mutation: RemoteCartMutationEvent = {
        seq: st.nextSeq++,
        id: `mut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        action: mutationAction,
        productId: body.productId ? String(body.productId) : undefined,
        quantity: body.quantity != null ? Math.max(0, Math.floor(Number(body.quantity) || 0)) : undefined,
        createdAt: now,
        consumedByPos: false,
      }
      st.cartMutations.push(mutation)
      if (st.cartMutations.length > 50) {
        st.cartMutations.splice(0, st.cartMutations.length - 50)
      }

      broadcast('peripheral.event', {
        subType: 'PHONE_UPDATE_CART',
        stationId: st.stationId,
        mutation,
      })

      return NextResponse.json({
        ok: true,
        mutation,
        station: serializeStationForPhone(st),
      })
    }

    if (action === 'PHONE_TRIGGER_CHECKOUT') {
      const validMethods = ['CASH', 'BANK_TRANSFER', 'CARD', 'COD'] as const
      const rawMethod = String(body.paymentMethod || 'CASH').toUpperCase()
      const paymentMethod = (validMethods.includes(rawMethod as (typeof validMethods)[number])
        ? rawMethod
        : 'CASH') as (typeof validMethods)[number]

      const checkoutReq: RemoteCheckoutRequest = {
        seq: st.nextSeq++,
        id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        phoneId,
        deviceName: phoneRecord.deviceName,
        paymentMethod,
        cashReceived: body.cashReceived != null ? Number(body.cashReceived) : undefined,
        autoPrintBill: body.autoPrintBill !== false,
        status: 'PENDING',
        createdAt: now,
      }

      st.checkoutRequests.push(checkoutReq)
      if (st.checkoutRequests.length > 30) {
        st.checkoutRequests.splice(0, st.checkoutRequests.length - 30)
      }

      broadcast('peripheral.event', {
        subType: 'PHONE_CHECKOUT',
        stationId: st.stationId,
        checkoutRequest: checkoutReq,
      })

      return NextResponse.json({
        ok: true,
        checkoutRequest: checkoutReq,
        station: serializeStationForPhone(st, checkoutReq.id),
      })
    }
  }

  // =========================================================================
  // NHÓM 2: CÁC LỆNH QUẢN TRỊ TRẠM POS / IN NHIỆT LAN :9100 / IN ĐƠN SHOPEE
  // =========================================================================
  if (!(await isAuthorizedPosCaller(req))) {
    return NextResponse.json({ ok: false, error: 'Không có quyền điều khiển trạm ngoại vi POS' }, { status: 401 })
  }

  if (action === 'REGISTER_STATION') {
    const st = ensurePosStation({
      stationId,
      stationName: typeof body.stationName === 'string' ? body.stationName : undefined,
      warehouseName: typeof body.warehouseName === 'string' ? body.warehouseName : undefined,
      rotateToken: Boolean(body.rotateToken),
    })

    if (typeof body.autoPrintPosBill === 'boolean') st.autoPrintPosBill = body.autoPrintPosBill
    if (typeof body.autoPrintShopeeOrder === 'boolean') st.autoPrintShopeeOrder = body.autoPrintShopeeOrder
    if (typeof body.printerTransport === 'string') st.printerTransport = body.printerTransport
    if (typeof body.paperSize === 'string') st.paperSize = body.paperSize
    if (typeof body.shopeeFormat === 'string') st.shopeeFormat = body.shopeeFormat
    st.updatedAt = new Date().toISOString()

    broadcast('peripheral.event', {
      subType: 'STATION_UPDATED',
      stationId: st.stationId,
      autoPrintPosBill: st.autoPrintPosBill,
      autoPrintShopeeOrder: st.autoPrintShopeeOrder,
    })

    return NextResponse.json({ ok: true, station: serializeStationForPos(st) })
  }

  if (action === 'SYNC_STATION_STATE') {
    const st = ensurePosStation({ stationId })
    if (body.cartSnapshot && typeof body.cartSnapshot === 'object') {
      st.cartSnapshot = body.cartSnapshot as PosCartSnapshot
    }
    if (typeof body.autoPrintPosBill === 'boolean') st.autoPrintPosBill = body.autoPrintPosBill
    if (typeof body.autoPrintShopeeOrder === 'boolean') st.autoPrintShopeeOrder = body.autoPrintShopeeOrder
    if (typeof body.printerTransport === 'string') st.printerTransport = body.printerTransport
    if (typeof body.paperSize === 'string') st.paperSize = body.paperSize
    if (typeof body.shopeeFormat === 'string') st.shopeeFormat = body.shopeeFormat

    const ackScanSeq = Number(body.ackScanSeqUpTo || 0)
    if (ackScanSeq > 0) {
      for (const ev of st.scanEvents) {
        if (ev.seq <= ackScanSeq) ev.consumedByPos = true
      }
    }
    const ackMutSeq = Number(body.ackMutationSeqUpTo || 0)
    if (ackMutSeq > 0) {
      for (const m of st.cartMutations) {
        if (m.seq <= ackMutSeq) m.consumedByPos = true
      }
    }

    st.updatedAt = new Date().toISOString()

    broadcast('peripheral.event', {
      subType: 'STATION_CART_SYNCED',
      stationId: st.stationId,
      cartSnapshot: st.cartSnapshot,
      autoPrintPosBill: st.autoPrintPosBill,
      autoPrintShopeeOrder: st.autoPrintShopeeOrder,
    })

    return NextResponse.json({ ok: true, station: serializeStationForPos(st) })
  }

  if (action === 'COMPLETE_REMOTE_CHECKOUT') {
    const st = ensurePosStation({ stationId })
    const checkoutId = String(body.checkoutId || '').trim()
    const found = st.checkoutRequests.find((c) => c.id === checkoutId)
    const now = new Date().toISOString()

    if (found) {
      found.status = body.status === 'FAILED' ? 'FAILED' : 'COMPLETED'
      found.resultOrderCode = typeof body.orderCode === 'string' ? body.orderCode : undefined
      found.resultTotal = typeof body.total === 'number' ? body.total : undefined
      found.resultPrintedMethod = typeof body.printedMethod === 'string' ? body.printedMethod : undefined
      found.error = typeof body.error === 'string' ? body.error : undefined
      found.completedAt = now
    }

    if (body.status !== 'FAILED' && typeof body.orderCode === 'string') {
      st.lastCompletedOrder = {
        orderCode: body.orderCode,
        total: Number(body.total) || 0,
        paymentMethod: String(body.paymentMethod || 'CASH'),
        printedMethod: String(body.printedMethod || 'AUTO'),
        completedAt: now,
      }
    }
    st.updatedAt = now

    broadcast('peripheral.event', {
      subType: 'REMOTE_CHECKOUT_COMPLETED',
      stationId: st.stationId,
      checkoutRequest: found ?? null,
      lastCompletedOrder: st.lastCompletedOrder,
    })

    return NextResponse.json({
      ok: true,
      checkoutRequest: found ?? null,
      lastCompletedOrder: st.lastCompletedOrder,
    })
  }

  if (action === 'ENQUEUE_SHOPEE_PRINT') {
    const orderId = String(body.orderId || '').trim()
    if (!orderId) {
      return NextResponse.json({ ok: false, error: 'Thiếu orderId đơn hàng Shopee' }, { status: 400 })
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: {
        customer: { select: { name: true } },
        items: { select: { quantity: true } },
        shipments: { select: { trackingCode: true, carrier: true }, take: 1 },
      },
    })

    if (!order) {
      return NextResponse.json({ ok: false, error: 'Không tìm thấy đơn hàng để đưa vào hàng đợi in' }, { status: 404 })
    }

    const job = enqueueShopeeOrderForLinkedPos({
      orderId: order.id,
      orderCode: order.code,
      shopeeOrderSn: typeof body.shopeeOrderSn === 'string' ? body.shopeeOrderSn : undefined,
      customerName: order.customer?.name ?? null,
      note: order.note,
      total: order.total,
      trackingCode: order.shipments[0]?.trackingCode ?? null,
      carrier: order.shipments[0]?.carrier ?? null,
      itemCount: order.items.reduce((s, it) => s + it.quantity, 0),
      allowSynthetic: Boolean(body.allowSynthetic),
    })

    return NextResponse.json({ ok: true, job })
  }

  if (action === 'ACK_PRINT_JOB') {
    const jobId = String(body.jobId || body.orderId || '').trim()
    const printedMethod = String(body.printedMethod || 'BROWSER_PRINT')
    const status = body.status === 'SKIPPED' ? 'SKIPPED' : 'PRINTED'
    const job = ackShopeePrintJob(jobId, stationId, printedMethod, status)
    return NextResponse.json({ ok: true, job })
  }

  if (action === 'REMOVE_TEST_PRINT_JOB') {
    const jobId = String(body.jobId || body.orderId || '').trim()
    const removed = removeShopeePrintJobForTest(jobId)
    return NextResponse.json({ ok: true, removed })
  }

  if (action === 'RAW_TCP_PRINT') {
    const host = String(body.host || '').trim()
    const port = Number(body.port || 9100)
    const payloadBase64 = String(body.payloadBase64 || '').trim()

    if (!isAllowedLanPrinterHost(host)) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Chặn bảo mật SSRF: Máy in nhiệt LAN chỉ được phép nằm trong dải mạng nội bộ RFC-1918 (192.168.x.x, 10.x.x.x, 172.16-31.x.x) hoặc 127.0.0.1.',
        },
        { status: 403 }
      )
    }

    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      return NextResponse.json(
        { ok: false, error: 'Cổng máy in TCP phải nằm trong khoảng 1024..65535 (mặc định 9100).' },
        { status: 400 }
      )
    }

    if (!payloadBase64 || payloadBase64.length > 350_000) {
      return NextResponse.json(
        { ok: false, error: 'Dữ liệu lệnh in ESC/POS không hợp lệ hoặc vượt quá giới hạn an toàn.' },
        { status: 400 }
      )
    }

    const buf = Buffer.from(payloadBase64, 'base64')
    if (buf.length === 0) {
      return NextResponse.json({ ok: false, error: 'Payload ESC/POS rỗng.' }, { status: 400 })
    }

    try {
      await sendRawBytesToTcpPrinter(host, port, buf)
      return NextResponse.json({
        ok: true,
        host,
        port,
        bytesSent: buf.length,
      })
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : 'Không thể gửi lệnh in tới máy in mạng LAN.',
        },
        { status: 502 }
      )
    }
  }

  return NextResponse.json({ ok: false, error: `Action không hỗ trợ: ${action}` }, { status: 400 })
}
