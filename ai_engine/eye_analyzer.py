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

import os
import requests
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

MODEL_PATH = os.environ.get("FACE_LANDMARKER_MODEL", "face_landmarker.task")
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)

if not os.path.exists(MODEL_PATH):
    print(f"[*] Descargando modelo MediaPipe: {MODEL_PATH}...", flush=True)
    try:
        r = requests.get(MODEL_URL, timeout=120)
        r.raise_for_status()
        with open(MODEL_PATH, "wb") as f:
            f.write(r.content)
        print("[✓] Modelo descargado exitosamente.", flush=True)
    except Exception as e:
        print(f"[!] Error descargando modelo: {e}.", flush=True)

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

# Índices ojos (malla MediaPipe 478 puntos) — orden estándar EAR
LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

mouth_closed_prev = True
glasses_score_hist = deque(maxlen=9)
glasses_state_prev = False
last_glasses_debug = {}

left_ear_hist = deque(maxlen=EAR_SMOOTH_WIN)
right_ear_hist = deque(maxlen=EAR_SMOOTH_WIN)


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


def mar_inner_ratio(points):
    """Apertura vertical interna / ancho boca (robusto ante jawOpen basal)."""
    if points.shape[0] < 310:
        return 0.04
    p13, p14 = points[13], points[14]
    p78, p308 = points[78], points[308]
    ver = float(np.linalg.norm(p13 - p14))
    hor = float(np.linalg.norm(p78 - p308))
    return ver / (hor + 1e-6)


def update_mouth_closed(bs, mar_ratio):
    """
    Boca cerrada: blendshapes + MAR + histéresis (menos parpadeo boca abierta/cerrada).
    """
    global mouth_closed_prev
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

    if mouth_closed_prev:
        if open_ix > 0.35 or jaw > 0.29 or mar_ratio > 0.056:
            mouth_closed_prev = False
    else:
        if open_ix < 0.20 and jaw < 0.16 and (mclose > 0.12 or mar_ratio < 0.040):
            mouth_closed_prev = True

    return mouth_closed_prev


def preprocess_bgr_for_glasses(img_bgr):
    """CLAHE suave: mejora montura/reflejo en sombras sin saturar highlights."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    clahe = cv2.createCLAHE(clipLimit=2.8, tileGridSize=(8, 8))
    return clahe.apply(gray)


def glasses_from_frame(img_bgr, points):
    """
    ROI rectangular que encierra ambos ojos.
    Reflejo especular + montura (black-hat) + puente nasal.
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
    spec_mask = ((v > 242) & (s < 38)).astype(np.uint8) * 255
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
    if spec_density < 0.0008 and comp_count == 0 and rim_density < 0.075 and bridge_dark < 0.028:
        score = min(score, 32.0)

    bilateral_glare = left_hits > 0 and right_hits > 0
    strong_glare = spec_density > 0.0022 and comp_count >= 2 and bilateral_glare
    medium_glare = spec_density > 0.00135 and comp_count >= 2 and bilateral_glare and horiz_ratio > 0.97
    frame_presence = rim_density > 0.055 and bridge_dark > 0.018
    weak_frame_presence = rim_density > 0.042 and bridge_dark > 0.014
    if frame_presence:
        score = min(100.0, score + 19.0)

    glasses_score_hist.append(score)
    stable = float(np.median(list(glasses_score_hist)))

    global glasses_state_prev
    if not glasses_state_prev:
        glasses_state_prev = (
            (stable > 50.0 and strong_glare)
            or (stable > 54.0 and medium_glare)
            or (stable > 44.0 and frame_presence)
        )
    else:
        glasses_state_prev = not (
            stable < 32.0
            and (not weak_frame_presence)
            and spec_density < 0.00075
        )

    glasses_likelihood = stable
    if glasses_state_prev:
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
        "strong_glare": bool(strong_glare),
        "medium_glare": bool(medium_glare),
        "rim_density": float(rim_density),
        "bridge_dark": float(bridge_dark),
        "frame_presence": bool(frame_presence),
        "stable_score": float(stable),
        "glasses_likelihood": float(glasses_likelihood),
    }
    return float(glasses_likelihood), bool(glasses_state_prev), debug


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


@app.route("/analyze_eyes", methods=["POST"])
def analyze_eyes():
    global mouth_closed_prev, glasses_state_prev, last_glasses_debug
    global left_ear_hist, right_ear_hist

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

    # Ligera reducción de ruido en color (preserva bordes mejor que blur global) — C:\FACIAL
    img = cv2.bilateralFilter(img, d=5, sigmaColor=42, sigmaSpace=42)

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

    detection_result = detector.detect(mp_image)

    if not detection_result.face_landmarks:
        mouth_closed_prev = True
        glasses_state_prev = False
        left_ear_hist.clear()
        right_ear_hist.clear()
        last_glasses_debug = {"reason": "no_face"}
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
                "glasses_score": 0.0,
                "glasses_cv_score": 0.0,
                "confidence": 0.0,
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
    left_ear_hist.append(left_ear_raw)
    right_ear_hist.append(right_ear_raw)
    left_ear = float(np.median(left_ear_hist))
    right_ear = float(np.median(right_ear_hist))

    bs = blendshape_map(detection_result)
    blink_l = bs_get(bs, "eyeBlinkLeft", "EYE_BLINK_LEFT", "eyeblinkleft")
    blink_r = bs_get(bs, "eyeBlinkRight", "EYE_BLINK_RIGHT", "eyeblinkright")

    left_open = eye_open_hybrid(left_ear, blink_l, ear_t)
    right_open = eye_open_hybrid(right_ear, blink_r, ear_t)

    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mar_ratio = mar_inner_ratio(points)

    mouth_closed_bool = update_mouth_closed(bs, mar_ratio)
    mouth_open_bool = not mouth_closed_bool

    gscore, glasses_hit, gdebug = glasses_from_frame(img, points)
    no_glasses = not glasses_hit
    last_glasses_debug = gdebug

    conf = estimate_confidence(left_ear, right_ear, blink_l, blink_r, True)

    print(
        f"[EYE_AI] IED:{inter_eye:.1f} thr:{ear_t:.3f} EAR L:{left_ear:.3f} R:{right_ear:.3f} "
        f"blink L/R:{blink_l:.2f}/{blink_r:.2f} jaw:{jaw:.3f} MARi:{mar_ratio:.3f} "
        f"mouth_closed:{mouth_closed_bool} glasses:{glasses_hit}({gscore:.1f}) conf:{conf:.2f}",
        flush=True,
    )

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
            "glasses_score": float(gscore),
            "glasses_cv_score": float(gscore),
            "glasses_debug": gdebug,
            "confidence": float(conf),
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
        }
    )


@app.route("/glasses_debug", methods=["GET"])
def glasses_debug():
    return jsonify(last_glasses_debug)


if __name__ == "__main__":
    print("[EYE_AI] Motor IA puerto 5000", flush=True)
    app.run(host="0.0.0.0", port=5000, threaded=True)
