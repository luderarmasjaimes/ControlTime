import os, json, urllib.request, time

BASE = "http://localhost:5000/seetaface_analyze"
ROOT = "/tmp/face_test"
OUT = "/tmp/face_test_results.jsonl"

def analyze(path, mode="register"):
    with open(path, "rb") as f:
        data = f.read()
    boundary = "----facebound1234"
    body = b""
    body += f"--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="image"; filename="{os.path.basename(path)}"\r\n'.encode()
    body += b"Content-Type: image/jpeg\r\n\r\n"
    body += data
    body += f"\r\n--{boundary}\r\n".encode()
    body += f'Content-Disposition: form-data; name="mode"\r\n\r\n{mode}\r\n'.encode()
    body += f"--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": f"request_failed:{e}"}

results = []
for category in ["cerca", "normal", "lejos"]:
    folder = os.path.join(ROOT, category)
    files = sorted(os.listdir(folder))
    for i, fname in enumerate(files):
        path = os.path.join(folder, fname)
        t0 = time.time()
        r = analyze(path)
        dt = time.time() - t0
        rec = {
            "category": category,
            "file": fname,
            "pass": r.get("pass"),
            "clarity": (r.get("liveness") or {}).get("clarity"),
            "reality": (r.get("liveness") or {}).get("reality"),
            "liveness_status": (r.get("liveness") or {}).get("status"),
            "issues": (r.get("quality") or {}).get("issues"),
            "error": r.get("error"),
            "dt": round(dt, 2),
        }
        results.append(rec)
        print(json.dumps(rec))

with open(OUT, "w") as f:
    for rec in results:
        f.write(json.dumps(rec) + "\n")

print(f"DONE total={len(results)}")
