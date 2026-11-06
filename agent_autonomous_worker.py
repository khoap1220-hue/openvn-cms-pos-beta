# -*- coding: utf-8 -*-
"""
Standalone Autonomous QA & Self-Healing Agent Worker (`agent_autonomous_worker.py`)
Hoạt động hoàn toàn ĐỘC LẬP 24/7 (không phụ thuộc phiên chat Antigravity):
  1. Tự động tuần tra từng màn hình (`dashboard`, `orders`, `products`, `inventory`, `pos`, `customers`)
  2. Tự động gửi báo cáo & ảnh chụp vào đúng hòm thư quy trình người dùng (`feedback_inbox.json` + `FEEDBACK_LIST.md`)
  3. Tự động chạy cổng `Auto Pre-Review` đối chiếu 3 chiều (Mô tả <-> Ảnh chụp & DOM <-> Source Code)
  4. Tự động áp dụng bản vá CSS an toàn (`Auto-Healed`) vào `src/app/globals.css` & `beta-feedback/agent_auto_heal.css`
  5. Khi có thay đổi hoặc phản hồi mới, tự động đóng gói & xuất bản lên GitHub Pages 24/7 (`--auto-deploy`).

Cách chạy độc lập:
  python agent_autonomous_worker.py                 # Chạy daemon độc lập 24/7 (mỗi 45 giây kiểm tra 1 chu kỳ)
  python agent_autonomous_worker.py --once          # Chạy 1 chu kỳ đầy đủ (6 màn hình) rồi dừng
  python agent_autonomous_worker.py --auto-deploy   # Tự động đẩy bản vá lên GitHub Pages 24/7 khi có mục mới được sửa
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
        "live_url": "https://khoap1220-hue.github.io/openvn-cms-pos-beta/",
        "feedback_topic": "openvn_fb_openvn_cms_pos_beta_v1",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Standalone Autonomous Screen Review & Self-Healing Agent")
    parser.add_argument("--once", action="store_true", help="Run a single full patrol & self-healing cycle and exit")
    parser.add_argument("--interval", type=int, default=45, help="Patrol interval in seconds (default: 45s)")
    args = parser.parse_args()

    cfg = load_config()
    mcp_dir = Path(cfg.get("mcp_engine_dir") or r"E:/MCP SKILL DELOY FREE BETA")
    if str(mcp_dir) not in sys.path:
        sys.path.insert(0, str(mcp_dir))

    from core.agent_auto_reviewer import run_independent_agent_daemon_loop

    dep_id = f"beta-{cfg.get('project_name', 'openvn-cms-pos-beta')}-auto"
    live_url = str(cfg.get("live_url") or "https://khoap1220-hue.github.io/openvn-cms-pos-beta/")
    topic = str(cfg.get("feedback_topic") or "openvn_fb_openvn_cms_pos_beta_v1")

    run_independent_agent_daemon_loop(
        str(PROJECT_ROOT),
        deployment_id=dep_id,
        live_base_url=live_url,
        feedback_topic=topic,
        interval_sec=args.interval,
        max_cycles=1 if args.once else 0,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
