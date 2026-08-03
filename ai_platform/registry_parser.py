"""
Resuelve ADRs por SPEC-ID.

Combina la matriz histórica de ``specs/REGISTRY.md`` con la sección
``Decisiones vigentes complementarias`` del ``spec.md`` correspondiente. La
separación evita renumerar los ADR históricos y, a la vez, impide que el
Router/RAG ignoren decisiones actuales de ``docs/decisions``.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "specs" / "REGISTRY.md"
ADR_DIR = ROOT / "specs" / "adr"
CURRENT_ADR_DIR = ROOT / "docs" / "decisions"

# ADRs transversales (todos los SPECs)
UNIVERSAL_ADRS = ["ADR-007", "ADR-009", "ADR-010", "ADR-011", "ADR-012"]


def _load_spec_adr_map() -> dict[str, list[str]]:
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    mapping: dict[str, list[str]] = {}
    for m in re.finditer(
        r"\|\s*(?:\*\*)?SPEC-(\d{3})(?:\*\*)?\s*\|[^|]+\|\s*([^\|]+)\|",
        text,
    ):
        spec_id = f"SPEC-{m.group(1)}"
        raw = m.group(2)
        adrs: list[str] = []
        for part in re.split(r",\s*", raw):
            part = part.strip()
            if re.match(r"ADR-\d{3}", part, re.I):
                adrs.append(part.upper().replace(" ", ""))
            elif re.match(r"\d{3}", part):
                adrs.append(f"ADR-{part}")
            elif re.match(r"\d{1,2}$", part):
                adrs.append(f"ADR-{part.zfill(3)}")
        mapping[spec_id] = sorted(set(adrs + UNIVERSAL_ADRS))
    return mapping


def adrs_for_spec(spec_id: str | None) -> list[str]:
    if not spec_id:
        return list(UNIVERSAL_ADRS)
    m = re.search(r"(\d{3})", spec_id)
    key = f"SPEC-{m.group(1)}" if m else spec_id.upper()
    historical = _load_spec_adr_map().get(key, list(UNIVERSAL_ADRS))
    folder = spec_folder(key)
    if not folder:
        return historical
    spec_md = folder / "spec.md"
    if not spec_md.exists():
        return historical
    text = spec_md.read_text(encoding="utf-8")
    section = re.search(
        r"^## Decisiones vigentes complementarias\s*$"
        r"(.*?)(?=^##\s|\Z)",
        text,
        re.MULTILINE | re.DOTALL,
    )
    current: list[str] = []
    if section:
        for first, second in re.findall(
            r"ADR-(\d{3})(?:/(\d{3}))?",
            section.group(1),
            re.IGNORECASE,
        ):
            current.append(f"ADR-{first}")
            if second:
                current.append(f"ADR-{second}")
    return sorted(set(historical + current))


def adr_file_paths(spec_id: str | None = None, adr_ids: list[str] | None = None) -> list[Path]:
    ids = adr_ids or adrs_for_spec(spec_id)
    paths: list[Path] = []
    for adr_id in ids:
        num = adr_id.replace("ADR-", "").split("-")[0]
        matches = sorted(ADR_DIR.glob(f"ADR-{num}-*.md"))
        if not matches:
            matches = sorted(CURRENT_ADR_DIR.glob(f"{num}-*.md"))
        if matches:
            paths.append(matches[0])
    return paths


def spec_folder(spec_id: str) -> Path | None:
    num = spec_id.replace("SPEC-", "").strip()
    folders = list((ROOT / "specs").glob(f"{num}-*"))
    return folders[0] if folders else None


def load_spec_acceptance_criteria(spec_id: str) -> list[str]:
    folder = spec_folder(spec_id)
    if not folder:
        return []
    spec_md = folder / "spec.md"
    if not spec_md.exists():
        return []
    text = spec_md.read_text(encoding="utf-8")
    return re.findall(r"-\s*\[\s*[ xX]?\s*\]\s*\*\*(CA-\d+):\*\*[^\n]+", text)
