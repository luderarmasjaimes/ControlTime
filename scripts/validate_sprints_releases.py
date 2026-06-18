#!/usr/bin/env python3
"""Validacion cruzada Sprints S1-S13 y Releases R1-R6."""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import generate_clickup_import as gci  # noqa: E402
from generate_plan_gerencia_etapas_xlsx import SPRINT_ENTREGABLES  # noqa: E402

SPRINTS = gci.SPRINTS
REL_MAP = {s[0]: s[4] for s in SPRINTS}


def main() -> int:
    print("=== VALIDACION SPRINTS Y RELEASES ===\n")

    # 1. Cantidad y secuencia
    expected = [f"S{i}" for i in range(1, 14)]
    actual = [s[0] for s in SPRINTS]
    print(f"Sprints: {len(SPRINTS)} (esperado 13) -> {'OK' if len(SPRINTS) == 13 else 'ERROR'}")
    print(f"Secuencia S1-S13 -> {'OK' if actual == expected else 'ERROR'}")

    releases = sorted(set(s[4] for s in SPRINTS))
    print(f"Releases: {len(releases)} (esperado 6) -> {'OK' if releases == ['R1','R2','R3','R4','R5','R6'] else 'ERROR'}")
    print(f"  Etapa 1: S1-S8 + R1-R4 -> {'OK' if actual[:8]==expected[:8] else 'ERROR'}")
    print(f"  Etapa 2: S9-S13 + R5-R6 -> {'OK' if actual[8:]==expected[8:] else 'ERROR'}")

    # 2. SPRINT_ENTREGABLES vs maestro
    mm = 0
    for se in SPRINT_ENTREGABLES:
        sid, rel, d1, d2 = se[0], se[2], se[3], se[4]
        sm = next(x for x in SPRINTS if x[0] == sid)
        if sm[4] != rel or str(sm[1]) != d1 or str(sm[2]) != d2:
            mm += 1
            print(f"  MISMATCH gerencia {sid}: {rel} {d1}-{d2} vs maestro {sm[4]} {sm[1]}-{sm[2]}")
    print(f"SPRINT_ENTREGABLES ({len(SPRINT_ENTREGABLES)} filas) vs SPRINTS maestro -> {'OK' if mm == 0 else f'{mm} errores'}")

    # 3. Tareas
    tasks = [t for t in gci.TASKS if not str(t[2]).startswith(("CAP-", "FLOOR-"))]
    by_release = Counter(t[10] for t in tasks)
    print(f"\nTareas tecnicas: {len(tasks)}")
    for r in releases:
        print(f"  {r}: {by_release.get(r, 0)} tareas")

    bad = []
    by_sprint = Counter()
    multi = 0
    for t in tasks:
        tid, rel = t[2], t[10]
        start, due = gci.TASK_DATES.get(tid, (None, None))
        if not start or not due:
            continue
        sp = gci.sprint_label_for_range(start, due)
        by_sprint[sp] += 1
        if "-" in sp:
            multi += 1
        first = sp.split("-")[0]
        exp = REL_MAP.get(first)
        if rel and exp and rel != exp:
            bad.append((tid, rel, exp, sp))

    print(f"\nTareas que cruzan >1 sprint: {multi}")
    print(f"Inconsistencias Release vs Sprint: {len(bad)} -> {'OK' if not bad else 'REVISAR'}")
    for x in bad[:10]:
        print(f"  {x[0]}: release={x[1]} esperado={x[2]} sprint={x[3]}")

    # 4. Mapa release -> sprints
    print("\n=== MAPA COMPLETO (orden del proyecto) ===")
    print(f"{'Sprint':<6} {'Fechas':<26} {'Lista':<6} {'Release':<8} {'Etapa':<8} Objetivo")
    print("-" * 100)
    for s in SPRINTS:
        sid, ss, se, mes, rel, obj = s
        etapa = "Etapa 1" if sid <= "S8" else "Etapa 2"
        print(f"{sid:<6} {ss} a {se}  {mes:<6} {rel:<8} {etapa:<8} {obj[:45]}")

    print("\n=== RELEASES (hitos gerenciales) ===")
    groups: dict[str, list] = {}
    for s in SPRINTS:
        groups.setdefault(s[4], []).append(s)
    gate_sprint = {"R1": "S2", "R2": "S4", "R3": "S6", "R4": "S8", "R5": "S11", "R6": "S13"}
    gate_date = {"R1": "2026-06-30", "R2": "2026-07-31", "R3": "2026-08-31",
                 "R4": "2026-09-30", "R5": "2026-10-31", "R6": "2026-11-30"}
    for rel in releases:
        gs = groups[rel]
        print(f"  {rel}: {gs[0][0]}-{gs[-1][0]} ({len(gs)} sprints) | gate {gate_sprint[rel]} | cierre {gate_date[rel]}")

    ok = len(SPRINTS) == 13 and len(releases) == 6 and mm == 0 and not bad
    print(f"\nRESULTADO GLOBAL: {'CONFORME 100%' if ok else 'HAY OBSERVACIONES'}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
