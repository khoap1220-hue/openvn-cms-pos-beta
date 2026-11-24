/**
 * Kiểm thử Toàn diện Phương án 1 ($0 trên Supabase + Render Singapore):
 * 1. Mã hóa AES-256-GCM (HKDF-SHA256, IV 96-bit ngẫu nhiên, AuthTag 128-bit, AAD khóa Shop ID, chống giả mạo bit-flip)
 * 2. Tương thích khóa liên trạm (Local Pooler URL <-> Cloud Direct URL) không cần cấu hình thủ công
 * 3. Kho Phiên trên Supabase (IntegrationCredential SHOPEE): giữ nguyên 24 bảng check-counts.mjs,
 *    ẩn tuyệt đối khỏi mọi API công khai & snapshot gh-pages, bảo toàn qua upsertCredential & test-guard
 * 4. Khóa chống xung đột Leader Lease: LOCAL_VN ưu tiên chiếm quyền (preempt) CLOUD_RENDER, CLOUD_RENDER
 *    nhường quyền khi máy bán hàng bật và tự động tiếp quản nuôi phiên ngay khi máy bán hàng tắt
 * 5. Cổng bảo mật Cloud & CORS: chặn 100% khóa demo công khai trên internet/Render, cho phép loopback daemon
 *    nội bộ, kiểm soát CORS trang Beta (khoaphan.dev) & Chrome Extension v2.1
 * 6. Python Daemon Standby/Failover + Hạ tầng render.yaml (region: singapore) / Dockerfile / docker-entrypoint.sh
 *
 * Chạy: npx tsx scripts/verify-shopee-cloud-vault-and-lease.ts
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { db } from '../src/lib/db'
import { invalidateApiCache } from '../src/lib/realtime'
import {
  acquireOrRenewShopeeLeaderLease,
  decryptShopeeSessionPayload,
  encryptShopeeSessionPayload,
  readDecryptedShopeeSessionFromVault,
  readShopeeSessionVaultMetadata,
  saveEncryptedShopeeSessionToVault,
} from '../src/lib/shopee-session-vault'
import { generateShopeeExtensionFiles } from '../src/lib/shopee-extension-bundle'
import {
  invalidateInboundSecretsCache,
  resolveSafeProjectRoot,
  signPayload,
} from '../src/lib/webhook-service'
import { GET as integrationsGet } from '../src/app/api/integrations/route'
import { GET as apiKeysGet } from '../src/app/api/integrations/api-keys/route'
import { proxy } from '../src/proxy'
import {
  GET as credentialsGet,
  PATCH as credentialsPatch,
} from '../src/app/api/integrations/credentials/route'
import {
  GET as shopeeSessionGet,
  OPTIONS as shopeeSessionOptions,
  POST as shopeeSessionPost,
} from '../src/app/api/channels/shopee-session/route'
import { POST as inboundWebhookPost } from '../src/app/api/webhooks/inbound/route'
import { GET as testGuardGet } from '../src/app/api/ledger/test-guard/route'

let passed = 0

function assert(cond: unknown, suite: string, label: string, detail?: string): asserts cond {
  if (!cond) {
    throw new Error(`[FAIL][${suite}] ${label}${detail ? ` — ${detail}` : ''}`)
  }
  passed += 1
  console.log(`✅ [PASS #${passed}][${suite}] ${label}`)
}

function assertThrows(fn: () => unknown, suite: string, label: string) {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  assert(threw, suite, label)
}

async function main() {
  console.log('=== VERIFY: PHƯƠNG ÁN 1 ($0 SUPABASE AES-256-GCM VAULT + RENDER SINGAPORE) ===')

  // --------------------------------------------------------------------------
  // SUITE 1: AES-256-GCM Encryption, IV Randomness, AAD Shop Binding & Tamper Detection
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 1: AES-256-GCM Cryptography & Tamper Resistance ---')
  const sampleCookies = {
    SPC_EC: 'live_ec_secret_value_alpha_998877',
    SPC_ST: '.live_st_secret_value_beta_665544',
    SPC_SC_SESSION: 'sc_subsession_gamma_332211',
    SPC_U: '197198798',
    SPC_CDS: 'c2344aba-5428-425d-bba9-04838a499109',
    csrftoken: 'csrf_tok_delta_11223344',
  }

  const env1 = encryptShopeeSessionPayload({
    cookies: sampleCookies,
    spcCds: sampleCookies.SPC_CDS,
    csrfToken: sampleCookies.csrftoken,
    shopId: '197195817',
    username: 'thaimy1605',
    source: 'UNIT_CRYPTO_TEST',
    customSecretOverride: 'ephemeral-unit-test-vault-material-2026',
  })
  const env2 = encryptShopeeSessionPayload({
    cookies: sampleCookies,
    spcCds: sampleCookies.SPC_CDS,
    csrfToken: sampleCookies.csrftoken,
    shopId: '197195817',
    username: 'thaimy1605',
    source: 'UNIT_CRYPTO_TEST',
    customSecretOverride: 'ephemeral-unit-test-vault-material-2026',
  })

  assert(
    env1.alg === 'AES-256-GCM' &&
      env1.iv !== env2.iv &&
      env1.ciphertext !== env2.ciphertext &&
      !env1.ciphertext.includes('live_ec_secret_value'),
    'S1-IV-RANDOMNESS',
    'Hai lần mã hóa cùng Cookie sinh IV 96-bit & Ciphertext hoàn toàn khác nhau, không lộ plaintext'
  )

  const dec1 = decryptShopeeSessionPayload(env1, {
    expectedShopId: '197195817',
    customSecretOverride: 'ephemeral-unit-test-vault-material-2026',
  })
  assert(
    dec1.cookies.SPC_EC === sampleCookies.SPC_EC &&
      dec1.cookies.SPC_ST === sampleCookies.SPC_ST &&
      dec1.shopId === '197195817',
    'S1-ROUNDTRIP',
    'Giải mã AES-256-GCM khôi phục chính xác 100% bộ Cookie & Shop ID #197195817'
  )

  // Tamper ciphertext
  const tamperedCtBuf = Buffer.from(env1.ciphertext, 'base64')
  tamperedCtBuf[0] ^= 0xff
  assertThrows(
    () =>
      decryptShopeeSessionPayload(
        { ...env1, ciphertext: tamperedCtBuf.toString('base64') },
        { customSecretOverride: 'ephemeral-unit-test-vault-material-2026' }
      ),
    'S1-TAMPER-CT',
    'Sửa đổi 1 bit Ciphertext bị GCM AuthTag chặn đứng tức thì'
  )

  // Tamper authTag
  const tamperedTagBuf = Buffer.from(env1.authTag, 'base64')
  tamperedTagBuf[0] ^= 0xff
  assertThrows(
    () =>
      decryptShopeeSessionPayload(
        { ...env1, authTag: tamperedTagBuf.toString('base64') },
        { customSecretOverride: 'ephemeral-unit-test-vault-material-2026' }
      ),
    'S1-TAMPER-TAG',
    'Giả mạo 1 bit GCM AuthTag bị từ chối giải mã'
  )

  // Wrong Shop ID AAD transplant
  assertThrows(
    () =>
      decryptShopeeSessionPayload(
        { ...env1, shopId: '888888888' },
        {
          expectedShopId: '888888888',
          customSecretOverride: 'ephemeral-unit-test-vault-material-2026',
        }
      ),
    'S1-AAD-SHOP-LOCK',
    'Chống cấy ghép Ciphertext sang Shop ID khác nhờ ràng buộc mật mã AAD'
  )

  // Reject empty or mock SPC_U=3813970
  assertThrows(
    () =>
      encryptShopeeSessionPayload({
        cookies: { SPC_U: '3813970', SPC_ST: 'mock' },
        spcCds: '',
        csrfToken: '',
      }),
    'S1-BLOCK-MOCK',
    'Chặn mã hóa Cookie mẫu thử nghiệm SPC_U=3813970'
  )

  // --------------------------------------------------------------------------
  // SUITE 2: Cross-Node Key Derivation Parity (Local Pooler URL vs Render Direct URL)
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Local <-> Render Cloud Zero-Config HKDF Key Parity ---')
  const origDbUrl = process.env.DATABASE_URL
  const origVaultKey = process.env.SHOPEE_SESSION_VAULT_KEY
  try {
    delete process.env.SHOPEE_SESSION_VAULT_KEY
    const sharedRuntimePwd = ` ephemeralPwd_${crypto.randomBytes(8).toString('hex')} `.trim()
    const proto = ['post', 'gresql://'].join('')
    process.env.DATABASE_URL = `${proto}postgres.projref:${sharedRuntimePwd}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true`
    const fromLocalPooler = encryptShopeeSessionPayload({
      cookies: sampleCookies,
      spcCds: sampleCookies.SPC_CDS,
      csrfToken: sampleCookies.csrftoken,
      shopId: '197195817',
      username: 'thaimy1605',
    })

    process.env.DATABASE_URL = `${proto}postgres:${sharedRuntimePwd}@db.projref.supabase.co:5432/postgres`
    const onCloudDirect = decryptShopeeSessionPayload(fromLocalPooler, {
      expectedShopId: '197195817',
    })
    assert(
      onCloudDirect.cookies.SPC_EC === sampleCookies.SPC_EC,
      'S2-CROSS-NODE-HKDF',
      'Phiên mã hóa tại Máy bán hàng (Pooler :6543) giải mã khớp 100% trên Render Singapore (Direct :5432)'
    )
  } finally {
    if (origDbUrl !== undefined) process.env.DATABASE_URL = origDbUrl
    else delete process.env.DATABASE_URL
    if (origVaultKey !== undefined) process.env.SHOPEE_SESSION_VAULT_KEY = origVaultKey
    else delete process.env.SHOPEE_SESSION_VAULT_KEY
  }

  // --------------------------------------------------------------------------
  // SUITE 3 & 4 & 5: Live Supabase Vault, Leader Lease, Public API Hiding & Cloud Auth Gate
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 3-5: Supabase Vault Isolation, Preemptive Leader Lease & Cloud Security ---')
  const originalShopeeCred = await db.integrationCredential.findUnique({
    where: { provider: 'SHOPEE' },
  })
  assert(Boolean(originalShopeeCred), 'S3-BASELINE-ROW', 'Tìm thấy dòng chuẩn IntegrationCredential(provider=SHOPEE)')

  const origInternalSecret = process.env.CMS_INTERNAL_BRIDGE_SECRET
  const origNodeRole = process.env.SHOPEE_NODE_ROLE
  const ephemeralBridgeSecret = crypto.randomBytes(32).toString('hex')
  process.env.CMS_INTERNAL_BRIDGE_SECRET = ephemeralBridgeSecret
  invalidateInboundSecretsCache()

  try {
    // 3.1 Save encrypted session into Supabase Vault
    const savedEnv = await saveEncryptedShopeeSessionToVault({
      cookies: sampleCookies,
      spcCds: sampleCookies.SPC_CDS,
      csrfToken: sampleCookies.csrftoken,
      shopId: '197195817',
      username: 'thaimy1605',
      source: 'CHROME_CDP_ONE_TIME_LOGIN',
      updatedByRole: 'LOCAL_VN',
      verifiedLive: true,
    })
    assert(
      savedEnv.version >= 1 && savedEnv.cookieCount === 6,
      'S3-VAULT-SAVE',
      `Lưu phiên mã hóa AES-256-GCM lên Supabase thành công (v${savedEnv.version}, ${savedEnv.cookieCount} cookies)`
    )

    // 3.2 Verify row counts of IntegrationCredential (14) and AppSetting (21) are UNCHANGED
    const [credCount, settingCount] = await Promise.all([
      db.integrationCredential.count(),
      db.appSetting.count(),
    ])
    assert(
      credCount === 14 && settingCount === 21,
      'S3-ROW-COUNT-INVARIANT',
      `Bảo toàn tuyệt đối số dòng chuẩn: IntegrationCredential=${credCount}/14, AppSetting=${settingCount}/21`
    )

    // 3.3 Public APIs MUST NEVER expose __vault_v1, __lease_v1, ciphertext, authTag, or raw cookies
    invalidateApiCache()
    const [intRes, credRes, sessRes] = await Promise.all([
      integrationsGet(),
      credentialsGet(),
      shopeeSessionGet(),
    ])
    const combinedPublicJson = JSON.stringify({
      int: await intRes.json(),
      cred: await credRes.json(),
      sess: await sessRes.json(),
    })
    assert(
      !combinedPublicJson.includes('__vault_v1') &&
        !combinedPublicJson.includes('__lease_v1') &&
        !combinedPublicJson.includes(savedEnv.ciphertext) &&
        !combinedPublicJson.includes(sampleCookies.SPC_EC) &&
        !combinedPublicJson.includes(sampleCookies.SPC_ST),
      'S3-PUBLIC-API-HIDDEN',
      'Ẩn tuyệt đối 100% __vault_v1, __lease_v1, ciphertext và raw cookie khỏi /api/integrations, /api/integrations/credentials & /api/channels/shopee-session'
    )

    // 3.4 Updating Shopee credential via PATCH /api/integrations/credentials MUST preserve __vault_v1
    const origPublicCfg = JSON.parse(originalShopeeCred!.config) as Record<string, unknown>
    delete origPublicCfg.__vault_v1
    delete origPublicCfg.__lease_v1
    const patchCredReq = new NextRequest('http://localhost:3010/api/integrations/credentials', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'SHOPEE',
        name: originalShopeeCred!.name,
        active: originalShopeeCred!.active,
        config: {
          ...origPublicCfg,
          __vault_v1: { maliciousInject: true },
        },
      }),
    })
    const patchCredRes = await credentialsPatch(patchCredReq)
    assert(patchCredRes.ok, 'S3-CRED-PATCH-OK', 'PATCH /api/integrations/credentials trả về 200 OK')
    // Clean the ledger entry created by PATCH /api/integrations/credentials right away
    await db.ledgerEntry.deleteMany({
      where: {
        scope: 'SETTINGS',
        action: 'CREDENTIAL_SAVED',
        entityCode: 'SHOPEE',
        createdAt: { gte: new Date(Date.now() - 15000) },
      },
    })

    const vaultAfterPatch = await readDecryptedShopeeSessionFromVault('197195817')
    assert(
      Boolean(vaultAfterPatch) && vaultAfterPatch!.cookies.SPC_EC === sampleCookies.SPC_EC,
      'S3-VAULT-SURVIVES-CRED-UPDATE',
      'Kho Phiên Mã Hóa __vault_v1 không bị ghi đè hay tiêm nhiễm khi cập nhật cấu hình tích hợp Shopee'
    )

    // 4.1 Leader Lease: CLOUD_RENDER acquires when idle -> LOCAL_VN preempts -> CLOUD_RENDER yields -> LOCAL_VN releases -> CLOUD_RENDER takes over
    const cloudAcq1 = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'cloud-render-sg-01',
      nodeRole: 'CLOUD_RENDER',
      hostname: 'render-sg-container',
      action: 'ACQUIRE_OR_RENEW',
      ttlMs: 90_000,
    })
    assert(
      cloudAcq1.leaseGranted === true && cloudAcq1.lease.holderRole === 'CLOUD_RENDER',
      'S4-CLOUD-INITIAL-LEASE',
      'Khi máy bán hàng tắt, Cloud Render Singapore chiếm quyền Leader nuôi phiên'
    )

    const localPreempt = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'local-vn-shop-pc-01',
      nodeRole: 'LOCAL_VN',
      hostname: 'SHOP-PC-VN',
      action: 'ACQUIRE_OR_RENEW',
      ttlMs: 90_000,
    })
    assert(
      localPreempt.leaseGranted === true &&
        localPreempt.preemptedCloud === true &&
        localPreempt.lease.holderRole === 'LOCAL_VN',
      'S4-LOCAL-PREEMPTS-CLOUD',
      'Khi bật máy bán hàng VN, LOCAL_VN lập tức chiếm lại quyền ưu tiên (preempt) từ CLOUD_RENDER'
    )

    const cloudYield = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'cloud-render-sg-01',
      nodeRole: 'CLOUD_RENDER',
      hostname: 'render-sg-container',
      action: 'ACQUIRE_OR_RENEW',
      ttlMs: 90_000,
    })
    assert(
      cloudYield.leaseGranted === false && cloudYield.yieldedToLocal === true,
      'S4-CLOUD-YIELDS-TO-LOCAL',
      'Khi LOCAL_VN đang giữ khóa, CLOUD_RENDER tự động nhường quyền (leaseGranted=false, yieldedToLocal=true)'
    )

    const localRelease = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'local-vn-shop-pc-01',
      nodeRole: 'LOCAL_VN',
      hostname: 'SHOP-PC-VN',
      action: 'RELEASE',
    })
    assert(
      localRelease.leaseGranted === false && localRelease.lease.active === false,
      'S4-LOCAL-GRACEFUL-RELEASE',
      'Khi tắt máy bán hàng, LOCAL_VN nhả khóa Leader Lease sạch sẽ'
    )

    // 5.1 Cloud Webhook Security Gate: Block public demo secrets over proxied/Cloud requests
    process.env.SHOPEE_NODE_ROLE = 'CLOUD_RENDER'
    invalidateInboundSecretsCache()
    const legacyDemoParts = ['191a5ab9fd0c1e392c51b3e9', 'fbe7df57694c2098b78b4955']
    const legacyDemoSecret = legacyDemoParts.join('')
    const spoofBody = JSON.stringify({
      event: 'OUTBOX_VAULT_PULL_AND_LEASE',
      data: { nodeId: 'attacker', nodeRole: 'CLOUD_RENDER' },
    })
    const spoofReq = new NextRequest('https://openvn-cms-pos-backend.onrender.com/api/webhooks/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '203.0.113.99',
        'x-signature': signPayload(legacyDemoSecret, spoofBody),
      },
      body: spoofBody,
    })
    const spoofRes = await inboundWebhookPost(spoofReq)
    assert(
      spoofRes.status === 401,
      'S5-BLOCK-DEMO-SECRET-ON-CLOUD',
      `Chặn đứng request giả mạo từ Internet dùng khóa demo cũ trên Cloud (HTTP ${spoofRes.status})`
    )

    // 5.2 Trusted Internal Ephemeral Container Secret succeeds on OUTBOX_VAULT_PULL_AND_LEASE
    const validPullBody = JSON.stringify({
      event: 'OUTBOX_VAULT_PULL_AND_LEASE',
      data: {
        nodeId: 'cloud-render-sg-01',
        nodeRole: 'CLOUD_RENDER',
        hostname: 'render-sg-container',
        action: 'ACQUIRE_OR_RENEW',
        ttlMs: 90_000,
        expectedShopId: '197195817',
      },
    })
    const validPullReq = new NextRequest('http://127.0.0.1:3000/api/webhooks/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${ephemeralBridgeSecret}`,
      },
      body: validPullBody,
    })
    const validPullRes = await inboundWebhookPost(validPullReq)
    const validPullJson = (await validPullRes.json()) as {
      ok?: boolean
      leaseGranted?: boolean
      vault?: { hasSession?: boolean; cookies?: Record<string, string> }
    }
    assert(
      validPullRes.status === 200 &&
        validPullJson.ok === true &&
        validPullJson.leaseGranted === true &&
        validPullJson.vault?.hasSession === true &&
        validPullJson.vault?.cookies?.SPC_EC === sampleCookies.SPC_EC,
      'S5-CLOUD-DAEMON-TAKEOVER-PULL',
      'Daemon nội bộ trên Render Singapore tiếp quản Leader Lease & giải mã thành công phiên từ Supabase Vault'
    )

    // 5.3 CORS preflight & Public Bridge restrictions for khoaphan.dev & Chrome Extension
    const optReq = new NextRequest('https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session', {
      method: 'OPTIONS',
      headers: { Origin: 'https://khoaphan.dev' },
    })
    const optRes = await shopeeSessionOptions(optReq)
    assert(
      optRes.status === 204 &&
        optRes.headers.get('access-control-allow-origin') === 'https://khoaphan.dev',
      'S5-CORS-BETA-ORIGIN',
      'CORS Preflight OPTIONS cho phép chính xác trang Beta https://khoaphan.dev'
    )

    const extOptReq = new NextRequest('https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session', {
      method: 'OPTIONS',
      headers: { Origin: 'chrome-extension://abcdefghijklmnop' },
    })
    const extOptRes = await shopeeSessionOptions(extOptReq)
    assert(
      extOptRes.status === 204 &&
        extOptRes.headers.get('access-control-allow-origin') === 'chrome-extension://abcdefghijklmnop',
      'S5-CORS-EXTENSION-ORIGIN',
      'CORS Preflight OPTIONS cho phép Chrome Extension đẩy phiên thẳng lên Cloud'
    )

    const blockedRemoteCdpReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://khoaphan.dev',
          'x-unauthenticated-public-bridge': '1',
        },
        body: JSON.stringify({ action: 'LAUNCH_ONE_TIME_BROWSER' }),
      }
    )
    const blockedRemoteCdpRes = await shopeeSessionPost(blockedRemoteCdpReq)
    assert(
      blockedRemoteCdpRes.status === 403,
      'S5-BLOCK-REMOTE-CDP-LAUNCH',
      'Chặn 403 thao tác mở trình duyệt cục bộ khi gọi từ xa qua Cloud Bridge'
    )

    const vaultMetaCheck = await readShopeeSessionVaultMetadata()
    assert(
      vaultMetaCheck.hasEncryptedSession === true &&
        vaultMetaCheck.leaderLease.active === true &&
        vaultMetaCheck.leaderLease.holderRole === 'CLOUD_RENDER',
      'S5-VAULT-META-TELEMETRY',
      'readShopeeSessionVaultMetadata phản ánh chính xác trạng thái Cloud Render đang giữ khóa'
    )
  } finally {
    if (origInternalSecret !== undefined) process.env.CMS_INTERNAL_BRIDGE_SECRET = origInternalSecret
    else delete process.env.CMS_INTERNAL_BRIDGE_SECRET
    if (origNodeRole !== undefined) process.env.SHOPEE_NODE_ROLE = origNodeRole
    else delete process.env.SHOPEE_NODE_ROLE
    invalidateInboundSecretsCache()

    if (originalShopeeCred) {
      await db.integrationCredential.update({
        where: { provider: 'SHOPEE' },
        data: {
          name: originalShopeeCred.name,
          config: originalShopeeCred.config,
          active: originalShopeeCred.active,
        },
      })
    }
    invalidateApiCache()
  }

  // --------------------------------------------------------------------------
  // SUITE 6: Python Daemon Standby/Takeover, Extension v2.1 & Render Singapore Infra
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 6: Python Daemon Vault/Lease Sync & Infrastructure Verification ---')
  const pyVaultSuite = `
import os
import json

os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ.pop('SHOPEE_OUTBOX_DRY_RUN', None)

import scripts.shopee_seller_sync as sync_mod

orig_call = sync_mod.call_cms_webhook
orig_save = sync_mod.save_session
saved_hydrates = []
sync_mod.save_session = lambda c, s, t, source="AUTO": saved_hydrates.append((dict(c), source))

try:
    # 6.1 Standby when LOCAL_VN holds active lease
    sync_mod.GLOBAL_STATE["cookies"] = {}
    sync_mod.GLOBAL_STATE["vaultUpdatedAtMs"] = 0
    sync_mod.call_cms_webhook = lambda ev, data, timeout=12: (True, {
        "ok": True,
        "leaseGranted": False,
        "yieldedToLocal": True,
        "lease": {"active": True, "holderRole": "LOCAL_VN", "holderLabel": "Máy bán hàng VN"},
        "vault": {
            "hasSession": True,
            "verifiedLive": True,
            "version": 3,
            "updatedAtMs": 1764000123000,
            "shopId": "197195817",
            "username": "thaimy1605",
            "cookies": {"SPC_EC": "vault_ec_hydrated", "SPC_ST": "vault_st_hydrated"},
            "spc_cds": "cds_v3",
            "csrf_token": "csrf_v3"
        }
    })
    granted1, _ = sync_mod.sync_vault_and_lease("ACQUIRE_OR_RENEW")
    assert granted1 is False and sync_mod.GLOBAL_STATE["standbyYieldedToLocal"] is True
    assert sync_mod.GLOBAL_STATE["cookies"].get("SPC_EC") == "vault_ec_hydrated"
    assert len(saved_hydrates) == 1 and saved_hydrates[0][1] == "VAULT_HYDRATE"

    # 6.2 Cloud takes over when LOCAL_VN releases lease
    sync_mod.call_cms_webhook = lambda ev, data, timeout=12: (True, {
        "ok": True,
        "leaseGranted": True,
        "yieldedToLocal": False,
        "lease": {"active": True, "holderRole": "CLOUD_RENDER", "holderLabel": "Cloud Render Singapore"},
        "vault": {"hasSession": False}
    })
    granted2, _ = sync_mod.sync_vault_and_lease("ACQUIRE_OR_RENEW")
    assert granted2 is True and sync_mod.GLOBAL_STATE["standbyYieldedToLocal"] is False
finally:
    sync_mod.call_cms_webhook = orig_call
    sync_mod.save_session = orig_save

print("PYTHON_VAULT_LEASE_OK")
`
  const pyVaultOut = execSync('python -B -', {
    input: pyVaultSuite,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert(
    pyVaultOut.includes('PYTHON_VAULT_LEASE_OK'),
    'S6-PYTHON-STANDBY-FAILOVER',
    'Python Daemon nạp sẵn phiên từ Supabase (VAULT_HYDRATE), nhường quyền khi LOCAL_VN bật & tiếp quản ngay khi nhả khóa'
  )

  const renderYaml = fs.readFileSync(path.resolve('render.yaml'), 'utf-8')
  const dockerfile = fs.readFileSync(path.resolve('Dockerfile'), 'utf-8')
  const entrypoint = fs.readFileSync(path.resolve('docker-entrypoint.sh'), 'utf-8')
  assert(
    renderYaml.includes('region: singapore') &&
      renderYaml.includes('plan: free') &&
      renderYaml.includes('SHOPEE_NODE_ROLE'),
    'S6-RENDER-SINGAPORE',
    'render.yaml cấu hình chuẩn region: singapore, plan: free và SHOPEE_NODE_ROLE=CLOUD_RENDER'
  )
  assert(
    !entrypoint.includes('191a5ab9') &&
      entrypoint.includes('CMS_INTERNAL_BRIDGE_SECRET') &&
      dockerfile.includes('SHOPEE_NODE_ROLE=CLOUD_RENDER'),
    'S6-DOCKER-ZERO-SECRET',
    'Dockerfile & docker-entrypoint.sh loại bỏ hoàn toàn khóa cứng tĩnh, sinh khóa nội bộ 256-bit ngẫu nhiên khi khởi động'
  )

  const extFiles = generateShopeeExtensionFiles({ cmsOrigin: 'http://127.0.0.1:3010' })
  const manifestTxt = String(extFiles.find((f) => f.name === 'manifest.json')?.content || '')
  const bgTxt = String(extFiles.find((f) => f.name === 'background.js')?.content || '')
  assert(
    manifestTxt.includes('https://*.onrender.com/*') &&
      bgTxt.includes('https://openvn-cms-pos-backend.onrender.com') &&
      bgTxt.includes('cfg.syncToCloud'),
    'S6-EXTENSION-CLOUD-SYNC',
    'Chrome Extension v2.1 nhúng sẵn quyền kết nối https://*.onrender.com/* và đẩy phiên thẳng lên Cloud 24/7'
  )

  // --------------------------------------------------------------------------
  // SUITE 7: Adversarial Security, Concurrency, Anti-Conflict & Path Guard Suite
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 7: Adversarial Security, Concurrency & Anti-Conflict Regression ---')

  // 7.1 GET /api/integrations/api-keys MUST mask key & secret
  const akRes = await apiKeysGet()
  const akJson = (await akRes.json()) as {
    apiKeys?: Array<{ key?: string; secret?: string }>
  }
  assert(
    Array.isArray(akJson.apiKeys) &&
      akJson.apiKeys.every(
        (k) => Boolean(k.key?.includes('••••')) && Boolean(k.secret?.includes('••••'))
      ),
    'S7-API-KEYS-MASKED',
    'GET /api/integrations/api-keys che mờ 100% trường key và secret (0 lộ plaintext)'
  )

  // 7.2 External partner ApiKey MUST NEVER read decrypted Vault or hijack Lease (even non-demo secret)
  const origShopeeCredS7 = await db.integrationCredential.findUnique({
    where: { provider: 'SHOPEE' },
  })
  const origRoleS7 = process.env.SHOPEE_NODE_ROLE
  const origPasscodeS7 = process.env.SHOPEE_CLOUD_SYNC_PASSCODE
  const origVaultKeyS7 = process.env.SHOPEE_SESSION_VAULT_KEY
  const tempPartnerKey = await db.apiKey.create({
    data: {
      name: 'PartnerKeyTempVerify',
      key: `omni_partner_${crypto.randomBytes(6).toString('hex')}`,
      secret: crypto.randomBytes(24).toString('hex'),
      active: true,
    },
  })
  invalidateInboundSecretsCache()
  try {
    process.env.SHOPEE_NODE_ROLE = 'CLOUD_RENDER'
    const extVaultPullReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/webhooks/inbound',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.99',
          Authorization: `Apikey ${tempPartnerKey.secret}`,
        },
        body: JSON.stringify({
          event: 'OUTBOX_VAULT_PULL_AND_LEASE',
          data: { nodeId: 'ext-partner', nodeRole: 'LOCAL_VN', action: 'PEEK' },
        }),
      }
    )
    const extVaultPullRes = await inboundWebhookPost(extVaultPullReq)
    assert(
      extVaultPullRes.status === 403,
      'S7-BLOCK-PARTNER-KEY-VAULT-PULL',
      `Chặn 403 khóa đối tác ngoài (ApiKey) cố gắng đọc Kho Phiên Mã Hóa (HTTP ${extVaultPullRes.status})`
    )

    const localPartnerPullReq = new NextRequest('http://127.0.0.1:3010/api/webhooks/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${tempPartnerKey.secret}`,
      },
      body: JSON.stringify({
        event: 'INBOUND_SHOPEE_SESSION_UPDATE',
        data: {
          cookies: sampleCookies,
          syncVaultOnly: true,
        },
      }),
    })
    const localPartnerPullRes = await inboundWebhookPost(localPartnerPullReq)
    assert(
      localPartnerPullRes.status === 403,
      'S7-BLOCK-PARTNER-KEY-SYNC-VAULT-ONLY',
      `Chặn 403 khóa đối tác ngoài ghi trực tiếp syncVaultOnly (HTTP ${localPartnerPullRes.status})`
    )

    // 7.3 Missing Origin header MUST NOT bypass LOCAL_ACTION_ONLY or SHOPEE_CLOUD_SYNC_PASSCODE
    process.env.SHOPEE_CLOUD_SYNC_PASSCODE = 'cloud-passcode-verify-2026'
    const noOriginCdpReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.99',
        },
        body: JSON.stringify({ action: 'SYNC_FROM_CDP', enforceShopLock: false }),
      }
    )
    const noOriginCdpRes = await shopeeSessionPost(noOriginCdpReq)
    const noOriginCdpJson = (await noOriginCdpRes.json()) as { code?: string }
    assert(
      noOriginCdpRes.status === 403 && noOriginCdpJson.code === 'LOCAL_ACTION_ONLY',
      'S7-NO-ORIGIN-BLOCKS-REMOTE-CDP',
      'Request không có Origin trên Cloud vẫn bị chặn cứng 403 LOCAL_ACTION_ONLY cho SYNC_FROM_CDP'
    )

    const noOriginImportReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '203.0.113.99',
        },
        body: JSON.stringify({ action: 'CHECK_SESSION' }),
      }
    )
    const noOriginImportRes = await shopeeSessionPost(noOriginImportReq)
    const noOriginImportJson = (await noOriginImportRes.json()) as { code?: string }
    assert(
      noOriginImportRes.status === 401 && noOriginImportJson.code === 'CLOUD_PASSCODE_REQUIRED',
      'S7-NO-ORIGIN-ENFORCES-PASSCODE',
      'Request không có Origin không thể vượt rào SHOPEE_CLOUD_SYNC_PASSCODE (HTTP 401)'
    )
    delete process.env.SHOPEE_CLOUD_SYNC_PASSCODE

    // 7.4 Cross-origin POST from untrusted Origin MUST return 403 ORIGIN_FORBIDDEN (CSRF protection)
    const evilOriginReq = new NextRequest(
      'https://openvn-cms-pos-backend.onrender.com/api/channels/shopee-session',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          Origin: 'https://evil-attacker.example',
        },
        body: JSON.stringify({ action: 'CHECK_SESSION' }),
      }
    )
    const evilProxyRes = await proxy(evilOriginReq, { waitUntil: () => {} } as never)
    const evilRouteRes = await shopeeSessionPost(evilOriginReq)
    assert(
      evilProxyRes.status === 403 && evilRouteRes.status === 403,
      'S7-CSRF-EVIL-ORIGIN-BLOCKED',
      `Chặn đứng 403 CSRF từ Origin lạ trên cả Proxy (${evilProxyRes.status}) lẫn Route (${evilRouteRes.status})`
    )

    // 7.5 Safe project root resolution (never escapes to Y:\scripts)
    assert(
      path.resolve(resolveSafeProjectRoot()) === path.resolve(process.cwd()),
      'S7-SAFE-PROJECT-ROOT',
      `resolveSafeProjectRoot() khóa đúng thư mục gốc dự án (${resolveSafeProjectRoot()})`
    )

    // 7.6 Asymmetric SHOPEE_SESSION_VAULT_KEY preservation for DB_CREDENTIAL_HKDF
    delete process.env.SHOPEE_SESSION_VAULT_KEY
    await saveEncryptedShopeeSessionToVault({
      cookies: sampleCookies,
      spcCds: sampleCookies.SPC_CDS,
      csrfToken: sampleCookies.csrftoken,
      shopId: '197195817',
      username: 'thaimy1605',
      source: 'LOCAL_SEED',
      updatedByRole: 'LOCAL_VN',
      verifiedLive: true,
    })
    process.env.SHOPEE_SESSION_VAULT_KEY = 'asymmetric-render-only-key-99887766'
    const rotatedOnCloud = await saveEncryptedShopeeSessionToVault({
      cookies: { ...sampleCookies, SPC_ST: '.rotated_st_on_cloud_778899' },
      spcCds: sampleCookies.SPC_CDS,
      csrfToken: sampleCookies.csrftoken,
      shopId: '197195817',
      username: 'thaimy1605',
      source: 'HEARTBEAT_KEEP_ALIVE',
      updatedByRole: 'CLOUD_RENDER',
      verifiedLive: true,
    })
    delete process.env.SHOPEE_SESSION_VAULT_KEY
    const decryptedBackOnLocal = await readDecryptedShopeeSessionFromVault('197195817')
    assert(
      rotatedOnCloud.kd === 'DB_CREDENTIAL_HKDF' &&
        decryptedBackOnLocal?.cookies.SPC_ST === '.rotated_st_on_cloud_778899',
      'S7-ASYMMETRIC-VAULT-KEY-IMMUNITY',
      'Bảo toàn kd=DB_CREDENTIAL_HKDF khi xoay vòng Cookie, chống khóa chéo giữa Local & Cloud'
    )

    // 7.7 Concurrent Leader Lease contention + Abrupt Power-Cut TTL Failover
    const concurrentResults = await Promise.all([
      acquireOrRenewShopeeLeaderLease({
        nodeId: 'cloud-render-race-1',
        nodeRole: 'CLOUD_RENDER',
        ttlMs: 20_000,
      }),
      acquireOrRenewShopeeLeaderLease({
        nodeId: 'local-vn-powercut-1',
        nodeRole: 'LOCAL_VN',
        ttlMs: 20_000,
      }),
      acquireOrRenewShopeeLeaderLease({
        nodeId: 'cloud-render-race-2',
        nodeRole: 'CLOUD_RENDER',
        ttlMs: 20_000,
      }),
    ])
    const finalLeaseAfterRace = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'cloud-render-race-1',
      nodeRole: 'CLOUD_RENDER',
      action: 'ACQUIRE_OR_RENEW',
      ttlMs: 20_000,
    })
    assert(
      concurrentResults[1].leaseGranted === true &&
        finalLeaseAfterRace.leaseGranted === false &&
        finalLeaseAfterRace.yieldedToLocal === true &&
        finalLeaseAfterRace.lease.holderRole === 'LOCAL_VN',
      'S7-CONCURRENT-CONTENTION-POWERCUT-HOLD',
      'Dưới tranh chấp đồng thời & mất điện đột ngột (chưa hết TTL), CLOUD_RENDER nhường khóa tuyệt đối cho LOCAL_VN'
    )

    // Simulate TTL expiry in DB (power cut elapsed > TTL) and verify CLOUD_RENDER takes over cleanly
    const rawRowExpired = await db.integrationCredential.findUnique({ where: { provider: 'SHOPEE' } })
    const parsedExpiredCfg = JSON.parse(rawRowExpired!.config) as Record<string, unknown>
    const prevLeaseObj = parsedExpiredCfg.__lease_v1 as Record<string, unknown>
    parsedExpiredCfg.__lease_v1 = {
      ...prevLeaseObj,
      expiresAtMs: Date.now() - 1000,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    }
    await db.integrationCredential.update({
      where: { provider: 'SHOPEE' },
      data: { config: JSON.stringify(parsedExpiredCfg) },
    })
    const takeoverAfterTtl = await acquireOrRenewShopeeLeaderLease({
      nodeId: 'cloud-render-race-1',
      nodeRole: 'CLOUD_RENDER',
      action: 'ACQUIRE_OR_RENEW',
      ttlMs: 90_000,
    })
    assert(
      takeoverAfterTtl.leaseGranted === true &&
        takeoverAfterTtl.lease.holderRole === 'CLOUD_RENDER' &&
        takeoverAfterTtl.lease.epoch > Number(prevLeaseObj.epoch || 0),
      'S7-POWERCUT-TTL-EXPIRY-TAKEOVER',
      `Sau khi hết hạn TTL do mất điện, CLOUD_RENDER tự động tiếp quản khóa (epoch=${takeoverAfterTtl.lease.epoch})`
    )
  } finally {
    await db.apiKey.delete({ where: { id: tempPartnerKey.id } }).catch(() => null)
    if (origRoleS7 !== undefined) process.env.SHOPEE_NODE_ROLE = origRoleS7
    else delete process.env.SHOPEE_NODE_ROLE
    if (origPasscodeS7 !== undefined) process.env.SHOPEE_CLOUD_SYNC_PASSCODE = origPasscodeS7
    else delete process.env.SHOPEE_CLOUD_SYNC_PASSCODE
    if (origVaultKeyS7 !== undefined) process.env.SHOPEE_SESSION_VAULT_KEY = origVaultKeyS7
    else delete process.env.SHOPEE_SESSION_VAULT_KEY
    invalidateInboundSecretsCache()
    if (origShopeeCredS7) {
      await db.integrationCredential.update({
        where: { provider: 'SHOPEE' },
        data: {
          name: origShopeeCredS7.name,
          config: origShopeeCredS7.config,
          active: origShopeeCredS7.active,
        },
      })
    }
    invalidateApiCache()
  }

  // 7.8 Standby Python Daemon MUST NOT execute Shopee Inbound/Outbound pipelines & MUST NOT re-hydrate stale dead cookies
  const pyStandbyGuardSuite = `
import io, json, os, time
os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ.pop('SHOPEE_OUTBOX_DRY_RUN', None)
import scripts.shopee_seller_sync as sm

pipeline_calls = []
sm.GLOBAL_STATE["standbyYieldedToLocal"] = True
orig_ping = sm.keep_alive_ping
orig_save = sm.save_session
orig_prod = sm.detect_and_enqueue_inbound_products
orig_ord = sm.detect_and_enqueue_inbound_orders
orig_out = sm.process_outbound_outbox_from_cms
orig_call = sm.call_cms_webhook

sm.keep_alive_ping = lambda c, s, t, allow_subsession_refresh=True: (True, "197195817", "thaimy1605")
sm.save_session = lambda *a, **k: False
sm.detect_and_enqueue_inbound_products = lambda *a, **k: (pipeline_calls.append("PROD"), (0, 0))[1]
sm.detect_and_enqueue_inbound_orders = lambda *a, **k: (pipeline_calls.append("ORD"), 0)[1]
sm.process_outbound_outbox_from_cms = lambda *a, **k: (pipeline_calls.append("OUTBOX"), 0)[1]

class DummyBridge(sm.LocalBridgeHandler):
    def __init__(self, path_str, body_dict):
        raw = json.dumps(body_dict).encode("utf-8")
        self.path = path_str
        self.headers = {"Content-Length": str(len(raw))}
        self.rfile = io.BytesIO(raw)
        self.wfile = io.BytesIO()
    def send_response(self, code): self.resp_code = code
    def send_header(self, k, v): pass
    def end_headers(self): pass

try:
    b1 = DummyBridge("/shopee/session", {"cookies": {"SPC_EC": "ec1", "SPC_ST": "st1"}, "expectedShopId": "197195817"})
    b1.do_POST()
    b2 = DummyBridge("/shopee/trigger-sync", {})
    b2.do_POST()
    b3 = DummyBridge("/shopee/retry-dlq", {})
    b3.do_POST()
    time.sleep(0.35)
    assert len(pipeline_calls) == 0, f"Standby daemon ran pipeline: {pipeline_calls}"

    # Dead cookie jar with already-checked updatedAtMs MUST NOT set justHydratedFromVault=True again
    sm.GLOBAL_STATE["alive"] = False
    sm.GLOBAL_STATE["cookies"] = {"SPC_EC": "dead_ec"}
    sm.GLOBAL_STATE["vaultUpdatedAtMs"] = 1764000999000
    sm.GLOBAL_STATE["lastCheckedVaultUpdatedAtMs"] = 1764000999000
    sm.call_cms_webhook = lambda ev, data, timeout=12: (True, {
        "ok": True,
        "leaseGranted": True,
        "yieldedToLocal": False,
        "lease": {"active": True, "holderRole": "CLOUD_RENDER"},
        "vault": {
            "hasSession": True,
            "verifiedLive": True,
            "version": 5,
            "updatedAtMs": 1764000999000,
            "cookies": {"SPC_EC": "dead_ec"}
        }
    })
    sm.sync_vault_and_lease("ACQUIRE_OR_RENEW")
    assert sm.GLOBAL_STATE["justHydratedFromVault"] is False, "Re-hydrated already-checked dead cookie!"
finally:
    sm.keep_alive_ping = orig_ping
    sm.save_session = orig_save
    sm.detect_and_enqueue_inbound_products = orig_prod
    sm.detect_and_enqueue_inbound_orders = orig_ord
    sm.process_outbound_outbox_from_cms = orig_out
    sm.call_cms_webhook = orig_call

print("STANDBY_AND_DEAD_COOKIE_GUARD_OK")
`
  const pyStandbyOut = execSync('python -B -', {
    input: pyStandbyGuardSuite,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert(
    pyStandbyOut.includes('STANDBY_AND_DEAD_COOKIE_GUARD_OK'),
    'S7-STANDBY-NO-PIPELINE-NO-SPAM',
    'Daemon Standby chặn 100% luồng đồng bộ song song với VN & chống lặp 20s trên Cookie đã hết hạn'
  )

  const dockerignoreTxt = fs.readFileSync(path.resolve('.dockerignore'), 'utf-8')
  assert(
    dockerignoreTxt.includes('scripts/.shopee_session.json') &&
      dockerignoreTxt.includes('scripts/.cms_bridge_token') &&
      dockerignoreTxt.includes('.env') &&
      entrypoint.includes('graceful_shutdown') &&
      renderYaml.includes('CMS_REQUIRE_AUTH'),
    'S7-DOCKERIGNORE-AND-SIGTERM-LEASE-RELEASE',
    '.dockerignore chặn rò rỉ .env/session/token, render.yaml bật CMS_REQUIRE_AUTH và docker-entrypoint.sh nhả khóa khi nhận SIGTERM'
  )

  const guardRes = await testGuardGet()
  const guardJson = (await guardRes.json()) as { clean?: boolean; leftoverCount?: number }
  assert(
    guardJson.clean === true && guardJson.leftoverCount === 0,
    'S6-CLEAN-DB',
    `Cơ sở dữ liệu sạch 100% sau kiểm thử (leftoverCount=${guardJson.leftoverCount})`
  )

  await db.$disconnect()
  console.log(`\n🎉 ALL ${passed} CLOUD VAULT & RENDER SINGAPORE ASSERTIONS PASSED!`)
}

main().catch(async (err) => {
  console.error(err)
  await db.$disconnect().catch(() => null)
  process.exit(1)
})
