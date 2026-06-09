#!/usr/bin/env python3
"""
Read stream URL from a temp file (first line), grab one frame with ffmpeg, write JPEG.
Invoked server-side only — avoids browser CORS when exporting HLS frames to canvas.
"""
from __future__ import annotations

import pathlib
import subprocess
import sys


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(99)
    url_path = pathlib.Path(sys.argv[1])
    out_path = pathlib.Path(sys.argv[2])
    raw = url_path.read_text(encoding="utf-8", errors="strict")
    url = raw.strip()
    if not url or len(url) > 8192:
        sys.exit(2)
    lower = url.lower()
    if not (lower.startswith("http://") or lower.startswith("https://")):
        sys.exit(2)

    # skip 3s (-ss 3) to skip black headers, capture 1 frame (-frames:v 1).
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-rw_timeout",
        "25000000",
        "-user_agent",
        "InformeCliente-snapshot/1.0",
        "-ss",
        "1",
        "-i",
        url,
        "-frames:v",
        "1",
        "-q:v",
        "4",
        str(out_path),
    ]
    try:
        subprocess.run(cmd, check=True, timeout=120)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        sys.exit(1)
    if not out_path.is_file() or out_path.stat().st_size < 64:
        sys.exit(1)


if __name__ == "__main__":
    main()
