#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
translate_thingsboard_alarms.py

Analiza los 104 nodos TbJsFilterNode/TbJsSwitchNode del export legado
(docs/development/thingsboard_formulas_export_2026-09-17.psv) -- los que
translate_thingsboard_formulas.py clasifica como 'not_a_formula' por
diseño, porque no calculan un valor de telemetría: son compuertas de
alarma/enrutamiento del rule-chain. Propone su migración real a
`platform_alarm_rules`, tabla que YA EXISTE en la plataforma nueva
(operator/threshold/severity/condition_type/debounce_secs, ver
backend/src/mining/device_alarm_routes.cpp).

Pedido explícito del usuario (2026-09-18), citando el hallazgo del
addendum a ADR-197: "los 104 nodos... sí son clasificación de alarma por
umbral... su destino natural es platform_alarm_rules... implementar esto".

Este script SÍ propone reglas concretas (operator/threshold/severity) para
los casos con forma segura de traducir -- pero NUNCA inserta nada en la
base de datos ni asume a qué sensor_id real corresponde cada rule_chain.
Ese mapeo (dispositivo legado -> sensor nuevo) requiere el mismo tipo de
decisión humana caso por caso que ADR-197 ya resolvió para los sensores
-- aquí se deja como paso siguiente explícito, no se adivina.

Clasificación real por FORMA de la condición:
  simple_threshold        1 campo, 1 comparación contra un literal
                           numérico -> 1 regla candidata
  multi_threshold_chain   1 campo, cadena de 2+ comparaciones contra
                           literales -> N reglas candidatas (mismo campo,
                           distinto threshold/severity)
  compound_multi_field    combina 2+ campos distintos con && / || -- NO
                           es 1 regla: requiere primero una fórmula
                           sensor_formula_def (canal calculado) usando la
                           extensión iif() de tinyexpr (ver ADR-198), y
                           LUEGO una regla de umbral sobre ese canal
                           calculado (`formula_output_channel_code`,
                           mecanismo que también ya existe). Se propone la
                           expresión iif() candidata, no se inserta nada.
  dynamic_threshold        el umbral viene de metadata.* (configurable por
                           dispositivo en el legado) -- platform_alarm_rules
                           solo soporta un threshold literal fijo, así que
                           esto requiere decidir un valor o modelarlo
                           distinto -- se deja para revisión manual.
  not_alarm_shaped         chequeo de existencia (typeof), frescura del
                           mensaje (new Date()), o comparación de STRINGS
                           -- no es un umbral numérico, fuera de alcance
                           de platform_alarm_rules tal cual existe hoy.

La severidad (info/warning/critical) y el nombre de campo/canal son
SUGERENCIAS heurísticas basadas en las etiquetas reales del legado
(Peligro/Alerta/Normal, Danger/Warning/Normal, etc.) -- SIEMPRE quedan
marcadas para aprobación humana, nunca se insertan solas.

Salida: docs/development/thingsboard_alarms_analysis_2026-09-18.csv
"""
import csv
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate_thingsboard_formulas import (  # noqa: E402
    DEFAULT_INPUT, parse_records, strip_js_comments,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = REPO_ROOT / "docs/development/thingsboard_alarms_analysis_2026-09-18.csv"

ALARM_NODE_TYPES = {
    'org.thingsboard.rule.engine.filter.TbJsFilterNode',
    'org.thingsboard.rule.engine.filter.TbJsSwitchNode',
    'org.thingsboard.rule.engine.transform.TbJsSwitchNode',
}

OP_MAP = {'>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte', '==': 'eq'}

# Heurística de severidad por etiqueta real del legado -- SOLO una
# sugerencia (columna severity_suggested), nunca se aplica sin revisión.
SEVERITY_WORDS = {
    'critical': ['peligro', 'danger', 'critico', 'crítico', 'critical', 'rojo', 'red'],
    'warning': ['alerta', 'warning', 'advertencia', 'amarillo', 'yellow', 'naranja', 'orange', 'moderado'],
    'info': ['normal', 'ok', 'bajo', 'verde', 'green', 'leve', 'info'],
}

IF_COND_RE = re.compile(r'if\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)')
NUMERIC_CMP_RE = re.compile(
    r'\bmsg\.([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\b'
)
DYNAMIC_CMP_RE = re.compile(
    r'\bmsg\.([A-Za-z_][A-Za-z0-9_]*)\s*(>=|<=|==|!=|>|<)\s*(metadata\.[A-Za-z_][A-Za-z0-9_]*)\b'
)
RETURN_LABEL_RE = re.compile(r'return\s*\[\s*[\'"]([^\'"]+)[\'"]\s*\]')
RETURN_BOOL_RE = re.compile(r'\breturn\s+(true|false)\b')
STRING_CMP_RE = re.compile(r'\bmsg\.[A-Za-z_][A-Za-z0-9_]*\s*(?:==|!=)\s*[\'"][^\'"]*[\'"]')


def suggest_severity(label):
    low = label.lower()
    for sev, words in SEVERITY_WORDS.items():
        if any(w in low for w in words):
            return sev
    return ''


def classify_alarm_record(record):
    code = strip_js_comments(record['code'])

    numeric_cmps = NUMERIC_CMP_RE.findall(code)
    dynamic_cmps = DYNAMIC_CMP_RE.findall(code)
    distinct_numeric_fields = sorted(set(f for f, _, _ in numeric_cmps))
    distinct_dynamic_fields = sorted(set(f for f, _, _ in dynamic_cmps))
    has_string_cmp = bool(STRING_CMP_RE.search(code))
    has_typeof = 'typeof' in code
    has_freshness = 'new Date' in code

    labels = RETURN_LABEL_RE.findall(code)
    bools = RETURN_BOOL_RE.findall(code)
    all_returns = labels + bools

    # Compuesto: alguna condición if(...) individual combina 2+ campos
    # msg.<x> DISTINTOS en comparaciones NUMÉRICAS con && / || -- requiere
    # fórmula previa, no es 1 regla. Ojo: se exige que sean comparaciones
    # NUMÉRICAS (no cualquier referencia a msg.<x>) -- una condición como
    # `msg.Freq=='NaN' || msg.Temp=='NaN'` combina 2 campos pero son
    # validaciones de texto/NaN, no umbrales; esa va a not_alarm_shaped,
    # no aquí (bug real encontrado y corregido en la primera pasada: usaba
    # el conteo de TODAS las referencias a campos, no solo las numéricas).
    is_compound = False
    compound_fields = []
    for cond in IF_COND_RE.findall(code):
        numeric_fields_in_cond = sorted(set(f for f, _, _ in NUMERIC_CMP_RE.findall(cond)))
        if len(numeric_fields_in_cond) > 1 and ('&&' in cond or '||' in cond):
            is_compound = True
            compound_fields = numeric_fields_in_cond
            break

    if is_compound:
        iif_hint = " && ".join(f"{f}{OP_MAP.get(op, op)}{v}" for f, op, v in numeric_cmps[:6])
        return {
            'category': 'compound_multi_field',
            'proposed_rules': '',
            'reason': (
                f"la condición combina {len(compound_fields)} campos distintos ({', '.join(compound_fields)}) con && / || "
                f"-- platform_alarm_rules es 1 campo/1 umbral por fila; requiere antes una fórmula sensor_formula_def "
                f"con la extensión iif() de tinyexpr (ADR-198) que calcule un canal compuesto, y LUEGO una regla de "
                f"umbral sobre ese canal vía formula_output_channel_code. Patrón detectado (aprox.): {iif_hint}"
            ),
        }

    if distinct_dynamic_fields and not distinct_numeric_fields:
        return {
            'category': 'dynamic_threshold',
            'proposed_rules': '',
            'reason': (
                f"el umbral de {', '.join(distinct_dynamic_fields)} viene de metadata.* (configurable por "
                "dispositivo en el legado) -- platform_alarm_rules solo soporta un threshold literal fijo por regla, "
                "requiere decidir un valor o modelarlo como parámetro de sensor + fórmula"
            ),
        }

    if not distinct_numeric_fields:
        reasons = []
        if has_typeof:
            reasons.append('chequeo de existencia (typeof)')
        if has_freshness:
            reasons.append('chequeo de frescura del mensaje (new Date())')
        if has_string_cmp:
            reasons.append('comparación contra literal de texto, no numérica')
        if not reasons:
            reasons.append('no se encontró ninguna comparación numérica msg.<campo> <op> <literal>')
        return {
            'category': 'not_alarm_shaped',
            'proposed_rules': '',
            'reason': '; '.join(reasons) + ' -- no es un umbral numérico de alarma, fuera de alcance de platform_alarm_rules tal cual existe',
        }

    if len(distinct_numeric_fields) > 1:
        return {
            'category': 'compound_multi_field',
            'proposed_rules': '',
            'reason': (
                f"usa {len(distinct_numeric_fields)} campos distintos ({', '.join(distinct_numeric_fields)}) en "
                "comparaciones numéricas separadas (no detectadas como un && / || dentro del mismo if, pero "
                "tampoco un único campo) -- revisar manualmente la estructura real antes de decidir 1 o varias reglas"
            ),
        }

    # Un solo campo numérico -- simple_threshold (1 comparación) o
    # multi_threshold_chain (2+, cada una con su propia etiqueta de salida).
    field = distinct_numeric_fields[0]
    proposals = []
    for f, op, val in numeric_cmps:
        te_op = OP_MAP.get(op)
        if te_op is None:  # '!=' no tiene mapeo directo en el CHECK de operator
            continue
        # Etiqueta de severidad más cercana: se usa la lista de returns en
        # orden -- heurística simple (no un parser de asociación real
        # condición->return), por eso SIEMPRE se marca como sugerencia.
        label = all_returns[len(proposals)] if len(proposals) < len(all_returns) else ''
        proposals.append({
            'channel_code': field, 'operator': te_op, 'threshold': val,
            'severity_suggested': suggest_severity(label) if label else '',
            'label_legado': label,
        })

    if not proposals:
        return {
            'category': 'not_alarm_shaped',
            'proposed_rules': '',
            'reason': f"comparaciones numéricas de {field} usan operador sin mapeo directo (!=) -- revisar manualmente",
        }

    proposed_text = ' | '.join(
        f"{p['channel_code']} {p['operator']} {p['threshold']} -> severity_sugerida={p['severity_suggested'] or '?'} (etiqueta legado: {p['label_legado'] or '?'})"
        for p in proposals
    )
    category = 'simple_threshold' if len(proposals) == 1 else 'multi_threshold_chain'
    return {
        'category': category,
        'proposed_rules': proposed_text,
        'reason': '',
    }


def main():
    text = DEFAULT_INPUT.read_text(encoding='utf-8', errors='replace')
    records = parse_records(text)
    alarm_records = [r for r in records if r['type'] in ALARM_NODE_TYPES]

    rows = []
    for r in alarm_records:
        result = classify_alarm_record(r)
        rows.append({
            'rule_chain': r['chain'],
            'node_name': r['node'],
            'node_type': r['type'].rsplit('.', 1)[-1],
            'category': result['category'],
            'proposed_rules': result['proposed_rules'],
            'reason': result['reason'],
            'original_code': r['code'],
        })

    with DEFAULT_OUTPUT.open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            'rule_chain', 'node_name', 'node_type', 'category',
            'proposed_rules', 'reason', 'original_code',
        ])
        w.writeheader()
        w.writerows(rows)

    counts = {}
    for row in rows:
        counts[row['category']] = counts.get(row['category'], 0) + 1
    print(f"Nodos de alarma/filtro analizados: {len(alarm_records)}")
    for cat, n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {cat}: {n}")
    print(f"Reporte completo: {DEFAULT_OUTPUT}")


if __name__ == '__main__':
    sys.exit(main())
