"""
Cliente HTTP hacia el servicio `silentface_engine` (Silent-Face-Anti-
Spoofing, PyTorch). Ver silentface_engine/server.py para el porqué de la
separación (conflicto real de cuDNN con TensorFlow, mismo motivo que
avatar_engine).

A diferencia de avatar_diffusion.py (best-effort, cae a un fallback
cosmético), esto es un chequeo de seguridad primario: NO hay fallback.
Cualquier fallo -- servicio caído, no listo, timeout, red -- se traduce a
`status="unavailable"`, y el llamador (deepface_silentface_adapter.py) debe
rechazar la verificación exactamente igual que cuando el detector no
cargaba en el código in-process original (error "silentface_unavailable",
fail-closed). Nunca se interpreta un fallo de infraestructura como "persona
real verificada".
"""

import os
import time
from typing import Any, Dict

import requests


def _silentface_engine_url() -> str:
    base = os.environ.get("SILENTFACE_ENGINE_URL", "http://silentface_engine:5002").strip()
    return base.rstrip("/")


def check_liveness(raw: bytes) -> Dict[str, Any]:
    """
    Devuelve siempre uno de:
      {"status": "unavailable", "detail": str}
      {"status": "inference_failed", "detail": str}
      {"status": "ok", "real": bool, "confidence": float, "liveness_error": str}

    Nunca lanza excepción -- todo camino de fallo vuelve como "unavailable"
    o "inference_failed" para que el llamador rechace la verificación
    (fail-closed), nunca la apruebe por defecto.
    """
    timeout_s = float(os.environ.get("SILENTFACE_ENGINE_CLIENT_TIMEOUT_SECONDS", "8"))
    url = f"{_silentface_engine_url()}/check_liveness"
    t0 = time.monotonic()
    try:
        resp = requests.post(
            url,
            files={"image": ("frame.jpg", raw, "application/octet-stream")},
            timeout=timeout_s,
        )
    except requests.RequestException as exc:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        print(f"[SILENTFACE_CLIENT] unavailable (red) elapsed_ms={elapsed_ms} detail={exc}", flush=True)
        return {"status": "unavailable", "detail": str(exc)}

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    if resp.status_code == 503:
        detail = None
        try:
            detail = resp.json().get("detail")
        except Exception:
            pass
        print(f"[SILENTFACE_CLIENT] unavailable (503 not_ready) elapsed_ms={elapsed_ms}", flush=True)
        return {"status": "unavailable", "detail": detail or "not_ready"}

    if resp.status_code >= 500:
        print(f"[SILENTFACE_CLIENT] inference_failed status={resp.status_code} elapsed_ms={elapsed_ms}", flush=True)
        return {"status": "inference_failed", "detail": f"http_{resp.status_code}"}

    if resp.status_code == 400:
        # Errores de imagen (no_image/empty_image/invalid_image/...) --
        # el llamador ya validó la imagen antes de llegar acá en el flujo
        # normal, pero por completitud se trata como fallo de inferencia,
        # no de infraestructura (el servicio SÍ está disponible).
        try:
            detail = resp.json().get("error", "bad_request")
        except Exception:
            detail = "bad_request"
        return {"status": "inference_failed", "detail": detail}

    if resp.status_code != 200:
        print(f"[SILENTFACE_CLIENT] unavailable (status inesperado {resp.status_code}) elapsed_ms={elapsed_ms}", flush=True)
        return {"status": "unavailable", "detail": f"unexpected_status_{resp.status_code}"}

    try:
        data = resp.json()
        if not data.get("ok"):
            return {"status": "inference_failed", "detail": data.get("error", "unknown")}
        return {
            "status": "ok",
            "real": bool(data["real"]),
            "confidence": float(data["confidence"]),
            "liveness_error": data.get("liveness_error", ""),
        }
    except Exception as exc:
        print(f"[SILENTFACE_CLIENT] inference_failed (respuesta invalida) detail={exc}", flush=True)
        return {"status": "inference_failed", "detail": f"invalid_response: {exc}"}


def remote_status() -> Dict[str, Any]:
    """GET /health del servicio remoto, con timeout corto -- usado solo
    para enriquecer status() localmente, nunca bloquea una verificación
    real (eso pasa por check_liveness, que tiene su propio timeout)."""
    timeout_s = float(os.environ.get("SILENTFACE_ENGINE_HEALTH_TIMEOUT_SECONDS", "2"))
    url = f"{_silentface_engine_url()}/health"
    try:
        resp = requests.get(url, timeout=timeout_s)
        data = resp.json()
        data["_reachable"] = True
        return data
    except Exception as exc:
        return {"_reachable": False, "ready": False, "error": str(exc)}
