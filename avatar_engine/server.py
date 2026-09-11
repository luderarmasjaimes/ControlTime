"""
Servicio HTTP dedicado al avatar por difusión local (ADR-141). Aislado de
ai_engine a propósito (conflicto real e irreconciliable de cuDNN entre
torch y tensorflow[and-cuda] en el mismo proceso -- ver avatar_diffusion.py
y el ADR).

Contrato con el llamador (ai_engine/avatar_diffusion.py, cliente HTTP):
- POST /stylize, multipart "image" -> 200 {"ok": true, "image_base64": ...}
  o error explícito (503 not_ready / busy / gpu_required, 504 timeout,
  500 excepción) -- nunca cuelga sin responder.
- GET /health -> ready=true solo si el pipeline ya cargó (modelos
  precargados ANTES de aceptar tráfico real, ver __main__ más abajo).
"""

import base64
import logging
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

import cv2
import numpy as np
from flask import Flask, jsonify, request

import avatar_diffusion as diffusion

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s avatar_engine %(levelname)s %(message)s",
)
log = logging.getLogger("avatar_engine")

app = Flask(__name__)

# Concurrencia=1 real: un único worker thread ejecuta la GPU, sin importar
# cuántos hilos HTTP de waitress reciban requests a la vez -- el executor
# serializa la inferencia (ADR-141: "ejecutarlo con una sola inferencia
# simultánea"). max_queue evita que se acumulen requests sin límite si
# llegan varias registraciones a la vez: más allá de esa profundidad se
# responde "busy" de inmediato en vez de encolar indefinidamente.
_executor = ThreadPoolExecutor(max_workers=1)
_queue_depth = 0
_queue_lock = threading.Lock()
MAX_QUEUE_DEPTH = int(os.environ.get("AVATAR_ENGINE_MAX_QUEUE", "3"))
INFERENCE_TIMEOUT_SECONDS = float(os.environ.get("AVATAR_ENGINE_TIMEOUT_SECONDS", "45"))
MAX_IMAGE_BYTES = int(os.environ.get("AVATAR_ENGINE_MAX_IMAGE_BYTES", "5000000"))

if MAX_QUEUE_DEPTH < 1:
    raise ValueError("AVATAR_ENGINE_MAX_QUEUE debe ser >= 1")
if INFERENCE_TIMEOUT_SECONDS <= 0:
    raise ValueError("AVATAR_ENGINE_TIMEOUT_SECONDS debe ser > 0")
if MAX_IMAGE_BYTES < 1024:
    raise ValueError("AVATAR_ENGINE_MAX_IMAGE_BYTES debe ser >= 1024")

_pipe = None
_gfpgan = None
_device = "cpu"
_ready = False

_stats_lock = threading.Lock()
_stats = {"ok": 0, "timeout": 0, "busy": 0, "error": 0}


def _release_queue_slot(_future) -> None:
    """Libera el cupo cuando termina el trabajo real, no cuando vence HTTP.

    Una inferencia CUDA no se puede cancelar de forma segura desde otro hilo.
    Si el cliente recibe timeout, el future continúa; mantenerlo contado evita
    que timeouts repetidos acumulen una cola ilimitada detrás de la GPU.
    """
    global _queue_depth
    with _queue_lock:
        _queue_depth -= 1


@app.route("/health", methods=["GET"])
def health():
    body = {
        "status": "ok" if _ready else "not_ready",
        "ready": _ready,
        "device": _device,
        "sd15_repo": diffusion.SD15_REPO,
        "sd15_revision": diffusion.SD15_REVISION,
        "controlnet_repo": diffusion.CONTROLNET_CANNY_REPO,
        "controlnet_revision": diffusion.CONTROLNET_CANNY_REVISION,
        "gfpgan_enabled": _gfpgan is not None,
        "queue_depth": _queue_depth,
        "max_queue_depth": MAX_QUEUE_DEPTH,
        "timeout_seconds": INFERENCE_TIMEOUT_SECONDS,
        "max_image_bytes": MAX_IMAGE_BYTES,
        "stats": dict(_stats),
    }
    return jsonify(body), (200 if _ready else 503)


@app.route("/stylize", methods=["POST"])
def stylize():
    global _queue_depth
    if not _ready or _pipe is None:
        with _stats_lock:
            _stats["error"] += 1
        return jsonify({"ok": False, "error": "not_ready"}), 503

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image"}), 400
    raw = request.files["image"].read()
    if not raw:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    if len(raw) > MAX_IMAGE_BYTES:
        return jsonify({"ok": False, "error": "image_too_large"}), 413
    nparr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400

    seed_override = None
    seed_raw = request.form.get("seed")
    if seed_raw is not None and seed_raw.strip():
        try:
            seed_override = int(seed_raw)
        except ValueError:
            return jsonify({"ok": False, "error": "invalid_seed"}), 400

    with _queue_lock:
        if _queue_depth >= MAX_QUEUE_DEPTH:
            with _stats_lock:
                _stats["busy"] += 1
            log.warning("stylize rejected: queue_depth=%d >= %d", _queue_depth, MAX_QUEUE_DEPTH)
            return jsonify({"ok": False, "error": "busy"}), 503
        _queue_depth += 1

    req_id = f"{int(time.time() * 1000)}-{threading.get_ident()}"
    t0 = time.monotonic()
    try:
        future = _executor.submit(
            diffusion.stylize_portrait, _pipe, _device, img, seed_override
        )
    except Exception:
        with _queue_lock:
            _queue_depth -= 1
        with _stats_lock:
            _stats["error"] += 1
        log.exception("stylize submit failure req_id=%s", req_id)
        return jsonify({"ok": False, "error": "internal_error"}), 500
    future.add_done_callback(_release_queue_slot)
    try:
        try:
            out_bgr = future.result(timeout=INFERENCE_TIMEOUT_SECONDS)
        except FutureTimeoutError:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            with _stats_lock:
                _stats["timeout"] += 1
            log.warning(
                "stylize timeout req_id=%s elapsed_ms=%d timeout_s=%s "
                "(la inferencia puede seguir corriendo en background; el "
                "próximo request igual espera su turno, concurrencia=1)",
                req_id, elapsed_ms, INFERENCE_TIMEOUT_SECONDS,
            )
            return jsonify({"ok": False, "error": "timeout"}), 504
        except Exception:
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            with _stats_lock:
                _stats["error"] += 1
            log.exception("stylize inference failure req_id=%s elapsed_ms=%d", req_id, elapsed_ms)
            return jsonify({"ok": False, "error": "inference_failed"}), 500
    except Exception:
        # Defensa final del endpoint: ningún fallo de orquestación debe salir
        # como página HTML de Flask ni omitir la métrica de error.
        with _stats_lock:
            _stats["error"] += 1
        log.exception("stylize orchestration failure req_id=%s", req_id)
        return jsonify({"ok": False, "error": "internal_error"}), 500

    # Post-proceso opcional (2026-09-04): restauración facial GFPGAN sobre la
    # salida ya estilizada. enhance_with_gfpgan nunca lanza -- si falla o
    # está deshabilitado (_gfpgan is None), devuelve out_bgr sin tocar.
    out_bgr = diffusion.enhance_with_gfpgan(_gfpgan, out_bgr)

    # Insignia del logo Beemetry (ADR-164), compositing determinístico --
    # nunca lanza, ver apply_logo_badge.
    out_bgr = diffusion.apply_logo_badge(out_bgr)

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    try:
        ok_png, buf = cv2.imencode(".png", out_bgr, [cv2.IMWRITE_PNG_COMPRESSION, 3])
        if not ok_png:
            raise RuntimeError("cv2.imencode failed")
        b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    except Exception:
        log.exception("stylize encode failure req_id=%s", req_id)
        with _stats_lock:
            _stats["error"] += 1
        return jsonify({"ok": False, "error": "encode_failed"}), 500

    with _stats_lock:
        _stats["ok"] += 1
    log.info(
        "stylize ok req_id=%s elapsed_ms=%d seed_override=%s",
        req_id, elapsed_ms, seed_override,
    )
    return jsonify({"ok": True, "image_base64": b64, "elapsed_ms": elapsed_ms})


def _preload():
    """Bloqueante a propósito -- ver ADR-141 ("precargar modelos antes del
    readiness"). Se llama antes de serve(); si lanza excepción, el proceso
    termina sin abrir el puerto y el healthcheck falla desde el arranque
    (restart: unless-stopped reintenta en docker-compose)."""
    global _pipe, _gfpgan, _device, _ready
    log.info("preloading SD1.5 + ControlNet-Canny pipeline...")
    t0 = time.monotonic()
    _pipe, _device = diffusion.load_pipeline()
    # GFPGAN es estrictamente opcional (load_gfpgan nunca lanza: devuelve
    # None ante cualquier fallo) -- un problema de red/pesos acá no debe
    # impedir que el servicio arranque y sirva SD1.5 sin mejorar.
    _gfpgan = diffusion.load_gfpgan(_device)
    _ready = True
    log.info(
        "pipeline ready device=%s gfpgan=%s elapsed_s=%.1f",
        _device, _gfpgan is not None, time.monotonic() - t0,
    )


if __name__ == "__main__":
    try:
        _preload()
    except diffusion.GpuRequiredError as exc:
        log.error("startup aborted, GPU required: %s", exc)
        sys.exit(1)
    except diffusion.ModelLoadError as exc:
        log.error("startup aborted, model load failed: %s", exc)
        sys.exit(1)

    from waitress import serve

    serve(app, host="0.0.0.0", port=5001, threads=8)
