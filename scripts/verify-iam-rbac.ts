// ============================================================
// E2E VERIFICATION — Multi-Account Login, Shift PIN, RBAC & Behavior Logs
// Chạy kiểm thử toàn diện: npx tsx scripts/verify-iam-rbac.ts
// ============================================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3010'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`)
  }
}

function extractSessionCookie(res: Response): string {
  const rawSetCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [res.headers.get('set-cookie') ?? '']
  for (const header of rawSetCookies) {
    const match = header.match(/omnisales_session=([^;]+)/)
    if (match && match[1]) {
      return `omnisales_session=${match[1]}`
    }
  }
  return ''
}

async function main() {
  console.log(`\n🔐 [IAM / RBAC / BEHAVIOR LOG E2E] Target: ${BASE_URL}\n`)

  // 1. Kiểm tra tự động khởi tạo 6 tài khoản vai trò mẫu
  const hintsRes = await fetch(`${BASE_URL}/api/auth?hints=1`)
  assert(hintsRes.status === 200, `GET /api/auth?hints=1 expected 200, got ${hintsRes.status}`)
  const hintsJson = (await hintsRes.json()) as {
    accountHints: Array<{ username: string; role: string; hasPin: boolean }>
  }
  const usernames = hintsJson.accountHints.map((u) => u.username)
  for (const expected of ['admin', 'quanly', 'thungan', 'thukho', 'ketoan', 'marketing']) {
    assert(usernames.includes(expected), `Missing seeded staff account @${expected}`)
  }
  console.log(`  ✅ 1/7 Auto-seeded 6 staff accounts verified: ${usernames.join(', ')}`)

  // 2. Đăng nhập bằng Mật khẩu (@thungan — CASHIER_POS)
  const cashierLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'password', username: 'thungan', password: 'thungan123' }),
  })
  assert(cashierLogin.status === 200, `Cashier password login expected 200, got ${cashierLogin.status}`)
  const cashierCookie = extractSessionCookie(cashierLogin)
  assert(Boolean(cashierCookie), 'Cashier session cookie missing')
  const cashierBody = (await cashierLogin.json()) as { role: string; defaultView: string }
  assert(cashierBody.role === 'CASHIER_POS', `Expected CASHIER_POS, got ${cashierBody.role}`)
  assert(cashierBody.defaultView === 'pos', `Expected defaultView=pos, got ${cashierBody.defaultView}`)

  // 3. Đăng nhập bằng Mã PIN 4 số (@thukho — WAREHOUSE, PIN 4444)
  const warehouseLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'pin', username: 'thukho', pin: '4444' }),
  })
  assert(warehouseLogin.status === 200, `Warehouse PIN login expected 200, got ${warehouseLogin.status}`)
  const warehouseCookie = extractSessionCookie(warehouseLogin)
  assert(Boolean(warehouseCookie), 'Warehouse session cookie missing')
  const warehouseBody = (await warehouseLogin.json()) as { role: string; defaultView: string }
  assert(warehouseBody.role === 'WAREHOUSE', `Expected WAREHOUSE, got ${warehouseBody.role}`)
  assert(
    warehouseBody.defaultView === 'inventory',
    `Expected defaultView=inventory, got ${warehouseBody.defaultView}`
  )
  console.log('  ✅ 2/7 Multi-account Password Login (@thungan) & 4-digit Shift PIN Login (@thukho) PASSED')

  // 4. Kiểm chứng tường lửa phân quyền RBAC trên API & Route /pos
  const cashierProducts = await fetch(`${BASE_URL}/api/products`, {
    headers: { Cookie: cashierCookie },
  })
  assert(cashierProducts.status === 200, `Cashier GET /api/products expected 200, got ${cashierProducts.status}`)

  const cashierOrders = await fetch(`${BASE_URL}/api/orders`, {
    headers: { Cookie: cashierCookie },
  })
  assert(cashierOrders.status === 200, `Cashier GET /api/orders expected 200, got ${cashierOrders.status}`)

  const cashierPnl = await fetch(`${BASE_URL}/api/reports/pnl`, {
    headers: { Cookie: cashierCookie },
  })
  assert(cashierPnl.status === 403, `Cashier GET /api/reports/pnl expected 403, got ${cashierPnl.status}`)

  const cashierIam = await fetch(`${BASE_URL}/api/iam/users`, {
    headers: { Cookie: cashierCookie },
  })
  assert(cashierIam.status === 403, `Cashier GET /api/iam/users expected 403, got ${cashierIam.status}`)

  const cashierReset = await fetch(`${BASE_URL}/api/system/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cashierCookie },
    body: JSON.stringify({ confirmCode: 'GO-LIVE' }),
  })
  assert(cashierReset.status === 403, `Cashier POST /api/system/reset expected 403, got ${cashierReset.status}`)

  const warehouseInventory = await fetch(`${BASE_URL}/api/inventory`, {
    headers: { Cookie: warehouseCookie },
  })
  assert(
    warehouseInventory.status === 200,
    `Warehouse GET /api/inventory expected 200, got ${warehouseInventory.status}`
  )

  const warehouseSalesInvoices = await fetch(`${BASE_URL}/api/sales-invoices`, {
    headers: { Cookie: warehouseCookie },
  })
  assert(
    warehouseSalesInvoices.status === 403,
    `Warehouse GET /api/sales-invoices expected 403, got ${warehouseSalesInvoices.status}`
  )

  const warehousePosRedirect = await fetch(`${BASE_URL}/pos`, {
    headers: { Cookie: warehouseCookie, Accept: 'text/html' },
    redirect: 'manual',
  })
  assert(
    warehousePosRedirect.status === 307 || warehousePosRedirect.status === 302,
    `Warehouse /pos expected redirect 307/302, got ${warehousePosRedirect.status}`
  )
  console.log('  ✅ 3/7 RBAC Server Gateway enforcement (200 allowed / 403 blocked / /pos guard) PASSED')

  // 5. Kiểm tra cảnh báo đăng nhập sai & ẩn hoàn toàn bí mật (Zero-Secret Audit Log)
  const badSecret = 'WrongSecretPassword999!'
  const failedLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'password', username: 'marketing', password: badSecret }),
  })
  assert(failedLogin.status === 401, `Wrong password expected 401, got ${failedLogin.status}`)

  // Đăng nhập Admin để kiểm tra nhật ký hành vi & quản trị phiên
  const adminLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'password', username: 'admin', password: 'admin' }),
  })
  assert(adminLogin.status === 200, `Admin login expected 200, got ${adminLogin.status}`)
  const adminCookie = extractSessionCookie(adminLogin)
  assert(Boolean(adminCookie), 'Admin session cookie missing')

  // Chờ 350ms để background waitUntil ghi xong log 403 từ proxy
  await new Promise((r) => setTimeout(r, 350))

  const logsRes = await fetch(`${BASE_URL}/api/behavior-logs?limit=60`, {
    headers: { Cookie: adminCookie },
  })
  assert(logsRes.status === 200, `Admin GET /api/behavior-logs expected 200, got ${logsRes.status}`)
  const logsData = (await logsRes.json()) as {
    logs: Array<{ action: string; category: string; summary: string; metadata: string | null }>
    stats: { total24h: number; alerts24h: number }
  }
  const actions = new Set(logsData.logs.map((l) => l.action))
  assert(actions.has('LOGIN_SUCCESS'), 'Expected LOGIN_SUCCESS in BehaviorLog')
  assert(actions.has('LOGIN_FAILED'), 'Expected LOGIN_FAILED in BehaviorLog')
  assert(actions.has('PERMISSION_DENIED'), 'Expected PERMISSION_DENIED (403) in BehaviorLog')

  const rawDump = JSON.stringify(logsData.logs)
  assert(!rawDump.includes(badSecret), 'SECURITY VIOLATION: Raw failed password leaked into BehaviorLog')
  assert(!rawDump.includes('thungan123'), 'SECURITY VIOLATION: Raw cashier password leaked into BehaviorLog')
  console.log(
    `  ✅ 4/7 BehaviorLog realtime capture & Zero-Secret Sanitization PASSED (24h events=${logsData.stats.total24h}, alerts=${logsData.stats.alerts24h})`
  )

  // 6. Tạo nhân sự tạm với Ghi đè quyền ngoại lệ (Custom Permission Override) + Thu hồi phiên từ xa + Dọn sạch
  const createUserRes = await fetch(`${BASE_URL}/api/iam/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({
      username: 'e2e_temp_staff',
      displayName: 'Nhân viên Kiểm thử E2E',
      role: 'CASHIER_POS',
      password: 'tempPassword123',
      pin: '9876',
      customPermissions: { analytics_audit: 'READ' },
    }),
  })
  assert(createUserRes.status === 201 || createUserRes.status === 200, `Create temp staff failed: ${createUserRes.status}`)
  const createdStaff = ((await createUserRes.json()) as { user: { id: string } }).user

  try {
    const tempLogin = await fetch(`${BASE_URL}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'pin', username: 'e2e_temp_staff', pin: '9876' }),
    })
    assert(tempLogin.status === 200, `Temp staff PIN login expected 200, got ${tempLogin.status}`)
    const tempCookie = extractSessionCookie(tempLogin)
    const tempAuthInfo = (await (
      await fetch(`${BASE_URL}/api/auth`, { headers: { Cookie: tempCookie } })
    ).json()) as { sessionId: string }

    // Nhờ customPermissions { analytics_audit: 'READ' }, CASHIER_POS này xem được /api/ledger (200 thay vì 403)
    const tempLedger = await fetch(`${BASE_URL}/api/ledger`, {
      headers: { Cookie: tempCookie },
    })
    assert(
      tempLedger.status === 200,
      `Custom permission override GET /api/ledger expected 200, got ${tempLedger.status}`
    )
    console.log('  ✅ 5/7 Per-user Custom Permission Override (analytics_audit=READ on CASHIER_POS) PASSED')

    // Thu hồi phiên từ xa
    const revokeRes = await fetch(
      `${BASE_URL}/api/iam/sessions?id=${encodeURIComponent(tempAuthInfo.sessionId)}`,
      {
        method: 'DELETE',
        headers: { Cookie: adminCookie },
      }
    )
    assert(revokeRes.status === 200, `Session revoke expected 200, got ${revokeRes.status}`)

    const afterRevoke = await fetch(`${BASE_URL}/api/ledger`, {
      headers: { Cookie: tempCookie },
    })
    assert(
      afterRevoke.status === 401,
      `Revoked session GET /api/ledger expected 401, got ${afterRevoke.status}`
    )
    console.log('  ✅ 6/7 Remote Device Session Revocation (immediate 401 invalidation) PASSED')
  } finally {
    // Xóa tài khoản tạm & đặt lại bộ đếm đăng nhập sai cho @marketing
    await fetch(`${BASE_URL}/api/iam/users/${createdStaff.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })

    const usersListRes = await fetch(`${BASE_URL}/api/iam/users`, {
      headers: { Cookie: adminCookie },
    })
    if (usersListRes.ok) {
      const { users } = (await usersListRes.json()) as {
        users: Array<{ id: string; username: string }>
      }
      const mkt = users.find((u) => u.username === 'marketing')
      if (mkt) {
        await fetch(`${BASE_URL}/api/iam/users/${mkt.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
          body: JSON.stringify({ action: 'unlock' }),
        })
      }
    }
  }

  // 7. Xuất báo cáo Nhật ký Hành vi CSV (UTF-8 BOM)
  const csvRes = await fetch(`${BASE_URL}/api/behavior-logs?format=csv`, {
    headers: { Cookie: adminCookie },
  })
  assert(csvRes.status === 200, `CSV export expected 200, got ${csvRes.status}`)
  const csvBytes = new Uint8Array(await csvRes.arrayBuffer())
  const hasUtf8Bom = csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf
  const csvText = new TextDecoder('utf-8').decode(csvBytes)
  assert(
    hasUtf8Bom && csvText.includes('Mã hành động') && csvText.includes(','),
    'CSV export missing UTF-8 BOM bytes (EF BB BF) or Vietnamese CSV columns'
  )
  console.log(`  ✅ 7/7 Behavior Log CSV Export (UTF-8 BOM EF BB BF, ${csvText.split('\n').length} lines) PASSED`)

  // Đăng xuất các phiên test để bảng phiên sạch gọn
  await fetch(`${BASE_URL}/api/auth`, { method: 'DELETE', headers: { Cookie: cashierCookie } })
  await fetch(`${BASE_URL}/api/auth`, { method: 'DELETE', headers: { Cookie: warehouseCookie } })
  await fetch(`${BASE_URL}/api/auth`, { method: 'DELETE', headers: { Cookie: adminCookie } })

  console.log('\n🎉 ALL 7/7 IAM, RBAC & BEHAVIOR LOG E2E GATES PASSED!\n')
}

main().catch((err) => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err)
  process.exit(1)
})
