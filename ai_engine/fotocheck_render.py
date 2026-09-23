"""
fotocheck_render.py — composición server-side de la credencial (fotocheck):
foto real + QR (del string YA CIFRADO que manda el backend C++, ver
fotocheck_crypto.hpp) + Nombres / Apellidos / Documento de identidad.

Rediseño 2026-09-23:
- El encabezado muestra la EMPRESA MINERA del usuario (`fields.tenant_name`,
  resuelto por el backend desde tenants.tenant_name), ya no "BEEMETRY".
- Solo tres datos visibles: nombres, apellidos y documento de identidad.
  Correo/celular/cargo/empresa salen de la tarjeta (el QR cifrado sigue
  llevando el payload completo que ya usaba el escaneo/precarga).
- Color de la tarjeta por ÁREA DE TRABAJO, derivada del rol de plataforma del
  usuario (`fields.role`, mismos 7 roles de kValidPlatformRoles en
  auth_routes.cpp) -- ver _AREA_THEMES.

Render con Pillow (instalado en Dockerfile.ai en el paso --no-deps junto a
python-pptx, NO vía requirements.txt -- ver comentario ahí) y la familia
tipográfica Inter (paquete Debian fonts-inter, OFL). Si Inter no está (imagen
anterior a este cambio), cae a DejaVu Sans, que viene con la imagen base. El
paquete `qrcode` se usa SOLO para el algoritmo de codificación
(`QRCode.get_matrix()`); los módulos se pintan a mano, sin su factory de
imagen.

Este módulo nunca ve el payload en claro del QR: recibe el string ya
cifrado (`qr_payload`) desde el backend y solo lo codifica visualmente.
"""
import io
import os

import cv2
import numpy as np
import qrcode
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# Proporción CR80 (85.6 x 54 mm, vertical) a ~420 dpi.
CARD_W = 900
CARD_H = 1428

# Tamaño del QR acotado a [_QR_MIN_PX, _QR_MAX_PX] sin importar cuántos
# módulos tenga -- el payload cifrado (nonce+ciphertext+tag en base64) es
# notablemente más largo que un string de prueba corto, así que a `box_size`
# fijo el QR real salía mucho más grande y se metía sobre los campos de texto
# (visto en la prueba E2E real). Se genera a 1px/módulo y se escala por un
# factor ENTERO con NEAREST (bordes duros, todos los módulos iguales); el
# panel blanco se dimensiona sobre el tamaño resultante.
_QR_TARGET_PX = 300
_QR_MIN_PX = 250
_QR_MAX_PX = 330

_INK = (17, 24, 39)          # texto principal
_MUTED = (100, 116, 139)     # rótulos
_HAIRLINE = (226, 232, 240)
_PAPER = (255, 255, 255)
_PAPER_TINT = (248, 250, 252)

# Área de trabajo por rol de plataforma. `deep`/`mid` = degradado del
# encabezado y banda inferior; `accent` = filete y detalles. Paletas
# elegidas para contraste AA de texto blanco sobre `deep` y `mid`.
_AREA_THEMES = {
    "admin": {
        "area": "ADMINISTRACIÓN",
        "deep": (11, 31, 58), "mid": (30, 58, 110), "accent": (212, 175, 55),
    },
    "manager": {
        "area": "GERENCIA",
        "deep": (17, 17, 17), "mid": (52, 52, 56), "accent": (201, 162, 39),
    },
    "supervisor": {
        "area": "SUPERVISIÓN DE OPERACIONES",
        "deep": (12, 45, 110), "mid": (29, 78, 216), "accent": (125, 211, 252),
    },
    "geologist": {
        "area": "GEOLOGÍA Y GEOTECNIA",
        "deep": (58, 38, 26), "mid": (120, 80, 48), "accent": (232, 196, 146),
    },
    "safety": {
        "area": "SEGURIDAD Y SALUD OCUPACIONAL",
        "deep": (4, 71, 52), "mid": (4, 120, 87), "accent": (110, 231, 183),
    },
    "operator": {
        "area": "OPERACIONES MINA",
        "deep": (124, 45, 18), "mid": (194, 65, 12), "accent": (253, 224, 71),
    },
    "viewer": {
        "area": "VISITANTE",
        "deep": (51, 65, 85), "mid": (100, 116, 139), "accent": (203, 213, 225),
    },
}
_DEFAULT_THEME = {
    "area": "PERSONAL AUTORIZADO",
    "deep": (30, 41, 59), "mid": (71, 85, 105), "accent": (148, 163, 184),
}

_FONT_DIRS = (
    "/usr/share/fonts/opentype/inter",
    "/usr/share/fonts/truetype/dejavu",
)
_FONT_FILES = {
    # peso -> (Inter, fallback DejaVu)
    "display": ("InterDisplay-ExtraBold.otf", "DejaVuSans-Bold.ttf"),
    "bold": ("Inter-Bold.otf", "DejaVuSans-Bold.ttf"),
    "semibold": ("Inter-SemiBold.otf", "DejaVuSans-Bold.ttf"),
    "medium": ("Inter-Medium.otf", "DejaVuSans.ttf"),
}
_font_cache: dict = {}


def _font(weight: str, size: int) -> ImageFont.FreeTypeFont:
    key = (weight, size)
    if key in _font_cache:
        return _font_cache[key]
    for name in _FONT_FILES[weight]:
        for d in _FONT_DIRS:
            path = os.path.join(d, name)
            if os.path.isfile(path):
                f = ImageFont.truetype(path, size)
                _font_cache[key] = f
                return f
    f = ImageFont.load_default(size=size)
    _font_cache[key] = f
    return f


def theme_for_role(role: str) -> dict:
    return _AREA_THEMES.get((role or "").strip().lower(), _DEFAULT_THEME)


# ── Primitivas ──────────────────────────────────────────────────────────────

def _qr_image(data: str, target_px: int = _QR_TARGET_PX, border: int = 0) -> Image.Image:
    """QR de `data` de lado ~`target_px` (ver _QR_TARGET_PX). El margen
    blanco (quiet zone) lo pone el panel que lo contiene, no la matriz."""
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M,
                       border=border, box_size=1)
    qr.add_data(data)
    qr.make(fit=True)
    matrix = np.array(qr.get_matrix(), dtype=bool)
    img = np.where(matrix, 0, 255).astype(np.uint8)
    # Escala ENTERA por módulo (con un factor fraccionario NEAREST deja
    # columnas de 3 y 4 px mezcladas, que los lectores de celular toleran
    # peor): el entero más cercano a target_px/n que respete [MIN, MAX].
    n = matrix.shape[0]
    k = max(1, round(target_px / n))
    while k > 1 and n * k > _QR_MAX_PX:
        k -= 1
    while n * (k + 1) <= _QR_MAX_PX and n * k < _QR_MIN_PX:
        k += 1
    if n * k < _QR_MIN_PX:  # payload enorme: último recurso, escala fraccionaria
        return Image.fromarray(img, "L").resize((_QR_MIN_PX,) * 2, Image.NEAREST).convert("RGB")
    return Image.fromarray(img, "L").resize((n * k, n * k), Image.NEAREST).convert("RGB")


def _vertical_gradient(w: int, h: int, top: tuple, bottom: tuple) -> Image.Image:
    t = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    rows = np.array(top, np.float32) * (1 - t) + np.array(bottom, np.float32) * t
    arr = np.repeat(rows[:, None, :], w, axis=1).astype(np.uint8)
    return Image.fromarray(arr, "RGB")


def _diagonal_gradient(w: int, h: int, a: tuple, b: tuple) -> Image.Image:
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip((xs / w) * 0.45 + (ys / h) * 0.55, 0, 1)[..., None]
    arr = np.array(a, np.float32) * (1 - t) + np.array(b, np.float32) * t
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def _rounded_mask(w: int, h: int, r: int) -> Image.Image:
    # Supersampling 4x para bordes suaves.
    s = 4
    m = Image.new("L", (w * s, h * s), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, w * s - 1, h * s - 1), r * s, fill=255)
    return m.resize((w, h), Image.LANCZOS)


def _shadow(canvas: Image.Image, box: tuple, radius: int, blur: int, offset: int,
            opacity: int) -> None:
    x0, y0, x1, y1 = box
    pad = blur * 3
    w, h = x1 - x0, y1 - y0
    layer = Image.new("L", (w + pad * 2, h + pad * 2), 0)
    ImageDraw.Draw(layer).rounded_rectangle((pad, pad, pad + w, pad + h), radius, fill=opacity)
    layer = layer.filter(ImageFilter.GaussianBlur(blur))
    black = Image.new("RGB", layer.size, (15, 23, 42))
    canvas.paste(black, (x0 - pad, y0 - pad + offset), layer)


def _tracked(draw: ImageDraw.ImageDraw, xy: tuple, text: str, font, fill,
             tracking: float, anchor: str = "l") -> int:
    """Texto con espaciado entre letras (tracking, en px). `anchor`: l/c/r
    horizontal sobre la línea base superior `xy[1]`. Devuelve el ancho."""
    widths = [draw.textlength(ch, font=font) for ch in text]
    total = sum(widths) + tracking * max(0, len(text) - 1)
    x, y = xy
    if anchor == "c":
        x -= total / 2
    elif anchor == "r":
        x -= total
    for ch, cw in zip(text, widths):
        draw.text((x, y), ch, font=font, fill=fill)
        x += cw + tracking
    return int(total)


def _tracked_width(draw, text, font, tracking) -> float:
    return sum(draw.textlength(ch, font=font) for ch in text) + tracking * max(0, len(text) - 1)


def _fit_lines(draw, text: str, weight: str, max_w: int, max_lines: int,
               start: int, minimum: int, tracking_em: float = 0.0):
    """Mayor tamaño de fuente (start→minimum) con el que `text` entra en
    `max_lines` líneas de `max_w`. Devuelve (font, lines, tracking_px). Si ni
    al mínimo entra, recorta la última línea con elipsis."""
    words = text.split()
    for size in range(start, minimum - 1, -2):
        font = _font(weight, size)
        tr = size * tracking_em
        lines, cur = [], ""
        for wd in words:
            cand = f"{cur} {wd}".strip()
            if _tracked_width(draw, cand, font, tr) <= max_w:
                cur = cand
            else:
                if cur:
                    lines.append(cur)
                cur = wd
        if cur:
            lines.append(cur)
        if len(lines) <= max_lines and all(_tracked_width(draw, ln, font, tr) <= max_w for ln in lines):
            return font, lines, tr
    font = _font(weight, minimum)
    tr = minimum * tracking_em
    lines = lines[:max_lines]
    last = lines[-1]
    while last and _tracked_width(draw, last + "…", font, tr) > max_w:
        last = last[:-1]
    lines[-1] = last.rstrip() + "…"
    return font, lines, tr


def _initials(name: str) -> str:
    stop = {"DE", "DEL", "LA", "LAS", "LOS", "Y", "S.A.", "SA", "SAC", "S.A.C.", "SAA",
            "S.A.A.", "EIRL", "SRL", "CIA", "CÍA", "COMPAÑÍA", "COMPANIA", "MINERA"}
    parts = [p for p in name.upper().replace(",", " ").split() if p not in stop]
    if not parts:
        parts = name.upper().split()
    return "".join(p[0] for p in parts[:2]) or "•"


# ── Composición ─────────────────────────────────────────────────────────────

def generate_fotocheck_image(photo_bytes: bytes, qr_payload: str, fields: dict) -> bytes:
    """Compone la tarjeta completa. `fields` trae claves snake_case -- mismas
    que arma buildFotocheckFields en fotocheck_routes.cpp; aquí solo se usan
    tenant_name/company (encabezado), role (área/color), first_name,
    last_name y dni. Devuelve bytes PNG; nunca falla por datos faltantes."""
    theme = theme_for_role(str(fields.get("role", "")))
    deep, mid, accent = theme["deep"], theme["mid"], theme["accent"]
    company = (str(fields.get("tenant_name") or "").strip()
               or str(fields.get("company") or "").strip()
               or "EMPRESA MINERA")
    first = str(fields.get("first_name") or "").strip() or "—"
    last = str(fields.get("last_name") or "").strip() or "—"
    dni = str(fields.get("dni") or "").strip() or "—"

    card = Image.new("RGB", (CARD_W, CARD_H), _PAPER)
    draw = ImageDraw.Draw(card)

    # ── Encabezado: degradado del área + textura diagonal sutil ──
    header_h = 372
    header = _diagonal_gradient(CARD_W, header_h, deep, mid)
    tex = Image.new("L", (CARD_W, header_h), 0)
    td = ImageDraw.Draw(tex)
    for x in range(-header_h, CARD_W + header_h, 26):
        td.line((x, header_h, x + header_h, 0), fill=14, width=2)
    header.paste(Image.new("RGB", header.size, (255, 255, 255)), (0, 0), tex)
    # Arco decorativo grande (profundidad sin ruido visual)
    arc = Image.new("L", (CARD_W, header_h), 0)
    ImageDraw.Draw(arc).ellipse((CARD_W - 360, -260, CARD_W + 320, 420), fill=22)
    header.paste(Image.new("RGB", header.size, (255, 255, 255)), (0, 0), arc)
    card.paste(header, (0, 0))

    # Monograma de la empresa (placa con iniciales)
    mono = _initials(company)
    mx, my, ms = 56, 50, 64
    mono_layer = Image.new("RGB", (ms, ms), accent)
    card.paste(mono_layer, (mx, my), _rounded_mask(ms, ms, 14))
    mf = _font("bold", 28 if len(mono) > 1 else 32)
    draw.text((mx + ms / 2, my + ms / 2 + 1), mono, font=mf, fill=deep, anchor="mm")

    _tracked(draw, (mx + ms + 20, my + 8), "CREDENCIAL DE IDENTIFICACIÓN",
             _font("semibold", 17), (255, 255, 255), 3.2)
    _tracked(draw, (mx + ms + 20, my + 36), "ACCESO A PLATAFORMA MINERA",
             _font("medium", 15), tuple(int(c * 0.55 + 255 * 0.45) for c in accent), 2.6)

    # Nombre de la empresa: hasta 2 líneas, tamaño auto-ajustado.
    # Una línea grande si entra; si no, dos líneas con techo de 48px para que
    # el bloque no toque el marco de la foto (que empieza en y=290).
    cfont, clines, ctr = _fit_lines(draw, company.upper(), "display", CARD_W - 112, 1,
                                    60, 42, tracking_em=0.01)
    if clines[-1].endswith("…"):
        cfont, clines, ctr = _fit_lines(draw, company.upper(), "display", CARD_W - 112, 2,
                                        48, 28, tracking_em=0.01)
    line_h = int(cfont.size * 1.1)
    cy = 158 if len(clines) == 1 else 142
    for i, ln in enumerate(clines):
        _tracked(draw, (56, cy + i * line_h), ln, cfont, (255, 255, 255), ctr)
    bar_y = cy + len(clines) * line_h + 16
    draw.rounded_rectangle((56, bar_y, 56 + 72, bar_y + 6), 3, fill=accent)

    # ── Foto: marco blanco que monta sobre el encabezado ──
    pw, ph = 344, 412
    px = (CARD_W - pw) // 2
    py = 300
    frame = 10
    fbox = (px - frame, py - frame, px + pw + frame, py + ph + frame)
    _shadow(card, fbox, 30, 18, 10, 90)
    fw, fh = fbox[2] - fbox[0], fbox[3] - fbox[1]
    card.paste(Image.new("RGB", (fw, fh), _PAPER), fbox[:2], _rounded_mask(fw, fh, 30))
    photo = None
    if photo_bytes:
        arr = cv2.imdecode(np.frombuffer(photo_bytes, np.uint8), cv2.IMREAD_COLOR)
        if arr is not None:
            photo = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))
    if photo is not None:
        scale = max(pw / photo.width, ph / photo.height)
        rs = photo.resize((max(pw, int(photo.width * scale + 0.5)),
                           max(ph, int(photo.height * scale + 0.5))), Image.LANCZOS)
        ox, oy = (rs.width - pw) // 2, (rs.height - ph) // 2
        photo = rs.crop((ox, oy, ox + pw, oy + ph))
    else:
        photo = _vertical_gradient(pw, ph, _PAPER_TINT, _HAIRLINE)
    card.paste(photo, (px, py), _rounded_mask(pw, ph, 22))
    # Filete del área bajo la foto
    draw.rounded_rectangle((px + pw // 2 - 40, py + ph + frame + 18,
                            px + pw // 2 + 40, py + ph + frame + 23), 3, fill=mid)

    # ── Datos: Nombres / Apellidos / Documento + QR ──
    left = 64
    top = 800
    qr = _qr_image(qr_payload)
    qs = qr.width
    q_pad = 18
    qx1 = CARD_W - 60
    qx0 = qx1 - qs - q_pad * 2
    col_w = qx0 - left - 28  # la columna de datos nunca invade el panel QR
    label_font = _font("semibold", 16)

    def field(y: int, label: str, value: str, weight: str, start: int, max_lines: int) -> int:
        _tracked(draw, (left, y), label, label_font, _MUTED, 2.8)
        vf, vlines, vtr = _fit_lines(draw, value, weight, col_w, max_lines, start, 24)
        vy = y + 30
        lh = int(vf.size * 1.12)
        for i, ln in enumerate(vlines):
            _tracked(draw, (left, vy + i * lh), ln, vf, _INK, vtr)
        return vy + len(vlines) * lh

    y = field(top, "NOMBRES", first.upper(), "bold", 42, 2)
    y = field(y + 34, "APELLIDOS", last.upper(), "bold", 42, 2)
    doc_label_y = y + 34
    _tracked(draw, (left, doc_label_y), "DOCUMENTO DE IDENTIDAD", label_font, _MUTED, 2.8)
    # Chip "DNI" + número con tracking amplio (lectura rápida en garita)
    chip_y = doc_label_y + 32
    chip_f = _font("bold", 17)
    chip_w = int(draw.textlength("DNI", font=chip_f)) + 24
    draw.rounded_rectangle((left, chip_y + 4, left + chip_w, chip_y + 36), 8, fill=deep)
    draw.text((left + chip_w / 2, chip_y + 20), "DNI", font=chip_f, fill=(255, 255, 255),
              anchor="mm")
    num_font, num_lines, num_tr = _fit_lines(draw, dni, "bold", col_w - chip_w - 16, 1, 40,
                                             24, tracking_em=0.08)
    _tracked(draw, (left + chip_w + 16, chip_y - 2), num_lines[0], num_font, _INK, num_tr)

    # Panel QR
    qy0 = top - 6
    qy1 = qy0 + qs + q_pad * 2
    _shadow(card, (qx0, qy0, qx1, qy1), 22, 12, 6, 45)
    card.paste(Image.new("RGB", (qx1 - qx0, qy1 - qy0), _PAPER), (qx0, qy0),
               _rounded_mask(qx1 - qx0, qy1 - qy0, 22))
    draw.rounded_rectangle((qx0, qy0, qx1, qy1), 22, outline=_HAIRLINE, width=2)
    card.paste(qr, (qx0 + q_pad, qy0 + q_pad))
    _tracked(draw, ((qx0 + qx1) / 2, qy1 + 18), "ACCESO DIGITAL SEGURO",
             _font("semibold", 14), _MUTED, 2.4, anchor="c")

    # ── Banda inferior del área de trabajo ──
    band_h = 150
    band_y = CARD_H - band_h
    card.paste(_diagonal_gradient(CARD_W, band_h, mid, deep), (0, band_y))
    draw.rectangle((0, band_y, CARD_W, band_y + 6), fill=accent)
    _tracked(draw, (CARD_W / 2, band_y + 36), "ÁREA DE TRABAJO", _font("semibold", 15),
             tuple(int(c * 0.5 + 255 * 0.5) for c in accent), 4.0, anchor="c")
    afont, alines, atr = _fit_lines(draw, theme["area"], "display", CARD_W - 120, 1, 40, 24,
                                    tracking_em=0.06)
    _tracked(draw, (CARD_W / 2, band_y + 66), alines[0], afont, (255, 255, 255), atr,
             anchor="c")

    buf = io.BytesIO()
    card.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
