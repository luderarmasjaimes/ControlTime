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

MODEL_PATH = "face_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)

if not os.path.exists(MODEL_PATH):
    print(f"[*] Descargando modelo MediaPipe: {MODEL_PATH}...", flush=True)
    try:
        r = requests.get(MODEL_URL, timeout=60)
        with open(MODEL_PATH, "wb") as f:
            f.write(r.content)
        print("[+] Modelo descargado exitosamente.", flush=True)
    except Exception as e:
        print(f"[!] Error descargando modelo: {e}.", flush=True)

base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.FaceLandmarkerOptions(
    base_options=base_options,
    output_face_blendshapes=True,
    num_faces=1,
)
detector = vision.FaceLandmarker.create_from_options(options)

LEFT_EYE = [33, 160, 158, 133, 153, 144]
RIGHT_EYE = [362, 385, 387, 263, 373, 380]

mouth_closed_prev = True
glasses_score_hist = deque(maxlen=7)
glasses_state_prev = False
last_glasses_debug = {}


def calculate_ear(landmarks, eye_indices):
    v1 = np.linalg.norm(landmarks[eye_indices[1]] - landmarks[eye_indices[5]])
    v2 = np.linalg.norm(landmarks[eye_indices[2]] - landmarks[eye_indices[4]])
    h = np.linalg.norm(landmarks[eye_indices[0]] - landmarks[eye_indices[3]])
    return (v1 + v2) / (2.0 * h + 1e-6)


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
    for key in bs:
        kl = key.lower().replace("_", "")
        for a in aliases:
            if kl == a.lower().replace("_", ""):
                return float(bs[key])
    return 0.0


def mar_inner_ratio(points):
    if points.shape[0] < 310:
        return 0.04
    p13, p14 = points[13], points[14]
    p78, p308 = points[78], points[308]
    ver = float(np.linalg.norm(p13 - p14))
    hor = float(np.linalg.norm(p78 - p308))
    return ver / (hor + 1e-6)


def update_mouth_closed(bs, mar_ratio):
    global mouth_closed_prev
    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mclose = bs_get(bs, "mouthClose", "MOUTH_CLOSE")
    funnel = bs_get(bs, "mouthFunnel", "MOUTH_FUNNEL")
    pucker = bs_get(bs, "mouthPucker", "MOUTH_PUCKER")

    open_ix = 0.48 * jaw + 0.42 * funnel + 0.28 * pucker - 0.32 * mclose
    open_ix = float(max(0.0, min(1.0, open_ix)))
    if mar_ratio > 0.058:
        open_ix = max(open_ix, 0.42)
    elif mar_ratio < 0.034:
        open_ix = min(open_ix, 0.14)

    if mouth_closed_prev:
        if open_ix > 0.33 or jaw > 0.27 or mar_ratio > 0.054:
            mouth_closed_prev = False
    else:
        if open_ix < 0.19 and jaw < 0.15 and (mclose > 0.11 or mar_ratio < 0.041):
            mouth_closed_prev = True

    return mouth_closed_prev


def glasses_from_frame(img_bgr, points):
    h, w = img_bgr.shape[:2]
    le = np.mean(points[LEFT_EYE], axis=0)
    re = np.mean(points[RIGHT_EYE], axis=0)
    dist = float(np.linalg.norm(le - re))
    if dist < 12.0:
        return 0.0, False, {"reason": "eye_distance_too_small", "eye_dist": float(dist)}

    cx, cy = (le + re) / 2.0
    x1 = int(max(0, cx - dist * 0.68))
    x2 = int(min(w - 1, cx + dist * 0.68))
    y1 = int(max(0, cy - dist * 0.34))
    y2 = int(min(h - 1, cy + dist * 0.20))
    if x2 <= x1 or y2 <= y1:
        return 0.0, False, {"reason": "invalid_roi"}

    crop = img_bgr[y1:y2, x1:x2]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    v = hsv[:, :, 2]
    s = hsv[:, :, 1]
    spec_mask = ((v > 244) & (s < 36)).astype(np.uint8) * 255
    spec_mask = cv2.morphologyEx(
        spec_mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )
    spec_mask = cv2.morphologyEx(
        spec_mask, cv2.MORPH_DILATE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    )

    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(spec_mask, connectivity=8)
    h_roi, w_roi = gray.shape[:2]
    min_area = max(10, int((h_roi * w_roi) * 0.0012))
    max_area = max(min_area + 1, int((h_roi * w_roi) * 0.09))
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
        _, bh_bin = cv2.threshold(bh, 18, 255, cv2.THRESH_BINARY)
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
        _, bbin = cv2.threshold(bbh, 16, 255, cv2.THRESH_BINARY)
        bridge_dark = float(np.count_nonzero(bbin)) / float(bbin.size + 1)

    glare_term = min(72.0, spec_density * 52000.0)
    blob_term = min(22.0, float(comp_count) * 6.0 + (float(area_sum) / float(spec_mask.size + 1)) * 2200.0)
    frame_term = max(0.0, horiz_ratio - 1.00) * 14.0 + max(0.0, horiz_energy - 3.0) * 2.4
    frame_term = min(18.0, frame_term)
    rim_term = min(34.0, rim_density * 220.0)
    bridge_term = min(20.0, bridge_dark * 260.0)
    score = float(np.clip(glare_term + blob_term + frame_term + rim_term + bridge_term, 0.0, 100.0))
    if spec_density < 0.0008 and comp_count == 0 and rim_density < 0.08 and bridge_dark < 0.03:
        score = min(score, 34.0)

    bilateral_glare = left_hits > 0 and right_hits > 0
    strong_glare = spec_density > 0.0023 and comp_count >= 2 and bilateral_glare
    medium_glare = spec_density > 0.0014 and comp_count >= 2 and bilateral_glare and horiz_ratio > 0.98
    frame_presence = rim_density > 0.060 and bridge_dark > 0.020
    weak_frame_presence = rim_density > 0.045 and bridge_dark > 0.015
    if frame_presence:
        score = min(100.0, score + 18.0)

    glasses_score_hist.append(score)
    stable = float(np.median(list(glasses_score_hist)))

    global glasses_state_prev
    if not glasses_state_prev:
        glasses_state_prev = (
            (stable > 52.0 and strong_glare)
            or (stable > 56.0 and medium_glare)
            or (stable > 46.0 and frame_presence)
        )
    else:
        glasses_state_prev = not (
            stable < 34.0
            and (not weak_frame_presence)
            and spec_density < 0.0008
        )

    glasses_likelihood = stable
    if glasses_state_prev:
        glasses_likelihood = max(62.0, stable)
    else:
        glasses_likelihood = min(38.0, stable)

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


@app.route("/analyze_eyes", methods=["POST"])
def analyze_eyes():
    global mouth_closed_prev, glasses_state_prev, last_glasses_debug
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

    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)

    detection_result = detector.detect(mp_image)

    if not detection_result.face_landmarks:
        mouth_closed_prev = True
        glasses_state_prev = False
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
            }
        )

    h, w, _ = img.shape
    landmarks = detection_result.face_landmarks[0]
    points = np.array([[lm.x * w, lm.y * h] for lm in landmarks])

    left_ear = calculate_ear(points, LEFT_EYE)
    right_ear = calculate_ear(points, RIGHT_EYE)
    left_open = left_ear > 0.20
    right_open = right_ear > 0.20

    bs = blendshape_map(detection_result)
    jaw = bs_get(bs, "jawOpen", "JAW_OPEN")
    mar_ratio = mar_inner_ratio(points)

    mouth_closed_bool = update_mouth_closed(bs, mar_ratio)
    mouth_open_bool = not mouth_closed_bool

    gscore, glasses_hit, gdebug = glasses_from_frame(img, points)
    no_glasses = not glasses_hit
    last_glasses_debug = gdebug

    print(
        f"[EYE_AI] EAR L:{left_ear:.3f} R:{right_ear:.3f} jaw:{jaw:.3f} "
        f"MARi:{mar_ratio:.3f} mouth_closed:{mouth_closed_bool} "
        f"glasses:{glasses_hit}({gscore:.1f}) no_glasses:{no_glasses}",
        flush=True,
    )

    return jsonify(
        {
            "detected": True,
            "left_ear": float(left_ear),
            "right_ear": float(right_ear),
            "left_open": bool(left_open),
            "right_open": bool(right_open),
            "both_open": bool(left_open and right_open),
            "mouth_open": bool(mouth_open_bool),
            "mouth_mar": float(jaw),
            "mouth_closed": bool(mouth_closed_bool),
            "no_glasses": bool(no_glasses),
            "glasses_score": float(gscore),
            "glasses_debug": gdebug,
            "confidence": 1.0,
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "MediaPipe Tasks FaceLandmarker"})


@app.route("/glasses_debug", methods=["GET"])
def glasses_debug():
    return jsonify(last_glasses_debug)


if __name__ == "__main__":
    print("[EYE_AI] Motor IA puerto 5000", flush=True)
    app.run(host="0.0.0.0", port=5000, threaded=True)
