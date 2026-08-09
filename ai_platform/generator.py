"""
Generador de código asistido por IA (Paso 9).
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from ai_platform.decision_engine import evaluate
from ai_platform.llm_client import LLMResponse, complete
from ai_platform.learning import record_generation
from ai_platform.rag.query import format_context

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class GenerationResult:
    spec_id: str | None
    agent_id: str
    model: str
    output: str
    mock: bool
    decision_ready: bool


def _load_agent_prompt(prompt_path: str | None) -> str:
    if not prompt_path:
        return ""
    p = ROOT / prompt_path
    return p.read_text(encoding="utf-8") if p.exists() else ""


def _load_adr_excerpts(spec_id: str | None, max_chars: int = 6000) -> str:
    from ai_platform.registry_parser import adr_file_paths

    parts: list[str] = []
    total = 0
    for path in adr_file_paths(spec_id=spec_id):
        chunk = path.read_text(encoding="utf-8", errors="ignore")[:1500]
        parts.append(f"### {path.name}\n{chunk}")
        total += len(chunk)
        if total >= max_chars:
            break
    return "\n\n".join(parts)


def generate(
    description: str,
    files: list[str] | None = None,
    output_dir: Path | None = None,
) -> GenerationResult:
    decision = evaluate(description, files)
    rr = __import__("ai_platform.router", fromlist=["route"]).route(description, files)

    if not decision.ready:
        msg = "No se puede generar código:\n" + "\n".join(f"- {b}" for b in decision.blockers)
        return GenerationResult(
            spec_id=decision.spec_id,
            agent_id=rr.agent_id,
            model=rr.model,
            output=msg,
            mock=True,
            decision_ready=False,
        )

    agent_prompt = _load_agent_prompt(rr.prompt_path)
    rag_ctx = format_context(description, limit=5)
    adr_ctx = _load_adr_excerpts(decision.spec_id)
    spec_path = ""
    if decision.spec_id:
        from ai_platform.registry_parser import spec_folder
        folder = spec_folder(decision.spec_id)
        if folder and (folder / "spec.md").exists():
            spec_path = (folder / "spec.md").read_text(encoding="utf-8", errors="ignore")[:8000]

    full_prompt = f"""{agent_prompt}

## Tarea
{description}

## SPEC
{spec_path}

## ADRs aplicables
{adr_ctx}

## Contexto RAG
{rag_ctx}

## Motor de decisión
{decision.to_markdown()}

## Instrucción
Genera código production-ready alineado con ADR y SPEC.
Incluye: handlers/servicios, tests mínimos, comentarios de trazabilidad SPEC/ADR.
Responde en markdown con bloques de código por archivo.
"""

    response: LLMResponse = complete(full_prompt, model=rr.model)
    record_generation(rr.agent_id, accepted=not response.mock)

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_file = output_dir / f"generation_{decision.spec_id or 'task'}.md"
        out_file.write_text(response.text, encoding="utf-8")

    return GenerationResult(
        spec_id=decision.spec_id,
        agent_id=rr.agent_id,
        model=rr.model,
        output=response.text,
        mock=response.mock,
        decision_ready=True,
    )
