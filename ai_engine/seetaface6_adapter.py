"""Adaptador local y fail-closed para el CLI oficial de SeetaFace6."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
from typing import Any

import cv2
import numpy as np

CLI_PATH = Path(os.getenv("SEETAFACE6_CLI_PATH", "/opt/seetaface6/bin/seetaface6-face-cli"))
MODEL_DIR = Path(os.getenv("SEETAFACE6_MODEL_DIR", "/opt/seetaface6/models"))
TIMEOUT_SECONDS = max(1, min(int(os.getenv("SEETAFACE6_TIMEOUT_SECONDS", "20")), 120))
REQUIRED_MODELS = (
    "face_detector.csta",
    "face_landmarker_pts5.csta",
    "face_recognizer.csta",
    "fas_first.csta",
    "fas_second.csta",
)


def status() -> dict[str, Any]:
    missing = [name for name in REQUIRED_MODELS if not (MODEL_DIR / name).is_file()]
    return {
        "available": CLI_PATH.is_file() and not missing,
        "provider": "seetaface6_local",
        "cli": str(CLI_PATH),
        "model_dir": str(MODEL_DIR),
        "missing_models": missing,
        "external_apis": False,
        "certification_claim": False,
    }


def analyze(raw: bytes, mode: str) -> dict[str, Any]:
    if mode not in {"register", "verify"}:
        return {"ok": False, "pass": False, "error": "invalid_mode"}
    current = status()
    if not current["available"]:
        return {"ok": False, "pass": False, "error": "seetaface6_unavailable", "status": current}
    if not raw:
        return {"ok": False, "pass": False, "error": "empty_image"}

    image_path: str | None = None
    result_path: str | None = None
    try:
        encoded = np.frombuffer(raw, dtype=np.uint8)
        bgr = cv2.imdecode(encoded, cv2.IMREAD_COLOR)
        if bgr is None or bgr.size == 0:
            return {"ok": False, "pass": False, "error": "invalid_image"}
        height, width = bgr.shape[:2]
        if width > 8192 or height > 8192:
            return {"ok": False, "pass": False, "error": "image_dimensions_too_large"}
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        with tempfile.NamedTemporaryFile(prefix="seeta_", suffix=".ppm", delete=False) as image_file:
            image_file.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
            image_file.write(rgb.tobytes())
            image_path = image_file.name
        with tempfile.NamedTemporaryFile(prefix="seeta_", suffix=".json", delete=False) as result_file:
            result_path = result_file.name
        completed = subprocess.run(
            [str(CLI_PATH), "--input", image_path, "--mode", mode,
             "--model-dir", str(MODEL_DIR), "--output-json", result_path],
            check=False,
            capture_output=True,
            text=True,
            timeout=TIMEOUT_SECONDS,
            shell=False,
        )
        if not Path(result_path).is_file() or Path(result_path).stat().st_size == 0:
            return {"ok": False, "pass": False, "error": "seetaface6_no_result",
                    "exit_code": completed.returncode}
        payload = json.loads(Path(result_path).read_text(encoding="utf-8"))
        template = payload.get("template", [])
        if payload.get("pass") and (not isinstance(template, list) or len(template) not in {512, 1024}):
            return {"ok": False, "pass": False, "error": "seetaface6_template_dim_invalid"}
        payload["ok"] = completed.returncode == 0 and bool(payload.get("pass"))
        return payload
    except subprocess.TimeoutExpired:
        return {"ok": False, "pass": False, "error": "seetaface6_timeout"}
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return {"ok": False, "pass": False, "error": "seetaface6_adapter_failed",
                "detail": str(exc)[:300]}
    finally:
        for path in (image_path, result_path):
            if path:
                try:
                    Path(path).unlink(missing_ok=True)
                except OSError:
                    pass
