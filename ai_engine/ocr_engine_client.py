"""
Cliente HTTP hacia el servicio `ocr_engine` (OCR avanzado de PDF vía
PaddleOCR PP-StructureV2). Ver ocr_engine/server.py para el porqué de la
separación (mismo motivo de conflicto de dependencias ML pesadas que ya
resolvió avatar_engine/silentface_engine, ADR-141).

Igual que silentface_client.py: nunca lanza excepción, cualquier fallo de
infraestructura (servicio caído, no listo, timeout, red) se traduce a un
dict con "ok": False y un "error" explícito -- el llamador (eye_analyzer.py)
nunca debe fabricar contenido si el OCR real no respondió.
"""

import os
import time
from typing import Any, Dict

import requests


def _ocr_engine_url() -> str:
    base = os.environ.get("OCR_ENGINE_URL", "http://ocr_engine:5003").strip()
    return base.rstrip("/")


def ocr_pdf(file_bytes: bytes, filename: str) -> Dict[str, Any]:
    """
    Devuelve siempre uno de:
      {"ok": False, "error": str, ...}
      {"ok": True, "page_count": int, "pages": [...]}  (ver pdf_ocr_pipeline.py)

    timeout generoso (default 600s): PP-Structure sobre varias páginas
    escaneadas en CPU tarda de verdad -- ver OCR_ENGINE_MAX_OCR_PAGES en el
    sidecar para el tope que mantiene esto acotado.
    """
    timeout_s = float(os.environ.get("OCR_ENGINE_CLIENT_TIMEOUT_SECONDS", "600"))
    url = f"{_ocr_engine_url()}/ocr_pdf"
    t0 = time.monotonic()
    try:
        resp = requests.post(
            url,
            files={"file": (filename or "documento.pdf", file_bytes, "application/pdf")},
            timeout=timeout_s,
        )
    except requests.RequestException as exc:
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        print(f"[OCR_ENGINE_CLIENT] unavailable (red) elapsed_ms={elapsed_ms} detail={exc}", flush=True)
        return {"ok": False, "error": "ocr_engine_unavailable", "detail": str(exc)}

    elapsed_ms = int((time.monotonic() - t0) * 1000)

    if resp.status_code == 503:
        detail = None
        try:
            detail = resp.json().get("detail")
        except Exception:
            pass
        print(f"[OCR_ENGINE_CLIENT] unavailable (503 not_ready) elapsed_ms={elapsed_ms}", flush=True)
        return {"ok": False, "error": "ocr_engine_not_ready", "detail": detail}

    try:
        data = resp.json()
    except Exception as exc:
        print(f"[OCR_ENGINE_CLIENT] invalid_response elapsed_ms={elapsed_ms} detail={exc}", flush=True)
        return {"ok": False, "error": "ocr_engine_invalid_response", "detail": str(exc)}

    if resp.status_code != 200 or not data.get("ok"):
        print(
            f"[OCR_ENGINE_CLIENT] failed status={resp.status_code} error={data.get('error')} "
            f"elapsed_ms={elapsed_ms}",
            flush=True,
        )
        return data if isinstance(data, dict) else {"ok": False, "error": "ocr_engine_failed"}

    print(f"[OCR_ENGINE_CLIENT] ok elapsed_ms={elapsed_ms} pages={data.get('page_count')}", flush=True)
    return data


def remote_status() -> Dict[str, Any]:
    """GET /health del servicio remoto, con timeout corto -- solo para
    diagnóstico, nunca bloquea una importación real."""
    timeout_s = float(os.environ.get("OCR_ENGINE_HEALTH_TIMEOUT_SECONDS", "2"))
    url = f"{_ocr_engine_url()}/health"
    try:
        resp = requests.get(url, timeout=timeout_s)
        data = resp.json()
        data["_reachable"] = True
        return data
    except Exception as exc:
        return {"_reachable": False, "ready": False, "error": str(exc)}
