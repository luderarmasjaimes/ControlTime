"""
Analizador GitHub — detecta stack y agente desde paths del diff/PR.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path


STACK_MAP = {
    "backend/": ("Backend", "C++", "Boost.Asio", "OpenCV"),
    "frontend/": ("Frontend", "React", "ReportStudio", "Vite"),
    "db_scripts/": ("Database", "PostgreSQL", "TimescaleDB", "SQL"),
    "ai_engine/": ("AI Vision", "Python", "ONNX", "InsightFace"),
    "formula_engine/": ("Formula", "C++", "PostgreSQL"),
    "specs/": ("SDD", "SPEC", "ADR"),
    "docs/": ("Documentation", "Gerencia"),
    "ai_platform/": ("AI Platform", "Router", "RAG"),
    ".github/": ("DevOps", "CI/CD", "GitHub Actions"),
}


@dataclass
class GitHubAnalysis:
    files: list[str]
    stacks: Counter
    primary_stack: str
    suggested_agent: str
    suggested_model: str
    domains: list[str] = field(default_factory=list)


def analyze_paths(files: list[str]) -> GitHubAnalysis:
    stacks: Counter = Counter()
    domains: list[str] = []

    for f in files:
        norm = f.replace("\\", "/")
        for prefix, tags in STACK_MAP.items():
            if norm.startswith(prefix) or prefix.rstrip("/") in norm:
                stacks[prefix] += 1
                domains.extend(tags[:2])

    if not stacks:
        return GitHubAnalysis(
            files=files,
            stacks=stacks,
            primary_stack="general",
            suggested_agent="planner",
            suggested_model="gpt-5",
            domains=["General"],
        )

    primary = stacks.most_common(1)[0][0]
    agent_map = {
        "backend/": ("backend_dev", "claude"),
        "frontend/": ("frontend_dev", "gpt-5"),
        "db_scripts/": ("dba", "deepseek"),
        "ai_engine/": ("ai_specialist", "claude"),
        "formula_engine/": ("backend_dev", "claude"),
        "specs/": ("functional_analyst", "gemini"),
        "docs/": ("documenter", "gemini"),
        "ai_platform/": ("ai_specialist", "claude"),
        ".github/": ("devops", "gpt-5"),
    }
    agent, model = agent_map.get(primary, ("planner", "gpt-5"))

    return GitHubAnalysis(
        files=files,
        stacks=stacks,
        primary_stack=primary.rstrip("/"),
        suggested_agent=agent,
        suggested_model=model,
        domains=list(dict.fromkeys(domains))[:6],
    )


def analyze_diff(diff_text: str) -> GitHubAnalysis:
    files = []
    for line in diff_text.splitlines():
        if line.startswith("+++ b/") or line.startswith("--- a/"):
            path = line.split("\t")[-1].replace("+++ b/", "").replace("--- a/", "")
            if path and path != "/dev/null":
                files.append(path)
    return analyze_paths(list(dict.fromkeys(files)))


def suggest_branch_name(task: str, spec_id: str | None = None) -> str:
    slug = task.lower()
    slug = "".join(c if c.isalnum() else "-" for c in slug)
    slug = "-".join(p for p in slug.split("-") if p)[:4]
    prefix = spec_id.lower().replace("spec-", "spec") + "-" if spec_id else ""
    return f"feature/{prefix}{slug or 'cambio'}"
