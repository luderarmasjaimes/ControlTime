"""
Fusión CV + clasificador ONNX (opcional) para detección de gafas.

- La visión clásica (reflejo HSV, black-hat montura/puente) sigue siendo la base.
- Si existe GLASSES_ONNX_PATH y onnxruntime, se infiere P(gafas) en el ROI interocular.
- La señal fusionada 0–100 alimenta el EMA en C++ (Boost.Beast HTTP → mismo JSON).

No existe garantía estadística al 100 % en biometría por cámara; esta capa reduce
ambigüedad cuando hay modelo entrenado para el dominio (iluminación, tipo de montura).

Variables de entorno:
  GLASSES_ONNX_PATH          Ruta a .onnx (2 clases softmax o 1 logit sigmoide)
  GLASSES_FUSION_WEIGHT_AI   Peso del ONNX en [0,1], default 0.55
  GLASSES_ONNX_GLASSES_INDEX Índice de clase "gafas" en softmax si no hay meta (default 0)
  GLASSES_ONNX_INPUT_SIZE    Lado del cuadrado de entrada, default 224
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Optional, Tuple

import cv2
import numpy as np

_onnx_lock = threading.Lock()
_session = None  # type: Optional[Any]
_input_name: str = ""
_output_name: str = ""
_load_error: Optional[str] = None
_loaded_onnx_path: Optional[str] = None
_glasses_class_index_cached: Optional[int] = None


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except ValueError:
        return default


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except ValueError:
        return default


def onnx_available() -> bool:
    return _session is not None


def onnx_load_error() -> Optional[str]:
    return _load_error


def warmup_glasses_onnx() -> None:
    """Precarga sesión ONNX al arranque (evita primer frame lento)."""
    _ensure_session()


def _reset_onnx_cache() -> None:
    global _session, _input_name, _output_name, _load_error, _loaded_onnx_path, _glasses_class_index_cached
    _session = None
    _input_name = ""
    _output_name = ""
    _loaded_onnx_path = None
    _glasses_class_index_cached = None
    _load_error = None


def _glasses_class_index_for_path(onnx_path: str) -> int:
    """Índice softmax de 'con gafas': meta.json junto al .onnx o GLASSES_ONNX_GLASSES_INDEX."""
    global _glasses_class_index_cached
    if _glasses_class_index_cached is not None and _loaded_onnx_path == onnx_path:
        return _glasses_class_index_cached
    meta_path = os.environ.get("GLASSES_ONNX_META_PATH", "").strip()
    if not meta_path:
        meta_path = os.path.splitext(onnx_path)[0] + "_meta.json"
    if os.path.isfile(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            idx = int(meta.get("glasses_class_index", 0))
            _glasses_class_index_cached = max(0, idx)
            return _glasses_class_index_cached
        except (OSError, ValueError, TypeError, KeyError):
            pass
    _glasses_class_index_cached = max(0, _env_int("GLASSES_ONNX_GLASSES_INDEX", 0))
    return _glasses_class_index_cached


def _ensure_session() -> None:
    global _session, _input_name, _output_name, _load_error, _loaded_onnx_path, _glasses_class_index_cached
    # ADR-156: `_glasses_class_index_cached` faltaba en este `global` -- la
    # asignacion de mas abajo (antes del print de diagnostico) creaba una
    # variable LOCAL que tapaba la del modulo durante toda esta funcion, asi
    # que el log siempre imprimia "idx_gafas=None" aunque el indice real
    # (usado por infer_glasses_prob_onnx, que si declara el global en su
    # propio scope) se resolviera bien. Bug solo de diagnostico, nunca de
    # inferencia -- pero tapaba la senal justo cuando hacia falta confirmar
    # que el modelo v2 cargo con el indice correcto.
    path = os.environ.get("GLASSES_ONNX_PATH", "").strip()
    if not path:
        _load_error = None
        return
    if path != _loaded_onnx_path:
        _reset_onnx_cache()
        _loaded_onnx_path = path
    if _session is not None:
        return
    if not os.path.isfile(path):
        _load_error = f"GLASSES_ONNX_PATH no es archivo: {path}"
        return
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        _load_error = "onnxruntime no instalado (pip install onnxruntime)"
        return
    try:
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        inp = sess.get_inputs()[0]
        out = sess.get_outputs()[0]
        _session = sess
        _input_name = inp.name
        _output_name = out.name
        _load_error = None
        _glasses_class_index_cached = None
        _ = _glasses_class_index_for_path(path)
        print(
            f"[EYE_AI] ONNX gafas cargado: {path} in={_input_name} out={_output_name} "
            f"idx_gafas={_glasses_class_index_cached}",
            flush=True,
        )
    except Exception as e:
        _session = None
        _load_error = str(e)
        print(f"[EYE_AI] ONNX gafas error: {e}", flush=True)


def infer_glasses_prob_onnx(crop_bgr: np.ndarray) -> Optional[float]:
    """
    Devuelve P(gafas) en [0,1] o None si no hay modelo / error.
    """
    _ensure_session()
    if _session is None or crop_bgr is None or crop_bgr.size == 0:
        return None
    onnx_path = os.environ.get("GLASSES_ONNX_PATH", "").strip()
    g_idx = _glasses_class_index_for_path(onnx_path) if onnx_path else _env_int("GLASSES_ONNX_GLASSES_INDEX", 0)
    h, w = crop_bgr.shape[:2]
    if h < 8 or w < 8:
        return None

    side = max(32, min(512, _env_int("GLASSES_ONNX_INPUT_SIZE", 224)))
    img = cv2.resize(crop_bgr, (side, side), interpolation=cv2.INTER_AREA)
    x = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    x = (x - mean) / std
    x = np.transpose(x, (2, 0, 1))[np.newaxis, ...].astype(np.float32)

    with _onnx_lock:
        try:
            out = _session.run([_output_name], {_input_name: x})[0]
        except Exception:
            return None

    out = np.asarray(out)
    if out.ndim == 2 and out.shape[1] >= 2:
        row = out[0].astype(np.float64)
        row = row - np.max(row)
        e = np.exp(row)
        p = e / (np.sum(e) + 1e-9)
        idx = max(0, min(p.shape[0] - 1, int(g_idx)))
        return float(np.clip(p[idx], 0.0, 1.0))
    if out.size == 1:
        v = float(out.flat[0])
        return float(1.0 / (1.0 + np.exp(-v)))
    if out.ndim == 2 and out.shape[1] == 1:
        v = float(out[0, 0])
        return float(1.0 / (1.0 + np.exp(-v)))
    return None


def fuse_scores(cv_score_0_100: float, onnx_prob: Optional[float]) -> Tuple[float, str]:
    """
    Mezcla señal CV 0–100 y P(gafas) ONNX. Si onnx_prob es None, devuelve cv sin cambio.
    """
    w = _env_float("GLASSES_FUSION_WEIGHT_AI", 0.55)
    w = float(np.clip(w, 0.0, 1.0))
    if onnx_prob is None:
        return float(np.clip(cv_score_0_100, 0.0, 100.0)), "cv_only"
    ai_100 = float(onnx_prob) * 100.0
    fused = w * ai_100 + (1.0 - w) * float(cv_score_0_100)
    return float(np.clip(fused, 0.0, 100.0)), "cv_onnx_blend"
