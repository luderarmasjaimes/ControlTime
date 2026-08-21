"""
Resuelve ADRs por SPEC-ID.

Combina la matriz canónica de ``specs/REGISTRY.md`` con la sección
``Decisiones vigentes complementarias`` del ``spec.md`` correspondiente.
Desde ADR-090, las decisiones históricas de ``specs/adr`` no se usan para
routing ni RAG porque sus números colisionan con el log canónico.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "specs" / "REGISTRY.md"
CURRENT_ADR_DIR = ROOT / "docs" / "decisions"

# ADR transversal que fija la fuente de verdad arquitectónica.
UNIVERSAL_ADRS = ["ADR-090"]


def _parse_adr_tokens(raw: str) -> list[str]:
    """Expande ``029``, ``ADR-029`` y rangos inclusivos ``076-078``."""
    result: list[str] = []
    for first, second in re.findall(
        r"(?:ADR-)?(\d{3})(?:\s*[-–]\s*(?:ADR-)?(\d{3}))?",
        raw,
        re.IGNORECASE,
    ):
        start = int(first)
        end = int(second) if second else start
        if end < start or end - start > 200:
            continue
        result.extend(f"ADR-{number:03d}" for number in range(start, end + 1))
    return result


def _load_spec_adr_map() -> dict[str, list[str]]:
    text = REGISTRY_PATH.read_text(encoding="utf-8")
    mapping: dict[str, list[str]] = {}
    for m in re.finditer(
        r"\|\s*(?:\*\*)?SPEC-(\d{3})(?:\*\*)?\s*\|[^|]+\|\s*([^\|]+)\|",
        text,
    ):
        spec_id = f"SPEC-{m.group(1)}"
        raw = m.group(2)
        adrs = _parse_adr_tokens(raw)
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
        matches = sorted(CURRENT_ADR_DIR.glob(f"{num}-*.md"))
        if matches:
            paths.append(matches[0])
    return paths


def spec_folder(spec_id: str) -> Path | None:
    num = spec_id.replace("SPEC-", "").strip()
    folders = list((ROOT / "specs").glob(f"{num}-*"))
    if not folders:
        return None
    # Los aliases históricos 004/005 carecen del set canónico completo.
    complete = [p for p in folders if (p / "tasks.md").exists()]
    return sorted(complete or folders)[0]


def load_spec_acceptance_criteria(spec_id: str) -> list[str]:
    folder = spec_folder(spec_id)
    if not folder:
        return []
    spec_md = folder / "spec.md"
    if not spec_md.exists():
        return []
    text = spec_md.read_text(encoding="utf-8")
    return re.findall(r"-\s*\[\s*[ xX]?\s*\]\s*\*\*(CA-\d+):\*\*[^\n]+", text)
