"""
Gestión de ramas feature con CONTEXT.md (Paso 6, ADR-009).
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

from ai_platform.decision_engine import evaluate
from ai_platform.github_analyzer import suggest_branch_name
from ai_platform.router import extract_spec_id, route

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "specs" / "templates" / "branch-context.template.md"


@dataclass
class BranchResult:
    branch_name: str
    context_path: Path
    created: bool
    message: str


def _render_context(description: str, branch: str, files: list[str] | None = None) -> str:
    decision = evaluate(description, files)
    rr = route(description, files)
    tpl = TEMPLATE.read_text(encoding="utf-8") if TEMPLATE.exists() else ""
    cas_lines = "\n".join(f"- [ ] {ca}" for ca in decision.acceptance_criteria) or "- [ ] CA-1: (ver spec.md)"
    adrs = "\n".join(f"- {a}" for a in decision.adrs) or "- ADR-007"
    content = (
        tpl.replace("SPEC-NNN — título", f"{decision.spec_id or 'SPEC-???'} — {description[:80]}")
        .replace("feature/...", branch)
        .replace("backend_dev | frontend_dev | ...", rr.agent_id)
        .replace("claude | gpt-5 | ...", rr.model)
    )
    content = content.replace(
        "- ADR-001\n- ADR-007\n- (listar desde specs/REGISTRY.md)",
        adrs,
    )
    content = content.replace("- [ ] CA-1: ...", cas_lines.split("\n")[0] if cas_lines else "- [ ] CA-1: ...")
    return content


def prepare_branch(
    description: str,
    files: list[str] | None = None,
    dry_run: bool = True,
) -> BranchResult:
    spec_id = extract_spec_id(description)
    branch = suggest_branch_name(description, spec_id)
    context_content = _render_context(description, branch, files)
    context_path = ROOT / "CONTEXT.md"

    if dry_run:
        return BranchResult(
            branch_name=branch,
            context_path=context_path,
            created=False,
            message=f"[dry-run] Rama sugerida: {branch}. CONTEXT.md no escrito.",
        )

    try:
        subprocess.run(["git", "checkout", "-b", branch], cwd=ROOT, check=True, capture_output=True)
        context_path.write_text(context_content, encoding="utf-8")
        return BranchResult(
            branch_name=branch,
            context_path=context_path,
            created=True,
            message=f"Rama {branch} creada con CONTEXT.md",
        )
    except subprocess.CalledProcessError as e:
        return BranchResult(
            branch_name=branch,
            context_path=context_path,
            created=False,
            message=f"Error git: {e.stderr.decode(errors='ignore')}",
        )
