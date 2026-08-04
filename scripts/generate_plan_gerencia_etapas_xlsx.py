#!/usr/bin/env python3
"""
Genera Excel gerencial: proyecto en 2 etapas (4+2 meses), entregables por Sprint,
riesgos y mitigaciones, carga de recursos. Regenera también el Excel ClickUp import.
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import generate_clickup_import as gci  # noqa: E402

OUT_GERENCIA = ROOT / "docs" / "Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx"
OUT_CLICKUP = ROOT / "Plataforma_Minera_ClickUp_v19.xlsx"

HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
HEADER_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
WRAP = Alignment(vertical="top", wrap_text=True)
THIN = Border(
    left=Side(style="thin"), right=Side(style="thin"),
    top=Side(style="thin"), bottom=Side(style="thin"),
)

FILLS = {
    "title": PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid"),
    "etapa1": PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid"),
    "etapa2": PatternFill(start_color="6A1B9A", end_color="6A1B9A", fill_type="solid"),
    "risk": PatternFill(start_color="B71C1C", end_color="B71C1C", fill_type="solid"),
    "ok": PatternFill(start_color="2E7D32", end_color="2E7D32", fill_type="solid"),
    "sub": PatternFill(start_color="E3F2FD", end_color="E3F2FD", fill_type="solid"),
}


def style_header_row(ws, row: int, ncol: int, fill: PatternFill) -> None:
    for c in range(1, ncol + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = HEADER_FONT
        cell.fill = fill
        cell.alignment = HEADER_ALIGN
        cell.border = THIN


def write_table(ws, headers: list, rows: list, start_row: int = 1, fill=None) -> int:
    ncol = len(headers)
    style_header_row(ws, start_row, ncol, fill or FILLS["title"])
    for c, h in enumerate(headers, 1):
        ws.cell(row=start_row, column=c, value=h)
    r = start_row + 1
    for row in rows:
        for c, val in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=val)
            cell.border = THIN
            cell.alignment = WRAP
        r += 1
    return r


def set_col_widths(ws, widths: list) -> None:
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


# ── Datos estructurados: entregables por Sprint (presentación gerencia) ──
SPRINT_ENTREGABLES = [
    # Etapa 1 — S1-S8
    ("S1", "Etapa 1", "R1", "2026-06-01", "2026-06-12",
     "Arranque oficial y alcance acordado",
     "Acta de kick-off firmada; SOW y cronograma aprobados por Gerencia; equipo de 10 recursos confirmado; mapa de arquitectura inicial; backlog ClickUp cargado.",
     "Demo: presentación ejecutiva de alcance, hitos y responsables. ARQ + PAF.",
     "Gate PM-0: aprobación de inicio de proyecto."),
    ("S2", "Etapa 1", "R1", "2026-06-15", "2026-06-26",
     "Base técnica y diseño de datos",
     "Esquema de base de datos PostgreSQL aprobado (BE3); pipeline CI/CD operativo (SYS); diseño UX y shell navegable del editor (FE1); matriz RBAC inicial (BE2).",
     "Demo: recorrido del shell ReportStudio + diagrama de datos + ambiente dev levantado.",
     "Gate R1: diseño y arquitectura aprobados — cierre Mes 1."),
    ("S3", "Etapa 1", "R2", "2026-06-29", "2026-07-10",
     "Motor del servidor y acceso seguro",
     "Núcleo C++ en operación (BE1); APIs REST y canal en vivo para sensores; login con usuarios y perfiles (BE2); sincronización inicial con AWS (BE3).",
     "Demo: ingreso al sistema, recepción de datos de sensores en tiempo real en pantalla.",
     "Inicio Mes 2 — FE2, SYS, QA, IA incorporados."),
    ("S4", "Etapa 1", "R2", "2026-07-13", "2026-07-24",
     "Permisos, guardado y telemetría base",
     "Niveles de acceso y roles operativos (BE2); guardado automático del editor en servidor (BE1); telemetría base validada; plan maestro de pruebas QA (QA).",
     "Demo: usuario con distinto perfil ve distintas funciones; informe se guarda sin pérdida.",
     "Gate R2: motor operacional + Git + Docker + VPS desarrollo."),
    ("S5", "Etapa 1", "R3", "2026-07-27", "2026-08-07",
     "Editor de informes y mapa minero",
     "Editor ReportStudio funcional: texto, tablas, imágenes (FE1); servicios equivalentes en servidor (BE1); mapa interactivo con puntos y zonas (FE1+BE1).",
     "Demo: crear informe minero con formato corporativo y ubicar sensores en mapa.",
     "Mes 3 — foco UX y sensores."),
    ("S6", "Etapa 1", "R3", "2026-08-10", "2026-08-21",
     "Sensores, voz e inteligencia artificial base",
     "Integración de hasta 10.000 sensores simulados; dictado por voz con vocabulario minero (IA+BE2); modelos IA locales en VPS (BE2); ETL programado desde AWS (BE3).",
     "Demo: dashboard de sensores en vivo + dictado en informe + corrección inteligente de texto.",
     "Gate R3: frontend con editor, GIS y dashboards operativos."),
    ("S7", "Etapa 1", "R4", "2026-08-24", "2026-09-04",
     "Exportación e integraciones",
     "Exportar informes a PDF y Word (FE1+BE1); panel gerencial con KPIs (FE1+BE1); integraciones externas estables (BE3); auditoría de accesos (BE2).",
     "Demo: descargar informe PDF + dashboard gerencial + log de quién accedió al sistema.",
     "Mes 4 — integración e2e."),
    ("S8", "Etapa 1", "R4", "2026-09-07", "2026-09-18",
     "Modo sin internet y validación integral Etapa 1",
     "Trabajo offline en mina con sincronización al reconectar (FE1+BE1+BE3); regresión completa Etapa 1 (QA); acta de cierre funcional core.",
     "Demo: editar informe sin internet, reconectar y ver datos sincronizados; informe QA Etapa 1.",
     "Gate R4 / FIN ETAPA 1: sistema integrado e2e funcional — aprobación paso a Etapa 2."),
    # Etapa 2 — S9-S13
    ("S9", "Etapa 2", "R5", "2026-09-21", "2026-10-02",
     "Rendimiento y seguridad aplicativa",
     "Optimización de consultas y sockets (BE1); pentest interno OWASP (BE2+QA); hardening de servidores inicio (SYS); pruebas de carga progresivas (QA).",
     "Demo: informe de rendimiento + hallazgos de seguridad priorizados con plan de cierre.",
     "Inicio Etapa 2 — hardening y optimización."),
    ("S10", "Etapa 2", "R5", "2026-10-05", "2026-10-16",
     "Continuidad y recuperación ante fallos",
     "Copias de seguridad automáticas y prueba de restauración BD (BE3); simulacro disaster recovery (BE3+SYS+ARQ); IA cloud con plan de respaldo (BE2); monitoreo 24/7 (SYS).",
     "Demo: simulacro controlado de recuperación + tablero de monitoreo en vivo.",
     "Gate parcial R5: infra productiva con DR demostrado."),
    ("S11", "Etapa 2", "R5", "2026-10-19", "2026-10-30",
     "Optimización final pre-UAT",
     "Afinamiento modelos IA (IA); optimización final core C++ (BE1); cierre hallazgos seguridad P0/P1 (BE2); certificación interna de calidad (QA).",
     "Demo: comparativa antes/después de rendimiento; matriz de cierre de hallazgos.",
     "Gate R5: infraestructura productiva lista — aprobación UAT ejecutivo."),
    ("S12", "Etapa 2", "R6", "2026-11-02", "2026-11-13",
     "Pruebas de estrés, UAT y marcha blanca",
     "Prueba de 10.000 sensores simultáneos (QA+BE1); UAT con operadores mineros (QA+FE2+ARQ); marcha blanca controlada en ambiente real (todo el equipo).",
     "Demo: UAT en campo + reporte de estrés + operación en marcha blanca 48-72h.",
     "Mes 6 — validación con usuarios reales."),
    ("S13", "Etapa 2", "R6", "2026-11-16", "2026-11-27",
     "Go-Live y transferencia a operaciones",
     "Lanzamiento oficial en producción VPS Lima; transferencia a operaciones TI cliente (ARQ+SYS); manuales y capacitación entregados (PAF); acta de cierre y lecciones aprendidas.",
     "Demo ejecutiva: sistema en producción + acta Go-Live firmada + kit de entrega documental.",
     "Gate R6 / FIN PROYECTO: Go-Live aprobado por Gerencia General."),
]

ETAPA1_RIESGOS = [
    ("R-E1-01", "Alto", "Retraso en aprobación de arquitectura y alcance (Mes 1)",
     "Bloquea diseño de BD, contratos API y validación temprana con usuarios.",
     "Gate ARQ semana 4 (S2); comité ejecutivo semanal; daily standups con escalamiento de bloqueos en 24h.",
     "ARQ, PAF", "S1-S2"),
    ("R-E1-02", "Alto", "Complejidad del núcleo C++ tiempo real (BE1)",
     "Riesgo de demora en telemetría en vivo y APIs core del editor/mapas.",
     "Modularización ya implementada; revisiones de código quincenales; pruebas de humo diarias en canal WebSocket.",
     "BE1, ARQ", "S3-S5"),
    ("R-E1-03", "Medio", "Integración con plataforma Amazon (AWS) y datos legacy",
     "ETL fallido o datos inconsistentes entre sistemas.",
     "BE3 lidera ETL incremental; POC sync en S3; jobs programados con alertas; datos de prueba anonimizados.",
     "BE3, SYS", "S3-S7"),
    ("R-E1-04", "Medio", "Datos insuficientes para entrenar modelos de IA",
     "Retraso en biometría, voz y corrector inteligente.",
     "Tarea IA-M01 en S2; datasets sintéticos de respaldo; IA entrena, BE2 integra y sirve.",
     "IA, BE2", "S2-S6"),
    ("R-E1-05", "Alto", "Ampliación de alcance (alcances A-G) sin control",
     "Sobrecarga del equipo y desvío del cronograma de 6 meses.",
     "Change control formal ARQ; comité ejecutivo aprueba cambios; matriz trazabilidad PAF.",
     "ARQ, PAF", "S1-S8"),
    ("R-E1-06", "Medio", "Conflictos al sincronizar datos sin internet",
     "Pérdida o duplicación de informes editados en campo.",
     "Cola ordenada BE1+BE3; pruebas offline en S8; resolución visual de conflictos en UI.",
     "BE1, BE3, FE1", "S7-S8"),
    ("R-E1-07", "Medio", "Recursos QA/IA/SYS/FE2 inician en Mes 2",
     "Percepción de subutilización en junio (falso positivo en promedio 6 meses).",
     "Comunicar a Gerencia métrica 'promedio meses activos'; carga 90-100% desde julio validada.",
     "ARQ, PAF", "S1"),
    ("R-E1-08", "Alto", "Seguridad (usuarios, roles, biometría) incompleta antes de demo Mes 4",
     "Rechazo de stakeholders por accesos no controlados.",
     "BE2 líder desde S3; gate de seguridad antes de R4; QA valida casos RBAC en S7.",
     "BE2, QA", "S3-S8"),
]

ETAPA2_RIESGOS = [
    ("R-E2-01", "Alto", "Hallazgos críticos en pentest OWASP (S9)",
     "Impide pasar a UAT ejecutivo y Go-Live.",
     "Pentest progresivo desde S9; buffer S11 para cierre P0/P1; BE2 + QA priorizan remediación.",
     "BE2, QA", "S9-S11"),
    ("R-E2-02", "Alto", "Fallo en simulacro de recuperación (DR) sistema + BD",
     "Riesgo operativo en producción minera 24/7.",
     "Simulacro BE3+SYS en S10; runbooks documentados; segundo simulacro si falla el primero.",
     "BE3, SYS, ARQ", "S10-S11"),
    ("R-E2-03", "Alto", "Prueba de carga 10.000 sensores no cumple SLA",
     "Degradación en operación real LATAM.",
     "Load test incremental S9-S12; tuning BE1 sockets; SYS escala infra; QA certifica umbrales.",
     "BE1, QA, SYS", "S9-S12"),
    ("R-E2-04", "Medio", "Rechazo parcial en UAT por usuarios de mina",
     "Retraso de Go-Live y pérdida de confianza gerencial.",
     "FE2 acompaña UAT en campo; marcha blanca S12 antes de Go-Live; hotfix sprint S13 reservado.",
     "FE2, QA, ARQ", "S12-S13"),
    ("R-E2-05", "Medio", "Inestabilidad infraestructura en despliegue producción",
     "Caídas durante marcha blanca o Go-Live.",
     "Blue/green SYS; monitoreo Prometheus/Grafana; guardia 24/7 post Go-Live (ARQ-G14).",
     "SYS, ARQ", "S12-S13"),
    ("R-E2-06", "Medio", "Equipo al 95-100% sin margen para imprevistos",
     "Riesgo de burnout o retraso en correcciones finales.",
     "S13 dedicado a hotfixes; ARQ prioriza P0 únicamente; PAF coordina sin reuniones extra.",
     "ARQ, PAF", "S11-S13"),
    ("R-E2-07", "Alto", "Incumplimiento documental o trazabilidad para auditoría minera",
     "Rechazo de cierre contractual.",
     "ARQ-G12 auditoría SOW; PAF kit cierre; matriz requisito→entregable actualizada.",
     "ARQ, PAF, QA", "S11-S13"),
]


def build_gerencia_workbook() -> openpyxl.Workbook:
    wb = openpyxl.Workbook()

    # ── Hoja 1: Portada y resumen ejecutivo ──
    ws = wb.active
    ws.title = "01_Resumen_Ejecutivo"
    ws["A1"] = "PLAN DE PROYECTO AURIXA — REVISIÓN GERENCIA GENERAL"
    ws["A1"].font = Font(bold=True, size=16, color="1F4E79")
    ws.merge_cells("A1:F1")
    rows_info = [
        ("Proyecto", "Plataforma Enterprise de Reportabilidad e Informes Técnicos Mineros (AURIXA)"),
        ("Duración total", "6 meses calendario: 1 junio — 30 noviembre 2026"),
        ("Etapa 1", "4 meses (Jun–Sep 2026) — Construcción funcional core, editor, sensores, integración AWS"),
        ("Etapa 2", "2 meses (Oct–Nov 2026) — Hardening, DR, UAT, Go-Live producción"),
        ("Metodología", "Híbrida Scrum + PMO: 13 sprints quincenales + gates de release (R1–R6)"),
        ("Equipo", "10 recursos especializados (3 Backend, 2 Frontend, ARQ, SYS, QA, IA, PAF)"),
        ("Meta carga", "90–100% en meses activos por recurso (validado cronograma v36)"),
        ("Entregables gerencia", "Demo al cierre de cada Sprint (Sprint Review) + gates PM por release"),
        ("Fuente operativa", "ClickUp — importar hoja Import_ClickUp de Plataforma_Minera_ClickUp_v19.xlsx"),
        ("Estado cronograma", f"{len(gci.TASKS)} tareas · 0 violaciones dependencias · 0 sobrecarga >100%"),
    ]
    r = 3
    for label, val in rows_info:
        ws.cell(row=r, column=1, value=label).font = Font(bold=True)
        ws.cell(row=r, column=2, value=val).alignment = WRAP
        r += 1
    set_col_widths(ws, [28, 90])

    # ── Hoja 2: Etapa 1 resumen ──
    ws1 = wb.create_sheet("02_Etapa1_Resumen")
    write_table(ws1, ["Aspecto", "Detalle"], [
        ("Nombre", "ETAPA 1 — Implementación funcional core"),
        ("Duración", "4 meses: Junio, Julio, Agosto, Septiembre 2026"),
        ("Sprints", "S1 a S8 (8 sprints quincenales)"),
        ("Releases", "R1 (Arquitectura), R2 (Motor operacional), R3 (UX+Sensores), R4 (Integración e2e)"),
        ("Objetivo gerencial", "Entregar plataforma funcional integrada: login seguro, editor de informes, mapas, sensores, exportación, modo offline y sync AWS"),
        ("Gate de cierre Etapa 1", "Fin Sprint S8 — Gate R4: demo e2e + acta QA + aprobación ARQ para pasar a Etapa 2"),
        ("Recursos clave", "BE1 (core), BE2 (seguridad/IA aplicada), BE3 (BD/AWS), FE1, ARQ, PAF; FE2/SYS/QA/IA desde Mes 2"),
        ("Tareas asignadas", f"~{sum(1 for t in gci.TASKS if t[0] == 'PASO 1')} tareas en PASO 1 + transversales"),
    ], fill=FILLS["etapa1"])
    set_col_widths(ws1, [28, 95])

    # ── Hoja 3: Etapa 1 entregables por Sprint ──
    ws_s1 = wb.create_sheet("03_Etapa1_Entregables_Sprint")
    h_s = ["Sprint", "Etapa", "Release", "Inicio", "Fin", "Objetivo Sprint",
           "Entregables (qué se presenta a Gerencia)", "Demo Sprint Review", "Gate PM"]
    e1_rows = [row for row in SPRINT_ENTREGABLES if row[1] == "Etapa 1"]
    write_table(ws_s1, h_s, e1_rows, fill=FILLS["etapa1"])
    set_col_widths(ws_s1, [8, 10, 8, 12, 12, 28, 45, 40, 35])
    ws_s1.freeze_panes = "A2"

    # ── Hoja 4: Etapa 1 riesgos ──
    ws_r1 = wb.create_sheet("04_Etapa1_Riesgos")
    h_r = ["ID", "Impacto", "Riesgo", "Consecuencia si ocurre", "Plan de mitigación", "Responsable", "Sprints vigilancia"]
    write_table(ws_r1, h_r, ETAPA1_RIESGOS, fill=FILLS["risk"])
    set_col_widths(ws_r1, [10, 10, 35, 35, 45, 18, 14])
    ws_r1.freeze_panes = "A2"

    # ── Hoja 5: Etapa 2 resumen ──
    ws2 = wb.create_sheet("05_Etapa2_Resumen")
    write_table(ws2, ["Aspecto", "Detalle"], [
        ("Nombre", "ETAPA 2 — Hardening, estabilización y Go-Live"),
        ("Duración", "2 meses: Octubre y Noviembre 2026"),
        ("Sprints", "S9 a S13 (5 sprints quincenales)"),
        ("Releases", "R5 (Hardening + DR), R6 (Go-Live producción)"),
        ("Objetivo gerencial", "Sistema endurecido, probado bajo carga, UAT aprobado, en producción con transferencia a operaciones"),
        ("Gate de cierre proyecto", "Fin Sprint S13 — Gate R6: Go-Live + acta de cierre + handover operaciones"),
        ("Recursos clave", "SYS (infra), BE2 (seguridad), BE3 (DR/BD), QA (UAT/carga), ARQ (sign-off), todo el equipo en marcha blanca"),
        ("Tareas asignadas", f"~{sum(1 for t in gci.TASKS if t[0] == 'PASO 2')} tareas en PASO 2 + cierre transversal"),
    ], fill=FILLS["etapa2"])
    set_col_widths(ws2, [28, 95])

    # ── Hoja 6: Etapa 2 entregables Sprint ──
    ws_s2 = wb.create_sheet("06_Etapa2_Entregables_Sprint")
    e2_rows = [row for row in SPRINT_ENTREGABLES if row[1] == "Etapa 2"]
    write_table(ws_s2, h_s, e2_rows, fill=FILLS["etapa2"])
    set_col_widths(ws_s2, [8, 10, 8, 12, 12, 28, 45, 40, 35])
    ws_s2.freeze_panes = "A2"

    # ── Hoja 7: Etapa 2 riesgos ──
    ws_r2 = wb.create_sheet("07_Etapa2_Riesgos")
    write_table(ws_r2, h_r, ETAPA2_RIESGOS, fill=FILLS["risk"])
    set_col_widths(ws_r2, [10, 10, 35, 35, 45, 18, 14])
    ws_r2.freeze_panes = "A2"

    # ── Hoja 8: Todos los sprints (vista consolidada) ──
    ws_all = wb.create_sheet("08_Cronograma_13_Sprints")
    write_table(ws_all, h_s, SPRINT_ENTREGABLES, fill=FILLS["title"])
    set_col_widths(ws_all, [8, 10, 8, 12, 12, 28, 45, 40, 35])
    ws_all.freeze_panes = "A2"

    # ── Hoja 9: Carga recursos ──
    ws_c = wb.create_sheet("09_Carga_Recursos_6M")
    cap_h = ["Recurso", "Rol", "Jun %", "Jul %", "Ago %", "Sep %", "Oct %", "Nov %", "Prom. activos", "Total h", "Etapa principal"]
    cap_rows = []
    etapa_map = {
        "BE1": "E1+E2", "BE2": "E1+E2", "BE3": "E1+E2", "FE1": "E1+E2",
        "FE2": "E1+E2", "ARQ": "E1+E2", "SYS": "E1+E2", "QA": "E1+E2", "IA": "E1+E2", "PAF": "E1+E2",
    }
    for code in gci.RESOURCES:
        active = gci.active_months_for_resource(code)
        pcts = []
        total = 0.0
        cells = []
        for m in range(6, 12):
            h = gci.MONTHLY_LOAD[code][m]
            c = gci.MONTH_CAPACITY[m]
            if m in active:
                pct = round(h / c * 100, 1)
                pcts.append(pct)
                total += h
                cells.append(f"{pct}%")
            else:
                cells.append("—")
        prom = round(sum(pcts) / len(pcts), 1) if pcts else 0
        cap_rows.append([
            code, gci.RESOURCE_DISPLAY[code][:42], *cells,
            f"{prom}%", f"{round(total)}h", etapa_map.get(code, "E1+E2"),
        ])
    write_table(ws_c, cap_h, cap_rows, fill=FILLS["sub"])
    set_col_widths(ws_c, [8, 38, 9, 9, 9, 9, 9, 9, 14, 10, 14])
    ws_c.freeze_panes = "A2"

    # ── Hoja 10: Gates PM y releases ──
    ws_g = wb.create_sheet("10_Gates_PM_Releases")
    gates = [
        ("R1", "Etapa 1", "2026-06-30", "S2", "Diseño y arquitectura aprobados", "ARQ", "Acta gate + demo shell + esquema BD"),
        ("R2", "Etapa 1", "2026-07-31", "S4", "Motor operacional + seguridad base", "ARQ", "Demo telemetría + RBAC + VPS dev"),
        ("R3", "Etapa 1", "2026-08-31", "S6", "Editor + sensores + IA base", "ARQ", "Demo editor + mapa + sensores en vivo"),
        ("R4", "Etapa 1", "2026-09-30", "S8", "Sistema integrado e2e — FIN ETAPA 1", "Gerencia + ARQ", "Demo offline + informe QA Etapa 1"),
        ("R5", "Etapa 2", "2026-10-31", "S11", "Hardening + DR + optimización", "ARQ + Gerencia TI", "Informe pentest + simulacro DR + carga"),
        ("R6", "Etapa 2", "2026-11-30", "S13", "Go-Live producción — FIN PROYECTO", "Gerencia General", "Acta Go-Live + handover + kit documental"),
    ]
    write_table(ws_g, ["Release", "Etapa", "Fecha gate", "Sprint cierre", "Criterio de aprobación", "Aprueba", "Evidencia requerida"], gates, fill=FILLS["ok"])
    set_col_widths(ws_g, [10, 10, 14, 14, 40, 18, 45])

    # ── Hoja 11: Instrucciones ClickUp ──
    ws_cu = wb.create_sheet("11_Importar_ClickUp")
    instr = [
        ("Archivo de importación", str(OUT_CLICKUP.name)),
        ("Hoja a importar", "Import_ClickUp (1ª pestaña del Excel ClickUp)"),
        ("Filas", f"{len(gci.ALL_TASKS)} tareas incluyendo sprints S1–S13 en columna Sprint"),
        ("Space ClickUp", gci.SPACE),
        ("Folders", "PASO 1 (Etapa 1), PASO 2 (Etapa 2), Control de calidad, DevOps, Gestion PMO, Riesgos"),
        ("Campo Sprint", "Custom Field desplegable: S1 … S13 (ver hoja Metodologia_Sprint en Excel ClickUp)"),
        ("Campo Recurso", "Texto completo del rol (BE1, BE2, BE3, etc.) — no usar Assignee nativo"),
        ("Pasos", "1) Abrir ClickUp > Importar > Excel  2) Mapear columnas según Guia_Importacion_ClickUp  3) Validar sprints en vista Timeline/Gantt"),
        ("Regenerar", "python scripts/generate_clickup_import.py"),
    ]
    write_table(ws_cu, ["Tema", "Instrucción"], instr, fill=FILLS["ok"])
    set_col_widths(ws_cu, [28, 95])

    return wb


def main() -> int:
    print("Regenerando cronograma ClickUp (sprints incluidos)...")
    # generate_clickup_import runs on import; ensure fresh output
    import subprocess
    subprocess.run([sys.executable, str(SCRIPTS / "generate_clickup_import.py")], check=True, cwd=ROOT)

    print("Generando Excel gerencial Etapas + Sprints + Riesgos...")
    wb = build_gerencia_workbook()
    OUT_GERENCIA.parent.mkdir(parents=True, exist_ok=True)
    wb.save(OUT_GERENCIA)
    print(f"Excel gerencia: {OUT_GERENCIA}")
    print(f"Excel ClickUp import: {OUT_CLICKUP}")
    print(f"  -> Hoja 'Import_ClickUp': {len(gci.ALL_TASKS)} filas con columna Sprint")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
