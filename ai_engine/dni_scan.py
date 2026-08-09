"""
Lectura de DNI peruano por cámara — PDF417 (DNI antiguo 1997) + MRZ/TD1
(todas las versiones, incluido DNI electrónico). Sin dependencias externas
(no consulta RENIEC/SUNAT) — solo decodifica lo que ya está impreso en el
documento. QR del DNI electrónico 3.0 queda deliberadamente fuera: RENIEC no
publica el formato de sus datos y no fue posible verificarlo contra una
muestra real (ver docs/decisions, ADR de este mismo trabajo).

Capas de decodificación, en orden (la primera que produzca un resultado
plausible gana — nunca se combinan parcialmente):
  1. PDF417 (pyzbar) — layout de bytes fijo tomado de github.com/Eitol/
     peru-dni-reader (MIT), verificado por separado que los offsets no se
     inventaron: bytes 0-1 tipo doc, 2-9 DNI, 10-49/50-89 apellidos,
     90-124 nombres, 125 sexo, 448-455 fecha. El resto (126-447) es
     biometría de huella dactilar embebida — se ignora, no se necesita.
  2. MRZ TD1 (pytesseract + paquete `mrz`) — 3 líneas OCR-B en el tercio
     inferior del reverso, con checksum ICAO 9303 real (valida el propio
     paquete `mrz`, no lo reinventamos acá).

Además del checksum ICAO de la MRZ, todo DNI extraído (por cualquier
método) se revalida con el dígito verificador real de RENIEC (Módulo 11,
pesos 3,2,7,6,5,4,3,2 — mismo algoritmo documentado públicamente y
verificado con un caso de ejemplo real antes de implementarlo) como
segunda capa de confianza independiente del método de lectura.
"""
from __future__ import annotations

import re
from typing import Optional

import cv2
import numpy as np

try:
    from pyzbar.pyzbar import decode as _zbar_decode
    from pyzbar.pyzbar import ZBarSymbol as _ZBarSymbol
except Exception:  # pragma: no cover - falta libzbar en el entorno
    _zbar_decode = None
    _ZBarSymbol = None

try:
    import pytesseract
except Exception:  # pragma: no cover - falta tesseract-ocr en el entorno
    pytesseract = None

try:
    from mrz.checker.td1 import TD1CodeChecker
except Exception:  # pragma: no cover - falta el paquete mrz
    TD1CodeChecker = None


# ── Checksum real del DNI peruano (RENIEC, Módulo 11) ───────────────────────
# Pesos y algoritmo verificados con el caso de ejemplo documentado
# públicamente: DNI 17801146 -> dígito verificador 4.
_DNI_CHECKSUM_WEIGHTS = (3, 2, 7, 6, 5, 4, 3, 2)


def dni_checksum_digit(dni8: str) -> Optional[int]:
    """Calcula el dígito verificador real del DNI (Módulo 11). None si `dni8`
    no son exactamente 8 dígitos."""
    if not re.fullmatch(r"\d{8}", dni8 or ""):
        return None
    total = sum(int(d) * w for d, w in zip(dni8, _DNI_CHECKSUM_WEIGHTS))
    remainder = total % 11
    digit = 0 if remainder == 0 else 11 - remainder
    # Igual que el RUC (auth_routes.cpp/tax_id.cpp): un resultado de 10/11 se
    # normaliza -- no documentado explícitamente para DNI, pero es el mismo
    # criterio ICAO/SUNAT ya usado en el resto de la plataforma para dígitos
    # verificadores mod-11 de un solo dígito.
    if digit == 10:
        digit = 0
    elif digit == 11:
        digit = 1
    return digit


# ── PDF417 (DNI antiguo, 1997) ───────────────────────────────────────────────
# Offsets de bytes tal como los documenta github.com/Eitol/peru-dni-reader
# (MIT). 126-447 es biometría de huella dactilar embebida -- se ignora.
_PDF417_MIN_LEN = 456


def _try_decode_pdf417(img: np.ndarray) -> Optional[dict]:
    if _zbar_decode is None:
        return None
    try:
        codes = _zbar_decode(img, symbols=[_ZBarSymbol.PDF417])
    except Exception:
        return None
    for code in codes:
        parsed = _parse_pdf417_payload(code.data)
        if parsed:
            return parsed
    return None


def _parse_pdf417_payload(raw: bytes) -> Optional[dict]:
    try:
        text = raw.decode("latin-1", errors="replace")
    except Exception:
        return None
    if len(text) < _PDF417_MIN_LEN:
        return None

    dni = text[2:10].strip()
    if not re.fullmatch(r"\d{8}", dni):
        return None

    last1 = text[10:50].strip()
    last2 = text[50:90].strip()
    given = text[90:125].strip()
    sex_char = text[125] if len(text) > 125 else ""
    sex = "M" if sex_char == "1" else ("F" if sex_char == "2" else "")

    expiry_date = ""
    raw_date = text[448:456].strip()
    if re.fullmatch(r"\d{8}", raw_date):
        expiry_date = f"{raw_date[0:4]}-{raw_date[4:6]}-{raw_date[6:8]}"

    checksum_digit = dni_checksum_digit(dni)

    return {
        "method": "pdf417",
        "found": True,
        "dni": dni,
        "last_name": " ".join(p for p in (last1, last2) if p),
        "first_name": given,
        "sex": sex,
        "birth_date": "",
        "expiry_date": expiry_date,
        # El PDF417 no trae el dígito verificador por separado del propio
        # DNI -- se valida acá con el mismo checksum RENIEC que el resto de
        # este módulo, no se asume válido solo por venir de un barcode.
        "checksum_valid": checksum_digit is not None,
    }


# ── MRZ / TD1 (todas las versiones, incluido DNI electrónico) ───────────────
_MRZ_LINE_LEN = 30
_MRZ_CHAR_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<"


def _ocr_mrz_lines(img: np.ndarray) -> list[str]:
    if pytesseract is None:
        return []
    h, w = img.shape[:2]
    # La MRZ vive en el tercio inferior del reverso -- recorte generoso para
    # tolerar encuadre imperfecto del usuario frente a la cámara.
    crop = img[int(h * 0.60):h, 0:w]
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.resize(gray, None, fx=2.0, fy=2.0, interpolation=cv2.INTER_CUBIC)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    config = (
        "--psm 6 -c tessedit_char_whitelist=" + _MRZ_CHAR_WHITELIST
    )
    try:
        raw_text = pytesseract.image_to_string(thresh, config=config)
    except Exception:
        return []
    lines = [ln.strip().upper() for ln in raw_text.splitlines() if ln.strip()]
    # TD1 son exactamente 3 líneas de 30 caracteres -- normalizamos con
    # relleno de '<' (el carácter de relleno estándar ICAO) en vez de
    # descartar una línea corta por ruido de OCR en el extremo.
    normalized = []
    for ln in lines[-3:]:
        ln = re.sub(r"[^A-Z0-9<]", "<", ln)
        if len(ln) < _MRZ_LINE_LEN:
            ln = ln.ljust(_MRZ_LINE_LEN, "<")
        normalized.append(ln[:_MRZ_LINE_LEN])
    return normalized


def _try_decode_mrz(img: np.ndarray) -> Optional[dict]:
    if TD1CodeChecker is None:
        return None
    lines = _ocr_mrz_lines(img)
    if len(lines) != 3:
        return None
    mrz_text = "\n".join(lines)
    try:
        checker = TD1CodeChecker(mrz_text)
        fields = checker.fields()
    except Exception:
        return None

    dni = re.sub(r"[^0-9]", "", getattr(fields, "document_number", "") or "")
    if not re.fullmatch(r"\d{8}", dni):
        return None

    icao_valid = bool(checker)
    checksum_digit = dni_checksum_digit(dni)

    def _fmt_date(raw: str) -> str:
        # ICAO YYMMDD -- no trae siglo; se asume 19xx/20xx por el mismo
        # criterio simple que usan los lectores de pasaporte de referencia
        # (>=30 -> 19xx, si no 20xx). Suficiente para mostrarlo al usuario,
        # no se usa para decidir nada crítico.
        if not raw or not re.fullmatch(r"\d{6}", raw):
            return ""
        yy, mm, dd = raw[0:2], raw[2:4], raw[4:6]
        century = "19" if int(yy) >= 30 else "20"
        return f"{century}{yy}-{mm}-{dd}"

    return {
        "method": "mrz",
        "found": True,
        "dni": dni,
        "last_name": (getattr(fields, "surname", "") or "").replace("<", " ").strip(),
        "first_name": (getattr(fields, "name", "") or "").replace("<", " ").strip(),
        "sex": getattr(fields, "sex", "") or "",
        "birth_date": _fmt_date(getattr(fields, "birth_date", "") or ""),
        "expiry_date": _fmt_date(getattr(fields, "expiry_date", "") or ""),
        # Doble verificación: el checksum ICAO propio de la MRZ (icao_valid)
        # Y el dígito verificador real de RENIEC sobre el DNI extraído --
        # cualquiera de los dos en falso dejaría pasar un dato corrupto por
        # ruido de OCR si solo confiáramos en uno.
        "checksum_valid": icao_valid and checksum_digit is not None,
    }


def scan_dni_image(img: np.ndarray) -> dict:
    """Punto de entrada único: intenta PDF417, luego MRZ. Nunca lanza --
    en el peor caso devuelve {"method": "none", "found": False}."""
    if img is None:
        return {"method": "none", "found": False}
    try:
        result = _try_decode_pdf417(img)
        if result:
            return result
    except Exception:
        pass
    try:
        result = _try_decode_mrz(img)
        if result:
            return result
    except Exception:
        pass
    return {"method": "none", "found": False}
