"""
Adaptador local para el proveedor biométrico primario: liveness pasivo con
Silent-Face-Anti-Spoofing (MiniFASNet, PyTorch, vía el servicio aparte
`silentface_engine` -- ver silentface_client.py y ADR-141 actualización
2026-09-03 para el porqué) + identidad con DeepFace (Facenet512, detector
YuNet, en este mismo proceso). Reemplaza a SeetaFace6 como proveedor local
por defecto -- ver ADR (docs/decisions/) y specs/008-biometria-facial-login/spec.md.

Mismo contrato de salida que seetaface6_adapter.py (status()/analyze()) para
reutilizar el parser existente en el backend C++
(fetchDeepFaceSilentAnalysisFromAiEngine, calcado de
fetchSeetaFaceAnalysisFromAiEngine): quality.score, quality.issues, template,
pass, error.

Todo el procesamiento es local: los pesos (.caffemodel de detección, .pth de
anti-spoofing -- ahora en silentface_engine --, pesos de Facenet512/YuNet de
DeepFace) se montan read-only desde fuera de la imagen (ver Dockerfile.ai /
docker-compose.yml), nunca se descargan en runtime.
"""
from __future__ import annotations

import os
import threading
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

import silentface_client

_lock = threading.Lock()
_deepface_ready = False
_deepface_error: Optional[str] = None


def status() -> Dict[str, Any]:
    remote = silentface_client.remote_status()
    return {
        "available": bool(remote.get("ready")) and _deepface_error is None,
        "provider": "deepface_silentface",
        "silentface_engine": remote,
        "deepface_ready": _deepface_ready,
        "deepface_error": _deepface_error,
        "external_apis": False,
        "certification_claim": False,
    }


def _ensure_deepface_ready() -> Optional[str]:
    global _deepface_ready, _deepface_error
    with _lock:
        if _deepface_ready or _deepface_error is not None:
            return _deepface_error
        try:
            from deepface import DeepFace

            DeepFace.build_model("Facenet512")
            _deepface_ready = True
        except Exception as e:  # noqa: BLE001
            _deepface_error = str(e)
            print(f"[DEEPFACE_SILENT] Error cargando Facenet512: {e}", flush=True)
        return _deepface_error


def warmup() -> None:
    """Calienta solo el lado DeepFace/TensorFlow en este proceso --
    silentface_engine se calienta a sí mismo antes de aceptar tráfico
    (preload síncrono en su propio server.py, ver ADR-141)."""
    _ensure_deepface_ready()


def analyze(raw: bytes, mode: str) -> Dict[str, Any]:
    if mode not in {"register", "verify"}:
        return {"ok": False, "pass": False, "error": "invalid_mode"}
    if not raw:
        return {"ok": False, "pass": False, "error": "empty_image"}

    deepface_error = _ensure_deepface_ready()
    if deepface_error is not None:
        return {"ok": False, "pass": False, "error": "deepface_unavailable", "detail": deepface_error}

    encoded = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if img_bgr is None or img_bgr.size == 0:
        return {"ok": False, "pass": False, "error": "invalid_image"}
    height, width = img_bgr.shape[:2]
    if width > 8192 or height > 8192:
        return {"ok": False, "pass": False, "error": "image_dimensions_too_large"}

    liveness_result = silentface_client.check_liveness(raw)
    if liveness_result["status"] == "unavailable":
        # Fail-closed: mismo error que cuando el detector in-process no
        # cargaba en el código original -- nunca se trata como "pase".
        return {
            "ok": False,
            "pass": False,
            "error": "silentface_unavailable",
            "detail": liveness_result.get("detail"),
        }
    if liveness_result["status"] == "inference_failed":
        return {
            "ok": False,
            "pass": False,
            "error": "silentface_inference_failed",
            "detail": liveness_result.get("detail"),
        }

    is_real = liveness_result["real"]
    confidence = liveness_result["confidence"]
    liveness_error = liveness_result.get("liveness_error", "")

    liveness_threshold = float(os.environ.get("SILENTFACE_LIVENESS_THRESHOLD", "0.60"))
    liveness_payload = {"real": is_real, "confidence": round(confidence, 4), "threshold": liveness_threshold}
    print(f"[DEEPFACE_SILENT_LIVENESS] liveness={liveness_payload} img_shape={img_bgr.shape}", flush=True)
    if not is_real or confidence <= liveness_threshold:
        return {
            "ok": False,
            "pass": False,
            "error": liveness_error or "spoof_or_screen_detected",
            "liveness": liveness_payload,
        }

    try:
        from deepface import DeepFace

        faces = DeepFace.represent(
            img_path=img_bgr,
            model_name="Facenet512",
            detector_backend="yunet",
            enforce_detection=True,
        )
    except ValueError:
        return {"ok": False, "pass": False, "error": "no_face_detected", "liveness": liveness_payload}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "pass": False, "error": "deepface_represent_failed", "detail": str(e),
                "liveness": liveness_payload}

    if not faces:
        return {"ok": False, "pass": False, "error": "no_face_detected", "liveness": liveness_payload}
    if len(faces) > 1:
        return {"ok": False, "pass": False, "error": "multiple_faces_detected", "liveness": liveness_payload}

    face = faces[0]
    embedding = face.get("embedding") or []
    if len(embedding) != 512:
        return {"ok": False, "pass": False, "error": "deepface_embedding_dim_invalid",
                "liveness": liveness_payload}

    issues: List[str] = []
    face_confidence = float(face.get("face_confidence", 1.0) or 0.0)
    min_det = float(os.environ.get("DEEPFACE_MIN_DET_SCORE", "0.40"))
    if face_confidence < min_det:
        issues.append("low_detection_confidence")

    return {
        "ok": True,
        "pass": True,
        "template": [float(x) for x in embedding],
        "dim": 512,
        "quality": {"score": face_confidence, "issues": issues},
        "liveness": liveness_payload,
        "provider": "deepface_silentface",
    }
