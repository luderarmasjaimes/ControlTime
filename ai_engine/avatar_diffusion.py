"""
Cliente HTTP hacia el servicio `avatar_engine` (SD1.5 img2img + ControlNet-
Canny, ADR-141). El pipeline de difusión NO corre en este proceso: vive en
un contenedor aparte, `avatar_engine`, aislado a propósito de TensorFlow
(ver avatar_engine/avatar_diffusion.py y la actualización 2026-09-03 del
ADR-141 -- conflicto real e irreconciliable de cuDNN entre torch==2.11.0+cu128
y tensorflow[and-cuda]==2.15.1 en el mismo proceso).

Deshabilitado por defecto (AVATAR_STYLE_ENGINE=classic). Solo se activa con
AVATAR_STYLE_ENGINE=diffusion, y aun así es "best effort": cualquier fallo
(avatar_engine caído, no listo, ocupado, timeout, excepción) devuelve None
y el llamador (_cartoonify_face_bgr en eye_analyzer.py) cae al estilizador
clásico (_local_avatar_stylize) sin romper el registro del usuario -- mismo
patrón que fetchCartoonAvatarBestEffort en el backend C++.
"""

import os
import threading
import time
from typing import Optional

import cv2
import numpy as np
import requests

_stats_lock = threading.Lock()
_stats = {
    "diffusion": 0,
    "classic_fallback": 0,
    "failed": 0,
    "quality_rejected": 0,
}


def is_enabled() -> bool:
    return os.environ.get("AVATAR_STYLE_ENGINE", "").strip().lower() == "diffusion"


def _avatar_engine_url() -> str:
    base = os.environ.get("AVATAR_ENGINE_URL", "http://avatar_engine:5001").strip()
    return base.rstrip("/")


def stats() -> dict:
    with _stats_lock:
        return dict(_stats)


def record_classic_fallback() -> None:
    with _stats_lock:
        _stats["classic_fallback"] += 1


def record_failed() -> None:
    with _stats_lock:
        _stats["failed"] += 1


def record_quality_rejected() -> None:
    """Registra una salida HTTP válida descartada por control visual local."""
    with _stats_lock:
        _stats["quality_rejected"] += 1


def stylize_portrait_diffusion(
    work_bgr: np.ndarray, alpha_f: np.ndarray, seed: Optional[int] = None
) -> Optional[np.ndarray]:
    """
    work_bgr: recorte de rostro sobre fondo blanco (mismo insumo que recibe
    _local_avatar_stylize). alpha_f: sin uso acá (se mantiene en la firma
    por compatibilidad con el llamador) -- el servicio remoto solo necesita
    la imagen ya compuesta sobre blanco.

    seed: si viene, se envía como override para esta sola llamada (ver
    avatar_engine/avatar_diffusion.py::stylize_portrait) -- usado por el
    reintento de calidad en _cartoonify_face_bgr (CA-15(a)/ADR-141
    2026-09-03): la seed fija por defecto colapsa de forma idiosincrática
    en algunas fotos, sin relación estable con ningún parámetro global.

    Devuelve BGR uint8 del mismo tamaño que work_bgr, o None si falla por
    cualquier motivo -- el llamador debe caer al estilizador clásico.
    """
    if not is_enabled():
        return None

    ok_png, buf = cv2.imencode(".png", work_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 3])
    if not ok_png:
        record_failed()
        return None

    try:
        timeout_s = float(
            os.environ.get("AVATAR_ENGINE_CLIENT_TIMEOUT_SECONDS", "50")
        )
        if timeout_s <= 0:
            raise ValueError("timeout must be positive")
    except (TypeError, ValueError):
        timeout_s = 50.0
    url = f"{_avatar_engine_url()}/stylize"
    form_data = {"seed": str(int(seed))} if seed is not None else None
    t0 = time.monotonic()
    try:
        resp = requests.post(
            url,
            files={"image": ("work.png", buf.tobytes(), "image/png")},
            data=form_data,
            timeout=timeout_s,
        )
    except requests.RequestException:
        record_classic_fallback()
        return None

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    if resp.status_code != 200:
        print(
            f"[AVATAR_DIFFUSION] classic_fallback status={resp.status_code} "
            f"elapsed_ms={elapsed_ms}",
            flush=True,
        )
        record_classic_fallback()
        return None

    try:
        data = resp.json()
        if not data.get("ok"):
            print(
                f"[AVATAR_DIFFUSION] classic_fallback error={data.get('error')} "
                f"elapsed_ms={elapsed_ms}",
                flush=True,
            )
            record_classic_fallback()
            return None
        import base64

        png_bytes = base64.b64decode(data["image_base64"])
        nparr = np.frombuffer(png_bytes, np.uint8)
        out_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if out_bgr is None:
            record_failed()
            return None
    except Exception as exc:
        print(f"[AVATAR_DIFFUSION] failed decoding response: {exc}", flush=True)
        record_failed()
        return None

    th, tw = work_bgr.shape[:2]
    if out_bgr.shape[:2] != (th, tw):
        out_bgr = cv2.resize(out_bgr, (tw, th), interpolation=cv2.INTER_LANCZOS4)

    print(f"[AVATAR_DIFFUSION] ok elapsed_ms={elapsed_ms}", flush=True)
    with _stats_lock:
        _stats["diffusion"] += 1
    return out_bgr
