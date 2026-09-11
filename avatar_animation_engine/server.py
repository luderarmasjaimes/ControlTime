"""Servicio HTTP dedicado al avatar ANIMADO (reenactment/lip-sync, ADR-150).
Aislado de ai_engine y de avatar_engine a propósito, mismo patrón que
avatar_engine/server.py (ADR-141): un backend de GPU por proceso, cola con
tope, timeout real, preload síncrono antes del readiness.

Contrato:
- POST /animate, multipart "image" (requerida) + "audio" y/o "video"
  (según lo que soporte el backend activo) -> 200 con Content-Type video/mp4
  y el video en el body, o error explícito JSON (400/413/503 not_ready/busy/
  gpu_required, 504 timeout, 500 excepción) -- nunca cuelga sin responder.
- GET /health -> ready=true solo si el backend ya cargó (preload síncrono
  ANTES de aceptar tráfico real, ver __main__ más abajo).
"""

import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import cv2
import numpy as np
from flask import Flask, Response, jsonify, request

from backends import GpuRequiredError, ModelLoadError, get_backend

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s avatar_animation_engine %(levelname)s %(message)s",
)
log = logging.getLogger("avatar_animation_engine")

app = Flask(__name__)

ENGINE_NAME = os.environ.get("AVATAR_ANIMATION_ENGINE", "sadtalker")

# Concurrencia=1 real, mismo criterio que avatar_engine (ADR-141): un único
# worker ejecuta la GPU, cola con tope en vez de acumular sin límite.
_executor = ThreadPoolExecutor(max_workers=1)
_queue_depth = 0
_queue_lock = threading.Lock()
MAX_QUEUE_DEPTH = int(os.environ.get("AVATAR_ANIMATION_MAX_QUEUE", "3"))
INFERENCE_TIMEOUT_SECONDS = float(os.environ.get("AVATAR_ANIMATION_TIMEOUT_SECONDS", "180"))
MAX_IMAGE_BYTES = int(os.environ.get("AVATAR_ANIMATION_MAX_IMAGE_BYTES", "5000000"))
MAX_AUDIO_BYTES = int(os.environ.get("AVATAR_ANIMATION_MAX_AUDIO_BYTES", "15000000"))

if MAX_QUEUE_DEPTH < 1:
    raise ValueError("AVATAR_ANIMATION_MAX_QUEUE debe ser >= 1")
if INFERENCE_TIMEOUT_SECONDS <= 0:
    raise ValueError("AVATAR_ANIMATION_TIMEOUT_SECONDS debe ser > 0")

_backend = None
_device = "cpu"
_ready = False

_stats_lock = threading.Lock()
_stats = {"ok": 0, "timeout": 0, "busy": 0, "error": 0}


def _release_queue_slot(_future) -> None:
    """Libera el cupo cuando termina el trabajo real, no cuando vence HTTP --
    una inferencia GPU/subproceso no se cancela de forma segura desde otro
    hilo. Mismo criterio que avatar_engine/server.py."""
    global _queue_depth
    with _queue_lock:
        _queue_depth -= 1


@app.route("/health", methods=["GET"])
def health():
    body = {
        "status": "ok" if _ready else "not_ready",
        "ready": _ready,
        "engine": ENGINE_NAME,
        "device": _device,
        "queue_depth": _queue_depth,
        "max_queue_depth": MAX_QUEUE_DEPTH,
        "timeout_seconds": INFERENCE_TIMEOUT_SECONDS,
        "stats": dict(_stats),
    }
    return jsonify(body), (200 if _ready else 503)


@app.route("/animate", methods=["POST"])
def animate():
    global _queue_depth
    if not _ready or _backend is None:
        with _stats_lock:
            _stats["error"] += 1
        return jsonify({"ok": False, "error": "not_ready"}), 503

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image"}), 400
    image_raw = request.files["image"].read()
    if not image_raw:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    if len(image_raw) > MAX_IMAGE_BYTES:
        return jsonify({"ok": False, "error": "image_too_large"}), 413
    nparr = np.frombuffer(image_raw, np.uint8)
    source_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if source_bgr is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400

    audio_bytes = None
    if "audio" in request.files:
        audio_bytes = request.files["audio"].read()
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            return jsonify({"ok": False, "error": "audio_too_large"}), 413

    video_bytes_in = None
    if "video" in request.files:
        video_bytes_in = request.files["video"].read()
        if len(video_bytes_in) > MAX_AUDIO_BYTES:
            return jsonify({"ok": False, "error": "video_too_large"}), 413

    # Integración a producto (ADR-150): las funcionalidades pre-renderizadas
    # (bienvenida/onboarding/informes/KPIs) no siempre tienen un WAV ya
    # grabado -- "text" alterna a TTS local dentro del backend (ver
    # sadtalker_backend.py::_synthesize_tts_wav), sin exigirle al backend C++
    # que sintetice audio (no tiene proveedor TTS, ver report_export_jobs.hpp).
    driving_text = request.form.get("text", "").strip() or None
    if audio_bytes is None and video_bytes_in is None and driving_text is None:
        return jsonify({"ok": False, "error": "no_driving_signal"}), 400

    transparent_bg = request.form.get("transparent_bg", "").strip().lower() in ("1", "true", "yes")

    with _queue_lock:
        if _queue_depth >= MAX_QUEUE_DEPTH:
            with _stats_lock:
                _stats["busy"] += 1
            log.warning("animate rejected: queue_depth=%d >= %d", _queue_depth, MAX_QUEUE_DEPTH)
            return jsonify({"ok": False, "error": "busy"}), 503
        _queue_depth += 1

    req_id = f"{int(time.time() * 1000)}-{threading.get_ident()}"
    t0 = time.monotonic()
    try:
        future = _executor.submit(
            _backend.animate, source_bgr, audio_bytes, video_bytes_in,
            driving_text, transparent_bg,
        )
    except Exception:
        with _queue_lock:
            _queue_depth -= 1
        with _stats_lock:
            _stats["error"] += 1
        log.exception("animate submit failure req_id=%s", req_id)
        return jsonify({"ok": False, "error": "internal_error"}), 500
    future.add_done_callback(_release_queue_slot)

    try:
        try:
            animate_output = future.result(timeout=INFERENCE_TIMEOUT_SECONDS)
        except FutureTimeoutError:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            with _stats_lock:
                _stats["timeout"] += 1
            log.warning(
                "animate timeout req_id=%s elapsed_ms=%d timeout_s=%s "
                "(el trabajo puede seguir en background; concurrencia=1, el "
                "próximo request igual espera su turno)",
                req_id, elapsed_ms, INFERENCE_TIMEOUT_SECONDS,
            )
            return jsonify({"ok": False, "error": "timeout"}), 504
        except Exception as exc:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            with _stats_lock:
                _stats["error"] += 1
            log.exception("animate inference failure req_id=%s elapsed_ms=%d", req_id, elapsed_ms)
            return jsonify({"ok": False, "error": "inference_failed", "detail": str(exc)[:500]}), 500
    except Exception:
        with _stats_lock:
            _stats["error"] += 1
        log.exception("animate orchestration failure req_id=%s", req_id)
        return jsonify({"ok": False, "error": "internal_error"}), 500

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    with _stats_lock:
        _stats["ok"] += 1
    log.info(
        "animate ok req_id=%s elapsed_ms=%d bytes=%d content_type=%s",
        req_id, elapsed_ms, len(animate_output.video_bytes), animate_output.content_type,
    )
    resp = Response(animate_output.video_bytes, mimetype=animate_output.content_type)
    resp.headers["X-Elapsed-Ms"] = str(elapsed_ms)
    resp.headers["X-Backend"] = ENGINE_NAME
    return resp


def _preload():
    """Bloqueante a propósito, mismo criterio que avatar_engine (ADR-141):
    si falla, el proceso termina sin abrir el puerto y el healthcheck falla
    desde el arranque (restart: unless-stopped reintenta)."""
    global _backend, _device, _ready
    log.info("preloading avatar_animation_engine backend=%s...", ENGINE_NAME)
    t0 = time.monotonic()
    _backend = get_backend(ENGINE_NAME)
    _device = _backend.load()
    _ready = True
    log.info(
        "backend ready engine=%s device=%s elapsed_s=%.1f",
        ENGINE_NAME, _device, time.monotonic() - t0,
    )


if __name__ == "__main__":
    try:
        _preload()
    except GpuRequiredError as exc:
        log.error("startup aborted, GPU required: %s", exc)
        sys.exit(1)
    except (ModelLoadError, ValueError, NotImplementedError) as exc:
        log.error("startup aborted, model load failed: %s", exc)
        sys.exit(1)

    from waitress import serve

    serve(app, host="0.0.0.0", port=5003, threads=8)
