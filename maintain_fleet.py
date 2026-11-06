# -*- coding: utf-8 -*-
"""
Workspace delegator for Multi-Project Beta Fleet Maintenance (`maintain_fleet.py`).
Forwards CLI invocation to `E:/MCP SKILL DELOY FREE BETA/maintain_fleet.py`.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

MCP_DIR = Path(r"E:/MCP SKILL DELOY FREE BETA")
if str(MCP_DIR) not in sys.path:
    sys.path.insert(0, str(MCP_DIR))

if __name__ == "__main__":
    target = MCP_DIR / "maintain_fleet.py"
    runpy.run_path(str(target), run_name="__main__")
