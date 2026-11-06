// scripts/ops-healthcheck.mjs
// Kiểm tra sức khỏe toàn diện hệ thống vận hành: CSDL SQLite + Realtime Bus (:3013) + CMS API Gateway (:3010)

import fs from 'node:fs'
import path from 'node:path'

const CMS_URL = process.env.CMS_HEALTH_URL || `http://localhost:${process.env.PORT || '3010'}`
const REALTIME_URL = process.env.REALTIME_URL || `http://localhost:${process.env.REALTIME_PORT || '3013'}`

async function probeJson(url, timeoutMs = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const start = Date.now()
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
    const latencyMs = Date.now() - start
    const body = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, latencyMs, body }
  } catch (err) {
    return { ok: false, status: 0, latencyMs: 0, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
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
      console.log(`✅ [1/3] SQLite Database     : OK (${(stat.size / 1024).toFixed(1)} KB · valid SQLite format 3)`)
    } else {
      console.error('❌ [1/3] SQLite Database     : Header không hợp lệ!')
      allGreen = false
    }
  } else {
    console.error(`❌ [1/3] SQLite Database     : Không tìm thấy tại ${dbPath}`)
    allGreen = false
  }

  // 2. Kiểm tra Realtime WebSocket Service (:3013/health)
  const rt = await probeJson(`${REALTIME_URL}/health`)
  if (rt.ok && rt.body?.ok) {
    console.log(
      `✅ [2/3] Realtime Event Bus  : OK (${REALTIME_URL}/health · ${rt.latencyMs}ms · clients=${rt.body.clients ?? 0} · uptime=${rt.body.uptime ?? 0}s)`,
    )
  } else {
    console.error(`❌ [2/3] Realtime Event Bus  : OFFLINE (${REALTIME_URL}/health · ${rt.error || `HTTP ${rt.status}`})`)
    allGreen = false
  }

  // 3. Kiểm tra CMS & API Gateway (:3010/api)
  const cms = await probeJson(`${CMS_URL}/api`)
  if (cms.ok && cms.body?.ok && cms.body?.status === 'healthy') {
    const m = cms.body.metrics || {}
    console.log(
      `✅ [3/3] CMS & API Gateway   : OK (${CMS_URL}/api · v${cms.body.version} · ${cms.latencyMs}ms · SP=${m.activeProducts} · Đơn=${m.totalOrders} · Kho=${m.activeWarehouses})`,
    )
  } else {
    console.error(`❌ [3/3] CMS & API Gateway   : OFFLINE/DEGRADED (${CMS_URL}/api · ${cms.error || `HTTP ${cms.status}`})`)
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
