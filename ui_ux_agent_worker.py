# -*- coding: utf-8 -*-
"""
Standalone Independent UI/UX Pro Max & M.A.T.R.I.X Design Agent (`ui_ux_agent_worker.py`)
=========================================================================================
Hoạt động ĐỘC LẬP 24/7 tại dự án (không phụ thuộc phiên chat):
  1. Tự động truy vấn cơ sở dữ liệu `ui-ux-pro-max` (84 Styles, 192 Palettes, 98 UX Rules) & duy trì `design-system/.../MASTER.md`.
  2. Tự động kiểm toán 15 phân hệ màn hình theo 10 Danh mục Ưu tiên (Accessibility WCAG 2.2, Touch, CLS, Style, Responsive 390px..2560px, Typography, Motion, Forms, Navigation, Data Tables) & 6 Cổng `G0..G5` của `matrix-thiet-ke-giao-dien-uxui`.
  3. Nghiệm thu Trước khi sửa (`Pre-Fix SHA-256 Baseline`) -> Áp dụng tinh chỉnh Token UI/UX an toàn (`ui_ux_agent_tokens.css` & `src/app/globals.css`) -> Nghiệm thu Sau khi sửa (`Post-Fix Verification`).
  4. Ký Hợp Đồng Số Chịu Trách Nhiệm Độc Lập (`CONTRACT-UIUX-PRO-...`, `HMAC-SHA256`) và xuất báo cáo `beta-feedback/UI_UX_AGENT_AUDIT_REPORT.md`.

Cách chạy độc lập:
  python ui_ux_agent_worker.py                 # Chạy daemon UI/UX độc lập 24/7 (mỗi 60 giây)
  python ui_ux_agent_worker.py --once          # Chạy 1 chu kỳ kiểm toán & tinh chỉnh toàn bộ 15 phân hệ rồi dừng
  python ui_ux_agent_worker.py --view bom      # Kiểm toán & tinh chỉnh chuyên sâu cho 1 màn hình cụ thể
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_FILE = PROJECT_ROOT / "beta-deploy.config.json"


def load_config() -> dict:
    if CONFIG_FILE.is_file():
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8", errors="replace"))
    return {
        "project_name": "openvn-cms-pos-beta",
        "mcp_engine_dir": r"E:/MCP SKILL DELOY FREE BETA",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Standalone Independent UI/UX Pro Max Agent Worker")
    parser.add_argument("--once", action="store_true", help="Run a single full UI/UX audit & polish cycle and exit")
    parser.add_argument("--view", type=str, default="", help="Optional specific screen view key (e.g., inventory, bom, pos)")
    parser.add_argument("--interval", type=int, default=60, help="Daemon loop interval in seconds (default: 60s)")
    args = parser.parse_args()

    cfg = load_config()
    mcp_dir = Path(cfg.get("mcp_engine_dir") or r"E:/MCP SKILL DELOY FREE BETA")
    if str(mcp_dir) not in sys.path:
        sys.path.insert(0, str(mcp_dir))

    from core.ui_ux_autonomous_agent import (
        run_independent_ui_ux_agent_cycle,
        run_independent_ui_ux_daemon_loop,
    )

    if args.once or args.view:
        res = run_independent_ui_ux_agent_cycle(
            str(PROJECT_ROOT),
            target_view=args.view.strip() or None,
        )
        ag = res.get("agent") or {}
        print(
            json.dumps(
                {
                    "ok": res.get("ok"),
                    "agent_id": ag.get("agent_id"),
                    "contract_id": ag.get("contract_id"),
                    "signature": ag.get("digital_signature_hmac_sha256"),
                    "screens_audited": len(res.get("screen_audits", [])),
                    "report_path": str(PROJECT_ROOT / "beta-feedback" / "UI_UX_AGENT_AUDIT_REPORT.md"),
                },
                ensure_ascii=False,
            )
        )
        return 0

    run_independent_ui_ux_daemon_loop(
        str(PROJECT_ROOT),
        interval_sec=args.interval,
        max_cycles=0,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
