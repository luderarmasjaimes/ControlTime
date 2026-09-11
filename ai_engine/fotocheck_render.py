"""
fotocheck_render.py — composición server-side de la credencial (fotocheck):
foto real + QR (del string YA CIFRADO que manda el backend C++, ver
fotocheck_crypto.hpp) + campos de texto, sobre una tarjeta con branding
Beemetry.

Todo con OpenCV (arrays numpy), sin Pillow -- este ai_engine no tiene Pillow
como dependencia y su requirements.txt ya tiene un historial extenso de
conflictos de resolver (ver comentarios ahí), así que se evita agregarla.
El paquete `qrcode` (puro Python) se usa SOLO para el algoritmo de
codificación QR (Reed-Solomon + posicionamiento de módulos) vía
`QRCode.get_matrix()` -- el render de esos módulos a píxeles se hace a mano
con numpy, evitando por completo el factory de imagen por defecto de
`qrcode` (ese sí depende de Pillow).

Este módulo nunca ve el payload en claro del QR: recibe el string ya
cifrado (`qr_payload`) desde el backend y solo lo codifica visualmente.
"""
import cv2
import numpy as np
import qrcode

CARD_W = 900
CARD_H = 1420

# Tamaño FINAL fijo del QR en píxeles, sin importar cuántos módulos tenga --
# el payload cifrado (nonce+ciphertext+tag en base64) es notablemente más
# largo que un string de prueba corto, así que a `box_size` fijo el QR real
# salía mucho más grande y se metía sobre los campos de texto (visto en la
# prueba E2E real). Generar a 1px/módulo y escalar con INTER_NEAREST (sin
# antialiasing, necesario para que el lector siga viendo bordes duros entre
# módulos) desacopla el tamaño en pantalla de cuánto crezca el payload.
_QR_TARGET_PX = 340

# BGR (OpenCV), no RGB.
_GOLD = (30, 195, 220)
_TEAL_DARK = (55, 38, 10)
_TEAL_LIGHT = (95, 72, 24)
_WHITE = (255, 255, 255)


def _qr_matrix_to_image(data: str, target_px: int = _QR_TARGET_PX, border: int = 2) -> np.ndarray:
    """QR de `data` como array BGR blanco/negro de exactamente `target_px` x
    `target_px`, sin depender de Pillow -- ver comentario de _QR_TARGET_PX
    sobre por qué el tamaño en pantalla no puede depender de cuántos módulos
    resulten (eso varía con el largo del payload cifrado, no es constante)."""
    qr = qrcode.QRCode(
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        border=border,
        box_size=1,
    )
    qr.add_data(data)
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    img = np.full((n, n, 3), 255, dtype=np.uint8)
    for y, row in enumerate(matrix):
        for x, dark in enumerate(row):
            if dark:
                y0, y1 = y, y + 1
                x0, x1 = x, x + 1
                img[y0:y1, x0:x1] = (0, 0, 0)
    return cv2.resize(img, (target_px, target_px), interpolation=cv2.INTER_NEAREST)


def _rounded_photo_bgra(photo_bgr: np.ndarray, target_w: int, target_h: int,
                        radius: int) -> np.ndarray:
    """Recorta/escala `photo_bgr` a target_w x target_h (cover, centrado) y
    aplica esquinas redondeadas sobre un canal alfa."""
    h, w = photo_bgr.shape[:2]
    scale = max(target_w / w, target_h / h)
    resized = cv2.resize(photo_bgr, (int(w * scale) + 1, int(h * scale) + 1))
    rh, rw = resized.shape[:2]
    x0 = max(0, (rw - target_w) // 2)
    y0 = max(0, (rh - target_h) // 2)
    cropped = resized[y0:y0 + target_h, x0:x0 + target_w]

    mask = np.zeros((target_h, target_w), dtype=np.uint8)
    cv2.rectangle(mask, (radius, 0), (target_w - radius, target_h), 255, -1)
    cv2.rectangle(mask, (0, radius), (target_w, target_h - radius), 255, -1)
    for cx, cy in ((radius, radius), (target_w - radius, radius),
                   (radius, target_h - radius), (target_w - radius, target_h - radius)):
        cv2.circle(mask, (cx, cy), radius, 255, -1)

    bgra = cv2.cvtColor(cropped, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = mask
    return bgra


def _paste_bgra(canvas_bgr: np.ndarray, overlay_bgra: np.ndarray, x: int, y: int) -> None:
    h, w = overlay_bgra.shape[:2]
    alpha = (overlay_bgra[:, :, 3:4].astype(np.float32)) / 255.0
    roi = canvas_bgr[y:y + h, x:x + w].astype(np.float32)
    fg = overlay_bgra[:, :, :3].astype(np.float32)
    canvas_bgr[y:y + h, x:x + w] = (fg * alpha + roi * (1 - alpha)).astype(np.uint8)


def _text_centered(canvas, text, cx, y, scale, color, thickness=1,
                   font=cv2.FONT_HERSHEY_SIMPLEX):
    (tw, _), _ = cv2.getTextSize(text, font, scale, thickness)
    cv2.putText(canvas, text, (int(cx - tw / 2), y), font, scale, color, thickness,
                cv2.LINE_AA)


def generate_fotocheck_image(photo_bytes: bytes, qr_payload: str, fields: dict) -> bytes:
    """Compone la tarjeta completa. `fields` trae claves en snake_case
    (dni, first_name, last_name, company, email, mobile, role, ...) --
    mismas que arma buildFotocheckFields en fotocheck_routes.cpp. Devuelve
    bytes PNG; nunca falla por datos faltantes (usa "-" como relleno)."""
    canvas = np.empty((CARD_H, CARD_W, 3), dtype=np.uint8)
    for row in range(CARD_H):
        t = row / max(1, CARD_H - 1)
        canvas[row, :] = tuple(
            int(_TEAL_DARK[i] * (1 - t) + _TEAL_LIGHT[i] * t) for i in range(3)
        )

    border = 16
    cv2.rectangle(canvas, (border, border), (CARD_W - border, CARD_H - border), _GOLD, 4)
    cv2.circle(canvas, (CARD_W // 2, border + 42), 22, (18, 18, 18), -1)
    cv2.circle(canvas, (CARD_W // 2, border + 42), 22, _GOLD, 3)

    _text_centered(canvas, "BEEMETRY", CARD_W // 2, 160, 1.7, _WHITE, 3)
    _text_centered(canvas, "SOFTWARE MINERO EMPRESARIAL", CARD_W // 2, 195, 0.55, _GOLD, 1)

    photo_top = 240
    photo_bgr = None
    if photo_bytes:
        nparr = np.frombuffer(photo_bytes, np.uint8)
        photo_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if photo_bgr is not None:
        photo_card = _rounded_photo_bgra(photo_bgr, 360, 420, 26)
        _paste_bgra(canvas, photo_card, (CARD_W - 360) // 2, photo_top)
        cv2.rectangle(canvas, ((CARD_W - 360) // 2, photo_top),
                     ((CARD_W + 360) // 2, photo_top + 420), _GOLD, 2)

    qr_img = _qr_matrix_to_image(qr_payload)
    qh, qw = qr_img.shape[:2]
    qr_x = (CARD_W - qw) // 2
    qr_y = photo_top + 420 + 40
    cv2.rectangle(canvas, (qr_x - 14, qr_y - 14), (qr_x + qw + 14, qr_y + qh + 14), _WHITE, -1)
    canvas[qr_y:qr_y + qh, qr_x:qr_x + qw] = qr_img

    labels = [
        ("Nombres", f"{fields.get('first_name', '')} {fields.get('last_name', '')}".strip()),
        ("DNI", fields.get("dni", "")),
        ("Empresa", fields.get("company", "")),
        ("Correo", fields.get("email", "")),
        ("Celular", fields.get("mobile", "")),
        ("Cargo", fields.get("role", "")),
    ]
    y = qr_y + qh + 55
    for label, value in labels:
        cv2.putText(canvas, f"{label}:", (border + 30, y), cv2.FONT_HERSHEY_SIMPLEX,
                    0.55, _GOLD, 1, cv2.LINE_AA)
        cv2.putText(canvas, str(value) if value else "-", (border + 190, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.55, _WHITE, 1, cv2.LINE_AA)
        y += 42

    ok, buf = cv2.imencode(".png", canvas)
    if not ok:
        raise RuntimeError("fotocheck_png_encode_failed")
    return buf.tobytes()
