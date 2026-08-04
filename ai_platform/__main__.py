"""
CLI — Portal de desarrollo IA Beemetry (antes AURIXA).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

from ai_platform.branch_manager import prepare_branch
from ai_platform.decision_engine import evaluate
from ai_platform.generator import generate
from ai_platform.github_analyzer import analyze_diff, analyze_paths
from ai_platform.learning import load_metrics
from ai_platform.orchestrator import Orchestrator
from ai_platform.reviewer import review_pr
from ai_platform.router import format_route_report, route
from ai_platform.rag import build_index, build_vectors, index_stats, search
from ai_platform.rag.query import format_context


def cmd_route(args: argparse.Namespace) -> int:
    result = route(args.text, args.files or [])
    print(format_route_report(result, args.text))
    if args.json:
        from dataclasses import asdict
        print(json.dumps(asdict(result), indent=2, ensure_ascii=False))
    return 0


def cmd_task(args: argparse.Namespace) -> int:
    orch = Orchestrator()
    task = orch.create_task(args.text, args.files or [])
    bundle = orch.get_context_bundle(task)
    print(f"# Tarea {task.id}")
    print(f"- Rama: `{task.branch}`")
    print(f"- Agente: `{task.route.get('agent_id')}` → `{task.route.get('model')}`")
    print(f"- SPEC: {task.spec_id or '—'}")
    print(f"- ADRs ({len(task.adrs)}): {', '.join(task.adrs[:8])}{'...' if len(task.adrs) > 8 else ''}")
    print("\n## Context bundle")
    print(json.dumps(bundle, indent=2, ensure_ascii=False))
    return 0


def cmd_decide(args: argparse.Namespace) -> int:
    report = evaluate(args.text, args.files or [])
    print(report.to_markdown())
    return 0 if report.ready else 1


def cmd_generate(args: argparse.Namespace) -> int:
    out = Path(args.output) if args.output else None
    result = generate(args.text, args.files or [], out)
    print(f"# Generación — {result.spec_id or 'task'}")
    print(f"- Agente: {result.agent_id} | Modelo: {result.model} | Mock: {result.mock}")
    print(f"- Decision ready: {result.decision_ready}")
    print("\n---\n")
    print(result.output[:12000])
    if len(result.output) > 12000:
        print("\n... [truncado]")
    return 0 if result.decision_ready else 1


def cmd_branch(args: argparse.Namespace) -> int:
    result = prepare_branch(args.text, args.files or [], dry_run=not args.create)
    print(json.dumps({
        "branch": result.branch_name,
        "context_path": str(result.context_path),
        "created": result.created,
        "message": result.message,
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    if args.diff_file:
        analysis = analyze_diff(Path(args.diff_file).read_text(encoding="utf-8"))
    else:
        analysis = analyze_paths(args.files or [])
    print(json.dumps({
        "primary_stack": analysis.primary_stack,
        "suggested_agent": analysis.suggested_agent,
        "suggested_model": analysis.suggested_model,
        "domains": analysis.domains,
    }, indent=2, ensure_ascii=False))
    return 0


def cmd_rag(args: argparse.Namespace) -> int:
    if args.rag_cmd == "index":
        print(json.dumps(build_index(force=args.force), indent=2))
        return 0
    if args.rag_cmd == "reindex-vectors":
        print(json.dumps(build_vectors(force=True), indent=2))
        return 0
    if args.rag_cmd == "stats":
        stats = index_stats()
        stats["vectors"] = build_vectors() if Path("ai_platform/rag/data/vectors.json").exists() else {}
        print(json.dumps(stats, indent=2))
        return 0
    if args.rag_cmd == "query":
        print(format_context(args.text))
        return 0
    return 1


def cmd_review(args: argparse.Namespace) -> int:
    diff = Path(args.diff_file).read_text(encoding="utf-8") if args.diff_file else ""
    report = review_pr(args.body or "", diff, args.files or [])
    print(report.to_markdown())
    return 0 if report.verdict == "APPROVE" else 1


def cmd_metrics(args: argparse.Namespace) -> int:
    print(json.dumps(load_metrics(), indent=2, ensure_ascii=False))
    return 0


def cmd_pipeline(args: argparse.Namespace) -> int:
    """Pipeline completo: decide → route → generate → review (Paso 13)."""
    files = args.files or []
    decision = evaluate(args.text, files)
    print("## 1. Motor de decisión")
    print(decision.to_markdown())
    if not decision.ready:
        return 1
    print("\n## 2. Generación")
    gen = generate(args.text, files)
    print(f"Mock={gen.mock}, chars={len(gen.output)}")
    print("\n## 3. Revisión simulada")
    report = review_pr(
        f"{decision.spec_id} {' '.join(decision.adrs)}",
        gen.output[:5000],
        files,
    )
    print(report.to_markdown())
    return 0 if report.verdict == "APPROVE" else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="ai_platform", description="Plataforma IA Beemetry")
    sub = parser.add_subparsers(dest="command")

    for name, func, help_text in [
        ("route", cmd_route, "Enrutar a agente/modelo"),
        ("task", cmd_task, "Crear tarea orquestada"),
        ("decide", cmd_decide, "Motor de decisión pre-código"),
        ("generate", cmd_generate, "Generar código con IA"),
        ("branch", cmd_branch, "Preparar rama feature + CONTEXT.md"),
        ("analyze", cmd_analyze, "Analizar paths/diff GitHub"),
        ("review", cmd_review, "Revisión PR ADR+SPEC"),
        ("metrics", cmd_metrics, "Métricas aprendizaje router"),
        ("pipeline", cmd_pipeline, "Pipeline decide→generate→review"),
    ]:
        p = sub.add_parser(name, help=help_text)
        if name in ("route", "task", "decide", "generate", "branch", "pipeline"):
            p.add_argument("text")
            p.add_argument("--files", nargs="*", default=[])
        if name == "route":
            p.add_argument("--json", action="store_true")
        if name == "generate":
            p.add_argument("--output", "-o", default="")
        if name == "branch":
            p.add_argument("--create", action="store_true", help="Crear rama git real")
        if name == "analyze":
            p.add_argument("--diff-file")
        if name == "review":
            p.add_argument("--body", default="")
            p.add_argument("--diff-file")
            p.add_argument("--files", nargs="*", default=[])
        p.set_defaults(func=func)

    p_rag = sub.add_parser("rag", help="Memoria RAG FTS + vectorial")
    p_rag.add_argument("rag_cmd", choices=["index", "query", "stats", "reindex-vectors"])
    p_rag.add_argument("text", nargs="?", default="")
    p_rag.add_argument("--force", action="store_true")
    p_rag.set_defaults(func=cmd_rag)

    args = parser.parse_args()
    if not args.command:
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
