# -*- coding: utf-8 -*-
"""
Actualiza el contenido interno del plan gerencial v36 alineandolo al SOW maestro
(SOW_Maestro_AURIXA_2026_Revision_Gerencia_v3 / SOW-AURIXA-2026-001 v2.0).

Anade/actualiza:
  - 12_KPIs_SLA_SOW         : objetivos medibles O1-O7 + SLA del SOW, con sprint de validacion.
  - 13_Trazabilidad_SOW     : cada entregable del SOW mapeado a Sprint / Release / Gate PM.
  - 01_Resumen_Ejecutivo    : referencia formal al SOW vigente.
  - 11_Importar_ClickUp     : ruta actualizada del Excel ClickUp tras la reorganizacion.

Reejecutable (idempotente: recrea las hojas 12 y 13 si ya existen).
Uso:  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\actualizar_plan_v36.py
"""
import os
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

XLSX = os.path.join("docs", "01_Planificacion",
                    "Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx")

HEAD_FILL = PatternFill("solid", fgColor="1565C0")
HEAD_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=13, color="0D47A1")
WRAP = Alignment(wrap_text=True, vertical="top")
THIN = Side(style="thin", color="BBBBBB")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# ----- O1..O7 objetivos medibles del SOW + SLA -----
KPIS = [
    ("Codigo", "Objetivo (SOW)", "Metrica", "Meta / Target", "Sprint de validacion", "Responsable"),
    ("O1", "Rapidez de visualizacion y respuesta", "Retraso visual de pantalla", "< 20 ms (local)", "S9, S11", "BE1, FE1"),
    ("O2", "Auto-guardado seguro de informacion", "Tiempo de auto-guardado", "< 0.5 s por operacion", "S4", "BE2, BE1"),
    ("O3", "Generacion de reportes tecnicos", "Tiempo de exportacion PDF/Word", "< 5 s", "S7", "FE1, BE1"),
    ("O4", "Capacidad de monitoreo", "Sensores simultaneos", "10,000 a la vez", "S6 (sim), S12 (estres)", "BE1, QA, SYS"),
    ("O5", "Estabilidad operacional", "Disponibilidad anual", "> 99.9% uptime", "S10 (DR), S13", "SYS, ARQ"),
    ("O6", "Operacion asistida por IA local", "Rapidez de correccion IA", "< 1 s por parrafo", "S6, S11", "IA, BE2"),
    ("O7", "Trazabilidad y control", "Registro auditable de cambios", "100% acciones auditadas", "S4, S8", "BE2, QA"),
]
SLA = [
    ("Categoria SLA (SOW)", "Meta esperada", "Consecuencia de incumplimiento"),
    ("Rapidez del sistema", "Respuesta < 20 ms", "Optimizacion obligatoria en 48h"),
    ("Uptime (activo)", "99.9% del tiempo", "Creditos de servicio a favor del cliente"),
    ("Perdida de datos", "0% (Zero Data Loss)", "Auditoria inmediata de seguridad"),
    ("IA de redaccion", "< 1 s por respuesta", "Ajuste de potencia de servidores"),
]

# ----- Trazabilidad: entregable SOW -> Sprint / Release / Gate -----
TRZ = [
    ("Etapa", "Entregable / Alcance SOW", "Dominio", "Sprint(s)", "Release", "Gate PM / Criterio aceptacion"),
    ("Etapa 1", "SOW maestro y paquete de arranque del proyecto", "Gobernanza", "S1", "R1", "Gate PM-0: aprobacion de inicio"),
    ("Etapa 1", "Arquitectura objetivo, conectividad y niveles de servicio", "Arquitectura", "S2", "R1", "Gate R1: diseno y arquitectura aprobados"),
    ("Etapa 1", "Infraestructura base en Lima (entorno operativo)", "Infraestructura", "S2-S4", "R1-R2", "Gate R2: VPS desarrollo operativo"),
    ("Etapa 1", "Motor central: servicios, seguridad, trazabilidad, versionado", "Backend core", "S3-S4", "R2", "Gate R2: motor operacional + RBAC"),
    ("Etapa 1", "Editor maestro de informes (tablas, estilos, plantillas, export)", "Frontend/Editor", "S5", "R3", "Editor ReportStudio funcional en demo"),
    ("Etapa 1", "Visualizacion GIS: sensores, capas y zonas operativas", "GIS", "S5-S6", "R3", "Gate R3: editor + GIS + dashboards"),
    ("Etapa 1", "Integracion con fuentes historicas y operativas autorizadas", "Integracion", "S3-S7", "R2-R4", "ETL POC S3, integracion e2e S7"),
    ("Etapa 1", "Modo de trabajo offline con mecanismo de reconciliacion", "Offline", "S8", "R4", "Demo offline + sync sin perdida"),
    ("Etapa 1", "Pruebas funcionales del nucleo documentadas", "QA", "S7-S8", "R4", "Gate R4 / FIN ETAPA 1: e2e + acta QA"),
    ("Etapa 2", "Hardening completo de plataforma e infraestructura", "Seguridad/Infra", "S9", "R5", "Pentest OWASP + cierre P0/P1"),
    ("Etapa 2", "Canales seguros, cifrado y segmentacion", "Seguridad", "S9-S10", "R5", "WireGuard/Nginx + cifrado validado"),
    ("Etapa 2", "IA avanzada, biometria y deteccion de condiciones (EPP)", "IA", "S6, S11", "R3, R5", "Modelos afinados pre-UAT"),
    ("Etapa 2", "Monitoreo intensivo de fuentes de datos (10k sensores)", "Performance", "S6, S12", "R3, R6", "Prueba de estres 10k cumple SLA"),
    ("Etapa 2", "Plan de recuperacion ante desastres y respaldo geografico", "Continuidad/DR", "S10", "R5", "Simulacro DR < 15 min restauracion"),
    ("Etapa 2", "Evidencia de pruebas de estres, seguridad y resiliencia", "QA", "S9-S12", "R5-R6", "Load test incremental + informe"),
    ("Etapa 2", "UAT, marcha blanca y salida controlada a produccion", "Go-Live", "S12-S13", "R6", "UAT aprobado + marcha blanca"),
    ("Etapa 2", "Capacitacion, transferencia de control y cierre formal", "Cierre", "S13", "R6", "Gate R6 / FIN: Go-Live + handover"),
]


def style_header(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEAD_FILL
        cell.font = HEAD_FONT
        cell.alignment = WRAP
        cell.border = BORDER


def fill_block(ws, start_row, data, widths=None):
    r = start_row
    for i, row in enumerate(data):
        for j, val in enumerate(row, start=1):
            cell = ws.cell(row=r, column=j, value=val)
            cell.alignment = WRAP
            cell.border = BORDER
        if i == 0:
            style_header(ws, r, len(row))
        r += 1
    if widths:
        from openpyxl.utils import get_column_letter
        for idx, w in enumerate(widths, start=1):
            ws.column_dimensions[get_column_letter(idx)].width = w
    return r


def main():
    wb = openpyxl.load_workbook(XLSX)

    # --- recrear hoja 12 ---
    for name in ("12_KPIs_SLA_SOW", "13_Trazabilidad_SOW"):
        if name in wb.sheetnames:
            wb.remove(wb[name])

    ws12 = wb.create_sheet("12_KPIs_SLA_SOW")
    ws12["A1"] = "KPIs Y SLA DEL SOW - OBJETIVOS MEDIBLES O1..O7"
    ws12["A1"].font = TITLE_FONT
    nxt = fill_block(ws12, 3, KPIS, widths=[10, 42, 30, 22, 24, 18])
    ws12.cell(row=nxt + 1, column=1, value="ACUERDOS DE NIVEL DE SERVICIO (SLA)").font = TITLE_FONT
    fill_block(ws12, nxt + 3, SLA)

    ws13 = wb.create_sheet("13_Trazabilidad_SOW")
    ws13["A1"] = "TRAZABILIDAD DE ALCANCE SOW -> SPRINT -> RELEASE -> GATE PM"
    ws13["A1"].font = TITLE_FONT
    ws13["A2"] = "Garantiza cobertura 100% de los entregables del SOW en la metodologia hibrida (Clasica + Scrum)."
    fill_block(ws13, 4, TRZ, widths=[10, 48, 18, 16, 12, 40])

    # --- referencia SOW en resumen ejecutivo ---
    ws01 = wb["01_Resumen_Ejecutivo"]
    last = ws01.max_row + 1
    ws01.cell(row=last, column=1, value="SOW de referencia")
    ws01.cell(row=last, column=2,
              value="SOW-AURIXA-2026-001 v2.0 / SOW Maestro Revision Gerencia v3 "
                    "(docs/00_SOW). Trazabilidad en hoja 13_Trazabilidad_SOW.")
    last += 1
    ws01.cell(row=last, column=1, value="Cobertura de alcance")
    ws01.cell(row=last, column=2,
              value="100% de entregables E1/E2 del SOW mapeados a sprint/release/gate.")

    # --- actualizar ruta ClickUp en hoja 11 ---
    ws11 = wb["11_Importar_ClickUp"]
    for row in ws11.iter_rows():
        for cell in row:
            if cell.value and isinstance(cell.value, str) and \
               cell.value.strip() == "Plataforma_Minera_ClickUp_v19.xlsx":
                cell.value = "docs/08_Tareas_ClickUp/Plataforma_Minera_ClickUp_v19.xlsx"

    wb.save(XLSX)
    print("OK: actualizado", XLSX)
    print("Hojas:", wb.sheetnames)


if __name__ == "__main__":
    main()
