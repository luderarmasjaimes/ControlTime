"""Arnés de evaluación visual para avatar_animation_engine (ADR-150).

Mismo criterio que avatar_engine/scripts/ca15_public_domain_test.py (ADR-141):
corre el pipeline HTTP real (nunca una reconstrucción aislada) contra un set
de assets de dominio público con manifiesto de fuente/licencia/SHA-256, y
guarda la evidencia sin sobrescribir corridas anteriores.

Uso:
    python evaluate_public_domain.py --assets-dir ./eval_assets \
        --manifest ./eval_assets/sources.json \
        --engine-url http://localhost:5003 \
        --out-dir ../artifacts/avatar_animation_eval_<fecha>

`sources.json` es una lista de objetos:
    {
      "id": "caso_01",
      "image": "caso_01.png",
      "audio": "caso_01.wav",
      "image_source": "<URL o archivo propio>",
      "image_license": "dominio público / CC0 / propio",
      "audio_source": "...",
      "audio_license": "..."
    }

IMPORTANTE: este script NO trae assets por su cuenta. Cargar manualmente
fotos/audios verificados como dominio público (o grabaciones propias del
equipo) antes de correrlo -- no usar clips con copyright de terceros.
"""

import argparse
import hashlib
import json
import os
import sys
import time

import requests


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assets-dir", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--engine-url", default="http://localhost:5003")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=200.0)
    args = parser.parse_args()

    with open(args.manifest, "r", encoding="utf-8") as fh:
        cases = json.load(fh)

    os.makedirs(args.out_dir, exist_ok=True)
    report = []

    for case in cases:
        case_id = case["id"]
        image_path = os.path.join(args.assets_dir, case["image"])
        audio_path = os.path.join(args.assets_dir, case["audio"])
        if not os.path.isfile(image_path) or not os.path.isfile(audio_path):
            report.append({"id": case_id, "ok": False, "error": "asset_missing"})
            print(f"[{case_id}] SKIP: asset faltante", file=sys.stderr)
            continue

        entry = {
            "id": case_id,
            "image_sha256": _sha256(image_path),
            "audio_sha256": _sha256(audio_path),
            "image_source": case.get("image_source"),
            "image_license": case.get("image_license"),
            "audio_source": case.get("audio_source"),
            "audio_license": case.get("audio_license"),
        }

        t0 = time.monotonic()
        try:
            with open(image_path, "rb") as img_fh, open(audio_path, "rb") as audio_fh:
                resp = requests.post(
                    f"{args.engine_url.rstrip('/')}/animate",
                    files={"image": img_fh, "audio": audio_fh},
                    timeout=args.timeout_seconds,
                )
        except requests.RequestException as exc:
            entry["ok"] = False
            entry["error"] = f"request_exception: {exc}"
            report.append(entry)
            print(f"[{case_id}] FAIL: {exc}", file=sys.stderr)
            continue

        elapsed_ms = int((time.monotonic() - t0) * 1000)
        entry["elapsed_ms"] = elapsed_ms
        entry["http_status"] = resp.status_code

        if resp.status_code != 200:
            entry["ok"] = False
            entry["error"] = resp.text[:2000]
            report.append(entry)
            print(f"[{case_id}] FAIL status={resp.status_code} elapsed_ms={elapsed_ms}")
            continue

        out_video = os.path.join(args.out_dir, f"{case_id}.mp4")
        with open(out_video, "wb") as fh:
            fh.write(resp.content)
        entry["ok"] = True
        entry["output_video"] = out_video
        entry["output_bytes"] = len(resp.content)
        entry["backend"] = resp.headers.get("X-Backend")
        report.append(entry)
        print(f"[{case_id}] OK elapsed_ms={elapsed_ms} bytes={len(resp.content)}")

    report_path = os.path.join(args.out_dir, "report.json")
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2, ensure_ascii=False)
    print(f"\nReporte guardado en {report_path}")

    n_ok = sum(1 for r in report if r.get("ok"))
    print(f"{n_ok}/{len(report)} casos OK")
    return 0 if n_ok == len(report) else 1


if __name__ == "__main__":
    raise SystemExit(main())
