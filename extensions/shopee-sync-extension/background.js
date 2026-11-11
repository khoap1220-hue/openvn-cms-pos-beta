// OPENVN Shopee Auto-Sync - Background Service Worker

const SYNC_URL_WORKER = 'http://127.0.0.1:51898/shopee/session';
const SYNC_URL_CMS = 'http://127.0.0.1:3010/api/webhooks/inbound';
const CMS_API_KEY = '191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955';

async function extractAndSyncCookies() {
  try {
    const cookiesVn = await chrome.cookies.getAll({ domain: 'banhang.shopee.vn' });
    const cookiesRoot = await chrome.cookies.getAll({ domain: 'shopee.vn' });
    const allCookies = [...cookiesVn, ...cookiesRoot];

    if (!allCookies || allCookies.length === 0) {
      await chrome.storage.local.set({ syncStatus: 'NO_COOKIES', lastChecked: Date.now() });
      return { success: false, reason: 'Chưa có cookie Shopee' };
    }

    const cookieDict = {};
    for (const c of allCookies) {
      cookieDict[c.name] = c.value;
    }

    if (!cookieDict['SPC_ST'] && !cookieDict['SPC_SC_SESSION']) {
      await chrome.storage.local.set({ syncStatus: 'NOT_LOGGED_IN', lastChecked: Date.now() });
      return { success: false, reason: 'Chưa đăng nhập Kênh Người Bán' };
    }

    const spc_cds = cookieDict['SPC_CDS'] || '78068754-dc8b-492a-8882-736c29a39ad4';
    const csrf_token = cookieDict['csrftoken'] || 'h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz';

    // 1. Thử gửi trực tiếp cho Python Sync Daemon qua cổng 51898
    let sent = false;
    let shopInfo = null;

    try {
      const resp = await fetch(SYNC_URL_WORKER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies: cookieDict,
          spc_cds: spc_cds,
          csrf_token: csrf_token
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        sent = true;
        shopInfo = data;
      }
    } catch (e) {
      // Daemon có thể chưa chạy, chuyển sang gửi qua CMS Webhook
    }

    // 2. Thử gửi qua CMS Inbound Webhook
    if (!sent) {
      try {
        const resp2 = await fetch(SYNC_URL_CMS, {
          method: 'POST',
          headers: {
            'Authorization': `Apikey ${CMS_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            event: 'INBOUND_SHOPEE_SESSION_UPDATE',
            data: {
              cookies: cookieDict,
              spc_cds: spc_cds,
              csrf_token: csrf_token
            }
          })
        });
        if (resp2.ok) {
          sent = true;
        }
      } catch (e) {
        // Cả 2 đều lỗi kết nối
      }
    }

    if (sent) {
      const info = {
        syncStatus: 'SYNCED',
        lastSync: Date.now(),
        cookieCount: Object.keys(cookieDict).length,
        shopId: shopInfo?.shopId || '197195817',
        username: shopInfo?.username || 'thaimy1605'
      };
      await chrome.storage.local.set(info);
      return { success: true, ...info };
    } else {
      await chrome.storage.local.set({ syncStatus: 'DISCONNECTED_DAEMON', lastChecked: Date.now() });
      return { success: false, reason: 'Chưa bật daemon đồng bộ (run-shopee-sync.bat)' };
    }
  } catch (err) {
    console.error('Error extracting cookies:', err);
    return { success: false, reason: err.message };
  }
}

// Lắng nghe khi cookie thay đổi
chrome.cookies.onChanged.addListener((changeInfo) => {
  if (changeInfo.cookie.domain.includes('shopee.vn')) {
    if (['SPC_ST', 'SPC_SC_SESSION', 'SPC_SI', 'csrftoken'].includes(changeInfo.cookie.name)) {
      extractAndSyncCookies();
    }
  }
});

// Định kỳ kiểm tra mỗi 10 phút
chrome.alarms.create('shopee_periodic_sync', { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'shopee_periodic_sync') {
    extractAndSyncCookies();
  }
});

// Lắng nghe tin nhắn từ Popup
chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === 'SYNC_NOW') {
    extractAndSyncCookies().then((res) => sendResponse(res));
    return true;
  }
});
