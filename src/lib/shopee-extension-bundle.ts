/**
 * Bộ đóng gói Chrome Extension (Manifest V3) liên kết riêng cho từng Shop Shopee
 * của hệ thống OPENVN · Ưu Đàm Suite.
 *
 * Hỗ trợ chạy đồng nhất trên cả Server Node.js (/api/channels/shopee-extension)
 * và trình duyệt Client (Fallback tải trực tiếp trên bản Beta tĩnh) không cần thư viện nén ngoài.
 */

export interface ShopeeExtensionShopConfig {
  shopId: string
  username: string
  shopLabel: string
  cmsOrigin: string
  bridgePort: number
  pairingToken: string
  enforceShopLock: boolean
  generatedAt: string
}

export interface ZipEntryFile {
  name: string
  content: string | Uint8Array
}

export const DEFAULT_SHOPEE_SHOP_BINDING = {
  shopId: '197195817',
  username: 'thaimy1605',
  shopLabel: 'OPENVN · Ưu Đàm (thaimy1605)',
  bridgePort: 51898,
} as const

// Bảng tra cứu CRC-32 chuẩn IEEE 802.3 (0xEDB88320)
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

export function computeCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function getDosDateTime(date = new Date()): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, date.getFullYear())
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hours = date.getHours()
  const minutes = date.getMinutes()
  const seconds = Math.floor(date.getSeconds() / 2)

  const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f)
  const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f)
  return { dosTime, dosDate }
}

/**
 * Tạo gói .zip chuẩn PKZIP (phương thức STORE = 0, cờ UTF-8 0x0800) hoàn toàn bằng Uint8Array.
 * Tương thích 100% với Windows Explorer Extract All, PowerShell Expand-Archive, macOS và 7-Zip.
 */
export function buildStoreZip(files: ZipEntryFile[], timestamp = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { dosTime, dosDate } = getDosDateTime(timestamp)

  const prepared = files.map((file) => {
    const cleanName = file.name.replace(/^\/+/, '').replace(/\\/g, '/')
    const nameBytes = encoder.encode(cleanName)
    const dataBytes =
      typeof file.content === 'string' ? encoder.encode(file.content) : file.content
    const crc = computeCrc32(dataBytes)
    return { nameBytes, dataBytes, crc }
  })

  let localTotalBytes = 0
  let centralTotalBytes = 0
  for (const item of prepared) {
    localTotalBytes += 30 + item.nameBytes.length + item.dataBytes.length
    centralTotalBytes += 46 + item.nameBytes.length
  }

  const totalSize = localTotalBytes + centralTotalBytes + 22
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  let offset = 0
  const localOffsets: number[] = []

  // 1. Ghi các Local File Header + Nội dung file
  for (const item of prepared) {
    localOffsets.push(offset)
    view.setUint32(offset, 0x04034b50, true) // Local file header signature
    view.setUint16(offset + 4, 20, true) // Version needed (2.0)
    view.setUint16(offset + 6, 0x0800, true) // General purpose bit flag (UTF-8)
    view.setUint16(offset + 8, 0, true) // Compression method: 0 (STORE)
    view.setUint16(offset + 10, dosTime, true)
    view.setUint16(offset + 12, dosDate, true)
    view.setUint32(offset + 14, item.crc, true)
    view.setUint32(offset + 18, item.dataBytes.length, true) // Compressed size
    view.setUint32(offset + 22, item.dataBytes.length, true) // Uncompressed size
    view.setUint16(offset + 26, item.nameBytes.length, true)
    view.setUint16(offset + 28, 0, true) // Extra field length
    offset += 30

    out.set(item.nameBytes, offset)
    offset += item.nameBytes.length

    out.set(item.dataBytes, offset)
    offset += item.dataBytes.length
  }

  const centralDirStart = offset

  // 2. Ghi Central Directory Headers
  for (let i = 0; i < prepared.length; i++) {
    const item = prepared[i]
    view.setUint32(offset, 0x02014b50, true) // Central directory file header signature
    view.setUint16(offset + 4, 20, true) // Version made by
    view.setUint16(offset + 6, 20, true) // Version needed
    view.setUint16(offset + 8, 0x0800, true) // UTF-8 flag
    view.setUint16(offset + 10, 0, true) // STORE
    view.setUint16(offset + 12, dosTime, true)
    view.setUint16(offset + 14, dosDate, true)
    view.setUint32(offset + 16, item.crc, true)
    view.setUint32(offset + 20, item.dataBytes.length, true)
    view.setUint32(offset + 24, item.dataBytes.length, true)
    view.setUint16(offset + 28, item.nameBytes.length, true)
    view.setUint16(offset + 30, 0, true) // Extra length
    view.setUint16(offset + 32, 0, true) // Comment length
    view.setUint16(offset + 34, 0, true) // Disk number start
    view.setUint16(offset + 36, 0, true) // Internal file attributes
    view.setUint32(offset + 38, 0, true) // External file attributes
    view.setUint32(offset + 42, localOffsets[i], true) // Relative offset of local header
    offset += 46

    out.set(item.nameBytes, offset)
    offset += item.nameBytes.length
  }

  const centralDirSize = offset - centralDirStart

  // 3. Ghi End of Central Directory Record (EOCD)
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 4, 0, true) // Number of this disk
  view.setUint16(offset + 6, 0, true) // Disk where central directory starts
  view.setUint16(offset + 8, prepared.length, true)
  view.setUint16(offset + 10, prepared.length, true)
  view.setUint32(offset + 12, centralDirSize, true)
  view.setUint32(offset + 16, centralDirStart, true)
  view.setUint16(offset + 20, 0, true) // Comment length

  return out
}

function normalizeCmsOrigin(origin: string): string {
  const clean = (origin || '').trim().replace(/\/+$/, '')
  if (!clean || clean.includes('github.io')) {
    return 'http://127.0.0.1:3010'
  }
  return clean
}

export function generateShopeeExtensionFiles(
  rawConfig: Partial<ShopeeExtensionShopConfig> = {}
): ZipEntryFile[] {
  const config: ShopeeExtensionShopConfig = {
    shopId: rawConfig.shopId || DEFAULT_SHOPEE_SHOP_BINDING.shopId,
    username: rawConfig.username || DEFAULT_SHOPEE_SHOP_BINDING.username,
    shopLabel: rawConfig.shopLabel || DEFAULT_SHOPEE_SHOP_BINDING.shopLabel,
    cmsOrigin: normalizeCmsOrigin(rawConfig.cmsOrigin || 'http://127.0.0.1:3010'),
    bridgePort: rawConfig.bridgePort || DEFAULT_SHOPEE_SHOP_BINDING.bridgePort,
    pairingToken: rawConfig.pairingToken || '',
    enforceShopLock: rawConfig.enforceShopLock ?? true,
    generatedAt: rawConfig.generatedAt || new Date().toISOString(),
  }

  const hostPermissions = new Set<string>([
    '*://*.shopee.vn/*',
    '*://banhang.shopee.vn/*',
    'http://127.0.0.1/*',
    'http://localhost/*',
  ])

  try {
    const parsedOrigin = new URL(config.cmsOrigin)
    if (
      parsedOrigin.hostname !== '127.0.0.1' &&
      parsedOrigin.hostname !== 'localhost'
    ) {
      hostPermissions.add(`${parsedOrigin.protocol}//${parsedOrigin.host}/*`)
    }
  } catch {
    // Bỏ qua nếu URL tùy chỉnh không hợp lệ
  }

  const manifestJson = JSON.stringify(
    {
      manifest_version: 3,
      name: `OPENVN Shopee Auto-Sync — ${config.username} (#${config.shopId})`,
      version: '2.0.0',
      description: `Tiện ích liên kết riêng cho shop ${config.username} (#${config.shopId}) — tự động đồng bộ Cookie Kênh Người Bán Shopee về OPENVN CMS.`,
      permissions: ['cookies', 'alarms', 'storage', 'tabs'],
      host_permissions: Array.from(hostPermissions),
      background: {
        service_worker: 'background.js',
      },
      action: {
        default_popup: 'popup.html',
        default_title: `OPENVN Shopee Auto-Sync (${config.username})`,
      },
    },
    null,
    2
  )

  const shopConfigJson = JSON.stringify(config, null, 2)

  const backgroundJs = `// ============================================================================
// OPENVN SHOPEE AUTO-SYNC EXTENSION v2.0 (LIÊN KẾT RIÊNG CHO SHOP)
// Tự động trích xuất & đồng bộ Cookie phiên Kênh Người Bán Shopee về CMS
// ============================================================================

const SESSION_WATCH_COOKIES = new Set([
  'SPC_ST',
  'SPC_SC_SESSION',
  'SPC_EC',
  'SPC_CDS',
  'csrftoken',
]);

let cachedBaseConfig = null;
let cookieDebounceTimer = null;

async function loadEffectiveConfig() {
  if (!cachedBaseConfig) {
    try {
      const resp = await fetch(chrome.runtime.getURL('shop-config.json'));
      cachedBaseConfig = await resp.json();
    } catch {
      cachedBaseConfig = {
        shopId: '197195817',
        username: 'thaimy1605',
        shopLabel: 'OPENVN · Ưu Đàm (thaimy1605)',
        cmsOrigin: 'http://127.0.0.1:3010',
        bridgePort: 51898,
        pairingToken: '',
        enforceShopLock: true,
      };
    }
  }

  const stored = await chrome.storage.local.get([
    'cmsOrigin',
    'bridgePort',
    'pairingToken',
    'enforceShopLock',
  ]);

  return {
    ...cachedBaseConfig,
    cmsOrigin: (stored.cmsOrigin || cachedBaseConfig.cmsOrigin || 'http://127.0.0.1:3010').replace(/\\/+$/, ''),
    bridgePort: Number(stored.bridgePort || cachedBaseConfig.bridgePort || 51898),
    pairingToken:
      stored.pairingToken !== undefined ? stored.pairingToken : (cachedBaseConfig.pairingToken || ''),
    enforceShopLock:
      typeof stored.enforceShopLock === 'boolean'
        ? stored.enforceShopLock
        : Boolean(cachedBaseConfig.enforceShopLock ?? true),
  };
}

async function collectShopeeCookies() {
  const [rootCookies, sellerCookies] = await Promise.all([
    chrome.cookies.getAll({ domain: 'shopee.vn' }),
    chrome.cookies.getAll({ domain: 'banhang.shopee.vn' }),
  ]);

  const cookieDict = {};
  for (const c of [...rootCookies, ...sellerCookies]) {
    if (c && c.name) {
      cookieDict[c.name] = c.value;
    }
  }
  return cookieDict;
}

async function extractAndPushCookies(triggerReason = 'AUTO') {
  const cfg = await loadEffectiveConfig();
  try {
    const cookieDict = await collectShopeeCookies();
    const cookieCount = Object.keys(cookieDict).length;

    if (!cookieDict['SPC_ST'] && !cookieDict['SPC_SC_SESSION'] && !cookieDict['SPC_EC']) {
      const state = {
        lastSyncStatus: 'CHUA_DANG_NHAP_SHOPEE',
        lastError: 'Chưa phát hiện phiên đăng nhập trên banhang.shopee.vn. Hãy mở Kênh Người Bán và đăng nhập.',
        cookieCount,
        triggerReason,
      };
      await chrome.storage.local.set(state);
      return { ok: false, ...state };
    }

    if (String(cookieDict['SPC_U'] || '') === '3813970') {
      const state = {
        lastSyncStatus: 'COOKIE_MAU_BI_CHAN',
        lastError: 'Phát hiện Cookie mẫu thử nghiệm cũ (SPC_U=3813970). Đã chặn đồng bộ.',
        cookieCount,
        triggerReason,
      };
      await chrome.storage.local.set(state);
      return { ok: false, ...state };
    }

    const expectedShopId = cfg.enforceShopLock ? String(cfg.shopId || '') : '';
    const payload = {
      cookies: cookieDict,
      spc_cds: cookieDict['SPC_CDS'] || '',
      csrf_token: cookieDict['csrftoken'] || '',
      source: 'CHROME_EXTENSION_BRIDGE',
      expectedShopId,
    };

    const bridgeUrl = \`http://127.0.0.1:\${cfg.bridgePort}/shopee/session\`;
    let pushed = false;
    let syncedVia = '';
    let detectedShopId = '';
    let detectedUsername = '';
    let lastError = '';

    // 1. Ưu tiên đẩy thẳng tới Python Shopee Daemon (:51898) để xác thực tức thì với Shopee
    try {
      const res = await fetch(bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        pushed = true;
        syncedVia = \`Python Daemon (:\${cfg.bridgePort})\`;
        detectedShopId = String(data.shopId || '');
        detectedUsername = String(data.username || '');
      } else if (res.status === 409) {
        const mismatchState = {
          lastSyncStatus: 'SAI_TAI_KHOAN_SHOP',
          lastError:
            data.error ||
            \`Tài khoản đang đăng nhập (#\${data.shopId || '?'}) không khớp với shop liên kết #\${cfg.shopId}.\`,
          detectedShopId: String(data.shopId || ''),
          detectedUsername: String(data.username || ''),
          cookieCount,
          triggerReason,
        };
        await chrome.storage.local.set(mismatchState);
        return { ok: false, ...mismatchState };
      } else {
        lastError = data.error || \`Python Bridge trả mã HTTP \${res.status}\`;
      }
    } catch {
      // Daemon :51898 chưa bật -> chuyển sang cổng dự phòng CMS Webhook (:3010)
    }

    // 2. Dự phòng đẩy vào cổng Webhook của CMS (:3010)
    if (!pushed) {
      const cmsWebhookUrl = \`\${cfg.cmsOrigin}/api/webhooks/inbound\`;
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.pairingToken) {
        headers['Authorization'] = \`Apikey \${cfg.pairingToken}\`;
      }
      const res2 = await fetch(cmsWebhookUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          event: 'INBOUND_SHOPEE_SESSION_UPDATE',
          data: payload,
        }),
      });
      const data2 = await res2.json().catch(() => ({}));
      if (res2.ok && data2.ok) {
        pushed = true;
        syncedVia = data2.verifiedLive
          ? \`CMS + Daemon (\${cfg.cmsOrigin})\`
          : \`CMS Dự phòng (\${cfg.cmsOrigin})\`;
        detectedShopId = String(data2.shopId || cfg.shopId || '');
        detectedUsername = String(data2.username || cfg.username || '');
      } else if (res2.status === 409) {
        const mismatchState = {
          lastSyncStatus: 'SAI_TAI_KHOAN_SHOP',
          lastError: data2.error || 'Tài khoản Shopee không khớp với shop liên kết.',
          cookieCount,
          triggerReason,
        };
        await chrome.storage.local.set(mismatchState);
        return { ok: false, ...mismatchState };
      } else {
        lastError =
          data2.error ||
          lastError ||
          \`Không kết nối được CMS (\${cfg.cmsOrigin}) hoặc thiếu Pairing Token.\`;
      }
    }

    if (pushed) {
      const okState = {
        lastSyncTime: new Date().toLocaleString('vi-VN'),
        lastSyncStatus: 'DONG_BO_THANH_CONG',
        lastError: '',
        syncedVia,
        detectedShopId,
        detectedUsername,
        cookieCount,
        triggerReason,
      };
      await chrome.storage.local.set(okState);
      return { ok: true, ...okState };
    }

    const failState = {
      lastSyncStatus: 'LOI_KET_NOI_CMS',
      lastError,
      cookieCount,
      triggerReason,
    };
    await chrome.storage.local.set(failState);
    return { ok: false, ...failState };
  } catch (err) {
    const errState = {
      lastSyncStatus: 'LOI_NGOAI_LE',
      lastError: String(err && err.message ? err.message : err),
    };
    await chrome.storage.local.set(errState);
    return { ok: false, ...errState };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('syncShopeeCookies', { periodInMinutes: 10 });
  extractAndPushCookies('INSTALL');
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('syncShopeeCookies', { periodInMinutes: 10 });
  extractAndPushCookies('STARTUP');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'syncShopeeCookies') {
    extractAndPushCookies('ALARM_10M');
  }
});

chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.removed) return;
  const domain = (changeInfo.cookie && changeInfo.cookie.domain) || '';
  const name = (changeInfo.cookie && changeInfo.cookie.name) || '';
  if (domain.includes('shopee.vn') && SESSION_WATCH_COOKIES.has(name)) {
    if (cookieDebounceTimer) clearTimeout(cookieDebounceTimer);
    cookieDebounceTimer = setTimeout(() => {
      extractAndPushCookies(\`COOKIE_\${name}\`);
    }, 2500);
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (
    changeInfo.status === 'complete' &&
    tab &&
    typeof tab.url === 'string' &&
    tab.url.includes('banhang.shopee.vn')
  ) {
    extractAndPushCookies('SELLER_TAB_OPENED');
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.action === 'FORCE_SYNC') {
    extractAndPushCookies('MANUAL_BUTTON').then((resp) => sendResponse(resp));
    return true;
  }

  if (msg.action === 'GET_CONFIG_AND_STATE') {
    Promise.all([
      loadEffectiveConfig(),
      chrome.storage.local.get([
        'lastSyncTime',
        'lastSyncStatus',
        'lastError',
        'syncedVia',
        'detectedShopId',
        'detectedUsername',
        'cookieCount',
      ]),
    ]).then(([cfg, state]) => {
      sendResponse({ ok: true, config: cfg, state });
    });
    return true;
  }

  if (msg.action === 'SAVE_SETTINGS') {
    const updates = {};
    if (typeof msg.cmsOrigin === 'string') {
      updates.cmsOrigin = msg.cmsOrigin.trim().replace(/\\/+$/, '');
    }
    if (typeof msg.pairingToken === 'string') {
      updates.pairingToken = msg.pairingToken.trim();
    }
    if (typeof msg.enforceShopLock === 'boolean') {
      updates.enforceShopLock = msg.enforceShopLock;
    }
    chrome.storage.local.set(updates).then(() => {
      extractAndPushCookies('SETTINGS_UPDATED').then((resp) => sendResponse(resp));
    });
    return true;
  }

  if (msg.action === 'EXPORT_COOKIE_HEADER') {
    collectShopeeCookies().then((dict) => {
      const pairs = Object.entries(dict)
        .map(([k, v]) => \`\${k}=\${v}\`)
        .join('; ');
      sendResponse({
        ok: Object.keys(dict).length > 0,
        cookieCount: Object.keys(dict).length,
        hasSession: Boolean(dict['SPC_ST'] || dict['SPC_SC_SESSION'] || dict['SPC_EC']),
        cookieHeader: pairs ? \`Cookie: \${pairs}\` : '',
      });
    });
    return true;
  }

  return false;
});
`

  const popupHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>OPENVN Shopee Auto-Sync</title>
  <style>
    * { box-sizing: border-box; }
    body {
      width: 340px;
      margin: 0;
      padding: 14px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      font-size: 12px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .brand {
      font-size: 14px;
      font-weight: 700;
      color: #ea580c;
    }
    .shop-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      color: #9a3412;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 11px;
      margin-bottom: 10px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 3px 0;
      gap: 8px;
    }
    .label { color: #64748b; }
    .val { font-weight: 600; text-align: right; word-break: break-all; }
    .ok { color: #059669; }
    .warn { color: #d97706; }
    .err { color: #dc2626; }
    .error-box {
      margin-top: 6px;
      padding: 7px 8px;
      border-radius: 6px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      font-size: 11px;
      line-height: 1.4;
      display: none;
    }
    .btn {
      width: 100%;
      border: none;
      border-radius: 8px;
      padding: 9px 12px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:disabled { opacity: 0.6; cursor: wait; }
    .btn-primary {
      background: #ea580c;
      color: #ffffff;
      margin-bottom: 6px;
    }
    .btn-primary:hover { background: #c2410c; }
    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #cbd5e1;
    }
    .btn-secondary:hover { background: #e2e8f0; }
    details {
      margin-top: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
    }
    summary {
      cursor: pointer;
      font-weight: 600;
      color: #334155;
      user-select: none;
    }
    .field { margin-top: 8px; }
    .field label {
      display: block;
      font-size: 11px;
      color: #475569;
      margin-bottom: 3px;
    }
    .field input[type="text"],
    .field input[type="password"] {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 11px;
    }
    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      font-size: 11px;
      color: #334155;
    }
    .hint {
      margin-top: 8px;
      font-size: 11px;
      color: #64748b;
      text-align: center;
      line-height: 1.35;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">OPENVN Auto-Sync</div>
    <div id="shopBadge" class="shop-pill">Shop #197195817</div>
  </div>

  <div class="card">
    <div class="row">
      <span class="label">Trạng thái:</span>
      <span id="status" class="val">Đang kiểm tra...</span>
    </div>
    <div class="row">
      <span class="label">Tài khoản nhận diện:</span>
      <span id="detectedShop" class="val">—</span>
    </div>
    <div class="row">
      <span class="label">Số lượng Cookie:</span>
      <span id="count" class="val">0</span>
    </div>
    <div class="row">
      <span class="label">Kênh truyền:</span>
      <span id="channel" class="val">—</span>
    </div>
    <div class="row">
      <span class="label">Đồng bộ cuối:</span>
      <span id="time" class="val">Chưa chạy</span>
    </div>
    <div id="errorBox" class="error-box"></div>
  </div>

  <button id="syncBtn" class="btn btn-primary">Đồng bộ Cookie ngay</button>
  <button id="copyBtn" class="btn btn-secondary">Sao chép chuỗi Cookie (dán thủ công)</button>

  <details>
    <summary>Cấu hình liên kết Shop</summary>
    <div class="field">
      <label for="cmsOriginInput">Địa chỉ OPENVN CMS</label>
      <input id="cmsOriginInput" type="text" placeholder="http://127.0.0.1:3010" />
    </div>
    <div class="field">
      <label for="pairingTokenInput">Mã liên kết API (Pairing Token)</label>
      <input id="pairingTokenInput" type="password" placeholder="Tự động điền sẵn theo Shop" />
    </div>
    <label class="checkbox-row">
      <input id="shopLockCheckbox" type="checkbox" checked />
      <span id="shopLockLabel">Khóa cứng chỉ nhận đúng Shop liên kết</span>
    </label>
    <button id="saveSettingsBtn" class="btn btn-secondary" style="margin-top: 8px;">Lưu & Kết nối lại</button>
  </details>

  <div class="hint">
    Tự động gia hạn mỗi 10 phút hoặc ngay khi bạn mở <b>banhang.shopee.vn</b>.
  </div>

  <script src="popup.js"></script>
</body>
</html>
`

  const popupJs = `function renderView(config, state) {
  const shopBadge = document.getElementById('shopBadge');
  const statusEl = document.getElementById('status');
  const detectedShopEl = document.getElementById('detectedShop');
  const countEl = document.getElementById('count');
  const channelEl = document.getElementById('channel');
  const timeEl = document.getElementById('time');
  const errorBox = document.getElementById('errorBox');

  if (config) {
    shopBadge.textContent = \`\${config.username} · #\${config.shopId}\`;
    document.getElementById('cmsOriginInput').value = config.cmsOrigin || 'http://127.0.0.1:3010';
    document.getElementById('pairingTokenInput').value = config.pairingToken || '';
    document.getElementById('shopLockCheckbox').checked = Boolean(config.enforceShopLock);
    document.getElementById('shopLockLabel').textContent = \`Chỉ nhận đúng shop \${config.username} (#\${config.shopId})\`;
  }

  const st = state || {};
  countEl.textContent = String(st.cookieCount || 0);
  channelEl.textContent = st.syncedVia || '—';
  timeEl.textContent = st.lastSyncTime || 'Chưa có';

  if (st.detectedUsername || st.detectedShopId) {
    detectedShopEl.textContent = \`\${st.detectedUsername || '?'} (#\${st.detectedShopId || '?'})\`;
  } else {
    detectedShopEl.textContent = '—';
  }

  if (st.lastSyncStatus === 'DONG_BO_THANH_CONG') {
    statusEl.textContent = 'Đang kết nối Live';
    statusEl.className = 'val ok';
  } else if (st.lastSyncStatus === 'SAI_TAI_KHOAN_SHOP') {
    statusEl.textContent = 'Sai tài khoản Shop';
    statusEl.className = 'val err';
  } else if (st.lastSyncStatus === 'CHUA_DANG_NHAP_SHOPEE') {
    statusEl.textContent = 'Chưa đăng nhập Shopee';
    statusEl.className = 'val warn';
  } else if (st.lastSyncStatus) {
    statusEl.textContent = 'Chờ kết nối CMS';
    statusEl.className = 'val err';
  } else {
    statusEl.textContent = 'Sẵn sàng';
    statusEl.className = 'val';
  }

  if (st.lastError) {
    errorBox.style.display = 'block';
    errorBox.textContent = st.lastError;
  } else {
    errorBox.style.display = 'none';
    errorBox.textContent = '';
  }
}

function refreshPopup() {
  chrome.runtime.sendMessage({ action: 'GET_CONFIG_AND_STATE' }, (resp) => {
    if (resp && resp.ok) {
      renderView(resp.config, resp.state);
    }
  });
}

document.getElementById('syncBtn').addEventListener('click', () => {
  const btn = document.getElementById('syncBtn');
  btn.textContent = 'Đang đồng bộ...';
  btn.disabled = true;
  chrome.runtime.sendMessage({ action: 'FORCE_SYNC' }, () => {
    refreshPopup();
    btn.textContent = 'Đồng bộ Cookie ngay';
    btn.disabled = false;
  });
});

document.getElementById('copyBtn').addEventListener('click', () => {
  const btn = document.getElementById('copyBtn');
  chrome.runtime.sendMessage({ action: 'EXPORT_COOKIE_HEADER' }, async (resp) => {
    if (resp && resp.ok && resp.cookieHeader) {
      await navigator.clipboard.writeText(resp.cookieHeader);
      btn.textContent = \`Đã chép \${resp.cookieCount} Cookie vào bộ nhớ tạm!\`;
      setTimeout(() => {
        btn.textContent = 'Sao chép chuỗi Cookie (dán thủ công)';
      }, 2200);
    } else {
      btn.textContent = 'Chưa có Cookie — Hãy mở banhang.shopee.vn';
      setTimeout(() => {
        btn.textContent = 'Sao chép chuỗi Cookie (dán thủ công)';
      }, 2200);
    }
  });
});

document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  const btn = document.getElementById('saveSettingsBtn');
  const cmsOrigin = document.getElementById('cmsOriginInput').value;
  const pairingToken = document.getElementById('pairingTokenInput').value;
  const enforceShopLock = document.getElementById('shopLockCheckbox').checked;

  btn.textContent = 'Đang lưu...';
  btn.disabled = true;
  chrome.runtime.sendMessage(
    { action: 'SAVE_SETTINGS', cmsOrigin, pairingToken, enforceShopLock },
    () => {
      refreshPopup();
      btn.textContent = 'Đã lưu & Đồng bộ!';
      setTimeout(() => {
        btn.textContent = 'Lưu & Kết nối lại';
        btn.disabled = false;
      }, 1500);
    }
  );
});

refreshPopup();
`

  const readmeMd = `# Tiện Ích Đồng Bộ Cookie Shopee Liên Kết Riêng — ${config.username} (#${config.shopId})

Gói Chrome Extension này đã được cấu hình sẵn thông tin liên kết riêng cho gian hàng **${config.shopLabel}** (Shop ID: \`${config.shopId}\`).

## Hướng dẫn cài đặt (30 giây)
1. Giải nén file \`.zip\` vừa tải về ra một thư mục cố định trên máy tính.
2. Mở trình duyệt Chrome / Edge / Cốc Cốc (nơi bạn đăng nhập **banhang.shopee.vn**), truy cập địa chỉ:
   \`chrome://extensions\` (hoặc \`edge://extensions\`).
3. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
4. Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục vừa giải nén ở Bước 1.
5. Mở trang \`https://banhang.shopee.vn\` — Extension sẽ tự động nhận diện phiên Cookie của shop \`${config.username}\` và đồng bộ thẳng về OPENVN CMS.

## Cơ chế bảo vệ an toàn
- **Khóa cứng Shop ID (\`${config.shopId}\`)**: Ngăn đồng bộ nhầm nếu trình duyệt đăng nhập tài khoản Shopee khác.
- **Tự động gia hạn ngầm**: Tự động làm mới mỗi 10 phút hoặc ngay khi Shopee cấp lại \`SPC_ST\` / \`SPC_SC_SESSION\`.
`

  return [
    { name: 'manifest.json', content: manifestJson },
    { name: 'shop-config.json', content: shopConfigJson },
    { name: 'background.js', content: backgroundJs },
    { name: 'popup.html', content: popupHtml },
    { name: 'popup.js', content: popupJs },
    { name: 'README.md', content: readmeMd },
  ]
}
