"""
Servicio HTTP dedicado a Silent-Face-Anti-Spoofing (MiniFASNet, PyTorch).
Aislado de ai_engine a propósito -- ver requirements.txt para el porqué
(conflicto real e irreconciliable de cuDNN con TensorFlow/DeepFace).

Es el chequeo de seguridad primario contra ataques de presentación (fotos,
pantallas) -- fail-closed real, no cosmético como avatar_engine: cualquier
fallo de infraestructura (servicio caído, no listo, error de red) debe
hacer que el LLAMADOR rechace la verificación biométrica, nunca que la
apruebe por defecto. Este servicio nunca decide "aprobar sin verificar";
solo responde con el veredicto del modelo o un error explícito.

A diferencia de avatar_engine (una operación pesada y rara por registro),
esto corre en el camino caliente de cada verify-frame de login (~cada
175ms, ver ADR-124). NO se serializa a una sola inferencia concurrente --
eso degradaría el login para todos los usuarios simultáneos. waitress con
varios threads maneja requests concurrentes contra el mismo modelo cargado
(igual que ya hacía el código in-process original: sin mutex alrededor del
forward pass, solo alrededor de la carga perezosa inicial).

Contrato con el llamador (ai_engine/silentface_client.py):
- POST /check_liveness, multipart "image" -> 200 {"ok": true, "real": bool,
  "confidence": float, "liveness_error": str} (liveness_error describe un
  veredicto legítimo -- "no_face_detected"/"spoof_or_screen_detected"/"" --
  no es un error de infraestructura) o error explícito (503 not_ready,
  400 imagen inválida, 500 inference_failed).
- GET /health -> ready=true solo si el detector Y al menos un modelo
  antispoof cargaron correctamente al arrancar.
"""

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from flask import Flask, jsonify, request

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s silentface_engine %(levelname)s %(message)s"
)
log = logging.getLogger("silentface_engine")

app = Flask(__name__)

ANTISPOOF_MODEL_DIR = Path(
    os.environ.get("SILENTFACE_ANTISPOOF_MODEL_DIR", "/opt/deepface_silentface/models/anti_spoof")
)
DETECTION_MODEL_DIR = Path(
    os.environ.get("SILENTFACE_DETECTION_MODEL_DIR", "/opt/deepface_silentface/models/detection")
)
REQUIRED_DETECTION_FILES = ("Widerface-RetinaFace.caffemodel", "deploy.prototxt")
MAX_IMAGE_BYTES = int(os.environ.get("SILENTFACE_ENGINE_MAX_IMAGE_BYTES", "5000000"))

_lock = threading.Lock()
_predictor = None  # type: Optional[Any]
_predictor_error: Optional[str] = None
_cached_model_instances: Dict[str, Any] = {}
_ready = False


def _antispoof_model_files() -> List[Path]:
    if not ANTISPOOF_MODEL_DIR.is_dir():
        return []
    return sorted(p for p in ANTISPOOF_MODEL_DIR.iterdir() if p.suffix == ".pth")


def _get_predictor():
    global _predictor, _predictor_error
    if _predictor is not None or _predictor_error is not None:
        return _predictor, _predictor_error
    try:
        from silentface.anti_spoof_predict import AntiSpoofPredict

        device_id = int(os.environ.get("SILENTFACE_DEVICE_ID", "0") or "0")
        _predictor = AntiSpoofPredict(device_id)
    except Exception as e:  # noqa: BLE001
        _predictor_error = str(e)
        log.error("Error cargando detector Silent-Face: %s", e)
    return _predictor, _predictor_error


def _load_cached_model(predictor, model_path: str):
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
    """Idéntico a la lógica original de deepface_silentface_adapter.py:
    ensamble sobre todos los .pth de ANTISPOOF_MODEL_DIR, bbox del detector
    RetinaFace, patches recortados por modelo, softmax promedio, clase 1 =
    piel viva real."""
    from silentface.generate_patches import CropImage

    image_bbox = predictor.get_bbox(img_bgr)
    h_img, w_img = img_bgr.shape[:2]
    log.info("img=%dx%d bbox=%s", w_img, h_img, image_bbox)
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
        log.info(
            "modelo=%s scale=%s crop_shape=%s softmax=%s",
            model_path.name, scale, cropped.shape, sm.tolist(),
        )

    label = int(np.argmax(prediction))
    confidence = float(prediction[0][label] / len(model_files))
    log.info("prediction_total=%s label=%s confidence=%s", prediction.tolist(), label, confidence)
    if label == 1:
        return True, confidence, ""
    return False, confidence, "spoof_or_screen_detected"


@app.route("/health", methods=["GET"])
def health():
    missing_detection = [
        name for name in REQUIRED_DETECTION_FILES if not (DETECTION_MODEL_DIR / name).is_file()
    ]
    try:
        import torch

        cuda_available = bool(torch.cuda.is_available())
    except Exception:
        cuda_available = False
    body = {
        "status": "ok" if _ready else "not_ready",
        "ready": _ready,
        "provider": "silentface",
        "cuda_available": cuda_available,
        "detection_model_dir": str(DETECTION_MODEL_DIR),
        "antispoof_model_dir": str(ANTISPOOF_MODEL_DIR),
        "antispoof_models_loaded": list(_cached_model_instances.keys()),
        "missing_detection_models": missing_detection,
        "predictor_error": _predictor_error,
    }
    return jsonify(body), (200 if _ready else 503)


@app.route("/check_liveness", methods=["POST"])
def check_liveness_route():
    if not _ready or _predictor is None:
        return jsonify({"ok": False, "error": "not_ready", "detail": _predictor_error}), 503

    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image"}), 400
    raw = request.files["image"].read()
    if not raw:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    if len(raw) > MAX_IMAGE_BYTES:
        return jsonify({"ok": False, "error": "image_too_large"}), 413

    encoded = np.frombuffer(raw, dtype=np.uint8)
    img_bgr = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
    if img_bgr is None or img_bgr.size == 0:
        return jsonify({"ok": False, "error": "invalid_image"}), 400
    height, width = img_bgr.shape[:2]
    if width > 8192 or height > 8192:
        return jsonify({"ok": False, "error": "image_dimensions_too_large"}), 400

    try:
        is_real, confidence, liveness_error = _check_liveness(_predictor, img_bgr)
    except Exception as e:  # noqa: BLE001
        log.exception("inference failure")
        return jsonify({"ok": False, "error": "inference_failed", "detail": str(e)}), 500

    return jsonify(
        {
            "ok": True,
            "real": is_real,
            "confidence": round(confidence, 4),
            "liveness_error": liveness_error,
        }
    )


def _preload():
    """Bloqueante a propósito, antes de servir tráfico -- mismo principio
    que avatar_engine: si el detector o los modelos antispoof no cargan,
    el servicio queda not_ready (fail-closed) en vez de aceptar requests
    que silenciosamente no podrían verificar nada."""
    global _ready
    log.info("preloading Silent-Face-Anti-Spoofing detector + modelos...")
    predictor, error = _get_predictor()
    if predictor is None:
        log.error("preload abortado: detector no cargó (%s) -- sirviendo not_ready", error)
        return
    model_files = _antispoof_model_files()
    if not model_files:
        log.error("preload abortado: no hay modelos .pth en %s -- sirviendo not_ready", ANTISPOOF_MODEL_DIR)
        return
    loaded = 0
    for model_path in model_files:
        try:
            _load_cached_model(predictor, str(model_path))
            loaded += 1
        except Exception as e:  # noqa: BLE001
            log.error("no se pudo precargar %s: %s", model_path, e)
    if loaded == 0:
        log.error("preload abortado: ningún modelo antispoof cargó -- sirviendo not_ready")
        return
    _ready = True
    log.info("listo: detector + %d/%d modelos antispoof cargados", loaded, len(model_files))


if __name__ == "__main__":
    _preload()

    from waitress import serve

    # threads=8: mismo valor que eye_analyzer.py -- este servicio reemplaza
    # una ruta que ya corría con esa concurrencia dentro del proceso de
    # ai_engine; no se serializa a 1 (a diferencia de avatar_engine) porque
    # esto es el camino caliente de cada verify-frame de login, no una
    # operación rara de registro.
    serve(app, host="0.0.0.0", port=5002, threads=8)
