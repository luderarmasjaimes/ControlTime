#!/usr/bin/env python3
"""
Genera cronograma ClickUp: Nueva Plataforma Minera IA (3 etapas).

  Etapa 0 - Pruebas de concepto     Mar-Abr 2026  | ARQ solo | 20% avance modulos
  Etapa 1 - Plataforma Reportabilidad Jun-Nov 2026 | 10 recursos | cronograma v19
  Etapa 2 - Plataforma minera adicional Dic 2026-Abr 2027 | 9 recursos | ThingsBoard CE
"""
import csv
import math
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
from datetime import date, timedelta
from pathlib import Path

from clickup_schedule_core import (
    HOURS_PER_WORKDAY, CONTINGENCY_FACTOR, TARGET_LOAD_PCT, TARGET_LOAD_MAX_PCT,
    PERU_NATIONAL_HOLIDAYS, MONTH_LABELS, is_workday, next_workday, add_workdays,
    count_workdays, build_month_capacity, format_clickup_date, parse_assignees,
    hours_to_workdays, task_tuple,
)

SPACE = "Nueva Plataforma Minera IA"
OUTPUT_XLSX = Path(r"c:\InformeCliente\Nueva_Plataforma_Minera_IA_ClickUp.xlsx")
OUTPUT_CSV = Path(r"c:\InformeCliente\Nueva_Plataforma_Minera_IA_ClickUp_Import.csv")
ETAPA1_SOURCE = Path(r"c:\InformeCliente\Plataforma_Minera_ClickUp_v19.xlsx")

# ── Recursos ──
RESOURCES = {
    "ARQ": "Arquitecto Senior LATAM — PoC, supervision tecnica y cierre",
    "BE1": "BACKEND 1 — DBA / Arq. Datos y Core",
    "BE2": "BACKEND 2 — Ciberseguridad Backend (JWT/RBAC/OWASP)",
    "BE3": "BACKEND 3 — Integraciones",
    "FE1": "FRONTEND 1 — Interfaces (mes 1 al 6)",
    "FE2": "FRONTEND 2 — UX y Soporte (desde mes 2)",
    "SYS": "SYS — Infraestructura (desde mes 2)",
    "QA":  "QA — Calidad (desde mes 2)",
    "IA":  "IA-ML — Modelos e Inteligencia Artificial (desde mes 2)",
    "PAF": "Soporte PMO — Analista Funcional y Documentador",
}
RESOURCE_DISPLAY = {k: v.split("—")[0].strip() if "—" in v else v for k, v in RESOURCES.items()}
RESOURCE_DISPLAY["ARQ"] = "ARQ-Arquitecto TI / PMO"
ETAPA0_RESOURCES = ("ARQ",)
ETAPA12_RESOURCES = tuple(RESOURCES.keys())

# ── Ventanas por etapa ──
ETAPA0_START, ETAPA0_END = date(2026, 3, 1), date(2026, 4, 30)
ETAPA1_START, ETAPA1_END = date(2026, 6, 1), date(2026, 11, 30)
ETAPA2_START, ETAPA2_END = date(2026, 12, 1), date(2027, 4, 30)

ETAPA0_MONTHS = {
    3: (date(2026, 3, 1), date(2026, 3, 31)),
    4: (date(2026, 4, 1), date(2026, 4, 30)),
}

# Cada fila: id, menu_grupo, nombre_menu_ui, que_hace_en_palabras_simples, detalle_tecnico, tags
# Fuente: frontend/src/App.jsx — 17 pestañas + auth/header (prototipo AURIXA Mar-Abr 2026)
ETAPA0_MODULES = [
    ("E0-M01", "Plataforma", "Inicio de sesión y auditoría",
     "Pantalla de acceso, usuario conectado, registro de acciones y salida segura.",
     "AuthGateway, AuditCenter, avatar, branding minero/unidad en cabecera.",
     "SEGURIDAD,ARQUITECTURA"),
    ("E0-M02", "Mantenimiento", "Mantenimiento de usuarios",
     "Alta, baja y edición de usuarios de la mina (perfiles, claves, estado activo/inactivo).",
     "UserManagementView, UserMaintenanceModal, ensureCompanyUsers.",
     "SEGURIDAD,GESTION_PROYECTO"),
    ("E0-M03", "Mantenimiento", "Permisos y accesos por perfil",
     "Define quién puede ver cada menú: sensores, mapas, informes, administración.",
     "PermissionsManagementView, matriz gen_reports, niveles por módulo.",
     "SEGURIDAD,GESTION_PROYECTO"),
    ("E0-M04", "Monitoreo en tiempo real", "Centro de Control [Live]",
     "Tablero gerencial con indicadores de producción, KPIs y estado general de la mina.",
     "MiningDashboard, MiningWorkbenchHeader, /api/dashboard/metrics.",
     "GERENCIA,SENSORES"),
    ("E0-M05", "Monitoreo en tiempo real", "Sensores de Mina",
     "Lista y gráficos de sensores IoT: temperatura, vibración, presión en tiempo real.",
     "AdvancedSensors, WebSocket, index.poc.html, telemetría en vivo.",
     "SENSORES,INTEGRACION"),
    ("E0-M06", "Monitoreo en tiempo real", "Centro de Alarmas [Live]",
     "Alertas automáticas por umbrales, prioridades y enlace para crear informe desde alarma.",
     "AlarmCenter, onCreateReportFromAlarm, ack y severidad.",
     "SENSORES,NOTIFICACIONES"),
    ("E0-M07", "Monitoreo en tiempo real", "Video Vigilancia (diagrama CCTV)",
     "Monitoreo visual de cámaras en faena con diagrama de ubicación y streaming.",
     "VideoDiagram, CctvStreamVideo, /api/surveillance/cameras.",
     "INFRAESTRUCTURA,SEGURIDAD"),
    ("E0-M08", "Monitoreo en tiempo real", "Dual-Stream Telemetría [S2]",
     "Flujo dual de datos en alta frecuencia para telemetría avanzada (Kinesis/Kafka demo).",
     "TelemetryDashboard, QuestDB/TimescaleDB en tiempo real.",
     "SENSORES,DATOS"),
    ("E0-M09", "Geotecnia y modelado 3D", "Estabilidad de Talud",
     "Gráficos de inclinómetros para detectar movimiento en taludes y estructuras.",
     "InclinometerCharts, GeotechWorkbench, alertas geotécnicas.",
     "MAPAS,SENSORES"),
    ("E0-M10", "Geotecnia y modelado 3D", "Desplazamiento Acumulado",
     "Historial de desplazamientos acumulados para análisis de deformación en mina.",
     "DisplacementCharts, series temporales, umbrales de alerta.",
     "MAPAS,SENSORES"),
    ("E0-M11", "Geotecnia y modelado 3D", "Gemelo 3D Mina (diagramas 3D)",
     "Modelo tridimensional interactivo del frente minero con sensores y equipos ubicados.",
     "Viewer3D (React Three Fiber), visualización 3D, instrumentación en modelo.",
     "MAPAS,ARQUITECTURA"),
    ("E0-M12", "Geotecnia y modelado 3D", "Panel de control 3D (Apariencia, Capas, Azimuth)",
     "Barra lateral para configurar capas del modelo 3D, colores, brújula y ángulo de vista.",
     "GeotechWorkbench sidebar: Appearance, Layers, Azimuth; AzimuthCompass.",
     "MAPAS,EXPERIENCIA_USUARIO"),
    ("E0-M13", "Mapas de faena y HD", "Mapa Satelital",
     "Mapa operativo con marcadores de zonas, sensores y puntos de interés en faena.",
     "MapViewer, /api/map/markers (backend C++), capas WMS y GeoJSON.",
     "MAPAS"),
    ("E0-M14", "Mapas de faena y HD", "Mapa Geotécnico HD [Pro]",
     "Cartografía de alta resolución (MBTiles) para detalle técnico de zonas críticas.",
     "DetailedMap, tiles HD, captura de imagen para informes.",
     "MAPAS,EXPORTACION"),
    ("E0-M15", "Territorio y cumplimiento GIS", "Geoservidor Minero [Hub]",
     "Portal GIS con módulos A–F: catastro, geología, ambiental, permisos, infraestructura, monitoreo.",
     "MiningGeoportalView, miningGeoportalHub.json, presets WMS INGEMMET/MINEM.",
     "MAPAS,INTEGRACION"),
    ("E0-M16", "Territorio y cumplimiento GIS", "Cumplimiento Territorial [Pro]",
     "Cruce de operaciones activas con polígonos oficiales y semáforo de cumplimiento normativo.",
     "MapViewer compliance, TerritorialCompliancePanel, /api/map/compliance-intersections.",
     "MAPAS,SEGURIDAD"),
    ("E0-M17", "Ingeniería y reportabilidad", "Motor de Fórmula (control de fórmulas)",
     "Calculadora minera embebida: ejecutar fórmulas técnicas y validar reglas de cálculo.",
     "FormulaEngineEmbed (/formula/index.html), FormulaAnalysisModal en ReportStudio.",
     "EDITOR_INFORMES,DATOS"),
    ("E0-M18", "Ingeniería y reportabilidad", "Redactor Técnico",
     "Editor de texto enriquecido para borradores rápidos de novedades y reportes de turno.",
     "RichTextEditor (TipTap), reportes operativos sin plantilla corporativa.",
     "EDITOR_INFORMES"),
    ("E0-M19", "Ingeniería y reportabilidad", "Informe Técnico [Beta]",
     "Prototipo del editor avanzado de informes: páginas, bloques, exportación básica.",
     "ReportStudioV2: biblioteca bloques, ribbon, workflow demo, export PDF/DOCX parcial.",
     "EDITOR_INFORMES,EXPORTACION"),
    ("E0-M20", "Plataforma", "Contexto minero y barra regional",
     "Selector de mina/unidad/país visible en toda la plataforma para multi-sede.",
     "PlatformRegionBar, contexto tenant, idioma y navegación por chips de menú.",
     "ARQUITECTURA,EXPERIENCIA_USUARIO"),
]

ETAPA0_PHASES = [
    ("A", "Entender necesidades y alcance",
     "Qué problema resuelve este módulo, quién lo usa en mina y qué significa tenerlo al 20%."),
    ("B", "Investigar referencias y alternativas",
     "Revisar mercado, ThingsBoard, normativa minera y buenas prácticas similares."),
    ("C", "Entrevistar usuarios y stakeholders",
     "Conversaciones con operaciones, geotecnia, TI, gerencia y mantenimiento."),
    ("D", "Revisar fuentes del prototipo",
     "Código fuente, APIs, pantallas reales, documentación y datos de prueba existentes."),
    ("E", "Ejecutar pruebas en el prototipo",
     "Navegar el módulo en la app, registrar bugs, medir tiempos y validar flujos clave."),
    ("F", "Retroalimentación y cierre al 20%",
     "Acta PoC, lecciones aprendidas, lista de mejoras para Etapa 1 y confirmación 20% avance."),
]

ETAPA1_MONTHS = {
    6: (date(2026, 6, 1), date(2026, 6, 30)),
    7: (date(2026, 7, 1), date(2026, 7, 31)),
    8: (date(2026, 8, 1), date(2026, 8, 31)),
    9: (date(2026, 9, 1), date(2026, 9, 30)),
    10: (date(2026, 10, 1), date(2026, 10, 31)),
    11: (date(2026, 11, 1), date(2026, 11, 30)),
}
ETAPA2_MONTHS = {
    12: (date(2026, 12, 1), date(2026, 12, 31)),
    1: (date(2027, 1, 1), date(2027, 1, 31)),
    2: (date(2027, 2, 1), date(2027, 2, 28)),
    3: (date(2027, 3, 1), date(2027, 3, 31)),
    4: (date(2027, 4, 1), date(2027, 4, 30)),
}

ETAPA0_CAPACITY = build_month_capacity(ETAPA0_MONTHS)
ETAPA1_CAPACITY = build_month_capacity(ETAPA1_MONTHS)
ETAPA2_CAPACITY = build_month_capacity(ETAPA2_MONTHS)

TARIFF_ARQ_USD = 1900  # referencial mensual Etapa 0

# Capacidades IoT avanzadas (ThingsBoard CE) — complemento tras Etapa 1
ETAPA2_TB_DOMAINS = [
    ("E2-D01", "Multiempresa: minas, clientes y perfiles de uso",
     "Permitir que varias minas o contratistas usen la plataforma con datos separados y límites de uso.",
     "BE1,BE2", "ARQUITECTURA,DATOS", 5),
    ("E2-D02", "Conexión de sensores y equipos (MQTT, HTTP, gateways)",
     "Registrar dispositivos, credenciales y protocolos para telemetría desde faena.",
     "BE1,BE3,SYS", "SENSORES,INTEGRACION", 6),
    ("E2-D03", "Jerarquía mina - zona - equipo - sensor",
     "Organizar activos y relaciones para navegar la operación como árbol.",
     "BE1,FE1", "DATOS,MAPAS", 4),
    ("E2-D04", "Motor de reglas visuales para eventos IoT",
     "Diseñar flujos automáticos: filtrar datos, enriquecer, disparar acciones e integraciones.",
     "BE1,BE3,IA", "INTEGRACION,INTELIGENCIA_ARTIFICIAL", 6),
    ("E2-D05", "Campos calculados, geocercas y agregaciones",
     "Reglas sobre telemetría: sumas, promedios, alertas por ubicación geográfica.",
     "BE1,IA", "SENSORES,INTELIGENCIA_ARTIFICIAL", 5),
    ("E2-D06", "Vistas filtradas y consultas avanzadas por rol",
     "Cada perfil ve solo lo que le corresponde; consultas complejas para tableros.",
     "BE1,FE1", "DATOS,GERENCIA", 4),
    ("E2-D07", "Comandos remotos a equipos en faena",
     "Enviar órdenes a actuadores o PLCs y confirmar ejecución bidireccional.",
     "BE1,BE3", "SENSORES,INTEGRACION", 4),
    ("E2-D08", "Actualización remota de firmware (OTA)",
     "Distribuir y monitorear actualizaciones de software en dispositivos y gateways.",
     "SYS,BE3", "INFRAESTRUCTURA,SENSORES", 4),
    ("E2-D09", "Operación en sitios desconectados (Edge)",
     "Sincronizar datos cuando la faena pierde conectividad y volver a la nube después.",
     "SYS,BE3,ARQ", "INFRAESTRUCTURA,INTEGRACION", 5),
    ("E2-D10", "Centro de notificaciones y escalamiento",
     "Plantillas SMS, correo y chat; reglas de escalamiento por severidad.",
     "BE3,FE2", "NOTIFICACIONES", 4),
    ("E2-D11", "Biblioteca de widgets para tableros operativos",
     "Gráficos, medidores, mapas, símbolos SCADA y tablas reutilizables.",
     "FE1,FE2,IA", "GERENCIA,EXPERIENCIA_USUARIO", 6),
    ("E2-D12", "Control de versiones de configuraciones",
     "Exportar, importar y versionar tableros y reglas como en un repositorio Git.",
     "SYS,ARQ", "INFRAESTRUCTURA,DOCUMENTACION", 3),
    ("E2-D13", "Cuotas de API, límites y auditoría enterprise",
     "Control de uso por tenant, trazabilidad de cambios para cumplimiento.",
     "BE2,ARQ", "SEGURIDAD,DOCUMENTACION", 4),
    ("E2-D14", "Reglas con inteligencia artificial en el flujo IoT",
     "Nodos de IA que analizan eventos en tiempo real e integran modelos AURIXA.",
     "IA,BE2", "INTELIGENCIA_ARTIFICIAL", 4),
    ("E2-D15", "Apps móviles de campo y onboarding por QR",
     "Operadores en terreno con tablet; registro rápido de equipos escaneando código.",
     "FE2,BE3", "EXPERIENCIA_USUARIO,SOPORTE", 3),
]

E2_WORK_TYPES = [
    ("AN", "Planificar integración y diseño", 16, "Alta"),
    ("BE", "Desarrollar servicios del servidor", 32, "Alta"),
    ("FE", "Construir pantallas y controles", 24, "Alta"),
    ("QA", "Probar en escenarios de mina", 16, "Media"),
    ("DOC", "Documentar operación y soporte", 8, "Baja"),
]


def build_etapa0_tasks():
    """120 tareas = 20 módulos x 6 fases; horas auto-ajustadas a capacidad ARQ Mar-Abr."""
    tasks = []
    total_slots = len(ETAPA0_MODULES) * len(ETAPA0_PHASES)
    cap_hours = sum(ETAPA0_CAPACITY.values()) * CONTINGENCY_FACTOR
    hours = max(3, round(cap_hours / total_slots))
    slot = 0
    for mod_idx, mod in enumerate(ETAPA0_MODULES):
        mod_id, menu_grp, ui_name, plain, tech, mod_tags = mod
        for phase_idx, (phase_id, phase_name, phase_desc) in enumerate(ETAPA0_PHASES):
            tid = f"{mod_id}-{phase_id}"
            name = f"PoC: {ui_name} — {phase_name}"
            desc = (
                f"MÓDULO DEL MENÚ: {ui_name}\n"
                f"Grupo: {menu_grp}\n\n"
                f"QUÉ HACE (en simple): {plain}\n\n"
                f"ACTIVIDAD DE ESTA TAREA: {phase_desc}\n\n"
                f"Referencia técnica (prototipo): {tech}\n\n"
                f"ENTREGABLE: evidencia documentada con avance objetivo 20% del módulo.\n"
                f"Periodo: marzo–abril 2026 | Responsable: ARQ (arquitecto / PMO)."
            )
            # Distribuir 120 tareas en 8 semanas (Mar-Abr 2026)
            sw = 1 + (slot * 7) // total_slots
            ew = min(8, sw + 1)
            slot += 1
            tasks.append(task_tuple(
                "Etapa 0 - Pruebas de concepto",
                "E0_MARZO_ABRIL_PoC",
                tid, name, desc,
                "ARQ", f"{mod_tags},ARQUITECTURA,GESTION_PROYECTO",
                "High", sw, ew, "E0", "",
                "Media", "Medio", "Arquitectura", hours, 20,
            ))
    return tasks


def build_etapa2_tasks():
    tasks = []
    week = 1
    max_weeks = 22  # ~5 meses Dic 2026 – Abr 2027
    for dom_id, dom_name, dom_desc, assignees, tags, num_sprints in ETAPA2_TB_DOMAINS:
        for wt_id, wt_name, base_h, complexity in E2_WORK_TYPES:
            assignee_map = {
                "AN": "ARQ,BE1", "BE": assignees, "FE": "FE1,FE2",
                "QA": "QA,BE2", "DOC": "ARQ,BE1",
            }
            hours = base_h
            if wt_id == "BE":
                hours = base_h + num_sprints * 2
            tid = f"{dom_id}-{wt_id}"
            ew = min(week + max(1, num_sprints // 2), max_weeks)
            tasks.append(task_tuple(
                "Etapa 2 - Plataforma minera adicional",
                "E2_THINGSBOARD_EXTENSION",
                tid, f"Etapa 2: {dom_name} — {wt_name}",
                f"CAPACIDAD A INTEGRAR:\n{dom_name}\n\n"
                f"DESCRIPCIÓN: {dom_desc}\n\n"
                f"TRABAJO EN ESTA TAREA: {wt_name}.\n\n"
                f"CONTEXTO: complementa lo validado en Etapa 0 (PoC prototipo) y lo "
                f"industrializado en Etapa 1 (Reportabilidad). Referencia: plataforma IoT "
                f"ThingsBoard CE.\n"
                f"Periodo: diciembre 2026 – abril 2027.",
                assignee_map[wt_id], tags + ",INTEGRACION",
                "High" if complexity == "Alta" else "Normal",
                week, ew, "E2", "",
                complexity, "Alto" if wt_id in ("BE", "AN") else "Medio",
                {"AN": "Arquitectura", "BE": "Backend", "FE": "Frontend",
                 "QA": "Calidad", "DOC": "Arquitectura"}[wt_id],
                hours, 0,
            ))
        week = min(week + 2, max_weeks - 1)
    return tasks


def load_etapa1_from_v19():
    if not ETAPA1_SOURCE.exists():
        raise FileNotFoundError(f"Falta {ETAPA1_SOURCE} — ejecute generate_clickup_import.py primero.")
    wb = openpyxl.load_workbook(ETAPA1_SOURCE, read_only=True, data_only=True)
    ws = wb["Import_ClickUp"]
    rows = list(ws.iter_rows(min_row=2, values_only=True))
    tasks = []
    for row in rows:
        (name, desc, list_name, status, priority, sd, dd, tags, hours,
         tid, recurso, release, depends, complejidad, riesgo, stream,
         ambiente, sprint, mes_cal, carga, met_tipo) = row
        if not tid or str(tid).startswith("CAP-"):
            folder = "Etapa 1 - Plataforma Reportabilidad"
            if str(tid).startswith("CAP-"):
                list_name = "E1_Capacidad_Recursos"
            assignees = _recurso_to_code(str(recurso or ""))
        else:
            folder = "Etapa 1 - Plataforma Reportabilidad"
            assignees = _recurso_to_code(str(recurso or ""))
        # Map old folder names from list
        if list_name in ("Capacidad_Recursos",):
            list_name = "E1_Capacidad_Recursos"
        sw, ew = _dates_to_project_weeks(sd, dd, ETAPA1_START)
        tasks.append(task_tuple(
            folder, list_name, str(tid), str(name or ""), str(desc or ""),
            assignees, str(tags or ""), str(priority or "Normal"),
            sw, ew, str(release or "R1"), str(depends or ""),
            str(complejidad or "Media"), str(riesgo or "Medio"),
            str(stream or "Backend"), int(hours or 8), 0,
        ))
    return tasks


def _recurso_to_code(recurso_text):
    mapping = [
        ("BACKEND 1", "BE1"), ("BACKEND 2", "BE2"), ("BACKEND 3", "BE3"),
        ("FRONTEND 1", "FE1"), ("FRONTEND 2", "FE2"),
        ("ARQ", "ARQ"), ("SYS", "SYS"), ("QA", "QA"), ("IA-ML", "IA"),
    ]
    codes = []
    upper = recurso_text.upper()
    for key, code in mapping:
        if key in upper and code not in codes:
            codes.append(code)
    return ",".join(codes) if codes else "ARQ"


def _dates_to_project_weeks(sd, dd, project_start):
    if not sd or not dd:
        return 1, 4
    if isinstance(sd, str):
        sd = date.fromisoformat(sd[:10])
    if isinstance(dd, str):
        dd = date.fromisoformat(dd[:10])
    sw = max(1, (sd - project_start).days // 7 + 1)
    ew = max(sw, (dd - project_start).days // 7 + 1)
    return sw, ew


def schedule_tasks(tasks, project_start, project_end, month_bounds, month_capacity, resource_pool):
    monthly_load = {c: {m: 0.0 for m in month_capacity} for c in resource_pool}
    dates = {}
    ordered = sorted(tasks, key=lambda t: (t[0], t[8]))
    for task in ordered:
        tid = task[2]
        assignees = parse_assignees(task[5]) or [resource_pool[0]]
        hours = task[15]
        h_each = hours / len(assignees)
        list_name = task[1]
        sw, ew = task[8], task[9]
        tw_start = project_start + timedelta(weeks=sw - 1)
        tw_end = project_start + timedelta(weeks=ew - 1, days=4)
        tw_start = max(tw_start, project_start)
        tw_end = min(tw_end, project_end)
        # reparto mensual parejo entre meses del rango
        months_in_range = [m for m in month_bounds if month_bounds[m][0] <= tw_end and month_bounds[m][1] >= tw_start]
        if not months_in_range:
            months_in_range = list(month_capacity.keys())
        for code in assignees:
            if code not in monthly_load:
                continue
            left = h_each
            per_m = left / len(months_in_range)
            for m in months_in_range:
                cap = month_capacity[m] - monthly_load[code][m]
                take = min(per_m, max(0, cap), left)
                monthly_load[code][m] += take
                left -= take
            while left > 0.01:
                candidates = sorted(
                    [m for m in months_in_range if monthly_load[code][m] < month_capacity[m]],
                    key=lambda m: monthly_load[code][m] / month_capacity[m],
                )
                if not candidates:
                    break
                m = candidates[0]
                take = min(left, month_capacity[m] - monthly_load[code][m])
                monthly_load[code][m] += take
                left -= take
        start = next_workday(max(tw_start, project_start))
        due = next_workday(min(tw_end, project_end))
        if start > due:
            due = add_workdays(start, hours_to_workdays(hours, len(assignees)))
        dates[tid] = (start, min(due, project_end))
    return dates, monthly_load


def validate_dates(all_tasks, all_dates):
    """Verifica que fechas caen dentro de la ventana de cada etapa."""
    windows = {
        "Etapa 0": (ETAPA0_START, ETAPA0_END),
        "Etapa 1": (ETAPA1_START, ETAPA1_END),
        "Etapa 2": (ETAPA2_START, ETAPA2_END),
    }
    errors = []
    stats = {k: {"min": None, "max": None, "count": 0} for k in windows}
    for task in all_tasks:
        folder = task[0]
        tid = task[2]
        if tid.startswith("CAP-"):
            continue
        etapa_key = folder.split(" - ")[0]
        if etapa_key not in windows:
            continue
        lo, hi = windows[etapa_key]
        sd, dd = all_dates.get(tid, (None, None))
        if not sd or not dd:
            errors.append(f"{tid}: sin fechas")
            continue
        stats[etapa_key]["count"] += 1
        stats[etapa_key]["min"] = sd if stats[etapa_key]["min"] is None else min(stats[etapa_key]["min"], sd)
        stats[etapa_key]["max"] = dd if stats[etapa_key]["max"] is None else max(stats[etapa_key]["max"], dd)
        if sd < lo or dd > hi:
            errors.append(f"{tid}: {sd}–{dd} fuera de {lo}–{hi}")
        if sd > dd:
            errors.append(f"{tid}: inicio {sd} > fin {dd}")
    return errors, stats


def etapa0_cost_estimate():
    total_h = sum(ETAPA0_CAPACITY.values())
    return {
        "meses": 2,
        "recurso": "ARQ",
        "horas_brutas": round(total_h, 1),
        "horas_objetivo_100pct": round(total_h * CONTINGENCY_FACTOR, 1),
        "tarifa_usd_mes": TARIFF_ARQ_USD,
        "costo_referencial_usd": TARIFF_ARQ_USD * 2,
        "avance_modulos_pct": 20,
    }


def write_excel(all_tasks, all_dates, summaries):
    wb = openpyxl.Workbook()
    header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    thin = Border(left=Side(style="thin"), right=Side(style="thin"),
                  top=Side(style="thin"), bottom=Side(style="thin"))

    import_headers = [
        "Task Name", "Task Description", "Folder Name", "List Name", "Status", "Priority",
        "Start Date", "Due Date", "Tags", "Time Estimate", "Task ID", "Recurso",
        "Etapa", "Release", "Depends On", "Complejidad", "Riesgo", "Stream",
        "Avance Objetivo %", "Sprint", "Mes Calendario", "Tipo Metodologia",
    ]
    ws = wb.active
    ws.title = "Import_ClickUp"
    for c, h in enumerate(import_headers, 1):
        cell = ws.cell(row=1, column=c, value=h)
        cell.font, cell.fill = header_font, header_fill
        cell.border = thin

    import_rows = []
    for task in all_tasks:
        folder, list_name, tid, name, desc, assignees, tags, priority, sw, ew, release, depends, comp, risk, stream, hours, avance = task
        sd, dd = all_dates[tid]
        recurso = ", ".join(RESOURCE_DISPLAY.get(c, c) for c in parse_assignees(assignees))
        etapa = folder.split(" - ")[0] if " - " in folder else folder
        mes = MONTH_LABELS.get(sd.month, "Transversal")
        import_rows.append([
            name, desc, folder, list_name, "Backlog", priority,
            format_clickup_date(sd), format_clickup_date(dd), tags, hours, tid, recurso,
            etapa, release, depends or "", comp, risk, stream, avance,
            f"S{sw}", mes, "Por etapa",
        ])
    for r, row in enumerate(import_rows, 2):
        for c, val in enumerate(row, 1):
            cell = ws.cell(row=r, column=c, value=val)
            cell.border = thin
            cell.alignment = Alignment(wrap_text=True, vertical="top")

    # Resumen etapas
    ws2 = wb.create_sheet("Resumen_Etapas")
    ws2.append(["Etapa", "Nombre", "Inicio", "Fin", "Recursos", "Tareas", "Horas est.", "Notas"])
    for row in summaries:
        ws2.append(row)

    # Etapa 0 detalle costo
    ws3 = wb.create_sheet("Estimacion_Etapa0")
    est = etapa0_cost_estimate()
    ws3.append(["Concepto", "Valor"])
    for k, v in est.items():
        ws3.append([k, v])
    ws3.append([])
    ws3.append(["Modulos PoC (20% avance c/u)", len(ETAPA0_MODULES)])
    ws3.append(["Actividades por modulo", len(ETAPA0_PHASES)])
    ws3.append(["Tareas Etapa 0 totales", len(ETAPA0_MODULES) * len(ETAPA0_PHASES)])

    # Análisis módulos PoC (todo el menú del prototipo)
    ws4 = wb.create_sheet("Analisis_Etapa0_Modulos")
    ws4.append(["ID", "Grupo menú", "Pestaña UI", "Qué hace", "Avance PoC"])
    for mod_id, menu_grp, ui_name, plain, _, _ in ETAPA0_MODULES:
        ws4.append([mod_id, menu_grp, ui_name, plain, "20%"])

    # Etapa 2 dominios IoT
    ws5 = wb.create_sheet("Analisis_Etapa2_ThingsBoard")
    ws5.append(["ID", "Capacidad", "Descripción gerencial", "Equipo", "Sprints est."])
    for dom in ETAPA2_TB_DOMAINS:
        ws5.append([dom[0], dom[1], dom[2], dom[3], dom[5]])

    # Estructura ClickUp
    ws7 = wb.create_sheet("Estructura_ClickUp")
    ws7.append(["Folder", "List", "Etapa", "Periodo"])
    structure = [
        ("Etapa 0 - Pruebas de concepto", "E0_MARZO_ABRIL_PoC", "0", "Mar-Abr 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "E1_Capacidad_Recursos", "1", "Jun-Nov 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES1_JUNIO_Analisis_Arquitectura", "1", "Jun 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES2_JULIO_Core_Seguridad", "1", "Jul 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES3_AGOSTO_UX_Sensores", "1", "Ago 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES4_SEPTIEMBRE_Integracion_QA", "1", "Sep 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES5_OCTUBRE_Optimizacion", "1", "Oct 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "MES6_NOVIEMBRE_GoLive", "1", "Nov 2026"),
        ("Etapa 1 - Plataforma Reportabilidad", "PMO_Seguimiento", "1", "Transversal"),
        ("Etapa 1 - Plataforma Reportabilidad", "QA_Transversal", "1", "Transversal"),
        ("Etapa 1 - Plataforma Reportabilidad", "DevOps_Infra", "1", "Transversal"),
        ("Etapa 1 - Plataforma Reportabilidad", "Gestion_Riesgos", "1", "Transversal"),
        ("Etapa 2 - Plataforma minera adicional", "E2_THINGSBOARD_EXTENSION", "2", "Dic 2026-Abr 2027"),
    ]
    for row in structure:
        ws7.append(list(row))

    # Qué cubre cada etapa
    ws8 = wb.create_sheet("Reportabilidad_vs_PoC")
    ws8.append(["Ámbito", "Etapa", "Explicación"])
    ws8.append(["PoC de TODO el menú del prototipo (17 pestañas + auth)", "0",
                "Validación al 20%: monitoreo, 3D, mapas, GIS, fórmulas, informes beta"])
    ws8.append(["Industrialización Reportabilidad (ReportStudio, backend, GoLive)", "1",
                "6 meses Jun–Nov 2026 — equipo completo 9 recursos"])
    ws8.append(["Extensión IoT avanzada (ThingsBoard CE)", "2",
                "Dic 2026–Abr 2027 — multi-tenant, reglas, edge, OTA, móvil"])
    ws8.append([])
    ws8.append(["Módulo menú prototipo", "Grupo", "Etapa 0 PoC"])
    for mod_id, menu_grp, ui_name, _, _, _ in ETAPA0_MODULES:
        ws8.append([ui_name, menu_grp, f"20% ({mod_id})"])

    ws6 = wb.create_sheet("Guia_Importacion")
    guide = [
        ("Space", SPACE),
        ("Archivo", str(OUTPUT_XLSX.name)),
        ("Hoja", "Import_ClickUp"),
        ("Fechas", "Year-Month-Day (YYYY-MM-DD)"),
        ("Etapa 0", "Mar-Abr 2026 — solo ARQ — PoC 20% de todo el menú prototipo"),
        ("Etapa 1", "Jun-Nov 2026 — 10 recursos — Plataforma Reportabilidad (v19)"),
        ("Etapa 2", "Dic 2026-Abr 2027 — 9 recursos — Extensión IoT ThingsBoard CE"),
    ]
    for a, b in guide:
        ws6.append([a, b])

    wb.save(OUTPUT_XLSX)
    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8-sig") as f:
        csv.writer(f).writerows([import_headers] + import_rows)
    return len(import_rows)


def main():
    print("Construyendo Etapa 0 (PoC)...")
    e0_tasks = build_etapa0_tasks()
    print(f"  {len(e0_tasks)} tareas Etapa 0")

    print("Cargando Etapa 1 desde v19...")
    e1_tasks = load_etapa1_from_v19()
    print(f"  {len(e1_tasks)} tareas Etapa 1")

    print("Construyendo Etapa 2 (ThingsBoard)...")
    e2_tasks = build_etapa2_tasks()
    print(f"  {len(e2_tasks)} tareas Etapa 2")

    all_tasks = e0_tasks + e1_tasks + e2_tasks
    all_dates = {}
    d0, ml0 = schedule_tasks(e0_tasks, ETAPA0_START, ETAPA0_END, ETAPA0_MONTHS, ETAPA0_CAPACITY, ETAPA0_RESOURCES)
    d1, ml1 = schedule_tasks(e1_tasks, ETAPA1_START, ETAPA1_END, ETAPA1_MONTHS, ETAPA1_CAPACITY, ETAPA12_RESOURCES)
    d2, ml2 = schedule_tasks(e2_tasks, ETAPA2_START, ETAPA2_END, ETAPA2_MONTHS, ETAPA2_CAPACITY, ETAPA12_RESOURCES)
    all_dates.update(d0)
    all_dates.update(d1)
    all_dates.update(d2)

    e0_h = sum(t[15] for t in e0_tasks)
    e1_h = sum(t[15] for t in e1_tasks)
    e2_h = sum(t[15] for t in e2_tasks)
    est = etapa0_cost_estimate()

    summaries = [
        ["0", "Etapa 0 - Pruebas de concepto", "2026-03-01", "2026-04-30", "ARQ",
         len(e0_tasks), e0_h, f"PoC 20% avance | ~USD {est['costo_referencial_usd']} referencial"],
        ["1", "Etapa 1 - Plataforma Reportabilidad", "2026-06-01", "2026-11-30", "9 recursos",
         len(e1_tasks), e1_h, "Cronograma v19 (ReportStudio, backend, GoLive)"],
        ["2", "Etapa 2 - Plataforma minera adicional", "2026-12-01", "2027-04-30", "9 recursos",
         len(e2_tasks), e2_h, "Extensión IoT ThingsBoard CE — capacidades avanzadas mina"],
    ]

    date_errors, date_stats = validate_dates(all_tasks, all_dates)
    if date_errors:
        print(f"\nADVERTENCIAS FECHAS ({len(date_errors)}):")
        for e in date_errors[:10]:
            print(f"  {e}")
    else:
        print("\nOK Fechas validadas: todas dentro de ventana por etapa")
    for etapa, st in date_stats.items():
        if st["count"]:
            print(f"  {etapa}: {st['min']} -> {st['max']} ({st['count']} tareas)")

    n = write_excel(all_tasks, all_dates, summaries)
    print(f"\nGenerado: {OUTPUT_XLSX}")
    print(f"CSV: {OUTPUT_CSV}")
    print(f"Total filas import: {n}")
    print(f"\n--- RESUMEN ETAPAS ---")
    for s in summaries:
        print(f"  Etapa {s[0]}: {s[1]} | {s[3]} -> {s[4]} | {s[5]} tareas | {s[6]}h | {s[7]}")
    print(f"\n--- ESTIMACION REFERENCIAL ETAPA 0 ---")
    print(f"  ARQ 100% x 2 meses (Mar-Abr 2026)")
    print(f"  Capacidad bruta: {est['horas_brutas']}h | Objetivo: {est['horas_objetivo_100pct']}h")
    print(f"  Tarifa referencial: USD {est['tarifa_usd_mes']}/mes x 2 = USD {est['costo_referencial_usd']}")
    print(f"  Modulos PoC: {len(ETAPA0_MODULES)} x 20% avance = {len(e0_tasks)} tareas")
    print(f"\n--- ETAPA 2 DOMINIOS THINGSBOARD: {len(ETAPA2_TB_DOMAINS)} ---")
    for d in ETAPA2_TB_DOMAINS:
        print(f"  {d[0]}: {d[1][:55]}...")


if __name__ == "__main__":
    main()
