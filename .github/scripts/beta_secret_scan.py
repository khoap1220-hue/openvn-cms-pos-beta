# beta-cicd-template: v1 (managed by free-beta-deploy-mcp)
# -*- coding: utf-8 -*-
"""Zero-Secret Leak gate cho CI: quét mọi file đã track trong Git, KHÔNG in giá trị secret."""
import re
import subprocess
import sys
from pathlib import Path

RULES = [
    ('OPENAI_OR_API_SK_KEY', re.compile('\\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}\\b')),
    ('GOOGLE_GEMINI_API_KEY', re.compile('\\bAIza[0-9A-Za-z_-]{35}\\b')),
    ('GITHUB_PAT_TOKEN', re.compile('\\b(?:gh[pousr]_[A-Za-z0-9]{24,}|github_pat_[A-Za-z0-9_]{30,})\\b')),
    ('AWS_ACCESS_KEY_ID', re.compile('\\bAKIA[0-9A-Z]{16}\\b')),
    ('PRIVATE_KEY_PEM', re.compile('-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----')),
    ('TELEGRAM_BOT_TOKEN', re.compile('\\b\\d{8,11}:[A-Za-z0-9_-]{35}\\b')),
    ('DB_URI_WITH_PASSWORD', re.compile('\\b(?:postgres(?:ql)?|mongodb(?:\\+srv)?|mysql|redis)://[^:\\s\'\\"`]+:[^@\\s\'\\"`]{4,}@')),
    ('RENDER_DEPLOY_HOOK_URL', re.compile('https://api\\.render\\.com/deploy/srv-[A-Za-z0-9]+\\?key=[A-Za-z0-9_-]{6,}')),
    ('SLACK_TOKEN', re.compile('\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b')),
]
SKIP_EXT = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.gz', '.woff', '.woff2', '.ttf', '.mp4', '.mp3', '.db', '.sqlite'}
ENV_FILE_RE = re.compile(r'(^|/)\.env(\.[A-Za-z0-9_-]+)?$')
SELF = Path(__file__).as_posix()

def main() -> int:
    files = subprocess.run(['git', 'ls-files'], capture_output=True, text=True, check=True).stdout.splitlines()
    hits = []
    for rel in files:
        if SELF.endswith(rel):
            continue
        if ENV_FILE_RE.search(rel) and not rel.endswith(('.example', '.sample', '.template')):
            hits.append((rel, 1, 'COMMITTED_ENV_FILE'))
            continue
        p = Path(rel)
        if p.suffix.lower() in SKIP_EXT or not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        text = p.read_text(encoding='utf-8', errors='ignore')
        for name, rx in RULES:
            m = rx.search(text)
            if m:
                hits.append((rel, text.count('\n', 0, m.start()) + 1, name))
    for rel, line, name in hits:
        print(f'::error file={rel},line={line}::Phát hiện secret dạng {name} (giá trị đã ẩn). Hãy chuyển sang GitHub Secrets.')
    print(f'Secret scan: {len(files)} files, {len(hits)} finding(s).')
    return 1 if hits else 0

if __name__ == '__main__':
    sys.exit(main())
