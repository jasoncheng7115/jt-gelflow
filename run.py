#!/usr/bin/env python3
"""Entry point for JT-GELFLOW server."""

import os
import sys
from pathlib import Path

# Add server directory to path
sys.path.insert(0, str(Path(__file__).parent))

DOCS_BASE = "https://jasoncheng7115.github.io/jt-gelflow"


def _help_url(query: str) -> str:
    """Troubleshooting page in the machine's language — mirrors _help_url() in
    bin/jt-gelflow. The systemd unit sets no LANG, so the system-wide locale
    files are what actually decide it for the service."""
    loc = os.environ.get("LC_ALL") or os.environ.get("LC_MESSAGES") or os.environ.get("LANG") or ""
    for f in ("/etc/default/locale", "/etc/locale.conf"):
        if loc:
            break
        try:
            with open(f, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    key, _, val = line.strip().partition("=")
                    if key in ("LANG", "LC_ALL") and val:
                        loc = val.strip('"\'')
                        break
        except OSError:
            continue
    page = "troubleshooting_zh-TW.html" if loc.startswith("zh") else "troubleshooting.html"
    return f"{DOCS_BASE}/{page}?q={query}"


try:
    from server.server import main
except ModuleNotFoundError as e:
    # A missing *third-party* module almost always means the OS moved to a new
    # Python (e.g. Ubuntu 22.04 → 24.04: 3.10 → 3.12) and the packages pip put
    # in /usr/local/lib/python3.10 are invisible to it. Say so, instead of
    # leaving a bare traceback looping in the journal every RestartSec.
    if not e.name or e.name.split(".")[0] == "server":
        raise
    py = f"{sys.version_info.major}.{sys.version_info.minor}"
    print(
        f"JT-GELFLOW cannot start: Python module '{e.name}' is not installed for "
        f"Python {py} ({sys.executable}).\n"
        f"This usually follows an OS upgrade that changed the system Python version "
        f"(e.g. Ubuntu 22.04 -> 24.04); packages installed for the old version are "
        f"not visible to the new one.\n"
        f"Fix:  sudo jt-gelflow update\n"
        f"Help: {_help_url('aiohttp')}",
        file=sys.stderr,
        flush=True,
    )
    sys.exit(1)

if __name__ == "__main__":
    main()
