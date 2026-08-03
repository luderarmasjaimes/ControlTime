"""Tests ai_platform — metodología IA AURIXA."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

os.environ["AURIXA_LLM_MODE"] = "mock"
os.environ["AURIXA_LLM_REVIEW"] = "0"


def test_registry_adrs_for_spec_014():
    from ai_platform.registry_parser import adrs_for_spec
    adrs = adrs_for_spec("SPEC-014")
    assert "ADR-003" in adrs
    assert "ADR-007" in adrs
    assert "ADR-010" in adrs
    assert len(adrs) >= 5


def test_registry_merges_current_adrs_from_spec():
    from ai_platform.registry_parser import adr_file_paths, adrs_for_spec

    auth_adrs = adrs_for_spec("SPEC-006")
    assert "ADR-029" in auth_adrs
    assert "ADR-075" in auth_adrs
    assert "ADR-076" in auth_adrs
    assert "ADR-077" in auth_adrs
    assert "ADR-078" in auth_adrs
    paths = adr_file_paths(spec_id="SPEC-006")
    assert any(path.name.startswith("076-") for path in paths)

    biometric_adrs = adrs_for_spec("SPEC-008")
    assert "ADR-074" in biometric_adrs
    assert "ADR-075" in biometric_adrs


def test_decision_engine_spec_014():
    from ai_platform.decision_engine import evaluate
    report = evaluate("Implementar modo offline SPEC-014", ["backend/src/"])
    assert report.spec_id == "SPEC-014"
    assert report.ready
    assert len(report.adrs) >= 5
    assert report.language == "C++17"


def test_router_merges_registry_adrs():
    from ai_platform.router import route
    r = route("Login biométrico SPEC-008", ["backend/src/auth/"])
    assert r.spec_hint == "SPEC-008"
    assert "ADR-005" in r.adrs
    assert "ADR-007" in r.adrs


def test_router_infers_auth_spec_from_files():
    from ai_platform.router import route
    r = route("Validar alta administrada de empresas", ["backend/src/auth/"])
    assert r.spec_hint == "SPEC-006"
    assert "ADR-076" in r.adrs
    assert "ADR-077" in r.adrs
    assert "ADR-078" in r.adrs


def test_orchestrator_context_bundle():
    from ai_platform.orchestrator import Orchestrator
    orch = Orchestrator()
    task = orch.create_task("SPEC-006 auth multitenant", ["backend/src/auth/"])
    bundle = orch.get_context_bundle(task)
    assert task.spec_id == "SPEC-006"
    assert len(task.adrs) >= 5
    assert "spec_md" in bundle
    assert len(bundle["adrs"]) >= 5


def test_rag_search():
    from ai_platform.rag import build_index, search
    build_index(force=True)
    hits = search("multitenant tenant_id", limit=3)
    assert len(hits) >= 1


def test_reviewer_requires_spec():
    from ai_platform.reviewer import review_pr
    report = review_pr("", "diff", [])
    assert report.verdict == "REQUEST_CHANGES"


def test_reviewer_approves_with_spec():
    from ai_platform.reviewer import review_pr
    body = "SPEC-008 biometria ADR-005 ADR-007"
    report = review_pr(body, "// code", ["backend/x.cpp"])
    assert report.verdict == "APPROVE"
    assert report.spec_id == "SPEC-008"


def test_generator_mock():
    from ai_platform.generator import generate
    result = generate("Implementar SPEC-008 biometria", ["backend/"])
    assert result.decision_ready
    assert len(result.output) > 50


def test_learning_metrics():
    from ai_platform.learning import load_metrics, record_generation
    data = load_metrics()
    assert "agents" in data
    record_generation("backend_dev", accepted=True)
    data2 = load_metrics()
    assert data2["agents"]["backend_dev"]["generations"] >= 1
