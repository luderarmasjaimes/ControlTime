"""
Revisor automático PR — cumplimiento ADR canónico, SPEC y Constitución.
Incluye reglas + revisión LLM opcional (segundo modelo).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from ai_platform.learning import record_review
from ai_platform.llm_client import complete
from ai_platform.registry_parser import adrs_for_spec, load_spec_acceptance_criteria

ROOT = Path(__file__).resolve().parents[1]

SECRET_PATTERNS = [
    r"api[_-]?key\s*=\s*['\"][^'\"]+['\"]",
    r"password\s*=\s*['\"][^'\"]+['\"]",
    r"BEGIN (RSA |OPENSSH )?PRIVATE KEY",
    r"sk-[a-zA-Z0-9]{20,}",
    r"AKIA[0-9A-Z]{16}",
]


@dataclass
class ReviewFinding:
    severity: str
    rule: str
    message: str
    file: str | None = None


@dataclass
class ReviewReport:
    verdict: str
    spec_id: str | None
    adrs: list[str]
    expected_adrs: list[str] = field(default_factory=list)
    findings: list[ReviewFinding] = field(default_factory=list)
    llm_review: str | None = None

    def to_markdown(self) -> str:
        lines = [
            f"## Veredicto: **{self.verdict}**",
            "",
            "| Campo | Valor |",
            "|-------|-------|",
            f"| SPEC | {self.spec_id or '⚠ no referenciado'} |",
            f"| ADRs en PR | {', '.join(self.adrs) if self.adrs else '—'} |",
            f"| ADRs esperados (REGISTRY) | {', '.join(self.expected_adrs) if self.expected_adrs else '—'} |",
            "",
            "### Hallazgos",
            "",
        ]
        if not self.findings:
            lines.append("_Sin hallazgos de reglas._")
        else:
            for f in self.findings:
                loc = f" (`{f.file}`)" if f.file else ""
                lines.append(f"- **[{f.severity.upper()}]** {f.rule}{loc}: {f.message}")
        if self.llm_review:
            lines.extend(["", "### Revisión LLM (segundo modelo)", "", self.llm_review])
        return "\n".join(lines)


def extract_spec_from_text(text: str) -> str | None:
    m = re.search(r"SPEC[-\s]?(\d{3})", text, re.I)
    return f"SPEC-{m.group(1)}" if m else None


def extract_adrs_from_text(text: str) -> list[str]:
    nums = re.findall(r"ADR-(\d{3})", text, re.I)
    return sorted({f"ADR-{n}" for n in nums})


def _llm_review(spec_id: str | None, diff_text: str, pr_body: str) -> str | None:
    if os.environ.get("AURIXA_LLM_REVIEW", "1") == "0":
        return None
    cas = load_spec_acceptance_criteria(spec_id) if spec_id else []
    prompt = f"""Eres revisor de código independiente (plataforma minera Beemetry).
Evalúa el PR contra SPEC y Constitución. Responde en español, conciso.

SPEC: {spec_id}
Criterios: {cas}
PR body: {pr_body[:2000]}
Diff (truncado): {diff_text[:6000]}

Responde:
1. ¿Cumple ADR/SPEC? (sí/no + detalle)
2. ¿Rompe arquitectura multitenant?
3. ¿Vulnerabilidades obvias?
4. Veredicto: APPROVE o REQUEST_CHANGES
"""
    resp = complete(prompt, model="gpt-4o-mini", provider="openai")
    return resp.text


def review_pr(
    pr_body: str,
    diff_text: str,
    changed_files: list[str] | None = None,
) -> ReviewReport:
    findings: list[ReviewFinding] = []
    combined = pr_body + "\n" + diff_text

    spec_id = extract_spec_from_text(combined)
    adrs = extract_adrs_from_text(combined)
    expected = adrs_for_spec(spec_id) if spec_id else []

    if not spec_id:
        findings.append(ReviewFinding(
            severity="error",
            rule="Constitución / ADR-090",
            message="PR debe referenciar SPEC-NNN en descripción o CONTEXT.md",
        ))

    if spec_id and expected:
        missing = [a for a in expected if a not in adrs and a not in combined]
        if missing and len(missing) > len(expected) // 2:
            findings.append(ReviewFinding(
                severity="warning",
                rule="REGISTRY",
                message=f"ADRs no citados en PR: {', '.join(missing[:5])}{'...' if len(missing) > 5 else ''}",
            ))

    for pat in SECRET_PATTERNS:
        if re.search(pat, diff_text, re.I):
            findings.append(ReviewFinding(
                severity="error",
                rule="Seguridad",
                message="Posible secreto/credencial en el diff",
            ))
            break

    backend_sql = [f for f in (changed_files or []) if f.startswith(("backend/", "db_scripts/"))]
    sql_ops = any(k in diff_text.lower() for k in ("insert ", "update ", "select ", "delete "))
    if backend_sql and sql_ops and "tenant" not in diff_text.lower():
        findings.append(ReviewFinding(
            severity="warning",
            rule="ADR-006",
            message="Cambios BD/backend: verificar filtro tenant_id",
            file=backend_sql[0],
        ))

    if spec_id:
        cas = load_spec_acceptance_criteria(spec_id)
        if not cas:
            findings.append(ReviewFinding(
                severity="warning",
                rule="SPEC",
                message=f"No se encontraron CA-* en spec de {spec_id}",
            ))

    llm_text = _llm_review(spec_id, diff_text, pr_body)

    errors = [f for f in findings if f.severity == "error"]
    verdict = "REQUEST_CHANGES" if errors else "APPROVE"
    if llm_text and "REQUEST_CHANGES" in llm_text.upper() and verdict == "APPROVE":
        findings.append(ReviewFinding(
            severity="warning",
            rule="LLM Reviewer",
            message="El revisor LLM sugiere cambios — revisar sección abajo",
        ))

    record_review(approved=(verdict == "APPROVE"))

    return ReviewReport(
        verdict=verdict,
        spec_id=spec_id,
        adrs=adrs or expected,
        expected_adrs=expected,
        findings=findings,
        llm_review=llm_text,
    )
