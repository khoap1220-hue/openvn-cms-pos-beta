import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface SuiteResult {
  name: string
  script: string
  exitCode: number | null
  durationMs: number
  stdout: string
  stderr: string
}

const SUITES: Array<{ name: string; script: string; description: string }> = [
  {
    name: 'Stock Ledger Chain Integrity',
    script: 'scripts/verify-chain.ts',
    description: 'Monotonic cumulative stock ledger invariant (test:chain)',
  },
  {
    name: 'R1: Regressions & Transactions',
    script: 'scripts/verify-r1-regressions.ts',
    description: 'Order cancel atomicity, shipment return atomicity, customer phone dedup',
  },
  {
    name: 'R2: Bulk Orders & Delivery Slips',
    script: 'scripts/verify-r2-bulk-orders.ts',
    description: 'Mixed batch confirmation, granular rejection reasons, A6 slips format',
  },
  {
    name: 'R3: VAT E-Invoice XML & Mock Signing',
    script: 'scripts/verify-r3-einvoice-xml.ts',
    description: 'NĐ 123 / TT 78 / QĐ 1450 XML structure, amount words, cancelled guard, mock signer',
  },
  {
    name: 'R4: Product Catalog CSV/Excel Import/Export',
    script: 'scripts/verify-r4-catalog-csv-excel.ts',
    description: 'UTF-8 BOM export, round-trip preservation, line-numbered error reporting, atomic rollback',
  },
  {
    name: 'R5: P2 Operational Features & Safe Mocks',
    script: 'scripts/verify-r5-p2-features.ts',
    description: 'Dashboard 7/14/30/90 days, PO workflow, ESC/POS K80 print, GHN/GHTK fee, VIP birthday, drill',
  },
  {
    name: 'Pre-existing Real-World Scenarios (21)',
    script: 'scripts/verify-realworld-scenarios.ts',
    description: '21 production scenarios (BOM, stock, POS checkout, periods, aftersales, etc.)',
  },
  {
    name: 'R6-R7: Auto Social & 7 Platforms (113)',
    script: 'scripts/verify-auto-social.ts',
    description: 'CRM Campaigns, Drive Parser, AI Copywriter, Three Iron Gates, 7 Platform Adapters',
  },
]

async function runScript(scriptPath: string): Promise<{ exitCode: number | null; stdout: string; stderr: string; durationMs: number }> {
  const start = Date.now()
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'test' },
      shell: false,
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })

    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })

    child.on('close', (exitCode) => {
      const durationMs = Date.now() - start
      resolve({ exitCode, stdout, stderr, durationMs })
    })

    child.on('error', (err) => {
      const durationMs = Date.now() - start
      resolve({ exitCode: 1, stdout, stderr: err.message, durationMs })
    })
  })
}

async function main() {
  console.log('================================================================================')
  console.log('OPENVN · ƯU ĐÀM SUITE — MASTER E2E VERIFICATION SUITE (TIERS 1-4)')
  console.log('================================================================================\n')
  console.log(`Bắt đầu chạy ${SUITES.length} bộ kiểm thử tự động...\n`)

  const results: SuiteResult[] = []
  const suiteStart = Date.now()

  for (let i = 0; i < SUITES.length; i++) {
    const suite = SUITES[i]
    const indexStr = `[${i + 1}/${SUITES.length}]`
    process.stdout.write(`${indexStr.padEnd(8)} Đang chạy ${suite.name} (${suite.script})... `)

    const run = await runScript(suite.script)
    const passed = run.exitCode === 0

    const statusBadge = passed ? '✅ PASS' : '❌ FAIL'
    const durationSec = (run.durationMs / 1000).toFixed(2)
    console.log(`${statusBadge} (${durationSec}s)`)

    results.push({
      name: suite.name,
      script: suite.script,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      stdout: run.stdout,
      stderr: run.stderr,
    })
  }

  const totalDurationSec = ((Date.now() - suiteStart) / 1000).toFixed(2)
  const passedSuites = results.filter((r) => r.exitCode === 0)
  const failedSuites = results.filter((r) => r.exitCode !== 0)

  console.log('\n================================================================================')
  console.log('BẢNG TỔNG KẾT KẾT QUẢ KIỂM THỬ E2E (TIERS 1-4)')
  console.log('================================================================================')
  console.log('STT | Bộ kiểm thử                         | File Script                         | Kết quả | Thời gian')
  console.log('----+-------------------------------------+-------------------------------------+---------+----------')

  results.forEach((r, idx) => {
    const num = String(idx + 1).padStart(2, ' ')
    const name = r.name.padEnd(35, ' ').slice(0, 35)
    const script = r.script.padEnd(35, ' ').slice(0, 35)
    const status = r.exitCode === 0 ? ' PASS  ' : ' FAIL  '
    const duration = `${(r.durationMs / 1000).toFixed(2)}s`.padStart(8, ' ')
    console.log(`${num} | ${name} | ${script} | ${status} | ${duration}`)
  })

  console.log('================================================================================')
  console.log(`TỔNG SỐ BỘ TEST : ${SUITES.length}`)
  console.log(`SỐ BỘ ĐẠT (PASS) : ${passedSuites.length}`)
  console.log(`SỐ BỘ LỖI (FAIL) : ${failedSuites.length}`)
  console.log(`TỔNG THỜI GIAN   : ${totalDurationSec}s`)
  console.log('================================================================================\n')

  if (failedSuites.length > 0) {
    console.log('DANH SÁCH BỘ TEST CHƯA ĐẠT (CẦN TIẾP TỤC TRIỂN KHAI THEO MILESTONE):')
    for (const f of failedSuites) {
      console.log(`\n--- [FAIL] ${f.name} (${f.script}) ---`)
      // In các dòng FAIL từ stdout/stderr của script con
      const allOutput = `${f.stdout}\n${f.stderr}`
      const failureLines = allOutput
        .split('\n')
        .filter((line) => line.includes('❌ [FAIL]') || line.includes('LỖI') || line.includes('Error'))
        .slice(0, 10)
      for (const line of failureLines) {
        console.log(`  ${line.trim()}`)
      }
    }
    console.log('\n')
    process.exit(1)
  } else {
    console.log('🎉 TẤT CẢ CÁC BỘ KIỂM THỬ E2E ĐÃ VƯỢT QUA 100%!\n')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Ngoại lệ trong verify-e2e-suite:', err)
  process.exit(1)
})
