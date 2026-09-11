"""Prueba de carga real, no simulada: N requests concurrentes contra
/check_liveness, mismo patron que el trafico real de login (varias sesiones
activas llamando /deepface_analyze cada ~175ms, ver ADR-124). Mide latencia
real, confirma que todas responden correctamente y que el modelo cacheado
tolera acceso concurrente sin corromper resultados (todas deben devolver la
MISMA confidence, ya que es la misma imagen determinista)."""
import concurrent.futures
import statistics
import sys
import time

import requests

URL = "http://localhost:5002/check_liveness"
N_CONCURRENT = int(sys.argv[1]) if len(sys.argv) > 1 else 20
IMAGE_PATH = "/tmp/test.jpg"


def one_request(i):
    with open(IMAGE_PATH, "rb") as f:
        raw = f.read()
    t0 = time.monotonic()
    try:
        resp = requests.post(URL, files={"image": ("t.jpg", raw, "image/jpeg")}, timeout=15)
        elapsed = time.monotonic() - t0
        return {"i": i, "status": resp.status_code, "elapsed": elapsed, "body": resp.json()}
    except Exception as e:
        elapsed = time.monotonic() - t0
        return {"i": i, "status": None, "elapsed": elapsed, "error": str(e)}


print(f"=== Disparando {N_CONCURRENT} requests concurrentes contra {URL} ===", flush=True)
t_start = time.monotonic()
with concurrent.futures.ThreadPoolExecutor(max_workers=N_CONCURRENT) as ex:
    results = list(ex.map(one_request, range(N_CONCURRENT)))
total_wall = time.monotonic() - t_start

ok = [r for r in results if r.get("status") == 200]
failed = [r for r in results if r.get("status") != 200]
confidences = set()
for r in ok:
    body = r.get("body", {})
    if body.get("ok"):
        confidences.add(round(body.get("confidence", -1), 4))

latencies = [r["elapsed"] for r in results]
print(f"\n=== RESUMEN ===", flush=True)
print(f"total_requests: {N_CONCURRENT}", flush=True)
print(f"ok_200: {len(ok)}", flush=True)
print(f"failed: {len(failed)}", flush=True)
for r in failed:
    print(f"  FAIL i={r['i']} status={r.get('status')} error={r.get('error')}", flush=True)
print(f"wall_clock_total_s: {total_wall:.2f}", flush=True)
print(f"latency_min_s: {min(latencies):.3f}", flush=True)
print(f"latency_max_s: {max(latencies):.3f}", flush=True)
print(f"latency_mean_s: {statistics.mean(latencies):.3f}", flush=True)
print(f"latency_p95_s: {sorted(latencies)[int(len(latencies)*0.95)]:.3f}", flush=True)
print(f"distinct_confidence_values (deben ser 1, misma imagen deterministica): {confidences}", flush=True)

all_good = len(ok) == N_CONCURRENT and len(confidences) == 1
print(f"\nRESULTADO: {'PASS' if all_good else 'FAIL'}", flush=True)
sys.exit(0 if all_good else 1)
