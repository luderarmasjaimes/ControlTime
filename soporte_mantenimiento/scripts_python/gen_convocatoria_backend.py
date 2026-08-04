"""
Genera Convocatoria_Laboral_01_Backend_LinkedIn.docx
Perfil: Desarrollador Backend & Datos Semi-Senior — Plataforma Industrial de Alto Impacto
Formato LinkedIn: Segoe UI, azul #0066C2, una columna, emojis, tabla de proceso.
Salida: c:\\Users\\BEEMETRY\\Desktop\\26-05-2026\\Convocatoria_Laboral_01_Backend_LinkedIn.docx
"""

import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

C_NEGRO     = RGBColor(0x1B, 0x1B, 0x1B)
C_GRIS      = RGBColor(0x66, 0x66, 0x66)
C_AZUL_LI   = RGBColor(0x00, 0x66, 0xC2)
C_FONDO_TAG = RGBColor(0xEE, 0xF3, 0xF8)
C_BORDE     = RGBColor(0xCC, 0xCC, 0xCC)
C_WHITE     = RGBColor(0xFF, 0xFF, 0xFF)
C_ROJO      = RGBColor(0xC0, 0x39, 0x2B)
C_VERDE     = RGBColor(0x1A, 0x7A, 0x3C)
C_TEAL      = RGBColor(0x00, 0x7A, 0x8A)


def h(c): return f"{c[0]:02X}{c[1]:02X}{c[2]:02X}"

def shading(para, color):
    pPr = para._p.get_or_add_pPr()
    s = OxmlElement('w:shd')
    s.set(qn('w:val'), 'clear'); s.set(qn('w:color'), 'auto')
    s.set(qn('w:fill'), h(color)); pPr.append(s)

def border_bottom(para, color=C_BORDE, sz=6):
    pPr = para._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    b = OxmlElement('w:bottom')
    b.set(qn('w:val'), 'single'); b.set(qn('w:sz'), str(sz))
    b.set(qn('w:space'), '6'); b.set(qn('w:color'), h(color))
    pBdr.append(b); pPr.append(pBdr)

def parse(text):
    parts = text.split('**')
    return [(p, i % 2 == 1) for i, p in enumerate(parts) if p]


def build():
    doc = Document()
    for sec in doc.sections:
        sec.top_margin = Cm(2.5); sec.bottom_margin = Cm(2.5)
        sec.left_margin = Cm(3.5); sec.right_margin = Cm(3.5)
        sec.page_width = Cm(21)

    style = doc.styles['Normal']
    style.font.name = 'Segoe UI'
    style.font.size = Pt(11)
    style.font.color.rgb = C_NEGRO

    def p(before=4, after=4):
        pa = doc.add_paragraph()
        pa.paragraph_format.space_before = Pt(before)
        pa.paragraph_format.space_after  = Pt(after)
        return pa

    def run(para, text, bold=False, size=11, color=C_NEGRO, italic=False):
        r = para.add_run(text)
        r.bold = bold; r.italic = italic
        r.font.name = 'Segoe UI'; r.font.size = Pt(size)
        r.font.color.rgb = color; return r

    def runs(para, segs, size=11):
        for txt, bold in segs: run(para, txt, bold=bold, size=size)

    def sec_title(icon, title, color=C_AZUL_LI, size=12):
        pa = p(before=14, after=4)
        run(pa, f"{icon} ", size=size, color=color)
        run(pa, title, bold=True, size=size, color=color)
        border_bottom(pa, color=color, sz=6); return pa

    def bullet(icon, text, icon_color=C_NEGRO, size=11):
        pa = doc.add_paragraph()
        pa.paragraph_format.left_indent       = Cm(0.6)
        pa.paragraph_format.first_line_indent = Cm(-0.6)
        pa.paragraph_format.space_before = Pt(2)
        pa.paragraph_format.space_after  = Pt(3)
        r = pa.add_run(f"{icon}  ")
        r.font.name = 'Segoe UI'; r.font.size = Pt(size)
        r.font.color.rgb = icon_color
        runs(pa, parse(text), size=size); return pa

    def sp():
        pa = doc.add_paragraph()
        pa.paragraph_format.space_before = Pt(0)
        pa.paragraph_format.space_after  = Pt(0)
        run(pa, "", size=4)

    # ── CABECERA ──────────────────────────────────────────────────────────────
    run(p(before=0, after=2), "Se busca:", size=11, color=C_GRIS)
    run(p(before=0, after=4), "Desarrollador Backend & Datos Semi-Senior", bold=True, size=20)
    run(p(before=0, after=2), "Plataforma Industrial de Alto Impacto — PostgreSQL · Docker · Tiempo Real",
        size=13, color=C_GRIS)

    pb = p(before=4, after=8)
    for badge, sep in [("📍 Remoto / Híbrido","   "),("⏱ Full Time","   "),
                        ("📄 6 meses renovable","   "),("🚀 Incorporación inmediata","")]:
        run(pb, badge, size=10, color=C_AZUL_LI)
        if sep: run(pb, sep, size=10, color=C_GRIS)
    border_bottom(pb, color=C_BORDE, sz=4)

    # ── INTRO ─────────────────────────────────────────────────────────────────
    sp()
    pi1 = p(before=6, after=4); pi1.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    runs(pi1, parse(
        "Organización del sector industrial convoca a un profesional **Semi-Senior** para desarrollar "
        "la capa de datos, persistencia y servicios backend de una plataforma web enterprise "
        "de monitoreo operativo, reportabilidad técnica y gestión documental avanzada."
    ))
    pi2 = p(before=0, after=10); pi2.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    run(pi2, "¿Te apasionan las bases de datos, la continuidad operativa y la integración de sistemas? "
        "Esta es tu oportunidad de crecer en un proyecto de transformación digital de alto impacto "
        "con un equipo Senior que te guiará desde el primer sprint.",
        italic=True, size=11, color=C_GRIS)

    # ── STACK EN PRODUCCIÓN ───────────────────────────────────────────────────
    sec_title("⚙️", "STACK TÉCNICO EN PRODUCCIÓN", color=C_TEAL)
    for bp, rest in [
        ("PostgreSQL 15 + TimescaleDB", " · Multi-tenant con Row-Level Security, hypertables, particionado, replicación y tuning avanzado."),
        ("APIs REST + WebSocket", " · Backend de alto rendimiento sobre servicios dockerizados; comunicación en tiempo real para telemetría de sensores."),
        ("ETL/ELT pipelines", " · Integración con fuentes legacy e IoT industrial; ingesta incremental con idempotencia y monitoreo de rezagos."),
        ("Docker + Linux (Ubuntu 24.04)", " · Build multi-stage, healthchecks, CI/CD en VPS Lima; sin dependencia de cloud pública."),
        ("Python", " · Análisis, scripting, soporte a decisiones de arquitectura e integración con motor de fórmulas."),
        ("Formula Engine", " · Microservicio C++ independiente (PostgreSQL fórmulas); integración vía API REST interna (:18020)."),
        ("TimescaleDB", " + Redpanda/NATS · Ingesta de ~10 000 sensores en tiempo real con series temporales y agregaciones por ventana."),
        ("Seguridad", " · RBAC, cifrado en tránsito/reposo, bitácoras inmutables, OWASP aplicado a APIs y hardening de base de datos."),
    ]:
        pa = doc.add_paragraph()
        pa.paragraph_format.left_indent = Cm(0.6)
        pa.paragraph_format.first_line_indent = Cm(-0.6)
        pa.paragraph_format.space_before = Pt(2); pa.paragraph_format.space_after = Pt(3)
        run(pa, "▸  ", size=11, color=C_TEAL)
        run(pa, bp, bold=True, size=11); run(pa, rest, size=11)
    sp()

    # ── LO QUE HARÁS ──────────────────────────────────────────────────────────
    sec_title("🔧", "LO QUE HARÁS EN TU DÍA A DÍA")
    for t in [
        "Diseñar e implementar modelos de datos transaccionales, documentales y de **series temporales** con soporte multi-empresa, auditoría y políticas de retención.",
        "Desarrollar y mantener servicios backend de **alto rendimiento**: APIs REST, canales de comunicación en tiempo real y autoservicio documental.",
        "Construir pipelines **ETL/ELT** e integraciones con fuentes legacy e IoT/industrial, garantizando idempotencia y monitoreo de rezagos.",
        "Diseñar estrategias de persistencia local, colas de cambios pendientes y **reconciliación offline** al restablecer la conectividad.",
        "Administrar entornos **Linux y contenedores**: backups probados, planes de recuperación ante desastres y migraciones de esquema versionadas.",
        "Aplicar controles de seguridad: **Row-Level Security**, cifrado en tránsito y en reposo, bitácoras inmutables y cumplimiento normativo.",
        "Definir estándares y buenas prácticas de arquitectura; guiar a los equipos de desarrollo, QA y PMO.",
        "Colaborar en contratos de integración con el equipo Frontend y con el motor de fórmulas (microservicio C++).",
        "Participar en **sprints, revisiones de código y demos** con metodología ágil (Git + ClickUp).",
    ]:
        bullet("◆", t, icon_color=C_AZUL_LI)
    sp()

    # ── REQUISITOS EXCLUYENTES ────────────────────────────────────────────────
    sec_title("✅", "REQUISITOS EXCLUYENTES", color=C_ROJO)
    pne = p(before=2, after=4); shading(pne, RGBColor(0xFF, 0xF0, 0xEF))
    run(pne, "  ⚠  La ausencia de cualquiera de estos puntos descalifica la postulación.",
        size=10, color=C_ROJO, italic=True)
    for e in [
        "**4+ años** de experiencia en desarrollo backend; mínimo **2 años** con PostgreSQL en aplicaciones de producción.",
        "**Buen manejo de PostgreSQL:** modelado relacional, JSON/JSONB, índices, backup/restore y consultas complejas (CTEs, window functions).",
        "Servicios backend de **alto rendimiento**, APIs REST y comunicación en tiempo real (WebSockets, SSE o equivalente).",
        "Implementación de **trazabilidad, auditoría de acciones y control de acceso** en APIs y base de datos.",
        "Pipelines **ETL/ELT**, integración con sistemas externos (legacy e IoT) y sincronización incremental controlada.",
        "Seguridad en datos: **RBAC, cifrado, OWASP** aplicado a APIs y accesos, hardening de bases de datos.",
        "Operación fluida en **Linux, Docker y entornos productivos con CI/CD.**",
        "Experiencia en **proyectos enterprise:** aplicaciones web de negocio, ERPs, plataformas de monitoreo o similares.",
        "**Git y gestión ágil** de proyectos en equipos multidisciplinarios.",
        "**Español fluido; inglés técnico de lectura** (documentación, RFCs, whitepapers).",
    ]:
        bullet("▸", e, icon_color=C_ROJO)
    sp()

    # ── REQUISITOS IMPORTANTES ────────────────────────────────────────────────
    sec_title("⭐", "REQUISITOS IMPORTANTES")
    pni = p(before=2, after=4); shading(pni, C_FONDO_TAG)
    run(pni, "  Alta valoración — marcan la diferencia en la evaluación.", size=10, color=C_GRIS, italic=True)
    for i in [
        "Diseño de modelos de datos **relacionales y documentales** con foco en integridad y mantenibilidad.",
        "Conocimiento de patrones de backend: **Repository, Service Layer, API Gateway** y separación de responsabilidades.",
        "Bases de datos **relacionales** (PostgreSQL, MySQL) y nociones de **NoSQL** (MongoDB, Redis).",
        "**SQL intermedio-avanzado:** joins complejos, CTEs, índices y optimización básica de queries.",
        "Python o Node.js para scripting, automatización e integración con servicios externos.",
    ]:
        bullet("▸", i, icon_color=C_AZUL_LI)
    sp()

    # ── CONOCIMIENTOS DESEABLES ───────────────────────────────────────────────
    sec_title("💡", "CONOCIMIENTOS DESEABLES", color=C_GRIS)
    pnd = p(before=2, after=4); shading(pnd, RGBColor(0xF8, 0xF8, 0xF8))
    run(pnd, "  No excluyentes — altamente valorados.", size=10, color=C_GRIS, italic=True)
    for d in [
        "Motores de **series temporales:** TimescaleDB, InfluxDB y telemetría de alta frecuencia.",
        "**Mensajería/streaming:** Kafka, Redpanda, NATS o equivalentes para ingesta ordenada de eventos.",
        "**Multi-tenancy** con Row-Level Security y políticas de retención por regulación legal.",
        "Modelado de eventos con **validación biométrica** integrada a flujos de acceso.",
        "Operaciones con **conectividad intermitente** y reconciliación de datos offline.",
        "Certificaciones en **DBA, seguridad de la información** o normas IEC 62443.",
        "Marcos **ISO** aplicables a calidad de software y trazabilidad documental.",
        "Infraestructura como código **(IaC)** y orquestación de contenedores.",
    ]:
        bullet("▸", d, icon_color=C_GRIS)
    sp()

    # ── QUÉ TE OFRECEMOS ──────────────────────────────────────────────────────
    sec_title("🏆", "QUÉ TE OFRECEMOS", color=C_VERDE)
    for icon, txt in [
        ("✔", "Proyecto de **alto impacto real** — tu código llega a producción desde el primer sprint."),
        ("✔", "**Mentoría de perfil Senior:** tendrás guía técnica directa del arquitecto del proyecto."),
        ("✔", "Equipo multidisciplinario consolidado con metodología ágil operativa y procesos definidos."),
        ("✔", "**Planilla completa desde el primer día.** Contrato 6 meses, renovable según desempeño."),
        ("✔", "Compensación **S/. 5,500 – S/. 7,500 bruto/mes** (planilla completa, según experiencia demostrada)."),
    ]:
        pa = doc.add_paragraph()
        pa.paragraph_format.left_indent = Cm(0.6)
        pa.paragraph_format.first_line_indent = Cm(-0.6)
        pa.paragraph_format.space_before = Pt(2); pa.paragraph_format.space_after = Pt(4)
        run(pa, f"{icon}  ", size=11, color=C_VERDE)
        runs(pa, parse(txt))
    sp()

    # ── CÓMO POSTULAR ─────────────────────────────────────────────────────────
    sec_title("📩", "¿CÓMO POSTULAR?")
    penv = p(before=4, after=2)
    run(penv, "Envía los siguientes elementos al correo ")
    run(penv, "[CORREO DE CONTACTO]", bold=True, size=11, color=C_ROJO)
    run(penv, " con el asunto:")

    pas = p(before=2, after=8); pas.paragraph_format.left_indent = Cm(0.8)
    shading(pas, C_FONDO_TAG)
    run(pas, '  "Semi-Senior Backend & Datos — [TU NOMBRE COMPLETO]"',
        bold=True, italic=True, size=11, color=C_AZUL_LI)

    for num, btxt, rest in [
        ("1.", "CV actualizado en PDF", " (máx. 3 páginas)."),
        ("2.", "Portafolio o repositorios de código", " (GitHub, GitLab — opcional pero valorado)."),
        ("3.", "Respuesta breve en el correo", " (máx. 150 palabras) a la pregunta de filtro:"),
    ]:
        pb2 = doc.add_paragraph()
        pb2.paragraph_format.left_indent = Cm(0.8)
        pb2.paragraph_format.space_before = Pt(2); pb2.paragraph_format.space_after = Pt(3)
        run(pb2, f"{num}  ", bold=True, size=11, color=C_AZUL_LI)
        run(pb2, btxt, bold=True, size=11); run(pb2, rest, size=11)

    pq = p(before=4, after=4)
    pq.paragraph_format.left_indent = Cm(1.0); pq.paragraph_format.right_indent = Cm(0.5)
    shading(pq, C_FONDO_TAG)
    run(pq, '  "¿Cuál fue el proyecto de datos de mayor complejidad técnica en el que participaste? '
        'Describe específicamente tu rol, las decisiones de arquitectura que tomaste y el impacto medible que generaste."',
        italic=True, size=10.5)

    ppr = p(before=6, after=10)
    run(ppr, "Los candidatos que respondan esta pregunta tienen prioridad. "
        "Los que no la respondan no serán considerados en la primera revisión.",
        bold=True, size=10.5, color=C_ROJO)

    # ── PROCESO DE SELECCIÓN ──────────────────────────────────────────────────
    sec_title("📋", "PROCESO DE SELECCIÓN"); sp()

    tbl = doc.add_table(rows=6, cols=3)

    def cell_set(cell, text, bold=False, bg=None,
                 align=WD_ALIGN_PARAGRAPH.LEFT, color=C_NEGRO):
        if bg:
            tc = cell._tc; tcPr = tc.get_or_add_tcPr()
            s = OxmlElement('w:shd')
            s.set(qn('w:val'), 'clear'); s.set(qn('w:color'), 'auto')
            s.set(qn('w:fill'), h(bg)); tcPr.append(s)
        pa = cell.paragraphs[0]
        pa.alignment = align
        pa.paragraph_format.space_before = Pt(4); pa.paragraph_format.space_after = Pt(4)
        r = pa.add_run(text)
        r.bold = bold; r.font.name = 'Segoe UI'
        r.font.size = Pt(9.5); r.font.color.rgb = color

    for i, hdr in enumerate(["FASE", "DURACIÓN", "RESPONSABLE"]):
        cell_set(tbl.rows[0].cells[i], hdr, bold=True,
                 bg=C_AZUL_LI, color=C_WHITE, align=WD_ALIGN_PARAGRAPH.CENTER)

    alt = [RGBColor(0xF0, 0xF6, 0xFD), C_WHITE]
    for ri, (f, d, r_) in enumerate([
        ("Revisión de CV + respuesta técnica obligatoria", "48 h", "Líder técnico / ARQ"),
        ("Entrevista técnica — PostgreSQL, APIs REST y Docker (40 min)", "1 sesión", "ARQ"),
        ("Challenge técnico asíncrono (máx. 3 h del candidato)", "2–4 días", "Candidato"),
        ("Entrevista final — encaje técnico y cultural (30 min)", "1 sesión", "ARQ + PM"),
        ("Oferta, negociación y firma", "48 h", "PM / RRHH"),
    ]):
        for ci, (val, aln) in enumerate([
            (f, WD_ALIGN_PARAGRAPH.LEFT),
            (d, WD_ALIGN_PARAGRAPH.CENTER),
            (r_, WD_ALIGN_PARAGRAPH.CENTER),
        ]):
            cell_set(tbl.rows[ri+1].cells[ci], val, bg=alt[ri % 2], align=aln)

    sp(); sp()

    # ── CHALLENGE ─────────────────────────────────────────────────────────────
    sec_title("🧩", "EJEMPLO DE CHALLENGE TÉCNICO", color=C_TEAL)
    pch = p(before=4, after=4)
    pch.paragraph_format.left_indent = Cm(0.8); pch.paragraph_format.right_indent = Cm(0.5)
    shading(pch, RGBColor(0xF0, 0xF8, 0xFA))
    run(pch, '  "Diseña el esquema de base de datos para telemetría de sensores industriales '
        '(campos: tenant_id, sensor_id, value, unit, timestamp) con soporte para: '
        '(a) agregaciones por sensor para ventanas de 1 h, 6 h y 24 h; '
        '(b) auditoría inmutable de modificaciones; '
        '(c) aislamiento multi-tenant. '
        'Incluye: DDL PostgreSQL, estrategia de partición o hypertables TimescaleDB, '
        'índices justificados y 2 consultas de agregación de ejemplo. '
        'Documenta las decisiones de diseño. Tiempo máximo: 4 horas."',
        italic=True, size=10.5)
    sp(); sp()

    # ── HASHTAGS ──────────────────────────────────────────────────────────────
    border_bottom(p(before=4, after=4), color=C_BORDE, sz=4)
    run(p(before=6, after=4),
        "🔁 Si conoces a alguien con este perfil, comparte esta publicación. "
        "El mejor talento técnico llega por referidos.",
        size=10.5, color=C_GRIS, italic=True)

    ptags = p(before=6, after=6)
    for tag in ["#BackendSemiSenior","#DesarrolladorBackend","#PostgreSQL","#DataEngineering",
                "#TimescaleDB","#Docker","#Linux","#IndustriaMinera","#TransformacionDigital",
                "#Industria40","#TechJobsLATAM","#RemoteWork","#ETL","#Hiring"]:
        run(ptags, tag + "  ", size=9.5, color=C_AZUL_LI)

    # ── PIE ───────────────────────────────────────────────────────────────────
    fp = doc.sections[0].footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("Convocatoria Laboral 01 — Desarrollador Backend & Datos Semi-Senior · Mayo 2026 · Publicación LinkedIn")
    r.font.name = 'Segoe UI'; r.font.size = Pt(8); r.font.color.rgb = C_GRIS

    # ── GUARDAR ───────────────────────────────────────────────────────────────
    out_dir = r"c:\Users\BEEMETRY\Desktop\26-05-2026"
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, "Convocatoria_Laboral_01_Backend_LinkedIn.docx")
    doc.save(out)
    print(f"✅  Generado: {out}")


if __name__ == "__main__":
    build()
