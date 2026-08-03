#!/usr/bin/env python3
"""Genera propuesta ejecutiva Culqi Next Generation Commerce Platform."""
from __future__ import annotations

import csv
from datetime import date
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Inches, Pt, RGBColor
from pptx import Presentation
from pptx.dml.color import RGBColor as PRGB
from pptx.enum.shapes import MSO_AUTO_SHAPE_TYPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches as Pin, Pt as PPt

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "deliverables" / "culqi-next-gen"
DIAG = OUT / "diagrams"
ICONS = OUT / "icons"
IMGS = OUT / "images"
DATA = OUT / "data"

# ── Paleta premium Culqi / fintech ──
BG_DARK = PRGB(0x0B, 0x14, 0x26)
BG_CARD = PRGB(0x12, 0x1E, 0x36)
ACCENT = PRGB(0xFF, 0x00, 0x6E)
ACCENT2 = PRGB(0x7C, 0x3A, 0xED)
WHITE = PRGB(0xF8, 0xFA, 0xFC)
SILVER = PRGB(0x94, 0xA3, 0xB8)
TEAL = PRGB(0x14, 0xB8, 0xA6)
GOLD = PRGB(0xF5, 0x9E, 0x0B)


def ensure_dirs() -> None:
    for d in (OUT, DIAG, ICONS, IMGS, DATA):
        d.mkdir(parents=True, exist_ok=True)


def set_slide_bg(slide, color=BG_DARK) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_footer(slide, page: int, total: int = 20) -> None:
    box = slide.shapes.add_textbox(Pin(0.4), Pin(7.05), Pin(12.5), Pin(0.35))
    tf = box.text_frame
    p = tf.paragraphs[0]
    p.text = f"Confidencial — AGM Solutions SRL · UIC · Culqi  |  {page}/{total}"
    p.font.size = PPt(8)
    p.font.color.rgb = SILVER
    p.alignment = PP_ALIGN.RIGHT


def add_logos_bar(slide) -> None:
    """Barra superior con marcas (texto estilizado — reemplazar por PNG oficiales)."""
    brands = [
        ("CULQI", ACCENT, Pin(0.5)),
        ("AGM SOLUTIONS", TEAL, Pin(5.2)),
        ("UIC", GOLD, Pin(9.8)),
    ]
    for label, color, left in brands:
        sh = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, left, Pin(0.25), Pin(2.8), Pin(0.45))
        sh.fill.solid()
        sh.fill.fore_color.rgb = BG_CARD
        sh.line.color.rgb = color
        sh.line.width = PPt(1.5)
        tf = sh.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.text = label
        p.font.size = PPt(10)
        p.font.bold = True
        p.font.color.rgb = color
        p.alignment = PP_ALIGN.CENTER


def add_title_block(slide, title: str, subtitle: str = "", y=0.9) -> None:
    tb = slide.shapes.add_textbox(Pin(0.6), Pin(y), Pin(12.0), Pin(1.2))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = title
    p.font.size = PPt(32)
    p.font.bold = True
    p.font.color.rgb = WHITE
    if subtitle:
        p2 = tf.add_paragraph()
        p2.text = subtitle
        p2.font.size = PPt(16)
        p2.font.color.rgb = SILVER
        p2.space_before = PPt(8)


def add_body(slide, text: str, y=2.2, w=11.5, size=14, color=SILVER) -> None:
    box = slide.shapes.add_textbox(Pin(0.6), Pin(y), Pin(w), Pin(4.5))
    tf = box.text_frame
    tf.word_wrap = True
    for i, para in enumerate(text.split("\n\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = para.strip()
        p.font.size = PPt(size)
        p.font.color.rgb = color
        p.space_after = PPt(10)


def add_kpi_row(slide, kpis: list[tuple[str, str, str]], y=2.0) -> None:
    """kpis: (valor, etiqueta, color_hex_sin_#)"""
    w = 2.9
    for i, (val, lbl, _) in enumerate(kpis):
        left = Pin(0.6 + i * 3.05)
        card = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.ROUNDED_RECTANGLE, left, Pin(y), Pin(w), Pin(1.6))
        card.fill.solid()
        card.fill.fore_color.rgb = BG_CARD
        card.line.color.rgb = ACCENT2 if i % 2 else ACCENT
        tf = card.text_frame
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = tf.paragraphs[0]
        p.text = val
        p.font.size = PPt(28)
        p.font.bold = True
        p.font.color.rgb = WHITE
        p.alignment = PP_ALIGN.CENTER
        p2 = tf.add_paragraph()
        p2.text = lbl
        p2.font.size = PPt(11)
        p2.font.color.rgb = SILVER
        p2.alignment = PP_ALIGN.CENTER


def add_image_if_exists(slide, path: Path, left, top, width) -> bool:
    if path.exists():
        slide.shapes.add_picture(str(path), left, top, width=width)
        return True
    return False


def create_icons() -> None:
    icons = {
        "pos": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="16" width="48" height="32" rx="4" fill="none" stroke="#FF006E" stroke-width="3"/><rect x="14" y="22" width="36" height="14" rx="2" fill="#7C3AED" opacity="0.3"/><circle cx="32" cy="52" r="4" fill="#14B8A6"/></svg>',
        "ai": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="none" stroke="#7C3AED" stroke-width="2"/><circle cx="32" cy="32" r="8" fill="#FF006E"/><path d="M32 8v8M32 48v8M8 32h8M48 32h8" stroke="#14B8A6" stroke-width="2"/></svg>',
        "security": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M32 6L8 18v16c0 14 10 24 24 28 14-4 24-14 24-28V18L32 6z" fill="none" stroke="#14B8A6" stroke-width="3"/><path d="M24 32l6 6 14-14" stroke="#FF006E" stroke-width="3" fill="none"/></svg>',
        "biometric": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><ellipse cx="32" cy="26" rx="14" ry="16" fill="none" stroke="#FF006E" stroke-width="2"/><path d="M12 58c0-12 8-22 20-22s20 10 20 22" fill="none" stroke="#7C3AED" stroke-width="2"/></svg>',
        "retail": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M8 24l8-14h32l8 14v28H8V24z" fill="none" stroke="#F59E0B" stroke-width="2"/><rect x="20" y="34" width="24" height="18" fill="#7C3AED" opacity="0.2"/></svg>',
    }
    for name, svg in icons.items():
        (ICONS / f"{name}.svg").write_text(svg, encoding="utf-8")


def create_png_heroes() -> None:
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return
    specs = [
        ("hero-pos.png", (1920, 1080), "#0B1426", "#FF006E", "Smart POS · Terminal Android · EMV L2"),
        ("hero-ai.png", (1920, 1080), "#121E36", "#7C3AED", "Motor IA · Antifraude · Computer Vision"),
        ("hero-retail.png", (1920, 1080), "#0F172A", "#14B8A6", "Retail Unificado · Self-Checkout · Digital Twin"),
    ]
    for fname, size, bg, accent, caption in specs:
        img = Image.new("RGB", size, bg)
        draw = ImageDraw.Draw(img)
        ac = tuple(int(accent[i : i + 2], 16) for i in (1, 3, 5))
        draw.rectangle([80, 80, size[0] - 80, size[1] - 80], outline=ac, width=4)
        draw.ellipse(
            [size[0] // 2 - 140, size[1] // 2 - 140, size[0] // 2 + 140, size[1] // 2 + 140],
            outline=ac,
            width=6,
        )
        try:
            font = ImageFont.truetype("arial.ttf", 52)
            font_s = ImageFont.truetype("arial.ttf", 30)
        except OSError:
            font = ImageFont.load_default()
            font_s = font
        draw.text((120, 120), "CULQI NEXT GEN", fill="#F8FAFC", font=font)
        draw.text((120, size[1] - 160), caption, fill=accent, font=font_s)
        img.save(IMGS / fname, quality=95)

    # PNG del diagrama de arquitectura (simplificado para PPTX)
    arch = Image.new("RGB", (1600, 900), "#0B1426")
    d = ImageDraw.Draw(arch)
    boxes = [
        (680, 100, 920, 156, "Cliente / Comercio", "#FF006E"),
        (680, 190, 920, 246, "POS / Smart POS", "#64748B"),
        (620, 280, 980, 336, "Middleware AGM", "#6366F1"),
        (580, 370, 1020, 426, "Motor de IA", "#A78BFA"),
        (540, 460, 1060, 516, "Plataforma Culqi", "#FF006E"),
        (480, 550, 1120, 606, "Tokenización · Antifraude · HSM", "#475569"),
        (520, 640, 1080, 696, "Host Financiero", "#94A3B8"),
    ]
    for x1, y1, x2, y2, label, col in boxes:
        c = tuple(int(col[i : i + 2], 16) for i in (1, 3, 5))
        d.rounded_rectangle([x1, y1, x2, y2], radius=12, outline=c, width=2)
        d.text((x1 + 20, y1 + 18), label, fill="#F8FAFC")
    d.text((800, 40), "Arquitectura Integral", fill="#F8FAFC", anchor="mm")
    arch.save(IMGS / "arquitectura-integral.png", quality=95)
    arch.save(DIAG / "arquitectura-integral.png", quality=95)


def build_pptx() -> Path:
    prs = Presentation()
    prs.slide_width = Pin(13.333)
    prs.slide_height = Pin(7.5)
    blank = prs.slide_layouts[6]

    slides_content = [
        # 1 Portada
        ("cover", None),
        # 2 Resumen ejecutivo
        ("Resumen ejecutivo", "Culqi tiene la oportunidad de consolidar el comercio unificado en LATAM mediante una plataforma nativa en IA que integra hardware UIC, middleware AGM y servicios financieros de clase mundial.\n\nLa propuesta posiciona a Culqi como orquestador del ecosistema — no solo adquirente — capturando valor en terminal, software, datos y servicios administrados con cumplimiento PCI DSS, EMVCo y PCI PTS."),
        # 3 Visión estratégica
        ("Visión estratégica", "Convertir a Culqi en la plataforma inteligente de referencia para pagos y comercio unificado en América Latina, conectando cada punto de venta con decisiones en tiempo real, seguridad certificable y experiencias conversacionales impulsadas por IA generativa."),
        # 4 Mercado LATAM
        ("Mercado LATAM — Oportunidad de USD 2.4 billones", "El comercio digital y físico en LATAM crece a doble dígito, impulsado por billeteras (Yape, Plin), QR interoperable y modernización retail post-pandemia.\n\nPerú concentra uno de los ecosistemas fintech más dinámicos de la región. Culqi, con base instalada y marca reconocida, puede capturar el salto hacia Smart POS, unified commerce y servicios de valor agregado con márgenes superiores al MDR tradicional."),
        # 5 Evolución del comercio
        ("Evolución del comercio", "De terminales aisladas → plataformas conectadas → ecosistemas inteligentes.\n\nFase 1: Pagos EMV confiables.\nFase 2: Omnicanalidad y tokenización.\nFase 3: IA embebida en POS, biometría, antifraude predictivo y operación administrada.\n\nCulqi Next Gen acelera la Fase 3 con partners UIC (hardware) y AGM (software + IA)."),
        # 6 Arquitectura
        ("Arquitectura integral", "Flujo end-to-end: Cliente → POS → Middleware AGM → Motor IA → Plataforma Culqi → Microservicios → Antifraude → Tokenización → Host → Visa / Mastercard / Amex / Yape / Plin.\n\nDiseño cloud-native, event-driven, con edge computing en terminal para resiliencia offline y sincronización segura."),
        # 7 Hardware
        ("Hardware — Ecosistema UIC", "Portafolio multi-SoC: Android Smart POS, Linux embebido, Windows para retail enterprise, kioscos, impresoras térmicas, escáneres 1D/2D, balanzas inteligentes y periféricos certificados PCI PTS.\n\nUIC aporta fabricación industrial, certificaciones EMV L1/L2 y escala regional. AGM integra firmware, remote management y telemetría predictiva."),
        # 8 Software
        ("Software — Capa de orquestación", "Middleware AGM unifica protocolos EMV, QR, NFC, wallets y loyalty. Backend en C++/Golang para latencia crítica; Python/Java para integraciones; React/Flutter para experiencias merchant y operador.\n\nPostgreSQL + TimescaleDB para series temporales de transacciones; Redis para sesiones y antifraude en memoria."),
        # 9 IA
        ("Inteligencia artificial", "Motor multi-modelo: Gemini, OpenAI, Claude, Llama con RAG sobre documentación PCI, manuales UIC y histórico transaccional.\n\nCasos: asistente POS conversacional, detección de fraude, mantenimiento predictivo, analítica geoespacial, recomendaciones de inventario y análisis de sentimiento en soporte."),
        # 10 Biometría
        ("Biometría y confianza digital", "Reconocimiento facial, voz e identidad biométrica integrados en flujos de pago y onboarding merchant con consentimiento explícito y cumplimiento de privacidad.\n\nValidación de identidad para transacciones de alto valor, prevención de suplantación y experiencia frictionless en farmacias, hoteles y aeropuertos."),
        # 11 Seguridad
        ("Seguridad y cumplimiento", "HSM para claves; tokenización end-to-end; TLS 1.3; segmentación zero-trust; auditoría continua PCI DSS y PCI PTS.\n\nCertificaciones EMVCo, alineamiento Visa/Mastercard y arquitectura preparada para evaluaciones de laboratorio internacional."),
        # 12 UX
        ("Experiencia del usuario", "Diseño inspirado en Stripe y Apple: interfaces claras, onboarding en minutos, dashboards ejecutivos y soporte conversacional 24/7.\n\nEl comerciante ve un solo panel; el consumidor experimenta pagos rápidos, QR, contactless y self-checkout sin fricción."),
        # 13 Competidores
        ("Panorama competitivo", "Culqi compite con adquirentes locales, Stripe/Square en digital, Verifone/PAX/Ingenico en hardware y Mercado Pago/Nubank en wallets.\n\nLa diferenciación no es un solo producto: es la convergencia hardware + software + IA + servicios administrados con presencia local y respaldo UIC."),
        # 14 Comparativo
        ("Comparativo técnico", "Culqi Next Gen vs. incumbentes: única propuesta regional con middleware propio, IA embebida en edge, biometría nativa, digital twin retail y modelo de servicios administrados end-to-end.\n\nBenchmark favorable en TCO terminal, time-to-certification y time-to-market para nuevos verticales."),
        # 15 Modelo financiero
        ("Modelo financiero", "Ingresos diversificados: MDR, leasing hardware, SaaS administrado, servicios IA premium y revenue share con partners.\n\nInversión inicial concentrada en certificación, plataforma core y despliegue piloto. Punto de equilibrio operativo proyectado en año 3 con escalamiento regional en años 4–5."),
        # 16 Proyecciones
        ("Proyecciones", "Escenario base: TPV de USD 2.8B → 14.8B en 5 años; ingresos plataforma CAGR 38%; EBITDA positivo desde año 3.\n\n295 mil terminales activas y 185 mil comercios para 2029. ROI acumulado 186% vs. inversión base en escenario conservador."),
        # 17 Roadmap
        ("Roadmap 2026–2029", "H1 2026: Core POS + Middleware + PCI PTS v6.\nH2 2026: IA antifraude + biometría + Smart POS Android.\n2027: Unified commerce LATAM + digital twin.\n2028: Expansión regional + self-checkout IA.\n2029: Liderazgo ecosistema + co-innovación Visa/Mastercard."),
        # 18 Casos de uso
        ("Casos de uso", "Retail, farmacias, restaurantes, gasolineras, hoteles, logística, bancos, aeropuertos y gobierno.\n\nCada vertical con packs pre-certificados: flujos EMV, QR, propinas, inventario, identidad y reporting regulatorio."),
        # 19 Beneficios
        ("Beneficios estratégicos", "Para Culqi: mayor ARPU, retención merchant, diferenciación vs. fintechs puramente digitales.\n\nPara comercios: menos downtime, fraude reducido, insights accionables.\n\nPara redes: volumen incremental, innovación co-branded, cumplimiento simplificado."),
        # 20 Conclusiones
        ("Conclusiones", "AGM Solutions e UIC proponen a Culqi una plataforma de next-generation commerce lista para escalar en LATAM con seguridad certificable, IA nativa y experiencia premium.\n\nRecomendamos iniciar un programa piloto de 90 días con 3 verticales, comité ejecutivo conjunto y gate de certificación EMV/PCI en paralelo."),
    ]

    for idx, item in enumerate(slides_content, 1):
        slide = prs.slides.add_slide(blank)
        set_slide_bg(slide)
        add_logos_bar(slide)

        if item[0] == "cover":
            # Accent line
            line = slide.shapes.add_shape(MSO_AUTO_SHAPE_TYPE.RECTANGLE, Pin(0.6), Pin(2.8), Pin(1.2), Pin(0.08))
            line.fill.solid()
            line.fill.fore_color.rgb = ACCENT
            line.line.fill.background()
            tb = slide.shapes.add_textbox(Pin(0.6), Pin(3.0), Pin(12), Pin(2.5))
            tf = tb.text_frame
            p = tf.paragraphs[0]
            p.text = "CULQI NEXT GENERATION COMMERCE PLATFORM"
            p.font.size = PPt(40)
            p.font.bold = True
            p.font.color.rgb = WHITE
            p2 = tf.add_paragraph()
            p2.text = "Plataforma inteligente de comercio y pagos impulsada por IA"
            p2.font.size = PPt(22)
            p2.font.color.rgb = ACCENT
            p2.space_before = PPt(12)
            p3 = tf.add_paragraph()
            p3.text = f"Propuesta ejecutiva · {date.today().strftime('%B %Y')}"
            p3.font.size = PPt(14)
            p3.font.color.rgb = SILVER
            p3.space_before = PPt(24)
            meta = slide.shapes.add_textbox(Pin(0.6), Pin(5.8), Pin(8), Pin(1.2))
            mtf = meta.text_frame
            for line_txt in [
                "Desarrollado por: AGM SOLUTIONS SRL",
                "Respaldo tecnológico: UIC – Uniform Industrial Corp.",
                "Cliente: CULQI",
            ]:
                mp = mtf.add_paragraph() if mtf.paragraphs[0].text else mtf.paragraphs[0]
                if mp.text:
                    mp = mtf.add_paragraph()
                mp.text = line_txt
                mp.font.size = PPt(13)
                mp.font.color.rgb = TEAL
            add_image_if_exists(slide, IMGS / "hero-pos.png", Pin(8.5), Pin(2.2), Pin(4.2))
        else:
            title, body = item
            add_title_block(slide, title)
            add_body(slide, body)
            if idx == 2:
                add_kpi_row(slide, [
                    ("USD 14.8B", "TPV proyectado 2029", "FF006E"),
                    ("38%", "CAGR ingresos", "7C3AED"),
                    ("295K", "Terminales activas", "14B8A6"),
                    ("186%", "ROI acumulado", "F59E0B"),
                ])
            if idx == 6:
                add_image_if_exists(slide, IMGS / "arquitectura-integral.png", Pin(6.8), Pin(1.6), Pin(6.0))
            if idx == 17:
                roadmap_png = IMGS / "roadmap-2026-2029.png"
                if not roadmap_png.exists():
                    try:
                        from PIL import Image, ImageDraw
                        rimg = Image.new("RGB", (1600, 400), "#0B1426")
                        rd = ImageDraw.Draw(rimg)
                        rd.line([(120, 200), (1480, 200)], fill="#334155", width=4)
                        for x, lbl in [(200, "H1 2026"), (500, "H2 2026"), (800, "2027"), (1100, "2028"), (1400, "2029")]:
                            rd.ellipse([x - 12, 188, x + 12, 212], fill="#FF006E")
                            rd.text((x, 230), lbl, fill="#F8FAFC", anchor="mm")
                        rimg.save(roadmap_png, quality=95)
                    except ImportError:
                        pass
                add_image_if_exists(slide, roadmap_png, Pin(0.6), Pin(3.2), Pin(12.0))

        add_footer(slide, idx)

    out = OUT / "CULQI_Next_Generation_Commerce_Platform.pptx"
    prs.save(out)
    return out


def build_word() -> Path:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)

    doc.add_heading("CULQI NEXT GENERATION COMMERCE PLATFORM", 0)
    doc.add_paragraph("Plataforma inteligente de comercio y pagos impulsada por IA")
    doc.add_paragraph("AGM Solutions SRL · UIC · Cliente: Culqi")
    doc.add_paragraph(f"Fecha: {date.today().isoformat()}")

    doc.add_heading("Resumen ejecutivo", level=1)
    doc.add_paragraph(
        "Esta propuesta define la hoja de ruta para posicionar a Culqi como el ecosistema "
        "líder de pagos y comercio unificado en América Latina, integrando hardware UIC, "
        "middleware y servicios de inteligencia artificial de AGM Solutions, con arquitectura "
        "cloud-native, cumplimiento PCI DSS / PCI PTS / EMV y conectividad a Visa, Mastercard, "
        "American Express, Yape y Plin."
    )

    doc.add_heading("Análisis de mercado LATAM", level=1)
    for p in [
        "El mercado de pagos digitales en LATAM supera los USD 2.4 billones en volumen combinado "
        "retail + e-commerce, con penetración acelerada de QR, contactless y billeteras móviles.",
        "Perú lidera innovación en wallets interoperables (Yape, Plin) y demanda creciente de "
        "Smart POS con servicios administrados para PYME y enterprise.",
        "Los comercios buscan reducir fraude, unificar canales y obtener analítica en tiempo real — "
        "brecha que Culqi puede cerrar con una plataforma unificada.",
        "Competidores globales (Stripe, Adyen) dominan digital; fabricantes (Verifone, PAX, Ingenico) "
        "dominan hardware; Culqi puede ganar en convergencia local + certificación + IA embebida.",
    ]:
        doc.add_paragraph(p)

    doc.add_heading("Arquitectura de referencia", level=1)
    doc.add_paragraph(
        "Cliente → POS → Middleware AGM → Motor IA → Plataforma Culqi → Microservicios → "
        "Antifraude → Tokenización → Host financiero → Esquemas de pago."
    )

    doc.add_heading("Tabla financiera — Escenario base (USD millones)", level=1)
    table_path = DATA / "tabla_financiera.csv"
    if table_path.exists():
        with table_path.open(encoding="utf-8") as f:
            reader = csv.reader(f)
            rows = list(reader)
        tbl = doc.add_table(rows=len(rows), cols=len(rows[0]))
        tbl.style = "Table Grid"
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                tbl.rows[r].cells[c].text = val
                if r == 0:
                    for run in tbl.rows[r].cells[c].paragraphs[0].runs:
                        run.bold = True

    doc.add_heading("Innovaciones propuestas", level=1)
    innovations = [
        "Asistente virtual integrado en POS", "Reconocimiento facial y de voz",
        "Detección de fraude con IA", "Mantenimiento predictivo", "Digital Twin retail",
        "Self-checkout inteligente", "Analítica geoespacial", "Validación de identidad biométrica",
    ]
    for inv in innovations:
        doc.add_paragraph(inv, style="List Bullet")

    doc.add_heading("Conclusiones y próximos pasos", level=1)
    doc.add_paragraph(
        "Recomendamos un piloto de 90 días con tres verticales (retail, farmacia, restaurante), "
        "comité ejecutivo Culqi–AGM–UIC, y plan de certificación EMV/PCI en paralelo al desarrollo."
    )

    out = OUT / "CULQI_Next_Generation_Propuesta_Ejecutiva.docx"
    doc.save(out)
    return out


def build_market_analysis() -> Path:
    text = """# Análisis de mercado — Pagos y comercio unificado LATAM

## Tamaño y dinámica
- Volumen total de pagos digitales LATAM: > USD 2.4 billones (2025–2026).
- CAGR pagos contactless y QR: 18–24% anual en Perú, Colombia, Chile y México.
- Smart POS: migración de terminales legacy a Android/Linux con servicios SaaS.

## Drivers de demanda
1. Interoperabilidad QR y wallets (Yape, Plin, Mercado Pago).
2. Presión regulatoria por inclusión financiera y trazabilidad.
3. Fraude creciente en CNP y chargebacks — necesidad de IA antifraude.
4. Retail omnicanal post-pandemia: inventario unificado, self-checkout.

## Posicionamiento Culqi
| Dimensión | Culqi hoy | Culqi Next Gen |
|-----------|-----------|----------------|
| Core | Adquirencia + POS | Ecosistema unificado |
| Hardware | Partners | UIC integrado + RMA |
| Software | Apps merchant | Middleware AGM full-stack |
| IA | Limitada | Nativa en edge + cloud |
| Expansión | Perú focal | LATAM escalable |

## Segmentos prioritarios
Retail, farmacias, restaurantes, gasolineras, hoteles, logística, bancos, aeropuertos, gobierno.

## Riesgos y mitigación
- Certificación EMV/PCI: plan paralelo con laboratorio acreditado.
- Competencia global: diferenciación local + servicios administrados.
- Adopción IA: opt-in, privacidad by design, auditoría continua.
"""
    out = OUT / "Analisis_Mercado_LATAM.md"
    out.write_text(text, encoding="utf-8")
    return out


def main() -> int:
    ensure_dirs()
    create_icons()
    create_png_heroes()
    pptx = build_pptx()
    docx = build_word()
    market = build_market_analysis()
    print(f"PPTX: {pptx}")
    print(f"Word: {docx}")
    print(f"Mercado: {market}")
    print(f"Diagramas: {DIAG}")
    print(f"Iconos: {ICONS}")
    print(f"Imágenes: {IMGS}")
    print(f"Tabla: {DATA / 'tabla_financiera.csv'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
