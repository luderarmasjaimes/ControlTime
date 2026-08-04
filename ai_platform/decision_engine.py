"""
Motor de decisión pre-código (Paso 8 metodología).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

from ai_platform.registry_parser import adrs_for_spec, load_spec_acceptance_criteria, spec_folder
from ai_platform.router import route

ROOT = Path(__file__).resolve().parents[1]
CONSTITUTION = ROOT / "specs" / "CONSTITUTION.md"


@dataclass
class DecisionReport:
    spec_id: str | None
    language: str | None
    framework: str | None
    architecture: str
    adrs: list[str]
    acceptance_criteria: list[str]
    agent_id: str
    model: str
    constitution_articles: list[str] = field(default_factory=list)
    ready: bool = False
    blockers: list[str] = field(default_factory=list)

    def to_markdown(self) -> str:
        lines = [
            "# Motor de Decisión — Beemetry",
            "",
            f"| Campo | Valor |",
            f"|-------|-------|",
            f"| SPEC | {self.spec_id or '⚠ no detectado'} |",
            f"| Lenguaje | {self.language or '—'} |",
            f"| Framework | {self.framework or '—'} |",
            f"| Arquitectura | {self.architecture} |",
            f"| Agente | `{self.agent_id}` |",
            f"| Modelo | `{self.model}` |",
            f"| Listo para codificar | **{'Sí' if self.ready else 'No'}** |",
            "",
            "## ADRs aplicables",
            ", ".join(self.adrs) if self.adrs else "—",
            "",
            "## Criterios de aceptación",
        ]
        for ca in self.acceptance_criteria:
            lines.append(f"- {ca}")
        if self.constitution_articles:
            lines.extend(["", "## Constitución", ", ".join(self.constitution_articles)])
        if self.blockers:
            lines.extend(["", "## Bloqueadores"])
            for b in self.blockers:
                lines.append(f"- {b}")
        return "\n".join(lines)


def _detect_stack(files: list[str]) -> tuple[str | None, str | None]:
    for f in files:
        fp = f.replace("\\", "/").lower()
        if fp.startswith("backend/") or fp.endswith((".cpp", ".hpp")):
            return "C++17", "Boost.Asio / OpenCV / libpq"
        if fp.startswith("frontend/") or fp.endswith((".jsx", ".tsx")):
            return "TypeScript/JavaScript", "React 18 + Vite"
        if "db_scripts" in fp or fp.endswith(".sql"):
            return "SQL", "PostgreSQL 15 / TimescaleDB"
        if fp.startswith("ai_engine/"):
            return "Python", "Flask + ONNX + InsightFace"
    return None, None


def _constitution_from_spec(spec_id: str) -> list[str]:
    folder = spec_folder(spec_id)
    if not folder:
        return []
    text = (folder / "spec.md").read_text(encoding="utf-8", errors="ignore")
    return re.findall(r"Art\.\s*(\d+)", text)


def evaluate(description: str, files: list[str] | None = None) -> DecisionReport:
    files = files or []
    rr = route(description, files)
    spec_id = rr.spec_hint
    if not spec_id:
        import re as _re
        m = _re.search(r"SPEC[-\s]?(\d{3})", description, _re.I)
        if m:
            spec_id = f"SPEC-{m.group(1)}"

    adrs = adrs_for_spec(spec_id) if spec_id else []

    lang, fw = _detect_stack(files)
    if not lang and rr.agent_id == "backend_dev":
        lang, fw = "C++17", "Boost.Asio / OpenCV"
    elif not lang and rr.agent_id == "frontend_dev":
        lang, fw = "TypeScript", "React 18 + Vite"
    elif not lang and rr.agent_id == "dba":
        lang, fw = "SQL", "PostgreSQL / TimescaleDB"

    cas = load_spec_acceptance_criteria(spec_id) if spec_id else []
    articles = _constitution_from_spec(spec_id) if spec_id else []

    blockers: list[str] = []
    if not spec_id:
        blockers.append("Falta SPEC-ID en la solicitud (ej. SPEC-014)")
    if spec_id and not spec_folder(spec_id):
        blockers.append(f"Carpeta spec no encontrada para {spec_id}")
    if spec_id and not cas:
        blockers.append(f"Sin criterios de aceptación en spec de {spec_id}")

    return DecisionReport(
        spec_id=spec_id,
        language=lang,
        framework=fw,
        architecture="Microservicios + gateway C++ (ADR-001)",
        adrs=adrs,
        acceptance_criteria=cas,
        agent_id=rr.agent_id,
        model=rr.model,
        constitution_articles=[f"Art. {a}" for a in articles],
        ready=len(blockers) == 0,
        blockers=blockers,
    )
