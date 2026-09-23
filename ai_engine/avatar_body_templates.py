"""Catálogo de cuerpos/vestimenta pre-hechos para el avatar (rediseño
2026-09-20, pedido explícito del usuario): "recortar la cabeza, el resto del
cuerpo sera una imagen pregardasa que el usuario puede seleccionar de un
listado de vestimenta".

Por qué plantillas dibujadas por código y no otra foto/diffusión:
- Diffusión (SD1.5, avatar_engine) no puede generar de forma confiable un
  "cuerpo sin cara"/maniquí -- el modelo insiste en pintar una cara donde no
  se le pide una, mismo tipo de comportamiento no confiable ya documentado
  para logos/texto en avatar_engine/avatar_diffusion.py (_NEGATIVE_PROMPT
  excluye "logo" desde ADR-164 por la misma razón: pedirle a SD1.5 algo que
  no renderiza bien da ruido, no el resultado esperado).
- El problema que se busca resolver es exactamente "dejar de depender de
  segmentar hombros/ropa fotografiados" (ver eye_analyzer.py::_head_only_mask
  y el historial de incidentes en avatar_animation_engine/matting.py) -- una
  plantilla dibujada por código tiene alfa perfecto por construcción (nunca
  hay ambigüedad de borde), cero costo de GPU y cero riesgo de licencia
  (nada de arte de terceros).

Geometría: cada plantilla es un lienzo 3:4 (mismo aspect ratio que el
compuesto final, 768x1024 / 2880x3840) con una silueta de torso/hombros y una
apertura de cuello en una posición conocida (`neck_center_x_frac`,
`neck_top_y_frac`, `neck_width_frac`). `compose_head_on_template()` escala el
recorte de cabeza real del usuario para que el ANCHO de su propio cuello
coincida con `neck_width_frac` y lo pega con el borde inferior exactamente en
`neck_top_y_frac` -- geometría determinística, sin el centroide/heurística de
`_compose_avatar_canvas` (que existe para absorber encuadres de foto
impredecibles; ya no aplica acá porque el cuerpo ya no viene de una foto).
"""
from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_LOGO_PATH = os.path.join(_APP_DIR, "assets", "beemetry-logo-hex.png")
# Texturas de tela (pedido explícito del usuario, 2026-09-21): recortes
# limpios (sin logo/texto/costura) de una foto real de uniformes que el
# propio usuario mandó de referencia -- NO generadas por código, NO de
# ningún club/marca (esa foto no tenía ninguno; es la de uniformes de mina
# genéricos). Convertidas a un mapa de luminancia tileable y aplicadas por
# multiplicación sobre el color plano de cada plantilla (_fabric_texture_tile),
# para romper el look de "bloque de color liso" sin depender de difusión ni de
# una textura sintética dibujada por código.
_FABRIC_TEXTURE_PATHS = {
    "knit": os.path.join(_APP_DIR, "assets", "fabric_knit.png"),
    "smooth": os.path.join(_APP_DIR, "assets", "fabric_smooth.png"),
}
_fabric_texture_cache: dict = {}

# Metadatos de cada PNG de prenda REAL (ver BodyTemplate.real_asset_path):
# recorte al bounding box de contenido (alfa ya sin fondo, ver el proceso de
# GrabCut + filtro de saturación usado para generarlo) + posición del cuello
# DENTRO de ese recorte, medida a mano una sola vez sobre la imagen fuente
# (grid de coordenadas superpuesto, no adivinada). "neck_top_frac"/
# "neck_width_frac"/"neck_center_frac" son fracciones del ANCHO/ALTO del
# recorte, mismo significado que los campos neck_* de BodyTemplate pero
# relativos a esta imagen en vez de al lienzo final.
REAL_GARMENT_ASSETS = {
    # Catálogo de vestimenta reducido a solo fotos reales (pedido explícito
    # del usuario, 2026-09-21): "eliminar todas las camisetas y solo se
    # quede amarilla con brazos" + 8 prendas nuevas. Extracción de las 8
    # nuevas: GrabCut con dos métodos según el caso (ver comentarios de cada
    # una) -- fondo de estudio con vignette clara que a veces coincide de
    # color con partes BLANCAS de la prenda (bug real encontrado probando:
    # una máscara iniciada con un simple rectángulo dejaba huecos/halos en
    # las rayas o el cuello blancos) se resolvió sembrando GrabCut con un
    # mapa de TEXTURA local (tela real = trama/costuras, fondo = degradado
    # liso) en vez de solo color. Todas conservan antebrazos/manos reales
    # del modelo de stock (mismo criterio ya aceptado en
    # real_camiseta_amarilla_brazos) -- intentar excluir la piel por color
    # rompía la máscara del torso en fragmentos (probado y descartado).
    "real_camiseta_amarilla_brazos": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_amarilla_brazos.png"),
        "bbox": (0, 0, 864, 741),
        "neck_top_frac": 0.0026954177897574125,
        "neck_width_frac": 0.5757225433526012,
        "neck_center_frac": 0.5017341040462427,
        # Bug real probado con foto real (2026-09-21): "ancho máximo de
        # cualquier fila" funciona en maniquíes planos sin brazos, pero esta
        # trae antebrazos reales más anchos que los propios hombros (el
        # punto más ancho de toda la imagen queda en el codo/antebrazo) --
        # medido a mano en la fila justo debajo de la costura de hombro
        # (y=5..10 del recorte), no en el punto más ancho de toda la imagen.
        "shoulder_width_frac": 0.54,
    },
    "real_camiseta_diagonal_roja": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_diagonal_roja.png"),
        "bbox": (0, 0, 798, 731),
        "neck_top_frac": 0.00546448087431694,
        "neck_width_frac": 0.22403003754693368,
        "neck_center_frac": 0.49874843554443055,
        "shoulder_width_frac": 0.5994993742177722,
    },
    "real_camiseta_amarilla_verde": {
        # Re-extraída (pedido explícito del usuario, 2026-09-21: "te pedí que
        # lo integres con la imagen con cuello y brazos") -- la primera
        # extracción de esta prenda usó el método de máscara de borde simple
        # (sin semilla de textura), que en este caso concreto excluyó los
        # antebrazos reales del modelo de stock -- distinto de la foto de
        # referencia que el usuario mandó, que sí los mostraba. Re-extraída
        # con el mismo método de textura que ya conservó brazos en el resto
        # del lote (diagonal_roja, celeste_rayas, marino_rayas, celeste).
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_amarilla_verde.png"),
        "bbox": (0, 0, 798, 731),
        "neck_top_frac": 0.00546448087431694,
        "neck_width_frac": 0.26479289940828404,
        "neck_center_frac": 0.49874843554443055,
        "shoulder_width_frac": 0.6020025031289111,
    },
    "real_camiseta_celeste_rayas": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_celeste_rayas.png"),
        "bbox": (0, 0, 798, 731),
        "neck_top_frac": 0.00546448087431694,
        "neck_width_frac": 0.22403003754693368,
        "neck_center_frac": 0.49874843554443055,
        "shoulder_width_frac": 0.6445556946182729,
    },
    "real_camiseta_crema_marron": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_crema_marron.png"),
        "bbox": (0, 0, 701, 755),
        "neck_top_frac": 0.005291005291005291,
        "neck_width_frac": 0.36324786324786323,
        "neck_center_frac": 0.5049857549857549,
        "shoulder_width_frac": 0.7564102564102564,
    },
    "real_camiseta_marino_rayas": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_marino_rayas.png"),
        "bbox": (0, 0, 777, 731),
        "neck_top_frac": 0.00546448087431694,
        "neck_width_frac": 0.2994858611825193,
        "neck_center_frac": 0.4980719794344473,
        "shoulder_width_frac": 0.7467866323907455,
    },
    "real_camiseta_celeste": {
        "path": os.path.join(_APP_DIR, "assets", "real_camiseta_celeste.png"),
        "bbox": (0, 0, 682, 725),
        "neck_top_frac": 0.004132231404958678,
        "neck_width_frac": 0.34699853587115664,
        "neck_center_frac": 0.4970717423133236,
        "shoulder_width_frac": 0.7701317715959004,
    },
    # Chaqueta técnica con cuello alto/cerrado (cierre subido) -- a
    # diferencia de las camisetas de arriba, no tiene un escote abierto en V
    # o redondo, así que la medición automática (pensada para un escote
    # abierto) no aplica: cuello y hombros medidos a mano sobre la imagen
    # (ver artifacts de esta sesión, chaqueta_gridlines.png). Credencial con
    # foto/nombre de una persona RECORTADA (pedido explícito del usuario,
    # 2026-09-21) -- se rellenó con un degradado tomado de la propia tela
    # limpia de la chaqueta (no inpaint direccional: dejaba un artefacto de
    # "haz de luz", probado y descartado) antes de extraer esta imagen.
    "real_chaqueta_electronica": {
        "path": os.path.join(_APP_DIR, "assets", "real_chaqueta_electronica.png"),
        "bbox": (0, 0, 943, 1129),
        "neck_top_frac": 0.0,
        "neck_width_frac": 0.35,
        "neck_center_frac": 0.5,
        "shoulder_width_frac": 0.85,
    },
    # Chaleco con camisa a cuadros debajo -- la foto original mostraba las
    # dos manos del modelo sosteniendo herramientas contra el pecho (pedido
    # explícito del usuario de agregar esta prenda, pero esa pose no tiene
    # sentido reutilizada en el avatar de cualquier usuario). Se recortó
    # TODO lo que queda por debajo de donde empiezan a aparecer los dedos
    # (fila ~400 de la foto original) en vez de intentar borrar las manos --
    # _render_real_garment ya extiende la última fila con contenido hacia
    # abajo para prendas que no llegan al borde del lienzo, así que el
    # recorte corto se rellena solo sin inventar nada.
    "real_chaleco_geologo": {
        "path": os.path.join(_APP_DIR, "assets", "real_chaleco_geologo.png"),
        "bbox": (0, 0, 797, 362),
        "neck_top_frac": 0.01092896174863388,
        "neck_width_frac": 0.14912280701754385,
        "neck_center_frac": 0.4893483709273183,
        "shoulder_width_frac": 0.96,
    },
}
_real_garment_cache: dict = {}

# Directorio persistente (mismo criterio que diffusion_avatar_cache en
# docker-compose.yml): se renderizan una sola vez y sobreviven a recrear el
# contenedor -- volver a dibujarlas en cada arranque no cuesta caro (cv2 puro,
# <50ms), pero cachearlas evita divergencias si dos réplicas arrancan a la vez.
_TEMPLATE_CACHE_DIR = os.environ.get(
    "AVATAR_BODY_TEMPLATE_DIR", os.path.join(_APP_DIR, ".avatar_body_templates")
)

# Lienzo maestro de cada plantilla -- 3:4, suficiente resolución para escalar
# tanto al thumb (768x1024) como al maestro HD (2880x3840) sin artefactos
# visibles (son formas planas/degradados suaves, no fotografía).
TEMPLATE_MASTER_W = 1440
TEMPLATE_MASTER_H = 1920

_render_lock = threading.Lock()

# Límites de proporción cabeza/lienzo para compose_head_on_template() -- ver
# comentario en el clamp de `scale`, bug real probado con foto real
# (2026-09-20). Rango generoso (cabeza chica a cabeza grande real) pero que
# nunca deja que una medición de cuello mala infle o achique la cabeza a algo
# claramente no humano.
_MAX_HEAD_WIDTH_FRAC = 0.42
_MIN_HEAD_WIDTH_FRAC = 0.28


@dataclass(frozen=True)
class BodyTemplate:
    slug: str
    display_name: str
    garment: str
    base_color_bgr: tuple  # (B, G, R)
    accent_color_bgr: tuple
    secondary_color_bgr: tuple = (255, 255, 255)
    pattern: str = "solid"
    sleeve: str = "short"
    show_arms: bool = True
    logo_badge: bool = True
    neck_center_x_frac: float = 0.5
    neck_top_y_frac: float = 0.515
    # Bug real probado con foto real (2026-09-20, "la cabeza y la ropa no
    # cuadran... está muy alejada"): con 0.22 la apertura de cuello de la
    # plantilla salía más ANCHA que el cuello real medido de la foto ya
    # escalado -- quedaba un borde de la plantilla (trim + fondo) asomando a
    # los costados del cuello real, como una costura/hueco visible. Bajado a
    # 0.15: casi cualquier cuello real fotografiado, ya escalado por altura de
    # cabeza (ver compose_head_on_template), es más ancho que esto, así que
    # la piel real cubre toda la apertura sin dejar borde de plantilla visible.
    neck_width_frac: float = 0.15
    shoulder_width_frac: float = 0.74
    shoulder_drop_frac: float = 0.125  # cuánto del alto separa cuello de hombro ancho
    # Forma del escote (pedido explícito del usuario, 2026-09-20: "el cuello
    # es recto y eso está mal, debe ser más estético cuello redondo o en
    # forma de V") -- "round" = cuello redondo (polos/camisetas/casacas),
    # "v" = escote en V (camisas de vestir desabrochadas arriba).
    neckline: str = "round"
    # Textura de tela (pedido explícito del usuario, 2026-09-21: "se ve como
    # bloques de formas geométricas... como hecho con Paint"). Extraída de una
    # zona limpia (sin logo/texto/costura) de una foto real de uniforme que el
    # propio usuario mandó de referencia, no generada por código -- ver
    # ai_engine/assets/fabric_*.png y el comentario de _fabric_texture_tile()
    # más abajo para el detalle de licencia/procedencia. "knit" = punto fino
    # (polos/camisetas), "smooth" = tejido plano (camisas/casacas/chalecos).
    texture: str = "knit"
    # Prenda de FOTO REAL (pedido explícito del usuario, 2026-09-21: "usa los
    # modelos de vestimenta que te adjunto... quiero que hagas el montaje del
    # avatar" sobre una camiseta real que mandó, sin marca/logo real). Si se
    # setea, _load_or_render_template_master ignora _render_template (dibujo
    # por código) y en cambio recorta/escala este PNG real, alineando su
    # propio cuello (medido a mano una vez, ver REAL_GARMENT_ASSETS) contra
    # neck_top_y_frac/neck_width_frac/neck_center_x_frac de ESTE template --
    # así compose_head_on_template() no necesita saber si el cuerpo de abajo
    # es dibujado o una foto real, el contrato (master W x H con el cuello en
    # esa posición) es el mismo.
    real_asset_path: Optional[str] = None


# Catálogo fijo (mismo criterio que otros catálogos cerrados de este repo,
# p.ej. avatar_animation_job.kind CHECK IN (...) -- un conjunto chico y
# curado, no un sistema de carga de assets por el usuario). El slug de cada
# entrada es también el valor persistido en auth_users.avatar_body_template_slug
# (backend, ver db_scripts/113_avatar_body_template.sql) -- deben coincidir
# exactamente si se agregan/renombran plantillas.
TEMPLATES: tuple[BodyTemplate, ...] = (
    # Catálogo reducido a solo fotos reales (pedido explícito del usuario,
    # 2026-09-21: "eliminar todas las camisetas y solo se quede amarilla
    # con brazos" + 8 prendas nuevas) -- reemplaza COMPLETO el catálogo
    # anterior (procedural + fotos reales previas, ver git history de este
    # archivo si hace falta recuperar alguna). Todos usan
    # BodyTemplate.real_asset_path / _render_real_garment(), nunca la
    # silueta dibujada por código.
    #
    # Nota de licencia/marca (pedido EXPLÍCITO del usuario, decisión suya
    # tras ver la advertencia): 3 de estas 9 prendas (diagonal_roja,
    # celeste_rayas, marino_rayas) replican el diseño real e icónico de
    # camisetas de selecciones/clubes conocidos (mismo tipo de riesgo que
    # las plantillas "uniforme_peru"/"uniforme_alianza" ya renombradas en
    # db_scripts/113) -- el usuario decidió mantenerlas tal cual pudiendo
    # elegir omitirlas o modificar el patrón; no es un descuido de este
    # catálogo, es una decisión informada registrada acá y en ADR-204.
    BodyTemplate(
        "camiseta_amarilla_brazos_real", "Amarilla con brazos (foto real)", "camiseta",
        (40, 210, 235), (150, 60, 20), neckline="v",
        real_asset_path="real_camiseta_amarilla_brazos",
    ),
    BodyTemplate(
        "camiseta_diagonal_roja_real", "Camiseta blanca con franja diagonal (foto real)", "camiseta",
        (245, 245, 245), (40, 40, 190), neckline="v",
        real_asset_path="real_camiseta_diagonal_roja",
    ),
    BodyTemplate(
        "camiseta_amarilla_verde_real", "Camiseta amarilla con cuello verde (foto real)", "camiseta",
        (40, 210, 235), (60, 150, 40), neckline="v",
        real_asset_path="real_camiseta_amarilla_verde",
    ),
    BodyTemplate(
        "camiseta_celeste_rayas_real", "Rayas celeste y blanco (foto real)", "camiseta",
        (245, 245, 245), (220, 180, 120), neckline="v",
        real_asset_path="real_camiseta_celeste_rayas",
    ),
    BodyTemplate(
        "camiseta_crema_marron_real", "Camiseta crema con cuello vino (foto real)", "camiseta",
        (218, 226, 236), (43, 34, 130), neckline="v",
        real_asset_path="real_camiseta_crema_marron",
    ),
    BodyTemplate(
        "camiseta_marino_rayas_real", "Rayas azul marino y blanco (foto real)", "camiseta",
        (245, 245, 245), (100, 45, 20), neckline="v",
        real_asset_path="real_camiseta_marino_rayas",
    ),
    BodyTemplate(
        "camiseta_celeste_real", "Camiseta celeste lisa (foto real)", "camiseta",
        (232, 206, 60), (232, 206, 60), neckline="round",
        real_asset_path="real_camiseta_celeste",
    ),
    BodyTemplate(
        "chaqueta_electronica_real", "Chaqueta técnica azul (foto real)", "casaca",
        (60, 45, 40), (180, 180, 180), neckline="round", sleeve="long",
        real_asset_path="real_chaqueta_electronica",
    ),
    BodyTemplate(
        "chaleco_geologo_real", "Chaleco de campo verde (foto real)", "chaleco",
        (60, 80, 60), (180, 180, 180), neckline="round",
        real_asset_path="real_chaleco_geologo",
    ),
)

_TEMPLATES_BY_SLUG = {t.slug: t for t in TEMPLATES}


def default_template_slug() -> str:
    return TEMPLATES[0].slug


def get_template(slug: Optional[str]) -> BodyTemplate:
    if slug and slug in _TEMPLATES_BY_SLUG:
        return _TEMPLATES_BY_SLUG[slug]
    return _TEMPLATES_BY_SLUG[default_template_slug()]


def is_valid_slug(slug: str) -> bool:
    return slug in _TEMPLATES_BY_SLUG


def _load_logo_rgba() -> Optional[np.ndarray]:
    """Mismo algoritmo que avatar_engine/avatar_diffusion.py::_load_logo_badge_rgba
    (color-key sobre casi-blanco -- el PNG fuente no trae alfa real,
    verificado ahí antes de escribir ese código; se reimplementa acá en vez
    de importar entre servicios porque son procesos/contenedores separados
    sin módulos compartidos)."""
    if not os.path.isfile(_LOGO_PATH):
        return None
    try:
        img = cv2.imread(_LOGO_PATH, cv2.IMREAD_UNCHANGED)
        if img is None:
            return None
        if img.shape[2] == 4:
            bgr = img[:, :, :3]
        else:
            bgr = img
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        alpha = np.where(gray >= 245, 0, 255).astype(np.uint8)
        alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
        return cv2.merge([bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2], alpha])
    except Exception:
        return None


def _apply_logo_badge(canvas_bgr: np.ndarray, t: Optional[BodyTemplate] = None) -> np.ndarray:
    logo = _load_logo_rgba()
    if logo is None:
        return canvas_bgr
    try:
        th, tw = canvas_bgr.shape[:2]
        badge_w = max(24, int(round(min(th, tw) * 0.11)))
        lh, lw = logo.shape[:2]
        badge_h = max(24, int(round(badge_w * lh / max(1, lw))))
        badge = cv2.resize(logo, (badge_w, badge_h), interpolation=cv2.INTER_AREA)
        # Bug real (pedido explícito del usuario, 2026-09-21): el logo salía
        # anclado abajo a la derecha del lienzo -- con el torso ocupando casi
        # todo el lienzo, terminaba a la altura de la cintura/cadera, no del
        # pecho. Se ancla ahora al PECHO real de la prenda: un poco a la
        # izquierda del centro del cuello (mismo lugar donde va bordado un
        # logo de polo/camisa real) y debajo de la línea de hombro.
        if t is not None:
            # Bug real (2026-09-21): la primera versión de este fix medía la
            # bajada en unidades de shoulder_drop_frac (la franja angosta
            # donde el cuello se abre a los hombros, una fracción CHICA del
            # alto) en vez de en unidades del TORSO completo (desde el cuello
            # hasta el borde inferior del lienzo, una fracción MUCHO más
            # grande) -- el resultado seguía cayendo casi en el mismo lugar
            # de antes (abajo del todo). El pecho real de una prenda está
            # apenas debajo del cuello, ~12-16% de la altura del TORSO, no de
            # esa franja angosta.
            torso_h_frac = 1.0 - t.neck_top_y_frac
            chest_cx = (t.neck_center_x_frac - 0.16) * tw
            chest_y0 = (t.neck_top_y_frac + torso_h_frac * 0.14) * th
            x0 = int(round(chest_cx - badge_w / 2.0))
            y0 = int(round(chest_y0))
        else:
            margin = int(round(min(th, tw) * 0.045))
            x0 = tw - badge_w - margin
            y0 = th - badge_h - margin
        if x0 < 0 or y0 < 0 or x0 + badge_w > tw or y0 + badge_h > th:
            return canvas_bgr
        roi = canvas_bgr[y0 : y0 + badge_h, x0 : x0 + badge_w].astype(np.float32)
        alpha = (badge[:, :, 3:4].astype(np.float32)) / 255.0
        blended = roi * (1.0 - alpha) + badge[:, :, :3].astype(np.float32) * alpha
        canvas_bgr[y0 : y0 + badge_h, x0 : x0 + badge_w] = np.clip(
            blended, 0, 255
        ).astype(np.uint8)
        return canvas_bgr
    except Exception:
        return canvas_bgr


def _neckline_curve_points(
    t: BodyTemplate, cx: float, neck_y: float, neck_half_w: float, steps: int = 10
) -> list:
    """Puntos del escote entre el extremo izquierdo (f=0) y el derecho (f=1)
    del cuello, EXCLUYENDO ambos extremos -- cuello redondo (arco) o en V
    (pico), nunca una línea recta (pedido explícito del usuario, 2026-09-20).
    Compartido por _shoulder_polygon (silueta real) y _render_template (línea
    de acento) para que ambos seaan la MISMA curva."""
    depth = neck_half_w * (0.95 if t.neckline == "v" else 0.55)
    pts = []
    for i in range(1, steps):
        f = i / steps
        x = cx - neck_half_w + 2.0 * neck_half_w * f
        if t.neckline == "v":
            d = depth * (1.0 - abs(2.0 * f - 1.0))
        else:
            d = depth * float(np.sin(np.pi * f))
        pts.append((x, neck_y + d))
    return pts


def _shoulder_polygon(t: BodyTemplate, w: int, h: int) -> np.ndarray:
    cx = w * t.neck_center_x_frac
    neck_y = h * t.neck_top_y_frac
    neck_half_w = (w * t.neck_width_frac) / 2.0
    shoulder_y = neck_y + h * t.shoulder_drop_frac
    shoulder_half_w = (w * t.shoulder_width_frac) / 2.0

    # Curva cuello->hombro con unos puntos intermedios (no un quiebre recto)
    # -- silueta de "hombro caído" natural en vez de un trapecio anguloso.
    steps = 6
    left_curve = []
    right_curve = []
    for i in range(steps + 1):
        f = i / steps
        # smoothstep para una transición suave
        ease = f * f * (3 - 2 * f)
        x_l = cx - (neck_half_w + (shoulder_half_w - neck_half_w) * ease)
        x_r = cx + (neck_half_w + (shoulder_half_w - neck_half_w) * ease)
        y = neck_y + (shoulder_y - neck_y) * ease
        left_curve.append((x_l, y))
        right_curve.append((x_r, y))

    # Escote curvo -- pedido explícito del usuario (2026-09-20): el cierre de
    # arriba entre los dos extremos del cuello era una línea recta de lado a
    # lado (el polígono se cierra implícitamente del último punto al
    # primero), y ningún cuello de prenda real es una línea recta.
    neck_arc = _neckline_curve_points(t, cx, neck_y, neck_half_w)

    points = []
    points.append((cx - neck_half_w, neck_y))
    points.extend(left_curve)
    points.append((cx - shoulder_half_w, float(h)))
    points.append((cx + shoulder_half_w, float(h)))
    points.extend(reversed(right_curve))
    points.append((cx + neck_half_w, neck_y))
    points.extend(reversed(neck_arc))
    return np.array(points, dtype=np.int32)


def _fabric_texture_tile(name: str, w: int, h: int) -> np.ndarray:
    """Mapa de luminancia (float32, ~1.0 = sin cambio) del tamaño w x h,
    tileando la muestra de tela de assets/fabric_{name}.png cuantas veces
    haga falta -- ver _FABRIC_TEXTURE_PATHS arriba para la procedencia. Se
    multiplica sobre el color plano de la prenda para que se vea como tela de
    verdad en vez de un bloque de color liso (pedido explícito del usuario,
    2026-09-21)."""
    cache_key = (name, w, h)
    if cache_key in _fabric_texture_cache:
        return _fabric_texture_cache[cache_key]
    path = _FABRIC_TEXTURE_PATHS.get(name)
    tile_gray = cv2.imread(path, cv2.IMREAD_GRAYSCALE) if path else None
    if tile_gray is None:
        factor = np.ones((h, w), dtype=np.float32)
        _fabric_texture_cache[cache_key] = factor
        return factor
    th, tw = tile_gray.shape[:2]
    reps_y = int(np.ceil(h / th)) + 1
    reps_x = int(np.ceil(w / tw)) + 1
    tiled = np.tile(tile_gray, (reps_y, reps_x))[:h, :w]
    # Normalizado alrededor de 1.0 -- es un detalle de tela, no debe cambiar
    # el color/tono elegido de la plantilla, solo darle variación de
    # superficie. ±12% resultó casi invisible a resolución de miniatura
    # (768x1024) -- subido a ±22% tras revisar visualmente.
    factor = 1.0 + (tiled.astype(np.float32) - 128.0) / 128.0 * 0.22
    _fabric_texture_cache[cache_key] = factor
    return factor


def _render_template(t: BodyTemplate, w: int, h: int) -> np.ndarray:
    canvas = np.full((h, w, 3), 255, dtype=np.uint8)
    poly = _shoulder_polygon(t, w, h)
    cx = w * t.neck_center_x_frac
    neck_y = h * t.neck_top_y_frac
    neck_half_w = (w * t.neck_width_frac) / 2.0

    if t.show_arms:
        # Bug real (2026-09-20, revisando visualmente el catálogo completo):
        # el brazo se dibujaba SIEMPRE en color piel, incluso con
        # sleeve="long" (casacas/chaquetas) -- eso muestra piel desnuda
        # asomando bajo una manga larga, anatómicamente incorrecto. Con manga
        # larga el "brazo" visible acá es la MANGA de la prenda (mismo color
        # que el torso), no el brazo en sí.
        arm_color = t.base_color_bgr if t.sleeve == "long" else (165, 196, 225)
        arm_y0 = int(round(h * (t.neck_top_y_frac + t.shoulder_drop_frac * 0.72)))
        arm_y1 = h
        arm_w = int(round(w * (0.10 if t.sleeve == "long" else 0.13)))
        cv2.ellipse(
            canvas,
            (int(round(w * 0.13)), int(round((arm_y0 + arm_y1) * 0.53))),
            (arm_w, max(40, int(round((arm_y1 - arm_y0) * 0.56)))),
            -8,
            0,
            360,
            arm_color,
            -1,
            lineType=cv2.LINE_AA,
        )
        cv2.ellipse(
            canvas,
            (int(round(w * 0.87)), int(round((arm_y0 + arm_y1) * 0.53))),
            (arm_w, max(40, int(round((arm_y1 - arm_y0) * 0.56)))),
            8,
            0,
            360,
            arm_color,
            -1,
            lineType=cv2.LINE_AA,
        )

    skin = (165, 196, 225)
    neck_bridge = np.array(
        [
            (int(cx - neck_half_w * 0.48), int(neck_y - h * 0.095)),
            (int(cx + neck_half_w * 0.48), int(neck_y - h * 0.095)),
            (int(cx + neck_half_w * 0.58), int(neck_y + h * 0.025)),
            (int(cx - neck_half_w * 0.58), int(neck_y + h * 0.025)),
        ],
        dtype=np.int32,
    )
    cv2.fillPoly(canvas, [neck_bridge], skin, lineType=cv2.LINE_AA)
    cv2.fillPoly(canvas, [poly], t.base_color_bgr, lineType=cv2.LINE_AA)

    # Sombreado sutil (degradado vertical, más oscuro abajo) + textura de tela
    # real (pedido explícito del usuario, 2026-09-21: "se ve como bloques de
    # formas geométricas... hecho con Paint") -- las dos son multiplicativas,
    # se combinan en un solo factor antes de aplicarlas juntas para no perder
    # contraste haciendo dos pasadas.
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [poly], 255, lineType=cv2.LINE_AA)
    grad = np.linspace(1.06, 0.86, h, dtype=np.float32).reshape(h, 1)
    grad = np.repeat(grad, w, axis=1)
    fabric = _fabric_texture_tile(t.texture, w, h)
    combined = grad * fabric
    canvas_f = canvas.astype(np.float32)
    m = (mask > 0).astype(np.float32)[..., None]
    shaded = np.clip(canvas_f * combined[..., None], 0, 255)
    canvas = (canvas_f * (1 - m) + shaded * m).astype(np.uint8)

    # Trim de acento a lo largo del cuello (mismo espíritu que "safety-orange
    # trim" del prompt de difusión, ADR-164) -- sigue la MISMA curva del
    # escote (_neckline_curve_points), no una línea recta. Un poco más angosto
    # que la apertura real de la plantilla (0.8x) a propósito: bug real
    # probado con foto real (2026-09-20) -- con el mismo ancho exacto de la
    # apertura, las puntas del trim quedaban justo en el borde y a veces
    # asomaban unos px más allá del cuello real fotografiado (que casi nunca
    # mide EXACTO lo mismo que la plantilla). Un poco más angosto garantiza
    # que el trim quede siempre debajo de la piel real, nunca sobresaliendo.
    trim_half_w = neck_half_w * 0.8
    trim_pts = np.array(
        [(cx - trim_half_w, neck_y)]
        + _neckline_curve_points(t, cx, neck_y, trim_half_w)
        + [(cx + trim_half_w, neck_y)],
        dtype=np.int32,
    )
    cv2.polylines(
        canvas, [trim_pts], isClosed=False, color=t.accent_color_bgr,
        thickness=max(2, int(round(w * 0.006))), lineType=cv2.LINE_AA,
    )

    torso_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(torso_mask, [poly], 255, lineType=cv2.LINE_AA)

    if t.sleeve == "short" and t.show_arms:
        sleeve_y = int(round(neck_y + h * 0.075))
        cv2.line(canvas, (int(w * 0.16), sleeve_y), (int(w * 0.31), int(sleeve_y + h * 0.055)), t.accent_color_bgr, max(3, int(w * 0.012)), cv2.LINE_AA)
        cv2.line(canvas, (int(w * 0.84), sleeve_y), (int(w * 0.69), int(sleeve_y + h * 0.055)), t.accent_color_bgr, max(3, int(w * 0.012)), cv2.LINE_AA)

    if t.pattern == "vertical_stripes":
        stripe_w = max(8, int(round(w * 0.055)))
        for x in range(int(w * 0.22), int(w * 0.78), stripe_w * 2):
            overlay = canvas.copy()
            cv2.rectangle(overlay, (x, int(neck_y + h * 0.03)), (x + stripe_w, h), t.secondary_color_bgr, -1)
            canvas = np.where(torso_mask[..., None] > 0, overlay, canvas)
    elif t.pattern == "chest_band":
        y = int(round(h * 0.70))
        band = canvas.copy()
        cv2.rectangle(band, (int(w * 0.16), y), (int(w * 0.84), y + int(h * 0.07)), t.accent_color_bgr, -1)
        cv2.rectangle(band, (int(w * 0.16), y + int(h * 0.075)), (int(w * 0.84), y + int(h * 0.095)), t.secondary_color_bgr, -1)
        canvas = np.where(torso_mask[..., None] > 0, band, canvas)
    elif t.pattern == "diagonal_sash":
        sash = canvas.copy()
        pts = np.array([(int(w * 0.28), int(h * 0.56)), (int(w * 0.42), int(h * 0.56)), (int(w * 0.78), h), (int(w * 0.62), h)], dtype=np.int32)
        cv2.fillPoly(sash, [pts], t.accent_color_bgr, lineType=cv2.LINE_AA)
        canvas = np.where(torso_mask[..., None] > 0, sash, canvas)
    elif t.pattern == "reflective":
        overlay = canvas.copy()
        strip = max(8, int(w * 0.025))
        cv2.line(overlay, (int(w * 0.34), int(h * 0.60)), (int(w * 0.26), h), t.secondary_color_bgr, strip, cv2.LINE_AA)
        cv2.line(overlay, (int(w * 0.66), int(h * 0.60)), (int(w * 0.74), h), t.secondary_color_bgr, strip, cv2.LINE_AA)
        cv2.line(overlay, (int(w * 0.22), int(h * 0.76)), (int(w * 0.78), int(h * 0.76)), t.secondary_color_bgr, strip, cv2.LINE_AA)
        canvas = np.where(torso_mask[..., None] > 0, overlay, canvas)
    elif t.pattern in {"buttons", "pockets", "zipper"}:
        line_color = t.secondary_color_bgr if t.pattern != "zipper" else (20, 20, 20)
        cv2.line(canvas, (int(w * 0.5), int(neck_y + h * 0.02)), (int(w * 0.5), h), line_color, max(2, int(w * 0.006)), cv2.LINE_AA)
        if t.pattern in {"buttons", "pockets"}:
            for y in np.linspace(neck_y + h * 0.10, h * 0.88, 5):
                cv2.circle(canvas, (int(w * 0.5), int(y)), max(4, int(w * 0.008)), line_color, -1, lineType=cv2.LINE_AA)
        if t.pattern == "pockets":
            for x in (0.36, 0.64):
                cv2.rectangle(canvas, (int(w * (x - 0.07)), int(h * 0.68)), (int(w * (x + 0.07)), int(h * 0.78)), t.secondary_color_bgr, max(2, int(w * 0.004)), cv2.LINE_AA)
    elif t.pattern == "chest_mark":
        # Emblema genérico (círculo + rombo interior) -- a propósito SIN
        # ninguna letra/inicial: un carácter sobre el pecho es exactamente el
        # tipo de referencia directa a un escudo de club real que este
        # catálogo evita (ver docstring del módulo, "cero riesgo de
        # licencia").
        center = (int(w * 0.5), int(h * 0.70))
        radius = max(6, int(round(w * 0.045)))
        cv2.circle(canvas, center, radius, t.accent_color_bgr, max(2, int(w * 0.006)), cv2.LINE_AA)
        diamond = np.array(
            [
                (center[0], center[1] - int(radius * 0.55)),
                (center[0] + int(radius * 0.55), center[1]),
                (center[0], center[1] + int(radius * 0.55)),
                (center[0] - int(radius * 0.55), center[1]),
            ],
            dtype=np.int32,
        )
        cv2.fillPoly(canvas, [diamond], t.accent_color_bgr, lineType=cv2.LINE_AA)

    if t.logo_badge:
        canvas = _apply_logo_badge(canvas, t)
    return canvas


def _template_cache_path(slug: str) -> str:
    return os.path.join(_TEMPLATE_CACHE_DIR, f"v3_{slug}.png")


def _render_real_garment(t: BodyTemplate, w: int, h: int) -> np.ndarray:
    """Contraparte de _render_template() para BodyTemplate.real_asset_path:
    en vez de dibujar la silueta por código, recorta/escala una FOTO real de
    prenda (sin marca/logo real, ver REAL_GARMENT_ASSETS) alineando su propio
    cuello contra t.neck_top_y_frac/neck_width_frac/neck_center_x_frac -- el
    mismo contrato de salida que _render_template (lienzo w x h, BGR, cuello
    en esa posición conocida), así que compose_head_on_template() no necesita
    saber cuál de los dos generó el master."""
    meta = REAL_GARMENT_ASSETS[t.real_asset_path]
    cache_key = (t.real_asset_path, w, h)
    if cache_key in _real_garment_cache:
        return _real_garment_cache[cache_key].copy()

    rgba = cv2.imread(meta["path"], cv2.IMREAD_UNCHANGED)
    x0, y0, x1, y1 = meta["bbox"]
    crop = rgba[y0 : y1 + 1, x0 : x1 + 1]
    crop_h, crop_w = crop.shape[:2]

    # Escala para que el ancho de HOMBROS de la foto real coincida con
    # shoulder_width_frac del template en el lienzo final -- da un tamaño de
    # prenda consistente con el resto del catálogo (dibujado por código).
    # Escalar por ancho de CUELLO en cambio (probado con foto real,
    # 2026-09-21) dejaba esta prenda angosta mucho más chica que las demás,
    # y la cabeza -- que se escala por altura, sin relación con el ancho de
    # la prenda -- terminaba viéndose gigante al lado de un torso angosto.
    target_shoulder_w = t.shoulder_width_frac * w
    src_shoulder_w = meta["shoulder_width_frac"] * crop_w
    scale = target_shoulder_w / max(1.0, src_shoulder_w)
    new_w = max(8, int(round(crop_w * scale)))
    new_h = max(8, int(round(crop_h * scale)))
    interp = cv2.INTER_LANCZOS4 if scale > 1.0 else cv2.INTER_AREA
    resized = cv2.resize(crop, (new_w, new_h), interpolation=interp)

    canvas = np.full((h, w, 3), 255, dtype=np.uint8)
    neck_x = t.neck_center_x_frac * w
    neck_y = t.neck_top_y_frac * h
    src_neck_cx = meta["neck_center_frac"] * new_w
    src_neck_top = meta["neck_top_frac"] * new_h
    x0d = int(round(neck_x - src_neck_cx))
    y0d = int(round(neck_y - src_neck_top))

    src_x0, src_y0 = 0, 0
    dst_x0, dst_y0 = x0d, y0d
    if dst_x0 < 0:
        src_x0 = -dst_x0
        dst_x0 = 0
    if dst_y0 < 0:
        src_y0 = -dst_y0
        dst_y0 = 0
    dst_x1 = min(w, x0d + new_w)
    dst_y1 = min(h, y0d + new_h)
    src_x1 = src_x0 + max(0, dst_x1 - dst_x0)
    src_y1 = src_y0 + max(0, dst_y1 - dst_y0)
    if dst_x1 > dst_x0 and dst_y1 > dst_y0:
        region = canvas[dst_y0:dst_y1, dst_x0:dst_x1].astype(np.float32)
        src_bgr = resized[src_y0:src_y1, src_x0:src_x1, :3].astype(np.float32)
        src_a = resized[src_y0:src_y1, src_x0:src_x1, 3:4].astype(np.float32) / 255.0
        blended = region * (1.0 - src_a) + src_bgr * src_a
        canvas[dst_y0:dst_y1, dst_x0:dst_x1] = np.clip(blended, 0, 255).astype(np.uint8)

    # Si la prenda (ya escalada) no llega hasta el borde inferior del lienzo,
    # extender la última fila con contenido hacia abajo -- evita un corte de
    # tela seco/artificial a mitad de torso en cuentas con cabeza chica.
    last_row_y = min(h - 1, dst_y1 - 1)
    if last_row_y < h - 1 and last_row_y >= 0:
        fill_row = canvas[last_row_y : last_row_y + 1, :, :]
        canvas[last_row_y + 1 :, :, :] = np.repeat(fill_row, h - 1 - last_row_y, axis=0)

    if t.logo_badge:
        canvas = _apply_logo_badge(canvas, t)

    _real_garment_cache[cache_key] = canvas.copy()
    return canvas


def _load_or_render_template_master(slug: str) -> np.ndarray:
    t = get_template(slug)
    if t.real_asset_path:
        # Prenda de foto real (pedido explícito del usuario, 2026-09-21): sin
        # caché en disco -- ya cachea en memoria (_real_garment_cache) y el
        # costo de recortar/escalar una sola imagen es despreciable (~5ms),
        # no hace falta la persistencia entre reinicios del contenedor.
        return _render_real_garment(t, TEMPLATE_MASTER_W, TEMPLATE_MASTER_H)
    path = _template_cache_path(t.slug)
    with _render_lock:
        if os.path.isfile(path):
            img = cv2.imread(path, cv2.IMREAD_COLOR)
            if img is not None and img.shape[1] == TEMPLATE_MASTER_W and img.shape[0] == TEMPLATE_MASTER_H:
                return img
        canvas = _render_template(t, TEMPLATE_MASTER_W, TEMPLATE_MASTER_H)
        try:
            os.makedirs(_TEMPLATE_CACHE_DIR, exist_ok=True)
            cv2.imwrite(path, canvas, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        except Exception:
            pass  # Cache best-effort -- se puede volver a dibujar la próxima vez.
        return canvas


def list_templates() -> list[dict]:
    out = []
    for t in TEMPLATES:
        master = _load_or_render_template_master(t.slug)
        thumb = cv2.resize(master, (180, 240), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".png", thumb, [cv2.IMWRITE_PNG_COMPRESSION, 6])
        thumb_b64 = None
        if ok:
            import base64

            thumb_b64 = base64.b64encode(buf.tobytes()).decode("ascii")
        out.append(
            {
                "slug": t.slug,
                "display_name": t.display_name,
                "thumbnail_base64": thumb_b64,
            }
        )
    return out


def compose_head_on_template(
    head_bgra: np.ndarray, slug: str, canvas_w: int, canvas_h: int
) -> np.ndarray:
    """Escala/pega el recorte de cabeza (BGRA, ya recortado ajustado a su
    bounding box) sobre la plantilla de cuerpo elegida, en el canvas_w x
    canvas_h pedido. Devuelve BGR (sin alfa -- el resultado final siempre
    tiene fondo/cuerpo opaco, mismo contrato que _compose_avatar_canvas)."""
    t = get_template(slug)
    master = _load_or_render_template_master(t.slug)
    canvas = cv2.resize(master, (canvas_w, canvas_h), interpolation=cv2.INTER_AREA)

    head_bgr = head_bgra[:, :, :3]
    alpha = head_bgra[:, :, 3]

    # Bounding box de contenido en las coordenadas ORIGINALES del recorte
    # (antes de escalar) -- hace falta para derivar el escalado por altura.
    orig_cols = np.where(alpha.max(axis=0) > 10)[0]
    orig_rows = np.where(alpha.max(axis=1) > 10)[0]
    if orig_cols.size and orig_rows.size:
        orig_content_h = max(1, int(orig_rows.max()) - int(orig_rows.min()) + 1)
        orig_content_w = max(1, int(orig_cols.max()) - int(orig_cols.min()) + 1)
    else:
        orig_content_h = head_bgra.shape[0]
        orig_content_w = head_bgra.shape[1]

    # Escalado PRIMARIO: llenar la altura disponible entre un margen superior
    # fijo y la línea de cuello de la plantilla (bug real probado con foto
    # real, 2026-09-20: "la cabeza sale muy alejada / no es proporcional").
    # Escalar solo por "ancho de cuello medido" (versión anterior) depende de
    # una franja ruidosa que a veces mide mandíbula/hombro en vez de cuello
    # real, y además no dice nada sobre cuánto lienzo vertical debe ocupar la
    # cabeza -- el resultado quedaba con mucho margen en blanco arriba
    # (cabeza "lejos") o con proporciones erráticas. La altura real de la
    # cabeza (corona a mentón) es una medida mucho más estable: viene siempre
    # del mismo corte de cuello (_head_only_mask) y los mismos landmarks
    # faciales, a diferencia del ancho puntual en una sola franja.
    #
    # Intento real probado y DESCARTADO (2026-09-21, "el tamaño de la cabeza
    # no guarda proporción con el cuerpo"): escalar por altura de SOLO la
    # cara (estimada por color de piel, sin landmarks disponibles acá) en vez
    # de cabeza+pelo completos, para que el peinado no afecte el tamaño de la
    # cara. La idea era correcta pero _estimate_face_height_px (heurística de
    # piel, definida abajo pero ya sin uso) midió ~86% de "cara" en la foto
    # de prueba real de este mismo archivo (esperaba ~60-65%) -- probado en
    # vivo, el resultado fue una cabeza mucho más chica que antes, peor que
    # el problema que buscaba arreglar. Sin la foto real que reportó el
    # problema para calibrar el umbral de piel correctamente, revertido a la
    # altura total (más simple y ya validada con varias fotos reales) antes
    # que arriesgar una calibración a ciegas.
    top_margin_frac = 0.045
    available_h = max(1.0, (t.neck_top_y_frac - top_margin_frac) * canvas_h)
    scale = available_h / orig_content_h

    # Límite de seguridad sobre el ANCHO resultante (mismo espíritu que la
    # versión anterior): una cabeza girada/con pelo muy ancho puede tener una
    # relación alto/ancho atípica -- este límite evita que termine más
    # angosta o más ancha que un rango humano razonable, sin importar qué
    # tan alta salió la foto de origen.
    head_w_frac = (orig_content_w * scale) / canvas_w
    if head_w_frac > _MAX_HEAD_WIDTH_FRAC:
        scale *= _MAX_HEAD_WIDTH_FRAC / head_w_frac
    elif head_w_frac < _MIN_HEAD_WIDTH_FRAC:
        scale *= _MIN_HEAD_WIDTH_FRAC / head_w_frac
    scale = float(np.clip(scale, 0.15, 6.0))

    nh = max(8, int(round(head_bgra.shape[0] * scale)))
    nw = max(8, int(round(head_bgra.shape[1] * scale)))
    interp = cv2.INTER_LANCZOS4 if scale > 1.0 else cv2.INTER_AREA
    head_rs = cv2.resize(head_bgr, (nw, nh), interpolation=interp)
    alpha_rs = cv2.resize(alpha, (nw, nh), interpolation=cv2.INTER_LINEAR).astype(
        np.float32
    ) / 255.0

    # Ancla al bounding box REAL del contenido alfa, no al tamaño del
    # arreglo -- _head_cutout_rgba (eye_analyzer.py) agrega padding
    # transparente alrededor del recorte (para no cortar el plumeado del
    # borde), así que el borde inferior/lateral del ARRAY casi nunca coincide
    # con el borde real de la cabeza. Anclar al tamaño del array crudo deja
    # un hueco visible entre la cabeza y el cuello de la plantilla (bug real
    # encontrado y verificado con un recorte sintético antes de este fix).
    content_cols = np.where(alpha_rs.max(axis=0) > 0.04)[0]
    content_rows = np.where(alpha_rs.max(axis=1) > 0.04)[0]
    content_left = int(content_cols.min()) if content_cols.size else 0
    content_right = int(content_cols.max()) if content_cols.size else nw - 1
    content_bottom = int(content_rows.max()) if content_rows.size else nh - 1
    content_cx = (content_left + content_right) / 2.0

    # Bug real encontrado probando con foto real (2026-09-20): el plumeado que
    # iba acá tenía la rampa AL REVÉS -- `linspace(0.0, 1.0, ...)` multiplicado
    # empezando en la fila MÁS ALTA de la franja (alfa*=0, la vuelve
    # transparente) y terminando en la última fila de contenido (alfa*=1, la
    # deja intacta). Esa fila más alta de la franja cae justo ARRIBA de
    # `neck_y` en el lienzo, que en la plantilla es fondo BLANCO (la "apertura"
    # de cuello, no la silueta de hombros) -- volverla transparente ahí
    # exponía ese blanco como un hueco/costura visible justo encima del cuello
    # de la plantilla, en vez de una transición suave. El corte duro de
    # _head_only_mask (eye_analyzer.py) ya deja un borde limpio por sí solo
    # (mismo motivo por el que este plumeado se agregó "de más" en primer
    # lugar, según el comentario original) -- se saca en vez de arreglar la
    # dirección, para no reintroducir halos de color en el borde real.
    neck_x = t.neck_center_x_frac * canvas_w
    neck_y = t.neck_top_y_frac * canvas_h
    x0 = int(round(neck_x - content_cx))
    # Solape anatómico: el corte inferior del cuello no debe quedar justo
    # "apoyado" sobre la prenda, porque se percibe como cabeza flotante. Se
    # mete unos px dentro del cuello/collar y luego se agrega una sombra suave.
    collar_overlap_base = int(round(canvas_h * 0.04))
    # Bug real probado con foto real (2026-09-21, ángulo de cámara picado
    # -- foto tomada mirando hacia abajo): con ese ángulo el cuello mide
    # mucho más angosto en la fila de corte que en una foto de frente (el
    # mentón se proyecta más grande, el cuello real queda comprimido) --
    # un cuello angosto flotando dentro de la apertura ancha del cuello en V
    # de la plantilla deja ver fondo a los lados, se percibe como "cabeza
    # flotante" aunque el solape vertical esté bien calculado. La apertura
    # en V se angosta a medida que baja (converge hacia el pecho) -- empujar
    # el cuello un poco más adentro (solape extra, proporcional a qué tan
    # angosto salió) lo hace caer en un punto de la V ya más angosto, más
    # parecido al ancho real medido. Solo aumenta el solape, nunca lo reduce,
    # y con un tope de seguridad para no hundir la cabeza en la prenda.
    if content_cols.size:
        chin_row = alpha_rs[content_bottom]
        chin_cols = np.where(chin_row > 0.04)[0]
        chin_width_px = float(chin_cols.max() - chin_cols.min()) if chin_cols.size else 0.0
        expected_neck_w_px = t.neck_width_frac * canvas_w
        if chin_width_px > 0 and chin_width_px < expected_neck_w_px * 0.75:
            narrowness = 1.0 - (chin_width_px / expected_neck_w_px)
            extra = narrowness * canvas_h * 0.11
            collar_overlap = collar_overlap_base + int(round(extra))
            collar_overlap = min(collar_overlap, int(round(canvas_h * 0.16)))
        else:
            collar_overlap = collar_overlap_base
    else:
        collar_overlap = collar_overlap_base
    y0 = int(round(neck_y + collar_overlap - (content_bottom + 1)))

    shadow = np.zeros((canvas_h, canvas_w), dtype=np.uint8)
    shadow_center = (int(round(neck_x)), int(round(neck_y + canvas_h * 0.014)))
    shadow_axes = (
        max(8, int(round(t.neck_width_frac * canvas_w * 0.52))),
        max(4, int(round(canvas_h * 0.020))),
    )
    cv2.ellipse(shadow, shadow_center, shadow_axes, 0, 0, 360, 130, -1, lineType=cv2.LINE_AA)
    shadow = cv2.GaussianBlur(shadow, (0, 0), sigmaX=max(2.0, canvas_w * 0.010))
    shadow_a = (shadow.astype(np.float32) / 255.0) * 0.26
    canvas = np.clip(canvas.astype(np.float32) * (1.0 - shadow_a[..., None]), 0, 255).astype(np.uint8)

    # Uniformizar el color del cuello con la plantilla/prenda de abajo
    # (pedido explícito del usuario, 2026-09-21): el recorte real de cabeza
    # trae el balance de color de la foto de origen (acá, luz de noche de un
    # solo lado, tono cálido) que casi nunca coincide con el tono neutro de
    # la plantilla (relleno de piel fijo de _render_template, o el cuello ya
    # fotografiado de _render_real_garment) -- la unión se ve como un salto
    # de color, no solo de forma/brillo (ver los intentos de brillo más
    # abajo en eye_analyzer.py, un problema DISTINTO). Se mide el tono
    # promedio de la plantilla justo debajo del cuello y el de la cabeza
    # justo encima, y se desplaza SOLO la banda final del recorte (nunca la
    # cara) hacia ese tono, con una corrección parcial (0.6, no 1.0) para no
    # reteñir la piel de forma antinatural si el contraste es muy fuerte.
    if (
        content_rows.size
        and content_cols.size
        and not os.environ.get("AVATAR_DISABLE_NECK_COLORMATCH")
    ):
        band_h = max(4, int(round((content_bottom - int(content_rows.min())) * 0.12)))
        band_y0 = max(0, content_bottom - band_h)
        band_alpha = alpha_rs[band_y0 : content_bottom + 1]
        band_mask = band_alpha > 0.5
        if band_mask.any():
            head_band_lab = cv2.cvtColor(
                head_rs[band_y0 : content_bottom + 1], cv2.COLOR_BGR2LAB
            ).astype(np.float32)
            head_mean = head_band_lab[band_mask].mean(axis=0)

            tmpl_y0 = max(0, int(round(neck_y + collar_overlap)))
            tmpl_y1 = min(canvas_h, tmpl_y0 + max(3, int(round(canvas_h * 0.02))))
            tmpl_half_w = max(4, int(round(t.neck_width_frac * canvas_w * 0.6)))
            tmpl_x0 = max(0, int(round(neck_x - tmpl_half_w)))
            tmpl_x1 = min(canvas_w, int(round(neck_x + tmpl_half_w)))
            if tmpl_y1 > tmpl_y0 and tmpl_x1 > tmpl_x0:
                tmpl_patch = canvas[tmpl_y0:tmpl_y1, tmpl_x0:tmpl_x1]
                tmpl_mean = (
                    cv2.cvtColor(tmpl_patch, cv2.COLOR_BGR2LAB)
                    .astype(np.float32)
                    .reshape(-1, 3)
                    .mean(axis=0)
                )
                delta = np.clip(tmpl_mean - head_mean, -45.0, 45.0) * 0.8

                taper_rows = max(4, int(round(band_h * 1.6)))
                taper_y0 = max(0, content_bottom - taper_rows)
                head_lab = cv2.cvtColor(
                    head_rs[taper_y0 : content_bottom + 1], cv2.COLOR_BGR2LAB
                ).astype(np.float32)
                rows_local = head_lab.shape[0]
                weight = np.linspace(0.0, 1.0, rows_local, dtype=np.float32).reshape(
                    -1, 1, 1
                )
                head_lab = head_lab + delta.reshape(1, 1, 3) * weight
                head_rs[taper_y0 : content_bottom + 1] = cv2.cvtColor(
                    np.clip(head_lab, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR
                )

    src_x0, src_y0 = 0, 0
    dst_x0, dst_y0 = x0, y0
    if dst_x0 < 0:
        src_x0 = -dst_x0
        dst_x0 = 0
    if dst_y0 < 0:
        src_y0 = -dst_y0
        dst_y0 = 0
    dst_x1 = min(canvas_w, x0 + nw)
    dst_y1 = min(canvas_h, y0 + nh)
    src_x1 = src_x0 + max(0, dst_x1 - dst_x0)
    src_y1 = src_y0 + max(0, dst_y1 - dst_y0)

    if dst_x1 > dst_x0 and dst_y1 > dst_y0:
        region = canvas[dst_y0:dst_y1, dst_x0:dst_x1].astype(np.float32)
        head_region = head_rs[src_y0:src_y1, src_x0:src_x1].astype(np.float32)
        a = alpha_rs[src_y0:src_y1, src_x0:src_x1][..., None]
        blended = region * (1.0 - a) + head_region * a
        canvas[dst_y0:dst_y1, dst_x0:dst_x1] = np.clip(blended, 0, 255).astype(
            np.uint8
        )

    # Reparación de precisión de la unión cabeza-cuello (pedido explícito del
    # usuario, 2026-09-21: "estilizar al máximo la unión... máxima precisión
    # y calidad"): pese al solape/sombra de arriba, una persona real casi
    # nunca mira perfectamente derecho a cámara -- queda un filo angosto (3
    # a 10px) del blanco ORIGINAL del lienzo asomando entre el cuello real y
    # el de la plantilla, casi siempre de un solo lado (el lado hacia el que
    # está girada la cabeza).
    #
    # Bug real probado con foto real (2026-09-21): la primera versión de este
    # parche marcaba CUALQUIER píxel blanco puro dentro de la franja como
    # "hueco a reparar" -- pero el triángulo de fondo blanco NORMAL entre el
    # pelo y el arranque del hombro (que no es ningún defecto, así se ve
    # cualquier busto) también es blanco puro, y cv2.inpaint lo rellenaba
    # mezclando pelo oscuro + piel + celeste de la prenda en una mancha gris
    # visible -- un defecto nuevo y peor que el hueco original.
    #
    # Distinción real: el hueco defectuoso queda ENCERRADO por piel/tela por
    # todos lados (un bolsillo de blanco aislado); el triángulo normal de
    # fondo está CONECTADO con el resto del fondo blanco de la foto (llega
    # hasta el borde de la franja de reparación). Se separan con componentes
    # conectados: solo se repara el blanco que NO toca ningún borde de la
    # franja -- el que sí toca es fondo real, se deja intacto.
    neck_half_w_repair = max(20, int(round(t.neck_width_frac * canvas_w * 0.85)))
    rx0 = max(0, int(round(neck_x - neck_half_w_repair)))
    rx1 = min(canvas_w, int(round(neck_x + neck_half_w_repair)))
    ry0 = max(0, int(round(neck_y - canvas_h * 0.05)))
    ry1 = min(canvas_h, int(round(neck_y + collar_overlap + canvas_h * 0.03)))
    if rx1 > rx0 and ry1 > ry0:
        repair_region = canvas[ry0:ry1, rx0:rx1]
        rh, rw = repair_region.shape[:2]
        white_mask = np.all(repair_region > 248, axis=2).astype(np.uint8)
        n_comp, labels = cv2.connectedComponents(white_mask, connectivity=8)
        enclosed_gap = np.zeros((rh, rw), dtype=np.uint8)
        for lbl in range(1, n_comp):
            ys_c, xs_c = np.where(labels == lbl)
            touches_border = (
                ys_c.min() == 0 or ys_c.max() == rh - 1
                or xs_c.min() == 0 or xs_c.max() == rw - 1
            )
            if not touches_border:
                enclosed_gap[labels == lbl] = 255
        if np.count_nonzero(enclosed_gap) > 0:
            canvas[ry0:ry1, rx0:rx1] = cv2.inpaint(
                repair_region, enclosed_gap, 3, cv2.INPAINT_TELEA
            )

    return canvas
