"""
Orquestador central — coordina agentes, contexto y flujo (ADR-004).
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ai_platform.github_analyzer import analyze_paths, suggest_branch_name
from ai_platform.registry_parser import adr_file_paths, adrs_for_spec, spec_folder
from ai_platform.router import RouteResult, extract_spec_id, route

ROOT = Path(__file__).resolve().parents[1]
TASKS_DIR = Path(__file__).parent / "state" / "tasks"


@dataclass
class TaskState:
    id: str
    description: str
    status: str  # pending | routed | in_progress | review | done
    route: dict[str, Any] | None = None
    branch: str | None = None
    spec_id: str | None = None
    adrs: list[str] = field(default_factory=list)
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class Orchestrator:
    def __init__(self, root: Path | None = None):
        self.root = root or ROOT
        TASKS_DIR.mkdir(parents=True, exist_ok=True)

    def create_task(self, description: str, files: list[str] | None = None) -> TaskState:
        task_id = f"T-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
        spec_id = extract_spec_id(description)
        rr = route(description, files)
        branch = suggest_branch_name(description, spec_id)
        registry_adrs = adrs_for_spec(spec_id) if spec_id else []
        agent_adrs = rr.adrs if isinstance(rr, RouteResult) else []
        merged_adrs = sorted(set(registry_adrs + agent_adrs))

        state = TaskState(
            id=task_id,
            description=description,
            status="routed",
            route=asdict(rr) if isinstance(rr, RouteResult) else rr,
            branch=branch,
            spec_id=spec_id,
            adrs=merged_adrs,
        )
        self._save(state)
        return state

    def get_context_bundle(self, task: TaskState) -> dict[str, Any]:
        """Paquete de contexto para el agente (Paso 7 metodología)."""
        bundle: dict[str, Any] = {
            "project": "Beemetry / AURIXA Plataforma Minera LATAM",
            "constitution": str(self.root / "specs" / "CONSTITUTION.md"),
            "registry": str(self.root / "specs" / "REGISTRY.md"),
            "architecture_log": str(self.root / "docs" / "decisions" / "README.md"),
            "agents_registry": str(self.root / "agents" / "registry.yaml"),
            "task": asdict(task),
            "rules": [
                "Cumplir SPEC, ADRs históricos aplicables y el log vigente docs/decisions",
                "Multitenant tenant_id obligatorio",
                "Exponer /api/metrics en servicios nuevos",
                "Paridad frontend ↔ backend",
            ],
        }
        if task.spec_id:
            folder = spec_folder(task.spec_id)
            if folder:
                bundle["spec_folder"] = str(folder)
                bundle["spec_md"] = str(folder / "spec.md")
                if (folder / "plan.md").exists():
                    bundle["plan_md"] = str(folder / "plan.md")
                if (folder / "tasks.md").exists():
                    bundle["tasks_md"] = str(folder / "tasks.md")
        bundle["adrs"] = [str(p) for p in adr_file_paths(spec_id=task.spec_id, adr_ids=task.adrs)]
        bundle["adr_ids"] = task.adrs
        return bundle

    def advance_status(self, task_id: str, status: str) -> TaskState | None:
        task = self.load_task(task_id)
        if not task:
            return None
        task.status = status
        self._save(task)
        return task

    def _save(self, task: TaskState) -> None:
        path = TASKS_DIR / f"{task.id}.json"
        task.updated_at = datetime.now(timezone.utc).isoformat()
        path.write_text(json.dumps(asdict(task), indent=2, ensure_ascii=False), encoding="utf-8")

    def load_task(self, task_id: str) -> TaskState | None:
        path = TASKS_DIR / f"{task_id}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return TaskState(**data)
