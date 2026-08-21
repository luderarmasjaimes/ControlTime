#!/usr/bin/env python3
"""Sincroniza ADRs canónicos en cada specs/NNN-*/spec.md (ADR-090)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = "## ADRs globales aplicables"
REGISTRY = ROOT / "specs" / "REGISTRY.md"
ALIASES = {
    "004-replica-alta-disponibilidad",
    "005-push-tiempo-real-sse",
}

import sys
sys.path.insert(0, str(ROOT))
from ai_platform.registry_parser import adrs_for_spec  # noqa: E402


def spec_id_from_folder(name: str) -> str | None:
    m = re.match(r"^(\d{3})-", name)
    return f"SPEC-{m.group(1)}" if m else None


def build_section(spec_id: str) -> str:
    adrs = adrs_for_spec(spec_id)
    lines = [
        MARKER,
        "",
        f"> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **{spec_id}**; fuente ADR: `docs/decisions/`.",
        "",
    ]
    for adr in adrs:
        num = adr.replace("ADR-", "")
        matches = sorted((ROOT / "docs" / "decisions").glob(f"{num}-*.md"))
        link = matches[0].name if matches else "README.md"
        lines.append(f"- **{adr}** — [`{link}`](../../docs/decisions/{link})")
    lines.append("")
    return "\n".join(lines)


def patch_spec(path: Path, spec_id: str) -> bool:
    text = path.read_text(encoding="utf-8")
    section = build_section(spec_id)
    if MARKER in text:
        text = re.sub(
            rf"{re.escape(MARKER)}.*?(?=\n## |\Z)",
            section + "\n",
            text,
            count=1,
            flags=re.S,
        )
    else:
        # Insert after first table block (after line with | **Constitución** or similar)
        insert_at = text.find("\n## 1.")
        if insert_at == -1:
            insert_at = text.find("\n## ")
        if insert_at == -1:
            text = section + "\n" + text
        else:
            text = text[:insert_at] + "\n" + section + text[insert_at:]
    path.write_text(text, encoding="utf-8")
    return True


def main() -> None:
    count = 0
    for folder in sorted((ROOT / "specs").glob("[0-9][0-9][0-9]-*")):
        if folder.name in ALIASES:
            continue
        spec_md = folder / "spec.md"
        if not spec_md.exists():
            continue
        spec_id = spec_id_from_folder(folder.name)
        if spec_id:
            patch_spec(spec_md, spec_id)
            count += 1
            print(f"OK {spec_id} -> {spec_md.relative_to(ROOT)}")
    print(f"Patched {count} specs")


if __name__ == "__main__":
    main()
