function renderView(config, state) {
  const shopBadge = document.getElementById('shopBadge');
  const statusEl = document.getElementById('status');
  const detectedShopEl = document.getElementById('detectedShop');
  const countEl = document.getElementById('count');
  const channelEl = document.getElementById('channel');
  const timeEl = document.getElementById('time');
  const errorBox = document.getElementById('errorBox');

  if (config) {
    shopBadge.textContent = `${config.username} · #${config.shopId}`;
    document.getElementById('cmsOriginInput').value = config.cmsOrigin || 'http://127.0.0.1:3010';
    document.getElementById('cloudOriginInput').value =
      config.cloudOrigin || 'https://openvn-cms-pos-backend.onrender.com';
    document.getElementById('syncToCloudCheckbox').checked = Boolean(config.syncToCloud ?? true);
    document.getElementById('pairingTokenInput').value = config.pairingToken || '';
    document.getElementById('shopLockCheckbox').checked = Boolean(config.enforceShopLock);
    document.getElementById('shopLockLabel').textContent = `Chỉ nhận đúng shop ${config.username} (#${config.shopId})`;
  }

  const st = state || {};
  countEl.textContent = String(st.cookieCount || 0);
  channelEl.textContent = st.syncedVia || '—';
  timeEl.textContent = st.lastSyncTime || 'Chưa có';

  if (st.detectedUsername || st.detectedShopId) {
    detectedShopEl.textContent = `${st.detectedUsername || '?'} (#${st.detectedShopId || '?'})`;
  } else {
    detectedShopEl.textContent = '—';
  }

  if (st.lastSyncStatus === 'DONG_BO_THANH_CONG') {
    statusEl.textContent = st.cloudSynced ? 'Đang kết nối Live + Cloud 24/7' : 'Đang kết nối Live';
    statusEl.className = 'val ok';
  } else if (st.lastSyncStatus === 'SAI_TAI_KHOAN_SHOP') {
    statusEl.textContent = 'Sai tài khoản Shop';
    statusEl.className = 'val err';
  } else if (st.lastSyncStatus === 'CHUA_DANG_NHAP_SHOPEE') {
    statusEl.textContent = 'Chưa đăng nhập Shopee';
    statusEl.className = 'val warn';
  } else if (st.lastSyncStatus) {
    statusEl.textContent = 'Chờ kết nối CMS / Cloud';
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
  btn.textContent = 'Đang đồng bộ Local & Cloud...';
  btn.disabled = true;
  chrome.runtime.sendMessage({ action: 'FORCE_SYNC' }, () => {
    refreshPopup();
    btn.textContent = 'Đồng bộ Cookie ngay (Local + Cloud)';
    btn.disabled = false;
  });
});

document.getElementById('copyBtn').addEventListener('click', () => {
  const btn = document.getElementById('copyBtn');
  chrome.runtime.sendMessage({ action: 'EXPORT_COOKIE_HEADER' }, async (resp) => {
    if (resp && resp.ok && resp.cookieHeader) {
      await navigator.clipboard.writeText(resp.cookieHeader);
      btn.textContent = `Đã chép ${resp.cookieCount} Cookie vào bộ nhớ tạm!`;
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
  const cloudOrigin = document.getElementById('cloudOriginInput').value;
  const syncToCloud = document.getElementById('syncToCloudCheckbox').checked;
  const pairingToken = document.getElementById('pairingTokenInput').value;
  const enforceShopLock = document.getElementById('shopLockCheckbox').checked;

  btn.textContent = 'Đang lưu...';
  btn.disabled = true;
  chrome.runtime.sendMessage(
    { action: 'SAVE_SETTINGS', cmsOrigin, cloudOrigin, syncToCloud, pairingToken, enforceShopLock },
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
