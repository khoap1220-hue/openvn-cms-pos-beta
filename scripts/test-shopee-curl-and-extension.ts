/**
 * Kiểm thử đơn vị & tích hợp toàn diện cho tính năng:
 * 1. Bộ phân tích đa định dạng cURL / PowerShell / Fetch / JSON / Cookie (shopee-curl-parser)
 * 2. Bộ đóng gói ZIP & Chrome Extension liên kết riêng của Shop (shopee-extension-bundle)
 * 3. API Route Handlers (/api/channels/shopee-session & /api/channels/shopee-extension)
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  maskSecretValue,
  parseShopeeCurlOrCookieInput,
} from '../src/lib/shopee-curl-parser'
import {
  buildStoreZip,
  generateShopeeExtensionFiles,
} from '../src/lib/shopee-extension-bundle'

async function runUnitTests() {
  console.log('=== [1/3] Unit Tests: shopee-curl-parser ===')

  // 1.1 Chrome Copy as cURL (bash) với -b và URL SPC_CDS
  const bashCurl = `curl 'https://banhang.shopee.vn/api/v2/login/?SPC_CDS=a1b2c3d4-9999-4444-8888-112233445566&SPC_CDS_VER=2' \\
  -H 'accept: application/json' \\
  -b 'SPC_F=f_val; SPC_ST=.live_bash_token_1234567890; SPC_EC=ec_val_987654; csrftoken=csrf_bash_tok_123456' \\
  -H 'x-csrftoken: csrf_header_override_9999'`
  const rBash = parseShopeeCurlOrCookieInput(bashCurl)
  assert.equal(rBash.valid, true)
  assert.equal(rBash.format, 'CURL_BASH')
  assert.equal(rBash.cookies['SPC_ST'], '.live_bash_token_1234567890')
  assert.equal(rBash.spcCds, 'a1b2c3d4-9999-4444-8888-112233445566')
  assert.equal(rBash.csrfToken, 'csrf_header_override_9999')
  assert.ok(!rBash.maskedPreview.some((m) => m.maskedValue.includes('live_bash_token')))

  // 1.2 Bash ANSI-C $'...'
  const ansiCurl = `curl $'https://banhang.shopee.vn/api/v3/mpsku/list/get_product_list?SPC_CDS=cds-ansi-01' -H $'cookie: SPC_SC_SESSION=sc_sess_abcdef123456; SPC_U=197198798'`
  const rAnsi = parseShopeeCurlOrCookieInput(ansiCurl)
  assert.equal(rAnsi.valid, true)
  assert.equal(rAnsi.format, 'CURL_BASH')
  assert.equal(rAnsi.cookies['SPC_SC_SESSION'], 'sc_sess_abcdef123456')
  assert.equal(rAnsi.spcCds, 'cds-ansi-01')

  // 1.3 Windows CMD Copy as cURL (cmd) với ký tự ^ và ^" bên trong giá trị Cookie
  const cmdCurl = [
    'curl "https://banhang.shopee.vn/api/v2/login/?SPC_CDS=cmd-uuid-7788" ^',
    '  -H "accept: application/json" ^',
    '  -b "SPC_EC=^"quoted_ec_token_xyz^"; SPC_ST=.cmd_st_token_998877; csrftoken=cmd_csrf_1122" ^',
    '  -H "x-csrftoken: cmd_csrf_1122"',
  ].join('\r\n')
  const rCmd = parseShopeeCurlOrCookieInput(cmdCurl)
  assert.equal(rCmd.valid, true)
  assert.equal(rCmd.format, 'CURL_CMD')
  assert.equal(rCmd.cookies['SPC_ST'], '.cmd_st_token_998877')
  assert.equal(rCmd.cookies['SPC_EC'], '"quoted_ec_token_xyz"')
  assert.equal(rCmd.spcCds, 'cmd-uuid-7788')

  // 1.4 PowerShell Copy as PowerShell
  const psInput = `$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$session.Cookies.Add((New-Object System.Net.Cookie("SPC_ST", ".ps_token_abcdef99", "/", ".shopee.vn")))
$session.Cookies.Add((New-Object System.Net.Cookie("SPC_CDS", "ps-cds-1234", "/", "banhang.shopee.vn")))
Invoke-WebRequest -UseBasicParsing -Uri "https://banhang.shopee.vn/api/v2/login/" -WebSession $session -Headers @{"X-CSRFToken"="ps_csrf_8888"}`
  const rPs = parseShopeeCurlOrCookieInput(psInput)
  assert.equal(rPs.valid, true)
  assert.equal(rPs.format, 'POWERSHELL')
  assert.equal(rPs.cookies['SPC_ST'], '.ps_token_abcdef99')
  assert.equal(rPs.csrfToken, 'ps_csrf_8888')

  // 1.5 Copy as fetch (JS)
  const fetchInput = `fetch("https://banhang.shopee.vn/api/v2/login/?SPC_CDS=fetch-cds-09", {
    "headers": {
      "cookie": "SPC_ST=.fetch_st_7777; csrftoken=fetch_csrf_3333",
      "x-csrftoken": "fetch_csrf_3333"
    }
  });`
  const rFetch = parseShopeeCurlOrCookieInput(fetchInput)
  assert.equal(rFetch.valid, true)
  assert.equal(rFetch.format, 'FETCH_JS')
  assert.equal(rFetch.cookies['SPC_ST'], '.fetch_st_7777')
  assert.equal(rFetch.spcCds, 'fetch-cds-09')

  // 1.6 JSON Cookie-Editor array
  const jsonInput = JSON.stringify([
    { name: 'SPC_ST', value: '.json_st_445566', domain: '.shopee.vn' },
    { name: 'SPC_CDS', value: 'json-cds-99', domain: 'banhang.shopee.vn' },
    { name: 'ignored_other', value: 'nope', domain: 'example.com' },
  ])
  const rJson = parseShopeeCurlOrCookieInput(jsonInput)
  assert.equal(rJson.valid, true)
  assert.equal(rJson.format, 'COOKIE_JSON')
  assert.equal(rJson.cookieCount, 2)

  // 1.7 Raw Cookie Header
  const rRaw = parseShopeeCurlOrCookieInput('Cookie: SPC_ST=.raw_tok_123456789; SPC_CDS=raw-cds-1')
  assert.equal(rRaw.valid, true)
  assert.equal(rRaw.format, 'COOKIE_HEADER')

  // 1.8 Chặn cookie thiếu khóa phiên & chặn cookie mẫu cũ SPC_U=3813970
  const rMissing = parseShopeeCurlOrCookieInput('Cookie: _ga=GA1.1.123; SPC_F=abc')
  assert.equal(rMissing.valid, false)
  const rMock = parseShopeeCurlOrCookieInput('Cookie: SPC_ST=.mock; SPC_U=3813970')
  assert.equal(rMock.valid, false)

  // 1.9 Masking zero-leak check
  const masked = maskSecretValue('191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955')
  assert.equal(masked, '191a••••4955')

  console.log('  -> PASS: 9/9 kịch bản phân tích cURL/PowerShell/Fetch/JSON/Cookie & che mờ bí mật.')
}

async function runZipBundleTests() {
  console.log('=== [2/3] Unit Tests: shopee-extension-bundle + PKZIP CRC-32 ===')
  const files = generateShopeeExtensionFiles({
    shopId: '197195817',
    username: 'thaimy1605',
    cmsOrigin: 'http://127.0.0.1:3010',
    pairingToken: 'unit_test_token_do_not_commit',
    enforceShopLock: true,
  })
  assert.equal(files.length, 6)
  const shopCfg = JSON.parse(
    String(files.find((f) => f.name === 'shop-config.json')?.content || '{}')
  ) as { shopId: string; username: string; pairingToken: string; enforceShopLock: boolean }
  assert.equal(shopCfg.shopId, '197195817')
  assert.equal(shopCfg.username, 'thaimy1605')
  assert.equal(shopCfg.pairingToken, 'unit_test_token_do_not_commit')
  assert.equal(shopCfg.enforceShopLock, true)

  const zipBytes = buildStoreZip(files)
  assert.equal(zipBytes[0], 0x50) // 'P'
  assert.equal(zipBytes[1], 0x4b) // 'K'
  assert.equal(zipBytes[2], 0x03)
  assert.equal(zipBytes[3], 0x04)

  // Kiểm định tính toàn vẹn PKZIP + CRC-32 bằng trình đọc zipfile chuẩn của Python
  const tmpZip = path.join(os.tmpdir(), `test-openvn-ext-${Date.now()}.zip`)
  fs.writeFileSync(tmpZip, Buffer.from(zipBytes))
  try {
    const pyCheck = execFileSync(
      'python',
      [
        '-c',
        `import sys, zipfile; z = zipfile.ZipFile(sys.argv[1], 'r'); bad = z.testzip(); assert bad is None, f'Bad CRC on {bad}'; names = sorted(z.namelist()); print('ZIP_OK', len(names), ','.join(names))`,
        tmpZip,
      ],
      { encoding: 'utf-8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }
    ).trim()
    assert.ok(pyCheck.startsWith('ZIP_OK 6 '))
    console.log(`  -> PASS: ${pyCheck}`)
  } finally {
    if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip)
  }
}

async function runLiveApiTests(baseUrl: string) {
  console.log(`=== [3/3] Live HTTP Integration Tests (${baseUrl}) ===`)

  // Đăng nhập quản trị viên để lấy phiên hợp lệ
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-run': 'true' },
    body: JSON.stringify({
      username: 'admin',
      password: process.env.CMS_ADMIN_PASSWORD || 'Openvn@2026',
    }),
  })
  const setCookie = loginRes.headers.get('set-cookie') || ''
  const authHeaders: Record<string, string> = {
    'x-test-run': 'true',
  }
  if (setCookie) {
    authHeaders['Cookie'] = setCookie.split(';')[0]
  }

  // 3.1 GET /api/channels/shopee-session
  const statusRes = await fetch(`${baseUrl}/api/channels/shopee-session`, {
    headers: authHeaders,
  })
  assert.equal(statusRes.status, 200, `GET shopee-session trả mã ${statusRes.status}`)
  const statusBody = await statusRes.text()
  const statusJson = JSON.parse(statusBody) as {
    ok: boolean
    extensionInfo?: { shopId: string; username: string }
    cookies?: unknown
  }
  assert.equal(statusJson.ok, true)
  assert.equal(statusJson.extensionInfo?.shopId, '197195817')
  assert.equal(statusJson.extensionInfo?.username, 'thaimy1605')
  assert.equal(statusJson.cookies, undefined, 'Zero-Secret Leak: cấm trả raw cookies qua GET status')

  // 3.2 POST CHECK_SESSION
  const checkRes = await fetch(`${baseUrl}/api/channels/shopee-session`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'CHECK_SESSION' }),
  })
  assert.equal(checkRes.status, 200)

  // 3.3 POST IMPORT_CURL rỗng -> 400 PARSE_INVALID
  const badRes = await fetch(`${baseUrl}/api/channels/shopee-session`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'IMPORT_CURL', rawInput: 'curl https://example.com' }),
  })
  assert.equal(badRes.status, 400)
  const badJson = (await badRes.json()) as { code?: string }
  assert.equal(badJson.code, 'PARSE_INVALID')

  // 3.4 POST IMPORT_CURL với token giả hết hạn -> 400 SESSION_EXPIRED_OR_INVALID
  const expRes = await fetch(`${baseUrl}/api/channels/shopee-session`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'IMPORT_CURL',
      rawInput:
        "curl 'https://banhang.shopee.vn/api/v2/login/?SPC_CDS=11111111-2222-3333-4444-555555555555' -b 'SPC_ST=.expired_invalid_token_xyz; csrftoken=dummycsrf1234'",
    }),
  })
  assert.equal(expRes.status, 400)
  const expJson = (await expRes.json()) as { code?: string }
  assert.equal(expJson.code, 'SESSION_EXPIRED_OR_INVALID')

  // 3.5 GET /api/channels/shopee-extension -> ZIP tải về hợp lệ
  const zipRes = await fetch(`${baseUrl}/api/channels/shopee-extension`, {
    headers: authHeaders,
  })
  assert.equal(zipRes.status, 200)
  assert.ok((zipRes.headers.get('content-type') || '').includes('application/zip'))
  const zipArr = new Uint8Array(await zipRes.arrayBuffer())
  assert.ok(zipArr.byteLength > 2000)
  assert.equal(zipArr[0], 0x50)
  assert.equal(zipArr[1], 0x4b)

  console.log(
    `  -> PASS: Toàn bộ 5 kịch bản HTTP Live (/api/channels/shopee-session & /api/channels/shopee-extension, ZIP=${zipArr.byteLength} bytes).`
  )
}

async function main() {
  await runUnitTests()
  await runZipBundleTests()
  if (process.argv.includes('--live')) {
    const baseUrl = process.env.CMS_BASE_URL || 'http://127.0.0.1:3010'
    await runLiveApiTests(baseUrl)
  }
  console.log('\nALL SHOPEE CURL & EXTENSION TESTS PASSED!')
}

main().catch((err) => {
  console.error('TEST FAILED:', err)
  process.exit(1)
})
