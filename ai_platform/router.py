"""
Router IA — enruta tareas al agente y modelo correcto (ADR-010).
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from ai_platform.registry_parser import adrs_for_spec

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "agents" / "registry.yaml"
MODELS_PATH = Path(__file__).parent / "config" / "models.yaml"


@dataclass
class RouteResult:
    agent_id: str
    agent_name: str
    model: str
    fallback: str | None
    prompt_path: str | None
    matched_by: str
    paths: list[str] = field(default_factory=list)
    adrs: list[str] = field(default_factory=list)
    spec_hint: str | None = None


def _load_registry() -> dict[str, Any]:
    with open(REGISTRY_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def _load_models() -> dict[str, Any]:
    with open(MODELS_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)


def classify_task(text: str, files: list[str] | None = None) -> str:
    """Clasifica tipo de tarea por texto y archivos."""
    t = text.lower()
    files = files or []

    if any(k in t for k in ("revisar", "review", "pr ", "pull request")):
        return "review"
    if any(k in t for k in ("arquitectura", "adr", "decisión", "microservicio")):
        return "architecture"
    if any(k in t for k in ("spec", "requerimiento", "criterio de aceptación")):
        return "spec"
    if any(k in t for k in ("test", "qa", "uat", "regresión")):
        return "qa"
    if any(k in t for k in ("docker", "ci/cd", "deploy", "workflow")):
        return "devops"
    if any(k in t for k in ("document", "manual", "readme")):
        return "documentation"

    for f in files:
        fp = f.replace("\\", "/").lower()
        if fp.startswith("backend/") or fp.endswith((".cpp", ".hpp")):
            return "backend"
        if fp.startswith("frontend/") or fp.endswith((".jsx", ".tsx")):
            return "frontend"
        if "db_scripts" in fp or fp.endswith(".sql"):
            return "sql"
        if fp.startswith("ai_engine/"):
            return "ai"
        if fp.startswith("docs/") or fp.startswith("specs/"):
            return "documentation"

    if any(k in t for k in ("sql", "postgres", "timescale", "etl", "migración")):
        return "sql"
    if any(k in t for k in ("react", "frontend", "ui", "ux", "reportstudio")):
        return "frontend"
    if any(k in t for k in ("c++", "boost", "opencv", "websocket", "api")):
        return "backend"
    if any(k in t for k in ("onnx", "embedding", "rag", "modelo")):
        return "ai"

    return "general"


def extract_spec_id(text: str) -> str | None:
    m = re.search(r"SPEC[-\s]?(\d{3})", text, re.I)
    return f"SPEC-{m.group(1)}" if m else None


def infer_spec_id(text: str, files: list[str] | None = None) -> str | None:
    """Infere SPEC operativo cuando la solicitud no lo declara."""
    explicit = extract_spec_id(text)
    if explicit:
        return explicit
    t = text.lower()
    normalized_files = [f.replace("\\", "/").lower() for f in files or []]
    if any("/auth/" in f or f.startswith("backend/src/auth") or f.startswith("frontend/src/auth") for f in normalized_files):
        return "SPEC-006"
    if any(k in t for k in ("auth", "login", "rbac", "tenant", "empresa", "company", "usuario")):
        return "SPEC-006"
    if any(k in t for k in ("biometr", "facial", "rostro", "avatar")):
        return "SPEC-008"
    return None


def route(text: str, files: list[str] | None = None) -> RouteResult:
    """Enruta solicitud a agente + modelo."""
    reg = _load_registry()
    models_cfg = _load_models()
    task_type = classify_task(text, files)
    spec_hint = infer_spec_id(text, files)

    # 1) Reglas por path en registry
    if files:
        for rule in reg.get("routing_rules", []):
            match = rule.get("match", {})
            prefix = match.get("path_prefix")
            if prefix and any(f.replace("\\", "/").startswith(prefix) for f in files):
                agent_id = rule["agent"]
                agent = reg["agents"][agent_id]
                agent_adrs = [f"ADR-{a}" if isinstance(a, int) else a for a in agent.get("adrs", [])]
                registry_adrs = adrs_for_spec(spec_hint) if spec_hint else []
                merged_adrs = sorted(set(agent_adrs + registry_adrs))
                return RouteResult(
                    agent_id=agent_id,
                    agent_name=agent["name"],
                    model=agent.get("model", models_cfg["defaults"]["planning"]),
                    fallback=agent.get("fallback"),
                    prompt_path=agent.get("prompt"),
                    matched_by=f"path_prefix:{prefix}",
                    paths=agent.get("paths", []),
                    adrs=merged_adrs,
                    spec_hint=spec_hint,
                )

    # 2) Reglas por task_type
    type_to_agent = {
        "review": "code_reviewer",
        "architecture": "architect",
        "spec": "functional_analyst",
        "qa": "qa",
        "devops": "devops",
        "documentation": "documenter",
        "backend": "backend_dev",
        "frontend": "frontend_dev",
        "sql": "dba",
        "ai": "ai_specialist",
    }
    agent_id = type_to_agent.get(task_type, "planner")
    agent = reg["agents"][agent_id]

    agent_adrs = [f"ADR-{a}" if isinstance(a, int) else a for a in agent.get("adrs", [])]
    registry_adrs = adrs_for_spec(spec_hint) if spec_hint else []
    merged_adrs = sorted(set(agent_adrs + registry_adrs))

    return RouteResult(
        agent_id=agent_id,
        agent_name=agent["name"],
        model=agent.get("model", models_cfg["defaults"]["planning"]),
        fallback=agent.get("fallback"),
        prompt_path=agent.get("prompt"),
        matched_by=f"task_type:{task_type}",
        paths=agent.get("paths", []),
        adrs=merged_adrs,
        spec_hint=spec_hint,
    )


def format_route_report(result: RouteResult, text: str) -> str:
    lines = [
        "# AI Router — Beemetry",
        "",
        f"**Solicitud:** {text[:200]}{'...' if len(text) > 200 else ''}",
        "",
        f"| Campo | Valor |",
        f"|-------|-------|",
        f"| Agente | `{result.agent_id}` — {result.agent_name} |",
        f"| Modelo | `{result.model}` |",
        f"| Fallback | `{result.fallback or '—'}` |",
        f"| Match | {result.matched_by} |",
        f"| Prompt | `{result.prompt_path or '—'}` |",
    ]
    if result.spec_hint:
        lines.append(f"| SPEC | {result.spec_hint} |")
    if result.adrs:
        lines.append(f"| ADRs | {', '.join(result.adrs)} |")
    lines.extend([
        "",
        "## Contexto a cargar",
        "1. `specs/CONSTITUTION.md`",
        "2. `specs/REGISTRY.md` + `spec.md` + ADRs canónicos en `docs/decisions/`",
        "3. RAG: `python -m ai_platform.rag query \"...\"`",
        "4. Prompt del agente en `prompts/agents/`",
    ])
    return "\n".join(lines)
