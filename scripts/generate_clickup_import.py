#!/usr/bin/env python3
"""
Genera archivo Excel para importar proyecto PLATAFORMA MINERA IA a ClickUp.
Estructura: Space > Folder > List > Task

REORGANIZACION:
  - Meses 1-4 (PASO 1): Funcionalidad del sistema (core + editor + frontend)
  - Meses 5-6 (PASO 2): Infraestructura, seguridad, optimizacion, GoLive

VERSION 2 — Revision completa de Arquitecto Senior TI LATAM:
  - Se conservan las 102 tareas originales
  - Se agregan tareas FRONTEND del ReportStudio (reglas horizontales, agrupacion
    de texto/fuentes, color de fondo, TipTap core, toolbar, tablas, imagenes,
    print preview, templates, offline, keyboard shortcuts, comparador versiones,
    portada, headers/footers, listas, paginacion, responsive tablet)
  - Se agregan tareas BACKEND BE1 (auto-save delta, versionado, PDF, locking,
    JSONB schema rich text, search indexing, templates engine, cache, upload,
    comments API, clonacion, numeracion secuencial, rate limiter)
  - Se agregan tareas BACKEND BE2 (encriptacion at rest, firma digital, NLP
    corrector, AI sumarizacion, reconocimiento facial API, deteccion anomalias,
    AI scoring, RBAC middleware)
  - Se agregan tareas BACKEND BE3 (email SMTP, push notifications, webhooks,
    conversion formatos, offline sync conflict, legacy mapping, API gateway)
  - Se verifica correspondencia frontend ↔ backend para cada funcionalidad
"""

import csv
import math
import sys
from datetime import datetime, timedelta, date

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

wb = openpyxl.Workbook()

PROJECT_START = datetime(2026, 6, 1)
PROJECT_START_DATE = date(2026, 6, 1)
PROJECT_END_DATE = date(2026, 11, 30)
SPRINT_DURATION = 14
SPACE = "PLATAFORMA MINERA IA"

RESOURCES = {
    "BE1": "DBA / Arquitecto de Datos Senior — Diseno de BD, scripts SQL, triggers, backups, replicacion, integracion datos con frontend y servicios core",
    "BE2": "Especialista en Ciberseguridad Backend — JWT/RBAC, cifrado, OWASP, pentesting, hardening de APIs y cumplimiento normativo (NO modelos ML)",
    "BE3": "Ingeniero de Comunicaciones — Notificaciones, dictado por voz, integracion entre servicios y conectividad con sistemas externos (sin liderazgo DBA)",
    "FE1": "Experto en Interfaces Senior — Unico frontend mes 1; lidera UI/APIs con backend y DBA desde junio hasta cierre",
    "FE2": "Especialista en UX y Soporte — Activo desde mes 2 (julio): pruebas con usuarios, tablets de campo y salida a produccion",
    "ARQ": "Arquitecto Senior LATAM — Plan de Recuperación ante Desastres, supervisión técnica, pruebas de usuario y aprobación final",
    "SYS": "Especialista en Infraestructura — Blindaje de servidores, copias de seguridad, redes de alta velocidad y alta disponibilidad",
    "QA":  "Auditor de Calidad Senior — Pruebas de estrés (10,000 sensores), seguridad, simulacros de fallo y automatización de calidad (desde mes 2)",
    "IA":  "Ingeniero de Inteligencia Artificial (ML/IA) — Modelos ONNX, NLP, OCR, STT, corrector predictivo e informe predictivo (desde mes 2)",
    "PAF": "Soporte PMO — Analista Funcional y Documentador — ClickUp, reuniones, actas, correos, seguimiento de tareas y comunicacion equipo-gerencia",
}

# ══════════════════════════════════════════════════════════════════════════════
# 20 TAGS CONSOLIDADOS — Claros para gerencia tecnica y NO tecnica
# Sin duplicados, sin jerga tecnica innecesaria, cada uno con proposito unico
# ══════════════════════════════════════════════════════════════════════════════
TAGS_MAP = {
    "ARQUITECTURA":
        "Diseno general del sistema y supervision tecnica del proyecto por el Arquitecto TI. "
        "Incluye decisiones de tecnologia, validacion de diseno y revision de calidad arquitectonica.",

    "SEGURIDAD":
        "Proteccion del sistema contra accesos no autorizados, fraudes informaticos, cifrado de datos "
        "y cumplimiento de normas legales de proteccion de datos personales y regulaciones mineras.",

    "INFRAESTRUCTURA":
        "Servidores, redes de comunicacion, copias de seguridad, plan de recuperacion ante desastres, "
        "contenedores, automatizacion de despliegues y disponibilidad del sistema 24 horas, 7 dias.",

    "DATOS":
        "Base de datos del sistema, almacenamiento de informacion de sensores e informes, motor central "
        "de procesamiento, rendimiento de consultas y estructura de datos de la plataforma.",

    "EDITOR_INFORMES":
        "Editor de informes ReportStudio donde los usuarios crean y formatean documentos mineros: "
        "texto con estilos, tablas, imagenes, reglas horizontales, portadas y formato corporativo.",

    "MAPAS":
        "Mapas digitales interactivos que muestran las zonas de la mina, ubicacion de sensores, "
        "puntos de interes geografico y areas de operacion. Visualizacion en tiempo real.",

    "SENSORES":
        "Dispositivos fisicos (IoT) instalados en la mina que miden temperatura, vibracion, presion "
        "y otros parametros operativos. El sistema procesa datos de hasta 10,000 sensores.",

    "INTELIGENCIA_ARTIFICIAL":
        "Funcionalidades de Inteligencia Artificial: reconocimiento facial para acceso, dictado por voz, "
        "prediccion de fallas en equipos, correccion ortografica inteligente, modelos de aprendizaje.",

    "INTEGRACION":
        "Conexion de la plataforma con otros sistemas: sincronizacion con base de datos actual (AWS), "
        "sistemas de notificaciones (SMS, email, WhatsApp), servicios de monitorizacion y sistemas anteriores.",

    "EXPORTACION":
        "Descarga e impresion de informes en formatos estandar: PDF para impresion, Word para edicion, "
        "PowerPoint para presentaciones ejecutivas y video MP4 para capacitacion.",

    "NOTIFICACIONES":
        "Alertas y avisos automaticos del sistema: correo electronico, mensajes SMS, WhatsApp para "
        "emergencias, y avisos dentro de la plataforma cuando hay informes pendientes de revision.",

    "EXPERIENCIA_USUARIO":
        "Diseno de pantallas y facilidad de uso de la plataforma. Incluye version para tablets "
        "de campo (uso en la mina con guantes), accesibilidad y pruebas de usabilidad con usuarios.",

    "GERENCIA":
        "Pantallas ejecutivas (dashboards) con indicadores clave para directores y gerentes: "
        "estado de produccion, informes pendientes, alertas criticas y cumplimiento de metas.",

    "SOPORTE":
        "Capacitacion a los usuarios de la plataforma, material de entrenamiento (videos, guias), "
        "ayuda en linea dentro del sistema y acompanamiento durante la puesta en marcha.",

    "DOCUMENTACION":
        "Manuales de usuario, documentacion tecnica del sistema, guias de arquitectura, "
        "procedimientos operativos y material de referencia para el equipo y auditores.",

    "PRUEBAS_CALIDAD":
        "Testing y control de calidad: pruebas automaticas, pruebas de estres con 10,000 sensores, "
        "pruebas de seguridad, validacion con usuarios finales y verificacion de requisitos.",

    "GESTION_PROYECTO":
        "Gobierno y administracion del proyecto: reuniones diarias/semanales, cronograma, presupuesto, "
        "gestion de riesgos, reportes de avance a Gerencia y seguimiento de entregables.",

    "CRITICO":
        "Tarea en la RUTA CRITICA del proyecto: si esta tarea se retrasa, todo el cronograma "
        "del proyecto se ve afectado. Requiere atencion prioritaria y seguimiento especial.",

    "PRODUCCION":
        "Actividades de puesta en marcha del sistema: marcha blanca (prueba real controlada), "
        "lanzamiento oficial, estabilizacion post-lanzamiento y soporte intensivo inicial.",

    "SIN_CONEXION":
        "Capacidad de usar la plataforma sin conexion a internet (en zonas de la mina sin senal). "
        "Los datos se guardan localmente y se sincronizan automaticamente al recuperar la conexion.",
}

# ══════════════════════════════════════════════════════════════════════════════
# Tabla de consolidacion: mapea los tags antiguos/duplicados a los 20 finales
# Se aplica automaticamente al generar el Excel (no modifica el codigo fuente)
# ══════════════════════════════════════════════════════════════════════════════
TAG_CONSOLIDATION = {
    # Duplicados de seguridad
    "COMPLIANCE": "SEGURIDAD",
    "SECURITY": "SEGURIDAD",
    # Duplicados de infraestructura
    "SEG_INFRA": "INFRAESTRUCTURA",
    "RECUPERACION": "INFRAESTRUCTURA",
    "DEVOPS": "INFRAESTRUCTURA",
    "REDES": "INFRAESTRUCTURA",
    "BLINDAJE": "INFRAESTRUCTURA",
    "DR": "INFRAESTRUCTURA",
    # Duplicados de datos
    "DB": "DATOS",
    "CORE": "DATOS",
    "BASE_DATOS": "DATOS",
    # Editor
    "EDITOR": "EDITOR_INFORMES",
    # Mapas
    "GIS": "MAPAS",
    # Sensores
    "SENSOR": "SENSORES",
    # Inteligencia Artificial
    "IA": "INTELIGENCIA_ARTIFICIAL",
    "MLOPS": "INTELIGENCIA_ARTIFICIAL",
    "RECONOCIMIENTO": "INTELIGENCIA_ARTIFICIAL",
    "FACIAL": "INTELIGENCIA_ARTIFICIAL",
    "VOZ": "INTELIGENCIA_ARTIFICIAL",
    # Exportacion
    "EXPORT": "EXPORTACION",
    # Notificaciones
    "NOTIF": "NOTIFICACIONES",
    # Experiencia de usuario
    "UX": "EXPERIENCIA_USUARIO",
    "TABLETS": "EXPERIENCIA_USUARIO",
    # Pruebas y calidad
    "QA": "PRUEBAS_CALIDAD",
    "STRESS_TEST": "PRUEBAS_CALIDAD",
    "STRESS": "PRUEBAS_CALIDAD",
    # Gestion de proyecto
    "PMO": "GESTION_PROYECTO",
    "GESTION": "GESTION_PROYECTO",
    # Produccion
    "GO_LIVE": "PRODUCCION",
    "GO-LIVE": "PRODUCCION",
    # Sin conexion
    "OFFLINE": "SIN_CONEXION",
    # Arquitectura
    "ARCH": "ARQUITECTURA",
    # Documentacion
    "DOC": "DOCUMENTACION",
}

# ══════════════════════════════════════════════════════════════════════════════
# Nombres descriptivos de recursos para columna "Recurso" (Campo de Texto)
# Estos se importan como Custom Field tipo Texto en ClickUp (NO como Assignee)
# Asi se muestran COMPLETOS en la pantalla, sin truncarse a 1 letra
# ══════════════════════════════════════════════════════════════════════════════
RESOURCE_DISPLAY = {
    "BE1": "BACKEND 1 — DBA / Arq. Datos y Core",
    "BE2": "BACKEND 2 — Ciberseguridad Backend (JWT/RBAC/OWASP)",
    "BE3": "BACKEND 3 — Integraciones",
    "FE1": "FRONTEND 1 — Interfaces (mes 1 al 6)",
    "FE2": "FRONTEND 2 — UX y Soporte (desde mes 2)",
    "ARQ": "ARQ-Arquitecto TI / PMO",
    "SYS": "SYS-Infraestructura",
    "QA":  "QA-Calidad (desde mes 2)",
    "IA":  "IA-ML — Modelos e Inteligencia Artificial (desde mes 2)",
    "PAF": "Soporte PMO — Analista Funcional y Documentador",
}

RESOURCE_GROUP = {
    "BE1": "Backend", "BE2": "Backend", "BE3": "Backend",
    "FE1": "Frontend", "FE2": "Frontend",
    "ARQ": "Arquitectura", "SYS": "Infraestructura", "QA": "Calidad", "IA": "IA", "PAF": "PMO Soporte",
}


CONTINGENCY_FACTOR = 0.95   # 5% margen contingencias (imprevistos, bloqueos, rework)
HOURS_PER_WORKDAY = 8.5     # 22 dias laborales/mes x 8.5 h (modelo gerencial)

# Feriados nacionales Peru 2026 — Fuente: https://www.gob.pe/feriados
# Solo los que caen Lun-Vie dentro del proyecto (Jun-Nov 2026)
PERU_NATIONAL_HOLIDAYS_2026 = {
    date(2026, 6, 29): "San Pedro y San Pablo",
    date(2026, 7, 23): "Dia de la Fuerza Aerea del Peru",
    date(2026, 7, 28): "Fiestas Patrias",
    date(2026, 7, 29): "Fiestas Patrias",
    date(2026, 8, 6):  "Batalla de Junin",
    date(2026, 10, 8): "Combate de Angamos",
}
# Nota: 7/jun, 30/ago, 1/nov 2026 caen domingo — no restan dia laboral

def format_resource_field(assignee_string):
    """Genera texto descriptivo para campo 'Recurso' (Custom Text Field en ClickUp)."""
    parts = [a.strip() for a in assignee_string.split(",")]
    return ", ".join(RESOURCE_DISPLAY.get(p, p) for p in parts)

def consolidate_tags(tag_string):
    """Transforma tags antiguos/duplicados a los 20 tags consolidados finales."""
    tags = [t.strip() for t in tag_string.split(",")]
    new_tags = []
    for t in tags:
        consolidated = TAG_CONSOLIDATION.get(t, t)
        if consolidated not in new_tags:
            new_tags.append(consolidated)
    return ",".join(new_tags)

def week_start(week_num):
    return PROJECT_START + timedelta(weeks=week_num - 1)

def week_end(week_num):
    return week_start(week_num) + timedelta(days=4)

# ══════════════════════════════════════════════════════════════════════════════
# MOTOR DE FECHAS + SPRINTS — Calendario Jun-Nov 2026, formato ISO para ClickUp
# Ventanas de programacion alineadas a sprints (solapamiento controlado entre meses).
# Listas transversales (PMO, QA, DevOps, Riesgos) usan semanas 1-26 del proyecto.
# ══════════════════════════════════════════════════════════════════════════════

# Mes calendario de reporte gerencial (nombre de lista)
LIST_CALENDAR_MONTH = {
    "MES1_JUNIO_Analisis_Arquitectura": "Junio",
    "MES2_JULIO_Core_Seguridad": "Julio",
    "MES3_AGOSTO_UX_Sensores": "Agosto",
    "MES4_SEPTIEMBRE_Integracion_QA": "Septiembre",
    "MES5_OCTUBRE_Optimizacion": "Octubre",
    "MES6_NOVIEMBRE_GoLive": "Noviembre",
    "QA_Transversal": "Transversal",
    "PMO_Seguimiento": "Transversal",
    "Gestion_Riesgos": "Transversal",
    "DevOps_Infra": "Transversal",
    "Capacidad_Recursos": "Transversal",
}

# Ventana real de fechas (incluye solapamiento de sprints entre meses)
LIST_SCHEDULE_BOUNDS = {
    "MES1_JUNIO_Analisis_Arquitectura": (date(2026, 6, 1), date(2026, 6, 30)),
    "MES2_JULIO_Core_Seguridad": (date(2026, 6, 29), date(2026, 7, 31)),
    "MES3_AGOSTO_UX_Sensores": (date(2026, 7, 27), date(2026, 8, 31)),
    "MES4_SEPTIEMBRE_Integracion_QA": (date(2026, 8, 24), date(2026, 9, 30)),
    "MES5_OCTUBRE_Optimizacion": (date(2026, 9, 21), date(2026, 11, 15)),
    "MES6_NOVIEMBRE_GoLive": (date(2026, 11, 2), date(2026, 11, 30)),
}

LIST_MONTH_BOUNDS = LIST_SCHEDULE_BOUNDS  # alias compatibilidad

TRANSVERSAL_LISTS = {"QA_Transversal", "PMO_Seguimiento", "Gestion_Riesgos", "DevOps_Infra"}

MONTH_NUMBERS = {
    "Junio": 6, "Julio": 7, "Agosto": 8, "Septiembre": 9, "Octubre": 10, "Noviembre": 11,
}
LIST_PREFERRED_MONTHS = {
    "MES1_JUNIO_Analisis_Arquitectura": [6],
    "MES2_JULIO_Core_Seguridad": [6, 7],
    "MES3_AGOSTO_UX_Sensores": [7, 8],
    "MES4_SEPTIEMBRE_Integracion_QA": [8, 9, 10],
    "MES5_OCTUBRE_Optimizacion": [9, 10, 11],
    "MES6_NOVIEMBRE_GoLive": [11, 10],
}
# Mes adicional de contingencia si la lista mensual no tiene cupo (solo en 2da pasada)
LIST_SPILLOVER = {
    "MES1_JUNIO_Analisis_Arquitectura": [7],
    "MES2_JULIO_Core_Seguridad": [8],
    "MES3_AGOSTO_UX_Sensores": [9],
    "MES4_SEPTIEMBRE_Integracion_QA": [11],
    "MES5_OCTUBRE_Optimizacion": [11],
    "MES6_NOVIEMBRE_GoLive": [10],
}
MONTH_LABELS = {6: "Junio", 7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre"}
MONTH_BOUNDS = {
    6: (date(2026, 6, 1), date(2026, 6, 30)),
    7: (date(2026, 7, 1), date(2026, 7, 31)),
    8: (date(2026, 8, 1), date(2026, 8, 31)),
    9: (date(2026, 9, 1), date(2026, 9, 30)),
    10: (date(2026, 10, 1), date(2026, 10, 31)),
    11: (date(2026, 11, 1), date(2026, 11, 30)),
}
MONTH_WEEK_RANGE = {
    6: (1, 4), 7: (5, 8), 8: (9, 13), 9: (14, 17), 10: (18, 22), 11: (23, 26),
}
MONTH_LIST_NAME = {
    6: "MES1_JUNIO_Analisis_Arquitectura",
    7: "MES2_JULIO_Core_Seguridad",
    8: "MES3_AGOSTO_UX_Sensores",
    9: "MES4_SEPTIEMBRE_Integracion_QA",
    10: "MES5_OCTUBRE_Optimizacion",
    11: "MES6_NOVIEMBRE_GoLive",
}

# Alias legacy — red de seguridad si queda alguna referencia antigua
LIST_NAME_ALIASES = {
    "MES2_JULIO_Core_Seguridad": "MES2_JULIO_Core_Seguridad",
    "MES3_AGOSTO_UX_Sensores": "MES3_AGOSTO_UX_Sensores",
}
for _alias, _canonical in LIST_NAME_ALIASES.items():
    if _canonical in LIST_SCHEDULE_BOUNDS:
        LIST_SCHEDULE_BOUNDS[_alias] = LIST_SCHEDULE_BOUNDS[_canonical]
    if _canonical in LIST_PREFERRED_MONTHS:
        LIST_PREFERRED_MONTHS[_alias] = LIST_PREFERRED_MONTHS[_canonical]
    if _canonical in LIST_SPILLOVER:
        LIST_SPILLOVER[_alias] = LIST_SPILLOVER[_canonical]
    if _canonical in LIST_CALENDAR_MONTH:
        LIST_CALENDAR_MONTH[_alias] = LIST_CALENDAR_MONTH[_canonical]

TARGET_LOAD_PCT = 90
TARGET_LOAD_MAX_PCT = 100

# 13 sprints quincenales (Scrum) alineados al calendario del proyecto
SPRINTS = [
    ("S1",  date(2026, 6, 1),  date(2026, 6, 12),  "MES1", "R1", "Kick-off, SOW, levantamiento funcional"),
    ("S2",  date(2026, 6, 15), date(2026, 6, 26),  "MES1", "R1", "Diseno BD, CI/CD, UX research, Design System"),
    ("S3",  date(2026, 6, 29), date(2026, 7, 10),  "MES2", "R2", "Motor C++ core, REST API, JWT, WebSocket"),
    ("S4",  date(2026, 7, 13), date(2026, 7, 24),  "MES2", "R2", "RBAC, Redis, auto-save, JSONB, sensores"),
    ("S5",  date(2026, 7, 27), date(2026, 8, 7),   "MES3", "R3", "Editor TipTap, toolbar, reglas, GIS base"),
    ("S6",  date(2026, 8, 10), date(2026, 8, 21),  "MES3", "R3", "Sensores IoT, NLP, OCR, STT, IA"),
    ("S7",  date(2026, 8, 24), date(2026, 9, 4),   "MES4", "R4", "Exportaciones, integraciones, admin"),
    ("S8",  date(2026, 9, 7),  date(2026, 9, 18),  "MES4", "R4", "Print preview, templates, i18n, offline"),
    ("S9",  date(2026, 9, 21), date(2026, 10, 2),  "MES5", "R5", "Performance, hardening, pentesting"),
    ("S10", date(2026, 10, 5), date(2026, 10, 16), "MES5", "R5", "DRP, SIEM, Docker hardening, IA produccion"),
    ("S11", date(2026, 10, 19), date(2026, 10, 30), "MES5", "R5", "Optimizacion final, model cards, capacity"),
    ("S12", date(2026, 11, 2), date(2026, 11, 13), "MES6", "R6", "Stress test 10K, UAT, marcha blanca"),
    ("S13", date(2026, 11, 16), date(2026, 11, 27), "MES6", "R6", "Correcciones finales, GoLive, produccion"),
]

METODOLOGIA_TIPO = {
    "Capacidad_Recursos": "PMO — Capacidad",
    "PMO_Seguimiento": "PMO — Gobierno",
    "Gestion_Riesgos": "PMO — Riesgos",
    "QA_Transversal": "Agile — QA continuo",
    "DevOps_Infra": "Agile — DevOps",
}

def is_peru_holiday(d):
    if isinstance(d, datetime):
        d = d.date()
    elif not isinstance(d, date):
        d = d.date()
    return d in PERU_NATIONAL_HOLIDAYS_2026

def is_workday(d):
    d = d if isinstance(d, date) else d.date()
    return d.weekday() < 5 and not is_peru_holiday(d)

def next_workday(d):
    d = d if isinstance(d, date) else d.date()
    while not is_workday(d):
        d += timedelta(days=1)
    return d

def prev_workday(d):
    d = d if isinstance(d, date) else d.date()
    while not is_workday(d):
        d -= timedelta(days=1)
    return d

def clamp_workday_on_or_before(d, max_date):
    d = min(d if isinstance(d, date) else d.date(), max_date)
    return prev_workday(d) if not is_workday(d) else d

def add_workdays(start, num_days):
    """Suma dias habiles (num_days >= 1)."""
    d = next_workday(start)
    if num_days <= 1:
        return d
    added = 1
    while added < num_days:
        d += timedelta(days=1)
        if is_workday(d):
            added += 1
    return d

def count_workdays(start, end):
    d = next_workday(start)
    end = end if isinstance(end, date) else end.date()
    n = 0
    while d <= end:
        if is_workday(d):
            n += 1
        d += timedelta(days=1)
    return max(1, n)

def hours_to_workdays(hours, assignee_count=1):
    effective = hours / max(1, assignee_count)
    return max(1, math.ceil(effective / HOURS_PER_WORKDAY))

def month_net_workdays(month_num):
    m_start, m_end = MONTH_BOUNDS[month_num]
    return count_workdays(m_start, m_end)

def build_month_capacity():
    return {m: round(month_net_workdays(m) * HOURS_PER_WORKDAY, 1) for m in range(6, 12)}

def month_capacity_limit(month_num, use_contingency=False):
    cap = MONTH_CAPACITY[month_num]
    return round(cap * CONTINGENCY_FACTOR, 1) if use_contingency else cap

MONTH_CAPACITY = build_month_capacity()
MAX_TOTAL_HOURS = round(sum(MONTH_CAPACITY.values()) * CONTINGENCY_FACTOR, 1)
HOURS_PER_MONTH_CAPACITY = round(sum(MONTH_CAPACITY.values()) / 6, 1)  # promedio referencial

# Recursos con ventana activa acotada
RESOURCE_ACTIVE_MONTHS = {
    "SYS": (7, 8, 9, 10, 11),   # Infra desde mes 2 (julio)
    "FE2": (7, 8, 9, 10, 11),   # Segundo frontend desde mes 2 (julio)
    "QA":  (7, 8, 9, 10, 11),   # QA maximo desde mes 2 (julio)
    "IA":  (7, 8, 9, 10, 11),   # IA desde mes 2 (julio)
}

def active_months_for_resource(code):
    return RESOURCE_ACTIVE_MONTHS.get(code, tuple(range(6, 12)))

def resolve_list_name(list_name):
    return LIST_NAME_ALIASES.get(list_name, list_name)

def resolve_list_bounds(list_name):
    return LIST_SCHEDULE_BOUNDS.get(resolve_list_name(list_name))

def effective_list_bounds(task, allocation=None, dates=None):
    """Ventana de fechas: lista sprint + meses asignados + spillover + deps."""
    list_name = resolve_list_name(task[1])
    if list_name in TRANSVERSAL_LISTS or list_name == "Capacidad_Recursos":
        return PROJECT_START_DATE, PROJECT_END_DATE
    base = resolve_list_bounds(list_name)
    if not base:
        return PROJECT_START_DATE, PROJECT_END_DATE
    lb_start, lb_end = base
    if allocation:
        for m in months_from_allocation(allocation):
            ms, me = MONTH_BOUNDS[m]
            lb_start = min(lb_start, ms)
            lb_end = max(lb_end, me)
    spill = LIST_SPILLOVER.get(list_name, [])
    for m in spill:
        if m in MONTH_BOUNDS:
            _, me = MONTH_BOUNDS[m]
            lb_end = max(lb_end, me)
    if dates is not None:
        dep_start = _dependency_min_start(task, dates)
        if dep_start > lb_start:
            lb_start = min(lb_start, dep_start)
        if dep_start > lb_end:
            lb_end = min(max(lb_end, dep_start), PROJECT_END_DATE)
    return max(lb_start, PROJECT_START_DATE), min(lb_end, PROJECT_END_DATE)

def active_month_avg_pct(code, monthly_load):
    months = active_months_for_resource(code)
    if not months:
        return 0.0
    pcts = [monthly_load[code][m] / MONTH_CAPACITY[m] * 100 for m in months]
    return round(sum(pcts) / len(pcts), 1)

def calendar_month_avg_pct(code, monthly_load):
    pcts = [monthly_load[code][m] / MONTH_CAPACITY[m] * 100 for m in range(6, 12)]
    return round(sum(pcts) / 6, 1)

def capacity_hours_for_resource(code):
    return round(sum(MONTH_CAPACITY[m] for m in active_months_for_resource(code)), 1)

def max_hours_for_resource(code):
    months = active_months_for_resource(code)
    cap = sum(MONTH_CAPACITY[m] for m in months)
    if code in ("QA", "IA"):
        return round(cap, 1)
    return round(cap * CONTINGENCY_FACTOR, 1)

def dt_to_date(val):
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    return val

def project_week_range(week_num):
    """Lunes a viernes de la semana N del proyecto (semana 1 = 1 Jun 2026)."""
    ws = dt_to_date(week_start(week_num))
    we = dt_to_date(week_end(week_num))
    return next_workday(ws), next_workday(we)

def format_clickup_date(d):
    """ISO 8601 — unico formato sin ambiguedad MM/DD vs DD/MM."""
    return d.strftime("%Y-%m-%d")

def parse_assignees(assignees_str):
    return [a.strip() for a in assignees_str.split(",") if a.strip()]

def task_effective_bounds(task):
    """Interseccion ventana de lista + semanas planificadas de la tarea."""
    list_name, sw, ew = task[1], task[8], task[9]
    bounds = LIST_SCHEDULE_BOUNDS.get(list_name, (PROJECT_START_DATE, PROJECT_END_DATE))
    tw_start, _ = project_week_range(sw)
    _, tw_end = project_week_range(ew)
    eff_start = max(bounds[0], dt_to_date(tw_start), PROJECT_START_DATE)
    eff_end = min(bounds[1], dt_to_date(tw_end), PROJECT_END_DATE)
    if eff_start > eff_end:
        eff_start, eff_end = bounds[0], bounds[1]
    return eff_start, eff_end

def list_workdays(m_start, m_end):
    days = []
    d = m_start
    while d <= m_end:
        if is_workday(d):
            days.append(d)
        d += timedelta(days=1)
    return days

def sprint_label_for_range(start, due):
    """Sprint principal o rango Sx-Sy si la tarea cruza sprints."""
    start, due = dt_to_date(start), dt_to_date(due)
    hits = []
    for sid, ss, se, _, _, _ in SPRINTS:
        if start <= se and due >= ss:
            hits.append(sid)
    if not hits:
        best = min(SPRINTS, key=lambda s: abs((s[1] - start).days))
        return best[0]
    if len(hits) == 1:
        return hits[0]
    return f"{hits[0]}-{hits[-1]}"

def sprint_meta(sprint_id):
    sid = sprint_id.split("-")[0]
    for s in SPRINTS:
        if s[0] == sid:
            return s
    return SPRINTS[0]

def metodologia_tipo_for_task(task):
    list_name = task[1]
    if list_name in METODOLOGIA_TIPO:
        return METODOLOGIA_TIPO[list_name]
    if list_name.startswith("MES"):
        return "Agile — Desarrollo por Sprint"
    return "Agile — Entrega funcional"

def distribute_hours_in_range(hours, assignee_count, start, due):
    """Distribuye horas proporcionalmente por mes calendario segun dias habiles."""
    start, due = dt_to_date(start), dt_to_date(due)
    h_each = hours / max(1, assignee_count)
    total_wd = count_workdays(start, due)
    monthly = {m: 0.0 for m in range(6, 12)}
    d = start
    while d <= due:
        if is_workday(d) and 6 <= d.month <= 11:
            monthly[d.month] += h_each / total_wd
        d += timedelta(days=1)
    return monthly

def resource_totals(tasks):
    totals = {c: 0.0 for c in RESOURCES}
    for task in tasks:
        codes = parse_assignees(task[5])
        share = task[15] / max(1, len(codes))
        for c in codes:
            if c in totals:
                totals[c] += share
    return totals

# Reglas para repartir carga entre pares del mismo stream (minimo 1 recurso por tarea)
COASSIGN_RULES = [
    ("BE1", "BE3", ("INTEGRACION", "NOTIF", "WEBHOOK", "LEGACY", "COMUNIC")),
    ("BE1", "BE3", ("SENSOR",)),  # telemetria/IoT — BE3 apoya; DBA queda en BE1
    ("BE1", "BE2", ("SEGURIDAD", "SECURITY", "CRITICO")),
    ("BE2", "BE3", ("INTEGRACION", "API", "WEBHOOK")),
    ("BE3", "BE2", ("SEGURIDAD", "SECURITY")),
    ("SYS", "BE2", ("DEVOPS", "SEGURIDAD", "SEG_INFRA", "BLINDAJE")),
    ("SYS", "BE3", ("INTEGRACION", "DEVOPS")),
    ("SYS", "BE1", ("DEVOPS", "CORE")),  # DBA apoya despliegues de BD
    ("IA", "BE3",  ("INTEGRACION", "API")),
    ("FE1", "FE2", ("UX", "EXPERIENCIA", "EDITOR", "GIS")),
    ("FE2", "FE1", ("CORE", "CRITICO", "EDITOR")),
    ("ARQ", "BE2", ("SEGURIDAD", "ARQUITECTURA", "CRITICO")),
    ("ARQ", "QA",  ("PMO", "DOCUMENTACION", "QA")),
    ("QA", "FE2",  ("UX", "EXPERIENCIA")),
    ("ARQ", "PAF", ("PMO", "DOCUMENTACION", "GERENCIA")),
    ("PAF", "ARQ", ("PMO", "ARQUITECTURA")),
    ("PAF", "QA",  ("PMO", "DOCUMENTACION")),
    ("QA", "PAF",  ("DOCUMENTACION", "PMO")),
    ("BE1", "PAF", ("DOCUMENTACION", "DOC")),
    ("BE3", "PAF", ("DOCUMENTACION", "INTEGRACION")),
]

# Ajustes de horas realistas en ceremonias (evita sobre-estimacion PMO/QA)
HOUR_OVERRIDES = {
    "PMO-002": 33,   # daily 15min x ~130 dias laborables
    "PMO-004": 26,   # comite semanal 1h x 26 semanas
    "ARQ-G02": 26,   # reporte semanal
    "PMO-001": 26,   # sprint planning 2h x 13 sprints
    "PMO-003": 26,   # review+retro 2h x 13 sprints
    "QA-T02": 52,    # regresion 4h x 13 sprints
    "QA-T06": 52,    # triage bugs ~1h/dia laboral en fase activa
}

def apply_hour_overrides(tasks):
    out = []
    for task in tasks:
        t = list(task)
        tid = t[2]
        if tid in HOUR_OVERRIDES:
            t[15] = HOUR_OVERRIDES[tid]
        out.append(tuple(t))
    return out

def _tags_match(tags_str, keywords):
    upper = tags_str.upper()
    return any(k in upper for k in keywords)

def sys_allowed_for_task(task):
    """SYS no participa en tareas cuyo calendario planificado es solo junio (mes 1)."""
    return any(m >= 7 for m in preferred_months_for_task(task))

def fe2_allowed_for_task(task):
    """FE2 (segundo frontend) solo desde julio (mes 2 del proyecto)."""
    return any(m >= 7 for m in preferred_months_for_task(task))

def qa_allowed_for_task(task):
    """QA con carga maxima desde julio (mes 2)."""
    return any(m >= 7 for m in preferred_months_for_task(task))

def ia_allowed_for_task(task):
    """IA solo desde julio (mes 2)."""
    return any(m >= 7 for m in preferred_months_for_task(task))

def pmo_support_task_ids():
    return {
        "ARQ-G02", "ARQ-G03", "ARQ-G04", "ARQ-G07", "ARQ-G08",
        "PMO-001", "PMO-002", "PMO-003", "PMO-004", "PMO-005",
        "QA-T04", "QA-T10", "QA-001", "RSK-003",
    }

def consolidate_pmo_to_paf(tasks):
    """Traslada soporte PMO/documentacion del ARQ y backend al analista funcional PAF."""
    assign_overrides = {
        "ARQ-G02": "PAF,ARQ",
        "ARQ-G03": "PAF",
        "ARQ-G04": "PAF,ARQ",
        "ARQ-G07": "PAF",
        "ARQ-G08": "PAF,ARQ",
        "ARQ-G10": "PAF,ARQ",
        "ARQ-G01": "ARQ,PAF",
        "PMO-001": "ARQ,PAF",
        "PMO-002": "PAF",
        "PMO-003": "ARQ,PAF",
        "PMO-004": "ARQ,PAF",
        "PMO-005": "PAF",
        "QA-T04": "QA,PAF",
        "QA-T10": "QA,PAF",
        "QA-001": "PAF,ARQ",
        "RSK-003": "PAF,ARQ",
        "BE3-I01": "BE3,PAF",
        "FE1-O04": "FE1,PAF",
        "FE1-O06": "FE1,PAF",
    }
    out = []
    for task in tasks:
        t = list(task)
        tid = t[2]
        if tid in assign_overrides:
            t[5] = assign_overrides[tid]
        elif tid == "IA-M01":
            t[5] = "BE1,ARQ"
        out.append(tuple(t))
    return out

def strip_qa_from_june_tasks(tasks):
    out = []
    for task in tasks:
        t = list(task)
        assignees = parse_assignees(t[5])
        if "QA" in assignees and not qa_allowed_for_task(task):
            assignees = [a for a in assignees if a != "QA"]
            if not assignees:
                assignees = ["PAF"] if fe2_allowed_for_task(task) else ["ARQ"]
            t[5] = ",".join(dict.fromkeys(assignees))
        out.append(tuple(t))
    return out

def strip_ia_from_june_tasks(tasks):
    out = []
    for task in tasks:
        t = list(task)
        assignees = parse_assignees(t[5])
        if "IA" in assignees and not ia_allowed_for_task(task):
            assignees = [a for a in assignees if a != "IA"]
            if not assignees:
                assignees = ["BE1"]
            t[5] = ",".join(dict.fromkeys(assignees))
        out.append(tuple(t))
    return out

def boost_qa_ia_active_load(tasks):
    """Incrementa carga QA e IA en meses 2-6 acercandolas al 100% mensual."""
    mutable = [list(t) for t in tasks]
    for _ in range(120):
        totals = resource_totals(mutable)
        qa_cap = max_hours_for_resource("QA")
        ia_cap = max_hours_for_resource("IA")
        need_qa = totals.get("QA", 0) < qa_cap * 0.995
        need_ia = totals.get("IA", 0) < ia_cap * 0.995
        if not need_qa and not need_ia:
            break
        progress = False
        for task in sorted(mutable, key=lambda t: -t[15]):
            assignees = parse_assignees(task[5])
            tags = task[6]
            if need_qa and "QA" not in assignees and qa_allowed_for_task(task):
                if len(assignees) < 3 and _tags_match(
                    tags, ("QA", "CORE", "CRITICO", "EDITOR", "SENSOR", "SEGURIDAD", "UX", "STRESS")
                ):
                    task[5] = task[5] + ",QA"
                    progress = True
                    need_qa = resource_totals(mutable).get("QA", 0) < qa_cap * 0.995
            if need_ia and "IA" not in assignees and ia_allowed_for_task(task):
                if len(assignees) < 3 and _tags_match(
                    tags, ("IA", "INTELIGENCIA", "EDITOR", "SENSOR", "MLOPS", "DATOS", "CORE", "CRITICO")
                ):
                    task[5] = task[5] + ",IA"
                    progress = True
                    need_ia = resource_totals(mutable).get("IA", 0) < ia_cap * 0.995
            if progress:
                break
        if not progress:
            break
    return [tuple(t) for t in mutable]

def boost_paf_load(tasks):
    """Eleva carga del analista funcional PAF en soporte PMO y documentacion."""
    mutable = [list(t) for t in tasks]
    paf_cap = max_hours_for_resource("PAF")
    for _ in range(80):
        if resource_totals(mutable).get("PAF", 0) >= paf_cap * 0.92:
            break
        progress = False
        for task in sorted(mutable, key=lambda t: -t[15]):
            assignees = parse_assignees(task[5])
            if "PAF" in assignees or len(assignees) >= 3:
                continue
            if _tags_match(task[6], ("PMO", "DOCUMENTACION", "GERENCIA", "GESTION")):
                task[5] = task[5] + ",PAF"
                progress = True
                break
            if task[1] in ("PMO_Seguimiento", "Gestion_Riesgos") and "ARQ" in assignees:
                task[5] = task[5] + ",PAF"
                progress = True
                break
        if not progress:
            break
    return [tuple(t) for t in mutable]

COASSIGN_TAGS_FOR = {
    "BE1": ("CORE", "DB", "DATOS", "EDITOR", "SENSOR", "CRITICO"),
    "BE2": ("SEGURIDAD", "SECURITY", "CRITICO", "CORE"),
    "BE3": ("INTEGRACION", "API", "NOTIF", "WEBHOOK", "CORE", "SENSOR", "COMUNIC"),
    "FE1": ("UX", "CORE", "EDITOR", "GIS", "EXPORT", "FRONTEND"),
    "FE2": ("UX", "EXPERIENCIA", "SOPORTE", "OFFLINE", "TABLETS"),
    "ARQ": ("ARQUITECTURA", "PMO", "CRITICO", "DOCUMENTACION"),
    "SYS": ("DEVOPS", "INFRAESTRUCTURA", "SEGURIDAD", "SEG_INFRA"),
    "PAF": ("PMO", "DOCUMENTACION", "GERENCIA", "GESTION", "QA"),
    "QA": ("QA", "PRUEBAS", "CORE", "CRITICO", "STRESS", "UX"),
    "IA": ("IA", "INTELIGENCIA", "MLOPS", "EDITOR", "SENSOR", "DATOS"),
}

def _can_coassign(code, task):
    if _tags_match(task[6], COASSIGN_TAGS_FOR.get(code, ())):
        return True
    grp = RESOURCE_GROUP.get(code)
    return any(RESOURCE_GROUP.get(a) == grp for a in parse_assignees(task[5]))

def find_monthly_floor_gaps(monthly_load, floor_pct=TARGET_LOAD_PCT):
    """Meses activos de cada recurso por debajo del piso (90%)."""
    gaps = []
    for code in RESOURCES:
        for m in active_months_for_resource(code):
            pct = monthly_load[code][m] / MONTH_CAPACITY[m] * 100
            if pct < floor_pct - 0.05:
                gaps.append((code, m, round(floor_pct - pct, 1)))
    gaps.sort(key=lambda x: -x[2])
    return gaps

def find_active_month_floor_gaps(monthly_load, floor_pct=TARGET_LOAD_PCT):
    """Meses activos por debajo del piso (90%), tolerancia 0.5%."""
    gaps = []
    for code in RESOURCES:
        for m in active_months_for_resource(code):
            pct = monthly_load[code][m] / MONTH_CAPACITY[m] * 100
            if pct < floor_pct - 0.5:
                gaps.append((code, m, round(floor_pct - pct, 1)))
    gaps.sort(key=lambda x: -x[2])
    return gaps

def apply_monthly_gap_fix(tasks, code, month_num):
    """Incrementa carga de un recurso en un mes: co-asignacion o mas horas."""
    mutable = [list(t) for t in tasks]
    eligible_fn = lambda t: month_num in eligible_months_for_assignee(
        t, code, _eligible_months(t, allow_spill=True)
    )
    for task in sorted(mutable, key=lambda t: -t[15]):
        assignees = parse_assignees(task[5])
        if code in assignees or len(assignees) >= 3 or not eligible_fn(task):
            continue
        if _can_coassign(code, task):
            task[5] = task[5] + "," + code
            return [tuple(t) for t in mutable]
    for task in mutable:
        assignees = parse_assignees(task[5])
        if code in assignees and eligible_fn(task) and task[15] < 96:
            task[15] = min(96, int(task[15] + 12))
            return [tuple(t) for t in mutable]
    for task in sorted(mutable, key=lambda t: -t[15]):
        assignees = parse_assignees(task[5])
        if code not in assignees or not eligible_fn(task):
            continue
        if task[15] < 96:
            task[15] = min(96, int(task[15] + 8))
            return [tuple(t) for t in mutable]
    return [tuple(t) for t in mutable]

def _floor_task_locked_month(task):
    tid = task[2]
    if not tid.startswith("FLOOR-"):
        return None
    parts = tid.split("-")
    if len(parts) >= 3 and parts[2].startswith("M"):
        try:
            return int(parts[2][1:])
        except ValueError:
            return None
    return None

def inject_monthly_floor_tasks(tasks, monthly_load, floor_pct=TARGET_LOAD_PCT):
    """Anade una tarea de soporte transversal para el mayor hueco mensual bajo el piso."""
    gaps = find_monthly_floor_gaps(monthly_load, floor_pct)
    if not gaps:
        return tasks
    code, m, deficit = gaps[0]
    new_tasks = list(tasks)
    totals = resource_totals(new_tasks)
    floor_titles = {
        "BE1": "Refuerzo modelo datos PostgreSQL/Timescale y APIs core mineras",
        "BE2": "Revision continua OWASP, RBAC y hardening APIs operativas",
        "BE3": "Soporte integraciones legacy, notificaciones y sync offline",
        "FE1": "Refuerzo ReportStudio, accesibilidad industrial y deuda UI",
        "FE2": "Validacion UX en tablet de campo y pruebas con operadores mina",
        "ARQ": "Gobierno arquitectonico, gates de release y alineamiento TI",
        "SYS": "Operaciones DevOps VPS Lima, monitoreo y continuidad 24x7",
        "QA": "Regresion continua, evidencias ISO y pruebas exploratorias",
        "IA": "Validacion modelos ONNX/NLP y calidad de inferencias mineras",
        "PAF": "Actas PMO, documentacion funcional y seguimiento ClickUp",
    }
    current = monthly_load[code][m]
    target = MONTH_CAPACITY[m] * floor_pct / 100
    gap = min(deficit / 100 * MONTH_CAPACITY[m], target - current)
    room = MONTH_CAPACITY[m] - current - 0.5
    gap = min(gap, room)
    if gap < 0.4:
        return tasks
    max_h = max_hours_for_resource(code)
    if totals.get(code, 0) + gap > max_h + 0.5:
        gap = max(0, max_h - totals.get(code, 0) - 2)
    if gap < 0.4:
        return tasks
    mo_label = MONTH_LABELS[m]
    sw, ew = MONTH_WEEK_RANGE[m]
    list_name = MONTH_LIST_NAME[m]
    if code == "PAF":
        list_name = "PMO_Seguimiento"
    prefix = f"FLOOR-{code}-M{m:02d}-"
    seq = sum(1 for t in new_tasks if t[2].startswith(prefix)) + 1
    tid = f"{prefix}{seq:02d}"
    hours = max(2, min(int(round(max(gap, 2))), 36))
    paso = "PASO 1" if m <= 8 else "PASO 2"
    new_tasks.append((
        paso if code != "PAF" else "Gestion PMO",
        list_name,
        tid,
        f"{floor_titles.get(code, 'Soporte transversal')} — {mo_label}",
        f"Actividad transversal planificada para mantener carga mensual >= {floor_pct}% "
        f"en {mo_label} 2026 ({RESOURCE_DISPLAY[code]}). "
        f"Incluye revisiones, soporte cruzado, documentacion y cierre de pendientes del mes.",
        code,
        "PMO,SOPORTE,CAPACIDAD",
        "Normal",
        sw, ew, "R1", "",
        "Baja", "Bajo",
        STREAMS_EARLY.get(code, "Arquitectura"),
        hours,
    ))
    return new_tasks

def scale_underloaded_resource_hours(tasks, floor_pct=TARGET_LOAD_PCT):
    """Sube horas en tareas de recursos con carga total por debajo del piso (conservador)."""
    mutable = [list(t) for t in tasks]
    for _ in range(6):
        totals = resource_totals(mutable)
        progress = False
        for code in RESOURCES:
            cap = max_hours_for_resource(code)
            target = cap * floor_pct / 100
            if totals.get(code, 0) >= target * 0.95:
                continue
            for task in sorted(mutable, key=lambda t: t[15]):
                if code not in parse_assignees(task[5]):
                    continue
                if task[15] < 72:
                    task[15] = min(72, int(task[15] + 4))
                    progress = True
                    break
        if not progress:
            break
    return [tuple(t) for t in mutable]

def boost_all_resources_coassign(tasks):
    """Co-asigna recursos subutilizados a tareas compatibles hasta acercarse al tope."""
    mutable = [list(t) for t in tasks]
    weak_codes = ("BE2", "BE3", "FE1", "FE2", "ARQ", "SYS", "QA", "IA", "PAF")
    for _ in range(200):
        totals = resource_totals(mutable)
        progress = False
        for code in weak_codes:
            cap = max_hours_for_resource(code)
            if totals.get(code, 0) >= cap * 0.98:
                continue
            for task in sorted(mutable, key=lambda t: -t[15]):
                assignees = parse_assignees(task[5])
                if code in assignees or len(assignees) >= 3:
                    continue
                if not _can_coassign(code, task):
                    continue
                if code == "SYS" and not sys_allowed_for_task(task):
                    continue
                if code == "FE2" and not fe2_allowed_for_task(task):
                    continue
                if code == "QA" and not qa_allowed_for_task(task):
                    continue
                if code == "IA" and not ia_allowed_for_task(task):
                    continue
                task[5] = task[5] + "," + code
                progress = True
                break
            if progress:
                break
        if not progress:
            break
    return [tuple(t) for t in mutable]

def run_schedule_with_monthly_floor(tasks, max_rounds=80):
    """Calendariza y corrige iterativamente hasta piso 90% en meses activos."""
    current = tasks
    last = None
    for _ in range(max_rounds):
        try:
            dates, ml, current, allocs = schedule_capacity_constrained(current)
        except RuntimeError:
            break
        last = (dates, ml, current, allocs)
        gaps = find_monthly_floor_gaps(ml)
        if not gaps:
            break
        prev_len = len(current)
        injected = inject_monthly_floor_tasks(current, ml)
        if len(injected) > prev_len:
            current = normalize_resource_active_months(injected)
            continue
        code, month_num, _ = gaps[0]
        fixed = apply_monthly_gap_fix(current, code, month_num)
        if fixed != current:
            current = normalize_resource_active_months(fixed)
            continue
        break
    if last is None:
        dates, ml, current, allocs = schedule_capacity_constrained(tasks)
        last = (dates, ml, current, allocs)
    dates, ml, current, allocs = last
    gaps = find_active_month_floor_gaps(ml)
    if gaps:
        current = scale_underloaded_resource_hours(current)
        current = boost_all_resources_coassign(current)
        current = normalize_resource_hours(current)
        current = normalize_resource_active_months(current)
        dates, ml, current, allocs = schedule_capacity_constrained(current)
    return dates, ml, current, allocs

DBA_TEXT_KEYWORDS = (
    "BASE DE DATOS", "POSTGRES", "QUESTDB", "TIMESCALEDB", "JSONB",
    "PARTICIONES AUTOMATIC", "MULTI-TENANT", "REGISTRO AUTOMATICO DE CAMBIOS",
    "COPIAS DE SEGURIDAD", "BACKUP", "RESTAURAR LA BASE", "REPLICACION",
    "OPTIMIZAR CONSULTAS", "MANTENIMIENTO DE BASE", "DATOS DE PRUEBA",
    "IMPORTACION DE DATOS DESDE", "SINCRONIZACION CONTINUA DE BASE",
    "CATALOGOS DE PERSONAL", "MOTOR DE BUSQUEDA FULL-TEXT", "INDEXACION",
    "PROCESOS AUTOMATICOS DE LIMPIEZA", "MODELOS DE DATOS", "MODELO ERD",
    "DISEÑAR ESQUEMA", "DISENAR ESQUEMA", "SCRIPTS SQL", "TRIGGER",
)

def is_dba_task(task):
    """Tareas de diseno/gestion/integracion de base de datos (responsable: BE1)."""
    tags = consolidate_tags(task[6]).upper()
    tag_parts = {p.strip() for p in tags.split(",")}
    if tag_parts & {"DB", "BASE_DATOS"}:
        return True
    blob = f"{task[3]} {task[4]}".upper()
    return any(k in blob for k in DBA_TEXT_KEYWORDS)

def is_integration_led_task(task):
    """Integraciones/API/mensajeria donde BE3 lidera o co-lidera con BE1."""
    return _tags_match(task[6], ("INTEGRACION", "WEBHOOK", "KAFKA", "API", "NOTIF", "LEGACY", "COMUNIC"))

def consolidate_dba_to_be1(tasks):
    """Centraliza liderazgo DBA en BE1; BE3 conserva integraciones/API en co-desarrollo."""
    out = []
    for task in tasks:
        t = list(task)
        assignees = parse_assignees(t[5])
        if not is_dba_task(task):
            out.append(tuple(t))
            continue
        non_backend = [a for a in assignees if a not in ("BE1", "BE2", "BE3")]
        backends = [a for a in assignees if a in ("BE1", "BE2", "BE3")]
        if is_integration_led_task(task) and "BE3" in backends:
            ordered = ["BE1", "BE3"] + [a for a in backends if a not in ("BE1", "BE3")]
            t[5] = ",".join(dict.fromkeys(ordered + non_backend))
            out.append(tuple(t))
            continue
        if "BE1" not in backends:
            backends = ["BE1" if a == "BE3" else a for a in backends] if backends else ["BE1"]
            if "BE1" not in backends:
                backends = ["BE1"] + backends
        else:
            backends = [a for a in backends if a != "BE3"]
        t[5] = ",".join(dict.fromkeys(["BE1"] + [a for a in backends if a != "BE1"] + non_backend))
        out.append(tuple(t))
    return out

def strip_sys_from_early_tasks(tasks):
    """Quita SYS de tareas planificadas solo en junio (mes 1)."""
    out = []
    for task in tasks:
        t = list(task)
        assignees = parse_assignees(t[5])
        if "SYS" in assignees and not sys_allowed_for_task(task):
            assignees = [a for a in assignees if a != "SYS"]
            t[5] = ",".join(assignees) if assignees else "BE3"
        out.append(tuple(t))
    return out

def rebalance_backend_after_dba(tasks):
    """Equilibra BE1 (DBA) y BE3 (integraciones): mueve integraciones puras a BE3."""
    mutable = [list(t) for t in tasks]
    for _ in range(80):
        totals = resource_totals(mutable)
        be1, be3 = totals.get("BE1", 0), totals.get("BE3", 0)
        if be1 <= MAX_TOTAL_HOURS + 0.5 and be3 >= MAX_TOTAL_HOURS * 0.82:
            break
        moved = False
        for task in sorted(mutable, key=lambda t: -t[15]):
            assignees = parse_assignees(task[5])
            if is_dba_task(task):
                continue
            if be1 > MAX_TOTAL_HOURS and "BE1" in assignees and is_integration_led_task(task):
                if len(assignees) == 1:
                    task[5] = "BE3"
                elif "BE3" in assignees:
                    task[5] = ",".join(a for a in assignees if a != "BE1")
                else:
                    task[5] = ",".join("BE3" if a == "BE1" else a for a in assignees)
                moved = True
            elif (
                be3 < MAX_TOTAL_HOURS * 0.82
                and "BE1" in assignees
                and "BE3" not in assignees
                and is_integration_led_task(task)
            ):
                task[5] = "BE3" if len(assignees) == 1 else ",".join(
                    a for a in assignees if a != "BE1"
                )
                moved = True
            if moved:
                break
        if not moved:
            break
    return [tuple(t) for t in mutable]

def rebalance_frontend_coverage(tasks):
    """FE1 cubre junio solo; FE2 desde julio — reparte tareas FE si uno esta muy bajo."""
    mutable = [list(t) for t in tasks]
    for _ in range(40):
        totals = resource_totals(mutable)
        fe1, fe2 = totals.get("FE1", 0), totals.get("FE2", 0)
        fe2_cap = max_hours_for_resource("FE2")
        if fe1 >= MAX_TOTAL_HOURS * 0.88 and fe2 >= fe2_cap * 0.88:
            break
        progress = False
        for task in sorted(mutable, key=lambda t: -t[15]):
            assignees = parse_assignees(task[5])
            tags = task[6]
            if fe2 < fe2_cap * 0.85 and "FE1" in assignees and "FE2" not in assignees:
                if fe2_allowed_for_task(task) and _tags_match(tags, ("UX", "EXPERIENCIA", "SOPORTE", "EDITOR")):
                    task[5] = task[5] + ",FE2"
                    progress = True
            elif fe1 < MAX_TOTAL_HOURS * 0.85 and "FE2" in assignees and "FE1" not in assignees:
                if _tags_match(tags, ("UX", "CORE", "EDITOR", "GIS")):
                    task[5] = "FE1," + task[5]
                    progress = True
            if progress:
                break
        if not progress:
            break
    return [tuple(t) for t in mutable]

def strip_fe2_from_june_tasks(tasks):
    """FE2 no trabaja en junio (mes 1): redistribuye a FE1."""
    out = []
    for task in tasks:
        t = list(task)
        assignees = parse_assignees(t[5])
        if "FE2" in assignees and not fe2_allowed_for_task(task):
            assignees = [a for a in assignees if a != "FE2"]
            if not assignees:
                assignees = ["FE1"]
            elif "FE1" not in assignees:
                assignees = ["FE1"] + assignees
            t[5] = ",".join(dict.fromkeys(assignees))
        out.append(tuple(t))
    return out

def rebalance_assignments(tasks):
    """Agrega co-asignados donde el stream lo permite para no superar 960h totales."""
    mutable = [list(t) for t in tasks]
    for _ in range(300):
        totals = resource_totals(mutable)
        overloaded = [c for c, h in totals.items() if h > MAX_TOTAL_HOURS + 0.5]
        if not overloaded:
            break
        progress = False
        for src in sorted(overloaded, key=lambda c: -totals[c]):
            for task in sorted(mutable, key=lambda t: -t[15]):
                assignees = parse_assignees(task[5])
                if src not in assignees or len(assignees) >= 3:
                    continue
                tags = task[6]
                for rule_src, tgt, keywords in COASSIGN_RULES:
                    if rule_src != src:
                        continue
                    if tgt in assignees:
                        continue
                    if tgt == "SYS" and not sys_allowed_for_task(task):
                        continue
                    if tgt == "FE2" and not fe2_allowed_for_task(task):
                        continue
                    if tgt == "QA" and not qa_allowed_for_task(task):
                        continue
                    if tgt == "IA" and not ia_allowed_for_task(task):
                        continue
                    if tgt == "BE3" and is_dba_task(task) and not is_integration_led_task(task):
                        continue
                    if totals.get(tgt, 0) >= max_hours_for_resource(tgt) - 4:
                        continue
                    if totals.get(tgt, 0) >= MAX_TOTAL_HOURS - 4:
                        continue
                    if not _tags_match(tags, keywords):
                        continue
                    share_if_added = task[15] / (len(assignees) + 1)
                    if totals[src] - share_if_added < totals[src] - task[15] / len(assignees):
                        pass
                    new_assignees = assignees + [tgt]
                    task[5] = ",".join(new_assignees)
                    totals = resource_totals(mutable)
                    progress = True
                    if totals[src] <= MAX_TOTAL_HOURS + 0.5:
                        break
                if totals.get(src, 0) <= MAX_TOTAL_HOURS + 0.5:
                    break
            if progress:
                break
        if not progress:
            break
    return [tuple(t) for t in mutable]

def normalize_resource_hours(tasks):
    """Reduce horas de forma proporcional si un recurso aun supera 960h totales."""
    mutable = [list(t) for t in tasks]
    for _ in range(8):
        totals = resource_totals(mutable)
        over = {c: h for c, h in totals.items() if h > MAX_TOTAL_HOURS + 0.5}
        if not over:
            break
        for code, total in over.items():
            factor = MAX_TOTAL_HOURS / total
            for task in mutable:
                assignees = parse_assignees(task[5])
                if code not in assignees:
                    continue
                if len(assignees) == 1:
                    task[15] = max(4, int(round(task[15] * factor)))
                else:
                    task[15] = max(4, int(round(task[15] * (1 - (1 - factor) / len(assignees)))))
    return [tuple(t) for t in mutable]

def normalize_resource_active_months(tasks):
    """Recorta horas si un recurso supera la capacidad de sus meses activos (SYS desde julio)."""
    mutable = [list(t) for t in tasks]
    for _ in range(10):
        totals = resource_totals(mutable)
        over = {
            code: totals[code]
            for code in RESOURCES
            if totals.get(code, 0) > max_hours_for_resource(code) + 0.5
        }
        if not over:
            break
        for code, total in over.items():
            factor = max_hours_for_resource(code) / total
            for task in mutable:
                assignees = parse_assignees(task[5])
                if code not in assignees:
                    continue
                n = len(assignees)
                if n == 1:
                    task[15] = max(4, int(round(task[15] * factor)))
                else:
                    task[15] = max(4, int(round(task[15] * (1 - (1 - factor) / n))))
    return [tuple(t) for t in mutable]

def topological_sort_tasks(tasks):
    task_map = {t[2]: t for t in tasks}
    ids = set(task_map)
    deps = {
        t[2]: [d.strip() for d in (t[11] or "").split(",") if d.strip() in ids]
        for t in tasks
    }
    in_deg = {tid: len(deps[tid]) for tid in ids}
    queue = sorted(tid for tid in ids if in_deg[tid] == 0)
    ordered = []
    while queue:
        tid = queue.pop(0)
        ordered.append(task_map[tid])
        for t in tasks:
            if tid in deps[t[2]]:
                in_deg[t[2]] -= 1
                if in_deg[t[2]] == 0:
                    queue.append(t[2])
                    queue.sort()
    for t in tasks:
        if t not in ordered:
            ordered.append(t)
    return ordered

def task_scheduling_window(task):
    sw, ew = task[8], task[9]
    p_start, _ = project_week_range(sw)
    _, p_end = project_week_range(ew)
    p_start = max(dt_to_date(p_start), PROJECT_START_DATE)
    p_end = min(dt_to_date(p_end), PROJECT_END_DATE)
    if task[1] in TRANSVERSAL_LISTS:
        return PROJECT_START_DATE, PROJECT_END_DATE
    spill = min(p_end + timedelta(weeks=8), PROJECT_END_DATE)
    return next_workday(p_start), next_workday(spill)

def _monthly_delta(start, due, task):
    return distribute_hours_in_range(task[15], len(parse_assignees(task[5])), start, due)

def _fits_capacity(start, due, task, monthly_load):
    assignees = parse_assignees(task[5])
    delta = _monthly_delta(start, due, task)
    for code in assignees:
        if code not in monthly_load:
            continue
        for m, h in delta.items():
            if monthly_load[code][m] + h > MONTH_CAPACITY[m] + 0.01:
                return False
    return True

def _apply_capacity(start, due, task, monthly_load):
    assignees = parse_assignees(task[5])
    delta = _monthly_delta(start, due, task)
    for code in assignees:
        if code not in monthly_load:
            continue
        for m, h in delta.items():
            monthly_load[code][m] += h

def preferred_months_for_task(task):
    if task[1] in LIST_PREFERRED_MONTHS:
        return LIST_PREFERRED_MONTHS[task[1]]
    sw, ew = task[8], task[9]
    p_start, _ = project_week_range(sw)
    _, p_end = project_week_range(ew)
    d = max(dt_to_date(p_start), PROJECT_START_DATE)
    end = min(dt_to_date(p_end), PROJECT_END_DATE)
    months = []
    while d <= end:
        if 6 <= d.month <= 11 and d.month not in months:
            months.append(d.month)
        d += timedelta(days=1)
    return months if months else list(range(6, 12))

def _eligible_months(task, allow_spill=False):
    """Meses donde puede cargarse la tarea segun semanas planificadas (no todo el proyecto)."""
    locked = _floor_task_locked_month(task)
    if locked is not None:
        return [locked]
    prefs = preferred_months_for_task(task)
    if task[1] in LIST_PREFERRED_MONTHS:
        eligible = list(LIST_PREFERRED_MONTHS[task[1]])
        if allow_spill:
            for m in LIST_SPILLOVER.get(task[1], []):
                if m not in eligible:
                    eligible.append(m)
            for m in range(6, 12):
                if m not in eligible:
                    eligible.append(m)
        return eligible if eligible else list(range(6, 12))
    seen = set()
    ordered = []
    spill = ([m for m in range(6, 12) if m not in prefs] if allow_spill else [])
    for m in prefs + spill:
        if m not in seen:
            seen.add(m)
            ordered.append(m)
    return ordered if ordered else list(range(6, 12))

def dates_for_scheduled_task(task, allocation, dep_start):
    """Fechas Gantt: transversales por semanas planificadas; MES por ventana mensual + semanas."""
    list_name = task[1]
    sw, ew = task[8], task[9]
    tw_start, _ = project_week_range(sw)
    _, tw_end = project_week_range(ew)
    tw_start = max(dt_to_date(tw_start), PROJECT_START_DATE)
    tw_end = min(dt_to_date(tw_end), PROJECT_END_DATE)

    if list_name in TRANSVERSAL_LISTS:
        start = max(tw_start, dep_start)
        due = tw_end
        start = next_workday(start)
        due = next_workday(due)
        if start > due:
            n_days = hours_to_workdays(task[15], len(parse_assignees(task[5])))
            due = min(add_workdays(start, n_days), PROJECT_END_DATE)
            due = next_workday(due)
        return start, due

    lb_start, lb_end = LIST_SCHEDULE_BOUNDS.get(list_name, (PROJECT_START_DATE, PROJECT_END_DATE))
    start = max(lb_start, tw_start, dep_start)
    due = min(lb_end, tw_end)
    start = next_workday(start)
    due = next_workday(due)
    if start > due:
        n_days = hours_to_workdays(task[15], len(parse_assignees(task[5])))
        due = min(add_workdays(start, n_days), lb_end)
        due = next_workday(due)
    if start > due:
        start = next_workday(lb_start)
        due = next_workday(lb_end)
    return start, min(due, PROJECT_END_DATE)

def enforce_dependency_dates(tasks, dates):
    """Asegura que ninguna tarea inicia antes de que terminen sus dependencias."""
    mutable = dict(dates)
    for _ in range(len(tasks) + 2):
        changed = False
        for t in topological_sort_tasks(tasks):
            tid = t[2]
            dep_str = (t[11] or "").strip()
            if not dep_str:
                continue
            dep_ids = [d.strip() for d in dep_str.split(",") if d.strip() in mutable]
            if not dep_ids:
                continue
            req = add_workdays(max(mutable[d][1] for d in dep_ids), 1)
            s, d = mutable[tid]
            if s >= req:
                continue
            n_days = hours_to_workdays(t[15], len(parse_assignees(t[5])))
            list_name = t[1]
            cap_end = PROJECT_END_DATE
            if list_name in LIST_SCHEDULE_BOUNDS and list_name not in TRANSVERSAL_LISTS:
                cap_end = LIST_SCHEDULE_BOUNDS[list_name][1]
            elif list_name in TRANSVERSAL_LISTS:
                _, tw_end = project_week_range(t[9])
                cap_end = min(dt_to_date(tw_end), PROJECT_END_DATE)
            new_start = next_workday(min(req, cap_end))
            new_due = add_workdays(new_start, n_days)
            new_due = next_workday(min(new_due, PROJECT_END_DATE))
            if list_name in LIST_SCHEDULE_BOUNDS and list_name not in TRANSVERSAL_LISTS:
                if new_due > LIST_SCHEDULE_BOUNDS[list_name][1]:
                    new_due = min(new_due, PROJECT_END_DATE)
            new_due = next_workday(max(new_start, new_due))
            mutable[tid] = (new_start, new_due)
            changed = True
        if not changed:
            break
    return mutable

def eligible_months_for_assignee(task, code, eligible):
    """SYS y FE2 solo desde julio (mes 2)."""
    months = list(eligible)
    if code == "SYS":
        months = [m for m in months if m >= 7]
        if not months:
            months = [m for m in preferred_months_for_task(task) if m >= 7]
        if not months:
            months = list(range(7, 12))
    elif code == "FE2":
        months = [m for m in months if m >= 7]
        if not months:
            months = [m for m in preferred_months_for_task(task) if m >= 7]
        if not months:
            months = list(range(7, 12))
    elif code in ("QA", "IA"):
        months = [m for m in months if m >= 7]
        if not months:
            months = [m for m in preferred_months_for_task(task) if m >= 7]
        if not months:
            months = list(range(7, 12))
    return months

def _allocate_hours_to_eligible(task, monthly_load, eligible):
    """Reparte horas priorizando meses bajo 90% antes de llenar el resto."""
    assignees = parse_assignees(task[5])
    snapshot = {c: dict(v) for c, v in monthly_load.items()}
    h_each = task[15] / len(assignees)
    allocation = {code: {m: 0.0 for m in range(6, 12)} for code in assignees}
    floor_h = {m: MONTH_CAPACITY[m] * TARGET_LOAD_PCT / 100 for m in range(6, 12)}

    for code in assignees:
        left = h_each
        code_eligible = eligible_months_for_assignee(task, code, eligible)
        guard = 0
        while left > 0.01 and guard < 120:
            guard += 1
            open_months = [
                m for m in code_eligible
                if MONTH_CAPACITY[m] - monthly_load[code][m] > 0.01
            ]
            if not open_months:
                break
            open_months.sort(
                key=lambda m: (monthly_load[code][m] / MONTH_CAPACITY[m], m)
            )
            placed = 0.0
            for m in open_months:
                if left <= 0.01:
                    break
                cap = MONTH_CAPACITY[m] - monthly_load[code][m]
                gap_to_floor = max(0.0, floor_h[m] - monthly_load[code][m])
                take = min(left, cap, gap_to_floor if gap_to_floor > 0.01 else cap)
                if take > 0.01:
                    allocation[code][m] += take
                    monthly_load[code][m] += take
                    placed += take
                    left -= take
            if placed <= 0.01:
                m = open_months[0]
                cap = MONTH_CAPACITY[m] - monthly_load[code][m]
                take = min(left, cap)
                if take <= 0.01:
                    break
                allocation[code][m] += take
                monthly_load[code][m] += take
                left -= take
        if left > 0.01:
            for c in monthly_load:
                monthly_load[c] = dict(snapshot[c])
            return None
    return allocation

def allocate_task_to_months(task, monthly_load):
    """Reparte horas en meses calendario sin superar capacidad mensual (100%)."""
    for allow_spill in (False, True):
        eligible = _eligible_months(task, allow_spill=allow_spill)
        result = _allocate_hours_to_eligible(task, monthly_load, eligible)
        if result is not None:
            return result
    return None

def dates_from_month_allocation(allocation, dep_start, list_name=None):
    months_used = set()
    for code in allocation:
        for m, h in allocation[code].items():
            if h > 0.01:
                months_used.add(m)
    if not months_used:
        return PROJECT_START_DATE, PROJECT_END_DATE

    if list_name and list_name in LIST_SCHEDULE_BOUNDS and list_name not in TRANSVERSAL_LISTS:
        lb_start, lb_end = LIST_SCHEDULE_BOUNDS[list_name]
        months_in_window = [
            m for m in months_used
            if MONTH_BOUNDS[m][0] <= lb_end and MONTH_BOUNDS[m][1] >= lb_start
        ]
        if months_in_window:
            months_used = set(months_in_window)
        m_min, m_max = min(months_used), max(months_used)
        start = max(MONTH_BOUNDS[m_min][0], lb_start, dep_start)
        due = min(MONTH_BOUNDS[m_max][1], lb_end)
    else:
        m_min, m_max = min(months_used), max(months_used)
        start = max(MONTH_BOUNDS[m_min][0], dep_start)
        due = MONTH_BOUNDS[m_max][1]

    start = next_workday(start)
    due = next_workday(min(due, PROJECT_END_DATE))
    if start > due:
        due = add_workdays(start, max(1, hours_to_workdays(
            sum(h for code in allocation for h in allocation[code].values()),
            len(allocation),
        )))
        due = min(due, PROJECT_END_DATE)
        if list_name in LIST_SCHEDULE_BOUNDS and list_name not in TRANSVERSAL_LISTS:
            due = min(due, LIST_SCHEDULE_BOUNDS[list_name][1])
    return start, due

def months_from_allocation(allocation):
    months = set()
    for code in allocation:
        for m, h in allocation[code].items():
            if h > 0.01:
                months.add(m)
    return months

def dependency_start(tid, tasks, dates):
    task_map = {t[2]: t for t in tasks}
    dep_start = PROJECT_START_DATE
    dep_str = (task_map[tid][11] or "").strip()
    if dep_str:
        dep_ids = [d.strip() for d in dep_str.split(",") if d.strip() in dates]
        if dep_ids:
            dep_start = add_workdays(max(dates[d][1] for d in dep_ids), 1)
    return dep_start

def dates_from_allocation_and_task(task, allocation, dep_start=None):
    """Fechas Gantt alineadas a meses donde se cargaron horas (max 8.5h/dia promedio)."""
    list_name = task[1]
    months_used = months_from_allocation(allocation)
    if not months_used:
        return dates_for_scheduled_task(task, allocation, dep_start or PROJECT_START_DATE)

    m_min, m_max = min(months_used), max(months_used)
    assignees = parse_assignees(task[5])
    h_each = task[15] / max(1, len(assignees))
    min_wd = hours_to_workdays(h_each, 1)

    lb_start, lb_end = effective_list_bounds(task, allocation)

    start = max(MONTH_BOUNDS[m_min][0], lb_start, PROJECT_START_DATE)
    due = min(MONTH_BOUNDS[m_max][1], lb_end, PROJECT_END_DATE)

    start = next_workday(start)
    due = next_workday(min(due, PROJECT_END_DATE))

    if "SYS" in assignees and start < date(2026, 7, 1):
        start = next_workday(date(2026, 7, 1))
    if "FE2" in assignees and start < date(2026, 7, 1):
        start = next_workday(date(2026, 7, 1))
    if "QA" in assignees and start < date(2026, 7, 1):
        start = next_workday(date(2026, 7, 1))
    if "IA" in assignees and start < date(2026, 7, 1):
        start = next_workday(date(2026, 7, 1))

    if count_workdays(start, due) < min_wd:
        due = add_workdays(start, min_wd)
        due = min(next_workday(due), PROJECT_END_DATE)

    if start > due:
        start = next_workday(max(lb_start, PROJECT_START_DATE))
        due = add_workdays(start, min_wd)
        due = min(next_workday(due), PROJECT_END_DATE)

    return start, min(due, PROJECT_END_DATE)

def finalize_task_dates(tasks, dates, allocations):
    """Alinea fechas Gantt al rango mensual donde se asignaron horas (coherente con carga 8.5h/dia)."""
    mutable = {}
    for task in tasks:
        tid = task[2]
        alloc = allocations.get(tid)
        if not alloc:
            mutable[tid] = dates.get(tid, (PROJECT_START_DATE, PROJECT_END_DATE))
            continue
        start, due = dates_from_allocation_and_task(task, alloc)
        mutable[tid] = (start, min(due, PROJECT_END_DATE))
    return align_dates_for_clickup_import(tasks, mutable, allocations)

def schedule_capacity_constrained(tasks):
    """Programacion estricta: horas repartidas en meses calendario, max 100% mensual (8.5h/dia)."""
    monthly_load = {c: {m: 0.0 for m in range(6, 12)} for c in RESOURCES}
    dates = {}
    allocations = {}
    mutable_tasks = {t[2]: list(t) for t in tasks}

    for task in scheduling_order([tuple(mutable_tasks[tid]) for tid in mutable_tasks]):
        tid = task[2]
        dep_start = dependency_start(tid, [tuple(mutable_tasks[x]) for x in mutable_tasks], dates)

        current = tuple(mutable_tasks[tid])
        allocation = allocate_task_to_months(current, monthly_load)
        attempts = 0
        while allocation is None and attempts < 50:
            attempts += 1
            relief = try_relieve_task(current)
            if relief:
                mutable_tasks[tid] = list(relief)
                current = relief
            else:
                co = try_coassign_for_task(current)
                if co:
                    mutable_tasks[tid] = list(co)
                    current = co
                else:
                    mutable_tasks[tid][15] = max(4, int(mutable_tasks[tid][15] * 0.88))
                    current = tuple(mutable_tasks[tid])
            allocation = allocate_task_to_months(current, monthly_load)

        if allocation is None:
            raise RuntimeError(f"No se pudo calendarizar {tid} sin superar 100% mensual")

        allocations[tid] = allocation
        start, due = dates_from_allocation_and_task(current, allocation, dep_start)
        dates[tid] = (start, min(due, PROJECT_END_DATE))

    final_tasks = [tuple(mutable_tasks[t[2]]) for t in tasks]
    return dates, monthly_load, final_tasks, allocations

def validate_monthly_load(monthly_load):
    violations = []
    for code in RESOURCES:
        for m in range(6, 12):
            h = monthly_load[code][m]
            pct = h / MONTH_CAPACITY[m] * 100
            if pct > TARGET_LOAD_MAX_PCT + 0.1:
                violations.append((code, MONTH_LABELS[m], round(pct, 1), round(h, 1)))
            if code == "SYS" and m < 7 and h > 0.01:
                violations.append((code, MONTH_LABELS[m], round(pct, 1), round(h, 1)))
            if code == "FE2" and m < 7 and h > 0.01:
                violations.append((code, MONTH_LABELS[m], round(pct, 1), round(h, 1)))
            if code == "QA" and m < 7 and h > 0.01:
                violations.append((code, MONTH_LABELS[m], round(pct, 1), round(h, 1)))
            if code == "IA" and m < 7 and h > 0.01:
                violations.append((code, MONTH_LABELS[m], round(pct, 1), round(h, 1)))
    return violations

def _task_min_duration(task):
    return max(1, hours_to_workdays(task[15], max(1, len(parse_assignees(task[5])))))

def _dependency_min_start(task, mutable):
    dep_str = (task[11] or "").strip()
    if not dep_str:
        return PROJECT_START_DATE
    min_start = PROJECT_START_DATE
    for did in dep_str.split(","):
        did = did.strip()
        if did in mutable:
            _, dep_due = mutable[did]
            ms = add_workdays(dep_due, 1)
            if ms > min_start:
                min_start = ms
    return min_start

def _clamp_to_list_window(task, start, due, allocation=None, dates=None):
    list_name = resolve_list_name(task[1])
    dur = _task_min_duration(task)
    if list_name in TRANSVERSAL_LISTS or list_name == "Capacidad_Recursos":
        start = max(start, PROJECT_START_DATE)
        due = min(due, PROJECT_END_DATE)
        if start > due:
            due = min(add_workdays(start, dur), PROJECT_END_DATE)
        return next_workday(start), next_workday(min(due, PROJECT_END_DATE))
    lb_start, lb_end = effective_list_bounds(task, allocation, dates)
    start = max(start, lb_start, PROJECT_START_DATE)
    due = min(due, lb_end, PROJECT_END_DATE)
    if start > lb_end:
        start = next_workday(lb_start)
    if count_workdays(start, due) < dur:
        due = min(add_workdays(start, dur), lb_end, PROJECT_END_DATE)
    if start > due:
        start = next_workday(lb_start)
        due = min(add_workdays(start, dur), lb_end, PROJECT_END_DATE)
    due = clamp_workday_on_or_before(due, min(lb_end, PROJECT_END_DATE))
    start = next_workday(max(start, lb_start))
    if due < start:
        due = min(add_workdays(start, 1), clamp_workday_on_or_before(lb_end, PROJECT_END_DATE))
    return start, due

def align_dates_for_clickup_import(tasks, dates, allocations=None):
    """Converge dependencias, ventana de lista, duracion minima y dias laborables Peru."""
    allocations = allocations or {}
    mutable = {k: (v[0], v[1]) for k, v in dates.items()}
    task_map = {t[2]: t for t in tasks}
    ordered = [t[2] for t in topological_sort_tasks(tasks)]

    for _ in range(120):
        changed = False
        for tid in ordered:
            task = task_map.get(tid)
            if not task or tid not in mutable:
                continue
            alloc = allocations.get(tid)
            start, due = mutable[tid]
            min_start = _dependency_min_start(task, mutable)
            if start < min_start:
                dur = max(count_workdays(start, due), _task_min_duration(task))
                start = next_workday(min_start)
                due = add_workdays(start, dur)
                changed = True
            ns, nd = _clamp_to_list_window(task, start, due, alloc, mutable)
            if (ns, nd) != (start, due):
                start, due = ns, nd
                changed = True
            min_start = _dependency_min_start(task, mutable)
            if start < min_start:
                dur = max(count_workdays(start, due), _task_min_duration(task))
                start = next_workday(min_start)
                due = add_workdays(start, dur)
                start, due = _clamp_to_list_window(task, start, due, alloc, mutable)
                changed = True
            start = next_workday(start)
            due = next_workday(min(due, PROJECT_END_DATE))
            if due < start:
                due = add_workdays(start, 1)
            final = (start, min(due, PROJECT_END_DATE))
            if mutable[tid] != final:
                mutable[tid] = final
                changed = True
        if not changed:
            break
    return mutable

def import_sequence_order(tasks):
    """Orden topologico para importacion (predecesores antes que sucesores)."""
    return [t[2] for t in topological_sort_tasks(tasks)]

def validate_project_integrity(tasks, task_dates, monthly_load, allocations=None):
    """Verificacion integral: IDs, dependencias, fechas, secuencia y carga."""
    allocations = allocations or {}
    report = {
        "ok": True,
        "errors": [],
        "warnings": [],
        "stats": {},
    }
    ids = [t[2] for t in tasks]
    idset = set(ids)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        report["ok"] = False
        report["errors"].append(f"IDs duplicados: {dupes[:5]}")

    missing_deps = []
    for t in tasks:
        dep_str = (t[11] or "").strip()
        if not dep_str:
            continue
        for d in dep_str.split(","):
            d = d.strip()
            if d and d not in idset:
                missing_deps.append(f"{t[2]} -> {d}")
    if missing_deps:
        report["ok"] = False
        report["errors"].append(f"Dependencias rotas: {len(missing_deps)}")
        report["errors"].extend(missing_deps[:8])

    no_assignee = [t[2] for t in tasks if not parse_assignees(t[5])]
    if no_assignee:
        report["ok"] = False
        report["errors"].append(f"Tareas sin asignado: {no_assignee[:5]}")

    date_errors = dep_violations = out_bounds = 0
    for t in tasks:
        tid = t[2]
        start, due = task_dates.get(tid, (None, None))
        if not start or not due:
            date_errors += 1
            continue
        if start > due:
            report["ok"] = False
            report["errors"].append(f"{tid}: start > due ({start} > {due})")
        if start < PROJECT_START_DATE or due > PROJECT_END_DATE:
            out_bounds += 1
        list_name = resolve_list_name(t[1])
        if list_name not in TRANSVERSAL_LISTS and list_name in LIST_SCHEDULE_BOUNDS:
            lb_start, lb_end = effective_list_bounds(t, allocations.get(tid), task_dates)
            if start < lb_start or due > lb_end:
                date_errors += 1
        if not is_workday(start) or not is_workday(due):
            date_errors += 1
        dep_str = (t[11] or "").strip()
        if dep_str:
            for did in dep_str.split(","):
                did = did.strip()
                if did in task_dates:
                    _, dep_due = task_dates[did]
                    if start < add_workdays(dep_due, 1):
                        dep_violations += 1

    if date_errors:
        report["ok"] = False
        report["errors"].append(f"Fechas fuera de ventana de lista: {date_errors} tareas")
    if dep_violations:
        report["ok"] = False
        report["errors"].append(f"Violaciones secuencia dependencias: {dep_violations}")

    load_v = validate_monthly_load(monthly_load)
    if load_v:
        report["ok"] = False
        report["errors"].append(f"Carga mensual >100%: {len(load_v)} casos")

    totals = resource_totals([t for t in tasks if not str(t[2]).startswith("CAP-")])
    under = []
    over = []
    active_floor_gaps = find_active_month_floor_gaps(monthly_load)
    for code, h in totals.items():
        avg_active = active_month_avg_pct(code, monthly_load)
        if avg_active < TARGET_LOAD_PCT - 0.5:
            under.append((code, avg_active))
        if h > max_hours_for_resource(code) + 1:
            over.append((code, round(h, 1)))
    if active_floor_gaps:
        report["ok"] = False
        report["errors"].append(
            f"Meses activos bajo {TARGET_LOAD_PCT}%: {len(active_floor_gaps)} casos"
        )
        for code, m, deficit in active_floor_gaps[:8]:
            report["errors"].append(
                f"  {RESOURCE_DISPLAY.get(code, code)}/{MONTH_LABELS[m]}: "
                f"faltan {deficit}% para piso"
            )
    if over:
        report["warnings"].append(f"Recursos sobre objetivo 95%: {over}")
    if under and not active_floor_gaps:
        report["warnings"].append(f"Recursos bajo meta promedio activos {TARGET_LOAD_PCT}%: {under}")

    report["stats"] = {
        "tasks": len(tasks),
        "dated": sum(1 for t in tasks if task_dates.get(t[2])),
        "load_violations": len(load_v),
        "date_window_errors": date_errors,
        "dep_violations": dep_violations,
        "team_avg_pct": round(
            sum(active_month_avg_pct(c, monthly_load) for c in RESOURCES) / len(RESOURCES), 1),
    }
    return report

def scheduling_order(tasks):
    ordered = topological_sort_tasks(tasks)
    trans = [t for t in ordered if t[1] in TRANSVERSAL_LISTS]
    rest = [t for t in ordered if t[1] not in TRANSVERSAL_LISTS]
    return trans + rest

def try_relieve_task(task):
    """Quita co-asignados auxiliares cuando la tarea no cabe en el calendario."""
    mutable = list(task)
    assignees = parse_assignees(mutable[5])
    for drop in ("BE1", "BE2", "BE3"):
        if drop in assignees and len(assignees) > 1:
            mutable[5] = ",".join(a for a in assignees if a != drop)
            return tuple(mutable)
    if len(assignees) > 2:
        mutable[5] = ",".join(assignees[:2])
        return tuple(mutable)
    return None

def try_coassign_for_task(task):
    """Agrega co-asignado del mismo stream o reglas definidas (max 3 recursos)."""
    mutable = list(task)
    assignees = parse_assignees(mutable[5])
    if len(assignees) >= 3:
        return None
    tags = mutable[6]
    candidates = []
    for src in assignees:
        for rule_src, tgt, keywords in COASSIGN_RULES:
            if rule_src == src and tgt not in assignees and _tags_match(tags, keywords):
                if tgt == "SYS" and not sys_allowed_for_task(task):
                    continue
                if tgt == "FE2" and not fe2_allowed_for_task(task):
                    continue
                if tgt == "QA" and not qa_allowed_for_task(task):
                    continue
                if tgt == "IA" and not ia_allowed_for_task(task):
                    continue
                if tgt == "BE3" and is_dba_task(task) and not is_integration_led_task(task):
                    continue
                candidates.append(tgt)
        grp = RESOURCE_GROUP.get(src)
        for code in RESOURCES:
            if code not in assignees and RESOURCE_GROUP.get(code) == grp:
                candidates.append(code)
    seen = set()
    for tgt in candidates:
        if tgt in seen or tgt in assignees:
            continue
        seen.add(tgt)
        cap = max_hours_for_resource(tgt) if tgt in RESOURCE_ACTIVE_MONTHS else MAX_TOTAL_HOURS
        if resource_totals([task]).get(tgt, 0) >= cap:
            continue
        mutable[5] = task[5] + "," + tgt
        return tuple(mutable)
    return None

def compute_monthly_load(tasks, dates, allocations=None):
    """Carga mensual por recurso. Si hay asignaciones del scheduler, usa esas (coherente con tope 100%)."""
    if allocations:
        load = {code: {m: 0.0 for m in range(6, 12)} for code in RESOURCES}
        for task in tasks:
            tid = task[2]
            alloc = allocations.get(tid)
            if not alloc:
                continue
            for code, months in alloc.items():
                if code not in load:
                    continue
                for m, h in months.items():
                    if h > 0.01:
                        load[code][m] += h
        return load
    load = {code: {m: 0.0 for m in range(6, 12)} for code in RESOURCES}
    for task in tasks:
        tid, assignees_str, hours = task[2], task[5], task[15]
        if tid not in dates:
            continue
        start, due = dates[tid]
        for code in parse_assignees(assignees_str):
            if code not in load:
                continue
            monthly = distribute_hours_in_range(hours, len(parse_assignees(assignees_str)), start, due)
            for m, h in monthly.items():
                load[code][m] += h
    return load

def spread_resource_tasks_in_list(tasks, dates):
    """Distribuye tareas de cada recurso uniformemente dentro de la ventana del mes."""
    from collections import defaultdict
    by_list_resource = defaultdict(lambda: defaultdict(list))
    for task in tasks:
        if task[1] in TRANSVERSAL_LISTS or task[1] == "Capacidad_Recursos":
            continue
        for code in parse_assignees(task[5]):
            by_list_resource[task[1]][code].append(task)

    for list_name, resources in by_list_resource.items():
        bounds = LIST_SCHEDULE_BOUNDS.get(list_name)
        if not bounds:
            continue
        m_start, m_end = bounds
        workdays = list_workdays(m_start, m_end)
        if not workdays:
            continue
        for _, rtasks in resources.items():
            ordered = sorted(rtasks, key=lambda t: (t[8], t[9], t[2]))
            n = len(ordered)
            slot = max(1, len(workdays) // max(n, 1))
            for i, task in enumerate(ordered):
                tid = task[2]
                duration = hours_to_workdays(task[15], len(parse_assignees(task[5])))
                idx = min(i * slot, len(workdays) - 1)
                start = workdays[idx]
                dep = (task[11] or "").strip()
                if dep and dep in dates:
                    start = max(start, add_workdays(dates[dep][1], 1))
                due = add_workdays(start, duration)
                if due > m_end:
                    due = m_end
                    start = m_end
                    rem = duration - 1
                    while rem > 0 and start > m_start:
                        start -= timedelta(days=1)
                        if is_workday(start):
                            rem -= 1
                    start = max(start, m_start)
                    due = min(add_workdays(start, duration), m_end)
                dates[tid] = (start, due)

def schedule_transversal_task(task, dates):
    """Actividades PMO/QA continuas: extender en el tiempo para carga mensual estable."""
    tid, assignees_str, sw, ew, hours = task[2], task[5], task[8], task[9], task[15]
    assignees = parse_assignees(assignees_str)
    duration = hours_to_workdays(hours, len(assignees))
    p_start, _ = project_week_range(sw)
    _, p_end = project_week_range(ew)
    p_start = max(dt_to_date(p_start), PROJECT_START_DATE)
    p_end = min(dt_to_date(p_end), PROJECT_END_DATE)
    total_wd = count_workdays(p_start, p_end)
    if total_wd > duration + 3:
        start = next_workday(p_start)
        due = next_workday(p_end)
    else:
        start = next_workday(p_start)
        due = add_workdays(start, duration)
        due = min(due, p_end)
    dates[tid] = (start, due)

def build_capacity_tasks(monthly_load):
    """60 tareas (10 recursos x 6 meses) para visualizar carga en ClickUp."""
    cap = []
    for code in RESOURCES:
        display = RESOURCE_DISPLAY[code]
        for month_num in range(6, 12):
            mo_label = MONTH_LABELS[month_num]
            mo_start, mo_end = MONTH_BOUNDS[month_num]
            hours = round(monthly_load[code][month_num], 1)
            pct = round(hours / MONTH_CAPACITY[month_num] * 100, 1)
            pct = min(pct, 100.0)
            cap_h = MONTH_CAPACITY[month_num]
            estado = "OPTIMO" if pct >= TARGET_LOAD_PCT else "MODERADO" if pct >= 70 else "BAJO"
            tid = f"CAP-{code}-M{month_num:02d}"
            cap.append((
                "Gestion PMO",
                "Capacidad_Recursos",
                tid,
                f"{display} — Carga {mo_label} 2026 ({pct}%)",
                f"PANEL DE CAPACIDAD MENSUAL\n"
                f"Recurso: {display}\n"
                f"Mes: {mo_label} 2026\n"
                f"Horas planificadas: {hours}h de {cap_h}h disponibles (neto feriados Peru, 8.5h/dia)\n"
                f"Carga: {pct}% — Estado: {estado}\n"
                f"Meta del proyecto: {TARGET_LOAD_PCT}%+ promedio en 6 meses\n\n"
                f"Esta tarea es un indicador para dashboard ClickUp. "
                f"No requiere ejecucion tecnica: consolida la suma de horas de todas las tareas "
                f"asignadas a {display} en {mo_label}.",
                code,
                "PMO,CAPACIDAD",
                "Normal",
                1, 26, "R1", "",
                "Baja", "Bajo", STREAMS_EARLY.get(code, "Arquitectura"),
                max(1, int(hours)),
            ))
    return cap

STREAMS_EARLY = {
    "BE1": "Backend Core", "BE2": "Ciberseguridad Backend", "BE3": "Integraciones",
    "FE1": "Frontend Principal", "FE2": "UX y Soporte", "ARQ": "Arquitectura",
    "SYS": "Infraestructura", "QA": "Calidad", "IA": "IA y Automatización", "PAF": "PMO Soporte",
}

def schedule_all_tasks(tasks):
    """
    Calcula Start Date y Due Date para todas las tareas.
    - Ventanas alineadas a sprints (solapamiento controlado entre meses)
    - Transversales: duracion extendida para carga mensual estable
    - Distribucion uniforme por recurso dentro de cada lista mensual
    - Dependencias respetadas en multiples pasadas
    """
    dates = {}
    by_list = {}
    for t in tasks:
        by_list.setdefault(t[1], []).append(t)

    for list_name, list_tasks in by_list.items():
        if list_name in TRANSVERSAL_LISTS:
            for task in sorted(list_tasks, key=lambda x: (x[8], x[2])):
                schedule_transversal_task(task, dates)
            continue

        if list_name == "Capacidad_Recursos":
            continue

        resource_next = {}
        sorted_tasks = sorted(list_tasks, key=lambda x: (x[8], x[9], x[2]))

        for task in sorted_tasks:
            tid, assignees_str, hours = task[2], task[5], task[15]
            assignees = parse_assignees(assignees_str)
            duration = hours_to_workdays(hours, len(assignees))
            m_start, m_end = task_effective_bounds(task)

            month_workdays = count_workdays(m_start, m_end)
            list_bounds = LIST_SCHEDULE_BOUNDS.get(list_name, (m_start, m_end))
            min_sw = min(t[8] for t in list_tasks)
            max_ew = max(t[9] for t in list_tasks)
            span = max(1, max_ew - min_sw)
            sw = task[8]
            rel = (sw - min_sw) / span
            offset = int(rel * max(0, month_workdays - duration))
            start = add_workdays(m_start, offset + 1)
            due = add_workdays(start, duration)

            for code in assignees:
                avail = resource_next.get(code, m_start)
                if start < avail:
                    start = next_workday(avail)
                    due = add_workdays(start, duration)

            if due > m_end:
                due = m_end
                start = m_end
                rem = duration - 1
                while rem > 0 and start > list_bounds[0]:
                    start -= timedelta(days=1)
                    if is_workday(start):
                        rem -= 1
                start = max(start, list_bounds[0])
                due = min(add_workdays(start, duration), m_end)

            dates[tid] = (start, due)
            next_avail = add_workdays(due, 1)
            for code in assignees:
                resource_next[code] = max(resource_next.get(code, m_start), next_avail)

    for _ in range(20):
        changed = False
        for task in tasks:
            if task[1] in TRANSVERSAL_LISTS or task[1] == "Capacidad_Recursos":
                continue
            tid, dep_str = task[2], (task[11] or "").strip()
            if not dep_str:
                continue
            dep_ids = [d.strip() for d in dep_str.split(",") if d.strip() in dates]
            if not dep_ids:
                continue
            start, due = dates[tid]
            duration = max(1, count_workdays(start, due))
            dep_end = max(dates[d][1] for d in dep_ids)
            new_start = add_workdays(dep_end, 1)
            m_start, m_end = task_effective_bounds(task)
            if new_start > m_end:
                continue
            if new_start > start:
                new_due = add_workdays(new_start, duration)
                if new_due > m_end:
                    new_due = m_end
                    new_start = m_start
                    rem = duration - 1
                    while rem > 0 and new_start > m_start:
                        new_start -= timedelta(days=1)
                        if is_workday(new_start):
                            rem -= 1
                    new_start = max(new_start, m_start)
                    new_due = min(add_workdays(new_start, duration), m_end)
                dates[tid] = (new_start, new_due)
                changed = True
        if not changed:
            break

    spread_resource_tasks_in_list(tasks, dates)

    for _ in range(10):
        changed = False
        for task in tasks:
            if task[1] in TRANSVERSAL_LISTS or task[1] == "Capacidad_Recursos":
                continue
            tid, dep_str = task[2], (task[11] or "").strip()
            if not dep_str:
                continue
            dep_ids = [d.strip() for d in dep_str.split(",") if d.strip() in dates]
            if not dep_ids:
                continue
            start, due = dates[tid]
            duration = max(1, count_workdays(start, due))
            dep_end = max(dates[d][1] for d in dep_ids)
            new_start = add_workdays(dep_end, 1)
            m_start, m_end = task_effective_bounds(task)
            if new_start <= m_end and new_start > start:
                new_due = min(add_workdays(new_start, duration), m_end)
                dates[tid] = (new_start, new_due)
                changed = True
        if not changed:
            break

    spread_resource_tasks_in_list(tasks, dates)

    for task in tasks:
        if task[1] in TRANSVERSAL_LISTS or task[1] == "Capacidad_Recursos":
            continue
        tid = task[2]
        start, due = dates.get(tid, (None, None))
        if not start or not due:
            continue
        duration = hours_to_workdays(task[15], len(parse_assignees(task[5])))
        if start > due:
            m_start, m_end = task_effective_bounds(task)
            due = m_end
            start = due
            rem = duration - 1
            while rem > 0 and start > m_start:
                start -= timedelta(days=1)
                if is_workday(start):
                    rem -= 1
            start = max(start, m_start)
            dates[tid] = (start, min(add_workdays(start, duration), m_end))

    return dates

TASK_DATES = {}  # Se llena despues de definir TASKS

# ──────────────────────────────────────────────────────────────
# TAREAS COMPLETAS — 102 originales + ~50 nuevas
# (folder, list, task_id, task_name, description, assignees, tags, priority,
#  start_week, end_week, release, depends_on, complexity, risk, stream, hours)
# ──────────────────────────────────────────────────────────────

TASKS = [

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 1 — JUNIO 2026 (01/06 al 30/06) — Semanas 1-4, Sprints 1-2
    # ██  Foco: Kick-off, levantamiento, diseño, modelado, selección tecnológica
    # ══════════════════════════════════════════════════════════════════════════

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-001",
     "Reunión de Kick-off con accionistas y Gerencia Minera",
     "Presentación del proyecto, alcance SOW, equipo, cronograma y expectativas de entregables ante Directorio y Gerencia Operacional.",
     "ARQ", "ARQUITECTURA,CRITICO", "Urgent", 1, 1, "R1", "", "Baja", "Bajo", "Arquitectura", 8),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-002",
     "Aprobar documento de definición de alcance (SOW)",
     "Revisión, ajuste y firma formal del Statement of Work con todas las partes interesadas.",
     "ARQ", "ARQUITECTURA,DOC,CRITICO", "Urgent", 1, 1, "R1", "P1-M1-001", "Baja", "Alto", "Arquitectura", 16),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-003",
     "Levantamiento funcional para sistema de informes mineros avanzados",
     "Entrevistas con ingenieros de mina, supervisores y gerencia para capturar requisitos funcionales del módulo de reportabilidad.",
     "ARQ,FE1", "ARQUITECTURA,DOCUMENTACION", "High", 1, 2, "R1", "P1-M1-001", "Media", "Medio", "Arquitectura", 40),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-004",
     "Definir requerimientos no funcionales (latencia, concurrencia)",
     "Documentar NFRs: latencia <20ms, 10K sensores concurrentes, disponibilidad 99.9%, auto-guardado <0.5s.",
     "ARQ,BE1", "ARQUITECTURA,CRITICO", "High", 1, 2, "R1", "P1-M1-003", "Media", "Alto", "Arquitectura", 24),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-005",
     "Seleccionar y validar frameworks (C++ Boost, React 18, FastAPI)",
     "Evaluación técnica y PoC de stack: C++ Boost.Asio, React 18 + TipTap, PostgreSQL/TimescaleDB, Redpanda.",
     "ARQ,BE1,FE1", "ARQUITECTURA,CORE", "High", 2, 3, "R1", "P1-M1-004", "Alta", "Medio", "Arquitectura", 40),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-006",
     "Definir flujos de autenticación, autorización y roles",
     "Diseño de flujos JWT, OAuth2, RBAC multi-tenant, biometría facial para acceso a informes.",
     "ARQ,BE2", "SEGURIDAD,ARQUITECTURA", "High", 2, 3, "R1", "P1-M1-003", "Alta", "Alto", "Arquitectura", 32),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-007",
     "Modelar base de datos para informes mineros (JSONB)",
     "Diseño de esquema PostgreSQL con JSONB para estructura granular de informes, versionamiento y auditoría.",
     "BE1,ARQ", "DB,ARQUITECTURA", "High", 2, 3, "R1", "P1-M1-004", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-008",
     "Modelar ERD de usuarios y flujos de aprobación",
     "Diagrama entidad-relación completo: usuarios, roles, permisos, workflows de aprobación de informes.",
     "BE1", "DB,ARQUITECTURA", "Normal", 3, 3, "R1", "P1-M1-007", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-009",
     "Diseñar esquema multi-tenant (aislamiento por compañía/contratista)",
     "Arquitectura de aislamiento de datos por empresa minera y contratista con particionamiento lógico.",
     "ARQ,BE1", "DB,ARCH,SEGURIDAD", "High", 3, 4, "R1", "P1-M1-007", "Alta", "Alto", "Arquitectura", 32),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-010",
     "Definir particiones automáticas en TimescaleDB para telemetría",
     "Diseño de hypertables, políticas de retención y compresión para datos de sensores IoT.",
     "BE1", "DB,SENSOR", "High", 3, 4, "R1", "P1-M1-007", "Alta", "Medio", "Backend", 24),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-011",
     "Auditar sistemas legacy actuales en mina",
     "Relevamiento de interfaces actuales, formatos de datos, APIs existentes y puntos de integración.",
     "ARQ,BE3", "ARQUITECTURA,DOCUMENTACION", "Normal", 2, 3, "R1", "P1-M1-003", "Media", "Medio", "Arquitectura", 32),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-012",
     "Elaborar y presentar documentos de diseño de backend",
     "Documentación técnica de APIs, diagramas de secuencia, contratos de servicio y patrones de diseño.",
     "BE1,ARQ", "ARQUITECTURA,DOC,CORE", "Normal", 3, 4, "R1", "P1-M1-005", "Media", "Bajo", "Backend", 32),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-013",
     "Análisis heurístico de las interfaces antiguas",
     "Evaluación UX de sistemas legacy para identificar pain points y oportunidades de mejora.",
     "FE2", "UX,DOCUMENTACION", "Normal", 2, 3, "R1", "P1-M1-003", "Baja", "Bajo", "Frontend", 16),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-014",
     "Crear guía de estilos de negocio (Design System minero)",
     "Definición de paleta, tipografía, componentes, iconografía y guidelines para la plataforma.",
     "FE2", "UX,DOCUMENTACION", "Normal", 3, 4, "R1", "P1-M1-013", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-015",
     "Wireframes low-fidelity: login y control de acceso",
     "Bocetos iniciales de pantallas de login, recuperación de contraseña y selección de roles.",
     "FE1,FE2", "UX", "Normal", 3, 4, "R1", "P1-M1-014", "Baja", "Bajo", "Frontend", 16),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-016",
     "Wireframes: dashboard general e indicadores de telemetría (KPIs)",
     "Diseño de dashboard principal con widgets de KPIs operacionales, alertas y tendencias.",
     "FE1", "UX,SENSOR", "Normal", 3, 4, "R1", "P1-M1-014", "Media", "Bajo", "Frontend", 16),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-017",
     "Wireframes: editor de reportes técnicos avanzados (ReportStudio)",
     "Prototipo del ReportStudio: toolbar, formato, tablas, imágenes, reglas horizontales, firma digital, auto-guardado.",
     "FE1", "UX,EXPORT,EDITOR", "High", 3, 4, "R1", "P1-M1-014", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-018",
     "Aprobación gerencial de arquitectura y documentos de diseño",
     "Presentación formal y aprobación de diseño técnico, stack tecnológico y plan de ejecución.",
     "ARQ", "ARQUITECTURA,CRITICO,DOCUMENTACION", "Urgent", 4, 4, "R1", "P1-M1-012", "Baja", "Alto", "Arquitectura", 8),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-019",
     "Configurar registro automatico de cambios en la base de datos (auditoria)",
     "Crear mecanismos en la base de datos que registren automaticamente cuando alguien modifica, elimina o accede a informacion sensible: quien hizo el cambio, cuando, y que datos se modificaron. Esencial para cumplimiento normativo minero.",
     "BE1", "DB,SEGURIDAD", "Normal", 4, 4, "R1", "P1-M1-008", "Media", "Medio", "Backend", 16),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-M1-020",
     "Documentar módulos (informes, autorizaciones)",
     "Especificación funcional detallada de cada módulo del sistema de reportabilidad.",
     "ARQ,BE1", "DOCUMENTACION,ARQUITECTURA", "Normal", 4, 4, "R1", "P1-M1-012", "Media", "Bajo", "Arquitectura", 24),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 2 — JULIO 2026 (01/07 al 31/07) — Semanas 5-9, Sprints 3-4
    # ██  Foco: Motor C++, WebSocket, REST, Auth, BD, auto-save, versionado
    # ══════════════════════════════════════════════════════════════════════════

    # --- ORIGINALES ---
    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-001",
     "Inicializar repositorio C++ (CMakeLists y vcpkg)",
     "Setup del proyecto C++ con CMake, vcpkg, estructura de directorios, CI local y compilación base.",
     "BE1", "CORE,DEVOPS", "Urgent", 5, 5, "R2", "P1-M1-005", "Media", "Bajo", "Backend", 16),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-002",
     "Desarrollar estructuras de red nativas con Boost.Asio",
     "Construccion del modulo de comunicaciones de red de alta velocidad que permite al sistema enviar y recibir datos de sensores en milisegundos.",
     "BE1", "CORE,CRITICO", "Urgent", 5, 6, "R2", "P1-M2-001", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-003",
     "Crear servidor de comunicacion en tiempo real (WebSocket)",
     "Servidor que permite enviar actualizaciones instantaneas a las pantallas de los usuarios sin que tengan que refrescar la pagina.",
     "BE1", "CORE,CRITICO", "Urgent", 5, 7, "R2", "P1-M2-002", "Alta", "Alto", "Backend", 48),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-004",
     "Optimizar formato de envio de datos de sensores (compresion ligera)",
     "Crear un formato compacto para enviar datos de sensores que consuma el minimo de ancho de banda, especialmente importante en zonas de mina con conexion limitada.",
     "BE1,BE3", "CORE,SENSOR", "High", 6, 7, "R2", "P1-M2-002", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-005",
     "Implementar endpoints REST: autorización, revisión y firmas",
     "API REST completa para CRUD de informes, flujo de aprobación y firma digital.",
     "BE1,BE3", "CORE,SEGURIDAD", "Urgent", 6, 8, "R2", "P1-M2-003", "Alta", "Alto", "Backend", 48),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-006",
     "Implementar sistema de login seguro con tokens cifrados",
     "Sistema de autenticacion donde cada usuario recibe un token cifrado al ingresar. El token se renueva automaticamente y garantiza que solo usuarios autorizados accedan al sistema.",
     "BE2", "SEGURIDAD,CORE,CRITICO", "Urgent", 5, 7, "R2", "P1-M1-006", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-007",
     "Conectar el motor del sistema con la base de datos PostgreSQL",
     "Establecer la conexion entre el servidor C++ y la base de datos, con multiples conexiones simultaneas para alto rendimiento.",
     "BE1", "CORE,DB", "High", 5, 6, "R2", "P1-M2-001", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-008",
     "Crear servicio para guardar y recuperar informes con historial de cambios",
     "Servicio que permite guardar cada version de un informe, recuperar versiones anteriores y rastrear quien hizo cada cambio.",
     "BE1", "CORE,DB,EDITOR", "High", 6, 7, "R2", "P1-M2-007", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-009",
     "Crear proceso de importacion de datos desde sistemas antiguos de la mina",
     "Proceso automatizado que extrae datos de los sistemas actuales de la mina, los transforma al nuevo formato y los carga en la base de datos de la plataforma.",
     "BE3", "CORE,DB", "High", 6, 8, "R2", "P1-M2-007", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-010",
     "Sincronizacion continua de base de datos con plataforma AWS actual",
     "Modulo que lee en tiempo real la base de datos de la plataforma minera actual (alojada en AWS) y sincroniza los datos hacia la nueva base de datos en el datacenter VPS Lima. Esta es la UNICA conexion con AWS: lectura continua de datos para mantener ambas plataformas sincronizadas durante la transicion.",
     "BE3", "CORE,CRITICO", "High", 7, 8, "R2", "P1-M2-009", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-011",
     "Modulo de recepcion y procesamiento de datos de sensores en tiempo real",
     "Componente que recibe continuamente datos de los sensores de la mina (temperatura, presion, vibracion) y los procesa al instante para mostrar en pantalla y generar alertas.",
     "BE1", "CORE,SENSOR,CRITICO", "High", 7, 8, "R2", "P1-M2-003", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-012",
     "Manejo de cortes de conexion en zonas de mina con red inestable",
     "El sistema se reconecta automaticamente cuando se pierde la senal, guarda los datos pendientes y los envia cuando la conexion regresa.",
     "BE1,BE3", "CORE,SENSOR", "High", 7, 8, "R2", "P1-M2-003", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-013",
     "Cargar catalogos de personal, zonas y equipos en el ambiente de pruebas",
     "Importar al ambiente de pruebas toda la informacion base de la operacion minera: listado de trabajadores, zonas geograficas de la mina, inventario de equipos y maquinaria. Esta informacion es necesaria para que el sistema funcione con datos reales.",
     "BE3", "DB,CORE", "Normal", 7, 8, "R2", "P1-M2-009", "Media", "Medio", "Backend", 24),

    # --- NUEVAS BE1: motor de documentos ---
    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-014",
     "Disenar estructura de base de datos para almacenar formato de informes (fuentes, colores, reglas)",
     "Crear la estructura en la base de datos que guarda todo el formato de los informes: tipo de letra, tamano, negritas, colores de texto y fondo, reglas horizontales, alineacion. Permite que el informe se vea identico cada vez que se abre.",
     "BE1", "CORE,DB,EDITOR,CRITICO", "Urgent", 5, 6, "R2", "P1-M1-007", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-015",
     "Servicio de guardado automatico del informe (auto-save cada pocos segundos)",
     "El sistema guarda automaticamente los cambios del informe cada pocos segundos, enviando solo lo que cambio (no todo el documento). Si dos personas editan al mismo tiempo, detecta y resuelve conflictos. Tiempo de guardado menor a medio segundo.",
     "BE1", "CORE,EDITOR,CRITICO", "Urgent", 6, 7, "R2", "P1-M2-008", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-016",
     "Sistema de historial de versiones del informe con comparador de cambios",
     "Cada vez que se guarda un informe se crea una nueva version con nombre del autor y fecha. Permite comparar dos versiones y ver exactamente que se agrego, elimino o modifico (texto en verde = nuevo, rojo = eliminado).",
     "BE1,BE3", "CORE,DB,EDITOR", "High", 6, 8, "R2", "P1-M2-008", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-017",
     "Bloqueo de informe cuando alguien lo esta editando (evitar sobreescrituras)",
     "Cuando un usuario abre un informe para editar, el sistema lo bloquea para otros usuarios. Se muestra quien esta editando. Si el usuario se desconecta, el bloqueo se libera automaticamente.",
     "BE1,BE3", "CORE,EDITOR", "High", 7, 8, "R2", "P1-M2-003", "Alta", "Alto", "Backend", 24),

    # --- NUEVAS BE2: seguridad core ---
    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-018",
     "Cifrado de datos confidenciales almacenados en la base de datos",
     "Los informes marcados como confidenciales y los datos biometricos se guardan cifrados en la base de datos. Si alguien accede directamente a la base de datos, no podra leer el contenido sin la clave.",
     "BE2", "SEGURIDAD,CORE,DB", "High", 6, 7, "R2", "P1-M2-006", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-019",
     "Control de permisos por rol: quien puede ver, editar, aprobar y firmar cada informe",
     "Sistema que verifica en cada operacion si el usuario tiene permiso: administradores, supervisores, ingenieros y lectores tienen accesos diferentes. Cada rol solo puede hacer lo que le corresponde (crear, editar, aprobar, firmar, exportar).",
     "BE2", "SEGURIDAD,CORE,CRITICO", "Urgent", 7, 8, "R2", "P1-M2-006", "Alta", "Alto", "Backend", 32),

    # --- NUEVA BE3: legacy ---
    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-M2-020",
     "Convertidor de datos del sistema antiguo al formato de la nueva plataforma",
     "Herramienta que toma los datos del sistema minero anterior (archivos CSV, XML y otros formatos) y los convierte al formato de la nueva plataforma. Incluye limpieza de datos y reporte de errores encontrados.",
     "BE3", "CORE,DB", "High", 7, 8, "R2", "P1-M2-009", "Alta", "Medio", "Backend", 32),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 3 — AGOSTO 2026 (01/08 al 31/08) — Semanas 10-13, Sprints 5-6
    # ██  Foco: Frontend React, TipTap editor, GIS, sensores, dashboards
    # ██  Correspondencia backend: upload, search, templates, PDF, NLP, notif
    # ══════════════════════════════════════════════════════════════════════════

    # --- ORIGINALES frontend ---
    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-001",
     "Prototipar UI: flujo de autorización, revisión y firmas de informes",
     "Implementacion React del flujo completo: crear informe, revisar, aprobar, firmar y publicar.",
     "FE1", "UX,CORE,CRITICO", "Urgent", 9, 10, "R3", "P1-M1-017", "Alta", "Alto", "Frontend", 40),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-002",
     "Prototipar UI: búsqueda avanzada y filtrado de informes",
     "Componente de búsqueda full-text con filtros por fecha, autor, estado, tipo y zona minera.",
     "FE1", "UX,CORE", "High", 9, 10, "R3", "P1-M3-001", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-003",
     "Prototipar UI en Figma: pantallas de identidad y biometría",
     "Diseño de pantallas de registro facial, captura biométrica y verificación de identidad.",
     "FE2", "UX,SECURITY,IA", "High", 9, 10, "R3", "P1-M1-014", "Media", "Medio", "Frontend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-004",
     "Prototipar UI: dashboard central y mapas GIS Lidar",
     "Dashboard operacional con mapas Leaflet, capas GIS, puntos de sensores y tracking en vivo.",
     "FE1,FE2", "UX,GIS,SENSOR,CRITICO", "Urgent", 9, 11, "R3", "P1-M1-016", "Alta", "Alto", "Frontend", 48),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-005",
     "Prototipar UI: dictado por voz y corrección vía IA",
     "Componente de dictado con WebSpeech API y corrección automática vía modelo NLP.",
     "FE1,IA", "UX,IA,EDITOR", "High", 10, 11, "R3", "", "Alta", "Alto", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-006",
     "Definir micro-interacciones y animaciones de notificaciones de estado",
     "Animaciones de feedback: guardado, envío, aprobación, error, alertas de sensores.",
     "FE2", "UX", "Normal", 10, 11, "R3", "P1-M3-001", "Baja", "Bajo", "Frontend", 16),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-007",
     "Revisar UX con el área de operaciones (ingenieros en mina)",
     "Sesiones de usabilidad con usuarios finales en la unidad minera para validar prototipos.",
     "FE2,ARQ", "UX,DOCUMENTACION", "High", 11, 12, "R3", "P1-M3-004", "Media", "Medio", "Frontend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-008",
     "Exportar y consolidar assets vectoriales para Frontend",
     "Consolidación de iconos SVG, mapas vectoriales e imágenes optimizadas para la plataforma.",
     "FE2", "UX", "Normal", 11, 12, "R3", "P1-M3-006", "Baja", "Bajo", "Frontend", 16),

    # --- ORIGINALES backend MES3 ---
    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-009",
     "Conectar el sistema con la cola de mensajes para datos de sensores",
     "Integracion del servidor con el sistema de mensajeria Redpanda para procesar datos de sensores de forma ordenada y sin perder informacion.",
     "BE1,BE3", "CORE,SENSOR", "High", 9, 10, "R2", "P1-M2-011", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-010",
     "Optimizar procesamiento paralelo para manejar miles de sensores simultaneos",
     "Configurar el servidor para procesar datos de multiples sensores al mismo tiempo, aprovechando todos los nucleos del procesador.",
     "BE1", "CORE", "High", 10, 11, "R2", "P1-M2-011", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-011",
     "Monitor de salud del sistema con reinicio automatico si falla",
     "Componente que vigila continuamente que el servidor este funcionando correctamente. Si detecta que algo se congelo o fallo, reinicia automaticamente el servicio afectado y envia alerta al equipo.",
     "BE1,BE3", "CORE,DEVOPS", "High", 11, 12, "R2", "P1-M3-010", "Alta", "Medio", "Backend", 24),

    # ── NUEVAS FRONTEND: ReportStudio / TipTap Editor ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-012",
     "FE1: Inicialización TipTap Editor con extensions core (ReportStudio)",
     "Setup de TipTap/ProseMirror como motor del editor de informes: StarterKit, Document, Paragraph, Text, History, Placeholder. Configuración de schema custom para nodos mineros. Integración con React 18 y state management.",
     "FE1", "UX,EDITOR,CRITICO", "Urgent", 9, 10, "R3", "P1-M1-017", "Alta", "Alto", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-013",
     "FE1: Toolbar de formateo completo del editor (bold, italic, underline, fuentes, tamaños)",
     "Barra de herramientas del editor con controles: Bold, Italic, Underline, Strikethrough, selección de Font Family (Arial, Times New Roman, Calibri, etc.), selección de Font Size (8pt a 72pt), alineación (izq/centro/der/justificado). Incluye tooltips y atajos de teclado visibles.",
     "FE1", "UX,EDITOR,CRITICO", "Urgent", 9, 10, "R3", "P1-M3-012", "Alta", "Medio", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-014",
     "FE1: Reglas horizontales para ubicar texto en el documento/lienzo",
     "Implementación de reglas horizontales (horizontal rulers) tipo Word/InDesign sobre el canvas del editor. Las reglas muestran márgenes, tabulaciones, indentaciones y permiten al usuario arrastrar los marcadores para posicionar el texto. Incluye regla horizontal superior con escala en cm/pulgadas, guías de margen izquierdo/derecho, marcadores de indentación (primera línea y sangría francesa) arrastrables, y snap-to-grid configurable.",
     "FE1", "UX,EDITOR,CRITICO", "High", 10, 11, "R3", "P1-M3-012", "Alta", "Alto", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-015",
     "FE1: Agrupación de textos para selección y cambio de Font (tamaño, fuente, estilo, bold, subrayado)",
     "Funcionalidad de selección múltiple de bloques de texto en el documento para aplicar cambios de formato en lote: cambiar font-family de todo el bloque seleccionado, cambiar font-size, aplicar bold/italic/underline, cambiar estilo (normal, heading, quote). Incluye selección con Shift+Click para rangos, Ctrl+Click para selección discontinua, y Select All (Ctrl+A). El formato se propaga correctamente a través de los nodos ProseMirror.",
     "FE1", "UX,EDITOR,CRITICO", "High", 10, 11, "R3", "P1-M3-013", "Alta", "Alto", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-016",
     "FE1: Cambio del color de fondo del texto (highlight/background color)",
     "Componente de selección de color de fondo (highlight) para texto seleccionado en el editor. Incluye paleta de colores predefinidos (amarillo, verde, azul, rosa, naranja, rojo, gris), color picker custom con hex/RGB, preview en tiempo real sobre el texto seleccionado, y botón de quitar highlight. El color se almacena como atributo en el nodo TipTap y persiste en JSONB backend.",
     "FE1", "UX,EDITOR", "High", 10, 11, "R3", "P1-M3-013", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-017",
     "FE1: Color de texto (foreground) con paleta y selector personalizado",
     "Selector de color de texto (foreground) con paleta corporativa minera y color picker avanzado. Integración con TipTap TextStyle extension para aplicar color a nivel de marca inline.",
     "FE1", "UX,EDITOR", "High", 10, 11, "R3", "P1-M3-013", "Media", "Bajo", "Frontend", 16),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-018",
     "FE1+FE2: Tablas en editor — inserción, edición, merge/split de celdas",
     "Extension TipTap Table para insertar tablas en informes mineros: agregar/eliminar filas y columnas, merge de celdas horizontal/vertical, resize de columnas con drag, estilos de borde y color de celda, header row fijo. FE2 desarrolla los estilos CSS y la UX responsive de tablas.",
     "FE1,FE2", "UX,EDITOR", "High", 10, 12, "R3", "P1-M3-012", "Alta", "Alto", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-019",
     "FE1+FE2: Imágenes en editor — upload, drag-and-drop, resize y alineación",
     "Componente de imagen para el editor: upload desde disco, drag-and-drop, pegado desde clipboard, resize con handles, alineación (inline, left, center, right, full-width), caption/pie de foto editable. Integración con API de upload backend. FE2 implementa la UX de resize con handles y galería de imágenes.",
     "FE1,FE2", "UX,EDITOR", "High", 11, 12, "R3", "P1-M3-012", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-020",
     "FE2: Listas en editor (ordenadas, desordenadas, checklist) e indentación",
     "Extensions TipTap para listas: BulletList, OrderedList, TaskList con checkboxes. Indentación multinivel con Tab/Shift+Tab. Line spacing configurable (1.0, 1.15, 1.5, 2.0).",
     "FE2", "UX,EDITOR", "Normal", 10, 11, "R3", "P1-M3-012", "Media", "Bajo", "Frontend", 16),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-021",
     "FE2: Saltos de página, numeración de páginas y márgenes configurables",
     "Implementación de page breaks visibles en el editor (líneas de corte de página), numeración automática de páginas, y panel de configuración de márgenes (superior, inferior, izquierdo, derecho) para previsualización fiel al formato de impresión.",
     "FE2", "UX,EDITOR,EXPORT", "Normal", 11, 12, "R3", "P1-M3-014", "Media", "Medio", "Frontend", 16),

    # ── NUEVAS BACKEND: correspondencia para editor ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-022",
     "BE1: API de upload y almacenamiento de imágenes/adjuntos (storage service)",
     "Servicio para subir archivos (imagenes, adjuntos) al servidor con validacion de tipo y tamano, generacion de miniaturas, almacenamiento en disco local del datacenter, y retorno de enlace para insertar en el editor. Limite 20MB por archivo.",
     "BE1,BE3", "CORE,EDITOR", "High", 9, 10, "R2", "P1-M2-005", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-023",
     "BE1+BE3: Motor de búsqueda full-text con indexación (pg_trgm + tsvector)",
     "Implementación de búsqueda full-text sobre contenido de informes usando PostgreSQL tsvector + pg_trgm para fuzzy matching. Índices GIN sobre campos JSONB de contenido. Búsqueda por título, contenido, autor, tags, zona minera. BE3 implementa la API REST de búsqueda, BE1 diseña los índices y queries optimizados.",
     "BE1,BE3", "CORE,DB,EDITOR", "High", 10, 11, "R2", "P1-M2-008", "Alta", "Medio", "Backend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-024",
     "BE1+BE3: Motor de templates CRUD y renderizado (plantillas de informes)",
     "API REST para CRUD de plantillas de informes: crear template desde documento existente, listar templates por categoría (diario, semanal, incidente, gerencial), aplicar template a nuevo documento, preview de template. Almacenamiento JSONB de estructura de template. BE3 desarrolla el CRUD REST, BE1 implementa la lógica de clonación de estructura JSONB.",
     "BE1,BE3", "CORE,EDITOR", "High", 10, 12, "R2", "P1-M2-008", "Alta", "Medio", "Backend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-025",
     "BE1: Motor de generación PDF server-side (renderizado de informes)",
     "Servicio C++ de generación de PDF desde estructura JSONB del informe. Renderiza formateo completo: fuentes, colores, tablas, imágenes, reglas horizontales, numeración de páginas, portada. Usa librería como libharu o wkhtmltopdf. Target: <5 segundos por informe de 50 páginas.",
     "BE1", "CORE,EXPORT,EDITOR,CRITICO", "Urgent", 10, 12, "R2", "P1-M2-014", "Alta", "Alto", "Backend", 40),

    # ── NUEVAS BE2: servicios IA y seguridad ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-026",
     "Corrector ortografico y gramatical inteligente para informes mineros (espanol tecnico)",
     "Servicio de correccion automatica de ortografia y gramatica especializado en espanol tecnico minero: corrige errores de escritura, sugiere la palabra correcta, conoce terminos como 'voladura', 'chancadora', 'mineral de cabeza', 'ley de corte'. Funciona en tiempo real mientras el usuario escribe. Tambien corrige automaticamente el texto dictado por voz.",
     "IA,BE2", "IA,EDITOR,CORE", "High", 10, 12, "R2", "P1-M2-006", "Alta", "Alto", "Backend", 32),

    # ── NUEVAS BE3: notificaciones ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-027",
     "BE3: Servicio de notificaciones por email (SMTP con templates HTML)",
     "Servicio de envio de correos electronicos automaticos: aprobacion de informes, alertas de sensores, cambios de estado, recordatorios. Plantillas HTML adaptables. Cola de envio con reintentos automaticos. Conexion SMTP del datacenter.",
     "BE3", "NOTIF,CORE", "High", 10, 11, "R2", "P1-M2-005", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-M3-028",
     "BE3: Servicio de push notifications (WebPush y FCM para mobile)",
     "Sistema de notificaciones push para navegador (Web Push API) y mobile (Firebase Cloud Messaging). Notifica: documentos pendientes de revisión, alertas de sensores críticos, cambios en informes compartidos.",
     "BE3", "NOTIF,CORE", "Normal", 11, 12, "R2", "P1-M3-027", "Media", "Medio", "Backend", 24),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 4 — SEPTIEMBRE 2026 (01/09 al 30/09) — Semanas 14-17, Sprints 7-8
    # ██  Foco: Exportación, integración e2e, QA funcional, print, offline,
    # ██        comments, version diff, templates gallery, keyboard shortcuts
    # ══════════════════════════════════════════════════════════════════════════

    # --- ORIGINALES ---
    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-001",
     "Exportación: generar informes en Microsoft Word (DOCX)",
     "Motor de generación DOCX con estilos corporativos, tablas, gráficos y firma digital embebida.",
     "BE1,FE1", "EXPORT,CORE,CRITICO", "Urgent", 13, 14, "R4", "P1-M2-008", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-002",
     "Exportación: generar presentaciones PowerPoint (PPTX)",
     "Generación automática de presentaciones ejecutivas a partir de datos de informes mineros. BE3 implementa el pipeline de conversión, BE1 define la estructura de slides desde JSONB.",
     "BE1,BE3", "EXPORT,CORE", "High", 13, 14, "R4", "P1-M4-001", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-003",
     "Exportación: renderizado y generación de informes en vídeo MP4",
     "Servicio de renderizado de informes animados en formato MP4 para presentaciones ejecutivas. IA implementa la narración automática con TTS y la selección inteligente de visualizaciones.",
     "BE3,IA", "EXPORT,IA", "Normal", 14, 15, "R4", "P1-M4-002", "Alta", "Alto", "Backend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-004",
     "Instalar cola de mensajes Redpanda/Kafka en datacenter",
     "OBJETIVO: Canal de alta velocidad para telemetria y eventos entre servicios.\n\n"
     "PARA LA MINA: Miles de lecturas de sensores por segundo sin perder datos.\n\n"
     "ENTREGABLE: Redpanda/Kafka en Docker, topics configurados, monitoreo basico.\n\n"
     "VPS REQUERIDO: Staging o produccion (sep 2026).\n\n"
     "DEPENDE DE: DEV-004, integracion backend sensores.\n\n"
     "EXITO: Backend publica y consume eventos sin cuello de botella.",
     "BE3,SYS", "CORE,DEVOPS", "High", 13, 14, "R4", "P1-M3-009", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-005",
     "Testing cero fugas de memoria (Valgrind y unit testing nativo)",
     "Análisis exhaustivo con Valgrind/ASan/TSan para detectar memory leaks y race conditions.",
     "QA,BE1", "QA,CORE,CRITICO", "Urgent", 14, 15, "R4", "P1-M2-003", "Alta", "Alto", "QA", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-006",
     "Wireframes: editor de reportes técnicos avanzados (iteración 2)",
     "Segunda iteración del editor con feedback de usuarios: mejoras en toolbar, templates, atajos.",
     "FE1", "UX,EXPORT,EDITOR", "High", 13, 14, "R3", "P1-M3-007", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-007",
     "Integración frontend-backend: flujo completo de informes",
     "Conexion completa: crear, editar, auto-guardar, revisar, aprobar, exportar y firmar.",
     "FE1,BE1", "CORE,CRITICO,EDITOR", "Urgent", 14, 16, "R4", "P1-M3-001", "Alta", "Alto", "Frontend", 48),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-008",
     "Pruebas funcionales del módulo de reportabilidad",
     "Test suite completo del flujo de informes: creación, edición, versionado, exportación.",
     "QA", "QA,CORE,EDITOR", "High", 15, 16, "R4", "P1-M4-007", "Media", "Medio", "QA", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-009",
     "Pruebas de integración de sensores y dashboard",
     "Validacion del flujo completo de telemetria: sensor envia dato, Kafka lo distribuye, backend lo procesa, WebSocket lo envia a la pantalla del usuario.",
     "QA,BE3", "QA,SENSOR", "High", 15, 16, "R4", "P1-M3-004", "Alta", "Alto", "QA", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-010",
     "Pruebas de exportación (DOCX, PPTX, PDF)",
     "Validación de calidad de documentos exportados: formato, imágenes, tablas, firmas.",
     "QA", "QA,EXPORT", "Normal", 15, 16, "R4", "P1-M4-001", "Media", "Medio", "QA", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-011",
     "Milestone: Funcionalidad Core Completa (Demo Gerencial)",
     "Demostración del sistema funcional completo al Directorio: informes, sensores, GIS, exportación.",
     "ARQ", "CRITICO,ARQUITECTURA", "Urgent", 16, 16, "R4", "P1-M4-007", "Baja", "Alto", "Arquitectura", 8),

    # ── NUEVAS FRONTEND MES4: editor avanzado ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-012",
     "FE1: Print preview con paginación fiel al formato final",
     "Vista de previsualización de impresión que muestra el informe tal como saldrá impreso: paginación real, headers/footers, numeración de páginas, márgenes, saltos de página. Botón de impresión directa vía window.print() con CSS @media print optimizado.",
     "FE1", "UX,EDITOR,EXPORT", "High", 13, 14, "R4", "P1-M3-021", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-013",
     "Deshacer/Rehacer cambios y atajos de teclado rapidos en el editor de informes",
     "El editor permite deshacer hasta 100 cambios consecutivos (Ctrl+Z) y rehacerlos (Ctrl+Y). Atajos de teclado para las acciones mas frecuentes: Ctrl+B (negritas), Ctrl+I (cursiva), Ctrl+U (subrayado), Ctrl+S (guardar), Tab (indentar). Panel de ayuda que muestra todos los atajos disponibles (Ctrl+/).",
     "FE1", "UX,EDITOR", "High", 13, 14, "R3", "P1-M3-012", "Media", "Bajo", "Frontend", 16),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-014",
     "FE1+FE2: Panel de comentarios y anotaciones en informes",
     "Panel lateral de comentarios: seleccionar texto, agregar comentario, responder en hilo, resolver. Notificaciones de nuevos comentarios. Resaltado del texto comentado en el editor. Integracion con API de comentarios backend. FE2 disena la experiencia del panel y las animaciones.",
     "FE1,FE2", "UX,EDITOR", "High", 14, 15, "R4", "P1-M3-001", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-015",
     "FE1+FE2: Comparador de versiones de informes (diff visual)",
     "Vista side-by-side o inline de diferencias entre dos versiones de un informe: texto agregado (verde), eliminado (rojo), modificado (amarillo). Selector de versiones con timeline. Integración con motor de versionado backend. FE2 diseña la UX del timeline y los colores del diff.",
     "FE1,FE2", "UX,EDITOR", "High", 14, 15, "R4", "P1-M2-016", "Alta", "Medio", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-016",
     "FE1: Galería de templates de informes (selección y preview)",
     "Pantalla de selección de plantillas con preview visual: templates por categoría (diario, semanal, incidente, gerencial, turno). Crear informe desde template con un click. Preview en miniatura del layout.",
     "FE1", "UX,EDITOR", "Normal", 13, 14, "R3", "P1-M3-024", "Media", "Bajo", "Frontend", 16),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-017",
     "FE2: Editor de portada, headers y footers del informe",
     "Componente de diseño de portada de informe (logo empresa, título, fecha, autor, clasificación) y editor de headers/footers (texto, numeración, logo) que se replican en todas las páginas del documento.",
     "FE2", "UX,EDITOR,EXPORT", "Normal", 13, 14, "R3", "P1-M3-021", "Media", "Medio", "Frontend", 20),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-018",
     "FE2: Modo offline con indicador de sincronización y queue local",
     "Implementación de modo offline usando Service Worker + IndexedDB: el usuario puede crear y editar informes sin conexión. Indicador visual de estado (online/offline/syncing). Cola local de cambios que se sincroniza automáticamente al recuperar conexión. Resolución visual de conflictos.",
     "FE2", "UX,OFFLINE,CRITICO", "High", 14, 16, "R4", "P1-M3-001", "Alta", "Alto", "Frontend", 32),

    # ── NUEVAS BE2: auditoría de seguridad continua ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-030",
     "BE2: Auditoría de seguridad de endpoints REST (OWASP pre-check)",
     "Revisión de seguridad pre-producción de todas las APIs: validación de input (SQL injection, XSS), headers de seguridad (CORS, CSP, HSTS), autenticación en cada endpoint, manejo seguro de errores (sin stack traces). Genera reporte de hallazgos.",
     "BE2", "SEGURIDAD,QA,CORE", "High", 15, 16, "R4", "P1-M2-019", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-031",
     "BE2: Implementar audit log centralizado (quién hizo qué, cuándo)",
     "Sistema de audit logging que registra toda operación sensible: login/logout, CRUD de informes, aprobaciones, firmas, exportaciones, cambios de permisos. Almacenamiento inmutable en tabla separada. Cumplimiento normativo minero.",
     "BE2", "SEGURIDAD,DB,CORE", "High", 14, 15, "R4", "P1-M2-019", "Alta", "Alto", "Backend", 24),

    # ── NUEVAS IA: procesamiento inteligente ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-032",
     "IA: Motor de clasificación automática de informes por tipo y urgencia",
     "Modelo de clasificación que analiza el contenido de informes y los clasifica automáticamente por tipo (incidente, rutina, gerencial, ambiental) y nivel de urgencia (crítico, alto, normal, bajo). Usa embeddings de texto + clasificador entrenado con datos mineros.",
     "IA", "IA,EDITOR", "Normal", 14, 16, "R4", "", "Alta", "Medio", "IA", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-033",
     "IA: Extracción automática de entidades mineras de informes (NER)",
     "Named Entity Recognition adaptado al dominio minero: extrae automáticamente nombres de zonas, equipos, minerales, concentraciones, fechas, personas mencionadas en los informes. Alimenta los tags y metadata automáticamente.",
     "IA", "IA,EDITOR", "Normal", 15, 16, "R4", "P1-M3-026", "Alta", "Medio", "IA", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-034",
     "IA: Detectar automaticamente si los trabajadores usan casco y chaleco en camaras de vigilancia",
     "Modelo de vision artificial que analiza las imagenes de las camaras de seguridad de la mina y detecta si los trabajadores estan usando correctamente su equipo de proteccion personal (casco, chaleco reflectante, lentes, guantes). Si detecta que alguien no lo usa, genera alerta automatica al supervisor. Entrenado con fotos reales de la mina.",
     "IA,BE2", "IA,SECURITY,SENSOR", "High", 13, 16, "R4", "", "Alta", "Alto", "IA", 48),

    # ── NUEVAS BACKEND MES4: APIs correspondientes al frontend ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-020",
     "BE1: API CRUD de comentarios y anotaciones sobre informes",
     "Endpoints REST para crear/leer/actualizar/eliminar comentarios anclados a posiciones del documento. Thread de respuestas, resolución de comentarios, notificación a participantes. Modelo JSONB con referencia a rango de texto.",
     "BE1", "CORE,EDITOR", "High", 13, 14, "R4", "P1-M2-008", "Media", "Medio", "Backend", 20),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-021",
     "BE1: API de clonación y duplicación de documentos",
     "Endpoint para duplicar un informe existente (deep clone): copia estructura JSONB, imágenes asociadas, metadatos. Usado para crear nuevo informe desde template o copiar informe anterior como base.",
     "BE1", "CORE,EDITOR", "Normal", 13, 14, "R4", "P1-M2-008", "Baja", "Bajo", "Backend", 12),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-022",
     "BE1: Numeración secuencial de reportes por tenant y tipo",
     "Generación de números de informe secuenciales con formato configurable por tenant: INF-2026-001, RPT-MINA-A-0042. Sequence PostgreSQL por tenant + tipo de informe. Thread-safe para concurrencia.",
     "BE1", "CORE,DB,EDITOR", "Normal", 13, 14, "R4", "P1-M2-007", "Baja", "Bajo", "Backend", 12),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-023",
     "Integrar cache Redis: guardar documentos frecuentes y sesiones de usuario en memoria rapida",
     "Configurar el sistema para que los documentos mas consultados, las sesiones de los usuarios y los resultados de busqueda se guarden temporalmente en memoria rapida (Redis). Esto reduce la carga a la base de datos en un 60% y hace que el sistema responda mas rapido. BE2 se encarga de cifrar los datos sensibles almacenados en cache.",
     "BE1,BE2", "CORE,DB,SEGURIDAD", "High", 14, 15, "R4", "P1-M2-007", "Alta", "Medio", "Backend", 20),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-024",
     "Proteccion contra uso excesivo del sistema: limitar peticiones por usuario",
     "Control que evita que un usuario o un atacante sobrecargue el sistema con demasiadas peticiones: maximo 100 consultas por minuto para lectura, 30 por minuto para escritura. Si se excede el limite, el sistema le pide esperar. Se registra todo intento de abuso.",
     "BE2", "CORE,SEGURIDAD", "High", 14, 15, "R4", "P1-M2-005", "Media", "Medio", "Backend", 16),

    # ── NUEVAS BE2 MES4: IA y firma digital ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-025",
     "BE2: Servicio de verificación de firma digital (PKI)",
     "Microservicio de firma digital de informes: generación de firma con clave privada del usuario, verificación de integridad del documento firmado, timestamp de firma (TSA), cadena de confianza. Compatible con estándares X.509.",
     "BE2", "SEGURIDAD,EDITOR,CORE", "High", 13, 14, "R4", "P1-M2-006", "Alta", "Alto", "Backend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-026",
     "BE2: AI — Generación de resumen ejecutivo automático de informes",
     "Servicio Python que usa LLM (LLaMa-3 local) para generar resúmenes ejecutivos de informes técnicos mineros. Input: informe JSONB completo. Output: resumen de 1 párrafo + bullet points clave. Procesamiento local, sin envío a nube.",
     "BE2,IA", "IA,EDITOR", "Normal", 14, 16, "R4", "", "Alta", "Alto", "Backend", 32),

    # ── NUEVAS BE3 MES4: integraciones ──

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-027",
     "Sistema de notificacion automatica a otros sistemas cuando ocurren eventos importantes",
     "Cuando ocurre un evento importante en la plataforma (informe aprobado, alerta de sensor critico, cambio de estado), el sistema avisa automaticamente a otros sistemas registrados. Si el aviso no llega, reintenta automaticamente. Se registra cada notificacion enviada.",
     "BE3", "CORE,NOTIF", "Normal", 14, 15, "R4", "P1-M2-005", "Media", "Medio", "Backend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-028",
     "BE3: Motor de resolución de conflictos para sincronización offline",
     "Engine de conflict resolution para el modo offline: cuando el usuario reconecta, el backend compara los deltas locales con el estado del servidor. Estrategias: last-write-wins para campos simples, merge automático para texto (CRDT-like), UI de resolución manual para conflictos irreconciliables.",
     "BE3", "CORE,OFFLINE,CRITICO", "High", 14, 16, "R4", "P1-M2-012", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-M4-029",
     "BE3: Pipeline de conversión de formatos (PDF rendering orchestrator)",
     "Servicio orquestador que coordina la generación de múltiples formatos de exportación desde un informe: PDF, DOCX, PPTX. Queue de renderizado con prioridad, monitoreo de progreso, notificación al completar. Maneja concurrencia de exportaciones simultáneas.",
     "BE3", "EXPORT,CORE", "High", 13, 15, "R4", "P1-M3-025", "Alta", "Medio", "Backend", 24),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 5 — OCTUBRE 2026 (01/10 al 31/10) — Semanas 18-22, Sprints 9-11
    # ██  Foco: VPS, seguridad, hardening, backup, DR, CI/CD, IA avanzada
    # ══════════════════════════════════════════════════════════════════════════

    # --- ORIGINALES ---
    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-001",
     "Disenar red del datacenter Lima y enlace con minas",
     "OBJETIVO: Definir como se conectan datacenter, minas y usuarios (fibra, 4G, satelite).\n\n"
     "PARA LA MINA: Conectividad confiable desde oficina, campo y zonas remotas.\n\n"
     "ENTREGABLE: Diagrama de red, VLANs, VPN WireGuard, plan multi-operador, DNS con failover.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026) — diseno previo puede usar staging.\n\n"
     "EXITO: ARQ y SYS aprueban topologia antes de instalar servidores.",
     "ARQ,SYS", "DEVOPS,ARCH,CRITICO", "Urgent", 17, 18, "R5", "P1-M4-011", "Alta", "Alto", "Infraestructura", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-002",
     "Configurar red privada y segmentos en datacenter Lima",
     "OBJETIVO: Crear redes separadas para app, bases de datos y administracion.\n\n"
     "PARA LA MINA: Mayor seguridad; un problema no afecta todo el sistema.\n\n"
     "ENTREGABLE: VLANs, firewall perimetral, tablas de ruteo, reglas de acceso.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026).\n\n"
     "DEPENDE DE: P2-M5-001.\n\n"
     "EXITO: Trafico de sensores y web aislado de administracion.",
     "SYS", "DEVOPS,SEGURIDAD", "Urgent", 17, 18, "R5", "P2-M5-001", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-003",
     "Instalar servidores VPS Linux en datacenter Tier III Lima",
     "OBJETIVO: Poner en marcha los servidores fisicos donde correra la plataforma en produccion.\n\n"
     "PARA LA MINA: Primer hardware productivo en Lima (<10 ms latencia local).\n\n"
     "ENTREGABLE: 2 VPS Ubuntu 22.04, Docker, NVMe, Nginx, acceso admin seguro.\n\n"
     "VPS REQUERIDO: SI — PRODUCCION. Contratar ~oct 2026 (semana 17).\n\n"
     "DEPENDE DE: P2-M5-002.\n\n"
     "EXITO: Servidores accesibles, hardening basico aplicado, listos para servicios.",
     "SYS", "DEVOPS,CRITICO", "Urgent", 17, 18, "R5", "P2-M5-002", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-004",
     "Crear estructura de usuarios, permisos y politicas de acceso al servidor",
     "Definicion de usuarios del sistema operativo, grupos, permisos de acceso a servicios y principio de minimo privilegio en servidores VPS del datacenter.",
     "SYS,BE2", "SEGURIDAD,DEVOPS", "High", 17, 18, "R5", "P2-M5-003", "Media", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-005",
     "Instalar y configurar orquestador de contenedores (Docker Swarm / K3s)",
     "Despliegue de Docker Swarm o K3s en servidores VPS del datacenter para administrar los servicios del sistema de forma automatizada.",
     "SYS", "DEVOPS,CRITICO", "Urgent", 18, 19, "R5", "P2-M5-003", "Alta", "Alto", "Infraestructura", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-006",
     "Blindaje de seguridad de servidores: firewall, bloqueo de accesos no autorizados",
     "Aplicar todas las protecciones de seguridad a los servidores: activar firewall, bloquear puertos innecesarios, proteger acceso remoto, bloquear intentos de intrucion repetidos.",
     "SYS,BE2", "SEGURIDAD,DEVOPS,CRITICO", "Urgent", 18, 19, "R5", "P2-M5-003", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-007",
     "Instalar certificados SSL dinámicos (Let's Encrypt / Wildcard)",
     "Automatización de certificados SSL con auto-renovación para todos los servicios.",
     "SYS", "SEGURIDAD,DEVOPS", "High", 18, 18, "R5", "P2-M5-003", "Media", "Medio", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-008",
     "Automatizar proceso de compilacion, pruebas y despliegue del sistema",
     "Crear proceso automatizado que al subir codigo nuevo: verifica calidad, compila, ejecuta pruebas, revisa seguridad y despliega en servidores de prueba y luego en produccion.",
     "SYS,BE1", "DEVOPS,CRITICO", "High", 18, 19, "R5", "P2-M5-005", "Alta", "Medio", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-009",
     "Configurar volumenes de disco dedicados para bases de datos y archivos",
     "Configuracion de discos NVMe dedicados en el VPS: particiones separadas para PostgreSQL, QuestDB, MinIO (archivos), logs y respaldos. Sistema de archivos XFS para alto rendimiento. Monitoreo de espacio disponible con alertas al 80% de uso.",
     "SYS", "DEVOPS", "High", 18, 19, "R5", "P2-M5-003", "Media", "Medio", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-010",
     "Instalar base de datos PostgreSQL con replica y alta disponibilidad",
     "Instalacion de PostgreSQL en VPS del datacenter con replica sincrona en segundo servidor y cambio automatico si el principal falla.",
     "SYS,BE1", "DB,DEVOPS,CRITICO", "Urgent", 18, 19, "R5", "P2-M5-003", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-011",
     "Configurar copias de seguridad continuas de la base de datos",
     "Respaldos automaticos continuos de la base de datos que permiten recuperar informacion hasta 5 minutos antes de cualquier falla. Retencion de 30 dias de respaldos.",
     "SYS,BE1", "DB,DEVOPS,SEGURIDAD", "High", 19, 20, "R5", "P2-M5-010", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-012",
     "Documentar procedimiento de recuperacion de base de datos ante fallos",
     "Manual paso a paso para restaurar la base de datos a cualquier momento en el tiempo. Incluye pruebas periodicas para verificar que los respaldos funcionan correctamente.",
     "SYS", "DB,DEVOPS,DOCUMENTACION", "High", 19, 20, "R5", "P2-M5-011", "Media", "Alto", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-013",
     "Plan de recuperacion ante desastres (DRP): que hacer si todo falla",
     "Plan completo para recuperar el sistema si ocurre un desastre: el sistema debe estar operativo en menos de 4 horas con perdida maxima de 5 minutos de datos. Incluye servidor secundario de respaldo.",
     "SYS,ARQ", "DEVOPS,SECURITY,CRITICO", "Urgent", 19, 20, "R5", "P2-M5-010", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-014",
     "Crear procesos automaticos de limpieza y mantenimiento de la base de datos",
     "Tareas programadas que se ejecutan automaticamente para mantener la base de datos saludable: liberar espacio, reconstruir indices, eliminar datos temporales antiguos.",
     "BE1,SYS", "DB,DEVOPS", "Normal", 19, 20, "R5", "P2-M5-010", "Media", "Bajo", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-015",
     "Instalar sistema de monitoreo de servidores y servicios (Prometheus + Grafana)",
     "Herramientas de vigilancia del estado de servidores, base de datos, aplicaciones y sensores. Pantallas graficas con alertas automaticas cuando algo falla.",
     "SYS", "DEVOPS,SENSOR", "High", 19, 20, "R5", "P2-M5-005", "Alta", "Medio", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-016",
     "Simulacro de falla: verificar que el sistema se recupera automaticamente",
     "Pruebas controladas donde se apaga un servidor a proposito para verificar que el sistema cambia automaticamente al servidor de respaldo sin que los usuarios se vean afectados.",
     "SYS,QA", "DEVOPS,QA,CRITICO", "High", 20, 20, "R5", "P2-M5-013", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-017",
     "Optimizar velocidad de respuesta del servidor (afinamiento de rendimiento)",
     "Analizar donde el sistema tarda mas y optimizar esas partes. El objetivo es que el 99% de las operaciones respondan en menos de 100 milisegundos.",
     "BE1,QA", "CORE,QA", "High", 19, 20, "R5", "P1-M3-010", "Alta", "Medio", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-018",
     "Optimizar consultas a la base de datos para respuestas mas rapidas",
     "Analizar las consultas mas lentas de la base de datos, crear indices y optimizar la estructura para que las busquedas y reportes se generen en segundos.",
     "BE1", "DB,CORE", "High", 19, 20, "R5", "P2-M5-010", "Alta", "Medio", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-019",
     "Milestone: Infraestructura Productiva Lista",
     "Validación de infraestructura completa: HA, DR, monitoreo, CI/CD, seguridad.",
     "ARQ,SYS", "CRITICO,DEVOPS", "Urgent", 20, 20, "R5", "P2-M5-016", "Baja", "Alto", "Infraestructura", 8),

    # ── NUEVAS BE2 MES5: IA avanzada y seguridad ──

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-020",
     "BE2: API de reconocimiento facial biométrico (InsightFace endpoint)",
     "Servicio para registro y verificacion de identidad facial: captura de rostro, extraccion de caracteristicas, comparacion con rostros registrados. Procesamiento con GPU local. Umbral configurable de similitud. Deteccion de intentos de fraude (fotos o videos falsos).",
     "BE2,IA", "IA,SEGURIDAD", "High", 17, 19, "R5", "P1-M2-006", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-021",
     "BE2: Detección de anomalías en streams de datos de sensores",
     "Motor de detección de anomalías sobre datos de telemetría en tiempo real: temperature spikes, pressure drops, vibración anormal. Algoritmos: Z-score, Isolation Forest, Moving Average. Genera alertas y triggers de notificación.",
     "BE2,IA", "IA,SENSOR,CRITICO", "High", 18, 20, "R5", "P1-M2-011", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-022",
     "IA: Revision integral automatica del informe (calidad, coherencia y completitud)",
     "La IA revisa automaticamente cada informe antes de enviarlo a aprobacion y genera una calificacion de 0 a 100 con recomendaciones: verifica que todas las secciones obligatorias esten completas, que los datos numericos sean coherentes (no se contradigan entre secciones), que la redaccion sea clara y profesional, que cumpla con la plantilla correspondiente. Ahorra tiempo de revision al supervisor.",
     "IA,BE2", "IA,EDITOR", "High", 19, 20, "R5", "P1-M4-026", "Alta", "Medio", "IA", 32),

    # ── NUEVA IA MES5: modelos avanzados ──

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-024",
     "IA: Convertir voz a texto para que el usuario dicte informes en espanol minero",
     "Servicio que permite al usuario dictar informes hablando en lugar de escribir: el usuario habla al microfono del dispositivo y el texto aparece en el editor en tiempo real. Optimizado para acento latinoamericano y vocabulario tecnico minero ('concentradora', 'molienda', 'relave'). Agrega puntuacion automatica. Respuesta en menos de 1 segundo por oracion.",
     "IA", "IA,EDITOR", "High", 17, 19, "R5", "P1-M4-026", "Alta", "Alto", "IA", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-025",
     "IA: Dashboard de analytics predictivo de operaciones mineras",
     "Módulo de IA que analiza tendencias históricas de telemetría y genera predicciones: mantenimiento predictivo de equipos, estimación de producción, detección temprana de riesgos geotécnicos. Visualización con gráficos en el dashboard.",
     "IA,FE1", "IA,SENSOR,GIS", "Normal", 18, 20, "R5", "P2-M5-021", "Alta", "Alto", "IA", 40),

    # ── NUEVA BE3 MES5: API gateway ──

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-M5-023",
     "BE3: API Gateway externo con circuit breaker y rate limiting global",
     "Punto de acceso unico para todas las conexiones externas al sistema: control de acceso con claves de API, limitacion de peticiones por cliente, proteccion contra caidas de servicios externos (circuit breaker), registro de todas las operaciones, versionado de API (v1/v2).",
     "BE3", "CORE,SECURITY,DEVOPS", "High", 18, 19, "R5", "P2-M5-005", "Alta", "Alto", "Backend", 24),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  MES 6 — NOVIEMBRE 2026 (01/11 al 30/11) — Semanas 23-26, Sprints 12-13
    # ██  Foco: Pruebas de estrés, UAT, marcha blanca, producción
    # ══════════════════════════════════════════════════════════════════════════

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-001",
     "Pruebas de estrés: 10,000 sensores simultáneos",
     "Simulación de carga máxima con 10K conexiones concurrentes de sensores IoT.",
     "QA,SYS,BE1", "QA,SENSOR,CRITICO", "Urgent", 21, 22, "R6", "P2-M5-019", "Alta", "Alto", "QA", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-002",
     "Pruebas de seguridad y penetración",
     "Pruebas profesionales de seguridad para intentar vulnerar el sistema: inyeccion de codigo, suplantacion de identidad, escalacion de permisos. Se verifica que el sistema resista todos los ataques conocidos.",
     "BE2,QA", "SEGURIDAD,QA,CRITICO", "Urgent", 21, 22, "R6", "P2-M5-006", "Alta", "Alto", "QA", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-003",
     "Simulacros de fallo y recuperación (DR drill)",
     "Prueba real del plan de recuperacion ante desastres: se corta el servicio principal, se activa el servidor de respaldo, se verifica que todos los datos esten intactos.",
     "SYS,QA", "DEVOPS,QA,CRITICO", "High", 22, 22, "R6", "P2-M5-013", "Alta", "Alto", "QA", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-004",
     "Pruebas UAT con usuarios de operaciones mineras",
     "User Acceptance Testing con ingenieros de mina, supervisores y gerencia usando datos reales.",
     "QA,FE2,ARQ", "QA,UX,CRITICO", "Urgent", 22, 23, "R6", "P2-M6-001", "Media", "Alto", "QA", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-005",
     "Ajuste fino de rendimiento post-pruebas",
     "Correccion de los problemas de lentitud y errores detectados durante las pruebas de estres y las pruebas con usuarios reales.",
     "BE1,SYS", "CORE,DEVOPS", "High", 23, 23, "R6", "P2-M6-001", "Alta", "Medio", "Backend", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-006",
     "Entrenamiento del Reconocimiento Facial y Traducción de Voz",
     "Fine-tuning de modelos de reconocimiento facial (InsightFace) y STT para español minero.",
     "IA", "IA,CRITICO", "High", 21, 23, "R6", "", "Alta", "Alto", "IA", 48),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-007",
     "Protección contra fraudes y controles de seguridad avanzada",
     "Implementación de detección de anomalías, rate limiting, honeypots y audit logging.",
     "BE2", "SEGURIDAD,CRITICO", "High", 21, 23, "R6", "P2-M5-006", "Alta", "Alto", "Backend", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-008",
     "Documentación final: manuales de usuario y operación",
     "Manuales de usuario final, guías de operación, runbooks, documentación de API.",
     "QA,ARQ", "DOCUMENTACION", "High", 23, 24, "R6", "P2-M6-004", "Media", "Bajo", "QA", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-009",
     "Marcha blanca con datos reales en unidad minera",
     "Despliegue beta controlado en la mina: supervisores seleccionados usando el sistema en producción.",
     "ARQ,SYS,QA", "GO_LIVE,CRITICO", "Urgent", 24, 25, "R6", "P2-M6-004", "Media", "Alto", "Arquitectura", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-010",
     "Corrección de bugs de marcha blanca",
     "Sprint de hotfixes para bugs detectados durante la marcha blanca.",
     "BE1,FE1,BE3", "CORE,GO_LIVE", "Urgent", 25, 25, "R6", "P2-M6-009", "Media", "Alto", "Backend", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-011",
     "Aprobación gerencial y firma de aceptación",
     "Presentación ejecutiva de resultados, métricas de calidad y firma de aceptación formal.",
     "ARQ", "GO_LIVE,CRITICO,DOCUMENTACION", "Urgent", 25, 26, "R6", "P2-M6-009", "Baja", "Alto", "Arquitectura", 8),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-012",
     "Pase a producción global (Hard-Launch LATAM)",
     "Lanzamiento oficial del sistema en produccion: cambio de direccion web al nuevo servidor, desactivacion del sistema antiguo, vigilancia activa 24/7.",
     "ARQ,SYS", "GO_LIVE,CRITICO", "Urgent", 26, 26, "R6", "P2-M6-011", "Media", "Alto", "Infraestructura", 16),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-013",
     "Soporte post-GoLive y estabilización (Semana 26)",
     "Vigilancia intensiva del sistema durante la primera semana en produccion. Equipo de soporte disponible para resolver cualquier problema critico que aparezca.",
     "BE1,SYS,QA", "GO_LIVE", "Urgent", 26, 26, "R6", "P2-M6-012", "Media", "Alto", "Backend", 40),

    # ── NUEVAS GoLive: pruebas del editor ──

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-014",
     "Pruebas de estrés del editor: 50 usuarios editando simultáneamente",
     "Simulación de carga del ReportStudio con 50 usuarios concurrentes editando informes diferentes. Medir auto-save latency, WebSocket stability, lock contention, memory usage del browser.",
     "QA,BE1", "QA,EDITOR,CRITICO", "High", 21, 22, "R6", "P2-M5-019", "Alta", "Alto", "QA", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "P2-M6-015",
     "Pruebas de exportación masiva (100 informes concurrentes)",
     "Stress test del pipeline de exportación: generar 100 PDFs/DOCXs simultáneamente. Validar queue ordering, calidad de output, memory leaks del motor de renderizado.",
     "QA,BE3", "QA,EXPORT", "High", 22, 22, "R6", "P1-M4-029", "Alta", "Medio", "QA", 16),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  TAREAS ADICIONALES PARA CARGA OPTIMA (~90%) DE TODOS LOS RECURSOS
    # ██  Organizadas por recurso principal + mes de ejecución
    # ══════════════════════════════════════════════════════════════════════════

    # ── ARQ: Gestión, supervisión, documentación, gobierno (+370h) ──

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G01", "Revisión semanal de arquitectura con equipo técnico",
     "Sesión semanal donde el Arquitecto TI revisa avance técnico, resuelve impedimentos de diseño, valida decisiones técnicas y asegura alineación del equipo con la arquitectura aprobada. 1h semanal × 26 semanas.",
     "ARQ,BE2", "ARQUITECTURA,PMO", "High", 1, 26, "R1", "", "Baja", "Bajo", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G02", "Reportes semanales de avance a Gerencia General",
     "Elaboración y presentación del reporte semanal de avance del proyecto: porcentaje de completitud por fase, riesgos activos, presupuesto ejecutado, hitos alcanzados. Formato ejecutivo de 1 página para Directorio.",
     "ARQ", "PMO,GERENCIA,DOCUMENTACION", "High", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G03", "Actualización quincenal del cronograma maestro en ClickUp",
     "Cada 2 semanas, el Arquitecto TI actualiza el cronograma en ClickUp: re-estima tareas, ajusta dependencias, rebalancea carga de recursos, actualiza fechas de milestones según avance real.",
     "ARQ", "PMO,DOCUMENTACION", "High", 1, 26, "R1", "", "Media", "Medio", "Arquitectura", 26),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G04", "Gestión de stakeholders y comunicación ejecutiva",
     "Coordinación continua con Gerencia Minera, Gerencia de TI y Directorio: gestión de expectativas, resolución de conflictos de prioridades, aprobaciones pendientes, comunicación de cambios de alcance.",
     "ARQ", "PMO,GERENCIA", "High", 1, 26, "R1", "", "Media", "Alto", "Arquitectura", 40),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G05", "Architecture Decision Records (ADR) por sprint",
     "Documentación formal de cada decisión arquitectónica importante: problema, alternativas evaluadas, decisión tomada, consecuencias. Un ADR por sprint mínimo. Registro vivo consultable por todo el equipo.",
     "ARQ,BE2", "ARQUITECTURA,DOCUMENTACION", "Normal", 1, 26, "R1", "", "Media", "Bajo", "Arquitectura", 26),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G06", "Revisiones de Production Readiness por release",
     "Antes de cada release (R1-R6), el Arquitecto TI lidera la revisión de preparación: checklist de calidad, seguridad, rendimiento, documentación, plan de rollback. Gate de aprobación obligatorio.",
     "ARQ", "ARQUITECTURA,CRITICO,PMO", "Urgent", 4, 26, "R1", "", "Media", "Alto", "Arquitectura", 24),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G07", "Control presupuestal y tracking de costos del proyecto",
     "Seguimiento mensual del presupuesto: costos reales vs estimados por recurso, costos de infraestructura, licencias, equipamiento. Alerta temprana de desviaciones >10%. Reporte a Gerencia Financiera.",
     "ARQ,BE2", "PMO,DOCUMENTACION", "Normal", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 26),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G08", "Proceso de gestión de cambios (Change Management)",
     "Establecer y operar el proceso formal de gestión de cambios: solicitud, evaluación de impacto, aprobación, implementación. Todo cambio de alcance, tecnología o timeline pasa por este proceso.",
     "ARQ", "PMO,DOCUMENTACION", "High", 2, 26, "R1", "", "Media", "Alto", "Arquitectura", 24),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G09", "Mentoring técnico y transferencia de conocimiento al equipo",
     "Sesiones de mentoría del Arquitecto TI hacia el equipo: buenas prácticas C++, patrones de diseño, revisión de código arquitectónico, pair programming en problemas complejos. 2h/semana.",
     "ARQ,IA", "ARQUITECTURA,DOCUMENTACION", "Normal", 3, 26, "R1", "", "Baja", "Bajo", "Arquitectura", 48),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G10", "Gestión de proveedores datacenter Lima y licencias",
     "Coordinación con proveedores del datacenter en Lima: contratos, SLAs, escalamientos, gestión de licencias de software, negociación de condiciones técnicas.",
     "ARQ,BE2", "PMO,SEG_INFRA", "Normal", 5, 20, "R2", "", "Media", "Medio", "Arquitectura", 24),

    # ── QA: Testing continuo, automatización, calidad (+605h) ──

    ("Control de calidad", "QA_Transversal", "QA-T01", "Desarrollo del framework de automatización de pruebas",
     "Construcción del framework base de testing automatizado: Cypress para e2e, Jest para unitarios, k6 para performance. Estructura de proyectos, helpers, fixtures, reporters. Base para todo el testing del proyecto.",
     "QA", "QA,CORE", "Urgent", 3, 6, "R2", "", "Alta", "Medio", "QA", 48),

    ("Control de calidad", "QA_Transversal", "QA-T02", "Testing de regresión continuo por sprint (quincenal)",
     "Ejecución completa de la suite de regresión al final de cada sprint: funcional, integración, rendimiento base. Reporte de resultados con métricas de cobertura y defectos encontrados. 4h × 13 sprints.",
     "QA", "QA,STRESS_TEST", "High", 5, 26, "R2", "QA-T01", "Media", "Medio", "QA", 104),

    ("Control de calidad", "QA_Transversal", "QA-T03", "Verificación diaria de builds y smoke testing",
     "Verificación diaria de que el build compila, pasa tests básicos y los servicios arrancan correctamente. Smoke test de los flujos críticos (login, crear informe, guardar, exportar). 30min/día × 130 días.",
     "QA", "QA,CORE", "High", 3, 26, "R1", "", "Baja", "Bajo", "QA", 65),

    ("Control de calidad", "QA_Transversal", "QA-T04", "Gestión de bugs: triage, priorización y seguimiento",
     "Proceso diario de triage de bugs reportados: clasificación por severidad (crítico/alto/medio/bajo), asignación a responsable, seguimiento hasta resolución. Métricas de defectos abiertos/cerrados por sprint.",
     "QA", "QA,PMO", "High", 5, 26, "R2", "", "Baja", "Medio", "QA", 78),

    ("Control de calidad", "QA_Transversal", "QA-T05", "Testing cross-browser y multi-dispositivo",
     "Pruebas sistemáticas de la plataforma en Chrome, Firefox, Edge y Safari. Verificación en resoluciones: desktop (1920×1080, 1366×768), tablet (1024×768), mobile (375×667). Reporte de incompatibilidades.",
     "QA,FE2", "QA,UX,TABLETS", "Normal", 9, 16, "R3", "", "Media", "Medio", "QA", 32),

    ("Control de calidad", "QA_Transversal", "QA-T06", "Pruebas de accesibilidad WCAG 2.1 nivel AA",
     "Auditoría de accesibilidad: navegación con teclado, lectores de pantalla (NVDA/VoiceOver), contraste de colores, textos alternativos, formularios accesibles. Cumplimiento de estándares internacionales.",
     "QA,FE2", "QA,UX,COMPLIANCE", "Normal", 13, 20, "R4", "", "Media", "Medio", "QA", 32),

    ("Control de calidad", "QA_Transversal", "QA-T07", "Creación y mantenimiento de datos de prueba",
     "Generación de datasets sintéticos que simulan datos reales de la mina: 10K sensores, 500 informes, 50 usuarios, 20 zonas geográficas. Scripts de seed para ambientes QA y staging.",
     "QA,BE3", "QA,DB", "High", 5, 8, "R2", "", "Media", "Medio", "QA", 32),

    ("Control de calidad", "QA_Transversal", "QA-T08", "Pruebas de rendimiento baseline por módulo",
     "Benchmarks de rendimiento de cada módulo: tiempo de carga de dashboard (<2s), tiempo de guardado de informe (<500ms), tiempo de exportación PDF (<5s), latencia de WebSocket (<20ms). Línea base para detectar regresiones.",
     "QA,BE1", "QA,STRESS_TEST,DATOS", "High", 9, 14, "R3", "QA-T01", "Alta", "Medio", "QA", 40),

    ("Control de calidad", "QA_Transversal", "QA-T09", "Desarrollo de scripts de pruebas de estrés",
     "Scripts especializados para simular carga: k6 para APIs, WebSocket load tester para sensores, Selenium Grid para usuarios concurrentes. Escenarios: 10K sensores, 100 usuarios, 50 exportaciones simultáneas.",
     "QA,SYS", "QA,STRESS_TEST", "High", 13, 20, "R4", "QA-T01", "Alta", "Alto", "QA", 40),

    ("Control de calidad", "QA_Transversal", "QA-T10", "Revisión de calidad de documentación técnica y funcional",
     "QA revisa toda la documentación del proyecto: manuales de usuario, documentación de API, arquitectura, runbooks. Verifica completitud, claridad, actualización. Feedback a autores para correcciones.",
     "QA", "QA,DOCUMENTACION", "Normal", 9, 26, "R3", "", "Baja", "Bajo", "QA", 40),

    ("Control de calidad", "QA_Transversal", "QA-T11", "Plan y ejecución de User Acceptance Testing (UAT)",
     "Planificación completa del UAT: selección de usuarios piloto en la mina, preparación de casos de prueba en lenguaje de negocio, coordinación logística, ejecución acompañada, recopilación de feedback.",
     "QA,FE2,ARQ", "QA,UX,SOPORTE", "High", 17, 22, "R5", "", "Media", "Alto", "QA", 40),

    ("Control de calidad", "QA_Transversal", "QA-T12", "Testing del editor en diferentes resoluciones y formatos",
     "Pruebas del ReportStudio en todas las resoluciones soportadas: verificar que reglas horizontales, tablas, imágenes y formatos se renderizan correctamente. Pruebas de impresión y exportación en cada resolución.",
     "QA,FE1", "QA,EDITOR", "Normal", 13, 16, "R4", "", "Media", "Medio", "QA", 24),

    ("Control de calidad", "QA_Transversal", "QA-T13", "Testing del modo offline y sincronización",
     "Escenarios de prueba de desconexion: editar informe sin conexion, reconectar y verificar sincronizacion. Conflictos de edicion simultanea. Perdida de conexion durante exportacion. Recuperacion de datos locales.",
     "QA,FE2", "QA,OFFLINE", "High", 15, 20, "R4", "", "Alta", "Alto", "QA", 32),

    # ── FE2: UX research, tablets, soporte, capacitación (+623h) ──

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "FE2-U01", "Investigación UX inicial: entrevistas con usuarios de mina",
     "Sesiones de investigación con ingenieros de mina, supervisores y operadores para entender cómo trabajan hoy, qué problemas tienen con los sistemas actuales, qué necesitan para su trabajo diario. Documentación de user personas y journey maps.",
     "FE2", "UX,SOPORTE,DOCUMENTACION", "High", 1, 4, "R1", "", "Media", "Medio", "Frontend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE2-U02", "Investigación UX continua: sesiones de usabilidad quincenal",
     "Sesiones de usabilidad con usuarios reales cada 2 semanas durante el desarrollo. Pruebas de prototipos, validación de flujos, detección de problemas de usabilidad. Reporte con hallazgos y recomendaciones priorizadas.",
     "FE2", "UX,SOPORTE", "High", 5, 26, "R2", "FE2-U01", "Media", "Medio", "Frontend", 78),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE2-U03", "Mantenimiento continuo del Design System y componentes",
     "Actualización del Design System a medida que se desarrollan nuevos componentes: documentación de uso, estados, variantes. Asegurar consistencia visual en toda la plataforma. Revisión de cumplimiento por sprint.",
     "FE2", "UX,DOCUMENTACION", "Normal", 5, 26, "R2", "P1-M1-014", "Media", "Bajo", "Frontend", 52),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE2-U04", "Diseño de pantallas específicas para tablets de campo",
     "Diseño e implementación de vistas optimizadas para tablets que se usan dentro de la mina: botones grandes (touch-friendly), lectura en luz solar, menús simplificados, modo de alta visibilidad. Compatible con guantes de seguridad.",
     "FE2", "UX,TABLETS,CRITICO", "High", 9, 14, "R3", "P1-M1-014", "Alta", "Alto", "Frontend", 48),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE2-U05", "Soporte multi-idioma de la plataforma (espanol, ingles, portugues)",
     "Preparar la plataforma para funcionar en 3 idiomas: espanol, ingles y portugues. El usuario puede cambiar el idioma en cualquier momento y toda la interfaz se traduce: menus, botones, mensajes, formatos de fecha y numeros. Necesario para operaciones mineras en varios paises de Latinoamerica.",
     "FE2,FE1", "UX,INTEGRACION", "Normal", 11, 16, "R3", "", "Alta", "Medio", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U06", "Diseño de templates de email para notificaciones del sistema",
     "Diseño de plantillas HTML responsive para emails transaccionales: aprobación de informe, alerta de sensor, recordatorio de revisión, bienvenida. Branding corporativo minero, compatibilidad con Outlook/Gmail.",
     "FE2", "UX,NOTIF", "Normal", 13, 14, "R4", "", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U07", "Diseño de plantillas visuales corporativas de informes",
     "Diseño de 10+ plantillas de informes mineros con carátula, membrete, estilos de tabla, gráficos corporativos: Informe Diario, Informe Semanal, Reporte de Incidente, Informe Gerencial, Reporte Ambiental, etc.",
     "FE2", "UX,EDITOR,EXPORT", "High", 13, 16, "R4", "P1-M1-014", "Alta", "Medio", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U08", "Guia interactiva de bienvenida para nuevos usuarios de la plataforma",
     "Cuando un usuario entra por primera vez a la plataforma, se muestra un tour guiado paso a paso: como configurar su perfil, como crear su primer informe, como usar el editor, como aprobar documentos. El objetivo es que el usuario pueda empezar a trabajar sin necesidad de capacitacion externa.",
     "FE2", "UX,SOPORTE", "Normal", 14, 16, "R4", "", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U09", "Sistema de ayuda contextual (tooltips, guías, FAQ)",
     "Implementación de ayuda contextual en cada módulo: tooltips en iconos/botones, guías paso a paso para flujos complejos (aprobación, exportación, firma), sección de FAQ. Reducir tickets de soporte.",
     "FE2", "UX,SOPORTE", "Normal", 14, 16, "R4", "", "Media", "Bajo", "Frontend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U10", "Diseño del módulo de administración (usuarios, roles, config)",
     "Pantallas administrativas para el administrador del sistema: gestión de usuarios, asignación de roles, configuración de tenant, logs de auditoría visual, configuración de notificaciones, parámetros del sistema.",
     "FE2,FE1", "UX,SECURITY,GERENCIA", "High", 13, 16, "R4", "", "Alta", "Medio", "Frontend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE2-U11", "Diseño del dashboard ejecutivo para Gerencia",
     "Dashboard de alto nivel para gerentes y directores: KPIs de producción, estado de informes, alertas de sensores, mapa ejecutivo simplificado, indicadores de cumplimiento. Vista de un vistazo (glanceable).",
     "FE2", "UX,GERENCIA", "High", 14, 16, "R4", "P1-M1-016", "Alta", "Medio", "Frontend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "FE2-U12", "Auditoría de accesibilidad WCAG completa y correcciones",
     "Auditoría exhaustiva de accesibilidad en toda la plataforma: contraste, navegación por teclado, ARIA labels, formularios, tablas de datos. Corrección de todos los hallazgos nivel AA.",
     "FE2,QA", "UX,COMPLIANCE,QA", "High", 17, 20, "R5", "", "Alta", "Medio", "Frontend", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "FE2-U13", "Pruebas de usabilidad en entorno minero real (in-situ)",
     "Visita a la unidad minera para pruebas de usabilidad in-situ: usar la plataforma en condiciones reales (polvo, luz solar, guantes, ruido). Documentar problemas específicos del entorno y ajustar la UX.",
     "FE2,ARQ", "UX,SOPORTE,TABLETS", "High", 17, 18, "R5", "", "Media", "Alto", "Frontend", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "FE2-U14", "Material de capacitación para usuarios finales",
     "Creación de material de entrenamiento: video-tutoriales (5-10 min cada uno), guía rápida imprimible (2 páginas), manual de usuario completo, guía de troubleshooting. Para supervisores, ingenieros y gerentes.",
     "FE2,QA", "SOPORTE,DOCUMENTACION", "High", 21, 24, "R6", "", "Media", "Medio", "Frontend", 48),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "FE2-U15", "Soporte a usuarios durante marcha blanca y GoLive",
     "Soporte dedicado on-site y remoto durante la marcha blanca: resolver dudas de usuarios, registrar issues, priorizar bugs de UX, ajustes rápidos de interfaz basados en feedback directo.",
     "FE2", "SOPORTE,GO_LIVE", "Urgent", 24, 26, "R6", "", "Media", "Alto", "Frontend", 60),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "FE2-U16", "Documentación de guías de usuario visuales (screenshots)",
     "Manual de usuario visual con capturas de pantalla anotadas de cada flujo: cómo crear un informe, cómo aprobar, cómo exportar, cómo usar el mapa, cómo configurar alertas. Formato PDF y ayuda online.",
     "FE2", "DOCUMENTACION,SOPORTE", "High", 23, 26, "R6", "", "Media", "Bajo", "Frontend", 40),

    # ── IA: Modelos, MLOps, NLP, visión, analytics (+628h) ──

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "IA-M01", "Recopilar y preparar datos reales de la mina para entrenar los modelos de IA",
     "Recopilar datos necesarios para que la inteligencia artificial aprenda: fotografias de trabajadores con y sin equipo de proteccion personal (casco, chaleco, lentes), grabaciones de voz con vocabulario tecnico minero, e informes historicos de la mina para que la IA aprenda a corregir y predecir texto. Limpiar, etiquetar y organizar estos datos.",
     "IA", "MLOPS,IA,DATOS", "High", 1, 4, "R1", "", "Alta", "Alto", "IA", 48),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "IA-M02", "Pipeline de preprocesamiento de datos para modelos de IA",
     "Construcción de pipelines automatizados de preprocesamiento: normalización de imágenes, augmentation, tokenización de texto, feature extraction de audio. Reproducibles y versionados con DVC.",
     "IA", "MLOPS,IA", "High", 5, 8, "R2", "IA-M01", "Alta", "Medio", "IA", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "IA-M03", "Preparar servidor de Inteligencia Artificial (GPU + MLflow)",
     "OBJETIVO: Infraestructura para entrenar, probar y publicar modelos de IA del proyecto.\n\n"
     "PARA LA MINA: Base para OCR, prediccion de fallas, sugerencias en informes y analisis de sensores.\n\n"
     "ENTREGABLE: Servidor con GPU, MLflow, pipeline de despliegue de modelos, acceso seguro para equipo IA.\n\n"
     "VPS REQUERIDO: SI — puede ser nodo GPU en VPS desarrollo o servidor dedicado (~agosto 2026, semana 9).\n\n"
     "DEPENDE DE: DEV-003 (VPS desarrollo operativo).\n\n"
     "EXITO: Equipo IA entrena un modelo y lo publica en ambiente compartido.",
     "IA,SYS", "MLOPS,IA,DEVOPS", "High", 9, 11, "R3", "DEV-003", "Alta", "Alto", "IA", 48),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "IA-M04", "Servicio OCR para documentos escaneados en mina",
     "Microservicio de OCR que permite subir documentos escaneados (partes de trabajo, formularios en papel) y extraer texto automáticamente. Usa Tesseract + post-procesamiento con NLP para limpiar resultados.",
     "IA", "IA,EDITOR", "Normal", 9, 12, "R3", "IA-M02", "Alta", "Medio", "IA", 40),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "IA-M05", "Motor de recomendaciones de informes similares",
     "Sistema que sugiere informes similares al que el usuario está creando: 'Otros informes sobre esta zona', 'Informes similares del mes anterior'. Usa embeddings de texto + búsqueda vectorial.",
     "IA", "IA,EDITOR,DATOS", "Normal", 10, 12, "R3", "IA-M02", "Alta", "Medio", "IA", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "IA-M06", "Detectar automaticamente la urgencia de informes de incidentes",
     "La IA analiza el contenido de los informes de incidentes y determina automaticamente su nivel de urgencia: detecta palabras de alerta ('colapso', 'fuga', 'evacuacion'), evalua la gravedad descrita, y si detecta un informe critico, lo escala automaticamente al supervisor inmediato con notificacion prioritaria.",
     "IA", "IA,EDITOR,NOTIF", "Normal", 10, 12, "R3", "IA-M02", "Alta", "Medio", "IA", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "IA-M07", "Prediccion de escritura en linea: sugerir texto mientras el usuario escribe",
     "Mientras el usuario escribe en el editor de informes, la IA muestra sugerencias en gris que el usuario puede aceptar con Tab: completa terminos tecnicos ('chan' -> 'chancadora primaria'), sugiere nombres de zonas de la mina, completa frases frecuentes en informes. El modelo esta entrenado con informes historicos de la operacion minera.",
     "IA", "IA,EDITOR", "High", 13, 16, "R4", "IA-M02", "Alta", "Medio", "IA", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "IA-M08", "API de generación de gráficos inteligentes desde datos",
     "Servicio que recibe datos tabulares del informe y sugiere automáticamente el mejor tipo de gráfico (barras, líneas, pie, scatter). Genera el gráfico con título y etiquetas automáticos.",
     "IA,FE1", "IA,EDITOR,EXPORT", "Normal", 14, 16, "R4", "", "Alta", "Medio", "IA", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M09", "IA: Informe predictivo de fallas y eventos criticos en equipos de la mina",
     "Modelo de inteligencia artificial que analiza continuamente los datos de sensores (vibracion, temperatura, presion, desgaste) y predice fallas ANTES de que ocurran: 'La bomba #3 tiene 85% de probabilidad de fallar en las proximas 48 horas'. Genera informe predictivo automatico con recomendaciones de mantenimiento preventivo. Alerta al equipo de mantenimiento con 24-72 horas de anticipacion, evitando paradas no planificadas que cuestan miles de dolares.",
     "IA", "IA,SENSOR,MLOPS", "High", 17, 20, "R5", "P2-M5-021", "Alta", "Alto", "IA", 56),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M18", "IA: Mejora automatica del contexto y redaccion de textos del informe",
     "La IA sugiere mejoras de redaccion mientras el usuario escribe: detecta frases confusas o ambiguas y propone alternativas mas claras, sugiere sinonimos tecnicos mas precisos, mejora la estructura de parrafos, verifica que las conclusiones sean coherentes con los datos presentados. El usuario acepta o rechaza cada sugerencia.",
     "IA", "IA,EDITOR", "High", 17, 20, "R5", "P1-M3-026", "Alta", "Medio", "IA", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M19", "IA: Corrector integral de documentos — verificacion de datos, referencias y formulas",
     "Herramienta de IA que revisa la integridad completa del informe: verifica que las formulas y calculos sean correctos, que las referencias cruzadas entre secciones coincidan, que las unidades de medida sean consistentes (no mezclar kg con toneladas sin conversion), que las fechas y nombres mencionados existan en el sistema. Genera reporte de errores encontrados.",
     "IA", "IA,EDITOR,DATOS", "High", 19, 22, "R5", "P2-M5-022", "Alta", "Alto", "IA", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M10", "Optimización y compresión de modelos para inferencia rápida",
     "Optimización de modelos para producción: cuantización INT8, pruning, ONNX export, benchmarking de latencia. Target: reconocimiento facial <200ms, NLP <100ms, detección EPP <500ms.",
     "IA", "MLOPS,IA", "High", 17, 20, "R5", "", "Alta", "Medio", "IA", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M11", "Documentación completa de modelos, métricas y limitaciones",
     "Model Cards para cada modelo en producción: arquitectura, datos de entrenamiento, métricas de accuracy/recall/F1, limitaciones conocidas, sesgos detectados, condiciones de uso. Requerido para auditoría.",
     "IA", "MLOPS,DOC,COMPLIANCE", "Normal", 19, 22, "R5", "", "Media", "Bajo", "IA", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M12", "Benchmark y evaluación comparativa de modelos en producción",
     "Evaluación rigurosa de cada modelo con datos de validación mineros reales: accuracy por condición (día/noche, polvo, distancia), falsos positivos/negativos, comparación con baseline humano.",
     "IA,QA", "MLOPS,QA,IA", "High", 19, 22, "R5", "IA-M10", "Alta", "Alto", "IA", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "IA-M13", "Vigilar que los modelos de IA sigan funcionando correctamente en produccion",
     "Sistema que monitorea continuamente la calidad de las predicciones de la IA en produccion: si un modelo empieza a equivocarse mas de lo normal (porque los datos cambiaron o las condiciones son diferentes a las de entrenamiento), el sistema genera alerta automatica indicando que necesita re-entrenamiento.",
     "IA", "MLOPS,IA,DEVOPS", "High", 21, 26, "R6", "IA-M10", "Alta", "Alto", "IA", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "IA-M14", "Entrenamiento con datos reales de producción (fine-tuning final)",
     "Una vez en producción, re-entrenar modelos con datos reales de la mina (en lugar de datos sintéticos/históricos). Mejora significativa en accuracy. Fine-tuning de STT con acentos locales.",
     "IA", "MLOPS,IA", "High", 24, 26, "R6", "IA-M13", "Alta", "Alto", "IA", 48),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "IA-M15", "Pipeline de evaluación automática de calidad de datos",
     "Sistema que evalúa la calidad de los datasets de entrenamiento: detección de duplicados, valores faltantes, distribución de clases, outliers. Reporte automático de calidad. Gate de calidad antes de entrenar.",
     "IA", "MLOPS,IA,DATOS", "High", 10, 12, "R3", "IA-M01", "Alta", "Medio", "IA", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "IA-M16", "Modelo de detección de anomalías en informes (contenido)",
     "Detector de anomalías en contenido de informes: valores numéricos fuera de rango, textos duplicados de informes anteriores, secciones faltantes obligatorias. Alertas antes de la aprobación del informe.",
     "IA", "IA,EDITOR,QA", "Normal", 14, 16, "R4", "IA-M02", "Alta", "Medio", "IA", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "IA-M17", "Dashboard de métricas de todos los modelos de IA en producción",
     "Panel unificado con las métricas de cada modelo: accuracy actual, número de inferencias/día, latencia p50/p95, drift score, fecha de último re-entrenamiento. Visible para equipo técnico y gerencia.",
     "IA", "MLOPS,IA,GERENCIA", "High", 19, 22, "R5", "IA-M12", "Alta", "Medio", "IA", 40),

    # ── BE2: Seguridad continua, compliance, hardening (+526h) ──

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "BE2-S01", "Auditoría de seguridad por sprint (revisión quincenal)",
     "Revisión de seguridad recurrente cada sprint: nuevo código, nuevos endpoints, nuevas dependencias. Checklist OWASP, análisis de dependencias (CVE), revisión de secrets, validación de permisos.",
     "BE2", "SEGURIDAD,QA,COMPLIANCE", "High", 5, 26, "R2", "", "Media", "Alto", "Backend", 52),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "BE2-S02", "Escaneo automatizado de vulnerabilidades en dependencias",
     "Configuración de escaneo automático de vulnerabilidades en dependencias C++ (vcpkg), Python (pip), JavaScript (npm). Integración en CI/CD. Alerta y bloqueo de builds con CVEs críticos.",
     "BE2", "SEGURIDAD,DEVOPS", "High", 5, 8, "R2", "", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE2-S04", "Control de sesiones de usuario: desconexion automatica y limite de accesos simultaneos",
     "Seguridad de las sesiones de usuario: cierre automatico despues de 30 minutos sin actividad, maximo 8 horas de sesion continua, posibilidad de cerrar sesiones remotamente, maximo 3 sesiones simultaneas por usuario, alerta si se detecta acceso desde una ubicacion inusual.",
     "BE2", "SEGURIDAD,CORE", "High", 9, 10, "R3", "P1-M2-006", "Alta", "Alto", "Backend", 24),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE2-S05", "Proteccion contra ataques: filtro de datos maliciosos en formularios y editor",
     "Sistema centralizado que filtra y bloquea datos peligrosos que un atacante podria enviar al sistema: inyeccion de codigo en formularios, scripts maliciosos en el editor de informes, manipulacion de peticiones. Cada dato que entra al sistema pasa por este filtro antes de procesarse.",
     "BE2", "SEGURIDAD,CORE,EDITOR", "Urgent", 9, 12, "R3", "", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE2-S06", "Configuración de headers de seguridad HTTP (CORS, CSP, HSTS)",
     "Implementación de todos los headers de seguridad: Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, CORS restrictivo. Configuración por ambiente.",
     "BE2", "SEGURIDAD,DEVOPS", "High", 9, 10, "R3", "", "Media", "Medio", "Backend", 16),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE2-S07", "Documentación de compliance minero y protección de datos personales",
     "Documentación de cumplimiento: política de privacidad, tratamiento de datos biométricos (ley de protección de datos Perú), retención de datos, acceso a información, derecho al olvido. Requerido por legal.",
     "BE2,ARQ", "COMPLIANCE,DOC,SEGURIDAD", "High", 13, 16, "R4", "", "Media", "Alto", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE2-S08", "Servicio de rotación automática de claves criptográficas",
     "Sistema automatizado de rotación de claves: JWT signing keys (cada 30 días), encryption keys (cada 90 días), API keys de integraciones. Zero-downtime rotation, backward compatibility durante ventana de transición.",
     "BE2", "SEGURIDAD,CORE", "High", 13, 14, "R4", "P1-M2-006", "Alta", "Alto", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S09", "Monitoreo de seguridad y alertas (SIEM básico)",
     "Stack básico de SIEM: recolección de logs de seguridad, correlación de eventos, alertas de anomalías (múltiples intentos de login fallidos, acceso desde IP inusual, escalación de privilegios). Dashboard de seguridad.",
     "BE2", "SEGURIDAD,DEVOPS,SEG_INFRA", "High", 17, 20, "R5", "", "Alta", "Alto", "Backend", 40),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S10", "Hardening de contenedores Docker (security scanning)",
     "Seguridad de contenedores: imagen base mínima (distroless), escaneo de imágenes (Trivy), no root, read-only filesystem, seccomp profiles, network policies. Checklist de seguridad por contenedor.",
     "BE2", "SEGURIDAD,DEVOPS,SEG_INFRA", "High", 18, 20, "R5", "", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S11", "Playbook de respuesta a incidentes de seguridad",
     "Documento operativo: qué hacer en caso de brecha de seguridad, acceso no autorizado, ransomware, DDoS. Roles, contactos, pasos de contención, comunicación, evidencia forense. Simulacro incluido.",
     "BE2,ARQ", "SEGURIDAD,RECUPERACION,DOCUMENTACION", "High", 17, 18, "R5", "", "Media", "Alto", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S12", "Encriptación de backups y verificación de integridad",
     "Todos los backups se encriptan con AES-256-GCM antes del almacenamiento. Verificación de integridad con SHA-256 checksums. Testing mensual de restauración desde backup encriptado. Chain of custody documentada.",
     "BE2", "SEGURIDAD,RECUPERACION,SEG_INFRA", "High", 19, 20, "R5", "", "Alta", "Alto", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S13", "Capacitación de seguridad al equipo de desarrollo",
     "Sesión de capacitación sobre desarrollo seguro: OWASP Top 10, manejo seguro de secrets, revisión de código seguro, principio de mínimo privilegio. 2 sesiones de 4h para todo el equipo.",
     "BE2", "SEGURIDAD,DOCUMENTACION", "Normal", 19, 20, "R5", "", "Baja", "Bajo", "Backend", 16),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "BE2-S14", "Testing de recuperación ante ataques simulados",
     "Simulacros controlados de seguridad: ataque de saturacion simulado (verificar proteccion contra sobrecarga), intento de inyeccion de codigo (verificar filtros de seguridad), intento de acceso no autorizado (verificar permisos por rol), acceso con credenciales comprometidas (verificar bloqueo automatico).",
     "BE2,QA", "SEGURIDAD,STRESS_TEST,QA", "High", 22, 24, "R6", "BE2-S11", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "BE2-S15", "Auditoría de seguridad final pre-GoLive",
     "Auditoría de seguridad completa antes del lanzamiento: pentesting externo, revisión de configuraciones, verificación de encriptación, validación de permisos, escaneo de vulnerabilidades final. Go/NoGo de seguridad.",
     "BE2,ARQ", "SEGURIDAD,COMPLIANCE,CRITICO", "Urgent", 24, 25, "R6", "", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE2-S16", "Gestión segura de secretos y credenciales (HashiCorp Vault)",
     "Implementación de vault para gestión centralizada de secretos: API keys, contraseñas de BD, certificados. Acceso por políticas, rotación automática, auditoría de accesos. Eliminación de secrets en código/configs.",
     "BE2", "SEGURIDAD,DEVOPS,SEG_INFRA", "High", 10, 12, "R3", "", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE2-S17", "Revision de seguridad de servicios de terceros integrados",
     "Auditoria de seguridad de cada servicio externo integrado (SMS gateway, servicios de correo, APIs de notificacion): verificar autenticacion, cifrado en transito, validacion de certificados, manejo de tokens, tiempos de espera. Documentar riesgos de cada integracion.",
     "BE2", "SEGURIDAD,INTEGRACION,COMPLIANCE", "High", 14, 16, "R4", "", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE2-S18", "Testing de penetración interno (preparación pre-auditoría)",
     "Pentesting interno usando herramientas automatizadas (OWASP ZAP, Burp Suite): escaneo de endpoints, fuzzing de inputs, testing de autenticación/autorización, análisis de cookies/tokens. Reporte con hallazgos.",
     "BE2", "SEGURIDAD,QA,STRESS_TEST", "High", 17, 20, "R5", "", "Alta", "Alto", "Backend", 40),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "BE2-S19", "Monitoreo de seguridad en producción durante marcha blanca",
     "Vigilancia activa de seguridad durante las primeras semanas en produccion: revision de registros de acceso, deteccion de patrones anomalos, verificacion de limites de peticiones, validacion de controles de acceso activos.",
     "BE2", "SEGURIDAD,GO_LIVE", "Urgent", 24, 26, "R6", "", "Media", "Alto", "Backend", 48),

    # ── BE3: Integraciones, APIs, monitoring, conectividad (+401h) ──

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "BE3-I01", "Documentación API completa (Swagger/OpenAPI 3.0)",
     "Documentación auto-generada de todas las APIs REST: endpoints, parámetros, respuestas, códigos de error, ejemplos. Portal interactivo Swagger UI para el equipo y futuros integradores.",
     "BE3", "INTEGRACION,DOC,CORE", "High", 7, 10, "R2", "P1-M2-005", "Media", "Bajo", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE3-I02", "Monitoreo de salud de integraciones (health dashboard)",
     "Dashboard de monitoreo que muestra el estado de cada integración: API legacy (up/down/degraded), Kafka (lag, throughput), ETL (última ejecución, errores), WebSocket (conexiones activas). Alertas automáticas.",
     "BE3", "INTEGRACION,DEVOPS", "High", 9, 12, "R3", "", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE3-I03", "Sistema centralizado de deteccion y alerta de errores del sistema",
     "Herramienta que captura automaticamente cualquier error que ocurra en el servidor o en la pantalla de los usuarios. Los errores se agrupan por tipo, se muestra donde ocurrieron, y se envia alerta automatica al equipo de desarrollo. Panel de control con lista de errores ordenados por gravedad.",
     "BE3", "INTEGRACION,DEVOPS", "High", 9, 12, "R3", "", "Alta", "Medio", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "BE3-I04", "Agregación centralizada de logs (ELK/Loki)",
     "Stack de logs centralizado: recolección de logs de todos los servicios (backend, frontend, DB, Kafka), almacenamiento centralizado, búsqueda, correlación por request-id. Retención 30 días. Dashboard en Grafana.",
     "BE3", "INTEGRACION,DEVOPS", "High", 9, 12, "R3", "", "Alta", "Medio", "Backend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE3-I07", "Servicio SMS y WhatsApp para alertas críticas de sensores",
     "Integración con gateway SMS (Twilio/local) y WhatsApp Business API para enviar alertas críticas: sensor fuera de rango, equipo en falla, incidente de seguridad. Solo para alertas severity=CRITICAL.",
     "BE3", "NOTIF,SENSOR,INTEGRACION", "High", 14, 16, "R4", "P1-M3-027", "Alta", "Alto", "Backend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE3-I08", "Notificaciones in-app en tiempo real (vía WebSocket)",
     "Sistema de notificaciones dentro de la plataforma vía WebSocket: badge con contador, panel de notificaciones, sonido configurable. Tipos: informe pendiente, aprobación recibida, alerta sensor, mención en comentario.",
     "BE3", "NOTIF,CORE,INTEGRACION", "High", 13, 15, "R4", "P1-M2-003", "Alta", "Medio", "Backend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "BE3-I09", "Proteccion contra fallas de servicios externos: reintento automatico y desconexion temporal",
     "Cuando un servicio externo falla (SMS, email, sistema antiguo), el sistema reintenta automaticamente con tiempos de espera crecientes. Si el servicio sigue fallando, el sistema se desconecta temporalmente para no bloquearse y sigue funcionando con el resto de funcionalidades.",
     "BE3", "INTEGRACION,CORE", "High", 14, 16, "R4", "", "Alta", "Alto", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE3-I10", "Testing de integraciones end-to-end con datos reales",
     "Pruebas completas de cada integracion con datos reales del ambiente de pruebas: proceso completo de carga de datos, sincronizacion con sistema antiguo ida y vuelta, notificaciones, exportacion de informes. Verificacion de integridad de datos.",
     "BE3,QA", "INTEGRACION,QA", "High", 17, 18, "R5", "", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE3-I11", "Monitoreo de Kafka/Redpanda: lag, throughput, particiones",
     "Dashboard de monitoreo del message broker: consumer lag por topic, throughput (msgs/s), estado de particiones, disk usage, replication status. Alertas por lag excesivo (>1000 msgs).",
     "BE3", "INTEGRACION,SENSOR,DEVOPS", "Normal", 18, 20, "R5", "", "Media", "Medio", "Backend", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE3-I12", "Verificación de integridad de sincronización de datos",
     "Proceso automatizado de verificación: comparar datos entre sistema legacy y plataforma nueva, detectar discrepancias, generar reporte de diferencias. Ejecutar antes de cada release y durante marcha blanca.",
     "BE3,QA", "INTEGRACION,QA,DATOS", "High", 19, 22, "R5", "", "Alta", "Alto", "Backend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "BE3-I13", "Servicio de rate limiting por tenant y por endpoint",
     "Control de tráfico por API: límites de peticiones por tenant (1000 req/min), por endpoint (100 req/min para exportaciones), por usuario. Respuesta 429 con retry-after. Dashboard de consumo de API.",
     "BE3", "INTEGRACION,SECURITY,CORE", "High", 18, 20, "R5", "", "Alta", "Medio", "Backend", 32),

    # ── SYS: Infraestructura (inicio mes 2 = julio 2026; VPS dev semana 8) ──

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "SYS-I01", "Automatizar instalacion de servidores (Ansible)",
     "OBJETIVO: Levantar un servidor identico en minutos si falla o hay que escalar.\n\n"
     "PARA LA MINA: Menos tiempo caido; recuperacion rapida en faena.\n\n"
     "ENTREGABLE: Playbooks Ansible (OS, Docker, servicios, red, seguridad basica).\n\n"
     "VPS REQUERIDO: Desarrollo (desde semana 7, jul 2026).\n\n"
     "DEPENDE DE: DEV-002.\n\n"
     "EXITO: Servidor nuevo listo en <30 minutos ejecutando un playbook.",
     "SYS,BE3", "DEVOPS,SEG_INFRA", "High", 7, 9, "R2", "DEV-002", "Alta", "Medio", "Infraestructura", 32),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "SYS-I02", "Centralizar logs del sistema (Loki + Grafana)",
     "OBJETIVO: Ver en un solo lugar errores y eventos de todos los servicios.\n\n"
     "PARA LA MINA: Diagnosticar fallas de sensores, informes o login sin revisar cada servidor.\n\n"
     "ENTREGABLE: Loki + Promtail + Grafana con busqueda y retencion 90 dias.\n\n"
     "VPS REQUERIDO: Desarrollo (jul 2026).\n\n"
     "DEPENDE DE: DEV-003.\n\n"
     "EXITO: Un error en backend aparece en dashboard en menos de 1 minuto.",
     "SYS,BE3", "DEVOPS,SEG_INFRA", "High", 7, 9, "R2", "DEV-003", "Alta", "Medio", "Infraestructura", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "SYS-I03", "Configurar dominios y DNS de la plataforma",
     "OBJETIVO: Que usuarios accedan con URLs claras por ambiente (dev, pruebas, produccion).\n\n"
     "PARA LA MINA: Operadores entran a app.plataforma.com; desarrollo en dev.plataforma.com.\n\n"
     "ENTREGABLE: DNS, subdominios, failover DNS al servidor de respaldo.\n\n"
     "VPS REQUERIDO: Desarrollo + staging (ago 2026).\n\n"
     "DEPENDE DE: DEV-003.\n\n"
     "EXITO: Cada ambiente tiene URL propia y certificado SSL valido.",
     "SYS", "REDES,DEVOPS", "Normal", 9, 10, "R3", "DEV-003", "Baja", "Bajo", "Infraestructura", 12),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "SYS-I04", "Gestionar parches de seguridad del sistema operativo",
     "OBJETIVO: Mantener servidores Linux actualizados sin sorpresas en produccion.\n\n"
     "PARA LA MINA: Reduce riesgo de intrusion o caida por vulnerabilidades conocidas.\n\n"
     "ENTREGABLE: Proceso mensual: evaluar parches -> probar en staging -> aplicar en prod.\n\n"
     "VPS REQUERIDO: Todos (desde ago 2026, continuo).\n\n"
     "DEPENDE DE: DEV-003.\n\n"
     "EXITO: Registro de parches aplicados; cero servidores con CVE critico sin parche.",
     "SYS", "SEG_INFRA,SEGURIDAD", "High", 9, 26, "R3", "DEV-003", "Media", "Alto", "Infraestructura", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "SYS-I05", "Mantenimiento semanal de bases de datos",
     "OBJETIVO: Mantener PostgreSQL, QuestDB y Redis rapidos y sin llenar discos.\n\n"
     "PARA LA MINA: Telemetria e informes siguen respondiendo con miles de sensores activos.\n\n"
     "ENTREGABLE: Rutina semanal (2h): limpieza, indices, consultas lentas, alertas de espacio.\n\n"
     "VPS REQUERIDO: Desarrollo desde semana 10; produccion desde oct 2026.\n\n"
     "DEPENDE DE: DEV-003 (BD instalada).\n\n"
     "EXITO: Sin caidas por disco lleno; consultas criticas bajo umbral acordado.",
     "BE1,SYS", "DB,DEVOPS", "High", 10, 26, "R3", "DEV-003", "Media", "Medio", "Infraestructura", 44),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "SYS-I06", "Probar que los backups se pueden restaurar",
     "OBJETIVO: Confirmar mensualmente que las copias de seguridad realmente funcionan.\n\n"
     "PARA LA MINA: Si hay desastre, se recupera informacion e historial de sensores.\n\n"
     "ENTREGABLE: Restauracion en ambiente test + acta con tiempo y integridad verificada.\n\n"
     "VPS REQUERIDO: Staging (sep 2026 en adelante).\n\n"
     "DEPENDE DE: DEV-004.\n\n"
     "EXITO: Restauracion completa probada; tiempo documentado para auditoria.",
     "SYS", "RECUPERACION,SEG_INFRA", "High", 13, 26, "R4", "DEV-004", "Media", "Alto", "Infraestructura", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "SYS-I07", "Documentar infraestructura y red (diagramas)",
     "OBJETIVO: Dejar mapa claro de servidores, redes, puertos y credenciales para operacion y DR.\n\n"
     "PARA LA MINA: TI del cliente entiende la arquitectura sin depender de una sola persona.\n\n"
     "ENTREGABLE: Diagrama de red, inventario, runbook de acceso, vault de secretos.\n\n"
     "VPS REQUERIDO: Documentacion de dev + staging (sep 2026).\n\n"
     "DEPENDE DE: SYS-I03, DEV-004.\n\n"
     "EXITO: Documento actualizado tras cada cambio mayor de infra.",
     "SYS,ARQ", "DOCUMENTACION,REDES,SEG_INFRA", "Normal", 13, 16, "R4", "DEV-004", "Media", "Medio", "Infraestructura", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "SYS-I08", "Igualar ambientes dev, staging y produccion",
     "OBJETIVO: Evitar sorpresas: lo que funciona en desarrollo debe funcionar igual en produccion.\n\n"
     "PARA LA MINA: Menos bugs el dia del Go-Live.\n\n"
     "ENTREGABLE: Checklist de paridad, sync de configs, reporte semanal de diferencias.\n\n"
     "VPS REQUERIDO: Los tres ambientes activos (sep 2026).\n\n"
     "DEPENDE DE: DEV-003, DEV-004.\n\n"
     "EXITO: Drift detectado y corregido antes de cada release.",
     "SYS,BE3", "DEVOPS", "High", 13, 20, "R4", "DEV-003", "Media", "Medio", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "SYS-I09", "Optimizar red mina ↔ datacenter Lima",
     "OBJETIVO: Reducir latencia y perdida de paquetes entre faena y datacenter.\n\n"
     "PARA LA MINA: Sensores y mapas responden mas rapido con fibra, 4G o satelite.\n\n"
     "ENTREGABLE: Informe de latencia, ajustes MTU/QoS, recomendaciones por tipo de enlace.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026).\n\n"
     "EXITO: Latencia objetivo <20 ms desde oficina mina con fibra.",
     "SYS", "REDES,SEG_INFRA", "High", 17, 18, "R5", "P2-M5-001", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "SYS-I10", "Configurar firewall y segmentacion de red",
     "OBJETIVO: Separar trafico de aplicacion, bases de datos y administracion.\n\n"
     "PARA LA MINA: Un ataque o error en un segmento no tumba toda la operacion.\n\n"
     "ENTREGABLE: Reglas firewall, VLANs, logs de bloqueos, revision mensual.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026).\n\n"
     "EXITO: Solo puertos necesarios abiertos; acceso admin por VPN.",
     "SYS", "SEG_INFRA,REDES,SEGURIDAD", "High", 17, 19, "R5", "P2-M5-002", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "SYS-I11", "Acelerar carga web con Nginx (cache y compresion)",
     "OBJETIVO: Paginas e imagenes cargan rapido incluso con 3G/4G en faena.\n\n"
     "PARA LA MINA: Operadores no abandonan la app por lentitud.\n\n"
     "ENTREGABLE: Nginx con gzip/brotli, cache estatico, tiempos medidos antes/despues.\n\n"
     "VPS REQUERIDO: Produccion.\n\n"
     "EXITO: Reduccion >50% tiempo de carga en conexiones moviles.",
     "SYS,FE1", "REDES,DEVOPS", "Normal", 18, 19, "R5", "P2-M5-003", "Media", "Medio", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "SYS-I12", "Alertas de vencimiento de certificados SSL",
     "OBJETIVO: Evitar que la plataforma quede inaccesible por certificado vencido.\n\n"
     "PARA LA MINA: Acceso continuo sin avisos de \"conexion no segura\".\n\n"
     "ENTREGABLE: Monitoreo 30/15/7 dias, renovacion automatica certbot, dashboard.\n\n"
     "VPS REQUERIDO: Todos los ambientes.\n\n"
     "EXITO: Cero interrupciones por SSL en 12 meses.",
     "SYS", "SEG_INFRA,SEGURIDAD", "Normal", 18, 19, "R5", "P2-M5-007", "Baja", "Medio", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "SYS-I13", "Plan de capacidad y escalamiento (1 ano)",
     "OBJETIVO: Proyectar CPU, RAM, disco y red para crecimiento de sensores e informes.\n\n"
     "PARA LA MINA: Evitar sorpresas de costo o caida cuando crece la operacion.\n\n"
     "ENTREGABLE: Modelo de crecimiento (10K sensores, informes, usuarios), plan de upgrade.\n\n"
     "VPS REQUERIDO: Produccion.\n\n"
     "EXITO: Documento aprobado por ARQ y gerencia TI.",
     "SYS,ARQ", "DEVOPS,REDES", "High", 19, 20, "R5", "P2-M5-015", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "SYS-I14", "Soporte infraestructura 24/7 en marcha blanca y Go-Live",
     "OBJETIVO: Presencia SYS durante las semanas criticas de puesta en marcha.\n\n"
     "PARA LA MINA: Respuesta inmediata si falla servidor, red o certificado en faena real.\n\n"
     "ENTREGABLE: Turno on-call, runbook de incidentes, escalamiento a datacenter Lima.\n\n"
     "VPS REQUERIDO: Produccion (nov 2026).\n\n"
     "EXITO: Cero incidentes P1 sin respuesta en <15 minutos.",
     "SYS", "GO_LIVE,BLINDAJE,RECUPERACION", "Urgent", 24, 26, "R6", "P2-M6-009", "Media", "Alto", "Infraestructura", 40),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  INFRAESTRUCTURA VPS DATACENTER LIMA — Componentes de Arquitectura
    # ██  Basado en Informe Tecnico: Evaluacion Cloud vs Edge/Local VPS
    # ██  Todos los servicios en Docker sobre Linux en datacenter Tier III
    # ══════════════════════════════════════════════════════════════════════════

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-001",
     "Instalar MinIO — almacenamiento de archivos (reportes, imagenes)",
     "OBJETIVO: Guardar PDFs, imagenes de informes y adjuntos como Amazon S3 pero en Lima.\n\n"
     "PARA LA MINA: Archivos bajo control del cliente, sin costo por descarga en nube publica.\n\n"
     "ENTREGABLE: MinIO en Docker, discos dedicados, cifrado, politicas de retencion.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026).\n\n"
     "DEPENDE DE: P2-M5-003.\n\n"
     "EXITO: Backend sube y descarga archivos via API S3-compatible.",
     "SYS", "DEVOPS,SEGURIDAD", "High", 17, 18, "R5", "P2-M5-003", "Alta", "Medio", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-002",
     "Instalar QuestDB — base de datos de sensores en tiempo real",
     "OBJETIVO: Almacenar y consultar millones de lecturas IoT por segundo.\n\n"
     "PARA LA MINA: Graficos de sensores en vivo sin saturar PostgreSQL.\n\n"
     "ENTREGABLE: QuestDB en Docker, puertos ingest/consulta, NVMe, backup configurado.\n\n"
     "VPS REQUERIDO: Produccion (oct 2026).\n\n"
     "DEPENDE DE: P2-M5-003.\n\n"
     "EXITO: 10K sensores simulados escriben y consultan sin degradacion.",
     "SYS", "DEVOPS,SENSOR,CRITICO", "Urgent", 17, 18, "R5", "P2-M5-003", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-003",
     "Configurar VPN WireGuard para acceso seguro desde mina",
     "OBJETIVO: Que personal autorizado entre a la plataforma cifrado desde faena.\n\n"
     "PARA LA MINA: Seguridad en 4G/satelite; perfiles por rol (admin, supervisor, ingeniero).\n\n"
     "ENTREGABLE: Servidor WireGuard, perfiles, logs de conexion, guia de uso.\n\n"
     "VPS REQUERIDO: Produccion.\n\n"
     "DEPENDE DE: P2-M5-002.\n\n"
     "EXITO: Conexion VPN estable desde tablet en zona minera.",
     "SYS,BE2", "SEGURIDAD,REDES", "High", 17, 19, "R5", "P2-M5-002", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-004",
     "Provisionar servidor VPS de respaldo (arquitectura Activo-Pasivo)",
     "Contratacion y configuracion del segundo servidor VPS en el datacenter Lima como respaldo. Arquitectura Activo-Pasivo: el servidor principal atiende todo el trafico; el de respaldo se mantiene sincronizado y listo para tomar el control si el principal falla. Cambio automatico via DNS en menos de 5 minutos. Ambos servidores tienen la misma configuracion: Docker, bases de datos, servicios. El respaldo tambien almacena las copias de seguridad encriptadas.",
     "ARQ,SYS", "DEVOPS,CRITICO,RECUPERACION", "Urgent", 18, 19, "R5", "P2-M5-003", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-005",
     "Plan de conectividad operador-agnostica para clientes mineros (Claro, Movistar, Bitel, Entel)",
     "Disenar y documentar la arquitectura de conectividad para que los usuarios de la mina se conecten sin importar el operador telefonico. Opciones validadas: (1) Fibra optica convencional para oficinas de mina con conexion fija; (2) Red movil 3G/4G de operadores peruanos (Claro, Movistar, Bitel, Entel) para tablets y dispositivos moviles en campo; (3) Conexion satelital para zonas sin cobertura celular. El VPS en datacenter Lima tiene IP publica fija accesible desde cualquier operador. Incluye pruebas de latencia con cada tipo de conexion.",
     "ARQ,SYS", "REDES,DOCUMENTACION,CRITICO", "High", 17, 18, "R5", "P2-M5-001", "Alta", "Alto", "Arquitectura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-006",
     "Instalar WAF (Web Application Firewall) para proteger la plataforma web",
     "Instalacion de firewall de aplicaciones web (ModSecurity con Nginx o similar) que filtra ataques antes de que lleguen al sistema: bloquea intentos de inyeccion SQL, cross-site scripting, bots maliciosos, escaneos automaticos. Complementa el firewall de red (iptables) con proteccion a nivel de aplicacion. Reglas personalizadas para la plataforma minera. Logs de ataques bloqueados visibles en Grafana.",
     "SYS,BE2", "SEGURIDAD,DEVOPS", "High", 18, 19, "R5", "P2-M5-006", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-007",
     "Instalar Redis en Docker: cache de datos y sesiones de usuarios",
     "Despliegue de Redis como servicio Docker en el VPS: almacena temporalmente los datos mas consultados (documentos abiertos, sesiones activas, resultados de busqueda) para que el sistema responda mas rapido sin consultar la base de datos cada vez. Configuracion de seguridad: contrasena, cifrado de datos sensibles, limite de memoria. Persistencia en disco para no perder datos si el contenedor se reinicia.",
     "SYS", "DEVOPS,CORE", "High", 17, 18, "R5", "P2-M5-005", "Alta", "Medio", "Infraestructura", 16),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-008",
     "Configurar replicacion automatica de datos al servidor de respaldo",
     "Proceso automatico que copia continuamente los datos del servidor principal al de respaldo: base de datos PostgreSQL (replica en streaming), QuestDB (replica de datos de sensores), MinIO (sincronizacion de archivos), Redis (replica). Si el servidor principal falla, el respaldo tiene los datos actualizados hasta segundos antes del fallo.",
     "SYS,BE3", "DEVOPS,CRITICO,RECUPERACION", "Urgent", 19, 20, "R5", "VPS-004", "Alta", "Alto", "Infraestructura", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "VPS-009",
     "Documentar arquitectura completa VPS datacenter Lima (diagrama tecnico y gerencial)",
     "Elaborar documentacion completa de la arquitectura del datacenter: (1) Diagrama tecnico con todos los componentes Docker (C++, React, PostgreSQL, QuestDB, Redis, MinIO, Kafka, Prometheus, Grafana, WireGuard); (2) Diagrama de red (VLANs, firewall, VPN, DNS); (3) Diagrama gerencial simplificado para presentar al Directorio; (4) Inventario de servidores, IPs, puertos, credenciales. Basado en el informe de evaluacion AWS vs VPS.",
     "ARQ,SYS", "DOCUMENTACION,ARQUITECTURA", "High", 19, 20, "R5", "VPS-005", "Media", "Medio", "Arquitectura", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "VPS-010",
     "Prueba de conectividad desde mina real: fibra, 4G (todos los operadores) y satelital",
     "Prueba real de conexion desde la unidad minera al datacenter Lima usando los 3 tipos de conectividad: (1) Fibra optica de oficina central de mina; (2) Celular 4G con chips de Claro, Movistar, Bitel y Entel desde distintas zonas de la mina; (3) Satelital desde zona sin cobertura. Medir latencia, estabilidad y velocidad en cada caso. Verificar que la plataforma funciona correctamente en conexiones lentas (3G/satelital). Documentar resultados y recomendaciones.",
     "SYS,QA,ARQ", "REDES,PRUEBAS_CALIDAD,CRITICO", "Urgent", 22, 23, "R6", "VPS-005", "Alta", "Alto", "Infraestructura", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "VPS-011",
     "Prueba de failover completo: caida de servidor principal y activacion de respaldo",
     "Simulacro real donde se apaga el servidor VPS principal y se verifica: (1) El DNS redirige al servidor de respaldo en menos de 5 minutos; (2) Todos los servicios funcionan en el respaldo (plataforma, sensores, informes); (3) Los datos estan completos y actualizados; (4) Los usuarios de mina no pierden sesion activa. Documentar tiempos y resultados. Repetir el simulacro en sentido inverso (volver al principal).",
     "SYS,QA", "PRUEBAS_CALIDAD,CRITICO,RECUPERACION", "Urgent", 23, 24, "R6", "VPS-008", "Alta", "Alto", "Infraestructura", 24),

    # ── FE1: Optimización, PWA, pantallas de admin, gerencia (+376h) ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE1-O01", "Optimizar velocidad de carga de la plataforma web",
     "Hacer que la plataforma cargue rapidamente: dividir el codigo en partes que se cargan solo cuando se necesitan (el editor se carga al abrir un informe, el mapa solo al ver el dashboard), comprimir archivos, precargar pantallas principales. La plataforma debe mostrar contenido en menos de 1.5 segundos.",
     "FE1", "UX,CORE", "High", 11, 14, "R3", "", "Alta", "Medio", "Frontend", 40),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "FE1-O02", "Convertir la plataforma en aplicacion instalable para uso en campo (modo sin conexion)",
     "Transformar la plataforma web para que funcione como una aplicacion que se puede instalar en tablets y computadoras. El usuario puede crear y consultar informes sin conexion a internet (en zonas de la mina sin senal). Los datos se guardan localmente y se sincronizan cuando vuelve la conexion.",
     "FE1", "UX,OFFLINE,TABLETS", "High", 11, 14, "R3", "", "Alta", "Alto", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O03", "Monitoreo de errores frontend (Sentry integration)",
     "Integración de Sentry en React: captura automática de errores JS, source maps para debugging, contexto de usuario/ruta/dispositivo. Dashboard de errores. Alertas por nuevos errores en producción.",
     "FE1", "UX,DEVOPS", "High", 13, 14, "R4", "", "Media", "Medio", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O04", "Documentación de componentes React (Storybook)",
     "Catálogo visual de todos los componentes React de la plataforma: botones, inputs, tablas, cards, modales, etc. Cada componente con variantes, estados y código de ejemplo. Referencia para todo el equipo frontend.",
     "FE1,FE2", "DOCUMENTACION,UX", "Normal", 13, 16, "R4", "", "Media", "Bajo", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O05", "Optimización de state management (Redux/Zustand)",
     "Refactoring del manejo de estado: normalización de store, selectores memoizados, eliminación de re-renders innecesarios. Reducir renders del editor en >50%. Profiling con React DevTools.",
     "FE1", "CORE,UX", "High", 14, 16, "R4", "", "Alta", "Medio", "Frontend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O06", "Pantallas ejecutivas de gerencia (dashboards de dirección)",
     "Implementación de dashboards de alto nivel para directivos: resumen de producción, estado de informes por zona, tendencias de alertas, mapa ejecutivo, indicadores de cumplimiento normativo.",
     "FE1", "GERENCIA,UX", "High", 14, 16, "R4", "FE2-U11", "Alta", "Medio", "Frontend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O07", "Módulo de administración: usuarios, roles, configuración",
     "Implementación funcional del módulo admin: CRUD usuarios, asignación de roles RBAC, configuración por tenant, visualización de audit logs, parámetros del sistema. Solo accesible a rol Administrador.",
     "FE1", "UX,SECURITY,GERENCIA", "High", 14, 16, "R4", "FE2-U10", "Alta", "Medio", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O08", "Pantalla de historial de actividades y audit trail visual",
     "Vista de timeline de actividades del usuario y del sistema: quién editó qué informe, cuándo se aprobó, quién exportó. Filtros por usuario, tipo de acción, rango de fechas. Integración con audit log backend.",
     "FE1", "UX,SECURITY,GERENCIA", "Normal", 15, 16, "R4", "", "Media", "Bajo", "Frontend", 24),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "FE1-O09", "Internacionalización del frontend (i18n framework setup)",
     "Setup del framework de internacionalización: react-intl o i18next, extracción de strings, estructura de archivos de traducción, pluralización, formatos de fecha/número. Base para la traducción de FE2.",
     "FE1,FE2", "UX,INTEGRACION", "Normal", 14, 16, "R4", "", "Alta", "Medio", "Frontend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "FE1-O10", "Testing de compatibilidad cross-browser completo",
     "Pruebas exhaustivas en todos los navegadores target: Chrome 120+, Firefox 115+, Edge 120+, Safari 17+. Verificar editor, GIS, exportaciones, WebSocket. Fix de incompatibilidades detectadas.",
     "FE1,QA", "QA,UX", "High", 17, 18, "R5", "", "Alta", "Medio", "Frontend", 32),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "FE1-O11", "Optimización de carga del editor para informes grandes (100+ páginas)",
     "Performance tuning del editor TipTap para documentos largos: virtualización de nodos, debounce de operaciones, lazy rendering de páginas no visibles. Target: editor fluido con informes de 100+ páginas.",
     "FE1", "EDITOR,CORE", "High", 17, 20, "R5", "", "Alta", "Alto", "Frontend", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "FE1-O12", "Correcciones de UX basadas en feedback de marcha blanca",
     "Sprint dedicado a corregir problemas de usabilidad detectados durante la marcha blanca: ajustes de layout, mejoras en flujos confusos, correcciones de texto, mejoras de rendimiento perceptual.",
     "FE1", "UX,GO-LIVE,SOPORTE", "Urgent", 25, 26, "R6", "", "Media", "Alto", "Frontend", 32),

    # ══════════════════════════════════════════════════════════════════════════
    # ██  TRANSVERSALES (con horas aumentadas para carga óptima)
    # ══════════════════════════════════════════════════════════════════════════

    ("Control de calidad", "QA_Transversal", "QA-001",
     "Definir estrategia de testing y criterios de aceptación",
     "Definir la estrategia completa de calidad del proyecto: qué se prueba, cómo se prueba, cuándo se prueba, quién aprueba. Incluye criterios de aceptación para cada módulo, umbrales de cobertura (>80%), y proceso de gestión de defectos.",
     "QA,ARQ", "QA,DOC,PMO", "High", 1, 2, "R1", "", "Media", "Medio", "QA", 24),

    ("Control de calidad", "QA_Transversal", "QA-002",
     "Preparar ambiente de PRUEBAS (staging) para el equipo QA",
     "OBJETIVO: Tener un servidor de pruebas separado donde QA valida cambios antes de produccion.\n\n"
     "PARA LA MINA: Evita que errores lleguen a operadores reales; permite simular sensores, informes y usuarios de prueba.\n\n"
     "ENTREGABLE: Ambiente staging operativo, datos sinteticos de mina, acceso documentado para QA.\n\n"
     "VPS REQUERIDO: Staging (segundo servidor) — contratar a partir de semana 10 (~agosto 2026), despues del VPS de desarrollo.\n\n"
     "DEPENDE DE: DEV-003 (VPS desarrollo listo) y QA-001 (estrategia de testing).\n\n"
     "EXITO: QA ejecuta pruebas funcionales sin usar laptops de desarrolladores.",
     "QA,SYS", "QA,DEVOPS", "High", 10, 11, "R3", "DEV-003", "Media", "Medio", "QA", 24),

    ("Control de calidad", "QA_Transversal", "QA-003",
     "Automatización de tests de regresión",
     "Construcción de la suite automatizada que se ejecuta en cada despliegue para verificar que las funcionalidades existentes siguen funcionando correctamente. Cobertura: login, CRUD informes, exportación, sensores.",
     "QA", "QA", "High", 9, 12, "R3", "QA-002", "Alta", "Medio", "QA", 48),

    ("Control de calidad", "QA_Transversal", "QA-004",
     "Revisión de código y estándares de calidad (continuo)",
     "Proceso continuo de revisión de código: cada pull request es revisado por QA (estándares de código, seguridad básica, complejidad). Análisis estático con SonarQube. Métricas de calidad por sprint.",
     "QA,BE1", "QA,CORE,COMPLIANCE", "Normal", 5, 24, "R4", "QA-001", "Media", "Bajo", "QA", 60),

    ("DevOps", "DevOps_Infra", "DEV-001",
     "Organizar repositorios Git y reglas de trabajo del codigo",
     "OBJETIVO: Definir donde vive el codigo y como el equipo colabora sin pisarse.\n\n"
     "PARA LA MINA: Base ordenada para entregas auditables (quien cambio que, cuando y por que).\n\n"
     "ENTREGABLE: Repositorios Git, ramas main/develop/feature, proteccion de ramas, hooks de calidad.\n\n"
     "VPS REQUERIDO: Ninguno — se hace en GitHub/GitLab desde julio 2026 (mes 2 del proyecto).\n\n"
     "DEPENDE DE: Nada (inicio SYS en mes 2).\n\n"
     "EXITO: Todo desarrollador clona el repo y sigue la misma estrategia de ramas.",
     "SYS", "DEVOPS", "High", 6, 7, "R2", "", "Baja", "Bajo", "Infraestructura", 16),

    ("DevOps", "DevOps_Infra", "DEV-002",
     "Empaquetar todos los servicios en contenedores Docker",
     "OBJETIVO: Que backend, frontend, bases de datos y servicios auxiliares corran igual en cualquier maquina.\n\n"
     "PARA LA MINA: Misma plataforma en laptop del programador, servidor de desarrollo y produccion en Lima.\n\n"
     "ENTREGABLE: Dockerfiles + docker-compose.yml completo (C++, React, PostgreSQL, Redis, MinIO, Kafka, Grafana, etc.).\n\n"
     "VPS REQUERIDO: Ninguno al inicio — primero se valida en laptops; luego se despliega en VPS dev (DEV-003).\n\n"
     "DEPENDE DE: DEV-001.\n\n"
     "EXITO: `docker compose up` levanta la plataforma completa en local.",
     "SYS", "DEVOPS", "High", 7, 9, "R2", "DEV-001", "Alta", "Medio", "Infraestructura", 40),

    ("DevOps", "DevOps_Infra", "DEV-003",
     "Contratar e instalar VPS de DESARROLLO compartido para el equipo",
     "OBJETIVO: Servidor remoto donde todos los programadores prueban integraciones con datos compartidos.\n\n"
     "PARA LA MINA: Primer servidor real en datacenter; permite probar sensores, mapas e informes como en faena.\n\n"
     "ENTREGABLE: VPS Linux con Docker, todos los servicios DEV-002, datos de prueba, acceso VPN/SSH por rol.\n\n"
     "VPS REQUERIDO: SI — VPS DESARROLLO. Fecha clave: ~20 jul 2026 (semana 8). Tamano inicial: 8 vCPU / 32 GB RAM / 500 GB NVMe.\n\n"
     "DEPENDE DE: DEV-002 (imagenes Docker listas).\n\n"
     "EXITO: Backend y frontend se conectan al mismo ambiente; deja de depender de laptops aisladas.",
     "SYS", "DEVOPS", "High", 8, 10, "R2", "DEV-002", "Alta", "Medio", "Infraestructura", 32),

    ("DevOps", "DevOps_Infra", "DEV-004",
     "Instalar VPS de PRUEBAS / CERTIFICACION (staging)",
     "OBJETIVO: Replica controlada de produccion exclusiva para QA y aprobaciones.\n\n"
     "PARA LA MINA: Ningun cambio llega a operadores sin pasar por este ambiente.\n\n"
     "ENTREGABLE: VPS staging identico a prod (mismas versiones), flujo Dev -> Staging -> Prod documentado.\n\n"
     "VPS REQUERIDO: SI — VPS STAGING (~agosto 2026, semana 10).\n\n"
     "DEPENDE DE: DEV-003.\n\n"
     "EXITO: QA certifica releases en staging antes del Go-Live.",
     "SYS,QA", "DEVOPS,QA", "High", 10, 13, "R3", "DEV-003", "Alta", "Alto", "Infraestructura", 32),

    ("DevOps", "DevOps_Infra", "DEV-005",
     "Instalar VPS de PRODUCCION en datacenter Lima (usuarios reales)",
     "OBJETIVO: Ambiente definitivo para la mina con alta disponibilidad y seguridad.\n\n"
     "PARA LA MINA: Plataforma que usaran operadores, geotecnia y gerencia en faena.\n\n"
     "ENTREGABLE: Dos VPS (principal + respaldo), DNS, SSL, firewall, VPN, monitoreo y backups automaticos.\n\n"
     "VPS REQUERIDO: SI — VPS PRODUCCION (~octubre 2026, semana 17-18). Tier III Lima.\n\n"
     "DEPENDE DE: DEV-004 (staging aprobado) + hitos P2-M5 (infra productiva).\n\n"
     "EXITO: Marcha blanca y Go-Live nov 2026 sobre este ambiente.",
     "SYS,ARQ", "DEVOPS,CRITICO", "Urgent", 17, 18, "R5", "DEV-004", "Alta", "Alto", "Infraestructura", 32),

    ("Riesgos", "Gestion_Riesgos", "RSK-001",
     "Identificación y registro inicial de riesgos del proyecto",
     "Taller de identificación de riesgos con todo el equipo técnico: riesgos tecnológicos (C++ complexity, performance), de recursos (dependencia de BE1), de integración (legacy), de timeline (6 meses agresivo). Registro en ClickUp.",
     "ARQ", "PMO,DOCUMENTACION", "High", 1, 2, "R1", "", "Media", "Alto", "Arquitectura", 16),

    ("Riesgos", "Gestion_Riesgos", "RSK-002",
     "Plan de mitigación y contingencia para cada riesgo",
     "Para cada riesgo identificado: estrategia de mitigación (reducir probabilidad), plan de contingencia (qué hacer si ocurre), responsable, indicadores de activación. Los 10 riesgos principales documentados en detalle.",
     "ARQ", "PMO,DOCUMENTACION", "High", 2, 4, "R1", "RSK-001", "Media", "Alto", "Arquitectura", 24),

    ("Riesgos", "Gestion_Riesgos", "RSK-003",
     "Revisión quincenal de riesgos con comité técnico",
     "Cada 2 semanas, revisión del registro de riesgos: nuevos riesgos, riesgos materializados, efectividad de mitigaciones, actualización de probabilidad/impacto. Participan ARQ + líderes técnicos.",
     "ARQ,QA", "PMO,DOCUMENTACION", "Normal", 3, 26, "R1", "RSK-001", "Baja", "Medio", "Arquitectura", 48),

    ("Gestion PMO", "PMO_Seguimiento", "PMO-001",
     "Sprint Planning quincenal (planificación del sprint)",
     "Cada 2 semanas: revisión del backlog, priorización de tareas, estimación de esfuerzo, asignación a recursos, definición de objetivos del sprint. ARQ lidera la sesión con todo el equipo. 2h × 13 sprints.",
     "ARQ", "PMO,DOCUMENTACION", "High", 1, 26, "R1", "", "Baja", "Bajo", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PMO-002",
     "Daily standups (reunión diaria de sincronización, 15 min)",
     "Reunión diaria de 15 minutos con todo el equipo: qué hice ayer, qué haré hoy, qué me bloquea. ARQ facilita y registra impedimentos para resolución inmediata. Mantiene al equipo alineado y detecta problemas temprano.",
     "ARQ", "PMO", "Normal", 1, 26, "R1", "", "Baja", "Bajo", "Arquitectura", 78),

    ("Gestion PMO", "PMO_Seguimiento", "PMO-003",
     "Sprint Review y Retrospectiva quincenal",
     "Al final de cada sprint: Demo de lo construido ante stakeholders (Review, 1h) + sesión de mejora continua del equipo (Retro, 1h). ARQ presenta, QA valida calidad de los entregables demostrados.",
     "ARQ,QA", "PMO,DOCUMENTACION", "High", 2, 26, "R1", "", "Baja", "Bajo", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PMO-004",
     "Comité ejecutivo semanal con Gerencia TI y Gerencia Minera",
     "Reunión semanal con gerencia (1h): estado del proyecto (semáforo), riesgos activos, decisiones pendientes, presupuesto ejecutado, siguiente hito. Formato ejecutivo de 1 página + demo visual cuando aplica.",
     "ARQ", "PMO,GERENCIA,CRITICO", "High", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PMO-005",
     "Dashboard de métricas del proyecto en ClickUp",
     "Configuración y mantenimiento del dashboard ejecutivo en ClickUp: velocidad del equipo (story points/sprint), burndown chart, bugs abiertos/cerrados, % avance por release, uso de recursos.",
     "ARQ", "PMO,DOCUMENTACION", "Normal", 3, 4, "R1", "PMO-001", "Media", "Bajo", "Arquitectura", 16),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "ARQ-G11",
     "Informe ejecutivo de cierre y lecciones aprendidas del proyecto",
     "Documento ejecutivo de cierre: logros vs SOW, lecciones aprendidas, recomendaciones para operación, riesgos residuales y plan de soporte post-GoLive. Presentación a Gerencia TI y Gerencia Minera.",
     "ARQ", "PMO,DOCUMENTACION,PRODUCCION", "High", 26, 26, "R6", "P2-M6-011", "Baja", "Medio", "Arquitectura", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "ARQ-G12",
     "Auditoría final de cumplimiento arquitectura vs SOW y requisitos mineros",
     "Revisión formal de que la plataforma cumple arquitectura aprobada, requisitos del SOW, normativa minera y OWASP. Matriz de trazabilidad requisito→entregable. QA valida evidencias.",
     "ARQ,QA", "ARQUITECTURA,DOCUMENTACION,CRITICO", "High", 25, 26, "R6", "ARQ-G06", "Media", "Alto", "Arquitectura", 32),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "ARQ-G13",
     "Transferencia formal del sistema a operaciones TI del cliente",
     "Handover estructurado: runbooks, accesos, diagramas as-built, contactos proveedores datacenter Lima, sesión de transferencia con equipo operativo del cliente y acta de recepción firmada.",
     "ARQ,SYS", "PMO,PRODUCCION,SOPORTE", "Urgent", 26, 26, "R6", "P2-M6-012", "Media", "Alto", "Arquitectura", 40),

    ("Gestion PMO", "PMO_Seguimiento", "ARQ-G14",
     "Seguimiento KPIs y estabilización post-GoLive (primera quincena)",
     "Monitoreo diario de indicadores post-lanzamiento: disponibilidad, errores críticos, tickets de soporte, adopción de usuarios. Reporte ejecutivo a Gerencia y plan de acción correctiva.",
     "ARQ", "PMO,PRODUCCION,GERENCIA", "High", 26, 26, "R6", "P2-M6-012", "Baja", "Medio", "Arquitectura", 24),

    ("PASO 2", "MES6_NOVIEMBRE_GoLive", "FE2-U17",
     "Encuestas NPS y optimización UX post-lanzamiento",
     "Encuestas de satisfacción a usuarios clave tras GoLive (NPS, SUS), análisis de fricciones reportadas en marcha blanca, ajustes UX de prioridad alta en pantallas críticas y reporte de mejoras para backlog post-proyecto.",
     "FE2", "UX,SOPORTE,PRODUCCION", "High", 25, 26, "R6", "FE2-U15", "Media", "Medio", "Frontend", 32),

    # ── NUEVOS ALCANCES MAYO 2026 — Offline, borradores, UX industrial LATAM ──

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-ALC-A1",
     "Motor offline informe tecnico: BD local en terminal y cola de sincronizacion",
     "Persistencia local (IndexedDB + SQLite WASM en terminal) para cambios factibles del informe tecnico en zonas sin conectividad. Cola de operaciones con reintentos, marcas de tiempo y reconciliacion automatica al detectar servidor.",
     "BE1,BE3", "SIN_CONEXION,CORE,CRITICO", "Urgent", 9, 11, "R3", "P1-M2-012", "Alta", "Alto", "Backend", 48),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-ALC-A2",
     "UI offline: edicion local, indicadores de sync y reconciliacion en ReportStudio",
     "Modo offline completo: guardado local, badge online/offline/syncing, barra de progreso de sincronizacion y resolucion visual de conflictos al reconectar. FE1 lidera; FE2 valida usabilidad en tablet de campo.",
     "FE1,FE2", "SIN_CONEXION,UX,EDITOR,CRITICO", "Urgent", 9, 12, "R3", "P1-ALC-A1", "Alta", "Alto", "Frontend", 56),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-ALC-B1",
     "Workspace de multiples borradores de informe tecnico (1..N documentos)",
     "Bandeja de borradores: crear, renombrar, duplicar, previsualizar y convertir a informe formal. Soporte de uno o mas documentos en estado Borrador por usuario y tenant.",
     "FE1", "EDITOR,UX,CORE", "High", 8, 10, "R2", "P1-M3-001", "Alta", "Medio", "Frontend", 40),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-ALC-B2",
     "API backend: CRUD borradores multi-documento y transicion borrador-revision",
     "Endpoints para crear, listar, archivar y promover borradores multiples. Versionado ligero pre-aprobacion y metadatos de estado por tenant.",
     "BE1", "CORE,DB,EDITOR", "High", 8, 10, "R2", "P1-ALC-B1", "Media", "Medio", "Backend", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-ALC-B3",
     "Manual funcional: flujo de borradores multiples para supervisores de turno",
     "Procedimiento operativo no tecnico para crear, gestionar y cerrar borradores en turno minero. Revision con FE1 y validacion QA.",
     "PAF,FE1", "DOCUMENTACION,EDITOR,SOPORTE", "Normal", 9, 11, "R3", "P1-ALC-B1", "Baja", "Bajo", "Frontend", 28),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-C1",
     "Pegado de imagenes desde navegador web y WhatsApp Web al informe avanzado",
     "Soporte paste/drop desde clipboard del SO, captura desde pagina web e integracion paste desde WhatsApp Web al canvas TipTap con compresion, preview y metadatos de origen.",
     "FE1", "EDITOR,UX,INTEGRACION", "High", 10, 12, "R3", "P1-M3-012", "Alta", "Medio", "Frontend", 36),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-C2",
     "Pipeline backend: upload, sanitizacion y almacenamiento de imagenes externas",
     "API multipart optimizada, strip EXIF, validacion MIME, almacenamiento seguro y vinculacion al documento JSONB del informe.",
     "BE3", "CORE,INTEGRACION,EDITOR", "High", 10, 12, "R3", "P1-ALC-C1", "Media", "Medio", "Backend", 28),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-D1",
     "Sistema empresarial de teclas rapidas para funcionalidades del informe",
     "Mapa completo de atajos: editor, navegacion, exportacion, sensores y mapas. Overlay Ctrl+/ con busqueda fuzzy y personalizacion por rol.",
     "FE1", "UX,EDITOR", "High", 9, 11, "R3", "P1-M3-007", "Media", "Bajo", "Frontend", 32),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-E1",
     "Optimizacion de menu: reduccion de pasos en flujos frecuentes de operacion",
     "Accesos directos, favoritos, breadcrumbs inteligentes y menu contextual por modulo. Meta: reducir al menos 40% los clics en los 10 flujos mas usados en mina.",
     "FE1,FE2", "UX,EXPERIENCIA_USUARIO", "High", 10, 13, "R3", "P1-M3-004", "Media", "Medio", "Frontend", 44),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-F1",
     "Auto-ocultamiento de barra superior al entrar a funcionalidades internas",
     "Al abrir editor, mapa o streaming, ocultar ribbon superior maximizando lienzo. Toggle manual y persistencia de preferencia por usuario.",
     "FE1", "UX,EDITOR", "High", 8, 10, "R2", "P1-M3-007", "Media", "Bajo", "Frontend", 28),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-G1",
     "Paneles laterales colapsados a iconos cuando no estan en uso activo",
     "Sidebars izquierdo y derecho del lienzo en modo icon-only por defecto; expand on hover/focus; eliminar textos redundantes para experiencia visual industrial premium.",
     "FE1,FE2", "UX,EDITOR,EXPERIENCIA_USUARIO", "High", 9, 12, "R3", "P1-ALC-F1", "Media", "Medio", "Frontend", 40),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-ALC-QA1",
     "Suite QA: offline, borradores, paste imagen, shortcuts, menu y ribbon UX",
     "Pruebas funcionales de alcances A-G: sync offline, multi-borrador, paste web/WhatsApp, atajos, menu optimizado, ribbon oculto e icon sidebars.",
     "QA,FE2", "QA,UX,SIN_CONEXION,EDITOR", "High", 12, 14, "R4", "P1-ALC-G1", "Media", "Medio", "QA", 52),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-ALC-SYS1",
     "Infra offline-sync: cache edge, monitoreo de colas y alertas de backlog",
     "Nginx cache para assets offline, metricas Prometheus de colas sync y alertas si backlog supera 100 operaciones pendientes.",
     "SYS", "INFRAESTRUCTURA,SIN_CONEXION", "High", 18, 20, "R5", "P1-ALC-A1", "Media", "Medio", "Infraestructura", 44),

    ("PASO 2", "MES5_OCTUBRE_Optimizacion", "P2-ALC-IA1",
     "IA: clasificacion automatica de imagenes pegadas en informe tecnico",
     "Auto-tag de imagenes importadas (equipo, zona, EPP, incidente) para enriquecer metadata y busqueda del informe.",
     "IA,BE3", "IA,EDITOR", "Normal", 18, 20, "R5", "P1-ALC-C2", "Alta", "Medio", "IA", 40),

    ("PASO 1", "MES1_JUNIO_Analisis_Arquitectura", "P1-ALC-FE1-M1",
     "FE1 mes 1: setup React/Vite, contratos API con BE1/DBA y shell ReportStudio",
     "Unico frontend activo en junio: levantar arquitectura Vite, routing base, contratos REST/WebSocket con backend y shell navegable del ReportStudio para validacion temprana con ARQ.",
     "FE1,BE1", "UX,CORE,EDITOR,ARQUITECTURA", "Urgent", 1, 4, "R1", "P1-M1-005", "Alta", "Alto", "Frontend", 48),

    # ── PAF: Soporte PMO — Analista Funcional y Documentador (6 meses) ──
    ("Gestion PMO", "PMO_Seguimiento", "PAF-001",
     "Actualizacion semanal ClickUp: estados, responsables, fechas y dependencias",
     "Rutina semanal: revisar 287+ tareas, actualizar % avance, validar fechas Gantt, marcar bloqueos y reflejar cambios acordados en comites.",
     "PAF", "PMO,GESTION_PROYECTO", "High", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-002",
     "Coordinacion de reuniones: convocatorias, agendas, salas y recordatorios",
     "Gestionar calendario de dailies, sprint planning, reviews, comite ejecutivo y workshops. Enviar invites, preparar agenda y confirmar asistencia de 9 recursos + gerencia.",
     "PAF", "PMO,DOCUMENTACION", "High", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-003",
     "Actas, action items y seguimiento de acuerdos entre sprints",
     "Redactar actas de cada ceremonia, registrar acuerdos con responsable y fecha, enviar resumen por correo y escalar vencidos al ARQ/PMO.",
     "PAF", "PMO,DOCUMENTACION", "High", 2, 26, "R1", "PAF-002", "Baja", "Medio", "Arquitectura", 48),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-004",
     "Correos de seguimiento a equipo y gerencia (avance, riesgos, bloqueos)",
     "Elaborar y enviar boletines quincenales de avance, alertas de tareas vencidas, recordatorios de entregables y canal unico de comunicacion proyecto-mina.",
     "PAF", "PMO,GERENCIA", "High", 1, 26, "R1", "", "Baja", "Medio", "Arquitectura", 40),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-005",
     "Matriz RACI, organigrama del proyecto y onboarding de nuevos recursos",
     "Documentar roles (BE1-3, FE1-2, QA, IA, SYS, PAF, ARQ), responsables por modulo minero y guia de induccion al proyecto y ClickUp.",
     "PAF", "PMO,DOCUMENTACION", "Normal", 2, 8, "R1", "", "Media", "Bajo", "Arquitectura", 32),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-006",
     "Documentacion funcional para usuarios de mina (manuales y quick-start)",
     "Redactar manuales funcionales no tecnicos: crear informe, sensores, mapas, alertas. Coordinar revision con FE1/FE2 y validacion con QA.",
     "PAF,FE1", "DOCUMENTACION,UX", "High", 9, 22, "R3", "P1-M3-004", "Media", "Medio", "Frontend", 56),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-007",
     "Catalogo de requerimientos funcionales y trazabilidad FE-BE",
     "Mantener matriz requerimiento-tarea-modulo minero; actualizar correspondencias frontend-backend y evidencias de cierre por sprint.",
     "PAF,BE1", "DOCUMENTACION,CORE", "High", 5, 20, "R2", "P1-M1-005", "Media", "Medio", "Backend", 48),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-008",
     "Soporte a UAT: escenarios, datos de prueba y log de incidencias funcionales",
     "Apoyar QA en preparacion UAT: escenarios de negocio minero, datos anonimizados, registro de incidencias funcionales en ClickUp y priorizacion con ARQ.",
     "PAF,QA", "PMO,QA", "High", 17, 24, "R5", "QA-T11", "Media", "Medio", "QA", 40),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-009",
     "Dashboard ejecutivo de avance (extraccion ClickUp + slide gerencia)",
     "Consolidar KPIs de avance, capacidad y riesgos desde Excel/ClickUp; preparar slide quincenal para comite ejecutivo junto al ARQ.",
     "PAF,ARQ", "PMO,GERENCIA", "High", 3, 26, "R1", "PAF-004", "Baja", "Medio", "Arquitectura", 40),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-010",
     "Kit de cierre: indice documentacion, actas finales y lecciones aprendidas",
     "Compilar entregables documentales del proyecto, lecciones aprendidas, acta de cierre y paquete de handover para operaciones mina.",
     "PAF,ARQ", "PMO,DOCUMENTACION,PRODUCCION", "High", 24, 26, "R6", "P2-M6-012", "Media", "Medio", "Arquitectura", 32),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-011",
     "Plan de capacitacion: offline, borradores, shortcuts y UX industrial",
     "Disenar agenda de talleres, guias quick-start y material de entrenamiento para nuevos alcances A-G. Coordinar sesiones presenciales mes 5-6 con supervisores mineros.",
     "PAF,FE1", "SOPORTE,DOCUMENTACION,UX,SIN_CONEXION", "High", 18, 24, "R5", "P1-ALC-G1", "Media", "Medio", "Frontend", 52),

    ("Gestion PMO", "PMO_Seguimiento", "PAF-012",
     "Coordinacion de reuniones ejecutivas y seguimiento de action items gerencia",
     "Soporte directo al PM: preparar comites quincenales C-Level, consolidar action items, escalamiento de bloqueos y minutas de decisiones de alcance.",
     "PAF,ARQ", "PMO,GERENCIA,GESTION_PROYECTO", "High", 1, 26, "R1", "PAF-002", "Baja", "Medio", "Arquitectura", 56),

    # ── Refuerzo de carga 90-100% — FE2, SYS, QA, IA ──

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-LOAD-FE2-01",
     "FE2: validacion UX temprana de login, auth y responsive tablet mina",
     "Pruebas de usabilidad en julio sobre flujos de acceso, permisos y layout responsive para tablets de campo con guantes.",
     "FE2,QA", "UX,EXPERIENCIA_USUARIO,PRUEBAS_CALIDAD", "High", 5, 7, "R2", "P1-M2-001", "Media", "Medio", "Frontend", 28),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-LOAD-FE2-02",
     "FE2: iteracion paneles retráctiles, alarmas UI y accesibilidad industrial",
     "Refinar paneles laterales, alertas visuales de sensores y contraste para operacion nocturna en mina.",
     "FE2,FE1", "UX,EXPERIENCIA_USUARIO,SENSORES", "High", 9, 11, "R3", "P1-M3-004", "Media", "Medio", "Frontend", 32),

    ("PASO 1", "MES5_OCTUBRE_Optimizacion", "P1-LOAD-FE2-03",
     "FE2: soporte UAT y ajustes UX post-feedback operadores mina",
     "Acompanamiento en pruebas de aceptacion: correccion de fricciones UX reportadas por supervisores y operadores.",
     "FE2,QA", "UX,SOPORTE,PRUEBAS_CALIDAD", "High", 17, 22, "R5", "P1-M4-011", "Media", "Medio", "Frontend", 36),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-LOAD-SYS-01",
     "SYS: hardening Docker Compose staging y pipeline despliegue base",
     "Configuracion inicial de entorno staging, secrets, healthchecks y despliegue automatizado base del stack.",
     "SYS", "INFRAESTRUCTURA,DEVOPS", "High", 5, 8, "R2", "DEV-004", "Media", "Medio", "Infraestructura", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-LOAD-SYS-02",
     "SYS: monitoreo base Prometheus/Grafana y alertas operativas",
     "Dashboards de CPU, memoria, disco y latencia API; alertas Slack/email para umbrales criticos.",
     "SYS", "INFRAESTRUCTURA", "High", 9, 12, "R3", "P1-LOAD-SYS-01", "Media", "Medio", "Infraestructura", 28),

    ("PASO 1", "MES4_SEPTIEMBRE_Integracion_QA", "P1-LOAD-SYS-03",
     "SYS: optimizacion Nginx cache/compresion y tuning VPS Lima",
     "Cache estatico, gzip/brotli, limites de conexion y ajuste de recursos para carga concurrente minera.",
     "SYS", "INFRAESTRUCTURA,DEVOPS", "High", 13, 15, "R4", "P1-LOAD-SYS-02", "Media", "Medio", "Infraestructura", 24),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-LOAD-QA-01",
     "QA: plan maestro de pruebas y casos base modulos core",
     "Elaborar TQA01 extendido, casos smoke/regression para auth, CRUD informes y telemetria base.",
     "QA,PAF", "PRUEBAS_CALIDAD,DOCUMENTACION", "High", 5, 8, "R2", "P1-M1-005", "Media", "Medio", "QA", 32),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-LOAD-QA-02",
     "QA: pruebas regresion editor TipTap y exportacion temprana",
     "Validacion continua de formato, tablas, imagenes y export PDF/DOCX en iteraciones quincenales.",
     "QA", "PRUEBAS_CALIDAD,EDITOR,EXPORTACION", "High", 9, 12, "R3", "P1-M3-001", "Media", "Medio", "QA", 36),

    ("PASO 1", "MES5_OCTUBRE_Optimizacion", "P1-LOAD-QA-03",
     "QA: pentest funcional, OWASP y pruebas de carga incremental",
     "Bateria de seguridad aplicativa, inyeccion SQL/XSS y load test progresivo hacia 10k sensores.",
     "QA,BE2", "PRUEBAS_CALIDAD,SEGURIDAD", "Urgent", 17, 21, "R5", "P1-LOAD-QA-02", "Alta", "Alto", "QA", 40),

    ("PASO 1", "MES2_JULIO_Core_Seguridad", "P1-LOAD-IA-01",
     "IA: PoC corrector ortografico LanguageTool + vocabulario minero",
     "Integracion inicial de correccion linguistica con diccionario tecnico minero peruano/latam.",
     "IA,BE2", "INTELIGENCIA_ARTIFICIAL,EDITOR", "High", 5, 7, "R2", "P1-M2-019", "Alta", "Medio", "IA", 28),

    ("PASO 1", "MES3_AGOSTO_UX_Sensores", "P1-LOAD-IA-02",
     "IA: pipeline STT Whisper con acento regional y ruido de socavon",
     "Entrenamiento/fine-tuning de vocabulario minero para dictado por voz en condiciones ruidosas.",
     "IA,BE3", "INTELIGENCIA_ARTIFICIAL,EDITOR", "High", 9, 12, "R3", "P1-LOAD-IA-01", "Alta", "Alto", "IA", 32),

    ("PASO 1", "MES5_OCTUBRE_Optimizacion", "P1-LOAD-IA-03",
     "IA: modelos ONNX biometria y deteccion EPP en stream CCTV",
     "Despliegue de inferencia facial liveness y vision EPP integrada a alertas operativas.",
     "IA,BE2", "INTELIGENCIA_ARTIFICIAL,SEGURIDAD,SENSOR", "High", 17, 21, "R5", "P1-LOAD-IA-02", "Alta", "Alto", "IA", 36),
]

# ── Pipeline: ajuste de horas, rebalanceo de recursos, programacion con tope 100% mensual ──
TASKS = apply_hour_overrides(TASKS)
TASKS = consolidate_pmo_to_paf(TASKS)
TASKS = consolidate_dba_to_be1(TASKS)
TASKS = rebalance_backend_after_dba(TASKS)
TASKS = strip_sys_from_early_tasks(TASKS)
TASKS = strip_fe2_from_june_tasks(TASKS)
TASKS = strip_qa_from_june_tasks(TASKS)
TASKS = strip_ia_from_june_tasks(TASKS)
TASKS = boost_qa_ia_active_load(TASKS)
TASKS = boost_paf_load(TASKS)
TASKS = boost_all_resources_coassign(TASKS)
TASKS = rebalance_frontend_coverage(TASKS)
TASKS = rebalance_assignments(TASKS)
TASKS = normalize_resource_hours(TASKS)
TASKS = normalize_resource_active_months(TASKS)

_sched = run_schedule_with_monthly_floor(TASKS)
TASK_DATES, MONTHLY_LOAD, TASKS, TASK_ALLOCS = _sched
TASK_DATES = finalize_task_dates(TASKS, TASK_DATES, TASK_ALLOCS)
LOAD_VIOLATIONS = validate_monthly_load(MONTHLY_LOAD)
DATE_LOAD = compute_monthly_load(TASKS, TASK_DATES, TASK_ALLOCS)
if LOAD_VIOLATIONS or any(h > max_hours_for_resource(c) + 0.5 for c, h in resource_totals(TASKS).items()):
    TASKS = normalize_resource_hours(TASKS)
    TASKS = normalize_resource_active_months(TASKS)
    TASKS = strip_sys_from_early_tasks(TASKS)
    TASKS = strip_fe2_from_june_tasks(TASKS)
    TASKS = strip_qa_from_june_tasks(TASKS)
    TASKS = strip_ia_from_june_tasks(TASKS)
    TASKS = consolidate_pmo_to_paf(TASKS)
    TASKS = consolidate_dba_to_be1(TASKS)
    TASKS = rebalance_backend_after_dba(TASKS)
    TASKS = boost_qa_ia_active_load(TASKS)
    TASKS = boost_paf_load(TASKS)
    TASKS = boost_all_resources_coassign(TASKS)
    TASKS = rebalance_frontend_coverage(TASKS)
    _sched = run_schedule_with_monthly_floor(TASKS)
    TASK_DATES, MONTHLY_LOAD, TASKS, TASK_ALLOCS = _sched
    TASK_DATES = finalize_task_dates(TASKS, TASK_DATES, TASK_ALLOCS)
    LOAD_VIOLATIONS = validate_monthly_load(MONTHLY_LOAD)
    DATE_LOAD = compute_monthly_load(TASKS, TASK_DATES, TASK_ALLOCS)
CAPACITY_TASKS = build_capacity_tasks(MONTHLY_LOAD)
for cap in CAPACITY_TASKS:
    mo_num = int(cap[2].split("-M")[1])
    TASK_DATES[cap[2]] = MONTH_BOUNDS[mo_num]
ALL_TASKS = TASKS + CAPACITY_TASKS
TASK_DATES = align_dates_for_clickup_import(ALL_TASKS, TASK_DATES, TASK_ALLOCS)
IMPORT_ORDER = import_sequence_order(ALL_TASKS)
INTEGRITY_REPORT = validate_project_integrity(TASKS, TASK_DATES, MONTHLY_LOAD, TASK_ALLOCS)
DATE_VIOLATIONS = validate_monthly_load(DATE_LOAD)
if DATE_VIOLATIONS:
    INTEGRITY_REPORT["warnings"].append(
        f"Verificacion cruzada fechas Gantt vs asignacion: {len(DATE_VIOLATIONS)} divergencias (>2% tolerancia)"
    )


# ══════════════════════════════════════════════════════════════════════════════
# GENERACION DEL EXCEL (mantiene formato original)
# ══════════════════════════════════════════════════════════════════════════════

ws1 = wb.active
ws1.title = "ClickUp_Import"

HEADERS = [
    "Task ID", "Task Name", "Task Content", "Folder (ClickUp)", "List (ClickUp)",
    "Assignee(s)", "Recurso Asignado", "Status", "Priority", "Start Date", "Due Date", "Tags",
    "Time Estimate (hours)", "Release", "Depends On", "Complejidad", "Riesgo",
    "Stream", "% Avance", "Ambiente", "Sprint", "Mes Calendario", "Carga Mes %", "Tipo Metodologia",
]

header_font = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
header_fill = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
thin_border = Border(
    left=Side(style="thin"), right=Side(style="thin"),
    top=Side(style="thin"), bottom=Side(style="thin"),
)

for col_idx, header in enumerate(HEADERS, 1):
    cell = ws1.cell(row=1, column=col_idx, value=header)
    cell.font = header_font
    cell.fill = header_fill
    cell.alignment = header_align
    cell.border = thin_border

FOLDER_COLORS = {
    "PASO 1": PatternFill(start_color="E8F4FD", end_color="E8F4FD", fill_type="solid"),
    "PASO 2": PatternFill(start_color="FFF3E0", end_color="FFF3E0", fill_type="solid"),
    "Control de calidad": PatternFill(start_color="E8F5E9", end_color="E8F5E9", fill_type="solid"),
    "DevOps": PatternFill(start_color="F3E5F5", end_color="F3E5F5", fill_type="solid"),
    "Riesgos": PatternFill(start_color="FBE9E7", end_color="FBE9E7", fill_type="solid"),
    "Gestion PMO": PatternFill(start_color="FFFDE7", end_color="FFFDE7", fill_type="solid"),
}

for row_idx, tid in enumerate(IMPORT_ORDER, 2):
    task = {t[2]: t for t in ALL_TASKS}[tid]
    folder, list_name, task_id, task_name, description, assignees, tags, priority, sw, ew, release, depends, complexity, risk, stream, hours = task
    start_d, due_d = TASK_DATES[task_id]
    start_date = format_clickup_date(start_d)
    due_date = format_clickup_date(due_d)
    clean_tags = consolidate_tags(tags)
    recurso_text = format_resource_field(assignees)
    sprint = sprint_label_for_range(start_d, due_d)
    mes_cal = LIST_CALENDAR_MONTH.get(list_name, "Transversal")
    code = parse_assignees(assignees)[0]
    if list_name == "Capacidad_Recursos":
        mo_num = int(task_id.split("-M")[1])
        mes_cal = MONTH_LABELS[mo_num]
        carga_mes = round(MONTHLY_LOAD.get(code, {}).get(mo_num, 0) / MONTH_CAPACITY[mo_num] * 100, 1)
    else:
        primary_month = start_d.month if 6 <= start_d.month <= 11 else due_d.month
        carga_mes = round(MONTHLY_LOAD.get(code, {}).get(primary_month, 0) / MONTH_CAPACITY[primary_month] * 100, 1)
    met_tipo = metodologia_tipo_for_task(task)
    row_data = [
        task_id, task_name, description, folder, list_name, recurso_text,
        recurso_text,
        "Backlog", priority, start_date, due_date, clean_tags, hours, release,
        depends, complexity, risk, stream, 0, "Desarrollo",
        sprint, mes_cal, carga_mes, met_tipo,
    ]
    for col_idx, value in enumerate(row_data, 1):
        cell = ws1.cell(row=row_idx, column=col_idx, value=value)
        cell.border = thin_border
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        if folder in FOLDER_COLORS:
            cell.fill = FOLDER_COLORS[folder]

col_widths = [12, 60, 90, 18, 30, 22, 22, 12, 10, 12, 12, 28, 8, 8, 14, 12, 10, 16, 8, 12, 10, 14, 10, 28]
for i, w in enumerate(col_widths, 1):
    ws1.column_dimensions[get_column_letter(i)].width = w

ws1.auto_filter.ref = f"A1:X{len(ALL_TASKS) + 1}"
ws1.freeze_panes = "C2"


# ── HOJA 0: Import_ClickUp — encabezados compatibles con importador ClickUp ──
# Nombres estandar (Task Name, List Name, Task Description) + custom fields sin
# caracteres problematicos (%). NO incluye Assignee(s) ni Folder — evita confusion
# con "Persona asignada" y mapeos vacios en el paso 2 del asistente.
CLICKUP_IMPORT_HEADERS = [
    "Task Name",
    "Task Description",
    "List Name",
    "Status",
    "Priority",
    "Start Date",
    "Due Date",
    "Tags",
    "Time Estimate",
    "Task ID",
    "Recurso",
    "Release",
    "Depends On",
    "Complejidad",
    "Riesgo",
    "Stream",
    "Ambiente",
    "Sprint",
    "Mes Calendario",
    "Carga Mes Porcentaje",
    "Tipo Metodologia",
]

ws0 = wb.create_sheet("Import_ClickUp", 0)
import_header_fill = PatternFill(start_color="2E7D32", end_color="2E7D32", fill_type="solid")
for col_idx, header in enumerate(CLICKUP_IMPORT_HEADERS, 1):
    cell = ws0.cell(row=1, column=col_idx, value=header)
    cell.font = header_font
    cell.fill = import_header_fill
    cell.alignment = header_align
    cell.border = thin_border

import_rows = []
for task in ALL_TASKS:
    folder, list_name, task_id, task_name, description, assignees, tags, priority, sw, ew, release, depends, complexity, risk, stream, hours = task
    start_d, due_d = TASK_DATES[task_id]
    start_date = format_clickup_date(start_d)
    due_date = format_clickup_date(due_d)
    clean_tags = consolidate_tags(tags)
    recurso_text = format_resource_field(assignees)
    sprint = sprint_label_for_range(start_d, due_d)
    mes_cal = LIST_CALENDAR_MONTH.get(list_name, "Transversal")
    if list_name == "Capacidad_Recursos":
        mo_num = int(task_id.split("-M")[1])
        mes_cal = MONTH_LABELS[mo_num]
        code = parse_assignees(assignees)[0]
        carga_mes = round(MONTHLY_LOAD.get(code, {}).get(mo_num, 0) / MONTH_CAPACITY[mo_num] * 100, 1)
    else:
        primary_month = start_d.month if 6 <= start_d.month <= 11 else due_d.month
        code = parse_assignees(assignees)[0]
        carga_mes = round(MONTHLY_LOAD.get(code, {}).get(primary_month, 0) / MONTH_CAPACITY[primary_month] * 100, 1)
    met_tipo = metodologia_tipo_for_task(task)
    import_rows.append([
        task_name,
        description,
        list_name,
        "Backlog",
        priority,
        start_date,
        due_date,
        clean_tags,
        hours,
        task_id,
        recurso_text,
        release or "",
        (depends or "").strip(),
        complexity,
        risk,
        stream,
        "Desarrollo",
        sprint,
        mes_cal,
        carga_mes,
        met_tipo,
    ])

_order_idx = {tid: i for i, tid in enumerate(IMPORT_ORDER)}
import_rows.sort(key=lambda r: _order_idx.get(r[9], 99999))

for row_idx, row_vals in enumerate(import_rows, 2):
    tid = row_vals[9]
    task_by_id = {t[2]: t for t in ALL_TASKS}
    folder = task_by_id.get(tid, ALL_TASKS[0])[0]
    for col_idx, value in enumerate(row_vals, 1):
        cell = ws0.cell(row=row_idx, column=col_idx, value=value)
        cell.border = thin_border
        cell.alignment = Alignment(vertical="top", wrap_text=True)
        if folder in FOLDER_COLORS:
            cell.fill = FOLDER_COLORS[folder]

import_widths = [60, 90, 32, 10, 10, 12, 12, 28, 8, 12, 28, 6, 14, 10, 8, 16, 12, 10, 14, 12, 28]
for i, w in enumerate(import_widths, 1):
    ws0.column_dimensions[get_column_letter(i)].width = w
ws0.auto_filter.ref = f"A1:{get_column_letter(len(CLICKUP_IMPORT_HEADERS))}{len(import_rows) + 1}"
ws0.freeze_panes = "A2"
wb.active = ws0


# ── HOJA: Mapeo_Columnas_ClickUp (referencia 1:1 para pantalla de importacion) ──
ws_map = wb.create_sheet("Mapeo_Columnas_ClickUp")
map_headers = ["Columna Excel (Import_ClickUp)", "Mapear en ClickUp (ES)", "Tipo", "No mapear a"]
for col_idx, h in enumerate(map_headers, 1):
    cell = ws_map.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = import_header_fill
    cell.alignment = header_align
    cell.border = thin_border

mapeo_data = [
    ("Task Name", "Nombre de la tarea", "Nativo", ""),
    ("Task Description", "Descripcion / Task Content", "Nativo", ""),
    ("List Name", "Lista (List)", "Nativo", ""),
    ("Status", "Estado", "Nativo", ""),
    ("Priority", "Prioridad", "Nativo", ""),
    ("Start Date", "Fecha de inicio", "Nativo", ""),
    ("Due Date", "Fecha limite / vencimiento", "Nativo", ""),
    ("Tags", "Etiquetas", "Nativo", ""),
    ("Time Estimate", "Duracion estimada", "Nativo", "Horas en el Excel"),
    ("Task ID", "Campo personalizado Task ID", "Texto corto", ""),
    ("Recurso", "Campo personalizado Recurso", "Texto corto", "NO usar Persona asignada"),
    ("Release", "Campo personalizado Release", "Desplegable", ""),
    ("Depends On", "Campo personalizado Depends On", "Texto corto", ""),
    ("Complejidad", "Campo personalizado Complejidad", "Desplegable", ""),
    ("Riesgo", "Campo personalizado Riesgo", "Desplegable", ""),
    ("Stream", "Campo personalizado Stream", "Desplegable", ""),
    ("Ambiente", "Campo personalizado Ambiente", "Desplegable", ""),
    ("Sprint", "Campo personalizado Sprint", "Desplegable", ""),
    ("Mes Calendario", "Campo personalizado Mes Calendario", "Desplegable", ""),
    ("Carga Mes Porcentaje", "Campo personalizado Carga Mes Porcentaje", "Numero", "Crear campo con este nombre exacto"),
    ("Tipo Metodologia", "Campo personalizado Tipo Metodologia", "Desplegable", ""),
]
for r, row in enumerate(mapeo_data, 2):
    for c, val in enumerate(row, 1):
        cell = ws_map.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True, vertical="top")
for i, w in enumerate([28, 32, 14, 36], 1):
    ws_map.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 2: ESTRUCTURA CLICKUP ──
ws2 = wb.create_sheet("Estructura_ClickUp")

structure_headers = ["Nivel", "Nombre", "Tipo ClickUp", "Descripción", "Sprint(s)"]
for col_idx, h in enumerate(structure_headers, 1):
    cell = ws2.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="2E7D32", end_color="2E7D32", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

structure_data = [
    ("Space", "PLATAFORMA MINERA IA", "Space", "Programa enterprise de 6 meses: Junio-Noviembre 2026", ""),
    ("", "", "", "", ""),
    ("Folder", "PASO 1", "Folder", "Funcionalidad del sistema (Junio-Septiembre 2026)", "Sprint 1-8"),
    ("  List", "MES1_JUNIO_Analisis_Arquitectura", "List",
     "JUNIO 2026 (01/06 al 30/06) — Kick-off, diseño de BD, CI/CD, UX research, selección de tecnologías",
     "Sprint 1-2"),
    ("  List", "MES2_JULIO_Core_Seguridad", "List",
     "JULIO 2026 (01/07 al 31/07) — Motor C++, REST API, JWT/RBAC, WebSocket, Redis, estructura JSONB",
     "Sprint 3-4"),
    ("  List", "MES3_AGOSTO_UX_Sensores", "List",
     "AGOSTO 2026 (01/08 al 31/08) — Editor TipTap, mapas GIS Leaflet, sensores IoT, NLP, OCR, tablets",
     "Sprint 5-6"),
    ("  List", "MES4_SEPTIEMBRE_Integracion_QA", "List",
     "SEPTIEMBRE 2026 (01/09 al 30/09) — Exportaciones, integraciones, QA funcional, admin, multi-idioma",
     "Sprint 7-8"),
    ("", "", "", "", ""),
    ("Folder", "PASO 2", "Folder", "Infraestructura, seguridad y GoLive (Octubre-Noviembre 2026)", "Sprint 9-13"),
    ("  List", "MES5_OCTUBRE_Optimizacion", "List",
     "OCTUBRE 2026 (01/10 al 31/10) — Performance, seguridad avanzada, pentesting, HA, DRP, modelos IA",
     "Sprint 9-11"),
    ("  List", "MES6_NOVIEMBRE_GoLive", "List",
     "NOVIEMBRE 2026 (01/11 al 30/11) — Pruebas de estrés, UAT, marcha blanca, capacitación, producción",
     "Sprint 12-13"),
    ("", "", "", "", ""),
    ("Folder", "Control de calidad", "Folder", "QA transversal continuo (Junio-Noviembre 2026)", "Sprint 1-13"),
    ("  List", "QA_Transversal", "List", "Testing, automatización, regresión, estándares de calidad", "Sprint 1-13"),
    ("", "", "", "", ""),
    ("Folder", "DevOps", "Folder", "Infraestructura y automatización (Junio-Noviembre 2026)", "Sprint 1-13"),
    ("  List", "DevOps_Infra", "List", "Repositorios Git, Docker, ambientes dev/staging/prod, CI/CD", "Sprint 1-13"),
    ("", "", "", "", ""),
    ("Folder", "Riesgos", "Folder", "Gestión de riesgos técnicos (Junio-Noviembre 2026)", "Sprint 1-13"),
    ("  List", "Gestion_Riesgos", "List", "Registro, mitigación, seguimiento quincenal de riesgos", "Sprint 1-13"),
    ("", "", "", "", ""),
    ("Folder", "Gestion PMO", "Folder", "Gobierno y gestion del proyecto (Junio-Noviembre 2026)", "Sprint 1-13"),
    ("  List", "PMO_Seguimiento", "List", "Ceremonias Scrum, metricas de avance, comites ejecutivos", "Sprint 1-13"),
    ("  List", "Capacidad_Recursos", "List",
     "PANEL DE CARGA MENSUAL: 54 tareas (9 recursos x 6 meses) con % de ocupacion. Importar y agrupar por Mes Calendario en ClickUp.",
     "Sprint 1-13"),
]

for r, row in enumerate(structure_data, 2):
    for c, val in enumerate(row, 1):
        cell = ws2.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)

for i, w in enumerate([12, 35, 14, 60, 14], 1):
    ws2.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 3: RECURSOS Y CAPACIDAD ──
ws3 = wb.create_sheet("Recursos_Capacidad")

res_headers = ["Código", "Recurso (Excel)", "Grupo", "Rol", "Descripción Detallada", "Stream Principal", "Tarifa USD/mes",
               "Horas Totales Asignadas", "Carga Promedio %", "Estado"]
for col_idx, h in enumerate(res_headers, 1):
    cell = ws3.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="BF360C", end_color="BF360C", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

TARIFFS = {"BE1": 1900, "BE2": 1900, "BE3": 1900, "FE1": 1800, "FE2": 1800,
           "ARQ": 1900, "SYS": 1800, "QA": 1800, "IA": 1900, "PAF": 1600}
STREAMS = {"BE1": "Backend Core", "BE2": "Ciberseguridad Backend", "BE3": "Integraciones",
           "FE1": "Frontend Principal", "FE2": "UX y Soporte", "ARQ": "Arquitectura",
           "SYS": "Infraestructura", "QA": "Calidad", "IA": "IA y Automatización",
           "PAF": "PMO Soporte"}

resource_hours = {k: 0 for k in RESOURCES}
for task in TASKS:
    assignees = task[5].split(",")
    hours_per = task[15] / len(assignees)
    for a in assignees:
        a = a.strip()
        if a in resource_hours:
            resource_hours[a] += hours_per

total_project_hours = round(sum(MONTH_CAPACITY.values()), 1)

for r, (code, role) in enumerate(RESOURCES.items(), 2):
    hours = round(resource_hours.get(code, 0))
    cap_h = capacity_hours_for_resource(code)
    load_pct = round((hours / cap_h) * 100, 1) if cap_h else 0.0

    if load_pct > 100:
        estado = "SOBRECARGA"
        overload_fill = PatternFill(start_color="FFCDD2", end_color="FFCDD2", fill_type="solid")
    elif load_pct >= 88:
        estado = "ÓPTIMO"
        overload_fill = PatternFill(start_color="C8E6C9", end_color="C8E6C9", fill_type="solid")
    elif load_pct > 70:
        estado = "MODERADO"
        overload_fill = PatternFill(start_color="FFF9C4", end_color="FFF9C4", fill_type="solid")
    else:
        estado = "BAJO"
        overload_fill = PatternFill(start_color="FFCDD2", end_color="FFCDD2", fill_type="solid")

    recurso_label = RESOURCE_DISPLAY.get(code, code)
    role_short = role.split("—")[0].strip() if "—" in role else role
    row_data = [code, recurso_label, RESOURCE_GROUP.get(code, ""), role_short, RESOURCES[code],
                STREAMS[code], TARIFFS[code], hours, load_pct, estado]
    for c, val in enumerate(row_data, 1):
        cell = ws3.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)
        if overload_fill and c in (1, 2, 3, 8, 9, 10):
            cell.fill = overload_fill

for i, w in enumerate([10, 24, 12, 28, 50, 18, 12, 12, 12, 12], 1):
    ws3.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 4: RELEASES Y MILESTONES ──
ws4 = wb.create_sheet("Releases_Milestones")

rel_headers = ["Release", "Objetivo", "Inicio", "Fin", "Folder", "Tareas Incluidas", "Milestone"]
for col_idx, h in enumerate(rel_headers, 1):
    cell = ws4.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="4A148C", end_color="4A148C", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

release_data = [
    ("R1", "Arquitectura Core", "2026-06-01", "2026-06-30",
     "PASO 1", "MES1 completo + QA-001 + RSK-001/002 (sin SYS — mes 1 solo diseno)", "Diseno y arquitectura aprobados"),
    ("R2", "Motor Operacional", "2026-07-01", "2026-07-31",
     "PASO 1", "MES2 + DEV-001/002 + inicio VPS dev (DEV-003 sem 8)", "Backend + Git + Docker + VPS desarrollo"),
    ("R3", "UX + GIS + Editor", "2026-08-01", "2026-08-31",
     "PASO 1", "MES3 (frontend) + MES4 (wireframes) + QA-003", "Frontend con editor, GIS y dashboards"),
    ("R4", "Integraciones", "2026-09-01", "2026-09-30",
     "PASO 1", "MES4 completo (export + offline + comments)", "Sistema integrado e2e funcional"),
    ("R5", "Hardening", "2026-10-01", "2026-10-31",
     "PASO 2", "MES5 completo (infra + IA avanzada)", "Infraestructura productiva con DR y monitoreo"),
    ("R6", "GoLive", "2026-11-01", "2026-11-30",
     "PASO 2", "MES6 completo (stress + UAT + prod)", "Sistema en produccion LATAM"),
]

for r, row in enumerate(release_data, 2):
    for c, val in enumerate(row, 1):
        cell = ws4.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)

for i, w in enumerate([10, 22, 14, 14, 12, 50, 45], 1):
    ws4.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 5: TAGS REFERENCE ──
ws5 = wb.create_sheet("Tags_Reference")

tag_headers = ["Tag", "Descripción", "Color Sugerido"]
for col_idx, h in enumerate(tag_headers, 1):
    cell = ws5.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="01579B", end_color="01579B", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

tag_colors = {
    "CORE": "#1976D2", "IA": "#7B1FA2", "GIS": "#388E3C", "SENSOR": "#F57C00",
    "UX": "#00BCD4", "SECURITY": "#D32F2F", "DEVOPS": "#5D4037", "QA": "#689F38",
    "CRITICO": "#B71C1C", "GO_LIVE": "#1B5E20", "EXPORT": "#0277BD",
    "DB": "#455A64", "ARCH": "#37474F", "DOCUMENTACION": "#78909C",
    "EDITOR": "#E65100", "NOTIF": "#0097A7", "OFFLINE": "#546E7A",
}

for r, (tag, desc) in enumerate(TAGS_MAP.items(), 2):
    ws5.cell(row=r, column=1, value=tag).border = thin_border
    ws5.cell(row=r, column=2, value=desc).border = thin_border
    ws5.cell(row=r, column=3, value=tag_colors.get(tag, "#757575")).border = thin_border

for i, w in enumerate([14, 30, 16], 1):
    ws5.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 6: WORKFLOW / ESTADOS ──
ws6 = wb.create_sheet("Workflow_Estados")

wf_headers = ["Estado", "Descripción", "Orden"]
for col_idx, h in enumerate(wf_headers, 1):
    cell = ws6.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="E65100", end_color="E65100", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

for r, row in enumerate([
    ("Backlog", "Pendiente de inicio", 1),
    ("Análisis", "En análisis y diseño funcional", 2),
    ("Arquitectura", "En diseño técnico y arquitectura", 3),
    ("Desarrollo", "En construcción activa", 4),
    ("QA", "En validación y testing", 5),
    ("UAT", "En pruebas con usuario final", 6),
    ("Hardening", "En optimización y hardening", 7),
    ("GoLive Ready", "Listo para producción", 8),
    ("Done", "Completado y validado", 9),
    ("Blocked", "Bloqueado por dependencia o impedimento", 10),
], 2):
    for c, val in enumerate(row, 1):
        cell = ws6.cell(row=r, column=c, value=val)
        cell.border = thin_border

for i, w in enumerate([16, 45, 8], 1):
    ws6.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 7: CUSTOM FIELDS REFERENCE ──
ws7 = wb.create_sheet("Custom_Fields")

cf_headers = ["Campo", "Tipo ClickUp", "Opciones / Detalle"]
for col_idx, h in enumerate(cf_headers, 1):
    cell = ws7.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="006064", end_color="006064", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

for r, row in enumerate([
    ("Recurso", "Short Text", "Persona/rol asignado: BE1-Arq.Datos, FE1-Interfaces, etc. CAMPO CLAVE para identificar recursos"),
    ("Complejidad", "Dropdown", "Baja, Media, Alta"),
    ("Riesgo", "Dropdown", "Bajo, Medio, Alto"),
    ("Stream", "Dropdown", "Arquitectura, Backend, Frontend, Infraestructura, QA, IA"),
    ("Dependencia crítica", "Checkbox", "Sí/No"),
    ("Ambiente", "Dropdown", "Desarrollo, Staging, QA, Producción"),
    ("Release", "Dropdown", "R1, R2, R3, R4, R5, R6"),
    ("Sprint", "Dropdown", "S1, S2, S3, S4, S5, S6, S7, S8, S9, S10, S11, S12, S13 (o rango S3-S4)"),
    ("Mes Calendario", "Dropdown", "Junio, Julio, Agosto, Septiembre, Octubre, Noviembre, Transversal"),
    ("Carga Mes Porcentaje", "Number", "Porcentaje de ocupacion del recurso en el mes (meta 90%+). Nombre exacto para importacion."),
    ("Tipo Metodologia", "Dropdown", "Agile — Desarrollo por Sprint, PMO — Gobierno, PMO — Riesgos, PMO — Capacidad, Agile — QA continuo, Agile — DevOps"),
    ("% Avance Técnico", "Number", "0 - 100"),
    ("Horas Estimadas", "Number", "Horas de trabajo"),
    ("Horas Reales", "Number", "Horas reales invertidas"),
    ("Task ID", "Short Text", "Identificador único de tarea"),
], 2):
    for c, val in enumerate(row, 1):
        cell = ws7.cell(row=r, column=c, value=val)
        cell.border = thin_border

for i, w in enumerate([22, 16, 50], 1):
    ws7.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 8: CRONOGRAMA SEMANAL (Vista Gantt) ──
ws8 = wb.create_sheet("Cronograma_Semanal")

gantt_headers = ["Task ID", "Tarea", "Recurso", "Start Date", "Due Date"] + [f"S{i}" for i in range(1, 27)]
for col_idx, h in enumerate(gantt_headers, 1):
    cell = ws8.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    if col_idx <= 3:
        cell.fill = PatternFill(start_color="1A237E", end_color="1A237E", fill_type="solid")
    elif col_idx <= 19:
        cell.fill = PatternFill(start_color="283593", end_color="283593", fill_type="solid")
    else:
        cell.fill = PatternFill(start_color="4527A0", end_color="4527A0", fill_type="solid")
    cell.alignment = Alignment(horizontal="center", vertical="center")
    cell.border = thin_border

gantt_fills = {
    "PASO 1": PatternFill(start_color="42A5F5", end_color="42A5F5", fill_type="solid"),
    "PASO 2": PatternFill(start_color="FFA726", end_color="FFA726", fill_type="solid"),
    "Control de calidad": PatternFill(start_color="66BB6A", end_color="66BB6A", fill_type="solid"),
    "DevOps": PatternFill(start_color="AB47BC", end_color="AB47BC", fill_type="solid"),
    "Riesgos": PatternFill(start_color="EF5350", end_color="EF5350", fill_type="solid"),
    "Gestion PMO": PatternFill(start_color="78909C", end_color="78909C", fill_type="solid"),
}

for row_idx, task in enumerate(TASKS, 2):
    folder, list_name, task_id, task_name, desc, assignees, tags, priority, sw, ew, release, depends, complexity, risk, stream, hours = task
    ws8.cell(row=row_idx, column=1, value=task_id).border = thin_border
    name_short = task_name[:55] + "..." if len(task_name) > 55 else task_name
    ws8.cell(row=row_idx, column=2, value=name_short).border = thin_border
    ws8.cell(row=row_idx, column=3, value=assignees).border = thin_border
    sd, dd = TASK_DATES[task_id]
    ws8.cell(row=row_idx, column=4, value=format_clickup_date(sd)).border = thin_border
    ws8.cell(row=row_idx, column=5, value=format_clickup_date(dd)).border = thin_border

    fill = gantt_fills.get(folder, gantt_fills.get("DevOps"))

    for w in range(1, 27):
        cell = ws8.cell(row=row_idx, column=w + 5)
        cell.border = thin_border
        if sw <= w <= ew:
            cell.fill = fill
            if w == sw:
                cell.value = ">"
            elif w == ew:
                cell.value = "<"
            cell.alignment = Alignment(horizontal="center")

ws8.column_dimensions["A"].width = 12
ws8.column_dimensions["B"].width = 56
ws8.column_dimensions["C"].width = 10
ws8.column_dimensions["D"].width = 12
ws8.column_dimensions["E"].width = 12
for c in range(6, 32):
    ws8.column_dimensions[get_column_letter(c)].width = 4
ws8.freeze_panes = "F2"


# ── SHEET 9: CORRESPONDENCIA FRONTEND - BACKEND ──
ws9 = wb.create_sheet("Correspondencia_FE_BE")

corr_headers = ["Funcionalidad Frontend", "Task ID FE", "Funcionalidad Backend correspondiente", "Task ID BE", "Estado"]
for col_idx, h in enumerate(corr_headers, 1):
    cell = ws9.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="0D47A1", end_color="0D47A1", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

correspondences = [
    ("Reglas horizontales para posicionar texto", "P1-M3-014",
     "JSONB schema para rich text (almacena ruler data)", "P1-M2-014", "OK"),
    ("Agrupación de textos / cambio de font en lote", "P1-M3-015",
     "JSONB schema soporta font-family, font-size, bold, etc.", "P1-M2-014", "OK"),
    ("Color de fondo del texto (highlight)", "P1-M3-016",
     "JSONB schema incluye background-color por mark", "P1-M2-014", "OK"),
    ("Color de texto (foreground)", "P1-M3-017",
     "JSONB schema incluye text-color por mark", "P1-M2-014", "OK"),
    ("TipTap Editor core + extensions", "P1-M3-012",
     "Endpoint JSONB almacenamiento granular", "P1-M2-008", "OK"),
    ("Toolbar de formateo completo", "P1-M3-013",
     "JSONB schema soporta todas las marcas de formato", "P1-M2-014", "OK"),
    ("Tablas en editor (insert/edit/merge)", "P1-M3-018",
     "JSONB schema soporta nodos Table/Row/Cell", "P1-M2-014", "OK"),
    ("Imágenes (upload, drag-drop, resize)", "P1-M3-019",
     "API de upload y almacenamiento (storage service)", "P1-M3-022", "OK"),
    ("Listas (ordenadas, desordenadas, checklist)", "P1-M3-020",
     "JSONB schema soporta nodos List/ListItem/TaskItem", "P1-M2-014", "OK"),
    ("Saltos de página y numeración", "P1-M3-021",
     "Motor PDF renderiza page breaks y numeración", "P1-M3-025", "OK"),
    ("Auto-guardado en frontend (timer 3s)", "P1-M3-012",
     "API de auto-save delta con conflict resolution", "P1-M2-015", "OK"),
    ("Búsqueda avanzada y filtrado", "P1-M3-002",
     "Motor de búsqueda full-text (pg_trgm + tsvector)", "P1-M3-023", "OK"),
    ("Print preview con paginación", "P1-M4-012",
     "Motor de generación PDF server-side", "P1-M3-025", "OK"),
    ("Comentarios y anotaciones (panel sidebar)", "P1-M4-014",
     "API CRUD de comentarios y anotaciones", "P1-M4-020", "OK"),
    ("Comparador de versiones (diff visual)", "P1-M4-015",
     "Motor de versionado con diff engine", "P1-M2-016", "OK"),
    ("Galería de templates", "P1-M4-016",
     "Motor de templates CRUD y renderizado", "P1-M3-024", "OK"),
    ("Portada, headers y footers", "P1-M4-017",
     "Motor PDF renderiza portada/headers/footers", "P1-M3-025", "OK"),
    ("Modo offline con sync indicator", "P1-M4-018",
     "Motor de resolución de conflictos offline sync", "P1-M4-028", "OK"),
    ("Dictado por voz + corrección IA", "P1-M3-005",
     "Servicio NLP corrección ortográfica español", "P1-M3-026", "OK"),
    ("Exportación DOCX", "P1-M4-001",
     "Motor generación DOCX (BE1)", "P1-M4-001", "OK"),
    ("Exportación PPTX", "P1-M4-002",
     "Motor generación PPTX (BE1)", "P1-M4-002", "OK"),
    ("Exportación PDF", "P1-M4-012",
     "Motor generación PDF server-side (BE1)", "P1-M3-025", "OK"),
    ("Flujo aprobación/revisión/firmas", "P1-M3-001",
     "Endpoints REST autorización/revisión/firmas", "P1-M2-005", "OK"),
    ("Firma digital en informes", "P1-M3-001",
     "Servicio de verificación de firma digital PKI", "P1-M4-025", "OK"),
    ("Keyboard shortcuts (Ctrl+B, etc.)", "P1-M4-013",
     "No requiere backend (client-side only)", "N/A", "OK"),
    ("Responsive tablet layout", "P1-M4-019",
     "No requiere backend (CSS responsive)", "N/A", "OK"),
    # Nuevas correspondencias v4
    ("Pantallas para tablets de campo", "FE2-U04",
     "No requiere backend (CSS/media queries)", "N/A", "OK"),
    ("Internacionalización (i18n)", "FE2-U05",
     "No requiere backend (strings client-side)", "N/A", "OK"),
    ("Templates de email de notificaciones", "FE2-U06",
     "Servicio de envío de emails HTML", "P1-M3-027", "OK"),
    ("Plantillas corporativas de informes", "FE2-U07",
     "Motor de templates CRUD y renderizado", "P1-M3-024", "OK"),
    ("Onboarding de nuevos usuarios", "FE2-U08",
     "No requiere backend (client-side tour)", "N/A", "OK"),
    ("Ayuda contextual (tooltips, FAQ)", "FE2-U09",
     "No requiere backend (client-side)", "N/A", "OK"),
    ("Módulo admin: usuarios, roles, config", "FE2-U10",
     "Endpoints REST RBAC y configuración", "P1-M2-006", "OK"),
    ("Dashboard ejecutivo gerencia", "FE2-U11",
     "APIs de KPIs y métricas agregadas", "P1-M2-008", "OK"),
    ("PWA (Progressive Web App)", "FE1-O02",
     "No requiere backend (Service Worker)", "N/A", "OK"),
    ("Storybook de componentes React", "FE1-O04",
     "No requiere backend (documentación FE)", "N/A", "OK"),
    ("Pantallas gerencia ejecutiva", "FE1-O06",
     "APIs de dashboard y KPIs gerenciales", "P1-M2-008", "OK"),
    ("Admin: CRUD usuarios y roles", "FE1-O07",
     "Endpoints REST RBAC usuarios/roles", "P1-M2-006", "OK"),
    ("Historial de actividades y audit trail", "FE1-O08",
     "API de audit log enriquecido", "P1-M4-023", "OK"),
    ("Auto-completado inteligente minero", "IA-M07",
     "Backend NLP model serving (IA)", "IA-M07", "OK"),
    ("Gráficos inteligentes desde datos", "IA-M08",
     "API de sugerencia de gráficos (IA)", "IA-M08", "OK"),
    ("OCR de documentos escaneados", "IA-M04",
     "Microservicio OCR Tesseract (IA)", "IA-M04", "OK"),
    ("Autenticación 2FA/MFA", "BE2-S03",
     "Backend 2FA TOTP (BE2)", "BE2-S03", "OK"),
    ("Notificaciones in-app WebSocket", "BE3-I08",
     "Backend WebSocket notifications (BE3)", "BE3-I08", "OK"),
    ("SMS/WhatsApp alertas críticas", "BE3-I07",
     "Gateway SMS Twilio integration (BE3)", "BE3-I07", "OK"),
]

for r, row in enumerate(correspondences, 2):
    for c, val in enumerate(row, 1):
        cell = ws9.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)
        if val == "OK":
            cell.fill = PatternFill(start_color="C8E6C9", end_color="C8E6C9", fill_type="solid")

for i, w in enumerate([40, 12, 45, 12, 8], 1):
    ws9.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 10: METODOLOGIA SPRINT Y CALENDARIO ──
ws10 = wb.create_sheet("Metodologia_Sprint")

meth_headers = ["Concepto", "Detalle", "Responsable", "Frecuencia", "Duración"]
for col_idx, h in enumerate(meth_headers, 1):
    cell = ws10.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

methodology_data = [
    ("METODOLOGIA", "Scrum Híbrido (Agile + PMO Ejecutivo)", "", "", ""),
    ("Duración del proyecto", "6 meses: 1 de Junio 2026 al 30 de Noviembre 2026", "ARQ", "", "26 semanas"),
    ("Duración del Sprint", "2 semanas (10 días laborables)", "ARQ", "Quincenal", "2 semanas"),
    ("Total de Sprints", "13 sprints en 26 semanas", "ARQ", "", ""),
    ("", "", "", "", ""),
    ("CALENDARIO DE SPRINTS", "", "", "", ""),
    ("Sprint 1", "01/06/2026 — 12/06/2026", "MES1 JUNIO", "Kick-off, SOW, levantamiento funcional", ""),
    ("Sprint 2", "15/06/2026 — 26/06/2026", "MES1 JUNIO", "Diseño BD, CI/CD, UX research, Design System", ""),
    ("Sprint 3", "29/06/2026 — 10/07/2026", "MES2 JULIO", "Motor C++ core, REST API, JWT, WebSocket", ""),
    ("Sprint 4", "13/07/2026 — 24/07/2026", "MES2 JULIO", "RBAC, Redis, auto-save, JSONB schema, sensores", ""),
    ("Sprint 5", "27/07/2026 — 07/08/2026", "MES3 AGOSTO", "Editor TipTap, toolbar, reglas, GIS base", ""),
    ("Sprint 6", "10/08/2026 — 21/08/2026", "MES3 AGOSTO", "Sensores IoT, NLP, OCR, STT, tablets, IA", ""),
    ("Sprint 7", "24/08/2026 — 04/09/2026", "MES4 SEPTIEMBRE", "Exportaciones, integraciones, SCADA, admin", ""),
    ("Sprint 8", "07/09/2026 — 18/09/2026", "MES4 SEPTIEMBRE", "Print preview, templates, i18n, offline, SMS", ""),
    ("Sprint 9", "21/09/2026 — 02/10/2026", "MES5 OCTUBRE", "Performance, hardening, pentesting inicio", ""),
    ("Sprint 10", "05/10/2026 — 16/10/2026", "MES5 OCTUBRE", "DRP, SIEM, Docker hardening, IA producción", ""),
    ("Sprint 11", "19/10/2026 — 30/10/2026", "MES5 OCTUBRE", "Optimización final, model cards, capacity", ""),
    ("Sprint 12", "02/11/2026 — 13/11/2026", "MES6 NOVIEMBRE", "Stress test 10K sensores, UAT, marcha blanca", ""),
    ("Sprint 13", "16/11/2026 — 27/11/2026", "MES6 NOVIEMBRE", "Correcciones finales, GoLive, producción", ""),
    ("", "", "", "", ""),
    ("CEREMONIAS SCRUM", "", "", "", ""),
    ("Sprint Planning", "Planificación del sprint: seleccionar tareas del backlog, estimar esfuerzo, asignar responsables, definir objetivo del sprint", "ARQ facilita", "Cada 2 semanas (lunes del sprint)", "2 horas"),
    ("Daily Standup", "Reunión diaria de sincronización: qué hice ayer, qué haré hoy, qué me bloquea. Todo el equipo de pie, máximo 15 minutos", "ARQ facilita", "Diario (lunes a viernes, 9:00 AM)", "15 min"),
    ("Sprint Review", "Demostración de lo construido durante el sprint ante stakeholders (Gerencia TI, Gerencia Minera). Se valida que cumple criterios de aceptación", "ARQ presenta, QA valida", "Cada 2 semanas (viernes del sprint)", "1 hora"),
    ("Sprint Retrospective", "Sesión de mejora continua del equipo: qué funcionó bien, qué mejorar, acciones concretas para el próximo sprint", "ARQ facilita", "Cada 2 semanas (viernes del sprint)", "1 hora"),
    ("Comité Ejecutivo", "Reporte semanal a Gerencia TI y Gerencia Minera: estado semáforo, riesgos, presupuesto, decisiones pendientes. Formato ejecutivo de 1 página", "ARQ presenta", "Semanal (lunes, 10:00 AM)", "1 hora"),
    ("Revisión de Arquitectura", "Revisión semanal de decisiones técnicas, validación de diseño, resolución de impedimentos de arquitectura con equipo técnico", "ARQ y BE2 co-facilitan", "Semanal (miércoles, 11:00 AM)", "1 hora"),
    ("Comité de Riesgos", "Revisión quincenal del registro de riesgos: nuevos riesgos, riesgos materializados, efectividad de mitigaciones", "ARQ y QA", "Quincenal (jueves del sprint)", "30 min"),
    ("", "", "", "", ""),
    ("MESES CALENDARIO", "", "", "", ""),
    ("MES 1 — JUNIO 2026", "01/06/2026 al 30/06/2026 — Análisis y Arquitectura. Se establece la base técnica del proyecto.", "Todo el equipo", "Sprints 1-2", "4 semanas"),
    ("MES 2 — JULIO 2026", "01/07/2026 al 31/07/2026 — Core y Seguridad. Se construye el motor central del sistema.", "BE1, BE2, SYS", "Sprints 3-4", "4.4 semanas"),
    ("MES 3 — AGOSTO 2026", "01/08/2026 al 31/08/2026 — UX y Sensores. Se construye el editor y se integran sensores.", "FE1, FE2, IA, BE3", "Sprints 5-6", "4.4 semanas"),
    ("MES 4 — SEPTIEMBRE 2026", "01/09/2026 al 30/09/2026 — Integración y QA. Se conectan todos los sistemas.", "Todo el equipo", "Sprints 7-8", "4.3 semanas"),
    ("MES 5 — OCTUBRE 2026", "01/10/2026 al 31/10/2026 — Optimización y Seguridad. Se endurece y optimiza todo.", "SYS, BE2, QA, IA", "Sprints 9-11", "4.4 semanas"),
    ("MES 6 — NOVIEMBRE 2026", "01/11/2026 al 30/11/2026 — GoLive. Pruebas finales, marcha blanca, producción.", "Todo el equipo", "Sprints 12-13", "4.3 semanas"),
]

for r, row in enumerate(methodology_data, 2):
    for c, val in enumerate(row, 1):
        cell = ws10.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)
        if row[0] in ("METODOLOGIA", "CALENDARIO DE SPRINTS", "CEREMONIAS SCRUM", "MESES CALENDARIO"):
            cell.font = Font(bold=True, size=12, color="1565C0")

for i, w in enumerate([25, 70, 30, 35, 15], 1):
    ws10.column_dimensions[get_column_letter(i)].width = w


# ══════════════════════════════════════════════════════════════════════════════
# SHEET 11: GUIA DE IMPORTACION A CLICKUP
# ══════════════════════════════════════════════════════════════════════════════
ws11 = wb.create_sheet("Guia_Importacion_ClickUp")

guide_headers = ["Paso", "Accion", "Detalle", "Donde en ClickUp"]
for col_idx, h in enumerate(guide_headers, 1):
    cell = ws11.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = header_fill
    cell.border = thin_border
    cell.alignment = Alignment(horizontal="center", wrap_text=True)

guide_steps = [
    ("PROBLEMA RESUELTO", "", "", ""),
    ("Problema",
     "ClickUp muestra B, B, B, F, F como avatar de los asignados",
     "Los codigos BE1, BE2, BE3, FE1, FE2 empiezan con la misma letra y ClickUp solo muestra la 1ra letra como avatar",
     "Columna Assignee en vista Lista"),
    ("Solucion",
     "Usar columna 'Recurso' (campo de texto) en vez del Assignee nativo",
     "La columna 'Recurso' muestra el texto COMPLETO: BE1-Arq.Datos, BE2-Seguridad, etc. sin truncar",
     "Custom Field tipo Texto en ClickUp"),
    ("", "", "", ""),
    ("PASOS PARA IMPORTAR", "", "", ""),
    ("1",
     "Abrir ClickUp > Space 'PLATAFORMA MINERA IA'",
     "Ir al space que ya tienes creado",
     "Panel izquierdo > Espacios"),
    ("2",
     "Click en '...' (tres puntos) al lado del nombre del Space",
     "Se abre un menu con opciones del Space",
     "Panel izquierdo, junto a 'PLATAFORMA MINERA IA'"),
    ("3",
     "Seleccionar 'Importar / Exportar' > 'Importar'",
     "O alternativamente: Settings > Import/Export",
     "Menu contextual del Space"),
    ("4",
     "Seleccionar formato 'Excel'",
     "ClickUp pedira que subas el archivo .xlsx",
     "Pantalla de importacion"),
    ("5",
     "Subir el archivo: Plataforma_Minera_ClickUp_v19.xlsx",
     "HOJA OBLIGATORIA: 'Import_ClickUp' (1ra pestana). NO usar ClickUp_Import ni exportar a CSV manualmente.",
     "Selector de archivo"),
    ("5a",
     "Alternativa CSV: Plataforma_Minera_ClickUp_v19_Import.csv",
     "Si Excel falla, usar este CSV UTF-8 (mismas columnas que Import_ClickUp).",
     "Importar > CSV"),
    ("5b",
     "CREAR LISTA 'Capacidad_Recursos' en Folder 'Gestion PMO' antes de importar",
     "Esta lista recibe los 60 indicadores de carga mensual (CAP-BE1-M06, etc.)",
     "Folder Gestion PMO > + Add List"),
    ("6",
     "IMPORTANTE: Seleccionar formato de fecha 'Year-Month-Day' (YYYY-MM-DD)",
     "Las fechas estan en formato ISO 2026-06-01. NO seleccionar Month/Day/Year (causa fechas en abril incorrectamente).",
     "Pantalla selector de formato de fecha"),
    ("7",
     "MAPEAR LAS COLUMNAS (paso mas importante)",
     "ClickUp mostrara cada columna del Excel y pedira que indiques que campo es",
     "Pantalla de mapeo de columnas"),
    ("",
     "  Task ID -> Custom Field 'Task ID' (tipo Texto)",
     "Identificador unico de la tarea",
     ""),
    ("",
     "  Task Name -> Nombre de la tarea (campo nativo)",
     "Columna 1 de hoja Import_ClickUp",
     ""),
    ("",
     "  Task Description -> Descripcion (campo nativo)",
     "Columna 2 — NO es 'Task Content' en esta hoja",
     ""),
    ("",
     "  List Name -> Lista (campo nativo)",
     "Columna 3 — nombre exacto de lista en ClickUp",
     ""),
    ("",
     "  Recurso -> Campo personalizado 'Recurso' (TEXTO)",
     "Columna 11. NO mapear a Persona asignada / Assignee",
     "Crear Custom Field tipo Texto"),
    ("",
     "  Assignee(s) — NO EXISTE en Import_ClickUp",
     "Eliminado a proposito para evitar avatares B/B/B/F/F",
     ""),
    ("",
     "  Status -> Status (campo nativo)",
     "Estado de la tarea",
     ""),
    ("",
     "  Priority -> Priority (campo nativo)",
     "Prioridad: Urgent, High, Normal, Low",
     ""),
    ("",
     "  Start Date -> Start Date (campo nativo) — formato YYYY-MM-DD",
     "Fecha de inicio (ej: 2026-07-03). Mapear como Start date",
     ""),
    ("",
     "  Due Date -> Due Date (campo nativo) — formato YYYY-MM-DD",
     "Fecha limite (ej: 2026-07-10). Mapear como Due date",
     ""),
    ("",
     "  Tags -> Tags (campo nativo)",
     "Etiquetas del proyecto (20 tags consolidados)",
     ""),
    ("",
     "  Time Estimate -> Time Estimate (campo nativo)",
     "Horas estimadas",
     ""),
    ("",
     "  Release -> Custom Field 'Release' (tipo Texto)",
     "Release del proyecto (R1 a R6)",
     ""),
    ("",
     "  Depends On -> Custom Field 'Depends On' (tipo Texto)",
     "Dependencias entre tareas",
     ""),
    ("",
     "  Complejidad -> Custom Field (tipo Dropdown: Alta/Media/Baja)",
     "Nivel de dificultad",
     ""),
    ("",
     "  Riesgo -> Custom Field (tipo Dropdown: Alto/Medio/Bajo)",
     "Nivel de riesgo",
     ""),
    ("",
     "  Stream -> Custom Field (tipo Dropdown)",
     "Area: Backend, Frontend, IA, QA, Infraestructura, Arquitectura",
     ""),
    ("",
     "  Sprint -> Custom Field 'Sprint' (tipo Texto o Dropdown S1-S13)",
     "Identifica el sprint quincenal de cada tarea. Filtrar Gantt por Sprint para ver el cronograma iterativo.",
     ""),
    ("",
     "  Mes Calendario -> Custom Field 'Mes Calendario' (tipo Dropdown)",
     "Junio-Noviembre o Transversal. CLAVE para agrupar carga mensual.",
     ""),
    ("",
     "  Carga Mes Porcentaje -> Custom Field 'Carga Mes Porcentaje' (Number)",
     "Sin simbolo % en el nombre — ClickUp no lo parsea bien",
     ""),
    ("",
     "  Tipo Metodologia -> Custom Field (tipo Dropdown)",
     "PMO — Gobierno, Agile — Desarrollo por Sprint, PMO — Capacidad, etc.",
     ""),
    ("8",
     "Hacer click en 'Importar'",
     f"ClickUp procesara {len(ALL_TASKS)} filas ({len(TASKS)} tareas + {len(CAPACITY_TASKS)} indicadores capacidad)",
     "Boton de importacion"),
    ("9",
     "VER CARGA MENSUAL: ir a List 'Capacidad_Recursos'",
     "Agrupar por 'Mes Calendario' > ordenar por 'Carga Mes %'. Cada fila = 1 recurso en 1 mes.",
     "Vista Lista > Group by Mes Calendario"),
    ("10",
     "VER SPRINTS: filtrar cualquier lista por campo Sprint = S1, S2... S13",
     "O en Gantt: color por Sprint usando custom field. Calendario en hoja Metodologia_Sprint.",
     "Vista Gantt o Lista con filtro Sprint"),
    ("11",
     "WORKLOAD nativo (opcional): invitar usuarios reales y reasignar tareas",
     "Si tienes plan Business: asignar usuarios reales + Time Estimate activa vista Workload automatica.",
     "Space > Workload"),
    ("12",
     "Verificar columna 'Recurso' en vista Lista",
     "Click en '+' en headers > Mostrar 'Recurso', 'Sprint', 'Carga Mes %'",
     "Vista Lista del Space"),
    ("13",
     "Leer hoja Metodologia_PMO_Agile_Gerencia para exposicion a Directorio",
     "Documento completo PMO+Agile con mensajes, KPIs y artefactos ClickUp.",
     "Excel > Metodologia_PMO_Agile_Gerencia"),
    ("", "", "", ""),
    ("TABLA DE RECURSOS", "", "", ""),
]

for r_idx, row in enumerate(guide_steps, 2):
    for c, val in enumerate(row, 1):
        cell = ws11.cell(row=r_idx, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        if row[0] in ("PROBLEMA RESUELTO", "PASOS PARA IMPORTAR", "TABLA DE RECURSOS"):
            cell.font = Font(bold=True, size=12, color="1565C0")
        elif row[0] in ("Problema", "Solucion"):
            cell.font = Font(bold=True, size=11, color="D32F2F" if row[0] == "Problema" else "2E7D32")

resource_start = len(guide_steps) + 3
res_sub_headers = ["Codigo", "Nombre en Excel (columna Recurso)", "Rol Completo", "Stream"]
for c, h in enumerate(res_sub_headers, 1):
    cell = ws11.cell(row=resource_start, column=c, value=h)
    cell.font = Font(bold=True, color="FFFFFF")
    cell.fill = PatternFill(start_color="37474F", end_color="37474F", fill_type="solid")
    cell.border = thin_border

for i, (code, display) in enumerate(RESOURCE_DISPLAY.items()):
    r = resource_start + 1 + i
    role = RESOURCES[code].split("—")[0].strip() if "—" in RESOURCES[code] else RESOURCES[code]
    for c, val in enumerate([code, display, role, STREAMS[code]], 1):
        cell = ws11.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True)

for i, w in enumerate([12, 55, 55, 30], 1):
    ws11.column_dimensions[get_column_letter(i)].width = w


# ── SHEET 12: CARGA MENSUAL POR RECURSO (matriz para gerencia y ClickUp) ──
ws12 = wb.create_sheet("Carga_Mensual_Recursos")

load_headers = ["Recurso", "Codigo"] + [MONTH_LABELS[m] for m in range(6, 12)] + ["Promedio 6M %", "Estado"]
for col_idx, h in enumerate(load_headers, 1):
    cell = ws12.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="E65100", end_color="E65100", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

# Fila 2: capacidad maxima por mes (dias netos x 8.5h, feriados Peru)
cap_row = ["CAPACIDAD MAX (h)", "—"] + [MONTH_CAPACITY[m] for m in range(6, 12)] + [round(sum(MONTH_CAPACITY.values()), 1), "100% tope"]
for c, val in enumerate(cap_row, 1):
    cell = ws12.cell(row=2, column=c, value=val)
    cell.font = Font(bold=True)
    cell.border = thin_border

for r, code in enumerate(RESOURCES, 3):
    display = RESOURCE_DISPLAY[code]
    row_pcts = []
    for m in range(6, 12):
        h = MONTHLY_LOAD[code][m]
        row_pcts.append(round(h / MONTH_CAPACITY[m] * 100, 1))
    avg = round(sum(row_pcts) / 6, 1)
    estado = "SOBRECARGA" if max(row_pcts) > 100 else "OPTIMO" if avg >= TARGET_LOAD_PCT else "SUBUTILIZADO"
    row_vals = [display, code] + row_pcts + [avg, estado]
    for c, val in enumerate(row_vals, 1):
        cell = ws12.cell(row=r, column=c, value=val)
        cell.border = thin_border
        if c >= 3 and isinstance(val, (int, float)):
            if val > 100:
                cell.fill = PatternFill(start_color="FFCDD2", end_color="FFCDD2", fill_type="solid")
            elif val >= TARGET_LOAD_PCT:
                cell.fill = PatternFill(start_color="C8E6C9", end_color="C8E6C9", fill_type="solid")
            elif val < 70:
                cell.fill = PatternFill(start_color="FFF9C4", end_color="FFF9C4", fill_type="solid")

for i, w in enumerate([28, 8] + [10] * 6 + [14, 14], 1):
    ws12.column_dimensions[get_column_letter(i)].width = w
ws12.freeze_panes = "C3"


# ── SHEET 13: RESUMEN MENSUAL DETALLADO (horas + % por recurso) ──
ws13_det = wb.create_sheet("Resumen_Mensual_Detallado")

det_headers = ["Recurso", "Codigo"]
for m in range(6, 12):
    det_headers.extend([f"{MONTH_LABELS[m]} (h)", f"{MONTH_LABELS[m]} (%)"])
det_headers.extend(["Total horas", "Promedio 6M %", "Estado"])
for col_idx, h in enumerate(det_headers, 1):
    cell = ws13_det.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="1565C0", end_color="1565C0", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

for r, code in enumerate(RESOURCES, 2):
    display = RESOURCE_DISPLAY[code]
    row_vals = [display, code]
    row_pcts = []
    total_h = 0.0
    for m in range(6, 12):
        h = round(MONTHLY_LOAD[code][m], 1)
        pct = round(h / MONTH_CAPACITY[m] * 100, 1)
        row_pcts.append(pct)
        total_h += h
        row_vals.extend([h, pct])
    avg = round(sum(row_pcts) / 6, 1)
    estado = "SOBRECARGA" if max(row_pcts) > 100 else "OPTIMO" if avg >= TARGET_LOAD_PCT else "SUBUTILIZADO"
    row_vals.extend([round(total_h, 1), avg, estado])
    for c, val in enumerate(row_vals, 1):
        cell = ws13_det.cell(row=r, column=c, value=val)
        cell.border = thin_border
        if c >= 3 and isinstance(val, (int, float)):
            is_pct_col = (c - 3) % 2 == 1
            if is_pct_col:
                if val > 100:
                    cell.fill = PatternFill(start_color="FFCDD2", end_color="FFCDD2", fill_type="solid")
                elif val >= TARGET_LOAD_PCT:
                    cell.fill = PatternFill(start_color="C8E6C9", end_color="C8E6C9", fill_type="solid")
                elif val < 70:
                    cell.fill = PatternFill(start_color="FFF9C4", end_color="FFF9C4", fill_type="solid")

totals_row = ["TOTAL EQUIPO", "—"]
grand_total = 0.0
month_pcts_avg = []
for m in range(6, 12):
    mh = round(sum(MONTHLY_LOAD[c][m] for c in RESOURCES), 1)
    mc = MONTH_CAPACITY[m] * len(RESOURCES)
    mp = round(mh / mc * 100, 1)
    month_pcts_avg.append(mp)
    grand_total += mh
    totals_row.extend([mh, mp])
team_avg = round(sum(month_pcts_avg) / 6, 1)
totals_row.extend([round(grand_total, 1), team_avg, ""])
for c, val in enumerate(totals_row, 1):
    cell = ws13_det.cell(row=len(RESOURCES) + 2, column=c, value=val)
    cell.font = Font(bold=True)
    cell.border = thin_border

for i, w in enumerate([28, 8] + [9, 7] * 6 + [12, 14, 14], 1):
    ws13_det.column_dimensions[get_column_letter(i)].width = w
ws13_det.freeze_panes = "C2"


# ── SHEET 14: FERIADOS NACIONALES PERU 2026 (gob.pe) ──
ws14 = wb.create_sheet("Feriados_Peru_2026")

fer_headers = ["Fecha", "Dia", "Motivo", "Aplica en proyecto", "Fuente"]
for col_idx, h in enumerate(fer_headers, 1):
    cell = ws14.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="B71C1C", end_color="B71C1C", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

ALL_PE_HOLIDAYS_2026 = [
    (date(2026, 6, 7),  "Batalla de Arica y Dia de la Bandera"),
    (date(2026, 6, 29), "San Pedro y San Pablo"),
    (date(2026, 7, 23), "Dia de la Fuerza Aerea del Peru"),
    (date(2026, 7, 28), "Fiestas Patrias"),
    (date(2026, 7, 29), "Fiestas Patrias"),
    (date(2026, 8, 6),  "Batalla de Junin"),
    (date(2026, 8, 30), "Santa Rosa de Lima"),
    (date(2026, 10, 8), "Combate de Angamos"),
    (date(2026, 11, 1), "Todos los Santos"),
    (date(2026, 12, 8), "Inmaculada Concepcion"),
    (date(2026, 12, 9), "Batalla de Ayacucho"),
    (date(2026, 12, 25), "Navidad"),
]
DIAS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]

for r, (fd, motivo) in enumerate(ALL_PE_HOLIDAYS_2026, 2):
    in_project = PROJECT_START_DATE <= fd <= PROJECT_END_DATE
    resta_laboral = fd.weekday() < 5 and fd in PERU_NATIONAL_HOLIDAYS_2026
    aplica = "SI — resta dia laboral" if resta_laboral else (
        "En proyecto (domingo)" if in_project and fd.weekday() >= 5 else (
            "Fuera del proyecto" if not in_project else "En proyecto (domingo)"))
    row = [format_clickup_date(fd), DIAS[fd.weekday()], motivo, aplica, "https://www.gob.pe/feriados"]
    for c, val in enumerate(row, 1):
        cell = ws14.cell(row=r, column=c, value=val)
        cell.border = thin_border
        if resta_laboral:
            cell.fill = PatternFill(start_color="FFCDD2", end_color="FFCDD2", fill_type="solid")

for c, w in enumerate([14, 12, 40, 22, 28], 1):
    ws14.column_dimensions[get_column_letter(c)].width = w


# ── SHEET 13: METODOLOGIA PMO + AGILE PARA GERENCIA ──
ws13 = wb.create_sheet("Metodologia_PMO_Agile_Gerencia")

ger_headers = ["Seccion", "Elemento", "Descripcion para Gerencia", "Frecuencia / Duracion", "Responsable", "Artefacto en ClickUp"]
for col_idx, h in enumerate(ger_headers, 1):
    cell = ws13.cell(row=1, column=col_idx, value=h)
    cell.font = header_font
    cell.fill = PatternFill(start_color="1A237E", end_color="1A237E", fill_type="solid")
    cell.alignment = header_align
    cell.border = thin_border

gerencia_data = [
    ("VISION GENERAL", "Modelo hibrido PMO + Agile (Scrum)",
     "Combinamos gobierno ejecutivo de PMO (cronograma, presupuesto, riesgos, stakeholders) con ejecucion tecnica Agile en sprints quincenales de 2 semanas. PMO asegura control gerencial; Agile asegura entregas incrementales verificables cada 14 dias.",
     "6 meses (Jun-Nov 2026)", "ARQ (Arquitecto TI / PMO)", "Space PLATAFORMA MINERA IA"),
    ("VISION GENERAL", "Por que hibrido y no solo Waterfall",
     "Un plan rigido de 6 meses falla en proyectos de IA y software minero por incertidumbre tecnica. Agile permite ajustar prioridades cada sprint sin perder control: PMO mantiene el marco de 26 semanas, 6 releases y presupuesto; el equipo adapta el backlog dentro de ese marco.",
     "Continuo", "ARQ + Gerencia", "SOW + Releases R1-R6"),
    ("VISION GENERAL", "Equipo y capacidad",
     "9 recursos especializados (Backend, Frontend, IA, QA, Infra, Arquitectura) con meta de ocupacion >=90% promedio en 6 meses. Panel Capacidad_Recursos en ClickUp muestra % mensual por persona.",
     "160h/mes por recurso", "ARQ", "Hoja Carga_Mensual_Recursos"),
    ("", "", "", "", "", ""),
    ("ESTRUCTURA PMO", "Gobierno del proyecto",
     "El Arquitecto TI actua como PMO tecnico: custodia cronograma maestro, presupuesto, riesgos, comunicacion con Gerencia TI y Gerencia Minera, y gates de aprobacion antes de cada release.",
     "Diario / Semanal / Quincenal", "ARQ", "Folder Gestion PMO"),
    ("ESTRUCTURA PMO", "Comite Ejecutivo semanal",
     "Reunion de 1 hora con Gerencia: semaforo de avance, riesgos activos, decisiones pendientes, presupuesto ejecutado, proximo hito. Formato ejecutivo de 1 pagina.",
     "Semanal (lunes 10:00)", "ARQ", "Tarea PMO-004"),
    ("ESTRUCTURA PMO", "Control presupuestal",
     "Seguimiento mensual costos reales vs estimados por recurso e infraestructura. Alerta si desviacion >10%.",
     "Mensual", "ARQ + BE2", "Tarea ARQ-G07"),
    ("ESTRUCTURA PMO", "Gestion de cambios",
     "Todo cambio de alcance pasa por comite de cambios: impacto en cronograma, costo y riesgo antes de aprobar.",
     "Segun necesidad", "ARQ", "Tarea ARQ-G08"),
    ("ESTRUCTURA PMO", "Production Readiness Gate",
     "Antes de cada release R1-R6: checklist obligatorio de calidad, seguridad, rendimiento, documentacion y plan de rollback. Sin gate aprobado no hay release.",
     "Por release (6 gates)", "ARQ", "Tarea ARQ-G06"),
    ("", "", "", "", "", ""),
    ("AGILE SCRUM", "Sprint (iteracion)",
     "Unidad de trabajo de 2 semanas (10 dias habiles). Al final de cada sprint hay entregable demostrable, no solo avance parcial invisible. Total: 13 sprints en 26 semanas.",
     "2 semanas x 13", "Todo el equipo", "Columna Sprint (S1-S13)"),
    ("AGILE SCRUM", "Sprint Planning",
     "Inicio de sprint: seleccionar tareas del backlog, confirmar responsables, estimar horas, definir objetivo del sprint. ARQ facilita.",
     "Quincenal, 2 horas", "ARQ", "Tarea PMO-001"),
    ("AGILE SCRUM", "Daily Standup",
     "Sincronizacion diaria 15 min: ayer / hoy / bloqueos. Detecta impedimentos en 24h maximo.",
     "Diario 9:00 AM", "ARQ facilita", "Tarea PMO-002"),
    ("AGILE SCRUM", "Sprint Review (Demo)",
     "Demostracion funcional ante stakeholders. Se valida criterio de aceptacion. QA certifica calidad de lo mostrado.",
     "Quincenal, 1 hora", "ARQ presenta, QA valida", "Tarea PMO-003"),
    ("AGILE SCRUM", "Sprint Retrospective",
     "Mejora continua: que funciono, que mejorar, acciones concretas para el proximo sprint.",
     "Quincenal, 1 hora", "ARQ facilita", "Tarea PMO-003"),
    ("AGILE SCRUM", "Backlog y priorizacion",
     "287 tareas tecnicas organizadas en listas mensuales (MES1-MES6) + transversales (QA, DevOps, PMO, Riesgos). Prioridad Urgente/Alta/Normal visible en ClickUp.",
     "Continuo", "ARQ + lideres tecnicos", "ClickUp_Import"),
    ("", "", "", "", "", ""),
    ("RELEASES", "R1 Jun — Arquitectura Core",
     "Hito: diseno y arquitectura aprobados. BD modelada, CI/CD base, UX research, riesgos identificados.",
     "30 Jun 2026", "ARQ + BE1", "Release R1"),
    ("RELEASES", "R2 Jul — Motor Operacional",
     "Hito: backend C++ + APIs REST + seguridad JWT/RBAC funcional.",
     "31 Jul 2026", "BE1 + BE2", "Release R2"),
    ("RELEASES", "R3 Ago — UX + GIS + Editor",
     "Hito: frontend React, editor TipTap, mapas GIS, dashboards operacionales.",
     "31 Ago 2026", "FE1 + FE2 + IA", "Release R3"),
    ("RELEASES", "R4 Sep — Integraciones",
     "Hito: sistema integrado end-to-end (export, offline, notificaciones, QA funcional).",
     "30 Sep 2026", "Todo el equipo", "Release R4"),
    ("RELEASES", "R5 Oct — Hardening",
     "Hito: infraestructura productiva VPS Lima, DR, monitoreo, pentesting, IA en staging.",
     "31 Oct 2026", "SYS + BE2 + QA", "Release R5"),
    ("RELEASES", "R6 Nov — GoLive",
     "Hito: stress test 10K sensores, UAT, marcha blanca, capacitacion, produccion LATAM.",
     "30 Nov 2026", "Todo el equipo", "Release R6"),
    ("", "", "", "", "", ""),
    ("RIESGOS", "Identificacion (RSK-001)",
     "Taller inicial con equipo: riesgos tecnologicos, de recursos, integracion legacy, timeline agresivo.",
     "Semanas 1-2", "ARQ", "List Gestion_Riesgos"),
    ("RIESGOS", "Mitigacion (RSK-002)",
     "Plan de mitigacion y contingencia por riesgo: probabilidad, impacto, responsable, indicadores.",
     "Semanas 2-4", "ARQ", "RSK-002"),
    ("RIESGOS", "Comite quincenal (RSK-003)",
     "Revision cada 2 semanas: riesgos nuevos, materializados, efectividad de mitigaciones.",
     "Quincenal", "ARQ + QA", "RSK-003"),
    ("", "", "", "", "", ""),
    ("CALIDAD", "QA transversal continuo",
     "QA no es fase final: regresion quincenal, smoke diario, accesibilidad, rendimiento baseline, UAT en noviembre.",
     "Sprint 1-13", "QA", "Folder Control de calidad"),
    ("CALIDAD", "Definition of Done",
     "Tarea completa cuando: codigo revisado, pruebas pasan, documentacion actualizada, demo en Review, sin bugs criticos abiertos.",
     "Por tarea", "QA + responsable", "Tags QA + CRITICO"),
    ("", "", "", "", "", ""),
    ("CAPACIDAD", "Panel mensual ClickUp",
     f"Lista Capacidad_Recursos: {len(CAPACITY_TASKS)} indicadores (10 recursos x 6 meses). Agrupar por Mes Calendario para ver carga %. Meta >=90%.",
     "Mensual", "ARQ", "List Capacidad_Recursos"),
    ("CAPACIDAD", "Como leer el Gantt",
     "Eje temporal Jun-Nov. Color por folder. Dependencias entre tareas. Sprint visible en columna dedicada. Transversales (PMO/QA) span completo del proyecto.",
     "Continuo", "ARQ", "Vista Gantt + Cronograma_Semanal"),
    ("", "", "", "", "", ""),
    ("MENSAJE GERENCIA", "Frase de apertura recomendada",
     "Este proyecto usa metodologia hibrida PMO+Agile: gobierno ejecutivo riguroso con entregas tecnicas cada 2 semanas, 6 releases mensuales y panel de capacidad visible en ClickUp al 90%+ por recurso.",
     "Presentacion", "ARQ", "Este documento"),
    ("MENSAJE GERENCIA", "Indicadores clave (KPIs)",
     "1) % avance por Release R1-R6. 2) Velocidad del equipo (horas cerradas/sprint). 3) Bugs criticos abiertos. 4) Riesgos rojos activos. 5) Carga mensual por recurso (meta 90%+). 6) Cumplimiento de gates de Production Readiness.",
     "Semanal / Quincenal", "ARQ", "Dashboard PMO-005"),
]

for r, row in enumerate(gerencia_data, 2):
    for c, val in enumerate(row, 1):
        cell = ws13.cell(row=r, column=c, value=val)
        cell.border = thin_border
        cell.alignment = Alignment(wrap_text=True, vertical="top")
        if row[0] in ("VISION GENERAL", "ESTRUCTURA PMO", "AGILE SCRUM", "RELEASES", "RIESGOS", "CALIDAD", "CAPACIDAD", "MENSAJE GERENCIA"):
            cell.font = Font(bold=True, size=11, color="1A237E")

for i, w in enumerate([18, 28, 65, 22, 18, 28], 1):
    ws13.column_dimensions[get_column_letter(i)].width = w


# ══════════════════════════════════════════════════════════════════════════════
# SAVE
# ══════════════════════════════════════════════════════════════════════════════

output_path = r"c:\InformeCliente\Plataforma_Minera_ClickUp_v19.xlsx"
csv_path = r"c:\InformeCliente\Plataforma_Minera_ClickUp_v19_Import.csv"
wb.save(output_path)

with open(csv_path, "w", newline="", encoding="utf-8-sig") as cf:
    writer = csv.writer(cf)
    writer.writerow(CLICKUP_IMPORT_HEADERS)
    writer.writerows(import_rows)

print(f"Excel generado exitosamente: {output_path}")
print(f"CSV importacion: {csv_path}")
print(f"HOJA PARA IMPORTAR: Import_ClickUp (1ra pestana, {len(import_rows)} filas)")
print(f"Referencia mapeo: hoja Mapeo_Columnas_ClickUp")
print(f"Total tareas tecnicas: {len(TASKS)} + {len(CAPACITY_TASKS)} indicadores capacidad = {len(ALL_TASKS)}")
print(f"Hojas: {wb.sheetnames}")

# Conteo por list
list_counts = {}
for t in TASKS:
    key = f"{t[0]} / {t[1]}"
    list_counts[key] = list_counts.get(key, 0) + 1
print("\n--- TAREAS POR LIST ---")
for k, v in list_counts.items():
    print(f"  {k:50s} | {v:3d}")

# Conteo por stream
stream_counts = {}
for t in TASKS:
    s = t[14]
    stream_counts[s] = stream_counts.get(s, 0) + 1
print("\n--- TAREAS POR STREAM ---")
for k, v in sorted(stream_counts.items(), key=lambda x: -x[1]):
    print(f"  {k:20s} | {v:3d}")

print("\n--- CARGA POR RECURSO ---")
for code in RESOURCES:
    hours = round(resource_hours.get(code, 0))
    cap_h = capacity_hours_for_resource(code)
    pct = round((hours / cap_h) * 100, 1) if cap_h else 0.0
    bar = "#" * int(pct / 3)
    status = "SOBRECARGA" if pct > 100 else "ÓPTIMO" if pct >= TARGET_LOAD_PCT else "MODERADO" if pct > 70 else "BAJO"
    print(f"  {code:4s} | {hours:5d}h / {cap_h}h | {pct:5.1f}% | {status:10s} | {bar}")

print(f"\n--- MODELO DE CAPACIDAD (Peru 2026, 8.5h/dia, feriados gob.pe) ---")
print(f"  Capacidad bruta 6 meses: {round(sum(MONTH_CAPACITY.values()), 1)}h | Objetivo asignacion (95%): {MAX_TOTAL_HOURS}h")
for m in range(6, 12):
    wd = month_net_workdays(m)
    print(f"  {MONTH_LABELS[m]}: {wd} dias netos x 8.5h = {MONTH_CAPACITY[m]}h max")

print("\n--- CARGA MENSUAL POR RECURSO (% de capacidad mensual real, max 100%) ---")
for code in RESOURCES:
    pcts = [round(MONTHLY_LOAD[code][m] / MONTH_CAPACITY[m] * 100, 1) for m in range(6, 12)]
    hours = [round(MONTHLY_LOAD[code][m], 1) for m in range(6, 12)]
    mx = max(pcts)
    avg = round(sum(pcts) / 6, 1)
    total = round(sum(hours), 1)
    flag = " ***" if mx > 100 else ""
    print(f"  {code:4s} ({RESOURCE_GROUP.get(code,'?')}) | prom {avg}% | total {total}h{flag}")
    for m in range(6, 12):
        print(f"      {MONTH_LABELS[m]:11s}: {hours[m-6]:6.1f}h / {MONTH_CAPACITY[m]:5.1f}h = {pcts[m-6]:5.1f}%")

print("\n--- PROMEDIOS FINALES POR RECURSO ---")
team_active_avgs = []
for code in RESOURCES:
    pcts = [MONTHLY_LOAD[code][m] / MONTH_CAPACITY[m] * 100 for m in range(6, 12)]
    avg6 = round(sum(pcts) / 6, 1)
    avg_active = active_month_avg_pct(code, MONTHLY_LOAD)
    team_active_avgs.append(avg_active)
    estado = "SOBRECARGA" if max(pcts) > 100 else "OPTIMO" if avg_active >= TARGET_LOAD_PCT else "SUBUTILIZADO"
    months_label = len(active_months_for_resource(code))
    print(
        f"  {RESOURCE_DISPLAY[code]:55s} | activos {avg_active:5.1f}% ({months_label}m) | "
        f"calendario {avg6:5.1f}% | {estado}"
    )
print(f"  {'PROMEDIO EQUIPO (meses activos)':55s} | prom {round(sum(team_active_avgs)/len(team_active_avgs), 1):5.1f}%")

print("\n--- VALIDACION INTEGRAL DEL CRONOGRAMA ---")
if INTEGRITY_REPORT["ok"]:
    print("  ESTADO: LISTO PARA IMPORTAR ClickUp")
else:
    print("  ESTADO: ERRORES DETECTADOS")
for err in INTEGRITY_REPORT["errors"]:
    print(f"  ERROR: {err}")
for warn in INTEGRITY_REPORT["warnings"]:
    print(f"  AVISO: {warn}")
st = INTEGRITY_REPORT["stats"]
print(f"  Tareas: {st['tasks']} | Fechas OK: {st['dated']} | Promedio equipo: {st['team_avg_pct']}%")
print(f"  Fechas fuera ventana lista: {st['date_window_errors']} | Dep secuencia: {st['dep_violations']} | Carga >100%: {st['load_violations']}")

print("\n--- VALIDACION CARGA MENSUAL (tope 100%) ---")
if LOAD_VIOLATIONS:
    print(f"  ERROR: {len(LOAD_VIOLATIONS)} violaciones:")
    for code, mo, pct, hrs in LOAD_VIOLATIONS:
        print(f"    {RESOURCE_DISPLAY.get(code,code)} / {mo}: {pct}% ({hrs}h)")
else:
    print("  OK: ningun recurso supera 100% en ningun mes calendario")

print("\n--- BACKEND: tareas por recurso ---")
for code in ("BE1", "BE2", "BE3"):
    n = sum(1 for t in TASKS if code in parse_assignees(t[5]))
    h = round(resource_hours.get(code, 0))
    print(f"  {RESOURCE_DISPLAY[code]}: {n} tareas, {h}h total")

print(f"\n--- VALIDACION DE FECHAS (detalle) ---")
empty = out_of_month = 0
for t in TASKS:
    tid, list_name = t[2], t[1]
    start, due = TASK_DATES[tid]
    if not start or not due:
        empty += 1
    if start > due:
        print(f"  ERROR: {tid} start > due ({start} > {due})")
    if list_name not in TRANSVERSAL_LISTS:
        bounds = effective_list_bounds(t, TASK_ALLOCS.get(tid), TASK_DATES)
        if bounds:
            m_start, m_end = bounds
            if start < m_start or due > m_end:
                out_of_month += 1
print(f"  Tareas con fechas: {len(TASK_DATES)}/{len(ALL_TASKS)}")
print(f"  Formato: YYYY-MM-DD (ISO, sin ambiguedad)")
print(f"  Fuera de ventana mensual (excl. transversales): {out_of_month}")
print(f"  Proyecto: {format_clickup_date(PROJECT_START_DATE)} a {format_clickup_date(PROJECT_END_DATE)}")

print(f"\n--- CORRESPONDENCIAS FRONTEND<->BACKEND: {len(correspondences)} verificadas ---")

print("\n--- COLUMNA 'RECURSO' EN EXCEL (Custom Text Field en ClickUp) ---")
for code, display in RESOURCE_DISPLAY.items():
    print(f"  {code:4s} -> {display}")
print("  NOTA: 3 recursos Backend visibles como BACKEND 1, BACKEND 2, BACKEND 3.")
print("        Modelo: 8.5h/dia x dias netos (feriados Peru excluidos). Tope 100% mensual.")

# Verificar tags consolidados
all_tags = set()
for t in TASKS:
    for tag in consolidate_tags(t[6]).split(","):
        all_tags.add(tag.strip())
print(f"\n--- TAGS CONSOLIDADOS: {len(all_tags)} tags unicos ---")
for tag in sorted(all_tags):
    desc = TAGS_MAP.get(tag, "** SIN DESCRIPCION **")[:80]
    print(f"  {tag:25s} | {desc}")

if not INTEGRITY_REPORT["ok"]:
    print("\n--- DETALLE ERRORES (primeros 15) ---")
    for t in TASKS:
        tid = t[2]
        start, due = TASK_DATES[tid]
        ln = resolve_list_name(t[1])
        if ln not in TRANSVERSAL_LISTS and ln in LIST_SCHEDULE_BOUNDS:
            lb_start, lb_end = effective_list_bounds(t, TASK_ALLOCS.get(tid), TASK_DATES)
            if start < lb_start or due > lb_end:
                print(f"  VENTANA: {tid} [{start}..{due}] fuera [{lb_start}..{lb_end}]")
        dep_str = (t[11] or "").strip()
        if dep_str:
            for did in dep_str.split(","):
                did = did.strip()
                if did in TASK_DATES:
                    _, dep_due = TASK_DATES[did]
                    ms = add_workdays(dep_due, 1)
                    if start < ms:
                        print(f"  DEP: {tid} start={start} < {ms} (post {did} due {dep_due})")
    sys.exit(1)
