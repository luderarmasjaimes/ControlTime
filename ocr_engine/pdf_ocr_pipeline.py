"""
Extracción estructurada de PDF: texto digital + OCR avanzado (PaddleOCR
PP-StructureV2) SOLO en las páginas que de verdad lo necesitan.

Estrategia híbrida por página (esto es lo que da "máxima calidad" real sin
pagar el costo de OCR en todo el documento):
  1. Se intenta primero la capa de texto real embebida (PyMuPDF). Si la
     página tiene texto digital (no es un escaneo), se usa ESO -- fidelidad
     perfecta, instantáneo, cero error de OCR. Se intenta además detectar
     tablas nativas (`page.find_tables()`) para no perder su estructura.
  2. Solo si la página no trae texto digital (escaneo/foto -- el caso real
     que pide "OCR avanzado") se rasteriza a alto DPI y se corre PP-Structure
     (layout + reconocimiento de tabla + OCR), que da orden de lectura y
     estructura, no solo texto plano. Una región que PP-Structure detecte
     como figura/diagrama (ni tabla ni texto) se recorta y se guarda como
     imagen -- nunca se fuerza a texto OCR ilegible, así no se pierde
     información por intentar textualizar algo que no es texto.

Fidelidad ampliada (pedido explícito 2026-09-20, ver ADR-199 §7): además del
texto plano, cada párrafo trae spans de estilo real (negrita/cursiva/color/
tamaño/fuente), encabezados detectados (vía el esquema/marcadores reales del
PDF cuando existen, o por tamaño de fuente relativo) para que la Tabla de
Contenidos del editor los detecte solos, alineación de párrafo, listas
(viñeta/numerada) con su profundidad, imágenes intercaladas en su posición
real de lectura (no todas al final de la página), y la geometría real de la
página (tamaño/orientación/márgenes) para configurar el documento importado
igual que el original. Ver el módulo para lo que NO se persigue (posición
absoluta exacta de cada palabra, encabezado/pie como "chrome" de plataforma,
estilo por carácter en páginas escaneadas) y por qué.

Nunca lanza hacia el llamador: cualquier fallo de una página individual se
degrada a un bloque de error para esa página, no tumba el documento entero.
"""
from __future__ import annotations

import base64
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

import cv2
import fitz  # PyMuPDF
import numpy as np

log = logging.getLogger("ocr_engine.pipeline")

# Umbral de caracteres de texto embebido para considerar una página "digital"
# -- por debajo de esto (un sello suelto, un número de página) se trata como
# escaneada, porque no hay contenido real que rescatar de la capa de texto.
MIN_DIGITAL_CHARS = 40

DEFAULT_OCR_DPI = int(os.environ.get("OCR_ENGINE_DPI", "400"))
OCR_LANG = os.environ.get("OCR_ENGINE_LANG", "es")
USE_GPU = os.environ.get("OCR_ENGINE_USE_GPU", "0") == "1"

# Cuenta solo páginas que de verdad requieren el camino pesado (PP-Structure)
# -- las páginas digitales son baratas y no cuentan para este límite. Acota
# el tiempo total de una request síncrona (ver pdf_ocr_client.cpp/timeout del
# backend) sin bloquear documentos técnicos largos que sean mayormente
# digitales, que es el caso típico de este sistema.
MAX_OCR_PAGES = int(os.environ.get("OCR_ENGINE_MAX_OCR_PAGES", "80"))

_SUBSET_PREFIX_RE = re.compile(r"^[A-Z]{6}\+")

PAPER_SIZES_PT = {"A4": (595.0, 842.0), "A3": (842.0, 1191.0)}

_table_engine = None
_text_ocr_engine = None


def _get_table_engine():
    """Carga perezosa (y cacheada) de PPStructure -- pesado (~300-400MB de
    modelos), se hace UNA vez por proceso, no por request.

    lang='en' A PROPÓSITO, no OCR_LANG: PPStructure (paddleocr 2.7.3) resuelve
    el layout/tabla y el reconocimiento de texto a partir del MISMO parámetro
    `lang`, pero el modelo de LAYOUT solo existe para 'en'/'ch' -- pasar
    'es' (que internamente se resuelve al grupo 'latin' para reconocimiento)
    hace que la búsqueda del modelo de layout truene con `sys.exit(-1)`
    DENTRO de la librería (no una excepción capturable) apenas se
    instancia. Confirmado en vivo contra la wheel real (paddleocr==2.7.3):
    "lang latin is not support, we only support dict_keys(['en', 'ch']) for
    layout models". El layout (dónde está cada región: título/párrafo/tabla/
    figura) es razonablemente agnóstico del idioma real del documento -- lo
    que sí importa para "máxima calidad" en español es el RECONOCIMIENTO de
    texto, que se hace aparte con _get_text_ocr_engine() (lang=es real) sobre
    cada región de texto que PP-Structure ya localizó -- ver
    _extract_scanned_page. Las tablas quedan como limitación v1 documentada:
    su texto de celda sale del reconocimiento en inglés de PP-Structure, no
    del motor en español (ver ADR-199)."""
    global _table_engine
    if _table_engine is not None:
        return _table_engine
    from paddleocr import PPStructure

    log.info("cargando PPStructure (layout/tabla, lang=en, use_gpu=%s)...", USE_GPU)
    _table_engine = PPStructure(
        show_log=False,
        layout=True,
        table=True,
        ocr=True,
        lang="en",
        use_gpu=USE_GPU,
    )
    return _table_engine


def _get_text_ocr_engine():
    """Motor de reconocimiento de texto REAL en OCR_LANG (es por defecto) --
    separado de PPStructure a propósito, ver _get_table_engine. Se aplica
    sobre el recorte de cada región de texto que ya localizó PP-Structure, en
    vez de confiar en el reconocimiento en inglés que trae PP-Structure de
    fábrica."""
    global _text_ocr_engine
    if _text_ocr_engine is not None:
        return _text_ocr_engine
    from paddleocr import PaddleOCR

    log.info("cargando PaddleOCR (texto, lang=%s, use_gpu=%s)...", OCR_LANG, USE_GPU)
    _text_ocr_engine = PaddleOCR(
        show_log=False,
        lang=OCR_LANG,
        use_angle_cls=True,
        use_gpu=USE_GPU,
    )
    return _text_ocr_engine


def _ocr_region_lines(img_bgr: np.ndarray, bbox) -> List[Tuple[str, float, Tuple[int, int, int, int]]]:
    """Recorta `bbox` (región de layout de PP-Structure, en píxeles) y
    reconoce sus LÍNEAS con el motor en OCR_LANG real (no el de PP-Structure,
    ver _get_text_ocr_engine). Devuelve [(texto, confianza, caja_px)] con la
    caja ya en coordenadas de la página completa -- el camino de réplica
    posiciona cada línea en su lugar real. Nunca lanza: una región que falla
    vuelve vacía en vez de tumbar la página."""
    # Margen antes de recortar -- el bbox de layout de PP-Structure a veces
    # queda justo al borde del glifo (confirmado en vivo: cercenaba la
    # primera letra de una línea real).
    pad_x = max(4, int((bbox[2] - bbox[0]) * 0.02))
    pad_y = max(4, int((bbox[3] - bbox[1]) * 0.15))
    x0, y0, x1, y1 = [int(v) for v in bbox]
    x0, y0 = max(x0 - pad_x, 0), max(y0 - pad_y, 0)
    x1 = min(x1 + pad_x, img_bgr.shape[1])
    y1 = min(y1 + pad_y, img_bgr.shape[0])
    if x1 - x0 < 4 or y1 - y0 < 4:
        return []
    crop = img_bgr[y0:y1, x0:x1]
    try:
        result = _get_text_ocr_engine().ocr(crop, cls=True)
    except Exception:
        log.exception("OCR de región de texto falló")
        return []
    out: List[Tuple[str, float, Tuple[int, int, int, int]]] = []
    for line in (result[0] if result and result[0] else []):
        try:
            points, (text, conf) = line[0], line[1]
        except Exception:
            continue
        text = (text or "").strip()
        if not text:
            continue
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        box = (int(min(xs)) + x0, int(min(ys)) + y0, int(max(xs)) + x0, int(max(ys)) + y0)
        out.append((text, float(conf) if isinstance(conf, (int, float)) else 0.0, box))
    out.sort(key=lambda t: (t[2][1], t[2][0]))
    return out


class TooManyOcrPagesError(Exception):
    def __init__(self, scanned_pages: int, limit: int):
        super().__init__(f"too_many_scanned_pages: {scanned_pages} > {limit}")
        self.scanned_pages = scanned_pages
        self.limit = limit


def _pixmap_to_bgr(pix: "fitz.Pixmap") -> np.ndarray:
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        return cv2.cvtColor(arr, cv2.COLOR_RGBA2BGR)
    if pix.n == 3:
        return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)


# ── Fidelidad: helpers compartidos por el camino digital y el de OCR ───────

def _color_hex(color_int: Optional[int]) -> Optional[str]:
    if color_int is None:
        return None
    try:
        return f"#{int(color_int) & 0xFFFFFF:06x}"
    except (TypeError, ValueError):
        return None


# Reparación de ligaduras rotas del texto digital (hallazgo real probando
# esta importación con 2 PDFs reales, no documentado en ADR-199): algunas
# fuentes incrustadas (subset) codifican la ligadura tipográfica "ti" (y en
# un caso "fí") con un glifo propio SIN una entrada ToUnicode correcta -- el
# lector de PDF (PyMuPDF acá, cualquier otro lector real también) cae a lo
# que sea que el subset haya dejado en esa posición del cmap. Confirmado en
# vivo con 2 documentos reales distintos, cada uno con su propio glifo de
# reemplazo para la MISMA ligadura rota:
#   - reglamento (MINEM): "•"/"!"/"#" + un espacio espurio -- "ac• vidades",
#     "Ges! ón", "ar# culo" (~780 palabras corrompidas en un documento de 68
#     páginas).
#   - importacion (MINEM): "Ɵ"/"ơ" (glifos latinos extendidos reciclados,
#     Vietnamese Latin Extended-B, SIN espacio) -- "LegislaƟvo", "Arơculo"
#     (~1539 palabras corrompidas en un documento de 92 páginas).
# "Ɵ"/"ơ"/"İ" no aparecen NUNCA en español real -- reemplazo directo y
# global, sin riesgo de falso positivo. "•"/"!"/"#" SÍ son caracteres
# legítimos en otros contextos (viñeta de lista al inicio de línea,
# exclamación real, numeral) -- se limita a la posición MEDIO DE PALABRA
# (letra pegada antes, letra después de un espacio opcional) que es
# exactamente el patrón que produce esta fuente rota y nunca el de un uso
# legítimo de esos caracteres.
_BROKEN_TI_GLYPHS = {"Ɵ": "ti", "ơ": "ti"}  # Ɵ, ơ
_BROKEN_FI_GLYPHS = {"İ": "fí"}  # İ -- capital I con punto, en vez de "fí"
# Dos reglas separadas, no una sola -- distinto riesgo de falso positivo por
# carácter (ver hallazgo real de abajo):
# - "•": excluye SOLO el marcador sintético de "inicio real de línea/bloque"
#   (ver `_repair_span_in_context`) -- una viñeta de lista genuina siempre
#   está ahí, nunca en medio de línea, así que el carácter ANTERIOR real
#   (letra O espacio) puede preceder la ligadura rota -- "tiene"/"tipo"/
#   "título"/"tiempo" la tienen como PRIMERA sílaba de la palabra, precedida
#   por un espacio de palabra normal, no por una letra pegada (confirmado en
#   vivo: sin permitir espacio antes, ~13% de las apariciones reales de "•"
#   quedaban sin reparar).
# - "!"/"#": esos SÍ son signos de puntuación legítimos con un espacio real
#   antes en prosa normal ("¡Cuidado! el piso...") -- permitir espacio antes
#   arriesgaría corromper una exclamación real. Se mantienen con la regla
#   original más estricta (pegado directo a una letra, sin espacio antes).
_LINE_START_SENTINEL = "\x00"
# `(?<!\d)`: encontrado en vivo -- "D.S. N° 042•2017•EM" (un número de norma
# real, "042-2017-EM") tiene el MISMO glifo roto representando un GUION, no
# la ligadura "ti", en el segundo guion (precedido por un dígito, seguido de
# letras "EM"). Un dígito pegado antes nunca es el inicio real de "ti"/
# "tiene"/etc, así que excluirlo recupera este caso sin arriesgar los reales.
_TI_ARTIFACT_BULLET_RE = re.compile(r"(?<!" + _LINE_START_SENTINEL + r")(?<!\d)• ?(?=[A-Za-zÀ-ÿﬀ-ﬄ]|-$)")
_TI_ARTIFACT_STRICT_RE = re.compile(r"(?<=[A-Za-zÀ-ÿ])[!#] ?(?=[A-Za-zÀ-ÿﬀ-ﬄ])")
_DASH_ARTIFACT_RE = re.compile(r"(?<=\d)•(?=\d)")
_FI_SPACE_RE = re.compile(r"(fi|fl) (?=[a-záéíóúñü])")
# Tercer glifo de reemplazo de la misma ligadura rota en el Reglamento:
# comilla recta + espacio ('ar" culos', 'ac" vidades', 'cer" fi cación').
# Una comilla de CIERRE real tiene el mismo aspecto ('el "Reglamento" de'),
# así que se exige que no haya una comilla de APERTURA antes en el texto.
_QUOTE_TI_RE = re.compile(r'(?<=[a-záéíóúñü])" (?=[a-záéíóúñü])')
_OPEN_QUOTE_RE = re.compile(r'(^|[\s(\[])["“](?=\w)')


def _repair_quote_ti(text: str) -> str:
    if '"' not in text:
        return text
    out: List[str] = []
    last = 0
    for m in _QUOTE_TI_RE.finditer(text):
        if _OPEN_QUOTE_RE.search(text, 0, m.start()):
            continue
        out.append(text[last:m.start()])
        out.append("ti")
        last = m.end()
    out.append(text[last:])
    return "".join(out)


_LIGATURE_SPACE_FIX = {
    "ﬀ": "ff",
    "ﬁ": "fi",
    "ﬂ": "fl",
    "ﬃ": "ffi",
    "ﬄ": "ffl",
}


def _repair_unconditional(text: str) -> str:
    """Solo la parte de `_repair_ligature_artifacts` que NUNCA necesita mirar
    alrededor (Ɵ/ơ/İ no aparecen jamás en español real, reemplazo directo
    sin importar la posición) -- separada de la parte contextual (•/!/#)
    porque `_repair_span_in_context` necesita aplicar ESTA mitad al contexto
    prestado de un span vecino ANTES de envolver (ver ahí el porqué)."""
    if not text:
        return text
    for broken, fixed in _BROKEN_TI_GLYPHS.items():
        if broken in text:
            text = text.replace(broken, fixed)
    for broken, fixed in _BROKEN_FI_GLYPHS.items():
        if broken in text:
            text = text.replace(broken, fixed)
    return text


def _repair_ligature_artifacts(text: str) -> str:
    """Aplica las 3 reparaciones de arriba, en orden -- ver el comentario
    largo. Idempotente y barata (unos pocos `replace`/`sub` por texto de
    bloque), se aplica al texto de cada span digital Y de cada celda de
    tabla (la misma fuente rota puede aparecer en cualquiera de los dos)."""
    if not text:
        return text
    text = _repair_unconditional(text)
    # "042•2017•EM" (D.S. N° 042-2017-EM): el mismo glifo roto entre dígitos
    # es un GUION, no la ligadura "ti".
    text = _DASH_ARTIFACT_RE.sub("-", text)
    text = _TI_ARTIFACT_BULLET_RE.sub("ti", text)
    text = _TI_ARTIFACT_STRICT_RE.sub("ti", text)
    for lig, fixed in _LIGATURE_SPACE_FIX.items():
        if lig not in text:
            continue
        # El glifo de ligadura real (ej. 'ﬁ') puede traer el mismo espacio
        # espurio inmediatamente después que el caso •/!/# -- se colapsa solo
        # cuando reconecta con una palabra real (letra minúscula siguiente).
        text = re.sub(re.escape(lig) + r" (?=[A-Za-zÀ-ÿﬀ-ﬄ])", fixed, text)
        text = text.replace(lig, fixed)
    return text


def _repair_span_in_context(span_text: str, prev_span_text: str, next_span_text: str) -> str:
    """Como `_repair_ligature_artifacts`, pero resuelve el caso real (visto
    en vivo en el PDF de prueba "reglamento") donde PyMuPDF corta la
    ligadura rota y el texto de un lado en DOS spans distintos -- ej. un
    span termina en "...iden•" (o "...iden• ") y el siguiente empieza en
    "ficación..." -- cada span reparado EN AISLAMIENTO no ve la letra del
    otro lado y el patrón queda sin resolver (confirmado en vivo: sin este
    contexto cruzado, ~13% de las apariciones reales quedaban intactas).
    Toma 1 carácter prestado del span anterior (para el "letra antes de la
    viñeta rota") y hasta 2 del siguiente (para el "letra después, con
    espacio opcional") -- el contexto prestado nunca es el glifo roto que
    ESTE span repara, solo da lookaround, así que se descuenta del resultado
    por longitud.

    Bug real encontrado en vivo (PDF "importacion", palabra "titular" partida
    por PyMuPDF en los spans ['Vocal ', 'Ɵtular']): si el contexto prestado
    se pasa CRUDO y el largo para recortar se calcula ANTES de reparar, un
    Ɵ/ơ/İ que cae justo en el contexto prestado (ej. next_ctx = 'Ɵt', las 2
    primeras letras de 'Ɵtular') se reemplaza igual (1 carácter -> 2), pero
    el recorte sigue usando el largo VIEJO -- sobra 1 letra pegada al span
    ("Vocal t" en vez de "Vocal "). Se repara el contexto prestado con
    `_repair_unconditional` (nunca necesita mirar alrededor) ANTES de armar
    `wrapped`, así su largo post-reparación -- el que de verdad importa -- es
    el que se usa para recortar."""
    prev_raw = prev_span_text[-1:] if prev_span_text else _LINE_START_SENTINEL
    next_raw = next_span_text[:2]
    prev_ctx = _repair_unconditional(prev_raw)
    next_ctx = _repair_unconditional(next_raw)
    wrapped = prev_ctx + span_text + next_ctx
    repaired = _repair_ligature_artifacts(wrapped)
    end = len(repaired) - len(next_ctx) if next_ctx else len(repaired)
    return repaired[len(prev_ctx):end]


def _closest_paper_size(width_pt: float, height_pt: float) -> str:
    w, h = (width_pt, height_pt) if width_pt <= height_pt else (height_pt, width_pt)
    best, best_dist = "A4", float("inf")
    for label, (pw, ph) in PAPER_SIZES_PT.items():
        dist = abs(w - pw) + abs(h - ph)
        if dist < best_dist:
            best, best_dist = label, dist
    return best


def _heading_level_from_ratio(ratio: float) -> Optional[str]:
    """`ratio` = tamaño del párrafo / tamaño "cuerpo" típico de la página.
    Umbrales elegidos para no marcar como encabezado un párrafo apenas más
    grande (nota al pie con superíndice, etc.) -- necesita una diferencia
    real, no cualquier variación menor."""
    if ratio >= 1.8:
        return "h1"
    if ratio >= 1.5:
        return "h2"
    if ratio >= 1.3:
        return "h3"
    return None


# ── Réplica de página (ADR-209) ──────────────────────────────────────────
#
# Pedido explícito 2026-09-23: la importación debe ser una RÉPLICA EXACTA
# del PDF de origen, sin objetos superpuestos. El modelo anterior (un bloque
# por párrafo PyMuPDF, reacomodado por el editor con otra fuente/otro
# interlineado, tablas reconstruidas con 14px fijos, figuras sueltas con
# ajuste de texto 'square') producía, medido sobre un borrador real de 92
# páginas, 750 pares de elementos superpuestos y 37 cajas fuera de la hoja.
#
# Modelo nuevo, por página, en DOS capas:
#   1. Fondo: la página renderizada SIN el texto que se va a emitir como
#      editable (redacción de solo texto: imágenes, dibujos vectoriales,
#      bordes/sombreado de tabla, subrayados, gráficos y texto rotado quedan
#      intactos, en su posición y orden de apilado exactos). Se omite si la
#      página queda en blanco.
#   2. Texto editable: una caja por grupo de líneas con la MISMA alineación
#      y el MISMO interlineado real, posicionada por la línea base real de
#      su primera línea (no por el bbox del bloque), con los saltos de línea
#      originales explícitos -- el editor nunca re-envuelve el texto, así que
#      no puede crecer ni invadir la caja vecina. Un hueco horizontal grande
#      dentro de una misma línea (columnas, tabulaciones, índice con número
#      de página a la derecha, celdas de tabla) parte la línea en segmentos
#      independientes, cada uno en su x real.

# Resolución del fondo: 144 DPI = 1.5x la resolución de pantalla del lienzo
# (96 DPI) -- nítido al 150% de zoom y en impresión normal, sin que un
# documento de 100+ páginas supere el tope de respuesta (64MB en el backend,
# ver pdf_ocr_client.cpp).
REPLICA_BG_DPI = int(os.environ.get("OCR_ENGINE_BG_DPI", "144"))
# Un fondo mayormente vectorial (líneas, sombreados planos) comprime mejor y
# sin artefactos en PNG; uno fotográfico pesa varias veces más en PNG que
# en JPEG sin diferencia visible -- se elige por tamaño real resultante.
BG_PNG_MAX_BYTES = int(os.environ.get("OCR_ENGINE_BG_PNG_MAX_BYTES", "350000"))
BG_JPEG_QUALITY = int(os.environ.get("OCR_ENGINE_BG_JPEG_QUALITY", "84"))

# Flags de extracción: sin TEXT_PRESERVE_IMAGES (las imágenes van en el
# fondo, no hace falta traer sus bytes acá) y sin TEXT_PRESERVE_LIGATURES
# (MuPDF expande "ﬁ"/"ﬂ" a sus letras -- la reparación de ligaduras ROTAS
# de más arriba sigue haciendo falta para los glifos sin ToUnicode).
_RAWDICT_FLAGS = fitz.TEXT_PRESERVE_WHITESPACE | fitz.TEXT_MEDIABOX_CLIP

_WEIGHT_SUFFIX_RE = re.compile(
    r"[-, ]?(ExtraLight|UltraLight|Light|Thin|Book|Regular|Roman|Medium|SemiBold|Semibold|DemiBold|Demibold|"
    r"ExtraBold|UltraBold|Bold|Black|Heavy|Italic|Oblique|MT|PS|PSMT)$",
    re.IGNORECASE,
)
_BOLD_NAME_RE = re.compile(r"bold|black|heavy|semibold|demibold", re.IGNORECASE)

# Nombre de fuente PDF -> familia CSS que el navegador realmente tiene (o su
# equivalente métrico más cercano). Sin esto, "TimesNewRomanPSMT" o
# "ArialNarrow" caían a la fuente por defecto del navegador, con anchos de
# carácter distintos -- la línea medía más que el original y se montaba
# sobre la columna/celda vecina.
_FONT_ALIASES: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"arial.?narrow|helvetica.?narrow|helvetica.?condensed", re.I), "Arial Narrow"),
    (re.compile(r"times|tinos|liberation.?serif|nimbus.?rom", re.I), "Times New Roman, serif"),
    (re.compile(r"arial|helvetica|arimo|liberation.?sans|nimbus.?sans", re.I), "Arial"),
    (re.compile(r"courier|cousine|liberation.?mono|nimbus.?mono", re.I), "Courier New, monospace"),
    (re.compile(r"calibri|carlito", re.I), "Calibri"),
    (re.compile(r"cambria|caladea", re.I), "Cambria, serif"),
    (re.compile(r"georgia", re.I), "Georgia, serif"),
    (re.compile(r"verdana", re.I), "Verdana"),
    (re.compile(r"tahoma", re.I), "Tahoma"),
    (re.compile(r"trebuchet", re.I), "Trebuchet MS"),
    (re.compile(r"segoe.?ui", re.I), "Segoe UI"),
    (re.compile(r"century.?gothic", re.I), "Century Gothic"),
    (re.compile(r"garamond", re.I), "Garamond, serif"),
    (re.compile(r"book.?antiqua|palatino", re.I), "Palatino Linotype, serif"),
    (re.compile(r"franklin.?gothic", re.I), "Franklin Gothic Medium"),
    (re.compile(r"gill.?sans", re.I), "Gill Sans MT"),
    (re.compile(r"consolas", re.I), "Consolas, monospace"),
    (re.compile(r"symbol", re.I), "Symbol"),
]


def _css_font_family(raw_name: Optional[str], flags: int) -> str:
    """Familia CSS con genérico de respaldo según los flags reales de la
    fuente (serif/monoespaciada), así una fuente propietaria no instalada
    cae a una de la MISMA clase (serif con serif) en vez de a la del
    navegador por defecto."""
    name = _SUBSET_PREFIX_RE.sub("", raw_name or "")
    # El bit "serif" (4) del descriptor NO es confiable -- hallazgo real:
    # Roboto (sans) viene marcada serif en la guía CEPLAN. Se decide por
    # nombre; el bit de monoespaciada sí es confiable.
    if flags & 8 or re.search(r"mono|courier|consol", name, re.IGNORECASE):
        generic = "monospace"
    elif re.search(r"serif", name, re.IGNORECASE) and not re.search(r"sans", name, re.IGNORECASE):
        generic = "serif"
    else:
        generic = "sans-serif"
    for pattern, alias in _FONT_ALIASES:
        if pattern.search(name):
            return alias if "," in alias else f"{alias}, sans-serif"
    prev = None
    while prev != name:
        prev = name
        name = _WEIGHT_SUFFIX_RE.sub("", name)
    name = name.strip("-, ")
    if name and " " not in name:
        # "OpenSans" -> "Open Sans", "SourceSansPro" -> "Source Sans Pro"
        name = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name)
    return f"{name}, {generic}" if name else generic


def _replica_span_style(span: Dict[str, Any]) -> Dict[str, Any]:
    flags = span.get("flags", 0) or 0
    font = span.get("font", "") or ""
    return {
        "bold": bool(flags & 16) or bool(_BOLD_NAME_RE.search(font)),
        "italic": bool(flags & 2) or bool(re.search(r"italic|oblique", font, re.IGNORECASE)),
        "color": _color_hex(span.get("color")),
        "font_size": round(float(span.get("size") or 0), 2) or None,
        "font_family": _css_font_family(font, flags),
    }


class _Segment:
    """Tramo horizontal continuo de UNA línea (sin huecos grandes adentro),
    con su línea base real y sus corridas de estilo."""

    __slots__ = ("runs", "x0", "x1", "y0", "y1", "baseline", "size", "text", "spans")

    def __init__(self, runs: List[Tuple[str, Dict[str, Any]]], x0: float, x1: float, y0: float, y1: float,
                 baseline: float, size: float):
        self.runs = runs
        self.x0, self.x1, self.y0, self.y1 = x0, x1, y0, y1
        self.baseline = baseline
        self.size = size
        self.text = ""
        self.spans: List[Dict[str, Any]] = []

    @property
    def mid(self) -> float:
        return (self.x0 + self.x1) / 2.0


def _build_segment(chars: List[Tuple[Dict[str, Any], Dict[str, Any]]]) -> Optional[_Segment]:
    """`chars` = [(char_rawdict, span_rawdict)] contiguos de una línea. Recorta
    espacios en los extremos (su bbox no es tinta visible) y arma las
    corridas de estilo reparando ligaduras rotas con contexto de corrida
    vecina (ver `_repair_span_in_context`)."""
    while chars and not chars[0][0].get("c", "").strip():
        chars = chars[1:]
    while chars and not chars[-1][0].get("c", "").strip():
        chars = chars[:-1]
    if not chars:
        return None
    runs: List[Tuple[str, Dict[str, Any]]] = []
    for ch, span in chars:
        c = ch.get("c", "")
        if runs and runs[-1][1] is span:
            runs[-1] = (runs[-1][0] + c, span)
        else:
            runs.append((c, span))
    x0 = min(ch["bbox"][0] for ch, _ in chars)
    x1 = max(ch["bbox"][2] for ch, _ in chars)
    y0 = min(ch["bbox"][1] for ch, _ in chars)
    y1 = max(ch["bbox"][3] for ch, _ in chars)
    size_votes: Dict[float, int] = {}
    for ch, span in chars:
        sz = round(float(span.get("size") or 0), 2)
        size_votes[sz] = size_votes.get(sz, 0) + 1
    size = max(size_votes.items(), key=lambda kv: kv[1])[0] or 10.0
    # Línea base = origen del primer carácter con el tamaño dominante (un
    # superíndice/subíndice al inicio tiene su propia línea base desplazada).
    baseline = next((ch["origin"][1] for ch, span in chars if round(float(span.get("size") or 0), 2) == size),
                    chars[0][0]["origin"][1])
    seg = _Segment(runs, x0, x1, y0, y1, baseline, size)
    cursor = 0
    parts: List[str] = []
    for idx, (run_text, span) in enumerate(runs):
        prev_raw = runs[idx - 1][0] if idx > 0 else ""
        next_raw = runs[idx + 1][0] if idx + 1 < len(runs) else ""
        fixed = _repair_span_in_context(run_text, prev_raw, next_raw)
        # Reparaciones que cambian el largo del texto: se aplican DENTRO de la
        # corrida (no con contexto prestado de la vecina, cuyo recorte asume
        # largo fijo). MuPDF expande "ﬁ"/"ﬂ" pero la fuente deja un espacio
        # espurio detrás ("modifi cación", "fi nal") -- ninguna palabra
        # española termina en "fi"/"fl" suelto antes de una minúscula.
        fixed = _FI_SPACE_RE.sub(lambda m: m.group(1), _repair_quote_ti(fixed))
        if not fixed:
            continue
        parts.append(fixed)
        seg.spans.append({"start": cursor, "end": cursor + len(fixed), **_replica_span_style(span)})
        cursor += len(fixed)
    seg.text = "".join(parts)
    if not seg.text.strip():
        return None
    return seg


def _line_segments(line: Dict[str, Any]) -> List[_Segment]:
    """Parte una línea horizontal en segmentos por huecos grandes (más de
    ~1.5 em entre la tinta de un carácter y el siguiente): columnas, tabuladores,
    celdas de tabla, número de página de un índice (umbral 1.5 em: el espacio
    de una línea justificada holgada no llega a eso). Cada segmento se
    posiciona por separado en su x real."""
    chars: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for span in line.get("spans", []):
        if span.get("alpha", 255) == 0:  # texto invisible (capa OCR de un PDF escaneado)
            continue
        if not span.get("size"):
            continue
        for ch in span.get("chars", []):
            chars.append((ch, span))
    segments: List[_Segment] = []
    current: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    last_ink_x1: Optional[float] = None
    for ch, span in chars:
        if ch.get("c") == "	":
            # Un tabulador es un salto de posición, no un ancho de carácter:
            # el editor lo dibujaría con su propio ancho de tab y correría todo
            # lo que sigue. Se corta el segmento y el texto siguiente se
            # posiciona en su x real.
            seg = _build_segment(current)
            if seg:
                segments.append(seg)
            current, last_ink_x1 = [], None
            continue
        is_space = not ch.get("c", "").strip()
        if not is_space and last_ink_x1 is not None:
            gap = ch["bbox"][0] - last_ink_x1
            if gap > max(4.0, 1.5 * float(span.get("size") or 10)):
                seg = _build_segment(current)
                if seg:
                    segments.append(seg)
                current = []
        current.append((ch, span))
        if not is_space:
            last_ink_x1 = ch["bbox"][2]
    seg = _build_segment(current)
    if seg:
        segments.append(seg)
    return segments


class _TextGroup:
    """Líneas consecutivas de un mismo párrafo visual: mismo tamaño, paso de
    línea constante y el MISMO x inicial. No se agrupan líneas centradas ni
    alineadas a la derecha con x distintos (hallazgo real, Reglamento p. 28:
    un párrafo justificado con sangría francesa "27.1 ..." tiene el borde
    DERECHO parejo y se tomaba como "alineado a la derecha" -- con la fuente
    de pantalla cada línea se corría). Cada línea suelta o que llega al borde
    derecho de su caja se estira a su ancho original exacto (ver
    `_group_to_block`), así que un título centrado o una firma alineada a la
    derecha, en cajas de una línea, quedan igual de exactos."""

    def __init__(self, seg: _Segment):
        self.segs = [seg]

    @property
    def pitch(self) -> Optional[float]:
        if len(self.segs) < 2:
            return None
        return (self.segs[-1].baseline - self.segs[0].baseline) / (len(self.segs) - 1)

    def accepts(self, seg: _Segment) -> bool:
        last = self.segs[-1]
        first = self.segs[0]
        ratio = seg.size / last.size if last.size else 1.0
        if ratio < 0.85 or ratio > 1.18:
            return False
        dy = seg.baseline - last.baseline
        size = max(seg.size, last.size)
        if dy < 0.7 * size or dy > 2.0 * size:
            return False
        pitch = self.pitch
        if pitch is not None and abs(dy - pitch) > 0.12 * pitch + 0.5:
            return False
        return abs(seg.x0 - first.x0) <= max(1.5, 0.2 * size)

    def add(self, seg: _Segment) -> None:
        self.segs.append(seg)


def _page_segments(raw: Dict[str, Any], kept_rects: List[Tuple[float, float, float, float]]) -> List[_Segment]:
    """Segmentos horizontales editables de la página. `kept_rects` recibe la
    caja de cada línea que NO se emite (texto rotado/vertical) -- esa tinta
    se repone en el fondo desde el render original (ver
    `_extract_replica_page`)."""
    segments: List[_Segment] = []
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            dx, dy = line.get("dir", (1.0, 0.0))
            if line.get("wmode", 0) != 0 or abs(dy) > 0.02 or dx <= 0:
                # Texto rotado/vertical (etiquetas de eje de un gráfico,
                # sellos): el editor no lo reproduciría girado con
                # exactitud -- queda como imagen en el fondo, tal cual.
                kept_rects.append(tuple(line.get("bbox", (0, 0, 0, 0))))
                continue
            segments.extend(_line_segments(line))
    return segments


def _group_segments(segments: List[_Segment]) -> List[_TextGroup]:
    """Agrupa líneas en párrafos visuales a nivel de PÁGINA, no de bloque
    PyMuPDF -- hallazgo real: ReglamentoProteccionAmbiental.pdf emite cada
    línea como un bloque propio, así que agrupar dentro del bloque dejaba
    cada renglón suelto. Cada segmento se une al grupo compatible (ver
    `_TextGroup.accepts`) cuya última línea esté más cerca por arriba."""
    groups: List[_TextGroup] = []
    active: List[_TextGroup] = []
    for seg in sorted(segments, key=lambda sg: (sg.baseline, sg.x0)):
        active = [g for g in active if seg.baseline - g.segs[-1].baseline <= 2.0 * max(seg.size, g.segs[-1].size)]
        best: Optional[_TextGroup] = None
        best_key: Tuple[float, float] = (float("inf"), float("inf"))
        for g in active:
            last = g.segs[-1]
            if seg.baseline - last.baseline < 0.7 * max(seg.size, last.size):
                continue  # misma línea visual
            if seg.x1 < min(sg.x0 for sg in g.segs) or seg.x0 > max(sg.x1 for sg in g.segs):
                continue  # otra columna
            if not g.accepts(seg):
                continue
            key = (seg.baseline - last.baseline, abs(seg.x0 - g.segs[0].x0))
            if key < best_key:
                best, best_key = g, key
        if best is not None:
            best.add(seg)
        else:
            best = _TextGroup(seg)
            groups.append(best)
            active.append(best)
    return groups


def _group_to_block(group: _TextGroup) -> Dict[str, Any]:
    text_parts: List[str] = []
    spans: List[Dict[str, Any]] = []
    cursor = 0
    size_votes: Dict[float, int] = {}
    group_x1 = max(sg.x1 for sg in group.segs)
    for idx, seg in enumerate(group.segs):
        if idx:
            text_parts.append("\n")
            cursor += 1
            # Ligadura "ti" rota al inicio de una línea que continúa una palabra
            # cortada con guion ("an-" / "• cipada", Reglamento p. 64): la regla
            # general no la toca al inicio de línea (ahí una viñeta real es
            # legítima), pero una viñeta real nunca sigue a un guion de corte
            # ni va seguida de minúscula. "• " -> "ti" conserva el largo, así
            # que los tramos de estilo no se corren.
            if group.segs[idx - 1].text.rstrip().endswith("-") and re.match(r"• [a-záéíóúñü]", seg.text):
                seg.text = "ti" + seg.text[2:]
        text_parts.append(seg.text)
        for sp in seg.spans:
            spans.append({**sp, "start": sp["start"] + cursor, "end": sp["end"] + cursor})
            if sp.get("font_size"):
                size_votes[sp["font_size"]] = size_votes.get(sp["font_size"], 0) + (sp["end"] - sp["start"])
        # Línea que llega al borde derecho de su caja (justificada, o la única
        # línea de la caja): la fuente de pantalla mide distinto que la del PDF,
        # así que se marca 'justify' para que el editor la estire EXACTAMENTE
        # a su ancho original -- mismo inicio y mismo final que en el PDF.
        if " " in seg.text.strip() and group_x1 - seg.x1 <= max(1.0, 0.1 * seg.size):
            spans.append({"start": cursor, "end": cursor + len(seg.text), "text_align": "justify"})
        cursor += len(seg.text)
    dominant = max(size_votes.items(), key=lambda kv: kv[1])[0] if size_votes else group.segs[0].size
    first = group.segs[0]
    pitch = group.pitch or max(first.y1 - first.y0, dominant * 1.15)
    x0 = min(s.x0 for s in group.segs)
    x1 = max(s.x1 for s in group.segs)
    y0 = min(s.y0 for s in group.segs)
    y1 = max(s.y1 for s in group.segs)
    block: Dict[str, Any] = {
        "type": "paragraph",
        "text": "".join(text_parts),
        "spans": spans,
        "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
        "layout": {
            "baseline_pt": round(first.baseline, 2),
            "pitch_pt": round(pitch, 2),
            "font_size_pt": round(dominant, 2),
            "line_count": len(group.segs),
        },
    }
    return block


def _assign_headings(blocks: List[Dict[str, Any]], toc_entries: List[Tuple[str, int]]) -> None:
    """Marca encabezados (Tabla de Contenidos del editor): primero por el
    esquema/marcadores reales del PDF, si no por tamaño relativo al cuerpo
    de la página -- mismo criterio que la v1 (ADR-199 §7)."""
    votes: Dict[float, int] = {}
    for b in blocks:
        sz = b["layout"]["font_size_pt"]
        votes[sz] = votes.get(sz, 0) + len(b["text"])
    body = max(votes.items(), key=lambda kv: kv[1])[0] if votes else None
    toc_norm = [(re.sub(r"\s+", " ", t).strip().lower(), lvl) for t, lvl in toc_entries]
    for b in blocks:
        norm = re.sub(r"\s+", " ", b["text"]).strip().lower()
        heading = None
        for title, level in toc_norm:
            if title and len(norm) >= 3 and (norm.startswith(title[:40]) or title.startswith(norm[:40])):
                heading = f"h{min(max(level, 1), 6)}"
                break
        if heading is None and body and len(b["text"]) < 120 and not re.fullmatch(r"[\d\s.,/-]+", b["text"]):
            heading = _heading_level_from_ratio(b["layout"]["font_size_pt"] / body)
        if heading:
            b["heading_style"] = heading


def _encode_background(img_bgr: np.ndarray) -> Optional[Dict[str, Any]]:
    """PNG si el fondo es liviano (vectorial), JPEG si es fotográfico -- ver
    BG_PNG_MAX_BYTES. `None` si la página quedó en blanco (nada que
    reproducir detrás del texto)."""
    if img_bgr.size == 0 or int(img_bgr.min()) >= 250:
        return None
    ok, png = cv2.imencode(".png", img_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    if ok and len(png) <= BG_PNG_MAX_BYTES:
        return {"image_base64": base64.b64encode(png.tobytes()).decode("ascii"), "mime": "image/png"}
    ok, jpg = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, BG_JPEG_QUALITY])
    if not ok:
        return None
    return {"image_base64": base64.b64encode(jpg.tobytes()).decode("ascii"), "mime": "image/jpeg"}


def _rotate_rawdict(raw: Dict[str, Any], matrix: "fitz.Matrix") -> None:
    """Página con /Rotate (hallazgo real: las 68 páginas de
    ReglamentoProteccionAmbiental.pdf tienen /Rotate 90): PyMuPDF entrega el
    texto en coordenadas SIN rotar, con dirección (0,-1) -- visualmente
    horizontal, pero todo el texto se descartaba como "rotado" (0 bloques).
    Se lleva todo (bbox, origen, dirección) al espacio visible de la hoja."""
    def rect(b):
        r = fitz.Rect(b) * matrix
        return (r.x0, r.y0, r.x1, r.y1)

    lin = fitz.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, 0, 0)
    for block in raw.get("blocks", []):
        if block.get("type") != 0:
            continue
        block["bbox"] = rect(block["bbox"])
        for line in block.get("lines", []):
            line["bbox"] = rect(line["bbox"])
            d = fitz.Point(line.get("dir", (1.0, 0.0))) * lin
            line["dir"] = (d.x, d.y)
            for span in line.get("spans", []):
                span["bbox"] = rect(span["bbox"])
                o = fitz.Point(span["origin"]) * matrix
                span["origin"] = (o.x, o.y)
                for ch in span.get("chars", []):
                    ch["bbox"] = rect(ch["bbox"])
                    o = fitz.Point(ch["origin"]) * matrix
                    ch["origin"] = (o.x, o.y)


def _extract_replica_page(page: "fitz.Page", bg_page: "fitz.Page",
                          toc_entries: List[Tuple[str, int]]) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """Página digital (o sin texto) en modo réplica: (bloques de texto
    editables, fondo sin ese texto). `bg_page` es la MISMA página en una copia
    aparte del documento -- la redacción la modifica."""
    raw = page.get_text("rawdict", flags=_RAWDICT_FLAGS)
    if page.rotation:
        _rotate_rawdict(raw, page.rotation_matrix)
    kept_rects: List[Tuple[float, float, float, float]] = []
    segments = _page_segments(raw, kept_rects)

    # Fondo = la página SIN NINGÚN texto. Se borra todo de una vez, no línea
    # por línea: hallazgo real (Reglamento, hoja 14, reportado por el
    # usuario), al redactar solo PARTE de un objeto de texto con
    # posicionamiento relativo, MuPDF reescribe lo que queda corrido ~34pt
    # hacia abajo -- la tinta que sobrevivía aparecía duplicada y montada
    # sobre la barra gris del pie. Sin texto restante no hay nada que se
    # pueda correr.
    original = _pixmap_to_bgr(page.get_pixmap(dpi=REPLICA_BG_DPI, alpha=False))
    has_text = any(b.get("type") == 0 for b in raw.get("blocks", []))
    if has_text:
        full = bg_page.rect * bg_page.derotation_matrix if bg_page.rotation else bg_page.rect
        bg_page.add_redact_annot(full + (-50, -50, 50, 50), fill=False, cross_out=False)
        bg_page.apply_redactions(
            images=fitz.PDF_REDACT_IMAGE_NONE,
            graphics=fitz.PDF_REDACT_LINE_ART_NONE,
            text=fitz.PDF_REDACT_TEXT_REMOVE,
        )
        bg = _pixmap_to_bgr(bg_page.get_pixmap(dpi=REPLICA_BG_DPI, alpha=False))
    else:
        bg = original
    if kept_rects and bg.shape == original.shape:
        # Texto que no se emite como editable (rotado): se copia su recorte
        # exacto del render original al fondo.
        zoom = REPLICA_BG_DPI / 72.0
        for x0, y0, x1, y1 in kept_rects:
            px0, py0 = max(int(x0 * zoom) - 1, 0), max(int(y0 * zoom) - 1, 0)
            px1, py1 = min(int(x1 * zoom) + 2, bg.shape[1]), min(int(y1 * zoom) + 2, bg.shape[0])
            if px1 > px0 and py1 > py0:
                bg[py0:py1, px0:px1] = original[py0:py1, px0:px1]
    # Solo se emite el texto que de verdad SE VE en el original. Hallazgo
    # real (portada de la guía CEPLAN): "GUÍA DE POLÍTICAS NACIONALES" está en
    # la capa de texto pero una imagen dibujada DESPUÉS la tapa por completo
    # -- sacarlo al frente como editable lo mostraba encima del logo. Si en
    # la caja de la línea el render original no difiere del fondo sin texto,
    # no hay tinta visible (tapada, blanco sobre blanco, fuera del recorte):
    # se descarta.
    if segments and bg.shape == original.shape:
        segments = [sg for sg in segments if _segment_has_visible_ink(sg, original, bg)]
    groups = _group_segments(segments)
    blocks = [_group_to_block(g) for g in groups]
    _assign_headings(blocks, toc_entries)
    # Orden de lectura: arriba-abajo, izquierda-derecha (bandas de 2pt).
    blocks.sort(key=lambda b: (round(b["layout"]["baseline_pt"] / 2.0), b["bbox"][0]))
    background = _encode_background(bg)
    return blocks, background


def _segment_has_visible_ink(seg: _Segment, original: np.ndarray, background: np.ndarray) -> bool:
    zoom = REPLICA_BG_DPI / 72.0
    x0, y0 = max(int(seg.x0 * zoom), 0), max(int(seg.y0 * zoom), 0)
    x1, y1 = min(int(seg.x1 * zoom) + 1, original.shape[1]), min(int(seg.y1 * zoom) + 1, original.shape[0])
    if x1 <= x0 or y1 <= y0:
        return False
    diff = cv2.absdiff(original[y0:y1, x0:x1], background[y0:y1, x0:x1]).max(axis=2)
    changed = int((diff > 40).sum())
    # Un punto o una coma a 144 DPI ya son varios píxeles; el umbral solo
    # descarta ruido de antialiasing de bordes vecinos.
    return changed >= max(4, int(0.002 * diff.size))


# ── Página escaneada (OCR real) ─────────────────────────────────────────

def _page_is_scanned_document(page: "fitz.Page") -> bool:
    """Página sin texto digital que ES un documento escaneado (papel con
    texto), no una foto/portada de diseño: una imagen cubre casi toda la
    hoja, el fondo es mayormente claro y casi sin color saturado. Una
    portada o una fotografía a toda página se reproduce tal cual como fondo
    (correrle OCR borraría su diseño para superponer texto aproximado --
    hallazgo real: portada de ReglamentoProteccionAmbiental.pdf y la foto
    de la página 10 de la guía CEPLAN)."""
    page_area = abs(page.rect) or 1.0
    covered = 0.0
    for info in page.get_image_info():
        r = fitz.Rect(info.get("bbox")) & page.rect
        covered = max(covered, abs(r))
    if covered < 0.8 * page_area:
        return False
    pix = page.get_pixmap(dpi=40, alpha=False)
    bgr = _pixmap_to_bgr(pix)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    light = float((hsv[:, :, 2] > 200).mean())
    colored = float(((hsv[:, :, 1] > 90) & (hsv[:, :, 2] > 60)).mean())
    return light >= 0.6 and colored < 0.04


def _estimate_text_color(img_bgr: np.ndarray, box: Tuple[int, int, int, int]) -> Optional[str]:
    x0, y0, x1, y1 = box
    crop = img_bgr[max(y0, 0):max(y1, 0), max(x0, 0):max(x1, 0)]
    if crop.size == 0:
        return None
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    ink = crop[gray <= np.percentile(gray, 15)]
    if ink.size == 0:
        return None
    b, g, r = [int(v) for v in np.median(ink.reshape(-1, 3), axis=0)]
    return f"#{r:02x}{g:02x}{b:02x}"


def _extract_scanned_page(img_bgr: np.ndarray, dpi: int) -> tuple:
    """OCR real vía PP-StructureV2 (layout) + PaddleOCR en OCR_LANG (líneas
    con su caja). Devuelve (blocks, confianza_promedio, error, fondo) --
    mismo contrato de bloque que el camino digital, con el fondo = el propio
    escaneo con las líneas reconocidas borradas (inpainting), así el texto
    editable no queda duplicado sobre el texto impreso."""
    engine = _get_table_engine()
    try:
        regions = engine(img_bgr)
    except Exception as ex:  # noqa: BLE001
        log.exception("PP-Structure falló sobre la página rasterizada")
        return ([], None, str(ex), None)

    px_to_pt = 72.0 / dpi
    confidences: List[float] = []
    segments: List[_Segment] = []
    mask = np.zeros(img_bgr.shape[:2], dtype=np.uint8)

    for region in regions:
        rtype = (region.get("type") or "").lower()
        if rtype in ("figure", "image"):
            continue  # se conserva en el fondo tal cual
        lines = _ocr_region_lines(img_bgr, region.get("bbox") or [0, 0, 0, 0])
        for text, conf, (lx0, ly0, lx1, ly1) in lines:
            confidences.append(conf)
            h = ly1 - ly0
            size_pt = max(4.0, h * px_to_pt / 1.15)
            color = _estimate_text_color(img_bgr, (lx0, ly0, lx1, ly1))
            seg = _Segment([], lx0 * px_to_pt, lx1 * px_to_pt, ly0 * px_to_pt, ly1 * px_to_pt,
                           (ly0 + 0.8 * h) * px_to_pt, round(size_pt, 1))
            seg.text = text
            seg.spans = [{"start": 0, "end": len(text), "bold": False, "italic": False, "color": color,
                          "font_size": round(size_pt, 1), "font_family": "Arial, sans-serif"}]
            pad = max(2, int(h * 0.12))
            cv2.rectangle(mask, (max(lx0 - pad, 0), max(ly0 - pad, 0)), (lx1 + pad, ly1 + pad), 255, -1)
            segments.append(seg)

    blocks = [_group_to_block(g) for g in _group_segments(segments)]
    _assign_headings(blocks, [])
    blocks.sort(key=lambda b: (round(b["layout"]["baseline_pt"] / 2.0), b["bbox"][0]))

    cleaned = cv2.inpaint(img_bgr, mask, 5, cv2.INPAINT_TELEA) if mask.any() else img_bgr
    scale = REPLICA_BG_DPI / float(dpi)
    if scale < 1.0:
        cleaned = cv2.resize(cleaned, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    background = _encode_background(cleaned)
    avg_conf = round(sum(confidences) / len(confidences), 4) if confidences else None
    return (blocks, avg_conf, None, background)


def _page_geometry(width_pt: float, height_pt: float) -> Dict[str, Any]:
    """Tamaño real de la página de origen y la hoja estándar del editor más
    cercana (el editor solo tiene A4/A3). El frontend escala TODO (posición
    Y tamaño de fuente) con un único factor uniforme -- nunca deforma."""
    return {
        "width_pt": round(width_pt, 2),
        "height_pt": round(height_pt, 2),
        "paper_size": _closest_paper_size(width_pt, height_pt),
        "orientation": "landscape" if width_pt > height_pt else "portrait",
    }


def extract_image_structured(file_bytes: bytes, dpi: Optional[int] = None) -> Dict[str, Any]:
    """Imagen raster (PNG/JPG/BMP) como documento OCR de una sola página --
    mismo contrato que extract_pdf_structured. La página se mide en puntos
    con el DPI lógico del OCR."""
    dpi = dpi or DEFAULT_OCR_DPI
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img_bgr is None or img_bgr.size == 0:
        return {"ok": False, "error": "invalid_image"}
    height_px, width_px = img_bgr.shape[:2]
    try:
        blocks, avg_conf, error, background = _extract_scanned_page(img_bgr, dpi)
    except Exception as ex:  # noqa: BLE001
        log.exception("fallo procesando imagen OCR")
        blocks, avg_conf, error, background = ([], None, str(ex), None)
    page: Dict[str, Any] = {
        "page_number": 1,
        "source": "ocr",
        "layout": "replica",
        "confidence": avg_conf,
        "blocks": blocks,
        "page_geometry": _page_geometry(width_px * 72.0 / dpi, height_px * 72.0 / dpi),
    }
    if background:
        page["background"] = background
    if error:
        page["error"] = error
    return {"ok": True, "page_count": 1, "pages": [page]}


def extract_pdf_structured(file_bytes: bytes, dpi: Optional[int] = None) -> Dict[str, Any]:
    dpi = dpi or DEFAULT_OCR_DPI
    doc = fitz.open(stream=file_bytes, filetype="pdf")
    # Copia aparte para el fondo: la redacción de texto modifica la página.
    bg_doc = fitz.open(stream=file_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        scanned: List[bool] = []
        for page in doc:
            raw_text = page.get_text("text") or ""
            scanned.append(len(raw_text.strip()) < MIN_DIGITAL_CHARS and _page_is_scanned_document(page))
        if sum(scanned) > MAX_OCR_PAGES:
            raise TooManyOcrPagesError(sum(scanned), MAX_OCR_PAGES)

        # Esquema/marcadores reales del PDF (cuando existen) -- la señal más
        # confiable de encabezado real, agrupada por página de destino.
        toc_by_page: Dict[int, List[Tuple[str, int]]] = {}
        try:
            for level, title, dest_page in doc.get_toc(simple=True):
                toc_by_page.setdefault(dest_page, []).append((title, level))
        except Exception as ex:  # noqa: BLE001 -- esquema roto/ausente no debe tumbar la importación
            log.warning("get_toc falló, se continúa sin esquema real: %s", ex)

        pages_out: List[Dict[str, Any]] = []
        for page_index in range(page_count):
            page = doc[page_index]
            rect = page.rect
            page_out: Dict[str, Any] = {
                "page_number": page_index + 1,
                "layout": "replica",
                "page_geometry": _page_geometry(rect.width, rect.height),
            }
            try:
                if scanned[page_index]:
                    pix = page.get_pixmap(dpi=dpi, alpha=False)
                    blocks, avg_conf, error, background = _extract_scanned_page(_pixmap_to_bgr(pix), dpi)
                    page_out.update({"source": "ocr", "confidence": avg_conf})
                    if error:
                        page_out["error"] = error
                else:
                    blocks, background = _extract_replica_page(
                        page, bg_doc[page_index], toc_by_page.get(page_index + 1, [])
                    )
                    page_out.update({"source": "digital", "confidence": None})
            except Exception as ex:  # noqa: BLE001 -- una página no debe tumbar todo el documento
                log.exception("fallo procesando página %d", page_index + 1)
                blocks, background = [], None
                page_out.update({"source": "digital", "confidence": None, "error": str(ex)})
            page_out["blocks"] = blocks
            if background:
                page_out["background"] = background
            pages_out.append(page_out)

        return {"ok": True, "page_count": page_count, "pages": pages_out}
    finally:
        doc.close()
        bg_doc.close()
