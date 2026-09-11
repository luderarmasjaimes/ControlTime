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
from fotocheck_render import generate_fotocheck_image
from seetaface6_adapter import analyze as analyze_seetaface6
from seetaface6_adapter import status as seetaface6_status
from deepface_silentface_adapter import analyze as analyze_deepface_silentface
from deepface_silentface_adapter import status as deepface_silentface_status
from deepface_silentface_adapter import warmup as warmup_deepface_silentface
from avatar_diffusion import (
    is_enabled as avatar_diffusion_enabled,
    record_quality_rejected as avatar_diffusion_record_quality_rejected,
    stats as avatar_diffusion_stats,
    stylize_portrait_diffusion,
)

# =============================================================================
# TUNING — confianza del landmarker (más bajo = más tolerante a caras pequeñas/luz difícil)
# =============================================================================
MIN_FACE_DET_CONF = float(os.environ.get("MP_MIN_FACE_DET", "0.42"))
MIN_FACE_PRESENCE_CONF = float(os.environ.get("MP_MIN_FACE_PRES", "0.42"))
MIN_TRACKING_CONF = float(os.environ.get("MP_MIN_TRACK", "0.42"))

# EAR: umbral base; se adapta ligeramente a la distancia (IED en píxeles)
EAR_THRESH_BASE = float(os.environ.get("EAR_THRESH_BASE", "0.185"))
# 143px (antes 95px). La resolución de captura se probó en 1280x960 el
# 2026-09-03 (con este valor subido a 191px a juego), pero se revirtió a
# 960x720 el 2026-09-04 en frontend/src/config/facialIcaoConfig.ts (ver
# comentario ahí): a 1280x960 la cámara quedaba "Activa" pero el <video>
# nunca mostraba un frame real y la sesión terminaba en timeout. Este valor
# vuelve a 143px para seguir coherente con la resolución 960x720 realmente en
# uso.
EAR_IED_REF_PX = float(os.environ.get("EAR_IED_REF", "143.0"))  # ~distancia interocular de referencia
# Ancho de frame contra el que se calibró EAR_IED_REF_PX (960px, ver historial
# arriba: "se revirtió a 960x720... este valor vuelve a 143px para seguir
# coherente con la resolución 960x720 realmente en uso"). Pedido explícito
# del usuario 2026-09-07: el frontend ya no manda un ancho fijo -- la
# resolución de envío se autoajusta (arranca en la resolución NATIVA de la
# cámara, sólo baja si el procesamiento da problemas, ver
# adaptiveEncodeResolution.ts en el frontend). Un umbral en píxeles
# ABSOLUTOS dejaba de tener sentido apenas el ancho variara: a mayor
# resolución, inter_eye_px sube proporcionalmente SIN que la persona se haya
# movido, saturando siempre el piso EAR_IED_SCALE_MIN sin importar la
# distancia real. adaptive_ear_threshold ahora compara PROPORCIONES
# (inter_eye_px / ancho_frame) en vez de píxeles crudos -- a 960px de ancho
# (la resolución en uso hasta ahora) el resultado es MATEMÁTICAMENTE
# IDÉNTICO al umbral ya calibrado en producción (143/960 == 143/inter_eye_px
# cuando ancho_frame=960), y se generaliza sin sorpresas a cualquier otro
# ancho.
EAR_IED_REF_WIDTH_PX = float(os.environ.get("EAR_IED_REF_WIDTH", "960.0"))
EAR_IED_SCALE_MIN = float(os.environ.get("EAR_IED_SCALE_MIN", "0.88"))
# Techo bajado de 1.12 a 1.00 (2026-08-19, datos reales de producción): a
# menos IED (cara más lejos/chica) el EAR crudo medido YA baja por la propia
# pérdida de precisión de pocos píxeles (confirmado: EAR combinado ~0.15-0.24
# a IED~78-90, contra ~0.30-0.35 a IED~95+) -- exigir un umbral MÁS ALTO
# encima de un EAR ya más bajo era un doble castigo por distancia, la causa
# real de que hubiera que acercarse mucho para que "ojos abiertos" pasara
# rápido. El umbral ya no sube por estar lejos; el piso 0.88 se mantiene
# (más permisivo de cerca, donde el EAR es confiable y da margen de sobra).
EAR_IED_SCALE_MAX = float(os.environ.get("EAR_IED_SCALE_MAX", "1.00"))

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

# MediaPipe Tasks (FaceLandmarker/ImageSegmenter) NO garantiza que un mismo
# objeto sea seguro para llamadas concurrentes desde varios hilos -- mismo
# problema que ya se identificó y se serializó con _lock en
# face_embedding_insight.py (InsightFace) y con _glasses_lock más abajo (CV
# de gafas): con threaded=True, dos frames en vuelo al mismo tiempo (la
# propia UI manda uno cada VERIFY_SYNC_MS=175ms y puede solaparse si un
# detect() tarda más que eso, o dos sesiones/pestañas concurrentes) pueden
# corromper el estado interno del detector compartido o colgarlo sin log de
# cierre -- el mismo síntoma "llega a los frames requeridos y después no
# avanza, sin error, hasta el timeout" reportado en vivo para login/registro
# facial. A diferencia de _glasses_lock (que ya protegía el cálculo CV de
# gafas), detector.detect()/segmenter.segment() -- llamados en CADA
# verify-frame, la ruta más caliente de todo el pipeline -- corrían sin
# ningún lock.
_mediapipe_lock = threading.Lock()

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
        "onnx_confident_no_glasses_streak",
        "onnx_confident_glasses_streak",
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
        self.onnx_confident_no_glasses_streak = 0
        self.onnx_confident_glasses_streak = 0
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


def adaptive_ear_threshold(inter_eye_px: float, frame_width_px: float) -> float:
    """Umbral EAR más estable al acercar/alejar la cabeza -- normalizado por
    el ANCHO del frame (proporción, no píxeles absolutos) para no depender
    de a qué resolución llega la imagen. Ver EAR_IED_REF_WIDTH_PX arriba."""
    if inter_eye_px < 1e-3 or frame_width_px < 1e-3:
        return EAR_THRESH_BASE
    ied_ratio = inter_eye_px / frame_width_px
    ref_ratio = EAR_IED_REF_PX / EAR_IED_REF_WIDTH_PX
    scale = float(np.clip(ref_ratio / ied_ratio, EAR_IED_SCALE_MIN, EAR_IED_SCALE_MAX))
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


def head_yaw_ratio_from_points(points: np.ndarray) -> float:
    """
    Igual geometría que face_frontal_from_points (nariz vs eje interocular)
    pero con signo: positivo = nariz desplazada hacia el lado derecho de la
    imagen (usuario giró la cabeza hacia SU izquierda), negativo = hacia el
    lado izquierdo de la imagen (giró hacia SU derecha). Usado para el
    desafío activo de liveness "gira la cabeza" -- valores ~0.20-0.25 ya son
    un giro claro y visible sin perder la detección del rostro (el límite de
    "no frontal" en face_frontal_from_points es 0.42, mucho más extremo).
    """
    if points.shape[0] < 400:
        return 0.0
    nose = points[1]
    le = np.mean(points[LEFT_EYE], axis=0)
    re = np.mean(points[RIGHT_EYE], axis=0)
    mid = (le + re) * 0.5
    ied = float(np.linalg.norm(le - re))
    if ied < 12.0:
        return 0.0
    return float((nose[0] - mid[0]) / ied)


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

    # ADR-156 (2026-09-04) -- calibrado con evidencia real de las DOS sondas:
    # glasses_probe.jsonl (10802 frames CON gafas) y
    # glasses_probe_sin_gafas.jsonl (391 frames SIN gafas, misma cara/camara
    # del reporte). Hallazgo: `bilateral_glare` NUNCA se cumple (0.0% en
    # ambos datasets), asi que strong_glare/medium_glare eran codigo muerto y
    # `glare_term` se otorgaba a partir de spec_density CRUDO -- sin exigir
    # ninguna de las condiciones que este mismo archivo usa para decidir si un
    # brillo es de LENTES. Con 0.0027 de spec_density (mediana de los falsos
    # positivos medidos) el termino satura en sus 72 puntos, el mayor de
    # todos, y ademas levanta el tope protector de abajo: score -> 100 ->
    # "con lentes" sobre una cara sin lentes.
    #
    # La evidencia dice que ese brillo NO viene de gafas: en los 10802 frames
    # CON gafas hay hits especulares en solo el 0.1% (las gafas reales de ese
    # dataset casi no dan brillo aprovechable), mientras que SIN gafas hay
    # hits en el 39.6% -- y de un solo lado (left_hits>0 en 39.6%,
    # right_hits>0 en 1.3%): es el contraluz de una ventana sobre la piel, no
    # un reflejo de cristal. Medido sobre la rama de entrada CV completa: se
    # dispara en el 0.1% de los frames CON gafas y en el 41.7% de los frames
    # SIN gafas. Es decir, no aporta deteccion real y produce casi todos los
    # falsos positivos; la deteccion real de gafas la sostiene el clasificador
    # ONNX (ver el bloque de entrada confirmada en fuse_glasses_scores).
    #
    # Correccion: los puntos de brillo solo cuentan si el brillo es
    # BILATERAL. Dos lentes producen reflejo en AMBOS ojos; una fuente lateral
    # sobre la piel, en uno solo. Es la misma condicion que ya exigian
    # strong_glare/medium_glare mas abajo -- aqui simplemente se aplica antes
    # de repartir los puntos, en vez de despues.
    bilateral_glare = left_hits > 0 and right_hits > 0
    glare_term = min(72.0, spec_density * 52000.0) if bilateral_glare else 0.0
    blob_term = (
        min(22.0, float(comp_count) * 6.0 + (float(area_sum) / float(spec_mask.size + 1)) * 2200.0)
        if bilateral_glare
        else 0.0
    )
    frame_term = max(0.0, horiz_ratio - 1.00) * 14.0 + max(0.0, horiz_energy - 3.0) * 2.4
    frame_term = min(18.0, frame_term)
    rim_term = min(34.0, rim_density * 230.0)
    bridge_term = min(20.0, bridge_dark * 270.0)
    score = float(np.clip(glare_term + blob_term + frame_term + rim_term + bridge_term, 0.0, 100.0))
    score_terms = float(score)
    if spec_density < 0.0008 and comp_count == 0 and rim_density < 0.075 and bridge_dark < 0.028:
        score = min(score, 32.0)
    score_after_tight = float(score)

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
    # ADR-156: el tope se levantaba con spec_density >= 0.0008 -- un umbral que
    # el contraluz de una ventana cruza de sobra (0.0027 medido), dejando la
    # cara sin lentes con score 100. Ahora solo lo levanta un brillo BILATERAL
    # (creible como reflejo de cristal); sin eso el tope protege igual que
    # antes contra nariz/cejas/sombras naturales.
    cap_applied = None
    if not bilateral_glare:
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
            # ADR-156 (2026-09-04): 0.14 -> 0.16 y 0.20 -> 0.22, calibrado con
            # las dos sondas de la misma cara/camara (620 frames CON gafas,
            # 391 SIN). `bridge_dark` -- la franja oscura sobre el puente de la
            # nariz, donde apoya la montura -- es la senal que de verdad
            # separa: mediana 0.172 CON gafas contra 0.057 SIN (3x). Tras
            # cerrar la puerta del brillo no bilateral (ver arriba), esta ruta
            # mate quedo como la UNICA entrada CV activa, asi que su umbral
            # pasa a decidir solo: con 0.14 todavia se disparaba en el 2.0% de
            # los frames SIN gafas, y como la histeresis se engancha con UN
            # solo frame y esta cara no puede salir nunca (ver nota de salida
            # mas abajo), ese 2% por frame equivale a fallar casi seguro en una
            # captura de ~115 frames. Barrido medido sobre ambos datasets:
            # 0.14 -> 23.9% CON / 2.0% SIN | 0.15 -> 20.3% / 0.5% |
            # 0.16 -> 18.2% / 0.0% | 0.20 -> 10.5% / 0.0%.
            #
            # CORRECCION tras medir una SEGUNDA sesion sin lentes: el 0.16 de
            # la primera pasada estaba sobreajustado a un solo dataset (cuyo
            # bridge_dark maximo era 0.1559). En la sesion siguiente, con otra
            # distancia/luz, la misma cara SIN lentes llego a 0.1781 y volvio a
            # dar falsos positivos (15.6% de los frames, amplificado porque la
            # entrada es pegajosa y esta cara no puede salir -- ver nota de
            # salida). Recalibrado con AMBAS sesiones: SIN gafas p90=0.127,
            # max=0.1781; CON gafas mediana=0.172, p75=0.205. Se toma 0.20, que
            # deja margen real sobre el maximo observado sin lentes en vez de
            # rozarlo, y conserva 10.5% de frames con gafas -- de sobra para
            # que la histeresis se enganche. Nota: `rim_density` NO discrimina
            # (mediana 0.204 con gafas vs 0.195 sin), asi que bridge_dark es la
            # unica senal real de esta ruta.
            (rim_density >= 0.10 and bridge_dark >= 0.20)
            or (rim_density >= 0.055 and bridge_dark >= 0.26)
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
                # ADR-156: "hay algo de brillo" (spec/comp de un solo lado) era
                # la puerta por la que entraban los falsos positivos -- se
                # exige que sea bilateral, ver el comentario largo arriba.
                stable > 51.0
                and frame_presence
                and bilateral_glare
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
        and bilateral_glare
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
                    # No se pisa `hit` aqui con el valor de UN solo frame:
                    # eso era lo que hacia parpadear "no_glasses" SI/NO cada
                    # frame con el ruido del clasificador (ver comentario mas
                    # abajo). El cambio de estado real solo lo aplica el
                    # bloque de salida confirmada (varios frames sostenidos).
                    gdebug["onnx_no_glasses_veto"] = True

            # El veto de arriba (770-796) ya no pisa `hit` de un solo frame:
            # solo deja constancia en gdebug. El cambio de estado real (y de
            # `hit`) requiere confianza ONNX baja Y SOSTENIDA (varios frames,
            # no uno), aplicada aqui abajo sobre st.glasses_state_prev
            # (caso real que motivo esto: usuario se quito los lentes,
            # glasses_debug mostraba glasses_state=true / exit_glasses_condition
            # =false indefinidamente porque su rim/bridge SIN lentes, 0.206/
            # 0.070, nunca bajaba del umbral de salida 0.050/0.015 calibrado
            # con otra cara/iluminacion -- sin este bloque el resultado final
            # solo parpadeaba con el ruido del clasificador, nunca resolvia
            # "sin lentes" de forma estable). Esto da salida limpia en vez de
            # parpadeo, sin bajar el umbral de salida del heuristico CV (que
            # sigue protegiendo contra quitarse los lentes de un solo frame,
            # p.ej. un parpadeo de camara o intento de evadir el chequeo).
            if onnx_p is not None and st.glasses_state_prev:
                try:
                    exit_prob = float(
                        os.environ.get("GLASSES_ONNX_EXIT_CONFIRM_PROB", "0.35")
                    )
                    exit_frames = max(
                        1, int(os.environ.get("GLASSES_ONNX_EXIT_CONFIRM_FRAMES", "3"))
                    )
                except ValueError:
                    exit_prob, exit_frames = 0.35, 3
                if float(onnx_p) < exit_prob:
                    st.onnx_confident_no_glasses_streak += 1
                    if st.onnx_confident_no_glasses_streak >= exit_frames:
                        st.glasses_state_prev = False
                        st.glasses_score_hist.clear()
                        st.onnx_confident_no_glasses_streak = 0
                        hit = False
                        gdebug["onnx_confirmed_exit"] = True
                else:
                    st.onnx_confident_no_glasses_streak = 0
            else:
                st.onnx_confident_no_glasses_streak = 0

            # Simetrico al bloque de arriba, en la direccion contraria: la CV
            # nunca "entra" (rim/puente/spec no alcanzan sus umbrales -- ver
            # frame_presence/matte_frame_signal) con gafas sin marco marcado,
            # de cristal delgado o sin brillo aprovechable en el angulo de la
            # camara. Evidencia real medida en ai_engine_probe_logs/
            # glasses_probe.jsonl: 3515 frames confirmados CON gafas puestas
            # donde onnx_prob estaba en 0.7-0.9 (el clasificador acertaba con
            # alta confianza) pero cv_glasses_hit era False en el 100% de
            # ellos -- el modo cv_primary anterior solo dejaba que ONNX
            # VETARA una deteccion CV (bajar "con lentes" a "sin lentes"),
            # nunca que la CONFIRMARA (subir "sin lentes" a "con lentes"),
            # desperdiciando la senal mas fiable de las dos justo cuando la
            # CV fallaba -- causa raiz confirmada de "deja pasar con lentes
            # puestos". Igual que la salida, exige confianza ALTA y
            # SOSTENIDA (varios frames, no uno) para evitar falsos positivos
            # por ruido del clasificador en un solo frame.
            if onnx_p is not None and not st.glasses_state_prev:
                try:
                    entry_prob = float(
                        os.environ.get("GLASSES_ONNX_ENTRY_CONFIRM_PROB", "0.65")
                    )
                    entry_frames = max(
                        1, int(os.environ.get("GLASSES_ONNX_ENTRY_CONFIRM_FRAMES", "3"))
                    )
                except ValueError:
                    entry_prob, entry_frames = 0.65, 3
                if float(onnx_p) > entry_prob:
                    st.onnx_confident_glasses_streak += 1
                    if st.onnx_confident_glasses_streak >= entry_frames:
                        st.glasses_state_prev = True
                        st.onnx_confident_glasses_streak = 0
                        hit = True
                        gdebug["onnx_confirmed_entry"] = True
                else:
                    st.onnx_confident_glasses_streak = 0
            else:
                st.onnx_confident_glasses_streak = 0
            mode_out = f"{fusion_mode}+cv_primary_bool"
        return fused, hit, mode_out, onnx_p, sf, float(cv_gscore)

    return float(cv_gscore), bool(cv_glasses_hit), fusion_mode, None, sf, float(cv_gscore)


@app.route("/analyze_eyes", methods=["POST"])
def analyze_eyes():
    global last_glasses_debug

    _t_start = time.perf_counter()

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
    _t_decoded = time.perf_counter()
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

    with _mediapipe_lock:
        detection_result = detector.detect(mp_image)
    _t_mediapipe = time.perf_counter()

    if not detection_result.face_landmarks:
        print(
            f"[EYE_AI_TIMING] session={session_id or '-'} detected=False "
            f"decode_ms:{(_t_decoded - _t_start) * 1000:.1f} "
            f"mediapipe_ms:{(_t_mediapipe - _t_decoded) * 1000:.1f} "
            f"total_ms:{(_t_mediapipe - _t_start) * 1000:.1f}",
            flush=True,
        )
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
    ear_t = adaptive_ear_threshold(inter_eye, w)

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
    # A distancias mayores (IED bajo, cara chica en el frame), la medición
    # EAR de UN solo ojo se vuelve ruidosa por menos píxeles/ángulo -- se
    # midió en producción (2026-08-19, IED~55-62px) casos con EAR L:0.145
    # EAR R:0.071 en el mismo frame (blink_bs bajo en ambos, sin evidencia de
    # parpadeo real), exigir left_open Y right_open por separado rechazaba
    # "ojos abiertos" por ruido de un solo ojo, no porque los ojos
    # estuvieran cerrados. Un parpadeo real cierra ambos ojos casi
    # simultáneamente -- si el MEJOR de los dos (EAR más alto, blendshape de
    # parpadeo más bajo) confirma claramente "abierto", es evidencia
    # confiable aunque el otro ojo mida ruido en ese frame.
    combined_ear = max(left_ear, right_ear)
    combined_blink = min(blink_l, blink_r)
    both_open_robust = eye_open_hybrid(combined_ear, combined_blink, ear_t)

    # Señal de PARPADEO (ADR-148) -- a propósito con el sesgo OPUESTO al de
    # both_open_robust de arriba. both_open_robust usa max(EAR)/min(blink)
    # para EVITAR falsos "cerrado" por ruido de un solo ojo (protege el
    # chequeo ICAO real de rechazos falsos). Acá el objetivo es el contrario:
    # capturar el EVENTO de parpadeo real para el desafío de liveness pasivo
    # (ver updateNaturalBlink en backend/src/biometric/liveness_challenge.cpp)
    # -- con esa fusión conservadora, un parpadeo natural (no exagerado) casi
    # nunca hacía bajar el "ojos abiertos" combinado, porque bastaba con que
    # UN ojo midiera bien para que el sistema reportara "abierto" aunque el
    # otro sí mostrara evidencia clara de parpadeo. Confirmado con datos
    # reales de producción 2026-09-04: blink L/R llegó a 0.50/0.31 y
    # 0.42/0.32 durante un parpadeo real, sostenido varios frames -- el min()
    # (0.31, 0.32) nunca cruzó BLINK_STRONG (0.52) ni siquiera BLINK_SOFT
    # (0.38), así que both_open_robust jamás bajó a False y el parpadeo
    # nunca se registraba como evento. Usa max(blink)/min(EAR): CUALQUIERA
    # de los dos ojos mostrando evidencia de cierre cuenta.
    blink_signal_ear = min(left_ear, right_ear)
    blink_signal_blink = max(blink_l, blink_r)
    blink_signal_open = not (
        blink_signal_blink >= BLINK_SOFT or blink_signal_ear < ear_t * 0.90
    )

    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mar_ratio = mar_inner_ratio(points)

    mouth_closed_bool = update_mouth_closed(bs, mar_ratio, st)
    mouth_open_bool = not mouth_closed_bool

    _t_landmarks = time.perf_counter()
    cv_gscore, cv_hit, gdebug = glasses_from_frame(img, points, st)
    _t_glasses_cv = time.perf_counter()
    fused_score, glasses_hit, fusion_mode, onnx_p, stable_fusion, cv_only = (
        apply_glasses_fusion_pipeline(img, float(cv_gscore), bool(cv_hit), gdebug, st)
    )
    _t_glasses_fusion = time.perf_counter()
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
    head_yaw_ratio = head_yaw_ratio_from_points(points)

    conf = estimate_confidence(left_ear, right_ear, blink_l, blink_r, True)
    _t_end = time.perf_counter()

    print(
        f"[EYE_AI] IED:{inter_eye:.1f} thr:{ear_t:.3f} EAR L:{left_ear:.3f} R:{right_ear:.3f} "
        f"blink L/R:{blink_l:.2f}/{blink_r:.2f} jaw:{jaw:.3f} MARi:{mar_ratio:.3f} "
        f"mouth_closed:{mouth_closed_bool} glasses:{glasses_hit}({fused_score:.1f}) "
        f"cv:{cv_gscore:.1f} fusion:{fusion_mode} onnx:"
        f"{(f'{float(onnx_p):.3f}' if onnx_p is not None else '-')} "
        f"frontal:{face_frontal} both_open:{both_open_robust} blink_signal_open:{blink_signal_open} "
        f"conf:{conf:.2f}",
        flush=True,
    )
    print(
        f"[EYE_AI_TIMING] session={session_id or '-'} detected=True "
        f"decode_ms:{(_t_decoded - _t_start) * 1000:.1f} "
        f"mediapipe_ms:{(_t_mediapipe - _t_decoded) * 1000:.1f} "
        f"ear_ms:{(_t_landmarks - _t_mediapipe) * 1000:.1f} "
        f"glasses_cv_ms:{(_t_glasses_cv - _t_landmarks) * 1000:.1f} "
        f"glasses_onnx_fusion_ms:{(_t_glasses_fusion - _t_glasses_cv) * 1000:.1f} "
        f"tail_ms:{(_t_end - _t_glasses_fusion) * 1000:.1f} "
        f"total_ms:{(_t_end - _t_start) * 1000:.1f}",
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
            "both_open": bool(both_open_robust),
            # ADR-148: señal de parpadeo específica, más sensible que
            # "both_open" (ver comentario arriba de blink_signal_open) --
            # sólo la usa el desafío de liveness pasivo, nunca el chequeo
            # ICAO real (ese sigue en "both_open").
            "blink_signal_open": bool(blink_signal_open),
            "mouth_open": bool(mouth_open_bool),
            "mouth_mar": float(jaw),
            "mouth_closed": bool(mouth_closed_bool),
            "no_glasses": bool(no_glasses),
            "face_frontal": bool(face_frontal),
            "head_yaw_ratio": float(head_yaw_ratio),
            # Distancia interocular en píxeles del frame actual -- proxy directo
            # de qué tan cerca/lejos está la persona de la cámara. Usado por el
            # desafío de liveness "acércate/aléjate de la cámara" (ADR-146):
            # el servidor guarda un valor de referencia al armar el desafío y
            # exige que este valor suba/baje una proporción clara respecto a
            # esa referencia (ver kLivenessMoveCloserRatio/kLivenessMoveAwayRatio
            # en backend/src/biometric/liveness_challenge.hpp).
            "inter_eye_px": float(inter_eye),
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
            # El selfie_segmenter binario expone una única confianza continua
            # (persona=1, fondo=0). Su category_mask no contiene ids 0/1:
            # MediaPipe la cuantiza a 0/255 y, para este modelo, 255 representa
            # el fondo. Tratar ``category_mask > 0`` como primer plano invierte
            # la silueta: borra la cara y conserva la habitación. Pedimos la
            # confianza explícita y la usamos como fuente de verdad.
            output_confidence_masks=True,
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
        with _mediapipe_lock:
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


def _restrict_mask_to_face_component(mask_u8: np.ndarray, img_bgr: np.ndarray) -> np.ndarray:
    """
    Hallazgo real 2026-09-09 (dos pruebas reales, dos fondos distintos --
    silla gris y, después, pared verde con un cuadro de flores y una puerta
    roja): `_person_mask_selfie_or_fallback` corre la confianza del
    segmentador sobre el CUADRO COMPLETO, sin ninguna restricción espacial
    al cuerpo real -- cualquier objeto de fondo con tono parecido a piel
    (ej. el cuadro naranja/blanco de flores, en la esquina superior
    izquierda, TOTALMENTE separado del cuerpo) puede superar el umbral de
    confianza (0.50) y quedar incluido como "persona", visible en el avatar
    final como una mancha flotante desconectada. Confirmado real corriendo
    el endpoint /cartoon_avatar real (no una reconstrucción aislada) con una
    foto de prueba real.

    Fix: la persona real SIEMPRE es la región conectada que toca la cara
    detectada -- cualquier otro componente conexo de la máscara binaria es,
    por definición, fondo mal clasificado, sin importar cuán "seguro" haya
    estado el segmentador ahí. Se detecta la cara (mismo detector ya usado
    en el resto del archivo) y se conserva SOLO el/los componentes conexos
    que tocan el óvalo facial -- nunca agranda la máscara, solo descarta
    islas desconectadas. Si no se detecta cara (caso raro), se devuelve la
    máscara sin tocar -- fail-safe, no se arriesga a borrar la persona real
    por un fallo de detección.
    """
    try:
        h, w = mask_u8.shape[:2]
        binm = (mask_u8 > 127).astype(np.uint8)
        if np.count_nonzero(binm) == 0:
            return mask_u8
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        with _mediapipe_lock:
            dr = detector.detect(mp_image)
        if not dr.face_landmarks or not FACE_OVAL_INDICES:
            return mask_u8
        pts = np.array(
            [[lm.x * w, lm.y * h] for lm in dr.face_landmarks[0]], dtype=np.float32
        )
        oval_pts = pts[FACE_OVAL_INDICES]
        num_labels, labels = cv2.connectedComponents(binm, connectivity=8)
        if num_labels <= 1:
            return mask_u8
        # Etiqueta más frecuente entre los puntos reales del óvalo facial
        # (no solo el centro): robusto a que el centro caiga justo en un
        # hueco (boca/ojos oscuros que a veces el umbral de confianza no
        # marca como "persona" con total seguridad).
        face_labels = []
        for x, y in oval_pts:
            xi = int(np.clip(round(x), 0, w - 1))
            yi = int(np.clip(round(y), 0, h - 1))
            lbl = int(labels[yi, xi])
            if lbl != 0:
                face_labels.append(lbl)
        if not face_labels:
            return mask_u8
        counts = np.bincount(face_labels)
        keep_label = int(np.argmax(counts))
        out = np.where(labels == keep_label, 255, 0).astype(np.uint8)
        return out
    except Exception:
        return mask_u8


def _person_mask_selfie_or_fallback(img_bgr: np.ndarray) -> np.ndarray:
    """Máscara 0–255 persona; tamaño = imagen. Nunca None (último recurso: todo opaco)."""
    h, w = img_bgr.shape[:2]
    seg = _get_selfie_segmenter()
    if seg is not None:
        try:
            rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            with _mediapipe_lock:
                res = seg.segment(mp_image)
            if res.confidence_masks:
                confidence = np.asarray(
                    res.confidence_masks[0].numpy_view(), dtype=np.float32
                ).squeeze()
                if confidence.shape[0] != h or confidence.shape[1] != w:
                    confidence = cv2.resize(
                        confidence, (w, h), interpolation=cv2.INTER_LINEAR
                    )
                confidence = np.nan_to_num(
                    confidence, nan=0.0, posinf=1.0, neginf=0.0
                )
                fg = (np.clip(confidence, 0.0, 1.0) >= 0.50).astype(np.uint8) * 255
                if np.count_nonzero(fg) > max(200, (h * w) // 80):
                    fg = _restrict_mask_to_face_component(fg, img_bgr)
                    return _refine_person_mask_u8(fg)
            if res.category_mask is not None:
                mv = np.asarray(res.category_mask.numpy_view(), dtype=np.uint8)
                if mv.shape[0] != h or mv.shape[1] != w:
                    mv = cv2.resize(mv, (w, h), interpolation=cv2.INTER_NEAREST)
                # Compatibilidad con modelos realmente categóricos: elegir la
                # polaridad que ocupa menos del 88 % del cuadro. En retratos de
                # registro la persona es el componente minoritario; esto evita
                # volver a aceptar una máscara de fondo invertida.
                positive = (mv > 0).astype(np.uint8) * 255
                negative = (mv == 0).astype(np.uint8) * 255
                fg = (
                    positive
                    if float(np.mean(positive > 0)) <= 0.88
                    else negative
                )
                if np.count_nonzero(fg) > max(200, (h * w) // 80):
                    fg = _restrict_mask_to_face_component(fg, img_bgr)
                    return _refine_person_mask_u8(fg)
        except Exception:
            pass
    gc = _person_mask_grabcut_fallback(img_bgr)
    if gc is not None:
        return gc
    return np.full((h, w), 255, dtype=np.uint8)


def _local_avatar_stylize(work_bgr: np.ndarray, alpha_f: np.ndarray) -> np.ndarray:
    """
    Fallback local legible cuando no hay un estilizador generativo autorizado.

    Mantiene textura y tonos de piel con contraste moderado. La versión anterior
    encadenaba CLAHE fuerte + detailEnhance + edgePreserving + cuantización dura;
    esa combinación amplificaba ruido/JPEG, ojeras y reflejos hasta producir el
    aspecto "quemado" observado en avatares reales de registro.
    """
    a = np.clip(alpha_f, 0.0, 1.0)
    inner = (a > 0.14).astype(np.float32)

    denoised = cv2.bilateralFilter(work_bgr, 7, 34, 34)
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.35, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l_ch)
    l2 = cv2.addWeighted(l_ch, 0.68, l_clahe, 0.32, 0)
    lab2 = cv2.merge([l2, a_ch, b_ch])
    enhanced = cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)

    inner3 = inner[..., None]
    mix = (
        enhanced.astype(np.float32) * inner3
        + work_bgr.astype(np.float32) * (1.0 - inner3)
    ).astype(np.uint8)

    try:
        smooth = cv2.edgePreservingFilter(
            mix, flags=1, sigma_s=38, sigma_r=0.20
        )
        mix = cv2.addWeighted(mix, 0.42, smooth, 0.58, 0)
    except Exception:
        mix = cv2.bilateralFilter(mix, 5, 36, 36)

    # Posterización parcial: aporta lectura de ilustración sin convertir
    # gradientes faciales en manchas ni destruir detalle de ojos y gafas.
    x = mix.astype(np.float32)
    levels = 32.0
    q = np.floor(x / 255.0 * levels) / levels * 255.0
    q = np.clip(q, 0, 255).astype(np.uint8)
    q = cv2.addWeighted(mix, 0.72, q, 0.28, 0)
    return cv2.bilateralFilter(q, 3, 20, 20)


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
    True si parece el JPEG enmascarado del cliente (óvalo sobre negro,
    `renderOvalMaskedFrameToCanvas` -- fillStyle '#000000' literal antes de
    recortar la elipse). Si es False, asumimos recorte rectangular (busto) y
    NO usamos máscara oval de malla. Solo cuatro esquinas (no todo el borde):
    evita confundir pelo oscuro arriba con lienzo negro.

    Umbrales corregidos 2026-09-03 (CA-15(a), ver ADR-141): con 30.0/34.0 dos
    de 12 retratos públicos con fondo oscuro real pero NO negro (mármol
    oscuro ~27, telón azul marino ~25) pasaban el chequeo -- ese falso
    positivo los enviaba por _bust_roi_mask_from_mediapipe (recorte de busto
    ajustado, pensado para el óvalo del cliente) en vez del recorte genérico
    que usan correctamente los otros 10 casos, y esa diferencia de encuadre
    era la causa real del colapso de difusión visto en esos dos casos (cabeza
    flotante/rasgos derretidos) -- no la seed, no el strength, no el ruido
    de Canny, que se probaron primero sin efecto. Un negro real de cámara
    tras compresión JPEG cae por debajo de 5 casi siempre; 15.0/18.0 deja
    margen amplio para eso y para variación de compresión, mientras excluye
    con holgura tanto los dos falsos positivos (24-27) como el caso bueno
    más oscuro real (Haaland, 66.2 -- más de 3x el nuevo umbral).
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
    if max(corner_means) > 18.0:
        return False
    cy, cx = h // 2, w // 2
    rh, rw = max(1, h // 5), max(1, w // 5)
    cen = gray[max(0, cy - rh) : min(h, cy + rh), max(0, cx - rw) : min(w, cx + rw)]
    if cen.size < 16:
        return False
    center_mean = float(np.mean(cen))
    return max(corner_means) < 15.0 and center_mean > 42.0


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
        with _mediapipe_lock:
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
        # cx: punto medio del bounding box del óvalo -> punto medio entre los
        # centros de ojos (hallazgo real, sesión 2026-09-08, confirmado con
        # DOS fotos reales de un mismo usuario, no una sola): con la cabeza
        # inclinada/girada (típico de una selfie de webcam casual, a
        # diferencia de los retratos de estudio frontales del set de
        # prueba), el contorno de mejilla/mandíbula del óvalo se foreshortea
        # de forma asimétrica y el punto medio de su bounding box deja de
        # coincidir con el centro real de la cara -- se repitió el mismo
        # sesgo hacia la derecha en dos fotos distintas de la misma sesión,
        # descartando que fuera una sola captura rara. LEFT_EYE/RIGHT_EYE ya
        # son grupos de landmarks validados en este archivo (EAR/parpadeo);
        # el punto medio entre sus centroides es mucho más estable ante
        # rotación de cabeza que un bounding box de todo el contorno facial.
        eye_cx = float(
            (np.mean(pts[LEFT_EYE], axis=0)[0] + np.mean(pts[RIGHT_EYE], axis=0)[0]) * 0.5
        )
        cx = eye_cx if 0.0 <= eye_cx <= float(w) else (x0 + x1) * 0.5
        chin_y = float(pts[152, 1])
        # 0.06 -> 0.22 (hallazgo real, sesión 2026-09-08, incidente
        # ALPAYANA/09637600): pts[10] es la línea de nacimiento del pelo, no
        # una estimación de volumen de pelo -- 6% del alto de cara quedaba
        # por debajo de cualquier peinado real, así que el pelo se perdía acá,
        # ANTES de estilizar/componer. 0.22 deja margen real para volumen de
        # pelo típico sin agrandar el ROI de forma desproporcionada.
        top_y = float(min(float(pts[10, 1]), float(y0))) - 0.22 * fh
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
        # Hallazgo real, sesión 2026-09-08 (incidente ALPAYANA/09637600): la
        # máscara era el hull convexo del óvalo facial nada más, acotado
        # arriba por la línea de nacimiento del pelo -- incluso el pelo que
        # sobrevivía al recorte ampliado arriba (0.22*fh, ver top_y) quedaba
        # con alfa ~0 y se fundía a blanco en _compose_avatar_canvas. Mismo
        # patrón de dilatación morfológica ya probado abajo para cuello/
        # hombros, aplicado ahora a la mitad SUPERIOR: agrega alfa gradual
        # sobre la región de pelo en vez de dejarla en 0, sin necesitar un
        # modelo de segmentación de pelo nuevo.
        k_hair = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (max(19, rw // 5), max(40, rh // 5))
        )
        upper = mask[:mid, :].copy()
        upper = cv2.dilate(upper, k_hair, iterations=1)
        mask[:mid, :] = np.maximum(mask[:mid, :], upper)
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
    # Hallazgo real, sesión 2026-09-09 (usuario 09637600/ALPAYANA, dos
    # registros nuevos reproducidos igual): el 92% de relleno de arriba
    # asume que el ROI YA trae un margen razonable alrededor del rostro,
    # pero si la captura del cliente vino con la cara ocupando casi todo
    # el cuadro (usuario muy cerca de la cámara, frameToBustRectAroundOvalJpegBase64
    # se satura contra los bordes del frame y no puede agregar margen que
    # nunca se capturó), este relleno del 92% AGRANDA el problema en vez de
    # absorberlo -- el rostro terminaba midiendo 0.53-0.66 del lienzo final,
    # por encima de AVATAR_QUALITY_MAX_FACE_FRACTION (0.55), y las 4 salidas
    # (3 seeds de difusión + clásico) se rechazaban siempre, sin avatar
    # posible aunque el ROI en sí fuera utilizable.
    #
    # Corrección: medir el rostro real en `out` (mismo detector ya usado en
    # _avatar_face_landmarks/_avatar_output_quality_reason) y limitar el
    # scale para que el rostro no supere AVATAR_COMPOSE_TARGET_FACE_FRACTION
    # del lienzo. Es un min() con el scale de arriba -- SOLO puede reducir
    # la composición, nunca agrandarla: para un ROI con margen normal (rostro
    # ya chico frente al lienzo) el scale objetivo sale mayor que el de
    # relleno del 92% y no cambia nada (verificado contra el set CA-15(a) +
    # el caso real, ver docs/decisions/141). Objetivo 0.42 elegido con margen
    # bajo el máximo real observado entre los 12 casos válidos de CA-15(a)
    # (0.458, Obama) y bien debajo del umbral de rechazo (0.55).
    target_face_frac = _env_float_avatar("AVATAR_COMPOSE_TARGET_FACE_FRACTION", 0.42)
    try:
        face_points = _avatar_face_landmarks(out)
    except Exception:
        face_points = None
    if face_points is not None and len(FACE_OVAL_INDICES) >= 10:
        face_oval = face_points[FACE_OVAL_INDICES]
        face_h_px = float(face_oval[:, 1].max() - face_oval[:, 1].min())
        face_w_px = float(face_oval[:, 0].max() - face_oval[:, 0].min())
        if face_h_px > 1.0:
            scale = min(scale, (target_face_frac * canvas_h) / face_h_px)
        if face_w_px > 1.0:
            scale = min(scale, (target_face_frac * canvas_w) / face_w_px)
    nw = max(64, int(round(tw * scale)))
    nh = max(64, int(round(th * scale)))
    interpolation = cv2.INTER_LANCZOS4 if scale > 1.0 else cv2.INTER_AREA
    up = cv2.resize(out, (nw, nh), interpolation=interpolation)
    alpha_big = cv2.resize(alpha_sm, (nw, nh), interpolation=cv2.INTER_LINEAR)
    alpha_big = cv2.GaussianBlur(alpha_big, (3, 3), 0)
    mup_f = alpha_big[..., None]

    canvas = np.ones((canvas_h, canvas_w, 3), dtype=np.uint8) * 255
    # Hallazgo real, sesión 2026-09-08 (incidente ALPAYANA/09637600): el
    # anclaje anterior usaba target_cy - centroide(TODO el alfa), pero el
    # centroide queda sesgado hacia abajo por la masa ancha de hombros --
    # con un target_cy alto (~0.40 del canvas) el resultado daba negativo
    # casi siempre y el clamp a 0 pegaba la imagen contra el borde superior
    # sin margen (exactamente "pelo cortado, hueco blanco abajo").
    #
    # El centrado horizontal por centroide de TODO el alfa (>0.2) tiene el
    # mismo problema en el eje X cuando la ropa/hombros son asimétricos
    # (verificado con evidencia real, foto propia de un usuario en esta
    # sesión: torso con pliegues/cuello ancho de un lado corría el centroide
    # y el rostro salía visiblemente descentrado aunque el óvalo en sí
    # estuviera bien formado). Un umbral de alfa más alto NO alcanza para
    # aislarlo -- la máscara ya se re-binariza a 0/255 antes de llegar acá
    # (ver cv2.threshold en _bust_roi_mask_from_mediapipe), así que >0.2 y
    # >0.6 seleccionan casi los mismos píxeles (probado, sin efecto real).
    # Lo que sí aísla la cara de los hombros es la POSICIÓN vertical: la
    # mitad superior del sujeto (cara + cuello) es angosta y simétrica
    # respecto de la cara; la mitad inferior (hombros/torso) es donde entra
    # la asimetría de ropa/pose. Centrar en X usando solo la franja superior
    # evita esa masa sin necesitar una máscara aparte.
    if np.any(alpha_big > 0.08):
        ys, xs = np.where(alpha_big > 0.2)
        top_of_subject_y = float(np.min(ys))
        bottom_of_subject_y = float(np.max(ys))
        subject_h = bottom_of_subject_y - top_of_subject_y
        upper_band = ys <= (top_of_subject_y + 0.45 * max(subject_h, 1.0))
        xs_upper = xs[upper_band]
        pcx = float(np.mean(xs_upper)) if xs_upper.size > 0 else float(np.mean(xs))
    else:
        pcx, top_of_subject_y, bottom_of_subject_y = nw * 0.5, 0.0, float(nh)
    target_cx = canvas_w * 0.5
    # Actualización 2026-09-09 (continuación): el anclaje por borde superior
    # con margen fijo (5%) evitaba el bug del centroide (ver más abajo) pero
    # no "centra" nada -- el sujeto casi nunca llena el lienzo hasta abajo,
    # así que queda un hueco blanco grande debajo (confirmado en vivo con el
    # avatar real de LARMAS12: pelo casi tocando el borde superior, mitad
    # inferior del lienzo 3840px vacía). El usuario pidió centrado vertical
    # real. Se usa el PUNTO MEDIO del bounding box real del sujeto (no el
    # centroide ponderado por masa de píxeles, que es justo lo que causaba
    # el bug original de sesgo hacia los hombros) -- centrar el punto medio
    # entre el borde superior e inferior detectados sí es simétrico por
    # construcción, sin ese sesgo.
    subject_cy = (top_of_subject_y + bottom_of_subject_y) * 0.5
    target_cy = canvas_h * 0.5
    ox = int(round(target_cx - pcx))
    oy = int(round(target_cy - subject_cy))
    ox = max(0, min(ox, canvas_w - nw))
    oy = max(0, min(oy, canvas_h - nh))

    reg = canvas[oy : oy + nh, ox : ox + nw]
    reg[:] = (
        reg.astype(np.float32) * (1.0 - mup_f) + up.astype(np.float32) * mup_f
    ).astype(np.uint8)
    return canvas


def _avatar_identity_similarity(source_bgr: np.ndarray, out_bgr: np.ndarray) -> Optional[float]:
    """
    Similitud coseno (embedding InsightFace, mismo motor que login/registro
    de alta seguridad) entre la foto fuente y el avatar generado. None si
    InsightFace no está listo o no detecta rostro en alguna de las dos --
    el llamador debe tratar None como "sin señal", no como fallo.

    Calibración (12 retratos públicos, CA-15(a), 2026-09-03): los 10 casos
    visualmente correctos dieron 0.328-0.508; el único colapso severo de
    identidad (deriva de género/rasgos, "Yellen") dio 0.199, claramente
    afuera. El otro colapso conocido ("Fudge", derretido pero con la
    identidad/tono/género reconocibles) dio 0.399 -- adentro del rango
    bueno, esta señal NO lo detecta. Con sólo 2 casos de fallo conocidos el
    umbral no está estadísticamente calibrado; es una cota de seguridad
    conservadora, no una garantía.
    """
    try:
        from face_embedding_insight import extract_normed_embedding_bgr

        emb_src, err_src = extract_normed_embedding_bgr(source_bgr)
        if emb_src is None:
            return None
        emb_out, err_out = extract_normed_embedding_bgr(out_bgr)
        if emb_out is None:
            return None
        return float(np.dot(emb_src, emb_out))
    except Exception:
        return None


def _avatar_output_quality_ok(
    out_bgr: np.ndarray, source_bgr: Optional[np.ndarray] = None
) -> bool:
    """
    Filtro post-difusión: descarta salidas colapsadas antes de componerlas
    como avatar final. CA-15(a) (prueba visual 2026-09-03, ver ADR-141)
    encontró varios modos de colapso reales con la seed fija de difusión --
    cabeza flotante/rasgos derretidos, bloque negro sólido, y deriva severa
    de identidad -- ninguno explicado de forma estable por strength,
    controlnet_conditioning_scale o el recorte de bordes Canny; sólo la
    seed cambia cuál foto colapsa.

    Tres señales combinadas, cada una cubre lo que las otras no ven (todas
    verificadas contra casos reales, no solo en teoría):
    1. Geometría facial (FaceLandmarker, mismo motor de captura): atrapa
       colapso estructural (sin rostro detectable, bloque negro). NO
       atrapa "rasgos derretidos pero con geometría simétrica" -- se
       comprobó con los 12 casos que los derretidos no son geométricamente
       distinguibles de los correctos -- ni "medio rostro sobre fondo
       blanco" (ver señal 2), porque el modelo de malla 3D infiere el lado
       oculto y sigue devolviendo geometría "plausible".
    2. Fondo blanco dentro del óvalo estimado: atrapa oclusión/recorte real
       (incidente ALPAYANA/09637600, 2026-09-03) que la geometría no puede
       ver -- si buena parte del óvalo que FaceLandmarker dice que es cara
       cae en realidad sobre el fondo blanco compuesto, es que la captura
       original no tenía ahí una cara real. 12/12 casos válidos de CA-15(a)
       dieron 0.0-0.26% de blanco dentro del óvalo; reproducciones reales
       del incidente dieron 18-48%.
    3. Similitud de identidad (InsightFace, mismo motor de login/registro,
       ver _avatar_identity_similarity): atrapa deriva severa de identidad
       (cambio de género/rasgos). NO atrapa melting moderado que preserva
       identidad reconocible (ver docstring de _avatar_identity_similarity).
    Ninguna otra señal barata probada (simetría de color de cejas, nitidez
    local Laplaciana en ojos/boca) discriminó el melting moderado en las
    pruebas reales -- queda como limitación conocida, no oculta.
    """
    return _avatar_output_quality_reason(out_bgr, source_bgr) is None


def _avatar_output_quality_reason(
    out_bgr: np.ndarray,
    source_bgr: Optional[np.ndarray] = None,
    max_face_frac_override: Optional[float] = None,
) -> Optional[str]:
    """
    Misma lógica que _avatar_output_quality_ok, pero devuelve la razón
    específica del rechazo (o None si pasa) en vez de solo True/False --
    agregado 2026-09-04 para diagnosticar en vivo por qué un usuario
    concreto falla los tres niveles de fallback (bust/portrait/raw), algo
    que "rejected stage=raw" solo no permitía distinguir.

    max_face_frac_override: reemplaza AVATAR_QUALITY_MAX_FACE_FRACTION solo
    para esta llamada. Necesario porque esta función se usa en DOS dominios
    geométricos distintos y el umbral 0.55 solo es válido en uno (ver el
    comentario de max_face_frac más abajo y la sección "Etapa raw vs.
    compuesto" del ADR-141).
    """
    try:
        h, w = out_bgr.shape[:2]
        if h < 32 or w < 32:
            return "too_small"
        points = _avatar_face_landmarks(out_bgr)
        if points is None:
            return "no_landmarks"
        if len(FACE_OVAL_INDICES) >= 10:
            oval = points[FACE_OVAL_INDICES]
            face_w = float(oval[:, 0].max() - oval[:, 0].min())
            face_h = float(oval[:, 1].max() - oval[:, 1].min())
            if face_w < 8 or face_h < 8:
                return "face_oval_degenerate"
            coverage = (face_w * face_h) / float(w * h)
            if coverage < 0.03:
                return f"coverage_too_small({coverage:.3f})"
            # Zoom excesivo: ROI de origen mal calculada (recorte demasiado
            # ajustado, p.ej. _bust_roi_mask_from_mediapipe con landmarks
            # atípicos) hace que _compose_avatar_canvas escale ese recorte
            # -ya de por sí un fragmento de piel/nariz- para llenar el 92%
            # del lienzo, mostrando un primer plano extremo en vez de la
            # cara completa. Incidente real 2026-09-03 (usuario "jsajs"):
            # geometría y blanco-en-óvalo pasaban (MediaPipe infiere un
            # óvalo "plausible" igual, sin fondo blanco de por medio) pero
            # face_h/img_h daba 0.745 -- muy por encima del máximo real
            # entre los 12 casos válidos de CA-15(a) (0.458, Obama).
            #
            # Corrección 2026-09-04 (incidente real, cuenta "HHJ HJHJ"): este
            # umbral se calibró sobre LIENZOS COMPUESTOS (máximo real 0.458
            # entre los 12 casos válidos de CA-15(a)), donde el rostro ya
            # está reducido al 92% del lienzo y centrado. Pero la etapa "raw"
            # del reintento de difusión lo aplicaba sobre el RECORTE DE BUSTO
            # apretado que sale de _bust_roi_mask_from_mediapipe, donde el
            # rostro ocupa por construcción 0.7-0.85 del alto -- 0.55 es ahí
            # estructuralmente inalcanzable. Efecto observado en producción:
            # las 3 seeds de difusión salían bien (`stylize ok`, sin NSFW tras
            # ADR-155) y las 3 se rechazaban con face_too_large(h=0.81..0.83),
            # cayendo al estilizador clásico -- el usuario recibía su foto
            # cruda sin estilizar, peor que la salida rechazada. El llamador
            # de la etapa raw pasa ahora su propio umbral
            # (AVATAR_QUALITY_MAX_FACE_FRACTION_RAW); el control del compuesto
            # final, que es el que realmente protege lo que se persiste, no
            # cambia.
            max_face_frac = (
                float(max_face_frac_override)
                if max_face_frac_override is not None
                else _env_float_avatar("AVATAR_QUALITY_MAX_FACE_FRACTION", 0.55)
            )
            face_h_frac = face_h / float(h)
            face_w_frac = face_w / float(w)
            if face_h_frac > max_face_frac or face_w_frac > max_face_frac:
                return f"face_too_large(h={face_h_frac:.2f},w={face_w_frac:.2f})"
            white_fraction = _avatar_oval_white_fraction(out_bgr, oval)
            max_white = _env_float_avatar("AVATAR_QUALITY_MAX_WHITE_IN_OVAL", 0.08)
            if white_fraction is None or white_fraction > max_white:
                return f"white_in_oval({white_fraction})"
            le = np.mean(points[LEFT_EYE], axis=0)
            re = np.mean(points[RIGHT_EYE], axis=0)
            interocular = float(np.linalg.norm(re - le))
            # Interocular normal ~0.30-0.45 del ancho de rostro en un
            # retrato frontal; banda amplia a propósito (tolera
            # estilización) pero descarta geometría degenerada (ojos
            # superpuestos/invertidos).
            ratio = interocular / face_w
            if ratio < 0.18 or ratio > 0.68:
                return f"interocular_ratio({ratio:.2f})"
            eye_y_delta = abs(le[1] - re[1])
            if eye_y_delta > 0.35 * max(interocular, 1.0):
                return f"eye_y_delta({eye_y_delta:.1f}px)"
        if source_bgr is not None:
            min_sim = _env_float_avatar("AVATAR_QUALITY_MIN_IDENTITY_SIM", 0.25)
            sim = _avatar_identity_similarity(source_bgr, out_bgr)
            if sim is not None and sim < min_sim:
                return f"identity_sim({sim:.3f})"
        return None
    except Exception as exc:
        return f"exception({exc})"


def _avatar_face_landmarks(out_bgr: np.ndarray) -> Optional[np.ndarray]:
    """Malla FaceLandmarker (478×2 px) del avatar, o None si no detecta rostro."""
    h, w = out_bgr.shape[:2]
    rgb = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    with _mediapipe_lock:
        dr = detector.detect(mp_image)
    if not dr.face_landmarks:
        return None
    return np.array(
        [[lm.x * w, lm.y * h] for lm in dr.face_landmarks[0]], dtype=np.float32
    )


def _avatar_oval_white_fraction(
    out_bgr: np.ndarray, oval_points: np.ndarray
) -> Optional[float]:
    """
    Fracción de píxeles casi blancos (>245 en los 3 canales) dentro del
    óvalo facial que devuelve FaceLandmarker. Oclusión real (no
    geométrica): FaceLandmarker usa un modelo de malla 3D que infiere el
    lado no visible de una cara -- puede devolver 478 puntos "plausibles"
    incluso cuando la mitad del óvalo cae sobre el fondo blanco compuesto,
    porque su propio prior de simetría facial completa lo que no ve.
    Ningún chequeo de geometría (ratio interocular, delta de ojos) detecta
    esto: se midió con el incidente real ALPAYANA/09637600 reproducido
    (recorte lateral simulado) que la geometría estimada seguía "normal"
    (ratio 0.45) con la mitad del óvalo en blanco puro. Medir directamente
    el fondo dentro del óvalo sí separa con margen amplio: 12/12 casos
    válidos de CA-15(a) dieron 0.0-0.26% de blanco dentro del óvalo; las
    reproducciones del incidente real dieron 18-48%.
    """
    hull = cv2.convexHull(oval_points.astype(np.int32))
    h, w = out_bgr.shape[:2]
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillConvexPoly(mask, hull, 255)
    return _white_fraction_in_mask(out_bgr, mask)


def _avatar_bbox_white_fraction(
    out_bgr: np.ndarray, bbox_xyxy: np.ndarray
) -> Optional[float]:
    """Como _avatar_oval_white_fraction pero sobre un bbox rectangular
    (InsightFace no da malla, solo bbox) -- ver _avatar_composed_quality_ok."""
    h, w = out_bgr.shape[:2]
    x0 = max(0, int(round(float(bbox_xyxy[0]))))
    y0 = max(0, int(round(float(bbox_xyxy[1]))))
    x1 = min(w, int(round(float(bbox_xyxy[2]))))
    y1 = min(h, int(round(float(bbox_xyxy[3]))))
    if x1 <= x0 or y1 <= y0:
        return None
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[y0:y1, x0:x1] = 255
    return _white_fraction_in_mask(out_bgr, mask)


def _white_fraction_in_mask(out_bgr: np.ndarray, mask: np.ndarray) -> Optional[float]:
    region = out_bgr[mask > 0]
    if region.size == 0:
        return None
    return float(np.mean(np.all(region > 245, axis=1)))


def _avatar_composed_quality_ok(out_bgr: np.ndarray) -> bool:
    """Valida el avatar DESPUÉS de aplicar máscara y encajarlo en el canvas.

    El control sobre la salida cruda de difusión no basta: una seed puede
    generar un rostro plausible desplazado respecto de la máscara original.
    Al componerlo, la máscara puede cortar medio rostro aunque el candidato
    previo tuviera landmarks válidos. Incidente real ALPAYANA/09637600,
    2026-09-03: la salida cruda de la segunda seed pasó, pero el PNG final
    quedó con un solo ojo y ningún detector facial pudo reconocerlo.

    MediaPipe cubre geometría frontal; InsightFace se usa como segunda señal
    para no rechazar retratos válidos más pequeños/de cuerpo medio que
    MediaPipe puede omitir. Si ninguno encuentra un rostro, se rechaza.

    El veto de blanco-dentro-del-óvalo (_avatar_oval_white_fraction) es
    obligatorio y NO puede sortearse por el fallback de InsightFace: se
    encontró en vivo (2026-09-03, reproduciendo el incidente ALPAYANA con
    un recorte lateral simulado) que InsightFace SÍ reconoce un rostro con
    solo un ojo/media cara visible -- el fallback "¿hay algo reconocible?"
    aceptaba exactamente el caso que este chequeo existe para atrapar.
    """
    return _avatar_composed_quality_reason(out_bgr) is None


def _avatar_composed_quality_reason(out_bgr: np.ndarray) -> Optional[str]:
    """Como _avatar_composed_quality_ok pero devuelve la razón del rechazo
    (o None si pasa) -- ver _avatar_output_quality_reason, mismo motivo."""
    if len(FACE_OVAL_INDICES) >= 10:
        points = _avatar_face_landmarks(out_bgr)
        if points is not None:
            h, w = out_bgr.shape[:2]
            oval = points[FACE_OVAL_INDICES]
            white_fraction = _avatar_oval_white_fraction(out_bgr, oval)
            max_white = _env_float_avatar("AVATAR_QUALITY_MAX_WHITE_IN_OVAL", 0.08)
            if white_fraction is None or white_fraction > max_white:
                return f"composed_white_in_oval({white_fraction})"
            # Mismo veto de zoom excesivo que _avatar_output_quality_reason,
            # repetido acá porque el fallback de InsightFace de abajo no lo
            # aplicaría por su cuenta (ve nariz/boca reales, sin fondo
            # blanco de por medio, y las da por válidas igual).
            face_h = float(oval[:, 1].max() - oval[:, 1].min())
            face_w = float(oval[:, 0].max() - oval[:, 0].min())
            max_face_frac = _env_float_avatar("AVATAR_QUALITY_MAX_FACE_FRACTION", 0.55)
            face_h_frac = face_h / float(h)
            face_w_frac = face_w / float(w)
            if face_h_frac > max_face_frac or face_w_frac > max_face_frac:
                return f"composed_face_too_large(h={face_h_frac:.2f},w={face_w_frac:.2f})"
            # Señal nueva (hallazgo real, sesión 2026-09-08, incidente
            # ALPAYANA/09637600): el guard anterior no medía nada por encima
            # del óvalo ni el margen inferior, así que un recorte de pelo +
            # anclaje pegado al borde superior pasaba limpio (el óvalo en sí
            # quedaba bien pintado). Barata y verificada contra el mismo tipo
            # de caso real que motivó el resto de este guard: si el óvalo
            # queda a menos de ~2% del borde superior del canvas, es la
            # misma firma del bug de centrado ya corregido en
            # _compose_avatar_canvas -- lo atrapa si vuelve a aparecer.
            oval_top_frac = float(oval[:, 1].min()) / float(h)
            min_top_margin = _env_float_avatar("AVATAR_QUALITY_MIN_TOP_MARGIN", 0.02)
            if oval_top_frac < min_top_margin:
                return f"composed_top_margin_too_small({oval_top_frac:.3f})"
    raw_reason = _avatar_output_quality_reason(out_bgr)
    if raw_reason is None:
        return None
    try:
        from face_embedding_insight import extract_face_bbox_bgr

        bbox, _error = extract_face_bbox_bgr(out_bgr)
        if bbox is None:
            return f"composed_fallback_no_insightface_bbox(raw={raw_reason})"
        max_white = _env_float_avatar("AVATAR_QUALITY_MAX_WHITE_IN_OVAL", 0.08)
        white_fraction = _avatar_bbox_white_fraction(out_bgr, bbox)
        if white_fraction is not None and white_fraction <= max_white:
            return None
        return f"composed_fallback_white_in_bbox({white_fraction},raw={raw_reason})"
    except Exception as exc:
        return f"composed_fallback_exception({exc},raw={raw_reason})"


def _env_float_avatar(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except Exception:
        return default


def _boost_diffusion_color(out_bgr: np.ndarray) -> np.ndarray:
    """
    Realce de color/vivacidad solo para la salida del motor de difusión
    (SD1.5+ControlNet, avatar_engine): a diferencia de _local_avatar_stylize
    (clásico), que ya aplica CLAHE al canal L, la salida generativa no
    recibía ningún ajuste de color posterior -- pedido explícito del usuario
    2026-09-04 ("mejor color, más animado"), tras confirmar que no existía
    ningún post-proceso de color en esta ruta. Saturación moderada en HSV
    (no toca tono/hue) + CLAHE suave en L (LAB) para dar más "pop" sin
    saturar blancos ni desnaturalizar el tono de piel. Env-gated con un
    kill-switch (AVATAR_DIFFUSION_COLOR_BOOST=0) para poder revertir sin
    rebuild si algún caso real se ve sobresaturado.
    """
    sat_gain = _env_float_avatar("AVATAR_DIFFUSION_SATURATION_GAIN", 1.18)
    hsv = cv2.cvtColor(out_bgr, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 1] = np.clip(hsv[..., 1] * sat_gain, 0, 255)
    boosted = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    lab = cv2.cvtColor(boosted, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=1.6, tileGridSize=(8, 8))
    l_clahe = clahe.apply(l_ch)
    l2 = cv2.addWeighted(l_ch, 0.7, l_clahe, 0.3, 0)
    lab2 = cv2.merge([l2, a_ch, b_ch])
    return cv2.cvtColor(lab2, cv2.COLOR_LAB2BGR)


_avatar_debug_call_counter = 0
_avatar_debug_call_lock = threading.Lock()


def _avatar_debug_save(tag: str, img: Optional[np.ndarray]) -> None:
    """
    Guarda una imagen intermedia del pipeline de avatar a disco, solo si
    AVATAR_DEBUG_DIR está seteado -- diagnóstico agregado 2026-09-04 para
    reproducir en vivo por qué una captura concreta falla los tres niveles
    de fallback (bust/portrait/raw) sin tener que adivinar a partir de los
    logs de texto. No hace nada (ni una llamada a os.makedirs) si la
    variable no está seteada, para no tocar el comportamiento normal.
    """
    debug_dir = os.environ.get("AVATAR_DEBUG_DIR", "").strip()
    if not debug_dir or img is None:
        return
    try:
        global _avatar_debug_call_counter
        with _avatar_debug_call_lock:
            _avatar_debug_call_counter += 1
            seq = _avatar_debug_call_counter
        os.makedirs(debug_dir, exist_ok=True)
        ts = int(time.time() * 1000)
        path = os.path.join(debug_dir, f"{ts}_{seq:04d}_{tag}.png")
        cv2.imwrite(path, img)
    except Exception:
        pass


def _avatar_diffusion_retry_seeds() -> list:
    """
    None = seed default del servidor (AVATAR_DIFFUSION_SEED, hoy 7); el
    resto son seeds alternativas fijas para el reintento determinístico.
    Configurable por env sólo para pruebas -- en producción no hace falta
    tocarlo.
    """
    seeds: list = [None]
    raw = os.environ.get("AVATAR_DIFFUSION_RETRY_SEEDS", "").strip()
    if raw:
        for tok in raw.split(","):
            tok = tok.strip()
            if tok:
                try:
                    seeds.append(int(tok))
                except ValueError:
                    pass
    else:
        seeds.extend([1013, 4021])
    return seeds


def _diffusion_reframe_pad(
    work_wb: np.ndarray,
) -> Tuple[np.ndarray, int, int]:
    """
    Rellena `work_wb` con blanco hasta que el rostro ocupe ~
    AVATAR_DIFFUSION_TARGET_FACE_FRACTION del alto, centrado en X y con
    espacio libre arriba (headroom de retrato). Devuelve (lienzo, x0, y0)
    donde (x0, y0) es la posición del `work_wb` original dentro del lienzo,
    para poder recortar exactamente la misma región de la salida.

    Por qué SOLO padding y nunca reescalado (2026-09-04, ADR-141): la
    máscara alfa, los bordes y todo el compuesto posterior viven en la
    grilla de píxeles de `work_wb`. Rellenar y volver a recortar la misma
    región es reversible píxel a píxel; reescalar no lo sería, y obligaría
    a rehacer segmentación y matte.

    Motivo real: en el incidente "HHJ HJHJ" el recorte de busto entregaba a
    SD1.5 un primer plano donde el rostro llenaba 0.81 del alto, con la
    coronilla cortada. ControlNet-Canny replica esa composición -- no puede
    inventar el encuadre de un retrato corporativo a partir de un encuadre
    que no lo es. Dándole el mismo rostro sobre un lienzo con aire alrededor,
    la difusión recibe la composición de retrato que su prompt describe
    ("corporate id photo composition, centered headshot").
    """
    h, w = work_wb.shape[:2]
    target_frac = _env_float_avatar("AVATAR_DIFFUSION_TARGET_FACE_FRACTION", 0.45)
    max_growth = _env_float_avatar("AVATAR_DIFFUSION_MAX_REFRAME_GROWTH", 2.2)
    if target_frac <= 0.05 or target_frac >= 0.95:
        return work_wb, 0, 0
    try:
        points = _avatar_face_landmarks(work_wb)
    except Exception:
        points = None
    if points is None or len(FACE_OVAL_INDICES) < 10:
        return work_wb, 0, 0
    oval = points[FACE_OVAL_INDICES]
    face_h = float(oval[:, 1].max() - oval[:, 1].min())
    if face_h < 8.0:
        return work_wb, 0, 0
    face_cx = float((oval[:, 0].min() + oval[:, 0].max()) * 0.5)
    face_cy = float((oval[:, 1].min() + oval[:, 1].max()) * 0.5)

    canvas_h = int(round(min(face_h / target_frac, h * max_growth)))
    if canvas_h <= h + 8:
        return work_wb, 0, 0
    canvas_w = int(round(min(canvas_h * (float(w) / float(h)), w * max_growth)))
    canvas_w = max(canvas_w, w)

    # El centro del rostro queda al 42% del alto: deja headroom arriba y
    # sitio para cuello/hombros abajo, igual que target_cy en
    # _compose_avatar_canvas.
    y0 = int(round(canvas_h * 0.42 - face_cy))
    x0 = int(round(canvas_w * 0.5 - face_cx))
    y0 = max(0, min(y0, canvas_h - h))
    x0 = max(0, min(x0, canvas_w - w))

    canvas = np.ones((canvas_h, canvas_w, 3), dtype=np.uint8) * 255
    canvas[y0 : y0 + h, x0 : x0 + w] = work_wb
    return canvas, x0, y0


def _diffusion_stylize_with_quality_retry(
    work_wb: np.ndarray,
    a: np.ndarray,
    alpha_sm: np.ndarray,
    matte_oval: bool,
) -> Optional[np.ndarray]:
    """
    Prueba las seeds de difusión (hasta 3, ver _avatar_diffusion_retry_seeds)
    y devuelve la de MAYOR similitud de identidad entre las que pasan los dos
    controles de calidad (raw + compuesto) -- no la primera que pasa.

    Mejora 2026-09-04 (pedido explícito del usuario): antes de este cambio,
    la primera seed que pasaba ganaba automáticamente aunque una seed
    posterior tuviera mejor parecido real con la foto fuente -- desperdiciaba
    la señal de `_avatar_identity_similarity` que ya se calculaba para cada
    intento, usándola sólo como filtro pasa/no-pasa (umbral
    AVATAR_QUALITY_MIN_IDENTITY_SIM) en vez de como criterio de selección.
    Como las 3 seeds ya se generan siempre que hace falta reintentar (mismo
    costo de GPU que antes), comparar entre las válidas es gratis.

    Si ningún candidato mide similitud (InsightFace no detectó rostro en
    alguna imagen), se conserva el primero que pasó -- no se descarta.

    Cada intento es una llamada HTTP nueva a avatar_engine sobre el mismo
    work_wb -- no repite segmentación/recorte. Corre en el hilo asíncrono
    posterior al registro (ADR-074), así que el costo extra no bloquea la
    respuesta de alta del usuario.
    """
    h_w, w_w = work_wb.shape[:2]
    framed, fx0, fy0 = _diffusion_reframe_pad(work_wb)
    if framed is not work_wb:
        _avatar_debug_save("00b_work_wb_reframed", framed)
    # El rostro ya no llena el recorte tras el reencuadre, pero la etapa raw
    # sigue midiéndose sobre un busto recortado: umbral propio, más laxo que
    # el del compuesto final (ver _avatar_output_quality_reason).
    raw_max_face_frac = _env_float_avatar(
        "AVATAR_QUALITY_MAX_FACE_FRACTION_RAW", 0.88
    )
    passing: list = []  # [(identity_sim_or_None, candidate)], en orden de intento
    for seed in _avatar_diffusion_retry_seeds():
        seed_label = seed if seed is not None else "default"
        styled = stylize_portrait_diffusion(framed, a, seed=seed)
        # Se recorta exactamente la región que ocupaba `work_wb` dentro del
        # lienzo reencuadrado: de aquí en adelante todo (alfa, bordes,
        # composición) vuelve a la grilla original, sin reescalados.
        candidate = (
            styled[fy0 : fy0 + h_w, fx0 : fx0 + w_w]
            if styled is not None
            else None
        )
        if candidate is not None:
            _avatar_debug_save(f"diffusion_seed{seed_label}", candidate)
        raw_reason = (
            _avatar_output_quality_reason(
                candidate,
                source_bgr=work_wb,
                max_face_frac_override=raw_max_face_frac,
            )
            if candidate is not None
            else "no_candidate"
        )
        if raw_reason is None:
            preview = _compose_avatar_canvas(
                candidate, alpha_sm, matte_oval, 768, 1024
            )
            _avatar_debug_save(f"diffusion_seed{seed_label}_composed", preview)
            composed_reason = _avatar_composed_quality_reason(preview)
            if composed_reason is None:
                sim = _avatar_identity_similarity(work_wb, candidate)
                print(
                    f"[AVATAR_QUALITY] passed seed={seed_label} identity_sim={sim}",
                    flush=True,
                )
                passing.append((sim, candidate))
                continue
            avatar_diffusion_record_quality_rejected()
            print(
                f"[AVATAR_QUALITY] rejected seed={seed_label} stage=composed "
                f"reason={composed_reason}",
                flush=True,
            )
        elif candidate is not None:
            avatar_diffusion_record_quality_rejected()
            print(
                f"[AVATAR_QUALITY] rejected seed={seed_label} stage=raw "
                f"reason={raw_reason}",
                flush=True,
            )
    if not passing:
        # Ninguna seed dio una salida con geometría facial plausible ni
        # identidad reconocible (o avatar_engine no respondió en ningún
        # intento): el llamador cae al estilo clásico determinista en vez de
        # componer un avatar colapsado.
        return None
    # Mayor identity_sim gana; None (sin señal, InsightFace no detectó rostro
    # en alguna imagen) se trata como el peor valor posible -- prefiere
    # cualquier candidato CON señal medida antes que uno sin medir, y entre
    # dos sin señal se queda con el primero (orden estable de sorted).
    best_sim, best_candidate = max(
        passing, key=lambda item: item[0] if item[0] is not None else -1.0
    )
    print(
        f"[AVATAR_QUALITY] best of {len(passing)} passing seed(s) "
        f"identity_sim={best_sim}",
        flush=True,
    )
    return best_candidate


def _cartoonify_face_bgr(
    img_bgr: np.ndarray, style_override: Optional[str] = None
) -> Optional[Tuple[str, str, str]]:
    """
    Un único avatar PNG por imagen, 100 % local: segmentación selfie / GrabCut,
    fondo blanco, y estilo con CLAHE + realce suave (por defecto, ver
    _local_avatar_stylize). k-means plano solo si AVATAR_USE_KMEANS=1 (puede
    borrar rasgos). Si AVATAR_STYLE_ENGINE=diffusion (ver ADR-141), se intenta
    primero un estilizador generativo real (SD1.5 img2img + ControlNet-Canny,
    avatar_diffusion.py) y se cae al estilo clásico si falla por cualquier
    motivo (pesos no descargados, sin GPU y demasiado lento, OOM, etc.).

    style_override (piloto QA, ADR-141/143, actualización 2026-09-11 de
    ADR-167): el backend C++ lo envía por request ("classic"/"diffusion")
    según si la cuenta que se registra está en AVATAR_DIFFUSION_QA_USERNAMES.
    "classic" fuerza el estilo clásico aunque AVATAR_STYLE_ENGINE=diffusion
    esté activo globalmente; cualquier otro valor (incl. None, para llamadores
    que no lo envían todavía) preserva el comportamiento previo, gateado solo
    por el flag global.
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
        _avatar_debug_save(f"00_work_wb_matte{matte_oval}", work_wb)

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
        generator_name = "local_mediapipe_opencv"
        if os.environ.get("AVATAR_USE_KMEANS", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            flat = _kmeans_flat_illustration(base, a, k_clusters=k_flat)
            out = cv2.bilateralFilter(flat, 3, 20, 20)
        else:
            out = None
            if style_override != "classic" and avatar_diffusion_enabled():
                out = _diffusion_stylize_with_quality_retry(
                    work_wb, a, alpha_sm, matte_oval
                )
                if out is not None:
                    generator_name = "local_sd15_controlnet"
                    if os.environ.get("AVATAR_DIFFUSION_COLOR_BOOST", "1").strip().lower() not in (
                        "0", "false", "no",
                    ):
                        out = _boost_diffusion_color(out)
                        _avatar_debug_save("diffusion_color_boosted", out)
            if out is None:
                out = _local_avatar_stylize(work_wb, a)
                _avatar_debug_save("classic_out", out)

        ink_strength = 0.045 if not matte_oval else 0.065
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

        # Control final sobre el compuesto REAL que se va a persistir, sin
        # importar qué motor lo generó. Incidente real ALPAYANA/09637600
        # (2026-09-03): el chequeo previo solo envolvía la ruta de difusión,
        # usando un preview interno separado del `thumb` final -- cuando las
        # 3 seeds de difusión fallaban (rechazadas en la etapa "raw", ver
        # _diffusion_stylize_with_quality_retry), el llamador caía a
        # _local_avatar_stylize(), que no tiene ningún control: si la captura
        # original ya tenía el rostro descentrado, el óvalo lo recorta igual
        # de mal (un ojo, media cara) y nada lo detectaba antes de guardarse
        # en `auth_users.avatar_cartoon_base64` y en el maestro HD. Mejor no
        # generar avatar (el llamador ya trata None como fallo silencioso,
        # ver ADR-074: la cabecera muestra el placeholder de iniciales) que
        # guardar uno mutilado.
        _avatar_debug_save("99_thumb_final_candidate", thumb)
        final_reason = _avatar_composed_quality_reason(thumb)
        if final_reason is not None:
            print(
                f"[AVATAR_QUALITY] rejected FINAL (generator={generator_name}) "
                f"stage=composed reason={final_reason}",
                flush=True,
            )
            return None

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
            generator_name,
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
    # Piloto QA de avatar por difusión (ADR-141/143, actualización 2026-09-11
    # de ADR-167): el backend C++ envía "style" ("classic"/"diffusion") según
    # AVATAR_DIFFUSION_QA_USERNAMES; cualquier otro valor se ignora (None,
    # mismo comportamiento previo gateado solo por el flag global).
    style_raw = (request.form.get("style") or "").strip().lower()
    style_override = style_raw if style_raw in ("classic", "diffusion") else None
    avatars = _cartoonify_face_bgr(img, style_override=style_override)
    if not avatars:
        return jsonify({"ok": False, "error": "cartoonify_failed"}), 200
    thumb_b64, hd_b64, generator_name = avatars
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
            "generator": generator_name,
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


@app.route("/seetaface_analyze", methods=["POST"])
def seetaface_analyze():
    """Registro/verificación 1:1 local con detección de vivacidad SeetaFace6."""
    if "image" not in request.files:
        return jsonify({"ok": False, "pass": False, "error": "no_image"}), 400
    raw = request.files["image"].read()
    if not raw:
        return jsonify({"ok": False, "pass": False, "error": "empty_image"}), 400
    mode = request.form.get("mode", "verify").strip().lower()
    payload = analyze_seetaface6(raw, mode)
    # Un rechazo biométrico válido (spoof/fuzzy/calidad) es HTTP 200. Los
    # errores de contrato del cliente sí son 400; indisponibilidad es 503.
    if payload.get("error") == "invalid_mode":
        return jsonify(payload), 400
    if payload.get("error") == "seetaface6_unavailable":
        return jsonify(payload), 503
    return jsonify(payload)


@app.route("/deepface_analyze", methods=["POST"])
def deepface_analyze():
    """Registro/verificación 1:1 local: liveness Silent-Face (MiniFASNet) +
    identidad DeepFace/Facenet512. Proveedor biométrico local por defecto."""
    if "image" not in request.files:
        return jsonify({"ok": False, "pass": False, "error": "no_image"}), 400
    raw = request.files["image"].read()
    if not raw:
        return jsonify({"ok": False, "pass": False, "error": "empty_image"}), 400
    mode = request.form.get("mode", "verify").strip().lower()
    payload = analyze_deepface_silentface(raw, mode)
    # Mismo criterio HTTP que /seetaface_analyze: un rechazo biométrico válido
    # (spoof/no-match/calidad) es 200; errores de contrato del cliente son
    # 400; indisponibilidad del motor es 503.
    if payload.get("error") == "invalid_mode":
        return jsonify(payload), 400
    if payload.get("error") in ("silentface_unavailable", "deepface_unavailable"):
        return jsonify(payload), 503
    return jsonify(payload)


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
            "seetaface6": seetaface6_status(),
            "deepface_silentface": deepface_silentface_status(),
            "cartoon_avatar": {
                "mode": "local",
                "external_apis": False,
            },
            "avatar_diffusion": {
                "enabled": avatar_diffusion_enabled(),
                "avatar_engine_url": os.environ.get(
                    "AVATAR_ENGINE_URL", "http://avatar_engine:5001"
                ),
                "stats": avatar_diffusion_stats(),
            },
            "mediapipe_models": {
                "face_landmarker_path": MODEL_PATH,
                "face_landmarker_ok": os.path.isfile(MODEL_PATH),
                "selfie_segmenter_path": SELFIE_SEGMENTER_PATH,
                "selfie_segmenter_ok": os.path.isfile(SELFIE_SEGMENTER_PATH),
            },
        }
    )


CV_EXTRACT_MAX_BYTES = 10 * 1024 * 1024  # 10MB -- espejo de BEEMETRY_WHATSAPP_CV_MAX_BYTES (backend)


def _extract_cv_text_from_pdf(file_bytes):
    import pdfplumber
    import io

    parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text:
                parts.append(text)
    return "\n".join(parts)


def _extract_cv_text_from_docx(file_bytes):
    import docx
    import io

    doc = docx.Document(io.BytesIO(file_bytes))
    parts = [p.text for p in doc.paragraphs if p.text]
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                if cell.text:
                    parts.append(cell.text)
    return "\n".join(parts)


def _extract_cv_text_from_pptx(file_bytes):
    """ADR-129: algunos postulantes envían un portafolio/CV en PowerPoint en
    vez de Word/PDF -- mismo criterio de "solo texto plano, sin interpretar"
    que las otras dos extracciones. Recorre shapes con texto y tablas de cada
    diapositiva, en orden."""
    import pptx
    import io

    prs = pptx.Presentation(io.BytesIO(file_bytes))
    parts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text:
                parts.append(shape.text_frame.text)
            elif shape.has_table:
                for row in shape.table.rows:
                    for cell in row.cells:
                        if cell.text:
                            parts.append(cell.text)
    return "\n".join(parts)


@app.route("/extract_cv_text", methods=["POST"])
def extract_cv_text():
    """Extrae texto plano de un CV (Word/PDF/PowerPoint) -- ADR-122/129. Solo
    extracción, sin interpretación de contenido: la lectura de campos/
    puntuación del candidato ocurre en el backend C++ (Ollama), nunca acá.
    `filename` (o el Content-Type del archivo) decide el parser -- .docx vía
    python-docx, .pdf vía pdfplumber, .pptx vía python-pptx."""
    if "file" not in request.files:
        return jsonify({"ok": False, "error": "no_file_provided"}), 400
    file = request.files["file"]
    file_bytes = file.read()
    if len(file_bytes) == 0:
        return jsonify({"ok": False, "error": "empty_file"}), 400
    if len(file_bytes) > CV_EXTRACT_MAX_BYTES:
        return jsonify({"ok": False, "error": "file_too_large"}), 400

    filename = (file.filename or "").lower()
    mimetype = (file.mimetype or "").lower()
    is_pdf = filename.endswith(".pdf") or "pdf" in mimetype
    is_docx = filename.endswith(".docx") or "wordprocessingml.document" in mimetype
    is_pptx = filename.endswith(".pptx") or "presentationml" in mimetype

    try:
        if is_pdf:
            text = _extract_cv_text_from_pdf(file_bytes)
        elif is_docx:
            text = _extract_cv_text_from_docx(file_bytes)
        elif is_pptx:
            text = _extract_cv_text_from_pptx(file_bytes)
        else:
            return jsonify({"ok": False, "error": "unsupported_format"}), 400
    except Exception as ex:  # noqa: BLE001 -- documento corrupto/formato inesperado, nunca 500 en silencio
        return jsonify({"ok": False, "error": "extraction_failed", "detail": str(ex)}), 200

    text = (text or "").strip()
    if not text:
        return jsonify({"ok": False, "error": "empty_document"}), 200
    return jsonify({"ok": True, "text": text, "char_count": len(text)})


IMAGE_ANALYZE_MAX_BYTES = 10 * 1024 * 1024  # 10MB -- mismo tope que CV_EXTRACT_MAX_BYTES


@app.route("/analyze_image", methods=["POST"])
def analyze_image():
    """ADR-129: lectura genérica de imagen adjuntada desde el widget de chat
    de soporte (SupportChatWidget.tsx) -- QR/código de barras (pyzbar) + OCR
    de texto visible (pytesseract), en español e inglés. A diferencia de
    dni_scan.py (formato fijo de DNI peruano), esto NO interpreta ni valida
    nada: devuelve texto crudo para que el backend C++ lo incruste como
    contexto en el prompt del chatbot (mismo patrón que los chips
    Resumir/Ampliar/Ideas de SupportChatWidget.tsx -- el modelo de chat es de
    solo texto, no multimodal, así que la "lectura" de la imagen ocurre acá,
    de forma determinística, no en el LLM). Nunca lanza: en el peor caso
    devuelve ambos campos vacíos."""
    if "image" not in request.files:
        return jsonify({"ok": False, "error": "no_image_provided"}), 400
    file = request.files["image"]
    img_bytes = file.read()
    if len(img_bytes) == 0:
        return jsonify({"ok": False, "error": "empty_image"}), 400
    if len(img_bytes) > IMAGE_ANALYZE_MAX_BYTES:
        return jsonify({"ok": False, "error": "file_too_large"}), 400

    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return jsonify({"ok": False, "error": "invalid_image"}), 400

    qr_codes = []
    try:
        from pyzbar.pyzbar import decode as _zbar_decode

        for code in _zbar_decode(img):
            try:
                qr_codes.append(code.data.decode("utf-8", errors="replace"))
            except Exception:  # noqa: BLE001
                continue
    except Exception:  # noqa: BLE001 -- libzbar no disponible en este entorno
        pass

    ocr_text = ""
    try:
        import pytesseract

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        ocr_text = pytesseract.image_to_string(gray, lang="spa+eng").strip()
    except Exception:  # noqa: BLE001 -- tesseract no disponible, o imagen sin texto legible
        ocr_text = ""

    return jsonify({
        "ok": True,
        "qr_codes": qr_codes,
        "ocr_text": ocr_text,
        "width": int(img.shape[1]),
        "height": int(img.shape[0]),
    })


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


@app.route("/generate_fotocheck", methods=["POST"])
def generate_fotocheck():
    """Compone la tarjeta del fotocheck (foto real + QR YA CIFRADO + campos)
    -- ver fotocheck_render.py. Este endpoint nunca ve el payload en claro
    del QR, solo el string cifrado que ya llega armado desde el backend C++
    (fotocheck_crypto.cpp); no descifra ni valida nada, solo dibuja."""
    try:
        payload = request.get_json(force=True, silent=False)
    except Exception:
        return jsonify({"ok": False, "error": "invalid_json"}), 400
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "invalid_json"}), 400

    photo_b64 = payload.get("photo_base64") or ""
    qr_payload = payload.get("qr_payload") or ""
    fields = payload.get("fields") or {}
    if not qr_payload:
        return jsonify({"ok": False, "error": "qr_payload_requerido"}), 400

    try:
        photo_bytes = base64.b64decode(photo_b64) if photo_b64 else b""
    except Exception:
        photo_bytes = b""

    try:
        png_bytes = generate_fotocheck_image(photo_bytes, qr_payload, fields)
    except Exception as ex:  # noqa: BLE001 -- nunca debe tumbar el proceso
        return jsonify({"ok": False, "error": f"render_failed: {ex}"}), 500

    return jsonify({
        "ok": True,
        "image_base64": base64.b64encode(png_bytes).decode("ascii"),
    })


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
    if os.environ.get("WARMUP_DEEPFACE", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    ):
        try:
            warmup_deepface_silentface()
        except Exception as ex:  # noqa: BLE001
            print(f"[DEEPFACE_SILENT] Warmup omitido: {ex}", flush=True)
    # Werkzeug (servidor de desarrollo de Flask, vía app.run()) manda
    # "Connection: close" de forma INCONDICIONAL en cada respuesta -- no es
    # un default configurable, es una decisión de diseño de los propios
    # mantenedores de Werkzeug (ver comentario en werkzeug/serving.py:
    # "Always close the connection. This disables HTTP/1.1 keep-alive
    # connections. They aren't handled well by Python's http.server because
    # it doesn't know how to drain the stream before the next request
    # line"). Confirmado en vivo con curl -v: "< Connection: close" pase lo
    # que pase con protocol_version. Sin conexiones persistentes, el pool de
    # conexiones del backend C++ (ai_engine_client.cpp, ver
    # ai_engine_conn_pool.hpp) queda inerte: cada verify-frame
    # (VERIFY_SYNC_MS=175ms, el endpoint más caliente del pipeline biométrico)
    # sigue pagando un handshake TCP nuevo aunque el backend intente reusar
    # la conexión anterior.
    #
    # waitress SÍ soporta keep-alive real y sigue siendo un solo proceso con
    # un pool de threads (semánticamente equivalente a threaded=True) -- NO
    # duplica la copia en memoria/VRAM de los modelos ya cargados (MediaPipe/
    # InsightFace/DeepFace/SilentFace), a diferencia de workers multi-proceso
    # (gunicorn -w N), que sí la duplicarían y agotarían la VRAM de la GPU
    # (ya usa ~5.2 GB de 8 GB en un solo proceso, ver logs de TensorFlow al
    # arranque). threads=8 == límite de cpus del contenedor (deploy.resources
    # en docker-compose.yml).
    from waitress import serve

    serve(app, host="0.0.0.0", port=5000, threads=8)
