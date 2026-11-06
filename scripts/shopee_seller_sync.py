"""
=============================================================================
SHOPEE SELLER SYNC WORKER - 3-TIER SESSION HARDENING (OPENVN CMS/POS)
TÍCH HỢP ĐỒNG THỜI 3 CƠ CHẾ:
1. Keep-Alive Heartbeat Daemon: Nuôi phiên trượt tự động mỗi 10 phút.
2. CDP Auto-Extractor (Port 9222): Tự động hồi phục phiên từ Google Chrome.
3. Local HTTP Bridge (Port 51898): Nhận Cookie tự động từ Chrome Extension.
=============================================================================
"""

import urllib.request
import json
import ssl
import time
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import asyncio

# Thử import websockets cho Cơ chế 2 (CDP)
try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

CMS_WEBHOOK_URL = os.environ.get("CMS_WEBHOOK_URL", "http://127.0.0.1:3010/api/webhooks/inbound")
CMS_API_KEY = os.environ.get("CMS_API_KEY", "191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", 51898))

SESSION_FILE = os.path.join(os.path.dirname(__file__), ".shopee_session.json")
CACHE_FILE = os.path.join(os.path.dirname(__file__), ".shopee_synced_orders.json")

INITIAL_COOKIE_STR = """SPC_CLIENTID=SsiPUVDlk04y5e5Ualyynwhfubifhriy; _ga=GA1.2.990663831.1753883089; _ga_4GPP1ZXG63=GS2.1.s1761839445$o4$g1$t1761840791$j60$l1$h955128681; language=vi; SPC_EC=-; SPC_F=BmsX084sj0VKSnOlD0aZRGv9EQ46N1M7; REC_T_ID=d676d95c-cf44-11f1-9925-3a049e637946; SPC_ST=Q8pdZ75W5JlBbIMhn33qb1dDuDTP0LF/STpSdi8zON22XCoNW7A0hWhBYVff8Z6Dk9v8xM6dAJ5dVyz66HgZWJwXgKa+bSysPe+67HifoS+kbwtpcVSikSW7imLFdmHesfqfDjQl5Sgxv7db3CiO2QbEu/WuG93DH7v4ZJywJS2dNqQDTubpwWQphjl6wgItrEtSMekM5o8UTdqrHpqJTw==.ADRMc8UVADcptr4IdOmcF1/sRpIl0Jn426o6UdoXHRfR; SPC_U=3813970; SPC_R_T_IV=djhPVmJvWm5tcW9ZM0paag==; SPC_T_ID=zmVFZCyQ0U5kLRl8GNAakHHwwn0/SwTx2m+8plNEvVYE6nkdbI5V3nI61rRXCPjntZ+E1DFGybI5kxtwoeFKB91mqT9Kz2Udwm2G9G+cuzMb3fG3zYQPGtSSxdy/QV8YU0pvEZSKbEKWqZ2m3/bMSPmLTyutSdHbK3S0qOVPYZ8=; SPC_T_IV=djhPVmJvWm5tcW9ZM0paag==; SPC_R_T_ID=zmVFZCyQ0U5kLRl8GNAakHHwwn0/SwTx2m+8plNEvVYE6nkdbI5V3nI61rRXCPjntZ+E1DFGybI5kxtwoeFKB91mqT9Kz2Udwm2G9G+cuzMb3fG3zYQPGtSSxdy/QV8YU0pvEZSKbEKWqZ2m3/bMSPmLTyutSdHbK3S0qOVPYZ8=; SPC_SI=3xfsagAAAABYdWxKTzF1dA5bSwAAAAAAQWluOGZmTHA=; SPC_SEC_SI=v1-WWZOV2g2NTVmWjhuUVdvVkmleAaUG1ORbavtv0jaflUGGswwK3OeVUYaAWjZuJlve+HQn6blUuDWcCZWussw6jQoeCgnuQ2X02Qf7n+A6b0=; csrftoken=h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz; sense_sa_r=s; SPC_CDS_CHAT=872eb017-1bdc-458a-b789-9a1d0b4c2d0b; SPC_SC_SESSION=gSRwlMN3FQqBeZ5sxhx3yvdH91arK3UFBxSR7kA6GEThFP7lACeFphcz5iyZg0cAwEsL62JneI76gw02VbZs2oKCJrzn5250TyQJw45Ivy7Vm8LzuvozaeIcgGlVRmlbqU5YzNttLRa+F9n1GsYdwq7QUHe63qSjRAPYp+zOLPdRWOAtN4Zu/f4mmZRXoFIKBh7r5KMaZrt7WGEo5kxhcpqWzC4fo46xRGDFfUtxEgg1Yqzj0v3wOP7eCJmL8XuydkV1zrgqbQ05KLjfvotcdFA==_1_3813970; SPC_SC_MAIN_SHOP_SA_UD=0; SPC_STK=nWvNOzuwu55lkhN2+88ClxysjS2vD+fxFlqkZ4oppsJOba2SzczXKp66kdSXW3+ska0bWzPxZEJ5uVa+Nk7JmzBe72+brZGusqIG2IJOcVN9UTS6kaSN3hBxuYA+Rhqsw/n3Th+e1mvPcoplqATcw9n3yqTfsHVk3iPgwh0hRLwiPixkghzRUBkBBvGpumpmne+bJwZpOnRBvSlCXFLV1JqXUe9rO/L5tCOTn6sxMjm9xt2iH/lHoCL0B+s9ZK4w/enxLtL8dyouycqOwggo+uWi+qhMd+tiQSKtFXNpwDaklEicd0zh5wEiCWGAspLoMSLm6N3kY+yoZIJuT1WUCOrKKWLRYCj3DSgCo0iDQ/m9LpxjmmT8TukV4HqvpVVQHEu9cRBbyd1Ggus7Nhy/MyMBRV7JqkI+KMPFLrfdR9s+A7bG8Zs7kIphzXDH9JmLz+SJFwNwkR4xfhhxuqbKCIuZP1hWYfuSmITPTsQC/Pui1tf/FQNvM27n8A0lja6D; SC_DFP=oxLXIjACfRVdRsNYnHpTRuyQEiKviUoU; SPC_CDS=78068754-dc8b-492a-8882-736c29a39ad4; CTOKEN=0iojGNk%2FEfGoJfYig5IxXA%3D%3D; _sapid=dd2485b6989b69dcd87949b4b3ad5454e864c6157ba7b77cb49de3e1; _QPWSDCXHZQA=52fa07ce-630f-4e82-d72f-07ef4ab5cbc5; REC7iLP4Q=189f7b4a-9b0e-48c1-acd5-378943f0fc92; shopee_webUnique_ccd=fDyGFqFKPKwpSMkoOCRYSQ%3D%3D%7CO1FYwWpyI1S38Z1CrkiwGQOXJYICtG2cj5wuFYeoYHNfedqZrqHRVfapYI5SZxvjybQHeCDn23AFvME%3D%7COxKoxinLt0P%2B5kHe%7C08%7C3; ds=a00560bce68d0031aa944d45ab39daba; fulfillment-language=vi""".replace("\n", " ").strip()

# Trạng thái toàn cục
GLOBAL_STATE = {
    "cookies": {},
    "spc_cds": "78068754-dc8b-492a-8882-736c29a39ad4",
    "csrf_token": "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz",
    "shopId": "3812687",
    "username": "mystique.parfum.store",
    "alive": False,
    "lastSync": 0,
    "lastPing": 0,
    "lock": threading.Lock()
}

def parse_cookie_str_to_dict(cookie_str):
    d = {}
    for part in cookie_str.split(";"):
        if "=" in part:
            k, v = part.strip().split("=", 1)
            d[k.strip()] = v.strip()
    return d

def dict_to_cookie_str(d):
    return "; ".join([f"{k}={v}" for k, v in d.items()])

def load_session():
    if os.path.exists(SESSION_FILE):
        try:
            with open(SESSION_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                cookies = data.get("cookies", {})
                spc_cds = data.get("spc_cds") or cookies.get("SPC_CDS", "78068754-dc8b-492a-8882-736c29a39ad4")
                csrf_token = data.get("csrf_token") or cookies.get("csrftoken", "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz")
                return cookies, spc_cds, csrf_token
        except Exception:
            pass
    cookies = parse_cookie_str_to_dict(INITIAL_COOKIE_STR)
    spc_cds = cookies.get("SPC_CDS", "78068754-dc8b-492a-8882-736c29a39ad4")
    csrf_token = cookies.get("csrftoken", "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz")
    save_session(cookies, spc_cds, csrf_token, source="INITIAL_FALLBACK")
    return cookies, spc_cds, csrf_token

def save_session(cookies, spc_cds, csrf_token, source="AUTO_SLIDING_SESSION"):
    try:
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "cookies": cookies,
                "spc_cds": spc_cds,
                "csrf_token": csrf_token,
                "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "source": source
            }, f, indent=2)
    except Exception as e:
        print(f"[WARN] Khong the ghi file session: {e}")

def update_cookies_from_headers(cookies, headers):
    updated = False
    for k, v in headers:
        if k.lower() == "set-cookie":
            cookie_part = v.split(";")[0]
            if "=" in cookie_part:
                ck, cv = cookie_part.strip().split("=", 1)
                if ck in cookies and cookies[ck] != cv:
                    cookies[ck] = cv
                    updated = True
                elif ck not in cookies:
                    cookies[ck] = cv
                    updated = True
    return updated

def load_synced_orders():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return set(json.load(f))
        except Exception:
            return set()
    return set()

def save_synced_orders(synced_set):
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(list(synced_set), f, indent=2)
    except Exception as e:
        print(f"[WARN] Khong the luu cache: {e}")

def keep_alive_ping(cookies, spc_cds, csrf_token):
    """Cơ chế 1: Gia hạn trượt (Sliding Session) ngầm"""
    url = f"https://banhang.shopee.vn/api/v2/login/?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/sale/order",
        "X-CSRFToken": csrf_token
    }
    req = urllib.request.Request(url, headers=headers)
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get("shopid"):
                if update_cookies_from_headers(cookies, resp.getheaders()):
                    save_session(cookies, spc_cds, csrf_token, source="HEARTBEAT_KEEP_ALIVE")
                return True, data.get("shopid"), data.get("username")
            return False, None, None
    except Exception as e:
        return False, None, str(e)

async def async_cdp_extract(port=9222):
    """Cơ chế 2: Bóc tách Cookie qua Chrome DevTools Protocol"""
    if not HAS_WEBSOCKETS:
        return None
    try:
        url = f"http://127.0.0.1:{port}/json"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=2) as resp:
            targets = json.loads(resp.read().decode('utf-8'))
        ws_url = None
        for t in targets:
            if "shopee.vn" in t.get("url", ""):
                ws_url = t.get("webSocketDebuggerUrl")
                break
        if not ws_url and targets:
            ws_url = targets[0].get("webSocketDebuggerUrl")
        if not ws_url:
            return None
        async with websockets.connect(ws_url, max_size=10*1024*1024) as ws:
            msg = {
                "id": 2001,
                "method": "Network.getCookies",
                "params": {"urls": ["https://banhang.shopee.vn", "https://shopee.vn"]}
            }
            await ws.send(json.dumps(msg))
            resp = await ws.recv()
            data = json.loads(resp)
            cookies_list = data.get("result", {}).get("cookies", [])
            cd = {c["name"]: c["value"] for c in cookies_list}
            if cd.get("SPC_ST") or cd.get("SPC_SC_SESSION"):
                return cd
            return None
    except Exception:
        return None

def try_cdp_recovery():
    """Hồi phục phiên tự động bằng CDP nếu Chrome đang mở"""
    try:
        new_cookies = asyncio.run(async_cdp_extract(9222))
        if new_cookies:
            spc_cds = new_cookies.get("SPC_CDS", "78068754-dc8b-492a-8882-736c29a39ad4")
            csrf_token = new_cookies.get("csrftoken", "h1P2HlVFJHvAkVFJLw2GRtx6SALbxBOz")
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["cookies"] = new_cookies
                GLOBAL_STATE["spc_cds"] = spc_cds
                GLOBAL_STATE["csrf_token"] = csrf_token
            save_session(new_cookies, spc_cds, csrf_token, source="CDP_RECOVERY")
            print("[CDP RECOVERY] Đã tự động hồi phục Cookie thành công từ Chrome!")
            return True
    except Exception as e:
        print(f"[CDP RECOVERY] Thất bại: {e}")
    return False

def fetch_shopee_orders(cookies, spc_cds, csrf_token, tab=302, page_size=20):
    url = f"https://banhang.shopee.vn/api/v3/order/search_order_list_index?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/sale/order?type=toship&source=to_process&sort_by=ship_by_date_asc",
        "X-CSRFToken": csrf_token
    }
    body = {
        "order_list_tab": tab,
        "pagination": {
            "page_number": 1,
            "page_size": page_size
        },
        "sort": {
            "order_by_ship_by_date": "asc"
        }
    }
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="SEARCH_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                data = res.get("data", {})
                total = data.get("pagination", {}).get("total", 0)
                index_list = data.get("index_list", [])
                return index_list, total
            return [], 0
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            print(f"[AUTH EXPIRED] Shopee phản hồi {e.code}. Đang kích hoạt tự động hồi phục phiên...")
            try_cdp_recovery()
        return [], 0
    except Exception as e:
        print(f"[ERR] fetch_shopee_orders: {e}")
        return [], 0

def fetch_order_details(cookies, spc_cds, csrf_token, order_list):
    if not order_list:
        return []
    url = f"https://banhang.shopee.vn/api/v3/order/get_order_list_card_list?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/sale/order",
        "X-CSRFToken": csrf_token
    }
    body = { "order_list": order_list }
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="DETAILS_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return res.get("data", {}).get("card_list", [])
            return []
    except Exception as e:
        print(f"[ERR] fetch_order_details: {e}")
        return []

def forward_to_cms_webhook(order_card):
    order_sn = order_card.get("order_sn") or str(order_card.get("order_id", ""))
    buyer_info = order_card.get("buyer_user", {})
    recipient_address = order_card.get("recipient_address", {})
    
    items = []
    item_list = order_card.get("item_list", []) or order_card.get("order_items", [])
    for it in item_list:
        sku = it.get("model_sku") or it.get("item_sku") or it.get("sku") or "UD-TC-001"
        qty = it.get("amount") or it.get("quantity") or 1
        items.append({ "sku": sku, "quantity": qty })
    
    if not items:
        items = [{"sku": "UD-TC-001", "quantity": 1}]

    payload = {
        "event": "INBOUND_ORDER_CREATE",
        "data": {
            "channelKey": "SHOPEE",
            "customerName": recipient_address.get("name") or buyer_info.get("user_name") or f"Khách Shopee #{order_sn[-6:]}",
            "customerPhone": recipient_address.get("phone") or "0900000000",
            "address": recipient_address.get("full_address") or "Shopee Delivery",
            "note": f"Shopee Order #{order_sn}",
            "items": items,
            "paymentMethod": "COD"
        }
    }

    headers = {
        "Authorization": f"Apikey {CMS_API_KEY}",
        "Content-Type": "application/json"
    }

    req = urllib.request.Request(CMS_WEBHOOK_URL, data=json.dumps(payload).encode('utf-8'), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print(f"[SYNC SUCCESS] Đơn Shopee #{order_sn} -> CMS Order: {data.get('orderCode') or data.get('id')}")
            return True
    except Exception as e:
        print(f"[SYNC FAIL] Lỗi đẩy đơn #{order_sn} về CMS: {e}")
        return False

# =============================================================================
# CƠ CHẾ 3: LOCAL HTTP BRIDGE SERVER (CỔNG 51898)
# =============================================================================
class LocalBridgeHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/shopee/status':
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            with GLOBAL_STATE["lock"]:
                resp = {
                    "ok": True,
                    "alive": GLOBAL_STATE["alive"],
                    "shopId": GLOBAL_STATE["shopId"],
                    "username": GLOBAL_STATE["username"],
                    "lastSync": GLOBAL_STATE["lastSync"]
                }
            self.wfile.write(json.dumps(resp).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/shopee/session':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8'))
                incoming_cookies = body.get("cookies", {})
                spc_cds = body.get("spc_cds") or incoming_cookies.get("SPC_CDS", GLOBAL_STATE["spc_cds"])
                csrf_token = body.get("csrf_token") or incoming_cookies.get("csrftoken", GLOBAL_STATE["csrf_token"])
                
                # Test kiểm tra phiên Shopee với cookies mới
                alive, shopid, uname = keep_alive_ping(incoming_cookies, spc_cds, csrf_token)
                if alive:
                    with GLOBAL_STATE["lock"]:
                        GLOBAL_STATE["cookies"] = incoming_cookies
                        GLOBAL_STATE["spc_cds"] = spc_cds
                        GLOBAL_STATE["csrf_token"] = csrf_token
                        GLOBAL_STATE["shopId"] = str(shopid)
                        GLOBAL_STATE["username"] = str(uname)
                        GLOBAL_STATE["alive"] = True
                    save_session(incoming_cookies, spc_cds, csrf_token, source="CHROME_EXTENSION_BRIDGE")
                    print(f"\n[EXTENSION HOOK] Đã nhận Cookie mới từ Chrome Extension: Shop ID {shopid} ({uname})")
                    
                    self.send_response(200)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": True,
                        "shopId": shopid,
                        "username": uname,
                        "cookieCount": len(incoming_cookies),
                        "message": "Cập nhật Cookie thành công!"
                    }).encode('utf-8'))
                else:
                    self.send_response(400)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({"ok": False, "error": "Cookie không hợp lệ đối với Shopee"}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Ẩn log HTTP thừa thãi trong console
        return

def start_http_bridge():
    try:
        server = HTTPServer(('127.0.0.1', BRIDGE_PORT), LocalBridgeHandler)
        print(f"[BRIDGE SERVER] Đang lắng nghe Chrome Extension tại http://127.0.0.1:{BRIDGE_PORT}/shopee/session")
        server.serve_forever()
    except Exception as e:
        print(f"[BRIDGE SERVER ERROR] Không thể mở port {BRIDGE_PORT}: {e}")

def run_loop(interval_sec=30):
    print("==============================================================")
    print("   OPENVN CMS/POS <=> SHOPEE REALTIME SYNC DAEMON")
    print("   3-Tier Auto-Recovery: Keep-Alive + CDP 9222 + Extension 51898")
    print(f"   Target Webhook: {CMS_WEBHOOK_URL}")
    print("==============================================================")

    # 1. Khởi động Local Bridge Server ở luồng ngầm
    t = threading.Thread(target=start_http_bridge, daemon=True)
    t.start()

    # 2. Tải phiên từ file .shopee_session.json
    cookies, spc_cds, csrf_token = load_session()
    with GLOBAL_STATE["lock"]:
        GLOBAL_STATE["cookies"] = cookies
        GLOBAL_STATE["spc_cds"] = spc_cds
        GLOBAL_STATE["csrf_token"] = csrf_token

    alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)
    if not alive:
        print("[WARN] Cookie ban đầu không thể đăng nhập. Đang thử CDP Chrome port 9222...")
        if try_cdp_recovery():
            alive = True
        else:
            print("[INFO] Đang chờ Chrome Extension hoặc mở Kênh Người Bán để đồng bộ tự động...")

    if alive:
        with GLOBAL_STATE["lock"]:
            GLOBAL_STATE["alive"] = True
            GLOBAL_STATE["shopId"] = str(shopid)
            GLOBAL_STATE["username"] = str(uname)
        print(f"[OK] Phiên Shopee hoạt động: Shop ID {shopid} ({uname})")

    last_ping = time.time()

    while True:
        try:
            with GLOBAL_STATE["lock"]:
                curr_cookies = dict(GLOBAL_STATE["cookies"])
                curr_spc_cds = GLOBAL_STATE["spc_cds"]
                curr_csrf = GLOBAL_STATE["csrf_token"]

            # CƠ CHẾ 1: Heartbeat mỗi 10 phút để nuôi phiên trượt (Sliding Session)
            if time.time() - last_ping > 600:
                p_alive, sid, un = keep_alive_ping(curr_cookies, curr_spc_cds, curr_csrf)
                if p_alive:
                    print(f"[{time.strftime('%H:%M:%S')}] [HEARTBEAT] Đã gia hạn phiên trượt Shopee thành công.")
                else:
                    print(f"[{time.strftime('%H:%M:%S')}] [WARN] Heartbeat thất bại. Đang thử hồi phục qua CDP...")
                    try_cdp_recovery()
                last_ping = time.time()

            # Quét đơn hàng mới (Tab 302: Chờ xác nhận)
            synced = load_synced_orders()
            index_list, total = fetch_shopee_orders(curr_cookies, curr_spc_cds, curr_csrf, tab=302)
            print(f"[{time.strftime('%H:%M:%S')}] Đang quét Shopee: {total} đơn Chờ xác nhận (To Process)")

            new_orders = [o for o in index_list if str(o.get("order_id")) not in synced]
            if new_orders:
                print(f"[ACTION] Phát hiện {len(new_orders)} đơn mới! Đang kéo thông tin chi tiết...")
                card_list = fetch_order_details(curr_cookies, curr_spc_cds, curr_csrf, new_orders)
                for card in card_list:
                    if forward_to_cms_webhook(card):
                        synced.add(str(card.get("order_id")))
                        save_synced_orders(synced)

        except Exception as e:
            print(f"[LOOP ERROR] {e}")

        time.sleep(interval_sec)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        cookies, spc_cds, csrf_token = load_session()
        alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)
        print(f"Result: alive={alive}, shopid={shopid}, uname={uname}")
    else:
        run_loop(interval_sec=30)
