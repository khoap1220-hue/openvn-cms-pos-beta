// scripts/ops-healthcheck.mjs
// Kiểm tra sức khỏe toàn diện 4 tầng hệ thống vận hành: CSDL SQLite + Realtime Bus (:3013) + Shopee Sync Daemon (:51898) + CMS API Gateway (:3010)

import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const CMS_URL = process.env.CMS_HEALTH_URL || `http://127.0.0.1:${process.env.PORT || '3010'}`
const REALTIME_URL = process.env.REALTIME_URL || `http://127.0.0.1:${process.env.REALTIME_PORT || '3013'}`
const SHOPEE_DAEMON_URL = process.env.SHOPEE_DAEMON_URL || `http://127.0.0.1:${process.env.SHOPEE_SYNC_PORT || '51898'}`

function probeJson(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now()
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const req = client.request(
      parsed,
      {
        method: 'GET',
        agent: false,
        headers: { Accept: 'application/json', Connection: 'close' },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const latencyMs = Date.now() - start
          const raw = Buffer.concat(chunks).toString('utf8')
          let body = null
          try {
            body = JSON.parse(raw)
          } catch {}
          const status = res.statusCode || 0
          resolve({ ok: status >= 200 && status < 300, status, latencyMs, body })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`))
    })
    req.on('error', (err) => {
      resolve({ ok: false, status: 0, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) })
    })
    req.end()
  })
}

async function main() {
  console.log('==============================================================')
  console.log('OPENVN · ƯU ĐÀM SUITE — OPERATIONAL HEALTH PROBE (ops:health)')
  console.log('==============================================================\n')

  let allGreen = true

  // 1. Kiểm tra file CSDL SQLite
  const dbPath = path.resolve('db/custom.db')
  if (fs.existsSync(dbPath)) {
    const stat = fs.statSync(dbPath)
    const fd = fs.openSync(dbPath, 'r')
    const headerBuf = Buffer.alloc(15)
    fs.readSync(fd, headerBuf, 0, 15, 0)
    fs.closeSync(fd)
    const isSqlite = headerBuf.toString('utf8') === 'SQLite format 3'
    if (isSqlite) {
      console.log(`✅ [1/4] SQLite Database     : OK (${(stat.size / 1024).toFixed(1)} KB · valid SQLite format 3)`)
    } else {
      console.error('❌ [1/4] SQLite Database     : Header không hợp lệ!')
      allGreen = false
    }
  } else {
    console.error(`❌ [1/4] SQLite Database     : Không tìm thấy tại ${dbPath}`)
    allGreen = false
  }

  // 2. Kiểm tra Realtime WebSocket Service (:3013/health)
  const rt = await probeJson(`${REALTIME_URL}/health`)
  if (rt.ok && rt.body?.ok) {
    console.log(
      `✅ [2/4] Realtime Event Bus  : OK (${REALTIME_URL}/health · ${rt.latencyMs}ms · clients=${rt.body.clients ?? 0} · uptime=${rt.body.uptime ?? 0}s)`,
    )
  } else {
    console.error(`❌ [2/4] Realtime Event Bus  : OFFLINE (${REALTIME_URL}/health · ${rt.error || `HTTP ${rt.status}`})`)
    allGreen = false
  }

  // 3. Kiểm tra Shopee Seller Sync Daemon (:51898/shopee/status)
  let sp = await probeJson(`${SHOPEE_DAEMON_URL}/shopee/status`, 12000)
  if (!sp.ok) sp = await probeJson(`${SHOPEE_DAEMON_URL}/shopee/status`, 12000)
  if (sp.ok && (sp.body?.ok || sp.body?.status === 'ok' || sp.body?.shopUsername || sp.body?.username || sp.body?.shopId)) {
    const tracked = sp.body.trackedProducts ?? sp.body.asyncQueue?.trackedProducts ?? 0
    const dlq = sp.body.dlqCount ?? sp.body.asyncQueue?.dlqCount ?? 0
    console.log(
      `✅ [3/4] Shopee Sync Daemon  : OK (${SHOPEE_DAEMON_URL}/shopee/status · ${sp.latencyMs}ms · shop=${sp.body.shopUsername || sp.body.username || 'thaimy1605'} [${sp.body.shopId || '197195817'}] · tracked=${tracked} · dlq=${dlq})`,
    )
  } else {
    console.error(`❌ [3/4] Shopee Sync Daemon  : OFFLINE (${SHOPEE_DAEMON_URL}/shopee/status · ${sp.error || `HTTP ${sp.status}`})`)
    allGreen = false
  }

  // 4. Kiểm tra CMS & API Gateway (:3010/api)
  const cms = await probeJson(`${CMS_URL}/api`, 20000)
  if (cms.ok && cms.body?.ok && cms.body?.status === 'healthy') {
    const m = cms.body.metrics || {}
    console.log(
      `✅ [4/4] CMS & API Gateway   : OK (${CMS_URL}/api · v${cms.body.version} · ${cms.latencyMs}ms · SP=${m.activeProducts} · Đơn=${m.totalOrders} · Kho=${m.activeWarehouses})`,
    )
  } else {
    console.error(`❌ [4/4] CMS & API Gateway   : OFFLINE/DEGRADED (${CMS_URL}/api · ${cms.error || `HTTP ${cms.status}`})`)
    allGreen = false
  }

  console.log('\n==============================================================')
  console.log(`TRẠNG THÁI VẬN HÀNH: ${allGreen ? '🟢 SẴN SÀNG PHỤC VỤ (ALL HEALTHY)' : '🔴 CẦN KIỂM TRA DỊCH VỤ'}`)
  console.log('==============================================================\n')

  if (!allGreen) process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
