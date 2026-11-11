#!/usr/bin/env node
// scripts/safe-upgrade-main.mjs
// Điều phối Nâng cấp & Bảo trì Không Gián Đoạn (Zero-Downtime Safe Upgrade & Auto-Rollback) trên nhánh `main`
// Tuân thủ docs/MAINTENANCE_RUNBOOK.md: Pre-flight -> Drain & Read-Only -> WAL Backup SHA-256 -> Safe Build -> Health & Delta=0 -> Resume

import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const args = new Set(process.argv.slice(2))
const DRY_RUN = args.has('--dry-run')
const SKIP_BUILD = args.has('--skip-build')
const NO_RESTART = args.has('--no-restart')
const ALLOW_BRANCH = args.has('--allow-branch')
const DO_GIT_PULL = args.has('--pull')
const FORCE_PRISMA = args.has('--force-prisma')

const CMS_PORT = process.env.PORT || '3010'
const SHOPEE_PORT = process.env.SHOPEE_SYNC_PORT || '51898'
const CMS_BASE = process.env.CMS_HEALTH_URL || `http://127.0.0.1:${CMS_PORT}`
const SHOPEE_BASE = process.env.SHOPEE_DAEMON_URL || `http://127.0.0.1:${SHOPEE_PORT}`
const API_KEY = process.env.CMS_API_KEY || ''

function runCmd(cmd, label) {
  console.log(`   ↳ $ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', env: process.env })
}

function requestJsonOnce(url, options = {}, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const client = parsed.protocol === 'https:' ? https : http
    const bodyBuf = options.body ? Buffer.from(String(options.body), 'utf8') : null
    const headers = {
      Accept: 'application/json',
      Connection: 'close',
      ...(bodyBuf ? { 'Content-Type': 'application/json', 'Content-Length': String(bodyBuf.length) } : {}),
      ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      ...(options.headers || {}),
    }
    const req = client.request(
      parsed,
      { method: options.method || 'GET', agent: false, headers, timeout: timeoutMs },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8')
          let body = null
          try {
            body = JSON.parse(raw)
          } catch {}
          const status = res.statusCode || 0
          resolve({ ok: status >= 200 && status < 300, status, body })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error(`Timeout after ${timeoutMs}ms`)))
    req.on('error', (err) => resolve({ ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }))
    if (bodyBuf) req.write(bodyBuf)
    req.end()
  })
}

async function fetchJsonSafe(url, options = {}, timeoutMs = 25000, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const res = await requestJsonOnce(url, options, timeoutMs)
    if (res.status > 0 || attempt === retries) return res
    await new Promise((r) => setTimeout(r, 600))
  }
  return { ok: false, status: 0, error: 'exhausted' }
}

function unlockLegacyDirectStandaloneOnWindows(port) {
  if (process.platform !== 'win32') return false
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$procs = Get-CimInstance Win32_Process -Filter \\"Name = 'node.exe'\\" | Where-Object { $_.CommandLine -like '*.next*standalone*server.js*' }; foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output $p.ProcessId }"`,
      { encoding: 'utf8' }
    ).trim()
    return out.length > 0
  } catch {
    return false
  }
}

function reloadStandaloneServer(port) {
  if (process.platform === 'win32') {
    try {
      execSync(
        `powershell -NoProfile -Command "$killed = $false; $list = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($p in $list) { if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; $killed = $true } }; $procs = Get-CimInstance Win32_Process -Filter \\"Name = 'node.exe'\\" | Where-Object { $_.CommandLine -like '*.runtime*standalone*server.js*' }; foreach ($rp in $procs) { Stop-Process -Id $rp.ProcessId -Force -ErrorAction SilentlyContinue; $killed = $true }; if ($killed) { Start-Sleep -Milliseconds 700 }; exit 0"`,
        { stdio: 'ignore' }
      )
    } catch {}
  } else {
    try {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' })
    } catch {}
  }

  // Blue-Green Swap: Đồng bộ đa luồng .next/standalone sang .runtime/standalone (loại trừ db) để các lần build sau không khóa DLL trên Windows
  const stagingDir = path.resolve('.next/standalone')
  const runtimeDir = path.resolve('.runtime/standalone')
  fs.mkdirSync(runtimeDir, { recursive: true })
  if (process.platform === 'win32') {
    const rc = spawnSync(
      'robocopy',
      [stagingDir, runtimeDir, '/MIR', '/XD', 'db', '/MT:16', '/R:3', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP'],
      { stdio: 'ignore' }
    )
    if ((rc.status ?? 0) >= 8) {
      throw new Error(`Đồng bộ .runtime/standalone thất bại (robocopy exit code ${rc.status})`)
    }
  } else {
    fs.rmSync(runtimeDir, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(runtimeDir), { recursive: true })
    fs.cpSync(stagingDir, runtimeDir, { recursive: true })
  }

  // Đọc DATABASE_URL từ .env nếu chưa được nạp vào process.env
  const childEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOSTNAME: '0.0.0.0',
    PORT: String(port),
    REALTIME_PORT: process.env.REALTIME_PORT || '3013',
    REALTIME_URL: process.env.REALTIME_URL || `http://localhost:${process.env.REALTIME_PORT || '3013'}`,
    NEXT_PUBLIC_REALTIME_PORT: process.env.REALTIME_PORT || '3013',
  }
  const envFile = path.resolve('.env')
  if (!childEnv.DATABASE_URL && fs.existsSync(envFile)) {
    const line = fs
      .readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .find((l) => l.startsWith('DATABASE_URL='))
    if (line) {
      childEnv.DATABASE_URL = line.slice('DATABASE_URL='.length).trim().replace(/^['"]|['"]$/g, '')
    }
  }
  if (!childEnv.DATABASE_URL) {
    childEnv.DATABASE_URL = `file:${path.resolve('db/custom.db').replace(/\\/g, '/')}`
  }

  const child = spawn(process.execPath, ['.runtime/standalone/server.js'], {
    cwd: process.cwd(),
    env: childEnv,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function writeLocalMaintenanceFile(enabled, reason = '', retryAfterSec = 120) {
  const filePath = path.resolve('db/.maintenance_state.json')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const payload = {
    enabled: Boolean(enabled),
    reason: String(reason),
    retryAfterSec: Number(retryAfterSec) || 120,
    updatedAt: new Date().toISOString(),
  }
  const tmpPath = `${filePath}.tmp`
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8')
  fs.renameSync(tmpPath, filePath)
}

function cleanTemporaryTestGuardSnapshot() {
  // Thực thi qua tiến trình con ngắn hạn để tiến trình điều phối không giữ khóa query_engine-windows.dll.node khi chạy prisma generate
  const out = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'import { PrismaClient } from "@prisma/client"; const p = new PrismaClient(); try { const r = await p.appSetting.deleteMany({ where: { key: "beta_test_snapshot_v1" } }); process.stdout.write(String(r.count)); } finally { await p.$disconnect(); }',
    ],
    { encoding: 'utf8', env: process.env }
  ).trim()
  return Number(out) || 0
}

function isPrismaClientUpToDate() {
  const srcSchema = path.resolve('prisma/schema.prisma')
  const genSchema = path.resolve('node_modules/.prisma/client/schema.prisma')
  const genIndex = path.resolve('node_modules/.prisma/client/index.js')
  if (!fs.existsSync(srcSchema) || !fs.existsSync(genSchema) || !fs.existsSync(genIndex)) return false
  const norm = (s) => s.replace(/\r\n/g, '\n').trim()
  return norm(fs.readFileSync(srcSchema, 'utf8')) === norm(fs.readFileSync(genSchema, 'utf8'))
}

async function main() {
  const startedAt = Date.now()
  console.log('======================================================================')
  console.log('🛡️  OPENVN · ƯU ĐÀM SUITE — SAFE MAIN-BRANCH UPGRADE ENGINE (v2.6.0)')
  console.log(`    Mode: ${DRY_RUN ? 'DRY-RUN (Kiểm tra diễn tập an toàn)' : 'LIVE UPGRADE'} | CMS: ${CMS_BASE} | Shopee: ${SHOPEE_BASE}`)
  console.log('======================================================================\n')

  // -------------------------------------------------------------------------
  // BƯỚC 1: KIỂM TRA NHÁNH CHÍNH & TOÀN VẸN CƠ SỞ DỮ LIỆU TRƯỚC NÂNG CẤP
  // -------------------------------------------------------------------------
  console.log('▶ [1/6] Pre-flight Verification (Nhánh main, Schema Guard & Baseline 24 bảng)...')
  const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
  console.log(`   • Nhánh Git hiện tại: ${branch}`)
  if (branch !== 'main' && !ALLOW_BRANCH) {
    throw new Error(`Từ chối nâng cấp: Nhánh hiện tại là "${branch}" (yêu cầu nhánh "main" hoặc truyền --allow-branch).`)
  }

  // Quét chống lệnh phá hủy dữ liệu trong prisma/migrations (nếu có)
  const migrationsDir = path.resolve('prisma/migrations')
  if (fs.existsSync(migrationsDir)) {
    const sqlFiles = fs
      .readdirSync(migrationsDir, { recursive: true })
      .filter((f) => String(f).endsWith('.sql'))
    for (const rel of sqlFiles) {
      const full = path.join(migrationsDir, String(rel))
      const sql = fs.readFileSync(full, 'utf8')
      if (/\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE\s+TABLE)\b/i.test(sql) && !args.has('--confirm-contract-phase')) {
        throw new Error(
          `Phát hiện mệnh đề thu hẹp/xóa cột trong ${rel}. Theo chuẩn Expand-and-Contract, chỉ chạy Pha 3 khi truyền --confirm-contract-phase.`
        )
      }
    }
  }

  // Dọn khóa tạm beta_test_snapshot_v1 nếu còn sót từ phiên nâng cấp bị ngắt giữa chừng
  const staleSnapCleaned = await cleanTemporaryTestGuardSnapshot()
  if (staleSnapCleaned > 0) {
    console.log(`   • Đã thu hồi ${staleSnapCleaned} khóa snapshot tạm (beta_test_snapshot_v1) từ phiên trước.`)
  }

  runCmd('node scripts/check-counts.mjs', 'Baseline Parity Pre-check')

  // Kiểm tra trạng thái online hiện tại của các dịch vụ
  const cmsHealth = await fetchJsonSafe(`${CMS_BASE}/api/health`, {}, 5000, 1)
  const shopeeHealth = await fetchJsonSafe(`${SHOPEE_BASE}/shopee/status`, {}, 5000, 1)
  const cmsOnline = cmsHealth.ok
  const shopeeOnline = shopeeHealth.ok
  console.log(
    `   • Trạng thái dịch vụ: CMS=${cmsOnline ? 'ONLINE' : 'OFFLINE'} | ShopeeDaemon=${shopeeOnline ? 'ONLINE' : 'OFFLINE'}\n`
  )

  let backupFilePath = path.resolve('db/custom.db.bak.pre-autosocial')
  let shopeePausedByUs = false
  let maintenanceEnabledByUs = false
  let snapshotCreatedByUs = false

  try {
    // -----------------------------------------------------------------------
    // BƯỚC 2: CHẾ ĐỘ DRAIN SHOPEE DAEMON & BẬT READ-ONLY MAINTENANCE MODE
    // -----------------------------------------------------------------------
    console.log('▶ [2/6] Kích hoạt Chế độ Drain & Read-Only Maintenance Mode...')
    if (DRY_RUN) {
      console.log('   • [DRY-RUN] Bỏ qua gửi lệnh POST /shopee/pause & POST /api/system/maintenance.')
    } else {
      if (shopeeOnline) {
        const pauseRes = await fetchJsonSafe(`${SHOPEE_BASE}/shopee/pause`, { method: 'POST' })
        if (pauseRes.ok) {
          shopeePausedByUs = true
          console.log('   • Đã tạm dừng Shopee Sync Daemon (:51898/shopee/pause -> Spool Queue Mode).')
        }
      }
      const maintReason = 'Hệ thống đang nâng cấp phiên bản an toàn trên nhánh main (Read-Only).'
      writeLocalMaintenanceFile(true, maintReason, 120)
      maintenanceEnabledByUs = true
      if (cmsOnline) {
        await fetchJsonSafe(`${CMS_BASE}/api/system/maintenance`, {
          method: 'POST',
          body: JSON.stringify({
            enabled: true,
            retryAfterSec: 120,
            reason: maintReason,
          }),
        })
      }
      console.log('   • Đã bật cờ Read-Only Maintenance Mode (HTTP 503 + Retry-After: 120s cho luồng ghi).')
    }
    console.log('')

    // -----------------------------------------------------------------------
    // BƯỚC 3: SAO LƯU CSDL 2 TẦNG (WAL CHECKPOINT + SHA-256 + TEST-GUARD SNAPSHOT)
    // -----------------------------------------------------------------------
    console.log('▶ [3/6] Sao lưu đóng băng CSDL trước nâng cấp (WAL Checkpoint + SHA-256)...')
    const dbSrc = path.resolve('db/custom.db')
    if (!fs.existsSync(dbSrc)) {
      throw new Error(`Không tìm thấy CSDL SQLite tại ${dbSrc}`)
    }
    if (DRY_RUN) {
      const hash = sha256File(dbSrc)
      console.log(`   • [DRY-RUN] Xác nhận tệp SQLite hợp lệ (${fs.statSync(dbSrc).size.toLocaleString()} bytes, SHA-256=${hash.slice(0, 16)}...).`)
    } else {
      runCmd('node scripts/backup-pre-autosocial.mjs', 'SQLite WAL Checkpoint & Backup')
      const tsBackup = path.resolve('db/custom.db.bak.pre-upgrade')
      fs.copyFileSync(backupFilePath, tsBackup)
      backupFilePath = tsBackup
      if (cmsOnline) {
        const snapRes = await fetchJsonSafe(
          `${CMS_BASE}/api/ledger/test-guard`,
          { method: 'POST', body: JSON.stringify({ action: 'SNAPSHOT' }) },
          30000
        )
        if (snapRes.ok) snapshotCreatedByUs = true
        console.log(`   • Test-Guard Snapshot: ${snapRes.ok ? 'OK' : 'SKIPPED'}`)
      }
    }
    console.log('')

    // -----------------------------------------------------------------------
    // BƯỚC 4: KIỂM TRA TĨNH, DI TRÚ SCHEMA AN TOÀN & ĐÓNG GÓI STANDALONE
    // -----------------------------------------------------------------------
    console.log('▶ [4/6] Kiểm tra TypeScript, cập nhật Prisma Client & Đóng gói Standalone...')
    runCmd('npx tsc --noEmit', 'TypeScript Static Check')

    if (!DRY_RUN) {
      if (DO_GIT_PULL) {
        runCmd('git pull --ff-only origin main', 'Fast-Forward Git Pull')
      }
      if (FORCE_PRISMA || !isPrismaClientUpToDate()) {
        runCmd('npx prisma generate', 'Prisma Client Generate')
      } else {
        console.log('   • Prisma Client đã đồng bộ 100% với prisma/schema.prisma.')
      }
      if (fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).length > 0) {
        runCmd('npx prisma migrate deploy', 'Prisma Safe Migrate Deploy')
      }
      if (!SKIP_BUILD) {
        if (unlockLegacyDirectStandaloneOnWindows(CMS_PORT)) {
          console.log('   • Đã giải phóng tiến trình legacy giữ khóa .next/standalone DLL trên Windows (chuyển sang Blue-Green .runtime/standalone)...')
          await new Promise((r) => setTimeout(r, 800))
        }
        runCmd('npm run build', 'Next.js Standalone Production Build')
      }
      if (!NO_RESTART && fs.existsSync(path.resolve('.next/standalone/server.js'))) {
        console.log(`   • Đang nạp bản build Standalone mới lên cổng :${CMS_PORT} (Blue-Green .runtime/standalone)...`)
        reloadStandaloneServer(CMS_PORT)
        let ready = false
        for (let i = 0; i < 25; i++) {
          await new Promise((r) => setTimeout(r, 750))
          const probe = await fetchJsonSafe(`${CMS_BASE}/api/health`, {}, 3500, 1)
          if (probe.ok) {
            ready = true
            break
          }
        }
        if (!ready) {
          throw new Error(`Tiến trình Standalone mới không phản hồi /api/health sau 18s trên cổng ${CMS_PORT}`)
        }
        console.log(`   • Standalone Server mới đã sẵn sàng phục vụ tại ${CMS_BASE}.`)
      }
    } else {
      console.log('   • [DRY-RUN] TypeScript PASS 100%. Bỏ qua bước ghi Prisma & đóng gói lại .next/standalone.')
    }
    console.log('')

    // -----------------------------------------------------------------------
    // BƯỚC 5: HẬU KIỂM TOÀN VẸN DỮ LIỆU & SỨC KHỎE DỊCH VỤ (DELTA = 0)
    // -----------------------------------------------------------------------
    console.log('▶ [5/6] Hậu kiểm đối soát 24 bảng CSDL lõi & Sức khỏe dịch vụ...')
    if (snapshotCreatedByUs && !DRY_RUN) {
      await cleanTemporaryTestGuardSnapshot()
      snapshotCreatedByUs = false
    }
    runCmd('node scripts/check-counts.mjs', 'Post-Upgrade Baseline Parity')
    if (DRY_RUN ? cmsOnline : cmsOnline || !NO_RESTART) {
      const postCms = await fetchJsonSafe(`${CMS_BASE}/api`, {}, 25000, 2)
      if (!postCms.ok || postCms.body?.status !== 'healthy') {
        throw new Error(`CMS API Gateway hậu kiểm không đạt chuẩn healthy (HTTP ${postCms.status})`)
      }
      console.log(
        `   • CMS Gateway Healthy: v${postCms.body.version} | ActiveProducts=${postCms.body.metrics?.activeProducts}`
      )
    }
    console.log('')

    // -----------------------------------------------------------------------
    // BƯỚC 6: MỞ LẠI LUỒNG GHI & XẢ ĐỆM SHOPEE DAEMON
    // -----------------------------------------------------------------------
    console.log('▶ [6/6] Mở khóa Read-Only Maintenance & Khôi phục đồng bộ Shopee...')
    if (!DRY_RUN) {
      if (maintenanceEnabledByUs) {
        writeLocalMaintenanceFile(false, '', 120)
        await fetchJsonSafe(`${CMS_BASE}/api/system/maintenance`, {
          method: 'POST',
          body: JSON.stringify({ enabled: false }),
        })
        maintenanceEnabledByUs = false
        console.log('   • Đã tắt cờ Read-Only Maintenance Mode.')
      }
      if (shopeePausedByUs) {
        await fetchJsonSafe(`${SHOPEE_BASE}/shopee/resume`, { method: 'POST' })
        shopeePausedByUs = false
        console.log('   • Đã khôi phục Shopee Sync Daemon (:51898/shopee/resume).')
      }
    } else {
      console.log('   • [DRY-RUN] Diễn tập hoàn tất an toàn, không thay đổi trạng thái hệ thống.')
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(2)
    console.log('\n======================================================================')
    console.log(`✅ NÂNG CẤP NHÁNH MAIN HOÀN TẤT AN TOÀN TRONG ${elapsedSec}s (DELTA = 0)`)
    console.log('======================================================================\n')
  } catch (err) {
    const rtoStart = Date.now()
    console.error('\n❌ PHÁT HIỆN LỖI TRONG QUÁ TRÌNH NÂNG CẤP:', err instanceof Error ? err.message : err)

    if (!DRY_RUN) {
      console.error('🚨 KÍCH HOẠT QUY TRÌNH KHÔI PHỤC KHẨN CẤP TỰ ĐỘNG (AUTO-ROLLBACK)...')
      try {
        const dbDst = path.resolve('db/custom.db')
        if (fs.existsSync(backupFilePath)) {
          fs.copyFileSync(backupFilePath, dbDst)
          const match = sha256File(backupFilePath) === sha256File(dbDst)
          console.error(`   • Phục hồi CSDL SQLite từ bản sao lưu: ${match ? 'SHA-256 VERIFIED' : 'MISMATCH'}`)
        }
        if ((cmsOnline || !NO_RESTART) && fs.existsSync(path.resolve('.next/standalone/server.js'))) {
          const checkLive = await fetchJsonSafe(`${CMS_BASE}/api/health`, {}, 3000, 1)
          if (!checkLive.ok) {
            reloadStandaloneServer(CMS_PORT)
            for (let i = 0; i < 15; i++) {
              await new Promise((r) => setTimeout(r, 750))
              const probe = await fetchJsonSafe(`${CMS_BASE}/api/health`, {}, 3000, 1)
              if (probe.ok) break
            }
          }
        }
        if (snapshotCreatedByUs) {
          await fetchJsonSafe(
            `${CMS_BASE}/api/ledger/test-guard`,
            { method: 'POST', body: JSON.stringify({ action: 'RESTORE_AND_CLEAN' }) },
            60000
          )
          await cleanTemporaryTestGuardSnapshot()
          console.error('   • Đã kích hoạt Test-Guard RESTORE_AND_CLEAN & xóa khóa snapshot tạm.')
        }
        if (maintenanceEnabledByUs) {
          writeLocalMaintenanceFile(false, '', 120)
          await fetchJsonSafe(`${CMS_BASE}/api/system/maintenance`, {
            method: 'POST',
            body: JSON.stringify({ enabled: false }),
          })
          console.error('   • Đã tắt cờ Maintenance Mode sau khi khôi phục.')
        }
        if (shopeePausedByUs) {
          await fetchJsonSafe(`${SHOPEE_BASE}/shopee/resume`, { method: 'POST' })
          console.error('   • Đã khôi phục Shopee Sync Daemon sau khi rollback.')
        }
      } catch (rbErr) {
        console.error('   • Cảnh báo khi rollback:', rbErr)
      }
      const rtoSec = ((Date.now() - rtoStart) / 1000).toFixed(2)
      console.error(`🛡️ AUTO-ROLLBACK HOÀN TẤT TRONG ${rtoSec}s (Mục tiêu RTO < 300s).`)
    }
    process.exit(1)
  }
}

main()
