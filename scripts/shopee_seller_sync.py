"""
=============================================================================
SHOPEE SELLER SYNC WORKER - ASYNC BIDIRECTIONAL PIPELINE (SÀN <-> CMS)
& 3-TIER SESSION HARDENING (OPENVN CMS/POS - SUPABASE POSTGRESQL)
=============================================================================
Kiến trúc Bất đồng bộ 2 chiều (Asynchronous Bidirectional Pipeline):
1. INBOUND (Sàn Shopee -> Spool Queue -> CMS/Supabase):
   - Phát hiện biến động (Delta Detection) theo modify_time & đa phân loại (Multi-Model).
   - Ghi vào Durable Spool Queue (.shopee_inbound_queue.json) kèm Idempotency Key.
   - Flush bất đồng bộ về CMS Webhook với Exponential Backoff (2^n giây) & Dead-Letter Queue (.shopee_dlq.json).
2. OUTBOUND (CMS/Supabase Transactional Outbox -> Worker -> Sàn Shopee):
   - Kéo các job OUTBOX_PENDING / biến động tồn kho từ CMS (OUTBOX_FETCH_PENDING).
   - Đẩy tồn kho thực tế lên Shopee qua API v3 (/api/v3/product/update_product_stock).
   - Xác nhận ACK (OUTBOX_ACK_RESULT) về CMS Sổ Cái (LedgerEntry) & chống bán lố (Anti-Oversell).
3. 3-TIER SESSION HARDENING:
   - Keep-Alive Heartbeat Daemon (10 phút/lần) + CDP Port 9222 + Chrome Extension Bridge Port 51898.
=============================================================================
"""

import urllib.request
import urllib.error
import json
import ssl
import time
import os
import sys
import threading
import base64
import hashlib
import uuid
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler
import asyncio
import socket

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

CMS_WEBHOOK_URL = os.environ.get("CMS_WEBHOOK_URL", "http://127.0.0.1:3010/api/webhooks/inbound")
CMS_API_KEY = os.environ.get("CMS_API_KEY", "191a5ab9fd0c1e392c51b3e9fbe7df57694c2098b78b4955")
BRIDGE_PORT = int(os.environ.get("BRIDGE_PORT", 51898))
MAX_RETRY_ATTEMPTS = 5

def is_outbox_dry_run():
    """Kiem tra che do DRY_RUN cua Outbox de tranh mutate du lieu Shopee that khi test."""
    env_val = os.environ.get("SHOPEE_OUTBOX_DRY_RUN", "0").strip().lower()
    return env_val in ("1", "true", "yes") or "--dry-run" in sys.argv

def is_inbound_product_sync_disabled():
    """Kiem tra xem luong dong bo ton kho Inbound (Shopee -> CMS) co bi vo hieu hoa khong.
    Khi chay test hoac Dry Run, TUYET DOI KHONG cho phep de ton kho CMS bang so lieu San!"""
    env_val = os.environ.get("SHOPEE_INBOUND_DISABLE", "0").strip().lower()
    env_stock = os.environ.get("SHOPEE_INBOUND_DISABLE_STOCK_OVERWRITE", "0").strip().lower()
    return is_outbox_dry_run() or env_val in ("1", "true", "yes") or env_stock in ("1", "true", "yes")

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

BASE_DIR = os.path.dirname(__file__)
SESSION_FILE = os.path.join(BASE_DIR, ".shopee_session.json")
CACHE_FILE = os.path.join(BASE_DIR, ".shopee_synced_orders.json")
INBOUND_QUEUE_FILE = os.path.join(BASE_DIR, ".shopee_inbound_queue.json")
DLQ_FILE = os.path.join(BASE_DIR, ".shopee_dlq.json")
SYNC_STATE_FILE = os.path.join(BASE_DIR, ".shopee_synced_state.json")

INITIAL_COOKIE_STR = os.environ.get("SHOPEE_INITIAL_COOKIES", "").strip()

GLOBAL_STATE = {
    "cookies": {},
    "spc_cds": "c2344aba-5428-425d-bba9-04838a499109",
    "csrf_token": "0BQKllKGsakrP1WMZnz4ZKeXdP3neixB",
    "shopId": "197195817",
    "username": "thaimy1605",
    "alive": False,
    "paused": False,
    "lastAlertedLost": False,
    "lastAlertReason": "",
    "deferredOutboxCount": 0,
    "lastSync": 0,
    "lastInboundFlush": 0,
    "lastOutboundFlush": 0,
    "inboundProcessed": 0,
    "outboundProcessed": 0,
    "outboundRetries": {},
    "lock": threading.Lock(),
    "queueLock": threading.Lock()
}

# =============================================================================
# TIỆN ÍCH LƯU TRỮ TRẠNG THÁI, SPOOL QUEUE & DEAD-LETTER QUEUE (DLQ)
# =============================================================================
def _read_json_file(path, default_val):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default_val
    return default_val

def _write_json_file(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WARN] Không thể ghi file {path}: {e}")

def load_inbound_queue():
    with GLOBAL_STATE["queueLock"]:
        return _read_json_file(INBOUND_QUEUE_FILE, [])

def save_inbound_queue(q):
    with GLOBAL_STATE["queueLock"]:
        _write_json_file(INBOUND_QUEUE_FILE, q)

def load_dlq():
    with GLOBAL_STATE["queueLock"]:
        return _read_json_file(DLQ_FILE, [])

def append_to_dlq(item, reason):
    with GLOBAL_STATE["queueLock"]:
        dlq = _read_json_file(DLQ_FILE, [])
        dlq.append({
            "failedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "reason": str(reason),
            "item": item
        })
        _write_json_file(DLQ_FILE, dlq[-200:])

def requeue_dlq_to_inbound():
    """Chuyển các sự kiện trong DLQ quay lại hàng đợi Spool Inbound để thử lại bất đồng bộ."""
    with GLOBAL_STATE["queueLock"]:
        dlq = _read_json_file(DLQ_FILE, [])
        if not dlq:
            return 0
        inb_q = _read_json_file(INBOUND_QUEUE_FILE, [])
        existing_keys = {str(x.get("idempotencyKey") or "") for x in inb_q if isinstance(x, dict)}
        for entry in dlq:
            item = entry.get("item") if isinstance(entry, dict) else None
            if isinstance(item, dict) and item.get("event"):
                idem = str(item.get("idempotencyKey") or "")
                if idem and idem in existing_keys:
                    continue
                item["attempts"] = 0
                item["nextRetryAt"] = 0
                inb_q.append(item)
                if idem:
                    existing_keys.add(idem)
        _write_json_file(INBOUND_QUEUE_FILE, inb_q)
        _write_json_file(DLQ_FILE, [])
        return len(dlq)

def _classify_shopee_error(err_val):
    """Phân loại lỗi từ Shopee API để điều phối bất đồng bộ an toàn:
    - AUTH_EXPIRED: Hết hạn phiên Cookie / HTTP 401/403 -> Giữ nguyên trong Outbox (WAITING_SESSION), không đốt retry vào DLQ.
    - BROKEN_LINK: Sản phẩm/phân loại bị xóa hoặc lệch Model ID trên Shopee -> Đánh dấu mất liên kết mã hàng (BROKEN_LINK).
    - TRANSIENT: Lỗi mạng / quá tải tạm thời -> Thử lại theo cấp số nhân (Exponential Backoff).
    """
    raw = str(err_val or "")
    low = raw.lower()
    auth_markers = (
        "http 401",
        "http 403",
        "not login",
        "login required",
        "please login",
        "unauthorized",
        "invalid session",
        "session expired",
        "token expired",
        "100010005",
        "error_auth",
        "forbidden",
    )
    if any(m in low for m in auth_markers):
        return "AUTH_EXPIRED"

    broken_markers = (
        "model_id_mismatch_guard",
        "uninitialized_variation_guard",
        "item not found",
        "product not found",
        "model not found",
        "product_not_exist",
        "item_not_exist",
        "model_not_exist",
        "item is deleted",
        "product has been deleted",
    )
    if any(m in low for m in broken_markers):
        return "BROKEN_LINK"

    return "TRANSIENT"

def load_sync_state():
    return _read_json_file(SYNC_STATE_FILE, {"products": {}, "orders": {}})

def save_sync_state(st):
    _write_json_file(SYNC_STATE_FILE, st)

def enqueue_inbound_event(event_type, payload_data, idempotency_key):
    """Đưa sự kiện từ Shopee vào hàng đợi Spool bất đồng bộ (chống trùng lặp theo idempotency_key)"""
    q = load_inbound_queue()
    for existing in q:
        if existing.get("idempotencyKey") == idempotency_key:
            return False
    q.append({
        "id": f"INB_{int(time.time()*1000)}_{len(q)+1}",
        "event": event_type,
        "idempotencyKey": idempotency_key,
        "data": payload_data,
        "attempts": 0,
        "nextRetryAt": 0,
        "createdAt": time.strftime("%Y-%m-%d %H:%M:%S")
    })
    save_inbound_queue(q)
    return True

# =============================================================================
# QUẢN LÝ PHIÊN SHOPEE (3-TIER HARDENING)
# =============================================================================
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
                # Enforce canonical shop thaimy1605 (SPC_U=197198798), reject legacy mock SPC_U=3813970 or dummy test tokens
                if (
                    isinstance(cookies, dict)
                    and len(cookies) >= 10
                    and str(cookies.get("SPC_U", "")) != "3813970"
                    and cookies.get("SPC_ST") != "test_token"
                ):
                    spc_cds = data.get("spc_cds") or cookies.get("SPC_CDS", "c2344aba-5428-425d-bba9-04838a499109")
                    csrf_token = data.get("csrf_token") or cookies.get("csrftoken", "0BQKllKGsakrP1WMZnz4ZKeXdP3neixB")
                    return cookies, spc_cds, csrf_token
        except Exception:
            pass
    cookies = parse_cookie_str_to_dict(INITIAL_COOKIE_STR)
    spc_cds = cookies.get("SPC_CDS", "c2344aba-5428-425d-bba9-04838a499109")
    csrf_token = cookies.get("csrftoken", "0BQKllKGsakrP1WMZnz4ZKeXdP3neixB")
    if cookies:
        save_session(cookies, spc_cds, csrf_token, source="INITIAL_FALLBACK")
    return cookies, spc_cds, csrf_token

def save_session(cookies, spc_cds, csrf_token, source="AUTO_SLIDING_SESSION"):
    _write_json_file(SESSION_FILE, {
        "cookies": cookies,
        "spc_cds": spc_cds,
        "csrf_token": csrf_token,
        "updated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "source": source
    })

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

def keep_alive_ping(cookies, spc_cds, csrf_token):
    url = f"https://banhang.shopee.vn/api/v2/login/?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
    try:
        new_cookies = asyncio.run(async_cdp_extract(9222))
        if new_cookies:
            spc_cds = new_cookies.get("SPC_CDS", GLOBAL_STATE["spc_cds"])
            csrf_token = new_cookies.get("csrftoken", GLOBAL_STATE["csrf_token"])
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

# =============================================================================
# SHOPEE SELLER CENTER API (READ & WRITE)
# =============================================================================
def fetch_shopee_products(cookies, spc_cds, csrf_token, list_type="all", page_size=24):
    url = f"https://banhang.shopee.vn/api/v3/mpsku/list/get_product_list?SPC_CDS={spc_cds}&SPC_CDS_VER=2&page_number=1&page_size={page_size}&list_type={list_type}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/live/all?operationSortBy=recommend_v2",
        "X-CSRFToken": csrf_token
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="PRODUCT_LIST_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                data = res.get("data", {})
                products = data.get("products", []) or data.get("list", [])
                total = data.get("page_info", {}).get("total", len(products))
                return products, total
            return [], 0
    except Exception as e:
        print(f"[ERR] fetch_shopee_products: {e}")
        return [], 0

def fetch_shopee_product_info(cookies, spc_cds, csrf_token, product_id):
    url = f"https://banhang.shopee.vn/api/v3/product/get_product_info?SPC_CDS={spc_cds}&SPC_CDS_VER=2&product_id={product_id}&is_draft=false"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/live/all?operationSortBy=recommend_v2",
        "X-CSRFToken": csrf_token
    }
    req = urllib.request.Request(url, headers=headers, method="GET")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return res.get("data", {}).get("product_info", {})
    except Exception as e:
        print(f"[ERR] fetch_shopee_product_info({product_id}): {e}")
    return {}

def update_shopee_product_stock(cookies, spc_cds, csrf_token, item_id, model_id, sellable_stock, location_id="VNZ"):
    """API Ghi ngược tồn kho từ CMS Outbox -> Shopee Seller Center (/api/v3/product/update_product_stock).
    BẢO VỆ ĐA PHÂN LOẠI (MULTI-VARIATION GUARD): Luôn lấy đầy đủ model_list hiện hữu từ get_product_info
    để truyền trọn bộ các phân loại anh em (sibling variations), tuyệt đối không gửi model_list 1 phần tử
    khi sản phẩm có nhiều phân loại gây mất giá/xóa model trên Shopee Seller Center.
    """
    if is_outbox_dry_run():
        payload = {
            "item_id": int(item_id) if str(item_id).isdigit() else item_id,
            "model_id": int(model_id) if str(model_id).isdigit() else model_id,
            "sellable_stock": max(0, int(sellable_stock)),
            "location_id": str(location_id or "VNZ")
        }
        print(f"[DRY_RUN] Simulated Shopee update: task_type=STOCK payload={json.dumps(payload)}")
        return True, {"code": 0, "message": "success", "dry_run": True}

    prod_info = fetch_shopee_product_info(cookies, spc_cds, csrf_token, item_id)
    existing_models = prod_info.get("model_list") or []
    full_model_list = []
    target_matched = False

    if existing_models:
        for m in existing_models:
            mid = int(m.get("id") or 0)
            if mid <= 0:
                return False, f"UNINITIALIZED_VARIATION_GUARD: Item {item_id} có phân loại chưa khởi tạo (id=0) trên Shopee, chặn gửi update_product_stock riêng lẻ."
            if mid == int(model_id):
                target_matched = True
                full_model_list.append({
                    "id": mid,
                    "stock_setting_list": [
                        {
                            "location_id": str(location_id or "VNZ"),
                            "sellable_stock": max(0, int(sellable_stock))
                        }
                    ]
                })
            else:
                seller_stocks = (m.get("stock_detail") or {}).get("seller_stock_info") or m.get("stock_setting_list") or []
                if seller_stocks:
                    sibling_stock_list = [
                        {
                            "location_id": str(s.get("location_id") or location_id or "VNZ"),
                            "sellable_stock": max(0, int(s.get("sellable_stock") or 0))
                        }
                        for s in seller_stocks
                    ]
                else:
                    fallback_stk = int((m.get("stock_detail") or {}).get("total_seller_stock") or 0)
                    sibling_stock_list = [
                        {
                            "location_id": str(location_id or "VNZ"),
                            "sellable_stock": max(0, fallback_stk)
                        }
                    ]
                full_model_list.append({
                    "id": mid,
                    "stock_setting_list": sibling_stock_list
                })
        if not target_matched:
            if len(existing_models) == 1:
                only_mid = int(existing_models[0].get("id") or 0)
                full_model_list = [
                    {
                        "id": only_mid,
                        "stock_setting_list": [
                            {
                                "location_id": str(location_id or "VNZ"),
                                "sellable_stock": max(0, int(sellable_stock))
                            }
                        ]
                    }
                ]
            else:
                return False, f"MODEL_ID_MISMATCH_GUARD: Model {model_id} không khớp với danh sách phân loại của Item {item_id}, chặn cập nhật để bảo vệ các phân loại khác."
    else:
        full_model_list = [
            {
                "id": int(model_id),
                "stock_setting_list": [
                    {
                        "location_id": str(location_id or "VNZ"),
                        "sellable_stock": max(0, int(sellable_stock))
                    }
                ]
            }
        ]

    url = f"https://banhang.shopee.vn/api/v3/product/update_product_stock?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/all",
        "X-CSRFToken": csrf_token
    }
    body = [
        {
            "id": int(item_id),
            "model_list": full_model_list
        }
    ]
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="UPDATE_STOCK_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return True, res
            return False, res
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        return False, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return False, str(e)

def update_shopee_product_price(cookies, spc_cds, csrf_token, item_id, model_id, price):
    """API Ghi ngược giá bán từ CMS Outbox -> Shopee Seller Center (/api/v3/product/update_product_price).
    BẢO VỆ ĐA PHÂN LOẠI (MULTI-VARIATION GUARD): Luôn gửi đầy đủ toàn bộ model_list của sản phẩm
    kèm giá hiện tại của các phân loại anh em (sibling variations), tuyệt đối không gửi 1 model đơn lẻ
    khiến Shopee xóa trắng giá của các phân loại còn lại.
    """
    if is_outbox_dry_run():
        payload = {
            "item_id": int(item_id) if str(item_id).isdigit() else item_id,
            "model_id": int(model_id) if str(model_id).isdigit() else model_id,
            "price": str(max(1000, int(price)))
        }
        print(f"[DRY_RUN] Simulated Shopee update: task_type=PRICE payload={json.dumps(payload)}")
        return True, {"code": 0, "message": "success", "dry_run": True}

    prod_info = fetch_shopee_product_info(cookies, spc_cds, csrf_token, item_id)
    existing_models = prod_info.get("model_list") or []
    full_model_list = []
    target_matched = False

    if existing_models:
        for m in existing_models:
            mid = int(m.get("id") or 0)
            if mid <= 0:
                return False, f"UNINITIALIZED_VARIATION_GUARD: Item {item_id} có phân loại chưa khởi tạo (id=0) trên Shopee, chặn gửi update_product_price riêng lẻ."
            if mid == int(model_id):
                target_matched = True
                full_model_list.append({
                    "id": mid,
                    "price": str(max(1000, int(price)))
                })
            else:
                p_info = m.get("price_info") or {}
                sib_price_raw = (
                    p_info.get("input_normal_price")
                    or m.get("price")
                    or p_info.get("normal_price")
                )
                try:
                    sib_price_val = int(float(sib_price_raw)) if sib_price_raw else 0
                except Exception:
                    sib_price_val = 0
                if sib_price_val <= 0:
                    return False, f"SIBLING_PRICE_MISSING_GUARD: Phân loại {mid} của Item {item_id} chưa có giá hợp lệ trên Shopee, chặn cập nhật riêng lẻ."
                full_model_list.append({
                    "id": mid,
                    "price": str(sib_price_val)
                })
        if not target_matched:
            if len(existing_models) == 1:
                only_mid = int(existing_models[0].get("id") or 0)
                full_model_list = [
                    {
                        "id": only_mid,
                        "price": str(max(1000, int(price)))
                    }
                ]
            else:
                return False, f"MODEL_ID_MISMATCH_GUARD: Model {model_id} không khớp với danh sách phân loại của Item {item_id}, chặn cập nhật để bảo vệ giá các phân loại khác."
    else:
        full_model_list = [
            {
                "id": int(model_id),
                "price": str(max(1000, int(price)))
            }
        ]

    url = f"https://banhang.shopee.vn/api/v3/product/update_product_price?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/all",
        "X-CSRFToken": csrf_token
    }
    body = [
        {
            "id": int(item_id),
            "model_list": full_model_list
        }
    ]
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="UPDATE_PRICE_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return True, res
            return False, res
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        return False, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return False, str(e)

def update_shopee_product_status(cookies, spc_cds, csrf_token, item_id, unlisted):
    """API Đổi trạng thái Ẩn / Mở bán sản phẩm từ CMS Outbox -> Shopee Seller Center (/api/v3/product/update_product_status)"""
    if is_outbox_dry_run():
        payload = {
            "item_id": int(item_id) if str(item_id).isdigit() else item_id,
            "unlisted": bool(unlisted)
        }
        print(f"[DRY_RUN] Simulated Shopee update: task_type=STATUS payload={json.dumps(payload)}")
        return True, {"code": 0, "message": "success", "dry_run": True}

    url = f"https://banhang.shopee.vn/api/v3/product/update_product_status?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/all",
        "X-CSRFToken": csrf_token
    }
    body = [
        {
            "id": int(item_id),
            "unlisted": bool(unlisted)
        }
    ]
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="UPDATE_STATUS_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return True, res
            return False, res
    except urllib.error.HTTPError as e:
        err_body = e.read().decode('utf-8', errors='replace')
        return False, f"HTTP {e.code}: {err_body}"
    except Exception as e:
        return False, str(e)

def extract_shopee_image_id(image_url_or_id):
    """Trích xuất mã image_id từ URL CDN Shopee (down-vn.img.susercontent.com/file/<id> hoặc cf.shopee.vn/file/<id>)."""
    raw = str(image_url_or_id or "").strip()
    if not raw:
        return ""
    if "/file/" in raw:
        part = raw.split("/file/", 1)[1].split("?", 1)[0].split("#", 1)[0].strip("/")
        return part
    if not raw.startswith("http") and not raw.startswith("data:") and len(raw) <= 128:
        return raw
    return ""

def decode_image_source_to_bytes(data_url_or_http_url):
    """Giải mã data:image/...;base64,... hoặc tải ảnh từ URL http(s) trong RAM (0 byte ghi đĩa)."""
    src = str(data_url_or_http_url or "").strip()
    if not src:
        return None, "image/webp", "empty_source"
    if src.startswith("data:image/"):
        try:
            header, b64_data = src.split(",", 1)
            mime_type = header.split(";")[0].replace("data:", "").strip() or "image/webp"
            raw_bytes = base64.b64decode(b64_data)
            return raw_bytes, mime_type, None
        except Exception as e:
            return None, "image/webp", f"invalid_data_url: {e}"
    if src.startswith("http://") or src.startswith("https://"):
        try:
            req = urllib.request.Request(
                src,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0 Safari/537.36"}
            )
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
                ct = resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
                raw_bytes = resp.read(5 * 1024 * 1024)
                return raw_bytes, ct, None
        except Exception as e:
            return None, "image/jpeg", f"download_failed: {e}"
    return None, "image/webp", "unsupported_scheme"

def upload_image_to_shopee_cdn(cookies, spc_cds, csrf_token, image_bytes, filename="cms_product.webp", mime_type="image/webp"):
    """
    Tải ảnh từ RAM lên Kho Media CDN của Shopee Seller Center (0 byte lưu trên ổ cứng máy chủ).
    Hoạt động cho CẢ sản phẩm có liên kết Shopee LẪN sản phẩm nội bộ không liên kết sàn (chỉ mượn CDN lưu trữ).
    Trả về: (ok, cdn_url, image_id, detail_msg)
    """
    if not image_bytes:
        return False, "", "", "Empty image bytes"

    digest = hashlib.sha1(image_bytes).hexdigest()[:16]
    if is_outbox_dry_run():
        sim_id = f"vn-11134207-7r98o-cms{digest}"
        sim_url = f"https://down-vn.img.susercontent.com/file/{sim_id}"
        print(f"[DRY_RUN] Simulated Shopee Media CDN upload: size={len(image_bytes)}B -> {sim_url}")
        return True, sim_url, sim_id, "DRY_RUN_CDN"

    boundary = f"----WebKitFormBoundary{uuid.uuid4().hex}"
    ext = "webp"
    if "png" in mime_type:
        ext = "png"
    elif "jpeg" in mime_type or "jpg" in mime_type:
        ext = "jpg"
    safe_filename = filename if "." in str(filename or "") else f"product_{digest[:8]}.{ext}"

    endpoints = [
        f"https://banhang.shopee.vn/api/v3/general/upload_image?SPC_CDS={spc_cds}&SPC_CDS_VER=2",
        f"https://banhang.shopee.vn/api/v3/media_space/upload_image?SPC_CDS={spc_cds}&SPC_CDS_VER=2",
    ]

    body_parts = []
    body_parts.append(f"--{boundary}\r\n".encode("utf-8"))
    body_parts.append(
        f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'.encode("utf-8")
    )
    body_parts.append(f"Content-Type: {mime_type}\r\n\r\n".encode("utf-8"))
    body_parts.append(image_bytes)
    body_parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    multipart_body = b"".join(body_parts)

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/all",
        "X-CSRFToken": csrf_token,
    }

    ctx = ssl.create_default_context()
    last_err = ""
    for ep in endpoints:
        try:
            req = urllib.request.Request(ep, data=multipart_body, headers=headers, method="POST")
            with urllib.request.urlopen(req, context=ctx, timeout=12) as resp:
                if update_cookies_from_headers(cookies, resp.getheaders()):
                    save_session(cookies, spc_cds, csrf_token, source="UPLOAD_IMAGE_RESPONSE")
                res = json.loads(resp.read().decode("utf-8", errors="replace"))
                data_obj = res.get("data") or {}
                if isinstance(data_obj, dict):
                    img_id = (
                        data_obj.get("resource_id")
                        or data_obj.get("image_id")
                        or data_obj.get("file_name")
                        or data_obj.get("id")
                        or ""
                    )
                    if not img_id and isinstance(data_obj.get("resource"), dict):
                        img_id = data_obj["resource"].get("resource_id") or data_obj["resource"].get("id") or ""
                    if img_id:
                        cdn_url = f"https://down-vn.img.susercontent.com/file/{img_id}"
                        return True, cdn_url, str(img_id), "SHOPEE_MEDIA_CDN"
                last_err = json.dumps(res, ensure_ascii=False)
        except Exception as e:
            last_err = str(e)

    return False, "", "", last_err or "Shopee Media upload failed"

def update_shopee_product_image(cookies, spc_cds, csrf_token, item_id, model_id, target_image):
    """
    Đồng bộ ảnh đại diện sản phẩm hoặc ảnh phân loại (tier_variation) từ CMS lên Sàn Shopee.
    Nếu target_image chưa phải link CDN Shopee (ví dụ data:image/... hoặc URL ngoài), tự động đẩy lên Shopee Media CDN trước.
    """
    img_id = extract_shopee_image_id(target_image)
    cdn_url = f"https://down-vn.img.susercontent.com/file/{img_id}" if img_id else ""

    if not img_id:
        raw_bytes, mime_type, err = decode_image_source_to_bytes(target_image)
        if err or not raw_bytes:
            return False, "", f"Cannot decode target_image: {err}"
        up_ok, up_url, up_id, up_msg = upload_image_to_shopee_cdn(
            cookies, spc_cds, csrf_token, raw_bytes, filename="cms_sync.webp", mime_type=mime_type
        )
        if not up_ok or not up_id:
            return False, "", f"Shopee CDN upload failed: {up_msg}"
        img_id = up_id
        cdn_url = up_url

    if not item_id:
        return True, cdn_url, {"imageId": img_id, "cdnUrl": cdn_url, "unlinkedOnly": True}

    if is_outbox_dry_run():
        payload = {
            "item_id": int(item_id) if str(item_id).isdigit() else item_id,
            "model_id": int(model_id) if str(model_id or "").isdigit() else model_id,
            "image_id": img_id,
            "cdn_url": cdn_url,
        }
        print(f"[DRY_RUN] Simulated Shopee update: task_type=IMAGE payload={json.dumps(payload)}")
        return True, cdn_url, {"code": 0, "message": "success", "dry_run": True, "imageId": img_id, "cdnUrl": cdn_url}

    prod_info = fetch_shopee_product_info(cookies, spc_cds, csrf_token, item_id)
    if not prod_info:
        return True, cdn_url, {"imageId": img_id, "cdnUrl": cdn_url, "note": "CDN uploaded; product_info unavailable"}

    images_list = list(prod_info.get("images") or [])
    tier_variations = prod_info.get("tier_variation") or []
    models = prod_info.get("model_list") or []

    updated_tier = False
    if model_id and tier_variations and models:
        target_model = None
        for m in models:
            if str(m.get("id") or "") == str(model_id):
                target_model = m
                break
        if target_model:
            tier_idx_list = target_model.get("tier_index") or []
            if tier_idx_list and len(tier_variations) > 0 and isinstance(tier_variations[0], dict):
                opt_idx = tier_idx_list[0]
                tv0 = tier_variations[0]
                opts = tv0.get("options") or []
                imgs = list(tv0.get("images") or [])
                while len(imgs) < len(opts):
                    imgs.append("")
                if isinstance(opt_idx, int) and 0 <= opt_idx < len(imgs):
                    imgs[opt_idx] = img_id
                    tv0["images"] = imgs
                    updated_tier = True

    if not updated_tier:
        if img_id in images_list:
            images_list.remove(img_id)
        images_list.insert(0, img_id)
        images_list = images_list[:9]
    elif not images_list:
        images_list = [img_id]

    url = f"https://banhang.shopee.vn/api/v3/product/update_product_info?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/product/list/all",
        "X-CSRFToken": csrf_token,
    }
    update_payload = {
        "id": int(item_id),
        "images": images_list,
    }
    if updated_tier:
        update_payload["tier_variation"] = tier_variations

    req = urllib.request.Request(url, data=json.dumps([update_payload]).encode("utf-8"), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="UPDATE_IMAGE_RESPONSE")
            res = json.loads(resp.read().decode("utf-8", errors="replace"))
            return True, cdn_url, res
    except Exception as e:
        # Ngay cả khi endpoint update_product_info yêu cầu thêm trường ngành hàng, link CDN đã được cấp thành công (0 byte DB)
        return True, cdn_url, {"imageId": img_id, "cdnUrl": cdn_url, "warning": str(e)}

def fetch_shopee_orders(cookies, spc_cds, csrf_token, tab=302, page_size=20):
    url = f"https://banhang.shopee.vn/api/v3/order/search_order_list_index?SPC_CDS={spc_cds}&SPC_CDS_VER=2"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/sale/order",
        "X-CSRFToken": csrf_token
    }
    body = {
        "order_list_tab": tab,
        "pagination": {"page_number": 1, "page_size": page_size}
    }
    if tab in (302, 303):
        body["sort"] = {"order_by_ship_by_date": "asc"}
    elif tab in (304, 305, 306):
        body["sort"] = {"order_by_create_time": "desc"}
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            if update_cookies_from_headers(cookies, resp.getheaders()):
                save_session(cookies, spc_cds, csrf_token, source="SEARCH_ORDER_RESPONSE")
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                data = res.get("data", {})
                total = data.get("pagination", {}).get("total", 0)
                index_list = data.get("index_list", [])
                return index_list, total
            return [], 0
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
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
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Cookie": dict_to_cookie_str(cookies),
        "Content-Type": "application/json;charset=UTF-8",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://banhang.shopee.vn/portal/sale/order",
        "X-CSRFToken": csrf_token
    }
    body = {"order_list": order_list}
    req = urllib.request.Request(url, data=json.dumps(body).encode('utf-8'), headers=headers, method="POST")
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            res = json.loads(resp.read().decode('utf-8'))
            if res.get("code") == 0:
                return res.get("data", {}).get("card_list", [])
            return []
    except Exception as e:
        print(f"[ERR] fetch_order_details: {e}")
        return []

# =============================================================================
# GIAO TIẾP WEBHOOK CMS & BỘ XỬ LÝ BẤT ĐỒNG BỘ 2 CHIỀU
# =============================================================================
def call_cms_webhook(event_name, data_obj, timeout=12):
    payload = {"event": event_name, "data": data_obj}
    headers = {
        "Authorization": f"Apikey {CMS_API_KEY}",
        "Content-Type": "application/json"
    }
    req = urllib.request.Request(
        CMS_WEBHOOK_URL,
        data=json.dumps(payload).encode('utf-8'),
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return True, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        err_text = e.read().decode('utf-8', errors='replace')
        return False, f"HTTP {e.code}: {err_text}"
    except Exception as e:
        return False, str(e)

def detect_and_enqueue_inbound_products(cookies, spc_cds, csrf_token, shop_id, username, force=False):
    """
    LUỒNG 1A (INBOUND PRODUCER - TỐI ƯU HÓA DELTA & CACHE META):
    Quét danh sách sản phẩm & phân loại (variations) trên Shopee.
    - Kiểm tra Idempotency Key ngay trên prod_summary (Zero-Detail-Call khi không có thay đổi).
    - Cache metadata chi tiết (mô tả, bộ ảnh, kích thước) theo modify_time để tránh gọi lặp get_product_info.
    """
    prods, prod_total = fetch_shopee_products(cookies, spc_cds, csrf_token, list_type="all")
    sync_state = load_sync_state()
    prod_state = sync_state.setdefault("products", {})
    item_meta_cache = sync_state.setdefault("itemMeta", {})
    enqueued_count = 0
    meta_dirty = False

    for prod_summary in prods:
        item_id = str(prod_summary.get("id", ""))
        modify_time = int(prod_summary.get("modify_time") or 0)
        parent_sku = (prod_summary.get("parent_sku") or "").strip()
        base_name = (prod_summary.get("name") or f"Shopee Product #{item_id}").strip()
        summary_models = prod_summary.get("model_list") or []
        valid_models = [m for m in summary_models if m.get("id") and str(m.get("id")) != "0"]

        # Pre-check nhanh trên summary: nếu không force và mọi model đều trùng idempotencyKey -> bỏ qua ngay (0 HTTP call phụ)
        parsed_models = []
        any_model_changed = False
        for m in valid_models:
            model_id = str(m.get("id") or "")
            model_sku = (m.get("sku") or "").strip()
            raw_model_name = (m.get("name") or "").strip()
            name_parts = [pt.strip() for pt in raw_model_name.split(" - ") if pt.strip()]
            model_name = name_parts[0] if (len(name_parts) == 2 and name_parts[0].lower() == name_parts[1].lower()) else raw_model_name
            cms_sku = (model_sku or parent_sku) if len(summary_models) == 1 else model_sku
            model_state_key = f"MODEL_{item_id}_{model_id}"
            state_key = cms_sku or model_state_key

            price_info_obj = m.get("price_info") or {}
            price_str = (
                price_info_obj.get("input_normal_price")
                or m.get("price")
                or price_info_obj.get("normal_price")
            )
            try:
                sell_price = int(float(price_str)) if price_str else 0
            except Exception:
                sell_price = 0
            if sell_price <= 0:
                print(f"[INBOUND GUARD] Bỏ qua đồng bộ giá trống từ Shopee cho Model {model_id} (Item {item_id}) để bảo vệ giá CMS.")
                continue

            stock_from_detail = m.get("stock_detail", {}).get("total_available_stock") or m.get("stock_detail", {}).get("TotalAvailableStock")
            if stock_from_detail is not None:
                stock = int(stock_from_detail)
            else:
                stock_settings = m.get("stock_setting_list") or []
                stock = sum(int(s.get("sellable_stock") or 0) for s in stock_settings)

            is_summary_unlisted = bool(
                prod_summary.get("is_unlisted")
                or prod_summary.get("tag", {}).get("unlist")
                or str(prod_summary.get("status", "")).lower() in ("unlisted", "banned", "deleted")
            )
            idem_key = f"SHOPEE_PROD_{item_id}_{model_id}_{modify_time}_{sell_price}_{stock}_{1 if is_summary_unlisted else 0}"
            prev_entry = prod_state.get(state_key, {}) or prod_state.get(model_state_key, {})
            prev_idem = prev_entry.get("idempotencyKey")
            prev_unlisted = prev_entry.get("isUnlisted")
            is_changed = force or (prev_idem != idem_key) or (prev_unlisted is not None and prev_unlisted != is_summary_unlisted)
            if is_changed:
                any_model_changed = True

            parsed_models.append({
                "model_id": model_id,
                "model_sku": model_sku,
                "model_name": model_name,
                "cms_sku": cms_sku,
                "state_key": state_key,
                "model_state_key": model_state_key,
                "sell_price": sell_price,
                "stock": stock,
                "idem_key": idem_key,
                "is_changed": is_changed,
            })

        if valid_models and not any_model_changed:
            continue

        # Chỉ gọi get_product_info khi chưa có cache theo modify_time
        is_summary_unlisted_item = bool(
            prod_summary.get("is_unlisted")
            or prod_summary.get("tag", {}).get("unlist")
            or str(prod_summary.get("status", "")).lower() in ("unlisted", "banned", "deleted")
        )
        cached_meta = item_meta_cache.get(item_id)
        if (
            not force
            and cached_meta
            and cached_meta.get("modifyTime") == modify_time
            and cached_meta.get("imagesUrls")
            and "variantImagesMap" in cached_meta
            and "modelDetailsMap" in cached_meta
        ):
            images_urls = cached_meta["imagesUrls"]
            cover_url = images_urls[0] if images_urls else None
            desc = cached_meta.get("description") or base_name
            is_unlisted = is_summary_unlisted_item
            weight_gram = cached_meta.get("weightGram", "250")
            dimension_cm = cached_meta.get("dimensionCm", {})
            category_path = cached_meta.get("categoryPath", [])
            tier_variation_name = cached_meta.get("tierVariationName", "")
            variant_images_map = cached_meta.get("variantImagesMap", {})
            model_details_map = cached_meta.get("modelDetailsMap", {})
            pre_order_info = cached_meta.get("preOrderInfo", {})
            brand_info = cached_meta.get("brandInfo", {})
            condition_val = cached_meta.get("condition", 1)
        else:
            prod_detail = fetch_shopee_product_info(cookies, spc_cds, csrf_token, item_id)
            images_ids = prod_detail.get("images") or ([prod_summary.get("cover_image")] if prod_summary.get("cover_image") else [])
            images_urls = [f"https://down-vn.img.susercontent.com/file/{img}" for img in images_ids if img]
            cover_url = images_urls[0] if images_urls else None
            desc = prod_detail.get("description_info", {}).get("description") or base_name
            is_unlisted = bool(prod_detail.get("is_unlisted") or is_summary_unlisted_item)
            weight_gram = str((prod_detail.get("weight") or {}).get("value") or "250")
            dimension_cm = prod_detail.get("dimension") or {}
            category_path = prod_detail.get("category_path_name_list") or []
            pre_order_info = prod_detail.get("pre_order_info") or {}
            brand_info = prod_detail.get("brand_info") or {}
            condition_val = prod_detail.get("condition", 1)

            tier_variation_name = ""
            variant_images_map = {}
            for tv in prod_detail.get("tier_variation") or []:
                if isinstance(tv, dict):
                    if not tier_variation_name and tv.get("name"):
                        tier_variation_name = str(tv.get("name")).strip()
                    opts = tv.get("options") or []
                    imgs = tv.get("images") or []
                    for idx_opt, opt in enumerate(opts):
                        opt_name = (opt.get("option") if isinstance(opt, dict) else str(opt or "")).strip()
                        img_id = imgs[idx_opt] if idx_opt < len(imgs) else (opt.get("image") if isinstance(opt, dict) else None)
                        if opt_name and img_id:
                            variant_images_map[opt_name] = f"https://down-vn.img.susercontent.com/file/{img_id}"

            model_details_map = {}
            for dm in prod_detail.get("model_list") or []:
                dmid = str(dm.get("id") or "")
                if not dmid:
                    continue
                dm_w = (dm.get("weight") or {}).get("value")
                dm_d = dm.get("dimension")
                model_details_map[dmid] = {
                    "weightGram": str(dm_w) if dm_w else weight_gram,
                    "dimensionCm": dm_d if isinstance(dm_d, dict) and dm_d else dimension_cm,
                }

            item_meta_cache[item_id] = {
                "modifyTime": modify_time,
                "imagesUrls": images_urls,
                "description": desc,
                "isUnlisted": is_unlisted,
                "weightGram": weight_gram,
                "dimensionCm": dimension_cm,
                "categoryPath": category_path,
                "tierVariationName": tier_variation_name,
                "variantImagesMap": variant_images_map,
                "modelDetailsMap": model_details_map,
                "preOrderInfo": pre_order_info,
                "brandInfo": brand_info,
                "condition": condition_val,
            }
            meta_dirty = True

        for pm in parsed_models:
            if not pm["is_changed"]:
                continue

            model_id = pm["model_id"]
            model_sku = pm["model_sku"]
            model_name = pm["model_name"]
            cms_sku = pm["cms_sku"]
            sell_price = pm["sell_price"]
            stock = pm["stock"]
            idem_key = pm["idem_key"]
            full_name = base_name if not model_name else f"{base_name} — Phân loại: {model_name}"
            model_img = variant_images_map.get(model_name) or cover_url
            m_meta = model_details_map.get(model_id) or {}
            model_weight_gram = str(m_meta.get("weightGram") or weight_gram)
            model_dim_cm = m_meta.get("dimensionCm") or dimension_cm

            payload_data = {
                "idempotencyKey": idem_key,
                "shopeeItemId": item_id,
                "shopeeModelId": model_id,
                "shopeeModifyTime": modify_time,
                "sku": cms_sku,
                "modelSku": model_sku,
                "parentSku": parent_sku,
                "modelName": model_name,
                "name": full_name,
                "description": desc,
                "sellPrice": sell_price,
                "costPrice": 25000 if sell_price <= 65000 else int(round(sell_price * 0.42)),
                "stock": stock,
                "image": model_img,
                "images": images_urls,
                "isUnlisted": is_unlisted,
                "shopId": str(shop_id),
                "shopUsername": str(username),
                "attributes": {
                    "modelSku": model_sku,
                    "modelName": model_name,
                    "parentSku": parent_sku,
                    "tierVariationName": tier_variation_name,
                    "coverImage": cover_url,
                    "variantImage": model_img,
                    "weightGram": model_weight_gram,
                    "dimensionCm": model_dim_cm,
                    "categoryPath": category_path,
                    "preOrderInfo": pre_order_info,
                    "shopeeBrand": brand_info,
                    "condition": condition_val,
                }
            }
            if enqueue_inbound_event("INBOUND_SHOPEE_PRODUCT_SYNC", payload_data, idem_key):
                enqueued_count += 1
                print(f"[INBOUND QUEUE +] Enqueued [{cms_sku or 'CHƯA_CÓ_SKU'}] (Model: {model_id} · {model_name or 'Mặc định'}) | Giá: {sell_price:,}đ | Tồn: {stock}")

    if meta_dirty:
        save_sync_state(sync_state)

    return enqueued_count, prod_total

def extract_tracking_and_carrier(card):
    """
    Trích xuất mã vận đơn (tracking_no) và đơn vị vận chuyển (shipping_carrier)
    từ toàn bộ các vị trí cấu trúc JSON của Shopee v3 card list.
    """
    tracking_no = (
        card.get("tracking_no")
        or card.get("tracking_number")
        or card.get("waybill_no")
        or ""
    )
    carrier = (
        card.get("shipping_carrier")
        or card.get("logistic_channel_name")
        or card.get("shipping_method")
        or card.get("carrier")
        or ""
    )

    if not tracking_no or not carrier:
        for pkg in card.get("package_list", []) or []:
            if not tracking_no:
                tracking_no = pkg.get("tracking_no") or pkg.get("waybill_no") or pkg.get("tracking_number") or ""
            if not carrier:
                carrier = pkg.get("shipping_carrier") or pkg.get("logistic_channel_name") or pkg.get("carrier_name") or ""
            if tracking_no and carrier:
                break

    if not tracking_no or not carrier:
        for f in card.get("fulfillment_list", []) or []:
            if not tracking_no:
                tracking_no = f.get("tracking_no") or f.get("waybill_no") or ""
            if not carrier:
                carrier = f.get("shipping_carrier") or f.get("logistic_channel_name") or ""
            if tracking_no and carrier:
                break

    logistics = card.get("order_logistics") or card.get("logistics") or card.get("logistics_channel") or {}
    if isinstance(logistics, dict):
        if not tracking_no:
            tracking_no = logistics.get("tracking_no") or logistics.get("tracking_number") or logistics.get("waybill_no") or ""
        if not carrier:
            carrier = logistics.get("shipping_carrier") or logistics.get("logistic_channel_name") or logistics.get("carrier_name") or logistics.get("channel_name") or ""

    return str(tracking_no).strip(), str(carrier).strip()

def detect_and_enqueue_inbound_orders(cookies, spc_cds, csrf_token):
    """
    LUỒNG 1B (INBOUND ORDER PRODUCER): Quét đơn hàng Shopee ở trọn vẹn 5 tab vòng đời:
    - Tab 302 (Chờ giao hàng - Chưa xử lý: READY_TO_SHIP)
    - Tab 303 (Chờ giao hàng - Đã xử lý: PROCESSED)
    - Tab 304 (Đang giao: SHIPPED)
    - Tab 305 (Hoàn thành: COMPLETED)
    - Tab 306 (Đã hủy: CANCELLED)
    và đẩy vào Spool Queue bất đồng bộ.
    """
    sync_state = load_sync_state()
    ord_state = sync_state.get("orders", {})
    enqueued_count = 0

    ORDER_LIFECYCLE_TABS = [
        (302, "READY_TO_SHIP"),
        (303, "PROCESSED"),
        (304, "SHIPPED"),
        (305, "COMPLETED"),
        (306, "CANCELLED"),
    ]

    for tab_id, tab_status in ORDER_LIFECYCLE_TABS:
        index_list, _ = fetch_shopee_orders(cookies, spc_cds, csrf_token, tab=tab_id)
        if not index_list:
            continue

        # Lọc nhanh các đơn ở tab cuối đã đồng bộ để tránh gọi thừa get_order_list_card_list
        if tab_id == 305:
            index_list = [
                it for it in index_list
                if not str(ord_state.get(it.get("order_sn") or str(it.get("order_id")), {}).get("idempotencyKey", "")).endswith("_COMPLETED")
            ]
        elif tab_id == 306:
            index_list = [
                it for it in index_list
                if not str(ord_state.get(it.get("order_sn") or str(it.get("order_id")), {}).get("idempotencyKey", "")).endswith("_CANCELLED")
            ]

        if not index_list:
            continue

        card_list = fetch_order_details(cookies, spc_cds, csrf_token, index_list)
        for card in card_list:
            order_sn = card.get("order_sn") or str(card.get("order_id", ""))
            if not order_sn:
                continue

            raw_status = card.get("status")
            if isinstance(raw_status, int):
                status_str = {
                    1: "UNPAID", 2: "READY_TO_SHIP", 3: "PROCESSED",
                    4: "SHIPPED", 5: "COMPLETED", 6: "CANCELLED", 7: "IN_CANCEL"
                }.get(raw_status, tab_status)
            elif isinstance(raw_status, str) and raw_status.strip():
                status_str = raw_status.strip().upper()
            else:
                status_str = tab_status

            idem_key = f"SHOPEE_ORD_{order_sn}_{status_str}"
            if ord_state.get(order_sn, {}).get("idempotencyKey") == idem_key:
                continue

            buyer_info = card.get("buyer_user", {})
            recipient_address = card.get("recipient_address", {})
            buyer_username = (
                buyer_info.get("user_name")
                or buyer_info.get("username")
                or card.get("buyer_username")
                or ""
            )

            tracking_no, carrier = extract_tracking_and_carrier(card)
            shipping_fee = float(card.get("shipping_fee") or card.get("actual_shipping_fee") or 0)

            items = []
            item_list = card.get("item_list", []) or card.get("order_items", [])
            for it in item_list:
                items.append({
                    "sku": it.get("item_sku") or it.get("sku") or "BM-SEN-01",
                    "modelSku": it.get("model_sku") or "",
                    "shopeeModelId": it.get("model_id") or "",
                    "quantity": int(it.get("amount") or it.get("quantity") or 1)
                })

            payload_data = {
                "idempotencyKey": idem_key,
                "shopeeOrderSn": order_sn,
                "shopeeOrderId": card.get("order_id"),
                "shopeeOrderStatus": status_str,
                "customerName": recipient_address.get("name") or (f"Shopee @{buyer_username}" if buyer_username else f"Khách Shopee #{order_sn[-6:]}"),
                "customerPhone": recipient_address.get("phone") or "0900000000",
                "buyerUsername": buyer_username,
                "address": recipient_address.get("full_address") or "Shopee Delivery",
                "items": items,
                "paymentMethod": "SHOPEE_WALLET",
                "trackingNumber": tracking_no or None,
                "shippingCarrier": carrier or None,
                "shippingFee": shipping_fee,
            }
            if enqueue_inbound_event("INBOUND_SHOPEE_ORDER_SYNC", payload_data, idem_key):
                enqueued_count += 1
                print(f"[INBOUND QUEUE +] Enqueued Order #{order_sn} ({status_str}) [Tab {tab_id}]")

    return enqueued_count

def flush_inbound_queue_to_cms():
    """
    LUỒNG 1C (INBOUND CONSUMER - GOM LÔ BATCH SYNC SIÊU TỐC):
    Đọc từ .shopee_inbound_queue.json:
    - Gom toàn bộ job INBOUND_SHOPEE_PRODUCT_SYNC đến hạn thành 1 request INBOUND_SHOPEE_BATCH_SYNC duy nhất (giảm N lần roundtrip tới CMS/Supabase xuống còn 1).
    - Áp dụng Exponential Backoff (2^attempt giây) và chuyển sang Dead-Letter Queue (.shopee_dlq.json) sau 5 lần lỗi.
    """
    queue = load_inbound_queue()
    if not queue:
        return 0

    now = time.time()
    remaining = []
    ready_product_jobs = []
    ready_other_jobs = []
    processed = 0
    sync_state = load_sync_state()

    for job in queue:
        if job.get("nextRetryAt", 0) > now:
            remaining.append(job)
        elif job.get("event") == "INBOUND_SHOPEE_PRODUCT_SYNC":
            ready_product_jobs.append(job)
        else:
            ready_other_jobs.append(job)

    # 1. Xử lý gom lô (Batch Sync) cho toàn bộ sản phẩm/phân loại Shopee trong 1 HTTP request duy nhất
    if ready_product_jobs:
        batch_items = [j["data"] for j in ready_product_jobs]
        ok, resp = call_cms_webhook("INBOUND_SHOPEE_BATCH_SYNC", {"items": batch_items}, timeout=20)
        if ok and isinstance(resp, dict) and resp.get("ok"):
            results_list = resp.get("results") or []
            processed += len(ready_product_jobs)
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["inboundProcessed"] += len(ready_product_jobs)
                GLOBAL_STATE["lastInboundFlush"] = int(time.time())

            for idx, job in enumerate(ready_product_jobs):
                data = job["data"]
                idem_key = job["idempotencyKey"]
                item_res = results_list[idx] if idx < len(results_list) else {}
                sku = (
                    item_res.get("product", {}).get("sku")
                    or data.get("sku")
                    or f"MODEL_{data.get('shopeeItemId')}_{data.get('shopeeModelId')}"
                )
                model_key = f"MODEL_{data.get('shopeeItemId')}_{data.get('shopeeModelId')}"
                action_res = item_res.get("action", "SYNCED")
                is_unlisted_val = bool(data.get("isUnlisted"))
                state_entry = {
                    "idempotencyKey": idem_key,
                    "shopeeItemId": data.get("shopeeItemId"),
                    "shopeeModelId": data.get("shopeeModelId"),
                    "stock": item_res.get("product", {}).get("stock", data.get("stock")),
                    "sellPrice": data.get("sellPrice"),
                    "isUnlisted": is_unlisted_val,
                    "action": action_res,
                    "syncedAt": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                sync_state.setdefault("products", {})[sku] = state_entry
                sync_state["products"][model_key] = state_entry

                if action_res == "QUEUED_FOR_PRODUCT_LINKING":
                    print(f"[INBOUND BATCH -> LINK QUEUE] Model {data.get('shopeeModelId')} ({data.get('modelName')}) chưa khớp SKU -> Đã đưa vào Hàng đợi Liên kết Sản phẩm!")
                elif is_unlisted_val:
                    print(f"[INBOUND BATCH -> CẢNH BÁO ẨN SÀN] [{sku}] đang bị ẨN trên Shopee (Item #{data.get('shopeeItemId')}) -> Đã báo về CMS!")
                else:
                    print(f"[INBOUND BATCH -> CMS OK] [{sku}] -> {action_res} (Tồn: {state_entry['stock']}, Giá: {data.get('sellPrice'):,}đ)")
        else:
            # Nếu Batch lỗi, tăng attempt cho từng job trong lô
            for job in ready_product_jobs:
                attempts = int(job.get("attempts", 0)) + 1
                job["attempts"] = attempts
                job["lastError"] = str(resp)
                if attempts >= MAX_RETRY_ATTEMPTS:
                    append_to_dlq(job, resp)
                else:
                    backoff = min(300, 2 ** attempts)
                    job["nextRetryAt"] = int(now + backoff)
                    remaining.append(job)

    # 2. Xử lý các sự kiện khác (Đơn hàng, v.v.)
    for job in ready_other_jobs:
        ev = job["event"]
        data = job["data"]
        idem_key = job["idempotencyKey"]

        ok, resp = call_cms_webhook(ev, data)
        if ok and isinstance(resp, dict) and resp.get("ok"):
            processed += 1
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["inboundProcessed"] += 1
                GLOBAL_STATE["lastInboundFlush"] = int(time.time())

            if ev == "INBOUND_SHOPEE_ORDER_SYNC":
                order_sn = data.get("shopeeOrderSn")
                sync_state.setdefault("orders", {})[order_sn] = {
                    "idempotencyKey": idem_key,
                    "cmsOrderCode": resp.get("order", {}).get("code"),
                    "syncedAt": time.strftime("%Y-%m-%d %H:%M:%S")
                }
                print(f"[INBOUND -> CMS OK] Order #{order_sn} -> {resp.get('action')} ({resp.get('order', {}).get('code')})")
        else:
            attempts = int(job.get("attempts", 0)) + 1
            job["attempts"] = attempts
            job["lastError"] = str(resp)
            if attempts >= MAX_RETRY_ATTEMPTS:
                print(f"[INBOUND -> DLQ] Job {job['id']} ({idem_key}) vượt quá {MAX_RETRY_ATTEMPTS} lần thử -> Chuyển vào Dead-Letter Queue! Lỗi: {resp}")
                append_to_dlq(job, resp)
            else:
                backoff = min(300, 2 ** attempts)
                job["nextRetryAt"] = int(now + backoff)
                print(f"[INBOUND RETRY #{attempts}] Job {job['id']} ({idem_key}) sẽ thử lại sau {backoff}s. Lỗi: {resp}")
                remaining.append(job)

    save_inbound_queue(remaining)
    save_sync_state(sync_state)
    return processed

def notify_session_alert(alert_type, reason=""):
    """Báo cáo tức thì trạng thái phiên kết nối Shopee (SESSION_LOST / SESSION_RESTORED) về CMS để hiển thị cảnh báo toàn cục."""
    if is_outbox_dry_run():
        return False
    with GLOBAL_STATE["lock"]:
        shop_id = GLOBAL_STATE.get("shopId") or "197195817"
        uname = GLOBAL_STATE.get("username") or "thaimy1605"
        deferred_cnt = int(GLOBAL_STATE.get("deferredOutboxCount") or 0)
    ok, _ = call_cms_webhook("INBOUND_SHOPEE_SESSION_ALERT", {
        "alertType": alert_type,
        "shopId": str(shop_id),
        "username": str(uname),
        "reason": str(reason or ""),
        "deferredOutboxCount": deferred_cnt,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S")
    })
    return ok

def process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token):
    """
    LUỒNG 2 (OUTBOUND CONSUMER: CMS -> Sàn Shopee):
    Kéo các tác vụ OUTBOX_PENDING / biến động tồn kho, giá bán, ẩn/hiện từ CMS (OUTBOX_FETCH_PENDING),
    gọi API v3 của Shopee (update_product_stock, update_product_price, update_product_status),
    và gửi ACK (OUTBOX_ACK_RESULT) về CMS.
    """
    ok, resp = call_cms_webhook("OUTBOX_FETCH_PENDING", {})
    if not ok or not isinstance(resp, dict) or not resp.get("ok"):
        return 0

    jobs = resp.get("jobs", [])
    if not jobs:
        with GLOBAL_STATE["lock"]:
            GLOBAL_STATE["deferredOutboxCount"] = 0
        return 0

    if not is_outbox_dry_run():
        with GLOBAL_STATE["lock"]:
            is_alive = bool(GLOBAL_STATE.get("alive"))
        if not is_alive:
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["deferredOutboxCount"] = len(jobs)
            print(f"[OUTBOX WAITING_SESSION] Phiên Cookie Shopee mất kết nối — Giữ an toàn {len(jobs)} tác vụ trong hàng đợi bất đồng bộ (0 đốt retry / 0 rơi vào DLQ).")
            return 0

    completed_count = 0
    sync_state = load_sync_state()
    handled_status_items = {}

    for job in jobs:
        outbox_id = job.get("outboxId")
        sku = job.get("sku")
        item_id = job.get("shopeeItemId")
        model_id = job.get("shopeeModelId")
        target_stock = int(job.get("targetStock", 0))
        target_price = int(job.get("targetPrice", 0))
        target_unlisted = bool(job.get("targetUnlisted", False))
        target_image = str(job.get("targetImage") or "").strip()
        stock_drifted = bool(job.get("stockDrifted", True))
        price_drifted = bool(job.get("priceDrifted", False))
        unlisted_drifted = bool(job.get("unlistedDrifted", False))
        image_drifted = bool(job.get("imageDrifted", False))
        location_id = job.get("locationId", "VNZ")
        idem_key = job.get("idempotencyKey")
        synced_cdn_image = ""

        # Kiểm tra backoff nếu job này vừa lỗi
        retry_info = GLOBAL_STATE["outboundRetries"].get(outbox_id, {"attempts": 0, "nextRetryAt": 0})
        if retry_info["nextRetryAt"] > time.time():
            continue

        all_ok = True
        errors = []

        has_shopee_link = bool(item_id and str(item_id) not in ("0", ""))

        # 1. Đẩy tồn kho nếu có thay đổi (hoặc đẩy thủ công)
        if has_shopee_link and (stock_drifted or (not price_drifted and not unlisted_drifted and not image_drifted)):
            print(f"[OUTBOUND CMS -> SHOPEE] Đang đẩy tồn kho [{sku}] (Item: {item_id}, Model: {model_id}) -> Tồn mới = {target_stock}...")
            s_ok, s_res = update_shopee_product_stock(
                cookies, spc_cds, csrf_token,
                item_id=item_id,
                model_id=model_id,
                sellable_stock=target_stock,
                location_id=location_id
            )
            if not s_ok:
                all_ok = False
                errors.append(f"Stock: {s_res}")

        # 2. Đẩy giá bán nếu có thay đổi
        if has_shopee_link and price_drifted and target_price > 0:
            print(f"[OUTBOUND CMS -> SHOPEE] Đang đẩy giá bán [{sku}] (Item: {item_id}, Model: {model_id}) -> Giá mới = {target_price}...")
            p_ok, p_res = update_shopee_product_price(
                cookies, spc_cds, csrf_token,
                item_id=item_id,
                model_id=model_id,
                price=target_price
            )
            if not p_ok:
                all_ok = False
                errors.append(f"Price: {p_res}")

        # 3. Đẩy trạng thái Ẩn / Mở bán nếu có thay đổi (khử trùng lặp theo item_id trong cùng lô Outbox để chống Rate-Limit Shopee)
        if has_shopee_link and unlisted_drifted:
            status_cache_key = (str(item_id), bool(target_unlisted))
            if status_cache_key in handled_status_items:
                u_ok, u_res = handled_status_items[status_cache_key]
            else:
                print(f"[OUTBOUND CMS -> SHOPEE] Đang đổi trạng thái hiển thị [{sku}] (Item: {item_id}) -> unlisted = {target_unlisted}...")
                u_ok, u_res = update_shopee_product_status(
                    cookies, spc_cds, csrf_token,
                    item_id=item_id,
                    unlisted=target_unlisted
                )
                handled_status_items[status_cache_key] = (u_ok, u_res)
            if not u_ok:
                all_ok = False
                errors.append(f"Status: {u_res}")

        # 4. Đẩy ảnh sản phẩm / phân loại nếu có thay đổi từ CMS
        if image_drifted and target_image:
            print(f"[OUTBOUND CMS -> SHOPEE] Đang đồng bộ ảnh [{sku}] (Item: {item_id or 'UNLINKED'}, Model: {model_id or 'NONE'}) lên Sàn Shopee CDN...")
            img_ok, img_cdn_url, img_res = update_shopee_product_image(
                cookies, spc_cds, csrf_token,
                item_id=item_id,
                model_id=model_id,
                target_image=target_image
            )
            if img_ok:
                synced_cdn_image = img_cdn_url or target_image
            else:
                all_ok = False
                errors.append(f"Image: {img_res}")

        if all_ok:
            completed_count += 1
            GLOBAL_STATE["outboundRetries"].pop(outbox_id, None)
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["outboundProcessed"] += 1
                GLOBAL_STATE["lastOutboundFlush"] = int(time.time())

            # Gửi ACK COMPLETED về CMS
            call_cms_webhook("OUTBOX_ACK_RESULT", {
                "outboxId": outbox_id,
                "productId": job.get("productId"),
                "sku": sku,
                "shopeeItemId": item_id,
                "shopeeModelId": model_id,
                "syncedStock": target_stock,
                "syncedPrice": target_price,
                "syncedUnlisted": target_unlisted,
                "syncedImage": synced_cdn_image or None,
                "status": "COMPLETED",
                "idempotencyKey": idem_key
            })

            # Cập nhật sync_state để tránh vòng lặp echo khi Inbound quét lại
            prod_map = sync_state.setdefault("products", {})
            item_meta_map = sync_state.setdefault("itemMeta", {})
            model_state_key = f"MODEL_{item_id}_{model_id}"
            for k in (sku, model_state_key):
                if k in prod_map:
                    prod_map[k]["stock"] = target_stock
                    prod_map[k]["sellPrice"] = target_price
                    prod_map[k]["isUnlisted"] = target_unlisted
                    prod_map[k]["syncedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            if unlisted_drifted:
                if str(item_id) in item_meta_map:
                    item_meta_map[str(item_id)]["isUnlisted"] = target_unlisted
                for k, v in prod_map.items():
                    if str(v.get("shopeeItemId") or v.get("itemId") or "") == str(item_id):
                        v["isUnlisted"] = target_unlisted
            if has_shopee_link:
                print(f"[OUTBOUND -> SHOPEE OK] Đã đồng bộ [{sku}] (Tồn={target_stock}, Giá={target_price}, Unlisted={target_unlisted}) lên Sàn Shopee & ACK Sổ Cái CMS!")
            else:
                print(f"[OUTBOUND -> SHOPEE CDN] Đã đồng bộ ảnh [{sku}] lên Media CDN (0MB DB) & ACK Sổ Cái CMS!")
        else:
            err_msg = " | ".join(errors)
            err_kind = _classify_shopee_error(err_msg)
            if err_kind == "AUTH_EXPIRED":
                should_alert = False
                with GLOBAL_STATE["lock"]:
                    GLOBAL_STATE["alive"] = False
                    GLOBAL_STATE["deferredOutboxCount"] = max(1, len(jobs) - completed_count)
                    if not GLOBAL_STATE.get("lastAlertedLost"):
                        GLOBAL_STATE["lastAlertedLost"] = True
                        GLOBAL_STATE["lastAlertReason"] = err_msg
                        should_alert = True
                call_cms_webhook("OUTBOX_ACK_RESULT", {
                    "outboxId": outbox_id,
                    "productId": job.get("productId"),
                    "sku": sku,
                    "shopeeItemId": item_id,
                    "shopeeModelId": model_id,
                    "status": "DEFERRED_SESSION_LOST",
                    "error": err_msg,
                    "idempotencyKey": idem_key
                })
                if should_alert:
                    notify_session_alert("SESSION_LOST", f"Phiên Cookie hết hạn khi đồng bộ [{sku}]: {err_msg[:180]}")
                print(f"[OUTBOUND DEFERRED] Phiên Shopee mất kết nối khi đẩy [{sku}] -> Tạm hoãn lô Outbox chờ nạp lại Cookie (0 mất dữ liệu).")
                break
            elif err_kind == "BROKEN_LINK":
                GLOBAL_STATE["outboundRetries"].pop(outbox_id, None)
                call_cms_webhook("OUTBOX_ACK_RESULT", {
                    "outboxId": outbox_id,
                    "productId": job.get("productId"),
                    "sku": sku,
                    "shopeeItemId": item_id,
                    "shopeeModelId": model_id,
                    "status": "BROKEN_LINK",
                    "error": err_msg,
                    "idempotencyKey": idem_key
                })
                print(f"[OUTBOUND BROKEN_LINK] [{sku}] mất liên kết Item/Model trên Shopee: {err_msg}")
            else:
                attempts = retry_info["attempts"] + 1
                if attempts >= MAX_RETRY_ATTEMPTS:
                    GLOBAL_STATE["outboundRetries"].pop(outbox_id, None)
                    append_to_dlq(job, err_msg)
                    call_cms_webhook("OUTBOX_ACK_RESULT", {
                        "outboxId": outbox_id,
                        "productId": job.get("productId"),
                        "sku": sku,
                        "shopeeItemId": item_id,
                        "shopeeModelId": model_id,
                        "status": "DEAD_LETTER",
                        "attempt": attempts,
                        "error": err_msg,
                        "idempotencyKey": idem_key
                    })
                    print(f"[OUTBOUND -> DLQ] [{sku}] lỗi sau {attempts} lần thử -> Chuyển vào Dead-Letter Queue: {err_msg}")
                else:
                    backoff = min(300, 2 ** attempts)
                    GLOBAL_STATE["outboundRetries"][outbox_id] = {
                        "attempts": attempts,
                        "nextRetryAt": time.time() + backoff
                    }
                    call_cms_webhook("OUTBOX_ACK_RESULT", {
                        "outboxId": outbox_id,
                        "productId": job.get("productId"),
                        "sku": sku,
                        "shopeeItemId": item_id,
                        "shopeeModelId": model_id,
                        "status": "RETRY",
                        "attempt": attempts,
                        "error": err_msg,
                        "idempotencyKey": idem_key
                    })
                    print(f"[OUTBOUND RETRY #{attempts}] [{sku}] sẽ thử lại sau {backoff}s. Lỗi: {err_msg}")

    with GLOBAL_STATE["lock"]:
        if GLOBAL_STATE.get("alive"):
            GLOBAL_STATE["deferredOutboxCount"] = max(0, len(jobs) - completed_count)
    return completed_count

# =============================================================================
# CƠ CHẾ 3: LOCAL HTTP BRIDGE SERVER (CỔNG 51898) + QUEUE TELEMETRY
# =============================================================================
class LocalBridgeHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.close_connection = True
        self.send_header('Connection', 'close')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if self.path in ('/shopee/status', '/shopee/queue'):
            inb_q = load_inbound_queue()
            dlq = load_dlq()
            st = load_sync_state()
            with GLOBAL_STATE["lock"]:
                mem_cookies = GLOBAL_STATE.get("cookies") or {}
                resp = {
                    "ok": True,
                    "alive": GLOBAL_STATE["alive"],
                    "paused": GLOBAL_STATE.get("paused", False),
                    "shopId": GLOBAL_STATE["shopId"],
                    "username": GLOBAL_STATE["username"],
                    "cookieCount": len(mem_cookies),
                    "hasSpcSt": bool(mem_cookies.get("SPC_ST")),
                    "hasSpcScSession": bool(mem_cookies.get("SPC_SC_SESSION")),
                    "lastSync": GLOBAL_STATE["lastSync"],
                    "dryRun": is_outbox_dry_run(),
                    "deferredOutboxCount": GLOBAL_STATE.get("deferredOutboxCount", 0),
                    "lastAlertReason": GLOBAL_STATE.get("lastAlertReason", ""),
                    "asyncQueue": {
                        "inboundPending": len(inb_q),
                        "inboundProcessedTotal": GLOBAL_STATE["inboundProcessed"],
                        "outboundProcessedTotal": GLOBAL_STATE["outboundProcessed"],
                        "deferredOutboxCount": GLOBAL_STATE.get("deferredOutboxCount", 0),
                        "dlqCount": len(dlq),
                        "trackedProducts": len(st.get("products", {})),
                        "trackedOrders": len(st.get("orders", {})),
                        "lastInboundFlush": GLOBAL_STATE["lastInboundFlush"],
                        "lastOutboundFlush": GLOBAL_STATE["lastOutboundFlush"],
                    }
                }
            payload = json.dumps(resp).encode('utf-8')
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        else:
            self.send_response(404)
            self._send_cors()
            self.send_header('Content-Length', '0')
            self.end_headers()

    def do_POST(self):
        if self.path == '/shopee/session':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8'))
                incoming_cookies = body.get("cookies", {})
                if (
                    not isinstance(incoming_cookies, dict)
                    or len(incoming_cookies) == 0
                    or str(incoming_cookies.get("SPC_U", "")) == "3813970"
                    or incoming_cookies.get("SPC_ST") == "test_token"
                ):
                    payload = json.dumps({
                        "ok": False,
                        "verifiedLive": False,
                        "error": "Dữ liệu Cookie trống hoặc là Cookie mẫu thử nghiệm không hợp lệ."
                    }).encode('utf-8')
                    self.send_response(400)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                    return

                source = str(body.get("source") or "CHROME_EXTENSION_BRIDGE")
                expected_shop_id = str(body.get("expectedShopId") or "").strip()
                spc_cds = body.get("spc_cds") or incoming_cookies.get("SPC_CDS", GLOBAL_STATE["spc_cds"])
                csrf_token = body.get("csrf_token") or incoming_cookies.get("csrftoken", GLOBAL_STATE["csrf_token"])
                alive, shopid, uname = keep_alive_ping(incoming_cookies, spc_cds, csrf_token)
                if alive:
                    if expected_shop_id and str(shopid) != expected_shop_id:
                        payload = json.dumps({
                            "ok": False,
                            "verifiedLive": False,
                            "code": "SHOP_MISMATCH",
                            "shopId": str(shopid),
                            "username": str(uname),
                            "expectedShopId": expected_shop_id,
                            "error": f"Tài khoản Shopee đang đăng nhập ({uname} · #{shopid}) không khớp với shop liên kết (#{expected_shop_id})."
                        }).encode('utf-8')
                        self.send_response(409)
                        self._send_cors()
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(payload)))
                        self.end_headers()
                        self.wfile.write(payload)
                        return

                    with GLOBAL_STATE["lock"]:
                        GLOBAL_STATE["cookies"] = incoming_cookies
                        GLOBAL_STATE["spc_cds"] = spc_cds
                        GLOBAL_STATE["csrf_token"] = csrf_token
                        GLOBAL_STATE["shopId"] = str(shopid)
                        GLOBAL_STATE["username"] = str(uname)
                        GLOBAL_STATE["alive"] = True
                        GLOBAL_STATE["lastAlertedLost"] = False
                        GLOBAL_STATE["lastAlertReason"] = ""
                        GLOBAL_STATE["outboundRetries"].clear()
                    save_session(incoming_cookies, spc_cds, csrf_token, source=source)
                    requeued_dlq = requeue_dlq_to_inbound()

                    def _bg_replay_on_session_restore():
                        try:
                            notify_session_alert("SESSION_RESTORED", f"Đã nạp lại Cookie qua {source}")
                            time.sleep(0.2)
                            with PIPELINE_LOCK:
                                # Xả toàn bộ hàng đợi Outbox bất đồng bộ từ CMS lên Shopee TRƯỚC khi quét Inbound
                                process_outbound_outbox_from_cms(incoming_cookies, spc_cds, csrf_token)
                                if not is_inbound_product_sync_disabled():
                                    detect_and_enqueue_inbound_products(incoming_cookies, spc_cds, csrf_token, str(shopid), str(uname), force=False)
                                detect_and_enqueue_inbound_orders(incoming_cookies, spc_cds, csrf_token)
                                flush_inbound_queue_to_cms()
                        except Exception as e_rep:
                            print(f"[SESSION-RESTORE REPLAY ERR] {e_rep}")

                    threading.Thread(target=_bg_replay_on_session_restore, daemon=True).start()
                    payload = json.dumps({
                        "ok": True,
                        "verifiedLive": True,
                        "shopId": str(shopid),
                        "username": str(uname),
                        "cookieCount": len(incoming_cookies),
                        "source": source,
                        "autoReplayScheduled": True,
                        "requeuedDlqCount": requeued_dlq,
                        "message": "Xác thực & cập nhật phiên Cookie Shopee thành công! Hàng đợi bất đồng bộ đang tự động xả."
                    }).encode('utf-8')
                    self.send_response(200)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
                else:
                    payload = json.dumps({
                        "ok": False,
                        "verifiedLive": False,
                        "error": "Cookie đã hết hạn hoặc không hợp lệ đối với Kênh Người Bán Shopee."
                    }).encode('utf-8')
                    self.send_response(400)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(payload)))
                    self.end_headers()
                    self.wfile.write(payload)
            except Exception as e:
                payload = json.dumps({"ok": False, "error": str(e)}).encode('utf-8')
                self.send_response(500)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        elif self.path == '/shopee/check-session':
            try:
                disk_cookies, disk_cds, disk_csrf = load_session()
                with GLOBAL_STATE["lock"]:
                    curr_cookies = dict(GLOBAL_STATE["cookies"]) if GLOBAL_STATE.get("cookies") else dict(disk_cookies)
                    curr_spc_cds = GLOBAL_STATE["spc_cds"] or disk_cds
                    curr_csrf = GLOBAL_STATE["csrf_token"] or disk_csrf
                alive, shopid, uname = keep_alive_ping(curr_cookies, curr_spc_cds, curr_csrf)
                alert_to_send = None
                with GLOBAL_STATE["lock"]:
                    was_lost = bool(GLOBAL_STATE.get("lastAlertedLost"))
                    GLOBAL_STATE["alive"] = bool(alive)
                    if alive and shopid:
                        GLOBAL_STATE["shopId"] = str(shopid)
                    if alive and uname:
                        GLOBAL_STATE["username"] = str(uname)
                    if not alive and not was_lost:
                        GLOBAL_STATE["lastAlertedLost"] = True
                        GLOBAL_STATE["lastAlertReason"] = "Kiểm tra phiên phát hiện Cookie Shopee đã hết hạn"
                        alert_to_send = ("SESSION_LOST", GLOBAL_STATE["lastAlertReason"])
                    elif alive and was_lost:
                        GLOBAL_STATE["lastAlertedLost"] = False
                        GLOBAL_STATE["lastAlertReason"] = ""
                        alert_to_send = ("SESSION_RESTORED", "Phiên Cookie Shopee đã hoạt động trở lại")
                    eff_shop = GLOBAL_STATE["shopId"]
                    eff_user = GLOBAL_STATE["username"]
                if alert_to_send:
                    threading.Thread(
                        target=lambda: notify_session_alert(alert_to_send[0], alert_to_send[1]),
                        daemon=True,
                    ).start()
                payload = json.dumps({
                    "ok": True,
                    "alive": bool(alive),
                    "shopId": eff_shop,
                    "username": eff_user,
                    "cookieCount": len(curr_cookies)
                }).encode('utf-8')
                self.send_response(200)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
            except Exception as e:
                payload = json.dumps({"ok": False, "error": str(e)}).encode('utf-8')
                self.send_response(500)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        elif self.path == '/shopee/pause':
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["paused"] = True
            print("[BRIDGE] Daemon sync PAUSED by external controller.")
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "paused": True}).encode('utf-8'))
        elif self.path == '/shopee/resume':
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["paused"] = False
            print("[BRIDGE] Daemon sync RESUMED by external controller.")
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "paused": False}).encode('utf-8'))
        elif self.path == '/shopee/trigger-sync':
            with GLOBAL_STATE["lock"]:
                curr_cookies = dict(GLOBAL_STATE["cookies"])
                curr_spc_cds = GLOBAL_STATE["spc_cds"]
                curr_csrf = GLOBAL_STATE["csrf_token"]
                shopid = GLOBAL_STATE["shopId"]
                uname = GLOBAL_STATE["username"]

            def _bg_trigger_pipeline():
                try:
                    time.sleep(0.15)
                    with PIPELINE_LOCK:
                        # BƯỚC 1: Luôn chạy Outbound Outbox (CMS -> Shopee) TRƯỚC để đẩy mọi thay đổi vừa thao tác trên CMS lên Sàn
                        process_outbound_outbox_from_cms(curr_cookies, curr_spc_cds, curr_csrf)
                        # BƯỚC 2: Quét Inbound với force=False (chỉ lấy các thay đổi thực sự mới trên Sàn, không ép ghi đè dữ liệu cũ về CMS)
                        if is_inbound_product_sync_disabled():
                            print("[INBOUND PRODUCT SYNC] Bypassed (SHOPEE_OUTBOX_DRY_RUN / SHOPEE_INBOUND_DISABLE active) to protect CMS stock.")
                        else:
                            detect_and_enqueue_inbound_products(curr_cookies, curr_spc_cds, curr_csrf, shopid, uname, force=False)
                        detect_and_enqueue_inbound_orders(curr_cookies, curr_spc_cds, curr_csrf)
                        flush_inbound_queue_to_cms()
                except Exception as e:
                    print(f"[TRIGGER-SYNC BG ERR] {e}")

            threading.Thread(target=_bg_trigger_pipeline, daemon=True).start()
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({
                "ok": True,
                "scheduled": True
            }).encode('utf-8'))
        elif self.path == '/shopee/retry-dlq':
            requeued_dlq = requeue_dlq_to_inbound()
            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["outboundRetries"].clear()
                curr_cookies = dict(GLOBAL_STATE["cookies"])
                curr_spc_cds = GLOBAL_STATE["spc_cds"]
                curr_csrf = GLOBAL_STATE["csrf_token"]
                is_alive = bool(GLOBAL_STATE.get("alive"))

            def _bg_retry_dlq():
                try:
                    time.sleep(0.1)
                    with PIPELINE_LOCK:
                        if is_alive or is_outbox_dry_run():
                            process_outbound_outbox_from_cms(curr_cookies, curr_spc_cds, curr_csrf)
                        flush_inbound_queue_to_cms()
                except Exception as e_dlq:
                    print(f"[RETRY-DLQ BG ERR] {e_dlq}")

            threading.Thread(target=_bg_retry_dlq, daemon=True).start()
            payload = json.dumps({
                "ok": True,
                "requeuedDlqCount": requeued_dlq,
                "alive": is_alive,
                "scheduled": True
            }).encode('utf-8')
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        elif self.path == '/shopee/upload-image':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                body = json.loads(post_data.decode('utf-8'))
                data_url_or_http = body.get("dataUrl") or body.get("imageUrl") or ""
                filename = body.get("filename") or "cms_product.webp"
                shopee_item_id = str(body.get("shopeeItemId") or "").strip()
                shopee_model_id = str(body.get("shopeeModelId") or "").strip()
                sync_to_shopee = bool(body.get("syncToShopee", False))

                with GLOBAL_STATE["lock"]:
                    curr_cookies = dict(GLOBAL_STATE["cookies"])
                    curr_spc_cds = GLOBAL_STATE["spc_cds"]
                    curr_csrf = GLOBAL_STATE["csrf_token"]
                if not curr_cookies:
                    curr_cookies, curr_spc_cds, curr_csrf = load_session()

                raw_bytes, mime_type, dec_err = decode_image_source_to_bytes(data_url_or_http)
                if dec_err or not raw_bytes:
                    self.send_response(400)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": False,
                        "error": f"Không thể giải mã dữ liệu ảnh: {dec_err}"
                    }).encode('utf-8'))
                    return

                up_ok, cdn_url, img_id, up_msg = upload_image_to_shopee_cdn(
                    curr_cookies, curr_spc_cds, curr_csrf, raw_bytes, filename=filename, mime_type=mime_type
                )
                if not up_ok or not cdn_url:
                    self.send_response(502)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(json.dumps({
                        "ok": False,
                        "error": f"Shopee Media CDN từ chối tải lên: {up_msg}"
                    }).encode('utf-8'))
                    return

                synced_to_shopee = False
                if sync_to_shopee and shopee_item_id:
                    def _bg_sync_img():
                        try:
                            update_shopee_product_image(
                                curr_cookies, curr_spc_cds, curr_csrf,
                                item_id=shopee_item_id,
                                model_id=shopee_model_id,
                                target_image=cdn_url
                            )
                        except Exception as e_img:
                            print(f"[BG IMAGE SYNC ERR] {e_img}")
                    threading.Thread(target=_bg_sync_img, daemon=True).start()
                    synced_to_shopee = True

                self.send_response(200)
                self._send_cors()
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    "ok": True,
                    "url": cdn_url,
                    "imageId": img_id,
                    "storageMode": "SHOPEE_CDN",
                    "bytesInDb": len(cdn_url),
                    "syncedToShopee": synced_to_shopee,
                    "unlinkedProductSupported": not bool(shopee_item_id),
                }).encode('utf-8'))
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
        return

PIPELINE_LOCK = threading.Lock()

def start_http_bridge():
    try:
        server = ThreadingHTTPServer(('127.0.0.1', BRIDGE_PORT), LocalBridgeHandler)
        print(f"[BRIDGE SERVER] Đang lắng nghe tại http://127.0.0.1:{BRIDGE_PORT}/shopee/queue & /shopee/session")
        server.serve_forever()
    except Exception as e:
        print(f"[BRIDGE SERVER INFO] Port {BRIDGE_PORT} đang được tiến trình khác sử dụng ({e})")

def run_async_cycle_once(force_products=False):
    with GLOBAL_STATE["lock"]:
        if GLOBAL_STATE.get("paused"):
            print("[CYCLE SKIPPED] Daemon is currently PAUSED by test runner or operator.")
            return True

    cookies, spc_cds, csrf_token = load_session()
    alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)
    print(f"[SESSION CHECK] alive={alive}, shopId={shopid}, username={uname}")
    if not alive:
        if try_cdp_recovery():
            cookies, spc_cds, csrf_token = load_session()
            alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)

    if not alive:
        with GLOBAL_STATE["lock"]:
            GLOBAL_STATE["alive"] = False
        if is_outbox_dry_run():
            print("[WARN] Phien Shopee khong hoat dong nhung DRY_RUN dang BAT: Tien hanh xa Outbound Outbox gia lap an toan.")
            out_cnt = process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)
            return True
        process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)
        print("[ERROR] Phiên Shopee không hoạt động — Hàng đợi Outbox được giữ nguyên an toàn.")
        return False

    with GLOBAL_STATE["lock"]:
        GLOBAL_STATE["alive"] = True
        if shopid:
            GLOBAL_STATE["shopId"] = str(shopid)
        if uname:
            GLOBAL_STATE["username"] = str(uname)

    # Bước 1: Outbound Outbox (CMS -> Shopee) chạy trước để đẩy mọi thay đổi tồn kho từ CMS/POS lên Shopee
    out_cnt = process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)

    # Bước 2: Inbound Producer (Shopee -> Spool Queue) phát hiện sản phẩm & đơn hàng mới/thay đổi
    if is_inbound_product_sync_disabled():
        print("[INBOUND PRODUCT SYNC] Bypassed (SHOPEE_OUTBOX_DRY_RUN / SHOPEE_INBOUND_DISABLE active) to protect CMS stock.")
        enq_p, prod_total = 0, 0
    else:
        enq_p, prod_total = detect_and_enqueue_inbound_products(cookies, spc_cds, csrf_token, shopid, uname, force=force_products)
    enq_o = detect_and_enqueue_inbound_orders(cookies, spc_cds, csrf_token)

    # Bước 3: Inbound Consumer (Spool Queue -> CMS Webhook)
    in_cnt = flush_inbound_queue_to_cms()

    # Bước 4: Nếu sau khi Inbound có xung đột Anti-Oversell tự sinh Outbox mới -> đẩy ngay lên Shopee
    out_cnt_2 = process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)

    inb_q = load_inbound_queue()
    dlq = load_dlq()
    print(
        f"[ASYNC CYCLE SUMMARY] Shopee Products={prod_total} | "
        f"Inbound Enqueued={enq_p + enq_o} | Inbound Flushed={in_cnt} | "
        f"Outbound Synced={out_cnt + out_cnt_2} | Queue Pending={len(inb_q)} | DLQ={len(dlq)}"
    )
    return True

def run_loop(interval_sec=20):
    print("======================================================================")
    print("   OPENVN CMS/POS <=> SHOPEE ASYNC BIDIRECTIONAL PIPELINE DAEMON")
    print("   - Inbound:  Shopee -> Spool Queue -> CMS (Idempotent + Backoff)")
    print("   - Outbound: CMS Transactional Outbox -> Shopee v3 Stock API -> ACK")
    if is_outbox_dry_run():
        print("   - DRY_RUN:  [ENABLED] Moi lenh ghi len Shopee API duoc gia lap, khong gui HTTP mutative request")
    print("   - Session:  Keep-Alive Heartbeat + CDP 9222 + Bridge 51898")
    print(f"   - Target:   {CMS_WEBHOOK_URL}")
    print("======================================================================")

    t = threading.Thread(target=start_http_bridge, daemon=True)
    t.start()

    cookies, spc_cds, csrf_token = load_session()
    with GLOBAL_STATE["lock"]:
        GLOBAL_STATE["cookies"] = cookies
        GLOBAL_STATE["spc_cds"] = spc_cds
        GLOBAL_STATE["csrf_token"] = csrf_token

    alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)
    if not alive:
        try_cdp_recovery()
        cookies, spc_cds, csrf_token = load_session()
        alive, shopid, uname = keep_alive_ping(cookies, spc_cds, csrf_token)

    if alive:
        with GLOBAL_STATE["lock"]:
            GLOBAL_STATE["alive"] = True
            GLOBAL_STATE["lastAlertedLost"] = False
            GLOBAL_STATE["lastAlertReason"] = ""
            GLOBAL_STATE["shopId"] = str(shopid)
            GLOBAL_STATE["username"] = str(uname)
        print(f"[OK] Phiên Shopee hoạt động: Shop ID {shopid} ({uname})")
        with PIPELINE_LOCK:
            process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)
            if not is_inbound_product_sync_disabled():
                detect_and_enqueue_inbound_products(cookies, spc_cds, csrf_token, shopid, uname, force=False)
            flush_inbound_queue_to_cms()
    else:
        with GLOBAL_STATE["lock"]:
            GLOBAL_STATE["alive"] = False
            GLOBAL_STATE["lastAlertedLost"] = True
            GLOBAL_STATE["lastAlertReason"] = "Phiên Cookie Shopee đã hết hạn — hệ thống đang giữ hàng đợi đồng bộ bất đồng bộ"
        print("[WARN] Phiên Cookie Shopee hiện đã hết hạn — Đã bật chế độ Hàng đợi Bất đồng bộ (0 đốt retry / 0 mất dữ liệu).")
        with PIPELINE_LOCK:
            process_outbound_outbox_from_cms(cookies, spc_cds, csrf_token)
            flush_inbound_queue_to_cms()
        notify_session_alert("SESSION_LOST", "Phiên Cookie Shopee đã hết hạn — mọi thay đổi giá/tồn được giữ an toàn trong hàng đợi bất đồng bộ.")

    last_ping = time.time()

    while True:
        try:
            with GLOBAL_STATE["lock"]:
                is_paused = bool(GLOBAL_STATE.get("paused"))
                curr_alive = bool(GLOBAL_STATE.get("alive"))
                curr_cookies = dict(GLOBAL_STATE["cookies"])
                curr_spc_cds = GLOBAL_STATE["spc_cds"]
                curr_csrf = GLOBAL_STATE["csrf_token"]
                shopid = GLOBAL_STATE["shopId"]
                uname = GLOBAL_STATE["username"]

            if is_paused:
                time.sleep(min(interval_sec, 2))
                continue

            ping_interval = 600 if curr_alive else 180
            if time.time() - last_ping > ping_interval:
                p_alive, sid, un = keep_alive_ping(curr_cookies, curr_spc_cds, curr_csrf)
                if not p_alive:
                    if try_cdp_recovery():
                        curr_cookies, curr_spc_cds, curr_csrf = load_session()
                        p_alive, sid, un = keep_alive_ping(curr_cookies, curr_spc_cds, curr_csrf)
                if p_alive:
                    was_lost = False
                    with GLOBAL_STATE["lock"]:
                        was_lost = not bool(GLOBAL_STATE.get("alive")) or bool(GLOBAL_STATE.get("lastAlertedLost"))
                        GLOBAL_STATE["alive"] = True
                        GLOBAL_STATE["cookies"] = curr_cookies
                        GLOBAL_STATE["spc_cds"] = curr_spc_cds
                        GLOBAL_STATE["csrf_token"] = curr_csrf
                        GLOBAL_STATE["lastAlertedLost"] = False
                        GLOBAL_STATE["lastAlertReason"] = ""
                        if sid:
                            GLOBAL_STATE["shopId"] = str(sid)
                            shopid = str(sid)
                        if un:
                            GLOBAL_STATE["username"] = str(un)
                            uname = str(un)
                    curr_alive = True
                    print(f"[{time.strftime('%H:%M:%S')}] [HEARTBEAT] Đã gia hạn / khôi phục phiên trượt Shopee thành công.")
                    if was_lost:
                        notify_session_alert("SESSION_RESTORED", "Đã tự động khôi phục phiên Cookie Shopee.")
                else:
                    should_alert = False
                    with GLOBAL_STATE["lock"]:
                        GLOBAL_STATE["alive"] = False
                        if not GLOBAL_STATE.get("lastAlertedLost"):
                            GLOBAL_STATE["lastAlertedLost"] = True
                            GLOBAL_STATE["lastAlertReason"] = "Phiên Cookie Shopee vừa hết hạn trong ca trực"
                            should_alert = True
                    curr_alive = False
                    if should_alert:
                        notify_session_alert("SESSION_LOST", "Phiên Cookie Shopee vừa hết hạn — các thay đổi từ CMS đang được xếp hàng bất đồng bộ.")
                last_ping = time.time()

            with PIPELINE_LOCK:
                # 1. Xử lý hàng đợi Outbound Outbox (CMS -> Sàn Shopee; nếu mất phiên sẽ tự giữ WAITING_SESSION)
                process_outbound_outbox_from_cms(curr_cookies, curr_spc_cds, curr_csrf)

                # 2. Quét biến động Sản phẩm & Đơn hàng từ Sàn Shopee -> Spool Queue (chỉ khi phiên đang sống)
                if curr_alive:
                    if not is_inbound_product_sync_disabled():
                        detect_and_enqueue_inbound_products(curr_cookies, curr_spc_cds, curr_csrf, shopid, uname, force=False)
                    detect_and_enqueue_inbound_orders(curr_cookies, curr_spc_cds, curr_csrf)

                # 3. Xả hàng đợi Inbound Spool Queue (nếu còn tồn trên đĩa) -> CMS
                flush_inbound_queue_to_cms()

            with GLOBAL_STATE["lock"]:
                GLOBAL_STATE["lastSync"] = int(time.time())

        except Exception as e:
            print(f"[LOOP ERROR] {e}")

        time.sleep(interval_sec)

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--once":
        force_flag = "--force" in sys.argv
        run_async_cycle_once(force_products=force_flag)
    elif len(sys.argv) > 1 and sys.argv[1] == "--status":
        print(f"Checking daemon status on port {BRIDGE_PORT}...")
        try:
            resp = urllib.request.urlopen(f"http://127.0.0.1:{BRIDGE_PORT}/shopee/status", timeout=3)
            print(resp.read().decode('utf-8'))
        except Exception as e:
            print(f"Daemon not responding: {e}")
            sys.exit(1)
    else:
        if is_port_in_use(BRIDGE_PORT):
            print(f"[WARN] Port {BRIDGE_PORT} is already in use by another Shopee sync daemon process!")
            print(f"[TIP] Run 'run-shopee-sync.bat stop' or terminate the existing process first.")
            sys.exit(1)
        run_loop(interval_sec=20)
