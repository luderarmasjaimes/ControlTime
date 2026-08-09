"""
Aprendizaje del Router — métricas por agente/modelo (Paso 11).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

METRICS_PATH = Path(__file__).parent / "learning" / "metrics.json"


def _default_metrics() -> dict:
    return {
        "version": "1.0",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "agents": {
            "backend_dev": {"model": "claude", "generations": 0, "accepted": 0},
            "frontend_dev": {"model": "gpt-5", "generations": 0, "accepted": 0},
            "dba": {"model": "deepseek", "generations": 0, "accepted": 0},
            "documenter": {"model": "gemini", "generations": 0, "accepted": 0},
            "code_reviewer": {"model": "gpt-5", "reviews": 0, "approved": 0},
        },
        "routing_preferences": {
            "backend": "claude",
            "frontend": "gpt-5",
            "sql": "deepseek",
            "documentation": "gemini",
        },
    }


def load_metrics() -> dict:
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not METRICS_PATH.exists():
        data = _default_metrics()
        METRICS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
        return data
    return json.loads(METRICS_PATH.read_text(encoding="utf-8"))


def save_metrics(data: dict) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    METRICS_PATH.parent.mkdir(parents=True, exist_ok=True)
    METRICS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def record_generation(agent_id: str, accepted: bool) -> None:
    data = load_metrics()
    agents = data.setdefault("agents", {})
    entry = agents.setdefault(agent_id, {"generations": 0, "accepted": 0})
    entry["generations"] = entry.get("generations", 0) + 1
    if accepted:
        entry["accepted"] = entry.get("accepted", 0) + 1
    if entry.get("generations"):
        entry["acceptance_rate"] = round(entry["accepted"] / entry["generations"], 3)
    save_metrics(data)


def record_review(approved: bool) -> None:
    data = load_metrics()
    entry = data.setdefault("agents", {}).setdefault(
        "code_reviewer", {"reviews": 0, "approved": 0}
    )
    entry["reviews"] = entry.get("reviews", 0) + 1
    if approved:
        entry["approved"] = entry.get("approved", 0) + 1
    if entry.get("reviews"):
        entry["approval_rate"] = round(entry["approved"] / entry["reviews"], 3)
    save_metrics(data)


def preferred_model(task_type: str) -> str | None:
    data = load_metrics()
    return data.get("routing_preferences", {}).get(task_type)
