#!/usr/bin/env python3
"""ADR-211: falla si db_scripts/*.sql tiene prefijos numericos duplicados
o si el siguiente numero libre no es max+1 (hueco al final permitido solo
para 11 y 14, que nunca existieron)."""
from __future__ import annotations

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "db_scripts"
ALLOWED_GAPS = {11, 14}

def main() -> int:
    by_ver: dict[int, list[str]] = defaultdict(list)
    for p in SCRIPTS.glob("*.sql"):
        m = re.match(r"^(\d+)", p.name)
        if not m:
            continue
        by_ver[int(m.group(1))].append(p.name)

    dups = {k: v for k, v in by_ver.items() if len(v) > 1}
    if dups:
        print("ERROR: prefijos duplicados en db_scripts/ (ADR-211):", file=sys.stderr)
        for k in sorted(dups):
            print(f"  {k}: {', '.join(sorted(dups[k]))}", file=sys.stderr)
        return 1

    if not by_ver:
        print("ERROR: no hay scripts numerados en db_scripts/", file=sys.stderr)
        return 1

    versions = sorted(by_ver)
    expected = set(range(versions[0], versions[-1] + 1)) - ALLOWED_GAPS
    missing = sorted(expected - set(versions))
    if missing:
        print(
            "ERROR: huecos inesperados en la numeracion de db_scripts/: "
            f"{missing} (solo se permiten {sorted(ALLOWED_GAPS)})",
            file=sys.stderr,
        )
        return 1

    print(
        f"OK: {len(versions)} scripts de esquema, max={versions[-1]}, "
        "sin duplicados."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
