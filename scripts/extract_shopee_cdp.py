"""
=============================================================================
SHOPEE CDP COOKIE EXTRACTOR (Chrome DevTools Protocol - Persistent 1-Login)
- Kết nối ngầm vào Chrome/Edge Hồ sơ Bền vững đang mở với cổng gỡ lỗi 9222
- Ưu tiên Storage.getCookies (lấy toàn bộ httpOnly cookie kể cả khi chưa mở tab)
  kết hợp dự phòng Network.getCookies trên banhang.shopee.vn
- Hỗ trợ cờ `--json` để Route Handler Node.js (/api/channels/shopee-session) gọi trực tiếp
=============================================================================
"""

import asyncio
import concurrent.futures
import json
import os
import sys
import time
import urllib.request

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

SESSION_FILE = os.path.join(os.path.dirname(__file__), ".shopee_session.json")


def _fetch_cdp_ws_url(port=9222):
    # 1. Ưu tiên Browser-level WebSocket từ /json/version:
    #    Storage.getCookies trên Browser target luôn đọc trực tiếp Cookie Jar gốc của hồ sơ
    #    ngay cả khi đóng hết tab Shopee hoặc /json chỉ còn service_worker của Extension!
    try:
        req_ver = urllib.request.Request(
            f"http://127.0.0.1:{port}/json/version",
            headers={"User-Agent": "ShopeeSyncDaemon/2.0"},
        )
        with urllib.request.urlopen(req_ver, timeout=2.5) as resp:
            ver = json.loads(resp.read().decode("utf-8"))
        ws_browser = ver.get("webSocketDebuggerUrl")
        if ws_browser:
            return ws_browser, True
    except Exception:
        pass

    # 2. Dự phòng lấy Page-level target từ /json (chỉ chọn type == 'page', bỏ qua service_worker / background_page)
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/json",
            headers={"User-Agent": "ShopeeSyncDaemon/2.0"},
        )
        with urllib.request.urlopen(req, timeout=2.5) as resp:
            targets = json.loads(resp.read().decode("utf-8"))
        if isinstance(targets, list):
            page_targets = [
                t
                for t in targets
                if isinstance(t, dict)
                and t.get("type") == "page"
                and t.get("webSocketDebuggerUrl")
            ]
            for t in page_targets:
                if "shopee.vn" in str(t.get("url", "")):
                    return t["webSocketDebuggerUrl"], True
            if page_targets:
                return page_targets[0]["webSocketDebuggerUrl"], True
    except Exception:
        pass

    return None, False


async def _send_cdp_command(ws, req_id, method, params):
    await ws.send(json.dumps({"id": req_id, "method": method, "params": params}))
    while True:
        raw = await asyncio.wait_for(ws.recv(), timeout=5.0)
        msg = json.loads(raw)
        if isinstance(msg, dict) and msg.get("id") == req_id:
            return msg


async def extract_cookies_from_cdp(port=9222, quiet=False):
    if not HAS_WEBSOCKETS:
        if not quiet:
            print("[CDP ERROR] Thieu thu vien python 'websockets'.")
        return None

    ws_url, cdp_reachable = _fetch_cdp_ws_url(port)
    if not cdp_reachable or not ws_url:
        if not quiet:
            print(f"[CDP] Khong the ket noi den Trình duyet tai port {port}.")
            print("[CDP TIP] Hay khoi chay Trinh duyet Dang nhap 1 lan bang: launch-chrome-shopee.bat")
        return None

    try:
        async with websockets.connect(ws_url, max_size=10 * 1024 * 1024) as ws:
            cookie_dict = {}

            # Ưu tiên 1: Storage.getCookies lấy toàn bộ cookie hồ sơ bền vững (kể cả httpOnly chưa mở tab)
            resp_data = await _send_cdp_command(ws, 1001, "Storage.getCookies", {})
            storage_cookies = (resp_data.get("result") or {}).get("cookies") or []
            for c in storage_cookies:
                domain = str(c.get("domain") or "").lower()
                name = str(c.get("name") or "").strip()
                val = str(c.get("value") or "")
                if name and val and "shopee.vn" in domain:
                    cookie_dict[name] = val

            # Dự phòng 2: Network.getCookies nếu target không hỗ trợ Storage.getCookies
            if not (cookie_dict.get("SPC_ST") or cookie_dict.get("SPC_SC_SESSION") or cookie_dict.get("SPC_EC")):
                resp_net = await _send_cdp_command(
                    ws,
                    1002,
                    "Network.getCookies",
                    {"urls": ["https://banhang.shopee.vn", "https://shopee.vn"]},
                )
                net_cookies = (resp_net.get("result") or {}).get("cookies") or []
                for c in net_cookies:
                    name = str(c.get("name") or "").strip()
                    val = str(c.get("value") or "")
                    if name and val:
                        cookie_dict[name] = val

            if (
                cookie_dict.get("SPC_ST")
                or cookie_dict.get("SPC_SC_SESSION")
                or cookie_dict.get("SPC_EC")
            ):
                if str(cookie_dict.get("SPC_U", "")) == "3813970":
                    if not quiet:
                        print("[CDP WARN] Phat hien cookie mau thu nghiem cu (SPC_U=3813970), bo qua.")
                    return None
                if not quiet:
                    print(f"[CDP SUCCESS] Da lay thanh cong {len(cookie_dict)} cookies tu Ho so Ben vung!")
                return cookie_dict

            if not quiet:
                print(f"[CDP WARN] Da ket noi CDP ({len(cookie_dict)} cookies) nhung chua dang nhap banhang.shopee.vn.")
            return None
    except Exception as e:
        if not quiet:
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
        "source": "CHROME_CDP_AUTO_EXTRACT",
    }

    with open(SESSION_FILE, "w", encoding="utf-8") as f:
        json.dump(session_data, f, indent=2)
    return session_data


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
    json_mode = "--json" in sys.argv
    no_write = "--no-write" in sys.argv
    port = 9222
    for arg in sys.argv[1:]:
        if arg.startswith("--port="):
            try:
                port = int(arg.split("=", 1)[1])
            except ValueError:
                port = 9222

    if not json_mode:
        print("==================================================")
        print("DANG QUET PHIEN SHOPEE TU HO SO CHROME (CDP 9222)")
        print("==================================================")

    _, cdp_reachable = _fetch_cdp_ws_url(port)
    cookies = run_coro_safely(extract_cookies_from_cdp(port, quiet=json_mode))
    if cookies:
        spc_cds = cookies.get("SPC_CDS", "78068754-dc8b-492a-8882-736c29a39ad4")
        csrf_token = cookies.get("csrftoken", "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz")
        if not no_write:
            session_data = update_session_file(cookies)
            spc_cds = session_data["spc_cds"]
            csrf_token = session_data["csrf_token"]
        if not json_mode:
            if not no_write:
                print(f"[CDP] Da cap nhat phien vao: {SESSION_FILE}")
        else:
            print(
                json.dumps(
                    {
                        "ok": True,
                        "cdpReachable": True,
                        "cookieCount": len(cookies),
                        "cookies": cookies,
                        "spc_cds": spc_cds,
                        "csrf_token": csrf_token,
                    }
                )
            )
        return True

    if json_mode:
        print(
            json.dumps(
                {
                    "ok": False,
                    "cdpReachable": cdp_reachable,
                    "error": (
                        "Trình duyệt Hồ sơ Bền vững đang mở nhưng chưa đăng nhập banhang.shopee.vn."
                        if cdp_reachable
                        else f"Chưa bật Trình duyệt Hồ sơ Bền vững trên cổng CDP {port}."
                    ),
                }
            )
        )
    return False


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
