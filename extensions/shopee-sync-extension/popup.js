document.addEventListener('DOMContentLoaded', async () => {
  const badge = document.getElementById('statusBadge');
  const shopName = document.getElementById('shopName');
  const shopId = document.getElementById('shopId');
  const syncText = document.getElementById('syncText');
  const lastTime = document.getElementById('lastTime');
  const btnSync = document.getElementById('btnSync');
  const hintMsg = document.getElementById('hintMsg');

  function render(data) {
    if (data.syncStatus === 'SYNCED') {
      badge.className = 'badge badge-active';
      badge.textContent = 'HOẠT ĐỘNG';
      syncText.textContent = 'Đã kết nối Live';
      syncText.style.color = '#34d399';
      shopName.textContent = data.username || 'thaimy1605';
      shopId.textContent = data.shopId || '197195817';
      if (data.lastSync) {
        lastTime.textContent = new Date(data.lastSync).toLocaleTimeString('vi-VN');
      }
    } else if (data.syncStatus === 'NOT_LOGGED_IN') {
      badge.className = 'badge badge-error';
      badge.textContent = 'CHƯA ĐĂNG NHẬP';
      syncText.textContent = 'Cần đăng nhập Shopee';
      syncText.style.color = '#f87171';
      hintMsg.textContent = 'Vui lòng nhấn nút Mở Kênh Người Bán để đăng nhập tài khoản Shop.';
    } else if (data.syncStatus === 'DISCONNECTED_DAEMON') {
      badge.className = 'badge badge-error';
      badge.textContent = 'MẤT KẾT NỐI';
      syncText.textContent = 'Chưa bật Sync Daemon';
      syncText.style.color = '#fbbf24';
      hintMsg.textContent = 'Chưa chạy file run-shopee-sync.bat trên máy tính.';
    }
  }

  const stored = await chrome.storage.local.get();
  render(stored);

  btnSync.addEventListener('click', () => {
    btnSync.innerHTML = '<span class="spinner"></span> Đang đồng bộ...';
    btnSync.disabled = true;

    chrome.runtime.sendMessage({ action: 'SYNC_NOW' }, (resp) => {
      btnSync.innerHTML = 'Đồng bộ Cookie ngay';
      btnSync.disabled = false;
      if (resp && resp.success) {
        render(resp);
        hintMsg.textContent = `Đã đồng bộ ${resp.cookieCount || 0} cookies về CMS thành công!`;
      } else {
        hintMsg.textContent = `Lỗi: ${resp?.reason || 'Không thể đồng bộ'}`;
      }
    });
  });
});
