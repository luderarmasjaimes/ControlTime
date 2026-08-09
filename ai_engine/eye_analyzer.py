"""
Motor IA — ojos, boca y lentes (MediaPipe Face Landmarker + visión clásica).
Sincronizado con C:\\FACIAL\\ai_engine\\eye_analyzer.py (TUNING, EAR adaptativo,
híbrido blink+EAR, lentes con histéresis temporal).

InformeCliente: además expone glasses_cv_score (misma señal que glasses_score)
para el backend C++ / métricas.
"""
import cv2
import numpy as np
from collections import deque
import threading

import base64
import json
import os
import time
import requests
from typing import Optional, Tuple
from datetime import datetime, timezone
from flask import Flask, request, jsonify

app = Flask(__name__)


class HostFix:
    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        environ["HTTP_HOST"] = "localhost:5000"
        return self.app(environ, start_response)


app.wsgi_app = HostFix(app.wsgi_app)

import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from glasses_fusion import (
    fuse_scores,
    infer_glasses_prob_onnx,
    onnx_load_error,
    warmup_glasses_onnx,
)
from dni_scan import scan_dni_image

# =============================================================================
# TUNING — confianza del landmarker (más bajo = más tolerante a caras pequeñas/luz difícil)
# =============================================================================
MIN_FACE_DET_CONF = float(os.environ.get("MP_MIN_FACE_DET", "0.42"))
MIN_FACE_PRESENCE_CONF = float(os.environ.get("MP_MIN_FACE_PRES", "0.42"))
MIN_TRACKING_CONF = float(os.environ.get("MP_MIN_TRACK", "0.42"))

# EAR: umbral base; se adapta ligeramente a la distancia (IED en píxeles)
EAR_THRESH_BASE = float(os.environ.get("EAR_THRESH_BASE", "0.185"))
EAR_IED_REF_PX = float(os.environ.get("EAR_IED_REF", "95.0"))  # ~distancia interocular de referencia
EAR_IED_SCALE_MIN = float(os.environ.get("EAR_IED_SCALE_MIN", "0.88"))
EAR_IED_SCALE_MAX = float(os.environ.get("EAR_IED_SCALE_MAX", "1.12"))

# Blink blendshape: por encima se considera ojo más cerrado (MediaPipe ~0..1)
BLINK_STRONG = float(os.environ.get("BLINK_STRONG", "0.52"))
BLINK_SOFT = float(os.environ.get("BLINK_SOFT", "0.38"))

# Suavizado temporal entre frames HTTP consecutivos (misma sesión de cámara)
EAR_SMOOTH_WIN = max(1, int(os.environ.get("EAR_SMOOTH_WIN", "5")))

# Máscara HSV de brillo (V alto, S baja). V=242 dejó spec_density=0 en 451/451 frames con gafas mate/AR (glasses_probe).
GLASSES_SPEC_V_MIN = float(os.environ.get("GLASSES_SPEC_V_MIN", "237"))
GLASSES_SPEC_S_MAX = float(os.environ.get("GLASSES_SPEC_S_MAX", "40"))

from mediapipe_models_fetch import (
    ensure_mediapipe_models,
    get_face_model_path,
    get_selfie_model_path,
)

if not ensure_mediapipe_models():
    raise RuntimeError(
        "[EYE_AI] Modelos MediaPipe obligatorios no disponibles "
        "(red o CDN). Revise logs [mediapipe_models]."
    )

MODEL_PATH = get_face_model_path()
SELFIE_SEGMENTER_PATH = get_selfie_model_path()

base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.FaceLandmarkerOptions(
    base_options=base_options,
    running_mode=vision.RunningMode.IMAGE,
    num_faces=1,
    min_face_detection_confidence=MIN_FACE_DET_CONF,
    min_face_presence_confidence=MIN_FACE_PRESENCE_CONF,
    min_tracking_confidence=MIN_TRACKING_CONF,
    output_face_blendshapes=True,
)
detector = vision.FaceLandmarker.create_from_options(options)

_selfie_segmenter = None
_selfie_segmenter_failed = False

# Índices ojos (malla MediaPipe 478 puntos) — orden estándar EAR
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]
try:
    _FACE_OVAL_INDICES_SET = set()
    for _conn in mp.solutions.face_mesh.FACEMESH_FACE_OVAL:
        _FACE_OVAL_INDICES_SET.add(int(_conn[0]))
        _FACE_OVAL_INDICES_SET.add(int(_conn[1]))
    FACE_OVAL_INDICES = sorted(_FACE_OVAL_INDICES_SET)
except Exception:
    FACE_OVAL_INDICES = []
if not FACE_OVAL_INDICES:
    # Fallback fijo (MediaPipe 468): contorno facial equivalente a FACEMESH_FACE_OVAL.
    FACE_OVAL_INDICES = [
        10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
        397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
        172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
    ]

# Ventana corta = reacción más rápida al quitarse gafas (frame ya recortado al óvalo).
def _glasses_hist_maxlen() -> int:
    try:
        return max(3, min(11, int(os.environ.get("GLASSES_SCORE_HIST_LEN", "5"))))
    except ValueError:
        return 5


def _glasses_fusion_hist_maxlen() -> int:
    try:
        return max(3, min(11, int(os.environ.get("GLASSES_FUSION_HIST_LEN", "5"))))
    except ValueError:
        return 5


# Estado por sesion de captura (X-Capture-Session-Id del backend C++, ver
# authApi.ts/ai_engine_client.cpp). Antes esto eran variables GLOBALES de
# modulo (una sola para todo el proceso Flask): con threaded=True, dos
# capturas concurrentes -- dos pestañas del navegador, o incluso trafico de
# pruebas/health-checks -- se mezclaban en el mismo deque/histeresis, dejando
# "gafas"/"ojos cerrados" pegados aunque el frame real ya no los tuviera.
class _SessionState:
    __slots__ = (
        "mouth_closed_prev",
        "glasses_score_hist",
        "glasses_state_prev",
        "glasses_fusion_hist",
        "glasses_fusion_state_prev",
        "left_ear_hist",
        "right_ear_hist",
        "last_touched",
    )

    def __init__(self):
        self.mouth_closed_prev = True
        self.glasses_score_hist = deque(maxlen=_glasses_hist_maxlen())
        self.glasses_state_prev = False
        self.glasses_fusion_hist = deque(maxlen=_glasses_fusion_hist_maxlen())
        self.glasses_fusion_state_prev = False
        self.left_ear_hist = deque(maxlen=EAR_SMOOTH_WIN)
        self.right_ear_hist = deque(maxlen=EAR_SMOOTH_WIN)
        self.last_touched = time.monotonic()


_SESSION_DEFAULT_KEY = "_no_session_id"
_SESSION_TTL_SECONDS = 120.0
_sessions_lock = threading.Lock()
_sessions: dict = {}


def _get_session_state(session_id):
    key = session_id if session_id else _SESSION_DEFAULT_KEY
    now = time.monotonic()
    with _sessions_lock:
        st = _sessions.get(key)
        if st is None:
            st = _SessionState()
            _sessions[key] = st
        st.last_touched = now
        if len(_sessions) > 64:
            stale = [
                k
                for k, v in _sessions.items()
                if k != key and (now - v.last_touched) > _SESSION_TTL_SECONDS
            ]
            for k in stale:
                _sessions.pop(k, None)
        return st


# El calculo del score de gafas (heuristica CV, muy compartida entre frames)
# sigue serializado con un lock: no depende de estado por sesion, solo evita
# que dos threads pisen buffers intermedios de OpenCV a la vez.
_glasses_lock = threading.Lock()
# Ultimo debug de CUALQUIER sesion, solo para /glasses_debug (diagnostico).
last_glasses_debug = {}

# Logs de prueba (JSONL, mismo esquema): con gafas vs sin gafas — activar solo uno por sesión de prueba.
# GLASSES_PROBE_LOG=1 → glasses_probe.jsonl | GLASSES_PROBE_SIN_GAFAS_LOG=1 → glasses_probe_sin_gafas.jsonl
_glasses_probe_lock = threading.Lock()
_glasses_probe_seq = 0
_glasses_probe_sin_gafas_seq = 0


def _probe_logs_dir():
    return os.environ.get("GLASSES_PROBE_DIR", "/app/logs")


def _glasses_probe_path():
    raw = os.environ.get("GLASSES_PROBE_LOG", "").strip()
    if not raw or raw.lower() in ("0", "false", "no"):
        return None
    if raw in ("1", "true", "yes"):
        return os.path.join(_probe_logs_dir(), "glasses_probe.jsonl")
    return raw


def _glasses_probe_sin_gafas_path():
    raw = os.environ.get("GLASSES_PROBE_SIN_GAFAS_LOG", "").strip()
    if not raw or raw.lower() in ("0", "false", "no"):
        return None
    if raw in ("1", "true", "yes"):
        return os.path.join(_probe_logs_dir(), "glasses_probe_sin_gafas.jsonl")
    return raw


def _append_glasses_probe_record(record: dict) -> None:
    path = _glasses_probe_path()
    if not path:
        return
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with _glasses_probe_lock:
            global _glasses_probe_seq
            _glasses_probe_seq += 1
            out = dict(record)
            out["seq"] = int(_glasses_probe_seq)
            out["probe_session"] = "con_gafas"
            line = json.dumps(out, ensure_ascii=False) + "\n"
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
    except OSError as e:
        print(f"[EYE_AI] glasses_probe log failed: {e}", flush=True)


def _append_sin_gafas_probe_record(record: dict) -> None:
    path = _glasses_probe_sin_gafas_path()
    if not path:
        return
    try:
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        with _glasses_probe_lock:
            global _glasses_probe_sin_gafas_seq
            _glasses_probe_sin_gafas_seq += 1
            out = dict(record)
            out["seq"] = int(_glasses_probe_sin_gafas_seq)
            out["probe_session"] = "sin_gafas"
            line = json.dumps(out, ensure_ascii=False) + "\n"
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)
    except OSError as e:
        print(f"[EYE_AI] glasses_probe_sin_gafas log failed: {e}", flush=True)


def calculate_ear(landmarks, eye_indices):
    v1 = np.linalg.norm(landmarks[eye_indices[1]] - landmarks[eye_indices[5]])
    v2 = np.linalg.norm(landmarks[eye_indices[2]] - landmarks[eye_indices[4]])
    h = np.linalg.norm(landmarks[eye_indices[0]] - landmarks[eye_indices[3]])
    return (v1 + v2) / (2.0 * h + 1e-6)


def adaptive_ear_threshold(inter_eye_px: float) -> float:
    """Umbral EAR más estable al acercar/alejar la cabeza."""
    if inter_eye_px < 1e-3:
        return EAR_THRESH_BASE
    scale = float(np.clip(EAR_IED_REF_PX / inter_eye_px, EAR_IED_SCALE_MIN, EAR_IED_SCALE_MAX))
    return float(np.clip(EAR_THRESH_BASE * scale, 0.14, 0.28))


def blendshape_map(detection_result):
    out = {}
    if not detection_result.face_blendshapes:
        return out
    for b in detection_result.face_blendshapes[0]:
        name = b.category_name
        if not isinstance(name, str):
            name = str(name)
        out[name] = float(b.score)
    return out


def bs_get(bs, *aliases):
    """MediaPipe puede variar mayúsculas/nombres entre versiones."""
    for key in bs:
        kl = key.lower().replace("_", "")
        for a in aliases:
            if kl == a.lower().replace("_", ""):
                return float(bs[key])
    return 0.0


def face_frontal_from_points(points: np.ndarray) -> bool:
    """
    Frontalidad desde geometría 2D (nariz vs eje interocular + roll + pitch aprox.).
    Sustituye la señal OpenCV (aspecto/simetría) cuando el motor IA está activo.
    """
    if points.shape[0] < 400:
        return True
    nose = points[1]
    le = np.mean(points[LEFT_EYE], axis=0)
    re = np.mean(points[RIGHT_EYE], axis=0)
    mid = (le + re) * 0.5
    ied = float(np.linalg.norm(le - re))
    if ied < 12.0:
        return True
    horiz = abs(nose[0] - mid[0]) / ied
    roll = abs(le[1] - re[1]) / ied
    pitch_ratio = (nose[1] - mid[1]) / ied
    if horiz > 0.42:
        return False
    if roll > 0.38:
        return False
    if pitch_ratio < -0.12 or pitch_ratio > 0.95:
        return False
    return True


def mar_inner_ratio(points):
    """Apertura vertical interna / ancho boca (robusto ante jawOpen basal)."""
    if points.shape[0] < 310:
        return 0.04
    p13, p14 = points[13], points[14]
    p78, p308 = points[78], points[308]
    ver = float(np.linalg.norm(p13 - p14))
    hor = float(np.linalg.norm(p78 - p308))
    return ver / (hor + 1e-6)


def update_mouth_closed(bs, mar_ratio, st: _SessionState):
    """
    Boca cerrada: blendshapes + MAR + histéresis (menos parpadeo boca abierta/cerrada).
    """
    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mclose = bs_get(bs, "mouthClose", "MOUTH_CLOSE")
    funnel = bs_get(bs, "mouthFunnel", "MOUTH_FUNNEL")
    pucker = bs_get(bs, "mouthPucker", "MOUTH_PUCKER")

    open_ix = 0.46 * jaw + 0.44 * funnel + 0.30 * pucker - 0.34 * mclose
    open_ix = float(max(0.0, min(1.0, open_ix)))
    if mar_ratio > 0.060:
        open_ix = max(open_ix, 0.44)
    elif mar_ratio < 0.032:
        open_ix = min(open_ix, 0.12)

    if st.mouth_closed_prev:
        if open_ix > 0.35 or jaw > 0.29 or mar_ratio > 0.056:
            st.mouth_closed_prev = False
    else:
        if open_ix < 0.20 and jaw < 0.16 and (mclose > 0.12 or mar_ratio < 0.040):
            st.mouth_closed_prev = True

    return st.mouth_closed_prev


def preprocess_bgr_for_glasses(img_bgr):
    """CLAHE suave: mejora montura/reflejo en sombras sin saturar highlights."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
    return clahe.apply(gray)


def glasses_from_frame(img_bgr, points, st: _SessionState):
    """
    ROI rectangular que encierra ambos ojos.
    Reflejo especular + montura (black-hat) + puente nasal.

    El lock solo serializa el computo OpenCV entre threads concurrentes; la
    histéresis (st.glasses_score_hist/st.glasses_state_prev) vive en el
    _SessionState de esta captura, no en una variable global de proceso.
    """
    with _glasses_lock:
        return _glasses_from_frame_impl(img_bgr, points, st)


def _glasses_from_frame_impl(img_bgr, points, st: _SessionState):
    """
    ROI rectangular que encierra ambos ojos.
    Reflejo especular + montura (black-hat) + puente nasal.
    Umbrales alineados con C:\\FACIAL\\ai_engine\\eye_analyzer.py.
    """
    h, w = img_bgr.shape[:2]
    le = np.mean(points[LEFT_EYE], axis=0)
    re = np.mean(points[RIGHT_EYE], axis=0)
    dist = float(np.linalg.norm(le - re))
    if dist < 12.0:
        return 0.0, False, {"reason": "eye_distance_too_small", "eye_dist": float(dist)}

    cx, cy = (le + re) / 2.0
    x1 = int(max(0, cx - dist * 0.70))
    x2 = int(min(w - 1, cx + dist * 0.70))
    y1 = int(max(0, cy - dist * 0.36))
    y2 = int(min(h - 1, cy + dist * 0.22))
    if x2 <= x1 or y2 <= y1:
        return 0.0, False, {"reason": "invalid_roi"}

    crop = img_bgr[y1:y2, x1:x2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    gray = preprocess_bgr_for_glasses(crop)

    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    spec_mask = ((v > GLASSES_SPEC_V_MIN) & (s < GLASSES_SPEC_S_MAX)).astype(np.uint8) * 255
    spec_mask = cv2.morphologyEx(
        spec_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    spec_mask = cv2.morphologyEx(
        spec_mask, cv2.MORPH_DILATE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(spec_mask, connectivity=8)
    h_roi, w_roi = gray.shape[:2]
    min_area = max(10, int((h_roi * w_roi) * 0.0010))
    max_area = max(min_area + 1, int((h_roi * w_roi) * 0.095))
    comp_count = 0
    area_sum = 0
    left_hits = 0
    right_hits = 0
    for i in range(1, num_labels):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        cx_comp = stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] * 0.5
        comp_count += 1
        area_sum += area
        if cx_comp < (w_roi * 0.5):
            left_hits += 1
        else:
            right_hits += 1

    spec_density = float(np.count_nonzero(spec_mask)) / float(spec_mask.size + 1)

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    ax = np.abs(gx)
    ay = np.abs(gy)
    horiz_ratio = float(np.mean(ax) / (np.mean(ay) + 1e-6))
    horiz_ratio = float(np.clip(horiz_ratio, 0.0, 3.0))
    horiz_energy = float(np.mean(ax))

    le_roi = np.array([le[0] - x1, le[1] - y1], dtype=np.float32)
    re_roi = np.array([re[0] - x1, re[1] - y1], dtype=np.float32)
    eye_w = max(10, int(dist * 0.58))
    eye_h = max(8, int(dist * 0.36))

    def eye_ring_dark_density(center_xy):
        cx_e, cy_e = int(center_xy[0]), int(center_xy[1])
        ex1 = max(0, cx_e - eye_w // 2)
        ex2 = min(w_roi - 1, cx_e + eye_w // 2)
        ey1 = max(0, cy_e - eye_h // 2)
        ey2 = min(h_roi - 1, cy_e + eye_h // 2)
        if ex2 <= ex1 or ey2 <= ey1:
            return 0.0
        egray = gray[ey1:ey2, ex1:ex2]
        bh = cv2.morphologyEx(
            egray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_RECT, (9, 9)),
        )
        _, bh_bin = cv2.threshold(bh, 16, 255, cv2.THRESH_BINARY)
        hh, ww = bh_bin.shape[:2]
        ring = np.zeros_like(bh_bin)
        t = max(2, int(min(hh, ww) * 0.18))
        ring[:t, :] = 255
        ring[-t:, :] = 255
        ring[:, :t] = 255
        ring[:, -t:] = 255
        ring_count = np.count_nonzero(ring)
        if ring_count == 0:
            return 0.0
        return float(np.count_nonzero(cv2.bitwise_and(bh_bin, ring))) / float(ring_count)

    left_rim = eye_ring_dark_density(le_roi)
    right_rim = eye_ring_dark_density(re_roi)
    rim_density = (left_rim + right_rim) * 0.5

    bx1 = max(0, int(min(le_roi[0], re_roi[0]) + dist * 0.10))
    bx2 = min(w_roi - 1, int(max(le_roi[0], re_roi[0]) - dist * 0.10))
    by1 = max(0, int(cy - y1 - dist * 0.10))
    by2 = min(h_roi - 1, int(cy - y1 + dist * 0.12))
    bridge_dark = 0.0
    if bx2 > bx1 and by2 > by1:
        bgray = gray[by1:by2, bx1:bx2]
        bbh = cv2.morphologyEx(
            bgray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_RECT, (7, 7)),
        )
        _, bbin = cv2.threshold(bbh, 14, 255, cv2.THRESH_BINARY)
        bridge_dark = float(np.count_nonzero(bbin)) / float(bbin.size + 1)

    glare_term = min(72.0, spec_density * 52000.0)
    blob_term = min(22.0, float(comp_count) * 6.0 + (float(area_sum) / float(spec_mask.size + 1)) * 2200.0)
    frame_term = max(0.0, horiz_ratio - 1.00) * 14.0 + max(0.0, horiz_energy - 3.0) * 2.4
    frame_term = min(18.0, frame_term)
    rim_term = min(34.0, rim_density * 230.0)
    bridge_term = min(20.0, bridge_dark * 270.0)
    score = float(np.clip(glare_term + blob_term + frame_term + rim_term + bridge_term, 0.0, 100.0))
    score_terms = float(score)
    if spec_density < 0.0008 and comp_count == 0 and rim_density < 0.075 and bridge_dark < 0.028:
        score = min(score, 32.0)
    score_after_tight = float(score)

    bilateral_glare = left_hits > 0 and right_hits > 0
    # comp_count>=2 era demasiado estricto: muchas gafas dan un solo punto especular por ROI.
    strong_glare = spec_density > 0.0016 and comp_count >= 1 and bilateral_glare
    medium_glare = (
        spec_density > 0.00105
        and comp_count >= 1
        and bilateral_glare
        and horiz_ratio > 0.97
    )
    # Misma definición que C:\FACIAL (evita falsos positivos por nariz/cejas sin tocar la sensibilidad a gafas reales).
    frame_presence = rim_density > 0.055 and bridge_dark > 0.018
    weak_frame_presence = rim_density > 0.042 and bridge_dark > 0.014
    if frame_presence:
        score = min(100.0, score + 19.0)
    score_after_boost = float(score)

    # Sin spec ni blobs: limitar score (nariz/cejas). Si hay señal de montura+puente, un tope algo
    # mayor permite que la histéresis vea stable>51 con gafas mate (sin reabrir FP de nariz solo).
    cap_applied = None
    if spec_density < 0.0008 and comp_count == 0:
        if frame_presence and rim_density >= 0.10 and bridge_dark >= 0.04:
            score = min(score, 54.0)
            cap_applied = 54
        else:
            score = min(score, 48.0)
            cap_applied = 48
    score_final = float(score)

    st.glasses_score_hist.append(score)
    stable = float(np.median(list(st.glasses_score_hist)))

    prev_glasses_state = st.glasses_state_prev
    # Sin brillo medible (gafas mate/AR): montura+puente altos y stable>51 por cap 54; probe real: 451/451 con spec=0.
    matte_no_spec = spec_density < 0.0008 and comp_count == 0
    matte_frame_signal = (
        matte_no_spec
        and frame_presence
        and (
            (rim_density >= 0.10 and bridge_dark >= 0.14)
            or (rim_density >= 0.055 and bridge_dark >= 0.20)
        )
    )

    # Salida (histéresis "lentes → sin lentes"): antes stable<32 y NOT weak_frame_presence.
    # Sin lentes, nariz/cejas suelen dejar weak_frame_presence=True y stable~40–48 → nunca salía.
    no_spec_for_exit = spec_density < 0.00075 and comp_count == 0
    # ROI óvalo: al quitarse gafas, rim/puente caen ya; el mediano de la ventana puede tardar 2–3 frames.
    low_rim_bridge = rim_density < 0.050 and bridge_dark < 0.015
    exit_glasses = (
        (
            no_spec_for_exit
            and stable < 49.0
            and not strong_glare
            and not medium_glare
        )
        or (
            st.glasses_state_prev
            and low_rim_bridge
            and score_final < 47.5
            and spec_density < 0.0010
            and comp_count == 0
            and not strong_glare
            and not medium_glare
        )
    )

    if not st.glasses_state_prev:
        # frame_presence + rim/bridge sin spec puede ser nariz: el cap deja stable~48, no pasa stable>51.
        # Con gafas suele haber spec débil (>=0.00045) o al menos un blob; glare relajado cubre el resto.
        # matte_frame_signal: entrada sin spec (calibrado con glasses_probe.jsonl con lentes puestos).
        st.glasses_state_prev = (
            (stable > 50.0 and strong_glare)
            or (stable > 54.0 and medium_glare)
            or (
                stable > 51.0
                and frame_presence
                and (spec_density >= 0.00045 or comp_count >= 1)
            )
            or (stable > 51.0 and matte_frame_signal)
        )
    else:
        st.glasses_state_prev = not exit_glasses

    entry_strong = (stable > 50.0) and strong_glare
    entry_medium = (stable > 54.0) and medium_glare
    entry_frame_branch = (
        (stable > 51.0)
        and frame_presence
        and (spec_density >= 0.00045 or comp_count >= 1)
    )
    entry_matte = (stable > 51.0) and matte_frame_signal

    glasses_likelihood = stable
    if st.glasses_state_prev:
        glasses_likelihood = max(60.0, stable)
    else:
        glasses_likelihood = min(40.0, stable)

    debug = {
        "roi": [int(x1), int(y1), int(x2 - x1), int(y2 - y1)],
        "spec_density": float(spec_density),
        "components": int(comp_count),
        "left_hits": int(left_hits),
        "right_hits": int(right_hits),
        "horiz_ratio": float(horiz_ratio),
        "horiz_energy": float(horiz_energy),
        "glare_term": float(glare_term),
        "blob_term": float(blob_term),
        "frame_term": float(frame_term),
        "rim_term": float(rim_term),
        "bridge_term": float(bridge_term),
        "score_terms": float(score_terms),
        "score_after_tight": float(score_after_tight),
        "score_after_boost": float(score_after_boost),
        "score_final": float(score_final),
        "cap_applied": cap_applied,
        "hist_len": len(st.glasses_score_hist),
        "strong_glare": bool(strong_glare),
        "medium_glare": bool(medium_glare),
        "bilateral_glare": bool(bilateral_glare),
        "rim_density": float(rim_density),
        "bridge_dark": float(bridge_dark),
        "frame_presence": bool(frame_presence),
        "weak_frame_presence": bool(weak_frame_presence),
        "stable_score": float(stable),
        "glasses_likelihood": float(glasses_likelihood),
        "prev_glasses_state": bool(prev_glasses_state),
        "glasses_state": bool(st.glasses_state_prev),
        "entry_strong": bool(entry_strong),
        "entry_medium": bool(entry_medium),
        "entry_frame_branch": bool(entry_frame_branch),
        "entry_matte": bool(entry_matte),
        "matte_frame_signal": bool(matte_frame_signal),
        "glasses_spec_v_min": float(GLASSES_SPEC_V_MIN),
        "glasses_spec_s_max": float(GLASSES_SPEC_S_MAX),
        "exit_glasses_condition": bool(exit_glasses),
    }
    return float(glasses_likelihood), bool(st.glasses_state_prev), debug


def eye_open_hybrid(ear: float, blink_bs: float, ear_thresh: float) -> bool:
    """
    EAR geométrico + eyeBlink de MediaPipe: reduce falsos 'abierto' con parpadeo
    y falsos 'cerrado' con pestañas largas pero ojo abierto.
    """
    if blink_bs >= BLINK_STRONG:
        return False
    if blink_bs <= BLINK_SOFT and ear > ear_thresh * 0.97:
        return True
    return ear > ear_thresh * 1.04


def estimate_confidence(left_ear, right_ear, blink_l, blink_r, detected: bool) -> float:
    if not detected:
        return 0.0
    ear_part = min(1.0, (min(left_ear, right_ear) / 0.34) ** 0.7)
    blink_part = 1.0 - min(1.0, max(blink_l, blink_r) * 1.1)
    return float(np.clip(0.35 + 0.35 * ear_part + 0.30 * blink_part, 0.0, 1.0))


def apply_glasses_fusion_pipeline(
    img_bgr: np.ndarray,
    cv_gscore: float,
    cv_glasses_hit: bool,
    gdebug: dict,
    st: _SessionState,
):
    """
    Mezcla CV + ONNX sobre el mismo ROI que glasses_debug['roi'].

    GLASSES_ONNX_DECISION_MODE:
      - cv_primary (default): ONNX solo ajusta glasses_score fusionado; el booleano glasses_hit
        sigue la histéresis CV. Evita falsos "hay lentes" cuando el ONNX se desvía del dominio
        (webcam, iluminación distinta al dataset de entrenamiento).
      - fuse: histéresis sobre mediana(fusion_hist) como antes (ONNX puede mandar el booleano).
    """
    crop = None
    roi = gdebug.get("roi")
    if roi and len(roi) == 4:
        x, y, rw, rh = int(roi[0]), int(roi[1]), int(roi[2]), int(roi[3])
        h0, w0 = img_bgr.shape[:2]
        if rw > 0 and rh > 0 and x >= 0 and y >= 0 and x + rw <= w0 and y + rh <= h0:
            crop = img_bgr[y : y + rh, x : x + rw]
    onnx_p = infer_glasses_prob_onnx(crop) if crop is not None else None
    fused, fusion_mode = fuse_scores(cv_gscore, onnx_p)
    st.glasses_fusion_hist.append(fused)
    sf = float(np.median(list(st.glasses_fusion_hist)))

    decision_mode = os.environ.get("GLASSES_ONNX_DECISION_MODE", "cv_primary").strip().lower()

    if onnx_p is not None:
        if decision_mode == "fuse":
            if not st.glasses_fusion_state_prev:
                st.glasses_fusion_state_prev = sf > 56.0
            else:
                st.glasses_fusion_state_prev = not (sf < 44.0)
            hit = st.glasses_fusion_state_prev
            mode_out = fusion_mode
        else:
            # cv_primary: booleano ICAO = CV; ONNX puede vetar FP (auriculares/reflejos sin brillo de cristal).
            hit = bool(cv_glasses_hit)
            veto_on = os.environ.get("GLASSES_ONNX_NO_GLASSES_VETO", "1").strip().lower() in (
                "1",
                "true",
                "yes",
            )
            if veto_on and onnx_p is not None and hit:
                try:
                    # 0.45 en vez del 0.17 original: /glasses_debug capturado en
                    # produccion (2026-08-08) mostro un caso real atascado en
                    # "con lentes" con spec_density=0.0 (cero brillo, la senal
                    # mas fuerte de "sin lentes") y onnx_prob=0.365 -- el propio
                    # clasificador ya inclinaba a "sin lentes" (su frontera
                    # natural de decision es 0.5) pero 0.17 exigia >83% de
                    # confianza para vetar, mucho mas estricto de lo razonable.
                    # El bloqueo real: la histeresis CV (rim/bridge de sombras
                    # naturales del rostro, no del armazon) se queda en
                    # cap_applied=54 y el veto es la unica salida disponible
                    # cuando eso pasa.
                    p_max = float(os.environ.get("GLASSES_ONNX_VETO_MAX_PROB", "0.45"))
                    sd_max = float(
                        os.environ.get("GLASSES_ONNX_VETO_MAX_SPEC_DENSITY", "0.0028")
                    )
                except ValueError:
                    p_max, sd_max = 0.45, 0.0028
                sd = float(gdebug.get("spec_density", 1.0))
                if float(onnx_p) < p_max and sd < sd_max:
                    hit = False
                    gdebug["onnx_no_glasses_veto"] = True
            mode_out = f"{fusion_mode}+cv_primary_bool"
        return fused, hit, mode_out, onnx_p, sf, float(cv_gscore)

    return float(cv_gscore), bool(cv_glasses_hit), fusion_mode, None, sf, float(cv_gscore)


@app.route("/analyze_eyes", methods=["POST"])
def analyze_eyes():
    global last_glasses_debug

    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400

    session_id = request.form.get("session_id")
    st = _get_session_state(session_id)

    file = request.files["image"]
    img_bytes = file.read()
    if len(img_bytes) == 0:
        return jsonify({"error": "Empty image buffer"}), 400

    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Invalid image"}), 400
    # Asegurar BGR 8 bits (bilateralFilter 8u solo CV_8UC1/CV_8UC3; no in-place mismo buffer).
    if img.dtype != np.uint8:
        if img.dtype in (np.float32, np.float64) and float(np.nanmax(img)) <= 1.01:
            img = (img * 255.0).clip(0, 255).astype(np.uint8)
        else:
            img = np.clip(img, 0, 255).astype(np.uint8)
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)
    img = np.ascontiguousarray(img)
    # OpenCV exige src.data != dst.data: filtrar sobre copia explícita.
    img = cv2.bilateralFilter(img.copy(), 5, 42, 42)

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

    detection_result = detector.detect(mp_image)

    if not detection_result.face_landmarks:
        st.mouth_closed_prev = True
        st.glasses_state_prev = False
        st.glasses_fusion_hist.clear()
        st.glasses_fusion_state_prev = False
        st.left_ear_hist.clear()
        st.right_ear_hist.clear()
        last_glasses_debug = {"reason": "no_face"}
        if _glasses_probe_sin_gafas_path():
            _append_sin_gafas_probe_record(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "detected": False,
                    "reason": "no_face",
                    "glasses_debug": {"reason": "no_face"},
                }
            )
        if _glasses_probe_path():
            _append_glasses_probe_record(
                {
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "detected": False,
                    "reason": "no_face",
                    "glasses_debug": {"reason": "no_face"},
                }
            )
        return jsonify(
            {
                "detected": False,
                "left_ear": 0.0,
                "right_ear": 0.0,
                "both_open": False,
                "mouth_open": False,
                "mouth_mar": 0.0,
                "mouth_closed": False,
                "no_glasses": True,
                "face_frontal": False,
                "glasses_score": 0.0,
                "glasses_cv_score": 0.0,
                "glasses_fusion_score": None,
                "glasses_onnx_prob": None,
                "glasses_fusion_mode": None,
                "confidence": 0.0,
                "face_oval_points": [],
            }
        )

    h, w, _ = img.shape
    landmarks = detection_result.face_landmarks[0]
    points = np.array([[lm.x * w, lm.y * h] for lm in landmarks])

    le_c = np.mean(points[LEFT_EYE], axis=0)
    re_c = np.mean(points[RIGHT_EYE], axis=0)
    inter_eye = float(np.linalg.norm(le_c - re_c))
    ear_t = adaptive_ear_threshold(inter_eye)

    left_ear_raw = calculate_ear(points, LEFT_EYE)
    right_ear_raw = calculate_ear(points, RIGHT_EYE)
    st.left_ear_hist.append(left_ear_raw)
    st.right_ear_hist.append(right_ear_raw)
    left_ear = float(np.median(st.left_ear_hist))
    right_ear = float(np.median(st.right_ear_hist))

    bs = blendshape_map(detection_result)
    blink_l = bs_get(bs, "eyeBlinkLeft", "EYE_BLINK_LEFT", "eyeblinkleft")
    blink_r = bs_get(bs, "eyeBlinkRight", "EYE_BLINK_RIGHT", "eyeblinkright")

    left_open = eye_open_hybrid(left_ear, blink_l, ear_t)
    right_open = eye_open_hybrid(right_ear, blink_r, ear_t)

    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mar_ratio = mar_inner_ratio(points)

    mouth_closed_bool = update_mouth_closed(bs, mar_ratio, st)
    mouth_open_bool = not mouth_closed_bool

    cv_gscore, cv_hit, gdebug = glasses_from_frame(img, points, st)
    fused_score, glasses_hit, fusion_mode, onnx_p, stable_fusion, cv_only = (
        apply_glasses_fusion_pipeline(img, float(cv_gscore), bool(cv_hit), gdebug, st)
    )
    no_glasses = not glasses_hit
    gdebug["glasses_fusion"] = {
        "fused_score": float(fused_score),
        "cv_score": float(cv_only),
        "stable_fusion": float(stable_fusion),
        "onnx_prob": onnx_p,
        "mode": fusion_mode,
        "decision_mode": os.environ.get("GLASSES_ONNX_DECISION_MODE", "cv_primary").strip().lower(),
        "cv_glasses_hit": bool(cv_hit),
        "final_glasses_hit": bool(glasses_hit),
    }
    last_glasses_debug = gdebug

    _probe_row = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "detected": True,
        "image_w": int(w),
        "image_h": int(h),
        "inter_eye_px": float(inter_eye),
        "glasses_hit": bool(glasses_hit),
        "no_glasses": bool(no_glasses),
        "glasses_likelihood_out": float(fused_score),
        "glasses_debug": gdebug,
    }
    if _glasses_probe_path():
        _append_glasses_probe_record(dict(_probe_row))
    if _glasses_probe_sin_gafas_path():
        _append_sin_gafas_probe_record(dict(_probe_row))

    face_frontal = face_frontal_from_points(points)

    conf = estimate_confidence(left_ear, right_ear, blink_l, blink_r, True)

    print(
        f"[EYE_AI] IED:{inter_eye:.1f} thr:{ear_t:.3f} EAR L:{left_ear:.3f} R:{right_ear:.3f} "
        f"blink L/R:{blink_l:.2f}/{blink_r:.2f} jaw:{jaw:.3f} MARi:{mar_ratio:.3f} "
        f"mouth_closed:{mouth_closed_bool} glasses:{glasses_hit}({fused_score:.1f}) "
        f"cv:{cv_gscore:.1f} fusion:{fusion_mode} onnx:"
        f"{(f'{float(onnx_p):.3f}' if onnx_p is not None else '-')} "
        f"frontal:{face_frontal} conf:{conf:.2f}",
        flush=True,
    )

    face_oval_points = []
    for idx in FACE_OVAL_INDICES:
        if not (0 <= idx < points.shape[0]):
            continue
        x = float(points[idx][0])
        y = float(points[idx][1])
        if not (np.isfinite(x) and np.isfinite(y)):
            continue
        face_oval_points.append([int(round(x)), int(round(y))])

    return jsonify(
        {
            "detected": True,
            "left_ear": float(left_ear),
            "right_ear": float(right_ear),
            "ear_threshold": float(ear_t),
            "left_open": bool(left_open),
            "right_open": bool(right_open),
            "both_open": bool(left_open and right_open),
            "mouth_open": bool(mouth_open_bool),
            "mouth_mar": float(jaw),
            "mouth_closed": bool(mouth_closed_bool),
            "no_glasses": bool(no_glasses),
            "face_frontal": bool(face_frontal),
            "glasses_score": float(fused_score),
            "glasses_cv_score": float(cv_gscore),
            "glasses_fusion_score": float(fused_score),
            "glasses_onnx_prob": onnx_p,
            "glasses_fusion_mode": fusion_mode,
            "glasses_debug": gdebug,
            "confidence": float(conf),
            "face_oval_points": face_oval_points,
        }
    )


def _face_embed_status():
    try:
        from face_embedding_insight import embedding_engine_status

        return embedding_engine_status()
    except Exception as ex:  # noqa: BLE001
        return {"ready": False, "error": str(ex), "model_name": None, "root": None}


def _get_selfie_segmenter():
    """ImageSegmenter binario (persona vs fondo) para avatar con fondo blanco real."""
    global _selfie_segmenter, _selfie_segmenter_failed
    if _selfie_segmenter_failed:
        return None
    if _selfie_segmenter is not None:
        return _selfie_segmenter
    if not os.path.isfile(SELFIE_SEGMENTER_PATH):
        print("[!] Falta selfie_segmenter.tflite; sin segmentación persona/fondo.", flush=True)
        _selfie_segmenter_failed = True
        return None
    try:
        base = python.BaseOptions(model_asset_path=SELFIE_SEGMENTER_PATH)
        opts = vision.ImageSegmenterOptions(
            base_options=base,
            running_mode=vision.RunningMode.IMAGE,
            output_category_mask=True,
        )
        _selfie_segmenter = vision.ImageSegmenter.create_from_options(opts)
    except Exception as ex:  # noqa: BLE001
        print(f"[!] ImageSegmenter no disponible: {ex}", flush=True)
        _selfie_segmenter_failed = True
        return None
    return _selfie_segmenter


def _refine_person_mask_u8(m: np.ndarray) -> np.ndarray:
    m = np.clip(m, 0, 255).astype(np.uint8)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k, iterations=2)
    k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k2, iterations=1)
    return cv2.GaussianBlur(m, (5, 5), 0)


def _person_mask_grabcut_fallback(img_bgr: np.ndarray) -> Optional[np.ndarray]:
    h, w = img_bgr.shape[:2]
    try:
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        dr = detector.detect(mp_image)
        if not dr.face_landmarks:
            return None
        pts = np.array(
            [[lm.x * w, lm.y * h] for lm in dr.face_landmarks[0]], dtype=np.float32
        )
        x0, y0 = float(pts[:, 0].min()), float(pts[:, 1].min())
        x1, y1 = float(pts[:, 0].max()), float(pts[:, 1].max())
        fw, fh = max(1.0, x1 - x0), max(1.0, y1 - y0)
        pad_x, pad_y = int(fw * 0.4), int(fh * 0.55)
        ax0 = max(0, int(x0 - pad_x))
        ay0 = max(0, int(y0 - pad_y * 0.35))
        ax1 = min(w - 1, int(x1 + pad_x))
        ay1 = min(h - 1, int(y1 + pad_y))
        rw, rh = max(1, ax1 - ax0), max(1, ay1 - ay0)
        rect = (ax0, ay0, rw, rh)
        mask = np.zeros((h, w), np.uint8)
        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        cv2.grabCut(img_bgr, mask, rect, bgd, fgd, 5, cv2.GC_INIT_WITH_RECT)
        out = np.where((mask == cv2.GC_BGD) | (mask == cv2.GC_PR_BGD), 0, 255).astype(
            np.uint8
        )
        if np.count_nonzero(out) < max(80, (h * w) // 200):
            return None
        return _refine_person_mask_u8(out)
    except Exception:
        return None


def _person_mask_selfie_or_fallback(img_bgr: np.ndarray) -> np.ndarray:
    """Máscara 0–255 persona; tamaño = imagen. Nunca None (último recurso: todo opaco)."""
    h, w = img_bgr.shape[:2]
    seg = _get_selfie_segmenter()
    if seg is not None:
        try:
            rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            res = seg.segment(mp_image)
            if res.category_mask is not None:
                mv = np.asarray(res.category_mask.numpy_view(), dtype=np.uint8)
                if mv.shape[0] != h or mv.shape[1] != w:
                    mv = cv2.resize(mv, (w, h), interpolation=cv2.INTER_NEAREST)
                fg = (mv > 0).astype(np.uint8) * 255
                if np.count_nonzero(fg) > max(200, (h * w) // 80):
                    return _refine_person_mask_u8(fg)
        except Exception:
            pass
    gc = _person_mask_grabcut_fallback(img_bgr)
    if gc is not None:
        return gc
    return np.full((h, w), 255, dtype=np.uint8)


def _local_avatar_stylize(work_bgr: np.ndarray, alpha_f: np.ndarray) -> np.ndarray:
    """
    Avatar local legible: realza contraste local (CLAHE) y suavizado sin k-means,
    que en bustos claros colapsaba todo en un bloque blanco sin ojos/nariz/boca.
    """
    a = np.clip(alpha_f, 0.0, 1.0)
    inner = (a > 0.14).astype(np.float32)

    lab = cv2.cvtColor(work_bgr, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.3, tileGridSize=(8, 8))
    l2 = clahe.apply(l_ch)
    lab2 = cv2.merge([l2, a_ch, b_ch])
    enhanced = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)

    inner3 = inner[..., None]
    mix = (
        enhanced.astype(np.float32) * inner3
        + work_bgr.astype(np.float32) * (1.0 - inner3)
    ).astype(np.uint8)

    try:
        mix = cv2.detailEnhance(mix, sigma_s=12, sigma_r=0.14)
    except Exception:
        pass
    try:
        mix = cv2.edgePreservingFilter(mix, flags=1, sigma_s=55, sigma_r=0.32)
    except Exception:
        pass
    mix = cv2.bilateralFilter(mix, 5, 42, 42)

    x = mix.astype(np.float32)
    levels = 20.0
    q = np.floor(x / 255.0 * levels) / levels * 255.0
    q = np.clip(q, 0, 255).astype(np.uint8)
    q = cv2.bilateralFilter(q, 3, 22, 22)
    return q


def _kmeans_flat_illustration(
    bgr: np.ndarray, weight: np.ndarray, k_clusters: int = 18
) -> np.ndarray:
    """
    Opcional (AVATAR_USE_KMEANS=1): ilustración muy plana; puede arruinar rostros claros.
    """
    h, w = bgr.shape[:2]
    maxd = 320
    scale = min(1.0, maxd / float(max(h, w)))
    sh = max(1, int(round(h * scale)))
    sw = max(1, int(round(w * scale)))
    sm = cv2.resize(bgr, (sw, sh), interpolation=cv2.INTER_AREA)
    sw_map = cv2.resize(weight, (sw, sh), interpolation=cv2.INTER_LINEAR)
    fg = sw_map.flatten() > 0.42
    pix = sm.reshape(-1, 3).astype(np.float32)
    data = pix[fg]
    if data.shape[0] < k_clusters * 28:
        return bgr
    k_use = min(k_clusters, data.shape[0] // 28)
    k_use = max(k_use, 8)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 0.2)
    _compact, _lbl, ctr = cv2.kmeans(
        data, k_use, None, criteria, 3, cv2.KMEANS_PP_CENTERS
    )
    ctr = np.asarray(ctr, dtype=np.float32).reshape(-1, 3)
    dists = np.sum((pix[:, None, :] - ctr[None, :, :]) ** 2, axis=2)
    assign = np.argmin(dists, axis=1).reshape(sh, sw)
    out_s = ctr[assign.reshape(-1)].reshape(sh, sw, 3)
    out_s = np.clip(out_s, 0, 255).astype(np.uint8)
    low = sw_map < 0.38
    out_s[low] = 255
    return cv2.resize(out_s, (w, h), interpolation=cv2.INTER_NEAREST)


def _is_oval_matte_black_background(img_bgr: np.ndarray) -> bool:
    """
    True si parece el JPEG enmascarado del cliente (óvalo sobre negro).
    Si es False, asumimos recorte rectangular (busto) y NO usamos máscara oval de malla.
    Solo cuatro esquinas (no todo el borde): evita confundir pelo oscuro arriba con lienzo negro.
    """
    h, w = img_bgr.shape[:2]
    if h < 24 or w < 24:
        return False
    k = max(2, min(h, w) // 45)
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    patches = (
        gray[0:k, 0:k],
        gray[0:k, w - k : w],
        gray[h - k : h, 0:k],
        gray[h - k : h, w - k : w],
    )
    corner_means = [float(np.mean(p)) for p in patches]
    if max(corner_means) > 34.0:
        return False
    cy, cx = h // 2, w // 2
    rh, rw = max(1, h // 5), max(1, w // 5)
    cen = gray[max(0, cy - rh) : min(h, cy + rh), max(0, cx - rw) : min(w, cx + rw)]
    if cen.size < 16:
        return False
    center_mean = float(np.mean(cen))
    return max(corner_means) < 30.0 and center_mean > 42.0


def _soft_edge_rectangle_mask(h: int, w: int, band_frac: float = 0.038) -> np.ndarray:
    """Máscara casi rectangular: opaca al centro, desvanece solo en el borde (sin silueta oval)."""
    band = max(5, int(band_frac * float(min(h, w))))
    yy = np.arange(h, dtype=np.float32)[:, None]
    xx = np.arange(w, dtype=np.float32)[None, :]
    dist = np.minimum(
        np.minimum(yy + 0.5, (h - 1) - yy + 0.5),
        np.minimum(xx + 0.5, (w - 1) - xx + 0.5),
    )
    alpha = np.clip(dist / float(max(1, band)), 0.0, 1.0)
    sigma = max(1.2, float(band) * 0.28)
    alpha = cv2.GaussianBlur(alpha, (0, 0), sigmaX=sigma)
    return (np.clip(alpha, 0.0, 1.0) * 255.0).astype(np.uint8)


def _segment_face_mask_from_oval_matte(img_bgr: np.ndarray) -> np.ndarray:
    """
    El cliente envía JPEG con rostro dentro de elipse y fondo negro.
    Separamos primer plano sin incluir el negro del lienzo (evita 'marco' en el avatar).
    """
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    mx = np.max(img_bgr, axis=2)
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    _, s, v = cv2.split(hsv)
    # Tonos oscuros de piel siguen teniendo S/V; el negro puro cae en todos los canales bajos
    fg = (gray > 11) | (mx > 15) | ((v > 14) & (s > 5))
    m = fg.astype(np.uint8) * 255
    k9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, k9, iterations=2)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3, iterations=1)
    return m


def _bust_roi_mask_from_mediapipe(
    img_bgr: np.ndarray,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """
    ROI vertical: rostro + cuello + algo de hombros (referencia malla MediaPipe).
    Máscara suave tipo busto (no rectángulo duro del óvalo negro).
    """
    h, w = img_bgr.shape[:2]
    if h < 48 or w < 48:
        return None
    try:
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
        dr = detector.detect(mp_image)
        if not dr.face_landmarks or len(FACE_OVAL_INDICES) < 10:
            return None
        pts = np.array(
            [[lm.x * w, lm.y * h] for lm in dr.face_landmarks[0]], dtype=np.float32
        )
        oval_pts = pts[FACE_OVAL_INDICES]
        x0, y0 = oval_pts.min(axis=0)
        x1, y1 = oval_pts.max(axis=0)
        fw = max(8.0, float(x1 - x0))
        fh = max(8.0, float(y1 - y0))
        cx = (x0 + x1) * 0.5
        chin_y = float(pts[152, 1])
        top_y = float(min(float(pts[10, 1]), float(y0))) - 0.06 * fh
        bottom_y = min(float(h), chin_y + 0.82 * fh)
        half_w = max(fw * 0.74, (bottom_y - top_y) * 0.40)
        rx0 = int(max(0, cx - half_w))
        rx1 = int(min(w, cx + half_w))
        ry0 = int(max(0, top_y))
        ry1 = int(min(h, bottom_y))
        rw, rh = rx1 - rx0, ry1 - ry0
        if rw < 40 or rh < 50:
            return None
        roi = img_bgr[ry0:ry1, rx0:rx1].copy()
        oval_roi = oval_pts - np.array([rx0, ry0], dtype=np.float32)
        hull = cv2.convexHull(oval_roi.astype(np.int32))
        mask = np.zeros((rh, rw), dtype=np.uint8)
        cv2.fillConvexPoly(mask, hull, 255)
        mid = rh // 2
        k_neck = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (max(19, rw // 7), max(28, rh // 8))
        )
        lower = mask[mid:, :].copy()
        lower = cv2.dilate(lower, k_neck, iterations=1)
        mask[mid:, :] = np.maximum(mask[mid:, :], lower)
        mask = cv2.GaussianBlur(mask, (7, 7), 0)
        _, mask = cv2.threshold(mask, 28, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(
            mask, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
        )
        return roi, mask
    except Exception:
        return None


def _bust_roi_matte_fallback(
    img_bgr: np.ndarray,
) -> Optional[Tuple[np.ndarray, np.ndarray]]:
    """Recorte elipse con negro: extiende hacia abajo para cuello si no hay malla."""
    mask_full = _segment_face_mask_from_oval_matte(img_bgr)
    H, W = img_bgr.shape[:2]
    ys, xs = np.where(mask_full > 0)
    if len(xs) < 40:
        return None
    ymin, ymax = int(ys.min()), int(ys.max())
    xmin, xmax = int(xs.min()), int(xs.max())
    fh = ymax - ymin + 1
    ymax2 = min(H - 1, ymax + int(0.58 * fh))
    pad_x = int(0.14 * (xmax - xmin + 1))
    rx0 = max(0, xmin - pad_x)
    rx1 = min(W, xmax + pad_x)
    ry0 = max(0, ymin - int(0.06 * fh))
    ry1 = min(H, ymax2)
    if rx1 - rx0 < 32 or ry1 - ry0 < 40:
        return None
    roi = img_bgr[ry0:ry1, rx0:rx1].copy()
    mask = mask_full[ry0:ry1, rx0:rx1].copy()
    mask = cv2.GaussianBlur(mask, (5, 5), 0)
    return roi, mask


def _compose_avatar_canvas(
    out: np.ndarray,
    alpha_sm: np.ndarray,
    matte_oval: bool,
    canvas_w: int,
    canvas_h: int,
) -> np.ndarray:
    """Compone el avatar sin reestilizarlo; sirve miniatura y maestro 4K."""
    th, tw = out.shape[:2]
    scale = min(canvas_w * 0.92 / tw, canvas_h * 0.92 / th)
    nw = max(64, int(round(tw * scale)))
    nh = max(64, int(round(th * scale)))
    interpolation = cv2.INTER_LANCZOS4 if scale > 1.0 else cv2.INTER_AREA
    up = cv2.resize(out, (nw, nh), interpolation=interpolation)
    alpha_big = cv2.resize(alpha_sm, (nw, nh), interpolation=cv2.INTER_LINEAR)
    alpha_big = cv2.GaussianBlur(alpha_big, (3, 3), 0)
    mup_f = alpha_big[..., None]

    canvas = np.ones((canvas_h, canvas_w, 3), dtype=np.uint8) * 255
    if np.any(alpha_big > 0.08):
        ys, xs = np.where(alpha_big > 0.2)
        pcx = float(np.mean(xs))
        pcy = float(np.mean(ys))
    else:
        pcx, pcy = nw * 0.5, nh * 0.5
    target_cx = canvas_w * 0.5
    target_cy = canvas_h * (0.39 if not matte_oval else 0.42)
    ox = int(round(target_cx - pcx))
    oy = int(round(target_cy - pcy))
    ox = max(0, min(ox, canvas_w - nw))
    oy = max(0, min(oy, canvas_h - nh))

    reg = canvas[oy : oy + nh, ox : ox + nw]
    reg[:] = (
        reg.astype(np.float32) * (1.0 - mup_f) + up.astype(np.float32) * mup_f
    ).astype(np.uint8)
    return canvas


def _cartoonify_face_bgr(img_bgr: np.ndarray) -> Optional[Tuple[str, str]]:
    """
    Un único avatar PNG por imagen, 100 % local:
    segmentación selfie / GrabCut, fondo blanco, estilo con CLAHE + realce suave
    (por defecto). k-means plano solo si AVATAR_USE_KMEANS=1 (puede borrar rasgos).
    """
    if img_bgr is None or img_bgr.size == 0:
        return None
    h0, w0 = img_bgr.shape[:2]
    if h0 < 32 or w0 < 32:
        return None
    try:
        matte_oval = _is_oval_matte_black_background(img_bgr)
        if matte_oval:
            pair = _bust_roi_mask_from_mediapipe(img_bgr)
            if pair is None:
                pair = _bust_roi_matte_fallback(img_bgr)
        else:
            pm = _person_mask_selfie_or_fallback(img_bgr)
            edge = (
                _soft_edge_rectangle_mask(h0, w0, 0.036).astype(np.float32) / 255.0
            )
            m_float = np.clip(pm.astype(np.float32) / 255.0 * edge, 0.0, 1.0)
            # Selfie a veces marca casi todo el cuadro → rostro se pierde en k-means/colores.
            if float(np.mean(m_float > 0.45)) > 0.88:
                gc = _person_mask_grabcut_fallback(img_bgr)
                if gc is not None:
                    m_float = np.clip(
                        gc.astype(np.float32) / 255.0 * edge, 0.0, 1.0
                    )
            m = (m_float * 255.0).astype(np.uint8)
            pair = (img_bgr.copy(), m)
        if pair is None:
            return None
        roi, m = pair
        md0 = min(roi.shape[0], roi.shape[1])
        min_up = 480 if not matte_oval else 400
        if md0 < min_up:
            s_up = float(min_up) / float(md0)
            roi = cv2.resize(
                roi,
                (
                    max(1, int(round(roi.shape[1] * s_up))),
                    max(1, int(round(roi.shape[0] * s_up))),
                ),
                interpolation=cv2.INTER_CUBIC,
            )
            m = cv2.resize(m, (roi.shape[1], roi.shape[0]), interpolation=cv2.INTER_LINEAR)
            blur0 = cv2.GaussianBlur(roi, (0, 0), sigmaX=1.0)
            roi = cv2.addWeighted(roi, 1.06, blur0, -0.06, 0)
        rh, rw = roi.shape[:2]
        # El trabajo se conserva hasta 1600 px para no destruir detalle de la
        # captura antes de componer el máster 4K. Sigue siendo una operación
        # asíncrona de registro, no del render interactivo de la cabecera.
        max_side = 1600 if not matte_oval else 1280
        sc = min(max_side / float(max(rh, rw)), 1.0)
        tw = max(96, int(round(rw * sc)))
        th = max(96, int(round(rh * sc)))
        work = cv2.resize(roi, (tw, th), interpolation=cv2.INTER_AREA)
        mw = cv2.resize(m, (tw, th), interpolation=cv2.INTER_LINEAR)
        _, mw_bin = cv2.threshold(mw, 40, 255, cv2.THRESH_BINARY)

        a = np.clip(mw.astype(np.float32) / 255.0, 0.0, 1.0)
        a = cv2.GaussianBlur(a, (3, 3), 0)
        work_wb = (
            work.astype(np.float32) * a[..., None] + 255.0 * (1.0 - a[..., None])
        ).astype(np.uint8)

        if matte_oval:
            dt = cv2.distanceTransform(mw_bin, cv2.DIST_L2, 5)
            r_soft = min(0.045 * float(max(tw, th)), 18.0)
            r_soft = max(r_soft, 4.0)
            if dt.max() > 1e-3:
                alpha_sm = np.clip(dt / r_soft, 0.0, 1.0)
            else:
                alpha_sm = (mw_bin > 0).astype(np.float32)
            alpha_sm = cv2.GaussianBlur(alpha_sm, (5, 5), 0)
        else:
            bin_fg = (mw > 80).astype(np.uint8) * 255
            dt = cv2.distanceTransform(bin_fg, cv2.DIST_L2, 5)
            r_soft = min(0.03 * float(max(tw, th)), 14.0)
            r_soft = max(r_soft, 3.0)
            if dt.max() > 1e-3:
                alpha_sm = np.clip(dt / r_soft, 0.0, 1.0)
            else:
                alpha_sm = a
            alpha_sm = cv2.GaussianBlur(alpha_sm, (5, 5), 0)

        try:
            base = cv2.edgePreservingFilter(
                work_wb, flags=1, sigma_s=62, sigma_r=0.35
            )
            base = cv2.bilateralFilter(base, 7, 46, 46)
        except Exception:
            base = cv2.bilateralFilter(work_wb, 7, 44, 44)

        if np.count_nonzero(mw_bin > 0) < 100:
            return None

        k_flat = 14 if matte_oval else 20
        if os.environ.get("AVATAR_USE_KMEANS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            flat = _kmeans_flat_illustration(base, a, k_clusters=k_flat)
            out = cv2.bilateralFilter(flat, 3, 20, 20)
        else:
            out = _local_avatar_stylize(work_wb, a)

        ink_strength = 0.065 if not matte_oval else 0.095
        if min(tw, th) >= 140:
            g = cv2.cvtColor(base, cv2.COLOR_BGR2GRAY)
            g = cv2.bilateralFilter(g, 3, 22, 22)
            edges = cv2.adaptiveThreshold(
                g,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY_INV,
                9,
                2,
            )
            _, edges = cv2.threshold(edges, 175, 255, cv2.THRESH_BINARY)
            edge_m = (edges > 0) & (mw_bin > 0)
            ink = np.array([34, 30, 44], dtype=np.uint8)
            out = out.copy()
            out[edge_m] = (
                (1.0 - ink_strength) * out[edge_m].astype(np.float32)
                + ink_strength * ink
            ).astype(np.uint8)

        thumb = _compose_avatar_canvas(out, alpha_sm, matte_oval, 768, 1024)
        # Maestro 4K vertical (3:4). Se persiste fuera de la sesión y se
        # descarga únicamente al ampliar el avatar.
        hd = _compose_avatar_canvas(out, alpha_sm, matte_oval, 2880, 3840)
        ok_thumb, buf_thumb = cv2.imencode(
            ".png", thumb, [cv2.IMWRITE_PNG_COMPRESSION, 3]
        )
        ok_hd, buf_hd = cv2.imencode(
            ".png", hd, [cv2.IMWRITE_PNG_COMPRESSION, 5]
        )
        if not ok_thumb or not ok_hd:
            return None
        return (
            base64.b64encode(buf_thumb.tobytes()).decode("ascii"),
            base64.b64encode(buf_hd.tobytes()).decode("ascii"),
        )
    except Exception:
        return None


@app.route("/cartoon_avatar", methods=["POST"])
def cartoon_avatar():
    """POST multipart field 'image' — JPEG/PNG (busto rectangular o retrato óvalo sobre negro)."""
    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image"}), 400
    raw = request.files["image"].read()
    if not raw:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    nparr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400
    avatars = _cartoonify_face_bgr(img)
    if not avatars:
        return jsonify({"ok": False, "error": "cartoonify_failed"}), 200
    thumb_b64, hd_b64 = avatars
    return jsonify(
        {
            "ok": True,
            "image_base64": thumb_b64,
            "image_hd_base64": hd_b64,
            "format": "png",
            "width": 768,
            "height": 1024,
            "hd_width": 2880,
            "hd_height": 3840,
            "generator": "local_mediapipe_opencv",
        }
    )


@app.route("/face_embedding", methods=["POST"])
def face_embedding():
    """
    Vector facial L2-normalizado (InsightFace / ONNX Runtime) para registro/login seguro.
    """
    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image"}), 400
    file = request.files["image"]
    raw = file.read()
    if not raw:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    nparr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400
    try:
        from face_embedding_insight import extract_normed_embedding_bgr

        emb, err = extract_normed_embedding_bgr(img)
    except Exception as ex:  # noqa: BLE001
        return (
            jsonify(
                {
                    "ok": False,
                    "error": "face_embedding_import_failed",
                    "detail": str(ex),
                }
            ),
            503,
        )
    if emb is None:
        return jsonify({"ok": False, "error": err or "unknown"}), 200
    return jsonify(
        {
            "ok": True,
            "dim": int(emb.shape[0]),
            "embedding": [float(x) for x in emb.flat],
            "provider": "insightface_onnx",
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify(
        {
            "status": "ok",
            "engine": "MediaPipe Tasks FaceLandmarker",
            "model": MODEL_PATH,
            "mp_det": MIN_FACE_DET_CONF,
            "glasses_probe_log": _glasses_probe_path(),
            "glasses_probe_sin_gafas_log": _glasses_probe_sin_gafas_path(),
            "glasses_onnx_path": os.environ.get("GLASSES_ONNX_PATH", "").strip() or None,
            "glasses_onnx_error": onnx_load_error(),
            "face_embedding": _face_embed_status(),
            "cartoon_avatar": {
                "mode": "local",
                "external_apis": False,
            },
            "mediapipe_models": {
                "face_landmarker_path": MODEL_PATH,
                "face_landmarker_ok": os.path.isfile(MODEL_PATH),
                "selfie_segmenter_path": SELFIE_SEGMENTER_PATH,
                "selfie_segmenter_ok": os.path.isfile(SELFIE_SEGMENTER_PATH),
            },
        }
    )


@app.route("/scan_document", methods=["POST"])
def scan_document():
    """Lectura de DNI por cámara (PDF417 del DNI antiguo + MRZ de todas las
    versiones) -- ver dni_scan.py. Nunca consulta RENIEC/SUNAT; solo
    decodifica lo ya impreso en el documento."""
    if "image" not in request.files:
        return jsonify({"error": "No image provided"}), 400
    file = request.files["image"]
    img_bytes = file.read()
    if len(img_bytes) == 0:
        return jsonify({"error": "Empty image buffer"}), 400
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"error": "Invalid image"}), 400
    return jsonify(scan_dni_image(img))


@app.route("/glasses_debug", methods=["GET"])
def glasses_debug():
    return jsonify(last_glasses_debug)


if __name__ == "__main__":
    print("[EYE_AI] Motor IA puerto 5000", flush=True)
    if os.environ.get("GLASSES_ONNX_PATH", "").strip():
        warmup_glasses_onnx()
    if os.environ.get("WARMUP_FACE_EMBEDDING", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    ):
        try:
            from face_embedding_insight import warmup_face_embedding

            warmup_face_embedding()
        except Exception as ex:  # noqa: BLE001
            print(f"[FACE_EMB] Warmup omitido: {ex}", flush=True)
    app.run(host="0.0.0.0", port=5000, threaded=True)
