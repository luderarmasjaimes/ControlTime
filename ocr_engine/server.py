"""
Servicio HTTP dedicado a OCR avanzado de PDFs (PaddleOCR PP-StructureV2).
Aislado de ai_engine a propósito -- ver requirements.txt para el porqué
(mismo motivo de conflicto de dependencias ML pesadas ya resuelto con
avatar_engine/silentface_engine, ADR-141).

Operación de importación bajo demanda (no un camino caliente como el
verify-frame de login de silentface_engine): puede tardar de verdad en
documentos con varias páginas escaneadas, así que NO se serializa a un solo
worker -- pero tampoco hace falta la concurrencia alta de silentface_engine.
threads=2 alcanza para no bloquear /health mientras una importación corre.

Contrato con el llamador (ai_engine/ocr_engine_client.py):
- POST /ocr_pdf, multipart "file" -> 200 {"ok": true, "page_count": int,
  "pages": [...]} (ver pdf_ocr_pipeline.py) o error explícito (400 archivo
  inválido/vacío, 413 demasiado grande, 422 demasiadas páginas escaneadas
  para procesar en una sola request síncrona, 500 fallo de procesamiento).
- GET /health -> ready=true una vez que el modelo PP-Structure se precargó.
"""
import logging
import os
import threading

from flask import Flask, jsonify, request

from pdf_ocr_pipeline import (
    TooManyOcrPagesError,
    extract_pdf_structured,
    extract_image_structured,
    _get_table_engine,
    _get_text_ocr_engine,
)

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s ocr_engine %(levelname)s %(message)s"
)
log = logging.getLogger("ocr_engine.server")

app = Flask(__name__)

# %PDF- de firma + margen generoso para informes técnicos con muchas
# imágenes incrustadas (fotos de campo, planos escaneados) -- mismo criterio
# de límite explícito que CV_EXTRACT_MAX_BYTES en eye_analyzer.py, pero más
# alto porque acá el archivo de entrada ES el documento completo, no un CV.
MAX_PDF_BYTES = int(os.environ.get("OCR_ENGINE_MAX_PDF_BYTES", str(60 * 1024 * 1024)))
IMAGE_SIGNATURES = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",
    b"BM",
)

_ready = False
_preload_error = None
_preload_lock = threading.Lock()


def _preload():
    """Bloqueante a propósito, antes de servir tráfico -- descarga/carga los
    modelos de PP-Structure una sola vez (mismo principio que
    silentface_engine/avatar_engine: si el motor no carga, el servicio queda
    not_ready en vez de fallar silenciosamente en la primera request real)."""
    global _ready, _preload_error
    with _preload_lock:
        if _ready or _preload_error:
            return
        try:
            log.info("precargando PPStructure (layout/tabla) + PaddleOCR (texto)...")
            _get_table_engine()
            _get_text_ocr_engine()
            _ready = True
            log.info("listo")
        # BaseException, no solo Exception a propósito: paddleocr llama
        # sys.exit(-1) directo (no una excepción normal) ante una
        # combinación de idioma/modelo no soportada -- confirmado en vivo
        # (ver el comentario largo en pdf_ocr_pipeline.py::_get_table_engine)
        # -- sin este catch más amplio, ese sys.exit tumbaba el proceso
        # entero en vez de dejar el servicio en not_ready.
        except BaseException as ex:  # noqa: BLE001
            _preload_error = str(ex)
            log.error("preload de PPStructure/PaddleOCR falló: %s", ex)


@app.route("/health", methods=["GET"])
def health():
    body = {
        "status": "ok" if _ready else "not_ready",
        "ready": _ready,
        "provider": "paddleocr_pp_structure",
        "preload_error": _preload_error,
    }
    return jsonify(body), (200 if _ready else 503)


@app.route("/ocr_pdf", methods=["POST"])
def ocr_pdf():
    if not _ready:
        return jsonify({"ok": False, "error": "not_ready", "detail": _preload_error}), 503

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "no_file_provided"}), 400
    file = request.files["file"]
    file_bytes = file.read()
    if not file_bytes:
        return jsonify({"ok": False, "error": "empty_file"}), 400
    if len(file_bytes) > MAX_PDF_BYTES:
        return jsonify({"ok": False, "error": "file_too_large", "max_bytes": MAX_PDF_BYTES}), 413
    is_pdf = file_bytes.startswith(b"%PDF-")
    is_image = any(file_bytes.startswith(sig) for sig in IMAGE_SIGNATURES)
    if not is_pdf and not is_image:
        return jsonify({"ok": False, "error": "unsupported_file_type"}), 400

    try:
        result = extract_pdf_structured(file_bytes) if is_pdf else extract_image_structured(file_bytes)
        return jsonify(result)
    except TooManyOcrPagesError as ex:
        return jsonify({
            "ok": False,
            "error": "too_many_scanned_pages",
            "scanned_pages": ex.scanned_pages,
            "limit": ex.limit,
        }), 422
    except Exception as ex:  # noqa: BLE001 -- documento corrupto/formato inesperado, nunca 500 en silencio sin detalle
        log.exception("fallo procesando PDF")
        return jsonify({"ok": False, "error": "processing_failed", "detail": str(ex)}), 500


if __name__ == "__main__":
    _preload()

    from waitress import serve

    serve(app, host="0.0.0.0", port=5003, threads=2)
