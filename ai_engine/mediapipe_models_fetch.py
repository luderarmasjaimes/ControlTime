"""
Descarga idempotente de modelos MediaPipe desde storage.googleapis.com.
Se ejecuta al inicio del contenedor (entrypoint) y/o al importar eye_analyzer.

- face_landmarker.task: obligatorio (sin él no arranca el motor).
- selfie_segmenter.tflite: recomendado para avatar local; si falla, se registra aviso
  y el motor sigue (fallback GrabCut en cartoon).
"""
from __future__ import annotations

import os
import sys
import time

import requests

_APP_DIR = os.path.dirname(os.path.abspath(__file__))

# (nombre, variable env, nombre archivo por defecto en /app, URL CDN, obligatorio)
_MODEL_SPECS: list[tuple[str, str, str, str, bool]] = [
    (
        "face_landmarker",
        "FACE_LANDMARKER_MODEL",
        "face_landmarker.task",
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
        "face_landmarker/float16/1/face_landmarker.task",
        True,
    ),
    (
        "selfie_segmenter",
        "SELFIE_SEGMENTER_MODEL",
        "selfie_segmenter.tflite",
        "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
        "selfie_segmenter/float16/latest/selfie_segmenter.tflite",
        False,
    ),
]

_MIN_BYTES_FACE = 50_000
_MIN_BYTES_SELFIE = 5_000
_DEFAULT_RETRIES = int(os.environ.get("MEDIAPIPE_MODEL_DOWNLOAD_RETRIES", "5"))
_DEFAULT_TIMEOUT = int(os.environ.get("MEDIAPIPE_MODEL_DOWNLOAD_TIMEOUT_S", "180"))


def _resolve_model_path(env_key: str, default_name: str) -> str:
    raw = os.environ.get(env_key, "").strip() or default_name
    if os.path.isabs(raw):
        return raw
    return os.path.join(_APP_DIR, raw)


def get_face_model_path() -> str:
    return _resolve_model_path("FACE_LANDMARKER_MODEL", "face_landmarker.task")


def get_selfie_model_path() -> str:
    return _resolve_model_path("SELFIE_SEGMENTER_MODEL", "selfie_segmenter.tflite")


def _min_size_for(name: str) -> int:
    return _MIN_BYTES_FACE if "landmarker" in name else _MIN_BYTES_SELFIE


def _already_ok(path: str, name: str) -> bool:
    if not os.path.isfile(path):
        return False
    try:
        return os.path.getsize(path) >= _min_size_for(name)
    except OSError:
        return False


def _download_file(url: str, dest: str, timeout: int) -> None:
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    tmp = dest + ".part"
    try:
        with requests.get(url, stream=True, timeout=timeout) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        f.write(chunk)
        os.replace(tmp, dest)
    finally:
        if os.path.isfile(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def fetch_model(
    name: str,
    env_key: str,
    default_name: str,
    url: str,
    required: bool,
    *,
    retries: int = _DEFAULT_RETRIES,
    timeout: int = _DEFAULT_TIMEOUT,
) -> bool:
    path = _resolve_model_path(env_key, default_name)
    if _already_ok(path, name):
        print(f"[mediapipe_models] OK (ya existe): {name} -> {path}", flush=True)
        return True

    if name == "selfie_segmenter" and os.environ.get(
        "MEDIAPIPE_SKIP_SELFIE", ""
    ).strip().lower() in ("1", "true", "yes"):
        print(
            "[mediapipe_models] Selfie omitido (MEDIAPIPE_SKIP_SELFIE).",
            flush=True,
        )
        return not required

    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            print(
                f"[mediapipe_models] Descargando {name} "
                f"(intento {attempt}/{retries}) desde CDN...",
                flush=True,
            )
            _download_file(url, path, timeout=timeout)
            if not _already_ok(path, name):
                raise RuntimeError(
                    f"archivo demasiado pequeño o vacío: {os.path.getsize(path)} bytes"
                )
            print(
                f"[mediapipe_models] OK {name}: {path} "
                f"({os.path.getsize(path)} bytes)",
                flush=True,
            )
            return True
        except Exception as ex:  # noqa: BLE001
            last_err = ex
            print(f"[mediapipe_models] Fallo {name}: {ex}", flush=True)
            if attempt < retries:
                time.sleep(min(2**attempt, 30))

    print(
        f"[mediapipe_models] ERROR: no se pudo obtener {name} tras {retries} intentos: "
        f"{last_err}",
        flush=True,
    )
    if required:
        return False
    print(
        f"[mediapipe_models] Aviso: {name} no disponible; funciones que lo usen "
        "usarán fallback.",
        flush=True,
    )
    return True


def ensure_mediapipe_models() -> bool:
    """
    Descarga lo que falte. Devuelve False solo si falla un modelo obligatorio.
    """
    ok = True
    for name, env_key, default_name, url, required in _MODEL_SPECS:
        if not fetch_model(name, env_key, default_name, url, required):
            ok = False
    return ok


def main() -> int:
    if not ensure_mediapipe_models():
        print(
            "[mediapipe_models] Abort: falta al menos un modelo obligatorio.",
            flush=True,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
