// ============================================================================
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
    cmsOrigin: (stored.cmsOrigin || cachedBaseConfig.cmsOrigin || 'http://127.0.0.1:3010').replace(/\/+$/, ''),
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

    const bridgeUrl = `http://127.0.0.1:${cfg.bridgePort}/shopee/session`;
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
        syncedVia = `Python Daemon (:${cfg.bridgePort})`;
        detectedShopId = String(data.shopId || '');
        detectedUsername = String(data.username || '');
      } else if (res.status === 409) {
        const mismatchState = {
          lastSyncStatus: 'SAI_TAI_KHOAN_SHOP',
          lastError:
            data.error ||
            `Tài khoản đang đăng nhập (#${data.shopId || '?'}) không khớp với shop liên kết #${cfg.shopId}.`,
          detectedShopId: String(data.shopId || ''),
          detectedUsername: String(data.username || ''),
          cookieCount,
          triggerReason,
        };
        await chrome.storage.local.set(mismatchState);
        return { ok: false, ...mismatchState };
      } else {
        lastError = data.error || `Python Bridge trả mã HTTP ${res.status}`;
      }
    } catch {
      // Daemon :51898 chưa bật -> chuyển sang cổng dự phòng CMS Webhook (:3010)
    }

    // 2. Dự phòng đẩy vào cổng Webhook của CMS (:3010)
    if (!pushed) {
      const cmsWebhookUrl = `${cfg.cmsOrigin}/api/webhooks/inbound`;
      const headers = { 'Content-Type': 'application/json' };
      if (cfg.pairingToken) {
        headers['Authorization'] = `Apikey ${cfg.pairingToken}`;
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
          ? `CMS + Daemon (${cfg.cmsOrigin})`
          : `CMS Dự phòng (${cfg.cmsOrigin})`;
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
          `Không kết nối được CMS (${cfg.cmsOrigin}) hoặc thiếu Pairing Token.`;
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
      extractAndPushCookies(`COOKIE_${name}`);
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
      updates.cmsOrigin = msg.cmsOrigin.trim().replace(/\/+$/, '');
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
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      sendResponse({
        ok: Object.keys(dict).length > 0,
        cookieCount: Object.keys(dict).length,
        hasSession: Boolean(dict['SPC_ST'] || dict['SPC_SC_SESSION'] || dict['SPC_EC']),
        cookieHeader: pairs ? `Cookie: ${pairs}` : '',
      });
    });
    return true;
  }

  return false;
});
