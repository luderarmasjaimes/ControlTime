"""
Bake-off aislado: reconocimiento facial de InspireFace (Opción C) sobre un
subconjunto de LFW, para comparar contra el proveedor biométrico actual
(DeepFace/Facenet512 + Silent-Face-Anti-Spoofing, ADR-105) con evidencia real
en vez de folletería del proyecto.

NO toca ai_engine/ ni backend/: contenedor y script separados, pensados para
tirarse después de leer el reporte. Ver README.md de este mismo directorio
para el hallazgo de licencia (modelos de InspireFace = solo uso académico,
prohibido comercial) antes de considerar promover esto a producción.

Qué mide:
- Precisión de verificación 1:1 (pares mismo-rostro / distinto-rostro) sobre
  un subconjunto de vilsonrodrigues/lfw (HuggingFace, Apache-2.0 -- mirror de
  LFW en formato imagefolder; NO es el protocolo oficial de pares de LFW, así
  que el número no es comparable bit a bit con benchmarks publicados, pero sí
  es un número real, reproducible, y comparable en igualdad de condiciones
  contra el stack actual si se corre el mismo manifiesto de pares).
- Latencia de detección + extracción de embedding, por imagen.
- Tasa de "no se detectó rostro" (proxy de qué tan exigente es el detector
  por defecto de InspireFace frente a fotos LFW sin alinear).

Qué NO mide (ver README.md): liveness/PAD -- ningún dataset de ataques de
presentación (CelebA-Spoof/CASIA-FASD/OULU-NPU/NUAA) estaba descargable desde
el entorno sandbox donde se escribió este spike (red restringida a
github.com/huggingface.co/pypi.org). El código queda listo para correr esa
medición en cuanto se disponga de un manifiesto real de vivo/spoof.
"""
from __future__ import annotations

import io
import json
import random
import re
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import pyarrow.parquet as pq
import requests

DATA_DIR = Path("/data")
MODEL_DIR = DATA_DIR / "models"
MODEL_PATH = MODEL_DIR / "Pikachu"
MODEL_URL = "https://github.com/HyperInspire/InspireFace/releases/download/v1.x/Pikachu"

LFW_PARQUET_URL = "https://huggingface.co/api/datasets/vilsonrodrigues/lfw/parquet/default/train/0.parquet"
LFW_PARQUET_PATH = DATA_DIR / "lfw_vilsonrodrigues.parquet"

# Tope de pares por clase (genuine/impostor) -- suficiente para una señal real
# sin correr los 9164 rostros en un spike. Subir si se quiere más confianza
# estadística; el script es determinista (SEED) para poder repetir la corrida.
PAIRS_PER_CLASS = 300
SEED = 20260903

REPORT_PATH = DATA_DIR / "bakeoff_report.json"


def log(msg: str) -> None:
    print(f"[bakeoff] {msg}", flush=True)


def ensure_model() -> Path:
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if MODEL_PATH.is_file() and MODEL_PATH.stat().st_size > 0:
        log(f"modelo ya presente: {MODEL_PATH} ({MODEL_PATH.stat().st_size} bytes)")
        return MODEL_PATH
    log(f"descargando pack de modelo desde {MODEL_URL} ...")
    resp = requests.get(MODEL_URL, timeout=120)
    resp.raise_for_status()
    MODEL_PATH.write_bytes(resp.content)
    log(f"modelo descargado: {len(resp.content)} bytes")
    return MODEL_PATH


def ensure_lfw_parquet() -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if LFW_PARQUET_PATH.is_file() and LFW_PARQUET_PATH.stat().st_size > 0:
        log(f"parquet LFW ya presente: {LFW_PARQUET_PATH}")
        return LFW_PARQUET_PATH
    log(f"descargando subconjunto LFW (vilsonrodrigues/lfw, Apache-2.0) desde {LFW_PARQUET_URL} ...")
    resp = requests.get(LFW_PARQUET_URL, timeout=300)
    resp.raise_for_status()
    LFW_PARQUET_PATH.write_bytes(resp.content)
    log(f"parquet descargado: {len(resp.content)} bytes")
    return LFW_PARQUET_PATH


_IDENTITY_RE = re.compile(r"^(.*)_\d{4}\.jpg$")


def identity_from_path(path: str) -> str:
    m = _IDENTITY_RE.match(path)
    if not m:
        raise ValueError(f"unexpected LFW filename format: {path}")
    return m.group(1)


def load_lfw_rows(parquet_path: Path) -> list[tuple[str, bytes]]:
    """[(identity, jpeg_bytes), ...] en el orden del parquet."""
    table = pq.read_table(parquet_path, columns=["image"])
    images = table.column("image").to_pylist()
    rows = []
    for item in images:
        path = item["path"]
        rows.append((identity_from_path(path), item["bytes"]))
    return rows


def build_pairs(rows: list[tuple[str, bytes]], pairs_per_class: int, seed: int):
    by_identity: dict[str, list[int]] = defaultdict(list)
    for idx, (identity, _blob) in enumerate(rows):
        by_identity[identity].append(idx)

    rng = random.Random(seed)

    genuine_candidates = [idxs for idxs in by_identity.values() if len(idxs) >= 2]
    rng.shuffle(genuine_candidates)
    genuine_pairs = []
    for idxs in genuine_candidates:
        if len(genuine_pairs) >= pairs_per_class:
            break
        a, b = rng.sample(idxs, 2)
        genuine_pairs.append((a, b))

    all_identities = list(by_identity.keys())
    impostor_pairs = []
    attempts = 0
    while len(impostor_pairs) < pairs_per_class and attempts < pairs_per_class * 20:
        attempts += 1
        id_a, id_b = rng.sample(all_identities, 2)
        a = rng.choice(by_identity[id_a])
        b = rng.choice(by_identity[id_b])
        impostor_pairs.append((a, b))

    log(f"pares genuinos: {len(genuine_pairs)} | pares impostores: {len(impostor_pairs)} "
        f"(identidades con >=2 fotos: {len(genuine_candidates)}, identidades totales: {len(all_identities)})")
    return genuine_pairs, impostor_pairs


def decode_bgr(jpeg_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def find_best_threshold(similarities: np.ndarray, labels: np.ndarray) -> tuple[float, float]:
    thresholds = np.linspace(-1.0, 1.0, 401)
    best_t, best_acc = 0.0, 0.0
    for t in thresholds:
        preds = similarities >= t
        acc = float((preds == labels).mean())
        if acc > best_acc:
            best_acc, best_t = acc, float(t)
    return best_t, best_acc


def main() -> None:
    import inspireface as isf

    model_path = ensure_model()
    log("inicializando InspireFace (Pikachu, CPU) ...")
    ok = isf.launch("Pikachu", resource_path=str(model_path))
    if not ok:
        raise SystemExit("isf.launch() devolvió False -- ver logs arriba")

    # HF_ENABLE_FACE_RECOGNITION es obligatorio para que
    # face_feature_extract() no falle con HERR_SESS_REC_EXTRACT_FAILURE (el
    # modelo de reconocimiento no se carga con HF_ENABLE_NONE).
    session = isf.InspireFaceSession(isf.HF_ENABLE_FACE_RECOGNITION, isf.HF_DETECT_MODE_ALWAYS_DETECT)

    parquet_path = ensure_lfw_parquet()
    rows = load_lfw_rows(parquet_path)
    log(f"filas LFW cargadas: {len(rows)}")

    genuine_pairs, impostor_pairs = build_pairs(rows, PAIRS_PER_CLASS, SEED)
    all_pairs = [(a, b, True) for a, b in genuine_pairs] + [(a, b, False) for a, b in impostor_pairs]
    rng = random.Random(SEED)
    rng.shuffle(all_pairs)

    # Cachear feature/latencia por índice de imagen (varios pares comparten imágenes).
    feature_cache: dict[int, np.ndarray | None] = {}
    detect_extract_ms: list[float] = []
    no_face_count = 0
    multi_face_count = 0

    def get_feature(idx: int) -> np.ndarray | None:
        nonlocal no_face_count, multi_face_count
        if idx in feature_cache:
            return feature_cache[idx]
        _identity, jpeg_bytes = rows[idx]
        image = decode_bgr(jpeg_bytes)
        t0 = time.perf_counter()
        feature = None
        if image is not None:
            faces = session.face_detection(image)
            if len(faces) == 0:
                no_face_count += 1
            else:
                if len(faces) > 1:
                    multi_face_count += 1
                feature = session.face_feature_extract(image, faces[0])
        detect_extract_ms.append((time.perf_counter() - t0) * 1000.0)
        feature_cache[idx] = feature
        return feature

    similarities = []
    labels = []
    skipped_no_face = 0
    log(f"evaluando {len(all_pairs)} pares ...")
    for i, (a, b, is_genuine) in enumerate(all_pairs, start=1):
        fa = get_feature(a)
        fb = get_feature(b)
        if fa is None or fb is None:
            skipped_no_face += 1
            continue
        sim = float(isf.feature_comparison(fa, fb))
        similarities.append(sim)
        labels.append(is_genuine)
        if i % 100 == 0:
            log(f"  {i}/{len(all_pairs)} pares procesados")

    similarities_arr = np.array(similarities, dtype=np.float64)
    labels_arr = np.array(labels, dtype=bool)
    best_threshold, best_accuracy = find_best_threshold(similarities_arr, labels_arr)

    lat = np.array(detect_extract_ms)
    report = {
        "provider": "inspireface_pikachu_cpu",
        "spike_disclaimer": (
            "I+D interno, no producción. Modelos de InspireFace: uso academico, "
            "prohibido comercial (ver README.md de este directorio)."
        ),
        "dataset": "vilsonrodrigues/lfw (HuggingFace, Apache-2.0, imagefolder, "
                   "NO es el protocolo oficial de pares de LFW)",
        "unique_images_used": len(rows),
        "pairs_requested_per_class": PAIRS_PER_CLASS,
        "pairs_evaluated": len(similarities),
        "pairs_skipped_no_face_detected": skipped_no_face,
        "images_with_no_face_detected": no_face_count,
        "images_with_multiple_faces_detected": multi_face_count,
        "best_threshold_cosine": best_threshold,
        "best_accuracy": best_accuracy,
        "latency_ms_detect_plus_extract": {
            "count": len(lat),
            "mean": float(lat.mean()) if len(lat) else None,
            "p50": float(np.percentile(lat, 50)) if len(lat) else None,
            "p95": float(np.percentile(lat, 95)) if len(lat) else None,
            "max": float(lat.max()) if len(lat) else None,
        },
        "current_stack_reference": {
            "provider": "deepface_facenet512 (ADR-105)",
            "cosine_similarity_threshold_configured": 0.70,
            "note": "umbral operativo actual del backend (gFaceDeepfaceCosineThreshold), "
                    "no una corrida equivalente sobre el mismo subconjunto -- para una "
                    "comparación real, correr ai_engine/deepface_silentface_adapter.py "
                    "contra el mismo manifiesto de pares (fuera de alcance de este spike).",
        },
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    log(f"reporte escrito en {REPORT_PATH}")
    log(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
