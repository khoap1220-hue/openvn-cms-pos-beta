"""
=============================================================================
SHOPEE CDP COOKIE EXTRACTOR (Chrome DevTools Protocol)
- Kết nối ngầm vào Google Chrome đang mở với cổng gỡ lỗi 9222
- Tự động bóc tách cookie của banhang.shopee.vn qua WebSocket CDP
- Cập nhật phiên vào .shopee_session.json không cần mở F12 hay copy cURL
=============================================================================
"""

import urllib.request
import asyncio
import websockets
import json
import os
import sys
import time
import concurrent.futures

SESSION_FILE = os.path.join(os.path.dirname(__file__), ".shopee_session.json")

async def extract_cookies_from_cdp(port=9222):
    try:
        url = f"http://127.0.0.1:{port}/json"
        req = urllib.request.Request(url, headers={"User-Agent": "ShopeeSyncDaemon/1.0"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            targets = json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        print(f"[CDP] Khong the ket noi den Chrome tai port {port}: {e}")
        print("[CDP TIP] Hay khoi chay Chrome bang file: launch-chrome-shopee.bat")
        return None

    ws_url = None
    for t in targets:
        if "shopee.vn" in t.get("url", ""):
            ws_url = t.get("webSocketDebuggerUrl")
            break
    if not ws_url and targets:
        ws_url = targets[0].get("webSocketDebuggerUrl")

    if not ws_url:
        print("[CDP] Khong tim thay tab Chrome phu hop.")
        return None

    try:
        async with websockets.connect(ws_url, max_size=10*1024*1024) as ws:
            # Goi lenh Network.getCookies
            msg = {
                "id": 1001,
                "method": "Network.getCookies",
                "params": {"urls": ["https://banhang.shopee.vn", "https://shopee.vn"]}
            }
            await ws.send(json.dumps(msg))
            resp = await ws.recv()
            data = json.loads(resp)
            cookies_list = data.get("result", {}).get("cookies", [])
            
            cookie_dict = {}
            for c in cookies_list:
                cookie_dict[c["name"]] = c["value"]
            
            if "SPC_ST" in cookie_dict or "SPC_SC_SESSION" in cookie_dict:
                print(f"[CDP SUCCESS] Da lay thanh cong {len(cookie_dict)} cookies tu Chrome!")
                return cookie_dict
            else:
                print(f"[CDP WARN] Lay duoc {len(cookie_dict)} cookies nhung chua dang nhap Shopee.")
                return None
    except Exception as e:
        print(f"[CDP ERROR] Loi khi giao tiep qua WebSocket: {e}")
        return None

def update_session_file(cookies):
    spc_cds = cookies.get("SPC_CDS", "78068754-dc8b-492a-8882-736c29a39ad4")
    csrf_token = cookies.get("csrftoken", "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz")
    
    session_data = {
        "cookies": cookies,
        "spc_cds": spc_cds,
        "csrf_token": csrf_token,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": "CHROME_CDP_AUTO_EXTRACT"
    }
    
    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=2)
    print(f"[CDP] Da cap nhat phien vao: {SESSION_FILE}")

def run_coro_safely(coro):
    """Thuc thi coroutine an toan ca trong CLI doc lap lan moi truong da co event loop dang chay."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, coro).result()
    return asyncio.run(coro)

def main():
    print("==================================================")
    print("DANG QUET PHIEN SHOPEE TU GOOGLE CHROME (CDP)")
    print("==================================================")
    cookies = run_coro_safely(extract_cookies_from_cdp(9222))
    if cookies:
        update_session_file(cookies)
        return True
    return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
