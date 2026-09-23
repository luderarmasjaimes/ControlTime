# -*- coding: utf-8 -*-
"""Genera la presentación gerencial mensual (avance %, mensaje, riesgo,
sprint por mes) a partir de los datos ya consolidados en
docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_<corte>.md y
specs/BACKLOG.md. Los datos están hardcodeados aquí a propósito (igual que
el resto de los generadores `generate_*` de este directorio): este script
no parsea markdown, se actualiza a mano en cada corte para mantener control
editorial sobre el mensaje de cada slide.

Uso: python scripts/generate_presentacion_gerencial_mensual.py
"""
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

CORTE = "2026-09-13"
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs_" / "01_Planificacion" / f"Cronograma_Actualizado_Presentacion_Gerencia_TI_{CORTE}.pptx"

NAVY = RGBColor(0x0F, 0x2A, 0x4A)
TEAL = RGBColor(0x0F, 0x76, 0x6E)
GOLD = RGBColor(0xC9, 0x9A, 0x2E)
INK = RGBColor(0x1C, 0x25, 0x2C)
SLATE = RGBColor(0x47, 0x55, 0x69)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
PAPER = RGBColor(0xF5, 0xF3, 0xEE)
GREEN = RGBColor(0x1E, 0x7A, 0x4C)
AMBER = RGBColor(0xB8, 0x86, 0x0B)
RED = RGBColor(0xB3, 0x36, 0x2E)
GREY = RGBColor(0xC9, 0xC9, 0xC9)

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)


def band_color(pct: float) -> RGBColor:
    if pct >= 90:
        return GREEN
    if pct >= 50:
        return AMBER
    return RED


def new_presentation() -> Presentation:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs


def blank_slide(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def fill_bg(slide, color):
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = color


def add_text(slide, left, top, width, height, text, size=18, color=INK,
             bold=False, italic=False, align=PP_ALIGN.LEFT, font="Calibri",
             anchor=None, line_spacing=None):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    if anchor is not None:
        tf.vertical_anchor = anchor
    lines = text.split("\n")
    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if line_spacing:
            p.line_spacing = line_spacing
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.bold = bold
        r.font.italic = italic
        r.font.name = font
        r.font.color.rgb = color
    return box


def add_rect(slide, left, top, width, height, color, line_color=None):
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    if line_color is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line_color
        shp.line.width = Pt(0.75)
    shp.shadow.inherit = False
    return shp


def header(slide, kicker, title):
    add_rect(slide, 0, 0, SLIDE_W, Inches(1.15), NAVY)
    add_text(slide, Inches(0.55), Inches(0.12), Inches(11), Inches(0.35),
              kicker.upper(), size=12, color=GOLD, bold=True)
    add_text(slide, Inches(0.55), Inches(0.42), Inches(12.2), Inches(0.65),
              title, size=26, color=WHITE, bold=True)
    add_rect(slide, 0, Inches(1.15), SLIDE_W, Pt(3), GOLD)


def footer(slide, note):
    add_text(slide, Inches(0.55), Inches(7.12), Inches(9.5), Inches(0.3),
              note, size=9, color=SLATE, italic=True)
    add_text(slide, Inches(11.9), Inches(7.12), Inches(1.0), Inches(0.3),
              "Beemetry", size=9, color=SLATE, align=PP_ALIGN.RIGHT)


def progress_bar(slide, left, top, width, height, pct, label=None):
    add_rect(slide, left, top, width, height, GREY)
    fill_w = Emu(int(width * max(0.0, min(1.0, pct / 100.0))))
    if fill_w > 0:
        add_rect(slide, left, top, fill_w, height, band_color(pct))
    if label:
        add_text(slide, left, top - Inches(0.42), width, Inches(0.4), label,
                  size=13, color=SLATE, bold=True)


# ---------------------------------------------------------------------------
# Slide 1 — Portada
# ---------------------------------------------------------------------------

def slide_title(prs):
    s = blank_slide(prs)
    fill_bg(s, NAVY)
    add_rect(s, 0, Inches(5.35), SLIDE_W, Pt(3), GOLD)
    add_text(s, Inches(0.9), Inches(0.9), Inches(6), Inches(0.4),
              "PLATAFORMA MINERA BEEMETRY", size=14, color=GOLD, bold=True)
    add_text(s, Inches(0.9), Inches(1.4), Inches(11.2), Inches(2.2),
              "Estado del proyecto\ny cronograma actualizado", size=44,
              color=WHITE, bold=True, line_spacing=1.05)
    add_text(s, Inches(0.9), Inches(3.75), Inches(10), Inches(0.5),
              "Avance por sprint, mensajes clave y riesgos — mes a mes",
              size=18, color=PAPER, italic=True)
    add_text(s, Inches(0.9), Inches(5.55), Inches(8), Inches(0.4),
              "Corte: 13 de septiembre de 2026", size=15, color=WHITE, bold=True)
    add_text(s, Inches(0.9), Inches(5.95), Inches(10), Inches(0.4),
              "Presentado a Gerencia TI y Gerencia General · TimeTelemetry",
              size=13, color=PAPER)
    add_text(s, Inches(0.9), Inches(6.5), Inches(10), Inches(0.4),
              "Base: ADR-000–185 · SPEC-001–025 · Cronograma v36.1", size=11,
              color=GREY)


# ---------------------------------------------------------------------------
# Slide 2 — Resumen ejecutivo
# ---------------------------------------------------------------------------

def slide_resumen(prs):
    s = blank_slide(prs)
    fill_bg(s, WHITE)
    header(s, "Resumen ejecutivo", "El período de mayor avance real del proyecto")

    kpis = [
        ("71,4%", "Avance total\n(142/199 tareas)", "antes 54,1%"),
        ("100%", "R2 · Julio\ncierra por 1ª vez", "antes 90,9%"),
        ("97,1%", "R3 · Agosto\nen la práctica cerrado", "antes 75,8%"),
        ("80,6%", "R4 · Septiembre\nen camino (vence 30-sep)", "antes 58,1%"),
    ]
    card_w = Inches(2.85)
    gap = Inches(0.25)
    left0 = Inches(0.55)
    top = Inches(1.55)
    for i, (big, label, delta) in enumerate(kpis):
        left = left0 + i * (card_w + gap)
        add_rect(s, left, top, card_w, Inches(1.9), PAPER)
        add_text(s, left, top + Inches(0.12), card_w, Inches(0.75), big,
                  size=40, color=TEAL, bold=True, align=PP_ALIGN.CENTER)
        add_text(s, left + Inches(0.1), top + Inches(0.95), card_w - Inches(0.2),
                  Inches(0.6), label, size=12, color=INK, align=PP_ALIGN.CENTER,
                  bold=True)
        add_text(s, left + Inches(0.1), top + Inches(1.55), card_w - Inches(0.2),
                  Inches(0.3), delta, size=10, color=SLATE, align=PP_ALIGN.CENTER,
                  italic=True)

    msgs = [
        "49 ADR nuevos (137-185) en 14 días, la mayoría implementados y "
        "verificados en vivo — no solo redactados.",
        "A diferencia del corte del 30-ago, el trabajo de formalización SÍ se "
        "ejecutó: checkboxes reales respaldados por builds, deploys y pruebas "
        "en vivo contra el stack completo.",
        "2 decisiones de gestión pendientes ya se resolvieron: sin auditoría "
        "retroactiva por ADR-134, y alcance de Soporte/WhatsApp aprobado.",
        "Lo que sigue sin resolverse — y es lo más caro de resolver tarde: "
        "pentest, simulacro DR y UAT siguen sin proveedor, a 8 días de S9.",
    ]
    top2 = Inches(3.75)
    add_text(s, Inches(0.55), top2, Inches(11), Inches(0.35),
              "MENSAJES CLAVE", size=13, color=NAVY, bold=True)
    for i, m in enumerate(msgs):
        y = top2 + Inches(0.45) + i * Inches(0.72)
        add_rect(s, Inches(0.55), y + Inches(0.05), Inches(0.12), Inches(0.12), GOLD)
        add_text(s, Inches(0.85), y - Inches(0.05), Inches(11.9), Inches(0.7), m,
                  size=13.5, color=INK)
    footer(s, "Fuente: scripts/project-status-metrics.ps1, corrido 2026-09-13 · specs/BACKLOG.md")


# ---------------------------------------------------------------------------
# Month slides
# ---------------------------------------------------------------------------

MONTHS = [
    dict(mes="Junio", sprints="S1-S2", gate="R1", pct=100, prev=None,
         mensaje="Cerrado desde el 30-jun. Arquitectura, SDD, modelo de "
                 "datos y plan aprobados. Sin cambios este corte.",
         riesgo="Ninguno abierto."),
    dict(mes="Julio", sprints="S3-S4", gate="R2", pct=100, prev=90.9,
         mensaje="Cierra por primera vez. SPEC-001 (ingesta) y SPEC-006 "
                 "(Auth/RBAC) llegan a 100% — RBAC completó su último "
                 "pendiente operativo.",
         riesgo="Ninguno abierto; falta solo el acta formal de cierre "
                "retroactivo del gate."),
    dict(mes="Agosto", sprints="S5-S6", gate="R3", pct=97.1, prev=75.8,
         mensaje="El mayor salto del proyecto (+21,3pp). Export/editor "
                 "(SPEC-007) y push realtime (SPEC-005) cierran 100% con "
                 "bugs reales corregidos y pruebas reales contra el stack "
                 "completo. Biometría y zonas/gráficos también cierran 100%.",
         riesgo="Gate venció el 31-ago sin acta formal — falta que Gerencia "
                "emita el acta con la desviación de O3 documentada "
                "(ADR-185)."),
    dict(mes="Septiembre", sprints="S7-S8", gate="R4", pct=80.6, prev=58.1,
         mensaje="En marcha, 17 días para el gate que cierra toda la Etapa "
                 "1. Mayor brecha: Offline (44,4%, sin test automatizado), "
                 "Alertas (0%→40%, sigue lejos), CCTV (75%, cámaras reales "
                 "pendientes).",
         riesgo="Offline + Alertas + CCTV concentran las 12 tareas que "
                "faltan para el 100% — sin equipo dedicado, el gate corre "
                "riesgo real de no cerrar a tiempo."),
    dict(mes="Octubre", sprints="S9-S11", gate="R5", pct=45.2, prev=37.7,
         mensaje="Arranca en 8 días y depende de terceros no contratados: "
                 "pentest (demo S9) y simulacro DR (demo S10) sin proveedor "
                 "ni fecha. DR/continuidad sigue en 0/11 desde junio.",
         riesgo="P0: sin pentest ni simulacro DR agendados, S9/S10 no "
                "pueden cumplir su demo de cierre contractual aunque el "
                "código esté listo."),
    dict(mes="Noviembre", sprints="S12-S13", gate="R6", pct=40, prev=40,
         mensaje="Preparación técnica temprana (build/CTest/tests en "
                 "verde), pero no habilita producción: 6 de 10 controles "
                 "dependen de terceros o decisiones de negocio.",
         riesgo="Sin acción en octubre sobre pentest/DR/UAT, noviembre "
                "hereda el bloqueo y el Go-Live (30-nov) no es alcanzable "
                "en fecha contractual."),
    dict(mes="Rebaseline · Operaciones de Campo", sprints="fuera de S1-S13",
         gate="Extensión", pct=None, prev=None,
         mensaje="Gerencia decidió (2026-09-12, ADR-178) que Operaciones de "
                 "Campo no es alcance de esta plataforma en ningún grado — "
                 "se retira del seguimiento y de los reportes gerenciales.",
         riesgo="Ninguno para este proyecto — pasa a ser una eventual "
                "iniciativa futura independiente, sin product owner ni "
                "presupuesto."),
]


def slide_month(prs, data, idx, total):
    s = blank_slide(prs)
    fill_bg(s, WHITE)
    header(s, f"Avance mes a mes  ·  {idx}/{total}", data["mes"])

    add_text(s, Inches(0.55), Inches(1.4), Inches(4), Inches(0.4),
              f"SPRINT(S): {data['sprints']}", size=13, color=TEAL, bold=True)
    add_text(s, Inches(4.6), Inches(1.4), Inches(3), Inches(0.4),
              f"GATE: {data['gate']}", size=13, color=TEAL, bold=True)

    if data["pct"] is not None:
        pct = data["pct"]
        add_text(s, Inches(9.6), Inches(1.15), Inches(3.2), Inches(0.9),
                  f"{pct:g}%", size=48, color=band_color(pct), bold=True,
                  align=PP_ALIGN.RIGHT)
        if data["prev"] is not None and data["prev"] != pct:
            add_text(s, Inches(9.6), Inches(1.95), Inches(3.2), Inches(0.35),
                      f"antes {data['prev']:g}%", size=12, color=SLATE,
                      italic=True, align=PP_ALIGN.RIGHT)
        progress_bar(s, Inches(0.55), Inches(2.55), Inches(12.2), Inches(0.38), pct)
    else:
        add_text(s, Inches(9.6), Inches(1.3), Inches(3.2), Inches(0.7),
                  "FUERA DE\nALCANCE", size=22, color=SLATE, bold=True,
                  align=PP_ALIGN.RIGHT)

    y_msg = Inches(3.25)
    add_text(s, Inches(0.55), y_msg, Inches(11.5), Inches(0.35),
              "MENSAJE CLAVE", size=13, color=NAVY, bold=True)
    add_rect(s, Inches(0.55), y_msg + Inches(0.42), Inches(12.25), Inches(1.55), PAPER)
    add_text(s, Inches(0.8), y_msg + Inches(0.55), Inches(11.75), Inches(1.3),
              data["mensaje"], size=15, color=INK, line_spacing=1.15)

    y_risk = Inches(5.55)
    add_text(s, Inches(0.55), y_risk, Inches(11.5), Inches(0.35),
              "RIESGO PRINCIPAL", size=13, color=NAVY, bold=True)
    band = RED if "P0" in data["riesgo"] else GOLD
    add_rect(s, Inches(0.55), y_risk + Inches(0.42), Inches(0.1), Inches(1.15), band)
    add_text(s, Inches(0.8), y_risk + Inches(0.42), Inches(12.0), Inches(1.15),
              data["riesgo"], size=14, color=INK, line_spacing=1.15)

    footer(s, "Sprint/gate: docs_/01_Planificacion/Cronograma_Maestro_AURIXA_v36.md · % vs. 30-ago: informe anterior")


# ---------------------------------------------------------------------------
# Risk slides
# ---------------------------------------------------------------------------

def bullet_block(slide, left, top, width, items, size=13.5, gap=Inches(0.62)):
    for i, (tag, text, color) in enumerate(items):
        y = top + i * gap
        add_rect(slide, left, y + Inches(0.03), Inches(0.85), Inches(0.32), color)
        tf = slide.shapes.add_textbox(left, y, Inches(0.85), Inches(0.32)).text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = tag
        r.font.size = Pt(11)
        r.font.bold = True
        r.font.color.rgb = WHITE
        add_text(slide, left + Inches(1.0), y - Inches(0.03), width - Inches(1.0),
                  gap, text, size=size, color=INK)


def slide_riesgos_p0(prs):
    s = blank_slide(prs)
    fill_bg(s, WHITE)
    header(s, "Riesgos gerenciales", "Prioridad P0 — acción inmediata")
    items = [
        ("P0", "Pentest externo, simulacro DR y UAT sin proveedor ni fecha, "
               "a 8 días de S9 (21-sep) — S9/S10 no pueden cumplir su demo "
               "de cierre contractual.", RED),
        ("P0", "DR/continuidad (SPEC-015) en 0/11, sin movimiento desde "
               "junio — R5 arranca en 8 días sin código ni ejercicio.", RED),
        ("resuelto", "Escalada de privilegios (ADR-134): Gerencia confirmó "
               "el 2026-09-11 que no requiere auditoría/notificación "
               "retroactiva.", GREEN),
        ("mitigado", "R3 vencía el 31-ago al 75,8% — hoy 97,1%, único punto "
               "restante cerrado por decisión de negocio (ADR-185); falta "
               "el acta formal.", GREEN),
    ]
    bullet_block(s, Inches(0.55), Inches(1.7), Inches(12.2), items, gap=Inches(1.15))
    footer(s, "Detalle completo: docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_2026-09-13.md §8")


def slide_riesgos_p1(prs):
    s = blank_slide(prs)
    fill_bg(s, WHITE)
    header(s, "Riesgos gerenciales", "Prioridad P1 — seguimiento activo")
    items = [
        ("P1", "195 archivos sin commitear (peor que 187 el 30-ago); "
               "CHANGELOG sin actualizar desde el 11-sep pese a 18 ADR "
               "nuevos.", AMBER),
        ("P1", "Deploy de fases 6-8/13 de ADR-131 y evaluación de VPS/GPU "
               "(ADR-170) sin ventana ni proveedor asignado.", AMBER),
        ("P1", "AWS real depende de acceso del cliente — puede bloquear "
               "R4.", AMBER),
        ("P1", "Biometría sin calibración estadística formal (FMR/FNMR, "
               "PAD) pese a checkboxes 100%.", AMBER),
        ("P1", "Criterio O3 de la SOW (<5s) queda formalmente sin cumplir, "
               "aceptado por decisión de negocio — pendiente countersign "
               "de Gerencia General sobre ADR-185.", AMBER),
        ("cambia", "Soporte/WhatsApp: alcance ya aprobado (ADR-168) — el "
               "riesgo ahora es de procurement (WABA Meta, Twilio SMS), no "
               "de decisión.", TEAL),
    ]
    bullet_block(s, Inches(0.55), Inches(1.55), Inches(12.2), items, gap=Inches(0.85))
    footer(s, "Detalle completo: docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_2026-09-13.md §8")


def slide_decisiones(prs):
    s = blank_slide(prs)
    fill_bg(s, NAVY)
    add_text(s, Inches(0.6), Inches(0.5), Inches(11), Inches(0.4),
              "DECISIONES SOLICITADAS", size=14, color=GOLD, bold=True)
    add_text(s, Inches(0.6), Inches(0.85), Inches(11.5), Inches(0.6),
              "A Gerencia TI y Gerencia General", size=24, color=WHITE, bold=True)
    decs = [
        "Firmar el acta de cierre de R3 (vencido 31-ago, hoy 97,1%), "
        "incluyendo la desviación documentada de O3 (ADR-185).",
        "Contratar proveedor de pentest externo y de simulacro DR ahora — "
        "S9/S10 arrancan en 8 días.",
        "Autorizar la ventana de despliegue de ADR-131 (fases 6-8/13) y "
        "decidir proveedor de VPS/GPU (ADR-170).",
        "Gestionar cuentas comerciales pendientes de Soporte/WhatsApp "
        "(WABA Meta, Twilio SMS) — alcance ya aprobado.",
        "Priorizar equipo dedicado para Offline y Alertas, mayores brechas "
        "de R4 (gate 30-sep).",
        "Confirmar por escrito la decisión sobre ADR-134 (sin auditoría "
        "retroactiva).",
        "Autorizar dataset representativo y DPIA para calibración "
        "biométrica formal.",
        "Sostener soporte y recursos de IA acordes con la complejidad del "
        "proyecto.",
    ]
    top = Inches(1.75)
    for i, d in enumerate(decs):
        y = top + i * Inches(0.62)
        add_text(s, Inches(0.6), y, Inches(0.5), Inches(0.5), f"{i+1}",
                  size=20, color=GOLD, bold=True)
        add_text(s, Inches(1.15), y + Inches(0.02), Inches(11.6), Inches(0.55),
                  d, size=13.5, color=WHITE)
    footer_txt = "Próximo corte: viernes 18-sep-2026, cierre del gate R4 (S8, fin de Etapa 1)"
    add_text(s, Inches(0.6), Inches(7.05), Inches(11.5), Inches(0.35),
              footer_txt, size=11, color=PAPER, italic=True)


def slide_fuentes(prs):
    s = blank_slide(prs)
    fill_bg(s, WHITE)
    header(s, "Referencia", "Fuentes de verdad")
    fuentes = [
        "ADR: docs/decisions/README.md y ADR-000-185.",
        "Matriz: specs/REGISTRY.md.",
        "Backlog y métrica: specs/BACKLOG.md y scripts/project-status-metrics.ps1.",
        "Cronograma contractual: docs_/01_Planificacion/Cronograma_Maestro_AURIXA_v36.md.",
        "Informe detallado: docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_2026-09-13.md.",
        "Informe anterior (comparativa): docs_/01_Planificacion/Informe_Estado_Proyecto_Actualizado_2026-08-30.md.",
    ]
    top = Inches(1.7)
    for i, f in enumerate(fuentes):
        y = top + i * Inches(0.55)
        add_rect(s, Inches(0.55), y + Inches(0.08), Inches(0.12), Inches(0.12), GOLD)
        add_text(s, Inches(0.85), y - Inches(0.02), Inches(11.6), Inches(0.5), f,
                  size=14, color=INK)
    footer(s, "Corte 2026-09-13 · Beemetry / TimeTelemetry")


def main() -> None:
    prs = new_presentation()
    slide_title(prs)
    slide_resumen(prs)
    for i, data in enumerate(MONTHS, start=1):
        slide_month(prs, data, i, len(MONTHS))
    slide_riesgos_p0(prs)
    slide_riesgos_p1(prs)
    slide_decisiones(prs)
    slide_fuentes(prs)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print(f"OK: {OUT} ({len(prs.slides)} slides)")


if __name__ == "__main__":
    main()
