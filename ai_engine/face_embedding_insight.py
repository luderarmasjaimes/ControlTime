"""
Embedding facial con InsightFace (modelos ONNX + onnxruntime).
Usado para registro/login de alta seguridad frente a la plantilla legacy 24×24.
"""
from __future__ import annotations

import os
import threading
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

# InsightFace 0.7.3 (ultima release en PyPI, ver requirements.txt) usa
# np.int en insightface/app/face_analysis.py:84 -- alias eliminado en
# NumPy 1.24+ (AttributeError en seco). El fix ya esta en la rama master
# del proyecto pero nunca se publico a PyPI (github.com/deepinsight/
# insightface/issues/2404), asi que restauramos el alias nosotros antes
# de importar el paquete, sin tocar su codigo ni depender de un install
# desde GitHub sin pin.
for _np_alias, _np_replacement in (
    ("int", int),
    ("float", float),
    ("bool", bool),
    ("object", object),
    ("str", str),
):
    if not hasattr(np, _np_alias):
        setattr(np, _np_alias, _np_replacement)

# InsightFace crea sus 5 sesiones de onnxruntime (buffalo_l) sin pasar
# SessionOptions propio -- insightface.model_zoo.model_zoo.get_model() solo
# reenvia "providers"/"provider_options" a InferenceSession, descartando
# cualquier otro kwarg (no hay forma de fijar intra_op_num_threads via la
# API publica de FaceAnalysis). Sin limite, onnxruntime detecta los nucleos
# del HOST (via std::thread::hardware_concurrency, que en Linux dentro de un
# contenedor no respeta el cuota de cgroup del "cpus:" de docker-compose) y
# crea un pool de hilos muy por encima de lo que el contenedor puede
# ejecutar de verdad -- sobre-suscripcion clasica de Docker: se midio
# /face_embedding a 4-7s con 398% CPU (saturando el limite de 4 CPU) para
# una imagen de 640x640, cuando deberia tardar unos cientos de ms.
# Se parchea onnxruntime.InferenceSession globalmente para inyectar un
# limite conservador cuando el llamador no especifica sess_options -- no
# afecta a glasses_fusion.py, que ya fija su propio sess_options (queda
# intacto por el chequeo "is None" de abajo).
import onnxruntime as _ort  # noqa: E402

_ORT_THREADS = max(1, int(os.environ.get("INSIGHTFACE_ORT_THREADS", "2")))
_ort_session_init_original = _ort.InferenceSession.__init__


def _ort_session_init_thread_limited(self, *args, **kwargs):
    if kwargs.get("sess_options") is None:
        so = _ort.SessionOptions()
        so.intra_op_num_threads = _ORT_THREADS
        so.inter_op_num_threads = _ORT_THREADS
        kwargs["sess_options"] = so
    return _ort_session_init_original(self, *args, **kwargs)


_ort.InferenceSession.__init__ = _ort_session_init_thread_limited

_lock = threading.Lock()
_analyzer = None  # type: Optional[Any]
_analyzer_error: Optional[str] = None


def embedding_engine_status() -> Dict[str, Any]:
    """
    Estado sin forzar carga del modelo (evita descargas en cada GET /health).
    Tras warmup o primer POST /face_embedding, refleja ready/error reales.
    """
    global _analyzer, _analyzer_error
    with _lock:
        fa = _analyzer
        err = _analyzer_error
    root = os.environ.get("INSIGHTFACE_ROOT", "/app/.insightface").strip() or "/app/.insightface"
    name = os.environ.get("FACE_ANALYSIS_NAME", "buffalo_l").strip() or "buffalo_l"
    out: Dict[str, Any] = {
        "ready": fa is not None,
        "error": err,
        "model_name": name,
        "root": root,
    }
    if fa is None and err is None:
        out["pending_init"] = True
    return out


def _get_analyzer():
    global _analyzer, _analyzer_error
    with _lock:
        if _analyzer is not None or _analyzer_error is not None:
            return _analyzer, _analyzer_error
        try:
            from insightface.app import FaceAnalysis

            root = os.environ.get("INSIGHTFACE_ROOT", "/app/.insightface").strip()
            if not root:
                root = "/app/.insightface"
            name = os.environ.get("FACE_ANALYSIS_NAME", "buffalo_l").strip() or "buffalo_l"
            prov_raw = os.environ.get(
                "ONNXRUNTIME_PROVIDERS", "CPUExecutionProvider"
            ).strip()
            providers = [p.strip() for p in prov_raw.split(",") if p.strip()]
            if not providers:
                providers = ["CPUExecutionProvider"]
            det = int(os.environ.get("FACE_ANALYSIS_DET_SIZE", "640"))
            det = max(160, min(1280, det))
            fa = FaceAnalysis(name=name, root=root, providers=providers)
            fa.prepare(ctx_id=-1, det_size=(det, det))
            _analyzer = fa
            print(
                f"[FACE_EMB] InsightFace listo: name={name} root={root} det={det}",
                flush=True,
            )
        except Exception as e:  # noqa: BLE001
            _analyzer_error = str(e)
            print(f"[FACE_EMB] Error cargando InsightFace: {e}", flush=True)
        return _analyzer, _analyzer_error


def extract_normed_embedding_bgr(img_bgr: np.ndarray) -> Tuple[Optional[np.ndarray], Optional[str]]:
    """
    Devuelve vector L2-normalizado (típ. dim 512) o (None, código/mensaje error).
    """
    if img_bgr is None or img_bgr.size == 0:
        return None, "empty_image"
    fa, err = _get_analyzer()
    if fa is None:
        return None, err or "insightface_unavailable"
    faces = fa.get(img_bgr)
    if not faces:
        return None, "no_face"
    min_det = float(os.environ.get("FACE_EMBED_MIN_DET_SCORE", "0.40"))
    best_area = -1.0
    best_face = None
    for f in faces:
        sc = float(getattr(f, "det_score", 1.0))
        if sc < min_det:
            continue
        bb = f.bbox
        area = float(max(0.0, bb[2] - bb[0]) * max(0.0, bb[3] - bb[1]))
        if area > best_area:
            best_area = area
            best_face = f
    if best_face is None:
        return None, "low_det_score"
    emb = np.asarray(best_face.normed_embedding, dtype=np.float64)
    n = float(np.linalg.norm(emb))
    if n > 1e-9:
        emb = emb / n
    return emb, None


def warmup_face_embedding() -> None:
    """Precarga modelos al arranque (descarga en build o primer uso)."""
    _get_analyzer()
