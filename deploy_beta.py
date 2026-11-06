# -*- coding: utf-8 -*-
"""
Auto-Generated Standalone Deploy & Feedback Sync Script for `openvn-cms-pos-beta`
Usage:
  python deploy_beta.py                 # Deploy latest build + SQLite snapshot to GitHub Pages 24/7 & sync feedback
  python deploy_beta.py --sync-feedback # Pull latest Beta feedbacks & screenshots into ./beta-feedback/
  python deploy_beta.py --watch         # Run continuous 2-Way Cloud <-> Local SQLite & Feedback Sync Daemon
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
CONFIG_FILE = PROJECT_ROOT / 'beta-deploy.config.json'

def load_config() -> dict:
    if CONFIG_FILE.is_file():
        return json.loads(CONFIG_FILE.read_text(encoding='utf-8', errors='replace'))
    return {'project_name': 'openvn-cms-pos-beta', 'mcp_engine_dir': r'E:/MCP SKILL DELOY FREE BETA', 'local_port': 3010}

def sync_cloud_feedback(cfg: dict, reg) -> int:
    topic = cfg.get('feedback_topic') or 'openvn_feedback_v1'
    url = f'https://ntfy.envs.net/{topic}/json?poll=1&since=all'
    dep_id = f"beta-{cfg.get('project_name', 'app')}-auto"
    reg.register_deployment(
        deployment_id=dep_id,
        project_name=cfg.get('project_name', PROJECT_ROOT.name),
        project_path=str(PROJECT_ROOT),
        tier='tier2_static_cdn',
        provider=cfg.get('target_provider', 'github_pages'),
        live_url=cfg.get('live_url', ''),
        status='active',
    )
    existing_msgs = {str(f.get('message', '')).strip() for f in reg.list_feedback(limit=500)}
    existing_uids = set()
    local_inbox = PROJECT_ROOT / 'beta-feedback' / 'feedback_inbox.json'
    if local_inbox.is_file():
        try:
            for _it in json.loads(local_inbox.read_text(encoding='utf-8', errors='replace')):
                if _it.get('message'): existing_msgs.add(str(_it['message']).strip())
                if _it.get('client_uid'): existing_uids.add(str(_it['client_uid']).strip())
        except Exception:
            pass
    added = 0
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=8) as resp:
            lines = resp.read().decode('utf-8', errors='replace').splitlines()
        for ln in lines:
            if not ln.strip():
                continue
            try:
                evt = json.loads(ln)
                if evt.get('event') == 'message':
                    fobj = None
                    att = evt.get('attachment')
                    if isinstance(att, dict) and att.get('url'):
                        try:
                            with urllib.request.urlopen(urllib.request.Request(str(att['url']), headers={'User-Agent': 'Mozilla/5.0'}), timeout=8) as ar:
                                fobj = json.loads(ar.read().decode('utf-8', errors='replace'))
                        except Exception:
                            fobj = None
                    if not isinstance(fobj, dict) and isinstance(evt.get('message'), str) and evt['message'].strip().startswith('{'):
                        fobj = json.loads(evt['message'])
                    if not isinstance(fobj, dict):
                        continue
                    msg = str(fobj.get('message') or '').strip()
                    cuid = str(fobj.get('client_uid') or '').strip()
                    act = str(fobj.get('action') or 'create').strip()
                    if msg and (act == 'update' or (msg not in existing_msgs and (not cuid or cuid not in existing_uids))):
                        existing_msgs.add(msg)
                        if cuid: existing_uids.add(cuid)
                        reg.add_feedback(
                            deployment_id=dep_id,
                            project_name=cfg.get('project_name', PROJECT_ROOT.name),
                            category=str(fobj.get('category') or 'bug'),
                            message=msg,
                            page_url=str(fobj.get('page_url') or ''),
                            viewport=str(fobj.get('viewport') or ''),
                            screenshot_data_url=str(fobj.get('screenshot_data_url') or ''),
                            ai_analysis=fobj.get('ai_analysis') if isinstance(fobj.get('ai_analysis'), dict) else None,
                            client_uid=str(fobj.get('client_uid') or ''),
                            triage_mode=str(fobj.get('triage_mode') or 'advisory'),
                            action=act,
                            target_id=int(fobj.get('target_id') or 0),
                            forward_telegram=False,
                        )
                        added += 1
            except Exception:
                continue
    except Exception as exc:
        print(f'[Feedback Sync Warning] {exc}')
    return added

def main() -> int:
    parser = argparse.ArgumentParser(description='Standalone Project Beta Deployer & Feedback Sync')
    parser.add_argument('--sync-feedback', action='store_true', help='Only pull latest Beta feedbacks into ./beta-feedback/')
    parser.add_argument('--watch', action='store_true', help='Start 2-way Cloud <-> Local SQLite & Feedback daemon')
    parser.add_argument('--dry-run', action='store_true', help='Stage build without pushing to GitHub Pages')
    args = parser.parse_args()

    cfg = load_config()
    mcp_dir = Path(cfg.get('mcp_engine_dir') or r'E:/MCP SKILL DELOY FREE BETA')
    if str(mcp_dir) not in sys.path:
        sys.path.insert(0, str(mcp_dir))

    from core.registry import BetaRegistry
    from core.agent_auto_reviewer import apply_safe_self_healing_fixes
    from providers.git_vercel_render import deploy_github_pages

    reg = BetaRegistry()
    new_fb = sync_cloud_feedback(cfg, reg)
    heal_res = apply_safe_self_healing_fixes(str(PROJECT_ROOT))
    print(f"[1/3] Dong bo phan hoi Beta (Moi: {new_fb}) + Nghiem thu Truoc/Sau & Ky Hop Dong So 6-Agent (Da ky: {heal_res.get('healed_count', 0)})")
    if args.sync_feedback:
        return 0

    if args.watch:
        daemon_py = mcp_dir / 'providers' / 'local_gate_daemon.py'
        port = int(cfg.get('local_port') or 3010)
        print(f'[Watch] Dang chay cau noi Dong bo 2 chieu Cloud <-> Local SQLite (port {port})...')
        return subprocess.call([
            sys.executable, '-u', str(daemon_py),
            '--deployment-id', f"beta-{cfg.get('project_name', 'app')}-watch",
            '--project-name', str(cfg.get('project_name', PROJECT_ROOT.name)),
            '--db-path', str(reg.db_path),
            '--listen-port', '51897',
            '--upstream-port', str(port),
            '--cookie-secret', 'project_auto_sync',
        ])

    print('[2/3] Dang dong goi du an + Snapshot SQLite va day len GitHub Pages 24/7...')
    res = deploy_github_pages(
        project_path=str(PROJECT_ROOT),
        repo_full_name=cfg.get('repo_full_name') or None,
        dry_run=args.dry_run,
        registry=reg,
    )
    if not res.get('ok'):
        print('[ERROR] Deploy that bai:', json.dumps(res, ensure_ascii=False, indent=2))
        return 1
    print('[3/3] HOAN TAT DEPLOY 24/7!')
    print('  -> Live URL      :', res.get('live_url') or cfg.get('live_url'))
    print('  -> Feedback List :', PROJECT_ROOT / 'beta-feedback' / 'FEEDBACK_LIST.md')
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
