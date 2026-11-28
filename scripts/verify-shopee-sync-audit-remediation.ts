/**
 * Kiểm thử Toàn diện Sau Rà Soát Đồng Bộ Shopee & Đăng Nhập 1 Lần (Không Cần Partner ID / Partner Key):
 * 1. Đăng nhập 1 lần qua Persistent Browser Profile + CDP (:9222) + Extension Tier-3 Fallback + Zero-Secret Leak
 * 2. Python Daemon: load_session (<10 cookies), Sliding Cookie Rotation, Runtime HTTP 200 code=100010005 Auth Loss,
 *    Flash-Sale Price Lock (PRICE_LOCKED_PROMOTION), Idempotency Key khi đổi tên/SKU, itemActiveModelIds & Catalog Reconcile
 * 3. Đổi giá trên Shopee: Đồng bộ giá chung vs Bảo toàn giá bán lẻ riêng tại POS/Facebook (0 ghi đè kênh khác, 0 PRICE_DRIFT giả)
 * 4. Đổi tên SP / tên phân loại trên Shopee: Ghi sổ PRODUCT_NAME_CHANGED + Xóa cache L1 tức thì + Bảo toàn BOM baocao1
 * 5. Xóa phân loại / đổi Model ID / xóa cả sản phẩm trên Shopee: Chủ động gắn cờ BROKEN_LINK & Auto-Heal theo SKU
 * 6. Bảo vệ Đơn hàng & Khách hàng Shopee thật trước Test-Guard (0 xóa nhầm đơn Shopee thật) + 100% Baseline Parity Teardown
 *
 * Chạy: npx tsx scripts/verify-shopee-sync-audit-remediation.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { db } from '../src/lib/db'
import { getApiCache, invalidateApiCache, setApiCache } from '../src/lib/realtime'
import { CARRIER_FEE_ESTIMATES, CANONICAL_SKUS, resolveCanonicalSku } from '../src/lib/baocao1-core'
import { buildBaocao1Snapshot } from '../src/lib/baocao1-bomoc'
import { generateShopeeExtensionFiles, normalizeCmsOrigin } from '../src/lib/shopee-extension-bundle'
import { INTEGRATION_PROVIDERS } from '../src/lib/webhook-service'
import { POST as inboundWebhookPost } from '../src/app/api/webhooks/inbound/route'
import { GET as productLinksGet, POST as productLinksPost } from '../src/app/api/channels/product-links/route'
import { PATCH as channelPatchById } from '../src/app/api/channels/[id]/route'
import { GET as shopeeSessionGet } from '../src/app/api/channels/shopee-session/route'
import {
  GET as testGuardGet,
  PROTECTED_CUSTOMER_IDS,
  PROTECTED_INVOICE_CODES,
  PROTECTED_ORDER_CODES,
} from '../src/app/api/ledger/test-guard/route'
import { PATCH as productPatchById, PUT as productPutById } from '../src/app/api/products/[id]/route'
import { GET as pnlGet } from '../src/app/api/reports/pnl/route'
import { cancelOrder, createOrder } from '../src/lib/order-service'
import { isSyntheticCustomerName } from '../src/lib/synthetic-filter'

let passed = 0

function assert(cond: unknown, suite: string, label: string, detail?: string): asserts cond {
  if (!cond) {
    throw new Error(`[FAIL][${suite}] ${label}${detail ? ` — ${detail}` : ''}`)
  }
  passed += 1
  console.log(`✅ [PASS #${passed}][${suite}] ${label}`)
}

async function main() {
  console.log('=== VERIFY: SHOPEE SYNC AUDIT REMEDIATION & 1-TIME LOGIN (NO PARTNER KEY) ===')

  // --------------------------------------------------------------------------
  // SUITE 1: 1-Time Browser Login Profile, Extension Tier-3 Fallback & Zero-Secret
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 1: 1-Time Persistent Browser Login & Zero-Secret Guard ---')
  const batContent = fs.readFileSync(path.resolve('launch-chrome-shopee.bat'), 'utf-8')
  assert(
    batContent.includes('ShopeeSellerProfile-197195817') &&
      batContent.includes('--remote-debugging-port=9222') &&
      batContent.includes('--restore-last-session') &&
      batContent.includes('--load-extension='),
    'S1-ONE-TIME-LOGIN',
    'launch-chrome-shopee.bat sử dụng hồ sơ cố định độc lập + tự nạp Extension + mở cổng CDP 9222'
  )

  const unpackedBgJs = fs.readFileSync(
    path.resolve('extensions/shopee-sync-extension/background.js'),
    'utf-8'
  )
  const extFiles = generateShopeeExtensionFiles({ cmsOrigin: 'http://localhost:3010' })
  const renderedBgEntry = extFiles.find((f) => f.name.endsWith('background.js'))
  const renderedBgJs = typeof renderedBgEntry?.content === 'string' ? renderedBgEntry.content : ''
  assert(
    unpackedBgJs.includes('/api/channels/shopee-session') &&
      unpackedBgJs.includes("action: 'IMPORT_CURL'") &&
      renderedBgJs.includes('/api/channels/shopee-session') &&
      renderedBgJs.includes("action: 'IMPORT_CURL'"),
    'S1-EXTENSION-FALLBACK',
    'Extension đồng bộ Shopee hỗ trợ Tier-3 fallback (0 cần Pairing Token / 0 cần Partner Key khi Daemon tắt)'
  )

  const sessionGetRes = await shopeeSessionGet()
  const sessionJson = (await sessionGetRes.json()) as Record<string, unknown>
  const rawSessionStr = JSON.stringify(sessionJson)
  assert(
    sessionGetRes.status === 200 &&
      !rawSessionStr.includes('"cookies"') &&
      !rawSessionStr.includes('SPC_EC=') &&
      !rawSessionStr.includes('SPC_ST='),
    'S1-ZERO-SECRET',
    'GET /api/channels/shopee-session tuân thủ Zero-Secret Leak (không lộ raw cookie trong response)'
  )

  // --------------------------------------------------------------------------
  // SUITE 2: Python CDP Extractor + Daemon Session/Price/Rename/Reconcile Unit Tests
  // --------------------------------------------------------------------------
  console.log('\n--- SUITE 2: Python CDP Extractor & Daemon Resilience Unit Suite ---')
  const pySuite = `
import os
import sys
import json
import tempfile

os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
os.environ.pop('SHOPEE_OUTBOX_DRY_RUN', None)

import scripts.extract_shopee_cdp as cdp_mod
import scripts.shopee_seller_sync as sync_mod

# 2.1 CDP extractor: Storage.getCookies via /json/version (0 open tabs) + blocks mock SPC_U=3813970
if cdp_mod.HAS_WEBSOCKETS:
    import asyncio
    import websockets

    async def test_cdp_e2e():
        mode = {"mock_spc_u": False}
        async def ws_handler(ws):
            msg = json.loads(await ws.recv())
            assert msg["method"] == "Storage.getCookies"
            cookies_out = [
                {"domain": ".shopee.vn", "name": "SPC_EC", "value": "cdp_live_ec_001"},
                {"domain": ".shopee.vn", "name": "SPC_ST", "value": "cdp_live_st_001"},
            ]
            if mode["mock_spc_u"]:
                cookies_out.append({"domain": ".shopee.vn", "name": "SPC_U", "value": "3813970"})
            await ws.send(json.dumps({"id": msg["id"], "result": {"cookies": cookies_out}}))

        async with websockets.serve(ws_handler, "127.0.0.1", 0) as server:
            ws_port = server.sockets[0].getsockname()[1]
            orig_fetch = cdp_mod._fetch_cdp_ws_url
            cdp_mod._fetch_cdp_ws_url = lambda port=9222: (f"ws://127.0.0.1:{ws_port}", True)
            try:
                got = await cdp_mod.extract_cookies_from_cdp(port=ws_port, quiet=True)
                assert got is not None and got.get("SPC_EC") == "cdp_live_ec_001"
                mode["mock_spc_u"] = True
                blocked = await cdp_mod.extract_cookies_from_cdp(port=ws_port, quiet=True)
                assert blocked is None, "extract_cookies_from_cdp did not block mock SPC_U=3813970!"
            finally:
                cdp_mod._fetch_cdp_ws_url = orig_fetch

    asyncio.run(test_cdp_e2e())

# 2.2 load_session accepts <10 cookies as long as core Shopee auth cookies exist, and blocks SPC_U=3813970
orig_session_file = sync_mod.SESSION_FILE
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tf:
    temp_session_path = tf.name
    json.dump({
        "shopId": "197195817",
        "username": "thaimy1605",
        "cookies": {
            "SPC_EC": "valid_ec_token_abc",
            "SPC_ST": "valid_st_token_xyz",
            "SPC_CDS": "cds_uuid_001"
        }
    }, tf)

try:
    sync_mod.SESSION_FILE = temp_session_path
    loaded_cookies, loaded_cds, _ = sync_mod.load_session()
    assert loaded_cookies.get("SPC_EC") == "valid_ec_token_abc" and loaded_cds == "cds_uuid_001", "load_session rejected valid 3-cookie session!"

    with open(temp_session_path, "w", encoding="utf-8") as tf2:
        json.dump({
            "shopId": "197195817",
            "cookies": {"SPC_U": "3813970", "SPC_EC": "mock_ec", "SPC_ST": "mock_st"}
        }, tf2)
    fallback_cookies, _, _ = sync_mod.load_session()
    assert fallback_cookies.get("SPC_EC") != "mock_ec" and str(fallback_cookies.get("SPC_U", "")) != "3813970", "load_session failed to block mock SPC_U=3813970!"
finally:
    sync_mod.SESSION_FILE = orig_session_file
    if os.path.exists(temp_session_path):
        os.remove(temp_session_path)

# 2.3 update_cookies_from_headers ignores cleared cookies (Max-Age=0) & preserves valid tokens
dummy_headers = [
    ("Set-Cookie", "SPC_SC_SESSION=; Max-Age=0; Path=/"),
    ("Set-Cookie", "SPC_EC=rotated_ec_live_999; Path=/; HttpOnly"),
    ("Set-Cookie", "SPC_CDS=rotated_cds_live_888; Path=/"),
]

jar = {"SPC_SC_SESSION": "keep_existing_sc", "SPC_EC": "old_ec", "SPC_ST": "keep_st"}
sync_mod.GLOBAL_STATE["cookies"] = dict(jar)
orig_save = sync_mod.save_session
saved_snapshots = []
sync_mod.save_session = lambda c, s, u, source="AUTO": saved_snapshots.append(dict(c))
try:
    sync_mod.update_cookies_from_headers(jar, dummy_headers)
    assert jar["SPC_SC_SESSION"] == "keep_existing_sc", "Cleared Max-Age=0 cookie wiped valid SPC_SC_SESSION!"
    assert jar["SPC_EC"] == "rotated_ec_live_999", "Rotated SPC_EC not updated!"
    assert sync_mod.GLOBAL_STATE["cookies"]["SPC_EC"] == "rotated_ec_live_999", "GLOBAL_STATE cookies not synced with rotated cookie!"
finally:
    sync_mod.save_session = orig_save

# 2.4 Runtime HTTP 200 auth error payload detection + auto sub-session refresh vs immediate SESSION_LOST alert
assert sync_mod._is_auth_error_payload({"code": 100010005, "message": "not login"}) is True
assert sync_mod._is_auth_error_payload({"code": 0, "data": {"list": []}}) is False

# Case A: Sub-session refresh succeeds -> stays alive without false SESSION_LOST
sync_mod.GLOBAL_STATE["alive"] = True
sync_mod.GLOBAL_STATE["lastAlertedLost"] = False
orig_refresh = sync_mod.try_refresh_seller_subsession
orig_ping = sync_mod.keep_alive_ping
orig_cdp = sync_mod.try_cdp_recovery
orig_notify = sync_mod.notify_session_alert
alerts = []
sync_mod.try_refresh_seller_subsession = lambda c, s, t: True
sync_mod.keep_alive_ping = lambda c, s, t, allow_subsession_refresh=True: (True, "197195817", "thaimy1605")
sync_mod.try_cdp_recovery = lambda: False
sync_mod.notify_session_alert = lambda kind, reason="": alerts.append((kind, reason))
try:
    recovered = sync_mod._handle_runtime_auth_loss(jar, "cds", "csrf", "HTTP 200 code=100010005")
    assert recovered is True and sync_mod.GLOBAL_STATE["alive"] is True
    assert len(alerts) == 0, f"Unexpected alert when sub-session auto-recovered: {alerts}"

    # Case B: Sub-session refresh & CDP both fail -> immediate alive=False & SESSION_LOST alert
    sync_mod.try_refresh_seller_subsession = lambda c, s, t: False
    recovered2 = sync_mod._handle_runtime_auth_loss(jar, "cds", "csrf", "SPC_ST expired completely")
    import time as _t
    _t.sleep(0.05)
    assert recovered2 is False and sync_mod.GLOBAL_STATE["alive"] is False
    assert len(alerts) == 1 and alerts[0][0] == "SESSION_LOST"
finally:
    sync_mod.try_refresh_seller_subsession = orig_refresh
    sync_mod.keep_alive_ping = orig_ping
    sync_mod.try_cdp_recovery = orig_cdp
    sync_mod.notify_session_alert = orig_notify

# 2.5 Promotion price lock classification
assert sync_mod._classify_shopee_error("Price edit rejected: ongoing promotion / flash_sale") == "PRICE_LOCKED_PROMOTION"

# 2.6 detect_and_enqueue_inbound_products: rename changes idem_key + attaches itemActiveModelIds + reconciles deleted items
orig_enq = sync_mod.enqueue_inbound_event
orig_fetch_prods = sync_mod.fetch_shopee_products
orig_fetch_info = sync_mod.fetch_shopee_product_info
orig_load_st = sync_mod.load_sync_state
orig_save_st = sync_mod.save_sync_state
enqueued_events = []
mock_sync_state = {"products": {}, "orders": {}, "itemMeta": {}, "catalogItemIds": ["555001", "555999"]}
current_items_holder = {"items": [], "total": 1}

sync_mod.enqueue_inbound_event = lambda ev, data, idem: (enqueued_events.append((ev, data, idem)) or True)
sync_mod.fetch_shopee_products = lambda c, s, t, list_type="all", page_size=48: (current_items_holder["items"], current_items_holder["total"])
sync_mod.fetch_shopee_product_info = lambda c, s, t, pid: {"images": ["img_hash_1"], "description_info": {"description": "Mô tả SP"}, "model_list": []}
sync_mod.load_sync_state = lambda: mock_sync_state
sync_mod.save_sync_state = lambda st: None
try:
    sample_item_v1 = {
        "id": 555001,
        "name": "Hũ Thạch Cao Búp Sen Bản Cũ",
        "parent_sku": "BM-DEC-SEN",
        "modify_time": 1700000100,
        "cover_image": "img_hash_1",
        "model_list": [
            {"id": 701, "name": "Trắng Mộc", "sku": "BM-DEC-SEN-TRANG", "stock_detail": {"total_available_stock": 10}, "price_info": {"input_normal_price": 50000}},
            {"id": 702, "name": "Kem Bơ", "sku": "BM-DEC-SEN-KEM", "stock_detail": {"total_available_stock": 8}, "price_info": {"input_normal_price": 50000, "promotion_price": 45000}}
        ]
    }
    current_items_holder["items"] = [sample_item_v1]
    current_items_holder["total"] = 1
    cnt1, _ = sync_mod.detect_and_enqueue_inbound_products({}, "cds", "csrf", "197195817", "thaimy1605")
    # 1 catalog reconcile + 2 models = 3 enqueued events
    assert cnt1 == 3, f"Expected 3 enqueued events (1 reconcile + 2 models), got {cnt1}"
    recon_ev = [e for e in enqueued_events if e[0] == "INBOUND_SHOPEE_CATALOG_RECONCILE"]
    prod_evs = [e for e in enqueued_events if e[0] == "INBOUND_SHOPEE_PRODUCT_SYNC"]
    assert len(recon_ev) == 1 and recon_ev[0][1]["deletedShopeeItemIds"] == ["555999"]
    assert len(prod_evs) == 2 and prod_evs[0][1]["itemActiveModelIds"] == ["701", "702"]
    assert prod_evs[1][1]["attributes"]["shopeeNormalPrice"] == 50000 and prod_evs[1][1]["attributes"]["shopeePromotionPrice"] == 45000

    # Simulate ACK recorded in prod_state
    for _, pdata, pidem in prod_evs:
        mock_sync_state["products"][pdata["sku"]] = {"idempotencyKey": pidem, "isUnlisted": False}
    idem_before = prod_evs[0][2]
    enqueued_events.clear()

    # Rename ONLY (same modify_time, same stock, same price!)
    sample_item_v2 = json.loads(json.dumps(sample_item_v1))
    sample_item_v2["name"] = "Hũ Đựng Nến Hoa Sen Có Nắp Đổi Tên Mới"
    current_items_holder["items"] = [sample_item_v2]
    cnt2, _ = sync_mod.detect_and_enqueue_inbound_products({}, "cds", "csrf", "197195817", "thaimy1605")
    assert cnt2 == 2, f"Expected 2 renamed models enqueued even with same modify_time, got {cnt2}"
    assert enqueued_events[0][2] != idem_before, "Idempotency key did NOT change on product rename!"

    # 2.7 Single-SKU product (model_list=[] or id=0) syncs with shopeeModelId='0' and caches without hammering get_product_info
    enqueued_events.clear()
    info_calls = {"n": 0}
    sync_mod.fetch_shopee_product_info = lambda c, s, t, pid: (info_calls.__setitem__("n", info_calls["n"] + 1) or {"images": ["img_single_1"], "description_info": {"description": "SP đơn"}, "model_list": []})
    single_item = {
        "id": 555777,
        "name": "Cốc Thạch Cao Trụ Trơn Đơn Lẻ",
        "parent_sku": "BM-DEC-COC-TRON",
        "modify_time": 1700000500,
        "cover_image": "img_single_1",
        "price_info": {"input_normal_price": 79000},
        "stock_detail": {"total_available_stock": 6},
        "model_list": []
    }
    mock_sync_state["catalogItemIds"] = ["555777"]
    current_items_holder["items"] = [single_item]
    current_items_holder["total"] = 1
    cnt_s1, _ = sync_mod.detect_and_enqueue_inbound_products({}, "cds", "csrf", "197195817", "thaimy1605")
    assert cnt_s1 == 1 and info_calls["n"] == 1, f"Single-SKU item failed to enqueue: cnt={cnt_s1}, info_calls={info_calls['n']}"
    assert enqueued_events[0][1]["shopeeModelId"] == "0" and enqueued_events[0][1]["itemActiveModelIds"] == ["0"]
    mock_sync_state["products"]["BM-DEC-COC-TRON"] = {"idempotencyKey": enqueued_events[0][2], "isUnlisted": False}
    enqueued_events.clear()
    cnt_s2, _ = sync_mod.detect_and_enqueue_inbound_products({}, "cds", "csrf", "197195817", "thaimy1605")
    assert cnt_s2 == 0 and info_calls["n"] == 1, f"Unchanged single-SKU item hammered get_product_info: info_calls={info_calls['n']}"
finally:
    sync_mod.enqueue_inbound_event = orig_enq
    sync_mod.fetch_shopee_products = orig_fetch_prods
    sync_mod.fetch_shopee_product_info = orig_fetch_info
    sync_mod.load_sync_state = orig_load_st
    sync_mod.save_sync_state = orig_save_st

# 2.8 try_cdp_recovery enforces expected_shop_id BEFORE mutating GLOBAL_STATE or saving disk session
orig_async_cdp = sync_mod.async_cdp_extract
orig_ping_cdp = sync_mod.keep_alive_ping
orig_save_cdp = sync_mod.save_session
saved_wrong_shop = []
async def _fake_cdp_extract(port=9222):
    return {"SPC_EC": "wrong_shop_cookie", "SPC_ST": "wrong_shop_st"}
sync_mod.async_cdp_extract = _fake_cdp_extract
sync_mod.keep_alive_ping = lambda c, s, t, allow_subsession_refresh=True: (True, "999888777", "wrong_seller_acc")
sync_mod.save_session = lambda *a, **kw: saved_wrong_shop.append(True)
sync_mod.GLOBAL_STATE["shopId"] = "197195817"
sync_mod.GLOBAL_STATE["cookies"] = {"SPC_EC": "trusted_thaimy_ec"}
try:
    ok_cdp, det_cdp = sync_mod.try_cdp_recovery(expected_shop_id="197195817", return_detail=True)
    assert ok_cdp is False and det_cdp.get("code") == "SHOP_MISMATCH", f"Expected SHOP_MISMATCH, got {ok_cdp}, {det_cdp}"
    assert sync_mod.GLOBAL_STATE["cookies"].get("SPC_EC") == "trusted_thaimy_ec", "Wrong shop CDP cookie poisoned GLOBAL_STATE!"
    assert len(saved_wrong_shop) == 0, "Wrong shop CDP cookie wrote to .shopee_session.json!"
finally:
    sync_mod.async_cdp_extract = orig_async_cdp
    sync_mod.keep_alive_ping = orig_ping_cdp
    sync_mod.save_session = orig_save_cdp

# 2.9 Multi-Variation Guard when fetch_shopee_product_info() fails transiently ({}) or deleted model_id > 0
orig_fetch_pinfo = sync_mod.fetch_shopee_product_info
orig_ping_guard = sync_mod.keep_alive_ping
orig_urlopen_guard = sync_mod.urllib.request.urlopen
guard_http_calls = []
def _guard_urlopen(req, context=None, timeout=15):
    guard_http_calls.append(req.full_url)
    raise AssertionError("Should not send HTTP mutation when fetch_shopee_product_info fails or model mismatches!")
try:
    sync_mod.urllib.request.urlopen = _guard_urlopen
    sync_mod.fetch_shopee_product_info = lambda *a, **kw: {}
    sync_mod.keep_alive_ping = lambda *a, **kw: (True, "197195817", "thaimy1605")
    ok_gs, msg_gs = sync_mod.update_shopee_product_stock({"SPC_ST": "x"}, "cds", "csrf", "50521234295", "371713510934", 5)
    ok_gp, msg_gp = sync_mod.update_shopee_product_price({"SPC_ST": "x"}, "cds", "csrf", "50521234295", "371713510934", 45000)
    assert not ok_gs and "PRODUCT_INFO_UNAVAILABLE" in str(msg_gs), f"Expected PRODUCT_INFO_UNAVAILABLE, got {msg_gs}"
    assert not ok_gp and "PRODUCT_INFO_UNAVAILABLE" in str(msg_gp), f"Expected PRODUCT_INFO_UNAVAILABLE, got {msg_gp}"

    sync_mod.fetch_shopee_product_info = lambda *a, **kw: {
        "model_list": [{"id": 371713510932}],
        "tier_variation": [{"name": "Phan loai", "options": ["Trang"]}]
    }
    ok_mm, msg_mm = sync_mod.update_shopee_product_stock({"SPC_ST": "x"}, "cds", "csrf", "50521234295", "371713510934", 5)
    assert not ok_mm and "MODEL_ID_MISMATCH_GUARD" in str(msg_mm), f"Expected MODEL_ID_MISMATCH_GUARD, got {msg_mm}"
    assert len(guard_http_calls) == 0
finally:
    sync_mod.fetch_shopee_product_info = orig_fetch_pinfo
    sync_mod.keep_alive_ping = orig_ping_guard
    sync_mod.urllib.request.urlopen = orig_urlopen_guard

# 2.10 PNA CORS headers + Inbound-Before-Outbound replay order + 20s CDP recovery check
cors_headers_captured = {}
class _DummyCorsHandler:
    def send_header(self, k, v):
        cors_headers_captured[k] = v
sync_mod.LocalBridgeHandler._send_cors(_DummyCorsHandler())
assert cors_headers_captured.get("Access-Control-Allow-Private-Network") == "true", cors_headers_captured
assert "X-API-Key" in cors_headers_captured.get("Access-Control-Allow-Headers", ""), cors_headers_captured

import inspect
src_session_post = inspect.getsource(sync_mod.LocalBridgeHandler._handle_post_session)
src_cdp_post = inspect.getsource(sync_mod.LocalBridgeHandler._handle_post_sync_cdp)
src_do_post = inspect.getsource(sync_mod.LocalBridgeHandler.do_POST)
src_run_loop = inspect.getsource(sync_mod.run_loop)
assert src_session_post.index("flush_inbound_queue_to_cms") < src_session_post.index("process_outbound_outbox_from_cms")
assert src_cdp_post.index("flush_inbound_queue_to_cms") < src_cdp_post.index("process_outbound_outbox_from_cms")
assert "was_lost_before" in src_do_post and "_bg_replay_after_check" in src_do_post
assert "was_lost_before_ping" in src_run_loop and "if not curr_alive:" in src_run_loop and "try_cdp_recovery()" in src_run_loop

# 2.11 _extract_shopee_order_item_unit_price preserves 0đ add-on gifts without Python 'or' falsy trap
assert sync_mod._extract_shopee_order_item_unit_price({"order_price": 0, "item_price": 59000}) == 0
assert sync_mod._extract_shopee_order_item_unit_price({"order_price": "0.00", "item_price": "59000.00"}) == 0
assert sync_mod._extract_shopee_order_item_unit_price({"model_discounted_price": 0, "item_price": 59000, "is_gift": True}) == 0
assert sync_mod._extract_shopee_order_item_unit_price({"model_discounted_price": 0, "item_price": 59000}) == 59000
assert sync_mod._extract_shopee_order_item_unit_price({"model_discounted_price": 39000, "item_price": 59000}) == 39000
assert sync_mod._extract_shopee_order_item_unit_price({"item_price": 0, "price": 59000}) == 0

# 2.12 Real wire HTTP PNA preflight OPTIONS + GET from https://khoaphan.dev against ThreadingHTTPServer
import threading as _th
import urllib.request as _ureq
srv = sync_mod.ThreadingHTTPServer(('127.0.0.1', 0), sync_mod.LocalBridgeHandler)
srv_port = srv.server_address[1]
srv_t = _th.Thread(target=srv.serve_forever, daemon=True)
srv_t.start()
try:
    opt_req = _ureq.Request(
        f"http://127.0.0.1:{srv_port}/shopee/check-session",
        headers={
            "Origin": "https://khoaphan.dev",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type, X-API-Key",
            "Access-Control-Request-Private-Network": "true",
        },
        method="OPTIONS",
    )
    with _ureq.urlopen(opt_req, timeout=3) as opt_resp:
        hdrs_low = {k.lower(): v for k, v in opt_resp.getheaders()}
        assert opt_resp.status == 200
        assert hdrs_low.get("access-control-allow-private-network") == "true", hdrs_low
        assert "x-api-key" in hdrs_low.get("access-control-allow-headers", "").lower(), hdrs_low
finally:
    srv.shutdown()
    srv.server_close()

print("PYTHON_AUDIT_SUITE_ALL_OK")
`
  const pyOut = execSync('python -B -', {
    input: pySuite,
    encoding: 'utf-8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  })
  assert(
    pyOut.includes('PYTHON_AUDIT_SUITE_ALL_OK'),
    'S2-PYTHON-DAEMON',
    'Python Daemon vượt qua toàn bộ kiểm thử: <10 cookies, chống xóa cookie rỗng, HTTP 200 auth loss, khóa giá Flash Sale, đổi tên & xóa Item'
  )

  // --------------------------------------------------------------------------
  // Prepare DB fixtures for Suites 3, 4, 5, 6 (100% isolated & cleaned in finally)
  // --------------------------------------------------------------------------
  const startedAt = new Date(Date.now() - 1000)
  const activeKey = await db.apiKey.findFirst({ where: { active: true } })
  assert(Boolean(activeKey?.secret), 'SETUP', 'Tìm thấy API Key nội bộ cho Inbound Webhook')

  const [category, defaultWh, channels] = await Promise.all([
    db.category.findFirst(),
    db.warehouse.findFirst({ where: { isDefault: true } }),
    db.channel.findMany({ where: { key: { in: ['SHOPEE', 'POS', 'FACEBOOK'] } } }),
  ])
  const shopeeCh = channels.find((c) => c.key === 'SHOPEE')!
  const posCh = channels.find((c) => c.key === 'POS')!
  const fbCh = channels.find((c) => c.key === 'FACEBOOK')!
  assert(Boolean(category && defaultWh && shopeeCh && posCh && fbCh), 'SETUP', 'Đủ Category, Kho mặc định & 3 kênh SHOPEE/POS/FACEBOOK')

  const createdProductIds: string[] = []
  const createdOrderIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdChannelIds: string[] = []
  const createdLedgerIds: string[] = []
  const ts = Date.now()

  // Pre-clean any stray SYNTH-SHARED-* / SYNTH-SPLIT-* / SYNTH-VAR-* from interrupted runs
  const staleProds = await db.product.findMany({
    where: {
      OR: [
        { sku: { startsWith: 'SYNTH-SHARED-' } },
        { sku: { startsWith: 'SYNTH-SPLIT-' } },
        { sku: { startsWith: 'SYNTH-VAR-' } },
        { sku: { startsWith: 'SYNTH-SINGLE-' } },
        { sku: { startsWith: 'TEST-NOAUTO-' } },
        { sku: { startsWith: 'TEST-RELIST-' } },
      ],
    },
    select: { id: true },
  })
  if (staleProds.length > 0) {
    const staleIds = staleProds.map((p) => p.id)
    await db.channelListing.deleteMany({ where: { productId: { in: staleIds } } })
    await db.warehouseStock.deleteMany({ where: { productId: { in: staleIds } } })
    await db.stockMovement.deleteMany({ where: { productId: { in: staleIds } } })
    await db.ledgerEntry.deleteMany({ where: { entityId: { in: staleIds } } })
    await db.product.deleteMany({ where: { id: { in: staleIds } } })
  }

  invalidateApiCache('channels')
  const baselineLinksRes = await productLinksGet()
  const baselineLinksJson = (await baselineLinksRes.json()) as {
    stats: { unlinkedCount: number }
  }
  const baselineUnlinkedCount = baselineLinksJson.stats.unlinkedCount

  const callInbound = async (bodyObj: Record<string, unknown>) => {
    const req = new NextRequest('http://localhost:3010/api/webhooks/inbound', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Apikey ${activeKey!.secret}`,
      },
      body: JSON.stringify(bodyObj),
    })
    const res = await inboundWebhookPost(req)
    const json = (await res.json()) as Record<string, unknown>
    return { status: res.status, ok: res.ok, json }
  }

  try {
    // ------------------------------------------------------------------------
    // SUITE 3: Shopee Price Change (Shared vs Custom POS/Facebook Channel Split)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 3: Shopee Price Change & Channel-Specific Price Preservation ---')
    const skuShared = `SYNTH-SHARED-${ts}`
    const skuSplit = `SYNTH-SPLIT-${ts}`

    const prodShared = await db.product.create({
      data: {
        sku: skuShared,
        name: 'SP Kiểm Thử Giá Chung',
        categoryId: category!.id,
        costPrice: 30000,
        sellPrice: 85000,
        stock: 5,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: `991001${ts}`,
          shopeeModelId: `881001${ts}`,
          shopeeModelName: 'Bản Chuẩn',
          lastSyncedShopeePrice: 85000,
          lastSyncedShopeeStock: 5,
          liveShopeeStock: 5,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodShared.id)

    await db.channelListing.createMany({
      data: [
        { productId: prodShared.id, channelId: shopeeCh.id, price: 85000, status: 'ACTIVE' },
        { productId: prodShared.id, channelId: posCh.id, price: null, status: 'ACTIVE' },
        { productId: prodShared.id, channelId: fbCh.id, price: 82000, status: 'INACTIVE' },
      ],
    })

    const prodSplit = await db.product.create({
      data: {
        sku: skuSplit,
        name: 'SP Kiểm Thử Giá Tách Kênh POS vs Shopee',
        categoryId: category!.id,
        costPrice: 35000,
        sellPrice: 75000, // Giá bán lẻ tại POS (không chịu phí sàn)
        stock: 6,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: `991002${ts}`,
          shopeeModelId: `881002${ts}`,
          shopeeModelName: 'Bản Cao Cấp',
          lastSyncedShopeePrice: 89000,
          lastSyncedShopeeStock: 6,
          liveShopeeStock: 6,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodSplit.id)

    await db.channelListing.createMany({
      data: [
        { productId: prodSplit.id, channelId: shopeeCh.id, price: 89000, status: 'ACTIVE' },
        { productId: prodSplit.id, channelId: posCh.id, price: 75000, status: 'ACTIVE' },
        { productId: prodSplit.id, channelId: fbCh.id, price: 79000, status: 'ACTIVE' },
      ],
    })

    // Sync price change on BOTH products from Shopee
    const priceSyncRes = await callInbound({
      event: 'INBOUND_SHOPEE_BATCH_SYNC',
      data: {
        items: [
          {
            idempotencyKey: `IDEM_SHARED_PRICE_${ts}`,
            shopeeItemId: `991001${ts}`,
            shopeeModelId: `881001${ts}`,
            sku: skuShared,
            modelSku: skuShared,
            name: 'SP Kiểm Thử Giá Chung',
            modelName: 'Bản Chuẩn',
            sellPrice: 95000,
            stock: 5,
            shopeeModifyTime: Math.floor(ts / 1000) + 10,
          },
          {
            idempotencyKey: `IDEM_SPLIT_PRICE_${ts}`,
            shopeeItemId: `991002${ts}`,
            shopeeModelId: `881002${ts}`,
            sku: skuSplit,
            modelSku: skuSplit,
            name: 'SP Kiểm Thử Giá Tách Kênh POS vs Shopee',
            modelName: 'Bản Cao Cấp',
            sellPrice: 99000,
            shopeeNormalPrice: 109000,
            shopeePromotionPrice: 99000,
            stock: 6,
            shopeeModifyTime: Math.floor(ts / 1000) + 10,
          },
        ],
      },
    })
    assert(priceSyncRes.ok, 'S3-PRICE-SYNC', 'INBOUND_SHOPEE_BATCH_SYNC cập nhật giá trả về HTTP 200')

    const [afterShared, afterSplit] = await Promise.all([
      db.product.findUnique({ where: { id: prodShared.id }, include: { listings: true } }),
      db.product.findUnique({ where: { id: prodSplit.id }, include: { listings: true } }),
    ])

    assert(
      afterShared?.sellPrice === 95000 &&
        afterShared.listings.find((l) => l.channelId === shopeeCh.id)?.price === 95000,
      'S3-SHARED-PRICE',
      'Khi dùng giá chung, đổi giá trên Shopee cập nhật đồng bộ cả Product.sellPrice và ChannelListing SHOPEE lên 95.000đ'
    )
    const fbSharedAfter = afterShared!.listings.find((l) => l.channelId === fbCh.id)!
    assert(
      fbSharedAfter.status === 'INACTIVE' && fbSharedAfter.price === 82000,
      'S3-NO-CLOBBER-FB',
      `Kênh FACEBOOK không bị ghi đè giá/trạng thái khi đồng bộ Shopee (status=${fbSharedAfter.status}, price=${fbSharedAfter.price})`
    )

    assert(
      afterSplit?.sellPrice === 75000 &&
        afterSplit.listings.find((l) => l.channelId === posCh.id)?.price === 75000 &&
        afterSplit.listings.find((l) => l.channelId === fbCh.id)?.price === 79000 &&
        afterSplit.listings.find((l) => l.channelId === shopeeCh.id)?.price === 99000,
      'S3-SPLIT-PRICE',
      'Khi tách giá riêng POS (75k) vs Shopee (89k->99k), giá POS & Facebook giữ nguyên 100%, giá kênh Shopee cập nhật 99k'
    )

    const splitAttrs = JSON.parse(afterSplit!.attributes || '{}') as Record<string, unknown>
    assert(
      splitAttrs.shopeeNormalPrice === 109000 && splitAttrs.shopeePromotionPrice === 99000,
      'S3-PROMO-META',
      'Lưu đầy đủ shopeeNormalPrice (109k) và shopeePromotionPrice (99k) trong attributes'
    )

    const linksRes = await productLinksGet()
    const linksJson = (await linksRes.json()) as {
      linkedItems: Array<{ cmsSku: string; syncStatus: string; cmsSellPrice: number }>
    }
    const splitLinkRow = linksJson.linkedItems.find((x) => x.cmsSku === skuSplit)
    assert(
      Boolean(splitLinkRow) &&
        splitLinkRow!.syncStatus === 'IN_SYNC' &&
        splitLinkRow!.cmsSellPrice === 99000,
      'S3-NO-FAKE-PRICE-DRIFT',
      `GET /api/channels/product-links không báo nhầm PRICE_DRIFT khi POS có giá riêng (syncStatus=${splitLinkRow?.syncStatus})`
    )

    const pushReq = new NextRequest('http://localhost:3010/api/channels/product-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'PUSH_STOCK_TO_CHANNEL', productId: prodSplit.id }),
    })
    const pushRes = await productLinksPost(pushReq)
    assert(pushRes.ok, 'S3-MANUAL-PUSH', 'PUSH_STOCK_TO_CHANNEL thành công')
    const afterPushProd = await db.product.findUnique({ where: { id: prodSplit.id } })
    const afterPushAttrs = JSON.parse(afterPushProd?.attributes || '{}') as Record<string, unknown>
    assert(
      afterPushAttrs.cmsTargetPrice === 99000 &&
        afterPushAttrs.cmsTargetStockOrigin === 'MANUAL_OVERRIDE',
      'S3-MANUAL-PUSH-TARGET',
      `PUSH_STOCK_TO_CHANNEL lấy đúng giá kênh SHOPEE (99k thay vì 75k POS) & gắn MANUAL_OVERRIDE`
    )

    // S3-PATCH-SPLIT-PRESERVE: Editing POS price or stock via PATCH /api/products/[id] must NOT overwrite custom Shopee channel price (99k)
    const patchReq = new NextRequest(`http://localhost:3010/api/products/${prodSplit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sellPrice: 78000, // POS price adjusted 75k -> 78k
        stock: 8,
      }),
    })
    const patchRes = await productPatchById(patchReq, {
      params: Promise.resolve({ id: prodSplit.id }),
    })
    assert(patchRes.ok, 'S3-PATCH-SPLIT-OK', 'PATCH /api/products/[id] cập nhật tồn kho & giá POS trả về HTTP 200')
    const afterPatchSplit = await db.product.findUnique({
      where: { id: prodSplit.id },
      include: { listings: true },
    })
    const afterPatchAttrs = JSON.parse(afterPatchSplit?.attributes || '{}') as Record<string, unknown>
    const shopeeListingAfterPatch = afterPatchSplit?.listings.find((l) => l.channelId === shopeeCh.id)
    assert(
      afterPatchSplit?.sellPrice === 78000 &&
        shopeeListingAfterPatch?.price === 99000 &&
        afterPatchAttrs.cmsTargetPrice === 99000,
      'S3-PATCH-SPLIT-PRESERVE',
      `PATCH /api/products/[id] bảo toàn giá kênh SHOPEE 99.000đ khi sửa giá POS lên 78.000đ (listing=${shopeeListingAfterPatch?.price}, target=${afterPatchAttrs.cmsTargetPrice})`
    )

    // S3-PARTIAL-STOCK-ACK-ON-PROMO-LOCK: If stock push succeeded (8) before price hit Flash-Sale lock, syncedStock=8 is preserved
    const promoLockAckRes = await callInbound({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: `OB_PROMO_${ts}`,
        productId: prodSplit.id,
        sku: skuSplit,
        shopeeItemId: `991002${ts}`,
        shopeeModelId: `881002${ts}`,
        syncedStock: 8,
        status: 'DEAD_LETTER',
        attempt: 1,
        error: '[KHÓA GIÁ KHUYẾN MÃI SHOPEE] ongoing promotion',
      },
    })
    assert(promoLockAckRes.ok, 'S3-PROMO-LOCK-ACK', 'OUTBOX_ACK_RESULT khi khóa giá Flash Sale trả về HTTP 200')
    const afterPromoAck = await db.product.findUnique({ where: { id: prodSplit.id } })
    const afterPromoAttrs = JSON.parse(afterPromoAck?.attributes || '{}') as Record<string, unknown>
    assert(
      afterPromoAttrs.lastSyncedShopeeStock === 8 &&
        afterPromoAttrs.liveShopeeStock === 8 &&
        afterPromoAttrs.outboxState === 'DEAD_LETTER',
      'S3-PROMO-LOCK-PRESERVES-STOCK',
      `Khi đẩy Tồn thành công nhưng Giá bị Flash Sale khóa, lastSyncedShopeeStock vẫn cập nhật = 8 (got=${afterPromoAttrs.lastSyncedShopeeStock})`
    )

    // Clear outbox state on prodSplit for subsequent clean teardown
    delete afterPromoAttrs.pendingOutboxSync
    delete afterPromoAttrs.lastCmsEditAt
    delete afterPromoAttrs.outboxState
    delete afterPromoAttrs.outboxError
    await db.product.update({
      where: { id: prodSplit.id },
      data: { attributes: JSON.stringify(afterPromoAttrs) },
    })
    await db.ledgerEntry.deleteMany({
      where: { entityId: prodSplit.id, action: { in: ['OUTBOX_PENDING', 'OUTBOX_DEAD_LETTER'] } },
    })

    // ------------------------------------------------------------------------
    // SUITE 4: Shopee Product/Variation Rename + L1 Cache Invalidation + Baocao BOM
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 4: Shopee Rename, L1 Cache Invalidation & Baocao BOM Immunity ---')
    setApiCache('products:', { products: [{ id: prodShared.id, name: 'Stale Cached Name' }] })
    setApiCache('channels:product-links', { stale: true })
    assert(
      getApiCache('products:') !== null && getApiCache('channels:product-links') !== null,
      'S4-CACHE-PRIMED',
      'Bộ nhớ đệm L1 (products: & channels:product-links) đã nạp trước khi đổi tên trên Sàn'
    )

    const newTitle = 'Hũ Đựng Nến Hoa Sen Phiên Bản Mới 2026 — Phân loại: Trắng Ngọc'
    const renameRes = await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_RENAME_ONLY_${ts}`,
        shopeeItemId: `991001${ts}`,
        shopeeModelId: `881001${ts}`,
        sku: skuShared,
        modelSku: skuShared,
        name: newTitle,
        modelName: 'Trắng Ngọc',
        sellPrice: 95000, // Không đổi giá
        stock: 5, // Không đổi tồn
        shopeeModifyTime: Math.floor(ts / 1000) + 25,
      },
    })
    assert(renameRes.ok, 'S4-RENAME-SYNC', 'INBOUND_SHOPEE_PRODUCT_SYNC khi chỉ đổi tên trả về HTTP 200')

    const renamedProd = await db.product.findUnique({ where: { id: prodShared.id } })
    const renamedAttrs = JSON.parse(renamedProd?.attributes || '{}') as Record<string, unknown>
    assert(
      renamedProd?.name === newTitle && renamedAttrs.shopeeModelName === 'Trắng Ngọc',
      'S4-RENAME-DB',
      'Product.name và attributes.shopeeModelName cập nhật chính xác khi chỉ đổi tên trên Shopee'
    )
    assert(
      getApiCache('products:') === null && getApiCache('channels:product-links') === null,
      'S4-CACHE-INVALIDATED',
      'L1 Cache (products: & channels:product-links) được xóa tức thì ngay sau khi đồng bộ từ Shopee'
    )

    const nameLedger = await db.ledgerEntry.findFirst({
      where: {
        entityId: prodShared.id,
        action: 'PRODUCT_NAME_CHANGED',
        createdAt: { gte: startedAt },
      },
    })
    assert(
      Boolean(nameLedger),
      'S4-RENAME-LEDGER',
      'Sổ Data ghi nhận đầy đủ bản ghi PRODUCT_NAME_CHANGED khi đổi tên sản phẩm/phân loại trên Shopee'
    )

    // Baocao1 canonical SKU mapping resilience after Shopee rename
    const knownCanonicalSet = new Set(CANONICAL_SKUS.map((s) => s.sku))
    const mappedBupSen = resolveCanonicalSku(
      'BM-DEC-SEN-TRANG',
      'Hũ Đựng Nến Hoa Sen Có Nắp Decor Mẫu Mới (Không Còn Chữ Búp)',
      JSON.stringify({ parentSku: 'BM-DEC-SEN', shopeeModelName: 'Trắng mộc' }),
      knownCanonicalSet
    )
    assert(
      mappedBupSen.mappedSku === 'BM-DEC-BUPSEN',
      'S4-BAOCAO-BUPSEN-RENAME',
      `BM-DEC-SEN-TRANG vẫn ánh xạ đúng về BM-DEC-BUPSEN (BOM 300g) sau khi đổi tên trên Shopee (got=${mappedBupSen.mappedSku})`
    )

    const mappedChum = resolveCanonicalSku(
      'BM-SEN-01-MOI',
      'Bộ Quà Tặng Thiền Tịnh Bơ Mộc Mẫu Mới',
      JSON.stringify({ shopeeModelName: 'Chum Sọc Trắng' }),
      knownCanonicalSet
    )
    assert(
      mappedChum.mappedSku === 'BM-KD-CHUMSOC',
      'S4-BAOCAO-CHUM-RENAME',
      `BM-SEN-01-* có shopeeModelName="Chum Sọc Trắng" vẫn ánh xạ đúng về BM-KD-CHUMSOC (got=${mappedChum.mappedSku})`
    )
    const mappedSenLarge = resolveCanonicalSku(
      'BM-DEC-SEN-L-TRANG',
      'Khay Sen Cỡ Đại Đổi Tên Mới Trên Sàn',
      JSON.stringify({ shopeeModelName: 'Trắng' }),
      knownCanonicalSet
    )
    assert(
      mappedSenLarge.mappedSku === 'BM-DEC-SEN-L',
      'S4-BAOCAO-SEN-LARGE-RENAME',
      `BM-DEC-SEN-L-TRANG ánh xạ đúng về BM-DEC-SEN-L mà không bị lấn sang BM-DEC-BUPSEN (got=${mappedSenLarge.mappedSku})`
    )
    assert(
      CARRIER_FEE_ESTIMATES.SPX === 20_000 && CARRIER_FEE_ESTIMATES.VNPOST === 18_000,
      'S4-BAOCAO-CARRIERS',
      'CARRIER_FEE_ESTIMATES hỗ trợ đầy đủ SPX (20.000đ) và VNPOST (18.000đ)'
    )

    // ------------------------------------------------------------------------
    // SUITE 5: Proactive Deleted Variation, Auto-Heal Model ID & Deleted Item
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 5: Proactive Variation Deletion, Auto-Heal & Whole-Item Deletion ---')
    const sharedItemId = `777000${ts}`
    const skuVarKeep = `SYNTH-VAR-HEAL-${ts}`
    const skuVarDel = `SYNTH-VAR-DEL-${ts}`

    const prodVarKeep = await db.product.create({
      data: {
        sku: skuVarKeep,
        name: 'SP Đa Phân Loại — Giữ & Đổi Model ID',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 60000,
        stock: 4,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: sharedItemId,
          shopeeModelId: '5001',
          shopeeModelName: 'Màu Trắng',
          brokenMarketplaceLink: true,
          outboxState: 'BROKEN_LINK',
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodVarKeep.id)

    const prodVarDel = await db.product.create({
      data: {
        sku: skuVarDel,
        name: 'SP Đa Phân Loại — Sẽ Xóa Trên Shopee',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 60000,
        stock: 3,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: sharedItemId,
          shopeeModelId: '5002',
          shopeeModelName: 'Màu Xám Đã Xóa',
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodVarDel.id)

    // Shopee recreated variation 5001 as 6001 (same SKU -> Auto-Heal!) AND deleted variation 5002
    const varSyncRes = await callInbound({
      event: 'INBOUND_SHOPEE_BATCH_SYNC',
      data: {
        items: [
          {
            idempotencyKey: `IDEM_VAR_RECON_${ts}`,
            shopeeItemId: sharedItemId,
            shopeeModelId: '6001',
            sku: skuVarKeep,
            modelSku: skuVarKeep,
            name: 'SP Đa Phân Loại — Giữ & Đổi Model ID',
            modelName: 'Màu Trắng',
            sellPrice: 60000,
            stock: 4,
            itemActiveModelIds: ['6001'],
            shopeeModifyTime: Math.floor(ts / 1000) + 40,
          },
        ],
      },
    })
    assert(varSyncRes.ok, 'S5-VAR-BATCH', 'Đồng bộ lô có itemActiveModelIds trả về HTTP 200')

    const [healedAfter, deletedVarAfter] = await Promise.all([
      db.product.findUnique({ where: { id: prodVarKeep.id } }),
      db.product.findUnique({ where: { id: prodVarDel.id } }),
    ])
    const healedAttrs = JSON.parse(healedAfter?.attributes || '{}') as Record<string, unknown>
    const deletedVarAttrs = JSON.parse(deletedVarAfter?.attributes || '{}') as Record<string, unknown>

    assert(
      healedAttrs.shopeeModelId === '6001' && !healedAttrs.brokenMarketplaceLink,
      'S5-AUTO-HEAL-RECOVER',
      'Phân loại trùng SKU tự động hàn gắn Model ID mới (#5001 ➔ #6001) & gỡ cờ BROKEN_LINK'
    )
    assert(
      deletedVarAttrs.brokenMarketplaceLink === true &&
        deletedVarAttrs.outboxState === 'BROKEN_LINK',
      'S5-PROACTIVE-DELETED-VAR',
      'Phân loại bị xóa trên Shopee (#5002) được phát hiện chủ động và gắn cờ BROKEN_LINK ngay lập tức'
    )

    // Now delete the entire Item ID on Shopee via INBOUND_SHOPEE_CATALOG_RECONCILE
    const catReconRes = await callInbound({
      event: 'INBOUND_SHOPEE_CATALOG_RECONCILE',
      data: {
        deletedShopeeItemIds: [sharedItemId],
        shopId: '197195817',
        shopUsername: 'thaimy1605',
      },
    })
    assert(
      catReconRes.ok && Number(catReconRes.json.brokenCount) >= 1,
      'S5-CATALOG-RECONCILE',
      `INBOUND_SHOPEE_CATALOG_RECONCILE gắn cờ BROKEN_LINK khi toàn bộ Item #${sharedItemId} bị xóa trên Shopee`
    )
    const healedAfterItemDel = await db.product.findUnique({ where: { id: prodVarKeep.id } })
    const itemDelAttrs = JSON.parse(healedAfterItemDel?.attributes || '{}') as Record<string, unknown>
    assert(
      itemDelAttrs.brokenMarketplaceLink === true && itemDelAttrs.outboxState === 'BROKEN_LINK',
      'S5-ITEM-DELETED-FLAG',
      'Sản phẩm còn lại dưới Item bị xóa cũng chuyển sang trạng thái BROKEN_LINK an toàn'
    )

    // S5B: Two single-SKU products both having shopeeModelId="0" MUST NOT collide or overwrite each other,
    // AND collapsing multi-variation -> single-SKU (model_id="0") marks orphaned variation BROKEN_LINK!
    const singleItemA = `666101${ts}`
    const singleItemB = `666102${ts}`
    const prodSingleA = await db.product.create({
      data: {
        sku: `SYNTH-SINGLE-A-${ts}`,
        name: 'SP Đơn Lẻ A',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 55000,
        stock: 3,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: singleItemA,
          shopeeModelId: '0',
          shopId: `TEST_SHOP_${ts}`,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    const prodSingleB = await db.product.create({
      data: {
        sku: `SYNTH-SINGLE-B-${ts}`,
        name: 'SP Đơn Lẻ B',
        categoryId: category!.id,
        costPrice: 25000,
        sellPrice: 65000,
        stock: 4,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: singleItemB,
          shopeeModelId: '0',
          shopId: `TEST_SHOP_${ts}`,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodSingleA.id, prodSingleB.id)

    const singleSyncRes = await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_SINGLE_B_${ts}`,
        shopeeItemId: singleItemB,
        shopeeModelId: '0',
        itemActiveModelIds: ['0'],
        sku: `SYNTH-SINGLE-B-${ts}`,
        modelSku: `SYNTH-SINGLE-B-${ts}`,
        name: 'SP Đơn Lẻ B — Đổi Giá 72k',
        sellPrice: 72000,
        stock: 4,
        shopId: `TEST_SHOP_${ts}`,
        shopeeModifyTime: Math.floor(ts / 1000) + 50,
      },
    })
    assert(singleSyncRes.ok, 'S5-SINGLE-MODEL0-SYNC', 'Đồng bộ SP đơn shopeeModelId="0" trả về HTTP 200')
    const [afterSingleA, afterSingleB] = await Promise.all([
      db.product.findUnique({ where: { id: prodSingleA.id } }),
      db.product.findUnique({ where: { id: prodSingleB.id } }),
    ])
    assert(
      afterSingleA?.name === 'SP Đơn Lẻ A' &&
        afterSingleA?.sellPrice === 55000 &&
        afterSingleB?.sellPrice === 72000,
      'S5-SINGLE-NO-COLLISION',
      `Hai SP đơn cùng shopeeModelId="0" không ghi đè chéo nhau (A=${afterSingleA?.sellPrice}, B=${afterSingleB?.sellPrice})`
    )

    // First-scan fullCatalogItemIds reconciliation (deletedShopeeItemIds=[], fullCatalogItemIds=[singleItemA] -> singleItemB broken!)
    const firstScanRecon = await callInbound({
      event: 'INBOUND_SHOPEE_CATALOG_RECONCILE',
      data: {
        deletedShopeeItemIds: [],
        fullCatalogItemIds: [singleItemA],
        shopId: `TEST_SHOP_${ts}`,
        shopUsername: 'thaimy1605',
      },
    })
    const afterFirstScanB = await db.product.findUnique({ where: { id: prodSingleB.id } })
    const afterFirstScanBAttrs = JSON.parse(afterFirstScanB?.attributes || '{}') as Record<string, unknown>
    assert(
      firstScanRecon.ok && afterFirstScanBAttrs.brokenMarketplaceLink === true,
      'S5-FIRST-SCAN-FULL-CATALOG-RECONCILE',
      'Lần quét đầu tiên với fullCatalogItemIds phát hiện chính xác Item bị xóa khi Daemon đang tắt'
    )

    // ------------------------------------------------------------------------
    // SUITE 6: Test-Guard Immunity for Real Shopee Orders & Masked Customers
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 6: Test-Guard Immunity for Real Shopee Orders & Buyers ---')
    const realLikeBuyer = await db.customer.create({
      data: {
        name: 'Trần Ngọc Minh***',
        phone: null,
        email: `shopee:minhngoc_real_${ts}`,
        inferredProfile: `[Shopee Buyer: shopee:minhngoc_real_${ts}]`,
      },
    })
    createdCustomerIds.push(realLikeBuyer.id)

    const realLikeOrder = await db.order.create({
      data: {
        code: `DH261124-${String(ts).slice(-4)}`,
        customerId: realLikeBuyer.id,
        channelId: shopeeCh.id,
        status: 'CONFIRMED',
        paymentMethod: 'COD',
        paymentStatus: 'UNPAID',
        subtotal: 59000,
        shippingFee: 0,
        discountAmount: 0,
        total: 59000,
        note: `Shopee Order #2611249988AB · Người mua: minhngoc_real_${ts}`,
      },
    })
    createdOrderIds.push(realLikeOrder.id)

    const tgRes = await testGuardGet()
    const tgJson = (await tgRes.json()) as {
      breakdown?: { orders?: number; customers?: number }
      samples?: { orders?: string[]; customers?: string[] }
    }
    const sampleOrders = tgJson.samples?.orders ?? []
    const sampleCustomers = tgJson.samples?.customers ?? []
    assert(
      !sampleOrders.some((s) => s.includes(realLikeOrder.code)) &&
        !sampleCustomers.some((s) => s.includes('Trần Ngọc Minh')),
      'S6-REAL-SHOPEE-IMMUNITY',
      'Test-Guard bảo vệ 100% đơn hàng Shopee thật (Shopee Order #<SN>) và khách hàng che SĐT (shopee:<username>)'
    )
    assert(
      isSyntheticCustomerName('Khách Shopee #9988AB') === false &&
        isSyntheticCustomerName('Khách Shopee #TEST_01') === true,
      'S6-MASKED-BUYER-PRINT-IMMUNITY',
      'Bộ lọc synthetic-filter không chặn nhầm khách hàng Shopee bị che tên thật (Khách Shopee #<6 ký tự cuối SN>)'
    )

    // ------------------------------------------------------------------------
    // SUITE 7: Round-2 Deep Audit Remediations (Outbox Price Intent, Custom Name,
    //          khoaphan.dev PNA, 0đ Gift & SPX Ship, Channel Disconnect, Stale Unlinked)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 7: Round-2 Deep Audit Remediations ---')

    // 7.1 normalizeCmsOrigin & khoaphan.dev / __BETA_SUBPATH_SHIM__
    assert(
      normalizeCmsOrigin('https://khoaphan.dev/bo-moc') === 'http://127.0.0.1:3010' &&
        normalizeCmsOrigin('https://beta.khoaphan.dev') === 'http://127.0.0.1:3010' &&
        normalizeCmsOrigin('https://khoap1220-hue.github.io/bo-moc/') === 'http://127.0.0.1:3010' &&
        normalizeCmsOrigin('http://127.0.0.1:3010/') === 'http://127.0.0.1:3010',
      'S7-STATIC-ORIGIN-NORMALIZE',
      'normalizeCmsOrigin chặn cả khoaphan.dev và github.io, tự chuyển về http://127.0.0.1:3010'
    )
    const realtimeHookSrc = fs.readFileSync(path.resolve('src/hooks/use-realtime.ts'), 'utf-8')
    const periphDialogSrc = fs.readFileSync(
      path.resolve('src/components/cms/pos-peripherals-dialog.tsx'),
      'utf-8'
    )
    assert(
      realtimeHookSrc.includes('__BETA_SUBPATH_SHIM__') &&
        realtimeHookSrc.includes('khoaphan.dev') &&
        periphDialogSrc.includes('__BETA_SUBPATH_SHIM__') &&
        periphDialogSrc.includes('khoaphan.dev'),
      'S7-SUBPATH-SHIM-DETECTION',
      'use-realtime.ts và pos-peripherals-dialog.tsx nhận diện đầy đủ window.__BETA_SUBPATH_SHIM__ và khoaphan.dev'
    )

    // 7.2 Live DB has 0 accidental Outbox jobs + priceDrifted only triggers on explicit CMS intent
    const liveOutboxRes = await callInbound({
      event: 'OUTBOX_FETCH_PENDING',
      data: { includeSyntheticTest: false, onlySyntheticTest: false },
    })
    const realLiveOutboxJobs = (
      (liveOutboxRes.json.jobs as Array<{ sku: string }> | undefined) ?? []
    ).filter((j) => !String(j.sku || '').startsWith('SYNTH-'))
    assert(
      liveOutboxRes.ok && realLiveOutboxJobs.length === 0,
      'S7-LIVE-DB-ZERO-ACCIDENTAL-OUTBOX',
      `18 SKU thật trên CSDL hiện tại sinh đúng 0 job AUTO_OUTBOX ngoài ý muốn (realJobs=${realLiveOutboxJobs.length})`
    )

    // Simulate stale lastSyncedShopeePrice WITHOUT cmsTargetPrice or OUTBOX_PENDING -> must NOT trigger AUTO_OUTBOX
    const prodGuardPrice = await db.product.create({
      data: {
        sku: `TEST-NOAUTO-${ts}`,
        name: 'SP Chặn Đẩy Giá Tự Động Khi Chưa Có Chủ Đích CMS',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 59000,
        stock: 0,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: `997001${ts}`,
          shopeeModelId: `887001${ts}`,
          lastSyncedShopeePrice: 59000, // Lệch với ChannelListing(SHOPEE).price = 39000 nhưng KHÔNG có cmsTargetPrice
          lastSyncedShopeeStock: 0,
          liveShopeeStock: 0,
          isUnlistedOnShopee: false,
          lastSyncedShopeeUnlisted: false,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodGuardPrice.id)
    await db.channelListing.create({
      data: { productId: prodGuardPrice.id, channelId: shopeeCh.id, price: 39000, status: 'ACTIVE' },
    })

    const synthOutboxNoIntent = await callInbound({
      event: 'OUTBOX_FETCH_PENDING',
      data: { onlySyntheticTest: true },
    })
    const noIntentJobs = (synthOutboxNoIntent.json.jobs as Array<{ productId: string; priceDrifted: boolean }>) || []
    assert(
      !noIntentJobs.some((j) => j.productId === prodGuardPrice.id),
      'S7-NO-IMPLICIT-PRICE-OUTBOX',
      'OUTBOX_FETCH_PENDING không tự bắn AUTO_OUTBOX đổi giá khi thiếu cmsTargetPrice và thiếu OUTBOX_PENDING tường minh'
    )

    // Now explicitly update Shopee price on CMS via PATCH /api/products/[id] -> MUST enqueue priceDrifted=true
    const explicitPricePatchReq = new NextRequest(`http://localhost:3010/api/products/${prodGuardPrice.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'SP Gọn Nội Bộ POS',
        listings: [{ channelId: shopeeCh.id, price: 49000 }],
      }),
    })
    const explicitPricePatchRes = await productPatchById(explicitPricePatchReq, {
      params: Promise.resolve({ id: prodGuardPrice.id }),
    })
    assert(explicitPricePatchRes.status === 200, 'S7-EXPLICIT-PRICE-AND-CUSTOM-NAME-PATCH', 'PATCH /api/products/[id] đổi tên nội bộ & giá Shopee trả về 200')

    const synthOutboxWithIntent = await callInbound({
      event: 'OUTBOX_FETCH_PENDING',
      data: { onlySyntheticTest: true },
    })
    const withIntentJobs =
      (synthOutboxWithIntent.json.jobs as Array<{
        outboxId: string
        productId: string
        priceDrifted: boolean
        targetPrice: number
      }>) || []
    const matchedIntentJob = withIntentJobs.find((j) => j.productId === prodGuardPrice.id)
    assert(
      Boolean(matchedIntentJob && matchedIntentJob.priceDrifted === true && matchedIntentJob.targetPrice === 49000),
      'S7-EXPLICIT-PRICE-OUTBOX-ENQUEUED',
      'Khi sửa giá Shopee có chủ đích từ CMS, OUTBOX_FETCH_PENDING sinh lệnh đẩy giá chính xác (targetPrice=49000)'
    )

    // Complete Outbox ACK first so INBOUND_SHOPEE_PRODUCT_SYNC runs full logic (instead of SKIPPED_PENDING_OUTBOX)
    await callInbound({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: matchedIntentJob!.outboxId,
        productId: prodGuardPrice.id,
        sku: prodGuardPrice.sku,
        shopeeItemId: `997001${ts}`,
        shopeeModelId: `887001${ts}`,
        syncedStock: 0,
        syncedPrice: 49000,
        syncedUnlisted: false,
        status: 'COMPLETED',
        idempotencyKey: `ACK_GUARD_PRICE_${ts}`,
      },
    })

    // 7.3 Custom internal CMS name (cmsCustomName / lastSyncedShopeeName) preserved until Shopee title actually changes
    const preCustomSnap = await db.product.findUnique({ where: { id: prodGuardPrice.id } })
    const preCustomAttrs = JSON.parse(preCustomSnap?.attributes || '{}') as Record<string, unknown>
    assert(
      preCustomAttrs.cmsCustomName === true &&
        preCustomAttrs.lastSyncedShopeeName === 'SP Chặn Đẩy Giá Tự Động Khi Chưa Có Chủ Đích CMS',
      'S7-CUSTOM-NAME-FLAGGED',
      'Sửa tên trên CMS tự động bật cmsCustomName=true và lưu lastSyncedShopeeName gốc'
    )

    // Inbound sync with UNCHANGED Shopee title -> keeps 'SP Gọn Nội Bộ POS'
    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_KEEP_NAME_${ts}`,
        shopeeItemId: `997001${ts}`,
        shopeeModelId: `887001${ts}`,
        sku: prodGuardPrice.sku,
        modelSku: prodGuardPrice.sku,
        name: 'SP Chặn Đẩy Giá Tự Động Khi Chưa Có Chủ Đích CMS',
        sellPrice: 49000,
        stock: 0,
        shopeeModifyTime: Math.floor(ts / 1000) + 100,
      },
    })
    const afterSameShopeeTitle = await db.product.findUnique({ where: { id: prodGuardPrice.id } })
    assert(
      afterSameShopeeTitle?.name === 'SP Gọn Nội Bộ POS',
      'S7-CUSTOM-NAME-PRESERVED',
      `Tên gọn nội bộ CMS được giữ nguyên khi tiêu đề Shopee không đổi (name=${afterSameShopeeTitle?.name})`
    )

    // Inbound sync with CHANGED Shopee title -> updates to new Shopee title & clears cmsCustomName
    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_NEW_TITLE_${ts}`,
        shopeeItemId: `997001${ts}`,
        shopeeModelId: `887001${ts}`,
        sku: prodGuardPrice.sku,
        modelSku: prodGuardPrice.sku,
        name: 'Tiêu Đề Mới Đổi Trực Tiếp Trên Sàn Shopee 2027',
        sellPrice: 49000,
        stock: 0,
        shopeeModifyTime: Math.floor(ts / 1000) + 200,
      },
    })
    const afterChangedShopeeTitle = await db.product.findUnique({ where: { id: prodGuardPrice.id } })
    const afterChangedTitleAttrs = JSON.parse(afterChangedShopeeTitle?.attributes || '{}') as Record<string, unknown>
    assert(
      afterChangedShopeeTitle?.name === 'Tiêu Đề Mới Đổi Trực Tiếp Trên Sàn Shopee 2027' &&
        afterChangedTitleAttrs.cmsCustomName === false,
      'S7-SHOPEE-RENAME-OVERRIDES-CLEANLY',
      'Khi tiêu đề trên Shopee thực sự thay đổi, CMS cập nhật sang tiêu đề mới và đặt lại cmsCustomName=false'
    )

    // 7.4 baocao BM-SEN-01-TIM-TRANG mapping + 0đ gift item + SPX 0đ seller shipping subsidy
    const mappedHeart = resolveCanonicalSku(
      'BM-SEN-01-TIM-TRANG',
      'Chân Nến Hoa Sen & Hũ Sọc Thạch Cao — Phân loại: Trái Tim - Trắng',
      JSON.stringify({ shopeeItemId: '50521234295', shopeeModelId: '283093258600', shopeeModelName: 'Trái Tim - Trắng' }),
      knownCanonicalSet
    )
    const mappedLotus = resolveCanonicalSku(
      'BM-SEN-01-TRANG',
      'Chân Nến Hoa Sen & Đế Trái Tim — Phân loại: Chân Sen - Trắng',
      JSON.stringify({ shopeeItemId: '50521234295', shopeeModelId: '371713510932', shopeeModelName: 'Chân Sen - Trắng' }),
      knownCanonicalSet
    )
    assert(
      mappedHeart.mappedSku === 'BM-DEC-TRAITIM' && mappedLotus.mappedSku === 'BM-DEC-SEN',
      'S7-BAOCAO-HEART-VARIANT-MAP',
      `BM-SEN-01-TIM-TRANG ánh xạ đúng sang BM-DEC-TRAITIM (${mappedHeart.mappedSku}), BM-SEN-01-TRANG giữ BM-DEC-SEN (${mappedLotus.mappedSku})`
    )

    // Test 0đ add-on gift item + SPX fee=0 in INBOUND_SHOPEE_ORDER_SYNC, baocao1-bomoc & /api/reports/pnl
    const giftOrderSn = `261124GIFT${String(ts).slice(-6)}`
    const giftOrderSync = await callInbound({
      event: 'INBOUND_SHOPEE_ORDER_SYNC',
      data: {
        shopeeOrderSn: giftOrderSn,
        shopeeOrderStatus: 'COMPLETED',
        buyerUsername: `gift_buyer_${ts}`,
        customerName: `[TEST] Khách Mua Kèm Quà 0đ ${ts}`,
        shippingCarrier: 'SPX Express',
        trackingNumber: `SPXVN0${ts}`,
        shippingFee: 0,
        items: [
          {
            sku: prodSingleA.sku,
            modelSku: prodSingleA.sku,
            shopeeItemId: singleItemA,
            shopeeModelId: '0',
            name: 'SP Đơn Lẻ A',
            quantity: 1,
            price: 55000,
          },
          {
            sku: prodSplit.sku,
            modelSku: prodSplit.sku,
            shopeeItemId: `991002${ts}`,
            shopeeModelId: `881002${ts}`,
            name: 'Quà Tặng Mua Kèm 0đ',
            quantity: 1,
            price: 0,
          },
        ],
      },
    })
    assert(giftOrderSync.ok, 'S7-GIFT-ORDER-SYNC-200', 'Đồng bộ đơn Shopee có sản phẩm quà tặng 0đ + SPX trả về HTTP 200')
    const syncedGiftOrderId = String((giftOrderSync.json.order as Record<string, unknown>)?.id || '')
    if (syncedGiftOrderId) {
      createdOrderIds.push(syncedGiftOrderId)
      const persistedGiftOrder = await db.order.findUnique({
        where: { id: syncedGiftOrderId },
        include: { items: true, shipments: true },
      })
      if (persistedGiftOrder?.customerId) {
        createdCustomerIds.push(persistedGiftOrder.customerId)
      }
      const zeroItem = persistedGiftOrder?.items.find((it) => it.productId === prodSplit.id)
      assert(
        persistedGiftOrder?.subtotal === 55000 && zeroItem?.price === 0,
        'S7-ZERO-PRICE-GIFT-PRESERVED',
        `Sản phẩm quà tặng 0đ được hạch toán đúng 0đ (subtotal=${persistedGiftOrder?.subtotal}, giftPrice=${zeroItem?.price})`
      )

      const ordYmd = new Date(persistedGiftOrder!.createdAt.getTime() + 7 * 3600_000)
        .toISOString()
        .slice(0, 7)
      const snap = await buildBaocao1Snapshot({ reportMonth: ordYmd, currentMonth: ordYmd, scope: 'all' })
      const giftSalesRows = snap.salesOrders.filter((r) => r.orderCode === persistedGiftOrder!.code)
      const totalSellerShipOnSpx = giftSalesRows.reduce((s, r) => s + r.sellerShippingPaid, 0)
      assert(
        giftSalesRows.length === 2 && totalSellerShipOnSpx === 0,
        'S7-SPX-ZERO-SHIP-SUBSIDY-BAOCAO',
        `Đơn Shopee SPX có fee=0 & shippingFee=0 không bị trừ oan 20.000đ phí ship trong baocao1 (sellerShippingPaid=${totalSellerShipOnSpx})`
      )

      const pnlReq = new NextRequest('http://localhost:3010/api/reports/pnl?days=7')
      const pnlRes = await pnlGet(pnlReq)
      const pnlJson = (await pnlRes.json()) as { byChannel: Array<{ key: string; shippingSubsidy: number }> }
      const shopeePnlRow = pnlJson.byChannel.find((c) => c.key === 'SHOPEE')
      assert(
        pnlRes.status === 200 && (shopeePnlRow?.shippingSubsidy ?? 0) === 0,
        'S7-SPX-ZERO-SHIP-SUBSIDY-PNL',
        `API /api/reports/pnl không trừ khống 20.000đ phí ship cho đơn Shopee SPX (shippingSubsidy=${shopeePnlRow?.shippingSubsidy ?? 0})`
      )
    }

    // 7.5 Protected 3rd real order, default Shop ID #197195817, Channel disconnect preserves prices,
    //     LINK_TO_EXISTING SHOPEE_TO_CMS 0 PRICE_DRIFT, and stale UNLINKED_MARKETPLACE_ITEM cleanup
    const shopeeProvider = INTEGRATION_PROVIDERS.find((p) => p.provider === 'SHOPEE')
    assert(
      PROTECTED_ORDER_CODES.has('DH261109-8411') &&
        PROTECTED_INVOICE_CODES.has('PXK261109-0001') &&
        PROTECTED_CUSTOMER_IDS.has('cmw97oj5n00tdveyg9zihnewz') &&
        shopeeProvider?.defaultConfig.shopId === '197195817',
      'S7-PROTECTED-3RD-ORDER-AND-DEFAULT-SHOPID',
      'Bảo vệ đơn thật thứ 3 (DH261109-8411 / PXK261109-0001) và cấu hình mặc định SHOPEE shopId = 197195817'
    )

    // Test channel disconnect/reconnect on isolated synthetic channel -> preserves ChannelListing & custom price
    const synthCh = await db.channel.create({
      data: {
        key: `SYNTH_CH_${ts}`,
        name: `[TEST] Kênh Tạm Dừng Bảo Toàn Giá ${ts}`,
        color: '#64748b',
        connected: true,
        feePercent: 5,
      },
    })
    createdChannelIds.push(synthCh.id)
    await db.channelListing.create({
      data: { productId: prodGuardPrice.id, channelId: synthCh.id, price: 66000, status: 'ACTIVE' },
    })

    const disconnRes = await channelPatchById(
      new NextRequest(`http://localhost:3010/api/channels/${synthCh.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connected: false }),
      }),
      { params: Promise.resolve({ id: synthCh.id }) }
    )
    const afterDisconnListing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: prodGuardPrice.id, channelId: synthCh.id } },
    })
    assert(
      disconnRes.status === 200 &&
        afterDisconnListing !== null &&
        afterDisconnListing.price === 66000 &&
        afterDisconnListing.status === 'INACTIVE',
      'S7-CHANNEL-DISCONNECT-PRESERVES-PRICE',
      `Tắt kênh bán chuyển trạng thái listing sang INACTIVE và giữ nguyên giá riêng kênh (${afterDisconnListing?.price}đ)`
    )

    // Test LINK_TO_EXISTING with syncDirection='SHOPEE_TO_CMS' when POS sellPrice (59000) != Shopee sellPrice (39000)
    const prodToLink = await db.product.create({
      data: {
        sku: `SYNTH-SHARED-LINK-${ts}`,
        name: 'SP Chờ Ghép Nối Không Bị PRICE_DRIFT',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 59000,
        stock: 3,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
      },
    })
    createdProductIds.push(prodToLink.id)

    const linkRes = await productLinksPost(
      new NextRequest('http://localhost:3010/api/channels/product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'LINK_TO_EXISTING',
          cmsProductId: prodToLink.id,
          shopeeItemId: `997555${ts}`,
          shopeeModelId: `887555${ts}`,
          shopeeSku: prodToLink.sku,
          name: prodToLink.name,
          sellPrice: 39000,
          stock: 3,
          syncDirection: 'SHOPEE_TO_CMS',
          stockInitMode: 'TAKE_FROM_MARKETPLACE',
          confirmRealPhysicalStock: true,
        }),
      })
    )
    const linkListing = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: prodToLink.id, channelId: shopeeCh.id } },
    })
    const linksCheckRes = await productLinksGet()
    const linksCheckJson = (await linksCheckRes.json()) as {
      stats: { unlinkedCount: number }
      linkedItems: Array<{ cmsProductId: string; syncStatus: string }>
    }
    const linkedEntry = linksCheckJson.linkedItems.find((i) => i.cmsProductId === prodToLink.id)
    assert(
      linkRes.status === 200 && linkListing?.price === 39000 && linkedEntry?.syncStatus === 'IN_SYNC',
      'S7-LINK-SHOPEE-TO-CMS-NO-PRICE-DRIFT',
      `LINK_TO_EXISTING (SHOPEE_TO_CMS) gán ChannelListing.price=${linkListing?.price} khớp giá Sàn, syncStatus=${linkedEntry?.syncStatus}`
    )

    // Test automatic retirement of stale UNLINKED_MARKETPLACE_ITEM models on same shopeeItemId
    const synthUnlinkedItemId = `997888${ts}`
    const staleLedger = await db.ledgerEntry.create({
      data: {
        scope: 'CHANNEL',
        action: 'UNLINKED_MARKETPLACE_ITEM',
        entityType: 'Product',
        entityCode: `${synthUnlinkedItemId}_111001`,
        title: `SYNTH-${ts} Stale Model`,
        detail: JSON.stringify({
          channelKey: 'SHOPEE',
          shopeeItemId: synthUnlinkedItemId,
          shopeeModelId: '111001',
          sku: `SYNTH-STALE-UL-${ts}`,
          modelSku: `SYNTH-STALE-UL-${ts}`,
          name: 'SP Phân Loại Cũ Đã Xóa',
          sellPrice: 45000,
          stock: 0,
        }),
      },
    })
    createdLedgerIds.push(staleLedger.id)

    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_CLEAN_UL_${ts}`,
        shopeeItemId: synthUnlinkedItemId,
        shopeeModelId: '111002',
        itemActiveModelIds: ['111002'],
        sku: `SYNTH-ACTIVE-UL-${ts}`,
        modelSku: `SYNTH-ACTIVE-UL-${ts}`,
        name: 'SP Phân Loại Mới Đang Hoạt Động',
        sellPrice: 45000,
        stock: 2,
      },
    })
    const retiredStale = await db.ledgerEntry.findUnique({ where: { id: staleLedger.id } })
    assert(
      retiredStale?.action === 'UNLINKED_STALE_MODEL_REMOVED' &&
        baselineUnlinkedCount >= 8 &&
        linksCheckJson.stats.unlinkedCount === baselineUnlinkedCount,
      'S7-STALE-UNLINKED-MODEL-RETIRED',
      `Phân loại chưa liên kết cũ tự động thu hồi (${retiredStale?.action}) và CSDL thật giữ nguyên đúng ${linksCheckJson.stats.unlinkedCount}/${baselineUnlinkedCount} dòng chưa liên kết hợp lệ`
    )

    // ------------------------------------------------------------------------
    // SUITE 8: Adversarial Reviewer Regression Suite (Same-SKU Paid+0đ Cancel,
    //          Bulk Stock Split-Price Immunity, PUT Disconnected Channel Price,
    //          LINK_TO_EXISTING Custom POS Name Preservation)
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 8: Adversarial Reviewer Regression Suite ---')

    // 8.1 Same productId on 2 lines in 1 order (1 paid @ 55k + 1 gift @ 0đ) -> baocao1 0-dust + cancelOrder exact +2 restock (NOT +4!)
    const prodDupOrder = await db.product.create({
      data: {
        sku: `SYNTH-SINGLE-DUP-${ts}`,
        name: 'SP Mua 1 Tặng 1 Cùng Mã Không Nhân Đôi Hoàn Kho',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 55000,
        stock: 10,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
      },
    })
    createdProductIds.push(prodDupOrder.id)

    const dupOrder = await createOrder({
      channelId: shopeeCh.id,
      customerName: `[TEST] Khách Mua Kèm Cùng SKU ${ts}`,
      shippingFee: 0,
      discountAmount: 3333,
      note: `Shopee Order #261124DUP${String(ts).slice(-4)}`,
      items: [
        { productId: prodDupOrder.id, quantity: 1, priceOverride: 33333 },
        { productId: prodDupOrder.id, quantity: 1, priceOverride: 33333 },
        { productId: prodDupOrder.id, quantity: 1, priceOverride: 0 },
      ],
    })
    createdOrderIds.push(dupOrder.id)
    if (dupOrder.customerId) createdCustomerIds.push(dupOrder.customerId)

    const stockAfterDupCreate = await db.product.findUnique({ where: { id: prodDupOrder.id } })
    assert(
      stockAfterDupCreate?.stock === 7 && dupOrder.items.length === 3,
      'S8-SAME-SKU-MULTI-LINE-DEDUCT',
      `Đơn 3 dòng cùng SKU (2 dòng trả tiền + 1 dòng quà 0đ) trừ kho chính xác -3 (10 ➔ ${stockAfterDupCreate?.stock})`
    )

    const dupYmd = new Date(dupOrder.createdAt.getTime() + 7 * 3600_000).toISOString().slice(0, 7)
    const dupSnap = await buildBaocao1Snapshot({ reportMonth: dupYmd, currentMonth: dupYmd, scope: 'all' })
    const dupBaocaoRows = dupSnap.salesOrders.filter((r) => r.orderCode === dupOrder.code)
    const zeroGiftBaocaoRow = dupBaocaoRows.find((r) => r.actualUnitPrice === 0)
    assert(
      dupBaocaoRows.length === 3 &&
        zeroGiftBaocaoRow?.platformAndVoucherFee === 0 &&
        zeroGiftBaocaoRow?.sellerShippingPaid === 0,
      'S8-BAOCAO-ZERO-GIFT-NO-ROUNDING-DUST',
      `Dòng quà tặng 0đ cuối đơn không bị dồn sai số làm tròn phí sàn/voucher (fee=${zeroGiftBaocaoRow?.platformAndVoucherFee})`
    )

    await cancelOrder({ orderId: dupOrder.id, reason: 'Kiểm thử hủy đơn trùng SKU không hoàn kho gấp ba' })
    const stockAfterDupCancel = await db.product.findUnique({ where: { id: prodDupOrder.id } })
    assert(
      stockAfterDupCancel?.stock === 10,
      'S8-CANCEL-SAME-SKU-EXACT-RESTOCK',
      `Hủy đơn có 3 dòng cùng productId hoàn kho đúng +3 về 10 (thay vì +9 = 16; actual=${stockAfterDupCancel?.stock})`
    )

    // 8.2 PUT /api/products/[id] from ProductsView (passing only connected channels) MUST NOT delete disconnected synthCh listing or wipe its 66k price!
    const putFromUiRes = await productPutById(
      new NextRequest(`http://localhost:3010/api/products/${prodGuardPrice.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: prodGuardPrice.sku,
          name: 'Tiêu Đề Mới Đổi Trực Tiếp Trên Sàn Shopee 2027',
          sellPrice: 59000,
          costPrice: 20000,
          stock: 2,
          listingChannelIds: [shopeeCh.id],
          listings: [{ channelId: shopeeCh.id, price: 49000 }],
        }),
      }),
      { params: Promise.resolve({ id: prodGuardPrice.id }) }
    )
    const synthListingAfterPut = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: prodGuardPrice.id, channelId: synthCh.id } },
    })
    assert(
      putFromUiRes.status === 200 &&
        synthListingAfterPut !== null &&
        synthListingAfterPut.status === 'INACTIVE' &&
        synthListingAfterPut.price === 66000,
      'S8-PUT-PRESERVES-DISCONNECTED-CHANNEL-PRICE',
      `PUT /api/products/[id] bảo toàn 100% ChannelListing của kênh đang ngắt kết nối (status=${synthListingAfterPut?.status}, price=${synthListingAfterPut?.price})`
    )

    // 8.3 Bulk Stock-Only Edit + Stock-Only ACK must NOT set cmsTargetPrice or clobber Shopee split price (39k vs POS 59k)
    await productLinksPost(
      new NextRequest('http://localhost:3010/api/channels/product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'BULK_CHANNEL_ACTION',
          bulkType: 'BULK_PRICE_OR_STOCK_EDIT',
          productIds: [prodToLink.id],
          priceMode: 'NONE',
          stockMode: 'ADD_DELTA',
          stockValue: 2,
        }),
      })
    )
    const afterBulkStockProd = await db.product.findUnique({ where: { id: prodToLink.id } })
    const afterBulkStockAttrs = JSON.parse(afterBulkStockProd?.attributes || '{}') as Record<string, unknown>
    assert(
      afterBulkStockAttrs.cmsTargetPrice === undefined,
      'S8-BULK-STOCK-NO-FAKE-TARGET-PRICE',
      `Chỉnh tồn hàng loạt (priceMode=NONE) không tự gán cmsTargetPrice bằng giá POS 59k (cmsTargetPrice=${String(afterBulkStockAttrs.cmsTargetPrice)})`
    )
    await callInbound({
      event: 'OUTBOX_ACK_RESULT',
      data: {
        outboxId: `OB_STOCK_ONLY_${ts}`,
        productId: prodToLink.id,
        sku: prodToLink.sku,
        shopeeItemId: `997555${ts}`,
        shopeeModelId: `887555${ts}`,
        syncedStock: 5,
        syncedUnlisted: false,
        status: 'COMPLETED',
        idempotencyKey: `ACK_STOCK_ONLY_${ts}`,
      },
    })
    const linkListingAfterStockAck = await db.channelListing.findUnique({
      where: { productId_channelId: { productId: prodToLink.id, channelId: shopeeCh.id } },
    })
    assert(
      linkListingAfterStockAck?.price === 39000,
      'S8-STOCK-ONLY-ACK-PRESERVES-SHOPEE-PRICE',
      `OUTBOX_ACK_RESULT không có syncedPrice bảo toàn nguyên vẹn giá kênh Shopee 39.000đ (got=${linkListingAfterStockAck?.price})`
    )

    // 8.4 LINK_TO_EXISTING preserves custom POS name across subsequent Shopee Inbound syncs
    const prodPosCustom = await db.product.create({
      data: {
        sku: `SYNTH-SHARED-POSNAME-${ts}`,
        name: 'Đế Trái Tim Trắng POS',
        categoryId: category!.id,
        costPrice: 18000,
        sellPrice: 65000,
        stock: 4,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
      },
    })
    createdProductIds.push(prodPosCustom.id)
    const seoLongTitle = 'Chân Nến Hoa Sen & Hũ Sọc Thạch Cao Đựng Nến Tealight — Phân loại: Trái Tim - Trắng'
    await productLinksPost(
      new NextRequest('http://localhost:3010/api/channels/product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'LINK_TO_EXISTING',
          cmsProductId: prodPosCustom.id,
          shopeeItemId: `997666${ts}`,
          shopeeModelId: `887666${ts}`,
          shopeeSku: prodPosCustom.sku,
          name: seoLongTitle,
          modelName: 'Trái Tim - Trắng',
          sellPrice: 65000,
          stock: 4,
          syncDirection: 'SHOPEE_TO_CMS',
          stockInitMode: 'TAKE_FROM_MARKETPLACE',
          confirmRealPhysicalStock: true,
        }),
      })
    )
    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_POSNAME_KEEP_${ts}`,
        shopeeItemId: `997666${ts}`,
        shopeeModelId: `887666${ts}`,
        sku: prodPosCustom.sku,
        modelSku: prodPosCustom.sku,
        name: seoLongTitle,
        modelName: 'Trái Tim - Trắng',
        sellPrice: 65000,
        stock: 4,
        shopeeModifyTime: Math.floor(ts / 1000) + 300,
      },
    })
    const afterLinkInboundProd = await db.product.findUnique({ where: { id: prodPosCustom.id } })
    assert(
      afterLinkInboundProd?.name === 'Đế Trái Tim Trắng POS',
      'S8-LINK-EXISTING-PRESERVES-CUSTOM-POS-NAME',
      `LINK_TO_EXISTING giữ nguyên tên gọn POS qua chu kỳ đồng bộ Inbound kế tiếp (name=${afterLinkInboundProd?.name})`
    )

    // ------------------------------------------------------------------------
    // SUITE 9: Anti-Auto-Unlist & Shopee Relist Protection Regression Suite
    //   1. Relisting an item on Shopee Seller Center clears stale cmsRequestedUnlisted=true
    //      so subsequent Inbound syncs NEVER resurrect isUnlistedOnShopee=true!
    //   2. Stale isUnlistedOnShopee=true vs lastSyncedShopeeUnlisted=false WITHOUT explicit
    //      operator TOGGLE_UNLIST NEVER spawns an AUTO_OUTBOX job to turn off Shopee items!
    //   3. Explicit operator TOGGLE_CHANNEL_STATUS -> UNLISTED DOES enqueue explicitUnlistIntent=true!
    //   4. Python Daemon physically blocks update_shopee_product_status(..., unlisted=True)
    //      for any AUTO_OUTBOX_* job or job missing explicitUnlistIntent=True!
    // ------------------------------------------------------------------------
    console.log('\n--- SUITE 9: Anti-Auto-Unlist & Shopee Relist Protection ---')
    const prodRelistGuard = await db.product.create({
      data: {
        sku: `TEST-RELIST-${ts}`,
        name: 'SP Đang Bán Trên Shopee Chống Bị Tắt Ngược',
        categoryId: category!.id,
        costPrice: 20000,
        sellPrice: 79000,
        stock: 0,
        status: 'ACTIVE',
        ownerWarehouseId: defaultWh!.id,
        attributes: JSON.stringify({
          shopeeItemId: `998111${ts}`,
          shopeeModelId: `888111${ts}`,
          isUnlistedOnShopee: true,
          lastSyncedShopeeUnlisted: true,
          cmsRequestedUnlisted: true, // Cờ lịch sử cũ từng ẩn trước đây
          lastSyncedShopeeStock: 8,
          liveShopeeStock: 8,
          lastSyncedShopeePrice: 81000,
          openingStockOrigin: 'CMS_WAREHOUSE',
        }),
      },
    })
    createdProductIds.push(prodRelistGuard.id)
    await db.channelListing.create({
      data: { productId: prodRelistGuard.id, channelId: shopeeCh.id, price: 81000, status: 'UNLISTED' },
    })

    // Step 9.1: Seller relists item directly on Shopee Seller Center (isUnlisted: false)
    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_RELIST_STEP1_${ts}`,
        shopeeItemId: `998111${ts}`,
        shopeeModelId: `888111${ts}`,
        sku: prodRelistGuard.sku,
        modelSku: prodRelistGuard.sku,
        name: 'SP Đang Bán Trên Shopee Chống Bị Tắt Ngược',
        sellPrice: 81000,
        stock: 8,
        isUnlisted: false,
        shopeeModifyTime: Math.floor(ts / 1000) + 500,
      },
    })
    // Step 9.2: Seller subsequently edits title on Shopee while item remains live (isUnlisted: false -> !shopeeUnlistedChanged)
    await callInbound({
      event: 'INBOUND_SHOPEE_PRODUCT_SYNC',
      data: {
        idempotencyKey: `IDEM_RELIST_STEP2_${ts}`,
        shopeeItemId: `998111${ts}`,
        shopeeModelId: `888111${ts}`,
        sku: prodRelistGuard.sku,
        modelSku: prodRelistGuard.sku,
        name: 'SP Đang Bán Trên Shopee — Đã Đổi Tiêu Đề Mới',
        sellPrice: 81000,
        stock: 8,
        isUnlisted: false,
        shopeeModifyTime: Math.floor(ts / 1000) + 600,
      },
    })
    const afterRelistAndRename = await db.product.findUnique({
      where: { id: prodRelistGuard.id },
      include: { listings: true },
    })
    const afterRelistAttrs = JSON.parse(afterRelistAndRename?.attributes || '{}') as Record<string, unknown>
    const afterRelistShopeeListing = afterRelistAndRename?.listings.find((l) => l.channelId === shopeeCh.id)
    assert(
      afterRelistAttrs.isUnlistedOnShopee === false &&
        afterRelistAttrs.lastSyncedShopeeUnlisted === false &&
        afterRelistAttrs.cmsRequestedUnlisted === false &&
        afterRelistShopeeListing?.status === 'ACTIVE',
      'S9-RELIST-NOT-REVERTED-BY-STALE-FLAG',
      `Mở bán lại trên Shopee xóa sạch cờ cmsRequestedUnlisted cũ và giữ ACTIVE bền vững qua các lần đồng bộ sau`
    )

    // Step 9.3: Even if DB somehow had corrupted/drifted flags (isUnlistedOnShopee=true, lastSyncedShopeeUnlisted=false) WITHOUT explicit cmsTargetUnlisted, OUTBOX_FETCH_PENDING must emit 0 jobs!
    afterRelistAttrs.isUnlistedOnShopee = true
    afterRelistAttrs.lastSyncedShopeeUnlisted = false
    delete afterRelistAttrs.cmsTargetUnlisted
    afterRelistAttrs.pendingOutboxSync = false
    await db.product.update({
      where: { id: prodRelistGuard.id },
      data: { attributes: JSON.stringify(afterRelistAttrs) },
    })
    const outboxDriftCheck = await callInbound({
      event: 'OUTBOX_FETCH_PENDING',
      data: { onlySyntheticTest: true },
    })
    const driftJobs =
      (outboxDriftCheck.json.jobs as Array<{ productId: string; unlistedDrifted: boolean }>) || []
    assert(
      !driftJobs.some((j) => j.productId === prodRelistGuard.id),
      'S9-NO-AUTO-UNLIST-WITHOUT-OPERATOR-INTENT',
      'OUTBOX_FETCH_PENDING tuyệt đối không tự sinh AUTO_OUTBOX ẩn sản phẩm khi người vận hành không bấm nút Tạm ẩn trên CMS'
    )

    // Step 9.4: Explicit operator click TOGGLE_CHANNEL_STATUS -> UNLISTED DOES enqueue explicitUnlistIntent=true
    await productLinksPost(
      new NextRequest('http://localhost:3010/api/channels/product-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TOGGLE_CHANNEL_STATUS',
          productId: prodRelistGuard.id,
          channelKey: 'SHOPEE',
          nextStatus: 'UNLISTED',
        }),
      })
    )
    await new Promise((r) => setTimeout(r, 120))
    const outboxExplicitUnlist = await callInbound({
      event: 'OUTBOX_FETCH_PENDING',
      data: { onlySyntheticTest: true },
    })
    const explicitUnlistJob = (
      (outboxExplicitUnlist.json.jobs as Array<{
        outboxId: string
        productId: string
        unlistedDrifted: boolean
        explicitUnlistIntent: boolean
        targetUnlisted: boolean
      }>) || []
    ).find((j) => j.productId === prodRelistGuard.id)
    assert(
      Boolean(
        explicitUnlistJob &&
          explicitUnlistJob.unlistedDrifted === true &&
          explicitUnlistJob.explicitUnlistIntent === true &&
          explicitUnlistJob.targetUnlisted === true &&
          !explicitUnlistJob.outboxId.startsWith('AUTO_OUTBOX_')
      ),
      'S9-EXPLICIT-OPERATOR-UNLIST-WORKS',
      'Khi người vận hành chủ động bấm Tạm ẩn trên CMS, Outbox gắn đúng explicitUnlistIntent=true'
    )

    // Step 9.5: Python Daemon hardware fuse blocks AUTO_OUTBOX_* or missing explicitUnlistIntent from calling update_shopee_product_status(..., unlisted=True)
    const pyUnlistGuardOut = execSync('python -B -', {
      input: `
import scripts.shopee_seller_sync as sm
sm.GLOBAL_STATE["alive"] = True
status_calls = []
orig_call = sm.call_cms_webhook
orig_status = sm.update_shopee_product_status
orig_stock = sm.update_shopee_product_stock
orig_load = sm.load_sync_state
orig_save = sm.save_sync_state
def fake_webhook(ev, data, timeout=12):
    if ev == "OUTBOX_FETCH_PENDING":
        return True, {"ok": True, "jobs": [
            {"outboxId": "AUTO_OUTBOX_123", "productId": "p1", "sku": "SYNTH-1", "shopeeItemId": "9991", "shopeeModelId": "1", "targetStock": 8, "targetPrice": 50000, "targetUnlisted": True, "stockDrifted": False, "priceDrifted": False, "unlistedDrifted": True, "explicitUnlistIntent": True},
            {"outboxId": "MANUAL_OB_456", "productId": "p2", "sku": "SYNTH-2", "shopeeItemId": "9992", "shopeeModelId": "1", "targetStock": 8, "targetPrice": 50000, "targetUnlisted": True, "stockDrifted": False, "priceDrifted": False, "unlistedDrifted": True, "explicitUnlistIntent": False},
            {"outboxId": "MANUAL_OB_789", "productId": "p3", "sku": "SYNTH-3", "shopeeItemId": "9993", "shopeeModelId": "1", "targetStock": 8, "targetPrice": 50000, "targetUnlisted": True, "stockDrifted": False, "priceDrifted": False, "unlistedDrifted": True, "explicitUnlistIntent": True},
        ]}
    return True, {"ok": True}
sm.call_cms_webhook = fake_webhook
sm.update_shopee_product_status = lambda c, s, t, item_id=None, unlisted=False: (status_calls.append((str(item_id), bool(unlisted))) or (True, {"code": 0}))
sm.update_shopee_product_stock = lambda *a, **kw: (True, {"code": 0})
sm.load_sync_state = lambda: {"products": {}, "itemMeta": {}}
sm.save_sync_state = lambda st: None
try:
    sm.process_outbound_outbox_from_cms({"SPC_ST": "x"}, "cds", "csrf")
    assert status_calls == [("9993", True)], f"Expected ONLY explicit manual job 9993 to call update_shopee_product_status, got {status_calls}"
    print("PY_UNLIST_HARDWARE_FUSE_OK")
finally:
    sm.call_cms_webhook = orig_call
    sm.update_shopee_product_status = orig_status
    sm.update_shopee_product_stock = orig_stock
    sm.load_sync_state = orig_load
    sm.save_sync_state = orig_save
`,
      encoding: 'utf-8',
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    assert(
      pyUnlistGuardOut.includes('PY_UNLIST_HARDWARE_FUSE_OK'),
      'S9-PYTHON-DAEMON-UNLIST-HARDWARE-FUSE',
      'Python Daemon chặn cứng 100% mọi lệnh tắt sản phẩm Shopee từ AUTO_OUTBOX_* hoặc thiếu explicitUnlistIntent'
    )
  } finally {
    // Allow fire-and-forget lineage/activity writes to settle before clean teardown
    await new Promise((r) => setTimeout(r, 250))
    // Clean up 100% of temporary records created in this verification script
    if (createdOrderIds.length > 0) {
      await db.shipment.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => null)
      await db.salesInvoiceItem
        .deleteMany({ where: { invoice: { orderId: { in: createdOrderIds } } } })
        .catch(() => null)
      await db.salesInvoice.deleteMany({ where: { orderId: { in: createdOrderIds } } }).catch(() => null)
      await db.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } })
      await db.orderEvent.deleteMany({ where: { orderId: { in: createdOrderIds } } })
      await db.ledgerEntry.deleteMany({ where: { entityId: { in: createdOrderIds } } }).catch(() => null)
      await db.agentActivity.deleteMany({ where: { targetId: { in: createdOrderIds } } }).catch(() => null)
      await db.order.deleteMany({ where: { id: { in: createdOrderIds } } })
    }
    if (createdCustomerIds.length > 0) {
      await db.customer.deleteMany({ where: { id: { in: createdCustomerIds } } }).catch(() => null)
    }
    if (createdChannelIds.length > 0) {
      await db.channelListing.deleteMany({ where: { channelId: { in: createdChannelIds } } })
      await db.ledgerEntry.deleteMany({ where: { entityId: { in: createdChannelIds } } })
      await db.channel.deleteMany({ where: { id: { in: createdChannelIds } } })
    }
    if (createdProductIds.length > 0) {
      await db.channelListing.deleteMany({ where: { productId: { in: createdProductIds } } })
      await db.warehouseStock.deleteMany({ where: { productId: { in: createdProductIds } } })
      await db.stockMovement.deleteMany({ where: { productId: { in: createdProductIds } } })
      await db.ledgerEntry.deleteMany({ where: { entityId: { in: createdProductIds } } })
      await db.product.deleteMany({ where: { id: { in: createdProductIds } } })
    }
    if (createdLedgerIds.length > 0) {
      await db.ledgerEntry.deleteMany({ where: { id: { in: createdLedgerIds } } })
    }
    await db.ledgerEntry.deleteMany({
      where: {
        createdAt: { gte: startedAt },
        OR: [
          { entityCode: { startsWith: 'SYNTH-' } },
          { entityCode: { startsWith: 'TEST-RELIST-' } },
          { entityCode: { startsWith: `997888${ts}` } },
          { entityCode: { contains: `261124GIFT` } },
          { title: { contains: 'SYNTH-' } },
          { title: { contains: `261124GIFT` } },
          { title: { contains: String(ts) } },
        ],
      },
    })
    await db.$disconnect()
  }

  console.log(`\n🎉 ALL ${passed} ASSERTIONS PASSED IN verify-shopee-sync-audit-remediation.ts!`)
}

main().catch((err) => {
  console.error('Fatal error in verify-shopee-sync-audit-remediation.ts:', err)
  process.exit(1)
})
