"""
Adaptador local para el proveedor biométrico primario: liveness pasivo con
Silent-Face-Anti-Spoofing (MiniFASNet, PyTorch) + identidad con DeepFace
(Facenet512, detector YuNet). Reemplaza a SeetaFace6 como proveedor local por
defecto -- ver ADR (docs/decisions/) y specs/008-biometria-facial-login/spec.md.

Mismo contrato de salida que seetaface6_adapter.py (status()/analyze()) para
reutilizar el parser existente en el backend C++
(fetchDeepFaceSilentAnalysisFromAiEngine, calcado de
fetchSeetaFaceAnalysisFromAiEngine): quality.score, quality.issues, template,
pass, error.

Todo el procesamiento es local: los pesos (.caffemodel de detección, .pth de
anti-spoofing, pesos de Facenet512/YuNet de DeepFace) se montan read-only
desde fuera de la imagen (ver Dockerfile.ai / docker-compose.yml), nunca se
descargan en runtime.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

ANTISPOOF_MODEL_DIR = Path(
    os.environ.get("SILENTFACE_ANTISPOOF_MODEL_DIR", "/opt/deepface_silentface/models/anti_spoof")
)
DETECTION_MODEL_DIR = Path(
    os.environ.get("SILENTFACE_DETECTION_MODEL_DIR", "/opt/deepface_silentface/models/detection")
)
REQUIRED_DETECTION_FILES = ("Widerface-RetinaFace.caffemodel", "deploy.prototxt")

_lock = threading.Lock()
_predictor = None  # type: Optional[Any]
_predictor_error: Optional[str] = None
_cached_model_instances: Dict[str, Any] = {}  # model_path -> loaded torch.nn.Module (evita recargar pesos por request)
_deepface_ready = False
_deepface_error: Optional[str] = None


def _antispoof_model_files() -> List[Path]:
    if not ANTISPOOF_MODEL_DIR.is_dir():
        return []
    return sorted(p for p in ANTISPOOF_MODEL_DIR.iterdir() if p.suffix == ".pth")


def status() -> Dict[str, Any]:
    missing_detection = [
        name for name in REQUIRED_DETECTION_FILES if not (DETECTION_MODEL_DIR / name).is_file()
    ]
    antispoof_files = _antispoof_model_files()
    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001
        cuda_available = False
    return {
        "available": not missing_detection and bool(antispoof_files) and _deepface_error is None,
        "provider": "deepface_silentface",
        "detection_model_dir": str(DETECTION_MODEL_DIR),
        "antispoof_model_dir": str(ANTISPOOF_MODEL_DIR),
        "antispoof_models_found": [p.name for p in antispoof_files],
        "missing_detection_models": missing_detection,
        "deepface_ready": _deepface_ready,
        "deepface_error": _deepface_error,
        "cuda_available": cuda_available,
        "external_apis": False,
        "certification_claim": False,
    }


def _get_predictor():
    """Instancia única de AntiSpoofPredict (detector RetinaFace + device
    torch), reutilizada entre requests -- evita reabrir el modelo Caffe de
    detección en cada llamada."""
    global _predictor, _predictor_error
    with _lock:
        if _predictor is not None or _predictor_error is not None:
            return _predictor, _predictor_error
        try:
            from silentface.anti_spoof_predict import AntiSpoofPredict

            device_id = int(os.environ.get("SILENTFACE_DEVICE_ID", "0") or "0")
            _predictor = AntiSpoofPredict(device_id)
        except Exception as e:  # noqa: BLE001
            _predictor_error = str(e)
            print(f"[DEEPFACE_SILENT] Error cargando detector Silent-Face: {e}", flush=True)
        return _predictor, _predictor_error


def _load_cached_model(predictor, model_path: str):
    """Igual que AntiSpoofPredict._load_model, pero cachea la instancia por
    ruta de archivo -- el código vendorizado original recarga los pesos desde
    disco en cada predict() (fiel al repo original, pensado para uso batch,
    no para servir requests en tiempo real); aquí se cachea para cumplir el
    objetivo de latencia <1s de SPEC-008."""
    from silentface.anti_spoof_predict import MODEL_MAPPING
    from silentface.utility import get_kernel, parse_model_name

    cached = _cached_model_instances.get(model_path)
    if cached is not None:
        return cached

    model_name = os.path.basename(model_path)
    h_input, w_input, model_type, _scale = parse_model_name(model_name)
    kernel_size = get_kernel(h_input, w_input)
    model = MODEL_MAPPING[model_type](conv6_kernel=kernel_size).to(predictor.device)

    import torch

    state_dict = torch.load(model_path, map_location=predictor.device)
    first_layer_name = next(iter(state_dict))
    if first_layer_name.find("module.") >= 0:
        from collections import OrderedDict

        new_state_dict = OrderedDict()
        for key, value in state_dict.items():
            new_state_dict[key[7:]] = value
        model.load_state_dict(new_state_dict)
    else:
        model.load_state_dict(state_dict)
    model.eval()
    _cached_model_instances[model_path] = model
    return model


def _check_liveness(predictor, img_bgr: np.ndarray) -> Tuple[bool, float, str]:
    """Ensamble sobre todos los .pth de ANTISPOOF_MODEL_DIR, misma lógica que
    check_liveness_silent_face() del script probado por el usuario: bbox del
    detector RetinaFace, patches recortados por modelo (escala fijada en el
    nombre de archivo), softmax promedio, clase 1 = piel viva real."""
    from silentface.generate_patches import CropImage

    image_bbox = predictor.get_bbox(img_bgr)
    h_img, w_img = img_bgr.shape[:2]
    print(f"[DEEPFACE_SILENT_DEBUG] img={w_img}x{h_img} bbox={image_bbox}", flush=True)
    if image_bbox == [0, 0, 0, 0]:
        return False, 0.0, "no_face_detected"

    model_files = _antispoof_model_files()
    if not model_files:
        return False, 0.0, "silentface_models_missing"

    cropper = CropImage()
    prediction = np.zeros((1, 3))
    import torch
    import torch.nn.functional as F
    from silentface.utility import parse_model_name

    for model_path in model_files:
        h_input, w_input, _model_type, scale = parse_model_name(model_path.name)
        param = {
            "org_img": img_bgr,
            "bbox": image_bbox,
            "scale": scale,
            "out_w": w_input,
            "out_h": h_input,
            "crop": True,
        }
        if scale is None:
            param["crop"] = False
        cropped = cropper.crop(**param)

        model = _load_cached_model(predictor, str(model_path))
        from torchvision import transforms as trans

        tensor = trans.ToTensor()(cropped).unsqueeze(0).to(predictor.device)
        with torch.no_grad():
            out = model.forward(tensor)
            sm = F.softmax(out, dim=1).cpu().numpy()
            prediction += sm
        print(
            f"[DEEPFACE_SILENT_DEBUG] modelo={model_path.name} scale={scale} "
            f"crop_shape={cropped.shape} cropped_mean_bgr={cropped.reshape(-1,3).mean(axis=0)} "
            f"softmax={sm.tolist()}",
            flush=True,
        )

    label = int(np.argmax(prediction))
    confidence = float(prediction[0][label] / len(model_files))
    print(f"[DEEPFACE_SILENT_DEBUG] prediction_total={prediction.tolist()} label={label} confidence={confidence}", flush=True)
    if label == 1:
        return True, confidence, ""
    return False, confidence, "spoof_or_screen_detected"


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
    _get_predictor()
    _ensure_deepface_ready()


def analyze(raw: bytes, mode: str) -> Dict[str, Any]:
    if mode not in {"register", "verify"}:
        return {"ok": False, "pass": False, "error": "invalid_mode"}
    if not raw:
        return {"ok": False, "pass": False, "error": "empty_image"}

    predictor, predictor_error = _get_predictor()
    if predictor is None:
        return {"ok": False, "pass": False, "error": "silentface_unavailable", "detail": predictor_error}

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

    try:
        is_real, confidence, liveness_error = _check_liveness(predictor, img_bgr)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "pass": False, "error": "silentface_inference_failed", "detail": str(e)}

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
