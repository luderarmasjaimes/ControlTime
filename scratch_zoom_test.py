import os, json, cv2, numpy as np, urllib.request, time

ROOT = "/tmp/face_test"
OUT_ROOT = "/tmp/face_zoom"
BASE = "http://localhost:5000/seetaface_analyze"
cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

def detect_face(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    faces = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(80, 80))
    if len(faces) == 0:
        return None
    # largest face
    faces = sorted(faces, key=lambda f: f[2]*f[3], reverse=True)
    return faces[0]  # x,y,w,h

def bbox_ratio(img, bbox):
    h_img, w_img = img.shape[:2]
    x, y, w, h = bbox
    return h / h_img, w / w_img

def analyze_bytes(jpeg_bytes, mode="register"):
    boundary = "----facebound1234"
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += b'Content-Disposition: form-data; name="image"; filename="x.jpg"\r\n'
    body += b"Content-Type: image/jpeg\r\n\r\n"
    body += jpeg_bytes
    body += f"\r\n--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="mode"\r\n\r\n{mode}\r\n'.encode()
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())

# Step 1: measure baseline face ratio in "cerca"
cerca_ratios = []
for fname in sorted(os.listdir(os.path.join(ROOT, "cerca")))[:20]:
    img = cv2.imread(os.path.join(ROOT, "cerca", fname))
    if img is None: continue
    bbox = detect_face(img)
    if bbox is None: continue
    hr, wr = bbox_ratio(img, bbox)
    cerca_ratios.append(hr)

target_h_ratio = float(np.median(cerca_ratios)) if cerca_ratios else 0.5
print(f"cerca_samples_measured={len(cerca_ratios)} target_face_h_ratio_median={target_h_ratio:.3f}")

def zoom_to_target(img, bbox, target_ratio, out_size=(1440, 1920)):
    x, y, w, h = bbox
    h_img, w_img = img.shape[:2]
    cx, cy = x + w/2, y + h/2
    # desired crop height so that face height h becomes target_ratio of crop height
    crop_h = h / target_ratio
    crop_w = crop_h * (w_img / h_img)  # keep original aspect ratio
    x0 = max(0, cx - crop_w/2); y0 = max(0, cy - crop_h/2)
    x1 = min(w_img, cx + crop_w/2); y1 = min(h_img, cy + crop_h/2)
    x0, y0, x1, y1 = int(x0), int(y0), int(x1), int(y1)
    crop = img[y0:y1, x0:x1]
    if crop.size == 0:
        return None
    resized = cv2.resize(crop, (out_size[1], out_size[0]), interpolation=cv2.INTER_CUBIC)
    return resized

results = []
for category in ["normal", "lejos"]:
    folder = os.path.join(ROOT, category)
    files = sorted(os.listdir(folder))
    for fname in files:
        path = os.path.join(folder, fname)
        img = cv2.imread(path)
        if img is None:
            continue
        bbox = detect_face(img)
        if bbox is None:
            results.append({"category": category, "file": fname, "zoom": "n/a", "error": "no_face_detected_haar"})
            continue
        zoomed = zoom_to_target(img, bbox, target_h_ratio)
        if zoomed is None:
            results.append({"category": category, "file": fname, "zoom": "n/a", "error": "crop_failed"})
            continue
        ok, buf = cv2.imencode(".jpg", zoomed, [cv2.IMWRITE_JPEG_QUALITY, 92])
        if not ok:
            continue
        try:
            r = analyze_bytes(buf.tobytes())
        except Exception as e:
            r = {"error": f"request_failed:{e}"}
        rec = {
            "category": category,
            "file": fname,
            "pass": r.get("pass"),
            "clarity": (r.get("liveness") or {}).get("clarity"),
            "reality": (r.get("liveness") or {}).get("reality"),
            "issues": (r.get("quality") or {}).get("issues"),
            "error": r.get("error"),
        }
        results.append(rec)
        print(json.dumps(rec))

with open("/tmp/face_zoom_results.jsonl", "w") as f:
    for rec in results:
        f.write(json.dumps(rec) + "\n")

print(f"DONE total={len(results)}")
