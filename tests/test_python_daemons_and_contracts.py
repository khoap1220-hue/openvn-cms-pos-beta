# -*- coding: utf-8 -*-
"""
Read-only contract & AST integrity tests for OPENVN Python daemons and deployment tooling.
Compatible with `python -B -m pytest -p no:cacheprovider` (0 network calls, 0 DB writes).
"""
from __future__ import annotations

import ast
import base64
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "scripts") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

import deploy_beta  # noqa: E402
import shopee_seller_sync  # noqa: E402

PYTHON_MODULES = (
    "deploy_beta.py",
    "maintain_fleet.py",
    "agent_autonomous_worker.py",
    "ui_ux_agent_worker.py",
    "scripts/shopee_seller_sync.py",
    "scripts/extract_shopee_cdp.py",
    ".github/scripts/beta_secret_scan.py",
)


def test_all_workspace_python_modules_parse_cleanly() -> None:
    for rel_path in PYTHON_MODULES:
        full_path = PROJECT_ROOT / rel_path
        assert full_path.is_file(), f"Missing expected Python module: {rel_path}"
        source = full_path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=rel_path)
        assert isinstance(tree, ast.Module)


def test_shopee_bridge_handler_srp_and_helper_decomposition() -> None:
    sync_path = PROJECT_ROOT / "scripts/shopee_seller_sync.py"
    tree = ast.parse(sync_path.read_text(encoding="utf-8"), filename="scripts/shopee_seller_sync.py")
    handler_cls = next(
        (node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "LocalBridgeHandler"),
        None,
    )
    assert handler_cls is not None, "LocalBridgeHandler must exist in scripts/shopee_seller_sync.py"

    methods = {
        node.name: (node.end_lineno or node.lineno) - node.lineno + 1
        for node in handler_cls.body
        if isinstance(node, ast.FunctionDef)
    }
    assert "_handle_post_session" in methods
    assert "_handle_post_upload_image" in methods
    assert "do_POST" in methods
    assert methods["do_POST"] <= 300, f"do_POST too long ({methods['do_POST']} lines > 300)"


def test_shopee_dry_run_and_inbound_stock_guards(monkeypatch) -> None:
    monkeypatch.setenv("SHOPEE_OUTBOX_DRY_RUN", "1")
    assert shopee_seller_sync.is_outbox_dry_run() is True
    assert shopee_seller_sync.is_inbound_product_sync_disabled() is True

    monkeypatch.setenv("SHOPEE_OUTBOX_DRY_RUN", "0")
    monkeypatch.setenv("SHOPEE_INBOUND_DISABLE", "0")
    monkeypatch.setenv("SHOPEE_INBOUND_DISABLE_STOCK_OVERWRITE", "1")
    assert shopee_seller_sync.is_inbound_product_sync_disabled() is True


def test_shopee_decode_image_data_url_contract() -> None:
    tiny_png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
        b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
        b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    data_url = "data:image/png;base64," + base64.b64encode(tiny_png).decode("ascii")
    raw_bytes, mime_type, err = shopee_seller_sync.decode_image_source_to_bytes(data_url)
    assert err is None
    assert mime_type == "image/png"
    assert raw_bytes == tiny_png


def test_deploy_beta_config_and_stage_cleanup_contract() -> None:
    cfg = deploy_beta.load_config()
    assert isinstance(cfg, dict)
    assert cfg.get("project_name")
    deploy_src = (PROJECT_ROOT / "deploy_beta.py").read_text(encoding="utf-8")
    assert ".beta_stage" in deploy_src
