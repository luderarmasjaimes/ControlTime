#!/usr/bin/env python3
"""
Documento gerencial: distribución de recursos 6 meses, horas, % carga
y justificación de obligatoriedad de cada rol.
"""
from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import openpyxl
from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_clickup_import as gci  # noqa: E402

MONTHS = list(range(6, 12))
MONTH_NAMES = [gci.MONTH_LABELS[m] for m in MONTHS]
MES_NUM = {6: 1, 7: 2, 8: 3, 9: 4, 10: 5, 11: 6}
TARGET = gci.TARGET_LOAD_PCT

TITLE = RGBColor(14, 61, 87)
ACCENT = RGBColor(12, 104, 102)
BODY = RGBColor(34, 34, 34)

# Justificación gerencial por recurso — no sustituibilidad
RESOURCE_JUSTIFICATION = {
    "BE1": {
        "titulo_corto": "Backend Senior + Arquitecto de Datos (núcleo)",
        "obligatoriedad": (
            "Rol NO sustituible. Concentra el 100% del diseño de base de datos, persistencia offline, "
            "motor documental server-side, sincronización legacy y APIs core. Reasignar a BE2 o BE3 "
            "generaría conflicto de competencias (seguridad vs integraciones) y dejaría sin dueño "
            "el esquema PostgreSQL, ETL y reconciliación offline — riesgo crítico de pérdida de datos en campo."
        ),
        "funciones_mes": {
            1: "ERD multi-tenant, contratos API con frontend, PoC arquitectura, scripts SQL base, integración temprana con FE1.",
            2: "WebSocket, autosave delta, libpqxx, endpoints documentales JSONB, bitácora forense inicial.",
            3: "Motor documental, versionado, borradores múltiples (API), offline sync backend, ETL legacy.",
            4: "Comentarios API, cache Redis, integración e2e informes, resolución conflictos sync, performance tuning.",
            5: "Kafka bridge, hardening producción, pruebas de carga, optimización consultas Timescale/telemetría.",
            6: "Marcha blanca, estabilización post go-live, transferencia operativa de esquema y runbooks DBA.",
        },
        "riesgo_reduccion": (
            "Retraso ≥4 semanas en hitos H3–H5; imposibilidad de operación offline; corrupción de datos "
            "multi-tenant; incumplimiento de trazabilidad forense exigida por auditoría."
        ),
        "alternativa_descartada": "Fusionar con BE2/BE3: BE2 es 100% ciberseguridad; BE3 es integraciones/comunicaciones. Ninguno tiene capacidad DBA ni ownership del modelo de datos.",
    },
    "BE2": {
        "titulo_corto": "Ciberseguridad Backend (JWT/RBAC/OWASP)",
        "obligatoriedad": (
            "Especialización exclusiva en seguridad aplicativa y cumplimiento. BE1 no puede absorber "
            "pentesting, firma digital, rate limiting y audit log sin sacrificar el 94,9% de carga ya "
            "comprometida en datos y motor core."
        ),
        "funciones_mes": {
            1: "Matriz RBAC, políticas JWT, diseño de segregación por tenant, threat modeling inicial.",
            2: "Middleware de autorización, cifrado at rest, hardening de endpoints, validación OWASP base.",
            3: "Firma digital PKI, rate limiter, audit log centralizado, revisión de APIs expuestas.",
            4: "Pentest pre-producción, OWASP full check, corrección hallazgos P0/P1, cifrado en cache.",
            5: "Zero-Trust DB, políticas IAM, simulacros de intrusión, validación biométrica backend.",
            6: "Certificación de seguridad para UAT, cierre de hallazgos, entrega de evidencias ISO/auditoría.",
        },
        "riesgo_reduccion": (
            "Exposición a inyección SQL/XSS; incumplimiento normativo minero; rechazo de UAT por gerencia de TI; "
            "imposibilidad de certificar trazabilidad de acciones sensibles."
        ),
        "alternativa_descartada": "Asignar seguridad a BE1: colisión con ruta crítica DBA/motor. Asignar a QA: QA valida pero no implementa controles en código.",
    },
    "BE3": {
        "titulo_corto": "Integraciones y comunicaciones",
        "obligatoriedad": (
            "Dueño de notificaciones (email/SMS/webhooks), pipelines de imágenes externas, resolución "
            "de conflictos offline, conversión multiformato y conectividad con sistemas legacy. "
            "Carga del 93,6% en meses activos; absorber en BE1 bloquea ETL y sync."
        ),
        "funciones_mes": {
            1: "Análisis conectores legacy, diseño de webhooks, mapeo de formatos de integración.",
            2: "SMTP, push notifications, serialización binaria para baja conectividad, STT bridge.",
            3: "Motor resolución conflictos offline, upload pipeline imágenes, API gateway interno.",
            4: "Orquestador export PDF/DOCX/PPTX, webhooks eventos, integración Redpanda/Kafka productor.",
            5: "WhatsApp/notificaciones críticas, refactor post-QA, estabilización integraciones.",
            6: "Soporte marcha blanca integraciones, monitoreo de colas sync, handover a operaciones.",
        },
        "riesgo_reduccion": (
            "Notificaciones de alarmas críticas no operativas; fallas en paste/upload de evidencias; "
            "conflictos offline no resueltos; exportaciones bloqueadas en cierre de mes."
        ),
        "alternativa_descartada": "BE1 ya al 100% en mes 2–3. FE1 no implementa backend de integraciones.",
    },
    "FE1": {
        "titulo_corto": "Frontend Senior — único FE activo mes 1",
        "obligatoriedad": (
            "Indispensable desde junio: es el ÚNICO frontend en mes 1. Sin FE1 no hay shell navegable, "
            "contratos UI ni validación temprana con usuarios. FE2 entra en julio; no puede retroactivamente "
            "cubrir arquitectura React/Vite ni ReportStudio core. Carga 97,4% promedio meses activos."
        ),
        "funciones_mes": {
            1: "Setup React/Vite, routing, design system, shell ReportStudio, login, integración API BE1.",
            2: "Editor TipTap base, ribbon toolbar, auth UI, autosave visual, data grid búsqueda.",
            3: "Offline UI, borradores múltiples, shortcuts, ribbon auto-hide, GIS base, workflow UI.",
            4: "Paste imagen, print preview, comparador versiones, integración e2e, dashboards KPI.",
            5: "Streaming cámaras, gráficos live, ajustes UAT, optimización menú (-40% clics).",
            6: "Estabilización UX marcha blanca, hotfixes campo, documentación componentes y atajos.",
        },
        "riesgo_reduccion": (
            "Mes 1 sin frontend = retraso total del cronograma (4+ semanas). Rechazo de usuarios por UX; "
            "incumplimiento alcances A–G (offline, borradores, shortcuts, paneles icon-only)."
        ),
        "alternativa_descartada": "FE2 desde mes 2 no cubre mes 1. BE/ARQ no tienen competencia frontend React.",
    },
    "FE2": {
        "titulo_corto": "UX industrial y soporte de campo (desde mes 2)",
        "obligatoriedad": (
            "Complemento obligatorio de FE1: pruebas con operadores en tablet, accesibilidad industrial, "
            "sidebars icon-only, soporte UAT y NPS post go-live. FE1 al 97% no puede absorber pruebas "
            "de campo sin retrasar desarrollo core del editor."
        ),
        "funciones_mes": {
            2: "Validación UX login/responsive tablet, paneles retráctiles, accesibilidad modo oscuro.",
            3: "Iteración alarmas UI, sidebars colapsables, co-desarrollo offline UX con FE1.",
            4: "QA funcional alcances A–G desde perspectiva usuario, comentarios UI, diff visual.",
            5: "Soporte UAT presencial/híbrido, encuestas operadores, ajustes fricción UX.",
            6: "Marcha blanca acompañamiento, NPS post-lanzamiento, capacitación asistida en campo.",
        },
        "riesgo_reduccion": (
            "UX no validada en condiciones reales de mina (guantes, poca luz); baja adopción operativa; "
            "retrabajo masivo post go-live; incumplimiento pruebas de usabilidad gerenciales."
        ),
        "alternativa_descartada": "FE1 solo: imposible desarrollar y probar en campo simultáneamente al 97% de carga.",
    },
    "ARQ": {
        "titulo_corto": "Arquitecto TI / Director técnico del proyecto",
        "obligatoriedad": (
            "Gobierno técnico, aprobación de arquitectura, SOW, hitos gerenciales, DRP, UAT ejecutivo "
            "y go-live. Sin ARQ no hay sign-off de fases ni escalamiento de riesgos a directorio. "
            "No es rol reemplazable por PAF (documentación) ni por BE1 (implementación)."
        ),
        "funciones_mes": {
            1: "Kick-off C-Level, SOW, NFR, mapa arquitectura, comité aprobación diseño, BRD.",
            2: "Supervisión ruta crítica backend/frontend, revisión de integraciones, gestión de riesgos.",
            3: "Defensa hito intermedio, validación GIS/sensores, change control formal.",
            4: "Demo gerencial core completo, aprobación paso a etapa 2, revisión QA integral.",
            5: "DRP, hardening sign-off, preparación UAT ejecutivo, comité de gobernanza.",
            6: "UAT directorio, acta go-live, transferencia llaves, cierre contractual SOW.",
        },
        "riesgo_reduccion": (
            "Decisiones técnicas sin dueño; scope creep no controlado; imposibilidad de firmar hitos; "
            "rechazo de directorio en UAT por falta de sponsor técnico."
        ),
        "alternativa_descartada": "PMO/PAF documenta pero no decide arquitectura. Ningún dev senior puede asumir gobierno + codificar al 100%.",
    },
    "SYS": {
        "titulo_corto": "Infraestructura / DevOps (desde mes 2)",
        "obligatoriedad": (
            "Dueño de VPS/Docker, CI/CD, Prometheus/Grafana, Nginx, backups infra, DRP técnico y "
            "hardening de servidores. BE1 administra BD pero no red/VPC/contenedores producción. "
            "Carga 96,3% en meses activos; mes 5–6 al 100% por go-live."
        ),
        "funciones_mes": {
            2: "Docker Compose staging, pipeline CI/CD base, secrets management, healthchecks.",
            3: "Prometheus/Grafana, alertas operativas, tuning Nginx cache/compresión.",
            4: "Ambiente UAT infra, simulacros failover, optimización VPS Lima.",
            5: "Red datacenter, segmentación, hardening Zero-Trust infra, cache offline-sync edge.",
            6: "Blue/green deployment, DNS producción, monitoreo 24/7 post go-live, runbooks infra.",
        },
        "riesgo_reduccion": (
            "Caída de plataforma sin recuperación; despliegues manuales propensos a error; "
            "sin monitoreo en marcha blanca; incumplimiento SLA de disponibilidad."
        ),
        "alternativa_descartada": "BE1/DBA: enfoque datos, no red ni orquestación. CLD legacy no existe en equipo actual.",
    },
    "QA": {
        "titulo_corto": "Calidad y pruebas (desde mes 2)",
        "obligatoriedad": (
            "Independencia de QA exigida por auditoría: quien desarrolla no puede certificar calidad. "
            "13 suites funcionales, pentest funcional, load test 10k sensores, UAT estructurado. "
            "Carga 95,5% meses activos; octubre–noviembre al 100%."
        ),
        "funciones_mes": {
            2: "Plan maestro TQA01, casos smoke/regression auth y CRUD informes.",
            3: "Regresión editor TipTap, exportación temprana, pruebas telemetría base.",
            4: "Suite alcances A–G, integración e2e, export PDF/DOCX calidad, Valgrind coordinado.",
            5: "Pentest OWASP, load test incremental, pruebas seguridad, preparación UAT.",
            6: "UAT formal, regresión final, certificado de calidad para directorio, cierre hallazgos P0.",
        },
        "riesgo_reduccion": (
            "Go-live con defectos críticos; incumplimiento 13 suites; rechazo de certificación; "
            "incidentes en producción no detectados."
        ),
        "alternativa_descartada": "Devs auto-probar: conflicto de interés ISO. PAF no tiene competencia técnica de testing.",
    },
    "IA": {
        "titulo_corto": "Inteligencia artificial / ML (desde mes 2)",
        "obligatoriedad": (
            "Competencia especializada no presente en BE2 (seguridad) ni BE3 (integraciones). "
            "Dueño de STT, NLP, OCR, biometría ONNX, clasificación de imágenes y modelos locales. "
            "Requisito contractual de asistente de redacción y visión EPP."
        ),
        "funciones_mes": {
            2: "PoC LanguageTool + vocabulario sectorial, pipeline STT inicial.",
            3: "Whisper fine-tuning acento regional, corrector NLP local, integración gRPC con backend.",
            4: "Clasificación informes, NER entidades, OCR documentos, biometría liveness PoC.",
            5: "ONNX biometría producción, visión EPP CCTV, auto-tag imágenes pegadas en informes.",
            6: "Estabilización modelos en marcha blanca, tuning latencia, documentación MLOps.",
        },
        "riesgo_reduccion": (
            "Funcionalidades IA del SOW no entregadas; dictado por voz inutilizable en ruido de planta; "
            "biometría y EPP vision incumplidos."
        ),
        "alternativa_descartada": "BE2: seguridad, no ML. Externalizar IA: 6–8 sem de onboarding + riesgo de propiedad intelectual.",
    },
    "PAF": {
        "titulo_corto": "Analista funcional / PMO / documentación",
        "obligatoriedad": (
            "Libera 15–20% de carga ARQ y devs en actas, ClickUp, manuales y capacitación. "
            "Sin PAF, ARQ pierde 40h/mes en PMO y el cronograma deja de reflejar realidad. "
            "Único rol de capacitación a usuarios finales y trazabilidad requisito–entregable."
        ),
        "funciones_mes": {
            1: "ClickUp semanal, actas kick-off/SOW, BRD soporte, RACI, boletines avance.",
            2: "Ceremonias agile, action items, matriz trazabilidad FE↔BE, documentación funcional base.",
            3: "Manuales borradores/offline, catálogo requerimientos, soporte change requests.",
            4: "Manuales usuario piloto, soporte UAT documental, dashboard gerencia quincenal.",
            5: "Plan capacitación A–G, talleres supervisores, soporte comité ejecutivo.",
            6: "Kit cierre, lecciones aprendidas, acta transferencia, inducción operaciones.",
        },
        "riesgo_reduccion": (
            "Descontrol de cronograma; gerencia sin reportes confiables; usuarios sin manuales en go-live; "
            "UAT caótico; ARQ sobrecargado y retraso en decisiones técnicas."
        ),
        "alternativa_descartada": "ARQ hace PMO: -18% capacidad arquitectura. Devs documentan: sesgo y baja calidad de manuales.",
    },
}


def shade(cell, fill: str) -> None:
    tc = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:fill"), fill)
    tc.append(sh)


def add_table(doc: Document, headers: list[str], rows: list[list], col_widths=None) -> None:
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]
        c.text = h
        shade(c, "DCE6F1")
        for p in c.paragraphs:
            for r in p.runs:
                r.bold = True
                r.font.size = Pt(9)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = str(val)
            cells[i].vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            for p in cells[i].paragraphs:
                for r in p.runs:
                    r.font.size = Pt(9)
    doc.add_paragraph()


def build_resource_data():
    rows = []
    tasks_by_code_month: dict[str, dict[int, list]] = defaultdict(lambda: defaultdict(list))

    for task in gci.TASKS:
        tid, name, hours = task[2], task[3], task[15]
        for code in gci.parse_assignees(task[5]):
            if code not in gci.RESOURCES:
                continue
            alloc = gci.TASK_ALLOCS.get(tid, {}).get(code, {})
            for m, h in alloc.items():
                if h >= 0.5:
                    tasks_by_code_month[code][m].append({
                        "tid": tid, "name": name, "horas": round(h, 1)
                    })

    for code in gci.RESOURCES:
        active = gci.active_months_for_resource(code)
        months = []
        total_h = 0.0
        pcts_active = []
        for m in MONTHS:
            h = round(gci.MONTHLY_LOAD[code][m], 1)
            cap = gci.MONTH_CAPACITY[m]
            is_active = m in active
            pct = round(h / cap * 100, 1) if is_active else None
            if is_active:
                total_h += h
                pcts_active.append(pct)
            months.append({"m": m, "label": gci.MONTH_LABELS[m], "h": h, "cap": cap, "pct": pct, "active": is_active})

        n_tasks = sum(1 for t in gci.TASKS if code in gci.parse_assignees(t[5]))
        rows.append({
            "code": code,
            "display": gci.RESOURCE_DISPLAY[code],
            "group": gci.RESOURCE_GROUP[code],
            "desc": gci.RESOURCES[code],
            "months": months,
            "total_h": round(total_h, 1),
            "max_h": gci.max_hours_for_resource(code),
            "avg_active": round(sum(pcts_active) / len(pcts_active), 1) if pcts_active else 0,
            "n_tasks": n_tasks,
            "tasks_by_month": tasks_by_code_month[code],
            "meta": RESOURCE_JUSTIFICATION[code],
        })
    return rows


def top_tasks_for_month(tasks_by_month: dict, m: int, limit=6) -> list[str]:
    items = sorted(tasks_by_month.get(m, []), key=lambda x: -x["horas"])[:limit]
    return [f"{x['name'][:90]} ({x['horas']}h)" for x in items]


def write_docx(rows, path: Path) -> None:
    doc = Document()
    sec = doc.sections[0]
    sec.top_margin = Inches(0.75)
    sec.bottom_margin = Inches(0.75)
    sec.left_margin = Inches(0.85)
    sec.right_margin = Inches(0.85)

    # Portada
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("DOCUMENTO GERENCIAL\nDISTRIBUCIÓN DE RECURSOS Y JUSTIFICACIÓN DE OBLIGATORIEDAD")
    r.bold = True
    r.font.size = Pt(16)
    r.font.color.rgb = TITLE

    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rs = sub.add_run(
        "Plataforma Enterprise de Reportabilidad e Informes Técnicos\n"
        "Proyecto 6 meses · Junio–Noviembre 2026 · 10 recursos especializados"
    )
    rs.font.size = Pt(12)
    rs.font.color.rgb = ACCENT

    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    rm = meta.add_run(
        f"Modelo: {gci.HOURS_PER_WORKDAY} h/día laboral · Feriados Perú 2026 excluidos · "
        f"Meta carga: {TARGET}–100% en meses activos · Fuente: cronograma maestro v36 ({len(gci.TASKS)} tareas)"
    )
    rm.font.size = Pt(10)

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # 1. Resumen ejecutivo
    doc.add_heading("1. Resumen ejecutivo para Gerencia", level=1)
    doc.add_paragraph(
        "El presente documento sustenta la necesidad de mantener los 10 recursos especializados "
        "asignados al proyecto durante 6 meses, con evidencia cuantitativa (horas y porcentaje de carga "
        "mensual) y cualitativa (funciones exclusivas, riesgos de reducción y alternativas descartadas)."
    )
    doc.add_paragraph(
        "Conclusión anticipada: ningún recurso puede eliminarse ni fusionarse sin impacto crítico "
        "en hitos contractuales, calidad, seguridad, adopción de usuarios o fecha de go-live. "
        "Todos los recursos activos operan entre 90% y 100% de capacidad mensual en sus meses de participación."
    )

    # 2. Matriz consolidada
    doc.add_heading("2. Matriz consolidada — Horas y % de carga (6 meses)", level=1)
    headers = ["Recurso", "Código", "Grupo", "Total horas", "Cap. proyecto", "Prom. activos %"]
    for lb in MONTH_NAMES:
        headers.append(f"{lb}\n(h / %)")
    matrix = []
    for row in rows:
        cells = [row["display"], row["code"], row["group"], row["total_h"], row["max_h"], f"{row['avg_active']}%"]
        for md in row["months"]:
            if md["active"]:
                cells.append(f"{md['h']}h / {md['pct']}%")
            else:
                cells.append("— / N/A")
        matrix.append(cells)
    add_table(doc, headers, matrix)

    cap_row = [["Capacidad mensual máxima (h)"] + [""] * 5 + [f"{gci.MONTH_CAPACITY[m]}h" for m in MONTHS]]
    add_table(doc, ["Referencia"] + [""] * (len(headers) - 1), cap_row)

    # 3. Análisis de no sustituibilidad
    doc.add_heading("3. Análisis de no sustituibilidad — ¿Por qué 10 recursos?", level=1)
    doc.add_paragraph(
        "La tabla siguiente resume por qué la gerencia no debe reducir headcount ni reasignar tareas "
        "entre roles sin replanificación completa del cronograma (impacto estimado ≥ 4 semanas por recurso crítico)."
    )
    ns_headers = ["Código", "Rol", "¿Fusionable?", "Riesgo principal si se reduce", "Tareas asignadas"]
    ns_rows = []
    for row in rows:
        m = row["meta"]
        ns_rows.append([
            row["code"],
            m["titulo_corto"],
            "NO",
            m["riesgo_reduccion"][:120] + "…" if len(m["riesgo_reduccion"]) > 120 else m["riesgo_reduccion"],
            row["n_tasks"],
        ])
    add_table(doc, ns_headers, ns_rows)

    # 4. Detalle por recurso
    doc.add_heading("4. Detalle por recurso — Funciones, carga y justificación", level=1)

    for row in rows:
        m = row["meta"]
        doc.add_heading(f"4.{list(gci.RESOURCES.keys()).index(row['code'])+1} {row['code']} — {row['display']}", level=2)

        doc.add_paragraph(row["desc"])
        doc.add_paragraph(f"Grupo: {row['group']} · Tareas en cronograma: {row['n_tasks']} · "
                          f"Horas totales meses activos: {row['total_h']}h · "
                          f"Promedio carga meses activos: {row['avg_active']}%")

        doc.add_heading("Justificación de obligatoriedad", level=3)
        doc.add_paragraph(m["obligatoriedad"])
        doc.add_paragraph(f"Alternativa descartada: {m['alternativa_descartada']}")

        doc.add_heading("Carga mensual detallada", level=3)
        mh = ["Mes", "Horas asignadas", "Capacidad (h)", "% Carga", "Estado", "Horas disponibles"]
        mr = []
        for md in row["months"]:
            mes_n = MES_NUM[md["m"]]
            if md["active"]:
                libres = round(md["cap"] - md["h"], 1)
                estado = "ÓPTIMO" if md["pct"] >= TARGET else "REVISAR"
                mr.append([f"Mes {mes_n} — {md['label']}", md["h"], md["cap"], f"{md['pct']}%", estado, libres])
            else:
                mr.append([f"Mes {mes_n} — {md['label']}", "—", md["cap"], "N/A", "Sin contratación", md["cap"]])
        add_table(doc, mh, mr)

        doc.add_heading("Funciones principales por mes", level=3)
        for mes_n in range(1, 7):
            fn = m["funciones_mes"].get(mes_n)
            if fn:
                doc.add_paragraph(f"Mes {mes_n}: {fn}", style="List Bullet")

        doc.add_heading("Principales entregables/tareas (muestra por mes)", level=3)
        for mes_n, mnum in [(n, list(MES_NUM.keys())[list(MES_NUM.values()).index(n)]) for n in range(1, 7)]:
            tops = top_tasks_for_month(row["tasks_by_month"], mnum, 4)
            if tops:
                doc.add_paragraph(f"Mes {mes_n}:")
                for t in tops:
                    doc.add_paragraph(t, style="List Bullet")

        doc.add_heading("Riesgo para el proyecto si se reduce o reasigna este recurso", level=3)
        doc.add_paragraph(m["riesgo_reduccion"])

        if row["code"] != list(gci.RESOURCES.keys())[-1]:
            doc.add_paragraph()

    # 5. Dependencias críticas
    doc.add_heading("5. Mapa de dependencias críticas entre recursos", level=1)
    deps = [
        ("FE1 → BE1", "Frontend mes 1 depende de APIs y contratos de datos desde día 1."),
        ("BE1 → DBA/Schema", "Todo el backend depende del modelo de datos que solo BE1 lidera."),
        ("BE2 → BE1/BE3", "Seguridad debe integrarse en endpoints que BE1/BE3 construyen."),
        ("FE2 → FE1", "UX campo valida lo que FE1 desarrolla; no sustituye desarrollo core."),
        ("QA → Todos", "Certificación independiente de entregables de los 8 recursos técnicos."),
        ("SYS → BE1/BE3", "Infraestructura habilita despliegue de servicios backend."),
        ("IA → BE3", "Modelos IA se integran vía pipelines que BE3 expone."),
        ("PAF → ARQ/Todos", "PMO libera capacidad; sin PAF, ARQ pierde 40h/mes en administración."),
        ("ARQ → Directorio", "Único rol con autoridad para sign-off de hitos H1–H9."),
    ]
    add_table(doc, ["Dependencia", "Descripción"], deps)

    # 6. Recomendación
    doc.add_heading("6. Recomendación formal a Gerencia", level=1)
    for item in [
        "Mantener los 10 recursos con dedicación planificada (90–100% en meses activos) durante los 6 meses del proyecto.",
        "No fusionar roles (ej. BE1+BE2, FE1+FE2, PAF+ARQ) sin aceptar retraso mínimo de 4 semanas y riesgo en hitos H4–H9.",
        "No retrasar incorporación de FE2, QA, IA y SYS más allá del mes 2: el cronograma asume su ausencia solo en junio.",
        "Aprobar convocatorias de los 3 recursos críticos en contratación: BE1 (Backend/DBA), FE1 (Frontend mes 1), PAF (PMO).",
        "Utilizar el Excel adjunto (Reporte_Mensual_Recursos_v36_Detallado.xlsx) para seguimiento mensual de desviaciones.",
    ]:
        doc.add_paragraph(item, style="List Number")

    doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run("Documento preparado para sustentación ante Gerencia · Mayo 2026 · Versión v36")
    r.italic = True
    r.font.size = Pt(9)
    r.font.color.rgb = ACCENT

    doc.save(path)


def write_markdown(rows, path: Path) -> None:
    lines = [
        "# Documento Gerencial — Distribución de Recursos y Justificación de Obligatoriedad",
        "## Proyecto 6 meses · Junio–Noviembre 2026",
        "",
        "### Resumen ejecutivo",
        "",
        "Sustenta la necesidad de **10 recursos especializados** con carga **90–100%** en meses activos.",
        "",
        "### Matriz consolidada",
        "",
        "| Recurso | Código | Total h | Prom. activos % | " + " | ".join(MONTH_NAMES) + " |",
        "|---------|--------|---------|-----------------|" + "|".join(["---"] * 6) + "|",
    ]
    for row in rows:
        mcols = []
        for md in row["months"]:
            if md["active"]:
                mcols.append(f"{md['h']}h ({md['pct']}%)")
            else:
                mcols.append("N/A")
        lines.append(
            f"| {row['display'][:40]} | {row['code']} | {row['total_h']} | {row['avg_active']}% | "
            + " | ".join(mcols) + " |"
        )
    lines.extend(["", "---", ""])
    for row in rows:
        m = row["meta"]
        lines.extend([
            f"## {row['code']} — {row['display']}",
            "",
            f"**Obligatoriedad:** {m['obligatoriedad']}",
            "",
            f"**Alternativa descartada:** {m['alternativa_descartada']}",
            "",
            "| Mes | Horas | Capacidad | % |",
            "|-----|-------|-----------|---|",
        ])
        for md in row["months"]:
            mn = MES_NUM[md["m"]]
            if md["active"]:
                lines.append(f"| Mes {mn} {md['label']} | {md['h']} | {md['cap']} | {md['pct']}% |")
            else:
                lines.append(f"| Mes {mn} {md['label']} | — | {md['cap']} | N/A |")
        lines.extend(["", "**Funciones por mes:**", ""])
        for mn, fn in m["funciones_mes"].items():
            lines.append(f"- **Mes {mn}:** {fn}")
        lines.extend(["", f"**Riesgo si se reduce:** {m['riesgo_reduccion']}", "", "---", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def write_matriz_v36(path: Path, rows: list) -> None:
    """Matriz consolidada markdown para PMO / ClickUp."""
    lines = [
        "# Matriz de Tareas y Carga Laboral — Nueva Distribución v36",
        "## Proyecto AURIXA · 6 meses · Meta: 90–100% en meses activos",
        "",
        "**Fecha:** Mayo 2026  ",
        "**Fuente de verdad:** `scripts/generate_clickup_import.py` → `Plataforma_Minera_ClickUp_v19.xlsx`  ",
        "**Modelo de capacidad:** 8,5 h/día × días netos Perú 2026 (feriados excluidos). Tope **100%** mensual.",
        "",
        "---",
        "",
        "## Carga mensual por recurso (% meses activos)",
        "",
        "> FE2, SYS, QA e IA no tienen carga en junio (mes 1) por diseño. "
        "El **promedio activos** es la métrica de validación PMO.",
        "",
        "| Recurso | Rol | Jun | Jul | Ago | Sep | Oct | Nov | Prom. activos | Total h |",
        "|---------|-----|-----|-----|-----|-----|-----|-----|---------------|---------|",
    ]
    for row in rows:
        pcts = []
        for md in row["months"]:
            if md["active"]:
                pcts.append(f"{md['pct']}%")
            else:
                pcts.append("—")
        lines.append(
            f"| **{row['code']}** | {row['display'][:40]} | "
            f"{' | '.join(pcts)} | **{row['avg_active']}%** | {row['total_h']:.0f}h |"
        )
    lines.extend([
        "",
        f"**Validación cronograma:** {len(gci.TASKS)} tareas técnicas + {len(gci.CAPACITY_TASKS)} indicadores CAP. "
        f"Estado: LISTO PARA IMPORTAR ClickUp (v19).",
        "",
        "## Regeneración",
        "",
        "```powershell",
        "python scripts/generate_clickup_import.py",
        "python scripts/generate_reportes_mensuales_y_convocatorias.py",
        "python scripts/generate_documento_gerencia_recursos.py",
        "```",
        "",
    ])
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    print("Cargando cronograma maestro...")
    rows = build_resource_data()
    docx = DOCS / "Documento_Gerencia_Distribucion_Recursos_v36.docx"
    md = DOCS / "Documento_Gerencia_Distribucion_Recursos_v36.md"
    write_docx(rows, docx)
    write_markdown(rows, md)
    matriz = DOCS / "Matriz_Tareas_Recursos_v36_Nueva_Distribucion.md"
    write_matriz_v36(matriz, rows)
    print(f"DOCX gerencial: {docx}")
    print(f"Markdown: {md}")
    print(f"Matriz: {matriz}")
    print("\nValidación promedio meses activos:")
    for row in rows:
        ok = "OK" if row["avg_active"] >= TARGET else "BAJO"
        print(f"  {row['code']:4s} {row['avg_active']:5.1f}%  {row['total_h']:6.0f}h  {row['n_tasks']:3d} tareas  [{ok}]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
